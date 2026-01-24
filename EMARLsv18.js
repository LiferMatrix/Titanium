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

// === CONFIGURAÇÕES DE VOLUME MÍNIMO REVISTAS ===
const VOLUME_MINIMUM_THRESHOLDS = {
    absoluteScore: 0.32,           // ↑ de 0.28 (evita ruído)
    combinedScore: 0.36,           // ↑ de 0.32
    classification: 'MODERADO',     // ↑ de 'MODERADO-BAIXO' (exige volume mais sólido)
    requireConfirmation: true,      // ↑ reativa confirmação (reduz falsos)
    minZScore: 0.4,                // ↑ de 0.3
    requireVolumeTrend: true        // ↑ exige tendência de volume (confirmação adicional)
};

// === CONFIGURAÇÕES OTIMIZADAS - MAIS SELETIVAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.7,            // ↑ de 1.5 (menos ruído)
    minThreshold: 1.5,             // ↑ de 1.3
    maxThreshold: 3.0,             // mantém
    volatilityMultiplier: 0.5,
    useAdaptive: true,
    adaptiveSensitivity: 0.80      // ↓ de 0.85 (ligeiramente menos sensível)
};

// === CONFIGURAÇÕES DE VOLUME ROBUSTO REVISTAS ===
const VOLUME_ROBUST_SETTINGS = {
    emaPeriod: 13,
    emaAlpha: 0.3,
    baseZScoreLookback: 40,
    minZScoreLookback: 15,
    maxZScoreLookback: 80,
    zScoreThreshold: 1.6,          // ↑ de 1.5
    vptThreshold: 0.30,            // ↑ de 0.25
    minPriceMovement: 0.12,        // ↑ de 0.10
    requirePositiveCorrelation: true, // ⚠️ CRUCIAL: só opera se alinhado com BTC
    combinedMultiplier: 1.05,
    volumeWeight: 0.35,
    emaWeight: 0.30,
    zScoreWeight: 0.25,
    vptWeight: 0.10,
    minimumThresholds: {
        combinedScore: 0.32,       // ↑ de 0.28
        emaRatio: 1.3,             // ↑ de 1.2
        zScore: 0.9,               // ↑ de 0.8
        classification: 'MODERADO' // ↑ de 'MODERADO-BAIXO'
    }
};

// === NOVAS CONFIGURAÇÕES PARA ANÁLISE DE CANDLES ===
const CANDLE_PATTERNS_SETTINGS = {
    // Configurações para detecção de padrões
    timeframe: '15m',
    requiredCandles: 20,
    
    // Configurações de relevância
    patternStrengthWeights: {
        'MUITO_FORTE': 15,
        'FORTE': 10,
        'MODERADO': 7,
        'FRACO': 3,
        'NEUTRO': 0
    },
    
    // Configurações de padrões bullish
    bullishPatterns: {
        'HAMMER': {
            minBodyRatio: 0.3,
            minLowerShadowRatio: 2.0,
            maxUpperShadowRatio: 0.1,
            strength: 'MODERADO'
        },
        'BULLISH_ENGULFING': {
            minEngulfingRatio: 1.2,
            strength: 'FORTE'
        },
        'PIERCING_LINE': {
            minPiercingDepth: 0.5,
            strength: 'MODERADO'
        },
        'MORNING_STAR': {
            requiredDoji: true,
            strength: 'MUITO_FORTE'
        },
        'HAMMER_INVERSO': {
            minBodyRatio: 0.3,
            minUpperShadowRatio: 2.0,
            maxLowerShadowRatio: 0.1,
            strength: 'MODERADO'
        },
        'DOJI_ESTRELA': {
            maxBodyRatio: 0.1,
            minTotalRange: 0.5,
            strength: 'MODERADO'
        }
    },
    
    // Configurações de padrões bearish
    bearishPatterns: {
        'SHOOTING_STAR': {
            minBodyRatio: 0.3,
            minUpperShadowRatio: 2.0,
            maxLowerShadowRatio: 0.1,
            strength: 'MODERADO'
        },
        'BEARISH_ENGULFING': {
            minEngulfingRatio: 1.2,
            strength: 'FORTE'
        },
        'DARK_CLOUD_COVER': {
            minCoverDepth: 0.5,
            strength: 'MODERADO'
        },
        'EVENING_STAR': {
            requiredDoji: true,
            strength: 'MUITO_FORTE'
        },
        'HANGING_MAN': {
            minBodyRatio: 0.3,
            minLowerShadowRatio: 2.0,
            maxUpperShadowRatio: 0.1,
            strength: 'MODERADO'
        }
    },
    
    // Configurações gerais
    generalSettings: {
        minCandleSize: 0.001,      // Tamanho mínimo do candle (1%)
        volumeConfirmation: true,   // Exige confirmação de volume
        patternConfirmation: 2,     // Número de candles para confirmação
        trendAlignment: true        // Exige alinhamento com tendência
    }
};

// === CONFIGURAÇÕES DE VOLATILIDADE ===
const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.6; // ↑ de 0.5 (exige volatilidade mínima real)

// === CONFIGURAÇÕES LSR ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;     // ↓ de 2.8 (mais conservador na compra)
const LSR_SELL_THRESHOLD = 2.8;    // ↑ de 2.9 (mais exigente na venda)

// === CONFIGURAÇÕES RSI ===
const RSI_BUY_MAX = 62;            // ↓ de 62 (evita comprar em sobrecompra)
const RSI_SELL_MIN = 32;           // ↑ de 63 (evita vender cedo demais)

// === COOLDOWN ===
const COOLDOWN_SETTINGS = {
    sameDirection: 10 * 60 * 1000,   // ↑ de 15min (evita overtrade)
    oppositeDirection: 5 * 60 * 1000, // ↑ de 5min
    useDifferentiated: true,
    symbolCooldown: 15 * 60 * 1000   // ↑ de 20min
};

// === QUALITY SCORE - MAIS EXIGENTE ===
const QUALITY_THRESHOLD = 80;       // ↑ de 70 (filtro mais rigoroso)
const QUALITY_WEIGHTS = {
    volume: 25,                    // ↑ de 42 (volume ainda mais crítico)
    oi: 1,
    volatility: 3,                 // ↑ de 7
    lsr: 5,                        // ↑ de 8
    rsi: 10,                       // ↑ de 18
    emaAlignment: 5,              // ↑ de 10
    stoch1h: 10,                   // ↑ de 10
    stoch4h: 8,                   // ↑ de 10
    breakoutRisk: 5,              // ↑ de 10
    supportResistance: 8,          // ↑ de 12
    pivotPoints: 8,               // ↑ de 15
    funding: 6,
    stochastic12h: 6,             // ↑ de 8
    stochasticDaily: 6,            // ↑ de 8
    candlePatterns: 10             // NOVO: Peso para padrões de candles
};

// === NOVA CONFIGURAÇÃO: FORÇA RELATIVA BTC ===
const BTC_STRENGTH_SETTINGS = {
    timeframe: '15m',              // Timeframe para análise
    lookbackPeriod: 20,            // Período de candles para análise
    btcSymbol: 'BTCUSDT',
    strengthWeights: {
        priceChange: 0.4,          // Peso da variação de preço
        volumeRatio: 0.3,          // Peso da relação de volume
        dominance: 0.3             // Peso da dominância BTC
    },
    threshold: {
        strongBuy: 70,             // Força > 70 = Forte para compra
        moderateBuy: 55,           // Força 55-70 = Moderado para compra
        neutral: 45,               // Força 45-55 = Neutro
        moderateSell: 30,          // Força 30-45 = Moderado para venda
        strongSell: 30             // Força < 30 = Forte para venda
    }
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
    // Configurações de força por timeframe
    timeframeStrengthWeights: {
        '15m': 1.0,
        '1h': 2.0,
        '4h': 3.0,
        '1d': 5.0
    },
    // Distâncias seguras baseadas na força do pivot
    safeDistanceMultipliers: {
        'Fraco': 0.5,
        'Moderado': 1.0,
        'Forte': 1.5,
        'Muito Forte': 2.0
    },
    // Configurações de detecção - aprimoradas
    minDistance: 7,
    priceTolerance: 0.003,
    // Configurações de análise
    analyzeTimeframes: ['15m', '1h', '4h'],
    candlesPerTimeframe: {
        '15m': 100,
        '1h': 120,
        '4h': 150
    },
    // Configurações aprimoradas de detecção
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
const CANDLE_CACHE_TTL = 60000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 2 * 60 * 1000;
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
// 🆕 FUNÇÃO PARA ANALISAR PADRÕES DE CANDLES
// =====================================================================

async function analyzeCandlePatterns(symbol, isBullish, currentPrice) {
    try {
        const settings = CANDLE_PATTERNS_SETTINGS;
        const candles = await getCandlesCached(symbol, settings.timeframe, settings.requiredCandles);
        
        if (candles.length < 5) {
            return {
                patterns: [],
                strongestPattern: null,
                combinedScore: 0,
                hasStrongPattern: false,
                confirmation: false,
                details: 'Dados insuficientes para análise de padrões'
            };
        }

        // Analisar os últimos 5 candles
        const recentCandles = candles.slice(-5);
        const detectedPatterns = [];
        
        // Analisar cada candle individualmente
        for (let i = 0; i < recentCandles.length; i++) {
            const pattern = analyzeSingleCandle(recentCandles[i], isBullish);
            if (pattern) {
                detectedPatterns.push({
                    ...pattern,
                    position: i,
                    timestamp: recentCandles[i].time
                });
            }
        }
        
        // Analisar combinações de candles
        const combinedPatterns = analyzeCandleCombinations(recentCandles, isBullish);
        detectedPatterns.push(...combinedPatterns);
        
        // Verificar confirmação de volume
        const volumeConfirmation = checkVolumeConfirmationForPatterns(candles, detectedPatterns);
        
        // Encontrar o padrão mais forte
        let strongestPattern = null;
        let maxStrengthValue = 0;
        
        for (const pattern of detectedPatterns) {
            const strengthValue = settings.patternStrengthWeights[pattern.strength] || 0;
            if (strengthValue > maxStrengthValue) {
                maxStrengthValue = strengthValue;
                strongestPattern = pattern;
            }
        }
        
        // Calcular score combinado
        let combinedScore = 0;
        if (strongestPattern) {
            combinedScore = maxStrengthValue;
            
            // Bônus por confirmação de volume
            if (volumeConfirmation.confirmed) {
                combinedScore *= 1.2;
            }
            
            // Bônus por múltiplos padrões
            if (detectedPatterns.length > 1) {
                combinedScore *= 1.1;
            }
        }
        
        // Normalizar score para 0-100
        const maxPossibleScore = Math.max(...Object.values(settings.patternStrengthWeights)) * 1.2 * 1.1;
        const normalizedScore = Math.min(100, Math.round((combinedScore / maxPossibleScore) * 100));
        
        return {
            patterns: detectedPatterns,
            strongestPattern: strongestPattern,
            combinedScore: normalizedScore,
            hasStrongPattern: combinedScore >= 50,
            confirmation: volumeConfirmation.confirmed,
            volumeAnalysis: volumeConfirmation,
            details: `Detectados ${detectedPatterns.length} padrões${strongestPattern ? `, mais forte: ${strongestPattern.name} (${strongestPattern.strength})` : ''}`,
            recentCandles: recentCandles.map(c => ({
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
                isBullish: c.close > c.open
            }))
        };
        
    } catch (error) {
        console.log(`⚠️ Erro análise padrões candles ${symbol}: ${error.message}`);
        return {
            patterns: [],
            strongestPattern: null,
            combinedScore: 0,
            hasStrongPattern: false,
            confirmation: false,
            details: `Erro na análise: ${error.message}`
        };
    }
}

function analyzeSingleCandle(candle, isBullish) {
    const { open, high, low, close, volume } = candle;
    const bodySize = Math.abs(close - open);
    const totalRange = high - low;
    
    // Evitar candles muito pequenos
    if (totalRange === 0 || bodySize / totalRange < CANDLE_PATTERNS_SETTINGS.generalSettings.minCandleSize) {
        return null;
    }
    
    const isBullishCandle = close > open;
    const upperShadow = high - Math.max(open, close);
    const lowerShadow = Math.min(open, close) - low;
    const bodyRatio = bodySize / totalRange;
    
    // Verificar padrões bullish
    if (isBullish) {
        // Hammer
        if (lowerShadow >= bodySize * 2 && upperShadow <= bodySize * 0.1 && isBullishCandle) {
            return {
                name: 'HAMMER',
                type: 'BULLISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.7,
                description: 'Padrão de reversão bullish - sinal de compra',
                candleData: { bodyRatio, lowerShadowRatio: lowerShadow/bodySize }
            };
        }
        
        // Inverted Hammer
        if (upperShadow >= bodySize * 2 && lowerShadow <= bodySize * 0.1 && isBullishCandle) {
            return {
                name: 'HAMMER_INVERSO',
                type: 'BULLISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.6,
                description: 'Padrão de reversão bullish - possível continuação',
                candleData: { bodyRatio, upperShadowRatio: upperShadow/bodySize }
            };
        }
        
        // Doji Star
        if (bodyRatio <= 0.1 && totalRange > 0) {
            return {
                name: 'DOJI_ESTRELA',
                type: 'INDECISION',
                strength: 'MODERADO',
                confidence: 0.5,
                description: 'Sinal de indecisão, possível reversão',
                candleData: { bodyRatio, totalRange }
            };
        }
    } else {
        // Shooting Star
        if (upperShadow >= bodySize * 2 && lowerShadow <= bodySize * 0.1 && !isBullishCandle) {
            return {
                name: 'SHOOTING_STAR',
                type: 'BEARISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.7,
                description: 'Padrão de reversão bearish - sinal de venda',
                candleData: { bodyRatio, upperShadowRatio: upperShadow/bodySize }
            };
        }
        
        // Hanging Man
        if (lowerShadow >= bodySize * 2 && upperShadow <= bodySize * 0.1 && !isBullishCandle) {
            return {
                name: 'HANGING_MAN',
                type: 'BEARISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.6,
                description: 'Padrão de reversão bearish - possível topo',
                candleData: { bodyRatio, lowerShadowRatio: lowerShadow/bodySize }
            };
        }
    }
    
    return null;
}

function analyzeCandleCombinations(candles, isBullish) {
    const patterns = [];
    
    if (candles.length < 3) return patterns;
    
    const lastThree = candles.slice(-3);
    const [first, second, third] = lastThree;
    
    // Morning Star (bullish)
    if (isBullish) {
        const isFirstBearish = first.close < first.open;
        const isThirdBullish = third.close > third.open;
        const isSecondDoji = Math.abs(second.close - second.open) / (second.high - second.low) < 0.1;
        
        if (isFirstBearish && isSecondDoji && isThirdBullish && 
            third.close > (first.open + first.close) / 2) {
            patterns.push({
                name: 'MORNING_STAR',
                type: 'BULLISH_REVERSAL',
                strength: 'MUITO_FORTE',
                confidence: 0.8,
                description: 'Padrão de reversão bullish forte - compra',
                candlesInvolved: 3,
                gapDown: second.low < first.low,
                gapUp: third.low > second.high
            });
        }
        
        // Bullish Engulfing
        if (first.close < first.open && // Primeiro candle bearish
            second.close > second.open && // Segundo candle bullish
            second.open < first.close && // Abre abaixo do fechamento anterior
            second.close > first.open) { // Fecha acima da abertura anterior
            patterns.push({
                name: 'BULLISH_ENGULFING',
                type: 'BULLISH_REVERSAL',
                strength: 'FORTE',
                confidence: 0.75,
                description: 'Padrão engulfing bullish - forte sinal de compra',
                candlesInvolved: 2,
                engulfingRatio: Math.abs(second.close - second.open) / Math.abs(first.close - first.open)
            });
        }
        
        // Piercing Line
        if (first.close < first.open && // Primeiro candle bearish
            second.close > second.open && // Segundo candle bullish
            second.open < first.low && // Abre abaixo do mínimo anterior
            second.close > (first.open + first.close) / 2) { // Fecha acima do meio do corpo anterior
            patterns.push({
                name: 'PIERCING_LINE',
                type: 'BULLISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.65,
                description: 'Padrão piercing line - sinal de compra moderado',
                candlesInvolved: 2,
                piercingDepth: (second.close - first.close) / (first.open - first.close)
            });
        }
    } else {
        // Evening Star (bearish)
        const isFirstBullish = first.close > first.open;
        const isThirdBearish = third.close < third.open;
        const isSecondDoji = Math.abs(second.close - second.open) / (second.high - second.low) < 0.1;
        
        if (isFirstBullish && isSecondDoji && isThirdBearish && 
            third.close < (first.open + first.close) / 2) {
            patterns.push({
                name: 'EVENING_STAR',
                type: 'BEARISH_REVERSAL',
                strength: 'MUITO_FORTE',
                confidence: 0.8,
                description: 'Padrão de reversão bearish forte - venda',
                candlesInvolved: 3,
                gapUp: second.high > first.high,
                gapDown: third.high < second.low
            });
        }
        
        // Bearish Engulfing
        if (first.close > first.open && // Primeiro candle bullish
            second.close < second.open && // Segundo candle bearish
            second.open > first.close && // Abre acima do fechamento anterior
            second.close < first.open) { // Fecha abaixo da abertura anterior
            patterns.push({
                name: 'BEARISH_ENGULFING',
                type: 'BEARISH_REVERSAL',
                strength: 'FORTE',
                confidence: 0.75,
                description: 'Padrão engulfing bearish - forte sinal de venda',
                candlesInvolved: 2,
                engulfingRatio: Math.abs(second.close - second.open) / Math.abs(first.close - first.open)
            });
        }
        
        // Dark Cloud Cover
        if (first.close > first.open && // Primeiro candle bullish
            second.close < second.open && // Segundo candle bearish
            second.open > first.high && // Abre acima do máximo anterior
            second.close < (first.open + first.close) / 2) { // Fecha abaixo do meio do corpo anterior
            patterns.push({
                name: 'DARK_CLOUD_COVER',
                type: 'BEARISH_REVERSAL',
                strength: 'MODERADO',
                confidence: 0.65,
                description: 'Padrão dark cloud cover - sinal de venda moderado',
                candlesInvolved: 2,
                coverDepth: (first.close - second.close) / (first.close - first.open)
            });
        }
    }
    
    return patterns;
}

function checkVolumeConfirmationForPatterns(candles, patterns) {
    if (patterns.length === 0 || !CANDLE_PATTERNS_SETTINGS.generalSettings.volumeConfirmation) {
        return { confirmed: true, volumeRatio: 1, message: 'Confirmação não requerida' };
    }
    
    // Calcular volume médio das últimas 20 candles
    const volumeHistory = candles.slice(-20).map(c => c.volume);
    const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
    
    // Volume do candle mais recente
    const recentVolume = candles[candles.length - 1].volume;
    const volumeRatio = recentVolume / avgVolume;
    
    // Para padrões fortes, exigir mais volume
    const strongestPattern = patterns.reduce((prev, current) => {
        const prevStrength = CANDLE_PATTERNS_SETTINGS.patternStrengthWeights[prev.strength] || 0;
        const currStrength = CANDLE_PATTERNS_SETTINGS.patternStrengthWeights[current.strength] || 0;
        return currStrength > prevStrength ? current : prev;
    }, patterns[0]);
    
    let requiredVolumeRatio = 1.0;
    if (strongestPattern) {
        switch(strongestPattern.strength) {
            case 'MUITO_FORTE':
                requiredVolumeRatio = 1.5;
                break;
            case 'FORTE':
                requiredVolumeRatio = 1.3;
                break;
            case 'MODERADO':
                requiredVolumeRatio = 1.1;
                break;
            default:
                requiredVolumeRatio = 1.0;
        }
    }
    
    const confirmed = volumeRatio >= requiredVolumeRatio;
    
    return {
        confirmed,
        volumeRatio,
        requiredVolumeRatio,
        avgVolume,
        recentVolume,
        message: confirmed ? 
            `Volume confirmado: ${volumeRatio.toFixed(2)}x (requerido: ${requiredVolumeRatio.toFixed(1)}x)` :
            `Volume insuficiente: ${volumeRatio.toFixed(2)}x (requerido: ${requiredVolumeRatio.toFixed(1)}x)`
    };
}

// =====================================================================
// 🛡️ SISTEMA DE RISK LAYER AVANÇADO COM ANÁLISE DE CANDLES
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
            RSI_EXTREME_RISK: { weight: 1.5 },
            STOCHASTIC_TREND_RISK: { weight: 1.1 },
            CANDLE_PATTERN_RISK: { weight: 1.3 } // NOVO: Risco baseado em padrões de candles
        };

        this.riskHistory = new Map();
        this.maxHistorySize = 100;

        console.log('🛡️  Risk Layer Sofisticado inicializado com análise de padrões de candles');
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

            // NOVO: Analisar risco baseado em padrões de candles
            const candlePatternRisk = await this.analyzeCandlePatternRisk(signal);
            riskAssessment.factors.push(candlePatternRisk);
            riskAssessment.overallScore += candlePatternRisk.score * this.riskFactors.CANDLE_PATTERN_RISK.weight;

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

    // NOVA FUNÇÃO: Analisar risco baseado em padrões de candles
    async analyzeCandlePatternRisk(signal) {
        try {
            const candlePatterns = signal.marketData.candlePatterns;
            
            if (!candlePatterns || !candlePatterns.strongestPattern) {
                return { 
                    type: 'CANDLE_PATTERN', 
                    score: 0, 
                    message: 'Sem padrões de candles significativos detectados' 
                };
            }

            const strongestPattern = candlePatterns.strongestPattern;
            let score = 0;
            let message = '';
            let riskType = 'NEUTRO';

            // Analisar baseado no tipo de padrão e força
            if (strongestPattern.type.includes('REVERSAL')) {
                // Padrões de reversão são arriscados se estiverem contra o sinal
                if ((signal.isBullish && strongestPattern.type.includes('BEARISH')) ||
                    (!signal.isBullish && strongestPattern.type.includes('BULLISH'))) {
                    
                    score = 2.5; // Alto risco - padrão contrário
                    riskType = 'ALTO';
                    message = `🚨 PADRÃO DE REVERSÃO CONTRÁRIO: ${strongestPattern.name} (${strongestPattern.strength}) detectado`;
                    
                    if (strongestPattern.strength === 'MUITO_FORTE') {
                        score = 3.0;
                        message = `🚨🚨 PADRÃO DE REVERSÃO MUITO FORTE CONTRÁRIO: ${strongestPattern.name}`;
                    }
                } else {
                    // Padrão alinhado com o sinal - reduz risco
                    score = -1.0;
                    riskType = 'BAIXO';
                    message = `✅ PADRÃO DE REVERSÃO ALINHADO: ${strongestPattern.name} (${strongestPattern.strength}) confirma sinal`;
                }
            } else if (strongestPattern.type === 'INDECISION') {
                // Padrões de indecisão aumentam risco
                score = 1.5;
                riskType = 'MEDIANO';
                message = `⚠️ PADRÃO DE INDECISÃO: ${strongestPattern.name} - aumento de risco`;
            }

            // Considerar confirmação de volume
            if (candlePatterns.confirmation) {
                score *= 0.8; // Reduz risco se houver confirmação de volume
                message += ' | Volume confirmado ✅';
            } else {
                score *= 1.3; // Aumenta risco sem confirmação de volume
                message += ' | Volume NÃO confirmado ⚠️';
            }

            // Considerar múltiplos padrões
            if (candlePatterns.patterns.length > 1) {
                const conflictingPatterns = candlePatterns.patterns.filter(p => 
                    (signal.isBullish && p.type.includes('BEARISH')) ||
                    (!signal.isBullish && p.type.includes('BULLISH'))
                );
                
                if (conflictingPatterns.length > 0) {
                    score += 1.0;
                    message += ` | ${conflictingPatterns.length} padrões conflitantes detectados`;
                }
            }

            return {
                type: 'CANDLE_PATTERN',
                score: Math.min(3, Math.max(-1, score)),
                message: message,
                data: {
                    strongestPattern: strongestPattern,
                    patternCount: candlePatterns.patterns.length,
                    combinedScore: candlePatterns.combinedScore,
                    confirmation: candlePatterns.confirmation,
                    riskType: riskType
                }
            };

        } catch (error) {
            return { 
                type: 'CANDLE_PATTERN', 
                score: 0, 
                message: 'Erro na análise de padrões de candles' 
            };
        }
    }

    async analyzeStochasticTrendRisk(signal) {
        try {
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

            if (stochDailyData.isValid) {
                if (signal.isBullish && stochDailyData.kValue > stochDailyData.dValue) {
                    score -= 0.5;
                    trendDirection = 'ALTA (Diário)';
                } else if (!signal.isBullish && stochDailyData.kValue < stochDailyData.dValue) {
                    score -= 0.5;
                    trendDirection = 'BAIXA (Diário)';
                } else {
                    score += 1;
                    trendDirection = 'CONTRÁRIA (Diário)';
                }
            }

            if (stoch12hData.isValid) {
                if (signal.isBullish && stoch12hData.kValue > stoch12hData.dValue) {
                    score -= 0.3;
                    trendDirection += trendDirection ? ' + ALTA (12h)' : 'ALTA (12h)';
                } else if (!signal.isBullish && stoch12hData.kValue < stoch12hData.dValue) {
                    score -= 0.3;
                    trendDirection += trendDirection ? ' + BAIXA (12h)' : 'BAIXA (12h)';
                } else {
                    score += 0.5;
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
        
        // Calcular risco baseado na força do pivot e distância
        const safeDistance = PIVOT_POINTS_SETTINGS.safeDistanceMultipliers[pivotStrength] || 1.0;
        const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[pivotTimeframe] || 1.0;
        
        // Ajustar distância segura pelo peso do timeframe
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
        
        // Penalidade adicional para pivots fortes muito próximos
        if (pivotStrength === 'Forte' || pivotStrength === 'Muito Forte') {
            if (distancePercent < adjustedSafeDistance) {
                score += 1;
                message += ` | PIVOT ${pivotStrength.toUpperCase()} PRÓXIMO`;
            }
        }
        
        // Informação sobre timeframe
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

    generateRecommendations(riskAssessment) {
        const recommendations = [];

        // Recomendações baseadas em padrões de candles
        riskAssessment.factors.forEach(factor => {
            if (factor.type === 'CANDLE_PATTERN' && factor.score >= 2) {
                recommendations.push('⚠️ <i>PADRÃO DE CANDLE CONTRÁRIO DETECTADO</i>');
                recommendations.push('• Aguarde confirmação adicional');
                recommendations.push('• Reduza tamanho da posição em 50%');
                recommendations.push('• Use stop loss mais apertado');
            }
        });

        riskAssessment.factors.forEach(factor => {
            if (factor.type === 'STOCHASTIC_TREND' && factor.data.trendDirection.includes('CONTRÁRIA')) {
                recommendations.push('⚠️ <i>TENDÊNCIA CONTRÁRIA em timeframes maiores</i>');
                recommendations.push('• Reduza o tamanho da posição');
                recommendations.push('• Use stop loss mais apertado');
            }
        });

        switch (riskAssessment.level) {
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

        riskAssessment.factors.forEach(factor => {
            if (factor.score >= 2) {
                switch (factor.type) {
                    case 'CANDLE_PATTERN':
                        recommendations.push(`• <b>Padrão de candle contrário:</b> Aguarde confirmação`);
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

    generateWarnings(riskAssessment) {
        const warnings = [];
        
        // Warnings baseados em padrões de candles
        riskAssessment.factors.forEach(factor => {
            if (factor.type === 'CANDLE_PATTERN' && factor.score >= 2) {
                warnings.push(`🚨 ${factor.message}`);
            }
        });
        
        riskAssessment.factors.forEach(factor => {
            if (factor.type === 'STOCHASTIC_TREND' && factor.data.trendDirection.includes('CONTRÁRIA')) {
                warnings.push(`⚠️ Tendência contrária em timeframes maiores: ${factor.data.trendDirection}`);
            }
        });

        riskAssessment.factors.forEach(factor => {
            if (factor.score >= 2.5 && factor.type !== 'STOCHASTIC_TREND' && factor.type !== 'CANDLE_PATTERN') {
                warnings.push(`⚠️ ${factor.message}`);
            } else if (factor.score >= 2 && factor.type !== 'STOCHASTIC_TREND' && factor.type !== 'CANDLE_PATTERN') {
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

        // Log específico para padrões de candles
        assessment.factors.forEach(factor => {
            if (factor.type === 'CANDLE_PATTERN' && factor.data.strongestPattern) {
                console.log(`   Padrão Candle: ${factor.data.strongestPattern.name} (${factor.data.strongestPattern.strength}) - Score: ${factor.score}`);
            }
        });

        assessment.factors.forEach(factor => {
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
        combinedScore >= VOLUME_ROBUST_SETTINGS.minimumThresholds.combinedScore &&
        emaRatio >= VOLUME_ROBUST_SETTINGS.minimumThresholds.emaRatio &&
        Math.abs(zScore) >= VOLUME_ROBUST_SETTINGS.minimumThresholds.zScore &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

// =====================================================================
// 🔢 FUNÇÃO PARA CALCULAR PONTOS DE FIBONACCI
// =====================================================================

async function calculateFibonacciLevels(symbol, currentPrice, pivotType, pivotPrice) {
    try {
        // Buscar candles para determinar swing high/low
        const candles = await getCandlesCached(symbol, '1h', 100);
        if (candles.length < 50) return null;
        
        // Encontrar swing high e swing low recentes
        let swingHigh = currentPrice;
        let swingLow = currentPrice;
        let swingHighIndex = candles.length - 1;
        let swingLowIndex = candles.length - 1;
        
        // Procurar últimos 50 candles
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
        
        // Determinar qual é mais recente
        const isUptrend = swingHighIndex > swingLowIndex;
        
        let fibLevels = {};
        
        if (isUptrend) {
            // Uptrend - Fibonacci retracement de swing low para swing high
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
            // Downtrend - Fibonacci retracement de swing high para swing low
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
        
        // Encontrar nível de Fibonacci mais próximo do pivô
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
        const candles = await getCandlesCached(symbol, '1h', 28); // 14 períodos + 14 para cálculo
        if (candles.length < 28) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Calcular ADX manualmente
        const period = 14;
        
        // Calcular True Range
        let trValues = [];
        for (let i = 1; i < candles.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i-1]),
                Math.abs(lows[i] - closes[i-1])
            );
            trValues.push(tr);
        }
        
        // Calcular Directional Movement
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
        
        // Calcular suavizações (Wilder's smoothing)
        let atr = [];
        let plusDI = [];
        let minusDI = [];
        let dx = [];
        let adx = [];
        
        // Valores iniciais (SMA dos primeiros 14 períodos)
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
        adx.push(dxValue); // Primeiro ADX é igual ao DX
        
        // Calcular valores restantes com suavização de Wilder
        for (let i = period; i < trValues.length; i++) {
            // ATR suavizado
            const atrPrev = atr[atr.length - 1];
            const atrCurrent = (atrPrev * (period - 1) + trValues[i]) / period;
            atr.push(atrCurrent);
            
            // +DI suavizado
            const plusDIPrev = plusDI[plusDI.length - 1];
            const plusDICurrent = ((plusDIPrev * (period - 1)) + (plusDM[i] / atrCurrent * 100)) / period;
            plusDI.push(plusDICurrent);
            
            // -DI suavizado
            const minusDIPrev = minusDI[minusDI.length - 1];
            const minusDICurrent = ((minusDIPrev * (period - 1)) + (minusDM[i] / atrCurrent * 100)) / period;
            minusDI.push(minusDICurrent);
            
            // DX
            const dxCurrent = Math.abs(plusDICurrent - minusDICurrent) / (plusDICurrent + minusDICurrent) * 100;
            dx.push(dxCurrent);
            
            // ADX (suavização do DX)
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
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS (COM FORÇA RELATIVA BTC E PADRÕES DE CANDLES)
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
        
        // 🔹 NOVO: Informações de padrões de candles
        const candlePatterns = signal.marketData.candlePatterns;
        let candlePatternsInfo = '';
        if (candlePatterns && candlePatterns.strongestPattern) {
            const pattern = candlePatterns.strongestPattern;
            let patternEmoji = '📊';
            if (pattern.strength === 'MUITO_FORTE') patternEmoji = '🚀';
            else if (pattern.strength === 'FORTE') patternEmoji = '📈';
            else if (pattern.strength === 'MODERADO') patternEmoji = '📉';
            
            candlePatternsInfo = `\n${patternEmoji} <i>Padrão Candle:</i> ${pattern.name} (${pattern.strength})`;
            if (candlePatterns.confirmation) {
                candlePatternsInfo += ` | Volume confirmado ✅`;
            }
        }
        
        // 🔹 Calcular força relativa BTC
        const btcStrength = await calculateBTCRelativeStrength(signal.symbol, signal.isBullish);
        
        // 🔹 Calcular Fibonacci relacionado ao pivô
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
        
        // 🔹 Obter ADX 1h
        const adxData = await getADX1h(signal.symbol);
        let adxInfo = '';
        if (adxData) {
            const adxEmoji = adxData.isAbove20 ? '💹 ' : '';
             adxInfo = `\n${adxEmoji}ADX 1h: ${adxData.adx.toFixed(1)} ${adxData.isAbove20 ? '(💹Forte Tendência)' : '(⚪Tendência Fraca)'}`;
        } else {
            adxInfo = `\nADX 1h: N/A | Não disponível`;
        }

        const stoch12hData = signal.marketData.stochastic12h;
        const stochDailyData = signal.marketData.stochasticDaily;
        
        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        // 🔹 AJUSTE CRÍTICO: Verificação robusta dos dados do estocástico
        if (stoch12hData && stoch12hData.isValid && stoch12hData.kValue !== null && stoch12hData.dValue !== null) {
            const kValue = stoch12hData.kValue.toFixed(1);
            const dValue = stoch12hData.dValue.toFixed(1);
            
            if (stoch12hData.lastCross) {
                const time = stoch12hData.lastCross.time || '';
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${stoch12hData.lastCross.direction} às ${time}`;
            } else {
                // Determinar tendência baseada em K e D
                const trend = stoch12hData.kValue > stoch12hData.dValue ? 'ALTA' : 'BAIXA';
                stoch12hInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stoch12hData && stoch12hData.raw && stoch12hData.raw.current) {
            // Fallback para dados raw
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
                // Determinar tendência baseada em K e D
                const trend = stochDailyData.kValue > stochDailyData.dValue ? 'ALTA' : 'BAIXA';
                stochDailyInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stochDailyData && stochDailyData.raw && stochDailyData.raw.current) {
            // Fallback para dados raw
            const kValue = stochDailyData.raw.current.k?.toFixed(1) || 'N/A';
            const dValue = stochDailyData.raw.current.d?.toFixed(1) || 'N/A';
            stochDailyInfo = `K:${kValue} D:${dValue}`;
        } else {
            stochDailyInfo = 'Dados insuficientes';
        }

        const riskEmoji = riskAssessment.level === 'CRÍTICO' ? '🚨' :
            riskAssessment.level === 'ALTO' ? '🔴' :
                riskAssessment.level === 'MEDIANO' ? '🟡' : '🟢';

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

        let analysisType = '';
        let analysisEmoji = '🤖';

        // 🔹 NOVO: Incluir análise de padrões de candles na análise
        let candlePatternAnalysis = '';
        if (candlePatterns && candlePatterns.strongestPattern) {
            const pattern = candlePatterns.strongestPattern;
            if (pattern.type.includes('REVERSAL')) {
                if ((signal.isBullish && pattern.type.includes('BULLISH')) ||
                    (!signal.isBullish && pattern.type.includes('BEARISH'))) {
                    candlePatternAnalysis = ` | 📊 Padrão ${pattern.name} confirma sinal`;
                } else {
                    candlePatternAnalysis = ` | ⚠️ Padrão ${pattern.name} contrário ao sinal`;
                }
            }
        }

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
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot Bear ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando...REVERSÃO (Pivot Bull ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue <= RSI_BUY_MAX && stochValid && emaAlignment) {
                    if (isNearPivot && pivotType === 'Suporte') {
                        analysisType = `Analisando...COMPRA (Pivot Bull ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🟢🔍';
                    } else {
                        analysisType = `Analisando...COMPRA${candlePatternAnalysis}`;
                        analysisEmoji = '🟢🔍';
                    }
                } else if (rsiValue > RSI_BUY_MAX && rsiValue <= 75) {
                    analysisType = `Analisando...CORREÇÃO${candlePatternAnalysis}`;
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = `Análise...NEUTRA${candlePatternAnalysis}`;
                    analysisEmoji = '🤖';
                }
            } else {
                if (isNearPivot && pivotType === 'Suporte') {
                    if (parseFloat(pivotDistance) < 0.3) {
                        analysisType = `Analisando...FALSO ROMPIMENTO (Pivot Bear ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🟡⚠️';
                    } else {
                        analysisType = `Analisando...EXAUSTÃO (Pivot Bear ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= RSI_SELL_MIN && rsiValue <= 75 && !stochValid && !emaAlignment) {
                    if (isNearPivot && pivotType === 'Resistência') {
                        analysisType = `Analisando...VENDA (Pivot Bear ${pivotStrengthText})${candlePatternAnalysis}`;
                        analysisEmoji = '🔴🔍';
                    } else {
                        analysisType = `Analisando...VENDA${candlePatternAnalysis}`;
                        analysisEmoji = '🔴🔍';
                    }
                } else if (rsiValue >= 25 && rsiValue < RSI_SELL_MIN) {
                    analysisType = `Analisando...CORREÇÃO${candlePatternAnalysis}`;
                    analysisEmoji = '🟡⚠️';
                } else {
                    analysisType = `Análise...NEUTRA${candlePatternAnalysis}`;
                    analysisEmoji = '🤖';
                }
            }
        }

        let alertTitle = '';
        let alertType = '';
        
        if (isVolumeConfirmed) {
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
            alertTitle = `${analysisEmoji} <i>IA... ${analysisType}: ${signal.symbol}</i>`;
            alertType = 'analysis';
        }

        let message = `
${alertTitle}
${now.full} <a href="${tradingViewLink}">Gráfico</a>
<i> Indicadores Técnicos</i>
⚠️ SCORE: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
💲 Preço: $${signal.price.toFixed(6)}
⚠️ VOL: ${volumeRatio.toFixed(2)}x (Score: ${volumeScore.toFixed(2)} - ${volumeClassification}) - Z-Score: ${volumeData?.zScore?.toFixed(2) || 'N/A'}
${candlePatternsInfo}
${fibInfo}
${adxInfo}
⚠️ LSR: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}|🔹RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
<i>🔹Força Relativa vs BTC</i>
• ${btcStrength.emoji} ${btcStrength.status}
<i>🔹Estocástico </i>
• 12h: ${stoch12hInfo}
• 1D: ${stochDailyInfo}

<i>🤖 IA Operação/Risco </i>
• Risco: ${riskAssessment.overallScore.toFixed(2)} | Nível: ${riskEmoji} ${riskAssessment.level} 
⚠️ Confiança da IA: ${riskAssessment.confidence}%
${!isVolumeConfirmed ? `• 🔶 Volume Baixo: Score ${volumeScore.toFixed(2)} - Aguarde confirmação` : ''}
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
        console.log(`   Força BTC: ${btcStrength.status} (Compra: ${btcStrength.buyStrength}%, Venda: ${btcStrength.sellStrength}%)`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        console.log(`   Stochastic 12h: ${stoch12hInfo}`);
        console.log(`   Stochastic Diário: ${stochDailyInfo}`);
        if (candlePatterns && candlePatterns.strongestPattern) {
            console.log(`   Padrão Candle: ${candlePatterns.strongestPattern.name} (${candlePatterns.strongestPattern.strength})`);
        }

        return {
            type: alertType,
            volumeConfirmed: isVolumeConfirmed,
            volumeScore: volumeScore,
            analysisType: analysisType,
            btcStrength: btcStrength,
            candlePatterns: candlePatterns
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
        
        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        
        // 🔹 NOVO: Informações de padrões de candles
        const candlePatterns = signal.marketData.candlePatterns;
        let candlePatternsInfo = '';
        if (candlePatterns && candlePatterns.strongestPattern) {
            const pattern = candlePatterns.strongestPattern;
            candlePatternsInfo = `\n📊 <i>Padrão Candle:</i> ${pattern.name} (${pattern.strength}) - ${pattern.description}`;
        }
        
        // 🔹 Calcular força relativa BTC
        const btcStrength = await calculateBTCRelativeStrength(signal.symbol, signal.isBullish);
        
        // 🔹 Calcular Fibonacci relacionado ao pivô
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
        
        // 🔹 Obter ADX 1h
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
        
        // 🔹 AJUSTE CRÍTICO: Verificação robusta dos dados do estocástico
        if (stoch12hData && stoch12hData.isValid && stoch12hData.kValue !== null && stoch12hData.dValue !== null) {
            const kValue = stoch12hData.kValue.toFixed(1);
            const dValue = stoch12hData.dValue.toFixed(1);
            
            if (stoch12hData.lastCross) {
                const time = stoch12hData.lastCross.time || '';
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${stoch12hData.lastCross.direction} às ${time}`;
            } else {
                // Determinar tendência baseada em K e D
                const trend = stoch12hData.kValue > stoch12hData.dValue ? 'ALTA' : 'BAIXA';
                stoch12hInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stoch12hData && stoch12hData.raw && stoch12hData.raw.current) {
            // Fallback para dados raw
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
                // Determinar tendência baseada em K e D
                const trend = stochDailyData.kValue > stochDailyData.dValue ? 'ALTA' : 'BAIXA';
                stochDailyInfo = `K:${kValue} D:${dValue} | Tendência: ${trend}`;
            }
        } else if (stochDailyData && stochDailyData.raw && stochDailyData.raw.current) {
            // Fallback para dados raw
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
${candlePatternsInfo}
${fibInfo}
${adxInfo}

<b>📈 FORÇA RELATIVA VS BTC</b>
• ${btcStrength.emoji} ${btcStrength.status}
• Força para COMPRA: ${btcStrength.buyStrength}%
• Força para VENDA: ${btcStrength.sellStrength}%
${btcStrength.message ? `• ${btcStrength.message}` : ''}

<b>📊 Stochastic Tendência (5.3.3)</b>
• 12h: ${stoch12hInfo}
• Diário: ${stochDailyInfo}
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
        } else {
           
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
        console.log(`   Força BTC: ${btcStrength.status} (Compra: ${btcStrength.buyStrength}%, Venda: ${btcStrength.sellStrength}%)`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol} ${lsrPercentChange !== '0.00' ? `(${lsrPercentChange}%)` : ''}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        console.log(`   Stochastic 12h: ${stoch12hInfo}`);
        console.log(`   Stochastic Diário: ${stochDailyInfo}`);
        if (candlePatterns && candlePatterns.strongestPattern) {
            console.log(`   Padrão Candle: ${candlePatterns.strongestPattern.name} (${candlePatterns.strongestPattern.strength})`);
        }

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

    // 🔹 NOVO: Considerar padrões de candles na probabilidade
    const candlePatterns = signal.marketData.candlePatterns;
    if (candlePatterns && candlePatterns.strongestPattern) {
        const pattern = candlePatterns.strongestPattern;
        
        if ((signal.isBullish && pattern.type.includes('BULLISH_REVERSAL')) ||
            (!signal.isBullish && pattern.type.includes('BEARISH_REVERSAL'))) {
            
            // Padrão alinhado com o sinal aumenta probabilidade
            switch(pattern.strength) {
                case 'MUITO_FORTE':
                    baseProbability += 15;
                    break;
                case 'FORTE':
                    baseProbability += 10;
                    break;
                case 'MODERADO':
                    baseProbability += 7;
                    break;
                case 'FRACO':
                    baseProbability += 3;
                    break;
            }
            
            // Confirmação de volume adicional
            if (candlePatterns.confirmation) {
                baseProbability += 5;
            }
        } else if ((signal.isBullish && pattern.type.includes('BEARISH_REVERSAL')) ||
                   (!signal.isBullish && pattern.type.includes('BULLISH_REVERSAL'))) {
            
            // Padrão contrário ao sinal reduz probabilidade
            switch(pattern.strength) {
                case 'MUITO_FORTE':
                    baseProbability -= 20;
                    break;
                case 'FORTE':
                    baseProbability -= 15;
                    break;
                case 'MODERADO':
                    baseProbability -= 10;
                    break;
                case 'FRACO':
                    baseProbability -= 5;
                    break;
            }
        }
        
        // Padrões de indecisão reduzem probabilidade
        if (pattern.type === 'INDECISION') {
            baseProbability -= 8;
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
// 📊 FUNÇÕES PARA STOCHASTIC 12H E DIÁRIO - ATUALIZADA
// =====================================================================

async function checkStochasticWithTimeframe(symbol, isBullish, settings) {
    try {
        const candles = await getCandlesCached(symbol, settings.timeframe, settings.requiredCandles);
        if (candles.length < settings.period + 5) {
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
        
        // Verificar se é máximo local
        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && highs[j] > highs[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            // Verificar se tem lower highs suficientes antes do pivot
            let lowerHighsCount = 0;
            for (let j = i - window; j < i; j++) {
                if (highs[j] < highs[i]) {
                    lowerHighsCount++;
                }
            }
            
            hasRequiredLowerHighs = lowerHighsCount >= detectionSettings.requiredLowerHighs;
            
            // Verificar amplitude mínima
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
        
        // Verificar se é mínimo local
        for (let j = i - window; j <= i + window; j++) {
            if (j !== i && lows[j] < lows[i]) {
                isPivot = false;
                break;
            }
        }
        
        if (isPivot) {
            // Verificar se tem higher lows suficientes antes do pivot
            let higherLowsCount = 0;
            for (let j = i - window; j < i; j++) {
                if (lows[j] > lows[i]) {
                    higherLowsCount++;
                }
            }
            
            hasRequiredHigherLows = higherLowsCount >= detectionSettings.requiredHigherLows;
            
            // Verificar amplitude mínima
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
                
                // Verificar toques recentes
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
    
    // Baseado no número de toques
    if (pivot.touches >= 5) {
        baseStrength = 'Muito Forte';
    } else if (pivot.touches >= 4) {
        baseStrength = 'Forte';
    } else if (pivot.touches >= 3) {
        baseStrength = 'Moderado';
    } else if (pivot.touches >= 2) {
        baseStrength = 'Fraco';
    }
    
    // Ajustar baseado no timeframe
    const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
    
    if (timeframeWeight >= 3.0 && baseStrength !== 'Fraco') {
        if (baseStrength === 'Moderado') return 'Forte';
        if (baseStrength === 'Forte') return 'Muito Forte';
    }
    
    // Considerar amplitude para pivots fracos
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
🚀 <b>TITANIUM ATIVADO COM ANÁLISE DE PADRÕES DE CANDLES!</b>

${brazilTime.full}
📊 Sistema aprimorado com:
• Análise de Padrões de Candles (15m)
• Detecção Robusta de Volume (3m)
• Stochastic Tendência 12h/Diário
• Sistema de Risco Avançado
• Força Relativa vs BTC & Dominância
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
            console.log('🚀 TITANIUM ATIVADO COM ANÁLISE DE PADRÕES DE CANDLES!');
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
// 📊 FUNÇÃO ATUALIZADA PARA CALCULAR QUALIDADE (COM PADRÕES DE CANDLES)
// =====================================================================

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

    // 🔹 NOVO: Pontuação para padrões de candles
    if (marketData.candlePatterns) {
        const candlePatterns = marketData.candlePatterns;
        let candlePatternsScore = 0;
        let candlePatternsDetail = '';

        if (candlePatterns.strongestPattern) {
            const pattern = candlePatterns.strongestPattern;
            
            // Verificar se o padrão está alinhado com o sinal
            const isPatternAligned = 
                (isBullish && pattern.type.includes('BULLISH')) ||
                (!isBullish && pattern.type.includes('BEARISH'));
            
            if (isPatternAligned) {
                // Score baseado na força do padrão
                switch(pattern.strength) {
                    case 'MUITO_FORTE':
                        candlePatternsScore = QUALITY_WEIGHTS.candlePatterns;
                        candlePatternsDetail = `${candlePatternsScore}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} MUITO FORTE alinhado com sinal)`;
                        break;
                    case 'FORTE':
                        candlePatternsScore = QUALITY_WEIGHTS.candlePatterns * 0.8;
                        candlePatternsDetail = `${candlePatternsScore.toFixed(1)}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} FORTE alinhado)`;
                        break;
                    case 'MODERADO':
                        candlePatternsScore = QUALITY_WEIGHTS.candlePatterns * 0.6;
                        candlePatternsDetail = `${candlePatternsScore.toFixed(1)}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} MODERADO alinhado)`;
                        break;
                    case 'FRACO':
                        candlePatternsScore = QUALITY_WEIGHTS.candlePatterns * 0.3;
                        candlePatternsDetail = `${candlePatternsScore.toFixed(1)}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} FRACO alinhado)`;
                        break;
                    default:
                        candlePatternsScore = QUALITY_WEIGHTS.candlePatterns * 0.2;
                        candlePatternsDetail = `${candlePatternsScore.toFixed(1)}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} detectado)`;
                }
                
                // Bônus por confirmação de volume
                if (candlePatterns.confirmation) {
                    candlePatternsScore *= 1.2;
                    candlePatternsDetail += ' | Volume confirmado ✅';
                }
            } else {
                // Padrão contrário ao sinal - penaliza
                candlePatternsScore = -QUALITY_WEIGHTS.candlePatterns * 0.5;
                candlePatternsDetail = `${candlePatternsScore.toFixed(1)}/${QUALITY_WEIGHTS.candlePatterns} (Padrão ${pattern.name} CONTRÁRIO ao sinal!)`;
                failedChecks.push(`Padrão Candle: ${pattern.name} contrário ao sinal`);
            }
        } else {
            candlePatternsDetail = `0/${QUALITY_WEIGHTS.candlePatterns} (Sem padrões significativos detectados)`;
        }
        
        score += candlePatternsScore;
        details.push(` Padrões Candles (15m): ${candlePatternsDetail}`);
    } else {
        failedChecks.push(`Padrões Candles: Não analisado`);
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

        const supportResistanceData = await analyzeSupportResistance(symbol, emaData.currentPrice, isBullish);
        const pivotPointsData = await analyzePivotPoints(symbol, emaData.currentPrice, isBullish);
        
        // 🔹 NOVO: Analisar padrões de candles
        const candlePatternsData = await analyzeCandlePatterns(symbol, isBullish, emaData.currentPrice);

        const stoch12hData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_12H_SETTINGS);
        const stochDailyData = await checkStochasticWithTimeframe(symbol, isBullish, STOCHASTIC_DAILY_SETTINGS);

        const [volumeData, volatilityData, lsrData, stochData, stoch4hData, oiData, fundingData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);

        if (!lsrData.isValid) return null;
        
        if (!stoch4hData.isValid) {
            console.log(`❌ ${symbol}: Stochastic 4h não confirmado para ${isBullish ? 'compra' : 'venda'}`);
            return null;
        }

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
            candlePatterns: candlePatternsData // 🔹 NOVO: Adicionar dados de padrões de candles
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
        const pivotStrength = pivotInfo?.strength || 'N/A';
        const pivotTimeframe = pivotInfo?.timeframe || 'N/A';
        
        // 🔹 NOVO: Informações de padrões de candles
        let candlePatternsInfo = 'N/A';
        if (candlePatternsData && candlePatternsData.strongestPattern) {
            const pattern = candlePatternsData.strongestPattern;
            candlePatternsInfo = `${pattern.name} (${pattern.strength}) - ${candlePatternsData.confirmation ? 'Volume OK' : 'Sem volume'}`;
        }

        let stoch12hInfo = 'N/A';
        let stochDailyInfo = 'N/A';
        
        if (stoch12hData?.isValid && stoch12hData.kValue !== null && stoch12hData.dValue !== null) {
            const kValue = stoch12hData.kValue.toFixed(1);
            const dValue = stoch12hData.dValue.toFixed(1);
            
            if (stoch12hData.lastCross) {
                stoch12hInfo = `K:${kValue} D:${dValue} | Cruzamento ${stoch12hData.lastCross.direction} às ${stoch12hData.lastCross.time}`;
            } else {
                // Determinar tendência baseada em K e D
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
                // Determinar tendência baseada em K e D
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

        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📈 Volume: ${volumeData.rawRatio.toFixed(2)}x (Score: ${volumeScore} - ${volumeClassification})`);
        console.log(`   📊 EMA: ${emaRatio}x | Z-Score: ${zScore}`);
        console.log(`   📊 LSR Binance: ${lsrData.lsrRatio.toFixed(3)}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   📊 Padrão Candle: ${candlePatternsInfo}`); // 🔹 NOVO
        console.log(`   📊 Stoch 1h: ${stochData.isValid ? '✅' : '❌'} (K:${stochData.kValue?.toFixed(1) || 'N/A'}, D:${stochData.dValue?.toFixed(1) || 'N/A'})`);
        console.log(`   📊 Stoch 4h: ${stoch4hData.isValid ? '✅' : '❌'} (K:${stoch4hData.kValue?.toFixed(1) || 'N/A'}, D:${stoch4hData.dValue?.toFixed(1) || 'N/A'})`);
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

    console.log(`\n TITANIUM ATIVADO COM ANÁLISE DE PADRÕES DE CANDLES!`);
    console.log(` ${allSymbols.length} ativos Binance Futures`);
    console.log(` Sistema aprimorado com análise avançada de Padrões de Candles`);
    console.log(` Análise de Força Relativa vs BTC e Dominância ativada`);
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

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM - ATIVADO COM ANÁLISE DE PADRÕES DE CANDLES');
        console.log(` Sistema de detecção de padrões de candles (15m)`);
        console.log(` Sistema de detecção de volume robusto (3m)`);
        console.log(` Análise multi-timeframe de pivot points`);
        console.log(` Análise de Força Relativa vs BTC e Dominância`);
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
        console.log('🛡️  Risk Layer Sofisticado com análise de padrões de candles ativado');

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
