const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const z = require('zod');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === SCHEMAS DE VALIDAÇÃO ZOD ===
// =====================================================================

// Schema para candles - AGORA ACEITA VOLUME 0
const CandleSchema = z.object({
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().min(0),
    time: z.number().int(),
    isClosed: z.boolean()
});

// Schema para resposta da API Spot
const KlineResponseSchema = z.array(
    z.array(z.union([z.number(), z.string()]))
);

const ExchangeInfoSchema = z.object({
    symbols: z.array(
        z.object({
            symbol: z.string(),
            status: z.string(),
            baseAsset: z.string(),
            quoteAsset: z.string()
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

// Schema para dados de força do par
const PairStrengthSchema = z.object({
    symbol: z.string(),
    priceBTC: z.number(),
    priceUSDT: z.number(),
    changePercent: z.number(),
    volume: z.number(),
    strength: z.number()
});

// Schema principal do sinal
const StochasticSignalSchema = z.object({
    symbol: z.string().regex(/^[A-Z0-9]+BTC$/),
    type: z.enum(['STOCHASTIC_COMPRA', 'STOCHASTIC_VENDA']),
    stochastic: StochasticSchema,
    rsi: z.number().min(0).max(100).optional().nullable(),
    pivotData: PivotPointSchema.nullable(),
    currentPrice: z.number().positive(),
    currentPriceUSDT: z.number().positive(),
    entryPrice: z.number().positive(),
    entryPriceUSDT: z.number().positive(),
    entryRetraction: z.object({
        entryPrice: z.number(),
        entryPriceUSDT: z.number(),
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
    atrTargetsUSDT: ATRTargetsSchema,
    srLevels: z.any().nullable(),
    srLevelsUSDT: z.any().nullable(),
    emaCheck: EMACheckSchema,
    volumeData: VolumeAnalysisSchema,
    retestData: RetestDataSchema,
    btcPrice: z.number().positive()
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
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    STOCHASTIC: {
        ENABLED: true,
        K_PERIOD: 14,
        D_PERIOD: 3,
        SLOWING: 3,
        TIMEFRAME: '4h',
        OVERBOUGHT: 77,
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
    },
    TOP_WEAK_ALERT: {
        ENABLED: true,
        INTERVAL_MINUTES: 60, // A cada 1 hora
        TOP_COUNT: 5 // Top 5 mais fortes e mais fracas
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

// Controle para alerta de top/weak
let lastTopWeakAlertTime = 0;

// Cache para preço do BTC
let btcPriceCache = {
    price: 0,
    timestamp: 0
};

// Cache para dados de força dos pares
let pairStrengthCache = {
    data: [],
    timestamp: 0
};

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
            return errorResponse;
        }

        if (error.name === 'AbortError' || error.code === 'TIMEOUT') {
            errorResponse.type = 'TIMEOUT_ERROR';
            errorResponse.retryable = true;
            errorResponse.message = 'Timeout da requisição';
            console.log(`⏰ Timeout [${context}]: ${error.message}`);
            return errorResponse;
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
            
            return errorResponse;
        }

        if (error instanceof SyntaxError && error.message.includes('JSON')) {
            errorResponse.type = 'PARSE_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = 'Erro ao processar resposta';
            console.log(`🔧 Erro de parsing [${context}]: ${error.message}`);
            return errorResponse;
        }

        if (error.message.includes('invalid') || error.message.includes('Invalid')) {
            errorResponse.type = 'VALIDATION_ERROR';
            errorResponse.retryable = false;
            console.log(`⚠️ Erro de validação [${context}]: ${error.message}`);
            return errorResponse;
        }

        if (error.message.includes('cache') || error.code === 'CACHE_ERROR') {
            errorResponse.type = 'CACHE_ERROR';
            errorResponse.retryable = true;
            console.log(`💾 Erro de cache [${context}]: ${error.message}`);
            return errorResponse;
        }

        if (error instanceof z.ZodError) {
            errorResponse.type = 'ZOD_VALIDATION_ERROR';
            errorResponse.retryable = false;
            errorResponse.message = `Erro de validação Zod: ${error.errors.map(e => e.message).join(', ')}`;
            console.log(`🔧 Erro Zod [${context}]:`, error.errors);
            return errorResponse;
        }

        console.log(`❌ Erro não classificado [${context}]: ${error.message}`);
        return errorResponse;
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

            if (btcPriceCache.timestamp && now - btcPriceCache.timestamp > 60000) {
                btcPriceCache = { price: 0, timestamp: 0 };
            }

            if (pairStrengthCache.timestamp && now - pairStrengthCache.timestamp > CONFIG.TOP_WEAK_ALERT.INTERVAL_MINUTES * 60 * 1000) {
                pairStrengthCache = { data: [], timestamp: 0 };
            }

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
        const btcPrice = await getBTCPrice();
        
        const message = `
<b>🚀 TITANIUM SPOT BTC INICIADO ✅</b>
📅 ${now.full}
<i>✅ ALERTAS ATIVOS - Pares /BTC</i>
<i>📊 Estocástico 4h 14.3.3</i>
<i>💵 Todos os valores em USDT</i>
<i>💰 BTC: $${btcPrice.toFixed(5)}</i>
<i>⏰ Alertas de Força/Fraqueza a cada hora</i>
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
        
        // Verificar cache
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }
        
        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h',
            '12h': '12h', '1d': '1d'
        };
        
        const interval = intervalMap[timeframe] || '4h';
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'klines'),
            `GetCandles-${symbol}-${timeframe}`,
            3,
            1000
        );
        
        // Validar se data é um array
        if (!data || !Array.isArray(data)) {
            console.log(`⚠️ Resposta inválida da API para ${symbol}: não é um array`);
            return [];
        }
        
        if (data.length === 0) {
            console.log(`⚠️ Sem dados para ${symbol} no timeframe ${timeframe}`);
            return [];
        }
        
        // Validar com Zod
        const validatedData = KlineResponseSchema.parse(data);
        
        // Converter para nosso formato
        const candles = validatedData.map(candle => {
            // Garantir que temos todos os elementos necessários
            if (candle.length < 6) {
                console.log(`⚠️ Candle com formato inválido para ${symbol}:`, candle);
                return null;
            }
            
            return {
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5]),
                time: parseInt(candle[0]),
                isClosed: true
            };
        }).filter(c => c !== null);
        
        if (candles.length === 0) {
            console.log(`⚠️ Nenhum candle válido para ${symbol}`);
            return [];
        }
        
        // Validar cada candle
        const validatedCandles = [];
        for (const candle of candles) {
            try {
                validatedCandles.push(CandleSchema.parse(candle));
            } catch (e) {
                // Só logar erros que não sejam de volume
                if (!e.message.includes('volume')) {
                    console.log(`⚠️ Candle inválido ignorado para ${symbol}:`, e.message);
                }
            }
        }
        
        if (validatedCandles.length === 0) {
            console.log(`⚠️ Nenhum candle válido após validação para ${symbol}`);
            return [];
        }
        
        // Armazenar em cache
        candleCache[cacheKey] = { data: validatedCandles, timestamp: now };
        return validatedCandles;
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getCandles [${symbol}]:`, error.errors);
            return [];
        }
        console.log(`❌ Erro em getCandles [${symbol}]:`, error.message);
        return [];
    }
}

function calculateEMA(values, period) {
    try {
        if (!values || !Array.isArray(values) || values.length === 0) return 0;
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
        console.log(`🔧 Erro em calculateEMA:`, error.message);
        return 0;
    }
}

async function getStochastic(symbol, timeframe = CONFIG.STOCHASTIC.TIMEFRAME) {
    try {
        const candles = await getCandles(symbol, timeframe, 150);
        if (!candles || candles.length < CONFIG.STOCHASTIC.K_PERIOD + 20) {
            return null;
        }
        
        const kPeriod = CONFIG.STOCHASTIC.K_PERIOD;
        const dPeriod = CONFIG.STOCHASTIC.D_PERIOD;
        const slowing = CONFIG.STOCHASTIC.SLOWING;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const rawK = [];
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const periodHighs = highs.slice(i - kPeriod + 1, i + 1);
            const periodLows = lows.slice(i - kPeriod + 1, i + 1);
            
            const highestHigh = Math.max(...periodHighs);
            const lowestLow = Math.min(...periodLows);
            
            if (highestHigh === lowestLow) {
                rawK.push(50);
            } else {
                const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
                rawK.push(Math.min(100, Math.max(0, k)));
            }
        }
        
        const smoothedK = [];
        for (let i = slowing - 1; i < rawK.length; i++) {
            const kSlice = rawK.slice(i - slowing + 1, i + 1);
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
        
        return StochasticSchema.parse(stochasticResult);
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getStochastic [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em getStochastic [${symbol}]:`, error.message);
        return null;
    }
}

// Função para obter preço do BTC em USDT
async function getBTCPrice() {
    try {
        if (btcPriceCache.timestamp && Date.now() - btcPriceCache.timestamp < 60000) {
            return btcPriceCache.price;
        }
        
        const candles = await getCandles('BTCUSDT', '1m', 1);
        if (!candles || candles.length === 0) {
            return btcPriceCache.price || 0;
        }
        
        const price = candles[candles.length - 1].close;
        
        btcPriceCache = {
            price,
            timestamp: Date.now()
        };
        
        return price;
    } catch (error) {
        console.log(`❌ Erro em getBTCPrice:`, error.message);
        return btcPriceCache.price || 0;
    }
}

// Função para calcular força dos pares
async function calculatePairStrengths(symbols) {
    try {
        const now = Date.now();
        
        // Usar cache se disponível (máx 5 minutos)
        if (pairStrengthCache.timestamp && now - pairStrengthCache.timestamp < 5 * 60 * 1000) {
            return pairStrengthCache.data;
        }
        
        const btcPrice = await getBTCPrice();
        const strengths = [];
        
        for (const symbol of symbols) {
            try {
                // Buscar candles de 1h para calcular variação
                const candles = await getCandles(symbol, '1h', 2);
                if (!candles || candles.length < 2) continue;
                
                const currentCandle = candles[candles.length - 1];
                const previousCandle = candles[candles.length - 2];
                
                const currentPriceBTC = currentCandle.close;
                const previousPriceBTC = previousCandle.close;
                
                // Calcular variação percentual
                const changePercent = ((currentPriceBTC - previousPriceBTC) / previousPriceBTC) * 100;
                
                // Calcular força (variação + volume ponderado)
                const volume = currentCandle.volume;
                const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
                const volumeFactor = volume / (avgVolume || 1);
                
                // Fórmula de força: variação + bônus de volume
                const strength = changePercent + (volumeFactor > 1.5 ? 0.5 : 0);
                
                const pairStrength = {
                    symbol,
                    priceBTC: currentPriceBTC,
                    priceUSDT: currentPriceBTC * btcPrice,
                    changePercent,
                    volume,
                    strength
                };
                
                strengths.push(PairStrengthSchema.parse(pairStrength));
                
            } catch (error) {
                console.log(`⚠️ Erro ao calcular força para ${symbol}:`, error.message);
                continue;
            }
        }
        
        // Ordenar por força
        strengths.sort((a, b) => b.strength - a.strength);
        
        // Atualizar cache
        pairStrengthCache = {
            data: strengths,
            timestamp: now
        };
        
        return strengths;
        
    } catch (error) {
        console.log(`❌ Erro em calculatePairStrengths:`, error.message);
        return [];
    }
}

// Função para enviar alerta de Top 5 Mais Fortes e Mais Fracas
async function sendTopWeakAlert() {
    if (!CONFIG.TOP_WEAK_ALERT.ENABLED) return;
    
    try {
        const now = Date.now();
        
        // Verificar se já passou 1 hora desde o último alerta
        if (now - lastTopWeakAlertTime < CONFIG.TOP_WEAK_ALERT.INTERVAL_MINUTES * 60 * 1000) {
            return;
        }
        
        console.log('\n📊 Gerando alerta de Top 5 Mais Fortes e Mais Fracas...');
        
        const symbols = await fetchAllSpotBTCSymbols();
        const strengths = await calculatePairStrengths(symbols);
        
        if (strengths.length === 0) {
            console.log('⚠️ Sem dados de força disponíveis');
            return;
        }
        
        const top5Strong = strengths.slice(0, CONFIG.TOP_WEAK_ALERT.TOP_COUNT);
        const top5Weak = strengths.slice(-CONFIG.TOP_WEAK_ALERT.TOP_COUNT).reverse();
        
        const btcPrice = await getBTCPrice();
        const now_time = getBrazilianDateTime();
        
        let message = ` <i>TOP ${CONFIG.TOP_WEAK_ALERT.TOP_COUNT} MAIS FORTES VS BTC</i> \n`;
        message += `🕐 ${now_time.full}hs\n`;
        message += ` BTC atual: $${btcPrice.toFixed(5)} USDT\n`;
        message += `❅──────✧❅✨❅✧──────❅\n\n`;
        
        message += `<i>🟢 MAIS FORTES (Compradores)</i>\n`;
        top5Strong.forEach((item, index) => {
            const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📈';
            message += `${emoji} ${item.symbol}\n`;
            message += `   <i>Preço: $${item.priceUSDT.toFixed(5)} USDT</i>\n`;
            message += `   <i>Variação 1h: ${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%</i>\n`;
            message += `   <i>Força: ${item.strength.toFixed(2)}</i>\n\n`;
        });
        
        message += `<i>🔴 MAIS FRACAS (Vendedores)</i>\n`;
        top5Weak.forEach((item, index) => {
            const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📉';
            message += `${emoji} ${item.symbol}\n`;
            message += `   <i>Preço: $${item.priceUSDT.toFixed(5)} USDT</i>\n`;
            message += `   <i>Variação 1h: ${item.changePercent > 0 ? '+' : ''}${item.changePercent.toFixed(2)}%</i>\n`;
            message += `   <i>Força: ${item.strength.toFixed(2)}</i>\n\n`;
        });
        
        message += `❅──────✧❅✨❅✧──────❅\n`;
        message += `<i>💡 Dica:</i>\n`;
        message += `<i>🟢 Fortes: Possível Compra</i>\n`;
        message += `<i>🔴 Fracas: Ainda em Correção</i>\n`;
        message += `<i>✨ Titanium Spot BTC by @J4Rviz ✨</i>`;
        
        await sendTelegramAlert(message);
        
        lastTopWeakAlertTime = now;
        console.log('✅ Alerta de Top 5 enviado com sucesso!');
        
    } catch (error) {
        ErrorHandler.handle(error, 'SendTopWeakAlert');
    }
}

// Função para converter valor em BTC para USDT
async function convertToUSDT(btcValue) {
    const btcPrice = await getBTCPrice();
    return btcValue * btcPrice;
}

// =====================================================================
// === FUNÇÃO: VERIFICAÇÃO EMA 3 MINUTOS COM ZOD ===
// =====================================================================
async function checkEMA3m(symbol, signalType) {
    try {
        const candles = await getCandles(symbol, EMA_CONFIG.TIMEFRAME, 100);
        if (!candles || candles.length < Math.max(EMA_CONFIG.EMA55, EMA_CONFIG.EMA34)) {
            return { isValid: false, error: 'Candles insuficientes', ema13: 0, ema34: 0, ema55: 0, lastPrice: 0 };
        }
        
        const closes = candles.map(c => c.close);
        const lastCandle = candles[candles.length - 1];
        
        if (!lastCandle) {
            return { isValid: false, error: 'Último candle não disponível', ema13: 0, ema34: 0, ema55: 0, lastPrice: 0 };
        }
        
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
            
        } else {
            const emaCrossDown = prevEma13 >= prevEma34 && ema13 < ema34;
            const priceBelowEma55 = lastCandle.close < ema55;
            
            isValid = emaCrossDown && priceBelowEma55;
            
            analysis = `📊 EMA 3m: ${emaCrossDown ? '✅' : '❌'} Cruzamento 13/34 | ${priceBelowEma55 ? '✅' : '❌'} Preço < EMA55`;
        }
        
        const emaResult = {
            isValid,
            analysis,
            ema13,
            ema34,
            ema55,
            lastPrice: lastCandle.close
        };
        
        return EMACheckSchema.parse(emaResult);
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em checkEMA3m [${symbol}]:`, error.errors);
            return { isValid: false, error: 'Erro de validação', ema13: 0, ema34: 0, ema55: 0, lastPrice: 0 };
        }
        console.log(`❌ Erro em checkEMA3m [${symbol}]:`, error.message);
        return { isValid: false, error: error.message, ema13: 0, ema34: 0, ema55: 0, lastPrice: 0 };
    }
}

async function getCurrentPrice(symbol) {
    try {
        const candles = await getCandles(symbol, '1m', 1);
        if (!candles || candles.length === 0) return 0;
        return candles[candles.length - 1].close;
    } catch (error) {
        console.log(`❌ Erro em getCurrentPrice [${symbol}]:`, error.message);
        return 0;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 80);
        if (!candles || candles.length < 14) {
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
        
        return RSISchema.parse(rsiResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em getRSI1h [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em getRSI1h [${symbol}]:`, error.message);
        return null;
    }
}

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandles(symbol, '15m', 50);
        if (!candles || candles.length < 20) {
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
        
        return PivotPointSchema.parse(pivotResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzePivotPoints [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em analyzePivotPoints [${symbol}]:`, error.message);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: CALCULAR ATR 4H ===
// =====================================================================
async function calculateATR4h(symbol, period = 14) {
    try {
        const candles = await getCandles(symbol, '4h', period + 1);
        if (!candles || candles.length < period + 1) {
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
        console.log(`❌ Erro em calculateATR4h [${symbol}]:`, error.message);
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
            return { entryPrice: currentPrice, entryPriceUSDT: 0, retractionRange: null };
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
        
        const btcPrice = await getBTCPrice();
        const entryPriceUSDT = entryPrice * btcPrice;
        
        return {
            entryPrice,
            entryPriceUSDT,
            retractionRange: {
                min: isBullish ? entryPrice : currentPrice,
                max: isBullish ? currentPrice : entryPrice,
                amount: adjustedRetractionAmount,
                percent: (adjustedRetractionAmount / currentPrice) * 100
            }
        };
    } catch (error) {
        console.log(`❌ Erro em calculateEntryRetraction [${symbol}]:`, error.message);
        return { entryPrice: currentPrice, entryPriceUSDT: 0, retractionRange: null };
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
        
        return ATRTargetsSchema.parse(atrResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em calculateATRTargets [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em calculateATRTargets [${symbol}]:`, error.message);
        return null;
    }
}

// Função para converter alvos ATR para USDT
async function convertATRTargetsToUSDT(atrTargets, isBullish) {
    if (!atrTargets) return null;
    
    const btcPrice = await getBTCPrice();
    const targetsUSDT = {};
    
    Object.keys(atrTargets.targets).forEach(key => {
        targetsUSDT[key] = atrTargets.targets[key] * btcPrice;
    });
    
    return {
        atr: atrTargets.atr * btcPrice,
        targets: targetsUSDT,
        multipliers: atrTargets.multipliers
    };
}

async function calculateSupportResistance15m(symbol, currentPrice) {
    try {
        const candles = await getCandles(symbol, '15m', 100);
        if (!candles || candles.length < 50) {
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
        console.log(`❌ Erro em calculateSupportResistance15m [${symbol}]:`, error.message);
        return null;
    }
}

// Função para converter SR para USDT
async function convertSRToUSDT(srLevels) {
    if (!srLevels) return null;
    
    const btcPrice = await getBTCPrice();
    
    return {
        resistances: {
            r1: { 
                price: srLevels.resistances.r1.price * btcPrice,
                distance: srLevels.resistances.r1.distance
            },
            r2: {
                price: srLevels.resistances.r2.price * btcPrice,
                distance: srLevels.resistances.r2.distance
            }
        },
        supports: {
            s1: {
                price: srLevels.supports.s1.price * btcPrice,
                distance: srLevels.supports.s1.distance
            },
            s2: {
                price: srLevels.supports.s2.price * btcPrice,
                distance: srLevels.supports.s2.distance
            }
        },
        nearestResistance: srLevels.nearestResistance * btcPrice,
        nearestSupport: srLevels.nearestSupport * btcPrice
    };
}

// =====================================================================
// === FUNÇÃO: ANALISAR VOLUME 1H COM EMA 9 COM ZOD ===
// =====================================================================
async function analyzeVolume1hWithEMA9(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 10) {
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
        
        if (totalVolume === 0) {
            return { direction: 'Neutro', percentage: 50, emoji: '⚪' };
        }
        
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
        
        return VolumeAnalysisSchema.parse(volumeResult);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzeVolume1hWithEMA9 [${symbol}]:`, error.errors);
            return { direction: 'Erro', percentage: 0, emoji: '❌' };
        }
        console.log(`❌ Erro em analyzeVolume1hWithEMA9 [${symbol}]:`, error.message);
        return { direction: 'Erro', percentage: 0, emoji: '❌' };
    }
}

// =====================================================================
// === FUNÇÃO: ENCONTRAR NÍVEIS SIGNIFICATIVOS ===
// =====================================================================
function findSignificantLevels(values, tolerancePercent) {
    if (!values || !Array.isArray(values) || values.length === 0) return [];
    
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
        
        if (!candles15m || candles15m.length < 100 || !candles5m || candles5m.length < 50) {
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
        
        return RetestDataSchema.parse(retestResult);
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em analyzeSupportResistanceRetest [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em analyzeSupportResistanceRetest [${symbol}]:`, error.message);
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
        
        const [rsiData, pivotData, currentPrice, volumeData, retestData] = await Promise.all([
            getRSI1h(symbol),
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
        const entryPriceUSDT = entryRetraction.entryPriceUSDT;
        
        const atrTargets = await calculateATRTargets(symbol, entryPrice, signalType === 'STOCHASTIC_COMPRA');
        const atrTargetsUSDT = await convertATRTargetsToUSDT(atrTargets, signalType === 'STOCHASTIC_COMPRA');
        
        const srLevels = await calculateSupportResistance15m(symbol, currentPrice);
        const srLevelsUSDT = await convertSRToUSDT(srLevels);
        
        const btcPrice = await getBTCPrice();
        const currentPriceUSDT = currentPrice * btcPrice;
        
        const signal = {
            symbol: symbol,
            type: signalType,
            stochastic: stochastic,
            rsi: rsiData?.value,
            pivotData: pivotData,
            currentPrice: currentPrice,
            currentPriceUSDT: currentPriceUSDT,
            entryPrice: entryPrice,
            entryPriceUSDT: entryPriceUSDT,
            entryRetraction: entryRetraction,
            time: getBrazilianDateTime(),
            isFreshCross: isFreshCross,
            atrTargets: atrTargets,
            atrTargetsUSDT: atrTargetsUSDT,
            srLevels: srLevels,
            srLevelsUSDT: srLevelsUSDT,
            emaCheck: emaCheck,
            volumeData: volumeData,
            retestData: retestData,
            btcPrice: btcPrice
        };
        
        try {
            const validatedSignal = StochasticSignalSchema.parse(signal);
            return validatedSignal;
        } catch (validationError) {
            if (validationError instanceof z.ZodError) {
                console.log(`🔧 ERRO CRÍTICO: Sinal inválido para ${symbol}:`, validationError.errors);
            }
            return null;
        }
        
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em checkStochasticSignal [${symbol}]:`, error.errors);
            return null;
        }
        console.log(`❌ Erro em checkStochasticSignal [${symbol}]:`, error.message);
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
        RSI: 20,
        STRUCTURE: 25,
        PIVOT_DISTANCE: 25
    };

    factors.maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let totalScore = 0;

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
    const entryPriceUSDT = signal.entryPriceUSDT;
    const currentPrice = signal.currentPrice;
    const currentPriceUSDT = signal.currentPriceUSDT;
    const btcPrice = signal.btcPrice;
   
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    stochasticCooldown[signal.symbol] = Date.now();
   
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        rsi: signal.rsi,
        pivotData: signal.pivotData,
        currentPrice: currentPrice,
        emaCheck: signal.emaCheck,
        volumeData: signal.volumeData
    });
   
    let srInfo = signal.srLevels;
    let srInfoUSDT = signal.srLevelsUSDT;
   
    let atrTargetsText = 'Alvos ATR: N/A';
    let atrValueUSDT = 0;
    
    if (signal.atrTargetsUSDT) {
        const targets = signal.atrTargetsUSDT.targets;
        atrValueUSDT = signal.atrTargetsUSDT.atr;
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
            atrTargetsText = `<i>Alvos: T1: $${targets.t1.toFixed(5)} | T2: $${targets.t2.toFixed(5)} | T3: $${targets.t3.toFixed(5)} | T4: $${targets.t4.toFixed(5)}</i>`;
        } else {
            atrTargetsText = `<i>Alvos: T1: $${targets.t1.toFixed(5)} | T2: $${targets.t2.toFixed(5)} | T3: $${targets.t3.toFixed(5)} | T4: $${targets.t4.toFixed(5)}</i>`;
        }
    }
   
    let stopCompact = '<i>Stop: N/A</i>';
    let stopPriceUSDT = 0;
    let stopPercent = 0;
   
    if (srInfoUSDT) {
        const price = entryPriceUSDT;
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
            stopPriceUSDT = srInfoUSDT.nearestSupport * 0.995;
           
            if (signal.atrTargetsUSDT) {
                const atrStop = price - (signal.atrTargetsUSDT.atr * 0.5);
                stopPriceUSDT = Math.min(stopPriceUSDT, atrStop);
            }
           
            stopPercent = ((price - stopPriceUSDT) / price * 100);
            stopCompact = `<i>Stop: $${stopPriceUSDT.toFixed(5)} (${stopPercent.toFixed(2)}%)</i>`;
           
        } else {
            stopPriceUSDT = srInfoUSDT.nearestResistance * 1.005;
           
            if (signal.atrTargetsUSDT) {
                const atrStop = price + (signal.atrTargetsUSDT.atr * 0.5);
                stopPriceUSDT = Math.max(stopPriceUSDT, atrStop);
            }
           
            stopPercent = ((stopPriceUSDT - price) / price * 100);
            stopCompact = `<i>Stop: $${stopPriceUSDT.toFixed(5)} (${stopPercent.toFixed(2)}%)</i>`;
        }
    } else if (signal.atrTargetsUSDT) {
        const atr = signal.atrTargetsUSDT.atr;
       
        if (signal.type === 'STOCHASTIC_COMPRA') {
            stopPriceUSDT = entryPriceUSDT - (atr * 0.4);
            stopPercent = ((entryPriceUSDT - stopPriceUSDT) / entryPriceUSDT * 100);
        } else {
            stopPriceUSDT = entryPriceUSDT + (atr * 0.4);
            stopPercent = ((stopPriceUSDT - entryPriceUSDT) / entryPriceUSDT * 100);
        }
        stopCompact = `<i>Stop: $${stopPriceUSDT.toFixed(5)} (${stopPercent.toFixed(2)}%)</i>`;
    }
   
    let srCompact = '';
    if (srInfoUSDT) {
        const resistance = srInfoUSDT.nearestResistance;
        const support = srInfoUSDT.nearestSupport;
        const distR = resistance ? ((resistance - currentPriceUSDT) / currentPriceUSDT * 100).toFixed(1) : 'N/A';
        const distS = support ? ((currentPriceUSDT - support) / currentPriceUSDT * 100).toFixed(1) : 'N/A';
       
        srCompact = `<i>Resist: $${resistance?.toFixed(5) || 'N/A'} (${distR}%) | Supt: $${support?.toFixed(5) || 'N/A'} (${distS}%)</i>`;
    }
   
    let pivotDistanceText = '';
    if (signal.pivotData) {
        const pivot = signal.pivotData;
        const btcPrice = signal.btcPrice;
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                const resistanceUSDT = pivot.nearestResistance.price * btcPrice;
                const emoji = distToResistance > 5 ? '🟢' : distToResistance > 3 ? '🟡' : '🔴';
                pivotDistanceText = `<i> Pivô: Resistência em $${resistanceUSDT.toFixed(5)} (${distToResistance.toFixed(2)}% ${emoji})</i>`;
            } else {
                pivotDistanceText = `<i> Pivô: N/A</i>`;
            }
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                const supportUSDT = pivot.nearestSupport.price * btcPrice;
                const emoji = distToSupport > 5 ? '🔴' : distToSupport > 3 ? '🟡' : '🔵';
                pivotDistanceText = `<i> Pivô: Suporte em $${supportUSDT.toFixed(5)} (${distToSupport.toFixed(2)}% ${emoji})</i>`;
            } else {
                pivotDistanceText = `<i> Pivô: N/A</i>`;
            }
        }
    } else {
        pivotDistanceText = `<i> Pivô: Indisponível</i>`;
    }
   
    let retestText = '';
    if (signal.retestData) {
        const rt = signal.retestData;
        const levelUSDT = rt.level * signal.btcPrice;
        
        retestText = `\n🤖<i>#Titanium #IA 🔍Análise</i>`;
        retestText += `\n<i> Nível de ${rt.type}: $${levelUSDT.toFixed(5)} (distância ${rt.distance.toFixed(2)}%)</i>`;
        
        if (rt.totalTests > 0) {
            retestText += `\n<i> Histórico: ${rt.totalTests} testes, ${rt.successRate.toFixed(0)}% de aprovação</i>`;
            if (rt.volumeRatio > CONFIG.RETEST.VOLUME_THRESHOLD) {
                retestText += `\n<i> Volume no teste: ${(rt.volumeRatio * 100).toFixed(0)}% acima da média ✅</i>`;
            }
        }
        
        if (rt.falseBreakout) {
            retestText += `\n<i>⚠️ FALSA RUPTURA detectada!</i>`;
        }
        
        if (rt.isHistoric) {
            retestText += `\n<i>🏆 Nível HISTÓRICO (${rt.totalTests} testes)</i>`;
        }
    }
   
    const stochText = `<i>K${signal.stochastic.k.toFixed(1)}/D${signal.stochastic.d.toFixed(1)}</i>`;
   
    let rsiText = '<i>N/A</i>';
    if (signal.rsi) {
        rsiText = `<i>${signal.rsi.toFixed(0)}</i>`;
    }
   
    let volumeText = '<i>Volume 1h: Desconhecido</i>';
    if (signal.volumeData) {
        const volData = signal.volumeData;
        volumeText = `<i>Volume 1h: ${volData.percentage}% ${volData.direction}</i>`;
        if (volData.emoji) {
            volumeText = `${volData.emoji} ${volumeText}`;
        }
    }
   
    let entryRetractionText = '';
    if (signal.entryRetraction && signal.entryRetraction.retractionRange) {
        const range = signal.entryRetraction.retractionRange;
        const minUSDT = range.min * signal.btcPrice;
        const maxUSDT = range.max * signal.btcPrice;
        entryRetractionText = `<i>Retração de Entrada: $${minUSDT.toFixed(5)} ... $${maxUSDT.toFixed(5)} (${range.percent.toFixed(2)}%)</i>`;
    }
   
    const alertCounterText = `<i>Alerta ${alertCount.symbolDailyStochastic || 0}</i>`;
   
    const actionEmoji = signal.type === 'STOCHASTIC_COMPRA' ? '🟢' : '🔴';
    const actionText = signal.type === 'STOCHASTIC_COMPRA' ? 'COMPRA' : 'CORREÇÃO';
   
    let message = `${actionEmoji} ${actionText} • ${signal.symbol}
<i>Preço: $${currentPriceUSDT.toFixed(5)} USDT</i>
<i>BTC: $${btcPrice.toFixed(5)} USDT</i>
${volumeText}
${alertCounterText} - ${signal.time.full}hs
❅──────✧❅✨❅✧──────❅
<i>🔘Stoch 4h ${stochText} | RSI 1H ${rsiText}</i>
<i>🔘${entryRetractionText}</i>
${atrTargetsText}
🛑 ${stopCompact}
<i>✨Níveis Importantes (USDT):</i>
${srCompact}
${pivotDistanceText}
${retestText}
<i>💡 ${factors.resumoInteligente}</i>
<i>✨ Titanium Spot BTC by @J4Rviz ✨</i>`;
   
    message = message.replace(/\n\s*\n/g, '\n').trim();
   
    await sendTelegramAlert(message);
   
    console.log(`✅ Alerta enviado: ${signal.symbol} (${actionText})`);
    console.log(` 📊 Volume 1h: ${signal.volumeData?.percentage || 0}% ${signal.volumeData?.direction || 'Desconhecido'}`);
    console.log(` 📊 ATR 4h: $${atrValueUSDT.toFixed(5)} USDT`);
    console.log(` 📊 Retração: ${signal.entryRetraction?.retractionRange?.percent.toFixed(2)}%`);
    console.log(` 💰 Preço Atual: $${currentPriceUSDT.toFixed(5)} USDT (${currentPrice.toFixed(8)} BTC)`);
    console.log(` 💰 Entrada: $${entryPriceUSDT.toFixed(5)} USDT (${entryPrice.toFixed(8)} BTC)`);
    console.log(` 📊 Score: ${factors.score}%`);
    console.log(` 💡 Resumo: ${factors.resumoInteligente}`);
    if (signal.retestData) {
        const levelUSDT = signal.retestData.level * signal.btcPrice;
        console.log(` 🔄 Reteste: ${signal.retestData.type} em $${levelUSDT.toFixed(5)} (${signal.retestData.totalTests} testes)`);
    }
}

// =====================================================================
// === MONITORAMENTO PRINCIPAL ===
// =====================================================================
async function fetchAllSpotBTCSymbols() {
    try {
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(
                'https://api.binance.com/api/v3/exchangeInfo',
                {},
                'exchangeInfo'
            ),
            'FetchAllSymbols',
            3,
            1000
        );
        
        if (!data || !data.symbols || !Array.isArray(data.symbols)) {
            throw new Error('Resposta da API inválida');
        }
        
        const validatedData = ExchangeInfoSchema.parse(data);
        
        const symbols = validatedData.symbols
            .filter(s => s.symbol.endsWith('BTC') && s.status === 'TRADING' && s.quoteAsset === 'BTC')
            .map(s => s.symbol);
            
        console.log(`✅ ${symbols.length} pares BTC encontrados no spot`);
        return symbols;
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log(`🔧 Erro de validação Zod em fetchAllSpotBTCSymbols:`, error.errors);
        }
        ErrorHandler.handle(error, 'FetchAllSymbols');
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['ETHBTC', 'BNBBTC', 'SOLBTC', 'XRPBTC', 'ADABTC'];
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
        const symbols = await fetchAllSpotBTCSymbols();
        
        const btcPrice = await getBTCPrice();
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM SPOT BTC - BOT DE TRADING');
        console.log('📊 Estratégia: Estocástico 4h 14.3.3 + ATR 4h + EMA 3m');
        console.log(`📈 Filtro RSI 1h: COMPRA < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} | VENDA > ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
        console.log(`📊 Estocástico: COMPRA < ${CONFIG.STOCHASTIC.OVERSOLD} | VENDA > ${CONFIG.STOCHASTIC.OVERBOUGHT}`);
        console.log(`📊 Volume 1h: Análise comprador/vendedor com EMA 9`);
        console.log(`📊 ATR 4h: Calculando 4 alvos - VALORES EM USDT`);
        console.log(`📊 Retração de Entrada: ${EMA_CONFIG.ENTRY_RETRACTION_FACTOR * 100}% do ATR (máx ${EMA_CONFIG.MAX_RETRACTION_PERCENT}%)`);
        console.log(`🔄 Análise de Reteste: Ativada`);
        console.log(`📊 TOP 5 Fortes/Fracas: A cada 1 hora`);
        console.log(`🕘 Contador de alertas zera todo dia às 21h BR`);
        console.log(`💰 BTC/USDT: $${btcPrice.toFixed(5)}`);
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
            
            // Enviar alerta de Top 5 a cada hora
            await sendTopWeakAlert();
           
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
                        `<i>Endpoint: ${type}</i>\n` +
                        `<i>Último erro: ${err.message}</i>\n` +
                        `<i>Backoff atual: ${backoff}ms</i>`
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
        console.log('🚀 TITANIUM SPOT BTC - INICIANDO...');
        console.log(`📊 Filtro RSI 1h: COMPRA < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} | VENDA > ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
        console.log(`📊 Estocástico 4h 14.3.3: COMPRA < ${CONFIG.STOCHASTIC.OVERSOLD} | VENDA > ${CONFIG.STOCHASTIC.OVERBOUGHT}`);
        console.log(`📊 EMA 3m: Ativado (13/34/55)`);
        console.log(`📊 Volume 1h: Análise comprador/vendedor com EMA 9`);
        console.log(`📊 ATR 4h: Calculando 4 alvos - VALORES EM USDT`);
        console.log(`📊 Retração de Entrada: ${EMA_CONFIG.ENTRY_RETRACTION_FACTOR * 100}% do ATR (máx ${EMA_CONFIG.MAX_RETRACTION_PERCENT}%)`);
        console.log(`🔄 Análise de Reteste: Ativada`);
        console.log(`📊 TOP 5 Fortes/Fracas: A cada 1 hora`);
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
                    `<i>Erro: ${fatalError.message || 'Erro desconhecido'}</i>\n` +
                    `<i>Tentando reiniciar em 60 segundos...</i>`
                ).catch(() => {});

                await new Promise(r => setTimeout(r, 60000));
            }
        }

    } catch (initError) {
        console.error('🚨 ERRO NA INICIALIZAÇÃO:', initError);
        await sendTelegramAlert(
            `💀 <b>Erro crítico na inicialização do bot</b>\n<i>${initError.message}</i>`
        ).catch(() => {});
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    console.error('!!! UNCAUGHT EXCEPTION !!!', err);
    sendTelegramAlert(
        `💀 <b>Exceção não capturada - bot morreu</b>\n<i>${err.message || err}</i>`
    ).catch(() => {});
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    sendTelegramAlert(
        `⚠️ <b>Promise rejeitada sem tratamento</b>\n<i>${reason}</i>`
    ).catch(() => {});
});

startBot();

if (global.gc) {
    console.log('🗑️ Coleta de lixo forçada disponível');
}
