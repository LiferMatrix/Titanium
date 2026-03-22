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
        BOT_TOKEN: '7633398974:AAHaVFs_D_o',
        CHAT_ID: '-100199'
    },
    SCAN: {
        BATCH_SIZE: 8,
        SYMBOL_DELAY_MS: 5000,
        REQUEST_TIMEOUT: 10000,
        COOLDOWN_AFTER_BATCH_MS: 2000,
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
            '15m': 30,
            '30m': 30,
            '1h': 30,
            '2h': 30,
            '4h': 30,
            '12h': 30,
            '1d': 30
        },
        DAILY_LIMITS: {
            TOP_10: 35,
            TOP_50: 50,
            OTHER: 65,
            LOW_VOLUME: 50
        },
        MIN_VOLUME_USDT: 50000,
        MIN_VOLUME_RATIO: 1.7,
        MIN_24H_VOLUME_USDT: 100000,
        VOLUME_DIRECTION: {
            BUY_MIN_PERCENTAGE: 54,
            SELL_MAX_PERCENTAGE: 40,
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
        MAX_ALERTS_PER_SCAN: 30,
        IGNORE_LOW_VOLUME_SYMBOLS: true,
        TELEGRAM_DELAY_MS: 5000,
        MIN_15M_VOLATILITY: {
            ENABLED: true,
            MIN_ATR_PERCENT: 0.5,
            MIN_BB_WIDTH_PERCENT: 1.2,
            CHECK_TIMEFRAMES: ['1h', '4h', '1d']
        },
        PROXIMITY_THRESHOLD_PERCENT: 1.5,
        BOLLINGER: {
            ENABLED: true,
            PERIOD: 20,
            STD_DEV: 2.0,
            TIMEFRAME: '15m'
        }
    },
    VOLUME: { EMA_PERIOD: 9 },
    RSI: {
        PERIOD: 14,
        OVERSOLD: 30,
        OVERBOUGHT: 70,
        EXTREME_OVERSOLD: 25,
        EXTREME_OVERBOUGHT: 75
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h', '12h', '1d'],
        LOOKBACK_PERIODS: 30,
        MIN_PIVOT_STRENGTH: 0.5,
        SCORE_MULTIPLIER: {
            '15m': 0.5,
            '30m': 0.7,
            '1h': 1.0,
            '2h': 1.2,
            '4h': 2.0,
            '12h': 2.5,
            '1d': 3.0
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
        DAILY: { K_PERIOD: 5, K_SMOOTH: 3, D_PERIOD: 3 },
        FOUR_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 },
        ONE_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 }
    },
    CCI: { PERIOD: 20, EMA_PERIOD: 5 },
    REVERSAL: {
        MIN_CONFIRMATION_SCORE: 3,
        VOLUME_THRESHOLD: 1.2,
        STOCH_OVERSOLD: 25,
        STOCH_OVERBOUGHT: 75
    },
    LSR_PENALTY: {
        BUY_MAX_RATIO: 3.0,
        SELL_MIN_RATIO: 1.3,
        PENALTY_POINTS: -4
    },
    FUNDING_PENALTY: {
        ENABLED: true,
        LEVELS: {
            POSITIVE: {
                VERY_LOW: { THRESHOLD: 0.001, POINTS: -1 },
                LOW: { THRESHOLD: 0.002, POINTS: -2 },
                MEDIUM: { THRESHOLD: 0.004, POINTS: -3 },
                HIGH: { THRESHOLD: 0.008, POINTS: -4 }
            },
            NEGATIVE: {
                VERY_LOW: { THRESHOLD: -0.001, POINTS: -1 },
                LOW: { THRESHOLD: -0.002, POINTS: -2 },
                MEDIUM: { THRESHOLD: -0.004, POINTS: -3 },
                HIGH: { THRESHOLD: -0.008, POINTS: -4 }
            }
        },
        BUY_PENALTY_FOR_POSITIVE: true,
        SELL_PENALTY_FOR_NEGATIVE: true,
        MAX_TOTAL_PENALTY: -10
    },
    STOP_LOSS: {
        ATR_MULTIPLIER: {
            '15m': 2.0, '30m': 2.3, '1h': 3.0, '2h': 3.3,
            '4h': 3.5, '12h': 3.7, '1d': 4.0
        },
        STRUCTURE_MULTIPLIER: 0.15,
        USE_CLUSTER_ZONE: true,
        CLUSTER_ZONE_MULTIPLIER: 0.1,
        MIN_STOP_DISTANCE_PERCENT: {
            '15m': 1.0, '30m': 1.2, '1h': 1.5, '2h': 2.0,
            '4h': 2.5, '12h': 3.0, '1d': 4.0
        },
        MAX_STOP_DISTANCE_PERCENT: {
            '15m': 3.0, '30m': 3.5, '1h': 5.0, '2h': 6.0,
            '4h': 8.0, '12h': 10.0, '1d': 12.0
        }
    },
    TARGETS: {
        TP1_MULTIPLIER: 1.0,
        TP2_MULTIPLIER: 1.5,
        TP3_MULTIPLIER: 2.0
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === PERSISTÊNCIA DOS CONTADORES DIÁRIOS ===
// =====================================================================
const DAILY_COUNTER_FILE = path.join(__dirname, 'dailyCounters.json');

function loadDailyCounters() {
    try {
        if (fs.existsSync(DAILY_COUNTER_FILE)) {
            const data = fs.readFileSync(DAILY_COUNTER_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [key, value] of Object.entries(loaded)) {
                dailyCounter.set(key, value);
            }
            log(`Carregados ${dailyCounter.size} contadores diários do arquivo`, 'info');
        }
    } catch (error) {
        log(`Erro ao carregar contadores diários: ${error.message}`, 'error');
    }
}

function saveDailyCounters() {
    try {
        const obj = Object.fromEntries(dailyCounter);
        fs.writeFileSync(DAILY_COUNTER_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
        log(`Erro ao salvar contadores diários: ${error.message}`, 'error');
    }
}

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

// Caches
const alertCache = new Map();
const dailyCounter = new Map();
let currentTopSymbols = [];

// Filas
const priorityQueue = { critical: [], high: [], medium: [], low: [] };
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
// === FUNÇÕES DE CLASSIFICAÇÃO DE SÍMBOLOS ===
// =====================================================================
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
    if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

function calculateRMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
    let rma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const alpha = 1 / period;
    for (let i = period; i < values.length; i++) {
        rma = alpha * values[i] + (1 - alpha) * rma;
    }
    return rma;
}

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return 50;
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
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) return { k: 50, d: 50 };
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
    return { k: Math.min(100, Math.max(0, Math.round(currentK * 100) / 100)),
             d: Math.min(100, Math.max(0, Math.round(currentD * 100) / 100)) };
}

function formatStochastic(stoch) {
    const k = stoch.k;
    const d = stoch.d;
    let emoji = '🟡';
    if (k < 20 && d < 25) emoji = '🟢';
    if (k > 80 && d > 75) emoji = '🔴';
    return `K${Math.round(k)}${k > d ? '⤴️' : '⤵️'}D${Math.round(d)} ${emoji}`;
}

function calculateCCIWithEMA(candles, period = 20, emaPeriod = 5) {
    if (!candles || candles.length < period + emaPeriod) {
        return { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' };
    }
    const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const cciValues = [];
    for (let i = period - 1; i < typicalPrices.length; i++) {
        const tpSlice = typicalPrices.slice(i - period + 1, i + 1);
        const sma = tpSlice.reduce((a, b) => a + b, 0) / period;
        let meanDeviation = 0;
        for (let j = 0; j < tpSlice.length; j++) {
            meanDeviation += Math.abs(tpSlice[j] - sma);
        }
        meanDeviation = meanDeviation / period;
        if (meanDeviation === 0) {
            cciValues.push(0);
        } else {
            const cci = (tpSlice[tpSlice.length - 1] - sma) / (0.015 * meanDeviation);
            cciValues.push(cci);
        }
    }
    if (cciValues.length === 0) return { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' };
    const currentCCI = cciValues[cciValues.length - 1];
    const emaValues = [];
    if (cciValues.length >= emaPeriod) {
        let ema = cciValues.slice(0, emaPeriod).reduce((a, b) => a + b, 0) / emaPeriod;
        emaValues.push(ema);
        const multiplier = 2 / (emaPeriod + 1);
        for (let i = emaPeriod; i < cciValues.length; i++) {
            ema = (cciValues[i] - ema) * multiplier + ema;
            emaValues.push(ema);
        }
        const currentEMA = emaValues[emaValues.length - 1];
        let trend = 'Neutro';
        let emoji = '⚪';
        let text = '';
        if (cciValues.length >= 2) {
            const prevCCI = cciValues[cciValues.length - 2];
            const prevEMA = emaValues.length >= 2 ? emaValues[emaValues.length - 2] : currentEMA;
            if (prevCCI <= prevEMA && currentCCI > currentEMA) {
                trend = 'ALTA';
                emoji = '💹';
                text = `CCI ${trend} ${emoji}`;
            } else if (prevCCI >= prevEMA && currentCCI < currentEMA) {
                trend = 'BAIXA';
                emoji = '🔴';
                text = `CCI ${trend} ${emoji}`;
            } else if (currentCCI > currentEMA) {
                trend = 'ALTA';
                emoji = '💹';
                text = `CCI ${trend} ${emoji}`;
            } else if (currentCCI < currentEMA) {
                trend = 'BAIXA';
                emoji = '🔴';
                text = `CCI ${trend} ${emoji}`;
            } else {
                text = `CCI Neutro ⚪`;
            }
        }
        return { cci: currentCCI, ema: currentEMA, trend, emoji, text: text || `CCI ${currentCCI.toFixed(0)} | EMA ${currentEMA.toFixed(0)}` };
    }
    return { cci: currentCCI, ema: 0, trend: 'Neutro', emoji: '⚪', text: `CCI ${currentCCI.toFixed(0)}` };
}

function analyzeVolumeWithEMA(candles) {
    if (!candles || candles.length < CONFIG.VOLUME.EMA_PERIOD + 1) {
        return { text: '⚪Neutro', emoji: '⚪', percentage: 50, direction: 'Neutro', ratio: 1 };
    }
    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, CONFIG.VOLUME.EMA_PERIOD);
    let bullishVolume = 0, bearishVolume = 0, totalVolume = 0;
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const volume = candle.volume;
        const close = candle.close;
        totalVolume += volume;
        if (close > ema9) bullishVolume += volume;
        else if (close < ema9) bearishVolume += volume;
        else { bullishVolume += volume / 2; bearishVolume += volume / 2; }
    }
    const buyerPercentage = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    let direction = 'Neutro', emoji = '⚪', text = '';
    if (buyerPercentage > 52) { direction = 'Comprador'; emoji = '🟢'; text = `${emoji}Comprador`; }
    else if (buyerPercentage < 48) { direction = 'Vendedor'; emoji = '🔴'; text = `${emoji}Vendedor`; }
    else text = '⚪Neutro';
    return { text, emoji, percentage: buyerPercentage, sellerPercentage: 100 - buyerPercentage,
             direction, emaValue: ema9 };
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

function isExtremeRSI(value, type) {
    if (type === 'bullish') return value <= CONFIG.RSI.EXTREME_OVERSOLD;
    else return value >= CONFIG.RSI.EXTREME_OVERBOUGHT;
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
                divergences.push({ timeframe, type: 'bullish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📈', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                   rsiValue: lastRSILow.value, priceValue: lastPriceLow.value });
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
                divergences.push({ timeframe, type: 'bearish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📉', strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                                   rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value });
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
                    divergences.push({ timeframe, type: 'bullish', subtype: 'hidden', score: Math.round(score * 10) / 10,
                                       emoji: '🔮', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                       rsiValue: lastRSILow.value, priceValue: lastPriceLow.value, extreme: rsiExtreme });
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
                    divergences.push({ timeframe, type: 'bearish', subtype: 'hidden', score: Math.round(score * 10) / 10,
                                       emoji: '🔮', strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                                       rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value, extreme: rsiExtreme });
                }
            }
        }
    }
    return divergences;
}

// =====================================================================
// === FUNÇÕES ADICIONAIS (LSR, Funding, Stop Loss, etc.) ===
// =====================================================================
function checkLSRPenalty(lsr, isGreenAlert) {
    if (!lsr) return { hasPenalty: false, points: 0, message: '' };
    if (isGreenAlert && lsr > CONFIG.LSR_PENALTY.BUY_MAX_RATIO) {
        return { hasPenalty: true, points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
                 message: `⚠️ LSR alto (${lsr.toFixed(2)}) - Muitos comprados (${CONFIG.LSR_PENALTY.PENALTY_POINTS})` };
    }
    if (!isGreenAlert && lsr < CONFIG.LSR_PENALTY.SELL_MIN_RATIO) {
        return { hasPenalty: true, points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
                 message: `⚠️ LSR baixo (${lsr.toFixed(2)}) - Muitos vendidos (${CONFIG.LSR_PENALTY.PENALTY_POINTS})` };
    }
    return { hasPenalty: false, points: 0, message: '' };
}

function checkFundingPenalty(funding, isGreenAlert) {
    if (!CONFIG.FUNDING_PENALTY.ENABLED || funding === null || funding === undefined) {
        return { hasPenalty: false, points: 0, message: '' };
    }
    const fundingPercent = funding * 100;
    let penaltyPoints = 0;
    let penaltyLevel = '';
    
    // PENALIDADE PARA COMPRA (funding positivo)
    if (isGreenAlert && funding > 0 && CONFIG.FUNDING_PENALTY.BUY_PENALTY_FOR_POSITIVE) {
        const absFunding = funding;
        if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.HIGH.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.HIGH.POINTS;
            penaltyLevel = 'ALTO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.MEDIUM.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.MEDIUM.POINTS;
            penaltyLevel = 'MÉDIO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.LOW.POINTS;
            penaltyLevel = 'BAIXO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.VERY_LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.VERY_LOW.POINTS;
            penaltyLevel = 'MUITO BAIXO';
        }
        
        if (penaltyPoints !== 0) {
            const fundingSign = funding > 0 ? '+' : '';
            const message = `⚠️ Funding positivo (${fundingSign}${fundingPercent.toFixed(4)}%) - Nível ${penaltyLevel} (${penaltyPoints})`;
            return { hasPenalty: true, points: penaltyPoints, level: penaltyLevel, message };
        }
    }
    
    // PENALIDADE PARA VENDA (funding negativo)
    if (!isGreenAlert && funding < 0 && CONFIG.FUNDING_PENALTY.SELL_PENALTY_FOR_NEGATIVE) {
        const absFunding = Math.abs(funding);
        if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.HIGH.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.HIGH.POINTS;
            penaltyLevel = 'ALTO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.MEDIUM.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.MEDIUM.POINTS;
            penaltyLevel = 'MÉDIO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.LOW.POINTS;
            penaltyLevel = 'BAIXO';
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.VERY_LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.VERY_LOW.POINTS;
            penaltyLevel = 'MUITO BAIXO';
        }
        
        if (penaltyPoints !== 0) {
            const fundingSign = funding > 0 ? '+' : '';
            const message = `⚠️ Funding negativo (${fundingSign}${fundingPercent.toFixed(4)}%) - Nível ${penaltyLevel} (${penaltyPoints})`;
            return { hasPenalty: true, points: penaltyPoints, level: penaltyLevel, message };
        }
    }
    
    return { hasPenalty: false, points: 0, message: '' };
}

async function check15MinVolatility(symbol) {
    if (!CONFIG.ALERTS.MIN_15M_VOLATILITY.ENABLED) return { passed: true, message: '', metrics: {} };
    try {
        const candles15m = await getCandles(symbol, '15m', 30);
        if (!candles15m || candles15m.length < 20) {
            return { passed: false, message: 'Dados insuficientes 15m', metrics: {} };
        }
        const trValues = [];
        for (let i = 1; i < candles15m.length; i++) {
            const high = candles15m[i].high;
            const low = candles15m[i].low;
            const prevClose = candles15m[i-1].close;
            trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        const recentTR = trValues.slice(-14);
        const atr = recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
        const currentPrice = candles15m[candles15m.length - 1].close;
        const atrPercent = (atr / currentPrice) * 100;
        const minATR = CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_ATR_PERCENT;
        const atrPassed = atrPercent >= minATR;
        const passed = atrPassed;
        let message = '';
        if (!passed) {
            message = `⚠️ Baixa volatilidade 15m: ATR15m ${atrPercent.toFixed(2)}% < ${minATR}%`;
        }
        return { passed, message, metrics: { atrPercent, atrPassed } };
    } catch (error) {
        log(`Erro ao verificar volatilidade 15m para ${symbol}: ${error.message}`, 'error');
        return { passed: false, message: 'Erro na verificação 15m', metrics: {} };
    }
}

// Função auxiliar para calcular stop e alvos
function computeStopAndTargets(currentPrice, isGreenAlert, timeframe, candles) {
    if (!candles || candles.length < 20) {
        const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 2.0;
        const defaultAtr = currentPrice * 0.02;
        const stop = isGreenAlert ? currentPrice - defaultAtr * atrMultiplier : currentPrice + defaultAtr * atrMultiplier;
        const atr = defaultAtr;
        let tp1, tp2, tp3;
        if (isGreenAlert) {
            tp1 = currentPrice + atr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice + atr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice + atr * CONFIG.TARGETS.TP3_MULTIPLIER;
        } else {
            tp1 = currentPrice - atr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice - atr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice - atr * CONFIG.TARGETS.TP3_MULTIPLIER;
        }
        return { stop, tp1, tp2, tp3 };
    }

    // Calcula ATR
    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = trValues.slice(-14).reduce((a, b) => a + b, 0) / 14;

    // Stop loss com ajuste por estrutura
    let stopPrice = isGreenAlert ? currentPrice - (atr * (CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 2.5))
                                 : currentPrice + (atr * (CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 2.5));

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
            if (touches > maxTouches) { maxTouches = touches; clusterZone = priceNum; }
        } else if (!isGreenAlert && priceNum > currentPrice && priceNum < structureHigh * 1.05) {
            if (touches > maxTouches) { maxTouches = touches; clusterZone = priceNum; }
        }
    });

    if (isGreenAlert) {
        const clusterAdjustedStop = Math.min(stopPrice, clusterZone - (clusterZone * 0.002));
        if (clusterZone < currentPrice) stopPrice = Math.min(stopPrice, clusterAdjustedStop);
        const stopDistance = (currentPrice - stopPrice) / currentPrice * 100;
        const minDistance = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 1.5;
        const maxDistance = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 5.0;
        if (stopDistance < minDistance) stopPrice = currentPrice * (1 - minDistance / 100);
        else if (stopDistance > maxDistance) stopPrice = currentPrice * (1 - maxDistance / 100);
    } else {
        const clusterAdjustedStop = Math.max(stopPrice, clusterZone + (clusterZone * 0.002));
        if (clusterZone > currentPrice) stopPrice = Math.max(stopPrice, clusterAdjustedStop);
        const stopDistance = (stopPrice - currentPrice) / currentPrice * 100;
        const minDistance = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 1.5;
        const maxDistance = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 5.0;
        if (stopDistance < minDistance) stopPrice = currentPrice * (1 + minDistance / 100);
        else if (stopDistance > maxDistance) stopPrice = currentPrice * (1 + maxDistance / 100);
    }

    // Alvos baseados no ATR (agora com a direção correta)
    let tp1, tp2, tp3;
    if (isGreenAlert) {
        tp1 = currentPrice + atr * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice + atr * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice + atr * CONFIG.TARGETS.TP3_MULTIPLIER;
    } else {
        tp1 = currentPrice - atr * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice - atr * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice - atr * CONFIG.TARGETS.TP3_MULTIPLIER;
    }

    return { stop: stopPrice, tp1, tp2, tp3 };
}

// =====================================================================
// === BOLLINGER BANDS (15m) COM CONFIRMAÇÃO DE CANDLE ===
// =====================================================================
function calculateBollingerBands(candles, period, stdDev) {
    if (!candles || candles.length < period) {
        return { upper: null, middle: null, lower: null };
    }
    const closes = candles.map(c => c.close);
    const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
    const variance = closes.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    const upper = sma + (stdDev * sd);
    const lower = sma - (stdDev * sd);
    return { upper, middle: sma, lower };
}

async function checkBollingerCondition(symbol, isGreenAlert) {
    if (!CONFIG.ALERTS.BOLLINGER.ENABLED) return { passed: true, message: '', candleConfirmed: true };
    try {
        const candles = await getCandles(symbol, CONFIG.ALERTS.BOLLINGER.TIMEFRAME, CONFIG.ALERTS.BOLLINGER.PERIOD + 5);
        if (!candles || candles.length < CONFIG.ALERTS.BOLLINGER.PERIOD) {
            return { passed: false, message: 'Dados insuficientes para Bollinger Bands', candleConfirmed: false };
        }
        const bb = calculateBollingerBands(candles, CONFIG.ALERTS.BOLLINGER.PERIOD, CONFIG.ALERTS.BOLLINGER.STD_DEV);
        if (bb.upper === null || bb.lower === null) {
            return { passed: false, message: 'Falha no cálculo das Bollinger Bands', candleConfirmed: false };
        }
        
        const currentCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        const currentPrice = currentCandle.close;
        
        let passed = false;
        let message = '';
        let candleConfirmed = false;
        
        if (isGreenAlert) {
            // CONDIÇÃO PARA COMPRA: Preço abaixo da banda inferior
            passed = currentPrice <= bb.lower;
            
            if (!passed) {
                const diffPercent = ((currentPrice - bb.lower) / bb.lower) * 100;
                message = `❌ Preço ($${formatPrice(currentPrice)}) acima da banda inferior ($${formatPrice(bb.lower)}) - distância +${diffPercent.toFixed(2)}%`;
            } else {
                // NOVO CRITÉRIO: Verificar se o fechamento é maior que a mínima anterior (candle de alta)
                if (currentCandle.close > previousCandle.low) {
                    candleConfirmed = true;
                    message = `✅ Preço abaixo da banda inferior ($${formatPrice(currentPrice)} < $${formatPrice(bb.lower)}) | Candle de alta confirmado (close > mínima anterior)`;
                } else {
                    message = `❌ Preço abaixo da banda inferior, mas candle não é de alta (close: ${formatPrice(currentCandle.close)} ≤ mínima anterior: ${formatPrice(previousCandle.low)})`;
                    passed = false;
                }
            }
        } else {
            // CONDIÇÃO PARA VENDA: Preço acima da banda superior
            passed = currentPrice >= bb.upper;
            
            if (!passed) {
                const diffPercent = ((bb.upper - currentPrice) / currentPrice) * 100;
                message = `❌ Preço ($${formatPrice(currentPrice)}) abaixo da banda superior ($${formatPrice(bb.upper)}) - distância -${diffPercent.toFixed(2)}%`;
            } else {
                // NOVO CRITÉRIO: Verificar se o fechamento é menor que a máxima anterior (candle de baixa)
                if (currentCandle.close < previousCandle.high) {
                    candleConfirmed = true;
                    message = `✅ Preço acima da banda superior ($${formatPrice(currentPrice)} > $${formatPrice(bb.upper)}) | Candle de baixa confirmado (close < máxima anterior)`;
                } else {
                    message = `❌ Preço acima da banda superior, mas candle não é de baixa (close: ${formatPrice(currentCandle.close)} ≥ máxima anterior: ${formatPrice(previousCandle.high)})`;
                    passed = false;
                }
            }
        }
        
        return { passed, message, bands: bb, candleConfirmed };
    } catch (error) {
        log(`Erro ao verificar Bollinger para ${symbol}: ${error.message}`, 'error');
        return { passed: false, message: 'Erro na verificação Bollinger', candleConfirmed: false };
    }
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
// === DADOS ADICIONAIS (recebe os candles já buscados) ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice, candles1h, candles3m, candlesDaily, candles4h, candles15m) {
    try {
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        const rsi = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        const stochDaily = calculateStochastic(candlesDaily, CONFIG.STOCHASTIC.DAILY.K_PERIOD,
                                               CONFIG.STOCHASTIC.DAILY.K_SMOOTH, CONFIG.STOCHASTIC.DAILY.D_PERIOD);
        const stoch4h = calculateStochastic(candles4h, CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD,
                                            CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH, CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD);
        const stoch1h = calculateStochastic(candles1h, CONFIG.STOCHASTIC.ONE_HOUR.K_PERIOD,
                                            CONFIG.STOCHASTIC.ONE_HOUR.K_SMOOTH, CONFIG.STOCHASTIC.ONE_HOUR.D_PERIOD);
        const stoch1dFormatted = formatStochastic(stochDaily);
        const stoch4hFormatted = formatStochastic(stoch4h);
        const stoch1hFormatted = formatStochastic(stoch1h);
        
        const cci4h = calculateCCIWithEMA(candles4h, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD);
        const cciDaily = calculateCCIWithEMA(candlesDaily, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD);
        
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
            const lsrData = await rateLimiter.makeRequest(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`, `lsr_${symbol}`);
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, `funding_${symbol}`);
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        const trendStrength = checkTrendStrength(candles1h);
        return {
            rsi, stoch1d: stoch1dFormatted, stoch4h: stoch4hFormatted, stoch1h: stoch1hFormatted,
            stochDailyValues: stochDaily, stoch4hValues: stoch4h, stoch1hValues: stoch1h,
            cci4h, cciDaily,
            volume1h: { ratio: volumeRatio1h, percentage: volume1h.percentage, text: volume1h.text,
                        direction: volume1h.direction, emoji: volume1h.emoji, ratioFormatted: volumeRatio1h.toFixed(2),
                        usdt: volumeUSDT1h },
            volume3m: { ratio: volumeRatio3m, percentage: volume3m.percentage, text: volume3m.text,
                        direction: volume3m.direction, emoji: volume3m.emoji, ratioFormatted: volumeRatio3m.toFixed(2) },
            volume24h: { pct: volume24hPct, text: volume1h.text, usdt: volume24hUSDT },
            trendStrength, lsr, funding,
            candles1h, candles4h, candlesDaily, candles15m
        };
    } catch (error) {
        log(`Erro em getAdditionalData para ${symbol}: ${error.message}`, 'error');
        return {
            rsi: 50, stoch1d: 'K50⤵️D55 🟡', stoch4h: 'K50⤵️D55 🟡', stoch1h: 'K50⤵️D55 🟡',
            stochDailyValues: { k: 50, d: 55 }, stoch4hValues: { k: 50, d: 55 }, stoch1hValues: { k: 50, d: 55 },
            cci4h: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            cciDaily: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00', usdt: 0 },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro', usdt: 0 },
            trendStrength: 0, lsr: null, funding: null,
            candles1h: [], candles4h: [], candlesDaily: [], candles15m: []
        };
    }
}

// =====================================================================
// === VERIFICAÇÃO DE COOLDOWN (BLOQUEIA) ===
// =====================================================================
function isCooldownActive(symbol, direction, timeframe) {
    const now = Date.now();
    const globalKey = `${symbol}_ANY`;
    const lastGlobal = alertCache.get(globalKey);
    if (lastGlobal) {
        const minutesDiff = (now - lastGlobal.timestamp) / (1000 * 60);
        if (minutesDiff < 30) {
            log(`⏱️ Cooldown global ativo para ${symbol} (${minutesDiff.toFixed(1)}min < 30min)`, 'warning');
            return true;
        }
    }
    const specificKey = `${symbol}_${direction}_${timeframe}`;
    const lastSpecific = alertCache.get(specificKey);
    if (lastSpecific) {
        const minutesDiff = (now - lastSpecific.timestamp) / (1000 * 60);
        const required = CONFIG.ALERTS.COOLDOWN_BY_TIMEFRAME[timeframe] || 30;
        if (minutesDiff < required) {
            log(`⏱️ Cooldown ${timeframe} ativo para ${symbol} ${direction} (${minutesDiff.toFixed(1)}min < ${required}min)`, 'warning');
            return true;
        }
    }
    return false;
}

// =====================================================================
// === VERIFICAÇÃO DE LIMITE DIÁRIO (BLOQUEIA) ===
// =====================================================================
function isDailyLimitReached(symbol) {
    const dailyKey = `${symbol}_daily`;
    const count = dailyCounter.get(dailyKey) || 0;
    const limit = getDailyLimit(symbol);
    if (count >= limit) {
        log(`📅 Limite diário atingido para ${symbol}: ${count}/${limit}`, 'warning');
        return true;
    }
    return false;
}

// =====================================================================
// === REGISTRAR ALERTA (INCREMENTA CONTADOR) ===
// =====================================================================
function registerAlert(symbol, direction, price, timeframe) {
    const now = Date.now();
    const key = `${symbol}_${direction}_${timeframe}`;
    const symbolKey = `${symbol}_ANY`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    alertCache.set(key, { timestamp: now, timeframe, direction });
    alertCache.set(symbolKey, { timestamp: now, timeframe: 'ANY', direction });
    alertCache.set(priceKey, { price, timestamp: now });
    const newCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, newCount);
    saveDailyCounters(); // Persistência
    alertsSentThisScan++;
    for (const [k, v] of alertCache) {
        if (now - v.timestamp > 48 * 60 * 60 * 1000) alertCache.delete(k);
    }
    log(`Registrado alerta ${symbol} ${direction} [${timeframe}] #${newCount} do dia`, 'success');
    return newCount;
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
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        if (!response.ok) {
            const errorData = await response.text();
            log(`Erro Telegram: ${response.status}`, 'error');
        } else {
            const direction = alert.direction.includes('COMPRA') ? 'COMPRA' : 'VENDA';
            const tf = alert.timeframe === 'MULTI' ? 'MULTI' : alert.timeframe;
            const newCount = registerAlert(alert.symbol, direction, alert.price, tf);
            alert.displayDailyCount = newCount;
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
    const buyAlerts = alerts.filter(a => a.direction.includes('COMPRA'));
    const sellAlerts = alerts.filter(a => a.direction.includes('CORREÇÃO'));
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
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        log(`Alerta agrupado enviado com ${alerts.length} sinais`, 'success');
    } catch (error) {
        log(`Erro ao enviar alerta agrupado: ${error.message}`, 'error');
    }
}

// =====================================================================
// === FUNÇÃO PARA IDENTIFICAR CLUSTERS DE SUPORTE E RESISTÊNCIA ===
// =====================================================================
function findClusterLevels(candles, currentPrice, tolerancePercent = 0.5, maxClusters = 2) {
    const allSupports = [];
    const allResistances = [];
    const tolerance = tolerancePercent / 100;

    for (const candle of candles) {
        const low = candle.low;
        const high = candle.high;

        if (low < currentPrice) {
            let foundSupport = false;
            for (const cluster of allSupports) {
                const diffPercent = Math.abs(low - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + low;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundSupport = true;
                    break;
                }
            }
            if (!foundSupport) {
                allSupports.push({ avgPrice: low, touches: 1 });
            }
        }

        if (high > currentPrice) {
            let foundResistance = false;
            for (const cluster of allResistances) {
                const diffPercent = Math.abs(high - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + high;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundResistance = true;
                    break;
                }
            }
            if (!foundResistance) {
                allResistances.push({ avgPrice: high, touches: 1 });
            }
        }
    }

    allSupports.sort((a, b) => b.touches - a.touches);
    allResistances.sort((a, b) => b.touches - a.touches);

    return {
        supports: allSupports.slice(0, maxClusters),
        resistances: allResistances.slice(0, maxClusters)
    };
}

// =====================================================================
// === ANALISAR TIMEFRAME (usa candles já carregados) ===
// =====================================================================
async function analyzeDivergenceTimeframe(symbol, candles, timeframe, allCandles) {
    try {
        if (!candles || candles.length < 40) return null;
        const currentPrice = candles[candles.length - 1].close;
        const rsiValues = [];
        const prices = [];
        for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
            rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
            prices.push(candles[i].close);
        }
        if (rsiValues.length < 25) return null;
        const divergences = detectAdvancedDivergences(prices, rsiValues, timeframe);
        if (divergences.length === 0) return null;
        const bestDiv = divergences.reduce((a, b) => a.score > b.score ? a : b);
        const isGreenAlert = bestDiv.type === 'bullish';
        const direction = isGreenAlert ? 'COMPRA' : 'VENDA';

        const clusters = findClusterLevels(candles, currentPrice, 0.5, 2);

        // Usar os candles já carregados (passados via allCandles)
        const candles1h = allCandles['1h'];
        const candles3m = allCandles['3m'];
        const candlesDaily = allCandles['1d'];
        const candles4h = allCandles['4h'];
        const candles15m = allCandles['15m'];

        const additional = await getAdditionalData(symbol, currentPrice, candles1h, candles3m, candlesDaily, candles4h, candles15m);
        const volumePercentage = additional.volume1h.percentage;

        let volatilityWarning = null;
        if (CONFIG.ALERTS.MIN_15M_VOLATILITY.CHECK_TIMEFRAMES.includes(timeframe)) {
            const volatilityCheck = await check15MinVolatility(symbol);
            if (!volatilityCheck.passed) {
                volatilityWarning = volatilityCheck.message;
            }
        }

        const lsrPenalty = checkLSRPenalty(additional.lsr, isGreenAlert);
        const fundingPenalty = checkFundingPenalty(additional.funding, isGreenAlert);
        let confirmationScore = bestDiv.score;
        let totalPenalty = 0;

        if (lsrPenalty.hasPenalty) {
            confirmationScore += lsrPenalty.points;
            totalPenalty += lsrPenalty.points;
        }
        if (fundingPenalty.hasPenalty) {
            confirmationScore += fundingPenalty.points;
            totalPenalty += fundingPenalty.points;
        }
        if (totalPenalty < CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY) {
            const excess = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY - totalPenalty;
            confirmationScore -= excess;
            totalPenalty = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY;
        }

        // === CCI SCORE ADJUSTMENT ===
        let cciScoreAdjustment = 0;
        // 4h CCI
        if (isGreenAlert && additional.cci4h.trend === 'ALTA') cciScoreAdjustment += 1;
        if (isGreenAlert && additional.cci4h.trend === 'BAIXA') cciScoreAdjustment -= 1;
        if (!isGreenAlert && additional.cci4h.trend === 'BAIXA') cciScoreAdjustment += 1;
        if (!isGreenAlert && additional.cci4h.trend === 'ALTA') cciScoreAdjustment -= 1;
        // Daily CCI
        if (isGreenAlert && additional.cciDaily.trend === 'ALTA') cciScoreAdjustment += 2;
        if (isGreenAlert && additional.cciDaily.trend === 'BAIXA') cciScoreAdjustment -= 2;
        if (!isGreenAlert && additional.cciDaily.trend === 'BAIXA') cciScoreAdjustment += 2;
        if (!isGreenAlert && additional.cciDaily.trend === 'ALTA') cciScoreAdjustment -= 2;

        confirmationScore += cciScoreAdjustment;
        totalPenalty += cciScoreAdjustment;

        return {
            symbol,
            timeframe,
            timeframeEmoji: timeframe === '1d' ? '📅' : (timeframe === '4h' ? '⏰' : (timeframe === '15m' ? '⏱️' : '⏱️')),
            timeframeText: `#${timeframe.toUpperCase()}`,
            direction: isGreenAlert ? '🟢🔍 Divergência de ALTA' : '🔴🔍 Divergência de BAIXA',
            price: currentPrice,
            isGreenAlert,
            confirmationScore,
            confirmations: `Divergência ${bestDiv.subtype} (${bestDiv.emoji}) com score ${bestDiv.score}`,
            divergenceType: bestDiv.subtype,
            divergenceEmoji: bestDiv.emoji,
            rsiValue: bestDiv.rsiValue,
            priceAtDivergence: bestDiv.priceValue,
            lsrPenalty: lsrPenalty.hasPenalty,
            fundingPenalty: fundingPenalty.hasPenalty,
            totalPenalty,
            lsrValue: additional.lsr,
            fundingValue: additional.funding,
            usedTimeframe: timeframe,
            supports: clusters.supports,
            resistances: clusters.resistances,
            cci4h: additional.cci4h,
            cciDaily: additional.cciDaily,
            rsi: additional.rsi,
            stoch1d: additional.stoch1d,
            stoch4h: additional.stoch4h,
            stoch1h: additional.stoch1h,
            volume1h: additional.volume1h,
            volume3m: additional.volume3m,
            volume24h: additional.volume24h,
            trendStrength: additional.trendStrength,
            candles1h, candles4h, candlesDaily, candles15m,
            // Guarda também os candles originais para possível uso futuro
            originalCandles: candles
        };
    } catch (error) {
        log(`Erro em analyzeDivergenceTimeframe ${symbol} [${timeframe}]: ${error.message}`, 'error');
        return null;
    }
}

// =====================================================================
// === BUSCAR TODOS OS CANDLES NECESSÁRIOS DE UMA VEZ ===
// =====================================================================
async function fetchAllCandles(symbol) {
    const intervals = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3m', '1w'];
    const promises = intervals.map(interval => getCandles(symbol, interval, 100));
    const results = await Promise.all(promises);
    const map = {};
    intervals.forEach((interval, idx) => { map[interval] = results[idx]; });
    return map;
}

// =====================================================================
// === ANALISAR SÍMBOLO (COM BUSCA ÚNICA DE CANDLES) ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        // Busca todos os candles necessários uma única vez
        const allCandles = await fetchAllCandles(symbol);
        
        const divergences = [];
        for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
            const candles = allCandles[tf];
            if (candles && candles.length >= 40) {
                const result = await analyzeDivergenceTimeframe(symbol, candles, tf, allCandles);
                if (result) {
                    divergences.push(result);
                }
            }
        }
        if (divergences.length === 0) return [];

        // Encontrar a divergência com maior score para usar seus dados gerais (como preço, indicadores)
        const bestDivergence = divergences.reduce((a, b) => a.confirmationScore > b.confirmationScore ? a : b);
        let maxScore = bestDivergence.confirmationScore;
        
        const bullishCount = divergences.filter(d => d.isGreenAlert).length;
        const bearishCount = divergences.filter(d => !d.isGreenAlert).length;
        
        const supports = bestDivergence.supports || [];
        const resistances = bestDivergence.resistances || [];
        const currentPrice = bestDivergence.price;
        const proximityThreshold = CONFIG.ALERTS.PROXIMITY_THRESHOLD_PERCENT / 100;
        
        let isNearSupport = false;
        let isNearResistance = false;
        
        for (const s of supports) {
            const distancePercent = (currentPrice - s.avgPrice) / currentPrice;
            if (distancePercent >= 0 && distancePercent <= proximityThreshold) {
                isNearSupport = true;
                break;
            }
        }
        
        for (const r of resistances) {
            const distancePercent = (r.avgPrice - currentPrice) / currentPrice;
            if (distancePercent >= 0 && distancePercent <= proximityThreshold) {
                isNearResistance = true;
                break;
            }
        }
        
        let finalDirection = '';
        let isGreenAlert = false;
        
        if (bullishCount >= 2 && isNearSupport) {
            finalDirection = '🟢 COMPRA';
            isGreenAlert = true;
        } else if (bearishCount >= 2 && isNearResistance) {
            finalDirection = '🔴 CORREÇÃO ';
            isGreenAlert = false;
        } else {
            return [];
        }
        
        // =====================================================================
        // === PONTUAÇÃO DOS CLUSTERS (BÔNUS POR FORÇA) ===
        // =====================================================================
        let clusterScoreBonus = 0;
        let clusterInfo = '';

        // Calcula bônus para suporte (se estiver perto)
        if (isNearSupport && supports.length > 0) {
            const strongestSupport = supports.reduce((a, b) => a.touches > b.touches ? a : b);
            // Bônus base: 0.3 por toque, máximo 2.0 pontos
            let bonus = Math.min(2.0, strongestSupport.touches * 0.3);
            clusterScoreBonus += bonus;
            clusterInfo += ` 📈 Suporte +${bonus.toFixed(1)} (${strongestSupport.touches} toques)`;
            log(`Cluster bonus SUPPORT: +${bonus} para ${symbol} (${strongestSupport.touches} toques)`, 'info');
        }

        // Calcula bônus para resistência (se estiver perto)
        if (isNearResistance && resistances.length > 0) {
            const strongestResistance = resistances.reduce((a, b) => a.touches > b.touches ? a : b);
            // Bônus base: 0.3 por toque, máximo 2.0 pontos
            let bonus = Math.min(2.0, strongestResistance.touches * 0.3);
            clusterScoreBonus += bonus;
            clusterInfo += ` 📉 Resistência +${bonus.toFixed(1)} (${strongestResistance.touches} toques)`;
            log(`Cluster bonus RESISTANCE: +${bonus} para ${symbol} (${strongestResistance.touches} toques)`, 'info');
        }

        // Bônus adicional se houver MÚLTIPLOS clusters (mais confirmação)
        if ((isNearSupport && supports.length >= 2) || (isNearResistance && resistances.length >= 2)) {
            const multiBonus = 1.5;  // Aumentado de 0.5 para 1.5
            clusterScoreBonus += multiBonus;
            clusterInfo += ` 🔥 Multi-cluster +${multiBonus}`;
            log(`Multi-cluster bonus: +${multiBonus} para ${symbol}`, 'info');
}

        // Adiciona o bônus ao score final
        maxScore += clusterScoreBonus;
        
        // Verifica Bollinger com confirmação de candle
        const bollingerCheck = await checkBollingerCondition(symbol, isGreenAlert);
        if (!bollingerCheck.passed) {
            log(`❌ ${symbol} - ${finalDirection} bloqueado: ${bollingerCheck.message}`, 'warning');
            return [];
        }
        
        // Verifica cooldown e limite diário
        const directionStr = finalDirection.includes('COMPRA') ? 'COMPRA' : 'VENDA';
        if (isCooldownActive(symbol, directionStr, 'MULTI')) return [];
        if (isDailyLimitReached(symbol)) return [];
        
        // Escolhe o timeframe para cálculo de stop e alvos (o com maior score ou padrão 1h)
        let timeframeForTargets = '1h';
        let candlesForTargets = allCandles['1h'];
        if (bestDivergence.usedTimeframe && allCandles[bestDivergence.usedTimeframe] && allCandles[bestDivergence.usedTimeframe].length >= 20) {
            timeframeForTargets = bestDivergence.usedTimeframe;
            candlesForTargets = allCandles[timeframeForTargets];
        }
        
        // Calcula stop e alvos com a direção correta
        const { stop, tp1, tp2, tp3 } = computeStopAndTargets(currentPrice, isGreenAlert, timeframeForTargets, candlesForTargets);
        
        const bbInfo = bollingerCheck.bands ? 
            `📊 BB 15m: ${formatPrice(bollingerCheck.bands.lower)} / ${formatPrice(bollingerCheck.bands.middle)} / ${formatPrice(bollingerCheck.bands.upper)}` : '';
        
        const consolidated = {
            ...bestDivergence, // herda propriedades como volume, rsi, stoch, etc.
            timeframe: 'MULTI',
            timeframeEmoji: '✨',
            timeframeText: '#MULTI',
            direction: finalDirection,
            confirmationScore: maxScore,  // Score com bônus dos clusters
            clusterBonus: clusterScoreBonus,  // Guarda o valor do bônus
            clusterInfo: clusterInfo,  // Informação do bônus para log
            divergencesList: divergences.map(d => ({
                timeframe: d.timeframe,
                type: d.direction,
                subtype: d.divergenceType,
                score: d.confirmationScore,
                rsiValue: d.rsiValue,
                priceAtDivergence: d.priceAtDivergence,
                emoji: d.divergenceEmoji
            })),
            bullishCount,
            bearishCount,
            isNearSupport,
            isNearResistance,
            finalText: (isGreenAlert ? `Potencial de Compra (${bullishCount} divergências de ALTA + próximo ao suporte)` : `Potencial de Correção (${bearishCount} divergências de BAIXA + próximo à resistência)`),
            bollingerMessage: bollingerCheck.message,
            bollingerInfo: bbInfo,
            candleConfirmed: bollingerCheck.candleConfirmed,
            stopLoss: stop,
            tp1, tp2, tp3,
            // Garante que os dados de volume e indicadores sejam os do bestDivergence
            volume1h: bestDivergence.volume1h,
            volume3m: bestDivergence.volume3m,
            volume24h: bestDivergence.volume24h,
            rsi: bestDivergence.rsi,
            stoch1d: bestDivergence.stoch1d,
            stoch4h: bestDivergence.stoch4h,
            stoch1h: bestDivergence.stoch1h,
            cci4h: bestDivergence.cci4h,
            cciDaily: bestDivergence.cciDaily,
            supports: bestDivergence.supports,
            resistances: bestDivergence.resistances,
            lsrValue: bestDivergence.lsrValue,
            fundingValue: bestDivergence.fundingValue,
            lsrPenalty: bestDivergence.lsrPenalty,
            fundingPenalty: bestDivergence.fundingPenalty,
            totalPenalty: bestDivergence.totalPenalty
        };
        
        queueAlert(consolidated);
        return [consolidated];
    } catch (error) {
        log(`Erro em analyzeSymbol ${symbol}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === FORMATAR MENSAGEM (SIMPLIFICADA COM 3 ALVOS E STOP CORRETOS) ===
// =====================================================================
function formatAlert(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbol}&interval=60`;
    const fundingPct = data.fundingValue ? (data.fundingValue * 100).toFixed(4) : '0.0000';
    const fundingSign = data.fundingValue && data.fundingValue > 0 ? '+' : '';
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '⚪';
    const lsr = data.lsrValue ? data.lsrValue.toFixed(2) : 'N/A';
    const volumeEmoji = data.volume1h.emoji;
    const volumeDirectionText = data.volume1h.direction !== 'Neutro' ? `${volumeEmoji} ${data.volume1h.direction}` : '⚪ Neutro';
    const volume1hLine = `#Vol 1h: ${data.volume1h.ratioFormatted}x (${data.volume1h.percentage.toFixed(0)}%) ${volumeDirectionText}`;
    const volume3mLine = `#Vol 3m: ${data.volume3m.ratioFormatted}x (${data.volume3m.percentage.toFixed(0)}%) ${data.volume3m.text}`;
    
    let divergencesText = '';
    if (data.divergencesList && data.divergencesList.length > 0) {
        const tfList = data.divergencesList.map(d => d.timeframe).join(',');
        divergencesText = `${data.bullishCount + data.bearishCount} divergências (${tfList})`;
    } else {
        divergencesText = `${data.divergenceType}`;
    }
    
    let proximityInfo = '';
    if (data.isNearSupport && data.bullishCount >= 2) {
        proximityInfo = `📈 Próx. suporte (${data.bullishCount} divergências)`;
    } else if (data.isNearResistance && data.bearishCount >= 2) {
        proximityInfo = `📉 Próx. resistência (${data.bearishCount} divergências)`;
    }
    
    const targets = `🎯 TP1: ${formatPrice(data.tp1)} | TP2: ${formatPrice(data.tp2)} | TP3: ${formatPrice(data.tp3)}`;
    const stop = `🛑 SL: ${formatPrice(data.stopLoss)}`;
    
    let supportLine = '';
    if (data.supports && data.supports.length > 0) {
        const supportStrings = data.supports.map(s => `${formatPrice(s.avgPrice)} (${s.touches}x)`).join(' | ');
        supportLine = `Suporte: ${supportStrings}`;
    }
    let resistanceLine = '';
    if (data.resistances && data.resistances.length > 0) {
        const resistanceStrings = data.resistances.map(r => `${formatPrice(r.avgPrice)} (${r.touches}x)`).join(' | ');
        resistanceLine = `Resistência: ${resistanceStrings}`;
    }
    
    const cci4hText = data.cci4h && data.cci4h.text ? data.cci4h.text : 'CCI 4H N/A';
    const cciDailyText = data.cciDaily && data.cciDaily.text ? data.cciDaily.text : 'CCI 1D N/A';
    
    const candleConfirmEmoji = data.candleConfirmed ? '🕯️✅' : '🕯️❌';
    
    const dailyCount = data.displayDailyCount || (dailyCounter.get(`${data.symbol}_daily`) || 0);
    
    return `<i>${data.direction} - ${symbolName} | ${time.time}
💲 ${formatPrice(data.price)} | Score: ${data.confirmationScore.toFixed(1)}
🔍 ${divergencesText}
${targets}
${stop}
▫️Vol 24h: ${data.volume24h.pct} ${data.volume24h.text}
#RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} | <a href="${tradingViewLink}">🔗 TV</a>
${volume3mLine}
${volume1hLine}
#LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
Stoch 1D: ${data.stoch1d}
Stoch 4H: ${data.stoch4h}
CCI 4H:${cci4hText}
CCI 1D:${cciDailyText}
${supportLine ? supportLine : ''}
${resistanceLine ? resistanceLine : ''}
${data.lsrPenalty ? `⚠️ LSR ${data.lsrValue.toFixed(2)}` : ''}${data.fundingPenalty ? ` ⚠️ Funding ${fundingSign}${fundingPct}%` : ''}${data.totalPenalty < 0 ? ` ⚠️ Penal: ${data.totalPenalty}` : ''}

 🤖...Alerta Educativo, não é recomendação de investimento.
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
        const initMessage = `🚀 Titanium Prime Ativado\n` +
            `Monitorando: ${currentTopSymbols.length} símbolos\n` +
            `${getBrazilianDateTime().full}`;
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: initMessage, parse_mode: 'HTML' })
        });
        if (response.ok) log('Mensagem de inicialização enviada', 'success');
        else log(`Erro ao enviar mensagem de inicialização: ${response.status}`, 'warning');
    } catch (e) {
        log(`Erro ao enviar mensagem de inicialização: ${e.message}`, 'warning');
    }
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            saveDailyCounters(); // Limpa arquivo ao resetar
            log('Contadores diários resetados', 'info');
        }
    }, 60000);
    setInterval(() => processPriorityQueue(), 30000);
    let scanCount = 0;
    while (true) {
        try {
            scanCount++;
            alertsSentThisScan = 0;
            log(`Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                log(`Batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)}`, 'info');
                await Promise.allSettled(batch.map(symbol => analyzeSymbol(symbol)));
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

// Carrega contadores diários do arquivo antes de iniciar o scanner
loadDailyCounters();

startScanner().catch(console.error);
