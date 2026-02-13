const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES DE RSI 1H PARA ALERTAS - FÁCIL AJUSTE ===
// =====================================================================
const RSI_1H_CONFIG = {
    COMPRA: {
        MAX_RSI: 62,
        ENABLED: true
    },
    VENDA: {
        MIN_RSI: 45,
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
        OVERBOUGHT: 74,
        OVERSOLD: 67
    },
    PRIORITY: {
        ENABLED: true,
        VOLUME_1H: {
            VOLUME_WEIGHT: 50,
            EMA_PERIOD: 9,
            MIN_VOLUME_RATIO: 1.0,
            VOLUME_DIRECTION_STRICT: true,
            VOLUME_DIRECTION_BONUS: 30,
            SENSITIVITY_MULTIPLIER: 1.1
        },
        LIQUIDITY: {
            MIN_LIQUIDITY_USDT: 100000,
            MAX_LIQUID_SYMBOLS: 500,
            LIQUIDITY_WEIGHT: 25
        },
        LSR: {
            ENABLED: true,
            IDEAL_BUY_LSR: 2.5,
            IDEAL_SELL_LSR: 2.8,
            LSR_WEIGHT: 25,
            PRIORITY_BONUS: 20
        },
        GENERAL: {
            PRIORITY_CACHE_TTL: 300000,
            SORT_MODE: 'HYBRID',
            VERBOSE_LOGS: true,
            UPDATE_EACH_CYCLE: true,
            MIN_SYMBOLS_FOR_PRIORIDADE: 10,
            EMOJI_RANKINGS: {
                'EXCELLENT': '🏆🏆🏆',
                'GOOD': '🏆🏆',
                'MEDIUM': '🏆',
                'LOW': '⚡',
                'POOR': '📉'
            }
        }
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 200,
        CYCLE_DELAY_MS: 30000,
        MAX_SYMBOLS_PER_CYCLE: 0,
        PRIORITIZE_RECENT_SIGNALS: true,
        COOLDOWN_MINUTES: 5,
        CANDLE_CACHE_TTL: 90000,
        MAX_CACHE_AGE: 12 * 60 * 1000
    },
    CLEANUP: {
        INTERVAL: 5 * 60 * 1000,
        MAX_LOG_DAYS: 7,
        MAX_CACHE_DAYS: 1,
        MEMORY_THRESHOLD: 500 * 1024 * 1024
    }
};

// =====================================================================
// === CONFIGURAÇÃO EMA 3 MINUTOS ===
// =====================================================================
const EMA_CONFIG = {
    TIMEFRAME: '3m',
    EMA13: 13,
    EMA34: 34,
    EMA55: 55
};

// =====================================================================
// === DIRETÓRIOS E VARIÁVEIS GLOBAIS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';

// CONTADOR DE ALERTAS - ZERA TODO DIA ÀS 21H
let alertCounter = {};
let dailyAlerts = 0;
let globalAlerts = 0;
let lastResetDate = null;

const priorityCache = {
    symbols: null,
    timestamp: 0,
    scores: {}
};

const symbolCooldown = {};
const stochasticCooldown = {};
const stochCrossState = {};

// === CACHE DE CANDLES ===
const candleCache = {};

// =====================================================================
// === ERROR HANDLER GRANULAR ===
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
// === ADAPTIVE RATE LIMITER ===
// =====================================================================
class AdaptiveRateLimiter {
    constructor() {
        this.minuteWindow = { start: Date.now(), usedWeight: 0 };
        this.secondWindow = { start: Date.now(), usedWeight: 0 };
        this.queue = [];
        this.isProcessing = false;
        this.adaptiveDelay = 100;
        this.minDelay = 50;
        this.maxDelay = 500;
    }

    async makeRequest(url, options = {}, endpointType = 'klines') {
        const weight = 1;
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const request = {
                id: requestId,
                url,
                options,
                weight,
                resolve,
                reject,
                timestamp: Date.now()
            };

            this.queue.push(request);

            if (!this.isProcessing) {
                this.processQueue();
            }

            setTimeout(() => {
                const index = this.queue.findIndex(req => req.id === requestId);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    reject(Object.assign(new Error(`Request timeout: ${url}`), { 
                        code: 'TIMEOUT',
                        context: 'RateLimiter'
                    }));
                }
            }, 30000);
        });
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const request = this.queue.shift();
                if (!request) {
                    await this.delay(100);
                    continue;
                }

                try {
                    const result = await ErrorHandler.retry(
                        () => this.executeRequest(request),
                        `RateLimiter-${request.url.split('/').pop()}`,
                        2,
                        500
                    );
                    request.resolve(result);
                } catch (error) {
                    request.reject(error);
                }

                await this.delay(this.adaptiveDelay);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    async executeRequest(request) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(request.url, {
                ...request.options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.response = { status: response.status, statusText: response.statusText };
                throw error;
            }

            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
            
            if (deletedCount > 0) {
                console.log(`🗑️  Cache limpo: ${deletedCount} entradas removidas`);
            }
            
            if (rateLimiter.queue.length > 100) {
                rateLimiter.queue = rateLimiter.queue.slice(0, 50);
                console.log(`🗑️  Fila reduzida para 50 requisições`);
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
                        console.log(`🗑️  Log antigo removido: ${file}`);
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
                        console.log(`🗑️  Cache file removido: ${file}`);
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
                console.log('⚠️  Memória alta, limpando cache agressivamente...');
                const cacheSizeBefore = Object.keys(candleCache).length;
                Object.keys(candleCache).forEach(key => delete candleCache[key]);
                console.log(`🗑️  Cache limpo: ${cacheSizeBefore} entradas removidas`);
                
                if (global.gc) {
                    global.gc();
                    console.log('🗑️  Coleta de lixo forçada executada');
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
// === SISTEMA DE PRIORIDADE AVANÇADO ===
// =====================================================================
class PrioritySystem {
    constructor() {
        this.liquidityData = null;
        this.lastUpdate = 0;
    }
    
    isInCooldown(symbol) {
        if (!symbolCooldown[symbol]) return false;
        const cooldownMs = CONFIG.PERFORMANCE.COOLDOWN_MINUTES * 60 * 1000;
        return (Date.now() - symbolCooldown[symbol]) < cooldownMs;
    }
    
    isInStochasticCooldown(symbol) {
        if (!stochasticCooldown[symbol]) return false;
        const cooldownMs = 60 * 60 * 1000;
        return (Date.now() - stochasticCooldown[symbol]) < cooldownMs;
    }
    
    registerStochasticAlert(symbol) {
        stochasticCooldown[symbol] = Date.now();
    }
    
    async fetchTickerData() {
        try {
            const url = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
            const data = await ErrorHandler.retry(
                () => rateLimiter.makeRequest(url, {}, 'ticker'),
                'FetchTickerData',
                3,
                1000
            );
            
            const tickerMap = {};
            data.forEach(ticker => {
                if (ticker.symbol.endsWith('USDT')) {
                    tickerMap[ticker.symbol] = {
                        volume: parseFloat(ticker.volume),
                        quoteVolume: parseFloat(ticker.quoteVolume),
                        lastPrice: parseFloat(ticker.lastPrice),
                        liquidity: parseFloat(ticker.quoteVolume)
                    };
                }
            });
            
            return tickerMap;
        } catch (error) {
            const errorInfo = ErrorHandler.handle(error, 'FetchTickerData');
            if (!errorInfo.retryable) {
                console.log(`⚠️  Erro não retryável ao buscar ticker: ${errorInfo.message}`);
            }
            return null;
        }
    }
    
    async fetchLSRData(symbols) {
        try {
            const lsrData = {};
            const symbolsToFetch = symbols.slice(0, 20);
            
            for (const symbol of symbolsToFetch) {
                try {
                    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
                    const response = await ErrorHandler.retry(
                        () => rateLimiter.makeRequest(url, {}, 'lsr'),
                        `FetchLSR-${symbol}`,
                        2,
                        500
                    );
                    
                    if (response && Array.isArray(response) && response.length > 0) {
                        const data = response[0];
                        lsrData[symbol] = {
                            lsr: parseFloat(data.longShortRatio),
                            longAccount: parseFloat(data.longAccount),
                            shortAccount: parseFloat(data.shortAccount),
                            timestamp: data.timestamp
                        };
                    }
                    
                    await new Promise(r => setTimeout(r, 100));
                } catch (error) {
                    ErrorHandler.handle(error, `FetchLSR-${symbol}`);
                }
            }
            
            return lsrData;
        } catch (error) {
            ErrorHandler.handle(error, 'FetchLSRData');
            return null;
        }
    }
    
    async prioritizeSymbols(symbols, signalType = null) {
        if (!CONFIG.PRIORITY.ENABLED || symbols.length < CONFIG.PRIORITY.GENERAL.MIN_SYMBOLS_FOR_PRIORIDADE) {
            return symbols;
        }
        
        const now = Date.now();
        
        if (priorityCache.symbols && 
            (now - priorityCache.timestamp) < CONFIG.PRIORITY.GENERAL.PRIORITY_CACHE_TTL &&
            !CONFIG.PRIORITY.GENERAL.UPDATE_EACH_CYCLE) {
            if (CONFIG.PRIORITY.GENERAL.VERBOSE_LOGS) {
                console.log(`📊 Usando cache de prioridade (${Math.round((now - priorityCache.timestamp)/1000)}s atrás)`);
            }
            return priorityCache.symbols;
        }
        
        console.log(`📊 Calculando prioridades para ${symbols.length} símbolos...`);
        
        try {
            const tickerData = await this.fetchTickerData();
            const lsrData = await this.fetchLSRData(symbols);
            
            if (!tickerData && !lsrData) {
                console.log('⚠️  Dados insuficientes para calcular prioridades, usando ordem original');
                return symbols;
            }
            
            const symbolScores = [];
            
            for (const symbol of symbols) {
                if (this.isInCooldown(symbol)) {
                    if (CONFIG.PRIORITY.GENERAL.VERBOSE_LOGS) {
                        console.log(`⏸️  ${symbol} em cooldown, pulando priorização`);
                    }
                    continue;
                }
                
                let score = 50;
                
                if (tickerData && tickerData[symbol]) {
                    score += 25;
                }
                
                if (lsrData && lsrData[symbol]) {
                    const lsr = lsrData[symbol].lsr;
                    if (signalType === 'STOCHASTIC_COMPRA' && lsr < CONFIG.PRIORITY.LSR.IDEAL_BUY_LSR) {
                        score += 25;
                    } else if (signalType === 'STOCHASTIC_VENDA' && lsr > CONFIG.PRIORITY.LSR.IDEAL_SELL_LSR) {
                        score += 25;
                    }
                }
                
                symbolScores.push({
                    symbol: symbol,
                    score: score,
                    details: { emojiRanking: score > 80 ? '🏆🏆🏆' : score > 60 ? '🏆🏆' : '🏆' }
                });
                
                priorityCache.scores[symbol] = {
                    score: score,
                    timestamp: now,
                    emojiRanking: score > 80 ? '🏆🏆🏆' : score > 60 ? '🏆🏆' : '🏆'
                };
            }
            
            symbolScores.sort((a, b) => b.score - a.score);
            
            let prioritizedSymbols = symbolScores.map(item => item.symbol);
            if (CONFIG.PRIORITY.LIQUIDITY.MAX_LIQUID_SYMBOLS > 0) {
                prioritizedSymbols = prioritizedSymbols.slice(0, CONFIG.PRIORITY.LIQUIDITY.MAX_LIQUID_SYMBOLS);
            }
            
            priorityCache.symbols = prioritizedSymbols;
            priorityCache.timestamp = now;
            
            console.log(`✅ Prioridades calculadas: ${prioritizedSymbols.length} símbolos ordenados`);
            return prioritizedSymbols;
            
        } catch (error) {
            ErrorHandler.handle(error, 'PrioritizeSymbols');
            console.log('⚠️  Erro ao calcular prioridades, usando ordem original');
            return symbols;
        }
    }
    
    getSymbolPriorityInfo(symbol) {
        return priorityCache.scores[symbol] || null;
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
        symbolTotal: alertCounter[symbol].total,
        symbolStochastic: alertCounter[symbol].stochastic,
        symbolDailyTotal: alertCounter[symbol].dailyTotal,
        symbolDailyStochastic: alertCounter[symbol].dailyStochastic,
        globalTotal: globalAlerts,
        dailyTotal: dailyAlerts
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
// === FUNÇÕES DE ANÁLISE TÉCNICA ===
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

        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0],
            isClosed: candle[0] + candle[6] < Date.now()
        }));

        candleCache[cacheKey] = { data: candles, timestamp: now };
        return candles;

    } catch (error) {
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

function calculateRSI(closes, period) {
    try {
        if (closes.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = closes.length - period; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / (avgLoss || 0.001);
        return 100 - (100 / (1 + rs));
    } catch (error) {
        ErrorHandler.handle(error, 'CalculateRSI');
        return 50;
    }
}

function calculateRSIForPeriod(closes, period) {
    try {
        if (closes.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = closes.length - period; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / (avgLoss || 0.001);
        return 100 - (100 / (1 + rs));
    } catch (error) {
        ErrorHandler.handle(error, 'CalculateRSIForPeriod');
        return 50;
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
        
        return {
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
        
    } catch (error) {
        ErrorHandler.handle(error, `GetStochastic-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO: VERIFICAÇÃO EMA 3 MINUTOS ===
// =====================================================================
async function checkEMA3m(symbol, signalType) {
    try {
        const candles = await getCandles(symbol, EMA_CONFIG.TIMEFRAME, 100);
        if (candles.length < Math.max(EMA_CONFIG.EMA55, EMA_CONFIG.EMA34)) {
            return { isValid: false, error: 'Candles insuficientes' };
        }

        const closes = candles.map(c => c.close);
        const lastCandle = candles[candles.length - 1];
        
        // Calcular EMAs
        const ema13 = calculateEMA(closes, EMA_CONFIG.EMA13);
        const ema34 = calculateEMA(closes, EMA_CONFIG.EMA34);
        const ema55 = calculateEMA(closes, EMA_CONFIG.EMA55);
        
        // Calcular EMAs do candle anterior
        const prevCloses = closes.slice(0, -1);
        const prevEma13 = calculateEMA(prevCloses, EMA_CONFIG.EMA13);
        const prevEma34 = calculateEMA(prevCloses, EMA_CONFIG.EMA34);
        
        let isValid = false;
        let analysis = '';
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            // COMPRA: EMA13 cruzando para cima da EMA34 E preço fechando acima da EMA55
            const emaCrossUp = prevEma13 <= prevEma34 && ema13 > ema34;
            const priceAboveEma55 = lastCandle.close > ema55;
            
            isValid = emaCrossUp && priceAboveEma55;
            
            analysis = `📊 EMA 3m: ${emaCrossUp ? '✅' : '❌'} Cruzamento 13/34 | ${priceAboveEma55 ? '✅' : '❌'} Preço > EMA55`;
            
            console.log(`   • EMA 13/34: ${emaCrossUp ? 'Cruzou para CIMA' : 'Sem cruzamento'}`);
            console.log(`   • EMA 55: ${priceAboveEma55 ? 'Preço ACIMA' : 'Preço ABAIXO'}`);
            
        } else {
            // VENDA: EMA13 cruzando para baixo da EMA34 E preço fechando abaixo da EMA55
            const emaCrossDown = prevEma13 >= prevEma34 && ema13 < ema34;
            const priceBelowEma55 = lastCandle.close < ema55;
            
            isValid = emaCrossDown && priceBelowEma55;
            
            analysis = `📊 EMA 3m: ${emaCrossDown ? '✅' : '❌'} Cruzamento 13/34 | ${priceBelowEma55 ? '✅' : '❌'} Preço < EMA55`;
            
            console.log(`   • EMA 13/34: ${emaCrossDown ? 'Cruzou para BAIXO' : 'Sem cruzamento'}`);
            console.log(`   • EMA 55: ${priceBelowEma55 ? 'Preço ABAIXO' : 'Preço ACIMA'}`);
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
        
        return {
            value: rsi,
            status: rsi < 25 ? 'OVERSOLD' : rsi > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
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
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            return null;
        }
        
        const data = response[0];
        const lsrValue = parseFloat(data.longShortRatio);
        
        return {
            lsrValue: lsrValue,
            longAccount: parseFloat(data.longAccount),
            shortAccount: parseFloat(data.shortAccount)
        };
    } catch (error) {
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

        if (!data || data.length === 0) {
            return null;
        }

        const fundingRate = parseFloat(data[0].fundingRate);
        
        return {
            rate: fundingRate,
            ratePercent: (fundingRate * 100).toFixed(5)
        };
    } catch (error) {
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
        
        return {
            pivot: pivot,
            resistances: resistances,
            supports: supports,
            nearestResistance: nearestResistance,
            nearestSupport: nearestSupport,
            nearestPivot: isBullish ? nearestResistance : nearestSupport
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzePivot-${symbol}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÕES: FIBONACCI 4H ===
// =====================================================================

async function calculateFibonacciLevels4h(symbol, isBullish) {
    try {
        const candles = await getCandles(symbol, '4h', 100);
        if (candles.length < 50) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        let swingHigh, swingLow;
        
        if (isBullish) {
            swingLow = Math.min(...lows.slice(-48));
            swingHigh = Math.max(...highs.slice(-48));
        } else {
            swingHigh = Math.max(...highs.slice(-48));
            swingLow = Math.min(...lows.slice(-48));
        }
        
        const diff = swingHigh - swingLow;
        
        return {
            swingHigh,
            swingLow,
            diff,
            levels: {
                fib0: swingLow,
                fib0236: swingLow + diff * 0.236,
                fib0382: swingLow + diff * 0.382,
                fib05: swingLow + diff * 0.5,
                fib0618: swingLow + diff * 0.618,
                fib0786: swingLow + diff * 0.786,
                fib1: swingHigh
            },
            targets: isBullish ? {
                t1: swingLow + diff * 0.382,
                t2: swingLow + diff * 0.618,
                t3: swingLow + diff * 0.786,
                t4: swingLow + diff * 1.000,
                t5: swingLow + diff * 1.272,
                t6: swingLow + diff * 1.618,
                t7: swingLow + diff * 2.000,
                t8: swingLow + diff * 2.618,
                t9: swingLow + diff * 3.618,
                t10: swingLow + diff * 4.236
            } : {
                t1: swingHigh - diff * 0.382,
                t2: swingHigh - diff * 0.618,
                t3: swingHigh - diff * 0.786,
                t4: swingHigh - diff * 1.000,
                t5: swingHigh - diff * 1.272,
                t6: swingHigh - diff * 1.618,
                t7: swingHigh - diff * 2.000,
                t8: swingHigh - diff * 2.618,
                t9: swingHigh - diff * 3.618,
                t10: swingHigh - diff * 4.236
            }
        };
    } catch (error) {
        ErrorHandler.handle(error, `CalculateFibonacci-${symbol}`);
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
// === FUNÇÃO: ANALISAR VOLUME 1H COM EMA 9 ===
// =====================================================================
async function analyzeVolume1hWithEMA9(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 50);
        if (candles.length < 10) {
            return { direction: 'Desconhecido', percentage: 0, emoji: '❓' };
        }

        const volumes = candles.map(c => c.volume);
        const closes = candles.map(c => c.close);
        
        // Calcular EMA 9 dos preços
        const ema9 = calculateEMA(closes, 9);
        
        // Calcular volume comprador/vendedor baseado na relação preço/EMA
        let buyerVolume = 0;
        let sellerVolume = 0;
        let totalVolume = 0;
        
        // Analisar últimos 24 candles (1 dia) para média
        const recentCandles = candles.slice(-24);
        
        recentCandles.forEach((candle, index) => {
            const volume = candle.volume;
            totalVolume += volume;
            
            // Se preço fechou acima da EMA9, considera volume comprador
            // Se preço fechou abaixo da EMA9, considera volume vendedor
            if (candle.close > ema9) {
                buyerVolume += volume;
            } else if (candle.close < ema9) {
                sellerVolume += volume;
            } else {
                // Se igual, divide meio a meio
                buyerVolume += volume / 2;
                sellerVolume += volume / 2;
            }
        });
        
        const buyerPercentage = (buyerVolume / totalVolume) * 100;
        const sellerPercentage = (sellerVolume / totalVolume) * 100;
        
        let direction = '';
        let emoji = '';
        
        if (buyerPercentage > 55) {
            direction = 'Comprador';
            emoji = '🟢';
        } else if (sellerPercentage > 55) {
            direction = 'Vendedor';
            emoji = '🔴';
        } else {
            direction = 'Neutro';
            emoji = '⚪';
        }
        
        return {
            direction,
            percentage: Math.round(buyerPercentage),
            sellerPercentage: Math.round(sellerPercentage),
            emoji,
            buyerVolume,
            sellerVolume,
            totalVolume
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzeVolume1h-${symbol}`);
        return { direction: 'Erro', percentage: 0, emoji: '❌' };
    }
}

// =====================================================================
// === SINAIS DE ESTOCÁSTICO COM FILTRO DE RSI 1H E EMA 3M ===
// =====================================================================
async function checkStochasticSignal(symbol, prioritySystem) {
    if (!CONFIG.STOCHASTIC.ENABLED || prioritySystem.isInStochasticCooldown(symbol)) {
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

        // FILTRO ESTOCÁSTICO: Só alertar se estiver abaixo de 20 (compra) ou acima de 80 (venda)
        if (signalType === 'STOCHASTIC_COMPRA' && stochastic.k >= CONFIG.STOCHASTIC.OVERSOLD) {
            console.log(`⚠️ ${symbol}: Cruzamento de COMPRA ignorado - Estocástico K=${stochastic.k.toFixed(1)} (deve ser < ${CONFIG.STOCHASTIC.OVERSOLD})`);
            return null;
        }
        
        if (signalType === 'STOCHASTIC_VENDA' && stochastic.k <= CONFIG.STOCHASTIC.OVERBOUGHT) {
            console.log(`⚠️ ${symbol}: Cruzamento de VENDA ignorado - Estocástico K=${stochastic.k.toFixed(1)} (deve ser > ${CONFIG.STOCHASTIC.OVERBOUGHT})`);
            return null;
        }

        // Verificar EMA 3m
        const emaCheck = await checkEMA3m(symbol, signalType);
        if (!emaCheck.isValid) {
            console.log(`⚠️ ${symbol}: Sinal ignorado - EMA 3m não confirmou`);
            if (emaCheck.analysis) {
                console.log(`   ${emaCheck.analysis}`);
            }
            return null;
        }
        
        console.log(`✅ ${symbol}: EMA 3m confirmou o sinal`);

        const [rsiData, lsrData, fundingData, pivotData, currentPrice, volumeData] = await Promise.all([
            getRSI1h(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzePivotPoints(symbol, await getCurrentPrice(symbol), signalType === 'STOCHASTIC_COMPRA'),
            getCurrentPrice(symbol),
            analyzeVolume1hWithEMA9(symbol)
        ]);

        // =================================================================
        // === FILTRO DE RSI 1H PARA COMPRA E VENDA ===
        // =================================================================
        
        // Para COMPRA: RSI 1h DEVE ser MENOR que MAX_RSI
        if (signalType === 'STOCHASTIC_COMPRA' && RSI_1H_CONFIG.COMPRA.ENABLED) {
            if (!rsiData || rsiData.value >= RSI_1H_CONFIG.COMPRA.MAX_RSI) {
                console.log(`⚠️ ${symbol}: Sinal de COMPRA ignorado - RSI 1h ${rsiData?.value?.toFixed(1) || 'N/A'} >= ${RSI_1H_CONFIG.COMPRA.MAX_RSI}`);
                return null;
            }
            console.log(`✅ ${symbol}: RSI 1h ${rsiData.value.toFixed(1)} < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} - OK para COMPRA`);
        }
        
        // Para VENDA: RSI 1h DEVE ser MAIOR que MIN_RSI
        if (signalType === 'STOCHASTIC_VENDA' && RSI_1H_CONFIG.VENDA.ENABLED) {
            if (!rsiData || rsiData.value <= RSI_1H_CONFIG.VENDA.MIN_RSI) {
                console.log(`⚠️ ${symbol}: Sinal de VENDA ignorado - RSI 1h ${rsiData?.value?.toFixed(1) || 'N/A'} <= ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
                return null;
            }
            console.log(`✅ ${symbol}: RSI 1h ${rsiData.value.toFixed(1)} > ${RSI_1H_CONFIG.VENDA.MIN_RSI} - OK para VENDA`);
        }

        let isIdealLSR = false;
        if (lsrData) {
            if (signalType === 'STOCHASTIC_COMPRA') {
                isIdealLSR = lsrData.lsrValue < CONFIG.PRIORITY.LSR.IDEAL_BUY_LSR;
            } else {
                isIdealLSR = lsrData.lsrValue > CONFIG.PRIORITY.LSR.IDEAL_SELL_LSR;
            }
        }

        const fibonacciLevels = await calculateFibonacciLevels4h(symbol, signalType === 'STOCHASTIC_COMPRA');
        const srLevels = await calculateSupportResistance15m(symbol, currentPrice);

        return {
            symbol: symbol,
            type: signalType,
            stochastic: stochastic,
            rsi: rsiData?.value,
            lsr: lsrData?.lsrValue,
            isIdealLSR: isIdealLSR,
            funding: fundingData?.ratePercent,
            pivotData: pivotData,
            currentPrice: currentPrice,
            time: getBrazilianDateTime(),
            isFreshCross: isFreshCross,
            fibonacci: fibonacciLevels,
            srLevels: srLevels,
            emaCheck: emaCheck,
            volumeData: volumeData
        };
    } catch (error) {
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
        recommendation: ''
    };
    
    const weights = {
        FUNDING: 25,
        LSR: 30,
        RSI: 20,
        STRUCTURE: 25
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
            } else if (lsrValue < CONFIG.PRIORITY.LSR.IDEAL_BUY_LSR) {
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
            } else if (lsrValue > CONFIG.PRIORITY.LSR.IDEAL_SELL_LSR) {
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
                
                if (distToResistance > 5) {
                    factors.positive.push(`🟢🟢 ESTRUTURA: Resistência distante ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE;
                } else if (distToResistance > 3) {
                    factors.positive.push(`🟢 ESTRUTURA: Resistência moderada ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToResistance > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA: Resistência próxima ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔴 ESTRUTURA: Resistência muito próxima ${distToResistance.toFixed(2)}%`);
                }
            }
            
            if (currentPrice > pivot.pivot) {
                factors.positive.push(`🟢 PREÇO ACIMA DO PIVÔ: ${((currentPrice - pivot.pivot) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            }
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                
                if (distToSupport > 5) {
                    factors.positive.push(`🔴🔴 ESTRUTURA: Suporte distante ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE;
                } else if (distToSupport > 3) {
                    factors.positive.push(`🔴 ESTRUTURA: Suporte moderado ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToSupport > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA: Suporte próximo ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔵 ESTRUTURA: Suporte muito próximo ${distToSupport.toFixed(2)}%`);
                }
            }
            
            if (currentPrice < pivot.pivot) {
                factors.positive.push(`🔵 PREÇO ABAIXO DO PIVÔ: ${((pivot.pivot - currentPrice) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            }
        }
    }
    
    if (indicators.emaCheck && indicators.emaCheck.analysis) {
        factors.positive.push(`📊 ${indicators.emaCheck.analysis}`);
        totalScore += 15;
    }
    
    factors.score = Math.min(100, Math.round((totalScore / factors.maxScore) * 100));
    
    if (signalType === 'STOCHASTIC_COMPRA') {
        if (factors.score >= 80) {
            factors.summary = '🏆 Operação Excelente PARA COMPRA';
            factors.recommendation = '✅ Entrada agressiva. Todos fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Operação Favorável PARA COMPRA';
            factors.recommendation = '📊 Entrada moderada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Operação Neutra PARA COMPRA';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ Operação Desfavorável PARA COMPRA';
            factors.recommendation = '❌ Evitar entrada. Aguardar.';
        } else {
            factors.summary = '🚫 Operação Ruim PARA COMPRA';
            factors.recommendation = '❌❌ Não entrar. Fatores negativos.';
        }
    } else {
        if (factors.score >= 80) {
            factors.summary = '🏆 Operação Excelente PARA CORREÇÃO';
            factors.recommendation = '✅ Entrada agressiva. Todos fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 Operação Favorável PARA CORREÇÃO';
            factors.recommendation = '📊 Entrada moderada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ Operação Neutra PARA CORREÇÃO';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ Operação Desfavorável PARA CORREÇÃO';
            factors.recommendation = '❌ Evitar entrada. Aguardar.';
        } else {
            factors.summary = '🚫 Operação Ruim PARA CORREÇÃO';
            factors.recommendation = '❌❌ Não entrar. Fatores negativos.';
        }
    }
    
    return factors;
}

// =====================================================================
// === ANÁLISES DETALHADAS ===
// =====================================================================
async function analyzeFundingRateDetailed(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`;
        const data = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'fundingRateDetailed'),
            `AnalyzeFundingDetailed-${symbol}`,
            2,
            500
        );
        
        if (!data || data.length === 0) {
            return null;
        }
        
        let totalFunding = 0;
        let positiveCount = 0;
        let negativeCount = 0;
        let zeroCount = 0;
        
        data.forEach(item => {
            const rate = parseFloat(item.fundingRate);
            totalFunding += rate;
            if (rate > 0) positiveCount++;
            else if (rate < 0) negativeCount++;
            else zeroCount++;
        });
        
        const avgFunding = totalFunding / data.length;
        const currentFunding = parseFloat(data[0].fundingRate);
        
        let trend = 'NEUTRO';
        let trendEmoji = '⚪';
        
        if (positiveCount > negativeCount * 1.5) {
            trend = 'POSITIVO FORTE';
            trendEmoji = '🔴🔴';
        } else if (positiveCount > negativeCount) {
            trend = 'POSITIVO MODERADO';
            trendEmoji = '🔴';
        } else if (negativeCount > positiveCount * 1.5) {
            trend = 'NEGATIVO FORTE';
            trendEmoji = '🟢🟢';
        } else if (negativeCount > positiveCount) {
            trend = 'NEGATIVO MODERADO';
            trendEmoji = '🟢';
        }
        
        return {
            currentRate: currentFunding,
            currentRatePercent: (currentFunding * 100).toFixed(5),
            avgRate: avgFunding,
            avgRatePercent: (avgFunding * 100).toFixed(5),
            positiveCount,
            negativeCount,
            zeroCount,
            trend,
            trendEmoji
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzeFundingDetailed-${symbol}`);
        return null;
    }
}

async function analyzeLSRDetailed(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=10`;
        const response = await ErrorHandler.retry(
            () => rateLimiter.makeRequest(url, {}, 'lsrDetailed'),
            `AnalyzeLSRDetailed-${symbol}`,
            2,
            500
        );
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            return null;
        }
        
        let totalLSR = 0;
        let above2Count = 0;
        let below1Count = 0;
        
        response.forEach(item => {
            const lsr = parseFloat(item.longShortRatio);
            totalLSR += lsr;
            if (lsr > 2) above2Count++;
            if (lsr < 1) below1Count++;
        });
        
        const avgLSR = totalLSR / response.length;
        const currentLSR = parseFloat(response[0].longShortRatio);
        
        let sentiment = 'NEUTRO';
        let sentimentEmoji = '⚪';
        
        if (currentLSR > 3) {
            sentiment = 'MUITO ALTO (Longs dominam)';
            sentimentEmoji = '🔴🔴';
        } else if (currentLSR > 2) {
            sentiment = 'ALTO (Longs vantagem)';
            sentimentEmoji = '🔴';
        } else if (currentLSR < 0.8) {
            sentiment = 'MUITO BAIXO (Shorts dominam)';
            sentimentEmoji = '🟢🟢';
        } else if (currentLSR < 1) {
            sentiment = 'BAIXO (Shorts vantagem)';
            sentimentEmoji = '🟢';
        }
        
        return {
            currentLSR,
            avgLSR,
            above2Count,
            below1Count,
            sentiment,
            sentimentEmoji
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzeLSRDetailed-${symbol}`);
        return null;
    }
}

async function analyzeRSIDetailed(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 100);
        if (candles.length < 50) {
            return null;
        }

        const closes = candles.map(c => c.close);
        
        const rsi14 = calculateRSI(closes, 14);
        const rsi7 = calculateRSI(closes, 7);
        const rsi21 = calculateRSI(closes, 21);
        
        const rsiValues = [];
        for (let i = 13; i < closes.length; i++) {
            const rsi = calculateRSIForPeriod(closes.slice(0, i + 1), 14);
            rsiValues.push(rsi);
        }
        
        const rsiMA5 = rsiValues.length >= 5 
            ? rsiValues.slice(-5).reduce((a, b) => a + b, 0) / 5 
            : rsi14;
        
        let divergence = 'NENHUMA';
        let divergenceEmoji = '⚪';
        
        if (rsi14 > 70 && closes[closes.length - 1] > closes[closes.length - 5] && 
            rsiValues[rsiValues.length - 1] < rsiValues[rsiValues.length - 5]) {
            divergence = 'POSSÍVEL DIVERGÊNCIA DE BAIXA';
            divergenceEmoji = '🔴';
        } else if (rsi14 < 30 && closes[closes.length - 1] < closes[closes.length - 5] && 
                 rsiValues[rsiValues.length - 1] > rsiValues[rsiValues.length - 5]) {
            divergence = 'POSSÍVEL DIVERGÊNCIA DE ALTA';
            divergenceEmoji = '🟢';
        }
        
        let trend = 'NEUTRO';
        let trendEmoji = '➡️';
        
        const last5RSI = rsiValues.slice(-5);
        const avgLast5 = last5RSI.reduce((a, b) => a + b, 0) / 5;
        const prev5RSI = rsiValues.slice(-10, -5);
        const avgPrev5 = prev5RSI.length > 0 ? prev5RSI.reduce((a, b) => a + b, 0) / prev5RSI.length : avgLast5;
        
        if (avgLast5 > avgPrev5 * 1.02) {
            trend = 'ALTA';
            trendEmoji = '📈';
        } else if (avgLast5 < avgPrev5 * 0.98) {
            trend = 'BAIXA';
            trendEmoji = '📉';
        }
        
        return {
            rsi14: rsi14.toFixed(1),
            rsi7: rsi7.toFixed(1),
            rsi21: rsi21.toFixed(1),
            rsiMA5: rsiMA5.toFixed(1),
            divergence,
            divergenceEmoji,
            trend,
            trendEmoji,
            rsiDirection: avgLast5 > avgPrev5 ? 1 : -1
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzeRSIDetailed-${symbol}`);
        return null;
    }
}

async function analyzeStructureDetailed4h(symbol, currentPrice, isBullish) {
    try {
        const [candles1h, candles4h, candles1d] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '4h', 50),
            getCandles(symbol, '1d', 30)
        ]);
        
        const highs4h = candles4h.map(c => c.high);
        const lows4h = candles4h.map(c => c.low);
        const highs1d = candles1d.map(c => c.high);
        const lows1d = candles1d.map(c => c.low);
        
        const recentHigh4h = Math.max(...highs4h.slice(-20));
        const recentLow4h = Math.min(...lows4h.slice(-20));
        const recentHigh1d = Math.max(...highs1d.slice(-20));
        const recentLow1d = Math.min(...lows1d.slice(-20));
        
        let trend = 'NEUTRO';
        let trendEmoji = '⚪';
        
        const ema9_4h = calculateEMA(candles4h.map(c => c.close), 9);
        const ema21_4h = calculateEMA(candles4h.map(c => c.close), 21);
        
        if (ema9_4h > ema21_4h && candles4h[candles4h.length - 1].close > ema9_4h) {
            trend = 'ALTA';
            trendEmoji = '🟢';
        } else if (ema9_4h < ema21_4h && candles4h[candles4h.length - 1].close < ema9_4h) {
            trend = 'BAIXA';
            trendEmoji = '🔴';
        }
        
        return {
            levels: {
                resistance4h: recentHigh4h,
                support4h: recentLow4h,
                resistance1d: recentHigh1d,
                support1d: recentLow1d
            },
            trend,
            trendEmoji,
            currentPrice
        };
    } catch (error) {
        ErrorHandler.handle(error, `AnalyzeStructureDetailed-${symbol}`);
        return null;
    }
}

// =====================================================================
// === ALERTA PRINCIPAL (COM CONTADOR NA LINHA ABAIXO DA DATA/HORA) ===
// =====================================================================
async function sendStochasticAlertEnhanced(signal, prioritySystem) {
    const entryPrice = signal.currentPrice;
    
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    prioritySystem.registerStochasticAlert(signal.symbol);
    
    const [fundingDetailed, lsrDetailed, rsiDetailed, structureDetailed] = await Promise.all([
        analyzeFundingRateDetailed(signal.symbol),
        analyzeLSRDetailed(signal.symbol),
        analyzeRSIDetailed(signal.symbol),
        analyzeStructureDetailed4h(signal.symbol, entryPrice, signal.type === 'STOCHASTIC_COMPRA')
    ]);
    
    signal.fundingDetailed = fundingDetailed;
    signal.lsrDetailed = lsrDetailed;
    signal.rsiDetailed = rsiDetailed;
    signal.structureDetailed = structureDetailed;
    
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        funding: signal.funding,
        lsr: signal.lsr,
        rsi: signal.rsi,
        pivotData: signal.pivotData,
        currentPrice: entryPrice,
        emaCheck: signal.emaCheck
    });
    
    // =================================================================
    // === BUSCAR SUPORTE E RESISTÊNCIA 15M ===
    // =================================================================
    let srInfo = null;
    try {
        srInfo = await calculateSupportResistance15m(signal.symbol, entryPrice);
        console.log(` ${signal.symbol}: S/R 15m calculado - R: $${srInfo?.nearestResistance?.toFixed(6) || 'N/A'} | S: $${srInfo?.nearestSupport?.toFixed(6) || 'N/A'}`);
    } catch (error) {
        ErrorHandler.handle(error, `GetSR-${signal.symbol}`);
    }
    
    // =================================================================
    // === CONSTRUÇÃO DA MENSAGEM (COM CONTADOR DE ALERTAS) ===
    // =================================================================
    
    // CALCULAR ALVOS PRINCIPAIS (T4, T5, T6)
    let takeProfitCompact = 'Alvos: N/A';
    if (signal.fibonacci) {
        const fib = signal.fibonacci;
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
            takeProfitCompact = `Alvos: T1: $${fib.targets.t4.toFixed(6)} | T2: $${fib.targets.t5.toFixed(6)} | T3: $${fib.targets.t6.toFixed(6)}`;
        } else {
            takeProfitCompact = `Alvos: T1: $${fib.targets.t4.toFixed(6)} | T2: $${fib.targets.t5.toFixed(6)} | T3: $${fib.targets.t6.toFixed(6)}`;
        }
    }
    
    // CALCULAR STOP LOSS ADAPTATIVO
    let stopCompact = 'Stop: N/A';
    let stopPrice = 0;
    let stopPercent = 0;
    
    if (signal.stopLoss) {
        stopPrice = signal.stopLoss.stopPrice;
        stopPercent = signal.stopLoss.stopPercent;
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(1)}%)`;
        } else {
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(1)}%)`;
        }
    } else if (signal.fibonacci) {
        // Fallback para o método antigo se o adaptativo falhar
        const fib = signal.fibonacci;
        const price = entryPrice;
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
            const stop1 = Math.max(fib.targets.t1 * 0.985, fib.swingLow * 0.99);
            
            stopPrice = stop1;
            if (signal.srLevels && signal.srLevels.nearestSupport) {
                stopPrice = Math.min(stopPrice, signal.srLevels.nearestSupport * 0.99);
            }
            
            stopPercent = ((price - stopPrice) / price * 100);
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(1)}%)`;
            
        } else {
            const stop1 = Math.max(fib.targets.t1 * 1.015, fib.swingHigh * 1.01);
            
            stopPrice = stop1;
            if (signal.srLevels && signal.srLevels.nearestResistance) {
                stopPrice = Math.max(stopPrice, signal.srLevels.nearestResistance * 1.01);
            }
            
            stopPercent = ((stopPrice - price) / price * 100);
            stopCompact = `Stop: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(1)}%)`;
        }
    }
    
    // FORMATAR SUPORTE E RESISTÊNCIA 15M
    let srCompact = '';
    if (srInfo) {
        const resistance = srInfo.nearestResistance;
        const support = srInfo.nearestSupport;
        const distR = resistance ? ((resistance - entryPrice) / entryPrice * 100).toFixed(1) : 'N/A';
        const distS = support ? ((entryPrice - support) / entryPrice * 100).toFixed(1) : 'N/A';
        
        srCompact = `Resist: $${resistance?.toFixed(6) || 'N/A'} (${distR}%) | Supt: $${support?.toFixed(6) || 'N/A'} (${distS}%)`;
    }
    
    // FORMATAR EMA 3m (removendo os emojis duplicados)
    let emaCompact = '';
    if (signal.emaCheck && signal.emaCheck.analysis) {
        emaCompact = signal.emaCheck.analysis.replace(/📊 /g, '');
    }
    
    // FORMATAR SCORE
    const scoreValue = factors?.score || 0;
    
    let shortSummary = '💡';
    if (factors?.summary) {
        const words = factors.summary.split(' ');
        if (words.length >= 3) {
            shortSummary = words.slice(0, 3).join(' ');
        } else {
            shortSummary = factors.summary;
        }
    }
    
    const scoreCompact = `Score: ${scoreValue}% | ${shortSummary}`;
    
    // FORMATAR LSR
    let lsrText = 'N/A';
    let lsrEmoji = '';
    if (signal.lsr) {
        lsrText = signal.lsr.toFixed(2);
        if (signal.type === 'STOCHASTIC_COMPRA') {
            lsrEmoji = signal.lsr < CONFIG.PRIORITY.LSR.IDEAL_BUY_LSR ? '✅' : '⚠️';
        } else {
            lsrEmoji = signal.lsr > CONFIG.PRIORITY.LSR.IDEAL_SELL_LSR ? '✅' : '⚠️';
        }
    }
    
    // FORMATAR FUNDING
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
    
    // FORMATAR STOCH
    const stochText = `K${signal.stochastic.k.toFixed(1)}/D${signal.stochastic.d.toFixed(1)}`;
    
    // FORMATAR RSI
    let rsiText = 'N/A';
    if (signal.rsi) {
        rsiText = signal.rsi.toFixed(0);
    }
    
    // FORMATAR VOLUME 1H
    let volumeText = 'Volume 1h: Desconhecido';
    if (signal.volumeData) {
        const volData = signal.volumeData;
        volumeText = `Volume 1h: ${volData.percentage}% ${volData.direction}`;
        if (volData.emoji) {
            volumeText = `${volData.emoji} ${volumeText}`;
        }
    }
    
    // FORMATAR CONTADOR DE ALERTAS
    const alertCounterText = `Alerta ${alertCount.symbolDailyStochastic || 0}`;
    
    // DEFINIR ÍCONES
    const actionEmoji = signal.type === 'STOCHASTIC_COMPRA' ? '🟢' : '🔴';
    const actionText = signal.type === 'STOCHASTIC_COMPRA' ? 'COMPRA' : 'CORREÇÃO';
    
    // =================================================================
    // === CONSTRUÇÃO DA MENSAGEM (COM VOLUME 1H INCLUÍDO) ===
    // =================================================================
    
    let message = `${actionEmoji} ${actionText} • ${signal.symbol}
Preço: $${entryPrice.toFixed(6)}
${volumeText}
${alertCounterText} - ${signal.time.full}hs
❅──────✧❅✨❅✧──────❅
Stoch ${stochText} | RSI 1H ${rsiText}
LSR ${lsrEmoji} ${lsrText} | Fund ${fundingEmoji} ${fundingText}
${takeProfitCompact}
🛑 ${stopCompact}
${srCompact}
${scoreCompact}

✨ Titanium by @J4Rviz ✨`;

    // REMOVER LINHAS VAZIAS E ESPAÇOS EXTRAS
    message = message.replace(/\n\s*\n/g, '\n').trim();

    await sendTelegramAlert(message);
    
    console.log(`✅ Alerta enviado: ${signal.symbol} (${actionText})`);
    console.log(`   📊 Volume 1h: ${signal.volumeData?.percentage || 0}% ${signal.volumeData?.direction || 'Desconhecido'}`);
    console.log(`   📊 Score: ${factors.score}% | ${shortSummary}`);
    console.log(`   💰 Preço: $${entryPrice.toFixed(6)}`);
    console.log(`   📊 EMA 3m: ${signal.emaCheck.analysis}`);
    console.log(`   🛑 Stop adaptativo: $${stopPrice.toFixed(6)} (${stopPercent.toFixed(1)}%)`);
    console.log(`   🎯 Alvos: T2:$${signal.fibonacci?.targets.t2.toFixed(6)} T4:$${signal.fibonacci?.targets.t4.toFixed(6)} T6:$${signal.fibonacci?.targets.t6.toFixed(6)}`);
    if (srInfo) {
        console.log(`   🔺 Resistência 15m: $${srInfo.nearestResistance?.toFixed(6) || 'N/A'}`);
        console.log(`   🔻 Suporte 15m: $${srInfo.nearestSupport?.toFixed(6) || 'N/A'}`);
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

        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`✅ ${symbols.length} pares USDT encontrados`);
        return symbols;
    } catch (error) {
        ErrorHandler.handle(error, 'FetchAllSymbols');
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function monitorSymbol(symbol, prioritySystem) {
    try {
        console.log(`🔍 Analisando ${symbol}...`);
        
        const priorityInfo = prioritySystem.getSymbolPriorityInfo(symbol);
        if (priorityInfo && CONFIG.PRIORITY.GENERAL.VERBOSE_LOGS) {
            console.log(`   ${priorityInfo.emojiRanking} Prioridade: ${priorityInfo.score.toFixed(1)}`);
        }
        
        if (CONFIG.STOCHASTIC.ENABLED) {
            const stochasticSignal = await checkStochasticSignal(symbol, prioritySystem);
            if (stochasticSignal) {
                await sendStochasticAlertEnhanced(stochasticSignal, prioritySystem);
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
        console.log('📊 Estratégia: Estocástico 4h 14.3.3 + Fibonacci 4h + EMA 3m');
        console.log(`📈 Filtro RSI 1h: COMPRA < ${RSI_1H_CONFIG.COMPRA.MAX_RSI} | VENDA > ${RSI_1H_CONFIG.VENDA.MIN_RSI}`);
        console.log(`📊 Estocástico: COMPRA < ${CONFIG.STOCHASTIC.OVERSOLD} | VENDA > ${CONFIG.STOCHASTIC.OVERBOUGHT}`);
        console.log(`📊 Volume 1h: Análise comprador/vendedor com EMA 9`);
        console.log(`🕘 Contador de alertas zera todo dia às 21h BR`);
        console.log('='.repeat(80) + '\n');

        const cleanupSystem = new AdvancedCleanupSystem();
        const prioritySystem = new PrioritySystem();
        
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
            if (CONFIG.PRIORITY.ENABLED) {
                symbolsToMonitor = await prioritySystem.prioritizeSymbols(symbols);
                
                if (CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE > 0) {
                    symbolsToMonitor = symbolsToMonitor.slice(0, CONFIG.PERFORMANCE.MAX_SYMBOLS_PER_CYCLE);
                    console.log(`📊 Monitorando ${symbolsToMonitor.length}/${symbols.length} símbolos`);
                }
            }
            
            let signalsFound = 0;
            let symbolsAnalyzed = 0;
            
            for (const symbol of symbolsToMonitor) {
                try {
                    const foundSignal = await monitorSymbol(symbol, prioritySystem);
                    if (foundSignal) signalsFound++;
                    
                    symbolsAnalyzed++;
                    
                    await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SYMBOL_DELAY_MS));
                } catch (error) {
                    ErrorHandler.handle(error, `MainLoop-${symbol}`);
                    continue;
                }
            }
            
            console.log(`\n✅ Ciclo ${cycle} completo.`);
            console.log(`📊 Símbolos analisados: ${symbolsAnalyzed}/${symbols.length}`);
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
// === INICIALIZAÇÃO ===
// =====================================================================
let rateLimiter = new AdaptiveRateLimiter();

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
        console.log(`🕘 Contador de alertas zera todo dia às 21h BR`);
        console.log('='.repeat(80) + '\n');
        
        lastResetDate = getBrazilianDateString();
        
        await sendInitializationMessage();
        
        console.log('✅ Bot inicializado com sucesso!');
        console.log('⏳ Iniciando loop principal...\n');
        
        await mainBotLoop();
    } catch (error) {
        ErrorHandler.handle(error, 'StartBot');
        console.error(`🚨 ERRO NA INICIALIZAÇÃO: ${error.message}`);
        process.exit(1);
    }
}

if (global.gc) {
    console.log('🗑️  Coleta de lixo forçada disponível');
}

// Iniciar o bot
startBot();
