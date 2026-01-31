const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A';
const TELEGRAM_CHAT_ID = '-1001990889297';


// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE VOLUME MÍNIMO ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.20,  // Reduzido de 0.25
    combinedScore: 0.20,  // Reduzido de 0.25
    classification: 'BAIXO',
    requireConfirmation: false  // Desativado para maior sensibilidade
};

// === CONFIGURAÇÕES OTIMIZADAS BASEADAS NO APRENDIZADO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.4,      // Reduzido de 1.4 para 1.2
    minThreshold: 1.2,       // Reduzido de 1.2 para 1.0
    maxThreshold: 2.0,       // Reduzido de 2.5 para 2.0
    volatilityMultiplier: 0.6, // Aumentado de 0.5 para 0.6
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO ATUALIZADAS PARA 3m - MAIS SENSÍVEIS ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 13,           // Reduzido de 15 para 12
    emaAlpha: 0.4,           // Aumentado de 0.35 para 0.4
    baseZScoreLookback: 25,  // Reduzido de 30 para 25
    minZScoreLookback: 6,    // Reduzido de 8 para 6
    maxZScoreLookback: 50,   // Reduzido de 60 para 50
    zScoreThreshold: 1.0,    // Reduzido de 1.2 para 1.0
    vptThreshold: 0.15,      // Reduzido de 0.20 para 0.15
    minPriceMovement: 0.06,  // Reduzido de 0.08 para 0.06
    combinedMultiplier: 1.05, // Reduzido de 1.08 para 1.05
    volumeWeight: 0.40,      // Aumentado de 0.35 para 0.40
    emaWeight: 0.35,
    zScoreWeight: 0.20,      // Aumentado de 0.18 para 0.20
    vptWeight: 0.05,         // Reduzido de 0.07 para 0.05
    minimumThresholds: {
        combinedScore: 0.10,  // Reduzido de 0.15 para 0.10
        emaRatio: 1.03,       // Reduzido de 1.05 para 1.03
        zScore: 0.10,         // Reduzido de 0.15 para 0.10
        classification: 'BAIXO'
    }
};

const VOLATILITY_PERIOD = 12;        // Reduzido de 15 para 12
const VOLATILITY_TIMEFRAME = '5m';   // Reduzido de 10m para 5m (mais sensível)
const VOLATILITY_THRESHOLD = 0.3;    // Reduzido de 0.4 para 0.3

// === CONFIGURAÇÕES RSI - MAIS SENSÍVEIS ===
const RSI_BUY_MAX = 60;              // Aumentado de 63 para 65
const RSI_SELL_MIN = 30;             // Ajustado de 32 para 30

// === CONFIGURAÇÕES DE SENSIBILIDADE ===
const SENSITIVITY_SETTINGS = {
    scanInterval: 4000,      // Reduzido de 5000ms para 4000ms
    minScanInterval: 2000,   // Reduzido de 2500ms para 2000ms
    maxScanInterval: 6000,   // Reduzido de 8000ms para 6000ms
    symbolGroupSize: 12,     // Reduzido de 15 para 12
    maxConsecutiveNoSignals: 1, // Reduzido de 2 para 1
};

// === CONFIGURAÇÕES DE COOLDOWN MAIS RÁPIDAS ===
const COOLDOWN_SETTINGS = {
    sameDirection: 3 * 60 * 1000,    // Reduzido de 5 para 3 minutos
    oppositeDirection: 1 * 60 * 1000, // Reduzido de 2 para 1 minuto
    useDifferentiated: true,
    adaptiveSettings: {
        highVolumeMultiplier: 0.3,   // Reduzido de 0.5 para 0.3
        highCorrelationMultiplier: 0.2, // Reduzido de 0.3 para 0.2
        consecutiveSignalMultiplier: 1.2 // Reduzido de 1.5 para 1.2
    }
};

// === QUALITY SCORE MAIS PERMISSIVO ===
const QUALITY_THRESHOLD = 80; // Reduzido de 65 para 60

// === PESOS AJUSTADOS PARA MAIOR SENSIBILIDADE A BTC ===
const QUALITY_WEIGHTS = {
    volume: 28,           // Reduzido de 36 para 28
    volatility: 8,        // Reduzido de 10 para 8
    rsi: 14,              // Reduzido de 16 para 14
    emaAlignment: 14,     // Reduzido de 16 para 14
    stoch1h: 8,           // Reduzido de 10 para 8
    stoch4h: 10,           // Reduzido de 8 para 6
    cci4h: 0,             // Reduzido de 8 para 6
    breakoutRisk: 6,      // Reduzido de 10 para 8
    supportResistance: 9, // Reduzido de 10 para 8
    pivotPoints: 9,       // Reduzido de 10 para 8
    btcCorrelation: 38,   // Aumentado de 28 para 38 (MÁXIMO FOCO)
    momentum: 8,          // Aumentado de 5 para 8
    volumeConfirmation: 10, // Novo: confirmação de volume
    trendAlignment: 10      // Novo: alinhamento com tendência BTC
};

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1400,     // Aumentado de 1200 para 1400
    requestsPerSecond: 50,       // Aumentado de 40 para 50
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2600,    // Aumentado de 2400 para 2600
    maxWeightPerSecond: 50,      // Aumentado de 45 para 50
    retryConfig: {
        maxRetries: 3,
        initialDelay: 1000,      // Reduzido de 1500 para 1000
        maxDelay: 8000,          // Reduzido de 10000 para 8000
        backoffFactor: 1.8       // Reduzido de 2.0 para 1.8
    },
    circuitBreaker: {
        failureThreshold: 12,    // Aumentado de 10 para 12
        resetTimeout: 45000,     // Reduzido de 60000 para 45000
        halfOpenMaxRequests: 6   // Aumentado de 5 para 6
    }
};

// === CONFIGURAÇÕES PARA RETRAÇÕES DINÂMICAS COM ATR ===
const RETRACEMENT_SETTINGS = {
    minPercentage: 0.15,         // Reduzido de 0.20 para 0.15
    maxPercentage: 0.35,         // Reduzido de 0.45 para 0.35
    useDynamicATR: true,
    atrMultiplierMin: 0.3,       // Reduzido de 0.4 para 0.3
    atrMultiplierMax: 0.6,       // Reduzido de 0.8 para 0.6
    volatilityAdjustment: {
        low: 0.6,                // Reduzido de 0.8 para 0.6
        medium: 0.8,
        high: 1.0                // Reduzido de 1.2 para 1.0
    }
};

// === CONFIGURAÇÕES DE STOP DINÂMICO ===
const DYNAMIC_STOP_SETTINGS = {
    baseATRMultiplier: 2.5,      // Reduzido de 3.0 para 2.5
    minStopPercentage: 1.2,      // Reduzido de 1.5 para 1.2
    maxStopPercentage: 5.0,      // Reduzido de 6.0 para 5.0
    volatilityBased: true,
    volatilityMultipliers: {
        low: 0.5,                // Reduzido de 0.6 para 0.5
        medium: 0.7,             // Reduzido de 0.8 para 0.7
        high: 0.9                // Reduzido de 1.1 para 0.9
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE SUPORTE/RESISTÊNCIA ===
const SUPPORT_RESISTANCE_SETTINGS = {
    lookbackPeriod: 35,          // Reduzido de 40 para 35
    timeframe: '5m',             // Reduzido de 10m para 5m (mais sensível)
    minTouchPoints: 2,
    proximityThreshold: 0.8,     // Reduzido de 1.0 para 0.8
    breakoutThreshold: 0.5,      // Reduzido de 0.6 para 0.5
    strongLevelThreshold: 2,
    recentPeriod: 12             // Reduzido de 15 para 12
};

// === CONFIGURAÇÕES PARA RISCO DE ROMPIMENTO ===
const BREAKOUT_RISK_SETTINGS = {
    highRiskDistance: 0.25,      // Reduzido de 0.3 para 0.25
    mediumRiskDistance: 0.5,     // Reduzido de 0.7 para 0.5
    lowRiskDistance: 1.0,        // Reduzido de 1.5 para 1.0
    safeDistance: 2.0            // Reduzido de 2.5 para 2.0
};

// === CONFIGURAÇÕES PARA PIVOT POINTS MULTI-TIMEFRAME ===
const PIVOT_POINTS_SETTINGS = {
    timeframeStrengthWeights: {
        '3m': 0.8,               // Novo: timeframe mais rápido
        '5m': 1.0,
        '15m': 1.5,
        '1h': 2.5,
        '4h': 4.0
    },
    safeDistanceMultipliers: {
        'weak': 0.3,             // Reduzido de 0.4 para 0.3
        'moderate': 0.6,         // Reduzido de 0.8 para 0.6
        'strong': 0.9,           // Reduzido de 1.2 para 0.9
        'very_strong': 1.2       // Reduzido de 1.6 para 1.2
    },
    minDistance: 3,              // Reduzido de 4 para 3
    priceTolerance: 0.002,       // Reduzido de 0.003 para 0.002
    analyzeTimeframes: ['3m', '5m', '15m'], // Adicionado 3m
    candlesPerTimeframe: {
        '3m': 40,                // Novo: 3 minutos
        '5m': 45,
        '15m': 50,
        '1h': 70
    }
};

// === CONFIGURAÇÕES PARA ANÁLISE DE PERFORMANCE VS BTC - MAIS SENSÍVEIS ===
const BTC_CORRELATION_SETTINGS = {
    timeframe: '3m',             // Reduzido de 5m para 3m
    lookbackPeriods: {
        ultraShort: 2,           // 6 minutos (novo)
        short: 4,                // 12 minutos
        medium: 8,               // 24 minutos
        long: 12                 // 36 minutos
    },
    thresholds: {
        strongOutperformance: 0.8,    // Reduzido de 1.0% para 0.8%
        mediumOutperformance: 0.4,    // Reduzido de 0.5% para 0.4%
        neutralZone: 0.2,             // Novo
        underperformance: -0.2,       // Ajustado de -0.3% para -0.2%
        strongUnderperformance: -0.5  // Ajustado de -0.8% para -0.5%
    },
    weights: {
        ultraShort: 0.4,         // Maior peso para timeframe mais curto
        short: 0.3,
        medium: 0.2,
        long: 0.1
    }
};

// === CONFIGURAÇÕES DE PRIORIDADE ===
const PRIORITY_SETTINGS = {
    highPriority: {
        btcOutperformance: 1.0,      // Reduzido de 1.5% para 1.0%
        volumeSpike: 2.5,           // Reduzido de 3.0 para 2.5
        momentum1m: 0.8,            // Reduzido de 1.0% para 0.8%
        rsiSignal: true,
    },
    mediumPriority: {
        btcOutperformance: 0.5,     // Reduzido de 0.8% para 0.5%
        volumeSpike: 1.8,           // Reduzido de 2.0 para 1.8
        rsiReversal: true,
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS MAIS RÁPIDOS ===
const candleCache = {};
const momentumCache = {};
const correlationCache = {};
const CANDLE_CACHE_TTL = 20000;      // Reduzido de 30000 para 20000ms
const MOMENTUM_CACHE_TTL = 5000;     // Reduzido de 10000 para 5000ms
const CORRELATION_CACHE_TTL = 8000;  // Cache de correlação
const MAX_CACHE_AGE = 3 * 60 * 1000; // Reduzido de 5 para 3 minutos

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

const TARGET_PERCENTAGES = [0.8, 1.5, 2.5, 4.0, 6.0]; // Alvos mais agressivos
const ATR_PERIOD = 10;              // Reduzido de 12 para 10
const ATR_TIMEFRAME = '5m';         // Reduzido de 10m para 5m

// =====================================================================
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO COM FOCO EM BTC
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
            BTC_CORRELATION_RISK: { weight: 2.2, threshold: 0.8 }, // Peso máximo
            VOLATILITY_RISK: { weight: 1.0, threshold: 2.0 },
            VOLUME_RISK: { weight: 0.8, threshold: 0.4 },
            LIQUIDITY_RISK: { weight: 1.2, threshold: 1000000 },
            CORRELATION_RISK: { weight: 1.1, threshold: 0.8 },
            TIME_RISK: { weight: 0.6 },
            SUPPORT_RESISTANCE_RISK: { weight: 1.0 },
            MARKET_CONDITION_RISK: { weight: 1.3 },
            PIVOT_RISK: { weight: 0.9 },
            MOMENTUM_RISK: { weight: 1.0 }
        };

        this.riskHistory = new Map();
        this.maxHistorySize = 150;
        this.btcTrend = null;

        console.log('🛡️  Risk Layer Sofisticado inicializado com FOCO EM BTC');
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

            // ANÁLISE BTC - PRIORIDADE MÁXIMA
            const btcRisk = await this.analyzeBTCCorrelationRisk(signal);
            riskAssessment.factors.push(btcRisk);
            riskAssessment.overallScore += btcRisk.score * this.riskFactors.BTC_CORRELATION_RISK.weight;

            // ANÁLISE DE MOMENTO BTC
            const btcMomentumRisk = await this.analyzeBTCMomentumRisk(signal);
            riskAssessment.factors.push(btcMomentumRisk);
            riskAssessment.overallScore += btcMomentumRisk.score * 1.5;

            // ANÁLISE DE TENDÊNCIA BTC
            const btcTrendRisk = await this.analyzeBTCTrendRisk(signal);
            riskAssessment.factors.push(btcTrendRisk);
            riskAssessment.overallScore += btcTrendRisk.score * 1.2;

            // Outras análises (pesos reduzidos)
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
            riskAssessment.overallScore += trendRisk.score * 0.8;

            const pivotRisk = this.analyzePivotRisk(signal);
            riskAssessment.factors.push(pivotRisk);
            riskAssessment.overallScore += pivotRisk.score * this.riskFactors.PIVOT_RISK.weight;

            const momentumRisk = await this.analyzeMomentumRisk(signal);
            riskAssessment.factors.push(momentumRisk);
            riskAssessment.overallScore += momentumRisk.score * this.riskFactors.MOMENTUM_RISK.weight;

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

    async analyzeBTCMomentumRisk(signal) {
        try {
            const symbol = signal.symbol;
            const ultraFastCandles = await getCandlesCached(symbol, '1m', 3);
            const ultraFastBTC = await getCandlesCached('BTCUSDT', '1m', 3);
            
            if (ultraFastCandles.length < 2 || ultraFastBTC.length < 2) {
                return { type: 'BTC_MOMENTUM', score: 0, message: 'Dados insuficientes' };
            }
            
            const altMomentum = ((ultraFastCandles[1].close - ultraFastCandles[0].close) / ultraFastCandles[0].close) * 100;
            const btcMomentum = ((ultraFastBTC[1].close - ultraFastBTC[0].close) / ultraFastBTC[0].close) * 100;
            const relativeMomentum = altMomentum - btcMomentum;
            
            let score = 0;
            let message = '';
            
            if (signal.isBullish) {
                if (relativeMomentum > 0.5) {
                    score = -2; // Muito bom
                    message = `⚡ MOMENTUM FORTE vs BTC: +${relativeMomentum.toFixed(2)}%`;
                } else if (relativeMomentum > 0.2) {
                    score = -1;
                    message = `📈 Momentum positivo vs BTC: +${relativeMomentum.toFixed(2)}%`;
                } else if (relativeMomentum < -0.3) {
                    score = 2;
                    message = `⚠️ Momentum negativo vs BTC: ${relativeMomentum.toFixed(2)}%`;
                }
            } else {
                if (relativeMomentum < -0.5) {
                    score = -2;
                    message = `⚡ MOMENTUM FORTE vs BTC: ${relativeMomentum.toFixed(2)}%`;
                } else if (relativeMomentum < -0.2) {
                    score = -1;
                    message = `📉 Momentum positivo para venda: ${relativeMomentum.toFixed(2)}%`;
                } else if (relativeMomentum > 0.3) {
                    score = 2;
                    message = `⚠️ Momentum contra venda vs BTC: +${relativeMomentum.toFixed(2)}%`;
                }
            }
            
            return {
                type: 'BTC_MOMENTUM',
                score: Math.min(3, Math.max(-3, score)),
                message: message,
                data: { relativeMomentum, altMomentum, btcMomentum }
            };
        } catch (error) {
            return { type: 'BTC_MOMENTUM', score: 0, message: 'Erro análise' };
        }
    }

    async analyzeBTCTrendRisk(signal) {
        try {
            const btcCandles = await getCandlesCached('BTCUSDT', '15m', 10);
            if (btcCandles.length < 8) {
                return { type: 'BTC_TREND', score: 0, message: 'Dados insuficientes' };
            }
            
            const btcCloses = btcCandles.map(c => c.close);
            const btcTrend = btcCloses[btcCloses.length - 1] > btcCloses[0] ? 'BULLISH' : 'BEARISH';
            
            const altCandles = await getCandlesCached(signal.symbol, '15m', 10);
            if (altCandles.length < 8) {
                return { type: 'BTC_TREND', score: 0, message: 'Dados insuficientes' };
            }
            
            const altCloses = altCandles.map(c => c.close);
            const altTrend = altCloses[altCloses.length - 1] > altCloses[0] ? 'BULLISH' : 'BEARISH';
            
            let score = 0;
            let message = '';
            
            // Verificar divergência perigosa
            if (signal.isBullish && btcTrend === 'BEARISH' && altTrend === 'BULLISH') {
                score = 2;
                message = `🚨 DIVERGÊNCIA PERIGOSA: Altcoin em alta enquanto BTC em baixa`;
            } else if (!signal.isBullish && btcTrend === 'BULLISH' && altTrend === 'BEARISH') {
                score = 2;
                message = `🚨 DIVERGÊNCIA PERIGOSA: Altcoin em baixa enquanto BTC em alta`;
            } else if (btcTrend === altTrend) {
                score = -1;
                message = `✅ Tendência alinhada com BTC: ${btcTrend}`;
            } else {
                score = 1;
                message = `⚠️ Tendência divergente: BTC ${btcTrend}, Altcoin ${altTrend}`;
            }
            
            this.btcTrend = btcTrend;
            
            return {
                type: 'BTC_TREND',
                score: score,
                message: message,
                data: { btcTrend, altTrend }
            };
        } catch (error) {
            return { type: 'BTC_TREND', score: 0, message: 'Erro análise' };
        }
    }

    async analyzeBTCCorrelationRisk(signal) {
        try {
            const symbol = signal.symbol;
            if (!symbol.endsWith('BTC')) {
                return { type: 'BTC_CORRELATION', score: 0, message: 'Não é par BTC' };
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
                return { type: 'BTC_CORRELATION', score: 1, message: 'Dados insuficientes' };
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
            
            // NOVOS THRESHOLDS MAIS SENSÍVEIS
            let performanceLevel = 'NEUTRAL';
            if (combinedPerformance >= 0.8) performanceLevel = 'STRONG_OUTPERFORMANCE';
            else if (combinedPerformance >= 0.4) performanceLevel = 'MODERATE_OUTPERFORMANCE';
            else if (combinedPerformance <= -0.6) performanceLevel = 'STRONG_UNDERPERFORMANCE';
            else if (combinedPerformance <= -0.3) performanceLevel = 'MODERATE_UNDERPERFORMANCE';
            
            let score = 0;
            let message = '';

            if (performanceLevel === 'STRONG_OUTPERFORMANCE') {
                if (signal.isBullish) {
                    score = -3; // Excelente para compra
                    message = `🚀🚀 ALTA PERFORMANCE vs BTC: +${combinedPerformance.toFixed(2)}% (COMPRA FORTE)`;
                } else {
                    score = 1; // Cuidado para venda
                    message = `📈 Alta performance vs BTC: +${combinedPerformance.toFixed(2)}% (CUIDADO VENDA)`;
                }
            } else if (performanceLevel === 'MODERATE_OUTPERFORMANCE') {
                if (signal.isBullish) {
                    score = -2;
                    message = `📈 Performance positiva vs BTC: +${combinedPerformance.toFixed(2)}% (BOA COMPRA)`;
                } else {
                    score = 0;
                    message = `⚠️ Performance positiva vs BTC: +${combinedPerformance.toFixed(2)}% (NEUTRO VENDA)`;
                }
            } else if (performanceLevel === 'STRONG_UNDERPERFORMANCE') {
                if (!signal.isBullish) {
                    score = -3; // Excelente para venda
                    message = `📉📉 FORTE FRAQUEZA vs BTC: ${combinedPerformance.toFixed(2)}% (VENDA FORTE)`;
                } else {
                    score = 3; // Muito ruim para compra
                    message = `🚨 Forte fraqueza vs BTC: ${combinedPerformance.toFixed(2)}% (EVITAR COMPRA)`;
                }
            } else if (performanceLevel === 'MODERATE_UNDERPERFORMANCE') {
                if (!signal.isBullish) {
                    score = -2;
                    message = `📉 Fraqueza vs BTC: ${combinedPerformance.toFixed(2)}% (BOA VENDA)`;
                } else {
                    score = 2;
                    message = `⚠️ Fraqueza vs BTC: ${combinedPerformance.toFixed(2)}% (CUIDADO COMPRA)`;
                }
            } else {
                score = 0;
                message = `➡️ Performance similar ao BTC: ${combinedPerformance.toFixed(2)}%`;
            }

            const isAltcoinBullish = analyses[0]?.altcoinChange > 0;
            const isBTCBullish = analyses[0]?.btcChange > 0;
            
            if (isAltcoinBullish !== isBTCBullish) {
                score += signal.isBullish === isAltcoinBullish ? 1 : -1;
                message += ` | 🔄 DIRECÇÃO OPOSTA AO BTC!`;
            }

            return {
                type: 'BTC_CORRELATION',
                score: Math.min(3, Math.max(-3, score)),
                message: message,
                data: {
                    relativePerformance: combinedPerformance,
                    performanceLevel: performanceLevel,
                    ultraFastPerformance: ultraFastPerf,
                    multiTimeframeAnalysis: analyses,
                    isOutperforming: combinedPerformance > 0.2,
                    signalStrength: Math.abs(combinedPerformance) > 0.6 ? 'STRONG' : 
                                  Math.abs(combinedPerformance) > 0.3 ? 'MODERATE' : 'WEAK'
                }
            };

        } catch (error) {
            return { type: 'BTC_CORRELATION', score: 1, message: 'Erro análise' };
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
                if (momentumData.priceChange > 1.2) {
                    score = signal.isBullish ? -2 : 2;
                    message = `⚡⚡ MOMENTUM EXTREMO: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                } else if (momentumData.priceChange > 0.8) {
                    score = signal.isBullish ? -1 : 1;
                    message = `⚡ Momentum forte: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                } else if (momentumData.priceChange > 0.4) {
                    score = signal.isBullish ? -0.5 : 0.5;
                    message = `📈 Momentum positivo: ${momentumData.priceChange > 0 ? '+' : ''}${momentumData.priceChange.toFixed(2)}% em ${momentumData.timeframe}`;
                }
            } else {
                message = `➡️ Momentum neutro`;
            }

            return {
                type: 'MOMENTUM',
                score: Math.min(3, Math.max(-3, score)),
                message: message,
                data: momentumData
            };
        } catch (error) {
            return { type: 'MOMENTUM', score: 0, message: 'Erro análise' };
        }
    }

    async analyzeVolatilityRisk(signal) {
        try {
            const candles = await getCandlesCached(signal.symbol, '5m', 30);
            if (candles.length < 15) {
                return { type: 'VOLATILITY', score: 1, message: 'Dados insuficientes' };
            }

            const closes = candles.map(c => c.close);
            const atr = await getATRData(signal.symbol, '5m', 10);

            if (!atr) {
                return { type: 'VOLATILITY', score: 1, message: 'ATR não disponível' };
            }

            let sumReturns = 0;
            for (let i = 1; i < closes.length; i++) {
                const returnVal = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
                sumReturns += returnVal;
            }
            const historicalVol = (sumReturns / (closes.length - 1)) * 100;

            const recentCloses = closes.slice(-4);
            let recentVol = 0;
            for (let i = 1; i < recentCloses.length; i++) {
                const returnVal = Math.abs((recentCloses[i] - recentCloses[i - 1]) / recentCloses[i - 1]);
                recentVol += returnVal;
            }
            recentVol = (recentVol / 3) * 100;

            const volatilitySpike = recentVol / Math.max(historicalVol, 0.1);

            let score = 0;
            let message = '';

            if (volatilitySpike > 3.5) {
                score = 3;
                message = `🚨 VOLATILIDADE EXTREMA: Spike ${volatilitySpike.toFixed(1)}x`;
            } else if (volatilitySpike > 2.5) {
                score = 2;
                message = `🔴 Alta volatilidade: ${volatilitySpike.toFixed(1)}x`;
            } else if (recentVol > 6.0) {
                score = 2;
                message = `🔴 Volatilidade alta: ${recentVol.toFixed(2)}%`;
            } else if (recentVol > 3.5) {
                score = 1;
                message = `🟡 Volatilidade moderada: ${recentVol.toFixed(2)}%`;
            } else {
                score = 0;
                message = `🟢 Volatilidade normal: ${recentVol.toFixed(2)}%`;
            }

            if (atr.percentage > 4.0) {
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

        if (combinedScore < 0.2) {
            score = 2;
            message = `📉 VOLUME MUITO FRACO: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore < 0.4) {
            score = 1;
            message = `📉 Volume fraco: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore > 0.8) {
            score = signal.isBullish ? -1 : 0;
            message = `📈 Volume muito forte: Score ${combinedScore.toFixed(2)}`;
        } else if (combinedScore > 0.6) {
            score = signal.isBullish ? -0.5 : 0;
            message = `📊 Volume forte: Score ${combinedScore.toFixed(2)}`;
        } else {
            score = 0;
            message = `📊 Volume moderado: Score ${combinedScore.toFixed(2)}`;
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

            if (quoteVolume < 300000) {
                score = 3;
                message = `💀 LIQUIDEZ CRÍTICA: $${(quoteVolume / 1000).toFixed(1)}k`;
            } else if (quoteVolume < 1000000) {
                score = 2;
                message = `🔴 Liquidez muito baixa: $${(quoteVolume / 1000000).toFixed(2)}M`;
            } else if (quoteVolume < 5000000) {
                score = 1;
                message = `🟡 Liquidez baixa: $${(quoteVolume / 1000000).toFixed(2)}M`;
            } else {
                score = 0;
                message = `🟢 Liquidez OK: $${(quoteVolume / 1000000).toFixed(2)}M`;
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

            const symbolCandles = await getCandlesCached(symbol, '3m', 8);
            const btcCandles = await getCandlesCached('BTCUSDT', '3m', 8);

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

            if (absCorrelation > 0.85) {
                score = correlation > 0 ? 0 : 1;
                message = `Correlação ${correlation > 0 ? 'POSITIVA' : 'NEGATIVA'}: ${correlation.toFixed(2)}`;
            } else if (absCorrelation > 0.6) {
                score = 0;
                message = `Correlação moderada: ${correlation.toFixed(2)}`;
            } else {
                score = 1;
                message = `Baixa correlação: ${correlation.toFixed(2)}`;
            }

            const lastSymbolReturn = symbolReturns[symbolReturns.length - 1];
            const lastBtcReturn = btcReturns[btcReturns.length - 1];

            if (Math.sign(lastSymbolReturn) !== Math.sign(lastBtcReturn) && absCorrelation > 0.7) {
                score += 1;
                message += ` | 🔄 INDO CONTRA BTC!`;
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

        // Horários de maior volatilidade (abertura/fehamento mercados)
        const highRiskHours = [13, 14, 20, 21, 22];
        const mediumRiskHours = [12, 15, 19, 23];

        if (highRiskHours.includes(hour)) {
            score = 1.5;
            message = `⚠️ HORÁRIO DE ALTA VOLATILIDADE`;
        } else if (mediumRiskHours.includes(hour)) {
            score = 0.5;
            message = `🟡 Horário moderado`;
        } else if (hour >= 0 && hour <= 5) {
            score = -0.5;
            message = `🟢 Horário asiático (menos volátil)`;
        } else {
            score = 0;
            message = `🟢 Horário normal`;
        }

        if (day === 0 || day === 6) {
            score += 1;
            message += ` | FIM DE SEMANA`;
        }

        return {
            type: 'TIME',
            score: Math.min(2, Math.max(-1, score)),
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

        if (nearestLevel && nearestLevel.distancePercent < 0.4) {
            score = Math.max(score, 2.5);
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
            const btcCandles = await getCandlesCached('BTCUSDT', '15m', 20);

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

            if (drawdown > 12) {
                score = 2.5;
                message = `🔴 MERCADO EM QUEDA FORTE: BTC -${drawdown.toFixed(1)}%`;
            } else if (drawdown > 7) {
                score = 1.5;
                message = `🟠 Mercado em correção: BTC -${drawdown.toFixed(1)}%`;
            } else if (drawdown > 3) {
                score = 0.5;
                message = `🟡 Leve pullback: BTC -${drawdown.toFixed(1)}%`;
            } else if (volatility > 10) {
                score = 1;
                message = `🟠 Alta volatilidade BTC: ${volatility.toFixed(1)}%`;
            } else {
                score = 0;
                message = `🟢 Mercado estável: BTC ${drawdown > 0 ? '-' : '+'}${Math.abs(drawdown).toFixed(1)}%`;
            }

            // Verificar tendência BTC
            const sma10 = this.calculateSMA(closes.slice(-10), 10);
            const sma20 = this.calculateSMA(closes.slice(-20), 20);
            
            if (sma10 && sma20 && currentPrice < sma10 && sma10 < sma20) {
                score += 1;
                message += ` | 📉 TENDÊNCIA DE BAIXA BTC`;
            } else if (sma10 && sma20 && currentPrice > sma10 && sma10 > sma20) {
                score -= 0.5;
                message += ` | 📈 TENDÊNCIA DE ALTA BTC`;
            }

            return {
                type: 'MARKET',
                score: Math.min(3, Math.max(0, score)),
                message: message,
                data: {
                    btcDrawdown: drawdown,
                    btcVolatility: volatility,
                    btcPrice: currentPrice,
                    btcTrend: sma10 && sma20 ? (currentPrice > sma10 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL'
                }
            };

        } catch (error) {
            return { type: 'MARKET', score: 1, message: 'Erro análise' };
        }
    }

    calculateSMA(data, period) {
        if (data.length < period) return null;
        const slice = data.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    async analyzeTrendRisk(signal) {
        try {
            const timeframes = ['5m', '15m', '1h'];
            let conflictingTrends = 0;
            let totalTrends = 0;
            let trendMessages = [];

            for (const tf of timeframes) {
                const candles = await getCandlesCached(signal.symbol, tf, 30);
                if (candles.length < 20) continue;

                const closes = candles.map(c => c.close);
                const sma10 = this.calculateSMA(closes, 10);
                const sma20 = this.calculateSMA(closes, 20);

                if (sma10 && sma20) {
                    const currentPrice = closes[closes.length - 1];
                    const isBullishTrend = currentPrice > sma10 && sma10 > sma20;
                    const isBearishTrend = currentPrice < sma10 && sma10 < sma20;

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

                if (conflictRatio > 0.75) {
                    score = 2;
                    message = `🔴 CONFLITO DE TENDÊNCIA (${conflictingTrends}/${totalTrends} timeframes)`;
                } else if (conflictRatio > 0.5) {
                    score = 1;
                    message = `🟠 Tendência conflitante (${conflictingTrends}/${totalTrends} timeframes)`;
                } else {
                    score = 0.5;
                    message = `🟡 Leve conflito (${conflictingTrends}/${totalTrends} timeframes)`;
                }

                if (trendMessages.length > 0) {
                    message += ` (${trendMessages.join(', ')})`;
                }
            } else {
                score = -0.5;
                message = `🟢 Tendências alinhadas (${totalTrends} timeframes)`;
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
            
            if (distancePercent < safeDistance * 0.3) {
                score = 2.5;
                message = `🔴 MUITO PRÓXIMO de pivot ${pivotType.toUpperCase()} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
            } else if (distancePercent < safeDistance * 0.6) {
                score = 1.5;
                message = `🟠 Próximo de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
            } else if (distancePercent < safeDistance) {
                score = 0.5;
                message = `🟡 Moderado de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
            } else {
                score = 0;
                message = `🟢 Boa distância de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
            }
            
            if (pivotData.nearestPivot.isTesting) {
                score += 1.5;
                message += ' | 🔴 TESTANDO PIVOT!';
            }
            
            if (pivotData.nearestPivot.timeframe) {
                const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotData.nearestPivot.timeframe] || 1.0;
                if (timeframeWeight >= 3.0) {
                    score += 0.5;
                    message += ` | PIVOT ${pivotData.nearestPivot.timeframe.toUpperCase()} (FORTE)`;
                }
            }
            
            // Se pivot é do mesmo tipo do sinal (suporte para compra, resistência para venda)
            if ((signal.isBullish && pivotType === 'support') || (!signal.isBullish && pivotType === 'resistance')) {
                score -= 0.5;
                message += ' | ✅ Pivot favorável';
            }
        }

        return {
            type: 'PIVOT',
            score: Math.min(3, Math.max(-1, score)),
            message: message,
            data: pivotData.nearestPivot || null
        };
    }

    determineRiskLevel(score) {
        if (score >= 10) return 'CRITICAL';
        if (score >= 6) return 'HIGH';
        if (score >= 3) return 'MEDIUM';
        return 'LOW';
    }

    calculateConfidence(assessment) {
        const maxScore = 20;
        const normalizedScore = Math.min(Math.max(assessment.overallScore, 0), maxScore);
        const confidence = 100 - (normalizedScore / maxScore) * 50; // Mais sensível

        return Math.max(50, Math.min(100, Math.round(confidence)));
    }

    generateRecommendations(assessment) {
        const recommendations = [];

        // BTC é a prioridade máxima
        assessment.factors.forEach(factor => {
            if (factor.type === 'BTC_CORRELATION') {
                if (factor.score <= -2) {
                    recommendations.push('🚀 ALTA CONFIANÇA: Performance excepcional vs BTC');
                    recommendations.push('• Posição máxima recomendada');
                    recommendations.push('• Stop loss padrão adequado');
                } else if (factor.score <= -1) {
                    recommendations.push('✅ BOA OPORTUNIDADE: Performance positiva vs BTC');
                    recommendations.push('• Posição normal OK');
                } else if (factor.score >= 2) {
                    recommendations.push('⚠️ ATENÇÃO: Altcoin performando MUITO PIOR que BTC');
                    recommendations.push('• Reduzir posição em 60%');
                    recommendations.push('• Stop loss mais apertado (1.2%)');
                    recommendations.push('• Aguardar recuperação relativa');
                } else if (factor.score >= 1) {
                    recommendations.push('🔶 CUIDADO: Altcoin fraca vs BTC');
                    recommendations.push('• Reduzir posição em 40%');
                    recommendations.push('• Stop loss conservador (1.5%)');
                }
            }
        });

        // Outras recomendações baseadas no nível de risco
        switch (assessment.level) {
            case 'CRITICAL':
                recommendations.push('🔴 RISCO CRÍTICO - EVITAR TRADE');
                recommendations.push('• Cancelar entrada');
                recommendations.push('• Aguardar condições melhores');
                break;

            case 'HIGH':
                recommendations.push('🟠 ALTO RISCO - EXTREMA CAUTELA');
                recommendations.push('• Reduzir posição em 70%');
                recommendations.push('• Stop loss muito apertado (1.0%)');
                recommendations.push('• Esperar confirmação adicional');
                break;

            case 'MEDIUM':
                recommendations.push('🟡 RISCO MODERADO - CAUTELA');
                recommendations.push('• Reduzir posição em 30%');
                recommendations.push('• Stop loss padrão (1.8%)');
                recommendations.push('• Aguardar confirmação parcial');
                break;

            case 'LOW':
                recommendations.push('🟢 RISCO BAIXO - CONFIANÇA');
                recommendations.push('• Posição normal OK');
                recommendations.push('• Stop loss padrão (2.2%)');
                recommendations.push('• Pode buscar alvos mais longos');
                break;
        }

        return recommendations;
    }

    generateWarnings(assessment) {
        const warnings = [];

        assessment.factors.forEach(factor => {
            if (factor.type === 'BTC_CORRELATION' && factor.score >= 2) {
                warnings.push(`🚨 ${factor.message}`);
            } else if (factor.type === 'BTC_MOMENTUM' && factor.score >= 2) {
                warnings.push(`⚡ ${factor.message}`);
            } else if (factor.type === 'BTC_TREND' && factor.score >= 2) {
                warnings.push(`🔄 ${factor.message}`);
            } else if (factor.score >= 2.5) {
                warnings.push(`🔴 ${factor.message}`);
            } else if (factor.score >= 2) {
                warnings.push(`🟠 ${factor.message}`);
            } else if (factor.score >= 1.5) {
                warnings.push(`🟡 ${factor.message}`);
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

        // Mostrar fatores BTC primeiro
        assessment.factors.forEach(factor => {
            if (factor.type.includes('BTC')) {
                console.log(`   ${factor.type}: ${factor.message}`);
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
// 🧠 SISTEMA DE APRENDIZADO COMPLETO COM FOCO EM BTC
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
            btcCorrelation: [],
            btcMomentum: [],
            btcTrend: []
        };

        this.learningEnabled = true;
        this.minTradesForLearning = 8;  // Reduzido de 10
        this.tradeTrackingHours = 6;    // Reduzido de 24

        this.trailingConfig = {
            timeframe: '3m',  // Reduzido de 5m
            candlesToSimulate: 200,
            partialTargets: [
                { percentage: 25, positionSize: 0.25 },
                { percentage: 50, positionSize: 0.25 },
                { percentage: 75, positionSize: 0.25 },
                { percentage: 100, positionSize: 0.25 }
            ],
            fees: 0.0004
        };

        this.btcCorrelationStats = {
            highOutperformWins: 0,
            highOutperformLosses: 0,
            underperformWins: 0,
            underperformLosses: 0,
            momentumWins: 0,
            momentumLosses: 0,
            trendAlignedWins: 0,
            trendAlignedLosses: 0
        };

        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado Avançado com FOCO EM BTC inicializado');
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
        const durationMs = candles.length * 3 * 60 * 1000; // 3 minutos por candle
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
                
                // Atualizar estatísticas BTC
                this.updateBTCCorrelationStats(trade, simulationResult);
                
            } else {
                await this.checkTradeOutcomeFallback(tradeId);
            }

        } catch (error) {
            console.error('Erro ao verificar outcome do trade:', error);
            await this.checkTradeOutcomeFallback(tradeId);
        }
    }

    updateBTCCorrelationStats(trade, simulationResult) {
        const btcData = trade.marketData.btcCorrelation;
        if (!btcData) return;

        const isWinner = simulationResult.netProfitPercentage > 0;
        const relativePerf = btcData.relativePerformance || 0;

        if (relativePerf >= 0.8) {
            if (isWinner) this.btcCorrelationStats.highOutperformWins++;
            else this.btcCorrelationStats.highOutperformLosses++;
        } else if (relativePerf <= -0.5) {
            if (isWinner) this.btcCorrelationStats.underperformWins++;
            else this.btcCorrelationStats.underperformLosses++;
        }

        const momentumData = trade.marketData.momentum;
        if (momentumData?.isSpiking && Math.abs(momentumData.priceChange) > 0.8) {
            if (isWinner) this.btcCorrelationStats.momentumWins++;
            else this.btcCorrelationStats.momentumLosses++;
        }

        const btcTrend = trade.marketData.btcCorrelation?.trend || 'NEUTRAL';
        const altTrend = relativePerf > 0 ? 'OUTPERFORMING' : 'UNDERPERFORMING';
        
        if ((trade.direction === 'BUY' && btcTrend === 'ACCELERATING' && altTrend === 'OUTPERFORMING') ||
            (trade.direction === 'SELL' && btcTrend === 'DECELERATING' && altTrend === 'UNDERPERFORMING')) {
            if (isWinner) this.btcCorrelationStats.trendAlignedWins++;
            else this.btcCorrelationStats.trendAlignedLosses++;
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
            recentScores: [],
            btcPerformanceStats: {
                highOutperformWins: 0,
                highOutperformTotal: 0,
                underperformWins: 0,
                underperformTotal: 0,
                momentumWins: 0,
                momentumTotal: 0
            }
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
        if (symbolStats.recentScores.length > 15) {
            symbolStats.recentScores = symbolStats.recentScores.slice(-15);
        }

        // Atualizar estatísticas BTC por símbolo
        const btcData = trade.marketData.btcCorrelation;
        if (btcData) {
            const relativePerf = btcData.relativePerformance || 0;
            
            if (relativePerf >= 0.8) {
                symbolStats.btcPerformanceStats.highOutperformTotal++;
                if (isSuccessful) symbolStats.btcPerformanceStats.highOutperformWins++;
            } else if (relativePerf <= -0.5) {
                symbolStats.btcPerformanceStats.underperformTotal++;
                if (isSuccessful) symbolStats.btcPerformanceStats.underperformWins++;
            }
            
            if (trade.marketData.momentum?.isSpiking) {
                symbolStats.btcPerformanceStats.momentumTotal++;
                if (isSuccessful) symbolStats.btcPerformanceStats.momentumWins++;
            }
        }

        this.symbolPerformance[trade.symbol] = symbolStats;
        this.openTrades.delete(trade.id || trade.timestamp);
        
        this.tradeHistory.push(trade);
        
        if (this.tradeHistory.length > 800) {
            this.tradeHistory = this.tradeHistory.slice(-400);
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
                    recentScores: [],
                    btcPerformanceStats: {
                        highOutperformWins: 0,
                        highOutperformTotal: 0,
                        underperformWins: 0,
                        underperformTotal: 0,
                        momentumWins: 0,
                        momentumTotal: 0
                    }
                };
            }

            if (this.tradeHistory.length % 8 === 0) { // Reduzido de 10
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

            const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(closedTrades);
            console.log(`📊 Análise BTC Correlation:`);
            console.log(`   High Outperform: ${btcCorrelationAnalysis.highOutperformWinRate.toFixed(1)}% win rate`);
            console.log(`   Underperform: ${btcCorrelationAnalysis.underperformWinRate.toFixed(1)}% win rate`);
            
            const momentumAnalysis = this.analyzeMomentumPatterns(closedTrades);
            console.log(`📊 Análise Momentum: ${momentumAnalysis.strongMomentumWinRate.toFixed(1)}% win rate`);

            const trendAnalysis = this.analyzeTrendPatterns(closedTrades);
            console.log(`📊 Análise Trend: ${trendAnalysis.trendAlignedWinRate.toFixed(1)}% win rate`);

            this.patterns.winning = {};
            this.patterns.losing = {};

            // Aprender padrões com foco em BTC
            closedTrades.forEach(trade => {
                const patterns = this.extractPatterns(trade);
                const isWinner = trade.outcome === 'SUCCESS' || 
                               trade.outcome === 'ALL_TARGETS_HIT' || 
                               trade.outcome === 'PARTIAL_TARGETS_HIT';
                
                patterns.forEach(pattern => {
                    if (isWinner) {
                        this.patterns.winning[pattern] = (this.patterns.winning[pattern] || 0) + 1;
                    } else {
                        this.patterns.losing[pattern] = (this.patterns.losing[pattern] || 0) + 1;
                    }
                });
            });

            if (closedTrades.length >= this.minTradesForLearning) {
                await this.optimizeParameters(closedTrades);
            }

        } catch (error) {
            console.error('Erro na análise de padrões:', error);
        }
    }

    analyzeTrendPatterns(trades) {
        const trendAlignedWinners = [];
        const trendAlignedLosers = [];
        const trendDivergentWinners = [];
        const trendDivergentLosers = [];

        trades.forEach(trade => {
            const btcData = trade.marketData.btcCorrelation;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

            if (btcData?.trend === 'ACCELERATING' && trade.direction === 'BUY') {
                if (isWinner) trendAlignedWinners.push(trade);
                else trendAlignedLosers.push(trade);
            } else if (btcData?.trend === 'DECELERATING' && trade.direction === 'SELL') {
                if (isWinner) trendAlignedWinners.push(trade);
                else trendAlignedLosers.push(trade);
            } else {
                if (isWinner) trendDivergentWinners.push(trade);
                else trendDivergentLosers.push(trade);
            }
        });

        return {
            trendAlignedWinners,
            trendAlignedLosers,
            trendDivergentWinners,
            trendDivergentLosers,
            trendAlignedWinRate: trendAlignedWinners.length / (trendAlignedWinners.length + trendAlignedLosers.length) || 0
        };
    }

    analyzeBTCCorrelationPatterns(trades) {
        const highOutperformWinners = [];
        const highOutperformLosers = [];
        const underperformWinners = [];
        const underperformLosers = [];
        const neutralWinners = [];
        const neutralLosers = [];

        trades.forEach(trade => {
            const btcCorrelation = trade.marketData.btcCorrelation;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

            if (btcCorrelation?.relativePerformance >= 0.8) {
                if (isWinner) highOutperformWinners.push(trade);
                else highOutperformLosers.push(trade);
            } else if (btcCorrelation?.relativePerformance <= -0.5) {
                if (isWinner) underperformWinners.push(trade);
                else underperformLosers.push(trade);
            } else {
                if (isWinner) neutralWinners.push(trade);
                else neutralLosers.push(trade);
            }
        });

        return {
            highOutperformWinners,
            highOutperformLosers,
            underperformWinners,
            underperformLosers,
            neutralWinners,
            neutralLosers,
            highOutperformWinRate: highOutperformWinners.length / (highOutperformWinners.length + highOutperformLosers.length) || 0,
            underperformWinRate: underperformWinners.length / (underperformWinners.length + underperformLosers.length) || 0
        };
    }

    analyzeMomentumPatterns(trades) {
        const strongMomentumWinners = [];
        const strongMomentumLosers = [];
        const weakMomentumWinners = [];
        const weakMomentumLosers = [];

        trades.forEach(trade => {
            const momentum = trade.marketData.momentum;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';

            if (momentum?.isSpiking && Math.abs(momentum.priceChange) > 0.8) {
                if (isWinner) strongMomentumWinners.push(trade);
                else strongMomentumLosers.push(trade);
            } else {
                if (isWinner) weakMomentumWinners.push(trade);
                else weakMomentumLosers.push(trade);
            }
        });

        return {
            strongMomentumWinners,
            strongMomentumLosers,
            weakMomentumWinners,
            weakMomentumLosers,
            strongMomentumWinRate: strongMomentumWinners.length / (strongMomentumWinners.length + strongMomentumLosers.length) || 0
        };
    }

    extractPatterns(trade) {
        const patterns = [];
        const data = trade.marketData;

        // Padrões BTC (prioridade máxima)
        if (data.btcCorrelation?.relativePerformance >= 0.8) {
            patterns.push('HIGH_OUTPERFORM_BTC');
        } else if (data.btcCorrelation?.relativePerformance <= -0.5) {
            patterns.push('HIGH_UNDERPERFORM_BTC');
        } else if (data.btcCorrelation?.relativePerformance >= 0.4) {
            patterns.push('MODERATE_OUTPERFORM_BTC');
        }

        if (data.btcCorrelation?.trend === 'ACCELERATING' && trade.direction === 'BUY') {
            patterns.push('BTC_TREND_ALIGNED_BUY');
        } else if (data.btcCorrelation?.trend === 'DECELERATING' && trade.direction === 'SELL') {
            patterns.push('BTC_TREND_ALIGNED_SELL');
        }

        // Padrões de momentum
        if (data.momentum?.isSpiking) {
            if (Math.abs(data.momentum.priceChange) > 1.2) {
                patterns.push('EXTREME_MOMENTUM');
            } else if (Math.abs(data.momentum.priceChange) > 0.8) {
                patterns.push('STRONG_MOMENTUM');
            } else {
                patterns.push('MODERATE_MOMENTUM');
            }
        }

        // Padrões de volume
        if (data.volumeRobust?.combinedScore >= 0.7) {
            patterns.push('ROBUST_VOLUME');
        }
        if (data.volumeRatio >= 2.0 && data.rsi <= RSI_BUY_MAX) {
            patterns.push('HIGH_VOL_GOOD_RSI');
        }

        // Padrões técnicos tradicionais
        if ((trade.direction === 'BUY' && data.rsi >= 25 && data.rsi <= RSI_BUY_MAX) ||
            (trade.direction === 'SELL' && data.rsi >= RSI_SELL_MIN && data.rsi <= 75)) {
            patterns.push('RSI_IDEAL');
        }

        if (data.supportResistance?.nearestSupport?.distancePercent <= 1.0) {
            patterns.push('NEAR_SUPPORT');
        }
        if (data.supportResistance?.nearestResistance?.distancePercent <= 1.0) {
            patterns.push('NEAR_RESISTANCE');
        }

        if (data.pivotPoints?.nearestPivot?.distancePercent <= 0.8) {
            patterns.push(`NEAR_PIVOT_${data.pivotPoints.nearestPivot.type.toUpperCase()}`);
        }

        return patterns;
    }

    async optimizeParameters(closedTrades) {
        try {
            const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(closedTrades);
            
            if (btcCorrelationAnalysis.highOutperformWinRate > 0.65) {
                this.parameterEvolution.btcCorrelation.push({
                    timestamp: Date.now(),
                    message: 'Altcoins com alta performance vs BTC têm melhor win rate',
                    winRate: btcCorrelationAnalysis.highOutperformWinRate,
                    sampleSize: btcCorrelationAnalysis.highOutperformWinners.length + btcCorrelationAnalysis.highOutperformLosers.length
                });
                console.log('✅ BTC Correlation: High outperform win rate: ' + (btcCorrelationAnalysis.highOutperformWinRate * 100).toFixed(1) + '%');
            }

            if (btcCorrelationAnalysis.underperformWinRate > 0.65) {
                this.parameterEvolution.btcCorrelation.push({
                    timestamp: Date.now(),
                    message: 'Altcoins underperforming vs BTC têm boa win rate para vendas',
                    winRate: btcCorrelationAnalysis.underperformWinRate,
                    sampleSize: btcCorrelationAnalysis.underperformWinners.length + btcCorrelationAnalysis.underperformLosers.length
                });
                console.log('✅ BTC Correlation: Underperform win rate: ' + (btcCorrelationAnalysis.underperformWinRate * 100).toFixed(1) + '%');
            }

            const momentumAnalysis = this.analyzeMomentumPatterns(closedTrades);
            if (momentumAnalysis.strongMomentumWinRate > 0.65) {
                this.parameterEvolution.btcMomentum.push({
                    timestamp: Date.now(),
                    message: 'Trades com momentum forte têm melhor win rate',
                    winRate: momentumAnalysis.strongMomentumWinRate,
                    sampleSize: momentumAnalysis.strongMomentumWinners.length + momentumAnalysis.strongMomentumLosers.length
                });
                console.log('✅ Momentum: Strong momentum win rate: ' + (momentumAnalysis.strongMomentumWinRate * 100).toFixed(1) + '%');
            }

            const trendAnalysis = this.analyzeTrendPatterns(closedTrades);
            if (trendAnalysis.trendAlignedWinRate > 0.65) {
                this.parameterEvolution.btcTrend.push({
                    timestamp: Date.now(),
                    message: 'Trades alinhados com tendência BTC têm melhor win rate',
                    winRate: trendAnalysis.trendAlignedWinRate,
                    sampleSize: trendAnalysis.trendAlignedWinners.length + trendAnalysis.trendAlignedLosers.length
                });
                console.log('✅ BTC Trend: Aligned trend win rate: ' + (trendAnalysis.trendAlignedWinRate * 100).toFixed(1) + '%');
            }

            // Ajustar thresholds baseado no aprendizado
            if (btcCorrelationAnalysis.highOutperformWinRate > 0.7) {
                // Aumentar sensibilidade para high outperform
                BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance = Math.max(0.6, 
                    BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance * 0.9);
                console.log('⚡ Ajustado threshold strongOutperformance para ' + BTC_CORRELATION_SETTINGS.thresholds.strongOutperformance.toFixed(2) + '%');
            }

            this.saveLearningData();

        } catch (error) {
            console.error('Erro na otimização:', error);
        }
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
                this.btcCorrelationStats = data.btcCorrelationStats || this.btcCorrelationStats;

                console.log(`📊 Aprendizado: ${this.tradeHistory.length} trades carregados`);
                
                this.fixPatternCounts();
                
                // Logar aprendizados importantes
                if (this.patterns.winning.HIGH_OUTPERFORM_BTC > 5) {
                    console.log('✅ Padrão aprendido: HIGH_OUTPERFORM_BTC é VENCEDOR (' + this.patterns.winning.HIGH_OUTPERFORM_BTC + ' trades)');
                }
                if (this.patterns.winning.HIGH_UNDERPERFORM_BTC > 5) {
                    console.log('✅ Padrão aprendido: HIGH_UNDERPERFORM_BTC é VENCEDOR para vendas (' + this.patterns.winning.HIGH_UNDERPERFORM_BTC + ' trades)');
                }
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados de aprendizado:', error.message);
            this.tradeHistory = [];
            this.symbolPerformance = {};
            this.patterns = { winning: {}, losing: {} };
            this.parameterEvolution = this.parameterEvolution;
            this.btcCorrelationStats = this.btcCorrelationStats;
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
                tradeHistory: this.tradeHistory.slice(-300),
                symbolPerformance: this.symbolPerformance,
                patterns: {
                    winning: this.patterns.winning,
                    losing: this.patterns.losing
                },
                parameterEvolution: this.parameterEvolution,
                btcCorrelationStats: this.btcCorrelationStats,
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

        const btcCorrelationAnalysis = this.analyzeBTCCorrelationPatterns(validClosedTrades);
        const momentumAnalysis = this.analyzeMomentumPatterns(validClosedTrades);
        const trendAnalysis = this.analyzeTrendPatterns(validClosedTrades);

        return {
            totalTrades: validClosedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate * 100,
            profitFactor: profitFactor.toFixed(2),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            btcCorrelationAnalysis: {
                highOutperformWinRate: (btcCorrelationAnalysis.highOutperformWinRate * 100).toFixed(1),
                highOutperformTrades: btcCorrelationAnalysis.highOutperformWinners.length + btcCorrelationAnalysis.highOutperformLosers.length,
                underperformWinRate: (btcCorrelationAnalysis.underperformWinRate * 100).toFixed(1),
                underperformTrades: btcCorrelationAnalysis.underperformWinners.length + btcCorrelationAnalysis.underperformLosers.length
            },
            momentumAnalysis: {
                strongMomentumWinRate: (momentumAnalysis.strongMomentumWinRate * 100).toFixed(1),
                strongMomentumTrades: momentumAnalysis.strongMomentumWinners.length + momentumAnalysis.strongMomentumLosers.length
            },
            trendAnalysis: {
                trendAlignedWinRate: (trendAnalysis.trendAlignedWinRate * 100).toFixed(1),
                trendAlignedTrades: trendAnalysis.trendAlignedWinners.length + trendAnalysis.trendAlignedLosers.length
            },
            openTrades: this.openTrades.size,
            monitoredSymbols: Object.keys(this.symbolPerformance).length,
            btcCorrelationStats: this.btcCorrelationStats
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
    const btcCorrelation = signal.marketData.btcCorrelation?.relativePerformance || 0;
    const momentum = signal.marketData.momentum;
    const volumeScore = signal.marketData.volume?.robustData?.combinedScore || 0;
    const rsiValue = signal.marketData.rsi?.value || 50;
    
    // PRIORIDADE 1: BTC CORRELATION
    if (btcCorrelation >= 0.8) {
        return {
            type: 'BTC HIGH PERFORMANCE',
            reason: 'Altcoin liderando vs BTC',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🚀'
        };
    }
    
    if (btcCorrelation <= -0.5 && !signal.isBullish) {
        return {
            type: 'BTC UNDERPERFORMANCE',
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
// 📤 FUNÇÃO PRINCIPAL PARA ENVIAR ALERTAS - VERSÃO CORRIGIDA
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        const analysisType = determineAnalysisType(signal);
        
        const direction = signal.isBullish ? '🟢Reversão / Compra' : '🔴Correção';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        const baseProbability = calculateProbability(signal);
        const riskAdjustedProbability = Math.max(30, Math.min(95, baseProbability - (riskAssessment.overallScore * 1.5)));

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
        const trend = btcCorrelationData?.trend || 'NEUTRAL';
        
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
        
        if (trend !== 'NEUTRAL') {
            btcPerformanceText += trend === 'ACCELERATING' ? ' (Acelerando)' : ' (Desacelerando)';
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
            alertTitle = `${analysisType.emoji} ${signal.symbol} - ${analysisType.type}`;
            alertType = 'analysis';
        }

        const now = getBrazilianDateTime();

        // CONSTRUIR MENSAGEM SIMPLIFICADA E SEGURA
        let message = `${alertTitle}\n`;
        message += `${now.date} ${now.time}\n\n`;
        message += `${analysisType.reason}\n`;
        message += `${btcPerformanceEmoji} ${btcPerformanceText}${momentumText}\n\n`;
        message += `Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})\n`;
        message += `Probabilidade: ${riskAdjustedProbability.toFixed(1)}%\n`;
        message += `Preço: ${signal.price.toFixed(8)} BTC\n\n`;
        message += `Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})\n`;
        message += `Dist. S/R: ${distancePercent}%\n`;
        message += `RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}\n\n`;
        
        if (alertType === 'trade') {
            message += `Risco: ${riskAssessment.level}\n`;
            message += `Confiança: ${riskAssessment.confidence}%\n\n`;
        }
        
        message += `Titanium Pares BTC by @J4Rviz`;

        console.log(`\n📤 Tentando enviar ${alertType} para ${signal.symbol}...`);
        console.log(`Mensagem preview:`);
        console.log(message.substring(0, 200) + '...');

        await sendTelegramAlert(message);

        console.log(`✅ ${alertType === 'trade' ? 'Alerta de TRADE' : 'Análise'} enviado: ${signal.symbol}`);
        console.log(`   Tipo: ${analysisType.type}`);
        console.log(`   BTC Performance: ${relativePerformance.toFixed(2)}% (${performanceLevel})`);
        console.log(`   Score: ${signal.qualityScore.score}/100`);
        console.log(`   Probabilidade: ${riskAdjustedProbability.toFixed(1)}%`);
        console.log(`   Risco: ${riskAssessment.level} (Confiança: ${riskAssessment.confidence}%)`);

        return {
            type: alertType,
            analysisType: analysisType.type,
            volumeConfirmed: isVolumeConfirmed,
            btcPerformance: relativePerformance,
            priority: priority
        };

    } catch (error) {
        console.error('Erro ao enviar alerta com risk layer:', error.message);
        
        // Tentar versão simplificada como fallback
        try {
            const now = getBrazilianDateTime();
            const simpleMessage = `${signal.symbol} - ${signal.isBullish ? '🟢Reversão / Compra' : '🔴Correção'}\n${now.date} ${now.time}\nScore: ${signal.qualityScore.score}/100\nPreço: ${signal.price.toFixed(8)} BTC\n\nTitanium Pares BTC`;
            await sendTelegramAlert(simpleMessage);
            console.log('✅ Alerta simplificado enviado como fallback');
        } catch (fallbackError) {
            console.error('❌ Fallback também falhou:', fallbackError.message);
        }
        
        return await sendSignalAlert(signal);
    }
}

// =====================================================================
// 📤 FUNÇÃO sendTelegramAlert CORRIGIDA
// =====================================================================

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        // LIMPAR MENSAGEM PARA EVITAR PROBLEMAS COM O TELEGRAM
        const cleanMessage = message
            .replace(/[`*_\[\]()~>#+=|{}.!-]/g, ' ') // Remover caracteres especiais problemáticos
            .replace(/<b>/g, '')
            .replace(/<\/b>/g, '')
            .replace(/<i>/g, '')
            .replace(/<\/i>/g, '')
            .replace(/<[^>]*>/g, '') // Remover qualquer tag HTML
            .replace(/\n\s*\n\s*\n/g, '\n\n') // Remover linhas vazias extras
            .trim();

        // VERIFICAR TAMANHO DA MENSAGEM
        if (cleanMessage.length > 4000) {
            console.log('⚠️ Mensagem muito longa, truncando...');
            const truncatedMessage = cleanMessage.substring(0, 3900) + '...\n\n[Mensagem truncada]';
            return await sendTelegramMessage(url, truncatedMessage, controller, timeoutId);
        }

        return await sendTelegramMessage(url, cleanMessage, controller, timeoutId);

    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

async function sendTelegramMessage(url, message, controller, timeoutId) {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown', // Usar Markdown V2 que é mais seguro
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ HTTP ${response.status}: ${errorText}`);
            
            // Tentar sem parse_mode se falhar
            if (errorText.includes('parse')) {
                console.log('⚠️ Tentando enviar sem parse_mode...');
                const retryResponse = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: TELEGRAM_CHAT_ID,
                        text: message.replace(/[\\*_`\[\]()~>#+=|{}.!-]/g, '\\$&'),
                        disable_web_page_preview: true
                    }),
                    signal: AbortSignal.timeout(8000)
                });
                
                if (retryResponse.ok) {
                    console.log('✅ Mensagem enviada sem parse_mode');
                    return true;
                }
            }
            
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log('✅ Mensagem enviada para Telegram com sucesso!');
        logToFile(`📤 Alerta REAL enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro no envio da mensagem:', error.message);
        throw error;
    }
}

// =====================================================================
// 🔍 FUNÇÃO determineAnalysisType ATUALIZADA
// =====================================================================

function determineAnalysisType(signal) {
    const btcCorrelation = signal.marketData.btcCorrelation?.relativePerformance || 0;
    const momentum = signal.marketData.momentum;
    const volumeScore = signal.marketData.volume?.robustData?.combinedScore || 0;
    const rsiValue = signal.marketData.rsi?.value || 50;
    
    // PRIORIDADE 1: BTC CORRELATION
    if (btcCorrelation >= 0.8) {
        return {
            type: 'BTC HIGH PERFORMANCE',
            reason: 'Altcoin liderando vs BTC',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🚀'
        };
    }
    
    if (btcCorrelation <= -0.5 && !signal.isBullish) {
        return {
            type: 'BTC UNDERPERFORMANCE',
            reason: 'Altcoin fraca vs BTC (bom para venda)',
            direction: 'VENDA',
            emoji: '📉'
        };
    }
    
    // PRIORIDADE 2: MOMENTUM
    if (momentum?.isSpiking && Math.abs(momentum.priceChange) > 0.8) {
        return {
            type: 'MOMENTUM RAPIDO',
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
            reason: 'RSI em zona de reversao',
            direction: signal.isBullish ? 'COMPRA' : 'VENDA',
            emoji: '🔄'
        };
    }
    
    return {
        type: 'ANALISE TECNICA',
        reason: 'Sinal tecnico padrao',
        direction: signal.isBullish ? 'COMPRA' : 'VENDA',
        emoji: '📊'
    };
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
        
        const direction = signal.isBullish ? '🟢Reversão / Compra' : '🔴Correção';
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

        let message = `
${alertTitle}
${now.date} ${now.time}

📊 ${analysisType.reason}
${btcPerformanceEmoji} ${btcPerformanceText}${momentumText}

⚡ Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
🎯 Probabilidade: ${baseProbability.toFixed(1)}%
💰 Preço: ${signal.price.toFixed(8)} BTC

📈 Volume: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification})
📊 Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
📍 Dist. S/R: ${distancePercent}%
⚖️ Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
📉 RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}

✨Titanium Pares BTC by @J4Rviz✨
        `;

        await sendTelegramAlert(message);

        console.log(`📤 ${isVolumeConfirmed ? 'Alerta de TRADE' : 'Análise'} enviado: ${signal.symbol}`);
        console.log(`   Tipo: ${analysisType.type}`);
        console.log(`   BTC Performance: ${relativePerformance.toFixed(2)}%`);
        console.log(`   Score: ${signal.qualityScore.score}/100`);

    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

function calculateProbability(signal) {
    let baseProbability = 65;

    baseProbability += (signal.qualityScore.score - 60) * 0.5; // Mais sensível

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

        const validTargets = targets.filter(t => parseFloat(t.riskReward) >= 1.2); // Reduzido de 1.5
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

async function checkCCI4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 45);
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

    // 9. CCI 4H
    if (marketData.cci4h && marketData.cci4h.isValid) {
        const cci4hScore = QUALITY_WEIGHTS.cci4h;
        score += cci4hScore;
        details.push(` 📊 CCI 4h: ${cci4hScore}/${QUALITY_WEIGHTS.cci4h} (${marketData.cci4h.value.toFixed(2)} ${isBullish ? '>' : '<'} ${marketData.cci4h.maValue.toFixed(2)})`);
    } else {
        failedChecks.push(`CCI 4h: ${marketData.cci4h?.value?.toFixed(2) || 0} ${isBullish ? '≤' : '≥'} ${marketData.cci4h?.maValue?.toFixed(2) || 0}`);
    }

    // 10. BREAKOUT RISK
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

    // 11. SUPPORT/RESISTANCE
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

    // 12. PIVOT POINTS
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

    // 13. MOMENTUM
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

    // 14. VOLUME CONFIRMAÇÃO
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
            await new Promise(r => setTimeout(r, 120)); // Reduzido de 150
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
                    const alertResult = await sendSignalAlertWithRisk(signal);
                    if (alertResult && alertResult.type === 'analysis') {
                        totalAnalysis++;
                    }
                    await new Promise(r => setTimeout(r, 600)); // Reduzido de 800
                }
            }

            cleanupCaches();

            if (Date.now() - lastReportTime >= 1800000) { // 30 minutos
                await learningSystem.sendPerformanceReport();
                lastReportTime = Date.now();
            }

            if (Date.now() - lastRiskReportTime >= 3 * 60 * 60 * 1000) { // 3 horas
                await sendMarketRiskReport();
                lastRiskReportTime = Date.now();
            }

            const status = symbolManager.getCurrentStatus();
            console.log(`📊 Progresso: ${status.consecutiveNoSignals} grupos sem sinais | BTC High Perf: ${totalBTCHighPerformance}`);

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

        const message = `
🧠 RELATÓRIO DE PERFORMANCE VS BTC
${now.full}

• Trades Totais: ${report.totalTrades}
• Taxa de Acerto: ${report.winRate.toFixed(1)}%
• Fator de Lucro: ${report.profitFactor}
• Lucro Médio: ${report.avgProfit}% | Perda Média: ${report.avgLoss}%

🚀 Análise Performance vs BTC:
• High Outperform Win Rate: ${report.btcCorrelationAnalysis.highOutperformWinRate}%
• High Outperform Trades: ${report.btcCorrelationAnalysis.highOutperformTrades}
• Underperform Win Rate: ${report.btcCorrelationAnalysis.underperformWinRate}%
• Underperform Trades: ${report.btcCorrelationAnalysis.underperformTrades}

⚡ Análise Momentum:
• Strong Momentum Win Rate: ${report.momentumAnalysis.strongMomentumWinRate}%
• Strong Momentum Trades: ${report.momentumAnalysis.strongMomentumTrades}

📊 Análise Trend:
• Trend Aligned Win Rate: ${report.trendAnalysis.trendAlignedWinRate}%
• Trend Aligned Trades: ${report.trendAnalysis.trendAlignedTrades}

📈 Sinais Abertos: ${report.openTrades}
📊 Símbolos Monitorados: ${report.monitoredSymbols}

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
                btcMomentum: [],
                btcTrend: []
            },
            btcCorrelationStats: {
                highOutperformWins: 0,
                highOutperformLosses: 0,
                underperformWins: 0,
                underperformLosses: 0,
                momentumWins: 0,
                momentumLosses: 0,
                trendAlignedWins: 0,
                trendAlignedLosses: 0
            },
            lastUpdated: Date.now(),
            trailingConfig: learningSystem.trailingConfig,
            resetTimestamp: Date.now(),
            resetNote: 'Sistema resetado com FOCO EM BTC'
        };
        
        fs.writeFileSync(learningFile, JSON.stringify(cleanData, null, 2));
        
        console.log('✅ Dados de aprendizado resetados com sucesso!');
        console.log('📊 Novo sistema com FOCO EM BTC ativado.');
        
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
        console.log('🔥 TITANIUM SPOT BTC - FOCO EM PERFORMANCE VS BTC');
        console.log(`📈 RSI: Compra ≤ ${RSI_BUY_MAX}, Venda ≥ ${RSI_SELL_MIN}`);
        console.log(`⚡ Momentum: Detecção ultra-rápida 1m-3m`);
        console.log(`🎯 BTC Correlation: Prioridade máxima`);
        console.log(`🚀 Sensibilidade: Aumentada para sinais rápidos`);
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
            await new Promise(r => setTimeout(r, 2000));
        }

        if (!connected) {
            console.log('❌ Sem conexão com a Binance');
            process.exit(1);
        }

        global.riskLayer = new SophisticatedRiskLayer();
        console.log('🛡️  Risk Layer Sofisticado ativado com FOCO EM BTC');

        console.log('✅ Tudo pronto! Iniciando monitoramento com FOCO EM BTC...');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 30 segundos...');
        await new Promise(r => setTimeout(r, 30000));
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

// Iniciar
startBot();
