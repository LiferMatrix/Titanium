require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

// Configurações (coloque no .env)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('⚠️ Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Cache simples (5 minutos)
const cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

// Busca todos os pares USDT de futuros
async function getUsdtSymbols() {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeout: 10000 });
    return res.data.symbols
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
  } catch (e) {
    console.error('Erro ao buscar símbolos:', e.message);
    return [];
  }
}

// Busca LSR de um símbolo
async function getLSR(symbol) {
  try {
    const res = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol, period: '5m', limit: 1 },
      timeout: 8000
    });
    return parseFloat(res.data[0].longShortRatio).toFixed(4);
  } catch (e) {
    return null;
  }
}

// Função principal
async function sendTopLSR() {
  const now = Date.now();
  let data = [];

  // Usa cache se válido
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    data = cache.data;
  } else {
    console.log('Buscando dados...');
    const symbols = await getUsdtSymbols();
    const promises = symbols.map(async (s) => {
      const lsr = await getLSR(s);
      return lsr ? { symbol: s, lsr: parseFloat(lsr) } : null;
    });

    const results = (await Promise.all(promises)).filter(Boolean);
    data = results.sort((a, b) => b.lsr - a.lsr);
    cache.data = data;
    cache.timestamp = now;
  }

  if (data.length < 10) {
    console.log('Dados insuficientes');
    return;
  }

  const topHigh = data.slice(0, 5);
  const topLow = data.slice(-5).reverse();

  let msg = `🤖 #TOP #LONG vs #SHORT #RATIO ♻️\n`;
  msg += `📈 *Top 5 – LSR Alto*\n`;
  topHigh.forEach((item, i) => {
    const emoji = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i + 1}️⃣ `;
    msg += `${emoji} ${item.symbol} → ${item.lsr}\n`;
  });

  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `📉 *Top 5 – LSR Baixo*\n`;
  topLow.forEach((item, i) => {
    const emoji = i === 0 ? '🔥 ' : '🔻 ';
    msg += `${i + 1}️⃣ ${emoji} ${item.symbol} → ${item.lsr}\n`;
  });

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    console.log('Enviado às', new Date().toLocaleString('pt-BR'));
  } catch (e) {
    console.error('Erro ao enviar:', e.message);
  }
}

// Executa agora e a cada hora
sendTopLSR();
setInterval(sendTopLSR, 60 * 60 * 1000);

console.log('Bot iniciado! Enviando TOP LSR a cada hora.');
