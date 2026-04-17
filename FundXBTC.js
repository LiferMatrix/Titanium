const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const MEMORY_FILE = path.join(__dirname, 'fundingMonitorMemory.json');
const ALERTED_FILE = path.join(__dirname, 'alertedSymbols.json');
const BTC_TF_STATE_FILE = path.join(__dirname, 'btcTimeframeState.json');
const VOLUME_MOMENTUM_FILE = path.join(__dirname, 'volumeMomentumMemory.json');

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    MONITOR: {
        SCAN_INTERVAL_SECONDS: 60,
        MIN_VOLUME_USDT: 1000000,
        MAX_SYMBOLS: 270,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        LSR_15M_PERIOD: '15m',
        LSR_TREND_THRESHOLD: 0.05,
        ALERT_COOLDOWN_MINUTES: 5,
        TELEGRAM_DELAY_MS: 1500,
        RSI: {
            PERIOD: 14,
            TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCE_STRENGTH: 3,
            MIN_VOLUME_CONFIRMATION: 55,
            RSI_BUY_THRESHOLD: 60,
            RSI_SELL_THRESHOLD: 50
        },
        BOLLINGER: {
            PERIOD: 20,
            STD_DEVIATION: 2.2,
            TIMEFRAME: '15m',
            TOUCH_THRESHOLD: 0.04
        },
        CVD: {
            CHECK_INTERVAL_SECONDS: 30,
            CVD_CHANGE_WINDOW: 60
        },
        BTC_MONITOR: {
            ENABLED: true,
            TIMEFRAMES: ['15m', '1h', '4h', '12h', '1d'],
            EMA_PERIOD: 55,
            CHECK_INTERVAL_SECONDS: 60,
            ALERT_COOLDOWN_MINUTES: 5
        }
    }
};

// =====================================================================
// === MEMÓRIA DE CRUZAMENTOS (VOLUME MOMENTUM) ===
// =====================================================================
let volumeMomentumMemory = {
    lastStochK: {},      // Último valor de K por símbolo
    lastStochD: {},      // Último valor de D por símbolo
    lastCCI: {},         // Último status do CCI por símbolo
    lastCrossState: {}   // Último estado de cruzamento (null, 'bull', 'bear')
};

function loadVolumeMomentumMemory() {
    try {
        if (fs.existsSync(VOLUME_MOMENTUM_FILE)) {
            const data = fs.readFileSync(VOLUME_MOMENTUM_FILE, 'utf8');
            volumeMomentumMemory = JSON.parse(data);
            console.log(`📂 Memória de Volume Momentum carregada`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar memória de Volume Momentum: ${error.message}`);
    }
}

function saveVolumeMomentumMemory() {
    try {
        fs.writeFileSync(VOLUME_MOMENTUM_FILE, JSON.stringify(volumeMomentumMemory, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar memória de Volume Momentum: ${error.message}`);
    }
}

// =====================================================================
// === ESTADO DOS TIMEFRAMES DO BTC ===
// =====================================================================
let btcTimeframeState = {
    '15m': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '1h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '4h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '12h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '1d': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 }
};

let initialStatusSent = false;

// =====================================================================
// === CARREGAR ESTADO DOS TIMEFRAMES ===
// =====================================================================
function loadBTCTimeframeState() {
    try {
        if (fs.existsSync(BTC_TF_STATE_FILE)) {
            const data = fs.readFileSync(BTC_TF_STATE_FILE, 'utf8');
            const loaded = JSON.parse(data);
            btcTimeframeState = loaded;
            console.log(`📂 Estado dos timeframes BTC carregado`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar estado dos TFs BTC: ${error.message}`);
    }
}

function saveBTCTimeframeState() {
    try {
        fs.writeFileSync(BTC_TF_STATE_FILE, JSON.stringify(btcTimeframeState, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar estado dos TFs BTC: ${error.message}`);
    }
}

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();
const bollingerCache = new Map();
const lsrTrendCache = new Map();
const stochCache = new Map();
const cciCache = new Map();
const alertedSymbols = new Map();

function loadAlertedSymbols() {
    try {
        if (fs.existsSync(ALERTED_FILE)) {
            const data = fs.readFileSync(ALERTED_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [symbol, timestamp] of Object.entries(loaded)) {
                alertedSymbols.set(symbol, timestamp);
            }
            console.log(`📂 ${alertedSymbols.size} alertas anteriores carregados`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar alertas: ${error.message}`);
    }
}

function saveAlertedSymbols() {
    try {
        const data = {};
        for (const [symbol, timestamp] of alertedSymbols.entries()) {
            data[symbol] = timestamp;
        }
        fs.writeFileSync(ALERTED_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar alertas: ${error.message}`);
    }
}

function canAlert(symbol, type) {
    const key = `${symbol}_${type}`;
    const lastAlert = alertedSymbols.get(key);
    if (!lastAlert) return true;
    
    const cooldownMs = CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markAlerted(symbol, type) {
    const key = `${symbol}_${type}`;
    alertedSymbols.set(key, Date.now());
    saveAlertedSymbols();
}

function canAlertBTC(timeframe) {
    const lastAlert = btcTimeframeState[timeframe]?.lastAlertSent || 0;
    const cooldownMs = CONFIG.MONITOR.BTC_MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markBTCAlerted(timeframe) {
    if (btcTimeframeState[timeframe]) {
        btcTimeframeState[timeframe].lastAlertSent = Date.now();
        saveBTCTimeframeState();
    }
}

// =====================================================================
// === CVD MANAGER VIA WEBSOCKET ===
// =====================================================================
class CVDManager {
    constructor() {
        this.cvdData = new Map();
        this.subscribedSymbols = new Set();
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
    }

    subscribeToSymbol(symbol) {
        if (this.subscribedSymbols.has(symbol)) return;
        
        this.subscribedSymbols.add(symbol);
        
        this.cvdData.set(symbol, {
            value: 0,
            history: [],
            lastUpdate: Date.now(),
            buyVolume: 0,
            sellVolume: 0,
            lastPrice: null,
            ws: null,
            connected: false,
            direction: '',
            directionChange: 0
        });
        
        this.connectWebSocket(symbol);
    }
    
    connectWebSocket(symbol) {
        const symbolLower = symbol.toLowerCase();
        const wsUrl = `wss://fstream.binance.com/ws/${symbolLower}@aggTrade`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            this.reconnectAttempts.set(symbol, 0);
            const data = this.cvdData.get(symbol);
            if (data) {
                data.ws = ws;
                data.connected = true;
            }
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (error) {}
        });
        
        ws.on('error', () => {
            this.handleDisconnect(symbol);
        });
        
        ws.on('close', () => {
            this.handleDisconnect(symbol);
        });
        
        const data = this.cvdData.get(symbol);
        if (data) data.ws = ws;
    }
    
    processTrade(symbol, trade) {
        const volume = parseFloat(trade.q);
        const isBuyerMaker = trade.m;
        const delta = isBuyerMaker ? -volume : +volume;
        
        const data = this.cvdData.get(symbol);
        if (!data) return;
        
        data.value += delta;
        data.lastUpdate = Date.now();
        data.lastPrice = parseFloat(trade.p);
        
        if (delta > 0) data.buyVolume += volume;
        else data.sellVolume += volume;
        
        data.history.push({
            timestamp: Date.now(),
            delta: delta,
            volume: volume,
            cvd: data.value
        });
        
        if (data.history.length > 1000) data.history.shift();
        this.updateDirection(symbol);
    }
    
    updateDirection(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length < 10) return;
        
        const now = Date.now();
        const cutoff = now - (CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW * 1000);
        
        let oldCVD = null;
        for (let i = data.history.length - 1; i >= 0; i--) {
            if (data.history[i].timestamp <= cutoff) {
                oldCVD = data.history[i];
                break;
            }
        }
        
        if (!oldCVD) return;
        
        const change = data.value - oldCVD.cvd;
        const changePercent = Math.abs(change / (Math.abs(oldCVD.cvd) || 1)) * 100;
        
        if (change > 0 && changePercent >= 1) data.direction = '⤴️';
        else if (change < 0 && changePercent >= 1) data.direction = '⤵️';
        else data.direction = '';
    }
    
    handleDisconnect(symbol) {
        const attempts = this.reconnectAttempts.get(symbol) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, attempts);
            setTimeout(() => {
                this.reconnectAttempts.set(symbol, attempts + 1);
                this.connectWebSocket(symbol);
            }, delay);
        } else {
            const data = this.cvdData.get(symbol);
            if (data && data.ws) {
                try { data.ws.terminate(); } catch(e) {}
            }
        }
    }
    
    unsubscribeFromSymbol(symbol) {
        const data = this.cvdData.get(symbol);
        if (data && data.ws) {
            try { data.ws.close(); data.ws.terminate(); } catch(e) {}
        }
        this.subscribedSymbols.delete(symbol);
        this.cvdData.delete(symbol);
    }
    
    getCVD(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return null;
        return { direction: data.direction };
    }
    
    getCVDValue(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return '';
        return data.direction;
    }
    
    getVolumeProfile(symbol, minutesAgo = 5) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length === 0) return null;
        
        const now = Date.now();
        const cutoff = now - (minutesAgo * 60 * 1000);
        
        let buyVolume = 0, sellVolume = 0, totalVolume = 0;
        
        for (const trade of data.history) {
            if (trade.timestamp >= cutoff) {
                if (trade.delta > 0) buyVolume += trade.volume;
                else sellVolume += trade.volume;
                totalVolume += trade.volume;
            }
        }
        
        if (totalVolume === 0) return null;
        
        const buyerRatio = (buyVolume / totalVolume) * 100;
        const sellerRatio = (sellVolume / totalVolume) * 100;
        
        return {
            buyerRatio: buyerRatio,
            sellerRatio: sellerRatio,
            totalVolume: totalVolume,
            dominant: buyerRatio > sellerRatio ? 'buyers' : 'sellers',
            dominantRatio: Math.max(buyerRatio, sellerRatio)
        };
    }
    
    cleanup() {
        for (const symbol of this.subscribedSymbols) {
            this.unsubscribeFromSymbol(symbol);
        }
    }
}

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0];
    return { date, time, full: `${date} ${time}` };
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(4);
    if (price > 0.1) return price.toFixed(5);
    if (price > 0.01) return price.toFixed(6);
    return price.toFixed(8);
}

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const icons = { error: '❌', success: '✅', warning: '⚠️', info: 'ℹ️', alert: '🚨' };
    console.log(`${icons[type] || 'ℹ️'} [${timestamp}] ${message}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR STOCHASTIC (5,3,3) ===
// =====================================================================
async function calculateStochastic(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_stoch_${timeframe}`;
        const now = Date.now();
        const cached = stochCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 20) return null;
        
        const periodK = 5;
        const periodD = 3;
        const periodSlow = 3;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const kValues = [];
        
        for (let i = periodK - 1; i < closes.length; i++) {
            let highestHigh = Math.max(...highs.slice(i - periodK + 1, i + 1));
            let lowestLow = Math.min(...lows.slice(i - periodK + 1, i + 1));
            let currentClose = closes[i];
            
            let k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
            kValues.push(k);
        }
        
        const dValues = [];
        for (let i = periodD - 1; i < kValues.length; i++) {
            let sum = 0;
            for (let j = 0; j < periodD; j++) {
                sum += kValues[i - j];
            }
            dValues.push(sum / periodD);
        }
        
        const slowDValues = [];
        for (let i = periodSlow - 1; i < dValues.length; i++) {
            let sum = 0;
            for (let j = 0; j < periodSlow; j++) {
                sum += dValues[i - j];
            }
            slowDValues.push(sum / periodSlow);
        }
        
        const currentK = kValues[kValues.length - 1];
        const currentD = slowDValues[slowDValues.length - 1];
        const prevK = kValues[kValues.length - 2];
        const prevD = slowDValues[slowDValues.length - 2];
        
        const kTrend = currentK > prevK ? '⤴️' : (currentK < prevK ? '⤵️' : '');
        const dTrend = currentD > prevD ? '⤴️' : (currentD < prevD ? '⤵️' : '');
        
        const isOverbought = currentK > 80 && currentD > 80;
        const isOversold = currentK < 20 && currentD < 20;
        
        let status = '🟡';
        if (isOverbought) status = '🔴';
        if (isOversold) status = '🟢';
        
        const result = {
            k: currentK.toFixed(0),
            d: currentD.toFixed(0),
            kTrend: kTrend,
            dTrend: dTrend,
            status: status,
            isOverbought,
            isOversold,
            rawK: currentK,
            rawD: currentD
        };
        
        stochCache.set(cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR CCI COM EMA 5 ===
// === Status do CRUZAMENTO com UMA seta de direção ===
// =====================================================================
async function calculateCCI(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_cci_${timeframe}`;
        const now = Date.now();
        const cached = cciCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const period = 20;
        const emaPeriod = 5;
        
        const candles = await getCandles(symbol, timeframe, 100);
        if (!candles || candles.length < period + emaPeriod) return null;
        
        const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
        
        const cciValues = [];
        
        for (let i = period - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - period + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / period;
            
            let meanDeviation = 0;
            for (let j = 0; j < slice.length; j++) {
                meanDeviation += Math.abs(slice[j] - sma);
            }
            meanDeviation = meanDeviation / period;
            
            if (meanDeviation === 0) {
                cciValues.push(0);
            } else {
                const cci = (typicalPrices[i] - sma) / (0.015 * meanDeviation);
                cciValues.push(cci);
            }
        }
        
        // Calcular EMA 5 do CCI
        const emaValues = [];
        if (cciValues.length >= emaPeriod) {
            const multiplier = 2 / (emaPeriod + 1);
            let ema = cciValues[0];
            emaValues.push(ema);
            
            for (let i = 1; i < cciValues.length; i++) {
                ema = (cciValues[i] - ema) * multiplier + ema;
                emaValues.push(ema);
            }
        }
        
        const currentCCI = cciValues[cciValues.length - 1];
        const currentEMA = emaValues[emaValues.length - 1];
        const prevCCI = cciValues[cciValues.length - 2];
        
        // DIREÇÃO do CCI (para onde está apontando)
        const cciDirection = currentCCI > prevCCI ? '⤴️' : (currentCCI < prevCCI ? '⤵️' : '');
        
        // STATUS DO CRUZAMENTO (ALTA = CCI acima da EMA, BAIXA = CCI abaixo da EMA)
        let crossStatus = '';
        
        if (currentCCI > currentEMA) {
            crossStatus = 'ALTA';
        } else if (currentCCI < currentEMA) {
            crossStatus = 'BAIXA';
        } else {
            crossStatus = 'NEUTRO';
        }
        
        // CÍRCULO COLORIDO baseado no VALOR do CCI
        let valueCircle = '';
        
        if (currentCCI <= -200) {
            valueCircle = '🔵';
        } else if (currentCCI <= -100) {
            valueCircle = '🟢';
        } else if (currentCCI <= -50) {
            valueCircle = '🟡';
        } else if (currentCCI <= 0) {
            valueCircle = '🟡';
        } else if (currentCCI <= 50) {
            valueCircle = '🟠';
        } else if (currentCCI <= 100) {
            valueCircle = '🟠';
        } else if (currentCCI <= 200) {
            valueCircle = '🔴';
        } else {
            valueCircle = '🔥';
        }
        
        const result = {
            crossStatus: crossStatus,    // ALTA ou BAIXA
            direction: cciDirection,     // ⤴️ ou ⤵️ (direção do CCI)
            circle: valueCircle,         // Círculo por valor
            rawCCI: currentCCI,
            rawEMA: currentEMA
        };
        
        cciCache.set(cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR CRUZAMENTO STOCH + CCI (VOLUME MOMENTUM) ===
// === Retorna: 'bull' (cruzou para cima), 'bear' (cruzou para baixo), ou null ===
// =====================================================================
function detectVolumeMomentumCross(symbol, stoch4h, cci4h) {
    if (!stoch4h || !cci4h) return null;
    
    const symbolKey = symbol;
    
    // Inicializar memória se não existir
    if (!volumeMomentumMemory.lastStochK[symbolKey]) {
        volumeMomentumMemory.lastStochK[symbolKey] = stoch4h.rawK;
        volumeMomentumMemory.lastStochD[symbolKey] = stoch4h.rawD;
        volumeMomentumMemory.lastCCI[symbolKey] = cci4h.crossStatus;
        volumeMomentumMemory.lastCrossState[symbolKey] = null;
        saveVolumeMomentumMemory();
        return null;
    }
    
    const prevStochK = volumeMomentumMemory.lastStochK[symbolKey];
    const prevStochD = volumeMomentumMemory.lastStochD[symbolKey];
    const prevCCIStatus = volumeMomentumMemory.lastCCI[symbolKey];
    const prevCrossState = volumeMomentumMemory.lastCrossState[symbolKey];
    
    const currentStochK = stoch4h.rawK;
    const currentStochD = stoch4h.rawD;
    const currentCCIStatus = cci4h.crossStatus;
    
    // Detectar CRUZAMENTO do Stoch (K cruzando D para cima ou para baixo)
    let stochBullCross = false;  // K cruzou D para CIMA
    let stochBearCross = false;  // K cruzou D para BAIXO
    
    // Cruzamento para CIMA: K estava abaixo de D e agora está acima
    if (prevStochK < prevStochD && currentStochK > currentStochD) {
        stochBullCross = true;
    }
    // Cruzamento para BAIXO: K estava acima de D e agora está abaixo
    if (prevStochK > prevStochD && currentStochK < currentStochD) {
        stochBearCross = true;
    }
    
    // Detectar CRUZAMENTO do CCI (CCI cruzando EMA)
    let cciBullCross = false;  // CCI cruzou EMA para CIMA
    let cciBearCross = false;  // CCI cruzou EMA para BAIXO
    
    // Cruzamento para CIMA: estava BAIXA e agora ALTA
    if (prevCCIStatus === 'BAIXA' && currentCCIStatus === 'ALTA') {
        cciBullCross = true;
    }
    // Cruzamento para BAIXO: estava ALTA e agora BAIXA
    if (prevCCIStatus === 'ALTA' && currentCCIStatus === 'BAIXA') {
        cciBearCross = true;
    }
    
    // ATUALIZAR MEMÓRIA
    volumeMomentumMemory.lastStochK[symbolKey] = currentStochK;
    volumeMomentumMemory.lastStochD[symbolKey] = currentStochD;
    volumeMomentumMemory.lastCCI[symbolKey] = currentCCIStatus;
    
    let newCrossState = null;
    let crossType = null;
    
    // VOLUME MOMENTUM BULL: Stoch cruzou para CIMA E CCI cruzou para CIMA (no mesmo período)
    if (stochBullCross && cciBullCross) {
        newCrossState = 'bull';
        crossType = 'BULL';
    }
    // VOLUME MOMENTUM BEAR: Stoch cruzou para BAIXO E CCI cruzou para BAIXO (no mesmo período)
    else if (stochBearCross && cciBearCross) {
        newCrossState = 'bear';
        crossType = 'BEAR';
    } else {
        newCrossState = null;
    }
    
    // Verificar se o cruzamento ACABOU de acontecer (não estava cruzado antes)
    const wasCrossed = (prevCrossState === 'bull' || prevCrossState === 'bear');
    const isNowCrossed = (newCrossState === 'bull' || newCrossState === 'bear');
    
    // Só alertar se NÃO estava cruzado antes e AGORA cruzou
    let shouldAlert = false;
    let alertType = null;
    
    if (!wasCrossed && isNowCrossed) {
        shouldAlert = true;
        alertType = newCrossState === 'bull' ? 'VOLUME_MOMENTUM_BULL' : 'VOLUME_MOMENTUM_BEAR';
    }
    
    // Atualizar último estado de cruzamento
    volumeMomentumMemory.lastCrossState[symbolKey] = newCrossState;
    saveVolumeMomentumMemory();
    
    if (shouldAlert) {
        return alertType;
    }
    
    return null;
}

// =====================================================================
// === FUNÇÃO PARA FORMATAR STOCHASTIC EM MENSAGEM ===
// =====================================================================
function formatStochMessage(stoch4h, stoch1d) {
    let msg = '';
    
    if (stoch4h) {
        msg += `Stoch 4H: K${stoch4h.k}${stoch4h.kTrend} D${stoch4h.d}${stoch4h.dTrend} ${stoch4h.status}\n`;
    }
    
    if (stoch1d) {
        msg += `Stoch 1D: K${stoch1d.k}${stoch1d.kTrend} D${stoch1d.d}${stoch1d.dTrend} ${stoch1d.status}\n`;
    }
    
    return msg;
}

// =====================================================================
// === FUNÇÃO PARA FORMATAR CCI EM MENSAGEM ===
// === Exemplo: CCI 4H: BAIXA ⤵️ 🔴
// === Exemplo: CCI 1D: ALTA ⤴️ 🔴
// =====================================================================
function formatCCIMessage(cci4h, cci1d) {
    let msg = '';
    
    if (cci4h) {
        msg += `CCI 4H: ${cci4h.crossStatus} ${cci4h.direction} ${cci4h.circle}\n`;
    }
    
    if (cci1d) {
        msg += `CCI 1D: ${cci1d.crossStatus} ${cci1d.direction} ${cci1d.circle}\n`;
    }
    
    return msg;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR EMA ===
// =====================================================================
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    
    return ema;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR RSI ===
// =====================================================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const rsiValues = [null];
    const firstRSI = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    rsiValues.push(firstRSI);
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        rsiValues.push(rsi);
    }
    return rsiValues;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR BOLLINGER BANDS ===
// =====================================================================
function calculateBollingerBands(prices, period = 20, stdDev = 2.2) {
    if (prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
        sma: sma,
        upper: sma + (stdDev * standardDeviation),
        lower: sma - (stdDev * standardDeviation)
    };
}

// =====================================================================
// === FUNÇÃO PARA VERIFICAR BOLLINGER TOUCH ===
// =====================================================================
async function checkBollingerTouch(symbol, type) {
    try {
        const now = Date.now();
        const cached = bollingerCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, CONFIG.MONITOR.BOLLINGER.TIMEFRAME, CONFIG.MONITOR.BOLLINGER.PERIOD + 10);
        if (!candles || candles.length < CONFIG.MONITOR.BOLLINGER.PERIOD) return false;
        
        const prices = candles.map(c => c.close);
        const bollinger = calculateBollingerBands(prices, CONFIG.MONITOR.BOLLINGER.PERIOD, CONFIG.MONITOR.BOLLINGER.STD_DEVIATION);
        if (!bollinger) return false;
        
        const currentPrice = prices[prices.length - 1];
        const threshold = CONFIG.MONITOR.BOLLINGER.TOUCH_THRESHOLD;
        
        let result = false;
        
        if (type === 'buy') {
            const lowerBand = bollinger.lower;
            const distance = (lowerBand - currentPrice) / currentPrice;
            result = currentPrice <= lowerBand || (distance > 0 && distance <= threshold);
        } else {
            const upperBand = bollinger.upper;
            const distance = (currentPrice - upperBand) / currentPrice;
            result = currentPrice >= upperBand || (distance > 0 && distance <= threshold);
        }
        
        bollingerCache.set(symbol, {
            data: result,
            timestamp: now
        });
        
        return result;
    } catch (error) {
        return false;
    }
}

// =====================================================================
// === FUNÇÃO PARA VERIFICAR TENDÊNCIA DO LSR ===
// =====================================================================
async function getLSRTrend(symbol) {
    try {
        const now = Date.now();
        const cached = lsrTrendCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const period = CONFIG.MONITOR.LSR_15M_PERIOD;
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data || data.length < 2) {
            return { trend: 'stable', changePercent: 0 };
        }
        
        const currentLSR = parseFloat(data[0].longShortRatio);
        const previousLSR = parseFloat(data[1].longShortRatio);
        
        const changePercent = ((currentLSR - previousLSR) / previousLSR) * 100;
        
        let trend = 'stable';
        if (changePercent > CONFIG.MONITOR.LSR_TREND_THRESHOLD) {
            trend = 'rising';
        } else if (changePercent < -CONFIG.MONITOR.LSR_TREND_THRESHOLD) {
            trend = 'falling';
        }
        
        const result = { trend, changePercent, currentLSR, previousLSR };
        
        lsrTrendCache.set(symbol, {
            data: result,
            timestamp: now
        });
        
        return result;
    } catch (error) {
        return { trend: 'stable', changePercent: 0 };
    }
}

// =====================================================================
// === FUNÇÃO PARA ENCONTRAR PIVÔS ===
// =====================================================================
function findPivots(data, lookback = 3) {
    const pivots = { highs: [], lows: [] };
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
            if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
        }
        
        if (isHigh) pivots.highs.push({ index: i, value: data[i] });
        if (isLow) pivots.lows.push({ index: i, value: data[i] });
    }
    
    return pivots;
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR DIVERGÊNCIAS ===
// =====================================================================
function findRSIDivergences(prices, rsiValues, volumeProfile = null) {
    const divergences = { bullish: [], bearish: [] };
    
    if (prices.length < 30 || rsiValues.length < 30) return divergences;
    
    const pricePivots = findPivots(prices, 3);
    const rsiPivots = findPivots(rsiValues, 3);
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            
            if (priceLower) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 2);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 2);
                
                if (rsiLow1 && rsiLow2) {
                    const rsiHigher = rsiLow2.value > rsiLow1.value;
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    
                    if (rsiHigher && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'buyers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bullish.push({
                            type: 'bullish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    for (let i = 0; i < pricePivots.highs.length; i++) {
        for (let j = i + 1; j < pricePivots.highs.length; j++) {
            const priceHigh1 = pricePivots.highs[i];
            const priceHigh2 = pricePivots.highs[j];
            
            const priceHigher = priceHigh2.value > priceHigh1.value;
            
            if (priceHigher) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 2);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 2);
                
                if (rsiHigh1 && rsiHigh2) {
                    const rsiLower = rsiHigh2.value < rsiHigh1.value;
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    
                    if (rsiLower && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'sellers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bearish.push({
                            type: 'bearish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    return divergences;
}

// =====================================================================
// === ANALISAR DIVERGÊNCIAS ===
// =====================================================================
async function analyzeDivergences(symbol, cvdManager) {
    const cacheKey = `${symbol}_divergences`;
    const now = Date.now();
    const cached = divergenceCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < 300000) {
        return cached.data;
    }
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false,
        bullishTimeframes: [],
        bearishTimeframes: [],
        bestBullishVolumeScore: 0,
        bestBearishVolumeScore: 0,
        hasBullish15mPlusOther: false,
        hasBearish15mPlusOther: false
    };
    
    const volumeProfile = cvdManager.getVolumeProfile(symbol, 5);
    
    let bullishOn15m = false;
    let bearishOn15m = false;
    let bullishOtherTimeframes = [];
    let bearishOtherTimeframes = [];
    
    for (const timeframe of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        try {
            const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) continue;
            
            const prices = candles.map(c => c.close);
            const rsi = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
            if (!rsi || rsi.length < 50) continue;
            
            const divergences = findRSIDivergences(prices, rsi, volumeProfile);
            
            if (divergences.bullish.length > 0) {
                result.hasBullishDivergence = true;
                result.bullishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bullish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBullishVolumeScore) {
                    result.bestBullishVolumeScore = maxVolumeScore;
                }
                
                if (timeframe === '15m') {
                    bullishOn15m = true;
                } else {
                    bullishOtherTimeframes.push(timeframe);
                }
            }
            
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
                result.bearishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bearish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBearishVolumeScore) {
                    result.bestBearishVolumeScore = maxVolumeScore;
                }
                
                if (timeframe === '15m') {
                    bearishOn15m = true;
                } else {
                    bearishOtherTimeframes.push(timeframe);
                }
            }
            
        } catch (error) {}
    }
    
    result.hasBullish15mPlusOther = bullishOn15m && bullishOtherTimeframes.length > 0;
    result.hasBearish15mPlusOther = bearishOn15m && bearishOtherTimeframes.length > 0;
    
    divergenceCache.set(cacheKey, {
        data: result,
        timestamp: now
    });
    
    return result;
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        
        return data.map(candle => ({
            open: parseFloat(candle[1]), 
            high: parseFloat(candle[2]), 
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]), 
            volume: parseFloat(candle[5]), 
            time: candle[0]
        }));
    } catch (error) {
        return [];
    }
}

// =====================================================================
// === OBTER RSI 1h ===
// =====================================================================
async function getRSIForSymbol(symbol) {
    try {
        const now = Date.now();
        const cached = rsiCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.value;
        }
        
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 30) return null;
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        if (!rsi || rsi.length === 0) return null;
        
        const rsiValue = rsi[rsi.length - 1];
        
        rsiCache.set(symbol, {
            value: rsiValue,
            timestamp: now
        });
        
        return rsiValue;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === EMOJI BASEADO NO RSI ===
// =====================================================================
function getRSIEmoji(rsiValue) {
    if (rsiValue === null || rsiValue === undefined) return '⚪';
    if (rsiValue < 20) return '🔵';
    if (rsiValue <= 30) return '🟢';
    if (rsiValue <= 45) return '🟡';
    if (rsiValue <= 58) return '🟠';
    if (rsiValue <= 75) return '🔴';
    return '🔥';
}

// =====================================================================
// === BUSCAR TODOS OS SÍMBOLOS ===
// =====================================================================
async function getAllSymbols() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        const filtered = data.filter(i => 
            i.symbol.endsWith('USDT') && 
            parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && 
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)
        ).slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
        
        return filtered.map(i => ({
            symbol: i.symbol,
            price: parseFloat(i.lastPrice),
            volume24h: parseFloat(i.quoteVolume)
        }));
    } catch (error) {
        log(`Erro ao buscar símbolos: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === BUSCAR FUNDING RATES ===
// =====================================================================
async function getFundingRates(symbols) {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) {
            if (symbols.includes(i.symbol)) {
                result[i.symbol] = parseFloat(i.lastFundingRate);
            }
        }
        return result;
    } catch (error) {
        log(`Erro funding: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR LSR ===
// =====================================================================
async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const promises = symbols.map(async s => {
            try {
                const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${period}&limit=1`;
                const res = await fetch(url);
                const data = await res.json();
                return { symbol: s, lsr: data && data.length ? parseFloat(data[0].longShortRatio) : null };
            } catch {
                return { symbol: s, lsr: null };
            }
        });
        const results = await Promise.all(promises);
        const result = {};
        for (const i of results) {
            result[i.symbol] = i.lsr;
        }
        return result;
    } catch (error) {
        log(`Erro LSR: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === VERIFICAR CRITÉRIOS E ENVIAR ALERTA (ALTCOINS) ===
// === NOVO: ALERTA DE VOLUME MOMENTUM BULL/BEAR ===
// =====================================================================
async function checkAndAlert(symbolData, cvdManager) {
    const { symbol: fullSymbol, price, volume24h } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
    
    try {
        const [funding, lsr, rsiValue, divergences, lsrTrendData] = await Promise.all([
            getFundingRates([fullSymbol]).then(r => r[fullSymbol]),
            getLSRData([fullSymbol]).then(r => r[fullSymbol]),
            getRSIForSymbol(fullSymbol),
            analyzeDivergences(fullSymbol, cvdManager),
            getLSRTrend(fullSymbol)
        ]);
        
        if (funding === undefined || !lsr || !rsiValue) return;
        
        const bollingerBuy = await checkBollingerTouch(fullSymbol, 'buy');
        const bollingerSell = await checkBollingerTouch(fullSymbol, 'sell');
        const cvd = cvdManager.getCVD(fullSymbol);
        
        const [stoch4h, stoch1d, cci4h, cci1d] = await Promise.all([
            calculateStochastic(fullSymbol, '4h'),
            calculateStochastic(fullSymbol, '1d'),
            calculateCCI(fullSymbol, '4h'),
            calculateCCI(fullSymbol, '1d')
        ]);
        
        // =============================================================
        // NOVO: DETECTAR VOLUME MOMENTUM BULL/BEAR
        // =============================================================
        const volumeMomentumSignal = detectVolumeMomentumCross(fullSymbol, stoch4h, cci4h);
        
        const asset = {
            symbol,
            fullSymbol,
            price,
            funding,
            fundingPercent: funding * 100,
            lsr,
            lsrTrend: lsrTrendData.trend,
            rsi: rsiValue,
            rsiEmoji: getRSIEmoji(rsiValue),
            cvdDirection: cvd ? cvd.direction : '',
            divergences,
            bollingerBuy,
            bollingerSell,
            stoch4h,
            stoch1d,
            cci4h,
            cci1d,
            volumeMomentumSignal
        };
        
        // =============================================================
        // ALERTA VOLUME MOMENTUM BULL
        // =============================================================
        if (volumeMomentumSignal === 'VOLUME_MOMENTUM_BULL' && canAlert(fullSymbol, 'VOLUME_MOMENTUM_BULL')) {
            await sendVolumeMomentumAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'VOLUME_MOMENTUM_BULL');
            log(`🟢 VOLUME MOMENTUM BULL: ${symbol}`, 'alert');
        }
        
        // =============================================================
        // ALERTA VOLUME MOMENTUM BEAR
        // =============================================================
        if (volumeMomentumSignal === 'VOLUME_MOMENTUM_BEAR' && canAlert(fullSymbol, 'VOLUME_MOMENTUM_BEAR')) {
            await sendVolumeMomentumAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'VOLUME_MOMENTUM_BEAR');
            log(`🔴 VOLUME MOMENTUM BEAR: ${symbol}`, 'alert');
        }
        
        // =============================================================
        // ALERTAS TRADICIONAIS (BULL/BEAR)
        // =============================================================
        const isBear = asset.divergences.hasBearish15mPlusOther &&
                       asset.rsi > CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD &&
                       asset.bollingerSell &&
                       asset.lsr > 2.6 &&
                       asset.funding > 0 &&
                       asset.lsrTrend === 'rising';
        
        const isBull = asset.divergences.hasBullish15mPlusOther &&
                       asset.rsi < CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD &&
                       asset.bollingerBuy &&
                       asset.lsr < 2.5 &&
                       asset.funding < 0 &&
                       asset.lsrTrend === 'falling';
        
        if (isBear && canAlert(fullSymbol, 'BEAR')) {
            await sendAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'BEAR');
            log(`🔴 ALERTA BEAR: ${symbol}`, 'alert');
        }
        
        if (isBull && canAlert(fullSymbol, 'BULL')) {
            await sendAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'BULL');
            log(`🟢 ALERTA BULL: ${symbol}`, 'alert');
        }
        
    } catch (error) {
        log(`Erro ao verificar ${fullSymbol}: ${error.message}`, 'error');
    }
}

// =====================================================================
// === NOVO: ENVIAR ALERTA DE VOLUME MOMENTUM ===
// =====================================================================
async function sendVolumeMomentumAlert(asset, type) {
    const dt = getBrazilianDateTime();
    
    let message = '';
    
    if (type === 'BULL') {
        message = `🟢<b>VOLUME MOMENTUM BULL💹</b> \n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i>  CRUZAMENTO NO 4H:</i>\n`;
        message += `<i>    • Stoch (K⤴️D) cruzou para CIMA</i>\n`;
        message += `<i>    • CCI ⤴️ EMA para CIMA (ALTA)</i>\n`;
        message += `<i>  Indicadores:</i>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 Caindo' : '📈 Subindo'})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding < 0 ? '🟢 Negativo' : '🔴 Positivo'}\n`;
        message += `<i> RSI 1h:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        
        if (asset.stoch4h) {
            message += `<i> Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}</i>\n`;
        }
        if (asset.cci4h) {
            message += `<i> CCI 4H: ${asset.cci4h.crossStatus} ${asset.cci4h.direction} ${asset.cci4h.circle}</i>\n`;
        }
        
        if (asset.stoch1d || asset.cci1d) {
            message += `<i>  Diário:</i>\n`;
            if (asset.stoch1d) {
                message += `<i> Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}</i>\n`;
            }
            if (asset.cci1d) {
                message += `<i> CCI 1D: ${asset.cci1d.crossStatus} ${asset.cci1d.direction} ${asset.cci1d.circle}</i>\n`;
            }
        }
        
        message += `<i>  ${dt.full}</i>`;
    } else {
        message = `🔴<b>VOLUME MOMENTUM BEAR</b>🔻\n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i>  CRUZAMENTO NO 4H:</i>\n`;
        message += `<i>    • Stoch (K⤵️D) cruzou para BAIXO</i>\n`;
        message += `<i>    • CCI ⤵️ EMA para BAIXO (BAIXA)</i>\n`;
        message += `<i>  Indicadores:</i>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 Subindo' : '📉 Caindo'})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
        message += `<i> RSI 1h:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        
        if (asset.stoch4h) {
            message += `<i> Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}</i>\n`;
        }
        if (asset.cci4h) {
            message += `<i> CCI 4H: ${asset.cci4h.crossStatus} ${asset.cci4h.direction} ${asset.cci4h.circle}</i>\n`;
        }
        
        if (asset.stoch1d || asset.cci1d) {
            message += `<i>  Diário:</i>\n`;
            if (asset.stoch1d) {
                message += `<i> Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}</i>\n`;
            }
            if (asset.cci1d) {
                message += `<i> CCI 1D: ${asset.cci1d.crossStatus} ${asset.cci1d.direction} ${asset.cci1d.circle}</i>\n`;
            }
        }
        
        message += `<i>  ${dt.full}</i>`;
    }
    
    await sendToTelegram(message);
    await delay(CONFIG.MONITOR.TELEGRAM_DELAY_MS);
}

// =====================================================================
// === ENVIAR ALERTA INDIVIDUAL PARA TELEGRAM (ALTCOINS) ===
// =====================================================================
async function sendAlert(asset, type) {
    const dt = getBrazilianDateTime();
    
    let message = '';
    
    if (type === 'BULL') {
        message = `🟢<i>Avaliar Reversão💹</i> \n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 ' : '📈 '})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += `<i> RSI:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        message += `<i> Divergência:</i> ${asset.divergences.bullishTimeframes.join(' → ')}\n`;
        
        if (asset.stoch4h || asset.stoch1d) {
            message += `<i> ${formatStochMessage(asset.stoch4h, asset.stoch1d)}</i>`;
        }
        if (asset.cci4h || asset.cci1d) {
            message += `<i> ${formatCCIMessage(asset.cci4h, asset.cci1d)}</i>`;
        }
        
        message += `<i> ${dt.full}</i>`;
    } else {
        message = `🔴<i>Avaliar Correção🔻</i> \n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 ' : '📉 '})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += `<i> RSI:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        message += `<i> Divergência:</i> ${asset.divergences.bearishTimeframes.join(' → ')}\n`;
        
        if (asset.stoch4h || asset.stoch1d) {
            message += `<i> ${formatStochMessage(asset.stoch4h, asset.stoch1d)}</i>`;
        }
        if (asset.cci4h || asset.cci1d) {
            message += `<i> ${formatCCIMessage(asset.cci4h, asset.cci1d)}</i>`;
        }
        
        message += `<i> ${dt.full}</i>`;
    }
    
    await sendToTelegram(message);
    await delay(CONFIG.MONITOR.TELEGRAM_DELAY_MS);
}

// =====================================================================
// === VERIFICAR BTC POR TIMEFRAME INDIVIDUAL ===
// =====================================================================
async function checkBTCByTimeframe() {
    try {
        const symbol = 'BTCUSDT';
        const results = {};
        let hasChanges = false;
        let changesList = [];
        
        for (const timeframe of CONFIG.MONITOR.BTC_MONITOR.TIMEFRAMES) {
            const candles = await getCandles(symbol, timeframe, 100);
            if (!candles || candles.length < 60) continue;
            
            const prices = candles.map(c => c.close);
            const currentPrice = prices[prices.length - 1];
            const ema = calculateEMA(prices, CONFIG.MONITOR.BTC_MONITOR.EMA_PERIOD);
            
            if (ema === null) continue;
            
            const isAbove = currentPrice > ema;
            const distance = ((currentPrice - ema) / ema) * 100;
            
            results[timeframe] = {
                currentPrice,
                ema,
                isAbove,
                isBelow: !isAbove,
                distance: distance.toFixed(2)
            };
            
            const wasAbove = btcTimeframeState[timeframe]?.isAbove || false;
            
            if (wasAbove !== isAbove) {
                hasChanges = true;
                changesList.push({
                    timeframe,
                    wasAbove,
                    isAbove,
                    currentPrice,
                    ema,
                    distance: distance.toFixed(2)
                });
                console.log(` MUDANÇA DETECTADA no BTC ${timeframe}: ${wasAbove ? 'ACIMA' : 'ABAIXO'} → ${isAbove ? 'ACIMA' : 'ABAIXO'} (${distance.toFixed(2)}%)`);
            }
            
            if (btcTimeframeState[timeframe]) {
                btcTimeframeState[timeframe].isAbove = isAbove;
                btcTimeframeState[timeframe].currentPrice = currentPrice;
                btcTimeframeState[timeframe].emaValue = ema;
                btcTimeframeState[timeframe].distance = distance;
            }
        }
        
        const [funding, lsr, rsiValue, lsrTrendData] = await Promise.all([
            getFundingRates([symbol]).then(r => r[symbol]),
            getLSRData([symbol]).then(r => r[symbol]),
            getRSIForSymbol(symbol),
            getLSRTrend(symbol)
        ]);
        
        const bollingerBuy = await checkBollingerTouch(symbol, 'buy');
        const bollingerSell = await checkBollingerTouch(symbol, 'sell');
        const cvd = cvdManager.getCVDValue(symbol);
        
        const [stoch4h, stoch1d, cci4h, cci1d] = await Promise.all([
            calculateStochastic(symbol, '4h'),
            calculateStochastic(symbol, '1d'),
            calculateCCI(symbol, '4h'),
            calculateCCI(symbol, '1d')
        ]);
        
        return {
            results,
            hasChanges,
            changesList,
            funding: funding || 0,
            fundingPercent: (funding || 0) * 100,
            lsr: lsr || 0,
            lsrTrend: lsrTrendData.trend,
            rsi: rsiValue,
            cvdDirection: cvd,
            bollingerBuy,
            bollingerSell,
            currentPrice: results[Object.keys(results)[0]]?.currentPrice || 0,
            stoch4h,
            stoch1d,
            cci4h,
            cci1d
        };
        
    } catch (error) {
        console.log(`❌ Erro ao verificar BTC: ${error.message}`);
        return { hasChanges: false, changesList: [], results: {} };
    }
}

// =====================================================================
// === ENVIAR ALERTA DO BTC POR TIMEFRAME ===
// =====================================================================
async function sendBTCAlert(change, btcData) {
    const dt = getBrazilianDateTime();
    const direction = change.isAbove ? 'ACIMA' : 'ABAIXO';
    const emoji = change.isAbove ? '🔴⤴️' : '🟢⤵️';
    
    let message = `<i>`;
    message += `${emoji} <b>👑❅✧❅ BTC ❅✧❅👑  EMA 55 - ${change.timeframe}</b> ${emoji}\n`;
    message += ` PREÇO ${direction} DA EMA 55\n\n`;
    message += ` Timeframe: ${change.timeframe}\n`;
    message += ` Preço Atual: ${formatPrice(change.currentPrice)} USDT\n`;
    message += ` EMA 55: ${formatPrice(change.ema)} USDT\n`;
    message += ` Distância: ${change.distance}%\n\n`;
    
    message += ` Timeframes:\n`;
    for (const [tf, data] of Object.entries(btcData.results)) {
        const tfEmoji = data.isAbove ? '⤴️' : '⤵️';
        const tfStatus = data.isAbove ? 'ACIMA' : 'ABAIXO';
        message += `  ${tfEmoji} ${tf}: ${tfStatus} (${data.distance}%)\n`;
    }
    
    message += ` Indicadores :\n`;
    message += `  LSR: ${btcData.lsr.toFixed(2)} (${btcData.lsrTrend === 'rising' ? '📈 Subindo' : (btcData.lsrTrend === 'falling' ? '📉 Caindo' : '⏺ Estável')})\n`;
    message += `  Funding: ${btcData.fundingPercent.toFixed(4)}% ${btcData.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
    message += `  RSI (1h): ${btcData.rsi?.toFixed(1) || 'N/A'} ${getRSIEmoji(btcData.rsi)}\n`;
    message += `  CVD: ${btcData.cvdDirection}\n`;
    
    if (btcData.stoch4h || btcData.stoch1d) {
        message += ` ${formatStochMessage(btcData.stoch4h, btcData.stoch1d)}`;
    }
    if (btcData.cci4h || btcData.cci1d) {
        message += ` ${formatCCIMessage(btcData.cci4h, btcData.cci1d)}`;
    }
    
    if (btcData.bollingerBuy || btcData.bollingerSell) {
        message += ` Bollinger: ${btcData.bollingerBuy ? 'Toque na banda inferior ✅' : (btcData.bollingerSell ? 'Toque na banda superior ✅' : 'Neutro')}\n`;
    }
    
    message += `  ${dt.full}\n`;
    message += `</i>`;
    
    await sendToTelegram(message);
    log(` ALERTA BTC ${change.timeframe}: ${direction} da EMA 55`, 'alert');
}

// =====================================================================
// === ENVIAR STATUS INICIAL DO BTC ===
// =====================================================================
async function sendBTCInitialStatus(btcData) {
    const dt = getBrazilianDateTime();
    
    let message = `<i>`;
    message += `<b>👑❅✧❅ BTC ❅✧❅👑</b> \n`;
    message += ` Preço Atual: ${formatPrice(btcData.currentPrice)} USDT\n`;
    message += ` POSIÇÃO EM RELAÇÃO À EMA 55:\n`;
    
    for (const [tf, data] of Object.entries(btcData.results)) {
        const emoji = data.isAbove ? '⤴️' : '⤵️';
        const status = data.isAbove ? 'ACIMA' : 'ABAIXO';
        message += `  ${emoji} ${tf}: ${status} (${data.distance}%)\n`;
    }
    
    message += ` Indicadores :\n`;
    message += `  LSR: ${btcData.lsr.toFixed(2)} (${btcData.lsrTrend === 'rising' ? '📈 Subindo' : (btcData.lsrTrend === 'falling' ? '📉 Caindo' : '⏺ Estável')})\n`;
    message += `  Funding: ${btcData.fundingPercent.toFixed(4)}% ${btcData.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
    message += `  RSI (1h): ${btcData.rsi?.toFixed(1) || 'N/A'} ${getRSIEmoji(btcData.rsi)}\n`;
    message += `  CVD: ${btcData.cvdDirection}\n`;
    
    if (btcData.stoch4h || btcData.stoch1d) {
        message += ` ${formatStochMessage(btcData.stoch4h, btcData.stoch1d)}`;
    }
    if (btcData.cci4h || btcData.cci1d) {
        message += ` ${formatCCIMessage(btcData.cci4h, btcData.cci1d)}`;
    }
    
    message += ` Sistema monitorando !\n`;
    message += ` ${dt.full}\n`;
    message += `</i>`;
    
    await sendToTelegram(message);
    log(`📢 STATUS INICIAL BTC ENVIADO`, 'alert');
}

// =====================================================================
// === MONITOR ESPECÍFICO DO BTC ===
// =====================================================================
let lastBTCScan = 0;

async function scanBTC() {
    const now = Date.now();
    const intervalMs = CONFIG.MONITOR.BTC_MONITOR.CHECK_INTERVAL_SECONDS * 1000;
    
    if (now - lastBTCScan < intervalMs) return;
    lastBTCScan = now;
    
    try {
        const btcData = await checkBTCByTimeframe();
        
        if (Object.keys(btcData.results).length === 0) {
            console.log(`⚠️ BTC: Nenhum timeframe válido`);
            return;
        }
        
        if (!initialStatusSent) {
            console.log(`📡 Enviando status inicial do BTC...`);
            await sendBTCInitialStatus(btcData);
            initialStatusSent = true;
            saveBTCTimeframeState();
            console.log(`✅ Status inicial BTC enviado com sucesso!`);
        }
        
        if (btcData.hasChanges && btcData.changesList.length > 0) {
            for (const change of btcData.changesList) {
                if (canAlertBTC(change.timeframe)) {
                    await sendBTCAlert(change, btcData);
                    markBTCAlerted(change.timeframe);
                    await delay(2000);
                } else {
                    console.log(`⏸️ BTC ${change.timeframe} em cooldown - alerta não enviado`);
                }
            }
        }
        
        let statusLog = ` BTC Status: `;
        for (const [tf, data] of Object.entries(btcData.results)) {
            statusLog += `${tf}:${data.isAbove ? '🔼' : '🔽'} `;
        }
        console.log(statusLog);
        
    } catch (error) {
        log(`Erro no scan BTC: ${error.message}`, 'error');
    }
}

// =====================================================================
// === ENVIAR MENSAGEM TELEGRAM ===
// =====================================================================
async function sendToTelegram(message) {
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        let finalMessage = message;
        
        finalMessage = finalMessage.replace(/<i><\/i>/g, '');
        finalMessage = finalMessage.replace(/<i>\s*<\/i>/g, '');
        
        const openTags = (finalMessage.match(/<i>/g) || []).length;
        const closeTags = (finalMessage.match(/<\/i>/g) || []).length;
        if (openTags !== closeTags) {
            finalMessage = finalMessage.replace(/<[^>]*>/g, '');
        }
        
        if (finalMessage.length > 4000) {
            finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
        }
        
        finalMessage = finalMessage.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, '&amp;');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: finalMessage,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        const responseText = await response.text();
        
        if (response.ok) {
            console.log(`✅ Alerta enviado com sucesso!`);
            return true;
        } else {
            console.log(`❌ Erro Telegram: ${responseText}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Telegram exception: ${error.message}`);
        return false;
    }
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<b> TITANIUM PRIME X </b>\n\n`;
    msg += `<i>✅</i>\n`;
    
   
    await sendToTelegram(msg);
}

// =====================================================================
// === MONITOR PRINCIPAL (SCAN CONTÍNUO) ===
// =====================================================================
const cvdManager = new CVDManager();
let isScanning = false;

async function scanAndAlert() {
    if (isScanning) return;
    isScanning = true;
    
    try {
        const symbols = await getAllSymbols();
        if (!symbols.length) return;
        
        log(`🔍 Escaneando ${symbols.length} símbolos...`, 'info');
        
        for (const s of symbols) {
            if (!cvdManager.subscribedSymbols.has(s.symbol)) {
                cvdManager.subscribeToSymbol(s.symbol);
            }
        }
        
        let alertCount = 0;
        for (const symbolData of symbols) {
            await checkAndAlert(symbolData, cvdManager);
            alertCount++;
            
            if (alertCount % 10 === 0) {
                await delay(100);
            }
        }
        
        log(`✅ Scan completo. ${alertCount} ativos verificados.`, 'success');
        
    } catch (error) {
        log(`Erro no scan: ${error.message}`, 'error');
    } finally {
        isScanning = false;
    }
}

// =====================================================================
// === INICIAR MONITOR ===
// =====================================================================
async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X - MODO ALERTA INSTANTÂNEO');
    console.log('📊 Scanner contínuo - Alerta imediato quando critérios são atendidos');
    console.log(`📊 NOVO: Volume Momentum Bull/Bear (Stoch + CCI 4H)`);
    console.log(`⏱️ Cooldown Altcoins: ${CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES} minutos`);
    console.log(`🟢🟡 MONITOR BTC - Alerta por TIMEFRAME INDIVIDUAL`);
    console.log(`📌 Alertará SEMPRE que QUALQUER timeframe cruzar a EMA 55`);
    console.log('='.repeat(70));
    
    loadAlertedSymbols();
    loadBTCTimeframeState();
    loadVolumeMomentumMemory();
    
    await sendInitMessage();
    
    cvdManager.subscribeToSymbol('BTCUSDT');
    
    console.log(`📡 Obtendo dados do BTC para status inicial...`);
    const initialBTCData = await checkBTCByTimeframe();
    if (Object.keys(initialBTCData.results).length > 0) {
        console.log(`📡 Enviando status inicial do BTC...`);
        await sendBTCInitialStatus(initialBTCData);
        initialStatusSent = true;
        saveBTCTimeframeState();
        console.log(`✅ Status inicial BTC enviado com sucesso!`);
    } else {
        console.log(`⚠️ Não foi possível obter dados do BTC para status inicial`);
    }
    
    await scanAndAlert();
    
    setInterval(async () => {
        await scanAndAlert();
    }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
    
    setInterval(async () => {
        await scanBTC();
    }, CONFIG.MONITOR.BTC_MONITOR.CHECK_INTERVAL_SECONDS * 1000);
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    saveVolumeMomentumMemory();
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
