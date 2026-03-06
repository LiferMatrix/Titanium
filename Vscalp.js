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
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 200,
        SCAN_INTERVAL_SECONDS: 120,
        CANDLE_CACHE_TTL: 300000,
        BATCH_SIZE: 15,
        REQUEST_TIMEOUT: 15000,
        COOLDOWN_MINUTES: 15,
        PRICE_DEVIATION_THRESHOLD: 0.5,
        TELEGRAM_RETRY_ATTEMPTS: 3,
        TELEGRAM_RETRY_DELAY: 2000
    },
    VOLUME: {
        TIMEFRAME: '15m',
        EMA_PERIOD: 9,
        MIN_VOLUME_RATIO: 1.7,
        BUYER_THRESHOLD: 52,
        SELLER_THRESHOLD: 48,
        CONFIRMATION_CANDLES: 4
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
    ALERTS: {
        MIN_SCORE: 85,
        MIN_VOLUME_RATIO: 1.7,
        ENABLE_SOUND: true,
        MAX_ALERTS_PER_SCAN: 5,
        MAX_DAILY_ALERTS_PER_SYMBOL: 10,
        PRIORITY_LEVELS: {
            ALTA: 85,
            MEDIA: 75,
            BAIXA: 70
        }
    },
    RSI: {
        BUY_MAX: 60,
        SELL_MIN: 66,
        PERIOD: 14
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
    },
    CCI: {
        ENABLED: true,
        PERIOD: 20,
        EMA_PERIOD: 5,
        MIN_ALTA_SCORE: 30,
        MIN_BAIXA_SCORE: 30,
        REQUIRED_FOR_BUY: 'ALTA',
        REQUIRED_FOR_SELL: 'BAIXA'
    },
    STOCH: {
        PERIOD_1D: 5,
        SLOW_1D: 3,
        SMOOTH_1D: 3,
        PERIOD_4H: 14,
        SLOW_4H: 3,
        SMOOTH_4H: 3,
        COLORS: {
            EXTREME_OVERSOLD: 10,
            OVERSOLD: 30,
            NEUTRAL: 65,
            OVERBOUGHT: 80
        }
    },
    LIQUIDATION: {
        ENABLED: true,
        LOOKBACK_CANDLES: 100,
        CLUSTER_THRESHOLD: 0.02,
        MAX_ZONES: 3,
        VOLUME_WEIGHT: 0.6,
        PRICE_WEIGHT: 0.4
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
    cci1h: z.string().optional().nullable(),
    cciDaily: z.string().optional().nullable(),
    cciValue: z.number().optional().nullable(),
    cciEma: z.number().optional().nullable(),
    stochDaily: z.string().optional().nullable(),
    stoch4h: z.string().optional().nullable(),
    longLiquidationZones: z.array(z.number()).optional().nullable(),
    shortLiquidationZones: z.array(z.number()).optional().nullable(),
    nearestLongLiq: z.number().optional().nullable(),
    nearestShortLiq: z.number().optional().nullable(),
    support: z.number(),
    resistance: z.number(),
    emoji: z.string(),
    timestamp: z.number()
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
                } catch (err) {}
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
                    } catch (err) {}
                }
            });
        } catch (err) {}

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
        } catch (err) {}
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

function getStochEmoji(value) {
    if (value < CONFIG.STOCH.COLORS.EXTREME_OVERSOLD) return '🔵';
    if (value <= CONFIG.STOCH.COLORS.OVERSOLD) return '🟢';
    if (value <= CONFIG.STOCH.COLORS.NEUTRAL) return '🟡';
    if (value <= CONFIG.STOCH.COLORS.OVERBOUGHT) return '🟠';
    return '🔴';
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR ZONAS DE LIQUIDAÇÃO ===
// =====================================================================
function detectLiquidationZones(candles, currentPrice) {
    if (!CONFIG.LIQUIDATION.ENABLED || candles.length < 50) {
        return { longZones: [], shortZones: [], nearestLong: null, nearestShort: null };
    }

    const lookback = Math.min(CONFIG.LIQUIDATION.LOOKBACK_CANDLES, candles.length);
    const recentCandles = candles.slice(-lookback);
    
    const priceVolumeClusters = [];
    
    for (let i = 0; i < recentCandles.length; i++) {
        const candle = recentCandles[i];
        const volumeWeight = candle.volume / Math.max(...recentCandles.map(c => c.volume));
        
        if (candle.high > candle.close && candle.high > candle.open) {
            priceVolumeClusters.push({
                price: candle.high,
                volumeWeight,
                type: 'short',
                strength: volumeWeight * CONFIG.LIQUIDATION.VOLUME_WEIGHT + 
                         (candle.high - candle.low) / candle.low * CONFIG.LIQUIDATION.PRICE_WEIGHT
            });
        }
        
        if (candle.low < candle.close && candle.low < candle.open) {
            priceVolumeClusters.push({
                price: candle.low,
                volumeWeight,
                type: 'long',
                strength: volumeWeight * CONFIG.LIQUIDATION.VOLUME_WEIGHT + 
                         (candle.high - candle.low) / candle.low * CONFIG.LIQUIDATION.PRICE_WEIGHT
            });
        }
    }
    
    const clusterThreshold = currentPrice * CONFIG.LIQUIDATION.CLUSTER_THRESHOLD;
    
    const clusterPoints = (points) => {
        const clusters = [];
        const used = new Set();
        
        for (let i = 0; i < points.length; i++) {
            if (used.has(i)) continue;
            
            const cluster = {
                prices: [points[i].price],
                strengths: [points[i].strength],
                totalStrength: points[i].strength,
                avgPrice: points[i].price
            };
            used.add(i);
            
            for (let j = i + 1; j < points.length; j++) {
                if (used.has(j)) continue;
                
                if (Math.abs(points[i].price - points[j].price) <= clusterThreshold) {
                    cluster.prices.push(points[j].price);
                    cluster.strengths.push(points[j].strength);
                    cluster.totalStrength += points[j].strength;
                    used.add(j);
                }
            }
            
            let weightedSum = 0;
            for (let k = 0; k < cluster.prices.length; k++) {
                weightedSum += cluster.prices[k] * cluster.strengths[k];
            }
            cluster.avgPrice = weightedSum / cluster.strengths.reduce((a, b) => a + b, 0);
            
            clusters.push(cluster);
        }
        
        return clusters
            .sort((a, b) => b.totalStrength - a.totalStrength)
            .slice(0, CONFIG.LIQUIDATION.MAX_ZONES)
            .map(c => c.avgPrice);
    };
    
    const longPoints = priceVolumeClusters
        .filter(p => p.type === 'long' && p.price < currentPrice)
        .sort((a, b) => b.strength - a.strength);
    
    const shortPoints = priceVolumeClusters
        .filter(p => p.type === 'short' && p.price > currentPrice)
        .sort((a, b) => b.strength - a.strength);
    
    const longZones = clusterPoints(longPoints);
    const shortZones = clusterPoints(shortPoints);
    
    const nearestLong = longZones.length > 0 
        ? longZones.reduce((nearest, zone) => 
            Math.abs(zone - currentPrice) < Math.abs(nearest - currentPrice) ? zone : nearest
        ) : null;
    
    const nearestShort = shortZones.length > 0 
        ? shortZones.reduce((nearest, zone) => 
            Math.abs(zone - currentPrice) < Math.abs(nearest - currentPrice) ? zone : nearest
        ) : null;
    
    return {
        longZones,
        shortZones,
        nearestLong,
        nearestShort
    };
}

// =====================================================================
// === RESET CONTADOR DIÁRIO ÀS 21H ===
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
// === CÁLCULOS TÉCNICOS ===
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

function calculateCCITrend(candles) {
    const cciValues = [];
    for (let i = candles.length - 26; i < candles.length; i++) {
        const slice = candles.slice(0, i + 1);
        cciValues.push(calculateCCI(slice, CONFIG.CCI.PERIOD) || 0);
    }
    
    const cciCurrent = cciValues.length > 0 ? cciValues[cciValues.length - 1] : null;
    const cciEma = cciValues.length >= CONFIG.CCI.EMA_PERIOD ? 
        calculateEMA(cciValues, CONFIG.CCI.EMA_PERIOD) : null;
    
    let trend = "NEUTRO";
    if (cciCurrent !== null && cciEma !== null) {
        if (cciCurrent > cciEma) {
            trend = "ALTA";
        } else if (cciCurrent < cciEma) {
            trend = "BAIXA";
        }
    }
    
    return {
        trend,
        value: cciCurrent,
        ema: cciEma
    };
}

function calculateStochastic(candles, kPeriod = 14, dPeriod = 3, smooth = 3) {
    if (candles.length < kPeriod + dPeriod + smooth) return { k: null, d: null };
    
    const kValues = [];
    
    for (let i = kPeriod; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const high = Math.max(...periodCandles.map(c => c.high));
        const low = Math.min(...periodCandles.map(c => c.low));
        const close = candles[i].close;
        
        const k = ((close - low) / (high - low)) * 100;
        kValues.push(k);
    }
    
    const kLine = [];
    for (let i = smooth - 1; i < kValues.length; i++) {
        const sum = kValues.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kLine.push(sum / smooth);
    }
    
    const dLine = [];
    for (let i = dPeriod - 1; i < kLine.length; i++) {
        const sum = kLine.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
        dLine.push(sum / dPeriod);
    }
    
    const currentK = kLine.length > 0 ? kLine[kLine.length - 1] : null;
    const currentD = dLine.length > 0 ? dLine[dLine.length - 1] : null;
    
    return { k: currentK, d: currentD };
}

function formatStochastic(k, d, emoji) {
    if (k === null || d === null) return 'N/D';
    
    const arrow = k > d ? '⤴️' : '⤵️';
    return `K${Math.round(k)}${arrow}D${Math.round(d)} ${emoji}`;
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
// === ANÁLISE DE VOLUME E GERAÇÃO DE ALERTAS ===
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

function calculateTradeLevels(price, atr, direction, support, resistance) {
    let stopLoss, takeProfit1, takeProfit2, takeProfit3;
    
    if (direction === 'COMPRA') {
        stopLoss = Math.min(
            support * 0.995,
            price - (atr * 1.5)
        );
        
        const risk = price - stopLoss;
        const reward1 = risk * CONFIG.TRADE.RISK_REWARD_RATIO;
        const reward2 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 1.5);
        const reward3 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 2);
        
        takeProfit1 = Math.min(price + reward1, resistance * 0.99);
        takeProfit2 = Math.min(price + reward2, resistance * 1.02);
        takeProfit3 = price + reward3;
        
    } else {
        stopLoss = Math.max(
            resistance * 1.005,
            price + (atr * 1.5)
        );
        
        const risk = stopLoss - price;
        const reward1 = risk * CONFIG.TRADE.RISK_REWARD_RATIO;
        const reward2 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 1.5);
        const reward3 = risk * (CONFIG.TRADE.RISK_REWARD_RATIO * 2);
        
        takeProfit1 = Math.max(price - reward1, support * 1.01);
        takeProfit2 = Math.max(price - reward2, support * 0.98);
        takeProfit3 = price - reward3;
    }
    
    return { stopLoss, takeProfit1, takeProfit2, takeProfit3 };
}

// =====================================================================
// === FUNÇÃO PRINCIPAL DE ANÁLISE ===
// =====================================================================
async function analyzeForAlerts(symbol) {
    try {
        // Busca candles
        const [candlesPrincipal, candles1h, candlesDaily, candles4h] = await Promise.all([
            getCandles(symbol, CONFIG.VOLUME.TIMEFRAME, 200),  // 15m para volume
            getCandles(symbol, '1h', 100),                     // 1h para RSI e CCI
            getCandles(symbol, '1d', 100),                     // Diário para CCI Diário
            getCandles(symbol, '4h', 100)
        ]);
        
        // Validação
        const minCandlesNeeded = CONFIG.VOLUME.TIMEFRAME === '15m' ? 100 : 30;
        if (candlesPrincipal.length < minCandlesNeeded || candles1h.length < 30 || candlesDaily.length < 50 || candles4h.length < 50) return null;
        
        const currentPrice = candlesPrincipal[candlesPrincipal.length - 1].close;
        
        // Análise de volume (15m)
        const volumes = candlesPrincipal.map(c => c.volume);
        const avgVolume = volumes.slice(-40).reduce((a, b) => a + b, 0) / 40;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        
        // Calcular EMA para determinar buyer/seller
        const closes = candlesPrincipal.map(c => c.close);
        const ema9 = calculateEMA(closes.slice(-40), 9);
        
        const lookbackCandles = CONFIG.VOLUME.TIMEFRAME === '15m' ? 16 : 24;
        let buyerVolume = 0, sellerVolume = 0, totalVolume = 0;
        const recentCandles = candlesPrincipal.slice(-lookbackCandles);
        
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
        
        // RSI em 1h
        const rsi1h = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        
        // CCI em 1 hora
        const cci1h = calculateCCITrend(candles1h);
        
        // CCI Diário
        const cciDaily = calculateCCITrend(candlesDaily);
        
        // Stochastics
        const stochDaily = calculateStochastic(
            candlesDaily, 
            CONFIG.STOCH.PERIOD_1D, 
            CONFIG.STOCH.SLOW_1D, 
            CONFIG.STOCH.SMOOTH_1D
        );
        
        const stoch4h = calculateStochastic(
            candles4h, 
            CONFIG.STOCH.PERIOD_4H, 
            CONFIG.STOCH.SLOW_4H, 
            CONFIG.STOCH.SMOOTH_4H
        );
        
        let stochDailyDisplay = "N/D";
        if (stochDaily.k !== null && stochDaily.d !== null) {
            const emoji = getStochEmoji(stochDaily.k);
            stochDailyDisplay = formatStochastic(stochDaily.k, stochDaily.d, emoji);
        }
        
        let stoch4hDisplay = "N/D";
        if (stoch4h.k !== null && stoch4h.d !== null) {
            const emoji = getStochEmoji(stoch4h.k);
            stoch4hDisplay = formatStochastic(stoch4h.k, stoch4h.d, emoji);
        }
        
        // Zonas de liquidação
        const liquidationZones = detectLiquidationZones(candlesPrincipal, currentPrice);
        
        // Outros indicadores
        const [lsr, funding, sr, atr] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            Promise.resolve(calculateSupportResistance(candlesPrincipal)),
            Promise.resolve(calculateATR(candlesPrincipal, 14))
        ]);
        
        if (!sr.support || !sr.resistance || !atr || rsi1h === null) return null;
        
        let direction = null;
        let score = 0;
        let confidence = 0;
        
        // CRITÉRIOS DE COMPRA
        if (buyerPercentage > CONFIG.VOLUME.BUYER_THRESHOLD && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h < CONFIG.RSI.BUY_MAX) {
            
            if (cci1h.trend === CONFIG.CCI.REQUIRED_FOR_BUY) {
                direction = 'COMPRA';
                score = 45;
                
                if (buyerPercentage > 60) score += 15;
                else if (buyerPercentage > 55) score += 12;
                else if (buyerPercentage > 52) score += 8;
                
                if (volumeRatio > 2.5) score += 15;
                else if (volumeRatio > 2.0) score += 12;
                else if (volumeRatio > 1.8) score += 10;
                else if (volumeRatio > 1.6) score += 8;
                
                if (lsr) {
                    if (lsr < 1.5) score += 18;
                    else if (lsr < 2.0) score += 15;
                    else if (lsr < 2.3) score += 12;
                    else if (lsr < 2.6) score += 8;
                    else if (lsr > 3.0) score -= 15;
                    else if (lsr > 2.8) score -= 12;
                }
                
                if (funding) {
                    if (funding < -0.001) score += 15;
                    else if (funding < -0.0005) score += 8;
                    else if (funding < -0.0001) score += 3;
                }
                
                if (rsi1h) {
                    if (rsi1h < 35) score += 14;
                    else if (rsi1h < 40) score += 12;
                    else if (rsi1h < 45) score += 10;
                    else if (rsi1h < 50) score += 5;
                }
                
                if (currentPrice < sr.resistance) {
                    const distanceToResistance = (sr.resistance - currentPrice) / sr.resistance * 100;
                    if (distanceToResistance > 5) score += 8;
                    else if (distanceToResistance > 2) score += 5;
                }
            }
        }
        
        // CRITÉRIOS DE VENDA
        if (sellerPercentage > (100 - CONFIG.VOLUME.SELLER_THRESHOLD) && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h > CONFIG.RSI.SELL_MIN) {
            
            if (cci1h.trend === CONFIG.CCI.REQUIRED_FOR_SELL) {
                direction = 'VENDA';
                score = 45;
                
                if (sellerPercentage > 60) score += 15;
                else if (sellerPercentage > 55) score += 12;
                else if (sellerPercentage > 52) score += 8;
                
                if (volumeRatio > 2.5) score += 15;
                else if (volumeRatio > 2.0) score += 12;
                else if (volumeRatio > 1.8) score += 10;
                else if (volumeRatio > 1.6) score += 8;
                
                if (lsr) {
                    if (lsr > 4.0) score += 18;
                    else if (lsr > 3.5) score += 15;
                    else if (lsr > 3.0) score += 12;
                    else if (lsr > 2.7) score += 8;
                    else if (lsr < 1.0) score -= 15;
                    else if (lsr < 1.2) score -= 12;
                }
                
                if (funding) {
                    if (funding > 0.001) score += 15;
                    else if (funding > 0.0005) score += 8;
                    else if (funding > 0.0001) score += 3;
                }
                
                if (rsi1h) {
                    if (rsi1h > 75) score += 14;
                    else if (rsi1h > 70) score += 12;
                    else if (rsi1h > 65) score += 10;
                    else if (rsi1h > 60) score += 5;
                }
                
                if (currentPrice > sr.support) {
                    const distanceToSupport = (currentPrice - sr.support) / currentPrice * 100;
                    if (distanceToSupport > 5) score += 8;
                    else if (distanceToSupport > 2) score += 5;
                }
            }
        }
        
        confidence = Math.min(100, Math.max(0, score));
        
        if (!direction || confidence < CONFIG.ALERTS.MIN_SCORE) return null;
        
        if (!canSendAlert(symbol, currentPrice, direction)) return null;
        
        const { stopLoss, takeProfit1, takeProfit2, takeProfit3 } = 
            calculateTradeLevels(currentPrice, atr, direction, sr.support, sr.resistance);
        
        const riskReward = Math.abs((takeProfit1 - currentPrice) / (currentPrice - stopLoss));
        
        const emoji = getConfidenceEmoji(confidence);
        
        // Formatar CCI 1H
        let cci1hDisplay = "NEUTRO";
        if (cci1h.trend === "ALTA") cci1hDisplay = "CCI 💹ALTA";
        else if (cci1h.trend === "BAIXA") cci1hDisplay = "CCI 🔴BAIXA";
        
        // Formatar CCI Diário
        let cciDailyDisplay = "NEUTRO";
        if (cciDaily.trend === "ALTA") cciDailyDisplay = "CCI 💹ALTA";
        else if (cciDaily.trend === "BAIXA") cciDailyDisplay = "CCI 🔴BAIXA";
        
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
            cci1h: cci1hDisplay,
            cciDaily: cciDailyDisplay,
            cciValue: cci1h.value,
            cciEma: cci1h.ema,
            stochDaily: stochDailyDisplay,
            stoch4h: stoch4hDisplay,
            longLiquidationZones: liquidationZones.longZones,
            shortLiquidationZones: liquidationZones.shortZones,
            nearestLongLiq: liquidationZones.nearestLong,
            nearestShortLiq: liquidationZones.nearestShort,
            support: sr.support,
            resistance: sr.resistance,
            emoji,
            timestamp: Date.now()
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
// === TELEGRAM MELHORADO COM RETRY ===
// =====================================================================
async function sendTelegramAlert(message, parseMode = 'HTML') {
    let attempts = 0;
    const maxAttempts = CONFIG.PERFORMANCE.TELEGRAM_RETRY_ATTEMPTS;
    
    if (!CONFIG.TELEGRAM.BOT_TOKEN) {
        console.log('⚠️ Token do Telegram não configurado');
        return false;
    }

    const chatIdVariations = [
        CONFIG.TELEGRAM.CHAT_ID,
        CONFIG.TELEGRAM.CHAT_ID.replace('-100', ''),
        `-100${CONFIG.TELEGRAM.CHAT_ID}`,
        CONFIG.TELEGRAM.CHAT_ID.toString().trim()
    ];
    
    const uniqueChatIds = [...new Set(chatIdVariations)];
    
    while (attempts < maxAttempts) {
        attempts++;
        
        for (const chatId of uniqueChatIds) {
            try {
                const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: message,
                        parse_mode: parseMode,
                        disable_web_page_preview: true
                    }),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    return true;
                }
                
            } catch (error) {}
        }
        
        if (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.TELEGRAM_RETRY_DELAY));
        }
    }
    
    return false;
}

// =====================================================================
// === FUNÇÃO PRINCIPAL DE FORMATAÇÃO DO ALERTA ===
// =====================================================================
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
    
    const rsiStatus = alert.direction === 'COMPRA' ? 
        (alert.rsi < 45 ? '🚀' : alert.rsi < 55 ? '📈' : '⚖️') :
        (alert.rsi > 70 ? '💥' : alert.rsi > 60 ? '📉' : '⚖️');
    
    const iaDica = alert.direction === 'COMPRA' 
        ? '<b>🤖 IA Dica...</b> Com CCI Diário em ALTA a probabilidade do Scalp dar certo e maior...Observar Zonas de Suporte de Compra' 
        : '<b>🤖 IA Dica...</b> Com CCI Diário em BAIXA a probabilidade do Scalp dar certo e maior...Realizar Lucro ou Parcial perto da Resistência.';
    
    const stochDaily = alert.stochDaily || 'N/D';
    const stoch4h = alert.stoch4h || 'N/D';
    
    // Formatar zonas de liquidação
    let longLiqText = '';
    let shortLiqText = '';
    
    if (CONFIG.LIQUIDATION.ENABLED) {
        const longZones = alert.longLiquidationZones || [];
        const shortZones = alert.shortLiquidationZones || [];
        
        if (longZones.length > 0) {
            const zonesFormatted = longZones.slice(0, 2).map(z => formatPrice(z)).join(' | ');
            longLiqText = `🔹Supt: ${zonesFormatted}`;
        }
        
        if (shortZones.length > 0) {
            const zonesFormatted = shortZones.slice(0, 2).map(z => formatPrice(z)).join(' | ');
            shortLiqText = `🔻Resist: ${zonesFormatted}`;
        }
    }
    
    // Mensagem com CCI 1H e CCI Diário
    return `<i>${alert.emoji} <b>${dirEmoji} 🎯SCALP ${direction} - ${symbolName}</b> ${alert.emoji}
 <b>🐋Volume💱!</b> | ✨#SCORE: ${alert.confidence}%
 Alerta:${dailyCount} | ${time.full}hs
 💲Preço: $${entry}
 #RSI 1h: ${formatNumber(alert.rsi, 0)} ${rsiStatus} | #Vol: ${alert.volumeRatio.toFixed(2)}x (${volPct}%)
 #LSR: ${formatNumber(alert.lsr, 2)} | #Fund: ${fundingSign}${fundingPct}%
 📊 Gráfico 1H: ${alert.cci1h || 'NEUTRO'}
 📊 Gráfico Diário: ${alert.cciDaily || 'NEUTRO'}
 Stoch 1D: ${stochDaily}
 Stoch 4H: ${stoch4h}
 ${shortLiqText}
 ${longLiqText} 
 <b>Alvos</b>: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop: ${stop}
❅──────✧❅🔹❅✧──────❅
 ${iaDica}
Alerta Educativo, não é recomendação de investimento.
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
    console.log(`   - Timeframe Volume: ${CONFIG.VOLUME.TIMEFRAME}`);
    console.log(`   - Critério Compra: Volume >52% (15m) | RSI <64 (1h) | CCI 1h ALTA`);
    console.log(`   - Critério Venda: Volume >52% (15m) | RSI >66 (1h) | CCI 1h BAIXA`);
    if (CONFIG.LIQUIDATION.ENABLED) {
        console.log(`   - Zonas de liquidação: ATIVADO`);
    }
    
    let scanCount = 0;
    let alertsSent = 0;
    let consecutiveEmptyScans = 0;
    
    while (true) {
        const startTime = Date.now();
        scanCount++;
        
        resetDailyCounterIfNeeded();
        
        console.log(`\n📡 Scan #${scanCount} - ${getBrazilianDateTime().full}`);
        
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
                console.log(`✅ Alerta enviado: ${alert.symbol} ${alert.direction} (${alert.confidence}%)`);
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
        
        let nextScanInterval = CONFIG.PERFORMANCE.SCAN_INTERVAL_SECONDS * 1000;
        if (consecutiveEmptyScans > 5) {
            nextScanInterval = Math.min(nextScanInterval * 1.5, 300000);
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
    console.log('🚀 TITANIUM PRIME');
    console.log('='.repeat(70) + '\n');
    
    console.log('📅 Inicializando...');
    console.log(`📱 Telegram Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`📊 Timeframe Volume: ${CONFIG.VOLUME.TIMEFRAME}`);
    console.log(`📊 Risco/Retorno alvo: 1:${CONFIG.TRADE.RISK_REWARD_RATIO}`);
    console.log(`📊 Critérios COMPRA: Volume 15m >52% | RSI 1h <64 | CCI 1h ALTA`);
    console.log(`📊 Critérios VENDA: Volume 15m >52% | RSI 1h >66 | CCI 1h BAIXA`);
    if (CONFIG.LIQUIDATION.ENABLED) {
        console.log(`💰 Zonas de Liquidação: ATIVADO`);
    }
    console.log('');
    
    cleanupManager.start();
    
    const initMessage = `🤖 Titanium Prime Ativado `;
    
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
    
    const errorMessage = `❌ ERRO NO BOT - Reiniciando em 60s`;
    
    await sendTelegramAlert(errorMessage);
    
    setTimeout(() => {
        console.log('🔄 Reiniciando bot...');
        process.exit(1);
    }, 60000);
});

process.on('unhandledRejection', async (reason) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
});

// =====================================================================
// === START ===
// =====================================================================
console.log('🚀 Iniciando Titanium Prime Real-Time Alert System...');
startBot().catch(async error => {
    console.error('❌ Erro fatal:', error);
    
    try {
        await sendTelegramAlert(`❌ ERRO FATAL`);
    } catch {}
    
    cleanupManager.stop();
    process.exit(1);
});
