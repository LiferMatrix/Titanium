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
    
    // Fallback robusto para funções essenciais
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
                    
                    // Calcular D (média móvel de K)
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
                    if (!values || values.length < period + 1) return 50;
                    
                    let gains = 0;
                    let losses = 0;
                    
                    for (let i = 1; i <= period; i++) {
                        const diff = values[i] - values[i - 1];
                        if (diff > 0) gains += diff;
                        else losses += Math.abs(diff);
                    }
                    
                    const avgGain = gains / period;
                    const avgLoss = losses / period;
                    
                    if (avgLoss === 0) return 100;
                    const rs = avgGain / avgLoss;
                    return 100 - (100 / (1 + rs));
                } catch (error) {
                    console.log('⚠️ Erro no fallback RSI:', error.message);
                    return 50;
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
                    
                    if (trueRanges.length < period) return [trueRanges[0] || 0];
                    
                    const atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
                    return [atr];
                } catch (error) {
                    console.log('⚠️ Erro no fallback ATR:', error.message);
                    return [0];
                }
            }
        }
    };
    console.log('✅ Fallback para indicadores técnicos configurado');
}

const { Stochastic, EMA, RSI, ATR } = technicalIndicators;

// =====================================================================
// 🛡️ FALLBACK PARA FETCH GLOBAL
// =====================================================================
if (!globalThis.fetch) {
    try {
        globalThis.fetch = fetch;
        console.log('✅ fetch configurado no globalThis');
    } catch (error) {
        console.error('❌ Erro ao configurar fetch:', error.message);
        // Fallback mínimo para fetch
        globalThis.fetch = function() {
            return Promise.reject(new Error('Fetch não disponível'));
        };
    }
}

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG';
const TELEGRAM_CHAT_ID = '-10025';

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
const CANDLE_CACHE_TTL = 45000;
const MARKET_DATA_CACHE_TTL = 30000;
const ORDERBOOK_CACHE_TTL = 20000;
const LSR_CACHE_TTL = 30000;
const FUNDING_CACHE_TTL = 30000;
const ATR_CACHE_TTL = 60000;
const VOLUME_CACHE_TTL = 30000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

// === CONFIGURAÇÕES PARA DETECÇÃO DE ZONAS ===
const ZONE_SETTINGS = {
    timeframe: '15m',
    lookbackPeriod: 100,
    proximityThreshold: 0.3,
    checkInterval: 30000,
    bidAskZoneSize: 0.25,
    requiredConfirmations: 2,
    maxConcurrentRequests: 3,
    requestTimeout: 15000,
    retryAttempts: 2,
    minBidAskVolume: 0.5,
    supportResistanceLookback: 50
};

// === CONFIGURAÇÕES PARA STOCHASTIC ===
const STOCHASTIC_12H_SETTINGS = {
    period: 5,
    smooth: 3,
    signalPeriod: 3,
    timeframe: '12h',
    requiredCandles: 20
};

const STOCHASTIC_DAILY_SETTINGS = {
    period: 5,
    smooth: 3,
    signalPeriod: 3,
    timeframe: '1d',
    requiredCandles: 30
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
// 🆕 CONFIGURAÇÕES PARA EMA 3 MINUTOS COM SUPORTE/RESISTÊNCIA ===
// =====================================================================

const EMA_ZONE_SETTINGS = {
    ema13Period: 13,
    ema34Period: 34,
    ema55Period: 55,
    timeframe: '3m',
    requiredCandles: 100,
    checkInterval: 60000, // Aumentado para 60s
    alertCooldown: 5 * 60 * 1000,
    alertGroups: 20, // Aumentado para 560 pares
    // Configurações para zona de suporte/resistência
    zoneProximity: 0.5,
    zoneTimeframe: '15m',
    minZoneStrength: 1,
    requireZoneConfirmation: true,
    // Configurações para 560+ pares
    maxPairs: 560, // Monitorar todos os pares
    minVolumeUSD: 50000, // Reduzido para $50k volume 24h
    minPrice: 0.000001, // Preço mínimo reduzido
    // Configurações para alvos ATR
    atrTimeframe: '15m', // 🆕 Alterado para 15m como solicitado
    atrPeriod: 14,
    targetMultipliers: [1, 2, 3], // Multiplicadores para 3 alvos
    stopLossMultiplier: 2, // Multiplicador para stop loss baseado no ATR
    minStopDistancePercent: 0.5, // Distância mínima do stop em %
    // 🆕 CRITÉRIOS DE VOLATILIDADE E VOLUME
    minVolatilityPercent: 0.6, // Volatilidade mínima (ATR %)
    maxVolatilityPercent: 10, // Volatilidade máxima (ATR %)
    requireVolumeSpike: true, // Volume spike OBRIGATÓRIO
    volumeSpikeMultiplier: 1.6 // Multiplicador mínimo para considerar spike
};

// =====================================================================
// 🆕 CONFIGURAÇÕES PARA ANÁLISE DE VOLUME 3 MINUTOS ===
// =====================================================================

const VOLUME_SETTINGS = {
    timeframe: '3m', // 🆕 Timeframe 3m para volume spike
    lookbackCandles: 5,
    minVolumeThreshold: 0.8, // Multiplicador da média para considerar volume significativo
    volumeRatioThreshold: 1.5, // Razão compra/venda para considerar dominante
    buyPressureThreshold: 60, // % mínimo para pressão compradora
    sellPressureThreshold: 60, // % mínimo para pressão vendedora
    volumeSpikeMultiplier: 2.0, // Multiplicador para considerar spike de volume
    accumulationMultiplier: 1.3, // Multiplicador para considerar acumulação
    distributionMultiplier: 1.3 // Multiplicador para considerar distribuição
};

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
            // Fallback mínimo
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
            return true; // Fallback: permitir execução
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
// 🚀 RATE LIMITER ROBUSTO PARA 560+ PARES
// =====================================================================

class IntelligentRateLimiter {
    constructor() {
        try {
            // Janelas de rate limit da Binance
            this.minuteWindow = { start: Date.now(), usedWeight: 0, capacity: 2400 }; // 2400/min para Futures
            this.secondWindow = { start: Date.now(), usedWeight: 0, capacity: 100 }; // 100/seg
            this.dailyWindow = { start: Date.now(), usedWeight: 0, capacity: 300000 }; // 300k/dia
            
            // Controle de circuit breaker
            this.circuitBreaker = new CircuitBreaker();
            
            // Sistema de filas
            this.requestQueue = [];
            this.priorityQueue = [];
            this.isProcessing = false;
            
            // Estatísticas e monitoramento
            this.totalRequests = 0;
            this.failedRequests = 0;
            this.successfulRequests = 0;
            this.lastStatusLog = Date.now();
            this.lastRateAdjustment = Date.now();
            
            // Controle adaptativo
            this.baseDelay = 150;
            this.currentDelay = 150;
            this.minDelay = 80;
            this.maxDelay = 3000;
            
            // Limites por endpoint
            this.endpointWeights = {
                'klines': 1,
                'depth': 2,
                'ticker': 1,
                'ticker24hr': 1, // Para pegar todos tickers
                'exchangeInfo': 10,
                'globalLongShort': 1,
                'fundingRate': 1,
                'ping': 0 // Peso zero para ping
            };
            
            // Controle de burst
            this.burstMode = false;
            this.burstEndTime = 0;
            this.burstRequestCount = 0;
            
            // Controle de prioridade
            this.priorityLevels = {
                HIGH: 1,    // Para dados essenciais (candles principais)
                MEDIUM: 2,  // Para dados secundários
                LOW: 3      // Para dados não críticos
            };
            
            console.log('🚀 Rate Limiter Inteligente inicializado para 560+ pares');
            console.log('📊 Capacidade: 2400/min, 100/seg, 300k/dia');
        } catch (error) {
            console.error('❌ Erro ao inicializar RateLimiter:', error.message);
            // Fallback mínimo
            this.circuitBreaker = { canExecute: () => true };
            this.endpointWeights = { 'default': 1 };
            this.currentDelay = 500;
        }
    }

    // Método principal para fazer requests
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

                    // Adicionar à fila apropriada
                    if (priority === 'HIGH') {
                        this.priorityQueue.push(request);
                    } else {
                        this.requestQueue.push(request);
                    }
                    
                    this.totalRequests++;

                    // Iniciar processamento se não estiver rodando
                    if (!this.isProcessing) {
                        this.processQueues();
                    }

                    // Timeout para evitar requests pendentes eternamente
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

    // Remover request das filas
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

    // Processar filas
    async processQueues() {
        if (this.isProcessing) return;
        
        this.isProcessing = true;
        
        try {
            while (this.priorityQueue.length > 0 || this.requestQueue.length > 0) {
                // Verificar circuit breaker
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(5000);
                    continue;
                }

                // Pegar próximo request (prioridade primeiro)
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

                // Verificar limites de rate
                if (!this.checkLimits(request.weight)) {
                    // Recolocar na fila (manter prioridade)
                    if (request.priority === 1) {
                        this.priorityQueue.unshift(request);
                    } else {
                        this.requestQueue.unshift(request);
                    }
                    
                    await this.waitForLimits(request.weight);
                    continue;
                }

                // Executar request
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
                    
                    // Tentar retry se apropriado
                    if (request.retryCount < ZONE_SETTINGS.retryAttempts) {
                        request.retryCount++;
                        request.timeout = Math.min(30000, request.timeout * 1.5);
                        
                        // Recolocar na fila com prioridade reduzida
                        if (request.priority === 1) {
                            this.priorityQueue.unshift(request);
                        } else {
                            this.requestQueue.unshift(request);
                        }
                        
                        await this.delay(2000 * request.retryCount);
                    }
                }

                // Delay adaptativo entre requests
                await this.delay(this.currentDelay);
                
                // Processar em lotes pequenos para ser responsivo
                if (this.totalRequests % 10 === 0) {
                    await this.delay(10); // Pequena pausa
                }
            }
        } catch (error) {
            console.error('❌ Erro em processQueues:', error.message);
        } finally {
            this.isProcessing = false;
        }

        // Log de status periódico
        if (Date.now() - this.lastStatusLog >= 30000) {
            this.logStatus();
            this.lastStatusLog = Date.now();
        }
    }

    // Verificar limites de rate
    checkLimits(weight) {
        try {
            const now = Date.now();
            
            // Resetar janelas se expiradas
            if (now - this.minuteWindow.start >= 60000) {
                this.minuteWindow = { start: now, usedWeight: 0, capacity: 2400 };
            }
            
            if (now - this.secondWindow.start >= 1000) {
                this.secondWindow = { start: now, usedWeight: 0, capacity: 100 };
            }
            
            if (now - this.dailyWindow.start >= 86400000) {
                this.dailyWindow = { start: now, usedWeight: 0, capacity: 300000 };
            }
            
            // Calcular uso percentual
            const minuteUsage = (this.minuteWindow.usedWeight + weight) / this.minuteWindow.capacity;
            const secondUsage = (this.secondWindow.usedWeight + weight) / this.secondWindow.capacity;
            const dailyUsage = (this.dailyWindow.usedWeight + weight) / this.dailyWindow.capacity;
            
            // Permitir burst controlado
            if (this.burstMode && now < this.burstEndTime) {
                return minuteUsage < 0.95 && secondUsage < 0.9;
            }
            
            // Limites normais (mais conservadores para muitos pares)
            return minuteUsage < 0.8 && secondUsage < 0.75 && dailyUsage < 0.9;
        } catch (error) {
            console.error('❌ Erro em checkLimits:', error.message);
            return true; // Fallback: permitir execução
        }
    }

    // Ajustar delay baseado no uso
    adjustDelayBasedOnUsage() {
        try {
            const now = Date.now();
            const minuteUsage = this.minuteWindow.usedWeight / this.minuteWindow.capacity;
            
            // Ajustar delay baseado no uso
            if (minuteUsage > 0.7) {
                // Uso alto, aumentar delay
                this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 1.3);
                this.burstMode = false;
            } else if (minuteUsage < 0.3 && now - this.lastRateAdjustment > 30000) {
                // Uso baixo, reduzir delay gradualmente
                this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.9);
                this.lastRateAdjustment = now;
                
                // Entrar em modo burst se uso muito baixo
                if (minuteUsage < 0.2 && !this.burstMode) {
                    this.burstMode = true;
                    this.burstEndTime = now + 10000; // 10 segundos de burst
                    this.burstRequestCount = 0;
                }
            }
            
            // Verificar se burst acabou
            if (this.burstMode && now >= this.burstEndTime) {
                this.burstMode = false;
                this.currentDelay = this.baseDelay;
            }
        } catch (error) {
            console.error('❌ Erro em adjustDelayBasedOnUsage:', error.message);
        }
    }

    // Aguardar quando limites estão próximos
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
            await this.delay(1000); // Fallback delay
        }
    }

    // Executar request
    async executeRequest(request) {
        for (let attempt = 0; attempt <= request.retryCount + 1; attempt++) {
            try {
                if (attempt > 0) {
                    await this.delay(3000 * Math.pow(1.5, attempt - 1));
                }

                // Atualizar contadores
                this.updateCounters(request.weight);

                // Executar fetch com timeout
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
                
                // Verificar erros da API Binance
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
                
                // Se for 429, aumentar delay significativamente
                if (error.message && error.message.includes('429')) {
                    this.currentDelay = Math.min(this.maxDelay, this.currentDelay * 2);
                    await this.delay(5000);
                }
            }
        }
    }

    // Atualizar contadores
    updateCounters(weight) {
        try {
            const now = Date.now();
            
            // Resetar janelas se expiradas
            if (now - this.minuteWindow.start >= 60000) {
                this.minuteWindow = { start: now, usedWeight: 0, capacity: 2400 };
            }
            
            if (now - this.secondWindow.start >= 1000) {
                this.secondWindow = { start: now, usedWeight: 0, capacity: 100 };
            }
            
            if (now - this.dailyWindow.start >= 86400000) {
                this.dailyWindow = { start: now, usedWeight: 0, capacity: 300000 };
            }
            
            // Atualizar contadores
            this.minuteWindow.usedWeight += weight;
            this.secondWindow.usedWeight += weight;
            this.dailyWindow.usedWeight += weight;
            
            // Contar burst requests
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
                resolve(); // Fallback: resolver imediatamente
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
            
            console.log(`📊 Rate Limit: ${minuteUsage}% min | ${secondUsage}% seg | Delay: ${avgDelay}ms`);
            console.log(`📈 Queue: ${queueSize} | Sucesso: ${successRate}% | Total: ${this.totalRequests}`);
            console.log(`🔄 Estado: ${this.burstMode ? 'BURST' : 'NORMAL'} | Circuit: ${this.circuitBreaker.state}`);
        } catch (error) {
            console.error('❌ Erro em logStatus:', error.message);
        }
    }

    // Método para obter estatísticas
    getStats() {
        try {
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
                burstMode: this.burstMode
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
    console.log('✅ RateLimiter inicializado');
} catch (error) {
    console.error('❌ Erro ao inicializar RateLimiter:', error.message);
    // Fallback mínimo para rateLimiter
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

// =====================================================================
// 🆕 FUNÇÃO PARA PEGAR TODOS OS PARES FUTURES (560+)
// =====================================================================

async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando TODOS os pares Futures da Binance...');
        
        // 1. Buscar exchange info para pegar todos os símbolos
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
        
        // 2. Filtrar apenas pares USDT em trading
        const usdtSymbols = exchangeInfo.symbols.filter(symbol => {
            return symbol.quoteAsset === 'USDT' && 
                   symbol.status === 'TRADING' &&
                   symbol.contractType === 'PERPETUAL';
        });
        
        console.log(`📊 ${usdtSymbols.length} pares USDT Perpetual em trading`);
        
        // 3. Buscar dados de volume para todos os pares de uma vez
        const allTickers = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/ticker/24hr',
            {},
            'ticker24hr',
            'MEDIUM'
        );
        
        // 4. Mapear tickers para fácil acesso
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
        
        // 5. Processar e filtrar símbolos
        const symbolsWithData = [];
        
        for (const symbolInfo of usdtSymbols) {
            const symbol = symbolInfo.symbol;
            
            try {
                // Excluir pares especiais
                const excludedTerms = ['BULL', 'BEAR', 'UP', 'DOWN', 'EUR', 'GBP', 'JPY', 'AUD', 'BRL'];
                if (excludedTerms.some(term => symbol.includes(term))) continue;
                
                // Obter dados do ticker
                const tickerData = tickerMap[symbol];
                if (!tickerData) continue;
                
                const quoteVolume = tickerData.quoteVolume;
                const lastPrice = tickerData.lastPrice;
                const priceChangePercent = Math.abs(tickerData.priceChangePercent);
                
                // Critérios de inclusão
                if (quoteVolume >= EMA_ZONE_SETTINGS.minVolumeUSD && 
                    lastPrice >= EMA_ZONE_SETTINGS.minPrice &&
                    priceChangePercent < 100) { // Evitar movimentos extremos
                    
                    symbolsWithData.push({
                        symbol: symbol,
                        volume: quoteVolume,
                        price: lastPrice,
                        priceChange: tickerData.priceChangePercent,
                        trades: 0 // Não disponível no endpoint 24hr
                    });
                }
            } catch (error) {
                console.log(`⚠️ Erro processando símbolo ${symbol}:`, error.message);
                continue;
            }
        }
        
        console.log(`✅ ${symbolsWithData.length} pares USDT com volume suficiente`);
        
        // 6. Ordenar por volume (mais líquido primeiro)
        symbolsWithData.sort((a, b) => b.volume - a.volume);
        
        // 7. Limitar ao máximo configurado
        const selectedSymbols = symbolsWithData
            .slice(0, EMA_ZONE_SETTINGS.maxPairs)
            .map(item => item.symbol);
        
        // 8. Log detalhado
        console.log(`\n📊 ${selectedSymbols.length} PARES SELECIONADOS:`);
        
        // Agrupar por categorias de volume
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
                // Calcular volume total da categoria
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
        
        // Fallback: lista dos mais líquidos
        console.log('⚠️ Usando lista de fallback com 100 pares');
        return getDefaultSymbols().slice(0, 100);
    }
}

// Função fallback com símbolos padrão
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
            'LITUSDT', 'SFPUSDT', 'DODOUSDT', 'TRUUSDT', 'LINAUSDT', 'PERLUSDT',
            'RLCUSDT', 'WRXUSDT', 'VGXUSDT', 'FETUSDT', 'CVCUSDT', 'AGLDUSDT',
            'NKNUSDT', 'ROSEUSDT', 'AVAUSDT', 'FIOUSDT', 'ALICEUSDT', 'APEUSDT'
        ];
    } catch (error) {
        console.error('❌ Erro em getDefaultSymbols:', error.message);
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']; // Fallback mínimo
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

async function getOrderBook(symbol, limit = 100) {
    try {
        const cacheKey = `orderbook_${symbol}_${limit}`;
        const now = Date.now();

        if (orderBookCache[cacheKey] && now - orderBookCache[cacheKey].timestamp < ORDERBOOK_CACHE_TTL) {
            return orderBookCache[cacheKey].data;
        }

        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${Math.min(limit, 100)}`;

        const data = await rateLimiter.makeRequest(url, {}, 'depth', 'LOW');

        if (!data || !data.bids || !data.asks) {
            console.log(`⚠️ Dados de orderbook inválidos para ${symbol}`);
            return null;
        }

        const orderBook = {
            bids: data.bids.map(bid => ({ price: parseFloat(bid[0]) || 0, quantity: parseFloat(bid[1]) || 0 })),
            asks: data.asks.map(ask => ({ price: parseFloat(ask[0]) || 0, quantity: parseFloat(ask[1]) || 0 }))
        };

        orderBookCache[cacheKey] = { data: orderBook, timestamp: now };
        return orderBook;
    } catch (error) {
        console.log(`⚠️ Erro orderbook ${symbol}: ${error.message}`);
        return null;
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
// 📊 FUNÇÕES PARA LSR E FUNDING RATE (DO ORIGINAL)
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
// 📊 FUNÇÃO PARA CALCULAR ATR (AVERAGE TRUE RANGE) - AJUSTADO PARA 15m
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

        const trueRanges = [];
        
        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i - 1];
            
            const highLow = current.high - current.low;
            const highClose = Math.abs(current.high - previous.close);
            const lowClose = Math.abs(current.low - previous.close);
            
            const trueRange = Math.max(highLow, highClose, lowClose);
            trueRanges.push(trueRange);
        }
        
        // Calcular ATR (média móvel simples dos true ranges)
        let atrSum = 0;
        for (let i = 0; i < period; i++) {
            atrSum += trueRanges[i] || 0;
        }
        
        const atr = atrSum / period;
        
        // Calcular porcentagem do ATR em relação ao preço
        const currentPrice = candles[candles.length - 1].close;
        const atrPercent = (atr / currentPrice) * 100;
        
        // 🆕 VERIFICAR SE ATENDE CRITÉRIOS DE VOLATILIDADE (15m)
        const meetsVolatilityCriteria = atrPercent >= EMA_ZONE_SETTINGS.minVolatilityPercent && 
                                       atrPercent <= EMA_ZONE_SETTINGS.maxVolatilityPercent;
        
        // Classificar volatilidade
        let volatilityLevel = 'BAIXA';
        let volatilityEmoji = '🟢';
        let volatilityStatus = '❌';
        
        if (atrPercent > 3) {
            volatilityLevel = 'ALTA';
            volatilityEmoji = '🔴🔴';
            volatilityStatus = meetsVolatilityCriteria ? '✅' : '❌';
        } else if (atrPercent > 1.5) {
            volatilityLevel = 'MÉDIA';
            volatilityEmoji = '🟡';
            volatilityStatus = meetsVolatilityCriteria ? '✅' : '❌';
        } else if (atrPercent >= EMA_ZONE_SETTINGS.minVolatilityPercent) {
            volatilityLevel = 'MÉDIA-BAIXA';
            volatilityEmoji = '🟢';
            volatilityStatus = meetsVolatilityCriteria ? '✅' : '❌';
        } else {
            volatilityLevel = 'MUITO BAIXA';
            volatilityEmoji = '⚫';
            volatilityStatus = '❌';
        }
        
        const result = {
            atrValue: atr,
            atrPercent: atrPercent,
            volatilityLevel: volatilityLevel,
            volatilityEmoji: volatilityEmoji,
            volatilityStatus: volatilityStatus,
            meetsVolatilityCriteria: meetsVolatilityCriteria,
            currentPrice: currentPrice,
            period: period,
            timeframe: timeframe,
            minRequired: EMA_ZONE_SETTINGS.minVolatilityPercent,
            maxAllowed: EMA_ZONE_SETTINGS.maxVolatilityPercent
        };
        
        atrCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🎯 FUNÇÃO PARA CALCULAR ALVOS BASEADOS NO ATR
// =====================================================================

async function calculateATRTargets(symbol, entryPrice, signalType) {
    try {
        // 🆕 Usar timeframe 15m para ATR como solicitado
        const atrData = await calculateATR(symbol, EMA_ZONE_SETTINGS.atrTimeframe, EMA_ZONE_SETTINGS.atrPeriod);
        
        if (!atrData || !atrData.atrValue) {
            // Fallback: usar valores padrão baseados no preço
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
            
            const adjustedStopLoss = stopDistancePercent < EMA_ZONE_SETTINGS.minStopDistancePercent
                ? signalType === 'COMPRA'
                    ? entryPrice - (entryPrice * (EMA_ZONE_SETTINGS.minStopDistancePercent / 100))
                    : entryPrice + (entryPrice * (EMA_ZONE_SETTINGS.minStopDistancePercent / 100))
                : stopLoss;
            
            return {
                targets: targets,
                stopLoss: adjustedStopLoss,
                atrValue: fallbackATR,
                atrPercent: 2.0,
                volatilityLevel: 'MÉDIA',
                volatilityEmoji: '🟡',
                volatilityStatus: '⚠️',
                meetsVolatilityCriteria: true,
                riskReward: (targets[0] ? (parseFloat(targets[0].distancePercent) / parseFloat(stopDistancePercent || 1)).toFixed(2) : '0')
            };
        }
        
        // Calcular alvos baseados no ATR
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
        
        // Calcular stop loss baseado no ATR
        const stopLoss = signalType === 'COMPRA' 
            ? entryPrice - (atrData.atrValue * EMA_ZONE_SETTINGS.stopLossMultiplier)
            : entryPrice + (atrData.atrValue * EMA_ZONE_SETTINGS.stopLossMultiplier);
        
        const stopDistancePercent = Math.abs((stopLoss - entryPrice) / entryPrice * 100).toFixed(2);
        
        // Verificar se o stop está muito próximo
        const adjustedStopLoss = stopDistancePercent < EMA_ZONE_SETTINGS.minStopDistancePercent
            ? signalType === 'COMPRA'
                ? entryPrice - (entryPrice * (EMA_ZONE_SETTINGS.minStopDistancePercent / 100))
                : entryPrice + (entryPrice * (EMA_ZONE_SETTINGS.minStopDistancePercent / 100))
            : stopLoss;
        
        // Calcular relação risco/recompensa
        const finalStopDistancePercent = Math.abs((adjustedStopLoss - entryPrice) / entryPrice * 100).toFixed(2);
        const riskReward = (parseFloat(targets[0]?.distancePercent || 0) / parseFloat(finalStopDistancePercent || 1)).toFixed(2);
        
        return {
            targets: targets,
            stopLoss: adjustedStopLoss,
            atrValue: atrData.atrValue,
            atrPercent: atrData.atrPercent,
            volatilityLevel: atrData.volatilityLevel,
            volatilityEmoji: atrData.volatilityEmoji,
            volatilityStatus: atrData.volatilityStatus,
            meetsVolatilityCriteria: atrData.meetsVolatilityCriteria,
            riskReward: riskReward
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular alvos ATR para ${symbol}: ${error.message}`);
        return null;
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

async function getRSI(symbol, timeframe = '1h', period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 10);
        if (candles.length < period + 10) return null;

        const closes = candles.map(c => c.close);
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i <= period; i++) {
            const difference = closes[i] - closes[i-1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        let status = 'NEUTRAL';
        let emoji = '⚪';
        
        if (rsi < 30) {
            status = 'OVERSOLD';
            emoji = '🟢';
        } else if (rsi < 40) {
            status = 'COMPRA';
            emoji = '🟢';
        } else if (rsi > 70) {
            status = 'OVERBOUGHT';
            emoji = '🔴';
        } else if (rsi > 60) {
            status = 'VENDA';
            emoji = '🔴';
        }
        
        return {
            value: rsi,
            status: status,
            emoji: emoji
        };
    } catch (error) {
        console.log(`⚠️ Erro RSI ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR EMA 13, 34, 55 NO TIMEFRAME 3 MINUTOS
// =====================================================================

async function checkEMA3133455(symbol) {
    try {
        const candles = await getCandlesCached(symbol, EMA_ZONE_SETTINGS.timeframe, EMA_ZONE_SETTINGS.requiredCandles);
        
        if (candles.length < EMA_ZONE_SETTINGS.requiredCandles) {
            return null;
        }

        // Extrair preços de fechamento
        const closes = candles.map(c => c.close);
        
        // Calcular EMA 13, 34, 55
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
        
        // Obter os últimos valores
        const currentEma13 = ema13Values[ema13Values.length - 1];
        const currentEma34 = ema34Values[ema34Values.length - 1];
        const currentEma55 = ema55Values[ema55Values.length - 1];
        
        const previousEma13 = ema13Values[ema13Values.length - 2];
        const previousEma34 = ema34Values[ema34Values.length - 2];
        
        // Verificar cruzamento de EMA 13 com EMA 34
        const ema13AboveEma34 = currentEma13 > currentEma34;
        const previousEma13AboveEma34 = previousEma13 > previousEma34;
        
        const ema13BelowEma34 = currentEma13 < currentEma34;
        const previousEma13BelowEma34 = previousEma13 < previousEma34;
        
        // Preço atual (último fechamento)
        const currentPrice = closes[closes.length - 1];
        
        // Verificar posição do preço em relação à EMA 55
        const priceAboveEma55 = currentPrice > currentEma55;
        const priceBelowEma55 = currentPrice < currentEma55;
        
        // Detectar cruzamentos
        let crossoverSignal = null;
        
        // COMPRA: EMA 13 cruza para CIMA da EMA 34 E preço fecha ACIMA da EMA 55
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
        // VENDA: EMA 13 cruza para BAIXO da EMA 34 E preço fecha ABAIXO da EMA 55
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
// 🆕 FUNÇÃO PARA ANÁLISE DE VOLUME COMPRADOR/VENDEDOR 3 MINUTOS
// =====================================================================

async function analyzeVolume3m(symbol, priceAction) {
    try {
        const cacheKey = `volume_3m_${symbol}`;
        const now = Date.now();
        
        if (volumeCache[cacheKey] && now - volumeCache[cacheKey].timestamp < VOLUME_CACHE_TTL) {
            return volumeCache[cacheKey].data;
        }
        
        // Buscar candles dos últimos 3 minutos
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
        
        // Pegar as últimas candles para análise
        const recentCandles = candles.slice(-VOLUME_SETTINGS.lookbackCandles);
        
        // Calcular volume médio
        const averageVolume = recentCandles.reduce((sum, candle) => sum + candle.volume, 0) / recentCandles.length;
        
        // Último candle para análise detalhada
        const lastCandle = recentCandles[recentCandles.length - 1];
        
        // Análise de volume comprador vs vendedor
        const currentVolume = lastCandle.volume;
        
        // Volume comprador estimado
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
        
        // Calcular razão comprador/vendedor
        const volumeRatio = volumeSeller > 0 ? volumeBuyer / volumeSeller : 0;
        
        // Calcular multiplicador de spike (3m)
        const volumeSpikeMultiplier = averageVolume > 0 ? currentVolume / averageVolume : 0;
        
        // 🆕 VERIFICAR CRITÉRIO DE VOLUME SPIKE (3m)
        const meetsVolumeSpikeCriteria = EMA_ZONE_SETTINGS.requireVolumeSpike ? 
            volumeSpikeMultiplier >= EMA_ZONE_SETTINGS.volumeSpikeMultiplier : true;
        
        // Determinar lado dominante
        let dominantSide = 'NEUTRAL';
        let volumeStrength = 'BAIXA';
        let volumeSpike = false;
        let accumulation = false;
        let distribution = false;
        
        // Verificar spike de volume (3m)
        if (volumeSpikeMultiplier >= EMA_ZONE_SETTINGS.volumeSpikeMultiplier) {
            volumeSpike = true;
            volumeStrength = 'ALTA';
        } else if (currentVolume > averageVolume * VOLUME_SETTINGS.minVolumeThreshold) {
            volumeStrength = 'MÉDIA';
        }
        
        // Determinar lado dominante
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
        
        // Calcular pressão percentual
        const totalVolume = volumeBuyer + volumeSeller;
        const buyerPressure = totalVolume > 0 ? (volumeBuyer / totalVolume) * 100 : 0;
        const sellerPressure = totalVolume > 0 ? (volumeSeller / totalVolume) * 100 : 0;
        
        // Análise contextual
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
        
        // Formatar para exibição
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
// 🆕 FUNÇÃO PARA VERIFICAR SUPORTE/RESISTÊNCIA E DEPOIS EMA - ATUALIZADA
// =====================================================================

async function checkZoneThenEMA(symbol) {
    try {
        // 1. PRIMEIRO: Verificar se está perto de suporte/resistência (15m)
        const zones = await getSupportResistanceLevels(symbol, EMA_ZONE_SETTINGS.zoneTimeframe);
        const marketData = await getMarketData(symbol);
        
        if (!marketData || !zones || zones.length === 0) {
            return null;
        }
        
        const currentPrice = marketData.lastPrice;
        let nearZone = null;
        
        // Verificar se está perto de alguma zona
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
            return null;
        }
        
        // 2. SEGUNDO: Verificar cruzamento das EMAs (3m)
        const emaData = await checkEMA3133455(symbol);
        
        if (!emaData || !emaData.crossover) {
            return null;
        }
        
        // 3. 🆕 TERCEIRO: VERIFICAR VOLATILIDADE (ATR 15m) - COMO SOLICITADO
        const atrData = await calculateATR(symbol, EMA_ZONE_SETTINGS.atrTimeframe, EMA_ZONE_SETTINGS.atrPeriod);
        
        if (!atrData || !atrData.meetsVolatilityCriteria) {
            console.log(`   ${symbol}: Volatilidade fora dos critérios (${atrData?.atrPercent?.toFixed(2) || 'N/A'}% vs min ${EMA_ZONE_SETTINGS.minVolatilityPercent}%)`);
            return null;
        }
        
        // 4. VERIFICAR SE O SINAL DE EMA CORRESPONDE À ZONA
        const isBuySignal = emaData.crossover.type === 'COMPRA';
        const isSellSignal = emaData.crossover.type === 'VENDA';
        
        // Compra: deve estar perto de SUPORTE
        if (isBuySignal && !nearZone.isSupport) {
            return null;
        }
        
        // Venda: deve estar perto de RESISTÊNCIA
        if (isSellSignal && !nearZone.isResistance) {
            return null;
        }
        
        // 5. ANALISAR VOLUME 3M PARA CONFIRMAÇÃO (COMO SOLICITADO)
        const priceAction = isBuySignal ? 'ALTA' : 'BAIXA';
        const volumeAnalysis = await analyzeVolume3m(symbol, priceAction);
        
        // 6. 🆕 VERIFICAR CRITÉRIOS DE VOLUME SPIKE OBRIGATÓRIO (3m)
        if (EMA_ZONE_SETTINGS.requireVolumeSpike && !volumeAnalysis.meetsVolumeSpikeCriteria) {
            console.log(`   ${symbol}: Volume spike insuficiente (${volumeAnalysis.volumeSpikeMultiplier}x vs mínimo ${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x)`);
            return null;
        }
        
        // 7. VERIFICAR CRITÉRIO DE VOLUME PARA COMPRA/VENDA
        let volumeCriteriaMet = false;
        
        if (isBuySignal) {
            volumeCriteriaMet = volumeAnalysis.dominantSide === 'COMPRADOR' && 
                               parseFloat(volumeAnalysis.volumeRatio) > VOLUME_SETTINGS.volumeRatioThreshold &&
                               parseFloat(volumeAnalysis.buyerPressure) > VOLUME_SETTINGS.buyPressureThreshold;
        } else if (isSellSignal) {
            volumeCriteriaMet = volumeAnalysis.dominantSide === 'VENDEDOR' && 
                               parseFloat(volumeAnalysis.volumeRatio) < (1 / VOLUME_SETTINGS.volumeRatioThreshold) &&
                               parseFloat(volumeAnalysis.sellerPressure) > VOLUME_SETTINGS.sellPressureThreshold;
        }
        
        // 8. Calcular confiança considerando todos os fatores
        const baseConfidence = 60;
        const zoneBoost = nearZone.strength * 5;
        const volatilityBoost = atrData.meetsVolatilityCriteria ? 15 : 0;
        const volumeSpikeBoost = volumeAnalysis.meetsVolumeSpikeCriteria ? 10 : 0;
        const volumeCriteriaBoost = volumeCriteriaMet ? 15 : 0;
        
        const finalConfidence = Math.min(95, baseConfidence + zoneBoost + volatilityBoost + volumeSpikeBoost + volumeCriteriaBoost);
        
        // 9. 🆕 Só retornar se TODOS os critérios obrigatórios forem atendidos
        const allCriteriaMet = 
            atrData.meetsVolatilityCriteria && // Volatilidade mínima (15m)
            (!EMA_ZONE_SETTINGS.requireVolumeSpike || volumeAnalysis.meetsVolumeSpikeCriteria) && // Volume spike (3m) se obrigatório
            finalConfidence >= 70;
        
        if (!allCriteriaMet) {
            console.log(`   ${symbol}: Critérios não atendidos - Conf: ${finalConfidence}%, Vol: ${atrData.meetsVolatilityCriteria ? '✅' : '❌'}, Spike: ${volumeAnalysis.meetsVolumeSpikeCriteria ? '✅' : '❌'}`);
            return null;
        }
        
        return {
            symbol: symbol,
            zone: nearZone,
            ema: emaData,
            atrData: atrData, // ATR 15m
            marketData: marketData,
            volumeAnalysis: volumeAnalysis, // Volume 3m
            signalType: emaData.crossover.type,
            volumeCriteriaMet: volumeCriteriaMet,
            confidence: finalConfidence,
            allCriteriaMet: allCriteriaMet
        };
        
    } catch (error) {
        console.log(`⚠️ Erro checkZoneThenEMA ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA ENVIAR ALERTA DE ZONA + EMA (VERSÃO SIMPLIFICADA)
// =====================================================================

async function sendZoneEMAAlert(setupData) {
    try {
        const { symbol, zone, ema, atrData, marketData, volumeAnalysis, signalType, volumeCriteriaMet, confidence } = setupData;
        
        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}&interval=3`;
        
        // Obter outros indicadores para contexto com fallbacks
        const [rsiData, lsrData, fundingData, btcStrength, atrTargets] = await Promise.allSettled([
            getRSI(symbol, '1h'),
            getBinanceLSRValue(symbol, '15m'),
            checkFundingRate(symbol),
            calculateBTCRelativeStrength(symbol),
            calculateATRTargets(symbol, ema.price, signalType)
        ]);
        
        const isBuySignal = signalType === 'COMPRA';
        const actionEmoji = isBuySignal ? '🟢' : '🔴';
        const zoneType = zone.isSupport ? 'SUPORTE' : 'RESISTÊNCIA';
        
        // Formatar LSR com fallback
        let lsrInfo = 'N/A';
        if (lsrData.status === 'fulfilled' && lsrData.value) {
            const lsr = lsrData.value;
            lsrInfo = `${lsr.lsrValue?.toFixed(3) || '0.000'} ${lsr.isRising ? '⬆️' : '⬇️'}`;
            if (lsr.percentChange !== '0.00') {
                lsrInfo += ` (${lsr.percentChange}%)`;
            }
        }
        
        // Formatar RSI com fallback
        const rsiInfo = rsiData.status === 'fulfilled' && rsiData.value ? 
            `${rsiData.value.emoji} ${rsiData.value.value?.toFixed(1) || '50.0'} (${rsiData.value.status || 'NEUTRAL'})` : 'N/A';
        
        // Formatar funding rate com fallback
        const fundingInfo = fundingData.status === 'fulfilled' && fundingData.value ? 
            fundingData.value.text : 'Indisponível';
        
        // Formatar força BTC com fallback
        const btcStrengthInfo = btcStrength.status === 'fulfilled' && btcStrength.value ? 
            `${btcStrength.value.emoji} ${btcStrength.value.status}` : 'N/A';
        
        // Formatar volume analysis
        let volumeEmoji = '⚪';
        if (volumeAnalysis.dominantSide === 'COMPRADOR') {
            volumeEmoji = volumeAnalysis.volumeSpike ? '📈📈' : '📈';
        } else if (volumeAnalysis.dominantSide === 'VENDEDOR') {
            volumeEmoji = volumeAnalysis.volumeSpike ? '📉📉' : '📉';
        }
        
        // Formatar alvos ATR com fallback
        let targetsText = '';
        let stopText = '';
        
        if (atrTargets.status === 'fulfilled' && atrTargets.value && atrTargets.value.targets) {
            // Alvos
            atrTargets.value.targets.forEach((target, index) => {
                targetsText += `• ${index + 1}º: $${(target.target || 0).toFixed(6)} (+${target.distancePercent || '0.00'}%)\n`;
            });
            
            // Stop
            stopText = `⚠️ Stop:\n• $${(atrTargets.value.stopLoss || 0).toFixed(6)}`;
        } else {
            targetsText = '⚠️ Alvos não disponíveis';
            stopText = '⚠️ Stop não disponível';
        }
        
        // MENSAGEM SIMPLIFICADA
        const message = `
${actionEmoji} ${symbol} - ${signalType}
${now.full} <a href="${tradingViewLink}">Gráfico</a>

 Nível de ${zoneType} (15m):
• ${zoneType}: $${(zone.price || 0).toFixed(6)}
• Distância: ${(zone.distancePercent || 0).toFixed(2)}%

 Indicadores Técnicos:
• RSI 1h: ${rsiInfo}
• LSR: ${lsrInfo}
• Funding Rate: ${fundingInfo}
• Força vs BTC: ${btcStrengthInfo}

💰 Vol:
• Comprador: ${volumeAnalysis.volumeBuyer} | Vendedor: ${volumeAnalysis.volumeSeller}
• Razão: ${volumeAnalysis.volumeRatio}:1 | Pressão: ${volumeAnalysis.buyerPressure}%/${volumeAnalysis.sellerPressure}%
• Dominante: ${volumeEmoji} ${volumeAnalysis.dominantSide}

🎯 Alvos:
${targetsText}
${stopText}

Titanium by @J4Rviz
        `;
        
        const sent = await sendTelegramAlert(message);
        
        if (sent) {
            console.log(`\n${actionEmoji} Alerta SIMPLIFICADO enviado: ${symbol} - ${signalType}`);
            console.log(`   ${zoneType}: $${(zone.price || 0).toFixed(6)} (${(zone.distancePercent || 0).toFixed(2)}%)`);
            console.log(`   EMA 13/34/55: $${(ema.ema13 || 0).toFixed(6)}/$${(ema.ema34 || 0).toFixed(6)}/$${(ema.ema55 || 0).toFixed(6)}`);
            console.log(`   Volume: ${volumeAnalysis.volumeBuyer} comprador | ${volumeAnalysis.volumeSeller} vendedor`);
            console.log(`   Razão: ${volumeAnalysis.volumeRatio}:1`);
            
            if (atrTargets.status === 'fulfilled' && atrTargets.value && atrTargets.value.targets) {
                console.log(`   Alvos:`);
                atrTargets.value.targets.forEach((target, index) => {
                    console.log(`     ${index + 1}º: $${(target.target || 0).toFixed(6)} (+${target.distancePercent || '0.00'}%)`);
                });
                console.log(`   Stop: $${(atrTargets.value.stopLoss || 0).toFixed(6)}`);
            }
        }
        
        return sent;
        
    } catch (error) {
        console.error(`Erro enviando alerta Zona+EMA ${symbol}:`, error.message);
        return false;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR FORÇA RELATIVA EM RELAÇÃO AO BTC
// =====================================================================

async function calculateBTCRelativeStrength(symbol) {
    try {
        if (symbol === 'BTCUSDT') {
            return {
                strengthScore: 50,
                status: 'NEUTRAL',
                emoji: '⚪',
                message: 'É o BTC'
            };
        }
        
        const settings = BTC_STRENGTH_SETTINGS;
        
        const assetCandles = await getCandlesCached(symbol, settings.timeframe, settings.lookbackPeriod);
        const btcCandles = await getCandlesCached(settings.btcSymbol, settings.timeframe, settings.lookbackPeriod);
        
        if (assetCandles.length < 5 || btcCandles.length < 5) {
            return {
                strengthScore: 50,
                status: 'NEUTRAL',
                emoji: '⚪',
                message: 'Dados insuficientes'
            };
        }

        const assetPriceChange = ((assetCandles[assetCandles.length - 1].close - assetCandles[0].close) / assetCandles[0].close) * 100;
        const btcPriceChange = ((btcCandles[btcCandles.length - 1].close - btcCandles[0].close) / btcCandles[0].close) * 100;
        
        const relativeChange = assetPriceChange - btcPriceChange;
        
        const assetVolumeAvg = assetCandles.reduce((sum, candle) => sum + candle.volume, 0) / assetCandles.length;
        const btcVolumeAvg = btcCandles.reduce((sum, candle) => sum + candle.volume, 0) / btcCandles.length;
        const volumeRatio = assetVolumeAvg / btcVolumeAvg;

        const weights = settings.strengthWeights;
        
        let priceStrength = 50;
        if (relativeChange > 5) priceStrength = 90;
        else if (relativeChange > 3) priceStrength = 75;
        else if (relativeChange > 1) priceStrength = 65;
        else if (relativeChange > 0) priceStrength = 55;
        else if (relativeChange > -1) priceStrength = 45;
        else if (relativeChange > -3) priceStrength = 35;
        else if (relativeChange > -5) priceStrength = 25;
        else priceStrength = 10;

        let volumeStrength = 50;
        if (volumeRatio > 0.05) volumeStrength = 80;
        else if (volumeRatio > 0.02) volumeStrength = 70;
        else if (volumeRatio > 0.01) volumeStrength = 60;
        else if (volumeRatio > 0.005) volumeStrength = 50;
        else if (volumeRatio > 0.002) volumeStrength = 40;
        else if (volumeRatio > 0.001) volumeStrength = 30;
        else volumeStrength = 20;

        const combinedScore = 
            (priceStrength * weights.priceChange) + 
            (volumeStrength * weights.volumeRatio) + 
            (50 * weights.dominance);

        let status, emoji;
        if (combinedScore >= settings.threshold.strongBuy) {
            status = 'FORTE PARA COMPRA';
            emoji = '🟢🟢🟢';
        } else if (combinedScore >= settings.threshold.moderateBuy) {
            status = 'MODERADO PARA COMPRA';
            emoji = '🟢🟢';
        } else if (combinedScore >= settings.threshold.neutral) {
            status = 'NEUTRO';
            emoji = '⚪';
        } else if (combinedScore >= settings.threshold.moderateSell) {
            status = 'MODERADO PARA VENDA';
            emoji = '🔴🔴';
        } else {
            status = 'FORTE PARA VENDA';
            emoji = '🔴🔴🔴';
        }

        return {
            strengthScore: Math.round(combinedScore),
            status: status,
            emoji: emoji,
            relativeChange: relativeChange,
            volumeRatio: volumeRatio
        };

    } catch (error) {
        console.log(`⚠️ Erro força BTC ${symbol}: ${error.message}`);
        return {
            strengthScore: 50,
            status: 'NEUTRAL',
            emoji: '⚪',
            message: 'Erro na análise'
        };
    }
}

// =====================================================================
// 🆕 MONITOR PARA ALERTAS DE ZONA + EMA (OTIMIZADO PARA 560+ PARES)
// =====================================================================

class ZoneEMAMonitor {
    constructor() {
        try {
            this.symbolGroups = [];
            this.currentGroupIndex = 0;
            this.alertCooldowns = new Map();
            this.totalAlertsSent = 0;
            this.lastAlertTime = new Map();
            this.confirmationTracker = new Map();
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
            
            // Criar grupos otimizados para 560+ pares
            const groupSize = Math.ceil(allSymbols.length / EMA_ZONE_SETTINGS.alertGroups);
            this.symbolGroups = this.createGroups(allSymbols, groupSize);
            
            console.log(`📊 ${allSymbols.length} pares selecionados`);
            console.log(`📊 ${this.symbolGroups.length} grupos de ${groupSize} pares cada`);
            console.log(`⏱️  Cada grupo será analisado a cada ${EMA_ZONE_SETTINGS.checkInterval/1000}s`);
            console.log(`⚡ CRITÉRIOS OBRIGATÓRIOS:`);
            console.log(`   • Volatilidade mínima: ${EMA_ZONE_SETTINGS.minVolatilityPercent}% ATR (15m)`);
            console.log(`   • Volume spike: ${EMA_ZONE_SETTINGS.requireVolumeSpike ? 'OBRIGATÓRIO' : 'OPCIONAL'} (${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x - 3m)`);
            console.log(`   • Confiança mínima: 70%`);
            
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
            return [symbols]; // Fallback: um grupo com todos os símbolos
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

    canSendAlert(symbol, signalType) {
        try {
            const key = `${symbol}_${signalType}`;
            const lastAlert = this.lastAlertTime.get(key);
            
            if (!lastAlert) return true;
            
            return Date.now() - lastAlert > EMA_ZONE_SETTINGS.alertCooldown;
        } catch (error) {
            console.error('❌ Erro em canSendAlert:', error.message);
            return true; // Fallback: permitir alerta
        }
    }

    recordAlert(symbol, signalType) {
        try {
            const key = `${symbol}_${signalType}`;
            this.lastAlertTime.set(key, Date.now());
            this.totalAlertsSent++;
            this.stats.alertsSent++;
            
            // Limpar alerts antigos
            const now = Date.now();
            for (const [k, timestamp] of this.lastAlertTime.entries()) {
                if (now - timestamp > 86400000) {
                    this.lastAlertTime.delete(k);
                }
            }
        } catch (error) {
            console.error('❌ Erro em recordAlert:', error.message);
        }
    }

    trackConfirmation(symbol, zonePrice, signalType) {
        try {
            const key = `${symbol}_${zonePrice.toFixed(6)}_${signalType}`;
            
            if (!this.confirmationTracker.has(key)) {
                this.confirmationTracker.set(key, {
                    count: 1,
                    firstSeen: Date.now(),
                    lastSeen: Date.now()
                });
            } else {
                const data = this.confirmationTracker.get(key);
                data.count++;
                data.lastSeen = Date.now();
            }
            
            const now = Date.now();
            for (const [k, data] of this.confirmationTracker.entries()) {
                if (now - data.lastSeen > 3600000) {
                    this.confirmationTracker.delete(k);
                }
            }
            
            const data = this.confirmationTracker.get(key);
            return data ? data.count : 0;
        } catch (error) {
            console.error('❌ Erro em trackConfirmation:', error.message);
            return 1; // Fallback: considerar como 1 confirmação
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
            let volumeCriteriaMatches = 0;
            let groupStartTime = Date.now();
            
            for (let i = 0; i < symbols.length; i++) {
                const symbol = symbols[i];
                try {
                    this.stats.totalAnalyzed++;
                    
                    // Delay adaptativo baseado na posição
                    const delay = i % 3 === 0 ? 300 : 150;
                    await new Promise(r => setTimeout(r, delay));
                    
                    // Verificar setup completo
                    const setupData = await checkZoneThenEMA(symbol);
                    
                    if (!setupData) {
                        continue;
                    }
                    
                    const { signalType, atrData, volumeAnalysis } = setupData;
                    
                    // Atualizar estatísticas de filtragem
                    if (!atrData?.meetsVolatilityCriteria) {
                        this.stats.volatilityFiltered++;
                    }
                    
                    if (EMA_ZONE_SETTINGS.requireVolumeSpike && !volumeAnalysis?.meetsVolumeSpikeCriteria) {
                        this.stats.volumeSpikeFiltered++;
                    }
                    
                    // Verificar confirmações
                    const confirmations = this.trackConfirmation(symbol, setupData.zone.price, signalType);
                    
                    if (confirmations >= 1 && this.canSendAlert(symbol, signalType)) {
                        this.stats.signalsFound++;
                        const sent = await sendZoneEMAAlert(setupData);
                        if (sent) {
                            this.recordAlert(symbol, signalType);
                            setupsFound++;
                            
                            if (volumeAnalysis.volumeCriteriaMet) {
                                volumeCriteriaMatches++;
                            }
                            
                            // Aguardar entre alerts para evitar spam
                            await new Promise(r => setTimeout(r, 1500));
                        }
                    } else if (confirmations >= 1) {
                        console.log(`   ⏱️  ${symbol}: Setup detectado mas em cooldown`);
                    }
                    
                } catch (error) {
                    console.log(`⚠️ Erro ${symbol}: ${error.message}`);
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            
            const groupTime = (Date.now() - groupStartTime) / 1000;
            
            if (setupsFound > 0) {
                console.log(`✅ ${setupsFound} setups encontrados (${volumeCriteriaMatches} com critério de volume) em ${groupTime.toFixed(1)}s`);
            } else {
                console.log(`⏭️  Nenhum setup encontrado neste grupo (${groupTime.toFixed(1)}s)`);
            }
            
            // Log de estatísticas a cada 3 ciclos
            if (this.cycleCount % 3 === 0) {
                this.logStats();
            }
            
        } catch (error) {
            console.error(`Erro no monitor Zona+EMA: ${error.message}`);
        }
    }

    logStats() {
        try {
            const uptime = Date.now() - this.stats.startTime;
            const hours = Math.floor(uptime / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            
            const successRate = this.stats.totalAnalyzed > 0 ? 
                ((this.stats.signalsFound / this.stats.totalAnalyzed) * 100).toFixed(2) : 0;
            
            const avgPerCycle = this.cycleCount > 0 ? 
                (this.stats.totalAnalyzed / this.cycleCount).toFixed(0) : 0;
            
            console.log(`\n📊 ESTATÍSTICAS (${hours}h${minutes}m):`);
            console.log(`   • Ciclos completos: ${this.cycleCount}`);
            console.log(`   • Pares analisados: ${this.stats.totalAnalyzed} (${avgPerCycle}/ciclo)`);
            console.log(`   • Filtrados por volatilidade: ${this.stats.volatilityFiltered}`);
            console.log(`   • Filtrados por volume spike: ${this.stats.volumeSpikeFiltered}`);
            console.log(`   • Sinais encontrados: ${this.stats.signalsFound}`);
            console.log(`   • Alertas enviados: ${this.stats.alertsSent}`);
            console.log(`   • Taxa de sucesso: ${successRate}%`);
            console.log(`   • Alertas ativos em cooldown: ${this.lastAlertTime.size}`);
            
            // Log do rate limiter
            const rateLimiterStats = rateLimiter.getStats();
            console.log(`   • Rate Limit: ${rateLimiterStats.minuteUsage || '0'}% usado`);
            console.log(`   • Delay atual: ${rateLimiterStats.currentDelay || '1000'}ms`);
            console.log(`   • Sucesso requests: ${rateLimiterStats.successRate || '0'}%`);
        } catch (error) {
            console.error('❌ Erro em logStats:', error.message);
        }
    }
}

// =====================================================================
// 🔄 MONITORAMENTO PRINCIPAL COM ZONA + EMA (560+ PARES)
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

    console.log(`\n🚨 SISTEMA DE ALERTA ZONA + EMA - 560+ PARES`);
    console.log(`📊 Monitorando TODOS os pares USDT Perpetual da Binance`);
    console.log(`📊 Sequência: Suporte/Resistência (15m) → EMA 13/34/55 (3m)`);
    console.log(`⚡ CRITÉRIOS OBRIGATÓRIOS:`);
    console.log(`   • Volatilidade mínima: ${EMA_ZONE_SETTINGS.minVolatilityPercent}% ATR (15m)`);
    console.log(`   • Volume spike: ${EMA_ZONE_SETTINGS.requireVolumeSpike ? 'OBRIGATÓRIO' : 'OPCIONAL'} (${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x - 3m)`);
    console.log(`   • Confiança mínima: 70%`);
    console.log(`💰 Critério COMPRA: Volume comprador > ${VOLUME_SETTINGS.volumeRatioThreshold}:1 e > ${VOLUME_SETTINGS.buyPressureThreshold}% pressão`);
    console.log(`💰 Critério VENDA: Volume vendedor > ${VOLUME_SETTINGS.volumeRatioThreshold}:1 e > ${VOLUME_SETTINGS.sellPressureThreshold}% pressão`);
    console.log(`🎯 Alvos: 3 alvos baseados no ATR (1x, 2x, 3x)`);
    console.log(`🛡️  Stop: Adaptativo por volatilidade (ATR * 2)`);
    console.log(`⏱️  Intervalo: ${EMA_ZONE_SETTINGS.checkInterval / 1000}s entre grupos`);
    console.log(`💰 Volume mínimo: $${(EMA_ZONE_SETTINGS.minVolumeUSD/1000).toFixed(0)}k 24h`);
    console.log(`🤖 Iniciando monitoramento de 560+ pares...\n`);

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
            
            // Monitorar sinais de zona + EMA
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

        console.log('\n' + '='.repeat(80));
        console.log('🚨 TITANIUM ALERT SYSTEM - 560+ PARES');
        console.log('📊 Monitorando TODOS os pares USDT Perpetual da Binance');
        console.log(`⏱️  Timeframes: ${EMA_ZONE_SETTINGS.timeframe} (EMA) | ${EMA_ZONE_SETTINGS.zoneTimeframe} (Zonas)`);
        console.log(`⚡ CRITÉRIOS OBRIGATÓRIOS:`);
        console.log(`   • Volatilidade mínima: ${EMA_ZONE_SETTINGS.minVolatilityPercent}% ATR (15m)`);
        console.log(`   • Volume spike: ${EMA_ZONE_SETTINGS.requireVolumeSpike ? 'OBRIGATÓRIO' : 'OPCIONAL'} (${EMA_ZONE_SETTINGS.volumeSpikeMultiplier}x - 3m)`);
        console.log(`   • Confiança mínima: 70%`);
        console.log(`💰 Critério COMPRA: Volume comprador > ${VOLUME_SETTINGS.volumeRatioThreshold}:1`);
        console.log(`💰 Critério VENDA: Volume vendedor > ${VOLUME_SETTINGS.volumeRatioThreshold}:1`);
        console.log(`🎯 Alvos: 3 alvos dinâmicos baseados no ATR`);
        console.log(`🛡️  Stop Loss: Adaptativo por volatilidade do ativo`);
        console.log(`💰 Volume mínimo: $${(EMA_ZONE_SETTINGS.minVolumeUSD/1000).toFixed(0)}k 24h`);
        console.log(`📍 Proximidade: ${EMA_ZONE_SETTINGS.zoneProximity}% da zona`);
        console.log(`⚡ Rate Limit: 2400/min, 100/seg - Sistema adaptativo inteligente`);
        console.log('⚠️  Alerta só após setup completo (Zona → EMA → Volume → Volatilidade → Preço/EMA55)');
        console.log('='.repeat(80) + '\n');

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

        console.log('✅ Iniciando monitoramento de 560+ pares...');

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

// Função wrapper para iniciar com segurança
async function startBotSafely() {
    try {
        await startZoneEMABot();
    } catch (error) {
        console.error('❌ Erro fatal ao iniciar bot:', error.message);
        console.log('🔄 Tentando reiniciar em 60 segundos...');
        setTimeout(startBotSafely, 60000);
    }
}

// Iniciar o bot Zona+EMA
startBotSafely();
