const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J5OE6G1dTJVfP7dGqPQCqPv6A';
const TELEGRAM_CHAT_ID   = '-1002554953979';

// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// ATIVOS PARA MONITORAR 
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT',
    'ADAUSDT', 'DOGEUSDT', 'TONUSDT', 'NEARUSDT', 'AVAXUSDT',
    'DOTUSDT', 'SUIUSDT', 'LINKUSDT', 'BCHUSDT', 'APTUSDT',
    'ARBUSDT', 'ONDOUSDT', 'INJUSDT', 'RUNEUSDT', 'FILUSDT',
    'LTCUSDT', 'FETUSDT', 'GRTUSDT', 'UNIUSDT', 'AAVEUSDT',
    'OPUSDT', 'LDOUSDT', 'ICPUSDT', 'HBARUSDT', 'VETUSDT',
    'THETAUSDT', 'ETCUSDT', 'CKBUSDT', '1000FLOKIUSDT',
    '1000PEPEUSDT', '1000SHIBUSDT', '1000BONKUSDT', 'GMTUSDT',
    'TURBOUSDT', 'NOTUSDT', 'WLDUSDT', 'SUSHIUSDT', 
    'ENAUSDT', 'TIAUSDT', 'SEIUSDT', 'ZKUSDT', 'GALAUSDT',
    'CHZUSDT', 'HOTUSDT', 'MASKUSDT', 'API3USDT',
    'NEIROUSDT', 'VANRYUSDT', 'ONEUSDT', 'BTCDOMUSDT',
    'DYDXUSDT', 'GMXUSDT', 'AXSUSDT', 'ARUSDT', 'APEUSDT',
    'TRBUSDT', 'POLUSDT', 'STGUSDT', 'COTIUSDT', '1INCHUSDT',
    'BANDUSDT', 'C98USDT', 'IOSTUSDT', 'SKLUSDT', 'ENJUSDT',
    'MANTAUSDT', 'ILVUSDT', 'MAGICUSDT', 'SANDUSDT',  
    'DYMUSDT', 'ZILUSDT', 'CTSIUSDT', 'VIRTUALUSDT', 'MANAUSDT',
    'RSRUSDT', 'XVGUSDT', 'ATAUSDT', 'ATOMUSDT',
    'USDCUSDT'
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

// Objeto para rastrear sweeps recentes para confirmações
const recentSweeps = {};

const DECIMALS_CONFIG = {
    'BTCUSDT': 2,
    'ETHUSDT': 2,
    'SOLUSDT': 3,
    'XRPUSDT': 4,
    'BNBUSDT': 2,
    'ADAUSDT': 3,          
    'DOGEUSDT': 6,
    'TONUSDT': 4,
    'NEARUSDT': 4,
    'AVAXUSDT': 3,
    'DOTUSDT': 3,
    'SUIUSDT': 4,
    'LINKUSDT': 4,
    'BCHUSDT': 2,
    'APTUSDT': 4,
    'ARBUSDT': 3,
    'ONDOUSDT': 4,
    'INJUSDT': 3,
    'RUNEUSDT': 3,
    'FILUSDT': 4,
    'LTCUSDT': 2,
    'FETUSDT': 5,
    'GRTUSDT': 5,
    'UNIUSDT': 3,
    'AAVEUSDT': 4,
    'OPUSDT': 5,
    'LDOUSDT': 5,
    'ICPUSDT': 5,
    'HBARUSDT': 4,
    'VETUSDT': 5,
    'THETAUSDT': 5,
    'ETCUSDT': 5,
    'CKBUSDT': 5,
    '1000FLOKIUSDT': 6,
    '1000PEPEUSDT': 6,
    '1000SHIBUSDT': 6,
    '1000BONKUSDT': 6,
    'GMTUSDT': 5,
    'TURBOUSDT': 6,
    'NOTUSDT': 6,
    'WLDUSDT': 5,
    'SUSHIUSDT': 4,
    'ENAUSDT': 5,
    'TIAUSDT': 5,
    'SEIUSDT': 5,
    'ZKUSDT': 5,
    'GALAUSDT': 5,
    'CHZUSDT': 5,
    'HOTUSDT': 5,
    'MASKUSDT': 5,
    'API3USDT': 4,
    'NEIROUSDT': 6,
    'ONEUSDT': 5,
    'BTCDOMUSDT': 5,
    'DYDXUSDT': 5,
    'GMXUSDT': 4,
    'AXSUSDT': 4,
    'ARUSDT': 3,
    'APEUSDT': 4,
    'TRBUSDT': 5,
    'POLUSDT': 5,
    'STGUSDT': 4,
    'COTIUSDT': 5,
    '1INCHUSDT': 4,
    'BANDUSDT': 5,
    'C98USDT': 5,
    'IOSTUSDT': 5,
    'SKLUSDT': 5,
    'ENJUSDT': 4,
    'MANTAUSDT': 5,
    'ILVUSDT': 4,
    'MAGICUSDT': 5,
    'SANDUSDT': 4,
    'DYMUSDT': 5,
    'ZILUSDT': 6,
    'CTSIUSDT': 5,
    'VIRTUALUSDT': 4,
    'MANAUSDT': 4,
    'RSRUSDT': 6,
    'XVGUSDT': 7,
    'ATAUSDT': 6,
    'ATOMUSDT': 3,
    'USDCUSDT': 6
};

// Default (nunca vai ser usado com essa lista completa)
const DEFAULT_DECIMALS = 4;

// Configurações para alvos e stop
const TARGET_PERCENTAGES = [2.0, 4.0, 6.0, 8.0];
const STOP_PERCENTAGE    = 2.0;

// 🔵 OTIMIZAÇÕES ADICIONADAS
const BATCH_SIZE = 15; 
const candleCache = {}; 
const CANDLE_CACHE_TTL = 50000; // 50 segundos
const SWEEP_CLEANUP_INTERVAL = 10; // Limpar sweeps a cada 10 ciclos
const MAX_SWEEP_AGE = 6 * 60 * 60 * 1000; // 6 horas
const MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutos

// 🔵 FUNÇÃO MELHORADA: Calcular EMA com SMA inicial
function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    
    // Calcular SMA inicial para os primeiros 'period' períodos
    let sma = 0;
    for (let i = 0; i < period; i++) {
        sma += prices[i];
    }
    sma = sma / period;
    
    // Calcular multiplier
    const multiplier = 2 / (period + 1);
    
    // Iniciar EMA com SMA
    let ema = sma;
    
    // Calcular EMA para os períodos restantes
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// 🔵 FUNÇÃO MELHORADA: Calcular EMA para array de candles
function calculateEMAFromCandles(candles, period, priceType = 'close') {
    if (!candles || candles.length < period) return null;
    
    const prices = candles.map(c => c[priceType]);
    return calculateEMA(prices, period);
}

// 🔵 FUNÇÃO MELHORADA: Usar technicalindicators para EMA
function calculateEMATechnical(prices, period) {
    if (!prices || prices.length < period) return null;
    
    try {
        return EMA.calculate({
            values: prices,
            period: period
        }).pop();
    } catch (error) {
        // Fallback para cálculo manual
        return calculateEMA(prices, period);
    }
}

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
        full: `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`,
        timestamp: brasiliaTime.getTime()
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

// 🔵 FUNÇÃO OTIMIZADA: fetch com tratamento de rate limit e retry
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // Verificar rate limit (429 Too Many Requests)
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || 60;
                const waitTime = parseInt(retryAfter) * 1000 + 2000;
                
                logToFile(`⚠️ Rate limit atingido (429). Tentativa ${attempt}/${maxRetries}. Aguardando ${retryAfter}s...`);
                console.log(`⚠️ Rate limit atingido. Aguardando ${retryAfter}s...`);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            return response;
            
        } catch (error) {
            lastError = error;
            
            if (error.name === 'AbortError') {
                logToFile(`⏱️ Timeout na tentativa ${attempt}/${maxRetries}`);
                console.log(`⏱️ Timeout na tentativa ${attempt}/${maxRetries}`);
            } else {
                logToFile(`⚠️ Erro na tentativa ${attempt}/${maxRetries}: ${error.message}`);
            }
            
            // Aguardar antes da próxima tentativa (exponencial backoff)
            if (attempt < maxRetries) {
                const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error(`Falha após ${maxRetries} tentativas`);
}

// Função para verificar conexão
async function checkInternetConnection() {
    try {
        await fetchWithRetry('https://api.binance.com/api/v3/ping', {}, 1);
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

// 🔵 FUNÇÃO MELHORADA: Limpar caches periodicamente
function cleanupCaches() {
    const now = Date.now();
    
    // Limpar candleCache antigo
    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].ts > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });
    
    // Limpar sweeps muito antigos
    Object.keys(recentSweeps).forEach(symbol => {
        if (recentSweeps[symbol].lastBuySweep && 
            now - recentSweeps[symbol].lastBuySweep > MAX_SWEEP_AGE) {
            recentSweeps[symbol].lastBuySweep = null;
            recentSweeps[symbol].buySweepPrice = 0;
        }
        
        if (recentSweeps[symbol].lastSellSweep && 
            now - recentSweeps[symbol].lastSellSweep > MAX_SWEEP_AGE) {
            recentSweeps[symbol].lastSellSweep = null;
            recentSweeps[symbol].sellSweepPrice = 0;
        }
    });
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

// 🔵 NOVA FUNÇÃO: Buscar Funding Rate
async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        
        if (data && data.lastFundingRate !== undefined) {
            const rate = parseFloat(data.lastFundingRate) * 100; // Converter para porcentagem
            
            // Determinar emojis conforme especificação
            let fundingRateEmoji = '';
            if (rate <= -0.2) fundingRateEmoji = '🟢🟢🟢🟢';
            else if (rate <= -0.1) fundingRateEmoji = '🟢🟢🟢';
            else if (rate <= -0.05) fundingRateEmoji = '🟢🟢';
            else if (rate >= 0.1) fundingRateEmoji = '🔴🔴🔴🔴';
            else if (rate >= 0.03) fundingRateEmoji = '🔴🔴🔴';
            else if (rate >= 0.02) fundingRateEmoji = '🔴🔴';
            
            return {
                rate: rate.toFixed(4),
                emoji: fundingRateEmoji,
                raw: rate
            };
        }
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Funding Rate(${symbol}): ${e.message}`);
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null
        };
    }
}

// 🔵 FUNÇÃO OTIMIZADA: Buscar candles com cache e TTL
async function getCandlesCached(symbol, timeframe = '1h', limit = 200) {
    const key = `${symbol}_${timeframe}_${limit}`;
    const now = Date.now();
    
    // Verificar se temos dados em cache válidos
    if (candleCache[key] && now - candleCache[key].ts < CANDLE_CACHE_TTL) {
        return candleCache[key].data;
    }
    
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        const candles = data.map(c => ({
            time: c[0],
            open: +c[1],
            high: +c[2],
            low: +c[3],
            close: +c[4],
            volume: +c[5]
        }));
        
        // Armazenar no cache com timestamp
        candleCache[key] = { data: candles, ts: now };
        return candles;
        
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar candles(${symbol}): ${e.message}`);
        return [];
    }
}

// 🔵 FUNÇÃO MELHORADA: Buscar RSI usando technicalindicators
async function getRSI(symbol, timeframe, period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 50);
        
        if (candles.length < period + 1) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        const closes = candles.map(c => c.close);
        
        // Usar technicalindicators para cálculo mais preciso
        const rsiValues = RSI.calculate({
            values: closes,
            period: period
        });
        
        if (!rsiValues || rsiValues.length === 0) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        return {
            value: currentRSI.toFixed(2),
            timeframe: timeframe,
            raw: currentRSI
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar RSI(${symbol}, ${timeframe}): ${e.message}`);
        return { value: "N/A", timeframe: timeframe, raw: null };
    }
}

// 🔵 FUNÇÃO MELHORADA: Buscar Estocástico usando technicalindicators
async function getStochastic(symbol, timeframe, kPeriod = 5, dPeriod = 3, smooth = 3) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, kPeriod + dPeriod + smooth + 20);
        
        if (candles.length < kPeriod + dPeriod + smooth) {
            return { 
                k: "N/A", 
                d: "N/A", 
                kDirection: "➡️", 
                dDirection: "➡️", 
                timeframe: timeframe 
            };
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Usar technicalindicators para cálculo mais preciso
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: kPeriod,
            signalPeriod: dPeriod
        });
        
        if (!stochValues || stochValues.length === 0) {
            return { 
                k: "N/A", 
                d: "N/A", 
                kDirection: "➡️", 
                dDirection: "➡️", 
                timeframe: timeframe 
            };
        }
        
        const currentStoch = stochValues[stochValues.length - 1];
        const previousStoch = stochValues.length > 1 ? stochValues[stochValues.length - 2] : currentStoch;
        
        const kDirection = currentStoch.k > previousStoch.k ? "⬆️" : 
                          currentStoch.k < previousStoch.k ? "⬇️" : "➡️";
        const dDirection = currentStoch.d > previousStoch.d ? "⬆️" : 
                          currentStoch.d < previousStoch.d ? "⬇️" : "➡️";
        
        return {
            k: currentStoch.k.toFixed(2),
            d: currentStoch.d.toFixed(2),
            kDirection: kDirection,
            dDirection: dDirection,
            timeframe: timeframe,
            rawK: currentStoch.k,
            rawD: currentStoch.d
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Estocástico(${symbol}, ${timeframe}): ${e.message}`);
        return { 
            k: "N/A", 
            d: "N/A", 
            kDirection: "➡️", 
            dDirection: "➡️", 
            timeframe: timeframe,
            rawK: null,
            rawD: null
        };
    }
}

// Função para buscar Long/Short Ratio
async function getLSR(symbol, period = '15m') {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
        const res = await fetchWithRetry(url);
        
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
                period: period,
                raw: lsrRatio
            };
        }
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period,
            raw: null
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar LSR(${symbol}, ${period}): ${e.message}`);
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period,
            raw: null
        };
    }
}

// Função para buscar livro de ordens
async function getOrderBook(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`;
        const res = await fetchWithRetry(url);
        
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

// 🔴 FUNÇÃO MELHORADA: Verificar volume anormal no timeframe de 3 minutos
async function checkAbnormalVolume(symbol, multiplier = 2) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 21);
        
        if (candles.length < 21) {
            logToFile(`⚠️ Dados insuficientes para volume 3m (${symbol})`);
            return { 
                isAbnormal: false, 
                currentVolume: 0, 
                avgVolume: 0, 
                ratio: 0,
                open: 0,
                close: 0,
                high: 0,
                low: 0
            };
        }
        
        // Extrair dados do último candle
        const latestCandle = candles[candles.length - 1];
        const open = latestCandle.open;
        const high = latestCandle.high;
        const low = latestCandle.low;
        const close = latestCandle.close;
        const currentVolume = latestCandle.volume;
        
        // Extrair volumes dos candles anteriores (últimos 20, excluindo o atual)
        const previousVolumes = candles.slice(0, candles.length - 1).map(c => c.volume);
        
        // Calcular média dos volumes anteriores
        const avgVolume = previousVolumes.reduce((sum, vol) => sum + vol, 0) / previousVolumes.length;
        
        // Calcular ratio
        const ratio = avgVolume > 0 ? currentVolume / avgVolume : 0;
        
        // Verificar se é anormal (pelo menos 2x a média)
        const isAbnormal = ratio >= multiplier;
        
        return {
            isAbnormal: isAbnormal,
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: ratio.toFixed(2),
            open: open,
            close: close,
            high: high,
            low: low,
            rawRatio: ratio
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao verificar volume 3m (${symbol}): ${e.message}`);
        return { 
            isAbnormal: false, 
            currentVolume: 0, 
            avgVolume: 0, 
            ratio: 0,
            open: 0,
            close: 0,
            high: 0,
            low: 0,
            rawRatio: 0
        };
    }
}

// 🔴 FUNÇÃO SIMPLIFICADA: Verificar volume anormal (sem verificação de candle)
async function checkVolumeConfirmation(symbol, multiplier = 2) {
    const volumeData = await checkAbnormalVolume(symbol, multiplier);
    
    // Apenas verifica se o volume é anormal (≥ 2x)
    const isVolumeConfirmed = volumeData.isAbnormal;
    
    return {
        isConfirmed: isVolumeConfirmed,
        volumeData: volumeData,
        message: isVolumeConfirmed ? 
            `✅ Volume confirmado (${volumeData.ratio}x)` :
            `❌ Volume não confirmado (ratio: ${volumeData.ratio}x)`
    };
}

// 🔵 FUNÇÃO ATUALIZADA: Buscar EMAs 13, 34 e 55 no timeframe de 3 minutos usando cálculo correto
async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 100);
        
        if (candles.length < 55) {
            logToFile(`⚠️ Dados insuficientes para EMAs 3m (${symbol})`);
            return {
                ema13: "N/A",
                ema34: "N/A",
                ema55: "N/A",
                currentPrice: "N/A",
                isAboveEMA55: false,
                isBelowEMA55: false,
                isEMA13CrossingUp: false,
                isEMA13CrossingDown: false,
                priceFormatted: "N/A",
                ema13Formatted: "N/A",
                ema34Formatted: "N/A",
                ema55Formatted: "N/A"
            };
        }
        
        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];
        
        // 🔴 CALCULAR EMA CORRETAMENTE COM SMA INICIAL
        // Para calcular EMA13, precisamos de pelo menos 13 períodos + dados extras para suavização
        const ema13 = calculateEMATechnical(closes, 13);
        const ema34 = calculateEMATechnical(closes, 34);
        const ema55 = calculateEMATechnical(closes, 55);
        
        // Verificar se os cálculos foram bem-sucedidos
        if (ema13 === null || ema34 === null || ema55 === null) {
            logToFile(`⚠️ Erro ao calcular EMAs para ${symbol}`);
            return {
                ema13: "N/A",
                ema34: "N/A",
                ema55: "N/A",
                currentPrice: "N/A",
                isAboveEMA55: false,
                isBelowEMA55: false,
                isEMA13CrossingUp: false,
                isEMA13CrossingDown: false,
                priceFormatted: "N/A",
                ema13Formatted: "N/A",
                ema34Formatted: "N/A",
                ema55Formatted: "N/A"
            };
        }
        
        // Verificar cruzamento da EMA13 com EMA34
        // Para isso, precisamos calcular EMAs do candle anterior
        const previousCloses = closes.slice(0, -1);
        const previousEma13 = calculateEMATechnical(previousCloses, 13);
        const previousEma34 = calculateEMATechnical(previousCloses, 34);
        
        const isEMA13CrossingUp = previousEma13 !== null && previousEma34 !== null && 
                                 previousEma13 <= previousEma34 && ema13 > ema34;
        const isEMA13CrossingDown = previousEma13 !== null && previousEma34 !== null && 
                                   previousEma13 >= previousEma34 && ema13 < ema34;
        
        // Formatar os valores
        const priceFormatted = formatNumber(currentPrice, symbol, true);
        const ema13Formatted = formatNumber(ema13, symbol, true);
        const ema34Formatted = formatNumber(ema34, symbol, true);
        const ema55Formatted = formatNumber(ema55, symbol, true);
        
        return {
            ema13: ema13,
            ema34: ema34,
            ema55: ema55,
            currentPrice: currentPrice,
            isAboveEMA55: currentPrice > ema55,
            isBelowEMA55: currentPrice < ema55,
            isEMA13CrossingUp: isEMA13CrossingUp,
            isEMA13CrossingDown: isEMA13CrossingDown,
            priceFormatted: priceFormatted,
            ema13Formatted: ema13Formatted,
            ema34Formatted: ema34Formatted,
            ema55Formatted: ema55Formatted
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar EMAs 3m (${symbol}): ${e.message}`);
        return {
            ema13: "N/A",
            ema34: "N/A",
            ema55: "N/A",
            currentPrice: "N/A",
            isAboveEMA55: false,
            isBelowEMA55: false,
            isEMA13CrossingUp: false,
            isEMA13CrossingDown: false,
            priceFormatted: "N/A",
            ema13Formatted: "N/A",
            ema34Formatted: "N/A",
            ema55Formatted: "N/A"
        };
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

// 🔴 NOVA FUNÇÃO: Calcular alvos e stop dinâmico
function calculateTargetsAndStop(entryPrice, isBullish, symbol) {
    const targets = [];
    
    if (isBullish) {
        // Para bull: alvos acima do preço de entrada
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = entryPrice * (1 + percentage / 100);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumber(targetPrice, symbol, true)
            });
        }
        
        // Stop dinâmico para bull: abaixo do preço de entrada
        const stopPrice = entryPrice * (1 - STOP_PERCENTAGE / 100);
        
        return {
            targets: targets,
            stopPrice: stopPrice,
            stopFormatted: formatNumber(stopPrice, symbol, true),
            stopPercentage: STOP_PERCENTAGE
        };
    } else {
        // Para bear: alvos abaixo do preço de entrada
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = entryPrice * (1 - percentage / 100);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumber(targetPrice, symbol, true)
            });
        }
        
        // Stop dinâmico para bear: acima do preço de entrada
        const stopPrice = entryPrice * (1 + STOP_PERCENTAGE / 100);
        
        return {
            targets: targets,
            stopPrice: stopPrice,
            stopFormatted: formatNumber(stopPrice, symbol, true),
            stopPercentage: STOP_PERCENTAGE
        };
    }
}

// 🔵 NOVA FUNÇÃO: Construir mensagem de alerta (remove duplicação)
function buildAlertMessage(isBullish, symbol, priceFormatted, brDateTime, targetsAndStop, 
                          rsi1h, stoch4h, stochDaily, lsrData, fundingRate, 
                          volumeCheck, orderBook, sweepTime, emas3mData) {
    
    const title = isBullish ? '🟢 <b>🤖 COMPRA  </b>' : '🔴 <b>🤖 CORREÇÃO </b>';
    const trend = isBullish ? '🟢Tendência 💹 ema 55 1h' : '🔴Tendência 📉 ema 55 1h';
    const sweepMinutes = sweepTime ? Math.round((Date.now() - sweepTime) / 60000) : 0;
    
    let message = `${title}\n`;
    message += `⏰<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n`;
    message += `<b>#Ativo:</b> #${symbol}\n`;
    message += `<b>$Preço:</b> $${priceFormatted}\n`;
    message += `<b>Entr:</b> $${priceFormatted}\n`;
    message += `<b>Stop:</b> $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n`;
    message += `<b>Alvos:</b>\n`;
    
    // Adicionar alvos
    targetsAndStop.targets.forEach((target, index) => {
        message += isBullish ? 
            ` Alvo ${index + 1} : $${target.formatted}\n` :
            ` Alvo ${index + 1}: $${target.formatted}\n`;
    });
    
    // Adicionar indicadores
    if (isBullish) {
        message += ` ${trend}\n`;
    }
    
    message += ` #RSI 1h: <b>${rsi1h.value}</b>\n`;
    message += ` #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n`;
    message += ` #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n`;
    message += ` #LSR : <b>${lsrData.lsrRatio}</b> ${getLsrSymbol(lsrData.lsrRatio)}\n`;
    message += ` #Fund.R: ${fundingRate.emoji} <b>${fundingRate.rate}%</b>\n`;
    message += ` Vol 3m: <b>${volumeCheck.volumeData.ratio}x</b>\n`;
    message += ` Liquidez Cap: ${sweepMinutes} minutos\n`;
    message += ` Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n`;
    message += ` Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n`;
    message += `        <b>SMC Tecnology by @J4Rviz</b>`;
    
    return message;
}

// Função para determinar o símbolo do LSR com base no valor
function getLsrSymbol(lsrValue) {
    if (lsrValue === null || lsrValue === "N/A") return '🔘Consol.';
    const value = parseFloat(lsrValue);
    return value <= 1.4 ? '✅Baixo' : value >= 2.8 ? '📛Alto' : '🔘Consol.';
}

// Inicializar cooldown para cada ativo
function initAlertsCooldown() {
    SYMBOLS.forEach(symbol => {
        alertsCooldown[symbol] = {
            lastBuyConfirmation: 0,
            lastSellConfirmation: 0
        };
        recentSweeps[symbol] = {
            lastBuySweep: null,
            lastSellSweep: null,
            buySweepPrice: 0,
            sellSweepPrice: 0
        };
    });
}

// 🔵 FUNÇÃO MODIFICADA: Apenas detectar sweeps (sem enviar alertas)
async function detectSweeps(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 100);
        if (candles.length < 100) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        const currentIndex = candles.length - 1;
        const price = closes[currentIndex];

        let buySweepDetected = false;
        let sellSweepDetected = false;
        let fractalLevel = 0;

        // Sweep BEAR - para detecção apenas
        if (isDnFractal(highs, currentIndex - N)) {
            fractalLevel = highs[currentIndex - N];
            if (price > fractalLevel) {
                sellSweepDetected = true;
            }
        }

        // Sweep BULL - para detecção apenas
        if (isUpFractal(lows, currentIndex - N)) {
            fractalLevel = lows[currentIndex - N];
            if (price < fractalLevel) {
                buySweepDetected = true;
            }
        }

        // 🔴 VERIFICAÇÃO DE CRITÉRIOS PARA SWEEP
        if (buySweepDetected || sellSweepDetected) {
            // Verificar volume anormal no 3m 
            const volumeCheck = await checkAbnormalVolume(symbol, 2);
            
            // Se não passar nos critérios, não armazenar
            if (!volumeCheck.isAbnormal) {
                return null;
            }

            // Armazenar informação do sweep para possível confirmação
            const now = Date.now();
            if (buySweepDetected) {
                recentSweeps[symbol].lastBuySweep = now;
                recentSweeps[symbol].buySweepPrice = price;
                logToFile(`✅ Sweep Compra detectado para ${symbol} - Preço: $${price} - Volume: ${volumeCheck.ratio}x`);
            } else if (sellSweepDetected) {
                recentSweeps[symbol].lastSellSweep = now;
                recentSweeps[symbol].sellSweepPrice = price;
                logToFile(`✅ Sweep Venda detectado para ${symbol} - Preço: $${price} - Volume: ${volumeCheck.ratio}x`);
            }
            
            return {
                symbol: symbol,
                sweepType: buySweepDetected ? 'Compra' : 'Venda',
                price: price,
                volumeRatio: volumeCheck.ratio,
                timestamp: now
            };
        }
        
        return null;
    } catch (e) {
        logToFile(`❌ Erro ao detectar sweep ${symbol}: ${e.message}`);
        return null;
    }
}

// 🔵 FUNÇÃO ATUALIZADA: Monitorar confirmações de reversão via EMA 13, 34 e 55 3m
async function monitorConfirmation(symbol) {
    try {
        // Verificar se houve um sweep recente (últimas 6 horas)
        const now = Date.now();
        const sixHoursAgo = now - MAX_SWEEP_AGE;
        
        const hadBuySweep = recentSweeps[symbol].lastBuySweep && 
                           recentSweeps[symbol].lastBuySweep > sixHoursAgo;
        const hadSellSweep = recentSweeps[symbol].lastSellSweep && 
                            recentSweeps[symbol].lastSellSweep > sixHoursAgo;
        
        if (!hadBuySweep && !hadSellSweep) {
            return null; // Não houve sweep recente
        }
        
        // Obter dados das EMAs 13, 34 e 55 no timeframe de 3 minutos
        const emas3mData = await getEMAs3m(symbol);
        
        if (emas3mData.ema55 === "N/A" || emas3mData.ema13 === "N/A" || emas3mData.ema34 === "N/A") {
            return null;
        }
        
        // Buscar RSI 1h para verificar critérios
        const rsi1h = await getRSI(symbol, '1h');
        const rsiValue = parseFloat(rsi1h.value);
        
        // 🔵 ADICIONAR FUNDING RATE
        const fundingRate = await getFundingRate(symbol);
        
        const brDateTime = getBrazilianDateTime();
        const priceFormatted = formatNumber(emas3mData.currentPrice, symbol, true);
        
        let confirmationAlert = null;
        
        // 🔵 CONFIRMAÇÃO BULL: 
        // 1. EMA 13 cruzando para cima a EMA 34 no 3m
        // 2. Preço fechando acima da EMA 55 no 3m
        // 3. Após sweep de compra
        if (hadBuySweep && emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
            // 🔴 CRITÉRIO: RSI 1h deve ser menor que 60
            if (rsiValue >= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // Verificar se passa nos novos critérios
            if (!volumeCheck.isConfirmed) {
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastBuyConfirmation > COOLDOWN) {
                // Buscar dados adicionais para a mensagem
                const [lsrData, orderBook, stoch4h, stochDaily] = await Promise.all([
                    getLSR(symbol, '15m'),
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d')
                ]);
                
                // Calcular alvos e stop dinâmico
                const targetsAndStop = calculateTargetsAndStop(emas3mData.currentPrice, true, symbol);
                
                // 🔵 USAR FUNÇÃO buildAlertMessage PARA REMOVER DUPLICAÇÃO
                const msg = buildAlertMessage(
                    true, // isBullish
                    symbol,
                    priceFormatted,
                    brDateTime,
                    targetsAndStop,
                    rsi1h,
                    stoch4h,
                    stochDaily,
                    lsrData,
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastBuySweep,
                    emas3mData
                );
                
                confirmationAlert = {
                    symbol: symbol,
                    signal: 'Confirmação Bull',
                    message: msg,
                    price: emas3mData.currentPrice,
                    brDateTime: brDateTime,
                    priceFormatted: priceFormatted,
                    targetsAndStop: targetsAndStop,
                    volumeConfirmation: volumeCheck,
                    emas3mData: emas3mData
                };
                
                alertsCooldown[symbol].lastBuyConfirmation = now;
            }
        }
        
        // 🔴 CONFIRMAÇÃO BEAR:
        // 1. EMA 13 cruzando para baixo a EMA 34 no 3m
        // 2. Preço fechando abaixo da EMA 55 no 3m
        // 3. Após sweep de venda
        if (hadSellSweep && emas3mData.isBelowEMA55 && emas3mData.isEMA13CrossingDown) {
            // 🔴 CRITÉRIO: RSI 1h deve ser maior que 60
            if (rsiValue <= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // Verificar se passa nos novos critérios
            if (!volumeCheck.isConfirmed) {
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastSellConfirmation > COOLDOWN) {
                // Buscar dados adicionais para a mensagem
                const [lsrData, orderBook, stoch4h, stochDaily] = await Promise.all([
                    getLSR(symbol, '15m'),
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d')
                ]);
                
                // Calcular alvos e stop dinâmico
                const targetsAndStop = calculateTargetsAndStop(emas3mData.currentPrice, false, symbol);
                
                // 🔵 USAR FUNÇÃO buildAlertMessage PARA REMOVER DUPLICAÇÃO
                const msg = buildAlertMessage(
                    false, // isBullish
                    symbol,
                    priceFormatted,
                    brDateTime,
                    targetsAndStop,
                    rsi1h,
                    stoch4h,
                    stochDaily,
                    lsrData,
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastSellSweep,
                    emas3mData
                );
                
                confirmationAlert = {
                    symbol: symbol,
                    signal: 'Confirmação Bear',
                    message: msg,
                    price: emas3mData.currentPrice,
                    brDateTime: brDateTime,
                    priceFormatted: priceFormatted,
                    targetsAndStop: targetsAndStop,
                    volumeConfirmation: volumeCheck,
                    emas3mData: emas3mData
                };
                
                alertsCooldown[symbol].lastSellConfirmation = now;
            }
        }
        
        return confirmationAlert;
        
    } catch (e) {
        logToFile(`❌ Erro ao monitorar confirmação ${symbol}: ${e.message}`);
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
            const lastBuyConf1 = alertsCooldown[symbol1].lastBuyConfirmation;
            const lastSellConf1 = alertsCooldown[symbol1].lastSellConfirmation;
            
            const buyConfCooldown1 = lastBuyConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf1)) : 0;
            const sellConfCooldown1 = lastSellConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf1)) : 0;
            
            const buyConfStatus1 = buyConfCooldown1 > 0 ? `⏳${Math.round(buyConfCooldown1/60000)}m` : '✅';
            const sellConfStatus1 = sellConfCooldown1 > 0 ? `⏳${Math.round(sellConfCooldown1/60000)}m` : '✅';
            
            const hadBuySweep1 = recentSweeps[symbol1].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep1 = recentSweeps[symbol1].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol1.padEnd(10)} S:${hadBuySweep1}/${hadSellSweep1} | C-B:${buyConfStatus1} C-V:${sellConfStatus1} | `;
        }
        
        // Coluna 2
        if (i + symbolsPerColumn < SYMBOLS.length) {
            const symbol2 = SYMBOLS[i + symbolsPerColumn];
            const lastBuyConf2 = alertsCooldown[symbol2].lastBuyConfirmation;
            const lastSellConf2 = alertsCooldown[symbol2].lastSellConfirmation;
            
            const buyConfCooldown2 = lastBuyConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf2)) : 0;
            const sellConfCooldown2 = lastSellConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf2)) : 0;
            
            const buyConfStatus2 = buyConfCooldown2 > 0 ? `⏳${Math.round(buyConfCooldown2/60000)}m` : '✅';
            const sellConfStatus2 = sellConfCooldown2 > 0 ? `⏳${Math.round(sellConfCooldown2/60000)}m` : '✅';
            
            const hadBuySweep2 = recentSweeps[symbol2].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep2 = recentSweeps[symbol2].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol2.padEnd(10)} S:${hadBuySweep2}/${hadSellSweep2} | C-B:${buyConfStatus2} C-V:${sellConfStatus2} | `;
        }
        
        // Coluna 3
        if (i + symbolsPerColumn * 2 < SYMBOLS.length) {
            const symbol3 = SYMBOLS[i + symbolsPerColumn * 2];
            const lastBuyConf3 = alertsCooldown[symbol3].lastBuyConfirmation;
            const lastSellConf3 = alertsCooldown[symbol3].lastSellConfirmation;
            
            const buyConfCooldown3 = lastBuyConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf3)) : 0;
            const sellConfCooldown3 = lastSellConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf3)) : 0;
            
            const buyConfStatus3 = buyConfCooldown3 > 0 ? `⏳${Math.round(buyConfCooldown3/60000)}m` : '✅';
            const sellConfStatus3 = sellConfCooldown3 > 0 ? `⏳${Math.round(sellConfCooldown3/60000)}m` : '✅';
            
            const hadBuySweep3 = recentSweeps[symbol3].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep3 = recentSweeps[symbol3].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol3.padEnd(10)} S:${hadBuySweep3}/${hadSellSweep3} | C-B:${buyConfStatus3} C-V:${sellConfStatus3}`;
        }
        
        status += line + "\n";
    }
    
    status += "=".repeat(50) + "\n";
    status += "Legenda: S=Sweep (🟢=Compra, 🔴=Venda, ⚪=Nenhum), C-B=Confirmação Bull, C-V=Confirmação Bear\n";
    status += "✅=Pronto, ⏳=Cooldown (minutos)\n";
    console.log(status);
}

// 🔵 FUNÇÃO OTIMIZADA: Processar múltiplos ativos em paralelo
async function processBatch(batch, processFunction) {
    const results = await Promise.allSettled(
        batch.map(symbol => processFunction(symbol))
    );
    
    const alerts = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            alerts.push(result.value);
        } else if (result.status === 'rejected') {
            const symbol = batch[index];
            logToFile(`❌ Erro no processamento de ${symbol}: ${result.reason.message}`);
        }
    });
    
    return alerts;
}

// Loop principal do bot OTIMIZADO
async function mainBotLoop() {
    // Inicializar sistema de cooldown
    initAlertsCooldown();
    
    const initMsg = '\n' +
        '='.repeat(50) + '\n' +
        ' 🤖 BOT DE CONFIRMAÇÕES SMC 1H INICIADO\n' +
        ` 📊 MONITORANDO ${SYMBOLS.length} ATIVOS\n` +
        ` ⚡ PROCESSAMENTO EM LOTE (${BATCH_SIZE} ATIVOS EM PARALELO)\n` +
        ` 🚫 ALERTAS DE SWEEP DESATIVADOS\n` +
        ` ✅ APENAS CONFIRMAÇÕES BULL/BEAR\n` +
        '='.repeat(50) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot iniciado - Monitorando ${SYMBOLS.length} ativos (apenas confirmações)`);
    
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
    
    // Mostrar configuração de alvos e stop
    console.log('🎯 CONFIGURAÇÃO DE ALVOS E STOP:');
    console.log('='.repeat(60));
    console.log(`Alvos: ${TARGET_PERCENTAGES.map(p => p + '%').join(', ')}`);
    console.log(`Stop Dinâmico: ${STOP_PERCENTAGE}%`);
    console.log('Critérios Confirmação Bull:');
    console.log('  - Sweep de compra detectado (1H)');
    console.log('  - EMA 13 cruzando para cima EMA 34 (3m)');
    console.log('  - Preço acima EMA 55 (3m)');
    console.log('  - RSI 1h < 60');
    console.log('  - Volume anormal (2x média)');
    console.log('Critérios Confirmação Bear:');
    console.log('  - Sweep de venda detectado (1H)');
    console.log('  - EMA 13 cruzando para baixo EMA 34 (3m)');
    console.log('  - Preço abaixo EMA 55 (3m)');
    console.log('  - RSI 1h > 60');
    console.log('  - Volume anormal (2x média)');
    console.log('='.repeat(60) + '\n');
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>SMC Confirmation Bot (Versão Limpa)</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `📊 Monitorando ${SYMBOLS.length} ativos\n` +
                    `⚡ Apenas alertas de confirmação\n` +
                    `🚫 Alertas de sweep desativados\n` +
                    `✅ Canal mais limpo e focado\n` +
                    `🎯 4 alvos + stop dinâmico\n` +
                    `by @J4Rviz.`);

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

            let sweepsDetected = 0;
            let confirmationAlertsSent = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            
            // 🔵 PROCESSAR DETECÇÃO DE SWEEPS (SILENCIOSA)
            console.log('🔍 Detectando sweeps (sem alertas)...');
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchResults = await processBatch(batch, detectSweeps);
                
                sweepsDetected += batchResults.length;
                
                // Pequena pausa entre lotes
                if (i + BATCH_SIZE < SYMBOLS.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            
            // 🔵 PROCESSAR CONFIRMAÇÕES EM LOTES
            console.log('\n🔍 Verificando confirmações de reversão...');
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchAlerts = await processBatch(batch, monitorConfirmation);
                
                // Enviar alertas do batch
                for (const alert of batchAlerts) {
                    console.log(`\n✅ CONFIRMAÇÃO DETECTADA PARA ${alert.symbol}!`);
                    console.log(`📊 ${alert.signal} - Preço: $${alert.priceFormatted}`);
                    console.log(`📈 EMA 13/34: ${alert.emas3mData.isEMA13CrossingUp ? 'Cruzamento Bull' : 'Cruzamento Bear'}`);
                    console.log(`📈 Volume: ${alert.volumeConfirmation.volumeData.ratio}x`);
                    console.log(`🎯 4 Alvos + Stop Dinâmico calculados`);
                    logToFile(`ALERTA CONFIRMAÇÃO ${alert.signal} - ${alert.symbol} - Preço: $${alert.price} - Volume: ${alert.volumeConfirmation.volumeData.ratio}x`);
                    
                    await sendAlert(alert.message);
                    
                    confirmationAlertsSent++;
                    
                    // Pequena pausa entre alertas para não sobrecarregar
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                // Pequena pausa entre lotes
                if (i + BATCH_SIZE < SYMBOLS.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (sweepsDetected > 0) {
                console.log(`\n🔍 ${sweepsDetected} sweep(s) detectado(s) (sem alerta)`);
            }
            if (confirmationAlertsSent > 0) {
                console.log(`📊 Total de ${confirmationAlertsSent} alerta(s) de CONFIRMAÇÃO enviado(s) nesta verificação`);
            }
            if (sweepsDetected === 0 && confirmationAlertsSent === 0) {
                console.log(' ✓ Nenhuma confirmação detectada');
            }

            // 🔵 LIMPEZA AGREGADA DE CACHES E SWEEPS
            cleanupCaches();
            
            // Mostrar status a cada 10 ciclos
            if (cycleCount % 10 === 0) {
                showMonitoringStatus();
            }

            consecutiveErrors = 0;
            
            console.log(`\n⏱️  Próxima verificação em 60 segundos...`);
            
            // Verificação a cada 1 minuto
            await new Promise(r => setTimeout(r, 60000));

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
        
        console.log('🔄 Reiniciando bot em 60 segundos...');
        logToFile('🔄 Reiniciando bot em 60 segundos...');
        
        await new Promise(r => setTimeout(r, 30000));
        await startBot();
    }
}

// Iniciar o bot
console.log('\n' + '='.repeat(60));
console.log('🤖 BOT DE CONFIRMAÇÕES SMC 1H (VERSÃO LIMPA)');
console.log('📈 Monitorando 55 ativos da Binance');
console.log('🔧 Configuração SMC - Canal Limpo');
console.log('⚡ OTIMIZAÇÕES IMPLEMENTADAS:');
console.log('   1. Cálculo EMA correto (SMA inicial + fórmula)');
console.log('   2. technicalindicators para RSI e Estocástico');
console.log('   3. Gerenciamento de memória otimizado');
console.log('   4. Função buildAlertMessage para remover duplicação');
console.log('   5. Cache com TTL e limpeza automática');
console.log('🚫 SISTEMA DE ALERTAS:');
console.log('   - Sweeps detectados mas sem alertas');
console.log('   - Apenas alertas de confirmação BULL/BEAR');
console.log('🎯 4 ALVOS + STOP DINÂMICO INCLUÍDOS');
console.log('💰 FUNDING RATE COM EMOJIS ADICIONADO');
console.log('='.repeat(60) + '\n');

// Instalar dependência se necessário
try {
    require('technicalindicators');
} catch (e) {
    console.log('⚠️ technicalindicators n');
    process.exit(1);
}

startBot();
