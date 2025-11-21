require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

// ===================== CONFIGURAÇÕES =====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const logFile = 'bot.log';

// ===================== LOG =====================
async function logMessage(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  try {
    await fs.appendFile(logFile, logEntry + '\n', 'utf8');
  } catch (error) { /* silencioso */ }
}

// Limpeza de log a cada 2 dias
setInterval(async () => {
  try {
    await fs.writeFile(logFile, '', 'utf8');
    await logMessage('Logs limpos automaticamente.');
  } catch (e) {}
}, 2 * 24 * 60 * 60 * 1000);

// ===================== RECONEXÃO SEGURA =====================
async function safeRequest(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      await new Promise(r => setTimeout(r, 5000 * (i + 1)));
    }
  }
  return null;
}

// ===================== ANÁLISE BTC - VERSÃO FILÉ =====================
async function enviarAnaliseBTC() {
  try {
    const [priceRes, klinesRes, depthRes, oiRes] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),        // Preço SPOT
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100'),
      axios.get('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=1000'),     // Orderbook SPOT REAL
      axios.get('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=13')
    ]);

    const price = parseFloat(priceRes.data.price);
    const closes = klinesRes.data.map(k => parseFloat(k[4]));

    // EMA simples
    const ema = (arr, p) => {
      const k = 2 / (p + 1);
      let val = arr[0];
      for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
      return val;
    };

    const ema13 = ema(closes, 13);
    const ema34 = ema(closes, 34);
    const ema55 = ema(closes, 55);
    const tendencia = ema13 > ema34 ? 'Alta' : 'Baixa';
    const pos55 = price > ema55 ? 'acima' : 'abaixo';

    // Open Interest
    const oiAtual = parseFloat(oiRes.data.at(-1).sumOpenInterestValue) / 1e9;
    const oiVar = (parseFloat(oiRes.data.at(-1).sumOpenInterestValue) - parseFloat(oiRes.data[0].sumOpenInterestValue)) / 1e6;
    const dirOI = oiVar > 0 ? 'Subiu' : oiVar < 0 ? 'Caiu' : 'Estável';

    // ORDERBOOK SPOT - ±1% do preço atual (melhor visualização no spot)
    const bidsRaw = depthRes.data.bids.filter(b => parseFloat(b[0]) >= price * 0.99);
    const asksRaw = depthRes.data.asks.filter(a => parseFloat(a[0]) <= price * 1.01);

    const bidsBTC = bidsRaw.reduce((s, b) => s + parseFloat(b[1]), 0);
    const asksBTC = asksRaw.reduce((s, a) => s + parseFloat(a[1]), 0);

    const bidsUSDT = bidsRaw.reduce((s, b) => s + parseFloat(b[0]) * parseFloat(b[1]), 0);
    const asksUSDT = asksRaw.reduce((s, a) => s + parseFloat(a[0]) * parseFloat(a[1]), 0);

    const deltaBTC = bidsBTC - asksBTC;
    const deltaPercent = ((bidsBTC - asksBTC) / (bidsBTC + asksBTC)) * 100;

    // Indicador visual de pressão
    let pressao = '';
    if (deltaPercent > 15) pressao = 'Order Block COMPRA FORTE';
    else if (deltaPercent > 5) pressao = 'Pressão compradora';
    else if (deltaPercent < -15) pressao = 'Order Block VENDA FORTE';
    else if (deltaPercent < -5) pressao = 'Pressão vendedora';
    else pressao = 'Equilibrado';

    const emojiPressao = deltaPercent > 0 ? '+Compras' : '+Vendas';

    // Mensagem final - épica
    const msg = `
*#BTCUSDT - 🤖#IA Titanium * (${new Date().toLocaleString('pt-BR')})

*Preço Atual:* $${price.toLocaleString('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1})}

*Tendência 1h:* ${tendencia} (EMA13 > EMA34)  
└ ${pos55} da EMA55

*Open Interest:* $${oiAtual.toFixed(2)}B  
└ ${dirOI} ${Math.abs(oiVar).toFixed(0)}M nas últimas 1h

*Orderbook SPOT Real (±1%)*  
├ Compras (Bids): *${bidsBTC.toFixed(1)} BTC* ≈ $${(bidsUSDT/1e6).toFixed(1)}M  
├ Vendas (Asks): *${asksBTC.toFixed(1)} BTC* ≈ $${(asksUSDT/1e6).toFixed(1)}M  
└ *Delta:* ${deltaBTC > 0 ? '+' : ''}${deltaBTC.toFixed(1)} BTC (${deltaPercent.toFixed(1)}%)

${emojiPressao} *Força no livro:* ${pressao}

                         By @J4Rviz — Titanium 
    `.trim();

    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    await logMessage('Análise BTC enviada com orderbook SPOT real + delta');
  } catch (err) {
    await logMessage('Erro na análise BTC: ' + err.message);
  }
}

// ===================== MONITORAMENTO DE LISTAGENS (mantido) =====================
// ... (o resto do código de listagens continua exatamente igual ao seu original)

const symbolsFile = 'initialSymbols.json';
let initialSymbols = new Set();
let isFirstRun = true;

async function loadInitialSymbols() {
  try {
    const data = await fs.readFile(symbolsFile, 'utf8');
    initialSymbols = new Set(JSON.parse(data));
    isFirstRun = false;
    await logMessage(`Carregados ${initialSymbols.size} símbolos do histórico.`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(err);
    isFirstRun = true;
  }
}

async function saveInitialSymbols(symbols) {
  await fs.writeFile(symbolsFile, JSON.stringify(Array.from(symbols)), 'utf8');
}

async function getUsdtSymbols() {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo'));
  if (!res) return [];
  return res.data.symbols
    .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map(s => s.symbol);
}

async function checkListings() {
  const current = await getUsdtSymbols();
  if (current.length === 0) return;

  if (isFirstRun) {
    initialSymbols = new Set(current);
    await saveInitialSymbols(initialSymbols);
    isFirstRun = false;
    await logMessage(`Primeira execução: ${current.length} pares salvos.`);
    return;
  }

  const novas = current.filter(s => !initialSymbols.has(s));
  if (novas.length > 0) {
    for (const symbol of novas) {
      const hora = new Date().toLocaleString('pt-BR');
      const msg = `*NOVA LISTAGEM BINANCE FUTURES!*\n\n\`${symbol}\`\n\n${hora}`;
      await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
      await logMessage(`NOVA LISTAGEM: ${symbol}`);
    }
  }

  initialSymbols = new Set(current);
  await saveInitialSymbols(initialSymbols);
}

// ===================== START =====================
(async () => {
  await loadInitialSymbols();
  await logMessage('Bot iniciado! Monitorando listagens + análise BTC com orderbook SPOT');

  await enviarAnaliseBTC();
  setInterval(enviarAnaliseBTC, 60 * 60 * 1000); // a cada hora

  await checkListings();
  setInterval(checkListings, 30 * 1000);
})();

process.on('SIGINT', async () => {
  await saveInitialSymbols(initialSymbols);
  await logMessage('Bot encerrado.');
  process.exit(0);
});
