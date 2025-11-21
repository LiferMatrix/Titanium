require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

// ===================== CONFIG =====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('⚠️ Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
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
  } catch (error) { }
}

// Limpeza de log a cada 2 dias
setInterval(async () => {
  try {
    await fs.writeFile(logFile, '', 'utf8');
    await logMessage('🧹 Logs limpos automaticamente.');
  } catch (e) { }
}, 2 * 24 * 60 * 60 * 1000);

// ===================== RECONEXÃO =====================
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

// ===================== FUNÇÕES =====================

// RSI
function rsi(values, period = 14) {
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    diff >= 0 ? gains += diff : losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Estocástico 5-3-3
function stochastic(highs, lows, closes) {
  const period = 5;
  const smoothK = 3;
  const smoothD = 3;

  let rawK = [];

  for (let i = period - 1; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i - period + 1, i + 1));
    const low = Math.min(...lows.slice(i - period + 1, i + 1));
    const k = ((closes[i] - low) / (high - low)) * 100;
    rawK.push(k);
  }

  const smoothedK = rawK.slice(-smoothK).reduce((a, b) => a + b, 0) / smoothK;
  const smoothedD = rawK.slice(-(smoothK + smoothD)).reduce((a, b) => a + b, 0) / smoothD;

  return { K: smoothedK, D: smoothedD };
}

// ===================== ANÁLISE BTC =====================
async function enviarAnaliseBTC() {
  try {
    const [
      priceRes, klines1hRes, klines4hRes, klines12hRes, klines1dRes,
      depthRes, oiRes, lsrRes
    ] = await Promise.all([
      axios.get('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT'),

      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=200'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=200'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=12h&limit=200'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=200'),

      axios.get('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000'),
      axios.get('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=13'),

      axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1')
    ]);

    const price = parseFloat(priceRes.data.price);

    // === RSI ===
    const closes1h = klines1hRes.data.map(k => +k[4]);
    const closes4h = klines4hRes.data.map(k => +k[4]);

    const rsi1h = rsi(closes1h).toFixed(1);
    const rsi4h = rsi(closes4h).toFixed(1);

    // === EMAs ===
    const ema = (arr, p) => {
      const k = 2 / (p + 1);
      let v = arr[0];
      for (let i = 1; i < arr.length; i++) v = arr[i] * k + v * (1 - k);
      return v;
    };

    const ema13 = ema(closes1h, 13);
    const ema34 = ema(closes1h, 34);
    const ema55 = ema(closes1h, 55);

    const tendencia = ema13 > ema34 ? 'Alta' : 'Baixa';
    const pos55 = price > ema55 ? 'acima' : 'abaixo';

    // === ESTOCASTICO 4H / 12H / DIARIO ===
    function calcStoch(data) {
      const highs = data.map(k => +k[2]);
      const lows = data.map(k => +k[3]);
      const closes = data.map(k => +k[4]);
      return stochastic(highs, lows, closes);
    }

    // 4H
    const st4 = calcStoch(klines4hRes.data);
    const st4Prev = calcStoch(klines4hRes.data.slice(0, -1));
    const k4 = st4.K, d4 = st4.D;
    const k4_dir = k4 > st4Prev.K ? "↑" : "↓";
    const d4_dir = d4 > st4Prev.D ? "↑" : "↓";

    // 12H
    const st12 = calcStoch(klines12hRes.data);
    const st12Prev = calcStoch(klines12hRes.data.slice(0, -1));
    const k12 = st12.K, d12 = st12.D;
    const k12_dir = k12 > st12Prev.K ? "↑" : "↓";
    const d12_dir = d12 > st12Prev.D ? "↑" : "↓";

    // DIÁRIO
    const stD = calcStoch(klines1dRes.data);
    const stDPrev = calcStoch(klines1dRes.data.slice(0, -1));
    const kD = stD.K, dD = stD.D;
    const kD_dir = kD > stDPrev.K ? "↑" : "↓";
    const dD_dir = dD > stDPrev.D ? "↑" : "↓";

    // === LSR ===
    const lsr = parseFloat(lsrRes.data[0].longShortRatio).toFixed(2);

    // === Open Interest ===
    const oiAtual = parseFloat(oiRes.data.at(-1).sumOpenInterestValue) / 1e9;
    const oiVar = (parseFloat(oiRes.data.at(-1).sumOpenInterestValue) -
                   parseFloat(oiRes.data[0].sumOpenInterestValue)) / 1e6;

    const dir = v => v > 0 ? 'Subiu' : v < 0 ? 'Caiu' : 'Estável';

    // === Order Blocks ===
    const bids = depthRes.data.bids
      .filter(b => +b[0] >= price * 0.995)
      .reduce((s, b) => s + +b[1], 0);

    const asks = depthRes.data.asks
      .filter(a => +a[0] <= price * 1.005)
      .reduce((s, a) => s + +a[1], 0);

    // ===================== MENSAGEM =====================
    const msg = `*BTCUSDT - 🤖 IA Titanium* (${new Date().toLocaleString('pt-BR')})

💲 *Preço Atual:* $${price.toFixed(1)}
📈 *Tendência 1H:* ${tendencia} (EMA13/34, ${pos55} da EMA55)

📊 *RSI*
• RSI 1H: *${rsi1h}*
• RSI 4H: *${rsi4h}*

📊 *Stoch*
4H — K: ${k4.toFixed(2)} ${k4_dir} | D: ${d4.toFixed(2)} ${d4_dir}
12H — K: ${k12.toFixed(2)} ${k12_dir} | D: ${d12.toFixed(2)} ${d12_dir}
Diário — K: ${kD.toFixed(2)} ${kD_dir} | D: ${dD.toFixed(2)} ${dD_dir}

📊 *LSR Ratio:* ${lsr}

💰 *Open Interest:* $${oiAtual.toFixed(2)}B (${dir(oiVar)} ${Math.abs(oiVar).toFixed(0)}M)

🛡️ *Order Blocks ±0.5%:*
   ├ Bids: ${bids.toFixed(0)} BTC Vendendo 
   └ Asks: ${asks.toFixed(0)} BTC Comprando

                                     By @J4Rviz`;

    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: "Markdown" });
    await logMessage("Análise BTC enviada");

  } catch (err) {
    await logMessage("Erro na análise BTC: " + err.message);
  }
}

// ===================== MONITOR DE LISTAGENS =====================
const symbolsFile = 'initialSymbols.json';
let initialSymbols = new Set();
let isFirstRun = true;

async function loadInitialSymbols() {
  try {
    const data = await fs.readFile(symbolsFile, 'utf8');
    initialSymbols = new Set(JSON.parse(data));
    isFirstRun = false;
    await logMessage(`Carregados ${initialSymbols.size} símbolos.`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(err);
    isFirstRun = true;
  }
}

async function saveInitialSymbols(symbols) {
  await fs.writeFile(symbolsFile, JSON.stringify([...symbols]), 'utf8');
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
      const msg = `⚠️ *NOVA LISTAGEM BINANCE FUTURES!*\n\n\`${symbol}\`\n\n⏰ ${hora}`;
      await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
      await logMessage(`Nova listagem: ${symbol}`);
    }
  }

  initialSymbols = new Set(current);
  await saveInitialSymbols(initialSymbols);
}

// ===================== START =====================
(async () => {
  await loadInitialSymbols();
  await logMessage('🤖 Bot iniciado!');

  await enviarAnaliseBTC();
  setInterval(enviarAnaliseBTC, 60 * 60 * 1000);

  await checkListings();
  setInterval(checkListings, 30 * 1000);
})();

process.on('SIGINT', async () => {
  await saveInitialSymbols(initialSymbols);
  await logMessage('Bot encerrado.');
  process.exit(0);
});
