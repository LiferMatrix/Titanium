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
const BTC_ALERTED_FILE = path.join(__dirname, 'btcAlertedHistory.json');

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vV',
        CHAT_ID: '-100259'
    },
    MONITOR: {
        SCAN_INTERVAL_SECONDS: 60,
        MIN_VOLUME_USDT: 1000000,
        MAX_SYMBOLS: 300,
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
        // CONFIGURAÇÃO ESPECÍFICA DO BTC
        BTC_MONITOR: {
            ENABLED: true,
            TIMEFRAMES: ['15m', '1h', '4h', '12h', '1d'],
            EMA_PERIOD: 55,
            ALERT_COOLDOWN_MINUTES: 30, // Cooldown de 30 minutos para BTC
            CHECK_INTERVAL_SECONDS: 120  // Verifica BTC a cada 2 minutos
        }
    }
};

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();
const bollingerCache = new Map();
const lsrTrendCache = new Map();
const alertedSymbols = new Map();
const btcAlertedHistory = new Map(); // Histórico de alertas do BTC

// =====================================================================
// === CARREGAR ALERTAS ANTERIORES ===
// =====================================================================
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

// Carregar histórico de alertas do BTC
function loadBTCAlertedHistory() {
    try {
        if (fs.existsSync(BTC_ALERTED_FILE)) {
            const data = fs.readFileSync(BTC_ALERTED_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [timestamp, alertData] of Object.entries(loaded)) {
                btcAlertedHistory.set(timestamp, alertData);
            }
            console.log(`📂 ${btcAlertedHistory.size} alertas BTC anteriores carregados`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar alertas BTC: ${error.message}`);
    }
}

function saveBTCAlertedHistory(alertData) {
    try {
        const data = {};
        for (const [timestamp, value] of btcAlertedHistory.entries()) {
            data[timestamp] = value;
        }
        // Adicionar novo alerta
        data[Date.now()] = alertData;
        
        // Manter apenas últimos 100 alertas
        const entries = Object.entries(data);
        if (entries.length > 100) {
            const sorted = entries.sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
            const latest100 = Object.fromEntries(sorted.slice(0, 100));
            fs.writeFileSync(BTC_ALERTED_FILE, JSON.stringify(latest100, null, 2));
        } else {
            fs.writeFileSync(BTC_ALERTED_FILE, JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.log(`⚠️ Erro ao salvar alerta BTC: ${error.message}`);
    }
}

function canAlertBTC() {
    const now = Date.now();
    // Verificar último alerta
    let lastAlertTime = 0;
    for (const [timestamp] of btcAlertedHistory.entries()) {
        if (parseInt(timestamp) > lastAlertTime) {
            lastAlertTime = parseInt(timestamp);
        }
    }
    
    const cooldownMs = CONFIG.MONITOR.BTC_MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (now - lastAlertTime) > cooldownMs;
}

function markBTCAlerted(alertData) {
    saveBTCAlertedHistory(alertData);
}

// Verifica se o símbolo pode ser alertado novamente
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
// === VERIFICAR CONDIÇÕES DA EMA PARA BTC ===
// =====================================================================
async function checkBTCEMA() {
    try {
        const symbol = 'BTCUSDT';
        const results = {};
        let allAbove = true;
        let allBelow = true;
        let emaData = [];
        
        for (const timeframe of CONFIG.MONITOR.BTC_MONITOR.TIMEFRAMES) {
            // Buscar candles suficientes para calcular EMA 55
            const candles = await getCandles(symbol, timeframe, 100);
            if (!candles || candles.length < 60) {
                console.log(`⚠️ Dados insuficientes para BTC ${timeframe}`);
                continue;
            }
            
            const prices = candles.map(c => c.close);
            const currentPrice = prices[prices.length - 1];
            const ema = calculateEMA(prices, CONFIG.MONITOR.BTC_MONITOR.EMA_PERIOD);
            
            if (ema === null) continue;
            
            const isAbove = currentPrice > ema;
            const isBelow = currentPrice < ema;
            const distance = ((currentPrice - ema) / ema) * 100;
            
            results[timeframe] = {
                currentPrice,
                ema,
                isAbove,
                isBelow,
                distance: distance.toFixed(2)
            };
            
            emaData.push({
                timeframe,
                isAbove,
                distance: parseFloat(distance)
            });
            
            if (isAbove) allBelow = false;
            if (isBelow) allAbove = false;
        }
        
        // Buscar dados adicionais para o alerta
        const [funding, lsr, rsiValue, lsrTrendData, cvd] = await Promise.all([
            getFundingRates([symbol]).then(r => r[symbol]),
            getLSRData([symbol]).then(r => r[symbol]),
            getRSIForSymbol(symbol),
            getLSRTrend(symbol),
            getCVDData(symbol)
        ]);
        
        const bollingerBuy = await checkBollingerTouch(symbol, 'buy');
        const bollingerSell = await checkBollingerTouch(symbol, 'sell');
        
        // Determinar sinal
        let signal = null;
        let signalType = null;
        
        // SINAL DE ALTA (COMPRA) - Preço abaixo da EMA em todos os timeframes
        if (allBelow && emaData.length >= 3) {
            // Verificar se está significativamente abaixo (pelo menos -1% em algum timeframe)
            const hasSignificantBelow = emaData.some(d => d.distance <= -1);
            if (hasSignificantBelow) {
                signal = 'BULL';
                signalType = '🟢 PREÇO ABAIXO DA EMA 55 EM TODOS TIMEFRAMES';
            }
        }
        
        // SINAL DE BAIXA (VENDA) - Preço acima da EMA em todos os timeframes
        if (allAbove && emaData.length >= 3) {
            // Verificar se está significativamente acima (pelo menos +1% em algum timeframe)
            const hasSignificantAbove = emaData.some(d => d.distance >= 1);
            if (hasSignificantAbove) {
                signal = 'BEAR';
                signalType = '🔴 PREÇO ACIMA DA EMA 55 EM TODOS TIMEFRAMES';
            }
        }
        
        return {
            signal,
            signalType,
            results,
            emaData,
            funding: funding || 0,
            fundingPercent: (funding || 0) * 100,
            lsr: lsr || 0,
            lsrTrend: lsrTrendData.trend,
            rsi: rsiValue,
            cvdDirection: cvd || '⏺',
            bollingerBuy,
            bollingerSell,
            currentPrice: results[Object.keys(results)[0]]?.currentPrice || 0
        };
        
    } catch (error) {
        console.log(`❌ Erro ao verificar EMA BTC: ${error.message}`);
        return { signal: null };
    }
}

// Função auxiliar para buscar CVD
async function getCVDData(symbol) {
    try {
        // CVD já está sendo gerenciado pelo CVDManager
        // Esta função é apenas para compatibilidade
        return '⏺';
    } catch (error) {
        return '⏺';
    }
}

// =====================================================================
// === ENVIAR ALERTA EXCLUSIVO DO BTC ===
// =====================================================================
async function sendBTCAlert(btcData) {
    const dt = getBrazilianDateTime();
    
    let message = `<i>\n`;
    message += `${btcData.signal === 'BULL' ? '🟢' : '🔴'} BTC - EMA 55 ${btcData.signal === 'BULL' ? '🟢' : '🔴'}\n`;
    message += ` Sinal: ${btcData.signalType}\n\n`;
    message += ` Preço : ${formatPrice(btcData.currentPrice)} USDT\n\n`;
    message += ` EMA 55 por Timeframe:\n`;
    
    for (const [tf, data] of Object.entries(btcData.results)) {
        const emoji = data.isAbove ? '🔼' : (data.isBelow ? '🔽' : '⚪');
        const status = data.isAbove ? 'ACIMA' : (data.isBelow ? 'ABAIXO' : 'NEUTRO');
        message += `  ${emoji} ${tf}: ${status} (${data.distance}%)\n`;
    }
    
    message += ` Indicadores:\n`;
    message += `   LSR: ${btcData.lsr.toFixed(2)} (${btcData.lsrTrend === 'rising' ? '📈 Subindo' : (btcData.lsrTrend === 'falling' ? '📉 Caindo' : '⏺ Estável')})\n`;
    message += `   Funding: ${btcData.fundingPercent.toFixed(4)}% ${btcData.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
    message += `   RSI (1h): ${btcData.rsi?.toFixed(1) || 'N/A'} ${getRSIEmoji(btcData.rsi)}\n`;
    message += `   CVD: ${btcData.cvdDirection}\n`;
    
    if (btcData.bollingerBuy || btcData.bollingerSell) {
        message += `  📊 Bollinger: ${btcData.bollingerBuy ? 'Toque na banda inferior ✅' : (btcData.bollingerSell ? 'Toque na banda superior ✅' : 'Neutro')}\n`;
    }
    
    message += `\n ${dt.full}\n`;
    message += `</i>`;
    
    await sendToTelegram(message);
    log(`📢 ALERTA BTC ENVIADO: ${btcData.signalType}`, 'alert');
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
        const btcData = await checkBTCEMA();
        
        if (btcData.signal && canAlertBTC()) {
            await sendBTCAlert(btcData);
            markBTCAlerted(btcData);
        } else if (btcData.signal && !canAlertBTC()) {
            log(`⏸️ BTC em cooldown - alerta não enviado`, 'info');
        }
        
    } catch (error) {
        log(`Erro no scan BTC: ${error.message}`, 'error');
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
            direction: '⏺',
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
        else data.direction = '⏺';
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
    
    getCVDValue(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return '⏺';
        return data.direction;
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
    
    // DIVERGÊNCIA DE ALTA (BULLISH)
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
    
    // DIVERGÊNCIA DE BAIXA (BEARISH)
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
            
        } catch (error) {
            // continua
        }
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
// === VERIFICAR CRITÉRIOS E ENVIAR ALERTA ===
// =====================================================================
async function checkAndAlert(symbolData, cvdManager) {
    const { symbol: fullSymbol, price, volume24h } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
    
    try {
        // Buscar dados necessários
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
        
        // Criar objeto do ativo
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
            cvdDirection: cvd ? cvd.direction : '⏺',
            divergences,
            bollingerBuy,
            bollingerSell
        };
        
        // VERIFICAR SETUP BEAR
        const isBear = asset.divergences.hasBearish15mPlusOther &&
                       asset.rsi > CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD &&
                       asset.bollingerSell &&
                       asset.lsr > 2.6 &&
                       asset.funding > 0 &&
                       asset.lsrTrend === 'rising';
        
        // VERIFICAR SETUP BULL
        const isBull = asset.divergences.hasBullish15mPlusOther &&
                       asset.rsi < CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD &&
                       asset.bollingerBuy &&
                       asset.lsr < 2.5 &&
                       asset.funding < 0 &&
                       asset.lsrTrend === 'falling';
        
        // Enviar alerta se aplicável
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
// === ENVIAR ALERTA INDIVIDUAL PARA TELEGRAM ===
// =====================================================================
async function sendAlert(asset, type) {
    const dt = getBrazilianDateTime();
    
    let message = '';
    
    if (type === 'BULL') {
        message = `🟢<i>Analisar Compra</i> \n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 ' : '📈 '})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += `<i> RSI:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        message += `<i> Divergência:</i> ${asset.divergences.bullishTimeframes.join(' → ')}\n`;
        message += `<i> ${dt.full}</i>`;
    } else {
        message = `🔴<i>Analisar Correção</i> \n`;
        message += `<i> Ativo:</i> <code>${asset.symbol}</code>\n`;
        message += `<i> Preço:</i> <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += `<i> LSR:</i> <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 ' : '📉 '})\n`;
        message += `<i> Funding:</i> <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += `<i> RSI:</i> <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += `<i> CVD:</i> ${asset.cvdDirection}\n`;
        message += `<i> Divergência:</i> ${asset.divergences.bearishTimeframes.join(' → ')}\n`;
        message += `<i> ${dt.full}</i>`;
    }
    
    await sendToTelegram(message);
    await delay(CONFIG.MONITOR.TELEGRAM_DELAY_MS);
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
    let msg = `<b>🚀 TITANIUM PRIME X - ATIVO</b>\n\n`;
    msg += `<i>✅ Scanner em tempo real ativo</i>\n`;
    msg += `<i>📊 Critério: Divergências RSI + Bollinger + LSR + Funding</i>\n`;
    msg += `<i>⏱️ Cooldown: ${CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES} minutos por ativo</i>\n`;
    msg += `<i>🔍 Escaneando a cada ${CONFIG.MONITOR.SCAN_INTERVAL_SECONDS} segundos...</i>\n\n`;
    msg += `<i>🟢🟡 MONITOR BTC ATIVO - EMA 55 em 15m/1h/4h/12h/1d</i>\n`;
    msg += `<i>Os alertas serão enviados assim que os critérios forem atendidos!</i>`;
   
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
        
        // Inscrever em todos os símbolos para CVD
        for (const s of symbols) {
            if (!cvdManager.subscribedSymbols.has(s.symbol)) {
                cvdManager.subscribeToSymbol(s.symbol);
            }
        }
        
        // Verificar cada símbolo individualmente
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
    console.log(`⏱️ Cooldown: ${CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES} minutos por ativo`);
    console.log(`🟢🟡 MONITOR BTC ATIVO - EMA 55 (15m/1h/4h/12h/1d)`);
    console.log('='.repeat(70));
    
    // Carregar históricos
    loadAlertedSymbols();
    loadBTCAlertedHistory();
    
    // Enviar mensagem de inicialização
    await sendInitMessage();
    
    // Inscrever BTC para CVD
    cvdManager.subscribeToSymbol('BTCUSDT');
    
    // Primeiro scan imediato
    await scanAndAlert();
    
    // Configurar intervalo de scan para outros ativos
    setInterval(async () => {
        await scanAndAlert();
    }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
    
    // Configurar monitor específico do BTC (roda separadamente)
    setInterval(async () => {
        await scanBTC();
    }, 30000); // Verifica BTC a cada 30 segundos
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
