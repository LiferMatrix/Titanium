const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const z = require('zod');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === SCHEMAS DE VALIDAÇÃO ZOD ===
// =====================================================================

// Schemas para dados da Binance
const CandleSchema = z.object({
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().positive(),
    time: z.number().int(),
    isClosed: z.boolean()
});

const KlineResponseSchema = z.array(
    z.tuple([
        z.number(), // open time
        z.string(), // open
        z.string(), // high
        z.string(), // low
        z.string(), // close
        z.string(), // volume
        z.number(), // close time
        z.string(), // quote asset volume
        z.number(), // number of trades
        z.string(), // taker buy base asset volume
        z.string(), // taker buy quote asset volume
        z.string()  // ignore
    ])
);

const LSRResponseSchema = z.array(
    z.object({
        longShortRatio: z.string(),
        longAccount: z.string(),
        shortAccount: z.string(),
        symbol: z.string().optional()
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

// Schemas para indicadores
const CCISchema = z.object({
    value: z.number(),
    ema5: z.number(),
    ema13: z.number(),
    previousEma5: z.number(),
    previousEma13: z.number(),
    isCrossingUp: z.boolean(),
    isCrossingDown: z.boolean(),
    timeframe: z.string()
});

const RSISchema = z.object({
    value: z.number().min(0).max(100),
    status: z.enum(['OVERSOLD', 'OVERBOUGHT', 'NEUTRAL'])
});

const EMACheckSchema = z.object({
    isValid: z.boolean(),
    analysis: z.string().optional(),
    ema13: z.number(),
    ema34: z.number(),
    ema55: z.number(),
    lastPrice: z.number(),
    error: z.string().optional()
}).passthrough();

const VolumeAnalysisSchema = z.object({
    direction: z.enum(['Comprador', 'Vendedor', 'Neutro', 'Desconhecido', 'Erro']),
    percentage: z.number().min(0).max(100),
    sellerPercentage: z.number().min(0).max(100).optional(),
    emoji: z.string()
});

// Schema para Volume 3m
const Volume3mSchema = z.object({
    direction: z.enum(['Comprador', 'Vendedor', 'Neutro', 'Desconhecido', 'Erro']),
    percentage: z.number().min(0).max(100),
    sellerPercentage: z.number().min(0).max(100).optional(),
    emoji: z.string(),
    score: z.number().min(-30).max(30).optional()
});

const PivotPointSchema = z.object({
    pivot: z.number(),
    resistances: z.array(z.any()),
    supports: z.array(z.any()),
    nearestResistance: z.any().nullable(),
    nearestSupport: z.any().nullable(),
    nearestPivot: z.any().nullable()
}).passthrough();

const ATRTargetsSchema = z.object({
    atr: z.number().positive(),
    targets: z.record(z.string(), z.number()),
    multipliers: z.array(z.number())
}).nullable();

const RetestDataSchema = z.object({
    level: z.number(),
    type: z.enum(['SUPORTE', 'RESISTÊNCIA']),
    distance: z.number(),
    totalTests: z.number().int(),
    successRate: z.number(),
    volumeRatio: z.number(),
    falseBreakout: z.boolean(),
    isHistoric: z.boolean(),
    timestamp: z.number()
}).nullable();

// Schema principal do sinal
const CCISignalSchema = z.object({
    symbol: z.string().regex(/^[A-Z0-9]+USDT$/),
    type: z.enum(['CCI_COMPRA', 'CCI_VENDA']),
    cci: CCISchema,
    rsi: z.number().min(0).max(100).optional().nullable(),
    rsi15m: z.number().min(0).max(100).optional().nullable(),
    rsi15mDirection: z.enum(['subindo', 'descendo', 'estável']).optional().nullable(),
    lsr: z.number().optional().nullable(),
    funding: z.string().optional().nullable(),
    pivotData: PivotPointSchema.nullable(),
    currentPrice: z.number().positive(),
    entryPrice: z.number().positive(),
    entryRetraction: z.object({
        entryPrice: z.number(),
        retractionRange: z.object({
            min: z.number(),
            max: z.number(),
            amount: z.number(),
            percent: z.number()
        }).nullable()
    }),
    time: z.object({
        date: z.string(),
        time: z.string(),
        full: z.string()
    }),
    isFreshCross: z.boolean(),
    atrTargets: ATRTargetsSchema,
    srLevels: z.any().nullable(),
    emaCheck: EMACheckSchema,
    volumeData: VolumeAnalysisSchema,
    volume3mData: Volume3mSchema,
    retestData: RetestDataSchema
});

// Schema para o ErrorHandler
const ErrorResponseSchema = z.object({
    type: z.string(),
    retryable: z.boolean(),
    message: z.string(),
    context: z.string(),
    timestamp: z.number()
});

// =====================================================================
// === CONFIGURAÇÕES DE RSI 1H PARA ALERTAS ===
// =====================================================================
const RSI_1H_CONFIG = {
    COMPRA: {
        MAX_RSI: 64,
        ENABLED: true
    },
    VENDA: {
        MIN_RSI: 40,
        ENABLED: true
    }
};

// =====================================================================
// === CONFIGURAÇÕES DE RSI 15M PARA ALERTAS ===
// =====================================================================
const RSI_15M_CONFIG = {
    COMPRA: {
        DIRECTION: 'subindo', // RSI precisa estar subindo
        ENABLED: true
    },
    VENDA: {
        DIRECTION: 'descendo', // RSI precisa estar descendo
        ENABLED: true
    }
};

// =====================================================================
// === CONFIGURAÇÕES DE LSR 15M PARA ALERTAS ===
// =====================================================================
const LSR_15M_CONFIG = {
    COMPRA: {
        MAX_LSR: 2.7, // LSR deve ser menor que 2.7 para compra
        ENABLED: true
    },
    VENDA: {
        ENABLED: false // Venda não tem critério de LSR
    }
};

// =====================================================================
// === CONFIGURAÇÕES DE VOLUME 1H OBRIGATÓRIO ===
// =====================================================================
const VOLUME_1H_CONFIG = {
    COMPRA: {
        MIN_BUYER_PERCENTAGE: 30, // Mínimo de 52% volume comprador
        ENABLED: true
    },
    VENDA: {
        MIN_SELLER_PERCENTAGE: 30, // Mínimo de 52% volume vendedor
        ENABLED: true
    }
};

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    CCI: {
        ENABLED: true,
        TIMEFRAME: '15m',           // CCI no timeframe de 1h
        LENGTH: 20,                 // Período do CCI
        EMA_SHORT: 5,               // EMA Curta sobre o CCI
        EMA_LONG: 13,                // EMA Longa sobre o CCI
        SOURCE: 'hlc3'               // Fonte: high+low+close/3
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 100,
        CYCLE_DELAY_MS: 15000,
        MAX_SYMBOLS_PER_CYCLE: 0,
        COOLDOWN_MINUTES: 5,
        CANDLE_CACHE_TTL: 120000,
        MAX_CACHE_AGE: 15 * 60 * 1000,
        BATCH_SIZE: 10,
        REQUEST_TIMEOUT: 10000
    },
    CLEANUP: {
        INTERVAL: 10 * 60 * 1000,
        MAX_LOG_DAYS: 7,
        MAX_CACHE_DAYS: 1,
        MEMORY_THRESHOLD: 500 * 1024 * 1024
    },
    RETEST: {
        ENABLED: true,
        TOLERANCE_PERCENT: 0.3,
        MAX_DISTANCE_PERCENT: 1.0,
        MIN_TESTS_FOR_HISTORIC: 3,
        VOLUME_THRESHOLD: 1.2,
        TIMEFRAMES: {
            PRIMARY: '15m',
            CONFIRMATION: '5m',
            CONTEXT: '1h'
        }
    },
    RATE_LIMITER: {
        INITIAL_DELAY: 100,
        MAX_DELAY: 2000,
        BACKOFF_FACTOR: 1.5,
        CONSECUTIVE_ERRORS_LIMIT: 5
    }
};

// =====================================================================
// === CONFIGURAÇÃO EMA 3 MINUTOS ===
// =====================================================================
const EMA_CONFIG = {
    TIMEFRAME: '3m',
    EMA13: 13,
    EMA34: 34,
    EMA55: 55,
    ENTRY_RETRACTION_FACTOR: 0.9,
    MAX_RETRACTION_PERCENT: 2.0
};

// =====================================================================
// === DIRETÓRIOS E VARIÁVEIS GLOBAIS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';

let alertCounter = {};
let dailyAlerts = 0;
let globalAlerts = 0;
let lastResetDate = null;

const symbolCooldown = {};
const cciCooldown = {};
const cciCrossState = {};

// === CACHE DE CANDLES OTIMIZADO ===
const candleCache = new Map();
const cacheStats = {
    hits: 0,
    misses: 0,
    lastCleanup: Date.now()
};

// =====================================================================
// === RATE LIMITER OTIMIZADO ===
// =====================================================================
class OptimizedRateLimiter {
    constructor() {
        this.currentDelay = CONFIG.RATE_LIMITER.INITIAL_DELAY;
        this.consecutiveErrors = 0;
        this.maxDelay = CONFIG.RATE_LIMITER.MAX_DELAY;
        this.backoffFactor = CONFIG.RATE_LIMITER.BACKOFF_FACTOR;
        this.errorsByEndpoint = new Map();
        this.requestCount = 0;
        this.lastRequestTime = Date.now();
        this.pendingRequests = 0;
    }

    async makeRequest(url, options = {}, type = 'klines') {
        this.pendingRequests++;
        this.requestCount++;
        
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.currentDelay) {
            await new Promise(r => setTimeout(r, this.currentDelay - timeSinceLastRequest));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(), 
                CONFIG.PERFORMANCE.REQUEST_TIMEOUT
            );

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            this.lastRequestTime = Date.now();

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.response = { status: response.status };
                throw error;
            }

            const data = await response.json();

            this.consecutiveErrors = 0;
            this.currentDelay = Math.max(
                CONFIG.RATE_LIMITER.INITIAL_DELAY,
                this.currentDelay * 0.95
            );

            this.errorsByEndpoint.set(type, 0);
            
            this.pendingRequests--;
            return data;

        } catch (error) {
            this.consecutiveErrors++;
            
            const endpointErrors = (this.errorsByEndpoint.get(type) || 0) + 1;
            this.errorsByEndpoint.set(type, endpointErrors);

            this.currentDelay = Math.min(
                this.maxDelay,
                this.currentDelay * this.backoffFactor
            );

            if (this.consecutiveErrors % 3 === 0) {
                console.warn(`⚠️ RateLimiter [${type}]: ${this.consecutiveErrors} erros, delay=${Math.round(this.currentDelay)}ms`);
            }

            this.pendingRequests--;
            throw error;
        }
    }

    getStats() {
        return {
            currentDelay: this.currentDelay,
            consecutiveErrors: this.consecutiveErrors,
            pendingRequests: this.pendingRequests,
            totalRequests: this.requestCount
        };
    }
}

// =====================================================================
// === CACHE MANAGER OTIMIZADO ===
// =====================================================================
class CacheManager {
    static get(symbol, timeframe, limit) {
        const key = `${symbol}_${timeframe}_${limit}`;
        const cached = candleCache.get(key);
        
        if (cached && Date.now() - cached.timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            cacheStats.hits++;
            return cached.data;
        }
        
        cacheStats.misses++;
        return null;
    }

    static set(symbol, timeframe, limit, data) {
        const key = `${symbol}_${timeframe}_${limit}`;
        
        if (candleCache.size > 5000) {
            this.cleanup(0.3);
        }
        
        candleCache.set(key, {
            data,
            timestamp: Date.now(),
            accessCount: 1,
            lastAccess: Date.now()
        });
    }

    static cleanup(percentToRemove = 0.2) {
        const now = Date.now();
        const entries = Array.from(candleCache.entries());
        
        const entriesWithScore = entries.map(([key, value]) => {
            const age = now - value.timestamp;
            const accessScore = 1 / (value.accessCount || 1);
            const ageScore = age / CONFIG.PERFORMANCE.MAX_CACHE_AGE;
            const removeScore = (ageScore * 0.7) + (accessScore * 0.3);
            
            return { key, value, removeScore };
        });
        
        entriesWithScore.sort((a, b) => b.removeScore - a.removeScore);
        
        const removeCount = Math.floor(entries.length * percentToRemove);
        const removed = entriesWithScore.slice(0, removeCount);
        
        removed.forEach(item => candleCache.delete(item.key));
        
        cacheStats.lastCleanup = now;
        return removed.length;
    }

    static getStats() {
        const hitRate = cacheStats.hits + cacheStats.misses > 0 
            ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(1)
            : 0;
            
        return {
            size: candleCache.size,
            hits: cacheStats.hits,
            misses: cacheStats.misses,
            hitRate: `${hitRate}%`,
            lastCleanup: new Date(cacheStats.lastCleanup).toLocaleTimeString()
        };
    }
}

// =====================================================================
// === ERROR HANDLER OTIMIZADO ===
// =====================================================================
class ErrorHandler {
    static NETWORK_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'];
    static BINANCE_ERRORS = {
        429: 'RATE_LIMIT_EXCEEDED',
        418: 'IP_BANNED',
        451: 'TEMPORARY_BANNED',
        403: 'ACCESS_DENIED',
        400: 'BAD_REQUEST',
        404: 'NOT_FOUND',
        500: 'INTERNAL_SERVER_ERROR',
        502: 'BAD_GATEWAY',
        503: 'SERVICE_UNAVAILABLE',
        504: 'GATEWAY_TIMEOUT'
    };
    
    static handle(error, context = '') {
        const errorResponse = {
            type: 'UNKNOWN_ERROR',
            retryable: false,
            message: error.message,
            context,
            timestamp: Date.now()
        };

        if (this.NETWORK_ERRORS.includes(error.code)) {
            errorResponse.type = 'NETWORK_ERROR';
            errorResponse.retryable = true;
            errorResponse.message = `Falha de rede: ${error.code}`;
            console.log(`🌐 Rede [${context}]: ${error.code}`);
            
            return errorResponse;
        }

        if (error.name === 'AbortError' || error.code === 'TIMEOUT') {
            errorResponse.type = 'TIMEOUT_ERROR';
            errorResponse.retryable = true;
            errorResponse.message = 'Timeout da requisição';
            console.log(`⏰ Timeout [${context}]`);
            
            return errorResponse;
        }

        if (error.response?.status) {
            const status = error.response.status;
            const binanceError = this.BINANCE_ERRORS[status] || 'HTTP_ERROR';
            errorResponse.type = binanceError;
            errorResponse.retryable = [429, 500, 502, 503, 504].includes(status);
            errorResponse.message = `HTTP ${status}`;
            
            if (status !== 429) {
                console.log(`⚠️ HTTP ${status} [${context}]`);
            }
            
            return errorResponse;
        }

        if (error instanceof SyntaxError && error.message.includes('JSON')) {
            errorResponse.type = 'PARSE_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = 'Erro ao processar resposta';
            console.log(`🔧 Parse [${context}]`);
            
            return errorResponse;
        }

        if (error instanceof z.ZodError) {
            errorResponse.type = 'ZOD_VALIDATION_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = 'Erro de validação';
            return errorResponse;
        }

        if (!errorResponse.type.includes('ZOD')) {
            console.log(`❌ Erro [${context}]: ${error.message.substring(0, 50)}`);
        }
        
        return errorResponse;
    }

    static async retry(fn, context, maxRetries = 2, baseDelay = 500) {
        let lastError;
       
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const errorInfo = this.handle(error, `${context} (${attempt}/${maxRetries})`);
               
                if (!errorInfo.retryable || attempt === maxRetries) {
                    break;
                }
               
                const delay = baseDelay * Math.pow(1.5, attempt - 1) + Math.random() * 200;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
       
        throw lastError;
    }
}

// =====================================================================
// === FUNÇÕES AUXILIARES OTIMIZADAS ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

function getBrazilianHour() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.getHours();
}

function getBrazilianDateString() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.toISOString().split('T')[0];
}

function formatItalic(text) {
    return `<i>${text}</i>`;
}

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    } catch (error) {
        ErrorHandler.handle(error, 'SendTelegram');
        return false;
    }
}

function getAlertCountForSymbol(symbol, type) {
    const currentDate = getBrazilianDateString();
   
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
   
    if (!alertCounter[symbol]) {
        alertCounter[symbol] = {
            cci: 0,
            total: 0,
            lastAlert: null,
            dailyCCI: 0,
            dailyTotal: 0
        };
    }
   
    alertCounter[symbol][type.toLowerCase()]++;
    alertCounter[symbol].total++;
    alertCounter[symbol][`daily${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`]++;
    alertCounter[symbol].dailyTotal++;
    alertCounter[symbol].lastAlert = Date.now();
   
    dailyAlerts++;
    globalAlerts++;
   
    return {
        symbolDailyCCI: alertCounter[symbol].dailyCCI
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
   
    console.log(`\n🕘 ${getBrazilianDateTime().full} - Resetando contadores diários`);
   
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyCCI = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
   
    dailyAlerts = 0;
    lastResetDate = currentDate;
}

async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
       
        const message = `
<i>🚀 TITANIUM CCI 1H INICIADO ✅</i>
<i>📈 Cache Hit Rate: ${CacheManager.getStats().hitRate}</i>
`;
        console.log('📤 Enviando mensagem de inicialização...');
        await sendTelegramAlert(message);
        return true;
    } catch (error) {
        ErrorHandler.handle(error, 'SendInitMessage');
        return false;
    }
}

// =====================================================================
// === FUNÇÕES DE ANÁLISE TÉCNICA OTIMIZADAS ===
// =====================================================================
async function getCandles(symbol, timeframe, limit = 80) {
    const cached = CacheManager.get(symbol, timeframe, limit);
    if (cached) {
        return cached;
    }

    try {
        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h',
            '12h': '12h', '1d': '1d'
        };
        
        const interval = intervalMap[timeframe] || '1h';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'klines'),
            `Candles-${symbol}`,
            2,
            500
        );
        
        const validatedData = KlineResponseSchema.parse(data);
        
        const candles = validatedData.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0],
            isClosed: candle[0] + candle[6] < Date.now()
        }));
        
        const validatedCandles = candles.map(candle => CandleSchema.parse(candle));
        
        CacheManager.set(symbol, timeframe, limit, validatedCandles);
        
        return validatedCandles;
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw new Error(`Dados inválidos: ${symbol}`);
        }
        throw error;
    }
}

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

function calculateSMA(values, period) {
    if (values.length < period) return values[values.length - 1];
    const slice = values.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateDeviation(values, period, mean) {
    if (values.length < period) return 0;
    const slice = values.slice(-period);
    const squaredDiffs = slice.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    return Math.sqrt(variance);
}

async function getCCI(symbol, timeframe = CONFIG.CCI.TIMEFRAME) {
    try {
        const candles = await getCandles(symbol, timeframe, 80);
        if (candles.length < CONFIG.CCI.LENGTH + 20) {
            return null;
        }
        
        const length = CONFIG.CCI.LENGTH;
        
        // Calcular valores típicos (HLC3)
        const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
        
        // Calcular SMA dos preços típicos
        const smaValues = [];
        for (let i = length - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - length + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / length;
            smaValues.push(sma);
        }
        
        // Calcular desvio médio
        const meanDeviations = [];
        for (let i = length - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - length + 1, i + 1);
            const sma = smaValues[i - (length - 1)];
            const meanDev = slice.reduce((sum, price) => sum + Math.abs(price - sma), 0) / length;
            meanDeviations.push(meanDev);
        }
        
        // Calcular CCI
        const cciValues = [];
        for (let i = 0; i < smaValues.length; i++) {
            const tp = typicalPrices[i + (length - 1)];
            const sma = smaValues[i];
            const meanDev = meanDeviations[i];
            
            if (meanDev === 0) {
                cciValues.push(0);
            } else {
                const cci = (tp - sma) / (0.015 * meanDev);
                cciValues.push(cci);
            }
        }
        
        if (cciValues.length < Math.max(CONFIG.CCI.EMA_LONG, CONFIG.CCI.EMA_SHORT) + 2) {
            return null;
        }
        
        // Calcular EMAs sobre o CCI
        const emaShort = calculateEMA(cciValues, CONFIG.CCI.EMA_SHORT);
        const emaLong = calculateEMA(cciValues, CONFIG.CCI.EMA_LONG);
        
        // Calcular valores anteriores para detectar cruzamento
        const prevCciValues = cciValues.slice(0, -1);
        const prevEmaShort = prevCciValues.length >= CONFIG.CCI.EMA_SHORT 
            ? calculateEMA(prevCciValues, CONFIG.CCI.EMA_SHORT) 
            : emaShort;
        const prevEmaLong = prevCciValues.length >= CONFIG.CCI.EMA_LONG 
            ? calculateEMA(prevCciValues, CONFIG.CCI.EMA_LONG) 
            : emaLong;
        
        const isCrossingUp = prevEmaShort <= prevEmaLong && emaShort > emaLong;
        const isCrossingDown = prevEmaShort >= prevEmaLong && emaShort < emaLong;
        
        const cciResult = {
            value: cciValues[cciValues.length - 1],
            ema5: emaShort,
            ema13: emaLong,
            previousEma5: prevEmaShort,
            previousEma13: prevEmaLong,
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            timeframe: timeframe
        };
        
        return CCISchema.parse(cciResult);
       
    } catch (error) {
        return null;
    }
}

async function checkEMA3m(symbol, signalType) {
    try {
        const candles = await getCandles(symbol, EMA_CONFIG.TIMEFRAME, 100);
        if (candles.length < Math.max(EMA_CONFIG.EMA55, EMA_CONFIG.EMA34)) {
            return { isValid: false, error: 'Candles insuficientes' };
        }
        
        const closes = candles.map(c => c.close);
        const lastCandle = candles[candles.length - 1];
       
        const ema13 = calculateEMA(closes, EMA_CONFIG.EMA13);
        const ema34 = calculateEMA(closes, EMA_CONFIG.EMA34);
        const ema55 = calculateEMA(closes, EMA_CONFIG.EMA55);
       
        const prevCloses = closes.slice(0, -1);
        const prevEma13 = calculateEMA(prevCloses, EMA_CONFIG.EMA13);
        const prevEma34 = calculateEMA(prevCloses, EMA_CONFIG.EMA34);
       
        let isValid = false;
        let analysis = '';
       
        if (signalType === 'CCI_COMPRA') {
            const emaCrossUp = prevEma13 <= prevEma34 && ema13 > ema34;
            const priceAboveEma55 = lastCandle.close > ema55;
            isValid = emaCrossUp && priceAboveEma55;
            analysis = `📊 EMA: ${emaCrossUp ? '✅' : '❌'} Cruz 13/34 | ${priceAboveEma55 ? '✅' : '❌'} Preço > EMA55`;
        } else {
            const emaCrossDown = prevEma13 >= prevEma34 && ema13 < ema34;
            const priceBelowEma55 = lastCandle.close < ema55;
            isValid = emaCrossDown && priceBelowEma55;
            analysis = `📊 EMA: ${emaCrossDown ? '✅' : '❌'} Cruz 13/34 | ${priceBelowEma55 ? '✅' : '❌'} Preço < EMA55`;
        }
        
        return {
            isValid,
            analysis,
            ema13,
            ema34,
            ema55,
            lastPrice: lastCandle.close
        };
       
    } catch (error) {
        return { isValid: false, error: error.message };
    }
}

async function getCurrentPrice(symbol) {
    try {
        const candles = await getCandles(symbol, '1m', 1);
        return candles[candles.length - 1].close;
    } catch (error) {
        return 0;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 80);
        if (candles.length < 14) {
            return null;
        }
        
        const closes = candles.map(c => c.close);
       
        let gains = 0;
        let losses = 0;
       
        for (let i = 1; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
       
        const avgGain = gains / 14;
        const avgLoss = losses / 14 || 0.001;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return {
            value: rsi,
            status: rsi < 25 ? 'OVERSOLD' : rsi > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        return null;
    }
}

async function getRSI15m(symbol) {
    try {
        const candles = await getCandles(symbol, '15m', 30);
        if (candles.length < 15) {
            return null;
        }
        
        const closes = candles.map(c => c.close);
        
        // Calcular RSI atual
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / 14;
        const avgLoss = losses / 14 || 0.001;
        const rs = avgGain / avgLoss;
        const currentRSI = 100 - (100 / (1 + rs));
        
        // Calcular RSI anterior (para ver direção)
        const prevCloses = closes.slice(0, -1);
        let prevGains = 0;
        let prevLosses = 0;
        
        for (let i = 1; i < prevCloses.length; i++) {
            const difference = prevCloses[i] - prevCloses[i - 1];
            if (difference > 0) {
                prevGains += difference;
            } else {
                prevLosses += Math.abs(difference);
            }
        }
        
        const prevAvgGain = prevGains / 14;
        const prevAvgLoss = prevLosses / 14 || 0.001;
        const prevRs = prevAvgGain / prevAvgLoss;
        const prevRSI = 100 - (100 / (1 + prevRs));
        
        // Determinar direção
        let direction = 'estável';
        if (currentRSI > prevRSI + 0.5) {
            direction = 'subindo';
        } else if (currentRSI < prevRSI - 0.5) {
            direction = 'descendo';
        }
        
        return {
            value: currentRSI,
            previousValue: prevRSI,
            direction: direction
        };
    } catch (error) {
        return null;
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const response = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'lsr'),
            `LSR-${symbol}`,
            1,
            300
        );
        
        const validatedResponse = LSRResponseSchema.parse(response);
       
        if (!validatedResponse || validatedResponse.length === 0) {
            return null;
        }
       
        const data = validatedResponse[0];
        return {
            lsrValue: parseFloat(data.longShortRatio),
            longAccount: parseFloat(data.longAccount),
            shortAccount: parseFloat(data.shortAccount)
        };
    } catch (error) {
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'fundingRate'),
            `Funding-${symbol}`,
            1,
            300
        );
        
        const validatedData = FundingRateSchema.parse(data);
        
        if (!validatedData || validatedData.length === 0) {
            return null;
        }
        
        const fundingRate = parseFloat(validatedData[0].fundingRate);
       
        return {
            rate: fundingRate,
            ratePercent: (fundingRate * 100).toFixed(5)
        };
    } catch (error) {
        return null;
    }
}

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandles(symbol, '15m', 50);
        if (candles.length < 20) {
            return null;
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
       
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
       
        const pivot = (recentHigh + recentLow + candles[candles.length - 1].close) / 3;
        const r1 = (2 * pivot) - recentLow;
        const s1 = (2 * pivot) - recentHigh;
        const r2 = pivot + (recentHigh - recentLow);
        const s2 = pivot - (recentHigh - recentLow);
       
        const resistances = [
            { price: r1, type: 'R1', distancePercent: ((r1 - currentPrice) / currentPrice) * 100 },
            { price: r2, type: 'R2', distancePercent: ((r2 - currentPrice) / currentPrice) * 100 },
            { price: recentHigh, type: 'HIGH', distancePercent: ((recentHigh - currentPrice) / currentPrice) * 100 }
        ].filter(r => r.price > currentPrice)
         .sort((a, b) => a.distancePercent - b.distancePercent);
       
        const supports = [
            { price: s1, type: 'S1', distancePercent: ((currentPrice - s1) / currentPrice) * 100 },
            { price: s2, type: 'S2', distancePercent: ((currentPrice - s2) / currentPrice) * 100 },
            { price: recentLow, type: 'LOW', distancePercent: ((currentPrice - recentLow) / currentPrice) * 100 }
        ].filter(s => s.price < currentPrice)
         .sort((a, b) => a.distancePercent - b.distancePercent);
       
        return {
            pivot: pivot,
            resistances: resistances,
            supports: supports,
            nearestResistance: resistances.length > 0 ? resistances[0] : null,
            nearestSupport: supports.length > 0 ? supports[0] : null,
            nearestPivot: isBullish ? (resistances.length > 0 ? resistances[0] : null) : (supports.length > 0 ? supports[0] : null)
        };
    } catch (error) {
        return null;
    }
}

async function calculateATR4h(symbol, period = 14) {
    try {
        const candles = await getCandles(symbol, '4h', period + 1);
        if (candles.length < period + 1) {
            return null;
        }
        
        let trValues = [];
       
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
           
            const tr1 = high - low;
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);
           
            const trueRange = Math.max(tr1, tr2, tr3);
            trValues.push(trueRange);
        }
       
        trValues = trValues.slice(-period);
       
        return trValues.reduce((a, b) => a + b, 0) / trValues.length;
    } catch (error) {
        return null;
    }
}

async function calculateEntryRetraction(symbol, currentPrice, isBullish) {
    try {
        const atr = await calculateATR4h(symbol, 14);
        if (!atr) {
            return { entryPrice: currentPrice, retractionRange: null };
        }
        
        const retractionAmount = atr * EMA_CONFIG.ENTRY_RETRACTION_FACTOR;
        const retractionPercent = (retractionAmount / currentPrice) * 100;
        
        let adjustedRetractionAmount = retractionAmount;
        if (retractionPercent > EMA_CONFIG.MAX_RETRACTION_PERCENT) {
            adjustedRetractionAmount = currentPrice * (EMA_CONFIG.MAX_RETRACTION_PERCENT / 100);
        }
        
        let entryPrice;
        if (isBullish) {
            entryPrice = currentPrice - adjustedRetractionAmount;
        } else {
            entryPrice = currentPrice + adjustedRetractionAmount;
        }
        
        return {
            entryPrice,
            retractionRange: {
                min: isBullish ? entryPrice : currentPrice,
                max: isBullish ? currentPrice : entryPrice,
                amount: adjustedRetractionAmount,
                percent: (adjustedRetractionAmount / currentPrice) * 100
            }
        };
    } catch (error) {
        return { entryPrice: currentPrice, retractionRange: null };
    }
}

async function calculateATRTargets(symbol, entryPrice, isBullish) {
    try {
        const atr = await calculateATR4h(symbol, 14);
        if (!atr) {
            return null;
        }
       
        const multipliers = [0.5, 1.0, 1.5, 2.0];
        const targets = {};
       
        if (isBullish) {
            targets.t1 = entryPrice + atr * multipliers[0];
            targets.t2 = entryPrice + atr * multipliers[1];
            targets.t3 = entryPrice + atr * multipliers[2];
            targets.t4 = entryPrice + atr * multipliers[3];
        } else {
            targets.t1 = entryPrice - atr * multipliers[0];
            targets.t2 = entryPrice - atr * multipliers[1];
            targets.t3 = entryPrice - atr * multipliers[2];
            targets.t4 = entryPrice - atr * multipliers[3];
        }
        
        return {
            atr,
            targets,
            multipliers
        };
    } catch (error) {
        return null;
    }
}

async function calculateSupportResistance15m(symbol, currentPrice) {
    try {
        const candles = await getCandles(symbol, '15m', 100);
        if (candles.length < 50) {
            return null;
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
       
        const recentHighs = highs.slice(-48).sort((a, b) => b - a);
        const recentLows = lows.slice(-48).sort((a, b) => a - b);
       
        const resistance1 = recentHighs[0];
        const resistance2 = recentHighs[1] || resistance1 * 0.99;
       
        const support1 = recentLows[0];
        const support2 = recentLows[1] || support1 * 0.99;
       
        return {
            resistances: {
                r1: { price: resistance1, distance: ((resistance1 - currentPrice) / currentPrice) * 100 },
                r2: { price: resistance2, distance: ((resistance2 - currentPrice) / currentPrice) * 100 }
            },
            supports: {
                s1: { price: support1, distance: ((currentPrice - support1) / currentPrice) * 100 },
                s2: { price: support2, distance: ((currentPrice - support2) / currentPrice) * 100 }
            },
            nearestResistance: resistance1 > currentPrice ? resistance1 : resistance2,
            nearestSupport: support1 < currentPrice ? support1 : support2
        };
    } catch (error) {
        return null;
    }
}

async function analyzeVolume1hWithEMA9(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 50);
        if (candles.length < 10) {
            return { direction: 'Desconhecido', percentage: 0, emoji: '❓' };
        }
        
        const closes = candles.map(c => c.close);
        const ema9 = calculateEMA(closes, 9);
       
        let buyerVolume = 0;
        let sellerVolume = 0;
        let totalVolume = 0;
       
        const recentCandles = candles.slice(-24);
       
        recentCandles.forEach((candle) => {
            const volume = candle.volume;
            totalVolume += volume;
           
            if (candle.close > ema9) {
                buyerVolume += volume;
            } else if (candle.close < ema9) {
                sellerVolume += volume;
            } else {
                buyerVolume += volume / 2;
                sellerVolume += volume / 2;
            }
        });
       
        const buyerPercentage = (buyerVolume / totalVolume) * 100;
       
        let direction = '';
        let emoji = '';
       
        if (buyerPercentage > 55) {
            direction = 'Comprador';
            emoji = '🟢';
        } else if (buyerPercentage < 45) {
            direction = 'Vendedor';
            emoji = '🔴';
        } else {
            direction = 'Neutro';
            emoji = '⚪';
        }
        
        return {
            direction,
            percentage: Math.round(buyerPercentage),
            sellerPercentage: Math.round(100 - buyerPercentage),
            emoji
        };
    } catch (error) {
        return { direction: 'Erro', percentage: 0, emoji: '❌' };
    }
}

async function analyzeVolume3mWithEMA13(symbol) {
    try {
        const candles = await getCandles(symbol, '3m', 50);
        if (candles.length < 20) {
            return { direction: 'Desconhecido', percentage: 0, emoji: '❓', score: 0 };
        }
        
        const closes = candles.map(c => c.close);
        const ema13 = calculateEMA(closes, 13);
        
        let buyerVolume = 0;
        let sellerVolume = 0;
        let totalVolume = 0;
        
        const recentCandles = candles.slice(-40);
        
        recentCandles.forEach((candle) => {
            const volume = candle.volume;
            totalVolume += volume;
            
            if (candle.close > ema13) {
                buyerVolume += volume;
            } else if (candle.close < ema13) {
                sellerVolume += volume;
            } else {
                buyerVolume += volume / 2;
                sellerVolume += volume / 2;
            }
        });
        
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 50;
        
        let direction = '';
        let emoji = '';
        let score = 0;
        
        if (buyerPercentage > 60) {
            direction = 'Comprador';
            emoji = '🟢🟢';
            score = 30;
        } else if (buyerPercentage > 55) {
            direction = 'Comprador';
            emoji = '🟢';
            score = 20;
        } else if (buyerPercentage > 52) {
            direction = 'Comprador';
            emoji = '🟡';
            score = 10;
        } else if (buyerPercentage < 40) {
            direction = 'Vendedor';
            emoji = '🔴🔴';
            score = -30;
        } else if (buyerPercentage < 45) {
            direction = 'Vendedor';
            emoji = '🔴';
            score = -20;
        } else if (buyerPercentage < 48) {
            direction = 'Vendedor';
            emoji = '🟡';
            score = -10;
        } else {
            direction = 'Neutro';
            emoji = '⚪';
            score = 0;
        }
        
        return {
            direction,
            percentage: Math.round(buyerPercentage),
            sellerPercentage: Math.round(100 - buyerPercentage),
            emoji,
            score
        };
    } catch (error) {
        return { direction: 'Erro', percentage: 0, emoji: '❌', score: 0 };
    }
}

function findSignificantLevels(values, tolerancePercent) {
    const levels = [];
    const sortedValues = [...values].sort((a, b) => a - b);
    
    for (let i = 0; i < sortedValues.length; i++) {
        const currentValue = sortedValues[i];
        let found = false;
        
        for (const level of levels) {
            const diffPercent = Math.abs((currentValue - level) / level) * 100;
            if (diffPercent <= tolerancePercent) {
                found = true;
                break;
            }
        }
        
        if (!found) {
            levels.push(currentValue);
        }
    }
    
    return levels;
}

async function analyzeSupportResistanceRetest(symbol, currentPrice, signalType) {
    if (!CONFIG.RETEST.ENABLED) return null;
    
    try {
        const candles15m = await getCandles(symbol, CONFIG.RETEST.TIMEFRAMES.PRIMARY, 200);
        const candles5m = await getCandles(symbol, CONFIG.RETEST.TIMEFRAMES.CONFIRMATION, 100);
        
        if (candles15m.length < 100 || candles5m.length < 50) {
            return null;
        }

        const highs = candles15m.map(c => c.high);
        const lows = candles15m.map(c => c.low);
        
        const resistanceLevels = findSignificantLevels(highs, CONFIG.RETEST.TOLERANCE_PERCENT);
        const supportLevels = findSignificantLevels(lows, CONFIG.RETEST.TOLERANCE_PERCENT);
        
        let nearestLevel = null;
        let levelType = null;
        let distanceToLevel = 100;
        
        if (signalType === 'CCI_COMPRA') {
            for (const level of supportLevels) {
                const distance = ((currentPrice - level) / currentPrice) * 100;
                if (level < currentPrice && distance < CONFIG.RETEST.MAX_DISTANCE_PERCENT && distance < distanceToLevel) {
                    distanceToLevel = distance;
                    nearestLevel = level;
                    levelType = 'SUPORTE';
                }
            }
        } else {
            for (const level of resistanceLevels) {
                const distance = ((level - currentPrice) / currentPrice) * 100;
                if (level > currentPrice && distance < CONFIG.RETEST.MAX_DISTANCE_PERCENT && distance < distanceToLevel) {
                    distanceToLevel = distance;
                    nearestLevel = level;
                    levelType = 'RESISTÊNCIA';
                }
            }
        }
        
        if (!nearestLevel) {
            return null;
        }
        
        let totalTests = 0;
        let successfulTests = 0;
        let volumeAtTest = 0;
        
        const volumes5m = candles5m.map(c => c.volume);
        const avgVolume = volumes5m.reduce((a, b) => a + b, 0) / volumes5m.length;
        
        for (let i = 0; i < candles15m.length - 1; i++) {
            const candle = candles15m[i];
            
            if (levelType === 'SUPORTE') {
                if (Math.abs((candle.low - nearestLevel) / nearestLevel) * 100 < CONFIG.RETEST.TOLERANCE_PERCENT) {
                    if (candle.close > nearestLevel) {
                        successfulTests++;
                    }
                    totalTests++;
                    
                    if (i === candles15m.length - 2) {
                        volumeAtTest = candle.volume;
                    }
                }
            } else {
                if (Math.abs((candle.high - nearestLevel) / nearestLevel) * 100 < CONFIG.RETEST.TOLERANCE_PERCENT) {
                    if (candle.close < nearestLevel) {
                        successfulTests++;
                    }
                    totalTests++;
                    
                    if (i === candles15m.length - 2) {
                        volumeAtTest = candle.volume;
                    }
                }
            }
        }
        
        const lastCandle5m = candles5m[candles5m.length - 1];
        
        let falseBreakout = false;
        
        if (levelType === 'SUPORTE' && lastCandle5m.low < nearestLevel && lastCandle5m.close > nearestLevel) {
            falseBreakout = true;
        } else if (levelType === 'RESISTÊNCIA' && lastCandle5m.high > nearestLevel && lastCandle5m.close < nearestLevel) {
            falseBreakout = true;
        }
        
        const volumeRatio = volumeAtTest / avgVolume;
        const successRate = totalTests > 0 ? (successfulTests / totalTests) * 100 : 0;
        
        return {
            level: nearestLevel,
            type: levelType,
            distance: distanceToLevel,
            totalTests: totalTests,
            successRate: successRate,
            volumeRatio: volumeRatio,
            falseBreakout: falseBreakout,
            isHistoric: totalTests >= CONFIG.RETEST.MIN_TESTS_FOR_HISTORIC,
            timestamp: Date.now()
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === SINAIS DE CCI ===
// =====================================================================
async function checkCCISignal(symbol) {
    if (!CONFIG.CCI.ENABLED) {
        return null;
    }
    
    if (cciCooldown[symbol] && (Date.now() - cciCooldown[symbol]) < 20 * 60 * 1000) {
        return null;
    }
    
    try {
        const cci = await getCCI(symbol);
        if (!cci) {
            return null;
        }
        
        const previousState = cciCrossState[symbol] || {
            wasCrossingUp: false,
            wasCrossingDown: false,
            lastCheck: 0
        };
        
        let signalType = null;
        let isFreshCross = false;
        
        if (cci.isCrossingUp) {
            if (!previousState.wasCrossingUp) {
                signalType = 'CCI_COMPRA';
                isFreshCross = true;
            }
            cciCrossState[symbol] = {
                wasCrossingUp: true,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        } else if (cci.isCrossingDown) {
            if (!previousState.wasCrossingDown) {
                signalType = 'CCI_VENDA';
                isFreshCross = true;
            }
            cciCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: true,
                lastCheck: Date.now()
            };
        } else {
            cciCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        }
        
        if (!isFreshCross || !signalType) {
            return null;
        }
        
        const emaCheck = await checkEMA3m(symbol, signalType);
        if (!emaCheck.isValid) {
            return null;
        }
        
        const [rsiData, rsi15mData, lsrData, fundingData, volumeData, volume3mData] = await Promise.all([
            getRSI1h(symbol),
            getRSI15m(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzeVolume1hWithEMA9(symbol),
            analyzeVolume3mWithEMA13(symbol)
        ]);
        
        // ===== FILTRO OBRIGATÓRIO DE VOLUME 1H =====
        if (VOLUME_1H_CONFIG.COMPRA.ENABLED && signalType === 'CCI_COMPRA') {
            if (!volumeData || volumeData.direction !== 'Comprador' || volumeData.percentage < VOLUME_1H_CONFIG.COMPRA.MIN_BUYER_PERCENTAGE) {
                console.log(`📊 Volume 1h rejeitado para COMPRA ${symbol}: ${volumeData?.percentage}% ${volumeData?.direction}`);
                return null;
            }
        }
        
        if (VOLUME_1H_CONFIG.VENDA.ENABLED && signalType === 'CCI_VENDA') {
            if (!volumeData || volumeData.direction !== 'Vendedor' || (100 - volumeData.percentage) < VOLUME_1H_CONFIG.VENDA.MIN_SELLER_PERCENTAGE) {
                console.log(`📊 Volume 1h rejeitado para VENDA ${symbol}: ${100 - volumeData?.percentage}% vendedor`);
                return null;
            }
        }
        
        // Restante do código continua igual...
        
        // ===== FILTRO OBRIGATÓRIO DE RSI 15M =====
        if (RSI_15M_CONFIG.COMPRA.ENABLED && signalType === 'CCI_COMPRA') {
            if (!rsi15mData || rsi15mData.direction !== 'subindo') {
                console.log(`📊 RSI 15m rejeitado para COMPRA ${symbol}: direção ${rsi15mData?.direction || 'indisponível'}`);
                return null;
            }
        }
        
        if (RSI_15M_CONFIG.VENDA.ENABLED && signalType === 'CCI_VENDA') {
            if (!rsi15mData || rsi15mData.direction !== 'descendo') {
                console.log(`📊 RSI 15m rejeitado para VENDA ${symbol}: direção ${rsi15mData?.direction || 'indisponível'}`);
                return null;
            }
        }
        
        // ===== FILTRO OBRIGATÓRIO DE LSR 15M =====
        if (LSR_15M_CONFIG.COMPRA.ENABLED && signalType === 'CCI_COMPRA') {
            if (!lsrData || lsrData.lsrValue >= LSR_15M_CONFIG.COMPRA.MAX_LSR) {
                console.log(`📊 LSR 15m rejeitado para COMPRA ${symbol}: ${lsrData?.lsrValue?.toFixed(2) || 'indisponível'} (máx ${LSR_15M_CONFIG.COMPRA.MAX_LSR})`);
                return null;
            }
        }
        
        // VENDA não tem filtro de LSR (configurado como false)
        
        if (signalType === 'CCI_COMPRA' && RSI_1H_CONFIG.COMPRA.ENABLED) {
            if (!rsiData || rsiData.value >= RSI_1H_CONFIG.COMPRA.MAX_RSI) {
                return null;
            }
        }
       
        if (signalType === 'CCI_VENDA' && RSI_1H_CONFIG.VENDA.ENABLED) {
            if (!rsiData || rsiData.value <= RSI_1H_CONFIG.VENDA.MIN_RSI) {
                return null;
            }
        }
        
        const currentPrice = await getCurrentPrice(symbol);
        if (currentPrice === 0) {
            return null;
        }
        
        const pivotData = await analyzePivotPoints(symbol, currentPrice, signalType === 'CCI_COMPRA');
        const entryRetraction = await calculateEntryRetraction(symbol, currentPrice, signalType === 'CCI_COMPRA');
        const entryPrice = entryRetraction.entryPrice;
        
        const atrTargets = await calculateATRTargets(symbol, entryPrice, signalType === 'CCI_COMPRA');
        const srLevels = await calculateSupportResistance15m(symbol, currentPrice);
        const retestData = await analyzeSupportResistanceRetest(symbol, currentPrice, signalType);
        
        const signal = {
            symbol: symbol,
            type: signalType,
            cci: cci,
            rsi: rsiData?.value,
            rsi15m: rsi15mData?.value,
            rsi15mDirection: rsi15mData?.direction,
            lsr: lsrData?.lsrValue,
            funding: fundingData?.ratePercent,
            pivotData: pivotData,
            currentPrice: currentPrice,
            entryPrice: entryPrice,
            entryRetraction: entryRetraction,
            time: getBrazilianDateTime(),
            isFreshCross: isFreshCross,
            atrTargets: atrTargets,
            srLevels: srLevels,
            emaCheck: emaCheck,
            volumeData: volumeData,
            volume3mData: volume3mData,
            retestData: retestData
        };
        
        return CCISignalSchema.parse(signal);
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === ANÁLISE DE FATORES ===
// =====================================================================
async function analyzeTradeFactors(symbol, signalType, indicators) {
    const factors = {
        positive: [],
        negative: [],
        neutral: [],
        score: 0,
        maxScore: 0,
        summary: '',
        resumoInteligente: ''
    };

    const weights = {
        FUNDING: 20,
        LSR: 30,
        RSI: 20,
        STRUCTURE: 25,
        PIVOT_DISTANCE: 25
    };

    factors.maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let totalScore = 0;

    if (indicators.funding) {
        const fundingValue = parseFloat(indicators.funding) / 100;

        if (signalType === 'CCI_COMPRA') {
            if (fundingValue <= -0.001) {
                factors.positive.push(`🟢🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING;
            } else if (fundingValue <= -0.0003) {
                factors.positive.push(`🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue <= 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue <= 0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue <= 0.001) {
                factors.negative.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
            } else {
                factors.negative.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
            }
        } else {
            if (fundingValue >= 0.001) {
                factors.positive.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING;
            } else if (fundingValue >= 0.0003) {
                factors.positive.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue > 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue >= -0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue >= -0.001) {
                factors.negative.push(`🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
            } else {
                factors.negative.push(`🔵🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}%`);
            }
        }
    } else {
        factors.neutral.push(`⚪ FUNDING: Indisponível`);
    }

    if (indicators.lsr) {
        const lsrValue = indicators.lsr;

        if (signalType === 'CCI_COMPRA') {
            if (lsrValue < 1.5) {
                factors.positive.push(`🟢🟢 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR;
            } else if (lsrValue < 2.5) {
                factors.positive.push(`🟢 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue < 3.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue < 4.0) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔴 LSR: ${lsrValue.toFixed(3)}`);
            }
        } else {
            if (lsrValue > 4.0) {
                factors.positive.push(`🔴🔴 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR;
            } else if (lsrValue > 2.8) {
                factors.positive.push(`🔴 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue > 2.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue > 1.5) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)}`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔵 LSR: ${lsrValue.toFixed(3)}`);
            }
        }
    } else {
        factors.neutral.push(`⚪ LSR: Indisponível`);
    }

    if (indicators.rsi) {
        const rsiValue = indicators.rsi;

        if (signalType === 'CCI_COMPRA') {
            if (rsiValue < 25) {
                factors.positive.push(`🟢🟢 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI;
            } else if (rsiValue < 30) {
                factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.9;
            } else if (rsiValue < 40) {
                factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue < 50) {
                factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.5;
            } else {
                factors.negative.push(`🔴 RSI: ${rsiValue.toFixed(1)}`);
            }
        } else {
            if (rsiValue > 75) {
                factors.positive.push(`🔴🔴 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI;
            } else if (rsiValue > 70) {
                factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.9;
            } else if (rsiValue > 60) {
                factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue > 50) {
                factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)}`);
                totalScore += weights.RSI * 0.5;
            } else {
                factors.negative.push(`🟢 RSI: ${rsiValue.toFixed(1)}`);
            }
        }
    } else {
        factors.neutral.push(`⚪ RSI: Indisponível`);
    }

    if (indicators.pivotData) {
        const pivot = indicators.pivotData;
        const currentPrice = indicators.currentPrice;

        if (signalType === 'CCI_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                
                if (distToResistance > 8) {
                    factors.positive.push(`🟢🟢 DISTÂNCIA: Resistência ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE;
                } else if (distToResistance > 5) {
                    factors.positive.push(`🟢 DISTÂNCIA: Resistência ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.8;
                } else if (distToResistance > 3) {
                    factors.positive.push(`🟡 DISTÂNCIA: Resistência ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.5;
                } else {
                    factors.negative.push(`🔴 DISTÂNCIA: Resistência ${distToResistance.toFixed(2)}%`);
                    totalScore -= 10;
                }
            }

            if (currentPrice > pivot.pivot) {
                factors.positive.push(`🟢 PREÇO ACIMA DO PIVÔ`);
                totalScore += weights.STRUCTURE * 0.3;
            }
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                
                if (distToSupport > 8) {
                    factors.positive.push(`🔴🔴 DISTÂNCIA: Suporte ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE;
                } else if (distToSupport > 5) {
                    factors.positive.push(`🔴 DISTÂNCIA: Suporte ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.8;
                } else if (distToSupport > 3) {
                    factors.positive.push(`🟡 DISTÂNCIA: Suporte ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.5;
                } else {
                    factors.negative.push(`🔵 DISTÂNCIA: Suporte ${distToSupport.toFixed(2)}%`);
                    totalScore -= 10;
                }
            }

            if (currentPrice < pivot.pivot) {
                factors.positive.push(`🔵 PREÇO ABAIXO DO PIVÔ`);
                totalScore += weights.STRUCTURE * 0.3;
            }
        }
    }

    if (indicators.emaCheck && indicators.emaCheck.analysis) {
        factors.positive.push(`📊 EMA confirmou`);
        totalScore += 15;
    }

    factors.score = Math.min(100, Math.round((totalScore / factors.maxScore) * 100));

    const isBadTrade = factors.score < 50;
    const isNearResistance = indicators.pivotData?.nearestResistance?.distancePercent < 3.0;
    const isNearSupport = indicators.pivotData?.nearestSupport?.distancePercent < 3.0;
    const volume3mData = indicators.volume3mData;
    
    const volume3mFavoravel = volume3mData && 
        ((signalType === 'CCI_COMPRA' && volume3mData.percentage > 52) ||
         (signalType === 'CCI_VENDA' && volume3mData.percentage < 48));

    let resumo = '';

    if (signalType === 'CCI_COMPRA') {
        if (isBadTrade) {
            resumo = `⚠️ OPERAÇÃO DESFAVORÁVEL. `;
            if (isNearSupport) {
                resumo += `Suporte próximo (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%). `;
            }
            if (!volume3mFavoravel && volume3mData) {
                resumo += `Volume desfavorável (${volume3mData.percentage}% comprador). `;
            }
        } else {
            resumo = `✅ OPERAÇÃO FAVORÁVEL. `;
            if (isNearSupport) {
                resumo += `💰 SUPORTE PRÓXIMO (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%)! `;
            }
            if (volume3mFavoravel && volume3mData) {
                resumo += `📈 Volume confirmando (${volume3mData.percentage}% comprador). `;
            }
            if (indicators.pivotData?.nearestResistance?.distancePercent > 5) {
                resumo += `📊 Espaço até resistência (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%). `;
            }
        }
    } else {
        if (isBadTrade) {
            resumo = `⚠️ OPERAÇÃO DESFAVORÁVEL. `;
            if (isNearResistance) {
                resumo += `Resistência próxima (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%). `;
            }
            if (!volume3mFavoravel && volume3mData) {
                resumo += `Volume desfavorável (${volume3mData.sellerPercentage || (100 - volume3mData.percentage)}% vendedor). `;
            }
        } else {
            resumo = `✅ OPERAÇÃO FAVORÁVEL. `;
            if (isNearResistance) {
                resumo += `💰 RESISTÊNCIA PRÓXIMA (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%)! `;
            }
            if (volume3mFavoravel && volume3mData) {
                resumo += `📈 Volume confirmando (${volume3mData.sellerPercentage || (100 - volume3mData.percentage)}% vendedor). `;
            }
            if (indicators.pivotData?.nearestSupport?.distancePercent > 5) {
                resumo += `📊 Espaço até suporte (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%). `;
            }
        }
    }

    factors.resumoInteligente = resumo;

    if (signalType === 'CCI_COMPRA') {
        if (factors.score >= 80) {
            factors.summary = '🏆 Excelente PARA COMPRA';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Favorável PARA COMPRA';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Neutra PARA COMPRA';
        } else {
            factors.summary = '⚠️ Desfavorável PARA COMPRA';
        }
    } else {
        if (factors.score >= 80) {
            factors.summary = '🏆 Excelente PARA CORREÇÃO';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Favorável PARA CORREÇÃO';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Neutra PARA CORREÇÃO';
        } else {
            factors.summary = '⚠️ Desfavorável PARA CORREÇÃO';
        }
    }

    return factors;
}

// =====================================================================
// === ALERTA PRINCIPAL (VERSÃO SIMPLIFICADA) ===
// =====================================================================
async function sendCCIAlertEnhanced(signal) {
    const entryPrice = signal.entryPrice;
    const currentPrice = signal.currentPrice;
   
    getAlertCountForSymbol(signal.symbol, 'cci');
    cciCooldown[signal.symbol] = Date.now();
   
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        funding: signal.funding,
        lsr: signal.lsr,
        rsi: signal.rsi,
        pivotData: signal.pivotData,
        currentPrice: currentPrice,
        emaCheck: signal.emaCheck,
        volumeData: signal.volumeData,
        volume3mData: signal.volume3mData
    });
   
    let srInfo = null;
    try {
        srInfo = await calculateSupportResistance15m(signal.symbol, currentPrice);
    } catch (error) {}
   
    let atrTargetsText = 'Alvos: N/A';
    let atrValue = 0;
    if (signal.atrTargets) {
        const atr = signal.atrTargets.atr;
        atrValue = atr;
       
        if (signal.type === 'CCI_COMPRA') {
            atrTargetsText = `Alvos: T1: $${signal.atrTargets.targets.t1.toFixed(6)} | T2: $${signal.atrTargets.targets.t2.toFixed(6)} | T3: $${signal.atrTargets.targets.t3.toFixed(6)} | T4: $${signal.atrTargets.targets.t4.toFixed(6)}`;
        } else {
            atrTargetsText = `Alvos: T1: $${signal.atrTargets.targets.t1.toFixed(6)} | T2: $${signal.atrTargets.targets.t2.toFixed(6)} | T3: $${signal.atrTargets.targets.t3.toFixed(6)} | T4: $${signal.atrTargets.targets.t4.toFixed(6)}`;
        }
    }
   
    let stopCompact = 'Stop: N/A';
    let stopPrice = 0;
    let stopPercent = 0;
   
    if (srInfo) {
        const price = entryPrice;
       
        if (signal.type === 'CCI_COMPRA') {
            stopPrice = srInfo.nearestSupport * 0.995;
           
            if (signal.atrTargets) {
                const atrStop = price - (signal.atrTargets.atr * 0.5);
                stopPrice = Math.min(stopPrice, atrStop);
            }
           
            stopPercent = ((price - stopPrice) / price * 100);
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(2)}%)`;
           
        } else {
            stopPrice = srInfo.nearestResistance * 1.005;
           
            if (signal.atrTargets) {
                const atrStop = price + (signal.atrTargets.atr * 0.5);
                stopPrice = Math.max(stopPrice, atrStop);
            }
           
            stopPercent = ((stopPrice - price) / price * 100);
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(2)}%)`;
        }
    } else if (signal.atrTargets) {
        const atr = signal.atrTargets.atr;
       
        if (signal.type === 'CCI_COMPRA') {
            stopPrice = entryPrice - (atr * 0.4);
            stopPercent = ((entryPrice - stopPrice) / entryPrice * 100);
        } else {
            stopPrice = entryPrice + (atr * 0.4);
            stopPercent = ((stopPrice - entryPrice) / entryPrice * 100);
        }
        stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(2)}%)`;
    }
   
    let srCompact = '';
    if (srInfo) {
        const resistance = srInfo.nearestResistance;
        const support = srInfo.nearestSupport;
        const distR = resistance ? ((resistance - currentPrice) / currentPrice * 100).toFixed(1) : 'N/A';
        const distS = support ? ((currentPrice - support) / currentPrice * 100).toFixed(1) : 'N/A';
       
        srCompact = `Resist: $${resistance?.toFixed(6) || 'N/A'} (${distR}%) | Supt: $${support?.toFixed(6) || 'N/A'} (${distS}%)`;
    }
   
    let pivotDistanceText = '';
    if (signal.pivotData) {
        const pivot = signal.pivotData;
        
        if (signal.type === 'CCI_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                const emoji = distToResistance > 5 ? '🟢' : distToResistance > 3 ? '🟡' : '🔴';
                pivotDistanceText = `📊 Pivô: Resistência em $${pivot.nearestResistance.price.toFixed(6)} (${distToResistance.toFixed(2)}% ${emoji})`;
            } else {
                pivotDistanceText = `📊 Pivô: N/A`;
            }
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                const emoji = distToSupport > 5 ? '🔴' : distToSupport > 3 ? '🟡' : '🔵';
                pivotDistanceText = `📊 Pivô: Suporte em $${pivot.nearestSupport.price.toFixed(6)} (${distToSupport.toFixed(2)}% ${emoji})`;
            } else {
                pivotDistanceText = `📊 Pivô: N/A`;
            }
        }
    } else {
        pivotDistanceText = `📊 Pivô: Indisponível`;
    }
   
    let lsrText = 'N/A';
    let lsrEmoji = '';
    if (signal.lsr) {
        lsrText = signal.lsr.toFixed(2);
        if (signal.type === 'CCI_COMPRA') {
            lsrEmoji = signal.lsr < 2.7 ? '✅' : '⚠️'; // Atualizado para refletir o novo filtro
        } else {
            lsrEmoji = signal.lsr > 2.8 ? '✅' : '⚠️';
        }
    }
   
    let fundingText = '0.0000%';
    let fundingEmoji = '';
    if (signal.funding) {
        const fundingValue = parseFloat(signal.funding) / 100;
        fundingText = `${fundingValue > 0 ? '+' : ''}${(fundingValue * 100).toFixed(4)}%`;
       
        if (signal.type === 'CCI_COMPRA') {
            fundingEmoji = fundingValue < 0 ? '✅' : fundingValue > 0.0003 ? '❌' : '⚠️';
        } else {
            fundingEmoji = fundingValue > 0 ? '✅' : fundingValue < -0.0003 ? '❌' : '⚠️';
        }
    }
   
    const cciText = `CCI ${signal.cci.value.toFixed(1)} | EMA5 ${signal.cci.ema5.toFixed(1)} | EMA13 ${signal.cci.ema13.toFixed(1)}`;
   
    let rsiText = 'N/A';
    if (signal.rsi) {
        rsiText = signal.rsi.toFixed(0);
    }

    let rsi15mText = '';
    if (signal.rsi15m) {
        const arrow = signal.rsi15mDirection === 'subindo' ? '⬆️' : signal.rsi15mDirection === 'descendo' ? '⬇️' : '➡️';
        rsi15mText = ` | RSI 15m ${signal.rsi15m.toFixed(0)}${arrow}`;
    }
   
    let volumeText = 'Volume 1h: Desconhecido';
    if (signal.volumeData) {
        const volData = signal.volumeData;
        volumeText = `Volume 1h: ${volData.percentage}% ${volData.direction}`;
        if (volData.emoji) {
            volumeText = `${volData.emoji} ${volumeText}`;
        }
    }
   
    let volume3mText = '';
    if (signal.volume3mData) {
        const vol3m = signal.volume3mData;
        volume3mText = `Volume 3m: ${vol3m.percentage}% ${vol3m.direction} ${vol3m.emoji}`;
    }
   
    let entryRetractionText = '';
    if (signal.entryRetraction && signal.entryRetraction.retractionRange) {
        const range = signal.entryRetraction.retractionRange;
        entryRetractionText = `Retração: $${range.min.toFixed(6)} ... $${range.max.toFixed(6)} (${range.percent.toFixed(2)}%)`;
    }
   
    const alertCounterText = `Alerta #${globalAlerts}`;
   
    const actionEmoji = signal.type === 'CCI_COMPRA' ? '🟢' : '🔴';
    const actionText = signal.type === 'CCI_COMPRA' ? '🔍Analisar COMPRA' : '🔍Analisar CORREÇÃO';
   
    // MENSAGEM SIMPLIFICADA
    let message = formatItalic(`${actionEmoji} ${actionText} • ${signal.symbol}
Preço: $${currentPrice.toFixed(6)}
📍SCORE: ${factors.score}
${volumeText}
${volume3mText}
${alertCounterText} - ${signal.time.full}
❅──────✧❅✨❅✧──────❅
🔘#CCI #15m ${cciText} | RSI 1H ${rsiText}${rsi15mText}
LSR ${lsrEmoji} ${lsrText} | Fund ${fundingEmoji} ${fundingText}
🔘${entryRetractionText}
${atrTargetsText}
🛑 ${stopCompact}
✨Níveis Importantes:
${srCompact}
${pivotDistanceText}
Alerta Educativo, não é recomendação de investimento
✨ Titanium by @J4Rviz ✨`);
   
    message = message.replace(/\n\s*\n/g, '\n').trim();
   
    await sendTelegramAlert(message);
   
    console.log(`✅ Alerta enviado: ${signal.symbol} (${actionText}) | Score: ${factors.score}% | Volume 1h: ${signal.volumeData?.percentage}% ${signal.volumeData?.direction} | RSI 15m: ${signal.rsi15m?.toFixed(0)} ${signal.rsi15mDirection} | LSR: ${signal.lsr?.toFixed(2)}`);
}


// =====================================================================
// === FUNÇÕES AUXILIARES OTIMIZADAS ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

function getBrazilianHour() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.getHours();
}

function getBrazilianDateString() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.toISOString().split('T')[0];
}

function formatItalic(text) {
    return `<i>${text}</i>`;
}

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        console.log('📤 Enviando para Telegram:', message);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: message,
                disable_web_page_preview: true
                // parse_mode removido COMPLETAMENTE para evitar erros
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const responseText = await response.text();
        console.log('📥 Resposta Telegram:', responseText.substring(0, 100));
        
        if (!response.ok) {
            console.error('❌ Erro Telegram detalhado:', responseText);
            throw new Error(`HTTP ${response.status}`);
        }
        
        console.log(`✅ Telegram OK`);
        return true;
    } catch (error) {
        console.error(`❌ Erro Telegram: ${error.message}`);
        ErrorHandler.handle(error, 'SendTelegram');
        return false;
    }
}

function getAlertCountForSymbol(symbol, type) {
    const currentDate = getBrazilianDateString();
   
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
   
    if (!alertCounter[symbol]) {
        alertCounter[symbol] = {
            cci: 0,
            total: 0,
            lastAlert: null,
            dailyCCI: 0,
            dailyTotal: 0
        };
    }
   
    alertCounter[symbol][type.toLowerCase()]++;
    alertCounter[symbol].total++;
    alertCounter[symbol][`daily${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`]++;
    alertCounter[symbol].dailyTotal++;
    alertCounter[symbol].lastAlert = Date.now();
   
    dailyAlerts++;
    globalAlerts++;
   
    return {
        symbolDailyCCI: alertCounter[symbol].dailyCCI
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
   
    console.log(`\n🕘 ${getBrazilianDateTime().full} - Resetando contadores diários`);
   
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyCCI = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
   
    dailyAlerts = 0;
    lastResetDate = currentDate;
}

// =====================================================================
// === MENSAGEM DE INICIALIZAÇÃO SUPER SIMPLES (SEM EMOJIS) ===
// =====================================================================
async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        
        // Mensagem SEM EMOJIS e SEM ACENTOS - apenas texto puro
        const message = `TITANIUM ATIVADO
Data: ${now.full}
CCI 1H (EMA5/13)
Volume 1h >52%
RSI 15m direcao
LSR 15m <2.7`;

        console.log('📤 Enviando mensagem de inicialização...');
        console.log('Mensagem:', message);
        
        const result = await sendTelegramAlert(message);
        
        if (result) {
            console.log('✅ Mensagem de inicialização enviada!');
        } else {
            console.log('❌ Falha ao enviar inicialização');
        }
        
        return result;
    } catch (error) {
        console.error('❌ Erro init:', error.message);
        return false;
    }
}

// =====================================================================
// === MONITORAMENTO PRINCIPAL OTIMIZADO ===
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(
                'https://fapi.binance.com/fapi/v1/exchangeInfo',
                {},
                'exchangeInfo'
            ),
            'FetchSymbols',
            2,
            500
        );
        
        const validatedData = ExchangeInfoSchema.parse(data);
        
        return validatedData.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function monitorSymbol(symbol) {
    try {
        if (CONFIG.CCI.ENABLED) {
            const cciSignal = await checkCCISignal(symbol);
            if (cciSignal) {
                await sendCCIAlertEnhanced(cciSignal);
                return true;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function monitorBatch(symbols) {
    const promises = symbols.map(symbol => monitorSymbol(symbol));
    const results = await Promise.allSettled(promises);
    return results.filter(r => r.status === 'fulfilled' && r.value === true).length;
}

async function mainBotLoop() {
    try {
        const symbols = await fetchAllFuturesSymbols();
        const batchSize = CONFIG.PERFORMANCE.BATCH_SIZE;
        
        console.log('\n' + '='.repeat(60));
        console.log('🚀 TITANIUM CCI 1H');
        console.log(`📈 ${symbols.length} símbolos | Batch: ${batchSize}`);
        console.log('='.repeat(60) + '\n');
       
        let cycle = 0;
        while (true) {
            cycle++;
            const startTime = Date.now();
            
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
           
            const currentHour = getBrazilianHour();
            if (currentHour >= 21 && lastResetDate !== getBrazilianDateString()) {
                resetDailyCounters();
            }
           
            let symbolsToMonitor = symbols;
           
            if (CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE > 0) {
                symbolsToMonitor = symbolsToMonitor.slice(0, CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE);
            }
            
            let signalsFound = 0;
            
            for (let i = 0; i < symbolsToMonitor.length; i += batchSize) {
                const batch = symbolsToMonitor.slice(i, i + batchSize);
                const batchSignals = await monitorBatch(batch);
                signalsFound += batchSignals;
                
                if (i + batchSize < symbolsToMonitor.length) {
                    await new Promise(r => setTimeout(r, 200));
                }
            }
            
            const cycleTime = ((Date.now() - startTime) / 1000).toFixed(1);
            const cacheStats = CacheManager.getStats();
            
            console.log(`\n✅ Ciclo ${cycle} completo em ${cycleTime}s`);
            console.log(`📊 Sinais: ${signalsFound} | Cache: ${cacheStats.hitRate}`);
            console.log(`📈 Total: ${globalAlerts} | Diário: ${dailyAlerts}`);
            
            if (cycle % 10 === 0) {
                CacheManager.cleanup(0.2);
            }
            
            console.log(`\n⏳ Próximo ciclo em ${CONFIG.PERFORMANCE.CYCLE_DELAY_MS/1000}s...`);
            await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.CYCLE_DELAY_MS));
        }
    } catch (error) {
        ErrorHandler.handle(error, 'MainLoop');
        console.log('🔄 Reiniciando em 30s...');
        await new Promise(r => setTimeout(r, 30000));
        await mainBotLoop();
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
const rateLimiter = new OptimizedRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

        console.log('\n' + '='.repeat(60));
        console.log('🚀 TITANIUM CCI 1H');
        console.log('='.repeat(60) + '\n');

        lastResetDate = getBrazilianDateString();
        
        // Envia mensagem de inicialização
        await sendInitializationMessage();

        console.log('✅ Bot inicializado! Iniciando loop principal...\n');
        
        while (true) {
            try {
                await mainBotLoop();
            } catch (fatalError) {
                console.error("❌ Erro fatal no loop principal:", fatalError.message);
                await sendTelegramAlert(`⚠️ Bot reiniciando apos erro...`).catch(() => {});
                await new Promise(r => setTimeout(r, 30000));
            }
        }

    } catch (initError) {
        console.error('🚨 Erro na inicialização:', initError.message);
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    console.error('!!! UNCAUGHT EXCEPTION !!!', err.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

startBot();

if (global.gc) {
    console.log('🗑️ GC disponível');
}
