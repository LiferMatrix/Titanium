const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7715750289:AAEDoOv-IOnUi'; //Titanium 2
const TELEGRAM_CHAT_ID = '-10036060';

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
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.7,
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

// === COOLDOWN ===
const COOLDOWN_SETTINGS = {
    sameDirection: 15 * 60 * 1000,
    oppositeDirection: 8 * 60 * 1000,
    useDifferentiated: true,
    symbolCooldown: 15 * 60 * 1000
};

// === QUALITY SCORE - ATUALIZADO PARA GATILHO ÚNICO (VOLUME) ===
const QUALITY_THRESHOLD = 80;
const QUALITY_WEIGHTS = {
    volumeTrigger: 55,           // Peso principal apenas para volume
    oi: 1,
    volatility: 8,
    lsr: 12,
    rsi: 20,
    funding: 8,
    supportResistance: 20,
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
        '3m': 0.3,
        '15m': 1.0,
        '1h': 2.5,
        '4h': 3.5,
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

// === CONFIGURAÇÕES PARA FILTROS ADICIONAIS ===
const LIQUIDITY_FILTER = {
    maxSpreadPercent: 0.1, // Spread máximo de 0.1%
    minBidAskVolume: 0.5, // Volume mínimo no bid/ask (em BTC)
    checkDepth: true,
    depthLevels: 10
};

const WHALE_ACTIVITY_SETTINGS = {
    timeframe: '15m',
    largeTradeThreshold: 50000, // $50,000
    minSellBuyRatio: 2.0, // Vendas de baleia devem ser no máximo 2x compras
    checkRecentCandles: 20
};

const BTC_CORRELATION_SETTINGS = {
    minCorrelation: 0.5,
    timeframe: '15m',
    candles: 20,
    maxDeviationPercent: 5 // Máximo de 5% de desvio do BTC
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
                shouldBlock: false,
                filterResults: {
                    liquidity: null,
                    whaleActivity: null,
                    btcCorrelation: null
                }
            };

            // Coletar dados dos filtros
            riskAssessment.filterResults.liquidity = await this.analyzeLiquidityReal(signal.symbol, signal.price);
            riskAssessment.filterResults.whaleActivity = await this.detectWhaleActivity(signal.symbol);
            riskAssessment.filterResults.btcCorrelation = await this.analyzeBTCCorrelation(signal.symbol, signal.price);

            // Verificar filtros críticos
            if (riskAssessment.filterResults.liquidity && riskAssessment.filterResults.liquidity.spreadPercent > LIQUIDITY_FILTER.maxSpreadPercent) {
                riskAssessment.factors.push({
                    type: 'LIQUIDITY',
                    score: 3,
                    message: `Spread alto: ${riskAssessment.filterResults.liquidity.spreadPercent.toFixed(2)}% > ${LIQUIDITY_FILTER.maxSpreadPercent}%`
                });
                riskAssessment.overallScore += 3 * this.riskFactors.LIQUIDITY_RISK.weight;
            }

            if (riskAssessment.filterResults.whaleActivity && 
                riskAssessment.filterResults.whaleActivity.largeSells > 
                riskAssessment.filterResults.whaleActivity.largeBuys * WHALE_ACTIVITY_SETTINGS.minSellBuyRatio) {
                riskAssessment.factors.push({
                    type: 'WHALE',
                    score: 3,
                    message: `Alta atividade de venda de baleias: ${riskAssessment.filterResults.whaleActivity.largeSells} vendas vs ${riskAssessment.filterResults.whaleActivity.largeBuys} compras`
                });
                riskAssessment.overallScore += 3 * 1.2; // Peso extra para whale activity
            }

            // Análises regulares de risco
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

    // =====================================================================
    // FUNÇÕES DOS NOVOS FILTROS
    // =====================================================================

    async analyzeLiquidityReal(symbol, price) {
        try {
            const orderBook = await getOrderBookDepth(symbol);
            if (!orderBook || !orderBook.asks || !orderBook.bids || orderBook.asks.length === 0 || orderBook.bids.length === 0) {
                return null;
            }

            const bestAsk = orderBook.asks[0];
            const bestBid = orderBook.bids[0];
            
            const spread = (bestAsk.price - bestBid.price) / price * 100;
            
            // Calcular volume total nos primeiros níveis
            let bidVolume = 0;
            let askVolume = 0;
            
            for (let i = 0; i < Math.min(5, orderBook.bids.length); i++) {
                bidVolume += orderBook.bids[i].quantity * orderBook.bids[i].price;
            }
            
            for (let i = 0; i < Math.min(5, orderBook.asks.length); i++) {
                askVolume += orderBook.asks[i].quantity * orderBook.asks[i].price;
            }
            
            const totalDepth = (bidVolume + askVolume) / 2;
            
            return {
                spreadPercent: spread,
                bestAsk: bestAsk.price,
                bestBid: bestBid.price,
                bidVolume: bidVolume,
                askVolume: askVolume,
                totalDepth: totalDepth,
                isValid: spread <= LIQUIDITY_FILTER.maxSpreadPercent && 
                        bidVolume > LIQUIDITY_FILTER.minBidAskVolume &&
                        askVolume > LIQUIDITY_FILTER.minBidAskVolume
            };
            
        } catch (error) {
            console.error(`Erro análise liquidez real ${symbol}:`, error.message);
            return null;
        }
    }

    async detectWhaleActivity(symbol) {
        try {
            const candles = await getCandlesCached(symbol, WHALE_ACTIVITY_SETTINGS.timeframe, 
                WHALE_ACTIVITY_SETTINGS.checkRecentCandles);
            
            if (candles.length < 10) {
                return null;
            }
            
            let largeBuys = 0;
            let largeSells = 0;
            let totalVolume = 0;
            
            // Analisar últimos candles para grandes trades
            for (const candle of candles.slice(-10)) {
                const volumeUSD = candle.volume * candle.close;
                totalVolume += volumeUSD;
                
                // Se o candle tem volume anormalmente alto, pode indicar whale activity
                if (volumeUSD > WHALE_ACTIVITY_SETTINGS.largeTradeThreshold) {
                    // Determinar se foi compra ou venda baseado no movimento do preço
                    if (candle.close > candle.open) {
                        largeBuys++;
                    } else if (candle.close < candle.open) {
                        largeSells++;
                    }
                }
            }
            
            const avgVolume = totalVolume / candles.length;
            
            return {
                largeBuys: largeBuys,
                largeSells: largeSells,
                totalLargeTrades: largeBuys + largeSells,
                whaleRatio: largeSells > 0 ? largeBuys / largeSells : 0,
                avgVolumeUSD: avgVolume,
                isWhaleSelling: largeSells > largeBuys * WHALE_ACTIVITY_SETTINGS.minSellBuyRatio,
                isValid: !(largeSells > largeBuys * WHALE_ACTIVITY_SETTINGS.minSellBuyRatio)
            };
            
        } catch (error) {
            console.error(`Erro detecção whale activity ${symbol}:`, error.message);
            return null;
        }
    }

    async analyzeBTCCorrelation(symbol, currentPrice) {
        try {
            if (symbol === 'BTCUSDT') {
                return {
                    correlation: 1,
                    priceChangePercent: 0,
                    deviationPercent: 0,
                    isCorrelated: true,
                    isValid: true
                };
            }
            
            const btcSymbol = 'BTCUSDT';
            
            // Buscar candles para o par atual e BTC
            const symbolCandles = await getCandlesCached(symbol, BTC_CORRELATION_SETTINGS.timeframe, 
                BTC_CORRELATION_SETTINGS.candles);
            const btcCandles = await getCandlesCached(btcSymbol, BTC_CORRELATION_SETTINGS.timeframe, 
                BTC_CORRELATION_SETTINGS.candles);
            
            if (symbolCandles.length < 5 || btcCandles.length < 5) {
                return null;
            }
            
            // Calcular correlação
            const symbolReturns = [];
            const btcReturns = [];
            
            for (let i = 1; i < Math.min(symbolCandles.length, btcCandles.length); i++) {
                const symbolReturn = (symbolCandles[i].close - symbolCandles[i-1].close) / symbolCandles[i-1].close;
                const btcReturn = (btcCandles[i].close - btcCandles[i-1].close) / btcCandles[i-1].close;
                
                symbolReturns.push(symbolReturn);
                btcReturns.push(btcReturn);
            }
            
            const correlation = this.calculateCorrelation(symbolReturns, btcReturns);
            
            // Calcular variação percentual recente
            const symbolChange = ((symbolCandles[symbolCandles.length-1].close - symbolCandles[0].close) / symbolCandles[0].close) * 100;
            const btcChange = ((btcCandles[btcCandles.length-1].close - btcCandles[0].close) / btcCandles[0].close) * 100;
            
            const deviationPercent = Math.abs(symbolChange - btcChange);
            
            return {
                correlation: correlation,
                priceChangePercent: symbolChange,
                btcChangePercent: btcChange,
                deviationPercent: deviationPercent,
                isCorrelated: Math.abs(correlation) >= BTC_CORRELATION_SETTINGS.minCorrelation,
                isValid: deviationPercent <= BTC_CORRELATION_SETTINGS.maxDeviationPercent
            };
            
        } catch (error) {
            console.error(`Erro análise correlação BTC ${symbol}:`, error.message);
            return null;
        }
    }

    // =====================================================================
    // FUNÇÕES EXISTENTES DO RISK LAYER (mantidas)
    // =====================================================================

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

        // Adicionar recomendações baseadas nos filtros
        if (assessment.filterResults.liquidity && !assessment.filterResults.liquidity.isValid) {
            recommendations.push('⚠️ <b>LIQUIDEZ:</b> Spread muito alto ou volume insuficiente');
        }
        
        if (assessment.filterResults.whaleActivity && !assessment.filterResults.whaleActivity.isValid) {
            recommendations.push('⚠️ <b>WHALE ACTIVITY:</b> Alta venda de baleias detectada');
        }
        
        if (assessment.filterResults.btcCorrelation && !assessment.filterResults.btcCorrelation.isValid) {
            recommendations.push('⚠️ <b>CORRELAÇÃO BTC:</b> Desvio muito alto do BTC');
        }

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

        // Adicionar warnings dos filtros
        if (assessment.filterResults.liquidity && !assessment.filterResults.liquidity.isValid) {
            warnings.push(`⚠️ LIQUIDEZ: Spread ${assessment.filterResults.liquidity.spreadPercent.toFixed(2)}% > ${LIQUIDITY_FILTER.maxSpreadPercent}%`);
        }
        
        if (assessment.filterResults.whaleActivity && assessment.filterResults.whaleActivity.isWhaleSelling) {
            warnings.push(`⚠️ WHALE: ${assessment.filterResults.whaleActivity.largeSells} vendas vs ${assessment.filterResults.whaleActivity.largeBuys} compras`);
        }
        
        if (assessment.filterResults.btcCorrelation && !assessment.filterResults.btcCorrelation.isValid) {
            warnings.push(`⚠️ BTC CORR: Desvio ${assessment.filterResults.btcCorrelation.deviationPercent.toFixed(2)}% > ${BTC_CORRELATION_SETTINGS.maxDeviationPercent}%`);
        }

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
        
        // Log dos filtros
        if (assessment.filterResults.liquidity) {
            console.log(`   Liquidez: Spread ${assessment.filterResults.liquidity.spreadPercent.toFixed(2)}% ${assessment.filterResults.liquidity.isValid ? '✅' : '❌'}`);
        }
        if (assessment.filterResults.whaleActivity) {
            console.log(`   Whale Activity: ${assessment.filterResults.whaleActivity.largeBuys}B/${assessment.filterResults.whaleActivity.largeSells}S ${assessment.filterResults.whaleActivity.isValid ? '✅' : '❌'}`);
        }
        if (assessment.filterResults.btcCorrelation) {
            console.log(`   BTC Corr: ${assessment.filterResults.btcCorrelation.correlation.toFixed(2)} ${assessment.filterResults.btcCorrelation.isValid ? '✅' : '❌'}`);
        }

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
            shouldBlock: false,
            filterResults: {
                liquidity: null,
                whaleActivity: null,
                btcCorrelation: null
            }
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
// FUNÇÕES DOS NOVOS FILTROS (fora da classe)
// =====================================================================

async function getOrderBookDepth(symbol, limit = 10) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${limit}`;
        const response = await rateLimiter.makeRequest(url, {}, 'klines');
        
        if (!response || !response.bids || !response.asks) {
            return null;
        }
        
        const asks = response.asks.map(ask => ({
            price: parseFloat(ask[0]),
            quantity: parseFloat(ask[1])
        }));
        
        const bids = response.bids.map(bid => ({
            price: parseFloat(bid[0]),
            quantity: parseFloat(bid[1])
        }));
        
        return {
            asks: asks,
            bids: bids,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.error(`Erro ao buscar order book ${symbol}:`, error.message);
        return null;
    }
}

async function applyFilters(symbol, price) {
    try {
        const orderBook = await getOrderBookDepth(symbol);
        const spread = (orderBook.asks[0].price - orderBook.bids[0].price) / price * 100;
        
        if (spread > LIQUIDITY_FILTER.maxSpreadPercent) {
            console.log(`❌ ${symbol}: Spread muito alto ${spread.toFixed(2)}% > ${LIQUIDITY_FILTER.maxSpreadPercent}%`);
            return false;
        }
        
        const whaleTrades = await detectWhaleActivity(symbol, WHALE_ACTIVITY_SETTINGS.timeframe);
        if (whaleTrades && whaleTrades.largeSells > whaleTrades.largeBuys * WHALE_ACTIVITY_SETTINGS.minSellBuyRatio) {
            console.log(`❌ ${symbol}: Alta venda de baleias ${whaleTrades.largeSells}S > ${whaleTrades.largeBuys}B * ${WHALE_ACTIVITY_SETTINGS.minSellBuyRatio}`);
            return false;
        }
        
        const btcCorrelation = await analyzeBTCCorrelation(symbol, price);
        if (btcCorrelation && !btcCorrelation.isValid) {
            console.log(`❌ ${symbol}: Desvio do BTC ${btcCorrelation.deviationPercent.toFixed(2)}% > ${BTC_CORRELATION_SETTINGS.maxDeviationPercent}%`);
            return false;
        }
        
        return true;
        
    } catch (error) {
        console.error(`Erro aplicando filtros ${symbol}:`, error.message);
        return true; // Não bloquear se houver erro nos filtros
    }
}

async function detectWhaleActivity(symbol, timeframe = '15m') {
    try {
        const candles = await getCandlesCached(symbol, timeframe, WHALE_ACTIVITY_SETTINGS.checkRecentCandles);
        
        if (candles.length < 10) {
            return { largeBuys: 0, largeSells: 0, isValid: true };
        }
        
        let largeBuys = 0;
        let largeSells = 0;
        
        for (const candle of candles.slice(-10)) {
            const volumeUSD = candle.volume * candle.close;
            
            if (volumeUSD > WHALE_ACTIVITY_SETTINGS.largeTradeThreshold) {
                if (candle.close > candle.open) {
                    largeBuys++;
                } else if (candle.close < candle.open) {
                    largeSells++;
                }
            }
        }
        
        return {
            largeBuys: largeBuys,
            largeSells: largeSells,
            isValid: !(largeSells > largeBuys * WHALE_ACTIVITY_SETTINGS.minSellBuyRatio)
        };
        
    } catch (error) {
        console.error(`Erro detecção whale activity ${symbol}:`, error.message);
        return { largeBuys: 0, largeSells: 0, isValid: true };
    }
}

async function analyzeBTCCorrelation(symbol, currentPrice) {
    try {
        if (symbol === 'BTCUSDT') {
            return {
                correlation: 1,
                priceChangePercent: 0,
                btcChangePercent: 0,
                deviationPercent: 0,
                isCorrelated: true,
                isValid: true
            };
        }
        
        const btcSymbol = 'BTCUSDT';
        const symbolCandles = await getCandlesCached(symbol, BTC_CORRELATION_SETTINGS.timeframe, BTC_CORRELATION_SETTINGS.candles);
        const btcCandles = await getCandlesCached(btcSymbol, BTC_CORRELATION_SETTINGS.timeframe, BTC_CORRELATION_SETTINGS.candles);
        
        if (symbolCandles.length < 5 || btcCandles.length < 5) {
            return null;
        }
        
        const symbolChange = ((symbolCandles[symbolCandles.length-1].close - symbolCandles[0].close) / symbolCandles[0].close) * 100;
        const btcChange = ((btcCandles[btcCandles.length-1].close - btcCandles[0].close) / btcCandles[0].close) * 100;
        
        const deviationPercent = Math.abs(symbolChange - btcChange);
        
        return {
            correlation: 0, // Placeholder - cálculo mais complexo seria necessário
            priceChangePercent: symbolChange,
            btcChangePercent: btcChange,
            deviationPercent: deviationPercent,
            isCorrelated: true,
            isValid: deviationPercent <= BTC_CORRELATION_SETTINGS.maxDeviationPercent
        };
        
    } catch (error) {
        console.error(`Erro análise correlação BTC ${symbol}:`, error.message);
        return null;
    }
}

// =====================================================================
// 🔄 CIRCUIT BREAKER CLASS (mantida)
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
// 🚀 RATE LIMITER COM DELAY ADAPTATIVO (mantida)
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
// 📊 FUNÇÕES AUXILIARES (mantidas com pequenas alterações)
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
    const emaRatio = volumeData.timeframe1h?.currentRatio || 0;
    const zScore = volumeData.timeframe1h?.zScore || 0;

    const isConfirmed = 
        combinedScore >= VOLUME_MINIMUM_THRESHOLDS.combinedScore &&
        emaRatio >= 1.3 &&
        (!classification.includes('BAIXO') && !classification.includes('INSUFICIENTE'));

    return isConfirmed;
}

// =====================================================================
// 🔢 FUNÇÃO PARA CALCULAR PONTOS DE FIBONACCI (mantida)
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
// 📊 FUNÇÃO PARA OBTER ADX 1H (mantida)
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
// 📤 FUNÇÃO ATUALIZADA PARA ENVIAR ALERTAS COM FILTROS E BIDS/ASKS
// =====================================================================

async function sendSignalAlertWithRisk(signal) {
    try {
        const volumeData = signal.marketData.volumeCross;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const isVolumeConfirmed = checkVolumeConfirmation(volumeData);
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        const riskAssessment = await global.riskLayer.assessSignalRisk(signal);
        
        // Coletar dados dos filtros do risk assessment
        const liquidityData = riskAssessment.filterResults.liquidity;
        const whaleData = riskAssessment.filterResults.whaleActivity;
        const btcCorrData = riskAssessment.filterResults.btcCorrelation;
        
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
        
        // Obter pivôs de todos os timeframes importantes
        let allPivotsInfo = '';
        if (pivotData && pivotData.nearestPivot) {
            // Pega os 3 pivôs mais próximos (excluindo 3m)
            const allPivots = [
                ...(pivotData.supports || []),
                ...(pivotData.resistances || [])
            ].filter(p => p.timeframe !== '3m');
            
            // Ordena por distância
            allPivots.sort((a, b) => {
                const distA = Math.abs(signal.price - a.price);
                const distB = Math.abs(signal.price - b.price);
                return distA - distB;
            });
            
            // Pega os 3 mais próximos
            const closestPivots = allPivots.slice(0, 3);
            
            allPivotsInfo = closestPivots.map(pivot => {
                const distance = Math.abs(signal.price - pivot.price);
                const distancePercent = (distance / signal.price * 100).toFixed(2);
                const strengthEmoji = pivot.strength === 'Muito Forte' ? '🚨' :
                                    pivot.strength === 'Forte' ? '🔴' :
                                    pivot.strength === 'Moderado' ? '🟡' : '⚪';
                
                return `• ${strengthEmoji} ${pivot.type} ${pivot.timeframe}: $${pivot.price.toFixed(6)} (${distancePercent}%)`;
            }).join('\n');
            
            // Adiciona o pivot mais próximo como destaque
            allPivotsInfo = `📊 **PIVOTS PRINCIPAIS:**\n${allPivotsInfo}`;
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
                fibInfo = `🔹 Fibonacci ${fib.level}: $${fib.price.toFixed(6)} (${fib.distancePercent.toFixed(2)}%)`;
            }
        }
        
        const adxData = await getADX1h(signal.symbol);
        let adxInfo = '';
        if (adxData) {
            const adxEmoji = adxData.isAbove20 ? '💹 ' : '';
            adxInfo = `\n${adxEmoji}ADX 1h: ${adxData.adx.toFixed(1)} ${adxData.isAbove20 ? '(💹Forte Tendência)' : '(⚪Tendência Fraca)'}`;
        } else {
            adxInfo = `\nADX 1h: N/A | Não disponível`;
        }

        const riskEmoji = riskAssessment.level === 'CRÍTICO' ? '🚨' :
            riskAssessment.level === 'ALTO' ? '🔴' :
                riskAssessment.level === 'MEDIANO' ? '🟡' : '🟢';

        const now = getBrazilianDateTime();
        
        // OBTER ORDENS BIDS E ASKS DA BINANCE
        const orderBook = await getOrderBookDepth(signal.symbol, 5);
        let bidsAsksInfo = '';
        
        if (orderBook && orderBook.bids && orderBook.asks) {
            // Obter top 3 BIDS e ASKS
            const topBids = orderBook.bids.slice(0, 3);
            const topAsks = orderBook.asks.slice(0, 3);
            
            bidsAsksInfo = `\n<b>📊 Ordem de Mercado BINANCE:</b>`;
            
            if (topAsks.length > 0) {
                bidsAsksInfo += `\n<b>🔴 VENDA (ASKS):</b>`;
                topAsks.forEach((ask, index) => {
                    bidsAsksInfo += `\n   ${index + 1}. $${ask.price.toFixed(6)} - Vol: ${ask.quantity.toFixed(4)}`;
                });
            }
            
            if (topBids.length > 0) {
                bidsAsksInfo += `\n<b>🟢 COMPRA (BIDS):</b>`;
                topBids.forEach((bid, index) => {
                    bidsAsksInfo += `\n   ${index + 1}. $${bid.price.toFixed(6)} - Vol: ${bid.quantity.toFixed(4)}`;
                });
            }
            
            // Adicionar spread
            if (topAsks.length > 0 && topBids.length > 0) {
                const spread = (topAsks[0].price - topBids[0].price) / signal.price * 100;
                const spreadEmoji = spread <= 0.05 ? '🟢' : spread <= 0.1 ? '🟡' : '🔴';
                bidsAsksInfo += `\n<b>📈 Spread:</b> ${spreadEmoji} ${spread.toFixed(4)}%`;
            }
        } else {
            bidsAsksInfo = `\n📊 Ordem de Mercado: Dados indisponíveis`;
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
            ? `${fundingRateEmoji} ${(fundingRate * 100).toFixed(5)}%`
            : 'Indisponível';

        let analysisType = '';
        let analysisEmoji = '🤖';

        if (!isVolumeConfirmed) {
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
        
        if (isVolumeConfirmed) {
            let pivotInfo = '';
            if (nearestPivot && parseFloat(pivotDistance) < 1.0) {
                const pivotStrengthText = pivotStrength === 'Forte' ? '🔴 FORTE' : 
                                        pivotStrength === 'Muito Forte' ? '🚨 MUITO FORTE' :
                                        pivotStrength === 'Moderado' ? '🟡 MODERADO' : '⚪ FRACO';
                pivotInfo = ` (Pivot ${pivotType} ${pivotStrengthText})`;
            }
            
            alertTitle = `🚨 <b>${signal.symbol} - ${direction}${pivotInfo}</b>\n Volume...`;
            alertType = 'trade';
        } else {
            alertTitle = `${analysisEmoji} <i>IA... ${analysisType}: ${signal.symbol}</i>`;
            alertType = 'analysis';
        }

        // Construir mensagem com informações dos filtros
        let filterInfo = '';
        if (liquidityData) {
            const spreadEmoji = liquidityData.spreadPercent <= LIQUIDITY_FILTER.maxSpreadPercent ? '🟢' : '🔴';
            filterInfo += `\n${spreadEmoji} Spread: ${liquidityData.spreadPercent.toFixed(2)}%`;
        }
        
        if (whaleData) {
            const whaleEmoji = whaleData.isValid ? '🟢' : '🔴';
            filterInfo += `\n${whaleEmoji} Whale: ${whaleData.largeBuys}B/${whaleData.largeSells}S`;
        }
        
        if (btcCorrData) {
            const btcEmoji = btcCorrData.isValid ? '🟢' : '🔴';
            filterInfo += `\n${btcEmoji} BTC Corr: ${btcCorrData.correlation?.toFixed(2) || 'N/A'} (${btcCorrData.deviationPercent?.toFixed(2) || 'N/A'}%)`;
        }

        let message = `
${alertTitle}
${now.full}
<b> Indicadores Técnicos</b>
⚠️ SCORE: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${riskAdjustedProbability}%
💲 Preço: $${signal.price.toFixed(6)}
⚠️ Score: ${volumeScore.toFixed(2)} - ${volumeClassification}
${filterInfo}
${allPivotsInfo ? `${allPivotsInfo}` : ''}
${fibInfo}
${adxInfo}
⚠️ LSR: ${binanceLSRValue} ${lsrSymbol} (${lsrPercentChange}%)|🔹RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
${bidsAsksInfo}
<b>🤖 IA Operação/Risco </b>
• Risco: ${riskAssessment.overallScore.toFixed(2)} | Nível: ${riskEmoji} ${riskAssessment.level} 
⚠️ Confiança da IA: ${riskAssessment.confidence}%
${!isVolumeConfirmed ? `• 🔶 ATENÇÃO: Aguarde Volume Confirmado (Score ≥ ${VOLUME_MINIMUM_THRESHOLDS.combinedScore})` : ''}
${riskAssessment.warnings.length > 0 ? `• ${riskAssessment.warnings[0]}` : ''}
${volumeScore < 0.3 ? `\n• 🔶 Volume Baixo: Score ${volumeScore.toFixed(2)}` : ''}
        `;
        
        if (isVolumeConfirmed) {
            message += `
<b> 💡Dica de Entrada : </b>
• Liquidez 1 : $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
<b> Alvos:</b>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
⛔Stop: $${signal.targetsData.stopPrice.toFixed(6)}
            `;
        } else {
            // Adicionar recomendações dos filtros
            if (liquidityData && !liquidityData.isValid) {
                message += `\n• ⚠️ Spread alto: ${liquidityData.spreadPercent.toFixed(2)}%`;
            }
            if (whaleData && !whaleData.isValid) {
                message += `\n• ⚠️ Whale selling: ${whaleData.largeSells} vendas vs ${whaleData.largeBuys} compras`;
            }
            if (btcCorrData && !btcCorrData.isValid) {
                message += `\n• ⚠️ Desvio BTC: ${btcCorrData.deviationPercent?.toFixed(2) || 'N/A'}%`;
            }
        }
        
        message += `
<b>✨Titanium by @J4Rviz✨</b>
        `;

        await sendTelegramAlert(message);

        console.log(`\n📤 ${alertType === 'trade' ? 'Alerta de TRADE' : 'Análise da IA'} enviado: ${signal.symbol}`);
        console.log(`   Data/Hora: ${now.full}`);
        console.log(`   Score Técnico: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})`);
        console.log(`   Probabilidade: ${riskAdjustedProbability}%`);
        console.log(`   Risk Level: ${riskAssessment.level} (Score: ${riskAssessment.overallScore.toFixed(2)})`);
        console.log(`   Confiança: ${riskAssessment.confidence}%`);
        console.log(`   Volume: Score: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Volume Confirmado: ${isVolumeConfirmed ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`   Tipo de Análise: ${analysisType}`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR Binance: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);
        
        // Log dos filtros
        if (liquidityData) {
            console.log(`   Spread: ${liquidityData.spreadPercent.toFixed(2)}% ${liquidityData.isValid ? '✅' : '❌'}`);
        }
        if (whaleData) {
            console.log(`   Whale Activity: ${whaleData.largeBuys}B/${whaleData.largeSells}S ${whaleData.isValid ? '✅' : '❌'}`);
        }
        if (btcCorrData) {
            console.log(`   BTC Correlation: ${btcCorrData.correlation?.toFixed(2) || 'N/A'} ${btcCorrData.isValid ? '✅' : '❌'}`);
        }

        return {
            type: alertType,
            volumeConfirmed: isVolumeConfirmed,
            volumeScore: volumeScore,
            analysisType: analysisType,
            filters: {
                liquidity: liquidityData?.isValid || true,
                whaleActivity: whaleData?.isValid || true,
                btcCorrelation: btcCorrData?.isValid || true
            }
        };

    } catch (error) {
        console.error('Erro ao enviar alerta com risk layer:', error.message);
        return await sendSignalAlert(signal);
    }
}

// =====================================================================
// 🚀 FUNÇÃO MONITOR SYMBOL ATUALIZADA COM FILTROS
// =====================================================================

async function monitorSymbol(symbol) {
    try {
        // Buscar gatilho de volume
        const volumeData = await checkVolumeCross(symbol);
        
        // VERIFICAÇÃO OBRIGATÓRIA: Volume deve estar cruzando
        const isVolumeCrossingUp = volumeData.isCrossingUp;
        const isVolumeCrossingDown = volumeData.isCrossingDown;
        
        // Determinar direção baseada no GATILHO DE VOLUME
        let isBullish = null;
        let hasVolumeTrigger = false;
        
        if (isVolumeCrossingUp && checkVolumeConfirmation(volumeData)) {
            isBullish = true;
            hasVolumeTrigger = true;
        } else if (isVolumeCrossingDown && checkVolumeConfirmation(volumeData)) {
            isBullish = false;
            hasVolumeTrigger = true;
        }
        
        // SE NÃO HOUVER GATILHO DE VOLUME, RETORNAR NULL
        if (!hasVolumeTrigger) {
            return null;
        }
        
        // Buscar preço atual
        const currentPrice = await getCurrentPrice(symbol);
        if (!currentPrice) return null;
        
        // APLICAR FILTROS ADICIONAIS
        const filtersPassed = await applyFilters(symbol, currentPrice);
        if (!filtersPassed) {
            console.log(`❌ ${symbol}: Filtros adicionais falharam`);
            return null;
        }
        
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

        // Apenas aceitar sinais com gatilho de volume
        if (!qualityScore.hasVolumeTrigger) return null;
        
        if (!qualityScore.isAcceptable) return null;

        const targetsData = await calculateAdvancedTargetsAndStop(currentPrice, isBullish, symbol);

        const signal = {
            symbol: symbol,
            isBullish: isBullish,
            price: currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            hasVolumeTrigger: hasVolumeTrigger,
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

        console.log(`🚨 ${symbol}: GATILHO DE VOLUME CONFIRMADO - ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        console.log(`   🎯 Volume Cross: ${isBullish ? '⬆️ CRUZANDO CIMA' : '⬇️ CRUZANDO BAIXO'} (1h: ${volumeData.timeframe1h.currentRatio.toFixed(2)}x, 4h: ${volumeData.timeframe4h.currentRatio.toFixed(2)}x)`);
        console.log(`   📊 Volume Score: ${volumeScore} - ${volumeClassification}`);
        console.log(`   📊 RSI: ${rsiData.value.toFixed(1)} (${rsiData.status})`);
        console.log(`   📊 LSR Binance: ${lsrData.lsrRatio.toFixed(3)}`);
        console.log(`   📊 S/R: ${srDistance}% | Risco: ${breakoutRisk}`);
        console.log(`   📊 Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   💰 Funding: ${fundingRateText}`);
        console.log(`   ✅ Filtros adicionais: PASSED`);

        return signal;

    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// FUNÇÕES RESTANTES (mantidas do código original)
// =====================================================================

async function sendSignalAlert(signal) {
    try {
        const volumeData = signal.marketData.volumeCross;
        const volumeScore = volumeData?.combinedScore || 0;
        const volumeClassification = volumeData?.classification || 'NORMAL';
        
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const lsrData = signal.marketData.lsr;
        const binanceLSRValue = lsrData?.binanceLSR?.lsrValue?.toFixed(3) || 'N/A';
        const lsrPercentChange = lsrData?.percentChange || '0.00';
        const lsrSymbol = lsrData?.isRising ? '⬆️' : '⬇️';
        
        const probability = calculateProbability(signal);
        
        const srData = signal.marketData.supportResistance;
        const nearestLevel = signal.isBullish ? srData?.nearestResistance : srData?.nearestSupport;
        const distancePercent = nearestLevel?.distancePercent?.toFixed(2) || 'N/A';

        const pivotData = signal.marketData.pivotPoints;
        const nearestPivot = pivotData?.nearestPivot;
        const pivotDistance = nearestPivot?.distancePercent?.toFixed(2) || 'N/A';
        const pivotType = nearestPivot?.type || 'N/A';
        const pivotStrength = nearestPivot?.strength || 'N/A';
        const pivotTimeframe = nearestPivot?.timeframe || 'N/A';
        
        const now = getBrazilianDateTime();
        
        // OBTER ORDENS BIDS E ASKS DA BINANCE
        const orderBook = await getOrderBookDepth(signal.symbol, 5);
        let bidsAsksInfo = '';
        
        if (orderBook && orderBook.bids && orderBook.asks) {
            // Obter top 3 BIDS e ASKS
            const topBids = orderBook.bids.slice(0, 3);
            const topAsks = orderBook.asks.slice(0, 3);
            
            bidsAsksInfo = `\n<b>📊 Ordem de Mercado BINANCE:</b>`;
            
            if (topAsks.length > 0) {
                bidsAsksInfo += `\n<b>🔴 VENDA (ASKS):</b>`;
                topAsks.forEach((ask, index) => {
                    bidsAsksInfo += `\n   ${index + 1}. $${ask.price.toFixed(6)} - Vol: ${ask.quantity.toFixed(4)}`;
                });
            }
            
            if (topBids.length > 0) {
                bidsAsksInfo += `\n<b>🟢 COMPRA (BIDS):</b>`;
                topBids.forEach((bid, index) => {
                    bidsAsksInfo += `\n   ${index + 1}. $${bid.price.toFixed(6)} - Vol: ${bid.quantity.toFixed(4)}`;
                });
            }
        } else {
            bidsAsksInfo = `\n📊 Ordem de Mercado: Dados indisponíveis`;
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
            ? `${fundingRateEmoji} ${(fundingRate * 100).toFixed(5)}%`
            : 'Indisponível';

        let message = `
${directionEmoji} <b>${signal.symbol} - ${direction}</b>
${now.full}
<b> Indicadores Técnicos</b>
⚠️ SCORE: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})
⚠️ Probabilidade: ${probability}%
💲 Preço: $${signal.price.toFixed(6)}
⚠️ VOLUME: Score: ${volumeScore.toFixed(2)} - ${volumeClassification}
${bidsAsksInfo}
⚠️ LSR: ${binanceLSRValue} ${lsrSymbol} (${lsrPercentChange}%)|🔹RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}
• Fund. Rate: ${fundingRateText}
<b>💡Dica de Entrada:</b>
• Liquidez 1 : $${signal.targetsData.retracementData.minRetracementPrice.toFixed(6)}
• Liquidez 2: $${signal.targetsData.retracementData.maxRetracementPrice.toFixed(6)}
<b>Alvos:</b>
${signal.targetsData.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
⛔Stop: $${signal.targetsData.stopPrice.toFixed(6)}
<b>✨Titanium by @J4Rviz✨</b>
        `;

        await sendTelegramAlert(message);

        console.log(`\n📤 Alerta enviado: ${signal.symbol}`);
        console.log(`   Data/Hora: ${now.full}`);
        console.log(`   Score: ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})`);
        console.log(`   Probabilidade: ${probability}%`);
        console.log(`   Volume: ${volumeScore.toFixed(2)} - ${volumeClassification})`);
        console.log(`   Pivot: ${pivotType} ${pivotDistance}% (${pivotStrength} - ${pivotTimeframe})`);
        console.log(`   LSR: ${binanceLSRValue} ${lsrSymbol}`);
        console.log(`   RSI: ${signal.marketData.rsi?.value?.toFixed(1) || 'N/A'}`);
        console.log(`   Funding: ${fundingRateText}`);

        return true;

    } catch (error) {
        console.error('Erro ao enviar alerta básico:', error.message);
        return false;
    }
}

function getVolumeClassification(score) {
    if (score >= 2.0) return '🚨 MUITO ALTO';
    if (score >= 1.5) return '🔴 ALTO';
    if (score >= 1.0) return '🟡 MODERADO';
    if (score >= 0.5) return '🟢 BAIXO';
    return '⚪ MUITO BAIXO';
}

function calculateProbability(signal) {
    const qualityScore = signal.qualityScore.score;
    const volumeData = signal.marketData.volumeCross;
    const volumeScore = volumeData?.combinedScore || 0;
    const volumeClassification = volumeData?.classification || '';
    
    let baseProbability = qualityScore;
    
    if (volumeScore >= 2.0) baseProbability += 15;
    else if (volumeScore >= 1.5) baseProbability += 10;
    else if (volumeScore >= 1.0) baseProbability += 5;
    
    if (volumeClassification.includes('ALTO')) baseProbability += 8;
    if (volumeClassification.includes('MUITO ALTO')) baseProbability += 12;
    
    const lsrData = signal.marketData.lsr;
    if (lsrData?.isValid) {
        if (signal.isBullish && lsrData.lsrRatio < 2.0) baseProbability += 10;
        if (!signal.isBullish && lsrData.lsrRatio > 3.5) baseProbability += 10;
    }
    
    const rsiData = signal.marketData.rsi;
    if (rsiData?.value) {
        if (signal.isBullish && rsiData.value < 40) baseProbability += 8;
        if (!signal.isBullish && rsiData.value > 60) baseProbability += 8;
    }
    
    const pivotData = signal.marketData.pivotPoints;
    if (pivotData?.nearestPivot) {
        const pivotDistance = pivotData.nearestPivot.distancePercent;
        if (pivotDistance > 2.0) baseProbability += 5;
        if (pivotData.nearestPivot.strength === 'Forte') baseProbability -= 5;
        if (pivotData.nearestPivot.strength === 'Muito Forte') baseProbability -= 8;
    }
    
    return Math.min(95, Math.max(30, Math.round(baseProbability)));
}

async function getBinanceLSRValue(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=5m&limit=1`;
        const response = await rateLimiter.makeRequest(url, {}, 'openInterest');
        
        if (!response || response.length === 0) {
            return { lsrValue: null, error: 'No data' };
        }
        
        const data = response[0];
        const sumOpenInterest = parseFloat(data.sumOpenInterest);
        const sumOpenInterestValue = parseFloat(data.sumOpenInterestValue);
        
        let lsrValue = null;
        if (sumOpenInterest > 0 && sumOpenInterestValue > 0) {
            lsrValue = sumOpenInterestValue / sumOpenInterest;
        }
        
        const previousUrl = `https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=5m&limit=2`;
        const previousResponse = await rateLimiter.makeRequest(previousUrl, {}, 'openInterest');
        
        let percentChange = 0;
        if (previousResponse && previousResponse.length >= 2) {
            const current = response[0];
            const previous = previousResponse[0];
            
            const currentValue = parseFloat(current.sumOpenInterestValue) / parseFloat(current.sumOpenInterest);
            const previousValue = parseFloat(previous.sumOpenInterestValue) / parseFloat(previous.sumOpenInterest);
            
            if (previousValue > 0) {
                percentChange = ((currentValue - previousValue) / previousValue) * 100;
            }
        }
        
        return {
            lsrValue: lsrValue,
            percentChange: percentChange,
            isRising: percentChange > 0,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.error(`Erro LSR ${symbol}:`, error.message);
        return { lsrValue: null, error: error.message };
    }
}

async function checkVolumeCross(symbol) {
    try {
        // 1. Timeframe 1h
        const candles1h = await getCandlesCached(symbol, VOLUME_CROSS_SETTINGS.timeframe1h, VOLUME_CROSS_SETTINGS.candles1h);
        
        if (candles1h.length < VOLUME_CROSS_SETTINGS.candles1h) {
            console.log(`❌ ${symbol}: Dados 1h insuficientes (${candles1h.length}/${VOLUME_CROSS_SETTINGS.candles1h})`);
            return null;
        }
        
        const volumes1h = candles1h.map(c => c.volume);
        const volumeEma1h = EMA.calculate({
            values: volumes1h,
            period: VOLUME_CROSS_SETTINGS.emaPeriod
        });
        
        const currentVolume1h = volumes1h[volumes1h.length - 1];
        const currentEma1h = volumeEma1h[volumeEma1h.length - 1];
        const currentRatio1h = currentVolume1h / currentEma1h;
        
        const mean1h = volumes1h.reduce((a, b) => a + b, 0) / volumes1h.length;
        const variance1h = volumes1h.reduce((a, b) => a + Math.pow(b - mean1h, 2), 0) / volumes1h.length;
        const stdDev1h = Math.sqrt(variance1h);
        const zScore1h = stdDev1h > 0 ? (currentVolume1h - mean1h) / stdDev1h : 0;
        
        const isCrossingUp1h = currentRatio1h >= VOLUME_CROSS_SETTINGS.minVolumeRatio;
        const isCrossingDown1h = currentRatio1h <= (1 / VOLUME_CROSS_SETTINGS.minVolumeRatio);
        
        // 2. Timeframe 4h
        const candles4h = await getCandlesCached(symbol, VOLUME_CROSS_SETTINGS.timeframe4h, VOLUME_CROSS_SETTINGS.candles4h);
        
        if (candles4h.length < VOLUME_CROSS_SETTINGS.candles4h) {
            console.log(`❌ ${symbol}: Dados 4h insuficientes (${candles4h.length}/${VOLUME_CROSS_SETTINGS.candles4h})`);
            return null;
        }
        
        const volumes4h = candles4h.map(c => c.volume);
        const volumeEma4h = EMA.calculate({
            values: volumes4h,
            period: VOLUME_CROSS_SETTINGS.emaPeriod
        });
        
        const currentVolume4h = volumes4h[volumes4h.length - 1];
        const currentEma4h = volumeEma4h[volumeEma4h.length - 1];
        const currentRatio4h = currentVolume4h / currentEma4h;
        
        const mean4h = volumes4h.reduce((a, b) => a + b, 0) / volumes4h.length;
        const variance4h = volumes4h.reduce((a, b) => a + Math.pow(b - mean4h, 2), 0) / volumes4h.length;
        const stdDev4h = Math.sqrt(variance4h);
        const zScore4h = stdDev4h > 0 ? (currentVolume4h - mean4h) / stdDev4h : 0;
        
        const isCrossingUp4h = currentRatio4h >= VOLUME_CROSS_SETTINGS.minVolumeRatio;
        const isCrossingDown4h = currentRatio4h <= (1 / VOLUME_CROSS_SETTINGS.minVolumeRatio);
        
        // 3. Score combinado
        let combinedScore = 0;
        let classification = 'INSUFICIENTE';
        let isCrossingUp = false;
        let isCrossingDown = false;
        
        const score1h = Math.min(1, currentRatio1h - 1);
        const score4h = Math.min(1, currentRatio4h - 1);
        
        combinedScore = (score1h * 0.6 + score4h * 0.4);
        
        // Determinar cruzamento principal
        if (isCrossingUp1h && isCrossingUp4h) {
            isCrossingUp = true;
            classification = 'FORTE ALTA';
            combinedScore += 0.2;
        } else if (isCrossingUp1h || isCrossingUp4h) {
            isCrossingUp = true;
            classification = 'MODERADA ALTA';
        } else if (isCrossingDown1h && isCrossingDown4h) {
            isCrossingDown = true;
            classification = 'FORTE BAIXA';
            combinedScore += 0.2;
        } else if (isCrossingDown1h || isCrossingDown4h) {
            isCrossingDown = true;
            classification = 'MODERADA BAIXA';
        } else {
            classification = 'NEUTRO';
        }
        
        // Ajustar classificação baseado no score
        if (combinedScore >= 0.8) {
            classification = 'MUITO ALTO';
        } else if (combinedScore >= 0.6) {
            classification = 'ALTO';
        } else if (combinedScore >= 0.4) {
            classification = 'MODERADO';
        } else if (combinedScore >= 0.2) {
            classification = 'BAIXO';
        } else {
            classification = 'MUITO BAIXO';
        }
        
        return {
            timeframe1h: {
                currentVolume: currentVolume1h,
                currentEma: currentEma1h,
                currentRatio: currentRatio1h,
                zScore: zScore1h,
                isCrossingUp: isCrossingUp1h,
                isCrossingDown: isCrossingDown1h,
                mean: mean1h,
                stdDev: stdDev1h
            },
            timeframe4h: {
                currentVolume: currentVolume4h,
                currentEma: currentEma4h,
                currentRatio: currentRatio4h,
                zScore: zScore4h,
                isCrossingUp: isCrossingUp4h,
                isCrossingDown: isCrossingDown4h,
                mean: mean4h,
                stdDev: stdDev4h
            },
            combinedScore: combinedScore,
            classification: classification,
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.error(`Erro volume cross ${symbol}:`, error.message);
        return null;
    }
}

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const pivots = [];
        
        // Analisar múltiplos timeframes
        for (const timeframe of PIVOT_POINTS_SETTINGS.analyzeTimeframes) {
            const candles = await getCandlesCached(symbol, timeframe, PIVOT_POINTS_SETTINGS.candlesPerTimeframe[timeframe]);
            
            if (candles.length < PIVOT_POINTS_SETTINGS.detection.windowSize * 2) {
                continue;
            }
            
            // Detectar suportes (higher lows)
            for (let i = PIVOT_POINTS_SETTINGS.detection.windowSize; i < candles.length - PIVOT_POINTS_SETTINGS.detection.windowSize; i++) {
                const windowStart = i - PIVOT_POINTS_SETTINGS.detection.windowSize;
                const windowEnd = i + PIVOT_POINTS_SETTINGS.detection.windowSize;
                
                let isSupport = true;
                let higherLowsCount = 0;
                
                // Verificar se é um mínimo local
                for (let j = windowStart; j <= windowEnd; j++) {
                    if (j === i) continue;
                    if (candles[j].low < candles[i].low) {
                        isSupport = false;
                        break;
                    }
                }
                
                if (isSupport) {
                    // Verificar higher lows
                    for (let j = i - 1; j >= Math.max(0, i - PIVOT_POINTS_SETTINGS.detection.requiredHigherLows); j--) {
                        if (candles[j].low > candles[i].low) {
                            higherLowsCount++;
                        }
                    }
                    
                    if (higherLowsCount >= PIVOT_POINTS_SETTINGS.detection.requiredHigherLows - 1) {
                        const amplitude = (Math.max(...candles.slice(windowStart, windowEnd + 1).map(c => c.high)) - 
                                         Math.min(...candles.slice(windowStart, windowEnd + 1).map(c => c.low))) / candles[i].close;
                        
                        if (amplitude >= PIVOT_POINTS_SETTINGS.detection.minAmplitude) {
                            // Verificar confirmação
                            let confirmed = true;
                            for (let k = 1; k <= PIVOT_POINTS_SETTINGS.detection.confirmationCandles; k++) {
                                if (i + k < candles.length && candles[i + k].low < candles[i].low) {
                                    confirmed = false;
                                    break;
                                }
                            }
                            
                            if (confirmed) {
                                const distancePercent = Math.abs(currentPrice - candles[i].low) / currentPrice * 100;
                                const strength = this.calculatePivotStrength(timeframe, higherLowsCount, distancePercent);
                                
                                pivots.push({
                                    type: 'support',
                                    price: candles[i].low,
                                    timeframe: timeframe,
                                    strength: strength,
                                    distancePercent: distancePercent,
                                    isTesting: Math.abs(currentPrice - candles[i].low) / currentPrice * 100 < PIVOT_POINTS_SETTINGS.priceTolerance * 100,
                                    timestamp: candles[i].timestamp
                                });
                            }
                        }
                    }
                }
            }
            
            // Detectar resistências (lower highs) - similar ao acima
            for (let i = PIVOT_POINTS_SETTINGS.detection.windowSize; i < candles.length - PIVOT_POINTS_SETTINGS.detection.windowSize; i++) {
                const windowStart = i - PIVOT_POINTS_SETTINGS.detection.windowSize;
                const windowEnd = i + PIVOT_POINTS_SETTINGS.detection.windowSize;
                
                let isResistance = true;
                let lowerHighsCount = 0;
                
                // Verificar se é um máximo local
                for (let j = windowStart; j <= windowEnd; j++) {
                    if (j === i) continue;
                    if (candles[j].high > candles[i].high) {
                        isResistance = false;
                        break;
                    }
                }
                
                if (isResistance) {
                    // Verificar lower highs
                    for (let j = i - 1; j >= Math.max(0, i - PIVOT_POINTS_SETTINGS.detection.requiredLowerHighs); j--) {
                        if (candles[j].high < candles[i].high) {
                            lowerHighsCount++;
                        }
                    }
                    
                    if (lowerHighsCount >= PIVOT_POINTS_SETTINGS.detection.requiredLowerHighs - 1) {
                        const amplitude = (Math.max(...candles.slice(windowStart, windowEnd + 1).map(c => c.high)) - 
                                         Math.min(...candles.slice(windowStart, windowEnd + 1).map(c => c.low))) / candles[i].close;
                        
                        if (amplitude >= PIVOT_POINTS_SETTINGS.detection.minAmplitude) {
                            // Verificar confirmação
                            let confirmed = true;
                            for (let k = 1; k <= PIVOT_POINTS_SETTINGS.detection.confirmationCandles; k++) {
                                if (i + k < candles.length && candles[i + k].high > candles[i].high) {
                                    confirmed = false;
                                    break;
                                }
                            }
                            
                            if (confirmed) {
                                const distancePercent = Math.abs(currentPrice - candles[i].high) / currentPrice * 100;
                                const strength = this.calculatePivotStrength(timeframe, lowerHighsCount, distancePercent);
                                
                                pivots.push({
                                    type: 'resistance',
                                    price: candles[i].high,
                                    timeframe: timeframe,
                                    strength: strength,
                                    distancePercent: distancePercent,
                                    isTesting: Math.abs(currentPrice - candles[i].high) / currentPrice * 100 < PIVOT_POINTS_SETTINGS.priceTolerance * 100,
                                    timestamp: candles[i].timestamp
                                });
                            }
                        }
                    }
                }
            }
        }
        
        // Encontrar pivot mais próximo
        let nearestPivot = null;
        let minDistance = Infinity;
        
        for (const pivot of pivots) {
            const distance = Math.abs(currentPrice - pivot.price);
            if (distance < minDistance) {
                minDistance = distance;
                nearestPivot = pivot;
            }
        }
        
        // Filtrar pivots por tipo
        const supports = pivots.filter(p => p.type === 'support');
        const resistances = pivots.filter(p => p.type === 'resistance');
        
        // Ordenar supports do mais alto para o mais baixo
        supports.sort((a, b) => b.price - a.price);
        
        // Ordenar resistances do mais baixo para o mais alto
        resistances.sort((a, b) => a.price - b.price);
        
        return {
            supports: supports,
            resistances: resistances,
            nearestPivot: nearestPivot,
            currentPrice: currentPrice,
            isBullish: isBullish,
            allPivots: pivots
        };
        
    } catch (error) {
        console.error(`Erro análise pivot points ${symbol}:`, error.message);
        return {
            supports: [],
            resistances: [],
            nearestPivot: null,
            currentPrice: currentPrice,
            isBullish: isBullish,
            allPivots: []
        };
    }
}

function calculatePivotStrength(timeframe, touchCount, distancePercent) {
    const timeframeWeight = PIVOT_POINTS_SETTINGS.timeframeStrengthWeights[timeframe] || 1.0;
    let strengthScore = (touchCount * 0.3) + (timeframeWeight * 0.7);
    
    // Ajustar pela distância (pivots mais recentes são mais fortes)
    if (distancePercent < 1.0) strengthScore *= 1.2;
    else if (distancePercent < 2.0) strengthScore *= 1.1;
    else if (distancePercent > 5.0) strengthScore *= 0.8;
    
    if (strengthScore >= 4.0) return 'Muito Forte';
    if (strengthScore >= 3.0) return 'Forte';
    if (strengthScore >= 2.0) return 'Moderado';
    return 'Fraco';
}

async function analyzeSupportResistance(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, SUPPORT_RESISTANCE_SETTINGS.timeframe, SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod);
        
        if (candles.length < SUPPORT_RESISTANCE_SETTINGS.lookbackPeriod) {
            return null;
        }
        
        const supports = [];
        const resistances = [];
        
        // Identificar suportes e resistências
        for (let i = SUPPORT_RESISTANCE_SETTINGS.recentPeriod; i < candles.length - SUPPORT_RESISTANCE_SETTINGS.recentPeriod; i++) {
            // Verificar se é um suporte (mínimo local)
            let isSupport = true;
            for (let j = i - SUPPORT_RESISTANCE_SETTINGS.recentPeriod; j <= i + SUPPORT_RESISTANCE_SETTINGS.recentPeriod; j++) {
                if (j === i) continue;
                if (candles[j].low < candles[i].low) {
                    isSupport = false;
                    break;
                }
            }
            
            if (isSupport) {
                supports.push({
                    price: candles[i].low,
                    strength: 1,
                    timestamp: candles[i].timestamp
                });
            }
            
            // Verificar se é uma resistência (máximo local)
            let isResistance = true;
            for (let j = i - SUPPORT_RESISTANCE_SETTINGS.recentPeriod; j <= i + SUPPORT_RESISTANCE_SETTINGS.recentPeriod; j++) {
                if (j === i) continue;
                if (candles[j].high > candles[i].high) {
                    isResistance = false;
                    break;
                }
            }
            
            if (isResistance) {
                resistances.push({
                    price: candles[i].high,
                    strength: 1,
                    timestamp: candles[i].timestamp
                });
            }
        }
        
        // Consolidar níveis próximos
        const consolidatedSupports = consolidateLevels(supports, SUPPORT_RESISTANCE_SETTINGS.proximityThreshold);
        const consolidatedResistances = consolidateLevels(resistances, SUPPORT_RESISTANCE_SETTINGS.proximityThreshold);
        
        // Encontrar níveis mais próximos
        let nearestSupport = null;
        let nearestResistance = null;
        let minSupportDistance = Infinity;
        let minResistanceDistance = Infinity;
        
        for (const support of consolidatedSupports) {
            if (support.price < currentPrice) {
                const distance = currentPrice - support.price;
                if (distance < minSupportDistance) {
                    minSupportDistance = distance;
                    nearestSupport = {
                        ...support,
                        distance: distance,
                        distancePercent: (distance / currentPrice) * 100
                    };
                }
            }
        }
        
        for (const resistance of consolidatedResistances) {
            if (resistance.price > currentPrice) {
                const distance = resistance.price - currentPrice;
                if (distance < minResistanceDistance) {
                    minResistanceDistance = distance;
                    nearestResistance = {
                        ...resistance,
                        distance: distance,
                        distancePercent: (distance / currentPrice) * 100
                    };
                }
            }
        }
        
        // Analisar risco de rompimento
        const breakoutRisk = analyzeBreakoutRisk(currentPrice, nearestSupport, nearestResistance, isBullish);
        
        return {
            supports: consolidatedSupports,
            resistances: consolidatedResistances,
            nearestSupport: nearestSupport,
            nearestResistance: nearestResistance,
            breakoutRisk: breakoutRisk,
            currentPrice: currentPrice
        };
        
    } catch (error) {
        console.error(`Erro análise S/R ${symbol}:`, error.message);
        return null;
    }
}

function consolidateLevels(levels, thresholdPercent) {
    if (levels.length === 0) return [];
    
    const sortedLevels = levels.sort((a, b) => a.price - b.price);
    const consolidated = [];
    
    let currentGroup = [sortedLevels[0]];
    
    for (let i = 1; i < sortedLevels.length; i++) {
        const lastPrice = currentGroup[currentGroup.length - 1].price;
        const currentPrice = sortedLevels[i].price;
        const priceDiffPercent = Math.abs(currentPrice - lastPrice) / lastPrice * 100;
        
        if (priceDiffPercent <= thresholdPercent) {
            currentGroup.push(sortedLevels[i]);
        } else {
            // Calcular preço médio do grupo
            const avgPrice = currentGroup.reduce((sum, level) => sum + level.price, 0) / currentGroup.length;
            const maxStrength = Math.max(...currentGroup.map(level => level.strength));
            
            consolidated.push({
                price: avgPrice,
                strength: maxStrength + (currentGroup.length > 1 ? 1 : 0),
                touchCount: currentGroup.length,
                originalLevels: currentGroup.length
            });
            
            currentGroup = [sortedLevels[i]];
        }
    }
    
    // Adicionar último grupo
    if (currentGroup.length > 0) {
        const avgPrice = currentGroup.reduce((sum, level) => sum + level.price, 0) / currentGroup.length;
        const maxStrength = Math.max(...currentGroup.map(level => level.strength));
        
        consolidated.push({
            price: avgPrice,
            strength: maxStrength + (currentGroup.length > 1 ? 1 : 0),
            touchCount: currentGroup.length,
            originalLevels: currentGroup.length
        });
    }
    
    return consolidated;
}

function analyzeBreakoutRisk(currentPrice, nearestSupport, nearestResistance, isBullish) {
    if (!nearestSupport && !nearestResistance) {
        return {
            level: 'unknown',
            reason: 'Sem níveis de suporte/resistência identificados',
            distance: null
        };
    }
    
    let riskLevel = 'low';
    let reason = '';
    let distance = null;
    
    if (isBullish) {
        // Para compra, olhamos resistência acima
        if (nearestResistance) {
            distance = nearestResistance.distancePercent;
            
            if (distance < BREAKOUT_RISK_SETTINGS.highRiskDistance) {
                riskLevel = 'high';
                reason = `Muito próximo da resistência (${distance.toFixed(2)}%)`;
            } else if (distance < BREAKOUT_RISK_SETTINGS.mediumRiskDistance) {
                riskLevel = 'medium';
                reason = `Próximo da resistência (${distance.toFixed(2)}%)`;
            } else if (distance < BREAKOUT_RISK_SETTINGS.lowRiskDistance) {
                riskLevel = 'low';
                reason = `Distância moderada da resistência (${distance.toFixed(2)}%)`;
            } else {
                riskLevel = 'very_low';
                reason = `Boa distância da resistência (${distance.toFixed(2)}%)`;
            }
        } else {
            riskLevel = 'low';
            reason = 'Sem resistência próxima identificada';
        }
    } else {
        // Para venda, olhamos suporte abaixo
        if (nearestSupport) {
            distance = nearestSupport.distancePercent;
            
            if (distance < BREAKOUT_RISK_SETTINGS.highRiskDistance) {
                riskLevel = 'high';
                reason = `Muito próximo do suporte (${distance.toFixed(2)}%)`;
            } else if (distance < BREAKOUT_RISK_SETTINGS.mediumRiskDistance) {
                riskLevel = 'medium';
                reason = `Próximo do suporte (${distance.toFixed(2)}%)`;
            } else if (distance < BREAKOUT_RISK_SETTINGS.lowRiskDistance) {
                riskLevel = 'low';
                reason = `Distância moderada do suporte (${distance.toFixed(2)}%)`;
            } else {
                riskLevel = 'very_low';
                reason = `Boa distância do suporte (${distance.toFixed(2)}%)`;
            }
        } else {
            riskLevel = 'low';
            reason = 'Sem suporte próximo identificado';
        }
    }
    
    return {
        level: riskLevel,
        reason: reason,
        distance: distance,
        isBullish: isBullish
    };
}

async function getATRData(symbol, timeframe, period) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 20);
        
        if (candles.length < period + 1) {
            return null;
        }
        
        const atrValues = ATR.calculate({
            high: candles.map(c => c.high),
            low: candles.map(c => c.low),
            close: candles.map(c => c.close),
            period: period
        });
        
        const currentATR = atrValues[atrValues.length - 1];
        const currentPrice = candles[candles.length - 1].close;
        const atrPercentage = (currentATR / currentPrice) * 100;
        
        return {
            value: currentATR,
            percentage: atrPercentage,
            normalized: atrPercentage / 100,
            period: period
        };
        
    } catch (error) {
        console.error(`Erro ATR ${symbol}:`, error.message);
        return null;
    }
}

async function calculateDynamicStopLoss(currentPrice, isBullish, symbol) {
    try {
        const atrData = await getATRData(symbol, ATR_TIMEFRAME, ATR_PERIOD);
        
        if (!atrData) {
            // Fallback para stop fixo se ATR não disponível
            const baseStopPercent = isBullish ? 2.5 : 2.5;
            const stopPrice = isBullish ? 
                currentPrice * (1 - baseStopPercent / 100) : 
                currentPrice * (1 + baseStopPercent / 100);
            
            return {
                price: stopPrice,
                percentage: baseStopPercent,
                type: 'fixed_fallback',
                atrData: null
            };
        }
        
        const atrMultiplier = DYNAMIC_STOP_SETTINGS.baseATRMultiplier;
        const atrBasedStop = atrData.value * atrMultiplier;
        
        const minStopPrice = currentPrice * (1 - DYNAMIC_STOP_SETTINGS.minStopPercentage / 100);
        const maxStopPrice = currentPrice * (1 - DYNAMIC_STOP_SETTINGS.maxStopPercentage / 100);
        
        let stopPrice;
        if (isBullish) {
            stopPrice = currentPrice - atrBasedStop;
            stopPrice = Math.max(stopPrice, minStopPrice);
            stopPrice = Math.min(stopPrice, maxStopPrice);
        } else {
            stopPrice = currentPrice + atrBasedStop;
            stopPrice = Math.min(stopPrice, currentPrice * (1 + DYNAMIC_STOP_SETTINGS.minStopPercentage / 100));
            stopPrice = Math.max(stopPrice, currentPrice * (1 + DYNAMIC_STOP_SETTINGS.maxStopPercentage / 100));
        }
        
        const stopPercentage = Math.abs((stopPrice - currentPrice) / currentPrice * 100);
        
        return {
            price: stopPrice,
            percentage: stopPercentage,
            type: 'dynamic_atr',
            atrData: atrData,
            atrMultiplier: atrMultiplier
        };
        
    } catch (error) {
        console.error(`Erro cálculo stop loss ${symbol}:`, error.message);
        
        // Fallback final
        const baseStopPercent = isBullish ? 2.5 : 2.5;
        const stopPrice = isBullish ? 
            currentPrice * (1 - baseStopPercent / 100) : 
            currentPrice * (1 + baseStopPercent / 100);
        
        return {
            price: stopPrice,
            percentage: baseStopPercent,
            type: 'emergency_fallback',
            atrData: null
        };
    }
}

async function calculateDynamicRetracements(currentPrice, isBullish, symbol) {
    try {
        const atrData = await getATRData(symbol, ATR_TIMEFRAME, ATR_PERIOD);
        
        if (!atrData) {
            // Fallback para retrações fixas
            const minRetracement = currentPrice * (1 - (isBullish ? RETRACEMENT_SETTINGS.maxPercentage : RETRACEMENT_SETTINGS.minPercentage) / 100);
            const maxRetracement = currentPrice * (1 - (isBullish ? RETRACEMENT_SETTINGS.minPercentage : RETRACEMENT_SETTINGS.maxPercentage) / 100);
            
            return {
                minRetracementPrice: isBullish ? minRetracement : maxRetracement,
                maxRetracementPrice: isBullish ? maxRetracement : minRetracement,
                minPercentage: isBullish ? RETRACEMENT_SETTINGS.maxPercentage : RETRACEMENT_SETTINGS.minPercentage,
                maxPercentage: isBullish ? RETRACEMENT_SETTINGS.minPercentage : RETRACEMENT_SETTINGS.maxPercentage,
                type: 'fixed_fallback',
                atrData: null
            };
        }
        
        // Usar ATR para calcular retrações dinâmicas
        const volatilityFactor = atrData.normalized;
        let atrMultiplierMin = RETRACEMENT_SETTINGS.atrMultiplierMin;
        let atrMultiplierMax = RETRACEMENT_SETTINGS.atrMultiplierMax;
        
        // Ajustar baseado na volatilidade
        if (volatilityFactor > 0.03) { // Alta volatilidade
            atrMultiplierMin *= RETRACEMENT_SETTINGS.volatilityAdjustment.high;
            atrMultiplierMax *= RETRACEMENT_SETTINGS.volatilityAdjustment.high;
        } else if (volatilityFactor > 0.015) { // Volatilidade média
            atrMultiplierMin *= RETRACEMENT_SETTINGS.volatilityAdjustment.medium;
            atrMultiplierMax *= RETRACEMENT_SETTINGS.volatilityAdjustment.medium;
        } else { // Baixa volatilidade
            atrMultiplierMin *= RETRACEMENT_SETTINGS.volatilityAdjustment.low;
            atrMultiplierMax *= RETRACEMENT_SETTINGS.volatilityAdjustment.low;
        }
        
        const minRetracementATR = atrData.value * atrMultiplierMin;
        const maxRetracementATR = atrData.value * atrMultiplierMax;
        
        let minRetracementPrice, maxRetracementPrice;
        
        if (isBullish) {
            minRetracementPrice = currentPrice - maxRetracementATR;
            maxRetracementPrice = currentPrice - minRetracementATR;
        } else {
            minRetracementPrice = currentPrice + minRetracementATR;
            maxRetracementPrice = currentPrice + maxRetracementATR;
        }
        
        // Garantir que as retrações são válidas
        if (isBullish) {
            minRetracementPrice = Math.max(minRetracementPrice, currentPrice * (1 - RETRACEMENT_SETTINGS.maxPercentage));
            maxRetracementPrice = Math.min(maxRetracementPrice, currentPrice * (1 - RETRACEMENT_SETTINGS.minPercentage));
        } else {
            minRetracementPrice = Math.min(minRetracementPrice, currentPrice * (1 + RETRACEMENT_SETTINGS.minPercentage));
            maxRetracementPrice = Math.max(maxRetracementPrice, currentPrice * (1 + RETRACEMENT_SETTINGS.maxPercentage));
        }
        
        const minPercentage = Math.abs((minRetracementPrice - currentPrice) / currentPrice * 100);
        const maxPercentage = Math.abs((maxRetracementPrice - currentPrice) / currentPrice * 100);
        
        return {
            minRetracementPrice: minRetracementPrice,
            maxRetracementPrice: maxRetracementPrice,
            minPercentage: minPercentage,
            maxPercentage: maxPercentage,
            type: 'dynamic_atr',
            atrData: atrData,
            atrMultipliers: {
                min: atrMultiplierMin,
                max: atrMultiplierMax
            }
        };
        
    } catch (error) {
        console.error(`Erro cálculo retracements ${symbol}:`, error.message);
        
        // Fallback final
        const minRetracement = currentPrice * (1 - (isBullish ? RETRACEMENT_SETTINGS.maxPercentage : RETRACEMENT_SETTINGS.minPercentage) / 100);
        const maxRetracement = currentPrice * (1 - (isBullish ? RETRACEMENT_SETTINGS.minPercentage : RETRACEMENT_SETTINGS.maxPercentage) / 100);
        
        return {
            minRetracementPrice: isBullish ? minRetracement : maxRetracement,
            maxRetracementPrice: isBullish ? maxRetracement : minRetracement,
            minPercentage: isBullish ? RETRACEMENT_SETTINGS.maxPercentage : RETRACEMENT_SETTINGS.minPercentage,
            maxPercentage: isBullish ? RETRACEMENT_SETTINGS.minPercentage : RETRACEMENT_SETTINGS.maxPercentage,
            type: 'emergency_fallback',
            atrData: null
        };
    }
}

async function calculateAdvancedTargetsAndStop(currentPrice, isBullish, symbol) {
    try {
        // Calcular stop loss dinâmico
        const stopLossData = await calculateDynamicStopLoss(currentPrice, isBullish, symbol);
        
        // Calcular retrações dinâmicas para entrada
        const retracementData = await calculateDynamicRetracements(currentPrice, isBullish, symbol);
        
        // Calcular alvos baseados no risco (R:R)
        const stopDistance = Math.abs(currentPrice - stopLossData.price);
        const targets = [];
        
        for (const targetPercent of TARGET_PERCENTAGES) {
            const targetPrice = isBullish ? 
                currentPrice * (1 + targetPercent / 100) : 
                currentPrice * (1 - targetPercent / 100);
            
            const profitDistance = Math.abs(targetPrice - currentPrice);
            const riskRewardRatio = profitDistance / stopDistance;
            
            targets.push({
                target: targetPercent,
                price: targetPrice.toFixed(8),
                riskReward: riskRewardRatio.toFixed(2),
                distancePercent: targetPercent
            });
        }
        
        return {
            stopPrice: stopLossData.price,
            stopPercentage: stopLossData.percentage,
            stopType: stopLossData.type,
            retracementData: retracementData,
            targets: targets,
            currentPrice: currentPrice,
            isBullish: isBullish
        };
        
    } catch (error) {
        console.error(`Erro cálculo targets/stop ${symbol}:`, error.message);
        
        // Fallback básico
        const stopPercentage = isBullish ? 2.5 : 2.5;
        const stopPrice = isBullish ? 
            currentPrice * (1 - stopPercentage / 100) : 
            currentPrice * (1 + stopPercentage / 100);
        
        const targets = TARGET_PERCENTAGES.map(percent => ({
            target: percent,
            price: isBullish ? 
                (currentPrice * (1 + percent / 100)).toFixed(8) : 
                (currentPrice * (1 - percent / 100)).toFixed(8),
            riskReward: (percent / stopPercentage).toFixed(2),
            distancePercent: percent
        }));
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopPercentage,
            stopType: 'fallback_fixed',
            retracementData: {
                minRetracementPrice: isBullish ? 
                    currentPrice * (1 - 0.5 / 100) : 
                    currentPrice * (1 + 0.25 / 100),
                maxRetracementPrice: isBullish ? 
                    currentPrice * (1 - 0.25 / 100) : 
                    currentPrice * (1 + 0.5 / 100),
                minPercentage: isBullish ? 0.5 : 0.25,
                maxPercentage: isBullish ? 0.25 : 0.5,
                type: 'fallback_fixed'
            },
            targets: targets,
            currentPrice: currentPrice,
            isBullish: isBullish
        };
    }
}

async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        const message = `
🤖 <b>TITANIUM BOT REINICIADO</b>
✅ Sistema inicializado com sucesso
📅 Data: ${now.date}
⏰ Hora: ${now.time}
🎯 Configurações:
• Gatilho único: Volume 1h/4h
• Filtros: Liquidez, Whale Activity, BTC Correlation
• Risk Layer: Ativado
• Pivot Points: Multi-timeframe

✨Titanium by @J4Rviz✨
        `;
        
        await sendTelegramAlert(message);
        console.log('✅ Mensagem de inicialização enviada');
    } catch (error) {
        console.error('Erro ao enviar mensagem de inicialização:', error.message);
    }
}

async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando símbolos de futuros...');
        
        const response = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );
        
        if (!response || !response.symbols) {
            throw new Error('Resposta inválida da Binance');
        }
        
        const futuresSymbols = response.symbols
            .filter(symbol => 
                symbol.contractType === 'PERPETUAL' && 
                symbol.status === 'TRADING' &&
                symbol.symbol.endsWith('USDT')
            )
            .map(symbol => symbol.symbol);
        
        console.log(`✅ ${futuresSymbols.length} símbolos de futuros encontrados`);
        
        return futuresSymbols;
        
    } catch (error) {
        console.error('❌ Erro ao buscar símbolos:', error.message);
        
        // Lista fallback em caso de erro
        const fallbackSymbols = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'DOGEUSDT', 'MATICUSDT',
            'LINKUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'ETCUSDT'
        ];
        
        console.log(`⚠️ Usando lista fallback: ${fallbackSymbols.length} símbolos`);
        return fallbackSymbols;
    }
}

async function getCandlesCached(symbol, interval, limit) {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const now = Date.now();
    
    // Verificar cache
    if (candleCache[cacheKey] && (now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL)) {
        return candleCache[cacheKey].data;
    }
    
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await rateLimiter.makeRequest(url, {}, 'klines');
        
        if (!response || !Array.isArray(response)) {
            throw new Error('Resposta inválida');
        }
        
        const candles = response.map(candle => ({
            timestamp: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            closeTime: candle[6],
            quoteVolume: parseFloat(candle[7]),
            trades: candle[8],
            takerBuyBaseVolume: parseFloat(candle[9]),
            takerBuyQuoteVolume: parseFloat(candle[10])
        }));
        
        // Atualizar cache
        candleCache[cacheKey] = {
            data: candles,
            timestamp: now
        };
        
        return candles;
        
    } catch (error) {
        console.error(`❌ Erro candles ${symbol} ${interval}:`, error.message);
        
        // Tentar retornar do cache mesmo se expirado
        if (candleCache[cacheKey] && (now - candleCache[cacheKey].timestamp < MAX_CACHE_AGE)) {
            console.log(`⚠️ Usando cache expirado para ${symbol} ${interval}`);
            return candleCache[cacheKey].data;
        }
        
        throw error;
    }
}

async function getCurrentPrice(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;
        const response = await rateLimiter.makeRequest(url, {}, 'ticker24hr');
        
        if (!response || !response.price) {
            throw new Error('Preço não disponível');
        }
        
        return parseFloat(response.price);
        
    } catch (error) {
        console.error(`❌ Erro preço ${symbol}:`, error.message);
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 100);
        
        if (candles.length < 14) {
            return null;
        }
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({
            values: closes,
            period: 14
        });
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        let status = 'NEUTRO';
        if (currentRSI > 70) status = 'SOBREVENDIDO';
        else if (currentRSI > 60) status = 'ALTO';
        else if (currentRSI < 30) status = 'SOBRECOMPRADO';
        else if (currentRSI < 40) status = 'BAIXO';
        
        return {
            value: currentRSI,
            status: status,
            isOverbought: currentRSI > 70,
            isOversold: currentRSI < 30,
            rawValues: rsiValues.slice(-5)
        };
        
    } catch (error) {
        console.error(`❌ Erro RSI ${symbol}:`, error.message);
        return null;
    }
}

async function checkVolatility(symbol) {
    try {
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 10);
        
        if (candles.length < VOLATILITY_PERIOD) {
            return { isValid: false, volatility: 0, status: 'INSUFICIENT_DATA' };
        }
        
        const closes = candles.slice(-VOLATILITY_PERIOD).map(c => c.close);
        let sumReturns = 0;
        
        for (let i = 1; i < closes.length; i++) {
            const returnVal = Math.abs((closes[i] - closes[i - 1]) / closes[i - 1]);
            sumReturns += returnVal;
        }
        
        const avgReturn = sumReturns / (closes.length - 1);
        const volatility = avgReturn * 100; // Em porcentagem
        
        const isValid = volatility <= VOLATILITY_THRESHOLD;
        
        let status = 'NORMAL';
        if (volatility > VOLATILITY_THRESHOLD * 1.5) status = 'MUITO ALTA';
        else if (volatility > VOLATILITY_THRESHOLD) status = 'ALTA';
        else if (volatility < VOLATILITY_THRESHOLD * 0.5) status = 'MUITO BAIXA';
        else if (volatility < VOLATILITY_THRESHOLD) status = 'BAIXA';
        
        return {
            isValid: isValid,
            volatility: volatility,
            status: status,
            raw: avgReturn
        };
        
    } catch (error) {
        console.error(`❌ Erro volatilidade ${symbol}:`, error.message);
        return { isValid: false, volatility: 0, status: 'ERROR' };
    }
}

async function checkLSR(symbol, isBullish) {
    try {
        const lsrData = await getBinanceLSRValue(symbol);
        
        if (!lsrData.lsrValue) {
            return { isValid: false, lsrRatio: 0, status: 'NO_DATA' };
        }
        
        const lsrRatio = lsrData.lsrValue;
        
        let isValid = false;
        if (isBullish) {
            isValid = lsrRatio <= LSR_BUY_THRESHOLD;
        } else {
            isValid = lsrRatio >= LSR_SELL_THRESHOLD;
        }
        
        let status = 'NEUTRO';
        if (lsrRatio < 2.0) status = 'MUITO BAIXO';
        else if (lsrRatio < 2.5) status = 'BAIXO';
        else if (lsrRatio > 4.0) status = 'MUITO ALTO';
        else if (lsrRatio > 3.0) status = 'ALTO';
        
        return {
            isValid: isValid,
            lsrRatio: lsrRatio,
            status: status,
            binanceLSR: lsrData,
            percentChange: lsrData.percentChange,
            isRising: lsrData.isRising
        };
        
    } catch (error) {
        console.error(`❌ Erro LSR ${symbol}:`, error.message);
        return { isValid: false, lsrRatio: 0, status: 'ERROR' };
    }
}

async function checkOpenInterest(symbol, isBullish) {
    try {
        const cacheKey = `${symbol}_oi`;
        const now = Date.now();
        
        // Verificar cache
        if (oiCache[cacheKey] && (now - oiCache[cacheKey].timestamp < OI_CACHE_TTL)) {
            return oiCache[cacheKey].data;
        }
        
        const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const response = await rateLimiter.makeRequest(url, {}, 'openInterest');
        
        if (!response || !response.openInterest) {
            throw new Error('Dados OI não disponíveis');
        }
        
        const currentOI = parseFloat(response.openInterest);
        
        // Buscar histórico para tendência
        const historyUrl = `https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=5m&limit=${OI_HISTORY_SIZE}`;
        const historyResponse = await rateLimiter.makeRequest(historyUrl, {}, 'openInterest');
        
        let oiChange = 0;
        let oiTrend = 'NEUTRO';
        
        if (historyResponse && historyResponse.length >= 2) {
            const previousOI = parseFloat(historyResponse[0].sumOpenInterest);
            if (previousOI > 0) {
                oiChange = ((currentOI - previousOI) / previousOI) * 100;
                
                if (oiChange > 5) oiTrend = 'FORTE ALTA';
                else if (oiChange > 2) oiTrend = 'ALTA';
                else if (oiChange < -5) oiTrend = 'FORTE BAIXA';
                else if (oiChange < -2) oiTrend = 'BAIXA';
            }
        }
        
        // Para compra: OI em alta é bom (nova liquidez entrando)
        // Para venda: OI em alta pode ser ruim (novas posições long)
        let isValid = true;
        if (isBullish) {
            isValid = oiChange > -10; // Permitir leve queda
        } else {
            isValid = oiChange < 10; // Permitir leve alta
        }
        
        const result = {
            isValid: isValid,
            currentOI: currentOI,
            oiChange: oiChange,
            oiTrend: oiTrend,
            isIncreasing: oiChange > 0,
            isDecreasing: oiChange < 0
        };
        
        // Atualizar cache
        oiCache[cacheKey] = {
            data: result,
            timestamp: now
        };
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro OI ${symbol}:`, error.message);
        return { isValid: true, currentOI: 0, oiChange: 0, oiTrend: 'ERROR' };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const response = await rateLimiter.makeRequest(url, {}, 'fundingRate');
        
        if (!response || response.lastFundingRate === undefined) {
            throw new Error('Funding rate não disponível');
        }
        
        const fundingRate = parseFloat(response.lastFundingRate);
        const nextFundingTime = response.nextFundingTime;
        
        let status = 'NEUTRO';
        if (fundingRate <= -0.002) status = 'MUITO NEGATIVO';
        else if (fundingRate <= -0.001) status = 'NEGATIVO';
        else if (fundingRate >= 0.001) status = 'POSITIVO';
        else if (fundingRate >= 0.002) status = 'MUITO POSITIVO';
        
        // Para compra: funding negativo é bom (pagam para você manter posição)
        // Para venda: funding positivo é bom (pagam para você manter posição)
        let isValid = true;
        if (isBullish) {
            isValid = fundingRate <= 0.001; // Levemente positivo ok
        } else {
            isValid = fundingRate >= -0.001; // Levemente negativo ok
        }
        
        return {
            isValid: isValid,
            raw: fundingRate,
            percentage: fundingRate * 100,
            status: status,
            nextFundingTime: nextFundingTime,
            isPositive: fundingRate > 0,
            isNegative: fundingRate < 0
        };
        
    } catch (error) {
        console.error(`❌ Erro funding rate ${symbol}:`, error.message);
        return { isValid: true, raw: 0, percentage: 0, status: 'ERROR' };
    }
}

async function calculateSignalQuality(symbol, isBullish, marketData) {
    try {
        let totalScore = 0;
        let maxPossibleScore = 0;
        const details = {};
        
        // 1. Volume Trigger (GATILHO ÚNICO - PESO PRINCIPAL)
        const volumeData = marketData.volumeCross;
        let volumeScore = 0;
        if (volumeData) {
            const combinedScore = volumeData.combinedScore || 0;
            const classification = volumeData.classification || '';
            
            // Score baseado no combinedScore
            if (combinedScore >= 0.8) volumeScore = 100;
            else if (combinedScore >= 0.6) volumeScore = 80;
            else if (combinedScore >= 0.4) volumeScore = 60;
            else if (combinedScore >= 0.2) volumeScore = 40;
            else volumeScore = 20;
            
            // Bônus por classificação
            if (classification.includes('MUITO ALTO')) volumeScore += 15;
            else if (classification.includes('ALTO')) volumeScore += 10;
            else if (classification.includes('MODERADO')) volumeScore += 5;
            
            // Bônus por cruzamento confirmado
            if ((isBullish && volumeData.isCrossingUp) || (!isBullish && volumeData.isCrossingDown)) {
                volumeScore += 10;
            }
            
            volumeScore = Math.min(100, volumeScore);
        }
        
        details.volume = volumeScore;
        totalScore += volumeScore * (QUALITY_WEIGHTS.volumeTrigger / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.volumeTrigger / 100);
        
        // 2. Open Interest
        const oiData = marketData.oi;
        let oiScore = 50; // Neutro
        
        if (oiData) {
            if (isBullish) {
                if (oiData.oiChange > 5) oiScore = 80;
                else if (oiData.oiChange > 2) oiScore = 70;
                else if (oiData.oiChange > -2) oiScore = 60;
                else if (oiData.oiChange > -5) oiScore = 40;
                else oiScore = 30;
            } else {
                if (oiData.oiChange < -5) oiScore = 80;
                else if (oiData.oiChange < -2) oiScore = 70;
                else if (oiData.oiChange < 2) oiScore = 60;
                else if (oiData.oiChange < 5) oiScore = 40;
                else oiScore = 30;
            }
        }
        
        details.oi = oiScore;
        totalScore += oiScore * (QUALITY_WEIGHTS.oi / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.oi / 100);
        
        // 3. Volatilidade
        const volatilityData = marketData.volatility;
        let volatilityScore = 50;
        
        if (volatilityData) {
            if (volatilityData.status === 'NORMAL') volatilityScore = 70;
            else if (volatilityData.status === 'BAIXA') volatilityScore = 80;
            else if (volatilityData.status === 'MUITO BAIXA') volatilityScore = 90;
            else if (volatilityData.status === 'ALTA') volatilityScore = 30;
            else if (volatilityData.status === 'MUITO ALTA') volatilityScore = 10;
        }
        
        details.volatility = volatilityScore;
        totalScore += volatilityScore * (QUALITY_WEIGHTS.volatility / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.volatility / 100);
        
        // 4. LSR
        const lsrData = marketData.lsr;
        let lsrScore = 50;
        
        if (lsrData) {
            const lsrRatio = lsrData.lsrRatio;
            
            if (isBullish) {
                if (lsrRatio < 2.0) lsrScore = 90;
                else if (lsrRatio < 2.5) lsrScore = 80;
                else if (lsrRatio < 3.0) lsrScore = 70;
                else if (lsrRatio < 3.5) lsrScore = 40;
                else lsrScore = 20;
            } else {
                if (lsrRatio > 4.0) lsrScore = 90;
                else if (lsrRatio > 3.5) lsrScore = 80;
                else if (lsrRatio > 3.0) lsrScore = 70;
                else if (lsrRatio > 2.5) lsrScore = 40;
                else lsrScore = 20;
            }
            
            // Bônus por tendência
            if ((isBullish && lsrData.isRising) || (!isBullish && !lsrData.isRising)) {
                lsrScore += 5;
            }
        }
        
        details.lsr = lsrScore;
        totalScore += lsrScore * (QUALITY_WEIGHTS.lsr / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.lsr / 100);
        
        // 5. RSI
        const rsiData = marketData.rsi;
        let rsiScore = 50;
        
        if (rsiData) {
            const rsiValue = rsiData.value;
            
            if (isBullish) {
                if (rsiValue < 30) rsiScore = 90;
                else if (rsiValue < 40) rsiScore = 80;
                else if (rsiValue < 50) rsiScore = 70;
                else if (rsiValue < 60) rsiScore = 50;
                else if (rsiValue < 70) rsiScore = 30;
                else rsiScore = 10;
            } else {
                if (rsiValue > 70) rsiScore = 90;
                else if (rsiValue > 60) rsiScore = 80;
                else if (rsiValue > 50) rsiScore = 70;
                else if (rsiValue > 40) rsiScore = 50;
                else if (rsiValue > 30) rsiScore = 30;
                else rsiScore = 10;
            }
        }
        
        details.rsi = rsiScore;
        totalScore += rsiScore * (QUALITY_WEIGHTS.rsi / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.rsi / 100);
        
        // 6. Funding Rate
        const fundingData = marketData.funding;
        let fundingScore = 50;
        
        if (fundingData) {
            if (isBullish) {
                if (fundingData.raw <= -0.002) fundingScore = 90;
                else if (fundingData.raw <= -0.001) fundingScore = 80;
                else if (fundingData.raw <= 0) fundingScore = 70;
                else if (fundingData.raw <= 0.001) fundingScore = 50;
                else fundingScore = 30;
            } else {
                if (fundingData.raw >= 0.002) fundingScore = 90;
                else if (fundingData.raw >= 0.001) fundingScore = 80;
                else if (fundingData.raw >= 0) fundingScore = 70;
                else if (fundingData.raw >= -0.001) fundingScore = 50;
                else fundingScore = 30;
            }
        }
        
        details.funding = fundingScore;
        totalScore += fundingScore * (QUALITY_WEIGHTS.funding / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.funding / 100);
        
        // 7. Support/Resistance
        const srData = marketData.supportResistance;
        let srScore = 50;
        
        if (srData) {
            const breakoutRisk = srData.breakoutRisk;
            
            if (breakoutRisk) {
                switch (breakoutRisk.level) {
                    case 'very_low': srScore = 90; break;
                    case 'low': srScore = 80; break;
                    case 'medium': srScore = 60; break;
                    case 'high': srScore = 30; break;
                    default: srScore = 50;
                }
            }
        }
        
        details.supportResistance = srScore;
        totalScore += srScore * (QUALITY_WEIGHTS.supportResistance / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.supportResistance / 100);
        
        // 8. Pivot Points
        const pivotData = marketData.pivotPoints;
        let pivotScore = 50;
        
        if (pivotData && pivotData.nearestPivot) {
            const pivot = pivotData.nearestPivot;
            const distance = pivot.distancePercent;
            
            if (distance > 2.0) {
                pivotScore = 80;
            } else if (distance > 1.0) {
                pivotScore = 70;
            } else if (distance > 0.5) {
                pivotScore = 50;
            } else {
                pivotScore = 30;
            }
            
            // Penalizar se testando pivot
            if (pivot.isTesting) {
                pivotScore *= 0.7;
            }
            
            // Ajustar pela força do pivot
            if (pivot.strength === 'Muito Forte') {
                pivotScore *= 0.8;
            } else if (pivot.strength === 'Forte') {
                pivotScore *= 0.9;
            }
        }
        
        details.pivotPoints = pivotScore;
        totalScore += pivotScore * (QUALITY_WEIGHTS.pivotPoints / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.pivotPoints / 100);
        
        // 9. Breakout Risk
        const breakoutRiskData = marketData.breakoutRisk;
        let breakoutRiskScore = 50;
        
        if (breakoutRiskData) {
            switch (breakoutRiskData.level) {
                case 'very_low': breakoutRiskScore = 90; break;
                case 'low': breakoutRiskScore = 80; break;
                case 'medium': breakoutRiskScore = 60; break;
                case 'high': breakoutRiskScore = 30; break;
                default: breakoutRiskScore = 50;
            }
        }
        
        details.breakoutRisk = breakoutRiskScore;
        totalScore += breakoutRiskScore * (QUALITY_WEIGHTS.breakoutRisk / 100);
        maxPossibleScore += 100 * (QUALITY_WEIGHTS.breakoutRisk / 100);
        
        // Calcular score final
        const finalScore = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
        const normalizedScore = Math.round(finalScore);
        
        // Determinar grade
        let grade = 'F';
        if (normalizedScore >= 90) grade = 'A+';
        else if (normalizedScore >= 85) grade = 'A';
        else if (normalizedScore >= 80) grade = 'A-';
        else if (normalizedScore >= 75) grade = 'B+';
        else if (normalizedScore >= 70) grade = 'B';
        else if (normalizedScore >= 65) grade = 'B-';
        else if (normalizedScore >= 60) grade = 'C+';
        else if (normalizedScore >= 55) grade = 'C';
        else if (normalizedScore >= 50) grade = 'C-';
        else if (normalizedScore >= 45) grade = 'D+';
        else if (normalizedScore >= 40) grade = 'D';
        else grade = 'F';
        
        // Verificar se tem gatilho de volume (requisito obrigatório)
        const hasVolumeTrigger = volumeData && 
            ((isBullish && volumeData.isCrossingUp) || (!isBullish && volumeData.isCrossingDown)) &&
            volumeData.combinedScore >= VOLUME_MINIMUM_THRESHOLDS.combinedScore;
        
        // Verificar se é aceitável
        const isAcceptable = normalizedScore >= QUALITY_THRESHOLD && hasVolumeTrigger;
        
        return {
            score: normalizedScore,
            grade: grade,
            details: details,
            hasVolumeTrigger: hasVolumeTrigger,
            isAcceptable: isAcceptable,
            totalScore: totalScore,
            maxPossibleScore: maxPossibleScore,
            weightedScores: details
        };
        
    } catch (error) {
        console.error(`Erro cálculo qualidade ${symbol}:`, error.message);
        return {
            score: 0,
            grade: 'F',
            details: {},
            hasVolumeTrigger: false,
            isAcceptable: false,
            totalScore: 0,
            maxPossibleScore: 0,
            weightedScores: {}
        };
    }
}

class AdaptiveSymbolGroupManager {
    constructor() {
        this.symbolGroups = [];
        this.currentGroupIndex = 0;
        this.lastGroupRotation = Date.now();
        this.groupRotationInterval = 5 * 60 * 1000; // 5 minutos
        this.symbolsPerGroup = 8;
        this.totalGroups = 0;
        this.cooldownMap = new Map();
        this.lastSignalTime = new Map();
        this.symbolSignals = new Map();
        this.processingSymbols = new Set();
    }

    initialize(symbols) {
        // Embaralhar símbolos para distribuição aleatória
        const shuffledSymbols = [...symbols].sort(() => Math.random() - 0.5);
        
        // Criar grupos
        for (let i = 0; i < shuffledSymbols.length; i += this.symbolsPerGroup) {
            const group = shuffledSymbols.slice(i, i + this.symbolsPerGroup);
            if (group.length > 0) {
                this.symbolGroups.push(group);
            }
        }
        
        this.totalGroups = this.symbolGroups.length;
        
        console.log(`📊 Gerenciador de grupos: ${this.totalGroups} grupos criados`);
        console.log(`   Símbolos por grupo: ${this.symbolsPerGroup}`);
        console.log(`   Total símbolos: ${symbols.length}`);
        
        return this.totalGroups;
    }

    getCurrentGroup() {
        return this.symbolGroups[this.currentGroupIndex] || [];
    }

    rotateGroup() {
        const now = Date.now();
        
        if (now - this.lastGroupRotation >= this.groupRotationInterval) {
            this.currentGroupIndex = (this.currentGroupIndex + 1) % this.totalGroups;
            this.lastGroupRotation = now;
            
            console.log(`🔄 Rotação de grupo: ${this.currentGroupIndex + 1}/${this.totalGroups}`);
            console.log(`   Próximo grupo: ${this.getCurrentGroup().length} símbolos`);
            
            return true;
        }
        
        return false;
    }

    isInCooldown(symbol, direction) {
        const key = `${symbol}_${direction ? 'BULL' : 'BEAR'}`;
        const cooldownEnd = this.cooldownMap.get(key);
        
        if (cooldownEnd && Date.now() < cooldownEnd) {
            return true;
        }
        
        return false;
    }

    setCooldown(symbol, direction, signalType = 'same') {
        let cooldownDuration;
        
        if (COOLDOWN_SETTINGS.useDifferentiated) {
            if (signalType === 'analysis') {
                cooldownDuration = 2 * 60 * 1000; // 2 minutos para análise
            } else {
                cooldownDuration = COOLDOWN_SETTINGS.symbolCooldown; // 15 minutos para trades
            }
        } else {
            cooldownDuration = COOLDOWN_SETTINGS.symbolCooldown;
        }
        
        const key = `${symbol}_${direction ? 'BULL' : 'BEAR'}`;
        const cooldownEnd = Date.now() + cooldownDuration;
        
        this.cooldownMap.set(key, cooldownEnd);
        
        // Limpar cooldowns antigos
        this.cleanupOldCooldowns();
    }

    cleanupOldCooldowns() {
        const now = Date.now();
        for (const [key, endTime] of this.cooldownMap.entries()) {
            if (now > endTime) {
                this.cooldownMap.delete(key);
            }
        }
    }

    canProcessSymbol(symbol) {
        return !this.processingSymbols.has(symbol);
    }

    startProcessing(symbol) {
        this.processingSymbols.add(symbol);
    }

    finishProcessing(symbol) {
        this.processingSymbols.delete(symbol);
    }

    recordSignal(symbol, signal) {
        const now = Date.now();
        this.lastSignalTime.set(symbol, now);
        
        if (!this.symbolSignals.has(symbol)) {
            this.symbolSignals.set(symbol, []);
        }
        
        const signals = this.symbolSignals.get(symbol);
        signals.push({
            timestamp: now,
            direction: signal.isBullish ? 'BULL' : 'BEAR',
            type: signal.volumeConfirmed ? 'trade' : 'analysis',
            qualityScore: signal.qualityScore.score
        });
        
        // Manter apenas últimos 50 sinais por símbolo
        if (signals.length > 50) {
            signals.shift();
        }
    }

    getSymbolStats(symbol) {
        const signals = this.symbolSignals.get(symbol) || [];
        const lastSignal = this.lastSignalTime.get(symbol);
        
        return {
            totalSignals: signals.length,
            lastSignalTime: lastSignal || null,
            recentSignals: signals.slice(-5),
            inCooldown: this.isInCooldown(symbol, true) || this.isInCooldown(symbol, false)
        };
    }

    getOverallStats() {
        const totalSymbols = this.symbolGroups.flat().length;
        const signalsByType = {
            trade: 0,
            analysis: 0
        };
        
        for (const signals of this.symbolSignals.values()) {
            for (const signal of signals) {
                if (signal.type === 'trade') signalsByType.trade++;
                else signalsByType.analysis++;
            }
        }
        
        return {
            totalGroups: this.totalGroups,
            currentGroup: this.currentGroupIndex + 1,
            totalSymbols: totalSymbols,
            activeCooldowns: this.cooldownMap.size,
            processingSymbols: this.processingSymbols.size,
            signalsByType: signalsByType,
            totalSignals: signalsByType.trade + signalsByType.analysis
        };
    }
}

async function processSymbolGroup(groupManager) {
    const symbols = groupManager.getCurrentGroup();
    const results = {
        totalProcessed: 0,
        signalsFound: 0,
        errors: 0,
        signals: []
    };
    
    console.log(`\n🔍 Processando grupo ${groupManager.currentGroupIndex + 1}/${groupManager.totalGroups} (${symbols.length} símbolos)`);
    
    // Processar símbolos em paralelo com limitação
    const processingQueue = [];
    const maxConcurrent = 3;
    
    for (const symbol of symbols) {
        if (!groupManager.canProcessSymbol(symbol)) {
            continue;
        }
        
        if (processingQueue.length >= maxConcurrent) {
            // Esperar algum terminar
            await Promise.race(processingQueue);
        }
        
        groupManager.startProcessing(symbol);
        
        const promise = (async () => {
            try {
                results.totalProcessed++;
                
                // Verificar cooldown
                if (groupManager.isInCooldown(symbol, true) || groupManager.isInCooldown(symbol, false)) {
                    console.log(`   ⏳ ${symbol}: Em cooldown`);
                    return;
                }
                
                console.log(`   📊 ${symbol}: Analisando...`);
                
                const signal = await monitorSymbol(symbol);
                
                if (signal) {
                    results.signalsFound++;
                    results.signals.push(signal);
                    
                    // Enviar alerta com risk layer
                    const alertResult = await sendSignalAlertWithRisk(signal);
                    
                    // Registrar sinal e aplicar cooldown
                    groupManager.recordSignal(symbol, signal);
                    groupManager.setCooldown(symbol, signal.isBullish, alertResult.type);
                    
                    console.log(`   ✅ ${symbol}: Sinal encontrado (${signal.isBullish ? 'COMPRA' : 'VENDA'})`);
                } else {
                    console.log(`   ➖ ${symbol}: Sem sinal`);
                }
                
            } catch (error) {
                results.errors++;
                console.log(`   ❌ ${symbol}: Erro - ${error.message}`);
            } finally {
                groupManager.finishProcessing(symbol);
            }
        })();
        
        processingQueue.push(promise);
    }
    
    // Esperar todos terminarem
    await Promise.allSettled(processingQueue);
    
    return results;
}

function cleanupCaches() {
    const now = Date.now();
    let cleaned = 0;
    
    // Limpar cache de candles
    for (const key in candleCache) {
        if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
            delete candleCache[key];
            cleaned++;
        }
    }
    
    // Limpar cache de OI
    for (const key in oiCache) {
        if (now - oiCache[key].timestamp > OI_CACHE_TTL * 2) {
            delete oiCache[key];
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cache limpo: ${cleaned} entradas removidas`);
    }
}

async function checkInternetConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            console.log('✅ Conexão com Binance OK');
            return true;
        }
        
        return false;
    } catch (error) {
        console.log('❌ Sem conexão com Binance');
        return false;
    }
}

async function mainBotLoop() {
    let iteration = 0;
    
    try {
        // Buscar símbolos
        const allSymbols = await fetchAllFuturesSymbols();
        
        if (!allSymbols || allSymbols.length === 0) {
            throw new Error('Nenhum símbolo encontrado');
        }
        
        // Inicializar gerenciador de grupos
        const groupManager = new AdaptiveSymbolGroupManager();
        groupManager.initialize(allSymbols);
        
        // Enviar mensagem de inicialização
        await sendInitializationMessage();
        
        // Loop principal
        while (true) {
            iteration++;
            const loopStartTime = Date.now();
            
            console.log(`\n${'='.repeat(80)}`);
            console.log(`🌀 ITERAÇÃO ${iteration} - ${new Date().toLocaleString('pt-BR')}`);
            console.log(`${'='.repeat(80)}`);
            
            try {
                // Rotacionar grupo se necessário
                groupManager.rotateGroup();
                
                // Processar grupo atual
                const results = await processSymbolGroup(groupManager);
                
                // Limpar caches periodicamente
                if (iteration % 10 === 0) {
                    cleanupCaches();
                }
                
                // Mostrar estatísticas
                const stats = groupManager.getOverallStats();
                const loopDuration = Date.now() - loopStartTime;
                
                console.log(`\n📈 ESTATÍSTICAS DA ITERAÇÃO:`);
                console.log(`   • Símbolos processados: ${results.totalProcessed}`);
                console.log(`   • Sinais encontrados: ${results.signalsFound}`);
                console.log(`   • Erros: ${results.errors}`);
                console.log(`   • Duração: ${loopDuration}ms`);
                console.log(`   • Cooldowns ativos: ${stats.activeCooldowns}`);
                console.log(`   • Total sinais: ${stats.totalSignals} (${stats.signalsByType.trade} trades, ${stats.signalsByType.analysis} análises)`);
                
                // Logar se houver sinais
                if (results.signalsFound > 0) {
                    logToFile(`Iteração ${iteration}: ${results.signalsFound} sinais encontrados`);
                    
                    for (const signal of results.signals) {
                        logToFile(`  ${signal.symbol}: ${signal.isBullish ? 'COMPRA' : 'VENDA'} (Score: ${signal.qualityScore.score})`);
                    }
                }
                
                // Aguardar próximo ciclo
                const minLoopTime = 30000; // 30 segundos mínimo
                const actualWaitTime = Math.max(minLoopTime - loopDuration, 5000);
                
                console.log(`\n⏳ Próximo ciclo em ${Math.round(actualWaitTime / 1000)} segundos...`);
                await new Promise(resolve => setTimeout(resolve, actualWaitTime));
                
            } catch (error) {
                console.error(`🚨 Erro no loop principal: ${error.message}`);
                console.log('🔄 Continuando em 30 segundos...');
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO NO BOT: ${error.message}`);
        throw error;
    }
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================

let rateLimiter = new AdaptiveRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log(' TITANIUM - SISTEMA COM GATILHO ÚNICO (VOLUME)');
        console.log(` 🎯 GATILHO ÚNICO: Volume 1h/4h confirmado`);
        console.log(` 📊 FILTROS ADICIONAIS: Liquidez, Whale Activity, BTC Correlation`);
        console.log(` 💰 ORDENS BINANCE: BIDS/ASKS incluídos nos alertas`);
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

// Iniciar o bot
startBot();
