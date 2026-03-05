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
        BOT_TOKEN: '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A',
        CHAT_ID: '-1001990889297'
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
        BUY_MAX: 64,      // RSI máximo para compra
        SELL_MIN: 66,     // RSI mínimo para venda
        PERIOD: 14
    },
    DEBUG: {
        VERBOSE: false
    },
    // =================================================================
    // === CONFIGURAÇÕES DE LIMPEZA ===
    // =================================================================
    CLEANUP: {
        ENABLED: true,                    // Ativar/desativar limpeza
        MAX_LOG_AGE_HOURS: 24,             // Manter logs por 24 horas
        MAX_CACHE_AGE_HOURS: 12,            // Manter cache por 12 horas
        MAX_ALERT_FILES_AGE_HOURS: 48,      // Manter arquivos de alerta por 48 horas
        CLEANUP_INTERVAL_MINUTES: 60,       // Executar limpeza a cada 60 minutos
        MAX_FOLDER_SIZE_MB: 500,             // Tamanho máximo total da pasta em MB
        COMPRESS_OLD_LOGS: true,             // Comprimir logs antigos
        MIN_FREE_SPACE_MB: 100                // Espaço mínimo livre necessário
    },
    // =================================================================
    // === CONFIGURAÇÕES CCI ===
    // =================================================================
    CCI: {
        ENABLED: true,                      // Ativar/desativar CCI obrigatório
        PERIOD: 20,                          // Período do CCI
        EMA_PERIOD: 5,                        // Período da EMA do CCI
        MIN_ALTA_SCORE: 30,                    // Pontuação mínima quando CCI está em ALTA
        MIN_BAIXA_SCORE: 30,                    // Pontuação mínima quando CCI está em BAIXA
        REQUIRED_FOR_BUY: 'ALTA',               // Tendência CCI necessária para COMPRA
        REQUIRED_FOR_SELL: 'BAIXA'               // Tendência CCI necessária para VENDA
    },
    // =================================================================
    // === CONFIGURAÇÕES STOCHASTIC - NOVO ===
    // =================================================================
    STOCH: {
        PERIOD_1D: 5,                        // Período K diário
        SLOW_1D: 3,                          // Desaceleração diário
        SMOOTH_1D: 3,                        // Suavização diário
        PERIOD_4H: 14,                        // Período K 4h
        SLOW_4H: 3,                           // Desaceleração 4h
        SMOOTH_4H: 3,                         // Suavização 4h
        COLORS: {
            EXTREME_OVERSOLD: 10,              // 🔵 Abaixo de 10
            OVERSOLD: 30,                       // 🟢 11-30
            NEUTRAL: 65,                         // 🟡 31-65
            OVERBOUGHT: 80                        // 🟠 66-78, 🔴 acima de 80
        }
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
    cciValue: z.number().optional().nullable(),
    cciEma: z.number().optional().nullable(),
    // Campos novos para Stochastic
    stochDaily: z.string().optional().nullable(),
    stoch4h: z.string().optional().nullable(),
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
        
        // Executar primeira limpeza após 5 segundos
        setTimeout(() => this.cleanup(), 5000);
        
        // Configurar limpeza periódica
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
            // Limpar logs antigos
            const logResult = this.cleanupDirectory(LOG_DIR, CONFIG.CLEANUP.MAX_LOG_AGE_HOURS);
            cleanedCount += logResult.count;
            cleanedSize += logResult.size;

            // Limpar cache antigo
            const cacheResult = this.cleanupDirectory(CACHE_DIR, CONFIG.CLEANUP.MAX_CACHE_AGE_HOURS);
            cleanedCount += cacheResult.count;
            cleanedSize += cacheResult.size;

            // Limpar alertas antigos
            const alertResult = this.cleanupDirectory(ALERTS_DIR, CONFIG.CLEANUP.MAX_ALERT_FILES_AGE_HOURS);
            cleanedCount += alertResult.count;
            cleanedSize += alertResult.size;

            // Limpar arquivos temporários do sistema
            const tempResult = this.cleanupTempFiles();
            cleanedCount += tempResult.count;
            cleanedSize += tempResult.size;

            // Verificar e limpar por tamanho máximo da pasta
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

            // Registrar limpeza em log
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
                    
                    // Verificar se é arquivo (não diretório)
                    if (stats.isFile()) {
                        const fileAge = now - stats.mtimeMs;
                        
                        // Remover se mais antigo que o limite
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
            // Limpar arquivos temporários comuns
            const tempPatterns = ['*.tmp', '*.temp', '*.log.*', 'core.*', 'npm-debug.log*'];
            const files = fs.readdirSync('.');
            
            files.forEach(file => {
                for (const pattern of tempPatterns) {
                    if (file.includes('tmp') || file.includes('temp') || 
                        (file.includes('.log.') && file !== 'system.log')) {
                        try {
                            const stats = fs.statSync(file);
                            if (stats.isFile()) {
                                // Remover arquivos temporários com mais de 1 hora
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
                        break;
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
            // Calcular tamanho total das pastas
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

            // Se excedeu o limite, remover arquivos mais antigos até ficar abaixo
            if (totalSize > maxSizeBytes) {
                console.log(`   ⚠️ Espaço total (${(totalSize / (1024*1024)).toFixed(2)} MB) excede limite de ${CONFIG.CLEANUP.MAX_FOLDER_SIZE_MB} MB`);
                
                // Ordenar por data de modificação (mais antigos primeiro)
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

// Instanciar o gerenciador de limpeza
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

// =====================================================================
// === FUNÇÃO PARA EMOJI DO STOCHASTIC - NOVO ===
// =====================================================================
function getStochEmoji(value) {
    if (value < CONFIG.STOCH.COLORS.EXTREME_OVERSOLD) return '🔵';
    if (value <= CONFIG.STOCH.COLORS.OVERSOLD) return '🟢';
    if (value <= CONFIG.STOCH.COLORS.NEUTRAL) return '🟡';
    if (value <= CONFIG.STOCH.COLORS.OVERBOUGHT) return '🟠';
    return '🔴';
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

// Função para calcular CCI (Commodity Channel Index)
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

// Função para calcular tendência do CCI
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

// =====================================================================
// === FUNÇÃO PARA CALCULAR STOCHASTIC - NOVO ===
// =====================================================================
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
    
    // Calcular %K (média móvel do K)
    const kLine = [];
    for (let i = smooth - 1; i < kValues.length; i++) {
        const sum = kValues.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kLine.push(sum / smooth);
    }
    
    // Calcular %D (média móvel do %K)
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

async function analyzeForAlerts(symbol) {
    try {
        const [candles1h, candles15m, candlesDaily, candles4h] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '15m', 50),
            getCandles(symbol, '1d', 100), // Candles diários para CCI e Stochastic
            getCandles(symbol, '4h', 100)   // Candles 4h para Stochastic
        ]);
        
        if (candles1h.length < 30 || candles15m.length < 20 || candlesDaily.length < 50 || candles4h.length < 50) return null;
        
        const currentPrice = candles1h[candles1h.length - 1].close;
        const currentCandle15m = candles15m[candles15m.length - 1];
        
        const volumes = candles1h.map(c => c.volume);
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        
        const closes = candles1h.map(c => c.close);
        const ema9 = calculateEMA(closes.slice(-20), 9);
        
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
        
        // Calcular CCI diário
        const cciDaily = calculateCCITrend(candlesDaily);
        
        // =================================================================
        // === CALCULAR STOCHASTIC - NOVO ===
        // =================================================================
        // Stochastic Diário (5,3,3)
        const stochDaily = calculateStochastic(
            candlesDaily, 
            CONFIG.STOCH.PERIOD_1D, 
            CONFIG.STOCH.SLOW_1D, 
            CONFIG.STOCH.SMOOTH_1D
        );
        
        // Stochastic 4h (14,3,3)
        const stoch4h = calculateStochastic(
            candles4h, 
            CONFIG.STOCH.PERIOD_4H, 
            CONFIG.STOCH.SLOW_4H, 
            CONFIG.STOCH.SMOOTH_4H
        );
        
        // Formatar Stochastic para exibição
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
        
        const [lsr, funding, rsi1h, sr, atr] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            Promise.resolve(calculateRSI(candles1h, CONFIG.RSI.PERIOD)),
            Promise.resolve(calculateSupportResistance(candles1h)),
            Promise.resolve(calculateATR(candles1h, 14))
        ]);
        
        if (!sr.support || !sr.resistance || !atr || rsi1h === null) return null;
        
        let direction = null;
        let score = 0;
        let confidence = 0;
        
        // ANÁLISE PARA COMPRA - COM VALIDAÇÃO OBRIGATÓRIA DO CCI
        if (buyerPercentage > CONFIG.VOLUME.BUYER_THRESHOLD && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h < CONFIG.RSI.BUY_MAX) {
            
            // VERIFICAÇÃO OBRIGATÓRIA DO CCI - Só permite COMPRA se CCI estiver em ALTA
            if (cciDaily.trend === CONFIG.CCI.REQUIRED_FOR_BUY) {
                direction = 'COMPRA';
                score = 45;
                
                // 1. VOLUME COMPRADOR (máx 20)
                if (buyerPercentage > 60) score += 15;
                else if (buyerPercentage > 55) score += 12;
                else if (buyerPercentage > 52) score += 8;
                
                // 2. VOLUME RATIO (máx 20)
                if (volumeRatio > 2.5) score += 15;
                else if (volumeRatio > 2.0) score += 12;
                else if (volumeRatio > 1.8) score += 10;
                else if (volumeRatio > 1.6) score += 8;
                
                // 3. LSR (máx 20, com penalidade)
                if (lsr) {
                    if (lsr < 1.5) score += 18;      // Muito bom (pouca gente comprada)
                    else if (lsr < 2.0) score += 15;  // Bom
                    else if (lsr < 2.3) score += 12;  // Moderado
                    else if (lsr < 2.6) score += 8;   // Pouco favorável
                    else if (lsr > 3.0) score -= 15;  // PENALIDADE: Muita gente comprada
                    else if (lsr > 2.8) score -= 12;   // Penalidade leve
                }
                
                // 4. FUNDING (máx 15)
                if (funding) {
                    if (funding < -0.001) score += 15;      // Muito negativo
                    else if (funding < -0.0005) score += 8; // Moderadamente negativo
                    else if (funding < -0.0001) score += 3;  // Levemente negativo
                }
                
                // 5. RSI (máx 20)
                if (rsi1h) {
                    if (rsi1h < 35) score += 14;      // Extremamente oversold
                    else if (rsi1h < 40) score += 12;  // Muito oversold
                    else if (rsi1h < 45) score += 10;  // Oversold moderado
                    else if (rsi1h < 50) score += 5;   // Levemente oversold
                }
                
                // 6. POSIÇÃO PREÇO (máx 5)
                if (currentPrice < sr.resistance) {
                    const distanceToResistance = (sr.resistance - currentPrice) / sr.resistance * 100;
                    if (distanceToResistance > 5) score += 8;       // Muito espaço
                    else if (distanceToResistance > 2) score += 5;  // Bom espaço
                }
            } else if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⏸️ ${symbol} rejeitado para COMPRA: CCI Diário = ${cciDaily.trend} (necessário: ${CONFIG.CCI.REQUIRED_FOR_BUY})`);
            }
        }
        
        // ANÁLISE PARA VENDA - COM VALIDAÇÃO OBRIGATÓRIA DO CCI
        if (sellerPercentage > (100 - CONFIG.VOLUME.SELLER_THRESHOLD) && 
            volumeRatio > CONFIG.ALERTS.MIN_VOLUME_RATIO &&
            rsi1h > CONFIG.RSI.SELL_MIN) {
            
            // VERIFICAÇÃO OBRIGATÓRIA DO CCI - Só permite VENDA se CCI estiver em BAIXA
            if (cciDaily.trend === CONFIG.CCI.REQUIRED_FOR_SELL) {
                direction = 'VENDA';
                score = 45;
                
                // 1. VOLUME VENDEDOR (máx 20)
                if (sellerPercentage > 60) score += 15;
                else if (sellerPercentage > 55) score += 12;
                else if (sellerPercentage > 52) score += 8;
                
                // 2. VOLUME RATIO (máx 20)
                if (volumeRatio > 2.5) score += 15;
                else if (volumeRatio > 2.0) score += 12;
                else if (volumeRatio > 1.8) score += 10;
                else if (volumeRatio > 1.6) score += 8;
                
                // 3. LSR (máx 20, com penalidade)
                if (lsr) {
                    if (lsr > 4.0) score += 18;        // Muito bom (muita gente comprada)
                    else if (lsr > 3.5) score += 15;    // Bom
                    else if (lsr > 3.0) score += 12;    // Moderado
                    else if (lsr > 2.7) score += 8;     // Pouco favorável
                    else if (lsr < 1.0) score -= 15;    // PENALIDADE: Muita gente vendida
                    else if (lsr < 1.2) score -= 12;     // Penalidade leve
                }
                
                // 4. FUNDING (máx 15)
                if (funding) {
                    if (funding > 0.001) score += 15;       // Muito positivo
                    else if (funding > 0.0005) score += 8;  // Moderadamente positivo
                    else if (funding > 0.0001) score += 3;   // Levemente positivo
                }
                
                // 5. RSI (máx 20)
                if (rsi1h) {
                    if (rsi1h > 75) score += 14;       // Extremamente overbought
                    else if (rsi1h > 70) score += 12;   // Muito overbought
                    else if (rsi1h > 65) score += 10;   // Overbought moderado
                    else if (rsi1h > 60) score += 5;    // Levemente overbought
                }
                
                // 6. POSIÇÃO PREÇO (máx 5)
                if (currentPrice > sr.support) {
                    const distanceToSupport = (currentPrice - sr.support) / currentPrice * 100;
                    if (distanceToSupport > 5) score += 8;       // Muito espaço
                    else if (distanceToSupport > 2) score += 5;  // Bom espaço
                }
            } else if (CONFIG.DEBUG.VERBOSE) {
                console.log(`⏸️ ${symbol} rejeitado para VENDA: CCI Diário = ${cciDaily.trend} (necessário: ${CONFIG.CCI.REQUIRED_FOR_SELL})`);
            }
        }
        
        confidence = Math.min(100, Math.max(0, score));
        
        // Verificar score mínimo
        if (!direction || confidence < CONFIG.ALERTS.MIN_SCORE) return null;
        
        // Verificar cooldown
        if (!canSendAlert(symbol, currentPrice, direction)) return null;
        
        // Calcular níveis de trade
        const { stopLoss, takeProfit1, takeProfit2, takeProfit3 } = 
            calculateTradeLevels(currentPrice, atr, direction, sr.support, sr.resistance);
        
        const riskReward = Math.abs((takeProfit1 - currentPrice) / (currentPrice - stopLoss));
        
        const emoji = getConfidenceEmoji(confidence);
        
        // Formatar tendência do CCI para exibição
        let cciDisplay = "NEUTRO";
        if (cciDaily.trend === "ALTA") cciDisplay = "CCI 💹ALTA";
        else if (cciDaily.trend === "BAIXA") cciDisplay = "CCI 🔴BAIXA";
        
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
            cciDaily: cciDisplay,
            cciValue: cciDaily.value,
            cciEma: cciDaily.ema,
            // Campos novos para Stochastic
            stochDaily: stochDailyDisplay,
            stoch4h: stoch4hDisplay,
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
    
    // Adicionar indicador visual do RSI
    const rsiStatus = alert.direction === 'COMPRA' ? 
        (alert.rsi < 45 ? '🚀' : alert.rsi < 55 ? '📈' : '⚖️') :
        (alert.rsi > 70 ? '💥' : alert.rsi > 60 ? '📉' : '⚖️');
    
    // Definir a mensagem da IA Dica baseada na direção
    const iaDica = alert.direction === 'COMPRA' 
        ? '<b>🤖 IA Dica...</b> Observar Zona do Suporte' 
        : '<b>🤖 IA Dica...</b> Realizar Lucro ou Parcial';
    
    // Usar os valores de Stochastic do alerta
    const stochDaily = alert.stochDaily || 'N/D';
    const stoch4h = alert.stoch4h || 'N/D';
    
    return `<i>${alert.emoji} <b>${dirEmoji} Analisar ${direction} - ${symbolName}</b> ${alert.emoji}
 <b>🐋Volume💱!</b> | ✨#SCORE: ${alert.confidence}%
 Alerta:${dailyCount} | ${time.full}hs
 💲Preço: $${entry}
 #RSI 1h: ${formatNumber(alert.rsi, 0)} ${rsiStatus} | #Vol: ${alert.volumeRatio.toFixed(2)}x (${volPct}%)
 #LSR: ${formatNumber(alert.lsr, 2)} | #Fund: ${fundingSign}${fundingPct}%
 📊 Gráfico Diário: ${alert.cciDaily || 'NEUTRO'}
 Stoch 1D: ${stochDaily}
 Stoch 4H: ${stoch4h}
 #Supt: ${formatPrice(alert.support)} | #Resist: ${formatPrice(alert.resistance)}
<b>Alvos</b>: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop : ${stop}
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
// === SCANNER EM TEMPO REAL MELHORADO ===
// =====================================================================
async function realTimeScanner() {
    console.log('\n🔍 Iniciando scanner em tempo real...');
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Monitorando ${symbols.length} símbolos continuamente`);
    console.log(`   - Venda necessita: ${CONFIG.CCI.REQUIRED_FOR_SELL}`);
    
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
                console.log(`✅ Alerta enviado: ${alert.symbol} ${alert.direction} (${alert.confidence}%) - RSI: ${alert.rsi.toFixed(0)} - CCI Diário: ${alert.cciDaily}`);
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
    console.log('🚀 TITANIUM ');
    console.log('='.repeat(70) + '\n');
    
    console.log('📅 Inicializando...');
    console.log(`📱 Telegram Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`📊 Risco/Retorno alvo: 1:${CONFIG.TRADE.RISK_REWARD_RATIO}\n`);
    
    // Iniciar sistema de limpeza automática
    cleanupManager.start();
    
    // Mensagem de inicialização SUPER SIMPLES
    const initMessage = `🤖 Titanium Ativado - Sistema pronto!`;
    
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
// === HANDLERS DE ERRO MELHORADOS ===
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
console.log('🚀 Iniciando Titanium Real-Time Alert System...');
startBot().catch(async error => {
    console.error('❌ Erro fatal:', error);
    
    try {
        await sendTelegramAlert(`❌ ERRO FATAL`);
    } catch {}
    
    // Parar sistema de limpeza
    cleanupManager.stop();
    process.exit(1);
});
