const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7715750289:AAEDoOv-IOnUiLdWJ8phTxs-6_1jk2nzWsc'; //Titanium Testes
const TELEGRAM_CHAT_ID = '-1003694937150';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE VOLUME MÍNIMO REVISTAS ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.32,
    combinedScore: 0.36,
    classification: 'MODERADO',
    requireConfirmation: true,
    minZScore: 0.4,
    requireVolumeTrend: true
};

// === CONFIGURAÇÕES OTIMIZADAS - MAIS SELETIVAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.7,
    minThreshold: 1.5,
    maxThreshold: 3.0,
    volatilityMultiplier: 0.5,
    useAdaptive: true,
    adaptiveSensitivity: 0.80
};

// === CONFIGURAÇÕES DE VOLUME 1H E 4H REVISTAS ===
const VOLUME_CROSS_SETTINGS = {
    emaPeriod: 13,
    volumePeriod: 20,
    // Configurações para timeframe 1h
    timeframe1h: '1h',
    candles1h: 50,
    // Configurações para timeframe 4h
    timeframe4h: '4h',
    candles4h: 50,
    // Limiares de confirmação
    minVolumeRatio: 1.5,
    strongVolumeRatio: 2.0,
    // Confirmação de tendência
    requireBothTimeframes: true,
    sameDirectionRequired: true
};

// === CONFIGURAÇÕES DE VOLATILIDADE ===
const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.6;

// === CONFIGURAÇÕES LSR ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.7;
const LSR_SELL_THRESHOLD = 3.0;

// === CONFIGURAÇÕES RSI ===
const RSI_BUY_MAX = 62;
const RSI_SELL_MIN = 32;

// === NOVAS CONFIGURAÇÕES EMA CROSS 3M ===
const EMA_CROSS_SETTINGS = {
    timeframe: '3m',
    ema13Period: 13,
    ema34Period: 34,
    ema55Period: 55,
    candles: 100,
    minCandles: 55,
    // Critérios de confirmação
    requireCloseAboveBelowEMA55: true,
    requireVolumeConfirmation: false // Já temos o sistema de volume separado
};

// === COOLDOWN ===
const COOLDOWN_SETTINGS = {
    sameDirection: 20 * 60 * 1000,
    oppositeDirection: 8 * 60 * 1000,
    useDifferentiated: true,
    symbolCooldown: 25 * 60 * 1000
};

// === QUALITY SCORE -
const QUALITY_THRESHOLD = 75;
const QUALITY_WEIGHTS = {
    volumeCross: 40,           // Peso reduzido para incluir EMA cross
    emaCross: 35,             // Novo peso para EMA cross
    oi: 1,
    volatility: 8,
    lsr: 12,
    rsi: 20,
    funding: 6,
    supportResistance: 14,
    pivotPoints: 17,
    breakoutRisk: 12
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

// === CONFIGURAÇÕES APRIMORADAS PARA PIVOT POINTS MULTI-TIMEFRAME ===
const PIVOT_POINTS_SETTINGS = {
    timeframeStrengthWeights: {
        '3m': 0.8,
        '15m': 1.0,
        '1h': 2.0,
        '4h': 3.0,
        '1d': 5.0
    },
    safeDistanceMultipliers: {
        'Fraco': 0.5,
        'Moderado': 1.0,
        'Forte': 1.5,
        'Muito Forte': 2.0
    },
    minDistance: 7,
    priceTolerance: 0.003,
    analyzeTimeframes: ['3m', '15m', '1h', '4h'],
    candlesPerTimeframe: {
        '3m': 100,
        '15m': 100,
        '1h': 120,
        '4h': 150
    },
    detection: {
        windowSize: 11,
        requiredHigherLows: 3,
        requiredLowerHighs: 3,
        minAmplitude: 0.002,
        confirmationCandles: 2
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const CANDLE_CACHE_TTL = 60000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 2 * 60 * 1000;
const OI_HISTORY_SIZE = 20;

// === CONFIGURAÇÕES TÉCNICAS ===
const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_TIMEFRAME = '15m';

// =====================================================================
// 📊 NOVA FUNÇÃO PARA VERIFICAR CRUZAMENTO DE EMA 3M
// =====================================================================

async function checkEMACross3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, EMA_CROSS_SETTINGS.timeframe, 
            EMA_CROSS_SETTINGS.candles);
        
        if (candles.length < EMA_CROSS_SETTINGS.minCandles) {
            return {
                isCrossingUp: false,
                isCrossingDown: false,
                isConfirmed: false,
                details: 'Dados insuficientes',
                ema13: null,
                ema34: null,
                ema55: null,
                currentPrice: null
            };
        }
        
        const closes = candles.map(c => c.close);
        
        // Calcular EMAs
        const ema13 = calculateEMA(closes, EMA_CROSS_SETTINGS.ema13Period);
        const ema34 = calculateEMA(closes, EMA_CROSS_SETTINGS.ema34Period);
        const ema55 = calculateEMA(closes, EMA_CROSS_SETTINGS.ema55Period);
        
        if (!ema13 || !ema34 || !ema55) {
            return {
                isCrossingUp: false,
                isCrossingDown: false,
                isConfirmed: false,
                details: 'Erro cálculo EMA',
                ema13: null,
                ema34: null,
                ema55: null,
                currentPrice: null
            };
        }
        
        // Pegar valores atuais
        const currentPrice = closes[closes.length - 1];
        const currentEma13 = ema13[ema13.length - 1];
        const currentEma34 = ema34[ema34.length - 1];
        const currentEma55 = ema55[ema55.length - 1];
        
        // Pegar valores anteriores
        const prevEma13 = ema13[ema13.length - 2];
        const prevEma34 = ema34[ema34.length - 2];
        
        // Verificar cruzamentos
        const isCrossingUp = prevEma13 <= prevEma34 && currentEma13 > currentEma34;
        const isCrossingDown = prevEma13 >= prevEma34 && currentEma13 < currentEma34;
        
        // Verificar posição do preço em relação à EMA55
        const isPriceAboveEMA55 = currentPrice > currentEma55;
        const isPriceBelowEMA55 = currentPrice < currentEma55;
        
        // Confirmação final
        let isConfirmed = false;
        let details = '';
        
        if (isCrossingUp && EMA_CROSS_SETTINGS.requireCloseAboveBelowEMA55) {
            if (isPriceAboveEMA55) {
                isConfirmed = true;
                details = `COMPRA: EMA13 (${currentEma13.toFixed(6)}) cruzou acima EMA34 (${currentEma34.toFixed(6)}), Preço (${currentPrice.toFixed(6)}) acima EMA55 (${currentEma55.toFixed(6)})`;
            } else {
                details = `EMA13 cruzou acima EMA34 mas Preço (${currentPrice.toFixed(6)}) está ABAIXO da EMA55 (${currentEma55.toFixed(6)})`;
            }
        } else if (isCrossingDown && EMA_CROSS_SETTINGS.requireCloseAboveBelowEMA55) {
            if (isPriceBelowEMA55) {
                isConfirmed = true;
                details = `VENDA: EMA13 (${currentEma13.toFixed(6)}) cruzou abaixo EMA34 (${currentEma34.toFixed(6)}), Preço (${currentPrice.toFixed(6)}) abaixo EMA55 (${currentEma55.toFixed(6)})`;
            } else {
                details = `EMA13 cruzou abaixo EMA34 mas Preço (${currentPrice.toFixed(6)}) está ACIMA da EMA55 (${currentEma55.toFixed(6)})`;
            }
        } else if (isCrossingUp) {
            isConfirmed = true;
            details = `COMPRA: EMA13 cruzou acima EMA34 (sem confirmação EMA55)`;
        } else if (isCrossingDown) {
            isConfirmed = true;
            details = `VENDA: EMA13 cruzou abaixo EMA34 (sem confirmação EMA55)`;
        }
        
        const result = {
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            isConfirmed: isConfirmed,
            details: details,
            ema13: {
                current: currentEma13,
                previous: prevEma13
            },
            ema34: {
                current: currentEma34,
                previous: prevEma34
            },
            ema55: {
                current: currentEma55
            },
            currentPrice: currentPrice,
            isPriceAboveEMA55: isPriceAboveEMA55,
            isPriceBelowEMA55: isPriceBelowEMA55,
            raw: {
                closes: closes.slice(-10),
                ema13Values: ema13.slice(-10),
                ema34Values: ema34.slice(-10),
                ema55Values: ema55.slice(-10)
            }
        };
        
        console.log(`📊 EMA Cross 3m ${symbol}:`);
        console.log(`   EMA13: ${currentEma13.toFixed(6)}`);
        console.log(`   EMA34: ${currentEma34.toFixed(6)}`);
        console.log(`   EMA55: ${currentEma55.toFixed(6)}`);
        console.log(`   Preço: ${currentPrice.toFixed(6)}`);
        console.log(`   Status: ${details}`);
        console.log(`   Confirmado: ${isConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro análise EMA cross ${symbol}:`, error.message);
        return {
            isCrossingUp: false,
            isCrossingDown: false,
            isConfirmed: false,
            details: `Erro: ${error.message}`,
            ema13: null,
            ema34: null,
            ema55: null,
            currentPrice: null
        };
    }
}

function calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const ema = [];
    const multiplier = 2 / (period + 1);
    
    // Primeiro valor é SMA
    let sma = 0;
    for (let i = 0; i < period; i++) {
        sma += data[i];
    }
    sma /= period;
    ema.push(sma);
    
    // Calcular EMA para os demais períodos
    for (let i = period; i < data.length; i++) {
        const currentEMA = (data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
        ema.push(currentEMA);
    }
    
    return ema;
}

// =====================================================================
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO
// =====================================================================

class SophisticatedRiskLayer {
    constructor() {
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
            RSI_EXTREME_RISK: { weight: 1.5 }
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
        if (!pivotData || !pivotData.nearestPivot) {
            return { type: 'PIVOT', score: 0, message: 'Sem dados de pivot' };
        }

        let score = 0;
        let message = '';
        
        const distancePercent = pivotData.nearestPivot.distancePercent;
        const pivotType = pivotData.nearestPivot.type;
        const pivotStrength = pivotData.nearestPivot.strength || 'Fraco';
        const pivotTimeframe = pivotData.nearestPivot.timeframe || '15m';
        
        const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
        const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotTimeframe] || 1.0;
        
        const adjustedSafeDistance = safeDistance * (timeframeWeight >= 3.0 ? 1.5 : 1.0);
        
        if (distancePercent < adjustedSafeDistance * 0.3) {
            score = 2.5;
            message = `🚨 MUITO PRÓXIMO de pivot ${pivotType.toUpperCase()} ${pivotStrength} ${pivotTimeframe} (${distancePercent.toFixed(2)}%)`;
        } else if (distancePercent < adjustedSafeDistance * 0.5) {
            score = 1.5;
            message = `🔴 Próximo de pivot ${pivotType} ${pivotStrength} ${pivotTimeframe} (${distancePercent.toFixed(2)}%)`;
        } else if (distancePercent < adjustedSafeDistance) {
            score = 0.5;
            message = `🟡 Moderado de pivot ${pivotType} ${pivotStrength} (${distancePercent.toFixed(2)}%)`;
        } else {
            score = -0.5;
            message = `🟢 Boa distância de pivot ${pivotType} (${distancePercent.toFixed(2)}%)`;
        }
        
        if (pivotData.nearestPivot.isTesting) {
            score += 1.5;
            message += ' | 🚨 TESTANDO PIVOT!';
        }
        
        if (pivotStrength === 'Forte' || pivotStrength === 'Muito Forte') {
            if (distancePercent < adjustedSafeDistance) {
                score += 1;
                message += ` | PIVOT ${pivotStrength.toUpperCase()} PRÓXIMO`;
            }
        }
        
        if (timeframeWeight >= 3.0) {
            message += ` | PIVOT ${pivotTimeframe.toUpperCase()} (ALTA RELEVÂNCIA)`;
        }

        return {
            type: 'PIVOT',
            score: Math.min(3, score),
            message: message,
            data: pivotData.nearestPivot
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

            if (atr && atr.percentage > 3.0) {
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
                    atrPercentage: atr?.percentage
                }
            };

        } catch (error) {
            return { type: 'VOLATILITY', score: 1, message: 'Erro na análise' };
        }
    }

    analyzeVolumeRisk(signal) {
        const volumeData = signal.marketData.volumeCross;
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

    generateRecommendations(assessment) {
        const recommendations = [];

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

function checkVolumeConfirmation(volumeData) {
    if (!volumeData) {
        return false;
    }

    const combinedScore = volumeData.combinedScore || 0;
    const classification = volumeData.classification || '';
    const emaRatio = volumeData.emaRatio || 0;
    const zScore = volumeData.zScore || 0;

    const isConfirmed = 
        combinedScore >= VOLUME_MINIMUM_THRESHOLDS.combinedScore &&
        emaRatio >= 1.3 &&
        Math.abs(zScore) >= 0.9 &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

// =====================================================================
// 🔢 FUNÇÃO PARA CALCULAR PONTOS DE FIBONACCI
// =====================================================================

async function calculateFibonacciLevels(symbol, currentPrice, pivotType, pivotPrice) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 100);
        if (candles.length < 50) return null;
        
        let swingHigh = currentPrice;
        let swingLow = currentPrice;
        let swingHighIndex = candles.length - 1;
        let swingLowIndex = candles.length - 1;
        
        for (let i = candles.length - 1; i >= Math.max(0, candles.length - 50); i--) {
            if (candles[i].high > swingHigh) {
                swingHigh = candles[i].high;
                swingHighIndex = i;
            }
            if (candles[i].low < swingLow) {
                swingLow = candles[i].low;
                swingLowIndex = i;
            }
        }
        
        const isUptrend = swingHighIndex > swingLowIndex;
        
        let fibLevels = {};
        
        if (isUptrend) {
            const diff = swingHigh - swingLow;
            
            fibLevels = {
                '0.0': swingLow,
                '0.236': swingHigh - diff * 0.236,
                '0.382': swingHigh - diff * 0.382,
                '0.5': swingHigh - diff * 0.5,
                '0.618': swingHigh - diff * 0.618,
                '0.786': swingHigh - diff * 0.786,
                '1.0': swingHigh,
                '1.272': swingHigh + diff * 0.272,
                '1.618': swingHigh + diff * 0.618
            };
        } else {
            const diff = swingHigh - swingLow;
            
            fibLevels = {
                '0.0': swingHigh,
                '0.236': swingLow + diff * 0.236,
                '0.382': swingLow + diff * 0.382,
                '0.5': swingLow + diff * 0.5,
                '0.618': swingLow + diff * 0.618,
                '0.786': swingLow + diff * 0.786,
                '1.0': swingLow,
                '1.272': swingLow - diff * 0.272,
                '1.618': swingLow - diff * 0.618
            };
        }
        
        let nearestFibLevel = null;
        let minDistance = Infinity;
        
        for (const [level, price] of Object.entries(fibLevels)) {
            const distance = Math.abs(pivotPrice - price);
            if (distance < minDistance) {
                minDistance = distance;
                nearestFibLevel = {
                    level: level,
                    price: price,
                    distance: distance,
                    distancePercent: (distance / pivotPrice) * 100
                };
            }
        }
        
        return {
            swingHigh: swingHigh,
            swingLow: swingLow,
            isUptrend: isUptrend,
            fibLevels: fibLevels,
            nearestFibLevel: nearestFibLevel,
            currentPrice: currentPrice,
            pivotPrice: pivotPrice,
            pivotType: pivotType
        };
        
    } catch (error) {
        console.log(`⚠️ Erro cálculo Fibonacci ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA OBTER ADX 1H
// =====================================================================

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 28);
        if (candles.length < 28) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const period = 14;
        
        let trValues = [];
        for (let i = 1; i < candles.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i-1]),
                Math.abs(lows[i] - closes[i-1])
            );
            trValues.push(tr);
        }
        
        let plusDM = [];
        let minusDM = [];
        
        for (let i = 1; i < candles.length; i++) {
            const upMove = highs[i] - highs[i-1];
            const downMove = lows[i-1] - lows[i];
            
            if (upMove > downMove && upMove > 0) {
                plusDM.push(upMove);
                minusDM.push(0);
            } else if (downMove > upMove && downMove > 0) {
                plusDM.push(0);
                minusDM.push(downMove);
            } else {
                plusDM.push(0);
                minusDM.push(0);
            }
        }
        
        let atr = [];
        let plusDI = [];
        let minusDI = [];
        let dx = [];
        let adx = [];
        
        let atrSum = 0;
        let plusDMSum = 0;
        let minusDMSum = 0;
        
        for (let i = 0; i < period; i++) {
            atrSum += trValues[i];
            plusDMSum += plusDM[i];
            minusDMSum += minusDM[i];
        }
        
        atr.push(atrSum / period);
        plusDI.push((plusDMSum / period) / (atr[0] / period) * 100);
        minusDI.push((minusDMSum / period) / (atr[0] / period) * 100);
        
        const dxValue = Math.abs(plusDI[0] - minusDI[0]) / (plusDI[0] + minusDI[0]) * 100;
        dx.push(dxValue);
        adx.push(dxValue);
        
        for (let i = period; i < trValues.length; i++) {
            const atrPrev = atr[atr.length - 1];
            const atrCurrent = (atrPrev * (period - 1) + trValues[i]) / period;
            atr.push(atrCurrent);
            
            const plusDIPrev = plusDI[plusDI.length - 1];
            const plusDICurrent = ((plusDIPrev * (period - 1)) + (plusDM[i] / atrCurrent * 100)) / period;
            plusDI.push(plusDICurrent);
            
            const minusDIPrev = minusDI[minusDI.length - 1];
            const minusDICurrent = ((minusDIPrev * (period - 1)) + (minusDM[i] / atrCurrent * 100)) / period;
            minusDI.push(minusDICurrent);
            
            const dxCurrent = Math.abs(plusDICurrent - minusDICurrent) / (plusDICurrent + minusDICurrent) * 100;
            dx.push(dxCurrent);
            
            if (adx.length < period) {
                adx.push(dxCurrent);
            } else {
                const adxPrev = adx[adx.length - 1];
                const adxCurrent = (adxPrev * (period - 1) + dxCurrent) / period;
                adx.push(adxCurrent);
            }
        }
        
        const currentADX = adx[adx.length - 1];
        const currentPlusDI = plusDI[plusDI.length - 1];
        const currentMinusDI = minusDI[minusDI.length - 1];
        
        return {
            adx: currentADX,
            plusDI: currentPlusDI,
            minusDI: currentMinusDI,
            isAbove20: currentADX > 20,
            isStrongTrend: currentADX > 25,
            trendDirection: currentPlusDI > currentMinusDI ? 'bullish' : 'bearish',
            raw: {
                adxValues: adx.slice(-5),
                plusDIValues: plusDI.slice(-5),
                minusDIValues: minusDI.slice(-5)
            }
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ADX 1h ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS COM NOVO GATILHO
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volumeCross;
        const emaCrossData = signal.marketData.emaCross3m;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        const isEMACrossConfirmed = emaCrossData?.isConfirmed || false;
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
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
        
        let fibInfo = '';
        if (nearestPivot && nearestPivot.price) {
            const fibonacciData = await calculateFibonacciLevels(
                signal.symbol, 
                signal.price, 
                pivotType, 
                nearestPivot.price
            );
            
            if (fibonacciData && fibonacciData.nearestFibLevel) {
                const fib = fibonacciData.nearestFibLevel;
                fibInfo = `🔹*🔹PIVOT: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe}) | Fibonacci ${fib.level}: $${fib.price.toFixed(6)} (${fib.distancePercent.toFixed(2)}% do preço atual)`;
            } else {
                fibInfo = `🔹*🔹PIVOT: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe}) | Preço do ativo: $${signal.price.toFixed(6)}`;
            }
        } else {
            fibInfo = `🔹*🔹PIVOT: Não detectado | Preço do ativo: $${signal.price.toFixed(6)}`;
        }
        
        const adxData = await getADX1h(signal.symbol);
        let adxInfo = '';
        if (adxData) {
            const adxEmoji = adxData.isAbove20 ? '💹 ' : '';
            adxInfo = `\n${adxEmoji}ADX 1h: ${adxData.adx.toFixed(1)} ${adxData.isAbove20 ? '(💹Forte Tendência)' : '(⚪Tendência Fraca)'}}`;
        } else {
            adxInfo = `\nADX 1h: N/A | Não disponível`;
        }

        // Info EMA Cross 3m
        let emaCrossInfo = '';
        if (emaCrossData) {
            emaCrossInfo = `\n📊 EMA Cross 3m: ${emaCrossData.details}`;
        }

        const riskEmoji = riskAssessment.level === 'CRÍTICO' ? '🚨' :
            riskAssessment.level === 'ALTO' ? '🔴' :
                riskAssessment.level === 'MEDIANO' ? '🟡' : '🟢';

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=3`;

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

        let analysisType = '';
        let analysisEmoji = '🤖';

        if (!isVolumeConfirmed && !isEMACrossConfirmed) {
            const rsiValue = signal.marketData.rsi?.value || 50;
            
            const isNearPivot = pivotDistance && parseFloat(pivotDistance) < 0.8;
            const pivotStrengthText = pivotStrength === 'Forte' ? 'FORTE' : 
                                    pivotStrength === 'Muito Forte' ? 'MUITO FORTE' : '';

            if (signal.isBullish) {
                if (isNearPivot && pivotType === 'resistance') {
                    if (parseFloat(pivotDistance) < 0.3) {
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot Bear ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando...REVERSÃO (Pivot Bull ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) {
                    if (isNearPivot && pivotType === 'Suporte') {
                        analysisType = `Analisando...COMPRA (Pivot Bull ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    } else {
                        analysisType = 'Analisando...COMPRA';
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue > RSI_BUY_MAX && rsiValue <= 75) {
                    analysisType = 'Analisando...CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'Análise...NEUTRA';
                    analysisEmoji = '🤖';
                }
            } else {
                if (isNearPivot && pivotType === 'Suporte') {
                    if (parseFloat(pivotDistance) < 0.3) {
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot Bear ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando...EXAUSTÃO (Pivot Bear ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75) {
                    if (isNearPivot && pivotType === 'Resistência') {
                        analysisType = `Analisando...VENDA (Pivot Bear ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    } else {
                        analysisType = 'Analisando...VENDA';
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue < RSI_SELL_MIN) {
                    analysisType = 'Analisando...CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'Análise...NEUTRA';
                    analysisEmoji = '🤖';
                }
            }
        }

        let alertTitle = '';
        let alertType = '';
        
        if (isVolumeConfirmed || isEMACrossConfirmed) {
            let pivotInfo = '';
            if (nearestPivot && parseFloat(pivotDistance) < 1.0) {
                const pivotStrengthText = pivotStrength === 'Forte' ? '🔴 FORTE' : 
                                        pivotStrength === 'Muito Forte' ? '🚨 MUITO FORTE' :
                                        pivotStrength === 'Moderado' ? '🟡 MODERADO' : '⚪ FRACO';
                pivotInfo = ` (Pivot ${pivotType} ${pivotStrengthText})`;
            }
            
            let triggerInfo = '';
            if (isVolumeConfirmed && isEMACrossConfirmed) {
                triggerInfo = 'GATILHO DUPLO: Volume + EMA Cross';
            } else if (isVolumeConfirmed) {
                triggerInfo = 'GATILHO: Volume';
            } else if (isEMACrossConfirmed) {
                triggerInfo = 'GATILHO: EMA Cross 3m';
            }
            
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}${pivotInfo}</b>\n${triggerInfo}`;
            alertType = 'trade';
        } else {
            alertTitle = `${analysisEmoji} <i>IA... ${analysisType}: ${signal.symbol}</i>`;
            alertType = 'analysis';
        }

        let message = `
${alertTitle}
${now.full} <a href="${tradingViewLink}">Gráfico 3m</a>
<i> Indicadores Técnicos</i>
⚠️ SCORE: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
💲 Preço: $${signal.price.toFixed(6)}
${emaCrossInfo}
⚠️ VOL: Score: ${volumeScore.toFixed(2)} - ${volumeClassification}
${fibInfo}
${adxInfo}
⚠️ LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}|🔹RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
<i>🤖 IA Operação/Risco </i>
• Risco: ${riskAssessment.overallScore.toFixed(2)} | Nível: ${riskEmoji} ${riskAssessment.level} 
⚠️ Confiança da IA: ${riskAssessment.confidence}%
${!isVolumeConfirmed && !isEMACrossConfirmed ? `• 🔶 ATENÇÃO: Aguarde confirmação de gatilho` : ''}
${riskAssessment.warnings.length > 0 ? `• ${riskAssessment.warnings[0]}` : ''}
        `;

        if (isVolumeConfirmed || isEMACrossConfirmed) {
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
<i> ⚠️ SEM GATILHO CONFIRMADO PARA OPERAR</i>
• Aguarde confirmação de volume (Score ≥ ${VOLUME_MINIMUM_THRESHOLDS.combinedScore}) ou EMA Cross 3m
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
        console.log(`   Volume: Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   EMA Cross Confirmado: ${isEMACrossConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);

        return {
            type: alertType,
            volumeConfirmed: isVolumeConfirmed,
            emaCrossConfirmed: isEMACrossConfirmed,
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
        const volumeData = signal.marketData.volumeCross;
        const emaCrossData = signal.marketData.emaCross3m;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        const isEMACrossConfirmed = emaCrossData?.isConfirmed || false;
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        
        let fibInfo = '';
        if (nearestPivot && nearestPivot.price) {
            const fibonacciData = await calculateFibonacciLevels(
                signal.symbol, 
                signal.price, 
                pivotType, 
                nearestPivot.price
            );
            
            if (fibonacciData && fibonacciData.nearestFibLevel) {
                const fib = fibonacciData.nearestFibLevel;
                fibInfo = `🔹*🔹PIVOT: ${pivotType} ${pivotDistance}% (${pivotStrength}) | Fibonacci ${fib.level}: $${fib.price.toFixed(6)} (${fib.distancePercent.toFixed(2)}% do preço atual)`;
            } else {
                fibInfo = `🔹*🔹PIVOT: ${pivotType} ${pivotDistance}% (${pivotStrength}) | Preço do ativo: $${signal.price.toFixed(6)}`;
            }
        } else {
            fibInfo = `🔹*🔹PIVOT: Não detectado | Preço do ativo: $${signal.price.toFixed(6)}`;
        }
        
        const adxData = await getADX1h(signal.symbol);
        let adxInfo = '';
        if (adxData) {
            const adxEmoji = adxData.isAbove20 ? '💹 ' : '';
            adxInfo = `\n${adxEmoji}ADX 1h: ${adxData.adx.toFixed(1)} ${adxData.isAbove20 ? '(Forte Tendência)' : '(Tendência Fraca)'} | +DI: ${adxData.plusDI.toFixed(1)} | -DI: ${adxData.minusDI.toFixed(1)}`;
        } else {
            adxInfo = `\nADX 1h: N/A | Não disponível`;
        }
        
        // Info EMA Cross 3m
        let emaCrossInfo = '';
        if (emaCrossData) {
            emaCrossInfo = `\n📊 EMA Cross 3m: ${emaCrossData.details}`;
        }
        
        let analysisType = '';
        let analysisEmoji = '🤖';
        
        if (!isVolumeConfirmed && !isEMACrossConfirmed) {
            const rsiValue = signal.marketData.rsi?.value || 50;
            
            const isNearPivot = pivotDistance && parseFloat(pivotDistance) < 0.8;
            const pivotStrengthText = pivotStrength === 'Forte' ? 'FORTE' : 
                                    pivotStrength === 'Muito Forte' ? 'MUITO FORTE' : '';

            if (signal.isBullish) {
                if (isNearPivot && pivotType === 'resistance') {
                    if (parseFloat(pivotDistance) < 0.3) {
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) {
                    if (isNearPivot && pivotType === 'Suporte') {
                        analysisType = `Analisando...COMPRA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟢🔍';
                    } else {
                        analysisType = 'Analisando...COMPRA';
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue > RSI_BUY_MAX && rsiValue <= 75) {
                    analysisType = 'Analisando...CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'Análise...NEUTRA';
                    analysisEmoji = '🤖';
                }
            } else {
                if (isNearPivot && pivotType === 'Suporte') {
                    if (parseFloat(pivotDistance) < 0.3) {
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando...EXAUSTÃO (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75) {
                    if (isNearPivot && pivotType === 'Resistência') {
                        analysisType = `Analisando...VENDA (Pivot ${pivotStrengthText})`;
                        analysisEmoji = '🔴🔍';
                    } else {
                        analysisType = 'Analisando...VENDA';
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue < RSI_SELL_MIN) {
                    analysisType = 'Analisando...CORREÇÃO';
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = 'Análise...NEUTRA';
                    analysisEmoji = '🤖';
                }
            }
        }

        let alertTitle = '';
        if (isVolumeConfirmed || isEMACrossConfirmed) {
            let pivotInfo = '';
            if (nearestPivot && parseFloat(pivotDistance) < 1.0) {
                const pivotStrengthText = pivotStrength === 'Forte' ? '🔴 FORTE' : 
                                        pivotStrength === 'Muito Forte' ? '🚨 MUITO FORTE' :
                                        pivotStrength === 'Moderado' ? '🟡 MODERADO' : '⚪ FRACO';
                pivotInfo = ` (Pivot ${pivotType} ${pivotStrengthText})`;
            }
            
            let triggerInfo = '';
            if (isVolumeConfirmed && isEMACrossConfirmed) {
                triggerInfo = ' [GATILHO DUPLO: Volume + EMA Cross]';
            } else if (isVolumeConfirmed) {
                triggerInfo = ' [GATILHO: Volume]';
            } else if (isEMACrossConfirmed) {
                triggerInfo = ' [GATILHO: EMA Cross 3m]';
            }
            
            alertTitle = `${directionEmoji} <b>${signal.symbol} - ${direction}${pivotInfo}</b>${triggerInfo}`;
        } else {
            alertTitle = `${analysisEmoji} <i>IA Analisando ${analysisType}: ${signal.symbol}</i>`;
        }

        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace('/', '')}&interval=3`;
        
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

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
${now.full} <a href="${tradingViewLink}">Gráfico 3m</a>
<b>🎯 ANÁLISE TÉCNICA AVANÇADA</b>
• Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
• Probabilidade de Sucesso: ${baseProbability}%
• Preço: $${signal.price.toFixed(6)} | Stop: $${signal.targetsData.stopPrice.toFixed(6)}
${emaCrossInfo}
• Volume: Score: ${volumeScore.toFixed(2)} - ${volumeClassification}
• LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}
• RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Dist S/R: ${distancePercent}% 
${fibInfo}
${adxInfo}
${!isVolumeConfirmed && !isEMACrossConfirmed ? `\n<b>⚠️ ${analysisType} - SEM GATILHO CONFIRMADO PARA OPERAÇÃO</b>` : ''}
        `;

        if (isVolumeConfirmed || isEMACrossConfirmed) {
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
• Aguarde confirmação de gatilho (Volume Score ≥ ${VOLUME_MINIMUM_THRESHOLDS.combinedScore} ou EMA Cross 3m)
• ${analysisType === 'REVERSÃO/COMPRA' ? 'Monitorar para possível entrada de COMPRA' : 
   analysisType === 'EXAUSTÃO/VENDA' ? 'Monitorar para possível entrada de VENDA' : 
   'Monitorar para desenvolvimento do setup'}
            `;
        }

        message += `
<i>✨🤖IA Titanium by @J4Rviz</i>
        `;

        await sendTelegramAlert(message);

        console.log(`📤 ${isVolumeConfirmed || isEMACrossConfirmed ? 'Alerta de TRADE' : 'Análise da IA'} enviado: ${signal.symbol}`);
        console.log(`   Data/Hora: ${now.full} TradingView`);
        console.log(`   Volume: Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   EMA Cross Confirmado: ${isEMACrossConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
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
    let baseProbability = 65;

    baseProbability += (signal.qualityScore.score - 70) * 0.4;

    const volumeData = signal.marketData.volumeCross;
    const volumeScore = volumeData?.combinedScore || 0;
    
    if (volumeScore >= 0.7) baseProbability += 10;
    else if (volumeScore >= 0.5) baseProbability += 5;
    else if (volumeScore < 0.3) baseProbability -= 8;
    
    // Bônus para EMA Cross confirmado
    const emaCrossData = signal.marketData.emaCross3m;
    if (emaCrossData?.isConfirmed) {
        baseProbability += 12;
    }

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

    return Math.min(92, Math.max(35, Math.round(baseProbability)));
}

// =====================================================================
// 📊 FUNÇÃO PARA BUSCAR LSR DA BINANCE
// =====================================================================

async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < 60000) {
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
// 📊 NOVA FUNÇÃO PARA VERIFICAR CRUZAMENTO DE VOLUME 1H E 4H
// =====================================================================

async function checkVolumeCross(symbol) {
    try {
        // Buscar candles para 1h
        const candles1h = await getCandlesCached(symbol, VOLUME_CROSS_SETTINGS.timeframe1h, 
            VOLUME_CROSS_SETTINGS.candles1h);
        
        // Buscar candles para 4h
        const candles4h = await getCandlesCached(symbol, VOLUME_CROSS_SETTINGS.timeframe4h, 
            VOLUME_CROSS_SETTINGS.candles4h);
        
        if (candles1h.length < VOLUME_CROSS_SETTINGS.volumePeriod || 
            candles4h.length < VOLUME_CROSS_SETTINGS.volumePeriod) {
            return {
                isCrossingUp: false,
                isCrossingDown: false,
                combinedScore: 0,
                classification: 'INSUFICIENTE',
                details: {
                    timeframe1h: 'Dados insuficientes',
                    timeframe4h: 'Dados insuficientes'
                }
            };
        }
        
        // Analisar timeframe 1h
        const volumeAnalysis1h = analyzeVolumeCrossTimeframe(candles1h, VOLUME_CROSS_SETTINGS.timeframe1h);
        
        // Analisar timeframe 4h
        const volumeAnalysis4h = analyzeVolumeCrossTimeframe(candles4h, VOLUME_CROSS_SETTINGS.timeframe4h);
        
        // Determinar se há cruzamento
        const isCrossingUp = volumeAnalysis1h.isCrossingUp && volumeAnalysis4h.isCrossingUp;
        const isCrossingDown = volumeAnalysis1h.isCrossingDown && volumeAnalysis4h.isCrossingDown;
        
        // Calcular score combinado
        const combinedScore = calculateVolumeCrossScore(volumeAnalysis1h, volumeAnalysis4h);
        
        // Classificar força do volume
        const classification = classifyVolumeCrossStrength(combinedScore, volumeAnalysis1h, volumeAnalysis4h);
        
        const result = {
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            combinedScore: combinedScore,
            classification: classification,
            timeframe1h: volumeAnalysis1h,
            timeframe4h: volumeAnalysis4h,
            details: {
                bothTimeframesConfirm: (isCrossingUp || isCrossingDown) && 
                                     (volumeAnalysis1h.isCrossingUp === volumeAnalysis4h.isCrossingUp ||
                                      volumeAnalysis1h.isCrossingDown === volumeAnalysis4h.isCrossingDown),
                direction: isCrossingUp ? 'UP' : isCrossingDown ? 'DOWN' : 'NEUTRAL',
                strength: classification
            }
        };
        
        console.log(`📊 Volume Cross ${symbol}:`);
        console.log(`   1h: ${volumeAnalysis1h.isCrossingUp ? '⬆️ CRUZANDO CIMA' : volumeAnalysis1h.isCrossingDown ? '⬇️ CRUZANDO BAIXO' : '➡️ NEUTRO'} (${volumeAnalysis1h.currentRatio.toFixed(2)}x)`);
        console.log(`   4h: ${volumeAnalysis4h.isCrossingUp ? '⬆️ CRUZANDO CIMA' : volumeAnalysis4h.isCrossingDown ? '⬇️ CRUZANDO BAIXO' : '➡️ NEUTRO'} (${volumeAnalysis4h.currentRatio.toFixed(2)}x)`);
        console.log(`   Score: ${combinedScore.toFixed(2)} (${classification})`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro análise volume cross ${symbol}:`, error.message);
        return {
            isCrossingUp: false,
            isCrossingDown: false,
            combinedScore: 0,
            classification: 'ERRO',
            details: { error: error.message }
        };
    }
}

function analyzeVolumeCrossTimeframe(candles, timeframe) {
    const volumes = candles.map(c => c.volume);
    const closes = candles.map(c => c.close);
    
    // Calcular EMA do volume
    const emaVolume = calculateVolumeEMA(volumes, VOLUME_CROSS_SETTINGS.emaPeriod);
    const currentVolume = volumes[volumes.length - 1];
    const currentEma = emaVolume[emaVolume.length - 1];
    const previousVolume = volumes[volumes.length - 2];
    const previousEma = emaVolume[emaVolume.length - 2];
    
    // Calcular ratio volume/EMA
    const currentRatio = currentVolume / currentEma;
    const previousRatio = previousVolume / previousEma;
    
    // Determinar cruzamento
    const isCrossingUp = previousVolume <= previousEma && currentVolume > currentEma;
    const isCrossingDown = previousVolume >= previousEma && currentVolume < currentEma;
    
    // Calcular força do volume
    const volumeStrength = calculateVolumeStrength(currentRatio);
    
    // Verificar tendência de preço
    const currentPrice = closes[closes.length - 1];
    const previousPrice = closes[closes.length - 2];
    const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;
    
    return {
        timeframe: timeframe,
        currentVolume: currentVolume,
        currentEma: currentEma,
        currentRatio: currentRatio,
        previousRatio: previousRatio,
        isCrossingUp: isCrossingUp,
        isCrossingDown: isCrossingDown,
        volumeStrength: volumeStrength,
        priceChange: priceChange,
        hasPriceConfirmation: (isCrossingUp && priceChange > 0) || (isCrossingDown && priceChange < 0),
        raw: {
            volumes: volumes.slice(-5),
            emaValues: emaVolume.slice(-5),
            prices: closes.slice(-3)
        }
    };
}

function calculateVolumeEMA(volumes, period) {
    const ema = [];
    const multiplier = 2 / (period + 1);
    
    // Primeiro valor é SMA
    let sma = 0;
    for (let i = 0; i < period; i++) {
        sma += volumes[i];
    }
    sma /= period;
    ema.push(sma);
    
    // Calcular EMA para os demais períodos
    for (let i = period; i < volumes.length; i++) {
        const currentEMA = (volumes[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
        ema.push(currentEMA);
    }
    
    return ema;
}

function calculateVolumeStrength(volumeRatio) {
    if (volumeRatio >= 3.0) return 'MUITO FORTE';
    if (volumeRatio >= 2.0) return 'FORTE';
    if (volumeRatio >= 1.5) return 'MODERADO';
    if (volumeRatio >= 1.2) return 'FRACO';
    return 'MUITO FRACO';
}

function calculateVolumeCrossScore(analysis1h, analysis4h) {
    let score = 0;
    
    // Score baseado no ratio do volume
    score += Math.min(1.0, analysis1h.currentRatio / 3.0) * 0.4;
    score += Math.min(1.0, analysis4h.currentRatio / 3.0) * 0.4;
    
    // Bônus se ambos timeframes confirmam mesma direção
    if ((analysis1h.isCrossingUp && analysis4h.isCrossingUp) ||
        (analysis1h.isCrossingDown && analysis4h.isCrossingDown)) {
        score += 0.2;
    }
    
    // Bônus se preço confirma direção
    if (analysis1h.hasPriceConfirmation && analysis4h.hasPriceConfirmation) {
        score += 0.2;
    }
    
    return Math.min(1.0, score);
}

function classifyVolumeCrossStrength(score, analysis1h, analysis4h) {
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
// 📊 FUNÇÕES APRIMORADAS PARA PONTOS DE PIVÔ MULTI-TIMEFRAME
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

                if (candles.length < 50) continue;

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

        const supportPivots = allPivots.filter(p => p.type === 'Suporte');
        const resistancePivots = allPivots.filter(p => p.type === 'Resistência');

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

    const pivotHighs = findPivotHighsEnhanced(highs, PIVOT_POINTS_SETTINGS.detection);
    const pivotLows = findPivotLowsEnhanced(lows, PIVOT_POINTS_SETTINGS.detection);

    const supportPivots = classifyPivotsEnhanced(pivotLows, 'Suporte', candles, timeframe);
    const resistancePivots = classifyPivotsEnhanced(pivotHighs, 'Resistência', candles, timeframe);

    return {
        supports: supportPivots,
        resistances: resistancePivots,
        timeframe: timeframe,
        candlesAnalyzed: candles.length
    };
}

function findPivotHighsEnhanced(highs, detectionSettings) {
    const pivots = [];
    const window = detectionSettings.windowSize;
    
    for (let i = window; i < highs.length - window; i++) {
        let isPivot = true;
        let hasRequiredLowerHighs = true;
        
        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && highs[j] > highs[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            let lowerHighsCount = 0;
            for (let j = i - window; j < i; j++) {
                if (highs[j] < highs[i]) {
                    lowerHighsCount++;
                }
            }
            
            hasRequiredLowerHighs = lowerHighsCount >= detectionSettings.requiredLowerHighs;
            
            const avgBefore = highs.slice(Math.max(0, i - 5), i).reduce((a, b) => a + b, 0) / Math.min(5, i);
            const amplitude = (highs[i] - avgBefore) / avgBefore;
            
            if (hasRequiredLowerHighs && amplitude >= detectionSettings.minAmplitude) {
                pivots.push({
                    index: i,
                    price: highs[i],
                    type: 'Resistência',
                    amplitude: amplitude,
                    confirmation: true
                });
            }
        }
    }
    
    return pivots;
}

function findPivotLowsEnhanced(lows, detectionSettings) {
    const pivots = [];
    const window = detectionSettings.windowSize;
    
    for (let i = window; i < lows.length - window; i++) {
        let isPivot = true;
        let hasRequiredHigherLows = true;
        
        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && lows[j] < lows[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            let higherLowsCount = 0;
            for (let j = i - window; j < i; j++) {
                if (lows[j] > lows[i]) {
                    higherLowsCount++;
                }
            }
            
            hasRequiredHigherLows = higherLowsCount >= detectionSettings.requiredHigherLows;
            
            const avgBefore = lows.slice(Math.max(0, i - 5), i).reduce((a, b) => a + b, 0) / Math.min(5, i);
            const amplitude = (avgBefore - lows[i]) / avgBefore;
            
            if (hasRequiredHigherLows && amplitude >= detectionSettings.minAmplitude) {
                pivots.push({
                    index: i,
                    price: lows[i],
                    type: 'Suporte',
                    amplitude: amplitude,
                    confirmation: true
                });
            }
        }
    }
    
    return pivots;
}

function classifyPivotsEnhanced(pivots, type, candles, timeframe) {
    const classified = [];
    
    for (const pivot of pivots) {
        let touches = 1;
        let recentTouches = 0;
        
        for (let i = pivot.index + 1; i < candles.length; i++) {
            const candle = candles[i];
            const priceRange = pivot.price * PIVOT_POINTS_SETTINGS.priceTolerance;
            
            const touched = (type === 'Suporte' && candle.low <= pivot.price + priceRange && candle.low >= pivot.price - priceRange) ||
                           (type === 'Resistência' && candle.high <= pivot.price + priceRange && candle.high >= pivot.price - priceRange);
            
            if (touched) {
                touches++;
                
                if (i >= candles.length - PIVOT_POINTS_SETTINGS.detection.confirmationCandles) {
                    recentTouches++;
                }
            }
        }
        
        classified.push({
            price: pivot.price,
            type: type,
            touches: touches,
            recentTouches: recentTouches,
            index: pivot.index,
            timeframe: timeframe,
            amplitude: pivot.amplitude,
            isConfirmed: recentTouches >= PIVOT_POINTS_SETTINGS.detection.confirmationCandles
        });
    }
    
    return classified;
}

function calculatePivotStrength(pivot, timeframe) {
    let baseStrength = 'Fraco';
    
    if (pivot.touches >= 5) {
        baseStrength = 'Muito Forte';
    } else if (pivot.touches >= 4) {
        baseStrength = 'Forte';
    } else if (pivot.touches >= 3) {
        baseStrength = 'Moderado';
    } else if (pivot.touches >= 2) {
        baseStrength = 'Fraco';
    }
    
    const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
    
    if (timeframeWeight >= 3.0 && baseStrength !== 'Fraco') {
        if (baseStrength === 'Moderado') return 'Forte';
        if (baseStrength === 'Forte') return 'Muito Forte';
    }
    
    if (baseStrength === 'Fraco' && pivot.amplitude >= 0.005) {
        baseStrength = 'Moderado';
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
                timeframeStrength: PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivot.timeframe] || 1.0,
                isTesting: true
            };
        }
    }
    
    return null;
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
                    type: 'Suporte'
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
                    type: 'Resistência'
                });
            }
        }
    }

    return levels;
}

function calculateLevelStrength(touchCount) {
    if (touchCount >= 4) return 'Muito Forte';
    if (touchCount >= 3) return 'Forte';
    if (touchCount >= 2) return 'Moderado';
    return 'Fraco';
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
// 🚀 FUNÇÃO ESPECIAL PARA MENSAGEM DE INICIALIZAÇÃO - AJUSTADA
// =====================================================================

async function sendInitializationMessage(allSymbols) {
    try {
        const brazilTime = getBrazilianDateTime();

        const message = `
🚀 <b>TITANIUM ATIVADO!</b>

${brazilTime.full}
📊 Sistema aprimorado com:
• GATILHO: Volume 1h/4h cruzando EMA13
• GATILHO: EMA13 cruzando EMA34 + Preço acima/abaixo EMA55 (3m)
• Análise de Pivot Points Multi-Timeframe
• Sistema de Risco Avançado
✨ by @J4Rviz
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
            console.log('🚀 TITANIUM ATIVADO!');
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

async function getCurrentPrice(symbol) {
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
        const volumeAnalysis = await checkVolumeCross(symbol);
        return volumeAnalysis;
    } catch (error) {
        return { 
            isCrossingUp: false,
            isCrossingDown: false,
            combinedScore: 0,
            classification: 'ERRO'
        };
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
        
        let isRising = false;
        if (data.length >= 2) {
            const previousRate = parseFloat(data[1].fundingRate);
            isRising = fundingRate > previousRate;
        }
        
        const isFavorable = isBullish ? fundingRate < 0 : fundingRate > 0;
        const isValid = isFavorable;

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
// 📊 FUNÇÃO ATUALIZADA PARA CALCULAR QUALIDADE COM NOVO GATILHO
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

    // CRITÉRIO 1: EMA Cross 3m
    const emaCrossData = marketData.emaCross3m;
    if (emaCrossData && emaCrossData.isConfirmed) {
        const emaCrossScore = QUALITY_WEIGHTS.emaCross;
        score += emaCrossScore;
        
        details.push(` EMA Cross 3m: ${emaCrossScore}/${QUALITY_WEIGHTS.emaCross} (${emaCrossData.details})`);
    } else {
        failedChecks.push(`EMA Cross 3m: ${emaCrossData?.details || 'Não confirmado'}`);
    }

    // CRITÉRIO 2: Volume Cross
    const volumeData = marketData.volumeCross;
    if (volumeData && volumeData.combinedScore >= 0.5) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volumeCross,
            QUALITY_WEIGHTS.volumeCross * volumeData.combinedScore);
        score += volumeScore;
        
        const direction = isBullish ? 
            (volumeData.isCrossingUp ? '⬆️ CRUZANDO CIMA' : '❌ SEM CRUZAMENTO') :
            (volumeData.isCrossingDown ? '⬇️ CRUZANDO BAIXO' : '❌ SEM CRUZAMENTO');
            
        details.push(` Volume Cross: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volumeCross} (${direction})`);
        details.push(`   1h: ${volumeData.timeframe1h.currentRatio.toFixed(2)}x | 4h: ${volumeData.timeframe4h.currentRatio.toFixed(2)}x`);
        details.push(`   Score: ${volumeData.combinedScore.toFixed(2)} - ${volumeData.classification}`);
    } else {
        failedChecks.push(`Volume Cross: Score ${volumeData?.combinedScore?.toFixed(2) || '0.00'} < 0.5 (${volumeData?.classification || 'FRACO'})`);
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
        const lsrValue = marketData.lsr.lsrRatio;
        details.push(` LSR Binance: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(3)} ${isBullish ? '≤' : '>'} ${LSR_BUY_THRESHOLD})`);
    } else {
        failedChecks.push(`LSR Binance: ${marketData.lsr?.lsrRatio?.toFixed(3) || 0} ${isBullish ? '>' : '≤'} ${LSR_BUY_THRESHOLD}`);
    }

    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;

        if (isBullish && rsiValue >= 25 && rsiValue <= RSI_BUY_MAX) {
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

    if (marketData.oi && marketData.oi.isValid) {
        const oiScore = QUALITY_WEIGHTS.oi;
        score += oiScore;
        details.push(` OI: ${oiScore}/${QUALITY_WEIGHTS.oi} (${marketData.oi.trend} tendência)`);
    } else {
        failedChecks.push(`OI: Tendência ${marketData.oi?.trend || 'indefinida'} não confirma`);
    }

    if (marketData.funding && marketData.funding.isValid) {
        const fundingScore = QUALITY_WEIGHTS.funding;
        score += fundingScore;
        const fundingPercent = (marketData.funding.raw * 100).toFixed(5);
        
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

    let grade, emoji;
    if (score >= 85) {
        grade = "A✨";
        emoji = "🏆";
    } else if (score >= 75) {
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
        // Verificar cruzamento de volume primeiro (critério principal)
        const volumeData = await checkVolumeCross(symbol);
        const emaCrossData = await checkEMACross3m(symbol);
        
        // Verificar se pelo menos um dos gatilhos está ativo
        const hasVolumeCross = volumeData.isCrossingUp || volumeData.isCrossingDown;
        const hasEMACross = emaCrossData.isCrossingUp || emaCrossData.isCrossingDown;
        
        if (!hasVolumeCross && !hasEMACross) {
            return null;
        }
        
        // Determinar direção baseada nos gatilhos ativos
        let isBullish = null;
        
        if ((volumeData.isCrossingUp && !volumeData.isCrossingDown) || 
            (emaCrossData.isCrossingUp && !emaCrossData.isCrossingDown)) {
            isBullish = true;
        } else if ((volumeData.isCrossingDown && !volumeData.isCrossingUp) ||
                  (emaCrossData.isCrossingDown && !emaCrossData.isCrossingUp)) {
            isBullish = false;
        } else {
            // Sem direção clara
            return null;
        }
        
        // Buscar preço atual
        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) return null;
        
        // Verificar RSI
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) return null;
        
        // Validar RSI para a direção
        if (isBullish && rsiData.value > RSI_BUY_MAX) {
            console.log(`❌ ${symbol}: RSI alto para compra (${rsiData.value.toFixed(1)} > ${RSI_BUY_MAX})`);
            return null;
        }
        if (!isBullish && rsiData.value < RSI_SELL_MIN) {
            console.log(`❌ ${symbol}: RSI baixo para venda (${rsiData.value.toFixed(1)} < ${RSI_SELL_MIN})`);
            return null;
        }

        const supportResistanceData = await analyzeSupportResistance(symbol, currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPoints(symbol, currentPrice, isBullish);

        const [volatilityData, lsrData, oiData, fundingData] = await Promise.all([
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);

        if (!lsrData.isValid) return null;

        const marketData = {
            volumeCross: volumeData,
            emaCross3m: emaCrossData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            oi: oiData,
            funding: fundingData,
            supportResistance: supportResistanceData,
            breakoutRisk: supportResistanceData?.breakoutRisk,
            pivotPoints: pivotPointsData
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

        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        const pivotInfo = pivotPointsData?.nearestPivot;
        const pivotDistance = pivotInfo?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = pivotInfo?.type || 'N/A';
        const pivotStrength = pivotInfo?.strength || 'N/A';
        const pivotTimeframe = pivotInfo?.timeframe || 'N/A';

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

        const volumeScore = volumeData.combinedScore?.toFixed(2) || '0.00';
        const volumeClassification = volumeData.classification || 'NORMAL';
        const emaCrossConfirmed = emaCrossData.isConfirmed;

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        
        if (volumeData.isCrossingUp || volumeData.isCrossingDown) {
            console.log(`   📊 GATILHO 1: Volume ${isBullish ? '⬆️ CRUZANDO CIMA' : '⬇️ CRUZANDO BAIXO'} (1h: ${volumeData.timeframe1h.currentRatio.toFixed(2)}x, 4h: ${volumeData.timeframe4h.currentRatio.toFixed(2)}x)`);
            console.log(`   📊 Volume Score: ${volumeScore} - ${volumeClassification}`);
        }
        
        if (emaCrossData.isCrossingUp || emaCrossData.isCrossingDown) {
            console.log(`   📊 GATILHO 2: EMA Cross 3m ${isBullish ? '⬆️ CRUZANDO CIMA' : '⬇️ CRUZANDO BAIXO'} (${emaCrossData.details})`);
            console.log(`   📊 EMA Cross Confirmado: ${emaCrossConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        }
        
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📊 LSR Binance: ${lsrData.lsrRatio.toFixed(3)}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
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

    console.log(`\n TITANIUM ATIVADO!`);
    console.log(` ${allSymbols.length} ativos Binance Futures`);
    console.log(` GATILHO 1: Volume 1h/4h cruzando EMA13`);
    console.log(` GATILHO 2: EMA13 cruzando EMA34 + Preço acima/abaixo EMA55 (3m)`);
    console.log(` Sistema aprimorado com análise avançada de Pivot Points`);
    console.log(` Bot iniciando...`);

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
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM - SISTEMA COM DOIS GATILHOS');
        console.log(` GATILHO 1: Volume 1h/4h cruzando EMA13`);
        console.log(` GATILHO 2: EMA13 cruzando EMA34 + Preço acima/abaixo EMA55 (3m)`);
        console.log(` Sistema aprimorado com análise de Pivot Points`);
        console.log(` Bot configurado e pronto para operar`);
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
        console.log('🛡️  Risk Layer Sofisticado ativado');

        console.log('✅ Tudo pronto! Iniciando monitoramento...');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 120 segundos...');
        await new Promise(r => setTimeout(r, 120000));
        await startBot();
    }
}

// Funções auxiliares que podem estar faltando
async function sendMarketRiskReport() {
    // Implementação do relatório de risco
    console.log('📊 Relatório de risco do mercado');
}

// Iniciar
startBot();
