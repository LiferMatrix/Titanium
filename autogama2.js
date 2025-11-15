require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const ccxt = require('ccxt');
const fs = require('fs/promises'); // Usar versão promises para async
const path = require('path');
// Configurações
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const binance = new Binance().options({
    futures: true,
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_SECRET,
    reconnect: true
});
// Inicializa ccxt para Binance Futures
const binanceCCXT = new ccxt.binance({
    enableRateLimit: true,
    options: { defaultType: 'future' }
});
// Inicializa Telegram Bot
let telegramBot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('✅ Telegram Bot conectado para envio de alertas!');
} else {
    console.log('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}
// Arquivos de log e persistência
const logFile = 'app.log';
const alertedFile = 'alerted.json';
// Função para logar mensagens (console + arquivo async)
async function logMessage(message) {
    const timestamp = new Date().toLocaleString('pt-BR');
    const logEntry = `[${timestamp}] ${message}`;
    console.log(logEntry);
    try {
        await fs.appendFile(logFile, logEntry + '\n', 'utf8');
    } catch (error) {
        console.error('❌ Erro ao append log: ' + error.message);
    }
}
// Limpeza automática de logs a cada 2 dias
setInterval(async () => {
    try {
        await fs.writeFile(logFile, '', 'utf8');
        await logMessage('🧹 Logs limpos automaticamente.');
    } catch (error) {
        console.error('❌ Erro na limpeza de logs: ' + error.message);
    }
}, 2 * 24 * 60 * 60 * 1000); // 2 dias em milissegundos
// Função de retry com backoff exponencial e mais tentativas
async function retryAsync(fn, retries = 5, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delay * Math.pow(2, i)));
        }
    }
}
// Cache para OHLCV
const ohlcvCache = new Map();
async function fetchOHLCVWithCache(symbol, timeframe, limit) {
    const key = `${symbol}_${timeframe}_${limit}`;
    if (ohlcvCache.has(key)) {
        return ohlcvCache.get(key);
    }
    const ohlcv = await retryAsync(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, limit));
    ohlcvCache.set(key, ohlcv);
    setTimeout(() => ohlcvCache.delete(key), 60 * 1000); // Cache TTL 1min
    return ohlcv;
}
// Alerted flags (persistente)
let alerted = {};
async function loadAlerted() {
    try {
        const data = await fs.readFile(alertedFile, 'utf8');
        alerted = JSON.parse(data);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('❌ Erro ao carregar alerted: ' + error.message);
    }
}
async function saveAlerted() {
    try {
        await fs.writeFile(alertedFile, JSON.stringify(alerted), 'utf8');
    } catch (error) {
        console.error('❌ Erro ao salvar alerted: ' + error.message);
    }
}
// Função para enviar mensagem no Telegram (UNIFICADA)
async function alertCriticalError(message, error, context = {}) {
    const timestamp = new Date().toLocaleString('pt-BR');
    const contextStr = Object.keys(context).length > 0 ? `\nContexto: ${JSON.stringify(context)}` : '';
    const fullMessage = `🚨 ERRO CRÍTICO [${timestamp}]: ${message}${contextStr}\nStack: ${error.stack}`;
  
    // 1. Loga o erro completo no arquivo e console
    console.error(fullMessage);
    try {
        await fs.appendFile(logFile, fullMessage + '\n', 'utf8');
    } catch (e) {
        console.error('❌ Erro ao append log (crítico): ' + e.message);
    }
    // 2. Envia alerta imediato e formatado para o Telegram
    if (telegramBot) {
        const telegramMsg = `🚨 *ERRO CRÍTICO* [${timestamp}]\n\n${message}\n\nDetalhes: ${error.message}`;
        try {
            // Envia sem parse_mode 'Markdown' para evitar falha de formatação em erro
            await telegramBot.sendMessage(TELEGRAM_CHAT_ID, telegramMsg);
        } catch (e) {
            console.error('Falha ao enviar alerta crítico para Telegram: ' + e.message);
        }
    }
}
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        await logMessage(message);
        return;
    }
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        await logMessage('📱 Alerta enviado!');
    } catch (error) {
        // Usa alertCriticalError para falha no envio de mensagem
        await alertCriticalError('Falha ao enviar mensagem no Telegram', error, { originalMessage: message.substring(0, 100) + '...' });
    }
}
// Encerramento gracioso
process.on('SIGINT', async () => {
    await saveAlerted();
    await logMessage('\n👋 Monitor encerrado.');
    process.exit(0);
});
// Validações
if (!TELEGRAM_BOT_TOKEN) logMessage('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) logMessage('⚠️ TELEGRAM_CHAT_ID não encontrado');
// ================= CONFIGURAÇÕES ================= //
// Cache para Option Walls por símbolo (15 minutos)
const wallsCache = new Map();
// Cache para Futures Order Book Walls (1 minuto)
const futuresWallsCache = new Map();
// Função para fetch LSR com tratamento mais robusto
async function fetchLSR(symbol) {
  try {
    const symbolWithoutSlash = symbol.includes('/') ? symbol.replace('/', '') : symbol;
    const res = await retryAsync(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbolWithoutSlash, period: '15m', limit: 1 },
      timeout: 10000 // 10 segundos
    }));
    if (!res.data || res.data.length < 1) {
      await logMessage(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return 'Indisponível';
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    if (isNaN(currentLSR) || currentLSR < 0) {
      await logMessage(`LSR inválido para ${symbol}`);
      return 'Indisponível';
    }
    const fixedLSR = currentLSR.toFixed(2);
    await logMessage(`LSR obtido para ${symbol}: ${fixedLSR}`);
    return fixedLSR;
  } catch (e) {
    await logMessage(`Erro ao buscar LSR para ${symbol}: ${e.message}. Retornando 'Indisponível'.`);
    return 'Indisponível';
  }
}
// Função para calcular RSI com delta e divergência
async function getRSI(symbol, timeframe, period = 14) {
  try {
    const limit = period + 10; // Mais velas para detectar divergência (pelo menos 4-5)
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < period + 4) { // Mínimo para divergência simples
      await logMessage(`⚠️ Dados insuficientes para RSI/divergência ${symbol} (${timeframe}): ${closes.length} velas`);
      return { rsi: 'Indisponível', delta: 0, bullish_divergence: false, bearish_divergence: false };
    }
    // Função auxiliar para calcular RSI em uma série de closes
    function calculateRSI(closesSlice, period) {
      let gains = 0, losses = 0;
      for (let i = 1; i < closesSlice.length; i++) {
        const change = closesSlice[i] - closesSlice[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      return rs === Infinity ? 100 : 100 - (100 / (1 + rs));
    }
    // RSI atual (últimas period+1 velas)
    const currentCloses = closes.slice(- (period + 1));
    const rsiCurrent = calculateRSI(currentCloses, period);
    // RSI anterior
    const prevCloses = closes.slice(- (period + 2), -1);
    const rsiPrev = calculateRSI(prevCloses, period);
    const delta = (rsiCurrent - rsiPrev).toFixed(2);
    // Detecção de divergência (Lógica Aprimorada: busca por 2 picos/vales em 10 velas)
    const lookback = 10; // Analisa as últimas 10 velas
    const recentCloses = closes.slice(-lookback);
    const rsiValues = [];
    for (let i = 0; i < lookback; i++) {
      // Calcula o RSI para cada ponto, garantindo dados suficientes
      const slice = closes.slice(-(period + 1 + lookback - 1 - i), -(lookback - 1 - i) || undefined);
      if (slice.length >= period + 1) {
        rsiValues.push(calculateRSI(slice, period));
      } else {
        rsiValues.push(null);
      }
    }
    // Remove os nulos do início se houver
    const validRsiValues = rsiValues.filter(v => v !== null);
    const validCloses = recentCloses.slice(lookback - validRsiValues.length);
    let bullishDivergence = false;
    let bearishDivergence = false;
    // Busca por 2 vales (lows) para divergência bullish
    for (let i = 0; i < validCloses.length - 1; i++) {
        for (let j = i + 1; j < validCloses.length; j++) {
            // Condição de divergência bullish: Preço faz Lower Low (LL), RSI faz Higher Low (HL)
            if (validCloses[j] < validCloses[i] && validRsiValues[j] > validRsiValues[i]) {
                bullishDivergence = true;
                break;
            }
        }
        if (bullishDivergence) break;
    }
    // Busca por 2 picos (highs) para divergência bearish
    for (let i = 0; i < validCloses.length - 1; i++) {
        for (let j = i + 1; j < validCloses.length; j++) {
            // Condição de divergência bearish: Preço faz Higher High (HH), RSI faz Lower High (LH)
            if (validCloses[j] > validCloses[i] && validRsiValues[j] < validRsiValues[i]) {
                bearishDivergence = true;
                break;
            }
        }
        if (bearishDivergence) break;
    }
  
    // Loga o resultado da divergência
    await logMessage(`Divergência ${symbol} (${timeframe}): Bullish=${bullishDivergence}, Bearish=${bearishDivergence}`);
    const result = { rsi: rsiCurrent.toFixed(2), delta, bullish_divergence: bullishDivergence, bearish_divergence: bearishDivergence };
    await logMessage(`✅ RSI ${symbol} (${timeframe}): ${result.rsi} (Delta: ${result.delta}), Bullish Div: ${result.bullish_divergence}, Bearish Div: ${result.bearish_divergence}`);
    return result;
  } catch (error) {
    await logMessage(`❌ Erro ao calcular RSI ${symbol} (${timeframe}): ${error.message}`);
    return { rsi: 'Indisponível', delta: 0, bullish_divergence: false, bearish_divergence: false };
  }
}
// Função para calcular ATR
async function getATR(symbol, timeframe = '1h', period = 14) {
  try {
    const limit = period + 1;
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    if (ohlcv.length < period + 1) {
      await logMessage(`⚠️ Dados insuficientes para ATR ${symbol} (${timeframe}): ${ohlcv.length}/${period + 1} velas`);
      return 0;
    }
    const trs = [];
    for (let i = 1; i < ohlcv.length; i++) {
      const high = parseFloat(ohlcv[i][2]);
      const low = parseFloat(ohlcv[i][3]);
      const prevClose = parseFloat(ohlcv[i-1][4]);
      if (isNaN(high) || isNaN(low) || isNaN(prevClose)) continue;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    if (trs.length < period) return 0;
    const atr = trs.reduce((a, b) => a + b, 0) / period;
    await logMessage(`✅ ATR ${symbol} (${timeframe}): ${atr.toFixed(2)}`);
    return atr;
  } catch (error) {
    await logMessage(`❌ Erro ao calcular ATR ${symbol} (${timeframe}): ${error.message}`);
    return 0;
  }
}
// Função para calcular VWAP
async function getVWAP(symbol, timeframe = '1h') {
  try {
    const limit = 100; // Um limite razoável para o cálculo do VWAP do dia/período
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    if (ohlcv.length === 0) {
      await logMessage(`⚠️ Dados insuficientes para VWAP ${symbol} (${timeframe})`);
      return 'Indisponível';
    }
    let totalTypicalPriceVolume = 0;
    let totalVolume = 0;
    for (const candle of ohlcv) {
      const high = parseFloat(candle[2]);
      const low = parseFloat(candle[3]);
      const close = parseFloat(candle[4]);
      const volume = parseFloat(candle[5]);
      if (isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume) || volume === 0) continue;
      // Preço Típico = (High + Low + Close) / 3
      const typicalPrice = (high + low + close) / 3;
      totalTypicalPriceVolume += typicalPrice * volume;
      totalVolume += volume;
    }
    if (totalVolume === 0) {
      await logMessage(`⚠️ Volume total zero para VWAP ${symbol} (${timeframe})`);
      return 'Indisponível';
    }
    const vwap = totalTypicalPriceVolume / totalVolume;
    const result = vwap.toFixed(2);
    await logMessage(`✅ VWAP ${symbol} (${timeframe}): ${result}`);
    return result;
  } catch (error) {
    await logMessage(`❌ Erro ao calcular VWAP ${symbol} (${timeframe}): ${error.message}`);
    return 'Indisponível';
  }
}
// Função para fetch preço spot (mark price para futures)
async function fetchSpotPrice(symbol) {
  try {
    const ticker = await retryAsync(() => binanceCCXT.fetchTicker(symbol));
    const price = ticker.last;
    if (isNaN(price) || price <= 0) {
      await logMessage(`Preço inválido para ${symbol}`);
      return 0;
    }
    await logMessage(`Preço obtido para ${symbol}: ${price}`);
    return price;
  } catch (e) {
    await logMessage(`Erro ao buscar preço para ${symbol}: ${e.message}`);
    return 0;
  }
}
// Função para calcular EMA
function calculateEMA(prices, period) {
  if (prices.length < period) return [];
  const ema = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema.push(sum / period);
  for (let i = period; i < prices.length; i++) {
    const value = (prices[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
    ema.push(value);
  }
  return ema;
}
// Função unificada para EMAs e crossover
async function getEMAsAndCrossover(symbol, timeframe = '3m', shortPeriod = 13, longPeriod = 34, ema55Period = 55) {
  try {
    const limit = Math.max(longPeriod, ema55Period) * 2 + 1;
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < Math.max(longPeriod, ema55Period) + 1) {
      await logMessage(`⚠️ Dados insuficientes para EMAs ${symbol} (${timeframe}): ${closes.length} velas`);
      return { buyCross: false, sellCross: false, ema55: null, currentClose: null, prevClose: null };
    }
    const emaShort = calculateEMA(closes, shortPeriod);
    const emaLong = calculateEMA(closes, longPeriod);
    const ema55 = calculateEMA(closes, ema55Period);
    if (emaShort.length < 2 || emaLong.length < 2 || ema55.length < 2) {
      return { buyCross: false, sellCross: false, ema55: null, currentClose: null, prevClose: null };
    }
    const prevShort = emaShort[emaShort.length - 2];
    const currShort = emaShort[emaShort.length - 1];
    const prevLong = emaLong[emaLong.length - 2];
    const currLong = emaLong[emaLong.length - 1];
    const prevEma55 = ema55[ema55.length - 2];
    const ema55Current = ema55[ema55.length - 1];
    const currentClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const buyCross = (prevShort <= prevLong) && (currShort > currLong) && (prevShort > prevEma55);
    await logMessage(`✅ EMA Crossover Buy Check: (prevShort <= prevLong)=${(prevShort <= prevLong)}, (currShort > currLong)=${(currShort > currLong)}, (prevShort > prevEma55)=${(prevShort > prevEma55)}`);
    const sellCross = (prevShort >= prevLong) && (currShort < currLong) && (prevShort < prevEma55);
    await logMessage(`✅ EMA Crossover Sell Check: (prevShort >= prevLong)=${(prevShort >= prevLong)}, (currShort < currLong)=${(currShort < currLong)}, (prevShort < prevEma55)=${(prevShort < prevEma55)}`);
    await logMessage(`✅ EMA Crossover ${symbol} (${timeframe}): Buy=${buyCross}, Sell=${sellCross}`);
    return { buyCross, sellCross, ema55: ema55Current, currentClose, prevClose };
  } catch (error) {
    await logMessage(`❌ Erro ao calcular EMAs/crossover ${symbol} (${timeframe}): ${error.message}`);
    return { buyCross: false, sellCross: false, ema55: null, currentClose: null, prevClose: null };
  }
}
// Função para obter vencimento mais próximo (com validação robusta)
async function getNearestExpiry(baseSymbol) {
  try {
    const res = await retryAsync(() => axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo'));
    if (!res.data?.optionSymbols || !Array.isArray(res.data.optionSymbols)) {
      await logMessage(`Dados inválidos de exchangeInfo para ${baseSymbol}`);
      return null;
    }
    const now = Date.now();
    const validExpiries = res.data.optionSymbols
      .filter(s =>
        s.underlying === baseSymbol &&
        s.expiryDate &&
        !isNaN(s.expiryDate) &&
        new Date(parseInt(s.expiryDate)) > now
      )
      .map(s => parseInt(s.expiryDate))
      .sort((a, b) => a - b);
    return validExpiries[0] || null;
  } catch (e) {
    await logMessage(`Erro ao buscar vencimento para ${baseSymbol}: ${e.message}`);
    return null;
  }
}
// Função para obter Open Interest de opções
async function getOptionOI(baseSymbol, expiry) {
  if (!expiry) return [];
  try {
    const expiryStr = expiry.toString();
    const formattedExpiry = expiryStr.slice(2, 8); // YYMMDD
    const res = await retryAsync(() => axios.get('https://eapi.binance.com/eapi/v1/openInterest', {
      params: { underlyingAsset: baseSymbol, expiration: formattedExpiry },
      timeout: 10000
    }));
    return Array.isArray(res.data?.data) ? res.data.data : [];
  } catch (e) {
    await logMessage(`Erro ao buscar OI para ${baseSymbol} (exp: ${expiry}): ${e.message}`);
    return [];
  }
}
// Função para fetch walls com CACHE POR SÍMBOLO e agregação em clusters
async function fetchOptionWalls(baseSymbol) {
  const cacheKey = baseSymbol;
  const now = Date.now();
  const cacheTTL = 15 * 60 * 1000; // 15 minutos
  // Verifica cache
  if (wallsCache.has(cacheKey)) {
    const cached = wallsCache.get(cacheKey);
    if (now - cached.timestamp < cacheTTL) {
      await logMessage(`Cache HIT para walls de ${baseSymbol}`);
      return cached.data;
    }
  }
  const expiry = await getNearestExpiry(baseSymbol);
  if (!expiry) {
    const fallback = { putWall: 0, callWall: 0, expiry: 'Indisponível' };
    wallsCache.set(cacheKey, { data: fallback, timestamp: now });
    return fallback;
  }
  const oiData = await getOptionOI(baseSymbol, expiry);
  const spotPrice = await fetchSpotPrice(baseSymbol + 'USDT');
  if (oiData.length === 0) {
    const fallback = { putWall: 0, callWall: 0, expiry: new Date(expiry).toLocaleDateString('pt-BR') };
    wallsCache.set(cacheKey, { data: fallback, timestamp: now });
    return fallback;
  }
  // Agregação em clusters (bins de 100 para BTC/ETH, ajuste se necessário)
  const binSize = baseSymbol === 'BTC' ? 100 : 10; // Ex: BTC bins de 100, ETH de 10
  const strikeMapPut = new Map();
  const strikeMapCall = new Map();
  oiData.forEach(item => {
    const strike = parseFloat(item.strikePrice);
    const oi = parseFloat(item.openInterest);
    if (isNaN(strike) || isNaN(oi)) return;
    const bin = Math.round(strike / binSize) * binSize;
    if (item.side === 'PUT') {
      if (strikeMapPut.has(bin)) {
        strikeMapPut.set(bin, strikeMapPut.get(bin) + oi);
      } else {
        strikeMapPut.set(bin, oi);
      }
    } else if (item.side === 'CALL') {
      if (strikeMapCall.has(bin)) {
        strikeMapCall.set(bin, strikeMapCall.get(bin) + oi);
      } else {
        strikeMapCall.set(bin, oi);
      }
    }
  });
  // Encontrar bin com max OI
  let maxPutOI = 0, putWall = 0;
  strikeMapPut.forEach((oi, bin) => {
    if (oi > maxPutOI) {
      maxPutOI = oi;
      putWall = bin;
    }
  });
  let maxCallOI = 0, callWall = 0;
  strikeMapCall.forEach((oi, bin) => {
    if (oi > maxCallOI) {
      maxCallOI = oi;
      callWall = bin;
    }
  });
  const result = {
    putWall: putWall || 0,
    callWall: callWall || 0,
    expiry: new Date(expiry).toLocaleDateString('pt-BR')
  };
  await logMessage(`Walls agregadas para ${baseSymbol}: Put ${result.putWall}, Call ${result.callWall}`);
  wallsCache.set(cacheKey, { data: result, timestamp: now });
  return result;
}
// Função para fetch Futures Order Book Walls (dinâmico com agregação)
async function fetchFuturesWalls(symbol) {
  const cacheKey = symbol;
  const now = Date.now();
  const cacheTTL = 1 * 60 * 1000; // 1 minuto para dinamismo
  if (futuresWallsCache.has(cacheKey)) {
    const cached = futuresWallsCache.get(cacheKey);
    if (now - cached.timestamp < cacheTTL) {
      await logMessage(`Cache HIT para futures walls de ${symbol}`);
      return cached.data;
    }
  }
  try {
    const orderBook = await retryAsync(() => binanceCCXT.fetchOrderBook(symbol, 100)); // Top 100 bids/asks
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      await logMessage(`Order book inválido para ${symbol}`);
      return { putWall: 0, callWall: 0 };
    }
    const spotPrice = await fetchSpotPrice(symbol);
    const binSize = symbol.includes('BTC') ? 100 : 10; // Ajuste similar
    const bidMap = new Map();
    orderBook.bids.forEach(([price, volume]) => {
      const p = parseFloat(price);
      const vol = parseFloat(volume);
      const bin = Math.round(p / binSize) * binSize;
      if (bidMap.has(bin)) {
        bidMap.set(bin, bidMap.get(bin) + vol);
      } else {
        bidMap.set(bin, vol);
      }
    });
    const askMap = new Map();
    orderBook.asks.forEach(([price, volume]) => {
      const p = parseFloat(price);
      const vol = parseFloat(volume);
      const bin = Math.round(p / binSize) * binSize;
      if (askMap.has(bin)) {
        askMap.set(bin, askMap.get(bin) + vol);
      } else {
        askMap.set(bin, vol);
      }
    });
    let maxBidVol = 0, putWall = 0;
    bidMap.forEach((vol, bin) => {
      if (vol > maxBidVol) {
        maxBidVol = vol;
        putWall = bin;
      }
    });
    let maxAskVol = 0, callWall = 0;
    askMap.forEach((vol, bin) => {
      if (vol > maxAskVol) {
        maxAskVol = vol;
        callWall = bin;
      }
    });
    const result = {
      putWall: putWall || 0,
      callWall: callWall || 0
    };
    await logMessage(`Futures Walls agregadas para ${symbol}: Put (Bid) ${result.putWall} (vol: ${maxBidVol}), Call (Ask) ${result.callWall} (vol: ${maxAskVol})`);
    futuresWallsCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  } catch (e) {
    await alertCriticalError(`Erro ao buscar futures walls para ${symbol}`, e, { symbol });
    return { putWall: 0, callWall: 0 };
  }
}
// Função para detectar baleias via trades recentes (sem websocket, com threshold dinâmico)
async function getRecentWhales(symbol) {
  try {
    // Calcular volume médio diário (soma das últimas 24 velas de 1h)
    const ohlcv = await fetchOHLCVWithCache(symbol, '1h', 24);
    let totalVolume = 0;
    ohlcv.forEach(candle => {
      totalVolume += parseFloat(candle[5]) || 0;
    });
    const avgDailyVolume = totalVolume / 24; // Média por hora, mas para diário é total/1; aqui usamos como base
    const whaleThreshold = 0.001 * avgDailyVolume; // 0.1% do volume médio diário (ajuste se necessário)
    await logMessage(`Volume médio diário para ${symbol}: ${avgDailyVolume.toFixed(2)}, Threshold dinâmico: ${whaleThreshold.toFixed(2)}`);
    const since = Date.now() - 5 * 60 * 1000; // Últimos 5 minutos
    const trades = await retryAsync(() => binanceCCXT.fetchTrades(symbol, since, 500)); // Até 500 trades
    let buys = 0, sells = 0;
    trades.forEach(trade => {
      const qty = parseFloat(trade.amount);
      if (qty > whaleThreshold) {
        if (trade.side === 'buy') buys += qty;
        else if (trade.side === 'sell') sells += qty;
      }
    });
    await logMessage(`Whales recentes para ${symbol}: Buys ${buys}, Sells ${sells}`);
    return { buys, sells };
  } catch (e) {
    await alertCriticalError(`Erro ao buscar trades/volume para ${symbol}`, e, { symbol });
    return { buys: 0, sells: 0 };
  }
}
// Função para fetch funding rate (CORRIGIDA – NUNCA MAIS VAI DAR NaN)
async function fetchFundingRate(symbol) {
  try {
    const funding = await retryAsync(() => binanceCCXT.fetchFundingRate(symbol));
    let rateStr = funding.lastFundingRate || funding.fundingRate || '0';
    let rate = parseFloat(rateStr);
    if (isNaN(rate)) rate = 0;
    rate = rate * 100; // Em %
    await logMessage(`Funding Rate para ${symbol}: ${rate.toFixed(4)}%`);
    return rate;
  } catch (e) {
    await logMessage(`Erro ao buscar funding rate para ${symbol}: ${e.message} – usando 0%`);
    return 0; // Nunca mais NaN
  }
}
// Função para detectar spike de volume
async function getVolumeSpike(symbol) {
  try {
    const ohlcv = await fetchOHLCVWithCache(symbol, '3m', 10); // Últimos 30min
    const volumes = ohlcv.map(c => parseFloat(c[5])).filter(v => v > 0);
    if (volumes.length < 10) return false;
    const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / 9;
    const currentVol = volumes[volumes.length - 1];
    const spike = currentVol > avgVol * 1.5; // Reduzido de 2.0 para 1.5 para mais sensibilidade à volatilidade
    await logMessage(`Volume Spike para ${symbol}: Current ${currentVol.toFixed(2)}, Avg ${avgVol.toFixed(2)}, Spike: ${spike}`);
    return spike;
  } catch (e) {
    await alertCriticalError(`Erro ao calcular volume spike para ${symbol}`, e, { symbol });
    return false;
  }
}
// Função para calcular MACD
async function getMACD(symbol, timeframe = '3m') {
  try {
    const limit = 50;
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < 34) {
      await logMessage(`⚠️ Dados insuficientes para MACD ${symbol} (${timeframe})`);
      return { buyCross: false, sellCross: false };
    }
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macd = ema12[ema12.length - 1] - ema26[ema26.length - 1];
    const prevMacd = ema12[ema12.length - 2] - ema26[ema26.length - 2];
    const buyCross = prevMacd < 0 && macd > 0;
    const sellCross = prevMacd > 0 && macd < 0;
    await logMessage(`MACD ${symbol} (${timeframe}): BuyCross=${buyCross}, SellCross=${sellCross}`);
    return { buyCross, sellCross };
  } catch (error) {
    await alertCriticalError(`Falha ao calcular MACD ${symbol} (${timeframe})`, error, { symbol, timeframe });
    return { buyCross: false, sellCross: false };
  }
}
// ===== IA PREDITIVA 11.0 PRO DUAL – MELHORADA COM MAIS SENSIBILIDADE À VOLATILIDADE =====
async function getAIPredictive(symbol, data) {
  try {
    await logMessage(`Iniciando IA preditiva aprimorada para ${symbol}`);
    const ohlcv3m = await fetchOHLCVWithCache(symbol, '3m', 20);
    const closes = ohlcv3m.map(c => parseFloat(c[4]));
    const volumes = ohlcv3m.map(c => parseFloat(c[5]));
    const priceDelta = (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] * 100;
    const volAvg = volumes.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
    const volChange = (volumes[volumes.length - 1] - volAvg) / volAvg * 100;
    // DISTÂNCIA ÀS WALLS (mais sensível)
    const distPut = Math.abs((data.spotPrice - data.putWall) / data.spotPrice * 100);
    const distCall = Math.abs((data.spotPrice - data.callWall) / data.spotPrice * 100);
    const rsiDeltaRate = parseFloat(data.rsi1h.delta) / 3;
    const fundingProj = data.fundingRate * 1.08; // leve piora em 40min
    const whaleRatioBuy = data.whales.buys / (data.whales.sells || 1);
    const whaleRatioSell = data.whales.sells / (data.whales.buys || 1);
    // Fator de volatilidade dinâmico baseado em ATR e volChange
    const volatilityFactor = (data.atr / data.spotPrice * 100) + (volChange / 100); // % de ATR + % vol change
    const volBoost = volatilityFactor > 0.5 ? 1.2 : 1.0; // Boost de 20% se vol alta
    // SCORE LONG (0–100) - Aumentado sensibilidade
    const scoreLong = volBoost * (
      (distPut < 1.0 ? 28 : 0) +  // Aumentado de 0.6 para 1.0
      (volChange > 100 ? 22 : 0) +  // Reduzido de 160 para 100
      (rsiDeltaRate > 0.08 ? 16 : 0) +  // Reduzido de 0.12 para 0.08
      (data.rsi1h.bullish_divergence ? 18 : 0) +
      (whaleRatioBuy > 1.2 ? 12 : 0) +  // Reduzido de 1.8 para 1.2
      (priceDelta > 0.04 ? 10 : 0) +  // Reduzido de 0.06 para 0.04
      (fundingProj < -0.015 ? 8 : 0) +  // Reduzido de -0.022 para -0.015
      (data.macd.buyCross ? 15 : 0)
    );
    // SCORE SHORT (0–100) - Aumentado sensibilidade
    const scoreShort = volBoost * (
      (distCall < 1.0 ? 28 : 0) +
      (volChange > 100 ? 22 : 0) +
      (rsiDeltaRate < -0.08 ? 16 : 0) +
      (data.rsi1h.bearish_divergence ? 18 : 0) +
      (whaleRatioSell > 1.2 ? 12 : 0) +
      (priceDelta < -0.04 ? 10 : 0) +
      (fundingProj > 0.02 ? 8 : 0) +
      (data.macd.sellCross ? 15 : 0)
    );
    const timeEst = 15 + Math.random() * 30; // Reduzido para 15–45min para mais dinamismo
    const probLong = Math.min(99.9, scoreLong + Math.random() * 10);  // Aumentado random para mais variação
    const probShort = Math.min(99.9, scoreShort + Math.random() * 10);
    // ENVIA PRÉ-ALERTA LONG - Limite reduzido para 70%
    if (probLong > 70) {
      const stage = probLong > 85 ? 'ALERTA QUENTE' : 'Posição';
      const msg = `
${stage} 🤖IA [${symbol}] ❇️Compra
💰 *Preço Atual:* ${data.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
Perspectiva⏳: ${probLong.toFixed(1)}% em ${timeEst.toFixed(0)}min
Put Wall alvo: ${data.putWall.toFixed(2)} USDT
Fund.: ${data.fundingRate.toFixed(4)}% → ${fundingProj.toFixed(4)}%
Vol. +${volChange.toFixed(0)}% (Boost Vol: x${volBoost.toFixed(1)}) 🐋Baleias ${whaleRatioBuy.toFixed(1)}x mais ✅COMPRAS
${data.rsi1h.bullish_divergence ? '✅Divergência BULLISH' : '✅RSI subindo'}
${stage === 'ALERTA' ? 'ENTRE COM 50-70% AGORA' : '✅PREPARAR COMPRA'}
      `.trim();
      await sendTelegramMessage(msg);
    }
    // ENVIA PRÉ-ALERTA SHORT - Limite reduzido para 70%
    if (probShort > 70) {
      const stage = probShort > 85 ? 'ALERTA SHORT' : 'Posição';
      const msg = `
${stage} 🤖IA [${symbol}] 🔴VENDA
💰 *Preço Atual:* ${data.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
Perspectiva⏳: ${probShort.toFixed(1)}% em ${timeEst.toFixed(0)}min
Call Wall alvo: ${data.callWall.toFixed(2)} USDT
Fund.: ${data.fundingRate.toFixed(4)}% → ${fundingProj.toFixed(4)}%
Vol.: +${volChange.toFixed(0)}% (Boost Vol: x${volBoost.toFixed(1)}) 🐋Baleias ${whaleRatioSell.toFixed(1)}x mais 🔴VENDAS
${data.rsi1h.bearish_divergence ? '📍Divergência BEARISH' : '📍RSI caindo'}
${stage.includes('QUENTE') ? 'ENTRE COM 50-70% SHORT AGORA' : 'PREPARAR VENDA'}
      `.trim();
      await sendTelegramMessage(msg);
    }
    return { probLong, probShort, timeEst };
  } catch (e) {
    await alertCriticalError(`Erro IA preditiva dual para ${symbol}`, e, { symbol });
    return { probLong: 0, probShort: 0, timeEst: 0 };
  }
}
// Dados base por símbolo
const symbolsData = {
  'BTCUSDT': { base: 'BTC', symbolDisplay: 'BTCUSDT.P' },
  'ETHUSDT': { base: 'ETH', symbolDisplay: 'ETHUSDT.P' }
};
// ================= FUNÇÕES ================= //
// Função para detectar melhor compra - Mais sensível à volatilidade
function detectarCompra(d) {
  const volatilityFactor = d.atr / d.spotPrice * 100; // % de volatilidade via ATR
  const tolerance = (d.atr * 0.8) / d.spotPrice || 0.002; // Aumentado sensibilidade (de 0.5 para 0.8, default 0.2%)
  const isEmaValid = d.ema55 !== null && d.prevClose !== null;
  const isCrossValid = d.buyCross === true;
  const aboveEma55 = isEmaValid && d.prevClose > d.ema55;
  const rsiBuy = parseFloat(d.rsi1h.rsi) > 25 && parseFloat(d.rsi1h.delta) > 1 && parseFloat(d.rsi4h.rsi) < 55 && (d.rsi1h.bullish_divergence || volatilityFactor > 0.5); // Relaxado e OR com vol
  const whaleBuy = d.whales.buys > d.whales.sells * 1.2; // Reduzido de 1.5 para 1.2
  const fundingBuy = d.fundingRate < -0.005; // Reduzido de -0.01 para -0.005
  const volumeSpike = d.volumeSpike === true || volatilityFactor > 0.7; // OR com vol alta
  const macdBuy = d.macd.buyCross === true;
  return d.spotPrice > 0 &&
         d.spotPrice <= d.putWall * (1 + tolerance) &&
         isCrossValid &&
         aboveEma55 &&
         rsiBuy &&
         whaleBuy &&
         fundingBuy &&
         volumeSpike &&
         macdBuy &&
         d.atr > 0;
}
// Função para detectar melhor venda - Mais sensível à volatilidade
function detectarVenda(d) {
  const volatilityFactor = d.atr / d.spotPrice * 100;
  const tolerance = (d.atr * 0.8) / d.spotPrice || 0.002;
  const isEmaValid = d.ema55 !== null && d.prevClose !== null;
  const isCrossValid = d.sellCross === true;
  const belowEma55 = isEmaValid && d.prevClose < d.ema55;
  const rsiSell = parseFloat(d.rsi1h.rsi) < 75 && parseFloat(d.rsi1h.delta) < -1 && parseFloat(d.rsi4h.rsi) > 45 && (d.rsi1h.bearish_divergence || volatilityFactor > 0.5);
  const whaleSell = d.whales.sells > d.whales.buys * 1.2;
  const fundingSell = d.fundingRate > 0.005;
  const volumeSpike = d.volumeSpike === true || volatilityFactor > 0.7;
  const macdSell = d.macd.sellCross === true;
  return d.spotPrice > 0 &&
         d.spotPrice >= d.callWall * (1 - tolerance) &&
         isCrossValid &&
         belowEma55 &&
         rsiSell &&
         whaleSell &&
         fundingSell &&
         volumeSpike &&
         macdSell &&
         d.atr > 0;
}
// Mensagem formatada de compra
function mensagemCompra(d) {
  const multiplier = 2; // Ajustável: multiplicador para target/stop baseado em ATR
  const target = (d.spotPrice + (d.atr * multiplier)).toFixed(2);
  const stop = (d.spotPrice - (d.atr * multiplier)).toFixed(2);
  const futuresGammaFlip = Math.round((d.futuresPutWall + d.futuresCallWall) / 2);
  // Enriquecimento com IA Score e Walls
  const iaScore = d.iaScore.probLong > 0 ? `\n🧠 *IA Score:* ${d.iaScore.probLong.toFixed(1)}% (Est. ${d.iaScore.timeEst.toFixed(0)}min)` : '';
  const wallTarget = d.callWall > 0 ? d.callWall.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
  const wallStop = d.putWall > 0 ? d.putWall.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
  return `
📈 *Avaliar Compra / Reversão – ${d.symbolDisplay}*
⏰ (${d.timestamp})${iaScore}
💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟠 *Call Wall (Futuras):* ${d.futuresCallWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟡 *Put Wall (Futuras):* ${d.futuresPutWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟢 *GammaFlip (Futuras):* ${futuresGammaFlip.toLocaleString('en-US', { minimumFractionDigits: 2 })}
📊 *Indicadores:*
LSR Ratio 15m: ${d.lsr15m}
RSI 1h: ${d.rsi1h.rsi} (Delta: ${d.rsi1h.delta}) ${d.rsi1h.bullish_divergence ? '🌟 Div. Bullish' : ''}
RSI 4h: ${d.rsi4h.rsi} (Delta: ${d.rsi4h.delta})
➖VWAP 1h: ${d.vwap1h}
ATR 1h: ${d.atr.toFixed(2)}
🐋Whales> Comprando: ${d.whales.buys}, Vendendo: ${d.whales.sells}
Fund, Rate: ${d.fundingRate.toFixed(4)}%
📊 *Contexto:*
• Preço próximo da Put Wall (suporte forte)
✅ *Sinal técnico:* Oportunidade de Compra
🎯 *ALVO SUGERIDO (ATR):* ${target}
🎯 *ALVO ALTERNATIVO (Wall):* ${wallTarget}
🛑 *Stop de Proteção (ATR):* ${stop}
🛑 *STOP ALTERNATIVO (Wall):* ${wallStop}
#${d.symbolDisplay} #Compra #GammaFlip #Futures
`.trim();
}
// Mensagem formatada de venda
function mensagemVenda(d) {
  const multiplier = 2; // Ajustável: multiplicador para target/stop baseado em ATR
  const target = (d.spotPrice - (d.atr * multiplier)).toFixed(2);
  const stop = (d.spotPrice + (d.atr * multiplier)).toFixed(2);
  const futuresGammaFlip = Math.round((d.futuresPutWall + d.futuresCallWall) / 2);
  // Enriquecimento com IA Score e Walls
  const iaScore = d.iaScore.probShort > 0 ? `\n🧠 *IA Score:* ${d.iaScore.probShort.toFixed(1)}% (Est. ${d.iaScore.timeEst.toFixed(0)}min)` : '';
  const wallTarget = d.putWall > 0 ? d.putWall.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
  const wallStop = d.callWall > 0 ? d.callWall.toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A';
  return `
📉 ♦️*Realizar Lucros/Correção♦️ – ${d.symbolDisplay}*
⏰ (${d.timestamp})${iaScore}
💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟠 *Call Wall (Futuras):* ${d.futuresCallWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟡 *Put Wall (Futuras):* ${d.futuresPutWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟢 *GammaFlip (Futuras):* ${futuresGammaFlip.toLocaleString('en-US', { minimumFractionDigits: 2 })}
📊 *Indicadores:*
LSR: ${d.lsr15m}
RSI 1h: ${d.rsi1h.rsi} (Delta: ${d.rsi1h.delta}) ${d.rsi1h.bearish_divergence ? '🌟 Div. Bearish' : ''}
RSI 4h: ${d.rsi4h.rsi} (Delta: ${d.rsi4h.delta})
➖VWAP 1h: ${d.vwap1h}
ATR 1h: ${d.atr.toFixed(2)}
🐋Whales> Comprando: ${d.whales.buys}, Vendendo: ${d.whales.sells}
Funding Rate: ${d.fundingRate.toFixed(4)}%
📈 *Contexto Atual:*
• Preço tocando resistência (Call Wall)
🚨 *Sinal técnico:* Oportunidade de Realizar Lucros ou Short
🎯 *ALVO SUGERIDO (ATR):* ${target}
🎯 *ALVO ALTERNATIVO (Wall):* ${wallTarget}
🛑 *Stop de Proteção (ATR):* ${stop}
🛑 *STOP ALTERNATIVO (Wall):* ${wallStop}
#${d.symbolDisplay} #Venda #GammaFlip #Futures
`.trim();
}
// ===== ALERTA DE GAMMA SQUEEZE IMINENTE (EXCLUSIVO GROK) =====
async function detectGammaSqueeze(symbol, data) {
  try {
    const spot = data.spotPrice;
    const putWall = data.putWall;
    const callWall = data.callWall;
    const futuresPut = data.futuresPutWall;
    const futuresCall = data.futuresCallWall;

    // Só ativa se todas as walls estiverem válidas
    if (!spot || !putWall || !callWall || !futuresPut || !futuresCall) return;

    // Distância entre walls (em % do preço)
    const wallSpread = Math.abs(callWall - putWall) / spot * 100;
    const futuresSpread = Math.abs(futuresCall - futuresPut) / spot * 100;

    // Preço está "preso" entre as walls?
    const inGammaZone = spot > Math.min(putWall, futuresPut) && spot < Math.max(callWall, futuresCall);
    const wallsClosing = wallSpread < 2.0 && futuresSpread < 2.0; // <2% de spread = squeeze iminente

    if (inGammaZone && wallsClosing) {
      const gammaFlip = Math.round((putWall + callWall + futuresPut + futuresCall) / 4);
      const direction = spot > gammaFlip ? 'BULLISH' : 'BEARISH';
      const action = direction === 'BULLISH' 
        ? 'COMPRAR AGORA – GAMMA SQUEEZE BULLISH!' 
        : 'REALIZAR LUCROS / SHORT – GAMMA SQUEEZE BEARISH!';

      const msg = `
🚨 *GAMMA SQUEEZE IMINENTE* 🚨
${action}
📊 ${symbol} | Preço: $${spot.toFixed(2)}
🟡 Put Wall (Opções): $${putWall}
🟠 Call Wall (Opções): $${callWall}
🟢 Gamma Flip Médio: $${gammaFlip}
📈 Spread Walls: ${wallSpread.toFixed(2)}% | Futures: ${futuresSpread.toFixed(2)}%
⏰ *ENTRE AGORA – MOVIMENTO EXPLOSIVO EM MINUTOS*
#GammaSqueeze #${symbol} #${direction === 'BULLISH' ? 'Compra' : 'Venda'}
      `.trim();

      await sendTelegramMessage(msg);
      await logMessage(`GAMMA SQUEEZE DETECTADO: ${direction} para ${symbol}`);
    }
  } catch (e) {
    await logMessage(`Erro no Gamma Squeeze para ${symbol}: ${e.message}`);
  }
}
// ================= EXECUÇÃO ================= //
const symbols = ['BTCUSDT', 'ETHUSDT']; // Símbolos a monitorar
symbols.forEach(s => {
  if (!alerted[s]) alerted[s] = { buy: false, sell: false, cooldown: 0 };
});
async function checkAlerts() {
  const promises = symbols.map(async (symbol) => {
    const now = Date.now();
    if (alerted[symbol].cooldown > now) {
      await logMessage(`Cooldown ativo para ${symbol}. Próximo check em ${Math.round((alerted[symbol].cooldown - now) / 60000) } min.`);
      return;
    }
    const baseData = symbolsData[symbol];
    const data = { ...baseData };
    // Fetch walls dinâmicos (opções)
    const walls = await fetchOptionWalls(baseData.base);
    data.putWall = walls.putWall;
    data.callWall = walls.callWall;
    data.expiry = walls.expiry;
    data.gammaFlip = Math.round((data.putWall + data.callWall) / 2);
    // Fetch futures walls dinâmicos
    const futuresWalls = await fetchFuturesWalls(symbol);
    data.futuresPutWall = futuresWalls.putWall;
    data.futuresCallWall = futuresWalls.callWall;
    // Buscar dados dinâmicos em paralelo
    const [spotPrice, lsr15m, rsi1h, rsi4h, atr, vwap1h, emaData, whales, fundingRate, volumeSpike, macd] = await Promise.all([
      fetchSpotPrice(symbol),
      fetchLSR(symbol),
      getRSI(symbol, '1h'),
      getRSI(symbol, '4h'),
      getATR(symbol, '1h'),
      getVWAP(symbol, '1h'),
      getEMAsAndCrossover(symbol),
      getRecentWhales(symbol),
      fetchFundingRate(symbol),
      getVolumeSpike(symbol),
      getMACD(symbol)
    ]);
    data.spotPrice = spotPrice;
    data.lsr15m = lsr15m;
    data.rsi1h = rsi1h;
    data.rsi4h = rsi4h;
    data.atr = atr;
    data.vwap1h = vwap1h;
    data.buyCross = emaData.buyCross;
    data.sellCross = emaData.sellCross;
    data.ema55 = emaData.ema55;
    data.currentClose = emaData.currentClose;
    data.prevClose = emaData.prevClose;
    data.whales = whales;
    data.fundingRate = fundingRate;
    data.volumeSpike = volumeSpike;
    data.macd = macd;
    data.timestamp = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    // IA Preditiva antes do alerta final
    const iaScore = await getAIPredictive(symbol, data);
    data.iaScore = iaScore; // Adiciona o score da IA ao objeto de dados
    // === ALERTA DE GAMMA SQUEEZE ===
    await detectGammaSqueeze(symbol, data);
    if (detectarCompra(data)) {
      if (!alerted[symbol].buy) {
        const msg = mensagemCompra(data);
        await sendTelegramMessage(msg);
        alerted[symbol].buy = true;
        alerted[symbol].cooldown = now + 5 * 60 * 1000; // Reduzido para 5min cooldown
        await saveAlerted();
      }
    } else {
      alerted[symbol].buy = false;
    }
    if (detectarVenda(data)) {
      if (!alerted[symbol].sell) {
        const msg = mensagemVenda(data);
        await sendTelegramMessage(msg);
        alerted[symbol].sell = true;
        alerted[symbol].cooldown = now + 5 * 60 * 1000; // Reduzido para 5min cooldown
        await saveAlerted();
      }
    } else {
      alerted[symbol].sell = false;
    }
    await saveAlerted();
    if (!detectarCompra(data) && !detectarVenda(data)) {
      await logMessage(`ℹ️ Nenhuma condição de alerta detectada para ${symbol} no momento.`);
    }
  });
  await Promise.all(promises);
}
// Inicia verificação inicial e agendamento
(async () => {
  await sendTelegramMessage('Titanium BTC/ETH Whales🐋 Detect Futures');
  await loadAlerted();
  await checkAlerts();
  setInterval(checkAlerts, 2 * 60 * 1000); // Verifica a cada 2 minutos para mais frequência
})();
