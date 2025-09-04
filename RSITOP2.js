require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,ENJUSDT").split(","),
  INTERVALO_ALERTA_RSI_MS: 3 * 60 * 1000, // 3 minutos para verificação de RSI
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000, // Cooldown para alertas
  RSI_PERIOD: 14,
  RSI_HIGH_THRESHOLD_1: 70, // Alerta de RSI alto (todos os timeframes)
  RSI_LOW_THRESHOLD: 25, // Alerta de RSI baixo (todos os timeframes)
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
  MAX_CACHE_SIZE: 100,
  MAX_HISTORICO_ALERTAS: 10,
  RECONNECT_INTERVAL_MS: 5000,
  MACD_FAST_PERIOD: 12, // Período rápido do MACD
  MACD_SLOW_PERIOD: 26, // Período lento do MACD
  MACD_SIGNAL_PERIOD: 9, // Período da linha de sinal
};

// ================= LOGGER ================= //
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'trading_bot_error.log', level: 'error' }),
    new winston.transports.File({ filename: 'trading_bot_combined.log' }),
    new winston.transports.Console()
  ],
});

// ================= ESTADO GLOBAL E CACHE ================= //
const state = {
  ultimoRSIAlert: {},
  dataCache: new Map(),
  isConnected: false,
};

// ================= VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE ================= //
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'COINS'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`Missing environment variable: ${key}`);
      process.exit(1);
    }
  }
}
validateEnv();

// ================= INICIALIZAÇÃO ================= //
const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
const exchangeSpot = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 30000,
  options: { defaultType: 'spot' }
});
const exchangeFutures = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 30000,
  options: { defaultType: 'future', defaultSubType: 'linear' }
});

// ================= RECONEXÃO ================= //
async function checkConnection() {
  try {
    await exchangeSpot.fetchTickers(['BTC/USDT']);
    state.isConnected = true;
    logger.info('Conexão com a Binance está ativa.');
  } catch (e) {
    state.isConnected = false;
    logger.warn(`Conexão com a Binance perdida: ${e.message}. Tentando reconectar...`);
    await reconnect();
  }
}

async function reconnect() {
  if (state.isConnected) return;
  try {
    await exchangeSpot.loadMarkets();
    await exchangeFutures.loadMarkets();
    state.isConnected = true;
    logger.info('Reconexão bem-sucedida.');
  } catch (e) {
    logger.error(`Falha na reconexão: ${e.message}. Tentando novamente em ${config.RECONNECT_INTERVAL_MS}ms...`);
    setTimeout(reconnect, config.RECONNECT_INTERVAL_MS);
  }
}

// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 5, delayBase = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) {
        logger.warn(`Falha após ${retries} tentativas: ${e.message}`);
        throw e;
      }
      const delay = Math.pow(2, attempt - 1) * delayBase;
      logger.info(`Tentativa ${attempt} falhou, retry após ${delay}ms: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function getCachedData(key) {
  // Cache temporariamente desativado para depuração
  // const cacheEntry = state.dataCache.get(key);
  // if (cacheEntry && Date.now() - cacheEntry.timestamp < config.CACHE_TTL) {
  //   logger.info(`Usando cache para ${key}`);
  //   return cacheEntry.data;
  // }
  // state.dataCache.delete(key);
  return null;
}

function setCachedData(key, data) {
  if (state.dataCache.size >= config.MAX_CACHE_SIZE) {
    const oldestKey = state.dataCache.keys().next().value;
    state.dataCache.delete(oldestKey);
    logger.info(`Cache cheio, removido item mais antigo: ${oldestKey}`);
  }
  state.dataCache.set(key, { timestamp: Date.now(), data });
  setTimeout(() => {
    if (state.dataCache.has(key) && Date.now() - state.dataCache.get(key).timestamp >= config.CACHE_TTL) {
      state.dataCache.delete(key);
      logger.info(`Cache limpo para ${key}`);
    }
  }, config.CACHE_TTL + 1000);
}

async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    await new Promise(resolve => setTimeout(resolve, 1000));
    results.push(...batchResults);
  }
  return results;
}

// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  return data.map(c => ({
    time: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  })).filter(c => !isNaN(c.close) && !isNaN(c.volume) && c.close > 0);
}

function calculateRSI(data, period = config.RSI_PERIOD) {
  if (!data || data.length < period + 1) {
    logger.warn(`Dados insuficientes para calcular RSI: ${data?.length || 0} candles, necessário ${period + 1}`);
    return [];
  }
  const rsi = TechnicalIndicators.RSI.calculate({
    period,
    values: data.map(d => d.close || d[4])
  });
  return rsi.filter(v => !isNaN(v) && v >= 0 && v <= 100);
}

function calculateMACD(data) {
  if (!data || data.length < config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD) {
    logger.warn(`Dados insuficientes para calcular MACD: ${data?.length || 0} candles, necessário ${config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD}`);
    return null;
  }
  const macd = TechnicalIndicators.MACD.calculate({
    fastPeriod: config.MACD_FAST_PERIOD,
    slowPeriod: config.MACD_SLOW_PERIOD,
    signalPeriod: config.MACD_SIGNAL_PERIOD,
    values: data.map(d => d.close || d[4])
  });
  if (!macd || macd.length === 0) {
    logger.warn(`MACD não calculado: resultado vazio`);
    return null;
  }
  const lastMACD = macd[macd.length - 1];
  const position = lastMACD.MACD > lastMACD.signal ? '📈' : '📉';
  const situation = lastMACD.MACD > 0 ? 'Bullish 🟢' : 'Bearish 🔴';
  return { macd: lastMACD.MACD, signal: lastMACD.signal, position, situation };
}

async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const symbolWithoutSlash = symbol.replace('/', '');
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbolWithoutSlash, period: '15m', limit: 2 }
    }));
    if (!res.data || res.data.length < 2) {
      logger.warn(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00', error: 'Dados insuficientes' };
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const previousLSR = parseFloat(res.data[1].longShortRatio);
    if (isNaN(currentLSR) || currentLSR < 0 || isNaN(previousLSR) || previousLSR < 0) {
      logger.warn(`LSR inválido para ${symbol}`);
      return { value: null, isRising: false, percentChange: '0.00', error: 'LSR inválido' };
    }
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, isRising: currentLSR > previousLSR, percentChange };
    setCachedData(cacheKey, result);
    logger.info(`LSR obtido para ${symbol}: ${currentLSR}, variação: ${percentChange}%`);
    return result;
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00', error: `Erro ao buscar LSR: ${e.message}` };
  }
}

async function fetchOpenInterest(symbol, timeframe, retries = 5) {
  const cacheKey = `oi_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const oiData = await withRetry(() => exchangeFutures.fetchOpenInterestHistory(symbol, timeframe, undefined, 30));
    if (!oiData || oiData.length < 3) {
      logger.warn(`Dados insuficientes de Open Interest para ${symbol} no timeframe ${timeframe}: ${oiData?.length || 0} registros`);
      if (retries > 0) {
        const delay = Math.pow(2, 5 - retries) * 1000;
        logger.info(`Tentando novamente para ${symbol} no timeframe ${timeframe}, tentativas restantes: ${retries}, delay: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '5m') {
        logger.info(`Fallback para timeframe 15m para ${symbol}`);
        return await fetchOpenInterest(symbol, '15m', 3);
      }
      return { isRising: false, percentChange: '0.00' };
    }
    const validOiData = oiData
      .filter(d => {
        const oiValue = d.openInterest || d.openInterestAmount || (d.info && d.info.sumOpenInterest);
        return typeof oiValue === 'number' && !isNaN(oiValue) && oiValue >= 0;
      })
      .map(d => ({
        ...d,
        openInterest: d.openInterest || d.openInterestAmount || (d.info && d.info.sumOpenInterest)
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
    if (validOiData.length < 3) {
      logger.warn(`Registros válidos insuficientes para ${symbol} no timeframe ${timeframe}: ${validOiData.length} registros válidos`);
      if (retries > 0) {
        const delay = Math.pow(2, 5 - retries) * 1000;
        logger.info(`Tentando novamente para ${symbol} no timeframe ${timeframe}, tentativas restantes: ${retries}, delay: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '5m') {
        logger.info(`Fallback para timeframe 15m para ${symbol}`);
        return await fetchOpenInterest(symbol, '15m', 3);
      }
      return { isRising: false, percentChange: '0.00' };
    }
    const oiValues = validOiData.map(d => d.openInterest).filter(v => v !== undefined);
    const sortedOi = [...oiValues].sort((a, b) => a - b);
    const q1 = sortedOi[Math.floor(sortedOi.length / 4)];
    const q3 = sortedOi[Math.floor(3 * sortedOi.length / 4)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    const filteredOiData = validOiData.filter(d => d.openInterest >= lowerBound && d.openInterest <= upperBound);
    if (filteredOiData.length < 3) {
      logger.warn(`Registros válidos após filtro IQR insuficientes para ${symbol} no timeframe ${timeframe}: ${filteredOiData.length}`);
      if (retries > 0) {
        const delay = Math.pow(2, 5 - retries) * 1000;
        logger.info(`Tentando novamente para ${symbol} no timeframe ${timeframe}, tentativas restantes: ${retries}, delay: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '5m') {
        logger.info(`Fallback para timeframe 15m para ${symbol}`);
        return await fetchOpenInterest(symbol, '15m', 3);
      }
      return { isRising: false, percentChange: '0.00' };
    }
    const recentOi = filteredOiData.slice(0, 3).map(d => d.openInterest);
    const sma = recentOi.reduce((sum, val) => sum + val, 0) / recentOi.length;
    const previousRecentOi = filteredOiData.slice(3, 6).map(d => d.openInterest);
    const previousSma = previousRecentOi.length >= 3 ? previousRecentOi.reduce((sum, val) => sum + val, 0) / previousRecentOi.length : recentOi[recentOi.length - 1];
    const oiPercentChange = previousSma !== 0 ? ((sma - previousSma) / previousSma * 100).toFixed(2) : '0.00';
    const result = {
      isRising: sma > previousSma,
      percentChange: oiPercentChange
    };
    setCachedData(cacheKey, result);
    logger.info(`Open Interest calculado para ${symbol} no timeframe ${timeframe}: sma=${sma}, previousSma=${previousSma}, percentChange=${oiPercentChange}%`);
    return result;
  } catch (e) {
    if (e.message.includes('binance does not have market symbol') || e.message.includes('Invalid symbol')) {
      logger.error(`Símbolo ${symbol} não suportado para Open Interest no timeframe ${timeframe}. Ignorando.`);
      return { isRising: false, percentChange: '0.00' };
    }
    logger.warn(`Erro ao buscar Open Interest para ${symbol} no timeframe ${timeframe}: ${e.message}`);
    return getCachedData(cacheKey) || { isRising: false, percentChange: '0.00' };
  }
}

async function fetchFundingRate(symbol) {
  const cacheKey = `funding_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const fundingData = await withRetry(() => exchangeFutures.fetchFundingRateHistory(symbol, undefined, 2));
    if (fundingData && fundingData.length >= 2) {
      const currentFunding = parseFloat(fundingData[fundingData.length - 1].fundingRate);
      const previousFunding = parseFloat(fundingData[fundingData.length - 2].fundingRate);
      const percentChange = previousFunding !== 0 ? ((currentFunding - previousFunding) / Math.abs(previousFunding) * 100).toFixed(2) : '0.00';
      const result = { current: currentFunding, isRising: currentFunding > previousFunding, percentChange };
      setCachedData(cacheKey, result);
      return result;
    }
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  }
}

// ================= FUNÇÕES DE ALERTAS ================= //
async function sendAlertRSI(symbol, price, rsi5m, rsi15m, rsi1h, rsi4h, lsr, fundingRate, oi5m, oi15m, macd15m, macd1h) {
  const agora = Date.now();
  if (!state.ultimoRSIAlert[symbol]) state.ultimoRSIAlert[symbol] = { historico: [] };
  if (state.ultimoRSIAlert[symbol]['rsi'] && agora - state.ultimoRSIAlert[symbol]['rsi'] < config.TEMPO_COOLDOWN_MS) return;

  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const symbolWithoutSlash = symbol.replace('/', '');
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  let alertText = '';
  let alertType = '';
  let emoji = '';

  // Verificar se todos os RSIs atendem ao critério
  if (rsi5m >= config.RSI_HIGH_THRESHOLD_1 && rsi15m >= config.RSI_HIGH_THRESHOLD_1 && rsi1h >= config.RSI_HIGH_THRESHOLD_1 && rsi4h >= config.RSI_HIGH_THRESHOLD_1) {
    alertType = 'High🔴 RSI Alert 70+';
    emoji = '🔴';
  } else if (rsi5m <= config.RSI_LOW_THRESHOLD && rsi15m <= config.RSI_LOW_THRESHOLD && rsi1h <= config.RSI_LOW_THRESHOLD && rsi4h <= config.RSI_LOW_THRESHOLD) {
    alertType = 'Low🟢 RSI Alert 25-';
    emoji = '🟢';
  } else {
    return; // Sem alerta se nem todos os timeframes atendem ao critério
  }

  // Formatar Funding Rate
  let fundingRateText = '🔹 Indisp.';
  if (fundingRate.current !== null) {
    const fundingEmoji = fundingRate.current <= -0.002 ? '🟢🟢🟢' :
                        fundingRate.current <= -0.001 ? '🟢🟢' :
                        fundingRate.current <= -0.0005 ? '🟢' :
                        fundingRate.current >= 0.001 ? '🔴🔴🔴' :
                        fundingRate.current >= 0.0003 ? '🔴🔴' :
                        fundingRate.current >= 0.0002 ? '🔴' : '🟢';
    fundingRateText = `${fundingEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}`;
  }

  // Formatar LSR
  let lsrText = lsr.value !== null ? `${lsr.value.toFixed(2)} (${lsr.percentChange}%)` : '🔹 Indisp.';
  let lsrSymbol = '🔘 Consol.';
  if (lsr.value !== null) {
    lsrSymbol = lsr.value <= 1.4 ? '✅ Baixo' : lsr.value >= 2.8 ? '📛 Alto' : '🔘 Consol.';
  }

  // Formatar OI
  const oi5mText = oi5m ? `${oi5m.isRising ? '📈' : '📉'} OI 5m: ${oi5m.percentChange}%` : '🔹 Indisp.';
  const oi15mText = oi15m ? `${oi15m.isRising ? '📈' : '📉'} OI 15m: ${oi15m.percentChange}%` : '🔹 Indisp.';

  // Formatar MACD
  const macd15mText = macd15m ? `MACD 15m: ${macd15m.position} (${macd15m.situation})` : '🔹 MACD 15m Indisp.';
  const macd1hText = macd1h ? `MACD 1h: ${macd1h.position} (${macd1h.situation})` : '🔹 MACD 1h Indisp.';

  // Montar texto do alerta com maior precisão para RSI e incluindo MACD
  alertText = `⚡️Binance RSI, [${timestamp.slice(0, 10)}]\n` +
              `🔹: $${symbolWithoutSlash}\n` +
              `🔔: ${alertType}\n` +
              `RSI 5m: ${rsi5m.toFixed(4)}\n` +
              `RSI 15m: ${rsi15m.toFixed(4)}\n` +
              `RSI 1h: ${rsi1h.toFixed(4)}\n` +
              `RSI 4h: ${rsi4h.toFixed(4)}\n` +
              `Preço: ${format(price)}\n` +
              `LSR: ${lsrText} ${lsrSymbol}\n` +
              `Funding Rate: ${fundingRateText}\n` +
              `${oi5mText}\n` +
              `${oi15mText}\n` +
              `${macd15mText}\n` +
              `${macd1hText}\n` +
              `☑︎ Monitor -🤖 @J4Rviz`;

  // Verificar se o alerta já foi enviado recentemente
  const nivelRompido = alertType;
  const foiAlertado = state.ultimoRSIAlert[symbol].historico.some(r =>
    r.nivel === nivelRompido &&
    (agora - r.timestamp) < config.TEMPO_COOLDOWN_MS
  );

  if (!foiAlertado) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      state.ultimoRSIAlert[symbol]['rsi'] = agora;
      state.ultimoRSIAlert[symbol].historico.push({ nivel: nivelRompido, timestamp: agora });
      state.ultimoRSIAlert[symbol].historico = state.ultimoRSIAlert[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      logger.info(`Alerta RSI enviado para ${symbol}: ${alertType}, RSI 5m=${rsi5m.toFixed(4)}, 15m=${rsi15m.toFixed(4)}, 1h=${rsi1h.toFixed(4)}, 4h=${rsi4h.toFixed(4)}, Preço=${format(price)}, LSR=${lsrText}, Funding=${fundingRateText}, MACD 15m=${macd15mText}, MACD 1h=${macd1hText}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta RSI para ${symbol}: ${e.message}`);
    }
  }
}

// ================= MONITORAMENTO ================= //
async function monitorRSI() {
  try {
    if (!state.isConnected) {
      await checkConnection();
      if (!state.isConnected) return;
    }
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const symbolWithSlash = symbol.replace('USDT', '/USDT');
      const cacheKeyPrefix = `ohlcv_${symbol}`;

      // Buscar dados (aumentar limite para MACD)
      let ohlcv5mRaw = getCachedData(`${cacheKeyPrefix}_5m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '5m', undefined, config.RSI_PERIOD + 1));
      let ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '15m', undefined, config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD));
      let ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1h', undefined, config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD));
      let ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '4h', undefined, config.RSI_PERIOD + 1));
      const tickerRaw = getCachedData(`ticker_${symbol}`) || await withRetry(() => exchangeSpot.fetchTicker(symbolWithSlash));

      // Fallback para timeframes maiores se necessário
      if (!ohlcv5mRaw || ohlcv5mRaw.length < config.RSI_PERIOD + 1) {
        logger.info(`Fallback para 15m para ${symbol} (5m)`);
        ohlcv5mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '15m', undefined, config.RSI_PERIOD + 1));
      }
      if (!ohlcv15mRaw || ohlcv15mRaw.length < config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD) {
        logger.info(`Fallback para 1h para ${symbol} (15m)`);
        ohlcv15mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1h', undefined, config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD));
      }

      // Validar dados
      if (!ohlcv5mRaw || !ohlcv15mRaw || !ohlcv1hRaw || !ohlcv4hRaw || !tickerRaw || tickerRaw.last === undefined) {
        logger.warn(`Dados insuficientes ou preço não disponível para ${symbol}, pulando...`);
        return;
      }

      const ohlcv5m = normalizeOHLCV(ohlcv5mRaw);
      const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
      const currentPrice = parseFloat(tickerRaw.last);

      // Validar número de candles
      if (ohlcv5m.length < config.RSI_PERIOD + 1 || ohlcv15m.length < config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD ||
          ohlcv1h.length < config.MACD_SLOW_PERIOD + config.MACD_SIGNAL_PERIOD || ohlcv4h.length < config.RSI_PERIOD + 1) {
        logger.warn(`Dados insuficientes para ${symbol}: 5m=${ohlcv5m.length}, 15m=${ohlcv15m.length}, 1h=${ohlcv1h.length}, 4h=${ohlcv4h.length}`);
        return;
      }

      // Verificar sincronização dos candles
      const now = new Date();
      const checkTimestamp = (ohlcv, timeframe, maxDiffMinutes) => {
        if (ohlcv.length > 0) {
          const lastCandleTime = new Date(ohlcv[ohlcv.length - 1].time);
          const timeDiff = (now - lastCandleTime) / 1000 / 60;
          if (timeDiff > maxDiffMinutes) {
            logger.warn(`Último candle de ${timeframe} para ${symbol} está desatualizado: ${lastCandleTime}`);
            return false;
          }
          return true;
        }
        return false;
      };
      if (!checkTimestamp(ohlcv5m, '5m', 5) || !checkTimestamp(ohlcv15m, '15m', 15) ||
          !checkTimestamp(ohlcv1h, '1h', 60) || !checkTimestamp(ohlcv4h, '4h', 240)) {
        logger.warn(`Candles desatualizados para ${symbol}, pulando...`);
        return;
      }

      // Log dos candles para depuração
      logger.info(`Dados OHLCV para ${symbol}:`);
      logger.info(`5m: ${JSON.stringify(ohlcv5m.slice(-5))}`);
      logger.info(`15m: ${JSON.stringify(ohlcv15m.slice(-5))}`);
      logger.info(`1h: ${JSON.stringify(ohlcv1h.slice(-5))}`);
      logger.info(`4h: ${JSON.stringify(ohlcv4h.slice(-5))}`);

      const rsi5m = calculateRSI(ohlcv5m);
      const rsi15m = calculateRSI(ohlcv15m);
      const rsi1h = calculateRSI(ohlcv1h);
      const rsi4h = calculateRSI(ohlcv4h);
      const macd15m = calculateMACD(ohlcv15m);
      const macd1h = calculateMACD(ohlcv1h);

      // Validar RSI
      if (!rsi5m.length || !rsi15m.length || !rsi1h.length || !rsi4h.length) {
        logger.warn(`RSI não calculado para ${symbol}, pulando...`);
        return;
      }

      // Log dos valores de RSI e MACD
      logger.info(`Indicadores calculados para ${symbol}:`);
      logger.info(`RSI 5m: ${rsi5m[rsi5m.length - 1]}`);
      logger.info(`RSI 15m: ${rsi15m[rsi15m.length - 1]}`);
      logger.info(`RSI 1h: ${rsi1h[rsi1h.length - 1]}`);
      logger.info(`RSI 4h: ${rsi4h[rsi4h.length - 1]}`);
      logger.info(`MACD 15m: ${macd15m ? JSON.stringify(macd15m) : 'Indisponível'}`);
      logger.info(`MACD 1h: ${macd1h ? JSON.stringify(macd1h) : 'Indisponível'}`);

      // Cache dos dados
      setCachedData(`${cacheKeyPrefix}_5m`, ohlcv5mRaw);
      setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
      setCachedData(`${cacheKeyPrefix}_4h`, ohlcv4hRaw);
      setCachedData(`ticker_${symbol}`, tickerRaw);

      const lsr = await fetchLSR(symbolWithSlash);
      const oi5m = await fetchOpenInterest(symbolWithSlash, '5m');
      const oi15m = await fetchOpenInterest(symbolWithSlash, '15m');
      const fundingRate = await fetchFundingRate(symbolWithSlash);

      await sendAlertRSI(
        symbolWithSlash,
        currentPrice,
        rsi5m[rsi5m.length - 1],
        rsi15m[rsi15m.length - 1],
        rsi1h[rsi1h.length - 1],
        rsi4h[rsi4h.length - 1],
        lsr,
        fundingRate,
        oi5m,
        oi15m,
        macd15m,
        macd1h
      );
    }, 5);
  } catch (e) {
    logger.error(`Erro ao processar condições de RSI: ${e.message}`);
    state.isConnected = false;
    await reconnect();
  }
}

// ================= COMANDOS DO TELEGRAM ================= //
bot.command('price', async (ctx) => {
  const coin = ctx.match ? ctx.match.toUpperCase() + 'USDT' : null;
  if (!coin) {
    await ctx.reply('Uso: /price <símbolo> (ex: /price ENJ)');
    return;
  }
  const coinWithSlash = coin.replace('USDT', '/USDT');
  try {
    const ticker = await exchangeSpot.fetchTicker(coinWithSlash);
    if (ticker && ticker.last !== undefined) {
      await ctx.reply(`${coin}: $${ticker.last.toFixed(2)}`);
      logger.info(`Consulta de preço para ${coin}`);
    } else {
      await ctx.reply(`❌ Par ${coin} não encontrado.`);
    }
  } catch (error) {
    await ctx.reply(`❌ Erro ao obter preço para ${coin}: ${error.message}`);
    logger.error(`Erro na consulta de preço para ${coin}: ${error.message}`);
  }
});

// ================= INICIALIZAÇÃO DO BOT ================= //
async function main() {
  logger.info('Iniciando bot Titanium');
  try {
    await checkConnection();
    const pairCount = config.PARES_MONITORADOS.length;
    const pairsList = pairCount > 5 ? `${config.PARES_MONITORADOS.slice(0, 5).join(', ')} e mais ${pairCount - 5} pares` : config.PARES_MONITORADOS.join(', ');
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `✅ *Titanium3 Start*\nMonitorando ${pairCount} pares: ${pairsList}\nRSI e MACD Alerts`, { parse_mode: 'Markdown' }));
    await monitorRSI();
    setInterval(monitorRSI, config.INTERVALO_ALERTA_RSI_MS);
    setInterval(checkConnection, config.RECONNECT_INTERVAL_MS);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
    state.isConnected = false;
    await reconnect();
  }
}

main().catch(e => logger.error(`Erro fatal: ${e.message}`));
bot.start();
logger.info('Bot Titanium está rodando...');
