const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8p';
const TELEGRAM_CHAT_ID = '-1002554';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE VOLUME MÍNIMO ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.25,
    combinedScore: 0.25,
    classification: 'BAIXO',
    requireConfirmation: true
};

// === CONFIGURAÇÕES OTIMIZADAS BASEADAS NO APRENDIZADO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.4,      // Reduzido de 1.6 para 1.4
    minThreshold: 1.2,       // Reduzido de 1.5 para 1.2
    maxThreshold: 2.5,       // Reduzido de 2.9 para 2.5
    volatilityMultiplier: 0.5, // Aumentado de 0.4 para 0.5
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO ATUALIZADAS PARA 3m - MAIS SENSÍVEIS ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 15,           // Reduzido de 20 para 15
    emaAlpha: 0.35,          // Aumentado de 0.30 para 0.35
    baseZScoreLookback: 30,  // Reduzido de 40 para 30
    minZScoreLookback: 8,    // Reduzido de 12 para 8
    maxZScoreLookback: 60,   // Reduzido de 80 para 60
    zScoreThreshold: 1.2,    // Reduzido de 1.5 para 1.2
    vptThreshold: 0.20,      // Reduzido de 0.30 para 0.20
    minPriceMovement: 0.08,  // Reduzido de 0.10 para 0.08
    combinedMultiplier: 1.08, // Reduzido de 1.12 para 1.08
    volumeWeight: 0.35,      // Aumentado de 0.33 para 0.35
    emaWeight: 0.40,
    zScoreWeight: 0.18,      // Aumentado de 0.2 para 0.18
    vptWeight: 0.07,         // Reduzido de 0.1 para 0.07
    minimumThresholds: {
        combinedScore: 0.15,  // Reduzido de 0.18 para 0.15
        emaRatio: 1.05,       // Reduzido de 1.1 para 1.05
        zScore: 0.15,         // Reduzido de 0.25 para 0.15
        classification: 'BAIXO'
    }
};

const VOLATILITY_PERIOD = 15;        // Reduzido de 20 para 15
const VOLATILITY_TIMEFRAME = '10m';  // Reduzido de 15m para 10m
const VOLATILITY_THRESHOLD = 0.4;    // Reduzido de 0.5 para 0.4

// === CONFIGURAÇÕES RSI - MAIS SENSÍVEIS ===
const RSI_BUY_MAX = 68;              // Aumentado de 64 para 68
const RSI_SELL_MIN = 32;             // Reduzido de 62 para 32

// === CONFIGURAÇÕES DE SENSIBILIDADE ===
const SENSITIVITY_SETTINGS = {
    scanInterval: 5000,      // Reduzido de 8000ms para 5000ms
    minScanInterval: 2500,   // Reduzido de 4000ms para 2500ms
    maxScanInterval: 8000,   // Reduzido de 15000ms para 8000ms
    symbolGroupSize: 15,     // Reduzido de 25 para 15
    maxConsecutiveNoSignals: 2, // Reduzido de 3 para 2
};

// === CONFIGURAÇÕES DE COOLDOWN MAIS RÁPIDAS ===
const COOLDOWN_SETTINGS = {
    sameDirection: 5 * 60 * 1000,    // Reduzido de 20 para 5 minutos
    oppositeDirection: 2 * 60 * 1000, // Reduzido de 10 para 2 minutos
    useDifferentiated: true,
    adaptiveSettings: {
        highVolumeMultiplier: 0.5,   // Reduz cooldown se volume alto
        highCorrelationMultiplier: 0.3, // Reduz cooldown se alta correlação BTC
        consecutiveSignalMultiplier: 1.5 // Aumenta se muitos sinais seguidos
    }
};

// === QUALITY SCORE MAIS PERMISSIVO ===
const QUALITY_THRESHOLD = 65; // Reduzido de 70 para 65

// === PESOS AJUSTADOS PARA MAIOR SENSIBILIDADE ===
const QUALITY_WEIGHTS = {
    volume: 30,           // Reduzido de 35 para 30
    volatility: 10,       // Aumentado de 8 para 10
    rsi: 16,             // Aumentado de 14 para 16
    emaAlignment: 16,    // Aumentado de 14 para 16
    stoch1h: 10,         // Aumentado de 8 para 10
    stoch4h: 5,          // Aumentado de 4 para 5
    cci4h: 8,            // Aumentado de 6 para 8
    breakoutRisk: 10,     // Reduzido de 15 para 10
    supportResistance: 10, // Reduzido de 14 para 10
    pivotPoints: 10,      // Reduzido de 14 para 10
    btcCorrelation: 25,   // Aumentado de 18 para 25 (MAIOR FOCO)
    momentum: 5           // Novo: momentum rápido
};

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1200,     // Aumentado de 1000 para 1200
    requestsPerSecond: 40,       // Aumentado de 30 para 40
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2400,    // Aumentado de 2200 para 2400
    maxWeightPerSecond: 45,      // Aumentado de 40 para 45
    retryConfig: {
        maxRetries: 3,
        initialDelay: 1500,      // Reduzido de 2000 para 1500
        maxDelay: 10000,         // Reduzido de 15000 para 10000
        backoffFactor: 2.0       // Reduzido de 2.5 para 2.0
    },
    circuitBreaker: {
        failureThreshold: 10,    // Aumentado de 8 para 10
        resetTimeout: 60000,     // Reduzido de 90000 para 60000
        halfOpenMaxRequests: 5   // Aumentado de 3 para 5
    }
};

// === CONFIGURAÇÕES PARA RETRAÇÕES DINÂMICAS COM ATR ===
const RETRACEMENT_SETTINGS = {
    minPercentage: 0.20,         // Reduzido de 0.25 para 0.20
    maxPercentage: 0.45,         // Reduzido de 0.50 para 0.45
    useDynamicATR: true,
    atrMultiplierMin: 0.4,       // Reduzido de 0.5 para 0.4
    atrMultiplierMax: 0.8,       // Reduzido de 1.0 para 0.8
    volatilityAdjustment: {
        low: 0.8,                // Reduzido de 1.0 para 0.8
        medium: 1.0,
        high: 1.2                // Reduzido de 1.5 para 1.2
    }
};

// === CONFIGURAÇÕES DE STOP DINÂMICO ===
const DYNAMIC_STOP_SETTINGS = {
    baseATRMultiplier: 3.0,      // Reduzido de 3.5 para 3.0
    minStopPercentage: 1.5,      // Reduzido de 2.0 para 1.5
    maxStopPercentage: 6.0,      // Reduzido de 8.0 para 6.0
    volatilityBased: true,
    volatilityMultipliers: {
        low: 0.6,                // Reduzido de 0.8 para 0.6
        medium: 0.8,             // Reduzido de 1.0 para 0.8
        high: 1.1                // Reduzido de 1.3 para 1.1
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE SUPORTE/RESISTÊNCIA ===
const SUPPORT_RESISTANCE_SETTINGS = {
    lookbackPeriod: 40,          // Reduzido de 50 para 40
    timeframe: '10m',            // Reduzido de 15m para 10m
    minTouchPoints: 2,
    proximityThreshold: 1.0,     // Reduzido de 1.5 para 1.0
    breakoutThreshold: 0.6,      // Reduzido de 0.8 para 0.6
    strongLevelThreshold: 2,     // Reduzido de 3 para 2
    recentPeriod: 15             // Reduzido de 20 para 15
};

// === CONFIGURAÇÕES PARA RISCO DE ROMPIMENTO ===
const BREAKOUT_RISK_SETTINGS = {
    highRiskDistance: 0.3,       // Reduzido de 0.5 para 0.3
    mediumRiskDistance: 0.7,     // Reduzido de 1.0 para 0.7
    lowRiskDistance: 1.5,        // Reduzido de 2.0 para 1.5
    safeDistance: 2.5            // Reduzido de 3.0 para 2.5
};

// === CONFIGURAÇÕES PARA PIVOT POINTS MULTI-TIMEFRAME ===
const PIVOT_POINTS_SETTINGS = {
    timeframeStrengthWeights: {
        '5m': 0.8,               // Novo: timeframe mais rápido
        '15m': 1.0,
        '1h': 2.0,
        '4h': 3.0,
        '1D': 5.0
    },
    safeDistanceMultipliers: {
        'weak': 0.4,             // Reduzido de 0.5 para 0.4
        'moderate': 0.8,         // Reduzido de 1.0 para 0.8
        'strong': 1.2,           // Reduzido de 1.5 para 1.2
        'very_strong': 1.6       // Reduzido de 2.0 para 1.6
    },
    minDistance: 4,              // Reduzido de 5 para 4
    priceTolerance: 0.003,       // Reduzido de 0.005 para 0.003
    analyzeTimeframes: ['5m', '15m', '1h'], // Adicionado 5m, removido 4h
    candlesPerTimeframe: {
        '5m': 50,                // Novo: 5 minutos
        '15m': 60,               // Reduzido de 70 para 60
        '1h': 80,                // Reduzido de 100 para 80
        '4h': 100                // Reduzido de 120 para 100
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE PERFORMANCE VS BTC - MAIS SENSÍVEIS ===
const BTC_CORRELATION_SETTINGS = {
    timeframe: '5m',             // Reduzido de 15m para 5m
    lookbackPeriods: {
        short: 4,                // Reduzido de 8 para 4 (20 min)
        medium: 12,              // Reduzido de 24 para 12 (1h)
        long: 24                 // Reduzido de 48 para 24 (2h)
    },
    thresholds: {
        highOutperformance: 1.0,    // Reduzido de 1.5 para 1.0%
        mediumOutperformance: 0.5,  // Reduzido de 0.8 para 0.5%
        underperformance: -0.3,     // Aumentado de -0.5 para -0.3%
        strongUnderperformance: -0.8 // Aumentado de -1.0 para -0.8%
    }
};

// === CONFIGURAÇÕES DE PRIORIDADE ===
const PRIORITY_SETTINGS = {
    highPriority: {
        btcOutperformance: 1.5,      // > 1.5% vs BTC
        volumeSpike: 3.0,           // > 3x volume
        momentum1m: 1.0,            // > 1% em 1 minuto
        rsiSignal: true,            // RSI dentro da zona
    },
    mediumPriority: {
        btcOutperformance: 0.8,
        volumeSpike: 2.0,
        rsiReversal: true,          // Saindo de extremos
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS MAIS RÁPIDOS ===
const candleCache = {};
const momentumCache = {};
const CANDLE_CACHE_TTL = 30000;      // Reduzido de 60000 para 30000ms
const MOMENTUM_CACHE_TTL = 10000;    // Cache de momentum rápido
const MAX_CACHE_AGE = 5 * 60 * 1000; // Reduzido de 10 para 5 minutos

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

const CCI_4H_SETTINGS = {
    period: 20,
    maPeriod: 14,
    timeframe: '4h'
};

const TARGET_PERCENTAGES = [1.0, 2.0, 3.5, 5.0, 8.0]; // Reduzido o primeiro alvo
const ATR_PERIOD = 12;              // Reduzido de 14 para 12
const ATR_TIMEFRAME = '10m';        // Reduzido de 15m para 10m

// =====================================================================
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO - REMOVIDO RSI EXTREME
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
            PIVOT_RISK: { weight: 1.2 },
            BTC_CORRELATION_RISK: { weight: 1.8 } // Aumentado foco em BTC
        };

        this.riskHistory = new Map();
        this.maxHistorySize = 100;

        console.log('🛡️  Risk Layer Sofisticado inicializado (RSI EXTREME REMOVIDO)');
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

            // REMOVIDO: Análise de RSI Extreme

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

            const btcCorrelationRisk = await this.analyzeBTCCorrelationRisk(signal);
            riskAssessment.factors.push(btcCorrelationRisk);
            riskAssessment.overallScore += btcCorrelationRisk.score * this.riskFactors.BTC_CORRELATION_RISK.weight;

            const momentumRisk = await this.analyzeMomentumRisk(signal);
            riskAssessment.factors.push(momentumRisk);
            riskAssessment.overallScore += momentumRisk.score * 1.0;

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

    async analyzeMomentumRisk(signal) {
        try {
            const momentumData = signal.marketData.momentum;
            if (!momentumData) {
                return { type: 'MOMENTUM', score: 0, message: 'Sem dados de momentum' };
            }

            let score = 0;
            let message = '';

            if (momentumData.isSpiking) {
                if (momentumData.priceChange > 1.5) {
                    score = -1; // Momentum forte é positivo
                    message = `🚀 MOMENTUM FORTE: ${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                } else if (momentumData.priceChange > 0.8) {
                    score = -0.5;
                    message = `📈 Momentum positivo: ${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                } else if (momentumData.priceChange < -1.5) {
                    score = 1;
                    message = `📉 Momentum negativo: ${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                }
            } else {
                message = `➡️ Momentum neutro`;
            }

            return {
                type: 'MOMENTUM',
                score: Math.min(3, Math.max(-2, score)),
                message: message,
                data: momentumData
            };
        } catch (error) {
            return { type: 'MOMENTUM', score: 0, message: 'Erro análise' };
        }
    }

    async analyzeBTCCorrelationRisk(signal) {
        try {
            const symbol = signal.symbol;
            if (!symbol.endsWith('BTC')) {
                return { type: 'BTC_CORRELATION', score: 0, message: 'Não é par BTC' };
            }

            const altcoinCandles = await getCandlesCached(symbol, BTC_CORRELATION_SETTINGS.timeframe, 48);
            const btcCandles = await getCandlesCached('BTCUSDT', BTC_CORRELATION_SETTINGS.timeframe, 48);

            if (altcoinCandles.length < 24 || btcCandles.length < 24) {
                return { type: 'BTC_CORRELATION', score: 1, message: 'Dados insuficientes' };
            }

            const altcoinPriceChange = ((altcoinCandles[altcoinCandles.length - 1].close - altcoinCandles[altcoinCandles.length - 24].close) / 
                                       altcoinCandles[altcoinCandles.length - 24].close) * 100;
            
            const btcPriceChange = ((btcCandles[btcCandles.length - 1].close - btcCandles[btcCandles.length - 24].close) / 
                                   btcCandles[btcCandles.length - 24].close) * 100;

            const relativePerformance = altcoinPriceChange - btcPriceChange;

            let score = 0;
            let message = '';

            if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
                score = -2; // Performance muito boa vs BTC
                message = `📈📈 Performando ${relativePerformance.toFixed(2)}% MELHOR que BTC (ALTA RELATIVA FORTE)`;
            } else if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
                score = -1;
                message = `📈 Performando ${relativePerformance.toFixed(2)}% melhor que BTC`;
            } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
                score = 2;
                message = `📉📉 Performando ${Math.abs(relativePerformance).toFixed(2)}% PIOR que BTC (FRAQUEZA RELATIVA FORTE)`;
            } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
                score = 1;
                message = `⚠️ Performando ${Math.abs(relativePerformance).toFixed(2)}% pior que BTC`;
            } else {
                score = 0;
                message = `➡️ Performando similar ao BTC (${relativePerformance.toFixed(2)}%)`;
            }

            const isAltcoinBullish = altcoinPriceChange > 0;
            const isBTCBullish = btcPriceChange > 0;
            
            if (isAltcoinBullish !== isBTCBullish) {
                score += 1;
                message += ` | 🚨 DIRECÇÃO OPOSTA AO BTC!`;
            }

            return {
                type: 'BTC_CORRELATION',
                score: Math.min(3, score),
                message: message,
                data: {
                    relativePerformance: relativePerformance,
                    altcoinChange: altcoinPriceChange,
                    btcChange: btcPriceChange,
                    isOutperforming: relativePerformance > 0,
                    performanceLevel: this.getPerformanceLevel(relativePerformance)
                }
            };

        } catch (error) {
            return { type: 'BTC_CORRELATION', score: 1, message: 'Erro análise' };
        }
    }

    getPerformanceLevel(relativePerformance) {
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) return 'HIGH_OUTPERFORMANCE';
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) return 'MEDIUM_OUTPERFORMANCE';
        if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) return 'STRONG_UNDERPERFORMANCE';
        if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) return 'UNDERPERFORMANCE';
        return 'NEUTRAL';
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
            const candles = await getCandlesCached(signal.symbol, '10m', 40);
            if (candles.length < 20) {
                return { type: 'VOLATILITY', score: 1, message: 'Dados insuficientes' };
            }

            const closes = candles.map(c => c.close);
            const atr = await getATRData(signal.symbol, '10m', 14);

            if (!atr) {
                return { type: 'VOLATILITY', score: 1, message: 'ATR não disponível' };
            }

            let sumReturns = 0;
            for (let i = 1; i < closes.length; i++) {
                const returnVal = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
                sumReturns += returnVal;
            }
            const historicalVol = (sumReturns / (closes.length - 1)) * 100;

            const recentCloses = closes.slice(-6);
            let recentVol = 0;
            for (let i = 1; i < recentCloses.length; i++) {
                const returnVal = Math.abs((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
                recentVol += returnVal;
            }
            recentVol = (recentVol / 5) * 100;

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
            const tickerData = await rateLimiter.makeRequest(
                `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
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

            return {
                type: 'LIQUIDITY',
                score: score,
                message: message,
                data: { quoteVolume: quoteVolume }
            };

        } catch (error) {
            return { type: 'LIQUIDITY', score: 1, message: 'Dados não disponíveis' };
        }
    }

    async analyzeCorrelationRisk(signal) {
        try {
            const symbol = signal.symbol;
            
            if (symbol.endsWith('BTC')) {
                return { type: 'CORRELATION', score: 0, message: 'Par BTC - análise específica' };
            }

            const symbolCandles = await getCandlesCached(symbol, '5m', 12);
            const btcCandles = await getCandlesCached('BTCUSDT', '5m', 12);

            if (symbolCandles.length < 6 || btcCandles.length < 6) {
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
            const btcCandles = await getCandlesCached('BTCUSDT', '1h', 24);

            if (btcCandles.length < 20) {
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

            return {
                type: 'MARKET',
                score: score,
                message: message,
                data: {
                    btcDrawdown: drawdown,
                    btcVolatility: volatility,
                    btcPrice: currentPrice
                }
            };

        } catch (error) {
            return { type: 'MARKET', score: 1, message: 'Erro análise' };
        }
    }

    async analyzeTrendRisk(signal) {
        try {
            const timeframes = ['10m', '1h', '4h'];
            let conflictingTrends = 0;
            let totalTrends = 0;
            let trendMessages = [];

            for (const tf of timeframes) {
                const candles = await getCandlesCached(signal.symbol, tf, 40);
                if (candles.length < 20) continue;

                const closes = candles.map(c => c.close);
                const sma20 = this.calculateSMA(closes, 20);
                const sma50 = this.calculateSMA(closes, 50);

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

        assessment.factors.forEach(factor => {
            if (factor.type === 'BTC_CORRELATION' && factor.score >= 1) {
                if (factor.data.performanceLevel === 'STRONG_UNDERPERFORMANCE') {
                    recommendations.push('⚠️ ATENÇÃO: Altcoin performando MUITO PIOR que BTC');
                    recommendations.push('• Considere reduzir posição');
                    recommendations.push('• Aguarde recuperação relativa vs BTC');
                } else if (factor.data.performanceLevel === 'UNDERPERFORMANCE') {
                    recommendations.push('⚠️ Altcoin performando pior que BTC');
                    recommendations.push('• Monitorar performance relativa');
                }
            }
            if (factor.type === 'BTC_CORRELATION' && factor.score <= -1) {
                recommendations.push('✅ Altcoin performando MELHOR que BTC');
                recommendations.push('• Oportunidade de alta relativa');
            }
        });

        switch (assessment.level) {
            case 'CRITICAL':
                recommendations.push('⚠️ CONSIDERE EVITAR ESTE TRADE');
                recommendations.push('• Reduza tamanho da posição em 75%');
                recommendations.push('• Use stop loss mais apertado');
                recommendations.push('• Espere confirmação adicional');
                break;

            case 'HIGH':
                recommendations.push('🔶 ALTO RISCO - EXTREMA CAUTELA');
                recommendations.push('• Reduza tamanho da posição em 50%');
                recommendations.push('• Use stop loss conservador');
                recommendations.push('• Procure entrada melhor');
                break;

            case 'MEDIUM':
                recommendations.push('🟡 RISCO MODERADO - CAUTELA');
                recommendations.push('• Reduza tamanho da posição em 25%');
                recommendations.push('• Aguarde confirmação parcial');
                recommendations.push('• Considere alvos mais curtos');
                break;

            case 'LOW':
                recommendations.push('🟢 RISCO BAIXO - CONFIANÇA');
                recommendations.push('• Tamanho normal de posição OK');
                recommendations.push('• Stop loss padrão adequado');
                recommendations.push('• Pode buscar alvos mais longos');
                break;
        }

        return recommendations;
    }

    generateWarnings(assessment) {
        const warnings = [];

        assessment.factors.forEach(factor => {
            if (factor.type === 'BTC_CORRELATION' && factor.score >= 2) {
                warnings.push(`📉 ${factor.message}`);
            }
        });

        assessment.factors.forEach(factor => {
            if (factor.score >= 2.5 && factor.type !== 'BTC_CORRELATION') {
                warnings.push(`⚠️ ${factor.message}`);
            } else if (factor.score >= 2 && factor.type !== 'BTC_CORRELATION') {
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
        const riskLevelInfo = this.riskLevels[assessment.level] || { emoji: '⚫' };
        
        console.log(`\n🛡️  RISK ASSESSMENT: ${symbol}`);
        console.log(`   Nível: ${assessment.level} ${riskLevelInfo.emoji}`);
        console.log(`   Score: ${assessment.overallScore.toFixed(2)}`);
        console.log(`   Confiança: ${assessment.confidence}%`);

        assessment.factors.forEach(factor => {
            if (factor.type === 'BTC_CORRELATION') {
                console.log(`   BTC Correlation: ${factor.message}`);
            }
        });

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
// 🧠 SISTEMA DE APRENDIZADO COMPLETO COM TRAILING SIMULATION - REMOVIDO RSI EXTREME
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
            rsiSettings: [],
            btcCorrelation: []
        };

        this.learningEnabled = true;
        this.minTradesForLearning = 10;
        this.tradeTrackingHours = 24;

        this.trailingConfig = {
            timeframe: '5m',
            candlesToSimulate: 288,
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
                    emaAlignment: marketData.ema?.isAboveEMA55 || false,
                    stoch1hValid: marketData.stoch?.isValid || false,
                    stoch4hValid: marketData.stoch4h?.isValid || false,
                    cci4hValid: marketData.cci4h?.isValid || false,
                    cci4hValue: marketData.cci4h?.value || 0,
                    cci4hMA: marketData.cci4h?.maValue || 0,
                    breakoutRisk: marketData.breakoutRisk || {},
                    supportResistance: marketData.supportResistance || {},
                    pivotPoints: marketData.pivotPoints || {},
                    btcCorrelation: marketData.btcCorrelation || {},
                    momentum: marketData.momentum || {}
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

            const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(closedTrades);
            console.log(`📊 Análise BTC Correlation: ${btcCorrelationAnalysis.highOutperformWinners.length} vencedores com alta performance vs BTC`);

            const momentumAnalysis = this.analyzeMomentumPatterns(closedTrades);
            console.log(`📊 Análise Momentum: ${momentumAnalysis.strongMomentumWinners.length} vencedores com momentum forte`);

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

    analyzeMomentumPatterns(trades) {
        const strongMomentumWinners = [];
        const weakMomentumLosers = [];
        const neutralWinners = [];
        const neutralLosers = [];

        trades.forEach(trade => {
            const momentum = trade.marketData.momentum;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

            if (momentum?.isSpiking && Math.abs(momentum.priceChange) > 1.0) {
                if (isWinner) strongMomentumWinners.push(trade);
                else weakMomentumLosers.push(trade);
            } else {
                if (isWinner) neutralWinners.push(trade);
                else neutralLosers.push(trade);
            }
        });

        return {
            strongMomentumWinners,
            weakMomentumLosers,
            neutralWinners,
            neutralLosers,
            strongMomentumWinRate: strongMomentumWinners.length / (strongMomentumWinners.length + weakMomentumLosers.length) || 0
        };
    }

    analyzeBTCCorrelationPatterns(trades) {
        const highOutperformWinners = [];
        const underperformLosers = [];
        const neutralWinners = [];
        const neutralLosers = [];

        trades.forEach(trade => {
            const btcCorrelation = trade.marketData.btcCorrelation;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

            if (btcCorrelation?.relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
                if (isWinner) highOutperformWinners.push(trade);
            } else if (btcCorrelation?.relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
                if (!isWinner) underperformLosers.push(trade);
            } else {
                if (isWinner) neutralWinners.push(trade);
                else neutralLosers.push(trade);
            }
        });

        return {
            highOutperformWinners,
            underperformLosers,
            neutralWinners,
            neutralLosers,
            highOutperformWinRate: highOutperformWinners.length / (highOutperformWinners.length + underperformLosers.length) || 0
        };
    }

    extractPatterns(trade) {
        const patterns = [];
        const data = trade.marketData;

        if (data.volumeRobust?.combinedScore >= 0.7) {
            patterns.push('ROBUST_VOLUME');
        }
        if (data.volumeRatio >= 1.8 && data.rsi <= RSI_BUY_MAX) {
            patterns.push('HIGH_VOL_GOOD_RSI');
        }
        if (data.volumeRatio >= 1.5 && data.volumeRatio < 1.8 && data.rsi <= RSI_BUY_MAX) {
            patterns.push('MOD_VOL_GOOD_RSI');
        }
        
        if ((trade.direction === 'BUY' && data.rsi >= 25 && data.rsi <= RSI_BUY_MAX) ||
            (trade.direction === 'SELL' && data.rsi >= RSI_SELL_MIN && data.rsi <= 75)) {
            patterns.push('RSI_IDEAL');
        }
        
        if (data.volatility >= 0.8 && data.volatility <= 1.5) {
            patterns.push('OPTIMAL_VOLATILITY');
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

        if (data.btcCorrelation?.relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            patterns.push('HIGH_OUTPERFORM_BTC');
        } else if (data.btcCorrelation?.relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            patterns.push('UNDERPERFORM_BTC');
        }

        if (data.momentum?.isSpiking && Math.abs(data.momentum.priceChange) > 1.0) {
            patterns.push('STRONG_MOMENTUM');
        }

        return patterns;
    }

    async optimizeParameters(closedTrades) {
        try {
            const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(closedTrades);
            if (btcCorrelationAnalysis.highOutperformWinRate > 0.6) {
                this.parameterEvolution.btcCorrelation.push({
                    timestamp: Date.now(),
                    message: 'Altcoins com alta performance vs BTC têm melhor win rate',
                    winRate: btcCorrelationAnalysis.highOutperformWinRate,
                    highOutperformCount: btcCorrelationAnalysis.highOutperformWinners.length
                });
                console.log('✅ BTC Correlation: Altcoins performando bem vs BTC têm win rate de ' + (btcCorrelationAnalysis.highOutperformWinRate * 100).toFixed(1) + '%');
            }

            const momentumAnalysis = this.analyzeMomentumPatterns(closedTrades);
            if (momentumAnalysis.strongMomentumWinRate > 0.6) {
                this.parameterEvolution.momentum = this.parameterEvolution.momentum || [];
                this.parameterEvolution.momentum.push({
                    timestamp: Date.now(),
                    message: 'Trades com momentum forte têm melhor win rate',
                    winRate: momentumAnalysis.strongMomentumWinRate,
                    strongMomentumCount: momentumAnalysis.strongMomentumWinners.length
                });
                console.log('✅ Momentum: Trades com momentum forte têm win rate de ' + (momentumAnalysis.strongMomentumWinRate * 100).toFixed(1) + '%');
            }

            const volumeAnalysis = this.analyzeParameter(
                closedTrades,
                t => t.marketData.volumeRatio,
                [1.2, 1.4, 1.6, 1.8, 2.0],
                VOLUME_SETTINGS.baseThreshold
            );

            if (volumeAnalysis.bestValue && volumeAnalysis.winRate > 0.4) {
                const adjustment = (volumeAnalysis.bestValue - VOLUME_SETTINGS.baseThreshold) * 0.1;
                VOLUME_SETTINGS.baseThreshold += adjustment;
                VOLUME_SETTINGS.baseThreshold = Math.max(1.2, Math.min(2.2, VOLUME_SETTINGS.baseThreshold));

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
                
                if (this.patterns.losing.HIGH_OUTPERFORM_BTC > 10) {
                    console.log('⚠️  Padrão aprendido: UNDERPERFORM_BTC é PERDEDOR (' + this.patterns.losing.UNDERPERFORM_BTC + ' trades)');
                }
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

        const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(validClosedTrades);
        const momentumAnalysis = this.analyzeMomentumPatterns(validClosedTrades);

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
            monitoredSymbols: Object.keys(this.symbolPerformance).length,
            btcCorrelationAnalysis: {
                highOutperformWinRate: (btcCorrelationAnalysis.highOutperformWinRate * 100).toFixed(1),
                highOutperformTrades: btcCorrelationAnalysis.highOutperformWinners.length
            },
            momentumAnalysis: {
                strongMomentumWinRate: (momentumAnalysis.strongMomentumWinRate * 100).toFixed(1),
                strongMomentumTrades: momentumAnalysis.strongMomentumWinners.length
            }
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
            }, 20000);
        });
    }

    async processQueue() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(500);
                    continue;
                }

                const request = this.queue.shift();
                if (!request) {
                    await this.delay(50);
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
                        await this.delay(5000);
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
            await this.delay(this.adaptiveDelay * 2);
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
                const timeoutId = setTimeout(() => controller.abort(), 15000);

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
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const cleanMessage = message
            .replace(/<b>/g, '')
            .replace(/<\/b>/g, '')
            .replace(/<i>/g, '')
            .replace(/<\/i>/g, '')
            .trim();

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: cleanMessage,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
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
    const rsiValue = signal.marketData.rsi?.value || 50;
    const volumeScore = signal.marketData.volume?.robustData?.combinedScore || 0;
    const volumeClassification = signal.marketData.volume?.robustData?.classification || '';
    const btcCorrelation = signal.marketData.btcCorrelation?.relativePerformance || 0;
    const momentum = signal.marketData.momentum;
    
    if (momentum?.isSpiking && Math.abs(momentum.priceChange) > 1.0) {
        return {
            type: 'MOMENTUM_RÁPIDO',
            reason: 'Movimento forte detectado em timeframe curto',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '⚡'
        };
    }
    
    if (btcCorrelation >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
        return {
            type: 'ALTA PERFORMANCE vs BTC',
            reason: 'Alta performance relativa vs BTC',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '📈'
        };
    }
    
    if (volumeScore >= 0.7 && volumeClassification.includes('FORTE')) {
        return {
            type: 'REVERSAO',
            reason: 'Volume forte indicando possível reversão',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🔄'
        };
    }
    
    if ((signal.isBullish && rsiValue > 65) || (!signal.isBullish && rsiValue < 35)) {
        return {
            type: 'EXAUSTAO_CORRECAO',
            reason: 'RSI indicando possível exaustão do movimento',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '⚠️'
        };
    }
    
    return {
        type: 'NEUTRA',
        reason: 'Análise técnica padrão',
        direction: signal.isBullish ? 'COMPRA' : 'VENDA',
        emoji: '📊'
    };
}

// =====================================================================
// 📤 FUNÇÃO PRINCIPAL PARA ENVIAR ALERTAS COM FORMATO SIMPLES
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const analysisType = determineAnalysisType(signal);
        
        const direction = signal.isBullish ? 'Relação vs BTC COMPRA' : 'Relação vs BTC VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        
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

        const btcCorrelationData = signal.marketData.btcCorrelation;
        const relativePerformance = btcCorrelationData?.relativePerformance || 0;
        let btcPerformanceEmoji = '➡️';
        let btcPerformanceText = '';
        
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            btcPerformanceEmoji = '📈📈';
            btcPerformanceText = `Performando ${relativePerformance.toFixed(2)}% MELHOR que BTC`;
        } else if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            btcPerformanceEmoji = '📈';
            btcPerformanceText = `Performando ${relativePerformance.toFixed(2)}% melhor que BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            btcPerformanceEmoji = '📉📉';
            btcPerformanceText = `Performando ${Math.abs(relativePerformance).toFixed(2)}% PIOR que BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            btcPerformanceEmoji = '📉';
            btcPerformanceText = `Performando ${Math.abs(relativePerformance).toFixed(2)}% pior que BTC`;
        } else {
            btcPerformanceText = `Performando similar ao BTC (${relativePerformance.toFixed(2)}%)`;
        }

        const momentumData = signal.marketData.momentum;
        let momentumText = '';
        if (momentumData?.isSpiking) {
            momentumText = ` | ⚡ ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
        }

        const priority = determineAlertPriority(signal);
        let priorityEmoji = '';
        if (priority === 'HIGH') {
            priorityEmoji = '🚨 ';
        } else if (priority === 'MEDIUM') {
            priorityEmoji = '⚠️ ';
        }

        let alertTitle = '';
        let alertType = '';
        
        if (isVolumeConfirmed) {
            alertTitle = `${priorityEmoji}${directionEmoji} ${signal.symbol} - ${direction}`;
            alertType = 'trade';
        } else {
            alertTitle = `${analysisType.emoji} ${signal.symbol} - ANÁLISE`;
            alertType = 'analysis';
        }

        const now = getBrazilianDateTime();
        //const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

        let message = `
${alertTitle}
${now.date} ${now.time} 
 ${analysisType.reason}
⚠️ Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability.toFixed(1)}%
• Preço: ${signal.price.toFixed(8)} BTC
${btcPerformanceEmoji} ${btcPerformanceText}${momentumText}
⚠️ Vol: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification}) - Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
• Dist. Suport/Resist.: ${distancePercent}%
• Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
• RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}

✨Titanium Pares BTC by @J4Rviz✨
        `;

        await sendTelegramAlert(message);

        console.log(`\n📤 ${alertType === 'trade' ? 'Alerta de TRADE' : 'Análise'} enviado: ${signal.symbol}`);
        console.log(`   Tipo: ${analysisType.type} - ${analysisType.reason}`);
        console.log(`   Prioridade: ${priority}`);
        console.log(`   Data/Hora: ${now.date} ${now.time}`);
        console.log(`   Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})`);
        console.log(`   Probabilidade: ${riskAdjustedProbability.toFixed(1)}%`);
        console.log(`   Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);

        return {
            type: alertType,
            analysisType: analysisType.type,
            volumeConfirmed: isVolumeConfirmed,
            volumeScore: volumeScore,
            priority: priority
        };

    } catch (error) {
        console.error('Erro ao enviar alerta com risk layer:', error.message);
        return await sendSignalAlert(signal);
    }
}

function determineAlertPriority(signal) {
    const btcPerf = signal.marketData.btcCorrelation?.relativePerformance || 0;
    const volumeRatio = signal.marketData.volume?.rawRatio || 0;
    const momentum = signal.marketData.momentum;
    
    if (btcPerf >= PRIORITY_SETTINGS.highPriority.btcOutperformance && 
        volumeRatio >= PRIORITY_SETTINGS.highPriority.volumeSpike) {
        return 'HIGH';
    }
    
    if (momentum?.isSpiking && Math.abs(momentum.priceChange) >= PRIORITY_SETTINGS.highPriority.momentum1m) {
        return 'HIGH';
    }
    
    if (Math.abs(btcPerf) >= PRIORITY_SETTINGS.mediumPriority.btcOutperformance) {
        return 'MEDIUM';
    }
    
    return 'NORMAL';
}

// =====================================================================
// 📤 FUNÇÃO ALTERNATIVA (FALLBACK)
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
            alertTitle = `${analysisType.emoji} ${signal.symbol} - ANÁLISE`;
        }

        const now = getBrazilianDateTime();
        //const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

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
        let btcPerformanceEmoji = '➡️';
        let btcPerformanceText = '';
        
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            btcPerformanceEmoji = '📈📈';
            btcPerformanceText = `Performando ${relativePerformance.toFixed(2)}% MELHOR que BTC`;
        } else if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            btcPerformanceEmoji = '📈';
            btcPerformanceText = `Performando ${relativePerformance.toFixed(2)}% melhor que BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            btcPerformanceEmoji = '📉📉';
            btcPerformanceText = `Performando ${Math.abs(relativePerformance).toFixed(2)}% PIOR que BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            btcPerformanceEmoji = '📉';
            btcPerformanceText = `Performando ${Math.abs(relativePerformance).toFixed(2)}% pior que BTC`;
        } else {
            btcPerformanceText = `Performando similar ao BTC (${relativePerformance.toFixed(2)}%)`;
        }

        const momentumData = signal.marketData.momentum;
        let momentumText = '';
        if (momentumData?.isSpiking) {
            momentumText = ` | ⚡ ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
        }

        let message = `
${alertTitle}
${now.date} ${now.time} 
 ${analysisType.reason}
⚠️ Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${baseProbability.toFixed(1)}%
• Preço: ${signal.price.toFixed(8)} BTC
${btcPerformanceEmoji} ${btcPerformanceText}${momentumText}
⚠️ Vol: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification}) - Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
• Dist. Suport/Resist.: ${distancePercent}%
• Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
• RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}

✨Titanium Pares BTC by @J4Rviz✨
        `;

        await sendTelegramAlert(message);

        console.log(`📤 ${isVolumeConfirmed ? 'Alerta de TRADE' : 'Análise'} enviado: ${signal.symbol}`);
        console.log(`   Tipo: ${analysisType.type}`);
        console.log(`   Motivo: ${analysisType.reason}`);
        console.log(`   Prioridade: ${priority}`);
        console.log(`   Data/Hora: ${now.date} ${now.time}`);
        console.log(`   Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);

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
    let baseProbability = 65;

    baseProbability += (signal.qualityScore.score - 65) * 0.4;

    const volumeData = signal.marketData.volume?.robustData;
    const volumeScore = volumeData?.combinedScore || 0;
    
    if (volumeScore >= 0.7) baseProbability += 10;
    else if (volumeScore >= 0.5) baseProbability += 5;
    else if (volumeScore < 0.3) baseProbability -= 8;

    const srData = signal.marketData.supportResistance;
    const nearestLevel = signal.isBullish ?
        srData?.nearestResistance : srData?.nearestSupport;
    const distance = nearestLevel?.distancePercent || 0;

    if (distance >= 3.0) baseProbability += 6;
    else if (distance >= 2.0) baseProbability += 3;
    else if (distance < 0.8) baseProbability -= 15;

    if (signal.marketData.breakoutRisk?.level === 'high') baseProbability -= 12;
    if (signal.marketData.breakoutRisk?.level === 'low') baseProbability += 5;

    const rsiValue = signal.marketData.rsi?.value || 50;
    if ((signal.isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) ||
        (!signal.isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
        baseProbability += 8;
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

    const btcCorrelationData = signal.marketData.btcCorrelation;
    if (btcCorrelationData) {
        const relativePerformance = btcCorrelationData.relativePerformance || 0;
        
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            baseProbability += 12;
        } else if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            baseProbability += 6;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            baseProbability -= 15;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            baseProbability -= 8;
        }
    }

    const momentumData = signal.marketData.momentum;
    if (momentumData?.isSpiking) {
        if (Math.abs(momentumData.priceChange) > 1.0) {
            baseProbability += 8;
        } else if (Math.abs(momentumData.priceChange) > 0.5) {
            baseProbability += 4;
        }
    }

    return Math.min(92, Math.max(35, Math.round(baseProbability)));
}

// =====================================================================
// 📊 FUNÇÃO PARA ANALISAR PERFORMANCE VS BTC
// =====================================================================

async function analyzeBTCCorrelation(symbol, currentPrice, isBullish) {
    try {
        if (!symbol.endsWith('BTC')) {
            return { 
                relativePerformance: 0,
                altcoinChange: 0,
                btcChange: 0,
                isOutperforming: false,
                performanceLevel: 'NOT_BTC_PAIR'
            };
        }

        const altcoinCandles = await getCandlesCached(symbol, BTC_CORRELATION_SETTINGS.timeframe, 48);
        const btcCandles = await getCandlesCached('BTCUSDT', BTC_CORRELATION_SETTINGS.timeframe, 48);

        if (altcoinCandles.length < 12 || btcCandles.length < 12) {
            return { 
                relativePerformance: 0,
                altcoinChange: 0,
                btcChange: 0,
                isOutperforming: false,
                performanceLevel: 'INSUFFICIENT_DATA'
            };
        }

        const periods = BTC_CORRELATION_SETTINGS.lookbackPeriods;
        const results = {};

        for (const [periodName, periodLength] of Object.entries(periods)) {
            if (altcoinCandles.length >= periodLength && btcCandles.length >= periodLength) {
                const altcoinPriceChange = ((altcoinCandles[altcoinCandles.length - 1].close - altcoinCandles[altcoinCandles.length - periodLength].close) / 
                                          altcoinCandles[altcoinCandles.length - periodLength].close) * 100;
                
                const btcPriceChange = ((btcCandles[btcCandles.length - 1].close - btcCandles[btcCandles.length - periodLength].close) / 
                                       btcCandles[btcCandles.length - periodLength].close) * 100;

                const relativePerformance = altcoinPriceChange - btcPriceChange;

                results[periodName] = {
                    altcoinChange: altcoinPriceChange,
                    btcChange: btcPriceChange,
                    relativePerformance: relativePerformance,
                    isOutperforming: relativePerformance > 0,
                    periodLength: periodLength,
                    timeframe: `${periodLength * 5} minutos`
                };
            }
        }

        const mainResult = results['medium'] || results['short'] || results['long'];
        
        if (!mainResult) {
            return { 
                relativePerformance: 0,
                altcoinChange: 0,
                btcChange: 0,
                isOutperforming: false,
                performanceLevel: 'NO_VALID_DATA'
            };
        }

        let performanceLevel = 'NEUTRAL';
        if (mainResult.relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            performanceLevel = 'HIGH_OUTPERFORMANCE';
        } else if (mainResult.relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            performanceLevel = 'MEDIUM_OUTPERFORMANCE';
        } else if (mainResult.relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            performanceLevel = 'STRONG_UNDERPERFORMANCE';
        } else if (mainResult.relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            performanceLevel = 'UNDERPERFORMANCE';
        }

        console.log(`📊 BTC Correlation ${symbol}:`);
        console.log(`   Altcoin: ${mainResult.altcoinChange.toFixed(2)}% | BTC: ${mainResult.btcChange.toFixed(2)}%`);
        console.log(`   Relative: ${mainResult.relativePerformance.toFixed(2)}% (${performanceLevel})`);
        console.log(`   Outperforming: ${mainResult.isOutperforming ? '✅' : '❌'}`);

        return {
            ...mainResult,
            performanceLevel: performanceLevel,
            allPeriods: results,
            currentPrice: currentPrice,
            symbol: symbol,
            isBullish: isBullish,
            analysis: getBTCCorrelationAnalysis(mainResult.relativePerformance, performanceLevel)
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

function getBTCCorrelationAnalysis(relativePerformance, performanceLevel) {
    const analysis = [];
    
    switch (performanceLevel) {
        case 'HIGH_OUTPERFORMANCE':
            analysis.push(`🚀 ALTA PERFORMANCE RELATIVA vs BTC`);
            analysis.push(`✅ Altcoin liderando o mercado`);
            analysis.push(`📈 Tendência de alta mais forte que BTC`);
            break;
        case 'MEDIUM_OUTPERFORMANCE':
            analysis.push(`📈 Performando melhor que BTC`);
            analysis.push(`✅ Momento positivo relativo`);
            analysis.push(`🔍 Monitorar continuidade`);
            break;
        case 'UNDERPERFORMANCE':
            analysis.push(`⚠️ Performando pior que BTC`);
            analysis.push(`🔻 Fraqueza relativa`);
            analysis.push(`📉 Pode precisar de mais atenção`);
            break;
        case 'STRONG_UNDERPERFORMANCE':
            analysis.push(`🚨 FORTE FRAQUEZA RELATIVA vs BTC`);
            analysis.push(`❌ Altcoin em desvantagem`);
            analysis.push(`📉 Risco elevado de queda contínua`);
            break;
        default:
            analysis.push(`➡️ Performance similar ao BTC`);
            analysis.push(`⚖️ Movendo-se em linha com o mercado`);
            analysis.push(`📊 Sem vantagem/desvantagem clara`);
    }
    
    analysis.push(`Performance relativa: ${relativePerformance.toFixed(2)}%`);
    
    return analysis;
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
        
        const candles = await getCandlesCached(symbol, timeframe, 10);
        if (candles.length < 5) return null;
        
        const recentCloses = candles.slice(-5).map(c => c.close);
        const recentVolumes = candles.slice(-5).map(c => c.volume);
        
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
        
        const isSpiking = Math.abs(avgPriceChange) > 0.5 && avgVolumeChange > 30;
        
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
        console.log(`   EMA: ${emaData.currentEMA.toFixed(2)} (${emaRatio.toFixed(2)}x, α=${VOLUME_ROBUST_SETTINGS.emaAlpha})`);
        console.log(`   Z-Score: ${zScore.toFixed(2)} (Lookback: ${adaptiveLookback})`);
        console.log(`   VPT: ${vptData.priceMovementPercent.toFixed(2)}% (${vptData.trendDirection})`);
        console.log(`   Score Combinado: ${combinedScore.toFixed(2)} (${classification})`);
        console.log(`   Confirmado: ${isVolumeConfirmed ? '✅' : '❌'}`);
        
        return {
            rawRatio,
            isAbnormal: combinedScore >= 0.6 || Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.zScoreThreshold,
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
    if (closes.length < 10) {
        return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
    }
    
    const recentCloses = closes.slice(-20);
    let sumReturns = 0;
    for (let i = 1; i < recentCloses.length; i++) {
        const returnVal = Math.abs((recentCloses[i] - recentCloses[i-1]) / recentCloses[i-1]);
        sumReturns += returnVal;
    }
    const volatility = sumReturns / (recentCloses.length - 1) * 100;
    
    if (volatility > 2.0) {
        return Math.max(VOLUME_ROBUST_SETTINGS.minZScoreLookback, 
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 0.5);
    } else if (volatility < 0.5) {
        return Math.min(VOLUME_ROBUST_SETTINGS.maxZScoreLookback,
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 1.5);
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
    if (volumes.length < 5 || closes.length < 5) {
        return {
            priceMovementPercent: 0,
            volumeTrend: 'neutral',
            trendDirection: 'neutral',
            correlation: 0
        };
    }
    
    const recentCloses = closes.slice(-5);
    const priceChange = ((recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0]) * 100;
    
    const recentVolumes = volumes.slice(-5);
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
                    PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe] || 70
                );

                if (candles.length < 40) continue;

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
                '5m': allPivots.filter(p => p.timeframe === '5m').length,
                '15m': allPivots.filter(p => p.timeframe === '15m').length,
                '1h': allPivots.filter(p => p.timeframe === '1h').length
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
            SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod + 20);

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
    const window = 5;

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
    const window = 5;

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
        analysis.push(`Suporte mais próximo: ${nearestSupport.price.toFixed(8)} (${nearestSupport.strength})`);
        analysis.push(`Distância ao suporte: ${((nearestSupport.distancePercent || 0).toFixed(2))}%`);

        if (nearestSupport.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DO SUPORTE!`);
        }
    }

    if (nearestResistance) {
        analysis.push(`Resistência mais próximo: ${nearestResistance.price.toFixed(8)} (${nearestResistance.strength})`);
        analysis.push(`Distância à resistência: ${((nearestResistance.distancePercent || 0).toFixed(2))}%`);

        if (nearestResistance.distancePercent <= SUPPORT_RESISTANCE_SETTINGS.proximityThreshold) {
            analysis.push(`⚠️ PRÓXIMO DA RESISTÊNCIA!`);
        }
    }

    if (isBullish && nearestResistance) {
        const upsidePotential = nearestResistance.distancePercent || 0;
        analysis.push(`Potencial de alta até resistência: ${upsidePotential.toFixed(2)}%`);
    }

    if (!isBullish && nearestSupport) {
        const downsidePotential = nearestSupport.distancePercent || 0;
        analysis.push(`Potencial de baixa até suporte: ${downsidePotential.toFixed(2)}%`);
    }

    return analysis;
}

async function getATRData(symbol, timeframe = '10m', period = 12) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 20);
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
        if (atrPercentage < 1.0) volatilityLevel = 'low';
        else if (atrPercentage > 2.5) volatilityLevel = 'high';

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
        const stopPercentage = 2.5;
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
    const stopPercentage = 2.5;
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
        bestRiskReward: (8.0 / stopPercentage).toFixed(2),
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

        const message = `🚀 Titanium BTC Pars ativado\n${brazilTime.full}`;

        console.log('\n📤 ENVIANDO MENSAGEM DE INICIALIZAÇÃO...');

        let success = false;
        let attempts = 0;
        const maxAttempts = 3;

        while (!success && attempts < maxAttempts) {
            attempts++;

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
                        parse_mode: 'Markdown',
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
                        await new Promise(r => setTimeout(r, 2000 * attempts));
                    }
                }

            } catch (error) {
                console.log(`⚠️ Tentativa ${attempts}/${maxAttempts}: ${error.message}`);
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 2000 * attempts));
                }
            }
        }

        if (!success) {
            console.log('📋 Mensagem que seria enviada:');
            console.log('\n' + '='.repeat(60));
            console.log('🚀 Titanium BTC Pars ativado');
            console.log(`⏰ ${brazilTime.full}`);
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
let learningSystem = new AdvancedLearningSystem();

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

async function getCandlesCached(symbol, timeframe, limit = 80) {
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
        const candles = await getCandlesCached(symbol, '3m', 80);
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
        const candles = await getCandlesCached(symbol, '1h', 80);
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
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 10);
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
        const candles = await getCandlesCached(symbol, '1h', 30);
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
        const candles = await getCandlesCached(symbol, '4h', 40);
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

async function checkCCI4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 50);
        if (candles.length < CCI_4H_SETTINGS.period + 10) return {
            value: 0,
            maValue: 0,
            isValid: false
        };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const cciValues = CCI.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: CCI_4H_SETTINGS.period
        });

        if (!cciValues || cciValues.length === 0) return {
            value: 0,
            maValue: 0,
            isValid: false
        };

        const latestCCI = cciValues[cciValues.length - 1];

        const cciForMA = cciValues.slice(-CCI_4H_SETTINGS.maPeriod);
        const cciMA = cciForMA.reduce((sum, value) => sum + value, 0) / cciForMA.length;

        const isValid = isBullish ?
            latestCCI > cciMA :
            latestCCI < cciMA;

        return {
            value: latestCCI,
            maValue: cciMA,
            isValid: isValid,
            deviation: Math.abs(latestCCI - cciMA)
        };
    } catch (error) {
        return {
            value: 0,
            maValue: 0,
            isValid: false
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR QUALIDADE DO SINAL
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

    const volumeData = marketData.volume?.robustData;
    if (volumeData && volumeData.combinedScore >= 0.4) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume,
            QUALITY_WEIGHTS.volume * volumeData.combinedScore);
        score += volumeScore;
        details.push(` Vol 3m Robusto: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (Score: ${volumeData.combinedScore.toFixed(2)} - ${volumeData.classification})`);
        details.push(`   EMA: ${volumeData.emaRatio.toFixed(2)}x | Z-Score: ${volumeData.zScore.toFixed(2)} | VPT: ${volumeData.vpt.priceMovementPercent.toFixed(2)}%`);
    } else {
        failedChecks.push(`Vol 3m: Score ${volumeData?.combinedScore?.toFixed(2) || '0.00'} < 0.4 (${volumeData?.classification || 'FRACO'})`);
    }

    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(` Volatilidade 10m: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatilidade 10m: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}% < ${VOLATILITY_THRESHOLD}%`);
    }

    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;

        if ((isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) ||
            (!isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(1)} ${isBullish ? '≤' : '≥'} ${isBullish ? RSI_BUY_MAX : RSI_SELL_MIN} Ideal)`);
        } else {
            failedChecks.push(`RSI 1h: ${rsiValue.toFixed(1)} (Fora da zona ideal)`);
        }
        score += rsiScore;
    }

    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
            (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);

        if (isEmaValid) {
            const emaScore = QUALITY_WEIGHTS.emaAlignment;
            score += emaScore;
            details.push(` EMA 3m: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} ${isBullish ? 'bullish' : 'bearish'})`);
        } else {
            failedChecks.push(`EMA 3m: Alinhamento incorreto`);
        }
    }

    if (marketData.stoch && marketData.stoch.isValid) {
        const stochScore = QUALITY_WEIGHTS.stoch1h;
        score += stochScore;
        const direction = isBullish ? 'K > D (cruzamento bullish)' : 'K < D (cruzamento bearish)';
        details.push(` Stoch 1h (14,3,3): ${stochScore}/${QUALITY_WEIGHTS.stoch1h} (${direction})`);
    } else {
        failedChecks.push(`Stoch 1h: Sem cruzamento ${isBullish ? 'bullish' : 'bearish'} (K ${isBullish ? '≤' : '≥'} D)`);
    }

    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        const stoch4hScore = QUALITY_WEIGHTS.stoch4h;
        score += stoch4hScore;
        details.push(` Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h} ${isBullish ? 'bullish' : 'bearish'} `);
    } else {
        failedChecks.push(`Stoch 4h: ${isBullish ? 'bullish' : 'bearish'} `);
    }

    if (marketData.cci4h && marketData.cci4h.isValid) {
        const cci4hScore = QUALITY_WEIGHTS.cci4h;
        score += cci4hScore;
        const deviation = marketData.cci4h.deviation.toFixed(2);
        details.push(` CCI 4h: ${cci4hScore}/${QUALITY_WEIGHTS.cci4h} (${marketData.cci4h.value.toFixed(2)} ${isBullish ? '>' : '<'} ${marketData.cci4h.maValue.toFixed(2)} MMS, dev: ${deviation})`);
    } else {
        failedChecks.push(`CCI 4h: ${marketData.cci4h?.value?.toFixed(2) || 0} ${isBullish ? '≤' : '≥'} ${marketData.cci4h?.maValue?.toFixed(2) || 0} MMS`);
    }

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
        details.push(` Risco Rompimento: ${breakoutDetail}`);
    }

    if (marketData.supportResistance) {
        let srScore = 0;
        let srDetail = '';

        const nearestLevel = isBullish ?
            marketData.supportResistance.nearestResistance :
            marketData.supportResistance.nearestSupport;

        if (nearestLevel) {
            const distance = nearestLevel.distancePercent || 0;

            if (distance >= 3.0) {
                srScore = QUALITY_WEIGHTS.supportResistance;
                srDetail = `${srScore}/${QUALITY_WEIGHTS.supportResistance} (Boa distância: ${distance.toFixed(2)}%)`;
            } else if (distance >= 1.5) {
                srScore = QUALITY_WEIGHTS.supportResistance * 0.7;
                srDetail = `${srScore.toFixed(1)}/${QUALITY_WEIGHTS.supportResistance} (Distância ok: ${distance.toFixed(2)}%)`;
            } else if (distance >= 0.8) {
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
        details.push(` Distância S/R: ${srDetail}`);
    }

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
                pivotDetail = `${pivotScore}/${QUALITY_WEIGHTS.pivotPoints} (Excelente distância do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% > ${safeDistance.toFixed(1)}%)`;
            } else if (distanceRatio >= 1.0) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.8;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Boa distância do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% ≥ ${safeDistance.toFixed(1)}%)`;
            } else if (distanceRatio >= 0.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.4;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Próximo do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`;
            } else {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (MUITO PRÓXIMO DO PIVOT ${pivotStrength.toUpperCase()} ${timeframe.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${pivotStrength} ${timeframe}: Muito próximo (${distance.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`);
            }
            
            if (timeframeWeight >= 2.0 && distanceRatio < 0.8) {
                pivotScore = Math.max(0, pivotScore - 2);
                pivotDetail += ` | PIVOT FORTE PRÓXIMO`;
            }
            
            if (nearestPivot.isTesting) {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (TESTANDO PIVOT ${pivotStrength.toUpperCase()} ${timeframe.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${pivotStrength} ${timeframe}: Testando nível`);
            }
        } else {
            pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.5;
            pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Sem pivot próximo detectado)`;
        }
        
        score += pivotScore;
        details.push(` Pivot Points: ${pivotDetail}`);
    } else {
        failedChecks.push(`Pivot Points: Não analisado`);
    }

    if (marketData.btcCorrelation) {
        const btcCorrelationData = marketData.btcCorrelation;
        const relativePerformance = btcCorrelationData.relativePerformance || 0;
        const performanceLevel = btcCorrelationData.performanceLevel || 'NEUTRAL';
        
        let btcScore = 0;
        let btcDetail = '';

        switch (performanceLevel) {
            case 'HIGH_OUTPERFORMANCE':
                btcScore = QUALITY_WEIGHTS.btcCorrelation;
                btcDetail = `${btcScore}/${QUALITY_WEIGHTS.btcCorrelation} (📈📈 ALTA PERFORMANCE vs BTC: +${relativePerformance.toFixed(2)}%)`;
                details.push(` 🚀 PERFORMANCE VS BTC: Altcoin liderando o mercado!`);
                break;
            case 'MEDIUM_OUTPERFORMANCE':
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.8;
                btcDetail = `${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (📈 Performance positiva vs BTC: +${relativePerformance.toFixed(2)}%)`;
                break;
            case 'NEUTRAL':
                btcScore = QUALITY_WEIGHTS.btcCorrelation * 0.5;
                btcDetail = `${btcScore.toFixed(1)}/${QUALITY_WEIGHTS.btcCorrelation} (➡️ Performance similar ao BTC: ${relativePerformance.toFixed(2)}%)`;
                break;
            case 'UNDERPERFORMANCE':
                btcScore = 0;
                btcDetail = `0/${QUALITY_WEIGHTS.btcCorrelation} (⚠️ Performando pior que BTC: ${relativePerformance.toFixed(2)}%)`;
                failedChecks.push(`Performance vs BTC: Altcoin em desvantagem (${relativePerformance.toFixed(2)}%)`);
                break;
            case 'STRONG_UNDERPERFORMANCE':
                btcScore = 0;
                btcDetail = `0/${QUALITY_WEIGHTS.btcCorrelation} (🚨 FORTE FRAQUEZA vs BTC: ${relativePerformance.toFixed(2)}%)`;
                failedChecks.push(`Performance vs BTC: Altcoin muito fraco vs BTC (${relativePerformance.toFixed(2)}%)`);
                break;
            default:
                btcDetail = `0/${QUALITY_WEIGHTS.btcCorrelation} (Não analisado)`;
        }

        score += btcScore;
        details.push(` Performance vs BTC: ${btcDetail}`);
    } else {
        failedChecks.push(`Performance vs BTC: Não analisado`);
    }

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
        details.push(` Momentum ${marketData.momentum?.timeframe || '1m'}: ${momentumDetail}`);
    } else {
        failedChecks.push(`Momentum: Não analisado`);
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
        this.groupSize = SENSITIVITY_SETTINGS.symbolGroupSize || 15;
        this.signalsDetected = 0;
        this.baseDelay = SENSITIVITY_SETTINGS.scanInterval || 5000;
        this.minDelay = SENSITIVITY_SETTINGS.minScanInterval || 2500;
        this.maxDelay = SENSITIVITY_SETTINGS.maxScanInterval || 8000;
        this.consecutiveNoSignals = 0;
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllSpotSymbols();

            const filteredSymbols = allSymbols.filter(symbol => {
                const blacklist = ['BULL', 'BEAR', 'UP', 'DOWN', 'MOVR'];
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

            if (this.totalCycles % 5 === 0) {
                return { symbols: [], pause: 20000 };
            }
        }

        return { symbols: group, pause: 0 };
    }

    adjustDelayBasedOnUsage() {
        if (this.consecutiveNoSignals > SENSITIVITY_SETTINGS.maxConsecutiveNoSignals) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.7);
            console.log(`⚡ Reduzindo delay para ${this.baseDelay}ms (${this.consecutiveNoSignals} grupos sem sinais)`);
            this.consecutiveNoSignals = 0;
        }

        if (this.signalsDetected > 0) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.9);
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

        const btcCorrelationData = await analyzeBTCCorrelation(symbol, emaData.currentPrice, isBullish);
        
        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPoints(symbol, emaData.currentPrice, isBullish);
        const momentumData = await detectMomentumSpike(symbol, '1m');

        const [volumeData, volatilityData, stochData, stoch4hData, cci4hData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),
            checkCCI4h(symbol, isBullish)
        ]);

        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            rsi: rsiData,
            stoch: stochData,
            stoch4h: stoch4hData,
            cci4h: cci4hData,
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

        if (learningSystem) {
            await learningSystem.recordSignal(signal, marketData);
        }

        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        const pivotInfo = pivotPointsData?.nearestPivot;
        const pivotDistance = pivotInfo?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = pivotInfo?.type || 'N/A';
        const pivotStrength = pivotInfo?.strength || 'N/A';
        const pivotTimeframe = pivotInfo?.timeframe || 'N/A';

        const volumeRobustData = volumeData.robustData;
        const volumeScore = volumeRobustData?.combinedScore?.toFixed(2) || '0.00';
        const volumeClassification = volumeRobustData?.classification || 'NORMAL';
        const emaRatio = volumeRobustData?.emaRatio?.toFixed(2) || 'N/A';
        const zScore = volumeRobustData?.zScore?.toFixed(2) || 'N/A';

        const relativePerformance = btcCorrelationData?.relativePerformance || 0;
        let performanceText = '';
        if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.highOutperformance) {
            performanceText = `📈 +${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (relativePerformance >= BTC_CORRELATION_SETTINGS.thresholds.mediumOutperformance) {
            performanceText = `📊 +${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.strongUnderperformance) {
            performanceText = `📉 ${relativePerformance.toFixed(2)}% vs BTC`;
        } else if (relativePerformance <= BTC_CORRELATION_SETTINGS.thresholds.underperformance) {
            performanceText = `⚠️ ${relativePerformance.toFixed(2)}% vs BTC`;
        } else {
            performanceText = `➡️ ${relativePerformance.toFixed(2)}% vs BTC`;
        }

        const momentumText = momentumData?.isSpiking ? ` | ⚡ ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em 1m` : '';

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   ${performanceText}${momentumText}`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📈 Volume: ${volumeData.rawRatio.toFixed(2)}x (Score: ${volumeScore} - ${volumeClassification})`);
        console.log(`   📊 EMA: ${emaRatio}x | Z-Score: ${zScore}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);

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
            await new Promise(r => setTimeout(r, 150));
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
}

// =====================================================================
// 🔄 LOOP PRINCIPAL DO BOT
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

    console.log(`\n TITANIUM SPOT BTC - ANÁLISE DE PERFORMANCE RELATIVA`);
    console.log(` ${allSymbols.length} pares BTC spot Binance`);
    console.log(` RSI: Compra ≤ ${RSI_BUY_MAX}, Venda ≥ ${RSI_SELL_MIN}`);
    console.log(` ⚡ Momentum: Detecção rápida em 1m`);
    console.log(`  Score < 0.4: "ANÁLISE")`);
    console.log(`  Performance vs BTC: Destacando altcoins liderando o mercado`);
    console.log(`  Tipos de Análise: Momentum Rápido | Outperformance BTC | Reversão | Exaustão/Correção | Neutra`);

    await sendInitializationMessage(allSymbols);

    let consecutiveErrors = 0;
    let totalSignals = 0;
    let totalAnalysis = 0;
    let lastReportTime = Date.now();
    let lastRiskReportTime = Date.now();

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
                console.log('🌐 Sem conexão. Aguardando 15s...');
                await new Promise(r => setTimeout(r, 15000));
                continue;
            }

            const startTime = Date.now();
            const signals = await processSymbolGroup(currentSymbols);
            const endTime = Date.now();

            totalSignals += signals.length;
            symbolManager.signalsDetected += signals.length;

            if (signals.length === 0) {
                symbolManager.consecutiveNoSignals++;
            } else {
                symbolManager.consecutiveNoSignals = 0;
            }

            console.log(`✅ ${((endTime - startTime) / 1000).toFixed(1)}s | Sinais: ${signals.length} (Total: ${totalSignals})`);

            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    const alertResult = await sendSignalAlertWithRisk(signal);
                    if (alertResult && alertResult.type === 'analysis') {
                        totalAnalysis++;
                    }
                    await new Promise(r => setTimeout(r, 800));
                }
            }

            cleanupCaches();

            if (Date.now() - lastReportTime >= 3600000) {
                await learningSystem.sendPerformanceReport();
                lastReportTime = Date.now();
            }

            if (Date.now() - lastRiskReportTime >= 6 * 60 * 60 * 1000) {
                await sendMarketRiskReport();
                lastRiskReportTime = Date.now();
            }

            const status = symbolManager.getCurrentStatus();
            console.log(`📊 Progresso: ${status.consecutiveNoSignals} grupos sem sinais | Análises: ${totalAnalysis}`);

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
🛡️ ⚠️IA SENSITIVE - RISCO / VOLATILIDADE⚠️
${now.full}

• Nível de Risco Geral: ${marketRisk.riskLevel} ${marketRisk.riskLevel === 'CRITICAL' ? '🚨' : marketRisk.riskLevel === 'HIGH' ? '🔴' : marketRisk.riskLevel === 'MEDIUM' ? '🟡' : '🟢'}
• Score Médio de Risco: ${marketRisk.averageRiskScore.toFixed(2)}/15
• Símbolos Monitorados: ${marketRisk.monitoredSymbols}
• Horário: ${now.full}

✨Titanium Risk Management by @J4Rviz✨
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

        const bestPatterns = report.bestPatterns.map(([pattern, count]) => `${pattern}: ${count} trades`).join('\n');
        const worstPatterns = report.worstPatterns.map(([pattern, count]) => `${pattern}: ${count} trades`).join('\n');

        const message = `
🧠 RELATÓRIO DE PERFORMANCE VS BTC
${now.full}

• Trades Totais: ${report.totalTrades}
• Taxa de Acerto: ${report.winRate.toFixed(1)}%
• Fator de Lucro: ${report.profitFactor}
• Lucro Médio: ${report.avgProfit}% | Perda Média: ${report.avgLoss}%

🚀 Análise Performance vs BTC:
• Win Rate com alta performance: ${report.btcCorrelationAnalysis.highOutperformWinRate}%
• Trades com alta performance: ${report.btcCorrelationAnalysis.highOutperformTrades}

⚡ Análise Momentum:
• Win Rate com momentum forte: ${report.momentumAnalysis.strongMomentumWinRate}%
• Trades com momentum forte: ${report.momentumAnalysis.strongMomentumTrades}

📈 Padrões Vencedores (Top 5):
${bestPatterns || 'Nenhum padrão identificado ainda'}

📉 Padrões Perdedores (Top 5):
${worstPatterns || 'Nenhum padrão identificado ainda'}

📊 Simulação Trailing:
• Total: ${report.simulationStats.totalSimulated}
• Stop Primeiro: ${report.simulationStats.stopFirst}
• Alvo Primeiro: ${report.simulationStats.targetFirst}

✨Titanium System by @J4Rviz✨
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
                rsiSettings: [],
                btcCorrelation: [],
                momentum: []
            },
            lastUpdated: Date.now(),
            trailingConfig: learningSystem.trailingConfig,
            resetTimestamp: Date.now(),
            resetNote: 'Sistema resetado para análise de pares BTC spot (RSI EXTREME REMOVIDO)'
        };
        
        fs.writeFileSync(learningFile, JSON.stringify(cleanData, null, 2));
        
        console.log('✅ Dados de aprendizado resetados com sucesso!');
        console.log('📊 Novo relatório será gerado com dados de pares BTC spot.');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao resetar dados de aprendizado:', error.message);
        return false;
    }
}

// =====================================================================
// 🚨 FUNÇÃO DE ALERTA URGENTE
// =====================================================================

async function sendUrgentAlert(signal, reason) {
    const now = getBrazilianDateTime();
    
    const message = `
🚨🚨 ALERTA URGENTE: ${signal.symbol}
${now.date} ${now.time}

📈 MOTIVO: ${reason}

• Performance vs BTC: ${signal.marketData.btcCorrelation?.relativePerformance.toFixed(2)}%
• Volume: ${signal.marketData.volume?.rawRatio.toFixed(2)}x
• RSI: ${signal.marketData.rsi?.value.toFixed(1)}
• Score: ${signal.qualityScore.score}/100

⚡ Entrada RÁPIDA recomendada!
    `;
    
    await sendTelegramAlert(message);
    console.log(`🚨 Alerta urgente enviado: ${signal.symbol} - ${reason}`);
}

// =====================================================================
// ▶️ INICIALIZAÇÃO COM OPÇÃO DE RESET
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM SPOT BTC - ANÁLISE DE PERFORMANCE RELATIVA');
        console.log(` RSI: Compra ≤ ${RSI_BUY_MAX}, Venda ≥ ${RSI_SELL_MIN}`);
        console.log(` ⚡ Momentum: Detecção rápida em 1m-3m`);
        console.log(` 📈 Performance vs BTC: Destacando oportunidades relativas`);
        console.log('='.repeat(80) + '\n');

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

        global.riskLayer = new SophisticatedRiskLayer();
        console.log('🛡️  Risk Layer Sofisticado ativado (RSI EXTREME REMOVIDO)');

        console.log('✅ Tudo pronto! Iniciando monitoramento de pares BTC spot...');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
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
    console.log('  • Performance vs BTC: ' + BTC_CORRELATION_SETTINGS.thresholds.highOutperformance + '%+ para alta performance');
    console.log('');
    console.log('⚙️  Configurações de sensibilidade:');
    console.log('  • Scan Interval: ' + (SENSITIVITY_SETTINGS.scanInterval / 1000) + 's');
    console.log('  • Symbol Group Size: ' + SENSITIVITY_SETTINGS.symbolGroupSize);
    console.log('  • Max Consecutive No Signals: ' + SENSITIVITY_SETTINGS.maxConsecutiveNoSignals);
    console.log('');
    console.log('📈 Sistema otimizado para:');
    console.log('  • Alertas mais rápidos (timeframes menores)');
    console.log('  • Maior sensibilidade a performance vs BTC');
    console.log('  • Detecção de momentum rápido');
    console.log('  • RSI EXTREME completamente removido');
    console.log('='.repeat(60) + '\n');
    
    return {
        rsi_buy_max: RSI_BUY_MAX,
        rsi_sell_min: RSI_SELL_MIN,
        volume_threshold: VOLUME_SETTINGS.baseThreshold,
        quality_threshold: QUALITY_THRESHOLD,
        btc_high_outperformance: BTC_CORRELATION_SETTINGS.thresholds.highOutperformance,
        scan_interval: SENSITIVITY_SETTINGS.scanInterval,
        group_size: SENSITIVITY_SETTINGS.symbolGroupSize,
        momentum_enabled: true,
        rsi_extreme_removed: true
    };
}

// Iniciar
startBot();
