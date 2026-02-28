const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const z = require('zod');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8g',
        CHAT_ID: '-10025549'
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 200, // AUMENTADO de 50 para 200ms
        SCAN_INTERVAL_SECONDS: 120, // AUMENTADO de 60 para 120 segundos
        CANDLE_CACHE_TTL: 300000,
        BATCH_SIZE: 15, // REDUZIDO de 20 para 15
        REQUEST_TIMEOUT: 15000, // AUMENTADO de 10000 para 15000
        COOLDOWN_MINUTES: 30,
        PRICE_DEVIATION_THRESHOLD: 0.5,
        TELEGRAM_RETRY_ATTEMPTS: 3, // NOVO: tentativas para Telegram
        TELEGRAM_RETRY_DELAY: 2000 // NOVO: delay entre tentativas
    },
    VOLUME: {
        TIMEFRAME: '1h',
        EMA_PERIOD: 9,
        MIN_VOLUME_RATIO: 1.2,
        BUYER_THRESHOLD: 52,
        SELLER_THRESHOLD: 48,
        CONFIRMATION_CANDLES: 2
    },
    RATE_LIMITER: {
        INITIAL_DELAY: 200, // AUMENTADO de 100 para 200ms
        MAX_DELAY: 5000, // AUMENTADO de 2000 para 5000ms
        BACKOFF_FACTOR: 2 // AUMENTADO de 1.5 para 2
    },
    TRADE: {
        RISK_REWARD_RATIO: 2.5,
        STOP_PERCENTAGE: 2,
        TAKE_PROFIT_LEVELS: [2, 3, 4],
        PARTIAL_CLOSE: [30, 30, 40]
    },
    ALERTS: {
        MIN_SCORE: 70,
        MIN_VOLUME_RATIO: 1.5,
        ENABLE_SOUND: true,
        MAX_ALERTS_PER_SCAN: 3, // NOVO: reduzir flood
        PRIORITY_LEVELS: {
            ALTA: 85,
            MEDIA: 75,
            BAIXA: 70
        }
    },
    DEBUG: {
        VERBOSE: false
    }
};

// =====================================================================
// === SCHEMAS DE VALIDAÇÃO ZOD ===
// =====================================================================
const CandleSchema = z.object({
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().positive(),
    time: z.number().int()
});

const KlineResponseSchema = z.array(
    z.tuple([
        z.number(), z.string(), z.string(), z.string(), z.string(),
        z.string(), z.number(), z.string(), z.number(), z.string(),
        z.string(), z.string()
    ])
);

const LSRResponseSchema = z.array(
    z.object({
        longShortRatio: z.string(),
        longAccount: z.string(),
        shortAccount: z.string()
    })
);

const FundingRateSchema = z.array(
    z.object({
        symbol: z.string(),
        fundingRate: z.string(),
        fundingTime: z.number()
    })
);

const ExchangeInfoSchema = z.object({
    symbols: z.array(
        z.object({
            symbol: z.string(),
            status: z.string()
        })
    )
});

const TradeAlertSchema = z.object({
    symbol: z.string(),
    direction: z.enum(['COMPRA', 'VENDA']),
    entryPrice: z.number(),
    stopLoss: z.number(),
    takeProfit1: z.number(),
    takeProfit2: z.number(),
    takeProfit3: z.number(),
    riskReward: z.number(),
    confidence: z.number(),
    score: z.number(),
    volumeRatio: z.number(),
    buyerPercentage: z.number(),
    sellerPercentage: z.number(),
    lsr: z.number().optional().nullable(),
    funding: z.number().optional().nullable(),
    rsi: z.number().optional().nullable(),
    support: z.number(),
    resistance: z.number(),
    emoji: z.string(),
    timestamp: z.number()
});

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';
const ALERTS_DIR = './alerts';

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(ALERTS_DIR)) fs.mkdirSync(ALERTS_DIR, { recursive: true });

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const candleCache = new Map();
const alertCooldown = new Map();
const lastAlertPrices = new Map();

class CacheManager {
    static get(symbol, timeframe, limit) {
        const key = `${symbol}_${timeframe}_${limit}`;
        const cached = candleCache.get(key);
        if (cached && Date.now() - cached.timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            return cached.data;
        }
        return null;
    }

    static set(symbol, timeframe, limit, data) {
        const key = `${symbol}_${timeframe}_${limit}`;
        candleCache.set(key, { data, timestamp: Date.now() });
    }
}

// =====================================================================
// === RATE LIMITER MELHORADO ===
// =====================================================================
class RateLimiter {
    constructor() {
        this.currentDelay = CONFIG.RATE_LIMITER.INITIAL_DELAY;
        this.consecutiveErrors = 0;
        this.lastRequestTime = 0;
        this.requestCount = 0;
        this.minuteRequests = 0;
        this.lastMinuteReset = Date.now();
        this.errorLog = new Map(); // Para log de erros frequentes
    }

    checkRateLimit() {
        const now = Date.now();
        if (now - this.lastMinuteReset > 60000) {
            this.minuteRequests = 0;
            this.lastMinuteReset = now;
        }
        
        if (this.minuteRequests >= 1000) { // REDUZIDO de 1200 para 1000 (mais seguro)
            const waitTime = 60000 - (now - this.lastMinuteReset);
            if (waitTime > 0) {
                console.log(`⏳ Rate limit atingido, aguardando ${Math.ceil(waitTime/1000)}s`);
                return waitTime;
            }
        }
        return 0;
    }

    async makeRequest(url, options = {}, type = 'klines') {
        const rateLimitWait = this.checkRateLimit();
        if (rateLimitWait > 0) {
            await new Promise(r => setTimeout(r, rateLimitWait));
        }

        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.currentDelay) {
            await new Promise(r => setTimeout(r, this.currentDelay - timeSinceLastRequest));
        }

        // Implementar retry com backoff
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);

                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                
                this.lastRequestTime = Date.now();
                this.minuteRequests++;
                this.requestCount++;

                if (!response.ok) {
                    if (response.status === 429) { // Rate limit específico
                        const retryAfter = response.headers.get('retry-after') || 60;
                        console.log(`⏳ Rate limit 429, aguardando ${retryAfter}s`);
                        await new Promise(r => setTimeout(r, retryAfter * 1000));
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }
                
                this.consecutiveErrors = 0;
                this.currentDelay = Math.max(CONFIG.RATE_LIMITER.INITIAL_DELAY, this.currentDelay * 0.9);
                
                return await response.json();
                
            } catch (error) {
                lastError = error;
                this.consecutiveErrors++;
                
                if (error.name === 'AbortError') {
                    console.log(`⏱️ Timeout na requisição ${type} (tentativa ${attempt}/${maxRetries})`);
                } else {
                    console.log(`⚠️ Erro na requisição ${type} (tentativa ${attempt}/${maxRetries}): ${error.message}`);
                }
                
                if (attempt < maxRetries) {
                    const waitTime = this.currentDelay * Math.pow(2, attempt - 1);
                    console.log(`⏳ Aguardando ${Math.ceil(waitTime/1000)}s antes de tentar novamente...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        }
        
        this.currentDelay = Math.min(CONFIG.RATE_LIMITER.MAX_DELAY, this.currentDelay * CONFIG.RATE_LIMITER.BACKOFF_FACTOR);
        throw lastError;
    }
}

const rateLimiter = new RateLimiter();

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    const fullTime = brazilTime.toISOString().split('T')[1].split('.')[0];
    return { date, time, full: `${date} ${time}`, fullTime };
}

function formatNumber(num, decimals = 2) {
    if (num === undefined || num === null) return 'N/A';
    if (Math.abs(num) > 1000) return num.toFixed(decimals);
    if (Math.abs(num) > 1) return num.toFixed(decimals);
    return num.toFixed(decimals);
}

function formatPrice(price) {
    if (!price) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(3);
    if (price > 0.1) return price.toFixed(4);
    if (price > 0.01) return price.toFixed(5);
    if (price > 0.001) return price.toFixed(6);
    return price.toFixed(8);
}

function getConfidenceEmoji(score) {
    if (score >= 90) return '🔥🔥';
    if (score >= 85) return '🔥';
    if (score >= 80) return '⚡';
    if (score >= 75) return '✅';
    if (score >= 70) return '⚠️';
    return '📊';
}

function getDirectionEmoji(direction) {
    return direction === 'COMPRA' ? '🟢' : '🔴';
}

// =====================================================================
// === CÁLCULOS TÉCNICOS ===
// =====================================================================
function calculateEMA(values, period) {
    if (values.length < period) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        tr.push(Math.max(tr1, tr2, tr3));
    }
    
    const atr = tr.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
}

function calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const closes = candles.map(c => c.close);
    let gains = 0, losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period || 0.001;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateSupportResistance(candles) {
    if (candles.length < 50) return { support: null, resistance: null };
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const pivotHighs = [];
    const pivotLows = [];
    
    for (let i = 2; i < highs.length - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
            highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            pivotHighs.push(highs[i]);
        }
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
            lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            pivotLows.push(lows[i]);
        }
    }
    
    const resistance = pivotHighs.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, pivotHighs.length);
    const support = pivotLows.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, pivotLows.length);
    
    return { 
        support: support || lows[lows.length - 1] * 0.98, 
        resistance: resistance || highs[highs.length - 1] * 1.02 
    };
}

// =====================================================================
// === COOLDOWN CHECK ===
// =====================================================================
function canSendAlert(symbol, currentPrice, direction) {
    const now = Date.now();
    const cooldownKey = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    
    const lastAlert = alertCooldown.get(cooldownKey);
    if (lastAlert) {
        const timeDiff = (now - lastAlert) / (1000 * 60);
        if (timeDiff < CONFIG.PERFORMANCE.COOLDOWN_MINUTES) {
            return false;
        }
    }
    
    const lastPrice = lastAlertPrices.get(priceKey);
    if (lastPrice) {
        const priceDiff = Math.abs((currentPrice - lastPrice) / lastPrice * 100);
        if (priceDiff < CONFIG.PERFORMANCE.PRICE_DEVIATION_THRESHOLD) {
            return false;
        }
    }
    
    return true;
}

function registerAlert(symbol, price, direction) {
    const now = Date.now();
    const cooldownKey = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    
    alertCooldown.set(cooldownKey, now);
    lastAlertPrices.set(priceKey, price);
    
    for (const [key, timestamp] of alertCooldown) {
        if (now - timestamp > 2 * 60 * 60 * 1000) {
            alertCooldown.delete(key);
        }
    }
}

// =====================================================================
// === ANÁLISE DE VOLUME E GERAÇÃO DE ALERTAS ===
// =====================================================================
async function getCandles(symbol, timeframe, limit = 100) {
    const cached = CacheManager.get(symbol, timeframe, limit);
    if (cached) return cached;

    const intervalMap = {
        '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d'
    };
    
    const interval = intervalMap[timeframe] || '1h';
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    try {
        const data = await rateLimiter.makeRequest(url, {}, 'klines');
        
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
        
        CacheManager.set(symbol, timeframe, limit, candles);
        return candles;
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao buscar candles ${symbol}: ${error.message}`);
        }
        return [];
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'lsr');
        return data.length > 0 ? parseFloat(data[0].longShortRatio) : null;
    } catch {
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'funding');
        return data.length > 0 ? parseFloat(data[0].fundingRate) : null;
    } catch {
        return null;
    }
}

function calculateTradeLevels(price, atr, direction, support, resistance) {
    let stopLoss, takeProfit1, takeProfit2, takeProfit3;
    
    if (direction === 'COMPRA') {
        stopLoss = Math.min(
            support * 0.995,
            price - (atr * 1.5)
        );
        
        const risk = price - stopLoss;
        const reward1 = risk * CONFIG.TRADE.RISK_REWARD_RATIO;
        const reward2 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 1.5);
        const reward3 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 2);
        
        takeProfit1 = Math.min(price + reward1, resistance * 0.99);
        takeProfit2 = Math.min(price + reward2, resistance * 1.02);
        takeProfit3 = price + reward3;
        
    } else {
        stopLoss = Math.max(
            resistance * 1.005,
            price + (atr * 1.5)
        );
        
        const risk = stopLoss - price;
        const reward1 = risk * CONFIG.TRADE.RISK_REWARD_RATIO;
        const reward2 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 1.5);
        const reward3 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 2);
        
        takeProfit1 = Math.max(price - reward1, support * 1.01);
        takeProfit2 = Math.max(price - reward2, support * 0.98);
        takeProfit3 = price - reward3;
    }
    
    return { stopLoss, takeProfit1, takeProfit2, takeProfit3 };
}

async function analyzeForAlerts(symbol) {
    try {
        const [candles1h, candles15m] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '15m', 50)
        ]);
        
        if (candles1h.length < 30 || candles15m.length < 20) return null;
        
        const currentPrice = candles1h[candles1h.length - 1].close;
        const currentCandle15m = candles15m[candles15m.length - 1];
        
        const volumes = candles1h.map(c => c.volume);
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        
        const closes = candles1h.map(c => c.close);
        const ema9 = calculateEMA(closes.slice(-20), 9);
        
        let buyerVolume = 0, sellerVolume = 0, totalVolume = 0;
        const recentCandles = candles1h.slice(-24);
        
        recentCandles.forEach(candle => {
            const vol = candle.volume;
            totalVolume += vol;
            
            if (candle.close > ema9) {
                buyerVolume += vol;
            } else if (candle.close < ema9) {
                sellerVolume += vol;
            } else {
                buyerVolume += vol / 2;
                sellerVolume += vol / 2;
            }
        });
        
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 50;
        const sellerPercentage = 100 - buyerPercentage;
        
        const [lsr, funding, rsi1h, sr, atr] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            Promise.resolve(calculateRSI(candles1h, 14)),
            Promise.resolve(calculateSupportResistance(candles1h)),
            Promise.resolve(calculateATR(candles1h, 14))
        ]);
        
        if (!sr.support || !sr.resistance || !atr) return null;
        
        let direction = null;
        let score = 0;
        let confidence = 0;
        
        if (buyerPercentage > CONFIG.VOLUME.BUYER_THRESHOLD && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO) {
            
            direction = 'COMPRA';
            score = 50;
            
            if (buyerPercentage > 55) score += 10;
            if (buyerPercentage > 60) score += 10;
            if (volumeRatio > 2) score += 15;
            else if (volumeRatio > 1.5) score += 10;
            if (lsr && lsr < 2.0) score += 15;
            else if (lsr && lsr < 2.5) score += 10;
            if (funding && funding < -0.0005) score += 15;
            if (rsi1h && rsi1h < 45) score += 10;
            if (rsi1h && rsi1h < 35) score += 15;
            if (currentPrice < sr.resistance * 0.98) score += 10;
            
            confidence = Math.min(100, score);
        }
        
        if (sellerPercentage > (100 - CONFIG.VOLUME.SELLER_THRESHOLD) && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO) {
            
            direction = 'VENDA';
            score = 50;
            
            if (sellerPercentage > 55) score += 10;
            if (sellerPercentage > 60) score += 10;
            if (volumeRatio > 2) score += 15;
            else if (volumeRatio > 1.5) score += 10;
            if (lsr && lsr > 3.0) score += 15;
            else if (lsr && lsr > 2.5) score += 10;
            if (funding && funding > 0.0005) score += 15;
            if (rsi1h && rsi1h > 60) score += 10;
            if (rsi1h && rsi1h > 70) score += 15;
            if (currentPrice > sr.support * 1.02) score += 10;
            
            confidence = Math.min(100, score);
        }
        
        if (!direction || confidence < CONFIG.ALERTS.MIN_SCORE) return null;
        
        if (!canSendAlert(symbol, currentPrice, direction)) return null;
        
        const { stopLoss, takeProfit1, takeProfit2, takeProfit3 } = 
            calculateTradeLevels(currentPrice, atr, direction, sr.support, sr.resistance);
        
        const riskReward = Math.abs((takeProfit1 - currentPrice) / (currentPrice - stopLoss));
        
        const emoji = getConfidenceEmoji(confidence);
        
        const alert = {
            symbol,
            direction,
            entryPrice: currentPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            takeProfit3,
            riskReward: parseFloat(riskReward.toFixed(2)),
            confidence,
            score: confidence,
            volumeRatio,
            buyerPercentage,
            sellerPercentage,
            lsr,
            funding,
            rsi: rsi1h,
            support: sr.support,
            resistance: sr.resistance,
            emoji,
            timestamp: Date.now()
        };
        
        try {
            TradeAlertSchema.parse(alert);
            return alert;
        } catch (error) {
            if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⚠️ Alerta inválido para ${symbol}:`, error.errors);
            }
            return null;
        }
        
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao analisar ${symbol}: ${error.message}`);
        }
        return null;
    }
}

// =====================================================================
// === TELEGRAM MELHORADO COM RETRY ===
// =====================================================================
async function sendTelegramAlert(message, parseMode = 'HTML') {
    let attempts = 0;
    const maxAttempts = CONFIG.PERFORMANCE.TELEGRAM_RETRY_ATTEMPTS;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            if (!CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) {
                console.log('⚠️ Telegram não configurado');
                return false;
            }

            const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CONFIG.TELEGRAM.CHAT_ID,
                    text: message,
                    parse_mode: parseMode,
                    disable_web_page_preview: true
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                
                // Se for rate limit do Telegram, aguardar mais
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('retry-after')) || 30;
                    console.log(`⏳ Rate limit Telegram, aguardando ${retryAfter}s (tentativa ${attempts}/${maxAttempts})`);
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }
                
                console.log(`❌ Erro Telegram (tentativa ${attempts}/${maxAttempts}): ${errorText}`);
                
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY * attempts));
                    continue;
                }
                
                return false;
            }
            
            // Sucesso!
            return true;
            
        } catch (error) {
            console.log(`❌ Erro Telegram (tentativa ${attempts}/${maxAttempts}): ${error.message}`);
            
            if (attempts < maxAttempts) {
                console.log(`⏳ Tentando novamente em ${CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY/1000 * attempts}s...`);
                await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY * attempts));
            }
        }
    }
    
    console.log('❌ Todas as tentativas de envio ao Telegram falharam');
    return false;
}

function formatTradeAlert(alert) {
    const time = getBrazilianDateTime();
    const symbolName = alert.symbol.replace('USDT', '');
    const dirEmoji = getDirectionEmoji(alert.direction);
    const direction = alert.direction === 'COMPRA' ? 'Compra' : 'Correção';
    
    const volPct = alert.direction === 'COMPRA' ? 
        alert.buyerPercentage.toFixed(0) : alert.sellerPercentage.toFixed(0);
    
    const fundingPct = alert.funding ? (alert.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = alert.funding && alert.funding > 0 ? '+' : '';
    
    const entry = formatPrice(alert.entryPrice);
    const stop = formatPrice(alert.stopLoss);
    const tp1 = formatPrice(alert.takeProfit1);
    const tp2 = formatPrice(alert.takeProfit2);
    const tp3 = formatPrice(alert.takeProfit3);
    
    if (alert.direction === 'COMPRA') {
        var r1 = ((alert.takeProfit1 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
        var r2 = ((alert.takeProfit2 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
        var r3 = ((alert.takeProfit3 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
    } else {
        var r1 = ((alert.entryPrice - alert.takeProfit1) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
        var r2 = ((alert.entryPrice - alert.takeProfit2) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
        var r3 = ((alert.entryPrice - alert.takeProfit3) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
    }
    
    return `<i>${alert.emoji} <b>${dirEmoji} Analisar ${direction} - ${symbolName}</b> ${alert.emoji}

 <b>Análise de dados</b>
 Preço: R$${entry}
 Volume: ${alert.volumeRatio.toFixed(2)}x (${volPct}%)
 RSI 1h: ${formatNumber(alert.rsi, 0)}
 #LSR: ${formatNumber(alert.lsr, 2)}
 Fund: ${fundingSign}${fundingPct}%
 Suporte: ${formatPrice(alert.support)}
 Resistência: ${formatPrice(alert.resistance)}
 #SCORE: ${alert.score} | Confiança: ${alert.confidence}%
 <b>Gerenciamento</b>
 <b>Alvos</b>
 TP1: ${tp1} 
 TP2: ${tp2} 
 TP3: ${tp3} 
🛑 Stop : ${stop} (${CONFIG.TRADE.PARTIAL_CLOSE[0]}% do capital)
 💡 <b>Dica</b>
• Entrada: ${alert.direction === '' ? '' : ''} à mercado DCA fracionado
• Stop: ${CONFIG.TRADE.PARTIAL_CLOSE[0]}% abaixo do ${alert.direction === 'COMPRA' ? 'suporte' : 'resistência'}
• TP1: Fechar ${CONFIG.TRADE.PARTIAL_CLOSE[0]}% (mover stop para entrada)
• TP2: Fechar ${CONFIG.TRADE.PARTIAL_CLOSE[1]}% (mover stop para TP1)
• TP3: Deixar ${CONFIG.TRADE.PARTIAL_CLOSE[2]}% correr com stop

 ${time.full}
🤖 Titanium by @J4Rviz</i>`;
}

// =====================================================================
// === FETCH SYMBOLS ===
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );
        
        // Filtrar apenas USDT e volume mínimo (opcional)
        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
            
        console.log(`📊 Encontrados ${symbols.length} símbolos USDT`);
        return symbols;
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT'];
    }
}

// =====================================================================
// === SCANNER EM TEMPO REAL MELHORADO ===
// =====================================================================
async function realTimeScanner() {
    console.log('\n🔍 Iniciando scanner em tempo real...');
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Monitorando ${symbols.length} símbolos continuamente`);
    
    let scanCount = 0;
    let alertsSent = 0;
    let consecutiveEmptyScans = 0;
    let lastAlertTime = Date.now();
    
    while (true) {
        const startTime = Date.now();
        scanCount++;
        
        console.log(`\n📡 Scan #${scanCount} - ${getBrazilianDateTime().full}`);
        
        const batchSize = CONFIG.PERFORMANCE.BATCH_SIZE;
        const alerts = [];
        
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const batchPromises = batch.map(symbol => analyzeForAlerts(symbol));
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    alerts.push(result.value);
                }
            });
            
            if (i + batchSize < symbols.length) {
                await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SYMBOL_DELAY_MS));
            }
        }
        
        alerts.sort((a, b) => b.confidence - a.confidence);
        
        const topAlerts = alerts.slice(0, CONFIG.ALERTS.MAX_ALERTS_PER_SCAN);
        let successfulAlerts = 0;
        
        for (const alert of topAlerts) {
            const message = formatTradeAlert(alert);
            const sent = await sendTelegramAlert(message);
            
            if (sent) {
                registerAlert(alert.symbol, alert.entryPrice, alert.direction);
                alertsSent++;
                successfulAlerts++;
                console.log(`✅ Alerta enviado: ${alert.symbol} ${alert.direction} (${alert.confidence}%)`);
                lastAlertTime = Date.now();
            } else {
                console.log(`❌ Falha ao enviar alerta: ${alert.symbol}`);
            }
            
            await new Promise(r => setTimeout(r, 1500)); // Delay entre envios
        }
        
        if (topAlerts.length === 0) {
            console.log('📭 Nenhum alerta no momento');
            consecutiveEmptyScans++;
        } else {
            console.log(`📨 Alertas enviados com sucesso: ${successfulAlerts}/${topAlerts.length}`);
            consecutiveEmptyScans = 0;
        }
        
        const scanTime = Date.now() - startTime;
        console.log(`⏱️ Scan concluído em ${(scanTime/1000).toFixed(1)}s`);
        console.log(`📊 Total alertas enviados: ${alertsSent}`);
        
        // Se muitos scans sem alertas, aumentar intervalo gradualmente
        let nextScanInterval = CONFIG.PERFORMANCE.SCAN_INTERVAL_SECONDS * 1000;
        if (consecutiveEmptyScans > 5) {
            nextScanInterval = Math.min(nextScanInterval * 1.5, 300000); // Máx 5 minutos
            console.log(`⏳ ${consecutiveEmptyScans} scans sem alertas, aumentando intervalo...`);
        }
        
        const waitTime = nextScanInterval - scanTime;
        if (waitTime > 0) {
            console.log(`⏳ Próximo scan em ${(waitTime/1000).toFixed(0)}s`);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
async function startBot() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM ');
    console.log('='.repeat(70) + '\n');
    
    console.log('📅 Inicializando...');
    console.log(`📱 Telegram Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`📱 Telegram Chat ID: ${CONFIG.TELEGRAM.CHAT_ID ? '✅' : '❌'}`);
    console.log(`⏱️ Scan a cada: ${CONFIG.PERFORMANCE.SCAN_INTERVAL_SECONDS}s`);
    console.log(`🎯 Score mínimo: ${CONFIG.ALERTS.MIN_SCORE}`);
    console.log(`🛡️ Cooldown: ${CONFIG.PERFORMANCE.COOLDOWN_MINUTES}min`);
    console.log(`📊 Máx alertas/scan: ${CONFIG.ALERTS.MAX_ALERTS_PER_SCAN}`);
    console.log(`📊 Risco/Retorno alvo: 1:${CONFIG.TRADE.RISK_REWARD_RATIO}\n`);
    
    const initTime = getBrazilianDateTime();
    const initMessage = `<i> <b>TITANIUM </b> 📅 ${initTime.full}

📊 Monitorando em tempo real


✅ Sistema ativo!</i>`;
    
    const sent = await sendTelegramAlert(initMessage);
    if (sent) {
        console.log('✅ Bot inicializado! Mensagem de confirmação enviada.');
    } else {
        console.log('⚠️ Bot inicializado mas falha ao enviar mensagem de confirmação.');
    }
    
    console.log('\n🔍 Iniciando scanner em tempo real...\n');
    
    await realTimeScanner();
}

// =====================================================================
// === HANDLERS DE ERRO MELHORADOS ===
// =====================================================================
process.on('uncaughtException', async (err) => {
    console.error('\n❌ UNCAUGHT EXCEPTION:', err.message);
    console.error('Stack:', err.stack);
    
    const errorMessage = `<i>❌ <b>ERRO NO BOT</b>
${err.message}
Reiniciando em 60s...</i>`;
    
    await sendTelegramAlert(errorMessage);
    
    setTimeout(() => {
        console.log('🔄 Reiniciando bot...');
        process.exit(1);
    }, 60000);
});

process.on('unhandledRejection', async (reason) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
    
    if (reason.message && reason.message.includes('telegram')) {
        console.log('⚠️ Erro no Telegram ignorado, continuando execução...');
    }
});

// =====================================================================
// === START ===
// =====================================================================
console.log('🚀 Iniciando Titanium Real-Time Alert System (Versão Otimizada)...');
startBot().catch(async error => {
    console.error('❌ Erro fatal:', error);
    
    try {
        await sendTelegramAlert(`<i>❌ <b>ERRO FATAL</b>
${error.message}
Sistema parado.</i>`);
    } catch {}
    
    process.exit(1);
});
