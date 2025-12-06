const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J5OE6G1dTJVfP7dGqPQCqPv6A';
const TELEGRAM_CHAT_ID   = '-1002554953979';

// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// 🔵 ATIVOS PARA MONITORAR (23 ativos )
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'XRPUSDT', 'NEARUSDT',
    'ATOMUSDT', 'AVAXUSDT', 'DOTUSDT', 'BCHUSDT', 'SUIUSDT',
    'SEIUSDT', 'BNBUSDT', 'SOLUSDT', 'UNIUSDT', 'GALAUSDT',
    'SUSHIUSDT', '1INCHUSDT', 'MANAUSDT', 'SANDUSDT', 'ENJUSDT',
    'INJUSDT', 'RUNEUSDT', 'ONEUSDT'
];

// Configurações de Logs
const LOG_DIR = './logs';
const MAX_LOG_FILES = 10;
const MAX_LOG_SIZE = 10 * 1024 * 1024;

// Configurações de Reconexão
const INITIAL_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 60000;
const MAX_RETRY_ATTEMPTS = 10;

// Objeto para armazenar alertas por ativo
const alertsCooldown = {};
const COOLDOWN = 30 * 60 * 1000; // 30 minutos

// Configuração de casas decimais por ativo
const DECIMALS_CONFIG = {
    'BTCUSDT': 2,      // Bitcoin
    'ETHUSDT': 2,      // Ethereum
    'ADAUSDT': 5,      // Cardano
    'XRPUSDT': 4,      // Ripple
    'NEARUSDT': 4,     // NEAR
    'ATOMUSDT': 3,     // Cosmos
    'AVAXUSDT': 3,     // Avalanche
    'DOTUSDT': 3,      // Polkadot
    'BCHUSDT': 2,      // Bitcoin Cash
    'SUIUSDT': 4,      // SUI
    'SEIUSDT': 5,      // SEI
    'BNBUSDT': 2,      // BNB
    'SOLUSDT': 3,      // Solana
    'UNIUSDT': 3,      // Uniswap
    'GALAUSDT': 5,     // GALA
    'SUSHIUSDT': 4,    // SushiSwap
    '1INCHUSDT': 4,    // 1inch
    'MANAUSDT': 4,     // Decentraland
    'SANDUSDT': 4,     // The Sandbox
    'ENJUSDT': 4,      // Enjin
    'INJUSDT': 3,      // Injective
    'RUNEUSDT': 3,     // THORChain
    'ONEUSDT': 5       // Harmony
};

// Default se não encontrado
const DEFAULT_DECIMALS = 4;

// Função para obter data e hora de Brasília
function getBrazilianDateTime() {
    const now = new Date();
    const brasiliaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    const day = String(brasiliaTime.getDate()).padStart(2, '0');
    const month = String(brasiliaTime.getMonth() + 1).padStart(2, '0');
    const year = brasiliaTime.getFullYear();
    const hours = String(brasiliaTime.getHours()).padStart(2, '0');
    const minutes = String(brasiliaTime.getMinutes()).padStart(2, '0');
    const seconds = String(brasiliaTime.getSeconds()).padStart(2, '0');
    
    return {
        date: `${day}/${month}/${year}`,
        time: `${hours}:${minutes}:${seconds}`,
        full: `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
    };
}

// Função para inicializar sistema de logs
function initLogSystem() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    cleanupOldLogs();
}

// Função para limpar logs antigos
function cleanupOldLogs() {
    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter(file => file.startsWith('bot_') && file.endsWith('.log'))
            .map(file => ({
                name: file,
                path: path.join(LOG_DIR, file),
                time: fs.statSync(path.join(LOG_DIR, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > MAX_LOG_FILES) {
            files.slice(MAX_LOG_FILES).forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    logToFile(`🗑️ Log antigo removido: ${file.name}`);
                } catch (e) {
                    console.error(`Erro ao remover log: ${e.message}`);
                }
            });
        }
    } catch (e) {
        console.error(`Erro na limpeza de logs: ${e.message}`);
    }
}

// Função para logar em arquivo
function logToFile(message) {
    try {
        const timestamp = new Date().toISOString();
        const logDate = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `bot_${logDate}.log`);
        
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_LOG_SIZE) {
                const rotatedFile = path.join(LOG_DIR, `bot_${logDate}_${Date.now()}.log`);
                fs.renameSync(logFile, rotatedFile);
            }
        }
        
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logFile, logMessage);
    } catch (e) {
        console.error(`Erro ao escrever log: ${e.message}`);
    }
}

// Função para verificar conexão
async function checkInternetConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        await fetch('https://api.binance.com/api/v3/ping', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return true;
    } catch (error) {
        return false;
    }
}

// Função para reconexão
async function reconnectWithBackoff(attempt = 1) {
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
    
    logToFile(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
    console.log(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const isConnected = await checkInternetConnection();
    if (isConnected) {
        logToFile('✅ Conexão restaurada!');
        console.log('✅ Conexão restaurada!');
        return true;
    }
    
    if (attempt >= MAX_RETRY_ATTEMPTS) {
        logToFile('❌ Máximo de tentativas de reconexão atingido');
        console.log('❌ Máximo de tentativas de reconexão atingido');
        return false;
    }
    
    return await reconnectWithBackoff(attempt + 1);
}

// Função para formatar números com base no ativo
function formatNumber(num, symbol = null, isPrice = true) {
    if (num === "N/A" || num === undefined || num === null) return "N/A";
    
    if (isPrice && symbol && DECIMALS_CONFIG[symbol]) {
        return parseFloat(num).toLocaleString('en-US', {
            minimumFractionDigits: DECIMALS_CONFIG[symbol],
            maximumFractionDigits: DECIMALS_CONFIG[symbol]
        });
    }
    
    // Para outros números (indicadores, volumes, etc.) usar 2 casas
    return parseFloat(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Função para buscar dados ADX
async function getADX(symbol, timeframe) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=50`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        const closes = data.map(c => +c[4]);
        
        const priceChange = ((closes[closes.length-1] - closes[0]) / closes[0]) * 100;
        const trendStrength = Math.min(Math.abs(priceChange) * 1.5, 100);
        
        return {
            value: trendStrength.toFixed(2),
            timeframe: timeframe
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar ADX(${symbol}, ${timeframe}): ${e.message}`);
        return { value: "N/A", timeframe: timeframe };
    }
}

// Função para buscar RSI
async function getRSI(symbol, timeframe, period = 14) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${period + 50}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        const closes = data.map(c => +c[4]);
        
        if (closes.length < period + 1) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i <= period; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference >= 0) {
                gains += difference;
            } else {
                losses -= difference;
            }
        }
        
        let avgGain = gains / period;
        let avgLoss = losses / period;
        
        for (let i = period + 1; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            const currentGain = difference >= 0 ? difference : 0;
            const currentLoss = difference < 0 ? -difference : 0;
            
            avgGain = (avgGain * (period - 1) + currentGain) / period;
            avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
        }
        
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return {
            value: rsi.toFixed(2),
            timeframe: timeframe
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar RSI(${symbol}, ${timeframe}): ${e.message}`);
        return { value: "N/A", timeframe: timeframe };
    }
}

// Função para buscar Estocástico
async function getStochastic(symbol, timeframe, kPeriod = 5, dPeriod = 3, smooth = 3) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${kPeriod + dPeriod + smooth + 20}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        
        const highs = data.map(c => +c[2]);
        const lows = data.map(c => +c[3]);
        const closes = data.map(c => +c[4]);
        
        if (closes.length < kPeriod + dPeriod + smooth) {
            return { 
                k: "N/A", 
                d: "N/A", 
                kDirection: "➡️", 
                dDirection: "➡️", 
                timeframe: timeframe 
            };
        }
        
        const kValues = [];
        for (let i = 0; i <= closes.length - kPeriod; i++) {
            const periodHighs = highs.slice(i, i + kPeriod);
            const periodLows = lows.slice(i, i + kPeriod);
            const currentClose = closes[i + kPeriod - 1];
            
            const highestHigh = Math.max(...periodHighs);
            const lowestLow = Math.min(...periodLows);
            
            const kValue = lowestLow === highestHigh ? 50 : 
                          ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
            kValues.push(kValue);
        }
        
        const smoothedK = [];
        for (let i = 0; i <= kValues.length - smooth; i++) {
            const sum = kValues.slice(i, i + smooth).reduce((a, b) => a + b, 0);
            smoothedK.push(sum / smooth);
        }
        
        const dValues = [];
        for (let i = 0; i <= smoothedK.length - dPeriod; i++) {
            const sum = smoothedK.slice(i, i + dPeriod).reduce((a, b) => a + b, 0);
            dValues.push(sum / dPeriod);
        }
        
        const currentK = smoothedK[smoothedK.length - 1];
        const currentD = dValues[dValues.length - 1];
        
        const previousK = smoothedK[smoothedK.length - 2] || currentK;
        const previousD = dValues[dValues.length - 2] || currentD;
        
        const kDirection = currentK > previousK ? "⬆️" : 
                          currentK < previousK ? "⬇️" : "➡️";
        const dDirection = currentD > previousD ? "⬆️" : 
                          currentD < previousD ? "⬇️" : "➡️";
        
        return {
            k: currentK.toFixed(2),
            d: currentD.toFixed(2),
            kDirection: kDirection,
            dDirection: dDirection,
            timeframe: timeframe
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Estocástico(${symbol}, ${timeframe}): ${e.message}`);
        return { 
            k: "N/A", 
            d: "N/A", 
            kDirection: "➡️", 
            dDirection: "➡️", 
            timeframe: timeframe 
        };
    }
}

// Função para buscar Long/Short Ratio
async function getLSR(symbol, period = '15m') {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        
        if (data && data.length > 0) {
            const latest = data[0];
            const longAccount = parseFloat(latest.longAccount);
            const shortAccount = parseFloat(latest.shortAccount);
            const lsrRatio = longAccount / shortAccount;
            
            return {
                longAccount: longAccount.toFixed(4),
                shortAccount: shortAccount.toFixed(4),
                lsrRatio: lsrRatio.toFixed(4),
                period: period
            };
        }
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period 
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar LSR(${symbol}, ${period}): ${e.message}`);
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period 
        };
    }
}

// Função para buscar livro de ordens
async function getOrderBook(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        
        const bestBid = data.bids[0] ? +data.bids[0][0] : 0;
        const bestAsk = data.asks[0] ? +data.asks[0][0] : 0;
        
        const bidVolume = data.bids.slice(0, 5).reduce((sum, bid) => sum + +bid[1], 0);
        const askVolume = data.asks.slice(0, 5).reduce((sum, ask) => sum + +ask[1], 0);
        
        return {
            bestBid: bestBid,
            bestAsk: bestAsk,
            bidVolume: bidVolume.toFixed(2),
            askVolume: askVolume.toFixed(2),
            spread: bestBid > 0 ? ((bestAsk - bestBid) / bestBid * 10000).toFixed(2) : "N/A"
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Order Book(${symbol}): ${e.message}`);
        return {
            bestBid: "N/A",
            bestAsk: "N/A",
            bidVolume: "N/A",
            askVolume: "N/A",
            spread: "N/A"
        };
    }
}

// Função para enviar alerta
async function sendAlert(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'HTML'
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
    } catch (e) {
        logToFile(`❌ Erro ao enviar Telegram: ${e.message}`);
        console.log('❌ Erro ao enviar Telegram:', e.message);
    }
}

// Função para buscar candles
async function getCandles(symbol, timeframe = '1h') {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=200`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        return data.map(c => ({
            time: c[0],
            open: +c[1],
            high: +c[2],
            low: +c[3],
            close: +c[4]
        }));
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar candles(${symbol}): ${e.message}`);
        return [];
    }
}

// Funções de detecção de fractal (mantidas do original)
function isUpFractal(lows, index) {
    if (FRACTAL_BARS === 5) {
        return lows[index-N-2] > lows[index-N] &&
               lows[index-N-1] > lows[index-N] &&
               lows[index-N+1] > lows[index-N] &&
               lows[index-N+2] > lows[index-N];
    } else {
        return lows[index-N-1] > lows[index-N] &&
               lows[index-N+1] > lows[index-N];
    }
}

function isDnFractal(highs, index) {
    if (FRACTAL_BARS === 5) {
        return highs[index-N-2] < highs[index-N] &&
               highs[index-N-1] < highs[index-N] &&
               highs[index-N+1] < highs[index-N] &&
               highs[index-N+2] < highs[index-N];
    } else {
        return highs[index-N-1] < highs[index-N] &&
               highs[index-N+1] < highs[index-N];
    }
}

// Inicializar cooldown para cada ativo
function initAlertsCooldown() {
    SYMBOLS.forEach(symbol => {
        alertsCooldown[symbol] = {
            lastBuyAlert: 0,
            lastSellAlert: 0
        };
    });
}

// Função para monitorar um ativo específico
async function monitorSymbol(symbol) {
    try {
        const candles = await getCandles(symbol, '1h');
        if (candles.length < 100) {
            logToFile(`⚠️ Dados insuficientes para ${symbol}`);
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        const currentIndex = candles.length - 1;
        const price = closes[currentIndex];

        let buySignal = false;
        let sellSignal = false;
        let fractalLevel = 0;

        // Sweep BEAR
        if (isDnFractal(highs, currentIndex - N)) {
            fractalLevel = highs[currentIndex - N];
            if (price > fractalLevel) {
                const now = Date.now();
                if (now - alertsCooldown[symbol].lastSellAlert > COOLDOWN) {
                    sellSignal = true;
                }
            }
        }

        // Sweep BULL
        if (isUpFractal(lows, currentIndex - N)) {
            fractalLevel = lows[currentIndex - N];
            if (price < fractalLevel) {
                const now = Date.now();
                if (now - alertsCooldown[symbol].lastBuyAlert > COOLDOWN) {
                    buySignal = true;
                }
            }
        }

        if (buySignal || sellSignal) {
            // Buscar dados adicionais
            const [adx15m, adx1h, lsrData, orderBook, rsi1h, stoch4h, stochDaily] = await Promise.all([
                getADX(symbol, '15m'),
                getADX(symbol, '1h'),
                getLSR(symbol, '15m'),
                getOrderBook(symbol),
                getRSI(symbol, '1h'),
                getStochastic(symbol, '4h'),
                getStochastic(symbol, '1d')
            ]);

            const brDateTime = getBrazilianDateTime();
            const signalType = sellSignal ? 'Venda' : 'Compra';
            const emoji = sellSignal ? '🛑' : '🟢';
            
            // Usar formatação específica por ativo para preços
            const priceFormatted = formatNumber(price, symbol, true);
            const fractalLevelFormatted = formatNumber(fractalLevel, symbol, true);
            const bestBidFormatted = formatNumber(orderBook.bestBid, symbol, true);
            const bestAskFormatted = formatNumber(orderBook.bestAsk, symbol, true);
            
            const msg = `${emoji}<b>🤖 IA Titanium </b>\n` +
                      ` <b>${sellSignal ? '📛Zona de liquidez de Venda:' : '💹Zona de liquidez de Compra:'}</b>\n` +
                      ` <b>${sellSignal ? 'Avaliar Realizar Lucros...' : 'Avaliar ponto de Reversão...'}</b>\n` +
                       `⏰<b>Data/Hora:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                       ` <b>#Ativo:</b> #${symbol}\n` +
                       ` <b>Preço:</b> $${priceFormatted}\n` +
                       `• Force 15m: <b>${adx15m.value}</b>\n` +
                       `• Force 1h: <b>${adx1h.value}</b>\n` +
                       `• #RSI 1h: <b>${rsi1h.value}</b>\n` +
                       `• #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n` +
                       `• #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n` +
                       `• #LSR : <b>${lsrData.lsrRatio}</b>\n` +
                       ` <b>Livro de Ordens:</b>\n` +
                       `• Vol Bid: <b>${orderBook.bidVolume}</b>\n` +
                       `• Vol Ask: <b>${orderBook.askVolume}</b>\n` +
                       
                       `               <b>Tecnology by @J4Rviz</b>`;
            
            return {
                symbol: symbol,
                signal: signalType,
                message: msg,
                price: price,
                fractalLevel: fractalLevel,
                brDateTime: brDateTime,
                priceFormatted: priceFormatted,
                fractalLevelFormatted: fractalLevelFormatted
            };
        }
        
        return null;
    } catch (e) {
        logToFile(`❌ Erro ao monitorar ${symbol}: ${e.message}`);
        return null;
    }
}

// Função para mostrar status do monitoramento
function showMonitoringStatus() {
    const now = Date.now();
    let status = "\n📊 STATUS DO MONITORAMENTO:\n";
    status += "=".repeat(50) + "\n";
    
    // Agrupar ativos em colunas para melhor visualização
    const symbolsPerColumn = Math.ceil(SYMBOLS.length / 3);
    
    for (let i = 0; i < symbolsPerColumn; i++) {
        let line = "";
        
        // Coluna 1
        if (i < SYMBOLS.length) {
            const symbol1 = SYMBOLS[i];
            const lastBuy1 = alertsCooldown[symbol1].lastBuyAlert;
            const lastSell1 = alertsCooldown[symbol1].lastSellAlert;
            const buyCooldown1 = lastBuy1 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy1)) : 0;
            const sellCooldown1 = lastSell1 > 0 ? Math.max(0, COOLDOWN - (now - lastSell1)) : 0;
            const buyStatus1 = buyCooldown1 > 0 ? `⏳${Math.round(buyCooldown1/60000)}m` : '✅';
            const sellStatus1 = sellCooldown1 > 0 ? `⏳${Math.round(sellCooldown1/60000)}m` : '✅';
            
            line += `${symbol1.padEnd(10)} C:${buyStatus1.padEnd(5)} V:${sellStatus1.padEnd(5)} | `;
        }
        
        // Coluna 2
        if (i + symbolsPerColumn < SYMBOLS.length) {
            const symbol2 = SYMBOLS[i + symbolsPerColumn];
            const lastBuy2 = alertsCooldown[symbol2].lastBuyAlert;
            const lastSell2 = alertsCooldown[symbol2].lastSellAlert;
            const buyCooldown2 = lastBuy2 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy2)) : 0;
            const sellCooldown2 = lastSell2 > 0 ? Math.max(0, COOLDOWN - (now - lastSell2)) : 0;
            const buyStatus2 = buyCooldown2 > 0 ? `⏳${Math.round(buyCooldown2/60000)}m` : '✅';
            const sellStatus2 = sellCooldown2 > 0 ? `⏳${Math.round(sellCooldown2/60000)}m` : '✅';
            
            line += `${symbol2.padEnd(10)} C:${buyStatus2.padEnd(5)} V:${sellStatus2.padEnd(5)} | `;
        }
        
        // Coluna 3
        if (i + symbolsPerColumn * 2 < SYMBOLS.length) {
            const symbol3 = SYMBOLS[i + symbolsPerColumn * 2];
            const lastBuy3 = alertsCooldown[symbol3].lastBuyAlert;
            const lastSell3 = alertsCooldown[symbol3].lastSellAlert;
            const buyCooldown3 = lastBuy3 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy3)) : 0;
            const sellCooldown3 = lastSell3 > 0 ? Math.max(0, COOLDOWN - (now - lastSell3)) : 0;
            const buyStatus3 = buyCooldown3 > 0 ? `⏳${Math.round(buyCooldown3/60000)}m` : '✅';
            const sellStatus3 = sellCooldown3 > 0 ? `⏳${Math.round(sellCooldown3/60000)}m` : '✅';
            
            line += `${symbol3.padEnd(10)} C:${buyStatus3.padEnd(5)} V:${sellStatus3.padEnd(5)}`;
        }
        
        status += line + "\n";
    }
    
    status += "=".repeat(50) + "\n";
    status += "Legenda: C=Compra, V=Venda, ✅=Pronto, ⏳=Cooldown\n";
    console.log(status);
}

// Loop principal do bot
async function mainBotLoop() {
    // Inicializar sistema de cooldown
    initAlertsCooldown();
    
    const initMsg = '\n' +
        '='.repeat(50) + '\n' +
        ' BOT DO SWEEP 1H INICIADO\n' +
        ` MONITORANDO ${SYMBOLS.length} ATIVOS\n` +
        ' TIMEFRAME: 1H\n' +
        ' SISTEMA DE LOGS ATIVADO\n' +
        ' RECONEXÃO AUTOMÁTICA: ON\n' +
        ' AGUARDANDO SWEEP DE LIQUIDEZ...\n' +
        '='.repeat(50) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot iniciado - Monitorando ${SYMBOLS.length} ativos`);
    
    // Mostrar configuração de casas decimais
    console.log('\n🔧 CONFIGURAÇÃO DE CASAS DECIMAIS:');
    console.log('='.repeat(60));
    
    // Mostrar em colunas
    const symbolsPerRow = 4;
    for (let i = 0; i < SYMBOLS.length; i += symbolsPerRow) {
        let line = "";
        for (let j = 0; j < symbolsPerRow && i + j < SYMBOLS.length; j++) {
            const symbol = SYMBOLS[i + j];
            const decimals = DECIMALS_CONFIG[symbol] || DEFAULT_DECIMALS;
            line += `${symbol}: ${decimals}c `.padEnd(20);
        }
        console.log(line);
    }
    console.log('='.repeat(60) + '\n');
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>BOT INICIADO</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `Sistema de logs e reconexão automática ativados\n` +
                    `Monitorando ${SYMBOLS.length} ativos em 1H...\n` +
                    `\n<b>Ativos monitorados:</b>\n` +
                    `1. BTCUSDT, 2. ETHUSDT, 3. ADAUSDT, 4. XRPUSDT\n` +
                    `5. NEARUSDT, 6. ATOMUSDT, 7. AVAXUSDT, 8. DOTUSDT\n` +
                    `9. BCHUSDT, 10. SUIUSDT, 11. SEIUSDT, 12. BNBUSDT\n` +
                    `13. SOLUSDT, 14. UNIUSDT, 15. GALAUSDT, 16. SUSHIUSDT\n` +
                    `17. 1INCHUSDT, 18. MANAUSDT, 19. SANDUSDT, 20. ENJUSDT\n` +
                    `21. INJUSDT, 22. RUNEUSDT, 23. ONEUSDT`);

    let consecutiveErrors = 0;
    let cycleCount = 0;

    while (true) {
        try {
            cycleCount++;
            
            // Verificar conexão periodicamente
            if (consecutiveErrors > 3) {
                logToFile('⚠️ Muitos erros consecutivos, verificando conexão...');
                const isConnected = await checkInternetConnection();
                if (!isConnected) {
                    logToFile('🌐 Sem conexão com internet, tentando reconectar...');
                    console.log('🌐 Sem conexão com internet, tentando reconectar...');
                    const reconnected = await reconnectWithBackoff();
                    if (!reconnected) {
                        logToFile('❌ Falha na reconexão, reiniciando bot em 30 segundos...');
                        await new Promise(r => setTimeout(r, 30000));
                        continue;
                    }
                }
                consecutiveErrors = 0;
            }

            let alertsSent = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            
            // Monitorar cada ativo sequencialmente
            for (const symbol of SYMBOLS) {
                try {
                    const result = await monitorSymbol(symbol);
                    
                    if (result) {
                        console.log(`\n🔔 ALERTA DETECTADO PARA ${symbol}!`);
                        console.log(`📊 ${result.signal} - Preço: $${result.priceFormatted} - Nível: $${result.fractalLevelFormatted}`);
                        logToFile(`ALERTA ${result.signal} - ${symbol} - Preço: $${result.price} - Nível: $${result.fractalLevel}`);
                        
                        await sendAlert(result.message);
                        
                        // Atualizar cooldown
                        if (result.signal === 'Venda') {
                            alertsCooldown[symbol].lastSellAlert = Date.now();
                        } else {
                            alertsCooldown[symbol].lastBuyAlert = Date.now();
                        }
                        
                        alertsSent++;
                        
                        // Pequena pausa entre alertas para não sobrecarregar
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        process.stdout.write('.');
                    }
                    
                    // Pequena pausa entre ativos para não sobrecarregar a API
                    await new Promise(r => setTimeout(r, 200));
                    
                } catch (e) {
                    logToFile(`❌ Erro no processamento de ${symbol}: ${e.message}`);
                    console.log(`\n❌ Erro em ${symbol}: ${e.message}`);
                }
            }

            if (alertsSent > 0) {
                console.log(`\n📊 Total de ${alertsSent} alerta(s) enviado(s) nesta verificação`);
            } else {
                console.log(' ✓ Nenhum alerta detectado');
            }

            // Mostrar status a cada 10 ciclos
            if (cycleCount % 10 === 0) {
                showMonitoringStatus();
            }

            consecutiveErrors = 0;
            
            console.log(`\n⏱️  Próxima verificação em 30 segundos...`);
            
            // Aguardar 30 segundos antes da próxima verificação
            await new Promise(r => setTimeout(r, 30000));

        } catch (e) {
            consecutiveErrors++;
            const errorMsg = `Erro no loop principal (${consecutiveErrors}): ${e.message}`;
            console.log(`\n❌ ${errorMsg}`);
            logToFile(`❌ ${errorMsg}`);
            
            const waitTime = Math.min(10000 * consecutiveErrors, 60000);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

// Função principal com sistema de recuperação
async function startBot() {
    try {
        initLogSystem();
        
        logToFile('🔍 Verificando conexão inicial...');
        console.log('🔍 Verificando conexão inicial...');
        
        const isConnected = await checkInternetConnection();
        if (!isConnected) {
            console.log('🌐 Sem conexão inicial, tentando reconectar...');
            const reconnected = await reconnectWithBackoff();
            if (!reconnected) {
                throw new Error('Não foi possível estabelecer conexão inicial');
            }
        }
        
        await mainBotLoop();
        
    } catch (error) {
        const crashMsg = `🚨 BOT CRASHED: ${error.message}`;
        console.error(`\n${crashMsg}`);
        logToFile(`🚨 ${crashMsg}`);
        
        console.log('🔄 Reiniciando bot em 30 segundos...');
        logToFile('🔄 Reiniciando bot em 30 segundos...');
        
        await new Promise(r => setTimeout(r, 30000));
        await startBot();
    }
}

// Iniciar o bot
console.log('\n' + '='.repeat(60));
console.log('🤖 BOT DE MONITORAMENTO DE SWEEP 1H');
console.log('📈 Monitorando 23 ativos da Binance');
console.log('🔧 Configuração de casas decimais otimizada');
console.log('='.repeat(60) + '\n');

startBot();
