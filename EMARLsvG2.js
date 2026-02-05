const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES DE FALLBACK GRANULAR (SISTEMA MELHORADO 8.0/10) ===
const FALLBACK_CONFIG = {
    maxCacheAge: 5 * 60 * 1000,
    interpolationWindow: 5,
    degradeThreshold: 3,
    degradedThreshold: 75,
    minDataForAnalysis: 8,
    useLastKnownGood: true,
    logFallbacks: true,
    riskPenaltyPerFallback: 1.5,
    
    // NOVO: Sistema de prioridade por indicador
    indicatorPriority: {
        CRITICAL: ['Klines', 'Volume', 'RSI', 'EMA'], // Indicadores essenciais
        IMPORTANT: ['Stochastic', 'LSR', 'PivotPoints', 'SupportResistance'],
        SECONDARY: ['Volume1hEMA9', 'CCIDailyEMA5', 'Funding', 'OpenInterest'],
        OPTIONAL: ['Stochastic12h', 'StochasticDaily', 'ATR']
    },
    
    // NOVO: Limites por tipo de fallback
    maxFallbacksPerType: {
        CRITICAL: 2,   // Máximo de fallbacks em indicadores críticos
        IMPORTANT: 3,  // Máximo de fallbacks em indicadores importantes
        SECONDARY: 4,  // Máximo de fallbacks em indicadores secundários
        OPTIONAL: 5    // Máximo de fallbacks em indicadores opcionais
    },
    
    // NOVO: Estratégias de fallback específicas
    fallbackStrategies: {
        Klines: ['CACHE_INTERPOLATED', 'SIMPLIFIED_DATA', 'ABORT_ANALYSIS'],
        Volume: ['15M_NORMALIZED', 'MINIMAL_DATA', 'ERROR_FALLBACK'],
        RSI: ['ROC_PROXY', 'DEFAULT_VALUE'],
        EMA: ['SIMPLIFIED_DATA', 'DEFAULT_VALUE'],
        LSR: ['FUNDING_OI_PROXY', 'NEUTRAL_FALLBACK']
    }
};

// === CACHE DE FALLBACK ===
const fallbackCache = {
    prices: {},
    indicators: {},
    volume: {},
    lsr: {},
    pivots: {},
    candles: {},
    timestamp: Date.now()
};

// === CONFIGURAÇÕES DE VOLUME MÍNIMO OTIMIZADAS ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.25,
    combinedScore: 0.28,
    classification: 'MODERADO-BAIXO',
    requireConfirmation: false,
    minZScore: 0.3,
    requireVolumeTrend: false
};

// === CONFIGURAÇÕES OTIMIZADAS - MAIS CONSERVADORAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.2,
    minThreshold: 1.0,
    maxThreshold: 2.0,
    volatilityMultiplier: 0.6,
    useAdaptive: true,
    adaptiveSensitivity: 0.5,
    
    quickEntryMode: {
        enabled: false,           // ⚠️ DESATIVADO para capital real (reduz ruído)
        minVolumeSpike: 2.0,      // ⬆️ Aumentado de 1.8 para exigir spike mais forte
        acceptPartialVolume: false // ⚠️ Exige confirmação completa de volume
    }
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO OTIMIZADO ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 13,
    emaAlpha: 0.45,
    baseZScoreLookback: 20,
    minZScoreLookback: 8,
    maxZScoreLookback: 40,
    zScoreThreshold: 1.2,
    vptThreshold: 0.15,
    minPriceMovement: 0.06,
    requirePositiveCorrelation: false,
    combinedMultiplier: 1.15,
    volumeWeight: 0.30,
    emaWeight: 0.40,
    zScoreWeight: 0.20,
    vptWeight: 0.10,
    minimumThresholds: {
        combinedScore: 0.25,
        emaRatio: 1.15,
        zScore: 0.6,
        classification: 'MODERADO-BAIXO'
    }
};

// === CONFIGURAÇÕES LSR OTIMIZADAS ===
const LSR_TIMEFRAME = '5m';
const LSR_BUY_THRESHOLD = 2.7;
const LSR_SELL_THRESHOLD = 3.0;

// === CONFIGURAÇÕES RSI OTIMIZADAS ===
const RSI_BUY_MAX = 63;
const RSI_SELL_MIN = 35;

// === COOLDOWN OTIMIZADO ===
const COOLDOWN_SETTINGS = {
    sameDirection: 3 * 60 * 1000,
    oppositeDirection: 1 * 60 * 1000,
    useDifferentiated: false,
    symbolCooldown: 5 * 60 * 1000
};

// === QUALITY SCORE - MAIS FLEXÍVEL ===
const QUALITY_THRESHOLD = 70;
const QUALITY_WEIGHTS = {
    volume: 20,
    oi: 2,
    volatility: 3,
    lsr: 6,
    rsi: 7,
    emaAlignment: 6,
    stoch1h: 8,
    stoch4h: 6,
    breakoutRisk: 3,
    supportResistance: 6,
    pivotPoints: 6,
    funding: 6,
    stochastic12h: 5,
    stochasticDaily: 5,
    volume1hEMA9: 10,
    cciDailyEMA5: 5
};

// === NOVA CONFIGURAÇÃO: VOLUME 1H COM EMA 9 ===
const VOLUME_1H_EMA9_SETTINGS = {
    timeframe: '1h',
    emaPeriod: 9,
    lookbackPeriod: 20,
    thresholds: {
        strongBuyers: 135,
        moderateBuyers: 115,
        neutral: 85,
        moderateSellers: 65,
        strongSellers: 65
    },
    points: {
        strongBuyers: 10,
        moderateBuyers: 5,
        moderateSellers: 5,
        strongSellers: 10
    }
};

// === NOVA CONFIGURAÇÃO: CCI 20 COM EMA 5 DIÁRIO ===
const CCI_DAILY_SETTINGS = {
    timeframe: '1d',
    cciPeriod: 20,
    emaPeriod: 5,
    lookbackPeriod: 30,
    thresholds: {
        overbought: 100,
        oversold: -100,
        strongTrend: 50,
        moderateTrend: 25
    },
    points: {
        bullishCross: 10,
        bearishCross: 10
    }
};

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 900,
    requestsPerSecond: 25,
    weightPerRequest: {
        exchangeInfo: 20,
        klines: 1,
        openInterest: 1,
        fundingRate: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2000,
    maxWeightPerSecond: 35,
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
    analyzeTimeframes: ['15m', '1h', '4h'],
    candlesPerTimeframe: {
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

// === NOVAS CONFIGURAÇÕES PARA STOCHASTIC 12H E DIÁRIO ===
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
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const CANDLE_CACHE_TTL = 90000;
const MAX_CACHE_AGE = 12 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 3 * 60 * 1000;
const OI_HISTORY_SIZE = 20;

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

const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_TIMEFRAME = '15m';

// =====================================================================
// 🛡️ SISTEMA DE FALLBACK ROBUSTO E GRANULAR (8.0/10)
// =====================================================================

class RobustFallbackSystem {
    constructor() {
        this.usedFallbacks = [];
        this.fallbackStats = {};
        this.degradedMode = false;
        this.indicatorFallbackCounts = {};
        this.symbolFallbackCounts = {};
        console.log('🛡️  Sistema de Fallback Robusto Granular inicializado');
    }

    recordFallback(component, fallbackType, details = {}) {
        const fallbackRecord = {
            component,
            fallbackType,
            timestamp: Date.now(),
            details,
            priority: this.getIndicatorPriority(component),
            symbol: details.symbol || 'GLOBAL'
        };

        this.usedFallbacks.push(fallbackRecord);

        if (this.usedFallbacks.length > 100) {
            this.usedFallbacks.shift();
        }

        if (!this.fallbackStats[component]) {
            this.fallbackStats[component] = { count: 0, types: {}, priorities: {} };
        }
        this.fallbackStats[component].count++;
        this.fallbackStats[component].types[fallbackType] = 
            (this.fallbackStats[component].types[fallbackType] || 0) + 1;
        
        const priority = this.getIndicatorPriority(component);
        this.fallbackStats[component].priorities[priority] = 
            (this.fallbackStats[component].priorities[priority] || 0) + 1;

        if (details.symbol) {
            if (!this.symbolFallbackCounts[details.symbol]) {
                this.symbolFallbackCounts[details.symbol] = { count: 0, components: {} };
            }
            this.symbolFallbackCounts[details.symbol].count++;
            this.symbolFallbackCounts[details.symbol].components[component] = 
                (this.symbolFallbackCounts[details.symbol].components[component] || 0) + 1;
        }

        if (!this.indicatorFallbackCounts[component]) {
            this.indicatorFallbackCounts[component] = 0;
        }
        this.indicatorFallbackCounts[component]++;

        this.checkDegradedMode();
        this.checkCriticalFallbacks(component, priority);

        if (FALLBACK_CONFIG.logFallbacks) {
            const priorityLabel = this.getPriorityLabel(priority);
            console.log(`⚠️ Fallback [${priorityLabel}]: ${component} – ${fallbackType}`, details);
        }

        return fallbackRecord;
    }

    getIndicatorPriority(component) {
        for (const [priority, indicators] of Object.entries(FALLBACK_CONFIG.indicatorPriority)) {
            if (indicators.includes(component)) {
                return priority;
            }
        }
        return 'OPTIONAL';
    }

    getPriorityLabel(priority) {
        const labels = {
            'CRITICAL': '🚨 CRÍTICO',
            'IMPORTANT': '⚠️ IMPORTANTE',
            'SECONDARY': '📊 SECUNDÁRIO',
            'OPTIONAL': '🔍 OPCIONAL'
        };
        return labels[priority] || priority;
    }

    checkCriticalFallbacks(component, priority) {
        if (priority === 'CRITICAL') {
            const criticalFallbacks = this.usedFallbacks.filter(fb => 
                fb.priority === 'CRITICAL' && 
                Date.now() - fb.timestamp < 5 * 60 * 1000
            );
            
            if (criticalFallbacks.length >= FALLBACK_CONFIG.maxFallbacksPerType.CRITICAL) {
                console.log(`🚨 ALERTA: ${criticalFallbacks.length} fallbacks CRÍTICOS em 5 minutos!`);
            }
        }
    }

    checkDegradedMode() {
        const recentFallbacks = this.usedFallbacks.filter(
            fb => Date.now() - fb.timestamp < 5 * 60 * 1000
        );
        
        const criticalFallbacks = recentFallbacks.filter(fb => fb.priority === 'CRITICAL');
        
        if (criticalFallbacks.length >= 2 || recentFallbacks.length >= FALLBACK_CONFIG.degradeThreshold) {
            if (!this.degradedMode) {
                console.log(`⚠️ ATIVANDO MODO DEGRADADO (${criticalFallbacks.length} críticos, ${recentFallbacks.length} total)`);
                this.degradedMode = true;
            }
        } else if (this.degradedMode && recentFallbacks.length < 1) {
            console.log('✅ DESATIVANDO MODO DEGRADADO');
            this.degradedMode = false;
        }
    }

    shouldAbortAnalysis(symbol) {
        if (!symbol) return false;
        
        const symbolFallbacks = this.getSymbolFallbacks(symbol);
        const criticalCount = symbolFallbacks.filter(fb => fb.priority === 'CRITICAL').length;
        
        if (criticalCount >= 2) {
            console.log(`⛔ Abortando análise para ${symbol} (${criticalCount} fallbacks críticos)`);
            return true;
        }
        
        return symbolFallbacks.length >= 5;
    }

    getSymbolFallbacks(symbol) {
        return this.usedFallbacks.filter(fb => 
            fb.details.symbol === symbol && 
            Date.now() - fb.timestamp < 10 * 60 * 1000
        );
    }

    getActiveFallbacks() {
        return this.usedFallbacks.filter(
            fb => Date.now() - fb.timestamp < 10 * 60 * 1000
        );
    }

    getFallbackPenalty(symbol = null) {
        const activeFallbacks = symbol ? this.getSymbolFallbacks(symbol) : this.getActiveFallbacks();
        
        let penalty = 0;
        activeFallbacks.forEach(fb => {
            switch(fb.priority) {
                case 'CRITICAL':
                    penalty += 3;
                    break;
                case 'IMPORTANT':
                    penalty += 2;
                    break;
                case 'SECONDARY':
                    penalty += 1;
                    break;
                default:
                    penalty += 0.5;
            }
        });
        
        return Math.min(15, penalty);
    }

    clearOldFallbacks() {
        const cutoff = Date.now() - 30 * 60 * 1000;
        this.usedFallbacks = this.usedFallbacks.filter(fb => fb.timestamp > cutoff);
        
        Object.keys(this.symbolFallbackCounts).forEach(symbol => {
            if (this.symbolFallbackCounts[symbol].count === 0) {
                delete this.symbolFallbackCounts[symbol];
            }
        });
    }

    getStatus(symbol = null) {
        const activeFallbacks = symbol ? this.getSymbolFallbacks(symbol) : this.getActiveFallbacks();
        
        const priorityCounts = {
            CRITICAL: 0,
            IMPORTANT: 0,
            SECONDARY: 0,
            OPTIONAL: 0
        };
        
        activeFallbacks.forEach(fb => {
            if (priorityCounts[fb.priority] !== undefined) {
                priorityCounts[fb.priority]++;
            }
        });
        
        return {
            degradedMode: this.degradedMode,
            activeFallbacks: activeFallbacks.length,
            priorityCounts: priorityCounts,
            totalFallbacks: this.usedFallbacks.length,
            stats: symbol ? this.symbolFallbackCounts[symbol] : this.fallbackStats,
            penalty: this.getFallbackPenalty(symbol),
            symbolFallbacks: symbol ? this.getSymbolFallbacks(symbol).length : null
        };
    }
    
    canUseFallback(component, symbol) {
        const priority = this.getIndicatorPriority(component);
        const maxAllowed = FALLBACK_CONFIG.maxFallbacksPerType[priority] || 5;
        
        const symbolFallbacks = this.getSymbolFallbacks(symbol);
        const componentFallbacks = symbolFallbacks.filter(fb => fb.component === component);
        
        return componentFallbacks.length < maxAllowed;
    }
}

// Instância global do sistema de fallback
const fallbackSystem = new RobustFallbackSystem();

// =====================================================================
// 🆕 NOVAS FUNÇÕES PARA OS NOVOS INDICADORES
// =====================================================================

async function getVolume1hWithEMA9(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('Volume1hEMA9', symbol)) {
            return getIndicatorFallback('Volume1hEMA9', { symbol, isBullish });
        }
        
        const candles = await getCandlesWithFallback(symbol, VOLUME_1H_EMA9_SETTINGS.timeframe, 
            VOLUME_1H_EMA9_SETTINGS.lookbackPeriod + VOLUME_1H_EMA9_SETTINGS.emaPeriod);
        
        if (candles.length < VOLUME_1H_EMA9_SETTINGS.emaPeriod) {
            fallbackSystem.recordFallback('Volume1hEMA9', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return getIndicatorFallback('Volume1hEMA9', { symbol, isBullish });
        }

        const volumes = candles.map(c => c.volume);
        const closes = candles.map(c => c.close);
        const opens = candles.map(c => c.open);
        
        const volumeEMA = EMA.calculate({
            values: volumes,
            period: VOLUME_1H_EMA9_SETTINGS.emaPeriod
        });
        
        if (!volumeEMA || volumeEMA.length === 0) {
            throw new Error('Não foi possível calcular EMA do volume');
        }
        
        const currentVolume = volumes[volumes.length - 1];
        const currentEMA = volumeEMA[volumeEMA.length - 1];
        const previousEMA = volumeEMA.length > 1 ? volumeEMA[volumeEMA.length - 2] : currentEMA;
        
        const volumePercentage = currentEMA > 0 ? (currentVolume / currentEMA) * 100 : 100;
        
        const currentCandle = candles[candles.length - 1];
        const isBullishCandle = currentCandle.close > currentCandle.open;
        const candleRange = currentCandle.high - currentCandle.low;
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);
        
        let buyerSellerRatio = 50;
        
        if (candleRange > 0) {
            if (isBullishCandle) {
                const buyPressure = (currentCandle.close - currentCandle.low) / candleRange;
                buyerSellerRatio = 50 + (buyPressure * 50);
            } else {
                const sellPressure = (currentCandle.high - currentCandle.close) / candleRange;
                buyerSellerRatio = 50 - (sellPressure * 50);
            }
        }
        
        let classification = 'NEUTRO';
        let scorePoints = 0;
        
        if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.strongBuyers) {
            classification = 'FORTE COMPRADORES';
            scorePoints = isBullish ? VOLUME_1H_EMA9_SETTINGS.points.strongBuyers : 0;
        } else if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateBuyers) {
            classification = 'MODERADO COMPRADORES';
            scorePoints = isBullish ? VOLUME_1H_EMA9_SETTINGS.points.moderateBuyers : 0;
        } else if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.strongSellers) {
            classification = 'FORTE VENDEDORES';
            scorePoints = !isBullish ? VOLUME_1H_EMA9_SETTINGS.points.strongSellers : 0;
        } else if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateSellers) {
            classification = 'MODERADO VENDEDORES';
            scorePoints = !isBullish ? VOLUME_1H_EMA9_SETTINGS.points.moderateSellers : 0;
        } else {
            classification = 'NEUTRO';
            scorePoints = 0;
        }
        
        const isVolumeAboveEMA = currentVolume > currentEMA;
        const isEMARising = currentEMA > previousEMA;
        
        return {
            isValid: true,
            volumePercentage: Math.round(volumePercentage),
            buyerSellerRatio: Math.round(buyerSellerRatio),
            scorePoints: scorePoints,
            emaValue: currentEMA,
            currentVolume: currentVolume,
            classification: classification,
            isVolumeAboveEMA: isVolumeAboveEMA,
            isEMARising: isEMARising,
            trend: isVolumeAboveEMA ? 'ALTA' : 'BAIXA',
            details: `Volume 1h: ${currentVolume.toFixed(2)} vs EMA9: ${currentEMA.toFixed(2)} (${volumePercentage.toFixed(1)}%)`,
            isFallback: false
        };
        
    } catch (error) {
        console.log(`⚠️ Erro volume 1h EMA9 ${symbol}: ${error.message}`);
        
        fallbackSystem.recordFallback('Volume1hEMA9', 'SIMPLIFIED_DATA', { symbol, error: error.message });
        
        return getIndicatorFallback('Volume1hEMA9', { symbol, isBullish });
    }
}

async function getCCIDailyWithEMA5(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('CCIDailyEMA5', symbol)) {
            return getIndicatorFallback('CCIDailyEMA5', { symbol, isBullish });
        }
        
        const candles = await getCandlesWithFallback(symbol, CCI_DAILY_SETTINGS.timeframe, 
            CCI_DAILY_SETTINGS.lookbackPeriod + CCI_DAILY_SETTINGS.cciPeriod);
        
        if (candles.length < CCI_DAILY_SETTINGS.cciPeriod) {
            fallbackSystem.recordFallback('CCIDailyEMA5', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return getIndicatorFallback('CCIDailyEMA5', { symbol, isBullish });
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: CCI_DAILY_SETTINGS.cciPeriod
        });
        
        if (!cciValues || cciValues.length === 0) {
            throw new Error('Não foi possível calcular CCI');
        }
        
        const cciEMA = EMA.calculate({
            values: cciValues,
            period: CCI_DAILY_SETTINGS.emaPeriod
        });
        
        if (!cciEMA || cciEMA.length === 0) {
            throw new Error('Não foi possível calcular EMA do CCI');
        }
        
        const currentCCI = cciValues[cciValues.length - 1];
        const previousCCI = cciValues.length > 1 ? cciValues[cciValues.length - 2] : currentCCI;
        const currentCCIEMA = cciEMA[cciEMA.length - 1];
        const previousCCIEMA = cciEMA.length > 1 ? cciEMA[cciEMA.length - 2] : currentCCIEMA;
        
        const isBullishCross = previousCCI <= previousCCIEMA && currentCCI > currentCCIEMA;
        const isBearishCross = previousCCI >= previousCCIEMA && currentCCI < currentCCIEMA;
        
        let classification = 'NEUTRO';
        let scorePoints = 0;
        
        if (isBullishCross) {
            classification = 'CRUZAMENTO BULLISH';
            scorePoints = CCI_DAILY_SETTINGS.points.bullishCross;
        } else if (isBearishCross) {
            classification = 'CRUZAMENTO BEARISH';
            scorePoints = CCI_DAILY_SETTINGS.points.bearishCross;
        } else if (currentCCI >= CCI_DAILY_SETTINGS.thresholds.overbought) {
            classification = 'SOBRECOMPRADO';
            scorePoints = 0;
        } else if (currentCCI <= CCI_DAILY_SETTINGS.thresholds.oversold) {
            classification = 'SOBREVENDIDO';
            scorePoints = 0;
        } else if (currentCCI >= CCI_DAILY_SETTINGS.thresholds.strongTrend) {
            classification = 'TENDÊNCIA FORTE BULLISH';
            scorePoints = isBullish ? 5 : 0;
        } else if (currentCCI <= -CCI_DAILY_SETTINGS.thresholds.strongTrend) {
            classification = 'TENDÊNCIA FORTE BEARISH';
            scorePoints = !isBullish ? 5 : 0;
        } else if (currentCCI >= CCI_DAILY_SETTINGS.thresholds.moderateTrend) {
            classification = 'TENDÊNCIA MODERADA BULLISH';
            scorePoints = isBullish ? 3 : 0;
        } else if (currentCCI <= -CCI_DAILY_SETTINGS.thresholds.moderateTrend) {
            classification = 'TENDÊNCIA MODERADA BEARISH';
            scorePoints = !isBullish ? 3 : 0;
        }
        
        if (scorePoints > 0) {
            if ((isBullish && isBearishCross) || (!isBullish && isBullishCross)) {
                scorePoints = 0;
                classification += ' (CONTRÁRIO)';
            }
        }
        
        return {
            isValid: true,
            cciValue: currentCCI,
            emaValue: currentCCIEMA,
            isBullishCross: isBullishCross,
            isBearishCross: isBearishCross,
            scorePoints: scorePoints,
            classification: classification,
            position: currentCCI > currentCCIEMA ? 'ACIMA DA EMA' : 'ABAIXO DA EMA',
            trendStrength: Math.abs(currentCCI),
            details: `CCI ${currentCCI.toFixed(2)} vs EMA5: ${currentCCIEMA.toFixed(2)}`,
            isFallback: false
        };
        
    } catch (error) {
        console.log(`⚠️ Erro CCI diário EMA5 ${symbol}: ${error.message}`);
        
        fallbackSystem.recordFallback('CCIDailyEMA5', 'SIMPLIFIED_DATA', { symbol, error: error.message });
        
        return getIndicatorFallback('CCIDailyEMA5', { symbol, isBullish });
    }
}

// =====================================================================
// 🔄 FUNÇÕES DE FALLBACK ESPECÍFICAS (SISTEMA GRANULAR)
// =====================================================================

async function getCandlesWithFallback(symbol, timeframe, limit = 80) {
    try {
        if (!fallbackSystem.canUseFallback('Klines', symbol)) {
            throw new Error('Limite de fallbacks para Klines excedido');
        }
        
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();

        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < FALLBACK_CONFIG.maxCacheAge) {
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
        console.log(`⚠️ Erro ao buscar candles ${symbol} ${timeframe}: ${error.message}`);
        
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        if (candleCache[cacheKey]) {
            const cachedData = candleCache[cacheKey].data;
            const cacheAge = Date.now() - candleCache[cacheKey].timestamp;
            
            if (cacheAge < 10 * 60 * 1000) {
                fallbackSystem.recordFallback(
                    'Klines', 
                    'CACHE_INTERPOLATED', 
                    { symbol, timeframe, cacheAge: Math.round(cacheAge/1000) }
                );
                
                if (cachedData.length > limit) {
                    return cachedData.slice(-limit);
                }
                return cachedData;
            }
        }

        fallbackSystem.recordFallback(
            'Klines', 
            'ABORT_ANALYSIS', 
            { symbol, timeframe, error: error.message }
        );
        
        if (fallbackSystem.shouldAbortAnalysis(symbol)) {
            throw new Error(`Dados de preço indisponíveis para ${symbol}, análise abortada`);
        }
        
        throw error;
    }
}

async function getTechnicalIndicatorWithFallback(symbol, indicatorType, params) {
    try {
        if (!fallbackSystem.canUseFallback(indicatorType, symbol)) {
            return getIndicatorFallback(indicatorType, params);
        }
        
        switch(indicatorType) {
            case 'RSI':
                return await getRSIWithFallback(symbol);
            case 'Stochastic':
                return await getStochasticWithFallback(symbol, params);
            case 'ATR':
                return await getATRWithFallback(symbol);
            case 'EMA':
                return await getEMAWithFallback(symbol);
            case 'Volume1hEMA9':
                return await getVolume1hWithEMA9(symbol, params?.isBullish);
            case 'CCIDailyEMA5':
                return await getCCIDailyWithEMA5(symbol, params?.isBullish);
            default:
                throw new Error(`Tipo de indicador não suportado: ${indicatorType}`);
        }
    } catch (error) {
        console.log(`⚠️ Fallback para ${indicatorType} ${symbol}: ${error.message}`);
        return getIndicatorFallback(indicatorType, params);
    }
}

async function getRSIWithFallback(symbol) {
    try {
        if (!fallbackSystem.canUseFallback('RSI', symbol)) {
            return getIndicatorFallback('RSI', { symbol });
        }
        
        const candles = await getCandlesWithFallback(symbol, '1h', 80);
        if (candles.length < 14) {
            fallbackSystem.recordFallback('RSI', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            throw new Error('Dados insuficientes');
        }

        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        if (!rsiValues || rsiValues.length === 0) {
            throw new Error('Cálculo RSI falhou');
        }

        const latestRSI = rsiValues[rsiValues.length - 1];
        const previousRSI = rsiValues[rsiValues.length - 2];
        
        return {
            value: latestRSI,
            previous: previousRSI,
            status: latestRSI < 25 ? 'OVERSOLD' : latestRSI > 75 ? 'OVERBOUGHT' : 'NEUTRAL',
            isExitingExtreme: (previousRSI < 25 && latestRSI > 25) || 
                             (previousRSI > 75 && latestRSI < 75)
        };
    } catch (error) {
        const candles = await getCandlesWithFallback(symbol, '1h', 5);
        if (candles.length >= 2) {
            const currentClose = candles[candles.length - 1].close;
            const previousClose = candles[candles.length - 2].close;
            const roc = ((currentClose - previousClose) / previousClose) * 100;
            
            const proxyRSI = 50 + (roc * 2);
            const clampedRSI = Math.max(0, Math.min(100, proxyRSI));
            
            fallbackSystem.recordFallback(
                'RSI', 
                'ROC_PROXY', 
                { symbol, roc, proxyRSI: clampedRSI }
            );
            
            return {
                value: clampedRSI,
                previous: clampedRSI,
                status: clampedRSI < 30 ? 'OVERSOLD' : clampedRSI > 70 ? 'OVERBOUGHT' : 'NEUTRAL',
                isExitingExtreme: false,
                isFallback: true,
                fallbackType: 'ROC'
            };
        }
        
        fallbackSystem.recordFallback('RSI', 'DEFAULT_VALUE', { symbol });
        return getIndicatorFallback('RSI', { symbol });
    }
}

function getIndicatorFallback(indicatorType, params) {
    const fallbacks = {
        'RSI': { 
            value: 50, 
            previous: 50,
            status: 'NEUTRAL',
            isExitingExtreme: false,
            isFallback: true, 
            fallbackType: 'DEFAULT' 
        },
        'Stochastic': { 
            k: 50, 
            d: 50,
            kValue: 50,
            dValue: 50,
            isValid: false, 
            isFallback: true,
            fallbackType: 'DEFAULT' 
        },
        'ATR': { 
            value: 0, 
            percentage: 0,
            volatilityLevel: 'medium',
            isFallback: true,
            fallbackType: 'DEFAULT' 
        },
        'EMA': { 
            isAboveEMA55: false, 
            isEMA13CrossingUp: false,
            isEMA13CrossingDown: false,
            isFallback: true,
            fallbackType: 'DEFAULT' 
        },
        'Volume1hEMA9': {
            isValid: false,
            volumePercentage: 100,
            buyerSellerRatio: 50,
            scorePoints: 0,
            classification: 'FALLBACK',
            isFallback: true,
            fallbackType: 'DEFAULT'
        },
        'CCIDailyEMA5': {
            isValid: false,
            cciValue: 0,
            emaValue: 0,
            isBullishCross: false,
            isBearishCross: false,
            scorePoints: 0,
            classification: 'FALLBACK',
            isFallback: true,
            fallbackType: 'DEFAULT'
        }
    };

    const fallback = fallbacks[indicatorType];
    if (fallback) {
        return fallback;
    }

    throw new Error(`Fallback não disponível para ${indicatorType}`);
}

async function checkVolumeWithFallback(symbol) {
    try {
        if (!fallbackSystem.canUseFallback('Volume', symbol)) {
            return getVolumeFallback(symbol);
        }
        
        const volumeAnalysis = await checkVolumeRobust(symbol);
        if (volumeAnalysis.robustData && volumeAnalysis.robustData.combinedScore > 0.3) {
            return volumeAnalysis;
        }

        const candles15m = await getCandlesWithFallback(symbol, '15m', 40);
        if (candles15m.length >= 20) {
            const volumes = candles15m.map(c => c.volume);
            const closes = candles15m.map(c => c.close);
            
            const currentVolume = volumes[volumes.length - 1];
            const avgVolume15m = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const volumeRatio15m = currentVolume / avgVolume15m;
            
            const normalizedRatio = volumeRatio15m * 0.2;
            
            const volumeStd = Math.sqrt(
                volumes.slice(-20).reduce((sum, vol) => sum + Math.pow(vol - avgVolume15m, 2), 0) / 20
            );
            const zScore = volumeStd > 0 ? (currentVolume - avgVolume15m) / volumeStd : 0;
            
            const robustData = {
                currentVolume,
                emaRatio: normalizedRatio,
                zScore,
                combinedScore: Math.min(1, (normalizedRatio * 0.6) + (Math.min(3, Math.abs(zScore)) / 3 * 0.4)),
                classification: normalizedRatio > 1.2 ? 'MODERADO' : 'BAIXO',
                isFallback: true,
                fallbackType: '15M_NORMALIZED'
            };

            fallbackSystem.recordFallback(
                'Volume', 
                '15M_NORMALIZED', 
                { symbol, normalizedRatio, zScore }
            );

            return {
                rawRatio: normalizedRatio,
                isAbnormal: normalizedRatio > 1.5 || Math.abs(zScore) > 2,
                robustData
            };
        }

        fallbackSystem.recordFallback('Volume', 'MINIMAL_DATA', { symbol });
        return getVolumeFallback(symbol);

    } catch (error) {
        console.log(`⚠️ Fallback volume ${symbol}: ${error.message}`);
        fallbackSystem.recordFallback('Volume', 'ERROR_FALLBACK', { symbol, error: error.message });
        
        return getVolumeFallback(symbol);
    }
}

function getVolumeFallback(symbol) {
    return {
        rawRatio: 1.0,
        isAbnormal: false,
        robustData: {
            currentVolume: 0,
            emaRatio: 1.0,
            zScore: 0,
            combinedScore: 0.1,
            classification: 'INSUFICIENTE',
            isFallback: true,
            fallbackType: 'ERROR'
        }
    };
}

async function getLSRWithFallback(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('LSR', symbol)) {
            return getLSRFallback(symbol, isBullish);
        }
        
        const binanceLSR = await getBinanceLSRValue(symbol, '15m');
        
        if (binanceLSR && binanceLSR.lsrValue !== null) {
            const lsrValue = binanceLSR.lsrValue;
            const isValid = isBullish ? 
                lsrValue <= LSR_BUY_THRESHOLD :
                lsrValue > LSR_SELL_THRESHOLD;

            return {
                lsrRatio: lsrValue,
                isValid: isValid,
                binanceLSR: binanceLSR,
                isRising: binanceLSR.isRising,
                percentChange: binanceLSR.percentChange
            };
        }

        const [fundingData, oiData] = await Promise.all([
            checkFundingRate(symbol, isBullish),
            checkOpenInterest(symbol, isBullish)
        ]);

        let proxyLSR = 2.0;
        let isRising = false;
        
        if (fundingData.raw < -0.001 && oiData.trend === "📈") {
            proxyLSR = 1.8;
            isRising = false;
        } else if (fundingData.raw > 0.001 && oiData.trend === "📉") {
            proxyLSR = 2.8;
            isRising = true;
        }

        const isValid = isBullish ? proxyLSR <= LSR_BUY_THRESHOLD : proxyLSR > LSR_SELL_THRESHOLD;

        fallbackSystem.recordFallback(
            'LSR', 
            'FUNDING_OI_PROXY', 
            { symbol, proxyLSR, funding: fundingData.raw, oiTrend: oiData.trend }
        );

        return {
            lsrRatio: proxyLSR,
            isValid: isValid,
            binanceLSR: {
                lsrValue: proxyLSR,
                isRising: isRising,
                percentChange: '0.00',
                isFallback: true
            },
            isRising: isRising,
            percentChange: '0.00',
            isFallback: true,
            fallbackType: 'FUNDING_OI'
        };

    } catch (error) {
        console.log(`⚠️ Fallback LSR ${symbol}: ${error.message}`);
        
        fallbackSystem.recordFallback('LSR', 'NEUTRAL_FALLBACK', { symbol });
        
        return getLSRFallback(symbol, isBullish);
    }
}

function getLSRFallback(symbol, isBullish) {
    return {
        lsrRatio: 2.0,
        isValid: false,
        binanceLSR: null,
        isRising: false,
        percentChange: '0.00',
        isFallback: true,
        fallbackType: 'NEUTRAL'
    };
}

async function analyzePivotPointsWithFallback(symbol, currentPrice, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('PivotPoints', symbol)) {
            return getPivotPointsFallback(symbol, currentPrice, isBullish);
        }
        
        const pivotData = await analyzePivotPoints(symbol, currentPrice, isBullish);
        
        if (pivotData && !pivotData.error && pivotData.totalPivots > 0) {
            return pivotData;
        }

        const candles = await getCandlesWithFallback(symbol, '15m', 50);
        if (candles.length >= 20) {
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            
            const recentHigh = Math.max(...highs.slice(-20));
            const recentLow = Math.min(...lows.slice(-20));
            
            const resistanceLevel = {
                price: recentHigh,
                type: 'Resistência',
                strength: 'Moderado',
                timeframe: '15m',
                touches: 1,
                distancePercent: ((recentHigh - currentPrice) / currentPrice) * 100
            };
            
            const supportLevel = {
                price: recentLow,
                type: 'Suporte',
                strength: 'Moderado',
                timeframe: '15m',
                touches: 1,
                distancePercent: ((currentPrice - recentLow) / currentPrice) * 100
            };
            
            const nearestPivot = isBullish ? resistanceLevel : supportLevel;
            
            fallbackSystem.recordFallback(
                'PivotPoints', 
                'MIN_MAX_FALLBACK', 
                { symbol, recentHigh, recentLow }
            );

            return {
                supports: [supportLevel],
                resistances: [resistanceLevel],
                nearestSupport: supportLevel,
                nearestResistance: resistanceLevel,
                nearestPivot: {
                    ...nearestPivot,
                    isTesting: Math.abs(nearestPivot.distancePercent) < 0.5,
                    safeDistance: 1.0,
                    timeframeStrength: 1.0
                },
                currentPrice: currentPrice,
                totalPivots: 2,
                isFallback: true,
                fallbackType: 'MIN_MAX'
            };
        }

        fallbackSystem.recordFallback('PivotPoints', 'NO_DATA', { symbol });
        
        return getPivotPointsFallback(symbol, currentPrice, isBullish);

    } catch (error) {
        console.log(`⚠️ Fallback PivotPoints ${symbol}: ${error.message}`);
        fallbackSystem.recordFallback('PivotPoints', 'ERROR', { symbol, error: error.message });
        
        return getPivotPointsFallback(symbol, currentPrice, isBullish);
    }
}

function getPivotPointsFallback(symbol, currentPrice, isBullish) {
    return {
        supports: [],
        resistances: [],
        nearestSupport: null,
        nearestResistance: null,
        nearestPivot: null,
        currentPrice: currentPrice,
        totalPivots: 0,
        isFallback: true,
        fallbackType: 'NO_DATA'
    };
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
// 📊 FUNÇÕES AUXILIARES (REMOVIDAS REFERÊNCIAS A BTC)
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
        combinedScore >= VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore &&
        emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio &&
        Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

async function calculateFibonacciLevels(symbol, currentPrice, pivotType, pivotPrice) {
    try {
        const candles = await getCandlesWithFallback(symbol, '1h', 100);
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

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesWithFallback(symbol, '1h', 28);
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

async function sendSignalAlert(signal) {
    try {
        const volumeData = signal.marketData.volume?.robustData;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        
        const volume1hData = signal.marketData.volume1hEMA9;
        let volume1hInfo = '';
        if (volume1hData && volume1hData.isValid) {
            const volumePercentage = volume1hData.volumePercentage || 100;
            const buyerSellerRatio = volume1hData.buyerSellerRatio || 50;
            const classification = volume1hData.classification || 'NEUTRO';
            
            volume1hInfo = `\n📊 <i>Volume 1h EMA9:</i> ${volumePercentage}% ${classification} (Compradores/Vendedores: ${buyerSellerRatio}%)`;
            if (volume1hData.isFallback) {
                volume1hInfo += ' ⚠️(Fallback)';
            }
        }
        
        const cciDailyData = signal.marketData.cciDailyEMA5;
        let cciDailyInfo = '';
        if (cciDailyData && cciDailyData.isValid) {
            const cciValue = cciDailyData.cciValue || 0;
            const emaValue = cciDailyData.emaValue || 0;
            const classification = cciDailyData.classification || 'NEUTRO';
            const position = cciDailyData.position || 'NEUTRO';
            
            cciDailyInfo = `\n📈 <i>CCI Diário EMA5:</i> ${cciValue.toFixed(2)} (EMA5: ${emaValue.toFixed(2)}) - ${classification} - ${position}`;
            if (cciDailyData.isFallback) {
                cciDailyInfo += ' ⚠️(Fallback)';
            }
        }
        
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
        
        let analysisType = '';
        let analysisEmoji = '🤖';
        
        if (!isVolumeConfirmed) {
            const rsiValue = signal.marketData.rsi?.value || 50;
            const stochValid = signal.marketData.stoch?.isValid || false;
            const emaAlignment = signal.marketData.ema?.isAboveEMA55 || false;
            
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
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX && stochValid && emaAlignment) {
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
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75 && !stochValid && !emaAlignment) {
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
        if (isVolumeConfirmed) {
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
        
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const baseProbability = calculateProbability(signal);

        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';

        const stoch12hData = signal.marketData.stochastic12h;
        const stochDailyData = signal.marketData.stochasticDaily;
        
        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData && stoch12hData.isValid && stoch12hData.kValue !== null && stoch12hData.dValue !== null) {
            const kValue = stoch12hData.kValue.toFixed(1);
            const dValue = stoch12hData.dValue.toFixed(1);
            
            if (stoch12hData.lastCross) {
                const time = stoch12hData.lastCross.time || '';
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${stoch12hData.lastCross.direction} às ${time}`;
            } else {
                const trend = stoch12hData.kValue > stoch12hData.dValue ? 'ALTA' : 'BAIXA';
                stoch12hInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stoch12hData && stoch12hData.raw && stoch12hData.raw.current) {
            const kValue = stoch12hData.raw.current.k?.toFixed(1) || 'N/A';
            const dValue = stoch12hData.raw.current.d?.toFixed(1) || 'N/A';
            stoch12hInfo = `K:${kValue} D:${dValue}`;
        } else {
            stoch12hInfo = 'Dados insuficientes';
        }
        
        if (stochDailyData && stochDailyData.isValid && stochDailyData.kValue !== null && stochDailyData.dValue !== null) {
            const kValue = stochDailyData.kValue.toFixed(1);
            const dValue = stochDailyData.dValue.toFixed(1);
            
            if (stochDailyData.lastCross) {
                const time = stochDailyData.lastCross.time || '';
                stochDailyInfo = `K:${kValue} D:${dValue} | Cruzamento ${stochDailyData.lastCross.direction} às ${time}`;
            } else {
                const trend = stochDailyData.kValue > stochDailyData.dValue ? 'ALTA' : 'BAIXA';
                stochDailyInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stochDailyData && stochDailyData.raw && stochDailyData.raw.current) {
            const kValue = stochDailyData.raw.current.k?.toFixed(1) || 'N/A';
            const dValue = stochDailyData.raw.current.d?.toFixed(1) || 'N/A';
            stochDailyInfo = `K:${kValue} D:${dValue}`;
        } else {
            stochDailyInfo = 'Dados insuficientes';
        }

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

        const fallbackStatus = fallbackSystem.getStatus(signal.symbol);
        const fallbackInfo = fallbackStatus.activeFallbacks > 0 ? 
            `\n<b>🛡️ Sistema de Fallback:</b> ${fallbackStatus.activeFallbacks} fallbacks ativos (Penalidade: ${fallbackStatus.penalty.toFixed(1)})` : '';

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
• Dist S/R: ${distancePercent}% 
${volume1hInfo}
${cciDailyInfo}
${fibInfo}
${adxInfo}

<b>📊 Stochastic Tendência (5.3.3)</b>
• 12h: ${stoch12hInfo}
• Diário: ${stochDailyInfo}
${fallbackInfo}
${!isVolumeConfirmed ? `\n<b>⚠️ ${analysisType} - VOLUME INSUFICIENTE PARA OPERAÇÃO</b>` : ''}
        `;

        if (isVolumeConfirmed) {
            message += `
<b> Alvos </b>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}
<b>📍 ENTRADA</b>
• Liquidez 1: $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
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
        console.log(`   Volume 1h: ${volume1hData?.volumePercentage || 'N/A'}% (${volume1hData?.classification || 'N/A'})`);
        console.log(`   CCI Diário: ${cciDailyData?.cciValue?.toFixed(2) || 'N/A'} (${cciDailyData?.classification || 'N/A'})`);
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        console.log(`   Stochastic 12h: ${stoch12hInfo}`);
        console.log(`   Stochastic Diário: ${stochDailyInfo}`);
        console.log(`   Fallbacks: ${fallbackStatus.activeFallbacks} ativos (${fallbackStatus.priorityCounts.CRITICAL} críticos)`);

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

    const volume1hData = signal.marketData.volume1hEMA9;
    if (volume1hData && volume1hData.isValid) {
        const volumePercentage = volume1hData.volumePercentage || 100;
        const buyerSellerRatio = volume1hData.buyerSellerRatio || 50;
        
        if (signal.isBullish) {
            if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.strongBuyers) {
                baseProbability += 10;
            } else if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateBuyers) {
                baseProbability += 5;
            } else if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.strongSellers) {
                baseProbability -= 15;
            } else if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateSellers) {
                baseProbability -= 8;
            }
            
            if (buyerSellerRatio > 60) {
                baseProbability += 5;
            } else if (buyerSellerRatio < 40) {
                baseProbability -= 10;
            }
        } else {
            if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.strongSellers) {
                baseProbability += 10;
            } else if (volumePercentage <= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateSellers) {
                baseProbability += 5;
            } else if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.strongBuyers) {
                baseProbability -= 15;
            } else if (volumePercentage >= VOLUME_1H_EMA9_SETTINGS.thresholds.moderateBuyers) {
                baseProbability -= 8;
            }
            
            if (buyerSellerRatio < 40) {
                baseProbability += 5;
            } else if (buyerSellerRatio > 60) {
                baseProbability -= 10;
            }
        }
        
        if (volume1hData.isFallback) {
            baseProbability -= 5;
        }
    }

    const cciDailyData = signal.marketData.cciDailyEMA5;
    if (cciDailyData && cciDailyData.isValid) {
        const cciValue = cciDailyData.cciValue || 0;
        const isBullishCross = cciDailyData.isBullishCross || false;
        const isBearishCross = cciDailyData.isBearishCross || false;
        
        if (signal.isBullish) {
            if (isBullishCross) {
                baseProbability += 15;
            } else if (isBearishCross) {
                baseProbability -= 20;
            } else if (cciValue >= CCI_DAILY_SETTINGS.thresholds.overbought) {
                baseProbability -= 15;
            } else if (cciValue <= CCI_DAILY_SETTINGS.thresholds.oversold) {
                baseProbability += 10;
            } else if (cciValue >= CCI_DAILY_SETTINGS.thresholds.strongTrend) {
                baseProbability += 8;
            } else if (cciValue >= CCI_DAILY_SETTINGS.thresholds.moderateTrend) {
                baseProbability += 5;
            }
        } else {
            if (isBearishCross) {
                baseProbability += 15;
            } else if (isBullishCross) {
                baseProbability -= 20;
            } else if (cciValue <= CCI_DAILY_SETTINGS.thresholds.oversold) {
                baseProbability -= 15;
            } else if (cciValue >= CCI_DAILY_SETTINGS.thresholds.overbought) {
                baseProbability += 10;
            } else if (cciValue <= -CCI_DAILY_SETTINGS.thresholds.strongTrend) {
                baseProbability += 8;
            } else if (cciValue <= -CCI_DAILY_SETTINGS.thresholds.moderateTrend) {
                baseProbability += 5;
            }
        }
        
        if (cciDailyData.isFallback) {
            baseProbability -= 5;
        }
    }

    const stoch12h = signal.marketData.stochastic12h;
    const stochDaily = signal.marketData.stochasticDaily;
    
    if (stochDaily?.isValid) {
        if ((signal.isBullish && stochDaily.kValue > stochDaily.dValue) ||
            (!signal.isBullish && stochDaily.kValue < stochDaily.dValue)) {
            baseProbability += 8;
        } else {
            baseProbability -= 10;
        }
    }
    
    if (stoch12h?.isValid) {
        if ((signal.isBullish && stoch12h.kValue > stoch12h.dValue) ||
            (!signal.isBullish && stoch12h.kValue < stoch12h.dValue)) {
            baseProbability += 5;
        } else {
            baseProbability -= 6;
        }
    }

    const fallbackPenalty = fallbackSystem.getFallbackPenalty(signal.symbol);
    baseProbability -= fallbackPenalty * 2;

    return Math.min(92, Math.max(35, Math.round(baseProbability)));
}

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

async function checkVolumeRobust(symbol) {
    try {
        if (!fallbackSystem.canUseFallback('Volume', symbol)) {
            return {
                rawRatio: 0,
                isAbnormal: false,
                robustData: null
            };
        }
        
        const candles = await getCandlesWithFallback(symbol, '3m', VOLUME_ROBUST_SETTINGS.maxZScoreLookback);
        if (candles.length < VOLUME_ROBUST_SETTINGS.emaPeriod) {
            fallbackSystem.recordFallback('Volume', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
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
        fallbackSystem.recordFallback('Volume', 'ERROR_ANALYSIS', { symbol, error: error.message });
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

async function checkStochasticWithTimeframe(symbol, isBullish, settings) {
    try {
        if (!fallbackSystem.canUseFallback('Stochastic12h', symbol) && settings.timeframe === '12h') {
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null,
                raw: null
            };
        }
        
        if (!fallbackSystem.canUseFallback('StochasticDaily', symbol) && settings.timeframe === '1d') {
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null,
                raw: null
            };
        }
        
        const candles = await getCandlesWithFallback(symbol, settings.timeframe, settings.requiredCandles);
        if (candles.length < settings.period + 5) {
            const fallbackType = settings.timeframe === '12h' ? 'Stochastic12h' : 'StochasticDaily';
            fallbackSystem.recordFallback(fallbackType, 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null,
                raw: null
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
            const fallbackType = settings.timeframe === '12h' ? 'Stochastic12h' : 'StochasticDaily';
            fallbackSystem.recordFallback(fallbackType, 'CALCULATION_ERROR', { symbol });
            return {
                isValid: false,
                kValue: null,
                dValue: null,
                lastCross: null,
                raw: null
            };
        }

        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        const kValue = current.k;
        const dValue = current.d;

        let lastCross = null;
        
        for (let i = Math.max(0, stochValues.length - 6); i < stochValues.length - 1; i++) {
            const prev = stochValues[i];
            const curr = stochValues[i + 1];
            
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
            },
            timestamp: Date.now()
        };

    } catch (error) {
        console.log(`⚠️ Erro Stochastic ${settings.timeframe} ${symbol}: ${error.message}`);
        const fallbackType = settings.timeframe === '12h' ? 'Stochastic12h' : 'StochasticDaily';
        fallbackSystem.recordFallback(fallbackType, 'ERROR', { symbol, error: error.message });
        return {
            isValid: false,
            kValue: null,
            dValue: null,
            lastCross: null,
            raw: null,
            timestamp: Date.now()
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

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('PivotPoints', symbol)) {
            return { error: 'Limite de fallbacks para PivotPoints excedido' };
        }
        
        const allPivots = [];
        
        for (const timeframe of PIVOT_POINTS_SETTINGS.analyzeTimeframes) {
            try {
                const candles = await getCandlesWithFallback(
                    symbol, 
                    timeframe, 
                    PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe] || 70
                );

                if (candles.length < 50) {
                    console.log(`⚠️ Dados insuficientes para pivot ${timeframe} ${symbol}: ${candles.length} candles`);
                    continue;
                }

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
            fallbackSystem.recordFallback('PivotPoints', 'NO_PIVOTS_DETECTED', { symbol });
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
                '15m': allPivots.filter(p => p.timeframe === '15m').length,
                '1h': allPivots.filter(p => p.timeframe === '1h').length,
                '4h': allPivots.filter(p => p.timeframe === '4h').length
            }
        };

    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        fallbackSystem.recordFallback('PivotPoints', 'ERROR', { symbol, error: error.message });
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

async function analyzeSupportResistance(symbol, currentPrice, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('SupportResistance', symbol)) {
            return { error: 'Limite de fallbacks para SupportResistance excedido' };
        }
        
        const candles = await getCandlesWithFallback(symbol, SUPPORT_RESISTANCE_SETTINGS.timeframe,
            SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod + 20);

        if (candles.length < SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod) {
            fallbackSystem.recordFallback('SupportResistance', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
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
        fallbackSystem.recordFallback('SupportResistance', 'ERROR', { symbol, error: error.message });
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
        if (!fallbackSystem.canUseFallback('ATR', symbol)) {
            return null;
        }
        
        const candles = await getCandlesWithFallback(symbol, timeframe, period + 20);
        if (candles.length < period) {
            fallbackSystem.recordFallback('ATR', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });

        if (!atrValues || atrValues.length === 0) {
            fallbackSystem.recordFallback('ATR', 'CALCULATION_ERROR', { symbol });
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
    } catch (error) {
        fallbackSystem.recordFallback('ATR', 'ERROR', { symbol, error: error.message });
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
        fallbackSystem.recordFallback('TargetCalculation', 'ERROR', { symbol, error: error.message });
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

async function sendInitializationMessage(allSymbols) {
    try {
        const brazilTime = getBrazilianDateTime();

        const message = `
🚀 <b>TITANIUM ATIVADO !</b>

${brazilTime.full}
📊 Sistema aprimorado:
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
            console.log('🚀 TITANIUM ATIVADO COM NOVOS INDICADORES!');
            console.log(`⏰ ${brazilTime.full}`);
            console.log('='.repeat(60) + '\n');
        }

        return success;

    } catch (error) {
        console.error('❌ Erro ao enviar mensagem de inicialização:', error.message);
        return false;
    }
}

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
    return getCandlesWithFallback(symbol, timeframe, limit);
}

async function getEMAs3m(symbol) {
    try {
        if (!fallbackSystem.canUseFallback('EMA', symbol)) {
            return null;
        }
        
        const candles = await getCandlesWithFallback(symbol, '3m', 80);
        if (candles.length < 55) {
            fallbackSystem.recordFallback('EMA', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return null;
        }

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
        fallbackSystem.recordFallback('EMA', 'ERROR', { symbol, error: error.message });
        return null;
    }
}

async function getRSI1h(symbol) {
    return getRSIWithFallback(symbol);
}

async function getStochasticWithFallback(symbol, params) {
    try {
        if (!fallbackSystem.canUseFallback('Stochastic', symbol)) {
            return { isValid: false, k: 50, d: 50, isFallback: true };
        }
        
        const stoch = await checkStochastic(symbol, params?.isBullish || true);
        return stoch;
    } catch (error) {
        fallbackSystem.recordFallback('Stochastic', 'ERROR', { symbol, error: error.message });
        return { isValid: false, k: 50, d: 50, isFallback: true };
    }
}

async function getATRWithFallback(symbol) {
    try {
        return await getATRData(symbol);
    } catch (error) {
        return { value: 0, percentage: 0, isFallback: true };
    }
}

async function getEMAWithFallback(symbol) {
    try {
        return await getEMAs3m(symbol);
    } catch (error) {
        return { isAboveEMA55: false, isEMA13CrossingUp: false, isFallback: true };
    }
}

async function checkVolume(symbol) {
    return checkVolumeWithFallback(symbol);
}

async function checkVolatility(symbol) {
    try {
        if (!fallbackSystem.canUseFallback('Volatility', symbol)) {
            return { rawVolatility: 0, isValid: false };
        }
        
        const candles = await getCandlesWithFallback(symbol, '15m', 25);
        if (candles.length < 15) {
            fallbackSystem.recordFallback('Volatility', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return { rawVolatility: 0, isValid: false };
        }

        const closes = candles.map(c => c.close);
        const returns = [];

        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]));
        }

        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;

        return {
            rawVolatility: volatility,
            isValid: true
        };
    } catch (error) {
        fallbackSystem.recordFallback('Volatility', 'ERROR', { symbol, error: error.message });
        return { rawVolatility: 0, isValid: false };
    }
}

async function checkLSR(symbol, isBullish) {
    return getLSRWithFallback(symbol, isBullish);
}

async function checkStochastic(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('Stochastic', symbol)) {
            return { isValid: false };
        }
        
        const candles = await getCandlesWithFallback(symbol, '1h', 30);
        if (candles.length < STOCH_SETTINGS.period + 5) {
            fallbackSystem.recordFallback('Stochastic', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return { isValid: false };
        }

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

        if (!stochValues || stochValues.length < 2) {
            fallbackSystem.recordFallback('Stochastic', 'CALCULATION_ERROR', { symbol });
            return { isValid: false };
        }

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
        fallbackSystem.recordFallback('Stochastic', 'ERROR', { symbol, error: error.message });
        return { isValid: false };
    }
}

async function checkStochastic4h(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('Stochastic', symbol)) {
            return { isValid: false };
        }
        
        const candles = await getCandlesWithFallback(symbol, '4h', 40);
        if (candles.length < STOCH_4H_SETTINGS.period + 5) {
            fallbackSystem.recordFallback('Stochastic4h', 'INSUFFICIENT_DATA', { symbol, candlesLength: candles.length });
            return { isValid: false };
        }

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

        if (!stochValues || stochValues.length < 2) {
            fallbackSystem.recordFallback('Stochastic4h', 'CALCULATION_ERROR', { symbol });
            return { isValid: false };
        }

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
        fallbackSystem.recordFallback('Stochastic4h', 'ERROR', { symbol, error: error.message });
        return { isValid: false };
    }
}

async function checkOpenInterest(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('OpenInterest', symbol)) {
            return { isValid: false, trend: "➡️" };
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

        return {
            isValid: isValid,
            trend: trend
        };
    } catch (error) {
        fallbackSystem.recordFallback('OpenInterest', 'ERROR', { symbol, error: error.message });
        return { isValid: false, trend: "➡️" };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        if (!fallbackSystem.canUseFallback('Funding', symbol)) {
            return { 
                isValid: false, 
                raw: 0,
                isRising: false,
                directionFavorable: false
            };
        }
        
        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`,
            {},
            'fundingRate'
        );

        if (!data || data.length === 0) {
            fallbackSystem.recordFallback('Funding', 'NO_DATA', { symbol });
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
        fallbackSystem.recordFallback('Funding', 'ERROR', { symbol, error: error.message });
        return { 
            isValid: false, 
            raw: 0, 
            isRising: false,
            directionFavorable: false 
        };
    }
}

function calculateProbabilityWithFallbacks(signal, fallbackCount) {
    let baseProbability = calculateProbability(signal);
    
    if (fallbackCount > 0) {
        const fallbackPenalty = fallbackCount * 3;
        baseProbability = Math.max(30, baseProbability - fallbackPenalty);
        
        if (fallbackSystem.degradedMode) {
            baseProbability = Math.max(25, baseProbability - 10);
        }
    }
    
    return Math.min(92, Math.max(25, Math.round(baseProbability)));
}

async function calculateSignalQualityWithFallbacks(symbol, isBullish, marketData) {
    const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);
    
    let adjustedThreshold = QUALITY_THRESHOLD;
    const activeFallbacks = fallbackSystem.getActiveFallbacks();
    const symbolFallbacks = activeFallbacks.filter(fb => 
        fb.details.symbol === symbol || !fb.details.symbol
    );
    
    if (symbolFallbacks.length > 0) {
        if (fallbackSystem.degradedMode) {
            adjustedThreshold = FALLBACK_CONFIG.degradedThreshold;
        } else {
            const reduction = Math.min(10, symbolFallbacks.length * 2);
            adjustedThreshold = Math.max(70, QUALITY_THRESHOLD - reduction);
        }
    }
    
    qualityScore.isAcceptable = qualityScore.score >= adjustedThreshold;
    qualityScore.adjustedThreshold = adjustedThreshold;
    qualityScore.fallbackCount = symbolFallbacks.length;
    
    return qualityScore;
}

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];

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

    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(` Volatilidade 15m: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatilidade 15m: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}%`);
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
        const direction = isBullish ? 'K > D (cruzamento bullish)' : 'K < D (cruzamento bearish)';
        details.push(` Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h} ${direction}`);
    } else {
        failedChecks.push(`Stoch 4h: Sem cruzamento ${isBullish ? 'bullish' : 'bearish'}`);
    }

    if (marketData.volume1hEMA9) {
        const volume1hData = marketData.volume1hEMA9;
        let volume1hScore = 0;
        let volume1hDetail = '';

        if (volume1hData.isValid) {
            const volumePercentage = volume1hData.volumePercentage || 100;
            const buyerSellerRatio = volume1hData.buyerSellerRatio || 50;
            const classification = volume1hData.classification || 'NEUTRO';
            const scorePoints = volume1hData.scorePoints || 0;
            
            volume1hScore = Math.min(QUALITY_WEIGHTS.volume1hEMA9, scorePoints);
            volume1hDetail = `${volume1hScore}/${QUALITY_WEIGHTS.volume1hEMA9} (Volume 1h: ${volumePercentage}% ${classification})`;
            
            if (volume1hData.isFallback) {
                volume1hScore *= 0.7;
                volume1hDetail += ' ⚠️(Fallback)';
            }
        } else {
            volume1hDetail = `0/${QUALITY_WEIGHTS.volume1hEMA9} (Dados indisponíveis)`;
            failedChecks.push(`Volume 1h EMA9: Dados indisponíveis`);
        }
        
        score += volume1hScore;
        details.push(` Volume 1h EMA9: ${volume1hDetail}`);
    } else {
        failedChecks.push(`Volume 1h EMA9: Não analisado`);
    }

    if (marketData.cciDailyEMA5) {
        const cciDailyData = marketData.cciDailyEMA5;
        let cciDailyScore = 0;
        let cciDailyDetail = '';

        if (cciDailyData.isValid) {
            const cciValue = cciDailyData.cciValue || 0;
            const emaValue = cciDailyData.emaValue || 0;
            const classification = cciDailyData.classification || 'NEUTRO';
            const scorePoints = cciDailyData.scorePoints || 0;
            
            cciDailyScore = Math.min(QUALITY_WEIGHTS.cciDailyEMA5, scorePoints);
            cciDailyDetail = `${cciDailyScore}/${QUALITY_WEIGHTS.cciDailyEMA5} (CCI Diário: ${cciValue.toFixed(2)} ${classification})`;
            
            if (cciDailyData.isFallback) {
                cciDailyScore *= 0.7;
                cciDailyDetail += ' ⚠️(Fallback)';
            }
        } else {
            cciDailyDetail = `0/${QUALITY_WEIGHTS.cciDailyEMA5} (Dados indisponíveis)`;
            failedChecks.push(`CCI Diário EMA5: Dados indisponíveis`);
        }
        
        score += cciDailyScore;
        details.push(` CCI Diário EMA5: ${cciDailyDetail}`);
    } else {
        failedChecks.push(`CCI Diário EMA5: Não analisado`);
    }

    if (marketData.stochastic12h) {
        const stoch12h = marketData.stochastic12h;
        let stoch12hScore = 0;
        let stoch12hDetail = '';

        if (stoch12h.isValid) {
            const kValue = stoch12h.kValue?.toFixed(1) || 'N/A';
            const dValue = stoch12h.dValue?.toFixed(1) || 'N/A';
            
            if ((isBullish && stoch12h.kValue > stoch12h.dValue) ||
                (!isBullish && stoch12h.kValue < stoch12h.dValue)) {
                stoch12hScore = QUALITY_WEIGHTS.stochastic12h;
                stoch12hDetail = `${stoch12hScore}/${QUALITY_WEIGHTS.stochastic12h} (Tendência ${isBullish ? 'bullish' : 'bearish'} confirmada K:${kValue} > D:${dValue})`;
                
                if (stoch12h.lastCross) {
                    stoch12hDetail += ` | Cruzamento ${stoch12h.lastCross.direction} às ${stoch12h.lastCross.time}`;
                }
            } else {
                stoch12hScore = 2;
                stoch12hDetail = `${stoch12hScore}/${QUALITY_WEIGHTS.stochastic12h} (Sem tendência clara K:${kValue} ${isBullish ? '≤' : '≥'} D:${dValue})`;
                failedChecks.push(`Stoch 12h: Tendência não confirmada`);
            }
        } else {
            stoch12hDetail = `0/${QUALITY_WEIGHTS.stochastic12h} (Dados insuficientes)`;
            failedChecks.push(`Stoch 12h: Dados insuficientes`);
        }
        
        score += stoch12hScore;
        details.push(` Stoch 12h (5.3.3): ${stoch12hDetail}`);
    }

    if (marketData.stochasticDaily) {
        const stochDaily = marketData.stochasticDaily;
        let stochDailyScore = 0;
        let stochDailyDetail = '';

        if (stochDaily.isValid) {
            const kValue = stochDaily.kValue?.toFixed(1) || 'N/A';
            const dValue = stochDaily.dValue?.toFixed(1) || 'N/A';
            
            if ((isBullish && stochDaily.kValue > stochDaily.dValue) ||
                (!isBullish && stochDaily.kValue < stochDaily.dValue)) {
                stochDailyScore = QUALITY_WEIGHTS.stochasticDaily;
                stochDailyDetail = `${stochDailyScore}/${QUALITY_WEIGHTS.stochasticDaily} (TENDÊNCIA FORTE ${isBullish ? 'BULLISH' : 'BEARISH'} K:${kValue} > D:${dValue})`;
                
                if (stochDaily.lastCross) {
                    stochDailyDetail += ` | Cruzamento ${stochDaily.lastCross.direction} às ${stochDaily.lastCross.time}`;
                }
            } else {
                stochDailyScore = 1;
                stochDailyDetail = `${stochDailyScore}/${QUALITY_WEIGHTS.stochasticDaily} (TENDÊNCIA CONTRÁRIA K:${kValue} ${isBullish ? '≤' : '≥'} D:${dValue})`;
                failedChecks.push(`Stoch Diário: Tendência contrária em timeframe maior`);
            }
        } else {
            stochDailyDetail = `0/${QUALITY_WEIGHTS.stochasticDaily} (Dados insuficientes)`;
            failedChecks.push(`Stoch Diário: Dados insuficientes`);
        }
        
        score += stochDailyScore;
        details.push(` Stoch Diário (5.3.3): ${stochDailyDetail}`);
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
                const blacklist = ['BULL', 'BEAR', 'UP', 'DOWN',];
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
        if (fallbackSystem.shouldAbortAnalysis(symbol)) {
            console.log(`⛔ Análise abortada para ${symbol} (muitos fallbacks)`);
            return null;
        }
        
        const emaData = await getEMAs3m(symbol);
        if (!emaData) {
            console.log(`❌ ${symbol}: Dados EMA indisponíveis`);
            return null;
        }

        const rsiData = await getRSIWithFallback(symbol);
        if (!rsiData) {
            console.log(`❌ ${symbol}: Dados RSI indisponíveis`);
            return null;
        }

        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;

        if (!isBullish && !isBearish) {
            console.log(`❌ ${symbol}: Sem sinal de EMA`);
            return null;
        }

        if (isBullish && rsiData.value > RSI_BUY_MAX) {
            console.log(`❌ ${symbol}: RSI alto para compra (${rsiData.value.toFixed(1)} > ${RSI_BUY_MAX})`);
            return null;
        }
        if (isBearish && rsiData.value < RSI_SELL_MIN) {
            console.log(`❌ ${symbol}: RSI baixo para venda (${rsiData.value.toFixed(1)} < ${RSI_SELL_MIN})`);
            return null;
        }

        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPointsWithFallback(symbol, emaData.currentPrice, isBullish);
        
        const volume1hData = await getVolume1hWithEMA9(symbol, isBullish);
        const cciDailyData = await getCCIDailyWithEMA5(symbol, isBullish);

        const stoch12hData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_12H_SETTINGS);
        const stochDailyData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_DAILY_SETTINGS);

        const [volumeData, volatilityData, lsrData, stochData, stoch4hData, oiData, fundingData] = await Promise.all([
            checkVolumeWithFallback(symbol),
            checkVolatility(symbol),
            getLSRWithFallback(symbol, isBullish),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);

        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            stoch: stochData,
            stoch4h: stoch4hData,
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
            stochastic12h: stoch12hData,
            stochasticDaily: stochDailyData,
            volume1hEMA9: volume1hData,
            cciDailyEMA5: cciDailyData
        };

        const qualityScore = await calculateSignalQualityWithFallbacks(symbol, isBullish, marketData);

        if (!qualityScore.isAcceptable) {
            console.log(`❌ ${symbol}: Score de qualidade insuficiente (${qualityScore.score} < ${qualityScore.adjustedThreshold})`);
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

        const srInfo = supportResistanceData?.nearestSupport || supportResistanceData?.nearestResistance;
        const srDistance = srInfo?.distancePercent?.toFixed(2) || 'N/A';
        const breakoutRisk = supportResistanceData?.breakoutRisk?.level || 'N/A';
        
        const pivotInfo = pivotPointsData?.nearestPivot;
        const pivotDistance = pivotInfo?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = pivotInfo?.type || 'N/A';
        const pivotStrength = pivotInfo?.strength || 'N/A';
        const pivotTimeframe = pivotInfo?.timeframe || 'N/A';
        
        let volume1hInfo = 'N/A';
        if (volume1hData && volume1hData.isValid) {
            volume1hInfo = `${volume1hData.volumePercentage}% (${volume1hData.classification})`;
        }
        
        let cciDailyInfo = 'N/A';
        if (cciDailyData && cciDailyData.isValid) {
            cciDailyInfo = `${cciDailyData.cciValue?.toFixed(2) || 'N/A'} (${cciDailyData.classification})`;
        }

        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData?.isValid && stoch12hData.kValue !== null && stoch12hData.dValue !== null) {
            const kValue = stoch12hData.kValue.toFixed(1);
            const dValue = stoch12hData.dValue.toFixed(1);
            
            if (stoch12hData.lastCross) {
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${stoch12hData.lastCross.direction} às ${stoch12hData.lastCross.time}`;
            } else {
                const trend = stoch12hData.kValue > stoch12hData.dValue ? 'ALTA' : 'BAIXA';
                stoch12hInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        }
        
        if (stochDailyData?.isValid && stochDailyData.kValue !== null && stochDailyData.dValue !== null) {
            const kValue = stochDailyData.kValue.toFixed(1);
            const dValue = stochDailyData.dValue.toFixed(1);
            
            if (stochDailyData.lastCross) {
                const time = stochDailyData.lastCross.time || '';
                stochDailyInfo = `K:${kValue} D:${dValue} | Cruzamento ${stochDailyData.lastCross.direction} às ${time}`;
            } else {
                const trend = stochDailyData.kValue > stochDailyData.dValue ? 'ALTA' : 'BAIXA';
                stochDailyInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        }

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

        const volumeRobustData = volumeData.robustData;
        const volumeScore = volumeRobustData?.combinedScore?.toFixed(2) || '0.00';
        const volumeClassification = volumeRobustData?.classification || 'NORMAL';
        const emaRatio = volumeRobustData?.emaRatio?.toFixed(2) || 'N/A';
        const zScore = volumeRobustData?.zScore?.toFixed(2) || 'N/A';

        const fallbackStatus = fallbackSystem.getStatus(symbol);
        
        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📈 Volume: ${volumeData.rawRatio.toFixed(2)}x (Score: ${volumeScore} - ${volumeClassification})`);
        console.log(`   📊 EMA: ${emaRatio}x | Z-Score: ${zScore}`);
        console.log(`   📊 LSR Binance: ${lsrData.lsrRatio.toFixed(3)}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   📊 Volume 1h: ${volume1hInfo}`);
        console.log(`   📊 CCI Diário: ${cciDailyInfo}`);
        console.log(`   📊 Stoch 1h: ${stochData.isValid ? '✅' : '❌'} (K:${stochData.kValue?.toFixed(1) || 'N/A'}, D:${stochData.dValue?.toFixed(1) || 'N/A'})`);
        console.log(`   📊 Stoch 12h: ${stoch12hInfo}`);
        console.log(`   📊 Stoch Diário: ${stochDailyInfo}`);
        console.log(`   💰 Funding: ${fundingRateText}`);
        console.log(`   🛡️ Fallbacks: ${fallbackStatus.activeFallbacks} (${fallbackStatus.priorityCounts.CRITICAL} críticos)`);

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

    console.log(`\n TITANIUM ATIVADO COM NOVOS INDICADORES!`);
    console.log(` ${allSymbols.length} ativos Binance Futures`);
    console.log(` Sistema aprimorado com Volume 1h EMA9 e CCI Diário EMA5`);
    console.log(` Sistema de Fallback Granular (8.0/10) ativado`);
    console.log(` Bot iniciando...`);

    await sendInitializationMessage(allSymbols);

    let consecutiveErrors = 0;
    let totalSignals = 0;
    let totalAnalysis = 0;
    let lastReportTime = Date.now();
    let lastFallbackCleanup = Date.now();

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
            
            const fallbackStatus = fallbackSystem.getStatus();
            if (fallbackStatus.degradedMode) {
                console.log(`⚠️ SISTEMA EM MODO DEGRADADO (${fallbackStatus.activeFallbacks} fallbacks ativos)`);
                console.log(`   Prioridades: CRITICAL:${fallbackStatus.priorityCounts.CRITICAL} IMPORTANT:${fallbackStatus.priorityCounts.IMPORTANT} SECONDARY:${fallbackStatus.priorityCounts.SECONDARY}`);
            }

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
                const adjustedThreshold = fallbackSystem.degradedMode ? 
                    FALLBACK_CONFIG.degradedThreshold : 
                    QUALITY_THRESHOLD;
                
                if (signal.qualityScore.score >= adjustedThreshold) {
                    const alertResult = await sendSignalAlert(signal);
                    if (alertResult) {
                        totalAnalysis++;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            cleanupCaches();
            
            if (Date.now() - lastFallbackCleanup >= 5 * 60 * 1000) {
                fallbackSystem.clearOldFallbacks();
                lastFallbackCleanup = Date.now();
            }

            const status = symbolManager.getCurrentStatus();
            const fallbackStats = fallbackSystem.getStatus();
            console.log(`📊 Progresso: ${status.consecutiveNoSignals} grupos sem sinais | Análises: ${totalAnalysis}`);
            console.log(`🛡️  Fallbacks: ${fallbackStats.activeFallbacks} ativos | Modo: ${fallbackStats.degradedMode ? 'DEGRADADO' : 'NORMAL'}`);
            console.log(`   Prioridades ativas: CRITICAL:${fallbackStats.priorityCounts.CRITICAL} IMPORTANT:${fallbackStats.priorityCounts.IMPORTANT}`);

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

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM - ATIVADO COM SISTEMA DE FALLBACK GRANULAR (8.0/10)');
        console.log(` Sistema de fallback granular com prioridade por indicador`);
        console.log(` Indicadores CRÍTICOS: Klines, Volume, RSI, EMA`);
        console.log(` Indicadores IMPORTANTES: Stochastic, LSR, PivotPoints, SupportResistance`);
        console.log(` Sistema de detecção de padrões de candles (15m) com fallbacks controlados`);
        console.log(` Sistema de detecção de volume robusto (3m) com fallbacks controlados`);
        console.log(` Análise multi-timeframe de pivot points com fallbacks controlados`);
        console.log(` Bot configurado e pronto para operar com resiliência máxima`);
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

        console.log('✅ Tudo pronto! Iniciando monitoramento com sistema de fallback granular...');

        await mainBotLoop();

    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 120 segundos...');
        await new Promise(r => setTimeout(r, 120000));
        await startBot();
    }
}

startBot();
