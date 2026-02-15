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
const StochasticSchema = z.object({
    k: z.number().min(0).max(100),
    d: z.number().min(0).max(100),
    previousK: z.number().min(0).max(100),
    previousD: z.number().min(0).max(100),
    isCrossingUp: z.boolean(),
    isCrossingDown: z.boolean(),
    status: z.enum(['OVERSOLD', 'OVERBOUGHT', 'NEUTRAL']),
    isOversold: z.boolean(),
    isOverbought: z.boolean(),
    timeframe: z.string(),
    config: z.string()
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
const StochasticSignalSchema = z.object({
    symbol: z.string().regex(/^[A-Z0-9]+USDT$/),
    type: z.enum(['STOCHASTIC_COMPRA', 'STOCHASTIC_VENDA']),
    stochastic: StochasticSchema,
    rsi: z.number().min(0).max(100).optional().nullable(),
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
// === CONFIGURAÇÕES DE RSI 1H PARA ALERTAS - FÁCIL AJUSTE ===
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
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pdg',
        CHAT_ID: '-1002559'
    },
    STOCHASTIC: {
        ENABLED: true,
        K_PERIOD: 5,
        D_PERIOD: 3,
        SLOWING: 3,
        TIMEFRAME: '12h',
        OVERBOUGHT: 70,
        OVERSOLD: 67
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 200,
        CYCLE_DELAY_MS: 30000,
        MAX_SYMBOLS_PER_CYCLE: 0,
        COOLDOWN_MINUTES: 5,
        CANDLE_CACHE_TTL: 90000,
        MAX_CACHE_AGE: 12 * 60 * 1000
    },
    CLEANUP: {
        INTERVAL: 5 * 60 * 1000,
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
const stochasticCooldown = {};
const stochCrossState = {};

// === CACHE DE CANDLES ===
const candleCache = {};

// =====================================================================
// === ERROR HANDLER GRANULAR COM ZOD ===
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
            console.log(`🌐 Erro de rede [${context}]: ${error.code} - ${error.message}`);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                console.log(`🔧 Erro no schema do ErrorHandler: ${validationError.message}`);
                return errorResponse;
            }
        }

        if (error.name === 'AbortError' || error.code === 'TIMEOUT') {
            errorResponse.type = 'TIMEOUT_ERROR';
            errorResponse.retryable = true;
            errorResponse.message = 'Timeout da requisição';
            console.log(`⏰ Timeout [${context}]: ${error.message}`);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        if (error.response?.status) {
            const status = error.response.status;
            const binanceError = this.BINANCE_ERRORS[status] || 'HTTP_ERROR';
            errorResponse.type = binanceError;
            errorResponse.retryable = [429, 500, 502, 503, 504].includes(status);
            errorResponse.message = `HTTP ${status}: ${error.response.statusText || binanceError}`;
           
            if (status === 429) {
                console.log(`⚠️ Rate limit excedido [${context}] - Aguardando...`);
            } else {
                console.log(`⚠️ Erro HTTP ${status} [${context}]: ${error.response.statusText}`);
            }
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        if (error instanceof SyntaxError && error.message.includes('JSON')) {
            errorResponse.type = 'PARSE_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = 'Erro ao processar resposta';
            console.log(`🔧 Erro de parsing [${context}]: ${error.message}`);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        if (error.message.includes('invalid') || error.message.includes('Invalid')) {
            errorResponse.type = 'VALIDATION_ERROR';
            errorResponse.retryable = false;
            console.log(`⚠️ Erro de validação [${context}]: ${error.message}`);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        if (error.message.includes('cache') || error.code === 'CACHE_ERROR') {
            errorResponse.type = 'CACHE_ERROR';
            errorResponse.retryable = true;
            console.log(`💾 Erro de cache [${context}]: ${error.message}`);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        // Erro Zod específico
        if (error instanceof z.ZodError) {
            errorResponse.type = 'ZOD_VALIDATION_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = `Erro de validação Zod: ${error.errors.map(e => e.message).join(', ')}`;
            console.log(`🔧 Erro Zod [${context}]:`, error.errors);
            
            try {
                return ErrorResponseSchema.parse(errorResponse);
            } catch (validationError) {
                return errorResponse;
            }
        }

        console.log(`❌ Erro não classificado [${context}]: ${error.message}`);
        
        try {
            return ErrorResponseSchema.parse(errorResponse);
        } catch (validationError) {
            return errorResponse;
        }
    }

    static async retry(fn, context, maxRetries = 3, baseDelay = 1000) {
        let lastError;
       
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const errorInfo = this.handle(error, `${context} (tentativa ${attempt}/${maxRetries})`);
               
                if (!errorInfo.retryable || attempt === maxRetries) {
                    break;
                }
               
                const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                console.log(`⏳ Retentativa ${attempt}/${maxRetries} em ${Math.round(delay)}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
       
        throw lastError;
    }
}

// =====================================================================
// === ADVANCED CLEANUP SYSTEM ===
// =====================================================================
class AdvancedCleanupSystem {
    constructor() {
        this.lastCleanup = Date.now();
        this.cleanupInterval = CONFIG.CLEANUP.INTERVAL;
        this.maxLogDays = CONFIG.CLEANUP.MAX_LOG_DAYS;
        this.maxCacheDays = CONFIG.CLEANUP.MAX_CACHE_DAYS;
        this.memoryThreshold = CONFIG.CLEANUP.MEMORY_THRESHOLD;
    }

    cleanupCaches() {
        const now = Date.now();
        let deletedCount = 0;

        try {
            Object.keys(candleCache).forEach(key => {
                if (now - candleCache[key].timestamp > CONFIG.PERFORMANCE.MAX_CACHE_AGE) {
                    delete candleCache[key];
                    deletedCount++;
                }
            });

            const keys = Object.keys(candleCache);
            if (keys.length > 8000) {
                keys.sort((a, b) => candleCache[b].timestamp - candleCache[a].timestamp);
                for (let i = 8000; i < keys.length; i++) {
                    delete candleCache[keys[i]];
                    deletedCount++;
                }
            }

            if (deletedCount > 0) {
                console.log(`🗑️ Cache limpo: ${deletedCount} entradas removidas (total restante: ${Object.keys(candleCache).length})`);
            }
        } catch (error) {
            ErrorHandler.handle(error, 'CleanupCaches');
        }
    }

    cleanupOldLogs() {
        if (!fs.existsSync(LOG_DIR)) return 0;
       
        try {
            const files = fs.readdirSync(LOG_DIR);
            const now = Date.now();
            const maxLogAge = this.maxLogDays * 24 * 60 * 60 * 1000;
            let deletedFiles = 0;
           
            files.forEach(file => {
                try {
                    const filePath = path.join(LOG_DIR, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxLogAge) {
                        fs.unlinkSync(filePath);
                        deletedFiles++;
                        console.log(`🗑️ Log antigo removido: ${file}`);
                    }
                } catch (error) {
                    ErrorHandler.handle(error, `CleanupLog-${file}`);
                }
            });
           
            return deletedFiles;
        } catch (error) {
            ErrorHandler.handle(error, 'CleanupOldLogs');
            return 0;
        }
    }

    cleanupCacheFiles() {
        if (!fs.existsSync(CACHE_DIR)) return 0;
       
        try {
            const files = fs.readdirSync(CACHE_DIR);
            const now = Date.now();
            const maxCacheAge = this.maxCacheDays * 24 * 60 * 60 * 1000;
            let deletedFiles = 0;
           
            files.forEach(file => {
                try {
                    const filePath = path.join(CACHE_DIR, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxCacheAge) {
                        fs.unlinkSync(filePath);
                        deletedFiles++;
                        console.log(`🗑️ Cache file removido: ${file}`);
                    }
                } catch (error) {
                    ErrorHandler.handle(error, `CleanupCacheFile-${file}`);
                }
            });
           
            return deletedFiles;
        } catch (error) {
            ErrorHandler.handle(error, 'CleanupCacheFiles');
            return 0;
        }
    }

    monitorMemoryUsage() {
        try {
            const used = process.memoryUsage();
            const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
            const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
            const rssMB = Math.round(used.rss / 1024 / 1024);
           
            console.log(`🧠 Memória: ${heapUsedMB}MB usados / ${heapTotalMB}MB alocados / ${rssMB}MB RSS`);
           
            if (used.heapUsed > this.memoryThreshold) {
                console.log('⚠️ Memória alta, limpando cache agressivamente...');
                const cacheSizeBefore = Object.keys(candleCache).length;
                Object.keys(candleCache).forEach(key => delete candleCache[key]);
                console.log(`🗑️ Cache limpo: ${cacheSizeBefore} entradas removidas`);
               
                if (global.gc) {
                    global.gc();
                    console.log('🗑️ Coleta de lixo forçada executada');
                }
            }
           
            return heapUsedMB;
        } catch (error) {
            ErrorHandler.handle(error, 'MonitorMemory');
            return 0;
        }
    }

    performFullCleanup() {
        const now = Date.now();
       
        if (now - this.lastCleanup > this.cleanupInterval) {
            console.log('\n🔄 Executando limpeza automática do sistema...');
           
            const logsRemoved = this.cleanupOldLogs();
            const cacheFilesRemoved = this.cleanupCacheFiles();
            const memoryUsed = this.monitorMemoryUsage();
            this.cleanupCaches();
           
            console.log(`✅ Limpeza completa: ${logsRemoved} logs, ${cacheFilesRemoved} arquivos cache`);
            console.log(`📊 Uso de memória atual: ${memoryUsed}MB`);
           
            this.lastCleanup = now;
        }
    }
}

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

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
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
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.response = { status: response.status, statusText: response.statusText };
            throw error;
        }
        console.log('✅ Mensagem enviada para Telegram com sucesso!');
        return true;
    } catch (error) {
        ErrorHandler.handle(error, 'SendTelegramAlert');
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
            stochastic: 0,
            total: 0,
            lastAlert: null,
            dailyStochastic: 0,
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
        symbolDailyStochastic: alertCounter[symbol].dailyStochastic
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
   
    console.log(`\n🕘 ${getBrazilianDateTime().full} - RESETANDO CONTADORES DIÁRIOS (21h BR)`);
   
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyStochastic = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
   
    dailyAlerts = 0;
    lastResetDate = currentDate;
   
    console.log(`✅ Contadores diários zerados. Global: ${globalAlerts} | Diário: ${dailyAlerts}`);
}

async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
       
        const message = `
<b>🚀 TITANIUM INICIADO ✅</b>
📅 ${now.full}
<i>✅ ALERTAS ATIVOS</i>
<i>📊 Estocástico 12h 5.3.3</i>
`;
        console.log('📤 Enviando mensagem de inicialização para Telegram...');
        const success = await sendTelegramAlert(message);
       
        if (success) {
            console.log('✅ Mensagem de inicialização enviada com sucesso!');
        } else {
            console.log('⚠️ Não foi possível enviar mensagem de inicialização');
        }
       
        return success;
    } catch (error) {
        ErrorHandler.handle(error, 'SendInitializationMessage');
        return false;
    }
}

// =====================================================================
// === FUNÇÕES DE ANÁLISE TÉCNICA COM VALIDAÇÃO ZOD ===
// =====================================================================
async function getCandles(symbol, timeframe, limit = 80) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }
        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h',
            '12h': '12h', '1d': '1d'
        };
        const interval = intervalMap[timeframe] || '3m';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'klines'),
            `GetCandles-${symbol}-${timeframe}`,
            3,
            1000
        );
        
        // Valida a resposta da Binance
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
        
        // Valida cada candle
        const validatedCandles = candles.map(candle => CandleSchema.parse(candle));
        
        candleCache[cacheKey] = { data: validatedCandles, timestamp: now };
        return validatedCandles;
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getCandles [${symbol}]:`, error.errors);
            throw new Error(`Dados de candle inválidos: ${error.errors.map(e => e.message).join(', ')}`);
        }
        const errorInfo = ErrorHandler.handle(error, `GetCandles-${symbol}-${timeframe}`);
        throw new Error(`Falha ao buscar candles: ${errorInfo.message}`);
    }
}

function calculateEMA(values, period) {
    try {
        if (values.length < period) {
            return values.reduce((a, b) => a + b, 0) / values.length;
        }
       
        const multiplier = 2 / (period + 1);
        let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
       
        for (let i = period; i < values.length; i++) {
            ema = (values[i] - ema) * multiplier + ema;
        }
       
        return ema;
    } catch (error) {
        ErrorHandler.handle(error, 'CalculateEMA');
        return 0;
    }
}

async function getStochastic(symbol, timeframe = CONFIG.STOCHASTIC.TIMEFRAME) {
    try {
        const candles = await getCandles(symbol, timeframe, 50);
        if (candles.length < 14) {
            return null;
        }
        const kPeriod = CONFIG.STOCHASTIC.K_PERIOD;
        const dPeriod = CONFIG.STOCHASTIC.D_PERIOD;
        const slowing = CONFIG.STOCHASTIC.SLOWING;
       
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
       
        const stochValues = [];
       
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const highSlice = highs.slice(i - kPeriod + 1, i + 1);
            const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
           
            const highestHigh = Math.max(...highSlice);
            const lowestLow = Math.min(...lowSlice);
           
            if (highestHigh === lowestLow) {
                stochValues.push(50);
            } else {
                const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
                stochValues.push(k);
            }
        }
       
        const smoothedK = [];
        for (let i = slowing - 1; i < stochValues.length; i++) {
            const kSlice = stochValues.slice(i - slowing + 1, i + 1);
            const avgK = kSlice.reduce((a, b) => a + b, 0) / kSlice.length;
            smoothedK.push(avgK);
        }
       
        const dValues = [];
        for (let i = dPeriod - 1; i < smoothedK.length; i++) {
            const dSlice = smoothedK.slice(i - dPeriod + 1, i + 1);
            const d = dSlice.reduce((a, b) => a + b, 0) / dSlice.length;
            dValues.push(d);
        }
       
        if (smoothedK.length < 2 || dValues.length < 2) {
            return null;
        }
       
        const latestK = smoothedK[smoothedK.length - 1];
        const latestD = dValues[dValues.length - 1];
        const previousK = smoothedK[smoothedK.length - 2];
        const previousD = dValues[dValues.length - 2];
       
        const isCrossingUp = previousK <= previousD && latestK > latestD;
        const isCrossingDown = previousK >= previousD && latestK < latestD;
       
        let status = 'NEUTRAL';
        if (latestK < CONFIG.STOCHASTIC.OVERSOLD && latestD < CONFIG.STOCHASTIC.OVERSOLD) {
            status = 'OVERSOLD';
        } else if (latestK > CONFIG.STOCHASTIC.OVERBOUGHT && latestD > CONFIG.STOCHASTIC.OVERBOUGHT) {
            status = 'OVERBOUGHT';
        }
        
        const stochasticResult = {
            k: latestK,
            d: latestD,
            previousK: previousK,
            previousD: previousD,
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            status: status,
            isOversold: status === 'OVERSOLD',
            isOverbought: status === 'OVERBOUGHT',
            timeframe: timeframe,
            config: `${kPeriod}.${dPeriod}.${slowing}`
        };
        
        // Valida com Zod
        return StochasticSchema.parse(stochasticResult);
       
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getStochastic [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `GetStochastic-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: VERIFICAÇÃO EMA 3 MINUTOS COM ZOD ===
// =====================================================================
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
       
        if (signalType === 'STOCHASTIC_COMPRA') {
            const emaCrossUp = prevEma13 <= prevEma34 && ema13 > ema34;
            const priceAboveEma55 = lastCandle.close > ema55;
           
            isValid = emaCrossUp && priceAboveEma55;
           
            analysis = `📊 EMA 3m: ${emaCrossUp ? '✅' : '❌'} Cruzamento 13/34 | ${priceAboveEma55 ? '✅' : '❌'} Preço > EMA55`;
           
            console.log(` • EMA 13/34: ${emaCrossUp ? 'Cruzou para CIMA' : 'Sem cruzamento'}`);
            console.log(` • EMA 55: ${priceAboveEma55 ? 'Preço ACIMA' : 'Preço ABAIXO'}`);
           
        } else {
            const emaCrossDown = prevEma13 >= prevEma34 && ema13 < ema34;
            const priceBelowEma55 = lastCandle.close < ema55;
           
            isValid = emaCrossDown && priceBelowEma55;
           
            analysis = `📊 EMA 3m: ${emaCrossDown ? '✅' : '❌'} Cruzamento 13/34 | ${priceBelowEma55 ? '✅' : '❌'} Preço < EMA55`;
           
            console.log(` • EMA 13/34: ${emaCrossDown ? 'Cruzou para BAIXO' : 'Sem cruzamento'}`);
            console.log(` • EMA 55: ${priceBelowEma55 ? 'Preço ABAIXO' : 'Preço ACIMA'}`);
        }
        
        const emaResult = {
            isValid,
            analysis,
            ema13,
            ema34,
            ema55,
            lastPrice: lastCandle.close
        };
        
        // Valida com Zod (passthrough permite campos extras)
        return EMACheckSchema.parse(emaResult);
       
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em checkEMA3m [${symbol}]:`, error.errors);
            return { isValid: false, error: 'Erro de validação' };
        }
        ErrorHandler.handle(error, `CheckEMA3m-${symbol}`);
        return { isValid: false, error: error.message };
    }
}

async function getCurrentPrice(symbol) {
    try {
        const candles = await getCandles(symbol, '1m', 1);
        return candles[candles.length - 1].close;
    } catch (error) {
        ErrorHandler.handle(error, `GetCurrentPrice-${symbol}`);
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
        const avgLoss = losses / 14;
        const rs = avgGain / (avgLoss || 0.001);
        const rsi = 100 - (100 / (1 + rs));
        
        const rsiResult = {
            value: rsi,
            status: rsi < 25 ? 'OVERSOLD' : rsi > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
        
        // Valida com Zod
        return RSISchema.parse(rsiResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getRSI1h [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `GetRSI1h-${symbol}`);
        return null;
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const response = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'lsr'),
            `GetLSR-${symbol}`,
            2,
            500
        );
        
        // Valida a resposta da Binance
        const validatedResponse = LSRResponseSchema.parse(response);
       
        if (!validatedResponse || validatedResponse.length === 0) {
            return null;
        }
       
        const data = validatedResponse[0];
        const lsrValue = parseFloat(data.longShortRatio);
       
        return {
            lsrValue: lsrValue,
            longAccount: parseFloat(data.longAccount),
            shortAccount: parseFloat(data.shortAccount)
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getLSR [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `GetLSR-${symbol}`);
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'fundingRate'),
            `GetFundingRate-${symbol}`,
            2,
            500
        );
        
        // Valida a resposta da Binance
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
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getFundingRate [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `GetFundingRate-${symbol}`);
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
       
        const nearestResistance = resistances.length > 0 ? resistances[0] : null;
        const nearestSupport = supports.length > 0 ? supports[0] : null;
        
        const pivotResult = {
            pivot: pivot,
            resistances: resistances,
            supports: supports,
            nearestResistance: nearestResistance,
            nearestSupport: nearestSupport,
            nearestPivot: isBullish ? nearestResistance : nearestSupport
        };
        
        // Valida com Zod (passthrough permite campos extras)
        return PivotPointSchema.parse(pivotResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzePivotPoints [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `AnalyzePivot-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: CALCULAR ATR 4H ===
// =====================================================================
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
       
        const atr = trValues.reduce((a, b) => a + b, 0) / trValues.length;
       
        return atr;
    } catch (error) {
        ErrorHandler.handle(error, `CalculateATR-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: CALCULAR RETRAÇÃO DE ENTRADA ===
// =====================================================================
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
        ErrorHandler.handle(error, `CalculateEntryRetraction-${symbol}`);
        return { entryPrice: currentPrice, retractionRange: null };
    }
}

// =====================================================================
// === FUNÇÃO: CALCULAR ALVOS BASEADOS EM ATR ===
// =====================================================================
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
        
        const atrResult = {
            atr,
            targets,
            multipliers
        };
        
        // Valida com Zod (nullable)
        return ATRTargetsSchema.parse(atrResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em calculateATRTargets [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `CalculateATRTargets-${symbol}`);
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
        ErrorHandler.handle(error, `CalculateSR-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: ANALISAR VOLUME 1H COM EMA 9 COM ZOD ===
// =====================================================================
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
        
        const volumeResult = {
            direction,
            percentage: Math.round(buyerPercentage),
            sellerPercentage: Math.round(100 - buyerPercentage),
            emoji
        };
        
        // Valida com Zod
        return VolumeAnalysisSchema.parse(volumeResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzeVolume1hWithEMA9 [${symbol}]:`, error.errors);
            return { direction: 'Erro', percentage: 0, emoji: '❌' };
        }
        ErrorHandler.handle(error, `AnalyzeVolume1h-${symbol}`);
        return { direction: 'Erro', percentage: 0, emoji: '❌' };
    }
}

// =====================================================================
// === FUNÇÃO: ENCONTRAR NÍVEIS SIGNIFICATIVOS ===
// =====================================================================
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

// =====================================================================
// === FUNÇÃO: ANALISAR RETESTE DE SUPORTE/RESISTÊNCIA COM ZOD ===
// =====================================================================
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
        
        if (signalType === 'STOCHASTIC_COMPRA') {
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
        let avgVolume = 0;
        
        const volumes5m = candles5m.map(c => c.volume);
        avgVolume = volumes5m.reduce((a, b) => a + b, 0) / volumes5m.length;
        
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
        
        const retestResult = {
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
        
        // Valida com Zod
        return RetestDataSchema.parse(retestResult);
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzeSupportResistanceRetest [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `AnalyzeRetest-${symbol}`);
        return null;
    }
}

// =====================================================================
// === SINAIS DE ESTOCÁSTICO COM FILTROS E VALIDAÇÃO ZOD ===
// =====================================================================
async function checkStochasticSignal(symbol) {
    if (!CONFIG.STOCHASTIC.ENABLED) {
        return null;
    }
    
    if (stochasticCooldown[symbol] && (Date.now() - stochasticCooldown[symbol]) < 20 * 60 * 1000) {
        return null;
    }
    
    try {
        const stochastic = await getStochastic(symbol);
        if (!stochastic) {
            return null;
        }
        
        const previousState = stochCrossState[symbol] || {
            wasCrossingUp: false,
            wasCrossingDown: false,
            lastCheck: 0
        };
        
        let signalType = null;
        let isFreshCross = false;
        
        if (stochastic.isCrossingUp) {
            if (!previousState.wasCrossingUp) {
                signalType = 'STOCHASTIC_COMPRA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para CIMA (K=${stochastic.k.toFixed(1)})`);
            }
            stochCrossState[symbol] = {
                wasCrossingUp: true,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        } else if (stochastic.isCrossingDown) {
            if (!previousState.wasCrossingDown) {
                signalType = 'STOCHASTIC_VENDA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para BAIXO (K=${stochastic.k.toFixed(1)})`);
            }
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: true,
                lastCheck: Date.now()
            };
        } else {
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        }
        
        if (!isFreshCross || !signalType) {
            return null;
        }
        
        if (signalType === 'STOCHASTIC_COMPRA' && stochastic.k >= CONFIG.STOCHASTIC.OVERSOLD) {
            console.log(`⚠️ ${symbol}: Cruzamento de COMPRA ignorado - Estocástico K=${stochastic.k.toFixed(1)} (deve ser < ${CONFIG.STOCHASTIC.OVERSOLD})`);
            return null;
        }
       
        if (signalType === 'STOCHASTIC_VENDA' && stochastic.k <= CONFIG.STOCHASTIC.OVERBOUGHT) {
            console.log(`⚠️ ${symbol}: Cruzamento de VENDA ignorado - Estocástico K=${stochastic.k.toFixed(1)} (deve ser > ${CONFIG.STOCHASTIC.OVERBOUGHT})`);
            return null;
        }
        
        const emaCheck = await checkEMA3m(symbol, signalType);
        if (!emaCheck.isValid) {
            console.log(`⚠️ ${symbol}: Sinal ignorado - EMA 3m não confirmou`);
            if (emaCheck.analysis) {
                console.log(` ${emaCheck.analysis}`);
            }
            return null;
        }
       
        console.log(`✅ ${symbol}: EMA 3m confirmou o sinal`);
        
        const [rsiData, lsrData, fundingData, pivotData, currentPrice, volumeData, retestData] = await Promise.all([
            getRSI1h(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzePivotPoints(symbol, await getCurrentPrice(symbol), signalType === 'STOCHASTIC_COMPRA'),
            getCurrentPrice(symbol),
            analyzeVolume1hWithEMA9(symbol),
            analyzeSupportResistanceRetest(symbol, await getCurrentPrice(symbol), signalType)
        ]);
        
        if (signalType === 'STOCHASTIC_COMPRA' && RSI_1H_CONFIG.COMPRA.ENABLED) {
            if (!rsiData || rsiData.value >= RSI_1H_CONFIG.COMPRA.MAX_RSI) {
                console.log(`⚠️ ${symbol}: Sinal de COMPRA ignorado - RSI 1h ${rsiData?.value?.toFixed(1) || 'N/A'} >= ${RSI_1H_CONFIG.COMPRA.MAX_RSI}`);
                return null;
            }
            console.log(`✅ ${symbol}: RSI 1h ${rsiData.value.toFixed(1)} < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} - OK para COMPRA`);
        }
       
        if (signalType === 'STOCHASTIC_VENDA' && RSI_1H_CONFIG.VENDA.ENABLED) {
            if (!rsiData || rsiData.value <= RSI_1H_CONFIG.VENDA.MIN_RSI) {
                console.log(`⚠️ ${symbol}: Sinal de VENDA ignorado - RSI 1h ${rsiData?.value?.toFixed(1) || 'N/A'} <= ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
                return null;
            }
            console.log(`✅ ${symbol}: RSI 1h ${rsiData.value.toFixed(1)} > ${RSI_1H_CONFIG.VENDA.MIN_RSI} - OK para VENDA`);
        }
        
        const entryRetraction = await calculateEntryRetraction(symbol, currentPrice, signalType === 'STOCHASTIC_COMPRA');
        const entryPrice = entryRetraction.entryPrice;
        
        const atrTargets = await calculateATRTargets(symbol, entryPrice, signalType === 'STOCHASTIC_COMPRA');
        const srLevels = await calculateSupportResistance15m(symbol, currentPrice);
        
        // Monta o objeto do sinal
        const signal = {
            symbol: symbol,
            type: signalType,
            stochastic: stochastic,
            rsi: rsiData?.value,
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
            retestData: retestData
        };
        
        // VALIDAÇÃO FINAL COM ZOD - GARANTE QUE O SINAL É 100% VÁLIDO
        try {
            const validatedSignal = StochasticSignalSchema.parse(signal);
            return validatedSignal;
        } catch (validationError) {
            if (validationError instanceof z.ZodError) {
                console.log(`🔧 ERRO CRÍTICO: Sinal inválido para ${symbol}:`, validationError.errors);
                
                // Log detalhado para debug
                console.log('📦 Dados que causaram o erro:');
                validationError.errors.forEach(err => {
                    console.log(`   - ${err.path.join('.')}: ${err.message}`);
                });
            }
            return null;
        }
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em checkStochasticSignal [${symbol}]:`, error.errors);
            return null;
        }
        ErrorHandler.handle(error, `CheckStochasticSignal-${symbol}`);
        return null;
    }
}

// =====================================================================
// === ANÁLISE DE FATORES POSITIVOS E NEGATIVOS ===
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

        if (signalType === 'STOCHASTIC_COMPRA') {
            if (fundingValue <= -0.001) {
                factors.positive.push(`🟢🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue <= -0.0003) {
                factors.positive.push(`🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue <= 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (levemente negativo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue <= 0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue <= 0.001) {
                factors.negative.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
            } else {
                factors.negative.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
            }
        } else {
            if (fundingValue >= 0.001) {
                factors.positive.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue >= 0.0003) {
                factors.positive.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue > 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (levemente positivo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue >= -0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue >= -0.001) {
                factors.negative.push(`🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
            } else {
                factors.negative.push(`🔵🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ FUNDING: Indisponível`);
    }

    if (indicators.lsr) {
        const lsrValue = indicators.lsr;

        if (signalType === 'STOCHASTIC_COMPRA') {
            if (lsrValue < 1.5) {
                factors.positive.push(`🟢🟢 LSR: ${lsrValue.toFixed(3)} (shorts dominam)`);
                totalScore += weights.LSR;
            } else if (lsrValue < 2.5) {
                factors.positive.push(`🟢 LSR: ${lsrValue.toFixed(3)} (shorts em vantagem)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue < 3.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)} (equilíbrio)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue < 4.0) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)} (longs em vantagem)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔴 LSR: ${lsrValue.toFixed(3)} (longs dominam)`);
            }
        } else {
            if (lsrValue > 4.0) {
                factors.positive.push(`🔴🔴 LSR: ${lsrValue.toFixed(3)} (longs dominam)`);
                totalScore += weights.LSR;
            } else if (lsrValue > 2.8) {
                factors.positive.push(`🔴 LSR: ${lsrValue.toFixed(3)} (longs em vantagem)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue > 2.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)} (equilíbrio)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue > 1.5) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)} (shorts em vantagem)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔵 LSR: ${lsrValue.toFixed(3)} (shorts dominam)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ LSR: Indisponível`);
    }

    if (indicators.rsi) {
        const rsiValue = indicators.rsi;

        if (signalType === 'STOCHASTIC_COMPRA') {
            if (rsiValue < 25) {
                factors.positive.push(`🟢🟢 RSI: ${rsiValue.toFixed(1)} (sobrevendido forte)`);
                totalScore += weights.RSI;
            } else if (rsiValue < 30) {
                factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)} (sobrevendido)`);
                totalScore += weights.RSI * 0.9;
            } else if (rsiValue < 40) {
                factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)} (próx sobrevenda)`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue < 50) {
                factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)} (neutro)`);
                totalScore += weights.RSI * 0.5;
            } else {
                factors.negative.push(`🔴 RSI: ${rsiValue.toFixed(1)} (elevado)`);
            }
        } else {
            if (rsiValue > 75) {
                factors.positive.push(`🔴🔴 RSI: ${rsiValue.toFixed(1)} (sobrecomprado forte)`);
                totalScore += weights.RSI;
            } else if (rsiValue > 70) {
                factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)} (sobrecomprado)`);
                totalScore += weights.RSI * 0.9;
            } else if (rsiValue > 60) {
                factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)} (próx sobrecompra)`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue > 50) {
                factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)} (neutro)`);
                totalScore += weights.RSI * 0.5;
            } else {
                factors.negative.push(`🟢 RSI: ${rsiValue.toFixed(1)} (baixo)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ RSI: Indisponível`);
    }

    if (indicators.pivotData) {
        const pivot = indicators.pivotData;
        const currentPrice = indicators.currentPrice;

        if (signalType === 'STOCHASTIC_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                
                if (distToResistance > 8) {
                    factors.positive.push(`🟢🟢 DISTÂNCIA PIVÔ: Resistência distante ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE;
                } else if (distToResistance > 5) {
                    factors.positive.push(`🟢 DISTÂNCIA PIVÔ: Resistência ${distToResistance.toFixed(2)}% distante`);
                    totalScore += weights.PIVOT_DISTANCE * 0.8;
                } else if (distToResistance > 3) {
                    factors.positive.push(`🟡 DISTÂNCIA PIVÔ: Resistência próxima ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.5;
                } else {
                    factors.negative.push(`🔴 DISTÂNCIA PIVÔ: Resistência muito próxima ${distToResistance.toFixed(2)}%`);
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
                    factors.positive.push(`🔴🔴 DISTÂNCIA PIVÔ: Suporte distante ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE;
                } else if (distToSupport > 5) {
                    factors.positive.push(`🔴 DISTÂNCIA PIVÔ: Suporte ${distToSupport.toFixed(2)}% distante`);
                    totalScore += weights.PIVOT_DISTANCE * 0.8;
                } else if (distToSupport > 3) {
                    factors.positive.push(`🟡 DISTÂNCIA PIVÔ: Suporte próximo ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.PIVOT_DISTANCE * 0.5;
                } else {
                    factors.negative.push(`🔵 DISTÂNCIA PIVÔ: Suporte muito próximo ${distToSupport.toFixed(2)}%`);
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
        factors.positive.push(`📊 ${indicators.emaCheck.analysis}`);
        totalScore += 15;
    }

    factors.score = Math.min(100, Math.round((totalScore / factors.maxScore) * 100));

    const isBadTrade = factors.score < 50;
    const isNearResistance = indicators.pivotData?.nearestResistance?.distancePercent < 3.0;
    const isNearSupport = indicators.pivotData?.nearestSupport?.distancePercent < 3.0;
    const volumeData = indicators.volumeData;
    const buyerVolumeWeak = volumeData && volumeData.direction === 'Comprador' && volumeData.percentage < 50;
    const sellerVolumeWeak = volumeData && volumeData.direction === 'Vendedor' && volumeData.percentage > 50;

    let resumo = '';

    if (signalType === 'STOCHASTIC_COMPRA') {
        if (isBadTrade) {
            resumo = `⚠️ OPERAÇÃO DESFAVORÁVEL PARA COMPRA. `;
            if (isNearResistance && buyerVolumeWeak) {
                resumo += `Preço próximo da resistência (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%) e volume comprador fraco (${volumeData?.percentage}%). CUIDADO!`;
            } else if (isNearResistance) {
                resumo += `Preço próximo da resistência (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%). Pouco espaço para alta.`;
            } else if (buyerVolumeWeak) {
                resumo += `Volume comprador fraco (${volumeData?.percentage}%). Falta força.`;
            } else {
                resumo += `Múltiplos fatores negativos. Evitar entrada.`;
            }
        } else {
            resumo = `✅ OPERAÇÃO FAVORÁVEL PARA COMPRA. `;
            if (indicators.pivotData?.nearestResistance?.distancePercent > 5) {
                resumo += `Bom espaço até resistência (${indicators.pivotData?.nearestResistance?.distancePercent.toFixed(1)}%). `;
            }
            if (volumeData && volumeData.direction === 'Comprador' && volumeData.percentage > 55) {
                resumo += `Volume comprador forte (${volumeData.percentage}%). `;
            }
            resumo += `Fatores positivos: ${factors.positive.length}.`;
        }
    } else {
        if (isBadTrade) {
            resumo = `⚠️ OPERAÇÃO DESFAVORÁVEL PARA CORREÇÃO. `;
            if (isNearSupport && sellerVolumeWeak) {
                resumo += `Preço próximo do suporte (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%) e volume vendedor fraco (${100 - volumeData?.percentage}%). CUIDADO!`;
            } else if (isNearSupport) {
                resumo += `Preço próximo do suporte (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%). Pouco espaço para queda.`;
            } else if (sellerVolumeWeak) {
                resumo += `Volume vendedor fraco (${100 - volumeData?.percentage}%). Falta força.`;
            } else {
                resumo += `Múltiplos fatores negativos. Evitar entrada.`;
            }
        } else {
            resumo = `✅ OPERAÇÃO FAVORÁVEL PARA CORREÇÃO. `;
            if (indicators.pivotData?.nearestSupport?.distancePercent > 5) {
                resumo += `Bom espaço até suporte (${indicators.pivotData?.nearestSupport?.distancePercent.toFixed(1)}%). `;
            }
            if (volumeData && volumeData.direction === 'Vendedor' && volumeData.percentage < 45) {
                resumo += `Volume vendedor forte (${100 - volumeData.percentage}%). `;
            }
            resumo += `Fatores positivos: ${factors.positive.length}.`;
        }
    }

    factors.resumoInteligente = resumo;

    if (signalType === 'STOCHASTIC_COMPRA') {
        if (factors.score >= 80) {
            factors.summary = '🏆 Excelente PARA COMPRA';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Favorável PARA COMPRA';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Neutra PARA COMPRA';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ Desfavorável PARA COMPRA';
        } else {
            factors.summary = '🚫 Ruim PARA COMPRA';
        }
    } else {
        if (factors.score >= 80) {
            factors.summary = '🏆 Excelente PARA CORREÇÃO';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Favorável PARA CORREÇÃO';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Neutra PARA CORREÇÃO';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ Desfavorável PARA CORREÇÃO';
        } else {
            factors.summary = '🚫 Ruim PARA CORREÇÃO';
        }
    }

    return factors;
}

// =====================================================================
// === ALERTA PRINCIPAL ===
// =====================================================================
async function sendStochasticAlertEnhanced(signal) {
    const entryPrice = signal.entryPrice;
    const currentPrice = signal.currentPrice;
   
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    stochasticCooldown[signal.symbol] = Date.now();
   
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        funding: signal.funding,
        lsr: signal.lsr,
        rsi: signal.rsi,
        pivotData: signal.pivotData,
        currentPrice: currentPrice,
        emaCheck: signal.emaCheck,
        volumeData: signal.volumeData
    });
   
    let srInfo = null;
    try {
        srInfo = await calculateSupportResistance15m(signal.symbol, currentPrice);
    } catch (error) {
        ErrorHandler.handle(error, `GetSR-${signal.symbol}`);
    }
   
    let atrTargetsText = 'Alvos ATR: N/A';
    let atrValue = 0;
    if (signal.atrTargets) {
        const atr = signal.atrTargets.atr;
        atrValue = atr;
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
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
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
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
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
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
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
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
   
    let retestText = '';
    if (signal.retestData) {
        const rt = signal.retestData;
        
        retestText = `\n🤖#Titanium #IA 🔍Análise`;
        retestText += `\n📊 Nível de ${rt.type}: $${rt.level.toFixed(6)} (distância ${rt.distance.toFixed(2)}%)`;
        
        if (rt.totalTests > 0) {
            retestText += `\n📈 Histórico: ${rt.totalTests} testes, ${rt.successRate.toFixed(0)}% de aprovação`;
            if (rt.volumeRatio > CONFIG.RETEST.VOLUME_THRESHOLD) {
                retestText += `\n📊 Volume no teste: ${(rt.volumeRatio * 100).toFixed(0)}% acima da média ✅`;
            }
        }
        
        if (rt.falseBreakout) {
            retestText += `\n⚠️ FALSA RUPTURA detectada!`;
        }
        
        if (rt.isHistoric) {
            retestText += `\n🏆 Nível HISTÓRICO (${rt.totalTests} testes)`;
        }
    }
   
    let lsrText = 'N/A';
    let lsrEmoji = '';
    if (signal.lsr) {
        lsrText = signal.lsr.toFixed(2);
        if (signal.type === 'STOCHASTIC_COMPRA') {
            lsrEmoji = signal.lsr < 2.5 ? '✅' : '⚠️';
        } else {
            lsrEmoji = signal.lsr > 2.8 ? '✅' : '⚠️';
        }
    }
   
    let fundingText = '0.0000%';
    let fundingEmoji = '';
    if (signal.funding) {
        const fundingValue = parseFloat(signal.funding) / 100;
        fundingText = `${fundingValue > 0 ? '+' : ''}${(fundingValue * 100).toFixed(4)}%`;
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
            fundingEmoji = fundingValue < 0 ? '✅' : fundingValue > 0.0003 ? '❌' : '⚠️';
        } else {
            fundingEmoji = fundingValue > 0 ? '✅' : fundingValue < -0.0003 ? '❌' : '⚠️';
        }
    }
   
    const stochText = `K${signal.stochastic.k.toFixed(1)}/D${signal.stochastic.d.toFixed(1)}`;
   
    let rsiText = 'N/A';
    if (signal.rsi) {
        rsiText = signal.rsi.toFixed(0);
    }
   
    let volumeText = 'Volume 1h: Desconhecido';
    if (signal.volumeData) {
        const volData = signal.volumeData;
        volumeText = `Volume 1h: ${volData.percentage}% ${volData.direction}`;
        if (volData.emoji) {
            volumeText = `${volData.emoji} ${volumeText}`;
        }
    }
   
    let entryRetractionText = '';
    if (signal.entryRetraction && signal.entryRetraction.retractionRange) {
        const range = signal.entryRetraction.retractionRange;
        entryRetractionText = `Retração de Entrada: $${range.min.toFixed(6)} ... $${range.max.toFixed(6)} (${range.percent.toFixed(2)}%)`;
    }
   
    const alertCounterText = `Alerta ${alertCount.symbolDailyStochastic || 0}`;
   
    const actionEmoji = signal.type === 'STOCHASTIC_COMPRA' ? '🟢' : '🔴';
    const actionText = signal.type === 'STOCHASTIC_COMPRA' ? 'COMPRA' : 'CORREÇÃO';
   
    let message = `${actionEmoji} ${actionText} • ${signal.symbol}
Preço: $${currentPrice.toFixed(6)}
${volumeText}
${alertCounterText} - ${signal.time.full}hs
❅──────✧❅✨❅✧──────❅
🔘Stoch 12h ${stochText} | RSI 1H ${rsiText}
LSR ${lsrEmoji} ${lsrText} | Fund ${fundingEmoji} ${fundingText}
🔘${entryRetractionText}
${atrTargetsText}
🛑 ${stopCompact}
✨Níveis Importantes:
${srCompact}
${pivotDistanceText}
${retestText}
💡 ${factors.resumoInteligente}
✨ Titanium by @J4Rviz ✨`;
   
    message = message.replace(/\n\s*\n/g, '\n').trim();
   
    await sendTelegramAlert(message);
   
    console.log(`✅ Alerta enviado: ${signal.symbol} (${actionText})`);
    console.log(` 📊 Volume 1h: ${signal.volumeData?.percentage || 0}% ${signal.volumeData?.direction || 'Desconhecido'}`);
    console.log(` 📊 ATR 4h: $${atrValue.toFixed(6)}`);
    console.log(` 📊 Retração: ${signal.entryRetraction?.retractionRange?.percent.toFixed(2)}%`);
    console.log(` 💰 Preço Atual: $${currentPrice.toFixed(6)}`);
    console.log(` 💰 Entrada: $${entryPrice.toFixed(6)}`);
    console.log(` 📊 Score: ${factors.score}%`);
    console.log(` 💡 Resumo: ${factors.resumoInteligente}`);
    if (signal.retestData) {
        console.log(` 🔄 Reteste: ${signal.retestData.type} em $${signal.retestData.level.toFixed(6)} (${signal.retestData.totalTests} testes)`);
    }
}

// =====================================================================
// === MONITORAMENTO PRINCIPAL ===
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(
                'https://fapi.binance.com/fapi/v1/exchangeInfo',
                {},
                'exchangeInfo'
            ),
            'FetchAllSymbols',
            3,
            1000
        );
        
        // Valida a resposta da Binance
        const validatedData = ExchangeInfoSchema.parse(data);
        
        const symbols = validatedData.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
        console.log(`✅ ${symbols.length} pares USDT encontrados`);
        return symbols;
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em fetchAllFuturesSymbols:`, error.errors);
        }
        ErrorHandler.handle(error, 'FetchAllSymbols');
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function monitorSymbol(symbol) {
    try {
        console.log(`🔍 Analisando ${symbol}...`);
       
        if (CONFIG.STOCHASTIC.ENABLED) {
            const stochasticSignal = await checkStochasticSignal(symbol);
            if (stochasticSignal) {
                await sendStochasticAlertEnhanced(stochasticSignal);
                return true;
            }
        }
       
        return false;
    } catch (error) {
        ErrorHandler.handle(error, `MonitorSymbol-${symbol}`);
        return false;
    }
}

async function mainBotLoop() {
    try {
        const symbols = await fetchAllFuturesSymbols();
       
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - BOT DE TRADING');
        console.log('📊 Estratégia: Estocástico 12h 5.3.3 + ATR 4h + EMA 3m');
        console.log(`📈 Filtro RSI 1h: COMPRA < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} | VENDA > ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
        console.log(`📊 Estocástico: COMPRA < ${CONFIG.STOCHASTIC.OVERSOLD} | VENDA > ${CONFIG.STOCHASTIC.OVERBOUGHT}`);
        console.log(`📊 Volume 1h: Análise comprador/vendedor com EMA 9`);
        console.log(`📊 ATR 4h: Calculando 4 alvos (0.5x, 1.0x, 1.5x, 2.0x ATR)`);
        console.log(`📊 Retração de Entrada: ${EMA_CONFIG.ENTRY_RETRACTION_FACTOR * 100}% do ATR (máx ${EMA_CONFIG.MAX_RETRACTION_PERCENT}%)`);
        console.log(`📊 Stop curto baseado na estrutura 15m`);
        console.log(`🔄 Análise de Reteste: Ativada`);
        console.log(`🕘 Contador de alertas zera todo dia às 21h BR`);
        console.log('='.repeat(80) + '\n');
       
        const cleanupSystem = new AdvancedCleanupSystem();
       
        let cycle = 0;
        while (true) {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
           
            cleanupSystem.performFullCleanup();
           
            const currentHour = getBrazilianHour();
            if (currentHour >= 21 && lastResetDate !== getBrazilianDateString()) {
                resetDailyCounters();
            }
           
            let symbolsToMonitor = symbols;
           
            if (CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE > 0) {
                symbolsToMonitor = symbolsToMonitor.slice(0, CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE);
                console.log(`📊 Monitorando ${symbolsToMonitor.length}/${symbols.length} símbolos`);
            }
           
            let signalsFound = 0;
            let symbolsAnalyzed = 0;
           
            for (const symbol of symbolsToMonitor) {
                try {
                    const foundSignal = await monitorSymbol(symbol);
                    if (foundSignal) signalsFound++;
                   
                    symbolsAnalyzed++;
                   
                    await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SYMBOL_DELAY_MS));
                } catch (error) {
                    ErrorHandler.handle(error, `MainLoop-${symbol}`);
                    continue;
                }
            }
           
            console.log(`\n✅ Ciclo ${cycle} completo.`);
            console.log(`📊 Símbolos analisados: ${symbolsAnalyzed}`);
            console.log(`🎯 Cruzamentos detectados: ${signalsFound}`);
            console.log(`📈 Total global: ${globalAlerts} | Total diário: ${dailyAlerts}`);
           
            const now = Date.now();
            Object.keys(stochCrossState).forEach(symbol => {
                if (now - stochCrossState[symbol].lastCheck > 24 * 60 * 60 * 1000) {
                    delete stochCrossState[symbol];
                }
            });
           
            cleanupSystem.cleanupCaches();
           
            console.log(`\n⏳ Próximo ciclo em ${CONFIG.PERFORMANCE.CYCLE_DELAY_MS/1000}s...`);
            await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.CYCLE_DELAY_MS));
        }
    } catch (error) {
        ErrorHandler.handle(error, 'MainBotLoop');
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await mainBotLoop();
    }
}

// =====================================================================
// === RATE LIMITER SIMPLES ===
// =====================================================================
class SimpleRobustRateLimiter {
    constructor() {
        this.delayMs = 180;
        this.consecutiveErrors = 0;
        this.maxDelay = 1200;
    }

    async makeRequest(url, options = {}, type = 'klines') {
        while (true) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();

                this.consecutiveErrors = 0;
                this.delayMs = Math.max(80, this.delayMs * 0.92);

                await new Promise(r => setTimeout(r, this.delayMs));
                return data;
            } catch (err) {
                this.consecutiveErrors++;
                const backoff = Math.min(400 * Math.pow(1.6, this.consecutiveErrors), this.maxDelay);
                
                console.warn(`[RateLimiter] Erro (${type}): ${err.message} → backoff ${backoff}ms (${this.consecutiveErrors})`);
                
                if (this.consecutiveErrors >= 8) {
                    await sendTelegramAlert(
                        `⚠️ <b>Muitos erros consecutivos na API Binance</b>\n` +
                        `Endpoint: ${type}\n` +
                        `Último erro: ${err.message}\n` +
                        `Backoff atual: ${backoff}ms`
                    ).catch(() => {});
                }

                await new Promise(r => setTimeout(r, backoff));
            }
        }
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
let rateLimiter = new SimpleRobustRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - INICIANDO...');
        console.log(`📊 Filtro RSI 1h: COMPRA < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} | VENDA > ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
        console.log(`📊 Estocástico: COMPRA < ${CONFIG.STOCHASTIC.OVERSOLD} | VENDA > ${CONFIG.STOCHASTIC.OVERBOUGHT}`);
        console.log(`📊 EMA 3m: Ativado (13/34/55)`);
        console.log(`📊 Volume 1h: Análise comprador/vendedor com EMA 9`);
        console.log(`📊 ATR 4h: Calculando 4 alvos`);
        console.log(`📊 Retração de Entrada: ${EMA_CONFIG.ENTRY_RETRACTION_FACTOR * 100}% do ATR (máx ${EMA_CONFIG.MAX_RETRACTION_PERCENT}%)`);
        console.log(`🔄 Análise de Reteste: Ativada`);
        console.log(`🕘 Contador zera às 21h BR`);
        console.log('='.repeat(80) + '\n');

        lastResetDate = getBrazilianDateString();

        await sendInitializationMessage();

        console.log('✅ Bot inicializado!');
        console.log('⏳ Iniciando loop principal protegido...\n');

        while (true) {
            try {
                await mainBotLoop();
            } catch (fatalError) {
                console.error("┌────────────────────────────────────────────────────┐");
                console.error("│ ERRO FATAL NO LOOP PRINCIPAL                       │");
                console.error("│", fatalError.message || fatalError);
                console.error("└────────────────────────────────────────────────────┘");
                
                await sendTelegramAlert(
                    `⚠️ <b>Bot travou no loop principal</b>\n` +
                    `Erro: ${fatalError.message || 'Erro desconhecido'}\n` +
                    `Tentando reiniciar em 60 segundos...`
                ).catch(() => {});

                await new Promise(r => setTimeout(r, 60000));
            }
        }

    } catch (initError) {
        console.error('🚨 ERRO NA INICIALIZAÇÃO:', initError);
        await sendTelegramAlert(
            `💀 <b>Erro crítico na inicialização do bot</b>\n${initError.message}`
        ).catch(() => {});
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    console.error('!!! UNCAUGHT EXCEPTION !!!', err);
    sendTelegramAlert(
        `💀 <b>Exceção não capturada - bot morreu</b>\n${err.message || err}`
    ).catch(() => {});
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    sendTelegramAlert(
        `⚠️ <b>Promise rejeitada sem tratamento</b>\n${reason}`
    ).catch(() => {});
});

startBot();

if (global.gc) {
    console.log('🗑️ Coleta de lixo forçada disponível');
}
