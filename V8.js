const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const z = require('zod');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6Ag',
        CHAT_ID: '-100255'
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 200,
        SCAN_INTERVAL_SECONDS: 120,
        CANDLE_CACHE_TTL: 300000,
        BATCH_SIZE: 15,
        REQUEST_TIMEOUT: 15000,
        COOLDOWN_MINUTES: 30,
        PRICE_DEVIATION_THRESHOLD: 0.5,
        TELEGRAM_RETRY_ATTEMPTS: 3,
        TELEGRAM_RETRY_DELAY: 2000
    },
    VOLUME: {
        TIMEFRAME: '1h',
        EMA_PERIOD: 9,
        MIN_VOLUME_RATIO: 1.7,
        BUYER_THRESHOLD: 52,
        SELLER_THRESHOLD: 48,
        CONFIRMATION_CANDLES: 2
    },
    RATE_LIMITER: {
        INITIAL_DELAY: 200,
        MAX_DELAY: 5000,
        BACKOFF_FACTOR: 2
    },
    TRADE: {
        RISK_REWARD_RATIO: 2.5,
        STOP_PERCENTAGE: 2,
        TAKE_PROFIT_LEVELS: [2, 3, 4],
        PARTIAL_CLOSE: [30, 30, 40]
    },
    EMA: {
        FAST: 13,      // Fibonacci - Micro tendência
        MEDIUM: 34,    // Fibonacci - Tendência curta
        SLOW: 55,      // Fibonacci - Tendência média
        MACRO: 233     // Proporção áurea - Macro tendência
    },
    SCORING: {
        ALIGNMENT_BONUS: 25,      // Todas EMAs alinhadas
        MACRO_CONFIRMATION: 20,    // Confirmado por EMA 233
        TREND_CONFIRMATION: 15,    // Confirmado por EMA 55
        FAST_CONFIRMATION: 12,     // Confirmado por EMA 34
        MOMENTUM_BONUS: 8,         // Acima da EMA 13
        MACRO_PENALTY: -25,        // Contra EMA 233
        TRADE_PENALTY: -15         // Contra tendência
    },
    ALERTS: {
        MIN_SCORE: 85,
        MIN_VOLUME_RATIO: 1.7,
        ENABLE_SOUND: true,
        MAX_ALERTS_PER_SCAN: 5,
        MAX_DAILY_ALERTS_PER_SYMBOL: 10,
        PRIORITY_LEVELS: {
            ALTA: 90,    // Aumentado devido ao novo sistema
            MEDIA: 80,
            BAIXA: 75
        }
    },
    RSI: {
        BUY_MAX: 64,
        SELL_MIN: 55,
        PERIOD: 14
    },
    RISK_MANAGEMENT: {
        MAX_RISK_PER_TRADE: 2,
        ADAPTIVE_STOPS: true,
        USE_VOLATILITY_FILTER: true,
        MIN_VOLUME_CONFIRMATION: 1.5, // Aumentado para melhor filtro
        MAX_STOP_DISTANCE_PERCENT: 5,
        USE_MULTIPLE_TIMEFRAMES: true,
        STRONG_TREND_MULTIPLIER: 1.3,  // R:R maior em alinhamento
        WEAK_TREND_MULTIPLIER: 0.8      // R:R menor em tendência fraca
    },
    DEBUG: {
        VERBOSE: false
    },
    CLEANUP: {
        ENABLED: true,
        MAX_LOG_AGE_HOURS: 24,
        MAX_CACHE_AGE_HOURS: 12,
        MAX_ALERT_FILES_AGE_HOURS: 48,
        CLEANUP_INTERVAL_MINUTES: 60,
        MAX_FOLDER_SIZE_MB: 500,
        COMPRESS_OLD_LOGS: true,
        MIN_FREE_SPACE_MB: 100
    }
};

// =====================================================================
// === SCHEMAS DE VALIDAÇÃO ZOD ===
// =====================================================================
const CandleSchema = z.object({
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().positive(),
    time: z.number().int()
});

const KlineResponseSchema = z.array(
    z.tuple([
        z.number(), z.string(), z.string(), z.string(), z.string(),
        z.string(), z.number(), z.string(), z.number(), z.string(),
        z.string(), z.string()
    ])
);

const LSRResponseSchema = z.array(
    z.object({
        longShortRatio: z.string(),
        longAccount: z.string(),
        shortAccount: z.string()
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

const TradeAlertSchema = z.object({
    symbol: z.string(),
    direction: z.enum(['COMPRA', 'VENDA']),
    entryPrice: z.number(),
    stopLoss: z.number(),
    takeProfit1: z.number(),
    takeProfit2: z.number(),
    takeProfit3: z.number(),
    riskReward: z.number(),
    confidence: z.number(),
    score: z.number(),
    volumeRatio: z.number(),
    buyerPercentage: z.number(),
    sellerPercentage: z.number(),
    lsr: z.number().optional().nullable(),
    funding: z.number().optional().nullable(),
    rsi: z.number().optional().nullable(),
    cciDaily: z.string().optional().nullable(),
    support: z.number(),
    resistance: z.number(),
    emoji: z.string(),
    timestamp: z.number(),
    volatility: z.object({
        level: z.string(),
        atrPercent: z.number(),
        isExpanding: z.boolean()
    }).optional(),
    marketTrend: z.string().optional(),
    emaAlignment: z.object({
        isBullish: z.boolean(),
        isBearish: z.boolean(),
        strength: z.string()
    }).optional()
});

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';
const ALERTS_DIR = './alerts';

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(ALERTS_DIR)) fs.mkdirSync(ALERTS_DIR, { recursive: true });

// =====================================================================
// === SISTEMA DE LIMPEZA AUTOMÁTICA ===
// =====================================================================
class CleanupManager {
    constructor() {
        this.cleanupInterval = null;
        this.totalCleaned = 0;
        this.lastCleanupTime = null;
    }

    start() {
        if (!CONFIG.CLEANUP.ENABLED) {
            console.log('🧹 Sistema de limpeza automática DESATIVADO');
            return;
        }

        console.log('🧹 Iniciando sistema de limpeza automática...');
        console.log(`   - Logs: manter últimos ${CONFIG.CLEANUP.MAX_LOG_AGE_HOURS}h`);
        console.log(`   - Cache: manter últimos ${CONFIG.CLEANUP.MAX_CACHE_AGE_HOURS}h`);
        console.log(`   - Alertas: manter últimos ${CONFIG.CLEANUP.MAX_ALERT_FILES_AGE_HOURS}h`);
        console.log(`   - Limpeza a cada: ${CONFIG.CLEANUP.CLEANUP_INTERVAL_MINUTES}min`);
        
        setTimeout(() => this.cleanup(), 5000);
        
        this.cleanupInterval = setInterval(
            () => this.cleanup(), 
            CONFIG.CLEANUP.CLEANUP_INTERVAL_MINUTES * 60 * 1000
        );
    }

    async cleanup() {
        const startTime = Date.now();
        this.lastCleanupTime = new Date();
        
        console.log(`\n🧹 Iniciando limpeza automática - ${getBrazilianDateTime().full}`);
        
        let cleanedCount = 0;
        let cleanedSize = 0;
        let errors = [];

        try {
            const logResult = this.cleanupDirectory(LOG_DIR, CONFIG.CLEANUP.MAX_LOG_AGE_HOURS);
            cleanedCount += logResult.count;
            cleanedSize += logResult.size;

            const cacheResult = this.cleanupDirectory(CACHE_DIR, CONFIG.CLEANUP.MAX_CACHE_AGE_HOURS);
            cleanedCount += cacheResult.count;
            cleanedSize += cacheResult.size;

            const alertResult = this.cleanupDirectory(ALERTS_DIR, CONFIG.CLEANUP.MAX_ALERT_FILES_AGE_HOURS);
            cleanedCount += alertResult.count;
            cleanedSize += alertResult.size;

            const tempResult = this.cleanupTempFiles();
            cleanedCount += tempResult.count;
            cleanedSize += tempResult.size;

            const sizeCheckResult = await this.checkFolderSize();
            if (sizeCheckResult.cleaned > 0) {
                cleanedCount += sizeCheckResult.count;
                cleanedSize += sizeCheckResult.size;
            }

            this.totalCleaned += cleanedCount;

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            
            if (cleanedCount > 0) {
                console.log(`✅ Limpeza concluída em ${duration}s`);
                console.log(`   - Arquivos removidos: ${cleanedCount}`);
                console.log(`   - Espaço liberado: ${(cleanedSize / (1024 * 1024)).toFixed(2)} MB`);
                console.log(`   - Total já limpo: ${this.totalCleaned} arquivos`);
            } else {
                console.log(`✅ Limpeza concluída em ${duration}s - Nenhum arquivo antigo encontrado`);
            }

            this.logCleanup(cleanedCount, cleanedSize, duration, errors);

        } catch (error) {
            console.error('❌ Erro durante limpeza:', error.message);
            errors.push(error.message);
        }
    }

    cleanupDirectory(dirPath, maxAgeHours) {
        const result = { count: 0, size: 0 };
        
        if (!fs.existsSync(dirPath)) return result;

        try {
            const files = fs.readdirSync(dirPath);
            const now = Date.now();
            const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

            files.forEach(file => {
                const filePath = path.join(dirPath, file);
                
                try {
                    const stats = fs.statSync(filePath);
                    
                    if (stats.isFile()) {
                        const fileAge = now - stats.mtimeMs;
                        
                        if (fileAge > maxAgeMs) {
                            const fileSize = stats.size;
                            fs.unlinkSync(filePath);
                            result.count++;
                            result.size += fileSize;
                            
                            if (CONFIG.DEBUG.VERBOSE) {
                                console.log(`   🗑️ Removido: ${file} (${(fileSize / 1024).toFixed(1)} KB)`);
                            }
                        }
                    }
                } catch (err) {
                    // Ignorar erros de arquivos individuais
                }
            });
        } catch (err) {
            console.error(`   ⚠️ Erro ao ler diretório ${dirPath}:`, err.message);
        }

        return result;
    }

    cleanupTempFiles() {
        const result = { count: 0, size: 0 };
        
        try {
            const files = fs.readdirSync('.');
            
            files.forEach(file => {
                if (file.includes('tmp') || file.includes('temp') || 
                    (file.includes('.log.') && file !== 'system.log')) {
                    try {
                        const stats = fs.statSync(file);
                        if (stats.isFile()) {
                            if (Date.now() - stats.mtimeMs > 3600000) {
                                const fileSize = stats.size;
                                fs.unlinkSync(file);
                                result.count++;
                                result.size += fileSize;
                            }
                        }
                    } catch (err) {
                        // Ignorar erros
                    }
                }
            });
        } catch (err) {
            // Ignorar erros
        }

        return result;
    }

    async checkFolderSize() {
        const result = { count: 0, size: 0, cleaned: 0 };
        const maxSizeBytes = CONFIG.CLEANUP.MAX_FOLDER_SIZE_MB * 1024 * 1024;

        try {
            let totalSize = 0;
            const allFiles = [];

            [LOG_DIR, CACHE_DIR, ALERTS_DIR].forEach(dir => {
                if (fs.existsSync(dir)) {
                    const files = fs.readdirSync(dir);
                    files.forEach(file => {
                        const filePath = path.join(dir, file);
                        try {
                            const stats = fs.statSync(filePath);
                            if (stats.isFile()) {
                                totalSize += stats.size;
                                allFiles.push({
                                    path: filePath,
                                    size: stats.size,
                                    mtime: stats.mtimeMs
                                });
                            }
                        } catch (err) {}
                    });
                }
            });

            if (totalSize > maxSizeBytes) {
                console.log(`   ⚠️ Espaço total (${(totalSize / (1024*1024)).toFixed(2)} MB) excede limite de ${CONFIG.CLEANUP.MAX_FOLDER_SIZE_MB} MB`);
                
                allFiles.sort((a, b) => a.mtime - b.mtime);
                
                for (const file of allFiles) {
                    if (totalSize <= maxSizeBytes) break;
                    
                    try {
                        fs.unlinkSync(file.path);
                        totalSize -= file.size;
                        result.count++;
                        result.size += file.size;
                        result.cleaned++;
                    } catch (err) {}
                }
                
                console.log(`   🗑️ Removidos ${result.count} arquivos antigos para liberar espaço`);
            }
        } catch (err) {
            console.error('   ⚠️ Erro ao verificar tamanho da pasta:', err.message);
        }

        return result;
    }

    logCleanup(count, size, duration, errors) {
        try {
            const logEntry = {
                timestamp: Date.now(),
                datetime: getBrazilianDateTime().full,
                filesRemoved: count,
                spaceFreedMB: (size / (1024 * 1024)).toFixed(2),
                durationSeconds: duration,
                errors: errors.length ? errors : undefined,
                totalCleaned: this.totalCleaned
            };

            const logFile = path.join(LOG_DIR, 'cleanup.log');
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            // Ignorar erros de log
        }
    }

    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('🧹 Sistema de limpeza automática interrompido');
        }
    }
}

const cleanupManager = new CleanupManager();

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const candleCache = new Map();
const alertCooldown = new Map();
const lastAlertPrices = new Map();
const fundingRateCache = new Map();
const dailyMessageCounter = new Map();
let dailyResetPerformed = false;

class CacheManager {
    static get(symbol, timeframe, limit) {
        const key = `${symbol}_${timeframe}_${limit}`;
        const cached = candleCache.get(key);
        if (cached && Date.now() - cached.timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            return cached.data;
        }
        return null;
    }

    static set(symbol, timeframe, limit, data) {
        const key = `${symbol}_${timeframe}_${limit}`;
        candleCache.set(key, { data, timestamp: Date.now() });
    }
}

// =====================================================================
// === RATE LIMITER MELHORADO ===
// =====================================================================
class RateLimiter {
    constructor() {
        this.currentDelay = CONFIG.RATE_LIMITER.INITIAL_DELAY;
        this.consecutiveErrors = 0;
        this.lastRequestTime = 0;
        this.requestCount = 0;
        this.minuteRequests = 0;
        this.lastMinuteReset = Date.now();
        this.errorLog = new Map();
    }

    checkRateLimit() {
        const now = Date.now();
        if (now - this.lastMinuteReset > 60000) {
            this.minuteRequests = 0;
            this.lastMinuteReset = now;
        }
        
        if (this.minuteRequests >= 1000) {
            const waitTime = 60000 - (now - this.lastMinuteReset);
            if (waitTime > 0) {
                console.log(`⏳ Rate limit atingido, aguardando ${Math.ceil(waitTime/1000)}s`);
                return waitTime;
            }
        }
        return 0;
    }

    async makeRequest(url, options = {}, type = 'klines') {
        const rateLimitWait = this.checkRateLimit();
        if (rateLimitWait > 0) {
            await new Promise(r => setTimeout(r, rateLimitWait));
        }

        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.currentDelay) {
            await new Promise(r => setTimeout(r, this.currentDelay - timeSinceLastRequest));
        }

        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);

                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                
                this.lastRequestTime = Date.now();
                this.minuteRequests++;
                this.requestCount++;

                if (!response.ok) {
                    if (response.status === 429) {
                        const retryAfter = response.headers.get('retry-after') || 60;
                        console.log(`⏳ Rate limit 429, aguardando ${retryAfter}s`);
                        await new Promise(r => setTimeout(r, retryAfter * 1000));
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }
                
                this.consecutiveErrors = 0;
                this.currentDelay = Math.max(CONFIG.RATE_LIMITER.INITIAL_DELAY, this.currentDelay * 0.9);
                
                return await response.json();
                
            } catch (error) {
                lastError = error;
                this.consecutiveErrors++;
                
                if (error.name === 'AbortError') {
                    console.log(`⏱️ Timeout na requisição ${type} (tentativa ${attempt}/${maxRetries})`);
                } else {
                    console.log(`⚠️ Erro na requisição ${type} (tentativa ${attempt}/${maxRetries}): ${error.message}`);
                }
                
                if (attempt < maxRetries) {
                    const waitTime = this.currentDelay * Math.pow(2, attempt - 1);
                    console.log(`⏳ Aguardando ${Math.ceil(waitTime/1000)}s antes de tentar novamente...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }
            }
        }
        
        this.currentDelay = Math.min(CONFIG.RATE_LIMITER.MAX_DELAY, this.currentDelay * CONFIG.RATE_LIMITER.BACKOFF_FACTOR);
        throw lastError;
    }
}

const rateLimiter = new RateLimiter();

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    const fullTime = brazilTime.toISOString().split('T')[1].split('.')[0];
    return { date, time, full: `${date} ${time}`, fullTime };
}

function formatNumber(num, decimals = 2) {
    if (num === undefined || num === null) return 'N/A';
    if (Math.abs(num) > 1000) return num.toFixed(decimals);
    if (Math.abs(num) > 1) return num.toFixed(decimals);
    return num.toFixed(decimals);
}

function formatPrice(price) {
    if (!price) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(3);
    if (price > 0.1) return price.toFixed(4);
    if (price > 0.01) return price.toFixed(5);
    if (price > 0.001) return price.toFixed(6);
    return price.toFixed(8);
}

function getConfidenceEmoji(score) {
    if (score >= 95) return '🔥🔥🔥';
    if (score >= 90) return '🔥🔥';
    if (score >= 85) return '🔥';
    if (score >= 80) return '⚡';
    if (score >= 75) return '✅';
    if (score >= 70) return '⚠️';
    return '📊';
}

function getDirectionEmoji(direction) {
    return direction === 'COMPRA' ? '🟢' : '🔴';
}

function getVolatilityEmoji(level) {
    switch(level) {
        case 'BAIXA': return '🐢';
        case 'MEDIA': return '⚖️';
        case 'ALTA': return '🌊';
        default: return '📊';
    }
}

function getAlignmentEmoji(alignment) {
    if (alignment.isBullish && alignment.strength === 'FORTE') return '💹💹';
    if (alignment.isBullish) return '💹';
    if (alignment.isBearish && alignment.strength === 'FORTE') return '📉📉';
    if (alignment.isBearish) return '📉';
    return '🔄';
}

// =====================================================================
// === RESET CONTADOR DIÁRIO ===
// =====================================================================
function resetDailyCounterIfNeeded() {
    const now = getBrazilianDateTime();
    const currentHour = parseInt(now.fullTime.split(':')[0]);
    
    if (currentHour === 21 && !dailyResetPerformed) {
        const totalReset = dailyMessageCounter.size;
        dailyMessageCounter.clear();
        dailyResetPerformed = true;
        console.log(`🔄 Contadores diários resetados às 21:00 - ${totalReset} moedas com alertas hoje`);
        
        if (CONFIG.DEBUG.VERBOSE) {
            console.log('📊 Status do reset diário:', {
                hora: currentHour,
                resetPerformed: dailyResetPerformed,
                contadoresResetados: totalReset
            });
        }
    }
    
    if (currentHour !== 21) {
        dailyResetPerformed = false;
    }
}

// =====================================================================
// === VERIFICAR LIMITE DIÁRIO POR MOEDA ===
// =====================================================================
function canSendDailyAlert(symbol) {
    resetDailyCounterIfNeeded();
    
    const currentCount = dailyMessageCounter.get(symbol) || 0;
    const maxDaily = CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL;
    
    if (currentCount >= maxDaily) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⏸️ ${symbol} já recebeu ${currentCount}/${maxDaily} alertas hoje - limite diário atingido`);
        }
        return false;
    }
    
    return true;
}

// =====================================================================
// === CÁLCULOS TÉCNICOS AVANÇADOS ===
// =====================================================================
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

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const tr = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        tr.push(Math.max(tr1, tr2, tr3));
    }
    
    const atr = tr.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
}

function calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const closes = candles.map(c => c.close);
    let gains = 0, losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period || 0.001;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateCCI(candles, period = 20) {
    if (candles.length < period) return null;
    
    const typ = [];
    for (let i = 0; i < candles.length; i++) {
        typ.push((candles[i].high + candles[i].low + candles[i].close) / 3);
    }
    
    const recentTyp = typ.slice(-period);
    const sma = recentTyp.reduce((a, b) => a + b, 0) / period;
    
    let meanDeviation = 0;
    for (let i = 0; i < recentTyp.length; i++) {
        meanDeviation += Math.abs(recentTyp[i] - sma);
    }
    meanDeviation = meanDeviation / period;
    
    if (meanDeviation === 0) return 0;
    
    const cci = (recentTyp[recentTyp.length - 1] - sma) / (0.015 * meanDeviation);
    return cci;
}

function calculateSupportResistance(candles) {
    if (candles.length < 50) return { support: null, resistance: null };
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const pivotHighs = [];
    const pivotLows = [];
    
    for (let i = 2; i < highs.length - 2; i++) {
        if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
            highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
            pivotHighs.push(highs[i]);
        }
        if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
            lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
            pivotLows.push(lows[i]);
        }
    }
    
    const resistance = pivotHighs.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, pivotHighs.length);
    const support = pivotLows.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, pivotLows.length);
    
    return { 
        support: support || lows[lows.length - 1] * 0.98, 
        resistance: resistance || highs[highs.length - 1] * 1.02 
    };
}

// =====================================================================
// === NOVA FUNÇÃO: DETECTAR ESTRUTURA DE MERCADO COM EMAS 13,34,55,233 ===
// =====================================================================
function detectMarketStructure(candles) {
    if (candles.length < 250) return null;
    
    const closes = candles.map(c => c.close);
    const currentPrice = closes[closes.length - 1];
    
    // Calcular as 4 EMAs
    const ema13 = calculateEMA(closes, CONFIG.EMA.FAST);    // Micro tendência
    const ema34 = calculateEMA(closes, CONFIG.EMA.MEDIUM);  // Tendência curta
    const ema55 = calculateEMA(closes, CONFIG.EMA.SLOW);    // Tendência média
    const ema233 = calculateEMA(closes, CONFIG.EMA.MACRO);  // Macro tendência
    
    // Verificar alinhamento das EMAs
    const bullishAlignment = ema13 > ema34 && ema34 > ema55 && ema55 > ema233;
    const bearishAlignment = ema13 < ema34 && ema34 < ema55 && ema55 < ema233;
    
    // Determinar força do alinhamento
    let alignmentStrength = 'FRACO';
    if (bullishAlignment || bearishAlignment) {
        // Verificar distância entre as EMAs (quanto maior a distância, mais forte)
        const spread = Math.abs(ema13 - ema233) / currentPrice * 100;
        alignmentStrength = spread > 5 ? 'FORTE' : 'MÉDIO';
    }
    
    // Determinar tendência baseada nas EMAs
    let trend = 'NEUTRO';
    let trendStrength = 0;
    
    if (ema13 > ema34 && currentPrice > ema13) {
        trend = 'ALTA';
        trendStrength = currentPrice > ema233 ? 2 : 1;
    } else if (ema13 < ema34 && currentPrice < ema13) {
        trend = 'BAIXA';
        trendStrength = currentPrice < ema233 ? 2 : 1;
    }
    
    // Calcular score de alinhamento
    let alignmentScore = 50;
    
    // CAMADA 1: Micro tendência (EMA 13)
    if (currentPrice > ema13) alignmentScore += CONFIG.SCORING.MOMENTUM_BONUS;
    else alignmentScore -= 5;
    
    // CAMADA 2: Confirmação 1 (EMA 34)
    if (ema13 > ema34) alignmentScore += CONFIG.SCORING.FAST_CONFIRMATION;
    else alignmentScore -= 8;
    
    // CAMADA 3: Tendência principal (EMA 55)
    if (ema34 > ema55) alignmentScore += CONFIG.SCORING.TREND_CONFIRMATION;
    else alignmentScore -= 10;
    
    // CAMADA 4: Contexto macro (EMA 233)
    if (currentPrice > ema233) {
        if (trend === 'ALTA') {
            alignmentScore += CONFIG.SCORING.MACRO_CONFIRMATION;
            trendStrength = 2;
        }
    } else {
        if (trend === 'ALTA') {
            alignmentScore += CONFIG.SCORING.MACRO_PENALTY;
            trendStrength = 0;
        }
    }
    
    // Bônus por alinhamento perfeito
    if (bullishAlignment || bearishAlignment) {
        alignmentScore += CONFIG.SCORING.ALIGNMENT_BONUS;
    }
    
    return {
        trend,
        trendStrength,
        ema13,
        ema34,
        ema55,
        ema233,
        alignment: {
            isBullish: bullishAlignment,
            isBearish: bearishAlignment,
            strength: alignmentStrength,
            score: alignmentScore
        },
        currentPrice
    };
}

// =====================================================================
// === NOVA FUNÇÃO: VALIDAR ENTRADA COM EMAS ===
// =====================================================================
function validateWithEMAs(alert, marketStructure) {
    const { alignment, trend } = marketStructure;
    const { direction } = alert;
    
    // REGRA 1: Não entrar contra alinhamento forte
    if (alignment.isBullish && direction === 'VENDA' && alignment.strength === 'FORTE') {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⛔ ${alert.symbol}: Tentativa de venda com EMAs fortemente alinhadas para alta`);
        }
        return false;
    }
    
    if (alignment.isBearish && direction === 'COMPRA' && alignment.strength === 'FORTE') {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⛔ ${alert.symbol}: Tentativa de compra com EMAs fortemente alinhadas para baixa`);
        }
        return false;
    }
    
    // REGRA 2: Verificar consistência com tendência
    if (direction === 'COMPRA' && trend === 'BAIXA' && alignment.strength !== 'FRACO') {
        alert.confidence += CONFIG.SCORING.TRADE_PENALTY;
        if (alert.confidence < CONFIG.ALERTS.MIN_SCORE) {
            return false;
        }
    }
    
    if (direction === 'VENDA' && trend === 'ALTA' && alignment.strength !== 'FRACO') {
        alert.confidence += CONFIG.SCORING.TRADE_PENALTY;
        if (alert.confidence < CONFIG.ALERTS.MIN_SCORE) {
            return false;
        }
    }
    
    // REGRA 3: Bônus por alinhamento
    if ((direction === 'COMPRA' && alignment.isBullish) ||
        (direction === 'VENDA' && alignment.isBearish)) {
        
        if (alignment.strength === 'FORTE') {
            alert.confidence += 15;
            alert.riskReward *= CONFIG.RISK_MANAGEMENT.STRONG_TREND_MULTIPLIER;
            alert.emoji = '🔥🔥🔥';
        } else {
            alert.confidence += 8;
            alert.riskReward *= 1.1;
        }
    }
    
    return true;
}

// =====================================================================
// === NOVA FUNÇÃO: CALCULAR STOP COM EMAS ===
// =====================================================================
function calculateStopWithEMAs(price, direction, marketStructure, atr, volatility) {
    const { ema13, ema34, ema55, ema233, alignment } = marketStructure;
    
    let stopPrice;
    let stopDistance;
    
    if (direction === 'COMPRA') {
        // Coletar todas as EMAs abaixo do preço
        const emasBelow = [];
        if (ema13 < price) emasBelow.push({ value: ema13, period: 13 });
        if (ema34 < price) emasBelow.push({ value: ema34, period: 34 });
        if (ema55 < price) emasBelow.push({ value: ema55, period: 55 });
        if (ema233 < price) emasBelow.push({ value: ema233, period: 233 });
        
        if (emasBelow.length > 0) {
            // Ordenar por valor (maior para menor)
            emasBelow.sort((a, b) => b.value - a.value);
            
            // Usar a EMA mais próxima como stop base
            stopPrice = emasBelow[0].value;
            
            // Ajustar baseado na quantidade de EMAs abaixo
            if (emasBelow.length >= 3) {
                // Muitas EMAs abaixo = tendência forte, stop mais largo
                const atrAdjustment = atr * 0.5;
                stopPrice = Math.max(stopPrice - atrAdjustment, emasBelow[1]?.value || stopPrice);
            }
            
            // Ajuste por volatilidade
            if (volatility.isExpanding) {
                stopPrice -= atr * 0.3;
            }
            
            // Não deixar stop muito distante
            const maxStopDistance = price * (CONFIG.RISK_MANAGEMENT.MAX_STOP_DISTANCE_PERCENT / 100);
            stopPrice = Math.max(stopPrice, price - maxStopDistance);
            
        } else {
            // Fallback: usar ATR
            stopPrice = price - (atr * 2);
        }
        
    } else {
        // Para VENDA
        const emasAbove = [];
        if (ema13 > price) emasAbove.push({ value: ema13, period: 13 });
        if (ema34 > price) emasAbove.push({ value: ema34, period: 34 });
        if (ema55 > price) emasAbove.push({ value: ema55, period: 55 });
        if (ema233 > price) emasAbove.push({ value: ema233, period: 233 });
        
        if (emasAbove.length > 0) {
            emasAbove.sort((a, b) => a.value - b.value);
            stopPrice = emasAbove[0].value;
            
            if (emasAbove.length >= 3) {
                const atrAdjustment = atr * 0.5;
                stopPrice = Math.min(stopPrice + atrAdjustment, emasAbove[1]?.value || stopPrice);
            }
            
            if (volatility.isExpanding) {
                stopPrice += atr * 0.3;
            }
            
            const maxStopDistance = price * (CONFIG.RISK_MANAGEMENT.MAX_STOP_DISTANCE_PERCENT / 100);
            stopPrice = Math.min(stopPrice, price + maxStopDistance);
            
        } else {
            stopPrice = price + (atr * 2);
        }
    }
    
    return stopPrice;
}

// =====================================================================
// === ANÁLISE DE VOLATILIDADE AVANÇADA ===
// =====================================================================
function calculateVolatilityProfile(candles) {
    if (candles.length < 50) return null;
    
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const currentPrice = candles[candles.length - 1].close;
    
    // 1. ATR percentual
    const atr = calculateATR(candles, 14);
    const atrPercent = (atr / currentPrice) * 100;
    
    // 2. Desvio padrão dos retornos
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
        returns.push((closes[i] - closes[i-1]) / closes[i-1] * 100);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // 3. Range média percentual
    const avgRange = highs.map((h, i) => ((h - lows[i]) / closes[i]) * 100)
                          .reduce((a, b) => a + b, 0) / highs.length;
    
    // 4. Detectar expansão/contração
    const recentATR = calculateATR(candles.slice(-20), 14);
    const recentATRPercent = (recentATR / currentPrice) * 100;
    const atrExpansion = recentATRPercent / atrPercent;
    
    // 5. Classificar volatilidade
    let volatilityLevel = 'MEDIA';
    if (atrPercent < 1) volatilityLevel = 'BAIXA';
    else if (atrPercent > 2) volatilityLevel = 'ALTA';
    
    return {
        atrPercent,
        stdDev,
        avgRange,
        atrExpansion,
        volatilityLevel,
        isExpanding: atrExpansion > 1.2,
        isContracting: atrExpansion < 0.8
    };
}

// =====================================================================
// === TAKE PROFIT DINÂMICO ===
// =====================================================================
function calculateDynamicTakeProfits(price, stopLoss, direction, volatility, marketStructure) {
    const risk = Math.abs(price - stopLoss);
    
    // Multiplicador base
    let baseMultiplier = CONFIG.TRADE.RISK_REWARD_RATIO;
    
    // Ajustar por volatilidade
    if (volatility.volatilityLevel === 'ALTA') {
        baseMultiplier *= 1.3;
    } else if (volatility.volatilityLevel === 'BAIXA') {
        baseMultiplier *= 0.8;
    }
    
    // Ajustar por força da tendência
    if (marketStructure.trendStrength === 2) {
        baseMultiplier *= CONFIG.RISK_MANAGEMENT.STRONG_TREND_MULTIPLIER;
    } else if (marketStructure.trendStrength === 0) {
        baseMultiplier *= CONFIG.RISK_MANAGEMENT.WEAK_TREND_MULTIPLIER;
    }
    
    // Calcular TPs
    const tp1 = direction === 'COMPRA'
        ? price + (risk * baseMultiplier)
        : price - (risk * baseMultiplier);
    
    const tp2 = direction === 'COMPRA'
        ? price + (risk * baseMultiplier * 1.8)
        : price - (risk * baseMultiplier * 1.8);
    
    const tp3 = direction === 'COMPRA'
        ? price + (risk * baseMultiplier * 2.5)
        : price - (risk * baseMultiplier * 2.5);
    
    return {
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        riskReward: baseMultiplier
    };
}

// =====================================================================
// === VALIDAÇÃO DE ENTRADA COM VOLUME ===
// =====================================================================
function validateEntryWithVolume(alert, candles) {
    if (!CONFIG.RISK_MANAGEMENT.USE_VOLATILITY_FILTER) return true;
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prev5Candles = candles.slice(-6, -1);
    
    // Volume deve estar crescendo
    const volumeIncreasing = lastCandle.volume > prevCandle.volume * CONFIG.RISK_MANAGEMENT.MIN_VOLUME_CONFIRMATION;
    
    // Volume atual vs média
    const avgVolume = prev5Candles.reduce((sum, c) => sum + c.volume, 0) / 5;
    const volumeSpike = lastCandle.volume > avgVolume * 1.5;
    
    // Confirmação do candle
    let candleConfirms = false;
    if (alert.direction === 'COMPRA') {
        candleConfirms = lastCandle.close > lastCandle.open;
        if (lastCandle.close > lastCandle.open * 1.02 && volumeSpike) {
            alert.confidence += 8;
        }
    } else {
        candleConfirms = lastCandle.close < lastCandle.open;
        if (lastCandle.close < lastCandle.open * 0.98 && volumeSpike) {
            alert.confidence += 8;
        }
    }
    
    // Penalizar se volume não confirmar
    if (!volumeIncreasing) {
        alert.confidence -= 12;
    }
    
    return alert.confidence >= CONFIG.ALERTS.MIN_SCORE;
}

// =====================================================================
// === COOLDOWN CHECK ===
// =====================================================================
function canSendAlert(symbol, currentPrice, direction) {
    const now = Date.now();
    const cooldownKey = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    
    const lastAlert = alertCooldown.get(cooldownKey);
    if (lastAlert) {
        const timeDiff = (now - lastAlert) / (1000 * 60);
        if (timeDiff < CONFIG.PERFORMANCE.COOLDOWN_MINUTES) {
            if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⏸️ ${symbol} em cooldown por mais ${(CONFIG.PERFORMANCE.COOLDOWN_MINUTES - timeDiff).toFixed(1)}min`);
            }
            return false;
        }
    }
    
    const lastPrice = lastAlertPrices.get(priceKey);
    if (lastPrice) {
        const priceDiff = Math.abs((currentPrice - lastPrice) / lastPrice * 100);
        if (priceDiff < CONFIG.PERFORMANCE.PRICE_DEVIATION_THRESHOLD) {
            if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⏸️ ${symbol} preço variou apenas ${priceDiff.toFixed(2)}% (mínimo ${CONFIG.PERFORMANCE.PRICE_DEVIATION_THRESHOLD}%)`);
            }
            return false;
        }
    }
    
    if (!canSendDailyAlert(symbol)) {
        return false;
    }
    
    return true;
}

function registerAlert(symbol, price, direction) {
    const now = Date.now();
    const cooldownKey = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    
    alertCooldown.set(cooldownKey, now);
    lastAlertPrices.set(priceKey, price);
    
    const currentCount = dailyMessageCounter.get(symbol) || 0;
    const newCount = currentCount + 1;
    dailyMessageCounter.set(symbol, newCount);
    
    console.log(`📊 ${symbol}: ${newCount}/${CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL} alerta(s) hoje`);
    
    for (const [key, timestamp] of alertCooldown) {
        if (now - timestamp > 2 * 60 * 60 * 1000) {
            alertCooldown.delete(key);
        }
    }
}

// =====================================================================
// === FETCH DE DADOS ===
// =====================================================================
async function getCandles(symbol, timeframe, limit = 100) {
    const cached = CacheManager.get(symbol, timeframe, limit);
    if (cached) return cached;

    const intervalMap = {
        '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d'
    };
    
    const interval = intervalMap[timeframe] || '1h';
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    try {
        const data = await rateLimiter.makeRequest(url, {}, 'klines');
        
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
        
        CacheManager.set(symbol, timeframe, limit, candles);
        return candles;
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao buscar candles ${symbol}: ${error.message}`);
        }
        return [];
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'lsr');
        return data.length > 0 ? parseFloat(data[0].longShortRatio) : null;
    } catch {
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const cached = fundingRateCache.get(symbol);
        if (cached && Date.now() - cached.timestamp < 3600000) {
            return cached.rate;
        }

        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const data = await rateLimiter.makeRequest(url, {}, 'funding');
        
        let fundingRate = parseFloat(data.lastFundingRate) || null;
        
        if (CONFIG.DEBUG.VERBOSE && fundingRate !== null) {
            console.log(`💰 Funding ${symbol}: ${(fundingRate * 100).toFixed(4)}%`);
        }
        
        if (fundingRate !== null) {
            fundingRateCache.set(symbol, {
                rate: fundingRate,
                timestamp: Date.now()
            });
        }
        
        return fundingRate;
        
    } catch (error) {
        try {
            const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
            const data = await rateLimiter.makeRequest(url, {}, 'funding_alt');
            const fundingRate = data.length > 0 ? parseFloat(data[0].fundingRate) : null;
            
            if (fundingRate !== null) {
                fundingRateCache.set(symbol, {
                    rate: fundingRate,
                    timestamp: Date.now()
                });
            }
            
            return fundingRate;
        } catch {
            return null;
        }
    }
}

// =====================================================================
// === ANÁLISE PRINCIPAL (ATUALIZADA COM EMAS 13,34,55,233) ===
// =====================================================================
async function analyzeForAlerts(symbol) {
    try {
        const [candles1h, candles15m, candlesDaily] = await Promise.all([
            getCandles(symbol, '1h', 300), // Aumentado para ter dados suficientes para EMA 233
            getCandles(symbol, '15m', 50),
            getCandles(symbol, '1d', 50)
        ]);
        
        if (candles1h.length < 250 || candles15m.length < 20 || candlesDaily.length < 25) return null;
        
        const currentPrice = candles1h[candles1h.length - 1].close;
        
        // Análises técnicas básicas
        const volumes = candles1h.map(c => c.volume);
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        
        const closes = candles1h.map(c => c.close);
        const ema9 = calculateEMA(closes.slice(-20), 9);
        
        // Análise de comprador/vendedor
        let buyerVolume = 0, sellerVolume = 0, totalVolume = 0;
        const recentCandles = candles1h.slice(-24);
        
        recentCandles.forEach(candle => {
            const vol = candle.volume;
            totalVolume += vol;
            
            if (candle.close > ema9) {
                buyerVolume += vol;
            } else if (candle.close < ema9) {
                sellerVolume += vol;
            } else {
                buyerVolume += vol / 2;
                sellerVolume += vol / 2;
            }
        });
        
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 50;
        const sellerPercentage = 100 - buyerPercentage;
        
        // CCI Diário
        const cciDaily = calculateCCI(candlesDaily, 20);
        const cciValuesDaily = [];
        for (let i = candlesDaily.length - 26; i < candlesDaily.length; i++) {
            const slice = candlesDaily.slice(0, i + 1);
            cciValuesDaily.push(calculateCCI(slice, 20) || 0);
        }
        const cciEma5 = cciValuesDaily.length >= 5 ? calculateEMA(cciValuesDaily, 5) : null;
        
        let cciDailyTrend = "NEUTRO";
        if (cciDaily !== null && cciEma5 !== null) {
            if (cciDaily > cciEma5) {
                cciDailyTrend = "CCI 💹ALTA";
            } else if (cciDaily < cciEma5) {
                cciDailyTrend = "CCI 🔴BAIXA";
            }
        }
        
        // Dados adicionais
        const [lsr, funding, rsi1h, sr, atr] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            Promise.resolve(calculateRSI(candles1h, CONFIG.RSI.PERIOD)),
            Promise.resolve(calculateSupportResistance(candles1h)),
            Promise.resolve(calculateATR(candles1h, 14))
        ]);
        
        if (!sr.support || !sr.resistance || !atr || rsi1h === null) return null;
        
        // Análises avançadas
        const volatility = calculateVolatilityProfile(candles1h);
        const marketStructure = detectMarketStructure(candles1h);
        
        if (!volatility || !marketStructure) return null;
        
        // Determinar direção
        let direction = null;
        let score = 50;
        let confidence = 0;
        
        // ANÁLISE PARA COMPRA
        if (buyerPercentage > CONFIG.VOLUME.BUYER_THRESHOLD && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h < CONFIG.RSI.BUY_MAX) {
            
            direction = 'COMPRA';
            
            // Volume comprador
            if (buyerPercentage > 60) score += 15;
            else if (buyerPercentage > 55) score += 10;
            else if (buyerPercentage > 52) score += 5;
            
            // Volume ratio
            if (volumeRatio > 2.5) score += 15;
            else if (volumeRatio > 2.0) score += 12;
            else if (volumeRatio > 1.8) score += 10;
            else if (volumeRatio > 1.6) score += 8;
            
            // LSR
            if (lsr) {
                if (lsr < 1.5) score += 20;
                else if (lsr < 2.0) score += 12;
                else if (lsr < 2.3) score += 10;
                else if (lsr < 2.6) score += 5;
                else if (lsr > 3.0) score -= 20;
                else if (lsr > 2.8) score -= 15;
            }
            
            // Funding
            if (funding) {
                if (funding < -0.001) score += 12;
                else if (funding < -0.0005) score += 8;
                else if (funding < -0.0001) score += 3;
            }
            
            // RSI
            if (rsi1h) {
                if (rsi1h < 35) score += 12;
                else if (rsi1h < 40) score += 10;
                else if (rsi1h < 45) score += 8;
                else if (rsi1h < 50) score += 5;
            }
            
            // CCI Diário
            if (cciDailyTrend) {
                if (cciDailyTrend === "CCI 💹ALTA") score += 10;
                else if (cciDailyTrend === "CCI 🔴BAIXA") score -= 15;
            }
            
            // Volatilidade
            if (volatility.volatilityLevel === 'BAIXA') score += 8;
            else if (volatility.volatilityLevel === 'ALTA') score -= 5;
            
            confidence = Math.min(100, Math.max(0, score));
        }
        
        // ANÁLISE PARA VENDA
        if (sellerPercentage > (100 - CONFIG.VOLUME.SELLER_THRESHOLD) && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h > CONFIG.RSI.SELL_MIN) {
            
            direction = 'VENDA';
            score = 50;
            
            // Volume vendedor
            if (sellerPercentage > 60) score += 15;
            else if (sellerPercentage > 55) score += 10;
            else if (sellerPercentage > 52) score += 5;
            
            // Volume ratio
            if (volumeRatio > 2.5) score += 15;
            else if (volumeRatio > 2.0) score += 12;
            else if (volumeRatio > 1.8) score += 10;
            else if (volumeRatio > 1.6) score += 8;
            
            // LSR
            if (lsr) {
                if (lsr > 4.0) score += 20;
                else if (lsr > 3.5) score += 12;
                else if (lsr > 3.0) score += 10;
                else if (lsr > 2.7) score += 5;
                else if (lsr < 1.0) score -= 20;
                else if (lsr < 1.2) score -= 15;
            }
            
            // Funding
            if (funding) {
                if (funding > 0.001) score += 12;
                else if (funding > 0.0005) score += 8;
                else if (funding > 0.0001) score += 3;
            }
            
            // RSI
            if (rsi1h) {
                if (rsi1h > 75) score += 12;
                else if (rsi1h > 70) score += 10;
                else if (rsi1h > 65) score += 8;
                else if (rsi1h > 60) score += 5;
            }
            
            // CCI Diário
            if (cciDailyTrend) {
                if (cciDailyTrend === "CCI 💹ALTA") score -= 15;
                else if (cciDailyTrend === "CCI 🔴BAIXA") score += 10;
            }
            
            // Volatilidade
            if (volatility.volatilityLevel === 'ALTA') score += 8;
            else if (volatility.volatilityLevel === 'BAIXA') score -= 5;
            
            confidence = Math.min(100, Math.max(0, score));
        }
        
        if (!direction || confidence < CONFIG.ALERTS.MIN_SCORE) return null;
        
        if (!canSendAlert(symbol, currentPrice, direction)) return null;
        
        // Criar alerta temporário para validações
        const tempAlert = { direction, confidence, symbol: symbol };
        
        // VALIDAÇÃO COM EMAS (NOVA)
        if (!validateWithEMAs(tempAlert, marketStructure)) {
            return null;
        }
        confidence = tempAlert.confidence;
        
        // Calcular Stop Loss usando EMAs
        const stopLoss = calculateStopWithEMAs(
            currentPrice,
            direction,
            marketStructure,
            atr,
            volatility
        );
        
        // Calcular Take Profits Dinâmicos
        const { takeProfit1, takeProfit2, takeProfit3, riskReward } = 
            calculateDynamicTakeProfits(currentPrice, stopLoss, direction, volatility, marketStructure);
        
        // Validar entrada com volume
        if (!validateEntryWithVolume(tempAlert, candles15m)) {
            return null;
        }
        confidence = tempAlert.confidence;
        
        const emoji = getConfidenceEmoji(confidence);
        const volEmoji = getVolatilityEmoji(volatility.volatilityLevel);
        const alignEmoji = getAlignmentEmoji(marketStructure.alignment);
        
        const alert = {
            symbol,
            direction,
            entryPrice: currentPrice,
            stopLoss,
            takeProfit1,
            takeProfit2,
            takeProfit3,
            riskReward: parseFloat(riskReward.toFixed(2)),
            confidence,
            score: confidence,
            volumeRatio,
            buyerPercentage,
            sellerPercentage,
            lsr,
            funding,
            rsi: rsi1h,
            cciDaily: cciDailyTrend,
            support: sr.support,
            resistance: sr.resistance,
            emoji: `${emoji} ${volEmoji} ${alignEmoji}`,
            timestamp: Date.now(),
            volatility: {
                level: volatility.volatilityLevel,
                atrPercent: volatility.atrPercent,
                isExpanding: volatility.isExpanding
            },
            marketTrend: marketStructure.trend,
            emaAlignment: marketStructure.alignment
        };
        
        try {
            TradeAlertSchema.parse(alert);
            return alert;
        } catch (error) {
            if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⚠️ Alerta inválido para ${symbol}:`, error.errors);
            }
            return null;
        }
        
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao analisar ${symbol}: ${error.message}`);
        }
        return null;
    }
}

// =====================================================================
// === TELEGRAM ===
// =====================================================================
async function sendTelegramAlert(message, parseMode = 'HTML') {
    let attempts = 0;
    const maxAttempts = CONFIG.PERFORMANCE.TELEGRAM_RETRY_ATTEMPTS;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            if (!CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) {
                console.log('⚠️ Telegram não configurado');
                return false;
            }

            const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CONFIG.TELEGRAM.CHAT_ID,
                    text: message,
                    parse_mode: parseMode,
                    disable_web_page_preview: true
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('retry-after')) || 30;
                    console.log(`⏳ Rate limit Telegram, aguardando ${retryAfter}s (tentativa ${attempts}/${maxAttempts})`);
                    await new Promise(r => setTimeout(r, retryAfter * 1000));
                    continue;
                }
                
                console.log(`❌ Erro Telegram (tentativa ${attempts}/${maxAttempts}): ${errorText}`);
                
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY * attempts));
                    continue;
                }
                
                return false;
            }
            
            return true;
            
        } catch (error) {
            console.log(`❌ Erro Telegram (tentativa ${attempts}/${maxAttempts}): ${error.message}`);
            
            if (attempts < maxAttempts) {
                console.log(`⏳ Tentando novamente em ${CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY/1000 * attempts}s...`);
                await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY * attempts));
            }
        }
    }
    
    console.log('❌ Todas as tentativas de envio ao Telegram falharam');
    return false;
}

function formatTradeAlert(alert) {
    const time = getBrazilianDateTime();
    const symbolName = alert.symbol.replace('USDT', '');
    const dirEmoji = getDirectionEmoji(alert.direction);
    const direction = alert.direction === 'COMPRA' ? 'Compra' : 'Correção';
    
    const volPct = alert.direction === 'COMPRA' ? 
        alert.buyerPercentage.toFixed(0) : alert.sellerPercentage.toFixed(0);
    
    const fundingPct = alert.funding ? (alert.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = alert.funding && alert.funding > 0 ? '+' : '';
    
    const entry = formatPrice(alert.entryPrice);
    const stop = formatPrice(alert.stopLoss);
    const tp1 = formatPrice(alert.takeProfit1);
    const tp2 = formatPrice(alert.takeProfit2);
    const tp3 = formatPrice(alert.takeProfit3);
    
    const dailyCount = dailyMessageCounter.get(alert.symbol) || 1;
    const maxDaily = CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL;
    
    let r1, r2, r3;
    if (alert.direction === 'COMPRA') {
        r1 = ((alert.takeProfit1 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
        r2 = ((alert.takeProfit2 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
        r3 = ((alert.takeProfit3 - alert.entryPrice) / (alert.entryPrice - alert.stopLoss) * 100).toFixed(0);
    } else {
        r1 = ((alert.entryPrice - alert.takeProfit1) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
        r2 = ((alert.entryPrice - alert.takeProfit2) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
        r3 = ((alert.entryPrice - alert.takeProfit3) / (alert.stopLoss - alert.entryPrice) * 100).toFixed(0);
    }
    
    const rsiStatus = alert.direction === 'COMPRA' ? 
        (alert.rsi < 45 ? '🚀' : alert.rsi < 55 ? '📈' : '⚖️') :
        (alert.rsi > 70 ? '💥' : alert.rsi > 60 ? '📉' : '⚖️');
    
    const volatilityInfo = `${alert.volatility?.level || 'MÉDIA'} ${alert.volatility?.isExpanding ? '📈' : '📉'}`;
    
    // Informações do alinhamento das EMAs
    let alignmentInfo = '';
    if (alert.emaAlignment) {
        if (alert.emaAlignment.isBullish) {
            alignmentInfo = alert.emaAlignment.strength === 'FORTE' ? '💹💹 ALINHADO FORTE' : '💹 ALINHADO';
        } else if (alert.emaAlignment.isBearish) {
            alignmentInfo = alert.emaAlignment.strength === 'FORTE' ? '📉📉 ALINHADO FORTE' : '📉 ALINHADO';
        } else {
            alignmentInfo = '🔄 MISTURADO';
        }
    }
    
    // Determinar emoji para a tendência
    const trendEmoji = alert.marketTrend === 'ALTA' ? '💹' : alert.marketTrend === 'BAIXA' ? '📛' : '⚪';
    const trendText = alert.marketTrend === 'ALTA' ? 'ALTA' : alert.marketTrend === 'BAIXA' ? 'BAIXA' : 'NEUTRO';
    
    const iaDica = alert.direction === 'COMPRA' 
        ? '<b>🤖 IA Dica,</b> Observar Zona do Suporte...\n🔸Volatilidade ' + volatilityInfo
        : '<b>🤖 IA Dica,</b> Realizar Lucro ou Parcial...\n🔸Volatilidade ' + volatilityInfo;
    
    return `<i><b>${dirEmoji} Analisar ${direction} - ${symbolName}</b>
    SENSORES: ${alert.emoji} 
 <b>🐋Volume!!!</b> | #SCORE: ${alert.confidence}%
 Alerta:${dailyCount} | ${time.full}hs
 💲Preço: $${entry}
 #RSI 1h: ${formatNumber(alert.rsi, 0)} ${rsiStatus} | #Vol: ${alert.volumeRatio.toFixed(2)}x (${volPct}%)
 #LSR: ${formatNumber(alert.lsr, 2)} | #Fund: ${fundingSign}${fundingPct}%
 Alinhamento : ${alignmentInfo}
 Tendência CCI Diário: ${trendEmoji} ${trendText} 
 #Supt: ${formatPrice(alert.support)} | #Resist: ${formatPrice(alert.resistance)}
<b>Alvos</b> | Volatilidade: ${volatilityInfo}
 TP1: ${tp1} | TP2: ${tp2}  | TP3: ${tp3} 
 🛑 Stop: ${stop} 
❅──────✧❅🔹❅✧──────❅
 ${iaDica}
Alerta Educativo, não é recomendação de investimento
 Titanium Prime by @J4Rviz</i>`;
}

// =====================================================================
// === FETCH SYMBOLS ===
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );
        
        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
            
        console.log(`📊 Encontrados ${symbols.length} símbolos USDT`);
        return symbols;
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT'];
    }
}

// =====================================================================
// === SCANNER EM TEMPO REAL ===
// =====================================================================
async function realTimeScanner() {
    console.log('\n🔍 Iniciando scanner em tempo real...');
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Monitorando ${symbols.length} símbolos continuamente`);
    console.log(`📊 Limite diário: ${CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL} alertas por moeda (reset às 21:00)`);
    console.log(`📊 Filtro RSI: Compra < ${CONFIG.RSI.BUY_MAX} | Venda > ${CONFIG.RSI.SELL_MIN}`);
    console.log(`📊 Sistema de EMAs: 13, 34, 55, 233 (Fibonacci + Macro)`);
    console.log(`📊 Stop Loss Inteligente: BASEADO NAS EMAS`);
    console.log(`📊 Take Profit Dinâmico: AJUSTADO POR ALINHAMENTO`);
    
    let scanCount = 0;
    let alertsSent = 0;
    let consecutiveEmptyScans = 0;
    let lastAlertTime = Date.now();
    
    while (true) {
        const startTime = Date.now();
        scanCount++;
        
        resetDailyCounterIfNeeded();
        
        console.log(`\n📡 Scan #${scanCount} - ${getBrazilianDateTime().full}`);
        
        if (dailyMessageCounter.size > 0 && CONFIG.DEBUG.VERBOSE) {
            console.log('📊 Alertas enviados hoje:');
            const sortedCounts = Array.from(dailyMessageCounter.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            sortedCounts.forEach(([symbol, count]) => {
                console.log(`   ${symbol}: ${count}/${CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL}`);
            });
        }
        
        const batchSize = CONFIG.PERFORMANCE.BATCH_SIZE;
        const alerts = [];
        
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const batchPromises = batch.map(symbol => analyzeForAlerts(symbol));
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            batchResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value) {
                    alerts.push(result.value);
                }
            });
            
            if (i + batchSize < symbols.length) {
                await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SYMBOL_DELAY_MS));
            }
        }
        
        alerts.sort((a, b) => b.confidence - a.confidence);
        
        const topAlerts = alerts.slice(0, CONFIG.ALERTS.MAX_ALERTS_PER_SCAN);
        let successfulAlerts = 0;
        
        for (const alert of topAlerts) {
            const message = formatTradeAlert(alert);
            const sent = await sendTelegramAlert(message);
            
            if (sent) {
                registerAlert(alert.symbol, alert.entryPrice, alert.direction);
                alertsSent++;
                successfulAlerts++;
                console.log(`✅ Alerta enviado: ${alert.symbol} ${alert.direction} (${alert.confidence}%) - EMAs: ${alert.emaAlignment?.strength || 'MISTURADO'} - R:R ${alert.riskReward}`);
                lastAlertTime = Date.now();
            } else {
                console.log(`❌ Falha ao enviar alerta: ${alert.symbol}`);
            }
            
            await new Promise(r => setTimeout(r, 1500));
        }
        
        if (topAlerts.length === 0) {
            console.log('📭 Nenhum alerta no momento');
            consecutiveEmptyScans++;
        } else {
            console.log(`📨 Alertas enviados com sucesso: ${successfulAlerts}/${topAlerts.length}`);
            consecutiveEmptyScans = 0;
        }
        
        const scanTime = Date.now() - startTime;
        console.log(`⏱️ Scan concluído em ${(scanTime/1000).toFixed(1)}s`);
        console.log(`📊 Total alertas enviados: ${alertsSent}`);
        console.log(`📊 Moedas com alerta hoje: ${dailyMessageCounter.size}`);
        
        let nextScanInterval = CONFIG.PERFORMANCE.SCAN_INTERVAL_SECONDS * 1000;
        if (consecutiveEmptyScans > 5) {
            nextScanInterval = Math.min(nextScanInterval * 1.5, 300000);
            console.log(`⏳ ${consecutiveEmptyScans} scans sem alertas, aumentando intervalo...`);
        }
        
        const waitTime = nextScanInterval - scanTime;
        if (waitTime > 0) {
            console.log(`⏳ Próximo scan em ${(waitTime/1000).toFixed(0)}s`);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
async function startBot() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME - SISTEMA DE ALERTAS');
    console.log('='.repeat(70) + '\n');
    
    console.log('📅 Inicializando...');
    console.log(`📱 Telegram Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`📱 Telegram Chat ID: ${CONFIG.TELEGRAM.CHAT_ID ? '✅' : '❌'}`);
    console.log(`⏱️ Scan a cada: ${CONFIG.PERFORMANCE.SCAN_INTERVAL_SECONDS}s`);
    console.log(`🎯 Score mínimo: ${CONFIG.ALERTS.MIN_SCORE}`);
    console.log(`📊 Filtro RSI: Compra < ${CONFIG.RSI.BUY_MAX} | Venda > ${CONFIG.RSI.SELL_MIN}`);
    console.log(`🛡️ Cooldown: ${CONFIG.PERFORMANCE.COOLDOWN_MINUTES}min`);
    console.log(`📊 Máx alertas/scan: ${CONFIG.ALERTS.MAX_ALERTS_PER_SCAN}`);
    console.log(`📊 Máx alertas/dia/moeda: ${CONFIG.ALERTS.MAX_DAILY_ALERTS_PER_SYMBOL} (reset às 21:00)`);
    
    console.log('\n🔧 EMAS FIBONACCI IMPLEMENTADAS:');
    console.log(`   ✅ EMA 13 - Micro tendência (entrada)`);
    console.log(`   ✅ EMA 34 - Confirmação curta`);
    console.log(`   ✅ EMA 55 - Tendência média`);
    console.log(`   ✅ EMA 233 - Contexto macro`);
    
    console.log('\n🔧 RECURSOS AVANÇADOS ATIVADOS:');
    console.log('   ✅ Stop Loss Baseado em EMAs');
    console.log('   ✅ Validação de Alinhamento de EMAs');
    console.log('   ✅ Bônus de Pontuação por Alinhamento Forte');
    console.log('   ✅ Filtro Contra EMAs Desalinhadas\n');
    
    cleanupManager.start();
    
    const initMessage = `🤖 Titanium Prime Ativado - Sistema pronto!`;
    
    const sent = await sendTelegramAlert(initMessage);
    if (sent) {
        console.log('✅ Bot inicializado! Mensagem de confirmação enviada.');
    } else {
        console.log('⚠️ Bot inicializado mas falha ao enviar mensagem de confirmação.');
    }
    
    console.log('\n🔍 Iniciando scanner em tempo real...\n');
    
    await realTimeScanner();
}

// =====================================================================
// === HANDLERS DE ERRO ===
// =====================================================================
process.on('uncaughtException', async (err) => {
    console.error('\n❌ UNCAUGHT EXCEPTION:', err.message);
    console.error('Stack:', err.stack);
    
    const errorMessage = `❌ ERRO NO BOT - Reiniciando em 60s`;
    
    await sendTelegramAlert(errorMessage);
    
    setTimeout(() => {
        console.log('🔄 Reiniciando bot...');
        process.exit(1);
    }, 60000);
});

process.on('unhandledRejection', async (reason) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
    
    if (reason.message && reason.message.includes('telegram')) {
        console.log('⚠️ Erro no Telegram ignorado, continuando execução...');
    }
});

// =====================================================================
// === START ===
// =====================================================================
console.log('🚀 Iniciando Titanium Prime com EMAs 13,34,55,233...');
startBot().catch(async error => {
    console.error('❌ Erro fatal:', error);
    
    try {
        await sendTelegramAlert(`❌ ERRO FATAL`);
    } catch {}
    
    cleanupManager.stop();
    process.exit(1);
});
