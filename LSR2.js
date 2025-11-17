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

// Busca LSR
async function getLSR(symbol) {
  return await safeRequest(async () => {
    const res = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol, period: '5m', limit: 1 },
      timeout: 8000
    });
    return parseFloat(res.data[0].longShortRatio).toFixed(4);
  });
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

  let topHigh = data.slice(0, 5);
  let topLow = data.slice(-5).reverse();

  topHigh = await Promise.all(topHigh.map(async (item) => {
    const volStr = await getVolumeVariation(item.symbol);
    return { ...item, volStr };
  }));

  topLow = await Promise.all(topLow.map(async (item) => {
    const volStr = await getVolumeVariation(item.symbol);
    return { ...item, volStr };
  }));

  // ===================== MENSAGEM SEGURA (SEM ERROS) =====================
  let msg = `🤖 *#TOP #LONG vs #SHORT* ♻️\n`;

  msg += `\n📈 *Top 5 – LSR Alto*\n`;
  topHigh.forEach((item, i) => {
    const emoji = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i + 1}️⃣ `;
    msg += `${emoji}${item.symbol} — LSR: *${item.lsr}* / ${item.volStr}\n`;
  });

  msg += `━━━━━━━━━━━━━━━\n`;

  msg += `📉 *Top 5 – LSR Baixo*\n`;
  topLow.forEach((item, i) => {
    const emoji = i === 0 ? '🔥 ' : '🔻 ';
    msg += `${i + 1}️⃣ ${emoji}${item.symbol} — LSR: *${item.lsr}* / ${item.volStr}\n`;
  });

  msg += `━━━━━━━━━━━━━━━\n`;

  msg += `💡*LSR #ALTO*: mais pessoas em posições LONG(Compra) →  O mercado tende a #Liquidar os #Comprados  .\n`;
  msg += `💡*LSR #BAIXO*: mais posições SHORT(Venda) →  O mercado tende a Liquidar os  O mercado tende a #Liquidar os #Vendidos .\n`;

  // =======================================================================

  await safeRequest(async () => {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: 'Markdown' });
    await logMessage('Enviado com sucesso');
  });
}

// ===================== MONITORAMENTO DE LISTAGENS =====================
const symbolsFile = 'initialSymbols.json';
let initialSymbols = new Set();
let isFirstRun = true;

async function loadInitialSymbols() {
  try {
    const data = await fs.readFile(symbolsFile, 'utf8');
    const parsed = JSON.parse(data);

    if (Array.isArray(parsed) && parsed.length > 0) {
      initialSymbols = new Set(parsed);
      isFirstRun = false;
      await logMessage(`Carregados ${initialSymbols.size} pares USDT do histórico.`);
    } else {
      isFirstRun = true;
      await logMessage('Arquivo initialSymbols.json vazio ou inválido.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      isFirstRun = true;
      await logMessage('Arquivo initialSymbols.json não encontrado. Primeira execução.');
    } else {
      console.error('❌ Erro ao carregar symbols: ' + error.message);
      isFirstRun = true;
    }
  }
}

async function saveInitialSymbols() {
  try {
    await fs.writeFile(symbolsFile, JSON.stringify(Array.from(initialSymbols)), 'utf8');
    await logMessage('Símbolos iniciais salvos com sucesso.');
  } catch (error) {
    console.error('❌ Erro ao salvar symbols: ' + error.message);
  }
}

async function checkListings() {
  const currentSymbols = await getUsdtSymbols();
  await logMessage(`Símbolos atuais encontrados: ${currentSymbols.length}`);

  if (isFirstRun) {
    initialSymbols = new Set(currentSymbols);
    await saveInitialSymbols();
    isFirstRun = false;
    await logMessage(`📊 ${initialSymbols.size} pares salvos. Sem alertas na inicialização.`);
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

      await safeRequest(async () => {
        await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        await logMessage(`📱 Alerta de listagem enviado para ${symbol}!`);
      });
    }

    await logMessage(`🆕 ${newSymbols.length} nova(s) listagem(ens): ${newSymbols.join(', ')}`);
  } else {
    await logMessage('Nenhuma nova listagem detectada.');
  }

  initialSymbols = new Set(currentSymbols);
  await saveInitialSymbols();
}

async function startMonitoring() {
  await loadInitialSymbols();
  await logMessage('🔍 Monitorando NOVAS LISTAGENS na Binance Futures...');
  await checkListings();
  setInterval(checkListings, 30000);
}

process.on('SIGINT', async () => {
  await saveInitialSymbols();
  await logMessage('\n👋 Monitor encerrado.');
  process.exit(0);
});

// Executa agora e a cada hora
sendTopLSR();
setInterval(sendTopLSR, 60 * 60 * 1000);

startMonitoring();

logMessage('Bot iniciado! Enviando TOP LSR a cada hora e monitorando novas listagens a cada 30s.');
