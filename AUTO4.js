require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const ccxt = require('ccxt');
const axios = require('axios');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs').promises;
const path = require('path');

// Configurações
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  LOG_MAX_SIZE: '100m',
  LOG_MAX_FILES: 2,
  LOG_CLEANUP_INTERVAL_MS: 2 * 24 * 60 * 60 * 1000,
  CACHE_EXPIRY: 60 * 60 * 1000
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
      filename: 'logs/listing_monitor_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/listing_monitor_combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new winston.transports.Console()
  ]
});

// Inicializa ccxt para Binance Futures
const binance = new Binance().options({
  'futures': true,
  'APIKEY': process.env.BINANCE_API_KEY,
  'APISECRET': process.env.BINANCE_SECRET,
  'reconnect': true
});

const binanceCCXT = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET,
  enableRateLimit: true,
  options: { defaultType: 'future' }
});

// Inicializa Telegram Bot com polling
let telegramBot;
if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
  telegramBot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
  logger.info('✅ Telegram Bot conectado com polling!');
} else {
  logger.warn('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Configurações para listagens/deslistagens
let allUsdtSymbols = [];
let initialSymbols = new Set();

// Cache para suporte/resistência, RSI, MACD, LSR e Volume com expiração (1 hora)
const srCache = new Map();
const rsiCache = new Map();
const macdCache = new Map();
const lsrCache = new Map();
const volumeCache = new Map(); // Novo cache para volume

// Função para limpar cache expirado
function clearExpiredCache() {
  const now = Date.now();
  for (const [key, { timestamp }] of rsiCache) {
    if (now - timestamp > config.CACHE_EXPIRY) rsiCache.delete(key);
  }
  for (const [key, { timestamp }] of macdCache) {
    if (now - timestamp > config.CACHE_EXPIRY) macdCache.delete(key);
  }
  for (const [key, { timestamp }] of srCache) {
    if (now - timestamp > config.CACHE_EXPIRY) srCache.delete(key);
  }
  for (const [key, { timestamp }] of lsrCache) {
    if (now - timestamp > config.CACHE_EXPIRY) lsrCache.delete(key);
  }
  for (const [key, { timestamp }] of volumeCache) {
    if (now - timestamp > config.CACHE_EXPIRY) volumeCache.delete(key);
  }
}

// Função para tentar novamente chamadas à API
async function retryApiCall(fn, retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i < retries - 1) {
        logger.info(`⚠️ Tentativa ${i + 1} falhou, tentando novamente em ${delay}ms: ${error.message} (code: ${error.code || 'N/A'})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// Função para limpar arquivos de log antigos
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

// Função para normalizar dados OHLCV
function normalizeOHLCV(data) {
  return data
    .map(c => ({
      time: c[0],
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5])
    }))
    .filter(c => !isNaN(c.volume) && c.volume > 0);
}

// 🔥 SUPORTE/RESISTÊNCIA com Níveis Pivot
async function getSupportResistance(symbol, timeframe = '1m', limit = 100) {
  try {
    const cacheKey = `${symbol}_${timeframe}`;
    if (srCache.has(cacheKey) && Date.now() - srCache.get(cacheKey).timestamp < config.CACHE_EXPIRY) {
      return srCache.get(cacheKey).data;
    }

    const klines = await retryApiCall(() => binance.futuresCandles(symbol, timeframe, { limit }));
    if (klines && klines.length >= 50) {
      const validLows = klines.map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
      const validHighs = klines.map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
      const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);

      if (validLows.length >= 20 && validHighs.length >= 20 && closes.length >= 20) {
        // Cálculo do ponto pivot
        const lastCandle = klines[klines.length - 1];
        const high = parseFloat(lastCandle[2]);
        const low = parseFloat(lastCandle[3]);
        const close = parseFloat(lastCandle[4]);
        const pivot = (high + low + close) / 3;
        const support1 = (2 * pivot) - high;
        const resistance1 = (2 * pivot) - low;
        const support2 = pivot - (high - low);
        const resistance2 = pivot + (high - low);
        const breakoutHigh = (resistance1 * 1.002).toFixed(2);
        const breakoutLow = (support1 * 0.998).toFixed(2);

        const result = {
          pivot: pivot.toFixed(2),
          support1: support1.toFixed(2),
          resistance1: resistance1.toFixed(2),
          support2: support2.toFixed(2),
          resistance2: resistance2.toFixed(2),
          breakoutHigh: breakoutHigh,
          breakoutLow: breakoutLow,
          method: `pivot_points_${timeframe}`
        };

        srCache.set(cacheKey, { data: result, timestamp: Date.now() });
        logger.info(`✅ Pivot Points ${symbol} (${timeframe}): Pivot ${result.pivot} | S1 ${result.support1} | R1 ${result.resistance1} | S2 ${result.support2} | R2 ${result.resistance2}`);
        return result;
      }
    }

    // MÉTODO 2: 24hr ticker
    try {
      const ticker24hr = await retryApiCall(() => binance.futures24hrPriceChange());
      const tickerData = ticker24hr.find(t => t.symbol === symbol);

      if (tickerData) {
        const low24h = parseFloat(tickerData.lowPrice);
        const high24h = parseFloat(tickerData.highPrice);
        const close24h = parseFloat(tickerData.lastPrice);
        const pivot = (high24h + low24h + close24h) / 3;
        const support1 = (2 * pivot) - high24h;
        const resistance1 = (2 * pivot) - low24h;
        const support2 = pivot - (high24h - low24h);
        const resistance2 = pivot + (high24h - low24h);
        const breakoutHigh = (resistance1 * 1.003).toFixed(2);
        const breakoutLow = (support1 * 0.997).toFixed(2);

        const result = {
          pivot: pivot.toFixed(2),
          support1: support1.toFixed(2),
          resistance1: resistance1.toFixed(2),
          support2: support2.toFixed(2),
          resistance2: resistance2.toFixed(2),
          breakoutHigh: breakoutHigh,
          breakoutLow: breakoutLow,
          method: '24hr_ticker'
        };

        srCache.set(cacheKey, { data: result, timestamp: Date.now() });
        logger.info(`✅ Pivot Points ${symbol} (24hr): Pivot ${result.pivot} | S1 ${result.support1} | R1 ${result.resistance1} | S2 ${result.support2} | R2 ${result.resistance2}`);
        return result;
      }
    } catch (tickerError) {
      logger.warn(`⚠️ 24hr ticker falhou ${symbol}, método 3: ${tickerError.message}`);
    }

    // MÉTODO 3: Apenas preço atual
    try {
      const prices = await retryApiCall(() => binance.futuresPrices());
      const currentPrice = parseFloat(prices[symbol]);

      if (currentPrice > 0) {
        const pivot = currentPrice;
        const support1 = (currentPrice * 0.995).toFixed(2);
        const resistance1 = (currentPrice * 1.005).toFixed(2);
        const support2 = (currentPrice * 0.99).toFixed(2);
        const resistance2 = (currentPrice * 1.01).toFixed(2);
        const breakoutHigh = (currentPrice * 1.008).toFixed(2);
        const breakoutLow = (currentPrice * 0.992).toFixed(2);

        const result = {
          pivot: pivot.toFixed(2),
          support1: support1,
          resistance1: resistance1,
          support2: support2,
          resistance2: resistance2,
          breakoutHigh: breakoutHigh,
          breakoutLow: breakoutLow,
          method: 'current_price'
        };

        srCache.set(cacheKey, { data: result, timestamp: Date.now() });
        logger.info(`✅ Pivot Points ${symbol} (preço): Pivot ${result.pivot} | S1 ${result.support1} | R1 ${result.resistance1} | S2 ${result.support2} | R2 ${result.resistance2}`);
        return result;
      }
    } catch (priceError) {
      logger.warn(`❌ Todas APIs falharam ${symbol}: ${priceError.message}`);
    }

    return null;

  } catch (error) {
    logger.error(`❌ Erro S/R ${symbol}: ${error.message}`);
    return null;
  }
}

// Função para calcular média móvel (usada para determinar tendências)
async function getMovingAverage(symbol, timeframe, period) {
  try {
    const klines = await retryApiCall(() => binance.futuresCandles(symbol, timeframe, { limit: period + 1 }));
    const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length >= period) {
      const sum = closes.reduce((a, b) => a + b, 0);
      return (sum / closes.length).toFixed(2);
    }
    logger.warn(`⚠️ Dados insuficientes para MA ${symbol} (${timeframe}): ${closes.length}/${period} velas`);
    return null;
  } catch (error) {
    logger.error(`❌ Erro ao calcular MA ${symbol} (${timeframe}): ${error.message}`);
    return null;
  }
}

// Função para calcular RSI (14 períodos) com Divergências
async function getRSI(symbol, timeframe, period = 14) {
  const cacheKey = `${symbol}_${timeframe}_rsi`;
  if (rsiCache.has(cacheKey) && Date.now() - rsiCache.get(cacheKey).timestamp < config.CACHE_EXPIRY) {
    return rsiCache.get(cacheKey).data;
  }

  const timeframes = [timeframe, timeframe === '15m' ? '1h' : timeframe === '1h' ? '4h' : '1d'];
  for (const tf of timeframes) {
    try {
      const klines = await retryApiCall(() => binance.futuresCandles(symbol, tf, { limit: 100 }));
      const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
      if (closes.length < period + 1) {
        logger.warn(`⚠️ Dados insuficientes para RSI ${symbol} (${tf}): ${closes.length}/${period + 1} velas`);
        continue;
      }

      let gains = 0, losses = 0;
      for (let i = 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      const rsi = rs === Infinity ? 100 : 100 - (100 / (1 + rs));

      // Detecção de divergência
      let divergence = 'nenhuma';
      if (closes.length >= period + 3) {
        const lastCloses = closes.slice(-3);
        const lastRSIValues = closes.slice(-period - 3, -3).reduce((acc, _, i) => {
          const slice = closes.slice(i, i + period + 1);
          if (slice.length < period + 1) return acc;
          let g = 0, l = 0;
          for (let j = 1; j < slice.length; j++) {
            const change = slice[j] - slice[j - 1];
            if (change > 0) g += change;
            else l -= change;
          }
          const avgG = g / period;
          const avgL = l / period;
          const rsVal = avgL === 0 ? Infinity : avgG / avgL;
          return [...acc, rsVal === Infinity ? 100 : 100 - (100 / (1 + rsVal))];
        }, []);

        if (lastRSIValues.length >= 2) {
          const priceRising = lastCloses[lastCloses.length - 1] > lastCloses[lastCloses.length - 2];
          const rsiFalling = lastRSIValues[lastRSIValues.length - 1] < lastRSIValues[lastRSIValues.length - 2];
          const priceFalling = lastCloses[lastCloses.length - 1] < lastCloses[lastCloses.length - 2];
          const rsiRising = lastRSIValues[lastRSIValues.length - 1] > lastRSIValues[lastRSIValues.length - 2];

          if (priceRising && rsiFalling) divergence = 'bearish';
          else if (priceFalling && rsiRising) divergence = 'bullish';
        }
      }

      const result = {
        value: rsi.toFixed(2),
        status: rsi > 70 ? 'sobrecomprado' : rsi < 30 ? 'sobrevendido' : 'neutro',
        divergence: divergence,
        timeframeUsed: tf
      };

      rsiCache.set(cacheKey, { data: result, timestamp: Date.now() });
      logger.info(`✅ RSI ${symbol} (${tf}): ${result.value} (${result.status}), Divergência: ${divergence}`);
      return result;
    } catch (error) {
      logger.error(`❌ Erro ao calcular RSI ${symbol} (${tf}): ${error.message}`);
    }
  }

  // Tenta com ccxt como última alternativa
  try {
    const ohlcv = await retryApiCall(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, 100));
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < period + 1) {
      logger.warn(`⚠️ Dados insuficientes para RSI ${symbol} (${timeframe}) via ccxt: ${closes.length}/${period + 1} velas`);
      return null;
    }

    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const rsi = rs === Infinity ? 100 : 100 - (100 / (1 + rs));

    // Detecção de divergência
    let divergence = 'nenhuma';
    if (closes.length >= period + 3) {
      const lastCloses = closes.slice(-3);
      const lastRSIValues = closes.slice(-period - 3, -3).reduce((acc, _, i) => {
        const slice = closes.slice(i, i + period + 1);
        if (slice.length < period + 1) return acc;
        let g = 0, l = 0;
        for (let j = 1; j < slice.length; j++) {
          const change = slice[j] - slice[j - 1];
          if (change > 0) g += change;
          else l -= change;
        }
        const avgG = g / period;
        const avgL = l / period;
        const rsVal = avgL === 0 ? Infinity : avgG / avgL;
        return [...acc, rsVal === Infinity ? 100 : 100 - (100 / (1 + rsVal))];
      }, []);

      if (lastRSIValues.length >= 2) {
        const priceRising = lastCloses[lastCloses.length - 1] > lastCloses[lastCloses.length - 2];
        const rsiFalling = lastRSIValues[lastRSIValues.length - 1] < lastRSIValues[lastRSIValues.length - 2];
        const priceFalling = lastCloses[lastCloses.length - 1] < lastCloses[lastCloses.length - 2];
        const rsiRising = lastRSIValues[lastRSIValues.length - 1] > lastRSIValues[lastRSIValues.length - 2];

        if (priceRising && rsiFalling) divergence = 'bearish';
        else if (priceFalling && rsiRising) divergence = 'bullish';
      }
    }

    const result = {
      value: rsi.toFixed(2),
      status: rsi > 70 ? 'sobrecomprado' : rsi < 30 ? 'sobrevendido' : 'neutro',
      divergence: divergence,
      timeframeUsed: timeframe
    };

    rsiCache.set(cacheKey, { data: result, timestamp: Date.now() });
    logger.info(`✅ RSI ${symbol} (${timeframe}) via ccxt: ${result.value} (${result.status}), Divergência: ${divergence}`);
    return result;
  } catch (error) {
    logger.error(`❌ Erro ao calcular RSI ${symbol} (${timeframe}) via ccxt: ${error.message}`);
    return null;
  }
}

// Função para calcular MACD (12, 26, 9) com Cruzamento de Sinal
async function getMACD(symbol, timeframe) {
  const cacheKey = `${symbol}_${timeframe}_macd`;
  if (macdCache.has(cacheKey) && Date.now() - macdCache.get(cacheKey).timestamp < config.CACHE_EXPIRY) {
    return macdCache.get(cacheKey).data;
  }

  const timeframes = [timeframe, timeframe === '15m' ? '1h' : timeframe === '1h' ? '4h' : '1d'];
  for (const tf of timeframes) {
    try {
      const klines = await retryApiCall(() => binance.futuresCandles(symbol, tf, { limit: 100 }));
      const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
      if (closes.length < 35) {
        logger.warn(`⚠️ Dados insuficientes para MACD ${symbol} (${tf}): ${closes.length}/35 velas`);
        continue;
      }

      const calculateEMA = (prices, period) => {
        const k = 2 / (period + 1);
        let ema = prices[0];
        const emaArray = [ema];
        for (let i = 1; i < prices.length; i++) {
          ema = prices[i] * k + ema * (1 - k);
          emaArray.push(ema);
        }
        return emaArray;
      };

      const ema12 = calculateEMA(closes, 12);
      const ema26 = calculateEMA(closes, 26);
      const macdLine = ema12.slice(-10).map((ema12, i) => ema12 - ema26[ema26.length - 10 + i]);
      const signalLine = calculateEMA(macdLine, 9);
      const latestMACD = macdLine[macdLine.length - 1];
      const latestSignal = signalLine[signalLine.length - 1];
      const previousMACD = macdLine[macdLine.length - 2];
      const previousSignal = signalLine[signalLine.length - 2];
      const histogram = latestMACD - latestSignal;

      let crossover = 'nenhum';
      if (previousMACD && previousSignal) {
        if (previousMACD <= previousSignal && latestMACD > latestSignal) crossover = 'bullish';
        else if (previousMACD >= previousSignal && latestMACD < latestSignal) crossover = 'bearish';
      }

      const result = {
        macd: latestMACD.toFixed(2),
        signal: latestSignal.toFixed(2),
        histogram: histogram.toFixed(2),
        status: histogram > 0 ? 'bullish' : 'bearish',
        crossover: crossover,
        timeframeUsed: tf
      };

      macdCache.set(cacheKey, { data: result, timestamp: Date.now() });
      logger.info(`✅ MACD ${symbol} (${tf}): ${result.status}, histograma ${result.histogram}, cruzamento ${crossover}`);
      return result;
    } catch (error) {
      logger.error(`❌ Erro ao calcular MACD ${symbol} (${tf}): ${error.message}`);
    }
  }

  // Tenta com ccxt como última alternativa
  try {
    const ohlcv = await retryApiCall(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, 100));
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < 35) {
      logger.warn(`⚠️ Dados insuficientes para MACD ${symbol} (${timeframe}) via ccxt: ${closes.length}/35 velas`);
      return null;
    }

    const calculateEMA = (prices, period) => {
      const k = 2 / (period + 1);
      let ema = prices[0];
      const emaArray = [ema];
      for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        emaArray.push(ema);
      }
      return emaArray;
    };

    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macdLine = ema12.slice(-10).map((ema12, i) => ema12 - ema26[ema26.length - 10 + i]);
    const signalLine = calculateEMA(macdLine, 9);
    const latestMACD = macdLine[macdLine.length - 1];
    const latestSignal = signalLine[signalLine.length - 1];
    const previousMACD = macdLine[macdLine.length - 2];
    const previousSignal = signalLine[signalLine.length - 2];
    const histogram = latestMACD - latestSignal;

    let crossover = 'nenhum';
    if (previousMACD && previousSignal) {
      if (previousMACD <= previousSignal && latestMACD > latestSignal) crossover = 'bullish';
      else if (previousMACD >= previousSignal && latestMACD < latestSignal) crossover = 'bearish';
    }

    const result = {
      macd: latestMACD.toFixed(2),
      signal: latestSignal.toFixed(2),
      histogram: histogram.toFixed(2),
      status: histogram > 0 ? 'bullish' : 'bearish',
      crossover: crossover,
      timeframeUsed: timeframe
    };

    macdCache.set(cacheKey, { data: result, timestamp: Date.now() });
    logger.info(`✅ MACD ${symbol} (${timeframe}) via ccxt: ${result.status}, histograma ${result.histogram}, cruzamento ${crossover}`);
    return result;
  } catch (error) {
    logger.error(`❌ Erro ao calcular MACD ${symbol} (${timeframe}) via ccxt: ${error.message}`);
    return null;
  }
}

// 🔥 Função para análise de volume anormal - Alinhada com o script de exemplo
async function getVolumeAnalysis(symbol, timeframe = '15m', limit = 50) {
  const cacheKey = `${symbol}_${timeframe}_volume`;
  if (volumeCache.has(cacheKey) && Date.now() - volumeCache.get(cacheKey).timestamp < config.CACHE_EXPIRY) {
    logger.info(`✅ Volume ${symbol} (${timeframe}) obtido do cache`);
    return volumeCache.get(cacheKey).data;
  }

  try {
    // Tenta obter klines via ccxt (primário)
    let ohlcv = await retryApiCall(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, limit));
    let method = 'ccxt';

    // Fallback para node-binance-api se ccxt falhar
    if (!ohlcv || ohlcv.length < 10) {
      logger.warn(`⚠️ Dados insuficientes via ccxt para volume ${symbol} (${timeframe}): ${ohlcv?.length || 0}/${limit} velas, tentando node-binance-api`);
      ohlcv = await retryApiCall(() => binance.futuresCandles(symbol, timeframe, { limit }));
      method = 'node-binance-api';
    }

    // Normaliza os dados
    const normalizedOHLCV = normalizeOHLCV(ohlcv);
    const volumes = normalizedOHLCV.map(c => c.volume);
    
    // Requer pelo menos 10 velas (flexibilizado do original)
    if (volumes.length < 10) {
      logger.warn(`⚠️ Dados insuficientes para volume ${symbol} (${timeframe}): ${volumes.length}/10 velas`);
      return null;
    }

    // Calcula média dos volumes (excluindo o último candle)
    const lookbackVolumes = volumes.slice(-11, -1); // Últimos 10 candles
    const avgVolume = lookbackVolumes.reduce((sum, v) => sum + v, 0) / lookbackVolumes.length;
    const latestVolume = volumes[volumes.length - 1];
    const volumeRatio = latestVolume / avgVolume;

    const result = {
      volume: latestVolume.toFixed(0),
      avgVolume: avgVolume.toFixed(0),
      ratio: volumeRatio.toFixed(2),
      status: volumeRatio > 2 ? 'anormalmente alto' : volumeRatio > 1.5 ? 'elevado' : 'normal'
    };

    volumeCache.set(cacheKey, { data: result, timestamp: Date.now() });
    logger.info(`✅ Volume ${symbol} (${timeframe}): ${result.volume} (média ${result.avgVolume}, ratio ${result.ratio}, ${result.status}) (${method})`);
    return result;
  } catch (error) {
    logger.error(`❌ Erro ao calcular volume ${symbol} (${timeframe}): ${error.message} (code: ${error.code || error.response?.status || 'N/A'})`);
    return null;
  }
}

// Função para obter Long/Short Ratio (15m)
async function getLongShortRatio(symbol, timeframe = '15m') {
  const cacheKey = `${symbol}_${timeframe}_lsr`;
  if (lsrCache.has(cacheKey) && Date.now() - lsrCache.get(cacheKey).timestamp < config.CACHE_EXPIRY) {
    logger.info(`✅ LSR ${symbol} (${timeframe}) obtido do cache`);
    return lsrCache.get(cacheKey).data;
  }

  try {
    const res = await retryApiCall(() =>
      axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
        params: {
          symbol: symbol.replace('/', ''),
          period: timeframe,
          limit: 2
        }
      }), 5, 3000);

    if (!res.data || res.data.length < 2) {
      logger.warn(`⚠️ Dados insuficientes para LSR ${symbol} (${timeframe}): ${res.data?.length || 0} registros`);
      return null;
    }

    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const longRatio = parseFloat(res.data[0].longAccount);
    const shortRatio = parseFloat(res.data[0].shortAccount);

    if (isNaN(currentLSR) || isNaN(longRatio) || isNaN(shortRatio) || shortRatio === 0) {
      logger.warn(`⚠️ Dados inválidos para LSR ${symbol} (${timeframe}): LSR=${currentLSR}, long=${longRatio}, short=${shortRatio}`);
      return null;
    }

    const result = {
      longRatio: (longRatio * 100).toFixed(2),
      shortRatio: (shortRatio * 100).toFixed(2),
      lsr: currentLSR.toFixed(2),
      status: currentLSR > 1.5 ? 'predomínio de compradores' : currentLSR < 0.67 ? 'predomínio de vendedores' : 'equilíbrio',
      method: 'axios-public'
    };

    lsrCache.set(cacheKey, { data: result, timestamp: Date.now() });
    logger.info(`✅ LSR ${symbol} (${timeframe}): Long ${result.longRatio}%, Short ${result.shortRatio}%, Ratio ${result.lsr}, ${result.status} (axios-public)`);
    return result;
  } catch (error) {
    logger.error(`❌ Erro ao calcular LSR ${symbol} (${timeframe}) via axios: ${error.message} (code: ${error.response?.status || 'N/A'})`);
    return null;
  }
}

// Função para obter Funding Rate
async function getFundingRate(symbol) {
  try {
    const fundingData = await retryApiCall(() => binanceCCXT.fetchFundingRate(symbol));
    if (!fundingData || !fundingData.fundingRate) {
      logger.warn(`⚠️ Dados de funding rate indisponíveis para ${symbol}`);
      return null;
    }

    const fundingRate = parseFloat(fundingData.fundingRate) * 100;
    const result = {
      rate: fundingRate.toFixed(4),
      status: fundingRate > 0.01 ? 'compradores pagando vendedores' : fundingRate < -0.01 ? 'vendedores pagando compradores' : 'equilíbrio'
    };

    logger.info(`✅ Funding Rate ${symbol}: ${result.rate}% (${result.status})`);
    return result;
  } catch (error) {
    logger.error(`❌ Erro ao calcular Funding Rate ${symbol}: ${error.message}`);
    return null;
  }
}

// Função para verificar rompimentos
async function checkBreakouts(symbol) {
  try {
    const prices = await retryApiCall(() => binance.futuresPrices());
    const currentPrice = parseFloat(prices[symbol]);
    const fourHourSR = await getSupportResistance(symbol, '4h', 100);
    if (!fourHourSR) return;

    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    if (currentPrice > parseFloat(fourHourSR.breakoutHigh)) {
      const message = `🚨 *Rompimento de Resistência* ${symbol}\nPreço: $${currentPrice.toFixed(2)}\nResistência: $${fourHourSR.resistance1}\n⏰ ${now}`;
      await sendTelegramMessage(message);
    } else if (currentPrice < parseFloat(fourHourSR.breakoutLow)) {
      const message = `🚨 *Rompimento de Suporte* ${symbol}\nPreço: $${currentPrice.toFixed(2)}\nSuporte: $${fourHourSR.support1}\n⏰ ${now}`;
      await sendTelegramMessage(message);
    }
  } catch (error) {
    logger.error(`❌ Erro ao verificar rompimentos ${symbol}: ${error.message}`);
  }
}

// Mapeamento de símbolos para nomes completos das moedas
const coinNames = {
  'BTCUSDT': 'Bitcoin',
  'ADAUSDT': 'Cardano',
  'ETHUSDT': 'Ethereum',
  'BNBUSDT': 'Binance Coin',
  'XRPUSDT': 'XRP'
};

// Função para determinar emoji de tendência
const trendEmoji = (isBullish) => isBullish === true ? '🚀' : isBullish === false ? '🐻' : '⚖️';

// Função genérica para análise de qualquer par
async function analyzePair(symbol) {
  const now = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // Obter nome da moeda
  const coinName = coinNames[symbol] || symbol.replace('USDT', '');

  try {
    // Verificar se o par existe
    const prices = await retryApiCall(() => binance.futuresPrices());
    if (!prices[symbol]) {
      throw new Error(`Par ${symbol} não encontrado na Binance Futures`);
    }

    // Obter preço atual
    const currentPrice = parseFloat(prices[symbol]).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

    // Limpar cache expirado
    clearExpiredCache();

    // Obter suportes e resistências para diferentes timeframes
    const weeklySR = await getSupportResistance(symbol, '1w', 100);
    const fourHourSR = await getSupportResistance(symbol, '4h', 100);
    const oneHourSR = await getSupportResistance(symbol, '1h', 100);
    const fifteenMinSR = await getSupportResistance(symbol, '15m', 100);

    // Calcular médias móveis para avaliar tendências
    const maWeekly = await getMovingAverage(symbol, '1w', 20);
    const maFourHour = await getMovingAverage(symbol, '4h', 20);
    const maOneHour = await getMovingAverage(symbol, '1h', 20);
    const maFifteenMin = await getMovingAverage(symbol, '15m', 20);

    // Calcular RSI e MACD para cada timeframe
    const rsiWeekly = await getRSI(symbol, '1w');
    const rsiFourHour = await getRSI(symbol, '4h');
    const rsiOneHour = await getRSI(symbol, '1h');
    const rsiFifteenMin = await getRSI(symbol, '15m');

    const macdWeekly = await getMACD(symbol, '1w');
    const macdFourHour = await getMACD(symbol, '4h');
    const macdOneHour = await getMACD(symbol, '1h');
    const macdFifteenMin = await getMACD(symbol, '15m');

    // Calcular volume anormal
    const volume15Min = await getVolumeAnalysis(symbol, '15m');

    // Calcular Long/Short Ratio (15m)
    const lsr15Min = await getLongShortRatio(symbol, '15m');

    // Calcular Funding Rate
    const fundingRate = await getFundingRate(symbol);

    // Determinar tendências com base nas médias móveis
    const currentPriceFloat = parseFloat(prices[symbol]);
    const isWeeklyBullish = maWeekly && currentPriceFloat > parseFloat(maWeekly);
    const isFourHourBullish = maFourHour && currentPriceFloat > parseFloat(maFourHour);
    const isOneHourBullish = maOneHour && currentPriceFloat > parseFloat(maOneHour);
    const isFifteenMinBullish = maFifteenMin && currentPriceFloat > parseFloat(maFifteenMin);

    // Construir resumo com base em RSI e MACD
    const isOverbought = [rsiWeekly, rsiFourHour, rsiOneHour, rsiFifteenMin].some(rsi => rsi && rsi.status === 'sobrecomprado');
    const isOversold = [rsiWeekly, rsiFourHour, rsiOneHour, rsiFifteenMin].some(rsi => rsi && rsi.status === 'sobrevendido');
    const sentiment = isOverbought ? 'requer cautela (sobrecompra)' : isOversold ? 'indica oportunidade (sobrevenda)' : 'sugere equilíbrio';

    // Construir a análise com tom humanizado, elegante e resumido
    let analysis = `🤖 *Titanium: Análise ${symbol} (${coinName})*\n\n`;
    analysis += `**Data**: *${now}* (Horário de Brasília)\n\n`;
    analysis += `**Preço Atual**: *${currentPrice}*\n\n`;
    analysis += `---\n`;
    analysis += `#### 📈 Resumo do Mercado\n`;
    analysis += `${coinName} mostra ${isWeeklyBullish ? "força de longo prazo (acumulação, Wyckoff)" : "consolidação ou redistribuição"} e ${isFourHourBullish ? "momentum de alta no médio prazo" : "correção no médio prazo"}. Sentimento: ${sentiment}.\n\n`;
    analysis += `---\n`;
    analysis += `#### 🔍 Análise Técnica\n`;
    analysis += `- **Longo Prazo (Semanal)**: ${trendEmoji(isWeeklyBullish)} ${isWeeklyBullish ? "Tendência de alta (onda 3, Elliott)" : "Consolidação (fase B/C, Wyckoff)"}. RSI: ${rsiWeekly?.value || 'indisponível'} (${rsiWeekly?.status || 'neutro'}, divergência ${rsiWeekly?.divergence || 'nenhuma'}). MACD: ${macdWeekly?.status === 'bullish' ? 'alta' : 'baixa'} (cruzamento ${macdWeekly?.crossover || 'nenhum'}).\n`;
    analysis += `- **Médio Prazo (4h)**: ${trendEmoji(isFourHourBullish)} ${isFourHourBullish ? "Alta (sign of strength)" : "Correção ou lateral"}. Ponto Pivot: *$${fourHourSR?.pivot || 'indefinido'}*. Suporte: *$${fourHourSR?.support1 || 'indefinido'}*. Resistência: *$${fourHourSR?.resistance1 || 'indefinido'}*.\n`;
    analysis += `- **Curto Prazo (1h)**: ${trendEmoji(isOneHourBullish)} ${isOneHourBullish ? "Recuperação inicial" : "Indecisão"}. RSI: ${rsiOneHour?.value || 'indisponível'} (${rsiOneHour?.status || 'neutro'}, divergência ${rsiOneHour?.divergence || 'nenhuma'}).\n`;
    analysis += `- **Intraday (15min)**: ${trendEmoji(isFifteenMinBullish)} ${isFifteenMinBullish ? "Alta ou lateral" : "Queda ou lateral"}. MACD: ${macdFifteenMin?.status === 'bullish' ? 'alta' : 'baixa'} (cruzamento ${macdFifteenMin?.crossover || 'nenhum'}). Volume: ${volume15Min?.status || 'indisponível'} (ratio ${volume15Min?.ratio || '-'}). LSR: ${lsr15Min?.status || 'indisponível'} (${lsr15Min?.lsr || '-'}).\n`;
    analysis += `- **Funding Rate**: ${fundingRate?.rate || 'indisponível'}% (${fundingRate?.status || 'neutro'}).\n\n`;
    analysis += `---\n`;
    analysis += `#### 📊 Níveis Críticos\n`;
    analysis += `- *Ponto Pivot (4h)*: $${fourHourSR?.pivot || 'indefinido'}\n`;
    analysis += `- *Resistências*: $${oneHourSR?.resistance1 || 'indefinido'} (curto prazo), $${weeklySR?.resistance1 || 'indefinido'} (longo prazo), $${fourHourSR?.resistance2 || 'indefinido'} (R2, 4h).\n`;
    analysis += `- *Suportes*: $${oneHourSR?.support1 || 'indefinido'} (curto prazo), $${fourHourSR?.support1 || 'indefinido'} (médio prazo), $${fourHourSR?.support2 || 'indefinido'} (S2, 4h).\n\n`;
    analysis += `---\n`;
    analysis += `#### ⏳ Cenário Provável\n`;
    analysis += `O Preço pode testar *$${oneHourSR?.resistance1 || 'níveis superiores'}*. Sem rompimento, busca suporte em *$${fourHourSR?.support1 || 'níveis inferiores'}*. Rompimento de *$${weeklySR?.resistance1 || 'indefinido'}* sugere onda 3 (Elliott); quebra de *$${weeklySR?.support1 || 'indefinido'}* indica correção (onda A/B).\n\n`;
    analysis += `---\n`;
    analysis += `#### ⛔ Invalidação\n`;
    analysis += `- Queda abaixo de *$${oneHourSR?.support1 || 'suporte de curto prazo'}* (4h) enfraquece o cenário.\n`;
    analysis += `- Quebra de *$${weeklySR?.support1 || 'suporte de longo prazo'}* (semanal) sugere redistribuição (Wyckoff).\n\n`;
    analysis += `**✅ Nota**: Monitore volume, LSR e funding rate para confirmar rompimentos. Gerencie o risco com disciplina.\n\n`;
    analysis += `⏰ *${now}*`;

    await sendTelegramMessage(analysis);
    logger.info(`📊 Análise ${symbol} (${coinName}) enviada às ${now}`);
  } catch (error) {
    logger.error(`❌ Erro na análise de ${symbol}: ${error.message}`);
    const message = `⚠️ *Erro na Análise de ${symbol} (${coinName})*\nNão foi possível gerar a análise.\nMotivo: ${error.message}\n⏰ ${now}`;
    await sendTelegramMessage(message);
  }
}

// Função para enviar mensagem no Telegram
async function sendTelegramMessage(message) {
  if (!telegramBot) {
    logger.info(message);
    return;
  }

  try {
    await telegramBot.sendMessage(config.TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown'
    });
    logger.info('📱 Mensagem enviada!');
  } catch (error) {
    logger.error(`❌ Erro Telegram: ${error.message}`);
    logger.info(message);
  }
}

// Busca símbolos USDT
async function fetchAllUsdtSymbols() {
  try {
    const exchangeInfo = await retryApiCall(() => binance.futuresExchangeInfo());
    const usdtSymbols = exchangeInfo.symbols
      .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
      .map(s => s.symbol)
      .sort();
    return usdtSymbols;
  } catch (error) {
    logger.error(`❌ Erro ao buscar símbolos USDT: ${error.message}`);
    return [];
  }
}

// Listagens/deslistagens
async function checkListingsDelistings() {
  const currentSymbols = await fetchAllUsdtSymbols();

  if (initialSymbols.size === 0) {
    currentSymbols.forEach(symbol => initialSymbols.add(symbol));
    allUsdtSymbols = currentSymbols;
    logger.info(`📊 Lista inicial: ${initialSymbols.size} pares USDT carregados.`);
    return;
  }

  const newSymbols = currentSymbols.filter(symbol => !initialSymbols.has(symbol));

  if (newSymbols.length > 0) {
    newSymbols.forEach(async (symbol) => {
      const now = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const message = `⚠️ *Nova Listagem ⚠️ Binance Futures:*\n\n\`${symbol}\`\n\n⏰ ${now}`;
      await sendTelegramMessage(message);
    });
    logger.info(`🆕 ${newSymbols.length} NOVA(S) LISTAGEM(ÕES)!`);
  }

  initialSymbols = new Set(currentSymbols);
  allUsdtSymbols = currentSymbols;
}

// Inicia monitoramento
async function startMonitoring() {
  logger.info('🔍 Iniciando MONITORAMENTO DE LISTAGENS/DESLISTAGENS + ANÁLISE HORÁRIA BTCUSDT!');
  logger.info('📊 APIs usadas: futuresCandles, futures24hrPriceChange, futuresPrices, ccxt.fetchOHLCV, futuresLongShortRatio, ccxt.fetchFundingRate');
  logger.info('📈 Indicadores: SMA, RSI, MACD, Volume, LSR, Funding Rate');
  logger.info('📅 Análise horária de BTCUSDT: ATIVADA');

  try {
    // Cria diretório de logs
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    // Executa limpeza inicial de logs
    await cleanupOldLogs();
    // Agendar limpeza de logs a cada 2 dias
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS);
    logger.info(`Limpeza de logs agendada a cada ${config.LOG_CLEANUP_INTERVAL_MS / (24 * 60 * 60 * 1000)} dias`);

    await checkListingsDelistings();
    setInterval(checkListingsDelistings, 30000);

    // Inicia análise horária de BTCUSDT
    await analyzePair('BTCUSDT');
    setInterval(() => analyzePair('BTCUSDT'), 60 * 60 * 1000);

    // Inicia verificação de rompimentos a cada 5 minutos
    setInterval(() => checkBreakouts('BTCUSDT'), 5 * 60 * 1000);

    // Limpa cache periodicamente
    setInterval(clearExpiredCache, config.CACHE_EXPIRY);
  } catch (error) {
    logger.error(`❌ Erro ao iniciar monitoramento: ${error.message}`);
  }
}

// Lida com encerramento gracioso
process.on('SIGINT', () => {
  logger.info('\n👋 Parando monitor...');
  logger.info(`📊 Total pares USDT: ${allUsdtSymbols.length}`);
  process.exit(0);
});

if (!config.TELEGRAM_BOT_TOKEN) logger.warn('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!config.TELEGRAM_CHAT_ID) logger.warn('⚠️ TELEGRAM_CHAT_ID não encontrado');

startMonitoring();
