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
const WHALE_THRESHOLD = 50000;
const COOLDOWN_MINUTES = 30; // ⏰ MUDADO PARA 30 MINUTOS!
let allUsdtSymbols = [];
const lastAlertTime = new Map();
let initialSymbols = new Set();

// 🔥 SUPORTE/RESISTÊNCIA - APIs CORRETAS!
const srCache = new Map();

async function getSupportResistance(symbol) {
    try {
        // MÉTODO 1: Tenta 50 velas 1m (PRIORIDADE)
        try {
            const klines = await binance.futuresCandles(symbol, '1m', { limit: 50 });
            if (klines && klines.length >= 20) {
                const validLows = klines.slice(-50).map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
                const validHighs = klines.slice(-50).map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
                
                if (validLows.length >= 10 && validHighs.length >= 10) {
                    const support = Math.min(...validLows);
                    const resistance = Math.max(...validHighs);
                    
                    const result = {
                        support: support.toFixed(6),
                        resistance: resistance.toFixed(6),
                        method: '50_velas_1m'
                    };
                    
                    srCache.set(symbol, result);
                    console.log(`✅ S/R ${symbol} (50 velas): 🛡️ ${result.support} | 📈 ${result.resistance}`);
                    return result;
                }
            }
        } catch (klineError) {
            console.log(`⚠️ Klines falhou ${symbol}, método 2...`);
        }
        
        // MÉTODO 2: 24hr ticker (API CORRETA!)
        try {
            const ticker24hr = await binance.futures24hrPriceChange();
            const tickerData = ticker24hr.find(t => t.symbol === symbol);
            
            if (tickerData) {
                const currentPrice = parseFloat(tickerData.lastPrice);
                const low24h = parseFloat(tickerData.lowPrice);
                const high24h = parseFloat(tickerData.highPrice);
                
                // S/R baseado em 24h range
                const support = (low24h * 0.999).toFixed(6);
                const resistance = (high24h * 1.001).toFixed(6);
                
                const result = {
                    support: support,
                    resistance: resistance,
                    method: '24hr_ticker'
                };
                
                srCache.set(symbol, result);
                console.log(`✅ S/R ${symbol} (24hr): 🛡️ ${support} | 📈 ${resistance}`);
                return result;
            }
        } catch (tickerError) {
            console.log(`⚠️ 24hr ticker falhou ${symbol}, método 3...`);
        }
        
        // MÉTODO 3: Apenas preço atual (SEMPRE funciona!)
        try {
            const prices = await binance.futuresPrices();
            const currentPrice = parseFloat(prices[symbol]);
            
            if (currentPrice > 0) {
                const support = (currentPrice * 0.995).toFixed(6);
                const resistance = (currentPrice * 1.005).toFixed(6);
                
                const result = {
                    support: support,
                    resistance: resistance,
                    method: 'current_price'
                };
                
                srCache.set(symbol, result);
                console.log(`✅ S/R ${symbol} (preço): 🛡️ ${support} | 📈 ${resistance}`);
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

// 🔧 FUNÇÃO ANTI-SPAM 30 MINUTOS - CORRIGIDA!
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
    console.log(`📊 S/R com APIs CORRETAS - SEMPRE FUNCIONA!`);
    console.log(`🛡️ ANTI-SPAM: ${COOLDOWN_MINUTES} MINUTOS por moeda!`);
    
    const tradeStreams = allUsdtSymbols.map(symbol => `${symbol.toLowerCase()}@trade`);
    const chunkSize = 200;
    const chunks = [];
    
    for (let i = 0; i < tradeStreams.length; i += chunkSize) {
        chunks.push(tradeStreams.slice(i, i + chunkSize));
    }
    
    console.log(`🐳 ${chunks.length} conexões WebSocket (${allUsdtSymbols.length} pares)`);
    
    chunks.forEach((chunk, index) => {
        binance.futuresSubscribe(chunk, async (trade) => {
            const { s: symbol, S: side, p: price, q: quantity, T: time } = trade;
            const tradeValueUSD = parseFloat(price) * parseFloat(quantity);
            
            if (tradeValueUSD >= WHALE_THRESHOLD && canAlert(symbol)) {
                const now = new Date(time).toLocaleString('pt-BR', { 
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                
                const emoji = side === 'BUY' ? '💰✅*COMPRANDO*✅' : '📛*VENDENDO*📛';
                const amount = parseFloat(quantity).toLocaleString('en-US', { maximumFractionDigits: 1 });
                const valueUSD = tradeValueUSD.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                const priceUSD = parseFloat(price).toFixed(6);
                const coinName = symbol.replace('USDT', '');
                
                // 🔥 S/R COM APIs CORRETAS!
                const sr = await getSupportResistance(symbol);
                let srInfo = '';
                
                if (sr && sr.support && sr.resistance) {
                    srInfo = `\n📊 *S/R (${sr.method}):*\n` +
                           `🛡️ *Suporte:* \`${sr.support}\`\n` +
                           `📈 *Resistência:* \`${sr.resistance}\``;
                } else {
                    srInfo = `\n⚠️ *S/R indisponível*`;
                }
                
                const message = `🐳 *BALEIA DETECTADA! 🐳*\n\n` +
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
                // Log de whale em cooldown
                console.log(`🐳⏳ ${symbol} ${side} $${tradeValueUSD.toLocaleString('en-US')} (COOLDOWN 30min)`);
            }
        });
        
        console.log(`🐳 Chunk ${index + 1}/${chunks.length} conectado (${chunk.length} pares)`);
    });
}

// Inicia monitoramento
async function startMonitoring() {
    console.log('🔍 Iniciando MONITORAMENTO TOTAL + S/R CORRIGIDO!');
    console.log('📊 APIs usadas: futuresCandles, futures24hrPriceChange, futuresPrices');
    console.log('🛡️ ANTI-SPAM: ' + COOLDOWN_MINUTES + ' MINUTOS por moeda!');
    console.log('💰 Threshold Whale: $' + WHALE_THRESHOLD.toLocaleString() + ' USD\n');
    
    await checkListingsDelistings();
    setInterval(checkListingsDelistings, 30000);
    setTimeout(startWhaleDetection, 2000);
}

process.on('SIGINT', () => {
    console.log('\n👋 Parando monitor...');
    console.log(`📊 Total pares USDT: ${allUsdtSymbols.length}`);
    console.log(`🛡️ Cooldown ativo: ${lastAlertTime.size} moedas (30min)`);
    process.exit(0);
});

if (!TELEGRAM_BOT_TOKEN) console.log('⚠️  TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) console.log('⚠️  TELEGRAM_CHAT_ID não encontrado');

startMonitoring();