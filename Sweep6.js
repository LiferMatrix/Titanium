const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J5O';
const TELEGRAM_CHAT_ID   = '-100255';


// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// 🔵 ATIVOS PARA MONITORAR 
const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'XRPUSDT', 'NEARUSDT',
    'ATOMUSDT', 'AVAXUSDT', 'DOTUSDT', 'BCHUSDT', 'SUIUSDT',
    'AXSUSDT', 'AAVEUSDT', 'STGUSDT', 'COTIUSDT', 'API3USDT',
    '1000PEPEUSDT', '1000SHIBUSDT', 'GMXUSDT', 'HBARUSDT', '1000BONKUSDT',
    'SEIUSDT', 'BNBUSDT', 'SOLUSDT', 'UNIUSDT', 'GALAUSDT',
    'CHZUSDT', 'IOTAUSDT', 'ARBUSDT', 'BANDUSDT', 'C98USDT',
    'IOSTUSDT', 'LDOUSDT', 'ICPUSDT', 'ENAUSDT', 'DYDXUSDT',
    'SKLUSDT', 'TIAUSDT', 'VETUSDT', 'WLDUSDT', 'ZKUSDT',
    'BTCDOMUSDT', 'USDCUSDT', '1000FLOKIUSDT', 'MASKUSDT', 'THETAUSDT',
    'LINKUSDT', 'APTUSDT', 'ARUSDT', 'ONDOUSDT', 'VIRTUALUSDT',
    'OPUSDT', 'TRBUSDT', 'POLUSDT', 'ETCUSDT', 'HOTUSDT',
    'FETUSDT', 'GMTUSDT', 'GRTUSDT', 'CKBUSDT', 'LTCUSDT',
    'SUSHIUSDT', '1INCHUSDT', 'MANAUSDT', 'SANDUSDT', 'ENJUSDT',
    'INJUSDT', 'RUNEUSDT', 'ONEUSDT', 'APEUSDT', 'FILUSDT'
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

// Configuração de casas decimais por ativo
const DECIMALS_CONFIG = {
    'BTCUSDT': 2,      
    'ETHUSDT': 2,      
    'ADAUSDT': 5,      
    'XRPUSDT': 4,      
    'NEARUSDT': 4,     
    'ATOMUSDT': 3,     
    'AVAXUSDT': 3,    
    'DOTUSDT': 3,      
    'BCHUSDT': 2,      
    'SUIUSDT': 4,     
    'AXSUSDT': 4,    
    'AAVEUSDT': 4,     
    'STGUSDT': 4,     
    'COTIUSDT': 5,    
    'API3USDT': 4,      
    '1000PEPEUSDT': 6,
    '1000SHIBUSDT': 6,
    'GMXUSDT': 4,    
    'HBARUSDT': 4,   
    '1000BONKUSDT': 6,
    'SEIUSDT': 5,     
    'BNBUSDT': 2,     
    'SOLUSDT': 3,      
    'UNIUSDT': 3,      
    'GALAUSDT': 5,     
    'CHZUSDT': 5,     
    'IOTAUSDT': 5,     
    'ARBUSDT': 3,   
    'BANDUSDT': 5,
    'C98USDT': 5,     
    'IOSTUSDT': 5,
    'LDOUSDT': 5, 
    'ICPUSDT': 5,
    'ENAUSDT': 5,      
    'DYDXUSDT': 5,     
    'SKLUSDT': 5,      
    'TIAUSDT': 5,
    'VETUSDT': 5,
    'WLDUSDT': 5,    
    'ZKUSDT': 5,     
    'BTCDOMUSDT': 5, 
    'USDCUSDT': 6,
    '1000FLOKIUSDT': 6,
    'MASKUSDT': 5,
    'THETAUSDT': 5,    
    'LINKUSDT': 4,    
    'APTUSDT': 4,      
    'ARUSDT': 3,   
    'ONDOUSDT': 4,    
    'VIRTUALUSDT': 4,     
    'OPUSDT': 5,    
    'TRBUSDT': 5,
    'POLUSDT': 5,  
    'ETCUSDT': 5,     
    'HOTUSDT': 5,
    'FETUSDT': 5,
    'GMTUSDT': 5,  
    'GRTUSDT': 5,     
    'CKBUSDT': 5,
    'LTCUSDT': 5,
    'SUSHIUSDT': 4,   
    '1INCHUSDT': 4,    
    'MANAUSDT': 4,    
    'SANDUSDT': 4,   
    'ENJUSDT': 4,      
    'INJUSDT': 3,      
    'RUNEUSDT': 3,     
    'ONEUSDT': 5,
    'APEUSDT': 4,      
    'FILUSDT': 4
};

// Default se não encontrado
const DEFAULT_DECIMALS = 4;

// Configurações para alvos e stop
const TARGET_PERCENTAGES = [1.0, 2.0, 3.0, 4.0]; 
const STOP_PERCENTAGE = 1.0; 

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

// Função para calcular EMA
function calculateEMA(data, period) {
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b) / period;
    
    for (let i = period; i < data.length; i++) {
        ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
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
            close: +c[4],
            volume: +c[5]
        }));
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar candles(${symbol}): ${e.message}`);
        return [];
    }
}

// 🔴 FUNÇÃO MELHORADA: Verificar volume anormal no timeframe de 3 minutos
async function checkAbnormalVolume(symbol, multiplier = 2) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&limit=21`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        
        if (data.length < 21) {
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
        const latestCandle = data[data.length - 1];
        const open = +latestCandle[1];
        const high = +latestCandle[2];
        const low = +latestCandle[3];
        const close = +latestCandle[4];
        const currentVolume = +latestCandle[5];
        
        // Extrair volumes dos candles anteriores (últimos 20, excluindo o atual)
        const previousVolumes = data.slice(0, data.length - 1).map(c => +c[5]);
        
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
            low: low
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
            low: 0
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

// 🔵 FUNÇÃO ATUALIZADA: Buscar EMAs 13, 34 e 55 no timeframe de 3 minutos e verificar cruzamento
async function getEMAs3m(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&limit=100`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data = await res.json();
        
        if (data.length < 55) {
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
        
        const closes = data.map(c => +c[4]);
        const currentPrice = closes[closes.length - 1];
        
        // Calcular EMAs
        const ema13 = calculateEMA(closes.slice(-50), 13); // Usar últimos 50 candles para EMA13
        const ema34 = calculateEMA(closes.slice(-50), 34); // Usar últimos 50 candles para EMA34
        const ema55 = calculateEMA(closes, 55);
        
        // Verificar cruzamento da EMA13 com EMA34
        const previousCloses = data.slice(-55, -1).map(c => +c[4]); // Excluir o último candle
        const previousEma13 = calculateEMA(previousCloses.slice(-49), 13); // EMA13 anterior
        const previousEma34 = calculateEMA(previousCloses.slice(-49), 34); // EMA34 anterior
        
        const isEMA13CrossingUp = previousEma13 <= previousEma34 && ema13 > ema34;
        const isEMA13CrossingDown = previousEma13 >= previousEma34 && ema13 < ema34;
        
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

// Função para verificar tendência EMA 55
function checkEMATrend(price, ema55) {
    if (price > ema55) {
        return "🟢Tendência 💹 ema 55 1h";
    } else {
        return "🔴Tendência 📉 ema 55 1h";
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

// Inicializar cooldown para cada ativo
function initAlertsCooldown() {
    SYMBOLS.forEach(symbol => {
        alertsCooldown[symbol] = {
            lastBuyAlert: 0,
            lastSellAlert: 0,
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

// Função para monitorar um ativo específico - ALERTAS DE SWEEP
async function monitorSymbolSweep(symbol) {
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

        // Calcular EMA 55
        const ema55 = calculateEMA(closes.slice(-100), 55);
        const emaTrend = checkEMATrend(price, ema55);

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

        // 🔴 ADICIONAR VERIFICAÇÕES DOS NOVOS CRITÉRIOS
        if (buySignal || sellSignal) {
            // Verificar volume anormal no 3m 
            const volumeCheck = await checkAbnormalVolume(symbol, 2);
            
            // Se não passar nos novos critérios, não enviar alerta
            if (!volumeCheck.isAbnormal) {
                logToFile(`⚠️ ${symbol}: Sinal de SWEEP ignorado - Volume: ${volumeCheck.ratio}x (req: 2x)`);
                return null;
            }

            // Buscar dados adicionais
            const [lsrData, orderBook, rsi1h, stoch4h, stochDaily] = await Promise.all([
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
            
            // 🔴 Alerta
            const msg = `${emoji}<b>🤖 IA SMC Automatic</b>\n` +
                       ` <b>${sellSignal ? '📛Resistência/ FVG Bear' : '💹Suporte/ Aguardar Reversão'}</b>\n` +
                       `⏰<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                       ` <b>#Ativo:</b> #${symbol}\n` +
                       ` <b>Preço:</b> $${priceFormatted}\n` +
                       ` <b>${emaTrend}</b>\n` +
                       `• #RSI 1h: <b>${rsi1h.value}</b>\n` +
                       `• #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n` +
                       `• #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n` +
                       `• #LSR : <b>${lsrData.lsrRatio}</b>\n` +
                       `• Vol 3m: <b>${volumeCheck.ratio}x</b>\n` +
                       ` <b>Livro de Ordens:</b>\n` +
                       `• Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n` +
                       `• Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n` +
                       `              <b>SMC Tecnology by @J4Rviz</b>`;
            
            // Armazenar informação do sweep para possível confirmação
            if (buySignal) {
                recentSweeps[symbol].lastBuySweep = Date.now();
                recentSweeps[symbol].buySweepPrice = price;
            } else if (sellSignal) {
                recentSweeps[symbol].lastSellSweep = Date.now();
                recentSweeps[symbol].sellSweepPrice = price;
            }
            
            return {
                symbol: symbol,
                signal: signalType,
                message: msg,
                price: price,
                fractalLevel: fractalLevel,
                brDateTime: brDateTime,
                priceFormatted: priceFormatted,
                fractalLevelFormatted: fractalLevelFormatted,
                volumeInfo: volumeCheck
            };
        }
        
        return null;
    } catch (e) {
        logToFile(`❌ Erro ao monitorar sweep ${symbol}: ${e.message}`);
        return null;
    }
}

// 🔵 FUNÇÃO ATUALIZADA: Monitorar confirmações de reversão via EMA 13, 34 e 55 3m
async function monitorConfirmation(symbol) {
    try {
        // Verificar se houve um sweep recente (últimas 6 horas)
        const now = Date.now();
        const sixHoursAgo = now - (6 * 60 * 60 * 1000);
        
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
        
        const brDateTime = getBrazilianDateTime();
        const priceFormatted = formatNumber(emas3mData.currentPrice, symbol, true);
        
        let confirmationAlert = null;
        
        // 🔵 CONFIRMAÇÃO BULL: 
        // 1. EMA 13 cruzando para cima a EMA 34 no 3m
        // 2. Preço fechando acima da EMA 55 no 3m
        // 3. Após sweep de compra
        if (hadBuySweep && emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
            // 🔴 CRITÉRIO: RSI 1h deve ser menor que 60
            if (rsiValue >= 60) {
                logToFile(`⚠️ ${symbol}: Confirmação Bull ignorada - RSI 1h (${rsiValue}) >= 60`);
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // Verificar se passa nos novos critérios
            if (!volumeCheck.isConfirmed) {
                logToFile(`⚠️ ${symbol}: Confirmação Bull ignorada - ${volumeCheck.message}`);
                return null;
            }
            
            const now = Date.now();
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
                
                const msg = `🟢 <b>🤖 COMPRA  </b>\n` +
                           `⏰<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                           ` <b>#Ativo:</b> #${symbol}\n` +
                           ` <b>Preço:</b> $${priceFormatted}\n` +
                           ` <b>Entr:</b> $${priceFormatted}\n` +
                           ` <b>Stop:</b> $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n` +
                           ` <b>Alvos:</b>\n` +
                           `• Alvo 1 : $${targetsAndStop.targets[0].formatted}\n` +
                           `• Alvo 2 : $${targetsAndStop.targets[1].formatted}\n` +
                           `• Alvo 3 : $${targetsAndStop.targets[2].formatted}\n` +
                           `• Alvo 4 : $${targetsAndStop.targets[3].formatted}\n` +
                           `• #RSI 1h: <b>${rsi1h.value}</b>\n` +
                           `• #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n` +
                           `• #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n` +
                           `• #LSR : <b>${lsrData.lsrRatio}</b>\n` +
                           `• Vol 3m: <b>${volumeCheck.volumeData.ratio}x</b>\n` +
                           `• Liquidez Cap: ${Math.round((now - recentSweeps[symbol].lastBuySweep) / 60000)} minutos\n` +
                           `• Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n` +
                           `• Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n` +
                           `        <b>SMC Tecnology by @J4Rviz</b>`;
                
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
            if (rsiValue <= 60) {
                logToFile(`⚠️ ${symbol}: Confirmação Bear ignorada - RSI 1h (${rsiValue}) <= 60`);
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // Verificar se passa nos novos critérios
            if (!volumeCheck.isConfirmed) {
                logToFile(`⚠️ ${symbol}: Confirmação Bear ignorada - ${volumeCheck.message}`);
                return null;
            }
            
            const now = Date.now();
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
                
                const msg = `🔴 <b>🤖 CORREÇÃO </b>\n` +
                           `⏰<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                           ` <b>#Ativo:</b> #${symbol}\n` +
                           ` <b>Preço:</b> $${priceFormatted}\n` +
                           ` <b>Entr:</b> $${priceFormatted}\n` +
                           ` <b>Stop:</b> $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n` +
                           ` <b>Alvos:</b>\n` +
                           `• Alvo 1: $${targetsAndStop.targets[0].formatted}\n` +
                           `• Alvo 2: $${targetsAndStop.targets[1].formatted}\n` +
                           `• Alvo 3: $${targetsAndStop.targets[2].formatted}\n` +
                           `• Alvo 4: $${targetsAndStop.targets[3].formatted}\n` +
                           `• #RSI 1h: <b>${rsi1h.value}</b> \n` +
                           `• #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n` +
                           `• #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n` +
                           `• #LSR : <b>${lsrData.lsrRatio}</b>\n` +
                           `• Vol 3m: <b>${volumeCheck.volumeData.ratio}x</b> \n` +
                           `• Liquidez Cap: ${Math.round((now - recentSweeps[symbol].lastSellSweep) / 60000)} minutos\n` +
                           `• Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n` +
                           `• Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n` +
                           `       <b>SMC Tecnology by @J4Rviz</b>`;
            
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
            const lastBuy1 = alertsCooldown[symbol1].lastBuyAlert;
            const lastSell1 = alertsCooldown[symbol1].lastSellAlert;
            const lastBuyConf1 = alertsCooldown[symbol1].lastBuyConfirmation;
            const lastSellConf1 = alertsCooldown[symbol1].lastSellConfirmation;
            
            const buyCooldown1 = lastBuy1 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy1)) : 0;
            const sellCooldown1 = lastSell1 > 0 ? Math.max(0, COOLDOWN - (now - lastSell1)) : 0;
            const buyConfCooldown1 = lastBuyConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf1)) : 0;
            const sellConfCooldown1 = lastSellConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf1)) : 0;
            
            const buyStatus1 = buyCooldown1 > 0 ? `⏳${Math.round(buyCooldown1/60000)}m` : '✅';
            const sellStatus1 = sellCooldown1 > 0 ? `⏳${Math.round(sellCooldown1/60000)}m` : '✅';
            const buyConfStatus1 = buyConfCooldown1 > 0 ? `⏳${Math.round(buyConfCooldown1/60000)}m` : '✅';
            const sellConfStatus1 = sellConfCooldown1 > 0 ? `⏳${Math.round(sellConfCooldown1/60000)}m` : '✅';
            
            line += `${symbol1.padEnd(10)} S-C:${buyStatus1} S-V:${sellStatus1} | C-B:${buyConfStatus1} C-V:${sellConfStatus1} | `;
        }
        
        // Coluna 2
        if (i + symbolsPerColumn < SYMBOLS.length) {
            const symbol2 = SYMBOLS[i + symbolsPerColumn];
            const lastBuy2 = alertsCooldown[symbol2].lastBuyAlert;
            const lastSell2 = alertsCooldown[symbol2].lastSellAlert;
            const lastBuyConf2 = alertsCooldown[symbol2].lastBuyConfirmation;
            const lastSellConf2 = alertsCooldown[symbol2].lastSellConfirmation;
            
            const buyCooldown2 = lastBuy2 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy2)) : 0;
            const sellCooldown2 = lastSell2 > 0 ? Math.max(0, COOLDOWN - (now - lastSell2)) : 0;
            const buyConfCooldown2 = lastBuyConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf2)) : 0;
            const sellConfCooldown2 = lastSellConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf2)) : 0;
            
            const buyStatus2 = buyCooldown2 > 0 ? `⏳${Math.round(buyCooldown2/60000)}m` : '✅';
            const sellStatus2 = sellCooldown2 > 0 ? `⏳${Math.round(sellCooldown2/60000)}m` : '✅';
            const buyConfStatus2 = buyConfCooldown2 > 0 ? `⏳${Math.round(buyConfCooldown2/60000)}m` : '✅';
            const sellConfStatus2 = sellConfCooldown2 > 0 ? `⏳${Math.round(sellConfCooldown2/60000)}m` : '✅';
            
            line += `${symbol2.padEnd(10)} S-C:${buyStatus2} S-V:${sellStatus2} | C-B:${buyConfStatus2} C-V:${sellConfStatus2} | `;
        }
        
        // Coluna 3
        if (i + symbolsPerColumn * 2 < SYMBOLS.length) {
            const symbol3 = SYMBOLS[i + symbolsPerColumn * 2];
            const lastBuy3 = alertsCooldown[symbol3].lastBuyAlert;
            const lastSell3 = alertsCooldown[symbol3].lastSellAlert;
            const lastBuyConf3 = alertsCooldown[symbol3].lastBuyConfirmation;
            const lastSellConf3 = alertsCooldown[symbol3].lastSellConfirmation;
            
            const buyCooldown3 = lastBuy3 > 0 ? Math.max(0, COOLDOWN - (now - lastBuy3)) : 0;
            const sellCooldown3 = lastSell3 > 0 ? Math.max(0, COOLDOWN - (now - lastSell3)) : 0;
            const buyConfCooldown3 = lastBuyConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf3)) : 0;
            const sellConfCooldown3 = lastSellConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf3)) : 0;
            
            const buyStatus3 = buyCooldown3 > 0 ? `⏳${Math.round(buyCooldown3/60000)}m` : '✅';
            const sellStatus3 = sellCooldown3 > 0 ? `⏳${Math.round(sellCooldown3/60000)}m` : '✅';
            const buyConfStatus3 = buyConfCooldown3 > 0 ? `⏳${Math.round(buyConfCooldown3/60000)}m` : '✅';
            const sellConfStatus3 = sellConfCooldown3 > 0 ? `⏳${Math.round(sellConfCooldown3/60000)}m` : '✅';
            
            line += `${symbol3.padEnd(10)} S-C:${buyStatus3} S-V:${sellStatus3} | C-B:${buyConfStatus3} C-V:${sellConfStatus3}`;
        }
        
        status += line + "\n";
    }
    
    status += "=".repeat(50) + "\n";
    status += "Legenda: S-C=Sweep Compra, S-V=Sweep Venda, C-B=Confirmação Bull, C-V=Confirmação Bear\n";
    status += "✅=Pronto, ⏳=Cooldown (minutos)\n";
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
    
    // Mostrar configuração de alvos e stop
    console.log('🎯 CONFIGURAÇÃO DE ALVOS E STOP:');
    console.log('='.repeat(60));
    console.log(`Alvos: ${TARGET_PERCENTAGES.map(p => p + '%').join(', ')}`);
    console.log(`Stop Dinâmico: ${STOP_PERCENTAGE}%`);
    console.log('Critérios Confirmação Bull:');
    console.log('  - EMA 13 cruzando para cima EMA 34 (3m)');
    console.log('  - Preço acima EMA 55 (3m)');
    console.log('  - RSI 1h < 60');
    console.log('  - Volume anormal (2x média)');
    console.log('Critérios Confirmação Bear:');
    console.log('  - EMA 13 cruzando para baixo EMA 34 (3m)');
    console.log('  - Preço abaixo EMA 55 (3m)');
    console.log('  - RSI 1h > 60');
    console.log('  - Volume anormal (2x média)');
    console.log('='.repeat(60) + '\n');
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>Titanium SMC Sentinel</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `Monitorando ${SYMBOLS.length} ativos\n` +
                    `Sistema ativado:\n` +
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

            let sweepAlertsSent = 0;
            let confirmationAlertsSent = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            
            // Monitorar cada ativo sequencialmente - PRIMEIRO SWEEP
            for (const symbol of SYMBOLS) {
                try {
                    const sweepResult = await monitorSymbolSweep(symbol);
                    
                    if (sweepResult) {
                        console.log(`\n🔔 SWEEP DETECTADO PARA ${symbol}!`);
                        console.log(`📊 ${sweepResult.signal} - Preço: $${sweepResult.priceFormatted}`);
                        console.log(`📈 Volume 3m: ${sweepResult.volumeInfo.ratio}x da média`);
                        logToFile(`ALERTA SWEEP ${sweepResult.signal} - ${symbol} - Preço: $${sweepResult.price} - Volume: ${sweepResult.volumeInfo.ratio}x`);
                        
                        await sendAlert(sweepResult.message);
                        
                        // Atualizar cooldown
                        if (sweepResult.signal === 'Venda') {
                            alertsCooldown[symbol].lastSellAlert = Date.now();
                        } else {
                            alertsCooldown[symbol].lastBuyAlert = Date.now();
                        }
                        
                        sweepAlertsSent++;
                        
                        // Pequena pausa entre alertas para não sobrecarregar
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        process.stdout.write('.');
                    }
                    
                    // Pequena pausa entre ativos para não sobrecarregar a API
                    await new Promise(r => setTimeout(r, 200));
                    
                } catch (e) {
                    logToFile(`❌ Erro no processamento de sweep ${symbol}: ${e.message}`);
                    console.log(`\n❌ Erro em ${symbol} (sweep): ${e.message}`);
                }
            }
            
            console.log('\n🔍 Verificando confirmações de reversão...');
            
            // Monitorar cada ativo sequencialmente 
            for (const symbol of SYMBOLS) {
                try {
                    const confirmationResult = await monitorConfirmation(symbol);
                    
                    if (confirmationResult) {
                        console.log(`\n✅ CONFIRMAÇÃO DETECTADA PARA ${symbol}!`);
                        console.log(`📊 ${confirmationResult.signal} - Preço: $${confirmationResult.priceFormatted}`);
                        console.log(`📈 EMA 13/34: ${confirmationResult.emas3mData.isEMA13CrossingUp ? 'Cruzamento Bull' : 'Cruzamento Bear'}`);
                        console.log(`📈 Volume: ${confirmationResult.volumeConfirmation.volumeData.ratio}x`);
                        console.log(`🎯 4 Alvos + Stop Dinâmico calculados`);
                        logToFile(`ALERTA CONFIRMAÇÃO ${confirmationResult.signal} - ${symbol} - Preço: $${confirmationResult.price} - Volume: ${confirmationResult.volumeConfirmation.volumeData.ratio}x`);
                        
                        await sendAlert(confirmationResult.message);
                        
                        confirmationAlertsSent++;
                        
                        // Pequena pausa entre alertas para não sobrecarregar
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    
                    // Pequena pausa entre ativos para não sobrecarregar a API
                    await new Promise(r => setTimeout(r, 200));
                    
                } catch (e) {
                    logToFile(`❌ Erro no processamento de confirmação ${symbol}: ${e.message}`);
                    console.log(`\n❌ Erro em ${symbol} (confirmação): ${e.message}`);
                }
            }

            if (sweepAlertsSent > 0) {
                console.log(`\n📊 Total de ${sweepAlertsSent} alerta(s) de SWEEP enviado(s) nesta verificação`);
            }
            if (confirmationAlertsSent > 0) {
                console.log(`📊 Total de ${confirmationAlertsSent} alerta(s) de CONFIRMAÇÃO enviado(s) nesta verificação`);
            }
            if (sweepAlertsSent === 0 && confirmationAlertsSent === 0) {
                console.log(' ✓ Nenhum alerta detectado');
            }

            // Mostrar status a cada 10 ciclos
            if (cycleCount % 10 === 0) {
                showMonitoringStatus();
                
                // Limpar sweeps muito antigos (mais de 12 horas)
                const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
                for (const symbol of SYMBOLS) {
                    if (recentSweeps[symbol].lastBuySweep && recentSweeps[symbol].lastBuySweep < twelveHoursAgo) {
                        recentSweeps[symbol].lastBuySweep = null;
                        recentSweeps[symbol].buySweepPrice = 0;
                    }
                    if (recentSweeps[symbol].lastSellSweep && recentSweeps[symbol].lastSellSweep < twelveHoursAgo) {
                        recentSweeps[symbol].lastSellSweep = null;
                        recentSweeps[symbol].sellSweepPrice = 0;
                    }
                }
            }

            consecutiveErrors = 0;
            
            console.log(`\n⏱️  Próxima verificação em 60 segundos...`);
            
            // Verificação estava 30000 a cada 30 segundos, ajustei para 60000 a cada 1 minuto
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
console.log('🤖 BOT DE MONITORAMENTO SMC 1H');
console.log('📈 Monitorando 55 ativos da Binance');
console.log('🔧 Configuração SMC');
console.log('🎯 SISTEMA DE 4 ALERTAS:');
console.log('   1. Sweep Compra (1H)');
console.log('   2. Sweep Venda (1H)');
console.log('   3. Confirmação Bull (EMA 13/34/55 3m + RSI < 60 + Volume)');
console.log('   4. Confirmação Bear (EMA 13/34/55 3m + RSI > 60 + Volume)');
console.log('🎯 4 ALVOS + STOP DINÂMICO INCLUÍDOS');
console.log('='.repeat(60) + '\n');

startBot();
