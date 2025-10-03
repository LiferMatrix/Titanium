require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,ENJUSDT").split(","),
  INTERVALO_CCI_MS: 5 * 60 * 1000, // 5 minutos para CCI
  CCI_LENGTH: 20,
  EMA_SHORT_LENGTH: 5,
  EMA_LONG_LENGTH: 13,
  EMA_34_LENGTH: 34, // EMA usada para critério de fechamento do preço no alerta CCI
  SUPPORT_RESISTANCE_LENGTH: 20,
  ATR_LENGTH: 14,
  VOLUME_LOOKBACK: 20,
  VOLUME_MULTIPLIER: 2,
  MIN_VOLATILITY: 0.001,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
  MAX_CACHE_SIZE: 100,
  RECONNECT_INTERVAL_MS: 5000,
  VWAP_PERIOD: 20, // Período para cálculo do VWAP
  LOG_MAX_SIZE: '100m', // Máximo 100 MB por arquivo de log
  LOG_MAX_FILES: 7, // Reter logs por 7 dias
  RSI_PERIOD: 14,
};

// ================= LOGGER ================= //
const logDir = path.join(__dirname, 'logs');

async function ensureLogDir() {
  try {
    await fs.mkdir(logDir, { recursive: true });
    logger.info(`Diretório de logs criado/verificado: ${logDir}`);
  } catch (e) {
    logger.error(`Erro ao criar diretório de logs: ${e.message}`);
  }
}

async function cleanupOldLogs() {
  try {
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

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(logDir, 'trading_bot_error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      level: 'error',
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'trading_bot_combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
    }),
    new winston.transports.Console(),
  ],
});

// ================= ESTADO GLOBAL E CACHE ================= //
const state = {
  lastSignals: {},
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
  const cacheEntry = state.dataCache.get(key);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < config.CACHE_TTL) {
    logger.info(`Usando cache para ${key}`);
    return cacheEntry.data;
  }
  state.dataCache.delete(key);
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
  })).filter(c => !isNaN(c.close) && !isNaN(c.volume));
}

function calculateRSI(data, period = config.RSI_PERIOD) {
  if (!data || data.length < period + 1) return [];
  const rsi = TechnicalIndicators.RSI.calculate({
    period,
    values: data.map(d => d.close || d[4])
  });
  return rsi.filter(v => !isNaN(v));
}

function calculateCCI(ohlcv) {
  const typicalPrices = ohlcv.map(candle => (candle[2] + candle[3] + candle[4]) / 3);
  const cci = TechnicalIndicators.CCI.calculate({
    high: ohlcv.map(c => c[2]),
    low: ohlcv.map(c => c[3]),
    close: ohlcv.map(c => c[4]),
    period: config.CCI_LENGTH,
  });
  return cci;
}

function calculateEMA(data, period) {
  return TechnicalIndicators.EMA.calculate({ period, values: data });
}

function calculateSupportResistance(ohlcv, period = config.SUPPORT_RESISTANCE_LENGTH) {
  const recentCandles = ohlcv.slice(-period);
  const highs = recentCandles.map(c => c[2]);
  const lows = recentCandles.map(c => c[3]);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  return { support, resistance };
}

function calculateATR(ohlcv, period = config.ATR_LENGTH) {
  const atr = TechnicalIndicators.ATR.calculate({
    high: ohlcv.map(c => c[2]),
    low: ohlcv.map(c => c[3]),
    close: ohlcv.map(c => c[4]),
    period,
  });
  return atr;
}

function calculateVolumeAnomaly(ohlcv, lookback = config.VOLUME_LOOKBACK) {
  const volumes = ohlcv.slice(-lookback).map(c => c[5]);
  const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (lookback - 1);
  const currentVolume = volumes[volumes.length - 1];
  return currentVolume > avgVolume * config.VOLUME_MULTIPLIER;
}

function calculateVWAP(ohlcv, period = config.VWAP_PERIOD) {
  if (!ohlcv || ohlcv.length < period) return null;
  const slicedData = ohlcv.slice(-period);
  let sumPriceVolume = 0;
  let sumVolume = 0;
  for (const candle of slicedData) {
    const typicalPrice = (candle[2] + candle[3] + candle[4]) / 3;
    const volume = candle[5];
    sumPriceVolume += typicalPrice * volume;
    sumVolume += volume;
  }
  return sumVolume > 0 ? sumPriceVolume / sumVolume : null;
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
async function sendAlertCCICross(symbol, price, rsi15m, rsi1h, lsr, fundingRate, support, resistance, atr, oi5m, oi15m) {
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  // Calcular EMA 34
  const ohlcv15mRaw = getCachedData(`ohlcv_${symbol.replace('/', '')}_15m`) || [];
  const ohlcv1hRaw = getCachedData(`ohlcv_${symbol.replace('/', '')}_1h`) || [];
  const ema34 = calculateEMA(ohlcv15mRaw.map(c => c[4]), config.EMA_34_LENGTH);
  const ema34Value = ema34.length > 0 ? ema34[ema34.length - 1] : null;
  // Calcular VWAP 15m e 1h
  const vwap15m = calculateVWAP(ohlcv15mRaw, config.VWAP_PERIOD);
  const vwap1h = calculateVWAP(ohlcv1hRaw, config.VWAP_PERIOD);
  const vwap15mText = vwap15m ? `${price > vwap15m ? '📈 Acima' : '📉 Abaixo'} VWAP 15m: $${format(vwap15m)}` : '🔹 Indisp.';
  const vwap1hText = vwap1h ? `${price > vwap1h ? '📈 Acima' : '📉 Abaixo'} VWAP 1h: $${format(vwap1h)}` : '🔹 Indisp.';
  const rsi1hEmoji = rsi1h < 50 ? '🟢' : rsi1h > 70 ? '🔴' : '';
  let lsrSymbol = '🔘 Consol.';
  let lsrText = lsr.value !== null ? `${lsr.value.toFixed(2)} (${lsr.percentChange}%)` : '🔹 Indisp.';
  if (lsr.value !== null) {
    if (lsr.value <= 1.4) lsrSymbol = '✅ Baixo';
    else if (lsr.value >= 2.8) lsrSymbol = '📛 Alto';
  }
  let fundingRateEmoji = '';
  let fundingRateText = '🔹 Indisp.';
  if (fundingRate.current !== null) {
    if (fundingRate.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
    else if (fundingRate.current <= -0.001) fundingRateEmoji = '🟢🟢';
    else if (fundingRate.current <= -0.0005) fundingRateEmoji = '🟢';
    else if (fundingRate.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
    else if (fundingRate.current >= 0.0003) fundingRateEmoji = '🔴🔴';
    else if (fundingRate.current >= 0.0002) fundingRateEmoji = '🔴';
    else fundingRateEmoji = '🟢';
    fundingRateText = `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}`;
  }
  const oi5mText = oi5m ? `${oi5m.isRising ? '📈' : '📉'} OI 5m: ${oi5m.percentChange}%` : '🔹 Indisp.';
  const oi15mText = oi15m ? `${oi15m.isRising ? '📈' : '📉'} OI 15m: ${oi15m.percentChange}%` : '🔹 Indisp.';
  const tp1 = (parseFloat(price) + parseFloat(atr)).toFixed(precision);
  const tp2 = (parseFloat(price) + 2 * parseFloat(atr)).toFixed(precision);
  const tp3 = (parseFloat(price) + 4 * parseFloat(atr)).toFixed(precision);
  const tp4 = (parseFloat(price) + 6 * parseFloat(atr)).toFixed(precision);
  const slBuy = (parseFloat(price) - 2.8 * parseFloat(atr)).toFixed(precision);
  const tp1Sell = (parseFloat(price) - parseFloat(atr)).toFixed(precision);
  const tp2Sell = (parseFloat(price) - 2 * parseFloat(atr)).toFixed(precision);
  const tp3Sell = (parseFloat(price) - 4 * parseFloat(atr)).toFixed(precision);
  const tp4Sell = (parseFloat(price) - 6 * parseFloat(atr)).toFixed(precision);
  const slSell = (parseFloat(price) + 2.8 * parseFloat(atr)).toFixed(precision);
  let alertText = '';
  if (rsi1h < 55 && state.lastSignals[symbol] !== 'COMPRA' && oi5m.isRising) {
    alertText = `💹 *TENDÊNCIA BULL: ${symbol}*\n` +
                `- *Preço Atual*: $${format(price)}\n` +
                `- ${rsi1hEmoji} *RSI (1h)*: ${rsi1h.toFixed(2)}\n` +
                `- *Bullish acima de*: ${ema34Value ? format(ema34Value) : 'N/A'}\n` +
                `- *LSR*: ${lsrText} ${lsrSymbol}\n` +
                `- *Fund. Rate*: ${fundingRateText}\n` +
                `- *OI 5m*: ${oi5mText}\n` +
                `- *OI 15m*: ${oi15mText}\n` +
                `- *VWAP 15m*: ${vwap15mText}\n` +
                `- *VWAP 1h*: ${vwap1hText}\n` +
                `- *🟰Resistência*: $${format(resistance)}\n` +
                `- *➖Suporte*: $${format(support)}\n` +
                `- *⛔Stop*: $${slBuy}\n` +
                ` ☑︎ Gerencie seu Risco -🤖 @J4Rviz`;
    state.lastSignals[symbol] = 'COMPRA';
    logger.info(`Sinal de COMPRA enviado para ${symbol} (RSI subindo, volume anormal, volatilidade mínima, OI 5m subindo, preço acima do VWAP 15m, acima da EMA 34)`);
  } else if (rsi1h > 68 && state.lastSignals[symbol] !== 'VENDA' && !oi5m.isRising) {
    alertText = `🔻 *TENDÊNCIA BEAR💥: ${symbol}*\n` +
                `- *Preço Atual*: $${format(price)}\n` +
                `- ${rsi1hEmoji} *RSI (1h)*: ${rsi1h.toFixed(2)}\n` +
                `- *Bearish abaixo de*: ${ema34Value ? format(ema34Value) : 'N/A'}\n` +
                `- *LSR*: ${lsrText} ${lsrSymbol}\n` +
                `- *Fund. Rate*: ${fundingRateText}\n` +
                `- *OI 5m*: ${oi5mText}\n` +
                `- *OI 15m*: ${oi15mText}\n` +
                `- *VWAP 15m*: ${vwap15mText}\n` +
                `- *VWAP 1h*: ${vwap1hText}\n` +
                `- *🟰Resistência*: $${format(resistance)}\n` +
                `- *➖Suporte*: $${format(support)}\n` +
                `- *⛔Stop*: $${slSell}\n` +
                ` ☑︎ Gerencie seu Risco -🤖 @J4Rviz`;
    state.lastSignals[symbol] = 'VENDA';
    logger.info(`Sinal de VENDA enviado para ${symbol} (RSI descendo, volume anormal, volatilidade mínima, OI 5m caindo, preço abaixo do VWAP 15m, abaixo da EMA 34)`);
  }
  if (alertText) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info(`Alerta de CCI Cross enviado para ${symbol}: ${alertText}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta CCI para ${symbol}: ${e.message}`);
    }
  }
}

// ================= MONITORAMENTO ================= //
async function monitorCCICrossovers() {
  try {
    if (!state.isConnected) {
      await checkConnection();
      if (!state.isConnected) return;
    }
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const symbolWithSlash = symbol.replace('USDT', '/USDT');
      const cacheKeyPrefix = `ohlcv_${symbol}`;
      const ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '15m', undefined, Math.max(config.CCI_LENGTH + config.EMA_LONG_LENGTH + 1, config.SUPPORT_RESISTANCE_LENGTH, config.ATR_LENGTH, config.EMA_34_LENGTH, config.VWAP_PERIOD)));
      const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '1h', undefined, Math.max(config.RSI_PERIOD + 1, config.VWAP_PERIOD)));
      const ohlcv3mRaw = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbolWithSlash, '3m', undefined, config.VOLUME_LOOKBACK));
      const tickerRaw = getCachedData(`ticker_${symbol}`) || await withRetry(() => exchangeSpot.fetchTicker(symbolWithSlash));
      setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
      setCachedData(`${cacheKeyPrefix}_3m`, ohlcv3mRaw);
      setCachedData(`ticker_${symbol}`, tickerRaw);

      // Validação de dados
      if (!ohlcv15mRaw || ohlcv15mRaw.length < Math.max(config.CCI_LENGTH + config.EMA_LONG_LENGTH + 1, config.SUPPORT_RESISTANCE_LENGTH, config.ATR_LENGTH, config.EMA_34_LENGTH, config.VWAP_PERIOD)) {
        logger.warn(`Dados insuficientes para ${symbol} (15m)`);
        return;
      }
      if (!ohlcv1hRaw || ohlcv1hRaw.length < Math.max(config.RSI_PERIOD + 1, config.VWAP_PERIOD)) {
        logger.warn(`Dados insuficientes para ${symbol} (1h)`);
        return;
      }
      if (!ohlcv3mRaw || ohlcv3mRaw.length < config.VOLUME_LOOKBACK) {
        logger.warn(`Dados insuficientes para ${symbol} (3m)`);
        return;
      }
      if (!tickerRaw || tickerRaw.last === undefined) {
        logger.warn(`Preço não disponível para ${symbol}`);
        return;
      }

      const lsr = await fetchLSR(symbolWithSlash);
      if (lsr.error) {
        logger.warn(`Não foi possível obter LSR para ${symbol}: ${lsr.error}`);
        return;
      }
      const fundingRate = await fetchFundingRate(symbolWithSlash);
      const oi5m = await fetchOpenInterest(symbolWithSlash, '5m');
      const oi15m = await fetchOpenInterest(symbolWithSlash, '15m');
      
      const cci = calculateCCI(ohlcv15mRaw);
      if (!cci || cci.length < config.EMA_LONG_LENGTH + 1) {
        logger.warn(`CCI não calculado ou insuficiente para ${symbol} (15m)`);
        return;
      }
      
      const rsi15m = calculateRSI(ohlcv15mRaw);
      const rsi1h = calculateRSI(ohlcv1hRaw);
      if (!rsi15m || rsi15m.length < 2 || !rsi1h || rsi1h.length < 1) {
        logger.warn(`RSI não calculado para ${symbol}`);
        return;
      }
      
      const emaShort = calculateEMA(cci, config.EMA_SHORT_LENGTH);
      const emaLong = calculateEMA(cci, config.EMA_LONG_LENGTH);
      if (!emaShort || emaShort.length < 2 || !emaLong || emaLong.length < 2) {
        logger.warn(`EMAs do CCI não calculadas ou insuficientes para ${symbol}`);
        return;
      }
      
      const ema34 = calculateEMA(ohlcv15mRaw.map(c => c[4]), config.EMA_34_LENGTH);
      if (!ema34 || ema34.length < 1) {
        logger.warn(`EMA de preço (34 períodos) não calculada para ${symbol}`);
        return;
      }
      
      const { support, resistance } = calculateSupportResistance(ohlcv15mRaw);
      const atr = calculateATR(ohlcv15mRaw);
      if (!atr || atr.length < 1) {
        logger.warn(`ATR não calculado para ${symbol} (15m)`);
        return;
      }
      
      const isVolumeAnomaly = calculateVolumeAnomaly(ohlcv3mRaw);
      const price = parseFloat(tickerRaw.last);
      const atrValue = atr[atr.length - 1];
      const isMinVolatility = atrValue / price >= config.MIN_VOLATILITY;
      
      const emaShortCurrent = emaShort[emaShort.length - 1];
      const emaShortPrevious = emaShort[emaShort.length - 2];
      const emaLongCurrent = emaLong[emaLong.length - 1];
      const emaLongPrevious = emaLong[emaLong.length - 2];
      const rsi15mCurrent = rsi15m[rsi15m.length - 1];
      const rsi15mPrevious = rsi15m[rsi15m.length - 2];
      const ema34Current = ema34[ema34.length - 1];
      const currentClose = ohlcv15mRaw[ohlcv15mRaw.length - 1][4];

      // Log para depuração
      logger.info(`[${symbol}] EMA Short: ${emaShortCurrent.toFixed(2)} (anterior: ${emaShortPrevious.toFixed(2)}), EMA Long: ${emaLongCurrent.toFixed(2)} (anterior: ${emaLongPrevious.toFixed(2)}), Preço: ${currentClose.toFixed(2)}, EMA 34: ${ema34Current.toFixed(2)}`);

      // Verificação de cruzamento com validação de vela fechada
      const crossover = emaShortPrevious <= emaLongPrevious && emaShortCurrent > emaLongCurrent && ohlcv15mRaw[ohlcv15mRaw.length - 1][0] + 15 * 60 * 1000 <= Date.now();
      const crossunder = emaShortPrevious >= emaLongPrevious && emaShortCurrent < emaLongCurrent && ohlcv15mRaw[ohlcv15mRaw.length - 1][0] + 15 * 60 * 1000 <= Date.now();
      const rsiRising = rsi15mCurrent > rsi15mPrevious;
      const rsiFalling = rsi15mCurrent < rsi15mPrevious;

      if (crossover && rsiRising && isVolumeAnomaly && isMinVolatility && currentClose > ema34Current) {
        logger.info(`Cruzamento de COMPRA detectado para ${symbol}: EMA Short cruzou acima da EMA Long`);
        await sendAlertCCICross(symbolWithSlash, price, rsi15mCurrent, rsi1h[rsi1h.length - 1], lsr, fundingRate, support, resistance, atrValue, oi5m, oi15m);
      } else if (crossunder && rsiFalling && isVolumeAnomaly && isMinVolatility && currentClose < ema34Current) {
        logger.info(`Cruzamento de VENDA detectado para ${symbol}: EMA Short cruzou abaixo da EMA Long`);
        await sendAlertCCICross(symbolWithSlash, price, rsi15mCurrent, rsi1h[rsi1h.length - 1], lsr, fundingRate, support, resistance, atrValue, oi5m, oi15m);
      } else {
        logger.info(`Nenhum cruzamento de EMA detectado para ${symbol}`);
      }
    }, 5);
  } catch (e) {
    logger.error(`Erro ao processar condições de CCI: ${e.message}`);
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
    await ensureLogDir();
    await cleanupOldLogs();
    await checkConnection();
    const pairCount = config.PARES_MONITORADOS.length;
    const pairsList = pairCount > 5 ? `${config.PARES_MONITORADOS.slice(0, 5).join(', ')} e mais ${pairCount - 5} pares` : config.PARES_MONITORADOS.join(', ');
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `✅ *Titanium V8*\nMonitorando ${pairCount} pares: ${pairsList}\nCCI Crossovers`, { parse_mode: 'Markdown' }));
    await monitorCCICrossovers();
    setInterval(monitorCCICrossovers, config.INTERVALO_CCI_MS);
    setInterval(checkConnection, config.RECONNECT_INTERVAL_MS);
    setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
    state.isConnected = false;
    await reconnect();
  }
}

main().catch(e => logger.error(`Erro fatal: ${e.message}`));
bot.start();
logger.info('Bot Titanium está rodando...');
