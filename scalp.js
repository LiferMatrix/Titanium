const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

/// =====================================================================
/// === CONFIGURAÇÕES CENTRALIZADAS ===
/// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7867596992:IvQ',
        CHAT_ID: '-1007'
    },
    SCAN: {
        BATCH_SIZE: 5,
        SYMBOL_DELAY_MS: 5000,
        REQUEST_TIMEOUT: 18000,
        COOLDOWN_AFTER_BATCH_MS: 1500,
        MAX_REQUESTS_PER_MINUTE: 1000,
        CACHE_DURATION_SECONDS: 45,
        TOP_SYMBOLS_LIMIT: 570,
        SCAN_INTERVAL_SECONDS: 30
    },
    ALERTS: {
        COOLDOWN_MINUTES: 15,
        COOLDOWN_BY_TIMEFRAME: {
            '15m': 5, '30m': 5, '1h': 5, '2h': 5, '4h': 15,
            '12h': 15, '1d': 15, '3d': 15, '1w': 15
        },
        VOLUME_DIRECTION: {
            BUY_MIN_PERCENTAGE: 40,
            SELL_MAX_PERCENTAGE: 60,
            REQUIRE_VOLUME_DIRECTION: true
        },
        MAX_ALERTS_PER_SCAN: 30,
        TELEGRAM_DELAY_MS: 5000
    },
    RSI: {
        PERIOD: 14,
        OVERSOLD: 30,
        OVERBOUGHT: 70,
        EXTREME_OVERSOLD: 25,
        EXTREME_OVERBOUGHT: 75
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'],
        LOOKBACK_PERIODS: 30,
        MIN_PIVOT_STRENGTH: 0.5,
        LOOKBACK_BY_TIMEFRAME: {
            '15m': 60, '30m': 70, '1h': 80, '2h': 90, '4h': 100,
            '12h': 120, '1d': 150, '3d': 180, '1w': 200
        },
        SCORE_MULTIPLIER: {
            '15m': 1.5, '30m': 1.5, '1h': 1.5, '2h': 1.5, '4h': 2.0,
            '12h': 2.5, '1d': 3.0, '3d': 4.0, '1w': 5.0
        },
        REQUIRE_EXTREME_FOR_HIDDEN: true,
        HIDDEN_DIVERGENCE_MULTIPLIER: 1.5,
        REGULAR_DIVERGENCE_MULTIPLIER: 1.0,
        MIN_RSI_EXTREME_FOR_HIDDEN: { bullish: 30, bearish: 70 },
        REQUIRE_PIVOT_FOR_DIVERGENCE: true
    },
    BOLLINGER: {
        PERIOD: 20,
        STD_DEVIATION: 2.2,
        PROXIMITY_PERCENT: 0.8,
        REQUIRED_TIMEFRAMES: ['15m'],
        CHECK_BOTH_TIMEFRAMES: false
    },
    WICK_REJECTION: {
        ENABLED: true,
        TIMEFRAME: '15m',
        MIN_WICK_TO_BODY_RATIO: 1.5,
        MIN_WICK_PERCENT: 0.25,
        LOOKBACK_CANDLES: 3,
        ATR_MULTIPLIER: 1.5,
        MAX_WICK_PERCENT: 2.0,
        REQUIRE_CONSECUTIVE: false,
        CHECK_CLOSE_CONFIRMATION: true
    },
    STOCHASTIC: {
        DAILY: { K_PERIOD: 5, K_SMOOTH: 3, D_PERIOD: 3 },
        FOUR_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 },
        ONE_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 }
    },
    CCI: { PERIOD: 20, EMA_PERIOD: 5 },
    FUNDING: {
        ENABLED: true,
        FAVORABLE_BONUS: {
            ENABLED: true,
            BUY_NEGATIVE_BONUS: 3,
            SELL_POSITIVE_BONUS: 3,
            MIN_THRESHOLD: 0.002
        }
    },
    STOP_LOSS: {
        ATR_MULTIPLIER: {
            '15m': 3.0, '30m': 3.3, '1h': 3.8, '2h': 4.0, '4h': 4.2,
            '12h': 4.2, '1d': 4.2, '3d': 4.2, '1w': 4.2
        },
        MIN_STOP_DISTANCE_PERCENT: {
            '15m': 2.0, '30m': 2.2, '1h': 2.5, '2h': 3.0, '4h': 3.5,
            '12h': 4.0, '1d': 5.0, '3d': 6.0, '1w': 7.0
        },
        MAX_STOP_DISTANCE_PERCENT: {
            '15m': 5.0, '30m': 5.5, '1h': 7.0, '2h': 8.0, '4h': 10.0,
            '12h': 12.0, '1d': 14.0, '3d': 16.0, '1w': 20.0
        }
    },
    TARGETS: { TP1_MULTIPLIER: 1.0, TP2_MULTIPLIER: 1.5, TP3_MULTIPLIER: 2.0 },
    VOLUME_3M: {
        ENABLED: true,
        TIMEFRAME: '3m',
        LOOKBACK_CANDLES: 20,
        ABNORMAL_MULTIPLIER: 1.5,
        MIN_CONFIDENCE: 60
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
const COOLDOWN_FILE = './cooldowns.json';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

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

let alertCache = new Map();
let currentTopSymbols = [];
let alertsSentThisScan = 0;

function loadCooldowns() {
    try {
        if (fs.existsSync(COOLDOWN_FILE)) {
            const data = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
            alertCache = new Map(Object.entries(data));
            log(`Carregados ${alertCache.size} cooldowns do arquivo`, 'success');
        }
    } catch (e) {
        log(`Erro ao carregar cooldowns: ${e.message}`, 'warning');
    }
}

function saveCooldowns() {
    try {
        const data = Object.fromEntries(alertCache);
        fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        log(`Erro ao salvar cooldowns: ${e.message}`, 'warning');
    }
}

setInterval(saveCooldowns, 5 * 60 * 1000);

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
        this.cache.set(key, { data, timestamp: Date.now() });
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
                if (cacheKey) cache.set(cacheKey, data);
                return data;
            } catch (error) {
                if (error.name === 'AbortError') log(`Timeout na requisição`, 'warning');
                else log(`Erro na requisição: ${error.message}`, 'error');
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
// === FUNÇÕES DE MERCADO ===
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

async function getTopSymbols() {
    try {
        log('Buscando top símbolos por volume...');
        const data = await rateLimiter.makeRequest('https://fapi.binance.com/fapi/v1/ticker/24hr', 'top_symbols_24h');
        const topSymbols = data
            .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.volume) > 0)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
        log(`Encontrados ${topSymbols.length} símbolos top por volume`);
        return topSymbols;
    } catch (e) {
        log('Falha ao buscar top symbols, usando lista estática', 'warning');
        return [
            'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','TONUSDT',
            'MATICUSDT','DOTUSDT','TRXUSDT','UNIUSDT','ATOMUSDT','ETCUSDT','ICPUSDT','FILUSDT','NEARUSDT','APTUSDT'
        ];
    }
}

async function getLSR(symbol, period = '15m') {
    try {
        const periodMap = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '12h': '12h', '1d': '1d' };
        const mappedPeriod = periodMap[period] || '15m';
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${mappedPeriod}&limit=1`;
        const data = await rateLimiter.makeRequest(url, `lsr_${symbol}_${mappedPeriod}`);
        if (data && data.length > 0) {
            const longRatio = parseFloat(data[0].longShortRatio);
            const longAccount = parseFloat(data[0].longAccount);
            const shortAccount = parseFloat(data[0].shortAccount);
            return {
                ratio: longRatio,
                longPercent: (longAccount * 100).toFixed(1),
                shortPercent: (shortAccount * 100).toFixed(1),
                text: `${(longAccount * 100).toFixed(1)}%/${(shortAccount * 100).toFixed(1)}%`,
                emoji: longAccount > shortAccount ? '📈' : '📉'
            };
        }
        return null;
    } catch (error) {
        log(`Erro ao buscar LSR para ${symbol}: ${error.message}`, 'warning');
        return null;
    }
}

function isCooldownActive(symbol, direction, timeframe) {
    const now = Date.now();
    const specificKey = `${symbol}_${direction}_${timeframe}`;
    const lastSpecific = alertCache.get(specificKey);
    if (lastSpecific) {
        const minutesDiff = (now - lastSpecific.timestamp) / (1000 * 60);
        const required = CONFIG.ALERTS.COOLDOWN_BY_TIMEFRAME[timeframe] || 15;
        if (minutesDiff < required) return true;
    }
    return false;
}

function registerAlert(symbol, direction, price, timeframe) {
    const now = Date.now();
    alertCache.set(`${symbol}_${direction}_${timeframe}`, { timestamp: now, timeframe, direction });
    alertsSentThisScan++;
    for (const [k, v] of alertCache) {
        if (now - v.timestamp > 48 * 60 * 60 * 1000) alertCache.delete(k);
    }
    log(`Registrado alerta ${symbol} ${direction} [${timeframe}]`, 'success');
    saveCooldowns();
    return true;
}

// =====================================================================
// === FUNÇÕES DE INDICADORES ===
// =====================================================================
function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return 50;
    const changes = [];
    for (let i = 1; i < candles.length; i++) changes.push(candles[i].close - candles[i-1].close);
    let gains = 0, losses = 0;
    for (let i = 0; i < period; i++) {
        if (changes[i] > 0) gains += changes[i];
        else losses -= changes[i];
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period; i < changes.length; i++) {
        if (changes[i] > 0) avgGain = (avgGain * (period - 1) + changes[i]) / period;
        else avgGain = (avgGain * (period - 1)) / period;
        if (changes[i] < 0) avgLoss = (avgLoss * (period - 1) - changes[i]) / period;
        else avgLoss = (avgLoss * (period - 1)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return Math.min(100, Math.max(0, 100 - (100 / (1 + rs))));
}

function calculateStochastic(candles, kPeriod, kSmooth, dPeriod) {
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) return { k: 50, d: 50 };
    const kRaw = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const highestHigh = Math.max(...periodCandles.map(c => c.high));
        const lowestLow = Math.min(...periodCandles.map(c => c.low));
        const currentClose = candles[i].close;
        if (highestHigh - lowestLow === 0) kRaw.push(50);
        else kRaw.push(((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100);
    }
    const kSmoothValues = [];
    for (let i = kSmooth - 1; i < kRaw.length; i++) {
        const sum = kRaw.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kSmoothValues.push(sum / kSmooth);
    }
    const dValues = [];
    for (let i = dPeriod - 1; i < kSmoothValues.length; i++) {
        const sum = kSmoothValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
        dValues.push(sum / dPeriod);
    }
    return { k: kSmoothValues[kSmoothValues.length - 1] || 50, d: dValues[dValues.length - 1] || 50 };
}

function formatStochastic(stoch) {
    const k = stoch.k, d = stoch.d;
    let emoji = '🟡';
    if (k < 20 && d < 25) emoji = '🟢';
    if (k > 80 && d > 75) emoji = '🔴';
    return `K${Math.round(k)}${k > d ? '⤴️' : '⤵️'}D${Math.round(d)} ${emoji}`;
}

function getCCITrend(candles, period = 20, emaPeriod = 5) {
    if (!candles || candles.length < period + emaPeriod) return { trend: 'Neutro', emoji: '', text: 'CCI N/A' };
    const cciValues = [];
    for (let i = period; i <= candles.length; i++) {
        const slice = candles.slice(i - period, i);
        const tp = slice.map(c => (c.high + c.low + c.close) / 3);
        const sma = tp.reduce((a, b) => a + b, 0) / period;
        let md = 0;
        for (let j = 0; j < tp.length; j++) md += Math.abs(tp[j] - sma);
        md /= period;
        if (md === 0) cciValues.push(0);
        else cciValues.push((tp[tp.length - 1] - sma) / (0.015 * md));
    }
    if (cciValues.length < emaPeriod) return { trend: 'Neutro', emoji: '', text: 'CCI N/A' };
    let ema = cciValues.slice(0, emaPeriod).reduce((a, b) => a + b, 0) / emaPeriod;
    const multiplier = 2 / (emaPeriod + 1);
    for (let i = emaPeriod; i < cciValues.length; i++) ema = (cciValues[i] - ema) * multiplier + ema;
    const currentCCI = cciValues[cciValues.length - 1];
    if (currentCCI > ema) return { trend: 'ALTA', emoji: '💹', text: `CCI ALTA ${currentCCI.toFixed(0)}` };
    if (currentCCI < ema) return { trend: 'BAIXA', emoji: '🔴', text: `CCI BAIXA ${currentCCI.toFixed(0)}` };
    return { trend: 'Neutro', emoji: '', text: `CCI ${currentCCI.toFixed(0)}` };
}

function calculateVolumeDirection(candles) {
    if (!candles || candles.length < 20) return { percentage: 50, direction: 'Neutro', emoji: '⚪', buyer: 50, seller: 50, confidence: 'Baixa' };
    
    const closes = candles.map(c => c.close);
    let ema9 = closes[0];
    const multiplier = 2 / 10;
    for (let i = 1; i < closes.length; i++) {
        ema9 = (closes[i] - ema9) * multiplier + ema9;
    }
    
    let bullishVolume = 0;
    let totalVolume = 0;
    
    for (let i = 0; i < candles.length; i++) {
        totalVolume += candles[i].volume;
        if (candles[i].close > ema9) {
            bullishVolume += candles[i].volume;
        } else if (candles[i].close < ema9) {
            bullishVolume += candles[i].volume * 0.4;
        } else {
            bullishVolume += candles[i].volume * 0.5;
        }
    }
    
    const buyerPercentage = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    const sellerPercentage = 100 - buyerPercentage;
    
    let direction = 'Neutro', emoji = '⚪', confidence = 'Baixa';
    if (buyerPercentage >= 56) { direction = 'Comprador Forte'; emoji = '🟢🟢'; confidence = 'Alta'; }
    else if (buyerPercentage >= 52) { direction = 'Comprador'; emoji = '🟢'; confidence = 'Média'; }
    else if (sellerPercentage >= 56) { direction = 'Vendedor Forte'; emoji = '🔴🔴'; confidence = 'Alta'; }
    else if (sellerPercentage >= 52) { direction = 'Vendedor'; emoji = '🔴'; confidence = 'Média'; }
    
    return { percentage: buyerPercentage, sellerPercentage, direction, emoji, buyer: buyerPercentage, seller: sellerPercentage, confidence };
}

function calculateVolume3mAnomaly(candles, isBullishAlert) {
    if (!CONFIG.VOLUME_3M.ENABLED) {
        return { passed: true, message: '⏭️ Volume 3m: desabilitado', isAbnormal: false, confidence: 0 };
    }
    
    if (!candles || candles.length < CONFIG.VOLUME_3M.LOOKBACK_CANDLES) {
        return { passed: false, message: '⚠️ Volume 3m: dados insuficientes', isAbnormal: false, confidence: 0 };
    }
    
    const lastCandle = candles[candles.length - 1];
    const previousCandles = candles.slice(0, -1);
    
    const avgVolume = previousCandles.slice(-CONFIG.VOLUME_3M.LOOKBACK_CANDLES).reduce((sum, c) => sum + c.volume, 0) / CONFIG.VOLUME_3M.LOOKBACK_CANDLES;
    const currentVolume = lastCandle.volume;
    const volumeRatio = currentVolume / avgVolume;
    const isAbnormalVolume = volumeRatio >= CONFIG.VOLUME_3M.ABNORMAL_MULTIPLIER;
    
    const bodyDirection = lastCandle.close > lastCandle.open ? 'bullish' : 'bearish';
    const volumeDirection = bodyDirection;
    
    let isDirectionalCorrect = false;
    if (isBullishAlert) {
        isDirectionalCorrect = volumeDirection === 'bullish';
    } else {
        isDirectionalCorrect = volumeDirection === 'bearish';
    }
    
    let confidence = 0;
    if (isAbnormalVolume) {
        confidence = Math.min(100, (volumeRatio / CONFIG.VOLUME_3M.ABNORMAL_MULTIPLIER) * 100);
    }
    
    const passed = isAbnormalVolume && isDirectionalCorrect && confidence >= CONFIG.VOLUME_3M.MIN_CONFIDENCE;
    
    let message = '';
    if (passed) {
        message = `✅ Volume 3m: ${volumeRatio.toFixed(1)}x média (${volumeDirection.toUpperCase()}) 🎯`;
    } else if (!isAbnormalVolume) {
        message = `❌ Volume 3m: normal (${volumeRatio.toFixed(1)}x média)`;
    } else if (!isDirectionalCorrect) {
        message = `❌ Volume 3m: direção errada (${volumeDirection}) para ${isBullishAlert ? 'COMPRA' : 'VENDA'}`;
    } else {
        message = `❌ Volume 3m: confiança ${confidence.toFixed(0)}% < ${CONFIG.VOLUME_3M.MIN_CONFIDENCE}%`;
    }
    
    return { 
        passed, 
        message, 
        isAbnormal: isAbnormalVolume, 
        confidence, 
        volumeRatio, 
        avgVolume, 
        currentVolume,
        volumeDirection,
        isDirectionalCorrect
    };
}

function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return 0;
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    if (trValues.length === 0) return 0;
    let atr = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trValues.length; i++) atr = (atr * (period - 1) + trValues[i]) / period;
    return atr;
}

// =====================================================================
// === WICK REJECTION - DINÂMICO BASEADO NO ATR ===
// =====================================================================
function calculateDynamicWickThreshold(candles, atr, currentPrice) {
    const avgRange = candles.slice(-10).reduce((sum, c) => sum + (c.high - c.low), 0) / 10;
    const atrPercent = (atr / currentPrice) * 100;
    const rangePercent = (avgRange / currentPrice) * 100;
    
    let dynamicMinWickPercent = Math.max(CONFIG.WICK_REJECTION.MIN_WICK_PERCENT, atrPercent * 0.5);
    if (rangePercent > 2) dynamicMinWickPercent = Math.min(dynamicMinWickPercent * 1.3, CONFIG.WICK_REJECTION.MAX_WICK_PERCENT);
    else if (rangePercent < 0.5) dynamicMinWickPercent = Math.max(dynamicMinWickPercent * 0.7, 0.2);
    
    let dynamicRatio = CONFIG.WICK_REJECTION.MIN_WICK_TO_BODY_RATIO;
    if (atrPercent > 1.5) dynamicRatio = Math.max(dynamicRatio * 0.7, 1.2);
    else if (atrPercent < 0.5) dynamicRatio = Math.min(dynamicRatio * 1.5, 4.0);
    
    return { minWickPercent: Math.min(dynamicMinWickPercent, CONFIG.WICK_REJECTION.MAX_WICK_PERCENT), minRatio: dynamicRatio, atrPercent, rangePercent };
}

function checkWickRejection(candles, isBullish, atr) {
    if (!CONFIG.WICK_REJECTION.ENABLED) {
        return { passed: true, message: '⏭️ Wick Rejection: desabilitado', hasRejection: false };
    }
    if (!candles || candles.length < 2) {
        return { passed: false, message: '⚠️ Wick Rejection: dados insuficientes', hasRejection: false };
    }
    
    const currentPrice = candles[candles.length - 1].close;
    const dynamicThresholds = calculateDynamicWickThreshold(candles, atr, currentPrice);
    const lookback = Math.min(CONFIG.WICK_REJECTION.LOOKBACK_CANDLES, candles.length);
    let rejectionCandles = [];
    
    for (let i = candles.length - lookback; i < candles.length; i++) {
        const candle = candles[i];
        const bodySize = Math.abs(candle.close - candle.open);
        const totalRange = candle.high - candle.low;
        if (totalRange === 0 || bodySize === 0) continue;
        
        let wickSize = 0, isValidRejection = false;
        
        if (isBullish) {
            wickSize = Math.min(candle.open, candle.close) - candle.low;
            const wickPercent = (wickSize / candle.close) * 100;
            const wickToBodyRatio = wickSize / bodySize;
            let closeConfirmed = true;
            if (CONFIG.WICK_REJECTION.CHECK_CLOSE_CONFIRMATION) {
                const higherBody = Math.max(candle.open, candle.close);
                closeConfirmed = (higherBody - candle.low) > wickSize * 0.5;
            }
            isValidRejection = wickSize > 0 && wickToBodyRatio >= dynamicThresholds.minRatio && wickPercent >= dynamicThresholds.minWickPercent && closeConfirmed;
            if (isValidRejection) {
                rejectionCandles.push({ index: i, type: 'bullish_rejection', wickSize, wickPercent, ratio: wickToBodyRatio, bodySize, isCurrent: (i === candles.length - 1) });
            }
        } else {
            wickSize = candle.high - Math.max(candle.open, candle.close);
            const wickPercent = (wickSize / candle.close) * 100;
            const wickToBodyRatio = wickSize / bodySize;
            let closeConfirmed = true;
            if (CONFIG.WICK_REJECTION.CHECK_CLOSE_CONFIRMATION) {
                const lowerBody = Math.min(candle.open, candle.close);
                closeConfirmed = (candle.high - lowerBody) > wickSize * 0.5;
            }
            isValidRejection = wickSize > 0 && wickToBodyRatio >= dynamicThresholds.minRatio && wickPercent >= dynamicThresholds.minWickPercent && closeConfirmed;
            if (isValidRejection) {
                rejectionCandles.push({ index: i, type: 'bearish_rejection', wickSize, wickPercent, ratio: wickToBodyRatio, bodySize, isCurrent: (i === candles.length - 1) });
            }
        }
    }
    
    let hasValidRejection = rejectionCandles.length > 0;
    if (CONFIG.WICK_REJECTION.REQUIRE_CONSECUTIVE && rejectionCandles.length >= 2) {
        const indices = rejectionCandles.map(c => c.index);
        let consecutive = true;
        for (let i = 1; i < indices.length; i++) if (indices[i] !== indices[i-1] + 1) consecutive = false;
        hasValidRejection = consecutive;
    }
    
    const hasCurrentRejection = rejectionCandles.some(c => c.isCurrent);
    const bestRejection = hasCurrentRejection ? rejectionCandles.find(c => c.isCurrent) : rejectionCandles[rejectionCandles.length - 1];
    
    if (hasValidRejection && bestRejection) {
        return { passed: true, hasRejection: true, message: `✅ Wick Rejection: ${isBullish ? 'wick inferior' : 'wick superior'} de ${bestRejection.wickPercent.toFixed(2)}% (${bestRejection.ratio.toFixed(1)}x corpo)`, details: rejectionCandles, thresholds: dynamicThresholds };
    } else {
        return { passed: false, hasRejection: false, message: `⏭️ Wick Rejection: Nenhum candle válido`, details: [], thresholds: dynamicThresholds };
    }
}

// =====================================================================
// === BOLLINGER BANDS ===
// =====================================================================
function calculateBollingerBands(candles, period = 20, stdDev = 2) {
    if (!candles || candles.length < period) return null;
    const closes = candles.slice(-period).map(c => c.close);
    const sma = closes.reduce((a, b) => a + b, 0) / period;
    const squaredDiffs = closes.map(close => Math.pow(close - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: sma + (stdDev * std), lower: sma - (stdDev * std), sma, currentPrice: candles[candles.length - 1].close, period, stdDev };
}

function checkBollingerProximity(candles, isBullish, timeframe) {
    if (!CONFIG.BOLLINGER.REQUIRED_TIMEFRAMES.includes(timeframe)) return { passed: true, message: `⏭️ Bollinger ${timeframe}: não requerido`, isTouching: false };
    const bb = calculateBollingerBands(candles, CONFIG.BOLLINGER.PERIOD, CONFIG.BOLLINGER.STD_DEVIATION);
    if (!bb) return { passed: false, message: `⚠️ Bollinger ${timeframe}: sem dados suficientes`, isTouching: false };
    const maxDistance = CONFIG.BOLLINGER.PROXIMITY_PERCENT;
    const price = bb.currentPrice;
    let distanceToBand = 0, bandPrice = 0, isTouching = false;
    
    if (isBullish) {
        distanceToBand = ((price - bb.lower) / bb.lower) * 100;
        bandPrice = bb.lower;
        if (price <= bb.lower) { isTouching = true; }
        else if (distanceToBand <= maxDistance) { isTouching = true; }
        if (isTouching) return { passed: true, message: `✅ Bollinger: ${price <= bb.lower ? 'ABAIXO' : 'PRÓXIMO'} da banda INFERIOR`, isTouching: true, band: 'lower', distance: Math.abs(distanceToBand), bandPrice: bb.lower, sma: bb.sma };
        else return { passed: false, message: `❌ Bollinger: distante ${distanceToBand.toFixed(2)}% da banda inferior`, isTouching: false, band: 'lower', distance: distanceToBand, bandPrice: bb.lower };
    } else {
        distanceToBand = ((bb.upper - price) / bb.upper) * 100;
        bandPrice = bb.upper;
        if (price >= bb.upper) { isTouching = true; }
        else if (distanceToBand <= maxDistance) { isTouching = true; }
        if (isTouching) return { passed: true, message: `✅ Bollinger: ${price >= bb.upper ? 'ACIMA' : 'PRÓXIMO'} da banda SUPERIOR`, isTouching: true, band: 'upper', distance: Math.abs(distanceToBand), bandPrice: bb.upper, sma: bb.sma };
        else return { passed: false, message: `❌ Bollinger: distante ${distanceToBand.toFixed(2)}% da banda superior`, isTouching: false, band: 'upper', distance: distanceToBand, bandPrice: bb.upper };
    }
}

function checkBollingerTimeframes(symbol, isBullish, candles15m) {
    const bb15m = checkBollingerProximity(candles15m, isBullish, '15m');
    if (!bb15m.passed) log(`❌ ${symbol} - Bollinger: ${bb15m.message}`, 'warning');
    else log(`✅ ${symbol} - ${bb15m.message}`, 'success');
    return { passed: bb15m.passed, results: [bb15m] };
}

// =====================================================================
// === DETECÇÃO DE DIVERGÊNCIA RSI COM PIVÔ OBRIGATÓRIO ===
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
            if (strength >= minStrength) pivots.highs.push({ index: i, value: curr, strength });
        }
        if (curr < p1 && curr < p2 && curr < n1 && curr < n2) {
            const avg = (p2 + p1 + n1 + n2) / 4;
            const strength = ((avg - curr) / avg) * 100;
            if (strength >= minStrength) pivots.lows.push({ index: i, value: curr, strength });
        }
    }
    return pivots;
}

function getLookbackForTimeframe(timeframe) {
    return CONFIG.RSI_DIVERGENCE.LOOKBACK_BY_TIMEFRAME[timeframe] || 80;
}

function findAllPivotLevels(candles, currentPrice, timeframe) {
    const highs = [], lows = [];
    const lookback = Math.min(100, candles.length);
    
    for (let i = 5; i < lookback - 5; i++) {
        let isHigh = true, isLow = true;
        for (let j = -5; j <= 5; j++) {
            if (j === 0) continue;
            if (i + j < 0 || i + j >= candles.length) continue;
            if (candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i + j].low) isLow = false;
        }
        if (isHigh) {
            let touches = 1;
            for (let k = 0; k < candles.length; k++) {
                if (Math.abs(k - i) > 3 && Math.abs(candles[k].high - candles[i].high) / candles[i].high < 0.003) {
                    touches++;
                }
            }
            highs.push({ price: candles[i].high, touches, index: i });
        }
        if (isLow) {
            let touches = 1;
            for (let k = 0; k < candles.length; k++) {
                if (Math.abs(k - i) > 3 && Math.abs(candles[k].low - candles[i].low) / candles[i].low < 0.003) {
                    touches++;
                }
            }
            lows.push({ price: candles[i].low, touches, index: i });
        }
    }
    
    highs.sort((a, b) => b.touches - a.touches);
    lows.sort((a, b) => b.touches - a.touches);
    
    const support = lows.length > 0 && lows[0].price < currentPrice ? lows[0] : null;
    const resistance = highs.length > 0 && highs[0].price > currentPrice ? highs[0] : null;
    
    return { support, resistance };
}

function getPivotStrength(touches) {
    if (touches >= 6) return { text: '🔥 FORTE', emoji: '🔥' };
    if (touches >= 4) return { text: '🔥 FORTE', emoji: '🔥' };
    if (touches >= 3) return { text: '⚡ FORTE', emoji: '⚡' };
    if (touches >= 2) return { text: '⭐ MÉDIO', emoji: '⭐' };
    return { text: '⚠️ FRACO', emoji: '⚠️' };
}

function detectRSIDivergence(prices, rsiValues, timeframe, candles) {
    const lookback = getLookbackForTimeframe(timeframe);
    const limitedPrices = prices.slice(-lookback);
    const limitedRsi = rsiValues.slice(-lookback);
    if (limitedPrices.length < 20 || limitedRsi.length < 20) return null;
    
    const pricePivots = findSignificantPivots(limitedPrices, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH);
    const rsiPivots = findSignificantPivots(limitedRsi, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH * 2);
    let bestDivergence = null;

    // Divergência Regular Bullish
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
            const pivotLevels = findAllPivotLevels(candles, limitedPrices[limitedPrices.length - 1], timeframe);
            if (CONFIG.RSI_DIVERGENCE.REQUIRE_PIVOT_FOR_DIVERGENCE) {
                if (pivotLevels.support && pivotLevels.support.price <= limitedPrices[limitedPrices.length - 1] * 1.02) {
                    bestDivergence = { 
                        type: 'bullish', 
                        subtype: 'regular', 
                        emoji: '📈', 
                        rsiValue: lastRSILow.value, 
                        priceValue: lastPriceLow.value,
                        pivot: pivotLevels.support,
                        pivotType: 'suporte'
                    };
                }
            } else {
                bestDivergence = { type: 'bullish', subtype: 'regular', emoji: '📈', rsiValue: lastRSILow.value, priceValue: lastPriceLow.value };
            }
        }
    }
    
    // Divergência Regular Bearish
    if (!bestDivergence && pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
            const pivotLevels = findAllPivotLevels(candles, limitedPrices[limitedPrices.length - 1], timeframe);
            if (CONFIG.RSI_DIVERGENCE.REQUIRE_PIVOT_FOR_DIVERGENCE) {
                if (pivotLevels.resistance && pivotLevels.resistance.price >= limitedPrices[limitedPrices.length - 1] * 0.98) {
                    bestDivergence = { 
                        type: 'bearish', 
                        subtype: 'regular', 
                        emoji: '📉', 
                        rsiValue: lastRSIHigh.value, 
                        priceValue: lastPriceHigh.value,
                        pivot: pivotLevels.resistance,
                        pivotType: 'resistência'
                    };
                }
            } else {
                bestDivergence = { type: 'bearish', subtype: 'regular', emoji: '📉', rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value };
            }
        }
    }
    
    // Hidden Divergence Bullish
    if (!bestDivergence && pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        if (lastPriceLow.value > prevPriceLow.value && lastRSILow.value < prevRSILow.value) {
            const rsiExtreme = lastRSILow.value <= CONFIG.RSI.EXTREME_OVERSOLD;
            if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                const pivotLevels = findAllPivotLevels(candles, limitedPrices[limitedPrices.length - 1], timeframe);
                if (CONFIG.RSI_DIVERGENCE.REQUIRE_PIVOT_FOR_DIVERGENCE) {
                    if (pivotLevels.support && pivotLevels.support.price <= limitedPrices[limitedPrices.length - 1] * 1.02) {
                        bestDivergence = { 
                            type: 'bullish', 
                            subtype: 'hidden', 
                            emoji: '🔮', 
                            rsiValue: lastRSILow.value, 
                            priceValue: lastPriceLow.value,
                            pivot: pivotLevels.support,
                            pivotType: 'suporte'
                        };
                    }
                } else {
                    bestDivergence = { type: 'bullish', subtype: 'hidden', emoji: '🔮', rsiValue: lastRSILow.value, priceValue: lastPriceLow.value };
                }
            }
        }
    }
    
    // Hidden Divergence Bearish
    if (!bestDivergence && pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        if (lastPriceHigh.value < prevPriceHigh.value && lastRSIHigh.value > prevRSIHigh.value) {
            const rsiExtreme = lastRSIHigh.value >= CONFIG.RSI.EXTREME_OVERBOUGHT;
            if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                const pivotLevels = findAllPivotLevels(candles, limitedPrices[limitedPrices.length - 1], timeframe);
                if (CONFIG.RSI_DIVERGENCE.REQUIRE_PIVOT_FOR_DIVERGENCE) {
                    if (pivotLevels.resistance && pivotLevels.resistance.price >= limitedPrices[limitedPrices.length - 1] * 0.98) {
                        bestDivergence = { 
                            type: 'bearish', 
                            subtype: 'hidden', 
                            emoji: '🔮', 
                            rsiValue: lastRSIHigh.value, 
                            priceValue: lastPriceHigh.value,
                            pivot: pivotLevels.resistance,
                            pivotType: 'resistência'
                        };
                    }
                } else {
                    bestDivergence = { type: 'bearish', subtype: 'hidden', emoji: '🔮', rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value };
                }
            }
        }
    }
    
    return bestDivergence;
}

// =====================================================================
// === FUNÇÕES DE FUNDING ===
// =====================================================================
async function getFundingRate(symbol) {
    try {
        const data = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, `funding_${symbol}`);
        return parseFloat(data.lastFundingRate) || null;
    } catch { return null; }
}

function checkFundingBonus(funding, isGreenAlert) {
    if (!CONFIG.FUNDING.ENABLED || funding === null) return { hasBonus: false, message: '' };
    const fundingPercent = funding * 100;
    if (CONFIG.FUNDING.FAVORABLE_BONUS.ENABLED) {
        const minBonus = CONFIG.FUNDING.FAVORABLE_BONUS.MIN_THRESHOLD;
        if (isGreenAlert && funding < 0 && Math.abs(funding) >= minBonus) {
            return { hasBonus: true, message: `🎯 Fund ${fundingPercent.toFixed(4)}% (negativo)` };
        }
        if (!isGreenAlert && funding > 0 && funding >= minBonus) {
            return { hasBonus: true, message: `🎯 Fund +${fundingPercent.toFixed(4)}%` };
        }
    }
    return { hasBonus: false, message: `Fund ${funding > 0 ? '+' : ''}${fundingPercent.toFixed(4)}%` };
}

// =====================================================================
// === CÁLCULO DE STOP E TARGETS ===
// =====================================================================
function computeStopAndTargets(currentPrice, isGreenAlert, timeframe, candles) {
    const atr = calculateATR(candles, 14);
    const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 3.0;
    const minStopPercent = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 2.0;
    const maxStopPercent = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 7.0;
    const atrValue = atr > 0 ? atr : currentPrice * 0.02;
    let stop = isGreenAlert ? currentPrice - atrValue * atrMultiplier : currentPrice + atrValue * atrMultiplier;
    let stopDistance = Math.abs(currentPrice - stop) / currentPrice * 100;
    if (stopDistance < minStopPercent) stop = isGreenAlert ? currentPrice * (1 - minStopPercent / 100) : currentPrice * (1 + minStopPercent / 100);
    else if (stopDistance > maxStopPercent) stop = isGreenAlert ? currentPrice * (1 - maxStopPercent / 100) : currentPrice * (1 + maxStopPercent / 100);
    let tp1, tp2, tp3;
    if (isGreenAlert) {
        tp1 = currentPrice + atrValue * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice + atrValue * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice + atrValue * CONFIG.TARGETS.TP3_MULTIPLIER;
    } else {
        tp1 = currentPrice - atrValue * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice - atrValue * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice - atrValue * CONFIG.TARGETS.TP3_MULTIPLIER;
    }
    return { stop, tp1, tp2, tp3 };
}

// =====================================================================
// === ANÁLISE PRINCIPAL DO SÍMBOLO ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const divergences = [];
        const allCandles = {};
        
        // Buscar candles 3m para análise de volume
        const candles3m = await getCandles(symbol, '3m', 30);
        if (!candles3m || candles3m.length < 20) {
            log(`⚠️ ${symbol} - Dados 3m insuficientes para análise de volume`, 'warning');
            return [];
        }
        
        for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
            const lookback = getLookbackForTimeframe(tf);
            const candles = await getCandles(symbol, tf, lookback);
            if (candles && candles.length >= Math.min(lookback, 40)) {
                allCandles[tf] = candles;
                const rsiValues = [];
                const prices = [];
                for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
                    rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
                    prices.push(candles[i].close);
                }
                const divergence = detectRSIDivergence(prices, rsiValues, tf, candles);
                if (divergence) {
                    divergences.push({ 
                        timeframe: tf, 
                        type: divergence.type, 
                        subtype: divergence.subtype, 
                        emoji: divergence.emoji, 
                        rsiValue: divergence.rsiValue,
                        pivot: divergence.pivot,
                        pivotType: divergence.pivotType,
                        lookbackUsed: lookback 
                    });
                }
            }
        }
        
        if (divergences.length === 0) return [];
        
        const bullishDivs = divergences.filter(d => d.type === 'bullish');
        const bearishDivs = divergences.filter(d => d.type === 'bearish');
        let finalDirection = '', isGreenAlert = false, bestDivergence = null;
        
        if (bullishDivs.length > 0) { finalDirection = '🟢 COMPRA'; isGreenAlert = true; bestDivergence = bullishDivs[0]; }
        else if (bearishDivs.length > 0) { finalDirection = '🔴 VENDA'; isGreenAlert = false; bestDivergence = bearishDivs[0]; }
        else return [];
        
        // Verificar volume anormal e direcional em 3 minutos
        const volume3mCheck = calculateVolume3mAnomaly(candles3m, isGreenAlert);
        if (!volume3mCheck.passed) {
            log(`❌ ${symbol} - REPROVADO: ${volume3mCheck.message}`, 'warning');
            return [];
        }
        log(`✅ ${symbol} - ${volume3mCheck.message}`, 'success');
        
        const candles15m = await getCandles(symbol, '15m', 80);
        const candles1h = await getCandles(symbol, '1h', 100);
        const candles4h = allCandles['4h'] || await getCandles(symbol, '4h', 150);
        const candles1d = allCandles['1d'] || await getCandles(symbol, '1d', 200);
        
        if (!candles15m || candles15m.length < 30) {
            log(`⚠️ ${symbol} - Dados insuficientes para análise`, 'warning');
            return [];
        }
        
        if (!candles1h || candles1h.length === 0) {
            log(`⚠️ ${symbol} - Sem dados 1h`, 'warning');
            return [];
        }
        
        const currentPrice = candles1h[candles1h.length - 1].close;
        const atr = calculateATR(candles15m, 14);
        
        const wickRejectionCheck = checkWickRejection(candles15m, isGreenAlert, atr);
        if (!wickRejectionCheck.passed) {
            log(`❌ ${symbol} - REPROVADO: ${wickRejectionCheck.message}`, 'warning');
            return [];
        }
        log(`✅ ${symbol} - ${wickRejectionCheck.message}`, 'success');
        
        const bollingerCheck = checkBollingerTimeframes(symbol, isGreenAlert, candles15m);
        if (!bollingerCheck.passed) {
            log(`❌ ${symbol} - REPROVADO: Bollinger 15m não confirmou`, 'warning');
            return [];
        }
        log(`✅ ${symbol} - Bollinger 15m confirmado!`, 'success');
        
        const volume1h = calculateVolumeDirection(candles1h);
        const volumeDirectionCheck = (() => {
            if (isGreenAlert) return volume1h.buyer >= CONFIG.ALERTS.VOLUME_DIRECTION.BUY_MIN_PERCENTAGE;
            else return volume1h.seller >= 45;
        })();
        
        if (!volumeDirectionCheck) {
            log(`❌ ${symbol} - REPROVADO: Volume 1h direcional insuficiente`, 'warning');
            return [];
        }
        log(`✅ ${symbol} - Volume 1h direcional OK`, 'success');
        
        if (isCooldownActive(symbol, finalDirection.includes('COMPRA') ? 'COMPRA' : 'VENDA', bestDivergence.timeframe)) {
            log(`⏭️ ${symbol} - Cooldown ativo`, 'warning');
            return [];
        }
        
        const cci4h = getCCITrend(candles4h, 20, 5);
        const cci1d = getCCITrend(candles1d, 20, 5);
        const stoch4h = calculateStochastic(candles4h, 14, 3, 3);
        const stoch1d = calculateStochastic(candles1d, 5, 3, 3);
        const funding = await getFundingRate(symbol);
        const fundingBonus = checkFundingBonus(funding, isGreenAlert);
        const { stop, tp1, tp2, tp3 } = computeStopAndTargets(currentPrice, isGreenAlert, bestDivergence.timeframe, candles4h);
        
        const pivotLevels4h = findAllPivotLevels(candles4h, currentPrice, '4h');
        const lsr = await getLSR(symbol, '15m');
        
        const alertData = {
            symbol, finalDirection, currentPrice, bestDivergence,
            cci4h, cci1d, stoch4h, stoch1d, volume1h,
            funding, fundingBonus,
            stop, tp1, tp2, tp3,
            bollingerResults: bollingerCheck.results,
            wickRejection: wickRejectionCheck,
            volume3mCheck,
            pivotLevels4h,
            lsr: lsr
        };
        
        queueAlert(alertData);
        return [alertData];
        
    } catch (error) {
        log(`Erro em analyzeSymbol ${symbol}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === FILA E ENVIO DE ALERTAS ===
// =====================================================================
let isSendingTelegram = false;
const alertQueue = [];

function queueAlert(alert) {
    alertQueue.push(alert);
    log(`Alerta ${alert.symbol} adicionado à fila`, 'info');
}

async function processQueue() {
    if (isSendingTelegram) return;
    isSendingTelegram = true;
    const alerts = [...alertQueue];
    alertQueue.length = 0;
    for (const alert of alerts) {
        await sendAlert(alert);
        await new Promise(r => setTimeout(r, CONFIG.ALERTS.TELEGRAM_DELAY_MS));
    }
    isSendingTelegram = false;
}

async function sendAlert(alert) {
    const message = formatAlertMessage(alert);
    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CONFIG.TELEGRAM.CHAT_ID, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        if (response.ok) {
            const direction = alert.finalDirection.includes('COMPRA') ? 'COMPRA' : 'VENDA';
            registerAlert(alert.symbol, direction, alert.currentPrice, alert.bestDivergence.timeframe);
            log(`✅ ALERTA ENVIADO: ${alert.finalDirection} ${alert.symbol}`, 'success');
        } else {
            const errorText = await response.text();
            log(`Erro Telegram: ${response.status} - ${errorText}`, 'error');
        }
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
    }
}

function formatAlertMessage(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbol}&interval=60`;
    
    const titleEmoji = data.finalDirection.includes('COMPRA') ? '🟢' : '🔴';
    const directionText = data.finalDirection.includes('COMPRA') ? 'Compra' : 'Correção';
    const arrowEmoji = data.finalDirection.includes('COMPRA') ? '⤴️' : '⤵️';
    
    // Divergência
    const divergenceEmoji = data.bestDivergence.emoji;
    const divergenceTimeframe = data.bestDivergence.timeframe;
    const divergenceSubtype = data.bestDivergence.subtype === 'regular' ? '🎯' : '🔮';
    
    // Pivô da divergência
    let pivotText = '';
    if (data.bestDivergence.pivot && data.bestDivergence.pivotType) {
        const strength = getPivotStrength(data.bestDivergence.pivot.touches);
        pivotText = `🎯 Pivô ${data.bestDivergence.pivotType === 'suporte' ? 'SUPORTE' : 'RESISTÊNCIA'} confirmado (${data.bestDivergence.pivot.touches}x ${strength.text})`;
    }
    
    // Volume 3m
    let volume3mText = '';
    if (data.volume3mCheck && data.volume3mCheck.passed) {
        volume3mText = ` Vol: ${data.volume3mCheck.volumeRatio.toFixed(1)}x média (${data.volume3mCheck.volumeDirection.toUpperCase()}) `;
    }
    
    // CCI Trend
    const cciTrendText = data.finalDirection.includes('COMPRA') ? 'de alta💹' : 'de baixa🔻';
    
    // Suporte e Resistência 4H
    let supportText = '';
    let resistanceText = '';
    
    if (data.pivotLevels4h.support) {
        const strength = getPivotStrength(data.pivotLevels4h.support.touches);
        supportText = `#Suporte ${formatPrice(data.pivotLevels4h.support.price)} (${data.pivotLevels4h.support.touches}x ${strength.text})`;
    }
    
    if (data.pivotLevels4h.resistance) {
        const strength = getPivotStrength(data.pivotLevels4h.resistance.touches);
        resistanceText = `#Resistência ${formatPrice(data.pivotLevels4h.resistance.price)} (${data.pivotLevels4h.resistance.touches}x ${strength.text})`;
    }
    
    // LSR
    let lsrText = '';
    if (data.lsr) {
        lsrText = `LSR: ${data.lsr.emoji} ${data.lsr.text} (Ratio: ${data.lsr.ratio.toFixed(2)})`;
    }
    
    // Stop distance
    const stopDistance = ((Math.abs(data.stop - data.currentPrice) / data.currentPrice) * 100).toFixed(1);
    
    // Bollinger
    let bollingerText = '';
    if (data.bollingerResults && data.bollingerResults[0] && data.bollingerResults[0].passed && data.bollingerResults[0].isTouching) {
        const distance = data.bollingerResults[0].distance;
        bollingerText = ` Bollinger  (${distance.toFixed(2)}%) `;
    } else if (data.bollingerResults && data.bollingerResults[0] && data.bollingerResults[0].passed) {
        bollingerText = ` Bollinger `;
    }
    
    // Wick Rejection
    let wickText = '';
    if (data.wickRejection && data.wickRejection.hasRejection && data.wickRejection.details && data.wickRejection.details.length > 0) {
        const wick = data.wickRejection.details[data.wickRejection.details.length - 1];
        wickText = ` Candle (${wick.ratio.toFixed(1)}x corpo) `;
    } else if (data.wickRejection && data.wickRejection.passed) {
        wickText = ` Wick Rejection OK `;
    }
    
    // Funding
    const fundingText = data.fundingBonus.message || '';
    
    // Montagem final
    let message = `<i>${titleEmoji} ${directionText} ${arrowEmoji} - ${symbolName} | 💲 ${formatPrice(data.currentPrice)}\n`;
    message += `${time.date} ${time.time}hs\n`;
    message += `🔍 Divergência RSI (${divergenceTimeframe}${divergenceEmoji}) ${divergenceSubtype}\n`;
    message += `${pivotText}\n`;
    message += `${volume3mText}\n`;
    message += `Divergência CCI 4h ${cciTrendText}\n`;
    if (supportText) message += `${supportText}\n`;
    if (resistanceText) message += `${resistanceText}\n`;
    if (lsrText) message += `${lsrText}\n`;
    message += `Alvos: TP1: ${formatPrice(data.tp1)} | TP2: ${formatPrice(data.tp2)} | TP3: ${formatPrice(data.tp3)}\n`;
    message += `⛔️ Stop: ${formatPrice(data.stop)} (${stopDistance}%)\n`;
    message += `#RSI 1h: ${data.bestDivergence?.rsiValue?.toFixed(0) || '50'}  | <a href="${tradingViewLink}">🔗 Ver_Gráfico</a>\n`;
    if (fundingText) message += `${fundingText}\n`;
    message += `Stoch 1D: ${formatStochastic(data.stoch1d)}\n`;
    message += `Stoch 4H: ${formatStochastic(data.stoch4h)}\n`;
    message += `CCI 4H:${data.cci4h.text}\n`;
    message += `CCI 1D:${data.cci1d.text}\n`;
    if (bollingerText) message += `${bollingerText}\n`;
    if (wickText) message += `${wickText}\n`;
    message += `🤖...Não é recomendação de investimento.\n`;
    message += `Titanium  by @J4Rviz</i>`;
    
    return message;
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 Titanium - Versão SEM CVD');
    console.log('='.repeat(70));
    
    loadCooldowns();
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    
    log(`🎯 Critério: Divergência RSI + Pivô OBRIGATÓRIO no MESMO timeframe`, 'success');
    log(`📊 Volume 3m: ANORMAL + DIRECIONAL obrigatório`, 'success');
    log(`🕯️ Wick Rejection: DINÂMICO baseado no ATR`, 'success');
    log(`💾 Cooldowns com persistência`, 'success');
    log(`🔌 WebSocket CVD: REMOVIDO - Mais leve e estável`, 'success');
    
    try {
        const initMessage = ` Titanium iniciado!`;
        await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CONFIG.TELEGRAM.CHAT_ID, text: initMessage, parse_mode: 'HTML' })
        });
    } catch (e) {}
    
    setInterval(() => processQueue(), 30000);
    
    let scanCount = 0;
    while (true) {
        try {
            scanCount++;
            alertsSentThisScan = 0;
            log(`Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                await Promise.allSettled(batch.map(symbol => analyzeSymbol(symbol)));
                if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            log(`Scan #${scanCount} concluído. Alertas: ${alertsSentThisScan}`, 'success');
            await new Promise(r => setTimeout(r, CONFIG.SCAN.SCAN_INTERVAL_SECONDS * 1000));
        } catch (error) {
            log(`Erro no scan: ${error.message}`, 'error');
            await new Promise(r => setTimeout(r, CONFIG.SCAN.SCAN_INTERVAL_SECONDS * 1000));
        }
    }
}

process.on('SIGINT', () => {
    log('Desligando...', 'warning');
    saveCooldowns();
    process.exit(0);
});

startScanner().catch(console.error);
