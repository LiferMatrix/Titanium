require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

// Configurações (coloque no .env)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('⚠️ Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

// Arquivo de log
const logFile = 'bot.log';

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

// Cache simples (5 minutos)
const cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

// ======= FUNÇÃO DE RECONEXÃO AUTOMÁTICA =======
let reconnectAttempts = 0;

async function safeRequest(fn, retries = 5, delay = 5000) {
  while (retries > 0) {
    try {
      return await fn();
    } catch (err) {
      reconnectAttempts++;
      await logMessage(`⚠️ Erro de conexão (${err.message}). Tentando reconectar (#${reconnectAttempts}) em ${delay / 1000}s...`);
      await new Promise(res => setTimeout(res, delay));
      retries--;
      delay *= 1.5; // aumenta o tempo entre tentativas
    }
  }
  await logMessage('❌ Falha após múltiplas tentativas de reconexão.');
  return null;
}
// =================================================

// Busca todos os pares USDT de futuros
async function getUsdtSymbols() {
  return await safeRequest(async () => {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeout: 10000 });
    return res.data.symbols
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
  }) || [];
}

// Busca LSR de um símbolo
async function getLSR(symbol) {
  return await safeRequest(async () => {
    const res = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol, period: '5m', limit: 1 },
      timeout: 8000
    });
    return parseFloat(res.data[0].longShortRatio).toFixed(4);
  });
}

// Função principal
async function sendTopLSR() {
  const now = Date.now();
  let data = [];

  // Usa cache se válido
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    data = cache.data;
  } else {
    await logMessage('Buscando dados...');
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
    await logMessage('Dados insuficientes');
    return;
  }

  const topHigh = data.slice(0, 5);
  const topLow = data.slice(-5).reverse();

  let msg = `🤖 #TOP #LONG vs #SHORT ♻️\n`;
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

  await safeRequest(async () => {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    await logMessage('Enviado com sucesso');
  });
}

// Executa agora e a cada hora
sendTopLSR();
setInterval(sendTopLSR, 60 * 60 * 1000);
logMessage('Bot iniciado! Enviando TOP LSR a cada hora.');
