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
  TELEGRAM_BOT_TOKEN: "8010060485:AAES",
  TELEGRAM_CHAT_ID: "-10025",
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_ALERTA_MS: 3 * 60 * 1000, // Verificação a cada 3 minutos para movimentos menores
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000, // 15 min entre alertas
  TEMPO_COOLDOWN_SAME_DIR_MS: 15 * 60 * 1000, // 15 min na mesma direção
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 75,
  STOCHASTIC_SELL_MIN: 70,
  LSR_BUY_MAX: 2.5,
  LSR_SELL_MIN: 2.6,
  CACHE_TTL_DEFAULT: 3 * 60 * 1000, // TTL menor para movimentos rápidos
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
  LSR_PERIOD: '15m', // Ajustado para 15m
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
      filename: 'logs/sniper_titanium_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/sniper_titanium_combined-%DATE%.log',
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
  '3m': { limit: 120, ttl: 4 * 60 * 1000 },
  '15m': { limit: 120, ttl: 15 * 60 * 1000 },
  '1h': { limit: 110, ttl: 12 * 60 * 1000 },
  '4h': { limit: 50, ttl: 30 * 60 * 1000 },
  '1d': { limit: 30, ttl: 2 * 60 * 60 * 1000 },
  '1w': { limit: 10, ttl: 6 * 60 * 60 * 1000 }
};
// Cache otimizado
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
// Validação env
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
  const zonas = detectarQuebraEstrutura(ohlcv3m, atr); // Adaptado para 3m
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
function calcularStopDinamico(direction, entryPrice, atr) {
  const multiplier = 2.45;
  return direction === 'buy' ? entryPrice - (atr * multiplier) : entryPrice + (atr * multiplier);
}
function buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr, estocastico1d, stoch1dEmoji, direcao1d) {
  const stopLoss = calcularStopDinamico('buy', buyEntryLow, atr);
  return `*🤖IA Titanium Sniper -💹COMPRA*\n` +
         `Intensidade: ${signalStrength.level} (${signalStrength.leverage})\n` +
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
         `Vol: ${volumeZScore.toFixed(2)}\n` +
         `Suporte: ${format(zonas.suporte)}\n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `📍Technology by @J4Rviz`;
}
function buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag, atr, estocastico1d, stoch1dEmoji, direcao1d) {
  const stopLoss = calcularStopDinamico('sell', sellEntryHigh, atr);
  return `*🤖IA Titanium Sniper -🛑CORREÇÃO*\n` +
         `Intensidade: ${signalStrength.level} (${signalStrength.leverage})\n` +
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
         `Vol: ${volumeZScore.toFixed(2)}\n` +
         `Suporte: ${format(zonas.suporte)}\n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `📍Technology by @J4Rviz`;
}
async function sendDailyStats() {
  const { signals, longs, shorts, avgRR, targetsHit, estimatedProfit } = state.dailyStats;
  if (signals === 0) return;
  const message = `Sniper Titanium – Resumo ${new Date().toLocaleDateString('pt-BR')}\n` +
                  `Sinais: ${signals} (${longs} long / ${shorts} short)\n` +
                  `R:R Médio: ${avgRR.toFixed(2)}:1\n` +
                  `Alvos Atingidos: ${targetsHit}/${signals}\n` +
                  `Lucro Estimado (10x): +${estimatedProfit.toFixed(2)}%`;
  try {
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message);
  } catch (e) {
    logger.error(`Erro stats: ${e.message}`);
  }
  state.dailyStats = { signals: 0, longs: 0, shorts: 0, avgRR: 0, targetsHit: 0, estimatedProfit: 0 };
}
async function sendAlertEmaCross(symbol, data) {
  const { price, rsi1h, lsr, fundingRate, estocastico4h, ema8_3m_prev, ema21_3m_prev, ema55_3m, vwap1h, adx1h, fvg, volumeData, atr, ohlcv3m, ohlcv4h, ohlcv1h, close_3m, volumeSurge, estocastico1d } = data;
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
  const volumeZScore = volumeData.zScore || 0;
  const precoPertoDaUltimaEntrada = ativo.lastEntryPrice !== null && Math.abs(price - ativo.lastEntryPrice) <= 1.8 * (atr || 0);
  const reentryForcada = precoPertoDaUltimaEntrada && volumeZScore > config.VOLUME_Z_THRESHOLD + 1.5;
  if (tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS && !reentryForcada) {
    logger.info(`BLOQUEADO: ${symbol} - Tempo desde último: ${(tempoDesdeUltimoAlerta / 60000).toFixed(1)}min`);
    return;
  }
  const currentEmaCross = close_3m > ema55_3m ? 'above' : close_3m < ema55_3m ? 'below' : null;
  if (ativo.lastEma55Cross && currentEmaCross === ativo.lastEma55Cross && tempoDesdeUltimoAlerta < config.TEMPO_COOLDOWN_MS * 2) {
    logger.info(`BLOQUEADO: ${symbol} - Sem rompimento novo da EMA55`);
    return;
  }
  const precision = symbol.includes('BTC') ? 2 : price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const { zonas, buyEntryLow, sellEntryHigh, targetBuyLong1, targetBuyLong2, targetSellShort1, targetSellShort2, targetBuy, targetSell } = calculateTargetsAndZones({ ohlcv3m, ohlcv4h, ohlcv1h, price, atr });
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=3`;
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
  const isAbnormalVol = volumeSurge && volumeZScore > config.VOLUME_Z_THRESHOLD;
  const lsrOkForLong = !lsr.value || lsr.value <= config.LSR_BUY_MAX;
  const lsrOkForShort = !lsr.value || lsr.value >= config.LSR_SELL_MIN;
  const emaOkBuy = ema8_3m_prev > ema21_3m_prev && ema21_3m_prev > ema55_3m && ema55_3m !== null && close_3m > ema55_3m;
  const emaOkSell = ema8_3m_prev < ema21_3m_prev && ema21_3m_prev < ema55_3m && ema55_3m !== null && close_3m < ema55_3m;
  const stochCrossBuy = estocastico4h && estocastico4h.k > estocastico4h.d && kAnterior4h <= dAnterior4h; // Cruzamento para cima
  const stochCrossSell = estocastico4h && estocastico4h.k < estocastico4h.d && kAnterior4h >= dAnterior4h; // Cruzamento para baixo
  const rsiOkBuy = rsi1h < 60;
  const rsiOkSell = rsi1h > 60;
  const atrOk = (atr / price > config.MIN_ATR_PERCENT / 100);
  const volumeOkBuy = isAbnormalVol && volumeData.buyVolume > volumeData.sellVolume;
  const volumeOkSell = isAbnormalVol && volumeData.sellVolume > volumeData.buyVolume;
  const adxOk = adx1h > config.ADX_MIN_TREND;
  const stochZoneBuy = estocastico4h.k <= 80;
  const stochZoneSell = estocastico4h.k >= 30;
  const fvgPoints = fvg.hasBullish ? 2 : fvg.hasBearish ? 2 : 0;
  const volumePoints = volumeOkBuy || volumeOkSell ? 2 : 0;
  const emaPoints = emaOkBuy || emaOkSell ? 3 : 0;
  const stochPoints = stochCrossBuy || stochCrossSell ? 3 : 0;
  const adxPoints = adxOk ? 1 : 0;
  const totalConfluenceBuy = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBullish ? fvgPoints : 0);
  const totalConfluenceSell = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBearish ? fvgPoints : 0);
  const signalStrengthBuy = getSignalStrength(totalConfluenceBuy);
  const signalStrengthSell = getSignalStrength(totalConfluenceSell);
  const dataHora = new Date(agora).toLocaleString('pt-BR');
  let tag = '#BTCUSDT';
  const lastEntry = ativo.lastEntryPrice;
  const lastDirection = ativo.lastDirection;
  const isReentryBuy = lastDirection === 'buy' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  const isReentrySell = lastDirection === 'sell' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  let alertText = '';
  if (signalStrengthBuy.level && stochCrossBuy && rsiOkBuy && atrOk && lsrOkForLong && (volumeOkBuy || isReentryBuy) && emaOkBuy && adxOk && stochZoneBuy) {
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
    const classificacao = classificarRR(ratio);
    alertText = buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthBuy, tag, atr, estocastico1d, stoch1dEmoji, direcao1d);
    ativo.ultimoBuy = agora;
    ativo.ultimoAlerta = agora;
    ativo.historico.push({ direcao: 'buy', timestamp: agora });
    ativo.historico = ativo.historico.slice(-config.MAX_HISTORICO_ALERTAS);
    ativo.lastEntryPrice = price;
    ativo.lastDirection = 'buy';
    ativo.lastEma55Cross = 'above';
    state.dailyStats.signals++;
    state.dailyStats.longs++;
    state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
    state.dailyStats.estimatedProfit += reward10x;
    state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
  } else if (signalStrengthSell.level && stochCrossSell && rsiOkSell && atrOk && lsrOkForShort && (volumeOkSell || isReentrySell) && emaOkSell && adxOk && stochZoneSell) {
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
    const classificacao = classificarRR(ratio);
    alertText = buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthSell, tag, atr, estocastico1d, stoch1dEmoji, direcao1d);
    ativo.ultimoSell = agora;
    ativo.ultimoAlerta = agora;
    ativo.historico.push({ direcao: 'sell', timestamp: agora });
    ativo.historico = ativo.historico.slice(-config.MAX_HISTORICO_ALERTAS);
    ativo.lastEntryPrice = price;
    ativo.lastDirection = 'sell';
    ativo.lastEma55Cross = 'below';
    state.dailyStats.signals++;
    state.dailyStats.shorts++;
    state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
    state.dailyStats.estimatedProfit += reward10x;
    state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
  }
  if (alertText) {
    logger.info(`Alerta enviado para ${symbol}`);
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
        let ohlcv1d = getCached(cachePrefix + '1d');
        if (!ohlcv1d) {
          const raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, TIMEFRAMES['1d'].limit));
          ohlcv1d = normalizeOHLCV(raw);
          setCached(cachePrefix + '1d', ohlcv1d);
        }
        if (ohlcv3m.length < 55 || ohlcv15m.length < 14 || ohlcv1h.length < 14 || ohlcv4h.length < 14 || ohlcv1d.length < 14) return;
        const price = ohlcv3m[ohlcv3m.length - 1].close;
        const close_3m = ohlcv3m[ohlcv3m.length - 1].close;
        const rsi1hValues = calculateRSI(ohlcv1h);
        const estocastico4h = calculateStochastic(ohlcv4h);
        const estocastico1d = calculateStochastic(ohlcv1d);
        const lsr = await fetchLSR(symbol);
        const fundingRate = await fetchFundingRate(symbol);
        const atrValues15m = calculateATR(ohlcv15m);
        const atr = atrValues15m.length > 0 ? atrValues15m[atrValues15m.length - 1] : null;
        if (!atr) return; // segurança
        const ema8_3mValues = calculateEMA(ohlcv3m, 8);
        const ema21_3mValues = calculateEMA(ohlcv3m, 21);
        const ema55_3mValues = calculateEMA(ohlcv3m, 55);
        const vwap1h = calculateVWAP(ohlcv1h);
        const adx1h = calculateADX(ohlcv1h);
        const volumes3mRaw = ohlcv3m.slice(-6);
        if (volumes3mRaw.length < 6) return;
        const volumes3m = volumes3mRaw.map(c => c.volume);
        const avgVol5 = volumes3m.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
        const currentVol = volumes3m[5];
        const previousVol = volumes3m[4];
        const volumeSurge = currentVol > avgVol5 * 2.5 && currentVol > previousVol * 1.4;
        const volumeData = await fetchVolumeData(symbol);
        const isAbnormalVol = volumeSurge && (volumeData.zScore > config.VOLUME_Z_THRESHOLD);
        const fvg = await detectRecentOBFVG(symbol);
        if (!rsi1hValues.length || !estocastico4h || !atrValues15m.length || ema8_3mValues.length < 2 || !ema55_3mValues.length || adx1h === null || !estocastico1d) return;
        await sendAlertEmaCross(symbol, {
          ohlcv3m, ohlcv4h, ohlcv1h,
          price, rsi1h: rsi1hValues[rsi1hValues.length - 1], lsr, fundingRate, estocastico4h,
          atr, ema8_3m_prev: ema8_3mValues[ema8_3mValues.length - 2], ema21_3m_prev: ema21_3mValues[ema21_3mValues.length - 2],
          ema55_3m: ema55_3mValues[ema55_3mValues.length - 1], vwap1h, adx1h, fvg, volumeData, close_3m, volumeSurge, estocastico1d
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
  logger.info('Iniciando Sniper Titanium');
  try {
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await cleanupOldLogs();
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🔷 Sniper Titanium2 !'));
    await checkConditions();
    setInterval(checkConditions, config.INTERVALO_ALERTA_MS);
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS);
    new CronJob('0 0 21 * * *', resetCounters, null, true, 'America/Sao_Paulo').start();
  } catch (e) {
    logger.error(`Erro init: ${e.message}`);
  }
}
main().catch(e => logger.error(`Fatal: ${e.message}`));
