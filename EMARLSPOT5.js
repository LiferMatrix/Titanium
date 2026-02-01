const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE VOLUME MÍNIMO ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.20,
    combinedScore: 0.20,
    classification: 'BAIXO',
    requireConfirmation: false
};

// === CONFIGURAÇÕES OTIMIZADAS BASEADAS NO APRENDIZADO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.3,
    minThreshold: 1.1,
    maxThreshold: 2.0,
    volatilityMultiplier: 0.6,
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO ATUALIZADAS PARA 3m - MAIS SENSÍVEIS ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 9,
    emaAlpha: 0.4,
    baseZScoreLookback: 25,
    minZScoreLookback: 6,
    maxZScoreLookback: 40,
    zScoreThreshold: 1.0,
    vptThreshold: 0.15,
    minPriceMovement: 0.06,
    combinedMultiplier: 1.05,
    volumeWeight: 0.40,
    emaWeight: 0.35,
    zScoreWeight: 0.20,
    vptWeight: 0.05,
    minimumThresholds: {
        combinedScore: 0.10,
        emaRatio: 1.03,
        zScore: 0.10,
        classification: 'BAIXO'
    }
};

const VOLATILITY_PERIOD = 12;
const VOLATILITY_TIMEFRAME = '5m';
const VOLATILITY_THRESHOLD = 0.3;

// === CONFIGURAÇÕES RSI - MAIS SENSÍVEIS ===
const RSI_BUY_MAX = 60;
const RSI_SELL_MIN = 50;

// === CONFIGURAÇÕES DE SENSIBILIDADE ===
const SENSITIVITY_SETTINGS = {
    scanInterval: 4000,
    minScanInterval: 2000,
    maxScanInterval: 6000,
    symbolGroupSize: 12,
    maxConsecutiveNoSignals: 1,
};

// === CONFIGURAÇÕES DE COOLDOWN MAIS RÁPIDAS ===
const COOLDOWN_SETTINGS = {
    sameDirection: 3 * 60 * 1000,
    oppositeDirection: 1 * 60 * 1000,
    useDifferentiated: true,
    adaptiveSettings: {
        highVolumeMultiplier: 0.3,
        highCorrelationMultiplier: 0.2,
        consecutiveSignalMultiplier: 1.2
    }
};

// === QUALITY SCORE MAIS PERMISSIVO ===
const QUALITY_THRESHOLD = 80;

// === PESOS AJUSTADOS PARA MAIOR SENSIBILIDADE A BTC ===
const QUALITY_WEIGHTS = {
    volume: 25,
    volatility: 8,
    rsi: 14,
    emaAlignment: 14,
    stoch1h: 10,
    stoch4h: 10,
    breakoutRisk: 10,
    supportResistance: 10,
    pivotPoints: 8,
    btcCorrelation: 30,
    momentum: 8,
    volumeConfirmation: 10,
    trendAlignment: 10
};

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1400,
    requestsPerSecond: 50,
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2600,
    maxWeightPerSecond: 50,
    retryConfig: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 8000,
        backoffFactor: 1.8
    },
    circuitBreaker: {
        failureThreshold: 12,
        resetTimeout: 45000,
        halfOpenMaxRequests: 6
    }
};

// === CONFIGURAÇÕES PARA RETRAÇÕES DINÂMICAS COM ATR ===
const RETRACEMENT_SETTINGS = {
    minPercentage: 0.15,
    maxPercentage: 0.35,
    useDynamicATR: true,
    atrMultiplierMin: 0.3,
    atrMultiplierMax: 0.6,
    volatilityAdjustment: {
        low: 0.6,
        medium: 0.8,
        high: 1.0
    }
};

// === CONFIGURAÇÕES DE STOP DINÂMICO ===
const DYNAMIC_STOP_SETTINGS = {
    baseATRMultiplier: 2.5,
    minStopPercentage: 1.2,
    maxStopPercentage: 5.0,
    volatilityBased: true,
    volatilityMultipliers: {
        low: 0.5,
        medium: 0.7,
        high: 0.9
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE SUPORTE/RESISTÊNCIA ===
const SUPPORT_RESISTANCE_SETTINGS = {
    lookbackPeriod: 35,
    timeframe: '5m',
    minTouchPoints: 2,
    proximityThreshold: 0.8,
    breakoutThreshold: 0.5,
    strongLevelThreshold: 2,
    recentPeriod: 12
};

// === CONFIGURAÇÕES PARA RISCO DE ROMPIMENTO ===
const BREAKOUT_RISK_SETTINGS = {
    highRiskDistance: 0.25,
    mediumRiskDistance: 0.5,
    lowRiskDistance: 1.0,
    safeDistance: 2.0
};

// === CONFIGURAÇÕES PARA PIVOT POINTS MULTI-TIMEFRAME ===
const PIVOT_POINTS_SETTINGS = {
    timeframeStrengthWeights: {
        '3m': 0.8,
        '5m': 1.0,
        '15m': 1.5,
        '1h': 2.5,
        '4h': 4.0
    },
    safeDistanceMultipliers: {
        'weak': 0.3,
        'moderate': 0.6,
        'strong': 0.9,
        'very_strong': 1.2
    },
    minDistance: 3,
    priceTolerance: 0.002,
    analyzeTimeframes: ['3m', '5m', '15m'],
    candlesPerTimeframe: {
        '3m': 40,
        '5m': 45,
        '15m': 50,
        '1h': 70
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE PERFORMANCE VS BTC - MAIS SENSÍVEIS ===
const BTC_CORRELATION_SETTINGS = {
    timeframe: '3m',
    lookbackPeriods: {
        ultraShort: 2,
        short: 4,
        medium: 8,
        long: 12
    },
    thresholds: {
        strongOutperformance: 0.8,
        mediumOutperformance: 0.4,
        neutralZone: 0.2,
        underperformance: -0.2,
        strongUnderperformance: -0.5
    },
    weights: {
        ultraShort: 0.4,
        short: 0.3,
        medium: 0.2,
        long: 0.1
    }
};

// === CONFIGURAÇÕES DE PRIORIDADE ===
const PRIORITY_SETTINGS = {
    highPriority: {
        btcOutperformance: 1.0,
        volumeSpike: 2.5,
        momentum1m: 0.8,
        rsiSignal: true,
    },
    mediumPriority: {
        btcOutperformance: 0.5,
        volumeSpike: 1.8,
        rsiReversal: true,
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS MAIS RÁPIDOS ===
const candleCache = {};
const momentumCache = {};
const correlationCache = {};
const CANDLE_CACHE_TTL = 20000;
const MOMENTUM_CACHE_TTL = 5000;
const CORRELATION_CACHE_TTL = 8000;
const MAX_CACHE_AGE = 3 * 60 * 1000;

// === CONFIGURAÇÕES TÉCNICAS ===
const STOCH_SETTINGS = {
    period: 14,
    smooth: 3,
    signalPeriod: 3,
    timeframe1h: '1h'
};

const STOCH_4H_SETTINGS = {
    period: 14,
    signalPeriod: 3,
    smooth: 3,
    timeframe: '4h'
};

const TARGET_PERCENTAGES = [0.8, 1.5, 2.5, 4.0, 6.0];
const ATR_PERIOD = 10;
const ATR_TIMEFRAME = '5m';

// =====================================================================
// 🔄 CIRCUIT BREAKER CLASS
// =====================================================================

class CircuitBreaker {
    constructor() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.resetTimeout = BINANCE_RATE_LIMIT.circuitBreaker.resetTimeout;
        this.failureThreshold = BINANCE_RATE_LIMIT.circuitBreaker.failureThreshold;
        this.halfOpenMaxRequests = BINANCE_RATE_LIMIT.circuitBreaker.halfOpenMaxRequests;
    }

    canExecute() {
        const now = Date.now();

        switch (this.state) {
            case 'CLOSED':
                return true;

            case 'OPEN':
                if (this.lastFailureTime && (now - this.lastFailureTime) >= this.resetTimeout) {
                    this.state = 'HALF_OPEN';
                    this.successCount = 0;
                    console.log('🔧 Circuit Breaker: Mudando para HALF_OPEN');
                    return true;
                }
                return false;

            case 'HALF_OPEN':
                if (this.successCount >= this.halfOpenMaxRequests) {
                    this.state = 'CLOSED';
                    this.failureCount = 0;
                    console.log('🔧 Circuit Breaker: Mudando para CLOSED (recuperado)');
                }
                return this.successCount < this.halfOpenMaxRequests;

            default:
                return false;
        }
    }

    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
        } else if (this.state === 'CLOSED') {
            this.failureCount = Math.max(0, this.failureCount - 1);
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.log(`🚨 Circuit Breaker: Mudando para OPEN (falhas: ${this.failureCount})`);
        } else if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            console.log('🚨 Circuit Breaker: Retornando para OPEN (falha no half-open)');
        }
    }

    getStatus() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            canExecute: this.canExecute()
        };
    }
}

// =====================================================================
// 🚀 RATE LIMITER COM DELAY ADAPTATIVO
// =====================================================================

class AdaptiveRateLimiter {
    constructor() {
        this.minuteWindow = { start: Date.now(), usedWeight: 0 };
        this.secondWindow = { start: Date.now(), usedWeight: 0 };

        this.circuitBreaker = new CircuitBreaker();
        this.queue = [];
        this.isProcessing = false;
        this.lastStatusLog = Date.now();

        this.adaptiveDelay = 60;
        this.minDelay = 20;
        this.maxDelay = 200;
        this.usageThreshold = 0.75;

        console.log('🚀 Rate Limiter Adaptativo inicializado');
    }

    async makeRequest(url, options = {}, endpointType = 'klines') {
        const weight = BINANCE_RATE_LIMIT.weightPerRequest[endpointType] || 1;
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const request = {
                id: requestId,
                url,
                options,
                weight,
                endpointType,
                resolve,
                reject,
                timestamp: Date.now(),
                retryCount: 0
            };

            this.queue.push(request);

            if (!this.isProcessing) {
                this.processQueue();
            }

            setTimeout(() => {
                const index = this.queue.findIndex(req => req.id === requestId);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    reject(new Error(`Request timeout: ${url}`));
                }
            }, 15000);
        });
    }

    async processQueue() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(300);
                    continue;
                }

                const request = this.queue.shift();
                if (!request) {
                    await this.delay(30);
                    continue;
                }

                if (!this.checkLimits(request.weight)) {
                    this.queue.unshift(request);
                    await this.waitForLimits(request.weight);
                    continue;
                }

                try {
                    const result = await this.executeRequest(request);
                    request.resolve(result);
                    this.circuitBreaker.recordSuccess();
                    this.adjustDelay();

                } catch (error) {
                    request.reject(error);
                    this.circuitBreaker.recordFailure();

                    if (error.message && error.message.includes('429')) {
                        console.log('⏳ Rate Limit 429. Aumentando delay...');
                        this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.3);
                        await this.delay(3000);
                    }
                }

                await this.delay(this.adaptiveDelay);
            }
        } finally {
            this.isProcessing = false;
        }

        if (Date.now() - this.lastStatusLog >= 30000) {
            this.logStatus();
            this.lastStatusLog = Date.now();
        }
    }

    checkLimits(weight) {
        const now = Date.now();

        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }

        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        const secondUsage = this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond;

        return minuteUsage < 0.9 && secondUsage < 0.85;
    }

    adjustDelay() {
        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;

        if (minuteUsage > this.usageThreshold) {
            this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.08);
        } else if (minuteUsage < this.usageThreshold * 0.6) {
            this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.92);
        }
    }

    async waitForLimits(weight) {
        const now = Date.now();
        const minuteRemaining = 60000 - (now - this.minuteWindow.start);
        const secondRemaining = 1000 - (now - this.secondWindow.start);

        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        const secondUsage = this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond;

        if (minuteUsage > 0.9) {
            await this.delay(minuteRemaining + 50);
        } else if (secondUsage > 0.85) {
            await this.delay(secondRemaining + 50);
        } else {
            await this.delay(this.adaptiveDelay * 1.5);
        }
    }

    async executeRequest(request) {
        for (let attempt = 0; attempt <= BINANCE_RATE_LIMIT.retryConfig.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delayTime = Math.min(
                        BINANCE_RATE_LIMIT.retryConfig.maxDelay,
                        BINANCE_RATE_LIMIT.retryConfig.initialDelay *
                        Math.pow(BINANCE_RATE_LIMIT.retryConfig.backoffFactor, attempt - 1)
                    );
                    await this.delay(delayTime);
                }

                this.updateCounters(request.weight);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const response = await fetch(request.url, {
                    ...request.options,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json();

            } catch (error) {
                if (attempt === BINANCE_RATE_LIMIT.retryConfig.maxRetries) {
                    throw error;
                }
            }
        }
    }

    updateCounters(weight) {
        const now = Date.now();

        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }

        this.minuteWindow.usedWeight += weight;
        this.secondWindow.usedWeight += weight;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logStatus() {
        const minuteUsage = (this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute * 100).toFixed(1);
        const secondUsage = (this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond * 100).toFixed(1);

        console.log(`📊 Rate Limit: ${minuteUsage}% minuto | ${secondUsage}% segundo | Delay: ${this.adaptiveDelay}ms`);
    }
}

// =====================================================================
// 📊 FUNÇÕES AUXILIARES
// =====================================================================

function logToFile(message) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        const logFile = path.join(LOG_DIR, `bot_${new Date().toISOString().split('T')[0]}.log`);
        const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const logMessage = `[${timestamp}] ${message}\n`;

        fs.appendFileSync(logFile, logMessage, 'utf8');

    } catch (error) {
        console.error('❌ Erro ao escrever no log:', error.message);
    }
}

function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);

    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

    return { date, time, full: `${date} ${time}` };
}

// =====================================================================
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS TELEGRAM COM FORMATO SIMPLES
// =====================================================================

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        // Remover qualquer formatação problemática
        const cleanMessage = message
            .replace(/\*/g, '')  // Remove asteriscos
            .replace(/_/g, '')   // Remove underscores
            .replace(/`/g, '')   // Remove backticks
            .replace(/\[/g, '(') // Substitui colchetes
            .replace(/\]/g, ')') // por parênteses
            .trim();

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: cleanMessage,
                parse_mode: 'Markdown',  // Usar Markdown em vez de null
                disable_web_page_preview: true,
                disable_notification: false
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ HTTP ${response.status}: ${errorText}`);
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log('✅ Mensagem enviada para Telegram com sucesso!');
        logToFile(`📤 Alerta REAL enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA VERIFICAR CONFIRMAÇÃO DE VOLUME
// =====================================================================

function checkVolumeConfirmation(volumeData) {
    if (!volumeData) {
        return false;
    }

    const combinedScore = volumeData.combinedScore || 0;
    const classification = volumeData.classification || '';
    const emaRatio = volumeData.emaRatio || 0;
    const zScore = volumeData.zScore || 0;

    const isConfirmed = 
        combinedScore >= VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore &&
        emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio &&
        Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

// =====================================================================
// 🔍 FUNÇÃO PARA DETERMINAR TIPO DE ANÁLISE
// =====================================================================

function determineAnalysisType(signal) {
    const btcCorrelation = signal.marketData.btcCorrelation?.relativePerformance || 0;
    const momentum = signal.marketData.momentum;
    const volumeScore = signal.marketData.volume?.robustData?.combinedScore || 0;
    const rsiValue = signal.marketData.rsi?.value || 50;
    
    // PRIORIDADE 1: BTC CORRELATION
    if (btcCorrelation >= 0.8) {
        return {
            type: 'BTC ALTA PERFORMANCE',
            reason: 'Altcoin liderando vs BTC',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🚀'
        };
    }
    
    if (btcCorrelation <= -0.5 && !signal.isBullish) {
        return {
            type: 'BTC PERFORMANDO MELHOR',
            reason: 'Altcoin fraca vs BTC (bom para venda)',
            direction: 'VENDA',
            emoji: '📉'
        };
    }
    
    // PRIORIDADE 2: MOMENTUM
    if (momentum?.isSpiking && Math.abs(momentum.priceChange) > 0.8) {
        return {
            type: 'MOMENTUM RÁPIDO',
            reason: 'Movimento forte detectado',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '⚡'
        };
    }
    
    // PRIORIDADE 3: VOLUME + BTC
    if (volumeScore >= 0.6 && btcCorrelation > 0.3) {
        return {
            type: 'VOLUME + BTC PERFORMANCE',
            reason: 'Volume forte com performance positiva vs BTC',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '📈'
        };
    }
    
    // PRIORIDADE 4: RSI REVERSAL
    if ((signal.isBullish && rsiValue < 35) || (!signal.isBullish && rsiValue > 65)) {
        return {
            type: 'RSI REVERSAL',
            reason: 'RSI em zona de reversão',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🔄'
        };
    }
    
    return {
        type: 'ANÁLISE TÉCNICA',
        reason: 'Sinal técnico padrão',
        direction: signal.isBullish ? 'COMPRA' : 'VENDA',
        emoji: '📊'
    };
}

// =====================================================================
// ⚡ FUNÇÃO PARA DETECTAR MOMENTUM RÁPIDO
// =====================================================================

async function detectMomentumSpike(symbol, timeframe = '1m') {
    try {
        const cacheKey = `${symbol}_${timeframe}_momentum`;
        const now = Date.now();
        
        if (momentumCache[cacheKey] && now - momentumCache[cacheKey].timestamp < MOMENTUM_CACHE_TTL) {
            return momentumCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, timeframe, 8);
        if (candles.length < 4) return null;
        
        const recentCloses = candles.slice(-4).map(c => c.close);
        const recentVolumes = candles.slice(-4).map(c => c.volume);
        
        const priceChanges = [];
        for (let i = 1; i < recentCloses.length; i++) {
            priceChanges.push(((recentCloses[i] - recentCloses[i-1]) / recentCloses[i-1]) * 100);
        }
        
        const volumeChanges = [];
        for (let i = 1; i < recentVolumes.length; i++) {
            volumeChanges.push(((recentVolumes[i] - recentVolumes[i-1]) / recentVolumes[i-1]) * 100);
        }
        
        const avgPriceChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
        const avgVolumeChange = volumeChanges.reduce((a, b) => a + b, 0) / volumeChanges.length;
        
        const isSpiking = Math.abs(avgPriceChange) > 0.4 && avgVolumeChange > 25;
        
        const result = {
            isSpiking,
            priceChange: avgPriceChange,
            volumeChange: avgVolumeChange,
            timeframe,
            timestamp: now
        };
        
        momentumCache[cacheKey] = { data: result, timestamp: now };
        return result;
        
    } catch (error) {
        console.error(`❌ Erro detectando momentum ${symbol}:`, error.message);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA ANALISAR PERFORMANCE VS BTC (MULTI-TIMEFRAME)
// =====================================================================

async function analyzeBTCCorrelation(symbol, currentPrice, isBullish) {
    try {
        if (!symbol.endsWith('BTC')) {
            return { 
                relativePerformance: 0,
                isOutperforming: false,
                performanceLevel: 'NOT_BTC_PAIR'
            };
        }

        // ANÁLISE MULTI-TIMEFRAME
        const timeframes = ['3m', '5m', '10m'];
        const analyses = [];
        
        for (const tf of timeframes) {
            const altcoinCandles = await getCandlesCached(symbol, tf, 20);
            const btcCandles = await getCandlesCached('BTCUSDT', tf, 20);
            
            if (altcoinCandles.length >= 10 && btcCandles.length >= 10) {
                const altChange = ((altcoinCandles[altcoinCandles.length - 1].close - altcoinCandles[0].close) / altcoinCandles[0].close) * 100;
                const btcChange = ((btcCandles[btcCandles.length - 1].close - btcCandles[0].close) / btcCandles[0].close) * 100;
                const relativePerf = altChange - btcChange;
                
                analyses.push({
                    timeframe: tf,
                    relativePerformance: relativePerf,
                    altcoinChange: altChange,
                    btcChange: btcChange,
                    weight: tf === '3m' ? 0.5 : tf === '5m' ? 0.3 : 0.2
                });
            }
        }
        
        if (analyses.length === 0) {
            return { 
                relativePerformance: 0,
                altcoinChange: 0,
                btcChange: 0,
                isOutperforming: false,
                performanceLevel: 'INSUFFICIENT_DATA'
            };
        }
        
        // Calcular média ponderada
        let weightedPerf = 0;
        let totalWeight = 0;
        
        analyses.forEach(a => {
            weightedPerf += a.relativePerformance * a.weight;
            totalWeight += a.weight;
        });
        
        const finalRelativePerf = weightedPerf / totalWeight;
        
        // ANÁLISE DE MOMENTUM ULTRA-RÁPIDO
        const ultraFastCandles = await getCandlesCached(symbol, '1m', 3);
        const ultraFastBTC = await getCandlesCached('BTCUSDT', '1m', 3);
        
        let ultraFastPerf = 0;
        if (ultraFastCandles.length >= 2 && ultraFastBTC.length >= 2) {
            const altUltra = ((ultraFastCandles[ultraFastCandles.length - 1].close - ultraFastCandles[ultraFastCandles.length - 2].close) / 
                             ultraFastCandles[ultraFastCandles.length - 2].close) * 100;
            const btcUltra = ((ultraFastBTC[ultraFastBTC.length - 1].close - ultraFastBTC[ultraFastBTC.length - 2].close) / 
                            ultraFastBTC[ultraFastBTC.length - 2].close) * 100;
            ultraFastPerf = altUltra - btcUltra;
        }
        
        // COMBINAR ANÁLISES
        const combinedPerformance = (finalRelativePerf * 0.7) + (ultraFastPerf * 0.3);
        
        // DETECTAR TENDÊNCIA
        let trend = 'NEUTRAL';
        if (analyses.length >= 2) {
            const shortTerm = analyses.find(a => a.timeframe === '3m')?.relativePerformance || 0;
            const mediumTerm = analyses.find(a => a.timeframe === '5m')?.relativePerformance || 0;
            
            if (shortTerm > mediumTerm && shortTerm > 0) {
                trend = 'ACCELERATING';
            } else if (shortTerm < mediumTerm && shortTerm < 0) {
                trend = 'DECELERATING';
            }
        }
        
        // DETERMINAR NÍVEL DE PERFORMANCE
        let performanceLevel = 'NEUTRAL';
        if (combinedPerformance >= BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance) {
            performanceLevel = 'STRONG_OUTPERFORMANCE';
        } else if (combinedPerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            performanceLevel = 'MODERATE_OUTPERFORMANCE';
        } else if (combinedPerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            performanceLevel = 'STRONG_UNDERPERFORMANCE';
        } else if (combinedPerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            performanceLevel = 'MODERATE_UNDERPERFORMANCE';
        }

        console.log(`📊 BTC Correlation ${symbol}:`);
        console.log(`   Performance: ${combinedPerformance.toFixed(2)}% (${performanceLevel})`);
        console.log(`   Trend: ${trend}`);
        console.log(`   Ultra-fast: ${ultraFastPerf.toFixed(2)}%`);

        return {
            relativePerformance: combinedPerformance,
            performanceLevel: performanceLevel,
            trend: trend,
            ultraFastPerformance: ultraFastPerf,
            multiTimeframeAnalysis: analyses,
            isOutperforming: combinedPerformance > 0.2,
            signalStrength: Math.abs(combinedPerformance) > 0.6 ? 'STRONG' : 
                          Math.abs(combinedPerformance) > 0.3 ? 'MODERATE' : 'WEAK',
            analysis: getBTCCorrelationAnalysis(combinedPerformance, performanceLevel, trend)
        };

    } catch (error) {
        console.log(`⚠️ Erro análise BTC correlation ${symbol}: ${error.message}`);
        return { 
            relativePerformance: 0,
            altcoinChange: 0,
            btcChange: 0,
            isOutperforming: false,
            performanceLevel: 'ERROR',
            error: error.message
        };
    }
}

function getBTCCorrelationAnalysis(relativePerformance, performanceLevel, trend) {
    const analysis = [];
    
    switch (performanceLevel) {
        case 'STRONG_OUTPERFORMANCE':
            analysis.push(`🚀🚀 ALTA PERFORMANCE RELATIVA vs BTC`);
            analysis.push(`✅ Altcoin liderando fortemente`);
            analysis.push(`📈 Tendência de alta muito forte`);
            break;
        case 'MODERATE_OUTPERFORMANCE':
            analysis.push(`📈 Performando melhor que BTC`);
            analysis.push(`✅ Momento positivo`);
            analysis.push(`🔍 Bom potencial`);
            break;
        case 'MODERATE_UNDERPERFORMANCE':
            analysis.push(`⚠️ Performando pior que BTC`);
            analysis.push(`🔻 Fraqueza relativa`);
            analysis.push(`📉 Cautela necessária`);
            break;
        case 'STRONG_UNDERPERFORMANCE':
            analysis.push(`🚨 FORTE FRAQUEZA vs BTC`);
            analysis.push(`❌ Altcoin muito fraca`);
            analysis.push(`📉 Risco elevado`);
            break;
        default:
            analysis.push(`➡️ Performance similar ao BTC`);
            analysis.push(`⚖️ Movendo-se com o mercado`);
    }
    
    if (trend === 'ACCELERATING') {
        analysis.push(`📈 Acelerando vs BTC`);
    } else if (trend === 'DECELERATING') {
        analysis.push(`📉 Desacelerando vs BTC`);
    }
    
    analysis.push(`Performance: ${relativePerformance.toFixed(2)}%`);
    
    return analysis;
}

// =====================================================================
// 🔍 FUNÇÃO PARA CONFIRMAR ALINHAMENTO COM TENDÊNCIA BTC
// =====================================================================

async function confirmBTCTrendAlignment(symbol, isBullishSignal) {
    try {
        const btcCandles = await getCandlesCached('BTCUSDT', '15m', 10);
        const altCandles = await getCandlesCached(symbol, '15m', 10);
        
        if (btcCandles.length < 6 || altCandles.length < 6) return 0;
        
        // Calcular tendência BTC
        const btcCloses = btcCandles.map(c => c.close);
        const btcTrend = btcCloses[btcCloses.length - 1] > btcCloses[0] ? 'BULLISH' : 'BEARISH';
        
        // Calcular tendência altcoin
        const altCloses = altCandles.map(c => c.close);
        const altTrend = altCloses[altCloses.length - 1] > altCloses[0] ? 'BULLISH' : 'BEARISH';
        
        let alignmentScore = 0;
        
        // Mesma direção
        if (btcTrend === altTrend) {
            alignmentScore += 0.4;
        }
        
        // Forte correlação positiva (seguindo BTC)
        const correlation = await calculateDirectionalCorrelation(btcCloses, altCloses);
        if (correlation > 0.8) {
            alignmentScore += 0.3;
        }
        
        // Correlação negativa para vendas (indo contra BTC pode ser bom para venda)
        if (!isBullishSignal && correlation < -0.7) {
            alignmentScore += 0.2;
        }
        
        // Divergência perigosa
        if ((isBullishSignal && btcTrend === 'BEARISH' && altTrend === 'BULLISH') ||
            (!isBullishSignal && btcTrend === 'BULLISH' && altTrend === 'BEARISH')) {
            alignmentScore -= 0.5;
        }
        
        return Math.max(0, alignmentScore);
        
    } catch (error) {
        return 0;
    }
}

async function calculateDirectionalCorrelation(btcPrices, altPrices) {
    const minLength = Math.min(btcPrices.length, altPrices.length);
    if (minLength < 4) return 0;
    
    const btcReturns = [];
    const altReturns = [];
    
    for (let i = 1; i < minLength; i++) {
        btcReturns.push(btcPrices[i] > btcPrices[i-1] ? 1 : -1);
        altReturns.push(altPrices[i] > altPrices[i-1] ? 1 : -1);
    }
    
    // Correlação de Pearson simplificada
    let sumProduct = 0;
    let sumBtcSq = 0;
    let sumAltSq = 0;
    
    for (let i = 0; i < btcReturns.length; i++) {
        sumProduct += btcReturns[i] * altReturns[i];
        sumBtcSq += btcReturns[i] * btcReturns[i];
        sumAltSq += altReturns[i] * altReturns[i];
    }
    
    const correlation = sumProduct / (Math.sqrt(sumBtcSq) * Math.sqrt(sumAltSq));
    return isNaN(correlation) ? 0 : correlation;
}

// =====================================================================
// 📊 FUNÇÃO PARA OBTER DADOS DO PAR USDT
// =====================================================================

async function getUSDTData(symbolBTC) {
    try {
        // Converte símbolo BTC para USDT (ex: ETHBTC -> ETHUSDT)
        const baseSymbol = symbolBTC.replace('BTC', '');
        const symbolUSDT = baseSymbol + 'USDT';
        
        // Busca candles para USDT
        const candles = await getCandlesCached(symbolUSDT, '15m', 40);
        if (candles.length < 20) {
            return {
                symbol: symbolUSDT,
                price: 0,
                rsi: 0,
                supports: [],
                resistances: [],
                error: 'Dados insuficientes'
            };
        }
        
        const currentPrice = candles[candles.length - 1].close;
        
        // Calcula RSI para USDT
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        const rsi = rsiValues ? rsiValues[rsiValues.length - 1] : 50;
        
        // Analisa suportes e resistências para USDT
        const supports = [];
        const resistances = [];
        
        // Encontra suportes (mínimos locais)
        const window = 5;
        for (let i = window; i < candles.length - window; i++) {
            const currentLow = candles[i].low;
            let isSupport = true;
            
            for (let j = i - window; j <= i + window; j++) {
                if (j !== i && candles[j].low < currentLow) {
                    isSupport = false;
                    break;
                }
            }
            
            if (isSupport) {
                supports.push({
                    price: currentLow,
                    strength: 'weak',
                    index: i
                });
            }
        }
        
        // Encontra resistências (máximos locais)
        for (let i = window; i < candles.length - window; i++) {
            const currentHigh = candles[i].high;
            let isResistance = true;
            
            for (let j = i - window; j <= i + window; j++) {
                if (j !== i && candles[j].high > currentHigh) {
                    isResistance = false;
                    break;
                }
            }
            
            if (isResistance) {
                resistances.push({
                    price: currentHigh,
                    strength: 'weak',
                    index: i
                });
            }
        }
        
        // Ordena e filtra os níveis mais próximos
        supports.sort((a, b) => b.price - a.price);
        resistances.sort((a, b) => a.price - b.price);
        
        // Pega os 2 suportes mais próximos acima do preço atual
        const nearestSupports = supports
            .filter(s => s.price < currentPrice)
            .slice(0, 2);
        
        // Pega as 2 resistências mais próximas abaixo do preço atual
        const nearestResistances = resistances
            .filter(r => r.price > currentPrice)
            .slice(0, 2);
        
        // Dica baseada na posição do preço
        let tip = '';
        if (nearestSupports.length > 0 && nearestResistances.length > 0) {
            const distanceToSupport = Math.abs(currentPrice - nearestSupports[0].price);
            const distanceToResistance = Math.abs(nearestResistances[0].price - currentPrice);
            
            if (distanceToSupport < distanceToResistance * 0.5) {
                tip = 'Entrada de Compra perto do suporte';
            } else if (distanceToResistance < distanceToSupport * 0.5) {
                tip = 'Entrada de Venda perto da resistência';
            } else {
                tip = 'Posição intermediária, aguardar melhor oportunidade';
            }
        }
        
        return {
            symbol: symbolUSDT,
            price: currentPrice,
            rsi: rsi,
            supports: nearestSupports,
            resistances: nearestResistances,
            tip: tip
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao obter dados USDT para ${symbolBTC}: ${error.message}`);
        return {
            symbol: symbolBTC.replace('BTC', '') + 'USDT',
            price: 0,
            rsi: 0,
            supports: [],
            resistances: [],
            error: error.message,
            tip: 'Erro ao obter dados USDT'
        };
    }
}

// =====================================================================
// 📤 FUNÇÃO PRINCIPAL PARA ENVIAR ALERTAS - VERSÃO CORRIGIDA COM USDT
// =====================================================================

async function sendSignalAlert(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        const analysisType = determineAnalysisType(signal);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const priority = determineAlertPriority(signal);
        let priorityEmoji = '';
        if (priority === 'HIGH') {
            priorityEmoji = '🚨 ';
        } else if (priority === 'MEDIUM') {
            priorityEmoji = '⚠️ ';
        }

        let alertTitle = '';
        if (isVolumeConfirmed) {
            alertTitle = `${priorityEmoji}${directionEmoji} ${signal.symbol} - ${direction}`;
        } else {
            alertTitle = `${analysisType.emoji} ${signal.symbol} - ${analysisType.type}`;
        }

        const now = getBrazilianDateTime();
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';

        const btcCorrelationData = signal.marketData.btcCorrelation;
        const relativePerformance = btcCorrelationData?.relativePerformance || 0;
        const performanceLevel = btcCorrelationData?.performanceLevel || 'NEUTRAL';
        
        let btcPerformanceEmoji = '➡️';
        let btcPerformanceText = '';
        
        if (performanceLevel === 'STRONG_OUTPERFORMANCE') {
            btcPerformanceEmoji = '🚀';
            btcPerformanceText = `LIDERANDO vs BTC: +${relativePerformance.toFixed(2)}%`;
        } else if (performanceLevel === 'MODERATE_OUTPERFORMANCE') {
            btcPerformanceEmoji = '📈';
            btcPerformanceText = `Melhor que BTC: +${relativePerformance.toFixed(2)}%`;
        } else if (performanceLevel === 'STRONG_UNDERPERFORMANCE') {
            btcPerformanceEmoji = '📉📉';
            btcPerformanceText = `FRAQUEZA vs BTC: ${relativePerformance.toFixed(2)}%`;
        } else if (performanceLevel === 'MODERATE_UNDERPERFORMANCE') {
            btcPerformanceEmoji = '📉';
            btcPerformanceText = `Pior que BTC: ${relativePerformance.toFixed(2)}%`;
        } else {
            btcPerformanceText = `Similar ao BTC: ${relativePerformance.toFixed(2)}%`;
        }

        const momentumData = signal.marketData.momentum;
        let momentumText = '';
        if (momentumData?.isSpiking) {
            momentumText = ` | ⚡ ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
        }

        // OBTER DADOS DO PAR USDT
        const usdtData = await getUSDTData(signal.symbol);
        
        // Formatar suportes e resistências USDT
        let supportsText = 'N/A';
        let resistancesText = 'N/A';
        
        if (usdtData.supports && usdtData.supports.length > 0) {
            supportsText = usdtData.supports.map(s => s.price.toFixed(8)).join(' / ');
        }
        
        if (usdtData.resistances && usdtData.resistances.length > 0) {
            resistancesText = usdtData.resistances.map(r => r.price.toFixed(8)).join(' / ');
        }

        // CONSTRUIR MENSAGEM COM FORMATAÇÃO SIMPLES
        let message = `
${alertTitle}
${now.date} ${now.time}

${analysisType.reason}
${btcPerformanceEmoji} ${btcPerformanceText}${momentumText}
Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
Probabilidade: ${baseProbability.toFixed(1)}%
Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})
Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
Dist. S/R: ${distancePercent}%
Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
-------------------------------
${usdtData.symbol} - Preço: ${usdtData.price.toFixed(8)}
RSI: ${usdtData.rsi.toFixed(1)}
Suporte 1: ${supportsText}
Resistência 1: ${resistancesText}
Dica: ${usdtData.tip}

Titanium Pares BTC by @J4Rviz
`;

        // Enviar mensagem
        await sendTelegramAlert(message);

        console.log(`📤 ${isVolumeConfirmed ? 'Alerta de TRADE' : 'Análise'} enviado: ${signal.symbol}`);
        console.log(`   Tipo: ${analysisType.type}`);
        console.log(`   BTC Performance: ${relativePerformance.toFixed(2)}%`);
        console.log(`   Score: ${signal.qualityScore.score}/100`);
        console.log(`   USDT Price: ${usdtData.price.toFixed(8)}`);

    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

function determineAlertPriority(signal) {
    const btcData = signal.marketData.btcCorrelation;
    const momentumData = signal.marketData.momentum;
    const volumeData = signal.marketData.volume?.robustData;
    
    // HIGH PRIORITY
    if (btcData?.performanceLevel === 'STRONG_OUTPERFORMANCE' && 
        momentumData?.isSpiking && 
        Math.abs(momentumData.priceChange) > 0.8 &&
        volumeData?.combinedScore >= 0.6) {
        return 'HIGH';
    }
    
    // MEDIUM PRIORITY
    if ((btcData?.performanceLevel === 'STRONG_OUTPERFORMANCE' || 
         btcData?.performanceLevel === 'MODERATE_OUTPERFORMANCE') &&
        volumeData?.combinedScore >= 0.4) {
        return 'MEDIUM';
    }
    
    return 'LOW';
}

function calculateProbability(signal) {
    let baseProbability = 65;

    baseProbability += (signal.qualityScore.score - 60) * 0.5;

    const volumeData = signal.marketData.volume?.robustData;
    const volumeScore = volumeData?.combinedScore || 0;
    
    if (volumeScore >= 0.7) baseProbability += 12;
    else if (volumeScore >= 0.5) baseProbability += 6;
    else if (volumeScore < 0.3) baseProbability -= 10;

    const srData = signal.marketData.supportResistance;
    const nearestLevel = signal.isBullish ?
        srData?.nearestResistance : srData?.nearestSupport;
    const distance = nearestLevel?.distancePercent || 0;

    if (distance >= 2.5) baseProbability += 8;
    else if (distance >= 1.5) baseProbability += 4;
    else if (distance < 0.6) baseProbability -= 18;

    if (signal.marketData.breakoutRisk?.level === 'high') baseProbability -= 15;
    if (signal.marketData.breakoutRisk?.level === 'low') baseProbability += 6;

    const rsiValue = signal.marketData.rsi?.value || 50;
    if ((signal.isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) ||
        (!signal.isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
        baseProbability += 10;
    }

    const pivotData = signal.marketData.pivotPoints;
    if (pivotData?.nearestPivot) {
        const pivotDistance = pivotData.nearestPivot.distancePercent || 0;
        const pivotStrength = pivotData.nearestPivot.strength || 'unknown';
        
        const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
        
        if (pivotDistance < safeDistance * 0.4) {
            baseProbability -= 18;
        } else if (pivotDistance < safeDistance) {
            baseProbability -= 10;
        } else if (pivotDistance > safeDistance * 1.5) {
            baseProbability += 6;
        }
        
        if (pivotData.nearestPivot.isTesting) {
            baseProbability -= 15;
        }
    }

    const btcCorrelationData = signal.marketData.btcCorrelation;
    if (btcCorrelationData) {
        const relativePerformance = btcCorrelationData.relativePerformance || 0;
        const performanceLevel = btcCorrelationData.performanceLevel || 'NEUTRAL';
        
        if (performanceLevel === 'STRONG_OUTPERFORMANCE') {
            baseProbability += signal.isBullish ? 15 : 5;
        } else if (performanceLevel === 'MODERATE_OUTPERFORMANCE') {
            baseProbability += signal.isBullish ? 8 : 3;
        } else if (performanceLevel === 'STRONG_UNDERPERFORMANCE') {
            baseProbability += !signal.isBullish ? 15 : -18;
        } else if (performanceLevel === 'MODERATE_UNDERPERFORMANCE') {
            baseProbability += !signal.isBullish ? 8 : -10;
        }
        
        if (btcCorrelationData.trend === 'ACCELERATING' && signal.isBullish) {
            baseProbability += 6;
        } else if (btcCorrelationData.trend === 'DECELERATING' && !signal.isBullish) {
            baseProbability += 6;
        }
    }

    const momentumData = signal.marketData.momentum;
    if (momentumData?.isSpiking) {
        if (Math.abs(momentumData.priceChange) > 1.0) {
            baseProbability += 10;
        } else if (Math.abs(momentumData.priceChange) > 0.5) {
            baseProbability += 5;
        }
    }

    return Math.min(95, Math.max(30, Math.round(baseProbability)));
}

// =====================================================================
// 📊 FUNÇÃO DE DETECÇÃO DE VOLUME ROBUSTA 3 MINUTOS
// =====================================================================

async function checkVolumeRobust(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', VOLUME_ROBUST_SETTINGS.maxZScoreLookback);
        if (candles.length < VOLUME_ROBUST_SETTINGS.emaPeriod) {
            return {
                rawRatio: 0,
                isAbnormal: false,
                robustData: null
            };
        }

        const volumes = candles.map(c => c.volume);
        const closes = candles.map(c => c.close);
        
        const currentVolume = volumes[volumes.length - 1];
        const previousVolume = volumes[volumes.length - 2] || currentVolume;
        
        const emaData = calculateVolumeEMA(volumes, VOLUME_ROBUST_SETTINGS.emaPeriod, VOLUME_ROBUST_SETTINGS.emaAlpha);
        const emaRatio = currentVolume / emaData.currentEMA;
        const emaScore = calculateEMAScore(emaRatio);
        
        const adaptiveLookback = calculateAdaptiveZScoreLookback(closes);
        const zScoreData = calculateVolumeZScore(volumes, adaptiveLookback);
        const zScore = zScoreData.currentZScore;
        const zScoreScore = calculateZScoreScore(zScore);
        
        const vptData = calculateVolumePriceTrend(volumes, closes);
        const vptScore = calculateVPTScore(vptData);
        
        const combinedScore = calculateCombinedVolumeScore({
            emaScore,
            zScoreScore,
            vptScore,
            emaRatio,
            zScore
        });
        
        const classification = classifyVolumeStrength(combinedScore);
        
        const isVolumeConfirmed = checkVolumeRobustConfirmation({
            combinedScore,
            classification,
            emaRatio,
            zScore
        });
        
        const rawRatio = currentVolume / emaData.averageVolume || 1;
        
        const robustData = {
            currentVolume,
            previousVolume,
            ema: emaData.currentEMA,
            emaRatio,
            zScore,
            vpt: vptData,
            emaScore,
            zScoreScore,
            vptScore,
            combinedScore,
            classification,
            isVolumeConfirmed,
            rawRatio,
            details: {
                volumeChange: ((currentVolume - previousVolume) / previousVolume * 100).toFixed(2) + '%',
                emaPeriod: VOLUME_ROBUST_SETTINGS.emaPeriod,
                emaAlpha: VOLUME_ROBUST_SETTINGS.emaAlpha,
                zScoreLookback: adaptiveLookback,
                isEMAValid: emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio,
                isZScoreValid: Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore,
                isVPTValid: vptData.priceMovementPercent >= VOLUME_ROBUST_SETTINGS.vptThreshold
            }
        };
        
        console.log(`📊 Volume Robust ${symbol} (3m):`);
        console.log(`   Volume: ${currentVolume.toFixed(2)} (${robustData.details.volumeChange})`);
        console.log(`   EMA: ${emaData.currentEMA.toFixed(2)} (${emaRatio.toFixed(2)}x)`);
        console.log(`   Z-Score: ${zScore.toFixed(2)}`);
        console.log(`   Score: ${combinedScore.toFixed(2)} (${classification})`);
        
        return {
            rawRatio,
            isAbnormal: combinedScore >= 0.5 || Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.zScoreThreshold,
            robustData
        };
        
    } catch (error) {
        console.error(`❌ Erro na análise robusta de volume para ${symbol}:`, error.message);
        return {
            rawRatio: 0,
            isAbnormal: false,
            robustData: null
        };
    }
}

function checkVolumeRobustConfirmation(volumeData) {
    const {
        combinedScore,
        classification,
        emaRatio,
        zScore
    } = volumeData;
    
    return (
        combinedScore >= VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore &&
        emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio &&
        Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore &&
        !classification.includes('BAIXO') &&
        !classification.includes('INSUFICIENTE')
    );
}

function calculateVolumeEMA(volumes, period, alpha) {
    if (volumes.length < period) {
        return {
            currentEMA: volumes[volumes.length - 1] || 0,
            averageVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length || 0,
            emaHistory: []
        };
    }
    
    const initialSMA = volumes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = initialSMA;
    const emaHistory = [ema];
    
    for (let i = period; i < volumes.length; i++) {
        ema = alpha * volumes[i] + (1 - alpha) * ema;
        emaHistory.push(ema);
    }
    
    const averageVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    
    return {
        currentEMA: ema,
        averageVolume: averageVolume,
        minEMA: Math.min(...emaHistory),
        maxEMA: Math.max(...emaHistory),
        emaTrend: ema > emaHistory[emaHistory.length - 2] ? 'rising' : 'falling',
        emaHistory: emaHistory
    };
}

function calculateAdaptiveZScoreLookback(closes) {
    if (closes.length < 8) {
        return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
    }
    
    const recentCloses = closes.slice(-15);
    let sumReturns = 0;
    for (let i = 1; i < recentCloses.length; i++) {
        const returnVal = Math.abs((recentCloses[i] - recentCloses[i-1]) / recentCloses[i-1]);
        sumReturns += returnVal;
    }
    const volatility = sumReturns / (recentCloses.length - 1) * 100;
    
    if (volatility > 2.5) {
        return Math.max(VOLUME_ROBUST_SETTINGS.minZScoreLookback, 
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 0.4);
    } else if (volatility < 0.4) {
        return Math.min(VOLUME_ROBUST_SETTINGS.maxZScoreLookback,
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 1.3);
    }
    
    return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
}

function calculateVolumeZScore(volumes, lookback) {
    if (volumes.length < lookback) {
        return {
            currentZScore: 0,
            mean: volumes[0] || 0,
            stdDev: 0
        };
    }
    
    const recentVolumes = volumes.slice(-lookback);
    const mean = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    
    const squaredDifferences = recentVolumes.map(v => Math.pow(v - mean, 2));
    const variance = squaredDifferences.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const stdDev = Math.sqrt(variance);
    
    const currentVolume = volumes[volumes.length - 1];
    const zScore = stdDev !== 0 ? (currentVolume - mean) / stdDev : 0;
    
    return {
        currentZScore: zScore,
        mean: mean,
        stdDev: stdDev,
        lookbackUsed: lookback,
        isOutlier: Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.zScoreThreshold
    };
}

function calculateVolumePriceTrend(volumes, closes) {
    if (volumes.length < 4 || closes.length < 4) {
        return {
            priceMovementPercent: 0,
            volumeTrend: 'neutral',
            trendDirection: 'neutral',
            correlation: 0
        };
    }
    
    const recentCloses = closes.slice(-4);
    const priceChange = ((recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0]) * 100;
    
    const recentVolumes = volumes.slice(-4);
    const volumeSum = recentVolumes.reduce((a, b) => a + b, 0);
    const avgVolume = volumeSum / recentVolumes.length;
    
    const hasSignificantMovement = Math.abs(priceChange) >= VOLUME_ROBUST_SETTINGS.minPriceMovement;
    
    let trendDirection = 'neutral';
    if (priceChange > VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bullish';
    } else if (priceChange < -VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bearish';
    }
    
    let correlation = 0;
    if (hasSignificantMovement) {
        const volumeChanges = [];
        const priceChanges = [];
        
        for (let i = 1; i < recentVolumes.length; i++) {
            volumeChanges.push(recentVolumes[i] - recentVolumes[i - 1]);
            priceChanges.push(recentCloses[i] - recentCloses[i - 1]);
        }
        
        const avgVolumeChange = volumeChanges.reduce((a, b) => a + b, 0) / volumeChanges.length;
        const avgPriceChange = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length;
        
        let numerator = 0;
        let denomVolume = 0;
        let denomPrice = 0;
        
        for (let i = 0; i < volumeChanges.length; i++) {
            numerator += (volumeChanges[i] - avgVolumeChange) * (priceChanges[i] - avgPriceChange);
            denomVolume += Math.pow(volumeChanges[i] - avgVolumeChange, 2);
            denomPrice += Math.pow(priceChanges[i] - avgPriceChange, 2);
        }
        
        correlation = numerator / Math.sqrt(denomVolume * denomPrice);
    }
    
    return {
        priceMovementPercent: priceChange,
        volumeTrend: recentVolumes[recentVolumes.length - 1] > avgVolume ? 'rising' : 'falling',
        trendDirection: trendDirection,
        correlation: isNaN(correlation) ? 0 : correlation,
        hasSignificantMovement: hasSignificantMovement
    };
}

function calculateEMAScore(emaRatio) {
    if (emaRatio >= 3.0) return 1.0;
    if (emaRatio >= 2.5) return 0.9;
    if (emaRatio >= 2.0) return 0.8;
    if (emaRatio >= 1.8) return 0.7;
    if (emaRatio >= 1.5) return 0.6;
    if (emaRatio >= 1.2) return 0.4;
    if (emaRatio >= 1.0) return 0.2;
    return 0.0;
}

function calculateZScoreScore(zScore) {
    const absZScore = Math.abs(zScore);
    if (absZScore >= 3.0) return 1.0;
    if (absZScore >= 2.5) return 0.9;
    if (absZScore >= 2.0) return 0.8;
    if (absZScore >= 1.5) return 0.6;
    if (absZScore >= 1.0) return 0.4;
    if (absZScore >= 0.5) return 0.2;
    return 0.0;
}

function calculateVPTScore(vptData) {
    let score = 0;
    
    const absPriceMovement = Math.abs(vptData.priceMovementPercent);
    if (absPriceMovement >= 1.0) score += 0.4;
    else if (absPriceMovement >= 0.5) score += 0.3;
    else if (absPriceMovement >= VOLUME_ROBUST_SETTINGS.minPriceMovement) score += 0.2;
    
    if (Math.abs(vptData.correlation) >= 0.7) score += 0.3;
    else if (Math.abs(vptData.correlation) >= 0.5) score += 0.2;
    else if (Math.abs(vptData.correlation) >= 0.3) score += 0.1;
    
    if (vptData.hasSignificantMovement && vptData.volumeTrend === 'rising') {
        score += 0.3;
    }
    
    return Math.min(1.0, score);
}

function calculateCombinedVolumeScore(data) {
    const {
        emaScore,
        zScoreScore,
        vptScore,
        emaRatio,
        zScore
    } = data;
    
    const weights = VOLUME_ROBUST_SETTINGS;
    
    let combinedScore = 
        (emaScore * weights.emaWeight) +
        (zScoreScore * weights.zScoreWeight) +
        (vptScore * weights.vptWeight);
    
    if (emaRatio >= 2.5 && Math.abs(zScore) >= 2.5) {
        combinedScore *= weights.combinedMultiplier;
    }
    
    return Math.min(1.0, combinedScore);
}

function classifyVolumeStrength(score) {
    if (score >= 0.8) return '🔥 MUITO FORTE';
    if (score >= 0.7) return '📈 FORTE';
    if (score >= 0.6) return '📊 MODERADO-ALTO';
    if (score >= 0.5) return '📊 MODERADO';
    if (score >= 0.4) return '📉 MODERADO-BAIXO';
    if (score >= 0.3) return '📉 BAIXO';
    if (score >= 0.2) return '⚠️ MUITO BAIXO';
    return '🚫 INSUFICIENTE';
}

// =====================================================================
// 📊 FUNÇÕES PARA PONTOS DE PIVÔ MULTI-TIMEFRAME
// =====================================================================

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const allPivots = [];
        
        for (const timeframe of PIVOT_POINTS_SETTINGS.analyzeTimeframes) {
            try {
                const candles = await getCandlesCached(
                    symbol, 
                    timeframe, 
                    PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe] || 50
                );

                if (candles.length < 30) continue;

                const timeframePivots = await analyzePivotPointsInTimeframe(
                    symbol,
                    timeframe,
                    candles,
                    currentPrice
                );
                
                timeframePivots.supports.forEach(pivot => {
                    pivot.timeframe = timeframe;
                    pivot.strength = calculatePivotStrength(pivot, timeframe);
                    allPivots.push(pivot);
                });
                
                timeframePivots.resistances.forEach(pivot => {
                    pivot.timeframe = timeframe;
                    pivot.strength = calculatePivotStrength(pivot, timeframe);
                    allPivots.push(pivot);
                });
                
            } catch (error) {
                console.log(`⚠️ Erro análise pivot ${timeframe} ${symbol}: ${error.message}`);
                continue;
            }
        }

        if (allPivots.length === 0) {
            return { error: 'Nenhum pivot detectado' };
        }

        const supportPivots = allPivots.filter(p => p.type === 'support');
        const resistancePivots = allPivots.filter(p => p.type === 'resistance');

        const nearestSupportPivot = findNearestPivotMultiTimeframe(supportPivots, currentPrice, true);
        const nearestResistancePivot = findNearestPivotMultiTimeframe(resistancePivots, currentPrice, false);

        const testingPivot = checkTestingPivotMultiTimeframe(currentPrice, allPivots);

        const supportDistancePercent = nearestSupportPivot ?
            ((currentPrice - nearestSupportPivot.price) / currentPrice) * 100 : null;
        const resistanceDistancePercent = nearestResistancePivot ?
            ((nearestResistancePivot.price - currentPrice) / currentPrice) * 100 : null;

        let nearestPivot = null;
        if (nearestSupportPivot && nearestResistancePivot) {
            const supportDistance = Math.abs(currentPrice - nearestSupportPivot.price);
            const resistanceDistance = Math.abs(nearestResistancePivot.price - currentPrice);
            
            nearestPivot = supportDistance < resistanceDistance ? 
                { 
                    ...nearestSupportPivot, 
                    distancePercent: supportDistancePercent,
                    timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestSupportPivot.timeframe] || 1.0
                } : 
                { 
                    ...nearestResistancePivot, 
                    distancePercent: resistanceDistancePercent,
                    timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestResistancePivot.timeframe] || 1.0
                };
        } else if (nearestSupportPivot) {
            nearestPivot = { 
                ...nearestSupportPivot, 
                distancePercent: supportDistancePercent,
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestSupportPivot.timeframe] || 1.0
            };
        } else if (nearestResistancePivot) {
            nearestPivot = { 
                ...nearestResistancePivot, 
                distancePercent: resistanceDistancePercent,
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestResistancePivot.timeframe] || 1.0
            };
        }

        return {
            supports: supportPivots,
            resistances: resistancePivots,
            nearestSupport: nearestSupportPivot ? {
                price: nearestSupportPivot.price,
                strength: nearestSupportPivot.strength,
                timeframe: nearestSupportPivot.timeframe,
                distance: currentPrice - nearestSupportPivot.price,
                distancePercent: supportDistancePercent,
                touches: nearestSupportPivot.touches,
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestSupportPivot.timeframe] || 1.0
            } : null,
            nearestResistance: nearestResistancePivot ? {
                price: nearestResistancePivot.price,
                strength: nearestResistancePivot.strength,
                timeframe: nearestResistancePivot.timeframe,
                distance: nearestResistancePivot.price - currentPrice,
                distancePercent: resistanceDistancePercent,
                touches: nearestResistancePivot.touches,
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[nearestResistancePivot.timeframe] || 1.0
            } : null,
            nearestPivot: nearestPivot ? {
                type: nearestPivot.type,
                price: nearestPivot.price,
                strength: nearestPivot.strength,
                timeframe: nearestPivot.timeframe,
                distancePercent: nearestPivot.distancePercent,
                isTesting: testingPivot?.price === nearestPivot.price,
                touches: nearestPivot.touches,
                timeframeStrength: nearestPivot.timeframeStrength,
                safeDistance: PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[nearestPivot.strength] || 1.0
            } : null,
            testingPivot: testingPivot,
            currentPrice: currentPrice,
            totalPivots: allPivots.length,
            timeframeAnalysis: {
                '3m': allPivots.filter(p => p.timeframe === '3m').length,
                '5m': allPivots.filter(p => p.timeframe === '5m').length,
                '15m': allPivots.filter(p => p.timeframe === '15m').length
            }
        };

    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        return { error: error.message };
    }
}

async function analyzePivotPointsInTimeframe(symbol, timeframe, candles, currentPrice) {
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const pivotHighs = findPivotHighs(highs, PIVOT_POINTS_SETTINGS.minDistance);
    const pivotLows = findPivotLows(lows, PIVOT_POINTS_SETTINGS.minDistance);

    const supportPivots = classifyPivots(pivotLows, 'support', candles, timeframe);
    const resistancePivots = classifyPivots(pivotHighs, 'resistance', candles, timeframe);

    return {
        supports: supportPivots,
        resistances: resistancePivots,
        timeframe: timeframe,
        candlesAnalyzed: candles.length
    };
}

function calculatePivotStrength(pivot, timeframe) {
    let baseStrength = 'weak';
    
    if (pivot.touches >= 4) {
        baseStrength = 'very_strong';
    } else if (pivot.touches >= 3) {
        baseStrength = 'strong';
    } else if (pivot.touches >= 2) {
        baseStrength = 'moderate';
    }
    
    const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
    
    if (timeframeWeight >= 3.0 && baseStrength !== 'weak') {
        if (baseStrength === 'moderate') return 'strong';
        if (baseStrength === 'strong') return 'very_strong';
    }
    
    return baseStrength;
}

function findNearestPivotMultiTimeframe(pivots, currentPrice, isSupport) {
    if (pivots.length === 0) return null;
    
    let nearest = null;
    let minDistance = Infinity;
    
    for (const pivot of pivots) {
        const distance = Math.abs(currentPrice - pivot.price);
        
        const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivot.timeframe] || 1.0;
        const adjustedDistance = distance / timeframeWeight;
        
        if (adjustedDistance < minDistance) {
            if ((isSupport && pivot.price < currentPrice) || 
                (!isSupport && pivot.price > currentPrice)) {
                minDistance = adjustedDistance;
                nearest = pivot;
            }
        }
    }
    
    return nearest;
}

function checkTestingPivotMultiTimeframe(currentPrice, allPivots) {
    const tolerance = currentPrice * PIVOT_POINTS_SETTINGS.priceTolerance;
    
    for (const pivot of allPivots) {
        if (Math.abs(currentPrice - pivot.price) <= tolerance) {
            return {
                price: pivot.price,
                type: pivot.type,
                strength: pivot.strength,
                timeframe: pivot.timeframe,
                touches: pivot.touches,
                distance: Math.abs(currentPrice - pivot.price),
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivot.timeframe] || 1.0
            };
        }
    }
    
    return null;
}

function findPivotHighs(highs, minDistance) {
    const pivots = [];
    
    for (let i = minDistance; i < highs.length - minDistance; i++) {
        let isPivot = true;
        
        for (let j = i - minDistance; j <= i + minDistance; j++) {
            if (j !== i && highs[j] > highs[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            pivots.push({
                index: i,
                price: highs[i],
                type: 'resistance'
            });
        }
    }
    
    return pivots;
}

function findPivotLows(lows, minDistance) {
    const pivots = [];
    
    for (let i = minDistance; i < lows.length - minDistance; i++) {
        let isPivot = true;
        
        for (let j = i - minDistance; j <= i + minDistance; j++) {
            if (j !== i && lows[j] < lows[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            pivots.push({
                index: i,
                price: lows[i],
                type: 'support'
            });
        }
    }
    
    return pivots;
}

function classifyPivots(pivots, type, candles, timeframe) {
    const classified = [];
    
    for (const pivot of pivots) {
        let touches = 1;
        for (let i = pivot.index + 1; i < candles.length; i++) {
            const candle = candles[i];
            const priceRange = pivot.price * PIVOT_POINTS_SETTINGS.priceTolerance;
            
            if ((type === 'support' && candle.low <= pivot.price + priceRange && candle.low >= pivot.price - priceRange) ||
                (type === 'resistance' && candle.high <= pivot.price + priceRange && candle.high >= pivot.price - priceRange)) {
                touches++;
            }
        }
        
        classified.push({
            price: pivot.price,
            type: type,
            touches: touches,
            index: pivot.index,
            timeframe: timeframe
        });
    }
    
    return classified;
}

// =====================================================================
// 📊 FUNÇÃO PARA DETECTAR SUPORTES E RESISTÊNCIAS
// =====================================================================

async function analyzeSupportResistance(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, SUPPORT_RESISTANCE_SETTINGS.timeframe,
            SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod + 15);

        if (candles.length < SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod) {
            return { error: 'Dados insuficientes' };
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const supportLevels = findSupportLevels(lows, candles);
        const resistanceLevels = findResistanceLevels(highs, candles);

        const relevantSupport = filterRelevantLevels(supportLevels, currentPrice, true);
        const relevantResistance = filterRelevantLevels(resistanceLevels, currentPrice, false);

        const nearestSupport = findNearestLevel(relevantSupport, currentPrice, true);
        const nearestResistance = findNearestLevel(relevantResistance, currentPrice, false);

        const recentCandles = candles.slice(-SUPPORT_RESISTANCE_SETTINGS.recentPeriod);
        const recentBreakouts = analyzeRecentBreakouts(recentCandles, supportLevels, resistanceLevels);

        const supportDistancePercent = nearestSupport ?
            ((currentPrice - nearestSupport.price) / currentPrice) * 100 : null;

        const resistanceDistancePercent = nearestResistance ?
            ((nearestResistance.price - currentPrice) / currentPrice) * 100 : null;

        const breakoutRisk = calculateBreakoutRisk(
            currentPrice,
            nearestSupport,
            nearestResistance,
            isBullish,
            recentBreakouts
        );

        return {
            supports: relevantSupport,
            resistances: relevantResistance,
            nearestSupport: nearestSupport ? {
                price: nearestSupport.price,
                strength: nearestSupport.strength,
                distance: currentPrice - nearestSupport.price,
                distancePercent: supportDistancePercent,
                isNear: supportDistancePercent !== null &&
                    supportDistancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold
            } : null,
            nearestResistance: nearestResistance ? {
                price: nearestResistance.price,
                strength: nearestResistance.strength,
                distance: nearestResistance.price - currentPrice,
                distancePercent: resistanceDistancePercent,
                isNear: resistanceDistancePercent !== null &&
                    resistanceDistancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold
            } : null,
            breakoutRisk: breakoutRisk,
            recentBreakouts: recentBreakouts,
            currentPrice: currentPrice,
            analysis: getSupportResistanceAnalysis(nearestSupport, nearestResistance, isBullish)
        };

    } catch (error) {
        console.log(`⚠️ Erro análise S/R ${symbol}: ${error.message}`);
        return { error: error.message };
    }
}

function findSupportLevels(lows, candles) {
    const levels = [];
    const window = 4;

    for (let i = window; i < lows.length - window; i++) {
        const currentLow = lows[i];
        let isLocalMin = true;

        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && lows[j] < currentLow) {
                isLocalMin = false;
                break;
            }
        }

        if (isLocalMin) {
            const existingLevel = levels.find(level =>
                Math.abs(level.price - currentLow) / currentLow < 0.004
            );

            if (existingLevel) {
                existingLevel.touchCount++;
                existingLevel.timestamps.push(candles[i].time);
                existingLevel.strength = calculateLevelStrength(existingLevel.touchCount);
            } else {
                levels.push({
                    price: currentLow,
                    touchCount: 1,
                    timestamps: [candles[i].time],
                    strength: calculateLevelStrength(1),
                    type: 'support'
                });
            }
        }
    }

    return levels;
}

function findResistanceLevels(highs, candles) {
    const levels = [];
    const window = 4;

    for (let i = window; i < highs.length - window; i++) {
        const currentHigh = highs[i];
        let isLocalMax = true;

        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && highs[j] > currentHigh) {
                isLocalMax = false;
                break;
            }
        }

        if (isLocalMax) {
            const existingLevel = levels.find(level =>
                Math.abs(level.price - currentHigh) / currentHigh < 0.004
            );

            if (existingLevel) {
                existingLevel.touchCount++;
                existingLevel.timestamps.push(candles[i].time);
                existingLevel.strength = calculateLevelStrength(existingLevel.touchCount);
            } else {
                levels.push({
                    price: currentHigh,
                    touchCount: 1,
                    timestamps: [candles[i].time],
                    strength: calculateLevelStrength(1),
                    type: 'resistance'
                });
            }
        }
    }

    return levels;
}

function calculateLevelStrength(touchCount) {
    if (touchCount >= 4) return 'very_strong';
    if (touchCount >= 3) return 'strong';
    if (touchCount >= 2) return 'moderate';
    return 'weak';
}

function filterRelevantLevels(levels, currentPrice, isSupport) {
    return levels
        .filter(level => level.touchCount >= SUPPORT_RESISTANCE_SETTINGS.minTouchPoints)
        .filter(level => {
            if (isSupport) {
                return level.price < currentPrice;
            } else {
                return level.price > currentPrice;
            }
        })
        .sort((a, b) => {
            if (isSupport) {
                return b.price - a.price;
            } else {
                return a.price - b.price;
            }
        });
}

function findNearestLevel(levels, currentPrice, isSupport) {
    if (levels.length === 0) return null;

    let nearest = levels[0];
    let minDistance = Math.abs(currentPrice - nearest.price);

    for (const level of levels) {
        const distance = Math.abs(currentPrice - level.price);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = level;
        }
    }

    return nearest;
}

function analyzeRecentBreakouts(recentCandles, supportLevels, resistanceLevels) {
    const breakouts = [];

    for (let i = 1; i < recentCandles.length; i++) {
        const candle = recentCandles[i];
        const prevCandle = recentCandles[i - 1];

        for (const resistance of resistanceLevels) {
            if (prevCandle.high < resistance.price && candle.high > resistance.price) {
                breakouts.push({
                    type: 'resistance_breakout',
                    level: resistance.price,
                    strength: resistance.strength,
                    time: candle.time,
                    candle: i
                });
            }
        }

        for (const support of supportLevels) {
            if (prevCandle.low > support.price && candle.low < support.price) {
                breakouts.push({
                    type: 'support_breakout',
                    level: support.price,
                    strength: support.strength,
                    time: candle.time,
                    candle: i
                });
            }
        }
    }

    return breakouts;
}

function calculateBreakoutRisk(currentPrice, nearestSupport, nearestResistance, isBullish, recentBreakouts) {
    let distanceToLevel = null;
    let levelType = null;
    let levelStrength = null;

    if (isBullish) {
        if (nearestResistance) {
            distanceToLevel = nearestResistance.price - currentPrice;
            levelType = 'resistance';
            levelStrength = nearestResistance.strength;
        }
    } else {
        if (nearestSupport) {
            distanceToLevel = currentPrice - nearestSupport.price;
            levelType = 'support';
            levelStrength = nearestSupport.strength;
        }
    }

    if (!distanceToLevel) {
        return {
            level: 'low',
            reason: 'Nenhum nível próximo detectado',
            distancePercent: null
        };
    }

    const distancePercent = (distanceToLevel / currentPrice) * 100;

    const recentBreakout = recentBreakouts.find(b =>
        Math.abs(b.level - (levelType === 'resistance' ? nearestResistance.price : nearestSupport.price)) /
        (levelType === 'resistance' ? nearestResistance.price : nearestSupport.price) < 0.01
    );

    let riskLevel = 'low';
    let reason = '';

    if (recentBreakout) {
        riskLevel = 'high';
        reason = `Rompimento recente de ${levelType} ${recentBreakout.strength}`;
    } else if (distancePercent <= BREAKOUT_RISK_SETTINGS.highRiskDistance) {
        riskLevel = 'high';
        reason = `Muito próximo (${distancePercent.toFixed(2)}%) de ${levelType} ${levelStrength}`;
    } else if (distancePercent <= BREAKOUT_RISK_SETTINGS.mediumRiskDistance) {
        riskLevel = 'medium';
        reason = `Próximo (${distancePercent.toFixed(2)}%) de ${levelType} ${levelStrength}`;
    } else if (distancePercent <= BREAKOUT_RISK_SETTINGS.lowRiskDistance) {
        riskLevel = 'low';
        reason = `Distante (${distancePercent.toFixed(2)}%) de ${levelType} ${levelStrength}`;
    } else {
        riskLevel = 'very_low';
        reason = `Muito distante (${distancePercent.toFixed(2)}%) de qualquer ${levelType}`;
    }

    return {
        level: riskLevel,
        reason: reason,
        distancePercent: distancePercent,
        levelType: levelType,
        levelStrength: levelStrength,
        distancePrice: distanceToLevel
    };
}

function getSupportResistanceAnalysis(nearestSupport, nearestResistance, isBullish) {
    const analysis = [];

    if (nearestSupport) {
        analysis.push(`Suporte: ${nearestSupport.price.toFixed(8)} (${nearestSupport.strength})`);
        analysis.push(`Distância: ${((nearestSupport.distancePercent || 0).toFixed(2))}%`);

        if (nearestSupport.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DO SUPORTE!`);
        }
    }

    if (nearestResistance) {
        analysis.push(`Resistência: ${nearestResistance.price.toFixed(8)} (${nearestResistance.strength})`);
        analysis.push(`Distância: ${((nearestResistance.distancePercent || 0).toFixed(2))}%`);

        if (nearestResistance.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DA RESISTÊNCIA!`);
        }
    }

    if (isBullish && nearestResistance) {
        const upsidePotential = nearestResistance.distancePercent || 0;
        analysis.push(`Potencial de alta: ${upsidePotential.toFixed(2)}%`);
    }

    if (!isBullish && nearestSupport) {
        const downsidePotential = nearestSupport.distancePercent || 0;
        analysis.push(`Potencial de baixa: ${downsidePotential.toFixed(2)}%`);
    }

    return analysis;
}

async function getATRData(symbol, timeframe = '5m', period = 10) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 15);
        if (candles.length < period) return null;

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });

        if (!atrValues || atrValues.length === 0) return null;

        const latestATR = atrValues[atrValues.length - 1];
        const avgATR = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;

        const atrPercentage = (latestATR / closes[closes.length - 1]) * 100;

        let volatilityLevel = 'medium';
        if (atrPercentage < 0.8) volatilityLevel = 'low';
        else if (atrPercentage > 2.0) volatilityLevel = 'high';

        return {
            value: latestATR,
            average: avgATR,
            percentage: atrPercentage,
            volatilityLevel: volatilityLevel,
            raw: atrValues
        };
    } catch (error) {
        return null;
    }
}

function calculateDynamicStopLoss(price, isBullish, atrData) {
    if (!atrData || !DYNAMIC_STOP_SETTINGS.volatilityBased) {
        const stopPercentage = 2.0;
        return {
            price: isBullish ?
                price * (1 - stopPercentage / 100) :
                price * (1 + stopPercentage / 100),
            percentage: stopPercentage,
            distance: price * (stopPercentage / 100),
            method: 'fixed',
            volatility: 'unknown'
        };
    }

    const volatilityMultiplier = DYNAMIC_STOP_SETTINGS.volatilityMultipliers[atrData.volatilityLevel] || 1.0;
    const atrMultiplier = DYNAMIC_STOP_SETTINGS.baseATRMultiplier * volatilityMultiplier;

    const stopDistance = atrData.value * atrMultiplier;
    const stopPrice = isBullish ?
        price - stopDistance :
        price + stopDistance;

    const stopPercentage = (stopDistance / price) * 100;
    const clampedPercentage = Math.max(
        DYNAMIC_STOP_SETTINGS.minStopPercentage,
        Math.min(DYNAMIC_STOP_SETTINGS.maxStopPercentage, stopPercentage)
    );

    const finalStopDistance = price * (clampedPercentage / 100);
    const finalStopPrice = isBullish ?
        price - finalStopDistance :
        price + finalStopDistance;

    return {
        price: finalStopPrice,
        percentage: clampedPercentage,
        distance: finalStopDistance,
        method: 'dynamic_atr',
        volatility: atrData.volatilityLevel,
        atrValue: atrData.value,
        atrMultiplier: atrMultiplier,
        atrPercentage: atrData.percentage
    };
}

function calculateDynamicRetracements(price, stopData, isBullish, atrData) {
    if (!atrData || !RETRACEMENT_SETTINGS.useDynamicATR) {
        const minRetracement = stopData.distance * RETRACEMENT_SETTINGS.minPercentage;
        const maxRetracement = stopData.distance * RETRACEMENT_SETTINGS.maxPercentage;

        const minRetracementPrice = isBullish ?
            price - minRetracement :
            price + minRetracement;

        const maxRetracementPrice = isBullish ?
            price - maxRetracement :
            price + maxRetracement;

        return {
            minRetracementPrice: minRetracementPrice,
            minRetracementPercentage: RETRACEMENT_SETTINGS.minPercentage * 100,
            minRetracementDistance: minRetracement,
            maxRetracementPrice: maxRetracementPrice,
            maxRetracementPercentage: RETRACEMENT_SETTINGS.maxPercentage * 100,
            maxRetracementDistance: maxRetracement,
            method: 'fixed_percentage',
            volatility: 'unknown'
        };
    }

    const volatilityAdjustment = RETRACEMENT_SETTINGS.volatilityAdjustment[atrData.volatilityLevel] || 1.0;

    const minRetracementATR = atrData.value * RETRACEMENT_SETTINGS.atrMultiplierMin * volatilityAdjustment;
    const minRetracementPrice = isBullish ?
        price - minRetracementATR :
        price + minRetracementATR;

    const minRetracementPercentage = (minRetracementATR / price) * 100;

    const maxRetracementATR = atrData.value * RETRACEMENT_SETTINGS.atrMultiplierMax * volatilityAdjustment;
    const maxRetracementPrice = isBullish ?
        price - maxRetracementATR :
        price + maxRetracementATR;

    const maxRetracementPercentage = (maxRetracementATR / price) * 100;

    return {
        minRetracementPrice: minRetracementPrice,
        minRetracementPercentage: minRetracementPercentage,
        minRetracementDistance: minRetracementATR,
        maxRetracementPrice: maxRetracementPrice,
        maxRetracementPercentage: maxRetracementPercentage,
        maxRetracementDistance: maxRetracementATR,
        method: 'dynamic_atr',
        volatility: atrData.volatilityLevel,
        atrValue: atrData.value,
        volatilityAdjustment: volatilityAdjustment
    };
}

async function calculateAdvancedTargetsAndStop(price, isBullish, symbol) {
    try {
        const atrData = await getATRData(symbol, ATR_TIMEFRAME, ATR_PERIOD);
        const stopData = calculateDynamicStopLoss(price, isBullish, atrData);
        const retracementData = calculateDynamicRetracements(price, stopData, isBullish, atrData);

        const targets = TARGET_PERCENTAGES.map(percent => {
            const targetPrice = isBullish ?
                price * (1 + percent / 100) :
                price * (1 - percent / 100);

            const distanceToStop = Math.abs(price - stopData.price);
            const distanceToTarget = Math.abs(targetPrice - price);
            const riskReward = distanceToTarget / distanceToStop;

            return {
                target: percent.toFixed(1),
                price: targetPrice.toFixed(8),
                riskReward: riskReward.toFixed(2),
                distance: distanceToTarget
            };
        });

        const validTargets = targets.filter(t => parseFloat(t.riskReward) >= 1.2);
        const bestTarget = validTargets.length > 0 ?
            validTargets.reduce((a, b) => parseFloat(a.riskReward) > parseFloat(b.riskReward) ? a : b) :
            targets[0];

        return {
            stopPrice: stopData.price,
            stopPercentage: stopData.percentage.toFixed(2),
            stopData: stopData,
            retracementData: retracementData,
            targets: targets,
            bestRiskReward: parseFloat(bestTarget.riskReward).toFixed(2),
            atrData: atrData,
            bestTarget: bestTarget
        };

    } catch (error) {
        console.log(`⚠️ Erro no cálculo avançado para ${symbol}: ${error.message}`);
        return getDefaultTargets(price, isBullish);
    }
}

function getDefaultTargets(price, isBullish) {
    const stopPercentage = 2.0;
    const stopPrice = isBullish ?
        price * (1 - stopPercentage / 100) :
        price * (1 + stopPercentage / 100);

    const targets = TARGET_PERCENTAGES.map(percent => ({
        target: percent.toFixed(1),
        price: isBullish ?
            (price * (1 + percent / 100)).toFixed(8) :
            (price * (1 - percent / 100)).toFixed(8),
        riskReward: (percent / stopPercentage).toFixed(2)
    }));

    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        targets: targets,
        bestRiskReward: (6.0 / stopPercentage).toFixed(2),
        stopData: { method: 'fixed_fallback' },
        retracementData: { method: 'fixed_fallback' }
    };
}

// =====================================================================
// 🚀 FUNÇÃO CORRIGIDA PARA MENSAGEM DE INICIALIZAÇÃO SIMPLES
// =====================================================================

async function sendInitializationMessage(allSymbols) {
    try {
        const brazilTime = getBrazilianDateTime();

        const message = `🚀 Titanium BTC Pares ativado\n${brazilTime.full}\n\n📊 ${allSymbols.length} pares BTC\n🎯 FOCO: Performance vs BTC\n⚡ Sensibilidade aumentada`;

        console.log('\n📤 ENVIANDO MENSAGEM DE INICIALIZAÇÃO...');

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
            attempts++;

            try {
                const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: message,
                        parse_mode: 'Markdown',  // Usar Markdown em vez de null
                        disable_web_page_preview: true
                    }),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    success = true;
                    console.log('✅ Mensagem de inicialização enviada para Telegram!');
                } else {
                    console.log(`⚠️ Tentativa ${attempts}/${maxAttempts}: HTTP ${response.status}`);
                    if (attempts < maxAttempts) {
                        await new Promise(r => setTimeout(r, 1500 * attempts));
                    }
                }

            } catch (error) {
                console.log(`⚠️ Tentativa ${attempts}/${maxAttempts}: ${error.message}`);
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 1500 * attempts));
                }
            }
        }

        if (!success) {
            console.log('📋 Mensagem que seria enviada:');
            console.log('\n' + '='.repeat(60));
            console.log('🚀 Titanium BTC Pares ativado');
            console.log(`⏰ ${brazilTime.full}`);
            console.log(`📊 ${allSymbols.length} pares BTC`);
            console.log('='.repeat(60) + '\n');
        }

        return success;

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem de inicialização:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÕES DE ANÁLISE TÉCNICA
// =====================================================================

let rateLimiter = new AdaptiveRateLimiter();

async function fetchAllSpotSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://api.binance.com/api/v3/exchangeInfo',
            {},
            'exchangeInfo'
        );

        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('BTC') && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`✅ ${symbols.length} pares BTC spot encontrados`);
        return symbols;

    } catch (error) {
        console.log('❌ Erro ao buscar símbolos spot, usando fallback');
        return ['ETHBTC', 'BNBBTC', 'SOLBTC', 'XRPBTC', 'ADABTC', 'DOTBTC', 'DOGEBTC', 'MATICBTC'];
    }
}

async function getCandlesCached(symbol, timeframe, limit = 60) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();

        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }

        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '10m': '10m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h'
        };

        const interval = intervalMap[timeframe] || '15m';
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

        const data = await rateLimiter.makeRequest(url, {}, 'klines');

        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));

        candleCache[cacheKey] = { data: candles, timestamp: now };
        return candles;
    } catch (error) {
        return [];
    }
}

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 60);
        if (candles.length < 55) return null;

        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];

        const ema13 = EMA.calculate({ period: 13, values: closes });
        const ema34 = EMA.calculate({ period: 34, values: closes });
        const ema55 = EMA.calculate({ period: 55, values: closes });

        const latestEma13 = ema13[ema13.length - 1];
        const latestEma34 = ema34[ema34.length - 1];
        const latestEma55 = ema55[ema55.length - 1];
        const previousEma13 = ema13[ema13.length - 2];
        const previousEma34 = ema34[ema34.length - 2];

        return {
            currentPrice: currentPrice,
            isAboveEMA55: currentPrice > latestEma55,
            isEMA13CrossingUp: previousEma13 <= previousEma34 && latestEma13 > latestEma34,
            isEMA13CrossingDown: previousEma13 >= previousEma34 && latestEma13 < latestEma34
        };
    } catch (error) {
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 60);
        if (candles.length < 14) return null;

        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        if (!rsiValues || rsiValues.length === 0) return null;

        const latestRSI = rsiValues[rsiValues.length - 1];
        const previousRSI = rsiValues[rsiValues.length - 2];
        
        let status = 'NEUTRAL';
        if (latestRSI < 30) status = 'OVERSOLD';
        else if (latestRSI > 70) status = 'OVERBOUGHT';
        
        return {
            value: latestRSI,
            previous: previousRSI,
            raw: latestRSI,
            status: status,
            isExitingExtreme: (previousRSI < 30 && latestRSI > 30) || 
                             (previousRSI > 70 && latestRSI < 70)
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        const volumeAnalysis = await checkVolumeRobust(symbol);
        return volumeAnalysis;
    } catch (error) {
        return { rawRatio: 0, isAbnormal: false, robustData: null };
    }
}

async function checkVolatility(symbol) {
    try {
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 8);
        if (candles.length < VOLATILITY_PERIOD) return { rawVolatility: 0, isValid: false };

        const closes = candles.map(c => c.close);
        const returns = [];

        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]));
        }

        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;

        return {
            rawVolatility: volatility,
            isValid: volatility >= VOLATILITY_THRESHOLD
        };
    } catch (error) {
        return { rawVolatility: 0, isValid: false };
    }
}

async function checkStochastic(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 25);
        if (candles.length < STOCH_SETTINGS.period + 5) return { isValid: false };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: STOCH_SETTINGS.period,
            smooth: STOCH_SETTINGS.smooth,
            signalPeriod: STOCH_SETTINGS.signalPeriod
        });

        if (!stochValues || stochValues.length < 2) return { isValid: false };

        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];

        if (isBullish) {
            return {
                isValid: previous.k <= previous.d && current.k > current.d,
                kValue: current.k,
                dValue: current.d,
                kPrevious: previous.k,
                dPrevious: previous.d
            };
        } else {
            return {
                isValid: previous.k >= previous.d && current.k < current.d,
                kValue: current.k,
                dValue: current.d,
                kPrevious: previous.k,
                dPrevious: previous.d
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

async function checkStochastic4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 35);
        if (candles.length < STOCH_4H_SETTINGS.period + 5) return { isValid: false };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: STOCH_4H_SETTINGS.period,
            signalPeriod: STOCH_4H_SETTINGS.signalPeriod,
            smooth: STOCH_4H_SETTINGS.smooth
        });

        if (!stochValues || stochValues.length < 2) return { isValid: false };

        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];

        if (isBullish) {
            return {
                isValid: previous.k <= previous.d && current.k > current.d,
                kValue: current.k,
                dValue: current.d
            };
        } else {
            return {
                isValid: previous.k >= previous.d && current.k < current.d,
                kValue: current.k,
                dValue: current.d
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR QUALIDADE DO SINAL COM FOCO EM BTC
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

    // 1. BTC CORRELATION (PRIORIDADE MÁXIMA)
    if (marketData.btcCorrelation) {
        const btcData = marketData.btcCorrelation;
        const relativePerformance = btcData.relativePerformance || 0;
        const performanceLevel = btcData.performanceLevel || 'NEUTRAL';
        
        let btcScore = 0;
        
        if (performanceLevel === 'STRONG_OUTPERFORMANCE') {
            if (isBullish) {
                btcScore = QUALITY_WEIGHTS.btcCorrelation;
                score += btcScore;
                details.push(` 🚀 BTC HIGH PERFORMANCE: +${btcScore}/${QUALITY_WEIGHTS.btcCorrelation} (+${relativePerformance.toFixed(2)}%)`);
                
                // BÔNUS EXTRA PARA PERFORMANCE EXCEPCIONAL
                if (relativePerformance > 1.0) {
                    score += 10;
                    details.push(`   ⭐ BÔNUS EXTRA: +10 pontos (Performance excepcional vs BTC)`);
                }
            } else {
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.5;
                score += btcScore;
                details.push(` 📈 BTC Performance (Cuidado Venda): ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (+${relativePerformance.toFixed(2)}%)`);
            }
        } 
        else if (performanceLevel === 'MODERATE_OUTPERFORMANCE') {
            if (isBullish) {
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.9;
                score += btcScore;
                details.push(` 📈 BTC Good Performance: ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (+${relativePerformance.toFixed(2)}%)`);
            } else {
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.3;
                score += btcScore;
                details.push(` ⚠️ BTC Performance (Neutro Venda): ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (+${relativePerformance.toFixed(2)}%)`);
            }
        }
        else if (performanceLevel === 'STRONG_UNDERPERFORMANCE') {
            if (!isBullish) {
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.9;
                score += btcScore;
                details.push(` 📉 BTC Underperformance (Bom Venda): ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (${relativePerformance.toFixed(2)}%)`);
            } else {
                failedChecks.push(`BTC Performance: Altcoin muito fraca vs BTC (${relativePerformance.toFixed(2)}%) - EVITAR COMPRA`);
            }
        }
        else if (performanceLevel === 'MODERATE_UNDERPERFORMANCE') {
            if (!isBullish) {
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.7;
                score += btcScore;
                details.push(` ⚠️ BTC Underperformance: ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (${relativePerformance.toFixed(2)}%)`);
            } else {
                failedChecks.push(`BTC Performance: Altcoin fraca vs BTC (${relativePerformance.toFixed(2)}%)`);
            }
        }
        else {
            btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.4;
            score += btcScore;
            details.push(` ➡️ BTC Neutral: ${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (${relativePerformance.toFixed(2)}%)`);
        }
        
        // BÔNUS DE MOMENTUM ULTRA-RÁPIDO
        if (btcData.ultraFastPerformance && Math.abs(btcData.ultraFastPerformance) > 0.3) {
            const momentumBonus = 6;
            score += momentumBonus;
            details.push(`   ⚡ BTC Momentum 1m: +${momentumBonus} (${btcData.ultraFastPerformance > 0 ? '+' : ''}${btcData.ultraFastPerformance.toFixed(2)}%)`);
        }
        
        // BÔNUS DE TENDÊNCIA
        if (btcData.trend === 'ACCELERATING' && isBullish) {
            score += 4;
            details.push(`   📈 BTC Trend Accelerating: +4`);
        } else if (btcData.trend === 'DECELERATING' && !isBullish) {
            score += 4;
            details.push(`   📉 BTC Trend Decelerating: +4`);
        }
    } else {
        failedChecks.push(`BTC Correlation: Não analisado`);
    }

    // 2. CONFIRMAÇÃO DE TENDÊNCIA BTC
    const trendScore = await confirmBTCTrendAlignment(symbol, isBullish);
    if (trendScore > 0) {
        const trendPoints = trendScore * QUALITY_WEIGHTS.trendAlignment;
        score += trendPoints;
        details.push(` 📊 BTC Trend Alignment: ${trendPoints.toFixed(1)}/${QUALITY_WEIGHTS.trendAlignment} (${(trendScore*100).toFixed(0)}%)`);
    }

    // 3. VOLUME
    const volumeData = marketData.volume?.robustData;
    if (volumeData && volumeData.combinedScore >= 0.3) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume,
            QUALITY_WEIGHTS.volume * volumeData.combinedScore);
        score += volumeScore;
        details.push(` 📈 Volume 3m: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (Score: ${volumeData.combinedScore.toFixed(2)} - ${volumeData.classification})`);
    } else {
        failedChecks.push(`Volume 3m: Score ${volumeData?.combinedScore?.toFixed(2) || '0.00'} < 0.3 (${volumeData?.classification || 'FRACO'})`);
    }

    // 4. VOLATILIDADE
    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(` 📊 Volatility: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatility: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}% < ${VOLATILITY_THRESHOLD}%`);
    }

    // 5. RSI
    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;

        if ((isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) ||
            (!isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` 📉 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(1)} ${isBullish ? '≤' : '≥'} ${isBullish ? RSI_BUY_MAX : RSI_SELL_MIN})`);
        } else {
            failedChecks.push(`RSI: ${rsiValue.toFixed(1)} (Fora da zona ideal)`);
        }
        score += rsiScore;
    }

    // 6. EMA ALIGNMENT
    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
            (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);

        if (isEmaValid) {
            const emaScore = QUALITY_WEIGHTS.emaAlignment;
            score += emaScore;
            details.push(` 📊 EMA: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} ${isBullish ? 'bullish' : 'bearish'})`);
        } else {
            failedChecks.push(`EMA: Alinhamento incorreto`);
        }
    }

    // 7. STOCHASTIC
    if (marketData.stoch && marketData.stoch.isValid) {
        const stochScore = QUALITY_WEIGHTS.stoch1h;
        score += stochScore;
        const direction = isBullish ? 'K > D (cruzamento bullish)' : 'K < D (cruzamento bearish)';
        details.push(` 📈 Stoch 1h: ${stochScore}/${QUALITY_WEIGHTS.stoch1h} (${direction})`);
    } else {
        failedChecks.push(`Stoch 1h: Sem cruzamento ${isBullish ? 'bullish' : 'bearish'}`);
    }

    // 8. STOCHASTIC 4H
    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        const stoch4hScore = QUALITY_WEIGHTS.stoch4h;
        score += stoch4hScore;
        details.push(` 📊 Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h}`);
    } else {
        failedChecks.push(`Stoch 4h: ${isBullish ? 'bullish' : 'bearish'}`);
    }

    // 9. BREAKOUT RISK
    if (marketData.breakoutRisk) {
        let breakoutScore = 0;
        let breakoutDetail = '';

        switch (marketData.breakoutRisk.level) {
            case 'very_low':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk;
                breakoutDetail = `${breakoutScore}/${QUALITY_WEIGHTS.breakoutRisk} (Risco muito baixo)`;
                break;
            case 'low':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk * 0.8;
                breakoutDetail = `${breakoutScore.toFixed(1)}/${QUALITY_WEIGHTS.breakoutRisk} (Risco baixo)`;
                break;
            case 'medium':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk * 0.5;
                breakoutDetail = `${breakoutScore.toFixed(1)}/${QUALITY_WEIGHTS.breakoutRisk} (Risco médio)`;
                break;
            case 'high':
                breakoutScore = 0;
                breakoutDetail = `0/${QUALITY_WEIGHTS.breakoutRisk} (ALTO RISCO DE ROMPIMENTO!)`;
                failedChecks.push(`Risco Rompimento: ${marketData.breakoutRisk.reason}`);
                break;
            default:
                breakoutDetail = `0/${QUALITY_WEIGHTS.breakoutRisk} (Não analisado)`;
        }

        score += breakoutScore;
        details.push(` ⚠️ Breakout Risk: ${breakoutDetail}`);
    }

    // 10. SUPPORT/RESISTANCE
    if (marketData.supportResistance) {
        let srScore = 0;
        let srDetail = '';

        const nearestLevel = isBullish ?
            marketData.supportResistance.nearestResistance :
            marketData.supportResistance.nearestSupport;

        if (nearestLevel) {
            const distance = nearestLevel.distancePercent || 0;

            if (distance >= 2.5) {
                srScore = QUALITY_WEIGHTS.supportResistance;
                srDetail = `${srScore}/${QUALITY_WEIGHTS.supportResistance} (Boa distância: ${distance.toFixed(2)}%)`;
            } else if (distance >= 1.2) {
                srScore = QUALITY_WEIGHTS.supportResistance * 0.7;
                srDetail = `${srScore.toFixed(1)}/${QUALITY_WEIGHTS.supportResistance} (Distância ok: ${distance.toFixed(2)}%)`;
            } else if (distance >= 0.6) {
                srScore = QUALITY_WEIGHTS.supportResistance * 0.3;
                srDetail = `${srScore.toFixed(1)}/${QUALITY_WEIGHTS.supportResistance} (Próximo: ${distance.toFixed(2)}%)`;
            } else {
                srScore = 0;
                srDetail = `0/${QUALITY_WEIGHTS.supportResistance} (MUITO PRÓXIMO: ${distance.toFixed(2)}%!)`;
                failedChecks.push(`S/R: ${isBullish ? 'Resistência' : 'Suporte'} muito próximo (${distance.toFixed(2)}%)`);
            }
        } else {
            srScore = QUALITY_WEIGHTS.supportResistance * 0.5;
            srDetail = `${srScore.toFixed(1)}/${QUALITY_WEIGHTS.supportResistance} (Sem nível próximo)`;
        }

        score += srScore;
        details.push(` 📍 S/R Distance: ${srDetail}`);
    }

    // 11. PIVOT POINTS
    if (marketData.pivotPoints) {
        let pivotScore = 0;
        let pivotDetail = '';

        const nearestPivot = marketData.pivotPoints.nearestPivot;
        
        if (nearestPivot) {
            const distance = nearestPivot.distancePercent || 0;
            const pivotStrength = nearestPivot.strength || 'unknown';
            const timeframe = nearestPivot.timeframe || 'unknown';
            const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
            const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
            
            const distanceRatio = distance / safeDistance;
            
            if (distanceRatio >= 1.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints;
                pivotDetail = `${pivotScore}/${QUALITY_WEIGHTS.pivotPoints} (Excelente distância do pivot ${pivotStrength} ${timeframe})`;
            } else if (distanceRatio >= 1.0) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.8;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Boa distância do pivot ${pivotStrength} ${timeframe})`;
            } else if (distanceRatio >= 0.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.4;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Próximo do pivot ${pivotStrength} ${timeframe})`;
            } else {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (MUITO PRÓXIMO DO PIVOT ${pivotStrength.toUpperCase()} ${timeframe.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${pivotStrength} ${timeframe}: Muito próximo (${distance.toFixed(2)}%)`);
            }
            
            if (nearestPivot.isTesting) {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (TESTANDO PIVOT!)`;
                failedChecks.push(`Pivot ${pivotStrength} ${timeframe}: Testando nível`);
            }
        } else {
            pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.5;
            pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Sem pivot próximo)`;
        }
        
        score += pivotScore;
        details.push(` ⚖️ Pivot Points: ${pivotDetail}`);
    } else {
        failedChecks.push(`Pivot Points: Não analisado`);
    }

    // 12. MOMENTUM
    if (marketData.momentum) {
        const momentumData = marketData.momentum;
        let momentumScore = 0;
        let momentumDetail = '';

        if (momentumData.isSpiking) {
            if (Math.abs(momentumData.priceChange) > 1.0) {
                momentumScore = QUALITY_WEIGHTS.momentum;
                momentumDetail = `${momentumScore}/${QUALITY_WEIGHTS.momentum} (⚡ MOMENTUM FORTE: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe})`;
            } else if (Math.abs(momentumData.priceChange) > 0.5) {
                momentumScore = QUALITY_WEIGHTS.momentum * 0.7;
                momentumDetail = `${momentumScore.toFixed(1)}/${QUALITY_WEIGHTS.momentum} (📈 Momentum positivo: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe})`;
            } else {
                momentumScore = QUALITY_WEIGHTS.momentum * 0.3;
                momentumDetail = `${momentumScore.toFixed(1)}/${QUALITY_WEIGHTS.momentum} (↗️ Leve momentum: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe})`;
            }
        } else {
            momentumScore = QUALITY_WEIGHTS.momentum * 0.1;
            momentumDetail = `${momentumScore.toFixed(1)}/${QUALITY_WEIGHTS.momentum} (➡️ Momentum neutro)`;
        }

        score += momentumScore;
        details.push(` ⚡ Momentum: ${momentumDetail}`);
    } else {
        failedChecks.push(`Momentum: Não analisado`);
    }

    // 13. VOLUME CONFIRMAÇÃO
    if (volumeData?.isVolumeConfirmed) {
        const confirmationScore = QUALITY_WEIGHTS.volumeConfirmation;
        score += confirmationScore;
        details.push(` ✅ Volume Confirmado: +${confirmationScore}/${QUALITY_WEIGHTS.volumeConfirmation}`);
    }

    let grade, emoji;
    if (score >= 85) {
        grade = "A✨";
        emoji = "🏆";
    } else if (score >= 70) {
        grade = "B";
        emoji = "✅";
    } else if (score >= QUALITY_THRESHOLD) {
        grade = "C";
        emoji = "⚠️";
    } else {
        grade = "D";
        emoji = "❌";
    }

    return {
        score: Math.min(100, Math.round(score)),
        grade: grade,
        emoji: emoji,
        details: details,
        failedChecks: failedChecks,
        isAcceptable: score >= QUALITY_THRESHOLD,
        threshold: QUALITY_THRESHOLD,
        message: `${emoji} SCORE: ${grade} (${Math.round(score)}/100)`
    };
}

// =====================================================================
// 🔄 MONITORAMENTO PRINCIPAL COM DELAY ADAPTATIVO
// =====================================================================

class AdaptiveSymbolGroupManager {
    constructor() {
        this.symbolGroups = [];
        this.currentGroupIndex = 0;
        this.totalCycles = 0;
        this.groupSize = SENSITIVITY_SETTINGS.symbolGroupSize || 12;
        this.signalsDetected = 0;
        this.baseDelay = SENSITIVITY_SETTINGS.scanInterval || 4000;
        this.minDelay = SENSITIVITY_SETTINGS.minScanInterval || 2000;
        this.maxDelay = SENSITIVITY_SETTINGS.maxScanInterval || 6000;
        this.consecutiveNoSignals = 0;
        this.btcPerformanceSignals = 0;
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllSpotSymbols();

            const filteredSymbols = allSymbols.filter(symbol => {
                const blacklist = ['UP', 'DOWN'];
                return !blacklist.some(term => symbol.includes(term));
            });

            this.symbolGroups = this.createGroups(filteredSymbols, this.groupSize);

            console.log(`📊 ${filteredSymbols.length} pares BTC spot divididos em ${this.symbolGroups.length} grupos`);

            return filteredSymbols;

        } catch (error) {
            console.error('Erro ao inicializar símbolos:', error.message);
            return [];
        }
    }

    createGroups(symbols, groupSize) {
        const groups = [];
        for (let i = 0; i < symbols.length; i += groupSize) {
            groups.push(symbols.slice(i, i + groupSize));
        }
        return groups;
    }

    getNextGroup() {
        const group = this.symbolGroups[this.currentGroupIndex];
        this.currentGroupIndex = (this.currentGroupIndex + 1) % this.symbolGroups.length;

        if (this.currentGroupIndex === 0) {
            this.totalCycles++;

            this.adjustDelayBasedOnUsage();

            if (this.totalCycles % 4 === 0) {
                return { symbols: [], pause: 15000 };
            }
        }

        return { symbols: group, pause: 0 };
    }

    adjustDelayBasedOnUsage() {
        if (this.consecutiveNoSignals > SENSITIVITY_SETTINGS.maxConsecutiveNoSignals) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.6);
            console.log(`⚡ Reduzindo delay para ${this.baseDelay}ms (${this.consecutiveNoSignals} grupos sem sinais)`);
            this.consecutiveNoSignals = 0;
        }

        if (this.btcPerformanceSignals > 0) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.8);
            this.consecutiveNoSignals = 0;
        }
    }

    getCurrentDelay() {
        return this.baseDelay;
    }

    getCurrentStatus() {
        return {
            totalGroups: this.symbolGroups.length,
            currentGroup: this.currentGroupIndex,
            totalCycles: this.totalCycles,
            signalsDetected: this.signalsDetected,
            btcPerformanceSignals: this.btcPerformanceSignals,
            currentDelay: this.baseDelay,
            consecutiveNoSignals: this.consecutiveNoSignals
        };
    }
}

async function monitorSymbol(symbol) {
    try {
        const emaData = await getEMAs3m(symbol);
        if (!emaData) return null;

        const rsiData = await getRSI1h(symbol);
        if (!rsiData) return null;

        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;

        if (!isBullish && !isBearish) return null;

        if (isBullish && rsiData.value > RSI_BUY_MAX) {
            console.log(`❌ ${symbol}: RSI alto para compra (${rsiData.value.toFixed(1)} > ${RSI_BUY_MAX})`);
            return null;
        }
        if (isBearish && rsiData.value < RSI_SELL_MIN) {
            console.log(`❌ ${symbol}: RSI baixo para venda (${rsiData.value.toFixed(1)} < ${RSI_SELL_MIN})`);
            return null;
        }

        // ANÁLISE BTC PRIMEIRO (prioridade)
        const btcCorrelationData = await analyzeBTCCorrelation(symbol, emaData.currentPrice, isBullish);
        
        // Se performance muito ruim vs BTC e sinal de compra, filtrar
        if (isBullish && btcCorrelationData?.performanceLevel === 'STRONG_UNDERPERFORMANCE') {
            console.log(`❌ ${symbol}: Altcoin muito fraca vs BTC (${btcCorrelationData.relativePerformance.toFixed(2)}%) - filtrando compra`);
            return null;
        }
        
        // Se performance muito boa vs BTC e sinal de venda, filtrar
        if (!isBullish && btcCorrelationData?.performanceLevel === 'STRONG_OUTPERFORMANCE') {
            console.log(`❌ ${symbol}: Altcoin muito forte vs BTC (${btcCorrelationData.relativePerformance.toFixed(2)}%) - filtrando venda`);
            return null;
        }

        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPoints(symbol, emaData.currentPrice, isBullish);
        const momentumData = await detectMomentumSpike(symbol, '1m');

        const [volumeData, volatilityData, stochData, stoch4hData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish)
        ]);

        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            rsi: rsiData,
            stoch: stochData,
            stoch4h: stoch4hData,
            ema: {
                isAboveEMA55: emaData.isAboveEMA55,
                isEMA13CrossingUp: emaData.isEMA13CrossingUp,
                isEMA13CrossingDown: emaData.isEMA13CrossingDown
            },
            supportResistance: supportResistanceData,
            breakoutRisk: supportResistanceData?.breakoutRisk,
            pivotPoints: pivotPointsData,
            btcCorrelation: btcCorrelationData,
            momentum: momentumData
        };

        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);

        if (!qualityScore.isAcceptable) return null;

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

        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        const pivotInfo = pivotPointsData?.nearestPivot;
        const pivotDistance = pivotInfo?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = pivotInfo?.type || 'N/A';

        const volumeRobustData = volumeData.robustData;
        const volumeScore = volumeRobustData?.combinedScore?.toFixed(2) || '0.00';
        const volumeClassification = volumeRobustData?.classification || 'NORMAL';

        const relativePerformance = btcCorrelationData?.relativePerformance || 0;
        const performanceLevel = btcCorrelationData?.performanceLevel || 'NEUTRAL';
        
        let performanceText = '';
        if (performanceLevel === 'STRONG_OUTPERFORMANCE') {
            performanceText = `🚀 +${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (performanceLevel === 'MODERATE_OUTPERFORMANCE') {
            performanceText = `📈 +${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (performanceLevel === 'STRONG_UNDERPERFORMANCE') {
            performanceText = `📉📉 ${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (performanceLevel === 'MODERATE_UNDERPERFORMANCE') {
            performanceText = `📉 ${relativePerformance.toFixed(2)}% vs BTC`;
        } else {
            performanceText = `➡️ ${relativePerformance.toFixed(2)}% vs BTC`;
        }

        const momentumText = momentumData?.isSpiking ? ` | ⚡ ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em 1m` : '';

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   ${performanceText}${momentumText}`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📈 Volume: ${volumeData.rawRatio.toFixed(2)}x (Score: ${volumeScore} - ${volumeClassification})`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}%`);

        return signal;

    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return null;
    }
}

async function processSymbolGroup(symbols) {
    const results = [];

    for (const symbol of symbols) {
        try {
            await new Promise(r => setTimeout(r, 120));
            const signal = await monitorSymbol(symbol);
            if (signal) results.push(signal);
        } catch (error) {
            continue;
        }
    }

    return results;
}

function cleanupCaches() {
    const now = Date.now();

    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });

    Object.keys(momentumCache).forEach(key => {
        if (now - momentumCache[key].timestamp > MOMENTUM_CACHE_TTL * 3) {
            delete momentumCache[key];
        }
    });

    Object.keys(correlationCache).forEach(key => {
        if (now - correlationCache[key].timestamp > CORRELATION_CACHE_TTL * 3) {
            delete correlationCache[key];
        }
    });
}

// =====================================================================
// 🔄 LOOP PRINCIPAL DO BOT
// =====================================================================

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(2000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function mainBotLoop() {
    const symbolManager = new AdaptiveSymbolGroupManager();

    const allSymbols = await symbolManager.initializeSymbols();

    if (allSymbols.length === 0) {
        console.log('❌ Não foi possível carregar símbolos.');
        return;
    }

    console.log(`\n🔥 TITANIUM SPOT BTC - FOCO EM PERFORMANCE VS BTC`);
    console.log(` 📊 ${allSymbols.length} pares BTC spot Binance`);
    console.log(` 📈 RSI: Compra ≤ ${RSI_BUY_MAX}, Venda ≥ ${RSI_SELL_MIN}`);
    console.log(` ⚡ Momentum: Detecção ultra-rápida 1m-3m`);
    console.log(` 🎯 BTC Correlation: Prioridade máxima`);
    console.log(` 🚀 Alertas: Performance vs BTC em destaque`);
    console.log(` ⚡ Sensibilidade: Aumentada para sinais rápidos`);

    await sendInitializationMessage(allSymbols);

    let consecutiveErrors = 0;
    let totalSignals = 0;
    let totalAnalysis = 0;
    let totalBTCHighPerformance = 0;
    let lastReportTime = Date.now();

    while (true) {
        try {
            const groupInfo = symbolManager.getNextGroup();

            if (groupInfo.pause > 0) {
                console.log(`⏸️  Pausa estratégica de ${groupInfo.pause / 1000}s...`);
                await new Promise(r => setTimeout(r, groupInfo.pause));
                continue;
            }

            const currentSymbols = groupInfo.symbols;
            if (currentSymbols.length === 0) continue;

            console.log(`\n🔄 Ciclo ${symbolManager.totalCycles}, Grupo ${symbolManager.currentGroupIndex}/${symbolManager.symbolGroups.length}`);
            console.log(`📊 ${currentSymbols.length} pares BTC | Delay: ${symbolManager.getCurrentDelay()}ms`);

            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 10s...');
                await new Promise(r => setTimeout(r, 10000));
                continue;
            }

            const startTime = Date.now();
            const signals = await processSymbolGroup(currentSymbols);
            const endTime = Date.now();

            totalSignals += signals.length;
            symbolManager.signalsDetected += signals.length;

            // Contar sinais com alta performance BTC
            const btcHighPerfSignals = signals.filter(s => 
                s.marketData.btcCorrelation?.performanceLevel === 'STRONG_OUTPERFORMANCE' ||
                s.marketData.btcCorrelation?.performanceLevel === 'STRONG_UNDERPERFORMANCE'
            );
            symbolManager.btcPerformanceSignals += btcHighPerfSignals.length;
            totalBTCHighPerformance += btcHighPerfSignals.length;

            if (signals.length === 0) {
                symbolManager.consecutiveNoSignals++;
            } else {
                symbolManager.consecutiveNoSignals = 0;
            }

            console.log(`✅ ${((endTime - startTime) / 1000).toFixed(1)}s | Sinais: ${signals.length} (BTC High Perf: ${btcHighPerfSignals.length}) | Total: ${totalSignals}`);

            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    await sendSignalAlert(signal);
                    await new Promise(r => setTimeout(r, 600));
                }
            }

            cleanupCaches();

            consecutiveErrors = 0;

            const delay = symbolManager.getCurrentDelay();
            console.log(`⏱️  Próximo grupo em ${delay / 1000}s...\n`);
            await new Promise(r => setTimeout(r, delay));

        } catch (error) {
            consecutiveErrors++;
            console.error(`❌ Erro (${consecutiveErrors}):`, error.message);

            if (consecutiveErrors >= 3) {
                console.log('🔄 Muitos erros. Pausa de 20s...');
                await new Promise(r => setTimeout(r, 20000));
                consecutiveErrors = 0;
            }

            await new Promise(r => setTimeout(r, Math.min(3000 * consecutiveErrors, 20000)));
        }
    }
}

// =====================================================================
// 🎯 FUNÇÃO DE CONTROLE RE()
// =====================================================================

function re() {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 CONTROLE DO BOT TITANIUM SPOT BTC');
    console.log('='.repeat(60));
    console.log('📊 Status atual:');
    console.log('  • RSI: Compra ≤ ' + RSI_BUY_MAX + ', Venda ≥ ' + RSI_SELL_MIN);
    console.log('  • Volume Threshold: ' + VOLUME_SETTINGS.baseThreshold.toFixed(2));
    console.log('  • Quality Threshold: ' + QUALITY_THRESHOLD);
    console.log('  • BTC Correlation Weight: ' + QUALITY_WEIGHTS.btcCorrelation);
    console.log('  • Performance vs BTC Thresholds:');
    console.log('    - Strong Outperform: ' + BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance + '%');
    console.log('    - Moderate Outperform: ' + BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance + '%');
    console.log('    - Strong Underperform: ' + BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance + '%');
    console.log('');
    console.log('⚙️  Configurações de sensibilidade:');
    console.log('  • Scan Interval: ' + (SENSITIVITY_SETTINGS.scanInterval / 1000) + 's');
    console.log('  • Symbol Group Size: ' + SENSITIVITY_SETTINGS.symbolGroupSize);
    console.log('  • Max Consecutive No Signals: ' + SENSITIVITY_SETTINGS.maxConsecutiveNoSignals);
    console.log('');
    console.log('📈 Sistema otimizado para:');
    console.log('  • FOCO MÁXIMO em performance vs BTC');
    console.log('  • Alertas mais rápidos (timeframes menores)');
    console.log('  • Maior sensibilidade a momentum');
    console.log('  • Filtros inteligentes baseados em BTC');
    console.log('='.repeat(60) + '\n');
    
    return {
        rsi_buy_max: RSI_BUY_MAX,
        rsi_sell_min: RSI_SELL_MIN,
        volume_threshold: VOLUME_SETTINGS.baseThreshold,
        quality_threshold: QUALITY_THRESHOLD,
        btc_correlation_weight: QUALITY_WEIGHTS.btcCorrelation,
        btc_strong_outperform: BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance,
        scan_interval: SENSITIVITY_SETTINGS.scanInterval,
        group_size: SENSITIVITY_SETTINGS.symbolGroupSize,
        focus_on_btc: true,
        increased_sensitivity: true
    };
}

// =====================================================================
// 🚀 FUNÇÃO DE INICIALIZAÇÃO DO BOT
// =====================================================================

async function startBot() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 INICIANDO TITANIUM SPOT BTC BOT');
    console.log('='.repeat(60));
    
    try {
        // Verificar se temos conexão com internet
        console.log('🌐 Verificando conexão com Binance...');
        const isConnected = await checkInternetConnection();
        
        if (!isConnected) {
            console.log('❌ Sem conexão com a internet. Verifique sua rede.');
            return;
        }
        
        console.log('✅ Conexão estabelecida!');
        console.log('🎯 Iniciando monitoramento de pares BTC...\n');
        
        // Iniciar o loop principal
        await mainBotLoop();
        
    } catch (error) {
        console.error('❌ ERRO CRÍTICO ao iniciar bot:', error.message);
        console.log('🔄 Reiniciando em 10 segundos...');
        
        setTimeout(() => {
            console.log('🔄 Tentando reiniciar...');
            startBot();
        }, 10000);
    }
}

// Inicializar o bot quando o script for executado
startBot();
