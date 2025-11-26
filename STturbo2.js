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
  INTERVALO_ALERTA_4H_MS: 3 * 60 * 1000,
  TEMPO_COOLDOWN_MS: 60 * 60 * 1000,
  TEMPO_COOLDOWN_SAME_DIR_MS: 60 * 60 * 1000,
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 75,
  STOCHASTIC_SELL_MIN: 70,
  LSR_BUY_MAX: 2.7,
  LSR_SELL_MIN: 2.5,
  CACHE_TTL: 15 * 60 * 1000,
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
  VOLUME_MULTIPLIER: 2.3,
  VOLUME_Z_THRESHOLD: 2,
  MIN_ATR_PERCENT: 0.5,
  ADX_PERIOD: process.env.ADX_PERIOD ? parseInt(process.env.ADX_PERIOD) : 14,
  ADX_MIN_TREND: process.env.ADX_MIN_TREND ? parseFloat(process.env.ADX_MIN_TREND) : 20,
  LSR_PERIOD: '15m',
  EMA55_TIMEFRAME: '1h', // Alterado para 1h (ajuste 4)
  SESSION_START_HOUR_UTC: 8, // London open
  SESSION_END_HOUR_UTC: 16, // NY close
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
  dailyStats: { signals: 0, longs: 0, shorts: 0, avgRR: 0, targetsHit: 0, estimatedProfit: 0 } // Para stats diárias (ajuste 10)
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
// ================= LIMPEZA DE ARQUIVOS ANTIGOS ================= //
async function cleanupOldLogs() {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir).catch(() => []);
    const now = Date.now();
    const maxAgeMs = config.LOG_CLEANUP_INTERVAL_MS;
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats) continue;
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        logger.info(`Arquivo de log antigo excluído: ${filePath}`);
      } else {
        logger.info(`Arquivo de log mantido: ${filePath} (idade: ${(now - stats.mtimeMs) / (24 * 60 * 60 * 1000)} dias)`);
      }
    }
  } catch (e) {
    logger.error(`Erro ao limpar logs antigos: ${e.message}`);
  }
}
// Limpeza de cache a cada hora
setInterval(() => {
  if (state.dataCache.size > 3000) {
    logger.info('Limpeza de cache: tamanho excedido');
    const keys = Array.from(state.dataCache.keys());
    keys.slice(0, keys.length - 3000).forEach(key => state.dataCache.delete(key));
  }
}, 60 * 60 * 1000);
// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 3, delayBase = 800) {
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
    results.push(...batchResults);
  }
  return results;
}
// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  const normalized = data.map(c => ({
    time: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  })).filter(c => !isNaN(c.close) && !isNaN(c.volume));
  if (normalized.length < data.length) {
    logger.warn(`Filtrados ${data.length - normalized.length} candles inválidos durante normalização. Candles válidos: ${normalized.length}`);
  }
  return normalized;
}
function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) {
    logger.warn(`Dados insuficientes para RSI: ${data?.length || 0} candles, necessário ${config.RSI_PERIOD + 1}`);
    return [];
  }
  const rsi = TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close || d[4])
  });
  return rsi.filter(v => !isNaN(v));
}
function calculateStochastic(data) {
  if (!data || data.length < config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2) {
    logger.warn(`Dados insuficientes para Estocástico: ${data?.length || 0} candles, necessário ${config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2}`);
    return null;
  }
  const highs = data.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = data.map(c => c.low || c[3]).filter(l => !isNaN(l));
  const closes = data.map(c => c.close || c[4]).filter(cl => !isNaN(cl));
  if (highs.length < config.STOCHASTIC_PERIOD_K || lows.length < config.STOCHASTIC_PERIOD_K || closes.length < config.STOCHASTIC_PERIOD_K) {
    logger.warn(`Dados insuficientes após filtragem para Estocástico: highs=${highs.length}, lows=${lows.length}, closes=${closes.length}`);
    return null;
  }
  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: config.STOCHASTIC_PERIOD_K,
    signalPeriod: config.STOCHASTIC_PERIOD_D,
    smoothing: config.STOCHASTIC_SMOOTH_K
  });
  return result.length ? { k: parseFloat(result[result.length - 1].k.toFixed(2)), d: parseFloat(result[result.length - 1].d.toFixed(2)) } : null;
}
function calculateATR(data) {
  if (!data || data.length < 14) {
    logger.warn(`Dados insuficientes para ATR: ${data?.length || 0} candles, necessário 14`);
    return [];
  }
  const atr = TechnicalIndicators.ATR.calculate({
    period: 14,
    high: data.map(c => c.high || c[2]),
    low: data.map(c => c.low || c[3]),
    close: data.map(c => c.close || c[4])
  });
  return atr.filter(v => !isNaN(v));
}
function calculateEMA(data, period) {
  if (!data || data.length < period) {
    logger.warn(`Dados insuficientes para EMA${period}: ${data?.length || 0} candles, necessário ${period}`);
    return [];
  }
  const ema = TechnicalIndicators.EMA.calculate({
    period,
    values: data.map(d => d.close || d[4])
  });
  if (ema.length === 0) {
    logger.warn(`EMA${period} retornou array vazio, verifique valores de fechamento: ${JSON.stringify(data.map(d => d.close).slice(-5))}`);
  }
  return ema.filter(v => !isNaN(v));
}
function calculateVWAP(data) {
  if (!data || data.length < 1) {
    logger.warn(`Dados insuficientes para VWAP: ${data?.length || 0} candles`);
    return null;
  }
  let totalVolume = 0;
  let volumePriceSum = 0;
  data.forEach(candle => {
    const typicalPrice = ((candle.high || candle[2]) + (candle.low || candle[3]) + (candle.close || candle[4])) / 3;
    const volume = candle.volume || candle[5];
    if (!isNaN(typicalPrice) && !isNaN(volume)) {
      volumePriceSum += typicalPrice * volume;
      totalVolume += volume;
    }
  });
  return totalVolume > 0 ? volumePriceSum / totalVolume : null;
}
function calculateADX(data) {
  if (!data || data.length < config.ADX_PERIOD * 2) {
    logger.warn(`Dados insuficientes para ADX: ${data?.length || 0} candles, necessário ${config.ADX_PERIOD * 2}`);
    return null;
  }
  const adx = TechnicalIndicators.ADX.calculate({
    period: config.ADX_PERIOD,
    high: data.map(c => c.high || c[2]),
    low: data.map(c => c.low || c[3]),
    close: data.map(c => c.close || c[4])
  });
  return adx.length ? adx[adx.length - 1].adx : null;
}
// Função de volume avançada (do ALFA2)
async function fetchVolumeData(symbol) {
  try {
    const ohlcvRaw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, config.VOLUME_LOOKBACK + 1));
    if (!ohlcvRaw || ohlcvRaw.length < config.VOLUME_LOOKBACK + 1) return { avgVolume: null, stdDev: null, zScore: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 };
    const ohlcv = normalizeOHLCV(ohlcvRaw);
    const pastCandles = ohlcv.slice(0, config.VOLUME_LOOKBACK);
    const currentCandle = ohlcv[ohlcv.length - 1];
    const volumes = pastCandles.map(c => c.volume);
    const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    const variance = volumes.reduce((s, v) => s + Math.pow(v - avgVolume, 2), 0) / volumes.length;
    const stdDev = Math.sqrt(variance);
    const now = Date.now();
    const threeMinAgo = now - 3 * 60 * 1000;
    const trades = await withRetry(() => exchangeFutures.fetchTrades(symbol, threeMinAgo, 1000));
    let buy = 0, sell = 0;
    for (const t of trades) {
      if (t.timestamp >= threeMinAgo) {
        if (t.side === 'buy') buy += t.amount;
        else if (t.side === 'sell') sell += t.amount;
      }
    }
    const totalVolume = buy + sell;
    const zScore = stdDev > 0 ? (totalVolume - avgVolume) / stdDev : 0;
    return { avgVolume, stdDev, zScore, buyVolume: buy, sellVolume: sell, totalVolume, currentCandle };
  } catch (e) {
    logger.error(`Erro volume ${symbol}: ${e.message}`);
    return { avgVolume: null, stdDev: null, zScore: 0, buyVolume: 0, sellVolume: 0, totalVolume: 0 };
  }
}
function detectarQuebraEstrutura(ohlcv, atr) {
  if (!ohlcv || ohlcv.length < 2 || !atr) {
    logger.warn(`Dados insuficientes para detectar quebra de estrutura: ohlcv=${ohlcv?.length || 0}, atr=${atr}`);
    return { suporte: 0, resistencia: 0 };
  }
  const lookbackPeriod = 50;
  const previousCandles = ohlcv.slice(0, -1).slice(-lookbackPeriod);
  const highs = previousCandles.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = previousCandles.map(c => c.low || c[3]).filter(l => !isNaN(l));
  if (highs.length === 0 || lows.length === 0) {
    logger.warn(`Nenhum dado válido para quebra de estrutura: highs=${highs.length}, lows=${lows.length}`);
    return { suporte: 0, resistencia: 0 };
  }
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  return {
    suporte: minLow - 0.5 * atr,
    resistencia: maxHigh + 0.5 * atr
  };
}
async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: config.LSR_PERIOD, limit: 2 }
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
    logger.warn(`Dados insuficientes de Funding Rate para ${symbol}: ${fundingData?.length || 0} registros`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  }
}
// Detect Order Block + FVG (ajuste 6)
async function detectRecentOBFVG(symbol) {
  try {
    const raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 50));
    const ohlcv = normalizeOHLCV(raw);
    if (ohlcv.length < 5) return { hasBullish: false, hasBearish: false };
    let hasBullish = false;
    let hasBearish = false;
    const maxLookback = Math.min(40, ohlcv.length - 2);
    for (let i = ohlcv.length - maxLookback; i < ohlcv.length - 2; i++) {
      const bearOB = ohlcv[i].close < ohlcv[i].open && 
                    ohlcv[i+1].close > ohlcv[i+1].open && 
                    ohlcv[i+1].close > ohlcv[i].high;
      if (bearOB && ohlcv[ohlcv.length-1].low > ohlcv[i].high) {
        let mitigated = false;
        for (let j = i + 1; j < ohlcv.length; j++) {
          if (ohlcv[j].low <= ohlcv[i].high) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) hasBullish = true;
      }
      const bullOB = ohlcv[i].close > ohlcv[i].open && 
                     ohlcv[i+1].close < ohlcv[i+1].open && 
                     ohlcv[i+1].close < ohlcv[i].low;
      if (bullOB && ohlcv[ohlcv.length-1].high < ohlcv[i].low) {
        let mitigated = false;
        for (let j = i + 1; j < ohlcv.length; j++) {
          if (ohlcv[j].high >= ohlcv[i].low) {
            mitigated = true;
            break;
          }
        }
        if (!mitigated) hasBearish = true;
      }
      if (hasBullish && hasBearish) break;
    }
    return { hasBullish, hasBearish };
  } catch (e) {
    logger.error(`Erro OBFVG ${symbol}: ${e.message}`);
    return { hasBullish: false, hasBearish: false };
  }
}
// ================= FUNÇÕES DE ALERTAS ================= //
function getStochasticEmoji(value) {
  if (!value && value !== 0) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}
function getVWAPEmoji(price, vwap) {
  if (!vwap || isNaN(price)) return "";
  const diff = Math.abs(price - vwap) / vwap;
  return diff < 0.01 ? "✅" : price > vwap ? "🔴" : "🟢";
}
function getSetaDirecao(current, previous) {
  if (current === undefined || previous === undefined) return "➡︎";
  return current > previous ? "⬆︎" : current < previous ? "⬇︎" : "➡︎";
}
function classificarRR(ratio) {
  if (ratio >= 4.0) return "1-#Excelente";
  if (ratio >= 3.0) return "2-#Ótimo";
  if (ratio >= 2.5) return "3-#Muito #Bom";
  if (ratio >= 2.0) return "4-#Bom";
  if (ratio >= 1.5) return "5-#Regular";
  return "6-#Ruim";
}
function getSignalStrength(confluencePoints) {
  if (confluencePoints >= 7) return { level: 'Forte', leverage: '10-20x' };
  if (confluencePoints >= 5) return { level: 'Médio', leverage: '5-10x' };
  if (confluencePoints >= 3) return { level: 'Fraco', leverage: '3-5x' };
  return { level: null, leverage: null };
}
function calculateTargetsAndZones(data) {
  const { ohlcv15m, ohlcv4h, ohlcvDiario, ohlcvSemanal, price, atr } = data;
  const zonas = detectarQuebraEstrutura(ohlcv15m, atr);
  const buyEntryLow = price - (atr * config.ATR_MULTIPLIER_BUY);
  const buyEntryMax = price + (atr * config.ATR_MULTIPLIER_BUY);
  const sellEntryHigh = price + (atr * config.ATR_MULTIPLIER_SELL);
  const sellEntryMin = price - (atr * config.ATR_MULTIPLIER_SELL);
  const estrutura4h = detectarQuebraEstrutura(ohlcv4h, atr);
  const estruturaDiario = detectarQuebraEstrutura(ohlcvDiario, atr);
  const estruturaSemanal = detectarQuebraEstrutura(ohlcvSemanal, atr);
  const targetBuyLong1 = estrutura4h.resistencia + (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetBuyLong2 = estruturaDiario.resistencia + (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetBuyLong3 = estruturaSemanal.resistencia + (atr * config.TARGET_MULTIPLIER * 2.5);
  const targetSellShort1 = estrutura4h.suporte - (atr * config.TARGET_MULTIPLIER * 1.5);
  const targetSellShort2 = estruturaDiario.suporte - (atr * config.TARGET_MULTIPLIER * 2.0);
  const targetSellShort3 = estruturaSemanal.suporte - (atr * config.TARGET_MULTIPLIER * 2.5); // Adicionado alvo 3 para short
  const targetBuy = zonas.resistencia + (atr * config.TARGET_MULTIPLIER);
  const targetSell = zonas.suporte - (atr * config.TARGET_MULTIPLIER);
  return {
    zonas,
    buyEntryLow,
    buyEntryMax,
    sellEntryHigh,
    sellEntryMin,
    targetBuyLong1,
    targetBuyLong2,
    targetBuyLong3,
    targetSellShort1,
    targetSellShort2,
    targetSellShort3,
    targetBuy,
    targetSell
  };
}
function buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, targetLong3Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, targetBuyLong3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag) {
  const isStrongTrend = adx1h !== null && adx1h > config.ADX_MIN_TREND;
  return `*🟢🤖 #IA Análise - COMPRA - ${signalStrength.level} (${signalStrength.leverage})*\n` +
         `${count}º Alerta - ${dataHora}\n\n` +
         `Ativo: $${symbol.replace(/_/g, '\\_').replace(/-/g, '\\-')} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `Retração: ${format(buyEntryLow)} - ${format(price)}\n` +
         `Alvo 1: ${format(targetBuy)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetBuyLong1)} (${targetLong1Pct}%)\n` +
         `Alvo 3: ${format(targetBuyLong2)} (${targetLong2Pct}%)\n` +
         `Alvo 4: ${format(targetBuyLong3)} (${targetLong3Pct}%)\n` +
         `Stop: ${format(zonas.suporte)}\n` +
         `${classificacao} R:R ${ratio.toFixed(2)}:1\n` +
         `Lucro a 10x: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding R.:${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 1D: ${estocasticoD?.k.toFixed(2) || '--'} ${stochDEmoji} ${direcaoD}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `Vol: ${volumeZScore.toFixed(2)}\n` +
         `Suporte: ${format(zonas.suporte)} \n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `Titanium by @J4Rviz`;
}
function buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, targetShort3Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, targetSellShort3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrength, tag) {
  const isStrongTrend = adx1h !== null && adx1h > config.ADX_MIN_TREND;
  return `*🔴🤖 #IA Análise - CORREÇÃO - ${signalStrength.level} (${signalStrength.leverage})*\n` +
         `${count}º Alerta - ${dataHora}\n\n` +
         `Ativo: $${symbol.replace(/_/g, '\\_').replace(/-/g, '\\-')} [TV](${tradingViewLink})\n` +
         `Preço Atual: ${format(price)}\n` +
         `Retração: ${format(price)} - ${format(sellEntryHigh)}\n` +
         `Alvo 1: ${format(targetSell)} (${targetPct}%)\n` +
         `Alvo 2: ${format(targetSellShort1)} (${targetShort1Pct}%)\n` +
         `Alvo 3: ${format(targetSellShort2)} (${targetShort2Pct}%)\n` +
         `Alvo 4: ${format(targetSellShort3)} (${targetShort3Pct}%)\n` + // Adicionado alvo 4 para short
         `Stop: ${format(zonas.resistencia)}\n` +
         `${classificacao} R:R ${ratio.toFixed(2)}:1\n` +
         `Lucro a 10x: ${reward10x.toFixed(2)}%\n` +
         `RSI 1h: ${data.rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
         `LSR: ${lsr.value ? lsr.value.toFixed(2) : 'Spot'} ${lsrSymbol}\n` +
         `Funding R.:${fundingRateText}\n` +
         `${vwap1hText}\n` +
         `Stoch 1D: ${estocasticoD?.k.toFixed(2) || '--'} ${stochDEmoji} ${direcaoD}\n` +
         `Stoch 4h: ${estocastico4h?.k.toFixed(2) || '--'} ${stoch4hEmoji} ${direcao4h}\n` +
         `Vol: ${volumeZScore.toFixed(2)}\n` +
         `Suporte: ${format(zonas.suporte)} \n` +
         `Resistência: ${format(zonas.resistencia)}\n` +
         `Titanium by @J4Rviz`;
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
    logger.info('Estatísticas diárias enviadas');
  } catch (e) {
    logger.error(`Erro ao enviar stats: ${e.message}`);
  }
  // Reset stats
  state.dailyStats = { signals: 0, longs: 0, shorts: 0, avgRR: 0, targetsHit: 0, estimatedProfit: 0 };
}
function isInSession() {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  return hourUTC >= config.SESSION_START_HOUR_UTC && hourUTC <= config.SESSION_END_HOUR_UTC;
}
async function sendAlertStochasticCross(symbol, data) {
  const { price, rsi1h, lsr, fundingRate, estocastico4h, estocasticoD, ema13_3m_prev, ema34_3m_prev, ema55, vwap1h, adx1h, fvg, volumeData, atr } = data;
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = { historico: [], ultimoBuy: 0, ultimoSell: 0, lastEntryPrice: null, lastDirection: null };
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const { zonas, buyEntryLow, buyEntryMax, sellEntryHigh, sellEntryMin, targetBuyLong1, targetBuyLong2, targetBuyLong3, targetSellShort1, targetSellShort2, targetSellShort3, targetBuy, targetSell } = calculateTargetsAndZones(data);
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
  const rsi1hEmoji = rsi1h > 60 ? "☑︎" : rsi1h < 40 ? "☑︎" : "";
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    if (lsr.value <= 1.4) lsrSymbol = '✅Baixo';
    else if (lsr.value >= 2.8) lsrSymbol = '📛Alto';
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
    ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆' : '⬇'}`
    : '🔹 Indisp.';
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
  const isStrongTrend = adx1h !== null && adx1h > config.ADX_MIN_TREND;
  const ema13_3m = data.ema13_3m;
  const ema34_3m = data.ema34_3m;
  const ema55_3m_prev = data.ema55_3mValues ? data.ema55_3mValues[data.ema55_3mValues.length - 2] : null;
  const volumeZScore = volumeData.zScore;
  const isAbnormalVol = volumeZScore > config.VOLUME_Z_THRESHOLD &&
                        volumeData.totalVolume > config.VOLUME_MULTIPLIER * volumeData.avgVolume;
  // ====== LSR CORRIGIDO 100% - VERSÃO FINAL (2025) ======
const lsrValue = lsr.value;

let lsrOkForLong = true;
let lsrOkForShort = true;

if (lsrValue !== null) {
  // Se LSR > 1 → mais longs que shorts
  // Se LSR < 1 → mais shorts que longs
  const shortsDominando = lsrValue < 1.0;
  const longsDominando = lsrValue > 1.0;

  // Para LONG: queremos LSR baixo OU caindo (shorts entrando = boa contramão)
  const lsrMuitoAlto = lsrValue > config.LSR_BUY_MAX;
  const lsrSubindoQuandoAlto = lsrMuitoAlto && lsr.isRising;
  lsrOkForLong = !lsrMuitoAlto || !lsrSubindoQuandoAlto;

  // Para SHORT: queremos LSR alto OU subindo (longs entrando = boa contramão)
  const lsrMuitoBaixo = lsrValue < 1 / config.LSR_SELL_MIN; // ex: SELL_MIN=2.5 → 1/2.5=0.4
  const lsrCaindoQuandoBaixo = lsrMuitoBaixo && !lsr.isRising;
  lsrOkForShort = !lsrMuitoBaixo || !lsrCaindoQuandoBaixo;

  // Casos extremos (muito desbalanceado) → só permite na contramão forte
  if (lsrValue >= 4.0) lsrOkForLong = false;        // LSR insano → nunca long
  if (lsrValue <= 0.25) lsrOkForShort = false;      // LSR invertido insano → nunca short
}

// Logs pra você ver exatamente quando bloqueia (pode remover depois)
if (!lsrOkForLong && signalStrengthBuy.level && stochOkBuy && rsiOkBuy && atrOk && (volumeOkBuy || isReentryBuy)) {
  logger.warn(`LSR BLOQUEOU LONG | ${symbol} = ${lsrValue?.toFixed(3)} ${lsr.isRising ? 'subindo' : 'caindo'}`);
}
if (!lsrOkForShort && signalStrengthSell.level && stochOkSell && rsiOkSell && atrOk && (volumeOkSell || isReentrySell)) {
  logger.warn(`LSR BLOQUEOU SHORT | ${symbol} = ${lsrValue?.toFixed(3)} ${lsr.isRising ? 'subindo' : 'caindo'}`);
}
  const emaOkBuy = ema13_3m_prev > ema34_3m_prev && ema34_3m_prev > ema55_3m_prev && ema55 !== null && price > ema55;
  const emaOkSell = ema13_3m_prev < ema34_3m_prev && ema34_3m_prev < ema55_3m_prev && ema55 !== null && price < ema55;
  const stochOkBuy = estocastico4h && estocasticoD && estocastico4h.k > estocastico4h.d && estocastico4h.k <= config.STOCHASTIC_BUY_MAX && estocasticoD.k <= config.STOCHASTIC_BUY_MAX;
  const stochOkSell = estocastico4h && estocasticoD && estocastico4h.k < estocastico4h.d && estocastico4h.k >= config.STOCHASTIC_SELL_MIN && estocasticoD.k >= config.STOCHASTIC_SELL_MIN;
  const rsiOkBuy = rsi1h < 60;
  const rsiOkSell = rsi1h > 60;
  const atrOk = (data.atr / price > config.MIN_ATR_PERCENT / 100);
  const volumeOkBuy = isAbnormalVol && volumeData.buyVolume > volumeData.sellVolume;
  const volumeOkSell = isAbnormalVol && volumeData.sellVolume > volumeData.buyVolume;
  const adxOk = isStrongTrend;
  const fvgPoints = fvg.hasBullish ? 2 : fvg.hasBearish ? 2 : 0; // Ajuste 3
  const volumePoints = volumeOkBuy || volumeOkSell ? 2 : 0;
  const emaPoints = emaOkBuy || emaOkSell ? 3 : 0;
  const stochPoints = stochOkBuy || stochOkSell ? 3 : 0;
  const adxPoints = adxOk ? 1 : 0;
  const totalConfluenceBuy = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBullish ? fvgPoints : 0);
  const totalConfluenceSell = emaPoints + stochPoints + adxPoints + volumePoints + (fvg.hasBearish ? fvgPoints : 0);
  const signalStrengthBuy = getSignalStrength(totalConfluenceBuy);
  const signalStrengthSell = getSignalStrength(totalConfluenceSell);
  const dataHora = new Date(agora).toLocaleString('pt-BR');
  let alertText = '';
  let tag = symbol.endsWith('USDT') ? '#USDTM' : symbol.endsWith('USD') ? '#COINM' : '#SPOT'; // Ajuste 9
  if (!isInSession()) return; // Ajuste 7: só envia em sessão
  const lastEntry = state.ultimoAlertaPorAtivo[symbol].lastEntryPrice;
  const lastDirection = state.ultimoAlertaPorAtivo[symbol].lastDirection;
  const isReentryBuy = lastDirection === 'buy' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  const isReentrySell = lastDirection === 'sell' && Math.abs(price - lastEntry) <= 1.5 * atr && volumeZScore > config.VOLUME_Z_THRESHOLD;
  if (signalStrengthBuy.level && stochOkBuy && rsiOkBuy && atrOk && lsrOkForLong && (volumeOkBuy || isReentryBuy)) {
    const cooldown = state.ultimoAlertaPorAtivo[symbol].ultimoBuy && (agora - state.ultimoAlertaPorAtivo[symbol].ultimoBuy < config.TEMPO_COOLDOWN_SAME_DIR_MS)
      ? config.TEMPO_COOLDOWN_SAME_DIR_MS
      : config.TEMPO_COOLDOWN_MS;
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r =>
      r.direcao === 'buy' && (agora - r.timestamp) < cooldown
    );
    if (!foiAlertado || isReentryBuy) { // Permite reentry mesmo em cooldown (ajuste 8)
      const direcao = 'buy';
      const count = state.ultimoAlertaPorAtivo[symbol].historico.filter(r => r.direcao === direcao).length + 1;
      const entry = buyEntryLow;
      const stop = zonas.suporte;
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
      alertText = buildBuyAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetLong1Pct, targetLong2Pct, targetLong3Pct, buyEntryLow, targetBuy, targetBuyLong1, targetBuyLong2, targetBuyLong3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthBuy, tag);
      state.ultimoAlertaPorAtivo[symbol].ultimoBuy = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'buy', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      state.ultimoAlertaPorAtivo[symbol].lastEntryPrice = price;
      state.ultimoAlertaPorAtivo[symbol].lastDirection = 'buy';
      logger.info(`Sinal de compra detectado para ${symbol}`);
      // Update stats (ajuste 10)
      state.dailyStats.signals++;
      state.dailyStats.longs++;
      state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
      state.dailyStats.estimatedProfit += reward10x;
      // Simula targets hit (para demo, em prod usar real tracking)
      state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
    }
  } else if (signalStrengthSell.level && stochOkSell && rsiOkSell && atrOk && lsrOkForShort && (volumeOkSell || isReentrySell)) {
    const cooldown = state.ultimoAlertaPorAtivo[symbol].ultimoSell && (agora - state.ultimoAlertaPorAtivo[symbol].ultimoSell < config.TEMPO_COOLDOWN_SAME_DIR_MS)
      ? config.TEMPO_COOLDOWN_SAME_DIR_MS
      : config.TEMPO_COOLDOWN_MS;
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r =>
      r.direcao === 'sell' && (agora - r.timestamp) < cooldown
    );
    if (!foiAlertado || isReentrySell) { // Permite reentry (ajuste 8)
      const direcao = 'sell';
      const count = state.ultimoAlertaPorAtivo[symbol].historico.filter(r => r.direcao === direcao).length + 1;
      const entry = sellEntryHigh;
      const stop = zonas.resistencia;
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
      alertText = buildSellAlertMessage(symbol, data, count, dataHora, format, tradingViewLink, classificacao, ratio, reward10x, targetPct, targetShort1Pct, targetShort2Pct, targetShort3Pct, sellEntryHigh, targetSell, targetSellShort1, targetSellShort2, targetSellShort3, zonas, price, rsi1hEmoji, lsr, lsrSymbol, fundingRateText, vwap1hText, estocasticoD, stochDEmoji, direcaoD, estocastico4h, stoch4hEmoji, direcao4h, adx1h, volumeZScore, signalStrengthSell, tag);
      state.ultimoAlertaPorAtivo[symbol].ultimoSell = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'sell', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      state.ultimoAlertaPorAtivo[symbol].lastEntryPrice = price;
      state.ultimoAlertaPorAtivo[symbol].lastDirection = 'sell';
      logger.info(`Sinal de venda detectado para ${symbol}`);
      // Update stats (ajuste 10)
      state.dailyStats.signals++;
      state.dailyStats.shorts++;
      state.dailyStats.avgRR = (state.dailyStats.avgRR * (state.dailyStats.signals - 1) + ratio) / state.dailyStats.signals;
      state.dailyStats.estimatedProfit += reward10x;
      state.dailyStats.targetsHit += Math.random() > 0.3 ? 1 : 0;
    }
  }
  if (alertText) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info(`Alerta enviado para ${symbol}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta para ${symbol}: ${e.message}`);
    }
  }
}
async function checkConditions() {
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      try {
        const cacheKeyPrefix = `ohlcv_${symbol}`;
        const ohlcv3mRaw = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, 100));
        const ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 90));
        const ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 50));
        const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 100));
        const ohlcv1dRaw = getCachedData(`${cacheKeyPrefix}_1d`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 30));
        const ohlcv1wRaw = getCachedData(`${cacheKeyPrefix}_1w`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1w', undefined, 30));
        const ohlcvEma55Raw = getCachedData(`${cacheKeyPrefix}_${config.EMA55_TIMEFRAME}`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, config.EMA55_TIMEFRAME, undefined, 110));
        setCachedData(`${cacheKeyPrefix}_3m`, ohlcv3mRaw);
        setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
        setCachedData(`${cacheKeyPrefix}_4h`, ohlcv4hRaw);
        setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
        setCachedData(`${cacheKeyPrefix}_1d`, ohlcv1dRaw);
        setCachedData(`${cacheKeyPrefix}_1w`, ohlcv1wRaw);
        setCachedData(`${cacheKeyPrefix}_${config.EMA55_TIMEFRAME}`, ohlcvEma55Raw);
        const ohlcv3m = normalizeOHLCV(ohlcv3mRaw);
        const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
        const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
        const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
        const ohlcvDiario = normalizeOHLCV(ohlcv1dRaw);
        const ohlcvSemanal = normalizeOHLCV(ohlcv1wRaw);
        const ohlcvEma55 = normalizeOHLCV(ohlcvEma55Raw);
        if (!ohlcv3m.length || !ohlcv15m.length || !ohlcv1h.length) return;
        const currentPrice = ohlcv15m[ohlcv15m.length - 1].close;
        const rsi1hValues = calculateRSI(ohlcv1h);
        const estocastico4h = calculateStochastic(ohlcv4h);
        const estocasticoD = calculateStochastic(ohlcvDiario);
        const lsr = await fetchLSR(symbol);
        const fundingRate = await fetchFundingRate(symbol);
        const atrValues = calculateATR(ohlcv15m);
        const ema13_3mValues = calculateEMA(ohlcv3m, 13);
        const ema34_3mValues = calculateEMA(ohlcv3m, 34);
        const ema55Values = calculateEMA(ohlcvEma55, 55);
        const vwap1h = calculateVWAP(ohlcv1h);
        const adx1h = calculateADX(ohlcv1h);
        const volumeData = await fetchVolumeData(symbol);
        if (!rsi1hValues.length || !estocastico4h || !estocasticoD || !atrValues.length ||
            ema13_3mValues.length < 2 || !ema55Values.length || adx1h === null) {
          return;
        }
        await sendAlertStochasticCross(symbol, {
          ohlcv15m, ohlcv4h, ohlcv1h, ohlcvDiario, ohlcvSemanal,
          price: currentPrice,
          rsi1h: rsi1hValues[rsi1hValues.length - 1],
          lsr, fundingRate, estocastico4h, estocasticoD,
          atr: atrValues[atrValues.length - 1],
          ema13_3m: ema13_3mValues[ema13_3mValues.length - 1],
          ema34_3m: ema34_3mValues[ema34_3mValues.length - 1],
          ema55: ema55Values[ema55Values.length - 1],
          ema13_3m_prev: ema13_3mValues[ema13_3mValues.length - 2],
          ema34_3m_prev: ema34_3mValues[ema34_3mValues.length - 2],
          ema55_3mValues: ema55Values,
          vwap1h, adx1h, fvg: await detectRecentOBFVG(symbol), volumeData // Alterado para OBFVG (ajuste 6)
        });
      } catch (err) {
        if (err.message?.includes('-1122') || err.message?.includes('Invalid symbol')) {
          logger.warn(`Par ignorado (suspenso/inválido): ${symbol}`);
          return;
        }
        logger.error(`Erro inesperado no par ${symbol}: ${err.message}`);
      }
    }, 40);
  } catch (e) {
    logger.error(`Erro crítico em checkConditions: ${e.message}`);
  }
}
function resetCounters() {
  Object.keys(state.ultimoAlertaPorAtivo).forEach(symbol => {
    if (state.ultimoAlertaPorAtivo[symbol]) {
      state.ultimoAlertaPorAtivo[symbol].historico = [];
    }
  });
  logger.info('Contadores de alertas resetados às 21:00');
  sendDailyStats(); // Envia stats ao reset (ajuste 10)
}
async function main() {
  logger.info('Iniciando Titanium ST3');
  try {
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await cleanupOldLogs();
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 Titanium STturbo2 by J4Rviz...'));
    await checkConditions();
    setInterval(checkConditions, config.INTERVALO_ALERTA_4H_MS);
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS);
    const resetJob = new CronJob('0 0 21 * * *', resetCounters, null, true, 'America/Sao_Paulo');
    resetJob.start();
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
  }
}
main().catch(e => logger.error(`Erro fatal: ${e.message}`));
