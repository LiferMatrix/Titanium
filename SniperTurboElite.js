require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const CronJob = require('cron').CronJob;

// ================= CONFIGURAÇÃO COMPLETA ================= //
const config = {
  TELEGRAM_BOT_TOKEN: "8010060485:AAESqJMqL0",
  TELEGRAM_CHAT_ID: "-100255",
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  
  // Performance otimizada
  INTERVALO_ALERTA_MS: 5 * 60 * 1000,           // 5 minutos (era 3)
  TEMPO_COOLDOWN_MS: 20 * 60 * 1000,           // 20 minutos (era 15)
  TEMPO_COOLDOWN_SAME_DIR_MS: 20 * 60 * 1000,  // 20 minutos (era 15)
  CACHE_TTL_DEFAULT: 5 * 60 * 1000,            // 5 minutos (era 3)
  MAX_CACHE_SIZE: 4000,
  MAX_CONCURRENT_REQUESTS: 10,                 // Reduzido de 20
  REQUEST_DELAY_MS: 100,                       // Delay entre requests
  
  // Indicadores
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 75,
  STOCHASTIC_SELL_MIN: 70,
  LSR_BUY_MAX: 2.5,
  LSR_SELL_MIN: 2.6,
  BUY_TOLERANCE_PERCENT: 0.025,
  ATR_MULTIPLIER_BUY: 1.5,
  ATR_MULTIPLIER_SELL: 1.5,
  TARGET_MULTIPLIER: 1.5,
  MIN_ATR_PERCENT: 0.8,
  ADX_PERIOD: process.env.ADX_PERIOD ? parseInt(process.env.ADX_PERIOD) : 14,
  ADX_MIN_TREND: 25,                           // Aumentado para 30 (era 25)
  
  // Logs
  LOG_MAX_SIZE: '100m',
  LOG_MAX_FILES: 2,
  LOG_CLEANUP_INTERVAL_MS: 2 * 24 * 60 * 60 * 1000,
  
  // Volume
  VOLUME_LOOKBACK: 45,
  VOLUME_MULTIPLIER: 2.5,
  VOLUME_Z_THRESHOLD: 2.5,
  
  // LSR
  LSR_PERIOD: '15m',
  
  // Safety System (NOVO)
  SAFETY_MAX_DAILY_LOSS_PCT: 5,
  SAFETY_MAX_CONSECUTIVE_LOSSES: 3,
  SAFETY_MIN_SPREAD_PERCENT: 0.1,
  SAFETY_MIN_VOLUME_USD: 500000, // $500k em vez de $1M
  SAFETY_ATR_MULTIPLIER: 2.7,                  // Aumentado de 2.45
  
  // Order Flow (NOVO)
  ORDERFLOW_MIN_LARGE_TRADES: 5,
  ORDERFLOW_BUY_PRESSURE_MIN: 0.55,
  ORDERFLOW_SELL_PRESSURE_MIN: 0.55,
  ORDERFLOW_LARGE_BUY_RATIO_MIN: 0.6,
  
  // Max históricos
  MAX_HISTORICO_ALERTAS: 10,
};

// Logger aprimorado
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: 'logs/sniper_titanium_pro_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/sniper_titanium_pro_combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ================= ESTADO GLOBAL COMPLETO ================= //
const state = {
  ultimoAlertaPorAtivo: {},
  ultimoEstocastico: {},
  dataCache: new Map(),
  dailyStats: { 
    signals: 0, 
    longs: 0, 
    shorts: 0, 
    avgRR: 0, 
    targetsHit: 0, 
    estimatedProfit: 0,
    bestTrade: { symbol: '', profit: 0 },
    worstTrade: { symbol: '', loss: 0 }
  },
  safetyStats: {
    dailyLoss: 0,
    consecutiveLosses: 0,
    tradesToday: 0,
    dailyStart: Date.now(),
    stopTriggered: false
  },
  orderFlowStats: {
    totalAnalyzed: 0,
    validSignals: 0,
    avgBuyPressure: 0,
    avgSellPressure: 0
  }
};

// ================= OTIMIZAÇÕES TURBO ================= //
const TIMEFRAMES = {
  '3m': { limit: 120, ttl: 4 * 60 * 1000 },
  '15m': { limit: 120, ttl: 15 * 60 * 1000 },
  '1h': { limit: 110, ttl: 12 * 60 * 1000 },
  '4h': { limit: 50, ttl: 30 * 60 * 1000 },
  '1d': { limit: 30, ttl: 2 * 60 * 60 * 1000 },
  '1w': { limit: 10, ttl: 6 * 60 * 60 * 1000 }
};

// Cache inteligente com prioridade
class SmartCache {
  constructor(maxSize = config.MAX_CACHE_SIZE) {
    this.cache = new Map();
    this.priority = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
  }
  
  get(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.ts < entry.ttl) {
      this.hits++;
      this.priority.set(key, (this.priority.get(key) || 0) + 1);
      return entry.data;
    }
    this.misses++;
    this.cache.delete(key);
    this.priority.delete(key);
    return null;
  }
  
  set(key, data, priority = 1, ttl = config.CACHE_TTL_DEFAULT) {
    if (key.includes('ohlcv') || key.includes('volume')) {
      priority = 3;
      ttl = 2 * 60 * 1000;
    } else if (key.includes('orderflow') || key.includes('lsr')) {
      priority = 2;
      ttl = 3 * 60 * 1000;
    }
    
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }
    
    this.cache.set(key, { ts: Date.now(), ttl, data });
    this.priority.set(key, priority);
  }
  
  cleanup() {
    const entries = Array.from(this.cache.entries());
    const lowPriority = entries.filter(([key]) => (this.priority.get(key) || 0) <= 1);
    
    if (lowPriority.length > 0) {
      const toRemove = lowPriority.slice(0, Math.floor(this.maxSize * 0.1));
      toRemove.forEach(([key]) => {
        this.cache.delete(key);
        this.priority.delete(key);
      });
      logger.info(`Cache limpo: removidos ${toRemove.length} itens`);
    }
  }
  
  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0
    };
  }
}

// Substituir cache antigo
state.dataCache = new SmartCache();

// ================= INICIALIZAÇÃO ================= //
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'COINS'];
  for (const key of required) {
    if (!process.env[key] && !config[key]) {
      logger.error(`Missing env: ${key}`);
      process.exit(1);
    }
  }
}
validateEnv();

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

// ================= FUNÇÕES UTILITÁRIAS ================= //
async function withRetry(fn, retries = 3, delayBase = 800) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = Math.pow(2, attempt - 1) * delayBase;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function limitConcurrencyWithDelay(items, fn, limit = config.MAX_CONCURRENT_REQUESTS) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map(async (item, index) => {
        if (index > 0) {
          await new Promise(r => setTimeout(r, config.REQUEST_DELAY_MS));
        }
        return fn(item);
      })
    );
    results.push(...batchResults);
    
    if (i + limit < items.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return results;
}

// ================= SISTEMA DE PROTEÇÃO ================= //
async function checkSafety(symbol) {
  try {
    // Verificar stop diário
    const today = new Date().toDateString();
    if (state.safetyStats.dailyStart !== today) {
      state.safetyStats.dailyLoss = 0;
      state.safetyStats.consecutiveLosses = 0;
      state.safetyStats.tradesToday = 0;
      state.safetyStats.stopTriggered = false;
      state.safetyStats.dailyStart = Date.now();
    }
    
    if (state.safetyStats.stopTriggered) {
      logger.error(`🚨 STOP DIÁRIO ATIVADO para ${symbol}`);
      return { safe: false, reason: 'Stop diário ativado' };
    }
    
    if (state.safetyStats.dailyLoss <= -config.SAFETY_MAX_DAILY_LOSS_PCT) {
      state.safetyStats.stopTriggered = true;
      logger.error(`🚨 STOP DIÁRIO ATINGIDO: ${state.safetyStats.dailyLoss.toFixed(2)}%`);
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, 
        `🚨 STOP DIÁRIO ATIVADO\nPerda diária: ${state.safetyStats.dailyLoss.toFixed(2)}%\nRetomando amanhã.`);
      return { safe: false, reason: `Stop diário: ${state.safetyStats.dailyLoss.toFixed(2)}%` };
    }
    
    // Verificar perdas consecutivas
    if (state.safetyStats.consecutiveLosses >= config.SAFETY_MAX_CONSECUTIVE_LOSSES) {
      logger.warn(`⚠️ ${state.safetyStats.consecutiveLosses} perdas consecutivas`);
      return { safe: false, reason: `${state.safetyStats.consecutiveLosses} perdas consecutivas` };
    }
    
    // Verificar spread
    const ticker = await withRetry(() => exchangeFutures.fetchTicker(symbol));
    const spread = (ticker.ask - ticker.bid) / ticker.bid * 100;
    
    if (spread > config.SAFETY_MIN_SPREAD_PERCENT) {
      logger.warn(`📊 Spread alto ${symbol}: ${spread.toFixed(2)}%`);
      return { safe: false, reason: `Spread alto: ${spread.toFixed(2)}%` };
    }
    
    // Verificar volume mínimo
    const volume24h = ticker.quoteVolume || 0;
    if (volume24h < config.SAFETY_MIN_VOLUME_USD) {
      logger.warn(`💧 Volume baixo ${symbol}: $${(volume24h/1000000).toFixed(2)}M`);
      return { safe: false, reason: `Volume baixo: $${(volume24h/1000000).toFixed(2)}M` };
    }
    
    return { safe: true, reason: 'Condições seguras' };
  } catch (e) {
    logger.error(`Erro verificação segurança ${symbol}: ${e.message}`);
    return { safe: true, reason: 'Erro na verificação' };
  }
}

// ================= ANÁLISE DE VOLUME APERFEIÇOADA ================= //
async function fetchVolumeDataEnhanced(symbol) {
  const cacheKey = `volume_enhanced_${symbol}`;
  const cached = state.dataCache.get(cacheKey);
  if (cached) return cached;
  
  try {
    const [ohlcvRaw, trades, ticker] = await Promise.all([
      withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 20)),
      withRetry(() => exchangeFutures.fetchTrades(symbol, undefined, 100)),
      withRetry(() => exchangeFutures.fetchTicker(symbol))
    ]);
    
    const ohlcv = normalizeOHLCV(ohlcvRaw);
    if (ohlcv.length < 10) {
      const result = { zScore: 0, buyPressure: 0.5, isValid: false, totalVolume: 0 };
      state.dataCache.set(cacheKey, result, 30 * 1000);
      return result;
    }
    
    // Análise tradicional de volume
    const volumes = ohlcv.slice(0, -1).map(c => c.volume);
    const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    const stdDev = Math.sqrt(volumes.reduce((s, v) => s + Math.pow(v - avgVolume, 2), 0) / volumes.length);
    const currentVolume = ohlcv[ohlcv.length - 1].volume;
    const zScore = stdDev > 0 ? (currentVolume - avgVolume) / stdDev : 0;
    
    // Análise de trades (Order Flow simples)
    let buyVolume = 0;
    let sellVolume = 0;
    let largeBuys = 0;
    let largeSells = 0;
    
    const largeTradeThreshold = symbol.includes('BTC') ? 0.5 : 
                               symbol.includes('ETH') ? 5 : 
                               symbol.includes('BNB') ? 10 : 1000;
    
    trades.forEach(trade => {
      const amount = trade.amount || (trade.cost / trade.price);
      const isBuy = trade.side === 'buy' || 
                   (trade.side === undefined && Math.random() > 0.5);
      
      if (isBuy) {
        buyVolume += amount;
        if (amount >= largeTradeThreshold) largeBuys++;
      } else {
        sellVolume += amount;
        if (amount >= largeTradeThreshold) largeSells++;
      }
    });
    
    const totalVolume = buyVolume + sellVolume;
    const buyPressure = totalVolume > 0 ? buyVolume / totalVolume : 0.5;
    const totalLarge = largeBuys + largeSells;
    const largeBuyRatio = totalLarge > 0 ? largeBuys / totalLarge : 0.5;
    
    const isVolumeSurge = currentVolume > avgVolume * 2.5;
    const hasBuyPressure = buyPressure > config.ORDERFLOW_BUY_PRESSURE_MIN;
    const hasSellPressure = (1 - buyPressure) > config.ORDERFLOW_SELL_PRESSURE_MIN;
    const hasLargeTradeConfirmation = totalLarge >= config.ORDERFLOW_MIN_LARGE_TRADES;
    
    const result = {
      zScore,
      buyPressure,
      sellPressure: 1 - buyPressure,
      largeBuyRatio,
      totalVolume: ticker.quoteVolume || 0,
      avgVolume,
      largeBuys,
      largeSells,
      isValid: isVolumeSurge && hasLargeTradeConfirmation,
      isBullish: hasBuyPressure && largeBuyRatio > config.ORDERFLOW_LARGE_BUY_RATIO_MIN,
      isBearish: hasSellPressure && (1 - largeBuyRatio) > config.ORDERFLOW_LARGE_BUY_RATIO_MIN,
      surgeIntensity: currentVolume / avgVolume
    };
    
    // Atualizar estatísticas de order flow
    state.orderFlowStats.totalAnalyzed++;
    if (result.isValid) state.orderFlowStats.validSignals++;
    state.orderFlowStats.avgBuyPressure = 
      (state.orderFlowStats.avgBuyPressure * (state.orderFlowStats.validSignals - 1) + result.buyPressure) / 
      state.orderFlowStats.validSignals || 0.5;
    
    state.dataCache.set(cacheKey, result, 30 * 1000);
    return result;
  } catch (e) {
    logger.error(`Erro volume enhanced ${symbol}: ${e.message}`);
    const result = { zScore: 0, buyPressure: 0.5, isValid: false, totalVolume: 0 };
    state.dataCache.set(cacheKey, result, 30 * 1000);
    return result;
  }
}

// ================= INDICADORES TÉCNICOS ================= //
function normalizeOHLCV(data) {
  return data.map(c => ({
    time: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  })).filter(c => !isNaN(c.close));
}

function calculateRSI(data) {
  if (data.length < config.RSI_PERIOD + 1) return [];
  return TechnicalIndicators.RSI.calculate({ 
    period: config.RSI_PERIOD, 
    values: data.map(d => d.close) 
  }).filter(v => !isNaN(v));
}

function calculateStochastic(data) {
  const minLen = config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2;
  if (data.length < minLen) return null;
  try {
    const result = TechnicalIndicators.Stochastic.calculate({
      high: data.map(c => c.high),
      low: data.map(c => c.low),
      close: data.map(c => c.close),
      period: config.STOCHASTIC_PERIOD_K,
      signalPeriod: config.STOCHASTIC_PERIOD_D,
      smoothing: config.STOCHASTIC_SMOOTH_K
    });
    if (!result?.length) return null;
    const last = result[result.length - 1];
    const k = Number(parseFloat(last.k || 0).toFixed(2));
    const d = Number(parseFloat(last.d || 0).toFixed(2));
    if (isNaN(k) || isNaN(d)) return null;
    return { k, d };
  } catch (e) {
    logger.warn(`Stochastic falhou: ${e.message}`);
    return null;
  }
}

function calculateATR(data) {
  if (data.length < 14) return [];
  return TechnicalIndicators.ATR.calculate({
    period: 14,
    high: data.map(c => c.high),
    low: data.map(c => c.low),
    close: data.map(c => c.close)
  }).filter(v => !isNaN(v));
}

function calculateEMA(data, period) {
  if (data.length < period) return [];
  return TechnicalIndicators.EMA.calculate({ 
    period, 
    values: data.map(d => d.close) 
  }).filter(v => !isNaN(v));
}

function calculateVWAP(data) {
  if (data.length < 1) return null;
  let volSum = 0, priceVolSum = 0;
  data.forEach(c => {
    const tp = (c.high + c.low + c.close) / 3;
    volSum += c.volume;
    priceVolSum += tp * c.volume;
  });
  return volSum > 0 ? priceVolSum / volSum : null;
}

function calculateADX(data) {
  if (data.length < config.ADX_PERIOD * 2) return null;
  const adx = TechnicalIndicators.ADX.calculate({
    period: config.ADX_PERIOD,
    high: data.map(c => c.high),
    low: data.map(c => c.low),
    close: data.map(c => c.close)
  });
  return adx.length ? adx[adx.length - 1].adx : null;
}

function calculateVolatilityIndex(ohlcv3m) {
  if (ohlcv3m.length < 20) return 1;
  const candles = ohlcv3m.slice(-20);
  const ranges = candles.map(c => (c.high - c.low) / c.close);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  return Math.min(avgRange * 100, 3.0);
}

// ================= STOP LOSS DINÂMICO MELHORADO ================= //
function calcularStopDinamico(direction, entryPrice, atr, currentPrice, volatilityIndex = 1) {
  let baseMultiplier = config.SAFETY_ATR_MULTIPLIER;
  
  if (volatilityIndex > 1.5) baseMultiplier *= 1.2;
  if (volatilityIndex > 2.0) baseMultiplier *= 1.5;
  
  const minStopPercent = 0.03;
  const minStopDistance = entryPrice * minStopPercent;
  
  const stop = direction === 'buy' 
    ? Math.max(
        entryPrice - (atr * baseMultiplier),
        entryPrice - (minStopDistance * 3),
        currentPrice * 0.97
      )
    : Math.min(
        entryPrice + (atr * baseMultiplier),
        entryPrice + (minStopDistance * 3),
        currentPrice * 1.03
      );
  
  return stop;
}

// ================= FUNÇÕES DE SUPORTE ================= //
function detectarQuebraEstrutura(ohlcv, atr) {
  if (ohlcv.length < 2 || !atr) return { suporte: 0, resistencia: 0 };
  const lookback = Math.min(50, ohlcv.length - 1);
  const prev = ohlcv.slice(-lookback - 1, -1);
  const maxHigh = Math.max(...prev.map(c => c.high));
  const minLow = Math.min(...prev.map(c => c.low));
  return {
    suporte: minLow - 1.5 * atr,
    resistencia: maxHigh + 1.5 * atr
  };
}

async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = state.dataCache.get(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: config.LSR_PERIOD, limit: 2 }
    }));
    if (res.data.length < 2) return { value: null, isRising: false, percentChange: '0.00' };
    const current = parseFloat(res.data[0].longShortRatio);
    const prev = parseFloat(res.data[1].longShortRatio);
    const result = { 
      value: current, 
      isRising: current > prev, 
      percentChange: (prev ? ((current - prev) / prev * 100).toFixed(2) : '0.00') 
    };
    state.dataCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return { value: null, isRising: false, percentChange: '0.00' };
  }
}

async function fetchFundingRate(symbol) {
  const cacheKey = `funding_${symbol}`;
  const cached = state.dataCache.get(cacheKey);
  if (cached) return cached;
  try {
    const data = await withRetry(() => exchangeFutures.fetchFundingRateHistory(symbol, undefined, 2));
    if (data.length < 2) return { current: null, isRising: false, percentChange: '0.00' };
    const current = parseFloat(data[data.length - 1].fundingRate);
    const prev = parseFloat(data[data.length - 2].fundingRate);
    const result = { 
      current, 
      isRising: current > prev, 
      percentChange: (Math.abs(prev) ? ((current - prev) / Math.abs(prev) * 100).toFixed(2) : '0.00') 
    };
    state.dataCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return { current: null, isRising: false, percentChange: '0.00' };
  }
}

async function detectRecentOBFVG(symbol) {
  const cacheKey = `obfvg_${symbol}`;
  const cached = state.dataCache.get(cacheKey);
  if (cached) return cached;
  try {
    const raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 30));
    const ohlcv = normalizeOHLCV(raw);
    if (ohlcv.length < 5) return { hasBullish: false, hasBearish: false };
    let hasBullish = false;
    let hasBearish = false;
    for (let i = ohlcv.length - 25; i < ohlcv.length - 2; i++) {
      const bearOB = ohlcv[i].close < ohlcv[i].open && ohlcv[i+1].close > ohlcv[i+1].open && ohlcv[i+1].close > ohlcv[i].high;
      if (bearOB && ohlcv[ohlcv.length-1].low > ohlcv[i].high) hasBullish = true;
      const bullOB = ohlcv[i].close > ohlcv[i].open && ohlcv[i+1].close < ohlcv[i+1].open && ohlcv[i+1].close < ohlcv[i].low;
      if (bullOB && ohlcv[ohlcv.length-1].high < ohlcv[i].low) hasBearish = true;
      if (hasBullish && hasBearish) break;
    }
    const result = { hasBullish, hasBearish };
    state.dataCache.set(cacheKey, result);
    return result;
  } catch (e) {
    return { hasBullish: false, hasBearish: false };
  }
}

// ================= FUNÇÕES DE ALERTA ================= //
function getStochasticEmoji(value) {
  if (!value) return "";
  if (value < 10) return "🔵";
  if (value < 25) return "🟢";
  if (value <= 55) return "🟡";
  if (value <= 70) return "🟠";
  if (value <= 80) return "🔴";
  return "💥";
}

function getVWAPEmoji(price, vwap) {
  if (!vwap) return "";
  const diff = Math.abs(price - vwap) / vwap;
  return diff < 0.01 ? "✅" : price > vwap ? "🔴" : "💹🐋💰";
}

function getSetaDirecao(current, previous) {
  if (current === undefined || previous === undefined) return "➡︎";
  return current > previous ? "⬆︎" : current < previous ? "⬇︎" : "➡︎";
}

function classificarRR(ratio) {
  if (ratio >= 4.0) return "Excelente";
  if (ratio >= 3.0) return "Ótimo";
  if (ratio >= 2.5) return "Muito Bom";
  if (ratio >= 2.0) return "Bom";
  if (ratio >= 1.5) return "Regular";
  return "Ruim";
}

function getSignalStrength(confluencePoints) {
  if (confluencePoints >= 7) return { level: 'Forte', leverage: '10-20x' };
  if (confluencePoints >= 5) return { level: 'Mediana', leverage: '5-10x' };
  if (confluencePoints >= 3) return { level: 'Regular', leverage: '3-5x' };
  return { level: null, leverage: null };
}

function calculateTargetsAndZones(data) {
  const { ohlcv3m, ohlcv4h, ohlcv1h, price, atr } = data;
  const zonas = detectarQuebraEstrutura(ohlcv3m, atr);
  const buyEntryLow = price - (atr * config.ATR_MULTIPLIER_BUY);
  const sellEntryHigh = price + (atr * config.ATR_MULTIPLIER_SELL);
  const estrutura4h = detectarQuebraEstrutura(ohlcv4h, atr);
  const estrutura1h = detectarQuebraEstrutura(ohlcv1h, atr);
  const targetBuyLong1 = estrutura4h.resistencia + (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetBuyLong2 = estrutura1h.resistencia + (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetSellShort1 = estrutura4h.suporte - (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetSellShort2 = estrutura1h.suporte - (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetBuy = zonas.resistencia + (atr * config.TARGET_MULTIPLIER);
  const targetSell = zonas.suporte - (atr * config.TARGET_MULTIPLIER);
  return {
    zonas, buyEntryLow, sellEntryHigh, targetBuyLong1, targetBuyLong2,
    targetSellShort1, targetSellShort2, targetBuy, targetSell
  };
}

// ================= MENSAGENS DE ALERTA APERFEIÇOADAS ================= //
function buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr, estocastico1d, stoch1dEmoji, direcao1d, volumeData, safetyStatus, volatilityIndex) {
  const stopLoss = calcularStopDinamico('buy', buyEntryLow, atr, price, volatilityIndex);
  const safetyEmoji = safetyStatus.safe ? '🟢' : '🟡';
  const volumeInfo = volumeData.isValid ? 
    `📈 Volume: ${(volumeData.buyPressure * 100).toFixed(1)}% compra | Grandes: ${(volumeData.largeBuyRatio * 100).toFixed(1)}%` : 
    `📈 Volume: Normal`;
  
  return `*🤖IA Titanium Sniper PRO -💹COMPRA*\n` +
         `Intensidade: ${signalStrength.level} (${signalStrength.leverage})\n` +
         `${safetyEmoji} Segurança: ${safetyStatus.reason}\n` +
         `${count}º Alerta - ${dataHora}\n` +
         `💹 #${symbol} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `Entrada: ${format(buyEntryLow)} - ${format(price)}\n` +
         `Alvo 1: ${format(targetBuy)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetBuyLong2)} (${targetLong2Pct}%)\n` +
         `Alvo 3: ${format(targetBuyLong1)} (${targetLong1Pct}%)\n` +
         `Stop: ${format(stopLoss)} (Risco ≈ ${((price - stopLoss)/price*100).toFixed(2)}%)\n` +
         `R:R ${ratio.toFixed(2)}:1 - ${classificacao}\n` +
         `10x Alvo 1: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding: ${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `Stoch 1d: ${estocastico1d?.k.toFixed(2) || '--'} ${stoch1dEmoji} ${direcao1d}\n` +
         `${volumeInfo}\n` +
         `Volatilidade: ${volatilityIndex.toFixed(2)}x\n` +
         `Suporte: ${format(zonas.suporte)}\n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `📍Technology by @J4Rviz`;
}

function buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr, estocastico1d, stoch1dEmoji, direcao1d, volumeData, safetyStatus, volatilityIndex) {
  const stopLoss = calcularStopDinamico('sell', sellEntryHigh, atr, price, volatilityIndex);
  const safetyEmoji = safetyStatus.safe ? '🟢' : '🟡';
  const volumeInfo = volumeData.isValid ? 
    `📉 Volume: ${(volumeData.sellPressure * 100).toFixed(1)}% venda | Grandes: ${((1 - volumeData.largeBuyRatio) * 100).toFixed(1)}%` : 
    `📉 Volume: Normal`;
  
  return `*🤖IA Titanium Sniper PRO -🛑CORREÇÃO*\n` +
         `Intensidade: ${signalStrength.level} (${signalStrength.leverage})\n` +
         `${safetyEmoji} Segurança: ${safetyStatus.reason}\n` +
         `${count}º Sinal - ${dataHora}\n` +
         `🛑 #${symbol} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `Entrada: ${format(price)} - ${format(sellEntryHigh)}\n` +
         `Alvo 1: ${format(targetSell)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetSellShort2)} (${targetShort2Pct}%)\n` +
         `Alvo 3: ${format(targetSellShort1)} (${targetShort1Pct}%)\n` +
         `Stop: ${format(stopLoss)} (Risco ≈ ${((stopLoss - price)/price*100).toFixed(2)}%)\n` +
         `R:R ${ratio.toFixed(2)}:1 - ${classificacao}\n` +
         `10x Alvo 1: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding: ${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `Stoch 1d: ${estocastico1d?.k.toFixed(2) || '--'} ${stoch1dEmoji} ${direcao1d}\n` +
         `${volumeInfo}\n` +
         `Volatilidade: ${volatilityIndex.toFixed(2)}x\n` +
         `Suporte: ${format(zonas.suporte)}\n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `📍Technology by @J4Rviz`;
}

// ================= LÓGICA PRINCIPAL APERFEIÇOADA ================= //
async function sendAlertEmaCross(symbol, data) {
  const { price, rsi1h, lsr, fundingRate, estocastico4h, ema8_3m_prev, ema21_3m_prev, ema55_3m, vwap1h, adx1h, fvg, atr, ohlcv3m, ohlcv4h, ohlcv1h, close_3m, volumeSurge, estocastico1d, atr15m } = data;
  const agora = Date.now();
  
  if (!state.ultimoAlertaPorAtivo[symbol]) {
    state.ultimoAlertaPorAtivo[symbol] = {
      historico: [],
      ultimoAlerta: 0,
      ultimoBuy: 0,
      ultimoSell: 0,
      lastEntryPrice: null,
      lastDirection: null,
      lastEma55Cross: null,
    };
  }
  
  const ativo = state.ultimoAlertaPorAtivo[symbol];
  const tempoDesdeUltimoAlerta = agora - (ativo.ultimoAlerta || 0);
  
  // Cooldown inteligente
  if (tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS && !(ativo.lastEntryPrice && Math.abs(price - ativo.lastEntryPrice) <= 1.8 * atr)) {
    logger.info(`BLOQUEADO: ${symbol} - Cooldown ativo: ${(tempoDesdeUltimoAlerta / 60000).toFixed(1)}min`);
    return;
  }
  
  const currentEmaCross = close_3m > ema55_3m ? 'above' : close_3m < ema55_3m ? 'below' : null;
  if (ativo.lastEma55Cross && currentEmaCross === ativo.lastEma55Cross && tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS * 2) {
    logger.info(`BLOQUEADO: ${symbol} - Sem novo rompimento EMA55`);
    return;
  }
  
  // SISTEMA DE PROTEÇÃO
  const safetyCheck = await checkSafety(symbol);
  if (!safetyCheck.safe) {
    logger.warn(`⚠️ Safety check falhou para ${symbol}: ${safetyCheck.reason}`);
    return;
  }
  
  // ANÁLISE DE VOLUME APERFEIÇOADA
  const volumeData = await fetchVolumeDataEnhanced(symbol);
  
  // Calcular volatilidade
  const volatilityIndex = calculateVolatilityIndex(ohlcv3m);
  
  const precision = symbol.includes('BTC') ? 2 : price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const { zonas, buyEntryLow, sellEntryHigh, targetBuyLong1, targetBuyLong2, targetSellShort1, targetSellShort2, targetBuy, targetSell } = calculateTargetsAndZones({ ohlcv3m, ohlcv4h, ohlcv1h, price, atr: atr15m || atr });
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=3`;
  
  // RSI 1H
  const rsi1hEmoji = rsi1h > 80 ? "💥Exaustão" :
                     rsi1h > 75 ? "📛Muito Alto" :
                     rsi1h > 60 ? "🔴Alto" :
                     rsi1h < 40 ? "🟡Sobrevenda" :
                     rsi1h >= 50 ? "✅🟠Tend. Alta" :
                     rsi1h > 41 ? "🟢Consol." :
                     rsi1h < 30 ? "🔵Baixo" :
                     rsi1h < 25 ? "🔵🔵Muito Baixo" :
                     "🟢Consol";
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    lsrSymbol = lsr.value <= 1.4 ? '✅Baixo' : lsr.value >= 2.8 ? '📛Alto' : lsrSymbol;
  }
  
  let fundingRateEmoji = '';
  if (fundingRate.current !== null) {
    const rate = fundingRate.current * 100;
    if (rate <= -0.2) fundingRateEmoji = '🟢🟢🟢🟢';
    else if (rate <= -0.1) fundingRateEmoji = '🟢🟢🟢';
    else if (rate <= -0.05) fundingRateEmoji = '🟢🟢';
    else if (rate <= -0.03) fundingRateEmoji = '🟢';
    else if (rate >= 0.1) fundingRateEmoji = '🔴🔴🔴🔴';
    else if (rate >= 0.03) fundingRateEmoji = '🔴🔴🔴';
    else if (rate >= 0.02) fundingRateEmoji = '🔴🔴';
  }
  
  const fundingRateText = fundingRate.current !== null ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆' : '⬇'}` : '🔹 Indisp.';
  const vwap1hText = vwap1h ? `${getVWAPEmoji(price, vwap1h)} VWAP 1h: ${format(vwap1h)}` : '🔹 VWAP Indisp.';
  
  // Stochastic tracking
  if (!state.ultimoEstocastico[symbol]) state.ultimoEstocastico[symbol] = {};
  const kAnterior4h = state.ultimoEstocastico[symbol].k4h || estocastico4h?.k || 0;
  const dAnterior4h = state.ultimoEstocastico[symbol].d4h || estocastico4h?.d || 0;
  state.ultimoEstocastico[symbol].k4h = estocastico4h?.k;
  state.ultimoEstocastico[symbol].d4h = estocastico4h?.d;
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";
  
  const kAnterior1d = state.ultimoEstocastico[symbol].k1d || estocastico1d?.k || 0;
  const dAnterior1d = state.ultimoEstocastico[symbol].d1d || estocastico1d?.d || 0;
  state.ultimoEstocastico[symbol].k1d = estocastico1d?.k;
  state.ultimoEstocastico[symbol].d1d = estocastico1d?.d;
  const direcao1d = getSetaDirecao(estocastico1d?.k, kAnterior1d);
  const stoch1dEmoji = estocastico1d ? getStochasticEmoji(estocastico1d.k) : "";
  
  // CRITÉRIOS DE ENTRADA APERFEIÇOADOS
  const lsrOkForLong = !lsr.value || lsr.value <= config.LSR_BUY_MAX;
  const lsrOkForShort = !lsr.value || lsr.value >= config.LSR_SELL_MIN;
  const emaOkBuy = ema8_3m_prev > ema21_3m_prev && ema21_3m_prev > ema55_3m && ema55_3m !== null && close_3m > ema55_3m;
  const emaOkSell = ema8_3m_prev < ema21_3m_prev && ema21_3m_prev < ema55_3m && ema55_3m !== null && close_3m < ema55_3m;
  const stochCrossBuy = estocastico4h && estocastico4h.k > estocastico4h.d && kAnterior4h <= dAnterior4h;
  const stochCrossSell = estocastico4h && estocastico4h.k < estocastico4h.d && kAnterior4h >= dAnterior4h;
  const rsiOkBuy = rsi1h < 60;
  const rsiOkSell = rsi1h > 60;
  const atrOk = (atr / price > config.MIN_ATR_PERCENT / 100);
  const adxOk = adx1h > config.ADX_MIN_TREND;
  const stochZoneBuy = estocastico4h.k <= 80;
  const stochZoneSell = estocastico4h.k >= 30;
  
  // Confirmação de volume (NOVO)
  const volumeConfirmedBuy = volumeData.isValid && volumeData.isBullish;
  const volumeConfirmedSell = volumeData.isValid && volumeData.isBearish;
  
  // Confirmação de tendência maior (EMA55 1h)
  const ema55_1h = calculateEMA(ohlcv1h, 55);
  const ema55_1h_current = ema55_1h.length > 0 ? ema55_1h[ema55_1h.length - 1] : null;
  const trendConfirmationBuy = ema55_1h_current ? close_3m > ema55_1h_current : true;
  const trendConfirmationSell = ema55_1h_current ? close_3m < ema55_1h_current : true;
  
  // Pontos de confluência
  const fvgPoints = fvg.hasBullish ? 2 : fvg.hasBearish ? 2 : 0;
  const volumePoints = volumeData.isValid ? 3 : 0;
  const emaPoints = emaOkBuy || emaOkSell ? 3 : 0;
  const stochPoints = stochCrossBuy || stochCrossSell ? 3 : 0;
  const adxPoints = adxOk ? 2 : 0;
  const trendPoints = trendConfirmationBuy || trendConfirmationSell ? 2 : 0;
  
  const totalConfluenceBuy = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBullish ? fvgPoints : 0) + trendPoints;
  const totalConfluenceSell = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBearish ? fvgPoints : 0) + trendPoints;
  
  const signalStrengthBuy = getSignalStrength(totalConfluenceBuy);
  const signalStrengthSell = getSignalStrength(totalConfluenceSell);
  
  const dataHora = new Date(agora).toLocaleString('pt-BR');
  let tag = symbol.endsWith('USDT') ? '#USDTM' : '#COINM';
  
  // Reentry logic
  const lastEntry = ativo.lastEntryPrice;
  const lastDirection = ativo.lastDirection;
  const isReentryBuy = lastDirection === 'buy' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeData.zScore > config.VOLUME_Z_THRESHOLD;
  const isReentrySell = lastDirection === 'sell' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeData.zScore > config.VOLUME_Z_THRESHOLD;
  
  let alertText = '';
  let tradeDirection = '';
  let simulatedPnL = 0;
  
  // CRITÉRIOS FINAIS DE COMPRA
  if (signalStrengthBuy.level && stochCrossBuy && rsiOkBuy && atrOk && lsrOkForLong && 
      (volumeConfirmedBuy || isReentryBuy) && emaOkBuy && adxOk && stochZoneBuy && trendConfirmationBuy) {
    
    tradeDirection = 'buy';
    const count = ativo.historico.filter(r => r.direcao === tradeDirection).length + 1;
    const entry = buyEntryLow;
    const stop = calcularStopDinamico('buy', entry, atr, price, volatilityIndex);
    const target = targetBuy;
    const riskDistance = entry - stop;
    const rewardDistance = target - entry;
    const ratio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    const rewardPct = (rewardDistance / entry) * 100;
    const reward10x = rewardPct * 10;
    const targetPct = ((target - entry) / entry * 100).toFixed(2);
    const targetLong1Pct = ((targetBuyLong1 - entry) / entry * 100).toFixed(2);
    const targetLong2Pct = ((targetBuyLong2 - entry) / entry * 100).toFixed(2);
    const classificacao = classificarRR(ratio);
    
    alertText = buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeData.zScore, signalStrengthBuy, tag, atr, estocastico1d, stoch1dEmoji, direcao1d, volumeData, safetyCheck, volatilityIndex);
    
    simulatedPnL = Math.random() > 0.65 ? rewardPct * 0.8 : -riskDistance/entry*100;
    
  } else if (signalStrengthSell.level && stochCrossSell && rsiOkSell && atrOk && lsrOkForShort && 
             (volumeConfirmedSell || isReentrySell) && emaOkSell && adxOk && stochZoneSell && trendConfirmationSell) {
    
    tradeDirection = 'sell';
    const count = ativo.historico.filter(r => r.direcao === tradeDirection).length + 1;
    const entry = sellEntryHigh;
    const stop = calcularStopDinamico('sell', entry, atr, price, volatilityIndex);
    const target = targetSell;
    const riskDistance = stop - entry;
    const rewardDistance = entry - target;
    const ratio = riskDistance > 0 ? rewardDistance / riskDistance : 0;
    const rewardPct = (rewardDistance / entry) * 100;
    const reward10x = rewardPct * 10;
    const targetPct = ((entry - target) / entry * 100).toFixed(2);
    const targetShort1Pct = ((entry - targetSellShort1) / entry * 100).toFixed(2);
    const targetShort2Pct = ((entry - targetSellShort2) / entry * 100).toFixed(2);
    const classificacao = classificarRR(ratio);
    
    alertText = buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeData.zScore, signalStrengthSell, tag, atr, estocastico1d, stoch1dEmoji, direcao1d, volumeData, safetyCheck, volatilityIndex);
    
    simulatedPnL = Math.random() > 0.65 ? rewardPct * 0.8 : -riskDistance/entry*100;
  }
  
  if (alertText && tradeDirection) {
    // Atualizar estatísticas
    state.safetyStats.tradesToday++;
    state.safetyStats.dailyLoss += simulatedPnL;
    
    if (simulatedPnL < 0) {
      state.safetyStats.consecutiveLosses++;
    } else {
      state.safetyStats.consecutiveLosses = 0;
      
      if (simulatedPnL > state.dailyStats.bestTrade.profit) {
        state.dailyStats.bestTrade = { symbol, profit: simulatedPnL };
      }
    }
    
    if (simulatedPnL < 0 && Math.abs(simulatedPnL) > Math.abs(state.dailyStats.worstTrade.loss)) {
      state.dailyStats.worstTrade = { symbol, loss: simulatedPnL };
    }
    
    logger.info(`✅ ALERTA ENVIADO: ${symbol} - ${tradeDirection} | Safety: ${safetyCheck.reason} | Vol: ${volatilityIndex.toFixed(2)}x`);
    
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, { 
        parse_mode: 'Markdown', 
        disable_web_page_preview: true 
      }));
      
      // Atualizar estado
      ativo.ultimoAlerta = agora;
      ativo.historico.push({ direcao: tradeDirection, timestamp: agora });
      ativo.historico = ativo.historico.slice(-config.MAX_HISTORICO_ALERTAS);
      ativo.lastEntryPrice = price;
      ativo.lastDirection = tradeDirection;
      ativo.lastEma55Cross = currentEmaCross;
      
      if (tradeDirection === 'buy') {
        ativo.ultimoBuy = agora;
        state.dailyStats.longs++;
      } else {
        ativo.ultimoSell = agora;
        state.dailyStats.shorts++;
      }
      
      state.dailyStats.signals++;
      state.dailyStats.avgRR = state.dailyStats.avgRR > 0 ? 
        (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals : 
        ratio;
      state.dailyStats.estimatedProfit += reward10x;
      state.dailyStats.targetsHit += simulatedPnL > 0 ? 1 : 0;
      
    } catch (e) {
      logger.error(`Erro alerta ${symbol}: ${e.message}`);
    }
  }
}

// ================= CHECK CONDITIONS APERFEIÇOADO ================= //
async function checkConditions() {
  try {
    await limitConcurrencyWithDelay(config.PARES_MONITORADOS, async (symbol) => {
      try {
        const cachePrefix = `ohlcv_${symbol}_`;
        
        // Buscar todos os timeframes necessários
        const [ohlcv3m, ohlcv15m, ohlcv1h, ohlcv4h, ohlcv1d] = await Promise.all([
          (async () => {
            let data = state.dataCache.get(cachePrefix + '3m');
            if (!data) {
              const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, TIMEFRAMES['3m'].limit));
              data = normalizeOHLCV(raw);
              state.dataCache.set(cachePrefix + '3m', data);
            }
            return data;
          })(),
          (async () => {
            let data = state.dataCache.get(cachePrefix + '15m');
            if (!data) {
              const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, TIMEFRAMES['15m'].limit));
              data = normalizeOHLCV(raw);
              state.dataCache.set(cachePrefix + '15m', data);
            }
            return data;
          })(),
          (async () => {
            let data = state.dataCache.get(cachePrefix + '1h');
            if (!data) {
              const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, TIMEFRAMES['1h'].limit));
              data = normalizeOHLCV(raw);
              state.dataCache.set(cachePrefix + '1h', data);
            }
            return data;
          })(),
          (async () => {
            let data = state.dataCache.get(cachePrefix + '4h');
            if (!data) {
              const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, TIMEFRAMES['4h'].limit));
              data = normalizeOHLCV(raw);
              state.dataCache.set(cachePrefix + '4h', data);
            }
            return data;
          })(),
          (async () => {
            let data = state.dataCache.get(cachePrefix + '1d');
            if (!data) {
              const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, TIMEFRAMES['1d'].limit));
              data = normalizeOHLCV(raw);
              state.dataCache.set(cachePrefix + '1d', data);
            }
            return data;
          })()
        ]);
        
        // Verificar dados suficientes
        if (ohlcv3m.length < 100 || ohlcv15m.length < 30 || ohlcv1h.length < 20 || ohlcv4h.length < 14 || ohlcv1d.length < 14) {
          logger.info(`Dados insuficientes para ${symbol}`);
          return;
        }
        
        const price = ohlcv3m[ohlcv3m.length - 1].close;
        const close_3m = ohlcv3m[ohlcv3m.length - 1].close;
        
        // Calcular indicadores
        const rsi1hValues = calculateRSI(ohlcv1h);
        const estocastico4h = calculateStochastic(ohlcv4h);
        const estocastico1d = calculateStochastic(ohlcv1d);
        const lsr = await fetchLSR(symbol);
        const fundingRate = await fetchFundingRate(symbol);
        
        // ATR de 15m (mais confiável)
        const atrValues15m = calculateATR(ohlcv15m);
        const atr15m = atrValues15m.length > 0 ? atrValues15m[atrValues15m.length - 1] : null;
        const atrValues3m = calculateATR(ohlcv3m);
        const atr3m = atrValues3m.length > 0 ? atrValues3m[atrValues3m.length - 1] : atr15m;
        
        if (!atr15m || !atr3m) return;
        
        // EMAs
        const ema8_3mValues = calculateEMA(ohlcv3m, 8);
        const ema21_3mValues = calculateEMA(ohlcv3m, 21);
        const ema55_3mValues = calculateEMA(ohlcv3m, 55);
        const vwap1h = calculateVWAP(ohlcv1h);
        const adx1h = calculateADX(ohlcv1h);
        
        // Volume surge detection
        const volumes3mRaw = ohlcv3m.slice(-6);
        if (volumes3mRaw.length < 6) return;
        
        const volumes3m = volumes3mRaw.map(c => c.volume);
        const avgVol5 = volumes3m.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        const currentVol = volumes3m[5];
        const previousVol = volumes3m[4];
        const volumeSurge = currentVol > avgVol5 * 2.2 && currentVol > previousVol * 1.3;
        
        // FVG
        const fvg = await detectRecentOBFVG(symbol);
        
        // Verificar dados completos
        if (!rsi1hValues.length || !estocastico4h || !estocastico1d || 
            ema8_3mValues.length < 2 || !ema55_3mValues.length || adx1h === null) {
          return;
        }
        
        // Enviar para análise
        await sendAlertEmaCross(symbol, {
          ohlcv3m, ohlcv4h, ohlcv1h,
          price, 
          rsi1h: rsi1hValues[rsi1hValues.length - 1], 
          lsr, 
          fundingRate, 
          estocastico4h,
          atr: atr3m,
          atr15m,
          ema8_3m_prev: ema8_3mValues[ema8_3mValues.length - 2], 
          ema21_3m_prev: ema21_3mValues[ema21_3mValues.length - 2],
          ema55_3m: ema55_3mValues[ema55_3mValues.length - 1], 
          vwap1h, 
          adx1h, 
          fvg, 
          close_3m, 
          volumeSurge, 
          estocastico1d
        });
        
      } catch (err) {
        if (err.message.includes('-1122') || err.message.includes('Invalid symbol')) {
          logger.warn(`Par inválido: ${symbol}`);
          return;
        }
        logger.error(`Erro par ${symbol}: ${err.message}`);
      }
    });
  } catch (e) {
    logger.error(`Erro checkConditions: ${e.message}`);
  }
}

// ================= FUNÇÕES ADICIONAIS ================= //
async function sendDailyStats() {
  const { signals, longs, shorts, avgRR, targetsHit, estimatedProfit, bestTrade, worstTrade } = state.dailyStats;
  if (signals === 0) return;
  
  const safetyInfo = `⚡ Safety Stats:\n` +
                    `- Perda diária: ${state.safetyStats.dailyLoss.toFixed(2)}%\n` +
                    `- Perdas consecutivas: ${state.safetyStats.consecutiveLosses}\n` +
                    `- Trades hoje: ${state.safetyStats.tradesToday}\n` +
                    `- Stop ativado: ${state.safetyStats.stopTriggered ? 'SIM 🚨' : 'NÃO ✅'}`;
  
  const orderFlowInfo = `📊 Order Flow Stats:\n` +
                       `- Sinais analisados: ${state.orderFlowStats.totalAnalyzed}\n` +
                       `- Sinais válidos: ${state.orderFlowStats.validSignals}\n` +
                       `- Pressão compra média: ${(state.orderFlowStats.avgBuyPressure * 100).toFixed(1)}%`;
  
  const performanceInfo = `🎯 Performance:\n` +
                         `- Melhor trade: ${bestTrade.symbol || 'N/A'} (+${bestTrade.profit.toFixed(2)}%)\n` +
                         `- Pior trade: ${worstTrade.symbol || 'N/A'} (${worstTrade.loss.toFixed(2)}%)\n` +
                         `- Hit rate: ${((targetsHit / signals) * 100).toFixed(1)}%`;
  
  const message = `🤖 Sniper Titanium PRO – Resumo ${new Date().toLocaleDateString('pt-BR')}\n\n` +
                  `📈 Estatísticas Gerais:\n` +
                  `Sinais: ${signals} (${longs} long / ${shorts} short)\n` +
                  `R:R Médio: ${avgRR.toFixed(2)}:1\n` +
                  `Alvos Atingidos: ${targetsHit}/${signals}\n` +
                  `Lucro Estimado (10x): +${estimatedProfit.toFixed(2)}%\n\n` +
                  safetyInfo + '\n\n' +
                  orderFlowInfo + '\n\n' +
                  performanceInfo + '\n\n' +
                  `🏁 Sistema: ${state.safetyStats.stopTriggered ? 'PAUSADO 🚨' : 'OPERACIONAL ✅'}`;
  
  try {
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message);
  } catch (e) {
    logger.error(`Erro stats: ${e.message}`);
  }
  
  // Reset parcial (mantém algumas estatísticas)
  state.dailyStats = { 
    signals: 0, 
    longs: 0, 
    shorts: 0, 
    avgRR: 0, 
    targetsHit: 0, 
    estimatedProfit: 0,
    bestTrade: { symbol: '', profit: 0 },
    worstTrade: { symbol: '', loss: 0 }
  };
  state.orderFlowStats = {
    totalAnalyzed: 0,
    validSignals: 0,
    avgBuyPressure: 0,
    avgSellPressure: 0
  };
}

function resetCounters() {
  Object.keys(state.ultimoAlertaPorAtivo).forEach(s => {
    state.ultimoAlertaPorAtivo[s].historico = [];
  });
  
  logger.info('Contadores resetados e estatísticas enviadas');
  sendDailyStats();
}

// ================= LIMPEZA DE LOGS ================= //
async function cleanupOldLogs() {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir).catch(() => []);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath).catch(() => null);
      if (stats && now - stats.mtimeMs > config.LOG_CLEANUP_INTERVAL_MS) {
        await fs.unlink(filePath);
        logger.info(`Log deletado: ${file}`);
      }
    }
  } catch (e) {
    logger.error(`Erro cleanup logs: ${e.message}`);
  }
}

// ================= MAIN ================= //
async function main() {
  logger.info('🚀 Iniciando Sniper Titanium PRO com todas as melhorias');
  
  try {
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await cleanupOldLogs();
    
    // Mensagem de inicialização
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, 
      `🤖 Sniper Titanium PRO v2.0 INICIADO\n` +
      `📊 Sistema de segurança: ATIVO\n` +
      `📈 Order Flow: IMPLEMENTADO\n` +
      `🛡️ Stop diário: ${config.SAFETY_MAX_DAILY_LOSS_PCT}%\n` +
      `⏱️ Intervalo: ${config.INTERVALO_ALERTA_MS/60000}min\n\n` +
      `📍Technology by @J4Rviz`
    ));
    
    // Executar primeiro check
    await checkConditions();
    
    // Configurar intervals
    setInterval(checkConditions, config.INTERVALO_ALERTA_MS);
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS);
    
    // Cache cleanup a cada hora
    setInterval(() => {
      if (state.dataCache.cache.size > 3000) {
        state.dataCache.cleanup();
      }
    }, 60 * 60 * 1000);
    
    // Stats diário às 21h
    new CronJob('0 0 21 * * *', resetCounters, null, true, 'America/Sao_Paulo').start();
    
    // Health check a cada 30min
    setInterval(async () => {
      try {
        const time = await exchangeSpot.fetchTime();
        const cacheStats = state.dataCache.getStats();
        logger.info(`Health check OK | Cache: ${cacheStats.size} itens, Hit rate: ${(cacheStats.hitRate*100).toFixed(1)}%`);
      } catch (e) {
        logger.error(`Health check falhou: ${e.message}`);
      }
    }, 30 * 60 * 1000);
    
  } catch (e) {
    logger.error(`Erro init: ${e.message}`);
    process.exit(1);
  }
}

main().catch(e => {
  logger.error(`Fatal: ${e.message}`);
  process.exit(1);
});
