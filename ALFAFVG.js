require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,ADAUSDT,DOGEUSDT,PEPEUSDT,XRPUSDT,TONUSDT,AVAXUSDT").split(","),
  INTERVALO_VERIFICACAO_MS: 1 * 60 * 1000,
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000,
  RSI_PERIOD: 14,
  CACHE_TTL: 10 * 60 * 1000,
  MAX_CACHE_SIZE: 100,
  MAX_HISTORICO_ALERTAS: 10,
  TIMEFRAMES_MONITORADOS: ['15m', '30m', '1h', '4h'],
  LOG_FILE: 'simple_trading_bot.log',
  LOG_RETENTION_DAYS: 2,
  RECONNECT_INTERVAL_MS: 10 * 1000,
  VOLUME_LOOKBACK: 13,
  VOLUME_Z_THRESHOLD: 2.5,
  VOLUME_MULTIPLIER: 2.5,
  MIN_CANDLES_4H: 25
};

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: config.LOG_FILE }),
    new winston.transports.Console()
  ]
});

// Limpeza de logs antigos
function cleanOldLogs() {
  const logPath = path.resolve(config.LOG_FILE);
  if (fs.existsSync(logPath)) {
    const stats = fs.statSync(logPath);
    const fileAgeDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (fileAgeDays > config.LOG_RETENTION_DAYS) {
      try {
        fs.unlinkSync(logPath);
        logger.info(`Log antigo removido: ${config.LOG_FILE}`);
      } catch (err) {
        logger.error(`Erro ao remover log: ${err.message}`);
      }
    }
  }
}
cleanOldLogs();
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

// Estado global
const state = {
  ultimoAlertaPorAtivo: {},
  dataCache: new Map(),
  isOnline: false,
  reconnectTimer: null
};

// Validação de env
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'COINS'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`Falta variável de ambiente: ${key}`);
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
  options: { defaultType: 'future', defaultSubType: 'linear' }
});

// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 5, delayBase = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      const delay = Math.pow(2, attempt - 1) * delayBase;
      logger.info(`Tentativa ${attempt} falhou, retry em ${delay}ms: ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function getCachedData(key) {
  const entry = state.dataCache.get(key);
  if (entry && Date.now() - entry.timestamp < config.CACHE_TTL) return entry.data;
  state.dataCache.delete(key);
  return null;
}

function setCachedData(key, data) {
  if (state.dataCache.size >= config.MAX_CACHE_SIZE) {
    const oldest = state.dataCache.keys().next().value;
    state.dataCache.delete(oldest);
  }
  state.dataCache.set(key, { timestamp: Date.now(), data });
  setTimeout(() => {
    if (state.dataCache.has(key) && Date.now() - state.dataCache.get(key).timestamp >= config.CACHE_TTL) {
      state.dataCache.delete(key);
    }
  }, config.CACHE_TTL + 1000);
}

async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(item => fn(item)));
    results.push(...settled.filter(r => r.status === 'fulfilled').map(r => r.value));
  }
  return results;
}

// ================= RECONEXÃO ================= //
async function checkConnection() {
  try {
    await exchangeSpot.fetchTime();
    if (!state.isOnline) {
      logger.info('Conexão restaurada!');
      state.isOnline = true;
      if (state.reconnectTimer) {
        clearInterval(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      startMonitoring();
    }
  } catch (err) {
    if (state.isOnline) {
      logger.error(`Conexão perdida: ${err.message}`);
      state.isOnline = false;
      stopMonitoring();
    }
    if (!state.reconnectTimer) {
      state.reconnectTimer = setInterval(() => {
        logger.info('Tentando reconectar...');
        checkConnection();
      }, config.RECONNECT_INTERVAL_MS);
    }
  }
}

let monitoringInterval = null;
function startMonitoring() {
  if (monitoringInterval) return;
  logger.info('Monitoramento INICIADO');
  checkConditions().catch(e => logger.error(`Erro no checkConditions inicial: ${e.message}`));
  monitoringInterval = setInterval(() => {
    checkConditions().catch(e => logger.error(`Erro no checkConditions interval: ${e.message}`));
  }, config.INTERVALO_VERIFICACAO_MS);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    logger.warn('Monitoramento PAUSADO (sem internet)');
  }
}

setInterval(checkConnection, 30 * 1000);

// ================= FVG 3M DETECTION ================= //
async function fetchOHLCV3m(symbol) {
  const cacheKey = `ohlcv_3m_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 100));
    const normalized = normalizeOHLCV(raw);
    setCachedData(cacheKey, normalized);
    return normalized;
  } catch (e) {
    logger.error(`Erro fetch 3m para FVG ${symbol}: ${e.message}`);
    return [];
  }
}

function detectFVG(ohlcv3m) {
  if (ohlcv3m.length < 3) return { bullish: false, bearish: false, zone: null };

  const candles = ohlcv3m.slice(-4); // últimos 4 para garantir
  const c1 = candles[candles.length - 3]; // candle -2
  const c2 = candles[candles.length - 2]; // candle -1
  const c3 = candles[candles.length - 1]; // candle atual

  let bullishFVG = false;
  let bearishFVG = false;
  let zone = null;

  // Bullish FVG: low do candle atual > high do candle -2
  if (c3.low > c1.high) {
    bullishFVG = true;
    zone = { top: c3.low, bottom: c1.high };
  }

  // Bearish FVG: high do candle atual < low do candle -2
  if (c3.high < c1.low) {
    bearishFVG = true;
    zone = { top: c1.low, bottom: c3.high };
  }

  return { bullish: bullishFVG, bearish: bearishFVG, zone };
}

// ================= INDICADORES ================= //
async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const symbolWithoutSlash = symbol.replace('/', '');
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbolWithoutSlash, period: '5m', limit: 2 },
      timeout: 10000
    }));
    const data = res.data;
    if (!data || data.length < 2) return { value: null, percentChange: '0.00' };
    const currentLSR = parseFloat(data[0].longShortRatio);
    const previousLSR = parseFloat(data[1].longShortRatio);
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, percentChange };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    logger.error(`Erro ao fetch LSR para ${symbol}: ${e.message}`);
    return { value: 1.0, percentChange: '0.00' };
  }
}

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

function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) return [];
  const closes = data.map(d => d.close);
  return TechnicalIndicators.RSI.calculate({ period: config.RSI_PERIOD, values: closes });
}

function detectRSIDivergence(ohlcv, rsiValues, lookback = 30) {
  if (!ohlcv || !rsiValues || ohlcv.length < lookback) return { isBullish: false, isBearish: false };
  const price = ohlcv.slice(-lookback);
  const rsi = rsiValues.slice(-lookback);

  const findExtremes = (arr, isPrice) => {
    const peaks = [], troughs = [];
    for (let i = 1; i < arr.length - 1; i++) {
      const v = isPrice ? arr[i].close : arr[i];
      const p = isPrice ? arr[i-1].close : arr[i-1];
      const n = isPrice ? arr[i+1].close : arr[i+1];
      if (v > p && v > n) peaks.push({ i, v });
      if (v < p && v < n) troughs.push({ i, v });
    }
    return { peaks, troughs };
  };

  const { peaks: pPeaks, troughs: pTroughs } = findExtremes(price, true);
  const { peaks: rPeaks, troughs: rTroughs } = findExtremes(rsi, false);

  let isBullish = false, isBearish = false;

  if (pTroughs.length >= 2 && rTroughs.length >= 2) {
    const [t1, t2] = pTroughs.slice(-2);
    const [r1, r2] = rTroughs.slice(-2);
    if (t2.v < t1.v && r2.v > r1.v && r2.v < 50) isBullish = true;
  }
  if (pPeaks.length >= 2 && rPeaks.length >= 2) {
    const [p1, p2] = pPeaks.slice(-2);
    const [r1, r2] = rPeaks.slice(-2);
    if (p2.v > p1.v && r2.v < r1.v && r2.v > 50) isBearish = true;
  }
  return { isBullish, isBearish };
}

async function fetchVolumeData(symbol) {
  try {
    const ohlcvRaw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, config.VOLUME_LOOKBACK + 1));
    if (!ohlcvRaw || ohlcvRaw.length < config.VOLUME_LOOKBACK + 1) return { avgVolume: null, stdDev: null };
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
    const lastClosedVolume = pastCandles[pastCandles.length - 1].volume;
    const lastClosedZ = (lastClosedVolume - avgVolume) / stdDev;
    return {
      avgVolume, stdDev, totalVolume, buyVolume: buy, sellVolume: sell,
      lastClosedZ, currentCandle
    };
  } catch (e) {
    logger.error(`Erro volume ${symbol}: ${e.message}`);
    return { avgVolume: null, stdDev: null };
  }
}

async function fetchAndCalculateADX(symbol, timeframe, period = 14) {
  const key = `ohlcv_adx_${symbol}_${timeframe}`;
  const raw = getCachedData(key) || await withRetry(() => exchangeFutures.fetchOHLCV(symbol, timeframe, undefined, period * 2));
  if (!raw) return null;
  const ohlcv = normalizeOHLCV(raw);
  setCachedData(key, raw);
  if (ohlcv.length < period * 2) return null;
  const input = { high: ohlcv.map(c => c.high), low: ohlcv.map(c => c.low), close: ohlcv.map(c => c.close), period };
  const adxResults = TechnicalIndicators.ADX.calculate(input);
  return adxResults[adxResults.length - 1]?.adx ?? null;
}

async function fetchAndCalculateStochastic(symbol, timeframe) {
  const stoKPeriod = 5, stoSlow = 3, stoDPeriod = 3;
  const neededCandles = stoKPeriod + stoSlow + stoDPeriod + 10;
  const key = `ohlcv_sto_${symbol}_${timeframe}`;
  let raw = getCachedData(key);
  if (!raw) {
    raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, timeframe, undefined, neededCandles));
    setCachedData(key, raw);
  }
  const ohlcv = normalizeOHLCV(raw);
  if (ohlcv.length < neededCandles) return { k: null, d: null, direction: '' };
  const sto = TechnicalIndicators.Stochastic.calculate({
    high: ohlcv.map(c => c.high),
    low: ohlcv.map(c => c.low),
    close: ohlcv.map(c => c.close),
    period: stoKPeriod,
    signalPeriod: stoSlow
  });
  if (sto.length < stoDPeriod + 1) return { k: null, d: null, direction: '' };
  const slowKValues = sto.map(s => s.d);
  const dValues = TechnicalIndicators.SMA.calculate({ period: stoDPeriod, values: slowKValues });
  const lastK = slowKValues[slowKValues.length - 1];
  const lastD = dValues[dValues.length - 1];
  const prevK = slowKValues[slowKValues.length - 2];
  const direction = prevK !== undefined ? (lastK > prevK ? 'UP' : (lastK < prevK ? 'DOWN' : 'FLAT')) : '';
  return { k: lastK, d: lastD, direction };
}

async function fetchVWAP1h(symbol) {
  const cacheKey = `vwap1h_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '1h', undefined, 48));
    const ohlcv = normalizeOHLCV(raw);
    const input = { high: ohlcv.map(c => c.high), low: ohlcv.map(c => c.low), close: ohlcv.map(c => c.close), volume: ohlcv.map(c => c.volume) };
    const vwapResults = TechnicalIndicators.VWAP.calculate(input);
    const vwap = vwapResults[vwapResults.length - 1] || ohlcv[ohlcv.length - 1].close;
    setCachedData(cacheKey, vwap);
    return vwap;
  } catch (e) {
    logger.warn(`Erro VWAP ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchEMA55_3m(symbol) {
  const cacheKey = `ema55_3m_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '3m', undefined, 110));
    const ohlcv = normalizeOHLCV(raw);
    if (ohlcv.length < 56) return null;
    const closes = ohlcv.map(c => c.close);
    const ema = TechnicalIndicators.EMA.calculate({ period: 55, values: closes });
    const lastEMA = ema[ema.length - 1];
    setCachedData(cacheKey, lastEMA);
    return lastEMA;
  } catch (e) {
    logger.error(`Erro EMA55 3m ${symbol}: ${e.message}`);
    return null;
  }
}

// ================= ALERTA COM FVG 3M ================= //
async function sendAlertRSIDivergence(symbol, timeframe, price, rsiValue, divergence, lsr, rsi1hValue, volumeData, adx15m, adx1h, vwap1h) {
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = {};
  if (!state.ultimoAlertaPorAtivo[symbol][timeframe]) state.ultimoAlertaPorAtivo[symbol][timeframe] = { historico: [] };

  const ema55_3m = await fetchEMA55_3m(symbol);
  if (ema55_3m === null) return;

  const ohlcv3m = await fetchOHLCV3m(symbol);
  const fvg = detectFVG(ohlcv3m);

  const { isBullish, isBearish } = divergence;
  let direcao = '', tipo = '';
  let lsrOk = false, rsiOk = false, volOk = false, fvgOk = false;

  const adxStrong = (adx15m ?? 0) > 25 && (adx1h ?? 0) > 25;
  const currentZ = volumeData.stdDev > 0 ? (volumeData.totalVolume - volumeData.avgVolume) / volumeData.stdDev : 0;

  if (isBullish) {
    //lsrOk = lsr.value < 2.6;
    rsiOk = rsi1hValue < 55;
    volOk = currentZ > config.VOLUME_Z_THRESHOLD &&
            volumeData.totalVolume > config.VOLUME_MULTIPLIER * volumeData.avgVolume &&
            volumeData.buyVolume > volumeData.sellVolume &&
            volumeData.lastClosedZ > 1.0 &&
            volumeData.currentCandle.close > volumeData.currentCandle.open;
    fvgOk = fvg.bullish; // FVG OBRIGATÓRIO PARA COMPRA

    if (rsiOk && volOk && fvgOk && volumeData.currentCandle.close > ema55_3m) {
      direcao = 'buy';
      tipo = adxStrong ? 'COMPRA FVG + DIV' : 'IA Análise Bullish + FVG';
    }
  } 
  
  else if (isBearish) {
    //lsrOk = lsr.value > 2.8;
    rsiOk = rsi1hValue > 60;
    volOk = currentZ > config.VOLUME_Z_THRESHOLD &&
            volumeData.totalVolume > config.VOLUME_MULTIPLIER * volumeData.avgVolume &&
            volumeData.sellVolume > volumeData.buyVolume &&
            volumeData.lastClosedZ > 1.0 &&
            volumeData.currentCandle.close < volumeData.currentCandle.open;
    fvgOk = fvg.bearish; // FVG OBRIGATÓRIO PARA VENDA

    if (rsiOk && volOk && fvgOk && volumeData.currentCandle.close < ema55_3m) {
      direcao = 'sell';
      tipo = adxStrong ? 'VENDA FVG + DIV' : 'IA Análise Bearish + FVG';
    }
  }

  if (!direcao) return;

  const historico = state.ultimoAlertaPorAtivo[symbol][timeframe].historico;
  if (historico.some(h => h.direcao === direcao && agora - h.timestamp < config.TEMPO_COOLDOWN_MS)) return;

  const format = v => isNaN(v) ? 'N/A' : (v < 1 ? v.toFixed(8) : v < 10 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2));
  const link = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=${timeframe.toUpperCase()}`;
  const ohlcv50Raw = await withRetry(() => exchangeFutures.fetchOHLCV(symbol, timeframe, undefined, 50));
  const ohlcv50 = normalizeOHLCV(ohlc50Raw);
  const resistance = Math.max(...ohlcv50.map(c => c.high));
  const support = Math.min(...ohlcv50.map(c => c.low));
  const dataHora = new Date().toLocaleString('pt-BR');

  const fvgText = fvg.zone ? `${format(fvg.zone.bottom)} - ${format(fvg.zone.top)}` : 'N/A';

  let msg = `${tipo} - ${timeframe.toUpperCase()}\n\n` +
            `${dataHora}\n\n` +
            `Ativo: *#${symbol}* [- TV](${link})\n` +
            `Preço Atual: ${format(price)}\n` +
            `RSI 1H: ${rsi1hValue.toFixed(2)}\n` +
            `#LSR: ${lsr.value.toFixed(2)}\n` +
            `#VWAP 1H: ${vwap1h !== null ? format(vwap1h) : 'N/A'}\n` +
            `#Suporte: ${format(support)}\n` +
            `#Resistência: ${format(resistance)}\n` +
            `#Vol: ${currentZ.toFixed(2)}\n`;

  if (adxStrong) {
    const inputATR = { period: 14, high: ohlcv50.map(c => c.high), low: ohlcv50.map(c => c.low), close: ohlcv50.map(c => c.close) };
    const atrResults = TechnicalIndicators.ATR.calculate(inputATR);
    const atr = atrResults[atrResults.length - 1] ?? 0;
    const volatilityOk = atr > 0 && (atr / price) >= 0.005;

    if (volatilityOk) {
      const stop = direcao === 'buy' ? price - atr * 1 : price + atr * 1;
      const targets = direcao === 'buy'
        ? [price + atr * 1, price + atr * 2, price + atr * 3, price + atr * 4, resistance]
        : [price - atr * 1, price - atr * 2, price - atr * 3, price - atr * 4, support];

      msg += `\nStop: ${format(stop)}\n` +
             `Alvo 1: ${format(targets[0])}\n` +
             `Alvo 2: ${format(targets[1])}\n` +
             `Alvo 3: ${format(targets[2])}\n` +
             `Alvo 4: ${format(targets[3])}\n` +
             `Alvo 5: ${format(targets[4])}\n`;
    }
  }

  msg += `\nTitanium ALFA32 + FVG by @J4Rviz`;

  historico.push({ direcao, timestamp: agora });
  if (historico.length > config.MAX_HISTORICO_ALERTAS) historico.shift();

  try {
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }));
    logger.info(`Alerta + FVG enviado: ${symbol} ${timeframe} ${direcao}`);
  } catch (e) {
    logger.error(`Erro envio: ${e.message}`);
  }
}

async function fetchAndCalculateRSI(symbol, timeframe) {
  const key = `ohlcv_${symbol}_${timeframe}`;
  const raw = getCachedData(key) || await withRetry(() => exchangeFutures.fetchOHLCV(symbol, timeframe, undefined, config.RSI_PERIOD + 30));
  if (!raw) return { ohlcv: null, rsiValue: null };
  const ohlcv = normalizeOHLCV(raw);
  setCachedData(key, raw);
  if (ohlcv.length < config.RSI_PERIOD + 2) return { ohlcv: null, rsiValue: null };
  const rsi = calculateRSI(ohlcv);
  return { ohlcv, rsiValue: rsi[rsi.length - 1] || null };
}

// ================= LOOP PRINCIPAL ================= //
async function checkConditions() {
  if (!state.isOnline) return;
  logger.info('Iniciando checkConditions com pares: ' + config.PARES_MONITORADOS.join(', '));
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const lsr = await fetchLSR(symbol);
      const { rsiValue: rsi1h } = await fetchAndCalculateRSI(symbol, '1h');
      if (rsi1h === null) return;

      const volume = await fetchVolumeData(symbol);
      if (volume.avgVolume === null) return;

      const adx15m = await fetchAndCalculateADX(symbol, '15m');
      const adx1h = await fetchAndCalculateADX(symbol, '1h');
      const vwap1h = await fetchVWAP1h(symbol);

      for (const tf of config.TIMEFRAMES_MONITORADOS) {
        const { ohlcv, rsiValue } = await fetchAndCalculateRSI(symbol, tf);
        if (!ohlcv || rsiValue === null) continue;

        const price = ohlcv[ohlcv.length - 1].close;
        if (isNaN(price)) continue;

        const rsiFull = calculateRSI(ohlcv);
        const div = detectRSIDivergence(ohlcv, rsiFull, 30);

        if (div.isBullish || div.isBearish) {
          const rsi1hUse = tf === '1h' ? rsiValue : rsi1h;
          await sendAlertRSIDivergence(symbol, tf, price, rsiValue, div, lsr, rsi1hUse, volume, adx15m, adx1h, vwap1h);
        }
      }
    }, 20);
  } catch (e) {
    logger.error(`Erro no loop: ${e.message}`);
  }
}

// ================= INICIALIZAÇÃO ================= //
async function main() {
  logger.info('Iniciando Titanium ALFA32 + FVG...');
  try {
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, 'Titanium Omega1'));
    await checkConnection();
  } catch (e) {
    logger.error(`Falha crítica: ${e.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  logger.error(`Erro fatal: ${err.message}`);
  process.exit(1);
});
