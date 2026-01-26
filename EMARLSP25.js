const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// =====================================================================
// 🛡️ FALLBACK ROBUSTO PARA TECHNICALINDICATORS
// =====================================================================
let technicalIndicators;
try {
    technicalIndicators = require('technicalindicators');
    console.log('✅ technicalindicators carregado com sucesso');
} catch (error) {
    console.error('❌ Erro ao carregar technicalindicators:', error.message);
    console.log('⚠️ Usando fallback para indicadores técnicos');
    
    technicalIndicators = {
        Stochastic: {
            calculate: ({ high, low, close, period, signalPeriod, smooth }) => {
                try {
                    const result = { stochK: [], stochD: [] };
                    const kPeriod = period || 14;
                    const dPeriod = signalPeriod || 3;
                    
                    for (let i = kPeriod - 1; i < close.length; i++) {
                        const periodHigh = Math.max(...high.slice(i - kPeriod + 1, i + 1));
                        const periodLow = Math.min(...low.slice(i - kPeriod + 1, i + 1));
                        
                        if (periodHigh !== periodLow) {
                            const k = ((close[i] - periodLow) / (periodHigh - periodLow)) * 100;
                            result.stochK.push(k);
                        } else {
                            result.stochK.push(50);
                        }
                    }
                    
                    for (let i = dPeriod - 1; i < result.stochK.length; i++) {
                        const d = result.stochK.slice(i - dPeriod + 1, i + 1)
                            .reduce((sum, val) => sum + val, 0) / dPeriod;
                        result.stochD.push(d);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback Stochastic:', error.message);
                    return { stochK: [50], stochD: [50] };
                }
            }
        },
        EMA: {
            calculate: ({ period, values }) => {
                try {
                    if (!values || values.length === 0) return [50];
                    if (values.length < period) return values.map(() => values[0]);
                    
                    const result = [];
                    const multiplier = 2 / (period + 1);
                    let ema = values[0];
                    
                    for (let i = 0; i < values.length; i++) {
                        if (i === 0) {
                            ema = values[i];
                        } else {
                            ema = (values[i] - ema) * multiplier + ema;
                        }
                        result.push(ema);
                    }
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback EMA:', error.message);
                    return values || [50];
                }
            }
        },
        RSI: {
            calculate: ({ values, period }) => {
                try {
                    if (!values || values.length < period + 1) return Array(values.length).fill(50);
                    
                    const result = [];
                    
                    for (let i = period; i < values.length; i++) {
                        let gains = 0;
                        let losses = 0;
                        
                        for (let j = i - period + 1; j <= i; j++) {
                            const diff = values[j] - values[j - 1];
                            if (diff > 0) gains += diff;
                            else losses += Math.abs(diff);
                        }
                        
                        const avgGain = gains / period;
                        const avgLoss = losses / period;
                        
                        if (avgLoss === 0) {
                            result.push(100);
                        } else {
                            const rs = avgGain / avgLoss;
                            result.push(100 - (100 / (1 + rs)));
                        }
                    }
                    
                    return result.length > 0 ? result : [50];
                } catch (error) {
                    console.log('⚠️ Erro no fallback RSI:', error.message);
                    return [50];
                }
            }
        },
        ATR: {
            calculate: ({ high, low, close, period }) => {
                try {
                    if (!high || !low || !close || high.length < 2) return [];
                    
                    const trueRanges = [];
                    for (let i = 1; i < high.length; i++) {
                        const tr1 = high[i] - low[i];
                        const tr2 = Math.abs(high[i] - close[i - 1]);
                        const tr3 = Math.abs(low[i] - close[i - 1]);
                        trueRanges.push(Math.max(tr1, tr2, tr3));
                    }
                    
                    if (trueRanges.length < period) {
                        return [trueRanges[0] || 0];
                    }
                    
                    const result = [];
                    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
                    result.push(atr);
                    
                    for (let i = period; i < trueRanges.length; i++) {
                        atr = ((atr * (period - 1)) + trueRanges[i]) / period;
                        result.push(atr);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback ATR:', error.message);
                    return [0];
                }
            }
        },
        CCI: {
            calculate: ({ high, low, close, period }) => {
                try {
                    if (!high || !low || !close || high.length < period) return [];
                    
                    const result = [];
                    
                    for (let i = period - 1; i < close.length; i++) {
                        const typicalPrices = [];
                        for (let j = i - period + 1; j <= i; j++) {
                            typicalPrices.push((high[j] + low[j] + close[j]) / 3);
                        }
                        
                        const sma = typicalPrices.reduce((sum, price) => sum + price, 0) / period;
                        
                        let meanDeviation = 0;
                        for (let j = 0; j < typicalPrices.length; j++) {
                            meanDeviation += Math.abs(typicalPrices[j] - sma);
                        }
                        meanDeviation /= period;
                        
                        const cci = meanDeviation !== 0 ? 
                            (typicalPrices[typicalPrices.length - 1] - sma) / (0.015 * meanDeviation) : 0;
                        
                        result.push(cci);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback CCI:', error.message);
                    return [];
                }
            }
        }
    };
    console.log('✅ Fallback para indicadores técnicos configurado');
}

const { Stochastic, EMA, RSI, ATR, CCI } = technicalIndicators;

// =====================================================================
// 🛡️ FALLBACK PARA FETCH GLOBAL
// =====================================================================
if (!globalThis.fetch) {
    try {
        globalThis.fetch = fetch;
        console.log('✅ fetch configurado no globalThis');
    } catch (error) {
        console.error('❌ Erro ao configurar fetch:', error.message);
        globalThis.fetch = function() {
            return Promise.reject(new Error('Fetch não disponível'));
        };
    }
}

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const marketDataCache = {};
const orderBookCache = {};
const lsrCache = {};
const fundingCache = {};
const atrCache = {};
const volumeCache = {};
const candlePatternCache = {};
const cciCache = {};
const CANDLE_CACHE_TTL = 45000;
const MARKET_DATA_CACHE_TTL = 30000;
const ORDERBOOK_CACHE_TTL = 20000;
const LSR_CACHE_TTL = 30000;
const FUNDING_CACHE_TTL = 30000;
const ATR_CACHE_TTL = 60000;
const VOLUME_CACHE_TTL = 30000;
const CANDLE_PATTERN_CACHE_TTL = 45000;
const CCI_CACHE_TTL = 300000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

// === CONFIGURAÇÕES PARA DETECÇÃO DE ZONAS ===
const ZONE_SETTINGS = {
    timeframe: '15m',
    lookbackPeriod: 100,
    proximityThreshold: 1.0,
    checkInterval: 30000,
    bidAskZoneSize: 0.25,
    requiredConfirmations: 2,
    maxConcurrentRequests: 3,
    requestTimeout: 30000,
    retryAttempts: 2,
    minBidAskVolume: 0.5,
    supportResistanceLookback: 50
};

// === CONFIGURAÇÕES PARA BTC RELATIVE STRENGTH ===
const BTC_STRENGTH_SETTINGS = {
    btcSymbol: 'BTCUSDT',
    timeframe: '1h',
    lookbackPeriod: 50,
    strengthWeights: {
        priceChange: 0.5,
        volumeRatio: 0.3,
        dominance: 0.2
    },
    threshold: {
        strongBuy: 70,
        moderateBuy: 60,
        neutral: 40,
        moderateSell: 30,
        strongSell: 20
    }
};

// =====================================================================
// 📊 CONFIGURAÇÕES PARA CCI DIÁRIO COM EMA 5
// =====================================================================
const CCI_SETTINGS = {
    period: 20,
    emaPeriod: 5,
    timeframe: '1d',
    requiredCandles: 50,
    confidenceBoost: {
        strong: 15,
        moderate: 10,
        weak: 5
    },
    thresholds: {
        overbought: 100,
        oversold: -100,
        strongTrend: 200,
        weakSignal: 50
    }
};

// =====================================================================
// 🆕 CONFIGURAÇÕES PARA EMA 3 MINUTOS COM SUPORTE/RESISTÊNCIA
// =====================================================================
const EMA_ZONE_SETTINGS = {
    ema13Period: 13,
    ema34Period: 34,
    ema55Period: 55,
    timeframe: '3m',
    requiredCandles: 80,  // ⬇️ REDUZIDO de 100 para 80
    checkInterval: 60000,
    alertCooldown: 15 * 60 * 1000,
    alertGroups: 20,
    zoneProximity: 1.0,
    zoneTimeframe: '15m',
    minZoneStrength: 1,
    requireZoneConfirmation: true,
    maxPairs: 560,
    minVolumeUSD: 50000,
    minPrice: 0.000001,
    atrTimeframe: '15m',
    atrPeriod: 14,
    targetMultipliers: [1, 2, 3],
    stopLossMultiplier: 2,
    minVolatilityPercent: 0.6,
    maxVolatilityPercent: 10,
    requireVolumeSpike: true,
    volumeSpikeMultiplier: 1.6,
    maxAlertsPerHour: 12
};

// =====================================================================
// 🆕 CONFIGURAÇÕES PARA ANÁLISE DE VOLUME 3 MINUTOS
// =====================================================================
const VOLUME_SETTINGS = {
    timeframe: '3m',
    lookbackCandles: 5,
    minVolumeThreshold: 0.8,
    volumeRatioThreshold: 1.5,
    buyPressureThreshold: 60,
    sellPressureThreshold: 60,
    volumeSpikeMultiplier: 2.0,
    accumulationMultiplier: 1.3,
    distributionMultiplier: 1.3
};

// =====================================================================
// 🕯️ CONFIGURAÇÕES PARA PADRÕES DE CANDLES - MOVIDA PARA 15m
// =====================================================================
const CANDLE_PATTERN_SETTINGS = {
    timeframe: '15m',  // ⬅️ MOVIDO de 3m para 15m
    lookbackCandles: 5,
    minBodySizePercent: 0.5,
    minWickRatio: 0.3,
    hammerRatio: 2.0,
    dojiMaxBodyPercent: 0.1,
    engulfingBodyRatio: 1.5,
    morningStarThreshold: 0.3,
    eveningStarThreshold: 0.3
};

// =====================================================================
// 🎯 CONFIGURAÇÕES DE PONTUAÇÃO (SCORE) - ATUALIZADO COM PENALIDADES AGGRESSIVAS
// =====================================================================
const SCORE_SETTINGS = {
    baseScore: 35,
    minConfidence: 75,
    
    points: {
        // Critérios estruturais
        zoneStrength: 6,
        volatilityOk: 8,
        volumeSpikeOk: 8,
        volumeDominance: 10,
        volumePressure: 6,
        priceAboveBelowEMA55: 10,
        
        // CCI
        cciStrong: 12,
        cciModerate: 8,
        cciWeak: 4,
        cciTrend: 4,
        
        // LSR (com penalização AUMENTADA)
        lsrBuyFavorable: 8,
        lsrSellFavorable: 8,
        lsrNeutral: 0,
        lsrUnfavorable: -15,  // ⬆️ AUMENTADO de -10 para -15
        
        // RSI (com penalização AUMENTADA)
        rsiBuyZone: 6,
        rsiSellZone: 6,
        rsiNeutral: 0,
        rsiOverboughtInBuy: -18,  // ⬆️ AUMENTADO de -12 para -18
        rsiOversoldInSell: -18,   // ⬆️ AUMENTADO de -12 para -18
        
        // Padrões de candle (penalidade AUMENTADA quando não tem confirmação)
        candlePatternStrong: 10,
        candlePatternModerate: 6,
        candlePatternWeak: 3,
        noCandleConfirmation: -12,  // ⬆️ AUMENTADO de -8 para -12
        
        // Novas penalidades
        lowVolumeInSpike: -15,
        btcCorrelationNegative: -10,
        
        // Penalidade LSR extrema
        lsrExtremeUnfavorable: -18  // ⬆️ NOVO: Penalidade para LSR >3.5 em COMPRA ou <2.3 em VENDA
    },
    
    blockers: {
        requireVolatility: true,
        requireVolumeSpike: true,
        cciExtremeBlock: true  // ⬆️ NOVO: Bloqueio para CCI diário extremo
    }
};

// =====================================================================
// 🆕 COOLDOWN POR ZONA
// =====================================================================
const ZONE_COOLDOWN_MINUTES = 30;
const zoneCooldownMap = new Map();

// =====================================================================
// 🔄 CIRCUIT BREAKER CLASS
// =====================================================================
class CircuitBreaker {
    constructor() {
        try {
            this.state = 'CLOSED';
            this.failureCount = 0;
            this.successCount = 0;
            this.lastFailureTime = null;
            this.resetTimeout = 120000;
            this.failureThreshold = 5;
            this.halfOpenMaxRequests = 2;
            this.consecutive429s = 0;
            this.last429Time = null;
            console.log('✅ CircuitBreaker inicializado');
        } catch (error) {
            console.error('❌ Erro ao inicializar CircuitBreaker:', error.message);
            this.state = 'CLOSED';
            this.failureCount = 0;
            this.successCount = 0;
        }
    }

    canExecute() {
        try {
            const now = Date.now();

            if (this.consecutive429s >= 3 && this.last429Time && (now - this.last429Time) < 60000) {
                return false;
            }

            switch (this.state) {
                case 'CLOSED':
                    return true;
                case 'OPEN':
                    if (this.lastFailureTime && (now - this.lastFailureTime) >= this.resetTimeout) {
                        this.state = 'HALF_OPEN';
                        this.successCount = 0;
                        return true;
                    }
                    return false;
                case 'HALF_OPEN':
                    if (this.successCount >= this.halfOpenMaxRequests) {
                        this.state = 'CLOSED';
                        this.failureCount = 0;
                        this.consecutive429s = 0;
                    }
                    return this.successCount < this.halfOpenMaxRequests;
                default:
                    return false;
            }
        } catch (error) {
            console.error('❌ Erro em canExecute:', error.message);
            return true;
        }
    }

    recordSuccess() {
        try {
            if (this.state === 'HALF_OPEN') {
                this.successCount++;
            } else if (this.state === 'CLOSED') {
                this.failureCount = Math.max(0, this.failureCount - 1);
            }
            this.consecutive429s = 0;
        } catch (error) {
            console.error('❌ Erro em recordSuccess:', error.message);
        }
    }

    recordFailure(error) {
        try {
            this.failureCount++;
            this.lastFailureTime = Date.now();

            if (error && error.message && error.message.includes('429')) {
                this.consecutive429s++;
                this.last429Time = Date.now();
            } else {
                this.consecutive429s = 0;
            }

            if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
                this.state = 'OPEN';
            } else if (this.state === 'HALF_OPEN') {
                this.state = 'OPEN';
            }
        } catch (error) {
            console.error('❌ Erro em recordFailure:', error.message);
        }
    }

    getStatus() {
        try {
            return {
                state: this.state,
                failureCount: this.failureCount,
                successCount: this.successCount,
                consecutive429s: this.consecutive429s,
                lastFailureTime: this.lastFailureTime,
                canExecute: this.canExecute()
            };
        } catch (error) {
            console.error('❌ Erro em getStatus:', error.message);
            return { state: 'CLOSED', canExecute: true };
        }
    }
}

// =====================================================================
// 🚀 RATE LIMITER ROBUSTO PARA 560+ PARES - OTIMIZADO
// =====================================================================
class IntelligentRateLimiter {
    constructor() {
        try {
            this.minuteWindow = { start: Date.now(), usedWeight: 0, capacity: 2400 };
            this.secondWindow = { start: Date.now(), usedWeight: 0, capacity: 100 };
            this.dailyWindow = { start: Date.now(), usedWeight: 0, capacity: 300000 };
            
            this.circuitBreaker = new CircuitBreaker();
            
            this.requestQueue = [];
            this.priorityQueue = [];
            this.isProcessing = false;
            
            this.totalRequests = 0;
            this.failedRequests = 0;
            this.successfulRequests = 0;
            this.lastStatusLog = Date.now();
            this.lastRateAdjustment = Date.now();
            
            this.baseDelay = 150;
            this.currentDelay = 150;
            this.minDelay = 80;    // ⬇️ Reduzido para maior velocidade
            this.maxDelay = 3000;
            
            // ⬇️ OTIMIZADO: Configurações para reduzir carga em volatilidade alta
            this.endpointWeights = {
                'klines': 1,
                'depth': 2,
                'ticker': 1,
                'ticker24hr': 1,
                'exchangeInfo': 10,
                'globalLongShort': 1,
                'fundingRate': 1,
                'ping': 0
            };
            
            this.burstMode = false;
            this.burstEndTime = 0;
            this.burstRequestCount = 0;
            
            this.priorityLevels = {
                HIGH: 1,
                MEDIUM: 2,
                LOW: 3
            };
            
            // ⬆️ NOVO: Contador de requests por minuto para detecção de picos
            this.requestsPerMinute = [];
            this.peakDetectionThreshold = 150; // Limite de requests/min para entrar em modo conservador
            
            console.log('🚀 Rate Limiter Inteligente OTIMIZADO para 560+ pares');
        } catch (error) {
            console.error('❌ Erro ao inicializar RateLimiter:', error.message);
            this.circuitBreaker = { canExecute: () => true };
            this.endpointWeights = { 'default': 1 };
            this.currentDelay = 500;
        }
    }

    async makeRequest(url, options = {}, endpointType = 'klines', priority = 'MEDIUM') {
        try {
            const weight = this.endpointWeights[endpointType] || 1;
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            return new Promise((resolve, reject) => {
                try {
                    const request = {
                        id: requestId,
                        url,
                        options,
                        weight,
                        endpointType,
                        priority: this.priorityLevels[priority] || 2,
                        resolve,
                        reject,
                        timestamp: Date.now(),
                        retryCount: 0,
                        timeout: ZONE_SETTINGS.requestTimeout || 15000,
                        addedAt: Date.now()
                    };

                    if (priority === 'HIGH') {
                        this.priorityQueue.push(request);
                    } else {
                        this.requestQueue.push(request);
                    }
                    
                    this.totalRequests++;

                    if (!this.isProcessing) {
                        this.processQueues();
                    }

                    setTimeout(() => {
                        try {
                            this.removeRequestFromQueues(requestId);
                            this.failedRequests++;
                            reject(new Error(`Request timeout após ${request.timeout}ms: ${url}`));
                        } catch (err) {
                            reject(new Error(`Erro no timeout: ${err.message}`));
                        }
                    }, request.timeout);
                } catch (error) {
                    reject(new Error(`Erro ao criar request: ${error.message}`));
                }
            });
        } catch (error) {
            console.error('❌ Erro em makeRequest:', error.message);
            throw error;
        }
    }

    removeRequestFromQueues(requestId) {
        try {
            const removeFromQueue = (queue) => {
                const index = queue.findIndex(req => req && req.id === requestId);
                if (index !== -1) {
                    queue.splice(index, 1);
                    return true;
                }
                return false;
            };
            
            removeFromQueue(this.priorityQueue) || removeFromQueue(this.requestQueue);
        } catch (error) {
            console.error('❌ Erro em removeRequestFromQueues:', error.message);
        }
    }

    async processQueues() {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        
        try {
            while (this.priorityQueue.length > 0 || this.requestQueue.length > 0) {
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(5000);
                    continue;
                }

                let request;
                if (this.priorityQueue.length > 0) {
                    request = this.priorityQueue.shift();
                } else {
                    request = this.requestQueue.shift();
                }
                
                if (!request) {
                    await this.delay(100);
                    continue;
                }

                if (!this.checkLimits(request.weight)) {
                    if (request.priority === 1) {
                        this.priorityQueue.unshift(request);
                    } else {
                        this.requestQueue.unshift(request);
                    }
                    
                    await this.waitForLimits(request.weight);
                    continue;
                }

                try {
                    const result = await this.executeRequest(request);
                    request.resolve(result);
                    this.circuitBreaker.recordSuccess();
                    this.successfulRequests++;
                    this.adjustDelayBasedOnUsage();
                    
                } catch (error) {
                    request.reject(error);
                    this.circuitBreaker.recordFailure(error);
                    this.failedRequests++;
                    
                    if (request.retryCount < ZONE_SETTINGS.retryAttempts) {
                        request.retryCount++;
                        request.timeout = Math.min(30000, request.timeout * 1.5);
                        
                        if (request.priority === 1) {
                            this.priorityQueue.unshift(request);
                        } else {
                            this.requestQueue.unshift(request);
                        }
                        
                        await this.delay(2000 * request.retryCount);
                    }
                }

                await this.delay(this.currentDelay);
                
                if (this.totalRequests % 10 === 0) {
                    await this.delay(10);
                }
            }
        } catch (error) {
            console.error('❌ Erro em processQueues:', error.message);
        } finally {
            this.isProcessing = false;
        }

        if (Date.now() - this.lastStatusLog >= 30000) {
            this.logStatus();
            this.lastStatusLog = Date.now();
        }
    }

    checkLimits(weight) {
        try {
            const now = Date.now();
            
            if (now - this.minuteWindow.start >= 60000) {
                this.minuteWindow = { start: now, usedWeight: 0, capacity: 2400 };
            }
            
            if (now - this.secondWindow.start >= 1000) {
                this.secondWindow = { start: now, usedWeight: 0, capacity: 100 };
            }
            
            if (now - this.dailyWindow.start >= 86400000) {
                this.dailyWindow = { start: now, usedWeight: 0, capacity: 300000 };
            }
            
            const minuteUsage = (this.minuteWindow.usedWeight + weight) / this.minuteWindow.capacity;
            const secondUsage = (this.secondWindow.usedWeight + weight) / this.secondWindow.capacity;
            const dailyUsage = (this.dailyWindow.usedWeight + weight) / this.dailyWindow.capacity;
            
            if (this.burstMode && now < this.burstEndTime) {
                return minuteUsage < 0.95 && secondUsage < 0.9;
            }
            
            // ⬆️ NOVO: Detecção de pico - se requests/min muito alto, limita mais
            const currentMinuteRequests = this.requestsPerMinute.filter(
                reqTime => now - reqTime < 60000
            ).length;
            
            if (currentMinuteRequests > this.peakDetectionThreshold) {
                return minuteUsage < 0.6 && secondUsage < 0.5;
            }
            
            return minuteUsage < 0.8 && secondUsage < 0.75 && dailyUsage < 0.9;
        } catch (error) {
            console.error('❌ Erro em checkLimits:', error.message);
            return true;
        }
    }

    adjustDelayBasedOnUsage() {
        try {
            const now = Date.now();
            const minuteUsage = this.minuteWindow.usedWeight / this.minuteWindow.capacity;
            
            // ⬆️ NOVO: Detecção de pico por requests/min
            this.requestsPerMinute.push(now);
            // Limpa registros antigos
            this.requestsPerMinute = this.requestsPerMinute.filter(
                reqTime => now - reqTime < 60000
            );
            
            const currentRequestsPerMinute = this.requestsPerMinute.length;
            
            if (currentRequestsPerMinute > this.peakDetectionThreshold) {
                // Modo conservador em picos
                this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 1.5);
                this.burstMode = false;
                console.log(`⚡ Modo conservador: ${currentRequestsPerMinute} req/min`);
            } else if (minuteUsage > 0.7) {
                this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 1.3);
                this.burstMode = false;
            } else if (minuteUsage < 0.3 && now - this.lastRateAdjustment > 30000) {
                this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.9);
                this.lastRateAdjustment = now;
                
                if (minuteUsage < 0.2 && !this.burstMode) {
                    this.burstMode = true;
                    this.burstEndTime = now + 10000;
                    this.burstRequestCount = 0;
                }
            }
            
            if (this.burstMode && now >= this.burstEndTime) {
                this.burstMode = false;
                this.currentDelay = this.baseDelay;
            }
        } catch (error) {
            console.error('❌ Erro em adjustDelayBasedOnUsage:', error.message);
        }
    }

    async waitForLimits(weight) {
        try {
            const now = Date.now();
            
            const minuteRemaining = 60000 - (now - this.minuteWindow.start);
            const secondRemaining = 1000 - (now - this.secondWindow.start);
            
            const minuteUsage = this.minuteWindow.usedWeight / this.minuteWindow.capacity;
            const secondUsage = this.secondWindow.usedWeight / this.secondWindow.capacity;
            
            let waitTime = this.currentDelay * 3;
            
            if (minuteUsage > 0.85) {
                waitTime = Math.max(waitTime, minuteRemaining + 2000);
            } else if (secondUsage > 0.8) {
                waitTime = Math.max(waitTime, secondRemaining + 1000);
            }
            
            await this.delay(waitTime);
        } catch (error) {
            console.error('❌ Erro em waitForLimits:', error.message);
            await this.delay(1000);
        }
    }

    async executeRequest(request) {
        for (let attempt = 0; attempt <= request.retryCount + 1; attempt++) {
            try {
                if (attempt > 0) {
                    await this.delay(3000 * Math.pow(1.5, attempt - 1));
                }

                this.updateCounters(request.weight);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), request.timeout);

                const response = await fetch(request.url, {
                    ...request.options,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
                }

                const data = await response.json();
                
                if (data.code && data.code !== 200) {
                    throw new Error(`API Error ${data.code}: ${data.msg || 'Unknown error'}`);
                }

                return data;

            } catch (error) {
                if (attempt === (request.retryCount + 1)) {
                    throw error;
                }
                
                if (error.name === 'AbortError') {
                    request.timeout = Math.min(45000, request.timeout * 1.5);
                }
                
                if (error.message && error.message.includes('429')) {
                    this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
                    await this.delay(5000);
                }
            }
        }
    }

    updateCounters(weight) {
        try {
            const now = Date.now();
            
            if (now - this.minuteWindow.start >= 60000) {
                this.minuteWindow = { start: now, usedWeight: 0, capacity: 2400 };
            }
            
            if (now - this.secondWindow.start >= 1000) {
                this.secondWindow = { start: now, usedWeight: 0, capacity: 100 };
            }
            
            if (now - this.dailyWindow.start >= 86400000) {
                this.dailyWindow = { start: now, usedWeight: 0, capacity: 300000 };
            }
            
            this.minuteWindow.usedWeight += weight;
            this.secondWindow.usedWeight += weight;
            this.dailyWindow.usedWeight += weight;
            
            if (this.burstMode) {
                this.burstRequestCount++;
            }
        } catch (error) {
            console.error('❌ Erro em updateCounters:', error.message);
        }
    }

    delay(ms) {
        return new Promise(resolve => {
            try {
                setTimeout(resolve, ms);
            } catch (error) {
                console.error('❌ Erro em delay:', error.message);
                resolve();
            }
        });
    }

    logStatus() {
        try {
            const minuteUsage = (this.minuteWindow.usedWeight / this.minuteWindow.capacity * 100).toFixed(1);
            const secondUsage = (this.secondWindow.usedWeight / this.secondWindow.capacity * 100).toFixed(1);
            const successRate = this.totalRequests > 0 ? 
                ((this.successfulRequests / this.totalRequests) * 100).toFixed(1) : 100;
            
            const queueSize = this.priorityQueue.length + this.requestQueue.length;
            const avgDelay = this.currentDelay;
            
            const requestsPerMinute = this.requestsPerMinute.filter(
                reqTime => Date.now() - reqTime < 60000
            ).length;
            
            console.log(`📊 Rate Limit: ${minuteUsage}% min | ${secondUsage}% seg | Delay: ${avgDelay}ms`);
            console.log(`📈 Queue: ${queueSize} | Sucesso: ${successRate}% | Req/min: ${requestsPerMinute}`);
            console.log(`🔄 Estado: ${this.burstMode ? 'BURST' : 'NORMAL'} | Circuit: ${this.circuitBreaker.state}`);
        } catch (error) {
            console.error('❌ Erro em logStatus:', error.message);
        }
    }

    getStats() {
        try {
            const now = Date.now();
            const requestsPerMinute = this.requestsPerMinute.filter(
                reqTime => now - reqTime < 60000
            ).length;
            
            return {
                totalRequests: this.totalRequests,
                successfulRequests: this.successfulRequests,
                failedRequests: this.failedRequests,
                successRate: this.totalRequests > 0 ? (this.successfulRequests / this.totalRequests * 100).toFixed(2) : 100,
                currentDelay: this.currentDelay,
                minuteUsage: (this.minuteWindow.usedWeight / this.minuteWindow.capacity * 100).toFixed(2),
                secondUsage: (this.secondWindow.usedWeight / this.secondWindow.capacity * 100).toFixed(2),
                queueSize: this.priorityQueue.length + this.requestQueue.length,
                circuitBreakerState: this.circuitBreaker.state || 'CLOSED',
                burstMode: this.burstMode,
                requestsPerMinute: requestsPerMinute
            };
        } catch (error) {
            console.error('❌ Erro em getStats:', error.message);
            return { successRate: 0, currentDelay: 500 };
        }
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
    try {
        const now = new Date();
        const offset = -3;
        const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);

        const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
        const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

        return { date, time, full: `${date} ${time}` };
    } catch (error) {
        console.error('❌ Erro em getBrazilianDateTime:', error.message);
        return { date: '01/01/2024', time: '00:00', full: '01/01/2024 00:00' };
    }
}

function getBrazilianDateTimeFromTimestamp(timestamp) {
    try {
        const date = new Date(timestamp);
        const offset = -3;
        const brazilTime = new Date(date.getTime() + offset * 60 * 60 * 1000);

        const dateStr = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
        const timeStr = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

        return { date: dateStr, time: timeStr, full: `${dateStr} ${timeStr}` };
    } catch (error) {
        console.error('❌ Erro em getBrazilianDateTimeFromTimestamp:', error.message);
        return { date: '01/01/2024', time: '00:00', full: '01/01/2024 00:00' };
    }
}

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }

        console.log('✅ Mensagem enviada para Telegram');
        logToFile(`📤 Alerta enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA OBTER DADOS DO MERCADO
// =====================================================================
let rateLimiter;
try {
    rateLimiter = new IntelligentRateLimiter();
    console.log('✅ RateLimiter OTIMIZADO inicializado');
} catch (error) {
    console.error('❌ Erro ao inicializar RateLimiter:', error.message);
    rateLimiter = {
        makeRequest: async (url, options, endpointType, priority) => {
            try {
                const response = await fetch(url, options);
                return await response.json();
            } catch (error) {
                throw error;
            }
        },
        getStats: () => ({ successRate: 0, currentDelay: 1000 })
    };
}

async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando TODOS os pares Futures da Binance...');
        
        const exchangeInfo = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo',
            'HIGH'
        );
        
        if (!exchangeInfo || !exchangeInfo.symbols) {
            console.log('❌ Não foi possível obter informações da exchange');
            return getDefaultSymbols();
        }
        
        console.log(`📊 ${exchangeInfo.symbols.length} símbolos encontrados na exchange`);
        
        const usdtSymbols = exchangeInfo.symbols.filter(symbol => {
            return symbol.quoteAsset === 'USDT' && 
                   symbol.status === 'TRADING' &&
                   symbol.contractType === 'PERPETUAL';
        });
        
        console.log(`📊 ${usdtSymbols.length} pares USDT Perpetual em trading`);
        
        const allTickers = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/ticker/24hr',
            {},
            'ticker24hr',
            'MEDIUM'
        );
        
        const tickerMap = {};
        if (allTickers && Array.isArray(allTickers)) {
            allTickers.forEach(ticker => {
                tickerMap[ticker.symbol] = {
                    quoteVolume: parseFloat(ticker.quoteVolume) || 0,
                    lastPrice: parseFloat(ticker.lastPrice) || 0,
                    priceChangePercent: parseFloat(ticker.priceChangePercent) || 0
                };
            });
        }
        
        const symbolsWithData = [];
        
        for (const symbolInfo of usdtSymbols) {
            const symbol = symbolInfo.symbol;
            
            try {
                const excludedTerms = ['BULL', 'BEAR', 'UP', 'DOWN', 'EUR', 'GBP', 'JPY', 'AUD', 'BRL'];
                if (excludedTerms.some(term => symbol.includes(term))) continue;
                
                const tickerData = tickerMap[symbol];
                if (!tickerData) continue;
                
                const quoteVolume = tickerData.quoteVolume;
                const lastPrice = tickerData.lastPrice;
                const priceChangePercent = Math.abs(tickerData.priceChangePercent);
                
                if (quoteVolume >= EMA_ZONE_SETTINGS.minVolumeUSD && 
                    lastPrice >= EMA_ZONE_SETTINGS.minPrice &&
                    priceChangePercent < 100) {
                    
                    symbolsWithData.push({
                        symbol: symbol,
                        volume: quoteVolume,
                        price: lastPrice,
                        priceChange: tickerData.priceChangePercent,
                        trades: 0
                    });
                }
            } catch (error) {
                console.log(`⚠️ Erro processando símbolo ${symbol}:`, error.message);
                continue;
            }
        }
        
        console.log(`✅ ${symbolsWithData.length} pares USDT com volume suficiente`);
        
        symbolsWithData.sort((a, b) => b.volume - a.volume);
        
        const selectedSymbols = symbolsWithData
            .slice(0, EMA_ZONE_SETTINGS.maxPairs)
            .map(item => item.symbol);
        
        console.log(`\n📊 ${selectedSymbols.length} PARES SELECIONADOS:`);
        
        const volumeCategories = [
            { name: 'Top 20 (Mega Liquidez)', range: [0, 20] },
            { name: '21-100 (Alta Liquidez)', range: [20, 100] },
            { name: '101-300 (Liquidez Média)', range: [100, 300] },
            { name: '301-560+ (Baixa Liquidez)', range: [300, selectedSymbols.length] }
        ];
        
        let totalVolume = 0;
        
        for (const category of volumeCategories) {
            const [start, end] = category.range;
            const categorySymbols = selectedSymbols.slice(start, end);
            
            if (categorySymbols.length > 0) {
                const categoryVolume = symbolsWithData
                    .slice(start, end)
                    .reduce((sum, item) => sum + item.volume, 0);
                
                totalVolume += categoryVolume;
                
                console.log(`\n${category.name}:`);
                console.log(`  Exemplos: ${categorySymbols.slice(0, 5).join(', ')}${categorySymbols.length > 5 ? '...' : ''}`);
                console.log(`  Pares: ${categorySymbols.length} | Volume: $${(categoryVolume / 500000).toFixed(1)}M`);
            }
        }
        
        console.log(`\n💰 Volume total 24h monitorado: $${(totalVolume / 500000).toFixed(1)}M`);
        console.log(`🎯 Monitorando ${selectedSymbols.length} pares (máximo: ${EMA_ZONE_SETTINGS.maxPairs})`);
        
        return selectedSymbols;
        
    } catch (error) {
        console.log('❌ Erro ao buscar todos os símbolos:', error.message);
        console.log('⚠️ Usando lista de fallback com 100 pares');
        return getDefaultSymbols().slice(0, 100);
    }
}

function getDefaultSymbols() {
    try {
        return [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 
            'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'TRXUSDT',
            'SHIBUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT', 'ETCUSDT',
            'FILUSDT', 'APTUSDT', 'ARBUSDT', 'NEARUSDT', 'VETUSDT', 'OPUSDT',
            'AAVEUSDT', 'ALGOUSDT', 'GRTUSDT', 'QNTUSDT', 'EOSUSDT', 'XMRUSDT',
            'SNXUSDT', 'RNDRUSDT', 'IMXUSDT', 'FTMUSDT', 'APEUSDT', 'SANDUSDT',
            'AXSUSDT', 'EGLDUSDT', 'MANAUSDT', 'THETAUSDT', 'XTZUSDT', 'CHZUSDT',
            'FLOWUSDT', 'CRVUSDT', 'KLAYUSDT', 'GALAUSDT', 'ONEUSDT', 'LDOUSDT',
            'ENSUSDT', 'MKRUSDT', 'STXUSDT', 'DASHUSDT', 'ENJUSDT', 'COMPUSDT',
            'ZECUSDT', 'WAVESUSDT', 'OMGUSDT', 'ICXUSDT', 'ANKRUSDT', 'RVNUSDT',
            'ZILUSDT', 'SCUSDT', 'STORJUSDT', 'KAVAUSDT', 'RENUSDT', 'RSRUSDT',
            'CTKUSDT', 'TOMOUSDT', 'PERPUSDT', 'TRBUSDT', 'BATUSDT', 'CREAMUSDT',
            'CELRUSDT', 'HOTUSDT', 'MTLUSDT', 'CHRUSDT', 'ARPAUSDT', 'BANDUSDT',
            'RLCUSDT', 'WRXUSDT', 'VGXUSDT', 'FETUSDT', 'CVCUSDT', 'AGLDUSDT',
            'NKNUSDT', 'ROSEUSDT', 'AVAUSDT', 'FIOUSDT', 'ALICEUSDT', 'APEUSDT'
        ];
    } catch (error) {
        console.error('❌ Erro em getDefaultSymbols:', error.message);
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function getCandlesCached(symbol, timeframe, limit = 80) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();

        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }

        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h',
            '12h': '12h', '1d': '1d'
        };

        const interval = intervalMap[timeframe] || '15m';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 100)}`;

        const data = await rateLimiter.makeRequest(url, {}, 'klines', 'HIGH');

        if (!data || !Array.isArray(data)) {
            console.log(`⚠️ Dados de candles inválidos para ${symbol}`);
            return [];
        }

        const candles = data.map(candle => ({
            open: parseFloat(candle[1]) || 0,
            high: parseFloat(candle[2]) || 0,
            low: parseFloat(candle[3]) || 0,
            close: parseFloat(candle[4]) || 0,
            volume: parseFloat(candle[5]) || 0,
            quoteVolume: parseFloat(candle[7]) || 0,
            trades: parseFloat(candle[8]) || 0,
            time: candle[0] || Date.now()
        }));

        candleCache[cacheKey] = { data: candles, timestamp: now };
        return candles;
    } catch (error) {
        console.log(`⚠️ Erro candles ${symbol}: ${error.message}`);
        return [];
    }
}

async function getMarketData(symbol) {
    try {
        const cacheKey = `market_${symbol}`;
        const now = Date.now();

        if (marketDataCache[cacheKey] && now - marketDataCache[cacheKey].timestamp < MARKET_DATA_CACHE_TTL) {
            return marketDataCache[cacheKey].data;
        }

        const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;

        const data = await rateLimiter.makeRequest(url, {}, 'ticker', 'MEDIUM');

        if (!data) {
            console.log(`⚠️ Dados de mercado inválidos para ${symbol}`);
            return null;
        }

        const marketData = {
            priceChange: parseFloat(data.priceChange) || 0,
            priceChangePercent: parseFloat(data.priceChangePercent) || 0,
            weightedAvgPrice: parseFloat(data.weightedAvgPrice) || 0,
            lastPrice: parseFloat(data.lastPrice) || 0,
            volume: parseFloat(data.volume) || 0,
            quoteVolume: parseFloat(data.quoteVolume) || 0,
            highPrice: parseFloat(data.highPrice) || 0,
            lowPrice: parseFloat(data.lowPrice) || 0,
            openPrice: parseFloat(data.openPrice) || 0,
            prevClosePrice: parseFloat(data.prevClosePrice) || 0
        };

        marketDataCache[cacheKey] = { data: marketData, timestamp: now };
        return marketData;
    } catch (error) {
        console.log(`⚠️ Erro market data ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA LSR E FUNDING RATE
// =====================================================================
async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        if (lsrCache[cacheKey] && now - lsrCache[cacheKey].timestamp < LSR_CACHE_TTL) {
            return lsrCache[cacheKey].data;
        }
        
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const response = await rateLimiter.makeRequest(url, {}, 'globalLongShort', 'LOW');
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            console.log(`⚠️ Resposta da API LSR vazia para ${symbol}.`);
            return null;
        }
        
        const latestData = response[0];
        
        if (!latestData.longShortRatio || !latestData.longAccount || !latestData.shortAccount) {
            console.log(`⚠️ Estrutura de dados LSR inesperada para ${symbol}:`, latestData);
            return null;
        }
        
        const currentLSR = parseFloat(latestData.longShortRatio);
        
        let percentChange = '0.00';
        let isRising = false;
        
        if (response.length >= 2) {
            const previousData = response[1];
            const previousLSR = parseFloat(previousData.longShortRatio);
            
            if (previousLSR !== 0) {
                percentChange = ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2);
                isRising = currentLSR > previousLSR;
            }
        }
        
        const result = {
            lsrValue: currentLSR,
            longAccount: parseFloat(latestData.longAccount),
            shortAccount: parseFloat(latestData.shortAccount),
            percentChange: percentChange,
            isRising: isRising,
            timestamp: latestData.timestamp,
            raw: latestData
        };
        
        lsrCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Binance LSR ${symbol} (${period}): ${result.lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar LSR da Binance para ${symbol}:`, error.message);
        return null;
    }
}

async function checkFundingRate(symbol) {
    try {
        const cacheKey = `funding_${symbol}`;
        const now = Date.now();
        
        if (fundingCache[cacheKey] && now - fundingCache[cacheKey].timestamp < FUNDING_CACHE_TTL) {
            return fundingCache[cacheKey].data;
        }

        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`,
            {},
            'fundingRate',
            'LOW'
        );

        if (!data || data.length === 0) {
            return { 
                raw: 0,
                emoji: '⚪',
                text: 'Indisponível',
                percentage: '0.00000'
            };
        }

        const fundingRate = parseFloat(data[0].fundingRate) || 0;
        
        let fundingRateEmoji = '';
        if (fundingRate <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (fundingRate <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (fundingRate <= -0.0005) fundingRateEmoji = '🟢';
        else if (fundingRate >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (fundingRate >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (fundingRate >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
        
        const fundingRateText = fundingRate !== 0
            ? `${fundingRateEmoji} ${(fundingRate * 100).toFixed(5)}%`
            : 'Indisponível';
        
        const result = {
            raw: fundingRate,
            emoji: fundingRateEmoji,
            text: fundingRateText,
            percentage: (fundingRate * 100).toFixed(5)
        };
        
        fundingCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
    } catch (error) {
        console.log(`⚠️ Erro funding rate ${symbol}: ${error.message}`);
        return { 
            raw: 0,
            emoji: '⚪',
            text: 'Indisponível',
            percentage: '0.00000'
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR BTC RELATIVE STRENGTH
// =====================================================================
async function calculateBTCRelativeStrength(symbol) {
    try {
        if (symbol === 'BTCUSDT') {
            return {
                score: 50,
                status: 'BTC BASE',
                emoji: '⚪',
                strength: 'NEUTRAL'
            };
        }
        
        const [btcCandles, symbolCandles] = await Promise.all([
            getCandlesCached('BTCUSDT', '1h', 50),
            getCandlesCached(symbol, '1h', 50)
        ]);
        
        if (!btcCandles || !symbolCandles || btcCandles.length < 20 || symbolCandles.length < 20) {
            return null;
        }
        
        const btcLastPrice = btcCandles[btcCandles.length - 1].close;
        const btcFirstPrice = btcCandles[0].close;
        const btcChangePercent = ((btcLastPrice - btcFirstPrice) / btcFirstPrice) * 100;
        
        const symbolLastPrice = symbolCandles[symbolCandles.length - 1].close;
        const symbolFirstPrice = symbolCandles[0].close;
        const symbolChangePercent = ((symbolLastPrice - symbolFirstPrice) / symbolFirstPrice) * 100;
        
        const relativeStrength = symbolChangePercent - btcChangePercent;
        
        let status = 'NEUTRAL';
        let emoji = '⚪';
        let strength = 'NEUTRAL';
        
        if (relativeStrength > 20) {
            status = 'MUITO FORTE vs BTC';
            emoji = '🟢🟢🟢';
            strength = 'VERY_STRONG';
        } else if (relativeStrength > 10) {
            status = 'FORTE vs BTC';
            emoji = '🟢🟢';
            strength = 'STRONG';
        } else if (relativeStrength > 5) {
            status = 'MODERADA vs BTC';
            emoji = '🟢';
            strength = 'MODERATE';
        } else if (relativeStrength < -20) {
            status = 'MUITO FRACA vs BTC';
            emoji = '🔴🔴🔴';
            strength = 'VERY_WEAK';
        } else if (relativeStrength < -10) {
            status = 'FRACA vs BTC';
            emoji = '🔴🔴';
            strength = 'WEAK';
        } else if (relativeStrength < -5) {
            status = 'LEVE vs BTC';
            emoji = '🔴';
            strength = 'SLIGHT_WEAK';
        }
        
        return {
            score: 50 + relativeStrength / 2,
            status: status,
            emoji: emoji,
            strength: strength,
            relativeStrength: relativeStrength.toFixed(2),
            btcChange: btcChangePercent.toFixed(2),
            symbolChange: symbolChangePercent.toFixed(2)
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular força relativa BTC ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR CCI (20 PERÍODOS) COM EMA 5 (DIÁRIO) - COM BLOQUEIO EXTREMO
// =====================================================================
async function calculateCCIDaily(symbol) {
    try {
        const cacheKey = `cci_daily_${symbol}`;
        const now = Date.now();
        
        if (cciCache[cacheKey] && now - cciCache[cacheKey].timestamp < CCI_CACHE_TTL) {
            return cciCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, CCI_SETTINGS.timeframe, CCI_SETTINGS.requiredCandles);
        
        if (candles.length < CCI_SETTINGS.period + 10) {
            console.log(`⚠️ ${symbol}: Dados insuficientes para CCI diário`);
            return null;
        }
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: high,
            low: low,
            close: close,
            period: CCI_SETTINGS.period
        });
        
        if (!cciValues || cciValues.length < CCI_SETTINGS.emaPeriod + 5) {
            return null;
        }
        
        const cciEmaValues = EMA.calculate({
            period: CCI_SETTINGS.emaPeriod,
            values: cciValues
        });
        
        const currentCCI = cciValues[cciValues.length - 1];
        const previousCCI = cciValues[cciValues.length - 2];
        const currentCCI_EMA = cciEmaValues[cciEmaValues.length - 1];
        const previousCCI_EMA = cciEmaValues[cciEmaValues.length - 2];
        
        const cciAboveEMA = currentCCI > currentCCI_EMA;
        const previousCCIAboveEMA = previousCCI > previousCCI_EMA;
        const cciBelowEMA = currentCCI < currentCCI_EMA;
        const previousCCIBelowEMA = previousCCI < previousCCI_EMA;
        
        let crossoverSignal = null;
        
        if (cciAboveEMA && !previousCCIAboveEMA) {
            crossoverSignal = {
                type: 'COMPRA',
                strength: 'CROSSOVER_UP',
                message: `CCI (${currentCCI.toFixed(2)}) ⤴️ (${currentCCI_EMA.toFixed(2)})`
            };
        }
        else if (cciBelowEMA && !previousCCIBelowEMA) {
            crossoverSignal = {
                type: 'VENDA',
                strength: 'CROSSOVER_DOWN',
                message: `CCI (${currentCCI.toFixed(2)}) ⤵️ (${currentCCI_EMA.toFixed(2)})`
            };
        }
        
        let signalStrength = 'NONE';
        let confidenceBoost = 0;
        let cciStatus = 'NEUTRAL';
        let cciEmoji = '⚪';
        
        if (crossoverSignal) {
            if (Math.abs(currentCCI) > CCI_SETTINGS.thresholds.strongTrend) {
                signalStrength = 'STRONG';
                confidenceBoost = SCORE_SETTINGS.points.cciStrong;
                cciStatus = currentCCI > 0 ? 'FORTEMENTE SOBRE-COMPRADO' : 'FORTEMENTE SOBRE-VENDIDO';
                cciEmoji = currentCCI > 0 ? '🔴🔴🔴' : '🟢🟢🟢';
            }
            else if (Math.abs(currentCCI) > CCI_SETTINGS.thresholds.overbought) {
                signalStrength = 'MODERATE';
                confidenceBoost = SCORE_SETTINGS.points.cciModerate;
                cciStatus = currentCCI > 0 ? 'SOBRE-COMPRADO' : 'SOBRE-VENDIDO';
                cciEmoji = currentCCI > 0 ? '🔴🔴' : '🟢🟢';
            }
            else if (Math.abs(currentCCI) > CCI_SETTINGS.thresholds.weakSignal) {
                signalStrength = 'WEAK';
                confidenceBoost = SCORE_SETTINGS.points.cciWeak;
                cciStatus = currentCCI > 0 ? 'LEVEMENTE ALCISTA' : 'LEVEMENTE BAIXISTA';
                cciEmoji = currentCCI > 0 ? '🔴' : '🟢';
            }
        }
        
        let trendSignal = null;
        if (!crossoverSignal) {
            if (cciAboveEMA && currentCCI > 0) {
                trendSignal = {
                    type: 'COMPRA',
                    strength: 'TREND_UP',
                    message: `CCI (${currentCCI.toFixed(2)}) ⤴️`
                };
                cciStatus = 'TENDÊNCIA ALCISTA';
                cciEmoji = '🟢';
                confidenceBoost = SCORE_SETTINGS.points.cciTrend;
            }
            else if (cciBelowEMA && currentCCI < 0) {
                trendSignal = {
                    type: 'VENDA',
                    strength: 'TREND_DOWN',
                    message: `CCI (${currentCCI.toFixed(2)}) ⤵️`
                };
                cciStatus = 'TENDÊNCIA BAIXISTA';
                cciEmoji = '🔴';
                confidenceBoost = SCORE_SETTINGS.points.cciTrend;
            }
        }
        
        const result = {
            cciValue: currentCCI,
            cciEMA: currentCCI_EMA,
            crossover: crossoverSignal,
            trend: trendSignal,
            signalStrength: signalStrength,
            confidenceBoost: confidenceBoost,
            status: cciStatus,
            emoji: cciEmoji,
            previousCCI: previousCCI,
            previousCCI_EMA: previousCCI_EMA,
            timestamp: Date.now(),
            // ⬆️ NOVO: Flag para indicar zona extrema
            isExtreme: Math.abs(currentCCI) > 200
        };
        
        cciCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 CCI Diário ${symbol}: ${currentCCI.toFixed(2)} | EMA: ${currentCCI_EMA.toFixed(2)} | ${cciStatus} ${cciEmoji}`);
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular CCI diário para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🕯️ FUNÇÃO PARA DETECTAR PADRÕES DE CANDLES (15M) - CORRIGIDO
// =====================================================================
async function detectCandlePatterns(symbol) {
    try {
        const cacheKey = `candle_patterns_${symbol}`;
        const now = Date.now();
        
        if (candlePatternCache[cacheKey] && now - candlePatternCache[cacheKey].timestamp < CANDLE_PATTERN_CACHE_TTL) {
            return candlePatternCache[cacheKey].data;
        }
        
        // ⬅️ AGORA usando timeframe 15m (não 3m)
        const candles = await getCandlesCached(symbol, CANDLE_PATTERN_SETTINGS.timeframe, CANDLE_PATTERN_SETTINGS.lookbackCandles + 3);
        
        if (candles.length < 3) {
            const fallback = {
                patterns: [],
                dominantPattern: 'Nenhum padrão detectado',
                patternEmoji: '⚪',
                confidence: 0,
                patternPoints: 0,
                details: [],
                hasConfirmation: false
            };
            candlePatternCache[cacheKey] = { data: fallback, timestamp: now };
            return fallback;
        }
        
        const recentCandles = candles.slice(-CANDLE_PATTERN_SETTINGS.lookbackCandles);
        const patterns = [];
        const details = [];
        
        // Verificar padrões de confirmação importantes
        let hasDoji = false;
        let hasEngulfing = false;
        let hasHammer = false;
        
        for (let i = 1; i < recentCandles.length; i++) {
            const current = recentCandles[i];
            const previous = recentCandles[i-1];
            
            const bodySize = Math.abs(current.close - current.open);
            const totalRange = current.high - current.low;
            const upperWick = current.high - Math.max(current.open, current.close);
            const lowerWick = Math.min(current.open, current.close) - current.low;
            const bodyPercent = totalRange > 0 ? (bodySize / totalRange) * 100 : 0;
            
            // Doji
            if (bodyPercent <= CANDLE_PATTERN_SETTINGS.dojiMaxBodyPercent && totalRange > 0) {
                patterns.push('DOJI');
                hasDoji = true;
                details.push({
                    type: 'DOJI',
                    emoji: '➕',
                    confidence: 'ALTA',
                    description: `Doji (corpo ${bodyPercent.toFixed(1)}% do range) - Indecisão`,
                    points: SCORE_SETTINGS.points.candlePatternWeak
                });
            }
            
            // Hammer/Shooting Star
            if (lowerWick >= bodySize * CANDLE_PATTERN_SETTINGS.hammerRatio && 
                upperWick <= bodySize * 0.3 && 
                totalRange > 0) {
                const isBullishHammer = current.close > current.open;
                patterns.push(isBullishHammer ? 'HAMMER_BULLISH' : 'HAMMER_BEARISH');
                hasHammer = isBullishHammer;
                details.push({
                    type: isBullishHammer ? 'HAMMER_BULLISH' : 'HAMMER_BEARISH',
                    emoji: isBullishHammer ? '🔨🟢' : '🔨🔴',
                    confidence: 'MÉDIA',
                    description: `Martelo ${isBullishHammer ? 'Alcista' : 'Baixista'} (pavio inferior ${(lowerWick/bodySize).toFixed(1)}x corpo)`,
                    points: SCORE_SETTINGS.points.candlePatternModerate
                });
            }
            
            if (upperWick >= bodySize * CANDLE_PATTERN_SETTINGS.hammerRatio && 
                lowerWick <= bodySize * 0.3 && 
                totalRange > 0) {
                patterns.push('SHOOTING_STAR');
                details.push({
                    type: 'SHOOTING_STAR',
                    emoji: '☄️',
                    confidence: 'MÉDIA',
                    description: `Estrela cadente (pavio superior ${(upperWick/bodySize).toFixed(1)}x corpo) - Reversão baixista`,
                    points: SCORE_SETTINGS.points.candlePatternModerate
                });
            }
            
            // Engulfing
            if (i >= 1) {
                const prevBodySize = Math.abs(previous.close - previous.open);
                const isBullishEngulfing = current.close > current.open && 
                                           previous.close < previous.open &&
                                           current.open < previous.close && 
                                           current.close > previous.open &&
                                           bodySize > prevBodySize * CANDLE_PATTERN_SETTINGS.engulfingBodyRatio;
                
                const isBearishEngulfing = current.close < current.open && 
                                           previous.close > previous.open &&
                                           current.open > previous.close && 
                                           current.close < previous.open &&
                                           bodySize > prevBodySize * CANDLE_PATTERN_SETTINGS.engulfingBodyRatio;
                
                if (isBullishEngulfing) {
                    patterns.push('BULLISH_ENGULFING');
                    hasEngulfing = true;
                    details.push({
                        type: 'BULLISH_ENGULFING',
                        emoji: '🟢🔃',
                        confidence: 'ALTA',
                        description: `Engulfing Alcista (corpo ${(bodySize/prevBodySize).toFixed(1)}x maior)`,
                        points: SCORE_SETTINGS.points.candlePatternStrong
                    });
                } else if (isBearishEngulfing) {
                    patterns.push('BEARISH_ENGULFING');
                    hasEngulfing = true;
                    details.push({
                        type: 'BEARISH_ENGULFING',
                        emoji: '🔴🔃',
                        confidence: 'ALTA',
                        description: `Engulfing Baixista (corpo ${(bodySize/prevBodySize).toFixed(1)}x maior)`,
                        points: SCORE_SETTINGS.points.candlePatternStrong
                    });
                }
            }
        }
        
        let dominantPattern = 'Nenhum padrão detectado';
        let patternEmoji = '⚪';
        let confidence = 0;
        let patternPoints = 0;
        
        if (patterns.length > 0) {
            const patternCount = {};
            patterns.forEach(p => {
                patternCount[p] = (patternCount[p] || 0) + 1;
            });
            
            let maxCount = 0;
            let mostFrequent = '';
            
            Object.entries(patternCount).forEach(([pattern, count]) => {
                if (count > maxCount) {
                    maxCount = count;
                    mostFrequent = pattern;
                }
            });
            
            const patternMap = {
                'DOJI': 'Doji (Indecisão)',
                'HAMMER_BULLISH': 'Martelo Alcista',
                'HAMMER_BEARISH': 'Martelo Baixista',
                'SHOOTING_STAR': 'Estrela Cadente',
                'BULLISH_ENGULFING': 'Engulfing Alcista',
                'BEARISH_ENGULFING': 'Engulfing Baixista'
            };
            
            dominantPattern = patternMap[mostFrequent] || 'Padrão Detectado';
            
            if (mostFrequent.includes('BULLISH') || mostFrequent === 'HAMMER_BULLISH') {
                patternEmoji = '🟢';
                confidence = 75;
            } else if (mostFrequent.includes('BEARISH') || mostFrequent === 'SHOOTING_STAR' || mostFrequent === 'HAMMER_BEARISH') {
                patternEmoji = '🔴';
                confidence = 75;
            } else if (mostFrequent === 'DOJI') {
                patternEmoji = '🟡';
                confidence = 60;
            }
            
            const dominantDetail = details.find(d => d.type === mostFrequent);
            patternPoints = dominantDetail ? dominantDetail.points : 0;
        }
        
        // ⬆️ NOVO: Verificar se tem confirmação de candle
        const hasConfirmation = hasDoji || hasEngulfing || hasHammer;
        
        const result = {
            patterns: patterns,
            dominantPattern: dominantPattern,
            patternEmoji: patternEmoji,
            confidence: confidence,
            patternPoints: patternPoints,
            details: details.slice(-3),
            totalPatterns: patterns.length,
            hasConfirmation: hasConfirmation,
            confirmationTypes: {
                doji: hasDoji,
                engulfing: hasEngulfing,
                hammer: hasHammer
            }
        };
        
        candlePatternCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro análise padrões candles ${symbol}: ${error.message}`);
        return {
            patterns: [],
            dominantPattern: 'Erro na análise',
            patternEmoji: '⚠️',
            confidence: 0,
            patternPoints: 0,
            details: [],
            totalPatterns: 0,
            hasConfirmation: false,
            confirmationTypes: { doji: false, engulfing: false, hammer: false }
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR ATR (AVERAGE TRUE RANGE) - 15M
// =====================================================================
async function calculateATR(symbol, timeframe = '15m', period = 14) {
    try {
        const cacheKey = `atr_${symbol}_${timeframe}_${period}`;
        const now = Date.now();

        if (atrCache[cacheKey] && now - atrCache[cacheKey].timestamp < ATR_CACHE_TTL) {
            return atrCache[cacheKey].data;
        }

        const candles = await getCandlesCached(symbol, timeframe, period + 20);
        if (candles.length < period + 1) {
            console.log(`   ${symbol}: Dados insuficientes para ATR ${timeframe}`);
            return null;
        }

        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const atrValues = ATR.calculate({
            high: high,
            low: low,
            close: close,
            period: period
        });
        
        if (!atrValues || atrValues.length === 0) {
            return null;
        }
        
        const currentATR = atrValues[atrValues.length - 1];
        const currentPrice = candles[candles.length - 1].close;
        const atrPercent = (currentATR / currentPrice) * 100;
        
        const meetsVolatilityCriteria = atrPercent >= EMA_ZONE_SETTINGS.minVolatilityPercent && 
                                       atrPercent <= EMA_ZONE_SETTINGS.maxVolatilityPercent;
        
        let volatilityLevel = 'BAIXA';
        let volatilityEmoji = '🟢';
        let volatilityStatus = meetsVolatilityCriteria ? '✅' : '❌';
        
        if (atrPercent > 3) {
            volatilityLevel = 'ALTA';
            volatilityEmoji = '🔴🔴';
        } else if (atrPercent > 1.5) {
            volatilityLevel = 'MÉDIA';
            volatilityEmoji = '🟡';
        } else if (atrPercent >= EMA_ZONE_SETTINGS.minVolatilityPercent) {
            volatilityLevel = 'MÉDIA-BAIXA';
            volatilityEmoji = '🟢';
        } else {
            volatilityLevel = 'MUITO BAIXA';
            volatilityEmoji = '⚫';
        }
        
        const result = {
            atrValue: currentATR,
            atrPercent: atrPercent,
            volatilityLevel: volatilityLevel,
            volatilityEmoji: volatilityEmoji,
            volatilityStatus: volatilityStatus,
            meetsVolatilityCriteria: meetsVolatilityCriteria,
            currentPrice: currentPrice,
            period: period,
            timeframe: timeframe,
            minRequired: EMA_ZONE_SETTINGS.minVolatilityPercent,
            maxAllowed: EMA_ZONE_SETTINGS.maxVolatilityPercent,
            atrValues: atrValues
        };
        
        atrCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR RSI
// =====================================================================
async function getRSI(symbol, timeframe = '1h', period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 25);
        if (candles.length < period + 10) return null;

        const closes = candles.map(c => c.close);
        
        const rsiValues = RSI.calculate({
            values: closes,
            period: period
        });
        
        if (!rsiValues || rsiValues.length === 0) {
            return null;
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        let status = 'NEUTRAL';
        let emoji = '⚪';
        let rsiPoints = 0;
        
        if (currentRSI < 30) {
            status = 'OVERSOLD';
            emoji = '🟢';
            rsiPoints = SCORE_SETTINGS.points.rsiBuyZone;
        } else if (currentRSI < 40) {
            status = 'COMPRA';
            emoji = '🟢';
            rsiPoints = SCORE_SETTINGS.points.rsiBuyZone;
        } else if (currentRSI > 70) {
            status = 'OVERBOUGHT';
            emoji = '🔴';
            rsiPoints = SCORE_SETTINGS.points.rsiSellZone;
        } else if (currentRSI > 60) {
            status = 'VENDA';
            emoji = '🔴';
            rsiPoints = SCORE_SETTINGS.points.rsiSellZone;
        } else {
            rsiPoints = SCORE_SETTINGS.points.rsiNeutral;
        }
        
        return {
            value: currentRSI,
            status: status,
            emoji: emoji,
            points: rsiPoints,
            rsiValues: rsiValues
        };
    } catch (error) {
        console.log(`⚠️ Erro RSI ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🎯 FUNÇÃO PARA CALCULAR ALVOS BASEADOS NO ATR
// =====================================================================
async function calculateATRTargets(symbol, entryPrice, signalType) {
    try {
        const atrData = await calculateATR(symbol, EMA_ZONE_SETTINGS.atrTimeframe, EMA_ZONE_SETTINGS.atrPeriod);
        
        if (!atrData || !atrData.atrValue) {
            const fallbackATR = entryPrice * 0.02;
            
            const targets = EMA_ZONE_SETTINGS.targetMultipliers.map(multiplier => {
                const targetPrice = signalType === 'COMPRA' 
                    ? entryPrice + (fallbackATR * multiplier)
                    : entryPrice - (fallbackATR * multiplier);
                
                return {
                    target: targetPrice,
                    distancePercent: Math.abs((targetPrice - entryPrice) / entryPrice * 100).toFixed(2),
                    multiplier: multiplier
                };
            });
            
            const stopLoss = signalType === 'COMPRA' 
                ? entryPrice - (fallbackATR * EMA_ZONE_SETTINGS.stopLossMultiplier)
                : entryPrice + (fallbackATR * EMA_ZONE_SETTINGS.stopLossMultiplier);
            
            const stopDistancePercent = Math.abs((stopLoss - entryPrice) / entryPrice * 100).toFixed(2);
            
            const riskReward = (targets[0] ? (parseFloat(targets[0].distancePercent) / parseFloat(stopDistancePercent || 1)).toFixed(2) : '0');
            
            let stopWarning = '';
            if (parseFloat(stopDistancePercent) < 0.5) {
                stopWarning = '⚠️ Stop muito próximo (<0.5%) - considere ajuste manual';
            } else if (parseFloat(stopDistancePercent) < 1.0) {
                stopWarning = 'ℹ️ Stop próximo (0.5-1.0%)';
            }
            
            return {
                targets: targets,
                stopLoss: stopLoss,
                atrValue: fallbackATR,
                atrPercent: 2.0,
                volatilityLevel: 'MÉDIA',
                volatilityEmoji: '🟡',
                volatilityStatus: '✅',
                meetsVolatilityCriteria: true,
                riskReward: riskReward,
                stopDistancePercent: stopDistancePercent,
                stopWarning: stopWarning
            };
        }
        
        const targets = EMA_ZONE_SETTINGS.targetMultipliers.map(multiplier => {
            const targetPrice = signalType === 'COMPRA' 
                ? entryPrice + (atrData.atrValue * multiplier)
                : entryPrice - (atrData.atrValue * multiplier);
            
            return {
                target: targetPrice,
                distancePercent: Math.abs((targetPrice - entryPrice) / entryPrice * 100).toFixed(2),
                multiplier: multiplier
            };
        });
        
        const stopLoss = signalType === 'COMPRA' 
            ? entryPrice - (atrData.atrValue * EMA_ZONE_SETTINGS.stopLossMultiplier)
            : entryPrice + (atrData.atrValue * EMA_ZONE_SETTINGS.stopLossMultiplier);
        
        const stopDistancePercent = Math.abs((stopLoss - entryPrice) / entryPrice * 100).toFixed(2);
        
        const riskReward = (parseFloat(targets[0]?.distancePercent || 0) / parseFloat(stopDistancePercent || 1)).toFixed(2);
        
        let stopWarning = '';
        if (parseFloat(stopDistancePercent) < 0.5) {
            stopWarning = '⚠️ Stop muito próximo (<0.5%) - considere ajuste manual';
        } else if (parseFloat(stopDistancePercent) < 1.0) {
            stopWarning = 'ℹ️ Stop próximo (0.5-1.0%)';
        }
        
        return {
            targets: targets,
            stopLoss: stopLoss,
            atrValue: atrData.atrValue,
            atrPercent: atrData.atrPercent,
            volatilityLevel: atrData.volatilityLevel,
            volatilityEmoji: atrData.volatilityEmoji,
            volatilityStatus: atrData.volatilityStatus,
            meetsVolatilityCriteria: atrData.meetsVolatilityCriteria,
            riskReward: riskReward,
            stopDistancePercent: stopDistancePercent,
            stopWarning: stopWarning
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular alvos ATR para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR COOLDOWN POR ZONA
// =====================================================================
function checkZoneCooldown(symbol, zonePrice, signalType) {
    try {
        const zoneKey = `${symbol}_${zonePrice.toFixed(6)}_${signalType}`;
        const now = Date.now();
        
        if (zoneCooldownMap.has(zoneKey)) {
            const lastAlertTime = zoneCooldownMap.get(zoneKey);
            const minutesSinceLastAlert = (now - lastAlertTime) / (1000 * 60);
            
            if (minutesSinceLastAlert < ZONE_COOLDOWN_MINUTES) {
                const remainingMinutes = Math.ceil(ZONE_COOLDOWN_MINUTES - minutesSinceLastAlert);
                console.log(`   ${symbol}: ⏳ Cooldown ativo para zona ${zonePrice.toFixed(6)} (${remainingMinutes} min restantes)`);
                return false;
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ Erro em checkZoneCooldown:', error.message);
        return true;
    }
}

function setZoneCooldown(symbol, zonePrice, signalType) {
    try {
        const zoneKey = `${symbol}_${zonePrice.toFixed(6)}_${signalType}`;
        zoneCooldownMap.set(zoneKey, Date.now());
        
        setTimeout(() => {
            zoneCooldownMap.delete(zoneKey);
        }, ZONE_COOLDOWN_MINUTES * 60 * 1000);
    } catch (error) {
        console.error('❌ Erro em setZoneCooldown:', error.message);
    }
}


// =====================================================================
// 📊 FUNÇÕES PARA ANÁLISE TÉCNICA
// =====================================================================
async function getSupportResistanceLevels(symbol, timeframe = '15m') {
    try {
        const candles = await getCandlesCached(symbol, timeframe, ZONE_SETTINGS.supportResistanceLookback);
        if (candles.length < 20) return [];

        const levels = [];
        const sensitivity = 3;

        for (let i = sensitivity; i < candles.length - sensitivity; i++) {
            const currentHigh = candles[i].high;
            const currentLow = candles[i].low;
            
            let isLocalHigh = true;
            let isLocalLow = true;
            
            for (let j = i - sensitivity; j <= i + sensitivity; j++) {
                if (j !== i) {
                    if (candles[j].high > currentHigh) isLocalHigh = false;
                    if (candles[j].low < currentLow) isLocalLow = false;
                }
            }
            
            if (isLocalHigh) {
                levels.push({
                    price: currentHigh,
                    type: 'RESISTANCE',
                    strength: 1,
                    volume: candles[i].volume,
                    time: candles[i].time
                });
            }
            
            if (isLocalLow) {
                levels.push({
                    price: currentLow,
                    type: 'SUPPORT',
                    strength: 1,
                    volume: candles[i].volume,
                    time: candles[i].time
                });
            }
        }

        const groupedLevels = [];
        const priceTolerance = 0.001;

        levels.forEach(level => {
            const existingGroup = groupedLevels.find(group => 
                Math.abs(group.price - level.price) / group.price < priceTolerance
            );
            
            if (existingGroup) {
                existingGroup.count++;
                existingGroup.strength += level.strength;
                existingGroup.volume += level.volume;
                existingGroup.price = (existingGroup.price + level.price) / 2;
            } else {
                groupedLevels.push({
                    price: level.price,
                    type: level.type,
                    strength: level.strength,
                    volume: level.volume,
                    count: 1
                });
            }
        });

        return groupedLevels
            .filter(level => level.count >= 2)
            .sort((a, b) => (b.strength * b.volume) - (a.strength * a.volume))
            .slice(0, 5);

    } catch (error) {
        console.log(`⚠️ Erro S/R ${symbol}: ${error.message}`);
        return [];
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA ANÁLISE DE VOLUME 3 MINUTOS
// =====================================================================
async function analyzeVolume3m(symbol, priceAction) {
    try {
        const cacheKey = `volume_3m_${symbol}`;
        const now = Date.now();
        
        if (volumeCache[cacheKey] && now - volumeCache[cacheKey].timestamp < VOLUME_CACHE_TTL) {
            return volumeCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, VOLUME_SETTINGS.timeframe, VOLUME_SETTINGS.lookbackCandles + 5);
        
        if (candles.length < VOLUME_SETTINGS.lookbackCandles) {
            const fallback = {
                volumeBuyer: 'N/A',
                volumeSeller: 'N/A',
                volumeRatio: 'N/A',
                volumeStrength: 'N/A',
                dominantSide: 'N/A',
                volumeSpike: false,
                volumeSpikeMultiplier: 0,
                meetsVolumeSpikeCriteria: false,
                accumulation: false,
                distribution: false,
                analysis: 'Volume indisponível',
                buyerPressure: '0',
                sellerPressure: '0',
                currentVolume: 0,
                averageVolume: 0,
                closePosition: '0'
            };
            volumeCache[cacheKey] = { data: fallback, timestamp: now };
            return fallback;
        }
        
        const recentCandles = candles.slice(-VOLUME_SETTINGS.lookbackCandles);
        const averageVolume = recentCandles.reduce((sum, candle) => sum + candle.volume, 0) / recentCandles.length;
        const lastCandle = recentCandles[recentCandles.length - 1];
        
        const currentVolume = lastCandle.volume;
        const candleRange = lastCandle.high - lastCandle.low;
        const closePosition = candleRange > 0 ? (lastCandle.close - lastCandle.low) / candleRange : 0.5;
        
        let volumeBuyer = 0;
        let volumeSeller = 0;
        
        if (closePosition > 0.5) {
            volumeBuyer = currentVolume * closePosition;
            volumeSeller = currentVolume * (1 - closePosition);
        } else {
            volumeSeller = currentVolume * (1 - closePosition);
            volumeBuyer = currentVolume * closePosition;
        }
        
        const volumeRatio = volumeSeller > 0 ? volumeBuyer / volumeSeller : 0;
        const volumeSpikeMultiplier = averageVolume > 0 ? currentVolume / averageVolume : 0;
        
        const meetsVolumeSpikeCriteria = EMA_ZONE_SETTINGS.requireVolumeSpike ? 
            volumeSpikeMultiplier >= EMA_ZONE_SETTINGS.volumeSpikeMultiplier : true;
        
        let dominantSide = 'NEUTRAL';
        let volumeStrength = 'BAIXA';
        let volumeSpike = false;
        let accumulation = false;
        let distribution = false;
        
        if (volumeSpikeMultiplier >= EMA_ZONE_SETTINGS.volumeSpikeMultiplier) {
            volumeSpike = true;
            volumeStrength = 'ALTA';
        } else if (currentVolume > averageVolume * VOLUME_SETTINGS.minVolumeThreshold) {
            volumeStrength = 'MÉDIA';
        }
        
        if (volumeRatio > VOLUME_SETTINGS.volumeRatioThreshold) {
            dominantSide = 'COMPRADOR';
            
            if (volumeSpike && closePosition > 0.6 && lastCandle.close > lastCandle.open) {
                accumulation = true;
            }
        } else if (volumeRatio < (1 / VOLUME_SETTINGS.volumeRatioThreshold)) {
            dominantSide = 'VENDEDOR';
            
            if (volumeSpike && closePosition < 0.4 && lastCandle.close < lastCandle.open) {
                distribution = true;
            }
        }
        
        const totalVolume = volumeBuyer + volumeSeller;
        const buyerPressure = totalVolume > 0 ? (volumeBuyer / totalVolume) * 100 : 0;
        const sellerPressure = totalVolume > 0 ? (volumeSeller / totalVolume) * 100 : 0;
        
        let analysis = '';
        if (volumeSpike) {
            if (dominantSide === 'COMPRADOR' && priceAction === 'ALTA') {
                analysis = '📈 Spike de volume COMPRADOR confirmando tendência de alta';
            } else if (dominantSide === 'VENDEDOR' && priceAction === 'BAIXA') {
                analysis = '📉 Spike de volume VENDEDOR confirmando tendência de baixa';
            }
        } else {
            if (dominantSide === 'COMPRADOR') {
                analysis = '🟢 Volume comprador moderado';
            } else if (dominantSide === 'VENDEDOR') {
                analysis = '🔴 Volume vendedor moderado';
            } else {
                analysis = '⚪ Volume equilibrado';
            }
        }
        
        const result = {
            volumeBuyer: `${(volumeBuyer / 1000).toFixed(1)}k`,
            volumeSeller: `${(volumeSeller / 1000).toFixed(1)}k`,
            volumeRatio: volumeRatio.toFixed(2),
            volumeStrength: volumeStrength,
            dominantSide: dominantSide,
            volumeSpike: volumeSpike,
            volumeSpikeMultiplier: volumeSpikeMultiplier.toFixed(2),
            meetsVolumeSpikeCriteria: meetsVolumeSpikeCriteria,
            accumulation: accumulation,
            distribution: distribution,
            buyerPressure: buyerPressure.toFixed(1),
            sellerPressure: sellerPressure.toFixed(1),
            currentVolume: currentVolume,
            averageVolume: averageVolume,
            analysis: analysis,
            closePosition: closePosition.toFixed(2)
        };
        
        volumeCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro análise volume 3m ${symbol}: ${error.message}`);
        return {
            volumeBuyer: 'N/A',
            volumeSeller: 'N/A',
            volumeRatio: 'N/A',
            volumeStrength: 'N/A',
            dominantSide: 'N/A',
            volumeSpike: false,
            volumeSpikeMultiplier: 0,
            meetsVolumeSpikeCriteria: false,
            accumulation: false,
            distribution: false,
            analysis: 'Erro na análise de volume',
            buyerPressure: '0',
            sellerPressure: '0'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR EMA 13, 34, 55 NO TIMEFRAME 3 MINUTOS
// =====================================================================
async function checkEMA3133455(symbol) {
    try {
        // ⬇️ REQUIREDCANDLES REDUZIDO para 80 (antes 100)
        const candles = await getCandlesCached(symbol, EMA_ZONE_SETTINGS.timeframe, EMA_ZONE_SETTINGS.requiredCandles);
        
        if (candles.length < EMA_ZONE_SETTINGS.requiredCandles) {
            return null;
        }

        const closes = candles.map(c => c.close);
        
        const ema13Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema13Period,
            values: closes
        });
        
        const ema34Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema34Period,
            values: closes
        });
        
        const ema55Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema55Period,
            values: closes
        });
        
        if (ema13Values.length < 3 || ema34Values.length < 3 || ema55Values.length < 3) {
            return null;
        }
        
        const currentEma13 = ema13Values[ema13Values.length - 1];
        const currentEma34 = ema34Values[ema34Values.length - 1];
        const currentEma55 = ema55Values[ema55Values.length - 1];
        
        const previousEma13 = ema13Values[ema13Values.length - 2];
        const previousEma34 = ema34Values[ema34Values.length - 2];
        
        const ema13AboveEma34 = currentEma13 > currentEma34;
        const previousEma13AboveEma34 = previousEma13 > previousEma34;
        
        const ema13BelowEma34 = currentEma13 < currentEma34;
        const previousEma13BelowEma34 = previousEma13 < previousEma34;
        
        const currentPrice = closes[closes.length - 1];
        
        const priceAboveEma55 = currentPrice > currentEma55;
        const priceBelowEma55 = currentPrice < currentEma55;
        
        let crossoverSignal = null;
        
        if (ema13AboveEma34 && !previousEma13AboveEma34 && priceAboveEma55) {
            crossoverSignal = {
                type: 'COMPRA',
                message: `EMA 13 (${currentEma13.toFixed(6)}) cruzou para CIMA da EMA 34 (${currentEma34.toFixed(6)}) e preço (${currentPrice.toFixed(6)}) está ACIMA da EMA 55 (${currentEma55.toFixed(6)})`,
                ema13: currentEma13,
                ema34: currentEma34,
                ema55: currentEma55,
                price: currentPrice,
                time: candles[candles.length - 1].time
            };
        }
        else if (ema13BelowEma34 && !previousEma13BelowEma34 && priceBelowEma55) {
            crossoverSignal = {
                type: 'VENDA',
                message: `EMA 13 (${currentEma13.toFixed(6)}) cruzou para BAIXO da EMA 34 (${currentEma34.toFixed(6)}) e preço (${currentPrice.toFixed(6)}) está ABAIXO da EMA 55 (${currentEma55.toFixed(6)})`,
                ema13: currentEma13,
                ema34: currentEma34,
                ema55: currentEma55,
                price: currentPrice,
                time: candles[candles.length - 1].time
            };
        }
        
        return {
            ema13: currentEma13,
            ema34: currentEma34,
            ema55: currentEma55,
            price: currentPrice,
            priceAboveEma55: priceAboveEma55,
            priceBelowEma55: priceBelowEma55,
            ema13AboveEma34: ema13AboveEma34,
            ema13BelowEma34: ema13BelowEma34,
            crossover: crossoverSignal,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMA para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🎯 FUNÇÃO PARA CALCULAR PONTUAÇÃO (SCORE) - ATUALIZADA COM TODAS AS PENALIDADES AGRESSIVAS
// =====================================================================
async function calculateSetupScore(setupData) {
    try {
        const { symbol, zone, ema, atrData, cciData, marketData, volumeAnalysis, signalType, lsrData, rsiData, candlePatterns, btcStrength } = setupData;
        
        let score = SCORE_SETTINGS.baseScore;
        const breakdown = {
            base: SCORE_SETTINGS.baseScore,
            zone: 0,
            volatility: 0,
            volumeSpike: 0,
            volumeDominance: 0,
            volumePressure: 0,
            priceEma55: 0,
            cci: 0,
            lsr: 0,
            rsi: 0,
            candlePatterns: 0,
            btcCorrelation: 0,
            penalties: 0,
            total: 0
        };
        
        const isBuySignal = signalType === 'COMPRA';
        
        console.log(`\n📊 Calculando score para ${symbol} (${signalType}):`);
        
        // 1. ZONA (Suporte/Resistência)
        if (zone && zone.strength) {
            const zonePoints = Math.min(zone.strength * SCORE_SETTINGS.points.zoneStrength, 30);
            score += zonePoints;
            breakdown.zone = zonePoints;
            console.log(`   +${zonePoints} pontos por zona (força: ${zone.strength})`);
        }
        
        // 2. VOLATILIDADE (ATR) - BLOQUEIO DURO
        if (atrData) {
            if (atrData.meetsVolatilityCriteria) {
                score += SCORE_SETTINGS.points.volatilityOk;
                breakdown.volatility = SCORE_SETTINGS.points.volatilityOk;
                console.log(`   +${SCORE_SETTINGS.points.volatilityOk} pontos por volatilidade OK (${atrData.atrPercent?.toFixed(2)}%)`);
            } else {
                console.log(`   ❌ VOLATILIDADE FORA DOS CRITÉRIOS (${atrData.atrPercent?.toFixed(2)}% vs ${atrData.minRequired}-${atrData.maxAllowed}%)`);
                return null; // BLOQUEIO DURO
            }
        }
        
        // 3. VOLUME SPIKE - BLOQUEIO DURO
        if (volumeAnalysis) {
            if (volumeAnalysis.meetsVolumeSpikeCriteria) {
                score += SCORE_SETTINGS.points.volumeSpikeOk;
                breakdown.volumeSpike = SCORE_SETTINGS.points.volumeSpikeOk;
                console.log(`   +${SCORE_SETTINGS.points.volumeSpikeOk} pontos por volume spike (${volumeAnalysis.volumeSpikeMultiplier}x)`);
            } else {
                console.log(`   ❌ VOLUME SPIKE INSUFICIENTE (${volumeAnalysis.volumeSpikeMultiplier}x vs mínimo ${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x)`);
                return null; // BLOQUEIO DURO
            }
        }
        
        // 4. VOLUME DOMINÂNCIA
        if (volumeAnalysis) {
            const volumeRatio = parseFloat(volumeAnalysis.volumeRatio);
            if (isBuySignal && volumeRatio > VOLUME_SETTINGS.volumeRatioThreshold) {
                score += SCORE_SETTINGS.points.volumeDominance;
                breakdown.volumeDominance = SCORE_SETTINGS.points.volumeDominance;
                console.log(`   +${SCORE_SETTINGS.points.volumeDominance} pontos por volume comprador dominante (${volumeRatio}:1)`);
            } else if (!isBuySignal && volumeRatio < (1 / VOLUME_SETTINGS.volumeRatioThreshold)) {
                score += SCORE_SETTINGS.points.volumeDominance;
                breakdown.volumeDominance = SCORE_SETTINGS.points.volumeDominance;
                console.log(`   +${SCORE_SETTINGS.points.volumeDominance} pontos por volume vendedor dominante (${volumeRatio}:1)`);
            } else {
                // Spike mas pressão contrária - PENALIDADE
                if (volumeAnalysis.volumeSpike) {
                    score += SCORE_SETTINGS.points.lowVolumeInSpike;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.lowVolumeInSpike);
                    console.log(`   ${SCORE_SETTINGS.points.lowVolumeInSpike} pontos por spike de volume mas pressão contrária`);
                }
            }
        }
        
        // 5. PRESSÃO DE VOLUME
        if (volumeAnalysis) {
            const buyerPressure = parseFloat(volumeAnalysis.buyerPressure);
            const sellerPressure = parseFloat(volumeAnalysis.sellerPressure);
            
            if (isBuySignal && buyerPressure > VOLUME_SETTINGS.buyPressureThreshold) {
                score += SCORE_SETTINGS.points.volumePressure;
                breakdown.volumePressure = SCORE_SETTINGS.points.volumePressure;
                console.log(`   +${SCORE_SETTINGS.points.volumePressure} pontos por pressão compradora forte (${buyerPressure}%)`);
            } else if (!isBuySignal && sellerPressure > VOLUME_SETTINGS.sellPressureThreshold) {
                score += SCORE_SETTINGS.points.volumePressure;
                breakdown.volumePressure = SCORE_SETTINGS.points.volumePressure;
                console.log(`   +${SCORE_SETTINGS.points.volumePressure} pontos por pressão vendedora forte (${sellerPressure}%)`);
            }
        }
        
        // 6. PREÇO EM RELAÇÃO À EMA55
        if (ema) {
            const priceConditionOK = (isBuySignal && ema.priceAboveEma55) || (!isBuySignal && ema.priceBelowEma55);
            if (priceConditionOK) {
                score += SCORE_SETTINGS.points.priceAboveBelowEMA55;
                breakdown.priceEma55 = SCORE_SETTINGS.points.priceAboveBelowEMA55;
                console.log(`   +${SCORE_SETTINGS.points.priceAboveBelowEMA55} pontos por preço ${isBuySignal ? 'acima' : 'abaixo'} EMA55`);
            }
        }
        
        // 7. CCI - COM BLOQUEIO PARA ZONAS EXTREMAS CONTRA O SINAL
        if (cciData) {
            // ⬆️ NOVO: BLOQUEIO DURO para CCI diário extremo contra o sinal
            if (SCORE_SETTINGS.blockers.cciExtremeBlock) {
                if ((isBuySignal && cciData.cciValue > 200) || (!isBuySignal && cciData.cciValue < -200)) {
                    console.log(`   ❌ CCI diário extremo contra sinal (${cciData.cciValue.toFixed(2)}) → BLOQUEADO`);
                    return null;
                }
            }
            
            if (cciData.confidenceBoost > 0) {
                score += cciData.confidenceBoost;
                breakdown.cci = cciData.confidenceBoost;
                console.log(`   +${cciData.confidenceBoost} pontos por CCI (${cciData.status})`);
            }
        }
        
        // 8. LSR - COM PENALIDADE AUMENTADA E PENALIDADE EXTREMA
        if (lsrData && lsrData.lsrValue) {
            const lsrValue = lsrData.lsrValue;
            
            // ⬆️ NOVO: Penalidade EXTREMA para LSR >3.5 em COMPRA ou <2.3 em VENDA
            if (isBuySignal && lsrValue > 3.5) {
                score += SCORE_SETTINGS.points.lsrExtremeUnfavorable;
                breakdown.penalties += Math.abs(SCORE_SETTINGS.points.lsrExtremeUnfavorable);
                console.log(`   ${SCORE_SETTINGS.points.lsrExtremeUnfavorable} pontos por LSR ${lsrValue.toFixed(2)} > 3.5 em COMPRA (EXTREMO)`);
            } 
            else if (!isBuySignal && lsrValue < 2.3) {
                score += SCORE_SETTINGS.points.lsrExtremeUnfavorable;
                breakdown.penalties += Math.abs(SCORE_SETTINGS.points.lsrExtremeUnfavorable);
                console.log(`   ${SCORE_SETTINGS.points.lsrExtremeUnfavorable} pontos por LSR ${lsrValue.toFixed(2)} < 2.3 em VENDA (EXTREMO)`);
            }
            else if (isBuySignal) {
                if (lsrValue < 2.7) {
                    score += SCORE_SETTINGS.points.lsrBuyFavorable;
                    breakdown.lsr = SCORE_SETTINGS.points.lsrBuyFavorable;
                    console.log(`   +${SCORE_SETTINGS.points.lsrBuyFavorable} pontos por LSR ${lsrValue.toFixed(2)} < 2.7 (favorável)`);
                } else if (lsrValue > 3.0) {
                    score += SCORE_SETTINGS.points.lsrUnfavorable;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.lsrUnfavorable);
                    console.log(`   ${SCORE_SETTINGS.points.lsrUnfavorable} pontos por LSR ${lsrValue.toFixed(2)} > 3.0 (desfavorável)`);
                }
            } else {
                if (lsrValue > 3.0) {
                    score += SCORE_SETTINGS.points.lsrSellFavorable;
                    breakdown.lsr = SCORE_SETTINGS.points.lsrSellFavorable;
                    console.log(`   +${SCORE_SETTINGS.points.lsrSellFavorable} pontos por LSR ${lsrValue.toFixed(2)} > 3.0 (favorável)`);
                } else if (lsrValue < 2.7) {
                    score += SCORE_SETTINGS.points.lsrUnfavorable;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.lsrUnfavorable);
                    console.log(`   ${SCORE_SETTINGS.points.lsrUnfavorable} pontos por LSR ${lsrValue.toFixed(2)} < 2.7 (desfavorável)`);
                }
            }
        }
        
        // 9. RSI - COM PENALIDADE AUMENTADA (AGORA -18)
        if (rsiData && rsiData.value) {
            const rsiValue = rsiData.value;
            
            if (isBuySignal) {
                if (rsiValue < 25) {
                    score += SCORE_SETTINGS.points.rsiOversoldInSell;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.rsiOversoldInSell);
                    console.log(`   ${SCORE_SETTINGS.points.rsiOversoldInSell} pontos por RSI ${rsiValue.toFixed(1)} < 25 em COMPRA (EXTREMO)`);
                } else if (rsiValue > 75) {
                    score += SCORE_SETTINGS.points.rsiOverboughtInBuy;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.rsiOverboughtInBuy);
                    console.log(`   ${SCORE_SETTINGS.points.rsiOverboughtInBuy} pontos por RSI ${rsiValue.toFixed(1)} > 75 em COMPRA (EXTREMO)`);
                } else if (rsiValue >= 30 && rsiValue <= 40) {
                    score += SCORE_SETTINGS.points.rsiBuyZone;
                    breakdown.rsi = SCORE_SETTINGS.points.rsiBuyZone;
                    console.log(`   +${SCORE_SETTINGS.points.rsiBuyZone} pontos por RSI ${rsiValue.toFixed(1)} na zona de COMPRA`);
                }
            } else {
                if (rsiValue > 75) {
                    score += SCORE_SETTINGS.points.rsiOverboughtInBuy;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.rsiOverboughtInBuy);
                    console.log(`   ${SCORE_SETTINGS.points.rsiOverboughtInBuy} pontos por RSI ${rsiValue.toFixed(1)} > 75 em VENDA (EXTREMO)`);
                } else if (rsiValue < 25) {
                    score += SCORE_SETTINGS.points.rsiOversoldInSell;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.rsiOversoldInSell);
                    console.log(`   ${SCORE_SETTINGS.points.rsiOversoldInSell} pontos por RSI ${rsiValue.toFixed(1)} < 25 em VENDA (EXTREMO)`);
                } else if (rsiValue >= 60 && rsiValue <= 70) {
                    score += SCORE_SETTINGS.points.rsiSellZone;
                    breakdown.rsi = SCORE_SETTINGS.points.rsiSellZone;
                    console.log(`   +${SCORE_SETTINGS.points.rsiSellZone} pontos por RSI ${rsiValue.toFixed(1)} na zona de VENDA`);
                }
            }
        }
        
        // 10. PADRÕES DE CANDLES - PENALIDADE AUMENTADA QUANDO NÃO TEM CONFIRMAÇÃO
        if (candlePatterns) {
            if (candlePatterns.hasConfirmation) {
                score += candlePatterns.patternPoints;
                breakdown.candlePatterns = candlePatterns.patternPoints;
                console.log(`   +${candlePatterns.patternPoints} pontos por padrão de candle (${candlePatterns.dominantPattern})`);
            } else {
                score += SCORE_SETTINGS.points.noCandleConfirmation;
                breakdown.penalties += Math.abs(SCORE_SETTINGS.points.noCandleConfirmation);
                console.log(`   ${SCORE_SETTINGS.points.noCandleConfirmation} pontos por falta de confirmação de candle (sem Doji/Engulfing/Hammer)`);
            }
        }
        
        // 11. CORRELAÇÃO COM BTC
        if (btcStrength) {
            if (btcStrength.strength === 'VERY_WEAK' || btcStrength.strength === 'WEAK') {
                if (isBuySignal) {
                    score += SCORE_SETTINGS.points.btcCorrelationNegative;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.btcCorrelationNegative);
                    breakdown.btcCorrelation = SCORE_SETTINGS.points.btcCorrelationNegative;
                    console.log(`   ${SCORE_SETTINGS.points.btcCorrelationNegative} pontos por correlação negativa com BTC (${btcStrength.status})`);
                }
            } else if (btcStrength.strength === 'VERY_STRONG' || btcStrength.strength === 'STRONG') {
                if (!isBuySignal) {
                    score += SCORE_SETTINGS.points.btcCorrelationNegative;
                    breakdown.penalties += Math.abs(SCORE_SETTINGS.points.btcCorrelationNegative);
                    breakdown.btcCorrelation = SCORE_SETTINGS.points.btcCorrelationNegative;
                    console.log(`   ${SCORE_SETTINGS.points.btcCorrelationNegative} pontos por correlação negativa com BTC (${btcStrength.status})`);
                }
            }
        }
        
        // Garantir que o score não fique negativo
        score = Math.max(0, score);
        
        // Limitar score máximo a 95
        score = Math.min(95, score);
        breakdown.total = score;
        
        console.log(`   📈 Score total: ${score}% (Mínimo necessário: ${SCORE_SETTINGS.minConfidence}%)`);
        
        return {
            score: score,
            breakdown: breakdown,
            meetsMinConfidence: score >= SCORE_SETTINGS.minConfidence
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular score para ${symbol}: ${error.message}`);
        return {
            score: SCORE_SETTINGS.baseScore,
            breakdown: { base: SCORE_SETTINGS.baseScore, total: SCORE_SETTINGS.baseScore },
            meetsMinConfidence: false
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR SUPORTE/RESISTÊNCIA E DEPOIS EMA - COMPLETA
// =====================================================================
async function checkZoneThenEMA(symbol) {
    try {
        console.log(`\n🔍 Analisando ${symbol}...`);
      
        
        const zones = await getSupportResistanceLevels(symbol, EMA_ZONE_SETTINGS.zoneTimeframe);
        const marketData = await getMarketData(symbol);
        
        if (!marketData || !zones || zones.length === 0) {
            console.log(`   ⏭️  Sem zonas de suporte/resistência relevantes`);
            return null;
        }
        
        const currentPrice = marketData.lastPrice;
        let nearZone = null;
        
        for (const zone of zones) {
            const distancePercent = Math.abs((currentPrice - zone.price) / currentPrice) * 100;
            
            if (distancePercent <= EMA_ZONE_SETTINGS.zoneProximity) {
                nearZone = {
                    type: zone.type,
                    price: zone.price,
                    strength: zone.strength,
                    distancePercent: distancePercent,
                    isSupport: zone.type === 'SUPPORT',
                    isResistance: zone.type === 'RESISTANCE'
                };
                break;
            }
        }
        
        if (!nearZone) {
            console.log(`   ⏭️  Preço não próximo de zona (${currentPrice})`);
            return null;
        }
        
        console.log(`   📍 Próximo de ${nearZone.isSupport ? 'suporte' : 'resistência'}: $${nearZone.price.toFixed(6)} (${nearZone.distancePercent.toFixed(2)}%)`);
        
        // Verificar cooldown por zona
        if (!checkZoneCooldown(symbol, nearZone.price, '')) {
            return null;
        }
        
        const emaData = await checkEMA3133455(symbol);
        
        if (!emaData || !emaData.crossover) {
            console.log(`   ⏭️  Sem crossover EMA 13/34/55`);
            return null;
        }
        
        const isBuySignal = emaData.crossover.type === 'COMPRA';
        const isSellSignal = emaData.crossover.type === 'VENDA';
        
        // Verificar compatibilidade zona/sinal
        if (isBuySignal && !nearZone.isSupport) {
            console.log(`   ⏭️  Crossover COMPRA mas preço próximo de RESISTÊNCIA`);
            return null;
        }
        
        if (isSellSignal && !nearZone.isResistance) {
            console.log(`   ⏭️  Crossover VENDA mas preço próximo de SUPORTE`);
            return null;
        }
        
        console.log(`   ✅ ${emaData.crossover.type} confirmado com zona`);
        
        // Obter todos os dados para análise
        const [atrData, volumeAnalysis, cciData, lsrData, rsiData, candlePatterns, btcStrength] = await Promise.allSettled([
            calculateATR(symbol, EMA_ZONE_SETTINGS.atrTimeframe, EMA_ZONE_SETTINGS.atrPeriod),
            analyzeVolume3m(symbol, emaData.crossover.type === 'COMPRA' ? 'ALTA' : 'BAIXA'),
            calculateCCIDaily(symbol),
            getBinanceLSRValue(symbol, '15m'),
            getRSI(symbol, '1h'),
            detectCandlePatterns(symbol),
            calculateBTCRelativeStrength(symbol)
        ]);
        
        const setupData = {
            symbol: symbol,
            zone: nearZone,
            ema: emaData,
            atrData: atrData.status === 'fulfilled' ? atrData.value : null,
            cciData: cciData.status === 'fulfilled' ? cciData.value : null,
            marketData: marketData,
            volumeAnalysis: volumeAnalysis.status === 'fulfilled' ? volumeAnalysis.value : null,
            lsrData: lsrData.status === 'fulfilled' ? lsrData.value : null,
            rsiData: rsiData.status === 'fulfilled' ? rsiData.value : null,
            candlePatterns: candlePatterns.status === 'fulfilled' ? candlePatterns.value : null,
            btcStrength: btcStrength.status === 'fulfilled' ? btcStrength.value : null,
            signalType: emaData.crossover.type
        };
        
        // Calcular pontuação
        const scoreResult = await calculateSetupScore(setupData);
        
        if (!scoreResult) {
            console.log(`   ❌ Setup bloqueado por critérios obrigatórios`);
            return null;
        }
        
        if (!scoreResult.meetsMinConfidence) {
            console.log(`   ❌ Confiança insuficiente (${scoreResult.score}% vs mínimo ${SCORE_SETTINGS.minConfidence}%)`);
            return null;
        }
        
        console.log(`   ✅ Setup VALIDADO com ${scoreResult.score}% de confiança`);
        
        return {
            ...setupData,
            scoreResult: scoreResult,
            confidence: scoreResult.score,
            allCriteriaMet: true
        };
        
    } catch (error) {
        console.log(`⚠️ Erro checkZoneThenEMA ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA ENVIAR ALERTA
// =====================================================================
async function sendZoneEMAAlert(setupData) {
    try {
        const { symbol, zone, ema, atrData, cciData, marketData, volumeAnalysis, signalType, lsrData, rsiData, candlePatterns, scoreResult, confidence, btcStrength } = setupData;
        
        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}&interval=3`;
        
        const [fundingData, atrTargets] = await Promise.allSettled([
            checkFundingRate(symbol),
            calculateATRTargets(symbol, ema.price, signalType)
        ]);
        
        const isBuySignal = signalType === 'COMPRA';
        const actionEmoji = isBuySignal ? '🟢' : '🔴';
        const zoneType = zone.isSupport ? 'SUPORTE' : 'RESISTÊNCIA';
        
        let lsrInfo = 'N/A';
        if (lsrData) {
            lsrInfo = `${lsrData.lsrValue?.toFixed(3) || '0.000'} ${lsrData.isRising ? '⬆️' : '⬇️'}`;
            if (lsrData.percentChange !== '0.00') {
                lsrInfo += ` (${lsrData.percentChange}%)`;
            }
        }
        
        const rsiInfo = rsiData ? 
            `${rsiData.emoji} ${rsiData.value?.toFixed(1) || '50.0'} (${rsiData.status || 'NEUTRAL'})` : 'N/A';
        
        const fundingInfo = fundingData.status === 'fulfilled' && fundingData.value ? 
            fundingData.value.text : 'Indisponível';
        
        const btcStrengthInfo = btcStrength ? 
            `${btcStrength.emoji} ${btcStrength.status}` : 'N/A';
        
        const candlePatternInfo = candlePatterns ? 
            `${candlePatterns.patternEmoji} ${candlePatterns.dominantPattern}` : 'N/A';
        
        let candlePatternDetails = '';
        if (candlePatterns && candlePatterns.details.length > 0) {
            const lastPatterns = candlePatterns.details.slice(-2);
            lastPatterns.forEach(pattern => {
                candlePatternDetails += `• ${pattern.emoji} ${pattern.description}\n`;
            });
        }
        
        let cciInfo = 'N/A';
        let cciDetails = '';
        if (cciData) {
            cciInfo = `${cciData.emoji} ${cciData.cciValue?.toFixed(2) || '0.00'} | EMA: ${cciData.cciEMA?.toFixed(2) || '0.00'}`;
            
            if (cciData.crossover) {
                cciDetails = ` CCI : ${cciData.crossover.message}\n`;
                cciDetails += `   Força: ${cciData.signalStrength} | Pontos: +${cciData.confidenceBoost}\n`;
            } else if (cciData.trend) {
                cciDetails = ` CCI : ${cciData.trend.message}\n`;
            }
            cciDetails += `   Status: ${cciData.status}\n`;
        }
        
        let volumeEmoji = '⚪';
        if (volumeAnalysis.dominantSide === 'COMPRADOR') {
            volumeEmoji = volumeAnalysis.volumeSpike ? '📈📈' : '📈';
        } else if (volumeAnalysis.dominantSide === 'VENDEDOR') {
            volumeEmoji = volumeAnalysis.volumeSpike ? '📉📉' : '📉';
        }
        
        let targetsText = '';
        let stopText = '';
        let stopWarningText = '';
        
        if (atrTargets.status === 'fulfilled' && atrTargets.value && atrTargets.value.targets) {
            atrTargets.value.targets.forEach((target, index) => {
                targetsText += `• ${index + 1}º: $${(target.target || 0).toFixed(6)} (+${target.distancePercent || '0.00'}%)\n`;
            });
            
            stopText = `⚠️ Stop:\n• $${(atrTargets.value.stopLoss || 0).toFixed(6)} (${atrTargets.value.stopDistancePercent || '0.00'}%)\n`;
            
            if (atrTargets.value.stopWarning) {
                stopWarningText = `${atrTargets.value.stopWarning}\n`;
            }
        } else {
            targetsText = '⚠️ Alvos não disponíveis';
            stopText = '⚠️ Stop não disponível';
        }
        
        // BREAKDOWN DA PONTUAÇÃO
        const breakdown = scoreResult?.breakdown || {};
        const scoreBreakdown = 
`<i> Score (${confidence}%):</i>
• Base: ${breakdown.base || 0}
• Zona: ${breakdown.zone || 0}
• Volatilidade: ${breakdown.volatility || 0}
• Vol: ${breakdown.volumeSpike || 0}
• Volume Dominante: ${breakdown.volumeDominance || 0}
• Pressão Volume: ${breakdown.volumePressure || 0}
• Preço: ${breakdown.priceEma55 || 0}
• CCI: ${breakdown.cci || 0}
• LSR: ${breakdown.lsr || 0}
• RSI: ${breakdown.rsi || 0}
• Candles: ${breakdown.candlePatterns || 0}
• BTC: ${breakdown.btcCorrelation || 0}
• Penalidades: ${breakdown.penalties || 0}`;
        
        // MENSAGEM COMPLETA
        const message = 
`${actionEmoji} <i>${symbol} - ${signalType}</i>
${now.full} <a href="${tradingViewLink}">Gráfico</a>

<i> Nível de ${zoneType}:</i>
• ${zoneType}: $${(zone.price || 0).toFixed(6)}
• Distância: ${(zone.distancePercent || 0).toFixed(2)}%
• Força: ${zone.strength || 1}/5

<i> Indicadores:</i>
• RSI 1h: ${rsiInfo}
• LSR: ${lsrInfo}
• Fund. Rate: ${fundingInfo}
• Força vs BTC: ${btcStrengthInfo}
• Volatilidade : ${atrData?.volatilityEmoji || '⚪'} ${atrData?.volatilityLevel || 'N/A'} (${atrData?.atrPercent?.toFixed(2) || '0.00'}%)
• CCI: ${cciInfo}

${cciDetails || ''}
<i>Padrões de Candles (15m):</i>
${candlePatternDetails || '• ⚪ Nenhum padrão relevante detectado'}

<i> Volume:</i>
• Comprador: ${volumeAnalysis.volumeBuyer} | Vendedor: ${volumeAnalysis.volumeSeller}
• Pressão: ${volumeAnalysis.buyerPressure}%/${volumeAnalysis.sellerPressure}%
• Dominante: ${volumeEmoji} ${volumeAnalysis.dominantSide}
• Force: ${volumeAnalysis.volumeSpikeMultiplier}x ${volumeAnalysis.meetsVolumeSpikeCriteria ? '✅' : '❌'}

${scoreBreakdown}

<i> Alvos:</i>
${targetsText}
${stopText}${stopWarningText}

Titanium by @J4Rviz`;
        
        const sent = await sendTelegramAlert(message);
        
        if (sent) {
            // Registrar cooldown por zona
            setZoneCooldown(symbol, zone.price, signalType);
            
            console.log(`\n${actionEmoji} Alerta enviado: ${symbol} - ${signalType}`);
            console.log(`   ${zoneType}: $${(zone.price || 0).toFixed(6)} (${(zone.distancePercent || 0).toFixed(2)}%)`);
            console.log(`   EMA 13/34/55: $${(ema.ema13 || 0).toFixed(6)}/$${(ema.ema34 || 0).toFixed(6)}/$${(ema.ema55 || 0).toFixed(6)}`);
            console.log(`   CCI Diário: ${cciData?.cciValue?.toFixed(2) || 'N/A'} | EMA: ${cciData?.cciEMA?.toFixed(2) || 'N/A'} ${cciData?.emoji || ''}`);
            console.log(`   LSR: ${lsrData?.lsrValue?.toFixed(3) || 'N/A'} ${lsrData?.isRising ? '⬆️' : '⬇️'}`);
            console.log(`   Volume: ${volumeAnalysis.volumeBuyer} comprador | ${volumeAnalysis.volumeSeller} vendedor`);
            console.log(`   Razão: ${volumeAnalysis.volumeRatio}:1 | Spike: ${volumeAnalysis.volumeSpikeMultiplier}x`);
            console.log(`   Padrões: ${candlePatternInfo}`);
            console.log(`   Pontuação: ${confidence}%`);
            console.log(`   Break: Zona:${breakdown.zone || 0} Vol:${breakdown.volatility || 0} VolS:${breakdown.volumeSpike || 0} VolD:${breakdown.volumeDominance || 0} CCI:${breakdown.cci || 0} LSR:${breakdown.lsr || 0}`);
            
            if (atrTargets.status === 'fulfilled' && atrTargets.value && atrTargets.value.targets) {
                console.log(`   Alvos:`);
                atrTargets.value.targets.forEach((target, index) => {
                    console.log(`     ${index + 1}º: $${(target.target || 0).toFixed(6)} (+${target.distancePercent || '0.00'}%)`);
                });
                console.log(`   Stop: $${(atrTargets.value.stopLoss || 0).toFixed(6)} (${atrTargets.value.stopDistancePercent || '0.00'}%)`);
                if (atrTargets.value.stopWarning) {
                    console.log(`   ⚠️  ${atrTargets.value.stopWarning}`);
                }
            }
        }
        
        return sent;
        
    } catch (error) {
        console.error(`Erro enviando alerta Zona+EMA ${symbol}:`, error.message);
        return false;
    }
}

// =====================================================================
// 🆕 MONITOR PARA ALERTAS DE ZONA + EMA
// =====================================================================
class ZoneEMAMonitor {
    constructor() {
        try {
            this.symbolGroups = [];
            this.currentGroupIndex = 0;
            this.totalAlertsSent = 0;
            this.lastAlertTime = new Map();
            this.cycleCount = 0;
            this.stats = {
                totalAnalyzed: 0,
                volatilityFiltered: 0,
                volumeSpikeFiltered: 0,
                signalsFound: 0,
                alertsSent: 0,
                startTime: Date.now()
            };
            console.log('✅ ZoneEMAMonitor inicializado');
        } catch (error) {
            console.error('❌ Erro ao inicializar ZoneEMAMonitor:', error.message);
            this.symbolGroups = [];
            this.stats = { totalAnalyzed: 0, startTime: Date.now() };
        }
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllFuturesSymbols();
            
            const groupSize = Math.ceil(allSymbols.length / EMA_ZONE_SETTINGS.alertGroups);
            this.symbolGroups = this.createGroups(allSymbols, groupSize);
            
            console.log(`📊 ${allSymbols.length} pares selecionados`);
            console.log(`📊 ${this.symbolGroups.length} grupos de ${groupSize} pares cada`);
            console.log(`⏱️  Cada grupo será analisado a cada ${EMA_ZONE_SETTINGS.checkInterval/1000}s`);
            console.log(`⚡ BLOQUEIOS OBRIGATÓRIOS:`);
            console.log(`   • Volatilidade: ${EMA_ZONE_SETTINGS.minVolatilityPercent}%-${EMA_ZONE_SETTINGS.maxVolatilityPercent}% ATR 15m`);
            console.log(`   • Volume spike: ${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x - 3m`);
            console.log(`   • CCI extremo contra sinal: BLOQUEIO DURO (>200 em VENDA, <-200 em COMPRA)`);
            console.log(`🎯 PONTUAÇÃO AGRESSIVA:`);
            console.log(`   • CCI: Até +${SCORE_SETTINGS.points.cciStrong} pontos`);
            console.log(`   • RSI >75 em COMPRA ou <25 em VENDA: ${SCORE_SETTINGS.points.rsiOverboughtInBuy} pontos`);
            console.log(`   • LSR >3.5 em COMPRA ou <2.3 em VENDA: ${SCORE_SETTINGS.points.lsrExtremeUnfavorable} pontos`);
            console.log(`   • Sem confirmação de candle: ${SCORE_SETTINGS.points.noCandleConfirmation} pontos`);
            console.log(`   • Confiança mínima: ${SCORE_SETTINGS.minConfidence}%`);
            console.log(`🎯 Cooldown por zona: ${ZONE_COOLDOWN_MINUTES} minutos`);
            console.log(`🎯 Máximo alertas/hora: ${EMA_ZONE_SETTINGS.maxAlertsPerHour}`);
            console.log(`🎯 Padrões de candles: AGORA em 15m (não 3m)`);
            console.log(`🎯 Required candles EMA: ${EMA_ZONE_SETTINGS.requiredCandles} (reduzido para performance)`);
            
            return allSymbols;
            
        } catch (error) {
            console.error('Erro inicializando símbolos:', error.message);
            return getDefaultSymbols().slice(0, 100);
        }
    }

    createGroups(symbols, groupSize) {
        try {
            const groups = [];
            for (let i = 0; i < symbols.length; i += groupSize) {
                groups.push(symbols.slice(i, i + groupSize));
            }
            return groups;
        } catch (error) {
            console.error('❌ Erro em createGroups:', error.message);
            return [symbols];
        }
    }

    getNextGroup() {
        try {
            if (!this.symbolGroups || this.symbolGroups.length === 0) {
                return [];
            }
            
            const group = this.symbolGroups[this.currentGroupIndex];
            this.currentGroupIndex = (this.currentGroupIndex + 1) % this.symbolGroups.length;
            
            if (this.currentGroupIndex === 0) {
                this.cycleCount++;
            }
            
            return group || [];
        } catch (error) {
            console.error('❌ Erro em getNextGroup:', error.message);
            return [];
        }
    }

    async monitorZoneEMASignals() {
        try {
            const symbols = this.getNextGroup();
            if (!symbols || symbols.length === 0) return;
            
            const groupNumber = this.currentGroupIndex === 0 ? this.symbolGroups.length : this.currentGroupIndex;
            
            console.log(`\n🔄 Ciclo ${this.cycleCount} | Grupo ${groupNumber}/${this.symbolGroups.length}`);
            console.log(`📊 Analisando ${symbols.length} pares...`);
            
            let setupsFound = 0;
            let groupStartTime = Date.now();
            
            const results = await Promise.allSettled(
                symbols.map(symbol => this.analyzeSymbol(symbol))
            );
            
            setupsFound = results.filter(r => r.status === 'fulfilled' && r.value).length;
            
            const groupTime = (Date.now() - groupStartTime) / 1000;
            
            if (setupsFound > 0) {
                console.log(`✅ ${setupsFound} setups encontrados em ${groupTime.toFixed(1)}s`);
            } else {
                console.log(`⏭️  Nenhum setup encontrado neste grupo (${groupTime.toFixed(1)}s)`);
            }
            
            if (this.cycleCount % 3 === 0) {
                this.logStats();
            }
            
        } catch (error) {
            console.error(`Erro no monitor Zona+EMA: ${error.message}`);
        }
    }

    async analyzeSymbol(symbol) {
        try {
            this.stats.totalAnalyzed++;
            
            await new Promise(r => setTimeout(r, Math.random() * 200 + 100));
            
            const setupData = await checkZoneThenEMA(symbol);
            
            if (!setupData) {
                return null;
            }
            
            const { signalType, atrData, volumeAnalysis, confidence } = setupData;
            
            if (!atrData?.meetsVolatilityCriteria) {
                this.stats.volatilityFiltered++;
            }
            
            if (!volumeAnalysis?.meetsVolumeSpikeCriteria) {
                this.stats.volumeSpikeFiltered++;
            }
            
            this.stats.signalsFound++;
            
            const sent = await sendZoneEMAAlert(setupData);
            if (sent) {
                this.stats.alertsSent++;
                this.totalAlertsSent++;
                
                // Pequena pausa entre alertas
                await new Promise(r => setTimeout(r, 2000));
            }
            
            return sent;
            
        } catch (error) {
            console.log(`⚠️ Erro ${symbol}: ${error.message}`);
            return null;
        }
    }

    logStats() {
        try {
            const uptime = Date.now() - this.stats.startTime;
            const hours = Math.floor(uptime / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            
            const successRate = this.stats.totalAnalyzed > 0 ? 
                ((this.stats.signalsFound / this.stats.totalAnalyzed) * 100).toFixed(2) : 0;
            
            console.log(`\n📊 ESTATÍSTICAS (${hours}h${minutes}m):`);
            console.log(`   • Ciclos completos: ${this.cycleCount}`);
            console.log(`   • Pares analisados: ${this.stats.totalAnalyzed}`);
            console.log(`   • Filtrados por volatilidade: ${this.stats.volatilityFiltered}`);
            console.log(`   • Filtrados por volume spike: ${this.stats.volumeSpikeFiltered}`);
            console.log(`   • Sinais encontrados: ${this.stats.signalsFound}`);
            console.log(`   • Alertas enviados: ${this.stats.alertsSent}`);
            console.log(`   • Taxa de sucesso: ${successRate}%`);
            
            
            const rateLimiterStats = rateLimiter.getStats();
            console.log(`   • Rate Limit: ${rateLimiterStats.minuteUsage || '0'}% usado`);
            console.log(`   • Sucesso requests: ${rateLimiterStats.successRate || '0'}%`);
            console.log(`   • Requests/min: ${rateLimiterStats.requestsPerMinute || '0'}`);
        } catch (error) {
            console.error('❌ Erro em logStats:', error.message);
        }
    }
}

// =====================================================================
// 🔄 MONITORAMENTO PRINCIPAL
// =====================================================================
async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(10000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function mainZoneEMAMonitorLoop() {
    const zoneEMAMonitor = new ZoneEMAMonitor();

    await zoneEMAMonitor.initializeSymbols();

    console.log(`\n🚨 SISTEMA DE ALERTA TITANIUM - TODAS AS MELHORIAS IMPLEMENTADAS`);
    console.log(`📊 Monitorando TODOS os pares USDT Perpetual da Binance`);
    console.log(`🎯 Sistema de pontuação PUNITIVO AGRESSIVO com confiança mínima de ${SCORE_SETTINGS.minConfidence}%`);
    console.log(`⚡ BLOQUEIOS DUROS:`);
    console.log(`   • Volatilidade e Volume Spike`);
    console.log(`   • CCI diário extremo contra sinal (BLOQUEIO TOTAL)`);
    console.log(`📉 PENALIDADES AUMENTADAS:`);
    console.log(`   • RSI >75 em COMPRA ou <25 em VENDA: ${SCORE_SETTINGS.points.rsiOverboughtInBuy} pontos`);
    console.log(`   • LSR >3.5 em COMPRA ou <2.3 em VENDA: ${SCORE_SETTINGS.points.lsrExtremeUnfavorable} pontos`);
    console.log(`   • Sem confirmação candle (Doji/Engulfing/Hammer): ${SCORE_SETTINGS.points.noCandleConfirmation} pontos`);
    console.log(`🔄 Cooldown por zona: ${ZONE_COOLDOWN_MINUTES} minutos`);
    console.log(`⏰ Máximo ${EMA_ZONE_SETTINGS.maxAlertsPerHour} alertas por hora`);
    console.log(`🎯 Padrões de candles movidos para 15m (mais confiáveis)`);
    console.log(`⚡ Required candles reduzido para ${EMA_ZONE_SETTINGS.requiredCandles} (performance)`);
    console.log(`🤖 Iniciando monitoramento...\n`);

    let consecutiveErrors = 0;
    let lastReportTime = Date.now();

    while (true) {
        try {
            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 60s...');
                await new Promise(r => setTimeout(r, 60000));
                consecutiveErrors++;
                continue;
            }

            const startTime = Date.now();
            
            await zoneEMAMonitor.monitorZoneEMASignals();
            
            const endTime = Date.now();
            const processingTime = (endTime - startTime) / 1000;
            
            console.log(`✅ Processado em ${processingTime.toFixed(1)}s`);
            
            cleanupCaches();
            consecutiveErrors = 0;

            if (Date.now() - lastReportTime >= 300000) {
                zoneEMAMonitor.logStats();
                lastReportTime = Date.now();
            }

            const waitTime = EMA_ZONE_SETTINGS.checkInterval;
            console.log(`⏱️  Próximo grupo em ${waitTime/1000}s...`);
            await new Promise(r => setTimeout(r, waitTime));

        } catch (error) {
            consecutiveErrors++;
            console.error(`\n❌ ERRO LOOP (${consecutiveErrors}):`, error.message);

            if (consecutiveErrors >= 3) {
                console.log('🔄 Muitos erros. Pausa de 180s...');
                await new Promise(r => setTimeout(r, 180000));
                consecutiveErrors = 0;
            }

            await new Promise(r => setTimeout(r, Math.min(30000 * consecutiveErrors, 120000)));
        }
    }
}

// =====================================================================
// 🔄 FUNÇÃO DE LIMPEZA DE CACHE
// =====================================================================
function cleanupCaches() {
    try {
        const now = Date.now();

        Object.keys(candleCache).forEach(key => {
            if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
                delete candleCache[key];
            }
        });

        Object.keys(marketDataCache).forEach(key => {
            if (now - marketDataCache[key].timestamp > 600000) {
                delete marketDataCache[key];
            }
        });

        Object.keys(orderBookCache).forEach(key => {
            if (now - orderBookCache[key].timestamp > 300000) {
                delete orderBookCache[key];
            }
        });

        Object.keys(lsrCache).forEach(key => {
            if (now - lsrCache[key].timestamp > 300000) {
                delete lsrCache[key];
            }
        });

        Object.keys(fundingCache).forEach(key => {
            if (now - fundingCache[key].timestamp > 300000) {
                delete fundingCache[key];
            }
        });

        Object.keys(atrCache).forEach(key => {
            if (now - atrCache[key].timestamp > 300000) {
                delete atrCache[key];
            }
        });

        Object.keys(volumeCache).forEach(key => {
            if (now - volumeCache[key].timestamp > 300000) {
                delete volumeCache[key];
            }
        });

        Object.keys(candlePatternCache).forEach(key => {
            if (now - candlePatternCache[key].timestamp > 300000) {
                delete candlePatternCache[key];
            }
        });

        Object.keys(cciCache).forEach(key => {
            if (now - cciCache[key].timestamp > 300000) {
                delete cciCache[key];
            }
        });
        
        // Limpar cooldowns antigos
        const hourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, timestamp] of zoneCooldownMap.entries()) {
            if (timestamp < hourAgo) {
                zoneCooldownMap.delete(key);
            }
        }
    } catch (error) {
        console.error('❌ Erro em cleanupCaches:', error.message);
    }
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================
async function startZoneEMABot() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            try {
                fs.mkdirSync(LOG_DIR, { recursive: true });
            } catch (error) {
                console.error('❌ Erro ao criar diretório de logs:', error.message);
            }
        }

        console.log('\n' + '='.repeat(100));
        console.log('🚨 TITANIUM ALERT SYSTEM v2.1 - SISTEMA PUNITIVO AGRESSIVO');
        console.log('🎯 TODAS AS MELHORIAS CRÍTICAS IMPLEMENTADAS COM PENALIDADES AUMENTADAS');
        console.log('='.repeat(100));
        
        console.log(`\n⚙️  CONFIGURAÇÃO ATUAL:`);
        console.log(`   • Base Score: ${SCORE_SETTINGS.baseScore}`);
        console.log(`   • Confiança Mínima: ${SCORE_SETTINGS.minConfidence}%`);
        console.log(`   • Penalidade RSI extremo: ${SCORE_SETTINGS.points.rsiOverboughtInBuy}/${SCORE_SETTINGS.points.rsiOversoldInSell} pontos`);
        console.log(`   • Penalidade LSR extremo: ${SCORE_SETTINGS.points.lsrExtremeUnfavorable} pontos`);
        console.log(`   • Penalidade sem candle confirmation: ${SCORE_SETTINGS.points.noCandleConfirmation} pontos`);
        console.log(`   • BLOQUEIO CCI extremo contra: ATIVADO`);
        console.log(`   • Cooldown zona: ${ZONE_COOLDOWN_MINUTES} minutos`);
        console.log(`   • Alertas/hora: ${EMA_ZONE_SETTINGS.maxAlertsPerHour}`);
        console.log(`   • Volatilidade: ${EMA_ZONE_SETTINGS.minVolatilityPercent}-${EMA_ZONE_SETTINGS.maxVolatilityPercent}%`);
        console.log(`   • Volume spike: ${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x`);
        console.log(`   • Padrões candles: 15m (não 3m)`);
        console.log(`   • Required candles: ${EMA_ZONE_SETTINGS.requiredCandles} (reduzido)`);
        console.log(`\n📊 INDICADORES OTIMIZADOS:`);
        console.log(`   • Rate Limiter com detecção de picos`);
        console.log(`   • CCI com bloqueio extremo (>200 ou <-200 contra sinal)`);
        console.log(`   • LSR com penalidade extrema (>3.5 ou <2.3)`);
        console.log(`\n🎯 RESULTADO ESPERADO:`);
        console.log(`   • Muito menos alertas (mais seletivos)`);
        console.log(`   • Alertas de QUALIDADE EXTREMA (score > ${SCORE_SETTINGS.minConfidence}%)`);
        console.log(`   • Redução drástica de ruído no Telegram`);
        console.log(`   • Setups mais confiáveis e lucrativos`);
        console.log(`   • Performance melhorada em dias de alta volatilidade`);
        console.log('='.repeat(100) + '\n');

        console.log('🔍 Verificando conexão...');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            if (await checkInternetConnection()) {
                connected = true;
                break;
            }
            console.log(`Tentativa ${i+1}/3 falhou. Aguardando...`);
            await new Promise(r => setTimeout(r, 10000));
        }

        if (!connected) {
            console.log('❌ Sem conexão com a Binance. Verifique sua internet.');
            console.log('🔄 Tentando continuar com fallback...');
        }

        console.log('✅ Iniciando monitoramento...');

        await mainZoneEMAMonitorLoop();

    } catch (error) {
        console.error(`\n🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 300 segundos...');
        await new Promise(r => setTimeout(r, 300000));
        await startZoneEMABot();
    }
}

// =====================================================================
// 🛡️ HANDLERS DE ERRO GLOBAL
// =====================================================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error.message);
    logToFile(`❌ Unhandled Rejection: ${error.message}`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    logToFile(`❌ Uncaught Exception: ${error.message}`);
    setTimeout(() => {
        startZoneEMABot();
    }, 60000);
});

// =====================================================================
// 🚀 INICIAR O BOT
// =====================================================================
async function startBotSafely() {
    try {
        await startZoneEMABot();
    } catch (error) {
        console.error('❌ Erro fatal ao iniciar bot:', error.message);
        console.log('🔄 Tentando reiniciar em 60 segundos...');
        setTimeout(startBotSafely, 60000);
    }
}

// Iniciar o bot
startBotSafely();
