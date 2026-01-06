const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_';
const TELEGRAM_CHAT_ID = '-1001990889297';


// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true; // Modo REAL sempre ativo

// === CONFIGURAÇÕES OTIMIZADAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.0,
    volatilityMultiplier: 0.2,
    useAdaptive: true
};

const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m'; // Timeframe da volatilidade
const VOLATILITY_THRESHOLD = 0.8;

// === CONFIGURAÇÕES LSR AJUSTADAS ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;
const FUNDING_BUY_MAX = -0.0005;
const FUNDING_SELL_MIN = 0.0005;

const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,
    oppositeDirection: 10 * 60 * 1000,
    useDifferentiated: true
};

// === CONFIGURAÇÕES PARA PONTOS DE PIVÔ E TREND LINES ===
const PIVOT_POINT_SETTINGS = {
    timeframe: '15m',
    lookbackPeriod: 50,
    minCandlesBetweenPivots: 5,
    pivotStrength: {
        weak: 2,
        moderate: 3,
        strong: 4
    },
    trendline: {
        minPoints: 2,
        maxDeviationPercent: 1.0,
        minAngle: 0.5, // em graus
        maxAngle: 85   // em graus
    },
    pivotWeight: 12,
    trendlineWeight: 8
};

// === QUALITY SCORE COMPLETO - COM NOVOS INDICADORES ===
const QUALITY_THRESHOLD = 75;
const QUALITY_WEIGHTS = {
    volume: 20,
    oi: 10,
    volatility: 8,
    lsr: 8,
    rsi: 8,
    emaAlignment: 10,
    adx: 5,
    adx1h: 12,
    stoch1h: 5,
    stoch4h: 8,
    cci4h: 10,
    divergence15m: 10,
    breakoutRisk: 8,
    supportResistance: 10,
    pivotPoints: 12,    // NOVO
    trendLines: 8      // NOVO
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

// === NOVAS CONFIGURAÇÕES PARA RETRAÇÕES DINÂMICAS COM ATR ===
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

// === CONFIGURAÇÕES PARA DIVERGÊNCIA 15M ===
const DIVERGENCE_SETTINGS = {
    timeframe: '15m',
    lookbackPeriod: 20,
    rsiPeriod: 14,
    minCandleDistance: 3,
    confirmationCandles: 2
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

// === CONFIGURAÇÕES TÉCNICAS ===
const ADX_SETTINGS = {
    period: 14,
    timeframe: '15m',
    strongTrendThreshold: 28
};

const ADX_1H_SETTINGS = {
    period: 14,
    timeframe: '1h',
    strongTrendThreshold: 25,
    minStrength: 22
};

const STOCH_SETTINGS = {
    period: 5,
    signalPeriod: 3,
    smooth: 3,
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

const TARGET_PERCENTAGES = [2.5, 5.0, 8.0, 12.0, 18.0];
const ATR_PERIOD = 14;
const ATR_TIMEFRAME = '15m';

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
            DIVERGENCE_RISK: { weight: 1.1 },
            MARKET_CONDITION_RISK: { weight: 1.6 },
            PIVOT_RISK: { weight: 1.2 }, // NOVO
            TRENDLINE_RISK: { weight: 1.1 } // NOVO
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

            const divergenceRisk = this.analyzeDivergenceRisk(signal);
            riskAssessment.factors.push(divergenceRisk);
            riskAssessment.overallScore += divergenceRisk.score * this.riskFactors.DIVERGENCE_RISK.weight;

            const marketRisk = await this.analyzeMarketConditionRisk();
            riskAssessment.factors.push(marketRisk);
            riskAssessment.overallScore += marketRisk.score * this.riskFactors.MARKET_CONDITION_RISK.weight;

            const trendRisk = await this.analyzeTrendRisk(signal);
            riskAssessment.factors.push(trendRisk);
            riskAssessment.overallScore += trendRisk.score * 1.2;

            // NOVOS: Análise de Pivot Points e Trend Lines
            const pivotRisk = this.analyzePivotRisk(signal);
            riskAssessment.factors.push(pivotRisk);
            riskAssessment.overallScore += pivotRisk.score * this.riskFactors.PIVOT_RISK.weight;

            const trendlineRisk = this.analyzeTrendlineRisk(signal);
            riskAssessment.factors.push(trendlineRisk);
            riskAssessment.overallScore += trendlineRisk.score * this.riskFactors.TRENDLINE_RISK.weight;

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

    // NOVO: Análise de risco baseada em Pivot Points
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
            
            if (distancePercent < 0.5) {
                score = 2;
                message = `MUITO PRÓXIMO de pivot ${pivotType} (${distancePercent.toFixed(2)}%)`;
            } else if (distancePercent < 1.0) {
                score = 1;
                message = `Próximo de pivot ${pivotType} (${distancePercent.toFixed(2)}%)`;
            } else {
                score = 0;
                message = `Boa distância de pivot (${distancePercent.toFixed(2)}%)`;
            }
            
            // Verificar se está testando pivot
            if (pivotData.nearestPivot.isTesting) {
                score += 1;
                message += ' | TESTANDO PIVOT!';
            }
        }

        return {
            type: 'PIVOT',
            score: Math.min(3, score),
            message: message,
            data: pivotData.nearestPivot || null
        };
    }

    // NOVO: Análise de risco baseada em Trend Lines
    analyzeTrendlineRisk(signal) {
        const trendlineData = signal.marketData.trendLines;
        if (!trendlineData) {
            return { type: 'TRENDLINE', score: 0, message: 'Sem dados de trend line' };
        }

        let score = 0;
        let message = '';
        
        const relevantLines = trendlineData.filter(line => 
            line.valid && line.points >= PIVOT_POINT_SETTINGS.trendline.minPoints
        );

        if (relevantLines.length === 0) {
            return { type: 'TRENDLINE', score: 0, message: 'Sem trend lines válidas' };
        }

        const currentPrice = signal.price;
        const isBullish = signal.isBullish;

        for (const line of relevantLines) {
            const distancePercent = Math.abs(currentPrice - line.currentValue) / currentPrice * 100;
            
            if (distancePercent < 0.8) {
                score = 2;
                message = `PRÓXIMO da trend line ${line.type} (${distancePercent.toFixed(2)}%)`;
                
                if (line.type === 'support' && !isBullish) {
                    score += 1;
                    message += ' | VENDA PRÓXIMO SUPORTE!';
                } else if (line.type === 'resistance' && isBullish) {
                    score += 1;
                    message += ' | COMPRA PRÓXIMO RESISTÊNCIA!';
                }
                break;
            } else if (distancePercent < 1.5) {
                score = Math.max(score, 1);
                message = `Próximo da trend line ${line.type} (${distancePercent.toFixed(2)}%)`;
            }
        }

        // Verificar se há breakout recente
        const recentBreakouts = relevantLines.filter(line => 
            line.recentBreakout && line.recentBreakout.withinLast5Candles
        );
        
        if (recentBreakouts.length > 0) {
            score = Math.max(score, 2);
            message += ` | ${recentBreakouts.length} BREAKOUT(S) RECENTE(S)`;
        }

        return {
            type: 'TRENDLINE',
            score: Math.min(3, score),
            message: message || 'Distante das trend lines',
            data: {
                totalLines: relevantLines.length,
                nearestLine: relevantLines[0] || null
            }
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
        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        const volumeAboveBelow = ((volumeRatio - 1) * 100);

        let score = 0;
        let message = '';

        if (volumeRatio < 0.7) {
            score = 2;
            message = `VOLUME MUITO BAIXO: ${volumeRatio.toFixed(2)}x`;
        } else if (volumeRatio < 1.0) {
            score = 1;
            message = `Volume abaixo da média: ${volumeRatio.toFixed(2)}x`;
        } else if (volumeRatio > 3.0) {
            score = 1;
            message = `Volume muito alto: ${volumeRatio.toFixed(2)}x`;
        } else if (volumeRatio > 2.0) {
            score = 0.5;
            message = `Volume alto: ${volumeRatio.toFixed(2)}x`;
        } else {
            score = 0;
            message = `Volume normal: ${volumeRatio.toFixed(2)}x`;
        }

        return {
            type: 'VOLUME',
            score: score,
            message: message,
            data: { volumeRatio: volumeRatio }
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
            case 'very_low': score = 0; break;
            case 'low': score = 0.5; break;
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

    analyzeDivergenceRisk(signal) {
        const divergenceData = signal.marketData.divergence15m;

        if (!divergenceData || !divergenceData.hasDivergence) {
            return { type: 'DIVERGENCE', score: 0, message: 'Sem divergência' };
        }

        let score = 0;
        let message = '';

        const isAligned = (signal.isBullish && (divergenceData.type === 'bullish' || divergenceData.type === 'hiddenBullish')) ||
            (!signal.isBullish && (divergenceData.type === 'bearish' || divergenceData.type === 'hiddenBearish'));

        if (isAligned) {
            score = -1;
            message = `Divergência ${divergenceData.type} confirmando`;

            if (divergenceData.confirmed) {
                score = -1.5;
                message += ` (CONFIRMADA)`;
            }
        } else {
            score = 2;
            message = `⚠️ DIVERGÊNCIA ${divergenceData.type.toUpperCase()} CONTRA SINAL!`;
        }

        return {
            type: 'DIVERGENCE',
            score: Math.max(-2, Math.min(3, score)),
            message: message,
            data: {
                type: divergenceData.type,
                confirmed: divergenceData.confirmed,
                aligned: isAligned
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
                        trendMessages.push(`${tf}: tendência de BAISA`);
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
                score = 0;
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
        if (score >= 15) return 'CRITICAL';
        if (score >= 10) return 'HIGH';
        if (score >= 5) return 'MEDIUM';
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
                recommendations.push('⚠️ <b>CONSIDERE EVITAR ESTE TRADE</b>');
                recommendations.push('• Reduza tamanho da posição em 75%');
                recommendations.push('• Use stop loss mais apertado');
                recommendations.push('• Espere confirmação adicional');
                break;

            case 'HIGH':
                recommendations.push('🔶 <b>ALTO RISCO - EXTREMA CAUTELA</b>');
                recommendations.push('• Reduza tamanho da posição em 50%');
                recommendations.push('• Use stop loss conservador');
                recommendations.push('• Procure entrada melhor');
                break;

            case 'MEDIUM':
                recommendations.push('🟡 <b>RISCO MODERADO - CAUTELA</b>');
                recommendations.push('• Reduza tamanho da posição em 25%');
                recommendations.push('• Aguarde confirmação parcial');
                recommendations.push('• Considere alvos mais curtos');
                break;

            case 'LOW':
                recommendations.push('🟢 <b>RISCO BAIXO - CONFIANÇA</b>');
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
                    case 'DIVERGENCE':
                        if (factor.data && !factor.data.aligned) {
                            recommendations.push(`• <b>Divergência contra:</b> Considere cancelar trade`);
                        }
                        break;
                    case 'PIVOT':
                        if (factor.message.includes('TESTANDO PIVOT')) {
                            recommendations.push(`• <b>Testando pivot:</b> Aguarde confirmação do rompimento`);
                        }
                        break;
                    case 'TRENDLINE':
                        if (factor.message.includes('BREAKOUT')) {
                            recommendations.push(`• <b>Breakout recente:</b> Confirme reteste`);
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
// 🧠 SISTEMA DE APRENDIZADO COMPLETO COM TRAILING SIMULATION
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
            adxThreshold: [],
            breakoutRisk: [],
            supportResistance: [],
            divergence: [],
            pivotPoints: [],    // NOVO
            trendLines: []      // NOVO
        };

        this.learningEnabled = true;
        this.minTradesForLearning = 10;
        this.tradeTrackingHours = 24;

        // Configuração de trailing simulation
        this.trailingConfig = {
            timeframe: '5m',
            candlesToSimulate: 288, // 24 horas em candles de 5m
            partialTargets: [
                { percentage: 20, positionSize: 0.25 },
                { percentage: 40, positionSize: 0.25 },
                { percentage: 60, positionSize: 0.25 },
                { percentage: 80, positionSize: 0.25 }
            ],
            fees: 0.0004 // 0.04% Binance Futures
        };

        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado Avançado com Trailing Simulation inicializado');
    }

    async simulateTradeCandleByCandle(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade) return null;

            console.log(`📊 Iniciando trailing simulation para ${trade.symbol} ${trade.direction}`);

            // Baixar candles de 5m após o sinal
            const candles = await getCandlesCached(
                trade.symbol,
                this.trailingConfig.timeframe,
                this.trailingConfig.candlesToSimulate
            );

            if (candles.length < 10) return null;

            const entryTime = trade.timestamp;
            const relevantCandles = candles.filter(c => c.time >= entryTime);

            if (relevantCandles.length === 0) return null;

            // Simular trade candle a candle
            const simulationResult = this.simulateTradeExecution(
                trade,
                relevantCandles
            );

            // Atualizar trade com resultado da simulação
            trade.simulationResult = simulationResult;
            trade.status = 'SIMULATED';
            trade.outcome = simulationResult.finalOutcome;
            trade.exitPrice = simulationResult.exitPrice;
            trade.profitPercentage = simulationResult.netProfitPercentage;
            trade.durationHours = simulationResult.durationHours;

            // Registrar no histórico
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

        let currentPosition = 1.0; // 100% da posição inicial
        let realizedProfit = 0;
        let feesPaid = 0;
        let hitStop = false;
        let hitTargets = [];
        let exitPrice = entryPrice;
        let finalOutcome = 'FAILURE';
        let firstHit = null;

        // Ordenar alvos por porcentagem
        const sortedTargets = [...trade.targets].sort((a, b) =>
            parseFloat(a.percentage) - parseFloat(b.percentage)
        );

        // Simular cada candle
        for (let i = 0; i < candles.length && currentPosition > 0; i++) {
            const candle = candles[i];
            const high = candle.high;
            const low = candle.low;
            const close = candle.close;

            // Verificar se stop foi atingido primeiro
            if (!hitStop) {
                if (isBullish && low <= stopPrice) {
                    hitStop = true;
                    firstHit = firstHit || 'STOP';
                    exitPrice = stopPrice;

                    const loss = (stopPrice - entryPrice) / entryPrice * 100 * currentPosition;
                    realizedProfit += loss;

                    // Calcular fees para saída
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

                    // Calcular fees para saída
                    const exitFees = currentPosition * this.trailingConfig.fees * 100;
                    feesPaid += exitFees;

                    currentPosition = 0;
                    finalOutcome = 'STOP_HIT';
                    break;
                }
            }

            // Verificar alvos parciais
            for (let j = 0; j < sortedTargets.length; j++) {
                const target = sortedTargets[j];
                const targetPrice = parseFloat(target.price);

                if (hitTargets.some(t => t.percentage === target.percentage)) continue;

                // Verificar se o alvo foi atingido
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

                    // Calcular profit para esta parte da posição
                    const positionSize = this.trailingConfig.partialTargets[j]?.positionSize || 0.25;
                    const profit = isBullish ?
                        ((targetPrice - entryPrice) / entryPrice) * 100 * positionSize :
                        ((entryPrice - targetPrice) / entryPrice) * 100 * positionSize;

                    realizedProfit += profit;

                    // Calcular fees para esta saída parcial
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

        // Se ainda tiver posição após 24h, fechar no último preço
        if (currentPosition > 0) {
            const lastCandle = candles[candles.length - 1];
            exitPrice = lastCandle.close;

            const finalProfit = isBullish ?
                ((exitPrice - entryPrice) / entryPrice) * 100 * currentPosition :
                ((entryPrice - exitPrice) / entryPrice) * 100 * currentPosition;

            realizedProfit += finalProfit;

            // Calcular fees finais
            const finalFees = currentPosition * this.trailingConfig.fees * 100;
            feesPaid += finalFees;

            currentPosition = 0;
            finalOutcome = firstHit ? `${firstHit}_THEN_EXIT` : 'TIMEOUT_EXIT';
        }

        // Calcular resultados finais
        const netProfit = realizedProfit - feesPaid;
        const durationMs = candles.length * 5 * 60 * 1000; // Cada candle de 5m
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

            // Usar trailing simulation em vez de verificação simples
            const simulationResult = await this.simulateTradeCandleByCandle(tradeId);

            if (simulationResult) {
                console.log(`📊 Trade ${trade.symbol} ${trade.direction} ${simulationResult.finalOutcome}: ${simulationResult.netProfitPercentage.toFixed(2)}%`);
                console.log(`   Alvos atingidos: ${simulationResult.hitTargets.length}, Stop: ${simulationResult.hitStop ? 'SIM' : 'NÃO'}`);
            } else {
                // Fallback para verificação antiga se a simulação falhar
                await this.checkTradeOutcomeFallback(tradeId);
            }

        } catch (error) {
            console.error('Erro ao verificar outcome do trade:', error);
            // Tentar fallback
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

        if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
            symbolStats.successfulSignals++;
            symbolStats.totalProfit += trade.profitPercentage || 0;
        }

        symbolStats.avgHoldingTime = symbolStats.successfulSignals > 0
            ? (symbolStats.avgHoldingTime * (symbolStats.successfulSignals - 1) + (trade.durationHours || 0)) / symbolStats.successfulSignals
            : (trade.durationHours || 0);

        symbolStats.recentScores.push(trade.qualityScore);
        if (symbolStats.recentScores.length > 20) {
            symbolStats.recentScores = symbolStats.recentScores.slice(-20);
        }

        this.symbolPerformance[trade.symbol] = symbolStats;
        this.openTrades.delete(trade.id || trade.timestamp);
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
                    supportResistance: marketData.supportResistance || {},
                    pivotPoints: marketData.pivotPoints || {},      // NOVO
                    trendLines: marketData.trendLines || []         // NOVO
                },
                status: 'OPEN',
                outcome: null,
                exitPrice: null,
                profitPercentage: null,
                durationHours: null
            };

            this.tradeHistory.push(tradeRecord);
            this.openTrades.set(tradeRecord.id, tradeRecord);

            // Agendar trailing simulation após 24h
            setTimeout(() => {
                this.checkTradeOutcome(tradeRecord.id);
            }, this.tradeTrackingHours * 60 * 60 * 1000);

            // Inicializar estatísticas do símbolo se não existirem
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

        if (data.volumeRatio >= 1.8 && data.adx1h >= 25) {
            patterns.push('HIGH_VOL_STRONG_TREND');
        }
        if (data.volumeRatio >= 1.5 && data.volumeRatio < 1.8 && data.adx1h >= 22) {
            patterns.push('MOD_VOL_GOOD_TREND');
        }
        if (data.rsi <= 35 || data.rsi >= 65) {
            patterns.push('RSI_EXTREME');
        }
        if (data.volatility >= 1.0 && data.volatility <= 1.5) {
            patterns.push('OPTIMAL_VOLATILITY');
        }
        if (data.lsr >= 3.0) {
            patterns.push('HIGH_LSR');
        }
        if (data.stoch4hValid && data.cci4hValid) {
            patterns.push('STOCH_CCI_4H_BULLISH');
        }
        if (data.cci4hValue > 100 || data.cci4hValue < -100) {
            patterns.push('CCI_EXTREME');
        }

        if (data.divergence15m?.hasDivergence) {
            patterns.push(`DIVERGENCE_${data.divergence15m.type.toUpperCase()}`);
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

        // NOVOS: Padrões de Pivot Points e Trend Lines
        if (data.pivotPoints?.nearestPivot?.distancePercent <= 0.8) {
            patterns.push(`NEAR_PIVOT_${data.pivotPoints.nearestPivot.type.toUpperCase()}`);
        }
        if (data.pivotPoints?.nearestPivot?.isTesting) {
            patterns.push(`TESTING_PIVOT`);
        }
        if (data.trendLines && data.trendLines.length > 0) {
            const strongLines = data.trendLines.filter(line => 
                line.valid && line.points >= 3
            ).length;
            if (strongLines >= 2) {
                patterns.push('MULTIPLE_TRENDLINES');
            }
        }
        if (data.trendLines?.some(line => line.recentBreakout)) {
            patterns.push('RECENT_TRENDLINE_BREAKOUT');
        }

        return patterns;
    }

    async optimizeParameters(closedTrades) {
        try {
            const volumeAnalysis = this.analyzeParameter(
                closedTrades,
                t => t.marketData.volumeRatio,
                [1.3, 1.5, 1.7, 1.9, 2.1],
                VOLUME_SETTINGS.baseThreshold
            );

            if (volumeAnalysis.bestValue && volumeAnalysis.winRate > 0.6) {
                const adjustment = (volumeAnalysis.bestValue - VOLUME_SETTINGS.baseThreshold) * 0.1;
                VOLUME_SETTINGS.baseThreshold += adjustment;
                VOLUME_SETTINGS.baseThreshold = Math.max(1.3, Math.min(2.0, VOLUME_SETTINGS.baseThreshold));

                this.parameterEvolution.volumeThreshold.push({
                    timestamp: Date.now(),
                    old: VOLUME_SETTINGS.baseThreshold - adjustment,
                    new: VOLUME_SETTINGS.baseThreshold,
                    winRate: volumeAnalysis.winRate
                });
            }

            const adxAnalysis = this.analyzeParameter(
                closedTrades,
                t => t.marketData.adx1h,
                [18, 20, 22, 24, 26, 28],
                ADX_1H_SETTINGS.minStrength
            );

            if (adxAnalysis.bestValue && adxAnalysis.winRate > 0.6) {
                const adjustment = (adxAnalysis.bestValue - ADX_1H_SETTINGS.minStrength) * 0.1;
                ADX_1H_SETTINGS.minStrength += adjustment;
                ADX_1H_SETTINGS.minStrength = Math.max(18, Math.min(30, ADX_1H_SETTINGS.minStrength));

                this.parameterEvolution.adxThreshold.push({
                    timestamp: Date.now(),
                    old: ADX_1H_SETTINGS.minStrength - adjustment,
                    new: ADX_1H_SETTINGS.minStrength,
                    winRate: adxAnalysis.winRate
                });
            }

            const divergenceAnalysis = this.analyzeDivergence(closedTrades);
            if (divergenceAnalysis.bestWinRate > 0.6) {
                this.parameterEvolution.divergence.push({
                    timestamp: Date.now(),
                    analysis: divergenceAnalysis,
                    winRate: divergenceAnalysis.bestWinRate
                });
            }

            const breakoutAnalysis = this.analyzeBreakoutRisk(closedTrades);
            if (breakoutAnalysis.bestWinRate > 0.6) {
                this.parameterEvolution.breakoutRisk.push({
                    timestamp: Date.now(),
                    analysis: breakoutAnalysis,
                    winRate: breakoutAnalysis.bestWinRate
                });
            }

            // NOVO: Análise de Pivot Points
            const pivotAnalysis = this.analyzePivotPoints(closedTrades);
            if (pivotAnalysis.bestWinRate > 0.6) {
                this.parameterEvolution.pivotPoints.push({
                    timestamp: Date.now(),
                    analysis: pivotAnalysis,
                    winRate: pivotAnalysis.bestWinRate
                });
            }

            // NOVO: Análise de Trend Lines
            const trendlineAnalysis = this.analyzeTrendLines(closedTrades);
            if (trendlineAnalysis.bestWinRate > 0.6) {
                this.parameterEvolution.trendLines.push({
                    timestamp: Date.now(),
                    analysis: trendlineAnalysis,
                    winRate: trendlineAnalysis.bestWinRate
                });
            }

            console.log(`⚙️  Parâmetros otimizados: Volume=${VOLUME_SETTINGS.baseThreshold.toFixed(2)}, ADX=${ADX_1H_SETTINGS.minStrength.toFixed(1)}`);
            this.saveLearningData();

        } catch (error) {
            console.error('Erro na otimização:', error);
        }
    }

    // NOVO: Análise de Pivot Points
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

    // NOVO: Análise de Trend Lines
    analyzeTrendLines(closedTrades) {
        const patterns = {
            nearTrendline: { wins: 0, total: 0 },
            trendlineBreakout: { wins: 0, total: 0 },
            multipleTrendlines: { wins: 0, total: 0 },
            noTrendlines: { wins: 0, total: 0 }
        };

        closedTrades.forEach(trade => {
            const data = trade.marketData.trendLines;

            if (data && data.length > 0) {
                const nearTrendline = data.some(line => 
                    line.valid && Math.abs(line.distancePercent) <= 1.0
                );
                const hasBreakout = data.some(line => line.recentBreakout);
                const multipleLines = data.filter(line => 
                    line.valid && line.points >= 3
                ).length >= 2;

                if (hasBreakout) {
                    patterns.trendlineBreakout.total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns.trendlineBreakout.wins++;
                    }
                } else if (nearTrendline) {
                    patterns.nearTrendline.total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns.nearTrendline.wins++;
                    }
                } else if (multipleLines) {
                    patterns.multipleTrendlines.total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns.multipleTrendlines.wins++;
                    }
                }
            } else {
                patterns.noTrendlines.total++;
                if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                    patterns.noTrendlines.wins++;
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

    analyzeDivergence(closedTrades) {
        const patterns = {
            bullish: { wins: 0, total: 0 },
            bearish: { wins: 0, total: 0 },
            hiddenBullish: { wins: 0, total: 0 },
            hiddenBearish: { wins: 0, total: 0 }
        };

        closedTrades.forEach(trade => {
            const data = trade.marketData.divergence15m;

            if (data?.hasDivergence) {
                const type = data.type;
                if (patterns[type]) {
                    patterns[type].total++;
                    if (trade.outcome === 'SUCCESS' || trade.outcome === 'ALL_TARGETS_HIT' || trade.outcome === 'PARTIAL_TARGETS_HIT') {
                        patterns[type].wins++;
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
                this.patterns = data.patterns || this.patterns;
                this.parameterEvolution = data.parameterEvolution || this.parameterEvolution;

                console.log(`📊 Aprendizado: ${this.tradeHistory.length} trades carregados`);
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

        const winRate = closedTrades.length > 0 ? winners.length / closedTrades.length : 0;
        const avgProfit = winners.length > 0 ?
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        const avgLoss = losers.length > 0 ?
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;

        const profitFactor = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;

        const winningPatterns = Object.entries(this.patterns.winning)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const losingPatterns = Object.entries(this.patterns.losing)
            .filter(([_, count]) => count >= 2)
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
            totalTrades: closedTrades.length,
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

    // Método adicionado para enviar relatório de performance
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
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS COM NOVO FORMATO
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);

        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        const lsrRatio = signal.marketData.lsr?.lsrRatio || 0;
        const lsrDetails = signal.marketData.lsr?.rawData ? 
            `(H:${signal.marketData.lsr.rawData.high.toFixed(6)} C:${signal.marketData.lsr.rawData.close.toFixed(6)} L:${signal.marketData.lsr.rawData.low.toFixed(6)})` : 
            '';
        const baseProbability = calculateProbability(signal);
        const riskAdjustedProbability = Math.max(30, Math.min(95, baseProbability - (riskAssessment.overallScore * 2)));

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        // NOVO: Dados de Pivot Points
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';

        // NOVO: Dados de Trend Lines
        const trendlineData = signal.marketData.trendLines;
        const relevantTrendlines = trendlineData?.filter(tl => tl.valid) || [];
        const nearestTrendline = relevantTrendlines.length > 0 ? relevantTrendlines[0] : null;
        const trendlineDistance = nearestTrendline?.distancePercent?.toFixed(2) || 'N/A';

        const riskEmoji = riskAssessment.level === 'CRITICAL' ? '🚨' :
            riskAssessment.level === 'HIGH' ? '🔴' :
                riskAssessment.level === 'MEDIUM' ? '🟡' : '🟢';

        const now = getBrazilianDateTime();

        // FORMATO ATUALIZADO COM PIVOT POINTS E TREND LINES
        let message = `
${directionEmoji} <b>${signal.symbol} - ${direction}</b>
${now.full}

<i> Análise Técnica</i>
⚠️ Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
• Preço: $${signal.price.toFixed(6)}
• Vol: ${volumeRatio.toFixed(2)}x | Dist S/R: ${distancePercent}%
• Pivot: ${pivotType} ${pivotDistance}% | Trend Line: ${trendlineDistance}%

<i>🤖 IA Titanium Análise </i>
• Nível: ${riskEmoji} ${riskAssessment.level} | Score: ${riskAssessment.overallScore.toFixed(2)}
⚠️ Confiança da IA: ${riskAssessment.confidence}%
${riskAssessment.warnings.length > 0 ? `• ${riskAssessment.warnings[0]}` : ''}

<i> 💡Entrada 2 é a melhor: </i>
• Liquidez 1 : $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
<i> Alvos:</i>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
⛔Stop: $${signal.targetsData.stopPrice.toFixed(6)}
<i>✨Titanium by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);

        console.log(`\n📤 Alerta enviado: ${signal.symbol} ${direction}`);
        console.log(`   Data/Hora: ${now.full}`);
        console.log(`   Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})`);
        console.log(`   Probabilidade: ${riskAdjustedProbability}%`);
        console.log(`   Risk Level: ${riskAssessment.level} (Score: ${riskAssessment.overallScore.toFixed(2)})`);
        console.log(`   Confiança: ${riskAssessment.confidence}%`);
        console.log(`   Volume: ${volumeRatio.toFixed(2)}x | LSR: ${lsrRatio.toFixed(2)}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% | Trend Line: ${trendlineDistance}%`);

    } catch (error) {
        console.error('Erro ao enviar alerta com risk layer:', error.message);
        // Fallback para o alerta simples se houver erro
        await sendSignalAlert(signal);
    }
}

async function sendSignalAlert(signal) {
    try {
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';

        const now = getBrazilianDateTime();

        const volumeRatio = signal.marketData.volume?.rawRatio || 0;
        const lsrRatio = signal.marketData.lsr?.lsrRatio || 0;
        const lsrDetails = signal.marketData.lsr?.rawData ? 
            `(H:${signal.marketData.lsr.rawData.high.toFixed(6)} C:${signal.marketData.lsr.rawData.close.toFixed(6)} L:${signal.marketData.lsr.rawData.low.toFixed(6)})` : 
            '';
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        // NOVO: Dados de Pivot Points
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';

        const message = `
${directionEmoji} <b>${signal.symbol} - ${direction}</b>
${now.full}

<b>🎯 ANÁLISE TÉCNICA</b>
• Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
• Probabilidade de Sucesso: ${baseProbability}%
• Preço: $${signal.price.toFixed(6)} | Stop: $${signal.targetsData.stopPrice.toFixed(6)}
• Volume: ${volumeRatio.toFixed(2)}x | LSR: ${lsrRatio.toFixed(2)} ${lsrDetails}
• Dist S/R: ${distancePercent}% | Pivot: ${pivotDistance}%

<b> Alvos </b>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}

<b>📍 ENTRADA</b>
• Liquidez 1: $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}

<i>✨🤖IA Titanium by @J4Rviz</i>
        `;

        await sendTelegramAlert(message);

        console.log(`📤 Alerta enviado: ${signal.symbol} ${direction}`);
        console.log(`   Data/Hora: ${now.full}`);
        console.log(`   LSR: ${lsrRatio.toFixed(2)} ${lsrDetails}`);
        console.log(`   Pivot Distance: ${pivotDistance}%`);

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
    let baseProbability = 65; // Base mais realista

    baseProbability += (signal.qualityScore.score - 70) * 0.4; // Ajuste mais suave

    const volumeRatio = signal.marketData.volume?.rawRatio || 0;
    if (volumeRatio >= 2.0) baseProbability += 8;
    else if (volumeRatio >= 1.5) baseProbability += 4;

    const srData = signal.marketData.supportResistance;
    const nearestLevel = signal.isBullish ?
        srData?.nearestResistance : srData?.nearestSupport;
    const distance = nearestLevel?.distancePercent || 0;

    if (distance >= 3.0) baseProbability += 6;
    else if (distance >= 2.0) baseProbability += 3;
    else if (distance < 0.8) baseProbability -= 15; // Penalidade maior se muito próximo

    if (signal.marketData.divergence15m?.hasDivergence && signal.marketData.divergence15m.confirmed) {
        baseProbability += 10;
    }

    // Ajuste baseado no nível de risco
    if (signal.marketData.breakoutRisk?.level === 'high') baseProbability -= 12;
    if (signal.marketData.breakoutRisk?.level === 'low') baseProbability += 5;

    // NOVO: Ajuste baseado em Pivot Points
    const pivotData = signal.marketData.pivotPoints;
    if (pivotData?.nearestPivot) {
        const pivotDistance = pivotData.nearestPivot.distancePercent || 0;
        if (pivotDistance < 0.5) {
            baseProbability -= 10; // Muito próximo de pivot
        } else if (pivotDistance < 1.0) {
            baseProbability -= 5; // Próximo de pivot
        } else if (pivotDistance > 2.0) {
            baseProbability += 5; // Boa distância de pivot
        }
        
        if (pivotData.nearestPivot.isTesting) {
            baseProbability -= 8; // Testando pivot
        }
    }

    // NOVO: Ajuste baseado em Trend Lines
    const trendlineData = signal.marketData.trendLines;
    if (trendlineData && trendlineData.length > 0) {
        const validLines = trendlineData.filter(tl => tl.valid);
        if (validLines.length >= 2) {
            baseProbability += 5; // Múltiplas trend lines válidas
        }
        
        const nearLines = validLines.filter(tl => Math.abs(tl.distancePercent) < 1.0);
        if (nearLines.length > 0) {
            baseProbability -= 3; // Próximo de trend line
        }
    }

    return Math.min(92, Math.max(35, Math.round(baseProbability))); // Range mais conservador
}

// =====================================================================
// 📊 NOVAS FUNÇÕES PARA PONTOS DE PIVÔ
// =====================================================================

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, PIVOT_POINT_SETTINGS.timeframe, 
            PIVOT_POINT_SETTINGS.lookbackPeriod + 20);

        if (candles.length < PIVOT_POINT_SETTINGS.lookbackPeriod) {
            return { error: 'Dados insuficientes' };
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        // Encontrar pivots (máximos e mínimos locais)
        const pivotHighs = findPivotHighs(highs, PIVOT_POINT_SETTINGS.minCandlesBetweenPivots);
        const pivotLows = findPivotLows(lows, PIVOT_POINT_SETTINGS.minCandlesBetweenPivots);

        // Classificar pivots por força
        const supportPivots = classifyPivots(pivotLows, 'support', candles);
        const resistancePivots = classifyPivots(pivotHighs, 'resistance', candles);

        // Encontrar pivots mais próximos
        const nearestSupportPivot = findNearestPivot(supportPivots, currentPrice, true);
        const nearestResistancePivot = findNearestPivot(resistancePivots, currentPrice, false);

        // Verificar se está testando algum pivot
        const testingPivot = checkTestingPivot(currentPrice, supportPivots, resistancePivots, candles);

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
                { ...nearestSupportPivot, distancePercent: supportDistancePercent } : 
                { ...nearestResistancePivot, distancePercent: resistanceDistancePercent };
        } else if (nearestSupportPivot) {
            nearestPivot = { ...nearestSupportPivot, distancePercent: supportDistancePercent };
        } else if (nearestResistancePivot) {
            nearestPivot = { ...nearestResistancePivot, distancePercent: resistanceDistancePercent };
        }

        return {
            supports: supportPivots,
            resistances: resistancePivots,
            nearestSupport: nearestSupportPivot ? {
                price: nearestSupportPivot.price,
                strength: nearestSupportPivot.strength,
                distance: currentPrice - nearestSupportPivot.price,
                distancePercent: supportDistancePercent,
                touches: nearestSupportPivot.touches
            } : null,
            nearestResistance: nearestResistancePivot ? {
                price: nearestResistancePivot.price,
                strength: nearestResistancePivot.strength,
                distance: nearestResistancePivot.price - currentPrice,
                distancePercent: resistanceDistancePercent,
                touches: nearestResistancePivot.touches
            } : null,
            nearestPivot: nearestPivot ? {
                type: nearestPivot.type,
                price: nearestPivot.price,
                strength: nearestPivot.strength,
                distancePercent: nearestPivot.distancePercent,
                isTesting: testingPivot?.price === nearestPivot.price,
                touches: nearestPivot.touches
            } : null,
            testingPivot: testingPivot,
            currentPrice: currentPrice,
            totalPivots: supportPivots.length + resistancePivots.length
        };

    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        return { error: error.message };
    }
}

function findPivotHighs(highs, minDistance) {
    const pivots = [];
    
    for (let i = minDistance; i < highs.length - minDistance; i++) {
        let isPivot = true;
        
        // Verificar se é máximo local
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
        
        // Verificar se é mínimo local
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

function classifyPivots(pivots, type, candles) {
    const classified = [];
    
    for (const pivot of pivots) {
        // Contar toques neste nível
        let touches = 1;
        for (let i = pivot.index + 1; i < candles.length; i++) {
            const candle = candles[i];
            const priceRange = pivot.price * 0.005; // 0.5% de tolerância
            
            if ((type === 'support' && candle.low <= pivot.price + priceRange && candle.low >= pivot.price - priceRange) ||
                (type === 'resistance' && candle.high <= pivot.price + priceRange && candle.high >= pivot.price - priceRange)) {
                touches++;
            }
        }
        
        // Determinar força baseada no número de toques
        let strength = 'weak';
        if (touches >= PIVOT_POINT_SETTINGS.pivotStrength.strong) {
            strength = 'strong';
        } else if (touches >= PIVOT_POINT_SETTINGS.pivotStrength.moderate) {
            strength = 'moderate';
        }
        
        classified.push({
            price: pivot.price,
            type: type,
            strength: strength,
            touches: touches,
            index: pivot.index
        });
    }
    
    return classified;
}

function findNearestPivot(pivots, currentPrice, isSupport) {
    if (pivots.length === 0) return null;
    
    let nearest = null;
    let minDistance = Infinity;
    
    for (const pivot of pivots) {
        const distance = Math.abs(currentPrice - pivot.price);
        
        if (distance < minDistance) {
            // Para suporte: pivot deve estar abaixo do preço atual
            // Para resistência: pivot deve estar acima do preço atual
            if ((isSupport && pivot.price < currentPrice) || 
                (!isSupport && pivot.price > currentPrice)) {
                minDistance = distance;
                nearest = pivot;
            }
        }
    }
    
    return nearest;
}

function checkTestingPivot(currentPrice, supportPivots, resistancePivots, candles) {
    const recentCandles = candles.slice(-5);
    const tolerance = currentPrice * 0.005; // 0.5% de tolerância
    
    // Verificar suportes
    for (const support of supportPivots) {
        for (const candle of recentCandles) {
            if (Math.abs(candle.low - support.price) <= tolerance) {
                return {
                    price: support.price,
                    type: 'support',
                    strength: support.strength,
                    candleTime: new Date(candle.time).toLocaleTimeString(),
                    distance: Math.abs(currentPrice - support.price)
                };
            }
        }
    }
    
    // Verificar resistências
    for (const resistance of resistancePivots) {
        for (const candle of recentCandles) {
            if (Math.abs(candle.high - resistance.price) <= tolerance) {
                return {
                    price: resistance.price,
                    type: 'resistance',
                    strength: resistance.strength,
                    candleTime: new Date(candle.time).toLocaleTimeString(),
                    distance: Math.abs(currentPrice - resistance.price)
                };
            }
        }
    }
    
    return null;
}

// =====================================================================
// 📊 NOVAS FUNÇÕES PARA TREND LINES
// =====================================================================

async function analyzeTrendLines(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, PIVOT_POINT_SETTINGS.timeframe, 
            PIVOT_POINT_SETTINGS.lookbackPeriod + 30);

        if (candles.length < PIVOT_POINT_SETTINGS.lookbackPeriod) {
            return [];
        }

        // Encontrar pivots para construir trend lines
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        const pivotHighs = findPivotHighs(highs, PIVOT_POINT_SETTINGS.minCandlesBetweenPivots);
        const pivotLows = findPivotLows(lows, PIVOT_POINT_SETTINGS.minCandlesBetweenPivots);
        
        // Construir trend lines de suporte (ligando mínimos)
        const supportTrendLines = buildTrendLines(pivotLows, 'support', candles);
        
        // Construir trend lines de resistência (ligando máximos)
        const resistanceTrendLines = buildTrendLines(pivotHighs, 'resistance', candles);
        
        // Combinar todas as trend lines
        const allTrendLines = [...supportTrendLines, ...resistanceTrendLines];
        
        // Filtrar apenas as válidas
        const validTrendLines = allTrendLines.filter(line => 
            line.valid && 
            line.points >= PIVOT_POINT_SETTINGS.trendline.minPoints &&
            line.angle >= PIVOT_POINT_SETTINGS.trendline.minAngle &&
            line.angle <= PIVOT_POINT_SETTINGS.trendline.maxAngle
        );
        
        // Calcular distância atual para cada trend line
        validTrendLines.forEach(line => {
            line.currentValue = calculateTrendLineValue(line, candles.length - 1);
            line.distance = currentPrice - line.currentValue;
            line.distancePercent = (Math.abs(line.distance) / currentPrice) * 100;
            
            // Verificar breakout recente
            line.recentBreakout = checkTrendLineBreakout(line, candles);
        });
        
        // Ordenar por proximidade
        validTrendLines.sort((a, b) => 
            Math.abs(a.distancePercent) - Math.abs(b.distancePercent)
        );
        
        return validTrendLines;

    } catch (error) {
        console.log(`⚠️ Erro análise trend lines ${symbol}: ${error.message}`);
        return [];
    }
}

function buildTrendLines(pivots, type, candles) {
    const trendLines = [];
    
    if (pivots.length < PIVOT_POINT_SETTINGS.trendline.minPoints) {
        return trendLines;
    }
    
    // Ordenar pivots por índice (tempo)
    pivots.sort((a, b) => a.index - b.index);
    
    // Tentar criar trend lines conectando múltiplos pivots
    for (let i = 0; i < pivots.length - 1; i++) {
        for (let j = i + 1; j < pivots.length; j++) {
            const startPivot = pivots[i];
            const endPivot = pivots[j];
            
            // Calcular coeficientes da linha (y = mx + b)
            const m = (endPivot.price - startPivot.price) / (endPivot.index - startPivot.index);
            const b = startPivot.price - (m * startPivot.index);
            
            // Encontrar outros pivots que se alinham com esta linha
            const alignedPivots = [startPivot, endPivot];
            
            for (let k = 0; k < pivots.length; k++) {
                if (k !== i && k !== j) {
                    const pivot = pivots[k];
                    const expectedPrice = (m * pivot.index) + b;
                    const deviation = Math.abs(pivot.price - expectedPrice) / expectedPrice * 100;
                    
                    if (deviation <= PIVOT_POINT_SETTINGS.trendline.maxDeviationPercent) {
                        alignedPivots.push(pivot);
                    }
                }
            }
            
            // Se tivermos pontos suficientes, criar a trend line
            if (alignedPivots.length >= PIVOT_POINT_SETTINGS.trendline.minPoints) {
                // Calcular ângulo da trend line (em graus)
                const xDiff = endPivot.index - startPivot.index;
                const yDiff = endPivot.price - startPivot.price;
                const angle = Math.atan2(yDiff, xDiff) * (180 / Math.PI);
                
                // Determinar se a trend line é válida (ângulo não muito raso nem muito íngreme)
                if (Math.abs(angle) >= PIVOT_POINT_SETTINGS.trendline.minAngle && 
                    Math.abs(angle) <= PIVOT_POINT_SETTINGS.trendline.maxAngle) {
                    
                    trendLines.push({
                        type: type,
                        startIndex: startPivot.index,
                        startPrice: startPivot.price,
                        endIndex: endPivot.index,
                        endPrice: endPivot.price,
                        slope: m,
                        intercept: b,
                        points: alignedPivots.length,
                        angle: Math.abs(angle),
                        valid: true,
                        pivots: alignedPivots.map(p => ({
                            index: p.index,
                            price: p.price,
                            time: candles[p.index].time
                        }))
                    });
                }
            }
        }
    }
    
    // Remover trend lines duplicadas (com coeficientes muito similares)
    const uniqueTrendLines = [];
    const seenSlopes = new Set();
    
    for (const line of trendLines) {
        const slopeKey = line.slope.toFixed(6);
        if (!seenSlopes.has(slopeKey)) {
            seenSlopes.add(slopeKey);
            uniqueTrendLines.push(line);
        }
    }
    
    return uniqueTrendLines;
}

function calculateTrendLineValue(trendLine, index) {
    return (trendLine.slope * index) + trendLine.intercept;
}

function checkTrendLineBreakout(trendLine, candles) {
    const recentCandles = candles.slice(-10); // Últimos 10 candles
    const tolerance = 0.002; // 0.2% de tolerância
    
    for (let i = 0; i < recentCandles.length; i++) {
        const candle = recentCandles[i];
        const trendLineValue = calculateTrendLineValue(trendLine, candles.length - recentCandles.length + i);
        
        if (trendLine.type === 'support') {
            // Breakout de suporte: candle fecha abaixo da trend line
            if (candle.close < trendLineValue - (trendLineValue * tolerance)) {
                return {
                    broken: true,
                    candleIndex: i,
                    price: candle.close,
                    trendLineValue: trendLineValue,
                    withinLast5Candles: i < 5
                };
            }
        } else if (trendLine.type === 'resistance') {
            // Breakout de resistência: candle fecha acima da trend line
            if (candle.close > trendLineValue + (trendLineValue * tolerance)) {
                return {
                    broken: true,
                    candleIndex: i,
                    price: candle.close,
                    trendLineValue: trendLineValue,
                    withinLast5Candles: i < 5
                };
            }
        }
    }
    
    return null;
}

// =====================================================================
// 📊 FUNÇÕES AVANÇADAS PARA SUPORTE/RESISTÊNCIA E RISCO DE ROMPIMENTO
// =====================================================================

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

// =====================================================================
// 📊 FUNÇÃO PARA DETECTAR DIVERGÊNCIAS 15M
// =====================================================================

async function checkDivergence15m(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '15m', DIVERGENCE_SETTINGS.lookbackPeriod + 10);
        if (candles.length < DIVERGENCE_SETTINGS.lookbackPeriod) {
            return { hasDivergence: false };
        }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

        const rsiValues = RSI.calculate({
            values: closes,
            period: DIVERGENCE_SETTINGS.rsiPeriod
        });

        if (!rsiValues || rsiValues.length < 10) {
            return { hasDivergence: false };
        }

        const priceHighs = findLocalHighs(highs, DIVERGENCE_SETTINGS.minCandleDistance);
        const priceLows = findLocalLows(lows, DIVERGENCE_SETTINGS.minCandleDistance);

        const rsiHighs = findLocalHighs(rsiValues, DIVERGENCE_SETTINGS.minCandleDistance);
        const rsiLows = findLocalLows(rsiValues, DIVERGENCE_SETTINGS.minCandleDistance);

        const regularDivergence = findRegularDivergence(priceHighs, priceLows, rsiHighs, rsiLows, candles);

        const hiddenDivergence = findHiddenDivergence(priceHighs, priceLows, rsiHighs, rsiLows, candles);

        let bestDivergence = null;
        let divergenceType = null;

        if (regularDivergence) {
            bestDivergence = regularDivergence;
            divergenceType = regularDivergence.type;
        } else if (hiddenDivergence) {
            bestDivergence = hiddenDivergence;
            divergenceType = hiddenDivergence.type;
        }

        let confirmed = false;
        if (bestDivergence) {
            confirmed = checkDivergenceConfirmation(bestDivergence, candles, isBullish);
        }

        const hasDivergence = bestDivergence !== null;

        return {
            hasDivergence: hasDivergence,
            type: divergenceType,
            confirmed: confirmed,
            details: bestDivergence,
            priceHighs: priceHighs.slice(-3),
            priceLows: priceLows.slice(-3),
            rsiHighs: rsiHighs.slice(-3),
            rsiLows: rsiLows.slice(-3),
            currentRSI: rsiValues[rsiValues.length - 1]
        };

    } catch (error) {
        console.log(`⚠️ Erro análise divergência ${symbol}: ${error.message}`);
        return { hasDivergence: false };
    }
}

function findLocalHighs(data, minDistance) {
    const highs = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
        let isLocalHigh = true;
        for (let j = i - minDistance; j <= i + minDistance; j++) {
            if (j !== i && data[j] > data[i]) {
                isLocalHigh = false;
                break;
            }
        }
        if (isLocalHigh) {
            highs.push({ index: i, value: data[i] });
        }
    }
    return highs;
}

function findLocalLows(data, minDistance) {
    const lows = [];
    for (let i = minDistance; i < data.length - minDistance; i++) {
        let isLocalLow = true;
        for (let j = i - minDistance; j <= i + minDistance; j++) {
            if (j !== i && data[j] < data[i]) {
                isLocalLow = false;
                break;
            }
        }
        if (isLocalLow) {
            lows.push({ index: i, value: data[i] });
        }
    }
    return lows;
}

function findRegularDivergence(priceHighs, priceLows, rsiHighs, rsiLows, candles) {
    if (priceLows.length >= 2 && rsiLows.length >= 2) {
        const lastPriceLow = priceLows[priceLows.length - 1];
        const prevPriceLow = priceLows[priceLows.length - 2];
        const lastRSILow = rsiLows[rsiLows.length - 1];
        const prevRSILow = rsiLows[rsiLows.length - 2];

        if (lastPriceLow.index > prevPriceLow.index &&
            lastRSILow.index > prevRSILow.index &&
            lastPriceLow.value < prevPriceLow.value &&
            lastRSILow.value > prevRSILow.value) {

            return {
                type: 'bullish',
                priceLow1: prevPriceLow.value,
                priceLow2: lastPriceLow.value,
                rsiLow1: prevRSILow.value,
                rsiLow2: lastRSILow.value,
                candlesBetween: lastPriceLow.index - prevPriceLow.index
            };
        }
    }

    if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
        const lastPriceHigh = priceHighs[priceHighs.length - 1];
        const prevPriceHigh = priceHighs[priceHighs.length - 2];
        const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
        const prevRSIHigh = rsiHighs[rsiHighs.length - 2];

        if (lastPriceHigh.index > prevPriceHigh.index &&
            lastRSIHigh.index > prevRSIHigh.index &&
            lastPriceHigh.value > prevPriceHigh.value &&
            lastRSIHigh.value < prevRSIHigh.value) {

            return {
                type: 'bearish',
                priceHigh1: prevPriceHigh.value,
                priceHigh2: lastPriceHigh.value,
                rsiHigh1: prevRSIHigh.value,
                rsiHigh2: lastRSIHigh.value,
                candlesBetween: lastPriceHigh.index - prevPriceHigh.index
            };
        }
    }

    return null;
}

function findHiddenDivergence(priceHighs, priceLows, rsiHighs, rsiLows, candles) {
    if (priceLows.length >= 2 && rsiLows.length >= 2) {
        const lastPriceLow = priceLows[priceLows.length - 1];
        const prevPriceLow = priceLows[priceLows.length - 2];
        const lastRSILow = rsiLows[rsiLows.length - 1];
        const prevRSILow = rsiLows[rsiLows.length - 2];

        if (lastPriceLow.index > prevPriceLow.index &&
            lastRSILow.index > prevRSILow.index &&
            lastPriceLow.value > prevPriceLow.value &&
            lastRSILow.value < prevRSILow.value) {

            return {
                type: 'hiddenBullish',
                priceLow1: prevPriceLow.value,
                priceLow2: lastPriceLow.value,
                rsiLow1: prevRSILow.value,
                rsiLow2: lastRSILow.value,
                candlesBetween: lastPriceLow.index - prevPriceLow.index
            };
        }
    }

    if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
        const lastPriceHigh = priceHighs[priceHighs.length - 1];
        const prevPriceHigh = priceHighs[priceHighs.length - 2];
        const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
        const prevRSIHigh = rsiHighs[rsiHighs.length - 2];

        if (lastPriceHigh.index > prevPriceHigh.index &&
            lastRSIHigh.index > prevRSIHigh.index &&
            lastPriceHigh.value < prevPriceHigh.value &&
            lastRSIHigh.value > prevRSIHigh.value) {

            return {
                type: 'hiddenBearish',
                priceHigh1: prevPriceHigh.value,
                priceHigh2: lastPriceHigh.value,
                rsiHigh1: prevRSIHigh.value,
                rsiHigh2: lastRSIHigh.value,
                candlesBetween: lastPriceHigh.index - prevPriceHigh.index
            };
        }
    }

    return null;
}

function checkDivergenceConfirmation(divergence, candles, isBullish) {
    if (!divergence) return false;

    const lastIndex = candles.length - 1;
    const divergenceIndex = divergence.type.includes('bullish') ?
        divergence.priceLow2?.index || lastIndex - 5 :
        divergence.priceHigh2?.index || lastIndex - 5;

    const candlesAfterDivergence = lastIndex - divergenceIndex;

    if (candlesAfterDivergence < DIVERGENCE_SETTINGS.confirmationCandles) {
        return false;
    }

    if (divergence.type === 'bullish' || divergence.type === 'hiddenBullish') {
        const divergencePrice = divergence.priceLow2?.value || candles[divergenceIndex].low;
        const currentPrice = candles[lastIndex].close;
        return currentPrice > divergencePrice;
    }

    if (divergence.type === 'bearish' || divergence.type === 'hiddenBearish') {
        const divergencePrice = divergence.priceHigh2?.value || candles[divergenceIndex].high;
        const currentPrice = candles[lastIndex].close;
        return currentPrice < divergencePrice;
    }

    return false;
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
🚀 <b>TITANIUM ATIVADO COM TRAILING SIMULATION E PIVOT POINTS</b>

${brazilTime.full}
🧠 Sistema de aprendizado aprimorado com trailing simulation
📊 Análise avançada de Pivot Points e Trend Lines
🎯 Detecção de padrões de suporte/resistência dinâmicos
⏱️ Verificação precisa da ordem dos eventos
🔧 by @J4Rviz.
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
            console.log('🚀 TITANIUM ATIVADO COM TRAILING SIMULATION E PIVOT POINTS');
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
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h'
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
        return {
            value: latestRSI,
            raw: latestRSI,
            status: latestRSI < 30 ? 'OVERSOLD' : latestRSI > 70 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 50);
        if (candles.length < 20) return { rawRatio: 0, isAbnormal: false };

        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

        const ratio = currentVolume / avgVolume;

        return {
            rawRatio: ratio,
            isAbnormal: ratio >= VOLUME_SETTINGS.baseThreshold
        };
    } catch (error) {
        return { rawRatio: 0, isAbnormal: false };
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
// ✅ FUNÇÃO checkLSR CORRIGIDA - LSR DO GRÁFICO DE 15 MINUTOS
// =====================================================================

async function checkLSR(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, LSR_TIMEFRAME, 50);
        if (candles.length < 2) return { lsrRatio: 0, isValid: false };

        const lastCandle = candles[candles.length - 1];
        
        // CORREÇÃO: O LSR deve ser calculado como (High - Close) / (Close - Low)
        const currentHigh = lastCandle.high;
        const currentLow = lastCandle.low;
        const currentClose = lastCandle.close;

        // Cálculo correto do LSR
        const numerator = currentHigh - currentClose;
        const denominator = currentClose - currentLow;
        
        let lsrRatio = 0;
        
        if (denominator !== 0) {
            lsrRatio = numerator / denominator;
        } else {
            // Se denominador for zero, usar um valor padrão baseado no numerador
            lsrRatio = numerator > 0 ? 10 : 0.1; // Valores extremos para indicar tendência
        }

        // Validação baseada na direção
        const isValid = isBullish ? 
            lsrRatio <= LSR_BUY_THRESHOLD :  // Para compra, queremos LSR baixo (mais vendas)
            lsrRatio > LSR_SELL_THRESHOLD;   // Para venda, queremos LSR alto (mais compras)

        console.log(`📊 LSR ${symbol} (15m):`);
        console.log(`   High: ${currentHigh.toFixed(6)}, Low: ${currentLow.toFixed(6)}, Close: ${currentClose.toFixed(6)}`);
        console.log(`   Cálculo: (${currentHigh.toFixed(6)}-${currentClose.toFixed(6)})/(${currentClose.toFixed(6)}-${currentLow.toFixed(6)}) = ${numerator.toFixed(6)}/${denominator.toFixed(6)} = ${lsrRatio.toFixed(2)}`);
        console.log(`   Validação: ${lsrRatio.toFixed(2)} ${isBullish ? '≤' : '>'} ${isBullish ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD} = ${isValid}`);

        return {
            lsrRatio: lsrRatio,
            isValid: isValid,
            rawData: {
                high: currentHigh,
                low: currentLow,
                close: currentClose,
                numerator: numerator,
                denominator: denominator
            }
        };
    } catch (error) {
        console.error(`❌ Erro no cálculo do LSR para ${symbol}:`, error.message);
        return { lsrRatio: 0, isValid: false };
    }
}

// =====================================================================
// 📊 FUNÇÃO DE DEBUG PARA LSR
// =====================================================================

async function debugLSR(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 10);
        console.log(`\n🔍 DEBUG LSR para ${symbol}:`);
        console.log('Últimos 5 candles (15m):');
        
        for (let i = Math.max(0, candles.length - 5); i < candles.length; i++) {
            const candle = candles[i];
            const time = new Date(candle.time).toLocaleTimeString();
            const high = candle.high;
            const low = candle.low;
            const close = candle.close;
            const lsr = (high - close) / (close - low);
            
            console.log(`${time}: H=${high.toFixed(6)}, L=${low.toFixed(6)}, C=${close.toFixed(6)}, LSR=${lsr.toFixed(2)}`);
        }
        
        // Testar para compra e venda
        const buyLSR = await checkLSR(symbol, true);
        const sellLSR = await checkLSR(symbol, false);
        
        console.log(`\nResultados para ${symbol}:`);
        console.log(`Compra (isBullish=true): LSR=${buyLSR.lsrRatio.toFixed(2)}, Válido=${buyLSR.isValid}`);
        console.log(`Venda (isBullish=false): LSR=${sellLSR.lsrRatio.toFixed(2)}, Válido=${sellLSR.isValid}`);
        
    } catch (error) {
        console.error(`Erro no debug do LSR:`, error.message);
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 80);
        if (candles.length < ADX_1H_SETTINGS.period + 5) return null;

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ADX_1H_SETTINGS.period
        });

        if (!adxValues || adxValues.length === 0) return null;

        const latestADX = adxValues[adxValues.length - 1];
        const adxValue = typeof latestADX === 'object' ? latestADX.adx : latestADX;

        if (typeof adxValue !== 'number' || isNaN(adxValue)) return null;

        return {
            raw: adxValue,
            hasMinimumStrength: adxValue >= ADX_1H_SETTINGS.minStrength
        };
    } catch (error) {
        return null;
    }
}

async function checkStochastic(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 30);
        if (candles.length < 20) return { isValid: false };

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: STOCH_SETTINGS.period,
            signalPeriod: STOCH_SETTINGS.signalPeriod
        });

        if (!stochValues || stochValues.length < 2) return { isValid: false };

        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];

        if (isBullish) {
            return {
                isValid: previous.k <= previous.d && current.k > current.d
            };
        } else {
            return {
                isValid: previous.k >= previous.d && current.k < current.d
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
            return { isValid: false, raw: 0 };
        }

        const fundingRate = parseFloat(data[0].fundingRate);
        const isValid = isBullish ? fundingRate <= FUNDING_BUY_MAX : fundingRate >= FUNDING_SELL_MIN;

        return {
            isValid: isValid,
            raw: fundingRate
        };
    } catch (error) {
        return { isValid: false, raw: 0 };
    }
}

// =====================================================================
// 📊 FUNÇÃO ATUALIZADA PARA CALCULAR QUALIDADE COM PIVOT POINTS E TREND LINES
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

    if (marketData.volume && marketData.volume.rawRatio >= VOLUME_SETTINGS.baseThreshold) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume,
            QUALITY_WEIGHTS.volume * (marketData.volume.rawRatio / 2.0));
        score += volumeScore;
        details.push(` Vol 3m: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (${marketData.volume.rawRatio.toFixed(2)}x)`);
    } else {
        failedChecks.push(`Vol 3m: ${marketData.volume?.rawRatio.toFixed(2) || 0}x < ${VOLUME_SETTINGS.baseThreshold}x`);
    }

    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(` Volatilidade 15m: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatilidade 15m: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}% < ${VOLATILITY_THRESHOLD}%`);
    }

    if (marketData.lsr && marketData.lsr.isValid) {
        const lsrScore = QUALITY_WEIGHTS.lsr;
        score += lsrScore;
        details.push(` LSR 15m: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${marketData.lsr.lsrRatio.toFixed(2)} ${isBullish ? '≤' : '>'} ${LSR_BUY_THRESHOLD})`);
    } else {
        failedChecks.push(`LSR 15m: ${marketData.lsr?.lsrRatio.toFixed(2) || 0} ${isBullish ? '>' : '≤'} ${LSR_BUY_THRESHOLD}`);
    }

    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;

        if (isBullish && rsiValue < 60) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} Sobrevendido)`);
        } else if (!isBullish && rsiValue > 60) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(` RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} Sobrecomprado`);
        } else {
            failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} ${isBullish ? '≥ 60' : '≤ 60'} (${isBullish ? 'RSI < 60' : ' RSI > 60'})`);
        }
        score += rsiScore;
    }

    if (marketData.adx1h && marketData.adx1h.raw >= ADX_1H_SETTINGS.minStrength) {
        const adxScore = QUALITY_WEIGHTS.adx1h;
        score += adxScore;
        details.push(` ADX 1h: ${adxScore}/${QUALITY_WEIGHTS.adx1h} (${marketData.adx1h.raw.toFixed(2)} ≥ ${ADX_1H_SETTINGS.minStrength})`);
    } else {
        failedChecks.push(`ADX 1h: ${marketData.adx1h?.raw?.toFixed(2) || 0} < ${ADX_1H_SETTINGS.minStrength}`);
    }

    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
            (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);

        if (isEmaValid) {
            const emaScore = QUALITY_WEIGHTS.emaAlignment;
            score += emaScore;
            details.push(` EMA 3m: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment}  ${isBullish ? 'bullish' : 'bearish'})`);
        } else {
            failedChecks.push(`EMA 3m: Alinhamento incorreto`);
        }
    }

    if (marketData.stoch && marketData.stoch.isValid) {
        const stochScore = QUALITY_WEIGHTS.stoch1h;
        score += stochScore;
        details.push(` Stoch 1h: ${stochScore}/${QUALITY_WEIGHTS.stoch1h} (cruzamento confirmado)`);
    } else {
        failedChecks.push(`Stoch 1h: Sem cruzamento`);
    }

    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        const stoch4hScore = QUALITY_WEIGHTS.stoch4h;
        score += stoch4hScore;
        details.push(` Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h}  ${isBullish ? 'bullish' : 'bearish'} `);
    } else {
        failedChecks.push(`Stoch 4h:  ${isBullish ? 'bullish' : 'bearish'} `);
    }

    if (marketData.cci4h && marketData.cci4h.isValid) {
        const cci4hScore = QUALITY_WEIGHTS.cci4h;
        score += cci4hScore;
        const deviation = marketData.cci4h.deviation.toFixed(2);
        details.push(` CCI 4h: ${cci4hScore}/${QUALITY_WEIGHTS.cci4h} (${marketData.cci4h.value.toFixed(2)} ${isBullish ? '>' : '<'} ${marketData.cci4h.maValue.toFixed(2)} MMS, dev: ${deviation})`);
    } else {
        failedChecks.push(`CCI 4h: ${marketData.cci4h?.value?.toFixed(2) || 0} ${isBullish ? '≤' : '≥'} ${marketData.cci4h?.maValue?.toFixed(2) || 0} MMS`);
    }

    if (marketData.oi && marketData.oi.isValid) {
        const oiScore = QUALITY_WEIGHTS.oi;
        score += oiScore;
        details.push(` OI: ${oiScore}/${QUALITY_WEIGHTS.oi} (${marketData.oi.trend} tendência)`);
    } else {
        failedChecks.push(`OI: Tendência ${marketData.oi?.trend || 'indefinida'} não confirma`);
    }

    if (marketData.funding && marketData.funding.isValid) {
        score += 5;
        details.push(` Fund. Rate: +5/${5} (${(marketData.funding.raw * 100).toFixed(4)}% ${isBullish ? 'negativo' : 'positivo'})`);
    }

    if (marketData.divergence15m && marketData.divergence15m.hasDivergence) {
        let divergenceScore = 0;
        let divergenceDetail = '';
        const divergence = marketData.divergence15m;

        const isAligned = (isBullish && (divergence.type === 'bullish' || divergence.type === 'hiddenBullish')) ||
            (!isBullish && (divergence.type === 'bearish' || divergence.type === 'hiddenBearish'));

        if (isAligned) {
            if (divergence.confirmed) {
                divergenceScore = QUALITY_WEIGHTS.divergence15m;
                divergenceDetail = `${divergenceScore}/${QUALITY_WEIGHTS.divergence15m} (${divergence.type.toUpperCase()} confirmada)`;
            } else {
                divergenceScore = QUALITY_WEIGHTS.divergence15m * 0.7;
                divergenceDetail = `${divergenceScore.toFixed(1)}/${QUALITY_WEIGHTS.divergence15m} (${divergence.type.toUpperCase()} não confirmada)`;
            }
        } else {
            divergenceScore = 0;
            divergenceDetail = `0/${QUALITY_WEIGHTS.divergence15m} (Divergência ${divergence.type} contra tendência)`;
            failedChecks.push(`Divergência: ${divergence.type} contra tendência ${isBullish ? 'bullish' : 'bearish'}`);
        }

        score += divergenceScore;
        details.push(` Divergência 15m: ${divergenceDetail}`);
    } else {
        failedChecks.push(`Divergência 15m: Nenhuma detectada`);
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

    // NOVO: Score para Pivot Points
    if (marketData.pivotPoints) {
        let pivotScore = 0;
        let pivotDetail = '';

        const nearestPivot = marketData.pivotPoints.nearestPivot;
        
        if (nearestPivot) {
            const distance = nearestPivot.distancePercent || 0;
            
            if (distance >= 2.0) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints;
                pivotDetail = `${pivotScore}/${QUALITY_WEIGHTS.pivotPoints} (Boa distância do pivot ${nearestPivot.type}: ${distance.toFixed(2)}%)`;
            } else if (distance >= 1.0) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.7;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Pivot ${nearestPivot.type} próximo: ${distance.toFixed(2)}%)`;
            } else if (distance >= 0.5) {
                pivotScore = QUALITY_WEIGHTS.pivotPoints * 0.3;
                pivotDetail = `${pivotScore.toFixed(1)}/${QUALITY_WEIGHTS.pivotPoints} (Muito próximo do pivot ${nearestPivot.type}: ${distance.toFixed(2)}%)`;
            } else {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (EXTREMAMENTE PRÓXIMO DO PIVOT ${nearestPivot.type.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${nearestPivot.type}: Muito próximo (${distance.toFixed(2)}%)`);
            }
            
            if (nearestPivot.isTesting) {
                pivotScore = 0;
                pivotDetail = `0/${QUALITY_WEIGHTS.pivotPoints} (TESTANDO PIVOT ${nearestPivot.type.toUpperCase()}!)`;
                failedChecks.push(`Pivot ${nearestPivot.type}: Testando nível`);
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

    // NOVO: Score para Trend Lines
    if (marketData.trendLines && marketData.trendLines.length > 0) {
        let trendlineScore = 0;
        let trendlineDetail = '';
        
        const validTrendLines = marketData.trendLines.filter(tl => tl.valid);
        
        if (validTrendLines.length > 0) {
            // Verificar se há trend lines próximas
            const nearTrendLines = validTrendLines.filter(tl => 
                Math.abs(tl.distancePercent) < 1.0
            );
            
            if (nearTrendLines.length === 0) {
                trendlineScore = QUALITY_WEIGHTS.trendLines;
                trendlineDetail = `${trendlineScore}/${QUALITY_WEIGHTS.trendLines} (${validTrendLines.length} trend lines válidas, distantes)`;
            } else {
                // Penalizar se muito próximo de trend line
                const nearest = nearTrendLines[0];
                trendlineScore = QUALITY_WEIGHTS.trendLines * 0.3;
                trendlineDetail = `${trendlineScore.toFixed(1)}/${QUALITY_WEIGHTS.trendLines} (Próximo da trend line ${nearest.type}: ${Math.abs(nearest.distancePercent).toFixed(2)}%)`;
                failedChecks.push(`Trend Line: Próximo da ${nearest.type} (${Math.abs(nearest.distancePercent).toFixed(2)}%)`);
            }
            
            // Bônus para múltiplas trend lines convergentes
            if (validTrendLines.length >= 2) {
                trendlineScore += 2;
                trendlineDetail += ` (+2 por ${validTrendLines.length} trend lines convergentes)`;
            }
            
            // Penalizar breakout recente
            const recentBreakouts = validTrendLines.filter(tl => 
                tl.recentBreakout && tl.recentBreakout.withinLast5Candles
            );
            if (recentBreakouts.length > 0) {
                trendlineScore = Math.max(0, trendlineScore - 3);
                trendlineDetail += ` (-3 por ${recentBreakouts.length} breakout(s) recente(s))`;
                failedChecks.push(`Trend Line: ${recentBreakouts.length} breakout(s) recente(s)`);
            }
        } else {
            trendlineScore = QUALITY_WEIGHTS.trendLines * 0.5;
            trendlineDetail = `${trendlineScore.toFixed(1)}/${QUALITY_WEIGHTS.trendLines} (Trend lines detectadas mas não válidas)`;
        }
        
        score += trendlineScore;
        details.push(` Trend Lines: ${trendlineDetail}`);
    } else {
        const trendlineScore = QUALITY_WEIGHTS.trendLines * 0.7;
        score += trendlineScore;
        details.push(` Trend Lines: ${trendlineScore.toFixed(1)}/${QUALITY_WEIGHTS.trendLines} (Nenhuma trend line detectada)`);
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

        if (isBullish && rsiData.value >= 60) return null;
        if (isBearish && rsiData.value <= 60) return null;

        const divergenceData = await checkDivergence15m(symbol, isBullish);
        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        
        // NOVO: Análise de Pivot Points
        const pivotPointsData = await analyzePivotPoints(symbol, emaData.currentPrice, isBullish);
        
        // NOVO: Análise de Trend Lines
        const trendLinesData = await analyzeTrendLines(symbol, emaData.currentPrice, isBullish);

        const [volumeData, volatilityData, lsrData, adx1hData, stochData, stoch4hData, cci4hData, oiData, fundingData] = await Promise.all([
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

        if (!adx1hData || !adx1hData.hasMinimumStrength) return null;
        if (!lsrData.isValid) return null;  // linha importante do LSR

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
            breakoutRisk: supportResistanceData?.breakoutRisk,
            pivotPoints: pivotPointsData,      // NOVO
            trendLines: trendLinesData         // NOVO
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

        const divergenceInfo = divergenceData?.hasDivergence ?
            `${divergenceData.type}${divergenceData.confirmed ? '✅' : '⚠️'}` : 'N/A';
        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        // NOVO: Info de Pivot Points
        const pivotInfo = pivotPointsData?.nearestPivot;
        const pivotDistance = pivotInfo?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = pivotInfo?.type || 'N/A';
        
        // NOVO: Info de Trend Lines
        const trendlineInfo = trendLinesData?.length > 0 ? trendLinesData[0] : null;
        const trendlineDistance = trendlineInfo?.distancePercent?.toFixed(2) || 'N/A';

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   📊 Divergência: ${divergenceInfo} | S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📈 Pivot: ${pivotType} ${pivotDistance}% | Trend Line: ${trendlineDistance}%`);
        console.log(`   📊 Volume: ${volumeData.rawRatio.toFixed(2)}x | LSR: ${lsrData.lsrRatio.toFixed(2)}`);

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

    console.log(`\n🚀 TITANIUM ATIVADO COM TRAILING SIMULATION E PIVOT POINTS`);
    console.log(`📊 ${allSymbols.length} ativos Binance Futures`);
    console.log(`🧠 Sistema de aprendizado aprimorado com trailing simulation`);
    console.log(`📊 Análise avançada de Pivot Points e Trend Lines`);

    await sendInitializationMessage(allSymbols);

    let consecutiveErrors = 0;
    let totalSignals = 0;
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
                    await sendSignalAlertWithRisk(signal);
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
            console.log(`📊 Progresso: ${status.consecutiveNoSignals} grupos sem sinais`);

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
🛡️ <b>RELATÓRIO DE RISCO DE MERCADO</b>
${now.full}

• <b>Nível de Risco Geral:</b> ${marketRisk.riskLevel} ${marketRisk.riskLevel === 'CRITICAL' ? '🚨' : marketRisk.riskLevel === 'HIGH' ? '🔴' : marketRisk.riskLevel === 'MEDIUM' ? '🟡' : '🟢'}
• <b>Score Médio de Risco:</b> ${marketRisk.averageRiskScore.toFixed(2)}/15
• <b>Símbolos Monitorados:</b> ${marketRisk.monitoredSymbols}
• <b>Horário:</b> ${now.full}

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
🧠 <b>RELATÓRIO DE APRENDIZADO</b>
${now.full}

• <b>Trades Totais:</b> ${report.totalTrades}
• <b>Taxa de Acerto:</b> ${report.winRate.toFixed(1)}%
• <b>Fator de Lucro:</b> ${report.profitFactor}
• <b>Lucro Médio:</b> ${report.avgProfit}% | <b>Perda Média:</b> ${report.avgLoss}%

<b>📈 Padrões Vencedores (Top 5):</b>
${bestPatterns || 'Nenhum padrão identificado ainda'}

<b>📉 Padrões Perdedores (Top 5):</b>
${worstPatterns || 'Nenhum padrão identificado ainda'}

<b>📊 Simulação Trailing:</b>
• Total: ${report.simulationStats.totalSimulated}
• Stop Primeiro: ${report.simulationStats.stopFirst}
• Alvo Primeiro: ${report.simulationStats.targetFirst}

<i>✨Titanium Learning System by @J4Rviz✨</i>
        `;

        await sendTelegramAlert(message);
        console.log('📊 Relatório de aprendizado enviado');

    } catch (error) {
        console.error('Erro ao enviar relatório de aprendizado:', error.message);
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
        console.log('🚀 TITANIUM - ANÁLISE AVANÇADA COM TRAILING SIMULATION E PIVOT POINTS');
        console.log('='.repeat(80) + '\n');

        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
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
        console.log('🛡️  Risk Layer Sofisticado ativado (modo apenas alerta)');

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
