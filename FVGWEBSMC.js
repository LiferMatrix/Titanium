const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === LIMITE DE TAMANHO PARA CACHES ===
// =====================================================================
const MAX_CACHE_SIZE = 500;

function addToCache(cache, key, value, maxSize = MAX_CACHE_SIZE) {
    if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, value);
}

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const ALERTED_FILE = path.join(__dirname, 'alertedSymbols.json');

// =====================================================================
// === CONFIGURAÇÃO COM SEU TOKEN E CHAT ID ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979',
        MESSAGE_DELAY_MS: 3000,
        MAX_MESSAGES_PER_MINUTE: 20,
        BURST_DELAY_MS: 5000,
        RETRY_COUNT: 3,
        RETRY_DELAY_MS: 5000
    },
    MONITOR: {
        SCAN_INTERVAL_SECONDS: 120,
        MIN_VOLUME_USDT: 100000,
        MAX_SYMBOLS: 550,
        EXCLUDE_SYMBOLS: ['USDCUSDT', 'BUSDUSDT', 'TUSDUSDT'],
        ALERT_COOLDOWN_MINUTES: 60,
        CONFIRMATION_CANDLES: 1,
        EMA_PERIODS: {
            FAST: 8,
            SHORT: 55,
            MEDIUM: 144,
            LONG: 233,
            VERY_LONG: 377,
            EXTREME: 610,
            ULTIMATE: 890
        },
        SMC: {
            LOOKBACK_CANDLES: 200,
            MIN_CONFIDENCE: 60,
            MIN_SCORE: 60, // ALTERADO: Score mínimo para alerta = 60 (era 40)
            ATR_PERIOD: 14,
            RISK_REWARD: 2.0,
            ORDER_BLOCK_TOLERANCE: 0.002,
            LIQUIDITY_SWEEP_LOOKBACK: 20,
            FVG_PROXIMITY_THRESHOLD: 1.0, // ALTERADO: Distância máxima do FVG = 1%
            FVG_CONFIRMATION_CANDLES: 1,
            TARGETS: [1.5, 2.5, 4.0],
            PARTIAL_CLOSE: [25, 25, 50],
            EXTREME_OVERSOLD_RSI: 35,
            EXTREME_OVERBOUGHT_RSI: 70,
            EXTREME_OVERSOLD_STOCH: 25,
            EXTREME_OVERBOUGHT_STOCH: 75,
            DIVERGENCE_LOOKBACK: 100,
            DIVERGENCE_MIN_STRENGTH: 2,
            CONVERGENCE_MIN_STRENGTH: 2
        }
    }
};

// =====================================================================
// === RATE LIMITER GLOBAL ===
// =====================================================================
class RateLimiter {
    constructor(maxRequestsPerMinute = 1500) {
        this.maxRequests = maxRequestsPerMinute;
        this.requests = [];
        this.pendingRequests = [];
        this.isProcessing = false;
    }
    async acquire() {
        return new Promise((resolve) => {
            this.pendingRequests.push(resolve);
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        while (this.pendingRequests.length > 0) {
            const now = Date.now();
            const windowStart = now - 60000;
            this.requests = this.requests.filter(t => t > windowStart);
           
            if (this.requests.length >= this.maxRequests) {
                const oldestRequest = this.requests[0];
                const waitTime = 60000 - (now - oldestRequest);
                if (waitTime > 0) {
                    await this.delay(waitTime + 100);
                }
                continue;
            }
           
            const resolve = this.pendingRequests.shift();
            this.requests.push(Date.now());
            resolve();
            await this.delay(30);
        }
        this.isProcessing = false;
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const rateLimiter = new RateLimiter(1500);

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const alertedSymbols = new Map();
const candlesCache = new Map();
const atrCache = new Map();
const oiHistoryCache = new Map();
const stochCache = new Map();
const emaCache = new Map();
const divergenceCache = new Map();
const convergenceCache = new Map();
const rsiCache = new Map();

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

function canAlert(symbol) {
    const lastAlert = alertedSymbols.get(symbol);
    if (!lastAlert) return true;
    const cooldownMs = CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markAlerted(symbol) {
    alertedSymbols.set(symbol, Date.now());
    saveAlertedSymbols();
}

// =====================================================================
// === SISTEMA DE FILA PARA TELEGRAM ===
// =====================================================================
class TelegramQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.messageCount = 0;
        this.lastMessageTime = 0;
        this.minuteResetTime = Date.now();
    }
    async add(message, priority = false) {
        return new Promise((resolve, reject) => {
            this.queue.push({ message, resolve, reject, priority, timestamp: Date.now() });
            this.queue.sort((a, b) => {
                if (a.priority && !b.priority) return -1;
                if (!a.priority && b.priority) return 1;
                return a.timestamp - b.timestamp;
            });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
           
            if (now - this.minuteResetTime >= 60000) {
                this.messageCount = 0;
                this.minuteResetTime = now;
            }
           
            if (this.messageCount >= CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE) {
                const waitTime = 60000 - (now - this.minuteResetTime);
                await delay(waitTime + 1000);
                continue;
            }
           
            const timeSinceLastMessage = now - this.lastMessageTime;
            if (timeSinceLastMessage < CONFIG.TELEGRAM.MESSAGE_DELAY_MS) {
                const waitTime = CONFIG.TELEGRAM.MESSAGE_DELAY_MS - timeSinceLastMessage;
                await delay(waitTime);
            }
           
            const item = this.queue.shift();
           
            try {
                await this.sendWithRetry(item.message);
                item.resolve(true);
                this.messageCount++;
                this.lastMessageTime = Date.now();
            } catch (error) {
                item.reject(error);
            }
        }
        this.isProcessing = false;
    }
    async sendWithRetry(message, attempt = 1) {
        try {
            const token = CONFIG.TELEGRAM.BOT_TOKEN;
            const chatId = CONFIG.TELEGRAM.CHAT_ID;
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
           
            let finalMessage = message;
           
            if (finalMessage.length > 4000) {
                finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
            }
           
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
           
            if (response.ok) {
                return true;
            } else {
                const errorText = await response.text();
                if (response.status === 429 && attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                    const retryAfter = parseInt(errorText.match(/retry after (\d+)/)?.[1] || '5');
                    await delay(retryAfter * 1000 + 1000);
                    return this.sendWithRetry(message, attempt + 1);
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                await delay(CONFIG.TELEGRAM.RETRY_DELAY_MS * attempt);
                return this.sendWithRetry(message, attempt + 1);
            }
            throw error;
        }
    }
}

const telegramQueue = new TelegramQueue();

// =====================================================================
// === BUSCAR CANDLES COM CACHE ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const now = Date.now();
    const cached = candlesCache.get(cacheKey);
   
    if (cached && (now - cached.timestamp) < 60000) {
        return cached.data;
    }
   
    try {
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
       
        if (!Array.isArray(data)) return [];
       
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
       
        addToCache(candlesCache, cacheKey, { data: candles, timestamp: now });
        return candles;
    } catch (error) {
        return [];
    }
}

// =====================================================================
// === CÁLCULO DE EMA ===
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
// === CÁLCULO DE RSI ===
// =====================================================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    return rsi;
}

async function getRSI(symbol, timeframe = '1h') {
    try {
        const cacheKey = `${symbol}_rsi_${timeframe}`;
        const now = Date.now();
        const cached = rsiCache.get(cacheKey);
        
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 30) {
            return { value: 50, emoji: '' };
        }
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        
        let emoji = '';
        if (rsi < 25) emoji = '🔵';
        else if (rsi < 35) emoji = '🟢';
        else if (rsi < 45) emoji = '🟡';
        else if (rsi < 58) emoji = '🟠';
        else if (rsi <= 75) emoji = '🔴';
        else emoji = '🔥';
        
        const result = { value: rsi, emoji };
        
        addToCache(rsiCache, cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return { value: 50, emoji: '' };
    }
}

// =====================================================================
// === ANÁLISE DE EMAS MULTI-TIMEFRAME ===
// =====================================================================
async function analyzeMultiTimeframeEMAs(symbol) {
    try {
        const cacheKey = `${symbol}_ema_multi`;
        const now = Date.now();
        const cached = emaCache.get(cacheKey);
        
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const maxPeriod = Math.max(...Object.values(CONFIG.MONITOR.EMA_PERIODS));
        const timeframes = ['1h', '4h', '1d'];
        const result = {};
        
        const [candles1h, candles4h, candles1d] = await Promise.all([
            getCandles(symbol, '1h', maxPeriod + 10),
            getCandles(symbol, '4h', maxPeriod + 10),
            getCandles(symbol, '1d', maxPeriod + 10)
        ]);
        
        const timeframesData = { '1h': candles1h, '4h': candles4h, '1d': candles1d };
        const periods = CONFIG.MONITOR.EMA_PERIODS;
        
        for (const tf of timeframes) {
            const candles = timeframesData[tf];
            if (!candles || candles.length < maxPeriod) continue;
            
            const closes = candles.map(c => c.close);
            const currentPrice = closes[closes.length - 1];
            
            const emas = {};
            emas.FAST = calculateEMA(closes, periods.FAST);
            emas.SHORT = calculateEMA(closes, periods.SHORT);
            emas.MEDIUM = calculateEMA(closes, periods.MEDIUM);
            emas.LONG = calculateEMA(closes, periods.LONG);
            emas.VERY_LONG = calculateEMA(closes, periods.VERY_LONG);
            emas.EXTREME = calculateEMA(closes, periods.EXTREME);
            emas.ULTIMATE = calculateEMA(closes, periods.ULTIMATE);
            
            let aboveCount = 0;
            let belowCount = 0;
            
            for (const value of Object.values(emas)) {
                if (value !== null) {
                    if (currentPrice > value) aboveCount++;
                    if (currentPrice < value) belowCount++;
                }
            }
            
            const isAboveEMA55 = currentPrice > emas.SHORT;
            const isAboveEMA233 = currentPrice > emas.LONG;
            
            let trend = 'NEUTRA';
            let confidence = 50;
            let direction = '';
            
            if (isAboveEMA55 && isAboveEMA233 && aboveCount >= 5) {
                trend = 'ALTA';
                confidence = Math.min(75 + (aboveCount * 2), 94);
                direction = '🟢';
            } else if (!isAboveEMA55 && !isAboveEMA233 && belowCount >= 5) {
                trend = 'BAIXA';
                confidence = Math.min(75 + (belowCount * 2), 94);
                direction = '🔴';
            } else if (isAboveEMA55 && aboveCount >= 3) {
                trend = 'ALTA';
                confidence = 65;
                direction = '🟢';
            } else if (!isAboveEMA55 && belowCount >= 3) {
                trend = 'BAIXA';
                confidence = 65;
                direction = '🔴';
            }
            
            result[tf] = { trend, confidence, direction, aboveCount, belowCount, isAboveEMA55, isAboveEMA233 };
        }
        
        addToCache(emaCache, cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMAs: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === DETECÇÃO DE DIVERGÊNCIAS DE RSI ===
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

function detectRSIDivergences(prices, rsiValues, timeframe) {
    if (prices.length < 30 || rsiValues.length < 30) return { bullish: [], bearish: [] };
    
    const pricePivots = findPivots(prices, 5);
    const rsiPivots = findPivots(rsiValues, 5);
    
    const divergences = { bullish: [], bearish: [] };
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            const priceDistance = Math.abs(priceLow2.index - priceLow1.index);
            
            if (priceLower && priceDistance >= 5) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 3);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 3);
                
                if (rsiLow1 && rsiLow2 && rsiLow2.value > rsiLow1.value) {
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.DIVERGENCE_MIN_STRENGTH) {
                        divergences.bullish.push({
                            type: 'bullish',
                            timeframe: timeframe,
                            strength: strength,
                            emoji: '🎯#Pivô⤴️🟢'
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
            const priceDistance = Math.abs(priceHigh2.index - priceHigh1.index);
            
            if (priceHigher && priceDistance >= 5) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 3);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 3);
                
                if (rsiHigh1 && rsiHigh2 && rsiHigh2.value < rsiHigh1.value) {
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.DIVERGENCE_MIN_STRENGTH) {
                        divergences.bearish.push({
                            type: 'bearish',
                            timeframe: timeframe,
                            strength: strength,
                            emoji: '🎯#Pivô⤵️🔻'
                        });
                    }
                }
            }
        }
    }
    
    return divergences;
}

async function analyzeDivergences(symbol) {
    try {
        const cacheKey = `${symbol}_divergences`;
        const now = Date.now();
        const cached = divergenceCache.get(cacheKey);
        
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '1d', '3d', '1w'];
        const result = {
            bullish: [],
            bearish: [],
            hasBullish: false,
            hasBearish: false,
            summary: ' Sem divergências'
        };
        
        for (const tf of timeframes) {
            try {
                const candles = await getCandles(symbol, tf, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
                if (!candles || candles.length < 50) continue;
                
                const prices = candles.map(c => c.close);
                const rsiValues = [];
                for (let i = 14; i < prices.length; i++) {
                    const slice = prices.slice(i - 14, i + 1);
                    rsiValues.push(calculateRSI(slice, 14));
                }
                if (rsiValues.length < 30) continue;
                
                const divergences = detectRSIDivergences(prices, rsiValues, tf);
                
                if (divergences.bullish.length > 0) {
                    result.bullish.push(...divergences.bullish);
                    result.hasBullish = true;
                }
                if (divergences.bearish.length > 0) {
                    result.bearish.push(...divergences.bearish);
                    result.hasBearish = true;
                }
                
            } catch (error) {}
        }
        
        if (result.hasBullish && result.hasBearish) {
            result.summary = '🔄 Divergências Mistas';
        } else if (result.hasBullish) {
            result.summary = `🟢 Divergência de ALTA em: ${result.bullish.map(d => d.timeframe).join(', ')}`;
        } else if (result.hasBearish) {
            result.summary = `🔴 Divergência de BAIXA em: ${result.bearish.map(d => d.timeframe).join(', ')}`;
        }
        
        addToCache(divergenceCache, cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return { bullish: [], bearish: [], hasBullish: false, hasBearish: false, summary: '❌Sem divergências' };
    }
}

// =====================================================================
// === DETECÇÃO DE CONVERGÊNCIAS DE RSI ===
// =====================================================================
function detectRSIConvergences(prices, rsiValues, timeframe) {
    if (prices.length < 30 || rsiValues.length < 30) return { bullish: [], bearish: [] };
    
    const pricePivots = findPivots(prices, 5);
    const rsiPivots = findPivots(rsiValues, 5);
    
    const convergences = { bullish: [], bearish: [] };
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceHigher = priceLow2.value > priceLow1.value;
            const priceDistance = Math.abs(priceLow2.index - priceLow1.index);
            
            if (priceHigher && priceDistance >= 5) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 3);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 3);
                
                if (rsiLow1 && rsiLow2 && rsiLow2.value > rsiLow1.value) {
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.CONVERGENCE_MIN_STRENGTH) {
                        const targetPrice = priceLow2.value + (priceLow2.value - priceLow1.value) * 0.5;
                        convergences.bullish.push({
                            type: 'bullish_convergence',
                            timeframe: timeframe,
                            strength: strength,
                            targetPrice: targetPrice,
                            emoji: '🟢'
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
            
            const priceLower = priceHigh2.value < priceHigh1.value;
            const priceDistance = Math.abs(priceHigh2.index - priceHigh1.index);
            
            if (priceLower && priceDistance >= 5) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 3);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 3);
                
                if (rsiHigh1 && rsiHigh2 && rsiHigh2.value < rsiHigh1.value) {
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.CONVERGENCE_MIN_STRENGTH) {
                        const targetPrice = priceHigh2.value - (priceHigh1.value - priceHigh2.value) * 0.5;
                        convergences.bearish.push({
                            type: 'bearish_convergence',
                            timeframe: timeframe,
                            strength: strength,
                            targetPrice: targetPrice,
                            emoji: '🔴'
                        });
                    }
                }
            }
        }
    }
    
    return convergences;
}

async function analyzeConvergences(symbol) {
    try {
        const cacheKey = `${symbol}_convergences`;
        const now = Date.now();
        const cached = convergenceCache.get(cacheKey);
        
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '1d', '3d', '1w'];
        const result = {
            bullish: [],
            bearish: [],
            hasBullish: false,
            hasBearish: false,
            summary: '❌ Sem convergências'
        };
        
        for (const tf of timeframes) {
            try {
                const candles = await getCandles(symbol, tf, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
                if (!candles || candles.length < 50) continue;
                
                const prices = candles.map(c => c.close);
                const rsiValues = [];
                for (let i = 14; i < prices.length; i++) {
                    const slice = prices.slice(i - 14, i + 1);
                    rsiValues.push(calculateRSI(slice, 14));
                }
                if (rsiValues.length < 30) continue;
                
                const convergences = detectRSIConvergences(prices, rsiValues, tf);
                
                if (convergences.bullish.length > 0) {
                    result.bullish.push(...convergences.bullish);
                    result.hasBullish = true;
                }
                if (convergences.bearish.length > 0) {
                    result.bearish.push(...convergences.bearish);
                    result.hasBearish = true;
                }
                
            } catch (error) {}
        }
        
        if (result.hasBullish && result.hasBearish) {
            result.summary = '🔄 Convergências Mistas';
        } else if (result.hasBullish) {
            const targets = result.bullish.map(c => `${c.timeframe}`).join(', ');
            result.summary = `🟢 Convergência ALTA: ${targets}`;
        } else if (result.hasBearish) {
            const targets = result.bearish.map(c => `${c.timeframe}`).join(', ');
            result.summary = `🔴 Convergência BAIXA: ${targets}`;
        }
        
        addToCache(convergenceCache, cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return { bullish: [], bearish: [], hasBullish: false, hasBearish: false, summary: '❌ Sem convergências' };
    }
}

// =====================================================================
// === ANÁLISE DE CONFLITO ENTRE TIMEFRAMES ===
// =====================================================================
function analyzeTimeframeConflict(emaAnalysis) {
    if (!emaAnalysis) return { level: 'NEUTRO', message: ' Tendências neutras', score: 0 };
    
    const trends = {
        d1: emaAnalysis['1d']?.trend || 'NEUTRA',
        h4: emaAnalysis['4h']?.trend || 'NEUTRA',
        h1: emaAnalysis['1h']?.trend || 'NEUTRA'
    };
    
    const trendValues = { 'ALTA': 1, 'NEUTRA': 0, 'BAIXA': -1 };
    const sum = trendValues[trends.d1] + trendValues[trends.h4] + trendValues[trends.h1];
    
    if (sum === 3) {
        return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS', score: 100 };
    } else if (sum === 2) {
        return { level: 'LEVE', message: '🟡 2 de 3 alinhados - conflito leve', score: 66 };
    } else if (sum === 1) {
        return { level: 'MODERADO', message: '⚠️ Conflito MODERADO entre timeframes', score: 50 };
    } else if (sum === -1) {
        return { level: 'MODERADO', message: '⚠️ Conflito MODERADO entre timeframes', score: 50 };
    } else if (sum === -2) {
        return { level: 'LEVE', message: '🟡 2 de 3 alinhados - conflito leve', score: 66 };
    } else if (sum === -3) {
        return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS', score: 100 };
    }
    
    return { level: 'ALTO', message: '🔴 ALTO CONFLITO - Aguardar confirmação', score: 25 };
}

// =====================================================================
// === ANÁLISE DE QUALIDADE DO SCORE ===
// =====================================================================
function analyzeScoreQuality(score) {
    if (score >= 80) {
        return { emoji: '🏆', message: 'Setup #TOP - Alta confiança', recommendation: 'Entrada normal' };
    } else if (score >= 65) {
        return { emoji: '🔥', message: 'Setup #MUITO #BOM - Boa confiança', recommendation: 'Entrada normal' };
    } else if (score >= 50) {
        return { emoji: '✅', message: 'Setup VÁLIDO - Confiança média', recommendation: 'Entrada moderada' };
    } else {
        return { emoji: '⚠️', message: 'Setup FRACO - Confiança baixa', recommendation: 'Entrada reduzida (50%) ou aguardar' };
    }
}

// =====================================================================
// === DETECÇÃO DE FVG ===
// =====================================================================
function detectFVG(candles) {
    if (!candles || candles.length < 3) return { bullish: [], bearish: [] };
    
    const bullishFVGs = [];
    const bearishFVGs = [];
    
    for (let i = 0; i < candles.length - 2; i++) {
        const candle1 = candles[i];
        const candle3 = candles[i + 2];
        
        if (candle1.low > candle3.high) {
            const gapSize = ((candle1.low - candle3.high) / candle3.high) * 100;
            bullishFVGs.push({
                top: candle1.low,
                bottom: candle3.high,
                gapSize: gapSize,
                type: 'bullish',
                isBullish: true
            });
        }
        
        if (candle1.high < candle3.low) {
            const gapSize = ((candle3.low - candle1.high) / candle1.high) * 100;
            bearishFVGs.push({
                top: candle3.low,
                bottom: candle1.high,
                gapSize: gapSize,
                type: 'bearish',
                isBearish: true
            });
        }
    }
    
    return { bullish: bullishFVGs, bearish: bearishFVGs };
}

function findClosestConfirmedFVG(fvgs, currentPrice, currentCandles, type = null) {
    const fvgsToCheck = type === 'bullish' ? fvgs.bullish : (type === 'bearish' ? fvgs.bearish : [...fvgs.bullish, ...fvgs.bearish]);
    if (fvgsToCheck.length === 0) return null;
    
    let closest = null;
    let minDistance = Infinity;
    
    for (const fvg of fvgsToCheck) {
        let distance, targetPrice, status;
        
        if (fvg.isBullish) {
            targetPrice = fvg.bottom;
            if (currentPrice <= fvg.bottom) {
                distance = ((fvg.bottom - currentPrice) / currentPrice) * 100;
                status = 'abaixo';
            } else if (currentPrice >= fvg.top) {
                distance = ((currentPrice - fvg.top) / currentPrice) * 100;
                status = 'acima';
            } else {
                distance = 0;
                status = 'dentro';
            }
        } else {
            targetPrice = fvg.top;
            if (currentPrice >= fvg.top) {
                distance = ((currentPrice - fvg.top) / currentPrice) * 100;
                status = 'acima';
            } else if (currentPrice <= fvg.bottom) {
                distance = ((fvg.bottom - currentPrice) / currentPrice) * 100;
                status = 'abaixo';
            } else {
                distance = 0;
                status = 'dentro';
            }
        }
        
        const qualityScore = fvg.gapSize > 0.5 ? 3 : (fvg.gapSize > 0.2 ? 2 : 1);
        
        if (distance < minDistance) {
            minDistance = distance;
            closest = {
                ...fvg,
                distancePercent: distance,
                targetPrice,
                status,
                qualityScore,
                displayDistance: distance === 0 ? '' : `${distance.toFixed(2)}% ${status === 'abaixo' ? '📈 para chegar' : '📉 para chegar'}`
            };
        }
    }
    
    return closest;
}

async function analyzeFVG(symbol, timeframe, currentPrice) {
    try {
        const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.SMC.LOOKBACK_CANDLES);
        if (!candles || candles.length < 30) return null;
        
        const fvgs = detectFVG(candles);
        const closestBullish = findClosestConfirmedFVG(fvgs, currentPrice, candles, 'bullish');
        const closestBearish = findClosestConfirmedFVG(fvgs, currentPrice, candles, 'bearish');
        
        return { timeframe, closestBullish, closestBearish };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === ORDER BLOCK ===
// =====================================================================
function findOrderBlocks(candles, lookback = 50) {
    const bullishOB = [];
    const bearishOB = [];
   
    for (let i = 3; i < Math.min(candles.length, lookback); i++) {
        const candle = candles[i];
        const candle1 = candles[i-1];
        const candle2 = candles[i-2];
        const candle3 = candles[i-3];
        
        if (candle2.close < candle3.close && candle1.close < candle2.close &&
            candle.close > candle1.high && candle.volume > candle1.volume * 1.2) {
            bullishOB.push({ price: candle2.low });
        }
       
        if (candle2.close > candle3.close && candle1.close > candle2.close &&
            candle.close < candle1.low && candle.volume > candle1.volume * 1.2) {
            bearishOB.push({ price: candle2.high });
        }
    }
   
    return { bullishOB, bearishOB };
}

function checkMitigation(currentPrice, orderBlocks, tolerance = 0.002, type = 'bearish') {
    const blocks = type === 'bearish' ? orderBlocks.bearishOB : orderBlocks.bullishOB;
    for (const ob of blocks) {
        const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
        if (diffPercent <= tolerance * 100) {
            return { mitigated: true, price: ob.price, diffPercent: diffPercent };
        }
    }
    return { mitigated: false };
}

// =====================================================================
// === LIQUIDITY SWEEP ===
// =====================================================================
function detectLiquiditySweep(candles, currentPrice) {
    if (!candles || candles.length < 30) return null;
   
    const recentHighs = candles.slice(-25).map(c => c.high);
    const recentLows = candles.slice(-25).map(c => c.low);
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
   
    const isSweepingHigh = currentPrice > maxHigh && (currentPrice - maxHigh) / maxHigh < 0.01;
    const isSweepingLow = currentPrice < minLow && (minLow - currentPrice) / minLow < 0.01;
   
    if (isSweepingHigh) return { direction: 'SELL', isSweep: true };
    if (isSweepingLow) return { direction: 'BUY', isSweep: true };
    return null;
}

// =====================================================================
// === QUEBRAS DE ESTRUTURA ===
// =====================================================================
function detectStructureBreaks(candles) {
    if (!candles || candles.length < 20) return { bullish: false, bearish: false, description: 'Sem quebra recente' };
    
    const highs = [];
    const lows = [];
    
    for (let i = 5; i < candles.length - 5; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= 5; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
        }
        if (isHigh) highs.push({ index: i, price: candles[i].high });
        if (isLow) lows.push({ index: i, price: candles[i].low });
    }
    
    let hasRecentBullishBreak = false, hasRecentBearishBreak = false;
    
    for (let i = 1; i < highs.length; i++) {
        if (highs[i].price > highs[i-1].price) {
            if (candles.length - highs[i].index <= 10) hasRecentBullishBreak = true;
        }
    }
    
    for (let i = 1; i < lows.length; i++) {
        if (lows[i].price < lows[i-1].price) {
            if (candles.length - lows[i].index <= 10) hasRecentBearishBreak = true;
        }
    }
    
    return {
        bullish: hasRecentBullishBreak,
        bearish: hasRecentBearishBreak,
        description: hasRecentBullishBreak ? 'CHoCH ALTA recente' : (hasRecentBearishBreak ? 'CHoCH BAIXA recente' : 'Sem quebra recente')
    };
}

// =====================================================================
// === CONFIRMAÇÃO DE CANDLE ===
// =====================================================================
async function getCandleConfirmation(symbol, timeframe, expectedDirection) {
    try {
        const candles = await getCandles(symbol, timeframe, 3);
        if (!candles || candles.length < 2) return true;
        const lastClosedCandle = candles[candles.length - 2];
        if (expectedDirection === 'SELL') return lastClosedCandle.close < lastClosedCandle.open;
        else if (expectedDirection === 'BUY') return lastClosedCandle.close > lastClosedCandle.open;
        return true;
    } catch (error) { return true; }
}

// =====================================================================
// === OPEN INTEREST ===
// =====================================================================
async function getOpenInterest(symbol) {
    try {
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const response = await fetch(url);
        const data = await response.json();
        return parseFloat(data.openInterest);
    } catch (error) { return null; }
}

async function analyzeOpenInterest(symbol) {
    try {
        const now = Date.now();
        const cached = oiHistoryCache.get(symbol);
        const currentOI = await getOpenInterest(symbol);
        if (!currentOI) return null;
        
        let oiChange = 0, oiDirection = 'estável', oiEmoji = '➡️';
        
        if (cached && cached.data && cached.data.currentOI) {
            oiChange = ((currentOI - cached.data.currentOI) / cached.data.currentOI) * 100;
            if (oiChange > 0.8) { oiDirection = 'subindo forte'; oiEmoji = '🚀📈'; }
            else if (oiChange > 0.3) { oiDirection = 'subindo'; oiEmoji = '📈'; }
            else if (oiChange < -0.8) { oiDirection = 'descendo forte'; oiEmoji = '📉🚀'; }
            else if (oiChange < -0.3) { oiDirection = 'descendo'; oiEmoji = '📉'; }
        }
        
        const result = { current: currentOI, changePercent: oiChange, direction: oiDirection, emoji: oiEmoji, display: `${oiEmoji} ${(currentOI / 1000000).toFixed(1)}M ${oiDirection !== 'estável' ? `(${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}%)` : ''}` };
        addToCache(oiHistoryCache, symbol, { data: { currentOI, timestamp: now }, timestamp: now });
        return result;
    } catch (error) { return null; }
}

// =====================================================================
// === STOCHASTIC ===
// =====================================================================
async function calculateStochastic(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_stoch_${timeframe}`;
        const now = Date.now();
        const cached = stochCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 20) return null;
        
        const highs = candles.map(c => c.high), lows = candles.map(c => c.low), closes = candles.map(c => c.close);
        const kValues = [];
        
        for (let i = 4; i < closes.length; i++) {
            const highestHigh = Math.max(...highs.slice(i - 4, i + 1));
            const lowestLow = Math.min(...lows.slice(i - 4, i + 1));
            kValues.push(((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100);
        }
        
        const currentK = kValues[kValues.length - 1];
        const prevK = kValues[kValues.length - 2];
        const kTrend = currentK > prevK ? '↑' : (currentK < prevK ? '↓' : '→');
        let kEmoji = currentK < 15 ? '🔵' : (currentK < 25 ? '🟢' : (currentK < 45 ? '🟡' : (currentK < 70 ? '🟠' : '🔴')));
        
        const result = { k: currentK.toFixed(0), kTrend, kEmoji, display: `${kEmoji}K${currentK.toFixed(0)}${kTrend}` };
        addToCache(stochCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) { return null; }
}

// =====================================================================
// === ATR ===
// =====================================================================
async function calculateATR(symbol, timeframe = '1h', period = 14) {
    const cacheKey = `${symbol}_atr_${timeframe}`;
    const now = Date.now();
    const cached = atrCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < 300000) return cached.data;
   
    const candles = await getCandles(symbol, timeframe, period + 10);
    if (!candles || candles.length < period + 1) return null;
   
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
        trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    const atrPercent = (atr / candles[candles.length - 1].close) * 100;
    const result = { atr, atrPercent };
    addToCache(atrCache, cacheKey, { data: result, timestamp: now });
    return result;
}

// =====================================================================
// === DADOS DE MERCADO ===
// =====================================================================
async function getFundingRates(symbols) {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) if (symbols.includes(i.symbol)) result[i.symbol] = parseFloat(i.lastFundingRate);
        return result;
    } catch (error) { return {}; }
}

async function getLSRData(symbols) {
    try {
        const result = {};
        for (const symbol of symbols.slice(0, 30)) {
            try {
                await rateLimiter.acquire();
                const res = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`);
                const data = await res.json();
                if (data && data.length && data[0] && data[0].longShortRatio) {
                    const lsr = parseFloat(data[0].longShortRatio);
                    result[symbol] = { value: lsr, emoji: lsr > 1.2 ? '📈' : (lsr < 0.8 ? '📉' : '➡️') };
                }
                await delay(50);
            } catch { result[symbol] = null; }
        }
        return result;
    } catch (error) { return {}; }
}

async function getAllSymbols() {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        return data.filter(i => 
            i.symbol.endsWith('USDT') && 
            parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && 
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)
        ).map(i => ({ 
            symbol: i.symbol, 
            price: parseFloat(i.lastPrice), 
            volume24h: parseFloat(i.quoteVolume) 
        }));
    } catch (error) { 
        console.log(`⚠️ Erro ao buscar símbolos: ${error.message}`);
        return []; 
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

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function calculateTargets(entryPrice, stopPrice, tradeType) {
    const riskAmount = Math.abs(entryPrice - stopPrice);
    const ratios = CONFIG.MONITOR.SMC.TARGETS;
    const partialPercents = CONFIG.MONITOR.SMC.PARTIAL_CLOSE;
    const targets = [];
    for (let i = 0; i < ratios.length; i++) {
        let targetPrice = tradeType === 'BUY' ? entryPrice + (riskAmount * ratios[i]) : entryPrice - (riskAmount * ratios[i]);
        let profitPercent = tradeType === 'BUY' ? ((targetPrice - entryPrice) / entryPrice) * 100 : ((entryPrice - targetPrice) / entryPrice) * 100;
        targets.push({ ratio: ratios[i], price: targetPrice, profitPercent, partialClose: partialPercents[i] });
    }
    return targets;
}

async function calculateSmartStop(symbol, entryPrice, tradeType, structureData) {
    const atrData = await calculateATR(symbol, '1h', 14);
    let atrStopPercent = atrData ? Math.min(Math.max(atrData.atrPercent * 1.8, 1.5), 5.0) : 2.5;
    
    let structureStopPrice = null;
    if (tradeType === 'SELL' && structureData) structureStopPrice = (structureData.sweepPrice || structureData.obPrice) * 1.003;
    if (tradeType === 'BUY' && structureData) structureStopPrice = (structureData.sweepPrice || structureData.obPrice) * 0.997;
    
    let finalStopPercent = atrStopPercent, stopType = "ATR";
    if (structureStopPrice) {
        let structureStopPercent = tradeType === 'SELL' ? ((structureStopPrice - entryPrice) / entryPrice) * 100 : ((entryPrice - structureStopPrice) / entryPrice) * 100;
        if (structureStopPercent > atrStopPercent) { finalStopPercent = Math.min(structureStopPercent, 6.0); stopType = "ESTRUTURA"; }
    }
    
    let stopPrice = tradeType === 'SELL' ? entryPrice * (1 + finalStopPercent / 100) : entryPrice * (1 - finalStopPercent / 100);
    return { stopPrice, stopPercent: finalStopPercent, stopType };
}

// =====================================================================
// === PROTEÇÃO DE EXTREMOS ===
// =====================================================================
function isExtremeOversold(rsi, stoch4h) {
    const rsiOversold = rsi && rsi.value <= CONFIG.MONITOR.SMC.EXTREME_OVERSOLD_RSI;
    const stochOversold = stoch4h && stoch4h.k <= CONFIG.MONITOR.SMC.EXTREME_OVERSOLD_STOCH;
    return rsiOversold || stochOversold;
}

function isExtremeOverbought(rsi, stoch4h) {
    const rsiOverbought = rsi && rsi.value >= CONFIG.MONITOR.SMC.EXTREME_OVERBOUGHT_RSI;
    const stochOverbought = stoch4h && stoch4h.k >= CONFIG.MONITOR.SMC.EXTREME_OVERBOUGHT_STOCH;
    return rsiOverbought || stochOverbought;
}

// =====================================================================
// === ANÁLISE SMC COMPLETA COM FILTROS ===
// =====================================================================
async function analyzeSMC(symbolData) {
    const { symbol: fullSymbol, price } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
   
    try {
        const emaAnalysis = await analyzeMultiTimeframeEMAs(fullSymbol);
        if (!emaAnalysis) return null;
        
        const dailyEMA = emaAnalysis['1d'];
        if (!dailyEMA || dailyEMA.confidence < CONFIG.MONITOR.SMC.MIN_CONFIDENCE) return null;
        
        const [fourHourCandles, fifteenCandles, oneHourCandles] = await Promise.all([
            getCandles(fullSymbol, '4h', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES),
            getCandles(fullSymbol, '15m', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES),
            getCandles(fullSymbol, '1h', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES)
        ]);
        
        const fvgAnalysis4h = await analyzeFVG(fullSymbol, '4h', price);
        const fvgAnalysis1h = await analyzeFVG(fullSymbol, '1h', price);
        const bullishFVG = fvgAnalysis4h?.closestBullish || fvgAnalysis1h?.closestBullish;
        const bearishFVG = fvgAnalysis4h?.closestBearish || fvgAnalysis1h?.closestBearish;
        
        const structureBreaks = detectStructureBreaks(fifteenCandles);
        const fourHourOB = findOrderBlocks(fourHourCandles, 40);
        const oneHourOB = findOrderBlocks(oneHourCandles, 40);
        const liquiditySweep = detectLiquiditySweep(fifteenCandles, price);
        
        const bearishMitigation = checkMitigation(price, fourHourOB, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bearish') || checkMitigation(price, oneHourOB, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bearish');
        const bullishMitigation = checkMitigation(price, fourHourOB, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bullish') || checkMitigation(price, oneHourOB, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bullish');
        
        const oiAnalysis = await analyzeOpenInterest(fullSymbol);
        const [fundingRates, lsrData, rsi] = await Promise.all([getFundingRates([fullSymbol]), getLSRData([fullSymbol]), getRSI(fullSymbol, '1h')]);
        const funding = fundingRates[fullSymbol];
        const lsr = lsrData[fullSymbol];
        const [stochDaily, stoch4h] = await Promise.all([calculateStochastic(fullSymbol, '1d'), calculateStochastic(fullSymbol, '4h')]);
        
        const divergences = await analyzeDivergences(fullSymbol);
        const convergences = await analyzeConvergences(fullSymbol);
        
        const conflictAnalysis = analyzeTimeframeConflict(emaAnalysis);
        
        let tradeSignal = null, entryPrice = null, structureData = null, setupDescription = '';
        let currentScore = 0;
        
        // VENDA
        if (dailyEMA.trend === 'BAIXA' && !dailyEMA.isAboveEMA55 && !dailyEMA.isAboveEMA233) {
            
            const isOversold = isExtremeOversold(rsi, stoch4h);
            
            if (!isOversold) {
                let score = 0, reasons = [];
                
                // FILTRO FVG: Venda só se FVG Bearish estiver a ≤ 1% de distância
                const isFVGValid = bearishFVG && bearishFVG.distancePercent <= CONFIG.MONITOR.SMC.FVG_PROXIMITY_THRESHOLD;
                
                if (bearishFVG && isFVGValid) { 
                    score += bearishFVG.qualityScore === 3 ? 30 : (bearishFVG.qualityScore === 2 ? 25 : 20); 
                    reasons.push(`FVG Bearish ${bearishFVG.status === 'dentro' ? 'DENTRO' : `à ${bearishFVG.distancePercent.toFixed(2)}%`}`);
                } else if (bearishFVG && !isFVGValid) {
                    // FVG existe mas está longe demais - não pontua
                    reasons.push(`FVG Bearish distante (${bearishFVG.distancePercent.toFixed(2)}% > 1%) - ignorado`);
                }
                
                if (structureBreaks.bearish) { score += 20; reasons.push(structureBreaks.description); }
                if (liquiditySweep && liquiditySweep.direction === 'SELL') { score += 30; reasons.push('Liquidity Sweep'); }
                if (bearishMitigation.mitigated) { score += 25; reasons.push('Mitigação OB'); }
                if (oiAnalysis && (oiAnalysis.direction === 'subindo' || oiAnalysis.direction === 'subindo forte')) { score += 15; reasons.push('OI em alta'); }
                if (emaAnalysis['4h']?.trend === 'BAIXA') { score += 10; reasons.push('EMA4h em baixa'); }
                if (emaAnalysis['1h']?.trend === 'BAIXA') { score += 5; reasons.push('EMA1h em baixa'); }
                if (divergences.hasBearish) { score += 15; reasons.push(`${divergences.bearish[0]?.emoji || '🔴'} Divergência Bearish`); }
                if (convergences.hasBearish) { score += 20; reasons.push(`${convergences.bearish[0]?.emoji || '🎯🔴'} Convergência Bearish`); }
                
                currentScore = score;
                
                // FILTRO SCORE: Só envia se score >= MIN_SCORE (60)
                if (score >= CONFIG.MONITOR.SMC.MIN_SCORE && bearishFVG && isFVGValid) {
                    tradeSignal = 'SELL';
                    if (liquiditySweep) { entryPrice = price * 0.999; structureData = { sweepPrice: price }; }
                    else if (bearishMitigation.mitigated) { entryPrice = price * 0.998; structureData = { obPrice: price }; }
                    else if (bearishFVG) { entryPrice = bearishFVG.targetPrice * 0.999; }
                    else { entryPrice = price * 0.998; }
                    setupDescription = `${reasons.join(' + ')} (Score: ${score})`;
                }
            }
        }
        
        // COMPRA
        if (dailyEMA.trend === 'ALTA' && dailyEMA.isAboveEMA55 && dailyEMA.isAboveEMA233) {
            
            const isOverbought = isExtremeOverbought(rsi, stoch4h);
            
            if (!isOverbought) {
                let score = 0, reasons = [];
                
                // FILTRO FVG: Compra só se FVG Bullish estiver a ≤ 1% de distância
                const isFVGValid = bullishFVG && bullishFVG.distancePercent <= CONFIG.MONITOR.SMC.FVG_PROXIMITY_THRESHOLD;
                
                if (bullishFVG && isFVGValid) { 
                    score += bullishFVG.qualityScore === 3 ? 30 : (bullishFVG.qualityScore === 2 ? 25 : 20); 
                    reasons.push(`FVG Bullish ${bullishFVG.status === 'dentro' ? '' : `à ${bullishFVG.distancePercent.toFixed(2)}%`}`);
                } else if (bullishFVG && !isFVGValid) {
                    reasons.push(`FVG Bullish distante (${bullishFVG.distancePercent.toFixed(2)}% > 1%) - ignorado`);
                }
                
                if (structureBreaks.bullish) { score += 20; reasons.push(structureBreaks.description); }
                if (liquiditySweep && liquiditySweep.direction === 'BUY') { score += 30; reasons.push('Liquidity Sweep'); }
                if (bullishMitigation.mitigated) { score += 25; reasons.push('Mitigação OB'); }
                if (oiAnalysis && (oiAnalysis.direction === 'subindo' || oiAnalysis.direction === 'subindo forte')) { score += 15; reasons.push('OI em alta'); }
                if (emaAnalysis['4h']?.trend === 'ALTA') { score += 10; reasons.push('EMA4h em alta'); }
                if (emaAnalysis['1h']?.trend === 'ALTA') { score += 5; reasons.push('EMA1h em alta'); }
                if (divergences.hasBullish) { score += 15; reasons.push(`${divergences.bullish[0]?.emoji || '🟢'} Divergência Bullish`); }
                if (convergences.hasBullish) { score += 20; reasons.push(`${convergences.bullish[0]?.emoji || '🟢'} Convergência Bullish`); }
                
                currentScore = score;
                
                // FILTRO SCORE: Só envia se score >= MIN_SCORE (60)
                if (score >= CONFIG.MONITOR.SMC.MIN_SCORE && bullishFVG && isFVGValid) {
                    tradeSignal = 'BUY';
                    if (liquiditySweep) { entryPrice = price * 1.001; structureData = { sweepPrice: price }; }
                    else if (bullishMitigation.mitigated) { entryPrice = price * 1.002; structureData = { obPrice: price }; }
                    else if (bullishFVG) { entryPrice = bullishFVG.targetPrice * 1.001; }
                    else { entryPrice = price * 1.002; }
                    setupDescription = `${reasons.join(' + ')} (Score: ${score})`;
                }
            }
        }
        
        if (!tradeSignal) return null;
        
        const isConfirmed = await getCandleConfirmation(fullSymbol, '15m', tradeSignal);
        if (!isConfirmed) return null;
        
        const stopData = await calculateSmartStop(fullSymbol, entryPrice, tradeSignal, structureData);
        const targets = calculateTargets(entryPrice, stopData.stopPrice, tradeSignal);
        
        let targetsText = '';
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            targetsText += `\n   Alvo ${i+1} (${t.ratio}:1): ${formatPrice(t.price)} (${t.profitPercent > 0 ? '+' : ''}${t.profitPercent.toFixed(1)}%) - ${t.partialClose}%`;
        }
        
        const scoreQuality = analyzeScoreQuality(currentScore);
        
        return {
            symbol, fullSymbol, price, tradeSignal, entryPrice, stopPrice: stopData.stopPrice,
            stopPercent: stopData.stopPercent, stopType: stopData.stopType, targets, targetsText,
            setupDescription, oiAnalysis, funding: funding ? funding * 100 : null, lsr, rsi, stoch4h,
            emaAnalysis, bullishFVG, bearishFVG, structureBreaks, divergences, convergences,
            conflictAnalysis, scoreQuality,
            score: currentScore.toString()
        };
       
    } catch (error) {
        console.log(`⚠️ Erro no SMC para ${fullSymbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === ANÁLISE DE QUALIDADE DO SCORE ===
// =====================================================================
function analyzeScoreQuality(score) {
    if (score >= 80) {
        return { emoji: '🏆', message: 'Setup #TOP', recommendation: 'Entrada normal' };
    } else if (score >= 65) {
        return { emoji: '🔥', message: 'Setup #MUITO #BOM ', recommendation: 'Entrada normal' };
    } else if (score >= 60) {
        return { emoji: '✅', message: 'Setup VÁLIDO ', recommendation: 'Entrada moderada' };
    } else {
        return { emoji: '⚠️', message: 'Setup FRACO ', recommendation: 'Entrada reduzida (50%) ou aguardar' };
    }
}

// =====================================================================
// === ANÁLISE DE CONFLITO ENTRE TIMEFRAMES ===
// =====================================================================
function analyzeTimeframeConflict(emaAnalysis) {
    if (!emaAnalysis) return { level: 'NEUTRO', message: ' Tendências neutras', score: 0 };
    
    const trends = {
        d1: emaAnalysis['1d']?.trend || 'NEUTRA',
        h4: emaAnalysis['4h']?.trend || 'NEUTRA',
        h1: emaAnalysis['1h']?.trend || 'NEUTRA'
    };
    
    const trendValues = { 'ALTA': 1, 'NEUTRA': 0, 'BAIXA': -1 };
    const sum = trendValues[trends.d1] + trendValues[trends.h4] + trendValues[trends.h1];
    
    if (sum === 3) {
        return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS', score: 100 };
    } else if (sum === 2) {
        return { level: 'LEVE', message: '🟡 2 de 3 alinhados - conflito leve', score: 66 };
    } else if (sum === 1) {
        return { level: 'MODERADO', message: '⚠️ Conflito MODERADO entre timeframes', score: 50 };
    } else if (sum === -1) {
        return { level: 'MODERADO', message: '⚠️ Conflito MODERADO entre timeframes', score: 50 };
    } else if (sum === -2) {
        return { level: 'LEVE', message: '🟡 2 de 3 alinhados - conflito leve', score: 66 };
    } else if (sum === -3) {
        return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS', score: 100 };
    }
    
    return { level: 'ALTO', message: '🔴 ALTO CONFLITO - Aguardar confirmação', score: 25 };
}

// =====================================================================
// === ENVIAR ALERTA COM ANÁLISE COMPLETA ===
// =====================================================================
async function sendSMCAlert(analysis) {
    const dt = getBrazilianDateTime();
    const tradeEmoji = analysis.tradeSignal === 'SELL' ? '🔴' : '🟢';
    const tradeText = analysis.tradeSignal === 'SELL' ? 'VENDA' : 'COMPRA';
    const dailyEMA = analysis.emaAnalysis['1d'];
    
    let message = `<i>${tradeEmoji} ${tradeText} - ${analysis.symbol} - (${formatPrice(analysis.price)}</i>\n`;
    message += `<i>🔍🤖 Analise:  ${dt.full} hs</i>\n`;
    message += `<i>${analysis.conflictAnalysis.message}</i>\n`;
    message += `<i>📌 Setup: ${analysis.setupDescription}</i>\n`;
    message += `<i> #Score ${analysis.score} | ${analysis.scoreQuality.emoji} ${analysis.scoreQuality.message}</i>\n`;
    message += `<i>➡️ #Entrada: ${formatPrice(analysis.entryPrice)}</i>\n`;
    message += `<i> ALVOS:${analysis.targetsText}</i>\n`;
    message += `<i>🛑 Stop (${analysis.stopType}): ${formatPrice(analysis.stopPrice)} (${analysis.stopPercent.toFixed(1)}%)</i>\n`;
    message += `<i>💡 ${analysis.scoreQuality.recommendation}</i>\n`;
    message += `<i>   1d: ${dailyEMA.direction} ${dailyEMA.trend} (${dailyEMA.confidence}%)</i>\n`;
    if (analysis.emaAnalysis['4h']) message += `<i>   4h: ${analysis.emaAnalysis['4h'].direction} ${analysis.emaAnalysis['4h'].trend}</i>\n`;
    if (analysis.emaAnalysis['1h']) message += `<i>   1h: ${analysis.emaAnalysis['1h'].direction} ${analysis.emaAnalysis['1h'].trend}</i>\n`;
    
    if (analysis.bullishFVG) {
        message += `<i>📍FVG Bull: ${formatPrice(analysis.bullishFVG.targetPrice)} (${analysis.bullishFVG.displayDistance}) | Gap: ${analysis.bullishFVG.gapSize.toFixed(2)}%</i>\n`;
    }
    if (analysis.bearishFVG) {
        message += `<i>📍FVG Bear: ${formatPrice(analysis.bearishFVG.targetPrice)} (${analysis.bearishFVG.displayDistance}) | Gap: ${analysis.bearishFVG.gapSize.toFixed(2)}%</i>\n`;
    }
    if (analysis.structureBreaks && analysis.structureBreaks.description !== '❌ Sem quebra recente') {
        message += `<i>   ${analysis.structureBreaks.description}</i>\n`;
    }
    
    if (analysis.divergences && analysis.divergences.summary !== '❌ Sem divergências') {
        message += `<i>   ${analysis.divergences.summary}</i>\n`;
    }
    
    if (analysis.convergences && analysis.convergences.summary !== '❌ Sem convergências') {
        message += `<i>   ${analysis.convergences.summary}</i>\n`;
    }
    
    const lsrValue = analysis.lsr?.value?.toFixed(2) || 'N/A';
    const lsrEmoji = analysis.lsr?.emoji || '';
    const fundingValue = analysis.funding?.toFixed(3) || 'N/A';
    const rsiValue = analysis.rsi?.value?.toFixed(0) || 'N/A';
    const rsiEmoji = analysis.rsi?.emoji || '';
    
    message += `<i>LSR ${lsrEmoji} ${lsrValue} | Funding ${fundingValue}%</i>\n`;
    if (analysis.oiAnalysis) message += `<i>RSI ${rsiValue}${rsiEmoji} | OI: ${analysis.oiAnalysis.display}</i>\n`;
    if (analysis.stoch4h) message += `<i>Stoch 4h: ${analysis.stoch4h.display}</i>\n`;
    
    message += `<i>✨Titanium by @J4Rviz</i>`;
   
    await telegramQueue.add(message);
}

// =====================================================================
// === MONITOR PRINCIPAL ===
// =====================================================================
let isScanning = false;

async function scanAndAlert() {
    if (isScanning) return;
    isScanning = true;
   
    try {
        const symbols = await getAllSymbols();
        if (!symbols.length) return;
       
        console.log(`🔍 Escaneando ${symbols.length} símbolos...`);
        let alertsSent = 0;
       
        for (const symbolData of symbols) {
            try {
                const analysis = await analyzeSMC(symbolData);
                
                if (!analysis) {
                    continue;
                }
                
                const canSendAlert = canAlert(analysis.fullSymbol);
                console.log(`📊 ${analysis.symbol}: Score=${analysis.score}, Trade=${analysis.tradeSignal}, CanAlert=${canSendAlert}`);
                
                if (analysis && canSendAlert) {
                    await sendSMCAlert(analysis);
                    markAlerted(analysis.fullSymbol);
                    alertsSent++;
                    console.log(`✅ [${alertsSent}] Alerta ${analysis.tradeSignal} para ${analysis.symbol} (Score: ${analysis.score})`);
                    await delay(5000);
                } else {
                    console.log(`⏸️ ${analysis.symbol}: Alerta bloqueado por cooldown ou outro motivo`);
                }
            } catch (error) {
                console.log(`⚠️ Erro ao processar ${symbolData.symbol}: ${error.message}`);
            }
        }
       
        console.log(`✅ Scan completo. ${alertsSent} alertas enviados.`);
       
    } catch (error) {
        console.log(`❌ Erro no scan: ${error.message}`);
    } finally {
        isScanning = false;
    }
}

async function sendInitMessage() {
    const msg = `<i> Titanium MONITOR </i>\n\n` +
                
                `<i>Monitorando mercados...</i>`;
    await telegramQueue.add(msg, true);
}

async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log(' Titanium MONITOR ');
   
    console.log('='.repeat(70));
   
    loadAlertedSymbols();
    await sendInitMessage();
    await scanAndAlert();
   
    setInterval(async () => {
        await scanAndAlert();
    }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
}

process.on('SIGINT', () => {
    console.log('🛑 Desligando Titanium Monitor...');
    process.exit(0);
});

startMonitor().catch(console.error);
