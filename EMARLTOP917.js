const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D';
const TELEGRAM_CHAT_ID = '-100199';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE VOLUME MÍNIMO ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.25,          // ↓ Reduzido para permitir sinais com volume inicial mais fraco
    combinedScore: 0.3,           // ↓ Flexibilizado levemente
    classification: 'BAIXO',      // ✅ Aceita até "BAIXO" se outros fatores confirmarem
    requireConfirmation: true     // Mantido – confirmação ainda obrigatória
};

// === CONFIGURAÇÕES OTIMIZADAS BASEADAS NO APRENDIZADO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.8,           // ⬇️ Mais sensível a setups de qualidade
    minThreshold: 1.5,            // ⬇️ Aceita movimentos iniciais suaves
    maxThreshold: 2.9,            // ⬆️ Captura pumps reais sem cortar
    volatilityMultiplier: 0.35,   // ⬆️ Melhor adaptação em alta volatilidade
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO ATUALIZADAS PARA 3m ===
const VOLUME_ROBUST_SETTINGS = {
    // Média Móvel Exponencial (EMA) do Volume
    emaPeriod: 20,
    emaAlpha: 0.26,               // ↑ Levemente mais responsivo

    // Z-Score do Volume com lookback adaptativo
    baseZScoreLookback: 40,       // ↓ Responde mais rápido a mudanças
    minZScoreLookback: 12,        // ↓ Reação ágil em alta volatilidade
    maxZScoreLookback: 80,        // ↓ Evita over-smoothing
    zScoreThreshold: 1.7,         // ↓ Aceita volumes "acima do normal"

    // Volume-Price Trend (VPT)
    vptThreshold: 0.35,           // ↓ Aceita micro-movimentos com volume
    minPriceMovement: 0.10,       // ↓ Mais sensível a movimentos menores

    // Configurações combinadas – pesos ajustados
    combinedMultiplier: 1.12,
    volumeWeight: 0.33,
    emaWeight: 0.37,              // ↑ Prioriza EMA (sinal mais confiável)
    zScoreWeight: 0.2,
    vptWeight: 0.1,

    // Thresholds mínimos – MAIS FLEXÍVEIS, MAS NÃO PERMISSIVOS
    minimumThresholds: {
        combinedScore: 0.20,      // ✅ Principal ajuste: permite volume "fraco-moderado"
        emaRatio: 1.1,            // ↓ Aceita setups iniciais mais cedo
        zScore: 0.3,              // ↓ Filtra ruído, mas capta variações normais
        classification: 'BAIXO'   // ✅ Aceita classificação "BAIXO" com confirmação cruzada
    }
};

const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.6; // ⬇️ Permite operar em mais ativos com volatilidade moderada

// === CONFIGURAÇÕES LSR AJUSTADAS ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;

// === ATUALIZADO: CONFIGURAÇÕES RSI ===
const RSI_BUY_MAX = 60; 
const RSI_SELL_MIN = 65;

const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,
    oppositeDirection: 10 * 60 * 1000,
    useDifferentiated: true
};

// === QUALITY SCORE AJUSTADO PARA MAIOR LUCRATIVIDADE ===
const QUALITY_THRESHOLD = 75; // ⬇️ Aumenta número de alertas com boa qualidade
const QUALITY_WEIGHTS = {
    volume: 38,          // ↑ +3 → volume robusto é seu principal filtro
    oi: 10,              // ↓ -2 → Open Interest menos crítico
    volatility: 8,       // ↓ -2 → volatilidade é contexto, não sinal
    lsr: 10,             // mantido
    rsi: 12,             // ↑ +2 → RSI ideal altamente lucrativo
    emaAlignment: 14,    // ↑ +2 → alinhamento de EMA é sinal forte
    stoch1h: 8,          // mantido
    stoch4h: 4,          // ↓ -1 → secundário
    cci4h: 6,            // ↓ -2 → útil, mas não essencial
    breakoutRisk: 14,    // ↑ +2 → evitar rompimentos falsos aumenta win rate
    supportResistance: 14, // ↑ +2 → distância segura = maior margem
    pivotPoints: 12,     // mantido
    funding: 10          // mantido
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
    // Configurações de força por timeframe
    timeframeStrengthWeights: {
        '15m': 1.0,   // Pivot fraco (15 minutos)
        '1H': 2.0,    // Pivot moderado (1 hora)
        '✨4H': 3.0,    // Pivot forte (4 horas)
        '✨1D': 5.0     // Pivot muito forte (diário)
    },
    // Distâncias seguras baseadas na força do pivot
    safeDistanceMultipliers: {
        'Fraco': 0.5,      // Pivot fraco: precisa de 0.5% de distância
        'Moderado': 1.0,  // Pivot moderado: precisa de 1.0% de distância
        'Forte': 1.5,    // Pivot forte: precisa de 1.5% de distância
        'Muito Forte': 2.0 // Pivot muito forte: precisa de 2.0% de distância
    },
    // Configurações de detecção
    minDistance: 5,        // Distância mínima entre pivots (velas)
    priceTolerance: 0.005, // Tolerância de preço para considerar toque (0.5%)
    // Configurações de análise
    analyzeTimeframes: ['15m', '1h', '4h'], // Timeframes a serem analisados
    candlesPerTimeframe: {
        '15m': 70,  // ~17.5 horas
        '1h': 100,  // ~4 dias
        '4h': 120   // ~20 dias
    }
};

// === NOVAS CONFIGURAÇÕES PARA STOCHASTIC 12H E DIÁRIO (5.3.3) ===
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

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const CANDLE_CACHE_TTL = 60000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 2 * 60 * 1000;
const OI_HISTORY_SIZE = 20;

// === ATUALIZADO: CONFIGURAÇÕES TÉCNICAS ===

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
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO (NÃO-BLOQUEANTE) - CORRIGIDO
// =====================================================================

class SophisticatedRiskLayer {
    constructor() {
        // CORREÇÃO: Atualizado para usar chaves em português
        this.riskLevels = {
            'BAIXO': { emoji: '🟢', score: 0, action: 'high_confidence' },
            'MEDIANO': { emoji: '🟡', score: 1, action: 'caution_advised' },
            'ALTO': { emoji: '🟠', score: 2, action: 'extreme_caution' },
            'CRÍTICO': { emoji: '🔴', score: 3, action: 'consider_avoiding' }
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
            RSI_EXTREME_RISK: { weight: 1.5 },
            STOCHASTIC_TREND_RISK: { weight: 1.1 }
        };

        this.riskHistory = new Map();
        this.maxHistorySize = 100;

        console.log('🛡️  Risk Layer Sofisticado inicializado');
    }

    async assessSignalRisk(signal) {
        try {
            const riskAssessment = {
                overallScore: 0,
                level: 'BAIXO',
                factors: [],
                warnings: [],
                recommendations: [],
                confidence: 100,
                shouldAlert: true,
                shouldBlock: false
            };

            // Verificar risco de RSI extremo primeiro
            const rsiExtremeRisk = this.analyzeRSIExtremeRisk(signal);
            riskAssessment.factors.push(rsiExtremeRisk);
            riskAssessment.overallScore += rsiExtremeRisk.score * this.riskFactors.RSI_EXTREME_RISK.weight;

            // Adicionar análise de tendência do Stochastic
            const stochasticTrendRisk = await this.analyzeStochasticTrendRisk(signal);
            riskAssessment.factors.push(stochasticTrendRisk);
            riskAssessment.overallScore += stochasticTrendRisk.score * this.riskFactors.STOCHASTIC_TREND_RISK.weight;

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

    async analyzeStochasticTrendRisk(signal) {
        try {
            // Analisar tendências maiores usando Stochastic 12h e Diário
            const stoch12hData = await checkStochasticWithTimeframe(
                signal.symbol, 
                signal.isBullish, 
                STOCHASTIC_12H_SETTINGS
            );
            
            const stochDailyData = await checkStochasticWithTimeframe(
                signal.symbol,
                signal.isBullish,
                STOCHASTIC_DAILY_SETTINGS
            );

            let score = 0;
            let message = '';
            let trendDirection = '';

            // Determinar tendência com base nos timeframes maiores
            if (stochDailyData.isValid) {
                if (signal.isBullish && stochDailyData.kValue > stochDailyData.dValue) {
                    score -= 0.5; // Tendência de alta confirmada - risco reduzido
                    trendDirection = 'ALTA (Diário)';
                } else if (!signal.isBullish && stochDailyData.kValue < stochDailyData.dValue) {
                    score -= 0.5; // Tendência de baixa confirmada - risco reduzido
                    trendDirection = 'BAIXA (Diário)';
                } else {
                    score += 1; // Tendência contrária
                    trendDirection = 'CONTRÁRIA (Diário)';
                }
            }

            if (stoch12hData.isValid) {
                if (signal.isBullish && stoch12hData.kValue > stoch12hData.dValue) {
                    score -= 0.3; // Tendência de alta 12h confirmada
                    trendDirection += trendDirection ? ' + ALTA (12h)' : 'ALTA (12h)';
                } else if (!signal.isBullish && stoch12hData.kValue < stoch12hData.dValue) {
                    score -= 0.3; // Tendência de baixa 12h confirmada
                    trendDirection += trendDirection ? ' + BAIXA (12h)' : 'BAIXA (12h)';
                } else {
                    score += 0.5; // Tendência contrária 12h
                    trendDirection += trendDirection ? ' + CONTRÁRIA (12h)' : 'CONTRÁRIA (12h)';
                }
            }

            if (stoch12hData.lastCross) {
                message += `Cruzamento ${stoch12hData.lastCross.direction} 12h: ${stoch12hData.lastCross.kValue.toFixed(1)}/${stoch12hData.lastCross.dValue.toFixed(1)} às ${stoch12hData.lastCross.time}`;
            }

            if (stochDailyData.lastCross) {
                if (message) message += ' | ';
                message += `Cruzamento ${stochDailyData.lastCross.direction} Diário: ${stochDailyData.lastCross.kValue.toFixed(1)}/${stochDailyData.lastCross.dValue.toFixed(1)} às ${stochDailyData.lastCross.time}`;
            }

            if (!message) {
                message = `Stochastic 12h/Diário: Dados insuficientes`;
            } else {
                message = `Tendência: ${trendDirection} | ${message}`;
            }

            return {
                type: 'STOCHASTIC_TREND',
                score: Math.max(-1, Math.min(2, score)),
                message: message,
                data: {
                    stoch12h: stoch12hData,
                    stochDaily: stochDailyData,
                    trendDirection: trendDirection
                }
            };

        } catch (error) {
            return { type: 'STOCHASTIC_TREND', score: 0, message: 'Erro análise Stochastic' };
        }
    }

    analyzeRSIExtremeRisk(signal) {
        const rsiData = signal.marketData.rsi;
        if (!rsiData) {
            return { type: 'RSI_EXTREME', score: 0, message: 'Sem dados de RSI' };
        }

        const rsiValue = rsiData.value;
        const isBullish = signal.isBullish;
        
        let score = 0;
        let message = '';
        
        if (rsiValue < 25 || rsiValue > 75) {
            score = 3;
            message = `RSI EXTREMO: ${rsiValue.toFixed(1)} (Padrão PERDEDOR confirmado)`;
        } else if (isBullish && rsiValue > RSI_BUY_MAX) {
            score = 2;
            message = `RSI muito alto para compra: ${rsiValue.toFixed(1)} > ${RSI_BUY_MAX}`;
        } else if (!isBullish && rsiValue < RSI_SELL_MIN) {
            score = 2;
            message = `RSI muito baixo para venda: ${rsiValue.toFixed(1)} < ${RSI_SELL_MIN}`;
        } else if (isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) {
            score = -1;
            message = `RSI ideal para compra: ${rsiValue.toFixed(1)} (≤ ${RSI_BUY_MAX})`;
        } else if (!isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75) {
            score = -1;
            message = `RSI ideal para venda: ${rsiValue.toFixed(1)} (≥ ${RSI_SELL_MIN})`;
        } else {
            score = 0;
            message = `RSI neutro: ${rsiValue.toFixed(1)}`;
        }

        return {
            type: 'RSI_EXTREME',
            score: Math.max(-2, Math.min(3, score)),
            message: message,
            data: { rsiValue: rsiValue, isExtreme: rsiValue < 25 || rsiValue > 75 }
        };
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
            
            // Calcular risco baseado na força do pivot e distância
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
            
            // Adicionar peso baseado no timeframe do pivot
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
            const candles = await getCandlesCached(signal.symbol, '15m', 50);
            if (candles.length < 20) {
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
            const btcSymbol = 'BTCUSDT';

            if (symbol === btcSymbol) {
                return { type: 'CORRELATION', score: 0, message: 'BTC não tem correlação' };
            }

            const symbolCandles = await getCandlesCached(symbol, '15m', 8);
            const btcCandles = await getCandlesCached(btcSymbol, '15m', 8);

            if (symbolCandles.length < 5 || btcCandles.length < 5) {
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
            const timeframes = ['15m', '1h', '4h'];
            let conflictingTrends = 0;
            let totalTrends = 0;
            let trendMessages = [];

            for (const tf of timeframes) {
                const candles = await getCandlesCached(signal.symbol, tf, 50);
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

    // CORREÇÃO: Atualizado para retornar em português (compatível com riskLevels)
    determineRiskLevel(score) {
        if (score >= 12) return 'CRÍTICO';
        if (score >= 8) return 'ALTO';
        if (score >= 4) return 'MEDIANO';
        return 'BAIXO';
    }

    calculateConfidence(assessment) {
        const maxScore = 25;
        const normalizedScore = Math.min(Math.max(assessment.overallScore, 0), maxScore);
        const confidence = 100 - (normalizedScore / maxScore) * 40;

        return Math.max(60, Math.min(100, Math.round(confidence)));
    }

    // CORREÇÃO: Atualizado para usar as chaves em português
    generateRecommendations(assessment) {
        const recommendations = [];

        assessment.factors.forEach(factor => {
            if (factor.type === 'RSI_EXTREME' && factor.score >= 2) {
                recommendations.push('🚨 <i>EVITAR: RSI EXTREMO (Padrão PERDEDOR confirmado)</i>');
                recommendations.push('• Considere cancelar o trade');
                recommendations.push('• Aguarde RSI retornar à zona neutra (25-75)');
            }
            
            if (factor.type === 'STOCHASTIC_TREND' && factor.data.trendDirection.includes('CONTRÁRIA')) {
                recommendations.push('⚠️ <i>TENDÊNCIA CONTRÁRIA em timeframes maiores</i>');
                recommendations.push('• Reduza o tamanho da posição');
                recommendations.push('• Use stop loss mais apertado');
            }
        });

        switch (assessment.level) {
            case 'CRÍTICO':
                recommendations.push('⚠️ <i>CONSIDERE EVITAR ESTE TRADE</i>');
                recommendations.push('• Reduza tamanho da posição em 75%');
                recommendations.push('• Use stop loss mais apertado');
                recommendations.push('• Espere confirmação adicional');
                break;

            case 'ALTO':
                recommendations.push('🔶 <i>ALTO RISCO - EXTREMA CAUTELA</i>');
                recommendations.push('• Reduza tamanho da posição em 50%');
                recommendations.push('• Use stop loss conservador');
                recommendations.push('• Procure entrada melhor');
                break;

            case 'MEDIANO':
                recommendations.push('🟡 <i>RISCO MODERADO - CAUTELA</i>');
                recommendations.push('• Reduza tamanho da posição em 25%');
                recommendations.push('• Aguarde confirmação parcial');
                recommendations.push('• Considere alvos mais curtos');
                break;

            case 'BAIXO':
                recommendations.push('🟢 <i>RISCO BAIXO - CONFIANÇA</i>');
                recommendations.push('• Tamanho normal de posição OK');
                recommendations.push('• Stop loss padrão adequado');
                recommendations.push('• Pode buscar alvos mais longos');
                break;
        }

        assessment.factors.forEach(factor => {
            if (factor.score >= 2) {
                switch (factor.type) {
                    case 'RSI_EXTREME':
                        recommendations.push(`• <b>RSI extremo:</b> Evitar trade (padrão perdedor)`);
                        break;
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
                    case 'STOCHASTIC_TREND':
                        recommendations.push(`• <b>Tendência contrária:</b> Operação contra a tendência`);
                        break;
                }
            }
        });

        return recommendations;
    }

    generateWarnings(assessment) {
        const warnings = [];

        assessment.factors.forEach(factor => {
            if (factor.type === 'RSI_EXTREME' && factor.score >= 2) {
                warnings.push(`🚨 ${factor.message}`);
            }
            
            if (factor.type === 'STOCHASTIC_TREND' && factor.data.trendDirection.includes('CONTRÁRIA')) {
                warnings.push(`⚠️ Tendência contrária em timeframes maiores: ${factor.data.trendDirection}`);
            }
        });

        assessment.factors.forEach(factor => {
            if (factor.score >= 2.5 && factor.type !== 'RSI_EXTREME' && factor.type !== 'STOCHASTIC_TREND') {
                warnings.push(`⚠️ ${factor.message}`);
            } else if (factor.score >= 2 && factor.type !== 'RSI_EXTREME' && factor.type !== 'STOCHASTIC_TREND') {
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
        // CORREÇÃO: Agora usando chaves em português consistentes
        console.log(`   Nível: ${assessment.level} ${this.riskLevels[assessment.level].emoji}`);
        console.log(`   Score: ${assessment.overallScore.toFixed(2)}`);
        console.log(`   Confiança: ${assessment.confidence}%`);

        assessment.factors.forEach(factor => {
            if (factor.type === 'RSI_EXTREME') {
                console.log(`   RSI: ${factor.message}`);
            }
            if (factor.type === 'STOCHASTIC_TREND') {
                console.log(`   Stochastic Trend: ${factor.message}`);
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
            level: 'BAIXO',
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
            rsiSettings: [],
            stochasticSettings: []
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
        
        // Adicionar ao histórico de trades
        this.tradeHistory.push(trade);
        
        // Limitar o histórico para evitar sobrecarga
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
                    fundingRate: marketData.funding?.raw || 0,
                    stochastic12h: marketData.stochastic12h || {},
                    stochasticDaily: marketData.stochasticDaily || {}
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

            const rsiAnalysis = this.analyzeRSIPatterns(closedTrades);
            console.log(`📊 Análise RSI: ${rsiAnalysis.extremeWinners.length} vencedores extremos vs ${rsiAnalysis.extremeLosers.length} perdedores extremos`);
            
            const stochasticAnalysis = this.analyzeStochasticPatterns(closedTrades);
            console.log(`📊 Análise Stochastic: ${stochasticAnalysis.winnersWithTrend.length} vencedores com tendência vs ${stochasticAnalysis.losersAgainstTrend.length} perdedores contra tendência`);

            // Resetar padrões para evitar contagem incorreta
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

    analyzeStochasticPatterns(trades) {
        const winnersWithTrend = [];
        const losersAgainstTrend = [];
        const winnersAgainstTrend = [];
        const losersWithTrend = [];

        trades.forEach(trade => {
            const stoch12h = trade.marketData.stochastic12h;
            const stochDaily = trade.marketData.stochasticDaily;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';
            const isBullish = trade.direction === 'BUY';

            let hasTrendConfirmation = false;
            let againstTrend = false;

            if (stochDaily?.isValid) {
                if (isBullish && stochDaily.kValue > stochDaily.dValue) {
                    hasTrendConfirmation = true;
                } else if (!isBullish && stochDaily.kValue < stochDaily.dValue) {
                    hasTrendConfirmation = true;
                } else {
                    againstTrend = true;
                }
            }

            if (isWinner) {
                if (hasTrendConfirmation) winnersWithTrend.push(trade);
                else winnersAgainstTrend.push(trade);
            } else {
                if (againstTrend) losersAgainstTrend.push(trade);
                else losersWithTrend.push(trade);
            }
        });

        return {
            winnersWithTrend,
            losersAgainstTrend,
            winnersAgainstTrend,
            losersWithTrend,
            trendWinRate: winnersWithTrend.length / (winnersWithTrend.length + losersWithTrend.length) || 0,
            againstTrendWinRate: winnersAgainstTrend.length / (winnersAgainstTrend.length + losersAgainstTrend.length) || 0
        };
    }

    analyzeRSIPatterns(trades) {
        const extremeWinners = [];
        const extremeLosers = [];
        const idealWinners = [];
        const idealLosers = [];

        trades.forEach(trade => {
            const rsiValue = trade.marketData.rsi;
            const isWinner = trade.outcome === 'SUCCESS' || 
                           trade.outcome === 'ALL_TARGETS_HIT' || 
                           trade.outcome === 'PARTIAL_TARGETS_HIT';
            const isBullish = trade.direction === 'BUY';

            if (rsiValue < 25 || rsiValue > 75) {
                if (isWinner) extremeWinners.push(trade);
                else extremeLosers.push(trade);
            } else if ((isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) || 
                      (!isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
                if (isWinner) idealWinners.push(trade);
                else idealLosers.push(trade);
            }
        });

        return {
            extremeWinners,
            extremeLosers,
            idealWinners,
            idealLosers,
            extremeWinRate: extremeWinners.length / (extremeWinners.length + extremeLosers.length) || 0,
            idealWinRate: idealWinners.length / (idealWinners.length + idealLosers.length) || 0
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
        
        if (data.rsi < 25 || data.rsi > 75) {
            patterns.push('RSI_EXTREME');
        } else if ((trade.direction === 'BUY' && data.rsi >= 25 && data.rsi <= RSI_BUY_MAX) ||
                   (trade.direction === 'SELL' && data.rsi >= RSI_SELL_MIN && data.rsi <= 75)) {
            patterns.push('RSI_IDEAL');
        }
        
        // Padrões de Stochastic
        if (data.stochastic12h?.isValid && data.stochastic12h.lastCross) {
            patterns.push(`STOCH_12H_${data.stochastic12h.lastCross.direction.toUpperCase()}`);
        }
        
        if (data.stochasticDaily?.isValid && data.stochasticDaily.lastCross) {
            patterns.push(`STOCH_DAILY_${data.stochasticDaily.lastCross.direction.toUpperCase()}`);
        }
        
        if (data.stochastic12h?.isValid && data.stochasticDaily?.isValid) {
            const trendAligned = (trade.direction === 'BUY' && 
                                 data.stochastic12h.kValue > data.stochastic12h.dValue &&
                                 data.stochasticDaily.kValue > data.stochasticDaily.dValue) ||
                                (trade.direction === 'SELL' &&
                                 data.stochastic12h.kValue < data.stochastic12h.dValue &&
                                 data.stochasticDaily.kValue < data.stochasticDaily.dValue);
            
            if (trendAligned) {
                patterns.push('STOCH_TREND_ALIGNED');
            } else {
                patterns.push('STOCH_TREND_CONFLICT');
            }
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

        // Padrão de Funding Rate
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
            const rsiAnalysis = this.analyzeRSIPatterns(closedTrades);
            if (rsiAnalysis.extremeWinRate < 0.3) {
                this.parameterEvolution.rsiSettings.push({
                    timestamp: Date.now(),
                    message: 'RSI_EXTREME é padrão perdedor. Evitar trades com RSI < 25 ou > 75',
                    extremeWinRate: rsiAnalysis.extremeWinRate,
                    idealWinRate: rsiAnalysis.idealWinRate
                });
                console.log('⚠️  RSI_EXTREME: Padrão PERDEDOR confirmado. Win rate: ' + (rsiAnalysis.extremeWinRate * 100).toFixed(1) + '%');
            }

            const stochasticAnalysis = this.analyzeStochasticPatterns(closedTrades);
            if (stochasticAnalysis.trendWinRate > stochasticAnalysis.againstTrendWinRate) {
                this.parameterEvolution.stochasticSettings.push({
                    timestamp: Date.now(),
                    message: 'Trades com tendência alinhada têm maior win rate',
                    trendWinRate: stochasticAnalysis.trendWinRate,
                    againstTrendWinRate: stochasticAnalysis.againstTrendWinRate,
                    difference: (stochasticAnalysis.trendWinRate - stochasticAnalysis.againstTrendWinRate) * 100
                });
                console.log('📈 Stochastic Trend: Win rate com tendência: ' + (stochasticAnalysis.trendWinRate * 100).toFixed(1) + 
                          '%, contra tendência: ' + (stochasticAnalysis.againstTrendWinRate * 100).toFixed(1) + '%');
            }

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

                // Corrigir: carregar apenas os dados que existem
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
                this.patterns = data.patterns || { winning: {}, losing: {} };
                this.parameterEvolution = data.parameterEvolution || this.parameterEvolution;

                console.log(`📊 Aprendizado: ${this.tradeHistory.length} trades carregados`);
                
                // Corrigir contagens inconsistentes
                this.fixPatternCounts();
                
                if (this.patterns.losing.RSI_EXTREME > 20) {
                    console.log('⚠️  Padrão aprendido: RSI_EXTREME é PERDEDOR (' + this.patterns.losing.RSI_EXTREME + ' trades)');
                }
                
                if (this.patterns.winning.STOCH_TREND_ALIGNED > this.patterns.losing.STOCH_TREND_ALIGNED) {
                    console.log('📈 Padrão aprendido: Trades com tendência Stochastic alinhada têm melhor performance');
                }
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados de aprendizado:', error.message);
            // Resetar dados se houver erro
            this.tradeHistory = [];
            this.symbolPerformance = {};
            this.patterns = { winning: {}, losing: {} };
            this.parameterEvolution = this.parameterEvolution;
        }
    }

    fixPatternCounts() {
        // Corrigir contagens inconsistentes nos padrões
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
            // Corrigir: garantir que os dados sejam consistentes antes de salvar
            this.fixPatternCounts();
            
            const data = {
                tradeHistory: this.tradeHistory.slice(-500), // Limitar histórico
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
        
        // Corrigir: usar apenas trades fechados com resultados válidos
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

        // Corrigir: filtrar padrões com contagens válidas
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

        const rsiAnalysis = this.analyzeRSIPatterns(validClosedTrades);
        const stochasticAnalysis = this.analyzeStochasticPatterns(validClosedTrades);

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
            rsiAnalysis: {
                extremeWinRate: (rsiAnalysis.extremeWinRate * 100).toFixed(1),
                idealWinRate: (rsiAnalysis.idealWinRate * 100).toFixed(1),
                extremeTrades: rsiAnalysis.extremeWinners.length + rsiAnalysis.extremeLosers.length,
                idealTrades: rsiAnalysis.idealWinners.length + rsiAnalysis.idealLosers.length
            },
            stochasticAnalysis: {
                trendWinRate: (stochasticAnalysis.trendWinRate * 100).toFixed(1),
                againstTrendWinRate: (stochasticAnalysis.againstTrendWinRate * 100).toFixed(1),
                trendTrades: stochasticAnalysis.winnersWithTrend.length + stochasticAnalysis.losersWithTrend.length,
                againstTrendTrades: stochasticAnalysis.winnersAgainstTrend.length + stochasticAnalysis.losersAgainstTrend.length
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

        this.adaptiveDelay = 100;
        this.minDelay = 50;
        this.maxDelay = 500;
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
                    await this.delay(100);
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
            await this.delay(minuteRemaining + 200);
        } else if (secondUsage > 0.8) {
            await this.delay(secondRemaining + 200);
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
                const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        const timeoutId = setTimeout(() => controller.abort(), 15000);

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

    // Verificar se o volume está confirmado
    const isConfirmed = 
        combinedScore >= VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore &&
        emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio &&
        Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

// =====================================================================
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS COM NOVO FORMATO E INFORMAÇÕES STOCHASTIC
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        // VERIFICAR SE O VOLUME É SUFICIENTE PARA SINAL DE COMPRA/VENDA
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        
        // Obter LSR da Binance
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

        // NOVO: Obter informações do Stochastic 12h e Diário
        const stoch12hData = signal.marketData.stochastic12h;
        const stochDailyData = signal.marketData.stochasticDaily;
        
        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData?.isValid) {
            const kValue = stoch12hData.kValue?.toFixed(1) || 'N/A';
            const dValue = stoch12hData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stoch12hData.lastCross;
            
            if (lastCross) {
                const time = lastCross.time || '';
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${time}`;
            } else {
                stoch12hInfo = `K:${kValue} D:${dValue}`;
            }
        }
        
        if (stochDailyData?.isValid) {
            const kValue = stochDailyData.kValue?.toFixed(1) || 'N/A';
            const dValue = stochDailyData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stochDailyData.lastCross;
            
            if (lastCross) {
                const time = lastCross.time || '';
                stochDailyInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${time}`;
            } else {
                stochDailyInfo = `K:${kValue} D:${dValue}`;
            }
        }

        const riskEmoji = riskAssessment.level === 'CRÍTICO' ? '🚨' :
            riskAssessment.level === 'ALTO' ? '🔴' :
                riskAssessment.level === 'MEDIANO' ? '🟡' : '🟢';

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

        // Obter funding rate com emojis
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

        let rsiWarning = '';
        let stochasticTrendWarning = '';
        
        riskAssessment.factors.forEach(factor => {
            if (factor.type === 'RSI_EXTREME' && factor.score >= 2) {
                rsiWarning = `\n🚨 <b>ALERTA RSI: ${factor.message}</b>`;
            }
            if (factor.type === 'STOCHASTIC_TREND' && factor.data.trendDirection.includes('CONTRÁRIA')) {
                stochasticTrendWarning = `\n⚠️ <b>ALERTA TENDÊNCIA: ${factor.message}</b>`;
            }
        });

        // DETERMINAR O TIPO DE ANÁLISE BASEADO NOS INDICADORES E PIVÔS
        let analysisType = '';
        let analysisEmoji = '🤖';

        if (!isVolumeConfirmed) {
            const rsiValue = signal.marketData.rsi?.value || 50;
            const stochValid = signal.marketData.stoch?.isValid || false;
            const emaAlignment = signal.marketData.ema?.isAboveEMA55 || false;
            
            // Verificar se está próximo de um pivot
            const isNearPivot = pivotDistance && parseFloat(pivotDistance) < 0.8;
            const pivotStrengthText = pivotStrength === 'Forte' ? 'FORTE' : 
                                    pivotStrength === 'Muito Forte' ? 'MUITO FORTE' : '';

            if (signal.isBullish) {
                // Análise para COMPRA/REVERSÃO
                if (isNearPivot && pivotType === 'resistance') {
                    // Batendo em um pivot de resistência
                    if (parseFloat(pivotDistance) < 0.3) {
                        // Muito próximo - possivelmente falso rompimento
                        analysisType = `REVERSÃO/FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        // Próximo mas não muito
                        analysisType = `REVERSÃO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX && stochValid && emaAlignment) {
                    // Próximo de suporte ou situação normal
                    if (isNearPivot && pivotType === 'support') {
                        analysisType = `REVERSÃO/COMPRA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    } else {
                        analysisType = 'REVERSÃO/COMPRA';
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue > RSI_BUY_MAX && rsiValue <= 75) {
                    analysisType = 'EXAUSTÃO/CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'ANÁLISE NEUTRA';
                    analysisEmoji = '🤖';
                }
            } else {
                // Análise para VENDA/EXAUSTÃO
                if (isNearPivot && pivotType === 'support') {
                    // Batendo em um pivot de suporte
                    if (parseFloat(pivotDistance) < 0.3) {
                        // Muito próximo - possivelmente falso rompimento
                        analysisType = `EXAUSTÃO/FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        // Próximo mas não muito
                        analysisType = `EXAUSTÃO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75 && !stochValid && !emaAlignment) {
                    // Próximo de resistência ou situação normal
                    if (isNearPivot && pivotType === 'resistance') {
                        analysisType = `EXAUSTÃO/VENDA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    } else {
                        analysisType = 'EXAUSTÃO/VENDA';
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue < RSI_SELL_MIN) {
                    analysisType = 'REVERSÃO/CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'ANÁLISE NEUTRA';
                    analysisEmoji = '🤖';
                }
            }
        }

        // DECIDIR SE É UM ALERTA DE COMPRA/VENDA OU APENAS ANÁLISE
        let alertTitle = '';
        let alertType = '';
        
        if (isVolumeConfirmed) {
            // VOLUME CONFIRMADO: Enviar alerta de COMPRA/VENDA
            // Adicionar informação do pivot na mensagem
            let pivotInfo = '';
            if (nearestPivot && parseFloat(pivotDistance) < 1.0) {
                const pivotStrengthText = pivotStrength === 'Forte' ? '🔴 FORTE' : 
                                        pivotStrength === 'Muito Forte' ? '🚨 MUITO FORTE' :
                                        pivotStrength === 'Moderado' ? '🟡 MODERADO' : '⚪ FRACO';
                pivotInfo = ` (Pivot ${pivotType} ${pivotStrengthText})`;
            }
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}${pivotInfo}</b>`;
            alertType = 'trade';
        } else {
            // VOLUME NÃO CONFIRMADO: Enviar apenas análise da IA
            alertTitle = `${analysisEmoji} <i>IA Analisando ${analysisType}: ${signal.symbol}</i>`;
            alertType = 'analysis';
        }

        let message = `
${alertTitle}
${now.full} <a href="${tradingViewLink}">Gráfico</a>
<i> Indicadores Técnicos</i>
⚠️ Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
• Preço: $${signal.price.toFixed(6)}
⚠️ Vol: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification}) - Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
• Dist. Suport/Resist.: ${distancePercent}%
• Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})
• LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}|RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
<i>📊 Stochastic Tendência (5.3.3)</i>
• 12h: ${stoch12hInfo}
• Diário: ${stochDailyInfo}
${rsiWarning}
${stochasticTrendWarning}
<i>🤖 IA Operação/Risco </i>
• Risco: ${riskAssessment.overallScore.toFixed(2)} | Nível: ${riskEmoji} ${riskAssessment.level} 
⚠️ Confiança da IA: ${riskAssessment.confidence}%
${!isVolumeConfirmed ? `• 🔶 ATENÇÃO NO VOLUME: Score ${volumeScore.toFixed(2)} - Aguarde confirmação` : ''}
${riskAssessment.warnings.length > 0 ? `• ${riskAssessment.warnings[0]}` : ''}
        `;

        // APENAS ADICIONAR DICAS DE ENTRADA E ALVOS SE O VOLUME ESTIVER CONFIRMADO
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
• Tipo de análise: ${analysisType}
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
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        console.log(`   Stochastic 12h: ${stoch12hInfo}`);
        console.log(`   Stochastic Diário: ${stochDailyInfo}`);

        // Retornar o tipo de alerta enviado
        return {
            type: alertType,
            volumeConfirmed: isVolumeConfirmed,
            volumeScore: volumeScore,
            analysisType: analysisType
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
        
        // VERIFICAR SE O VOLUME É SUFICIENTE
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        
        // DETERMINAR O TIPO DE ANÁLISE BASEADO NOS INDICADORES E PIVÔS
        let analysisType = '';
        let analysisEmoji = '🤖';
        
        if (!isVolumeConfirmed) {
            const rsiValue = signal.marketData.rsi?.value || 50;
            const stochValid = signal.marketData.stoch?.isValid || false;
            const emaAlignment = signal.marketData.ema?.isAboveEMA55 || false;
            
            // Verificar se está próximo de um pivot
            const isNearPivot = pivotDistance && parseFloat(pivotDistance) < 0.8;
            const pivotStrengthText = pivotStrength === 'Forte' ? 'FORTE' : 
                                    pivotStrength === 'Muito Forte' ? 'MUITO FORTE' : '';

            if (signal.isBullish) {
                // Análise para COMPRA/REVERSÃO
                if (isNearPivot && pivotType === 'resistance') {
                    // Batendo em um pivot de resistência
                    if (parseFloat(pivotDistance) < 0.3) {
                        // Muito próximo - possivelmente falso rompimento
                        analysisType = `REVERSÃO/FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        // Próximo mas não muito
                        analysisType = `REVERSÃO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX && stochValid && emaAlignment) {
                    // Próximo de suporte ou situação normal
                    if (isNearPivot && pivotType === 'support') {
                        analysisType = `REVERSÃO/COMPRA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    } else {
                        analysisType = 'REVERSÃO/COMPRA';
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue > RSI_BUY_MAX && rsiValue <= 75) {
                    analysisType = 'EXAUSTÃO/CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'ANÁLISE NEUTRA';
                    analysisEmoji = '🤖';
                }
            } else {
                // Análise para VENDA/EXAUSTÃO
                if (isNearPivot && pivotType === 'support') {
                    // Batendo em um pivot de suporte
                    if (parseFloat(pivotDistance) < 0.3) {
                        // Muito próximo - possivelmente falso rompimento
                        analysisType = `EXAUSTÃO/FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        // Próximo mas não muito
                        analysisType = `EXAUSTÃO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75 && !stochValid && !emaAlignment) {
                    // Próximo de resistência ou situação normal
                    if (isNearPivot && pivotType === 'resistance') {
                        analysisType = `EXAUSTÃO/VENDA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    } else {
                        analysisType = 'EXAUSTÃO/VENDA';
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue < RSI_SELL_MIN) {
                    analysisType = 'REVERSÃO/CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'ANÁLISE NEUTRA';
                    analysisEmoji = '🤖';
                }
            }
        }

        let alertTitle = '';
        if (isVolumeConfirmed) {
            // Adicionar informação do pivot na mensagem
            let pivotInfo = '';
            if (nearestPivot && parseFloat(pivotDistance) < 1.0) {
                const pivotStrengthText = pivotStrength === 'Forte' ? '🔴 FORTE' : 
                                        pivotStrength === 'Muito Forte' ? '🚨 MUITO FORTE' :
                                        pivotStrength === 'Moderado' ? '🟡 MODERADO' : '⚪ FRACO';
                pivotInfo = ` (Pivot ${pivotType} ${pivotStrengthText})`;
            }
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}${pivotInfo}</b>`;
        } else {
            alertTitle = `${analysisEmoji} <i>IA Analisando ${analysisType}: ${signal.symbol}</i>`;
        }

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=15`;

        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        
        // Obter LSR da Binance
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';

        // NOVO: Obter informações do Stochastic 12h e Diário
        const stoch12hData = signal.marketData.stochastic12h;
        const stochDailyData = signal.marketData.stochasticDaily;
        
        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData?.isValid) {
            const kValue = stoch12hData.kValue?.toFixed(1) || 'N/A';
            const dValue = stoch12hData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stoch12hData.lastCross;
            
            if (lastCross) {
                const time = lastCross.time || '';
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${time}`;
            } else {
                stoch12hInfo = `K:${kValue} D:${dValue}`;
            }
        }
        
        if (stochDailyData?.isValid) {
            const kValue = stochDailyData.kValue?.toFixed(1) || 'N/A';
            const dValue = stochDailyData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stochDailyData.lastCross;
            
            if (lastCross) {
                const time = lastCross.time || '';
                stochDailyInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${time}`;
            } else {
                stochDailyInfo = `K:${kValue} D:${dValue}`;
            }
        }

        // Obter funding rate com emojis
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
<b>📊 Stochastic Tendência (5.3.3)</b>
• 12h: ${stoch12hInfo}
• Diário: ${stochDailyInfo}
${!isVolumeConfirmed ? `\n<b>⚠️ ${analysisType} - VOLUME INSUFICIENTE PARA OPERAÇÃO</b>` : ''}
        `;

        // APENAS ADICIONAR ALVOS SE O VOLUME ESTIVER CONFIRMADO
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
• ${analysisType === 'REVERSÃO/COMPRA' ? 'Monitorar para possível entrada de COMPRA' : 
   analysisType === 'EXAUSTÃO/VENDA' ? 'Monitorar para possível entrada de VENDA' : 
   'Monitorar para desenvolvimento do setup'}
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
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        console.log(`   Stochastic 12h: ${stoch12hInfo}`);
        console.log(`   Stochastic Diário: ${stochDailyInfo}`);

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

    baseProbability += (signal.qualityScore.score - 70) * 0.4;

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
    if (rsiValue < 25 || rsiValue > 75) {
        baseProbability -= 20;
    } else if ((signal.isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) ||
               (!signal.isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75)) {
        baseProbability += 8;
    }

    const pivotData = signal.marketData.pivotPoints;
    if (pivotData?.nearestPivot) {
        const pivotDistance = pivotData.nearestPivot.distancePercent || 0;
        const pivotStrength = pivotData.nearestPivot.strength || 'unknown';
        
        // Obter distância segura baseada na força do pivot
        const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
        
        if (pivotDistance < safeDistance * 0.5) {
            baseProbability -= 15; // Muito próximo
        } else if (pivotDistance < safeDistance) {
            baseProbability -= 8;  // Próximo
        } else if (pivotDistance > safeDistance * 1.5) {
            baseProbability += 5;  // Boa distância
        }
        
        if (pivotData.nearestPivot.isTesting) {
            baseProbability -= 12;
        }
        
        // Adicionar peso baseado no timeframe
        if (pivotData.nearestPivot.timeframe) {
            const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotData.nearestPivot.timeframe] || 1.0;
            if (timeframeWeight >= 2.0 && pivotDistance < safeDistance) {
                baseProbability -= 5; // Pivot forte muito próximo
            }
        }
    }

    // NOVO: Considerar tendência do Stochastic
    const stoch12h = signal.marketData.stochastic12h;
    const stochDaily = signal.marketData.stochasticDaily;
    
    if (stochDaily?.isValid) {
        if ((signal.isBullish && stochDaily.kValue > stochDaily.dValue) ||
            (!signal.isBullish && stochDaily.kValue < stochDaily.dValue)) {
            baseProbability += 8; // Tendência alinhada
        } else {
            baseProbability -= 10; // Tendência contrária
        }
    }
    
    if (stoch12h?.isValid) {
        if ((signal.isBullish && stoch12h.kValue > stoch12h.dValue) ||
            (!signal.isBullish && stoch12h.kValue < stoch12h.dValue)) {
            baseProbability += 5; // Tendência 12h alinhada
        } else {
            baseProbability -= 6; // Tendência 12h contrária
        }
    }

    return Math.min(92, Math.max(35, Math.round(baseProbability)));
}

// =====================================================================
// 📊 FUNÇÃO PARA BUSCAR LSR DA BINANCE (CORRIGIDA)
// =====================================================================

async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        // Verificar cache (1 minuto)
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 60000) {
            return candleCache[cacheKey].data;
        }
        
        // URL CORRIGIDA: endpoint correto da Binance para LSR
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const response = await rateLimiter.makeRequest(url, {}, 'klines');
        
        // Verificação robusta da resposta
        if (!response || !Array.isArray(response) || response.length === 0) {
            console.log(`⚠️  Resposta da API LSR vazia para ${symbol}.`);
            return null;
        }
        
        const latestData = response[0];
        
        // Validação dos campos esperados
        if (!latestData.longShortRatio || !latestData.longAccount || !latestData.shortAccount) {
            console.log(`⚠️  Estrutura de dados LSR inesperada para ${symbol}:`, latestData);
            return null;
        }
        
        const currentLSR = parseFloat(latestData.longShortRatio);
        
        // Calcular percentual de mudança se tivermos dados anteriores
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
        
        // Armazenar em cache
        candleCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Binance LSR ${symbol} (${period}): ${result.lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar LSR da Binance para ${symbol}:`, error.message);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO ATUALIZADA DE DETECÇÃO DE VOLUME ROBUSTA 3 MINUTOS
// =====================================================================

async function checkVolumeRobust(symbol) {
    try {
        // Buscar candles de 3 minutos
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
        
        // Volume atual e últimos volumes
        const currentVolume = volumes[volumes.length - 1];
        const previousVolume = volumes[volumes.length - 2] || currentVolume;
        
        // 1. MÉDIA MÓVEL EXPONENCIAL (EMA) DO VOLUME
        const emaData = calculateVolumeEMA(volumes, VOLUME_ROBUST_SETTINGS.emaPeriod, VOLUME_ROBUST_SETTINGS.emaAlpha);
        const emaRatio = currentVolume / emaData.currentEMA;
        const emaScore = calculateEMAScore(emaRatio);
        
        // 2. Z-SCORE DO VOLUME COM LOOKBACK DINÂMICO
        const adaptiveLookback = calculateAdaptiveZScoreLookback(closes);
        const zScoreData = calculateVolumeZScore(volumes, adaptiveLookback);
        const zScore = zScoreData.currentZScore;
        const zScoreScore = calculateZScoreScore(zScore);
        
        // 3. VOLUME-PRICE TREND (VPT)
        const vptData = calculateVolumePriceTrend(volumes, closes);
        const vptScore = calculateVPTScore(vptData);
        
        // 4. CALCULAR SCORE COMBINADO
        const combinedScore = calculateCombinedVolumeScore({
            emaScore,
            zScoreScore,
            vptScore,
            emaRatio,
            zScore
        });
        
        // 5. CLASSIFICAÇÃO
        const classification = classifyVolumeStrength(combinedScore);
        
        // 6. VERIFICAR SE O VOLUME ESTÁ CONFIRMADO
        const isVolumeConfirmed = checkVolumeRobustConfirmation({
            combinedScore,
            classification,
            emaRatio,
            zScore
        });
        
        // Razão bruta para compatibilidade
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

// Função para calcular EMA do volume
function calculateVolumeEMA(volumes, period, alpha) {
    if (volumes.length < period) {
        return {
            currentEMA: volumes[volumes.length - 1] || 0,
            averageVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length || 0,
            emaHistory: []
        };
    }
    
    // Inicializar EMA com SMA
    const initialSMA = volumes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = initialSMA;
    const emaHistory = [ema];
    
    // Calcular EMA para os volumes restantes
    for (let i = period; i < volumes.length; i++) {
        ema = alpha * volumes[i] + (1 - alpha) * ema;
        emaHistory.push(ema);
    }
    
    // Calcular também a média geral para referência
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

// Função para calcular lookback adaptativo do Z-Score baseado na volatilidade
function calculateAdaptiveZScoreLookback(closes) {
    if (closes.length < 10) {
        return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
    }
    
    // Calcular volatilidade recente
    const recentCloses = closes.slice(-20);
    let sumReturns = 0;
    for (let i = 1; i < recentCloses.length; i++) {
        const returnVal = Math.abs((recentCloses[i] - recentCloses[i-1]) / recentCloses[i-1]);
        sumReturns += returnVal;
    }
    const volatility = sumReturns / (recentCloses.length - 1) * 100;
    
    // Ajustar lookback baseado na volatilidade
    if (volatility > 2.0) {
        // Alta volatilidade: usar lookback menor
        return Math.max(VOLUME_ROBUST_SETTINGS.minZScoreLookback, 
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 0.5);
    } else if (volatility < 0.5) {
        // Baixa volatilidade: usar lookback maior
        return Math.min(VOLUME_ROBUST_SETTINGS.maxZScoreLookback,
                       VOLUME_ROBUST_SETTINGS.baseZScoreLookback * 1.5);
    }
    
    // Volatilidade média: usar lookback base
    return VOLUME_ROBUST_SETTINGS.baseZScoreLookback;
}

// Função atualizada para calcular Z-Score com lookback dinâmico
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
    
    // Calcular desvio padrão
    const squaredDifferences = recentVolumes.map(v => Math.pow(v - mean, 2));
    const variance = squaredDifferences.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const stdDev = Math.sqrt(variance);
    
    // Z-Score do volume atual
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
    
    // Calcular movimento de preço recente (últimas 5 velas)
    const recentCloses = closes.slice(-5);
    const priceChange = ((recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0]) * 100;
    
    // Calcular tendência de volume
    const recentVolumes = volumes.slice(-5);
    const volumeSum = recentVolumes.reduce((a, b) => a + b, 0);
    const avgVolume = volumeSum / recentVolumes.length;
    
    // Verificar se o movimento de preço é significativo
    const hasSignificantMovement = Math.abs(priceChange) >= VOLUME_ROBUST_SETTINGS.minPriceMovement;
    
    // Determinar direção da tendência
    let trendDirection = 'neutral';
    if (priceChange > VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bullish';
    } else if (priceChange < -VOLUME_ROBUST_SETTINGS.minPriceMovement) {
        trendDirection = 'bearish';
    }
    
    // Calcular correlação simples entre volume e preço
    let correlation = 0;
    if (hasSignificantMovement) {
        const volumeChanges = [];
        const priceChanges = [];
        
        for (let i = 1; i < recentVolumes.length; i++) {
            volumeChanges.push(recentVolumes[i] - recentVolumes[i - 1]);
            priceChanges.push(recentCloses[i] - recentCloses[i - 1]);
        }
        
        // Correlação simples
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
    
    // Score baseado no movimento de preço
    const absPriceMovement = Math.abs(vptData.priceMovementPercent);
    if (absPriceMovement >= 1.0) score += 0.4;
    else if (absPriceMovement >= 0.5) score += 0.3;
    else if (absPriceMovement >= VOLUME_ROBUST_SETTINGS.minPriceMovement) score += 0.2;
    
    // Score baseado na correlação
    if (Math.abs(vptData.correlation) >= 0.7) score += 0.3;
    else if (Math.abs(vptData.correlation) >= 0.5) score += 0.2;
    else if (Math.abs(vptData.correlation) >= 0.3) score += 0.1;
    
    // Score baseado na consistência da tendência
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
    
    // Pesos configuráveis
    const weights = VOLUME_ROBUST_SETTINGS;
    
    // Calcular score ponderado
    let combinedScore = 
        (emaScore * weights.emaWeight) +
        (zScoreScore * weights.zScoreWeight) +
        (vptScore * weights.vptWeight);
    
    // Aplicar bônus para sinais fortes
    if (emaRatio >= 2.5 && Math.abs(zScore) >= 2.5) {
        combinedScore *= weights.combinedMultiplier;
    }
    
    // Normalizar para 0-1
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
// 📊 NOVAS FUNÇÕES PARA STOCHASTIC 12H E DIÁRIO (5.3.3)
// =====================================================================

async function checkStochasticWithTimeframe(symbol, isBullish, settings) {
    try {
        const candles = await getCandlesCached(symbol, settings.timeframe, settings.requiredCandles);
        if (candles.length < settings.period + 5) {
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null
            };
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        const timestamps = candles.map(c => c.time);

        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: settings.period,
            smooth: settings.smooth,
            signalPeriod: settings.signalPeriod
        });

        if (!stochValues || stochValues.length < 2) {
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null
            };
        }

        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        const kValue = current.k;
        const dValue = current.d;

        // Verificar se há cruzamento recente
        let lastCross = null;
        
        // Analisar últimos 5 períodos para encontrar cruzamentos
        for (let i = Math.max(0, stochValues.length - 6); i < stochValues.length - 1; i++) {
            const prev = stochValues[i];
            const curr = stochValues[i + 1];
            
            // Encontrar cruzamento bullish (K cruza acima de D)
            if (prev.k <= prev.d && curr.k > curr.d) {
                const candleIndex = closes.length - (stochValues.length - (i + 1));
                const crossTime = timestamps[candleIndex] || Date.now();
                const brazilTime = getBrazilianDateTimeFromTimestamp(crossTime);
                
                lastCross = {
                    direction: 'bullish',
                    kValue: curr.k,
                    dValue: curr.d,
                    time: `${brazilTime.date} ${brazilTime.time}`,
                    timestamp: crossTime
                };
                break;
            }
            // Encontrar cruzamento bearish (K cruza abaixo de D)
            else if (prev.k >= prev.d && curr.k < curr.d) {
                const candleIndex = closes.length - (stochValues.length - (i + 1));
                const crossTime = timestamps[candleIndex] || Date.now();
                const brazilTime = getBrazilianDateTimeFromTimestamp(crossTime);
                
                lastCross = {
                    direction: 'bearish',
                    kValue: curr.k,
                    dValue: curr.d,
                    time: `${brazilTime.date} ${brazilTime.time}`,
                    timestamp: crossTime
                };
                break;
            }
        }

        const isValid = isBullish ? 
            (previous.k <= previous.d && current.k > current.d) || current.k > current.d :
            (previous.k >= previous.d && current.k < current.d) || current.k < current.d;

        return {
            isValid: isValid,
            kValue: kValue,
            dValue: dValue,
            lastCross: lastCross,
            settings: settings,
            raw: {
                current: current,
                previous: previous,
                values: stochValues.slice(-5)
            }
        };

    } catch (error) {
        console.log(`⚠️ Erro Stochastic ${settings.timeframe} ${symbol}: ${error.message}`);
        return {
            isValid: false,
            kValue: null,
            dValue: null,
            lastCross: null
        };
    }
}

function getBrazilianDateTimeFromTimestamp(timestamp) {
    const date = new Date(timestamp);
    const offset = -3;
    const brazilTime = new Date(date.getTime() + offset * 60 * 60 * 1000);

    const dateStr = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const timeStr = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

    return { date: dateStr, time: timeStr, full: `${dateStr} ${timeStr}` };
}

// =====================================================================
// 📊 NOVAS FUNÇÕES PARA PONTOS DE PIVÔ MULTI-TIMEFRAME (ATUALIZADO)
// =====================================================================

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const allPivots = [];
        
        // Analisar pivots em múltiplos timeframes
        for (const timeframe of PIVOT_POINTS_SETTINGS.analyzeTimeframes) {
            try {
                const candles = await getCandlesCached(
                    symbol, 
                    timeframe, 
                    PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe] || 70
                );

                if (candles.length < 50) continue;

                const timeframePivots = await analyzePivotPointsInTimeframe(
                    symbol,
                    timeframe,
                    candles,
                    currentPrice
                );
                
                // Adicionar timeframe a cada pivot
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

        // Separar supports e resistances
        const supportPivots = allPivots.filter(p => p.type === 'support');
        const resistancePivots = allPivots.filter(p => p.type === 'resistance');

        // Encontrar pivots mais próximos
        const nearestSupportPivot = findNearestPivotMultiTimeframe(supportPivots, currentPrice, true);
        const nearestResistancePivot = findNearestPivotMultiTimeframe(resistancePivots, currentPrice, false);

        // Verificar se está testando algum pivot
        const testingPivot = checkTestingPivotMultiTimeframe(currentPrice, allPivots);

        // Calcular distâncias
        const supportDistancePercent = nearestSupportPivot ?
            ((currentPrice - nearestSupportPivot.price) / currentPrice) * 100 : null;
        const resistanceDistancePercent = nearestResistancePivot ?
            ((nearestResistancePivot.price - currentPrice) / currentPrice) * 100 : null;

        // Determinar pivot mais próximo
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
                '1h': allPivots.filter(p => p.timeframe === '1h').length,
                '4h': allPivots.filter(p => p.timeframe === '4h').length
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
    
    // Baseado no número de toques
    if (pivot.touches >= 4) {
        baseStrength = 'very_strong';
    } else if (pivot.touches >= 3) {
        baseStrength = 'strong';
    } else if (pivot.touches >= 2) {
        baseStrength = 'moderate';
    }
    
    // Ajustar baseado no timeframe
    const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
    
    if (timeframeWeight >= 3.0 && baseStrength !== 'weak') {
        // Upgrade de força para timeframes maiores
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
        
        // Aplicar peso do timeframe na distância
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

async function getATRData(symbol, timeframe = '15m', period = 14) {
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
// 🚀 FUNÇÃO ESPECIAL PARA MENSAGEM DE INICIALIZAÇÃO
// =====================================================================

async function sendInitializationMessage(allSymbols) {
    try {
        const brazilTime = getBrazilianDateTime();

        const message = `
🚀 <b>TITANIUM ATUALIZADO - NOVAS CONFIGURAÇÕES</b>

${brazilTime.full}
🧠 RSI: Compra até ${RSI_BUY_MAX}, Venda acima de ${RSI_SELL_MIN}
📊 Stochastic 1h: Nova configuração 14,3,3 (8 pontos)
📈 Volume 3m: Detecção Robusta (EMA + Z-Score Adaptativo + VPT)
🎯 Foco em: Volume Robusto, LSR Binance, RSI ajustado, Pivot Points Multi-TF, Funding Rate
🔧 LSR: Apenas Binance API (com percentual de mudança)
🔧 Volume: Média Móvel Exponencial (EMA), Z-Score Adaptativo, Volume-Price Trend
🔧 Pivot Points: Multi-timeframe (15m, 1h, 4h) com pesos diferenciados
🔧 Funding Rate: Emojis coloridos para visualização rápida
<b>🆕 NOVO: Stochastic Tendência 12h/Diário (5.3.3)</b>
• Agora mostra cruzamentos e valores do Stochastic em timeframes maiores
• Informa data/hora exata quando a linha K virou para cima/baixo da linha D
• Análise de tendência maior para confirmar setups
<b>🆕 ATUALIZADO: Alertas Específicos para Pivôs</b>
• "REVERSÃO" ou "FALSO ROMPIMENTO" quando batendo em pivot de resistência
• "REVERSÃO/COMPRA" quando próximo de suporte
• "EXAUSTÃO" ou "FALSO ROMPIMENTO" quando batendo em pivot de suporte
• "EXAUSTÃO/VENDA" quando próximo de resistência
🔧 by @J4Rviz.

<b>⚠️ NOVO SISTEMA DE CLASSIFICAÇÃO:</b>
• Volume Score ≥ 0.4: Alerta de COMPRA/VENDA com info do pivot
• Volume Score < 0.4: "IA ANALISANDO..." com análise específica do pivot
• <b>ANÁLISE ESPECÍFICA:</b> Agora considera pivôs fortes/fracos na mensagem
• <b>INFORMAÇÕES STOCHASTIC:</b> Valores K/D e data/hora do último cruzamento
        `;

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
                        parse_mode: 'HTML',
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
            console.log('🚀 TITANIUM ATUALIZADO - NOVAS CONFIGURAÇÕES');
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

        console.log(`✅ ${symbols.length} pares USDT encontrados`);
        return symbols;

    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando fallback');
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
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

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
        if (latestRSI < 25) status = 'OVERSOLD';
        else if (latestRSI > 75) status = 'OVERBOUGHT';
        
        return {
            value: latestRSI,
            previous: previousRSI,
            raw: latestRSI,
            status: status,
            isExitingExtreme: (previousRSI < 25 && latestRSI > 25) || 
                             (previousRSI > 75 && latestRSI < 75)
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        // Usar a nova função robusta de detecção de volume
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

// =====================================================================
// 🔄 FUNÇÃO checkLSR MODIFICADA - APENAS LSR DA BINANCE
// =====================================================================

async function checkLSR(symbol, isBullish) {
    try {
        // Usar APENAS o LSR da Binance
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
        
        // Critérios ajustados para usar apenas LSR Binance
        const isValid = isBullish ? 
            lsrValue <= LSR_BUY_THRESHOLD :
            lsrValue > LSR_SELL_THRESHOLD;

        console.log(`📊 LSR Binance ${symbol} (15m):`);
        console.log(`   Valor: ${lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        console.log(`   Status: ${isBullish ? 'Compra' : 'Venda'} - ${isValid ? '✅ VÁLIDO' : '❌ INVÁLIDO'}`);

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

// ATUALIZADO: Função checkStochastic com nova configuração
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

async function checkOpenInterest(symbol, isBullish) {
    try {
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

        return {
            isValid: isValid,
            trend: trend
        };
    } catch (error) {
        return { isValid: false, trend: "➡️" };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`,
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
        
        // Verificar tendência
        let isRising = false;
        if (data.length >= 2) {
            const previousRate = parseFloat(data[1].fundingRate);
            isRising = fundingRate > previousRate;
        }
        
        // Critério simplificado - apenas verificar se é favorável
        const isFavorable = isBullish ? fundingRate < 0 : fundingRate > 0;
        const isValid = isFavorable; // Apenas precisa ser favorável

        return {
            isValid: isValid,
            raw: fundingRate,
            isRising: isRising,
            directionFavorable: isFavorable
        };
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
// 📊 FUNÇÃO ATUALIZADA PARA CALCULAR QUALIDADE COM AS ALTERAÇÕES E STOCHASTIC
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

    // 1. Volume (ATUALIZADO: usando análise robusta)
    const volumeData = marketData.volume?.robustData;
    if (volumeData && volumeData.combinedScore >= 0.5) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume,
            QUALITY_WEIGHTS.volume * volumeData.combinedScore);
        score += volumeScore;
        details.push(` Vol 3m Robusto: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (Score: ${volumeData.combinedScore.toFixed(2)} - ${volumeData.classification})`);
        details.push(`   EMA: ${volumeData.emaRatio.toFixed(2)}x | Z-Score: ${volumeData.zScore.toFixed(2)} | VPT: ${volumeData.vpt.priceMovementPercent.toFixed(2)}%`);
    } else {
        failedChecks.push(`Vol 3m: Score ${volumeData?.combinedScore?.toFixed(2) || '0.00'} < 0.5 (${volumeData?.classification || 'FRACO'})`);
    }

    // 2. Volatilidade
    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(` Volatilidade 15m: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatilidade 15m: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}% < ${VOLATILITY_THRESHOLD}%`);
    }

    // 3. LSR (APENAS BINANCE)
    if (marketData.lsr && marketData.lsr.isValid) {
        const lsrScore = QUALITY_WEIGHTS.lsr;
        score += lsrScore;
        const lsrValue = marketData.lsr.lsrRatio;
        details.push(` LSR Binance: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(3)} ${isBullish ? '≤' : '>'} ${LSR_BUY_THRESHOLD})`);
    } else {
        failedChecks.push(`LSR Binance: ${marketData.lsr?.lsrRatio?.toFixed(3) || 0} ${isBullish ? '>' : '≤'} ${LSR_BUY_THRESHOLD}`);
    }

    // 4. RSI (ATUALIZADO: novos limites)
    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;

        if (rsiValue < 25 || rsiValue > 75) {
            failedChecks.push(`RSI 1h: ${rsiValue.toFixed(1)} (EXTREMO - Padrão PERDEDOR)`);
            rsiScore = 0;
        } else if (isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(1)} ≤ ${RSI_BUY_MAX} Ideal para compra)`);
        } else if (!isBullish && rsiValue >= RSI_SELL_MIN && rsiValue <= 75) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(1)} ≥ ${RSI_SELL_MIN} Ideal para venda)`);
        } else {
            failedChecks.push(`RSI 1h: ${rsiValue.toFixed(1)} (Fora da zona ideal)`);
        }
        score += rsiScore;
    }

    // 5. EMA Alignment
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

    // 6. Stochastic 1h (ATUALIZADO: 8 pontos, nova configuração)
    if (marketData.stoch && marketData.stoch.isValid) {
        const stochScore = QUALITY_WEIGHTS.stoch1h;
        score += stochScore;
        const direction = isBullish ? 'K > D (cruzamento bullish)' : 'K < D (cruzamento bearish)';
        details.push(` Stoch 1h (14,3,3): ${stochScore}/${QUALITY_WEIGHTS.stoch1h} (${direction})`);
    } else {
        failedChecks.push(`Stoch 1h: Sem cruzamento ${isBullish ? 'bullish' : 'bearish'} (K ${isBullish ? '≤' : '≥'} D)`);
    }

    // 7. Stochastic 4h
    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        const stoch4hScore = QUALITY_WEIGHTS.stoch4h;
        score += stoch4hScore;
        details.push(` Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h} ${isBullish ? 'bullish' : 'bearish'} `);
    } else {
        failedChecks.push(`Stoch 4h: ${isBullish ? 'bullish' : 'bearish'} `);
    }

    // 8. CCI 4h
    if (marketData.cci4h && marketData.cci4h.isValid) {
        const cci4hScore = QUALITY_WEIGHTS.cci4h;
        score += cci4hScore;
        const deviation = marketData.cci4h.deviation.toFixed(2);
        details.push(` CCI 4h: ${cci4hScore}/${QUALITY_WEIGHTS.cci4h} (${marketData.cci4h.value.toFixed(2)} ${isBullish ? '>' : '<'} ${marketData.cci4h.maValue.toFixed(2)} MMS, dev: ${deviation})`);
    } else {
        failedChecks.push(`CCI 4h: ${marketData.cci4h?.value?.toFixed(2) || 0} ${isBullish ? '≤' : '≥'} ${marketData.cci4h?.maValue?.toFixed(2) || 0} MMS`);
    }

    // 9. Stochastic 12h (NOVO)
    if (marketData.stochastic12h) {
        const stoch12h = marketData.stochastic12h;
        let stoch12hScore = 0;
        let stoch12hDetail = '';

        if (stoch12h.isValid) {
            const kValue = stoch12h.kValue?.toFixed(1) || 'N/A';
            const dValue = stoch12h.dValue?.toFixed(1) || 'N/A';
            
            if ((isBullish && stoch12h.kValue > stoch12h.dValue) ||
                (!isBullish && stoch12h.kValue < stoch12h.dValue)) {
                stoch12hScore = 6;
                stoch12hDetail = `${stoch12hScore}/6 (Tendência ${isBullish ? 'bullish' : 'bearish'} confirmada K:${kValue} > D:${dValue})`;
                
                if (stoch12h.lastCross) {
                    stoch12hDetail += ` | Cruzamento ${stoch12h.lastCross.direction} às ${stoch12h.lastCross.time}`;
                }
            } else {
                stoch12hScore = 2;
                stoch12hDetail = `${stoch12hScore}/6 (Sem tendência clara K:${kValue} ${isBullish ? '≤' : '≥'} D:${dValue})`;
                failedChecks.push(`Stoch 12h: Tendência não confirmada`);
            }
        } else {
            stoch12hDetail = `0/6 (Dados insuficientes)`;
            failedChecks.push(`Stoch 12h: Dados insuficientes`);
        }
        
        score += stoch12hScore;
        details.push(` Stoch 12h (5.3.3): ${stoch12hDetail}`);
    }

    // 10. Stochastic Diário (NOVO)
    if (marketData.stochasticDaily) {
        const stochDaily = marketData.stochasticDaily;
        let stochDailyScore = 0;
        let stochDailyDetail = '';

        if (stochDaily.isValid) {
            const kValue = stochDaily.kValue?.toFixed(1) || 'N/A';
            const dValue = stochDaily.dValue?.toFixed(1) || 'N/A';
            
            if ((isBullish && stochDaily.kValue > stochDaily.dValue) ||
                (!isBullish && stochDaily.kValue < stochDaily.dValue)) {
                stochDailyScore = 8;
                stochDailyDetail = `${stochDailyScore}/8 (TENDÊNCIA FORTE ${isBullish ? 'BULLISH' : 'BEARISH'} K:${kValue} > D:${dValue})`;
                
                if (stochDaily.lastCross) {
                    stochDailyDetail += ` | Cruzamento ${stochDaily.lastCross.direction} às ${stochDaily.lastCross.time}`;
                }
            } else {
                stochDailyScore = 1;
                stochDailyDetail = `${stochDailyScore}/8 (TENDÊNCIA CONTRÁRIA K:${kValue} ${isBullish ? '≤' : '≥'} D:${dValue})`;
                failedChecks.push(`Stoch Diário: Tendência contrária em timeframe maior`);
            }
        } else {
            stochDailyDetail = `0/8 (Dados insuficientes)`;
            failedChecks.push(`Stoch Diário: Dados insuficientes`);
        }
        
        score += stochDailyScore;
        details.push(` Stoch Diário (5.3.3): ${stochDailyDetail}`);
    }

    // 11. Open Interest
    if (marketData.oi && marketData.oi.isValid) {
        const oiScore = QUALITY_WEIGHTS.oi;
        score += oiScore;
        details.push(` OI: ${oiScore}/${QUALITY_WEIGHTS.oi} (${marketData.oi.trend} tendência)`);
    } else {
        failedChecks.push(`OI: Tendência ${marketData.oi?.trend || 'indefinida'} não confirma`);
    }

    // 12. Funding Rate
    if (marketData.funding && marketData.funding.isValid) {
        const fundingScore = QUALITY_WEIGHTS.funding;
        score += fundingScore;
        const fundingPercent = (marketData.funding.raw * 100).toFixed(5);
        
        // Determinar emojis para funding rate
        let fundingRateEmoji = '';
        if (marketData.funding.raw <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (marketData.funding.raw <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (marketData.funding.raw <= -0.0005) fundingRateEmoji = '🟢';
        else if (marketData.funding.raw >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (marketData.funding.raw >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (marketData.funding.raw >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
        
        if (isBullish) {
            details.push(` Funding Rate: ${fundingScore}/${QUALITY_WEIGHTS.funding} (${fundingRateEmoji} ${fundingPercent}% NEGATIVO - FAVORÁVEL para COMPRA)`);
        } else {
            details.push(` Funding Rate: ${fundingScore}/${QUALITY_WEIGHTS.funding} (${fundingRateEmoji} ${fundingPercent}% POSITIVO - FAVORÁVEL para VENDA)`);
        }
    } else {
        failedChecks.push(`Funding Rate: ${isBullish ? 'Não negativo' : 'Não positivo'} suficiente`);
    }

    // 13. Breakout Risk
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

    // 14. Support/Resistance
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

    // 15. Pivot Points (ATUALIZADO: Com diferenciação de timeframe)
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
            
            // Calcular score baseado na distância relativa à distância segura
            const distanceRatio = distance / safeDistance;
            
            if (distanceRatio >= 1.5) {
                // Muito longe - ponto positivo
                pivotScore = QUALITY_WEIGHTS.pivotPoints;
                pivotDetail = `${pivotScore}/${QUALITY_WEIGHTS.pivotPoints} (Excelente distância do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% > ${safeDistance.toFixed(1)}%)`;
            } else if (distanceRatio >= 1.0) {
                // Distância segura
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.8;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Boa distância do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% ≥ ${safeDistance.toFixed(1)}%)`;
            } else if (distanceRatio >= 0.5) {
                // Próximo mas não crítico
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.4;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Próximo do pivot ${pivotStrength} ${timeframe}: ${distance.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`;
            } else {
                // Muito próximo
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (MUITO PRÓXIMO DO PIVOT ${pivotStrength.toUpperCase()} ${timeframe.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${pivotStrength} ${timeframe}: Muito próximo (${distance.toFixed(2)}% < ${safeDistance.toFixed(1)}%)`);
            }
            
            // Penalizar pivots fortes muito próximos
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
        this.groupSize = 25;
        this.signalsDetected = 0;
        this.baseDelay = 8000;
        this.minDelay = 4000;
        this.maxDelay = 15000;
        this.consecutiveNoSignals = 0;
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllFuturesSymbols();

            const filteredSymbols = allSymbols.filter(symbol => {
                const blacklist = ['1000', 'BULL', 'BEAR', 'UP', 'DOWN', 'MOVR'];
                return !blacklist.some(term => symbol.includes(term));
            });

            this.symbolGroups = this.createGroups(filteredSymbols, this.groupSize);

            console.log(`📊 ${filteredSymbols.length} ativos divididos em ${this.symbolGroups.length} grupos`);

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
                return { symbols: [], pause: 30000 };
            }
        }

        return { symbols: group, pause: 0 };
    }

    adjustDelayBasedOnUsage() {
        if (this.consecutiveNoSignals > 3) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.8);
            console.log(`⚡ Reduzindo delay para ${this.baseDelay}ms (poucos sinais)`);
            this.consecutiveNoSignals = 0;
        }

        if (this.signalsDetected > 0) {
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

        // FILTRO CRÍTICO: EVITAR RSI EXTREMO
        if (rsiData.value < 25 || rsiData.value > 75) {
            console.log(`❌ ${symbol}: RSI extremo detectado (${rsiData.value.toFixed(1)}) - Padrão PERDEDOR`);
            return null;
        }

        // FILTRO ADICIONAL: RSI com novos limites
        if (isBullish && rsiData.value > RSI_BUY_MAX) {
            console.log(`❌ ${symbol}: RSI alto para compra (${rsiData.value.toFixed(1)} > ${RSI_BUY_MAX})`);
            return null;
        }
        if (isBearish && rsiData.value < RSI_SELL_MIN) {
            console.log(`❌ ${symbol}: RSI baixo para venda (${rsiData.value.toFixed(1)} < ${RSI_SELL_MIN})`);
            return null;
        }

        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPoints(symbol, emaData.currentPrice, isBullish);

        // NOVO: Adicionar análise do Stochastic 12h e Diário
        const stoch12hData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_12H_SETTINGS);
        const stochDailyData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_DAILY_SETTINGS);

        const [volumeData, volatilityData, lsrData, stochData, stoch4hData, cci4hData, oiData, fundingData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),
            checkCCI4h(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);

        if (!lsrData.isValid) return null;

        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
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
            supportResistance: supportResistanceData,
            breakoutRisk: supportResistanceData?.breakoutRisk,
            pivotPoints: pivotPointsData,
            stochastic12h: stoch12hData, // NOVO
            stochasticDaily: stochDailyData // NOVO
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

        // NOVO: Informações do Stochastic 12h e Diário
        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData?.isValid) {
            const kValue = stoch12hData.kValue?.toFixed(1) || 'N/A';
            const dValue = stoch12hData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stoch12hData.lastCross;
            
            if (lastCross) {
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${lastCross.time}`;
            } else {
                stoch12hInfo = `K:${kValue} D:${dValue}`;
            }
        }
        
        if (stochDailyData?.isValid) {
            const kValue = stochDailyData.kValue?.toFixed(1) || 'N/A';
            const dValue = stochDailyData.dValue?.toFixed(1) || 'N/A';
            const lastCross = stochDailyData.lastCross;
            
            if (lastCross) {
                stochDailyInfo = `K:${kValue} D:${dValue} | Cruzamento ${lastCross.direction} às ${lastCross.time}`;
            } else {
                stochDailyInfo = `K:${kValue} D:${dValue}`;
            }
        }

        // Obter funding rate com emojis
        const fundingRate = fundingData.raw || 0;
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

        // Informações de volume robusto
        const volumeRobustData = volumeData.robustData;
        const volumeScore = volumeRobustData?.combinedScore?.toFixed(2) || '0.00';
        const volumeClassification = volumeRobustData?.classification || 'NORMAL';
        const emaRatio = volumeRobustData?.emaRatio?.toFixed(2) || 'N/A';
        const zScore = volumeRobustData?.zScore?.toFixed(2) || 'N/A';

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📈 Volume: ${volumeData.rawRatio.toFixed(2)}x (Score: ${volumeScore} - ${volumeClassification})`);
        console.log(`   📊 EMA: ${emaRatio}x | Z-Score: ${zScore}`);
        console.log(`   📊 LSR Binance: ${lsrData.lsrRatio.toFixed(3)}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   📊 Stoch 1h: ${stochData.isValid ? '✅' : '❌'} (K:${stochData.kValue?.toFixed(1) || 'N/A'}, D:${stochData.dValue?.toFixed(1) || 'N/A'})`);
        console.log(`   📊 Stoch 12h: ${stoch12hInfo}`);
        console.log(`   📊 Stoch Diário: ${stochDailyInfo}`);
        console.log(`   💰 Funding: ${fundingRateText}`);

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
            await new Promise(r => setTimeout(r, 200));
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

    Object.keys(oiCache).forEach(key => {
        if (now - oiCache[key].timestamp > OI_CACHE_TTL) {
            delete oiCache[key];
        }
    });
}

// =====================================================================
// 🔄 LOOP PRINCIPAL DO BOT
// =====================================================================

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(5000)
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

    console.log(`\n TITANIUM ATUALIZADO - NOVAS CONFIGURAÇÕES`);
    console.log(` ${allSymbols.length} ativos Binance Futures`);
    console.log(` RSI: Compra até ${RSI_BUY_MAX}, Venda acima de ${RSI_SELL_MIN}`);
    console.log(` Stochastic: Agora com análise 12h/Diário (5.3.3)`);
    console.log(`  Score < 0.4: "🤖 IA ANALISANDO..." agora com tipo específico (Reversão/Compra ou Exaustão/Correção)`);
    console.log(`  🆕 NOVO: Informações detalhadas do Stochastic com data/hora dos cruzamentos`);
    console.log(`  🆕 ATUALIZADO: Alertas específicos para pivôs (Reversão/Falso Rompimento)`);

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
            console.log(`📊 ${currentSymbols.length} ativos | Delay: ${symbolManager.getCurrentDelay()}ms`);

            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 30s...');
                await new Promise(r => setTimeout(r, 30000));
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
                    await new Promise(r => setTimeout(r, 1000));
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
                console.log('🔄 Muitos erros. Pausa de 60s...');
                await new Promise(r => setTimeout(r, 60000));
                consecutiveErrors = 0;
            }

            await new Promise(r => setTimeout(r, Math.min(10000 * consecutiveErrors, 60000)));
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

• <i>Nível de Risco Geral:</i> ${marketRisk.riskLevel} ${marketRisk.riskLevel === 'CRÍTICO' ? '🚨' : marketRisk.riskLevel === 'ALTO' ? '🔴' : marketRisk.riskLevel === 'MEDIANO' ? '🟡' : '🟢'}
• <i>Score Médio de Risco:</i> ${marketRisk.averageRiskScore.toFixed(2)}/15
• <i>Símbolos Monitorados:</i> ${marketRisk.monitoredSymbols}
• <i>Horário:</I> ${now.full}

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

        const bestPatterns = report.bestPatterns.map(([pattern, count]) => `${pattern}: ${count} trades`).join('\n');
        const worstPatterns = report.worstPatterns.map(([pattern, count]) => `${pattern}: ${count} trades`).join('\n');

        const message = `
🧠 <i>RELATÓRIO </i>
${now.full}

• <b>Trades Totais:</b> ${report.totalTrades}
• <b>Taxa de Acerto:</b> ${report.winRate.toFixed(1)}%
• <b>Fator de Lucro:</b> ${report.profitFactor}
• <b>Lucro Médio:</b> ${report.avgProfit}% | <b>Perda Média:</b> ${report.avgLoss}%

<b>📊 Análise RSI (${RSI_BUY_MAX}/${RSI_SELL_MIN}):</b>
• Win Rate RSI Extremo: ${report.rsiAnalysis.extremeWinRate}%
• Win Rate RSI Ideal: ${report.rsiAnalysis.idealWinRate}%

<b>📈 Análise Stochastic Tendência:</b>
• Win Rate com Tendência: ${report.stochasticAnalysis.trendWinRate}%
• Win Rate contra Tendência: ${report.stochasticAnalysis.againstTrendWinRate}%
• Trades com tendência: ${report.stochasticAnalysis.trendTrades}
• Trades contra tendência: ${report.stochasticAnalysis.againstTrendTrades}

<b>📈 Padrões Vencedores (Top 5):</b>
${bestPatterns || 'Nenhum padrão identificado ainda'}

<b>📉 Padrões Perdedores (Top 5):</b>
${worstPatterns || 'Nenhum padrão identificado ainda'}

<b>📊 Simulação Trailing:</b>
• Total: ${report.simulationStats.totalSimulated}
• Stop Primeiro: ${report.simulationStats.stopFirst}
• Alvo Primeiro: ${report.simulationStats.targetFirst}

<i>✨Titanium System by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);
        console.log('📊 Relatório de aprendizado enviado');

    } catch (error) {
        console.error('Erro ao enviar relatório de aprendizado:', error.message);
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA RESETAR APRENDIZADO
// =====================================================================

function resetLearningData() {
    try {
        console.log('🔄 RESETANDO DADOS DE APRENDIZADO...');
        
        // Resetar sistema de aprendizado
        learningSystem = new AdvancedLearningSystem();
        
        // Criar arquivo de aprendizado limpo
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
                stochasticSettings: []
            },
            lastUpdated: Date.now(),
            trailingConfig: learningSystem.trailingConfig,
            resetTimestamp: Date.now(),
            resetNote: 'Sistema resetado devido a bugs nas estatísticas'
        };
        
        fs.writeFileSync(learningFile, JSON.stringify(cleanData, null, 2));
        
        console.log('✅ Dados de aprendizado resetados com sucesso!');
        console.log('📊 Novo relatório será gerado com dados limpos.');
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao resetar dados de aprendizado:', error.message);
        return false;
    }
}

// =====================================================================
// ▶️ INICIALIZAÇÃO COM OPÇÃO DE RESET
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM - ATUALIZADO COM NOVAS CONFIGURAÇÕES');
        console.log(` RSI: Compra ≤ ${RSI_BUY_MAX}, Venda ≥ ${RSI_SELL_MIN}`);
        console.log(` Stochastic 1h: 14,3,3 (8 pontos)`);
        console.log(` Stochastic 12h/Diário: 5.3.3 (Análise de tendência maior)`);
        console.log(` Análise IA: Agora especifica "REVERSÃO" ou "FALSO ROMPIMENTO" para pivôs de resistência`);
        console.log(` 🆕 NOVO: Mostra data/hora quando K virou para cima/baixo da linha D`);
        console.log('='.repeat(80) + '\n');

        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }

        // Verificar se deve resetar o aprendizado
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
            await new Promise(r => setTimeout(r, 5000));
        }

        if (!connected) {
            console.log('❌ Sem conexão com a Binance');
            process.exit(1);
        }

        global.riskLayer = new SophisticatedRiskLayer();
        console.log('🛡️  Risk Layer Sofisticado ativado (com detecção de RSI extremo e tendência Stochastic)');

        console.log('✅ Tudo pronto! Iniciando monitoramento...');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 120 segundos...');
        await new Promise(r => setTimeout(r, 120000));
        await startBot();
    }
}

// Iniciar
startBot();
