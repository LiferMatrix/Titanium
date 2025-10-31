require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { Bot } = require('grammy');

// Configurações
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const binance = new Binance().options({
    futures: true,
    APIKEY: process.env.BINANCE_API_KEY,
    APISECRET: process.env.BINANCE_SECRET,
    reconnect: true
});

// Inicializa Telegram Bot
let telegramBot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('✅ Telegram Bot conectado!');
} else {
    console.log('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Armazena símbolos iniciais
let initialSymbols = new Set();

// Função para enviar mensagem no Telegram
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        console.log(message);
        return;
    }
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
        console.log('📱 Alerta enviado!');
    } catch (error) {
        console.error('❌ Erro Telegram:', error.message);
        console.log(message);
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
        console.error('❌ Erro ao buscar símbolos:', error.message);
        return [];
    }
}

// Verifica novas listagens
async function checkListings() {
    const currentSymbols = await fetchAllUsdtSymbols();

    if (initialSymbols.size === 0) {
        currentSymbols.forEach(s => initialSymbols.add(s));
        console.log(`📊 ${initialSymbols.size} pares USDT carregados inicialmente.`);
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
        console.log(`🆕 ${newSymbols.length} nova(s) listagem(ens) detectada(s)!`);
    }

    // Atualiza conjunto inicial
    initialSymbols = new Set(currentSymbols);
}

// Inicia monitoramento
async function startMonitoring() {
    console.log('🔍 Monitorando NOVAS LISTAGENS na Binance Futures...');
    await checkListings();
    setInterval(checkListings, 30000); // Verifica a cada 30 segundos
}

// Encerramento gracioso
process.on('SIGINT', () => {
    console.log('\n👋 Monitor encerrado.');
    process.exit(0);
});

// Validações
if (!TELEGRAM_BOT_TOKEN) console.log('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) console.log('⚠️ TELEGRAM_CHAT_ID não encontrado');

startMonitoring();

// ================= CONFIGURAÇÕES ================= //
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;

// Exemplo de dados recebidos (você pode substituir por API real futuramente)
const dadosBTC = {
  symbol: 'BTCUSDT.P',
  spotPrice: 107733.42,
  callWall: 108000,
  putWall: 108000,
  gammaFlip: 111500,
  cci: {
    '15m': 95.21,
    '1h': -48.55,
    '4h': -146.55,
    '1d': -71.99
  },
  expiry: '31/10/2025',
  optionsCount: { futures: 194, odte: 38 },
  timestamp: '30/10/2025, 20:04:19',
  lsr15m: 1.05,
  rsi1h: 55.32,
  rsi4h: 48.76
};

// ================= FUNÇÕES ================= //

// Função para detectar melhor compra
function detectarCompra(d) {
  return d.spotPrice <= d.putWall * 1.002 && d.cci['15m'] > 0;
}

// Função para detectar melhor venda
function detectarVenda(d) {
  return d.spotPrice >= d.callWall * 0.998 && d.cci['15m'] < 0;
}

// Mensagem formatada de compra
function mensagemCompra(d) {
  return `
📈 *ALERTA DE MELHOR COMPRA – ${d.symbol}*
⏰ (${d.timestamp})

💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟡 *Região de Suporte:* Put Wall em ${d.putWall}
🟢 *GammaFlip:* ${d.gammaFlip}
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
• Preço próximo da Put Wall (suporte forte)
• CCI 15m virando positivo
• Abaixo do GammaFlip → alta volatilidade

✅ *Sinal técnico:* Oportunidade de compra antecipada  
🎯 *Possível alvo:* ${d.gammaFlip}

#${d.symbol} #Compra #GammaFlip #CCI #Futuras
`;
}

// Mensagem formatada de venda
function mensagemVenda(d) {
  return `
📉 *ALERTA DE MELHOR VENDA – ${d.symbol}*
⏰ (${d.timestamp})

💰 *Preço Atual:* ${d.spotPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
🟠 *Região de Resistência:* Call Wall em ${d.callWall}
🟢 *GammaFlip:* ${d.gammaFlip}
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
• Preço tocando resistência (Call Wall)
• CCI 15m negativo → momentum vendedor
• Abaixo do GammaFlip → tendência de baixa

🚨 *Sinal técnico:* Oportunidade de venda no topo  
🎯 *Possível alvo:* ${d.putWall}

#${d.symbol} #Venda #GammaFlip #CCI #Futuras
`;
}

// Envia alerta ao Telegram
async function enviarAlerta(mensagem) {
  try {
    await bot.api.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
    console.log('✅ Alerta enviado com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao enviar alerta:', err.message);
  }
}

// ================= EXECUÇÃO ================= //
(async () => {
  if (detectarCompra(dadosBTC)) {
    const msg = mensagemCompra(dadosBTC);
    await enviarAlerta(msg);
  } else if (detectarVenda(dadosBTC)) {
    const msg = mensagemVenda(dadosBTC);
    await enviarAlerta(msg);
  } else {
    console.log('ℹ️ Nenhuma condição de alerta detectada no momento.');
  }
})();