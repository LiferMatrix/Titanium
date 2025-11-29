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
// Função para logar mensagens
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
}, 2 * 24 * 60 * 60 * 1000);
// Cache simples (5 minutos)
const cache = { data: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;
// ===================== RECONEXÃO AUTOMÁTICA ======================
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
      delay *= 1.5;
    }
  }
  await logMessage('❌ Falha após múltiplas tentativas de reconexão.');
  return null;
}
// =================================================================
// Busca todos os pares USDT de futuros
async function getUsdtSymbols() {
  return await safeRequest(async () => {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', { timeout: 10000 });
    return res.data.symbols
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
  }) || [];
}
// Busca variação de volume 1h
async function getVolumeVariation(symbol) {
  return await safeRequest(async () => {
    const res = await axios.get('https://fapi.binance.com/futures/data/takerlongshortRatio', {
      params: { symbol, period: '1h', limit: 2 },
      timeout: 8000
    });
    if (res.data.length < 2) return 'N/A';
    const [curr, prev] = res.data;
    const prevTotal = parseFloat(prev.buyVol) + parseFloat(prev.sellVol);
    const currTotal = parseFloat(curr.buyVol) + parseFloat(curr.sellVol);
    if (prevTotal === 0) return 'N/A';
    const change = (currTotal - prevTotal) / prevTotal * 100;
    const percent = change.toFixed(2);
    const arrow = change >= 0 ? '⤴️' : '⤵️';
    const sign = change >= 0 ? '+' : '';
    const type = parseFloat(curr.buySellRatio) > 1 ? 'Vol Comprador 1H' : 'Vol Vendedor 1H';
    return `${type} ${arrow} ${sign}${percent}%`;
  }) || 'N/A';
}
// =========================== FUNÇÃO PRINCIPAL ===========================
async function sendTopLSR() {
  const now = Date.now();
  let data = [];
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    data = cache.data;
  } else {
    await logMessage('Buscando dados...');
    const symbols = await getUsdtSymbols();
    const tickers = await safeRequest(async () => {
      const res = await axios.get('https://fapi.binance.com/fapi/v1/ticker/24hr', { timeout: 10000 });
      return res.data;
    }) || [];
    data = tickers
      .filter(t => symbols.includes(t.symbol))
      .map(t => ({ symbol: t.symbol, change: parseFloat(t.priceChangePercent) }));
    cache.data = data;
    cache.timestamp = now;
  }
  if (data.length < 10) {
    await logMessage('Dados insuficientes');
    return;
  }
  let topHigh = data.sort((a, b) => b.change - a.change).slice(0, 5);
  let topLow = data.sort((a, b) => a.change - b.change).slice(0, 5);
  topHigh = await Promise.all(topHigh.map(async (item) => {
    const volStr = await getVolumeVariation(item.symbol);
    return { ...item, volStr };
  }));
  topLow = await Promise.all(topLow.map(async (item) => {
    const volStr = await getVolumeVariation(item.symbol);
    return { ...item, volStr };
  }));
  // ===================== MENSAGEM SEGURA (SEM ERROS) =====================
  let msg = `🤖 *#TOP5 #Gainers #Losers* ♻️\n`;
  msg += `\n📈 *Maiores Altas*🔴\n`;
  topHigh.forEach((item, i) => {
    const emoji = i === 0 ? '' : i === 1 ? ' ' : i === 2 ? ' ' : `${i + 1}️⃣ `;
    const sign = item.change >= 0 ? '+' : '';
    msg += `${i + 1}️⃣ ${item.symbol} — 24h: *${sign}${item.change.toFixed(2)}%* / ${item.volStr}\n`;
  });
  msg += `━━━━━━━━━━━━━━━\n`;
  msg += `📉 *Maiores Baixas*🟢\n`;
  topLow.forEach((item, i) => {
    const emoji = i === 0 ? ' ' : ' ';
    const sign = item.change >= 0 ? '+' : '';
    msg += `${i + 1}️⃣ ${item.symbol} — 24h: *${sign}${item.change.toFixed(2)}%* / ${item.volStr}\n`;
  });
  msg += `━━━━━━━━━━━━━━━\n`;
  // =======================================================================
  await safeRequest(async () => {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    await logMessage('Enviado com sucesso');
  });
}
// Executa agora e a cada hora
sendTopLSR();
setInterval(sendTopLSR, 4 * 60 * 60 * 1000);
logMessage('Bot iniciado! Enviando TOP Gainers/Losers a cada hora.');
