const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    EMA: {
        FAST: 13,
        SLOW: 34,
        TREND: 55,
        STRONG: 144,
        SUPER1: 610,
        SUPER2: 890
    },
    CCI: {
        PERIOD: 20,
        EMA_PERIOD: 5
    },
    TIMEFRAMES: ['1h', '4h'],
    SCAN: {
        BATCH_SIZE: 15,
        SYMBOL_DELAY_MS: 100,
        REQUEST_TIMEOUT: 10000,
        COOLDOWN_AFTER_BATCH_MS: 800,
        TOP_SYMBOLS_LIMIT: 350
    },
    ALERTS: {
        COOLDOWN_MINUTES: 30,
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
            TOUCH_TOLERANCE: 0.005 // 0.5% de tolerância para tocar EMAs muito longas
        }
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === CACHE ===
// =====================================================================
class Cache {
    constructor() {
        this.cache = new Map();
        this.requestTimestamps = [];
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > 30 * 1000) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    set(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    canMakeRequest() {
        const now = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > now - 60000);
        return this.requestTimestamps.length < 1200;
    }

    addRequest() {
        this.requestTimestamps.push(Date.now());
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
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.consecutiveErrors = 0;
        this.errorBackoff = 1000;
    }

    async wait() {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequestTime;
        const baseDelay = CONFIG.SCAN.SYMBOL_DELAY_MS;
        
        if (timeSinceLast < baseDelay) {
            await new Promise(r => setTimeout(r, baseDelay - timeSinceLast));
        }
        
        this.lastRequestTime = Date.now();
    }

    async makeRequest(url, cacheKey = null) {
        if (cacheKey) {
            const cached = cache.get(cacheKey);
            if (cached) return cached;
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
                    await new Promise(r => setTimeout(r, this.errorBackoff * Math.pow(2, attempts)));
                    attempts++;
                    continue;
                }
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const data = await response.json();
                this.consecutiveErrors = 0;
                
                if (cacheKey) cache.set(cacheKey, data);
                return data;
                
            } catch (error) {
                this.consecutiveErrors++;
                attempts++;
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, this.errorBackoff * attempts));
                }
            }
        }
        throw new Error(`Falha após ${maxAttempts} tentativas`);
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
        return { cci: 0, ema: 0, crossover: null };
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
    
    let crossover = null;
    if (previousCCI <= previousEMA && currentCCI > emaCCI) {
        crossover = 'ALTA';
    } else if (previousCCI >= previousEMA && currentCCI < emaCCI) {
        crossover = 'BAIXA';
    }
    
    return {
        cci: currentCCI,
        ema: emaCCI,
        previousCCI,
        previousEMA,
        crossover
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

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return 50;
    
    const changes = [];
    for (let i = 1; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i-1].close);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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
// === VERIFICAR CRITÉRIO DE TENDÊNCIA FORTE (EMA144) ===
// =====================================================================
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
    
    // ALTA FORTE: subindo e fechou acima da EMA144
    if (lastCandle.close > prevCandle.close && currentClose > ema144) {
        signal = 'ALTA_FORTE';
        type = 'ALTA_FORTE_4H';
    }
    
    // BAIXA FORTE: caindo e fechou abaixo da EMA144
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

// =====================================================================
// === VERIFICAR CRITÉRIO DE SUPER TENDÊNCIA (EMA610/890) ===
// =====================================================================
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
    
    // Verificar se está subindo
    const isRising = lastCandle.close > prevCandle.close;
    
    // Verificar se está descendo
    const isFalling = lastCandle.close < prevCandle.close;
    
    // SUPER ALTA: subindo e tocou EMA610 ou EMA890
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
    
    // SUPER BAIXA: descendo e tocou EMA610 ou EMA890
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

// =====================================================================
// === VERIFICAR CRITÉRIO EMA (CRUZAMENTO) ===
// =====================================================================
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

// =====================================================================
// === VERIFICAR CRITÉRIO DE RETESTE ===
// =====================================================================
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
    const ema233 = calculateEMA(closes, CONFIG.EMA.SUPER1 - 377); // Aproximadamente 233
    
    const tolerance = currentClose * CONFIG.ALERTS.RETEST.TOUCH_TOLERANCE;
    
    let signal = null;
    let type = null;
    let touchedEMA = null;
    
    // ===== RETESTE DE ALTA =====
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
    
    // ===== RETESTE DE BAIXA =====
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
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 1000) {
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
        log(`Erro ao buscar candles ${symbol} ${interval}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === DADOS ADICIONAIS ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice) {
    try {
        const [candles1h, candles4h, candlesDaily, ticker24h] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '4h', 100),
            getCandles(symbol, '1d', 60),
            rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, `ticker_${symbol}`)
        ]);
        
        const volume24hUSDT = parseFloat(ticker24h?.quoteVolume || 0);
        const priceChange24h = parseFloat(ticker24h?.priceChangePercent || 0);
        
        const volume1h = calculateVolumeEMA(candles1h);
        const volume4h = calculateVolumeEMA(candles4h);
        
        const rsi = calculateRSI(candles1h);
        
        const stochDaily = calculateStochastic(candlesDaily);
        const stoch4h = calculateStochastic(candles4h);
        const stoch1h = calculateStochastic(candles1h);
        
        const cciDaily = calculateCCIWithEMA(candlesDaily, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD);
        
        let cciText = 'CCI Diário: ⚪NEUTRO';
        if (cciDaily.crossover === 'ALTA') {
            cciText = 'CCI Diário: 💹ALTA';
        } else if (cciDaily.crossover === 'BAIXA') {
            cciText = 'CCI Diário: 🔴BAIXA';
        }
        
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
        
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        const volumeUSDT1h = currentVolume1h * currentPrice;
        
        const volumes3m = await getCandles(symbol, '3m', 20);
        const volume3m = calculateVolumeEMA(volumes3m);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1]?.volume || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
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
                bullish: volume3m.bullish,
                bearish: volume3m.bearish,
                direction: volume3m.bullish > 52 ? 'Comprador' : (volume3m.bearish > 52 ? 'Vendedor' : 'Neutro'),
                pct: volume3m.bullish.toFixed(0)
            },
            rsi: Math.round(rsi),
            stoch1d: formatStochastic(stochDaily),
            stoch4h: formatStochastic(stoch4h),
            stoch1h: formatStochastic(stoch1h),
            lsr,
            funding,
            cciText,
            symbolFull: symbol
        };
    } catch (error) {
        return {
            volume24h: { usdt: 0, change: 0, pct: '0%' },
            volume1h: { ratio: 1, bullish: 50, bearish: 50, direction: 'Neutro', usdt: 0, pct: '50' },
            volume3m: { ratio: 1, bullish: 50, bearish: 50, direction: 'Neutro', pct: '50' },
            rsi: 50,
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
            'top_symbols_24h'
        );
        
        return data
            .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.volume) > 0)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
    } catch (e) {
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
// === ANALISAR SÍMBOLO (AGORA COM TODOS OS ALERTAS) ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const results = [];
        
        for (const timeframe of CONFIG.TIMEFRAMES) {
            // Precisa de muitos candles para EMAs muito longas (890)
            const candles = await getCandles(symbol, timeframe, 1000);
            
            if (candles.length < CONFIG.EMA.SUPER2 + 10) continue;
            
            // 1. Verificar critério de cruzamento (EMA13/34)
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
            
            // 2. Verificar critério de reteste
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
            
            // 3. Verificar TENDÊNCIA FORTE (EMA144) - apenas 4H
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
                
                // 4. Verificar SUPER TENDÊNCIA (EMA610/890) - apenas 4H
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
// === ENVIAR ALERTA (AGORA COM TODOS OS TIPOS) ===
// =====================================================================
async function sendAlert(data) {
    const time = getBrazilianDateTime();
    
    const volumeDirection = data.volume1h.direction;
    const volumeEmoji = volumeDirection === 'Comprador' ? '🟢' : (volumeDirection === 'Vendedor' ? '🔴' : '⚪');
    
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '⚪';
    
    const fundingPct = data.funding ? (data.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = data.funding && data.funding > 0 ? '+' : '';
    
    const lsr = data.lsr ? data.lsr.toFixed(2) : 'N/A';
    
    const tradingViewUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbolFull}`;
    
    // Mensagem diferente para cada tipo de alerta
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
 #RSI 1h: ${data.rsi} ${rsiEmoji} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${resist1} | ${resist2}
 🔹Supt: ${supt1} | ${supt2}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'RETESTE') {
        const emaValue = data.touchedEMA === 'EMA13' ? data.ema13 : 
                        (data.touchedEMA === 'EMA55' ? data.ema55 :
                        (data.touchedEMA === 'EMA144' ? data.ema144 : data.ema233));
        
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou em: ${data.touchedEMA} ($${formatPrice(emaValue)})
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 #RSI 1h: ${data.rsi} ${rsiEmoji} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'STRONG_TREND') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 📊 EMA144: $${formatPrice(data.ema144)}
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 #RSI 1h: ${data.rsi} ${rsiEmoji} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 
 Titanium Prime by @J4Rviz</i>`;
    
    } else if (data.type === 'SUPER_TREND') {
        message = `<i>${data.directionEmoji} ${data.symbol} ${data.directionText} #${data.timeframe}
 Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 🎯 Tocou em: ${data.touchedEMA} ($${formatPrice(data.emaValue)})
 ${data.cciText}
 ▫️Vol 24hs: ${data.volume24h.pct} ${volumeEmoji}${volumeDirection}
 #RSI 1h: ${data.rsi} ${rsiEmoji} | <a href="${tradingViewUrl}">🔗 TradingView</a>
 #Vol 3m: ${data.volume3m.ratio.toFixed(2)}x (${data.volume3m.pct}%) ${data.volume3m.direction === 'Comprador' ? '🟢Comprador' : (data.volume3m.direction === 'Vendedor' ? '🔴Vendedor' : '⚪Neutro')}
 #Vol 1h: ${data.volume1h.ratio.toFixed(2)}x (${data.volume1h.pct}%) ${volumeEmoji}${volumeDirection}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 
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
    console.log('\n' + '='.repeat(100));
    console.log('🚀 SCANNER COMPLETO - CRUZAMENTOS | RETESTES | TENDÊNCIA FORTE | SUPER TENDÊNCIA');
    console.log('='.repeat(100));
    
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    log(`Timeframes: 1H e 4H`, 'success');
    log(`Alertas:`, 'info');
    log(`  • 🟢🔍/🔴🔍 Cruzamento EMA13/34`, 'info');
    log(`  • 🟢🔄/🔴🔄 Reteste (13/55/144/233)`, 'info');
    log(`  • 🟢⚡/🔴⚡ Tendência Forte (EMA144)`, 'info');
    log(`  • 🟢🔥/🔴🔥 Super Tendência (EMA610/890)`, 'info');
    
    // Reset diário dos contadores
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            log('Contadores diários resetados', 'info');
        }
    }, 60000);
    
    let scanCount = 0;
    
    while (true) {
        try {
            scanCount++;
            log(`\n📊 Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                
                log(`Processando batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)}`, 'info');
                
                await Promise.allSettled(batch.map(symbol => analyzeSymbol(symbol)));
                
                if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            log(`Scan #${scanCount} concluído. Aguardando 30s...`, 'success');
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
