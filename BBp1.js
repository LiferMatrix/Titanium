const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A',
        CHAT_ID: '-1001990889297'
    },
    BOLLINGER: {
        PERIOD: 20,
        STD_DEV: 2,
        TIMEFRAME: '1d'
    },
    SCAN: {
        BATCH_SIZE: 5,
        SYMBOL_DELAY_MS: 200,
        REQUEST_TIMEOUT: 10000,
        COOLDOWN_AFTER_BATCH_MS: 1000,
        MAX_REQUESTS_PER_MINUTE: 1200,
        CACHE_DURATION_SECONDS: 30
    },
    // === CONFIGURAÇÕES ANTI-POLUIÇÃO ===
    ALERTS: {
        // Cooldown base para mesma moeda/mesmo lado (minutos)
        COOLDOWN_MINUTES: 15,
        
        // Permitir alertas de direção oposta sem cooldown
        ALLOW_OPPOSITE_DIRECTION: true,
        
        // Cooldown adaptativo baseado no score (horas) - para cooldown longo
        COOLDOWN_BY_SCORE: {
           3: 1.5,    // Score 3: espera 1.5h
           4: 2,      // Score 4: espera 2h
           5: 3,      // Score 5: espera 3h
           6: 4,      // Score 6: espera 4h
           7: 6,      // Score 7: espera 6h
           8: 8       // Score 8+: espera 8h
        },
        
        // Limites diários por categoria
        DAILY_LIMITS: {
            TOP_10: 25,      // BTC, ETH: máximo 15 alertas/dia
            TOP_50: 40,      // Altcoins principais: 25/dia
            OTHER: 55,       // Outras: 35/dia
            LOW_VOLUME: 50   // Baixo volume: só 10/dia
        },
        
        // Filtros de volume
        MIN_VOLUME_USDT: 50000,      // Volume mínimo por hora em USDT
        MIN_VOLUME_RATIO: 1.3,        // Volume atual > 1.3x média
        MIN_24H_VOLUME_USDT: 100000,  // Volume 24h mínimo
        
        // Força da tendência mínima
        MIN_TREND_STRENGTH: 3,        // 0-100, quanto maior mais forte
        
        // Variação mínima de preço
        PRICE_DEVIATION: 0.4,          // Precisa variar 0.4% desde último alerta
        
        // RSI thresholds para COMPRA e VENDA
        RSI: {
            BUY_MAX: 64,      // RSI máximo para alerta de COMPRA
            SELL_MIN: 66      // RSI mínimo para alerta de VENDA
        },
        
        // Prioridades (scores mínimos)
        PRIORITY_LEVELS: {
            CRITICAL: 7,    // Score 7+: alerta imediato
            HIGH: 5,        // Score 5-6: alerta rápido
            MEDIUM: 4,      // Score 4: alerta normal
            LOW: 3          // Score 3: alerta opcional
        },
        
        // Agrupamento inteligente
        GROUP_SIMILAR: true,
        GROUP_WINDOW_MINUTES: 10,      // Janela de 10 min para agrupar
        MAX_GROUP_SIZE: 3,              // Máx 3 alertas por grupo
        SIMILAR_PRICE_DIFF: 1.0,        // Diferença de preço < 1% para agrupar
        
        // Filtros adicionais
        MIN_SCORE_TO_ALERT: 3,          // Score mínimo para alertar
        MAX_ALERTS_PER_SCAN: 50,        // Máximo alertas por scan
        IGNORE_LOW_VOLUME_SYMBOLS: true, // Ignorar símbolos de baixo volume
        
        // Telegram
        TELEGRAM_DELAY_MS: 2000         // Delay entre mensagens
    },
    VOLUME: {
        EMA_PERIOD: 9
    },
    RSI: {
        PERIOD: 14
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '1h', '2h', '4h'],
        LOOKBACK_PERIODS: 10,
        SCORE_MULTIPLIER: {
            '15m': 0.5,
            '1h': 1.0,
            '2h': 1.5,
            '4h': 2.0
        }
    },
    STOCHASTIC: {
        DAILY: {
            K_PERIOD: 5,
            K_SMOOTH: 3,
            D_PERIOD: 3
        },
        FOUR_HOUR: {
            K_PERIOD: 14,
            K_SMOOTH: 3,
            D_PERIOD: 3
        }
    },
    REVERSAL: {
        MIN_CONFIRMATION_SCORE: 3,
        VOLUME_THRESHOLD: 1.1,
        STOCH_OVERSOLD: 25,
        STOCH_OVERBOUGHT: 75
    },
    LSR_PENALTY: {
        BUY_MAX_RATIO: 3.5,
        SELL_MIN_RATIO: 1.0,
        PENALTY_POINTS: -2
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === CACHE INTELIGENTE ===
// =====================================================================
class SmartCache {
    constructor() {
        this.cache = new Map();
        this.requestTimestamps = [];
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() - item.timestamp > CONFIG.SCAN.CACHE_DURATION_SECONDS * 1000) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    set(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    canMakeRequest() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
        
        return this.requestTimestamps.length < CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE;
    }

    addRequest() {
        this.requestTimestamps.push(Date.now());
    }

    getWaitTime() {
        if (this.requestTimestamps.length === 0) return 0;
        
        const now = Date.now();
        const oldestRequest = this.requestTimestamps[0];
        const requestsLastMinute = this.requestTimestamps.length;
        
        if (requestsLastMinute < CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE) return 0;
        
        const timeUntilExpiry = 60000 - (now - oldestRequest);
        return Math.max(0, timeUntilExpiry);
    }
}

const cache = new SmartCache();

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(3);
    if (price > 0.1) return price.toFixed(4);
    if (price > 0.01) return price.toFixed(5);
    if (price > 0.001) return price.toFixed(6);
    return price.toFixed(8);
}

// Caches
const alertCache = new Map(); // Guarda timestamp do último alerta por símbolo/direção
const dailyCounter = new Map();
const symbolMetadata = new Map(); // Cache para metadados dos símbolos

// Filas
const telegramQueue = [];
const priorityQueue = {
    critical: [],
    high: [],
    medium: [],
    low: []
};
let isSendingTelegram = false;
let alertsSentThisScan = 0;

// =====================================================================
// === RATE LIMITER INTELIGENTE ===
// =====================================================================
class IntelligentRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.consecutiveErrors = 0;
        this.errorBackoff = 1000;
        this.maxBackoff = 60000;
        this.requestCount = 0;
        this.minuteStart = Date.now();
    }

    async wait() {
        const now = Date.now();
        if (now - this.minuteStart > 60000) {
            this.requestCount = 0;
            this.minuteStart = now;
        }

        if (this.requestCount >= CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE) {
            const waitTime = 60000 - (now - this.minuteStart);
            console.log(`⏳ Rate limit por minuto atingido, aguardando ${Math.ceil(waitTime / 1000)}s...`);
            await new Promise(r => setTimeout(r, waitTime));
            this.requestCount = 0;
            this.minuteStart = Date.now();
        }

        const timeSinceLast = now - this.lastRequestTime;
        const baseDelay = CONFIG.SCAN.SYMBOL_DELAY_MS;
        const adaptiveDelay = baseDelay + (this.consecutiveErrors * 100);
        
        if (timeSinceLast < adaptiveDelay) {
            await new Promise(r => setTimeout(r, adaptiveDelay - timeSinceLast));
        }
        
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    async makeRequest(url, cacheKey = null) {
        if (cacheKey) {
            const cached = cache.get(cacheKey);
            if (cached) return cached;
        }

        if (!cache.canMakeRequest()) {
            const waitTime = cache.getWaitTime();
            console.log(`⏳ Aguardando ${Math.ceil(waitTime / 1000)}s para respeitar rate limit...`);
            await new Promise(r => setTimeout(r, waitTime));
        }

        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                await this.wait();
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN.REQUEST_TIMEOUT);
                
                cache.addRequest();
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (response.status === 429) {
                    this.consecutiveErrors++;
                    const backoffTime = Math.min(this.errorBackoff * Math.pow(2, attempts), this.maxBackoff);
                    console.log(`⚠️ Rate limit 429, aguardando ${backoffTime / 1000}s...`);
                    await new Promise(r => setTimeout(r, backoffTime));
                    attempts++;
                    continue;
                }
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const data = await response.json();
                
                this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 1);
                
                if (cacheKey) {
                    cache.set(cacheKey, data);
                }
                
                return data;
                
            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log(`⏰ Timeout na requisição`);
                } else {
                    console.log(`⚠️ Erro na requisição: ${error.message}`);
                }
                
                this.consecutiveErrors++;
                attempts++;
                
                if (attempts < maxAttempts) {
                    const backoffTime = Math.min(this.errorBackoff * Math.pow(2, attempts), this.maxBackoff);
                    await new Promise(r => setTimeout(r, backoffTime));
                }
            }
        }
        
        throw new Error(`Falha após ${maxAttempts} tentativas`);
    }
}

const rateLimiter = new IntelligentRateLimiter();

// =====================================================================
// === FUNÇÕES DE CLASSIFICAÇÃO DE SÍMBOLOS ===
// =====================================================================
function getSymbolCategory(symbol) {
    const top10 = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
                   'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    
    const top50 = ['MATICUSDT', 'NEARUSDT', 'ATOMUSDT', 'LTCUSDT', 'BCHUSDT',
                   'ALGOUSDT', 'VETUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT',
                   'UNIUSDT', 'ICPUSDT', 'FTMUSDT', 'ETCUSDT', 'XLMUSDT',
                   'EGLDUSDT', 'EOSUSDT', 'THETAUSDT', 'AXSUSDT', 'AAVEUSDT',
                   'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'APEUSDT', 'CHZUSDT'];
    
    if (top10.includes(symbol)) return 'TOP_10';
    if (top50.includes(symbol)) return 'TOP_50';
    return 'OTHER';
}

function getCooldownByScore(score) {
    if (score >= 8) return CONFIG.ALERTS.COOLDOWN_BY_SCORE[8];
    if (score >= 7) return CONFIG.ALERTS.COOLDOWN_BY_SCORE[7];
    if (score >= 6) return CONFIG.ALERTS.COOLDOWN_BY_SCORE[6];
    if (score >= 5) return CONFIG.ALERTS.COOLDOWN_BY_SCORE[5];
    if (score >= 4) return CONFIG.ALERTS.COOLDOWN_BY_SCORE[4];
    return CONFIG.ALERTS.COOLDOWN_BY_SCORE[3];
}

function getDailyLimit(symbol) {
    const category = getSymbolCategory(symbol);
    return CONFIG.ALERTS.DAILY_LIMITS[category];
}

function getPriorityLevel(score) {
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.CRITICAL) return 'critical';
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.HIGH) return 'high';
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.MEDIUM) return 'medium';
    return 'low';
}

// =====================================================================
// === FUNÇÕES DE ANÁLISE TÉCNICA ===
// =====================================================================
function calculateSMA(values, period) {
    if (!values || values.length < period) return 0;
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(values, period) {
    if (!values || values.length === 0) return 0;
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

function calculateRMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    let rma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const alpha = 1 / period;
    
    for (let i = period; i < values.length; i++) {
        rma = alpha * values[i] + (1 - alpha) * rma;
    }
    return rma;
}

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) {
        return 50;
    }
    
    const changes = [];
    for (let i = 1; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i-1].close);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    const avgGain = calculateRMA(gains, period);
    const avgLoss = calculateRMA(losses, period);
    
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.min(100, Math.max(0, Math.round(rsi * 100) / 100));
}

function calculateStochastic(candles, kPeriod, kSmooth, dPeriod) {
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) {
        return { k: 50, d: 50 };
    }
    
    const kRaw = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const highestHigh = Math.max(...periodCandles.map(c => c.high));
        const lowestLow = Math.min(...periodCandles.map(c => c.low));
        const currentClose = candles[i].close;
        
        if (highestHigh - lowestLow === 0) {
            kRaw.push(50);
        } else {
            const kValue = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
            kRaw.push(Math.min(100, Math.max(0, kValue)));
        }
    }
    
    const kSmoothValues = [];
    for (let i = kSmooth - 1; i < kRaw.length; i++) {
        const smoothSum = kRaw.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kSmoothValues.push(smoothSum / kSmooth);
    }
    
    const dValues = [];
    for (let i = dPeriod - 1; i < kSmoothValues.length; i++) {
        const dSum = kSmoothValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
        dValues.push(dSum / dPeriod);
    }
    
    const currentK = kSmoothValues.length > 0 ? kSmoothValues[kSmoothValues.length - 1] : 50;
    const currentD = dValues.length > 0 ? dValues[dValues.length - 1] : 50;
    
    return {
        k: Math.min(100, Math.max(0, Math.round(currentK * 100) / 100)),
        d: Math.min(100, Math.max(0, Math.round(currentD * 100) / 100))
    };
}

function formatStochastic(stoch, type) {
    const k = stoch.k;
    const d = stoch.d;
    
    let emoji = '🟡';
    
    if (k < 20 && d < 25) {
        emoji = '🟢';
    } else if (k > 80 && d > 75) {
        emoji = '🔴';
    }
    
    if (k > d) {
        return `K${Math.round(k)}⤴️D${Math.round(d)} ${emoji}`;
    } else {
        return `K${Math.round(k)}⤵️D${Math.round(d)} ${emoji}`;
    }
}

function analyzeVolumeWithEMA(candles) {
    if (!candles || candles.length < CONFIG.VOLUME.EMA_PERIOD + 1) {
        return { 
            text: '⚪Neutro', 
            emoji: '⚪',
            percentage: 50,
            direction: 'Neutro',
            ratio: 1
        };
    }
    
    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, CONFIG.VOLUME.EMA_PERIOD);
    
    let bullishVolume = 0;
    let bearishVolume = 0;
    let totalVolume = 0;
    
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const volume = candle.volume;
        const close = candle.close;
        
        totalVolume += volume;
        
        if (close > ema9) {
            bullishVolume += volume;
        } 
        else if (close < ema9) {
            bearishVolume += volume;
        } 
        else {
            bullishVolume += volume / 2;
            bearishVolume += volume / 2;
        }
    }
    
    const buyerPercentage = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    
    let direction = 'Neutro';
    let emoji = '⚪';
    let text = '';
    
    if (buyerPercentage > 52) {
        direction = 'Comprador';
        emoji = '🟢';
        text = `${emoji}Comprador`;
    } else if (buyerPercentage < 48) {
        direction = 'Vendedor';
        emoji = '🔴';
        text = `${emoji}Vendedor`;
    } else {
        text = '⚪Neutro';
    }
    
    return {
        text: text,
        emoji: emoji,
        percentage: buyerPercentage,
        sellerPercentage: 100 - buyerPercentage,
        direction: direction,
        emaValue: ema9
    };
}

function calculateBollingerBands(candles, period = 20, stdDev = 2) {
    if (!candles || candles.length < period) {
        return null;
    }
    
    const closes = candles.map(c => c.close);
    const recentCloses = closes.slice(-period);
    
    const sma = recentCloses.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentCloses.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const stdDeviation = Math.sqrt(variance);
    
    const upperBand = sma + (stdDev * stdDeviation);
    const lowerBand = sma - (stdDev * stdDeviation);
    
    return {
        upper: upperBand,
        middle: sma,
        lower: lowerBand,
        currentPrice: closes[closes.length - 1]
    };
}

function checkTrendStrength(candles) {
    if (!candles || candles.length < 20) return 0;
    
    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    
    // Calcular desvio da média nos últimos 10 candles
    const recentCandles = candles.slice(-10);
    const deviations = recentCandles.map(c => Math.abs(c.close - ema20) / ema20 * 100);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    
    // Quanto maior o desvio, mais forte a tendência
    return avgDeviation;
}

function isTrueReversal(candles, bb, touchedLower, touchedUpper) {
    if (!candles || candles.length < 5) return { isReversal: false, score: 0, details: {} };
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prevPrevCandle = candles[candles.length - 3];
    const currentPrice = lastCandle.close;
    
    const details = {};
    let score = 0;
    
    if (touchedLower) {
        const isBullishCandle = lastCandle.close > lastCandle.open;
        details.isBullishCandle = isBullishCandle;
        if (isBullishCandle) score++;
        
        const closedAboveLower = currentPrice > bb.lower * 1.005;
        details.closedAboveLower = closedAboveLower;
        if (closedAboveLower) score++;
        
        const lowerShadow = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongLowerShadow = bodySize > 0 ? lowerShadow > bodySize * 0.5 : lowerShadow > 0;
        details.hasLongLowerShadow = hasLongLowerShadow;
        if (hasLongLowerShadow) score++;
        
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) score++;
        
        const priceStabilized = lastCandle.close > prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) score++;
        
        const lowestIn3 = Math.min(prevPrevCandle.low, prevCandle.low, lastCandle.low) === lastCandle.low;
        details.lowestIn3 = lowestIn3;
        if (lowestIn3) score++;
    }
    
    if (touchedUpper) {
        const isBearishCandle = lastCandle.close < lastCandle.open;
        details.isBearishCandle = isBearishCandle;
        if (isBearishCandle) score++;
        
        const closedBelowUpper = currentPrice < bb.upper * 0.995;
        details.closedBelowUpper = closedBelowUpper;
        if (closedBelowUpper) score++;
        
        const upperShadow = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongUpperShadow = bodySize > 0 ? upperShadow > bodySize * 0.5 : upperShadow > 0;
        details.hasLongUpperShadow = hasLongUpperShadow;
        if (hasLongUpperShadow) score++;
        
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) score++;
        
        const priceStabilized = lastCandle.close < prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) score++;
        
        const highestIn3 = Math.max(prevPrevCandle.high, prevCandle.high, lastCandle.high) === lastCandle.high;
        details.highestIn3 = highestIn3;
        if (highestIn3) score++;
    }
    
    return {
        isReversal: score >= CONFIG.REVERSAL.MIN_CONFIRMATION_SCORE,
        score: score,
        details: details
    };
}

function checkRSIDivergenceMultiTimeframe(candlesByTimeframe) {
    const divergences = [];
    let totalScore = 0;
    
    for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
        const candles = candlesByTimeframe[tf];
        if (!candles || candles.length < 20) continue;
        
        const rsiValues = [];
        for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
            rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
        }
        
        if (rsiValues.length < CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS) continue;
        
        const prices = candles.map(c => c.close);
        const recentPrices = prices.slice(-CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS);
        const recentRSI = rsiValues.slice(-CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS);
        
        const priceLows = [];
        const rsiLows = [];
        const priceHighs = [];
        const rsiHighs = [];
        
        for (let i = 2; i < recentPrices.length - 2; i++) {
            if (recentPrices[i] < recentPrices[i-1] && recentPrices[i] < recentPrices[i+1]) {
                priceLows.push({ index: i, value: recentPrices[i] });
            }
            if (recentRSI[i] < recentRSI[i-1] && recentRSI[i] < recentRSI[i+1]) {
                rsiLows.push({ index: i, value: recentRSI[i] });
            }
            
            if (recentPrices[i] > recentPrices[i-1] && recentPrices[i] > recentPrices[i+1]) {
                priceHighs.push({ index: i, value: recentPrices[i] });
            }
            if (recentRSI[i] > recentRSI[i-1] && recentRSI[i] > recentRSI[i+1]) {
                rsiHighs.push({ index: i, value: recentRSI[i] });
            }
        }
        
        let bullishDivergence = false;
        if (priceLows.length >= 2 && rsiLows.length >= 2) {
            const lastPriceLow = priceLows[priceLows.length - 1];
            const prevPriceLow = priceLows[priceLows.length - 2];
            const lastRSILow = rsiLows[rsiLows.length - 1];
            const prevRSILow = rsiLows[rsiLows.length - 2];
            
            if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
                bullishDivergence = true;
            }
        }
        
        let bearishDivergence = false;
        if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
            const lastPriceHigh = priceHighs[priceHighs.length - 1];
            const prevPriceHigh = priceHighs[priceHighs.length - 2];
            const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
            const prevRSIHigh = rsiHighs[rsiHighs.length - 2];
            
            if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
                bearishDivergence = true;
            }
        }
        
        const multiplier = CONFIG.RSI_DIVERGENCE.SCORE_MULTIPLIER[tf] || 1;
        
        if (bullishDivergence) {
            const score = 2 * multiplier;
            totalScore += score;
            divergences.push({
                timeframe: tf,
                type: 'bullish',
                score: score,
                emoji: '📈'
            });
        } else if (bearishDivergence) {
            const score = 2 * multiplier;
            totalScore += score;
            divergences.push({
                timeframe: tf,
                type: 'bearish',
                score: score,
                emoji: '📉'
            });
        }
    }
    
    return {
        hasDivergence: divergences.length > 0,
        divergences: divergences,
        totalScore: totalScore
    };
}

function checkStochasticReversal(stochK, stochD, isGreenAlert) {
    if (isGreenAlert) {
        return stochK < CONFIG.REVERSAL.STOCH_OVERSOLD + 10 && stochK > stochD;
    } else {
        return stochK > CONFIG.REVERSAL.STOCH_OVERBOUGHT - 10 && stochK < stochD;
    }
}

function checkLSRPenalty(lsr, isGreenAlert) {
    if (!lsr) return { hasPenalty: false, points: 0, message: '' };
    
    if (isGreenAlert && lsr > CONFIG.LSR_PENALTY.BUY_MAX_RATIO) {
        return {
            hasPenalty: true,
            points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
            message: `⚠️ LSR alto (${lsr.toFixed(2)}) - Muitos comprados (-2)`
        };
    }
    
    if (!isGreenAlert && lsr < CONFIG.LSR_PENALTY.SELL_MIN_RATIO) {
        return {
            hasPenalty: true,
            points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
            message: `⚠️ LSR baixo (${lsr.toFixed(2)}) - Muitos vendidos (-2)`
        };
    }
    
    return { hasPenalty: false, points: 0, message: '' };
}

// =====================================================================
// === BUSCAR CANDLES COM CACHE ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const cacheKey = `candles_${symbol}_${interval}_${limit}`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        const data = await rateLimiter.makeRequest(url, cacheKey);
        
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
// === DADOS ADICIONAIS ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice, isGreenAlert) {
    try {
        const [candles1h, candles3m, candlesDaily, candles4h, candlesWeekly, candles15m, candles2h] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '3m', 100),
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100),
            getCandles(symbol, '1w', 50),
            getCandles(symbol, '15m', 100),
            getCandles(symbol, '2h', 100)
        ]);
        
        const bbDaily = calculateBollingerBands(candlesDaily, 20, 2);
        const bb4h = calculateBollingerBands(candles4h, 20, 2);
        
        let bbWeekly = null;
        if (candlesWeekly.length >= 20) {
            bbWeekly = calculateBollingerBands(candlesWeekly, 20, 2);
        } else if (candlesWeekly.length >= 10) {
            bbWeekly = calculateBollingerBands(candlesWeekly, candlesWeekly.length, 2);
        }
        
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        
        const rsi = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        
        const stochDaily = calculateStochastic(
            candlesDaily, 
            CONFIG.STOCHASTIC.DAILY.K_PERIOD,
            CONFIG.STOCHASTIC.DAILY.K_SMOOTH,
            CONFIG.STOCHASTIC.DAILY.D_PERIOD
        );
        
        const stoch4h = calculateStochastic(
            candles4h, 
            CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD,
            CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH,
            CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD
        );
        
        const stoch1dFormatted = formatStochastic(stochDaily, 'daily');
        const stoch4hFormatted = formatStochastic(stoch4h, '4h');
        
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        
        // Volume em USDT
        const volumeUSDT1h = currentVolume1h * currentPrice;
        
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1] || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
        // Volume 24h total em USDT
        const volume24hUSDT = volumes1h.slice(-24).reduce((sum, vol) => sum + (vol * currentPrice), 0);
        
        let lsr = null;
        try {
            const lsrData = await rateLimiter.makeRequest(
                `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`,
                `lsr_${symbol}`
            );
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(
                `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
                `funding_${symbol}`
            );
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        const volume24hText = volume1h.text;
        
        // Força da tendência
        const trendStrength = checkTrendStrength(candles1h);
        
        return {
            rsi,
            stoch1d: stoch1dFormatted,
            stoch4h: stoch4hFormatted,
            stochDailyValues: stochDaily,
            stoch4hValues: stoch4h,
            volume1h: {
                ratio: volumeRatio1h,
                percentage: volume1h.percentage,
                text: volume1h.text,
                ratioFormatted: volumeRatio1h.toFixed(2),
                usdt: volumeUSDT1h
            },
            volume3m: {
                ratio: volumeRatio3m,
                percentage: volume3m.percentage,
                text: volume3m.text,
                ratioFormatted: volumeRatio3m.toFixed(2)
            },
            volume24h: {
                pct: volume24hPct,
                text: volume24hText,
                usdt: volume24hUSDT
            },
            bbDaily: bbDaily ? {
                upper: bbDaily.upper,
                lower: bbDaily.lower
            } : {
                upper: currentPrice * 1.2,
                lower: currentPrice * 0.8
            },
            bb4h: bb4h ? {
                upper: bb4h.upper,
                lower: bb4h.lower
            } : {
                upper: currentPrice * 1.15,
                lower: currentPrice * 0.85
            },
            bbWeekly: bbWeekly ? {
                upper: bbWeekly.upper,
                lower: bbWeekly.lower
            } : {
                upper: currentPrice * 1.3,
                lower: currentPrice * 0.7
            },
            trendStrength,
            lsr,
            funding,
            candlesByTimeframe: {
                '15m': candles15m.slice(-30),
                '1h': candles1h.slice(-30),
                '2h': candles2h.slice(-30),
                '4h': candles4h.slice(-30)
            }
        };
    } catch (error) {
        console.log(`⚠️ Erro em getAdditionalData para ${symbol}:`, error.message);
        return {
            rsi: 50,
            stoch1d: 'K50⤵️D55 🟡',
            stoch4h: 'K50⤵️D55 🟡',
            stochDailyValues: { k: 50, d: 55 },
            stoch4hValues: { k: 50, d: 55 },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00', usdt: 0 },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro', usdt: 0 },
            trendStrength: 0,
            bbDaily: { upper: currentPrice * 1.2, lower: currentPrice * 0.8 },
            bb4h: { upper: currentPrice * 1.15, lower: currentPrice * 0.85 },
            bbWeekly: { upper: currentPrice * 1.3, lower: currentPrice * 0.7 },
            lsr: null,
            funding: null,
            candlesByTimeframe: {
                '15m': [],
                '1h': [],
                '2h': [],
                '4h': []
            }
        };
    }
}

// =====================================================================
// === VERIFICAR SE PODE ENVIAR ALERTA (VERSÃO INTELIGENTE) ===
// =====================================================================
function canSendAlert(symbol, direction, price, score, volumeRatio, volumeUSDT, volume24hUSDT, trendStrength, rsi) {
    const now = Date.now();
    const key = `${symbol}_${direction}`;
    const oppositeKey = `${symbol}_${direction === 'COMPRA' ? 'VENDA' : 'COMPRA'}`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    // 1. VERIFICAÇÃO DO RSI
    if (direction === 'COMPRA' && rsi > CONFIG.ALERTS.RSI.BUY_MAX) {
        console.log(`⏭️ ${symbol} - RSI muito alto para COMPRA: ${rsi} > ${CONFIG.ALERTS.RSI.BUY_MAX}`);
        return false;
    }
    
    if (direction === 'VENDA' && rsi < CONFIG.ALERTS.RSI.SELL_MIN) {
        console.log(`⏭️ ${symbol} - RSI muito baixo para VENDA: ${rsi} < ${CONFIG.ALERTS.RSI.SELL_MIN}`);
        return false;
    }
    
    // 2. SCORE MÍNIMO
    if (score < CONFIG.ALERTS.MIN_SCORE_TO_ALERT) {
        console.log(`⏭️ ${symbol} - Score baixo (${score})`);
        return false;
    }
    
    // 3. COOLDOWN DE 15 MINUTOS PARA MESMA DIREÇÃO
    const lastAlert = alertCache.get(key);
    if (lastAlert) {
        const minutesDiff = (now - lastAlert) / (1000 * 60);
        if (minutesDiff < CONFIG.ALERTS.COOLDOWN_MINUTES) {
            console.log(`⏳ Cooldown ${symbol} ${direction}: ${minutesDiff.toFixed(1)}min < ${CONFIG.ALERTS.COOLDOWN_MINUTES}min necessários`);
            return false;
        }
    }
    
    // 4. VERIFICAR DIREÇÃO OPOSTA - PODE ALERTAR SEM COOLDOWN
    if (CONFIG.ALERTS.ALLOW_OPPOSITE_DIRECTION) {
        const oppositeAlert = alertCache.get(oppositeKey);
        if (oppositeAlert) {
            const oppositeMinutesDiff = (now - oppositeAlert) / (1000 * 60);
            console.log(`🔄 Direção oposta para ${symbol} - permitido (último alerta oposto há ${oppositeMinutesDiff.toFixed(1)}min)`);
            // Permite o alerta, não bloqueia
        }
    }
    
    // 5. LIMITE DIÁRIO POR CATEGORIA
    const dailyLimit = getDailyLimit(symbol);
    const dailyCount = dailyCounter.get(dailyKey) || 0;
    if (dailyCount >= dailyLimit) {
        console.log(`📊 ${symbol} atingiu limite diário de ${dailyLimit}`);
        return false;
    }
    
    // 6. FILTRO DE VOLUME
    if (volumeRatio < CONFIG.ALERTS.MIN_VOLUME_RATIO) {
        console.log(`⏭️ ${symbol} - Volume ratio baixo (${volumeRatio.toFixed(2)}x)`);
        return false;
    }
    
    if (volumeUSDT < CONFIG.ALERTS.MIN_VOLUME_USDT) {
        console.log(`⏭️ ${symbol} - Volume USDT baixo ($${formatPrice(volumeUSDT)})`);
        return false;
    }
    
    if (volume24hUSDT < CONFIG.ALERTS.MIN_24H_VOLUME_USDT) {
        console.log(`⏭️ ${symbol} - Volume 24h baixo ($${formatPrice(volume24hUSDT)})`);
        return false;
    }
    
    // 7. FORÇA DA TENDÊNCIA
    if (trendStrength < CONFIG.ALERTS.MIN_TREND_STRENGTH) {
        console.log(`⏭️ ${symbol} - Tendência fraca (${trendStrength.toFixed(2)})`);
        return false;
    }
    
    // 8. VARIAÇÃO DE PREÇO
    const lastPrice = alertCache.get(priceKey);
    if (lastPrice) {
        const priceDiff = Math.abs((price - lastPrice) / lastPrice * 100);
        if (priceDiff < CONFIG.ALERTS.PRICE_DEVIATION) {
            console.log(`⏭️ ${symbol} - Variação de preço baixa (${priceDiff.toFixed(2)}%)`);
            return false;
        }
    }
    
    // 9. LIMITE POR SCAN
    if (alertsSentThisScan >= CONFIG.ALERTS.MAX_ALERTS_PER_SCAN) {
        console.log(`⏭️ Limite de alertas deste scan atingido (${CONFIG.ALERTS.MAX_ALERTS_PER_SCAN})`);
        return false;
    }
    
    return true;
}

function registerAlert(symbol, direction, price) {
    const now = Date.now();
    const key = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    alertCache.set(key, now);
    alertCache.set(priceKey, price);
    
    const dailyCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, dailyCount);
    alertsSentThisScan++;
    
    // Limpar cache antigo (48h)
    for (const [k, v] of alertCache) {
        if (now - v > 48 * 60 * 60 * 1000) {
            alertCache.delete(k);
        }
    }
    
    console.log(`📝 Registrado alerta ${symbol} ${direction} #${dailyCount} do dia`);
}

// =====================================================================
// === SISTEMA DE FILAS PRIORITÁRIAS ===
// =====================================================================
function queueAlert(alert) {
    const priority = getPriorityLevel(alert.confirmationScore);
    priorityQueue[priority].push(alert);
    
    console.log(`📥 Alerta ${alert.symbol} [${alert.timeframe}] adicionado à fila ${priority} (score ${alert.confirmationScore})`);
}

async function processPriorityQueue() {
    if (isSendingTelegram) return;
    
    isSendingTelegram = true;
    
    // Processar por prioridade
    const priorities = ['critical', 'high', 'medium', 'low'];
    
    for (const priority of priorities) {
        const alerts = priorityQueue[priority];
        if (alerts.length === 0) continue;
        
        console.log(`\n📤 Processando ${alerts.length} alertas ${priority}...`);
        
        // Se for low priority e tem muitos, agrupar
        if (priority === 'low' && alerts.length > 3) {
            await sendGroupedAlerts(alerts, priority);
        } else {
            for (const alert of alerts) {
                await sendSingleAlert(alert);
                await new Promise(r => setTimeout(r, CONFIG.ALERTS.TELEGRAM_DELAY_MS));
            }
        }
        
        priorityQueue[priority] = [];
    }
    
    isSendingTelegram = false;
}

async function sendSingleAlert(alert) {
    const message = formatAlert(alert);
    
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (!response.ok) {
            const errorData = await response.text();
            console.log(`❌ Erro Telegram: ${response.status}`);
        } else {
            registerAlert(alert.symbol, alert.direction, alert.price);
            const penaltyIcon = alert.lsrPenalty ? '⚠️' : '✅';
            console.log(`${penaltyIcon} 📨 ALERTA ENVIADO: ${alert.direction} ${alert.symbol} [${alert.timeframe}] - Score: ${alert.confirmationScore}`);
        }
        
        return true;
    } catch (error) {
        console.log('❌ Erro ao enviar Telegram:', error.message);
        return false;
    }
}

async function sendGroupedAlerts(alerts, priority) {
    if (alerts.length === 0) return;
    
    // Agrupar por direção
    const buyAlerts = alerts.filter(a => a.isGreenAlert);
    const sellAlerts = alerts.filter(a => !a.isGreenAlert);
    
    let message = `📊 **ALERTAS AGRUPADOS (${priority.toUpperCase()})**\n\n`;
    
    if (buyAlerts.length > 0) {
        message += `🟢 **COMPRA** (${buyAlerts.length})\n`;
        buyAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore}\n`;
        });
        if (buyAlerts.length > 5) message += `... e mais ${buyAlerts.length - 5}\n`;
        message += '\n';
    }
    
    if (sellAlerts.length > 0) {
        message += `🔴 **VENDA** (${sellAlerts.length})\n`;
        sellAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore}\n`;
        });
        if (sellAlerts.length > 5) message += `... e mais ${sellAlerts.length - 5}\n`;
    }
    
    message += `\n<i>Alerta Educativo, não é recomendação.</i>`;
    
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        console.log(`📦 Alerta agrupado enviado com ${alerts.length} sinais`);
    } catch (error) {
        console.log('❌ Erro ao enviar alerta agrupado:', error.message);
    }
}

// =====================================================================
// === ANALISAR SÍMBOLO ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const [candlesDaily, candles4h] = await Promise.all([
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100)
        ]);
        
        if (candlesDaily.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            await analyzeTimeframe(symbol, candlesDaily, '1d');
        }
        
        if (candles4h.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            await analyzeTimeframe(symbol, candles4h, '4h');
        }
        
    } catch (error) {
        // Ignorar erros
    }
}

async function analyzeTimeframe(symbol, candles, timeframe) {
    try {
        const bb = calculateBollingerBands(candles, CONFIG.BOLLINGER.PERIOD, CONFIG.BOLLINGER.STD_DEV);
        if (!bb) return null;
        
        const currentPrice = bb.currentPrice;
        const lastCandle = candles[candles.length - 1];
        
        const touchedLower = lastCandle.low <= bb.lower * 1.003;
        const touchedUpper = lastCandle.high >= bb.upper * 0.997;
        
        if (!touchedLower && !touchedUpper) return null;
        
        const reversalCheck = isTrueReversal(candles.slice(-10), bb, touchedLower, touchedUpper);
        
        if (!reversalCheck.isReversal) {
            console.log(`⏭️ ${symbol} [${timeframe}] - tocou na banda mas SEM reversão (score: ${reversalCheck.score}/6)`);
            return null;
        }
        
        const additional = await getAdditionalData(symbol, currentPrice, touchedLower);
        
        const divergenceMulti = checkRSIDivergenceMultiTimeframe(additional.candlesByTimeframe);
        
        const stochValues = timeframe === '1d' ? additional.stochDailyValues : additional.stoch4hValues;
        const stochReversal = checkStochasticReversal(stochValues.k, stochValues.d, touchedLower);
        
        const volumeConfirmation = timeframe === '1d' ? 
            additional.volume1h.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD : 
            additional.volume3m.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD - 0.2;
        
        const lsrPenalty = checkLSRPenalty(additional.lsr, touchedLower);
        
        let confirmationScore = reversalCheck.score;
        let confirmations = [];
        let penaltyApplied = false;
        
        if (reversalCheck.score >= 5) {
            confirmations.push('🔥 Reversão muito forte');
        } else if (reversalCheck.score >= 4) {
            confirmations.push('✅ Reversão forte');
        } else if (reversalCheck.score >= 3) {
            confirmations.push('✓ Reversão moderada');
        }
        
        if (divergenceMulti.hasDivergence) {
            confirmationScore += divergenceMulti.totalScore;
            
            const divergenceLines = divergenceMulti.divergences.map(d => 
                `${d.emoji} ${d.timeframe} ${d.type === 'bullish' ? 'Alta' : 'Baixa'} (+${d.score})`
            ).join(' • ');
            
            confirmations.push(` Divergências: ${divergenceLines}`);
        }
        
        if (stochReversal) {
            confirmationScore += 1;
            confirmations.push(' Estocástico confirmando');
        }
        
        if (volumeConfirmation) {
            confirmationScore += 1;
            confirmations.push('🔥 Volume forte');
        }
        
        if (lsrPenalty.hasPenalty) {
            confirmationScore += lsrPenalty.points;
            confirmations.push(lsrPenalty.message);
            penaltyApplied = true;
        }
        
        // Determinar direção do alerta
        const direction = touchedLower ? 'COMPRA' : 'VENDA';
        
        // VERIFICAÇÕES ANTI-POLUIÇÃO
        if (!canSendAlert(
            symbol, 
            direction,
            currentPrice, 
            confirmationScore,
            additional.volume1h.ratio,
            additional.volume1h.usdt,
            additional.volume24h.usdt,
            additional.trendStrength,
            additional.rsi  // Passar RSI para validação
        )) {
            return null;
        }
        
        const support = touchedLower ? bb.lower * 0.98 : bb.lower;
        const resistance = touchedUpper ? bb.upper * 1.02 : bb.upper;
        
        const atrMultiplier = timeframe === '1d' ? 1 : 0.5;
        const atr = (bb.upper - bb.lower) * 0.1 * atrMultiplier;
        
        let stopLoss, tp1, tp2, tp3;
        
        if (touchedLower) {
            stopLoss = currentPrice - atr * 1.5;
            tp1 = currentPrice + atr * 2;
            tp2 = currentPrice + atr * 3;
            tp3 = currentPrice + atr * 4;
        } else {
            stopLoss = currentPrice + atr * 1.5;
            tp1 = currentPrice - atr * 2;
            tp2 = currentPrice - atr * 3;
            tp3 = currentPrice - atr * 4;
        }
        
        const dailyCount = dailyCounter.get(`${symbol}_daily`) || 0;
        
        console.log(`🎯 ${symbol} [${timeframe}] - ${direction} CONFIRMADA! Score: ${confirmationScore} | RSI: ${additional.rsi} | ${confirmations.join(' | ')}`);
        
        const alert = {
            symbol,
            timeframe,
            timeframeEmoji: timeframe === '1d' ? '' : '',
            timeframeText: timeframe === '1d' ? 'DIÁRIO' : '4 HORAS',
            direction: touchedLower ? '🟢🔍 Analisar COMPRA' : '🔴🔍 Analisar CORREÇÃO',
            price: currentPrice,
            bbLower: bb.lower,
            bbUpper: bb.upper,
            support,
            resistance,
            stopLoss,
            tp1,
            tp2,
            tp3,
            dailyCount: dailyCount + 1,
            isGreenAlert: touchedLower,
            confirmationScore,
            confirmations: confirmations.join(' • '),
            reversalScore: reversalCheck.score,
            reversalDetails: reversalCheck.details,
            divergences: divergenceMulti.divergences,
            lsrPenalty: penaltyApplied,
            lsrValue: additional.lsr,
            ...additional
        };
        
        // Adicionar à fila prioritária
        queueAlert(alert);
        
        return alert;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FORMATAR MENSAGEM ===
// =====================================================================
function formatAlert(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    
    const fundingPct = data.funding ? (data.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = data.funding && data.funding > 0 ? '+' : '';
    
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '⚪';
    
    const tp1 = formatPrice(data.tp1);
    const tp2 = formatPrice(data.tp2);
    const tp3 = formatPrice(data.tp3);
    const stop = formatPrice(data.stopLoss);
    
    const lsr = data.lsrValue ? data.lsrValue.toFixed(2) : 'N/A';
    
    const volume1hLine = `#Vol 1h: ${data.volume1h.ratioFormatted}x (${data.volume1h.percentage.toFixed(0)}%) ${data.volume1h.text}`;
    const volume3mLine = `#Vol 3m: ${data.volume3m.ratioFormatted}x (${data.volume3m.percentage.toFixed(0)}%) ${data.volume3m.text}`;
    
    let bbLines = '';
    if (data.isGreenAlert) {
        const bbDailyUpper = formatPrice(data.bbDaily.upper);
        const bb4hUpper = formatPrice(data.bb4h.upper);
        const bbWeeklyUpper = formatPrice(data.bbWeekly.upper);
        bbLines = ` Superior Diário : $${bbDailyUpper}\n Superior 4H    : $${bb4hUpper}\n Superior Semanal: $${bbWeeklyUpper}`;
    } else {
        const bbDailyLower = formatPrice(data.bbDaily.lower);
        const bb4hLower = formatPrice(data.bb4h.lower);
        const bbWeeklyLower = formatPrice(data.bbWeekly.lower);
        bbLines = ` Inferior Diário : $${bbDailyLower}\n Inferior 4H    : $${bb4hLower}\n Inferior Semanal: $${bbWeeklyLower}`;
    }
    
    let divergenceLines = '';
    if (data.divergences && data.divergences.length > 0) {
        const divergenceTexts = data.divergences.map(d => {
            const type = d.type === 'bullish' ? '📈 Alta' : '📉 Baixa';
            return `${d.timeframe} ${type}`;
        });
        divergenceLines = `\n  Divergências: ${divergenceTexts.join(' • ')}`;
    }
    
    const confirmationsLine = `🔍 Confirmações: ${data.confirmationScore} | ${data.confirmations}`;
    const reversalScoreLine = ` Score Reversão: ${data.reversalScore}/6`;
    
    const lsrWarning = data.lsrPenalty ? `\n ⚠️ LSR ${data.lsrValue.toFixed(2)} - Penalidade aplicada` : '';
    
    return `${data.direction} - ${symbolName} ${data.timeframeEmoji} ${data.timeframeText}
 <i>Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 ${confirmationsLine}
 ${reversalScoreLine}${divergenceLines}${lsrWarning}
 ▫️Vol 24hs: ${data.volume24h.pct} ${data.volume24h.text}
 #RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} 
 ${volume3mLine}
 ${volume1hLine}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${formatPrice(data.resistance)} | ${formatPrice(data.bbUpper)}
 🔹Supt: ${formatPrice(data.support)} | ${formatPrice(data.bbLower)}
${bbLines}
 Alvos: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop: ${stop}</i>
❅────────────❅
 🤖 IA Dica... <i>${data.isGreenAlert ? 'Observar Zonas de 🔹Suporte de Compra' : 'Realizar Lucro ou Parcial perto da 🔻Resistência.'}</i>
<i>Alerta Educativo, não é recomendação de investimento.</i>
 Titanium Prime by @J4Rviz`;
}

// =====================================================================
// === BUSCAR SÍMBOLOS ===
// =====================================================================
async function fetchSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            'exchangeInfo'
        );
        
        return data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
    } catch (error) {
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 
                'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT', 'MATICUSDT', 'NEARUSDT'];
    }
}

// =====================================================================
// === SCANNER PRINCIPAL - ANTI-POLUIÇÃO ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(70));
    console.log('📊 TITANIUM PRIME SCANNER - VERSÃO ANTI-POLUIÇÃO');
    console.log('='.repeat(70));
    
    const symbols = await fetchSymbols();
    console.log(`📈 Monitorando ${symbols.length} símbolos`);
    console.log(`🎯 Score mínimo: ${CONFIG.ALERTS.MIN_SCORE_TO_ALERT}`);
    console.log(`⏰ Cooldown mesmo lado: ${CONFIG.ALERTS.COOLDOWN_MINUTES} minutos`);
    console.log(`🔄 Direção oposta: ${CONFIG.ALERTS.ALLOW_OPPOSITE_DIRECTION ? 'Permitida sem cooldown' : 'Bloqueada'}`);
    console.log(`📊 RSI Compra máx: ${CONFIG.ALERTS.RSI.BUY_MAX} | RSI Venda mín: ${CONFIG.ALERTS.RSI.SELL_MIN}`);
    console.log(`📊 Limites diários: Top10=15, Top50=25, Outras=35, BaixoVol=10`);
    console.log(`💵 Volume mínimo: $50k/hora | $100k/dia`);
    console.log(`📊 Força tendência mínima: ${CONFIG.ALERTS.MIN_TREND_STRENGTH}`);
    console.log(`📦 Agrupamento: ${CONFIG.ALERTS.GROUP_WINDOW_MINUTES}min | máx ${CONFIG.ALERTS.MAX_GROUP_SIZE} alertas`);
    console.log('='.repeat(70));
    
    // Reset contador diário à meia-noite
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            console.log('📅 Contadores diários resetados');
        }
    }, 60000);
    
    // Processar fila a cada 5 segundos
    setInterval(() => {
        processPriorityQueue();
    }, 5000);
    
    let scanCount = 0;
    
    while (true) {
        try {
            scanCount++;
            alertsSentThisScan = 0;
            
            console.log(`\n📡 Scan #${scanCount} - ${getBrazilianDateTime().full}`);
            
            for (let i = 0; i < symbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = symbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                
                console.log(`🔍 Batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(symbols.length/CONFIG.SCAN.BATCH_SIZE)}`);
                
                await Promise.allSettled(
                    batch.map(symbol => analyzeSymbol(symbol))
                );
                
                if (i + CONFIG.SCAN.BATCH_SIZE < symbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            console.log(`✅ Scan #${scanCount} concluído. Alertas no scan: ${alertsSentThisScan}`);
            console.log(`⏳ Aguardando 30s para próximo scan...`);
            
            await new Promise(r => setTimeout(r, 30000));
            
        } catch (error) {
            console.log('❌ Erro no scan:', error.message);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// =====================================================================
// === INICIAR ===
// =====================================================================
console.log('🚀 Iniciando Titanium Prime Scanner - Modo Anti-Poluição...');
startScanner().catch(console.error);
