require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');

// Configurações
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const binance = new Binance().options({
    'futures': true,
    'APIKEY': process.env.BINANCE_API_KEY,
    'APISECRET': process.env.BINANCE_SECRET
});

// Inicializa Telegram Bot
let telegramBot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('✅ Telegram Bot conectado!');
} else {
    console.log('⚠️  Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Configurações de WHALE DETECTION
const WHALE_THRESHOLD = 50000; // $50K USD mínimo
const COOLDOWN_MINUTES = 15; // ⏰ ANTI-SPAM: 15 minutos por moeda
let allUsdtSymbols = [];

// 🛡️ ANTI-SPAM: Controla último alerta por símbolo
const lastAlertTime = new Map(); // symbol -> timestamp

// Lista inicial de símbolos (futuros)
let initialSymbols = new Set();

// Função para enviar mensagem no Telegram
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        console.log(message);
        return;
    }
    
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, {
            parse_mode: 'Markdown'
        });
        console.log('📱 Mensagem WHALE enviada!');
    } catch (error) {  // ✅ CORRIGIDO AQUI!
        console.error('❌ Erro Telegram:', error.message);
        console.log(message);
    }
}

// Função para verificar se pode alertar (anti-spam)
function canAlert(symbol) {
    const now = Date.now();
    const lastTime = lastAlertTime.get(symbol);
    
    if (!lastTime) {
        lastAlertTime.set(symbol, now);
        return true;
    }
    
    const minutesDiff = (now - lastTime) / (1000 * 60);
    const canSend = minutesDiff >= COOLDOWN_MINUTES;
    
    if (canSend) {
        lastAlertTime.set(symbol, now);
    }
    
    return canSend;
}

// Função para buscar TODOS os pares USDT ativos
async function fetchAllUsdtSymbols() {
    try {
        const exchangeInfo = await binance.futuresExchangeInfo();
        const usdtSymbols = exchangeInfo.symbols
            .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map(s => s.symbol)
            .sort();
        return usdtSymbols;
    } catch (error) {
        console.error('❌ Erro ao buscar símbolos USDT:', error.message);
        return [];
    }
}

// Função para detectar listagens e deslistagens
async function checkListingsDelistings() {
    const currentSymbols = await fetchAllUsdtSymbols();
    
    if (initialSymbols.size === 0) {
        currentSymbols.forEach(symbol => initialSymbols.add(symbol));
        allUsdtSymbols = currentSymbols;
        console.log(`📊 Lista inicial: ${initialSymbols.size} pares USDT carregados.`);
        console.log(`🐳 Whale detection ATIVO em ${allUsdtSymbols.length} pares!`);
        return;
    }
    
    // 🆕 NOVAS LISTAGENS
    const newSymbols = currentSymbols.filter(symbol => 
        !initialSymbols.has(symbol)
    );
    
    // 💀 DESLISTAGENS
    const delistedSymbols = Array.from(initialSymbols).filter(symbol => 
        !currentSymbols.includes(symbol)
    );
    
    // 🚀 NOTIFICA LISTAGENS
    if (newSymbols.length > 0) {
        newSymbols.forEach(async (symbol) => {
            const now = new Date().toLocaleString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const message = `🚀 *Nova Listagem ⚠️ Binance Futures:*\n\n\`${symbol}\`\n\n⏰ *${now}*`;
            await sendTelegramMessage(message);
        });
        console.log(`🆕 ${newSymbols.length} NOVA(S) LISTAGEM(ÕES)!`);
    }
    
    // ☠️ NOTIFICA DESLISTAGENS
    if (delistedSymbols.length > 0) {
        delistedSymbols.forEach(async (symbol) => {
            const now = new Date().toLocaleString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const message = `☠️ *DESLISTAGEM ⚠️ Binance Futures:*\n\n\`${symbol}\`\n\n⏰ *${now}*`;
            await sendTelegramMessage(message);
        });
        console.log(`💀 ${delistedSymbols.length} DESLISTAGEM(ÕES)!`);
    }
    
    // 🔄 ATUALIZA listas
    initialSymbols = new Set(currentSymbols);
    allUsdtSymbols = currentSymbols;
}

// 🐳 WHALE DETECTOR - WebSocket em TODOS os pares USDT
function startWhaleDetection() {
    console.log('🐳 Conectando WebSocket para TODOS os pares USDT...');
    console.log(`🛡️ ANTI-SPAM: 1 alerta por moeda a cada ${COOLDOWN_MINUTES} minutos`);
    
    const tradeStreams = allUsdtSymbols.map(symbol => 
        `${symbol.toLowerCase()}@trade`
    );
    
    // Limite da Binance: max 1024 streams por conexão
    const chunkSize = 200;
    const chunks = [];
    
    for (let i = 0; i < tradeStreams.length; i += chunkSize) {
        chunks.push(tradeStreams.slice(i, i + chunkSize));
    }
    
    console.log(`🐳 ${chunks.length} conexões WebSocket (${allUsdtSymbols.length} pares USDT)`);
    
    chunks.forEach((chunk, index) => {
        binance.futuresSubscribe(chunk, (trade) => {
            const { s: symbol, S: side, p: price, q: quantity, T: time } = trade;
            
            // Calcula valor do trade em USD
            const tradeValueUSD = parseFloat(price) * parseFloat(quantity);
            
            // WHALE DETECTADO! E passou no anti-spam
            if (tradeValueUSD >= WHALE_THRESHOLD && canAlert(symbol)) {
                const now = new Date(time).toLocaleString('pt-BR', { 
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                
                const emoji = side === 'BUY' ? '💰✅*COMPRANDO*✅' : '📛*VENDENDO*📛';
                const amount = parseFloat(quantity).toLocaleString('en-US', { 
                    maximumFractionDigits: 1 
                });
                const valueUSD = tradeValueUSD.toLocaleString('en-US', { 
                    style: 'currency', currency: 'USD', maximumFractionDigits: 0 
                });
                const priceUSD = `$${parseFloat(price).toFixed(4)}`;
                const coinName = symbol.replace('USDT', '');
                
                const message = `🐳*BALEIA DETECTADA!🐳*\n\n` +
                              `\`${symbol}\`\n` +
                              `Quantidade: *${amount} ${coinName}*\n` +
                              `Montante💵 *${valueUSD}*\n` +
                              `${emoji} a ${priceUSD}\n\n` +
                              `⏰ *${now}*`;
                
                sendTelegramMessage(message);
                console.log(`🐳✅ ${symbol} ${side} $${tradeValueUSD.toLocaleString('en-US')} (Cooldown reset)`);
            } else if (tradeValueUSD >= WHALE_THRESHOLD) {
                // Whale detectado mas em cooldown
                console.log(`🐳⏳ ${symbol} ${side} $${tradeValueUSD.toLocaleString('en-US')} (COOLDOWN ${COOLDOWN_MINUTES}min)`);
            }
        });
        
        console.log(`🐳 Chunk ${index + 1}/${chunks.length} conectado (${chunk.length} pares)`);
    });
}

// Inicia o monitoramento completo
async function startMonitoring() {
    console.log('🔍 Iniciando MONITORAMENTO TOTAL + ANTI-SPAM...');
    console.log('🌎 Fuso horário: Brasil (GMT-3)');
    console.log('⏱️  Listagens/Deslistagens: 30s');
    console.log('⚡ WHALES: Tempo Real (TODOS os pares USDT)');
    console.log('🛡️ ANTI-SPAM: 15min por moeda');
    console.log('💰 Threshold Whale: $' + WHALE_THRESHOLD.toLocaleString() + ' USD\n');
    
    await checkListingsDelistings();
    setInterval(checkListingsDelistings, 30000);
    
    setTimeout(startWhaleDetection, 2000);
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Parando monitor TOTAL...');
    console.log(`📊 Total pares USDT: ${allUsdtSymbols.length}`);
    console.log(`🛡️ Alertas ativos: ${lastAlertTime.size} moedas em cooldown`);
    process.exit(0);
});

// Verifica configs
if (!TELEGRAM_BOT_TOKEN) console.log('⚠️  TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) console.log('⚠️  TELEGRAM_CHAT_ID não encontrado');

startMonitoring();