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
        BOT_TOKEN: '7633398974:AAHaVFs_D_oZ
        CHAT_ID: '-10019
    },
    BOLLINGER: {
        PERIOD: 20,
        STD_DEV: 2,
        TIMEFRAME: '1d',
        MIN_BANDWIDTH: 2.5
    },
    SCAN: {
        BATCH_SIZE: 10,
        SYMBOL_DELAY_MS: 100,
        REQUEST_TIMEOUT: 10000,
        COOLDOWN_AFTER_BATCH_MS: 800,
        MAX_REQUESTS_PER_MINUTE: 1200,
        CACHE_DURATION_SECONDS: 30,
        TOP_SYMBOLS_LIMIT: 350
    },
    ALERTS: {
        COOLDOWN_MINUTES: 60,
        ALLOW_OPPOSITE_DIRECTION: false,
        COOLDOWN_BY_SCORE: {
           3: 30,
           4: 45,
           5: 60,
           6: 90,
           7: 120,
           8: 180
        },
        COOLDOWN_BY_TIMEFRAME: {
            '1h': 30,
            '4h': 60,
            '1d': 120
        },
        DAILY_LIMITS: {
            TOP_10: 25,
            TOP_50: 40,
            OTHER: 55,
            LOW_VOLUME: 50
        },
        MIN_VOLUME_USDT: 50000,
        MIN_VOLUME_RATIO: 1.7,
        MIN_24H_VOLUME_USDT: 100000,
        VOLUME_DIRECTION: {
            BUY_MIN_PERCENTAGE: 58,
            SELL_MAX_PERCENTAGE: 35,
            STRICT_MODE: true
        },
        MIN_TREND_STRENGTH: 3,
        PRICE_DEVIATION: 1.0,
        RSI: {
            BUY_MAX: 64,
            SELL_MIN: 66
        },
        PRIORITY_LEVELS: {
            CRITICAL: 7,
            HIGH: 5,
            MEDIUM: 4,
            LOW: 3
        },
        GROUP_SIMILAR: true,
        GROUP_WINDOW_MINUTES: 10,
        MAX_GROUP_SIZE: 3,
        SIMILAR_PRICE_DIFF: 1.0,
        MIN_SCORE_TO_ALERT: 3,
        MAX_ALERTS_PER_SCAN: 100,
        IGNORE_LOW_VOLUME_SYMBOLS: true,
        TELEGRAM_DELAY_MS: 1500,
        MIN_15M_VOLATILITY: {
            ENABLED: true,
            MIN_ATR_PERCENT: 0.5,
            MIN_BB_WIDTH_PERCENT: 1.2,
            CHECK_TIMEFRAMES: ['1h', '4h', '1d']
        }
    },
    VOLUME: {
        EMA_PERIOD: 9
    },
    RSI: {
        PERIOD: 14,
        OVERSOLD: 30,
        OVERBOUGHT: 70,
        EXTREME_OVERSOLD: 25,
        EXTREME_OVERBOUGHT: 75
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '1h', '2h', '4h'],
        LOOKBACK_PERIODS: 30,
        MIN_PIVOT_STRENGTH: 0.5,
        SCORE_MULTIPLIER: {
            '15m': 0.5,
            '1h': 1.0,
            '2h': 1.5,
            '4h': 2.0
        },
        REQUIRE_EXTREME_FOR_HIDDEN: true,
        HIDDEN_DIVERGENCE_MULTIPLIER: 1.5,
        REGULAR_DIVERGENCE_MULTIPLIER: 1.0,
        MIN_RSI_EXTREME_FOR_HIDDEN: {
            bullish: 30,
            bearish: 70
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
        },
        ONE_HOUR: {
            K_PERIOD: 14,
            K_SMOOTH: 3,
            D_PERIOD: 3
        }
    },
    REVERSAL: {
        MIN_CONFIRMATION_SCORE: 3,
        VOLUME_THRESHOLD: 1.2,
        STOCH_OVERSOLD: 25,
        STOCH_OVERBOUGHT: 75
    },
    LSR_PENALTY: {
        BUY_MAX_RATIO: 3.5,
        SELL_MIN_RATIO: 1.0,
        PENALTY_POINTS: -5
    },
    FUNDING_PENALTY: {
        ENABLED: true,
        LEVELS: {
            LOW: {
                THRESHOLD: 0.0015,
                POINTS: -2
            },
            MEDIUM: {
                THRESHOLD: 0.003,
                POINTS: -3
            },
            HIGH: {
                THRESHOLD: 0.006,
                POINTS: -4
            }
        },
        BUY_PENALTY_FOR_POSITIVE: true,
        SELL_PENALTY_FOR_NEGATIVE: true,
        MAX_TOTAL_PENALTY: -9
    },
    STOP_LOSS: {
        ATR_MULTIPLIER: {
            '1h': 2.5,
            '4h': 3.0,
            '1d': 3.5
        },
        STRUCTURE_MULTIPLIER: 0.15,
        USE_CLUSTER_ZONE: true,
        CLUSTER_ZONE_MULTIPLIER: 0.1,
        MIN_STOP_DISTANCE_PERCENT: {
            '1h': 1.5,
            '4h': 2.5,
            '1d': 4.0
        },
        MAX_STOP_DISTANCE_PERCENT: {
            '1h': 5.0,
            '4h': 8.0,
            '1d': 12.0
        }
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

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    
    if (type === 'error') {
        console.error(`❌ ${message}`);
    } else if (type === 'success') {
        console.log(`✅ ${message}`);
    } else if (type === 'warning') {
        console.log(`⚠️ ${message}`);
    } else {
        console.log(`ℹ️ ${message}`);
    }
    
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\n', { flag: 'a' });
}

// Caches
const alertCache = new Map();
const dailyCounter = new Map();
const symbolMetadata = new Map();
let currentTopSymbols = [];

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
            log(`Rate limit por minuto atingido, aguardando ${Math.ceil(waitTime / 1000)}s...`, 'warning');
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
            log(`Aguardando ${Math.ceil(waitTime / 1000)}s para respeitar rate limit...`, 'warning');
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
                    log(`Rate limit 429, aguardando ${backoffTime / 1000}s...`, 'warning');
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
                    log(`Timeout na requisição`, 'warning');
                } else {
                    log(`Erro na requisição: ${error.message}`, 'error');
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
async function getTopSymbols() {
    try {
        log('Buscando top símbolos por volume...');
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/ticker/24hr',
            'top_symbols_24h'
        );
        
        const topSymbols = data
            .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.volume) > 0)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
        
        log(`Encontrados ${topSymbols.length} símbolos top por volume`);
        return topSymbols;
    } catch (e) {
        log('Falha ao buscar top symbols, usando lista estática expandida', 'warning');
        return [
            'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','TONUSDT',
            'MATICUSDT','DOTUSDT','TRXUSDT','UNIUSDT','ATOMUSDT','ETCUSDT','ICPUSDT','FILUSDT','NEARUSDT','APTUSDT',
            'LTCUSDT','BCHUSDT','ARBUSDT','OPUSDT','INJUSDT','IMXUSDT','STXUSDT','HBARUSDT','VETUSDT','RUNEUSDT',
            'ALGOUSDT','EGLDUSDT','MANAUSDT','SANDUSDT','AXSUSDT','APEUSDT','CHZUSDT','GALAUSDT','FLOWUSDT','THETAUSDT',
            'AAVEUSDT','MKRUSDT','COMPUSDT','SNXUSDT','YFIUSDT','CRVUSDT','BALUSDT','1INCHUSDT','ENJUSDT','ZILUSDT'
        ];
    }
}

function getSymbolCategory(symbol, topSymbols = []) {
    const top10 = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
                   'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'];

    if (top10.includes(symbol)) return 'TOP_10';

    if (topSymbols.length > 0) {
        const rank = topSymbols.indexOf(symbol);
        if (rank !== -1 && rank < 50) return 'TOP_50';
        if (rank !== -1 && rank < 150) return 'TOP_150';
    }

    return 'OTHER';
}

function getDailyLimit(symbol) {
    const category = getSymbolCategory(symbol, currentTopSymbols);
    return CONFIG.ALERTS.DAILY_LIMITS[category] || CONFIG.ALERTS.DAILY_LIMITS.OTHER;
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

function calculateBollingerBandwidth(bb) {
    if (!bb) return 0;
    const bandwidth = (bb.upper - bb.lower) / bb.middle * 100;
    return bandwidth;
}

function checkTrendStrength(candles) {
    if (!candles || candles.length < 20) return 0;
    
    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    
    const recentCandles = candles.slice(-10);
    const deviations = recentCandles.map(c => Math.abs(c.close - ema20) / ema20 * 100);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    
    return avgDeviation;
}

// =====================================================================
// === FUNÇÃO MELHORADA: Análise de Reversão com Padrões de Candles ===
// =====================================================================
function isTrueReversal(candles, bb, touchedLower, touchedUpper) {
    if (!candles || candles.length < 8) return { isReversal: false, score: 0, details: {}, patterns: [] };
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prevPrevCandle = candles[candles.length - 3];
    const candle4 = candles[candles.length - 4];
    const candle5 = candles[candles.length - 5];
    const currentPrice = lastCandle.close;
    
    const details = {};
    const patterns = [];
    let score = 0;
    
    if (touchedLower) {
        // === ANÁLISE BÁSICA ORIGINAL (MANTIDA) ===
        const isBullishCandle = lastCandle.close > lastCandle.open;
        details.isBullishCandle = isBullishCandle;
        if (isBullishCandle) {
            score++;
            patterns.push("✅ Candle de alta");
        }
        
        const closedAboveLower = currentPrice > bb.lower * 1.005;
        details.closedAboveLower = closedAboveLower;
        if (closedAboveLower) {
            score++;
            patterns.push("📊 Fechou acima da banda");
        }
        
        const lowerShadow = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongLowerShadow = bodySize > 0 ? lowerShadow > bodySize * 0.5 : lowerShadow > 0;
        details.hasLongLowerShadow = hasLongLowerShadow;
        if (hasLongLowerShadow) {
            score++;
            patterns.push("🕯️ Sombra inferior longa");
        }
        
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) {
            score++;
            patterns.push("📈 Volume maior");
        }
        
        const priceStabilized = lastCandle.close > prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) {
            score++;
            patterns.push("📊 Preço estabilizou");
        }
        
        const lowestIn3 = Math.min(prevPrevCandle.low, prevCandle.low, lastCandle.low) === lastCandle.low;
        details.lowestIn3 = lowestIn3;
        if (lowestIn3) {
            score++;
            patterns.push("📉 Mínima de 3 períodos");
        }
        
        // === NOVOS PADRÕES DE REVERSÃO (APENAS CANDLES) ===
        
        // 1. PADRÃO ENGOLFANTE DE ALTA (FORÇA 2)
        if (prevCandle && prevCandle.close < prevCandle.open) { // Candle anterior de baixa
            if (lastCandle.close > lastCandle.open && // Candle atual de alta
                lastCandle.open < prevCandle.close && // Abriu abaixo do fechamento anterior
                lastCandle.close > prevCandle.open) { // Fechou acima da abertura anterior
                score += 2;
                patterns.push("🟢 ENGOLFANTE DE ALTA");
            }
        }
        
        // 2. PADRÃO MARTELO (HAMMER)
        const totalRange = lastCandle.high - lastCandle.low;
        const bodySizeHammer = Math.abs(lastCandle.close - lastCandle.open);
        const lowerShadowHammer = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        const upperShadowHammer = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        
        if (totalRange > 0 && bodySizeHammer < totalRange * 0.3) { // Corpo pequeno
            if (lowerShadowHammer > bodySizeHammer * 2 && upperShadowHammer < bodySizeHammer * 0.3) {
                score += 2;
                patterns.push("🔨 MARTELO");
            }
        }
        
        // 3. PADRÃO DOJI DE REVERSÃO
        const isDoji = totalRange > 0 && bodySizeHammer < totalRange * 0.1;
        if (isDoji) {
            if (lowerShadowHammer > bodySizeHammer * 2) { // Doji com longa sombra inferior
                score += 1;
                patterns.push("〰️ DOJI DE REVERSÃO");
            }
        }
        
        // 4. PADRÃO HARAMI DE ALTA
        if (prevCandle && prevPrevCandle) {
            const prevBodySize = Math.abs(prevCandle.close - prevCandle.open);
            const currentBodySize = Math.abs(lastCandle.close - lastCandle.open);
            
            if (prevCandle.close < prevCandle.open && // Candle anterior de baixa grande
                prevBodySize > Math.abs(prevPrevCandle.close - prevPrevCandle.open) * 0.8 && // Era grande
                currentBodySize < prevBodySize * 0.5 && // Candle atual pequeno
                lastCandle.close > lastCandle.open && // De alta
                lastCandle.high < prevCandle.high && // Dentro do range anterior
                lastCandle.low > prevCandle.low) {
                score += 1;
                patterns.push("📦 HARAMI DE ALTA");
            }
        }
        
        // 5. MÍNIMA CRESCENTE (3 candles formando fundo)
        if (candle5 && candle4 && prevPrevCandle && prevCandle && lastCandle) {
            const low5 = candle5.low;
            const low4 = candle4.low;
            const low3 = prevPrevCandle.low;
            const low2 = prevCandle.low;
            const low1 = lastCandle.low;
            
            // Padrão: fundo em V (low mais baixo no meio)
            if (low4 > low3 && low3 < low2 && low2 > low3) {
                score += 1;
                patterns.push("⛰️ FUNDO EM V");
            }
            
            // Padrão: duplo fundo
            if (Math.abs(low5 - low1) / low1 < 0.015 && low3 > low1 * 1.02) {
                score += 2;
                patterns.push("💎 DUPLO FUNDO");
            }
        }
        
        // 6. REJEÇÃO FORTE (wick muito grande)
        if (totalRange > 0) {
            const lowerShadowPercent = (lowerShadowHammer / totalRange) * 100;
            if (lowerShadowPercent > 70) {
                score += 1;
                patterns.push(`🎯 REJEÇÃO ${lowerShadowPercent.toFixed(0)}%`);
            }
        }
        
        // 7. FECHAMENTO ACIMA DA MÉDIA DOS ÚLTIMOS 3 CANDLES
        if (prevCandle && prevPrevCandle) {
            const avgClose3 = (prevPrevCandle.close + prevCandle.close + lastCandle.close) / 3;
            if (lastCandle.close > avgClose3 * 1.01) {
                score += 1;
                patterns.push("📊 Acima da média 3p");
            }
        }
    }
    
    if (touchedUpper) {
        // === ANÁLISE BÁSICA ORIGINAL (MANTIDA) ===
        const isBearishCandle = lastCandle.close < lastCandle.open;
        details.isBearishCandle = isBearishCandle;
        if (isBearishCandle) {
            score++;
            patterns.push("✅ Candle de baixa");
        }
        
        const closedBelowUpper = currentPrice < bb.upper * 0.995;
        details.closedBelowUpper = closedBelowUpper;
        if (closedBelowUpper) {
            score++;
            patterns.push("📊 Fechou abaixo da banda");
        }
        
        const upperShadow = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongUpperShadow = bodySize > 0 ? upperShadow > bodySize * 0.5 : upperShadow > 0;
        details.hasLongUpperShadow = hasLongUpperShadow;
        if (hasLongUpperShadow) {
            score++;
            patterns.push("🕯️ Sombra superior longa");
        }
        
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) {
            score++;
            patterns.push("📈 Volume maior");
        }
        
        const priceStabilized = lastCandle.close < prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) {
            score++;
            patterns.push("📊 Preço estabilizou");
        }
        
        const highestIn3 = Math.max(prevPrevCandle.high, prevCandle.high, lastCandle.high) === lastCandle.high;
        details.highestIn3 = highestIn3;
        if (highestIn3) {
            score++;
            patterns.push("📈 Máxima de 3 períodos");
        }
        
        // === NOVOS PADRÕES DE REVERSÃO (APENAS CANDLES) ===
        
        // 1. PADRÃO ENGOLFANTE DE BAIXA (FORÇA 2)
        if (prevCandle && prevCandle.close > prevCandle.open) { // Candle anterior de alta
            if (lastCandle.close < lastCandle.open && // Candle atual de baixa
                lastCandle.open > prevCandle.close && // Abriu acima do fechamento anterior
                lastCandle.close < prevCandle.open) { // Fechou abaixo da abertura anterior
                score += 2;
                patterns.push("🔴 ENGOLFANTE DE BAIXA");
            }
        }
        
        // 2. PADRÃO ESTRELA CADENTE (SHOOTING STAR)
        const totalRangeSell = lastCandle.high - lastCandle.low;
        const bodySizeStar = Math.abs(lastCandle.close - lastCandle.open);
        const upperShadowStar = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        const lowerShadowStar = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        
        if (totalRangeSell > 0 && bodySizeStar < totalRangeSell * 0.3) { // Corpo pequeno
            if (upperShadowStar > bodySizeStar * 2 && lowerShadowStar < bodySizeStar * 0.3) {
                score += 2;
                patterns.push("⭐ ESTRELA CADENTE");
            }
        }
        
        // 3. PADRÃO DOJI DE TOPO
        const isDojiSell = totalRangeSell > 0 && bodySizeStar < totalRangeSell * 0.1;
        if (isDojiSell) {
            if (upperShadowStar > bodySizeStar * 2) { // Doji com longa sombra superior
                score += 1;
                patterns.push("〰️ DOJI DE TOPO");
            }
        }
        
        // 4. PADRÃO HARAMI DE BAIXA
        if (prevCandle && prevPrevCandle) {
            const prevBodySize = Math.abs(prevCandle.close - prevCandle.open);
            const currentBodySize = Math.abs(lastCandle.close - lastCandle.open);
            
            if (prevCandle.close > prevCandle.open && // Candle anterior de alta grande
                prevBodySize > Math.abs(prevPrevCandle.close - prevPrevCandle.open) * 0.8 &&
                currentBodySize < prevBodySize * 0.5 && // Candle atual pequeno
                lastCandle.close < lastCandle.open && // De baixa
                lastCandle.high < prevCandle.high && // Dentro do range anterior
                lastCandle.low > prevCandle.low) {
                score += 1;
                patterns.push("📦 HARAMI DE BAIXA");
            }
        }
        
        // 5. MÁXIMA DECRESCENTE (3 candles formando topo)
        if (candle5 && candle4 && prevPrevCandle && prevCandle && lastCandle) {
            const high5 = candle5.high;
            const high4 = candle4.high;
            const high3 = prevPrevCandle.high;
            const high2 = prevCandle.high;
            const high1 = lastCandle.high;
            
            // Padrão: topo em Λ (high mais alto no meio)
            if (high4 < high3 && high3 > high2 && high2 < high3) {
                score += 1;
                patterns.push("⛰️ TOPO EM Λ");
            }
            
            // Padrão: duplo topo
            if (Math.abs(high5 - high1) / high1 < 0.015 && high3 < high1 * 0.98) {
                score += 2;
                patterns.push("💎 DUPLO TOPO");
            }
        }
        
        // 6. REJEÇÃO FORTE NO TOPO
        if (totalRangeSell > 0) {
            const upperShadowPercent = (upperShadowStar / totalRangeSell) * 100;
            if (upperShadowPercent > 70) {
                score += 1;
                patterns.push(`🎯 REJEÇÃO ${upperShadowPercent.toFixed(0)}%`);
            }
        }
        
        // 7. FECHAMENTO ABAIXO DA MÉDIA DOS ÚLTIMOS 3 CANDLES
        if (prevCandle && prevPrevCandle) {
            const avgClose3 = (prevPrevCandle.close + prevCandle.close + lastCandle.close) / 3;
            if (lastCandle.close < avgClose3 * 0.99) {
                score += 1;
                patterns.push("📊 Abaixo da média 3p");
            }
        }
    }
    
    // Determina se é reversão baseado no score
    // Score mínimo 4 para considerar reversão (considerando que agora temos mais critérios)
    const isReversal = score >= 4;
    
    // Log para debug
    if (touchedLower || touchedUpper) {
        const direction = touchedLower ? "COMPRA" : "VENDA";
        log(`📊 Reversão ${direction}: Score ${score} | Padrões: ${patterns.slice(0, 3).join(' • ')}`, 'info');
    }
    
    return {
        isReversal,
        score: Math.min(score, 12), // Aumentado o máximo para comportar os novos padrões
        details,
        patterns: patterns.slice(0, 4) // Mostra até 4 padrões
    };
}

// =====================================================================
// === FUNÇÕES AVANÇADAS DE DIVERGÊNCIA RSI ===
// =====================================================================

function findSignificantPivots(values, minStrength = 0.5) {
    const pivots = { highs: [], lows: [] };
    if (values.length < 5) return pivots;

    for (let i = 2; i < values.length - 2; i++) {
        const curr = values[i];
        const p2 = values[i-2], p1 = values[i-1];
        const n1 = values[i+1], n2 = values[i+2];

        if (curr > p1 && curr > p2 && curr > n1 && curr > n2) {
            const avg = (p2 + p1 + n1 + n2) / 4;
            const strength = ((curr - avg) / avg) * 100;
            if (strength >= minStrength) {
                pivots.highs.push({ index: i, value: curr, strength });
            }
        }

        if (curr < p1 && curr < p2 && curr < n1 && curr < n2) {
            const avg = (p2 + p1 + n1 + n2) / 4;
            const strength = ((avg - curr) / avg) * 100;
            if (strength >= minStrength) {
                pivots.lows.push({ index: i, value: curr, strength });
            }
        }
    }
    return pivots;
}

function isExtremeRSI(value, type) {
    if (type === 'bullish') {
        return value <= CONFIG.RSI.EXTREME_OVERSOLD;
    } else {
        return value >= CONFIG.RSI.EXTREME_OVERBOUGHT;
    }
}

function detectAdvancedDivergences(prices, rsiValues, timeframe) {
    const divergences = [];
    
    if (prices.length < 20 || rsiValues.length < 20) return divergences;
    
    const pricePivots = findSignificantPivots(prices, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH);
    const rsiPivots = findSignificantPivots(rsiValues, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH * 2);
    
    const multiplier = CONFIG.RSI_DIVERGENCE.SCORE_MULTIPLIER[timeframe] || 1;
    
    // Divergências Regulares
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        
        if (prevPriceLow.index < lastPriceLow.index && prevRSILow.index < lastRSILow.index) {
            if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
                const score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                divergences.push({
                    timeframe,
                    type: 'bullish',
                    subtype: 'regular',
                    score: Math.round(score * 10) / 10,
                    emoji: '📈',
                    strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                    rsiValue: lastRSILow.value,
                    priceValue: lastPriceLow.value
                });
            }
        }
    }
    
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        
        if (prevPriceHigh.index < lastPriceHigh.index && prevRSIHigh.index < lastRSIHigh.index) {
            if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
                const score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                divergences.push({
                    timeframe,
                    type: 'bearish',
                    subtype: 'regular',
                    score: Math.round(score * 10) / 10,
                    emoji: '📉',
                    strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                    rsiValue: lastRSIHigh.value,
                    priceValue: lastPriceHigh.value
                });
            }
        }
    }
    
    // Divergências Ocultas
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        
        if (prevPriceLow.index < lastPriceLow.index && prevRSILow.index < lastRSILow.index) {
            if (lastPriceLow.value > prevPriceLow.value && lastRSILow.value < prevRSILow.value) {
                const rsiExtreme = isExtremeRSI(lastRSILow.value, 'bullish');
                
                if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                    const score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.HIDDEN_DIVERGENCE_MULTIPLIER;
                    divergences.push({
                        timeframe,
                        type: 'bullish',
                        subtype: 'hidden',
                        score: Math.round(score * 10) / 10,
                        emoji: '🔮',
                        strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                        rsiValue: lastRSILow.value,
                        priceValue: lastPriceLow.value,
                        extreme: rsiExtreme
                    });
                }
            }
        }
    }
    
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        
        if (prevPriceHigh.index < lastPriceHigh.index && prevRSIHigh.index < lastRSIHigh.index) {
            if (lastPriceHigh.value < prevPriceHigh.value && lastRSIHigh.value > prevRSIHigh.value) {
                const rsiExtreme = isExtremeRSI(lastRSIHigh.value, 'bearish');
                
                if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                    const score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.HIDDEN_DIVERGENCE_MULTIPLIER;
                    divergences.push({
                        timeframe,
                        type: 'bearish',
                        subtype: 'hidden',
                        score: Math.round(score * 10) / 10,
                        emoji: '🔮',
                        strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                        rsiValue: lastRSIHigh.value,
                        priceValue: lastPriceHigh.value,
                        extreme: rsiExtreme
                    });
                }
            }
        }
    }
    
    return divergences;
}

function checkRSIDivergenceMultiTimeframe(candlesByTimeframe) {
    const allDivergences = [];
    let totalScore = 0;

    for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
        const candles = candlesByTimeframe[tf];
        if (!candles || candles.length < 40) continue;

        const rsiValues = [];
        const prices = [];

        for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
            rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
            prices.push(candles[i].close);
        }

        if (rsiValues.length < 25) continue;

        const divergences = detectAdvancedDivergences(prices, rsiValues, tf);

        for (const div of divergences) {
            allDivergences.push(div);
            totalScore += div.score;
        }
    }

    allDivergences.sort((a, b) => b.score - a.score);

    return {
        hasDivergence: allDivergences.length > 0,
        divergences: allDivergences,
        totalScore: Math.round(totalScore * 10) / 10
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
            message: `⚠️ LSR alto (${lsr.toFixed(2)}) - Muitos comprados (${CONFIG.LSR_PENALTY.PENALTY_POINTS})`
        };
    }
    
    if (!isGreenAlert && lsr < CONFIG.LSR_PENALTY.SELL_MIN_RATIO) {
        return {
            hasPenalty: true,
            points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
            message: `⚠️ LSR baixo (${lsr.toFixed(2)}) - Muitos vendidos (${CONFIG.LSR_PENALTY.PENALTY_POINTS})`
        };
    }
    
    return { hasPenalty: false, points: 0, message: '' };
}

function checkFundingPenalty(funding, isGreenAlert) {
    if (!CONFIG.FUNDING_PENALTY.ENABLED || funding === null || funding === undefined) {
        return { hasPenalty: false, points: 0, message: '' };
    }
    
    const fundingPercent = funding * 100;
    const absFunding = Math.abs(funding);
    
    let penaltyPoints = 0;
    let penaltyLevel = '';
    
    if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.HIGH.THRESHOLD) {
        penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.HIGH.POINTS;
        penaltyLevel = 'ALTO';
    } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.MEDIUM.THRESHOLD) {
        penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.MEDIUM.POINTS;
        penaltyLevel = 'MÉDIO';
    } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.LOW.THRESHOLD) {
        penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.LOW.POINTS;
        penaltyLevel = 'BAIXO';
    }
    
    let applyPenalty = false;
    let direction = '';
    
    if (isGreenAlert && funding > 0 && CONFIG.FUNDING_PENALTY.BUY_PENALTY_FOR_POSITIVE) {
        applyPenalty = true;
        direction = 'positivo';
    } else if (!isGreenAlert && funding < 0 && CONFIG.FUNDING_PENALTY.SELL_PENALTY_FOR_NEGATIVE) {
        applyPenalty = true;
        direction = 'negativo';
    }
    
    if (applyPenalty && penaltyPoints !== 0) {
        const fundingSign = funding > 0 ? '+' : '';
        const message = `⚠️ Funding ${direction} (${fundingSign}${fundingPercent.toFixed(4)}%) - Nível ${penaltyLevel} (${penaltyPoints})`;
        
        return {
            hasPenalty: true,
            points: penaltyPoints,
            level: penaltyLevel,
            message: message
        };
    }
    
    return { hasPenalty: false, points: 0, message: '' };
}

// =====================================================================
// === NOVA FUNÇÃO PARA VERIFICAR VOLATILIDADE EM 15 MINUTOS ===
// =====================================================================
async function check15MinVolatility(symbol) {
    if (!CONFIG.ALERTS.MIN_15M_VOLATILITY.ENABLED) return { passed: true, message: '', metrics: {} };
    
    try {
        const candles15m = await getCandles(symbol, '15m', 30);
        
        if (!candles15m || candles15m.length < 20) {
            log(`${symbol} - Dados insuficientes para análise de volatilidade 15m`, 'warning');
            return { passed: false, message: 'Dados insuficientes 15m', metrics: {} };
        }
        
        // Calcular ATR em percentual para 15 minutos
        const trValues = [];
        for (let i = 1; i < candles15m.length; i++) {
            const high = candles15m[i].high;
            const low = candles15m[i].low;
            const prevClose = candles15m[i-1].close;
            
            const tr1 = high - low;
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);
            
            trValues.push(Math.max(tr1, tr2, tr3));
        }
        
        const recentTR = trValues.slice(-14);
        const atr = recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
        const currentPrice = candles15m[candles15m.length - 1].close;
        const atrPercent = (atr / currentPrice) * 100;
        
        // Calcular largura das Bandas de Bollinger em percentual para 15 minutos
        const bb15m = calculateBollingerBands(candles15m, 20, 2);
        let bbWidthPercent = 0;
        
        if (bb15m) {
            bbWidthPercent = ((bb15m.upper - bb15m.lower) / bb15m.middle) * 100;
        }
        
        const minATR = CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_ATR_PERCENT;
        const minBBWidth = CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_BB_WIDTH_PERCENT;
        
        const atrPassed = atrPercent >= minATR;
        const bbPassed = bbWidthPercent >= minBBWidth;
        
        const passed = atrPassed && bbPassed;
        
        let message = '';
        if (!passed) {
            const failures = [];
            if (!atrPassed) failures.push(`ATR15m ${atrPercent.toFixed(2)}% < ${minATR}%`);
            if (!bbPassed) failures.push(`BB15m ${bbWidthPercent.toFixed(2)}% < ${minBBWidth}%`);
            message = `⚠️ Baixa volatilidade 15m: ${failures.join(' • ')}`;
            log(`${symbol} - ${message}`, 'warning');
        } else {
            log(`${symbol} - Volatilidade 15m OK: ATR=${atrPercent.toFixed(2)}% BB=${bbWidthPercent.toFixed(2)}%`, 'info');
        }
        
        return {
            passed,
            message,
            metrics: {
                atrPercent,
                bbWidthPercent,
                atrPassed,
                bbPassed
            }
        };
        
    } catch (error) {
        log(`Erro ao verificar volatilidade 15m para ${symbol}: ${error.message}`, 'error');
        return { passed: false, message: 'Erro na verificação 15m', metrics: {} };
    }
}

function calculateProtectedStopLoss(currentPrice, isGreenAlert, timeframe, candles, bb) {
    if (!candles || candles.length < 20) {
        const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 2.0;
        const atr = (bb.upper - bb.lower) * 0.1;
        return isGreenAlert ? currentPrice - atr * atrMultiplier : currentPrice + atr * atrMultiplier;
    }

    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        trValues.push(Math.max(tr1, tr2, tr3));
    }
    
    const atrPeriod = 14;
    const recentTR = trValues.slice(-atrPeriod);
    const atr = recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
    
    const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 2.5;
    
    let stopPrice;
    if (isGreenAlert) {
        stopPrice = currentPrice - (atr * atrMultiplier);
    } else {
        stopPrice = currentPrice + (atr * atrMultiplier);
    }
    
    const lookback = timeframe === '1d' ? 20 : (timeframe === '4h' ? 30 : 40);
    const relevantCandles = candles.slice(-lookback);
    
    let structureLow = Math.min(...relevantCandles.map(c => c.low));
    let structureHigh = Math.max(...relevantCandles.map(c => c.high));
    
    const touchCount = {};
    relevantCandles.forEach(c => {
        const lowKey = Math.round(c.low * 1000) / 1000;
        const highKey = Math.round(c.high * 1000) / 1000;
        
        touchCount[lowKey] = (touchCount[lowKey] || 0) + 1;
        touchCount[highKey] = (touchCount[highKey] || 0) + 1;
    });
    
    let clusterZone = isGreenAlert ? structureLow : structureHigh;
    let maxTouches = 0;
    
    Object.entries(touchCount).forEach(([price, touches]) => {
        const priceNum = parseFloat(price);
        if (isGreenAlert && priceNum < currentPrice && priceNum > structureLow * 0.95) {
            if (touches > maxTouches) {
                maxTouches = touches;
                clusterZone = priceNum;
            }
        } else if (!isGreenAlert && priceNum > currentPrice && priceNum < structureHigh * 1.05) {
            if (touches > maxTouches) {
                maxTouches = touches;
                clusterZone = priceNum;
            }
        }
    });
    
    const clusterZoneDistance = Math.abs(currentPrice - clusterZone) / currentPrice * 100;
    const clusterBuffer = clusterZoneDistance * CONFIG.STOP_LOSS.CLUSTER_ZONE_MULTIPLIER;
    
    if (isGreenAlert) {
        const clusterAdjustedStop = Math.min(stopPrice, clusterZone - (clusterZone * 0.002));
        
        if (clusterZone < currentPrice) {
            stopPrice = Math.min(stopPrice, clusterAdjustedStop);
            log(`Stop ajustado para zona de cluster: ${formatPrice(clusterZone)}`, 'info');
        }
        
        const stopDistance = (currentPrice - stopPrice) / currentPrice * 100;
        const minDistance = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 1.5;
        const maxDistance = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 5.0;
        
        if (stopDistance < minDistance) {
            stopPrice = currentPrice * (1 - minDistance / 100);
        } else if (stopDistance > maxDistance) {
            stopPrice = currentPrice * (1 - maxDistance / 100);
        }
    } else {
        const clusterAdjustedStop = Math.max(stopPrice, clusterZone + (clusterZone * 0.002));
        
        if (clusterZone > currentPrice) {
            stopPrice = Math.max(stopPrice, clusterAdjustedStop);
            log(`Stop ajustado para zona de cluster: ${formatPrice(clusterZone)}`, 'info');
        }
        
        const stopDistance = (stopPrice - currentPrice) / currentPrice * 100;
        const minDistance = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 1.5;
        const maxDistance = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 5.0;
        
        if (stopDistance < minDistance) {
            stopPrice = currentPrice * (1 + minDistance / 100);
        } else if (stopDistance > maxDistance) {
            stopPrice = currentPrice * (1 + maxDistance / 100);
        }
    }
    
    log(`Stop Loss calculado: ATR=${formatPrice(atr)} Multiplier=${atrMultiplier} Distância=${Math.abs(currentPrice - stopPrice) / currentPrice * 100}%`, 'info');
    
    return stopPrice;
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
        const bb1h = calculateBollingerBands(candles1h, 20, 2);
        
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
        
        const stoch1h = calculateStochastic(
            candles1h, 
            CONFIG.STOCHASTIC.ONE_HOUR.K_PERIOD,
            CONFIG.STOCHASTIC.ONE_HOUR.K_SMOOTH,
            CONFIG.STOCHASTIC.ONE_HOUR.D_PERIOD
        );
        
        const stoch1dFormatted = formatStochastic(stochDaily, 'daily');
        const stoch4hFormatted = formatStochastic(stoch4h, '4h');
        const stoch1hFormatted = formatStochastic(stoch1h, '1h');
        
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        
        const volumeUSDT1h = currentVolume1h * currentPrice;
        
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1] || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
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
        
        const trendStrength = checkTrendStrength(candles1h);
        
        return {
            rsi,
            stoch1d: stoch1dFormatted,
            stoch4h: stoch4hFormatted,
            stoch1h: stoch1hFormatted,
            stochDailyValues: stochDaily,
            stoch4hValues: stoch4h,
            stoch1hValues: stoch1h,
            volume1h: {
                ratio: volumeRatio1h,
                percentage: volume1h.percentage,
                text: volume1h.text,
                direction: volume1h.direction,
                emoji: volume1h.emoji,
                ratioFormatted: volumeRatio1h.toFixed(2),
                usdt: volumeUSDT1h
            },
            volume3m: {
                ratio: volumeRatio3m,
                percentage: volume3m.percentage,
                text: volume3m.text,
                direction: volume3m.direction,
                emoji: volume3m.emoji,
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
            bb1h: bb1h ? {
                upper: bb1h.upper,
                lower: bb1h.lower
            } : {
                upper: currentPrice * 1.1,
                lower: currentPrice * 0.9
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
                '15m': candles15m.slice(-50),
                '1h': candles1h.slice(-50),
                '2h': candles2h.slice(-50),
                '4h': candles4h.slice(-50)
            },
            candles4h: candles4h,
            candles1h: candles1h,
            candlesDaily: candlesDaily,
            candles15m: candles15m
        };
    } catch (error) {
        log(`Erro em getAdditionalData para ${symbol}: ${error.message}`, 'error');
        return {
            rsi: 50,
            stoch1d: 'K50⤵️D55 🟡',
            stoch4h: 'K50⤵️D55 🟡',
            stoch1h: 'K50⤵️D55 🟡',
            stochDailyValues: { k: 50, d: 55 },
            stoch4hValues: { k: 50, d: 55 },
            stoch1hValues: { k: 50, d: 55 },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00', usdt: 0 },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro', usdt: 0 },
            trendStrength: 0,
            bbDaily: { upper: currentPrice * 1.2, lower: currentPrice * 0.8 },
            bb4h: { upper: currentPrice * 1.15, lower: currentPrice * 0.85 },
            bb1h: { upper: currentPrice * 1.1, lower: currentPrice * 0.9 },
            bbWeekly: { upper: currentPrice * 1.3, lower: currentPrice * 0.7 },
            lsr: null,
            funding: null,
            candlesByTimeframe: {
                '15m': [],
                '1h': [],
                '2h': [],
                '4h': []
            },
            candles4h: [],
            candles1h: [],
            candlesDaily: [],
            candles15m: []
        };
    }
}

// =====================================================================
// === VERIFICAR SE PODE ENVIAR ALERTA ===
// =====================================================================
function canSendAlert(symbol, direction, price, score, volumeRatio, volumeUSDT, volume24hUSDT, trendStrength, rsi, volumeDirection, volumePercentage, timeframe) {
    const now = Date.now();
    const key = `${symbol}_${direction}_${timeframe}`;
    const symbolKey = `${symbol}_ANY`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    const lastAnyAlert = alertCache.get(symbolKey);
    if (lastAnyAlert) {
        const lastAlertData = lastAnyAlert;
        const minutesDiff = (now - lastAlertData.timestamp) / (1000 * 60);
        
        if (minutesDiff < 30) {
            log(`${symbol} - Cooldown global: ${minutesDiff.toFixed(1)}min < 30min necessários`, 'warning');
            return false;
        }
    }
    
    const lastAlert = alertCache.get(key);
    if (lastAlert) {
        const lastAlertData = lastAlert;
        const minutesDiff = (now - lastAlertData.timestamp) / (1000 * 60);
        const requiredCooldown = CONFIG.ALERTS.COOLDOWN_BY_TIMEFRAME[timeframe] || 30;
        
        if (minutesDiff < requiredCooldown) {
            log(`${symbol} [${timeframe}] - Cooldown: ${minutesDiff.toFixed(1)}min < ${requiredCooldown}min necessários`, 'warning');
            return false;
        }
    }
    
    if (direction === 'COMPRA' && rsi > CONFIG.ALERTS.RSI.BUY_MAX) {
        log(`${symbol} - RSI muito alto para COMPRA: ${rsi} > ${CONFIG.ALERTS.RSI.BUY_MAX}`, 'warning');
        return false;
    }
    
    if (direction === 'VENDA' && rsi < CONFIG.ALERTS.RSI.SELL_MIN) {
        log(`${symbol} - RSI muito baixo para VENDA: ${rsi} < ${CONFIG.ALERTS.RSI.SELL_MIN}`, 'warning');
        return false;
    }
    
    if (score < CONFIG.ALERTS.MIN_SCORE_TO_ALERT) {
        log(`${symbol} - Score baixo (${score})`, 'warning');
        return false;
    }
    
    if (CONFIG.ALERTS.VOLUME_DIRECTION.STRICT_MODE) {
        if (direction === 'COMPRA') {
            if (volumePercentage < CONFIG.ALERTS.VOLUME_DIRECTION.BUY_MIN_PERCENTAGE) {
                log(`${symbol} - Volume NÃO está comprador para COMPRA: ${volumePercentage.toFixed(1)}% < ${CONFIG.ALERTS.VOLUME_DIRECTION.BUY_MIN_PERCENTAGE}%`, 'warning');
                return false;
            }
            log(`${symbol} - Volume comprador confirmado: ${volumePercentage.toFixed(1)}%`, 'success');
        } else if (direction === 'VENDA') {
            if (volumePercentage > CONFIG.ALERTS.VOLUME_DIRECTION.SELL_MAX_PERCENTAGE) {
                log(`${symbol} - Volume NÃO está vendedor para VENDA: ${volumePercentage.toFixed(1)}% > ${CONFIG.ALERTS.VOLUME_DIRECTION.SELL_MAX_PERCENTAGE}%`, 'warning');
                return false;
            }
            log(`${symbol} - Volume vendedor confirmado: ${(100 - volumePercentage).toFixed(1)}%`, 'success');
        }
    }
    
    const dailyLimit = getDailyLimit(symbol);
    const dailyCount = dailyCounter.get(dailyKey) || 0;
    if (dailyCount >= dailyLimit) {
        log(`${symbol} atingiu limite diário de ${dailyLimit}`, 'warning');
        return false;
    }
    
    if (volumeRatio < CONFIG.ALERTS.MIN_VOLUME_RATIO) {
        log(`${symbol} - Volume ratio baixo (${volumeRatio.toFixed(2)}x)`, 'warning');
        return false;
    }
    
    if (volumeUSDT < CONFIG.ALERTS.MIN_VOLUME_USDT) {
        log(`${symbol} - Volume USDT baixo ($${formatPrice(volumeUSDT)})`, 'warning');
        return false;
    }
    
    if (volume24hUSDT < CONFIG.ALERTS.MIN_24H_VOLUME_USDT) {
        log(`${symbol} - Volume 24h baixo ($${formatPrice(volume24hUSDT)})`, 'warning');
        return false;
    }
    
    if (trendStrength < CONFIG.ALERTS.MIN_TREND_STRENGTH) {
        log(`${symbol} - Tendência fraca (${trendStrength.toFixed(2)})`, 'warning');
        return false;
    }
    
    const lastPrice = alertCache.get(priceKey);
    if (lastPrice) {
        const lastPriceData = lastPrice;
        const priceDiff = Math.abs((price - lastPriceData.price) / lastPriceData.price * 100);
        if (priceDiff < CONFIG.ALERTS.PRICE_DEVIATION) {
            log(`${symbol} - Variação de preço baixa (${priceDiff.toFixed(2)}%)`, 'warning');
            return false;
        }
    }
    
    if (alertsSentThisScan >= CONFIG.ALERTS.MAX_ALERTS_PER_SCAN) {
        log(`Limite de alertas deste scan atingido (${CONFIG.ALERTS.MAX_ALERTS_PER_SCAN})`, 'warning');
        return false;
    }
    
    return true;
}

// =====================================================================
// === REGISTRAR ALERTA ===
// =====================================================================
function registerAlert(symbol, direction, price, timeframe) {
    const now = Date.now();
    const key = `${symbol}_${direction}_${timeframe}`;
    const symbolKey = `${symbol}_ANY`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    alertCache.set(key, {
        timestamp: now,
        timeframe: timeframe,
        direction: direction
    });
    
    alertCache.set(symbolKey, {
        timestamp: now,
        timeframe: 'ANY',
        direction: direction
    });
    
    alertCache.set(priceKey, {
        price: price,
        timestamp: now
    });
    
    const dailyCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, dailyCount);
    alertsSentThisScan++;
    
    for (const [k, v] of alertCache) {
        if (now - v.timestamp > 48 * 60 * 60 * 1000) {
            alertCache.delete(k);
        }
    }
    
    log(`Registrado alerta ${symbol} ${direction} [${timeframe}] #${dailyCount} do dia`, 'success');
}

// =====================================================================
// === SISTEMA DE FILAS PRIORITÁRIAS ===
// =====================================================================
function queueAlert(alert) {
    const priority = getPriorityLevel(alert.confirmationScore);
    priorityQueue[priority].push(alert);
    
    log(`Alerta ${alert.symbol} [${alert.timeframe}] adicionado à fila ${priority} (score ${alert.confirmationScore})`, 'info');
}

async function processPriorityQueue() {
    if (isSendingTelegram) return;
    
    isSendingTelegram = true;
    
    const priorities = ['critical', 'high', 'medium', 'low'];
    
    for (const priority of priorities) {
        const alerts = priorityQueue[priority];
        if (alerts.length === 0) continue;
        
        log(`Processando ${alerts.length} alertas ${priority}...`, 'info');
        
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
            log(`Erro Telegram: ${response.status}`, 'error');
        } else {
            registerAlert(alert.symbol, alert.direction, alert.price, alert.timeframe);
            const penaltyIcon = alert.totalPenalty < 0 ? '⚠️' : '✅';
            log(`${penaltyIcon} ALERTA ENVIADO: ${alert.direction} ${alert.symbol} [${alert.timeframe}] - Score: ${alert.confirmationScore} | Volume: ${alert.volume1h.direction} (${alert.volume1h.percentage.toFixed(1)}%) | Penalidades: ${alert.totalPenalty}`, 'success');
        }
        
        return true;
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
        return false;
    }
}

async function sendGroupedAlerts(alerts, priority) {
    if (alerts.length === 0) return;
    
    const buyAlerts = alerts.filter(a => a.isGreenAlert);
    const sellAlerts = alerts.filter(a => !a.isGreenAlert);
    
    let message = `<i>📊 **ALERTAS AGRUPADOS (${priority.toUpperCase()})**\n\n`;
    
    if (buyAlerts.length > 0) {
        message += `🟢 **COMPRA** (${buyAlerts.length})\n`;
        buyAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore} | Vol: ${a.volume1h.direction} (${a.volume1h.percentage.toFixed(1)}%) | Penal: ${a.totalPenalty}\n`;
        });
        if (buyAlerts.length > 5) message += `... e mais ${buyAlerts.length - 5}\n`;
        message += '\n';
    }
    
    if (sellAlerts.length > 0) {
        message += `🔴 **VENDA** (${sellAlerts.length})\n`;
        sellAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore} | Vol: ${a.volume1h.direction} (${(100 - a.volume1h.percentage).toFixed(1)}% vendedor) | Penal: ${a.totalPenalty}\n`;
        });
        if (sellAlerts.length > 5) message += `... e mais ${sellAlerts.length - 5}\n`;
    }
    
    message += `\nAlerta Educativo, não é recomendação.</i>`;
    
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
        
        log(`Alerta agrupado enviado com ${alerts.length} sinais`, 'success');
    } catch (error) {
        log(`Erro ao enviar alerta agrupado: ${error.message}`, 'error');
    }
}

// =====================================================================
// === ANALISAR SÍMBOLO ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const [candlesDaily, candles4h, candles1h] = await Promise.all([
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100),
            getCandles(symbol, '1h', 100)
        ]);
        
        const results = [];
        
        if (candlesDaily.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            const result = await analyzeTimeframe(symbol, candlesDaily, '1d');
            if (result) results.push(result);
        }
        
        if (candles4h.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            const result = await analyzeTimeframe(symbol, candles4h, '4h');
            if (result) results.push(result);
        }
        
        if (candles1h.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            const result = await analyzeTimeframe(symbol, candles1h, '1h');
            if (result) results.push(result);
        }
        
        return results;
        
    } catch (error) {
        return [];
    }
}

// =====================================================================
// === ANALISAR TIMEFRAME (COM ANÁLISE DE REVERSÃO EM 3 MINUTOS) ===
// =====================================================================
async function analyzeTimeframe(symbol, candles, timeframe) {
    try {
        const bb = calculateBollingerBands(candles, CONFIG.BOLLINGER.PERIOD, CONFIG.BOLLINGER.STD_DEV);
        if (!bb) return null;

        const currentPrice = bb.currentPrice;
        const lastCandle = candles[candles.length - 1];

        const touchedLower = lastCandle.low <= bb.lower * 1.003;
        const touchedUpper = lastCandle.high >= bb.upper * 0.997;

        if (!touchedLower && !touchedUpper) return null;

        const bandwidth = calculateBollingerBandwidth(bb);
        if (bandwidth < CONFIG.BOLLINGER.MIN_BANDWIDTH) {
            log(`${symbol} [${timeframe}] - Bandwidth muito baixo (${bandwidth.toFixed(2)}%) - possível fakeout`, 'warning');
            return null;
        }

        // === ANÁLISE DE REVERSÃO EM 3 MINUTOS (ENTRADA ANTECIPADA) ===
        let reversalCandles = candles.slice(-10);
        let usedTimeframe = timeframe;

        if (timeframe === '1h' || timeframe === '4h' || timeframe === '1d') {
            try {
                const candles3m = await getCandles(symbol, '3m', 30);
                if (candles3m && candles3m.length >= 15) {
                    reversalCandles = candles3m.slice(-15);
                    usedTimeframe = '3m';
                    log(`${symbol} [${timeframe}] - Análise de reversão em 3m para entrada antecipada`, 'info');
                }
            } catch (error) {
                log(`${symbol} - Erro ao buscar candles 3m, usando ${timeframe}`, 'warning');
                reversalCandles = candles.slice(-10);
            }
        }

        const reversalCheck = isTrueReversal(reversalCandles, bb, touchedLower, touchedUpper);
       
        if (!reversalCheck.isReversal) {
            log(`${symbol} [${timeframe}] - tocou na banda mas SEM reversão (score: ${reversalCheck.score}/12 em ${usedTimeframe})`, 'warning');
            return null;
        }
       
        const additional = await getAdditionalData(symbol, currentPrice, touchedLower);
       
        // Verificar volatilidade em 15 minutos
        const timeframeCheck = CONFIG.ALERTS.MIN_15M_VOLATILITY.CHECK_TIMEFRAMES.includes(timeframe);
        if (timeframeCheck) {
            const volatilityCheck = await check15MinVolatility(symbol);
            if (!volatilityCheck.passed) {
                log(`${symbol} [${timeframe}] - Bloqueado por baixa volatilidade 15m: ${volatilityCheck.message}`, 'warning');
                return null;
            }
        }
       
        const volumeDirection = additional.volume1h.direction;
        const volumePercentage = additional.volume1h.percentage;
       
        if (touchedLower && volumeDirection !== 'Comprador' && CONFIG.ALERTS.VOLUME_DIRECTION.STRICT_MODE) {
            log(`${symbol} [${timeframe}] - ALERTA DE COMPRA BLOQUEADO: Volume não está comprador (${volumeDirection} - ${volumePercentage.toFixed(1)}%)`, 'warning');
            return null;
        }
       
        if (touchedUpper && volumeDirection !== 'Vendedor' && CONFIG.ALERTS.VOLUME_DIRECTION.STRICT_MODE) {
            log(`${symbol} [${timeframe}] - ALERTA DE VENDA BLOQUEADO: Volume não está vendedor (${volumeDirection} - ${(100 - volumePercentage).toFixed(1)}% vendedor)`, 'warning');
            return null;
        }
       
        const divergenceMulti = checkRSIDivergenceMultiTimeframe(additional.candlesByTimeframe);
       
        const stochValues = timeframe === '1d' ? additional.stochDailyValues :
                           (timeframe === '4h' ? additional.stoch4hValues : additional.stoch1hValues);
        const stochReversal = checkStochasticReversal(stochValues.k, stochValues.d, touchedLower);
       
        const volumeConfirmation = timeframe === '1d' ?
            additional.volume1h.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD :
            (timeframe === '4h' ?
                additional.volume1h.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD - 0.1 :
                additional.volume3m.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD - 0.2);
       
        const lsrPenalty = checkLSRPenalty(additional.lsr, touchedLower);
        const fundingPenalty = checkFundingPenalty(additional.funding, touchedLower);
       
        let confirmationScore = reversalCheck.score;
        let confirmations = [];
        let penaltyApplied = false;
        let totalPenalty = 0;
       
        if (reversalCheck.score >= 8) {
            confirmations.push('🔥🔥 Reversão EXTREMA');
        } else if (reversalCheck.score >= 6) {
            confirmations.push('🔥 Reversão muito forte');
        } else if (reversalCheck.score >= 4) {
            confirmations.push('✅ Reversão forte');
        }
       
        if (divergenceMulti.hasDivergence) {
            confirmationScore += divergenceMulti.totalScore;
           
            const divergenceLines = divergenceMulti.divergences.map(d => {
                const subtype = d.subtype === 'hidden' ? ' (oculta)' : '';
                const extreme = d.extreme ? '⚡' : '';
                return `${d.emoji} ${d.timeframe} ${d.type === 'bullish' ? 'Alta' : 'Baixa'}${subtype} ${extreme}+${d.score}`;
            }).join(' • ');
           
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
            totalPenalty += lsrPenalty.points;
            confirmations.push(lsrPenalty.message);
            penaltyApplied = true;
        }
        
        if (fundingPenalty.hasPenalty) {
            confirmationScore += fundingPenalty.points;
            totalPenalty += fundingPenalty.points;
            confirmations.push(fundingPenalty.message);
            penaltyApplied = true;
        }
        
        if (totalPenalty < CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY) {
            const excess = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY - totalPenalty;
            confirmationScore -= excess;
            totalPenalty = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY;
            log(`Penalidade total limitada a ${CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY}`, 'warning');
        }
       
        const direction = touchedLower ? 'COMPRA' : 'VENDA';
       
        if (!canSendAlert(
            symbol,
            direction,
            currentPrice,
            confirmationScore,
            additional.volume1h.ratio,
            additional.volume1h.usdt,
            additional.volume24h.usdt,
            additional.trendStrength,
            additional.rsi,
            volumeDirection,
            volumePercentage,
            timeframe
        )) {
            return null;
        }
       
        const support = touchedLower ? bb.lower * 0.98 : bb.lower;
        const resistance = touchedUpper ? bb.upper * 1.02 : bb.upper;
       
        let candlesForStop;
        if (timeframe === '1d') {
            candlesForStop = additional.candlesDaily;
        } else if (timeframe === '4h') {
            candlesForStop = additional.candles4h;
        } else {
            candlesForStop = additional.candles1h;
        }
        
        const stopLoss = calculateProtectedStopLoss(currentPrice, touchedLower, timeframe, candlesForStop, bb);
        
        const trValues = [];
        for (let i = 1; i < candlesForStop.length; i++) {
            const high = candlesForStop[i].high;
            const low = candlesForStop[i].low;
            const prevClose = candlesForStop[i-1].close;
            trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        const atr = trValues.slice(-14).reduce((a, b) => a + b, 0) / 14;
       
        let tp1, tp2, tp3;
        const atrMultiplier = timeframe === '1d' ? 2.5 : (timeframe === '4h' ? 2.0 : 1.5);
        
        if (touchedLower) {
            tp1 = currentPrice + atr * atrMultiplier;
            tp2 = currentPrice + atr * (atrMultiplier * 1.5);
            tp3 = currentPrice + atr * (atrMultiplier * 2);
        } else {
            tp1 = currentPrice - atr * atrMultiplier;
            tp2 = currentPrice - atr * (atrMultiplier * 1.5);
            tp3 = currentPrice - atr * (atrMultiplier * 2);
        }
       
        const dailyCount = dailyCounter.get(`${symbol}_daily`) || 0;
       
        log(`🎯 ${symbol} [${timeframe}] - ${direction} CONFIRMADA! Score: ${confirmationScore} (reversão em ${usedTimeframe}) | RSI: ${additional.rsi} | Bandwidth: ${bandwidth.toFixed(2)}% | Volume: ${additional.volume1h.direction} (${additional.volume1h.percentage.toFixed(1)}%) | Stop: ${formatPrice(stopLoss)} | Penalidades: ${totalPenalty}`, 'success');
       
        const alert = {
            symbol,
            timeframe,
            timeframeEmoji: timeframe === '1d' ? '📅' : (timeframe === '4h' ? '⏰' : '⏱️'),
            timeframeText: timeframe === '1d' ? '#DIÁRIO' : (timeframe === '4h' ? '#4H' : '#1H'),
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
            reversalPatterns: reversalCheck.patterns,
            divergences: divergenceMulti.divergences,
            lsrPenalty: lsrPenalty.hasPenalty,
            fundingPenalty: fundingPenalty.hasPenalty,
            totalPenalty: totalPenalty,
            lsrValue: additional.lsr,
            fundingValue: additional.funding,
            bandwidth: bandwidth,
            usedTimeframe: usedTimeframe,
            ...additional
        };
       
        queueAlert(alert);
        return alert;
       
    } catch (error) {
        log(`Erro em analyzeTimeframe ${symbol} [${timeframe}]: ${error.message}`, 'error');
        return null;
    }
}

// =====================================================================
// === FORMATAR MENSAGEM ===
// =====================================================================
function formatAlert(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbol}&interval=60`;
    
    const fundingPct = data.fundingValue ? (data.fundingValue * 100).toFixed(4) : '0.0000';
    const fundingSign = data.fundingValue && data.fundingValue > 0 ? '+' : '';
    
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '⚪';
    
    const tp1 = formatPrice(data.tp1);
    const tp2 = formatPrice(data.tp2);
    const tp3 = formatPrice(data.tp3);
    const stop = formatPrice(data.stopLoss);
    
    const lsr = data.lsrValue ? data.lsrValue.toFixed(2) : 'N/A';
    
    const volumeEmoji = data.volume1h.emoji;
    const volumeDirectionText = data.volume1h.direction !== 'Neutro' ? 
        `${volumeEmoji} ${data.volume1h.direction}` : 
        `⚪ Neutro`;
    
    const volume1hLine = `#Vol 1h: ${data.volume1h.ratioFormatted}x (${data.volume1h.percentage.toFixed(0)}%) ${volumeDirectionText}`;
    const volume3mLine = `#Vol 3m: ${data.volume3m.ratioFormatted}x (${data.volume3m.percentage.toFixed(0)}%) ${data.volume3m.text}`;
    
    let bbLines = '';
    if (data.isGreenAlert) {
        const bbDailyUpper = formatPrice(data.bbDaily.upper);
        const bb4hUpper = formatPrice(data.bb4h.upper);
        const bb1hUpper = formatPrice(data.bb1h.upper);
        const bbWeeklyUpper = formatPrice(data.bbWeekly.upper);
        bbLines = ` Superior Diário : $${bbDailyUpper}\n Superior 4H    : $${bb4hUpper}\n Superior 1H    : $${bb1hUpper}\n Superior Semanal: $${bbWeeklyUpper}`;
    } else {
        const bbDailyLower = formatPrice(data.bbDaily.lower);
        const bb4hLower = formatPrice(data.bb4h.lower);
        const bb1hLower = formatPrice(data.bb1h.lower);
        const bbWeeklyLower = formatPrice(data.bbWeekly.lower);
        bbLines = ` Inferior Diário : $${bbDailyLower}\n Inferior 4H    : $${bb4hLower}\n Inferior 1H    : $${bb1hLower}\n Inferior Semanal: $${bbWeeklyLower}`;
    }
    
    let divergenceLines = '';
    if (data.divergences && data.divergences.length > 0) {
        const divergenceTexts = data.divergences.map(d => {
            const type = d.type === 'bullish' ? '📈 Alta' : '📉 Baixa';
            const subtype = d.subtype === 'hidden' ? ' (oculta)' : '';
            const extreme = d.extreme ? '⚡' : '';
            return `${d.timeframe} ${type}${subtype}${extreme}`;
        });
        divergenceLines = `\n ⚠️ Divergências: ${divergenceTexts.join(' • ')}`;
    }
    
    let patternsLine = '';
    if (data.reversalPatterns && data.reversalPatterns.length > 0) {
        patternsLine = `\n 📊 Padrões: ${data.reversalPatterns.join(' • ')}`;
    }
    
    const confirmationsLine = `🔍 Confirmações: ${data.confirmationScore} | ${data.confirmations}`;
    const reversalScoreLine = ` Score Reversão: ${data.reversalScore}/12 (em ${data.usedTimeframe || data.timeframe})`;
    
    const lsrWarning = data.lsrPenalty ? `\n ⚠️ LSR ${data.lsrValue.toFixed(2)}` : '';
    const fundingWarning = data.fundingPenalty ? `\n ⚠️ Funding ${fundingSign}${fundingPct}%` : '';
    const totalPenaltyLine = data.totalPenalty < 0 ? `\n ⚠️ Penalidade total: ${data.totalPenalty} pontos` : '';
    
    return `<i>${data.direction} - ${symbolName} ${data.timeframeEmoji} ${data.timeframeText}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 ${confirmationsLine}
 ${reversalScoreLine}${patternsLine}${divergenceLines}${lsrWarning}${fundingWarning}${totalPenaltyLine}
 ▫️Vol 24hs: ${data.volume24h.pct} ${data.volume24h.text}
 #RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} | <a href="${tradingViewLink}">🔗 TradingView</a>
 ${volume3mLine}
 ${volume1hLine}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${formatPrice(data.resistance)} | ${formatPrice(data.bbUpper)}
 🔹Supt: ${formatPrice(data.support)} | ${formatPrice(data.bbLower)}
${bbLines}
 Alvos: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop: ${stop}
❅────────────❅
 🤖 IA Dica... ${data.isGreenAlert ? 'Observar Zonas de 🔹Suporte de Compra' : 'Realizar Lucro ou Parcial perto da 🔻Resistência.'}
 Alerta Educativo, não é recomendação de investimento.
 Titanium Prime by @J4Rviz</i>`;
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME - ATIVADO ');
    console.log('='.repeat(70));
    
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        
        const initMessage = `🚀 Titanium Prime Ativado\n\n` +
            `📊 Monitorando: ${currentTopSymbols.length} símbolos\n` +
            `⏱️ Timeframes: 1H, 4H, DIÁRIO\n` +
            `🎯 Análise de reversão em 3 MINUTOS para entradas antecipadas\n` +
            `🎯 Filtros: Volume + Divergências + Bandwidth ${CONFIG.BOLLINGER.MIN_BANDWIDTH}%\n` +
            `🛡️ Stop Loss: ATR Protegido com Zonas de Cluster\n` +
            `💰 Funding Penalty: 3 Níveis (Baixo: -2, Médio: -3, Alto: -4)\n` +
            `📈 Volatilidade Mínima 15m: ATR ${CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_ATR_PERCENT}% / BB ${CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_BB_WIDTH_PERCENT}%\n` +
            `📈 Cooldown: 1H=30min | 4H=60min | DIÁRIO=120min\n` +
            `🕐 ${getBrazilianDateTime().full}`;
        
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: initMessage,
                parse_mode: 'HTML'
            })
        });
        
        if (response.ok) {
            log('Mensagem de inicialização enviada', 'success');
        } else {
            const errorText = await response.text();
            log(`Erro ao enviar mensagem de inicialização: ${response.status} - ${errorText}`, 'warning');
        }
    } catch (e) {
        log(`Erro ao enviar mensagem de inicialização: ${e.message}`, 'warning');
    }
    
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            log('Contadores diários resetados', 'info');
        }
    }, 60000);
    
    setInterval(() => {
        processPriorityQueue();
    }, 5000);
    
    let scanCount = 0;
    
    while (true) {
        try {
            scanCount++;
            alertsSentThisScan = 0;
            
            log(`Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                
                log(`Batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)}`, 'info');
                
                await Promise.allSettled(
                    batch.map(symbol => analyzeSymbol(symbol))
                );
                
                if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            log(`Scan #${scanCount} concluído. Alertas no scan: ${alertsSentThisScan}`, 'success');
            log(`Aguardando 30s para próximo scan...`, 'info');
            
            await new Promise(r => setTimeout(r, 30000));
            
        } catch (error) {
            log(`Erro no scan: ${error.message}`, 'error');
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// =====================================================================
// === INICIAR ===
// =====================================================================
startScanner().catch(console.error);
