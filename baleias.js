const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const https = require('https');
const http = require('http');
require('dotenv').config();

// =====================================================================
// === CONFIGURAÇÕES OTIMIZADAS - CAÇA ÀS BALEIAS + INDICADORES ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    WHALE_HUNTING: {
        CVD_THRESHOLD_CRITICAL: 500000,
        CVD_THRESHOLD_HIGH: 200000,
        CVD_THRESHOLD_MEDIUM: 50000,
        WHALE_TRADE_MULTIPLIER: 5,
        ANALYSIS_WINDOW: 60,
        SNAPSHOT_INTERVAL: 15,
        COOLDOWN_MINUTES: 10,
        MIN_WHALE_TRADES_CRITICAL: 2,
        MIN_WHALE_TRADES_HIGH: 1,
        BUY_RATIO_CRITICAL: 70,
        BUY_RATIO_HIGH: 60,
        SELL_RATIO_CRITICAL: 30,
        SELL_RATIO_HIGH: 40
    },
    INDICATORS: {
        LSR_15M: {
            OVERBOUGHT: 1.7,
            OVERSOLD: 1.0,
            COOLDOWN_MINUTES: 30
        },
        CCI: {
            PERIOD: 20,
            EMA_PERIOD: 5,
            TIMEFRAMES: {
                '4h': { cooldown: 60 * 60 * 1000 },
                '1d': { cooldown: 4 * 60 * 60 * 1000 }
            }
        },
        RSI_1H: {
            PERIOD: 14,
            OVERBOUGHT: 75,
            OVERSOLD: 30,
            COOLDOWN_MINUTES: 60
        },
        STOCHASTIC: {
            K_PERIOD: 5,
            D_PERIOD: 3,
            SLOW_K: 3,
            TIMEFRAMES: {
                '12h': { cooldown: 2 * 60 * 60 * 1000 },
                '1d': { cooldown: 4 * 60 * 60 * 1000 }
            }
        },
        CVD_DIVERGENCE: {
            LOOKBACK_15M: 15,
            LOOKBACK_1H: 60,
            COOLDOWN_MINUTES: 30,
            MIN_PRICE_MOVEMENT: 0.005,
            MIN_CVD_MOVEMENT: 50000
        },
        VOLATILITY: {
            LOOKBACK_MINUTES: 5,
            VOLATILITY_THRESHOLD: 2.5,
            COOLDOWN_MINUTES: 15,
            MIN_TRADES_PER_MINUTE: 10
        }
    },
    SUPPORT_RESISTANCE: {
        LOOKBACK_DAYS: 30,
        CLUSTER_THRESHOLD: 0.005,
        MIN_TOUCHES: 2
    },
    SYSTEM: {
        MAX_MEMORY_ITEMS: 1000,
        API_RETRY_ATTEMPTS: 3,
        API_RETRY_DELAY: 2000,
        WS_RECONNECT_DELAY: 3000,
        WS_MAX_RECONNECT_DELAY: 60000,
        RATE_LIMIT_DELAY: 500,
        FETCH_TIMEOUT: 10000
    }
};

// =====================================================================
// === TOP MOEDAS POR LIQUIDEZ ===
// =====================================================================
const TOP_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
    'POLUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
    'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT'
];

// =====================================================================
// === VARIÁVEIS GLOBAIS ===
// =====================================================================
const whaleHistory = new Map();
let totalAlertsSent = 0;
let startTime = Date.now();

const indicatorHistory = {
    lsr: new Map(),
    cci: new Map(),
    rsi: new Map(),
    stochastic: new Map(),
    cvdDivergence: new Map(),
    volatility: new Map()
};

let previousEMA = {};
let supportResistanceCache = new Map();
const cvdHistory = new Map();
let lastLSRValues = new Map();
let lastRSIValues = new Map();

// =====================================================================
// === CLIENTE HTTP ROBUSTO COM TIMEOUT ===
// =====================================================================
function fetchWithTimeout(url, options = {}, timeout = CONFIG.SYSTEM.FETCH_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`Timeout após ${timeout}ms`));
        }, timeout);

        const fetchOptions = {
            ...options,
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                ...options.headers
            }
        };

        fetch(url, fetchOptions)
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

async function fetchWithRetry(url, attempts = CONFIG.SYSTEM.API_RETRY_ATTEMPTS) {
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await fetchWithTimeout(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (!data || (Array.isArray(data) && data.length === 0)) {
                throw new Error('Dados vazios ou inválidos');
            }
            
            return data;
        } catch (error) {
            log(`Tentativa ${i + 1}/${attempts} falhou: ${error.message}`, 'error');
            if (i === attempts - 1) {
                return null;
            }
            await new Promise(r => setTimeout(r, CONFIG.SYSTEM.API_RETRY_DELAY * (i + 1)));
        }
    }
    return null;
}

// =====================================================================
// === FUNÇÕES AUXILIARES MELHORADAS ===
// =====================================================================

function getBrazilianDateTime() {
    try {
        const now = new Date();
        const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        return brazilTime.toLocaleString('pt-BR');
    } catch (error) {
        const now = new Date();
        const brazilOffset = -3;
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const brazilTime = new Date(utc + (3600000 * brazilOffset));
        return brazilTime.toLocaleString('pt-BR');
    }
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(3);
    if (price > 0.01) return price.toFixed(4);
    return price.toFixed(6);
}

function formatLargeNumber(num) {
    if (!num || isNaN(num)) return '0';
    const absNum = Math.abs(num);
    if (absNum >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (absNum >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (absNum >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
}

function log(message, type = 'info', symbol = null) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const emoji = type === 'error' ? '❌' : 
                  (type === 'success' ? '✅' : 
                  (type === 'whale' ? '🐋' : 
                  (type === 'alert' ? '🔴' : 
                  (type === 'critical' ? '⚠️' : 
                  (type === 'indicator' ? '📊' : 
                  (type === 'volatility' ? '🌊' : 'ℹ️'))))));
    const symbolTag = symbol ? `[${symbol}]` : '';
    console.log(`${timestamp} ${emoji} ${symbolTag} ${message}`);
}

function calculateVolatility(prices) {
    if (!prices || prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        if (prices[i-1] > 0) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
    }
    
    if (returns.length === 0) return 0;
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * 100;
    
    return volatility;
}

// =====================================================================
// === FUNÇÕES PARA OBTER RSI E LSR ATUAIS COM CACHE ===
// =====================================================================

async function getCurrentRSI(symbol) {
    try {
        const candles = await fetchCandles(symbol, '1h', 50);
        if (!candles || !candles.closes || candles.closes.length < CONFIG.INDICATORS.RSI_1H.PERIOD + 1) return null;
        
        const rsi = calculateRSI(candles.closes, CONFIG.INDICATORS.RSI_1H.PERIOD);
        return rsi;
    } catch (error) {
        return null;
    }
}

async function getCurrentLSR(symbol) {
    try {
        const futuresSymbol = symbol.replace('USDT', 'USDT');
        const url = `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${futuresSymbol}&period=15m&limit=1`;
        
        const data = await fetchWithRetry(url);
        
        if (data && data.length > 0 && data[0].longShortRatio) {
            return parseFloat(data[0].longShortRatio);
        }
        return null;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÕES PARA DIVERGÊNCIA DE CVD ===
// =====================================================================

function detectCVDDivergence(symbol, cvdData, priceData) {
    if (!cvdData || !priceData || cvdData.length < 10 || priceData.length < 10) return null;
    
    try {
        const recentCVD = cvdData.slice(-CONFIG.INDICATORS.CVD_DIVERGENCE.LOOKBACK_15M);
        const recentPrice = priceData.slice(-CONFIG.INDICATORS.CVD_DIVERGENCE.LOOKBACK_15M);
        
        if (recentCVD.length < 5 || recentPrice.length < 5) return null;
        
        let isBullishDivergence = false;
        let isBearishDivergence = false;
        
        const priceMins = findLocalMins(recentPrice);
        const cvdMins = findLocalMins(recentCVD);
        const priceMaxs = findLocalMaxs(recentPrice);
        const cvdMaxs = findLocalMaxs(recentCVD);
        
        if (priceMins.length >= 2 && cvdMins.length >= 2) {
            const lastPriceMin = priceMins[priceMins.length - 1];
            const prevPriceMin = priceMins[priceMins.length - 2];
            const lastCvdMin = cvdMins[cvdMins.length - 1];
            const prevCvdMin = cvdMins[cvdMins.length - 2];
            
            if (lastPriceMin.value < prevPriceMin.value && lastCvdMin.value > prevCvdMin.value) {
                isBullishDivergence = true;
            }
        }
        
        if (priceMaxs.length >= 2 && cvdMaxs.length >= 2) {
            const lastPriceMax = priceMaxs[priceMaxs.length - 1];
            const prevPriceMax = priceMaxs[priceMaxs.length - 2];
            const lastCvdMax = cvdMaxs[cvdMaxs.length - 1];
            const prevCvdMax = cvdMaxs[cvdMaxs.length - 2];
            
            if (lastPriceMax.value > prevPriceMax.value && lastCvdMax.value < prevCvdMax.value) {
                isBearishDivergence = true;
            }
        }
        
        if (isBullishDivergence) {
            return {
                type: 'BULLISH',
                description: 'Preço faz fundos mais baixos, mas CVD faz fundos mais altos',
                cvdChange: recentCVD[recentCVD.length - 1] - recentCVD[0],
                priceChangePercent: (recentPrice[recentPrice.length - 1] - recentPrice[0]) / recentPrice[0]
            };
        }
        
        if (isBearishDivergence) {
            return {
                type: 'BEARISH',
                description: 'Preço faz topos mais altos, mas CVD faz topos mais baixos',
                cvdChange: recentCVD[recentCVD.length - 1] - recentCVD[0],
                priceChangePercent: (recentPrice[recentPrice.length - 1] - recentPrice[0]) / recentPrice[0]
            };
        }
        
        return null;
    } catch (error) {
        log(`Erro detectCVDDivergence: ${error.message}`, 'error');
        return null;
    }
}

function findLocalMins(values) {
    const mins = [];
    for (let i = 1; i < values.length - 1; i++) {
        if (values[i] < values[i-1] && values[i] < values[i+1]) {
            mins.push({ index: i, value: values[i] });
        }
    }
    return mins;
}

function findLocalMaxs(values) {
    const maxs = [];
    for (let i = 1; i < values.length - 1; i++) {
        if (values[i] > values[i-1] && values[i] > values[i+1]) {
            maxs.push({ index: i, value: values[i] });
        }
    }
    return maxs;
}

// =====================================================================
// === SUPORTE E RESISTÊNCIA COM CLUSTERS (COM RETRY) ===
// =====================================================================

async function calculateSupportResistance(symbol, currentPrice) {
    const cacheKey = `${symbol}_${new Date().toDateString()}`;
    
    if (supportResistanceCache.has(cacheKey)) {
        return supportResistanceCache.get(cacheKey);
    }
    
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${CONFIG.SUPPORT_RESISTANCE.LOOKBACK_DAYS}`;
        const candles = await fetchWithRetry(url);
        
        if (!candles || !candles.length) return null;
        
        const highs = candles.map(c => parseFloat(c[2])).filter(v => !isNaN(v));
        const lows = candles.map(c => parseFloat(c[3])).filter(v => !isNaN(v));
        const closes = candles.map(c => parseFloat(c[4])).filter(v => !isNaN(v));
        
        if (!highs.length || !lows.length || !closes.length) return null;
        
        const levels = [...highs, ...lows, ...closes];
        levels.sort((a, b) => a - b);
        
        const clusters = [];
        let currentCluster = [levels[0]];
        
        for (let i = 1; i < levels.length; i++) {
            const diff = (levels[i] - currentCluster[0]) / currentCluster[0];
            if (diff <= CONFIG.SUPPORT_RESISTANCE.CLUSTER_THRESHOLD) {
                currentCluster.push(levels[i]);
            } else {
                if (currentCluster.length >= CONFIG.SUPPORT_RESISTANCE.MIN_TOUCHES) {
                    const avgLevel = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
                    clusters.push({
                        level: avgLevel,
                        touches: currentCluster.length,
                        type: avgLevel < currentPrice ? 'SUPORTE' : 'RESISTÊNCIA'
                    });
                }
                currentCluster = [levels[i]];
            }
        }
        
        clusters.sort((a, b) => Math.abs(a.level - currentPrice) - Math.abs(b.level - currentPrice));
        const nearestSupports = clusters.filter(c => c.type === 'SUPORTE').slice(0, 2);
        const nearestResistances = clusters.filter(c => c.type === 'RESISTÊNCIA').slice(0, 2);
        
        const result = {
            supports: nearestSupports.map(s => `${formatPrice(s.level)}(${s.touches}x)`),
            resistances: nearestResistances.map(r => `${formatPrice(r.level)}(${r.touches}x)`),
            timestamp: Date.now()
        };
        
        supportResistanceCache.set(cacheKey, result);
        setTimeout(() => supportResistanceCache.delete(cacheKey), 24 * 60 * 60 * 1000);
        
        return result;
        
    } catch (error) {
        log(`Erro SR ${symbol}: ${error.message}`, 'error');
        return null;
    }
}

// =====================================================================
// === TELEGRAM COM VALIDAÇÃO E RETRY ===
// =====================================================================

async function sendTelegramMessage(message) {
    if (!message || typeof message !== 'string') return false;
    
    const maxRetries = 3;
    const baseDelay = 2000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
            
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Connection': 'keep-alive'
                },
                body: JSON.stringify({
                    chat_id: CONFIG.TELEGRAM.CHAT_ID,
                    text: message.substring(0, 4096),
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                })
            }, 15000);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            if (!data.ok) {
                throw new Error(data.description || 'Erro desconhecido');
            }
            
            totalAlertsSent++;
            log(`Alerta #${totalAlertsSent} enviado!`, 'success');
            return true;
            
        } catch (error) {
            log(`Tentativa ${attempt}/${maxRetries} falhou: ${error.message}`, 'error');
            
            if (attempt === maxRetries) {
                log(`Falha ao enviar mensagem após ${maxRetries} tentativas`, 'error');
                return false;
            }
            
            await new Promise(r => setTimeout(r, baseDelay * attempt));
        }
    }
    
    return false;
}

// =====================================================================
// === FUNÇÕES DE CÁLCULO DE INDICADORES (COM VALIDAÇÃO) ===
// =====================================================================

function calculateCCI(highs, lows, closes, period = 20) {
    if (!highs || !lows || !closes || closes.length < period) return null;
    
    try {
        const typicalPrices = [];
        for (let i = 0; i < closes.length; i++) {
            const tp = (highs[i] + lows[i] + closes[i]) / 3;
            if (isNaN(tp)) return null;
            typicalPrices.push(tp);
        }
        
        const cci = [];
        for (let i = period - 1; i < typicalPrices.length; i++) {
            const sma = typicalPrices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
            let mad = 0;
            for (let j = i - period + 1; j <= i; j++) {
                mad += Math.abs(typicalPrices[j] - sma);
            }
            mad /= period;
            
            if (mad !== 0) {
                cci.push((typicalPrices[i] - sma) / (0.015 * mad));
            } else {
                cci.push(0);
            }
        }
        
        return cci;
    } catch (error) {
        return null;
    }
}

function calculateEMA(values, period) {
    if (!values || !Array.isArray(values) || values.length < period) return null;
    
    try {
        const multiplier = 2 / (period + 1);
        let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < values.length; i++) {
            ema = (values[i] - ema) * multiplier + ema;
        }
        
        return ema;
    } catch (error) {
        return null;
    }
}

function calculateRSI(closes, period = 14) {
    if (!closes || !Array.isArray(closes) || closes.length < period + 1) return null;
    
    try {
        let gains = 0;
        let losses = 0;
        const lastIndex = closes.length - 1;
        
        for (let i = 1; i <= period; i++) {
            const change = closes[lastIndex - i + 1] - closes[lastIndex - i];
            if (change >= 0) {
                gains += change;
            } else {
                losses -= change;
            }
        }
        
        let avgGain = gains / period;
        let avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    } catch (error) {
        return null;
    }
}

function calculateStochastic(highs, lows, closes, kPeriod = 5, dPeriod = 3, slowK = 3) {
    if (!highs || !lows || !closes || closes.length < kPeriod) return null;
    
    try {
        const kValues = [];
        
        for (let i = kPeriod - 1; i < closes.length; i++) {
            const highestHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
            const lowestLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
            const currentClose = closes[i];
            
            if (highestHigh !== lowestLow) {
                const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
                kValues.push(k);
            } else {
                kValues.push(50);
            }
        }
        
        if (kValues.length < slowK) return null;
        
        const slowKValues = [];
        for (let i = slowK - 1; i < kValues.length; i++) {
            const slowKAvg = kValues.slice(i - slowK + 1, i + 1).reduce((a, b) => a + b, 0) / slowK;
            slowKValues.push(slowKAvg);
        }
        
        if (slowKValues.length < dPeriod) return null;
        
        const dValues = [];
        for (let i = dPeriod - 1; i < slowKValues.length; i++) {
            const dAvg = slowKValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod;
            dValues.push(dAvg);
        }
        
        return {
            k: slowKValues,
            d: dValues
        };
    } catch (error) {
        return null;
    }
}

async function fetchCandles(symbol, timeframe, limit = 100) {
    try {
        const timeframeMap = {
            '1h': '1h',
            '4h': '4h',
            '12h': '12h',
            '1d': '1d'
        };
        
        const tf = timeframeMap[timeframe] || timeframe;
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
        
        const candles = await fetchWithRetry(url);
        
        if (!candles || !candles.length) return null;
        
        return {
            times: candles.map(c => c[0]),
            opens: candles.map(c => parseFloat(c[1])).filter(v => !isNaN(v)),
            highs: candles.map(c => parseFloat(c[2])).filter(v => !isNaN(v)),
            lows: candles.map(c => parseFloat(c[3])).filter(v => !isNaN(v)),
            closes: candles.map(c => parseFloat(c[4])).filter(v => !isNaN(v)),
            volumes: candles.map(c => parseFloat(c[5])).filter(v => !isNaN(v))
        };
    } catch (error) {
        log(`Erro ao buscar candles ${symbol} ${timeframe}: ${error.message}`, 'error');
        return null;
    }
}

// =====================================================================
// === RASTREADOR DE BALEIAS (COM MELHORIAS DE ROBUSTEZ) ===
// =====================================================================

class WhaleTracker {
    constructor() {
        this.connections = new Map();
        this.snapshots = new Map();
        this.isRunning = false;
        this.messageQueue = [];
        this.lastPrices = new Map();
        this.reconnectDelays = new Map();
        this.rateLimitQueue = [];
        this.isProcessingRateLimit = false;
    }

    async start() {
        log('Iniciando caça às baleias...', 'info');
        this.isRunning = true;
        
        let connected = 0;
        for (const symbol of TOP_SYMBOLS) {
            await this.connectSymbol(symbol);
            await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
            connected++;
        }
        
        log(`Sistema ativo - ${connected}/${TOP_SYMBOLS.length} moedas monitoradas`, 'success');
        log(`Thresholds: Crítico $${(CONFIG.WHALE_HUNTING.CVD_THRESHOLD_CRITICAL/1000).toFixed(0)}K | Alto $${(CONFIG.WHALE_HUNTING.CVD_THRESHOLD_HIGH/1000).toFixed(0)}K | Médio $${(CONFIG.WHALE_HUNTING.CVD_THRESHOLD_MEDIUM/1000).toFixed(0)}K`, 'info');
        
        setInterval(() => this.detectWhales(), CONFIG.WHALE_HUNTING.SNAPSHOT_INTERVAL * 1000);
        setInterval(() => this.analyzeIndicators(), 5 * 60 * 1000);
        setInterval(() => this.analyzeCVDDivergence(), 2 * 60 * 1000);
        setInterval(() => this.analyzeVolatility(), 60 * 1000);
        setInterval(() => this.processMessageQueue(), 2000);
        setInterval(() => this.showStatus(), 2 * 60 * 1000);
        setInterval(() => this.cleanupMemory(), 30 * 60 * 1000);
        
        setTimeout(() => this.analyzeIndicators(), 10000);
        setTimeout(() => this.analyzeCVDDivergence(), 20000);
        setTimeout(() => this.analyzeVolatility(), 30000);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getReconnectDelay(symbol) {
        const currentDelay = this.reconnectDelays.get(symbol) || CONFIG.SYSTEM.WS_RECONNECT_DELAY;
        const newDelay = Math.min(currentDelay * 1.5, CONFIG.SYSTEM.WS_MAX_RECONNECT_DELAY);
        this.reconnectDelays.set(symbol, newDelay);
        return currentDelay;
    }

    resetReconnectDelay(symbol) {
        this.reconnectDelays.set(symbol, CONFIG.SYSTEM.WS_RECONNECT_DELAY);
    }

    cleanupMemory() {
        const now = Date.now();
        for (const [symbol, snapshot] of this.snapshots) {
            if (snapshot.trades) {
                const cutoff = now - 5 * 60 * 1000;
                snapshot.trades = snapshot.trades.filter(t => t.time > cutoff);
                if (snapshot.trades.length > CONFIG.SYSTEM.MAX_MEMORY_ITEMS) {
                    snapshot.trades = snapshot.trades.slice(-CONFIG.SYSTEM.MAX_MEMORY_ITEMS);
                }
            }
            
            if (snapshot.highVolumeTrades && snapshot.highVolumeTrades.length > 200) {
                snapshot.highVolumeTrades = snapshot.highVolumeTrades.slice(-200);
            }
            
            if (snapshot.cvdHistory && snapshot.cvdHistory.length > 500) {
                snapshot.cvdHistory = snapshot.cvdHistory.slice(-500);
            }
            
            if (snapshot.priceHistory && snapshot.priceHistory.length > 500) {
                snapshot.priceHistory = snapshot.priceHistory.slice(-500);
            }
            
            if (snapshot.minuteData && snapshot.minuteData.length > 120) {
                snapshot.minuteData = snapshot.minuteData.slice(-120);
            }
        }
        
        log('🧹 Limpeza de memória executada', 'info');
    }

    async connectSymbol(symbol) {
        if (this.connections.has(symbol)) return;
        
        try {
            const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
                log(`Conectado`, 'success', symbol);
                this.resetReconnectDelay(symbol);
                this.snapshots.set(symbol, {
                    trades: [],
                    minuteData: [],
                    cumulativeCVD: 0,
                    lastPrice: 0,
                    highVolumeTrades: [],
                    lastAlert: 0,
                    buyVolume: 0,
                    sellVolume: 0,
                    lastWhaleLog: Date.now(),
                    cvdHistory: [],
                    priceHistory: [],
                    priceHistoryVol: [],
                    tradeCounts: []
                });
            });
            
            ws.on('message', (data) => {
                try {
                    const trade = JSON.parse(data);
                    this.processTrade(symbol, trade);
                    this.lastPrices.set(symbol, parseFloat(trade.p));
                } catch (e) {
                    log(`Erro ao processar mensagem: ${e.message}`, 'error', symbol);
                }
            });
            
            ws.on('error', (error) => {
                if (!error.message.includes('ECONNRESET') && !error.message.includes('ETIMEDOUT')) {
                    log(`Erro: ${error.message}`, 'error', symbol);
                }
            });
            
            ws.on('close', () => {
                log(`Conexão fechada, reconectando...`, 'warning', symbol);
                this.connections.delete(symbol);
                const delay = this.getReconnectDelay(symbol);
                setTimeout(() => this.connectSymbol(symbol), delay);
            });
            
            this.connections.set(symbol, ws);
            
        } catch (error) {
            log(`Erro ao conectar: ${error.message}`, 'error', symbol);
            const delay = this.getReconnectDelay(symbol);
            setTimeout(() => this.connectSymbol(symbol), delay);
        }
    }

    processTrade(symbol, trade) {
        const snapshot = this.snapshots.get(symbol);
        if (!snapshot) return;
        
        try {
            const price = parseFloat(trade.p);
            const quantity = parseFloat(trade.q);
            
            if (isNaN(price) || isNaN(quantity)) return;
            
            const value = price * quantity;
            const isBuy = !trade.m;
            
            const delta = isBuy ? value : -value;
            snapshot.cumulativeCVD += delta;
            snapshot.lastPrice = price;
            
            if (isBuy) {
                snapshot.buyVolume += value;
            } else {
                snapshot.sellVolume += value;
            }
            
            snapshot.trades.push({
                time: trade.T,
                price,
                value,
                isBuy,
                delta
            });
            
            const now = Date.now();
            snapshot.cvdHistory.push({ timestamp: now, cvd: snapshot.cumulativeCVD });
            snapshot.priceHistory.push({ timestamp: now, price: price });
            snapshot.priceHistoryVol.push(price);
            
            const cutoff = now - 5 * 60 * 1000;
            snapshot.cvdHistory = snapshot.cvdHistory.filter(h => h.timestamp > cutoff);
            snapshot.priceHistory = snapshot.priceHistory.filter(h => h.timestamp > cutoff);
            snapshot.priceHistoryVol = snapshot.priceHistoryVol.slice(-300);
            snapshot.trades = snapshot.trades.filter(t => t.time > cutoff);
            
            if (snapshot.trades.length > 20) {
                const recentTrades = snapshot.trades.slice(-100);
                const avgValue = recentTrades.reduce((s, t) => s + t.value, 0) / recentTrades.length;
                const isWhaleTrade = avgValue > 0 && value > avgValue * CONFIG.WHALE_HUNTING.WHALE_TRADE_MULTIPLIER;
                
                if (isWhaleTrade && value > 100) {
                    const tradeRecord = {
                        time: trade.T,
                        price,
                        value,
                        isBuy,
                        multiplier: (value / avgValue).toFixed(1),
                        avgValue: avgValue
                    };
                    
                    snapshot.highVolumeTrades.push(tradeRecord);
                    
                    if (now - snapshot.lastWhaleLog > 500) {
                        const action = isBuy ? 'COMPRA' : 'VENDA';
                        log(`🐋 TRADE BALEIA: ${action} ${formatLargeNumber(value)} USDT (${(value/avgValue).toFixed(1)}x média)`, 'whale', symbol);
                        snapshot.lastWhaleLog = now;
                    }
                    
                    if (snapshot.highVolumeTrades.length > 200) {
                        snapshot.highVolumeTrades = snapshot.highVolumeTrades.slice(-200);
                    }
                }
            }
            
            const secondKey = Math.floor(trade.T / 1000);
            let secondData = snapshot.minuteData.find(m => m.second === secondKey);
            
            if (!secondData) {
                secondData = {
                    second: secondKey,
                    buyVolume: 0,
                    sellVolume: 0,
                    cvdChange: 0,
                    trades: 0,
                    whaleTrades: 0
                };
                snapshot.minuteData.push(secondData);
                
                if (snapshot.minuteData.length > 120) {
                    snapshot.minuteData = snapshot.minuteData.slice(-120);
                }
            }
            
            if (isBuy) secondData.buyVolume += value;
            else secondData.sellVolume += value;
            
            secondData.cvdChange += delta;
            secondData.trades++;
            
            const lastWhaleTrade = snapshot.highVolumeTrades[snapshot.highVolumeTrades.length - 1];
            if (lastWhaleTrade && Math.abs(lastWhaleTrade.time - trade.T) < 1000) {
                secondData.whaleTrades++;
            }
        } catch (error) {
            log(`Erro processTrade: ${error.message}`, 'error', symbol);
        }
    }

    async analyzeVolatility() {
        log('📊 Analisando volatilidade anormal...', 'indicator');
        
        for (const [symbol, snapshot] of this.snapshots) {
            if (!snapshot.priceHistoryVol || snapshot.priceHistoryVol.length < 30) continue;
            
            try {
                const prices = snapshot.priceHistoryVol.slice(-60);
                const volatility = calculateVolatility(prices);
                
                const tradesPerMinute = snapshot.minuteData.slice(-5).reduce((sum, m) => sum + (m.trades || 0), 0) / 5;
                
                const cacheKey = `${symbol}`;
                const lastAlert = indicatorHistory.volatility.get(cacheKey);
                const cooldown = CONFIG.INDICATORS.VOLATILITY.COOLDOWN_MINUTES * 60 * 1000;
                
                if (volatility > CONFIG.INDICATORS.VOLATILITY.VOLATILITY_THRESHOLD && 
                    tradesPerMinute >= CONFIG.INDICATORS.VOLATILITY.MIN_TRADES_PER_MINUTE &&
                    (!lastAlert || (Date.now() - lastAlert.timestamp) > cooldown)) {
                    
                    const sr = await calculateSupportResistance(symbol, snapshot.lastPrice);
                    const currentRSI = await getCurrentRSI(symbol);
                    const currentLSR = await getCurrentLSR(symbol);
                    
                    const alert = {
                        symbol: symbol.replace('USDT', ''),
                        volatility: volatility,
                        tradesPerMinute: tradesPerMinute,
                        price: snapshot.lastPrice,
                        type: 'HIGH_VOLATILITY',
                        rsi: currentRSI,
                        lsr: currentLSR,
                        supports: sr ? sr.supports : [],
                        resistances: sr ? sr.resistances : []
                    };
                    
                    this.queueMessage(this.formatVolatilityAlert(alert));
                    indicatorHistory.volatility.set(cacheKey, { value: volatility, timestamp: Date.now() });
                    log(`🌊 VOLATILIDADE ANORMAL ${symbol}: ${volatility.toFixed(2)}% (${tradesPerMinute.toFixed(0)} trades/min)`, 'volatility', symbol);
                }
            } catch (error) {
                log(`Erro analyzeVolatility ${symbol}: ${error.message}`, 'error');
            }
        }
    }

    formatVolatilityAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const intensity = alert.volatility > 5 ? '🔥🔥🔥 EXTREMA' : (alert.volatility > 3.5 ? '⚠️⚠️ ALTA' : '⚠️ MODERADA');
        
        let message = `_🌊🌊🌊 VOLATILIDADE ANORMAL ${intensity} 🌊🌊🌊_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_Volatilidade:_ ${alert.volatility.toFixed(2)}%\n`;
        message += `_Trades/min:_ ${alert.tradesPerMinute.toFixed(0)}\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        let action = '';
        if (alert.volatility > 5) {
            action = '🎯 AÇÃO: MOVIMENTO EXPLOSIVO! Aguardar confirmação de direção. Risco MUITO ALTO!';
        } else if (alert.volatility > 3.5) {
            action = '🎯 AÇÃO: Volatilidade alta. Aumento de liquidez. Operar com stops mais largos.';
        } else {
            action = '🎯 AÇÃO: Atenção! Atividade incomum detectada. Monitorar para possível movimento.';
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_🌊 PrimeX_`;
        
        return message;
    }

    async analyzeCVDDivergence() {
        log('📊 Analisando divergências de CVD...', 'indicator');
        
        for (const [symbol, snapshot] of this.snapshots) {
            if (!snapshot.cvdHistory || !snapshot.priceHistory) continue;
            if (snapshot.cvdHistory.length < 20 || snapshot.priceHistory.length < 20) continue;
            
            try {
                const cvdValues = snapshot.cvdHistory.map(h => h.cvd);
                const priceValues = snapshot.priceHistory.map(h => h.price);
                
                const divergence15m = detectCVDDivergence(symbol, cvdValues, priceValues);
                
                if (divergence15m) {
                    const cacheKey = `${symbol}_15m`;
                    const lastAlert = indicatorHistory.cvdDivergence.get(cacheKey);
                    const cooldown = CONFIG.INDICATORS.CVD_DIVERGENCE.COOLDOWN_MINUTES * 60 * 1000;
                    
                    if (!lastAlert || (Date.now() - lastAlert.timestamp) > cooldown) {
                        const currentPrice = snapshot.lastPrice;
                        const sr = await calculateSupportResistance(symbol, currentPrice);
                        const currentRSI = await getCurrentRSI(symbol);
                        const currentLSR = await getCurrentLSR(symbol);
                        
                        const alert = {
                            symbol: symbol.replace('USDT', ''),
                            timeframe: '15m',
                            type: divergence15m.type,
                            description: divergence15m.description,
                            cvdChange: divergence15m.cvdChange,
                            priceChangePercent: divergence15m.priceChangePercent,
                            price: currentPrice,
                            rsi: currentRSI,
                            lsr: currentLSR,
                            supports: sr ? sr.supports : [],
                            resistances: sr ? sr.resistances : []
                        };
                        
                        this.queueMessage(this.formatCVDDivergenceAlert(alert));
                        indicatorHistory.cvdDivergence.set(cacheKey, { type: divergence15m.type, timestamp: Date.now() });
                        log(`📊 DIVERGÊNCIA CVD ${symbol} 15m: ${divergence15m.type}`, 'indicator', symbol);
                    }
                }
            } catch (error) {
                log(`Erro analyzeCVDDivergence ${symbol}: ${error.message}`, 'error');
            }
        }
    }

    formatCVDDivergenceAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const isBullish = alert.type === 'BULLISH';
        const emoji = isBullish ? '📈🟢💰' : '📉🔴⚠️';
        const title = isBullish ? 'DIVERGÊNCIA DE ALTA - CVD' : 'DIVERGÊNCIA DE BAIXA - CVD';
        const action = isBullish ? 
            '🎯 AÇÃO: OPORTUNIDADE DE COMPRA! Possível reversão de baixa para alta' : 
            '🎯 AÇÃO: SINAL DE VENDA! Possível reversão de alta para baixa';
        
        let message = `_${emoji} ${title}_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Timeframe:_ ${alert.timeframe}\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_CVD Change:_ ${alert.cvdChange > 0 ? '+' : ''}${formatLargeNumber(alert.cvdChange)}\n`;
        message += `_Preço Change:_ ${(alert.priceChangePercent * 100).toFixed(2)}%\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        message += `\n_📊 Análise:_\n`;
        message += `${alert.description}\n\n`;
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_📊 PrimeX_`;
        
        return message;
    }

    async detectWhales() {
        const now = Date.now();
        
        for (const [symbol, snapshot] of this.snapshots) {
            if (!snapshot.minuteData || !snapshot.minuteData.length || !snapshot.trades || snapshot.trades.length < 20) continue;
            
            try {
                const last60Sec = snapshot.minuteData.slice(-60);
                if (last60Sec.length < 30) continue;
                
                let totalBuy = 0, totalSell = 0, totalCVD = 0, totalWhaleTrades = 0;
                let maxWhaleValue = 0;
                let maxWhaleMultiplier = 0;
                
                for (const sec of last60Sec) {
                    totalBuy += sec.buyVolume || 0;
                    totalSell += sec.sellVolume || 0;
                    totalCVD += sec.cvdChange || 0;
                    totalWhaleTrades += sec.whaleTrades || 0;
                }
                
                const totalVolume = totalBuy + totalSell;
                const buyRatio = totalVolume > 0 ? (totalBuy / totalVolume) * 100 : 50;
                
                const recentWhaleTrades = (snapshot.highVolumeTrades || []).filter(t => t.time > now - 60000);
                for (const wt of recentWhaleTrades) {
                    if (wt.value > maxWhaleValue) maxWhaleValue = wt.value;
                    if (parseFloat(wt.multiplier) > maxWhaleMultiplier) maxWhaleMultiplier = parseFloat(wt.multiplier);
                }
                
                const lastAlert = whaleHistory.get(symbol);
                const cooldown = CONFIG.WHALE_HUNTING.COOLDOWN_MINUTES * 60 * 1000;
                if (lastAlert && (now - lastAlert.timestamp) < cooldown) continue;
                
                let alertType = null;
                let intensity = null;
                
                if (totalCVD > CONFIG.WHALE_HUNTING.CVD_THRESHOLD_CRITICAL && 
                    buyRatio > CONFIG.WHALE_HUNTING.BUY_RATIO_CRITICAL && 
                    totalWhaleTrades >= CONFIG.WHALE_HUNTING.MIN_WHALE_TRADES_CRITICAL) {
                    alertType = 'WHALE_BUYING_CRITICAL';
                    intensity = 'CRÍTICO';
                }
                else if (totalCVD < -CONFIG.WHALE_HUNTING.CVD_THRESHOLD_CRITICAL && 
                         buyRatio < CONFIG.WHALE_HUNTING.SELL_RATIO_CRITICAL && 
                         totalWhaleTrades >= CONFIG.WHALE_HUNTING.MIN_WHALE_TRADES_CRITICAL) {
                    alertType = 'WHALE_SELLING_CRITICAL';
                    intensity = 'CRÍTICO';
                }
                else if (totalCVD > CONFIG.WHALE_HUNTING.CVD_THRESHOLD_HIGH && 
                         buyRatio > CONFIG.WHALE_HUNTING.BUY_RATIO_HIGH && 
                         totalWhaleTrades >= CONFIG.WHALE_HUNTING.MIN_WHALE_TRADES_HIGH) {
                    alertType = 'WHALE_BUYING_HIGH';
                    intensity = 'ALTO';
                }
                else if (totalCVD < -CONFIG.WHALE_HUNTING.CVD_THRESHOLD_HIGH && 
                         buyRatio < CONFIG.WHALE_HUNTING.SELL_RATIO_HIGH && 
                         totalWhaleTrades >= CONFIG.WHALE_HUNTING.MIN_WHALE_TRADES_HIGH) {
                    alertType = 'WHALE_SELLING_HIGH';
                    intensity = 'ALTO';
                }
                else if (totalCVD > CONFIG.WHALE_HUNTING.CVD_THRESHOLD_MEDIUM && 
                         buyRatio > 55 && 
                         totalWhaleTrades >= 1) {
                    alertType = 'ACCUMULATION';
                    intensity = 'MÉDIO';
                }
                else if (totalCVD < -CONFIG.WHALE_HUNTING.CVD_THRESHOLD_MEDIUM && 
                         buyRatio < 45 && 
                         totalWhaleTrades >= 1) {
                    alertType = 'DISTRIBUTION';
                    intensity = 'MÉDIO';
                }
                
                if (alertType) {
                    const sr = await calculateSupportResistance(symbol, snapshot.lastPrice);
                    const currentRSI = await getCurrentRSI(symbol);
                    const currentLSR = await getCurrentLSR(symbol);
                    
                    const alert = {
                        symbol,
                        type: alertType,
                        intensity,
                        cvd: totalCVD,
                        buyRatio,
                        whaleTrades: totalWhaleTrades,
                        maxWhaleValue,
                        maxWhaleMultiplier,
                        price: snapshot.lastPrice,
                        timestamp: now,
                        rsi: currentRSI,
                        lsr: currentLSR,
                        supports: sr ? sr.supports : [],
                        resistances: sr ? sr.resistances : []
                    };
                    
                    this.queueMessage(this.formatWhaleAlert(alert));
                    whaleHistory.set(symbol, { type: alertType, timestamp: now });
                    
                    const action = alertType.includes('BUY') ? 'COMPRANDO' : (alertType.includes('SELL') ? 'VENDENDO' : 'MOVENDO');
                    log(`🔴 ALERTA ${intensity}: BALEIA ${action} em ${symbol} | CVD: ${formatLargeNumber(totalCVD)} | Ratio: ${buyRatio.toFixed(1)}% | ${totalWhaleTrades} trades`, 'alert', symbol);
                }
            } catch (error) {
                log(`Erro detectWhales ${symbol}: ${error.message}`, 'error');
            }
        }
    }

    formatWhaleAlert(alert) {
        const symbol = alert.symbol.replace('USDT', '');
        const timestamp = getBrazilianDateTime();
        
        const intensityEmoji = alert.intensity === 'CRÍTICO' ? '⚠️⚠️⚠️' : 
                               (alert.intensity === 'ALTO' ? '⚠️⚠️' : '⚠️');
        
        let title = '';
        let emoji = '';
        let description = '';
        let action = '';
        
        switch (alert.type) {
            case 'WHALE_BUYING_CRITICAL':
                emoji = '🐋🔥🔥🔥';
                title = 'BALEIA GIGANTE COMPRANDO';
                description = `⚠️ ATIVIDADE EXPLOSIVA DETECTADA!\n${alert.whaleTrades} trades baleia/60s\nMaior: ${formatLargeNumber(alert.maxWhaleValue)} USDT(${alert.maxWhaleMultiplier.toFixed(1)}x)`;
                action = '🎯 AÇÃO: PREPARAR PUMP FORTE!';
                break;
                
            case 'WHALE_SELLING_CRITICAL':
                emoji = '🐋🔻🔻🔻';
                title = 'BALEIA GIGANTE VENDENDO';
                description = `⚠️ DISTRIBUIÇÃO EM MASSA!\n${alert.whaleTrades} trades baleia/60s\nMaior: ${formatLargeNumber(alert.maxWhaleValue)} USDT(${alert.maxWhaleMultiplier.toFixed(1)}x)`;
                action = '🎯 AÇÃO: REDUZIR EXPOSIÇÃO!';
                break;
                
            case 'WHALE_BUYING_HIGH':
                emoji = '🐋🔥🔥';
                title = 'BALEIA COMPRANDO FORTE';
                description = `${alert.whaleTrades} trade(s) baleia\nMaior: ${formatLargeNumber(alert.maxWhaleValue)} USDT(${alert.maxWhaleMultiplier.toFixed(1)}x)`;
                action = '🎯 AÇÃO: Acumulação detectada.';
                break;
                
            case 'WHALE_SELLING_HIGH':
                emoji = '🐋🔻🔻';
                title = 'BALEIA VENDENDO FORTE';
                description = `${alert.whaleTrades} trade(s) baleia\nVenda: ${formatLargeNumber(alert.maxWhaleValue)} USDT(${alert.maxWhaleMultiplier.toFixed(1)}x)`;
                action = '🎯 AÇÃO: Cautela! Evitar compras.';
                break;
                
            case 'ACCUMULATION':
                emoji = '🐋📈';
                title = 'ACUMULAÇÃO SILENCIOSA';
                description = `CVD: +${formatLargeNumber(alert.cvd)} USDT/60s\nRatio: ${alert.buyRatio.toFixed(1)}% compra`;
                action = '🎯 AÇÃO: Aguardar confirmação.';
                break;
                
            case 'DISTRIBUTION':
                emoji = '🐋📉';
                title = 'DISTRIBUIÇÃO SILENCIOSA';
                description = `CVD: ${formatLargeNumber(alert.cvd)} USDT/60s\nRatio: ${(100 - alert.buyRatio).toFixed(1)}% venda`;
                action = '🎯 AÇÃO: Reduzir exposição.';
                break;
        }
        
        let message = `_${intensityEmoji} ${title} ${intensityEmoji}_\n\n`;
        message += `_${emoji} ${symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_CVD:_ ${alert.cvd > 0 ? '+' : ''}${formatLargeNumber(alert.cvd)}\n`;
        message += `_Fluxo:_ ${alert.buyRatio.toFixed(1)}%/${(100 - alert.buyRatio).toFixed(1)}%\n`;
        message += `_Baleias:_ ${alert.whaleTrades}/60s\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${description}\n${action}\n\n`;
        message += `_🕒 ${timestamp}_\n_🐋 PrimeX_`;
        
        return message;
    }

    async analyzeIndicators() {
        log('📊 Analisando indicadores...', 'indicator');
        
        for (const symbol of TOP_SYMBOLS) {
            try {
                const currentPrice = this.lastPrices.get(symbol) || 0;
                await this.analyzeLSR(symbol, currentPrice);
                await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
                await this.analyzeCCI(symbol, currentPrice);
                await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
                await this.analyzeRSI(symbol, currentPrice);
                await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
                await this.analyzeStochastic(symbol, currentPrice);
                await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
            } catch (error) {
                log(`Erro analyzeIndicators ${symbol}: ${error.message}`, 'error');
            }
        }
        
        log('✅ Análise concluída', 'success');
    }

    async analyzeLSR(symbol, currentPrice) {
        try {
            const lsrData = await this.fetchLSR(symbol, '15m');
            if (!lsrData) return;
            
            const currentLSR = lsrData.longShortRatio;
            const timestamp = Date.now();
            
            const lastAlert = indicatorHistory.lsr.get(symbol);
            const cooldown = CONFIG.INDICATORS.LSR_15M.COOLDOWN_MINUTES * 60 * 1000;
            if (lastAlert && (timestamp - lastAlert.timestamp) < cooldown) return;
            
            const sr = await calculateSupportResistance(symbol, currentPrice);
            const currentRSI = await getCurrentRSI(symbol);
            
            if (currentLSR > CONFIG.INDICATORS.LSR_15M.OVERBOUGHT) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    lsr: currentLSR,
                    price: currentPrice,
                    type: 'LSR_OVERBOUGHT',
                    rsi: currentRSI,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatLSRAlert(alert));
                indicatorHistory.lsr.set(symbol, { value: currentLSR, timestamp: timestamp });
                log(`📊 LSR: ${symbol} SOBRECOMPRA ${currentLSR.toFixed(2)}`, 'indicator', symbol);
            }
            else if (currentLSR < CONFIG.INDICATORS.LSR_15M.OVERSOLD) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    lsr: currentLSR,
                    price: currentPrice,
                    type: 'LSR_OVERSOLD',
                    rsi: currentRSI,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatLSRAlert(alert));
                indicatorHistory.lsr.set(symbol, { value: currentLSR, timestamp: timestamp });
                log(`📊 LSR: ${symbol} SOBREVENDA ${currentLSR.toFixed(2)}`, 'indicator', symbol);
            }
            
        } catch (error) {
            log(`Erro LSR ${symbol}: ${error.message}`, 'error');
        }
    }

    async fetchLSR(symbol, period) {
        try {
            const futuresSymbol = symbol.replace('USDT', 'USDT');
            const url = `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${futuresSymbol}&period=${period}&limit=1`;
            
            const data = await fetchWithRetry(url);
            
            if (data && data.length > 0 && data[0].longShortRatio) {
                return {
                    longShortRatio: parseFloat(data[0].longShortRatio)
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async analyzeCCI(symbol, currentPrice) {
        for (const [timeframe, config] of Object.entries(CONFIG.INDICATORS.CCI.TIMEFRAMES)) {
            await this.analyzeCCIForTimeframe(symbol, timeframe, config, currentPrice);
            await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
        }
    }

    async analyzeCCIForTimeframe(symbol, timeframe, config, currentPrice) {
        try {
            const candles = await fetchCandles(symbol, timeframe, 100);
            if (!candles || !candles.closes || candles.closes.length < CONFIG.INDICATORS.CCI.PERIOD + 5) return;
            
            const cciValues = calculateCCI(candles.highs, candles.lows, candles.closes, CONFIG.INDICATORS.CCI.PERIOD);
            if (!cciValues || cciValues.length < 2) return;
            
            const currentCCI = cciValues[cciValues.length - 1];
            const previousCCI = cciValues[cciValues.length - 2];
            const emaCCI = calculateEMA(cciValues, CONFIG.INDICATORS.CCI.EMA_PERIOD);
            
            if (!emaCCI) return;
            
            const previousEMAValue = this.getPreviousEMA(symbol, timeframe, cciValues);
            const timestamp = Date.now();
            const cacheKey = `${symbol}_${timeframe}`;
            
            const lastAlert = indicatorHistory.cci.get(cacheKey);
            if (lastAlert && (timestamp - lastAlert.timestamp) < config.cooldown) return;
            
            const sr = await calculateSupportResistance(symbol, currentPrice);
            const currentRSI = await getCurrentRSI(symbol);
            const currentLSR = await getCurrentLSR(symbol);
            
            if (previousCCI <= previousEMAValue && currentCCI > emaCCI) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    timeframe: timeframe,
                    cci: currentCCI,
                    ema: emaCCI,
                    price: currentPrice,
                    type: 'CCI_CROSS_UP',
                    rsi: currentRSI,
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatCCIAlert(alert));
                indicatorHistory.cci.set(cacheKey, { value: currentCCI, timestamp: timestamp });
                log(`📊 CCI ${symbol} ${timeframe} CRUZOU CIMA`, 'indicator', symbol);
            }
            else if (previousCCI >= previousEMAValue && currentCCI < emaCCI) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    timeframe: timeframe,
                    cci: currentCCI,
                    ema: emaCCI,
                    price: currentPrice,
                    type: 'CCI_CROSS_DOWN',
                    rsi: currentRSI,
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatCCIAlert(alert));
                indicatorHistory.cci.set(cacheKey, { value: currentCCI, timestamp: timestamp });
                log(`📊 CCI ${symbol} ${timeframe} CRUZOU BAIXO`, 'indicator', symbol);
            }
            
            this.updatePreviousEMA(symbol, timeframe, emaCCI);
            
        } catch (error) {
            log(`Erro CCI ${symbol}: ${error.message}`, 'error');
        }
    }

    getPreviousEMA(symbol, timeframe, cciValues) {
        const key = `${symbol}_${timeframe}_ema`;
        if (previousEMA[key]) {
            return previousEMA[key];
        }
        if (cciValues && cciValues.length >= CONFIG.INDICATORS.CCI.EMA_PERIOD + 1) {
            const prevValues = cciValues.slice(0, -1);
            return calculateEMA(prevValues, CONFIG.INDICATORS.CCI.EMA_PERIOD) || 0;
        }
        return 0;
    }

    updatePreviousEMA(symbol, timeframe, ema) {
        const key = `${symbol}_${timeframe}_ema`;
        previousEMA[key] = ema;
    }

    async analyzeRSI(symbol, currentPrice) {
        try {
            const candles = await fetchCandles(symbol, '1h', 100);
            if (!candles || !candles.closes || candles.closes.length < CONFIG.INDICATORS.RSI_1H.PERIOD + 1) return;
            
            const rsi = calculateRSI(candles.closes, CONFIG.INDICATORS.RSI_1H.PERIOD);
            if (!rsi) return;
            
            const timestamp = Date.now();
            const lastAlert = indicatorHistory.rsi.get(symbol);
            const cooldown = CONFIG.INDICATORS.RSI_1H.COOLDOWN_MINUTES * 60 * 1000;
            if (lastAlert && (timestamp - lastAlert.timestamp) < cooldown) return;
            
            const sr = await calculateSupportResistance(symbol, currentPrice);
            const currentLSR = await getCurrentLSR(symbol);
            
            if (rsi > CONFIG.INDICATORS.RSI_1H.OVERBOUGHT) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    rsi: rsi,
                    price: currentPrice,
                    type: 'RSI_OVERBOUGHT',
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatRSIAlert(alert));
                indicatorHistory.rsi.set(symbol, { value: rsi, timestamp: timestamp });
                log(`📊 RSI ${symbol} SOBRECOMPRA ${rsi.toFixed(2)}`, 'indicator', symbol);
            }
            else if (rsi < CONFIG.INDICATORS.RSI_1H.OVERSOLD) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    rsi: rsi,
                    price: currentPrice,
                    type: 'RSI_OVERSOLD',
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatRSIAlert(alert));
                indicatorHistory.rsi.set(symbol, { value: rsi, timestamp: timestamp });
                log(`📊 RSI ${symbol} SOBREVENDA ${rsi.toFixed(2)}`, 'indicator', symbol);
            }
            
        } catch (error) {
            log(`Erro RSI ${symbol}: ${error.message}`, 'error');
        }
    }

    async analyzeStochastic(symbol, currentPrice) {
        for (const [timeframe, config] of Object.entries(CONFIG.INDICATORS.STOCHASTIC.TIMEFRAMES)) {
            await this.analyzeStochasticForTimeframe(symbol, timeframe, config, currentPrice);
            await this.delay(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
        }
    }

    async analyzeStochasticForTimeframe(symbol, timeframe, config, currentPrice) {
        try {
            const candles = await fetchCandles(symbol, timeframe, 150);
            if (!candles || !candles.closes || candles.closes.length < 50) return;
            
            const stochastic = calculateStochastic(
                candles.highs, candles.lows, candles.closes,
                CONFIG.INDICATORS.STOCHASTIC.K_PERIOD,
                CONFIG.INDICATORS.STOCHASTIC.D_PERIOD,
                CONFIG.INDICATORS.STOCHASTIC.SLOW_K
            );
            
            if (!stochastic || !stochastic.k || stochastic.k.length < 2 || !stochastic.d || stochastic.d.length < 2) return;
            
            const currentK = stochastic.k[stochastic.k.length - 1];
            const currentD = stochastic.d[stochastic.d.length - 1];
            const previousK = stochastic.k[stochastic.k.length - 2];
            const previousD = stochastic.d[stochastic.d.length - 2];
            
            const timestamp = Date.now();
            const cacheKey = `${symbol}_${timeframe}`;
            const lastAlert = indicatorHistory.stochastic.get(cacheKey);
            if (lastAlert && (timestamp - lastAlert.timestamp) < config.cooldown) return;
            
            const sr = await calculateSupportResistance(symbol, currentPrice);
            const currentRSI = await getCurrentRSI(symbol);
            const currentLSR = await getCurrentLSR(symbol);
            
            if (previousK <= previousD && currentK > currentD) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    timeframe: timeframe,
                    k: currentK,
                    d: currentD,
                    price: currentPrice,
                    type: 'STOCH_CROSS_UP',
                    rsi: currentRSI,
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatStochasticAlert(alert));
                indicatorHistory.stochastic.set(cacheKey, { value: currentK, timestamp: timestamp });
                log(`📊 STOCH ${symbol} ${timeframe} K/D CIMA`, 'indicator', symbol);
            }
            else if (previousK >= previousD && currentK < currentD) {
                const alert = {
                    symbol: symbol.replace('USDT', ''),
                    timeframe: timeframe,
                    k: currentK,
                    d: currentD,
                    price: currentPrice,
                    type: 'STOCH_CROSS_DOWN',
                    rsi: currentRSI,
                    lsr: currentLSR,
                    supports: sr ? sr.supports : [],
                    resistances: sr ? sr.resistances : []
                };
                this.queueMessage(this.formatStochasticAlert(alert));
                indicatorHistory.stochastic.set(cacheKey, { value: currentK, timestamp: timestamp });
                log(`📊 STOCH ${symbol} ${timeframe} K/D BAIXO`, 'indicator', symbol);
            }
            
        } catch (error) {
            log(`Erro STOCH ${symbol}: ${error.message}`, 'error');
        }
    }

    formatLSRAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const isOverbought = alert.type === 'LSR_OVERBOUGHT';
        const emoji = isOverbought ? '📈🔥' : '📉❄️';
        const title = isOverbought ? 'LSR SOBRECOMPRA' : 'LSR SOBREVENDA';
        const action = isOverbought ? 
            '_🎯 Reduzir LONGs, risco correção_' : '_🎯 Aguardar reversão compra_';
        
        let message = `_${emoji} ${title}_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_LSR:_ ${alert.lsr.toFixed(2)}\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_Titanium PrimeX_`;
        return message;
    }

    formatCCIAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const isCrossUp = alert.type === 'CCI_CROSS_UP';
        const tf = alert.timeframe === '4h' ? '4H' : 'DIÁRIO';
        const emoji = isCrossUp ? '📈🟢' : '📉🔴';
        const title = isCrossUp ? `CCI ${tf} CRUZOU CIMA` : `CCI ${tf} CRUZOU BAIXO`;
        const action = isCrossUp ? '_🎯 Sinal COMPRA_' : '_🎯 Sinal VENDA_';
        
        let message = `_${emoji} ${title}_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_CCI:_ ${alert.cci.toFixed(2)}\n`;
        message += `_EMA:_ ${alert.ema.toFixed(2)}\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_Titanium PrimeX_`;
        return message;
    }

    formatRSIAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const isOverbought = alert.type === 'RSI_OVERBOUGHT';
        const emoji = isOverbought ? '🔥⚠️' : '❄️💚';
        const title = isOverbought ? 'RSI 1H SOBRECOMPRA' : 'RSI 1H SOBREVENDA';
        const action = isOverbought ? '_🎯 Evitar compras_' : '_🎯 Oportunidade compra_';
        
        let message = `_${emoji} ${title}_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_RSI:_ ${alert.rsi.toFixed(2)}\n`;
        
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_Titanium PrimeX_`;
        return message;
    }

    formatStochasticAlert(alert) {
        const timestamp = getBrazilianDateTime();
        const isCrossUp = alert.type === 'STOCH_CROSS_UP';
        const tf = alert.timeframe === '12h' ? '12H' : 'DIÁRIO';
        const emoji = isCrossUp ? '📈🟢' : '📉🔴';
        const title = isCrossUp ? `ESTOCÁSTICO ${tf} K/D CIMA` : `ESTOCÁSTICO ${tf} K/D BAIXO`;
        const action = isCrossUp ? '_🎯 Sinal COMPRA_' : '_🎯 Sinal VENDA_';
        
        let message = `_${emoji} ${title}_\n\n`;
        message += `_${alert.symbol}_\n`;
        message += `_Preço:_ $${formatPrice(alert.price)}\n`;
        message += `_K:_ ${alert.k.toFixed(2)}\n`;
        message += `_D:_ ${alert.d.toFixed(2)}\n`;
        
        if (alert.rsi) {
            const rsiEmoji = alert.rsi > 70 ? '🔥' : (alert.rsi < 30 ? '❄️' : '📊');
            message += `_RSI 1h:_ ${rsiEmoji} ${alert.rsi.toFixed(2)}\n`;
        }
        if (alert.lsr) {
            const lsrEmoji = alert.lsr > 1.7 ? '📈' : (alert.lsr < 1.0 ? '📉' : '⚖️');
            message += `_LSR 15m:_ ${lsrEmoji} ${alert.lsr.toFixed(2)}\n`;
        }
        
        if (alert.supports && alert.supports.length > 0) {
            message += `_Sups:_ ${alert.supports.join('|')}\n`;
        }
        if (alert.resistances && alert.resistances.length > 0) {
            message += `_Ress:_ ${alert.resistances.join('|')}\n`;
        }
        
        message += `\n${action}\n\n_🕒 ${timestamp}_\n_ Titanium PrimeX_`;
        return message;
    }

    queueMessage(message) {
        if (message && this.messageQueue.length < 100) {
            this.messageQueue.push(message);
        }
    }

    async processMessageQueue() {
        if (this.messageQueue.length === 0) return;
        
        const message = this.messageQueue.shift();
        const success = await sendTelegramMessage(message);
        
        if (!success) {
            log(`Falha ao enviar mensagem, reenfileirando...`, 'error');
            if (this.messageQueue.length < 50) {
                this.messageQueue.unshift(message);
            }
        }
        
        await this.delay(2000);
    }

    showStatus() {
        const uptime = Math.floor((Date.now() - startTime) / 1000 / 60);
        let activeSymbols = 0;
        let totalTrades = 0;
        let totalWhaleTrades = 0;
        let totalMemory = 0;
        
        for (const [symbol, snapshot] of this.snapshots) {
            if (snapshot.trades && snapshot.trades.length > 0) {
                activeSymbols++;
                totalTrades += snapshot.trades.length;
                totalWhaleTrades += snapshot.highVolumeTrades ? snapshot.highVolumeTrades.length : 0;
                totalMemory += snapshot.trades.length;
                totalMemory += snapshot.cvdHistory ? snapshot.cvdHistory.length : 0;
            }
        }
        
        log(`📊 STATUS | ${uptime}min | ${this.connections.size}/${TOP_SYMBOLS.length} | Alertas:${totalAlertsSent} | Baleias:${totalWhaleTrades} | Mem:${totalMemory} itens`, 'info');
    }
}

// =====================================================================
// === SISTEMA PRINCIPAL ===
// =====================================================================
async function main() {
    console.log('\n' + '='.repeat(50));
    console.log('🐋 TITANIUM PRIME X - RADAR BALEIAS');
    console.log('='.repeat(50));
    console.log(`📊 ${TOP_SYMBOLS.length} moedas | Crítico:$${CONFIG.WHALE_HUNTING.CVD_THRESHOLD_CRITICAL/1000}K`);
    console.log(`📊 LSR>${CONFIG.INDICATORS.LSR_15M.OVERBOUGHT}/<${CONFIG.INDICATORS.LSR_15M.OVERSOLD}`);
    console.log(`📊 CCI(${CONFIG.INDICATORS.CCI.PERIOD}) EMA${CONFIG.INDICATORS.CCI.EMA_PERIOD} 4h/1d`);
    console.log(`📊 RSI>${CONFIG.INDICATORS.RSI_1H.OVERBOUGHT}/<${CONFIG.INDICATORS.RSI_1H.OVERSOLD}`);
    console.log(`📊 STOCH(${CONFIG.INDICATORS.STOCHASTIC.K_PERIOD}.${CONFIG.INDICATORS.STOCHASTIC.D_PERIOD}.${CONFIG.INDICATORS.STOCHASTIC.SLOW_K}) 12h/1d`);
    console.log(`📊 CVD DIVERGÊNCIA: 15min (cooldown: ${CONFIG.INDICATORS.CVD_DIVERGENCE.COOLDOWN_MINUTES}min)`);
    console.log(`🌊 VOLATILIDADE ANORMAL: >${CONFIG.INDICATORS.VOLATILITY.VOLATILITY_THRESHOLD}% (cooldown: ${CONFIG.INDICATORS.VOLATILITY.COOLDOWN_MINUTES}min)`);
    console.log(`📅 Horário Brasil: ${getBrazilianDateTime()}`);
    console.log('='.repeat(50) + '\n');
    
    const tracker = new WhaleTracker();
    await tracker.start();
    
    log('🚀 SISTEMA OPERACIONAL!', 'success');
}

process.on('SIGINT', () => {
    log('\n🛑 Desligando...', 'warning');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    log(`Erro não tratado: ${error.message}`, 'error');
});

process.on('unhandledRejection', (reason, promise) => {
    log(`Promise rejeitada não tratada: ${reason}`, 'error');
});

main().catch(console.error);
