const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_oZfA';
const TELEGRAM_CHAT_ID = '-1001997';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES OTIMIZADAS PARA 540+ PARES ===
const ADVANCED_RL_SETTINGS = {
    enabled: true,
    
    // Ensemble melhorado com ajuste por modelo
    ensemble: {
        enabled: true,
        models: ['qlearning', 'gradient_bandit', 'expert_rules'],
        model_performance: {}, // Armazenará performance individual
        voting_threshold: 0.60
    },
    
    // Reward System melhorado
    reward_system: {
        base_multipliers: {
            win: 1.0,
            partial_win: 0.3,
            break_even: 0.0,
            small_loss: -0.2,
            medium_loss: -0.5,
            large_loss: -1.0
        },
        
        quality_bonus: {
            high_quality: 0.3,
            medium_quality: 0.1,
            low_quality: -0.1
        },
        
        volatility_adjusted: true // Ajuste por volatilidade
    },
    
    // State discretização otimizada para performance
    state_size: 12,
    state_buckets: {
        volume_ratio: 5,
        rsi: 6,
        adx: 5,
        volatility: 4,
        atr_percent: 5
    },
    
    // Tile coding básico para Q-Learning
    tile_coding: {
        enabled: true,
        num_tiles: 3,      // Reduzido para melhor performance
        tile_width: 0.25
    },
    
    action_space: ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'],
    learning_rate: 0.01,
    discount_factor: 0.95,
    
    // Limites para evitar explosão da Q-table
    max_states: 30000,     // Reduzido para melhor performance
    prune_frequency: 50
};

// === CONFIGURAÇÕES DE RISK MANAGEMENT (APENAS PARA QUALIDADE) ===
const RISK_SETTINGS = {
    max_open_positions_per_symbol: 1,
    min_confidence: 0.65,
    volatility_scaling: true
};

// === CONFIGURAÇÕES DE TARGETS BASEADAS EM ATR ===
const TARGET_SETTINGS = {
    use_atr_targets: true,
    base_stop_atr_multiplier: 1.5,
    target_1_atr_multiplier: 1.0,
    target_2_atr_multiplier: 2.0,
    target_3_atr_multiplier: 3.0,
    min_risk_reward: 1.5,
    max_position_time_hours: 48
};

// === RATE LIMIT OTIMIZADO PARA 540+ PARES ===
const RATE_LIMIT = {
    enabled: true,
    max_requests_per_minute: 2400,        // Aumentado para 2400
    max_symbols_per_batch: 25,           // Aumentado para 25
    adaptive_delay: true,
    base_delay_ms: 600,                  // Reduzido para 600ms
    min_delay_ms: 300,
    max_delay_ms: 2000,
    request_count: 0,
    last_reset: Date.now(),
    parallel_requests: 8                 // Paralelismo controlado
};

// === CONFIGURAÇÕES OTIMIZADAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.0,
    adaptive_to_volatility: true
};

const LSR_SETTINGS = {
    buyThreshold: 2.5,
    sellThreshold: 2.5
};

const QUALITY_THRESHOLD = 70;
const ADX_MIN_STRENGTH = 22;

// === FILTROS RÁPIDOS PARA 540+ PARES ===
const QUICK_FILTERS = {
    min_24h_volume: 500000,      // Volume mínimo em USDT (ajustável)
    max_spread_percent: 0.15,    // Spread máximo permitido
    blacklist: [                 // Pares problemáticos ou ilíquidos
        'BTCDOMUSDT', 'DEFIUSDT', 'BLZUSDT', 'C98USDT', 'DODOXUSDT'
    ]
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const ENSEMBLE_DIR = './ensemble_data';

// =====================================================================
// 🔧 SISTEMA DE RATE LIMIT INTELIGENTE OTIMIZADO
// =====================================================================

class IntelligentRateLimiter {
    constructor() {
        this.requestHistory = [];
        this.symbolDelays = new Map();
        this.consecutiveErrors = new Map();
        this.adaptiveDelays = new Map();
        this.requestQueue = [];
        this.processing = false;
    }
    
    async waitIfNeeded(symbol = null) {
        if (!RATE_LIMIT.enabled) return;
        
        const now = Date.now();
        
        // Reset contador a cada minuto
        if (now - RATE_LIMIT.last_reset > 60000) {
            RATE_LIMIT.request_count = 0;
            RATE_LIMIT.last_reset = now;
        }
        
        // Verificar limite de requisições
        if (RATE_LIMIT.request_count >= RATE_LIMIT.max_requests_per_minute) {
            const waitTime = 61000 - (now - RATE_LIMIT.last_reset);
            console.log(`⏳ Rate limit atingido, aguardando ${Math.ceil(waitTime/1000)}s`);
            await new Promise(r => setTimeout(r, waitTime));
            RATE_LIMIT.request_count = 0;
            RATE_LIMIT.last_reset = Date.now();
        }
        
        // Delay adaptativo por símbolo
        let delay = RATE_LIMIT.base_delay_ms;
        
        if (symbol && RATE_LIMIT.adaptive_delay) {
            const errorCount = this.consecutiveErrors.get(symbol) || 0;
            const adaptiveDelay = this.adaptiveDelays.get(symbol) || RATE_LIMIT.base_delay_ms;
            
            delay = adaptiveDelay;
            
            // Aumentar delay para símbolos com muitos erros
            if (errorCount > 2) {
                delay = Math.min(RATE_LIMIT.max_delay_ms, delay * (1 + errorCount * 0.15));
            }
            
            // Delay baseado no volume de requisições recentes
            const recentRequests = this.requestHistory.filter(
                req => req.symbol === symbol && now - req.timestamp < 20000
            ).length;
            
            if (recentRequests > 8) {
                delay = Math.min(RATE_LIMIT.max_delay_ms, delay * 1.3);
            }
            
            // Atualizar delay adaptativo
            const newDelay = Math.max(
                RATE_LIMIT.min_delay_ms,
                Math.min(RATE_LIMIT.max_delay_ms, delay * 0.97)
            );
            this.adaptiveDelays.set(symbol, newDelay);
        }
        
        // Delay mínimo entre requisições
        await new Promise(r => setTimeout(r, delay));
        
        RATE_LIMIT.request_count++;
        this.requestHistory.push({ symbol, timestamp: now });
        
        // Manter histórico de 3 minutos
        this.requestHistory = this.requestHistory.filter(
            req => now - req.timestamp < 180000
        );
    }
    
    recordError(symbol) {
        if (!symbol) return;
        
        const errorCount = this.consecutiveErrors.get(symbol) || 0;
        this.consecutiveErrors.set(symbol, errorCount + 1);
        
        // Reset após sucesso
        setTimeout(() => {
            const currentCount = this.consecutiveErrors.get(symbol) || 0;
            if (currentCount > 0) {
                this.consecutiveErrors.set(symbol, Math.max(0, currentCount - 1));
            }
        }, 45000);
    }
    
    recordSuccess(symbol) {
        if (!symbol) return;
        this.consecutiveErrors.set(symbol, 0);
        // Reduzir delay após sucessos consecutivos
        const currentDelay = this.adaptiveDelays.get(symbol) || RATE_LIMIT.base_delay_ms;
        this.adaptiveDelays.set(symbol, Math.max(RATE_LIMIT.min_delay_ms, currentDelay * 0.95));
    }
    
    getDelayForSymbol(symbol) {
        return this.adaptiveDelays.get(symbol) || RATE_LIMIT.base_delay_ms;
    }
}

// =====================================================================
// 📊 SISTEMA DE VOLATILIDADE ADAPTATIVA OTIMIZADO
// =====================================================================

class VolatilityAdaptiveSystem {
    constructor() {
        this.symbolVolatility = new Map();
        this.atrValues = new Map();
        this.volatilityHistory = new Map();
        this.volumeData = new Map(); // Cache de volume
    }
    
    async calculateATR(symbol, timeframe = '15m', period = 14) {
        try {
            const candles = await getCandlesCached(symbol, timeframe, period + 10); // Reduzido
            if (candles.length < period + 1) return null;
            
            const atr = ATR.calculate({
                high: candles.map(c => c.high),
                low: candles.map(c => c.low),
                close: candles.map(c => c.close),
                period: period
            });
            
            if (!atr || atr.length === 0) return null;
            
            const latestATR = atr[atr.length - 1];
            const currentPrice = candles[candles.length - 1].close;
            const atrPercent = (latestATR / currentPrice) * 100;
            
            return {
                value: latestATR,
                percent: atrPercent,
                currentPrice: currentPrice
            };
        } catch (error) {
            console.log(`⚠️ Erro calculando ATR para ${symbol}:`, error.message);
            return null;
        }
    }
    
    async updateVolatility(symbol) {
        try {
            // Atualizar apenas se passou mais de 5 minutos
            const lastUpdate = this.volatilityHistory.get(symbol)?.lastUpdated || 0;
            if (Date.now() - lastUpdate < 300000) return;
            
            const atrData = await this.calculateATR(symbol);
            if (!atrData) return;
            
            this.atrValues.set(symbol, atrData);
            
            // Calcular volatilidade histórica com menos dados
            const candles = await getCandlesCached(symbol, '1h', 20); // Reduzido
            if (candles.length >= 15) {
                const returns = [];
                for (let i = 1; i < candles.length; i++) {
                    const returnVal = Math.log(candles[i].close / candles[i-1].close);
                    returns.push(returnVal);
                }
                
                const stdDev = Math.sqrt(
                    returns.reduce((sum, ret) => sum + Math.pow(ret, 2), 0) / returns.length
                );
                
                const annualizedVolatility = stdDev * Math.sqrt(365 * 24);
                
                this.symbolVolatility.set(symbol, {
                    atr: atrData,
                    hourlyReturns: returns,
                    stdDev: stdDev,
                    annualizedVol: annualizedVolatility,
                    volatilityRank: this.calculateVolatilityRank(annualizedVolatility),
                    lastUpdated: Date.now()
                });
            }
        } catch (error) {
            console.log(`⚠️ Erro atualizando volatilidade ${symbol}:`, error.message);
        }
    }
    
    calculateVolatilityRank(volatility) {
        // Classifica volatilidade em 5 níveis
        if (volatility < 0.5) return 'very_low';
        if (volatility < 1.0) return 'low';
        if (volatility < 2.0) return 'medium';
        if (volatility < 3.5) return 'high';
        return 'very_high';
    }
    
    getVolatilityAdjustedMultiplier(symbol) {
        const volData = this.symbolVolatility.get(symbol);
        if (!volData) return 1.0;
        
        const rank = volData.volatilityRank;
        const multipliers = {
            'very_low': 1.3,
            'low': 1.1,
            'medium': 1.0,
            'high': 0.8,
            'very_high': 0.6
        };
        
        return multipliers[rank] || 1.0;
    }
    
    getATRForSymbol(symbol) {
        return this.atrValues.get(symbol);
    }
    
    async getVolumeData(symbol) {
        try {
            // Cache de volume por 2 minutos
            const cached = this.volumeData.get(symbol);
            if (cached && Date.now() - cached.timestamp < 120000) {
                return cached.data;
            }
            
            const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
            const response = await fetch(url);
            const data = await response.json();
            
            const volumeData = {
                quoteVolume: parseFloat(data.quoteVolume),
                count: parseInt(data.count),
                lastPrice: parseFloat(data.lastPrice),
                timestamp: Date.now()
            };
            
            this.volumeData.set(symbol, { data: volumeData, timestamp: Date.now() });
            return volumeData;
        } catch (error) {
            return null;
        }
    }
}

// =====================================================================
// 🔍 FUNÇÕES DE SUPORTE/RESISTÊNCIA E DIVERGÊNCIAS OTIMIZADAS
// =====================================================================

async function calculateDivergence15m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 35); // Reduzido de 50
        if (candles.length < 30) return { hasDivergence: false, type: null, strength: 0 };
        
        const closes = candles.map(c => c.close);
        const lows = candles.map(c => c.low);
        const highs = candles.map(c => c.high);
        
        // Calcular RSI para detecção de divergência
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        if (!rsiValues || rsiValues.length < 20) return { hasDivergence: false, type: null, strength: 0 };
        
        // Detectar divergência bullish (preço faz lower low, RSI faz higher low)
        let bullishDivergence = false;
        let bearishDivergence = false;
        let divergenceStrength = 0;
        
        // Analisar últimos 20 candles
        const lookback = 20;
        const recentCandles = candles.slice(-lookback);
        const recentRSI = rsiValues.slice(-lookback);
        
        // Encontrar lows significativos (simplificado)
        const swingLows = [];
        for (let i = 3; i < recentCandles.length - 3; i++) {
            if (recentCandles[i].low < recentCandles[i-1].low &&
                recentCandles[i].low < recentCandles[i-2].low &&
                recentCandles[i].low < recentCandles[i+1].low) {
                swingLows.push({
                    index: i,
                    price: recentCandles[i].low,
                    rsi: recentRSI[i]
                });
            }
        }
        
        // Encontrar highs significativos (simplificado)
        const swingHighs = [];
        for (let i = 3; i < recentCandles.length - 3; i++) {
            if (recentCandles[i].high > recentCandles[i-1].high &&
                recentCandles[i].high > recentCandles[i-2].high &&
                recentCandles[i].high > recentCandles[i+1].high) {
                swingHighs.push({
                    index: i,
                    price: recentCandles[i].high,
                    rsi: recentRSI[i]
                });
            }
        }
        
        // Verificar divergência bullish
        if (swingLows.length >= 2) {
            const lastSwingLow = swingLows[swingLows.length - 1];
            const prevSwingLow = swingLows[swingLows.length - 2];
            
            if (lastSwingLow.price < prevSwingLow.price && 
                lastSwingLow.rsi > prevSwingLow.rsi) {
                
                const priceDiffPercent = Math.abs(lastSwingLow.price - prevSwingLow.price) / prevSwingLow.price * 100;
                const rsiDiff = Math.abs(lastSwingLow.rsi - prevSwingLow.rsi);
                
                if (priceDiffPercent > 0.5 && rsiDiff > 5) {
                    divergenceStrength = Math.min(1, rsiDiff / 15 + priceDiffPercent / 20);
                    bullishDivergence = true;
                }
            }
        }
        
        // Verificar divergência bearish
        if (swingHighs.length >= 2 && !bullishDivergence) {
            const lastSwingHigh = swingHighs[swingHighs.length - 1];
            const prevSwingHigh = swingHighs[swingHighs.length - 2];
            
            if (lastSwingHigh.price > prevSwingHigh.price && 
                lastSwingHigh.rsi < prevSwingHigh.rsi) {
                
                const priceDiffPercent = Math.abs(lastSwingHigh.price - prevSwingHigh.price) / prevSwingHigh.price * 100;
                const rsiDiff = Math.abs(lastSwingHigh.rsi - prevSwingHigh.rsi);
                
                if (priceDiffPercent > 0.5 && rsiDiff > 5) {
                    divergenceStrength = Math.min(1, rsiDiff / 15 + priceDiffPercent / 20);
                    bearishDivergence = true;
                }
            }
        }
        
        return {
            hasDivergence: bullishDivergence || bearishDivergence,
            type: bullishDivergence ? 'bullish' : (bearishDivergence ? 'bearish' : null),
            strength: divergenceStrength,
            swingPoints: {
                lows: swingLows.length,
                highs: swingHighs.length
            }
        };
        
    } catch (error) {
        console.log(`⚠️ Erro calculando divergência para ${symbol}:`, error.message);
        return { hasDivergence: false, type: null, strength: 0 };
    }
}

async function calculateSupportResistance(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 80); // Reduzido de 100
        if (candles.length < 40) return { levels: [], nearestSupport: null, nearestResistance: null, strength: 'weak' };
        
        const prices = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const currentPrice = prices[prices.length - 1];
        
        // Encontrar níveis de suporte e resistência (simplificado)
        const supportLevels = [];
        const resistanceLevels = [];
        
        // Procurar por máximos e mínimos locais (janela menor)
        for (let i = 2; i < candles.length - 2; i++) {
            // Máximo local
            if (highs[i] > highs[i-1] && highs[i] > highs[i-2] &&
                highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
                
                const level = highs[i];
                const existingLevel = resistanceLevels.find(r => Math.abs(r - level) / level < 0.008);
                if (!existingLevel) {
                    resistanceLevels.push(level);
                }
            }
            
            // Mínimo local
            if (lows[i] < lows[i-1] && lows[i] < lows[i-2] &&
                lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
                
                const level = lows[i];
                const existingLevel = supportLevels.find(s => Math.abs(s - level) / level < 0.008);
                if (!existingLevel) {
                    supportLevels.push(level);
                }
            }
        }
        
        // Ordenar e limitar
        supportLevels.sort((a, b) => b - a).splice(5);
        resistanceLevels.sort((a, b) => a - b).splice(5);
        
        // Encontrar mais próximos
        let nearestSupport = supportLevels.find(level => level < currentPrice);
        let nearestResistance = resistanceLevels.find(level => level > currentPrice);
        
        // Calcular força baseada em proximidade e número de toques
        let supportStrength = 'weak';
        let resistanceStrength = 'weak';
        
        if (nearestSupport) {
            const touches = countPriceTouches(candles, nearestSupport, 'support', 0.01);
            if (touches >= 3) supportStrength = 'strong';
            else if (touches >= 2) supportStrength = 'medium';
        }
        
        if (nearestResistance) {
            const touches = countPriceTouches(candles, nearestResistance, 'resistance', 0.01);
            if (touches >= 3) resistanceStrength = 'strong';
            else if (touches >= 2) resistanceStrength = 'medium';
        }
        
        // Verificar proximidade
        const isNearSupport = nearestSupport && (currentPrice - nearestSupport) / currentPrice < 0.025;
        const isNearResistance = nearestResistance && (nearestResistance - currentPrice) / currentPrice < 0.025;
        
        return {
            nearestSupport: nearestSupport ? {
                price: nearestSupport,
                distancePercent: ((currentPrice - nearestSupport) / currentPrice * 100).toFixed(2),
                strength: supportStrength,
                isNear: isNearSupport
            } : null,
            nearestResistance: nearestResistance ? {
                price: nearestResistance,
                distancePercent: ((nearestResistance - currentPrice) / currentPrice * 100).toFixed(2),
                strength: resistanceStrength,
                isNear: isNearResistance
            } : null,
            currentPrice: currentPrice,
            strength: Math.max(
                supportStrength === 'strong' ? 1 : (supportStrength === 'medium' ? 0.5 : 0),
                resistanceStrength === 'strong' ? 1 : (resistanceStrength === 'medium' ? 0.5 : 0)
            )
        };
        
    } catch (error) {
        console.log(`⚠️ Erro calculando suporte/resistência para ${symbol}:`, error.message);
        return { levels: [], nearestSupport: null, nearestResistance: null, strength: 'weak' };
    }
}

function countPriceTouches(candles, level, type, tolerancePercent = 0.01) {
    let touches = 0;
    const tolerance = level * tolerancePercent;
    
    for (const candle of candles) {
        if (type === 'support') {
            if (Math.abs(candle.low - level) <= tolerance) touches++;
        } else if (type === 'resistance') {
            if (Math.abs(candle.high - level) <= tolerance) touches++;
        }
    }
    
    return touches;
}

async function calculateBreakoutRisk(symbol, currentPrice, isBullish) {
    try {
        const srData = await calculateSupportResistance(symbol);
        
        let riskScore = 0;
        let riskLevel = 'low';
        let factors = [];
        
        // Fator 1: Proximidade com suporte/resistência
        if (isBullish && srData.nearestResistance && srData.nearestResistance.isNear) {
            riskScore += 0.4;
            factors.push(`Próximo da resistência (${srData.nearestResistance.distancePercent}%)`);
        } else if (!isBullish && srData.nearestSupport && srData.nearestSupport.isNear) {
            riskScore += 0.4;
            factors.push(`Próximo do suporte (${srData.nearestSupport.distancePercent}%)`);
        }
        
        // Fator 2: Força do nível
        if ((isBullish && srData.nearestResistance?.strength === 'strong') ||
            (!isBullish && srData.nearestSupport?.strength === 'strong')) {
            riskScore += 0.3;
            factors.push('Nível forte identificado');
        }
        
        // Determinar nível de risco
        if (riskScore >= 0.6) riskLevel = 'high';
        else if (riskScore >= 0.4) riskLevel = 'medium';
        else if (riskScore >= 0.2) riskLevel = 'low';
        else riskLevel = 'very_low';
        
        return {
            level: riskLevel,
            score: riskScore.toFixed(2),
            factors: factors,
            supportResistance: {
                nearestSupport: srData.nearestSupport?.price,
                nearestResistance: srData.nearestResistance?.price
            }
        };
        
    } catch (error) {
        console.log(`⚠️ Erro calculando breakout risk para ${symbol}:`, error.message);
        return {
            level: 'medium',
            score: 0.5,
            factors: ['Erro na análise']
        };
    }
}

// =====================================================================
// 🎯 SISTEMA DE PRIORIDADE DINÂMICA
// =====================================================================

class SymbolPrioritySystem {
    constructor() {
        this.symbolScores = new Map();
        this.lastSignalTime = new Map();
        this.symbolPerformance = new Map();
    }
    
    async initialize(symbols) {
        // Inicializar scores baseados em volume
        for (const symbol of symbols) {
            this.symbolScores.set(symbol, 50); // Score inicial
        }
    }
    
    async updateScore(symbol, hasSignal, signalQuality) {
        const currentScore = this.symbolScores.get(symbol) || 50;
        let newScore = currentScore;
        
        if (hasSignal && signalQuality) {
            // Aumentar score se teve sinal bom
            const qualityBonus = Math.min(15, signalQuality.score / 10);
            newScore = Math.min(95, currentScore + qualityBonus);
            this.lastSignalTime.set(symbol, Date.now());
        } else {
            // Diminuir gradualmente
            newScore = Math.max(10, currentScore - 0.5);
        }
        
        this.symbolScores.set(symbol, newScore);
    }
    
    getPrioritySymbols(allSymbols, count = 60) {
        return [...allSymbols]
            .filter(symbol => !QUICK_FILTERS.blacklist.includes(symbol))
            .sort((a, b) => {
                const scoreA = this.symbolScores.get(a) || 50;
                const scoreB = this.symbolScores.get(b) || 50;
                return scoreB - scoreA;
            })
            .slice(0, count);
    }
    
    async quickFilter(symbol) {
        try {
            // Verificar blacklist
            if (QUICK_FILTERS.blacklist.includes(symbol)) {
                return false;
            }
            
            // Verificar volume 24h
            const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
            const response = await fetch(url);
            const data = await response.json();
            
            const quoteVolume = parseFloat(data.quoteVolume);
            if (quoteVolume < QUICK_FILTERS.min_24h_volume) {
                return false;
            }
            
            // Verificar spread
            const askPrice = parseFloat(data.askPrice);
            const bidPrice = parseFloat(data.bidPrice);
            const spread = askPrice > 0 ? ((askPrice - bidPrice) / askPrice) * 100 : 0;
            
            if (spread > QUICK_FILTERS.max_spread_percent) {
                return false;
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }
}

// =====================================================================
// 🤖 MODELOS RL (MANTIDOS DO CÓDIGO ORIGINAL)
// =====================================================================

class ImprovedGradientBandit {
    constructor() {
        this.preferences = {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        };
        this.learningRate = 0.01;
        this.baseline = 0;
        this.count = 0;
    }
    
    softmaxWithTemperature(preferences, temperature = 0.5) {
        const expValues = {};
        let sumExp = 0;
        
        for (const [action, pref] of Object.entries(preferences)) {
            const expValue = Math.exp(pref / temperature);
            expValues[action] = expValue;
            sumExp += expValue;
        }
        
        const probabilities = {};
        for (const [action, expValue] of Object.entries(expValues)) {
            probabilities[action] = expValue / sumExp;
        }
        
        return probabilities;
    }
    
    async predict(state, signalType) {
        const temperature = 0.5;
        const probabilities = this.softmaxWithTemperature(this.preferences, temperature);
        
        let cumulative = 0;
        const rand = Math.random();
        let selectedAction = 'NEUTRAL';
        
        for (const [action, prob] of Object.entries(probabilities)) {
            cumulative += prob;
            if (rand <= cumulative) {
                selectedAction = action;
                break;
            }
        }
        
        return {
            action: selectedAction,
            confidence: probabilities[selectedAction],
            probabilities: probabilities,
            method: 'improved_gradient_bandit'
        };
    }
    
    async learn(experience) {
        this.count++;
        this.baseline = this.baseline + (1 / this.count) * (experience.reward - this.baseline);
        
        const probabilities = this.softmaxWithTemperature(this.preferences);
        
        for (const action of Object.keys(this.preferences)) {
            const indicator = action === experience.action ? 1 : 0;
            const update = this.learningRate * (experience.reward - this.baseline) * 
                (indicator - probabilities[action]);
            
            this.preferences[action] += update;
        }
    }
    
    async load(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.preferences = data.preferences || this.preferences;
                this.baseline = data.baseline || 0;
                this.count = data.count || 0;
            }
        } catch (error) {
            console.log(`⚠️ Erro ao carregar Gradient Bandit: ${error.message}`);
        }
    }
    
    async save(filePath) {
        try {
            const data = {
                preferences: this.preferences,
                baseline: this.baseline,
                count: this.count,
                savedAt: Date.now()
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar Gradient Bandit:', error);
        }
    }
}

class ExpertRulesSystem {
    constructor() {
        this.rules = this.initializeRules();
    }
    
    initializeRules() {
        return [
            // Regra 1: Volume + ADX
            {
                name: 'high_volume_strong_trend',
                evaluate: (state, signalType) => {
                    if (state.volume_ratio >= 2.0 && state.adx >= 30) {
                        return { score: 3.0, action: signalType === 'BUY' ? 'STRONG_BUY' : 'STRONG_SELL' };
                    } else if (state.volume_ratio >= 1.5 && state.adx >= 25) {
                        return { score: 2.0, action: signalType === 'BUY' ? 'BUY' : 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 2: RSI extremo
            {
                name: 'rsi_extreme',
                evaluate: (state, signalType) => {
                    if (signalType === 'BUY' && state.rsi <= 35) {
                        return { score: 2.0, action: 'STRONG_BUY' };
                    } else if (signalType === 'SELL' && state.rsi >= 65) {
                        return { score: 2.0, action: 'STRONG_SELL' };
                    } else if (signalType === 'BUY' && state.rsi <= 45) {
                        return { score: 1.0, action: 'BUY' };
                    } else if (signalType === 'SELL' && state.rsi >= 55) {
                        return { score: 1.0, action: 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 3: EMA Alignment
            {
                name: 'ema_alignment',
                evaluate: (state, signalType) => {
                    if (state.ema_alignment === 1 && signalType === 'BUY') {
                        return { score: 2.0, action: 'BUY' };
                    } else if (state.ema_alignment === 0 && signalType === 'SELL') {
                        return { score: 2.0, action: 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 4: Divergência
            {
                name: 'divergence_confirmation',
                evaluate: (state, signalType) => {
                    if (state.divergence === 1) {
                        const aligned = (signalType === 'BUY') || (signalType === 'SELL');
                        if (aligned) {
                            return { score: 2.5, action: signalType === 'BUY' ? 'STRONG_BUY' : 'STRONG_SELL' };
                        }
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            }
        ];
    }
    
    async predict(state, signalType) {
        let totalScore = 0;
        let weightedAction = 'NEUTRAL';
        
        for (const rule of this.rules) {
            const result = rule.evaluate(state, signalType);
            totalScore += result.score;
            
            if (result.score > 0) {
                const actionValue = this.actionToValue(result.action);
                const currentValue = this.actionToValue(weightedAction);
                
                if (actionValue * Math.abs(result.score) > currentValue * Math.abs(totalScore)) {
                    weightedAction = result.action;
                }
            }
        }
        
        const confidence = this.scoreToConfidence(totalScore);
        
        return {
            action: weightedAction,
            confidence: confidence,
            total_score: totalScore,
            method: 'expert_rules'
        };
    }
    
    actionToValue(action) {
        const values = {
            'STRONG_BUY': 2,
            'BUY': 1,
            'NEUTRAL': 0,
            'SELL': -1,
            'STRONG_SELL': -2
        };
        return values[action] || 0;
    }
    
    scoreToConfidence(score) {
        const normalized = Math.tanh(score / 5);
        const confidence = 0.5 + normalized * 0.4;
        return Math.max(0.1, Math.min(0.9, confidence));
    }
    
    async learn(experience) {
        // Sistema baseado em regras não aprende
    }
    
    async load(filePath) {
        // Regras são estáticas
    }
    
    async save(filePath) {
        // Regras são estáticas
    }
}

// =====================================================================
// 🧠 SISTEMA RL COM TILE CODING OTIMIZADO
// =====================================================================

class TileCodedQLearning {
    constructor() {
        this.qTable = new Map();
        this.learningRate = ADVANCED_RL_SETTINGS.learning_rate;
        this.discountFactor = ADVANCED_RL_SETTINGS.discount_factor;
        this.explorationRate = 0.1;
        this.minExploration = 0.01;
        this.explorationDecay = 0.995;
        this.stateHashes = new Map();
        this.accessCounts = new Map();
    }
    
    getTileHashes(state, signalType) {
        const hashes = [];
        const numTiles = ADVANCED_RL_SETTINGS.tile_coding.num_tiles;
        const tileWidth = ADVANCED_RL_SETTINGS.tile_coding.tile_width;
        
        if (!ADVANCED_RL_SETTINGS.tile_coding.enabled) {
            const features = [
                state.volume_ratio,
                state.rsi,
                state.adx,
                state.volatility,
                state.atr_percent,
                signalType === 'BUY' ? 1 : 0
            ];
            return [`${features.join('_')}`];
        }
        
        for (let tile = 0; tile < numTiles; tile++) {
            const offset = tile * tileWidth;
            
            const tiledFeatures = [
                Math.floor((state.volume_ratio + offset) / tileWidth),
                Math.floor((state.rsi + offset) / tileWidth),
                Math.floor((state.adx + offset) / tileWidth),
                Math.floor((state.volatility + offset) / tileWidth),
                Math.floor((state.atr_percent + offset) / tileWidth),
                state.ema_alignment,
                state.divergence,
                signalType === 'BUY' ? 1 : 0
            ];
            
            hashes.push(`tile${tile}_${tiledFeatures.join('_')}`);
        }
        
        return hashes;
    }
    
    initializeState(stateHashes) {
        for (const hash of stateHashes) {
            if (!this.qTable.has(hash)) {
                this.qTable.set(hash, {
                    'STRONG_BUY': 0,
                    'BUY': 0,
                    'NEUTRAL': 0,
                    'SELL': 0,
                    'STRONG_SELL': 0
                });
            }
        }
    }
    
    async predict(state, signalType) {
        const stateHashes = this.getTileHashes(state, signalType);
        this.initializeState(stateHashes);
        
        for (const hash of stateHashes) {
            this.accessCounts.set(hash, (this.accessCounts.get(hash) || 0) + 1);
        }
        
        const aggregatedQValues = {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        };
        
        for (const hash of stateHashes) {
            const qValues = this.qTable.get(hash);
            for (const action in qValues) {
                aggregatedQValues[action] += qValues[action];
            }
        }
        
        for (const action in aggregatedQValues) {
            aggregatedQValues[action] /= stateHashes.length;
        }
        
        let action;
        if (Math.random() < this.explorationRate) {
            const actions = Object.keys(aggregatedQValues);
            action = actions[Math.floor(Math.random() * actions.length)];
        } else {
            let bestAction = 'NEUTRAL';
            let bestValue = aggregatedQValues[bestAction];
            
            for (const [act, value] of Object.entries(aggregatedQValues)) {
                if (value > bestValue) {
                    bestValue = value;
                    bestAction = act;
                }
            }
            action = bestAction;
        }
        
        const values = Object.values(aggregatedQValues);
        const maxValue = Math.max(...values);
        const minValue = Math.min(...values);
        const confidence = maxValue - minValue > 0 ? 
            (aggregatedQValues[action] - minValue) / (maxValue - minValue) : 0.5;
        
        if (this.qTable.size > ADVANCED_RL_SETTINGS.max_states && Math.random() < 0.01) {
            await this.pruneQTable();
        }
        
        return {
            action: action,
            confidence: Math.max(0.1, Math.min(0.99, confidence)),
            q_values: aggregatedQValues,
            exploration_rate: this.explorationRate,
            q_table_size: this.qTable.size,
            method: 'tile_coded_qlearning'
        };
    }
    
    async learn(experience) {
        const stateHashes = this.getTileHashes(experience.state, 
            experience.action.includes('BUY') ? 'BUY' : 'SELL');
        
        this.initializeState(stateHashes);
        
        for (const hash of stateHashes) {
            const qValues = this.qTable.get(hash);
            const oldQ = qValues[experience.action] || 0;
            const newQ = oldQ + this.learningRate * (experience.reward - oldQ);
            qValues[experience.action] = newQ;
            this.qTable.set(hash, qValues);
        }
        
        this.explorationRate = Math.max(
            this.minExploration,
            this.explorationRate * this.explorationDecay
        );
    }
    
    async pruneQTable() {
        const sortedEntries = Array.from(this.accessCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, ADVANCED_RL_SETTINGS.max_states);
        
        const newQTable = new Map();
        const newAccessCounts = new Map();
        
        for (const [hash, count] of sortedEntries) {
            if (this.qTable.has(hash)) {
                newQTable.set(hash, this.qTable.get(hash));
                newAccessCounts.set(hash, count);
            }
        }
        
        this.qTable = newQTable;
        this.accessCounts = newAccessCounts;
    }
    
    async load(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.qTable = new Map(Object.entries(data.qTable || {}));
                this.explorationRate = data.explorationRate || 0.1;
                this.accessCounts = new Map(Object.entries(data.accessCounts || {}));
            }
        } catch (error) {
            console.log(`⚠️ Erro ao carregar Q-Learning: ${error.message}`);
        }
    }
    
    async save(filePath) {
        try {
            const data = {
                qTable: Object.fromEntries(this.qTable),
                explorationRate: this.explorationRate,
                accessCounts: Object.fromEntries(this.accessCounts),
                savedAt: Date.now()
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar Q-Learning:', error);
        }
    }
}

// =====================================================================
// 🧠 SISTEMA RL PRINCIPAL OTIMIZADO
// =====================================================================

class ImprovedRLSystem {
    constructor() {
        this.models = {
            qlearning: new TileCodedQLearning(),
            gradient_bandit: new ImprovedGradientBandit(),
            expert_rules: new ExpertRulesSystem()
        };
        
        this.weights = { 
            qlearning: 0.45,
            gradient_bandit: 0.35,
            expert_rules: 0.20
        };
        
        this.model_performance = {};
        this.history = [];
        this.performance = {
            total_trades: 0,
            winning_trades: 0,
            total_reward: 0,
            recent_rewards: []
        };
        
        this.volatilitySystem = new VolatilityAdaptiveSystem();
        this.loadModels();
    }
    
    async loadModels() {
        try {
            if (!fs.existsSync(ENSEMBLE_DIR)) {
                fs.mkdirSync(ENSEMBLE_DIR, { recursive: true });
            }
            
            for (const [modelName, model] of Object.entries(this.models)) {
                if (model.load) {
                    await model.load(path.join(ENSEMBLE_DIR, `${modelName}.json`));
                }
                this.model_performance[modelName] = {
                    correct: 0,
                    total: 0,
                    total_reward: 0,
                    recent_rewards: []
                };
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar modelos:', error.message);
        }
    }
    
    async saveModels() {
        try {
            for (const [modelName, model] of Object.entries(this.models)) {
                if (model.save) {
                    await model.save(path.join(ENSEMBLE_DIR, `${modelName}.json`));
                }
            }
            
            const performanceData = {
                model_performance: this.model_performance,
                weights: this.weights,
                savedAt: Date.now()
            };
            
            fs.writeFileSync(
                path.join(ENSEMBLE_DIR, 'model_performance.json'),
                JSON.stringify(performanceData, null, 2)
            );
        } catch (error) {
            console.error('Erro ao salvar modelos:', error);
        }
    }
    
    async getRecommendation(marketData, signalType, symbol) {
        if (!ADVANCED_RL_SETTINGS.enabled) {
            return this.getFallbackRecommendation(marketData, signalType);
        }
        
        try {
            await this.volatilitySystem.updateVolatility(symbol);
            
            const divergenceData = await calculateDivergence15m(symbol);
            const currentPrice = await getCurrentPriceCached(symbol);
            const breakoutRiskData = await calculateBreakoutRisk(symbol, currentPrice, signalType === 'BUY');
            const srData = await calculateSupportResistance(symbol);
            
            marketData.divergence15m = divergenceData;
            marketData.breakoutRisk = breakoutRiskData;
            marketData.supportResistance = srData;
            
            const state = this.processState(marketData, signalType, symbol);
            
            const predictions = {};
            for (const [modelName, model] of Object.entries(this.models)) {
                predictions[modelName] = await model.predict(state, signalType);
            }
            
            const ensembleDecision = this.combinePredictions(predictions, signalType);
            
            const volatilityMultiplier = this.volatilitySystem.getVolatilityAdjustedMultiplier(symbol);
            ensembleDecision.confidence *= volatilityMultiplier;
            ensembleDecision.confidence = Math.max(0.1, Math.min(0.99, ensembleDecision.confidence));
            
            return {
                action: ensembleDecision.action,
                confidence: ensembleDecision.confidence,
                predictions: predictions,
                state: state,
                weights: this.weights,
                volatility_adjusted: volatilityMultiplier,
                divergence: divergenceData,
                breakout_risk: breakoutRiskData,
                support_resistance: srData
            };
            
        } catch (error) {
            console.error('Erro no RL:', error);
            return this.getFallbackRecommendation(marketData, signalType);
        }
    }
    
    processState(marketData, signalType, symbol) {
        const discretize = (value, min, max, buckets) => {
            const normalized = Math.max(min, Math.min(max, value));
            const step = (max - min) / buckets;
            return Math.floor((normalized - min) / step);
        };
        
        const volData = this.volatilitySystem.getATRForSymbol(symbol);
        const atrPercent = volData ? volData.percent : 1.0;
        
        const riskMap = {
            'very_low': 0,
            'low': 0.25,
            'medium': 0.5,
            'high': 0.75,
            'very_high': 1.0
        };
        
        const breakoutRisk = marketData.breakoutRisk ? 
            riskMap[marketData.breakoutRisk.level] || 0.5 : 0.5;
        
        const divergenceValue = marketData.divergence15m && marketData.divergence15m.hasDivergence ? 1 : 0;
        
        return {
            volume_ratio: discretize(
                marketData.volume?.rawRatio || 1.0,
                0.5, 5.0,
                ADVANCED_RL_SETTINGS.state_buckets.volume_ratio
            ),
            rsi: discretize(
                marketData.rsi?.raw || 50,
                0, 100,
                ADVANCED_RL_SETTINGS.state_buckets.rsi
            ),
            adx: discretize(
                marketData.adx1h?.raw || 0,
                0, 60,
                ADVANCED_RL_SETTINGS.state_buckets.adx
            ),
            volatility: discretize(
                marketData.volatility?.rawVolatility || 1.0,
                0.1, 10.0,
                ADVANCED_RL_SETTINGS.state_buckets.volatility
            ),
            atr_percent: discretize(
                atrPercent,
                0.1, 10.0,
                ADVANCED_RL_SETTINGS.state_buckets.atr_percent
            ),
            lsr_ratio: marketData.lsr?.lsrRatio || 1.0,
            ema_alignment: marketData.ema?.isAboveEMA55 ? 1 : 0,
            divergence: divergenceValue,
            breakout_risk: breakoutRisk,
            signal_type: signalType === 'BUY' ? 1 : 0,
            time_of_day: this.getTimeOfDayBucket(),
            sr_strength: marketData.supportResistance?.strength || 0
        };
    }
    
    getTimeOfDayBucket() {
        const hour = new Date().getUTCHours();
        if (hour >= 0 && hour < 6) return 0;
        if (hour >= 6 && hour < 12) return 1;
        if (hour >= 12 && hour < 18) return 2;
        return 3;
    }
    
    combinePredictions(predictions, signalType) {
        const actionScores = {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        };
        
        const modelWeights = this.calculateModelWeights();
        
        for (const [modelName, prediction] of Object.entries(predictions)) {
            const weight = modelWeights[modelName] || 0;
            const modelWeight = this.weights[modelName] || 0;
            const combinedWeight = weight * modelWeight;
            
            if (prediction.action && prediction.confidence) {
                actionScores[prediction.action] += combinedWeight * prediction.confidence;
            }
        }
        
        let bestAction = 'NEUTRAL';
        let bestScore = actionScores[bestAction];
        
        for (const [action, score] of Object.entries(actionScores)) {
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        }
        
        const totalWeight = Object.values(modelWeights).reduce((a, b) => a + b, 0);
        const confidence = totalWeight > 0 ? bestScore / totalWeight : 0.5;
        
        const finalAction = confidence >= ADVANCED_RL_SETTINGS.ensemble.voting_threshold ? 
            bestAction : 'NEUTRAL';
        
        return {
            action: finalAction,
            confidence: Math.max(0.1, Math.min(0.99, confidence)),
            scores: actionScores,
            model_weights: modelWeights
        };
    }
    
    calculateModelWeights() {
        const weights = {};
        let totalPerformance = 0;
        
        for (const [modelName, perf] of Object.entries(this.model_performance)) {
            if (perf.total > 0) {
                const accuracy = perf.correct / perf.total;
                const avgReward = perf.recent_rewards.length > 0 ? 
                    perf.recent_rewards.reduce((a, b) => a + b, 0) / perf.recent_rewards.length : 0;
                
                const score = (accuracy * 0.6) + (Math.max(0, avgReward) * 0.4);
                weights[modelName] = score;
                totalPerformance += score;
            } else {
                weights[modelName] = 0.33;
                totalPerformance += 0.33;
            }
        }
        
        if (totalPerformance > 0) {
            for (const modelName in weights) {
                weights[modelName] = weights[modelName] / totalPerformance;
            }
        }
        
        return weights;
    }
    
    getFallbackRecommendation(marketData, signalType) {
        const volumeRatio = marketData.volume?.rawRatio || 1.0;
        const adx = marketData.adx1h?.raw || 0;
        const quality = marketData.qualityScore?.score || 0;
        
        let action = 'NEUTRAL';
        let confidence = 0.5;
        
        if (signalType === 'BUY') {
            if (volumeRatio > 1.8 && adx > 25 && quality > 70) {
                action = 'BUY';
                confidence = 0.7;
            }
        } else if (signalType === 'SELL') {
            if (volumeRatio > 1.8 && adx > 25 && quality > 70) {
                action = 'SELL';
                confidence = 0.7;
            }
        }
        
        return {
            action: action,
            confidence: confidence,
            predictions: {},
            state: {},
            weights: this.weights
        };
    }
    
    async learnFromExperience(trade, marketData) {
        if (!ADVANCED_RL_SETTINGS.enabled) return;
        
        try {
            const reward = this.calculateReward(trade);
            
            const state = this.processState(
                trade.marketData, 
                trade.isBullish ? 'BUY' : 'SELL',
                trade.symbol
            );
            
            const action = this.mapTradeToAction(trade);
            
            const experience = {
                state: state,
                action: action,
                reward: reward,
                outcome: trade.outcome,
                profit: trade.profitPercentage || 0,
                symbol: trade.symbol,
                timestamp: Date.now()
            };
            
            this.history.push(experience);
            
            if (this.history.length > 800) {
                this.history = this.history.slice(-800);
            }
            
            await this.updateModelPerformance(trade, experience);
            
            for (const [modelName, model] of Object.entries(this.models)) {
                if (model.learn) {
                    await model.learn(experience);
                }
            }
            
            await this.adjustWeightsBasedOnModelPerformance();
            
            if (this.performance.total_trades % 20 === 0) {
                await this.saveModels();
            }
            
        } catch (error) {
            console.error('Erro no aprendizado:', error);
        }
    }
    
    calculateReward(trade) {
        const profit = trade.profitPercentage || 0;
        
        let baseReward = 0;
        
        if (profit > 5) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.win;
        } else if (profit > 0) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.partial_win;
        } else if (profit === 0) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.break_even;
        } else if (profit > -3) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.small_loss;
        } else if (profit > -8) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.medium_loss;
        } else {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.large_loss;
        }
        
        const quality = trade.qualityScore?.score || 0;
        if (quality >= 85) {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.high_quality;
        } else if (quality >= 70) {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.medium_quality;
        } else {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.low_quality;
        }
        
        if (ADVANCED_RL_SETTINGS.reward_system.volatility_adjusted) {
            const volData = this.volatilitySystem.symbolVolatility.get(trade.symbol);
            if (volData) {
                const volRank = volData.volatilityRank;
                const volMultipliers = {
                    'very_low': 0.7,
                    'low': 0.9,
                    'medium': 1.0,
                    'high': 1.2,
                    'very_high': 1.5
                };
                baseReward *= (volMultipliers[volRank] || 1.0);
            }
        }
        
        return baseReward;
    }
    
    async updateModelPerformance(trade, experience) {
        this.performance.total_trades++;
        
        if (trade.outcome === 'SUCCESS') {
            this.performance.winning_trades++;
        }
        
        this.performance.total_reward += experience.reward;
        this.performance.recent_rewards.push(experience.reward);
        
        if (this.performance.recent_rewards.length > 80) {
            this.performance.recent_rewards = this.performance.recent_rewards.slice(-80);
        }
        
        if (trade.rlRecommendation && trade.rlRecommendation.predictions) {
            const predictions = trade.rlRecommendation.predictions;
            const correctAction = experience.reward > 0 ? trade.rlRecommendation.action : 'NEUTRAL';
            
            for (const [modelName, prediction] of Object.entries(predictions)) {
                if (!this.model_performance[modelName]) {
                    this.model_performance[modelName] = {
                        correct: 0,
                        total: 0,
                        total_reward: 0,
                        recent_rewards: []
                    };
                }
                
                const perf = this.model_performance[modelName];
                perf.total++;
                
                if (prediction.action === correctAction || 
                    (prediction.action.includes('BUY') && correctAction.includes('BUY')) ||
                    (prediction.action.includes('SELL') && correctAction.includes('SELL'))) {
                    perf.correct++;
                }
                
                perf.total_reward += experience.reward;
                perf.recent_rewards.push(experience.reward);
                
                if (perf.recent_rewards.length > 40) {
                    perf.recent_rewards = perf.recent_rewards.slice(-40);
                }
            }
        }
    }
    
    mapTradeToAction(trade) {
        if (trade.direction === 'BUY') {
            const quality = trade.qualityScore?.score || 0;
            return quality >= 85 ? 'STRONG_BUY' : 'BUY';
        } else {
            const quality = trade.qualityScore?.score || 0;
            return quality >= 85 ? 'STRONG_SELL' : 'SELL';
        }
    }
    
    async adjustWeightsBasedOnModelPerformance() {
        if (this.history.length < 25) return;
        
        const recentHistory = this.history.slice(-40);
        const recentPerformance = {};
        
        for (const modelName of Object.keys(this.models)) {
            const perf = this.model_performance[modelName];
            if (perf && perf.total > 0) {
                const recentTrades = Math.min(40, perf.total);
                const recentCorrect = perf.correct - (perf.total - recentTrades > 0 ? 
                    this.model_performance[modelName].correct : 0);
                
                recentPerformance[modelName] = {
                    accuracy: recentCorrect / recentTrades,
                    avg_reward: perf.recent_rewards.length > 0 ? 
                        perf.recent_rewards.reduce((a, b) => a + b, 0) / perf.recent_rewards.length : 0,
                    total_trades: recentTrades
                };
            }
        }
        
        let totalScore = 0;
        const newWeights = {};
        
        for (const [modelName, perf] of Object.entries(recentPerformance)) {
            if (perf.total_trades >= 8) {
                const score = (perf.accuracy * 0.7) + (Math.max(0, perf.avg_reward) * 0.3);
                newWeights[modelName] = score;
                totalScore += score;
            } else {
                newWeights[modelName] = 0.33;
                totalScore += 0.33;
            }
        }
        
        if (totalScore > 0) {
            for (const modelName in newWeights) {
                this.weights[modelName] = newWeights[modelName] / totalScore;
            }
        }
    }
    
    getPerformanceReport() {
        const winRate = this.performance.total_trades > 0 ?
            (this.performance.winning_trades / this.performance.total_trades) * 100 : 0;
        
        const avgReward = this.performance.recent_rewards.length > 0 ?
            this.performance.recent_rewards.reduce((a, b) => a + b, 0) / 
            this.performance.recent_rewards.length : 0;
        
        const modelPerformance = {};
        for (const [modelName, perf] of Object.entries(this.model_performance)) {
            if (perf.total > 0) {
                modelPerformance[modelName] = {
                    accuracy: ((perf.correct / perf.total) * 100).toFixed(1),
                    avg_reward: perf.recent_rewards.length > 0 ? 
                        (perf.recent_rewards.reduce((a, b) => a + b, 0) / perf.recent_rewards.length).toFixed(3) : 0,
                    total_predictions: perf.total
                };
            }
        }
        
        return {
            total_trades: this.performance.total_trades,
            win_rate: winRate.toFixed(1),
            total_reward: this.performance.total_reward.toFixed(2),
            avg_reward: avgReward.toFixed(3),
            weights: this.weights,
            model_performance: modelPerformance,
            history_size: this.history.length
        };
    }
}

// =====================================================================
// 🎯 CÁLCULO DE TARGETS BASEADO EM ATR
// =====================================================================

async function calculateATRTargets(price, isBullish, symbol, volatilitySystem) {
    try {
        const atrData = await volatilitySystem.calculateATR(symbol);
        if (!atrData || !TARGET_SETTINGS.use_atr_targets) {
            return calculateFixedTargets(price, isBullish);
        }
        
        const atrValue = atrData.value;
        
        const stopDistance = atrValue * TARGET_SETTINGS.base_stop_atr_multiplier;
        const stopPrice = isBullish ? price - stopDistance : price + stopDistance;
        const stopPercentage = (stopDistance / price) * 100;
        
        const targets = [
            { 
                target: 'ATR 1.0', 
                price: isBullish ? price + (atrValue * TARGET_SETTINGS.target_1_atr_multiplier) : 
                                 price - (atrValue * TARGET_SETTINGS.target_1_atr_multiplier),
                riskReward: (TARGET_SETTINGS.target_1_atr_multiplier / TARGET_SETTINGS.base_stop_atr_multiplier).toFixed(2)
            },
            { 
                target: 'ATR 2.0', 
                price: isBullish ? price + (atrValue * TARGET_SETTINGS.target_2_atr_multiplier) : 
                                 price - (atrValue * TARGET_SETTINGS.target_2_atr_multiplier),
                riskReward: (TARGET_SETTINGS.target_2_atr_multiplier / TARGET_SETTINGS.base_stop_atr_multiplier).toFixed(2)
            },
            { 
                target: 'ATR 3.0', 
                price: isBullish ? price + (atrValue * TARGET_SETTINGS.target_3_atr_multiplier) : 
                                 price - (atrValue * TARGET_SETTINGS.target_3_atr_multiplier),
                riskReward: (TARGET_SETTINGS.target_3_atr_multiplier / TARGET_SETTINGS.base_stop_atr_multiplier).toFixed(2)
            }
        ];
        
        const validTargets = targets.filter(t => 
            parseFloat(t.riskReward) >= TARGET_SETTINGS.min_risk_reward
        );
        
        const bestTarget = validTargets.length > 0 ? 
            validTargets[validTargets.length - 1] : targets[1];
        
        const retracementData = {
            minRetracementPrice: isBullish ? price * 0.9975 : price * 1.0025,
            maxRetracementPrice: isBullish ? price * 0.995 : price * 1.005
        };
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopPercentage.toFixed(2),
            stopATRMultiplier: TARGET_SETTINGS.base_stop_atr_multiplier,
            targets: validTargets.length > 0 ? validTargets : targets,
            bestTarget: bestTarget,
            retracementData: retracementData,
            atrValue: atrValue,
            atrPercent: atrData.percent.toFixed(2),
            method: 'atr_based'
        };
        
    } catch (error) {
        console.log(`⚠️ Erro calculando targets ATR: ${error.message}`);
        return calculateFixedTargets(price, isBullish);
    }
}

function calculateFixedTargets(price, isBullish) {
    const stopPercentage = 3.0;
    const stopPrice = isBullish ? 
        price * (1 - stopPercentage / 100) : 
        price * (1 + stopPercentage / 100);
    
    const targets = [
        { target: '2.5', price: isBullish ? price * 1.025 : price * 0.975, riskReward: '0.83' },
        { target: '5.0', price: isBullish ? price * 1.05 : price * 0.95, riskReward: '1.67' },
        { target: '8.0', price: isBullish ? price * 1.08 : price * 0.92, riskReward: '2.67' }
    ];
    
    const retracementData = {
        minRetracementPrice: isBullish ? price * 0.9975 : price * 1.0025,
        maxRetracementPrice: isBullish ? price * 0.995 : price * 1.005
    };
    
    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage.toFixed(2),
        targets: targets,
        retracementData: retracementData,
        bestTarget: targets[1],
        method: 'fixed_percentage'
    };
}

// =====================================================================
// 📊 SISTEMA DE APRENDIZADO SIMPLIFICADO
// =====================================================================

class SimpleLearningSystem {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.openTrades = new Map();
        this.rlSystem = new ImprovedRLSystem();
        this.prioritySystem = new SymbolPrioritySystem();
        
        this.loadLearningData();
        console.log('📊 Sistema de Aprendizado inicializado (apenas alertas)');
    }
    
    loadLearningData() {
        try {
            if (!fs.existsSync(LEARNING_DIR)) {
                fs.mkdirSync(LEARNING_DIR, { recursive: true });
            }
            
            const learningFile = path.join(LEARNING_DIR, 'trades.json');
            if (fs.existsSync(learningFile)) {
                const data = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados:', error.message);
        }
    }
    
    saveLearningData() {
        try {
            const data = {
                tradeHistory: this.tradeHistory.slice(-400), // Limitar histórico
                symbolPerformance: this.symbolPerformance,
                lastUpdated: Date.now()
            };
            
            const learningFile = path.join(LEARNING_DIR, 'trades.json');
            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar dados:', error);
        }
    }
    
    async recordSignal(signal, marketData) {
        try {
            const rlRecommendation = await this.rlSystem.getRecommendation(
                marketData, 
                signal.isBullish ? 'BUY' : 'SELL',
                signal.symbol
            );
            
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
                isBullish: signal.isBullish,
                entryPrice: signal.price,
                stopPrice: signal.targetsData.stopPrice,
                targets: signal.targetsData.targets,
                qualityScore: signal.qualityScore,
                marketData: {
                    volumeRatio: marketData.volume?.rawRatio || 0,
                    rsi: marketData.rsi?.raw || 0,
                    adx1h: marketData.adx1h?.raw || 0,
                    volatility: marketData.volatility?.rawVolatility || 0,
                    atrPercent: signal.targetsData.atrPercent || 0,
                    divergence15m: marketData.divergence15m || {},
                    breakoutRisk: marketData.breakoutRisk || {},
                    supportResistance: marketData.supportResistance || {}
                },
                rlRecommendation: rlRecommendation,
                volatilityRank: signal.volatilityRank,
                status: 'OPEN'
            };
            
            this.tradeHistory.push(tradeRecord);
            this.openTrades.set(tradeRecord.id, tradeRecord);
            
            setTimeout(() => {
                this.checkTradeOutcome(tradeRecord.id);
            }, TARGET_SETTINGS.max_position_time_hours * 60 * 60 * 1000);
            
            if (this.tradeHistory.length % 10 === 0) {
                this.saveLearningData();
            }
            
            return tradeRecord.id;
            
        } catch (error) {
            console.error('Erro ao registrar sinal:', error);
            return null;
        }
    }
    
    async checkTradeOutcome(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade || trade.status !== 'OPEN') return;
            
            const currentPrice = await getCurrentPriceCached(trade.symbol);
            if (!currentPrice) {
                setTimeout(() => this.checkTradeOutcome(tradeId), 60 * 60 * 1000);
                return;
            }
            
            let outcome = 'FAILURE';
            let profitPercentage = 0;
            
            for (const target of trade.targets) {
                const targetPrice = parseFloat(target.price);
                const hit = trade.isBullish ? currentPrice >= targetPrice : currentPrice <= targetPrice;
                if (hit) {
                    outcome = 'SUCCESS';
                    profitPercentage = trade.isBullish ?
                        ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
                        ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                    break;
                }
            }
            
            if (outcome === 'FAILURE') {
                const stopHit = trade.isBullish ? currentPrice <= trade.stopPrice : currentPrice >= trade.stopPrice;
                profitPercentage = trade.isBullish ?
                    ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
                    ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                if (!stopHit) {
                    setTimeout(() => this.checkTradeOutcome(tradeId), 12 * 60 * 60 * 1000);
                    return;
                }
            }
            
            trade.status = 'CLOSED';
            trade.outcome = outcome;
            trade.profitPercentage = profitPercentage;
            trade.exitPrice = currentPrice;
            trade.durationHours = (Date.now() - trade.timestamp) / (3600000);
            
            await this.rlSystem.learnFromExperience(trade, trade.marketData);
            await this.prioritySystem.updateScore(trade.symbol, true, trade.qualityScore);
            this.openTrades.delete(tradeId);
            
            this.saveLearningData();
            
        } catch (error) {
            console.error('Erro ao verificar trade:', error);
        }
    }
    
    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
        const losers = closedTrades.filter(t => t.outcome === 'FAILURE');
        
        const winRate = closedTrades.length > 0 ? 
            (winners.length / closedTrades.length) * 100 : 0;
        
        const avgProfit = winners.length > 0 ? 
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        
        const avgLoss = losers.length > 0 ? 
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;
        
        const rlReport = this.rlSystem.getPerformanceReport();
        
        return {
            totalTrades: closedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate.toFixed(1),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            profitFactor: avgLoss !== 0 ? Math.abs(avgProfit / avgLoss).toFixed(2) : 'N/A',
            openTrades: this.openTrades.size,
            symbolsTracked: Object.keys(this.symbolPerformance).length,
            rlReport: rlReport
        };
    }
}

// =====================================================================
// 🔄 FUNÇÕES AUXILIARES OTIMIZADAS
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
        
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 🚀 FUNÇÕES DE ANÁLISE TÉCNICA OTIMIZADAS
// =====================================================================

let candleCache = {};
const CANDLE_CACHE_TTL = 30000; // 30 segundos

let priceCache = {};
const PRICE_CACHE_TTL = 10000; // 10 segundos

async function getCandlesCached(symbol, timeframe, limit = 40) { // Reduzido
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
        
        const response = await fetch(url);
        const data = await response.json();
        
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

async function getCurrentPriceCached(symbol) {
    try {
        const now = Date.now();
        if (priceCache[symbol] && now - priceCache[symbol].timestamp < PRICE_CACHE_TTL) {
            return priceCache[symbol].price;
        }
        
        const url = `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`;
        const response = await fetch(url);
        const data = await response.json();
        
        const price = parseFloat(data.price);
        priceCache[symbol] = { price, timestamp: now };
        
        return price;
    } catch (error) {
        console.log(`⚠️ Erro ao buscar preço de ${symbol}:`, error.message);
        return null;
    }
}

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 60); // Reduzido
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
        const candles = await getCandlesCached(symbol, '1h', 25); // Reduzido
        if (candles.length < 14) return null;
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        
        if (!rsiValues || rsiValues.length === 0) return null;
        
        const latestRSI = rsiValues[rsiValues.length - 1];
        return {
            value: latestRSI,
            raw: latestRSI
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 25); // Reduzido
        if (candles.length < 15) return { rawRatio: 1.0, isAbnormal: false };
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-15).reduce((a, b) => a + b, 0) / 15;
        
        const ratio = currentVolume / avgVolume;
        
        return {
            rawRatio: ratio,
            isAbnormal: ratio >= VOLUME_SETTINGS.baseThreshold
        };
    } catch (error) {
        return { rawRatio: 1.0, isAbnormal: false };
    }
}

async function checkVolatility(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 20); // Reduzido
        if (candles.length < 8) return { rawVolatility: 1.0, isValid: false };
        
        const closes = candles.map(c => c.close);
        const returns = [];
        
        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i-1]) / closes[i-1]));
        }
        
        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;
        
        return {
            rawVolatility: volatility,
            isValid: volatility >= 0.8
        };
    } catch (error) {
        return { rawVolatility: 1.0, isValid: false };
    }
}

async function checkLSR(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 25); // Reduzido
        if (candles.length < 2) return { lsrRatio: 1.0, isValid: false };
        
        const lastCandle = candles[candles.length - 1];
        const currentClose = lastCandle.close;
        const currentLow = lastCandle.low;
        
        const lsrRatio = (lastCandle.high - currentClose) / (currentClose - currentLow);
        
        const isValid = isBullish ? 
            (currentClose - currentLow > 0 && lsrRatio <= LSR_SETTINGS.buyThreshold) :
            (currentClose - currentLow > 0 && lsrRatio > LSR_SETTINGS.sellThreshold);
        
        return {
            lsrRatio: lsrRatio || 1.0,
            isValid: isValid
        };
    } catch (error) {
        return { lsrRatio: 1.0, isValid: false };
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 25); // Reduzido
        if (candles.length < 20) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14
        });
        
        if (!adxValues || adxValues.length === 0) return null;
        
        const latestADX = adxValues[adxValues.length - 1];
        const adxValue = typeof latestADX === 'object' ? latestADX.adx : latestADX;
        
        return {
            raw: adxValue || 0,
            hasMinimumStrength: (adxValue || 0) >= ADX_MIN_STRENGTH
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// 🎯 CÁLCULO DE QUALIDADE OTIMIZADO
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    
    // 1. Volume (25 pontos)
    if (marketData.volume && marketData.volume.rawRatio >= 1.5) {
        const volumeScore = Math.min(25, marketData.volume.rawRatio * 10);
        score += volumeScore;
        details.push(`📊 Volume: ${volumeScore.toFixed(1)}/25 (${marketData.volume.rawRatio.toFixed(2)}x)`);
    }
    
    // 2. ADX (20 pontos)
    if (marketData.adx1h && marketData.adx1h.raw >= 22) {
        const adxScore = Math.min(20, marketData.adx1h.raw);
        score += adxScore;
        details.push(`📈 ADX: ${adxScore.toFixed(1)}/20 (${marketData.adx1h.raw.toFixed(1)})`);
    }
    
    // 3. RSI (15 pontos)
    if (marketData.rsi) {
        let rsiScore = 0;
        if (isBullish && marketData.rsi.value < 45) {
            rsiScore = 15 - (marketData.rsi.value / 3);
        } else if (!isBullish && marketData.rsi.value > 55) {
            rsiScore = (marketData.rsi.value - 55) / 3;
        }
        score += rsiScore;
        details.push(`📉 RSI: ${rsiScore.toFixed(1)}/15 (${marketData.rsi.value.toFixed(1)})`);
    }
    
    // 4. EMA Alignment (20 pontos)
    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
                          (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);
        
        if (isEmaValid) {
            score += 20;
            details.push(`📐 EMA: 20/20 (Alinhado)`);
        }
    }
    
    // 5. Volatilidade (10 pontos)
    if (marketData.volatility && marketData.volatility.isValid) {
        score += 10;
        details.push(`🌊 Volatilidade: 10/10 (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    }
    
    // 6. LSR (10 pontos)
    if (marketData.lsr && marketData.lsr.isValid) {
        score += 10;
        details.push(`⚖️ LSR: 10/10 (${marketData.lsr.lsrRatio.toFixed(2)})`);
    }
    
    let grade, emoji;
    if (score >= 85) {
        grade = "A✨";
        emoji = "🏆";
    } else if (score >= 70) {
        grade = "B";
        emoji = "✅";
    } else if (score >= 60) {
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
        isAcceptable: score >= QUALITY_THRESHOLD,
        message: `${emoji} SCORE: ${grade} (${Math.round(score)}/100)`
    };
}

// =====================================================================
// 🔍 MONITORAMENTO PRINCIPAL OTIMIZADO
// =====================================================================

async function monitorSymbol(symbol, rateLimiter, volatilitySystem) {
    try {
        await rateLimiter.waitIfNeeded(symbol);
        
        const emaData = await getEMAs3m(symbol);
        if (!emaData) {
            rateLimiter.recordError(symbol);
            return null;
        }
        
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) {
            rateLimiter.recordError(symbol);
            return null;
        }
        
        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;
        
        if (!isBullish && !isBearish) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        
        // Filtros rápidos
        const volData = volatilitySystem.symbolVolatility.get(symbol);
        const volRank = volData?.volatilityRank || 'medium';
        
        const rsiThresholds = {
            'very_low': { buy: 50, sell: 50 },
            'low': { buy: 52, sell: 48 },
            'medium': { buy: 55, sell: 45 },
            'high': { buy: 58, sell: 42 },
            'very_high': { buy: 60, sell: 40 }
        };
        
        const thresholds = rsiThresholds[volRank] || rsiThresholds.medium;
        
        if (isBullish && rsiData.value >= thresholds.buy) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        if (isBearish && rsiData.value <= thresholds.sell) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        
        const [volumeData, volatilityData, lsrData, adx1hData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            getADX1h(symbol)
        ]);
        
        if (!adx1hData || !adx1hData.hasMinimumStrength) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        
        const volumeThreshold = VOLUME_SETTINGS.adaptive_to_volatility ? 
            VOLUME_SETTINGS.baseThreshold * (volRank === 'high' ? 0.8 : volRank === 'very_high' ? 0.7 : 1.0) :
            VOLUME_SETTINGS.baseThreshold;
        
        if (volumeData.rawRatio < volumeThreshold) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        
        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            adx1h: adx1hData,
            ema: {
                isAboveEMA55: emaData.isAboveEMA55,
                isEMA13CrossingUp: emaData.isEMA13CrossingUp,
                isEMA13CrossingDown: emaData.isEMA13CrossingDown
            }
        };
        
        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);
        
        if (!qualityScore.isAcceptable) {
            rateLimiter.recordSuccess(symbol);
            return null;
        }
        
        const targetsData = await calculateATRTargets(emaData.currentPrice, isBullish, symbol, volatilitySystem);
        
        rateLimiter.recordSuccess(symbol);
        return {
            symbol: symbol,
            isBullish: isBullish,
            price: emaData.currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            volatilityRank: volRank,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        rateLimiter.recordError(symbol);
        return null;
    }
}

// =====================================================================
// 📤 ENVIO DE ALERTAS OTIMIZADO
// =====================================================================

async function sendSignalAlert(signal, learningSystem) {
    try {
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        const divergenceData = await calculateDivergence15m(signal.symbol);
        const srData = await calculateSupportResistance(signal.symbol);
        const breakoutRiskData = await calculateBreakoutRisk(signal.symbol, signal.price, signal.isBullish);
        
        signal.marketData.divergence15m = divergenceData;
        signal.marketData.supportResistance = srData;
        signal.marketData.breakoutRisk = breakoutRiskData;
        
        const tradeId = await learningSystem.recordSignal(signal, signal.marketData);
        
        if (!tradeId) {
            console.log(`⛔ Alerta não enviado: Filtro de qualidade para ${signal.symbol}`);
            return;
        }
        
        const rlRecommendation = signal.rlRecommendation || 
            await learningSystem.rlSystem.getRecommendation(
                signal.marketData, 
                signal.isBullish ? 'BUY' : 'SELL',
                signal.symbol
            );
        
        const rlAction = rlRecommendation.action;
        const rlConfidence = (rlRecommendation.confidence * 100).toFixed(1);
        
        let message = `
${directionEmoji} <b>${signal.symbol} - ${direction}</b>
<b>Volatilidade: ${signal.volatilityRank.toUpperCase().replace('_', ' ')}</b>

🤖 <b>Titanium RL: ${rlAction} (${rlConfidence}% confiança)</b>

<b>🎯 Entrada:</b> $${signal.price.toFixed(6)}
<b>⛔ Stop Loss:</b> $${signal.targetsData.stopPrice.toFixed(6)} (${signal.targetsData.stopPercentage}%)
<b>🔹 Score:</b> ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})

<b>📊 Análise Técnica:</b>
${signal.qualityScore.details.slice(0, 4).join('\n')}
`;
        
        if (divergenceData.hasDivergence) {
            message += `\n<b>🔀 Divergência ${divergenceData.type.toUpperCase()}:</b> DETECTADA (Força: ${(divergenceData.strength * 100).toFixed(0)}%)`;
        }
        
        if (srData.nearestSupport || srData.nearestResistance) {
            message += `\n<b>📊 Níveis Próximos:</b>`;
            if (srData.nearestSupport) {
                message += `\n• Suporte: $${srData.nearestSupport.price.toFixed(6)} (${srData.nearestSupport.distancePercent}% abaixo)`;
            }
            if (srData.nearestResistance) {
                message += `\n• Resistência: $${srData.nearestResistance.price.toFixed(6)} (${srData.nearestResistance.distancePercent}% acima)`;
            }
        }
        
        if (breakoutRiskData.level !== 'low') {
            message += `\n<b>⚠️ Risco de Breakout:</b> ${breakoutRiskData.level.toUpperCase()}`;
            if (breakoutRiskData.factors.length > 0) {
                message += `\n<b>   Fatores:</b> ${breakoutRiskData.factors.join(', ')}`;
            }
        }
        
        message += `

<b>🎯 Alvos (RR):</b>
${signal.targetsData.targets.slice(0, 3).map((t, i) => 
    `• ${t.target}: $${t.price.toFixed(6)} (${t.riskReward}x)`
).join('\n')}

<b>📈 Método:</b> ${signal.targetsData.method}

<b>🤖 Titanium RL Pro (Tile Coding)</b>
<b>🔔 by @J4Rviz.</b>
        `;
        
        await sendTelegramAlert(message);
        console.log(`📤 Alerta enviado: ${signal.symbol} ${direction} | RL: ${rlAction} | Vol: ${signal.volatilityRank}`);
        
    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

// =====================================================================
// 🔄 LOOP PRINCIPAL OTIMIZADO PARA 540+ PARES
// =====================================================================

async function fetchAllFuturesSymbols() {
    try {
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await response.json();
        
        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol)
            .filter(s => !s.includes('BUSD') && !s.includes('1000') && !s.includes('_'));
        
        // Ordenar por volume aproximado
        return symbols.sort((a, b) => {
            const majors = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
            const aIsMajor = majors.includes(a);
            const bIsMajor = majors.includes(b);
            
            if (aIsMajor && !bIsMajor) return -1;
            if (!aIsMajor && bIsMajor) return 1;
            return 0;
        });
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista padrão');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
    }
}

async function sendInitializationMessage() {
    const brazilTime = getBrazilianDateTime();
    
    const message = `
🚀 <b>TITANIUM RL PRO - OTIMIZADO PARA 540+ PARES</b>

⏰ <b>Inicializado em:</b> ${brazilTime.full}

🤖 <b>OTIMIZAÇÕES IMPLEMENTADAS:</b>
• Rate Limit: <b>2400 req/min</b> (aumentado)
• Batch Size: <b>25 símbolos</b> por lote
• Delay Base: <b>600ms</b> (reduzido)
• Cache Inteligente de Preços e Candles
• Filtros Rápidos de Volume/Spread
• Sistema de Prioridade Dinâmica
• Tile Coding Otimizado (3 tiles)

📊 <b>CONFIGURAÇÕES:</b>
• Quality Threshold: <b>${QUALITY_THRESHOLD}/100</b>
• ADX Mínimo: <b>${ADX_MIN_STRENGTH}</b>
• Volume Base: <b>${VOLUME_SETTINGS.baseThreshold}x</b>
• Monitorando: <b>TODOS os pares USDT</b> (~540+)

⚡ <b>DESEMPENHO ESPERADO:</b>
• ~60-80 pares monitorados por ciclo
• Ciclos a cada 45-60 segundos
• Alerta apenas para sinais de alta qualidade
• Aprendizado RL contínuo

<b>SISTEMA PRONTO PARA 540+ PARES!</b>

<b>🔔 by @J4Rviz.</b>
    `;
    
    await sendTelegramAlert(message);
    console.log('✅ Mensagem de inicialização enviada ao Telegram');
}

async function mainBotLoop() {
    console.log('\n🚀 TITANIUM RL PRO - OTIMIZADO PARA 540+ PARES');
    console.log('🤖 Tile Coding Otimizado');
    console.log('⚡ Rate Limit: 2400 req/min');
    console.log('📊 Batch Size: 25 símbolos');
    console.log('🎯 Monitorando TODOS os pares Binance\n');
    
    const learningSystem = new SimpleLearningSystem();
    const rateLimiter = new IntelligentRateLimiter();
    const volatilitySystem = new VolatilityAdaptiveSystem();
    const prioritySystem = new SymbolPrioritySystem();
    
    let allSymbols = await fetchAllFuturesSymbols();
    console.log(`📊 ${allSymbols.length} símbolos encontrados`);
    
    // Inicializar sistema de prioridade
    await prioritySystem.initialize(allSymbols);
    
    // Filtro rápido inicial
    console.log('🔍 Aplicando filtros rápidos...');
    const filteredSymbols = [];
    for (let i = 0; i < allSymbols.length; i += 20) {
        const batch = allSymbols.slice(i, i + 20);
        const batchPromises = batch.map(symbol => prioritySystem.quickFilter(symbol));
        const batchResults = await Promise.all(batchPromises);
        
        batch.forEach((symbol, idx) => {
            if (batchResults[idx]) {
                filteredSymbols.push(symbol);
            }
        });
        
        await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(`✅ ${filteredSymbols.length} símbolos passaram nos filtros rápidos`);
    
    // Inicializar volatilidade para os principais
    console.log('📈 Inicializando dados de volatilidade...');
    const topSymbols = filteredSymbols.slice(0, 30);
    for (let i = 0; i < topSymbols.length; i += 5) {
        const batch = topSymbols.slice(i, i + 5);
        await Promise.all(batch.map(symbol => volatilitySystem.updateVolatility(symbol)));
        await new Promise(r => setTimeout(r, 1500));
    }
    
    let cycle = 0;
    let activeSymbols = prioritySystem.getPrioritySymbols(filteredSymbols, 60);
    
    while (true) {
        try {
            cycle++;
            const brazilTime = getBrazilianDateTime();
            console.log(`\n🔄 Ciclo ${cycle} - ${brazilTime.full}`);
            console.log(`📊 Monitorando ${activeSymbols.length} símbolos ativos`);
            
            // Rotacionar símbolos ativos a cada 5 ciclos
            if (cycle % 5 === 0) {
                activeSymbols = prioritySystem.getPrioritySymbols(filteredSymbols, 60);
                console.log(`🔄 Atualizando lista de símbolos ativos`);
            }
            
            const signals = [];
            
            // Processar em batches otimizados
            for (let i = 0; i < activeSymbols.length; i += RATE_LIMIT.max_symbols_per_batch) {
                const batch = activeSymbols.slice(i, i + RATE_LIMIT.max_symbols_per_batch);
                
                const batchPromises = batch.map(symbol => 
                    monitorSymbol(symbol, rateLimiter, volatilitySystem)
                );
                
                const batchResults = await Promise.all(batchPromises);
                const validSignals = batchResults.filter(s => s !== null);
                signals.push(...validSignals);
                
                // Atualizar scores no sistema de prioridade
                for (const signal of validSignals) {
                    await prioritySystem.updateScore(signal.symbol, true, signal.qualityScore);
                }
                
                await new Promise(r => setTimeout(r, rateLimiter.getDelayForSymbol(batch[0]) * 1.5));
            }
            
            console.log(`📈 ${signals.length} sinais encontrados`);
            
            // Enviar alertas com limite
            let alertsSent = 0;
            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD && alertsSent < 3) {
                    await sendSignalAlert(signal, learningSystem);
                    alertsSent++;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            // Atualizar volatilidade periódica
            if (cycle % 3 === 0) {
                console.log('📈 Atualizando dados de volatilidade...');
                for (const symbol of activeSymbols.slice(0, 15)) {
                    await volatilitySystem.updateVolatility(symbol);
                    await new Promise(r => setTimeout(r, 400));
                }
            }
            
            // Relatório periódico no console
            if (cycle % 8 === 0) {
                const report = learningSystem.getPerformanceReport();
                console.log('\n📊 RELATÓRIO DE PERFORMANCE:');
                console.log(`Trades: ${report.totalTrades} | Win Rate: ${report.winRate}%`);
                console.log(`Avg Profit: ${report.avgProfit}% | Avg Loss: ${report.avgLoss}%`);
                
                const qlInfo = report.rlReport.model_performance?.qlearning;
                if (qlInfo) {
                    console.log(`🤖 Q-Learning: ${qlInfo.accuracy}% accuracy | Q-table: ${report.rlReport.history_size} estados`);
                }
            }
            
            // Relatório completo para Telegram a cada 30 ciclos
            if (cycle % 30 === 0) {
                const report = learningSystem.getPerformanceReport();
                const brazilTime = getBrazilianDateTime();
                
                const reportMessage = `
📊 <b>RELATÓRIO TITANIUM RL PRO - 540+ PARES</b>
⏰ ${brazilTime.full}
🔄 Ciclo: ${cycle}

<b>📈 ESTATÍSTICAS:</b>
• Alertas Enviados: <b>${report.totalTrades}</b>
• Win Rate: <b>${report.winRate}%</b>
• Profit Factor: <b>${report.profitFactor}</b>
• Lucro Médio: <b>${report.avgProfit}%</b>
• Loss Médio: <b>${report.avgLoss}%</b>

<b>🤖 SISTEMA RL:</b>
• Total Reward: <b>${report.rlReport.total_reward}</b>
• Estados Aprendidos: <b>${report.rlReport.history_size}</b>
• Q-table Size: <b>${report.rlReport.model_performance?.qlearning?.total_predictions || 0}</b>

<b>⚡ DESEMPENHO DO SISTEMA:</b>
• Símbolos Ativos: <b>${activeSymbols.length}</b>
• Símbolos Filtrados: <b>${filteredSymbols.length}/${allSymbols.length}</b>
• Rate Limit: <b>${RATE_LIMIT.request_count}/${RATE_LIMIT.max_requests_per_minute}</b>
• Delay Médio: <b>${rateLimiter.getDelayForSymbol('BTCUSDT')}ms</b>

<b>✅ SISTEMA OTIMIZADO PARA 540+ PARES</b>
<b>🔔 by @J4Rviz.</b>
                `;
                
                await sendTelegramAlert(reportMessage);
                
                // Salvar dados
                learningSystem.saveLearningData();
                await learningSystem.rlSystem.saveModels();
            }
            
            // Limpar cache e aguardar próximo ciclo
            if (cycle % 20 === 0) {
                candleCache = {};
                priceCache = {};
            }
            
            // Delay adaptativo baseado na hora do dia
            const hour = new Date().getUTCHours();
            let delayMultiplier = 1.0;
            
            if (hour >= 0 && hour < 6) delayMultiplier = 1.3;   // Noite Asia
            else if (hour >= 6 && hour < 12) delayMultiplier = 0.9;  // Manhã Europa
            else if (hour >= 12 && hour < 18) delayMultiplier = 0.8; // Tarde EUA
            else delayMultiplier = 1.0;                           // Noite EUA
            
            const nextDelay = Math.max(45000, 60000 * delayMultiplier);
            console.log(`⏱️  Próximo ciclo em ${Math.round(nextDelay/1000)}s...`);
            await new Promise(r => setTimeout(r, nextDelay));
            
        } catch (error) {
            console.error('❌ Erro no ciclo principal:', error.message);
            logToFile(`Erro no ciclo ${cycle}: ${error.message}`);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
        if (!fs.existsSync(ENSEMBLE_DIR)) fs.mkdirSync(ENSEMBLE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM RL PRO - OTIMIZADO PARA 540+ PARES BINANCE');
        console.log('🤖 Sistema RL com Tile Coding Otimizado');
        console.log('⚡ Rate Limit: 2400 req/min | Batch: 25 símbolos | Delay: 600ms');
        console.log('📊 Monitoramento Inteligente com Prioridade Dinâmica');
        console.log('🎯 Apenas alertas Telegram - Sem gerenciamento de capital');
        console.log('='.repeat(80) + '\n');
        
        await sendInitializationMessage();
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
    }
}

// Iniciar o bot
startBot();
