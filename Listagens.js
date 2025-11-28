require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.log('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN);
const FILE = 'symbols.json';
const LOG_FILE = 'listagens.log';

let knownSymbols = new Set();

// ===================== LOG + LIMPEZA A CADA 2 DIAS =====================
async function log(msg) {
  const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const line = `[${ts}] ${msg}\n`;
  console.log(line.trim());
  try { await fs.appendFile(LOG_FILE, line); } catch(e) {}
}

setInterval(async () => {
  try {
    await fs.writeFile(LOG_FILE, '');
    log('Logs limpos automaticamente (reten 2 dias).');
  } catch(e) {}
}, 2 * 24 * 60 * 60 * 1000);

// ===================== RECONEXÃO AUTOMÁTICA =====================
async function safeRequest(config) {
  for (let i = 0; i < 10; i++) {
    try {
      return await axios(config);
    } catch (err) {
      log(`Tentativa ${i+1}/10 falhou – reconectando em 8s...`);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  log('Falha total após 10 tentativas.');
  return null;
}

// ===================== FUNÇÕES =====================
async function loadKnownSymbols() {
  try {
    const data = await fs.readFile(FILE, 'utf8');
    knownSymbols = new Set(JSON.parse(data));
    log(`Carregados ${knownSymbols.size} pares conhecidos.`);
  } catch (err) {
    if (err.code === 'ENOENT') log('Primeira execução – sem base ainda.');
    else log('Erro ao ler symbols.json: ' + err.message);
  }
}

async function getCurrentSymbols() {
  const res = await safeRequest({
    method: 'get',
    url: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
    timeout: 15000
  });
  if (!res || !res.data) return [];
  return res.data.symbols
    .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map(s => s.symbol);
}

async function sendAlert(symbol) {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const msg = `
*⚠️NOVA LISTAGEM BINANCE FUTUROS!⚠️*

\`${symbol}\`

${agora}

https://www.binance.com/en/futures/${symbol}
  `.trim();

  try {
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
    log(`ALERTA ENVIADO → ${symbol}`);
  } catch (err) {
    log('Erro Telegram: ' + err.message);
  }
}

async function checkNewListings() {
  const current = await getCurrentSymbols();
  if (current.length === 0) return;

  const novas = current.filter(s => !knownSymbols.has(s));

  if (novas.length > 0) {
    for (const s of novas) await sendAlert(s);
    log(`NOVAS → ${novas.join(', ')}`);
  }

  knownSymbols = new Set(current);
  await fs.writeFile(FILE, JSON.stringify([...knownSymbols], null, 2)).catch(() => {});
}

// ===================== START =====================
async function start() {
  log('════════════════════════════');
  log('  MONITOR DE LISTAGENS ATIVO');
  log('════════════════════════════');

  // Mensagem de boot no Telegram (1x por dia)
  const hoje = new Date().toLocaleDateString('pt-BR');
  if (!global.sentToday || global.sentToday !== hoje) {
    try {
      await bot.sendMessage(CHAT_ID, '*Novas Listagens ATIVO!*', { parse_mode: 'Markdown' });
      global.sentToday = hoje;
    } catch(e) {}
  }

  await loadKnownSymbols();

  if (knownSymbols.size === 0) {
    log('Primeira execução → criando base...');
    const list = await getCurrentSymbols();
    if (list.length > 0) {
      knownSymbols = new Set(list);
      await fs.writeFile(FILE, JSON.stringify([...knownSymbols], null, 2));
      log(`${knownSymbols.size} pares salvos. Agora só moeda nova entra!`);
    }
  } else {
    log(`Monitor rodando • ${knownSymbols.size} pares na base • checagem a cada 30s`);
    await checkNewListings();
  }

  setInterval(checkNewListings, 30_000);
}

// ===================== FECHAR =====================
process.on('SIGINT', async () => {
  log('Bot parado pelo usuário – salvando base...');
  await fs.writeFile(FILE, JSON.stringify([...knownSymbols], null, 2)).catch(() => {});
  process.exit(0);
});

start();
