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
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_VERIFICACAO_MS: 1 * 60 * 1000,
  TEMPO_COOLDOWN_MS: 30 * 60 * 1000,
  RSI_PERIOD: 14,
  CACHE_TTL: 10 * 60 * 1000,
  MAX_CACHE_SIZE: 100,
  MAX_HISTORICO_ALERTAS: 10,
  TIMEFRAMES_MONITORADOS: ['1h', '4h'],
  LOG_FILE: 'simple_trading_bot.log',
  LOG_RETENTION_DAYS: 2,
  RECONNECT_INTERVAL_MS: 10 * 1000,
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
  logger.info(`Iniciando limitConcurrency com ${items.length} itens`);
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    logger.info(`Processando batch: ${batch.join(', ')}`);
    const settled = await Promise.allSettled(batch.map(item => fn(item)));
    const rejected = settled.filter(r => r.status === 'rejected');
    if (rejected.length > 0) {
      logger.error(`Erros no batch: ${rejected.map(r => r.reason.message).join('; ')}`);
    }
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
// Verificação de conexão a cada 30s
setInterval(checkConnection, 30 * 1000);
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
    if (!data || data.length < 2) {
      logger.warn(`Dados insuficientes de LSR para ${symbol}: ${data?.length || 0} registros`);
      return { value: null, percentChange: '0.00' };
    }
    const currentLSR = parseFloat(data[0].longShortRatio);
    const previousLSR = parseFloat(data[1].longShortRatio);
    if (isNaN(currentLSR) || isNaN(previousLSR)) {
      logger.warn(`LSR inválido para ${symbol}`);
      return { value: null, percentChange: '0.00' };
    }
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, percentChange };
    setCachedData(cacheKey, result);
    logger.info(`LSR obtido para ${symbol}: ${currentLSR}, variação: ${percentChange}%`);
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
  const closes = data.map(d => d.close).filter(c => !isNaN(c));
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
    const ohlcvRaw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, 11));
    if (!ohlcvRaw || ohlcvRaw.length < 11) return { avgVolume: null };
    const ohlcv = normalizeOHLCV(ohlcvRaw);
    const avgVolume = ohlcv.slice(0, 10).reduce((s, c) => s + c.volume, 0) / 10;
    const now = Date.now();
    const threeMinAgo = now - 3 * 60 * 1000;
    const trades = await withRetry(() => exchangeSpot.fetchTrades(symbol, threeMinAgo, 1000));
    let buy = 0, sell = 0;
    for (const t of trades) {
      if (t.timestamp >= threeMinAgo) {
        if (t.side === 'buy') buy += t.amount;
        else if (t.side === 'sell') sell += t.amount;
      }
    }
    return { avgVolume, buyVolume: buy, sellVolume: sell, totalVolume: buy + sell };
  } catch (e) {
    logger.error(`Erro volume ${symbol}: ${e.message}`);
    return { avgVolume: null };
  }
}
async function fetchAndCalculateADX(symbol, timeframe, period = 14) {
  const key = `ohlcv_adx_${symbol}_${timeframe}`;
  const raw = getCachedData(key) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, timeframe, undefined, period * 2));
  if (!raw) return null;
  const ohlcv = normalizeOHLCV(raw);
  setCachedData(key, raw);
  if (ohlcv.length < period * 2) return null;
  const input = {
    high: ohlcv.map(c => c.high),
    low: ohlcv.map(c => c.low),
    close: ohlcv.map(c => c.close),
    period
  };
  const adxResults = TechnicalIndicators.ADX.calculate(input);
  return adxResults[adxResults.length - 1]?.adx ?? null;
}
// ================= ALERTA ================= //
async function sendAlertRSIDivergence(symbol, timeframe, price, rsiValue, divergence, lsr, rsi1hValue, volumeData, adx15m, adx1h) {
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = {};
  if (!state.ultimoAlertaPorAtivo[symbol][timeframe]) state.ultimoAlertaPorAtivo[symbol][timeframe] = { historico: [] };
  const { isBullish, isBearish } = divergence;
  let direcao = '', tipo = '';
  let lsrOk = false, rsiOk = false, volOk = false;
  const adxStrong = (adx15m ?? 0) > 22 && (adx1h ?? 0) > 22;
  if (isBullish) {
    lsrOk = lsr.value <= 2.5;
    rsiOk = rsi1hValue < 40;
    volOk = volumeData.totalVolume > 2 * volumeData.avgVolume && volumeData.buyVolume > volumeData.sellVolume;
    if (lsrOk && rsiOk && volOk) { 
      direcao = 'buy'; 
      tipo = adxStrong ? 'COMPRA':'💹Análise Bullish'; 
    }
  } else if (isBearish) {
    lsrOk = lsr.value > 2.6;
    rsiOk = rsi1hValue > 60;
    volOk = volumeData.totalVolume > 2 * volumeData.avgVolume && volumeData.sellVolume > volumeData.buyVolume;
    if (lsrOk && rsiOk && volOk) { 
      direcao = 'sell'; 
      tipo = adxStrong ? 'VENDA':'♦️Análise Bearish'; 
    }
  }
  if (!direcao) return;
  const historico = state.ultimoAlertaPorAtivo[symbol][timeframe].historico;
  if (historico.some(h => h.direcao === direcao && agora - h.timestamp < config.TEMPO_COOLDOWN_MS)) return;
  const format = v => isNaN(v) ? 'N/A' : (v < 1 ? v.toFixed(8) : v < 10 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2));
  const link = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=${timeframe.toUpperCase()}`;
  const ohlcv50Raw = await withRetry(() => exchangeSpot.fetchOHLCV(symbol, timeframe, undefined, 50));
  const ohlcv50 = normalizeOHLCV(ohlcv50Raw);
  const highs = ohlcv50.map(c => c.high);
  const lows = ohlcv50.map(c => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const dataHora = new Date().toLocaleString('pt-BR');
  const lsrEmoji = lsr.value < 1 ? ' 🟢' : '';
  const adx15mValue = adx15m ?? 'N/A';
  const adx1hValue = adx1h ?? 'N/A';
  const emoji15m = adx15m > 25 ? '🟢' : '🟡';
  const emoji1h = adx1h > 25 ? '🟢' : '🟡';
 
  let msg = `${tipo} - ${timeframe.toUpperCase()}\n\n` +
              `${dataHora}\n\n` +
              `Ativo: *#${symbol}* [- TV](${link})\n` +
              `Preço Atual: ${format(price)}\n` +
              `RSI ${timeframe}: ${rsiValue.toFixed(2)}\n` +
              `RSI 1H: ${rsi1hValue.toFixed(2)}\n` +
              `ADX 15m: ${isNaN(adx15mValue) ? adx15mValue : adx15mValue.toFixed(2)} ${emoji15m}\n` +
              `ADX 1h: ${isNaN(adx1hValue) ? adx1hValue : adx1hValue.toFixed(2)} ${emoji1h}\n` +
              `#LSR: ${lsr.value.toFixed(2)}${lsrEmoji}\n` +
              `#Suporte: ${format(support)}\n` +
              `#Resistência: ${format(resistance)}\n`;
  if (adxStrong) {
    const inputATR = {
      period: 14,
      high: ohlcv50.map(c => c.high),
      low: ohlcv50.map(c => c.low),
      close: ohlcv50.map(c => c.close),
    };
    const atrResults = TechnicalIndicators.ATR.calculate(inputATR);
    const atr = atrResults[atrResults.length - 1] ?? 0;
    let stop, targets;
    if (direcao === 'buy') {
      stop = price - atr * 1;
      targets = [price + atr * 1, price + atr * 2, price + atr * 3, price + atr * 4];
    } else {
      stop = price + atr * 1;
      targets = [price - atr * 1, price - atr * 2, price - atr * 3, price - atr * 4];
    }
    msg += `\n⛔Stop: ${format(stop)}\n` +
           `Alvo 1: ${format(targets[0])}\n` +
           `Alvo 2: ${format(targets[1])}\n` +
           `Alvo 3: ${format(targets[2])}\n` +
           `Alvo 4: ${format(targets[3])}\n`;
  }
  msg += `🤖IA Titanium ALFA🌟 by @J4Rviz`;
  historico.push({ direcao, timestamp: agora });
  if (historico.length > config.MAX_HISTORICO_ALERTAS) historico.shift();
  try {
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, msg, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }));
    logger.info(`Alerta enviado: ${symbol} ${timeframe} ${direcao}`);
  } catch (e) {
    logger.error(`Erro envio: ${e.message}`);
  }
}
async function fetchAndCalculateRSI(symbol, timeframe) {
  const key = `ohlcv_${symbol}_${timeframe}`;
  const raw = getCachedData(key) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, timeframe, undefined, config.RSI_PERIOD + 30));
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
      logger.info(`Verificando condições para ${symbol}...`);
      const lsr = await fetchLSR(symbol);
      const { rsiValue: rsi1h } = await fetchAndCalculateRSI(symbol, '1h');
      if (rsi1h === null) {
        logger.warn(`RSI 1h indisponível para ${symbol}`);
        return;
      }
      const volume = await fetchVolumeData(symbol);
      if (volume.avgVolume === null) {
        logger.warn(`Volume indisponível para ${symbol}`);
        return;
      }
      const adx15m = await fetchAndCalculateADX(symbol, '15m');
      const adx1h = await fetchAndCalculateADX(symbol, '1h');
      for (const tf of config.TIMEFRAMES_MONITORADOS) {
        const { ohlcv, rsiValue } = await fetchAndCalculateRSI(symbol, tf);
        if (!ohlcv || rsiValue === null) continue;
        const price = ohlcv[ohlcv.length - 1].close;
        if (isNaN(price)) continue;
        const rsiFull = calculateRSI(ohlcv);
        const div = detectRSIDivergence(ohlcv, rsiFull, 30);
        if (div.isBullish || div.isBearish) {
          const rsi1hUse = tf === '1h' ? rsiValue : rsi1h;
          await sendAlertRSIDivergence(symbol, tf, price, rsiValue, div, lsr, rsi1hUse, volume, adx15m, adx1h);
        } else {
          logger.info(`Nenhuma divergência em ${symbol} no ${tf}`);
        }
      }
    }, 5);
  } catch (e) {
    logger.error(`Erro no loop: ${e.message}`);
  }
}
// ================= INICIALIZAÇÃO CORRIGIDA ================= //
async function main() {
  logger.info('Iniciando Titanium D...');
  try {
    // Envia mensagem de start
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, 'Titanium ALFA start'));
    logger.info('Mensagem de start enviada');
    // Primeira verificação de conexão
    await checkConnection();
  } catch (e) {
    logger.error(`Falha crítica na inicialização: ${e.message}`);
    process.exit(1);
  }
}
// Inicia tudo
main().catch(err => {
  logger.error(`Erro fatal: ${err.message}`);
  process.exit(1);
});
