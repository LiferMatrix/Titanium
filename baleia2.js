require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const ccxt = require('ccxt');

// Configurações
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const binance = new Binance().options({
    'futures': true,
    'APIKEY': process.env.BINANCE_API_KEY,
    'APISECRET': process.env.BINANCE_SECRET,
    'reconnect': true // Ativa reconexão automática no node-binance-api
});

// Inicializa ccxt para Binance Futures
const binanceCCXT = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true,
    options: { defaultType: 'future' }
});

// Inicializa Telegram Bot
let telegramBot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    console.log('✅ Telegram Bot conectado!');
} else {
    console.log('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Configurações de WHALE DETECTION
const WHALE_THRESHOLD = 100000; // Alterado para $100.000
const COOLDOWN_MINUTES = 30; // ⏰ Cooldown de 30 minutos
let allUsdtSymbols = [];
const lastAlertTime = new Map();
let initialSymbols = new Set();
let wsConnections = []; // Armazena conexões WebSocket para controle

// 🔥 SUPORTE/RESISTÊNCIA + ROMPIMENTOS - APIs CORRETAS!
const srCache = new Map();

async function getSupportResistance(symbol) {
    try {
        // MÉTODO 1: Tenta 100 velas 1m (PRIORIDADE) - Mais dados para estrutura
        try {
            const klines = await binance.futuresCandles(symbol, '1m', { limit: 100 });
            if (klines && klines.length >= 50) {
                const validLows = klines.slice(-100).map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
                const validHighs = klines.slice(-100).map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
                
                if (validLows.length >= 20 && validHighs.length >= 20) {
                    // Suporte = menor low das últimas 100 velas
                    // Resistência = maior high das últimas 100 velas
                    const support = Math.min(...validLows);
                    const resistance = Math.max(...validHighs);
                    
                    // ROMPIMENTOS DA ESTRUTURA
                    const breakoutHigh = (resistance * 1.002).toFixed(6);  // +0.2% acima da resistência
                    const breakoutLow = (support * 0.998).toFixed(6);      // -0.2% abaixo do suporte
                    
                    const result = {
                        support: support.toFixed(6),
                        resistance: resistance.toFixed(6),
                        breakoutHigh: breakoutHigh,
                        breakoutLow: breakoutLow,
                        method: '100_velas_1m'
                    };
                    
                    srCache.set(symbol, result);
                    console.log(`✅ S/R ${symbol} (100 velas): 🛡️ ${result.support} | 📈 ${result.resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                    return result;
                }
            }
        } catch (klineError) {
            console.log(`⚠️ Klines falhou ${symbol}, método 2...`);
        }
        
        // MÉTODO 2: 24hr ticker
        try {
            const ticker24hr = await binance.futures24hrPriceChange();
            const tickerData = ticker24hr.find(t => t.symbol === symbol);
            
            if (tickerData) {
                const low24h = parseFloat(tickerData.lowPrice);
                const high24h = parseFloat(tickerData.highPrice);
                
                // ROMPIMENTOS baseados em 24h
                const breakoutHigh = (high24h * 1.003).toFixed(6);  // +0.3% acima do high 24h
                const breakoutLow = (low24h * 0.997).toFixed(6);    // -0.3% abaixo do low 24h
                
                const result = {
                    support: (low24h * 0.999).toFixed(6),
                    resistance: (high24h * 1.001).toFixed(6),
                    breakoutHigh: breakoutHigh,
                    breakoutLow: breakoutLow,
                    method: '24hr_ticker'
                };
                
                srCache.set(symbol, result);
                console.log(`✅ S/R ${symbol} (24hr): 🛡️ ${result.support} | 📈 ${result.resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                return result;
            }
        } catch (tickerError) {
            console.log(`⚠️ 24hr ticker falhou ${symbol}, método 3...`);
        }
        
        // MÉTODO 3: Apenas preço atual
        try {
            const prices = await binance.futuresPrices();
            const currentPrice = parseFloat(prices[symbol]);
            
            if (currentPrice > 0) {
                const support = (currentPrice * 0.995).toFixed(6);
                const resistance = (currentPrice * 1.005).toFixed(6);
                const breakoutHigh = (currentPrice * 1.008).toFixed(6);  // +0.8% acima
                const breakoutLow = (currentPrice * 0.992).toFixed(6);    // -0.8% abaixo
                
                const result = {
                    support: support,
                    resistance: resistance,
                    breakoutHigh: breakoutHigh,
                    breakoutLow: breakoutLow,
                    method: 'current_price'
                };
                
                srCache.set(symbol, result);
                console.log(`✅ S/R ${symbol} (preço): 🛡️ ${support} | 📈 ${resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                return result;
            }
        } catch (priceError) {
            console.log(`❌ Todas APIs falharam ${symbol}`);
        }
        
        return null;
        
    } catch (error) {
        console.log(`❌ Erro S/R ${symbol}:`, error.message);
        return null;
    }
}

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
    } catch (error) {
        console.error('❌ Erro Telegram:', error.message);
        console.log(message);
    }
}

// 🔧 FUNÇÃO ANTI-SPAM 30 MINUTOS
function canAlert(symbol) {
    const now = Date.now();
    const lastTime = lastAlertTime.get(symbol);
    
    if (!lastTime) {
        lastAlertTime.set(symbol, now);
        console.log(`🛡️ ${symbol} - PRIMEIRO ALERTA (30min cooldown iniciado)`);
        return true;
    }
    
    const minutesDiff = (now - lastTime) / (1000 * 60);
    const canSend = minutesDiff >= COOLDOWN_MINUTES;
    
    if (canSend) {
        lastAlertTime.set(symbol, now);
        console.log(`🛡️ ${symbol} - ALERTA LIBERADO (${minutesDiff.toFixed(1)}min desde último)`);
        return true;
    } else {
        console.log(`⏳ ${symbol} - COOLDOWN (${COOLDOWN_MINUTES}min): ${minutesDiff.toFixed(1)}min restante`);
        return false;
    }
}

// Busca símbolos USDT
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

// Listagens/deslistagens
async function checkListingsDelistings() {
    const currentSymbols = await fetchAllUsdtSymbols();
    
    if (initialSymbols.size === 0) {
        currentSymbols.forEach(symbol => initialSymbols.add(symbol));
        allUsdtSymbols = currentSymbols;
        console.log(`📊 Lista inicial: ${initialSymbols.size} pares USDT carregados.`);
        console.log(`🐳 Whale detection ATIVO em ${allUsdtSymbols.length} pares!`);
        return;
    }
    
    const newSymbols = currentSymbols.filter(symbol => !initialSymbols.has(symbol));
    const delistedSymbols = Array.from(initialSymbols).filter(symbol => !currentSymbols.includes(symbol));
    
    if (newSymbols.length > 0) {
        newSymbols.forEach(async (symbol) => {
            const now = new Date().toLocaleString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const message = `⚠️ *Nova Listagem ⚠️ Binance Futures:*\n\n\`${symbol}\`\n\n⏰ *${now}*`;
            await sendTelegramMessage(message);
        });
        console.log(`🆕 ${newSymbols.length} NOVA(S) LISTAGEM(ÕES)!`);
    }
    
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
    
    initialSymbols = new Set(currentSymbols);
    allUsdtSymbols = currentSymbols;
}

// 🐳 WHALE DETECTOR - 30 MINUTOS ANTI-SPAM!
function startWhaleDetection() {
    console.log('🐳 Conectando WebSocket para TODOS os pares USDT...');
    console.log(`📊 S/R + ROMPIMENTOS com APIs CORRETAS - SEMPRE FUNCIONA!`);
    console.log(`🛡️ ANTI-SPAM: ${COOLDOWN_MINUTES} MINUTOS por moeda!`);
    console.log(`💰 Threshold Whale: $${WHALE_THRESHOLD.toLocaleString()} USD`);
    
    const tradeStreams = allUsdtSymbols.map(symbol => `${symbol.toLowerCase()}@trade`);
    const chunkSize = 200;
    const chunks = [];
    
    for (let i = 0; i < tradeStreams.length; i += chunkSize) {
        chunks.push(tradeStreams.slice(i, i + chunkSize));
    }
    
    console.log(`🐳 ${chunks.length} conexões WebSocket (${allUsdtSymbols.length} pares)`);
    
    // Função para conectar/reconectar WebSocket
    function connectWebSocket(chunk, index) {
        const ws = binance.futuresSubscribe(chunk, async (trade) => {
            const { s: symbol, S: side, p: price, q: quantity, T: time } = trade;
            const tradeValueUSD = parseFloat(price) * parseFloat(quantity);
            
            if (tradeValueUSD >= WHALE_THRESHOLD && canAlert(symbol)) {
                const now = new Date(time).toLocaleString('pt-BR', { 
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                
                const emoji = side === 'BUY' ? '💰✅*COMPRADOR*✅' : '📛*VENDEDOR*📛';
                const amount = parseFloat(quantity).toLocaleString('en-US', { maximumFractionDigits: 1 });
                const valueUSD = tradeValueUSD.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                const priceUSD = parseFloat(price).toFixed(6);
                const coinName = symbol.replace('USDT', '');
                
                const sr = await getSupportResistance(symbol);
                let srInfo = '';
                
                if (sr && sr.support && sr.resistance && sr.breakoutHigh && sr.breakoutLow) {
                    srInfo = `\n* 🤖 Estrutura:*\n` +
                             ` *Suporte:* \`${sr.support}\`\n` +
                             ` *Resistência:* \`${sr.resistance}\`\n` +
                             ` *Rompim. ALTA:* \`${sr.breakoutHigh}\`\n` +
                             ` *Rompim. BAIXA:* \`${sr.breakoutLow}\``;
                } else {
                    srInfo = `\n⚠️ *indisp.*`;
                }
                
                const message = `🐳 *VOL DETECTADO! 🐳*\n\n` +
                              `${emoji}\n` +
                              `\`${symbol}\`\n` +
                              `Preço: *$${priceUSD}*\n` +
                              `Quantidade: *${amount} ${coinName}*\n` +
                              `Montante💵 *${valueUSD}*` +
                              `${srInfo}\n\n` +
                              `⏰ *${now}*`;
                
                sendTelegramMessage(message);
                console.log(`🐳✅ ${symbol} ${side} $${tradeValueUSD.toLocaleString('en-US')} (Cooldown 30min reset)`);
            } else if (tradeValueUSD >= WHALE_THRESHOLD) {
                console.log(`🐳⏳ ${symbol} ${side} $${tradeValueUSD.toLocaleString('en-US')} (COOLDOWN 30min)`);
            }
        }, (error) => {
            // Tratamento de erro no WebSocket
            console.error(`❌ Erro no WebSocket chunk ${index + 1}:`, error.message);
            console.log(`🔄 Tentando reconectar chunk ${index + 1} em 5 segundos...`);
            setTimeout(() => {
                console.log(`🔄 Reconectando chunk ${index + 1}...`);
                connectWebSocket(chunk, index); // Tenta reconectar
            }, 5000);
        });
        
        wsConnections[index] = ws; // Armazena a conexão
        console.log(`🐳 Chunk ${index + 1}/${chunks.length} conectado (${chunk.length} pares)`);
    }
    
    // Inicia todas as conexões WebSocket
    chunks.forEach((chunk, index) => {
        connectWebSocket(chunk, index);
    });
}

// Inicia monitoramento
async function startMonitoring() {
    console.log('🔍 Iniciando MONITORAMENTO TOTAL + S/R + ROMPIMENTOS!');
    console.log('📊 APIs usadas: futuresCandles(100), futures24hrPriceChange, futuresPrices');
    console.log('🛡️ ANTI-SPAM: ' + COOLDOWN_MINUTES + ' MINUTOS por moeda!');
    console.log('💰 Threshold Whale: $' + WHALE_THRESHOLD.toLocaleString() + ' USD');
    console.log('🔄 Reconexão automática: ATIVADA');
    
    await checkListingsDelistings();
    setInterval(checkListingsDelistings, 30000);
    setTimeout(startWhaleDetection, 2000);
}

// Lida com encerramento gracioso
process.on('SIGINT', () => {
    console.log('\n👋 Parando monitor...');
    console.log(`📊 Total pares USDT: ${allUsdtSymbols.length}`);
    console.log(`🛡️ Cooldown ativo: ${lastAlertTime.size} moedas (30min)`);
    wsConnections.forEach((ws, index) => {
        if (ws) {
            console.log(`🔌 Fechando WebSocket chunk ${index + 1}`);
            binance.futuresUnsubscribe(ws);
        }
    });
    process.exit(0);
});

if (!TELEGRAM_BOT_TOKEN) console.log('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) console.log('⚠️ TELEGRAM_CHAT_ID não encontrado');

startMonitoring();
