require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('⚠️ Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const logFile = 'bot.log';

async function logMessage(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  try {
    await fs.appendFile(logFile, logEntry + '\n', 'utf8');
  } catch (error) {
    console.error('Erro ao salvar log:', error.message);
  }
}

// ==================== RECONEXÃO AUTOMÁTICA ====================
async function safeRequest(fn, retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      await logMessage(`Tentativa ${i + 1} falhou: ${err.message}`);
      if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
      delay *= 1.5;
    }
  }
  return null;
}

// ==================== FUNÇÕES DE DADOS ====================
async function getPrice(symbol) {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/ticker/price', {
    params: { symbol }, timeout: 8000
  }));
  return res?.data?.price ? parseFloat(res.data.price) : null;
}

async function getLSR(symbol) {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
    params: { symbol, period: '5m', limit: 2 }, timeout: 8000
  }));
  if (!res?.data || res.data.length < 2) return { current: 'N/A', change: 'N/A', direction: '' };
  const [prev, curr] = res.data;
  const current = parseFloat(curr.longShortRatio).toFixed(4);
  const change = (parseFloat(curr.longShortRatio) - parseFloat(prev.longShortRatio)).toFixed(4);
  const direction = change > 0 ? 'Subiu' : change < 0 ? 'Caiu' : 'Estável';
  return { current, change: change >= 0 ? `+${change}` : change, direction };
}

async function getOpenInterest(symbol) {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
    params: { symbol }, timeout: 8000
  }));
  if (!res?.data?.openInterest) return { current: 'N/A', change: 'N/A', direction: '' };

  // Busca histórico de 1h atrás (aproximado)
  const hist = await safeRequest(() => axios.get('https://fapi.binance.com/futures/data/openInterestHist', {
    params: { symbol, period: '1h', limit: 2 }, timeout: 8000
  }));

  let change = 'N/A', direction = '';
  if (hist?.data && hist.data.length >= 2) {
    const prev = parseFloat(hist.data[0].sumOpenInterest);
    const curr = parseFloat(hist.data[1].sumOpenInterest);
    const diff = curr - prev;
    change = diff >= 0 ? `+${(diff / 1e6).toFixed(1)}M` : `${(diff / 1e6).toFixed(1)}M`;
    direction = diff >= 0 ? 'Subiu' : 'Caiu';
  }

  const currentFormatted = (parseFloat(res.data.openInterest) / 1e9).toFixed(2) + 'B';
  return { current: currentFormatted, change, direction };
}

async function getOrderBookImbalance(symbol) {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/depth', {
    params: { symbol, limit: 100 }, timeout: 8000
  }));
  if (!res?.data?.bids || !res.data.asks) return { bids: 'N/A', asks: 'N/A' };

  const price = await getPrice(symbol);
  if (!price) return { bids: 'N/A', asks: 'N/A' };

  const range = price * 0.005; // ±0.5%

  let bidVol = 0, askVol = 0;
  for (const [p, q] of res.data.bids) {
    if (parseFloat(p) >= price - range && parseFloat(p) <= price + range) bidVol += parseFloat(q);
  }
  for (const [p, q] of res.data.asks) {
    if (parseFloat(p) >= price - range && parseFloat(p) <= price + range) askVol += parseFloat(q);
  }

  return {
    bids: bidVol.toFixed(2) + ' ' + symbol.replace('USDT', ''),
    asks: askVol.toFixed(2) + ' ' + symbol.replace('USDT', '')
  };
}

// ==================== COMANDO /info (CORRIGIDO E SUPER ROBUSTO) ====================
bot.on('message', async (msg) => {
  const text = msg.text?.trim();
  if (!text) return;

  // Aceita: /info ethusdt, /Info BTCUSDT, /INFO solusdt, com ou sem espaços extras
  const match = text.match(/^\/info\s+([A-Za-z0-9]+USDT)$/i);
  if (!match) return;

  const chatId = msg.chat.id;
  const symbol = match[1].toUpperCase();  // sempre deixa em maiúsculo

  // Evita spam do próprio bot
  if (msg.from.is_bot) return;

  // Feedback imediato
  bot.sendChatAction(chatId, 'typing');

  await logMessage(`Comando /info recebido: ${symbol} (de ${msg.from.first_name || 'Usuário'})`);

  // Validação rápida se o par existe na Binance Futures
  const allSymbols = await getUsdtSymbols();
  if (!allSymbols.includes(symbol)) {
    return bot.sendMessage(chatId, `❌ Par *${symbol}* não encontrado ou não está ativo na Binance Futures.`, { parse_mode: 'Markdown' });
  }

  const [price, lsr, oi, ob] = await Promise.all([
    getPrice(symbol),
    getLSR(symbol),
    getOpenInterest(symbol),
    getOrderBookImbalance(symbol)
  ]);

  if (!price) {
    return bot.sendMessage(chatId, `⚠️ Não consegui pegar o preço de *${symbol}* no momento. Tente novamente em alguns segundos.`, { parse_mode: 'Markdown' });
  }

  const message = `
*Info Rápida: ${symbol}*
Preço Atual: $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

*Ratio Long/Short (LSR):*
  - Atual: ${lsr.current}
  - Variação (~1h): ${lsr.change} (${lsr.direction})

*Open Interest (OI):*
  - Atual: $${oi.current}
  - Variação (~1h): ${oi.change} (${oi.direction})

*Order Blocks (±0.5%):*
  - Compras (Bids): ${ob.bids}
  - Vendas (Asks): ${ob.asks}
  `.trim();

  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// ==================== MONITORAMENTO DE NOVAS LISTAGENS ====================
const symbolsFile = 'initialSymbols.json';
let initialSymbols = new Set();
let isFirstRun = true;

async function loadInitialSymbols() {
  try {
    const data = await fs.readFile(symbolsFile, 'utf8');
    initialSymbols = new Set(JSON.parse(data));
    isFirstRun = false;
    await logMessage(`Carregados ${initialSymbols.size} pares do histórico.`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      isFirstRun = true;
      await logMessage('Primeira execução: arquivo initialSymbols.json não existe.');
    }
  }
}

async function saveInitialSymbols(symbols) {
  await fs.writeFile(symbolsFile, JSON.stringify(Array.from(symbols)), 'utf8');
}

async function getUsdtSymbols() {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo'));
  return res?.data?.symbols
    .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map(s => s.symbol) || [];
}

async function checkNewListings() {
  const current = await getUsdtSymbols();
  if (isFirstRun) {
    initialSymbols = new Set(current);
    await saveInitialSymbols(initialSymbols);
    isFirstRun = false;
    await logMessage(`Primeira varredura: ${current.length} pares salvos.`);
    return;
  }

  const newOnes = current.filter(s => !initialSymbols.has(s));
  if (newOnes.length > 0) {
    for (const sym of newOnes) {
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const text = `*NOVA LISTAGEM NA BINANCE FUTURES!*\n\n\`${sym}\`\n\n⏰ ${now}`;
      await bot.sendMessage(TELEGRAM_CHAT_ID, text, { parse_mode: 'Markdown' });
    }
    await logMessage(`NOVAS LISTAGENS: ${newOnes.join(', ')}`);
  }

  initialSymbols = new Set(current);
  await saveInitialSymbols(initialSymbols);
}

// ==================== INICIO ====================
(async () => {
  await loadInitialSymbols();
  await logMessage('Bot iniciado! Use /info ETHUSDT para análise rápida.');
  await checkNewListings();
  setInterval(checkNewListings, 30_000); // a cada 30 segundos
})();
