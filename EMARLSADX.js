const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J5OE6G1dTJVfP7dGqPQCqPv6A';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === NOVO: SISTEMA DE PARALELISMO COM THREADS VIRTUAIS ===
const PARALLEL_CONFIG = {
    enabled: true,
    maxConcurrentCalculations: 4,
    calculationTimeout: 5000
};

// === CONFIGURAÇÃO DE CACHE DIFERENCIADO POR TIPO ===
const CACHE_CONFIG = {
    'volume_3m': 12000,       // ↓ 12s → responde mais rápido a mudanças
    'rsi_1h': 60000,          // 1 minuto
    'pivot_1d': 3600000,      // 1 hora
    'candles_15m': 90000,     // ↓ 90s → atualiza candles mais rápido
    'candles_1h': 300000,     // 5 minutos
    'lsr': 25000,             // ↓ 25s → LSR mais fresco
    'funding': 60000,         // 1 minuto
    'ticker': 25000,          // ↓ 25s → liquidez mais atualizada
    'exchange_info': 300000   // 5 minutos
};

// === CONFIGURAÇÕES DE VOLUME MÍNIMO ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.25,      // ↓ aceita volume "baixo-moderado" se outros fatores confirmarem
    combinedScore: 0.35,      // ↓ ligeiramente mais flexível
    classification: 'BAIXO',  // ↓ agora aceita até "BAIXO" com confirmação cruzada
    requireConfirmation: true
};

// === CONFIGURAÇÕES OTIMIZADAS BASEADAS NO APRENDIZADO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.7,       // ↓ de 1.9 → aceita setups iniciais mais suaves
    minThreshold: 1.5,        // ↓
    maxThreshold: 2.8,
    volatilityMultiplier: 0.35, // ↑ ligeiramente mais sensível em dias voláteis
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO ATUALIZADAS PARA 3m ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 18,            // ↓ mais responsivo (de 20 → 18)
    emaAlpha: 0.28,           // ↑ mais peso no volume recente
    baseZScoreLookback: 30,   // ↓ mais ágil (de 35 → 30)
    minZScoreLookback: 12,    // ↓
    maxZScoreLookback: 50,    // ↓
    zScoreThreshold: 1.6,     // ↓ aceita volumes "acima do normal", não só outliers
    vptThreshold: 0.35,       // ↓ mais sensível a micro-movimentos com volume
    minPriceMovement: 0.10,   // ↓ de 0.12% → captura movimentos menores
    combinedMultiplier: 1.2,  // ↑ bônus maior para volume + preço alinhados
    volumeWeight: 0.35,
    emaWeight: 0.35,
    zScoreWeight: 0.2,
    vptWeight: 0.1,
    minimumThresholds: {
        combinedScore: 0.25,  // ↓ voltar para 0.25 (mas com early exit inteligente)
        emaRatio: 1.15,       // ↓ de 1.2 → aceita setups mais iniciais
        zScore: 0.35,         // ↓
        classification: 'BAIXO'
    }
};

const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.6; // ↓ de 0.8 → aceita mercados menos voláteis

// === CONFIGURAÇÕES LSR AJUSTADAS ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.8;   // ↑ um pouco mais rigoroso na compra (evita pumps falsos)
const LSR_SELL_THRESHOLD = 2.2;  // ↓ mais flexível na venda (captura quedas rápidas)

// === CONFIGURAÇÕES RSI OTIMIZADAS PARA MAIOR LUCRATIVIDADE ===
const RSI_BUY_MAX = 65;   // ↑ de 62 → ainda mais cedo em tendências fortes
const RSI_SELL_MIN = 62;  // ↓ de 65 → entra antes na reversão

const COOLDOWN_SETTINGS = {
    sameDirection: 20 * 60 * 1000, // ↓ de 30 → permite reentrada mais rápida
    oppositeDirection: 8 * 60 * 1000, // ↓ de 10
    useDifferentiated: true
};

// === QUALITY SCORE AJUSTADO - FOCO EM MOMENTUM INICIAL ===
const QUALITY_THRESHOLD = 70; // ↓ de 75 → permite setups promissores em formação
const QUALITY_WEIGHTS = {
    volume: 38,           // ↑ volume é seu núcleo absoluto
    oi: 10,               // ↓ ligeiramente menos peso
    volatility: 7,
    lsr: 10,              // ↓
    rsi: 13,              // ↑ RSI bem posicionado ganha mais peso
    emaAlignment: 15,     // ↑ mantém como pilar
    stoch1h: 9,           // ↑ Stoch 1h confirma momentum curto
    stoch4h: 4,           // ↓ quase desativado (só para validação secundária)
    cci4h: 6,             // ↓
    breakoutRisk: 13,     // ↑ risco de rompimento mal gerenciado é crítico
    supportResistance: 13, // ↑ distância de S/R é vital
    pivotPoints: 11,      // ↓ ligeiramente menos crítico
    funding: 10
};
// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1000,
    requestsPerSecond: 30,
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 1,
        openInterest: 1,
        fundingRate: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2200,
    maxWeightPerSecond: 40,
    retryConfig: {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        backoffFactor: 2.5
    },
    circuitBreaker: {
        failureThreshold: 8,
        resetTimeout: 90000,
        halfOpenMaxRequests: 3
    }
};

// === CONFIGURAÇÕES PARA RETRAÇÕES DINÂMICAS COM ATR ===
const RETRACEMENT_SETTINGS = {
    minPercentage: 0.25,
    maxPercentage: 0.50,
    useDynamicATR: true,
    atrMultiplierMin: 0.5,
    atrMultiplierMax: 1.0,
    volatilityAdjustment: {
        low: 1.0,
        medium: 1.2,
        high: 1.5
    }
};

// === CONFIGURAÇÕES DE STOP DINÂMICO ===
const DYNAMIC_STOP_SETTINGS = {
    baseATRMultiplier: 3.5,
    minStopPercentage: 2.0,
    maxStopPercentage: 8.0,
    volatilityBased: true,
    volatilityMultipliers: {
        low: 0.8,
        medium: 1.0,
        high: 1.3
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE SUPORTE/RESISTÊNCIA ===
const SUPPORT_RESISTANCE_SETTINGS = {
    lookbackPeriod: 50,
    timeframe: '15m',
    minTouchPoints: 2,
    proximityThreshold: 1.5,
    breakoutThreshold: 0.8,
    strongLevelThreshold: 3,
    recentPeriod: 20
};

// === CONFIGURAÇÕES PARA RISCO DE ROMPIMENTO ===
const BREAKOUT_RISK_SETTINGS = {
    highRiskDistance: 0.5,
    mediumRiskDistance: 1.0,
    lowRiskDistance: 2.0,
    safeDistance: 3.0
};

// === NOVA: CONFIGURAÇÕES PARA PIVOT POINTS MULTI-TIMEFRAME ===
const PIVOT_POINTS_SETTINGS = {
    timeframeStrengthWeights: {
        '15m': 1.0,
        '1h': 2.0,
        '4h': 3.0,
        '1d': 5.0
    },
    safeDistanceMultipliers: {
        'weak': 0.5,
        'moderate': 1.0,
        'strong': 1.5,
        'very_strong': 2.0
    },
    minDistance: 5,
    priceTolerance: 0.005,
    analyzeTimeframes: ['15m', '1h'],
    candlesPerTimeframe: {
        '15m': 50,
        '1h': 80,
        '4h': 80
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS OTIMIZADOS ===
const candleCache = {};
const CANDLE_CACHE_TTL = 120000;
const MAX_CACHE_AGE = 30 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 5 * 60 * 1000;
const OI_HISTORY_SIZE = 20;

// Cache adicional para volume analysis
const volumeAnalysisCache = {};
const VOLUME_CACHE_TTL = 30000;

// ATUALIZADO: Stochastic 1h com nova configuração 14,3,3
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

const CCI_4H_SETTINGS = {
    period: 20,
    maPeriod: 14,
    timeframe: '4h'
};

// AJUSTAR TARGETS PARA MAIS REALISTAS
const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_TIMEFRAME = '15m';

// =====================================================================
// 🔄 SISTEMA DE PARALELISMO PARA CÁLCULOS INTENSIVOS
// =====================================================================

class ParallelCalculationEngine {
    constructor() {
        this.taskQueue = [];
        this.activeTasks = 0;
        this.maxConcurrent = PARALLEL_CONFIG.maxConcurrentCalculations;
        this.results = new Map();
        this.isProcessing = false;
        
        console.log('⚡ Engine de Cálculo Paralelo inicializada');
    }

    // Método para executar cálculos pesados em paralelo
    async executeParallelCalculations(tasks) {
        if (!PARALLEL_CONFIG.enabled || tasks.length === 0) {
            // Fallback: execução sequencial
            const results = [];
            for (const task of tasks) {
                results.push(await this.executeTask(task));
            }
            return results;
        }

        return new Promise((resolve) => {
            const taskPromises = [];
            const batchSize = Math.min(this.maxConcurrent, tasks.length);
            
            // Dividir tasks em batches para processamento paralelo
            for (let i = 0; i < batchSize; i++) {
                taskPromises.push(this.processTaskBatch(tasks, i, batchSize));
            }
            
            Promise.all(taskPromises).then((batchResults) => {
                const allResults = [];
                batchResults.forEach(batch => {
                    allResults.push(...batch);
                });
                resolve(allResults);
            }).catch(() => {
                // Fallback em caso de erro
                this.executeSequentialFallback(tasks).then(resolve);
            });
        });
    }

    async processTaskBatch(tasks, startIndex, step) {
        const results = [];
        for (let i = startIndex; i < tasks.length; i += step) {
            try {
                const result = await this.executeTaskWithTimeout(tasks[i]);
                results.push(result);
            } catch (error) {
                console.log(`⚠️ Erro no cálculo paralelo: ${error.message}`);
                // Executar fallback sequencial para esta task
                const fallbackResult = await this.executeTask(tasks[i]);
                results.push(fallbackResult);
            }
        }
        return results;
    }

    async executeTaskWithTimeout(task) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Timeout no cálculo'));
            }, PARALLEL_CONFIG.calculationTimeout);

            this.executeTask(task).then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            }).catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }

    async executeTask(task) {
        try {
            switch (task.type) {
                case 'VOLUME_ZSCORE':
                    return this.calculateVolumeZScore(task.data);
                case 'PIVOT_POINTS':
                    return this.analyzePivotPointsInTimeframe(task.data);
                case 'EMA_CALCULATION':
                    return this.calculateEMAs(task.data);
                case 'ATR_CALCULATION':
                    return this.calculateATR(task.data);
                case 'RSI_CALCULATION':
                    return this.calculateRSI(task.data);
                case 'STOCH_CALCULATION':
                    return this.calculateStochastic(task.data);
                case 'CCI_CALCULATION':
                    return this.calculateCCI(task.data);
                default:
                    throw new Error(`Tipo de cálculo não suportado: ${task.type}`);
            }
        } catch (error) {
            console.error(`Erro no cálculo ${task.type}:`, error.message);
            throw error;
        }
    }

    // Métodos de cálculo otimizados para execução paralela
    calculateVolumeZScore(data) {
        const { volumes, lookback } = data;
        
        if (volumes.length < lookback) {
            return {
                currentZScore: 0,
                mean: volumes[0] || 0,
                stdDev: 0,
                lookbackUsed: lookback,
                isOutlier: false
            };
        }
        
        const recentVolumes = volumes.slice(-lookback);
        const mean = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        
        let sumSquaredDifferences = 0;
        for (const volume of recentVolumes) {
            sumSquaredDifferences += Math.pow(volume - mean, 2);
        }
        const variance = sumSquaredDifferences / recentVolumes.length;
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

    analyzePivotPointsInTimeframe(data) {
        const { highs, lows, timeframe } = data;
        const minDistance = PIVOT_POINTS_SETTINGS.minDistance;
        
        const pivotHighs = this.findPivotHighs(highs, minDistance);
        const pivotLows = this.findPivotLows(lows, minDistance);
        
        return {
            pivotHighs,
            pivotLows,
            timeframe,
            count: pivotHighs.length + pivotLows.length
        };
    }

    findPivotHighs(highs, minDistance) {
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

    findPivotLows(lows, minDistance) {
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

    calculateEMAs(data) {
        const { values, periods } = data;
        const results = {};
        
        for (const period of periods) {
            if (values.length >= period) {
                const emaValues = EMA.calculate({ period, values });
                results[`ema${period}`] = emaValues[emaValues.length - 1];
                results[`ema${period}_previous`] = emaValues[emaValues.length - 2] || emaValues[emaValues.length - 1];
            }
        }
        
        return results;
    }

    calculateATR(data) {
        const { highs, lows, closes, period } = data;
        
        if (highs.length < period || lows.length < period || closes.length < period) {
            return null;
        }
        
        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });
        
        if (!atrValues || atrValues.length === 0) {
            return null;
        }
        
        const latestATR = atrValues[atrValues.length - 1];
        const avgATR = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
        const atrPercentage = (latestATR / closes[closes.length - 1]) * 100;
        
        let volatilityLevel = 'medium';
        if (atrPercentage < 1.0) volatilityLevel = 'low';
        else if (atrPercentage > 2.5) volatilityLevel = 'high';
        
        return {
            value: latestATR,
            average: avgATR,
            percentage: atrPercentage,
            volatilityLevel: volatilityLevel,
            raw: atrValues
        };
    }

    calculateRSI(data) {
        const { values, period } = data;
        
        if (values.length < period) {
            return {
                value: 50,
                previous: 50,
                raw: 50,
                status: 'NEUTRAL'
            };
        }
        
        const rsiValues = RSI.calculate({ values, period });
        
        if (!rsiValues || rsiValues.length < 2) {
            return {
                value: 50,
                previous: 50,
                raw: 50,
                status: 'NEUTRAL'
            };
        }
        
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
    }

    calculateStochastic(data) {
        const { highs, lows, closes, period, smooth, signalPeriod } = data;
        
        if (highs.length < period || lows.length < period || closes.length < period) {
            return { isValid: false };
        }
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period,
            smooth: smooth,
            signalPeriod: signalPeriod
        });
        
        if (!stochValues || stochValues.length < 2) {
            return { isValid: false };
        }
        
        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        
        return {
            isValid: true,
            kValue: current.k,
            dValue: current.d,
            kPrevious: previous.k,
            dPrevious: previous.d,
            isBullish: previous.k <= previous.d && current.k > current.d,
            isBearish: previous.k >= previous.d && current.k < current.d
        };
    }

    calculateCCI(data) {
        const { highs, lows, closes, period, maPeriod } = data;
        
        if (highs.length < period || lows.length < period || closes.length < period) {
            return {
                value: 0,
                maValue: 0,
                isValid: false
            };
        }
        
        const cciValues = CCI.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });
        
        if (!cciValues || cciValues.length === 0) {
            return {
                value: 0,
                maValue: 0,
                isValid: false
            };
        }
        
        const latestCCI = cciValues[cciValues.length - 1];
        const cciForMA = cciValues.slice(-maPeriod);
        const cciMA = cciForMA.reduce((sum, value) => sum + value, 0) / cciForMA.length;
        
        return {
            value: latestCCI,
            maValue: cciMA,
            isValid: true,
            deviation: Math.abs(latestCCI - cciMA)
        };
    }

    async executeSequentialFallback(tasks) {
        const results = [];
        for (const task of tasks) {
            try {
                const result = await this.executeTask(task);
                results.push(result);
            } catch (error) {
                console.log(`⚠️ Erro no fallback sequencial: ${error.message}`);
                results.push(null);
            }
        }
        return results;
    }

    getStatus() {
        return {
            activeTasks: this.activeTasks,
            maxConcurrent: this.maxConcurrent,
            queueLength: this.taskQueue.length,
            isEnabled: PARALLEL_CONFIG.enabled
        };
    }
}

// =====================================================================
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO (NÃO-BLOQUEANTE)
// =====================================================================

class SophisticatedRiskLayer {
    constructor() {
        this.riskLevels = {
            LOW: { emoji: '🟢', score: 0, action: 'high_confidence' },
            MEDIUM: { emoji: '🟡', score: 1, action: 'caution_advised' },
            HIGH: { emoji: '🟠', score: 2, action: 'extreme_caution' },
            CRITICAL: { emoji: '🔴', score: 3, action: 'consider_avoiding' }
        };

        this.riskFactors = {
            VOLATILITY_RISK: { weight: 1.2, threshold: 2.5 },
            VOLUME_RISK: { weight: 1.0, threshold: 0.5 },
            LIQUIDITY_RISK: { weight: 1.5, threshold: 1000000 },
            CORRELATION_RISK: { weight: 1.3, threshold: 0.8 },
            TIME_RISK: { weight: 0.8 },
            SUPPORT_RESISTANCE_RISK: { weight: 1.4 },
            MARKET_CONDITION_RISK: { weight: 1.6 },
            PIVOT_RISK: { weight: 1.2 }
        };

        this.riskHistory = new Map();
        this.maxHistorySize = 100;

        console.log('🛡️  Risk Layer Sofisticado inicializado');
    }

    async assessSignalRisk(signal) {
        try {
            const riskAssessment = {
                overallScore: 0,
                level: 'LOW',
                factors: [],
                warnings: [],
                recommendations: [],
                confidence: 100,
                shouldAlert: true,
                shouldBlock: false
            };

            const volatilityRisk = await this.analyzeVolatilityRisk(signal);
            riskAssessment.factors.push(volatilityRisk);
            riskAssessment.overallScore += volatilityRisk.score * this.riskFactors.VOLATILITY_RISK.weight;

            const volumeRisk = this.analyzeVolumeRisk(signal);
            riskAssessment.factors.push(volumeRisk);
            riskAssessment.overallScore += volumeRisk.score * this.riskFactors.VOLUME_RISK.weight;

            const liquidityRisk = await this.analyzeLiquidityRisk(signal.symbol);
            riskAssessment.factors.push(liquidityRisk);
            riskAssessment.overallScore += liquidityRisk.score * this.riskFactors.LIQUIDITY_RISK.weight;

            const correlationRisk = await this.analyzeCorrelationRisk(signal);
            riskAssessment.factors.push(correlationRisk);
            riskAssessment.overallScore += correlationRisk.score * this.riskFactors.CORRELATION_RISK.weight;

            const timeRisk = this.analyzeTimeRisk();
            riskAssessment.factors.push(timeRisk);
            riskAssessment.overallScore += timeRisk.score * this.riskFactors.TIME_RISK.weight;

            const srRisk = this.analyzeSupportResistanceRisk(signal);
            riskAssessment.factors.push(srRisk);
            riskAssessment.overallScore += srRisk.score * this.riskFactors.SUPPORT_RESISTANCE_RISK.weight;

            const marketRisk = await this.analyzeMarketConditionRisk();
            riskAssessment.factors.push(marketRisk);
            riskAssessment.overallScore += marketRisk.score * this.riskFactors.MARKET_CONDITION_RISK.weight;

            const trendRisk = await this.analyzeTrendRisk(signal);
            riskAssessment.factors.push(trendRisk);
            riskAssessment.overallScore += trendRisk.score * 1.2;

            const pivotRisk = this.analyzePivotRisk(signal);
            riskAssessment.factors.push(pivotRisk);
            riskAssessment.overallScore += pivotRisk.score * this.riskFactors.PIVOT_RISK.weight;

            riskAssessment.level = this.determineRiskLevel(riskAssessment.overallScore);
            riskAssessment.confidence = this.calculateConfidence(riskAssessment);

            riskAssessment.recommendations = this.generateRecommendations(riskAssessment);
            riskAssessment.warnings = this.generateWarnings(riskAssessment);

            this.addToHistory(signal.symbol, riskAssessment);
            this.logRiskAssessment(signal.symbol, riskAssessment);

            return riskAssessment;

        } catch (error) {
            console.error('Erro na avaliação de risco:', error);
            return this.getDefaultRiskAssessment();
        }
    }

    analyzePivotRisk(signal) {
        const pivotData = signal.marketData.pivotPoints;
        if (!pivotData) {
            return { type: 'PIVOT', score: 0, message: 'Sem dados de pivot' };
        }

        let score = 0;
        let message = '';
        
        if (pivotData.nearestPivot) {
            const distancePercent = pivotData.nearestPivot.distancePercent;
            const pivotType = pivotData.nearestPivot.type;
            const pivotStrength = pivotData.nearestPivot.strength || 'unknown';
            
            const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
            
            if (distancePercent < safeDistance * 0.5) {
                score = 2;
                message = `MUITO PRÓXIMO de pivot ${pivotType.toUpperCase()} ${pivotStrength} (${distancePercent.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`;
            } else if (distancePercent < safeDistance) {
                score = 1;
                message = `Próximo de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`;
            } else {
                score = 0;
                message = `Boa distância de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
            }
            
            if (pivotData.nearestPivot.isTesting) {
                score += 1;
                message += ' | TESTANDO PIVOT!';
            }
            
            if (pivotData.nearestPivot.timeframe) {
                const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotData.nearestPivot.timeframe] || 1.0;
                if (timeframeWeight >= 2.0) {
                    message += ` | PIVOT ${pivotData.nearestPivot.timeframe.toUpperCase()} (FORTE)`;
                }
            }
        }

        return {
            type: 'PIVOT',
            score: Math.min(3, score),
            message: message,
            data: pivotData.nearestPivot || null
        };
    }

    async analyzeVolatilityRisk(signal) {
        try {
            const candles = await getCandlesCached(signal.symbol, '15m', 30);
            if (candles.length < 15) {
                return { type: 'VOLATILITY', score: 1, message: 'Dados insuficientes' };
            }

            const closes = candles.map(c => c.close);
            const atr = await getATRData(signal.symbol, '15m', 14);

            if (!atr) {
                return { type: 'VOLATILITY', score: 1, message: 'ATR não disponível' };
            }

            let sumReturns = 0;
            for (let i = 1; i < closes.length; i++) {
                const returnVal = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
                sumReturns += returnVal;
            }
            const historicalVol = (sumReturns / (closes.length - 1)) * 100;

            const recentCloses = closes.slice(-5);
            let recentVol = 0;
            for (let i = 1; i < recentCloses.length; i++) {
                const returnVal = Math.abs((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
                recentVol += returnVal;
            }
            recentVol = (recentVol / (recentCloses.length - 1)) * 100;

            const volatilitySpike = recentVol / Math.max(historicalVol, 0.1);

            let score = 0;
            let message = '';

            if (volatilitySpike > 3.0) {
                score = 3;
                message = `ALTA VOLATILIDADE: Spike de ${volatilitySpike.toFixed(1)}x`;
            } else if (volatilitySpike > 2.0) {
                score = 2;
                message = `Volatilidade elevada: ${volatilitySpike.toFixed(1)}x`;
            } else if (recentVol > 5.0) {
                score = 2;
                message = `Volatilidade alta: ${recentVol.toFixed(2)}%`;
            } else if (recentVol > 3.0) {
                score = 1;
                message = `Volatilidade moderada: ${recentVol.toFixed(2)}%`;
            } else {
                score = 0;
                message = `Volatilidade normal: ${recentVol.toFixed(2)}%`;
            }

            if (atr.percentage > 3.0) {
                score = Math.max(score, 2);
                message += ` | ATR alto: ${atr.percentage.toFixed(2)}%`;
            }

            return {
                type: 'VOLATILITY',
                score: score,
                message: message,
                data: {
                    historicalVol: historicalVol,
                    recentVol: recentVol,
                    volatilitySpike: volatilitySpike,
                    atrPercentage: atr.percentage
                }
            };

        } catch (error) {
            return { type: 'VOLATILITY', score: 1, message: 'Erro na análise' };
        }
    }

    analyzeVolumeRisk(signal) {
        const volumeData = signal.marketData.volume?.robustData;
        if (!volumeData) {
            return { type: 'VOLUME', score: 1, message: 'Dados de volume insuficientes' };
        }

        const combinedScore = volumeData.combinedScore || 0;
        
        let score = 0;
        let message = '';

        if (combinedScore < 0.3) {
            score = 2;
            message = `VOLUME MUITO FRACO: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore < 0.5) {
            score = 1;
            message = `Volume fraco: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore > 0.8) {
            score = -0.5;
            message = `Volume muito forte: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore > 0.6) {
            score = 0;
            message = `Volume forte: Score ${combinedScore.toFixed(2)}`;
        } else {
            score = 0;
            message = `Volume moderado: Score ${combinedScore.toFixed(2)}`;
        }

        return {
            type: 'VOLUME',
            score: score,
            message: message,
            data: volumeData
        };
    }

    async analyzeLiquidityRisk(symbol) {
        try {
            const cacheKey = `liquidity_${symbol}`;
            const now = Date.now();
            
            if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 300000) {
                return candleCache[cacheKey].data;
            }

            const tickerData = await rateLimiter.makeRequest(
                `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`,
                {},
                'ticker24hr'
            );

            const quoteVolume = parseFloat(tickerData.quoteVolume) || 0;

            let score = 0;
            let message = '';

            if (quoteVolume < 500000) {
                score = 3;
                message = `LIQUIDEZ MUITO BAIXA: $${(quoteVolume / 1000).toFixed(1)}k`;
            } else if (quoteVolume < 2000000) {
                score = 2;
                message = `Liquidez baixa: $${(quoteVolume / 1000000).toFixed(2)}M`;
            } else if (quoteVolume < 10000000) {
                score = 1;
                message = `Liquidez moderada: $${(quoteVolume / 1000000).toFixed(2)}M`;
            } else {
                score = 0;
                message = `Liquidez boa: $${(quoteVolume / 1000000).toFixed(2)}M`;
            }

            const result = {
                type: 'LIQUIDITY',
                score: score,
                message: message,
                data: { quoteVolume: quoteVolume }
            };

            candleCache[cacheKey] = { data: result, timestamp: now };

            return result;

        } catch (error) {
            return { type: 'LIQUIDITY', score: 1, message: 'Dados não disponíveis' };
        }
    }

    async analyzeCorrelationRisk(signal) {
        try {
            const symbol = signal.symbol;
            const btcSymbol = 'BTCUSDT';

            if (symbol === btcSymbol) {
                return { type: 'CORRELATION', score: 0, message: 'BTC não tem correlação' };
            }

            const [symbolCandles, btcCandles] = await Promise.all([
                getCandlesCached(symbol, '15m', 6),
                getCandlesCached(btcSymbol, '15m', 6)
            ]);

            if (symbolCandles.length < 4 || btcCandles.length < 4) {
                return { type: 'CORRELATION', score: 1, message: 'Dados insuficientes' };
            }

            const symbolReturns = [];
            const btcReturns = [];

            for (let i = 1; i < Math.min(symbolCandles.length, btcCandles.length); i++) {
                const symbolReturn = (symbolCandles[i].close - symbolCandles[i - 1].close) / symbolCandles[i - 1].close;
                const btcReturn = (btcCandles[i].close - btcCandles[i - 1].close) / btcCandles[i - 1].close;

                symbolReturns.push(symbolReturn);
                btcReturns.push(btcReturn);
            }

            const correlation = this.calculateCorrelation(symbolReturns, btcReturns);
            const absCorrelation = Math.abs(correlation);

            let score = 0;
            let message = '';

            if (absCorrelation > 0.8) {
                score = correlation > 0 ? 0.5 : 1;
                message = `Correlação ${correlation > 0 ? 'POSITIVA' : 'NEGATIVA'}: ${correlation.toFixed(2)}`;
            } else if (absCorrelation > 0.5) {
                score = 0;
                message = `Correlação moderada: ${correlation.toFixed(2)}`;
            } else {
                score = 0;
                message = `Baixa correlação: ${correlation.toFixed(2)}`;
            }

            const lastSymbolReturn = symbolReturns[symbolReturns.length - 1];
            const lastBtcReturn = btcReturns[btcReturns.length - 1];

            if (Math.sign(lastSymbolReturn) !== Math.sign(lastBtcReturn) && absCorrelation > 0.6) {
                score += 1;
                message += ` | INDO CONTRA BTC!`;
            }

            return {
                type: 'CORRELATION',
                score: Math.min(3, score),
                message: message,
                data: {
                    correlation: correlation,
                    lastSymbolReturn: lastSymbolReturn,
                    lastBtcReturn: lastBtcReturn
                }
            };

        } catch (error) {
            return { type: 'CORRELATION', score: 1, message: 'Erro análise' };
        }
    }

    calculateCorrelation(x, y) {
        const n = x.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;

        for (let i = 0; i < n; i++) {
            sumX += x[i];
            sumY += y[i];
            sumXY += x[i] * y[i];
            sumX2 += x[i] * x[i];
            sumY2 += y[i] * y[i];
        }

        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

        return denominator === 0 ? 0 : numerator / denominator;
    }

    analyzeTimeRisk() {
        const now = new Date();
        const hour = now.getUTCHours();
        const day = now.getUTCDay();

        let score = 0;
        let message = '';

        const riskHours = [13, 14, 20, 21];

        if (riskHours.includes(hour)) {
            score = 1;
            message = `Horário de maior volatilidade`;
        } else if (hour >= 22 || hour <= 3) {
            score = 0;
            message = `Horário asiático`;
        } else {
            score = 0;
            message = `Horário normal`;
        }

        if (day === 0 || day === 6) {
            score += 1;
            message += ` | FIM DE SEMANA`;
        }

        return {
            type: 'TIME',
            score: Math.min(2, score),
            message: message,
            data: { hour: hour, day: day }
        };
    }

    analyzeSupportResistanceRisk(signal) {
        const srData = signal.marketData.supportResistance;
        if (!srData || !srData.breakoutRisk) {
            return { type: 'S/R', score: 1, message: 'Dados não disponíveis' };
        }

        const breakoutRisk = srData.breakoutRisk;
        let score = 0;

        switch (breakoutRisk.level) {
            case 'very_low': score = -0.5; break;
            case 'low': score = 0; break;
            case 'medium': score = 1; break;
            case 'high': score = 2; break;
            default: score = 1;
        }

        const nearestLevel = signal.isBullish ?
            srData.nearestResistance : srData.nearestSupport;

        if (nearestLevel && nearestLevel.distancePercent < 0.5) {
            score = Math.max(score, 2);
        }

        return {
            type: 'S/R',
            score: score,
            message: breakoutRisk.reason,
            data: {
                riskLevel: breakoutRisk.level,
                distancePercent: nearestLevel?.distancePercent
            }
        };
    }

    async analyzeMarketConditionRisk() {
        try {
            const cacheKey = 'market_condition';
            const now = Date.now();
            
            if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 900000) {
                return candleCache[cacheKey].data;
            }

            const btcCandles = await getCandlesCached('BTCUSDT', '1h', 20);

            if (btcCandles.length < 15) {
                return { type: 'MARKET', score: 1, message: 'Dados insuficientes' };
            }

            const closes = btcCandles.map(c => c.close);
            const currentPrice = closes[closes.length - 1];
            const high24h = Math.max(...closes);
            const low24h = Math.min(...closes);

            const drawdown = ((high24h - currentPrice) / high24h) * 100;
            const volatility = ((high24h - low24h) / low24h) * 100;

            let score = 0;
            let message = '';

            if (drawdown > 10) {
                score = 2;
                message = `MERCADO EM CORREÇÃO: BTC -${drawdown.toFixed(1)}%`;
            } else if (drawdown > 5) {
                score = 1;
                message = `Mercado em pullback: BTC -${drawdown.toFixed(1)}%`;
            } else if (volatility > 8) {
                score = 1;
                message = `Alta volatilidade BTC: ${volatility.toFixed(1)}%`;
            } else {
                score = 0;
                message = `Mercado estável: BTC ${drawdown > 0 ? '-' : '+'}${Math.abs(drawdown).toFixed(1)}%`;
            }

            const result = {
                type: 'MARKET',
                score: score,
                message: message,
                data: {
                    btcDrawdown: drawdown,
                    btcVolatility: volatility,
                    btcPrice: currentPrice
                }
            };

            candleCache[cacheKey] = { data: result, timestamp: now };

            return result;

        } catch (error) {
            return { type: 'MARKET', score: 1, message: 'Erro análise' };
        }
    }

    async analyzeTrendRisk(signal) {
        try {
            const timeframes = ['15m', '1h'];
            let conflictingTrends = 0;
            let totalTrends = 0;
            let trendMessages = [];

            for (const tf of timeframes) {
                const candles = await getCandlesCached(signal.symbol, tf, 30);
                if (candles.length < 15) continue;

                const closes = candles.map(c => c.close);
                const sma20 = this.calculateSMA(closes, 15);
                const sma50 = this.calculateSMA(closes, 30);

                if (sma20 && sma50) {
                    const currentPrice = closes[closes.length - 1];
                    const isBullishTrend = currentPrice > sma20 && sma20 > sma50;
                    const isBearishTrend = currentPrice < sma20 && sma20 < sma50;

                    totalTrends++;

                    if (signal.isBullish && isBearishTrend) {
                        conflictingTrends++;
                        trendMessages.push(`${tf}: tendência de BAIXA`);
                    } else if (!signal.isBullish && isBullishTrend) {
                        conflictingTrends++;
                        trendMessages.push(`${tf}: tendência de ALTA`);
                    }
                }
            }

            let score = 0;
            let message = '';

            if (conflictingTrends > 0) {
                const conflictRatio = conflictingTrends / totalTrends;

                if (conflictRatio > 0.66) {
                    score = 2;
                    message = `CONFLITO DE TENDÊNCIA em ${conflictingTrends}/${totalTrends} timeframes`;
                } else if (conflictRatio > 0.33) {
                    score = 1;
                    message = `Tendência conflitante em ${conflictingTrends}/${totalTrends} timeframes`;
                }

                if (trendMessages.length > 0) {
                    message += ` (${trendMessages.join(', ')})`;
                }
            } else {
                score = -0.5;
                message = `Tendências alinhadas em ${totalTrends} timeframes`;
            }

            return {
                type: 'TREND',
                score: score,
                message: message,
                data: {
                    conflictingTrends: conflictingTrends,
                    totalTrends: totalTrends,
                    conflictRatio: conflictingTrends / totalTrends
                }
            };

        } catch (error) {
            return { type: 'TREND', score: 1, message: 'Erro análise' };
        }
    }

    calculateSMA(data, period) {
        if (data.length < period) return null;
        const slice = data.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    determineRiskLevel(score) {
        if (score >= 12) return 'CRITICAL';
        if (score >= 8) return 'HIGH';
        if (score >= 4) return 'MEDIUM';
        return 'LOW';
    }

    calculateConfidence(assessment) {
        const maxScore = 25;
        const normalizedScore = Math.min(Math.max(assessment.overallScore, 0), maxScore);
        const confidence = 100 - (normalizedScore / maxScore) * 40;

        return Math.max(60, Math.min(100, Math.round(confidence)));
    }

    generateRecommendations(assessment) {
        const recommendations = [];

        switch (assessment.level) {
            case 'CRITICAL':
                recommendations.push('⚠️ <i>CONSIDERE EVITAR ESTE TRADE</i>');
                recommendations.push('• Reduza tamanho da posição em 75%');
                recommendations.push('• Use stop loss mais apertado');
                recommendations.push('• Espere confirmação adicional');
                break;

            case 'HIGH':
                recommendations.push('🔶 <i>ALTO RISCO - EXTREMA CAUTELA</i>');
                recommendations.push('• Reduza tamanho da posição em 50%');
                recommendations.push('• Use stop loss conservador');
                recommendations.push('• Procure entrada melhor');
                break;

            case 'MEDIUM':
                recommendations.push('🟡 <i>RISCO MODERADO - CAUTELA</i>');
                recommendations.push('• Reduza tamanho da posição em 25%');
                recommendations.push('• Aguarde confirmação parcial');
                recommendations.push('• Considere alvos mais curtos');
                break;

            case 'LOW':
                recommendations.push('🟢 <i>RISCO BAIXO - CONFIANÇA</i>');
                recommendations.push('• Tamanho normal de posição OK');
                recommendations.push('• Stop loss padrão adequado');
                recommendations.push('• Pode buscar alvos mais longos');
                break;
        }

        assessment.factors.forEach(factor => {
            if (factor.score >= 2) {
                switch (factor.type) {
                    case 'VOLATILITY':
                        recommendations.push(`• <b>Volatilidade alta:</b> Use stop mais largo`);
                        break;
                    case 'VOLUME':
                        recommendations.push(`• <b>Volume anormal:</b> Aguarde confirmação`);
                        break;
                    case 'LIQUIDITY':
                        recommendations.push(`• <b>Liquidez baixa:</b> Reduza tamanho`);
                        break;
                    case 'CORRELATION':
                        if (factor.message.includes('CONTRA BTC')) {
                            recommendations.push(`• <b>Indo contra BTC:</b> Cuidado extra`);
                        }
                        break;
                    case 'PIVOT':
                        if (factor.message.includes('TESTANDO PIVOT')) {
                            recommendations.push(`• <b>Testando pivot:</b> Aguarde confirmação do rompimento`);
                        }
                        break;
                }
            }
        });

        return recommendations;
    }

    generateWarnings(assessment) {
        const warnings = [];

        assessment.factors.forEach(factor => {
            if (factor.score >= 2.5) {
                warnings.push(`⚠️ ${factor.message}`);
            } else if (factor.score >= 2) {
                warnings.push(`🔶 ${factor.message}`);
            }
        });

        return warnings;
    }

    addToHistory(symbol, assessment) {
        if (!this.riskHistory.has(symbol)) {
            this.riskHistory.set(symbol, []);
        }

        const history = this.riskHistory.get(symbol);
        history.push({
            timestamp: Date.now(),
            assessment: assessment
        });

        if (history.length > this.maxHistorySize) {
            history.shift();
        }
    }

    logRiskAssessment(symbol, assessment) {
        console.log(`\n🛡️  RISK ASSESSMENT: ${symbol}`);
        console.log(`   Nível: ${assessment.level} ${this.riskLevels[assessment.level].emoji}`);
        console.log(`   Score: ${assessment.overallScore.toFixed(2)}`);
        console.log(`   Confiança: ${assessment.confidence}%`);

        if (assessment.warnings.length > 0) {
            console.log(`   Warnings:`);
            assessment.warnings.forEach(w => console.log(`     ${w}`));
        }
    }

    getDefaultRiskAssessment() {
        return {
            overallScore: 1,
            level: 'LOW',
            factors: [],
            warnings: ['Sistema de risco indisponível'],
            recommendations: ['Use cautela padrão'],
            confidence: 70,
            shouldAlert: true,
            shouldBlock: false
        };
    }

    getSymbolRiskHistory(symbol) {
        return this.riskHistory.get(symbol) || [];
    }

    getOverallMarketRisk() {
        let totalScore = 0;
        let count = 0;

        this.riskHistory.forEach((history, symbol) => {
            if (history.length > 0) {
                const latest = history[history.length - 1];
                totalScore += latest.assessment.overallScore;
                count++;
            }
        });

        const avgScore = count > 0 ? totalScore / count : 0;
        return {
            averageRiskScore: avgScore,
            riskLevel: this.determineRiskLevel(avgScore),
            monitoredSymbols: count
        };
    }
}

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
// 🧠 SISTEMA DE APRENDIZADO COMPLETO COM TRAILING SIMULATION (CORRIGIDO)
// =====================================================================

class AdvancedLearningSystem {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.openTrades = new Map();
        this.patterns = { winning: {}, losing: {} };
        this.parameterEvolution = {
            volumeThreshold: [],
            qualityThreshold: [],
            breakoutRisk: [],
            supportResistance: [],
            pivotPoints: [],
            rsiSettings: []
        };

        this.learningEnabled = true;
        this.minTradesForLearning = 10;
        this.tradeTrackingHours = 24;

        this.trailingConfig = {
            timeframe: '5m',
            candlesToSimulate: 200,
            partialTargets: [
                { percentage: 20, positionSize: 0.25 },
                { percentage: 40, positionSize: 0.25 },
                { percentage: 60, positionSize: 0.25 },
                { percentage: 80, positionSize: 0.25 }
            ],
            fees: 0.0004
        };

        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado Avançado com Trailing Simulation inicializado');
    }

    async simulateTradeCandleByCandle(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade) return null;

            console.log(`📊 Iniciando trailing simulation para ${trade.symbol} ${trade.direction}`);

            const candles = await getCandlesCached(
                trade.symbol,
                this.trailingConfig.timeframe,
                this.trailingConfig.candlesToSimulate
            );

            if (candles.length < 10) return null;

            const entryTime = trade.timestamp;
            const relevantCandles = candles.filter(c => c.time >= entryTime);

            if (relevantCandles.length === 0) return null;

            const simulationResult = this.simulateTradeExecution(
                trade,
                relevantCandles
            );

            trade.simulationResult = simulationResult;
            trade.status = 'SIMULATED';
            trade.outcome = simulationResult.finalOutcome;
            trade.exitPrice = simulationResult.exitPrice;
            trade.profitPercentage = simulationResult.netProfitPercentage;
            trade.durationHours = simulationResult.durationHours;

            this.recordTradeOutcome(trade);

            return simulationResult;

        } catch (error) {
            console.error('Erro na simulação:', error);
            return null;
        }
    }

    simulateTradeExecution(trade, candles) {
        const entryPrice = trade.entryPrice;
        const stopPrice = trade.stopPrice;
        const isBullish = trade.direction === 'BUY';

        let currentPosition = 1.0;
        let realizedProfit = 0;
        let feesPaid = 0;
        let hitStop = false;
        let hitTargets = [];
        let exitPrice = entryPrice;
        let finalOutcome = 'FAILURE';
        let firstHit = null;

        const sortedTargets = [...trade.targets].sort((a, b) =>
            parseFloat(a.percentage) - parseFloat(b.percentage)
        );

        for (let i = 0; i < candles.length && currentPosition > 0; i++) {
            const candle = candles[i];
            const high = candle.high;
            const low = candle.low;
            const close = candle.close;

            if (!hitStop) {
                if (isBullish && low <= stopPrice) {
                    hitStop = true;
                    firstHit = firstHit || 'STOP';
                    exitPrice = stopPrice;

                    const loss = (stopPrice - entryPrice) / entryPrice * 100 * currentPosition;
                    realizedProfit += loss;

                    const exitFees = currentPosition * this.trailingConfig.fees * 100;
                    feesPaid += exitFees;

                    currentPosition = 0;
                    finalOutcome = 'STOP_HIT';
                    break;
                } else if (!isBullish && high >= stopPrice) {
                    hitStop = true;
                    firstHit = firstHit || 'STOP';
                    exitPrice = stopPrice;

                    const loss = (entryPrice - stopPrice) / entryPrice * 100 * currentPosition;
                    realizedProfit += loss;

                    const exitFees = currentPosition * this.trailingConfig.fees * 100;
                    feesPaid += exitFees;

                    currentPosition = 0;
                    finalOutcome = 'STOP_HIT';
                    break;
                }
            }

            for (let j = 0; j < sortedTargets.length; j++) {
                const target = sortedTargets[j];
                const targetPrice = parseFloat(target.price);

                if (hitTargets.some(t => t.percentage === target.percentage)) continue;

                const targetHit = isBullish ?
                    high >= targetPrice :
                    low <= targetPrice;

                if (targetHit) {
                    if (!firstHit) firstHit = `TARGET_${target.percentage}%`;

                    hitTargets.push({
                        percentage: target.percentage,
                        price: targetPrice,
                        positionSize: this.trailingConfig.partialTargets[j]?.positionSize || 0.25
                    });

                    const positionSize = this.trailingConfig.partialTargets[j]?.positionSize || 0.25;
                    const profit = isBullish ?
                        ((targetPrice - entryPrice) / entryPrice) * 100 * positionSize :
                        ((entryPrice - targetPrice) / entryPrice) * 100 * positionSize;

                    realizedProfit += profit;

                    const entryFees = positionSize * this.trailingConfig.fees * 100;
                    const exitFees = positionSize * this.trailingConfig.fees * 100;
                    feesPaid += entryFees + exitFees;

                    currentPosition -= positionSize;

                    if (currentPosition <= 0) {
                        currentPosition = 0;
                        exitPrice = targetPrice;
                        finalOutcome = hitTargets.length === sortedTargets.length ?
                            'ALL_TARGETS_HIT' : 'PARTIAL_TARGETS_HIT';
                        break;
                    }
                }
            }

            if (currentPosition <= 0) break;
        }

        if (currentPosition > 0) {
            const lastCandle = candles[candles.length - 1];
            exitPrice = lastCandle.close;

            const finalProfit = isBullish ?
                ((exitPrice - entryPrice) / entryPrice) * 100 * currentPosition :
                ((entryPrice - exitPrice) / entryPrice) * 100 * currentPosition;

            realizedProfit += finalProfit;

            const finalFees = currentPosition * this.trailingConfig.fees * 100;
            feesPaid += finalFees;

            currentPosition = 0;
            finalOutcome = firstHit ? `${firstHit}_THEN_EXIT` : 'TIMEOUT_EXIT';
        }

        const netProfit = realizedProfit - feesPaid;
        const durationMs = candles.length * 5 * 60 * 1000;
        const durationHours = durationMs / (1000 * 60 * 60);

        return {
            finalOutcome: finalOutcome,
            exitPrice: exitPrice,
            grossProfitPercentage: realizedProfit,
            feesPercentage: feesPaid,
            netProfitPercentage: netProfit,
            durationHours: durationHours,
            hitTargets: hitTargets,
            hitStop: hitStop,
            firstHit: firstHit,
            candlesAnalyzed: candles.length,
            simulationTimestamp: Date.now()
        };
    }

    async checkTradeOutcome(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade || trade.status !== 'OPEN') return;

            const simulationResult = await this.simulateTradeCandleByCandle(tradeId);

            if (simulationResult) {
                console.log(`📊 Trade ${trade.symbol} ${trade.direction} ${simulationResult.finalOutcome}: ${simulationResult.netProfitPercentage.toFixed(2)}%`);
                console.log(`   Alvos atingidos: ${simulationResult.hitTargets.length}, Stop: ${simulationResult.hitStop ? 'SIM' : 'NÃO'}`);
            } else {
                await this.checkTradeOutcomeFallback(tradeId);
            }

        } catch (error) {
            console.error('Erro ao verificar outcome do trade:', error);
            await this.checkTradeOutcomeFallback(tradeId);
        }
    }

    async checkTradeOutcomeFallback(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade || trade.status !== 'OPEN') return;

            const currentPrice = await this.getCurrentPrice(trade.symbol);
            if (!currentPrice) return;

            let outcome = 'FAILURE';
            let exitPrice = trade.stopPrice;
            let profitPercentage = 0;

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
                    profitPercentage = trade.direction === 'BUY'
                        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                } else {
                    exitPrice = currentPrice;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                }
            }

            trade.status = 'CLOSED';
            trade.outcome = outcome;
            trade.exitPrice = exitPrice;
            trade.profitPercentage = profitPercentage;
            trade.durationHours = (Date.now() - trade.timestamp) / (1000 * 60 * 60);

            this.recordTradeOutcome(trade);

        } catch (error) {
            console.error('Erro no fallback do trade outcome:', error);
        }
    }

    recordTradeOutcome(trade) {
        const symbolStats = this.symbolPerformance[trade.symbol] || {
            totalSignals: 0,
            successfulSignals: 0,
            totalProfit: 0,
            avgHoldingTime: 0,
            recentScores: []
        };

        symbolStats.totalSignals++;

        const isSuccessful = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

        if (isSuccessful) {
            symbolStats.successfulSignals++;
            symbolStats.totalProfit += trade.profitPercentage || 0;
        } else {
            symbolStats.totalProfit += trade.profitPercentage || 0;
        }

        symbolStats.avgHoldingTime = symbolStats.totalSignals > 0
            ? (symbolStats.avgHoldingTime * (symbolStats.totalSignals - 1) + (trade.durationHours || 0)) / symbolStats.totalSignals
            : (trade.durationHours || 0);

        symbolStats.recentScores.push(trade.qualityScore);
        if (symbolStats.recentScores.length > 20) {
            symbolStats.recentScores = symbolStats.recentScores.slice(-20);
        }

        this.symbolPerformance[trade.symbol] = symbolStats;
        this.openTrades.delete(trade.id || trade.timestamp);
        
        this.tradeHistory.push(trade);
        
        if (this.tradeHistory.length > 1000) {
            this.tradeHistory = this.tradeHistory.slice(-500);
        }
    }

    async recordSignal(signal, marketData) {
        if (!this.learningEnabled) return null;

        try {
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
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
                    volumeRobust: marketData.volume?.robustData || null,
                    rsi: marketData.rsi?.raw || 0,
                    volatility: marketData.volatility?.rawVolatility || 0,
                    lsr: marketData.lsr?.lsrRatio || 0,
                    emaAlignment: marketData.ema?.isAboveEMA55 || false,
                    stoch1hValid: marketData.stoch?.isValid || false,
                    stoch4hValid: marketData.stoch4h?.isValid || false,
                    cci4hValid: marketData.cci4h?.isValid || false,
                    cci4hValue: marketData.cci4h?.value || 0,
                    cci4hMA: marketData.cci4h?.maValue || 0,
                    breakoutRisk: marketData.breakoutRisk || {},
                    supportResistance: marketData.supportResistance || {},
                    pivotPoints: marketData.pivotPoints || {},
                    fundingRate: marketData.funding?.raw || 0
                },
                status: 'OPEN',
                outcome: null,
                exitPrice: null,
                profitPercentage: null,
                durationHours: null
            };

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
                    recentScores: []
                };
            }

            if (this.tradeHistory.length % 10 === 0) {
                this.saveLearningData();
                await this.analyzePatterns();
            }

            return tradeRecord.id;

        } catch (error) {
            console.error('Erro ao registrar sinal:', error);
            return null;
        }
    }

    async getCurrentPrice(symbol) {
        try {
            const candles = await getCandlesCached(symbol, '1m', 2);
            if (candles.length > 0) {
                return candles[candles.length - 1].close;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async analyzePatterns() {
        try {
            const closedTrades = this.tradeHistory.filter(t =>
                t.status === 'CLOSED' || t.status === 'SIMULATED'
            );
            if (closedTrades.length < 5) return;

            const winners = closedTrades.filter(t =>
                t.outcome === 'SUCCESS' ||
                t.outcome === 'ALL_TARGETS_HIT' ||
                t.outcome === 'PARTIAL_TARGETS_HIT'
            );
            const losers = closedTrades.filter(t =>
                t.outcome === 'FAILURE' ||
                t.outcome === 'STOP_HIT' ||
                t.outcome === 'TIMEOUT_EXIT'
            );

            this.patterns.winning = {};
            this.patterns.losing = {};

            winners.forEach(trade => {
                const patterns = this.extractPatterns(trade);
                patterns.forEach(pattern => {
                    this.patterns.winning[pattern] = (this.patterns.winning[pattern] || 0) + 1;
                });
            });

            losers.forEach(trade => {
                const patterns = this.extractPatterns(trade);
                patterns.forEach(pattern => {
                    this.patterns.losing[pattern] = (this.patterns.losing[pattern] || 0) + 1;
                });
            });

            if (closedTrades.length >= this.minTradesForLearning) {
                await this.optimizeParameters(closedTrades);
            }

            console.log(`📊 Análise: ${winners.length} vencedores, ${losers.length} perdedores`);

        } catch (error) {
            console.error('Erro na análise de padrões:', error);
        }
    }

    extractPatterns(trade) {
        const patterns = [];
        const data = trade.marketData;

        if (data.volumeRobust?.combinedScore >= 0.7) {
            patterns.push('ROBUST_VOLUME');
        }
        if (data.volumeRatio >= 1.8) {
            patterns.push('HIGH_VOLUME');
        }
        if (data.volumeRatio >= 1.5 && data.volumeRatio < 1.8) {
            patterns.push('MODERATE_VOLUME');
        }
        
        if (data.volatility >= 1.0 && data.volatility <= 1.5) {
            patterns.push('OPTIMAL_VOLATILITY');
        }
        if (data.lsr >= 3.0) {
            patterns.push('HIGH_LSR');
        }
        if (data.stoch1hValid && data.stoch4hValid) {
            patterns.push('STOCH_BOTH_BULLISH');
        }
        if (data.cci4hValid) {
            patterns.push('CCI_BULLISH');
        }

        if (data.supportResistance?.nearestSupport?.distancePercent <= 1.0) {
            patterns.push('NEAR_SUPPORT');
        }
        if (data.supportResistance?.nearestResistance?.distancePercent <= 1.0) {
            patterns.push('NEAR_RESISTANCE');
        }
        if (data.breakoutRisk?.level === 'high') {
            patterns.push('HIGH_BREAKOUT_RISK');
        }
        if (data.breakoutRisk?.level === 'low') {
            patterns.push('LOW_BREAKOUT_RISK');
        }

        if (data.pivotPoints?.nearestPivot?.distancePercent <= 0.8) {
            patterns.push(`NEAR_PIVOT_${data.pivotPoints.nearestPivot.type.toUpperCase()}`);
        }
        if (data.pivotPoints?.nearestPivot?.isTesting) {
            patterns.push(`TESTING_PIVOT`);
        }

        if (trade.direction === 'BUY' && data.fundingRate < 0) {
            patterns.push('NEGATIVE_FUNDING_BUY');
        }
        if (trade.direction === 'SELL' && data.fundingRate > 0) {
            patterns.push('POSITIVE_FUNDING_SELL');
        }

        return patterns;
    }

    async optimizeParameters(closedTrades) {
        try {
            const volumeAnalysis = this.analyzeParameter(
                closedTrades,
                t => t.marketData.volumeRatio,
                [1.5, 1.8, 2.0, 2.2, 2.5],
                VOLUME_SETTINGS.baseThreshold
            );

            if (volumeAnalysis.bestValue && volumeAnalysis.winRate > 0.4) {
                const adjustment = (volumeAnalysis.bestValue - VOLUME_SETTINGS.baseThreshold) * 0.1;
                VOLUME_SETTINGS.baseThreshold += adjustment;
                VOLUME_SETTINGS.baseThreshold = Math.max(1.5, Math.min(2.5, VOLUME_SETTINGS.baseThreshold));

                this.parameterEvolution.volumeThreshold.push({
                    timestamp: Date.now(),
                    old: VOLUME_SETTINGS.baseThreshold - adjustment,
                    new: VOLUME_SETTINGS.baseThreshold,
                    winRate: volumeAnalysis.winRate
                });
            }

            const breakoutAnalysis = this.analyzeBreakoutRisk(closedTrades);
            if (breakoutAnalysis.bestWinRate > 0.4) {
                this.parameterEvolution.breakoutRisk.push({
                    timestamp: Date.now(),
                    analysis: breakoutAnalysis,
                    winRate: breakoutAnalysis.bestWinRate
                });
            }

            const pivotAnalysis = this.analyzePivotPoints(closedTrades);
            if (pivotAnalysis.bestWinRate > 0.4) {
                this.parameterEvolution.pivotPoints.push({
                    timestamp: Date.now(),
                    analysis: pivotAnalysis,
                    winRate: pivotAnalysis.bestWinRate
                });
            }

            console.log(`⚙️  Parâmetros otimizados: Volume=${VOLUME_SETTINGS.baseThreshold.toFixed(2)}`);
            this.saveLearningData();

        } catch (error) {
            console.error('Erro na otimização:', error);
        }
    }

    analyzePivotPoints(closedTrades) {
        const patterns = {
            nearSupportPivot: { wins: 0, total: 0 },
            nearResistancePivot: { wins: 0, total: 0 },
            testingPivot: { wins: 0, total: 0 },
            farFromPivot: { wins: 0, total: 0 }
        };

        closedTrades.forEach(trade => {
            const data = trade.marketData.pivotPoints;

            if (data?.nearestPivot) {
                const distancePercent = data.nearestPivot.distancePercent;
                const pivotType = data.nearestPivot.type;
                const isTesting = data.nearestPivot.isTesting;

                if (isTesting) {
                    patterns.testingPivot.total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns.testingPivot.wins++;
                    }
                } else if (distancePercent <= 0.8) {
                    if (pivotType === 'support') {
                        patterns.nearSupportPivot.total++;
                        if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                            patterns.nearSupportPivot.wins++;
                        }
                    } else if (pivotType === 'resistance') {
                        patterns.nearResistancePivot.total++;
                        if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                            patterns.nearResistancePivot.wins++;
                        }
                    }
                } else {
                    patterns.farFromPivot.total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns.farFromPivot.wins++;
                    }
                }
            }
        });

        const winRates = {};
        Object.keys(patterns).forEach(key => {
            if (patterns[key].total > 0) {
                winRates[key] = patterns[key].wins / patterns[key].total;
            }
        });

        let bestPattern = null;
        let bestWinRate = 0;

        Object.keys(winRates).forEach(key => {
            if (winRates[key] > bestWinRate) {
                bestWinRate = winRates[key];
                bestPattern = key;
            }
        });

        return {
            patterns: patterns,
            winRates: winRates,
            bestPattern: bestPattern,
            bestWinRate: bestWinRate
        };
    }

    analyzeBreakoutRisk(closedTrades) {
        const patterns = {
            nearSupport: { wins: 0, total: 0 },
            nearResistance: { wins: 0, total: 0 },
            highRisk: { wins: 0, total: 0 },
            lowRisk: { wins: 0, total: 0 }
        };

        closedTrades.forEach(trade => {
            const data = trade.marketData;

            if (data.supportResistance?.nearestSupport?.distancePercent <= 1.0) {
                patterns.nearSupport.total++;
                if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                    patterns.nearSupport.wins++;
                }
            }

            if (data.supportResistance?.nearestResistance?.distancePercent <= 1.0) {
                patterns.nearResistance.total++;
                if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                    patterns.nearResistance.wins++;
                }
            }

            if (data.breakoutRisk?.level === 'high') {
                patterns.highRisk.total++;
                if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                    patterns.highRisk.wins++;
                }
            }

            if (data.breakoutRisk?.level === 'low') {
                patterns.lowRisk.total++;
                if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                    patterns.lowRisk.wins++;
                }
            }
        });

        const winRates = {};
        Object.keys(patterns).forEach(key => {
            if (patterns[key].total > 0) {
                winRates[key] = patterns[key].wins / patterns[key].total;
            }
        });

        let bestPattern = null;
        let bestWinRate = 0;

        Object.keys(winRates).forEach(key => {
            if (winRates[key] > bestWinRate) {
                bestWinRate = winRates[key];
                bestPattern = key;
            }
        });

        return {
            patterns: patterns,
            winRates: winRates,
            bestPattern: bestPattern,
            bestWinRate: bestWinRate
        };
    }

    analyzeParameter(trades, getValueFn, thresholds, currentValue) {
        let bestThreshold = currentValue;
        let bestWinRate = 0;

        thresholds.forEach(threshold => {
            const filtered = trades.filter(t => getValueFn(t) >= threshold);
            if (filtered.length >= 3) {
                const winners = filtered.filter(t =>
                    t.outcome === 'SUCCESS' ||
                    t.outcome === 'ALL_TARGETS_HIT' ||
                    t.outcome === 'PARTIAL_TARGETS_HIT'
                );
                const winRate = winners.length / filtered.length;

                if (winRate > bestWinRate) {
                    bestWinRate = winRate;
                    bestThreshold = threshold;
                }
            }
        });

        return {
            bestValue: bestWinRate > 0 ? bestThreshold : null,
            winRate: bestWinRate
        };
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

                console.log(`📊 Aprendizado: ${this.tradeHistory.length} trades carregados`);
                
                this.fixPatternCounts();
                
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados de aprendizado:', error.message);
            this.tradeHistory = [];
            this.symbolPerformance = {};
            this.patterns = { winning: {}, losing: {} };
            this.parameterEvolution = this.parameterEvolution;
        }
    }

    fixPatternCounts() {
        const totalTrades = this.tradeHistory.length;
        
        Object.keys(this.patterns.winning).forEach(pattern => {
            if (this.patterns.winning[pattern] > totalTrades) {
                this.patterns.winning[pattern] = Math.min(this.patterns.winning[pattern], totalTrades);
            }
        });
        
        Object.keys(this.patterns.losing).forEach(pattern => {
            if (this.patterns.losing[pattern] > totalTrades) {
                this.patterns.losing[pattern] = Math.min(this.patterns.losing[pattern], totalTrades);
            }
        });
    }

    saveLearningData() {
        try {
            this.fixPatternCounts();
            
            const data = {
                tradeHistory: this.tradeHistory.slice(-500),
                symbolPerformance: this.symbolPerformance,
                patterns: {
                    winning: this.patterns.winning,
                    losing: this.patterns.losing
                },
                parameterEvolution: this.parameterEvolution,
                lastUpdated: Date.now(),
                trailingConfig: this.trailingConfig
            };

            const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
            const backupFile = path.join(LEARNING_DIR, `learning_backup_${Date.now()}.json`);

            if (fs.existsSync(learningFile)) {
                fs.copyFileSync(learningFile, backupFile);
            }

            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
            this.cleanupOldBackups();

        } catch (error) {
            console.error('Erro ao salvar dados de aprendizado:', error);
        }
    }

    cleanupOldBackups() {
        try {
            const files = fs.readdirSync(LEARNING_DIR)
                .filter(file => file.startsWith('learning_backup_'))
                .map(file => ({
                    name: file,
                    path: path.join(LEARNING_DIR, file),
                    time: fs.statSync(path.join(LEARNING_DIR, file)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            if (files.length > 5) {
                files.slice(5).forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
        } catch (error) {
            // Ignorar erro
        }
    }

    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t =>
            t.status === 'CLOSED' || t.status === 'SIMULATED'
        );
        
        const validClosedTrades = closedTrades.filter(t => 
            t.outcome && t.profitPercentage !== null && t.profitPercentage !== undefined
        );
        
        const winners = validClosedTrades.filter(t =>
            t.outcome === 'SUCCESS' ||
            t.outcome === 'ALL_TARGETS_HIT' ||
            t.outcome === 'PARTIAL_TARGETS_HIT'
        );
        const losers = validClosedTrades.filter(t =>
            t.outcome === 'FAILURE' ||
            t.outcome === 'STOP_HIT' ||
            t.outcome === 'TIMEOUT_EXIT'
        );

        const winRate = validClosedTrades.length > 0 ? winners.length / validClosedTrades.length : 0;
        const avgProfit = winners.length > 0 ?
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        const avgLoss = losers.length > 0 ?
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;

        const profitFactor = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;

        const winningPatterns = Object.entries(this.patterns.winning)
            .filter(([pattern, count]) => count >= 1 && count <= validClosedTrades.length)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const losingPatterns = Object.entries(this.patterns.losing)
            .filter(([pattern, count]) => count >= 1 && count <= validClosedTrades.length)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const simulationStats = {
            totalSimulated: this.tradeHistory.filter(t => t.simulationResult).length,
            stopFirst: this.tradeHistory.filter(t =>
                t.simulationResult?.firstHit === 'STOP'
            ).length,
            targetFirst: this.tradeHistory.filter(t =>
                t.simulationResult?.firstHit?.startsWith('TARGET')
            ).length
        };

        return {
            totalTrades: validClosedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate * 100,
            profitFactor: profitFactor.toFixed(2),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            bestPatterns: winningPatterns,
            worstPatterns: losingPatterns,
            simulationStats: simulationStats,
            openTrades: this.openTrades.size,
            monitoredSymbols: Object.keys(this.symbolPerformance).length
        };
    }

    async sendPerformanceReport() {
        try {
            await sendLearningReport();
            return true;
        } catch (error) {
            console.error('Erro ao enviar relatório:', error.message);
            return false;
        }
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

        this.adaptiveDelay = 80;
        this.minDelay = 30;
        this.maxDelay = 300;
        this.usageThreshold = 0.7;

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
            }, 30000);
        });
    }

    async processQueue() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(1000);
                    continue;
                }

                const request = this.queue.shift();
                if (!request) {
                    await this.delay(80);
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
                        this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.5);
                        await this.delay(10000);
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

        return minuteUsage < 0.85 && secondUsage < 0.8;
    }

    adjustDelay() {
        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;

        if (minuteUsage > this.usageThreshold) {
            this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.1);
        } else if (minuteUsage < this.usageThreshold * 0.5) {
            this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.9);
        }
    }

    async waitForLimits(weight) {
        const now = Date.now();
        const minuteRemaining = 60000 - (now - this.minuteWindow.start);
        const secondRemaining = 1000 - (now - this.secondWindow.start);

        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        const secondUsage = this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond;

        if (minuteUsage > 0.85) {
            await this.delay(minuteRemaining + 100);
        } else if (secondUsage > 0.8) {
            await this.delay(secondRemaining + 100);
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
                const timeoutId = setTimeout(() => controller.abort(), 20000);

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

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS COM NOVO FORMATO
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const baseProbability = calculateProbability(signal);
        const riskAdjustedProbability = Math.max(30, Math.min(95, baseProbability - (riskAssessment.overallScore * 2)));

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';

        const riskEmoji = riskAssessment.level === 'CRITICAL' ? '🚨' :
            riskAssessment.level === 'HIGH' ? '🔴' :
                riskAssessment.level === 'MEDIUM' ? '🟡' : '🟢';

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

        const fundingRate = signal.marketData.funding?.raw || 0;
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
            : '🔹 Indisp.';

        let alertTitle = '';
        let alertType = '';
        
        if (isVolumeConfirmed) {
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}</b>`;
            alertType = 'trade';
        } else {
            alertTitle = `🤖 <i>IA ANALISANDO...  ${signal.symbol}</i>`;
            alertType = 'analysis';
        }

        let message = `
${alertTitle}
${now.full} <a href="${tradingViewLink}">Gráfico</a>
<i> Indicadores Técnicos</i>
⚠️ Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
• Preço: $${signal.price.toFixed(6)}
⚠️ Vol: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification}) -Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
• Dist. Suport/Resist.: ${distancePercent}%
• Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
• LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}| RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
<i>🤖 IA Momentum/Risco </i>
• Risco: ${riskAssessment.overallScore.toFixed(2)} | Nível: ${riskEmoji} ${riskAssessment.level} 
⚠️ IA Opinião/Confiança: ${riskAssessment.confidence}%
${!isVolumeConfirmed ? `• 🔶 ATENÇÃO NO VOLUME: Score ${volumeScore.toFixed(2)} - Aguarde confirmação` : ''}
${riskAssessment.warnings.length > 0 ? `• ${riskAssessment.warnings[0]}` : ''}
        `;

        if (isVolumeConfirmed) {
            message += `
<i> 💡Dica de Entrada : </i>
• Liquidez 1 : $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
<i> Alvos:</i>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
⛔Stop: $${signal.targetsData.stopPrice.toFixed(6)}
            `;
        } else {
            message += `
<i> ⚠️ VOLUME INSUFICIENTE PARA OPERAÇÃO</i>
• Aguarde confirmação de volume (Score ≥ ${VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore})
• EMA Ratio: ${volumeData?.emaRatio?.toFixed(2) || 'N/A'}x (mínimo: ${VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio}x)
• Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'} (mínimo: ${VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore})
            `;
        }

        message += `
<i>✨Titanium by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);

        console.log(`\n📤 ${alertType === 'trade' ? 'Alerta de TRADE' : 'Análise da IA'} enviado: ${signal.symbol}`);
        console.log(`   Data/Hora: ${now.full} TradingView`);
        console.log(`   Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})`);
        console.log(`   Probabilidade: ${riskAdjustedProbability}%`);
        console.log(`   Risk Level: ${riskAssessment.level} (Score: ${riskAssessment.overallScore.toFixed(2)})`);
        console.log(`   Confiança: ${riskAssessment.confidence}%`);
        console.log(`   Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   Funding: ${fundingRateText}`);

        return {
            type: alertType,
            volumeConfirmed: isVolumeConfirmed,
            volumeScore: volumeScore
        };

    } catch (error) {
        console.error('Erro ao enviar alerta com risk layer:', error.message);
        return await sendSignalAlert(signal);
    }
}

async function sendSignalAlert(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        let alertTitle = '';
        if (isVolumeConfirmed) {
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}</b>`;
        } else {
            alertTitle = `🤖 <b>IA Analisando... #${signal.symbol}</b>`;
        }

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';

        const fundingRate = signal.marketData.funding?.raw || 0;
        let fundingRateEmoji = '';
        if (fundingRate <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (fundingRate <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (fundingRate <= -0.0005) fundingRateEmoji = '🟢';
        else if (fundingRate >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (fundingRate >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (fundingRate >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
        
        const fundingRateText = fundingRate !== 0
            ? `${fundingRateEmoji} ${(fundingRate * 100).toFixed(5)}% ${signal.marketData.funding?.isRising ? '⬆️' : '⬇️'}`
            : '🔹 Indisp.';

        let message = `
${alertTitle}
${now.full} <a href="${tradingViewLink}">Gráfico</a>
<b>🎯 ANÁLISE TÉCNICA AVANÇADA</b>
• Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
• Probabilidade de Sucesso: ${baseProbability}%
• Preço: $${signal.price.toFixed(6)} | Stop: $${signal.targetsData.stopPrice.toFixed(6)}
• Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})
• VMA: ${volumeData?.vmaRatio?.toFixed(2) || 'N/A'}x | Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
• LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}
• RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Dist S/R: ${distancePercent}% | Pivot: ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
• Fund. Rate: ${fundingRateText}
${!isVolumeConfirmed ? `\n<b>⚠️ VOLUME INSUFICIENTE PARA OPERAÇÃO</b>` : ''}
        `;

        if (isVolumeConfirmed) {
            message += `
<b> Alvos </b>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}
<b>📍 ENTRADA</b>
• Liquidez 1: $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
            `;
        } else {
            message += `
<b>⚠️ RECOMENDAÇÃO:</b>
• Aguarde confirmação de volume (Score ≥ ${VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore})
• Monitorar para possível entrada futura
            `;
        }

        message += `
<i>✨🤖IA Titanium by @J4Rviz</i>
        `;

        await sendTelegramAlert(message);

        console.log(`📤 ${isVolumeConfirmed ? 'Alerta de TRADE' : 'Análise da IA'} enviado: ${signal.symbol}`);
        console.log(`   Data/Hora: ${now.full} TradingView`);
        console.log(`   Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Pivot: ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   Funding: ${fundingRateText}`);

    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

function getVolumeClassification(volumeRatio) {
    if (volumeRatio >= 2.5) return '🔥 MUITO ALTO';
    if (volumeRatio >= 2.0) return '📈 ALTO';
    if (volumeRatio >= 1.5) return '📊 MODERADO';
    if (volumeRatio >= 1.2) return '📉 BAIXO';
    return '⚠️ MUITO BAIXO';
}

function calculateProbability(signal) {
    let baseProbability = 70; // Aumentado devido a remoção do ADX

    baseProbability += (signal.qualityScore.score - 70) * 0.4;

    const volumeData = signal.marketData.volume?.robustData;
    const volumeScore = volumeData?.combinedScore || 0;
    
    if (volumeScore >= 0.7) baseProbability += 15; // Aumentado
    else if (volumeScore >= 0.5) baseProbability += 8; // Aumentado
    else if (volumeScore < 0.3) baseProbability -= 10;

    const srData = signal.marketData.supportResistance;
    const nearestLevel = signal.isBullish ?
        srData?.nearestResistance : srData?.nearestSupport;
    const distance = nearestLevel?.distancePercent || 0;

    if (distance >= 3.0) baseProbability += 8;
    else if (distance >= 2.0) baseProbability += 4;
    else if (distance < 0.8) baseProbability -= 15;

    if (signal.marketData.breakoutRisk?.level === 'high') baseProbability -= 12;
    if (signal.marketData.breakoutRisk?.level === 'low') baseProbability += 5;

    const rsiValue = signal.marketData.rsi?.value || 50;
    if ((signal.isBullish && rsiValue <= RSI_BUY_MAX) ||
               (!signal.isBullish && rsiValue >= RSI_SELL_MIN)) {
        baseProbability += 10; // Aumentado
    }

    const pivotData = signal.marketData.pivotPoints;
    if (pivotData?.nearestPivot) {
        const pivotDistance = pivotData.nearestPivot.distancePercent || 0;
        const pivotStrength = pivotData.nearestPivot.strength || 'unknown';
        
        const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
        
        if (pivotDistance < safeDistance * 0.5) {
            baseProbability -= 15;
        } else if (pivotDistance < safeDistance) {
            baseProbability -= 8;
        } else if (pivotDistance > safeDistance * 1.5) {
            baseProbability += 5;
        }
        
        if (pivotData.nearestPivot.isTesting) {
            baseProbability -= 12;
        }
        
        if (pivotData.nearestPivot.timeframe) {
            const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotData.nearestPivot.timeframe] || 1.0;
            if (timeframeWeight >= 2.0 && pivotDistance < safeDistance) {
                baseProbability -= 5;
            }
        }
    }

    return Math.min(95, Math.max(40, Math.round(baseProbability)));
}

// =====================================================================
// 📊 FUNÇÃO PARA BUSCAR LSR DA BINANCE (CORRIGIDA)
// =====================================================================

async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 120000) {
            return candleCache[cacheKey].data;
        }
        
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const response = await rateLimiter.makeRequest(url, {}, 'klines');
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            console.log(`⚠️  Resposta da API LSR vazia para ${symbol}.`);
            return null;
        }
        
        const latestData = response[0];
        
        if (!latestData.longShortRatio || !latestData.longAccount || !latestData.shortAccount) {
            console.log(`⚠️  Estrutura de dados LSR inesperada para ${symbol}:`, latestData);
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
        
        candleCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Binance LSR ${symbol} (${period}): ${result.lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar LSR da Binance para ${symbol}:`, error.message);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO ATUALIZADA DE DETECÇÃO DE VOLUME ROBUSTA 3 MINUTOS (OTIMIZADA)
// =====================================================================

async function checkVolumeRobust(symbol) {
    try {
        const cacheKey = `volume_${symbol}`;
        const now = Date.now();
        
        if (volumeAnalysisCache[cacheKey] && now - volumeAnalysisCache[cacheKey].timestamp < VOLUME_CACHE_TTL) {
            return volumeAnalysisCache[cacheKey].data;
        }
        
        // Usar engine paralela para cálculos de volume
        const parallelEngine = new ParallelCalculationEngine();
        
        const candles = await getCandlesCached(symbol, '3m', VOLUME_ROBUST_SETTINGS.maxZScoreLookback);
        if (candles.length < 20) {
            const result = {
                rawRatio: 0,
                isAbnormal: false,
                robustData: null
            };
            volumeAnalysisCache[cacheKey] = { data: result, timestamp: now };
            return result;
        }

        const volumes = candles.map(c => c.volume);
        const closes = candles.map(c => c.close);
        
        const currentVolume = volumes[volumes.length - 1];
        const previousVolume = volumes[volumes.length - 2] || currentVolume;
        
        // Executar cálculos em paralelo
        const calculationTasks = [
            {
                type: 'VOLUME_ZSCORE',
                data: { 
                    volumes: volumes, 
                    lookback: calculateAdaptiveZScoreLookback(closes) 
                }
            }
        ];
        
        const [zScoreResult] = await parallelEngine.executeParallelCalculations(calculationTasks);
        
        // Calcular EMA do volume
        const emaData = calculateVolumeEMA(volumes, VOLUME_ROBUST_SETTINGS.emaPeriod, VOLUME_ROBUST_SETTINGS.emaAlpha);
        const emaRatio = currentVolume / emaData.currentEMA;
        const emaScore = calculateEMAScore(emaRatio);
        
        // Usar z-score calculado paralelamente
        const zScore = zScoreResult?.currentZScore || 0;
        const zScoreScore = calculateZScoreScore(zScore);
        
        // Volume-Price Trend
        const vptData = calculateVolumePriceTrend(volumes, closes);
        const vptScore = calculateVPTScore(vptData);
        
        // SCORE COMBINADO
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
                zScoreLookback: calculateAdaptiveZScoreLookback(closes),
                isEMAValid: emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio,
                isZScoreValid: Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore,
                isVPTValid: vptData.priceMovementPercent >= VOLUME_ROBUST_SETTINGS.vptThreshold
            }
        };
        
        const result = {
            rawRatio,
            isAbnormal: combinedScore >= 0.6 || Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.zScoreThreshold,
            robustData
        };
        
        volumeAnalysisCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Volume Robust ${symbol} (3m): Score ${combinedScore.toFixed(2)} (${classification})`);
        
        return result;
        
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
    
    const recentVolumes = volumes.slice(-period * 2);
    const initialSMA = recentVolumes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = initialSMA;
    
    for (let i = period; i < recentVolumes.length; i++) {
        ema = alpha * recentVolumes[i] + (1 - alpha) * ema;
    }
    
    const averageVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    
    return {
        currentEMA: ema,
        averageVolume: averageVolume,
        emaTrend: ema > initialSMA ? 'rising' : 'falling'
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
    
    if (volatility > 2.0) {
        return Math.max(VOLUME_ROBUST_SETTINGS.minZScoreLookback, 
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 0.6);
    } else if (volatility < 0.5) {
        return Math.min(VOLUME_ROBUST_SETTINGS.maxZScoreLookback,
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 1.3);
    }
    
    return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
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
    const currentVolume = recentVolumes[recentVolumes.length - 1];
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    
    const hasSignificantMovement = Math.abs(priceChange) >= VOLUME_ROBUST_SETTINGS.minPriceMovement;
    
    let trendDirection = 'neutral';
    if (priceChange > VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bullish';
    } else if (priceChange < -VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bearish';
    }
    
    let correlation = 0;
    if (hasSignificantMovement) {
        const volumeChange = currentVolume - avgVolume;
        const priceChangeAbs = Math.abs(priceChange);
        correlation = Math.min(1, Math.max(-1, volumeChange / (avgVolume * 0.1) * (priceChange / priceChangeAbs)));
    }
    
    return {
        priceMovementPercent: priceChange,
        volumeTrend: currentVolume > avgVolume ? 'rising' : 'falling',
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
// 📊 NOVAS FUNÇÕES PARA PONTOS DE PIVÔ MULTI-TIMEFRAME (OTIMIZADAS)
// =====================================================================

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const parallelEngine = new ParallelCalculationEngine();
        const allPivots = [];
        
        // Preparar tarefas para execução paralela
        const pivotTasks = [];
        
        for (const timeframe of PIVOT_POINTS_SETTINGS.analyzeTimeframes) {
            try {
                const candles = await getCandlesCached(
                    symbol, 
                    timeframe, 
                    PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe] || 50
                );

                if (candles.length < 30) continue;

                const highs = candles.map(c => c.high);
                const lows = candles.map(c => c.low);
                
                pivotTasks.push({
                    type: 'PIVOT_POINTS',
                    data: {
                        highs: highs,
                        lows: lows,
                        timeframe: timeframe
                    }
                });
                
            } catch (error) {
                console.log(`⚠️ Erro preparação pivot ${timeframe} ${symbol}: ${error.message}`);
                continue;
            }
        }

        // Executar análise de pivots em paralelo
        const pivotResults = await parallelEngine.executeParallelCalculations(pivotTasks);
        
        // Processar resultados
        pivotResults.forEach((result, index) => {
            if (!result) return;
            
            const timeframe = pivotTasks[index].data.timeframe;
            
            result.pivotLows.forEach(pivot => {
                pivot.timeframe = timeframe;
                pivot.strength = calculatePivotStrength(pivot, timeframe);
                pivot.type = 'support';
                allPivots.push(pivot);
            });
            
            result.pivotHighs.forEach(pivot => {
                pivot.timeframe = timeframe;
                pivot.strength = calculatePivotStrength(pivot, timeframe);
                pivot.type = 'resistance';
                allPivots.push(pivot);
            });
        });

        if (allPivots.length === 0) {
            return { error: 'Nenhum pivot detectado' };
        }

        // Separar supports e resistances
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
                '15m': allPivots.filter(p => p.timeframe === '15m').length,
                '1h': allPivots.filter(p => p.timeframe === '1h').length
            }
        };

    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        return { error: error.message };
    }
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

// =====================================================================
// 📊 FUNÇÃO PARA DETECTAR SUPORTES E RESISTÊNCIAS (OTIMIZADA)
// =====================================================================

async function analyzeSupportResistance(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, SUPPORT_RESISTANCE_SETTINGS.timeframe,
            SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod + 10);

        if (candles.length < 30) {
            return { error: 'Dados insuficientes' };
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

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
                Math.abs(level.price - currentLow) / currentLow < 0.005
            );

            if (existingLevel) {
                existingLevel.touchCount++;
                existingLevel.strength = calculateLevelStrength(existingLevel.touchCount);
            } else {
                levels.push({
                    price: currentLow,
                    touchCount: 1,
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
                Math.abs(level.price - currentHigh) / currentHigh < 0.005
            );

            if (existingLevel) {
                existingLevel.touchCount++;
                existingLevel.strength = calculateLevelStrength(existingLevel.touchCount);
            } else {
                levels.push({
                    price: currentHigh,
                    touchCount: 1,
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
        .filter(level => level.touchCount >= 2)
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

        const strongResistance = resistanceLevels.filter(r => r.strength === 'strong' || r.strength === 'very_strong');
        const strongSupport = supportLevels.filter(s => s.strength === 'strong' || s.strength === 'very_strong');

        for (const resistance of strongResistance) {
            if (prevCandle.high < resistance.price && candle.high > resistance.price) {
                breakouts.push({
                    type: 'resistance_breakout',
                    level: resistance.price,
                    strength: resistance.strength,
                    candle: i
                });
                break;
            }
        }

        for (const support of strongSupport) {
            if (prevCandle.low > support.price && candle.low < support.price) {
                breakouts.push({
                    type: 'support_breakout',
                    level: support.price,
                    strength: support.strength,
                    candle: i
                });
                break;
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
        analysis.push(`Suporte mais próximo: ${nearestSupport.price.toFixed(6)} (${nearestSupport.strength})`);
        analysis.push(`Distância ao suporte: ${((nearestSupport.distancePercent || 0).toFixed(2))}%`);

        if (nearestSupport.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DO SUPORTE!`);
        }
    }

    if (nearestResistance) {
        analysis.push(`Resistência mais próximo: ${nearestResistance.price.toFixed(6)} (${nearestResistance.strength})`);
        analysis.push(`Distância à resistência: ${((nearestResistance.distancePercent || 0).toFixed(2))}%`);

        if (nearestResistance.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DA RESISTÊNCIA!`);
        }
    }

    return analysis;
}

async function getATRData(symbol, timeframe = '15m', period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 10);
        if (candles.length < period) return null;

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        // Usar engine paralela para cálculo de ATR
        const parallelEngine = new ParallelCalculationEngine();
        
        const atrTask = {
            type: 'ATR_CALCULATION',
            data: {
                highs: highs,
                lows: lows,
                closes: closes,
                period: period
            }
        };
        
        const [atrResult] = await parallelEngine.executeParallelCalculations([atrTask]);
        
        if (!atrResult) return null;

        const atrPercentage = (atrResult.value / closes[closes.length - 1]) * 100;

        let volatilityLevel = 'medium';
        if (atrPercentage < 1.0) volatilityLevel = 'low';
        else if (atrPercentage > 2.5) volatilityLevel = 'high';

        return {
            value: atrResult.value,
            average: atrResult.average,
            percentage: atrPercentage,
            volatilityLevel: volatilityLevel,
            raw: atrResult.raw
        };
    } catch (error) {
        return null;
    }
}

function calculateDynamicStopLoss(price, isBullish, atrData) {
    if (!atrData || !DYNAMIC_STOP_SETTINGS.volatilityBased) {
        const stopPercentage = 3.0;
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
                price: targetPrice.toFixed(6),
                riskReward: riskReward.toFixed(2),
                distance: distanceToTarget
            };
        });

        const validTargets = targets.filter(t => parseFloat(t.riskReward) >= 1.5);
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
    const stopPercentage = 3.0;
    const stopPrice = isBullish ?
        price * (1 - stopPercentage / 100) :
        price * (1 + stopPercentage / 100);

    const targets = TARGET_PERCENTAGES.map(percent => ({
        target: percent.toFixed(1),
        price: isBullish ?
            (price * (1 + percent / 100)).toFixed(6) :
            (price * (1 - percent / 100)).toFixed(6),
        riskReward: (percent / stopPercentage).toFixed(2)
    }));

    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        targets: targets,
        bestRiskReward: (8.0 / stopPercentage).toFixed(2),
        stopData: { method: 'fixed_fallback' },
        retracementData: { method: 'fixed_fallback' }
    };
}

// =====================================================================
// 🚀 FUNÇÃO PARA MENSAGEM DE INICIALIZAÇÃO SIMPLES
// =====================================================================

async function sendSimpleActivationMessage(symbolCount) {
    try {
        const now = getBrazilianDateTime();
        const message = `🚀 <b>Titanium ativado</b>\n\n📊 Monitorando ${symbolCount} pares\n⏰ ${now.full}\n\n✨ by @J4Rviz`;
        
        await sendTelegramAlert(message);
        console.log('✅ Titanium ativado!');
        return true;
    } catch (error) {
        console.log('⚠️ Mensagem de ativação não enviada:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÕES DE ANÁLISE TÉCNICA OTIMIZADAS COM PARALELISMO
// =====================================================================

let rateLimiter = new AdaptiveRateLimiter();
let learningSystem = new AdvancedLearningSystem();
let parallelEngine = new ParallelCalculationEngine();

// CACHE para candles otimizado
const optimalLimits = {
    '1m': 40,
    '3m': 50,
    '5m': 45,
    '15m': 40,
    '30m': 35,
    '1h': 30,
    '2h': 25,
    '4h': 20
};

async function getCandlesCached(symbol, timeframe, limit = 50) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();

        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }

        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h'
        };

        const interval = intervalMap[timeframe] || '15m';
        const actualLimit = optimalLimits[timeframe] || Math.min(limit, 40);
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${actualLimit}`;

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

// Função batch para análise técnica otimizada com paralelismo
async function batchTechnicalAnalysis(symbol, isBullish) {
    try {
        // Buscar candles em paralelo
        const [candles3m, candles1h, candles15m, candles4h] = await Promise.all([
            getCandlesCached(symbol, '3m', 55),
            getCandlesCached(symbol, '1h', 40),
            getCandlesCached(symbol, '15m', 40),
            getCandlesCached(symbol, '4h', 30)
        ]);

        if (candles3m.length < 20 || candles1h.length < 14) {
            return null;
        }

        const currentPrice = candles3m[candles3m.length - 1].close;
        
        // Preparar tarefas para cálculos paralelos
        const calculationTasks = [];
        
        // EMA 3m
        const closes3m = candles3m.map(c => c.close);
        calculationTasks.push({
            type: 'EMA_CALCULATION',
            data: {
                values: closes3m,
                periods: [13, 34, 55]
            }
        });
        
        // RSI 1h
        const closes1h = candles1h.map(c => c.close);
        calculationTasks.push({
            type: 'RSI_CALCULATION',
            data: {
                values: closes1h,
                period: 14
            }
        });
        
        // Executar cálculos em paralelo
        const [emaResults, rsiResult] = await parallelEngine.executeParallelCalculations(calculationTasks);
        
        if (!emaResults || !rsiResult) {
            return null;
        }
        
        const latestEma13 = emaResults.ema13;
        const latestEma34 = emaResults.ema34;
        const latestEma55 = emaResults.ema55;
        const previousEma13 = emaResults.ema13_previous;
        const previousEma34 = emaResults.ema34_previous;
        
        const isAboveEMA55 = currentPrice > latestEma55;
        const isBullishEMA = isAboveEMA55 && previousEma13 <= previousEma34 && latestEma13 > latestEma34;
        const isBearishEMA = !isAboveEMA55 && previousEma13 >= previousEma34 && latestEma13 < latestEma34;
        
        if (!isBullishEMA && !isBearishEMA) {
            return null;
        }
        
        const isBullishSignal = isBullishEMA;
        
        // Verificar RSI
        if (isBullishSignal && rsiResult.value > RSI_BUY_MAX) {
            console.log(`⚠️ ${symbol}: RSI alto para compra (${rsiResult.value.toFixed(1)} > ${RSI_BUY_MAX})`);
            return null;
        }
        if (!isBullishSignal && rsiResult.value < RSI_SELL_MIN) {
            console.log(`⚠️ ${symbol}: RSI baixo para venda (${rsiResult.value.toFixed(1)} < ${RSI_SELL_MIN})`);
            return null;
        }
        
        return {
            currentPrice,
            isBullish: isBullishSignal,
            emaData: {
                isAboveEMA55,
                isEMA13CrossingUp: isBullishEMA,
                isEMA13CrossingDown: isBearishEMA
            },
            rsiData: {
                value: rsiResult.value,
                previous: rsiResult.previous,
                raw: rsiResult.raw,
                status: rsiResult.status,
                isExitingExtreme: rsiResult.isExitingExtreme
            },
            candles3m,
            candles1h,
            candles15m,
            candles4h
        };

    } catch (error) {
        console.log(`⚠️ Erro análise batch ${symbol}: ${error.message}`);
        return null;
    }
}

async function fetchAllFuturesSymbols() {
    try {
        const cacheKey = 'all_futures_symbols';
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 300000) {
            return candleCache[cacheKey].data;
        }

        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );

        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);

        console.log(`✅ ${symbols.length} pares USDT encontrados`);
        
        candleCache[cacheKey] = { data: symbols, timestamp: now };
        
        return symbols;

    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando fallback');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function getEMAs3m(symbol) {
    try {
        const analysis = await batchTechnicalAnalysis(symbol, true);
        if (!analysis) return null;
        
        return {
            currentPrice: analysis.currentPrice,
            isAboveEMA55: analysis.emaData.isAboveEMA55,
            isEMA13CrossingUp: analysis.emaData.isEMA13CrossingUp,
            isEMA13CrossingDown: analysis.emaData.isEMA13CrossingDown
        };
    } catch (error) {
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const analysis = await batchTechnicalAnalysis(symbol, true);
        if (!analysis) return null;
        
        return analysis.rsiData;
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    return await checkVolumeRobust(symbol);
}

async function checkVolatility(symbol) {
    try {
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 5);
        if (candles.length < 15) return { rawVolatility: 0, isValid: false };

        const closes = candles.map(c => c.close);
        let sumReturns = 0;

        for (let i = 1; i < closes.length; i++) {
            sumReturns += Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
        }

        const volatility = sumReturns / (closes.length - 1) * 100;

        return {
            rawVolatility: volatility,
            isValid: volatility >= VOLATILITY_THRESHOLD
        };
    } catch (error) {
        return { rawVolatility: 0, isValid: false };
    }
}

// =====================================================================
// 🔄 FUNÇÃO checkLSR MODIFICADA - APENAS LSR DA BINANCE
// =====================================================================

async function checkLSR(symbol, isBullish) {
    try {
        const binanceLSR = await getBinanceLSRValue(symbol, '15m');
        
        if (!binanceLSR || binanceLSR.lsrValue === null) {
            console.log(`⚠️ LSR Binance não disponível para ${symbol}`);
            return { 
                lsrRatio: 0, 
                isValid: false, 
                binanceLSR: null,
                isRising: false,
                percentChange: '0.00'
            };
        }
        
        const lsrValue = binanceLSR.lsrValue;
        const isRising = binanceLSR.isRising;
        const percentChange = binanceLSR.percentChange;
        
        const isValid = isBullish ? 
            lsrValue <= LSR_BUY_THRESHOLD :
            lsrValue > LSR_SELL_THRESHOLD;

        console.log(`📊 LSR Binance ${symbol} (15m): ${lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);

        return {
            lsrRatio: lsrValue,
            isValid: isValid,
            binanceLSR: binanceLSR,
            isRising: isRising,
            percentChange: percentChange,
            rawData: {
                currentLSR: lsrValue,
                isValidForDirection: isValid
            }
        };
    } catch (error) {
        console.error(`❌ Erro no cálculo do LSR para ${symbol}:`, error.message);
        return { 
            lsrRatio: 0, 
            isValid: false, 
            binanceLSR: null,
            isRising: false,
            percentChange: '0.00'
        };
    }
}

// Função getADX1h removida completamente

// ATUALIZADO: Função checkStochastic com paralelismo
async function checkStochastic(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 25);
        if (candles.length < STOCH_SETTINGS.period + 5) return { isValid: false };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochTask = {
            type: 'STOCH_CALCULATION',
            data: {
                highs: highs,
                lows: lows,
                closes: closes,
                period: STOCH_SETTINGS.period,
                smooth: STOCH_SETTINGS.smooth,
                signalPeriod: STOCH_SETTINGS.signalPeriod
            }
        };
        
        const [stochResult] = await parallelEngine.executeParallelCalculations([stochTask]);
        
        if (!stochResult || !stochResult.isValid) {
            return { isValid: false };
        }
        
        if (isBullish) {
            return {
                isValid: stochResult.isBullish,
                kValue: stochResult.kValue,
                dValue: stochResult.dValue,
                kPrevious: stochResult.kPrevious,
                dPrevious: stochResult.dPrevious
            };
        } else {
            return {
                isValid: stochResult.isBearish,
                kValue: stochResult.kValue,
                dValue: stochResult.dValue,
                kPrevious: stochResult.kPrevious,
                dPrevious: stochResult.dPrevious
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

async function checkStochastic4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 30);
        if (candles.length < STOCH_4H_SETTINGS.period + 5) return { isValid: false };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochTask = {
            type: 'STOCH_CALCULATION',
            data: {
                highs: highs,
                lows: lows,
                closes: closes,
                period: STOCH_4H_SETTINGS.period,
                smooth: STOCH_4H_SETTINGS.smooth,
                signalPeriod: STOCH_4H_SETTINGS.signalPeriod
            }
        };
        
        const [stochResult] = await parallelEngine.executeParallelCalculations([stochTask]);
        
        if (!stochResult || !stochResult.isValid) {
            return { isValid: false };
        }
        
        if (isBullish) {
            return {
                isValid: stochResult.isBullish,
                kValue: stochResult.kValue,
                dValue: stochResult.dValue
            };
        } else {
            return {
                isValid: stochResult.isBearish,
                kValue: stochResult.kValue,
                dValue: stochResult.dValue
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

async function checkCCI4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 40);
        if (candles.length < CCI_4H_SETTINGS.period + 10) return {
            value: 0,
            maValue: 0,
            isValid: false
        };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cciTask = {
            type: 'CCI_CALCULATION',
            data: {
                highs: highs,
                lows: lows,
                closes: closes,
                period: CCI_4H_SETTINGS.period,
                maPeriod: CCI_4H_SETTINGS.maPeriod
            }
        };
        
        const [cciResult] = await parallelEngine.executeParallelCalculations([cciTask]);
        
        if (!cciResult || !cciResult.isValid) {
            return {
                value: 0,
                maValue: 0,
                isValid: false
            };
        }
        
        const isValid = isBullish ?
            cciResult.value > cciResult.maValue :
            cciResult.value < cciResult.maValue;
            
        return {
            value: cciResult.value,
            maValue: cciResult.maValue,
            isValid: isValid,
            deviation: cciResult.deviation
        };
    } catch (error) {
        return {
            value: 0,
            maValue: 0,
            isValid: false
        };
    }
}

async function checkOpenInterest(symbol, isBullish) {
    try {
        const cacheKey = `oi_${symbol}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 120000) {
            return candleCache[cacheKey].data;
        }

        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`,
            {},
            'openInterest'
        );

        const oi = parseFloat(data.openInterest);
        const timestamp = Date.now();

        if (!oiCache[symbol]) {
            oiCache[symbol] = { history: [], timestamp: timestamp };
        }

        oiCache[symbol].history.push({ oi, timestamp });

        if (oiCache[symbol].history.length > OI_HISTORY_SIZE) {
            oiCache[symbol].history = oiCache[symbol].history.slice(-OI_HISTORY_SIZE);
        }

        let trend = "➡️";
        if (oiCache[symbol].history.length >= 3) {
            const recentOI = oiCache[symbol].history.slice(-3).map(h => h.oi);
            const avgOI = recentOI.reduce((a, b) => a + b, 0) / recentOI.length;

            if (oi > avgOI * 1.05) trend = "📈";
            else if (oi < avgOI * 0.95) trend = "📉";
        }

        const isValid = (isBullish && trend === "📈") || (!isBullish && trend === "📉");

        const result = {
            isValid: isValid,
            trend: trend
        };

        candleCache[cacheKey] = { data: result, timestamp: now };

        return result;
    } catch (error) {
        return { isValid: false, trend: "➡️" };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        const cacheKey = `funding_${symbol}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 180000) {
            return candleCache[cacheKey].data;
        }

        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=2`,
            {},
            'fundingRate'
        );

        if (!data || data.length === 0) {
            return { 
                isValid: false, 
                raw: 0,
                isRising: false,
                directionFavorable: false
            };
        }

        const fundingRate = parseFloat(data[0].fundingRate);
        
        let isRising = false;
        if (data.length >= 2) {
            const previousRate = parseFloat(data[1].fundingRate);
            isRising = fundingRate > previousRate;
        }
        
        const isFavorable = isBullish ? fundingRate < 0 : fundingRate > 0;
        const isValid = isFavorable;

        const result = {
            isValid: isValid,
            raw: fundingRate,
            isRising: isRising,
            directionFavorable: isFavorable
        };

        candleCache[cacheKey] = { data: result, timestamp: now };

        return result;
    } catch (error) {
        return { 
            isValid: false, 
            raw: 0, 
            isRising: false,
            directionFavorable: false 
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO ATUALIZADA PARA CALCULAR QUALIDADE COM EARLY EXIT - ADX REMOVIDO
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    // EARLY EXIT: Verificar volume primeiro - SEU FILTRO PRINCIPAL
    if (marketData.volume?.robustData?.combinedScore < 0.4) {
        return {
            score: 0,
            grade: "D",
            emoji: "❌",
            isAcceptable: false,
            message: "❌ Volume insuficiente",
            details: [],
            failedChecks: ['Volume Score < 0.4']
        };
    }

    // EARLY EXIT: Verificar LSR
    if (!marketData.lsr || !marketData.lsr.isValid) {
        return {
            score: 0,
            grade: "D",
            emoji: "❌",
            isAcceptable: false,
            message: "❌ LSR inválido",
            details: [],
            failedChecks: ['LSR inválido']
        };
    }

    // EARLY EXIT: Verificar RSI
    const rsiValue = marketData.rsi?.value || 50;
    if ((isBullish && rsiValue > RSI_BUY_MAX) || (!isBullish && rsiValue < RSI_SELL_MIN)) {
        return {
            score: 0,
            grade: "D",
            emoji: "❌",
            isAcceptable: false,
            message: "❌ RSI fora da zona",
            details: [],
            failedChecks: ['RSI fora da zona ideal']
        };
    }

    // EARLY EXIT: Verificar EMA alinhamento
    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
            (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);

        if (!isEmaValid) {
            return {
                score: 0,
                grade: "D",
                emoji: "❌",
                isAcceptable: false,
                message: "❌ EMA não alinhada",
                details: [],
                failedChecks: ['EMA não alinhada']
            };
        }
    }

    // Se passou todos os early exits, calcular score completo
    let score = 0;
    let details = [];
    let failedChecks = [];

    // 1. Volume (já validado acima)
    const volumeData = marketData.volume?.robustData;
    if (volumeData && volumeData.combinedScore >= 0.5) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume,
            QUALITY_WEIGHTS.volume * volumeData.combinedScore);
        score += volumeScore;
        details.push(` Vol 3m Robusto: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (Score: ${volumeData.combinedScore.toFixed(2)})`);
    }

    // 2. Volatilidade
    if (marketData.volatility && marketData.volatility.isValid) {
        score += QUALITY_WEIGHTS.volatility;
        details.push(` Volatilidade: ${QUALITY_WEIGHTS.volatility}/${QUALITY_WEIGHTS.volatility}`);
    }

    // 3. LSR (já validado acima)
    score += QUALITY_WEIGHTS.lsr;
    details.push(` LSR: ${QUALITY_WEIGHTS.lsr}/${QUALITY_WEIGHTS.lsr}`);

    // 4. RSI (já validado acima)
    let rsiScore = 0;
    if (isBullish && rsiValue <= RSI_BUY_MAX) {
        rsiScore = QUALITY_WEIGHTS.rsi;
        details.push(` RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi}`);
    } else if (!isBullish && rsiValue >= RSI_SELL_MIN) {
        rsiScore = QUALITY_WEIGHTS.rsi;
        details.push(` RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi}`);
    }
    score += rsiScore;

    // 5. EMA Alignment (já validado acima)
    score += QUALITY_WEIGHTS.emaAlignment;
    details.push(` EMA 3m: ${QUALITY_WEIGHTS.emaAlignment}/${QUALITY_WEIGHTS.emaAlignment}`);

    // 6. Stochastic 1h (cálculo leve, manter)
    if (marketData.stoch && marketData.stoch.isValid) {
        score += QUALITY_WEIGHTS.stoch1h;
        details.push(` Stoch 1h: ${QUALITY_WEIGHTS.stoch1h}/${QUALITY_WEIGHTS.stoch1h}`);
    }

    // 7. Stochastic 4h (opcional)
    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        score += QUALITY_WEIGHTS.stoch4h;
        details.push(` Stoch 4h: ${QUALITY_WEIGHTS.stoch4h}/${QUALITY_WEIGHTS.stoch4h}`);
    }

    // 8. CCI 4h (opcional)
    if (marketData.cci4h && marketData.cci4h.isValid) {
        score += QUALITY_WEIGHTS.cci4h;
        details.push(` CCI 4h: ${QUALITY_WEIGHTS.cci4h}/${QUALITY_WEIGHTS.cci4h}`);
    }

    // 9. Open Interest
    if (marketData.oi && marketData.oi.isValid) {
        score += QUALITY_WEIGHTS.oi;
        details.push(` OI: ${QUALITY_WEIGHTS.oi}/${QUALITY_WEIGHTS.oi}`);
    }

    // 10. Funding Rate
    if (marketData.funding && marketData.funding.isValid) {
        score += QUALITY_WEIGHTS.funding;
        details.push(` Funding: ${QUALITY_WEIGHTS.funding}/${QUALITY_WEIGHTS.funding}`);
    }

    // 11. Breakout Risk
    if (marketData.breakoutRisk) {
        let breakoutScore = 0;
        
        switch (marketData.breakoutRisk.level) {
            case 'very_low':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk;
                break;
            case 'low':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk * 0.8;
                break;
            case 'medium':
                breakoutScore = QUALITY_WEIGHTS.breakoutRisk * 0.5;
                break;
            case 'high':
                failedChecks.push(`Risco Rompimento: ALTO`);
                break;
        }
        
        score += breakoutScore;
        if (breakoutScore > 0) {
            details.push(` Risco Rompimento: ${breakoutScore.toFixed(1)}/${QUALITY_WEIGHTS.breakoutRisk}`);
        }
    }

    // 12. Support/Resistance
    if (marketData.supportResistance) {
        const nearestLevel = isBullish ?
            marketData.supportResistance.nearestResistance :
            marketData.supportResistance.nearestSupport;

        if (nearestLevel) {
            const distance = nearestLevel.distancePercent || 0;
            let srScore = 0;

            if (distance >= 3.0) {
                srScore = QUALITY_WEIGHTS.supportResistance;
            } else if (distance >= 1.5) {
                srScore = QUALITY_WEIGHTS.supportResistance * 0.7;
            } else if (distance >= 0.8) {
                srScore = QUALITY_WEIGHTS.supportResistance * 0.3;
            } else {
                failedChecks.push(`S/R: Muito próximo (${distance.toFixed(2)}%)`);
            }
            
            score += srScore;
            if (srScore > 0) {
                details.push(` Distância S/R: ${srScore.toFixed(1)}/${QUALITY_WEIGHTS.supportResistance}`);
            }
        }
    }

    // 13. Pivot Points
    if (marketData.pivotPoints) {
        const nearestPivot = marketData.pivotPoints.nearestPivot;
        
        if (nearestPivot) {
            const distance = nearestPivot.distancePercent || 0;
            const pivotStrength = nearestPivot.strength || 'unknown';
            const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
            const distanceRatio = distance / safeDistance;
            
            let pivotScore = 0;
            
            if (distanceRatio >= 1.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints;
            } else if (distanceRatio >= 1.0) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.8;
            } else if (distanceRatio >= 0.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.4;
            } else {
                failedChecks.push(`Pivot: Muito próximo (${distance.toFixed(2)}%)`);
            }
            
            if (nearestPivot.isTesting) {
                failedChecks.push(`Pivot: Testando nível`);
                pivotScore = 0;
            }
            
            score += pivotScore;
            if (pivotScore > 0) {
                details.push(` Pivot: ${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints}`);
            }
        }
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
// 🔄 MONITORAMENTO PRINCIPAL COM OTIMIZAÇÕES
// =====================================================================

class AdaptiveSymbolGroupManager {
    constructor() {
        this.symbolGroups = [];
        this.currentGroupIndex = 0;
        this.totalCycles = 0;
        this.groupSize = 30;
        this.signalsDetected = 0;
        this.baseDelay = 4000;
        this.minDelay = 2000;
        this.maxDelay = 8000;
        this.consecutiveNoSignals = 0;
        this.lastPerformanceLog = Date.now();
        
        // NOVO: Pré-carregamento de dados comuns
        this.globalMarketData = {
            btcPrice: null,
            btcCandles1h: null,
            btcVolatility: null,
            lastUpdate: 0
        };
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllFuturesSymbols();

            // Filtrar por volume e atividade recente
            const filteredSymbols = await this.filterActiveSymbols(allSymbols);

            this.symbolGroups = this.createGroups(filteredSymbols, this.groupSize);

            console.log(`📊 ${filteredSymbols.length} ativos ativos divididos em ${this.symbolGroups.length} grupos (${this.groupSize} cada)`);

            // Pré-carregar dados globais
            await this.preloadGlobalData();

            return filteredSymbols;

        } catch (error) {
            console.error('Erro ao inicializar símbolos:', error.message);
            return [];
        }
    }

    async filterActiveSymbols(symbols) {
        try {
            // Para performance, limitar a análise aos top 100 símbolos por volume
            const topSymbols = symbols.slice(0, 100);
            
            const volumePromises = topSymbols.map(async symbol => {
                try {
                    const candles = await getCandlesCached(symbol, '15m', 3);
                    if (candles.length < 3) return { symbol, volumeScore: 0 };
                    
                    const volumes = candles.map(c => c.volume);
                    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
                    
                    // Calcular movimento de preço
                    const priceChange = Math.abs((candles[2].close - candles[0].close) / candles[0].close) * 100;
                    
                    const volumeScore = avgVolume * (1 + Math.min(priceChange, 5) / 10);
                    return { symbol, volumeScore };
                } catch (error) {
                    return { symbol, volumeScore: 0 };
                }
            });
            
            const volumeResults = await Promise.all(volumePromises);
            
            // Ordenar por volume score e pegar top 50
            const sortedSymbols = volumeResults
                .filter(r => r.volumeScore > 0)
                .sort((a, b) => b.volumeScore - a.volumeScore)
                .slice(0, 50)
                .map(r => r.symbol);
            
            // Adicionar alguns símbolos importantes mesmo com volume baixo
            const importantSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
            importantSymbols.forEach(symbol => {
                if (!sortedSymbols.includes(symbol) && symbols.includes(symbol)) {
                    sortedSymbols.push(symbol);
                }
            });
            
            return sortedSymbols;
            
        } catch (error) {
            console.error('Erro ao filtrar símbolos:', error.message);
            // Fallback: usar primeiros 50 símbolos
            return symbols.slice(0, 50);
        }
    }

    async preloadGlobalData() {
        try {
            console.log('🔄 Pré-carregando dados globais...');
            
            const [btcCandles, btcTicker] = await Promise.all([
                getCandlesCached('BTCUSDT', '1h', 24),
                rateLimiter.makeRequest(
                    'https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BTCUSDT',
                    {},
                    'ticker24hr'
                )
            ]);
            
            this.globalMarketData = {
                btcPrice: parseFloat(btcTicker.lastPrice),
                btcCandles1h: btcCandles,
                btcVolatility: this.calculateBTCVolatility(btcCandles),
                lastUpdate: Date.now()
            };
            
            console.log('✅ Dados globais pré-carregados');
            
        } catch (error) {
            console.error('Erro ao pré-carregar dados globais:', error.message);
        }
    }

    calculateBTCVolatility(candles) {
        if (!candles || candles.length < 10) return 0;
        
        const closes = candles.map(c => c.close);
        let sumReturns = 0;
        
        for (let i = 1; i < closes.length; i++) {
            sumReturns += Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
        }
        
        return (sumReturns / (closes.length - 1)) * 100;
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
            
            // Atualizar dados globais a cada 5 ciclos
            if (this.totalCycles % 5 === 0) {
                this.preloadGlobalData();
            }
            
            // Pausa estratégica
            if (this.totalCycles % 5 === 0) {
                return { symbols: [], pause: 15000 };
            }
        }

        return { symbols: group, pause: 0 };
    }

    adjustDelayBasedOnUsage() {
        const now = Date.now();
        
        if (now - this.lastPerformanceLog >= 60000) {
            console.log(`📊 Performance: ${this.signalsDetected} sinais nos últimos ${this.totalCycles} ciclos`);
            console.log(`⏱️  Delay atual: ${this.baseDelay}ms, Grupos sem sinais: ${this.consecutiveNoSignals}`);
            this.lastPerformanceLog = now;
        }

        if (this.consecutiveNoSignals > 2) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.7);
            console.log(`⚡ Delay reduzido para ${this.baseDelay}ms (${this.consecutiveNoSignals} grupos sem sinais)`);
            this.consecutiveNoSignals = 0;
        }

        if (this.signalsDetected > 0) {
            this.consecutiveNoSignals = 0;
            if (this.baseDelay > this.minDelay * 1.5) {
                this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.9);
            }
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
            currentDelay: this.baseDelay,
            consecutiveNoSignals: this.consecutiveNoSignals
        };
    }
}

async function monitorSymbol(symbol) {
    try {
        // Análise técnica em batch
        const analysis = await batchTechnicalAnalysis(symbol, true);
        if (!analysis) return null;

        const { currentPrice, isBullish, rsiData } = analysis;

        // Análise de suporte/resistência e pivot points em paralelo
        const [supportResistanceData, pivotPointsData] = await Promise.all([
            analyzeSupportResistance(symbol, currentPrice, isBullish),
            analyzePivotPoints(symbol, currentPrice, isBullish)
        ]);

        // Análise dos outros indicadores em paralelo
        const [
            volumeData,
            volatilityData,
            lsrData,
            stochData,
            oiData,
            fundingData
        ] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            checkStochastic(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);

        // Remover indicadores pesados para performance
        // const stoch4hData = await checkStochastic4h(symbol, isBullish);
        // const cci4hData = await checkCCI4h(symbol, isBullish);

        if (!lsrData.isValid) return null;

        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            stoch: stochData,
            // stoch4h: stoch4hData,
            // cci4h: cci4hData,
            oi: oiData,
            funding: fundingData,
            ema: analysis.emaData,
            supportResistance: supportResistanceData,
            breakoutRisk: supportResistanceData?.breakoutRisk,
            pivotPoints: pivotPointsData,
        };

        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);

        if (!qualityScore.isAcceptable) return null;

        const targetsData = await calculateAdvancedTargetsAndStop(currentPrice, isBullish, symbol);

        const signal = {
            symbol: symbol,
            isBullish: isBullish,
            price: currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            timestamp: Date.now()
        };

        if (learningSystem) {
            await learningSystem.recordSignal(signal, marketData);
        }

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);

        return signal;

    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return null;
    }
}

async function processSymbolGroup(symbols) {
    const results = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const batchPromises = batch.map(symbol => 
            monitorSymbol(symbol).catch(() => null)
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));

        // Pequena pausa entre batches
        if (i + batchSize < symbols.length) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    return results;
}

function cleanupCaches() {
    const now = Date.now();
    const cleanupThreshold = 15 * 60 * 1000;

    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].timestamp > cleanupThreshold) {
            delete candleCache[key];
        }
    });

    Object.keys(volumeAnalysisCache).forEach(key => {
        if (now - volumeAnalysisCache[key].timestamp > cleanupThreshold) {
            delete volumeAnalysisCache[key];
        }
    });

    Object.keys(oiCache).forEach(key => {
        if (now - oiCache[key].timestamp > OI_CACHE_TTL) {
            delete oiCache[key];
        }
    });
}

// =====================================================================
// 🔄 LOOP PRINCIPAL DO BOT OTIMIZADO
// =====================================================================

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(3000)
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

    console.log(`\n🚀 TITANIUM ATIVADO - SISTEMA OTIMIZADO COM PARALELISMO`);
    console.log(`📊 ${allSymbols.length} ativos Binance Futures (filtrados por atividade)`);
    console.log(`⚡ Engine Paralela: ${PARALLEL_CONFIG.enabled ? 'ATIVADA' : 'DESATIVADA'}`);
    console.log(`📈 Grupos de ${symbolManager.groupSize} símbolos`);
    console.log(`🎯 SISTEMA SIMPLIFICADO: ADX REMOVIDO - FOCO NO VOLUME`);

    await sendSimpleActivationMessage(allSymbols.length);

    let consecutiveErrors = 0;
    let totalSignals = 0;
    let totalAnalysis = 0;
    let lastReportTime = Date.now();
    let lastRiskReportTime = Date.now();
    let cycleStartTime = Date.now();

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

            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 15s...');
                await new Promise(r => setTimeout(r, 15000));
                continue;
            }

            const startTime = Date.now();
            const signals = await processSymbolGroup(currentSymbols);
            const endTime = Date.now();

            const processingTime = endTime - startTime;
            totalSignals += signals.length;
            symbolManager.signalsDetected += signals.length;

            if (signals.length === 0) {
                symbolManager.consecutiveNoSignals++;
            } else {
                symbolManager.consecutiveNoSignals = 0;
            }

            console.log(`✅ ${(processingTime / 1000).toFixed(1)}s | Sinais: ${signals.length} (Total: ${totalSignals})`);

            // Processar sinais encontrados
            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    const alertResult = await sendSignalAlertWithRisk(signal);
                    if (alertResult && alertResult.type === 'analysis') {
                        totalAnalysis++;
                    }
                    await new Promise(r => setTimeout(r, 800));
                }
            }

            // Cleanup periódico
            if (Date.now() - cycleStartTime >= 300000) {
                cleanupCaches();
                cycleStartTime = Date.now();
            }

            // Relatórios periódicos
            if (Date.now() - lastReportTime >= 3600000) {
                await learningSystem.sendPerformanceReport();
                lastReportTime = Date.now();
            }

            if (Date.now() - lastRiskReportTime >= 6 * 60 * 60 * 1000) {
                await sendMarketRiskReport();
                lastRiskReportTime = Date.now();
            }

            const status = symbolManager.getCurrentStatus();
            console.log(`📊 Status: ${status.consecutiveNoSignals} grupos sem sinais | Análises: ${totalAnalysis}`);

            consecutiveErrors = 0;

            const delay = symbolManager.getCurrentDelay();
            console.log(`⏱️  Próximo grupo em ${delay / 1000}s...\n`);
            await new Promise(r => setTimeout(r, delay));

        } catch (error) {
            consecutiveErrors++;
            console.error(`❌ Erro (${consecutiveErrors}):`, error.message);

            if (consecutiveErrors >= 3) {
                console.log('🔄 Muitos erros. Pausa de 30s...');
                await new Promise(r => setTimeout(r, 30000));
                consecutiveErrors = 0;
            }

            await new Promise(r => setTimeout(r, Math.min(5000 * consecutiveErrors, 30000)));
        }
    }
}

// =====================================================================
// 📊 FUNÇÕES FALTANTES
// =====================================================================

async function sendMarketRiskReport() {
    try {
        if (!global.riskLayer) return;

        const marketRisk = global.riskLayer.getOverallMarketRisk();
        const now = getBrazilianDateTime();

        const message = `
🛡️ <i>⚠️IA SENSITIVE - RISCO / VOLATILIDADE⚠️</i>
${now.full}

• <i>Nível de Risco Geral:</i> ${marketRisk.riskLevel} ${marketRisk.riskLevel === 'CRITICAL' ? '🚨' : marketRisk.riskLevel === 'HIGH' ? '🔴' : marketRisk.riskLevel === 'MEDIUM' ? '🟡' : '🟢'}
• <i>Score Médio de Risco:</i> ${marketRisk.averageRiskScore.toFixed(2)}/15
• <i>Símbolos Monitorados:</i> ${marketRisk.monitoredSymbols}

<i>✨Titanium Risk Management by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);
        console.log('📊 Relatório de risco de mercado enviado');

    } catch (error) {
        console.error('Erro ao enviar relatório de risco:', error.message);
    }
}

async function sendLearningReport() {
    try {
        if (!learningSystem) return;

        const report = learningSystem.getPerformanceReport();
        const now = getBrazilianDateTime();

        const message = `
🧠 <i>RELATÓRIO DE APRENDIZADO</i>
${now.full}

• <b>Trades Totais:</b> ${report.totalTrades}
• <b>Taxa de Acerto:</b> ${report.winRate.toFixed(1)}%
• <b>Fator de Lucro:</b> ${report.profitFactor}
• <b>Lucro Médio:</b> ${report.avgProfit}%

<i>✨Titanium System by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);
        console.log('📊 Relatório de aprendizado enviado');

    } catch (error) {
        console.error('Erro ao enviar relatório de aprendizado:', error.message);
    }
}

function resetLearningData() {
    try {
        console.log('🔄 RESETANDO DADOS DE APRENDIZADO...');
        
        learningSystem = new AdvancedLearningSystem();
        
        const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
        
        const cleanData = {
            tradeHistory: [],
            symbolPerformance: {},
            patterns: { winning: {}, losing: {} },
            parameterEvolution: {
                volumeThreshold: [],
                qualityThreshold: [],
                breakoutRisk: [],
                supportResistance: [],
                pivotPoints: [],
                rsiSettings: []
            },
            lastUpdated: Date.now(),
            trailingConfig: learningSystem.trailingConfig,
            resetTimestamp: Date.now(),
            resetNote: 'Sistema resetado para otimização'
        };
        
        fs.writeFileSync(learningFile, JSON.stringify(cleanData, null, 2));
        
        console.log('✅ Dados de aprendizado resetados com sucesso!');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao resetar dados de aprendizado:', error.message);
        return false;
    }
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - SISTEMA OTIMIZADO COM PARALELISMO (ADX REMOVIDO)');
        console.log('='.repeat(80) + '\n');

        // Verificar dependências
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }

        const args = process.argv.slice(2);
        if (args.includes('--reset-learning')) {
            console.log('🔄 Opção de reset detectada...');
            resetLearningData();
        }

        console.log('🔍 Verificando conexão...');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            if (await checkInternetConnection()) {
                connected = true;
                break;
            }
            await new Promise(r => setTimeout(r, 3000));
        }

        if (!connected) {
            console.log('❌ Sem conexão com a Binance');
            process.exit(1);
        }

        // Inicializar sistemas
        global.riskLayer = new SophisticatedRiskLayer();
        console.log('🛡️  Risk Layer ativado');
        
        console.log('⚡ Engine de Cálculo Paralelo ativada');
        console.log('🎯 Sistema simplificado: ADX removido, foco no volume robusto');
        console.log('✅ Tudo pronto! Iniciando monitoramento...\n');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
    }
}

// =====================================================================
// 🚀 INICIAR BOT
// =====================================================================

if (require.main === module) {
    startBot();
}
