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
    volumeAnalysis: z.string().optional(),
    volumeValid: z.boolean().optional(),
    error: z.string().optional()
}).passthrough();

// Schema para StochRSI
const StochRSISchema = z.object({
    k: z.number(),
    d: z.number(),
    isCrossingUp: z.boolean(),
    isCrossingDown: z.boolean(),
    timeframe: z.string()
});

// Schema para alvos de ATR
const ATRTargetsSchema = z.object({
    atr14: z.number(),
    atrMultipliers: z.object({
        target1: z.number(),
        target2: z.number(),
        target3: z.number(),
        target4: z.number()
    }),
    stopLoss: z.number(),
    targets: z.object({
        target1: z.number(),
        target2: z.number(),
        target3: z.number(),
        target4: z.number()
    }),
    riskReward: z.object({
        rr1: z.number(),
        rr2: z.number(),
        rr3: z.number(),
        rr4: z.number()
    })
});

// Schema para níveis de suporte e resistência
const SupportResistanceSchema = z.object({
    resistance1: z.number(),
    resistance2: z.number(),
    support1: z.number(),
    support2: z.number(),
    pivot: z.number()
});

// Schema para análise de proximidade
const ProximityAnalysisSchema = z.object({
    isNearResistance: z.boolean(),
    isNearSupport: z.boolean(),
    distanceToResistance1: z.number(),
    distanceToResistance2: z.number(),
    distanceToSupport1: z.number(),
    distanceToSupport2: z.number(),
    distanceToPivot: z.number(),
    warningMessage: z.string().optional(),
    proximityType: z.enum(['RESISTENCE_PROXIMITY', 'SUPPORT_PROXIMITY', 'PIVOT_PROXIMITY', 'NONE']),
    riskLevel: z.enum(['ALTO', 'MEDIO', 'BAIXO'])
});

// Schema para análise do Pivot Multi-timeframe
const PivotMultiTimeframeSchema = z.object({
    pivot15m: z.object({
        value: z.number(),
        type: z.enum(['ALTA', 'BAIXA']),
        strength: z.enum(['FRACO', 'MODERADO', 'FORTE']),
        strengthEmoji: z.string(),
        distance: z.number(),
        distancePercent: z.number()
    }),
    pivot1h: z.object({
        value: z.number(),
        type: z.enum(['ALTA', 'BAIXA']),
        strength: z.enum(['FRACO', 'MODERADO', 'FORTE']),
        strengthEmoji: z.string(),
        distance: z.number(),
        distancePercent: z.number()
    }),
    pivot4h: z.object({
        value: z.number(),
        type: z.enum(['ALTA', 'BAIXA']),
        strength: z.enum(['FRACO', 'MODERADO', 'FORTE']),
        strengthEmoji: z.string(),
        distance: z.number(),
        distancePercent: z.number()
    }),
    confluence: z.enum(['ALTA', 'BAIXA', 'DIVERGENTE', 'NEUTRO']),
    confluenceEmoji: z.string(),
    possibleBreakout: z.boolean(),
    breakoutDirection: z.enum(['ALTA', 'BAIXA', 'NONE']).optional(),
    breakoutConfidence: z.enum(['BAIXA', 'MEDIA', 'ALTA']).optional(),
    analysis: z.string()
});

// Schema principal do sinal
const CCISignalSchema = z.object({
    symbol: z.string().regex(/^[A-Z0-9]+USDT$/),
    type: z.enum(['CCI_COMPRA', 'CCI_VENDA']),
    cci: CCISchema,
    rsi: z.number().min(0).max(100).optional().nullable(),
    stoch4h: StochRSISchema.optional().nullable(),
    lsr: z.number().optional().nullable(),
    funding: z.number().optional().nullable(),
    currentPrice: z.number().positive(),
    time: z.object({
        date: z.string(),
        time: z.string(),
        full: z.string()
    }),
    emaCheck: EMACheckSchema,
    atrTargets: ATRTargetsSchema,
    supportResistance: SupportResistanceSchema,
    alertNumber: z.number().int(),
    proximityAnalysis: ProximityAnalysisSchema,
    volumeEma1h: z.object({
        value: z.number(),
        ema9: z.number(),
        ratio: z.number(),
        status: z.enum(['COMPRADOR', 'VENDEDOR', 'NEUTRO']),
        percentage: z.string()
    }).optional(),
    pivotAnalysis: PivotMultiTimeframeSchema
});

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
        TIMEFRAME: '1h',
        LENGTH: 20,
        EMA_SHORT: 5,
        EMA_LONG: 13,
        SOURCE: 'hlc3',
        COOLDOWN_MS: 10 * 60 * 1000
    },
    
    STOCH: {
        TIMEFRAME: '4h',
        K_PERIOD: 14,
        D_PERIOD: 3,
        SLOWING: 3
    },
    
    ATR: {
        TIMEFRAME: '15m',
        LENGTH: 14,
        MULTIPLIERS: {
            TARGET1: 1.5,
            TARGET2: 2.5,
            TARGET3: 3.5,
            TARGET4: 5.0
        },
        STOP_MULTIPLIER: 1.2
    },

    VOLUME: {
        TIMEFRAME: '3m',
        PERIOD: 20,
        THRESHOLD: 1.5
    },

    RSI: {
        TIMEFRAME: '1h',
        BUY_MAX: 60,
        SELL_MIN: 65
    },

    PROXIMITY: {
        THRESHOLD_PERCENT: 0.5,
        WARNING_LEVELS: {
            ALTO: 0.3,
            MEDIO: 0.8,
            BAIXO: 999
        }
    },

    VOLUME_EMA: {
        TIMEFRAME: '1h',
        EMA_PERIOD: 9,
        THRESHOLD: 1.2
    },

    PIVOT: {
        TIMEFRAMES: {
            '15m': '15m',
            '1h': '1h',
            '4h': '4h'
        },
        STRENGTH_THRESHOLDS: {
            FORTE: 2.0,
            MODERADO: 1.0,
            FRACO: 0.5
        },
        BREAKOUT_VOLUME_THRESHOLD: 1.5
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
        MEMORY_THRESHOLD: 500 * 1024 * 1024,
        INACTIVE_SYMBOL_CLEANUP_HOURS: 24,
        CLEANUP_CHECK_INTERVAL: 60 * 60 * 1000
    },
    RATE_LIMITER: {
        INITIAL_DELAY: 100,
        MAX_DELAY: 2000,
        BACKOFF_FACTOR: 1.5,
        CONSECUTIVE_ERRORS_LIMIT: 5
    },
    DEBUG: {
        LOG_REJECTION_REASONS: true,
        VERBOSE: false
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

let alertCounter = new Map();
let globalAlerts = 0;
let lastResetDate = null;

const symbolCooldown = new Map();
const cciCooldown = new Map();
const symbolLastActivity = new Map();

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
// === STATE MANAGER ===
// =====================================================================
class StateManager {
    static init() {
        setInterval(() => this.cleanupInactiveSymbols(), CONFIG.CLEANUP.CLEANUP_CHECK_INTERVAL);
        console.log('🗑️ State Manager inicializado');
    }

    static cleanupInactiveSymbols() {
        const now = Date.now();
        const inactiveThreshold = CONFIG.CLEANUP.INACTIVE_SYMBOL_CLEANUP_HOURS * 60 * 60 * 1000;
        let removedCount = 0;

        for (const [symbol, timestamp] of symbolCooldown.entries()) {
            if (now - timestamp > inactiveThreshold) {
                symbolCooldown.delete(symbol);
                removedCount++;
            }
        }

        for (const [symbol, timestamp] of cciCooldown.entries()) {
            if (now - timestamp > inactiveThreshold) {
                cciCooldown.delete(symbol);
                removedCount++;
            }
        }

        for (const [symbol, data] of alertCounter.entries()) {
            if (data.lastAlert && (now - data.lastAlert) > inactiveThreshold * 2) {
                alertCounter.delete(symbol);
                removedCount++;
            }
        }

        for (const [symbol, timestamp] of symbolLastActivity.entries()) {
            if (now - timestamp > inactiveThreshold) {
                symbolLastActivity.delete(symbol);
                removedCount++;
            }
        }

        if (removedCount > 0 && CONFIG.DEBUG.VERBOSE) {
            console.log(`🧹 Limpeza de estado: ${removedCount} entradas removidas`);
        }
    }

    static updateActivity(symbol) {
        symbolLastActivity.set(symbol, Date.now());
    }

    static getStats() {
        return {
            symbolCooldown: symbolCooldown.size,
            cciCooldown: cciCooldown.size,
            alertCounter: alertCounter.size,
            symbolLastActivity: symbolLastActivity.size
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

// =====================================================================
// === FUNÇÃO PARA EMOJIS DO FUNDING RATE ===
// =====================================================================
function getFundingRateEmoji(fundingRate) {
    if (fundingRate <= -0.002) return '🟢🟢🟢';
    else if (fundingRate <= -0.001) return '🟢🟢';
    else if (fundingRate <= -0.0005) return '🟢';
    else if (fundingRate >= 0.001) return '🔴🔴🔴';
    else if (fundingRate >= 0.0003) return '🔴🔴';
    else if (fundingRate >= 0.0002) return '🔴';
    else return '🟢';
}

// =====================================================================
// === FUNÇÕES CORRIGIDAS DE TELEGRAM ===
// =====================================================================
function cleanTelegramText(text) {
    let cleanText = text.replace(/<[^>]*>/g, '');
    cleanText = cleanText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return cleanText;
}

function formatItalic(text) {
    const cleanText = cleanTelegramText(text);
    return `<i>${cleanText}</i>`;
}

async function sendTelegramAlert(message) {
    try {
        if (!CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) {
            console.log('⚠️ Telegram não configurado');
            return false;
        }

        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const formattedMessage = formatItalic(message);
        
        console.log('📤 Enviando para Telegram...');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: formattedMessage,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Erro Telegram ${response.status}: ${errorText}`);
            
            if (response.status === 400) {
                console.log('🔄 Tentando enviar sem formatação HTML...');
                
                const cleanMessage = cleanTelegramText(message);
                
                const fallbackResponse = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: CONFIG.TELEGRAM.CHAT_ID,
                        text: cleanMessage,
                        parse_mode: undefined,
                        disable_web_page_preview: true
                    }),
                    signal: controller.signal
                });
                
                if (fallbackResponse.ok) {
                    console.log('✅ Mensagem enviada sem formatação');
                    return true;
                }
            }
            
            return false;
        }
        
        console.log(`✅ Telegram OK`);
        return true;
    } catch (error) {
        console.log(`❌ Erro ao enviar Telegram: ${error.message}`);
        return false;
    }
}

function logRejection(symbol, filter, reason, data = null) {
    if (CONFIG.DEBUG.LOG_REJECTION_REASONS) {
        let logMessage = `📊 ${symbol} rejeitado - ${filter}: ${reason}`;
        if (data) {
            logMessage += ` | Dados: ${JSON.stringify(data)}`;
        }
        console.log(logMessage);
    }
}

function getAlertNumberForSymbol(symbol) {
    const currentDate = getBrazilianDateString();
   
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
   
    if (!alertCounter.has(symbol)) {
        alertCounter.set(symbol, {
            compra: 0,
            venda: 0,
            total: 0,
            lastAlert: null,
            dailyCompra: 0,
            dailyVenda: 0,
            dailyTotal: 0
        });
    }
   
    const data = alertCounter.get(symbol);
    return data.total + 1;
}

function incrementAlertCounter(symbol, type) {
    const currentDate = getBrazilianDateString();
   
    if (!alertCounter.has(symbol)) {
        alertCounter.set(symbol, {
            compra: 0,
            venda: 0,
            total: 0,
            lastAlert: null,
            dailyCompra: 0,
            dailyVenda: 0,
            dailyTotal: 0
        });
    }
   
    const data = alertCounter.get(symbol);
   
    if (type === 'CCI_COMPRA') {
        data.compra++;
        data.dailyCompra++;
    } else if (type === 'CCI_VENDA') {
        data.venda++;
        data.dailyVenda++;
    }
   
    data.total++;
    data.dailyTotal++;
    data.lastAlert = Date.now();
   
    alertCounter.set(symbol, data);
   
    globalAlerts++;
   
    return data.total;
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
   
    console.log(`\n🕘 ${getBrazilianDateTime().full} - Resetando contadores diários`);
   
    for (const [symbol, data] of alertCounter.entries()) {
        data.dailyCompra = 0;
        data.dailyVenda = 0;
        data.dailyTotal = 0;
        alertCounter.set(symbol, data);
    }
   
    globalAlerts = 0;
    lastResetDate = currentDate;
}

async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        const stateStats = StateManager.getStats();
        
        const message = `
🚀 TITANIUM 
 State: ${stateStats.alertCounter} símbolos ativos
`;
        
        return await sendTelegramAlert(message);
        
    } catch (error) {
        console.log(`❌ Erro na mensagem de inicialização: ${error.message}`);
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
    if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
    return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateStochRSI(symbol, candles) {
    try {
        if (candles.length < 50) return null;
        
        const period = CONFIG.STOCH.K_PERIOD;
        const smoothK = CONFIG.STOCH.D_PERIOD;
        const smoothD = CONFIG.STOCH.SLOWING;
        
        // Calcular %K do Estocástico
        const closes = candles.map(c => c.close);
        const kValues = [];
        
        for (let i = period - 1; i < closes.length; i++) {
            const periodCloses = closes.slice(i - period + 1, i + 1);
            const lowest = Math.min(...periodCloses);
            const highest = Math.max(...periodCloses);
            const currentClose = closes[i];
            
            let k = 0;
            if (highest - lowest !== 0) {
                k = ((currentClose - lowest) / (highest - lowest)) * 100;
            }
            kValues.push(k);
        }
        
        if (kValues.length < smoothK + smoothD) return null;
        
        // Suavizar %K
        const kSmooth = [];
        for (let i = smoothK - 1; i < kValues.length; i++) {
            const periodK = kValues.slice(i - smoothK + 1, i + 1);
            const kSma = calculateSMA(periodK, smoothK);
            kSmooth.push(kSma);
        }
        
        if (kSmooth.length < smoothD + 1) return null;
        
        // Calcular %D (média de %K)
        const currentK = kSmooth[kSmooth.length - 1];
        const dValues = [];
        
        for (let i = smoothD - 1; i < kSmooth.length; i++) {
            const periodK = kSmooth.slice(i - smoothD + 1, i + 1);
            const dSma = calculateSMA(periodK, smoothD);
            dValues.push(dSma);
        }
        
        const currentD = dValues[dValues.length - 1];
        const previousD = dValues.length > 1 ? dValues[dValues.length - 2] : currentD;
        const previousK = kSmooth.length > 1 ? kSmooth[kSmooth.length - 2] : currentK;
        
        const isCrossingUp = previousK <= previousD && currentK > currentD;
        const isCrossingDown = previousK >= previousD && currentK < currentD;
        
        return {
            k: Number(currentK.toFixed(2)),
            d: Number(currentD.toFixed(2)),
            isCrossingUp,
            isCrossingDown,
            timeframe: CONFIG.STOCH.TIMEFRAME
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular StochRSI: ${error.message}`);
        return null;
    }
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) {
        return 0;
    }

    const trueRanges = [];
    
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        const trueRange = Math.max(tr1, tr2, tr3);
        trueRanges.push(trueRange);
    }
    
    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period;
    
    return atr;
}

function calculateSupportResistance(candles, currentPrice) {
    try {
        const lastCandle = candles[candles.length - 2];
        const prevCandle = candles[candles.length - 3];
        
        if (!lastCandle) {
            const currentCandle = candles[candles.length - 1];
            const pivot = (currentCandle.high + currentCandle.low + currentCandle.close) / 3;
            
            return {
                pivot: pivot,
                resistance1: pivot * 1.01,
                resistance2: pivot * 1.02,
                support1: pivot * 0.99,
                support2: pivot * 0.98
            };
        }
        
        const high = lastCandle.high;
        const low = lastCandle.low;
        const close = lastCandle.close;
        
        const pivot = (high + low + close) / 3;
        
        const r1 = (2 * pivot) - low;
        const r2 = pivot + (high - low);
        
        const s1 = (2 * pivot) - high;
        const s2 = pivot - (high - low);
        
        return {
            pivot: pivot,
            resistance1: r1,
            resistance2: r2,
            support1: s1,
            support2: s2
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular S/R: ${error.message}`);
        return {
            pivot: currentPrice,
            resistance1: currentPrice * 1.01,
            resistance2: currentPrice * 1.02,
            support1: currentPrice * 0.99,
            support2: currentPrice * 0.98
        };
    }
}

function analyzeProximity(currentPrice, supportResistance, signalType) {
    try {
        const threshold = CONFIG.PROXIMITY.THRESHOLD_PERCENT / 100;
        
        const distToR1 = Math.abs((currentPrice - supportResistance.resistance1) / currentPrice) * 100;
        const distToR2 = Math.abs((currentPrice - supportResistance.resistance2) / currentPrice) * 100;
        const distToS1 = Math.abs((currentPrice - supportResistance.support1) / currentPrice) * 100;
        const distToS2 = Math.abs((currentPrice - supportResistance.support2) / currentPrice) * 100;
        const distToPivot = Math.abs((currentPrice - supportResistance.pivot) / currentPrice) * 100;
        
        let isNearResistance = false;
        let isNearSupport = false;
        let warningMessage = '';
        let proximityType = 'NONE';
        let riskLevel = 'BAIXO';
        
        const minDistance = Math.min(distToR1, distToR2, distToS1, distToS2, distToPivot);
        
        if (minDistance <= CONFIG.PROXIMITY.WARNING_LEVELS.ALTO) {
            riskLevel = 'ALTO';
        } else if (minDistance <= CONFIG.PROXIMITY.WARNING_LEVELS.MEDIO) {
            riskLevel = 'MEDIO';
        }
        
        if (signalType === 'CCI_COMPRA') {
            if (distToR1 <= threshold) {
                isNearResistance = true;
                proximityType = 'RESISTENCE_PROXIMITY';
                warningMessage = `⚠️ ATENÇÃO: Preço muito próximo da RESISTÊNCIA R1 (${distToR1.toFixed(2)}% de distância)! Possível rejeição.`;
            } else if (distToR2 <= threshold) {
                isNearResistance = true;
                proximityType = 'RESISTENCE_PROXIMITY';
                warningMessage = `⚠️ CUIDADO: Preço próximo da RESISTÊNCIA R2 (${distToR2.toFixed(2)}% de distância)! Área de sobrecompra.`;
            } else if (currentPrice > supportResistance.pivot && distToPivot <= threshold) {
                isNearResistance = true;
                proximityType = 'PIVOT_PROXIMITY';
                warningMessage = `⚠️ Preço testando PIVOT como resistência (${distToPivot.toFixed(2)}% de distância)! Atenção.`;
            }
        } else if (signalType === 'CCI_VENDA') {
            if (distToS1 <= threshold) {
                isNearSupport = true;
                proximityType = 'SUPPORT_PROXIMITY';
                warningMessage = `⚠️ ATENÇÃO: Preço muito próximo do SUPORTE S1 (${distToS1.toFixed(2)}% de distância)! Possível bounce.`;
            } else if (distToS2 <= threshold) {
                isNearSupport = true;
                proximityType = 'SUPPORT_PROXIMITY';
                warningMessage = `⚠️ CUIDADO: Preço próximo do SUPORTE S2 (${distToS2.toFixed(2)}% de distância)! Área de sobrevenda.`;
            } else if (currentPrice < supportResistance.pivot && distToPivot <= threshold) {
                isNearSupport = true;
                proximityType = 'PIVOT_PROXIMITY';
                warningMessage = `⚠️ Preço testando PIVOT como suporte (${distToPivot.toFixed(2)}% de distância)! Possível reversão.`;
            }
        }
        
        if (!warningMessage && minDistance <= threshold * 2) {
            if (signalType === 'CCI_COMPRA' && currentPrice > supportResistance.pivot) {
                warningMessage = `ℹ️ Preço ${minDistance.toFixed(2)}% acima do pivot. Zona de resistência potencial.`;
            } else if (signalType === 'CCI_VENDA' && currentPrice < supportResistance.pivot) {
                warningMessage = `ℹ️ Preço ${minDistance.toFixed(2)}% abaixo do pivot. Zona de suporte potencial.`;
            }
        }
        
        return {
            isNearResistance,
            isNearSupport,
            distanceToResistance1: distToR1,
            distanceToResistance2: distToR2,
            distanceToSupport1: distToS1,
            distanceToSupport2: distToS2,
            distanceToPivot: distToPivot,
            warningMessage,
            proximityType,
            riskLevel
        };
        
    } catch (error) {
        console.log(`⚠️ Erro na análise de proximidade: ${error.message}`);
        return {
            isNearResistance: false,
            isNearSupport: false,
            distanceToResistance1: 999,
            distanceToResistance2: 999,
            distanceToSupport1: 999,
            distanceToSupport2: 999,
            distanceToPivot: 999,
            warningMessage: '',
            proximityType: 'NONE',
            riskLevel: 'BAIXO'
        };
    }
}

// NOVA FUNÇÃO: Análise do Pivot Multi-timeframe
async function analyzePivotMultiTimeframe(symbol, currentPrice, signalType, volumeEma1h) {
    try {
        const timeframes = ['15m', '1h', '4h'];
        const pivotResults = {};
        
        for (const tf of timeframes) {
            const candles = await getCandles(symbol, tf, 50);
            const sr = calculateSupportResistance(candles, currentPrice);
            const pivot = sr.pivot;
            
            const distance = currentPrice - pivot;
            const distancePercent = (Math.abs(distance) / pivot) * 100;
            
            // Determinar tipo
            const type = distance >= 0 ? 'ALTA' : 'BAIXA';
            
            // Determinar força
            let strength = 'FRACO';
            let strengthEmoji = type === 'ALTA' ? '🟡' : '🟠';
            
            if (distancePercent >= CONFIG.PIVOT.STRENGTH_THRESHOLDS.FORTE) {
                strength = 'FORTE';
                strengthEmoji = type === 'ALTA' ? '🟢🟢' : '🔴🔴';
            } else if (distancePercent >= CONFIG.PIVOT.STRENGTH_THRESHOLDS.MODERADO) {
                strength = 'MODERADO';
                strengthEmoji = type === 'ALTA' ? '🟢' : '🔴';
            }
            
            pivotResults[`pivot${tf}`] = {
                value: pivot,
                type,
                strength,
                strengthEmoji,
                distance,
                distancePercent
            };
        }
        
        // Analisar confluência entre timeframes
        let confluence = 'NEUTRO';
        let confluenceEmoji = '⚪';
        
        const types = [pivotResults.pivot15m.type, pivotResults.pivot1h.type, pivotResults.pivot4h.type];
        const allSameType = types.every(t => t === types[0]);
        
        if (allSameType) {
            confluence = types[0];
            confluenceEmoji = types[0] === 'ALTA' ? '🔼' : '🔽';
        } else {
            confluence = 'DIVERGENTE';
            confluenceEmoji = '🔄';
        }
        
        // Análise de possível rompimento
        let possibleBreakout = false;
        let breakoutDirection = 'NONE';
        let breakoutConfidence = 'BAIXA';
        
        const isNearPivot = pivotResults.pivot15m.distancePercent < 0.5 || 
                           pivotResults.pivot1h.distancePercent < 0.5;
        
        if (isNearPivot && volumeEma1h) {
            const volumeStrong = volumeEma1h.ratio > CONFIG.PIVOT.BREAKOUT_VOLUME_THRESHOLD;
            
            if (volumeStrong) {
                possibleBreakout = true;
                
                if (volumeEma1h.status === 'COMPRADOR') {
                    breakoutDirection = 'ALTA';
                    breakoutConfidence = volumeEma1h.ratio > 2.0 ? 'ALTA' : 'MEDIA';
                } else if (volumeEma1h.status === 'VENDEDOR') {
                    breakoutDirection = 'BAIXA';
                    breakoutConfidence = volumeEma1h.ratio > 2.0 ? 'ALTA' : 'MEDIA';
                }
            }
        }
        
        // Análise contextual
        let analysis = '';
        if (confluence === 'ALTA') {
            analysis = `✅ Confluência de ALTA em todos timeframes - tendência forte`;
        } else if (confluence === 'BAIXA') {
            analysis = `✅ Confluência de BAIXA em todos timeframes - tendência forte`;
        } else if (confluence === 'DIVERGENTE') {
            analysis = `🔄 Timeframes divergentes: 15m ${pivotResults.pivot15m.type} (${pivotResults.pivot15m.strength}), 1h ${pivotResults.pivot1h.type} (${pivotResults.pivot1h.strength}), 4h ${pivotResults.pivot4h.type} (${pivotResults.pivot4h.strength})`;
        }
        
        if (possibleBreakout) {
            analysis += ` | POSSÍVEL ROMPIMENTO para ${breakoutDirection} (confiança ${breakoutConfidence}) - Volume ${volumeEma1h.ratio.toFixed(2)}x acima da média!`;
        }
        
        return {
            ...pivotResults,
            confluence,
            confluenceEmoji,
            possibleBreakout,
            breakoutDirection: breakoutDirection !== 'NONE' ? breakoutDirection : undefined,
            breakoutConfidence: breakoutConfidence !== 'BAIXA' ? breakoutConfidence : undefined,
            analysis
        };
        
    } catch (error) {
        console.log(`⚠️ Erro na análise do pivot multi-timeframe: ${error.message}`);
        return {
            pivot15m: { value: currentPrice, type: 'ALTA', strength: 'FRACO', strengthEmoji: '🟡', distance: 0, distancePercent: 0 },
            pivot1h: { value: currentPrice, type: 'ALTA', strength: 'FRACO', strengthEmoji: '🟡', distance: 0, distancePercent: 0 },
            pivot4h: { value: currentPrice, type: 'ALTA', strength: 'FRACO', strengthEmoji: '🟡', distance: 0, distancePercent: 0 },
            confluence: 'NEUTRO',
            confluenceEmoji: '⚪',
            possibleBreakout: false,
            analysis: 'Erro na análise do pivot'
        };
    }
}

// Função de Análise de Volume 1h vs EMA9
async function analyzeVolumeEMA1h(symbol) {
    try {
        const candles = await getCandles(symbol, CONFIG.VOLUME_EMA.TIMEFRAME, CONFIG.VOLUME_EMA.EMA_PERIOD + 10);
        
        if (candles.length < CONFIG.VOLUME_EMA.EMA_PERIOD + 5) {
            return {
                value: 0,
                ema9: 0,
                ratio: 0,
                status: 'NEUTRO',
                percentage: '0%'
            };
        }
        
        const volumes = candles.map(c => c.volume);
        const lastVolume = volumes[volumes.length - 1];
        const previousVolumes = volumes.slice(-CONFIG.VOLUME_EMA.EMA_PERIOD - 1, -1);
        
        const ema9 = calculateEMA(previousVolumes, CONFIG.VOLUME_EMA.EMA_PERIOD);
        
        const ratio = lastVolume / ema9;
        const percentage = ((ratio - 1) * 100).toFixed(1) + '%';
        
        let status = 'NEUTRO';
        
        const lastCandle = candles[candles.length - 1];
        const isGreenCandle = lastCandle.close > lastCandle.open;
        
        if (ratio > CONFIG.VOLUME_EMA.THRESHOLD) {
            if (isGreenCandle) {
                status = 'COMPRADOR';
            } else {
                status = 'VENDEDOR';
            }
        } else if (ratio > 1) {
            if (isGreenCandle) {
                status = 'COMPRADOR';
            } else {
                status = 'VENDEDOR';
            }
        }
        
        return {
            value: lastVolume,
            ema9: ema9,
            ratio: ratio,
            status: status,
            percentage: percentage
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao analisar Volume EMA 1h para ${symbol}: ${error.message}`);
        return {
            value: 0,
            ema9: 0,
            ratio: 0,
            status: 'NEUTRO',
            percentage: '0%'
        };
    }
}

async function getCCI(symbol, timeframe = CONFIG.CCI.TIMEFRAME) {
    try {
        const candles = await getCandles(symbol, timeframe, 80);
        if (candles.length < CONFIG.CCI.LENGTH + 20) {
            return null;
        }
        
        const length = CONFIG.CCI.LENGTH;
        
        const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
        
        const smaValues = [];
        for (let i = length - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - length + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / length;
            smaValues.push(sma);
        }
        
        const meanDeviations = [];
        for (let i = length - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - length + 1, i + 1);
            const sma = smaValues[i - (length - 1)];
            const meanDev = slice.reduce((sum, price) => sum + Math.abs(price - sma), 0) / length;
            meanDeviations.push(meanDev);
        }
        
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
        
        const emaShort = calculateEMA(cciValues, CONFIG.CCI.EMA_SHORT);
        const emaLong = calculateEMA(cciValues, CONFIG.CCI.EMA_LONG);
        
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

async function checkAbnormalVolume(symbol, signalType) {
    try {
        const candles = await getCandles(symbol, CONFIG.VOLUME.TIMEFRAME, CONFIG.VOLUME.PERIOD + 10);
        if (candles.length < CONFIG.VOLUME.PERIOD + 5) {
            return { isValid: false, analysis: 'Dados insuficientes', volumeRatio: 0 };
        }
        
        const volumes = candles.map(c => c.volume);
        const lastVolume = volumes[volumes.length - 1];
        const prevVolumes = volumes.slice(-CONFIG.VOLUME.PERIOD - 1, -1);
        
        const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
        const volumeRatio = lastVolume / avgVolume;
        
        const lastCandle = candles[candles.length - 1];
        const isGreenCandle = lastCandle.close > lastCandle.open;
        
        let isValid = false;
        let analysis = '';
        
        if (signalType === 'CCI_COMPRA') {
            isValid = isGreenCandle && volumeRatio >= CONFIG.VOLUME.THRESHOLD;
            analysis = ` Vol: ${isGreenCandle ? '✅' : '❌'}  | ${volumeRatio.toFixed(2)}x média `;
        } else {
            const isRedCandle = lastCandle.close < lastCandle.open;
            isValid = isRedCandle && volumeRatio >= CONFIG.VOLUME.THRESHOLD;
            analysis = ` Vol: ${isRedCandle ? '✅' : '❌'}  | ${volumeRatio.toFixed(2)}x média `;
        }
        
        return {
            isValid,
            analysis,
            volumeRatio,
            currentVolume: lastVolume,
            avgVolume,
            isGreenCandle,
            lastCandle
        };
        
    } catch (error) {
        return { isValid: false, analysis: `Erro: ${error.message}`, volumeRatio: 0 };
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
            analysis = ` Force: ${emaCrossUp ? '✅' : '❌'}  | ${priceAboveEma55 ? '✅' : '❌'} Tendência`;
        } else {
            const emaCrossDown = prevEma13 >= prevEma34 && ema13 < ema34;
            const priceBelowEma55 = lastCandle.close < ema55;
            isValid = emaCrossDown && priceBelowEma55;
            analysis = `Force: ${emaCrossDown ? '✅' : '❌'}  | ${priceBelowEma55 ? '✅' : '❌'} Tendência`;
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
       
        return fundingRate;
    } catch (error) {
        return null;
    }
}

async function calculateATRTargets(symbol, currentPrice, signalType) {
    try {
        const candles = await getCandles(symbol, CONFIG.ATR.TIMEFRAME, 100);
        if (candles.length < CONFIG.ATR.LENGTH + 10) {
            return null;
        }
        
        const atr = calculateATR(candles, CONFIG.ATR.LENGTH);
        
        let stopLoss, target1, target2, target3, target4;
        
        if (signalType === 'CCI_COMPRA') {
            stopLoss = currentPrice - (atr * CONFIG.ATR.STOP_MULTIPLIER);
            target1 = currentPrice + (atr * CONFIG.ATR.MULTIPLIERS.TARGET1);
            target2 = currentPrice + (atr * CONFIG.ATR.MULTIPLIERS.TARGET2);
            target3 = currentPrice + (atr * CONFIG.ATR.MULTIPLIERS.TARGET3);
            target4 = currentPrice + (atr * CONFIG.ATR.MULTIPLIERS.TARGET4);
        } else {
            stopLoss = currentPrice + (atr * CONFIG.ATR.STOP_MULTIPLIER);
            target1 = currentPrice - (atr * CONFIG.ATR.MULTIPLIERS.TARGET1);
            target2 = currentPrice - (atr * CONFIG.ATR.MULTIPLIERS.TARGET2);
            target3 = currentPrice - (atr * CONFIG.ATR.MULTIPLIERS.TARGET3);
            target4 = currentPrice - (atr * CONFIG.ATR.MULTIPLIERS.TARGET4);
        }
        
        const risk = Math.abs(currentPrice - stopLoss);
        const rr1 = Math.abs(target1 - currentPrice) / risk;
        const rr2 = Math.abs(target2 - currentPrice) / risk;
        const rr3 = Math.abs(target3 - currentPrice) / risk;
        const rr4 = Math.abs(target4 - currentPrice) / risk;
        
        return {
            atr14: atr,
            atrMultipliers: {
                target1: CONFIG.ATR.MULTIPLIERS.TARGET1,
                target2: CONFIG.ATR.MULTIPLIERS.TARGET2,
                target3: CONFIG.ATR.MULTIPLIERS.TARGET3,
                target4: CONFIG.ATR.MULTIPLIERS.TARGET4
            },
            stopLoss,
            targets: {
                target1,
                target2,
                target3,
                target4
            },
            riskReward: {
                rr1,
                rr2,
                rr3,
                rr4
            }
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
    
    if (cciCooldown.has(symbol) && (Date.now() - cciCooldown.get(symbol)) < CONFIG.CCI.COOLDOWN_MS) {
        return null;
    }
    
    StateManager.updateActivity(symbol);
    
    try {
        const cci = await getCCI(symbol);
        if (!cci) {
            logRejection(symbol, 'CCI', 'Não foi possível obter dados');
            return null;
        }
        
        let signalType = null;
        
        if (cci.isCrossingUp) {
            signalType = 'CCI_COMPRA';
        } else if (cci.isCrossingDown) {
            signalType = 'CCI_VENDA';
        } else {
            logRejection(symbol, 'Cruzamento', 'Sem cruzamento detectado');
            return null;
        }
        
        const emaCheck = await checkEMA3m(symbol, signalType);
        if (!emaCheck.isValid) {
            logRejection(symbol, 'EMA 3m', emaCheck.error || 'Falhou nos critérios', { analysis: emaCheck.analysis });
            return null;
        }
        
        const volumeCheck = await checkAbnormalVolume(symbol, signalType);
        if (!volumeCheck.isValid) {
            logRejection(symbol, 'Volume Anormal', 'Volume não atende aos critérios', { 
                analysis: volumeCheck.analysis,
                ratio: volumeCheck.volumeRatio?.toFixed(2)
            });
            return null;
        }
        
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) {
            logRejection(symbol, 'RSI 1h', 'Não foi possível obter RSI');
            return null;
        }
        
        if (signalType === 'CCI_COMPRA' && rsiData.value >= CONFIG.RSI.BUY_MAX) {
            logRejection(symbol, 'RSI 1h', `RSI muito alto para compra: ${rsiData.value.toFixed(1)} >= ${CONFIG.RSI.BUY_MAX}`);
            return null;
        }
        
        if (signalType === 'CCI_VENDA' && rsiData.value <= CONFIG.RSI.SELL_MIN) {
            logRejection(symbol, 'RSI 1h', `RSI muito baixo para venda: ${rsiData.value.toFixed(1)} <= ${CONFIG.RSI.SELL_MIN}`);
            return null;
        }
        
        const currentPrice = await getCurrentPrice(symbol);
        if (currentPrice === 0) {
            logRejection(symbol, 'Preço', 'Não foi possível obter preço atual');
            return null;
        }
        
        const atrTargets = await calculateATRTargets(symbol, currentPrice, signalType);
        if (!atrTargets) {
            logRejection(symbol, 'ATR', 'Não foi possível calcular ATR');
            return null;
        }

        // Buscar candles para S/R 4h
        const candles4h = await getCandles(symbol, '4h', 50);
        const supportResistance4h = calculateSupportResistance(candles4h, currentPrice);
        
        // Calcular StochRSI 4h
        const stoch4h = calculateStochRSI(symbol, candles4h);
        
        const proximityAnalysis = analyzeProximity(currentPrice, supportResistance4h, signalType);
        
        const volumeEma1h = await analyzeVolumeEMA1h(symbol);
        
        // Análise do Pivot Multi-timeframe
        const pivotAnalysis = await analyzePivotMultiTimeframe(symbol, currentPrice, signalType, volumeEma1h);
        
        const [lsrData, fundingData] = await Promise.allSettled([
            getLSR(symbol),
            getFundingRate(symbol)
        ]);
        
        const lsrValue = lsrData.status === 'fulfilled' ? lsrData.value : null;
        const fundingValue = fundingData.status === 'fulfilled' ? fundingData.value : null;
        
        const alertNumber = getAlertNumberForSymbol(symbol);
        
        const enhancedEmaCheck = {
            ...emaCheck,
            volumeAnalysis: volumeCheck.analysis,
            volumeValid: volumeCheck.isValid,
            volumeRatio: volumeCheck.volumeRatio
        };
        
        const signal = {
            symbol: symbol,
            type: signalType,
            cci: cci,
            rsi: rsiData.value,
            stoch4h: stoch4h,
            lsr: lsrValue?.lsrValue,
            funding: fundingValue,
            currentPrice: currentPrice,
            time: getBrazilianDateTime(),
            emaCheck: enhancedEmaCheck,
            atrTargets: atrTargets,
            supportResistance: supportResistance4h,
            alertNumber: alertNumber,
            proximityAnalysis: proximityAnalysis,
            volumeEma1h: volumeEma1h,
            pivotAnalysis: pivotAnalysis
        };
        
        return CCISignalSchema.parse(signal);
        
    } catch (error) {
        logRejection(symbol, 'Erro', error.message);
        return null;
    }
}

// =====================================================================
// === ALERTA PRINCIPAL - VERSÃO SIMPLIFICADA COM S/R 4H E STOCH ===
// =====================================================================
async function sendCCIAlert(signal) {
    const currentPrice = signal.currentPrice;
    const atr = signal.atrTargets;
    const sr = signal.supportResistance;
    const proximity = signal.proximityAnalysis;
    const volumeEma = signal.volumeEma1h;
    const pivotAnalysis = signal.pivotAnalysis;
    const stoch4h = signal.stoch4h;
   
    const alertNumber = incrementAlertCounter(signal.symbol, signal.type);
    cciCooldown.set(signal.symbol, Date.now());
   
    let lsrText = 'N/A';
    let lsrEmoji = '';
    
    if (signal.lsr) {
        lsrText = signal.lsr.toFixed(2);
        
        if (signal.lsr > 2.8) {
            lsrEmoji = '🔴';
        } else if (signal.lsr < 1.7) {
            lsrEmoji = '🟢';
        }
        if (signal.lsr < 1) {
            lsrEmoji = '🔵';
        }
        
        lsrText = `${lsrText} ${lsrEmoji}`;
    }
   
    let fundingText = '0.0000';
    let fundingEmoji = '';
    
    if (signal.funding !== null && signal.funding !== undefined) {
        fundingText = signal.funding.toFixed(4);
        
        if (signal.funding > 0) {
            fundingText = '+' + fundingText;
        }
        
        fundingEmoji = getFundingRateEmoji(signal.funding);
        fundingText = `${fundingText} ${fundingEmoji}`;
    }
   
    const cciText = `CCI ${signal.cci.value.toFixed(1)} | EMA5 ${signal.cci.ema5.toFixed(1)} | EMA13 ${signal.cci.ema13.toFixed(1)}`;
   
    let rsiText = 'N/A';
    let rsiStatus = '';
    if (signal.rsi) {
        rsiText = signal.rsi.toFixed(0);
        if (signal.rsi < 30) rsiStatus = ' (🟢 Sobrevendido)';
        else if (signal.rsi > 70) rsiStatus = ' (🔴 Sobrecomprado)';
    }
    
    // Formatação do StochRSI 4h
    let stochText = 'Stoch 4h: N/A';
    let stochEmoji = '';
    if (stoch4h) {
        const kValue = stoch4h.k.toFixed(0);
        const dValue = stoch4h.d.toFixed(0);
        const crossEmoji = stoch4h.isCrossingUp ? '⤴️' : (stoch4h.isCrossingDown ? '⤵️' : '➡️');
        stochText = `Stoch 4h: k ${kValue} ${crossEmoji} D ${dValue}`;
        
        // Determinar condição do estocástico
        if (stoch4h.k < 20 && stoch4h.d < 20) {
            stochEmoji = '🟢 (Sobrevendido)';
        } else if (stoch4h.k > 80 && stoch4h.d > 80) {
            stochEmoji = '🔴 (Sobrecomprado)';
        }
    }
   
    const symbolData = alertCounter.get(signal.symbol);
    const counterText = ` ${signal.symbol}: #${alertNumber} (Hoje: C:${symbolData?.dailyCompra || 0}/V:${symbolData?.dailyVenda || 0})`;
   
    const actionEmoji = signal.type === 'CCI_COMPRA' ? '🟢' : '🔴';
    const actionText = signal.type === 'CCI_COMPRA' ? '🔍 Analisar COMPRA' : '🔍 Analisar CORREÇÃO';
    
    const emaAnalysis = signal.emaCheck?.analysis || 'EMA: OK';
    const volumeAnalysis = signal.emaCheck?.volumeAnalysis || 'Volume: OK';
    const volumeRatio = signal.emaCheck?.volumeRatio ? signal.emaCheck.volumeRatio.toFixed(2) : 'N/A';
    
    // Formatação do Volume 1h
    let volumeEmaText = 'N/A';
    let volumeEmaEmoji = '';
    
    if (volumeEma && volumeEma.ratio > 0) {
        if (volumeEma.status === 'COMPRADOR') {
            volumeEmaEmoji = '🟢';
        } else if (volumeEma.status === 'VENDEDOR') {
            volumeEmaEmoji = '🔴';
        } else {
            volumeEmaEmoji = '⚪';
        }
        
        volumeEmaText = `${volumeEmaEmoji} ${volumeEma.status} ${volumeEma.percentage}`;
    }
    
    const stopEmoji = signal.type === 'CCI_COMPRA' ? '⛔' : '⛔';
    const targetEmoji = signal.type === 'CCI_COMPRA' ? '🟢' : '🔴';
    
    const riskEmoji = proximity.riskLevel === 'ALTO' ? '🔴' : proximity.riskLevel === 'MÉDIO' ? '🟡' : '🟢';
    
    // NOVA FORMATAÇÃO: Pivot Multi-timeframe SIMPLIFICADA
    const pivotEmoji = pivotAnalysis.confluenceEmoji;
    
    // Formato compacto: 15m:🟢 1h:🟡 4h:🟢
    const pivotCompact = `15m:${pivotAnalysis.pivot15m.strengthEmoji} 1h:${pivotAnalysis.pivot1h.strengthEmoji} 4h:${pivotAnalysis.pivot4h.strengthEmoji}`;
    
    // Distâncias formatadas
    const pivotDistances = `15m ${pivotAnalysis.pivot15m.distancePercent.toFixed(2)}% | 1h ${pivotAnalysis.pivot1h.distancePercent.toFixed(2)}% | 4h ${pivotAnalysis.pivot4h.distancePercent.toFixed(2)}%`;
    
    // Determinar confluência de forma simples
    const allSameType = (pivotAnalysis.pivot15m.type === pivotAnalysis.pivot1h.type && 
                         pivotAnalysis.pivot1h.type === pivotAnalysis.pivot4h.type);
    const confluenceText = allSameType ? `✅ Confluência de ${pivotAnalysis.pivot15m.type} - tendência forte` : `🔄 Timeframes divergentes`;
    
    // Formatação do breakout (se houver)
    let breakoutText = '';
    if (pivotAnalysis.possibleBreakout) {
        const breakoutEmoji = pivotAnalysis.breakoutDirection === 'ALTA' ? '🚀' : '📉';
        const confidenceEmoji = pivotAnalysis.breakoutConfidence === 'ALTA' ? '🔴' : 
                               pivotAnalysis.breakoutConfidence === 'MÉDIA' ? '🟡' : '🟢';
        breakoutText = `\n${breakoutEmoji} POSSÍVEL ROMPIMENTO para ${pivotAnalysis.breakoutDirection} (confiança ${pivotAnalysis.breakoutConfidence} ${confidenceEmoji}) - Volume ${volumeEma.ratio.toFixed(2)}x EMA9!`;
    }
    
    let messageText = `${actionEmoji} ${actionText} • ${signal.symbol}
Preço: $${currentPrice.toFixed(6)}
${counterText} - ${signal.time.full}hs
❅──────✧❅✨❅✧──────❅
PIVOT: ${pivotEmoji} TODOS ${pivotAnalysis.pivot15m.type} (${pivotCompact})
Distância: ${pivotDistances}
${confluenceText}${breakoutText}
${stochText} ${stochEmoji}
${emaAnalysis}
${volumeAnalysis} (${volumeRatio}x)
Vol 1h: ${volumeEmaText}
RSI 1h: ${rsiText}${rsiStatus}
LSR: ${lsrText}
Funding: ${fundingText}
Suporte/Resistência (4h): 
R1: $${sr.resistance1.toFixed(6)} | R2: $${sr.resistance2.toFixed(6)}
S1: $${sr.support1.toFixed(6)} | S2: $${sr.support2.toFixed(6)}
🎯 ALVOS:
Alvo 1: $${atr.targets.target1.toFixed(6)} 
Alvo 2: $${atr.targets.target2.toFixed(6)} 
Alvo 3: $${atr.targets.target3.toFixed(6)} 
Alvo 4: $${atr.targets.target4.toFixed(6)} 
${stopEmoji} Stop: $${atr.stopLoss.toFixed(6)} 
`;

    if (proximity.warningMessage) {
        messageText += `🤖IA Análise... ${riskEmoji}:
${proximity.warningMessage}
`;
        
        if (signal.type === 'CCI_COMPRA' && proximity.isNearResistance) {
            messageText += ` Distância das resistências:
R1: ${proximity.distanceToResistance1.toFixed(2)}% | R2: ${proximity.distanceToResistance2.toFixed(2)}%
Pivot: ${proximity.distanceToPivot.toFixed(2)}%
`;
        } else if (signal.type === 'CCI_VENDA' && proximity.isNearSupport) {
            messageText += ` Distância dos suportes:
S1: ${proximity.distanceToSupport1.toFixed(2)}% | S2: ${proximity.distanceToSupport2.toFixed(2)}%
Pivot: ${proximity.distanceToPivot.toFixed(2)}%
`;
        }
    } else {
        const pricePosition = currentPrice > sr.pivot ? 'acima' : 'abaixo';
        messageText += `📈 Análise Rápida ${riskEmoji}:
Preço ${pricePosition} do pivot (${proximity.distanceToPivot.toFixed(2)}%)
Risco de entrada: ${proximity.riskLevel}
`;
    }
    
    messageText += `
Alerta Educativo, não é recomendação de investimento
✨ Titanium by @J4Rviz ✨`;

    await sendTelegramAlert(messageText);
   
    console.log(`✅ Alerta #${alertNumber} enviado: ${signal.symbol} (${actionText})`);
    console.log(`📊 Pivot: ${pivotCompact} | Distâncias: ${pivotDistances}`);
    console.log(`📊 ${stochText}`);
    if (pivotAnalysis.possibleBreakout) {
        console.log(`🚀 POSSÍVEL ROMPIMENTO ${pivotAnalysis.breakoutDirection} (confiança ${pivotAnalysis.breakoutConfidence})`);
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
                await sendCCIAlert(cciSignal);
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
        console.log(' TITANIUM  ');
        console.log(` ${symbols.length} símbolos | Batch: ${batchSize}`);
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
            const stateStats = StateManager.getStats();
            
            console.log(`\n✅ Ciclo ${cycle} completo em ${cycleTime}s`);
            console.log(`📊 Sinais: ${signalsFound} | Cache: ${cacheStats.hitRate}`);
            console.log(`📈 Total Global: ${globalAlerts} | Símbolos ativos: ${stateStats.alertCounter}`);
            
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
        console.log(' TITANIUM  ');
        console.log('='.repeat(60) + '\n');

        console.log('📅 Inicializando...');
        console.log('⏳ Buscando configurações...');
        
        console.log('\n📱 Verificando configurações do Telegram:');
        console.log(`Bot Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? 'Configurado' : '❌ NÃO CONFIGURADO'}`);
        console.log(`Chat ID: ${CONFIG.TELEGRAM.CHAT_ID ? 'Configurado' : '❌ NÃO CONFIGURADO'}`);
        
        lastResetDate = getBrazilianDateString();
        
        StateManager.init();
        
        console.log('📤 Testando conexão com Telegram...');
        const testMessage = `🤖 Bot Titanium  iniciando em ${getBrazilianDateTime().full}`;
        const testResult = await sendTelegramAlert(testMessage);

        if (testResult) {
            console.log('✅ Conexão com Telegram OK!');
        } else {
            console.log('⚠️ Falha na conexão com Telegram.');
        }

        await sendInitializationMessage();

        console.log('\n✅ Bot inicializado! Iniciando loop principal...\n');
        
        while (true) {
            try {
                await mainBotLoop();
            } catch (fatalError) {
                console.error("❌ Erro fatal no loop principal:", fatalError.message);
                console.log('🔄 Reiniciando em 30s...');
                await new Promise(r => setTimeout(r, 30000));
            }
        }

    } catch (initError) {
        console.error('🚨 Erro na inicialização:', initError.message);
        console.log('🔧 Verifique sua conexão e as configurações');
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    console.error('\n!!! UNCAUGHT EXCEPTION !!!');
    console.error('Erro:', err.message);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n!!! UNHANDLED REJECTION !!!');
    console.error('Reason:', reason);
});

console.log('🚀 Iniciando Titanium Bot...');

startBot().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

if (global.gc) {
    console.log('🗑️ GC disponível');
}
