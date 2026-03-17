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
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU
        CHAT_ID: '-100255
    },
    EMA: {
        FAST: 13,
        SLOW: 34,
        TREND: 55,
        STRONG: 144,
        SUPER1: 610,
        SUPER2: 890
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
    TIMEFRAMES: ['1h', '4h'],
    SCAN: {
        BATCH_SIZE: 5,
        SYMBOL_DELAY_MS: 1200,
        REQUEST_TIMEOUT: 25000,
        COOLDOWN_AFTER_BATCH_MS: 3000,
        TOP_SYMBOLS_LIMIT: 300
    },
    ALERTS: {
        COOLDOWN_MINUTES: 50,
        DAILY_LIMITS: {
            TOP_10: 25,
            TOP_50: 40,
            OTHER: 55
        },
        RETEST: {
            TOUCH_TOLERANCE: 0.003,
            MIN_VOLUME_RATIO: 1.2
        },
        SUPER: {
            TOUCH_TOLERANCE: 0.005
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
                getCandles(symbol, '1h', 100, 'high').catch(() => {})
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
// === NOVAS FUNÇÕES PARA EMOJIS PERSONALIZADOS ===
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
            text: 'CCI Diário: ⚪NEUTRO'
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
    
    const text = `CCI Diário: ${emoji}${direction}`;
    
    return {
        cci: currentCCI,
        ema: emaCCI,
        previousCCI,
        previousEMA,
        crossover,
        direction,
        emoji,
        text
    };
}

function calculateVolumeEMA(candles, period = 9) {
    if (!candles || candles.length < period) {
        return { bullish: 50, bearish: 50 };
    }
    
    const closes = candles.map(c => c.close);
    const emaPrice = calculateEMA(closes, period);
    
    let bullishVolume = 0;
    let bearishVolume = 0;
    let totalVolume = 0;
    
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
    
    return {
        bullish: bullishPct,
        bearish: 100 - bullishPct
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

function checkStrongTrend(candles) {
    if (!candles || candles.length < CONFIG.EMA.STRONG + 10) {
        return { signal: null };
    }
    
    const closes = candles.map(c => c.close);
    const currentClose = closes[closes.length - 1];
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    const ema144 = calculateEMA(closes, CONFIG.EMA.STRONG);
    
    let signal = null;
    let type = null;
    
    if (lastCandle.close > prevCandle.close && currentClose > ema144) {
        signal = 'ALTA_FORTE';
        type = 'ALTA_FORTE_4H';
    }
    
    if (lastCandle.close < prevCandle.close && currentClose < ema144) {
        signal = 'BAIXA_FORTE';
        type = 'BAIXA_FORTE_4H';
    }
    
    return {
        signal,
        type,
        currentClose,
        ema144
    };
}

function checkSuperTrend(candles) {
    if (!candles || candles.length < CONFIG.EMA.SUPER2 + 10) {
        return { signal: null };
    }
    
    const closes = candles.map(c => c.close);
    const currentClose = closes[closes.length - 1];
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    const ema610 = calculateEMA(closes, CONFIG.EMA.SUPER1);
    const ema890 = calculateEMA(closes, CONFIG.EMA.SUPER2);
    
    const tolerance = currentClose * CONFIG.ALERTS.SUPER.TOUCH_TOLERANCE;
    
    let signal = null;
    let type = null;
    let touchedEMA = null;
    let emaValue = null;
    
    const isRising = lastCandle.close > prevCandle.close;
    const isFalling = lastCandle.close < prevCandle.close;
    
    if (isRising) {
        const touchingEMA610 = Math.abs(lastCandle.low - ema610) <= tolerance || 
                               (lastCandle.low <= ema610 && lastCandle.close >= ema610);
        const touchingEMA890 = Math.abs(lastCandle.low - ema890) <= tolerance || 
                               (lastCandle.low <= ema890 && lastCandle.close >= ema890);
        
        if (touchingEMA610) {
            signal = 'SUPER_ALTA';
            type = 'SUPER_ALTA_4H';
            touchedEMA = 'EMA610';
            emaValue = ema610;
        } else if (touchingEMA890) {
            signal = 'SUPER_ALTA';
            type = 'SUPER_ALTA_4H';
            touchedEMA = 'EMA890';
            emaValue = ema890;
        }
    }
    
    if (isFalling) {
        const touchingEMA610 = Math.abs(lastCandle.high - ema610) <= tolerance || 
                               (lastCandle.high >= ema610 && lastCandle.close <= ema610);
        const touchingEMA890 = Math.abs(lastCandle.high - ema890) <= tolerance || 
                               (lastCandle.high >= ema890 && lastCandle.close <= ema890);
        
        if (touchingEMA610) {
            signal = 'SUPER_BAIXA';
            type = 'SUPER_BAIXA_4H';
            touchedEMA = 'EMA610';
            emaValue = ema610;
        } else if (touchingEMA890) {
            signal = 'SUPER_BAIXA';
            type = 'SUPER_BAIXA_4H';
            touchedEMA = 'EMA890';
            emaValue = ema890;
        }
    }
    
    return {
        signal,
        type,
        touchedEMA,
        emaValue,
        currentClose,
        ema610,
        ema890,
        isRising,
        isFalling
    };
}

function checkEMACriteria(candles) {
    if (!candles || candles.length < CONFIG.EMA.TREND + 10) {
        return { signal: null };
    }
    
    const closes = candles.map(c => c.close);
    const currentClose = closes[closes.length - 1];
    
    const ema13 = calculateEMA(closes, CONFIG.EMA.FAST);
    const ema34 = calculateEMA(closes, CONFIG.EMA.SLOW);
    const ema55 = calculateEMA(closes, CONFIG.EMA.TREND);
    
    const prevEma13 = calculateEMA(closes.slice(0, -1), CONFIG.EMA.FAST);
    const prevEma34 = calculateEMA(closes.slice(0, -1), CONFIG.EMA.SLOW);
    
    let signal = null;
    
    if (prevEma13 <= prevEma34 && ema13 > ema34 && currentClose > ema55) {
        signal = 'ALTA';
    }
    
    if (prevEma13 >= prevEma34 && ema13 < ema34 && currentClose < ema55) {
        signal = 'BAIXA';
    }
    
    return {
        signal,
        currentClose,
        ema13,
        ema34,
        ema55,
        prevEma13,
        prevEma34
    };
}

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
    
    if (currentClose > ema55 && lastCandle.close < prevCandle.close) {
        const touchingEMA13 = Math.abs(lastCandle.low - ema13) <= tolerance || (lastCandle.low <= ema13 && lastCandle.close >= ema13);
        const touchingEMA144 = Math.abs(lastCandle.low - ema144) <= tolerance || (lastCandle.low <= ema144 && lastCandle.close >= ema144);
        const touchingEMA233 = Math.abs(lastCandle.low - ema233) <= tolerance || (lastCandle.low <= ema233 && lastCandle.close >= ema233);
        
        if (touchingEMA13) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : 'RETESTE_ALTA_1H';
            touchedEMA = 'EMA13';
        } else if (touchingEMA144) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : 'RETESTE_ALTA_1H';
            touchedEMA = 'EMA144';
        } else if (touchingEMA233) {
            signal = 'RETESTE_ALTA';
            type = timeframe === '4h' ? 'RETESTE_ALTA_4H' : 'RETESTE_ALTA_1H';
            touchedEMA = 'EMA233';
        }
    }
    
    if (currentClose < ema55 && lastCandle.close > prevCandle.close) {
        if (timeframe === '1h') {
            const touchingEMA55 = Math.abs(lastCandle.high - ema55) <= tolerance || (lastCandle.high >= ema55 && lastCandle.close <= ema55);
            if (touchingEMA55) {
                signal = 'RETESTE_BAIXA';
                type = 'RETESTE_BAIXA_1H';
                touchedEMA = 'EMA55';
            }
        } else {
            const touchingEMA13 = Math.abs(lastCandle.high - ema13) <= tolerance || (lastCandle.high >= ema13 && lastCandle.close <= ema13);
            const touchingEMA144 = Math.abs(lastCandle.high - ema144) <= tolerance || (lastCandle.high >= ema144 && lastCandle.close <= ema144);
            const touchingEMA233 = Math.abs(lastCandle.high - ema233) <= tolerance || (lastCandle.high >= ema233 && lastCandle.close <= ema233);
            
            if (touchingEMA13) {
                signal = 'RETESTE_BAIXA';
                type = 'RETESTE_BAIXA_4H';
                touchedEMA = 'EMA13';
            } else if (touchingEMA144) {
                signal = 'RETESTE_BAIXA';
                type = 'RETESTE_BAIXA_4H';
                touchedEMA = 'EMA144';
            } else if (touchingEMA233) {
                signal = 'RETESTE_BAIXA';
                type = 'RETESTE_BAIXA_4H';
                touchedEMA = 'EMA233';
            }
        }
    }
    
    return {
        signal,
        type,
        touchedEMA,
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
// === BUSCAR CANDLES (COM PRIORIDADE) ===
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
// === DADOS ADICIONAIS (COM PRIORIDADE) ===
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
        
        const volume1h = candles1h.status === 'fulfilled' ? calculateVolumeEMA(candles1h.value) : { bullish: 50, bearish: 50 };
        const volume4h = candles4h.status === 'fulfilled' ? calculateVolumeEMA(candles4h.value) : { bullish: 50, bearish: 50 };
        
        const rsi = candles1h.status === 'fulfilled' ? calculateRSI(candles1h.value, CONFIG.RSI.PERIOD) : 50;
        const rsiEmoji = getRSIEmojiCustom(rsi);
        
        const stochDaily = candlesDaily.status === 'fulfilled' ? calculateStochastic(candlesDaily.value) : { k: 50, d: 50 };
        const stoch4h = candles4h.status === 'fulfilled' ? calculateStochastic(candles4h.value) : { k: 50, d: 50 };
        const stoch1h = candles1h.status === 'fulfilled' ? calculateStochastic(candles1h.value) : { k: 50, d: 50 };
        
        const cciDaily = candlesDaily.status === 'fulfilled' ? 
            calculateCCIWithEMA(candlesDaily.value, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD) : 
            { text: 'CCI Diário: ⚪NEUTRO' };
        
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
        
        let volumeRatio1h = 1;
        let volumeUSDT1h = 0;
        let volumeRatio3m = 1;
        let volume3mData = { bullish: 50, bearish: 50 };
        
        if (candles1h.status === 'fulfilled') {
            const volumes1h = candles1h.value.map(c => c.volume);
            const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
            const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
            volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
            volumeUSDT1h = currentVolume1h * currentPrice;
        }
        
        try {
            const volumes3m = await getCandles(symbol, '3m', 20, 'low');
            volume3mData = calculateVolumeEMA(volumes3m);
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
                direction: volume1h.bullish > 52 ? 'Comprador' : (volume1h.bearish > 52 ? 'Vendedor' : 'Neutro'),
                usdt: volumeUSDT1h,
                pct: volume1h.bullish.toFixed(0)
            },
            volume3m: {
                ratio: volumeRatio3m,
                bullish: volume3mData.bullish,
                bearish: volume3mData.bearish,
                direction: volume3mData.bullish > 52 ? 'Comprador' : (volume3mData.bearish > 52 ? 'Vendedor' : 'Neutro'),
                pct: volume3mData.bullish.toFixed(0)
            },
            rsi: Math.round(rsi),
            rsiEmoji,
            stoch1d: formatStochastic(stochDaily),
            stoch4h: formatStochastic(stoch4h),
            stoch1h: formatStochastic(stoch1h),
            lsr,
            funding,
            cciText: cciDaily.text,
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
            stoch1h: 'K50⤵️D50',
            lsr: null,
            funding: null,
            cciText: 'CCI Diário: ⚪NEUTRO',
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
    const dailyLimit = CONFIG.ALERTS.DAILY_LIMITS[category] || 55;
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
        const results = [];
        
        for (const timeframe of CONFIG.TIMEFRAMES) {
            await new Promise(r => setTimeout(r, 300));
            
            const candles = await getCandles(symbol, timeframe, 1000, 'normal');
            
            if (candles.length < CONFIG.EMA.SUPER2 + 10) continue;
            
            const emaAnalysis = checkEMACriteria(candles);
            
            if (emaAnalysis.signal) {
                const currentPrice = emaAnalysis.currentClose;
                const direction = emaAnalysis.signal === 'ALTA' ? 'COMPRA' : 'VENDA';
                const directionEmoji = emaAnalysis.signal === 'ALTA' ? '🟢🔍' : '🔴🔍';
                const directionText = emaAnalysis.signal === 'ALTA' ? 'Tendência de Alta' : 'Tendência de Baixa';
                
                if (canSendAlert(symbol, timeframe, `CRUZAMENTO_${direction}`)) {
                    const additional = await getAdditionalData(symbol, currentPrice);
                    
                    const alert = {
                        type: 'CRUZAMENTO',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji,
                        directionText,
                        price: currentPrice,
                        ema13: emaAnalysis.ema13,
                        ema34: emaAnalysis.ema34,
                        ema55: emaAnalysis.ema55,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, `CRUZAMENTO_${direction}`);
                    results.push(alert);
                }
            }
            
            const retestAnalysis = checkRetestCriteria(candles, timeframe);
            
            if (retestAnalysis.signal) {
                const currentPrice = retestAnalysis.currentClose;
                let directionEmoji, directionText, alertType;
                
                if (retestAnalysis.type.includes('ALTA')) {
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
                        type: 'RETESTE',
                        symbol: symbol.replace('USDT', ''),
                        symbolFull: symbol,
                        timeframe,
                        directionEmoji,
                        directionText,
                        price: currentPrice,
                        touchedEMA: retestAnalysis.touchedEMA,
                        ema13: retestAnalysis.ema13,
                        ema55: retestAnalysis.ema55,
                        ema144: retestAnalysis.ema144,
                        ema233: retestAnalysis.ema233,
                        dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                        ...additional
                    };
                    
                    await sendAlert(alert);
                    registerAlert(symbol, timeframe, alertType);
                    results.push(alert);
                }
            }
            
            if (timeframe === '4h') {
                const strongTrend = checkStrongTrend(candles);
                
                if (strongTrend.signal) {
                    const currentPrice = strongTrend.currentClose;
                    let directionEmoji, directionText, alertType;
                    
                    if (strongTrend.signal === 'ALTA_FORTE') {
                        directionEmoji = '🟢⚡';
                        directionText = `ALTA FORTE (acima EMA144)`;
                        alertType = 'ALTA_FORTE_4H';
                    } else {
                        directionEmoji = '🔴⚡';
                        directionText = `BAIXA FORTE (abaixo EMA144)`;
                        alertType = 'BAIXA_FORTE_4H';
                    }
                    
                    if (canSendAlert(symbol, timeframe, alertType)) {
                        const additional = await getAdditionalData(symbol, currentPrice);
                        
                        const alert = {
                            type: 'STRONG_TREND',
                            symbol: symbol.replace('USDT', ''),
                            symbolFull: symbol,
                            timeframe,
                            directionEmoji,
                            directionText,
                            price: currentPrice,
                            ema144: strongTrend.ema144,
                            dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                            ...additional
                        };
                        
                        await sendAlert(alert);
                        registerAlert(symbol, timeframe, alertType);
                        results.push(alert);
                    }
                }
                
                const superTrend = checkSuperTrend(candles);
                
                if (superTrend.signal) {
                    const currentPrice = superTrend.currentClose;
                    let directionEmoji, directionText, alertType;
                    
                    if (superTrend.signal === 'SUPER_ALTA') {
                        directionEmoji = '🟢🔥';
                        directionText = `SUPER ALTA (tocou ${superTrend.touchedEMA})`;
                        alertType = 'SUPER_ALTA_4H';
                    } else {
                        directionEmoji = '🔴🔥';
                        directionText = `SUPER BAIXA (tocou ${superTrend.touchedEMA})`;
                        alertType = 'SUPER_BAIXA_4H';
                    }
                    
                    if (canSendAlert(symbol, timeframe, alertType)) {
                        const additional = await getAdditionalData(symbol, currentPrice);
                        
                        const alert = {
                            type: 'SUPER_TREND',
                            symbol: symbol.replace('USDT', ''),
                            symbolFull: symbol,
                            timeframe,
                            directionEmoji,
                            directionText,
                            price: currentPrice,
                            touchedEMA: superTrend.touchedEMA,
                            emaValue: superTrend.emaValue,
                            ema610: superTrend.ema610,
                            ema890: superTrend.ema890,
                            dailyCount: (dailyCounter.get(`${symbol}_daily`) || 0) + 1,
                            ...additional
                        };
                        
                        await sendAlert(alert);
                        registerAlert(symbol, timeframe, alertType);
                        results.push(alert);
                    }
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
// === ENVIAR ALERTA ===
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
    
    let message;
    
    if (data.type === 'CRUZAMENTO') {
        const resist1 = formatPrice(data.ema55 * 1.1);
        const resist2 = formatPrice(data.ema55 * 1.05);
        const supt1 = formatPrice(data.ema55 * 0.95);
        const supt2 = formatPrice(data.ema55 * 0.9);
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${resist1} | ${resist2}
 🔹Supt: ${supt1} | ${supt2}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'RETESTE') {
        const emaValue = data.touchedEMA === 'EMA13' ? data.ema13 : 
                        (data.touchedEMA === 'EMA55' ? data.ema55 :
                        (data.touchedEMA === 'EMA144' ? data.ema144 : data.ema233));
        
        const resist1 = formatPrice(emaValue * 1.1);
        const resist2 = formatPrice(emaValue * 1.05);
        const supt1 = formatPrice(emaValue * 0.95);
        const supt2 = formatPrice(emaValue * 0.9);
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou em: ${data.touchedEMA} ($${formatPrice(emaValue)})
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${resist1} | ${resist2}
 🔹Supt: ${supt1} | ${supt2}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'STRONG_TREND') {
        const resist1 = formatPrice(data.ema144 * 1.1);
        const resist2 = formatPrice(data.ema144 * 1.05);
        const supt1 = formatPrice(data.ema144 * 0.95);
        const supt2 = formatPrice(data.ema144 * 0.9);
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 📊 EMA144: $${formatPrice(data.ema144)}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 ${rsiLine} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} ${lsrEmoji} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${resist1} | ${resist2}
 🔹Supt: ${supt1} | ${supt2}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'SUPER_TREND') {
        const resist1 = formatPrice(data.emaValue * 1.1);
        const resist2 = formatPrice(data.emaValue * 1.05);
        const supt1 = formatPrice(data.emaValue * 0.95);
        const supt2 = formatPrice(data.emaValue * 0.9);
        
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
 🔻Resist: ${resist1} | ${resist2}
 🔹Supt: ${supt1} | ${supt2}
 
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
            log(`✅ ALERTA ENVIADO: ${data.symbol} ${data.directionText} [${data.timeframe}] | RSI: ${data.rsi}${getRSIEmojiCustom(data.rsi)} | LSR: ${lsr}${lsrEmoji}`, 'success');
        }
        
        return true;
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
        return false;
    }
}

// =====================================================================
// === SCANNER PRINCIPAL ACELERADO ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(100));
    console.log('🚀 SCANNER ACELERADO - MANTENDO SEGURANÇA');
    console.log('='.repeat(100));
    
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    log(`Rate Limit: ${CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE}/minuto, ${CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_SECOND}/segundo`, 'success');
    log(`Batch Size: ${CONFIG.SCAN.BATCH_SIZE} | Delay: ${CONFIG.SCAN.SYMBOL_DELAY_MS}ms`, 'success');
    
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
