require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,ENJUSDT").split(","),
  INTERVALO_ALERTA_RSI_MS: 3 * 60 * 1000, // 3 minutos para verificação de RSI
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000, // Cooldown para alertas
  RSI_PERIOD: 14,
  RSI_HIGH_THRESHOLD_1: 73, // Alerta de RSI alto (todos os timeframes)
  RSI_HIGH_THRESHOLD_2: 75, // Alerta de RSI extremo (5m, 15m, 1h)
  RSI_LOW_THRESHOLD: 23, // Alerta de RSI baixo (todos os timeframes)
  RSI_EXTREME_LOW_THRESHOLD: 23, // Alerta de RSI extremo baixo (5m, 15m, 1h)
  CACHE_TTL: 2 * 60 * 1000, // 2 minutos para cache
  MAX_CACHE_SIZE: 50, // Reduzido para 50 entradas
  MAX_HISTORICO_ALERTAS: 10,
  RECONNECT_INTERVAL_MS: 5000,
  LOG_MAX_SIZE: '100m', // Tamanho máximo de cada arquivo de log
  LOG_MAX_FILES: 7, // Manter logs dos últimos 7 dias
};

// ================= LOGGER ================= //
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: 'logs/trading_bot_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/trading_bot_combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new winston.transports.Console(),
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

// ================= LIMPEZA DE ARQUIVOS ANTIGOS ================= //
async function cleanupOldLogs() {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir);
    const now = Date.now();
    const maxAgeMs = config.LOG_MAX_FILES * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        logger.info(`Arquivo de log antigo excluído: ${filePath}`);
      }
    }
  } catch (e) {
    logger.error(`Erro ao limpar logs antigos: ${e.message}`);
  }
}

// ================= OTIMIZAÇÃO DO CACHE ================= //
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
  }, config.CACHE_TTL);
}

function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of state.dataCache) {
    if (now - value.timestamp >= config.CACHE_TTL) {
      state.dataCache.delete(key);
      logger.info(`Cache expirado limpo para ${key}`);
    }
  }
}

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
  const cached = state.dataCache.get(key);
  if (cached && Date.now() - cached.timestamp < config.CACHE_TTL) {
    return cached.data;
  }
  return null;
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

function calculateStochastic(data, kPeriod = 5, kSlowing = 3, dPeriod = 3) {
  if (!data || data.length < kPeriod + kSlowing + dPeriod) {
    logger.warn(`Dados insuficientes para calcular Estocástico: ${data?.length || 0} candles, necessário ${kPeriod + kSlowing + dPeriod}`);
    return null;
  }
  const stoch = TechnicalIndicators.Stochastic.calculate({
    high: data.map(d => d.high),
    low: data.map(d => d.low),
    close: data.map(d => d.close),
    period: kPeriod,
    signalPeriod: dPeriod,
    kSlowing: kSlowing
  });
  const validStoch = stoch.filter(s => !isNaN(s.k) && s.k >= 0 && s.k <= 100 && !isNaN(s.d) && s.d >= 0 && s.d <= 100);
  if (validStoch.length < 2) {
    logger.warn(`Estocástico inválido: ${validStoch.length} valores válidos`);
    return null;
  }
  return validStoch[validStoch.length - 1]; // Retorna o último valor válido
}

function calculateSupportResistance(data) {
  if (!data || data.length < 50) {
    logger.warn(`Dados insuficientes para calcular suporte/resistência: ${data?.length || 0} candles, necessário 50`);
    return { support: null, resistance: null };
  }
  const lows = data.slice(-50).map(d => d.low);
  const highs = data.slice(-50).map(d => d.high);
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);
  return { support, resistance };
}

function calculateVWAP(data) {
  if (!data || data.length < 50) {
    logger.warn(`Dados insuficientes para calcular VWAP: ${data?.length || 0} candles, necessário 50`);
    return null;
  }
  const vwap = TechnicalIndicators.VWAP.calculate({
    high: data.slice(-50).map(d => d.high),
    low: data.slice(-50).map(d => d.low),
    close: data.slice(-50).map(d => d.close),
    volume: data.slice(-50).map(d => d.volume)
  });
  return vwap.length > 0 ? vwap[vwap.length - 1] : null;
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

async function detectAbnormalVolume(symbol, timeframe = '3m', lookback = 10) {
  const cacheKey = `volume_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const ohlcv3mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, timeframe, undefined, lookback));
    if (!ohlcv3mRaw || ohlcv3mRaw.length < lookback) {
      logger.warn(`Dados insuficientes para análise de volume em ${timeframe} para ${symbol}: ${ohlcv3mRaw?.length || 0} candles`);
      return { status: '🔹 Indisp.', percentChange: '0.00' };
    }

    const ohlcv3m = normalizeOHLCV(ohlcv3mRaw);
    const volumes = ohlcv3m.map(d => d.volume);
    const currentVolume = volumes[volumes.length - 1];
    const previousVolumes = volumes.slice(0, -1);
    const avgVolume = previousVolumes.reduce((sum, vol) => sum + vol, 0) / previousVolumes.length;
    const stdDev = Math.sqrt(previousVolumes.reduce((sum, vol) => sum + Math.pow(vol - avgVolume, 2), 0) / previousVolumes.length);
    const threshold = avgVolume + 2 * stdDev; // Volume anormal: acima de 2 desvios padrão
    const percentChange = avgVolume !== 0 ? ((currentVolume - avgVolume) / avgVolume * 100).toFixed(2) : '0.00';

    let status = '🔹 ESTÁVEL';
    if (currentVolume > threshold) {
      const isBuyPressure = ohlcv3m[ohlcv3m.length - 1].close > ohlcv3m[ohlcv3m.length - 1].open;
      status = isBuyPressure ? '📈 🟢COMPRADOR' : '📉 🔴VENDEDOR';
    }

    const result = { status, percentChange };
    setCachedData(cacheKey, result);
    logger.info(`Volume analisado para ${symbol} em ${timeframe}: status=${status}, percentChange=${percentChange}%`);
    return result;
  } catch (e) {
    logger.warn(`Erro ao analisar volume para ${symbol} em ${timeframe}: ${e.message}`);
    return { status: '🔹 Indisp.', percentChange: '0.00' };
  }
}

// ================= FUNÇÕES DE ALERTAS ================= //
function getStochasticEmoji(value) {
  if (!value) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}

function getSetaDirecao(current, previous) {
  if (!current || !previous) return "➡️";
  return current > previous ? "⬆️" : current < previous ? "⬇️" : "➡️";
}

async function sendAlertRSI(symbol, price, rsi5m, rsi15m, rsi1h, rsi4h, rsi1d, lsr, fundingRate, oi5m, oi15m, support, resistance, vwap1h, stoch4h, stoch1d, stoch4hPrevious, stoch1dPrevious, volume3m) {
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

  // Verificar condições de alerta
  if (rsi5m >= config.RSI_HIGH_THRESHOLD_2 && rsi15m >= config.RSI_HIGH_THRESHOLD_2 && rsi1h >= config.RSI_HIGH_THRESHOLD_2) {
    alertType = '🛑#1H Realizar Lucro/Parcial🛑';
    emoji = '🔴🔴';
  } else if (rsi5m <= config.RSI_EXTREME_LOW_THRESHOLD && rsi15m <= config.RSI_EXTREME_LOW_THRESHOLD && rsi1h <= config.RSI_EXTREME_LOW_THRESHOLD) {
    alertType = '✳️#1H Zona de Suporte Avaliar Compra✳️';
    emoji = '🟢🟢';
  } else if (rsi5m >= config.RSI_HIGH_THRESHOLD_1 && rsi15m >= config.RSI_HIGH_THRESHOLD_1 && rsi1h >= config.RSI_HIGH_THRESHOLD_1 && rsi4h >= config.RSI_HIGH_THRESHOLD_1) {
    alertType = '🛑#4H Realizar Lucro Total/Parcial🛑';
    emoji = '🔴';
  } else if (rsi5m <= config.RSI_LOW_THRESHOLD && rsi15m <= config.RSI_LOW_THRESHOLD && rsi1h <= config.RSI_LOW_THRESHOLD && rsi4h <= config.RSI_LOW_THRESHOLD) {
    alertType = '✳️#4H Zona de Suporte/Swing Trade Compra✳️';
    emoji = '🟢';
  } else {
    return; // Sem alerta se nenhuma condição for atendida
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

  // Formatar Suporte, Resistência e VWAP
  const supportText = support !== null ? format(support) : '🔹 Indisp.';
  const resistanceText = resistance !== null ? format(resistance) : '🔹 Indisp.';
  const vwapText = vwap1h !== null ? format(vwap1h) : '🔹 Indisp.';

  // Formatar Estocástico
  const stoch4hEmoji = getStochasticEmoji(stoch4h ? stoch4h.k : null);
  const stochDEmoji = getStochasticEmoji(stoch1d ? stoch1d.k : null);
  const direcao4h = getSetaDirecao(stoch4h ? stoch4h.k : null, stoch4hPrevious ? stoch4hPrevious.k : null);
  const direcaoD = getSetaDirecao(stoch1d ? stoch1d.k : null, stoch1dPrevious ? stoch1dPrevious.k : null);

  // Formatar Volume Anormal
  const volume3mText = volume3m ? `${volume3m.status} (${volume3m.percentChange}%)` : '🔹 Indisp.';

  // Montar texto do alerta com maior precisão para RSI e volume anormal
  alertText = `💠 RSI ACTIVE MTF \n` +
              `🔘$${symbolWithoutSlash}\n` +
              `💲Preço: ${format(price)}\n` +
              `${alertType}\n` +
              `RSI 5m: ${rsi5m.toFixed(4)}\n` +
              `RSI 15m: ${rsi15m.toFixed(4)}\n` +
              `RSI 1h: ${rsi1h.toFixed(4)}\n` +
              `RSI 4h: ${rsi4h.toFixed(4)}\n` +
              `RSI 1d: ${rsi1d.toFixed(4)}\n` +
              `🔹 Stoch Diário %K: ${stoch1d ? stoch1d.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
              `🔹 Stoch 4H %K: ${stoch4h ? stoch4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
              `💱LSR: ${lsrText} ${lsrSymbol}\n` +
              `Funding Rate: ${fundingRateText}\n` +
              `${oi5mText}\n` +
              `${oi15mText}\n` +
              `📊 Vol: ${volume3mText}\n` +
              `🟰Suporte : ${supportText}\n` +
              `🟰Resistência : ${resistanceText}\n` +
              `➖VWAP (1h): ${vwapText}\n` +
              `☑︎ 🤖 Titanium Monitor - @J4Rviz`;

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
      logger.info(`Alerta RSI enviado para ${symbol}: ${alertType}, RSI 5m=${rsi5m.toFixed(4)}, 15m=${rsi15m.toFixed(4)}, 1h=${rsi1h.toFixed(4)}, 4h=${rsi4h.toFixed(4)}, 1d=${rsi1d.toFixed(4)}, Stoch 4h=%K:${stoch4h ? stoch4h.k.toFixed(2) : 'N/A'}, Stoch 1d=%K:${stoch1d ? stoch1d.k.toFixed(2) : 'N/A'}, Preço=${format(price)}, LSR=${lsrText}, Funding=${fundingRateText}, Volume 3m=${volume3mText}, Suporte=${supportText}, Resistência=${resistanceText}, VWAP=${vwapText}`);
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

      // Buscar dados
      let ohlcv3mRaw = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '3m', undefined, 10));
      let ohlcv5mRaw = getCachedData(`${cacheKeyPrefix}_5m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '5m', undefined, config.RSI_PERIOD + 1));
      let ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '15m', undefined, config.RSI_PERIOD + 1));
      let ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1h', undefined, 50));
      let ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '4h', undefined, config.RSI_PERIOD + 10)); // Mais candles para Estocástico
      let ohlcv1dRaw = getCachedData(`${cacheKeyPrefix}_1d`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1d', undefined, config.RSI_PERIOD + 10)); // Mais candles para Estocástico
      const tickerRaw = getCachedData(`ticker_${symbol}`) || await withRetry(() => exchangeSpot.fetchTicker(symbolWithSlash));

      // Fallback para timeframes maiores se necessário
      if (!ohlcv3mRaw || ohlcv3mRaw.length < 10) {
        logger.info(`Fallback para 5m para ${symbol} (3m)`);
        ohlcv3mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '5m', undefined, 10));
      }
      if (!ohlcv5mRaw || ohlcv5mRaw.length < config.RSI_PERIOD + 1) {
        logger.info(`Fallback para 15m para ${symbol} (5m)`);
        ohlcv5mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '15m', undefined, config.RSI_PERIOD + 1));
      }
      if (!ohlcv15mRaw || ohlcv15mRaw.length < config.RSI_PERIOD + 1) {
        logger.info(`Fallback para 1h para ${symbol} (15m)`);
        ohlcv15mRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1h', undefined, config.RSI_PERIOD + 1));
      }

      // Validar dados
      if (!ohlcv3mRaw || !ohlcv5mRaw || !ohlcv15mRaw || !ohlcv1hRaw || !ohlcv4hRaw || !ohlcv1dRaw || !tickerRaw || tickerRaw.last === undefined) {
        logger.warn(`Dados insuficientes ou preço não disponível para ${symbol}, pulando...`);
        return;
      }

      const ohlcv3m = normalizeOHLCV(ohlcv3mRaw);
      const ohlcv5m = normalizeOHLCV(ohlcv5mRaw);
      const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
      const ohlcv1d = normalizeOHLCV(ohlcv1dRaw);
      const currentPrice = parseFloat(tickerRaw.last);

      // Validar número de candles
      if (ohlcv3m.length < 10 || ohlcv5m.length < config.RSI_PERIOD + 1 || ohlcv15m.length < config.RSI_PERIOD + 1 ||
          ohlcv1h.length < config.RSI_PERIOD + 1 || ohlcv4h.length < config.RSI_PERIOD + 1 ||
          ohlcv1d.length < config.RSI_PERIOD + 1) {
        logger.warn(`Dados insuficientes para ${symbol}: 3m=${ohlcv3m.length}, 5m=${ohlcv5m.length}, 15m=${ohlcv15m.length}, 1h=${ohlcv1h.length}, 4h=${ohlcv4h.length}, 1d=${ohlcv1d.length}`);
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
      if (!checkTimestamp(ohlcv3m, '3m', 3) || !checkTimestamp(ohlcv5m, '5m', 5) || !checkTimestamp(ohlcv15m, '15m', 15) ||
          !checkTimestamp(ohlcv1h, '1h', 60) || !checkTimestamp(ohlcv4h, '4h', 240) ||
          !checkTimestamp(ohlcv1d, '1d', 1440)) {
        logger.warn(`Candles desatualizados para ${symbol}, pulando...`);
        return;
      }

      // Log dos candles para depuração
      logger.info(`Dados OHLCV para ${symbol}:`);
      logger.info(`3m: ${JSON.stringify(ohlcv3m.slice(-5))}`);
      logger.info(`5m: ${JSON.stringify(ohlcv5m.slice(-5))}`);
      logger.info(`15m: ${JSON.stringify(ohlcv15m.slice(-5))}`);
      logger.info(`1h: ${JSON.stringify(ohlcv1h.slice(-5))}`);
      logger.info(`4h: ${JSON.stringify(ohlcv4h.slice(-5))}`);
      logger.info(`1d: ${JSON.stringify(ohlcv1d.slice(-5))}`);

      const rsi5m = calculateRSI(ohlcv5m);
      const rsi15m = calculateRSI(ohlcv15m);
      const rsi1h = calculateRSI(ohlcv1h);
      const rsi4h = calculateRSI(ohlcv4h);
      const rsi1d = calculateRSI(ohlcv1d);

      // Validar RSI
      if (!rsi5m.length || !rsi15m.length || !rsi1h.length || !rsi4h.length || !rsi1d.length) {
        logger.warn(`RSI não calculado para ${symbol}, pulando...`);
        return;
      }

      // Calcular Estocástico (5,3,3) para 4h e 1d
      const stochData4h = TechnicalIndicators.Stochastic.calculate({
        high: ohlcv4h.map(d => d.high),
        low: ohlcv4h.map(d => d.low),
        close: ohlcv4h.map(d => d.close),
        period: 5,
        signalPeriod: 3,
        kSlowing: 3
      });
      const stochData1d = TechnicalIndicators.Stochastic.calculate({
        high: ohlcv1d.map(d => d.high),
        low: ohlcv1d.map(d => d.low),
        close: ohlcv1d.map(d => d.close),
        period: 5,
        signalPeriod: 3,
        kSlowing: 3
      });

      const stoch4h = stochData4h.length >= 1 ? stochData4h[stochData4h.length - 1] : null;
      const stoch4hPrevious = stochData4h.length >= 2 ? stochData4h[stochData4h.length - 2] : null;
      const stoch1d = stochData1d.length >= 1 ? stochData1d[stochData1d.length - 1] : null;
      const stoch1dPrevious = stochData1d.length >= 2 ? stochData1d[stochData1d.length - 2] : null;

      // Calcular Suporte, Resistência e VWAP
      const { support, resistance } = calculateSupportResistance(ohlcv1h);
      const vwap1h = calculateVWAP(ohlcv1h);

      // Log dos valores de RSI, Estocástico, Suporte, Resistência e VWAP
      logger.info(`Indicadores calculados para ${symbol}:`);
      logger.info(`RSI 5m: ${rsi5m[rsi5m.length - 1]}`);
      logger.info(`RSI 15m: ${rsi15m[rsi15m.length - 1]}`);
      logger.info(`RSI 1h: ${rsi1h[rsi1h.length - 1]}`);
      logger.info(`RSI 4h: ${rsi4h[rsi4h.length - 1]}`);
      logger.info(`RSI 1d: ${rsi1d[rsi1d.length - 1]}`);
      logger.info(`Stoch 4h: %K=${stoch4h ? stoch4h.k.toFixed(2) : 'N/A'}, %D=${stoch4h ? stoch4h.d.toFixed(2) : 'N/A'}`);
      logger.info(`Stoch 1d: %K=${stoch1d ? stoch1d.k.toFixed(2) : 'N/A'}, %D=${stoch1d ? stoch1d.d.toFixed(2) : 'N/A'}`);
      logger.info(`Suporte (1h, 50 velas): ${support}`);
      logger.info(`Resistência (1h, 50 velas): ${resistance}`);
      logger.info(`VWAP (1h): ${vwap1h}`);

      // Cache dos dados
      setCachedData(`${cacheKeyPrefix}_3m`, ohlcv3mRaw);
      setCachedData(`${cacheKeyPrefix}_5m`, ohlcv5mRaw);
      setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
      setCachedData(`${cacheKeyPrefix}_4h`, ohlcv4hRaw);
      setCachedData(`${cacheKeyPrefix}_1d`, ohlcv1dRaw);
      setCachedData(`ticker_${symbol}`, tickerRaw);

      const lsr = await fetchLSR(symbolWithSlash);
      const oi5m = await fetchOpenInterest(symbolWithSlash, '5m');
      const oi15m = await fetchOpenInterest(symbolWithSlash, '15m');
      const fundingRate = await fetchFundingRate(symbolWithSlash);
      const volume3m = await detectAbnormalVolume(symbolWithSlash);

      await sendAlertRSI(
        symbolWithSlash,
        currentPrice,
        rsi5m[rsi5m.length - 1],
        rsi15m[rsi15m.length - 1],
        rsi1h[rsi1h.length - 1],
        rsi4h[rsi4h.length - 1],
        rsi1d[rsi1d.length - 1],
        lsr,
        fundingRate,
        oi5m,
        oi15m,
        support,
        resistance,
        vwap1h,
        stoch4h,
        stoch1d,
        stoch4hPrevious,
        stoch1dPrevious,
        volume3m
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
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await checkConnection();
    const pairCount = config.PARES_MONITORADOS.length;
    const pairsList = pairCount > 5 ? `${config.PARES_MONITORADOS.slice(0, 5).join(', ')} e mais ${pairCount - 5} pares` : config.PARES_MONITORADOS.join(', ');
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `✅ *Titanium RSI MONITOR *\nMonitorando ${pairCount} pares: ${pairsList}\nRSI Alerts`, { parse_mode: 'Markdown' }));
    await monitorRSI();
    setInterval(monitorRSI, config.INTERVALO_ALERTA_RSI_MS);
    setInterval(checkConnection, config.RECONNECT_INTERVAL_MS);
    setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
    setInterval(cleanupCache, config.CACHE_TTL);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
    state.isConnected = false;
    await reconnect();
  }
}

main().catch(e => logger.error(`Erro fatal: ${e.message}`));
bot.start();
logger.info('Bot Titanium está rodando...');
