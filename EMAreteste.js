const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES ACELERADAS COM SEGURANÇA ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyz
        CHAT_ID: '-1002554
    },
    EMA: {
        FAST: 13,
        SLOW: 34,
        TREND: 55,
        STRONG: 144,
        SUPER1: 610,
        SUPER2: 890
    },
    MA: {
        MEDIUM: 50,
        LONG: 200
    },
    RSI: {
        PERIOD: 14,
        OVERBOUGHT: 70,
        OVERSOLD: 30
    },
    CCI: {
        PERIOD: 20,
        EMA_PERIOD: 5
    },
    VOLUME: {
        EMA_PERIOD: 9,
        MIN_BULLISH_PCT: 52,
        MIN_BEARISH_PCT: 52
    },
    TIMEFRAMES: ['1h', '4h', '1d'],
    SCAN: {
        BATCH_SIZE: 5,
        SYMBOL_DELAY_MS: 1200,
        REQUEST_TIMEOUT: 25000,
        COOLDOWN_AFTER_BATCH_MS: 3000,
        TOP_SYMBOLS_LIMIT: 350
    },
    ALERTS: {
        COOLDOWN_MINUTES: 15,
        DAILY_LIMITS: {
            TOP_10: 40,
            TOP_50: 60,
            OTHER: 80
        },
        RETEST: {
            TOUCH_TOLERANCE: 0.003,
            MIN_VOLUME_RATIO: 1.2
        },
        SUPER: {
            TOUCH_TOLERANCE: 0.005
        }
    },
    MTF: {
        ENABLED: true,
        WEIGHTS: {
            TIMEFRAME_ALIGNMENT: 0.4,
            TREND_STRENGTH: 0.3,
            VOLUME_CONFIRMATION: 0.2,
            RSI_CONFIRMATION: 0.1
        }
    },
    RATE_LIMIT: {
        MAX_REQUESTS_PER_MINUTE: 800,
        MAX_REQUESTS_PER_SECOND: 7,
        BACKOFF_MULTIPLIER: 1.5,
        MAX_BACKOFF: 20000,
        INITIAL_BACKOFF: 1000
    },
    WARMUP: {
        ENABLED: true,
        SYMBOLS: 30,
        DELAY_MS: 500
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === CACHE MELHORADO ===
// =====================================================================
class Cache {
    constructor() {
        this.cache = new Map();
        this.requestTimestamps = {
            perMinute: [],
            perSecond: []
        };
        this.warmupMode = false;
    }

    enableWarmupMode() {
        this.warmupMode = true;
    }

    disableWarmupMode() {
        this.warmupMode = false;
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        const ttl = this.getTTL(key);
        if (Date.now() - item.timestamp > ttl) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    getTTL(key) {
        if (key.includes('candles_1h')) return 45 * 1000;
        if (key.includes('candles_4h')) return 3 * 60 * 1000;
        if (key.includes('candles_1d')) return 10 * 60 * 1000;
        if (key.includes('ticker_24hr')) return 20 * 1000;
        if (key.includes('top_symbols')) return 3 * 60 * 1000;
        return 20 * 1000;
    }

    set(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    canMakeRequest() {
        const now = Date.now();
        
        this.requestTimestamps.perMinute = this.requestTimestamps.perMinute
            .filter(ts => ts > now - 60000);
        this.requestTimestamps.perSecond = this.requestTimestamps.perSecond
            .filter(ts => ts > now - 1000);
        
        const maxPerMinute = this.warmupMode ? 1000 : CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE;
        const maxPerSecond = this.warmupMode ? 10 : CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_SECOND;
        
        return this.requestTimestamps.perMinute.length < maxPerMinute &&
               this.requestTimestamps.perSecond.length < maxPerSecond;
    }

    addRequest() {
        const now = Date.now();
        this.requestTimestamps.perMinute.push(now);
        this.requestTimestamps.perSecond.push(now);
    }

    async warmup(symbols) {
        log(`🔥 Aquecendo cache com ${symbols.length} símbolos...`, 'info');
        this.enableWarmupMode();
        
        let count = 0;
        for (const symbol of symbols) {
            count++;
            await Promise.all([
                getCandles(symbol, '4h', 200, 'high').catch(() => {}),
                getCandles(symbol, '1h', 100, 'high').catch(() => {}),
                getCandles(symbol, '1d', 100, 'high').catch(() => {})
            ]);
            
            if (count % 10 === 0) {
                log(`🔥 Warmup: ${count}/${symbols.length} símbolos processados`, 'info');
            }
            
            await new Promise(r => setTimeout(r, CONFIG.WARMUP.DELAY_MS));
        }
        
        this.disableWarmupMode();
        log(`✅ Cache aquecido com sucesso!`, 'success');
    }
}

const cache = new Cache();

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
    
    if (type === 'error') console.error(`❌ ${message}`);
    else if (type === 'success') console.log(`✅ ${message}`);
    else if (type === 'warning') console.log(`⚠️ ${message}`);
    else console.log(`ℹ️ ${message}`);
    
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\n', { flag: 'a' });
}

// =====================================================================
// === EMOJIS PERSONALIZADOS ===
// =====================================================================
function getRSIEmojiCustom(rsi) {
    if (rsi < 25) return '🔵';
    if (rsi >= 26 && rsi <= 38) return '🟢';
    if (rsi >= 39 && rsi <= 45) return '🟡';
    if (rsi >= 46 && rsi <= 64) return '🟠';
    if (rsi >= 65 && rsi <= 70) return '🔴';
    if (rsi >= 71 && rsi <= 80) return '💥';
    if (rsi > 80) return '🔥🔥';
    return '⚪';
}

function getLSREmoji(lsr) {
    if (lsr < 1) return '🔵';
    if (lsr >= 1 && lsr <= 1.5) return '🟢';
    if (lsr >= 1.6 && lsr <= 2) return '🟡';
    if (lsr >= 2.1 && lsr <= 2.5) return '🟠';
    if (lsr >= 2.6 && lsr <= 2.8) return '🔴';
    if (lsr >= 2.9 && lsr <= 3.5) return '💥';
    if (lsr > 3.6) return '🔥🔥';
    return '⚪';
}

// =====================================================================
// === RATE LIMITER ACELERADO ===
// =====================================================================
class RateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.consecutiveErrors = 0;
        this.errorBackoff = CONFIG.RATE_LIMIT.INITIAL_BACKOFF;
        this.requestQueue = [];
        this.processing = false;
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            errors: 0
        };
    }

    async wait(priority = 'normal') {
        const isWarmup = cache.warmupMode;
        
        while (!cache.canMakeRequest()) {
            await new Promise(r => setTimeout(r, 50));
        }
        
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        
        let baseDelay;
        if (isWarmup) {
            baseDelay = CONFIG.WARMUP.DELAY_MS;
        } else {
            baseDelay = priority === 'high' ? 800 : 
                       priority === 'low' ? 1500 : 
                       CONFIG.SCAN.SYMBOL_DELAY_MS;
        }
        
        if (timeSinceLast < baseDelay) {
            await new Promise(r => setTimeout(r, baseDelay - timeSinceLast));
        }
        
        this.lastRequestTime = Date.now();
        cache.addRequest();
        this.stats.totalRequests++;
    }

    async makeRequest(url, cacheKey = null, priority = 'normal') {
        if (cacheKey) {
            const cached = cache.get(cacheKey);
            if (cached) {
                this.stats.cacheHits++;
                return cached;
            }
        }

        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                url,
                cacheKey,
                resolve,
                reject,
                priority,
                timestamp: Date.now(),
                attempts: 0
            });
            
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.processing) return;
        this.processing = true;

        while (this.requestQueue.length > 0) {
            this.requestQueue.sort((a, b) => {
                const priorityOrder = { 'high': 0, 'normal': 1, 'low': 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });

            const request = this.requestQueue.shift();
            
            try {
                const result = await this.executeRequest(request);
                request.resolve(result);
            } catch (error) {
                this.stats.errors++;
                
                if (request.attempts < 2 && this.isRetryableError(error)) {
                    request.attempts++;
                    const backoff = this.errorBackoff * Math.pow(CONFIG.RATE_LIMIT.BACKOFF_MULTIPLIER, request.attempts - 1);
                    log(`🔄 Reagendando ${request.url} (tentativa ${request.attempts}/2) após ${backoff}ms`, 'warning');
                    
                    setTimeout(() => {
                        this.requestQueue.push(request);
                    }, backoff);
                } else {
                    request.reject(error);
                }
            }

            await new Promise(r => setTimeout(r, 50));
        }

        this.processing = false;
    }

    async executeRequest(request) {
        let attempts = 0;
        const maxAttempts = 2;
        
        while (attempts < maxAttempts) {
            try {
                await this.wait(request.priority);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN.REQUEST_TIMEOUT);
                
                const response = await fetch(request.url, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (response.status === 429) {
                    this.consecutiveErrors++;
                    const backoff = Math.min(
                        this.errorBackoff * Math.pow(CONFIG.RATE_LIMIT.BACKOFF_MULTIPLIER, attempts),
                        CONFIG.RATE_LIMIT.MAX_BACKOFF
                    );
                    
                    log(`⏳ Rate limit (429) para ${request.url}. Aguardando ${backoff}ms`, 'warning');
                    await new Promise(r => setTimeout(r, backoff));
                    attempts++;
                    continue;
                }
                
                if (response.status === 418) {
                    log(`⚠️ IP BANIDO! Aguardando 2 minutos...`, 'error');
                    await new Promise(r => setTimeout(r, 120000));
                    throw new Error('IP temporarily banned');
                }
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                this.consecutiveErrors = 0;
                this.errorBackoff = CONFIG.RATE_LIMIT.INITIAL_BACKOFF;
                
                if (request.cacheKey) {
                    cache.set(request.cacheKey, data);
                }
                
                return data;
                
            } catch (error) {
                if (error.name === 'AbortError') {
                    log(`⏰ Timeout ${request.url}`, 'warning');
                }
                
                this.consecutiveErrors++;
                attempts++;
                
                if (attempts < maxAttempts) {
                    const backoff = Math.min(
                        this.errorBackoff * attempts,
                        CONFIG.RATE_LIMIT.MAX_BACKOFF
                    );
                    await new Promise(r => setTimeout(r, backoff));
                }
            }
        }
        
        throw new Error(`Falha após ${maxAttempts} tentativas para ${request.url}`);
    }

    isRetryableError(error) {
        const retryableMessages = [
            '429',
            'timeout',
            'ECONNRESET',
            'ETIMEDOUT',
            'socket hang up'
        ];
        
        return retryableMessages.some(msg => 
            error.message.includes(msg) || error.code?.includes(msg)
        );
    }

    showStats() {
        log(`📊 Stats: ${this.stats.totalRequests} req | ${this.stats.cacheHits} cache | ${this.stats.errors} erros`, 'info');
    }
}

const rateLimiter = new RateLimiter();

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

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return 50;
    
    const changes = [];
    for (let i = 1; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i-1].close);
    }
    
    if (changes.length < period) return 50;
    
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < period; i++) {
        const change = changes[i];
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss -= change;
        }
    }
    
    avgGain /= period;
    avgLoss /= period;
    
    for (let i = period; i < changes.length; i++) {
        const change = changes[i];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.round(rsi * 100) / 100;
}

function calculateCCI(candles, period = 20) {
    if (!candles || candles.length < period) return 0;
    
    const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const sma = calculateSMA(typicalPrices, period);
    
    const meanDeviation = typicalPrices.slice(-period).reduce((sum, tp) => {
        return sum + Math.abs(tp - sma);
    }, 0) / period;
    
    if (meanDeviation === 0) return 0;
    
    const currentTP = typicalPrices[typicalPrices.length - 1];
    const cci = (currentTP - sma) / (0.015 * meanDeviation);
    
    return cci;
}

function calculateCCIWithEMA(candles, cciPeriod = 20, emaPeriod = 5) {
    if (!candles || candles.length < cciPeriod + emaPeriod) {
        return { 
            cci: 0, 
            ema: 0, 
            direction: 'NEUTRO',
            emoji: '⚪',
            text: 'CCI: ⚪NEUTRO'
        };
    }
    
    const cciValues = [];
    for (let i = cciPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - cciPeriod + 1, i + 1);
        const cci = calculateCCI(periodCandles, cciPeriod);
        cciValues.push(cci);
    }
    
    const currentCCI = cciValues[cciValues.length - 1];
    const previousCCI = cciValues.length > 1 ? cciValues[cciValues.length - 2] : currentCCI;
    
    const emaCCI = calculateEMA(cciValues, emaPeriod);
    const previousEMA = cciValues.length > 1 ? 
        calculateEMA(cciValues.slice(0, -1), emaPeriod) : emaCCI;
    
    let direction = 'NEUTRO';
    let emoji = '⚪';
    
    if (currentCCI > emaCCI) {
        direction = 'ALTA';
        emoji = '💹';
    } else if (currentCCI < emaCCI) {
        direction = 'BAIXA';
        emoji = '🔴';
    }
    
    let crossover = null;
    if (previousCCI <= previousEMA && currentCCI > emaCCI) {
        crossover = 'ALTA';
    } else if (previousCCI >= previousEMA && currentCCI < emaCCI) {
        crossover = 'BAIXA';
    }
    
    const text = `CCI: ${emoji}${direction}`;
    
    return {
        cci: currentCCI,
        ema: emaCCI,
        previousCCI,
        previousEMA,
        crossover,
        direction,
        emoji,
        text,
        cciValue: currentCCI.toFixed(2),
        emaValue: emaCCI.toFixed(2)
    };
}

function calculateVolumeEMA(candles, period = 9) {
    if (!candles || candles.length < period) {
        return { bullish: 50, bearish: 50, emaVolume: 0, currentVolume: 0, ratio: 1 };
    }
    
    const volumes = candles.map(c => c.volume);
    const currentVolume = volumes[volumes.length - 1] || 0;
    const emaVolume = calculateEMA(volumes, period);
    
    let bullishVolume = 0;
    let bearishVolume = 0;
    let totalVolume = 0;
    
    const closes = candles.map(c => c.close);
    const emaPrice = calculateEMA(closes, period);
    
    for (let i = 0; i < candles.length; i++) {
        const volume = candles[i].volume;
        totalVolume += volume;
        
        if (candles[i].close > emaPrice) {
            bullishVolume += volume;
        } else {
            bearishVolume += volume;
        }
    }
    
    const bullishPct = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    const volumeRatio = emaVolume > 0 ? currentVolume / emaVolume : 1;
    
    return {
        bullish: bullishPct,
        bearish: 100 - bullishPct,
        emaVolume,
        currentVolume,
        ratio: volumeRatio
    };
}

function calculateStochastic(candles, kPeriod = 14, kSmooth = 3, dPeriod = 3) {
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) {
        return { k: 50, d: 50 };
    }
    
    const kRaw = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const highestHigh = Math.max(...periodCandles.map(c => c.high));
        const lowestLow = Math.min(...periodCandles.map(c => c.low));
        
        if (highestHigh - lowestLow === 0) {
            kRaw.push(50);
        } else {
            const kValue = ((candles[i].close - lowestLow) / (highestHigh - lowestLow)) * 100;
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
    
    return {
        k: kSmoothValues.length > 0 ? kSmoothValues[kSmoothValues.length - 1] : 50,
        d: dValues.length > 0 ? dValues[dValues.length - 1] : 50
    };
}

function formatStochastic(stoch) {
    const k = Math.round(stoch.k);
    const d = Math.round(stoch.d);
    
    if (k > d) {
        return `K${k}⤴️D${d}`;
    } else {
        return `K${k}⤵️D${d}`;
    }
}

// =====================================================================
// === ESTRATÉGIAS DE RETESTE ===
// =====================================================================

// 1. RETESTE MÚLTIPLO (ESCADA FIBO)
function checkMultipleEMARetest(candles) {
    if (!candles || candles.length < 200) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    
    const ema13 = calculateEMA(closes, 13);
    const ema34 = calculateEMA(closes, 34);
    const ema55 = calculateEMA(closes, 55);
    const ema144 = calculateEMA(closes, 144);
    const ema233 = calculateEMA(closes, 233);
    const ema610 = calculateEMA(closes, 610);
    const ema890 = calculateEMA(closes, 890);
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    const emas = [
        { value: ema13, name: 'EMA13', weight: 1 },
        { value: ema34, name: 'EMA34', weight: 1.5 },
        { value: ema55, name: 'EMA55', weight: 2 },
        { value: ema144, name: 'EMA144', weight: 3 },
        { value: ema233, name: 'EMA233', weight: 4 },
        { value: ema610, name: 'EMA610', weight: 6 },
        { value: ema890, name: 'EMA890', weight: 7 }
    ];
    
    const touchedEMAs = [];
    
    emas.forEach(ema => {
        if (ema.value === 0) return;
        
        if (lastCandle.close > ema.value) {
            const touching = Math.abs(lastCandle.low - ema.value) <= tolerance ||
                            (lastCandle.low <= ema.value && lastCandle.close >= ema.value);
            
            if (touching) {
                touchedEMAs.push({
                    ...ema,
                    direction: 'ALTA',
                    touchPrice: Math.min(lastCandle.low, ema.value)
                });
            }
        }
        
        if (lastCandle.close < ema.value) {
            const touching = Math.abs(lastCandle.high - ema.value) <= tolerance ||
                            (lastCandle.high >= ema.value && lastCandle.close <= ema.value);
            
            if (touching) {
                touchedEMAs.push({
                    ...ema,
                    direction: 'BAIXA',
                    touchPrice: Math.max(lastCandle.high, ema.value)
                });
            }
        }
    });
    
    if (touchedEMAs.length >= 2) {
        const totalWeight = touchedEMAs.reduce((sum, ema) => sum + ema.weight, 0);
        const avgWeight = totalWeight / touchedEMAs.length;
        const direction = touchedEMAs[0].direction;
        
        let strength = 'MODERADO';
        let emoji = '🟡';
        
        if (touchedEMAs.length >= 3 || avgWeight > 3) {
            strength = 'MUITO_FORTE';
            emoji = '💥';
        } else if (touchedEMAs.length >= 2 && avgWeight > 2) {
            strength = 'FORTE';
            emoji = '🔴🔥';
        }
        
        const emaNames = touchedEMAs.map(e => e.name).join(' | ');
        
        return {
            signal: 'RETESTE_MULTIPLO',
            type: direction === 'ALTA' ? 'MULTIPLO_ALTA' : 'MULTIPLO_BAIXA',
            direction,
            touchedEMAs,
            emaNames,
            count: touchedEMAs.length,
            totalWeight,
            avgWeight,
            strength,
            emoji,
            directionEmoji: direction === 'ALTA' ? '🟢🔄' : '🔴🔄',
            ema13,
            ema34,
            ema55,
            ema144,
            ema233,
            ema610,
            ema890
        };
    }
    
    return { signal: null };
}

// 2. RETESTE COM DIVERGÊNCIA OCULTA
function checkHiddenDivergenceRetest(candles) {
    if (!candles || candles.length < 50) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const lastCandle = candles[candles.length - 1];
    
    const ema55 = calculateEMA(closes, 55);
    const ema144 = calculateEMA(closes, 144);
    
    const rsiValues = [];
    for (let i = 20; i < candles.length; i++) {
        rsiValues.push(calculateRSI(candles.slice(i-14, i), 14));
    }
    
    if (rsiValues.length < 10) return { signal: null };
    
    const recentRSI = rsiValues.slice(-10);
    const recentLows = lows.slice(-10);
    const recentHighs = highs.slice(-10);
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    if (lastCandle.low > recentLows[0] * 0.98) {
        const touchingEMA55 = Math.abs(lastCandle.low - ema55) <= tolerance ||
                             (lastCandle.low <= ema55 && lastCandle.close >= ema55);
        
        const rsiLower = recentRSI[recentRSI.length - 1] < Math.min(...recentRSI.slice(0, 5));
        
        if (touchingEMA55 && rsiLower) {
            return {
                signal: 'RETESTE_DIVERGENCIA_OCULTA',
                type: 'DIVERGENCIA_OCULTA_ALTA',
                ema: 'EMA55',
                emaValue: ema55,
                strength: 'FORTE',
                emoji: '🔄🟢',
                directionEmoji: '🔄🟢',
                direction: 'ALTA',
                description: 'Reteste com divergência oculta de alta',
                ema55,
                ema144
            };
        }
    }
    
    if (lastCandle.high < recentHighs[0] * 1.02) {
        const touchingEMA144 = Math.abs(lastCandle.high - ema144) <= tolerance ||
                              (lastCandle.high >= ema144 && lastCandle.close <= ema144);
        
        const rsiHigher = recentRSI[recentRSI.length - 1] > Math.max(...recentRSI.slice(0, 5));
        
        if (touchingEMA144 && rsiHigher) {
            return {
                signal: 'RETESTE_DIVERGENCIA_OCULTA',
                type: 'DIVERGENCIA_OCULTA_BAIXA',
                ema: 'EMA144',
                emaValue: ema144,
                strength: 'FORTE',
                emoji: '🔄🔴',
                directionEmoji: '🔄🔴',
                direction: 'BAIXA',
                description: 'Reteste com divergência oculta de baixa',
                ema55,
                ema144
            };
        }
    }
    
    return { signal: null };
}

// 3. RETESTE COM VOLUME DELTA
function checkVolumeDeltaRetest(candles) {
    if (!candles || candles.length < 30) return { signal: null };
    
    const lastCandle = candles[candles.length - 1];
    
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    
    const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volumeRatio20 = lastCandle.volume / avgVolume20;
    
    const candleRange = lastCandle.high - lastCandle.low;
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const upperWick = lastCandle.high - Math.max(lastCandle.close, lastCandle.open);
    const lowerWick = Math.min(lastCandle.close, lastCandle.open) - lastCandle.low;
    
    let buyPressure = 0;
    let sellPressure = 0;
    
    if (lastCandle.close > lastCandle.open) {
        buyPressure = (bodySize / candleRange) * lastCandle.volume;
        sellPressure = ((upperWick + lowerWick) / candleRange) * lastCandle.volume;
    } else {
        sellPressure = (bodySize / candleRange) * lastCandle.volume;
        buyPressure = ((upperWick + lowerWick) / candleRange) * lastCandle.volume;
    }
    
    const delta = buyPressure - sellPressure;
    const deltaRatio = Math.abs(delta) / lastCandle.volume;
    
    const ema55 = calculateEMA(closes, 55);
    const ema144 = calculateEMA(closes, 144);
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    if (volumeRatio20 > CONFIG.ALERTS.RETEST.MIN_VOLUME_RATIO) {
        if (lastCandle.close > ema55) {
            const touchingEMA = Math.abs(lastCandle.low - ema55) <= tolerance ||
                               (lastCandle.low <= ema55 && lastCandle.close >= ema55);
            
            if (touchingEMA && delta > 0 && deltaRatio > 0.3) {
                return {
                    signal: 'RETESTE_VOLUME_DELTA',
                    type: 'VOLUME_DELTA_ALTA',
                    ema: 'EMA55',
                    emaValue: ema55,
                    volumeRatio: volumeRatio20,
                    delta: delta,
                    deltaRatio: deltaRatio,
                    strength: volumeRatio20 > 1.5 ? 'EXPLOSIVO' : 'FORTE',
                    emoji: '📊🟢',
                    directionEmoji: '📊🟢',
                    direction: 'ALTA',
                    ema55,
                    ema144
                };
            }
        }
        
        if (lastCandle.close < ema144) {
            const touchingEMA = Math.abs(lastCandle.high - ema144) <= tolerance ||
                               (lastCandle.high >= ema144 && lastCandle.close <= ema144);
            
            if (touchingEMA && delta < 0 && deltaRatio > 0.3) {
                return {
                    signal: 'RETESTE_VOLUME_DELTA',
                    type: 'VOLUME_DELTA_BAIXA',
                    ema: 'EMA144',
                    emaValue: ema144,
                    volumeRatio: volumeRatio20,
                    delta: delta,
                    deltaRatio: deltaRatio,
                    strength: volumeRatio20 > 1.5 ? 'EXPLOSIVO' : 'FORTE',
                    emoji: '📊🔴',
                    directionEmoji: '📊🔴',
                    direction: 'BAIXA',
                    ema55,
                    ema144
                };
            }
        }
    }
    
    return { signal: null };
}

// 4. RETESTE DE EXAUSTÃO
function checkExhaustionRetest(candles) {
    if (!candles || candles.length < 30) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    
    const ema13 = calculateEMA(closes, 13);
    const ema34 = calculateEMA(closes, 34);
    const ema55 = calculateEMA(closes, 55);
    
    const rsi = calculateRSI(candles.slice(-15), 14);
    
    const last5Candles = candles.slice(-5);
    const avgRange = last5Candles.reduce((sum, c) => sum + (c.high - c.low), 0) / 5;
    const currentRange = lastCandle.high - lastCandle.low;
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    const isSmallCandle = currentRange < avgRange * 0.7;
    
    let trendCount = 0;
    for (let i = candles.length - 6; i < candles.length - 1; i++) {
        if (i < 0) continue;
        if (candles[i].close > candles[i].open) {
            trendCount++;
        } else {
            trendCount--;
        }
    }
    
    const strongPrevTrend = trendCount >= 4 ? 'ALTA' : (trendCount <= -4 ? 'BAIXA' : null);
    
    if (strongPrevTrend === 'ALTA' && isSmallCandle && rsi > 70) {
        const touchingEMA13 = Math.abs(lastCandle.low - ema13) <= tolerance ||
                             (lastCandle.low <= ema13 && lastCandle.close >= ema13);
        
        if (touchingEMA13) {
            return {
                signal: 'RETESTE_EXAUSTAO',
                type: 'EXAUSTAO_ALTA',
                ema: 'EMA13',
                emaValue: ema13,
                rsi: rsi,
                strength: 'EXAUSTÃO',
                emoji: '😮‍💨🟢',
                directionEmoji: '😮‍💨🟢',
                direction: 'ALTA',
                description: 'Possível reversão após exaustão',
                ema13,
                ema34,
                ema55
            };
        }
    }
    
    if (strongPrevTrend === 'BAIXA' && isSmallCandle && rsi < 30) {
        const touchingEMA13 = Math.abs(lastCandle.high - ema13) <= tolerance ||
                             (lastCandle.high >= ema13 && lastCandle.close <= ema13);
        
        if (touchingEMA13) {
            return {
                signal: 'RETESTE_EXAUSTAO',
                type: 'EXAUSTAO_BAIXA',
                ema: 'EMA13',
                emaValue: ema13,
                rsi: rsi,
                strength: 'EXAUSTÃO',
                emoji: '😮‍💨🔴',
                directionEmoji: '😮‍💨🔴',
                direction: 'BAIXA',
                description: 'Possível reversão após exaustão',
                ema13,
                ema34,
                ema55
            };
        }
    }
    
    return { signal: null };
}

// 5. RETESTE COM LIQUIDEZ (STOCH RSI)
function checkLiquidityRetest(candles) {
    if (!candles || candles.length < 30) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    
    const ema55 = calculateEMA(closes, 55);
    const ema144 = calculateEMA(closes, 144);
    const ema233 = calculateEMA(closes, 233);
    
    const rsiValues = [];
    for (let i = 14; i < candles.length; i++) {
        rsiValues.push(calculateRSI(candles.slice(i-14, i), 14));
    }
    
    if (rsiValues.length < 14) return { signal: null };
    
    const recentRSI = rsiValues.slice(-14);
    const minRSI = Math.min(...recentRSI);
    const maxRSI = Math.max(...recentRSI);
    const currentRSI = recentRSI[recentRSI.length - 1];
    
    const stochRSI = maxRSI > minRSI ? ((currentRSI - minRSI) / (maxRSI - minRSI)) * 100 : 50;
    
    const emas = [
        { value: ema55, name: 'EMA55', priority: 1 },
        { value: ema144, name: 'EMA144', priority: 2 },
        { value: ema233, name: 'EMA233', priority: 3 }
    ];
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    const isLiquidityZone = stochRSI < 20 || stochRSI > 80;
    const zoneType = stochRSI < 20 ? 'COMPRA' : (stochRSI > 80 ? 'VENDA' : 'NEUTRO');
    
    if (isLiquidityZone) {
        for (const ema of emas) {
            if (ema.value === 0) continue;
            
            if (zoneType === 'COMPRA' && lastCandle.close > ema.value) {
                const touching = Math.abs(lastCandle.low - ema.value) <= tolerance ||
                                (lastCandle.low <= ema.value && lastCandle.close >= ema.value);
                
                if (touching) {
                    const liquidityLevel = stochRSI < 10 ? 'EXTREMO' : 'ALTO';
                    const emoji = stochRSI < 10 ? '💧💧' : '💧';
                    
                    return {
                        signal: 'RETESTE_LIQUIDEZ',
                        type: 'LIQUIDEZ_COMPRA',
                        ema: ema.name,
                        emaValue: ema.value,
                        stochRSI: stochRSI,
                        zone: 'OVERSOLD',
                        liquidityLevel,
                        priority: ema.priority,
                        strength: ema.priority === 1 ? 'ALTISSIMA' : 'ALTA',
                        emoji,
                        directionEmoji: emoji,
                        direction: 'ALTA',
                        ema55,
                        ema144,
                        ema233
                    };
                }
            }
            
            if (zoneType === 'VENDA' && lastCandle.close < ema.value) {
                const touching = Math.abs(lastCandle.high - ema.value) <= tolerance ||
                                (lastCandle.high >= ema.value && lastCandle.close <= ema.value);
                
                if (touching) {
                    const liquidityLevel = stochRSI > 90 ? 'EXTREMO' : 'ALTO';
                    const emoji = stochRSI > 90 ? '🔥🔥' : '🔥';
                    
                    return {
                        signal: 'RETESTE_LIQUIDEZ',
                        type: 'LIQUIDEZ_VENDA',
                        ema: ema.name,
                        emaValue: ema.value,
                        stochRSI: stochRSI,
                        zone: 'OVERBOUGHT',
                        liquidityLevel,
                        priority: ema.priority,
                        strength: ema.priority === 1 ? 'ALTISSIMA' : 'ALTA',
                        emoji,
                        directionEmoji: emoji,
                        direction: 'BAIXA',
                        ema55,
                        ema144,
                        ema233
                    };
                }
            }
        }
    }
    
    return { signal: null };
}

// 6. RETESTE CLÁSSICO ORIGINAL
function checkRetestCriteria(candles, timeframe) {
    if (!candles || candles.length < CONFIG.EMA.SUPER2 + 10) {
        return { signal: null, type: null };
    }
    
    const closes = candles.map(c => c.close);
    const currentClose = closes[closes.length - 1];
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    const ema13 = calculateEMA(closes, CONFIG.EMA.FAST);
    const ema55 = calculateEMA(closes, CONFIG.EMA.TREND);
    const ema144 = calculateEMA(closes, CONFIG.EMA.STRONG);
    const ema233 = calculateEMA(closes, 233);
    
    const tolerance = currentClose * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    let signal = null;
    let type = null;
    let touchedEMA = null;
    let emaValue = null;
    
    if (currentClose > ema55 && lastCandle.close < prevCandle.close) {
        const touchingEMA13 = Math.abs(lastCandle.low - ema13) <= tolerance || (lastCandle.low <= ema13 && lastCandle.close >= ema13);
        const touchingEMA144 = Math.abs(lastCandle.low - ema144) <= tolerance || (lastCandle.low <= ema144 && lastCandle.close >= ema144);
        const touchingEMA233 = Math.abs(lastCandle.low - ema233) <= tolerance || (lastCandle.low <= ema233 && lastCandle.close >= ema233);
        
        if (touchingEMA13) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : (timeframe === '1d' ? 'RETESTE_ALTA_1D' : 'RETESTE_ALTA_1H');
            touchedEMA = 'EMA13';
            emaValue = ema13;
        } else if (touchingEMA144) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : (timeframe === '1d' ? 'RETESTE_ALTA_1D' : 'RETESTE_ALTA_1H');
            touchedEMA = 'EMA144';
            emaValue = ema144;
        } else if (touchingEMA233) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : (timeframe === '1d' ? 'RETESTE_ALTA_1D' : 'RETESTE_ALTA_1H');
            touchedEMA = 'EMA233';
            emaValue = ema233;
        }
    }
    
    if (currentClose < ema55 && lastCandle.close > prevCandle.close) {
        if (timeframe === '1h') {
            const touchingEMA55 = Math.abs(lastCandle.high - ema55) <= tolerance || (lastCandle.high >= ema55 && lastCandle.close <= ema55);
            if (touchingEMA55) {
                signal = 'RETESTE_BAIXA';
                type = 'RETESTE_BAIXA_1H';
                touchedEMA = 'EMA55';
                emaValue = ema55;
            }
        } else {
            const touchingEMA13 = Math.abs(lastCandle.high - ema13) <= tolerance || (lastCandle.high >= ema13 && lastCandle.close <= ema13);
            const touchingEMA144 = Math.abs(lastCandle.high - ema144) <= tolerance || (lastCandle.high >= ema144 && lastCandle.close <= ema144);
            const touchingEMA233 = Math.abs(lastCandle.high - ema233) <= tolerance || (lastCandle.high >= ema233 && lastCandle.close <= ema233);
            
            if (touchingEMA13) {
                signal = 'RETESTE_BAIXA';
                type = timeframe === '4h' ? 'RETESTE_BAIXA_4H' : (timeframe === '1d' ? 'RETESTE_BAIXA_1D' : 'RETESTE_BAIXA_1H');
                touchedEMA = 'EMA13';
                emaValue = ema13;
            } else if (touchingEMA144) {
                signal = 'RETESTE_BAIXA';
                type = timeframe === '4h' ? 'RETESTE_BAIXA_4H' : (timeframe === '1d' ? 'RETESTE_BAIXA_1D' : 'RETESTE_BAIXA_1H');
                touchedEMA = 'EMA144';
                emaValue = ema144;
            } else if (touchingEMA233) {
                signal = 'RETESTE_BAIXA';
                type = timeframe === '4h' ? 'RETESTE_BAIXA_4H' : (timeframe === '1d' ? 'RETESTE_BAIXA_1D' : 'RETESTE_BAIXA_1H');
                touchedEMA = 'EMA233';
                emaValue = ema233;
            }
        }
    }
    
    return {
        signal,
        type,
        touchedEMA,
        emaValue,
        currentClose,
        ema13,
        ema55,
        ema144,
        ema233,
        isCorrection: lastCandle.close < prevCandle.close,
        isRecovery: lastCandle.close > prevCandle.close
    };
}

// =====================================================================
// === ESTRATÉGIAS MA50 E MA200 ===
// =====================================================================

// 7. RETESTE DA MA50
function checkMA50Retest(candles) {
    if (!candles || candles.length < 100) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    
    const ma50 = calculateSMA(closes, 50);
    const ema55 = calculateEMA(closes, 55);
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    const alinhado = Math.abs(ma50 - ema55) / ma50 < 0.01;
    
    if (lastCandle.close > ma50) {
        const touchingMA50 = Math.abs(lastCandle.low - ma50) <= tolerance ||
                             (lastCandle.low <= ma50 && lastCandle.close >= ma50);
        
        if (touchingMA50) {
            return {
                signal: 'RETESTE_MA50',
                type: 'MA50_ALTA',
                ma50: ma50,
                ema55: ema55,
                alinhado: alinhado,
                direction: 'ALTA',
                directionEmoji: '🔷🟢',
                description: alinhado ? 
                    'Reteste da MA50 alinhada com EMA55' : 
                    'Reteste da MA50 (divergente da EMA55)',
                strength: alinhado ? 'FORTE' : 'MÉDIO',
                emoji: alinhado ? '🔷' : '📊'
            };
        }
    }
    
    if (lastCandle.close < ma50) {
        const touchingMA50 = Math.abs(lastCandle.high - ma50) <= tolerance ||
                             (lastCandle.high >= ma50 && lastCandle.close <= ma50);
        
        if (touchingMA50) {
            return {
                signal: 'RETESTE_MA50',
                type: 'MA50_BAIXA',
                ma50: ma50,
                ema55: ema55,
                alinhado: alinhado,
                direction: 'BAIXA',
                directionEmoji: '🔷🔴',
                description: alinhado ? 
                    'Reteste da MA50 alinhada com EMA55' : 
                    'Reteste da MA50 (divergente da EMA55)',
                strength: alinhado ? 'FORTE' : 'MÉDIO',
                emoji: alinhado ? '🔷' : '📊'
            };
        }
    }
    
    return { signal: null };
}

// 8. RETESTE DA MA200 (INSTITUCIONAL)
function checkMA200Retest(candles) {
    if (!candles || candles.length < 250) return { signal: null };
    
    const closes = candles.map(c => c.close);
    const lastCandle = candles[candles.length - 1];
    
    const ma200 = calculateSMA(closes, 200);
    const ema55 = calculateEMA(closes, 55);
    const ema144 = calculateEMA(closes, 144);
    const ema233 = calculateEMA(closes, 233);
    
    const tolerance = lastCandle.close * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    const tendenciaLP = lastCandle.close > ma200 ? 'ALTA' : 'BAIXA';
    
    let emasAlinhadas = 0;
    if (ema55 > ma200) emasAlinhadas++;
    if (ema144 > ma200) emasAlinhadas++;
    if (ema233 > ma200) emasAlinhadas++;
    
    const alinhamentoEMAs = emasAlinhadas >= 2 ? 'ALINHADAS' : 'DIVERGENTES';
    
    if (lastCandle.close > ma200) {
        const touchingMA200 = Math.abs(lastCandle.low - ma200) <= tolerance ||
                              (lastCandle.low <= ma200 && lastCandle.close >= ma200);
        
        if (touchingMA200) {
            return {
                signal: 'RETESTE_MA200',
                type: 'MA200_ALTA',
                ma200: ma200,
                ema55: ema55,
                ema144: ema144,
                ema233: ema233,
                tendenciaLP: tendenciaLP,
                emasAlinhadas: alinhamentoEMAs,
                qtdEMAsAlinhadas: emasAlinhadas,
                direction: 'ALTA',
                directionEmoji: '🏦🟢',
                description: `RETESTE DA MA200 - SUPORTE INSTITUCIONAL`,
                strength: 'INSTITUCIONAL',
                emoji: '🏦'
            };
        }
    }
    
    if (lastCandle.close < ma200) {
        const touchingMA200 = Math.abs(lastCandle.high - ma200) <= tolerance ||
                              (lastCandle.high >= ma200 && lastCandle.close <= ma200);
        
        if (touchingMA200) {
            return {
                signal: 'RETESTE_MA200',
                type: 'MA200_BAIXA',
                ma200: ma200,
                ema55: ema55,
                ema144: ema144,
                ema233: ema233,
                tendenciaLP: tendenciaLP,
                emasAlinhadas: alinhamentoEMAs,
                qtdEMAsAlinhadas: emasAlinhadas,
                direction: 'BAIXA',
                directionEmoji: '🏦🔴',
                description: `RETESTE DA MA200 - RESISTÊNCIA INSTITUCIONAL`,
                strength: 'INSTITUCIONAL',
                emoji: '🏦'
            };
        }
    }
    
    return { signal: null };
}

// =====================================================================
// === ANÁLISE MULTI-TIMEFRAME ===
// =====================================================================
async function checkMultiTimeframeAlignment(symbol, currentPrice) {
    try {
        const [candles15m, candles1h, candles4h, candles1d] = await Promise.allSettled([
            getCandles(symbol, '15m', 100, 'low'),
            getCandles(symbol, '1h', 100, 'low'),
            getCandles(symbol, '4h', 100, 'low'),
            getCandles(symbol, '1d', 100, 'low')
        ]);
        
        let alignment = 'MISTO';
        let score = 3;
        let trends = ['NEUTRO', 'NEUTRO', 'NEUTRO', 'NEUTRO'];
        
        if (candles15m.status === 'fulfilled' && candles15m.value.length > 30) {
            const closes15m = candles15m.value.map(c => c.close);
            const ema20_15m = calculateEMA(closes15m, 20);
            const currentClose15m = closes15m[closes15m.length - 1];
            trends[0] = currentClose15m > ema20_15m ? 'ALTA' : 'BAIXA';
        }
        
        if (candles1h.status === 'fulfilled' && candles1h.value.length > 30) {
            const closes1h = candles1h.value.map(c => c.close);
            const ema20_1h = calculateEMA(closes1h, 20);
            const currentClose1h = closes1h[closes1h.length - 1];
            trends[1] = currentClose1h > ema20_1h ? 'ALTA' : 'BAIXA';
        }
        
        if (candles4h.status === 'fulfilled' && candles4h.value.length > 30) {
            const closes4h = candles4h.value.map(c => c.close);
            const ema20_4h = calculateEMA(closes4h, 20);
            const currentClose4h = closes4h[closes4h.length - 1];
            trends[2] = currentClose4h > ema20_4h ? 'ALTA' : 'BAIXA';
        }
        
        if (candles1d.status === 'fulfilled' && candles1d.value.length > 30) {
            const closes1d = candles1d.value.map(c => c.close);
            const ema20_1d = calculateEMA(closes1d, 20);
            const currentClose1d = closes1d[closes1d.length - 1];
            trends[3] = currentClose1d > ema20_1d ? 'ALTA' : 'BAIXA';
        }
        
        const allSameTrend = trends.every(t => t === 'ALTA') || trends.every(t => t === 'BAIXA');
        
        if (allSameTrend) {
            alignment = trends[0] === 'ALTA' ? 'ALTA_FORTE' : 'BAIXA_FORTE';
            score = 9;
        } else {
            const altaCount = trends.filter(t => t === 'ALTA').length;
            if (altaCount >= 3) {
                alignment = 'ALTA_FORTE';
                score = 8;
            } else if (altaCount >= 2) {
                alignment = 'ALTA_MEDIA';
                score = 6;
            } else if (altaCount <= 1) {
                alignment = 'BAIXA_MEDIA';
                score = 6;
            }
        }
        
        return {
            alignment,
            score,
            trends,
            mtfBar: '█'.repeat(Math.min(10, score)) + '░'.repeat(10 - Math.min(10, score))
        };
        
    } catch (error) {
        return {
            alignment: 'MISTO',
            score: 3,
            trends: ['NEUTRO', 'NEUTRO', 'NEUTRO', 'NEUTRO'],
            mtfBar: '███░░░░░░░'
        };
    }
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 1000, priority = 'normal') {
    try {
        const cacheKey = `candles_${symbol}_${interval}_${limit}`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        const data = await rateLimiter.makeRequest(url, cacheKey, priority);
        
        return data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
    } catch (error) {
        log(`Erro ao buscar candles ${symbol} ${interval}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === DADOS ADICIONAIS ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice) {
    try {
        const [candles1h, candles4h, candlesDaily, ticker24h] = await Promise.allSettled([
            getCandles(symbol, '1h', 100, 'high'),
            getCandles(symbol, '4h', 100, 'high'),
            getCandles(symbol, '1d', 60, 'high'),
            rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, `ticker_${symbol}`, 'high')
        ]);
        
        const volume24hUSDT = ticker24h.status === 'fulfilled' ? parseFloat(ticker24h.value?.quoteVolume || 0) : 0;
        const priceChange24h = ticker24h.status === 'fulfilled' ? parseFloat(ticker24h.value?.priceChangePercent || 0) : 0;
        
        const volume1h = candles1h.status === 'fulfilled' ? calculateVolumeEMA(candles1h.value, CONFIG.VOLUME.EMA_PERIOD) : { bullish: 50, bearish: 50, ratio: 1 };
        
        const rsi = candles1h.status === 'fulfilled' ? calculateRSI(candles1h.value, CONFIG.RSI.PERIOD) : 50;
        const rsiEmoji = getRSIEmojiCustom(rsi);
        
        const stochDaily = candlesDaily.status === 'fulfilled' ? calculateStochastic(candlesDaily.value) : { k: 50, d: 50 };
        const stoch4h = candles4h.status === 'fulfilled' ? calculateStochastic(candles4h.value) : { k: 50, d: 50 };
        
        const cciDaily = candlesDaily.status === 'fulfilled' ? 
            calculateCCIWithEMA(candlesDaily.value, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD) : 
            { text: 'CCI: ⚪NEUTRO', emoji: '⚪' };
        
        let lsr = null;
        try {
            const lsrData = await rateLimiter.makeRequest(
                `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`,
                `lsr_${symbol}`,
                'low'
            );
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(
                `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
                `funding_${symbol}`,
                'low'
            );
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        
        let volumeRatio1h = volume1h.ratio;
        let volumeUSDT1h = 0;
        let volumeRatio3m = 1;
        let volume3mData = { bullish: 50, bearish: 50, ratio: 1 };
        
        if (candles1h.status === 'fulfilled') {
            const volumes1h = candles1h.value.map(c => c.volume);
            const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
            const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
            volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
            volumeUSDT1h = currentVolume1h * currentPrice;
        }
        
        try {
            const volumes3m = await getCandles(symbol, '3m', 20, 'low');
            volume3mData = calculateVolumeEMA(volumes3m, CONFIG.VOLUME.EMA_PERIOD);
            const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
            const currentVolume3m = volumes3m[volumes3m.length - 1]?.volume || 0;
            volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        } catch {}
        
        return {
            volume24h: {
                usdt: volume24hUSDT,
                change: priceChange24h,
                pct: priceChange24h > 0 ? `+${priceChange24h.toFixed(0)}%` : `${priceChange24h.toFixed(0)}%`
            },
            volume1h: {
                ratio: volumeRatio1h,
                bullish: volume1h.bullish,
                bearish: volume1h.bearish,
                direction: volume1h.bullish > CONFIG.VOLUME.MIN_BULLISH_PCT ? 'Comprador' : (volume1h.bearish > CONFIG.VOLUME.MIN_BEARISH_PCT ? 'Vendedor' : 'Neutro'),
                usdt: volumeUSDT1h,
                pct: volume1h.bullish.toFixed(0)
            },
            volume3m: {
                ratio: volumeRatio3m,
                bullish: volume3mData.bullish,
                bearish: volume3mData.bearish,
                direction: volume3mData.bullish > CONFIG.VOLUME.MIN_BULLISH_PCT ? 'Comprador' : (volume3mData.bearish > CONFIG.VOLUME.MIN_BEARISH_PCT ? 'Vendedor' : 'Neutro'),
                pct: volume3mData.bullish.toFixed(0)
            },
            rsi: Math.round(rsi),
            rsiEmoji,
            stoch1d: formatStochastic(stochDaily),
            stoch4h: formatStochastic(stoch4h),
            lsr,
            funding,
            cciText: cciDaily.text,
            cciEmoji: cciDaily.emoji,
            symbolFull: symbol
        };
    } catch (error) {
        log(`Erro ao buscar dados adicionais para ${symbol}: ${error.message}`, 'error');
        return {
            volume24h: { usdt: 0, change: 0, pct: '0%' },
            volume1h: { ratio: 1, bullish: 50, bearish: 50, direction: 'Neutro', usdt: 0, pct: '50' },
            volume3m: { ratio: 1, bullish: 50, bearish: 50, direction: 'Neutro', pct: '50' },
            rsi: 50,
            rsiEmoji: '⚪',
            stoch1d: 'K50⤵️D50',
            stoch4h: 'K50⤵️D50',
            lsr: null,
            funding: null,
            cciText: 'CCI: ⚪NEUTRO',
            cciEmoji: '⚪',
            symbolFull: symbol
        };
    }
}

// =====================================================================
// === ALERTAS ===
// =====================================================================
const alertCache = new Map();
const dailyCounter = new Map();
let currentTopSymbols = [];

async function getTopSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/ticker/24hr',
            'top_symbols_24h',
            'high'
        );
        
        return data
            .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.volume) > 0)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
    } catch (e) {
        log('Erro ao buscar top symbols, usando lista padrão', 'warning');
        return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT'];
    }
}

function getSymbolCategory(symbol) {
    const top10 = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'];
    if (top10.includes(symbol)) return 'TOP_10';
    
    const rank = currentTopSymbols.indexOf(symbol);
    if (rank !== -1 && rank < 50) return 'TOP_50';
    return 'OTHER';
}

function canSendAlert(symbol, timeframe, type) {
    const now = Date.now();
    const key = `${symbol}_${timeframe}_${type}`;
    const dailyKey = `${symbol}_daily`;
    
    const lastAlert = alertCache.get(key);
    if (lastAlert) {
        const minutesDiff = (now - lastAlert) / (1000 * 60);
        if (minutesDiff < CONFIG.ALERTS.COOLDOWN_MINUTES) {
            return false;
        }
    }
    
    const category = getSymbolCategory(symbol);
    const dailyLimit = CONFIG.ALERTS.DAILY_LIMITS[category] || 80;
    const dailyCount = dailyCounter.get(dailyKey) || 0;
    
    return dailyCount < dailyLimit;
}

function registerAlert(symbol, timeframe, type) {
    const now = Date.now();
    const key = `${symbol}_${timeframe}_${type}`;
    const dailyKey = `${symbol}_daily`;
    
    alertCache.set(key, now);
    dailyCounter.set(dailyKey, (dailyCounter.get(dailyKey) || 0) + 1);
    
    log(`Registrado alerta ${symbol} ${type} [${timeframe}] #${dailyCounter.get(dailyKey)} do dia`, 'success');
}

// =====================================================================
// === ANALISAR SÍMBOLO ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const tickerData = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`,
            `price_${symbol}`,
            'high'
        );
        const currentPrice = parseFloat(tickerData.price);
        
        const mtfAnalysis = await checkMultiTimeframeAlignment(symbol, currentPrice);
        
        const results = [];
        
        for (const timeframe of CONFIG.TIMEFRAMES) {
            await new Promise(r => setTimeout(r, 300));
            
            const candles = await getCandles(symbol, timeframe, 1000, 'normal');
            
            if (candles.length < 250) continue;
            
            const candles1h = await getCandles(symbol, '1h', 100, 'high');
            const volumeData = calculateVolumeEMA(candles1h, CONFIG.VOLUME.EMA_PERIOD);
            const volumeDirection = volumeData.bullish > CONFIG.VOLUME.MIN_BULLISH_PCT ? 'COMPRADOR' : 
                                   (volumeData.bearish > CONFIG.VOLUME.MIN_BEARISH_PCT ? 'VENDEDOR' : 'NEUTRO');
            
            let cciDirection = null;
            let cciEmoji = '';
            
            if (timeframe === '1h') {
                const candles1h = await getCandles(symbol, '1h', 100, 'high');
                const cciAnalysis = calculateCCIWithEMA(candles1h, 20, 5);
                cciDirection = cciAnalysis.direction;
                cciEmoji = cciAnalysis.emoji;
            } else {
                const cciAnalysis = calculateCCIWithEMA(candles, 20, 5);
                cciDirection = cciAnalysis.direction;
                cciEmoji = cciAnalysis.emoji;
            }
            
            // 1. Reteste Múltiplo
            const multipleRetest = checkMultipleEMARetest(candles);
            if (multipleRetest.signal) {
                const volumeOk = (multipleRetest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (multipleRetest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (multipleRetest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (multipleRetest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, multipleRetest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_MULTIPLO',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: multipleRetest.directionEmoji,
                        directionText: `RETESTE MÚLTIPLO (${multipleRetest.count} EMAs)`,
                        price: currentPrice,
                        emaNames: multipleRetest.emaNames,
                        count: multipleRetest.count,
                        strength: multipleRetest.strength,
                        strategyEmoji: multipleRetest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ema13: multipleRetest.ema13,
                        ema34: multipleRetest.ema34,
                        ema55: multipleRetest.ema55,
                        ema144: multipleRetest.ema144,
                        ema233: multipleRetest.ema233,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, multipleRetest.type);
                    results.push(alert);
                }
            }
            
            // 2. Divergência Oculta
            const hiddenDivRetest = checkHiddenDivergenceRetest(candles);
            if (hiddenDivRetest.signal) {
                const volumeOk = (hiddenDivRetest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (hiddenDivRetest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (hiddenDivRetest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (hiddenDivRetest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, hiddenDivRetest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_DIVERGENCIA_OCULTA',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: hiddenDivRetest.directionEmoji,
                        directionText: `DIVERGÊNCIA OCULTA DE ${hiddenDivRetest.direction}`,
                        price: currentPrice,
                        ema: hiddenDivRetest.ema,
                        emaValue: hiddenDivRetest.emaValue,
                        description: hiddenDivRetest.description,
                        strategyEmoji: hiddenDivRetest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ema55: hiddenDivRetest.ema55,
                        ema144: hiddenDivRetest.ema144,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, hiddenDivRetest.type);
                    results.push(alert);
                }
            }
            
            // 3. Volume Delta
            const volumeDeltaRetest = checkVolumeDeltaRetest(candles);
            if (volumeDeltaRetest.signal) {
                const volumeOk = (volumeDeltaRetest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (volumeDeltaRetest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (volumeDeltaRetest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (volumeDeltaRetest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, volumeDeltaRetest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_VOLUME_DELTA',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: volumeDeltaRetest.directionEmoji,
                        directionText: `VOLUME DELTA ${volumeDeltaRetest.direction === 'ALTA' ? 'COMPRA' : 'VENDA'} ${volumeDeltaRetest.strength}`,
                        price: currentPrice,
                        ema: volumeDeltaRetest.ema,
                        emaValue: volumeDeltaRetest.emaValue,
                        volumeRatio: volumeDeltaRetest.volumeRatio.toFixed(1),
                        deltaRatio: (volumeDeltaRetest.deltaRatio * 100).toFixed(0),
                        strength: volumeDeltaRetest.strength,
                        strategyEmoji: volumeDeltaRetest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ema55: volumeDeltaRetest.ema55,
                        ema144: volumeDeltaRetest.ema144,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, volumeDeltaRetest.type);
                    results.push(alert);
                }
            }
            
            // 4. Exaustão
            const exhaustionRetest = checkExhaustionRetest(candles);
            if (exhaustionRetest.signal) {
                const volumeOk = (exhaustionRetest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (exhaustionRetest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (exhaustionRetest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (exhaustionRetest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, exhaustionRetest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_EXAUSTAO',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: exhaustionRetest.directionEmoji,
                        directionText: `EXAUSTÃO DE ${exhaustionRetest.direction}`,
                        price: currentPrice,
                        ema: exhaustionRetest.ema,
                        emaValue: exhaustionRetest.emaValue,
                        rsi: exhaustionRetest.rsi,
                        description: exhaustionRetest.description,
                        strategyEmoji: exhaustionRetest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ema13: exhaustionRetest.ema13,
                        ema34: exhaustionRetest.ema34,
                        ema55: exhaustionRetest.ema55,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, exhaustionRetest.type);
                    results.push(alert);
                }
            }
            
            // 5. Liquidez
            const liquidityRetest = checkLiquidityRetest(candles);
            if (liquidityRetest.signal) {
                const volumeOk = (liquidityRetest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (liquidityRetest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (liquidityRetest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (liquidityRetest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, liquidityRetest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const liquidityText = liquidityRetest.liquidityLevel === 'EXTREMO' ? 'EXTREMA' : 'ALTA';
                    
                    const alert = {
                        type: 'RETESTE_LIQUIDEZ',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: liquidityRetest.directionEmoji,
                        directionText: `LIQUIDEZ ${liquidityText} - ZONA DE ${liquidityRetest.zone}`,
                        price: currentPrice,
                        ema: liquidityRetest.ema,
                        emaValue: liquidityRetest.emaValue,
                        stochRSI: liquidityRetest.stochRSI.toFixed(1),
                        zone: liquidityRetest.zone,
                        liquidityLevel: liquidityRetest.liquidityLevel,
                        strategyEmoji: liquidityRetest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ema55: liquidityRetest.ema55,
                        ema144: liquidityRetest.ema144,
                        ema233: liquidityRetest.ema233,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, liquidityRetest.type);
                    results.push(alert);
                }
            }
            
            // 6. Reteste Clássico
            const retestAnalysis = checkRetestCriteria(candles, timeframe);
            if (retestAnalysis.signal) {
                let directionEmoji, directionText, alertType;
                
                const isAlta = retestAnalysis.type.includes('ALTA');
                
                const volumeOk = (isAlta && volumeDirection === 'COMPRADOR') ||
                                 (!isAlta && volumeDirection === 'VENDEDOR');
                
                const cciOk = (isAlta && cciDirection === 'ALTA') ||
                              (!isAlta && cciDirection === 'BAIXA');
                
                if (!volumeOk || !cciOk) continue;
                
                if (isAlta) {
                    directionEmoji = '🟢🔄';
                    directionText = `Reteste de Alta ${timeframe} (${retestAnalysis.touchedEMA})`;
                    alertType = retestAnalysis.type;
                } else {
                    directionEmoji = '🔴🔄';
                    directionText = `Reteste de Baixa ${timeframe} (${retestAnalysis.touchedEMA})`;
                    alertType = retestAnalysis.type;
                }
                
                if (canSendAlert(symbol, timeframe, alertType)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_CLASSICO',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji,
                        directionText,
                        price: currentPrice,
                        touchedEMA: retestAnalysis.touchedEMA,
                        emaValue: retestAnalysis.emaValue,
                        ema13: retestAnalysis.ema13,
                        ema55: retestAnalysis.ema55,
                        ema144: retestAnalysis.ema144,
                        ema233: retestAnalysis.ema233,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, alertType);
                    results.push(alert);
                }
            }
            
            // 7. Reteste MA50
            const ma50Retest = checkMA50Retest(candles);
            if (ma50Retest.signal) {
                const volumeOk = (ma50Retest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (ma50Retest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (ma50Retest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (ma50Retest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, ma50Retest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_MA50',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: ma50Retest.directionEmoji,
                        directionText: `RETESTE MA50`,
                        price: currentPrice,
                        ma50: ma50Retest.ma50,
                        ema55: ma50Retest.ema55,
                        alinhado: ma50Retest.alinhado,
                        description: ma50Retest.description,
                        strength: ma50Retest.strength,
                        strategyEmoji: ma50Retest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, ma50Retest.type);
                    results.push(alert);
                }
            }
            
            // 8. Reteste MA200
            const ma200Retest = checkMA200Retest(candles);
            if (ma200Retest.signal) {
                const volumeOk = (ma200Retest.direction === 'ALTA' && volumeDirection === 'COMPRADOR') ||
                                 (ma200Retest.direction === 'BAIXA' && volumeDirection === 'VENDEDOR');
                
                const cciOk = (ma200Retest.direction === 'ALTA' && cciDirection === 'ALTA') ||
                              (ma200Retest.direction === 'BAIXA' && cciDirection === 'BAIXA');
                
                if (volumeOk && cciOk && canSendAlert(symbol, timeframe, ma200Retest.type)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'RETESTE_MA200',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji: ma200Retest.directionEmoji,
                        directionText: `RETESTE MA200`,
                        price: currentPrice,
                        ma200: ma200Retest.ma200,
                        ema55: ma200Retest.ema55,
                        ema144: ma200Retest.ema144,
                        ema233: ma200Retest.ema233,
                        tendenciaLP: ma200Retest.tendenciaLP,
                        emasAlinhadas: ma200Retest.emasAlinhadas,
                        qtdEMAsAlinhadas: ma200Retest.qtdEMAsAlinhadas,
                        description: ma200Retest.description,
                        strength: ma200Retest.strength,
                        strategyEmoji: ma200Retest.emoji,
                        cciEmoji,
                        mtfScore: mtfAnalysis.score,
                        mtfBar: mtfAnalysis.mtfBar,
                        mtfAlignment: mtfAnalysis.alignment,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, ma200Retest.type);
                    results.push(alert);
                }
            }
        }
        
        return results;
        
    } catch (error) {
        log(`Erro ao analisar ${symbol}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === ENVIAR ALERTA COM ANÁLISE COMPLETA (ALVOS CORRIGIDOS) ===
// =====================================================================
async function sendAlert(data) {
    const time = getBrazilianDateTime();
    
    const volumeDirection = data.volume1h.direction;
    const volumeEmoji = volumeDirection === 'Comprador' ? '🟢' : (volumeDirection === 'Vendedor' ? '🔴' : '⚪');
    
    const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbolFull}`;
    
    const fundingPct = data.funding ? (data.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = data.funding && data.funding > 0 ? '+' : '';
    const lsr = data.lsr ? data.lsr.toFixed(2) : 'N/A';
    const lsrEmoji = data.lsr ? getLSREmoji(data.lsr) : '⚪';
    
    const rsiLine = `#RSI 1h: ${data.rsi} ${getRSIEmojiCustom(data.rsi)}`;
    
    // ===== ANÁLISE AUTOMÁTICA =====
    const isAlta = data.directionEmoji.includes('🟢') || data.directionEmoji.includes('💧') || data.directionEmoji.includes('📊🟢');
    const isBaixa = data.directionEmoji.includes('🔴') || data.directionEmoji.includes('🔥') || data.directionEmoji.includes('📊🔴');
    
    let forcasFavoraveis = [];
    let forcasContrarias = [];
    
    if (data.cciEmoji === '💹') forcasFavoraveis.push('CCI em ALTA');
    else if (data.cciEmoji === '🔴') forcasFavoraveis.push('CCI em BAIXA');
    else forcasContrarias.push('CCI NEUTRO');
    
    if (data.volume1h.direction === 'Comprador') {
        if (isAlta) forcasFavoraveis.push('Volume Comprador');
        else forcasContrarias.push('Volume Comprador (contrário)');
    } else if (data.volume1h.direction === 'Vendedor') {
        if (isBaixa) forcasFavoraveis.push('Volume Vendedor');
        else forcasContrarias.push('Volume Vendedor (contrário)');
    }
    
    if (data.volume3m.ratio > 1.5) {
        forcasFavoraveis.push(`Volume 3m ${data.volume3m.ratio.toFixed(1)}x`);
    } else if (data.volume3m.ratio < 0.5) {
        forcasContrarias.push(`Volume 3m baixo`);
    }
    
    if (data.lsr) {
        if (data.lsr > 1.5 && isAlta) forcasFavoraveis.push('LSR alto (otimismo)');
        else if (data.lsr < 0.7 && isBaixa) forcasFavoraveis.push('LSR baixo (pessimismo)');
        else if (data.lsr > 1.5 && isBaixa) forcasContrarias.push('LSR alto (contrário)');
        else if (data.lsr < 0.7 && isAlta) forcasContrarias.push('LSR baixo (contrário)');
    }
    
    if (data.rsi > 70 && isBaixa) forcasFavoraveis.push('RSI sobrecomprado');
    else if (data.rsi < 30 && isAlta) forcasFavoraveis.push('RSI sobrevendido');
    else if (data.rsi > 70 && isAlta) forcasContrarias.push('RSI sobrecomprado');
    else if (data.rsi < 30 && isBaixa) forcasContrarias.push('RSI sobrevendido');
    
    if (data.stoch4h.includes('⤴️') && isAlta) forcasFavoraveis.push('Stoch 4h subindo');
    else if (data.stoch4h.includes('⤵️') && isBaixa) forcasFavoraveis.push('Stoch 4h caindo');
    else if (data.stoch4h.includes('⤴️') && isBaixa) forcasContrarias.push('Stoch 4h subindo');
    else if (data.stoch4h.includes('⤵️') && isAlta) forcasContrarias.push('Stoch 4h caindo');
    
    let forcaSetup = Math.min(10, forcasFavoraveis.length * 2 + 2);
    const barraForca = '█'.repeat(Math.floor(forcaSetup/2)) + '░'.repeat(5 - Math.floor(forcaSetup/2));
    
    const analise = `📊 **ANÁLISE RÁPIDA:**
✅ **Favorável:** ${forcasFavoraveis.slice(0, 3).join(' • ') || 'Nenhum'}
${forcasContrarias.length > 0 ? `⚠️ **Contrário:** ${forcasContrarias.slice(0, 2).join(' • ')}` : ''}
💪 **Força Setup:** ${barraForca} ${forcaSetup}/10
📊 **MTF:** ${data.mtfAlignment} [${data.mtfBar}] ${data.mtfScore}/10`;

    // ===== EXTRAIR NÍVEIS NUMÉRICOS =====
    let resist1, resist2, supt1, supt2;
    
    if (data.type === 'RETESTE_MULTIPLO') {
        const emaRef = data.ema55 || data.ema144 || data.ema233;
        resist1 = emaRef * 1.1;
        resist2 = emaRef * 1.05;
        supt1 = emaRef * 0.95;
        supt2 = emaRef * 0.9;
    } else if (data.type === 'RETESTE_DIVERGENCIA_OCULTA' || data.type === 'RETESTE_VOLUME_DELTA') {
        resist1 = data.emaValue * 1.1;
        resist2 = data.emaValue * 1.05;
        supt1 = data.emaValue * 0.95;
        supt2 = data.emaValue * 0.9;
    } else if (data.type === 'RETESTE_EXAUSTAO') {
        resist1 = data.ema55 * 1.1;
        resist2 = data.ema55 * 1.05;
        supt1 = data.ema55 * 0.95;
        supt2 = data.ema55 * 0.9;
    } else if (data.type === 'RETESTE_LIQUIDEZ') {
        resist1 = data.emaValue * 1.1;
        resist2 = data.emaValue * 1.05;
        supt1 = data.emaValue * 0.95;
        supt2 = data.emaValue * 0.9;
    } else if (data.type === 'RETESTE_CLASSICO') {
        resist1 = data.emaValue * 1.1;
        resist2 = data.emaValue * 1.05;
        supt1 = data.emaValue * 0.95;
        supt2 = data.emaValue * 0.9;
    } else if (data.type === 'RETESTE_MA50') {
        resist1 = data.ma50 * 1.1;
        resist2 = data.ma50 * 1.05;
        supt1 = data.ma50 * 0.95;
        supt2 = data.ma50 * 0.9;
    } else if (data.type === 'RETESTE_MA200') {
        resist1 = data.ma200 * 1.1;
        resist2 = data.ma200 * 1.05;
        supt1 = data.ma200 * 0.95;
        supt2 = data.ma200 * 0.9;
    }
    
    // ===== TRADE SUGERIDO COM ALVOS CORRIGIDOS =====
    let tradeSugerido = '';
    const preco = data.price;
    
    if (isAlta) {
        // Para ALTA: 
        // - Stop abaixo do primeiro suporte (supt2 é o MAIS PRÓXIMO do preço, valor MAIOR)
        // - Alvo 1 é resist2 (MAIS PRÓXIMO, valor MENOR)
        // - Alvo 2 é resist1 (MAIS DISTANTE, valor MAIOR)
        const stop = supt2 * 0.98; // 2% abaixo do primeiro suporte
        const alvo1 = resist2; // Primeiro alvo (MAIS PRÓXIMO)
        const alvo2 = resist1; // Segundo alvo (MAIS DISTANTE)
        
        const risco = preco - stop;
        const retorno1 = alvo1 - preco;
        const retorno2 = alvo2 - preco;
        
        tradeSugerido = `🎯 **TRADE SUGERIDO (ALTA):**
· ✅ **Entrada:** $${formatPrice(preco)} (atual)
· 🛑 **Stop:** Abaixo de $${formatPrice(stop)} (-${((preco-stop)/preco*100).toFixed(1)}%)
· 🎯 **Alvo 1:** $${formatPrice(alvo1)} (+${((alvo1-preco)/preco*100).toFixed(1)}%)  ← MAIS PRÓXIMO
· 🎯 **Alvo 2:** $${formatPrice(alvo2)} (+${((alvo2-preco)/preco*100).toFixed(1)}%)  ← MAIS DISTANTE
· ⚖️ **R:R (Alvo 1):** 1:${(retorno1/risco).toFixed(1)}
${forcaSetup >= 7 ? '· 🔥 **CONFIANÇA ALTA**' : forcaSetup >= 4 ? '· ⚡ **CONFIANÇA MÉDIA**' : '· ⚠️ **CONFIANÇA BAIXA**'}`;
        
    } else if (isBaixa) {
        // Para BAIXA: (CORRIGIDO!)
        // - Stop acima da primeira resistência (resist2 é a MAIS PRÓXIMA do preço, valor MENOR)
        // - Alvo 1 é supt2 (MAIS PRÓXIMO do preço, valor MAIOR)
        // - Alvo 2 é supt1 (MAIS DISTANTE do preço, valor MENOR)
        const stop = resist2 * 1.02; // Stop acima da resistência mais próxima
        const alvo1 = supt2; // Primeiro alvo = MAIOR valor (mais próximo do preço)
        const alvo2 = supt1; // Segundo alvo = MENOR valor (mais distante)
        
        const risco = stop - preco;
        const retorno1 = preco - alvo1;
        const retorno2 = preco - alvo2;
        
        tradeSugerido = `🎯 **TRADE SUGERIDO (BAIXA):**
· ✅ **Entrada:** $${formatPrice(preco)} (atual)
· 🛑 **Stop:** Acima de $${formatPrice(stop)} (+${((stop-preco)/preco*100).toFixed(1)}%)
· 🎯 **Alvo 1:** $${formatPrice(alvo1)} (-${((preco-alvo1)/preco*100).toFixed(1)}%)  ← MAIS PRÓXIMO (MAIOR valor)
· 🎯 **Alvo 2:** $${formatPrice(alvo2)} (-${((preco-alvo2)/preco*100).toFixed(1)}%)  ← MAIS DISTANTE (MENOR valor)
· ⚖️ **R:R (Alvo 1):** 1:${(retorno1/risco).toFixed(1)}
${forcaSetup >= 7 ? '· 🔥 **CONFIANÇA ALTA**' : forcaSetup >= 4 ? '· ⚡ **CONFIANÇA MÉDIA**' : '· ⚠️ **CONFIANÇA BAIXA**'}`;
    }

    // ===== MENSAGEM PRINCIPAL =====
    let message;
    
    if (data.type === 'RETESTE_MULTIPLO') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: ${data.emaNames}
 📊 Confluência: ${data.count} EMAs
 💪 Força: ${data.strength} ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_DIVERGENCIA_OCULTA') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: ${data.ema} ($${formatPrice(data.emaValue)})
 🔄 ${data.description}
 💪 Força: FORTE ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_VOLUME_DELTA') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: ${data.ema} ($${formatPrice(data.emaValue)})
 📊 Volume: ${data.volumeRatio}x acima da média
 📈 Delta: ${data.deltaRatio}% do volume
 💪 Força: ${data.strength} ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_EXAUSTAO') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: ${data.ema} ($${formatPrice(data.emaValue)})
 📊 RSI: ${data.rsi} ${getRSIEmojiCustom(data.rsi)}
 ⚠️ ${data.description}
 💪 Força: ${data.strength} ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 ⚠️ Atenção: Possível reversão - aguardar confirmação
 
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_LIQUIDEZ') {
        const liquidityText = data.liquidityLevel === 'EXTREMO' ? 'EXTREMA' : 'ALTA';
        const zoneText = data.zone === 'OVERSOLD' ? 'COMPRA' : 'VENDA';
        
        message = `<i>${data.directionEmoji} ${data.symbol} LIQUIDEZ ${liquidityText} - ZONA DE ${zoneText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: ${data.ema} ($${formatPrice(data.emaValue)})
 📊 Stoch RSI: ${data.stochRSI}% (${data.zone} ${data.liquidityLevel})
 🌊 Zona: ${data.strategyEmoji} Liquidez ${data.liquidityLevel}
 💪 Força: ${data.strength}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 🎯 Setup: Liquidez ${data.liquidityLevel} + Reteste ${data.ema}
 
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_CLASSICO') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou em: ${data.touchedEMA} ($${formatPrice(data.emaValue)})
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_MA50') {
        const alinhadoText = data.alinhado ? '✅ ALINHADA COM EMA55' : '⚠️ DIVERGENTE DA EMA55';
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: MA50 ($${formatPrice(data.ma50)})
 📊 EMA55: $${formatPrice(data.ema55)}
 🔄 ${alinhadoText}
 📊 ${data.description}
 💪 Força: ${data.strength} ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 Titanium Prime by @J4Rviz</i>`;
    }
    
    else if (data.type === 'RETESTE_MA200') {
        const alinhamentoText = data.emasAlinhadas === 'ALINHADAS' ? 
            `✅ ${data.qtdEMAsAlinhadas}/3 EMAs alinhadas` : 
            `⚠️ Apenas ${data.qtdEMAsAlinhadas}/3 EMAs alinhadas`;
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou: MA200 ($${formatPrice(data.ma200)})
 🏦 ZONA INSTITUCIONAL - ${data.description}
 📊 Contexto:
   ├─ EMA55: $${formatPrice(data.ema55)} ${data.ema55 > data.ma200 ? '⬆️' : '⬇️'}
   ├─ EMA144: $${formatPrice(data.ema144)} ${data.ema144 > data.ma200 ? '⬆️' : '⬇️'}
   └─ EMA233: $${formatPrice(data.ema233)} ${data.ema233 > data.ma200 ? '⬆️' : '⬇️'}
 🔄 ${alinhamentoText}
 📈 Tendência LP: ${data.tendenciaLP === 'ALTA' ? '🟢 BULL' : '🔴 BEAR'}
 💪 Força: ${data.strength} ${data.strategyEmoji}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: $${formatPrice(resist1)} | $${formatPrice(resist2)}
 🔹Supt: $${formatPrice(supt1)} | $${formatPrice(supt2)}
 
${analise}
${tradeSugerido}
 ⚠️ ZONA INSTITUCIONAL - GRANDES PLAYERS
 
 Titanium Prime by @J4Rviz</i>`;
    }

    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            log(`Erro Telegram: ${response.status} - ${errorText}`, 'error');
        } else {
            log(`✅ ALERTA ENVIADO: ${data.symbol} ${data.directionText} [${data.timeframe}]`, 'success');
        }
        
        return true;
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
        return false;
    }
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 SCANNER INICIADO - 8 ESTRATÉGIAS DE RETESTE');
    console.log('='.repeat(60));
    console.log(`📊 Monitorando top ${CONFIG.SCAN.TOP_SYMBOLS_LIMIT} símbolos`);
    console.log(`📈 Timeframes: ${CONFIG.TIMEFRAMES.join(', ')}`);
    console.log(`🔄 Estratégias:`);
    console.log(`   1. Reteste Múltiplo (EMAs Fibonacci)`);
    console.log(`   2. Divergência Oculta`);
    console.log(`   3. Volume Delta`);
    console.log(`   4. Exaustão`);
    console.log(`   5. Liquidez Stoch RSI`);
    console.log(`   6. Reteste Clássico`);
    console.log(`   7. 🔷 RETESTE MA50`);
    console.log(`   8. 🏦 RETESTE MA200 - INSTITUCIONAL`);
    console.log('='.repeat(60) + '\n');
    console.log('📱 ALERTAS AGORA INCLUEM:');
    console.log('   ✅ Análise Rápida Automática');
    console.log('   ✅ Trade Sugerido com Alvos CORRIGIDOS');
    console.log('   ✅ Força do Setup (0-10)');
    console.log('   ✅ Percentuais de Gain/Perda');
    console.log('   ✅ Nível de Confiança');
    console.log('='.repeat(60) + '\n');
    
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    
    if (CONFIG.WARMUP.ENABLED) {
        const warmupSymbols = currentTopSymbols.slice(0, CONFIG.WARMUP.SYMBOLS);
        await cache.warmup(warmupSymbols);
    }
    
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            log('Contadores diários resetados', 'info');
        }
    }, 60000);
    
    setInterval(async () => {
        log('Atualizando lista de top symbols...', 'info');
        const newSymbols = await getTopSymbols();
        if (newSymbols.length > 0) {
            currentTopSymbols = newSymbols;
            log(`Lista atualizada: ${currentTopSymbols.length} símbolos`, 'success');
        }
    }, 30 * 60 * 1000);
    
    setInterval(() => {
        rateLimiter.showStats();
    }, 10 * 60 * 1000);
    
    let scanCount = 0;
    
    while (true) {
        try {
            scanCount++;
            log(`\n📊 Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                
                log(`Processando batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)} (${batch.length} símbolos)`, 'info');
                
                await Promise.all(batch.map(async (symbol) => {
                    await analyzeSymbol(symbol);
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.SYMBOL_DELAY_MS / 2));
                }));
                
                if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                    log(`Aguardando ${CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS}ms...`, 'info');
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            log(`✅ Scan #${scanCount} concluído. Aguardando 20s...`, 'success');
            await new Promise(r => setTimeout(r, 20000));
            
        } catch (error) {
            log(`❌ Erro no scan: ${error.message}`, 'error');
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// =====================================================================
// === INICIAR ===
// =====================================================================
process.on('unhandledRejection', (error) => {
    log(`Erro não tratado: ${error.message}`, 'error');
});

startScanner().catch(console.error);
