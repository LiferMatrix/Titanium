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
const symbolsFile = 'initialSymbols.json';
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
// Função de retry com backoff
async function retryAsync(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, delay * (i + 1)));
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
// Armazena símbolos iniciais (persistente)
let initialSymbols = new Set();
async function loadInitialSymbols() {
    try {
        const data = await fs.readFile(symbolsFile, 'utf8');
        initialSymbols = new Set(JSON.parse(data));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('❌ Erro ao carregar symbols: ' + error.message);
    }
}
async function saveInitialSymbols() {
    try {
        await fs.writeFile(symbolsFile, JSON.stringify(Array.from(initialSymbols)), 'utf8');
    } catch (error) {
        console.error('❌ Erro ao salvar symbols: ' + error.message);
    }
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
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        await logMessage(message);
        return;
    }
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        await logMessage('📱 Alerta enviado!');
    } catch (error) {
        await logMessage('❌ Erro Telegram: ' + error.message);
        await logMessage(message);
    }
}
// Busca símbolos USDT ativos
async function fetchAllUsdtSymbols() {
    try {
        const exchangeInfo = await retryAsync(() => binance.futuresExchangeInfo());
        return exchangeInfo.symbols
            .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map(s => s.symbol)
            .sort();
    } catch (error) {
        await logMessage('❌ Erro ao buscar símbolos: ' + error.message);
        return [];
    }
}
// Verifica novas listagens
async function checkListings() {
    const currentSymbols = await fetchAllUsdtSymbols();
    if (initialSymbols.size === 0) {
        currentSymbols.forEach(s => initialSymbols.add(s));
        await saveInitialSymbols();
        await logMessage(`📊 ${initialSymbols.size} pares USDT carregados inicialmente.`);
        return;
    }
    const newSymbols = currentSymbols.filter(s => !initialSymbols.has(s));
    if (newSymbols.length > 0) {
        for (const symbol of newSymbols) {
            const now = new Date().toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const message = `⚠️ *NOVA LISTAGEM NA BINANCE FUTURES!*\n\n\`${symbol}\`\n\n⏰ *${now}*`;
            await sendTelegramMessage(message);
        }
        await logMessage(`🆕 ${newSymbols.length} nova(s) listagem(ens) detectada(s)!`);
    }
    // Atualiza conjunto inicial
    initialSymbols = new Set(currentSymbols);
    await saveInitialSymbols();
}
// Inicia monitoramento de listagens
async function startMonitoring() {
    await loadInitialSymbols();
    await logMessage('🔍 Monitorando NOVAS LISTAGENS na Binance Futures...');
    await checkListings();
    setInterval(checkListings, 30000); // Verifica a cada 30 segundos
}
// Encerramento gracioso
process.on('SIGINT', async () => {
    await saveInitialSymbols();
    await saveAlerted();
    await logMessage('\n👋 Monitor encerrado.');
    process.exit(0);
});
// Validações
if (!TELEGRAM_BOT_TOKEN) logMessage('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) logMessage('⚠️ TELEGRAM_CHAT_ID não encontrado');
// ================= CONFIGURAÇÕES ================= //
// Função para fetch LSR
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
    const currentLSR = parseFloat(res.data[0].longShortRatio).toFixed(2);
    if (isNaN(currentLSR) || currentLSR < 0) {
      await logMessage(`LSR inválido para ${symbol}`);
      return 'Indisponível';
    }
    await logMessage(`LSR obtido para ${symbol}: ${currentLSR}`);
    return currentLSR;
  } catch (e) {
    await logMessage(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return 'Indisponível';
  }
}
// Função para calcular RSI
async function getRSI(symbol, timeframe, period = 14) {
  try {
    const limit = period + 1;
    const ohlcv = await fetchOHLCVWithCache(symbol, timeframe, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < period + 1) {
      await logMessage(`⚠️ Dados insuficientes para RSI ${symbol} (${timeframe}): ${closes.length}/${period + 1} velas`);
      return 'Indisponível';
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
    const result = rsi.toFixed(2);
    await logMessage(`✅ RSI ${symbol} (${timeframe}): ${result}`);
    return result;
  } catch (error) {
    await logMessage(`❌ Erro ao calcular RSI ${symbol} (${timeframe}): ${error.message}`);
    return 'Indisponível';
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
// Função para obter vencimento mais próximo
async function getNearestExpiry(baseSymbol) {
  try {
    const res = await retryAsync(() => axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo'));
    const expiries = res.data.optionSymbols
      .filter(s => s.underlying === baseSymbol && new Date(s.expiryDate) > new Date())
      .map(s => s.expiryDate)
      .sort();
    return expiries[0] || null;
  } catch (e) {
    await logMessage('❌ Erro ao buscar vencimento para ' + baseSymbol + ': ' + e.message);
    return null;
  }
}
// Função para obter Open Interest de opções
async function getOptionOI(baseSymbol, expiry) {
  try {
    const res = await retryAsync(() => axios.get('https://eapi.binance.com/eapi/v1/openInterest', {
      params: { underlyingAsset: baseSymbol, expiration: expiry.toString().slice(2,8) } // Formato YYMMDD
    }));
    return res.data.data || [];
  } catch (e) {
    await logMessage('❌ Erro ao buscar OI para ' + baseSymbol + ': ' + e.message);
    return [];
  }
}
// Função para fetch walls dinâmicos
async function fetchOptionWalls(baseSymbol) {
  const expiry = await getNearestExpiry(baseSymbol);
  if (!expiry) return { putWall: 108000, callWall: 108000, expiry: 'Indisponível' };
  const oiData = await getOptionOI(baseSymbol, expiry);
  if (oiData.length === 0) return { putWall: 108000, callWall: 108000, expiry: new Date(expiry).toLocaleDateString('pt-BR') };
  let maxPutOI = 0, maxCallOI = 0, putWall = 108000, callWall = 108000;
  oiData.forEach(item => {
    const strike = parseFloat(item.strikePrice);
    const oi = parseFloat(item.openInterest);
    if (item.side === 'PUT' && oi > maxPutOI) {
      maxPutOI = oi;
      putWall = strike;
    } else if (item.side === 'CALL' && oi > maxCallOI) {
      maxCallOI = oi;
      callWall = strike;
    }
  });
  await logMessage(`Walls para ${baseSymbol}: Put ${putWall}, Call ${callWall}`);
  return { putWall, callWall, expiry: new Date(expiry).toLocaleDateString('pt-BR') };
}
// Dados base por símbolo
const symbolsData = {
  'BTCUSDT': { base: 'BTC', symbolDisplay: 'BTCUSDT.P', gammaFlip: 111500 },
  'ETHUSDT': { base: 'ETH', symbolDisplay: 'ETHUSDT.P', gammaFlip: 4500 }
};
// ================= FUNÇÕES ================= //
// Função para detectar melhor compra
function detectarCompra(d) {
  const isEmaValid = d.ema55 !== null && d.prevClose !== null;
  const isCrossValid = d.buyCross === true;
  const aboveEma55 = isEmaValid && d.prevClose > d.ema55;
  return d.spotPrice > 0 &&
         d.spotPrice <= d.putWall * 1.002 &&
         isCrossValid &&
         aboveEma55 &&
         d.atr > 0; // Garante ATR válido
}
// Função para detectar melhor venda
function detectarVenda(d) {
  const isEmaValid = d.ema55 !== null && d.prevClose !== null;
  const isCrossValid = d.sellCross === true;
  const belowEma55 = isEmaValid && d.prevClose < d.ema55;
  return d.spotPrice > 0 &&
         d.spotPrice >= d.callWall * 0.998 &&
         isCrossValid &&
         belowEma55 &&
         d.atr > 0; // Garante ATR válido
}
// Mensagem formatada de compra
function mensagemCompra(d) {
  const multiplier = 2; // Ajustável: multiplicador para target/stop baseado em ATR
  const target = (d.spotPrice + (d.atr * multiplier)).toFixed(2);
  const stop = (d.spotPrice - (d.atr * multiplier)).toFixed(2);
  return `
📈 *ALERTA DE MELHOR COMPRA – ${d.symbolDisplay}*
⏰ (${d.timestamp})
💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟡 *Região de Suporte:* Put Wall em ${d.putWall}
🟢 *GammaFlip:* ${d.gammaFlip}
📆 *Vencimento:* ${d.expiry}
📊 *Outros Indicadores:*
LSR Ratio 15m: ${d.lsr15m}
RSI 1h: ${d.rsi1h}
RSI 4h: ${d.rsi4h}
ATR 1h: ${d.atr.toFixed(2)}
📊 *Contexto:*
• Preço próximo da Put Wall (suporte forte)
• Acima da EMA 55 (tendência de alta de curto prazo)
• Cruzamento de EMAs (13/34) para compra
✅ *Sinal técnico:* Oportunidade de Compra
🎯 *Alvo sugerido:* ${target}
🛑 *Stop Loss sugerido:* ${stop}
#${d.symbolDisplay} #Compra #GammaFlip #Futures
`;
}
// Mensagem formatada de venda
function mensagemVenda(d) {
  const multiplier = 2; // Ajustável: multiplicador para target/stop baseado em ATR
  const target = (d.spotPrice - (d.atr * multiplier)).toFixed(2);
  const stop = (d.spotPrice + (d.atr * multiplier)).toFixed(2);
  return `
📉 *ALERTA DE MELHOR VENDA – ${d.symbolDisplay}*
⏰ (${d.timestamp})
💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟠 *Região de Resistência:* Call Wall em ${d.callWall}
🟢 *GammaFlip:* ${d.gammaFlip}
📆 *Vencimento:* ${d.expiry}
📊 *Outros Indicadores:*
LSR Ratio 15m: ${d.lsr15m}
RSI 1h: ${d.rsi1h}
RSI 4h: ${d.rsi4h}
ATR 1h: ${d.atr.toFixed(2)}
📈 *Contexto:*
• Preço tocando resistência (Call Wall)
• Abaixo da EMA 55 (tendência de baixa de curto prazo)
• Cruzamento de EMAs (13/34) para venda
🚨 *Sinal técnico:* Oportunidade de Realizar Lucros
🎯 *Alvo sugerido:* ${target}
🛑 *Stop Loss sugerido:* ${stop}
#${d.symbolDisplay} #Venda #GammaFlip #Futures
`;
}
// ================= EXECUÇÃO ================= //
const symbols = ['BTCUSDT', 'ETHUSDT']; // Símbolos a monitorar
symbols.forEach(s => {
  if (!alerted[s]) alerted[s] = { buy: false, sell: false };
});
async function checkAlerts() {
  const promises = symbols.map(async (symbol) => {
    const baseData = symbolsData[symbol];
    const data = { ...baseData };
    // Fetch walls dinâmicos
    const walls = await fetchOptionWalls(baseData.base);
    data.putWall = walls.putWall;
    data.callWall = walls.callWall;
    data.expiry = walls.expiry;
    // Buscar dados dinâmicos em paralelo
    const [spotPrice, lsr15m, rsi1h, rsi4h, atr, emaData] = await Promise.all([
      fetchSpotPrice(symbol),
      fetchLSR(symbol),
      getRSI(symbol, '1h'),
      getRSI(symbol, '4h'),
      getATR(symbol, '1h'),
      getEMAsAndCrossover(symbol)
    ]);
    data.spotPrice = spotPrice;
    data.lsr15m = lsr15m;
    data.rsi1h = rsi1h;
    data.rsi4h = rsi4h;
    data.atr = atr;
    data.buyCross = emaData.buyCross;
    data.sellCross = emaData.sellCross;
    data.ema55 = emaData.ema55;
    data.currentClose = emaData.currentClose;
    data.prevClose = emaData.prevClose;
    data.timestamp = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    if (detectarCompra(data)) {
      if (!alerted[symbol].buy) {
        const msg = mensagemCompra(data);
        await sendTelegramMessage(msg);
        alerted[symbol].buy = true;
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
  await loadAlerted();
  await checkAlerts();
  setInterval(checkAlerts, 5 * 60 * 1000); // Verifica a cada 5 minutos
  await startMonitoring(); // Opcional, descomente se quiser monitoramento de listagens
})();
