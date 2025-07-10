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
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_ALERTA_STOCHASTIC_MS: 15 * 60 * 1000, // 15 minutos para alertas estocásticos
  INTERVALO_ALERTA_MONITOR_MS: 15 * 60 * 1000, // 15 minutos para alertas de monitoramento
  TEMPO_COOLDOWN_STOCHASTIC_MS: 30 * 60 * 1000, // 30 minutos para cooldown estocástico
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 75, // Limite máximo para compra (4h e Diário)
  STOCHASTIC_SELL_MIN: 20, // Limite mínimo para venda (4h e Diário)
  LSR_BUY_MAX: 2.7, // Limite máximo de LSR para compra (estocástico)
  LSR_SELL_MIN: 2.7, // Limite mínimo de LSR para venda (estocástico)
  DELTA_BUY_MIN: 5, // Limite mínimo de Delta Agressivo para compra (%)
  DELTA_SELL_MAX: -10, // Limite máximo de Delta Agressivo para venda (%)
  ATR_PERIOD: 14, // Período para cálculo do ATR
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
  MAX_CACHE_SIZE: 100,
  LIMIT_TRADES_DELTA: 100, // Limite de trades para Volume Delta
  MIN_VOLUME_USDT: 1000000, // Volume mínimo em USDT para filtro de liquidez
  MIN_OPEN_INTEREST: 500000, // Open Interest mínimo em USDT
  VOLUME_SPIKE_THRESHOLD: 2, // 200% de aumento no volume
  FUNDING_RATE_CHANGE_THRESHOLD: 0.005, // Mudança de 0.5% no funding rate
  LSR_STAR_MAX: 2.5, // Limite máximo de LSR para estrela
  LSR_SKULL_MIN: 2.8, // Limite mínimo de LSR para caveira
  HEARTBEAT_INTERVAL_MS: 60 * 60 * 1000 // 1 hora
};

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'combined_trading_bot.log' }),
    new winston.transports.Console()
  ]
});

// Estado global
const state = {
  ultimoAlertaPorAtivo: {}, // Para alertas estocásticos
  ultimoEstocastico: {}, // Para rastrear %K anterior
  dataCache: new Map(), // Cache geral
  lastFundingRates: new Map(), // Cache para funding rates anteriores (monitor)
  monitorHistorico: new Map() // Histórico para alertas de monitoramento
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
}

function clearOldCache() {
  const now = Date.now();
  for (const [key, entry] of state.dataCache) {
    if (now - entry.timestamp > config.CACHE_TTL) {
      state.dataCache.delete(key);
      logger.info(`Cache removido: ${key}`);
    }
  }
}
setInterval(clearOldCache, 60 * 60 * 1000); // Limpa a cada hora

async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    results.push(...batchResults);
  }
  return results;
}

// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  if (!data || !Array.isArray(data)) return [];
  return data.map(c => ({
    time: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  })).filter(c => !isNaN(c.close) && !isNaN(c.volume));
}

function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) {
    logger.warn(`Dados insuficientes para calcular RSI: ${data?.length || 0} velas disponíveis`);
    return null;
  }
  const rsi = TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close || d[4])
  });
  return rsi.length ? parseFloat(rsi[rsi.length - 1].toFixed(2)) : null;
}

function calculateStochastic(data) {
  if (!data || data.length < config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2) {
    logger.warn(`Dados insuficientes para calcular Estocástico: ${data?.length || 0} velas disponíveis`);
    return { k: null, d: null, previousK: null };
  }
  const highs = data.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = data.map(c => c.low || c[3]).filter(l => !isNaN(l));
  const closes = data.map(c => c.close || c[4]).filter(cl => !isNaN(cl));
  if (highs.length < config.STOCHASTIC_PERIOD_K || lows.length < config.STOCHASTIC_PERIOD_K || closes.length < config.STOCHASTIC_PERIOD_K) {
    return { k: null, d: null, previousK: null };
  }
  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: config.STOCHASTIC_PERIOD_K,
    signalPeriod: config.STOCHASTIC_PERIOD_D,
    smoothing: config.STOCHASTIC_SMOOTH_K
  });
  if (result.length < 2) {
    logger.warn(`Resultados insuficientes para Estocástico: ${result.length} períodos calculados`);
    return { k: null, d: null, previousK: null };
  }
  return {
    k: parseFloat(result[result.length - 1].k.toFixed(2)),
    d: parseFloat(result[result.length - 1].d.toFixed(2)),
    previousK: parseFloat(result[result.length - 2].k.toFixed(2))
  };
}

function calculateATR(data) {
  if (!data || data.length < config.ATR_PERIOD + 1) {
    logger.warn(`Dados insuficientes para calcular ATR: ${data?.length || 0} velas disponíveis`);
    return null;
  }
  const atr = TechnicalIndicators.ATR.calculate({
    period: config.ATR_PERIOD,
    high: data.map(d => d.high || d[2]),
    low: data.map(c => c.low || c[3]),
    close: data.map(c => c.close || c[4])
  });
  return atr.length ? parseFloat(atr[atr.length - 1].toFixed(8)) : null;
}

function detectarQuebraEstrutura(ohlcv) {
  if (!ohlcv || ohlcv.length < 2) return { estruturaAlta: 0, estruturaBaixa: 0, buyLiquidityZones: [], sellLiquidityZones: [] };
  const lookbackPeriod = 20;
  const previousCandles = ohlcv.slice(0, -1).slice(-lookbackPeriod);
  const highs = previousCandles.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = previousCandles.map(c => c.low || c[3]).filter(l => !isNaN(l));
  const volumes = previousCandles.map(c => c.volume || c[5]).filter(v => !isNaN(v));
  if (highs.length === 0 || lows.length === 0 || volumes.length === 0) {
    return { estruturaAlta: 0, estruturaBaixa: 0, buyLiquidityZones: [], sellLiquidityZones: [] };
  }
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const volumeThreshold = Math.max(...volumes) * 0.7;
  const buyLiquidityZones = [];
  const sellLiquidityZones = [];
  previousCandles.forEach(candle => {
    const high = candle.high || candle[2];
    const low = candle.low || candle[3];
    const volume = candle.volume || candle[5];
    if (volume >= volumeThreshold && !isNaN(low) && !isNaN(high)) {
      if (low <= minLow * 1.01) buyLiquidityZones.push(low);
      if (high >= maxHigh * 0.99) sellLiquidityZones.push(high);
    }
  });
  return {
    estruturaAlta: maxHigh,
    estruturaBaixa: minLow,
    buyLiquidityZones: [...new Set(buyLiquidityZones)].sort((a, b) => b - a).slice(0, 3),
    sellLiquidityZones: [...new Set(sellLiquidityZones)].sort((a, b) => a - b).slice(0, 3)
  };
}

function calculateVolumeProfile(ohlcv, priceStepPercent = 0.1) {
  if (!ohlcv || ohlcv.length < 2) return { buyLiquidityZones: [], sellLiquidityZones: [] };
  const priceRange = Math.max(...ohlcv.map(c => c.high || c[2])) - Math.min(...ohlcv.map(c => c.low || c[3]));
  const step = priceRange * priceStepPercent / 100;
  const volumeProfile = {};
  ohlcv.forEach(candle => {
    const price = ((candle.high || candle[2]) + (candle.low || candle[3])) / 2;
    if (isNaN(price) || isNaN(candle.volume || candle[5])) return;
    const bucket = Math.floor(price / step) * step;
    volumeProfile[bucket] = (volumeProfile[bucket] || 0) + (candle.volume || candle[5]);
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
      return { value: null, isRising: false, percentChange: '0.00' };
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
      const result = { current: currentFunding * 100, isRising: currentFunding > previousFunding, percentChange };
      setCachedData(cacheKey, result);
      state.lastFundingRates.set(symbol, result.current);
      return result;
    }
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
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
      if (timeframe === '15m') {
        logger.info(`Fallback para timeframe 30m para ${symbol}`);
        return await fetchOpenInterest(symbol, '30m', 3);
      }
      return { isRising: false, value: null, percentChange: '0.00' };
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
      if (timeframe === '15m') {
        logger.info(`Fallback para timeframe 30m para ${symbol}`);
        return await fetchOpenInterest(symbol, '30m', 3);
      }
      return { isRising: false, value: null, percentChange: '0.00' };
    }
    const oiValues = validOiData.map(d => d.openInterest).filter(v => v !== undefined);
    const sortedOi = [...oiValues].sort((a, b) => a - b);
    const median = sortedOi[Math.floor(sortedOi.length / 2)];
    const filteredOiData = validOiData.filter(d => d.openInterest >= median * 0.5 && d.openInterest <= median * 1.5);
    if (filteredOiData.length < 3) {
      logger.warn(`Registros válidos após filtro de outliers insuficientes para ${symbol} no timeframe ${timeframe}: ${filteredOiData.length}`);
      if (retries > 0) {
        const delay = Math.pow(2, 5 - retries) * 1000;
        logger.info(`Tentando novamente para ${symbol} no timeframe ${timeframe}, tentativas restantes: ${retries}, delay: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '15m') {
        logger.info(`Fallback para timeframe 30m para ${symbol}`);
        return await fetchOpenInterest(symbol, '30m', 3);
      }
      return { isRising: false, value: null, percentChange: '0.00' };
    }
    const recentOi = filteredOiData.slice(0, 3).map(d => d.openInterest);
    const sma = recentOi.reduce((sum, val) => sum + val, 0) / recentOi.length;
    const previousRecentOi = filteredOiData.slice(3, 6).map(d => d.openInterest);
    const previousSma = previousRecentOi.length >= 3 ? previousRecentOi.reduce((sum, val) => sum + val, 0) / previousRecentOi.length : recentOi[recentOi.length - 1];
    const oiPercentChange = previousSma !== 0 ? ((sma - previousSma) / previousSma * 100).toFixed(2) : '0.00';
    const result = {
      isRising: sma > previousSma,
      value: parseFloat(sma.toFixed(2)),
      percentChange: oiPercentChange
    };
    setCachedData(cacheKey, result);
    logger.info(`Open Interest calculado para ${symbol} no timeframe ${timeframe}: sma=${sma}, previousSma=${previousSma}, percentChange=${oiPercentChange}%`);
    return result;
  } catch (e) {
    if (e.message.includes('binance does not have market symbol') || e.message.includes('Invalid symbol')) {
      logger.error(`Símbolo ${symbol} não suportado para Open Interest no timeframe ${timeframe}. Ignorando.`);
      return { isRising: false, value: null, percentChange: '0.00' };
    }
    logger.warn(`Erro ao buscar Open Interest para ${symbol} no timeframe ${timeframe}: ${e.message}`);
    return getCachedData(cacheKey) || { isRising: false, value: null, percentChange: '0.00' };
  }
}

async function calculateAggressiveDelta(symbol, exchange = exchangeSpot) {
  const cacheKey = `delta_${symbol}_${exchange.options.defaultType}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const trades = await withRetry(() => exchange.fetchTrades(symbol, undefined, config.LIMIT_TRADES_DELTA));
    let buyVolume = 0;
    let sellVolume = 0;
    for (const trade of trades) {
      const { side, amount, price } = trade;
      if (!side || !amount || !price || isNaN(amount) || isNaN(price)) continue;
      if (side === 'buy') buyVolume += amount;
      else if (side === 'sell') sellVolume += amount;
    }
    const delta = buyVolume - sellVolume;
    const totalVolume = buyVolume + sellVolume;
    const deltaPercent = totalVolume !== 0 ? parseFloat((delta / totalVolume * 100).toFixed(2)) : 0;
    const result = {
      delta,
      deltaPercent,
      isBuyPressure: delta > 0,
      isSignificant: Math.abs(deltaPercent) > 10
    };
    setCachedData(cacheKey, result);
    logger.info(`Delta Agressivo para ${symbol} (${exchange.options.defaultType}): Buy=${buyVolume}, Sell=${sellVolume}, Delta%=${deltaPercent}%`);
    return result;
  } catch (e) {
    logger.error(`Erro ao calcular Delta Agressivo para ${symbol} (${exchange.options.defaultType}): ${e.message}`);
    return getCachedData(cacheKey) || { delta: 0, deltaPercent: 0, isBuyPressure: false, isSignificant: false };
  }
}

async function detectVolumeSpike(symbol, timeframe = '15m') {
  try {
    const ohlcv = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, timeframe, undefined, 3));
    const volumes = normalizeOHLCV(ohlcv).map(d => d.volume);
    if (volumes.length < 2) return false;
    const spike = volumes[volumes.length - 1] / volumes[volumes.length - 2] > config.VOLUME_SPIKE_THRESHOLD;
    if (spike) {
      logger.info(`Pico de volume detectado em ${symbol}: ${volumes[volumes.length - 1]} vs ${volumes[volumes.length - 2]}`);
      return true;
    }
    return false;
  } catch (e) {
    logger.warn(`Erro ao detectar pico de volume para ${symbol}: ${e.message}`);
    return false;
  }
}

async function detectFundingRateChange(symbol, currentFundingRate) {
  const lastFundingRate = state.lastFundingRates.get(symbol) || currentFundingRate;
  const change = Math.abs(currentFundingRate - lastFundingRate);
  const isSignificantChange = change >= config.FUNDING_RATE_CHANGE_THRESHOLD;
  if (isSignificantChange) {
    logger.info(`Mudança significativa no Funding Rate para ${symbol}: ${lastFundingRate}% -> ${currentFundingRate}%`);
  }
  return isSignificantChange;
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

function calculateRiskReward(coin, isBuy) {
  if (coin.atr === null || coin.atr === 'N/A') return 'N/A';
  const entry = coin.price;
  const atrMultiplierStop = 2; // Stop-loss em 2x ATR
  const atrMultiplierTarget = 3; // Take-profit em 3x ATR (Alvo 2)
  const stop = isBuy ? entry - atrMultiplierStop * coin.atr : entry + atrMultiplierStop * coin.atr;
  const target = isBuy ? entry + atrMultiplierTarget * coin.atr : entry - atrMultiplierTarget * coin.atr;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk > 0 ? (reward / risk).toFixed(2) : 'N/A';
}

// ================= ALERTA ESTOCÁSTICO ================= //
async function sendAlertStochasticCross(symbol, data) {
  const { ohlcv15m, ohlcv4h, ohlcv1h, ohlcvDiario, price, rsi1h, lsr, fundingRate, aggressiveDelta, estocastico4h, estocasticoD, oi15m, atr } = data;
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = { historico: [] };
  if (state.ultimoAlertaPorAtivo[symbol]['4h'] && agora - state.ultimoAlertaPorAtivo[symbol]['4h'] < config.TEMPO_COOLDOWN_STOCHASTIC_MS) return;

  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const zonas = detectarQuebraEstrutura(ohlcv15m);
  const volumeProfile = calculateVolumeProfile(ohlcv15m);
  const orderBookLiquidity = await fetchLiquidityZones(symbol);

  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
  const rsi1hEmoji = rsi1h > 60 ? "☑︎" : rsi1h < 40 ? "☑︎" : "";
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    if (lsr.value <= 1.3) lsrSymbol = '✅Baixo';
    else if (lsr.value >= 3) lsrSymbol = '📛Alto';
  }
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
    ? `${fundingRateEmoji} ${fundingRate.current.toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}`
    : '🔹 Indisp.';
  const deltaText = aggressiveDelta.isSignificant 
    ? `${aggressiveDelta.isBuyPressure ? '💹F.Comprador' : '⭕F.Vendedor'} ${aggressiveDelta.deltaPercent > 60 && lsr.value !== null && lsr.value < 1 ? '💥' : ''}(${aggressiveDelta.deltaPercent}%)`
    : '🔘Neutro';
  const oiText = oi15m ? `${oi15m.isRising ? '📈' : '📉'} OI 15m: ${oi15m.percentChange}%` : '🔹 Indisp.';

  if (!state.ultimoEstocastico[symbol]) state.ultimoEstocastico[symbol] = {};
  const kAnteriorD = state.ultimoEstocastico[symbol].kD || estocasticoD?.k || 0;
  const kAnterior4h = state.ultimoEstocastico[symbol].k4h || estocastico4h?.k || 0;
  state.ultimoEstocastico[symbol].kD = estocasticoD?.k;
  state.ultimoEstocastico[symbol].k4h = estocastico4h?.k;
  const direcaoD = getSetaDirecao(estocasticoD?.k, kAnteriorD);
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stochDEmoji = estocasticoD ? getStochasticEmoji(estocasticoD.k) : "";
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";

  const buyZonesText = zonas.buyLiquidityZones.map(format).join(' / ') || 'N/A';
  const sellZonesText = zonas.sellLiquidityZones.map(format).join(' / ') || 'N/A';
  const vpBuyZonesText = volumeProfile.buyLiquidityZones.map(format).join(' / ') || 'N/A';
  const vpSellZonesText = volumeProfile.sellLiquidityZones.map(format).join(' / ') || 'N/A';
  const obBuyZonesText = orderBookLiquidity.buyLiquidityZones.map(format).join(' / ') || 'N/A';
  const obSellZonesText = orderBookLiquidity.sellLiquidityZones.map(format).join(' / ') || 'N/A';

  const entryLow = format(price - 0.3 * atr);
  const entryHigh = format(price + 0.5 * atr);
  const targetsBuy = [2, 4, 6, 8].map(mult => format(price + mult * atr)).join(" / ");
  const targetsSell = [2, 4, 6, 8].map(mult => format(price - mult * atr)).join(" / ");
  const stopBuy = format(price - 5.0 * atr);
  const stopSell = format(price + 5.0 * atr);

  let alertText = '';
  // Condições para compra: %K > %D (4h), %K <= 75 (4h e Diário), RSI 1h < 60, OI 15m subindo, LSR < 2.7, Delta >= 5%
  const isBuySignal = estocastico4h && estocasticoD &&
                      estocastico4h.k > estocastico4h.d && 
                      estocastico4h.k <= config.STOCHASTIC_BUY_MAX && 
                      estocasticoD.k <= config.STOCHASTIC_BUY_MAX &&
                      rsi1h < 60 && 
                      oi15m.isRising && 
                      (lsr.value === null || lsr.value < config.LSR_BUY_MAX) &&
                      aggressiveDelta.deltaPercent >= config.DELTA_BUY_MIN;
  
  // Condições para venda: %K < %D (4h), %K >= 20 (4h e Diário), RSI 1h > 60, OI 15m caindo, LSR > 2.7, Delta <= -10%
  const isSellSignal = estocastico4h && estocasticoD &&
                       estocastico4h.k < estocastico4h.d && 
                       estocastico4h.k >= config.STOCHASTIC_SELL_MIN && 
                       estocasticoD.k >= config.STOCHASTIC_SELL_MIN &&
                       rsi1h > 60 && 
                       !oi15m.isRising && 
                       (lsr.value === null || lsr.value > config.LSR_SELL_MIN) &&
                       aggressiveDelta.deltaPercent <= config.DELTA_SELL_MAX;

  if (isBuySignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r => 
      r.direcao === 'buy' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_STOCHASTIC_MS
    );
    if (!foiAlertado) {
      alertText = `🟢*Possível Compra STOCH 4H *\n\n` +
                  `🔹Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
                  `💲 Preço: ${format(price)}\n` +
                  `🔹 RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹 Fund. R: ${fundingRateText}\n` +
                  `🔸 Vol.Delta: ${deltaText}\n` +
                  `🔹 Stoch Diário %K: ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
                  `🔹 Stoch 4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
                  `🔹 Entr.: ${entryLow}...${entryHigh}\n` +
                  `🎯 Tps: ${targetsBuy}\n` +
                  `⛔ Stop: ${stopBuy}\n` +
                  `   Romp. de Baixa: ${format(zonas.estruturaBaixa)}\n` +
                  `   Romp. de Alta: ${format(zonas.estruturaAlta)}\n` +
                  `   Liquid. Compra: ${buyZonesText}\n` +
                  `   Liquid. Venda: ${sellZonesText}\n` +
                  `   POC Bull: ${vpBuyZonesText}\n` +
                  `   POC Bear: ${vpSellZonesText}\n` +
                  ` ☑︎ Gerencie seu Risco - @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['4h'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'buy', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-10);
      logger.info(`Sinal de compra (estocástico) detectado para ${symbol}: Preço=${format(price)}, Stoch 4h K=${estocastico4h.k}, D=${estocastico4h.d}, Stoch Diário K=${estocasticoD.k}, RSI 1h=${rsi1h.toFixed(2)}, OI 15m=${oi15m.percentChange}%, LSR=${lsr.value ? lsr.value.toFixed(2) : 'N/A'}, Delta=${aggressiveDelta.deltaPercent}%`);
    }
  } else if (isSellSignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r => 
      r.direcao === 'sell' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_STOCHASTIC_MS
    );
    if (!foiAlertado) {
      alertText = `🔴*Possível Correção STOCH 4H *\n\n` +
                  `🔹Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
                  `💲 Preço: ${format(price)}\n` +
                  `🔹 RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹 Fund. R: ${fundingRateText}\n` +
                  `🔸 Vol.Delta: ${deltaText}\n` +
                  `🔹 Stoch Diário %K: ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
                  `🔹 Stoch 4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
                  `🔹 Entr.: ${entryLow}...${entryHigh}\n` +
                  `🎯 Tps: ${targetsSell}\n` +
                  `⛔ Stop: ${stopSell}\n` +
                  `   Romp. de Baixa: ${format(zonas.estruturaBaixa)}\n` +
                  `   Romp. de Alta: ${format(zonas.estruturaAlta)}\n` +
                  `   Liquid. Compra: ${buyZonesText}\n` +
                  `   Liquid. Venda: ${sellZonesText}\n` +
                  `   POC Bull: ${vpBuyZonesText}\n` +
                  `   POC Bear: ${vpSellZonesText}\n` +
                  ` ☑︎ Gerencie seu Risco - @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['4h'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'sell', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-10);
      logger.info(`Sinal de venda (estocástico) detectado para ${symbol}: Preço=${format(price)}, Stoch 4h K=${estocastico4h.k}, D=${estocastico4h.d}, Stoch Diário K=${estocasticoD.k}, RSI 1h=${rsi1h.toFixed(2)}, OI 15m=${oi15m.percentChange}%, LSR=${lsr.value ? lsr.value.toFixed(2) : 'N/A'}, Delta=${aggressiveDelta.deltaPercent}%`);
    }
  }

  if (alertText) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info(`Alerta de sinal estocástico enviado para ${symbol}: ${alertText}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta estocástico para ${symbol}: ${e.message}`);
    }
  }
}

// ================= ALERTA DE MONITORAMENTO ================= //
async function sendMonitorAlert(coins) {
  const topLow = coins
    .filter(c => c.lsr !== null && c.rsi !== null)
    .sort((a, b) => (a.lsr + a.rsi) - (b.lsr + b.rsi))
    .slice(0, 20);
  const topHigh = coins
    .filter(c => c.lsr !== null && c.rsi !== null)
    .sort((a, b) => (b.lsr + b.rsi) - (a.lsr + b.rsi))
    .slice(0, 20);

  const topPositiveDelta = topLow
    .filter(c => c.delta.isBuyPressure)
    .sort((a, b) => b.delta.deltaPercent - a.delta.deltaPercent)
    .slice(0, 10)
    .map(c => c.symbol);
  const topNegativeDelta = topHigh
    .filter(c => !c.delta.isBuyPressure)
    .sort((a, b) => a.delta.deltaPercent - b.delta.deltaPercent)
    .slice(0, 10)
    .map(c => c.symbol);

  const format = (v, precision = 2) => isNaN(v) || v === null ? 'N/A' : v.toFixed(precision);
  const formatPrice = (price) => price < 1 ? price.toFixed(8) : price < 10 ? price.toFixed(6) : price < 100 ? price.toFixed(4) : price.toFixed(2);

  const starCoins = topLow.filter(coin => 
    topPositiveDelta.includes(coin.symbol) && 
    coin.delta.isBuyPressure && 
    coin.oi5m.isRising && 
    coin.oi15m.isRising && 
    coin.funding.current < 0 &&
    coin.lsr <= config.LSR_STAR_MAX &&
    coin.rsi1h !== null && coin.rsi1h < 60 &&
    coin.volume >= config.MIN_VOLUME_USDT &&
    coin.oi15m.value >= config.MIN_OPEN_INTEREST
  );

  const skullCoins = topHigh.filter(coin => 
    topNegativeDelta.includes(coin.symbol) && 
    !coin.delta.isBuyPressure && 
    !coin.oi5m.isRising && 
    !coin.oi15m.isRising && 
    coin.funding.current > 0 &&
    coin.lsr >= config.LSR_SKULL_MIN &&
    coin.rsi1h !== null && coin.rsi1h > 60 &&
    coin.volume >= config.MIN_VOLUME_USDT &&
    coin.oi15m.value >= config.MIN_OPEN_INTEREST
  );

  if (starCoins.length > 0) {
    let starAlertText = `🟢*Possível Compra (Monitor) *\n\n`;
    starAlertText += await Promise.all(starCoins.map(async (coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const deltaText = coin.delta.isBuyPressure ? `💹${format(coin.delta.deltaPercent)}%` : `⭕${format(coin.delta.deltaPercent)}%`;
      let lsrSymbol = '';
      if (coin.lsr !== null) {
        if (coin.lsr <= 1.8) lsrSymbol = '✅Baixo';
        else if (coin.lsr >= config.LSR_SKULL_MIN) lsrSymbol = '📛Alto';
      }
      let fundingRateEmoji = '';
      if (coin.funding.current !== null) {
        if (coin.funding.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (coin.funding.current <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (coin.funding.current <= -0.0005) fundingRateEmoji = '🟢';
        else if (coin.funding.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (coin.funding.current >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (coin.funding.current >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
      }
      const oi5mText = coin.oi5m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const oi15mText = coin.oi15m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const atr = coin.atr !== null ? coin.atr : 'N/A';
      const target1 = atr !== 'N/A' ? formatPrice(coin.price + 1.5 * atr) : 'N/A';
      const target2 = atr !== 'N/A' ? formatPrice(coin.price + 3 * atr) : 'N/A';
      const target3 = atr !== 'N/A' ? formatPrice(coin.price + 5 * atr) : 'N/A';
      const target4 = atr !== 'N/A' ? formatPrice(coin.price + 7 * atr) : 'N/A';
      const stopLoss = atr !== 'N/A' ? formatPrice(coin.price - 2 * atr) : 'N/A';
      const riskReward = calculateRiskReward(coin, true);
      const isVolumeSpike = await detectVolumeSpike(coin.symbol);
      const isFundingAnomaly = await detectFundingRateChange(coin.symbol, coin.funding.current);
      const anomalyText = isVolumeSpike || isFundingAnomaly ? `🚨 Anomalia: ${isVolumeSpike ? 'Pico de Volume' : ''}${isVolumeSpike && isFundingAnomaly ? ' | ' : ''}${isFundingAnomaly ? 'Mudança no Funding Rate' : ''}\n` : '';
      const stoch4hK = coin.stoch4h.k !== null ? format(coin.stoch4h.k) : 'N/A';
      const stoch4hD = coin.stoch4h.d !== null ? format(coin.stoch4h.d) : 'N/A';
      const stoch4hKEmoji = getStochasticEmoji(coin.stoch4h.k);
      const stoch4hDEmoji = getStochasticEmoji(coin.stoch4h.d);
      const stoch4hDir = getSetaDirecao(coin.stoch4h.k, coin.stoch4h.previousK);
      const stoch1dK = coin.stoch1d.k !== null ? format(coin.stoch1d.k) : 'N/A';
      const stoch1dD = coin.stoch1d.d !== null ? format(coin.stoch1d.d) : 'N/A';
      const stoch1dKEmoji = getStochasticEmoji(coin.stoch1d.k);
      const stoch1dDEmoji = getStochasticEmoji(coin.stoch1d.d);
      const stoch1dDir = getSetaDirecao(coin.stoch1d.k, coin.stoch1d.previousK);
      return `${i + 1}. 🔹 *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n` +
             `   LSR: ${format(coin.lsr)} ${lsrSymbol}\n` +
             `   RSI (15m): ${format(coin.rsi)}\n` +
             `   RSI (1h): ${format(coin.rsi1h)}\n` +
             `   Stoch (4h): %K ${stoch4hK}${stoch4hKEmoji} ${stoch4hDir} | %D ${stoch4hD}${stoch4hDEmoji}\n` +
             `   Stoch (1d): %K ${stoch1dK}${stoch1dKEmoji} ${stoch1dDir} | %D ${stoch1dD}${stoch1dDEmoji}\n` +
             `   Vol.Delta: ${deltaText}\n` +
             `   Fund.Rate: ${fundingRateEmoji}${format(coin.funding.current, 5)}%\n` +
             `   OI 5m: ${oi5mText}\n` +
             `   OI 15m: ${oi15mText}\n` +
             `   Alvo 1: ${target1}\n` +
             `   Alvo 2: ${target2} (R:R = ${riskReward})\n` +
             `   Alvo 3: ${target3}\n` +
             `   Alvo 4: ${target4}\n` +
             `   ⛔Stop: ${stopLoss}\n` +
             anomalyText;
    })).then(results => results.join('\n'));
    starAlertText += `\n☑︎ 🤖 Monitor Titanium Optimus Prime`;

    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, starAlertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info('Alerta de moedas com estrela enviado com sucesso');
    } catch (e) {
      logger.error(`Erro ao enviar alerta de estrela: ${e.message}`);
    }
  }

  if (skullCoins.length > 0) {
    let skullAlertText = `🔴*Possível Correção (Monitor) *\n\n`;
    skullAlertText += await Promise.all(skullCoins.map(async (coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const deltaText = coin.delta.isBuyPressure ? `💹${format(coin.delta.deltaPercent)}%` : `⭕${format(coin.delta.deltaPercent)}%`;
      let lsrSymbol = '';
      if (coin.lsr !== null) {
        if (coin.lsr <= 1.8) lsrSymbol = '✅Baixo';
        else if (coin.lsr >= config.LSR_SKULL_MIN) lsrSymbol = '📛Alto';
      }
      let fundingRateEmoji = '';
      if (coin.funding.current !== null) {
        if (coin.funding.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (coin.funding.current <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (coin.funding.current <= -0.0005) fundingRateEmoji = '🟢';
        else if (coin.funding.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (coin.funding.current >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (coin.funding.current >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
      }
      const oi5mText = coin.oi5m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const oi15mText = coin.oi15m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const atr = coin.atr !== null ? coin.atr : 'N/A';
      const target1 = atr !== 'N/A' ? formatPrice(coin.price - 1.5 * atr) : 'N/A';
      const target2 = atr !== 'N/A' ? formatPrice(coin.price - 3 * atr) : 'N/A';
      const target3 = atr !== 'N/A' ? formatPrice(coin.price - 5 * atr) : 'N/A';
      const target4 = atr !== 'N/A' ? formatPrice(coin.price - 7 * atr) : 'N/A';
      const stopLoss = atr !== 'N/A' ? formatPrice(coin.price + 2 * atr) : 'N/A';
      const riskReward = calculateRiskReward(coin, false);
      const isVolumeSpike = await detectVolumeSpike(coin.symbol);
      const isFundingAnomaly = await detectFundingRateChange(coin.symbol, coin.funding.current);
      const anomalyText = isVolumeSpike || isFundingAnomaly ? `🚨 Anomalia: ${isVolumeSpike ? 'Pico de Volume' : ''}${isVolumeSpike && isFundingAnomaly ? ' | ' : ''}${isFundingAnomaly ? 'Mudança no Funding Rate' : ''}\n` : '';
      const stoch4hK = coin.stoch4h.k !== null ? format(coin.stoch4h.k) : 'N/A';
      const stoch4hD = coin.stoch4h.d !== null ? format(coin.stoch4h.d) : 'N/A';
      const stoch4hKEmoji = getStochasticEmoji(coin.stoch4h.k);
      const stoch4hDEmoji = getStochasticEmoji(coin.stoch4h.d);
      const stoch4hDir = getSetaDirecao(coin.stoch4h.k, coin.stoch4h.previousK);
      const stoch1dK = coin.stoch1d.k !== null ? format(coin.stoch1d.k) : 'N/A';
      const stoch1dD = coin.stoch1d.d !== null ? format(coin.stoch1d.d) : 'N/A';
      const stoch1dKEmoji = getStochasticEmoji(coin.stoch1d.k);
      const stoch1dDEmoji = getStochasticEmoji(coin.stoch1d.d);
      const stoch1dDir = getSetaDirecao(coin.stoch1d.k, coin.stoch1d.previousK);
      return `${i + 1}. 🔻 *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n` +
             `   LSR: ${format(coin.lsr)} ${lsrSymbol}\n` +
             `   RSI (15m): ${format(coin.rsi)}\n` +
             `   RSI (1h): ${format(coin.rsi1h)}\n` +
             `   Stoch (4h): %K ${stoch4hK}${stoch4hKEmoji} ${stoch4hDir} | %D ${stoch4hD}${stoch4hDEmoji}\n` +
             `   Stoch (1d): %K ${stoch1dK}${stoch1dKEmoji} ${stoch1dDir} | %D ${stoch1dD}${stoch1dDEmoji}\n` +
             `   Vol.Delta: ${deltaText}\n` +
             `   Fund.Rate: ${fundingRateEmoji}${format(coin.funding.current, 5)}%\n` +
             `   OI 5m: ${oi5mText}\n` +
             `   OI 15m: ${oi15mText}\n` +
             `   Alvo 1: ${target1}\n` +
             `   Alvo 2: ${target2} (R:R = ${riskReward})\n` +
             `   Alvo 3: ${target3}\n` +
             `   Alvo 4: ${target4}\n` +
             `   ⛔Stop: ${stopLoss}\n` +
             anomalyText;
    })).then(results => results.join('\n'));
    skullAlertText += `\n☑︎ 🤖 Gerencie seu risco @J4Rviz`;

    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, skullAlertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info('Alerta de moedas com caveira enviado com sucesso');
    } catch (e) {
      logger.error(`Erro ao enviar alerta de caveira: ${e.message}`);
    }
  }

  const anomalyCoins = coins.filter(coin => coin.anomalyDetected);
  if (anomalyCoins.length > 0) {
    let anomalyAlertText = `🚨 *Alerta de Anomalia* 🚨\n\n`;
    anomalyAlertText += anomalyCoins.map((coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const anomalyText = coin.volumeSpike || coin.fundingAnomaly ? `🚨Volume: ${coin.volumeSpike ? 'Pico de Volume' : ''}${coin.volumeSpike && coin.fundingAnomaly ? ' | ' : ''}${coin.fundingAnomaly ? 'Mudança no Funding Rate' : ''}` : '';
      return `${i + 1}. *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   ${anomalyText}\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n`;
    }).join('\n');
    anomalyAlertText += `\n☑︎ 🤖 Monitor Titanium Optimus Prime`;

    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, anomalyAlertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info('Alerta de anomalias enviado com sucesso');
    } catch (e) {
      logger.error(`Erro ao enviar alerta de anomalia: ${e.message}`);
    }
  }

  if (starCoins.length === 0 && skullCoins.length === 0 && anomalyCoins.length === 0) {
    logger.info('Nenhuma moeda válida para alertas (estrela, caveira ou anomalia), nenhum alerta enviado.');
  } else {
    logger.info('Alertas de monitoramento processados com sucesso');
  }
}

// ================= LÓGICA ESTOCÁSTICA ================= //
async function checkStochasticConditions() {
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const cacheKeyPrefix = `ohlcv_${symbol}`;
      const ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 50));
      const ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D));
      const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, config.RSI_PERIOD + 1));
      const ohlcvDiarioRaw = getCachedData(`${cacheKeyPrefix}_1d`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 20));
      setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
      setCachedData(`${cacheKeyPrefix}_4h`, ohlcv4hRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
      setCachedData(`${cacheKeyPrefix}_1d`, ohlcvDiarioRaw);

      if (!ohlcv15mRaw || !ohlcv4hRaw || !ohlcv1hRaw || !ohlcvDiarioRaw) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}, pulando...`);
        return;
      }

      const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
      const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const ohlcvDiario = normalizeOHLCV(ohlcvDiarioRaw);
      const closes15m = ohlcv15m.map(c => c.close).filter(c => !isNaN(c));
      const currentPrice = closes15m[closes15m.length - 1];

      if (isNaN(currentPrice)) {
        logger.warn(`Preço atual inválido para ${symbol}, pulando...`);
        return;
      }

      const rsi1h = calculateRSI(ohlcv1h);
      const estocastico4h = calculateStochastic(ohlcv4h);
      const estocasticoD = calculateStochastic(ohlcvDiario);
      const oi15m = await fetchOpenInterest(symbol, '15m');
      const lsr = await fetchLSR(symbol);
      const fundingRate = await fetchFundingRate(symbol);
      const aggressiveDelta = await calculateAggressiveDelta(symbol, exchangeSpot);
      const atr = calculateATR(ohlcv15m);

      if (!rsi1h || !estocastico4h || !estocasticoD || !atr) {
        logger.warn(`Indicadores insuficientes para ${symbol}, pulando...`);
        return;
      }

      await sendAlertStochasticCross(symbol, {
        ohlcv15m,
        ohlcv4h,
        ohlcv1h,
        ohlcvDiario,
        price: currentPrice,
        rsi1h,
        lsr,
        fundingRate,
        aggressiveDelta,
        estocastico4h,
        estocasticoD,
        oi15m,
        atr
      });
    }, 5);
  } catch (e) {
    logger.error(`Erro ao processar condições estocásticas: ${e.message}`);
  }
}

// ================= LÓGICA DE MONITORAMENTO ================= //
async function checkMonitorConditions() {
  try {
    const markets = await withRetry(() => exchangeFutures.loadMarkets());
    const usdtPairs = Object.keys(markets)
      .filter(symbol => symbol.endsWith('/USDT') && markets[symbol].active)
      .slice(0, 100); // Limita a 100 pares para evitar sobrecarga

    const coinsData = await limitConcurrency(usdtPairs, async (symbol) => {
      try {
        const ticker = await withRetry(() => exchangeFutures.fetchTicker(symbol));
        const price = ticker?.last || null;
        const volume = ticker?.baseVolume * price || 0;
        if (!price) {
          logger.warn(`Preço inválido para ${symbol}, pulando...`);
          return null;
        }

        const ohlcv15mRaw = getCachedData(`ohlcv_${symbol}_15m`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '15m', undefined, Math.max(config.RSI_PERIOD, config.ATR_PERIOD) + 1));
        setCachedData(`ohlcv_${symbol}_15m`, ohlcv15mRaw);
        const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
        if (!ohlcv15m.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (15m), pulando...`);
          return null;
        }

        const ohlcv1hRaw = getCachedData(`ohlcv_${symbol}_1h`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '1h', undefined, config.RSI_PERIOD + 1));
        setCachedData(`ohlcv_${symbol}_1h`, ohlcv1hRaw);
        const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
        if (!ohlcv1h.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (1h), pulando...`);
          return null;
        }

        const ohlcv4hRaw = getCachedData(`ohlcv_${symbol}_4h`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '4h', undefined, 8));
        setCachedData(`ohlcv_${symbol}_4h`, ohlcv4hRaw);
        const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
        if (!ohlcv4h.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (4h), pulando...`);
          return null;
        }

        const ohlcv1dRaw = getCachedData(`ohlcv_${symbol}_1d`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '1d', undefined, 8));
        setCachedData(`ohlcv_${symbol}_1d`, ohlcv1dRaw);
        const ohlcv1d = normalizeOHLCV(ohlcv1dRaw);
        if (!ohlcv1d.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (1d), pulando...`);
          return null;
        }

        const rsi = calculateRSI(ohlcv15m);
        const rsi1h = calculateRSI(ohlcv1h);
        const atr = calculateATR(ohlcv15m);
        const lsr = (await fetchLSR(symbol)).value;
        const funding = await fetchFundingRate(symbol);
        const delta = await calculateAggressiveDelta(symbol, exchangeFutures);
        const oi5m = await fetchOpenInterest(symbol, '5m');
        const oi15m = await fetchOpenInterest(symbol, '15m');
        const stoch4h = calculateStochastic(ohlcv4h);
        const stoch1d = calculateStochastic(ohlcv1d);

        const volumeSpike = await detectVolumeSpike(symbol);
        const fundingAnomaly = await detectFundingRateChange(symbol, funding.current);
        const anomalyDetected = volumeSpike || fundingAnomaly;

        if (volume < config.MIN_VOLUME_USDT || oi15m.value < config.MIN_OPEN_INTEREST) {
          logger.info(`Par ${symbol} filtrado por baixa liquidez: Volume=${volume}, OI=${oi15m.value}`);
          return null;
        }

        return { symbol, price, rsi, rsi1h, atr, lsr, funding, delta, oi5m, oi15m, volume, volumeSpike, fundingAnomaly, anomalyDetected, stoch4h, stoch1d };
      } catch (e) {
        logger.warn(`Erro ao processar ${symbol} (monitor): ${e.message}`);
        return null;
      }
    }, 5);

    const validCoins = coinsData.filter(coin => coin !== null);
    if (validCoins.length > 0) {
      await sendMonitorAlert(validCoins);
    } else {
      logger.warn('Nenhuma moeda válida processada para monitoramento, nenhum alerta enviado.');
    }
  } catch (e) {
    logger.error(`Erro ao processar condições de monitoramento: ${e.message}`);
  }
}

// ================= HEARTBEAT ================= //
async function startHeartbeat() {
  setInterval(async () => {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 💥Dica Operacional: Para 🟢Compra prefira moedas com Stoch 4h e Diário baixos, abaixo de 40, em conjunto com LSR abaixo de 1.7 e verifique o Volume Delta uma importante informação de dados reais do livro comprador do ativo, 💹Positivo acima de 30% a 50%  é o ideal. 💥Dica de Venda: para a 🔴Venda observar o Stoch 4h e Diário altos acima de 80 a 95, LSR Alto acima de 3, com Volume Delta ⭕Negativo -30% a -50%, que significa ausência de compradores ...Observe também o 📍Funding Rate, para 🟢Compra com círculo verde, e valor do Funding rate negativo,  Já para 🔴Venda com círculo vermelho, valor do Funding rate positivo, 💹 seus trades serão mais lucrativos... ☑︎ Gerencie seu Risco - @J4Rviz'));
      logger.info('Heartbeat enviado');
    } catch (e) {
      logger.error(`Erro no heartbeat: ${e.message}`);
    }
  }, config.HEARTBEAT_INTERVAL_MS);
}

// ================= LÓGICA PRINCIPAL ================= //
async function main() {
  logger.info('Iniciando Combined Titanium Optimus Prime');
  try {
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 Combined Titanium  - 💹Start...'));
    startHeartbeat();
    await checkStochasticConditions();
    await checkMonitorConditions();
    setInterval(checkStochasticConditions, config.INTERVALO_ALERTA_STOCHASTIC_MS);
    setInterval(checkMonitorConditions, config.INTERVALO_ALERTA_MONITOR_MS);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
  }
}

main().catch(e => logger.error(`Erro fatal: ${e.message}`));
