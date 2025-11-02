require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { Bot } = require('grammy');
const ccxt = require('ccxt');
const fs = require('fs');

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
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('✅ Telegram Bot conectado!');
} else {
    console.log('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Arquivo de log
const logFile = 'app.log';

// Função para logar mensagens (console + arquivo)
function logMessage(message) {
    const timestamp = new Date().toLocaleString('pt-BR');
    const logEntry = `[${timestamp}] ${message}`;
    console.log(logEntry);
    fs.appendFileSync(logFile, logEntry + '\n', 'utf8');
}

// Limpeza automática de logs a cada 2 dias
setInterval(() => {
    fs.writeFileSync(logFile, '', 'utf8');
    logMessage('🧹 Logs limpos automaticamente.');
}, 2 * 24 * 60 * 60 * 1000); // 2 dias em milissegundos

// Armazena símbolos iniciais
let initialSymbols = new Set();

// Função para enviar mensagem no Telegram
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        logMessage(message);
        return;
    }
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        logMessage('📱 Alerta enviado!');
    } catch (error) {
        logMessage('❌ Erro Telegram: ' + error.message);
        logMessage(message);
    }
}

// Busca símbolos USDT ativos
async function fetchAllUsdtSymbols() {
    try {
        const exchangeInfo = await binance.futuresExchangeInfo();
        return exchangeInfo.symbols
            .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map(s => s.symbol)
            .sort();
    } catch (error) {
        logMessage('❌ Erro ao buscar símbolos: ' + error.message);
        return [];
    }
}

// Verifica novas listagens
async function checkListings() {
    const currentSymbols = await fetchAllUsdtSymbols();

    if (initialSymbols.size === 0) {
        currentSymbols.forEach(s => initialSymbols.add(s));
        logMessage(`📊 ${initialSymbols.size} pares USDT carregados inicialmente.`);
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
        logMessage(`🆕 ${newSymbols.length} nova(s) listagem(ens) detectada(s)!`);
    }

    // Atualiza conjunto inicial
    initialSymbols = new Set(currentSymbols);
}

// Inicia monitoramento de listagens
async function startMonitoring() {
    logMessage('🔍 Monitorando NOVAS LISTAGENS na Binance Futures...');
    await checkListings();
    setInterval(checkListings, 30000); // Verifica a cada 30 segundos
}

// Encerramento gracioso
process.on('SIGINT', () => {
    logMessage('\n👋 Monitor encerrado.');
    process.exit(0);
});

// Validações
if (!TELEGRAM_BOT_TOKEN) logMessage('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) logMessage('⚠️ TELEGRAM_CHAT_ID não encontrado');

startMonitoring();

// ================= CONFIGURAÇÕES ================= //
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

// Função para fetch LSR
async function fetchLSR(symbol) {
  try {
    const symbolWithoutSlash = symbol.includes('/') ? symbol.replace('/', '') : symbol;
    const res = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbolWithoutSlash, period: '15m', limit: 1 },
      timeout: 10000 // 10 segundos
    });
    if (!res.data || res.data.length < 1) {
      logMessage(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return 'Indisponível';
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio).toFixed(2);
    if (isNaN(currentLSR) || currentLSR < 0) {
      logMessage(`LSR inválido para ${symbol}`);
      return 'Indisponível';
    }
    logMessage(`LSR obtido para ${symbol}: ${currentLSR}`);
    return currentLSR;
  } catch (e) {
    logMessage(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return 'Indisponível';
  }
}

// Função para calcular RSI
async function getRSI(symbol, timeframe, period = 14) {
  try {
    const ohlcv = await binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, period + 1);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < period + 1) {
      logMessage(`⚠️ Dados insuficientes para RSI ${symbol} (${timeframe}): ${closes.length}/${period + 1} velas`);
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
    logMessage(`✅ RSI ${symbol} (${timeframe}): ${result}`);
    return result;
  } catch (error) {
    logMessage(`❌ Erro ao calcular RSI ${symbol} (${timeframe}): ${error.message}`);
    return 'Indisponível';
  }
}

// Função para calcular CCI
async function getCCI(symbol, timeframe, period = 20) {
  try {
    const ohlcv = await binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, period + 1);
    const tps = ohlcv.map(c => (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3).filter(v => !isNaN(v) && v > 0);
    if (tps.length < period) {
      logMessage(`⚠️ Dados insuficientes para CCI ${symbol} (${timeframe}): ${tps.length}/${period} velas`);
      return 'Indisponível';
    }

    const sma = tps.slice(-period).reduce((a, b) => a + b, 0) / period;
    const md = tps.slice(-period).reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
    const currentTp = tps[tps.length - 1];
    const cci = md === 0 ? 0 : (currentTp - sma) / (0.015 * md);

    const result = cci.toFixed(2);
    logMessage(`✅ CCI ${symbol} (${timeframe}): ${result}`);
    return result;
  } catch (error) {
    logMessage(`❌ Erro ao calcular CCI ${symbol} (${timeframe}): ${error.message}`);
    return 'Indisponível';
  }
}

// Função para fetch preço spot (mark price para futures)
async function fetchSpotPrice(symbol) {
  try {
    const ticker = await binanceCCXT.fetchTicker(symbol);
    const price = ticker.last;
    if (isNaN(price) || price <= 0) {
      logMessage(`Preço inválido para ${symbol}`);
      return 0;
    }
    logMessage(`Preço obtido para ${symbol}: ${price}`);
    return price;
  } catch (e) {
    logMessage(`Erro ao buscar preço para ${symbol}: ${e.message}`);
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

// Função para detectar cruzamento de EMAs
async function getEMACrossover(symbol, timeframe = '3m', shortPeriod = 13, longPeriod = 34) {
  try {
    const limit = longPeriod * 2 + 1; // Buffer suficiente para calcular EMAs e verificar cruzamento
    const ohlcv = await binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    if (closes.length < longPeriod + 1) {
      logMessage(`⚠️ Dados insuficientes para EMA crossover ${symbol} (${timeframe}): ${closes.length} velas`);
      return { buyCross: false, sellCross: false };
    }

    const emaShort = calculateEMA(closes, shortPeriod);
    const emaLong = calculateEMA(closes, longPeriod);

    if (emaShort.length < 2 || emaLong.length < 2) {
      return { buyCross: false, sellCross: false };
    }

    const prevShort = emaShort[emaShort.length - 2];
    const currShort = emaShort[emaShort.length - 1];
    const prevLong = emaLong[emaLong.length - 2];
    const currLong = emaLong[emaLong.length - 1];

    const buyCross = (prevShort <= prevLong) && (currShort > currLong);
    const sellCross = (prevShort >= prevLong) && (currShort < currLong);

    logMessage(`✅ EMA Crossover ${symbol} (${timeframe}): Buy=${buyCross}, Sell=${sellCross}`);
    return { buyCross, sellCross };
  } catch (error) {
    logMessage(`❌ Erro ao calcular EMA crossover ${symbol} (${timeframe}): ${error.message}`);
    return { buyCross: false, sellCross: false };
  }
}

// Função para obter EMA 55 e preço de fechamento no timeframe de 3m
async function getEMA55AndClose(symbol, timeframe = '3m', period = 55) {
  try {
    const limit = period + 2; // Garante EMA e pelo menos 2 velas
    const ohlcv = await binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, limit);
    const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
    
    if (closes.length < period + 1) {
      logMessage(`⚠️ Dados insuficientes para EMA 55 ${symbol} (${timeframe}): ${closes.length} velas`);
      return { ema55: null, currentClose: null };
    }

    const ema = calculateEMA(closes, period);
    const ema55 = ema[ema.length - 1];
    const currentClose = closes[closes.length - 1];

    logMessage(`✅ EMA 55 (${timeframe}): ${ema55.toFixed(2)}, Fechamento: ${currentClose.toFixed(2)}`);
    return { ema55, currentClose };
  } catch (error) {
    logMessage(`❌ Erro ao calcular EMA 55 ${symbol} (${timeframe}): ${error.message}`);
    return { ema55: null, currentClose: null };
  }
}

// Função para obter vencimento mais próximo
async function getNearestExpiry(baseSymbol) {
  try {
    const res = await axios.get('https://eapi.binance.com/eapi/v1/exchangeInfo');
    const expiries = res.data.optionSymbols
      .filter(s => s.underlying === baseSymbol && new Date(s.expiryDate) > new Date())
      .map(s => s.expiryDate)
      .sort((a, b) => a - b);
    return expiries[0] || null;
  } catch (e) {
    logMessage('❌ Erro ao buscar vencimento para ' + baseSymbol + ': ' + e.message);
    return null;
  }
}

// Função para obter Open Interest de opções
async function getOptionOI(baseSymbol, expiry) {
  try {
    const expiryStr = new Date(expiry).toISOString().slice(2,10).replace(/-/g, '');
    const res = await axios.get('https://eapi.binance.com/eapi/v1/openInterest', {
      params: { underlyingAsset: baseSymbol, expiration: expiryStr }
    });
    return res.data.data || [];
  } catch (e) {
    logMessage('❌ Erro ao buscar OI para ' + baseSymbol + ': ' + e.message);
    return [];
  }
}

// Função para fetch walls dinâmicos de opções
async function fetchOptionWalls(baseSymbol) {
  const expiry = await getNearestExpiry(baseSymbol);
  if (!expiry) return { putWall: null, callWall: null, expiry: 'Indisponível', expiryMs: null };

  const oiData = await getOptionOI(baseSymbol, expiry);
  if (oiData.length === 0) return { putWall: null, callWall: null, expiry: new Date(expiry).toLocaleDateString('pt-BR'), expiryMs: expiry };

  let maxPutOI = 0, maxCallOI = 0, putWall = null, callWall = null;
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

  logMessage(`Option Walls para ${baseSymbol}: Put ${putWall}, Call ${callWall}`);
  return { putWall, callWall, expiry: new Date(expiry).toLocaleDateString('pt-BR'), expiryMs: expiry };
}

// Função para fetch walls dinâmicos do livro de ordens (order book)
async function fetchOrderBookWalls(symbol) {
  try {
    const orderbook = await binanceCCXT.fetchOrderBook(symbol, 100); // Profundidade 100 níveis
    let maxBidQty = 0, buyWallPrice = 0;
    for (let bid of orderbook.bids) {
      if (bid[1] > maxBidQty) {
        maxBidQty = bid[1];
        buyWallPrice = bid[0];
      }
    }
    let maxAskQty = 0, sellWallPrice = 0;
    for (let ask of orderbook.asks) {
      if (ask[1] > maxAskQty) {
        maxAskQty = ask[1];
        sellWallPrice = ask[0];
      }
    }
    const buyWallValue = buyWallPrice * maxBidQty;
    const sellWallValue = sellWallPrice * maxAskQty;

    logMessage(`Order Book Walls para ${symbol}: Buy @ ${buyWallPrice} (Value: ${buyWallValue} USDT), Sell @ ${sellWallPrice} (Value: ${sellWallValue} USDT)`);
    return { buyWallPrice, buyWallValue, sellWallPrice, sellWallValue };
  } catch (e) {
    logMessage(`Erro ao buscar order book para ${symbol}: ${e.message}`);
    return { buyWallPrice: null, buyWallValue: null, sellWallPrice: null, sellWallValue: null };
  }
}

// Função para calcular Gamma Flip dinâmico
async function computeGammaFlip(baseSymbol, expiryMs, currentPrice) {
  if (!expiryMs) return null;

  const expiryDate = new Date(expiryMs);
  const now = new Date();
  const t = (expiryDate - now) / (365.25 * 24 * 60 * 60 * 1000);
  if (t <= 0) return null;

  const expiryStr = expiryDate.toISOString().slice(2,10).replace(/-/g, '');

  let oiData;
  try {
    const res = await axios.get('https://eapi.binance.com/eapi/v1/openInterest', {
      params: { underlyingAsset: baseSymbol, expiration: expiryStr }
    });
    oiData = res.data.data || [];
  } catch (e) {
    logMessage('❌ Erro ao buscar OI para gamma flip: ' + e.message);
    return null;
  }

  let marks;
  try {
    const res = await axios.get('https://eapi.binance.com/eapi/v1/mark');
    marks = res.data || [];
  } catch (e) {
    logMessage('❌ Erro ao buscar marks para gamma flip: ' + e.message);
    return null;
  }

  // Filtrar marks para este vencimento
  const expiryMarks = marks.filter(m => m.symbol.startsWith(baseSymbol + '-') && m.symbol.includes(`-${expiryStr}-`));

  const ivCall = {};
  const ivPut = {};
  expiryMarks.forEach(m => {
    const parts = m.symbol.split('-');
    const strike = parseFloat(parts[2]);
    if (m.symbol.endsWith('-C')) {
      ivCall[strike] = parseFloat(m.iv);
    } else if (m.symbol.endsWith('-P')) {
      ivPut[strike] = parseFloat(m.iv);
    }
  });

  // Função gamma BS
  function computeGamma(S, K, t, sigma) {
    if (sigma <= 0 || t <= 0) return 0;
    const d1 = Math.log(S / K) / (sigma * Math.sqrt(t)) + (sigma * Math.sqrt(t)) / 2;
    const n_d1 = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(- (d1 * d1) / 2);
    return n_d1 / (S * sigma * Math.sqrt(t));
  }

  // Função total dealer gamma
  function totalDealerGamma(S) {
    let sumGamma = 0;
    oiData.forEach(item => {
      const strike = parseFloat(item.strikePrice);
      const oi = parseFloat(item.sumOpenInterest);
      if (oi > 0) {
        const side = item.side;
        const iv = side === 'CALL' ? ivCall[strike] : ivPut[strike];
        if (iv && iv > 0) {
          const g = computeGamma(S, strike, t, iv);
          sumGamma += oi * g;
        }
      }
    });
    return -sumGamma;
  }

  // Binary search para encontrar onde gamma = 0
  let low = currentPrice * 0.5;
  let high = currentPrice * 1.5;
  const epsilon = 0.01;
  let mid;
  for (let i = 0; i < 100; i++) {
    mid = (low + high) / 2;
    const g_mid = totalDealerGamma(mid);
    if (Math.abs(g_mid) < epsilon) {
      logMessage(`Gamma Flip calculado para ${baseSymbol}: ${mid}`);
      return mid;
    }
    if (g_mid > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }
  logMessage(`Gamma Flip aproximado para ${baseSymbol}: ${mid}`);
  return mid;
}

// Dados base por símbolo
const symbolsData = {
  'BTCUSDT': { base: 'BTC', symbolDisplay: 'BTCUSDT.P' },
  'ETHUSDT': { base: 'ETH', symbolDisplay: 'ETHUSDT.P' }
};

// ================= FUNÇÕES ================= //

// Função para detectar melhor compra
function detectarCompra(d) {
  const cci15m = parseFloat(d.cci['15m']);
  const aboveEma55 = d.ema55Data?.currentClose > d.ema55Data?.ema55;
  const nearBuyWall = d.orderBookWalls.buyWallPrice !== null && d.spotPrice <= d.orderBookWalls.buyWallPrice * 1.002;
  return d.spotPrice > 0 && d.putWall !== null && d.spotPrice <= d.putWall * 1.002 && !isNaN(cci15m) && cci15m > 0 && d.emaCross.buyCross && aboveEma55 && d.gammaFlip !== null && nearBuyWall;
}

// Função para detectar melhor venda
function detectarVenda(d) {
  const cci15m = parseFloat(d.cci['15m']);
  const belowEma55 = d.ema55Data?.currentClose < d.ema55Data?.ema55;
  const nearSellWall = d.orderBookWalls.sellWallPrice !== null && d.spotPrice >= d.orderBookWalls.sellWallPrice * 0.998;
  return d.spotPrice > 0 && d.callWall !== null && d.spotPrice >= d.callWall * 0.998 && !isNaN(cci15m) && cci15m < 0 && d.emaCross.sellCross && belowEma55 && d.gammaFlip !== null && nearSellWall;
}

// Mensagem formatada de compra
function mensagemCompra(d) {
  return `
📈 *ALERTA DE MELHOR COMPRA – ${d.symbolDisplay}*
⏰ (${d.timestamp})

💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟡 *Região de Suporte:* Put Wall em ${d.putWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}, Order Book Buy Wall em ${d.orderBookWalls.buyWallPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Valor: ${d.orderBookWalls.buyWallValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT)
🟢 *GammaFlip:* ${d.gammaFlip.toLocaleString('en-US', { minimumFractionDigits: 2 })}
📆 *Vencimento:* ${d.expiry}

📉 *Indicadores CCI:*
15m: ${d.cci['15m']} ➡️ 🟢 Força Compradora
1h: ${d.cci['1h']} ➡️ ⚪ Neutro
4h: ${d.cci['4h']} ➡️ 🟣 Queda desacelerando
1d: ${d.cci['1d']} ➡️ ⚪ Possível reversão

📊 *Outros Indicadores:*
LSR Ratio 15m: ${d.lsr15m}
RSI 1h: ${d.rsi1h}
RSI 4h: ${d.rsi4h}

📊 *Contexto:*
• Preço próximo da Put Wall e Buy Wall no livro de ordens (suporte forte)
• CCI 15m virando positivo
• Abaixo do GammaFlip → alta volatilidade

✅ *Sinal técnico:* Oportunidade de Compra ou Reversão   
🎯 *Possível alvo:* ${d.gammaFlip.toLocaleString('en-US', { minimumFractionDigits: 2 })}

#${d.symbolDisplay} #Compra #GammaFlip #Futures
`;
}

// Mensagem formatada de venda
function mensagemVenda(d) {
  return `
📉 *ALERTA DE MELHOR VENDA – ${d.symbolDisplay}*
⏰ (${d.timestamp})

💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟠 *Região de Resistência:* Call Wall em ${d.callWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}, Order Book Sell Wall em ${d.orderBookWalls.sellWallPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Valor: ${d.orderBookWalls.sellWallValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT)
🟢 *GammaFlip:* ${d.gammaFlip.toLocaleString('en-US', { minimumFractionDigits: 2 })}
📆 *Vencimento:* ${d.expiry}

📊 *Indicadores CCI:*
15m: ${d.cci['15m']} ➡️ 🔴 Pressão Vendedora
1h: ${d.cci['1h']} ➡️ 🟣 Queda
4h: ${d.cci['4h']} ➡️ 🟣 Continuação de baixa
1d: ${d.cci['1d']} ➡️ ⚪ Neutro

📊 *Outros Indicadores:*
LSR Ratio 15m: ${d.lsr15m}
RSI 1h: ${d.rsi1h}
RSI 4h: ${d.rsi4h}

📈 *Contexto:*
• Preço tocando resistência (Call Wall e Sell Wall no livro de ordens)
• CCI 15m negativo → momentum vendedor
• Acima do GammaFlip → tendência de baixa

🚨 *Sinal técnico:* Oportunidade de Venda ou Reversão  
🎯 *Possível alvo:* ${d.putWall.toLocaleString('en-US', { minimumFractionDigits: 2 })}

#${d.symbolDisplay} #Venda #GammaFlip #Futures
`;
}

// Envia alerta ao Telegram
async function enviarAlerta(mensagem) {
  try {
    await bot.api.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
    logMessage('✅ Alerta enviado com sucesso!');
  } catch (err) {
    logMessage('❌ Erro ao enviar alerta: ' + err.message);
  }
}

// ================= EXECUÇÃO ================= //
const symbols = ['BTCUSDT', 'ETHUSDT']; // Símbolos a monitorar
let alerted = {}; // Flags por símbolo: { 'BTCUSDT': { buy: false, sell: false }, ... }
symbols.forEach(s => alerted[s] = { buy: false, sell: false });

async function checkAlerts() {
  for (const symbol of symbols) {
    const baseData = symbolsData[symbol];
    const data = { ...baseData };

    // Fetch walls dinâmicos de opções
    const optionWalls = await fetchOptionWalls(baseData.base);
    data.putWall = optionWalls.putWall;
    data.callWall = optionWalls.callWall;
    data.expiry = optionWalls.expiry;
    data.expiryMs = optionWalls.expiryMs;

    // Buscar preço spot
    data.spotPrice = await fetchSpotPrice(symbol);

    // Calcular Gamma Flip dinâmico
    data.gammaFlip = await computeGammaFlip(baseData.base, data.expiryMs, data.spotPrice);

    // Fetch walls do livro de ordens
    data.orderBookWalls = await fetchOrderBookWalls(symbol);

    // Buscar dados dinâmicos
    data.cci = {
      '15m': await getCCI(symbol, '15m'),
      '1h': await getCCI(symbol, '1h'),
      '4h': await getCCI(symbol, '4h'),
      '1d': await getCCI(symbol, '1d')
    };
    data.lsr15m = await fetchLSR(symbol);
    data.rsi1h = await getRSI(symbol, '1h');
    data.rsi4h = await getRSI(symbol, '4h');
    data.emaCross = await getEMACrossover(symbol);
    data.ema55Data = await getEMA55AndClose(symbol);
    data.timestamp = new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    if (detectarCompra(data)) {
      if (!alerted[symbol].buy) {
        const msg = mensagemCompra(data);
        await enviarAlerta(msg);
        alerted[symbol].buy = true;
      }
    } else {
      alerted[symbol].buy = false;
    }

    if (detectarVenda(data)) {
      if (!alerted[symbol].sell) {
        const msg = mensagemVenda(data);
        await enviarAlerta(msg);
        alerted[symbol].sell = true;
      }
    } else {
      alerted[symbol].sell = false;
    }

    if (!detectarCompra(data) && !detectarVenda(data)) {
      logMessage(`ℹ️ Nenhuma condição de alerta detectada para ${symbol} no momento.`);
    }
  }
}

// Inicia verificação inicial e agendamento
checkAlerts();
setInterval(checkAlerts, 5 * 60 * 1000); // Verifica a cada 5 minutos para maior dinamismo
