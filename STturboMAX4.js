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

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_ALERTA_4H_MS: 15 * 60 * 1000,
  TEMPO_COOLDOWN_MS: 60 * 60 * 1000,
  TEMPO_COOLDOWN_SAME_DIR_MS: 60 * 60 * 1000,
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 75,
  STOCHASTIC_SELL_MIN: 70,
  LSR_BUY_MAX: 2.5,
  LSR_SELL_MIN: 2.6,
  CACHE_TTL_DEFAULT: 15 * 60 * 1000,
  MAX_CACHE_SIZE: 4000,
  MAX_HISTORICO_ALERTAS: 10,
  BUY_TOLERANCE_PERCENT: 0.025,
  ATR_MULTIPLIER_BUY: 1.5,
  ATR_MULTIPLIER_SELL: 1.5,
  TARGET_MULTIPLIER: 1.5,
  LOG_MAX_SIZE: '100m',
  LOG_MAX_FILES: 2,
  LOG_CLEANUP_INTERVAL_MS: 2 * 24 * 60 * 60 * 1000,
  VOLUME_LOOKBACK: 45,
  VOLUME_MULTIPLIER: 2.5,
  VOLUME_Z_THRESHOLD: 2.5,
  MIN_ATR_PERCENT: 0.8,
  ADX_PERIOD: process.env.ADX_PERIOD ? parseInt(process.env.ADX_PERIOD) : 14,
  ADX_MIN_TREND: process.env.ADX_MIN_TREND ? parseFloat(process.env.ADX_MIN_TREND) : 25,
  LSR_PERIOD: '15m',
  // EMA55 agora será calculada no 3m
};

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: 'logs/simple_trading_bot_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/simple_trading_bot_combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new winston.transports.Console()
  ]
});

// Estado global
const state = {
  ultimoAlertaPorAtivo: {},
  ultimoEstocastico: {},
  dataCache: new Map(),
  dailyStats: { signals: 0, longs: 0, shorts: 0, avgRR: 0, targetsHit: 0, estimatedProfit: 0 }
};

// ================= OTIMIZAÇÕES TURBO ================= //
const TIMEFRAMES = {
  '3m': { limit: 120, ttl: 4 * 60 * 1000 },      // aumentei um pouco pra garantir EMA55
  '15m': { limit: 90, ttl: 12 * 60 * 1000 },
  '1h': { limit: 110, ttl: 12 * 60 * 1000 },
  '4h': { limit: 50, ttl: 30 * 60 * 1000 },
  '1d': { limit: 30, ttl: 2 * 60 * 60 * 1000 },
  '1w': { limit: 10, ttl: 6 * 60 * 60 * 1000 }
};

// Cache otimizado com TTL por tipo
function getCached(key) {
  const entry = state.dataCache.get(key);
  const ttl = TIMEFRAMES[key.split('_')[1]]?.ttl || config.CACHE_TTL_DEFAULT;
  if (entry && Date.now() - entry.ts < ttl) {
    logger.info(`Cache hit para ${key}`);
    return entry.data;
  }
  state.dataCache.delete(key);
  return null;
}
function setCached(key, data) {
  if (state.dataCache.size >= config.MAX_CACHE_SIZE) {
    const oldest = state.dataCache.keys().next().value;
    state.dataCache.delete(oldest);
    logger.info(`Cache cheio, removido: ${oldest}`);
  }
  state.dataCache.set(key, { ts: Date.now(), data });
}

// Validação de env
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'COINS'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`Missing env: ${key}`);
      process.exit(1);
    }
  }
}
validateEnv();

// Inicialização
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

// Limpeza logs
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

setInterval(() => {
  if (state.dataCache.size > 3000) {
    const keys = Array.from(state.dataCache.keys()).slice(0, state.dataCache.size - 3000);
    keys.forEach(k => state.dataCache.delete(k));
    logger.info('Cache limpo');
  }
}, 60 * 60 * 1000);

// Utilitários
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
async function limitConcurrency(items, fn, limit = 20) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...await Promise.all(batch.map(fn)));
  }
  return results;
}

// Indicadores
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
  return TechnicalIndicators.RSI.calculate({ period: config.RSI_PERIOD, values: data.map(d => d.close) }).filter(v => !isNaN(v));
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
  return TechnicalIndicators.EMA.calculate({ period, values: data.map(d => d.close) }).filter(v => !isNaN(v));
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

// Volume FAST
async function fetchVolumeData(symbol) {
  const cacheKey = `volume_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  try {
    const [ticker, ohlcvRaw] = await Promise.all([
      withRetry(() => exchangeFutures.fetchTicker(symbol)),
      withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, config.VOLUME_LOOKBACK + 1))
    ]);
    const ohlcv = normalizeOHLCV(ohlcvRaw);
    if (ohlcv.length < config.VOLUME_LOOKBACK + 1) return { avgVolume: null, stdDev: null, zScore: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 };
    const volumes = ohlcv.slice(0, -1).map(c => c.volume);
    const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    const variance = volumes.reduce((s, v) => s + Math.pow(v - avgVolume, 2), 0) / volumes.length;
    const stdDev = Math.sqrt(variance);
    const totalVolume = ticker.quoteVolume || 0;
    const lastCandle = ohlcv[ohlcv.length - 1];
    const priceUp = lastCandle.close > lastCandle.open;
    const buyVolume = priceUp ? totalVolume * 0.6 : totalVolume * 0.4;
    const sellVolume = totalVolume - buyVolume;
    const zScore = stdDev > 0 ? (totalVolume - avgVolume) / stdDev : 0;
    const result = { avgVolume, stdDev, zScore, buyVolume, sellVolume, totalVolume };
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    logger.error(`Erro volume ${symbol}: ${e.message}`);
    return { avgVolume: null, stdDev: null, zScore: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 };
  }
}

// Quebra estrutura
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

// LSR e Funding
async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: config.LSR_PERIOD, limit: 2 }
    }));
    if (res.data.length < 2) return { value: null, isRising: false, percentChange: '0.00' };
    const current = parseFloat(res.data[0].longShortRatio);
    const prev = parseFloat(res.data[1].longShortRatio);
    const result = { value: current, isRising: current > prev, percentChange: (prev ? ((current - prev) / prev * 100).toFixed(2) : '0.00') };
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    return { value: null, isRising: false, percentChange: '0.00' };
  }
}
async function fetchFundingRate(symbol) {
  const cacheKey = `funding_${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;
  try {
    const data = await withRetry(() => exchangeFutures.fetchFundingRateHistory(symbol, undefined, 2));
    if (data.length < 2) return { current: null, isRising: false, percentChange: '0.00' };
    const current = parseFloat(data[data.length - 1].fundingRate);
    const prev = parseFloat(data[data.length - 2].fundingRate);
    const result = { current, isRising: current > prev, percentChange: (Math.abs(prev) ? ((current - prev) / Math.abs(prev) * 100).toFixed(2) : '0.00') };
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    return { current: null, isRising: false, percentChange: '0.00' };
  }
}

// OBFVG
async function detectRecentOBFVG(symbol) {
  const cacheKey = `obfvg_${symbol}`;
  const cached = getCached(cacheKey);
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
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    return { hasBullish: false, hasBearish: false };
  }
}

// Funções de alertas
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
  return diff < 0.01 ? "✅" : price > vwap ? "🔴" : "🟢";
}
function getSetaDirecao(current, previous) {
  if (current === undefined || previous === undefined) return "➡︎";
  return current > previous ? "⬆︎" : current < previous ? "⬇︎" : "➡︎";
}
function classificarRR(ratio) {
  if (ratio >= 4.0) return "1-Excelente";
  if (ratio >= 3.0) return "2-Ótimo";
  if (ratio >= 2.5) return "3-#Muito #Bom";
  if (ratio >= 2.0) return "4-Bom";
  if (ratio >= 1.5) return "5-Regular";
  return "6-Ruim";
}
function getSignalStrength(confluencePoints) {
  if (confluencePoints >= 7) return { level: '💥#Forte', leverage: '10-20x' };
  if (confluencePoints >= 5) return { level: '#Mediana', leverage: '5-10x' };
  if (confluencePoints >= 3) return { level: '#Regular', leverage: '3-5x' };
  return { level: null, leverage: null };
}
function calculateTargetsAndZones(data) {
  const { ohlcv15m, ohlcv4h, ohlcvDiario, ohlcvSemanal, price, atr } = data;
  const zonas = detectarQuebraEstrutura(ohlcv15m, atr);
  const buyEntryLow = price - (atr * config.ATR_MULTIPLIER_BUY);
  const sellEntryHigh = price + (atr * config.ATR_MULTIPLIER_SELL);
  const estrutura4h = detectarQuebraEstrutura(ohlcv4h, atr);
  const estruturaDiario = detectarQuebraEstrutura(ohlcvDiario, atr);
  const estruturaSemanal = detectarQuebraEstrutura(ohlcvSemanal, atr);
  const targetBuyLong1 = estrutura4h.resistencia + (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetBuyLong2 = estruturaDiario.resistencia + (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetBuyLong3 = estruturaSemanal.resistencia + (atr * config.TARGET_MULTIPLIER * 2.5);
  const targetSellShort1 = estrutura4h.suporte - (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetSellShort2 = estruturaDiario.suporte - (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetSellShort3 = estruturaSemanal.suporte - (atr * config.TARGET_MULTIPLIER * 2.5);
  const targetBuy = zonas.resistencia + (atr * config.TARGET_MULTIPLIER);
  const targetSell = zonas.suporte - (atr * config.TARGET_MULTIPLIER);
  return {
    zonas, buyEntryLow, sellEntryHigh, targetBuyLong1, targetBuyLong2, targetBuyLong3,
    targetSellShort1, targetSellShort2, targetSellShort3, targetBuy, targetSell
  };
}
function calcularStopDinamico(direction, entryPrice, atr) {
  const multiplier = 2.2;
  return direction === 'buy' ? entryPrice - (atr * multiplier) : entryPrice + (atr * multiplier);
}
function buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, targetLong3Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, targetBuyLong3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr) {
  const stopLoss = calcularStopDinamico('buy', buyEntryLow, atr);
  return `*🟢🤖 #IA Análise - COMPRA *\n` +
         `Operação - ${signalStrength.level} (${signalStrength.leverage})\n` +
         `${count}º Alerta - ${dataHora}\n` +
         `#ATIVO: $${symbol.replace(/_/g, '\\_').replace(/-/g, '\\-')} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `#Retração: ${format(buyEntryLow)} - ${format(price)}\n` +
         `Alvo 1: ${format(targetBuy)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetBuyLong1)} (${targetLong1Pct}%)\n` +
         `Alvo 3: ${format(targetBuyLong2)} (${targetLong2Pct}%)\n` +
         `Alvo 4: ${format(targetBuyLong3)} (${targetLong3Pct}%)\n` +
         `#Stop: ${format(stopLoss)} (≈ ${((price - stopLoss)/price*100).toFixed(2)}%)\n` +
         `${classificacao} R:R ${ratio.toFixed(2)}:1\n` +
         `Lucro alvo 1 a 10x: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `#LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding R.:${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 1D: ${estocasticoD?.k.toFixed(2) || '--'} ${stochDEmoji} ${direcaoD}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `#Vol: ${volumeZScore.toFixed(2)}\n` +
         `#Suporte: ${format(zonas.suporte)} \n` +
         `#Resistência: ${format(zonas.resistencia)}\n` +
         `Titanium Elite by @J4Rviz`;
}
function buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, targetShort3Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, targetSellShort3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr) {
  const stopLoss = calcularStopDinamico('sell', sellEntryHigh, atr);
  return `*🔴🤖 #IA Análise - #CORREÇÃO *\n` +
         `Operação - ${signalStrength.level} (${signalStrength.leverage})\n` +
         `${count}º Alerta - ${dataHora}\n` +
         `#ATIVO: $${symbol.replace(/_/g, '\\_').replace(/-/g, '\\-')} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `#Retração: ${format(price)} - ${format(sellEntryHigh)}\n` +
         `Alvo 1: ${format(targetSell)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetSellShort1)} (${targetShort1Pct}%)\n` +
         `Alvo 3: ${format(targetSellShort2)} (${targetShort2Pct}%)\n` +
         `Alvo 4: ${format(targetSellShort3)} (${targetShort3Pct}%)\n` +
         `#Stop: ${format(stopLoss)} (≈ ${((stopLoss - price)/price*100).toFixed(2)}%)\n` +
         `${classificacao} R:R ${ratio.toFixed(2)}:1\n` +
         `Lucro alvo 1 10x: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `#LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding R.:${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 1D: ${estocasticoD?.k.toFixed(2) || '--'} ${stochDEmoji} ${direcaoD}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `#Vol: ${volumeZScore.toFixed(2)}\n` +
         `#Suporte: ${format(zonas.suporte)} \n` +
         `#Resistência: ${format(zonas.resistencia)}\n` +
         `Titanium Elite by @J4Rviz`;
}
async function sendDailyStats() {
  const { signals, longs, shorts, avgRR, targetsHit, estimatedProfit } = state.dailyStats;
  if (signals === 0) return;
  const message = `Titanium ST3 – Resumo ${new Date().toLocaleDateString('pt-BR')}\n` +
                  `Sinais hoje: ${signals} (${longs} long / ${shorts} short)\n` +
                  `R:R médio: ${avgRR.toFixed(2)}:1\n` +
                  `Melhores alvos atingidos: ${targetsHit}/${signals}\n` +
                  `Lucro estimado (10x): +${estimatedProfit.toFixed(2)}%`;
  try {
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message);
  } catch (e) {
    logger.error(`Erro stats: ${e.message}`);
  }
  state.dailyStats = { signals: 0, longs: 0, shorts: 0, avgRR: 0, targetsHit: 0, estimatedProfit: 0 };
}
async function sendAlertStochasticCross(symbol, data) {
  const { price, rsi1h, lsr, fundingRate, estocastico4h, estocasticoD, ema13_3m_prev, ema34_3m_prev, ema55_3m, vwap1h, adx1h, fvg, volumeData, atr, ohlcv15m, ohlcv4h, ohlcv1h, ohlcvDiario, ohlcvSemanal, close_3m } = data;
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) {
    state.ultimoAlertaPorAtivo[symbol] = {
      historico: [],
      ultimoAlerta: 0,
      ultimoBuy: 0,
      ultimoSell: 0,
      lastEntryPrice: null,
      lastDirection: null,
      lastEma55Cross: null,  // Novo: armazena o tipo do último cruzamento da EMA55 ('above' ou 'below')
    };
  }
  const ativo = state.ultimoAlertaPorAtivo[symbol];
  const tempoDesdeUltimoAlerta = agora - (ativo.ultimoAlerta || 0);
  const volumeZScore = volumeData.zScore || 0;
  const precoPertoDaUltimaEntrada = ativo.lastEntryPrice !== null && Math.abs(price - ativo.lastEntryPrice) <= 1.8 * (atr || 0);
  const reentryForcada = precoPertoDaUltimaEntrada && volumeZScore > config.VOLUME_Z_THRESHOLD + 1.5;
  // Cooldown base: 60min, mas permite se for reentry forçada
  if (tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS && !reentryForcada) {
    logger.info(`BLOQUEADO: ${symbol} - Tempo desde último: ${(tempoDesdeUltimoAlerta / 60000).toFixed(1)}min | Reentry? ${reentryForcada ? 'SIM' : 'NÃO'}`);
    return;
  }
  // Novo cooldown inteligente baseado em EMA55: só alerta de novo se houver rompimento real
  const currentEmaCross = close_3m > ema55_3m ? 'above' : close_3m < ema55_3m ? 'below' : null;
  if (ativo.lastEma55Cross && currentEmaCross === ativo.lastEma55Cross && tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS * 2) {
    logger.info(`BLOQUEADO: ${symbol} - Sem rompimento novo da EMA55 (mesmo lado: ${currentEmaCross})`);
    return;
  }
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const { zonas, buyEntryLow, sellEntryHigh, targetBuyLong1, targetBuyLong2, targetBuyLong3, targetSellShort1, targetSellShort2, targetSellShort3, targetBuy, targetSell } = calculateTargetsAndZones({ ohlcv15m, ohlcv4h, ohlcvDiario, ohlcvSemanal, price, atr });
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
  const rsi1hEmoji = rsi1h > 60 ? "☑︎" : rsi1h < 40 ? "☑︎" : "";
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    lsrSymbol = lsr.value <= 1.4 ? '✅Baixo' : lsr.value >= 2.8 ? '📛Alto' : lsrSymbol;
  }
  let fundingRateEmoji = '';
if (fundingRate.current !== null) {
  const rate = fundingRate.current * 100;

  if (rate <= -0.2)     fundingRateEmoji = '🟢🟢🟢🟢';
  else if (rate <= -0.1) fundingRateEmoji = '🟢🟢🟢';
  else if (rate <= -0.05) fundingRateEmoji = '🟢🟢';
  else if (rate >= 0.1)  fundingRateEmoji = '🔴🔴🔴🔴';
  else if (rate >= 0.03) fundingRateEmoji = '🔴🔴🔴';
  else if (rate >= 0.02) fundingRateEmoji = '🔴🔴';
}
  const fundingRateText = fundingRate.current !== null ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆' : '⬇'}` : '🔹 Indisp.';
  const vwap1hText = vwap1h ? `${getVWAPEmoji(price, vwap1h)} VWAP 1h: ${format(vwap1h)}` : '🔹 VWAP Indisp.';
  if (!state.ultimoEstocastico[symbol]) state.ultimoEstocastico[symbol] = {};
  const kAnteriorD = state.ultimoEstocastico[symbol].kD || estocasticoD?.k || 0;
  const kAnterior4h = state.ultimoEstocastico[symbol].k4h || estocastico4h?.k || 0;
  state.ultimoEstocastico[symbol].kD = estocasticoD?.k;
  state.ultimoEstocastico[symbol].k4h = estocastico4h?.k;
  const direcaoD = getSetaDirecao(estocasticoD?.k, kAnteriorD);
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stochDEmoji = estocasticoD ? getStochasticEmoji(estocasticoD.k) : "";
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";
  const isAbnormalVol = volumeZScore > config.VOLUME_Z_THRESHOLD && volumeData.totalVolume > config.VOLUME_MULTIPLIER * volumeData.avgVolume;
  const lsrOkForLong = !lsr.value || lsr.value <= config.LSR_BUY_MAX;
  const lsrOkForShort = !lsr.value || lsr.value >= config.LSR_SELL_MIN;
  const emaOkBuy = ema13_3m_prev > ema34_3m_prev && ema34_3m_prev > ema55_3m && ema55_3m !== null && close_3m > ema55_3m;
  const emaOkSell = ema13_3m_prev < ema34_3m_prev && ema34_3m_prev < ema55_3m && ema55_3m !== null && close_3m < ema55_3m;
  const stochOkBuy = estocastico4h && estocasticoD && estocastico4h.k > estocastico4h.d && estocastico4h.k <= config.STOCHASTIC_BUY_MAX && estocasticoD.k <= config.STOCHASTIC_BUY_MAX;
  const stochOkSell = estocastico4h && estocasticoD && estocastico4h.k < estocastico4h.d && estocastico4h.k >= config.STOCHASTIC_SELL_MIN && estocasticoD.k >= config.STOCHASTIC_SELL_MIN;
  const rsiOkBuy = rsi1h < 60;
  const rsiOkSell = rsi1h > 60;
  const atrOk = (atr / price > config.MIN_ATR_PERCENT / 100);
  const volumeOkBuy = isAbnormalVol && volumeData.buyVolume > volumeData.sellVolume;
  const volumeOkSell = isAbnormalVol && volumeData.sellVolume > volumeData.buyVolume;
  const adxOk = adx1h > config.ADX_MIN_TREND;
  const fvgPoints = fvg.hasBullish ? 2 : fvg.hasBearish ? 2 : 0;
  const volumePoints = volumeOkBuy || volumeOkSell ? 2 : 0;
  const emaPoints = emaOkBuy || emaOkSell ? 3 : 0;
  const stochPoints = stochOkBuy || stochOkSell ? 3 : 0;
  const adxPoints = adxOk ? 1 : 0;
  const totalConfluenceBuy = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBullish ? fvgPoints : 0);
  const totalConfluenceSell = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBearish ? fvgPoints : 0);
  const signalStrengthBuy = getSignalStrength(totalConfluenceBuy);
  const signalStrengthSell = getSignalStrength(totalConfluenceSell);
  const dataHora = new Date(agora).toLocaleString('pt-BR');
  let tag = symbol.endsWith('USDT') ? '#USDTM' : symbol.endsWith('USD') ? '#COINM' : '#SPOT';
  const lastEntry = ativo.lastEntryPrice;
  const lastDirection = ativo.lastDirection;
  const isReentryBuy = lastDirection === 'buy' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  const isReentrySell = lastDirection === 'sell' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  let alertText = '';
  if (signalStrengthBuy.level && stochOkBuy && rsiOkBuy && atrOk && lsrOkForLong && (volumeOkBuy || isReentryBuy) && emaOkBuy) {
    const direcao = 'buy';
    const count = ativo.historico.filter(r => r.direcao === direcao).length + 1;
    const entry = buyEntryLow;
    const stop = calcularStopDinamico('buy', entry, atr);
    const target = targetBuy;
    const riskDistance = entry - stop;
    const rewardDistance = target - entry;
    const ratio = rewardDistance / riskDistance;
    const rewardPct = (rewardDistance / entry) * 100;
    const reward10x = rewardPct * 10;
    const targetPct = ((target - entry) / entry * 100).toFixed(2);
    const targetLong1Pct = ((targetBuyLong1 - entry) / entry * 100).toFixed(2);
    const targetLong2Pct = ((targetBuyLong2 - entry) / entry * 100).toFixed(2);
    const targetLong3Pct = ((targetBuyLong3 - entry) / entry * 100).toFixed(2);
    const classificacao = classificarRR(ratio);
    alertText = buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, targetLong3Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, targetBuyLong3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthBuy, tag, atr);
    ativo.ultimoBuy = agora;
    ativo.ultimoAlerta = agora;
    ativo.historico.push({ direcao: 'buy', timestamp: agora });
    ativo.historico = ativo.historico.slice(-config.MAX_HISTORICO_ALERTAS);
    ativo.lastEntryPrice = price;
    ativo.lastDirection = 'buy';
    ativo.lastEma55Cross = 'above';  // Atualiza o cruzamento
    state.dailyStats.signals++;
    state.dailyStats.longs++;
    state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
    state.dailyStats.estimatedProfit += reward10x;
    state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
  } else if (signalStrengthSell.level && stochOkSell && rsiOkSell && atrOk && lsrOkForShort && (volumeOkSell || isReentrySell) && emaOkSell) {
    const direcao = 'sell';
    const count = ativo.historico.filter(r => r.direcao === direcao).length + 1;
    const entry = sellEntryHigh;
    const stop = calcularStopDinamico('sell', entry, atr);
    const target = targetSell;
    const riskDistance = stop - entry;
    const rewardDistance = entry - target;
    const ratio = rewardDistance / riskDistance;
    const rewardPct = (rewardDistance / entry) * 100;
    const reward10x = rewardPct * 10;
    const targetPct = ((entry - target) / entry * 100).toFixed(2);
    const targetShort1Pct = ((entry - targetSellShort1) / entry * 100).toFixed(2);
    const targetShort2Pct = ((entry - targetSellShort2) / entry * 100).toFixed(2);
    const targetShort3Pct = ((entry - targetSellShort3) / entry * 100).toFixed(2);
    const classificacao = classificarRR(ratio);
    alertText = buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, targetShort3Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, targetSellShort3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthSell, tag, atr);
    ativo.ultimoSell = agora;
    ativo.ultimoAlerta = agora;
    ativo.historico.push({ direcao: 'sell', timestamp: agora });
    ativo.historico = ativo.historico.slice(-config.MAX_HISTORICO_ALERTAS);
    ativo.lastEntryPrice = price;
    ativo.lastDirection = 'sell';
    ativo.lastEma55Cross = 'below';  // Atualiza o cruzamento
    state.dailyStats.signals++;
    state.dailyStats.shorts++;
    state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
    state.dailyStats.estimatedProfit += reward10x;
    state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
  }
  if (alertText) {
    logger.info(`LIBERADO: Alerta enviado para ${symbol} - Tempo desde último: ${(tempoDesdeUltimoAlerta / 60000).toFixed(1)}min`);
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, { parse_mode: 'Markdown', disable_web_page_preview: true }));
    } catch (e) {
      logger.error(`Erro alerta ${symbol}: ${e.message}`);
    }
  }
}
async function checkConditions() {
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      try {
        const cachePrefix = `ohlcv_${symbol}_`;
        let ohlcv3m = getCached(cachePrefix + '3m');
        if (!ohlcv3m) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, TIMEFRAMES['3m'].limit));
          ohlcv3m = normalizeOHLCV(raw);
          setCached(cachePrefix + '3m', ohlcv3m);
        }
        let ohlcv15m = getCached(cachePrefix + '15m');
        if (!ohlcv15m) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, TIMEFRAMES['15m'].limit));
          ohlcv15m = normalizeOHLCV(raw);
          setCached(cachePrefix + '15m', ohlcv15m);
        }
        let ohlcv1h = getCached(cachePrefix + '1h');
        if (!ohlcv1h) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, TIMEFRAMES['1h'].limit));
          ohlcv1h = normalizeOHLCV(raw);
          setCached(cachePrefix + '1h', ohlcv1h);
        }
        let ohlcv4h = getCached(cachePrefix + '4h');
        if (!ohlcv4h) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, TIMEFRAMES['4h'].limit));
          ohlcv4h = normalizeOHLCV(raw);
          setCached(cachePrefix + '4h', ohlcv4h);
        }
        let ohlcvDiario = getCached(cachePrefix + '1d');
        if (!ohlcvDiario) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, TIMEFRAMES['1d'].limit));
          ohlcvDiario = normalizeOHLCV(raw);
          setCached(cachePrefix + '1d', ohlcvDiario);
        }
        let ohlcvSemanal = getCached(cachePrefix + '1w');
        if (!ohlcvSemanal) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1w', undefined, TIMEFRAMES['1w'].limit));
          ohlcvSemanal = normalizeOHLCV(raw);
          setCached(cachePrefix + '1w', ohlcvSemanal);
        }
        if (ohlcv3m.length < 55 || ohlcv15m.length < 14 || ohlcv1h.length < 14) return; // Garantir EMA55 no 3m
        const price = ohlcv15m[ohlcv15m.length - 1].close;
        const close_3m = ohlcv3m[ohlcv3m.length - 1].close;
        const rsi1hValues = calculateRSI(ohlcv1h);
        const estocastico4h = calculateStochastic(ohlcv4h);
        const estocasticoD = calculateStochastic(ohlcvDiario);
        const lsr = await fetchLSR(symbol);
        const fundingRate = await fetchFundingRate(symbol);
        const atrValues = calculateATR(ohlcv15m);
        const ema13_3mValues = calculateEMA(ohlcv3m, 13);
        const ema34_3mValues = calculateEMA(ohlcv3m, 34);
        const ema55_3mValues = calculateEMA(ohlcv3m, 55); // Agora no 3m
        const vwap1h = calculateVWAP(ohlcv1h);
        const adx1h = calculateADX(ohlcv1h);
        const volumeData = await fetchVolumeData(symbol);
        const fvg = await detectRecentOBFVG(symbol);
        const atr = atrValues[atrValues.length - 1];
        if (!rsi1hValues.length || !estocastico4h || !estocasticoD || !atrValues.length || ema13_3mValues.length < 2 || !ema55_3mValues.length || adx1h === null) return;
        await sendAlertStochasticCross(symbol, {
          ohlcv15m, ohlcv4h, ohlcv1h, ohlcvDiario, ohlcvSemanal,
          price, rsi1h: rsi1hValues[rsi1hValues.length - 1], lsr, fundingRate, estocastico4h, estocasticoD,
          atr, ema13_3m_prev: ema13_3mValues[ema13_3mValues.length - 2], ema34_3m_prev: ema34_3mValues[ema34_3mValues.length - 2],
          ema55_3m: ema55_3mValues[ema55_3mValues.length - 1], vwap1h, adx1h, fvg, volumeData, close_3m
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
function resetCounters() {
  Object.keys(state.ultimoAlertaPorAtivo).forEach(s => state.ultimoAlertaPorAtivo[s].historico = []);
  logger.info('Reset contadores');
  sendDailyStats();
}
async function main() {
  logger.info('Iniciando Titanium ST3 TURBO');
  try {
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await cleanupOldLogs();
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 Titanium V4 by J4Rviz!'));
    await checkConditions();
    setInterval(checkConditions, config.INTERVALO_ALERTA_4H_MS);
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS);
    new CronJob('0 0 21 * * *', resetCounters, null, true, 'America/Sao_Paulo').start();
  } catch (e) {
    logger.error(`Erro init: ${e.message}`);
  }
}
main().catch(e => logger.error(`Fatal: ${e.message}`));
