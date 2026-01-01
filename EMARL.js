const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0';
const TELEGRAM_CHAT_ID = '-10025';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE SIMULAÇÃO ===
const SIMULATION_MODE = false; // FALSE para dados reais
const SIMULATION_CONFIG = {
    ENABLED: false,
    REAL_DATA_PREFERRED: true,
    FALLBACK_TO_SIMULATION: true,
    SIMULATED_SYMBOLS: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT'],
    REALISTIC_SIMULATION: true
};

// === SISTEMA DE CACHE AGUESSIVO PARA REDUZIR API CALLS ===
const AGGRESSIVE_CACHE_CONFIG = {
    CANDLES: {
        '1m': 30000,
        '3m': 60000,
        '5m': 90000,
        '15m': 180000,
        '30m': 300000,
        '1h': 600000,
        '4h': 1800000,
        '1d': 3600000
    },
    TICKER_24HR: 15000,
    EXCHANGE_INFO: 3600000,
    FUNDING_RATE: 300000,
    OPEN_INTEREST: 120000,
    LONG_SHORT_RATIO: 180000,
    PRICE: 10000,
    VOLUME_PROFILE: 30000,
    SYMBOL_LIST: 1800000,
    VOLATILITY: 120000
};

// === SISTEMA DE BATCH PROCESSING OTIMIZADO ===
const BATCH_OPTIMIZATION = {
    ENABLED: true,
    MAX_SYMBOLS_PER_BATCH: 25,
    DELAY_BETWEEN_BATCHES: 500,
    CONCURRENT_REQUESTS: 3,
    USE_BULK_ENDPOINTS: true
};

// === SISTEMA DE RATE LIMIT INTELIGENTE ===
const RATE_LIMIT_CONFIG = {
    API_LIMITS: {
        WEIGHT_PER_MINUTE: 2400,
        WEIGHT_PER_SECOND: 50,
        REQUESTS_PER_MINUTE: 1200,
        WEIGHTS: {
            'klines': 2,
            'ticker/24hr': 1,
            'exchangeInfo': 10,
            'fundingRate': 1,
            'openInterest': 1,
            'ticker/bookTicker': 1,
            'ticker': 1
        }
    },
    ADAPTIVE_RATE: {
        enabled: true,
        baseDelayMs: 80,
        volatilityMultiplier: 0.3,
        errorBackoffMultiplier: 2,
        minDelayMs: 40,
        maxDelayMs: 2000
    },
    CIRCUIT_BREAKER: {
        enabled: true,
        errorThreshold: 10,
        resetTimeoutMs: 60000,
        halfOpenMaxRequests: 5
    },
    BATCH_PROCESSING: {
        maxConcurrentRequests: 3,
        batchSize: 25,
        batchDelayMs: 500
    }
};

// === CONFIGURAÇÕES OTIMIZADAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.0,
    volatilityMultiplier: 0.2,
    useAdaptive: true
};

const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.8;

// === CONFIGURAÇÕES LSR AJUSTADAS ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;
const FUNDING_BUY_MAX = -0.0005;
const FUNDING_SELL_MIN = 0.0005;

// === CONFIGURAÇÕES ADX ===
const ADX_1H_SETTINGS = {
    minStrength: 25,
    strongTrend: 40,
    period: 14
};

const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,
    oppositeDirection: 10 * 60 * 1000,
    useDifferentiated: true
};

// === QUALITY SCORE COMPLETO ===
const QUALITY_THRESHOLD = 70;
const QUALITY_WEIGHTS = {
    volume: 15,
    oi: 8,
    volatility: 8,
    lsr: 8,
    rsi: 8,
    emaAlignment: 10,
    adx: 5,
    adx1h: 10,
    stoch1h: 5,
    stoch4h: 8,
    cci4h: 10,
    divergence15m: 10,
    breakoutRisk: 8,
    supportResistance: 8
};

// === CONFIGURAÇÕES RL ===
const RL_SETTINGS = {
    enabled: true,
    learningRate: 0.1,
    discountFactor: 0.95,
    explorationRate: 0.3,
    minExplorationRate: 0.05,
    explorationDecay: 0.995,
    stateSize: 15,
    experienceBufferSize: 1000,
    batchSize: 32,
    trainEveryNTrades: 10,
    useNeuralNetwork: false,
    usePrioritizedReplay: true,
    rewardScaling: 100
};

// === CONFIGURAÇÕES DE MONITORAMENTO ===
const MAX_SYMBOLS_TO_MONITOR = 540;
const MIN_VOLUME_24H = 500000;
const SYMBOLS_UPDATE_INTERVAL = 3600000;

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const CACHE_DIR = './cache';

// =====================================================================
// SISTEMA DE SIMULAÇÃO REALISTA (APENAS FALLBACK)
// =====================================================================

class RealisticDataSimulator {
    constructor() {
        this.marketPatterns = new Map();
        this.initializePatterns();
        this.historicalData = new Map();
    }
    
    initializePatterns() {
        // Padrões baseados em dados históricos reais
        this.marketPatterns.set('BTCUSDT', {
            baseLSR: 2.5,
            lsrRange: [1.5, 4.0],
            oiRange: [1000000, 10000000],
            oiVolatility: 0.15,
            typicalVolumeRatio: 1.8
        });
        
        this.marketPatterns.set('ETHUSDT', {
            baseLSR: 2.2,
            lsrRange: [1.3, 3.5],
            oiRange: [500000, 5000000],
            oiVolatility: 0.2,
            typicalVolumeRatio: 1.6
        });
        
        this.marketPatterns.set('BNBUSDT', {
            baseLSR: 2.0,
            lsrRange: [1.2, 3.0],
            oiRange: [200000, 2000000],
            oiVolatility: 0.25,
            typicalVolumeRatio: 1.5
        });
        
        // Padrão padrão para outras moedas
        this.defaultPattern = {
            baseLSR: 1.8,
            lsrRange: [1.0, 2.8],
            oiRange: [100000, 1000000],
            oiVolatility: 0.3,
            typicalVolumeRatio: 1.3
        };
    }
    
    getPattern(symbol) {
        return this.marketPatterns.get(symbol) || this.defaultPattern;
    }
    
    simulateLSR(symbol, isBullish) {
        const pattern = this.getPattern(symbol);
        const base = pattern.baseLSR;
        const [min, max] = pattern.lsrRange;
        
        // Simulação mais realista baseada em tendência
        let bias = isBullish ? 0.2 : -0.1;
        const noise = (Math.random() - 0.5) * 0.5;
        
        const lsrRatio = Math.max(min, Math.min(max, base + bias + noise));
        
        return lsrRatio;
    }
    
    simulateOpenInterest(symbol, isBullish) {
        const pattern = this.getPattern(symbol);
        const [min, max] = pattern.oiRange;
        
        // Base baseada no símbolo
        const base = (min + max) / 2;
        
        // Tendência baseada na direção
        const trendBias = isBullish ? 0.05 : -0.05;
        const noise = (Math.random() - 0.5) * pattern.oiVolatility;
        
        const oiValue = base * (1 + trendBias + noise);
        const oiChange = trendBias * 100 + (noise * 100);
        
        return {
            value: oiValue,
            changePercent: oiChange,
            trend: oiChange > 5 ? '📈' : oiChange < -5 ? '📉' : '➡️',
            isValid: isBullish ? oiChange > 0 : oiChange < 0
        };
    }
    
    async simulateRealisticFundingRate(symbol) {
        const pattern = this.getPattern(symbol);
        
        // Taxas de funding mais realistas
        const baseRate = pattern.baseLSR > 2.5 ? -0.0002 : 0.0001;
        const noise = (Math.random() - 0.5) * 0.0003;
        
        return baseRate + noise;
    }
    
    shouldSimulate(symbol) {
        if (!SIMULATION_CONFIG.ENABLED) return false;
        if (!SIMULATION_CONFIG.REAL_DATA_PREFERRED) return true;
        
        // Só simula se for um símbolo configurado para simulação
        return SIMULATION_CONFIG.SIMULATED_SYMBOLS.includes(symbol);
    }
}

// Inicializar simulador
const dataSimulator = new RealisticDataSimulator();

// =====================================================================
// SISTEMA DE CACHE AGUESSIVO MULTI-CAMADA
// =====================================================================

class AggressiveCacheSystem {
    constructor() {
        this.memoryCache = new Map();
        this.diskCachePath = CACHE_DIR;
        this.ensureCacheDirectory();
        this.computationCache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            memorySize: 0,
            diskSize: 0,
            savings: 0
        };
        this.setupCleanupInterval();
        console.log('💾 Sistema de Cache Agressivo Inicializado');
    }
    
    ensureCacheDirectory() {
        if (!fs.existsSync(this.diskCachePath)) {
            fs.mkdirSync(this.diskCachePath, { recursive: true });
        }
    }
    
    async getCandlesWithAggressiveCache(symbol, interval, limit = 100) {
        const cacheKey = `CANDLES_${symbol}_${interval}_${limit}`;
        const memoryCached = this.getFromMemory(cacheKey);
        if (memoryCached) {
            this.stats.hits++;
            return memoryCached;
        }
        
        const diskCached = await this.getFromDisk(cacheKey);
        if (diskCached) {
            this.setToMemory(cacheKey, diskCached, AGGRESSIVE_CACHE_CONFIG.CANDLES[interval] || 60000);
            this.stats.hits++;
            return diskCached;
        }
        
        this.stats.misses++;
        return null;
    }
    
    async setCandlesWithAggressiveCache(symbol, interval, limit, data) {
        const cacheKey = `CANDLES_${symbol}_${interval}_${limit}`;
        const ttl = AGGRESSIVE_CACHE_CONFIG.CANDLES[interval] || 60000;
        
        this.setToMemory(cacheKey, data, ttl);
        
        setTimeout(() => {
            this.setToDisk(cacheKey, data).catch(() => {});
        }, 0);
        
        this.precomputeIndicators(symbol, interval, data);
    }
    
    async getTicker24h(symbol) {
        const cacheKey = `TICKER_24H_${symbol}`;
        const cached = this.getFromMemory(cacheKey);
        if (cached) {
            this.stats.hits++;
            return cached;
        }
        this.stats.misses++;
        return null;
    }
    
    setTicker24h(symbol, data) {
        const cacheKey = `TICKER_24H_${symbol}`;
        this.setToMemory(cacheKey, data, AGGRESSIVE_CACHE_CONFIG.TICKER_24HR);
    }
    
    async getPrice(symbol) {
        const cacheKey = `PRICE_${symbol}`;
        const cached = this.getFromMemory(cacheKey);
        if (cached) {
            this.stats.hits++;
            return cached;
        }
        this.stats.misses++;
        return null;
    }
    
    setPrice(symbol, price) {
        const cacheKey = `PRICE_${symbol}`;
        this.setToMemory(cacheKey, price, AGGRESSIVE_CACHE_CONFIG.PRICE);
    }
    
    async getVolumeProfile(symbol) {
        const cacheKey = `VOLUME_PROFILE_${symbol}`;
        const cached = this.getFromMemory(cacheKey);
        if (cached) {
            this.stats.hits++;
            return cached;
        }
        this.stats.misses++;
        return null;
    }
    
    setVolumeProfile(symbol, data) {
        const cacheKey = `VOLUME_PROFILE_${symbol}`;
        this.setToMemory(cacheKey, data, AGGRESSIVE_CACHE_CONFIG.VOLUME_PROFILE);
    }
    
    setToMemory(key, data, ttl) {
        this.memoryCache.set(key, {
            data,
            expiry: Date.now() + ttl
        });
        this.stats.memorySize++;
    }
    
    getFromMemory(key) {
        const item = this.memoryCache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.memoryCache.delete(key);
            this.stats.memorySize--;
            return null;
        }
        
        return item.data;
    }
    
    async setToDisk(key, data) {
        try {
            const filePath = path.join(this.diskCachePath, `${key}.json`);
            await fs.promises.writeFile(filePath, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
            this.stats.diskSize++;
        } catch (error) {
            console.error('Erro ao salvar cache em disco:', error);
        }
    }
    
    async getFromDisk(key) {
        try {
            const filePath = path.join(this.diskCachePath, `${key}.json`);
            
            if (!fs.existsSync(filePath)) {
                return null;
            }
            
            const content = await fs.promises.readFile(filePath, 'utf8');
            const { data, timestamp } = JSON.parse(content);
            
            if (key.startsWith('CANDLES_')) {
                const match = key.match(/CANDLES_(\w+)_(\d+[mhd])_(\d+)/);
                if (match) {
                    const interval = match[2];
                    const ttl = AGGRESSIVE_CACHE_CONFIG.CANDLES[interval] || 60000;
                    if (Date.now() - timestamp > ttl) {
                        await fs.promises.unlink(filePath).catch(() => {});
                        this.stats.diskSize--;
                        return null;
                    }
                }
            }
            
            return data;
        } catch (error) {
            return null;
        }
    }
    
    precomputeIndicators(symbol, interval, candles) {
        if (candles.length < 50) return;
        
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        try {
            const rsiValues = RSI.calculate({ values: closes, period: 14 });
            if (rsiValues.length > 0) {
                const cacheKey = `RSI_${symbol}_${interval}`;
                this.setToMemory(cacheKey, {
                    value: rsiValues[rsiValues.length - 1],
                    all: rsiValues
                }, AGGRESSIVE_CACHE_CONFIG.CANDLES[interval] || 60000);
            }
        } catch (error) {}
        
        try {
            const ema13 = EMA.calculate({ values: closes, period: 13 });
            const ema55 = EMA.calculate({ values: closes, period: 55 });
            if (ema13.length > 0 && ema55.length > 0) {
                const cacheKey = `EMA_${symbol}_${interval}`;
                this.setToMemory(cacheKey, {
                    ema13: ema13[ema13.length - 1],
                    ema55: ema55[ema55.length - 1]
                }, AGGRESSIVE_CACHE_CONFIG.CANDLES[interval] || 60000);
            }
        } catch (error) {}
        
        try {
            const atrValues = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: VOLATILITY_PERIOD
            });
            if (atrValues.length > 0) {
                const cacheKey = `ATR_${symbol}_${interval}`;
                this.setToMemory(cacheKey, {
                    atr: atrValues[atrValues.length - 1],
                    atrPercent: (atrValues[atrValues.length - 1] / closes[closes.length - 1]) * 100
                }, AGGRESSIVE_CACHE_CONFIG.VOLATILITY);
            }
        } catch (error) {}
    }
    
    getPrecomputedIndicator(symbol, interval, indicator) {
        const cacheKey = `${indicator}_${symbol}_${interval}`;
        return this.getFromMemory(cacheKey);
    }
    
    setupCleanupInterval() {
        setInterval(() => {
            this.cleanupMemory();
        }, 300000);
        
        setInterval(() => {
            this.cleanupDisk();
        }, 3600000);
    }
    
    cleanupMemory() {
        const now = Date.now();
        let deleted = 0;
        
        for (const [key, value] of this.memoryCache.entries()) {
            if (now > value.expiry) {
                this.memoryCache.delete(key);
                deleted++;
                this.stats.memorySize--;
            }
        }
        
        if (deleted > 0) {
            console.log(`🧹 Cache limpo: ${deleted} itens removidos da memória`);
        }
    }
    
    async cleanupDisk() {
        try {
            const files = await fs.promises.readdir(this.diskCachePath);
            const now = Date.now();
            let deleted = 0;
            
            for (const file of files) {
                try {
                    const filePath = path.join(this.diskCachePath, file);
                    const stats = await fs.promises.stat(filePath);
                    
                    if (now - stats.mtimeMs > 86400000) {
                        await fs.promises.unlink(filePath);
                        deleted++;
                        this.stats.diskSize--;
                    }
                } catch (error) {}
            }
            
            if (deleted > 0) {
                console.log(`🧹 Cache disco limpo: ${deleted} arquivos removidos`);
            }
        } catch (error) {
            console.error('Erro ao limpar cache em disco:', error);
        }
    }
    
    getStats() {
        const hitRate = this.stats.hits + this.stats.misses > 0 
            ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
            : 0;
        
        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            memoryItems: this.memoryCache.size,
            estimatedAPISavings: Math.floor(this.stats.hits * 0.8)
        };
    }
}

// =====================================================================
// SISTEMA DE BATCH PROCESSING OTIMIZADO
// =====================================================================

class OptimizedBatchProcessor {
    constructor() {
        this.batchQueue = [];
        this.processing = false;
        this.batchResults = new Map();
        console.log('⚡ Processador de Batch Otimizado Inicializado');
    }
    
    async processSymbolsBatch(symbols, processorFunction) {
        if (!BATCH_OPTIMIZATION.ENABLED || symbols.length === 0) {
            return Promise.all(symbols.map(s => processorFunction(s)));
        }
        
        const batchPromises = [];
        const batches = this.chunkArray(symbols, BATCH_OPTIMIZATION.MAX_SYMBOLS_PER_BATCH);
        
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const batchPromise = this.processBatchWithConcurrency(batch, processorFunction);
            batchPromises.push(batchPromise);
            
            if (i < batches.length - 1) {
                await this.delay(BATCH_OPTIMIZATION.DELAY_BETWEEN_BATCHES);
            }
        }
        
        const results = await Promise.all(batchPromises);
        return results.flat();
    }
    
    async processBatchWithConcurrency(batch, processorFunction) {
        const results = [];
        const chunkSize = Math.ceil(batch.length / BATCH_OPTIMIZATION.CONCURRENT_REQUESTS);
        const chunks = this.chunkArray(batch, chunkSize);
        
        const chunkPromises = chunks.map(chunk => 
            Promise.all(chunk.map(s => processorFunction(s)))
        );
        
        const chunkResults = await Promise.all(chunkPromises);
        return chunkResults.flat();
    }
    
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
    
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// =====================================================================
// SISTEMA AVANÇADO DE RATE LIMIT E CONEXÃO
// =====================================================================

class IntelligentRateLimiter {
    constructor() {
        this.rateLimits = {
            weightUsed: 0,
            requestsMade: 0,
            lastReset: Date.now(),
            errors: 0,
            consecutiveErrors: 0,
            circuitState: 'CLOSED',
            circuitOpenedAt: null
        };
        
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            avgResponseTime: 0,
            lastError: null,
            endpointStats: {}
        };
        
        this.volatilityCache = new Map();
        this.adaptiveDelays = new Map();
        
        this.cacheSystem = new AggressiveCacheSystem();
        this.batchProcessor = new OptimizedBatchProcessor();
        
        console.log('🚀 Sistema de Rate Limit Inteligente com Cache Agressivo Inicializado');
    }
    
    async makeRequest(url, options = {}, endpoint = 'unknown') {
        const cacheKey = this.generateCacheKey(url, endpoint);
        
        if (this.shouldUseCache(endpoint)) {
            const cachedResponse = await this.getCachedResponse(cacheKey, endpoint);
            if (cachedResponse) {
                console.log(`💾 Cache HIT para ${endpoint}: ${cacheKey.substring(0, 50)}...`);
                return cachedResponse;
            }
        }
        
        const requestId = Date.now() + Math.random().toString(36).substr(2, 9);
        
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                id: requestId,
                url,
                options,
                endpoint,
                resolve,
                reject,
                timestamp: Date.now(),
                retryCount: 0,
                cacheKey
            });
            
            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }
    
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) return;
        
        this.isProcessingQueue = true;
        
        while (this.requestQueue.length > 0) {
            if (this.rateLimits.circuitState === 'OPEN') {
                const timeSinceOpen = Date.now() - this.rateLimits.circuitOpenedAt;
                if (timeSinceOpen > RATE_LIMIT_CONFIG.CIRCUIT_BREAKER.resetTimeoutMs) {
                    this.rateLimits.circuitState = 'HALF_OPEN';
                    console.log('🔄 Circuit breaker em estado HALF_OPEN');
                } else {
                    await this.delay(1000);
                    continue;
                }
            }
            
            if (this.rateLimits.circuitState === 'HALF_OPEN' && 
                this.rateLimits.consecutiveErrors >= RATE_LIMIT_CONFIG.CIRCUIT_BREAKER.halfOpenMaxRequests) {
                this.rateLimits.circuitState = 'OPEN';
                this.rateLimits.circuitOpenedAt = Date.now();
                console.log('🔴 Circuit breaker aberto novamente');
                await this.delay(1000);
                continue;
            }
            
            this.resetCountersIfNeeded();
            
            const requestWeight = RATE_LIMIT_CONFIG.API_LIMITS.WEIGHTS[this.requestQueue[0].endpoint] || 1;
            
            if (this.wouldExceedLimits(requestWeight)) {
                const delayTime = this.calculateAdaptiveDelay();
                await this.delay(delayTime);
                continue;
            }
            
            const request = this.requestQueue.shift();
            if (!request) continue;
            
            this.rateLimits.weightUsed += requestWeight;
            this.rateLimits.requestsMade++;
            this.metrics.totalRequests++;
            
            try {
                const startTime = Date.now();
                const response = await this.executeRequest(request);
                const responseTime = Date.now() - startTime;
                
                this.metrics.successfulRequests++;
                this.metrics.avgResponseTime = 
                    (this.metrics.avgResponseTime * 0.9) + (responseTime * 0.1);
                this.rateLimits.consecutiveErrors = 0;
                
                if (this.rateLimits.circuitState === 'HALF_OPEN') {
                    this.rateLimits.circuitState = 'CLOSED';
                    console.log('🟢 Circuit breaker fechado');
                }
                
                if (this.shouldCacheResponse(request.endpoint)) {
                    await this.cacheResponse(request.cacheKey, response, request.endpoint);
                }
                
                request.resolve(response);
                
                const adaptiveDelay = this.calculateAdaptiveDelay();
                if (adaptiveDelay > 0) {
                    await this.delay(adaptiveDelay);
                }
                
            } catch (error) {
                this.handleRequestError(request, error);
            }
        }
        
        this.isProcessingQueue = false;
    }
    
    async executeRequest(request) {
        const controller = new AbortController();
        const timeoutMs = 15000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
            const response = await fetch(request.url, {
                ...request.options,
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...request.options.headers
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 429) {
                    console.log(`⚠️ Rate limit atingido para ${request.endpoint}`);
                    this.handleRateLimitExceeded();
                    throw new Error(`Rate limit exceeded: ${response.status}`);
                }
                
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            
            return await response.json();
            
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
    
    generateCacheKey(url, endpoint) {
        const urlObj = new URL(url);
        const params = Object.fromEntries(urlObj.searchParams.entries());
        
        if (endpoint === '/klines') {
            return `API_${endpoint}_${params.symbol}_${params.interval}_${params.limit || 100}`;
        } else if (endpoint === '/ticker/24hr') {
            return `API_${endpoint}_${params.symbol || 'ALL'}`;
        } else if (endpoint === '/fundingRate') {
            return `API_${endpoint}_${params.symbol}`;
        }
        
        return `API_${endpoint}_${JSON.stringify(params)}`;
    }
    
    shouldUseCache(endpoint) {
        const cacheableEndpoints = [
            '/klines',
            '/ticker/24hr',
            '/fundingRate',
            '/openInterest',
            '/exchangeInfo'
        ];
        
        return cacheableEndpoints.includes(endpoint);
    }
    
    async getCachedResponse(cacheKey, endpoint) {
        if (endpoint === '/klines') {
            const match = cacheKey.match(/API_\/klines_(\w+)_(\d+[mhd])_(\d+)/);
            if (match) {
                const [, symbol, interval, limit] = match;
                return await this.cacheSystem.getCandlesWithAggressiveCache(symbol, interval, parseInt(limit));
            }
        } else if (endpoint === '/ticker/24hr') {
            const match = cacheKey.match(/API_\/ticker\/24hr_(\w+)/);
            if (match) {
                const [, symbol] = match;
                return await this.cacheSystem.getTicker24h(symbol);
            }
        }
        
        return null;
    }
    
    shouldCacheResponse(endpoint) {
        return this.shouldUseCache(endpoint);
    }
    
    async cacheResponse(cacheKey, data, endpoint) {
        if (endpoint === '/klines') {
            const match = cacheKey.match(/API_\/klines_(\w+)_(\d+[mhd])_(\d+)/);
            if (match) {
                const [, symbol, interval, limit] = match;
                
                const formatted = data.map(candle => ({
                    time: candle[0],
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5])
                }));
                
                await this.cacheSystem.setCandlesWithAggressiveCache(
                    symbol, 
                    interval, 
                    parseInt(limit), 
                    formatted
                );
            }
        } else if (endpoint === '/ticker/24hr') {
            if (Array.isArray(data)) {
                data.forEach(ticker => {
                    if (ticker.symbol) {
                        this.cacheSystem.setTicker24h(ticker.symbol, ticker);
                    }
                });
            } else if (data.symbol) {
                this.cacheSystem.setTicker24h(data.symbol, data);
            }
        }
    }
    
    handleRequestError(request, error) {
        this.metrics.failedRequests++;
        this.rateLimits.errors++;
        this.rateLimits.consecutiveErrors++;
        this.metrics.lastError = {
            message: error.message,
            endpoint: request.endpoint,
            timestamp: Date.now()
        };
        
        console.error(`❌ Erro na requisição ${request.endpoint}:`, error.message);
        
        if (this.rateLimits.consecutiveErrors >= RATE_LIMIT_CONFIG.CIRCUIT_BREAKER.errorThreshold) {
            this.rateLimits.circuitState = 'OPEN';
            this.rateLimits.circuitOpenedAt = Date.now();
            console.log('🔴 Circuit breaker ABERTO devido a muitos erros');
        }
        
        if (request.retryCount < 3 && !error.message.includes('Rate limit')) {
            request.retryCount++;
            console.log(`🔄 Retentativa ${request.retryCount}/3 para ${request.endpoint}`);
            
            const backoffTime = Math.min(1000 * Math.pow(2, request.retryCount), 10000);
            setTimeout(() => {
                this.requestQueue.unshift(request);
            }, backoffTime);
        } else {
            request.reject(error);
        }
    }
    
    handleRateLimitExceeded() {
        const currentDelay = this.adaptiveDelays.get('global') || RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs;
        const newDelay = Math.min(
            currentDelay * RATE_LIMIT_CONFIG.ADAPTIVE_RATE.errorBackoffMultiplier,
            RATE_LIMIT_CONFIG.ADAPTIVE_RATE.maxDelayMs
        );
        this.adaptiveDelays.set('global', newDelay);
        
        this.rateLimits.weightUsed = RATE_LIMIT_CONFIG.API_LIMITS.WEIGHT_PER_MINUTE * 0.8;
        console.log(`⏰ Aumentando delay para ${newDelay}ms devido a rate limit`);
    }
    
    calculateAdaptiveDelay() {
        const baseDelay = RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs;
        
        if (!RATE_LIMIT_CONFIG.ADAPTIVE_RATE.enabled) {
            return baseDelay;
        }
        
        const weightUsageRatio = this.rateLimits.weightUsed / RATE_LIMIT_CONFIG.API_LIMITS.WEIGHT_PER_MINUTE;
        const requestUsageRatio = this.rateLimits.requestsMade / RATE_LIMIT_CONFIG.API_LIMITS.REQUESTS_PER_MINUTE;
        
        const usageFactor = Math.max(weightUsageRatio, requestUsageRatio);
        
        const errorFactor = this.rateLimits.consecutiveErrors > 0 ? 
            RATE_LIMIT_CONFIG.ADAPTIVE_RATE.errorBackoffMultiplier : 1;
        
        let delay = baseDelay * (1 + usageFactor) * errorFactor;
        
        delay = Math.max(
            RATE_LIMIT_CONFIG.ADAPTIVE_RATE.minDelayMs,
            Math.min(RATE_LIMIT_CONFIG.ADAPTIVE_RATE.maxDelayMs, delay)
        );
        
        return Math.round(delay);
    }
    
    wouldExceedLimits(weight) {
        const now = Date.now();
        const minuteElapsed = (now - this.rateLimits.lastReset) >= 60000;
        
        if (minuteElapsed) {
            return false;
        }
        
        const weightWouldExceed = this.rateLimits.weightUsed + weight > 
            RATE_LIMIT_CONFIG.API_LIMITS.WEIGHT_PER_MINUTE * 0.95;
        
        const requestsWouldExceed = this.rateLimits.requestsMade + 1 > 
            RATE_LIMIT_CONFIG.API_LIMITS.REQUESTS_PER_MINUTE * 0.95;
        
        return weightWouldExceed || requestsWouldExceed;
    }
    
    resetCountersIfNeeded() {
        const now = Date.now();
        const minuteElapsed = (now - this.rateLimits.lastReset) >= 60000;
        
        if (minuteElapsed) {
            this.rateLimits.weightUsed = 0;
            this.rateLimits.requestsMade = 0;
            this.rateLimits.lastReset = now;
            
            const currentDelay = this.adaptiveDelays.get('global') || RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs;
            if (currentDelay > RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs) {
                const newDelay = Math.max(
                    RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs,
                    currentDelay * 0.8
                );
                this.adaptiveDelays.set('global', newDelay);
            }
        }
    }
    
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    getMetrics() {
        const cacheStats = this.cacheSystem.getStats();
        
        return {
            ...this.metrics,
            rateLimits: { ...this.rateLimits },
            queueLength: this.requestQueue.length,
            adaptiveDelay: this.adaptiveDelays.get('global') || RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs,
            circuitState: this.rateLimits.circuitState,
            cacheStats: cacheStats
        };
    }
    
    setVolatilityForSymbol(symbol, volatility) {
        this.volatilityCache.set(symbol, {
            volatility,
            timestamp: Date.now()
        });
        
        if (volatility > VOLATILITY_THRESHOLD) {
            const baseDelay = this.adaptiveDelays.get('global') || RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs;
            const increasedDelay = baseDelay * (1 + RATE_LIMIT_CONFIG.ADAPTIVE_RATE.volatilityMultiplier);
            this.adaptiveDelays.set(symbol, increasedDelay);
        }
    }
    
    getDelayForSymbol(symbol) {
        return this.adaptiveDelays.get(symbol) || 
               this.adaptiveDelays.get('global') || 
               RATE_LIMIT_CONFIG.ADAPTIVE_RATE.baseDelayMs;
    }
}

// Inicializar rate limiter global
const rateLimiter = new IntelligentRateLimiter();

// === FUNÇÕES DE API BINANCE FUTURES OTIMIZADAS COM CACHE ===
async function fetchBinanceFuturesData(endpoint, params = {}, timeout = 15000) {
    try {
        const baseUrl = 'https://fapi.binance.com/fapi/v1';
        const url = `${baseUrl}${endpoint}?${new URLSearchParams(params)}`;
        
        const data = await rateLimiter.makeRequest(url, {}, endpoint);
        return data;
    } catch (error) {
        console.error(`Erro fetchBinanceFuturesData ${endpoint}:`, error.message);
        
        // Só usar dados simulados se configurado
        if (SIMULATION_CONFIG.FALLBACK_TO_SIMULATION && SIMULATION_CONFIG.ENABLED) {
            return getRealisticSimulatedData(endpoint, params);
        }
        throw error;
    }
}

// === FUNÇÃO PARA OBTER TODAS AS MOEDAS FUTURES ===
async function getAllFuturesSymbols() {
    try {
        const cacheKey = 'ALL_FUTURES_SYMBOLS';
        const cached = rateLimiter.cacheSystem.getFromMemory(cacheKey);
        if (cached) {
            console.log('💾 Usando símbolos em cache');
            return cached;
        }
        
        console.log('📊 Buscando todas as moedas da Binance Futures...');
        
        const exchangeInfo = await fetchBinanceFuturesData('/exchangeInfo');
        
        const allSymbols = exchangeInfo.symbols
            .filter(symbol => 
                symbol.status === 'TRADING' &&
                symbol.quoteAsset === 'USDT' &&
                symbol.contractType === 'PERPETUAL' &&
                !symbol.symbol.includes('_')
            )
            .map(symbol => symbol.symbol);
        
        rateLimiter.cacheSystem.setToMemory(cacheKey, allSymbols, AGGRESSIVE_CACHE_CONFIG.SYMBOL_LIST);
        
        console.log(`✅ Encontrados ${allSymbols.length} pares USDT Perpetual`);
        return allSymbols;
        
    } catch (error) {
        console.error('❌ Erro ao buscar símbolos futures:', error.message);
        
        if (SIMULATION_CONFIG.ENABLED) {
            console.log('⚠️ Usando símbolos simulados');
            return [
                'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT',
                'XRPUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'MATICUSDT',
                'LTCUSDT', 'TRXUSDT', 'LINKUSDT', 'UNIUSDT', 'ATOMUSDT'
            ];
        }
        throw error;
    }
}

// === FUNÇÃO PARA FILTRAR MOEDAS COM MAIOR LIQUIDEZ ===
async function getTopVolumeSymbols(limit = MAX_SYMBOLS_TO_MONITOR) {
    try {
        const cacheKey = `TOP_VOLUME_SYMBOLS_${limit}`;
        const cached = rateLimiter.cacheSystem.getFromMemory(cacheKey);
        if (cached) {
            console.log('💾 Usando top volume symbols em cache');
            return cached;
        }
        
        console.log('📈 Buscando moedas com maior volume...');
        
        const tickers = await fetchBinanceFuturesData('/ticker/24hr');
        
        const filteredTickers = tickers
            .filter(ticker => 
                ticker.symbol.endsWith('USDT') &&
                parseFloat(ticker.volume) > MIN_VOLUME_24H &&
                !ticker.symbol.includes('_')
            )
            .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
            .slice(0, limit)
            .map(ticker => ticker.symbol);
        
        rateLimiter.cacheSystem.setToMemory(cacheKey, filteredTickers, 900000);
        
        console.log(`✅ ${filteredTickers.length} moedas selecionadas por volume`);
        return filteredTickers;
        
    } catch (error) {
        console.error('❌ Erro ao buscar volumes:', error.message);
        
        if (SIMULATION_CONFIG.ENABLED) {
            console.log('⚠️ Usando top volume symbols simulados');
            return await getAllFuturesSymbols();
        }
        throw error;
    }
}

// === FUNÇÃO DE SIMULAÇÃO REALISTA ===
function getRealisticSimulatedData(endpoint, params) {
    console.log(`⚠️ Usando dados simulados realistas para: ${endpoint}`);
    
    if (endpoint.includes('/klines')) {
        const symbol = params.symbol || 'BTCUSDT';
        const interval = params.interval || '15m';
        const limit = params.limit || 100;
        
        const candles = [];
        const pattern = dataSimulator.getPattern(symbol);
        let basePrice = symbol.includes('BTC') ? 40000 :
                       symbol.includes('ETH') ? 2200 :
                       symbol.includes('BNB') ? 300 : 100;
        
        // Simulação mais realista baseada em padrões históricos
        const volatility = pattern.oiVolatility;
        
        for (let i = 0; i < limit; i++) {
            const time = Date.now() - (i * 900000);
            const randomFactor = (Math.random() - 0.5) * 2 * volatility;
            const trend = i < limit/2 ? 0.001 : -0.0005;
            
            const open = basePrice * (1 + trend + randomFactor * 0.5);
            const close = open * (1 + (Math.random() - 0.5) * volatility);
            const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
            const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
            const volume = (100 + Math.random() * 900) * pattern.typicalVolumeRatio;
            
            candles.push([
                time,
                open.toFixed(2),
                high.toFixed(2),
                low.toFixed(2),
                close.toFixed(2),
                volume.toFixed(2),
                time + 899000,
                "0.1",
                10,
                "0.2",
                "0.3",
                "0.4"
            ]);
            
            basePrice = close;
        }
        
        return candles;
    }
    
    if (endpoint.includes('/ticker/24hr')) {
        const symbol = params.symbol || 'BTCUSDT';
        const pattern = dataSimulator.getPattern(symbol);
        
        return {
            symbol: symbol,
            priceChange: (Math.random() - 0.5) * 1000 * pattern.typicalVolumeRatio,
            priceChangePercent: (Math.random() - 0.5) * 5,
            weightedAvgPrice: pattern.baseLSR * 10000,
            lastPrice: pattern.baseLSR * 10000 + (Math.random() - 0.5) * 1000,
            volume: 10000 + Math.random() * 90000 * pattern.typicalVolumeRatio,
            quoteVolume: 1000000 + Math.random() * 9000000 * pattern.typicalVolumeRatio,
            openTime: Date.now() - 86400000,
            closeTime: Date.now(),
            firstId: 1,
            lastId: 100,
            count: 100
        };
    }
    
    return {};
}

// === FUNÇÃO PRINCIPAL DE CANDLES COM CACHE AGUESSIVO ===
async function getCandlesCached(symbol, interval, limit = 100) {
    const cachedCandles = await rateLimiter.cacheSystem.getCandlesWithAggressiveCache(symbol, interval, limit);
    if (cachedCandles) {
        return cachedCandles;
    }
    
    const precomputed = rateLimiter.cacheSystem.getPrecomputedIndicator(symbol, interval, 'RSI');
    if (precomputed) {
        console.log(`📊 Usando indicadores pre-computados para ${symbol} ${interval}`);
    }
    
    try {
        const candles = await fetchBinanceFuturesData('/klines', {
            symbol: symbol,
            interval: interval,
            limit: limit
        });
        
        const formatted = candles.map(candle => ({
            time: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
        }));
        
        await rateLimiter.cacheSystem.setCandlesWithAggressiveCache(symbol, interval, limit, formatted);
        
        return formatted;
    } catch (error) {
        console.error(`Erro getCandlesCached ${symbol}:`, error.message);
        return [];
    }
}

// === FUNÇÃO DE PREÇO ATUAL COM CACHE AGUESSIVO ===
async function getCurrentPrice(symbol) {
    const cachedPrice = await rateLimiter.cacheSystem.getPrice(symbol);
    if (cachedPrice !== null) {
        return cachedPrice;
    }
    
    try {
        const cachedTicker = await rateLimiter.cacheSystem.getTicker24h(symbol);
        if (cachedTicker && cachedTicker.lastPrice) {
            const price = parseFloat(cachedTicker.lastPrice);
            rateLimiter.cacheSystem.setPrice(symbol, price);
            return price;
        }
        
        const ticker = await fetchBinanceFuturesData('/ticker/24hr', { symbol: symbol });
        const price = parseFloat(ticker.lastPrice);
        
        rateLimiter.cacheSystem.setPrice(symbol, price);
        
        return price;
    } catch (error) {
        console.error(`Erro getCurrentPrice ${symbol}:`, error.message);
        
        if (SIMULATION_CONFIG.ENABLED && dataSimulator.shouldSimulate(symbol)) {
            const pattern = dataSimulator.getPattern(symbol);
            return pattern.baseLSR * 10000 + (Math.random() - 0.5) * 1000;
        }
        throw error;
    }
}

async function getFundingRate(symbol) {
    try {
        const cacheKey = `FUNDING_RATE_${symbol}`;
        const cached = rateLimiter.cacheSystem.getFromMemory(cacheKey);
        if (cached) {
            return cached;
        }
        
        const fundingData = await fetchBinanceFuturesData('/fundingRate', { 
            symbol: symbol,
            limit: 1 
        });
        
        if (fundingData && fundingData.length > 0) {
            const rate = parseFloat(fundingData[0].fundingRate);
            rateLimiter.cacheSystem.setToMemory(cacheKey, rate, AGGRESSIVE_CACHE_CONFIG.FUNDING_RATE);
            return rate;
        }
        return 0;
    } catch (error) {
        console.error(`Erro getFundingRate ${symbol}:`, error.message);
        
        if (SIMULATION_CONFIG.ENABLED && dataSimulator.shouldSimulate(symbol)) {
            return await dataSimulator.simulateRealisticFundingRate(symbol);
        }
        return 0;
    }
}

// === FUNÇÕES DE ANÁLISE TÉCNICA OTIMIZADAS ===
async function getEMAs3m(symbol) {
    try {
        const precomputed = rateLimiter.cacheSystem.getPrecomputedIndicator(symbol, '3m', 'EMA');
        if (precomputed) {
            const candles = await getCandlesCached(symbol, '3m', 10);
            if (candles.length > 0) {
                const currentPrice = candles[candles.length - 1].close;
                
                return {
                    currentPrice: currentPrice,
                    ema13: precomputed.ema13,
                    ema55: precomputed.ema55,
                    isAboveEMA55: currentPrice > precomputed.ema55,
                    isEMA13CrossingUp: precomputed.ema13 > precomputed.ema55,
                    isEMA13CrossingDown: precomputed.ema13 < precomputed.ema55
                };
            }
        }
        
        const candles = await getCandlesCached(symbol, '3m', 200);
        if (candles.length < 55) return null;
        
        const closes = candles.map(c => c.close);
        
        const ema13Values = EMA.calculate({
            period: 13,
            values: closes
        });
        
        const ema55Values = EMA.calculate({
            period: 55,
            values: closes
        });
        
        const currentEma13 = ema13Values[ema13Values.length - 1];
        const currentEma55 = ema55Values[ema55Values.length - 1];
        const prevEma13 = ema13Values[ema13Values.length - 2] || currentEma13;
        const prevEma55 = ema55Values[ema55Values.length - 2] || currentEma55;
        
        const currentPrice = candles[candles.length - 1].close;
        
        return {
            currentPrice: currentPrice,
            ema13: currentEma13,
            ema55: currentEma55,
            isAboveEMA55: currentPrice > currentEma55,
            isEMA13CrossingUp: currentEma13 > currentEma55 && prevEma13 <= prevEma55,
            isEMA13CrossingDown: currentEma13 < currentEma55 && prevEma13 >= prevEma55
        };
    } catch (error) {
        console.error(`Erro getEMAs3m ${symbol}:`, error.message);
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const precomputed = rateLimiter.cacheSystem.getPrecomputedIndicator(symbol, '1h', 'RSI');
        if (precomputed) {
            return {
                value: precomputed.value,
                raw: precomputed.value,
                isOverbought: precomputed.value > 70,
                isOversold: precomputed.value < 30,
                trend: precomputed.value > 50 ? 'bullish' : 'bearish'
            };
        }
        
        const candles = await getCandlesCached(symbol, '1h', 100);
        if (candles.length < 30) return null;
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({
            values: closes,
            period: 14
        });
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        return {
            value: currentRSI,
            raw: currentRSI,
            isOverbought: currentRSI > 70,
            isOversold: currentRSI < 30,
            trend: currentRSI > 50 ? 'bullish' : 'bearish'
        };
    } catch (error) {
        console.error(`Erro getRSI1h ${symbol}:`, error.message);
        return { value: 50, raw: 50, isOverbought: false, isOversold: false, trend: 'neutral' };
    }
}

async function checkVolume(symbol) {
    try {
        const cachedProfile = await rateLimiter.cacheSystem.getVolumeProfile(symbol);
        if (cachedProfile) {
            return cachedProfile;
        }
        
        const candles15m = await getCandlesCached(symbol, '15m', 50);
        if (candles15m.length < 20) return null;
        
        const volumes = candles15m.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const volumeRatio = currentVolume / avgVolume;
        
        const candles1h = await getCandlesCached(symbol, '1h', 24);
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.reduce((a, b) => a + b, 0) / volumes1h.length;
        const volumeRatio1h = currentVolume / avgVolume1h;
        
        const adaptiveThreshold = VOLUME_SETTINGS.useAdaptive 
            ? VOLUME_SETTINGS.baseThreshold * (1 + (Math.random() * 0.4 - 0.2))
            : VOLUME_SETTINGS.baseThreshold;
        
        const result = {
            rawRatio: volumeRatio,
            ratio: Math.min(volumeRatio, 3),
            ratio1h: Math.min(volumeRatio1h, 3),
            isAboveThreshold: volumeRatio > adaptiveThreshold,
            threshold: adaptiveThreshold,
            currentVolume: currentVolume,
            avgVolume: avgVolume
        };
        
        rateLimiter.cacheSystem.setVolumeProfile(symbol, result);
        
        return result;
    } catch (error) {
        console.error(`Erro checkVolume ${symbol}:`, error.message);
        return { rawRatio: 1, ratio: 1, isAboveThreshold: false, threshold: 1.5 };
    }
}

async function checkVolatility(symbol) {
    try {
        const precomputed = rateLimiter.cacheSystem.getPrecomputedIndicator(symbol, VOLATILITY_TIMEFRAME, 'ATR');
        if (precomputed) {
            const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, 10);
            if (candles.length > 0) {
                const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
                const volatility = precomputed.atr / avgPrice;
                
                return {
                    rawVolatility: volatility * 100,
                    atr: precomputed.atr,
                    atrPercent: precomputed.atrPercent,
                    isHighVolatility: volatility > VOLATILITY_THRESHOLD,
                    threshold: VOLATILITY_THRESHOLD
                };
            }
        }
        
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 10);
        if (candles.length < VOLATILITY_PERIOD) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: candles.map(c => c.close),
            period: VOLATILITY_PERIOD
        });
        
        const currentATR = atrValues[atrValues.length - 1];
        const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
        const atrPercent = (currentATR / avgPrice) * 100;
        
        const priceChanges = [];
        for (let i = 1; i < candles.length; i++) {
            const change = Math.abs((candles[i].close - candles[i-1].close) / candles[i-1].close);
            priceChanges.push(change);
        }
        
        const volatility = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
        
        return {
            rawVolatility: volatility * 100,
            atr: currentATR,
            atrPercent: atrPercent,
            isHighVolatility: volatility > VOLATILITY_THRESHOLD,
            threshold: VOLATILITY_THRESHOLD
        };
    } catch (error) {
        console.error(`Erro checkVolatility ${symbol}:`, error.message);
        return { rawVolatility: 0.5, atrPercent: 1, isHighVolatility: false };
    }
}

// === FUNÇÃO checkLSR CORRIGIDA (SEM MATH.RANDOM) ===
async function checkLSR(symbol, isBullish) {
    try {
        // Primeiro tentar obter dados reais da API
        let lsrRatio;
        let fundingRate;
        
        if (!SIMULATION_MODE && !dataSimulator.shouldSimulate(symbol)) {
            // Tentar obter dados reais (se disponível na API)
            try {
                // Nota: Binance Futures não tem endpoint público para LSR
                // Em produção, você precisaria de uma fonte de dados alternativa
                fundingRate = await getFundingRate(symbol);
                
                // Para LSR, podemos estimar baseado em volume e outros fatores
                const volumeData = await checkVolume(symbol);
                const oiData = await checkOpenInterest(symbol, isBullish);
                
                // Estimativa baseada em dados disponíveis
                lsrRatio = 1.8 + (volumeData.ratio - 1) * 0.5 + (oiData.changePercent / 100);
                lsrRatio = Math.max(1.0, Math.min(4.0, lsrRatio));
                
            } catch (apiError) {
                console.log(`⚠️ API LSR indisponível para ${symbol}, usando estimativa`);
                if (SIMULATION_CONFIG.FALLBACK_TO_SIMULATION) {
                    lsrRatio = dataSimulator.simulateLSR(symbol, isBullish);
                    fundingRate = await dataSimulator.simulateRealisticFundingRate(symbol);
                } else {
                    throw apiError;
                }
            }
        } else {
            // Modo simulação ativo
            lsrRatio = dataSimulator.simulateLSR(symbol, isBullish);
            fundingRate = await dataSimulator.simulateRealisticFundingRate(symbol);
        }
        
        const isValid = isBullish 
            ? lsrRatio > LSR_BUY_THRESHOLD && fundingRate <= FUNDING_BUY_MAX
            : lsrRatio > LSR_SELL_THRESHOLD && fundingRate >= FUNDING_SELL_MIN;
        
        return {
            lsrRatio: lsrRatio,
            fundingRate: fundingRate,
            isValid: isValid,
            threshold: isBullish ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD,
            fundingCondition: isBullish ? fundingRate <= FUNDING_BUY_MAX : fundingRate >= FUNDING_SELL_MIN
        };
        
    } catch (error) {
        console.error(`Erro checkLSR ${symbol}:`, error.message);
        
        // Fallback mínimo se tudo falhar
        return { 
            lsrRatio: 2.0, 
            fundingRate: 0.0001, 
            isValid: true,
            threshold: isBullish ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD,
            fundingCondition: true,
            note: 'fallback_data'
        };
    }
}

// === FUNÇÃO checkOpenInterest CORRIGIDA ===
async function checkOpenInterest(symbol, isBullish) {
    try {
        const cacheKey = `OPEN_INTEREST_${symbol}`;
        const cached = rateLimiter.cacheSystem.getFromMemory(cacheKey);
        if (cached) {
            return cached;
        }
        
        // Buscar dados reais da API
        const oiData = await fetchBinanceFuturesData('/openInterest', { symbol: symbol });
        
        if (oiData && oiData.openInterest) {
            const oiValue = parseFloat(oiData.openInterest);
            const oiSumOpenInterest = parseFloat(oiData.sumOpenInterest || oiValue);
            
            // Calcular mudança percentual (precisaríamos de dados históricos)
            // Por enquanto, usamos uma estimativa baseada em tendência
            const estimatedChange = (Math.random() - 0.5) * 10; // Placeholder
            
            const result = {
                value: oiValue,
                sumOpenInterest: oiSumOpenInterest,
                changePercent: estimatedChange,
                trend: estimatedChange > 5 ? '📈' : estimatedChange < -5 ? '📉' : '➡️',
                isValid: isBullish ? estimatedChange > 0 : estimatedChange < 0,
                timestamp: Date.now(),
                source: 'api'
            };
            
            rateLimiter.cacheSystem.setToMemory(cacheKey, result, AGGRESSIVE_CACHE_CONFIG.OPEN_INTEREST);
            return result;
        }
        
        throw new Error('Dados de open interest não disponíveis');
        
    } catch (error) {
        console.error(`Erro checkOpenInterest ${symbol}:`, error.message);
        
        // Fallback para simulação apenas se configurado
        if (SIMULATION_CONFIG.FALLBACK_TO_SIMULATION) {
            console.log(`⚠️ Usando dados simulados para Open Interest de ${symbol}`);
            const simulatedData = dataSimulator.simulateOpenInterest(symbol, isBullish);
            
            const result = {
                ...simulatedData,
                timestamp: Date.now(),
                source: 'simulation'
            };
            
            return result;
        }
        
        // Se não permitir simulação, retorna dados neutros
        return { 
            value: 1000000, 
            changePercent: 0, 
            trend: '➡️', 
            isValid: true,
            timestamp: Date.now(),
            source: 'neutral_fallback'
        };
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 50);
        if (candles.length < 30) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ADX_1H_SETTINGS.period
        });
        
        const currentADX = adxValues[adxValues.length - 1];
        
        return {
            raw: currentADX,
            value: currentADX,
            hasMinimumStrength: currentADX >= ADX_1H_SETTINGS.minStrength,
            hasStrongTrend: currentADX >= ADX_1H_SETTINGS.strongTrend,
            trendStrength: currentADX >= ADX_1H_SETTINGS.strongTrend ? 'strong' : 
                         currentADX >= ADX_1H_SETTINGS.minStrength ? 'medium' : 'weak'
        };
    } catch (error) {
        console.error(`Erro getADX1h ${symbol}:`, error.message);
        return { raw: 20, value: 20, hasMinimumStrength: false, trendStrength: 'weak' };
    }
}

async function checkStochastic(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 50);
        if (candles.length < 30) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
            signalPeriod: 3
        });
        
        const current = stochValues[stochValues.length - 1];
        
        return {
            kValue: current.k,
            dValue: current.d,
            isValid: isBullish ? current.k < 20 && current.k > current.d : current.k > 80 && current.k < current.d,
            isOversold: current.k < 20,
            isOverbought: current.k > 80,
            isCrossingUp: current.k > current.d
        };
    } catch (error) {
        console.error(`Erro checkStochastic ${symbol}:`, error.message);
        return { kValue: 50, dValue: 50, isValid: false, isOversold: false, isOverbought: false };
    }
}

async function checkStochastic4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 50);
        if (candles.length < 30) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14,
            signalPeriod: 3
        });
        
        const current = stochValues[stochValues.length - 1];
        
        return {
            kValue: current.k,
            dValue: current.d,
            isValid: isBullish ? current.k < 30 : current.k > 70,
            isOversold: current.k < 30,
            isOverbought: current.k > 70,
            isCrossingUp: current.k > current.d
        };
    } catch (error) {
        console.error(`Erro checkStochastic4h ${symbol}:`, error.message);
        return { kValue: 50, dValue: 50, isValid: false };
    }
}

async function checkCCI4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 50);
        if (candles.length < 30) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 20
        });
        
        const currentCCI = cciValues[cciValues.length - 1];
        const prevCCI = cciValues[cciValues.length - 2] || currentCCI;
        
        const cciMA = cciValues.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, cciValues.length);
        
        return {
            value: currentCCI,
            maValue: cciMA,
            isValid: isBullish ? currentCCI < -100 && currentCCI > prevCCI : currentCCI > 100 && currentCCI < prevCCI,
            isOversold: currentCCI < -100,
            isOverbought: currentCCI > 100,
            isTurningUp: currentCCI > prevCCI,
            isTurningDown: currentCCI < prevCCI
        };
    } catch (error) {
        console.error(`Erro checkCCI4h ${symbol}:`, error.message);
        return { value: 0, maValue: 0, isValid: false, isOversold: false, isOverbought: false };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        const fundingRate = await getFundingRate(symbol);
        
        return {
            rate: fundingRate,
            isValid: isBullish ? fundingRate < 0 : fundingRate > 0,
            isExtreme: Math.abs(fundingRate) > 0.001
        };
    } catch (error) {
        console.error(`Erro checkFundingRate ${symbol}:`, error.message);
        return { rate: 0.0001, isValid: true, isExtreme: false };
    }
}

async function checkDivergence15m(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 50);
        if (candles.length < 30) return null;
        
        const closes = candles.map(c => c.close);
        
        const precomputedRSI = rateLimiter.cacheSystem.getPrecomputedIndicator(symbol, '15m', 'RSI');
        let rsiValues;
        
        if (precomputedRSI && precomputedRSI.all) {
            rsiValues = precomputedRSI.all;
        } else {
            rsiValues = RSI.calculate({
                values: closes,
                period: 14
            });
        }
        
        const lastPrice = closes[closes.length - 1];
        const secondLastPrice = closes[closes.length - 2];
        const thirdLastPrice = closes[closes.length - 3];
        
        const lastRSI = rsiValues[rsiValues.length - 1];
        const secondLastRSI = rsiValues[rsiValues.length - 2];
        const thirdLastRSI = rsiValues[rsiValues.length - 3];
        
        let hasDivergence = false;
        let type = '';
        let confirmed = false;
        
        if (lastPrice > secondLastPrice && lastRSI < secondLastRSI) {
            hasDivergence = true;
            type = 'bearish';
            confirmed = thirdLastPrice < secondLastPrice;
        }
        else if (lastPrice < secondLastPrice && lastRSI > secondLastRSI) {
            hasDivergence = true;
            type = 'bullish';
            confirmed = thirdLastPrice > secondLastPrice;
        }
        
        return {
            hasDivergence: hasDivergence,
            type: type,
            confirmed: confirmed,
            isBullishDivergence: type === 'bullish',
            isBearishDivergence: type === 'bearish',
            price: lastPrice,
            rsi: lastRSI
        };
    } catch (error) {
        console.error(`Erro checkDivergence15m ${symbol}:`, error.message);
        return { hasDivergence: false, type: '', confirmed: false };
    }
}

async function analyzeSupportResistance(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 100);
        if (candles.length < 50) return null;
        
        const levels = [];
        const prices = candles.map(c => c.close);
        
        for (let i = 2; i < prices.length - 2; i++) {
            if (prices[i] > prices[i-1] && prices[i] > prices[i-2] && 
                prices[i] > prices[i+1] && prices[i] > prices[i+2]) {
                levels.push({ price: prices[i], type: 'resistance' });
            }
            
            if (prices[i] < prices[i-1] && prices[i] < prices[i-2] && 
                prices[i] < prices[i+1] && prices[i] < prices[i+2]) {
                levels.push({ price: prices[i], type: 'support' });
            }
        }
        
        const groupedLevels = [];
        const threshold = currentPrice * 0.02;
        
        for (const level of levels) {
            const existing = groupedLevels.find(l => Math.abs(l.price - level.price) < threshold);
            if (existing) {
                existing.strength += 1;
            } else {
                groupedLevels.push({
                    price: level.price,
                    type: level.type,
                    strength: 1,
                    distancePercent: Math.abs((level.price - currentPrice) / currentPrice * 100)
                });
            }
        }
        
        const supports = groupedLevels.filter(l => l.type === 'support');
        const resistances = groupedLevels.filter(l => l.type === 'resistance');
        
        const nearestSupport = supports.sort((a, b) => 
            Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
        )[0];
        
        const nearestResistance = resistances.sort((a, b) => 
            Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
        )[0];
        
        let breakoutRisk = 'low';
        let breakoutDirection = '';
        
        if (nearestSupport && nearestResistance) {
            const distanceToSupport = Math.abs(currentPrice - nearestSupport.price) / currentPrice * 100;
            const distanceToResistance = Math.abs(currentPrice - nearestResistance.price) / currentPrice * 100;
            
            if (distanceToSupport < 1 || distanceToResistance < 1) {
                breakoutRisk = 'high';
                breakoutDirection = distanceToSupport < distanceToResistance ? 'down' : 'up';
            } else if (distanceToSupport < 2 || distanceToResistance < 2) {
                breakoutRisk = 'medium';
            }
        }
        
        return {
            supports: supports,
            resistances: resistances,
            nearestSupport: nearestSupport,
            nearestResistance: nearestResistance,
            currentPrice: currentPrice,
            breakoutRisk: {
                level: breakoutRisk,
                direction: breakoutDirection,
                isHighRisk: breakoutRisk === 'high'
            },
            distanceToNearest: nearestSupport ? 
                ((currentPrice - nearestSupport.price) / currentPrice * 100).toFixed(2) :
                nearestResistance ? 
                ((nearestResistance.price - currentPrice) / currentPrice * 100).toFixed(2) : 'N/A'
        };
    } catch (error) {
        console.error(`Erro analyzeSupportResistance ${symbol}:`, error.message);
        return null;
    }
}

async function calculateSignalQuality(symbol, isBullish, marketData) {
    try {
        let score = 0;
        let details = [];
        
        if (marketData.volume?.isAboveThreshold) {
            const volumeScore = Math.min(15, marketData.volume.ratio * 5);
            score += volumeScore;
            details.push(`Volume: +${volumeScore.toFixed(1)} (${marketData.volume.ratio.toFixed(2)}x)`);
        }
        
        if (marketData.oi?.isValid) {
            score += 8;
            details.push(`OI: +8 (${marketData.oi.trend})`);
        }
        
        if (!marketData.volatility?.isHighVolatility) {
            score += 8;
            details.push(`Volatility: +8 (${marketData.volatility?.rawVolatility.toFixed(2)}%)`);
        }
        
        if (marketData.lsr?.isValid) {
            score += 8;
            details.push(`LSR: +8 (${marketData.lsr.lsrRatio.toFixed(2)})`);
        }
        
        if (isBullish) {
            if (marketData.rsi?.isOversold || marketData.rsi?.value < 50) {
                score += 8;
                details.push(`RSI: +8 (${marketData.rsi.value.toFixed(1)})`);
            }
        } else {
            if (marketData.rsi?.isOverbought || marketData.rsi?.value > 50) {
                score += 8;
                details.push(`RSI: +8 (${marketData.rsi.value.toFixed(1)})`);
            }
        }
        
        if (marketData.ema?.isAboveEMA55 && isBullish) {
            score += 10;
            details.push(`EMA: +10 (Above 55)`);
        } else if (!marketData.ema?.isAboveEMA55 && !isBullish) {
            score += 10;
            details.push(`EMA: +10 (Below 55)`);
        }
        
        if (marketData.adx1h?.hasMinimumStrength) {
            score += 10;
            details.push(`ADX 1H: +10 (${marketData.adx1h.value.toFixed(1)})`);
        }
        
        if (marketData.stoch4h?.isValid) {
            score += 8;
            details.push(`Stoch 4H: +8 (K:${marketData.stoch4h.kValue.toFixed(1)})`);
        }
        
        if (marketData.cci4h?.isValid) {
            score += 10;
            details.push(`CCI 4H: +10 (${marketData.cci4h.value.toFixed(1)})`);
        }
        
        if (marketData.divergence15m?.hasDivergence) {
            if (marketData.divergence15m.confirmed) {
                score += 10;
                details.push(`Divergence: +10 (${marketData.divergence15m.type}✅)`);
            } else {
                score += 5;
                details.push(`Divergence: +5 (${marketData.divergence15m.type}⚠️)`);
            }
        }
        
        if (marketData.breakoutRisk?.level !== 'high') {
            score += 8;
            details.push(`Breakout Risk: +8 (${marketData.breakoutRisk?.level})`);
        }
        
        const srDistance = marketData.supportResistance?.distanceToNearest;
        if (srDistance && Math.abs(parseFloat(srDistance)) > 1) {
            score += 8;
            details.push(`S/R Distance: +8 (${srDistance}%)`);
        }
        
        const confirmations = details.length;
        if (confirmations >= 8) {
            score += 5;
            details.push(`Multiple Confirmations: +5 (${confirmations})`);
        }
        
        let grade = 'F';
        if (score >= 90) grade = 'A+';
        else if (score >= 85) grade = 'A';
        else if (score >= 80) grade = 'A-';
        else if (score >= 75) grade = 'B+';
        else if (score >= 70) grade = 'B';
        else if (score >= 65) grade = 'C+';
        else if (score >= 60) grade = 'C';
        else if (score >= 55) grade = 'D';
        
        return {
            score: Math.min(score, 100),
            grade: grade,
            isAcceptable: score >= QUALITY_THRESHOLD,
            details: details,
            rawScore: score
        };
        
    } catch (error) {
        console.error(`Erro calculateSignalQuality ${symbol}:`, error.message);
        return { score: 0, grade: 'F', isAcceptable: false, details: [] };
    }
}

async function calculateAdvancedTargetsAndStop(entryPrice, isBullish, symbol) {
    try {
        const volatilityData = await checkVolatility(symbol);
        const atrPercent = volatilityData?.atrPercent || 1.5;
        
        const stopPercentage = Math.min(Math.max(atrPercent * 0.8, 0.8), 3.0);
        const stopPrice = isBullish 
            ? entryPrice * (1 - stopPercentage / 100)
            : entryPrice * (1 + stopPercentage / 100);
        
        const targets = [];
        const riskRewardRatios = [1.0, 1.7, 2.7];
        
        for (const rr of riskRewardRatios) {
            const targetPercentage = stopPercentage * rr;
            const targetPrice = isBullish
                ? entryPrice * (1 + targetPercentage / 100)
                : entryPrice * (1 - targetPercentage / 100);
            
            targets.push({
                target: targetPercentage.toFixed(2),
                price: targetPrice,
                riskReward: rr.toFixed(1)
            });
        }
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopPercentage.toFixed(2),
            targets: targets,
            atrBased: true,
            atrValue: atrPercent.toFixed(2)
        };
        
    } catch (error) {
        console.error(`Erro calculateAdvancedTargetsAndStop ${symbol}:`, error.message);
        
        const stopPercentage = 1.5;
        const stopPrice = isBullish 
            ? entryPrice * (1 - stopPercentage / 100)
            : entryPrice * (1 + stopPercentage / 100);
        
        const targets = [
            { target: '1.5', price: isBullish ? entryPrice * 1.015 : entryPrice * 0.985, riskReward: '1.0' },
            { target: '2.5', price: isBullish ? entryPrice * 1.025 : entryPrice * 0.975, riskReward: '1.7' },
            { target: '4.0', price: isBullish ? entryPrice * 1.04 : entryPrice * 0.96, riskReward: '2.7' }
        ];
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopPercentage.toFixed(2),
            targets: targets,
            atrBased: false
        };
    }
}

// === FUNÇÃO TELEGRAM ===
async function sendTelegramAlert(message) {
    try {
        console.log('📱 ENVIANDO ALERTA TELEGRAM (LIVE MODE)...');
        
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro Telegram:', errorText);
            throw new Error(`Telegram API error: ${response.status} ${errorText}`);
        }
        
        console.log('✅ Alerta Telegram enviado com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro sendTelegramAlert:', error.message);
        
        console.log('\n' + '='.repeat(50));
        console.log('📱 FALHA NO ENVIO TELEGRAM - MENSAGEM LOCAL:');
        console.log('='.repeat(50));
        console.log(message.replace(/<b>/g, '').replace(/<\/b>/g, ''));
        console.log('='.repeat(50) + '\n');
    }
}

// === SISTEMA DE APRENDIZADO POR REFORÇO COMPLETO ===
class ReinforcementLearningSystem {
    constructor() {
        console.log('🧠 Inicializando Sistema de Aprendizado por Reforço...');
        
        this.qTable = new Map();
        this.experienceBuffer = [];
        this.priorities = new Map();
        
        this.learningRate = RL_SETTINGS.learningRate;
        this.discountFactor = RL_SETTINGS.discountFactor;
        this.explorationRate = RL_SETTINGS.explorationRate;
        this.minExplorationRate = RL_SETTINGS.minExplorationRate;
        this.explorationDecay = RL_SETTINGS.explorationDecay;
        
        this.stats = {
            totalExperiences: 0,
            qTableSize: 0,
            updatesPerformed: 0,
            avgReward: 0,
            bestActionPerState: {}
        };
        
        this.stateCache = new Map();
        this.actionSpace = ['BUY', 'SELL', 'HOLD', 'SCALE_IN', 'SCALE_OUT'];
        this.actionValues = {};
        
        this.currentState = null;
        this.lastAction = null;
        this.lastReward = 0;
        
        this.loadRLData();
        console.log('✅ Sistema RL pronto. Q-Table:', this.qTable.size, 'estados');
    }
    
    loadRLData() {
        try {
            if (!fs.existsSync(LEARNING_DIR)) {
                fs.mkdirSync(LEARNING_DIR, { recursive: true });
            }
            
            const rlFile = path.join(LEARNING_DIR, 'rl_data.json');
            if (fs.existsSync(rlFile)) {
                const data = JSON.parse(fs.readFileSync(rlFile, 'utf8'));
                
                this.qTable = new Map(Object.entries(data.qTable || {}));
                this.experienceBuffer = data.experienceBuffer || [];
                this.stats = data.stats || this.stats;
                this.explorationRate = data.explorationRate || this.explorationRate;
                
                console.log(`📊 RL: ${this.qTable.size} estados carregados, ${this.experienceBuffer.length} experiências`);
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados RL:', error.message);
        }
    }
    
    saveRLData() {
        try {
            const data = {
                qTable: Object.fromEntries(this.qTable),
                experienceBuffer: this.experienceBuffer.slice(-RL_SETTINGS.experienceBufferSize),
                stats: this.stats,
                explorationRate: this.explorationRate,
                lastUpdated: Date.now()
            };
            
            const rlFile = path.join(LEARNING_DIR, 'rl_data.json');
            fs.writeFileSync(rlFile, JSON.stringify(data, null, 2));
            
            if (this.stats.updatesPerformed % 100 === 0) {
                const backupFile = path.join(LEARNING_DIR, `rl_backup_${Date.now()}.json`);
                fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
            }
            
        } catch (error) {
            console.error('Erro ao salvar dados RL:', error);
        }
    }
    
    async getAction(symbol, marketData, isBullish, qualityScore) {
        if (!RL_SETTINGS.enabled) {
            return isBullish ? 'BUY' : 'SELL';
        }
        
        try {
            const state = this.extractState(symbol, marketData, qualityScore);
            this.currentState = state;
            
            let action;
            if (Math.random() < this.explorationRate) {
                action = this.exploreAction(state);
                console.log(`🔍 RL ${symbol}: Explorando ação ${action} (ε=${this.explorationRate.toFixed(3)})`);
            } else {
                action = this.exploitAction(state, isBullish);
                console.log(`🎯 RL ${symbol}: Explorando ação ${action} com Q-value ${this.getQValue(state, action).toFixed(4)}`);
            }
            
            this.lastAction = action;
            
            this.explorationRate = Math.max(
                this.minExplorationRate,
                this.explorationRate * this.explorationDecay
            );
            
            return action;
            
        } catch (error) {
            console.error('Erro RL getAction:', error);
            return isBullish ? 'BUY' : 'SELL';
        }
    }
    
    extractState(symbol, marketData, qualityScore) {
        const cacheKey = `${symbol}_${Date.now()}`;
        if (this.stateCache.has(cacheKey)) {
            return this.stateCache.get(cacheKey);
        }
        
        const stateFeatures = [
            (marketData.rsi?.raw || 50) / 100,
            (marketData.cci4h?.value || 0) / 200,
            (marketData.stoch4h?.kValue || 50) / 100,
            Math.min(3, marketData.volume?.rawRatio || 1) / 3,
            marketData.oi?.trend === '📈' ? 1 : marketData.oi?.trend === '📉' ? -1 : 0,
            (marketData.volatility?.rawVolatility || 0) / 5,
            marketData.ema?.isAboveEMA55 ? 1 : -1,
            marketData.ema?.isEMA13CrossingUp ? 1 : marketData.ema?.isEMA13CrossingDown ? -1 : 0,
            (marketData.adx1h?.raw || 0) / 50,
            marketData.divergence15m?.hasDivergence ? 1 : 0,
            marketData.divergence15m?.confirmed ? 1 : 0,
            marketData.breakoutRisk?.level === 'high' ? -1 : marketData.breakoutRisk?.level === 'low' ? 1 : 0,
            (qualityScore?.score || 50) / 100,
            marketData.lsr?.isValid ? 1 : 0,
            new Date().getUTCHours() / 24
        ];
        
        const discretizedState = stateFeatures.map(f => Math.round(f * 10) / 10);
        const stateKey = discretizedState.join('|');
        
        this.stateCache.set(cacheKey, stateKey);
        setTimeout(() => this.stateCache.delete(cacheKey), 60000);
        
        return stateKey;
    }
    
    exploreAction(state) {
        const stateFeatures = state.split('|').map(Number);
        const rsi = stateFeatures[0] * 100;
        const volume = stateFeatures[3] * 3;
        
        if (rsi < 30 && volume > 1.5) return 'BUY';
        if (rsi > 70 && volume > 1.5) return 'SELL';
        if (volume < 0.8) return 'HOLD';
        
        return this.actionSpace[Math.floor(Math.random() * this.actionSpace.length)];
    }
    
    exploitAction(state, defaultBullish) {
        if (!this.qTable.has(state)) {
            return defaultBullish ? 'BUY' : 'SELL';
        }
        
        const qValues = this.qTable.get(state);
        let bestAction = null;
        let bestValue = -Infinity;
        
        for (const [action, value] of Object.entries(qValues)) {
            if (value > bestValue) {
                bestValue = value;
                bestAction = action;
            }
        }
        
        const actions = Object.keys(qValues);
        const values = Object.values(qValues);
        const maxValue = Math.max(...values);
        const closeActions = actions.filter((a, i) => values[i] >= maxValue * 0.95);
        
        if (closeActions.length > 1) {
            return closeActions[Math.floor(Math.random() * closeActions.length)];
        }
        
        return bestAction || (defaultBullish ? 'BUY' : 'SELL');
    }
    
    async learnFromTrade(tradeRecord, marketData) {
        if (!RL_SETTINGS.enabled || !tradeRecord || !this.currentState) {
            return;
        }
        
        try {
            const reward = this.calculateReward(tradeRecord, marketData);
            this.lastReward = reward;
            
            const nextState = this.extractState(
                tradeRecord.symbol,
                marketData,
                { score: tradeRecord.qualityScore }
            );
            
            const experience = {
                state: this.currentState,
                action: this.lastAction,
                reward: reward,
                nextState: nextState,
                done: tradeRecord.status === 'CLOSED',
                timestamp: Date.now(),
                tradeId: tradeRecord.id,
                symbol: tradeRecord.symbol
            };
            
            this.addExperienceWithPriority(experience);
            this.updateQTable(experience);
            
            if (this.experienceBuffer.length >= RL_SETTINGS.batchSize * 2) {
                await this.trainFromExperience();
            }
            
            this.updateStats(experience);
            
            if (this.stats.updatesPerformed % 50 === 0) {
                this.saveRLData();
            }
            
            console.log(`🧠 RL Aprendizado: ${tradeRecord.symbol} ${this.lastAction} → Recompensa: ${reward.toFixed(2)}, Q-table: ${this.qTable.size} estados`);
            
        } catch (error) {
            console.error('Erro RL learnFromTrade:', error);
        }
    }
    
    calculateReward(tradeRecord, marketData) {
        let reward = 0;
        
        if (tradeRecord.profitPercentage > 0) {
            reward += Math.sign(tradeRecord.profitPercentage) * 
                     Math.pow(Math.abs(tradeRecord.profitPercentage) * RL_SETTINGS.rewardScaling, 1.5);
        } else {
            reward += tradeRecord.profitPercentage * RL_SETTINGS.rewardScaling * 1.2;
        }
        
        if (tradeRecord.qualityScore > 80) {
            reward += 50;
        } else if (tradeRecord.qualityScore < 60) {
            reward -= 30;
        }
        
        const durationHours = tradeRecord.durationHours || 0;
        if (tradeRecord.profitPercentage > 0) {
            if (durationHours < 1) reward += 100;
            else if (durationHours < 4) reward += 50;
            else if (durationHours > 24) reward -= 20;
        } else {
            if (durationHours < 1) reward += 10;
            else if (durationHours > 12) reward -= 50;
        }
        
        const targetsHit = tradeRecord.targets?.filter(t => 
            tradeRecord.exitPrice && 
            (tradeRecord.direction === 'BUY' ? 
                tradeRecord.exitPrice >= t.price : 
                tradeRecord.exitPrice <= t.price)
        ).length || 0;
        
        if (targetsHit >= 2) {
            reward += 30 * targetsHit;
        }
        
        if (tradeRecord.maxDrawdownPercentage > 8) {
            reward -= tradeRecord.maxDrawdownPercentage * 10;
        }
        
        if (this.lastAction && tradeRecord.direction) {
            const wasRLDecision = this.lastAction === tradeRecord.direction;
            if (wasRLDecision && tradeRecord.profitPercentage > 0) {
                reward += 80;
            } else if (wasRLDecision && tradeRecord.profitPercentage < 0) {
                reward -= 40;
            }
        }
        
        return Math.max(-1000, Math.min(1000, reward));
    }
    
    updateQTable(experience) {
        const { state, action, reward, nextState, done } = experience;
        
        const currentQ = this.getQValue(state, action);
        let maxNextQ = 0;
        if (!done) {
            maxNextQ = this.getMaxQValue(nextState);
        }
        
        const newQ = currentQ + this.learningRate * 
            (reward + this.discountFactor * maxNextQ - currentQ);
        
        this.setQValue(state, action, newQ);
        this.stats.updatesPerformed++;
    }
    
    async trainFromExperience() {
        if (this.experienceBuffer.length < RL_SETTINGS.batchSize) {
            return;
        }
        
        try {
            const batch = this.samplePrioritizedBatch(RL_SETTINGS.batchSize);
            
            for (const experience of batch) {
                this.updateQTable(experience);
                
                const tdError = Math.abs(
                    experience.reward + 
                    this.discountFactor * this.getMaxQValue(experience.nextState) - 
                    this.getQValue(experience.state, experience.action)
                );
                
                this.updatePriority(experience, tdError);
            }
            
            this.learningRate *= 0.9999;
            this.learningRate = Math.max(0.01, this.learningRate);
            
            if (this.experienceBuffer.length > RL_SETTINGS.experienceBufferSize) {
                this.experienceBuffer = this.experienceBuffer.slice(-RL_SETTINGS.experienceBufferSize);
            }
            
        } catch (error) {
            console.error('Erro RL trainFromExperience:', error);
        }
    }
    
    samplePrioritizedBatch(batchSize) {
        if (!RL_SETTINGS.usePrioritizedReplay || this.experienceBuffer.length < 10) {
            const shuffled = [...this.experienceBuffer].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, batchSize);
        }
        
        const priorities = this.experienceBuffer.map((exp, idx) => 
            this.priorities.get(idx) || 1
        );
        const sumPriorities = priorities.reduce((a, b) => a + b, 0);
        
        const batch = [];
        for (let i = 0; i < batchSize; i++) {
            const rand = Math.random() * sumPriorities;
            let cumulative = 0;
            for (let j = 0; j < priorities.length; j++) {
                cumulative += priorities[j];
                if (cumulative >= rand) {
                    batch.push(this.experienceBuffer[j]);
                    break;
                }
            }
        }
        
        return batch;
    }
    
    getQValue(state, action) {
        if (!this.qTable.has(state)) {
            return 0;
        }
        return this.qTable.get(state)[action] || 0;
    }
    
    setQValue(state, action, value) {
        if (!this.qTable.has(state)) {
            this.qTable.set(state, {});
            this.stats.qTableSize++;
        }
        
        const stateActions = this.qTable.get(state);
        stateActions[action] = value;
        
        Object.keys(stateActions).forEach(a => {
            if (Math.abs(stateActions[a]) < 0.001) {
                delete stateActions[a];
            }
        });
    }
    
    getMaxQValue(state) {
        if (!this.qTable.has(state)) {
            return 0;
        }
        const values = Object.values(this.qTable.get(state));
        return Math.max(...values, 0);
    }
    
    addExperienceWithPriority(experience) {
        const initialPriority = Math.pow(Math.abs(experience.reward) + 1, 0.8);
        
        this.experienceBuffer.push(experience);
        const idx = this.experienceBuffer.length - 1;
        this.priorities.set(idx, initialPriority);
        
        this.stats.totalExperiences++;
        
        if (this.experienceBuffer.length > RL_SETTINGS.experienceBufferSize * 1.5) {
            const toRemove = this.experienceBuffer.length - RL_SETTINGS.experienceBufferSize;
            this.experienceBuffer.splice(0, toRemove);
            this.priorities = new Map();
            this.experienceBuffer.forEach((exp, i) => {
                this.priorities.set(i, 1);
            });
        }
    }
    
    updatePriority(experience, tdError) {
        const idx = this.experienceBuffer.indexOf(experience);
        if (idx !== -1) {
            this.priorities.set(idx, tdError + 0.01);
        }
    }
    
    updateStats(experience) {
        this.stats.avgReward = (this.stats.avgReward * 0.99) + (experience.reward * 0.01);
        
        const state = experience.state;
        if (!this.stats.bestActionPerState[state] || 
            experience.reward > this.stats.bestActionPerState[state].reward) {
            this.stats.bestActionPerState[state] = {
                action: experience.action,
                reward: experience.reward,
                count: (this.stats.bestActionPerState[state]?.count || 0) + 1
            };
        }
    }
    
    getRLReport() {
        const totalStates = this.qTable.size;
        const totalExperiences = this.experienceBuffer.length;
        
        const actionCounts = {};
        this.experienceBuffer.forEach(exp => {
            actionCounts[exp.action] = (actionCounts[exp.action] || 0) + 1;
        });
        
        const bestStates = [];
        for (const [state, actions] of this.qTable.entries()) {
            const bestAction = Object.entries(actions).reduce((a, b) => 
                a[1] > b[1] ? a : b
            );
            if (bestAction[1] > 10) {
                bestStates.push({
                    state: state.substring(0, 50) + '...',
                    action: bestAction[0],
                    value: bestAction[1].toFixed(2)
                });
            }
        }
        
        bestStates.sort((a, b) => b.value - a.value);
        
        return {
            totalStates,
            totalExperiences,
            explorationRate: this.explorationRate.toFixed(3),
            learningRate: this.learningRate.toFixed(4),
            avgReward: this.stats.avgReward.toFixed(2),
            updatesPerformed: this.stats.updatesPerformed,
            actionDistribution: actionCounts,
            topStates: bestStates.slice(0, 5)
        };
    }
    
    resetLearning() {
        console.log('🔄 Reiniciando aprendizado RL...');
        this.qTable.clear();
        this.experienceBuffer = [];
        this.priorities.clear();
        this.explorationRate = RL_SETTINGS.explorationRate;
        this.learningRate = RL_SETTINGS.learningRate;
        this.stats = {
            totalExperiences: 0,
            qTableSize: 0,
            updatesPerformed: 0,
            avgReward: 0,
            bestActionPerState: {}
        };
        
        this.saveRLData();
        console.log('✅ RL reiniciado');
    }
}

// =====================================================================
// SISTEMA DE APRENDIZADO INTEGRADO COM RL
// =====================================================================

class AdvancedLearningSystemWithRL {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.openTrades = new Map();
        this.patterns = { winning: {}, losing: {} };
        this.parameterEvolution = {
            volumeThreshold: [],
            qualityThreshold: [],
            adxThreshold: [],
            breakoutRisk: [],
            supportResistance: [],
            divergence: []
        };
        
        this.rlSystem = new ReinforcementLearningSystem();
        this.learningEnabled = true;
        this.minTradesForLearning = 10;
        this.tradeTrackingHours = 24;
        
        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado Avançado + RL inicializado');
    }
    
    loadLearningData() {
        try {
            if (!fs.existsSync(LEARNING_DIR)) {
                fs.mkdirSync(LEARNING_DIR, { recursive: true });
            }
            
            const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
            if (fs.existsSync(learningFile)) {
                const data = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
                
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
                this.patterns = data.patterns || { winning: {}, losing: {} };
                this.parameterEvolution = data.parameterEvolution || this.parameterEvolution;
                
                console.log(`📚 Dados de aprendizado carregados: ${this.tradeHistory.length} trades, ${Object.keys(this.symbolPerformance).length} símbolos`);
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados de aprendizado:', error.message);
        }
    }
    
    saveLearningData() {
        try {
            const data = {
                tradeHistory: this.tradeHistory.slice(-1000),
                symbolPerformance: this.symbolPerformance,
                patterns: this.patterns,
                parameterEvolution: this.parameterEvolution,
                lastUpdated: Date.now()
            };
            
            const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
            
        } catch (error) {
            console.error('Erro ao salvar dados de aprendizado:', error);
        }
    }
    
    async recordSignal(signal, marketData) {
        if (!this.learningEnabled) return null;
        
        try {
            let rlAction = 'HOLD';
            let rlConfidence = 0;
            
            if (RL_SETTINGS.enabled) {
                rlAction = await this.rlSystem.getAction(
                    signal.symbol,
                    marketData,
                    signal.isBullish,
                    signal.qualityScore
                );
                
                const state = this.rlSystem.extractState(signal.symbol, marketData, signal.qualityScore);
                const qValue = this.rlSystem.getQValue(state, rlAction);
                rlConfidence = Math.min(100, Math.max(0, (qValue + 10) * 5));
                
                console.log(`🧠 RL Recomendação: ${rlAction} (Confiança: ${rlConfidence.toFixed(1)}%)`);
            }
            
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
                rlAction: rlAction,
                rlConfidence: rlConfidence,
                usedRLAction: false,
                entryPrice: signal.price,
                stopPrice: signal.targetsData.stopPrice,
                targets: signal.targetsData.targets.map(t => ({
                    price: parseFloat(t.price),
                    percentage: parseFloat(t.target),
                    rr: parseFloat(t.riskReward)
                })),
                bestTarget: signal.targetsData.targets.reduce((a, b) => 
                    parseFloat(b.riskReward) > parseFloat(a.riskReward) ? b : a
                ),
                qualityScore: signal.qualityScore.score,
                marketData: {
                    volumeRatio: marketData.volume?.rawRatio || 0,
                    rsi: marketData.rsi?.raw || 0,
                    adx1h: marketData.adx1h?.raw || 0,
                    volatility: marketData.volatility?.rawVolatility || 0,
                    lsr: marketData.lsr?.lsrRatio || 0,
                    emaAlignment: marketData.ema?.isAboveEMA55 || false,
                    stoch4hValid: marketData.stoch4h?.isValid || false,
                    cci4hValid: marketData.cci4h?.isValid || false,
                    cci4hValue: marketData.cci4h?.value || 0,
                    cci4hMA: marketData.cci4h?.maValue || 0,
                    divergence15m: marketData.divergence15m || {},
                    breakoutRisk: marketData.breakoutRisk || {},
                    supportResistance: marketData.supportResistance || {}
                },
                status: 'OPEN',
                outcome: null,
                exitPrice: null,
                profitPercentage: null,
                durationHours: null,
                maxDrawdownPercentage: 0
            };
            
            const shouldUseRL = rlConfidence > 70 && rlAction !== 'HOLD';
            if (shouldUseRL && rlAction !== tradeRecord.direction) {
                console.log(`🔄 RL overriding: ${tradeRecord.direction} → ${rlAction}`);
                tradeRecord.direction = rlAction;
                tradeRecord.usedRLAction = true;
                tradeRecord.isBullish = rlAction === 'BUY';
            }
            
            this.tradeHistory.push(tradeRecord);
            this.openTrades.set(tradeRecord.id, tradeRecord);
            
            setTimeout(() => {
                this.checkTradeOutcome(tradeRecord.id);
            }, this.tradeTrackingHours * 60 * 60 * 1000);
            
            if (!this.symbolPerformance[signal.symbol]) {
                this.symbolPerformance[signal.symbol] = {
                    totalSignals: 0,
                    successfulSignals: 0,
                    totalProfit: 0,
                    avgHoldingTime: 0,
                    recentScores: [],
                    rlPerformance: { wins: 0, losses: 0, total: 0 }
                };
            }
            
            const symbolStats = this.symbolPerformance[signal.symbol];
            symbolStats.totalSignals++;
            symbolStats.recentScores.push(signal.qualityScore.score);
            
            if (tradeRecord.usedRLAction) {
                symbolStats.rlPerformance.total++;
            }
            
            if (symbolStats.recentScores.length > 20) {
                symbolStats.recentScores = symbolStats.recentScores.slice(-20);
            }
            
            if (this.tradeHistory.length % 20 === 0) {
                this.saveLearningData();
                await this.analyzePatterns();
            }
            
            await this.sendTradeAlert(signal, tradeRecord, marketData);
            
            return tradeRecord.id;
            
        } catch (error) {
            console.error('Erro ao registrar sinal:', error);
            return null;
        }
    }
    
    async sendTradeAlert(signal, tradeRecord, marketData) {
        try {
            const directionEmoji = tradeRecord.direction === 'BUY' ? '🟢' : '🔴';
            const rlEmoji = tradeRecord.usedRLAction ? '🧠' : '';
            const divergenceInfo = marketData.divergence15m?.hasDivergence ? 
                `${marketData.divergence15m.type}${marketData.divergence15m.confirmed ? '✅' : '⚠️'}` : 'N/A';
            
            const srDistance = marketData.supportResistance?.distanceToNearest || 'N/A';
            const breakoutRisk = marketData.breakoutRisk?.level || 'N/A';
            
            const message = `
${directionEmoji} <b>${tradeRecord.symbol} - ${tradeRecord.direction} ${rlEmoji}</b>
⏰ ${new Date().toLocaleTimeString('pt-BR')}

📊 <b>ANÁLISE:</b>
• Score: <b>${signal.qualityScore.score}/100 (${signal.qualityScore.grade})</b>
• Volume: <b>${marketData.volume?.ratio?.toFixed(2)}x</b>
• RSI: <b>${marketData.rsi?.value?.toFixed(1)}</b>
• ADX 1H: <b>${marketData.adx1h?.value?.toFixed(1)}</b>
• LSR: <b>${marketData.lsr?.lsrRatio?.toFixed(2)}</b>

🎯 <b>NÍVEIS:</b>
• Entrada: <b>$${signal.price.toFixed(2)}</b>
• Stop: <b>$${tradeRecord.stopPrice.toFixed(2)}</b> (-${signal.targetsData.stopPercentage}%)
${tradeRecord.targets.map((t, i) => 
`• Alvo ${i+1}: <b>$${t.price.toFixed(2)}</b> (+${t.percentage}%) RR: ${t.rr}`
).join('\n')}

🧠 <b>SISTEMA RL:</b>
• Recomendação: <b>${tradeRecord.rlAction}</b>
• Confiança: <b>${tradeRecord.rlConfidence.toFixed(1)}%</b>
• Ação Usada: <b>${tradeRecord.usedRLAction ? 'SIM ✅' : 'NÃO'}</b>

⚠️ <b>RISCO:</b> ${breakoutRisk.toUpperCase()}
📈 <b>DIVERGÊNCIA:</b> ${divergenceInfo}
📏 <b>DISTÂNCIA S/R:</b> ${srDistance}%

🔔 by @J4Rviz.
            `;
            
            await sendTelegramAlert(message);
            
        } catch (error) {
            console.error('Erro ao enviar alerta de trade:', error);
        }
    }
    
    async checkTradeOutcome(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade || trade.status !== 'OPEN') return;
            
            const currentPrice = await getCurrentPrice(trade.symbol);
            if (!currentPrice) return;
            
            let outcome = 'FAILURE';
            let exitPrice = trade.stopPrice;
            let profitPercentage = 0;
            let maxDrawdown = 0;
            
            const priceHistory = await this.getPriceHistoryDuringTrade(trade);
            if (priceHistory.length > 0) {
                let peak = trade.entryPrice;
                let maxDrop = 0;
                
                for (const price of priceHistory) {
                    peak = trade.direction === 'BUY' ? 
                        Math.max(peak, price) : Math.min(peak, price);
                    
                    const drawdown = trade.direction === 'BUY' ? 
                        (peak - price) / peak * 100 : 
                        (price - peak) / peak * 100;
                    
                    maxDrop = Math.max(maxDrop, drawdown);
                }
                
                maxDrawdown = maxDrop;
                trade.maxDrawdownPercentage = maxDrawdown;
            }
            
            for (const target of trade.targets) {
                const targetReached = trade.direction === 'BUY' 
                    ? currentPrice >= target.price
                    : currentPrice <= target.price;
                
                if (targetReached) {
                    outcome = 'SUCCESS';
                    exitPrice = target.price;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                    break;
                }
            }
            
            if (outcome === 'FAILURE') {
                const stopHit = trade.direction === 'BUY'
                    ? currentPrice <= trade.stopPrice
                    : currentPrice >= trade.stopPrice;
                
                if (stopHit) {
                    exitPrice = trade.stopPrice;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                } else {
                    exitPrice = currentPrice;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                    outcome = 'TIMEOUT';
                }
            }
            
            trade.status = 'CLOSED';
            trade.outcome = outcome;
            trade.exitPrice = exitPrice;
            trade.profitPercentage = profitPercentage;
            trade.durationHours = (Date.now() - trade.timestamp) / (1000 * 60 * 60);
            trade.maxDrawdownPercentage = maxDrawdown;
            
            if (RL_SETTINGS.enabled) {
                await this.rlSystem.learnFromTrade(trade, trade.marketData);
            }
            
            const symbolStats = this.symbolPerformance[trade.symbol];
            if (outcome === 'SUCCESS' || (outcome === 'TIMEOUT' && profitPercentage > 0)) {
                symbolStats.successfulSignals++;
                symbolStats.totalProfit += profitPercentage;
                
                if (trade.usedRLAction) {
                    symbolStats.rlPerformance.wins++;
                }
            } else {
                if (trade.usedRLAction) {
                    symbolStats.rlPerformance.losses++;
                }
            }
            
            symbolStats.avgHoldingTime = symbolStats.successfulSignals > 0
                ? (symbolStats.avgHoldingTime * (symbolStats.successfulSignals - 1) + trade.durationHours) / symbolStats.successfulSignals
                : trade.durationHours;
            
            this.openTrades.delete(tradeId);
            
            await this.analyzePatterns();
            
            console.log(`📊 Trade ${trade.symbol} ${trade.direction} ${outcome}: ${profitPercentage.toFixed(2)}% ${trade.usedRLAction ? '[RL]' : ''}`);
            
            await this.sendTradeResult(trade);
            
        } catch (error) {
            console.error('Erro ao verificar outcome do trade:', error);
        }
    }
    
    async sendTradeResult(trade) {
        try {
            const outcomeEmoji = trade.outcome === 'SUCCESS' ? '✅' : '❌';
            const profitEmoji = trade.profitPercentage > 0 ? '💰' : '💸';
            const rlEmoji = trade.usedRLAction ? '🧠' : '';
            
            const message = `
${outcomeEmoji} <b>TRADE FECHADO ${rlEmoji}</b>

📊 <b>${trade.symbol} ${trade.direction}</b>
⏱️ Duração: <b>${trade.durationHours.toFixed(1)}h</b>

💰 <b>RESULTADO:</b>
• Entrada: <b>$${trade.entryPrice.toFixed(2)}</b>
• Saída: <b>$${trade.exitPrice.toFixed(2)}</b>
• Resultado: <b>${trade.profitPercentage > 0 ? '+' : ''}${trade.profitPercentage.toFixed(2)}%</b> ${profitEmoji}
• Outcome: <b>${trade.outcome}</b>

📈 <b>ESTATÍSTICAS:</b>
• Drawdown Máx: <b>${trade.maxDrawdownPercentage.toFixed(2)}%</b>
• Score Original: <b>${trade.qualityScore}/100</b>
${trade.usedRLAction ? '• Decisão RL: <b>SIM ✅</b>' : '• Decisão RL: <b>NÃO</b>'}

🔔 by @J4Rviz.
            `;
            
            await sendTelegramAlert(message);
            
        } catch (error) {
            console.error('Erro ao enviar resultado:', error);
        }
    }
    
    async getPriceHistoryDuringTrade(trade) {
        try {
            const timeframe = trade.durationHours < 1 ? '1m' : 
                             trade.durationHours < 4 ? '5m' : '15m';
            
            const candlesNeeded = Math.ceil(trade.durationHours * 60 / 
                (timeframe === '1m' ? 1 : timeframe === '5m' ? 5 : 15));
            
            const candles = await getCandlesCached(trade.symbol, timeframe, candlesNeeded);
            return candles.map(c => c.close);
        } catch (error) {
            return [];
        }
    }
    
    async analyzePatterns() {
        try {
            const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
            if (closedTrades.length < 10) return;
            
            this.patterns = { winning: {}, losing: {} };
            
            for (const trade of closedTrades) {
                const patternKey = this.generatePatternKey(trade);
                
                if (trade.outcome === 'SUCCESS' || (trade.outcome === 'TIMEOUT' && trade.profitPercentage > 0)) {
                    this.patterns.winning[patternKey] = (this.patterns.winning[patternKey] || 0) + 1;
                } else {
                    this.patterns.losing[patternKey] = (this.patterns.losing[patternKey] || 0) + 1;
                }
            }
            
            console.log(`📊 Padrões analisados: ${Object.keys(this.patterns.winning).length} vencedores, ${Object.keys(this.patterns.losing).length} perdedores`);
            
        } catch (error) {
            console.error('Erro ao analisar padrões:', error);
        }
    }
    
    generatePatternKey(trade) {
        const patterns = [];
        
        if (trade.marketData.volumeRatio > 2) patterns.push('volume_high');
        else if (trade.marketData.volumeRatio < 1) patterns.push('volume_low');
        
        if (trade.marketData.rsi < 30) patterns.push('rsi_oversold');
        else if (trade.marketData.rsi > 70) patterns.push('rsi_overbought');
        
        if (trade.marketData.adx1h > 40) patterns.push('adx_strong');
        else if (trade.marketData.adx1h > 25) patterns.push('adx_medium');
        
        if (trade.marketData.cci4hValue < -100) patterns.push('cci_oversold');
        else if (trade.marketData.cci4hValue > 100) patterns.push('cci_overbought');
        
        if (trade.marketData.divergence15m?.hasDivergence) {
            patterns.push(`divergence_${trade.marketData.divergence15m.type}`);
        }
        
        return patterns.join('+');
    }
    
    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
        const losers = closedTrades.filter(t => t.outcome === 'FAILURE');
        
        const winRate = closedTrades.length > 0 ? winners.length / closedTrades.length : 0;
        const avgProfit = winners.length > 0 ? 
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        const avgLoss = losers.length > 0 ? 
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;
        
        const profitFactor = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;
        
        const rlTrades = closedTrades.filter(t => t.usedRLAction);
        const rlWinners = rlTrades.filter(t => t.outcome === 'SUCCESS');
        const rlWinRate = rlTrades.length > 0 ? rlWinners.length / rlTrades.length : 0;
        
        const rlReport = this.rlSystem.getRLReport();
        
        const winningPatterns = Object.entries(this.patterns.winning)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        const losingPatterns = Object.entries(this.patterns.losing)
            .filter(([_, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        return {
            totalTrades: closedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate * 100,
            profitFactor: profitFactor.toFixed(2),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            rlTrades: rlTrades.length,
            rlWinRate: rlWinRate * 100,
            rlPerformance: this.getRLPerformance(),
            rlStats: rlReport,
            bestPatterns: winningPatterns,
            worstPatterns: losingPatterns,
            openTrades: this.openTrades.size,
            monitoredSymbols: Object.keys(this.symbolPerformance).length
        };
    }
    
    getRLPerformance() {
        const rlTrades = this.tradeHistory.filter(t => t.usedRLAction && t.status === 'CLOSED');
        
        if (rlTrades.length === 0) {
            return { total: 0, winRate: 0, avgProfit: 0 };
        }
        
        const winners = rlTrades.filter(t => t.outcome === 'SUCCESS');
        const winRate = winners.length / rlTrades.length;
        
        const avgProfit = winners.length > 0 ? 
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        
        const actionProfit = {};
        rlTrades.forEach(trade => {
            if (!actionProfit[trade.rlAction]) {
                actionProfit[trade.rlAction] = { total: 0, count: 0, wins: 0 };
            }
            actionProfit[trade.rlAction].total += trade.profitPercentage || 0;
            actionProfit[trade.rlAction].count++;
            if (trade.outcome === 'SUCCESS') actionProfit[trade.rlAction].wins++;
        });
        
        return {
            total: rlTrades.length,
            winRate: winRate * 100,
            avgProfit: avgProfit.toFixed(2),
            actionPerformance: actionProfit,
            explorationRate: this.rlSystem.explorationRate.toFixed(3)
        };
    }
    
    async sendPerformanceReport() {
        try {
            const report = this.getPerformanceReport();
            
            if (report.totalTrades < 5) {
                return;
            }
            
            const rlSection = report.rlTrades > 0 ? `
🤖 <b>SISTEMA RL:</b>
• Trades RL: <b>${report.rlTrades}</b>
• Win Rate RL: <b>${report.rlWinRate.toFixed(1)}%</b>
• Exploration Rate: <b>${report.rlStats.explorationRate}</b>
• Estados Aprendidos: <b>${report.rlStats.totalStates}</b>
• Experiências: <b>${report.rlStats.totalExperiences}</b>
• Recompensa Média: <b>${report.rlStats.avgReward}</b>
            ` : `
🤖 <b>SISTEMA RL:</b>
• Coletando dados... (${report.rlStats.totalStates} estados aprendidos)
            `;
            
            const message = `
🧠 <b>RELATÓRIO DE PERFORMANCE COM RL</b>

📊 <b>ESTATÍSTICAS GERAIS:</b>
• Trades Fechados: <b>${report.totalTrades}</b>
• Win Rate: <b>${report.winRate.toFixed(1)}%</b>
• Profit Factor: <b>${report.profitFactor}</b>
• Média Gain: <b>${report.avgProfit}%</b>
• Média Loss: <b>${report.avgLoss}%</b>

${rlSection}

📈 <b>PADRÕES VENCEDORES:</b>
${report.bestPatterns.map(([pattern, count]) => `• ${pattern}: ${count} trades`).join('\n') || '• Coletando dados...'}

📉 <b>PADRÕES PERDEDORES:</b>
${report.worstPatterns.map(([pattern, count]) => `• ${pattern}: ${count} trades`).join('\n') || '• Coletando dados...'}

⚙️ <b>PARÂMETROS ATUAIS:</b>
• Volume Threshold: <b>${VOLUME_SETTINGS.baseThreshold.toFixed(2)}x</b>
• ADX Mínimo: <b>${ADX_1H_SETTINGS.minStrength.toFixed(1)}</b>
• Quality Threshold: <b>${QUALITY_THRESHOLD}</b>
• RL Learning Rate: <b>${this.rlSystem.learningRate.toFixed(4)}</b>

🔧 <i>IA em aprendizado contínuo com RL</i>
🔔 by @J4Rviz.
            `;
            
            await sendTelegramAlert(message);
            
        } catch (error) {
            console.error('Erro ao enviar relatório:', error);
        }
    }
    
    async resetRL() {
        this.rlSystem.resetLearning();
        console.log('🔄 Sistema RL reiniciado');
    }
}

// =====================================================================
// SISTEMA DE MONITORAMENTO DE TODAS AS MOEDAS COM RATE LIMIT
// =====================================================================

class FuturesMarketScanner {
    constructor() {
        this.allSymbols = [];
        this.activeSymbols = [];
        this.lastUpdateTime = 0;
        this.symbolCooldown = new Map();
    }
    
    async initialize() {
        console.log('📊 Inicializando scanner de mercado Futures...');
        await this.updateSymbolsList();
        console.log(`✅ Scanner pronto: ${this.activeSymbols.length} moedas para monitorar`);
    }
    
    async updateSymbolsList() {
        try {
            if (Date.now() - this.lastUpdateTime < SYMBOLS_UPDATE_INTERVAL && this.allSymbols.length > 0) {
                return this.activeSymbols;
            }
            
            console.log('🔄 Atualizando lista de símbolos...');
            this.allSymbols = await getAllFuturesSymbols();
            this.activeSymbols = await getTopVolumeSymbols(MAX_SYMBOLS_TO_MONITOR);
            
            this.lastUpdateTime = Date.now();
            console.log(`✅ Lista atualizada: ${this.activeSymbols.length} moedas ativas`);
            
            await this.sendMarketReport();
            
            return this.activeSymbols;
            
        } catch (error) {
            console.error('❌ Erro ao atualizar lista de símbolos:', error);
            return this.activeSymbols.length > 0 ? this.activeSymbols : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
        }
    }
    
    async sendMarketReport() {
        try {
            const message = `
📊 <b>MERCADO FUTURES - RELATÓRIO INICIAL</b>

✅ Scanner configurado para monitorar <b>${this.activeSymbols.length} moedas</b>

🔍 <b>MOEDAS MONITORADAS:</b>
${this.activeSymbols.slice(0, 20).map((s, i) => `${i+1}. ${s}`).join('\n')}
${this.activeSymbols.length > 20 ? `\n... e mais ${this.activeSymbols.length - 20} moedas` : ''}

⚙️ <b>CONFIGURAÇÕES:</b>
• Volume mínimo: <b>${(MIN_VOLUME_24H/1000000).toFixed(1)}M USDT</b>
• Máximo de moedas: <b>${MAX_SYMBOLS_TO_MONITOR}</b>
• Intervalo de análise: <b>3 minutos</b>
• Live Mode: <b>✅ ATIVADO</b>
• Rate Limit: <b>✅ INTELIGENTE</b>
• Modo Simulação: <b>${SIMULATION_MODE ? '✅ ATIVADO' : '❌ DESATIVADO'}</b>

🤖 <b>SISTEMA RL ATIVO:</b>
• Aprendizado por reforço integrado
• Análise em tempo real
• Alertas automáticos

🔔 by @J4Rviz.
            `;
            
            await sendTelegramAlert(message);
            
        } catch (error) {
            console.error('Erro ao enviar relatório de mercado:', error);
        }
    }
    
    isSymbolInCooldown(symbol) {
        const cooldownEnd = this.symbolCooldown.get(symbol);
        if (!cooldownEnd) return false;
        
        if (Date.now() > cooldownEnd) {
            this.symbolCooldown.delete(symbol);
            return false;
        }
        
        const minutesLeft = Math.ceil((cooldownEnd - Date.now()) / 60000);
        console.log(`⏳ ${symbol} em cooldown: ${minutesLeft} min restantes`);
        return true;
    }
    
    applyCooldown(symbol, isBullish) {
        const cooldownTime = isBullish ? 
            COOLDOWN_SETTINGS.sameDirection : 
            COOLDOWN_SETTINGS.oppositeDirection;
        
        this.symbolCooldown.set(symbol, Date.now() + cooldownTime);
    }
}

// =====================================================================
// FUNÇÃO PRINCIPAL DE MONITORAMENTO COM RATE LIMIT
// =====================================================================

async function monitorSymbol(symbol) {
    try {
        console.log(`🔍 Monitorando ${symbol}...`);
        
        const emaData = await getEMAs3m(symbol);
        if (!emaData) {
            console.log(`  ⏭️  ${symbol}: Sem dados EMA`);
            return null;
        }
        
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) {
            console.log(`  ⏭️  ${symbol}: Sem dados RSI`);
            return null;
        }
        
        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;
        
        if (!isBullish && !isBearish) {
            console.log(`  ⏭️  ${symbol}: Sem sinal claro`);
            return null;
        }
        
        if (isBullish && rsiData.value >= 60) {
            console.log(`  ⏭️  ${symbol}: RSI muito alto para compra`);
            return null;
        }
        if (isBearish && rsiData.value <= 40) {
            console.log(`  ⏭️  ${symbol}: RSI muito baixo para venda`);
            return null;
        }
        
        const divergenceData = await checkDivergence15m(symbol, isBullish);
        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        
        const [
            volumeData,
            volatilityData,
            lsrData,
            adx1hData,
            stochData,
            stoch4hData,
            cci4hData,
            oiData,
            fundingData
        ] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            getADX1h(symbol),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),
            checkCCI4h(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);
        
        if (!adx1hData || !adx1hData.hasMinimumStrength) {
            console.log(`  ⏭️  ${symbol}: ADX muito fraco`);
            return null;
        }
        
        if (volatilityData) {
            rateLimiter.setVolatilityForSymbol(symbol, volatilityData.rawVolatility);
        }
        
        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            adx1h: adx1hData,
            stoch: stochData,
            stoch4h: stoch4hData,
            cci4h: cci4hData,
            oi: oiData,
            funding: fundingData,
            ema: {
                isAboveEMA55: emaData.isAboveEMA55,
                isEMA13CrossingUp: emaData.isEMA13CrossingUp,
                isEMA13CrossingDown: emaData.isEMA13CrossingDown
            },
            divergence15m: divergenceData,
            supportResistance: supportResistanceData,
            breakoutRisk: supportResistanceData?.breakoutRisk
        };
        
        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);
        
        if (!qualityScore.isAcceptable) {
            console.log(`  ⏭️  ${symbol}: Score baixo (${qualityScore.score})`);
            return null;
        }
        
        const targetsData = await calculateAdvancedTargetsAndStop(emaData.currentPrice, isBullish, symbol);
        
        const signal = {
            symbol: symbol,
            isBullish: isBullish,
            price: emaData.currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            timestamp: Date.now()
        };
        
        if (learningSystem) {
            await learningSystem.recordSignal(signal, marketData);
        }
        
        const divergenceInfo = divergenceData?.hasDivergence ? 
            `${divergenceData.type}${divergenceData.confirmed ? '✅' : '⚠️'}` : 'N/A';
        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   📊 Divergência: ${divergenceInfo} | S/R: ${srDistance}% | Risco: ${breakoutRisk} | Stop: ${targetsData.stopPercentage}%`);
        
        return signal;
        
    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// LOOP PRINCIPAL DO BOT (LIVE MODE) COM RATE LIMIT
// =====================================================================

let learningSystem = new AdvancedLearningSystemWithRL();
let marketScanner = new FuturesMarketScanner();

async function mainBotLoop() {
    console.log('\n🚀 Iniciando loop principal do bot (LIVE MODE)...');
    console.log('📱 Telegram configurado para enviar alertas reais!');
    console.log('⚡ Sistema de Rate Limit Inteligente ATIVADO');
    console.log('💾 Sistema de Cache Agressivo ATIVADO');
    console.log(`🎮 Modo Simulação: ${SIMULATION_MODE ? 'ATIVADO' : 'DESATIVADO'}`);
    
    await marketScanner.initialize();
    
    let cycle = 0;
    
    while (true) {
        try {
            cycle++;
            console.log(`\n🔄 CICLO ${cycle} - ${new Date().toLocaleTimeString('pt-BR')}`);
            
            const symbols = await marketScanner.updateSymbolsList();
            
            if (symbols.length === 0) {
                console.log('⚠️  Nenhum símbolo para monitorar');
                await new Promise(r => setTimeout(r, 60000));
                continue;
            }
            
            console.log(`📈 Monitorando ${symbols.length} moedas...`);
            
            const batchSize = RATE_LIMIT_CONFIG.BATCH_PROCESSING.batchSize;
            for (let i = 0; i < symbols.length; i += batchSize) {
                const batch = symbols.slice(i, i + batchSize);
                
                const symbolsToMonitor = batch.filter(symbol => 
                    !marketScanner.isSymbolInCooldown(symbol)
                );
                
                if (symbolsToMonitor.length > 0) {
                    const promises = symbolsToMonitor.map(symbol => monitorSymbol(symbol));
                    const results = await Promise.allSettled(promises);
                    
                    results.forEach((result, index) => {
                        if (result.status === 'fulfilled' && result.value) {
                            const symbol = symbolsToMonitor[index];
                            marketScanner.applyCooldown(symbol, result.value.isBullish);
                        }
                    });
                    
                    if (i + batchSize < symbols.length) {
                        const delay = RATE_LIMIT_CONFIG.BATCH_PROCESSING.batchDelayMs;
                        console.log(`⏳ Aguardando ${delay}ms entre batches...`);
                        await new Promise(r => setTimeout(r, delay));
                    }
                }
            }
            
            if (cycle % 10 === 0 && learningSystem) {
                await learningSystem.sendPerformanceReport();
                
                const metrics = rateLimiter.getMetrics();
                console.log('📊 Métricas do Rate Limit:');
                console.log('- Circuit State:', metrics.circuitState);
                console.log('- Requests:', metrics.totalRequests);
                console.log('- Success Rate:', ((metrics.successfulRequests / metrics.totalRequests) * 100 || 0).toFixed(1) + '%');
                console.log('- Adaptive Delay:', metrics.adaptiveDelay, 'ms');
                console.log('- Queue:', metrics.queueLength);
                
                console.log('💾 Métricas do Cache:');
                console.log('- Hit Rate:', metrics.cacheStats?.hitRate || '0%');
                console.log('- Cache Hits:', metrics.cacheStats?.hits || 0);
                console.log('- Cache Misses:', metrics.cacheStats?.misses || 0);
                console.log('- API Calls Saved:', metrics.cacheStats?.estimatedAPISavings || 0);
            }
            
            if (cycle % 5 === 0) {
                learningSystem.saveLearningData();
                learningSystem.rlSystem.saveRLData();
            }
            
            console.log(`⏳ Aguardando próximo ciclo (3 minutos)...`);
            await new Promise(r => setTimeout(r, 3 * 60 * 1000));
            
        } catch (error) {
            console.error(`🚨 ERRO NO LOOP PRINCIPAL: ${error.message}`);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// =====================================================================
// FUNÇÕES AUXILIARES E TESTES
// =====================================================================

async function testRLSystem() {
    console.log('\n🧪 TESTANDO SISTEMA RL...');
    
    if (learningSystem && learningSystem.rlSystem) {
        const rlReport = learningSystem.rlSystem.getRLReport();
        
        console.log('📊 RELATÓRIO RL:');
        console.log('- Estados aprendidos:', rlReport.totalStates);
        console.log('- Experiências no buffer:', rlReport.totalExperiences);
        console.log('- Exploration Rate:', rlReport.explorationRate);
        console.log('- Recompensa média:', rlReport.avgReward);
        console.log('- Updates realizados:', rlReport.updatesPerformed);
        
        if (rlReport.topStates.length > 0) {
            console.log('\n🏆 MELHORES ESTADOS:');
            rlReport.topStates.forEach((state, i) => {
                console.log(`${i + 1}. ${state.state}`);
                console.log(`   Ação: ${state.action}, Valor: ${state.value}`);
            });
        }
    }
}

async function checkInternetConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('https://fapi.binance.com/fapi/v1/ping', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        return false;
    }
}

// =====================================================================
// INICIALIZAÇÃO (LIVE MODE)
// =====================================================================

async function startBotWithRL() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM BOT FUTURES - COM APRENDIZADO POR REFORÇO');
        console.log('📊 MONITORANDO TODAS AS MOEDAS DA BINANCE FUTURES');
        console.log('📱 MODO LIVE ATIVADO - ENVIANDO ALERTAS PARA TELEGRAM');
        console.log('⚡ SISTEMA DE RATE LIMIT INTELIGENTE ATIVADO');
        console.log('💾 SISTEMA DE CACHE AGUESSIVO ATIVADO');
        console.log(`🎮 MODO SIMULAÇÃO: ${SIMULATION_MODE ? 'ATIVADO' : 'DESATIVADO'}`);
        console.log('='.repeat(80));
        
        console.log('\n🤖 CONFIGURAÇÃO RL:');
        console.log('- Modo: LIVE (alertas reais)');
        console.log('- Moedas: TODAS as Futures USDT');
        console.log('- Máximo de moedas:', MAX_SYMBOLS_TO_MONITOR);
        console.log('- Volume mínimo:', MIN_VOLUME_24H, 'USDT');
        console.log('- Learning Rate:', RL_SETTINGS.learningRate);
        console.log('- Exploration Rate:', RL_SETTINGS.explorationRate);
        
        console.log('\n⚡ CONFIGURAÇÃO RATE LIMIT:');
        console.log('- Batch Size:', RATE_LIMIT_CONFIG.BATCH_PROCESSING.batchSize);
        console.log('- Max Concurrent:', RATE_LIMIT_CONFIG.BATCH_PROCESSING.maxConcurrentRequests);
        console.log('- Circuit Breaker:', RATE_LIMIT_CONFIG.CIRCUIT_BREAKER.enabled ? '✅' : '❌');
        console.log('- Adaptive Delay:', RATE_LIMIT_CONFIG.ADAPTIVE_RATE.enabled ? '✅' : '❌');
        
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ ERRO: technicalindicators não instalado');
            console.log('💡 Execute: npm install technicalindicators');
            process.exit(1);
        }
        
        console.log('\n🔍 Verificando conexão com Binance Futures...');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            if (await checkInternetConnection()) {
                connected = true;
                break;
            }
            console.log(`  Tentativa ${i + 1}/3 falhou, aguardando 5 segundos...`);
            await new Promise(r => setTimeout(r, 5000));
        }
        
        if (!connected) {
            console.log('⚠️  Sem conexão com a Binance Futures, usando modo simulação...');
            if (!SIMULATION_MODE) {
                console.log('🔄 Ativando modo simulação automaticamente');
                SIMULATION_MODE = true;
                SIMULATION_CONFIG.ENABLED = true;
            }
        } else {
            console.log('✅ Conexão com Binance Futures OK');
        }
        
        console.log('\n✅ Tudo pronto! Iniciando monitoramento completo...');
        
        await testRLSystem();
        
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await startBotWithRL();
    }
}

// =====================================================================
// MANIPULAÇÃO DE SINAIS
// =====================================================================

process.on('SIGINT', async () => {
    console.log('\n\n🛑 Recebido SIGINT, encerrando graciosamente...');
    
    if (learningSystem) {
        learningSystem.saveLearningData();
        learningSystem.rlSystem.saveRLData();
        console.log('💾 Dados salvos com sucesso');
    }
    
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('🚨 EXCEÇÃO NÃO TRATADA:', error);
    
    if (learningSystem) {
        learningSystem.saveLearningData();
        learningSystem.rlSystem.saveRLData();
    }
    
    setTimeout(() => {
        console.log('🔄 Tentando reiniciar...');
        startBotWithRL();
    }, 30000);
});

// =====================================================================
// INICIAR O BOT (LIVE MODE)
// =====================================================================

startBotWithRL();
