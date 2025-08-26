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
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","), // Verifique se contém 490 pares válidos
  INTERVALO_ALERTA_3M_MS: 600000, // Aumentado para 10 minutos
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000,
  WPR_PERIOD: 14,
  WPR_LOW_THRESHOLD: -97,
  WPR_HIGH_THRESHOLD: -3,
  ATR_PERIOD: 10,
  RSI_PERIOD: 10,
  ATR_PERCENT_MIN: 0.5,
  ATR_PERCENT_MAX: 3.0,
  CACHE_TTL: 30 * 60 * 1000, // Aumentado para 30 minutos
  EMA_13_PERIOD: 13,
  EMA_34_PERIOD: 34,
  MAX_CACHE_SIZE: 3000, // Aumentado para suportar 490 pares
  MAX_HISTORICO_ALERTAS: 10,
  VOLUME_THRESHOLD_3M: 2.0,
  CCI_PERIOD: 14,
  CCI_SMA_PERIOD: 10,
  MIN_VOLUME_24H: 100000 // Volume mínimo em USDT para considerar o par ativo
};

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'quick_trading_bot.log' }),
    new winston.transports.Console()
  ]
});

// Estado global
const state = {
  ultimoAlertaPorAtivo: {},
  ultimoEstocastico: {},
  wprTriggerState: {},
  ultimoRompimento: {},
  ultimoEMACruzamento: {},
  dataCache: new Map(),
  paresValidos: new Set() // Cache para pares válidos
};

// Validação de variáveis de ambiente
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

// Inicialização do Telegram e Exchanges
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
  options: { defaultType: 'future' }
});

// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 5, delayBase = 2000) { // Aumentado delayBase
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

async function limitConcurrency(items, fn, limit = 5) { // Aumentado para 5
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    results.push(...batchResults);
    // Pausa para evitar limites de taxa
    if (i + limit < items.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return results;
}

// Verificar se o par é válido e tem liquidez suficiente
async function isValidPair(symbol) {
  if (state.paresValidos.has(symbol)) return true;
  try {
    const ticker = await withRetry(() => exchangeSpot.fetchTicker(symbol));
    if (ticker && ticker.baseVolume * ticker.last >= config.MIN_VOLUME_24H) {
      state.paresValidos.add(symbol);
      return true;
    }
    logger.warn(`Par ${symbol} tem volume insuficiente: ${ticker?.baseVolume * ticker?.last || 0} USDT`);
    return false;
  } catch (e) {
    logger.warn(`Erro ao verificar validade do par ${symbol}: ${e.message}`);
    return false;
  }
}

// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  if (!data || !Array.isArray(data)) return [];
  return data
    .map(c => ({
      time: c[0],
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    }))
    .filter(c => !isNaN(c.close) && !isNaN(c.volume) && !isNaN(c.high) && !isNaN(c.low));
}

function calculateWPR(data) {
  if (!data || data.length < config.WPR_PERIOD + 1) {
    logger.warn(`Dados insuficientes para WPR: ${data?.length || 0} velas, necessário ${config.WPR_PERIOD + 1}`);
    return [];
  }
  const wpr = TechnicalIndicators.WilliamsR.calculate({
    period: config.WPR_PERIOD,
    high: data.map(d => d.high),
    low: data.map(d => d.low),
    close: data.map(d => d.close)
  });
  return wpr.filter(v => !isNaN(v));
}

function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) {
    logger.warn(`Dados insuficientes para RSI: ${data?.length || 0} velas, necessário ${config.RSI_PERIOD + 1}`);
    return [];
  }
  const rsi = TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close)
  });
  return rsi.filter(v => !isNaN(v));
}

function calculateATR(data) {
  if (!data || data.length < config.ATR_PERIOD + 1) {
    logger.warn(`Dados insuficientes para ATR: ${data?.length || 0} velas, necessário ${config.ATR_PERIOD + 1}`);
    return [];
  }
  const atr = TechnicalIndicators.ATR.calculate({
    period: config.ATR_PERIOD,
    high: data.map(c => c.high),
    low: data.map(c => c.low),
    close: data.map(c => c.close)
  });
  return atr.filter(v => !isNaN(v));
}

function calculateStochastic(data, periodK = 5, smoothK = 3, periodD = 3) {
  if (!data || data.length < periodK + smoothK + periodD - 2) {
    logger.warn(`Dados insuficientes para Estocástico: ${data?.length || 0} velas, necessário ${periodK + smoothK + periodD - 2}`);
    return null;
  }
  const highs = data.map(c => c.high).filter(h => !isNaN(h));
  const lows = data.map(c => c.low).filter(l => !isNaN(l));
  const closes = data.map(c => c.close).filter(cl => !isNaN(cl));
  if (highs.length < periodK || lows.length < periodK || closes.length < periodK) {
    logger.warn(`Dados inválidos para Estocástico: highs=${highs.length}, lows=${lows.length}, closes=${closes.length}`);
    return null;
  }
  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: periodK,
    signalPeriod: periodD,
    smoothing: smoothK
  });
  return result.length ? { k: parseFloat(result[result.length - 1].k.toFixed(2)), d: parseFloat(result[result.length - 1].d.toFixed(2)) } : null;
}

function calculateEMA(data, period) {
  if (!data || data.length < period) {
    logger.warn(`Dados insuficientes para EMA${period}: ${data?.length || 0} velas, necessário ${period}`);
    return [];
  }
  const ema = TechnicalIndicators.EMA.calculate({
    period: period,
    values: data.map(d => d.close)
  });
  return ema.filter(v => !isNaN(v));
}

function calculateCCI(data, period) {
  if (!data || data.length < period + 1) {
    logger.warn(`Dados insuficientes para CCI: ${data?.length || 0} velas, necessário ${period + 1}`);
    return [];
  }
  const typicalPrice = data.map(c => (c.high + c.low + c.close) / 3);
  const sma = TechnicalIndicators.SMA.calculate({
    period: period,
    values: typicalPrice
  });
  const meanDeviation = data.slice(period - 1).map((c, i) => {
    const tp = typicalPrice[i + period - 1];
    const currentSma = sma[i];
    const deviations = data.slice(i, i + period).map(d => Math.abs((d.high + d.low + d.close) / 3 - currentSma));
    return deviations.reduce((sum, dev) => sum + dev, 0) / period;
  });
  const cci = sma.map((s, i) => {
    const tp = typicalPrice[i + period - 1];
    const md = meanDeviation[i];
    return md !== 0 ? (tp - s) / (0.015 * md) : 0;
  });
  return cci.filter(v => !isNaN(v));
}

function calculateCCISMA(cci, period) {
  if (!cci || cci.length < period) {
    logger.warn(`Dados insuficientes para CCI SMA: ${cci?.length || 0} valores, necessário ${period}`);
    return [];
  }
  return TechnicalIndicators.SMA.calculate({
    period: period,
    values: cci
  });
}

function calculateVolumeProfile(ohlcv, priceStepPercent = 0.1) {
  if (!ohlcv || ohlcv.length < 2) return { buyLiquidityZones: [], sellLiquidityZones: [] };
  const priceRange = Math.max(...ohlcv.map(c => c.high)) - Math.min(...ohlcv.map(c => c.low));
  const step = priceRange * priceStepPercent / 100;
  const volumeProfile = {};
  ohlcv.forEach(candle => {
    const price = (candle.high + candle.low) / 2;
    if (isNaN(price) || isNaN(candle.volume)) return;
    const bucket = Math.floor(price / step) * step;
    volumeProfile[bucket] = (volumeProfile[bucket] || 0) + candle.volume;
  });
  const sortedBuckets = Object.entries(volumeProfile)
    .sort(([, volA], [, volB]) => volB - volA)
    .slice(0, 3)
    .map(([price]) => parseFloat(price));
  return {
    buyLiquidityZones: sortedBuckets.filter(p => p <= ohlcv[ohlcv.length - 1].close).sort((a, b) => b - a),
    sellLiquidityZones: sortedBuckets.filter(p => p > ohlcv[ohlcv.length - 1].close).sort((a, b) => a - b)
  };
}

function calculateAbnormalVolume(ohlcv3m) {
  if (!ohlcv3m || ohlcv3m.length < 10) return { isAbnormal: false, volumeRatio: 0 };
  const volumes = ohlcv3m.map(c => c.volume).filter(v => !isNaN(v));
  if (volumes.length < 10) return { isAbnormal: false, volumeRatio: 0 };
  const avgVolume = volumes.slice(1).reduce((sum, v) => sum + v, 0) / (volumes.length - 1);
  const currentVolume = volumes[0];
  const volumeRatio = avgVolume !== 0 ? currentVolume / avgVolume : 0;
  return {
    isAbnormal: volumeRatio > config.VOLUME_THRESHOLD_3M,
    volumeRatio: volumeRatio.toFixed(2)
  };
}

async function fetchLiquidityZones(symbol) {
  const cacheKey = `liquidity_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const orderBook = await withRetry(() => exchangeSpot.fetchOrderBook(symbol, 20));
    const bids = orderBook.bids;
    const asks = orderBook.asks;
    const liquidityThreshold = 0.5;
    const totalBidVolume = bids.reduce((sum, [, vol]) => sum + vol, 0);
    const totalAskVolume = asks.reduce((sum, [, vol]) => sum + vol, 0);
    const buyLiquidityZones = bids
      .filter(([price, volume]) => volume >= totalBidVolume * liquidityThreshold)
      .map(([price]) => price);
    const sellLiquidityZones = asks
      .filter(([price, volume]) => volume >= totalAskVolume * liquidityThreshold)
      .map(([price]) => price);
    const result = { buyLiquidityZones, sellLiquidityZones };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    logger.error(`Erro ao buscar zonas de liquidez para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { buyLiquidityZones: [], sellLiquidityZones: [] };
  }
}

async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    }));
    if (!res.data || res.data.length < 2) {
      logger.warn(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00' };
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const previousLSR = parseFloat(res.data[1].longShortRatio);
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, isRising: currentLSR > previousLSR, percentChange };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00' };
  }
}

async function fetchOpenInterest(symbol, timeframe, retries = 5) {
  const cacheKey = `oi_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const oiData = await withRetry(() => exchangeFutures.fetchOpenInterestHistory(symbol, timeframe, undefined, 100)); // Aumentado para 100
    if (!oiData || oiData.length < 3) {
      logger.warn(`Dados insuficientes de Open Interest para ${symbol} no timeframe ${timeframe}: ${oiData?.length || 0} registros`);
      if (retries > 0) {
        const delay = Math.pow(2, 5 - retries) * 2000;
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
        const delay = Math.pow(2, 5 - retries) * 2000;
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
    const recentOi = validOiData.slice(0, 3).map(d => d.openInterest).filter(v => v !== undefined);
    const sma = recentOi.reduce((sum, val) => sum + val, 0) / recentOi.length;
    const previousRecentOi = validOiData.slice(3, 6).map(d => d.openInterest);
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

async function calculateAggressiveDelta(symbol, timeframe = '3m', limit = 100) {
  const cacheKey = `delta_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const trades = await withRetry(() => exchangeSpot.fetchTrades(symbol, undefined, limit));
    let buyVolume = 0;
    let sellVolume = 0;
    const volumes = trades.map(trade => trade.amount).filter(amount => !isNaN(amount));
    const avgVolume = volumes.length > 0 ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : 0;
    const minVolumeThreshold = avgVolume * 0.001;
    for (const trade of trades) {
      const { side, amount, price } = trade;
      if (!side || !amount || !price || isNaN(amount) || isNaN(price) || amount < minVolumeThreshold) continue;
      if (side === 'buy') buyVolume += amount;
      else if (side === 'sell') sellVolume += amount;
    }
    const totalVolume = buyVolume + sellVolume;
    if (totalVolume === 0) {
      logger.warn(`Volume total zero para ${symbol}, retornando delta neutro`);
      return { delta: 0, deltaPercent: 0, isBuyPressure: false, isSignificant: false };
    }
    const delta = buyVolume - sellVolume;
    const deltaPercent = (delta / totalVolume * 100).toFixed(2);
    const result = {
      delta,
      deltaPercent: parseFloat(deltaPercent),
      isBuyPressure: delta > 0,
      isSignificant: Math.abs(deltaPercent) > 10
    };
    setCachedData(cacheKey, result);
    logger.info(`Delta Agressivo para ${symbol}: Buy=${buyVolume}, Sell=${sellVolume}, Delta=${delta}, Delta%=${deltaPercent}%, MinVolumeThreshold=${minVolumeThreshold}`);
    return result;
  } catch (e) {
    logger.error(`Erro ao calcular Delta Agressivo para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { delta: 0, deltaPercent: 0, isBuyPressure: false, isSignificant: false };
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

async function sendAlert1h2h(symbol, data) {
  const { ohlcv15m, ohlcv3m, ohlcv1h, ohlcvDiario, ohlcv4h, price, wpr2h, wpr1h, rsi1h, atr, lsr, volumeProfile, orderBookLiquidity, isOIRising5m, estocasticoD, estocastico4h, fundingRate, oi15m, ema13_3m, ema34_3m, previousEma13_3m, previousEma34_3m, cci15m, cciSma15m, previousCci15m, previousCciSma15m } = data;
  const agora = Date.now();
  if (state.ultimoAlertaPorAtivo[symbol]?.['1h_2h'] && agora - state.ultimoAlertaPorAtivo[symbol]['1h_2h'] < config.TEMPO_COOLDOWN_MS) return;
  const aggressiveDelta = await calculateAggressiveDelta(symbol);
  const volumeCheck = calculateAbnormalVolume(ohlcv3m);
  const atrPercent = (atr / price) * 100;
  if (!state.wprTriggerState[symbol]) state.wprTriggerState[symbol] = { '1h_2h': { buyTriggered: false, sellTriggered: false } };
  if (wpr2h <= config.WPR_LOW_THRESHOLD && wpr1h <= config.WPR_LOW_THRESHOLD) {
    state.wprTriggerState[symbol]['1h_2h'].buyTriggered = true;
  } else if (wpr2h >= config.WPR_HIGH_THRESHOLD && wpr1h >= config.WPR_HIGH_THRESHOLD) {
    state.wprTriggerState[symbol]['1h_2h'].sellTriggered = true;
  }
  if (!state.ultimoEstocastico[symbol]) state.ultimoEstocastico[symbol] = {};
  const kAnteriorD = state.ultimoEstocastico[symbol].kD || estocasticoD?.k || 0;
  const kAnterior4h = state.ultimoEstocastico[symbol].k4h || estocastico4h?.k || 0;
  state.ultimoEstocastico[symbol].kD = estocasticoD?.k;
  state.ultimoEstocastico[symbol].k4h = estocastico4h?.k;
  const direcaoD = getSetaDirecao(estocasticoD?.k, kAnteriorD);
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stochDEmoji = estocasticoD ? getStochasticEmoji(estocasticoD.k) : "";
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const entryLow = format(price - 0.3 * atr);
  const entryHigh = format(price + 0.5 * atr);
  const isCciCrossover = cci15m !== undefined && cciSma15m !== undefined && previousCci15m !== undefined && previousCciSma15m !== undefined 
    ? cci15m > cciSma15m && previousCci15m <= previousCciSma15m 
    : false;
  const isCciCrossunder = cci15m !== undefined && cciSma15m !== undefined && previousCci15m !== undefined && previousCciSma15m !== undefined 
    ? cci15m < cciSma15m && previousCci15m >= previousCciSma15m 
    : false;
  const isBuySignal = state.wprTriggerState[symbol]['1h_2h'].buyTriggered && 
                      isOIRising5m && 
                      ema13_3m > ema34_3m && 
                      previousEma13_3m <= previousEma34_3m &&
                      volumeCheck.isAbnormal &&
                      (isCciCrossover || cci15m === undefined);
  const isSellSignal = state.wprTriggerState[symbol]['1h_2h'].sellTriggered && 
                      !isOIRising5m && 
                      ema13_3m < ema34_3m && 
                      previousEma13_3m >= previousEma34_3m &&
                      volumeCheck.isAbnormal &&
                      (isCciCrossunder || cci15m === undefined);
  const targets = isSellSignal
    ? [2, 4, 6, 8].map(mult => format(price - mult * atr)).join(" / ")
    : [2, 4, 6, 8].map(mult => format(price + mult * atr)).join(" / ");
  const stop = isSellSignal ? format(price + 5.0 * atr) : format(price - 5.0 * atr);
  const buyZonesText = volumeProfile.buyLiquidityZones.map(format).join(' / ') || 'N/A';
  const sellZonesText = volumeProfile.sellLiquidityZones.map(format).join(' / ') || 'N/A';
  const obBuyZonesText = orderBookLiquidity.buyLiquidityZones.map(format).join(' / ') || 'N/A';
  const obSellZonesText = orderBookLiquidity.sellLiquidityZones.map(format).join(' / ') || 'N/A';
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    if (lsr.value <= 1.4) lsrSymbol = '✅Baixo';
    else if (lsr.value >= 2.8) lsrSymbol = '📛Alto';
  }
  const rsi1hEmoji = rsi1h > 60 ? "☑︎" : rsi1h < 40 ? "☑︎" : "";
  let fundingRateEmoji = '';
  if (fundingRate.current !== null) {
    if (fundingRate.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
    else if (fundingRate.current <= -0.001) fundingRateEmoji = '🟢🟢';
    else if (fundingRate.current <= -0.0005) fundingRateEmoji = '🟢';
    else if (fundingRate.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
    else if (fundingRate.current >= 0.0003) fundingRateEmoji = '🔴🔴';
    else if (fundingRate.current >= 0.0002) fundingRateEmoji = '🔴';
    else fundingRateEmoji = '🟢';
  }
  const fundingRateText = fundingRate.current !== null 
    ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}%  ${fundingRate.isRising ? '⬆️' : '⬇️'}`
    : '🔹 Indisp.';
  const deltaText = aggressiveDelta.isSignificant 
    ? `${aggressiveDelta.isBuyPressure ? '💹F.Comprador' : '⭕F.Vendedor'} ${aggressiveDelta.deltaPercent > 60 && lsr.value !== null && lsr.value < 1 ? '💥' : ''}(${aggressiveDelta.deltaPercent}%)`
    : '🔘Neutro';
  const volumeText = volumeCheck.isAbnormal ? `📈Vol.Anormal (${volumeCheck.volumeRatio}x)` : '🔘Vol.Normal';
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
  const cciText = cci15m !== undefined && cciSma15m !== undefined ? `${cci15m.toFixed(2)} (SMA: ${cciSma15m.toFixed(2)})` : 'N/A';
  
  let alertText = `🔹Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
    `💲 Preço: ${format(price)}\n` +
    `🔹 RSI 1h: ${rsi1h !== undefined ? rsi1h.toFixed(2) : 'N/A'} ${rsi1hEmoji}\n` +
    `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
    `🔹 Fund. R: ${fundingRateText}\n` +
    `🔸 Vol.Delta: ${deltaText}\n` +
    `🔸 Volume 3m: ${volumeText}\n` +
    `🔹 Stoch Diário %K: ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
    `🔹 Stoch 4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
    `🔹 CCI 15m: ${cciText}\n` +
    `☑︎ Monitor WPR 🤖 @J4Rviz\n`;
  if (isBuySignal) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `🟩*WPR/CCI -✳️Compra/Reversão✳️*\n\n${alertText}`, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = {};
      state.ultimoAlertaPorAtivo[symbol]['1h_2h'] = agora;
      state.wprTriggerState[symbol]['1h_2h'].buyTriggered = false;
    } catch (e) {
      logger.error(`Erro ao enviar alerta de compra para ${symbol}: ${e.message}`);
    }
  } else if (isSellSignal) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `🟥*WPR/CCI -🔻Correção/Exaustão🔻*\n\n${alertText}`, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = {};
      state.ultimoAlertaPorAtivo[symbol]['1h_2h'] = agora;
      state.wprTriggerState[symbol]['1h_2h'].sellTriggered = false;
    } catch (e) {
      logger.error(`Erro ao enviar alerta de correção para ${symbol}: ${e.message}`);
    }
  }
}

async function checkConditions() {
  try {
    const validPairs = [];
    for (const symbol of config.PARES_MONITORADOS) {
      if (await isValidPair(symbol)) {
        validPairs.push(symbol);
      }
    }
    logger.info(`Pares válidos para processamento: ${validPairs.length}/${config.PARES_MONITORADOS.length}`);
    let successCount = 0;
    await limitConcurrency(validPairs, async (symbol) => {
      const cacheKeyPrefix = `ohlcv_${symbol}`;
      // Solicitar 100 velas para todos os timeframes
      const ohlcv3mRawFutures = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 100));
      const ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 100));
      const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 100));
      const ohlcv2hRaw = getCachedData(`${cacheKeyPrefix}_2h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '2h', undefined, 100));
      const ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 100));
      const ohlcvDiarioRaw = getCachedData(`${cacheKeyPrefix}_1d`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 100));
      logger.info(`Dados OHLCV para ${symbol}: 3m=${ohlcv3mRawFutures?.length || 0}, 15m=${ohlcv15mRaw?.length || 0}, 1h=${ohlcv1hRaw?.length || 0}, 2h=${ohlcv2hRaw?.length || 0}, 4h=${ohlcv4hRaw?.length || 0}, 1d=${ohlcvDiarioRaw?.length || 0}`);
      if (!ohlcv3mRawFutures || !ohlcv15mRaw || !ohlcv1hRaw || !ohlcv2hRaw || !ohlcv4hRaw || !ohlcvDiarioRaw) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}, pulando...`);
        return;
      }
      const ohlcv3m = normalizeOHLCV(ohlcv3mRawFutures);
      const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const ohlcv2h = normalizeOHLCV(ohlcv2hRaw);
      const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
      const ohlcvDiario = normalizeOHLCV(ohlcvDiarioRaw);
      logger.info(`Dados normalizados para ${symbol}: 3m=${ohlcv3m.length}, 15m=${ohlcv15m.length}, 1h=${ohlcv1h.length}, 2h=${ohlcv2h.length}, 4h=${ohlcv4h.length}, 1d=${ohlcvDiario.length}`);
      const closes3m = ohlcv3m.map(c => c.close).filter(c => !isNaN(c));
      const currentPrice = closes3m[closes3m.length - 1];
      if (isNaN(currentPrice)) {
        logger.warn(`Preço atual inválido para ${symbol}, pulando...`);
        return;
      }
      const wpr2hValues = calculateWPR(ohlcv2h);
      const wpr1hValues = calculateWPR(ohlcv1h);
      const rsi1hValues = calculateRSI(ohlcv1h);
      const lsr = await fetchLSR(symbol);
      const oi5m = await fetchOpenInterest(symbol, '5m');
      const oi15m = await fetchOpenInterest(symbol, '15m');
      const fundingRate = await fetchFundingRate(symbol);
      const atrValues = calculateATR(ohlcv15m);
      const volumeProfile = calculateVolumeProfile(ohlcv15m);
      const estocasticoD = calculateStochastic(ohlcvDiario, 5, 3, 3);
      const estocastico4h = calculateStochastic(ohlcv4h, 5, 3, 3);
      const ema13_3mValues = calculateEMA(ohlcv3m, config.EMA_13_PERIOD);
      const ema34_3mValues = calculateEMA(ohlcv3m, config.EMA_34_PERIOD);
      const cci15mValues = calculateCCI(ohlcv15m, config.CCI_PERIOD);
      const cciSma15mValues = calculateCCISMA(cci15mValues, config.CCI_SMA_PERIOD);
      logger.info(`Indicadores para ${symbol}: WPR2h=${wpr2hValues.length}, WPR1h=${wpr1hValues.length}, RSI1h=${rsi1hValues.length}, ATR=${atrValues.length}, EMA13_3m=${ema13_3mValues.length}, EMA34_3m=${ema34_3mValues.length}, CCI15m=${cci15mValues.length}, CCISMA15m=${cciSma15mValues.length}`);
      // Indicadores obrigatórios
      if (!wpr2hValues.length || !wpr1hValues.length || !rsi1hValues.length || !atrValues.length || !ema13_3mValues.length || !ema34_3mValues.length) {
        logger.warn(`Indicadores obrigatórios insuficientes para ${symbol}, pulando...`);
        return;
      }
      const cci15m = cci15mValues.length ? cci15mValues[cci15mValues.length - 1] : undefined;
      const cciSma15m = cciSma15mValues.length ? cciSma15mValues[cciSma15mValues.length - 1] : undefined;
      const previousCci15m = cci15mValues.length > 1 ? cci15mValues[cci15mValues.length - 2] : undefined;
      const previousCciSma15m = cciSma15mValues.length > 1 ? cciSma15mValues[cciSma15mValues.length - 2] : undefined;
      await sendAlert1h2h(symbol, {
        ohlcv15m, ohlcv3m, ohlcv1h, ohlcvDiario, ohlcv4h,
        price: currentPrice,
        wpr2h: wpr2hValues[wpr2hValues.length - 1],
        wpr1h: wpr1hValues[wpr1hValues.length - 1],
        rsi1h: rsi1hValues[rsi1hValues.length - 1],
        atr: atrValues[atrValues.length - 1],
        lsr,
        volumeProfile,
        orderBookLiquidity: await fetchLiquidityZones(symbol),
        isOIRising5m: oi5m.isRising,
        estocasticoD,
        estocastico4h,
        fundingRate,
        oi15m,
        ema13_3m: ema13_3mValues[ema13_3mValues.length - 1],
        ema34_3m: ema34_3mValues[ema34_3mValues.length - 1],
        previousEma13_3m: ema13_3mValues[ema13_3mValues.length - 2] || 0,
        previousEma34_3m: ema34_3mValues[ema34_3mValues.length - 2] || 0,
        cci15m,
        cciSma15m,
        previousCci15m,
        previousCciSma15m
      });
      successCount++;
    });
    logger.info(`Ciclo concluído: ${successCount}/${validPairs.length} pares processados com sucesso`);
  } catch (e) {
    logger.error(`Erro ao processar condições: ${e.message}`);
  }
}

// Função de reconexão
async function reconectar() {
  const maxTentativas = 5;
  const delayBase = 5000;
  let isOnline = false;

  while (!isOnline) {
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      try {
        await exchangeSpot.fetchTime();
        logger.info('Conexão com a internet estabelecida.');
        isOnline = true;
        break;
      } catch (e) {
        logger.error(`Falha na conexão, tentativa ${tentativa}/${maxTentativas}: ${e.message}`);
        if (tentativa === maxTentativas) {
          logger.warn('Máximo de tentativas de reconexão atingido. Aguardando antes de novo ciclo...');
          await new Promise(resolve => setTimeout(resolve, delayBase * 2));
          break;
        }
        const delay = Math.pow(2, tentativa - 1) * delayBase;
        logger.info(`Aguardando ${delay}ms antes da próxima tentativa de reconexão...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return isOnline;
}

// Inicializar pares válidos
async function initializeValidPairs() {
  const validPairs = [];
  await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
    if (await isValidPair(symbol)) {
      validPairs.push(symbol);
    }
  }, 10);
  logger.info(`Inicialização concluída: ${validPairs.length}/${config.PARES_MONITORADOS.length} pares válidos`);
  return validPairs;
}

async function main() {
  logger.info('Iniciando scalp');
  try {
    await reconectar();
    // Inicializar pares válidos
    config.PARES_MONITORADOS = await initializeValidPairs();
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `🤖 Titanium WPR/CCI 💹Start... ${config.PARES_MONITORADOS.length} pares válidos`));
    await checkConditions();
    setInterval(async () => {
      try {
        await reconectar();
        await checkConditions();
      } catch (e) {
        logger.error(`Erro no ciclo de verificação: ${e.message}`);
        logger.info('Tentando reconectar...');
        await reconectar();
      }
    }, config.INTERVALO_ALERTA_3M_MS);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
    logger.info('Tentando reconectar...');
    await reconectar();
    setTimeout(main, 5000);
  }
}

main().catch(e => {
  logger.error(`Erro fatal: ${e.message}`);
  setTimeout(main, 10000);
});