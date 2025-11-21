require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

// ===================== CONFIGURAÇÕES =====================
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

// ===================== FUNÇÕES EXTRAS =====================

// RSI
function rsi(values, period) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }

  const rs = avgGain / (avgLoss || 1);
  return 100 - 100 / (1 + rs);
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

// ===================== ANÁLISE RÁPIDA DO BTC =====================
async function enviarAnaliseBTC() {
  try {
    const [priceRes, k1hRes, k4hRes, depthRes, oiRes, lsrRes] = await Promise.all([
      axios.get('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=200'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=200'),
      axios.get('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000'),
      axios.get('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=13'),
      axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=1')
    ]);

    const price = parseFloat(priceRes.data.price);

    // LSR Ratio
    const lsr = parseFloat(lsrRes.data[0].longShortRatio).toFixed(2);

    // RSI 1H
    const closes1h = k1hRes.data.map(k => parseFloat(k[4]));
    const rsi1h = rsi(closes1h, 14).toFixed(1);
    const rsi1hDir = closes1h.at(-1) > closes1h.at(-2) ? "⬆️" : "⬇️";

    // RSI 4H
    const closes4h = k4hRes.data.map(k => parseFloat(k[4]));
    const rsi4h = rsi(closes4h, 14).toFixed(1);
    const rsi4hDir = closes4h.at(-1) > closes4h.at(-2) ? "⬆️" : "⬇️";

    // Estocástico 5-3-3
    const highs = k1hRes.data.map(k => parseFloat(k[2]));
    const lows = k1hRes.data.map(k => parseFloat(k[3]));
    const closes = k1hRes.data.map(k => parseFloat(k[4]));
    const stoch = stochastic(highs, lows, closes);

    const kDir = stoch.K > stoch.D ? "⬆️" : "⬇️";
    const dDir = stoch.D > stoch.K ? "⬆️" : "⬇️";

    // EMAs
    const ema = (arr, p) => {
      const k = 2 / (p + 1);
      let val = arr[0];
      for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
      return val;
    };

    const ema13 = ema(closes1h, 13);
    const ema34 = ema(closes1h, 34);
    const ema55 = ema(closes1h, 55);

    const tendencia = ema13 > ema34 ? 'Alta' : 'Baixa';
    const pos55 = price > ema55 ? 'acima' : 'abaixo';

    const oiAtual = parseFloat(oiRes.data.at(-1).sumOpenInterestValue) / 1e9;
    const oiVar = (parseFloat(oiRes.data.at(-1).sumOpenInterestValue) - parseFloat(oiRes.data[0].sumOpenInterestValue)) / 1e6;

    const bids = depthRes.data.bids.filter(b => +b[0] >= price * 0.995).reduce((s, b) => s + +b[1], 0);
    const asks = depthRes.data.asks.filter(a => +a[0] <= price * 1.005).reduce((s, a) => s + +a[1], 0);

    const dir = v => v > 0 ? 'Subiu' : v < 0 ? 'Caiu' : 'Estável';

    const msg = ` *BTCUSDT - 🤖 IA Titanium* (${new Date().toLocaleString('pt-BR')})

💲 Preço Atual: $${price.toFixed(1)}

📊 *LSR Ratio*: ${lsr}

📉 *RSI 1H*: ${rsi1h} ${rsi1hDir}
📉 *RSI 4H*: ${rsi4h} ${rsi4hDir}

📈 *Estocástico 5·3·3*  
   • K: ${stoch.K.toFixed(1)} ${kDir}  
   • D: ${stoch.D.toFixed(1)} ${dDir}

📈 Tendência 1h: *${tendencia}* (EMA13/34, ${pos55} da EMA55)

💰 Open Interest: $${oiAtual.toFixed(2)}B (${dir(oiVar)} ${Math.abs(oiVar).toFixed(0)}M)

🛡️ Order Blocks ±0.5%:
   ├ Bids: ${bids.toFixed(0)} BTC
   └ Asks: ${asks.toFixed(0)} BTC

By @J4Rviz`;

    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    await logMessage('Análise BTC enviada');
  } catch (err) {
    await logMessage('Erro na análise BTC: ' + err.message);
  }
}

// ===================== MONITORAMENTO DE LISTAGENS =====================
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
      const msg = `⚠️ *NOVA LISTAGEM BINANCE FUTURES!*\n\n\`${symbol}\`\n\n⏰ ${hora}`;
      await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
      await logMessage(`NOVA LISTAGEM: ${symbol}`);
    }
  }

  initialSymbols = new Set(current);
  await saveInitialSymbols(initialSymbols);
}

// ===================== INÍCIO =====================
(async () => {
  await loadInitialSymbols();
  await logMessage('🤖 Bot ');

  // Análise BTC na inicialização
  await enviarAnaliseBTC();

  // Análise BTC de hora em hora
  setInterval(enviarAnaliseBTC, 60 * 60 * 1000);

  // Verifica listagens a cada 30s
  await checkListings();
  setInterval(checkListings, 30 * 1000);
})();

// Salvamento ao encerrar
process.on('SIGINT', async () => {
  await saveInitialSymbols(initialSymbols);
  await logMessage('Bot encerrado.');
  process.exit(0);
});
