const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// =====================================================================
// === TOKEN E CONFIGURAÇÕES FIXAS DO TELEGRAM ===
// =====================================================================
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// =====================================================================
// === LIMITE DE TAMANHO PARA CACHES ===
// =====================================================================
const MAX_CACHE_SIZE = 500;

function addToCache(cache, key, value, maxSize = MAX_CACHE_SIZE) {
    if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, value);
}

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const ALERTED_FILE = path.join(__dirname, 'alertedSymbols.json');

// =====================================================================
// === KILLZONES ICT (Zonas de Abate) ===
// =====================================================================
const ICT_KILLZONES = {
    'ASIAN': { start: "19:00", end: "23:00", weight: 0.7, liquidity: "LOW", name: "🌏 ASIAN" },
    'LONDON_OPEN': { start: "03:00", end: "05:00", weight: 1.5, liquidity: "HIGH", name: "🇬🇧 LONDON_OPEN" },
    'LONDON_KILLZONE': { start: "05:00", end: "08:00", weight: 1.3, liquidity: "HIGH", name: "🇬🇧 LONDON_KZ" },
    'NY_OPEN': { start: "09:30", end: "10:30", weight: 2.0, liquidity: "EXTREME", name: "🗽 NY_OPEN" },
    'NY_MID': { start: "10:30", end: "12:00", weight: 1.4, liquidity: "HIGH", name: "🗽 NY_MID" },
    'NY_CLOSE': { start: "14:30", end: "16:00", weight: 1.6, liquidity: "HIGH", name: "🗽 NY_CLOSE" },
    'POWER_HOUR': { start: "15:00", end: "16:00", weight: 2.0, liquidity: "EXTREME", name: "💪 POWER_HOUR" }
};

function getCurrentKillzone() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const hours = brazilTime.getUTCHours();
    const minutes = brazilTime.getUTCMinutes();
    const timeStr = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
    
    for (const [zone, times] of Object.entries(ICT_KILLZONES)) {
        if (timeStr >= times.start && timeStr <= times.end) {
            return { zone: times.name, weight: times.weight, liquidity: times.liquidity };
        }
    }
    return { zone: 'OFF_HOURS', weight: 0.7, liquidity: 'LOW' };
}

function isHighProbabilityTime() {
    const killzone = getCurrentKillzone();
    return killzone.weight >= 1.5;
}

// =====================================================================
// === ICT UNICORN MODEL DETECTION ===
// =====================================================================
function detectUnicornModel(candles, currentPrice, orderBlocks, fvgData, liquiditySweep) {
    if (!candles || candles.length < 50) return null;
    
    // 1. Tem liquidity sweep?
    if (!liquiditySweep || !liquiditySweep.isSweep) return null;
    
    // 2. Tem FVG a menos de 0.5%?
    let hasValidFVG = false;
    let fvgPrice = null;
    if (fvgData && fvgData.closestBullish && fvgData.closestBullish.distancePercent <= 0.5) {
        hasValidFVG = true;
        fvgPrice = fvgData.closestBullish.targetPrice;
    }
    if (fvgData && fvgData.closestBearish && fvgData.closestBearish.distancePercent <= 0.5) {
        hasValidFVG = true;
        fvgPrice = fvgData.closestBearish.targetPrice;
    }
    if (!hasValidFVG) return null;
    
    // 3. Tem Order Block na zona do sweep?
    let hasOrderBlock = false;
    let obPrice = null;
    if (orderBlocks && orderBlocks.bullishOB && orderBlocks.bullishOB.length > 0) {
        for (const ob of orderBlocks.bullishOB) {
            const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
            if (diffPercent <= 0.5) {
                hasOrderBlock = true;
                obPrice = ob.price;
                break;
            }
        }
    }
    if (orderBlocks && orderBlocks.bearishOB && orderBlocks.bearishOB.length > 0) {
        for (const ob of orderBlocks.bearishOB) {
            const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
            if (diffPercent <= 0.5) {
                hasOrderBlock = true;
                obPrice = ob.price;
                break;
            }
        }
    }
    if (!hasOrderBlock) return null;
    
    return {
        detected: true,
        sweepPrice: liquiditySweep.price,
        fvgPrice: fvgPrice,
        obPrice: obPrice,
        confidence: 90
    };
}

// =====================================================================
// === TURTLE SOUP DETECTION ===
// =====================================================================
function detectTurtleSoup(candles, currentPrice) {
    if (!candles || candles.length < 25) return null;
    
    const period20 = 20;
    const highs20 = [];
    const lows20 = [];
    
    for (let i = candles.length - period20; i < candles.length; i++) {
        if (candles[i]) {
            highs20.push(candles[i].high);
            lows20.push(candles[i].low);
        }
    }
    
    const max20 = Math.max(...highs20);
    const min20 = Math.min(...lows20);
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    // Turtle Soup Clássico (Venda)
    const breakAbove = currentPrice > max20;
    const closeBelow = lastCandle && lastCandle.close < max20;
    const candleRejection = prevCandle && prevCandle.high > max20 && lastCandle && lastCandle.close < max20;
    
    if ((breakAbove && closeBelow) || candleRejection) {
        return {
            detected: true,
            type: 'classic',
            direction: 'SELL',
            price: max20,
            description: 'Quebra acima de máxima de 20 períodos + reversão',
            probability: 85
        };
    }
    
    // Turtle Soup Inverso (Compra)
    const breakBelow = currentPrice < min20;
    const closeAbove = lastCandle && lastCandle.close > min20;
    const candleRejectionUp = prevCandle && prevCandle.low < min20 && lastCandle && lastCandle.close > min20;
    
    if ((breakBelow && closeAbove) || candleRejectionUp) {
        return {
            detected: true,
            type: 'inverse',
            direction: 'BUY',
            price: min20,
            description: 'Quebra abaixo de mínima de 20 períodos + reversão',
            probability: 85
        };
    }
    
    return null;
}

// =====================================================================
// === LIQUIDITY POOLS (EQL/EQH Detection) ===
// =====================================================================
function detectLiquidityPools(candles) {
    if (!candles || candles.length < 50) return null;
    
    const pools = {
        eqh: [],  // Equal Highs
        eql: [],  // Equal Lows
        bsl: null,  // Buy-side Liquidity
        ssl: null   // Sell-side Liquidity
    };
    
    const tolerance = 0.001; // 0.1% de tolerância
    
    // Encontrar topos iguais (EQH)
    for (let i = 0; i < Math.min(candles.length, 100); i++) {
        for (let j = i + 1; j < Math.min(candles.length, 100); j++) {
            const diff = Math.abs(candles[i].high - candles[j].high);
            const percentDiff = (diff / candles[i].high) * 100;
            
            if (percentDiff < 0.1) {
                const existing = pools.eqh.find(e => Math.abs(e.price - candles[i].high) / candles[i].high < tolerance);
                if (!existing) {
                    pools.eqh.push({
                        price: candles[i].high,
                        occurrences: 2,
                        strength: 'HIGH'
                    });
                } else {
                    existing.occurrences++;
                }
            }
        }
    }
    
    // Encontrar fundos iguais (EQL)
    for (let i = 0; i < Math.min(candles.length, 100); i++) {
        for (let j = i + 1; j < Math.min(candles.length, 100); j++) {
            const diff = Math.abs(candles[i].low - candles[j].low);
            const percentDiff = (diff / candles[i].low) * 100;
            
            if (percentDiff < 0.1) {
                const existing = pools.eql.find(e => Math.abs(e.price - candles[i].low) / candles[i].low < tolerance);
                if (!existing) {
                    pools.eql.push({
                        price: candles[i].low,
                        occurrences: 2,
                        strength: 'HIGH'
                    });
                } else {
                    existing.occurrences++;
                }
            }
        }
    }
    
    // Ordenar por ocorrências
    pools.eqh.sort((a, b) => b.occurrences - a.occurrences);
    pools.eql.sort((a, b) => b.occurrences - a.occurrences);
    
    // Calcular BSL (acima dos EQHs)
    if (pools.eqh.length > 0) {
        pools.bsl = {
            price: pools.eqh[0].price * 1.001,
            volume: 'MASSIVE',
            occurrences: pools.eqh[0].occurrences
        };
    }
    
    // Calcular SSL (abaixo dos EQLs)
    if (pools.eql.length > 0) {
        pools.ssl = {
            price: pools.eql[0].price * 0.999,
            volume: 'MASSIVE',
            occurrences: pools.eql[0].occurrences
        };
    }
    
    return pools;
}

// =====================================================================
// === DISPLACEMENT + FVG DETECTION ===
// =====================================================================
function detectDisplacement(candles, currentPrice) {
    if (!candles || candles.length < 30) return null;
    
    const displacement = {
        hasDisplacement: false,
        direction: null,
        strength: 0,
        gapPercent: 0,
        volumeRatio: 0,
        fvgCreated: null
    };
    
    const avgVolume = candles.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
    
    for (let i = Math.max(1, candles.length - 10); i < candles.length; i++) {
        const currentCandle = candles[i];
        const prevCandle = candles[i-1];
        
        if (!currentCandle || !prevCandle) continue;
        
        const gapUp = currentCandle.open > prevCandle.close;
        const gapDown = currentCandle.open < prevCandle.close;
        const gapPercent = Math.abs(currentCandle.open - prevCandle.close) / prevCandle.close * 100;
        const volumeExplosion = currentCandle.volume > avgVolume * 2;
        
        if ((gapUp || gapDown) && gapPercent > 0.3 && volumeExplosion) {
            displacement.hasDisplacement = true;
            displacement.direction = gapUp ? 'BUY' : 'SELL';
            displacement.strength = gapPercent;
            displacement.gapPercent = gapPercent;
            displacement.volumeRatio = (currentCandle.volume / avgVolume).toFixed(1);
            
            if (gapUp) {
                displacement.fvgCreated = {
                    top: currentCandle.high,
                    bottom: prevCandle.close,
                    type: 'bullish',
                    display: `${formatPrice(prevCandle.close)}-${formatPrice(currentCandle.high)}`
                };
            } else {
                displacement.fvgCreated = {
                    top: prevCandle.close,
                    bottom: currentCandle.low,
                    type: 'bearish',
                    display: `${formatPrice(currentCandle.low)}-${formatPrice(prevCandle.close)}`
                };
            }
            break;
        }
    }
    
    return displacement;
}

function displacementPullbackStrategy(displacement, currentPrice) {
    if (!displacement || !displacement.hasDisplacement) return null;
    
    const fvg = displacement.fvgCreated;
    if (!fvg) return null;
    
    let distanceToFVG = 0;
    if (displacement.direction === 'BUY') {
        distanceToFVG = ((fvg.bottom - currentPrice) / currentPrice) * 100;
    } else {
        distanceToFVG = ((currentPrice - fvg.top) / currentPrice) * 100;
    }
    
    if (distanceToFVG <= 0.3 && distanceToFVG >= -0.3) {
        return {
            signal: displacement.direction,
            entry: currentPrice,
            gapPercent: displacement.gapPercent,
            volumeRatio: displacement.volumeRatio,
            fvgDisplay: fvg.display,
            confidence: 85
        };
    }
    
    return null;
}

// =====================================================================
// === FUNÇÃO PARA IDENTIFICAR CLUSTERS ===
// =====================================================================
function findClusterLevels(candles, currentPrice, tolerancePercent = 0.5, maxClusters = 2) {
    const allSupports = [];
    const allResistances = [];
    const tolerance = tolerancePercent / 100;

    for (const candle of candles) {
        const low = candle.low;
        const high = candle.high;

        if (low < currentPrice) {
            let foundSupport = false;
            for (const cluster of allSupports) {
                const diffPercent = Math.abs(low - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + low;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundSupport = true;
                    break;
                }
            }
            if (!foundSupport) {
                allSupports.push({ avgPrice: low, touches: 1 });
            }
        }

        if (high > currentPrice) {
            let foundResistance = false;
            for (const cluster of allResistances) {
                const diffPercent = Math.abs(high - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + high;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundResistance = true;
                    break;
                }
            }
            if (!foundResistance) {
                allResistances.push({ avgPrice: high, touches: 1 });
            }
        }
    }

    allSupports.sort((a, b) => b.touches - a.touches);
    allResistances.sort((a, b) => b.touches - a.touches);

    return {
        supports: allSupports.slice(0, maxClusters),
        resistances: allResistances.slice(0, maxClusters)
    };
}

function getClusterStrength(touches) {
    if (touches >= 5) return { text: 'FORTE', emoji: '🔥' };
    if (touches >= 3) return { text: 'MEDIANO', emoji: '⚡' };
    return { text: 'FRACO', emoji: '⚠️' };
}

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: TELEGRAM_BOT_TOKEN,
        CHAT_ID: TELEGRAM_CHAT_ID,
        MESSAGE_DELAY_MS: 3000,
        MAX_MESSAGES_PER_MINUTE: 20,
        BURST_DELAY_MS: 5000,
        RETRY_COUNT: 3,
        RETRY_DELAY_MS: 5000
    },
    MONITOR: {
        SCAN_INTERVAL_SECONDS: 60,
        MIN_VOLUME_USDT: 100000,
        MAX_SYMBOLS: 570,
        EXCLUDE_SYMBOLS: ['USDCUSDT', 'BUSDUSDT', 'TUSDUSDT'],
        ALERT_COOLDOWN_MINUTES: 60,
        CONFIRMATION_CANDLES: 1,
        MIN_SCORE_ACCEPT: 50,
        
        PRIMARY_TREND_TF: '15m',
        SECONDARY_TREND_TF: '1h',
        ALLOW_NEUTRAL_TREND: true,
        MIN_TREND_CONFIDENCE: 35,
        
        EMA_PERIODS: {
            FAST: 8,
            SHORT: 13,
            MEDIUM: 34,
            LONG: 55,
            VERY_LONG: 144,
            EXTREME: 233
        },
        SMC: {
            LOOKBACK_CANDLES: 200,
            MIN_CONFIDENCE: 50,
            MIN_SCORE: 60,
            ATR_PERIOD: 14,
            RISK_REWARD: 2.0,
            ORDER_BLOCK_TOLERANCE: 0.002,
            LIQUIDITY_SWEEP_LOOKBACK: 20,
            FVG_PROXIMITY_THRESHOLD: 1.0,
            FVG_CONFIRMATION_CANDLES: 1,
            TARGETS: [1.5, 2.5, 4.0],
            PARTIAL_CLOSE: [25, 25, 50],
            EXTREME_OVERSOLD_RSI: 45,
            EXTREME_OVERBOUGHT_RSI: 65,
            EXTREME_OVERSOLD_STOCH: 20,
            EXTREME_OVERBOUGHT_STOCH: 80,
            DIVERGENCE_LOOKBACK: 100,
            DIVERGENCE_MIN_STRENGTH: 2,
            VOLUME_MIN_RATIO: 1.5,
            WEEKLY_LOOKBACK: 52,
            MONTHLY_LOOKBACK: 24,
            CCI_PERIOD: 20,
            CCI_EMA_PERIOD: 5
        }
    }
};

// =====================================================================
// === FUNÇÕES EXTREME OVERSOLD/OVERBOUGHT ===
// =====================================================================
function isExtremeOversold(rsi, stoch4h) {
    const rsiValue = rsi?.value || 50;
    const stochValue = stoch4h?.k ? parseFloat(stoch4h.k) : 50;
    
    return (rsiValue <= CONFIG.MONITOR.SMC.EXTREME_OVERSOLD_RSI) || 
           (stochValue <= CONFIG.MONITOR.SMC.EXTREME_OVERSOLD_STOCH);
}

function isExtremeOverbought(rsi, stoch4h) {
    const rsiValue = rsi?.value || 50;
    const stochValue = stoch4h?.k ? parseFloat(stoch4h.k) : 50;
    
    return (rsiValue >= CONFIG.MONITOR.SMC.EXTREME_OVERBOUGHT_RSI) || 
           (stochValue >= CONFIG.MONITOR.SMC.EXTREME_OVERBOUGHT_STOCH);
}

// =====================================================================
// === CACHE PARA MACD ===
// =====================================================================
const macdDivergenceCache = new Map();

function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod) return null;
    
    const emaFast = calculateEMA(prices, fastPeriod);
    const emaSlow = calculateEMA(prices, slowPeriod);
    
    if (emaFast === null || emaSlow === null) return null;
    
    const macdLine = emaFast - emaSlow;
    
    return { macdLine, emaFast, emaSlow };
}

function calculateMACDHistogram(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod + signalPeriod) return null;
    
    const macdValues = [];
    
    for (let i = slowPeriod; i <= prices.length; i++) {
        const slice = prices.slice(0, i);
        const emaFast = calculateEMA(slice, fastPeriod);
        const emaSlow = calculateEMA(slice, slowPeriod);
        if (emaFast !== null && emaSlow !== null) {
            macdValues.push(emaFast - emaSlow);
        }
    }
    
    if (macdValues.length < signalPeriod) return null;
    
    const signalLine = calculateEMA(macdValues, signalPeriod);
    const histogram = macdValues[macdValues.length - 1] - signalLine;
    
    return {
        macdLine: macdValues[macdValues.length - 1],
        signalLine: signalLine,
        histogram: histogram,
        macdValues: macdValues,
        signalValues: null
    };
}

function findPivots(data, lookback = 3) {
    const pivots = { highs: [], lows: [] };
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
            if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
        }
        if (isHigh) pivots.highs.push({ index: i, value: data[i] });
        if (isLow) pivots.lows.push({ index: i, value: data[i] });
    }
    return pivots;
}

function findMACDPivots(values, lookback = 3) {
    const pivots = { highs: [], lows: [] };
    
    for (let i = lookback; i < values.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (values[i] <= values[i - j] || values[i] <= values[i + j]) {
                isHigh = false;
            }
            if (values[i] >= values[i - j] || values[i] >= values[i + j]) {
                isLow = false;
            }
        }
        
        if (isHigh) pivots.highs.push({ index: i, value: values[i] });
        if (isLow) pivots.lows.push({ index: i, value: values[i] });
    }
    
    return pivots;
}

function detectMACDDivergence(prices, macdHistogram, macdValues, timeframe) {
    if (prices.length < 30 || macdHistogram.length < 30) {
        return { bullish: false, bearish: false, hasBullish: false, hasBearish: false, timeframes: [] };
    }
    
    const pricePivots = findPivots(prices, 5);
    const macdPivots = findMACDPivots(macdHistogram, 5);
    
    let bullish = false;
    let bearish = false;
    let detectedTimeframes = [];
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            const priceDistance = Math.abs(priceLow2.index - priceLow1.index);
            
            if (priceLower && priceDistance >= 5) {
                const macdLow1 = macdPivots.lows.find(m => Math.abs(m.index - priceLow1.index) <= 5);
                const macdLow2 = macdPivots.lows.find(m => Math.abs(m.index - priceLow2.index) <= 5);
                
                if (macdLow1 && macdLow2 && macdLow2.value > macdLow1.value) {
                    bullish = true;
                    detectedTimeframes.push(timeframe);
                }
            }
        }
    }
    
    for (let i = 0; i < pricePivots.highs.length; i++) {
        for (let j = i + 1; j < pricePivots.highs.length; j++) {
            const priceHigh1 = pricePivots.highs[i];
            const priceHigh2 = pricePivots.highs[j];
            
            const priceHigher = priceHigh2.value > priceHigh1.value;
            const priceDistance = Math.abs(priceHigh2.index - priceHigh1.index);
            
            if (priceHigher && priceDistance >= 5) {
                const macdHigh1 = macdPivots.highs.find(m => Math.abs(m.index - priceHigh1.index) <= 5);
                const macdHigh2 = macdPivots.highs.find(m => Math.abs(m.index - priceHigh2.index) <= 5);
                
                if (macdHigh1 && macdHigh2 && macdHigh2.value < macdHigh1.value) {
                    bearish = true;
                    detectedTimeframes.push(timeframe);
                }
            }
        }
    }
    
    return {
        bullish: bullish,
        bearish: bearish,
        hasBullish: bullish,
        hasBearish: bearish,
        timeframes: detectedTimeframes,
        summary: bullish ? `🟢 MACD Bullish em: ${detectedTimeframes.join(', ')}` : (bearish ? `🔴 MACD Bearish em: ${detectedTimeframes.join(', ')}` : '')
    };
}

async function checkMACDDivergenceOnTimeframe(symbol, timeframe, type) {
    try {
        const cacheKey = `${symbol}_macd_${timeframe}`;
        const now = Date.now();
        const cached = macdDivergenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            const divergence = cached.data;
            if (type === 'BUY') return divergence.hasBullish;
            if (type === 'SELL') return divergence.hasBearish;
            return false;
        }
        
        const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
        if (!candles || candles.length < 50) return false;
        
        const prices = candles.map(c => c.close);
        const macdHistogram = [];
        
        for (let i = 26; i <= prices.length; i++) {
            const slice = prices.slice(0, i);
            const macdData = calculateMACDHistogram(slice, 12, 26, 9);
            if (macdData && macdData.histogram !== undefined) {
                macdHistogram.push(macdData.histogram);
            } else {
                macdHistogram.push(0);
            }
        }
        
        if (macdHistogram.length < 30) return false;
        
        const divergence = detectMACDDivergence(prices, macdHistogram, [], timeframe);
        
        addToCache(macdDivergenceCache, cacheKey, { data: divergence, timestamp: now });
        
        if (type === 'BUY') return divergence.hasBullish;
        if (type === 'SELL') return divergence.hasBearish;
        return false;
        
    } catch (error) {
        return false;
    }
}

async function checkMACDDivergence15m(symbol, type) {
    return await checkMACDDivergenceOnTimeframe(symbol, '15m', type);
}

async function checkMACDDivergenceOtherTF(symbol, type) {
    try {
        const timeframes = ['30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        
        for (const tf of timeframes) {
            const hasDiv = await checkMACDDivergenceOnTimeframe(symbol, tf, type);
            if (hasDiv) {
                return true;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function getMACDDivergenceTimeframesList(symbol, type) {
    try {
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        const detected = [];
        
        for (const tf of timeframes) {
            const hasDiv = await checkMACDDivergenceOnTimeframe(symbol, tf, type);
            if (hasDiv) {
                detected.push(tf);
            }
        }
        
        return detected;
    } catch (error) {
        return [];
    }
}

async function analyzeMACDDivergences(symbol, tradeSignal) {
    try {
        const cacheKey = `${symbol}_macd_divergences`;
        const now = Date.now();
        const cached = macdDivergenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        const result = { 
            bullish: [], 
            bearish: [], 
            hasBullish: false, 
            hasBearish: false, 
            summary: '',
            timeframesList: []
        };
        
        for (const tf of timeframes) {
            try {
                const candles = await getCandles(symbol, tf, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
                if (!candles || candles.length < 50) continue;
                
                const prices = candles.map(c => c.close);
                const macdHistogram = [];
                
                for (let i = 26; i <= prices.length; i++) {
                    const slice = prices.slice(0, i);
                    const macdData = calculateMACDHistogram(slice, 12, 26, 9);
                    if (macdData && macdData.histogram !== undefined) {
                        macdHistogram.push(macdData.histogram);
                    } else {
                        macdHistogram.push(0);
                    }
                }
                
                if (macdHistogram.length < 30) continue;
                
                const divergence = detectMACDDivergence(prices, macdHistogram, [], tf);
                
                if (divergence.bullish) {
                    result.bullish.push(tf);
                    result.hasBullish = true;
                    result.timeframesList.push(tf);
                }
                if (divergence.bearish) {
                    result.bearish.push(tf);
                    result.hasBearish = true;
                    result.timeframesList.push(tf);
                }
            } catch (error) {}
        }
        
        if (result.hasBullish && result.hasBearish) {
            result.summary = `🔄 MACD Divergências Mistas`;
        } else if (result.hasBullish) {
            result.summary = `🟢 MACD Bullish em: ${result.bullish.join(', ')}`;
        } else if (result.hasBearish) {
            result.summary = `🔴 MACD Bearish em: ${result.bearish.join(', ')}`;
        }
        
        addToCache(macdDivergenceCache, cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return { bullish: [], bearish: [], hasBullish: false, hasBearish: false, summary: '', timeframesList: [] };
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR CCI ===
// =====================================================================
function calculateCCI(highs, lows, closes, period = 20) {
    if (closes.length < period) return null;
    
    const typicalPrices = [];
    for (let i = 0; i < closes.length; i++) {
        const tp = (highs[i] + lows[i] + closes[i]) / 3;
        typicalPrices.push(tp);
    }
    
    const sma = [];
    for (let i = period - 1; i < typicalPrices.length; i++) {
        let sum = 0;
        for (let j = i - (period - 1); j <= i; j++) {
            sum += typicalPrices[j];
        }
        sma.push(sum / period);
    }
    
    const cciValues = [];
    for (let i = 0; i < sma.length; i++) {
        let sumAbsDev = 0;
        const startIdx = i + period - 1;
        for (let j = startIdx - (period - 1); j <= startIdx; j++) {
            sumAbsDev += Math.abs(typicalPrices[j] - sma[i]);
        }
        const meanDeviation = sumAbsDev / period;
        const cci = (typicalPrices[startIdx] - sma[i]) / (0.015 * meanDeviation);
        cciValues.push(cci);
    }
    
    return cciValues;
}

function calculateEMAForCCI(cciValues, period = 5) {
    if (!cciValues || cciValues.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = cciValues[0];
    for (let i = 1; i < cciValues.length; i++) {
        ema = (cciValues[i] - ema) * multiplier + ema;
    }
    return ema;
}

const cciCache = new Map();

async function analyzeCCI(symbol, timeframe = '4h') {
    try {
        const cacheKey = `${symbol}_cci_${timeframe}`;
        const now = Date.now();
        const cached = cciCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, timeframe, 100);
        if (!candles || candles.length < 50) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cciValues = calculateCCI(highs, lows, closes, 20);
        if (!cciValues || cciValues.length < 20) return null;
        
        const cciEma = calculateEMAForCCI(cciValues, 5);
        const currentCCI = cciValues[cciValues.length - 1];
        
        let direction = '';
        let directionEmoji = '';
        
        if (currentCCI > cciEma) {
            direction = 'Alta';
            directionEmoji = '⤴️';
        } else if (currentCCI < cciEma) {
            direction = 'Baixa';
            directionEmoji = '⤵️';
        } else {
            direction = 'Neutro';
            directionEmoji = '➡️';
        }
        
        const result = {
            currentCCI: currentCCI.toFixed(2),
            cciEma: cciEma ? cciEma.toFixed(2) : null,
            direction: direction,
            directionEmoji: directionEmoji,
            display: `${directionEmoji} ${direction}`
        };
        
        addToCache(cciCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

async function analyzeCCIDaily(symbol) {
    try {
        const cacheKey = `${symbol}_cci_daily`;
        const now = Date.now();
        const cached = cciCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 3600000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, '1d', 100);
        if (!candles || candles.length < 50) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cciValues = calculateCCI(highs, lows, closes, 20);
        if (!cciValues || cciValues.length < 20) return null;
        
        const cciEma5 = calculateEMAForCCI(cciValues, 5);
        const currentCCI = cciValues[cciValues.length - 1];
        
        let direction = '';
        let directionEmoji = '';
        
        if (currentCCI > cciEma5) {
            direction = 'Alta';
            directionEmoji = '⤴️';
        } else if (currentCCI < cciEma5) {
            direction = 'Baixa';
            directionEmoji = '⤵️';
        } else {
            direction = 'Neutro';
            directionEmoji = '➡️';
        }
        
        const result = {
            currentCCI: currentCCI.toFixed(2),
            cciEma5: cciEma5 ? cciEma5.toFixed(2) : null,
            direction: direction,
            directionEmoji: directionEmoji,
            display: `${directionEmoji} ${direction}`
        };
        
        addToCache(cciCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === STOP LOSS INTELIGENTE ===
// =====================================================================
async function calculateSmartStopLoss(symbol, entryPrice, tradeType, currentPrice, structureData, candles) {
    const atrData = await calculateATR(symbol, '15m', 14);
    const atr4hData = await calculateATR(symbol, '4h', 14);
    
    let baseAtrPercent = atrData ? Math.max(atrData.atrPercent * 2.0, 1.5) : 2.0;
    let atr4hPercent = atr4hData ? atr4hData.atrPercent * 1.2 : 1.8;
    
    let atrStopPercent = Math.max(baseAtrPercent, atr4hPercent);
    
    let structureStopPrice = null;
    let structureStrength = 0;
    
    if (candles && candles.length > 50) {
        const currentPriceNum = typeof currentPrice === 'number' ? currentPrice : parseFloat(currentPrice);
        const clusters = findClusterLevels(candles, currentPriceNum, 0.3, 3);
        
        if (tradeType === 'SELL') {
            for (const res of clusters.resistances) {
                if (res.touches >= 3 && res.avgPrice > currentPriceNum) {
                    const distancePercent = ((res.avgPrice - currentPriceNum) / currentPriceNum) * 100;
                    if (distancePercent > 0.5 && distancePercent < 8) {
                        structureStopPrice = res.avgPrice * 1.005;
                        structureStrength = res.touches;
                        break;
                    }
                }
            }
        } else {
            for (const sup of clusters.supports) {
                if (sup.touches >= 3 && sup.avgPrice < currentPriceNum) {
                    const distancePercent = ((currentPriceNum - sup.avgPrice) / currentPriceNum) * 100;
                    if (distancePercent > 0.5 && distancePercent < 8) {
                        structureStopPrice = sup.avgPrice * 0.995;
                        structureStrength = sup.touches;
                        break;
                    }
                }
            }
        }
    }
    
    let obStopPrice = null;
    let obStrength = 0;
    
    if (candles && candles.length > 30) {
        const orderBlocks = findOrderBlocksWithValidation(candles, 40);
        
        if (tradeType === 'SELL') {
            for (const ob of orderBlocks.bearishOB) {
                if (!ob.wasMitigated && ob.price > entryPrice) {
                    const distancePercent = ((ob.price - entryPrice) / entryPrice) * 100;
                    if (distancePercent > 0.5 && distancePercent < 5) {
                        obStopPrice = ob.price * 1.003;
                        obStrength = ob.volumeStrength === 'FORTE' ? 5 : 3;
                        break;
                    }
                }
            }
        } else {
            for (const ob of orderBlocks.bullishOB) {
                if (!ob.wasMitigated && ob.price < entryPrice) {
                    const distancePercent = ((entryPrice - ob.price) / entryPrice) * 100;
                    if (distancePercent > 0.5 && distancePercent < 5) {
                        obStopPrice = ob.price * 0.997;
                        obStrength = ob.volumeStrength === 'FORTE' ? 5 : 3;
                        break;
                    }
                }
            }
        }
    }
    
    let sweepStopPrice = null;
    if (candles && candles.length > 20) {
        const liquiditySweep = detectLiquiditySweep(candles, currentPrice);
        if (liquiditySweep) {
            if (tradeType === 'SELL' && liquiditySweep.direction === 'SELL') {
                sweepStopPrice = liquiditySweep.price * 1.005;
            } else if (tradeType === 'BUY' && liquiditySweep.direction === 'BUY') {
                sweepStopPrice = liquiditySweep.price * 0.995;
            }
        }
    }
    
    let finalStopPrice = null;
    let stopType = "ATR";
    let finalStopPercent = atrStopPercent;
    
    const possibleStops = [];
    
    if (structureStopPrice) {
        const structureStopPercent = tradeType === 'SELL' 
            ? ((structureStopPrice - entryPrice) / entryPrice) * 100 
            : ((entryPrice - structureStopPrice) / entryPrice) * 100;
        possibleStops.push({ price: structureStopPrice, percent: structureStopPercent, type: 'ESTRUTURA', strength: structureStrength });
    }
    
    if (obStopPrice) {
        const obStopPercent = tradeType === 'SELL' 
            ? ((obStopPrice - entryPrice) / entryPrice) * 100 
            : ((entryPrice - obStopPrice) / entryPrice) * 100;
        possibleStops.push({ price: obStopPrice, percent: obStopPercent, type: 'ORDER_BLOCK', strength: obStrength });
    }
    
    if (sweepStopPrice) {
        const sweepStopPercent = tradeType === 'SELL' 
            ? ((sweepStopPrice - entryPrice) / entryPrice) * 100 
            : ((entryPrice - sweepStopPrice) / entryPrice) * 100;
        possibleStops.push({ price: sweepStopPrice, percent: sweepStopPercent, type: 'LIQUIDITY_SWEEP', strength: 4 });
    }
    
    const atrStopPrice = tradeType === 'SELL' 
        ? entryPrice * (1 + atrStopPercent / 100) 
        : entryPrice * (1 - atrStopPercent / 100);
    possibleStops.push({ price: atrStopPrice, percent: atrStopPercent, type: 'ATR', strength: 2 });
    
    let maxPercent = -1;
    for (const stop of possibleStops) {
        const limitedPercent = Math.min(stop.percent, 5.0);
        if (limitedPercent > maxPercent) {
            maxPercent = limitedPercent;
            finalStopPrice = stop.price;
            stopType = stop.type;
            finalStopPercent = limitedPercent;
        }
    }
    
    if (finalStopPercent < 1.5) {
        finalStopPercent = 1.5;
        finalStopPrice = tradeType === 'SELL' 
            ? entryPrice * (1 + finalStopPercent / 100) 
            : entryPrice * (1 - finalStopPercent / 100);
        stopType = "ATR_MINIMO";
    }
    
    finalStopPrice = parseFloat(finalStopPrice.toFixed(8));
    
    return { 
        stopPrice: finalStopPrice, 
        stopPercent: finalStopPercent, 
        stopType,
        stopComponents: possibleStops.map(s => `${s.type}:${s.percent.toFixed(1)}%`).join(' | ')
    };
}

function getDynamicCooldown(tradeSignal, score) {
    if (tradeSignal === 'BUY' || tradeSignal === 'SELL') {
        if (score >= 80) {
            return 90;
        } else if (score >= 65) {
            return 60;
        } else if (score >= 50) {
            return 45;
        } else {
            return 30;
        }
    }
    return CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES;
}

// =====================================================================
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor(maxRequestsPerMinute = 1500) {
        this.maxRequests = maxRequestsPerMinute;
        this.requests = [];
        this.pendingRequests = [];
        this.isProcessing = false;
    }
    async acquire() {
        return new Promise((resolve) => {
            this.pendingRequests.push(resolve);
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }
    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        while (this.pendingRequests.length > 0) {
            const now = Date.now();
            const windowStart = now - 60000;
            this.requests = this.requests.filter(t => t > windowStart);
           
            if (this.requests.length >= this.maxRequests) {
                const oldestRequest = this.requests[0];
                const waitTime = 60000 - (now - oldestRequest);
                if (waitTime > 0) {
                    await this.delay(waitTime + 100);
                }
                continue;
            }
           
            const resolve = this.pendingRequests.shift();
            this.requests.push(Date.now());
            resolve();
            await this.delay(30);
        }
        this.isProcessing = false;
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const rateLimiter = new RateLimiter(1500);

// =====================================================================
// === CACHE E CONTROLE ===
// =====================================================================
const alertedSymbols = new Map();
const candlesCache = new Map();
const atrCache = new Map();
const oiHistoryCache = new Map();
const stochCache = new Map();
const emaCache = new Map();
const divergenceCache = new Map();
const rsiCache = new Map();
const higherTfCache = new Map();
const volumeProfileCache = new Map();

function loadAlertedSymbols() {
    try {
        if (fs.existsSync(ALERTED_FILE)) {
            const data = fs.readFileSync(ALERTED_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [symbol, timestamp] of Object.entries(loaded)) {
                alertedSymbols.set(symbol, timestamp);
            }
            console.log(`📂 ${alertedSymbols.size} alertas anteriores carregados`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar alertas: ${error.message}`);
    }
}

function saveAlertedSymbols() {
    try {
        const data = {};
        for (const [symbol, timestamp] of alertedSymbols.entries()) {
            data[symbol] = timestamp;
        }
        fs.writeFileSync(ALERTED_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar alertas: ${error.message}`);
    }
}

function canAlert(symbol, tradeSignal = null, score = 0) {
    const lastAlert = alertedSymbols.get(symbol);
    if (!lastAlert) return true;
    
    let cooldownMinutes = CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES;
    if (tradeSignal && score) {
        cooldownMinutes = getDynamicCooldown(tradeSignal, score);
    }
    
    const cooldownMs = cooldownMinutes * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markAlerted(symbol, tradeSignal = null, score = 0) {
    alertedSymbols.set(symbol, Date.now());
    saveAlertedSymbols();
    
    if (tradeSignal && score) {
        const cooldownUsed = getDynamicCooldown(tradeSignal, score);
        console.log(`⏰ ${symbol} | Cooldown dinâmico: ${cooldownUsed}min (Score: ${score})`);
    }
}

// =====================================================================
// === TELEGRAM QUEUE ===
// =====================================================================
class TelegramQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.messageCount = 0;
        this.lastMessageTime = 0;
        this.minuteResetTime = Date.now();
    }
    async add(message, priority = false) {
        return new Promise((resolve, reject) => {
            this.queue.push({ message, resolve, reject, priority, timestamp: Date.now() });
            this.queue.sort((a, b) => {
                if (a.priority && !b.priority) return -1;
                if (!a.priority && b.priority) return 1;
                return a.timestamp - b.timestamp;
            });
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
           
            if (now - this.minuteResetTime >= 60000) {
                this.messageCount = 0;
                this.minuteResetTime = now;
            }
           
            if (this.messageCount >= CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE) {
                const waitTime = 60000 - (now - this.minuteResetTime);
                await delay(waitTime + 1000);
                continue;
            }
           
            const timeSinceLastMessage = now - this.lastMessageTime;
            if (timeSinceLastMessage < CONFIG.TELEGRAM.MESSAGE_DELAY_MS) {
                const waitTime = CONFIG.TELEGRAM.MESSAGE_DELAY_MS - timeSinceLastMessage;
                await delay(waitTime);
            }
           
            const item = this.queue.shift();
           
            try {
                await this.sendWithRetry(item.message);
                item.resolve(true);
                this.messageCount++;
                this.lastMessageTime = Date.now();
            } catch (error) {
                item.reject(error);
            }
        }
        this.isProcessing = false;
    }
    async sendWithRetry(message, attempt = 1) {
        try {
            const token = CONFIG.TELEGRAM.BOT_TOKEN;
            const chatId = CONFIG.TELEGRAM.CHAT_ID;
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
           
            let finalMessage = message;
           
            if (finalMessage.length > 4000) {
                finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
            }
           
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: finalMessage,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                })
            });
           
            if (response.ok) {
                return true;
            } else {
                const errorText = await response.text();
                if (response.status === 429 && attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                    const retryAfter = parseInt(errorText.match(/retry after (\d+)/)?.[1] || '5');
                    await delay(retryAfter * 1000 + 1000);
                    return this.sendWithRetry(message, attempt + 1);
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                await delay(CONFIG.TELEGRAM.RETRY_DELAY_MS * attempt);
                return this.sendWithRetry(message, attempt + 1);
            }
            throw error;
        }
    }
}

const telegramQueue = new TelegramQueue();

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const now = Date.now();
    const cached = candlesCache.get(cacheKey);
   
    if (cached && (now - cached.timestamp) < 60000) {
        return cached.data;
    }
   
    try {
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
       
        if (!Array.isArray(data)) return [];
       
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
       
        addToCache(candlesCache, cacheKey, { data: candles, timestamp: now });
        return candles;
    } catch (error) {
        return [];
    }
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    return rsi;
}

async function getRSI(symbol, timeframe = '15m') {
    try {
        const cacheKey = `${symbol}_rsi_${timeframe}`;
        const now = Date.now();
        const cached = rsiCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 30) {
            return { value: 50, emoji: '' };
        }
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        let emoji = '';
        if (rsi < 25) emoji = '🔵';
        else if (rsi < 35) emoji = '🟢';
        else if (rsi < 45) emoji = '🟡';
        else if (rsi < 58) emoji = '🟠';
        else if (rsi <= 75) emoji = '🔴';
        else emoji = '🔥';
        const result = { value: rsi, emoji };
        addToCache(rsiCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return { value: 50, emoji: '' };
    }
}

async function analyzeHigherTimeframe(symbol) {
    try {
        const cacheKey = `${symbol}_higher_tf`;
        const now = Date.now();
        const cached = higherTfCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 3600000) {
            return cached.data;
        }

        const weeklyCandles = await getCandles(symbol, '1w', CONFIG.MONITOR.SMC.WEEKLY_LOOKBACK);
        const monthlyCandles = await getCandles(symbol, '1M', CONFIG.MONITOR.SMC.MONTHLY_LOOKBACK);

        let weeklyTrend = 'NEUTRO';
        let monthlyTrend = 'NEUTRO';
        let marketPhase = 'NEUTRO';

        if (weeklyCandles && weeklyCandles.length >= 20) {
            const weeklyPrices = weeklyCandles.map(c => c.close);
            const weeklyEMA20 = calculateEMA(weeklyPrices, 20);
            const currentPrice = weeklyPrices[weeklyPrices.length - 1];
            weeklyTrend = currentPrice > weeklyEMA20 ? 'ALTA' : 'BAIXA';
        }

        if (monthlyCandles && monthlyCandles.length >= 12) {
            const monthlyPrices = monthlyCandles.map(c => c.close);
            const monthlyEMA20 = calculateEMA(monthlyPrices, 12);
            const currentPrice = monthlyPrices[monthlyPrices.length - 1];
            monthlyTrend = currentPrice > monthlyEMA20 ? 'ALTA' : 'BAIXA';
        }

        if (weeklyTrend === 'ALTA' && monthlyTrend === 'ALTA') marketPhase = 'BULL MARKET FORTE 🐂';
        else if (weeklyTrend === 'BAIXA' && monthlyTrend === 'BAIXA') marketPhase = 'BEAR MARKET FORTE 🐻';
        else if (weeklyTrend !== monthlyTrend) marketPhase = 'CONFLITO TEMPORAL ⚠️';
        else marketPhase = 'NEUTRO ➡️';

        const result = { weeklyTrend, monthlyTrend, marketPhase, emoji: marketPhase.includes('BULL') ? '🐂' : (marketPhase.includes('BEAR') ? '🐻' : '➡️') };
        addToCache(higherTfCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return { weeklyTrend: 'NEUTRO', monthlyTrend: 'NEUTRO', marketPhase: 'NEUTRO', emoji: '➡️' };
    }
}

async function analyzeVolumeConfirmation(symbol, pivotPrice, pivotIndex) {
    try {
        const candles = await getCandles(symbol, '15m', 50);
        if (!candles || candles.length < 30) return { strength: 'NORMAL', confirmed: false, volumeRatio: 0 };

        const pivotCandle = candles.find(c => Math.abs(c.low - pivotPrice) / pivotPrice < 0.01 || Math.abs(c.high - pivotPrice) / pivotPrice < 0.01);
        if (!pivotCandle) return { strength: 'NORMAL', confirmed: false, volumeRatio: 0 };

        const volumeAtPivot = pivotCandle.volume;
        const avgVolume = candles.slice(-30).reduce((a, b) => a + b.volume, 0) / 30;
        const volumeRatio = volumeAtPivot / avgVolume;

        let strength = 'NORMAL';
        let confirmed = false;

        if (volumeRatio >= 2) {
            strength = 'EXPLOSIVO 🚀';
            confirmed = true;
        } else if (volumeRatio >= 1.5) {
            strength = 'ALTO 🔥';
            confirmed = true;
        } else if (volumeRatio >= 1.2) {
            strength = 'BOM ✅';
            confirmed = true;
        }

        return { strength, confirmed, volumeRatio: volumeRatio.toFixed(1) };
    } catch (error) {
        return { strength: 'NORMAL', confirmed: false, volumeRatio: 0 };
    }
}

function calculatePremiumDiscount(currentPrice, valueAreaLow, valueAreaHigh) {
    const range = valueAreaHigh - valueAreaLow;
    const discountZone = valueAreaLow + range * 0.3;
    const premiumZone = valueAreaHigh - range * 0.3;

    let zone = 'JUSTO';
    let recommendation = 'NEUTRO';
    let emoji = '➡️';

    if (currentPrice <= discountZone) {
        zone = 'DESCONTO';
        recommendation = 'ATENTO PARA COMPRA';
        emoji = '🟢';
    } else if (currentPrice >= premiumZone) {
        zone = 'PRÊMIO';
        recommendation = 'ATENTO PARA VENDA';
        emoji = '🔴';
    }

    return { zone, recommendation, emoji };
}

function getValueArea(candles) {
    if (!candles || candles.length < 50) {
        const prices = candles?.map(c => c.close) || [0];
        const avg = prices.reduce((a, b) => a + b, 0) / (prices.length || 1);
        return { low: avg * 0.95, high: avg * 1.05 };
    }

    const closes = candles.map(c => c.close);
    closes.sort((a, b) => a - b);
    const startIndex = Math.floor(closes.length * 0.3);
    const endIndex = Math.floor(closes.length * 0.7);
    
    return {
        low: closes[startIndex],
        high: closes[endIndex]
    };
}

function calculateOTE(high, low, direction) {
    const range = high - low;
    
    if (direction === 'BUY') {
        return {
            entry: low + range * 0.705,
            invalidation: low,
            target1: high,
            target2: high + range * 0.5,
            target3: high + range * 1.0,
            level: '70.5%',
            emoji: '📈'
        };
    } else {
        return {
            entry: high - range * 0.79,
            invalidation: high,
            target1: low,
            target2: low - range * 0.5,
            target3: low - range * 1.0,
            level: '79%',
            emoji: '📉'
        };
    }
}

function detectBreakerBlocks(orderBlocks, currentPrice) {
    const breakerBlocks = [];
    
    for (const ob of orderBlocks) {
        if (ob.wasMitigated) {
            const isBreakerValid = ob.type === 'BULLISH' ? currentPrice > ob.price : currentPrice < ob.price;
            if (isBreakerValid) {
                breakerBlocks.push({
                    price: ob.price,
                    type: ob.type === 'BULLISH' ? 'BEARISH_BREAKER' : 'BULLISH_BREAKER',
                    strength: 'ALTA',
                    quality: 'EXCELENTE',
                    emoji: ob.type === 'BULLISH' ? '🔻' : '🔺'
                });
            }
        }
    }
    
    return breakerBlocks;
}

function findOrderBlocksWithValidation(candles, lookback = 50) {
    const bullishOB = [];
    const bearishOB = [];
    const avgVolume = candles.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;
   
    for (let i = 3; i < Math.min(candles.length, lookback); i++) {
        const candle = candles[i];
        const candle1 = candles[i-1];
        const candle2 = candles[i-2];
        const candle3 = candles[i-3];
        
        if (candle2.close < candle3.close && candle1.close < candle2.close &&
            candle.close > candle1.high && candle.volume > avgVolume * 1.2) {
            
            const volumeStrength = candle.volume > avgVolume * 1.5 ? 'FORTE' : 'NORMAL';
            bullishOB.push({ 
                price: candle2.low, 
                type: 'BULLISH',
                volumeStrength,
                wasMitigated: false,
                quality: volumeStrength === 'FORTE' ? 'ALTA' : 'MÉDIA'
            });
        }
       
        if (candle2.close > candle3.close && candle1.close > candle2.close &&
            candle.close < candle1.low && candle.volume > avgVolume * 1.2) {
            
            const volumeStrength = candle.volume > avgVolume * 1.5 ? 'FORTE' : 'NORMAL';
            bearishOB.push({ 
                price: candle2.high, 
                type: 'BEARISH',
                volumeStrength,
                wasMitigated: false,
                quality: volumeStrength === 'FORTE' ? 'ALTA' : 'MÉDIA'
            });
        }
    }
   
    return { bullishOB, bearishOB };
}

function updateMitigationStatus(orderBlocks, currentPrice, tolerance = 0.002) {
    for (const ob of orderBlocks.bullishOB) {
        const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
        if (diffPercent <= tolerance * 100) {
            ob.wasMitigated = true;
        }
    }
    for (const ob of orderBlocks.bearishOB) {
        const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
        if (diffPercent <= tolerance * 100) {
            ob.wasMitigated = true;
        }
    }
    return orderBlocks;
}

function checkMitigationAdvanced(orderBlocks, currentPrice, tolerance = 0.002, type = 'bearish') {
    const blocks = type === 'bearish' ? orderBlocks.bearishOB : orderBlocks.bullishOB;
    for (const ob of blocks) {
        const diffPercent = Math.abs((currentPrice - ob.price) / ob.price) * 100;
        if (diffPercent <= tolerance * 100) {
            return { mitigated: true, price: ob.price, diffPercent: diffPercent, quality: ob.quality, volumeStrength: ob.volumeStrength };
        }
    }
    return { mitigated: false };
}

async function analyzeMultiTimeframeEMAs(symbol) {
    try {
        const cacheKey = `${symbol}_ema_multi`;
        const now = Date.now();
        const cached = emaCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        const maxPeriod = Math.max(...Object.values(CONFIG.MONITOR.EMA_PERIODS));
        const timeframes = ['15m', '1h', '4h'];
        const result = {};
        const [candles15m, candles1h, candles4h] = await Promise.all([
            getCandles(symbol, '15m', maxPeriod + 10),
            getCandles(symbol, '1h', maxPeriod + 10),
            getCandles(symbol, '4h', maxPeriod + 10)
        ]);
        const timeframesData = { '15m': candles15m, '1h': candles1h, '4h': candles4h };
        const periods = CONFIG.MONITOR.EMA_PERIODS;
        for (const tf of timeframes) {
            const candles = timeframesData[tf];
            if (!candles || candles.length < maxPeriod) continue;
            const closes = candles.map(c => c.close);
            const currentPrice = closes[closes.length - 1];
            const emas = {};
            emas.FAST = calculateEMA(closes, periods.FAST);
            emas.SHORT = calculateEMA(closes, periods.SHORT);
            emas.MEDIUM = calculateEMA(closes, periods.MEDIUM);
            emas.LONG = calculateEMA(closes, periods.LONG);
            emas.VERY_LONG = calculateEMA(closes, periods.VERY_LONG);
            emas.EXTREME = calculateEMA(closes, periods.EXTREME);
            let aboveCount = 0, belowCount = 0;
            for (const value of Object.values(emas)) {
                if (value !== null) {
                    if (currentPrice > value) aboveCount++;
                    if (currentPrice < value) belowCount++;
                }
            }
            const isAboveEMA13 = currentPrice > emas.SHORT;
            const isAboveEMA34 = currentPrice > emas.MEDIUM;
            const isAboveEMA55 = currentPrice > emas.LONG;
            let trend = 'NEUTRA', confidence = 50, direction = '';
            if (isAboveEMA13 && isAboveEMA34 && isAboveEMA55 && aboveCount >= 4) {
                trend = 'ALTA';
                confidence = Math.min(75 + (aboveCount * 2), 94);
                direction = '🟢';
            } else if (!isAboveEMA13 && !isAboveEMA34 && !isAboveEMA55 && belowCount >= 4) {
                trend = 'BAIXA';
                confidence = Math.min(75 + (belowCount * 2), 94);
                direction = '🔴';
            } else if (isAboveEMA13 && isAboveEMA34 && aboveCount >= 3) {
                trend = 'ALTA';
                confidence = 65;
                direction = '🟢';
            } else if (!isAboveEMA13 && !isAboveEMA34 && belowCount >= 3) {
                trend = 'BAIXA';
                confidence = 65;
                direction = '🔴';
            } else if (isAboveEMA13 && aboveCount >= 2) {
                trend = 'ALTA';
                confidence = 55;
                direction = '🟢';
            } else if (!isAboveEMA13 && belowCount >= 2) {
                trend = 'BAIXA';
                confidence = 55;
                direction = '🔴';
            }
            result[tf] = { trend, confidence, direction, aboveCount, belowCount, isAboveEMA13, isAboveEMA34, isAboveEMA55 };
        }
        addToCache(emaCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMAs: ${error.message}`);
        return null;
    }
}

function detectRSIDivergences(prices, rsiValues, timeframe) {
    if (prices.length < 30 || rsiValues.length < 30) return { bullish: [], bearish: [] };
    const pricePivots = findPivots(prices, 5);
    const rsiPivots = findPivots(rsiValues, 5);
    const divergences = { bullish: [], bearish: [] };
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            const priceLower = priceLow2.value < priceLow1.value;
            const priceDistance = Math.abs(priceLow2.index - priceLow1.index);
            if (priceLower && priceDistance >= 5) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 3);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 3);
                if (rsiLow1 && rsiLow2 && rsiLow2.value > rsiLow1.value) {
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.DIVERGENCE_MIN_STRENGTH) {
                        divergences.bullish.push({ type: 'bullish', timeframe: timeframe, strength: strength });
                    }
                }
            }
        }
    }
    
    for (let i = 0; i < pricePivots.highs.length; i++) {
        for (let j = i + 1; j < pricePivots.highs.length; j++) {
            const priceHigh1 = pricePivots.highs[i];
            const priceHigh2 = pricePivots.highs[j];
            const priceHigher = priceHigh2.value > priceHigh1.value;
            const priceDistance = Math.abs(priceHigh2.index - priceHigh1.index);
            if (priceHigher && priceDistance >= 5) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 3);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 3);
                if (rsiHigh1 && rsiHigh2 && rsiHigh2.value < rsiHigh1.value) {
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    if (strength >= CONFIG.MONITOR.SMC.DIVERGENCE_MIN_STRENGTH) {
                        divergences.bearish.push({ type: 'bearish', timeframe: timeframe, strength: strength });
                    }
                }
            }
        }
    }
    return divergences;
}

async function checkDivergenceOnTimeframe(symbol, timeframe, type) {
    try {
        const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
        if (!candles || candles.length < 50) return false;
        
        const prices = candles.map(c => c.close);
        const rsiValues = [];
        for (let i = 14; i < prices.length; i++) {
            const slice = prices.slice(i - 14, i + 1);
            rsiValues.push(calculateRSI(slice, 14));
        }
        if (rsiValues.length < 30) return false;
        
        const divergences = detectRSIDivergences(prices, rsiValues, timeframe);
        
        if (type === 'BUY') {
            return divergences.bullish.length > 0;
        } else if (type === 'SELL') {
            return divergences.bearish.length > 0;
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function checkDivergence15m(symbol, type) {
    return await checkDivergenceOnTimeframe(symbol, '15m', type);
}

async function checkDivergenceOtherTF(symbol, type) {
    try {
        const timeframes = ['30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        
        for (const tf of timeframes) {
            const hasDiv = await checkDivergenceOnTimeframe(symbol, tf, type);
            if (hasDiv) {
                return true;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function getDivergenceTimeframesList(symbol, type) {
    try {
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        const detected = [];
        
        for (const tf of timeframes) {
            const hasDiv = await checkDivergenceOnTimeframe(symbol, tf, type);
            if (hasDiv) {
                detected.push(tf);
            }
        }
        
        return detected;
    } catch (error) {
        return [];
    }
}

async function analyzeDivergences(symbol) {
    try {
        const cacheKey = `${symbol}_divergences`;
        const now = Date.now();
        const cached = divergenceCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        const timeframes = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'];
        const result = { bullish: [], bearish: [], hasBullish: false, hasBearish: false, summary: '' };
        for (const tf of timeframes) {
            try {
                const candles = await getCandles(symbol, tf, CONFIG.MONITOR.SMC.DIVERGENCE_LOOKBACK);
                if (!candles || candles.length < 50) continue;
                const prices = candles.map(c => c.close);
                const rsiValues = [];
                for (let i = 14; i < prices.length; i++) {
                    const slice = prices.slice(i - 14, i + 1);
                    rsiValues.push(calculateRSI(slice, 14));
                }
                if (rsiValues.length < 30) continue;
                const divergences = detectRSIDivergences(prices, rsiValues, tf);
                if (divergences.bullish.length > 0) {
                    result.bullish.push(...divergences.bullish);
                    result.hasBullish = true;
                }
                if (divergences.bearish.length > 0) {
                    result.bearish.push(...divergences.bearish);
                    result.hasBearish = true;
                }
            } catch (error) {}
        }
        if (result.hasBullish && result.hasBearish) {
            result.summary = '🔄 Divergências RSI Mistas';
        } else if (result.hasBullish) {
            result.summary = `🟢 Divergência RSI de ALTA em: ${result.bullish.map(d => d.timeframe).join(', ')}`;
        } else if (result.hasBearish) {
            result.summary = `🔴 Divergência RSI de BAIXA em: ${result.bearish.map(d => d.timeframe).join(', ')}`;
        }
        addToCache(divergenceCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return { bullish: [], bearish: [], hasBullish: false, hasBearish: false, summary: '' };
    }
}

async function calculateStochastic(symbol, timeframe, kPeriod = 5, dPeriod = 3, slowing = 3) {
    try {
        const cacheKey = `${symbol}_stoch_${timeframe}_${kPeriod}_${dPeriod}_${slowing}`;
        const now = Date.now();
        const cached = stochCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 20) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const kValues = [];
        for (let i = kPeriod - 1; i < closes.length; i++) {
            const highestHigh = Math.max(...highs.slice(i - (kPeriod - 1), i + 1));
            const lowestLow = Math.min(...lows.slice(i - (kPeriod - 1), i + 1));
            const rawK = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
            kValues.push(rawK);
        }
        
        const smoothedK = [];
        for (let i = slowing - 1; i < kValues.length; i++) {
            const sum = kValues.slice(i - (slowing - 1), i + 1).reduce((a, b) => a + b, 0);
            smoothedK.push(sum / slowing);
        }
        
        const dValues = [];
        for (let i = dPeriod - 1; i < smoothedK.length; i++) {
            const sum = smoothedK.slice(i - (dPeriod - 1), i + 1).reduce((a, b) => a + b, 0);
            dValues.push(sum / dPeriod);
        }
        
        const currentK = smoothedK[smoothedK.length - 1];
        const currentD = dValues[dValues.length - 1];
        const prevK = smoothedK.length > 1 ? smoothedK[smoothedK.length - 2] : currentK;
        
        const kTrend = currentK > prevK ? '↑' : (currentK < prevK ? '↓' : '→');
        let kEmoji = '';
        if (currentK < 15) kEmoji = '🔵';
        else if (currentK < 25) kEmoji = '🟢';
        else if (currentK < 45) kEmoji = '🟡';
        else if (currentK < 70) kEmoji = '🟠';
        else if (currentK <= 85) kEmoji = '🔴';
        else kEmoji = '🔥';
        
        const result = { 
            k: currentK.toFixed(0), 
            d: currentD ? currentD.toFixed(0) : '--',
            kTrend, 
            kEmoji,
            display: `${kEmoji}K${currentK.toFixed(0)}(${kTrend}) D${currentD ? currentD.toFixed(0) : '--'}`
        };
        
        addToCache(stochCache, cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

function detectFVG(candles) {
    if (!candles || candles.length < 3) return { bullish: [], bearish: [] };
    const bullishFVGs = [], bearishFVGs = [];
    for (let i = 0; i < candles.length - 2; i++) {
        const candle1 = candles[i], candle3 = candles[i + 2];
        if (candle1.low > candle3.high) {
            bullishFVGs.push({ top: candle1.low, bottom: candle3.high, gapSize: ((candle1.low - candle3.high) / candle3.high) * 100, type: 'bullish', isBullish: true });
        }
        if (candle1.high < candle3.low) {
            bearishFVGs.push({ top: candle3.low, bottom: candle1.high, gapSize: ((candle3.low - candle1.high) / candle1.high) * 100, type: 'bearish', isBearish: true });
        }
    }
    return { bullish: bullishFVGs, bearish: bearishFVGs };
}

async function validateFVGCruzado(symbol, fvgPrice, type) {
    try {
        const timeframes = ['15m', '1h', '4h'];
        const confirmations = [];
        
        for (const tf of timeframes) {
            const candles = await getCandles(symbol, tf, 100);
            if (!candles) continue;
            const fvgs = detectFVG(candles);
            
            if (type === 'BULLISH') {
                const hasFVG = fvgs.bullish.some(f => Math.abs(f.bottom - fvgPrice) / fvgPrice < 0.005);
                confirmations.push(hasFVG);
            } else {
                const hasFVG = fvgs.bearish.some(f => Math.abs(f.top - fvgPrice) / fvgPrice < 0.005);
                confirmations.push(hasFVG);
            }
        }
        
        const confirmedCount = confirmations.filter(c => c).length;
        return {
            confirmed: confirmedCount >= 2,
            strength: confirmedCount === 3 ? 'ALTA 🎯' : (confirmedCount === 2 ? 'MÉDIA ✅' : 'BAIXA ⚠️'),
            multipleTimeframes: confirmedCount
        };
    } catch (error) {
        return { confirmed: false, strength: 'BAIXA', multipleTimeframes: 0 };
    }
}

function findClosestConfirmedFVG(fvgs, currentPrice, currentCandles, type = null) {
    const fvgsToCheck = type === 'bullish' ? fvgs.bullish : (type === 'bearish' ? fvgs.bearish : [...fvgs.bullish, ...fvgs.bearish]);
    if (fvgsToCheck.length === 0) return null;
    let closest = null, minDistance = Infinity;
    for (const fvg of fvgsToCheck) {
        let distance, targetPrice, status;
        if (fvg.isBullish) {
            targetPrice = fvg.bottom;
            if (currentPrice <= fvg.bottom) { distance = ((fvg.bottom - currentPrice) / currentPrice) * 100; status = 'abaixo'; }
            else if (currentPrice >= fvg.top) { distance = ((currentPrice - fvg.top) / currentPrice) * 100; status = 'acima'; }
            else { distance = 0; status = 'dentro'; }
        } else {
            targetPrice = fvg.top;
            if (currentPrice >= fvg.top) { distance = ((currentPrice - fvg.top) / currentPrice) * 100; status = 'acima'; }
            else if (currentPrice <= fvg.bottom) { distance = ((fvg.bottom - currentPrice) / currentPrice) * 100; status = 'abaixo'; }
            else { distance = 0; status = 'dentro'; }
        }
        const qualityScore = fvg.gapSize > 0.5 ? 3 : (fvg.gapSize > 0.2 ? 2 : 1);
        if (distance < minDistance) {
            minDistance = distance;
            closest = { ...fvg, distancePercent: distance, targetPrice, status, qualityScore, displayDistance: distance === 0 ? '' : `${distance.toFixed(2)}% ${status === 'abaixo' ? '📈 para chegar' : '📉 para chegar'}` };
        }
    }
    return closest;
}

async function analyzeFVG(symbol, timeframe, currentPrice) {
    try {
        const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.SMC.LOOKBACK_CANDLES);
        if (!candles || candles.length < 30) return null;
        const fvgs = detectFVG(candles);
        const closestBullish = findClosestConfirmedFVG(fvgs, currentPrice, candles, 'bullish');
        const closestBearish = findClosestConfirmedFVG(fvgs, currentPrice, candles, 'bearish');
        
        let bullishValidation = null;
        let bearishValidation = null;
        
        if (closestBullish) {
            bullishValidation = await validateFVGCruzado(symbol, closestBullish.targetPrice, 'BULLISH');
        }
        if (closestBearish) {
            bearishValidation = await validateFVGCruzado(symbol, closestBearish.targetPrice, 'BEARISH');
        }
        
        return { timeframe, closestBullish, closestBearish, bullishValidation, bearishValidation };
    } catch (error) { return null; }
}

function detectLiquiditySweep(candles, currentPrice) {
    if (!candles || candles.length < 30) return null;
    const recentHighs = candles.slice(-25).map(c => c.high);
    const recentLows = candles.slice(-25).map(c => c.low);
    const maxHigh = Math.max(...recentHighs);
    const minLow = Math.min(...recentLows);
    const isSweepingHigh = currentPrice > maxHigh && (currentPrice - maxHigh) / maxHigh < 0.01;
    const isSweepingLow = currentPrice < minLow && (minLow - currentPrice) / minLow < 0.01;
    if (isSweepingHigh) return { direction: 'SELL', isSweep: true, price: maxHigh };
    if (isSweepingLow) return { direction: 'BUY', isSweep: true, price: minLow };
    return null;
}

function detectStructureBreaks(candles) {
    if (!candles || candles.length < 20) return { bullish: false, bearish: false, description: '' };
    const highs = [], lows = [];
    for (let i = 5; i < candles.length - 5; i++) {
        let isHigh = true, isLow = true;
        for (let j = 1; j <= 5; j++) {
            if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
            if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
        }
        if (isHigh) highs.push({ index: i, price: candles[i].high });
        if (isLow) lows.push({ index: i, price: candles[i].low });
    }
    let hasRecentBullishBreak = false, hasRecentBearishBreak = false;
    for (let i = 1; i < highs.length; i++) {
        if (highs[i].price > highs[i-1].price && candles.length - highs[i].index <= 10) hasRecentBullishBreak = true;
    }
    for (let i = 1; i < lows.length; i++) {
        if (lows[i].price < lows[i-1].price && candles.length - lows[i].index <= 10) hasRecentBearishBreak = true;
    }
    return { bullish: hasRecentBullishBreak, bearish: hasRecentBearishBreak, description: hasRecentBullishBreak ? 'CHoCH ALTA recente ✅' : (hasRecentBearishBreak ? 'CHoCH BAIXA recente ✅' : '') };
}

async function getCandleConfirmation(symbol, timeframe, expectedDirection) {
    try {
        const candles = await getCandles(symbol, timeframe, 3);
        if (!candles || candles.length < 2) return true;
        const lastClosedCandle = candles[candles.length - 2];
        if (expectedDirection === 'SELL') return lastClosedCandle.close < lastClosedCandle.open;
        if (expectedDirection === 'BUY') return lastClosedCandle.close > lastClosedCandle.open;
        return true;
    } catch (error) { return true; }
}

async function getOpenInterest(symbol) {
    try {
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const response = await fetch(url);
        const data = await response.json();
        return parseFloat(data.openInterest);
    } catch (error) { return null; }
}

async function analyzeOpenInterest(symbol) {
    try {
        const now = Date.now();
        const cached = oiHistoryCache.get(symbol);
        const currentOI = await getOpenInterest(symbol);
        if (!currentOI) return null;
        let oiChange = 0, oiDirection = 'estável', oiEmoji = '➡️';
        if (cached && cached.data && cached.data.currentOI) {
            oiChange = ((currentOI - cached.data.currentOI) / cached.data.currentOI) * 100;
            if (oiChange > 0.8) { oiDirection = 'subindo forte'; oiEmoji = '🚀💹'; }
            else if (oiChange > 0.3) { oiDirection = 'subindo'; oiEmoji = '📈'; }
            else if (oiChange < -0.8) { oiDirection = 'descendo forte'; oiEmoji = '📉🔻🚀'; }
            else if (oiChange < -0.3) { oiDirection = 'descendo'; oiEmoji = '📉'; }
        }
        const result = { current: currentOI, changePercent: oiChange, direction: oiDirection, emoji: oiEmoji, display: `${oiEmoji} ${(currentOI / 1000000).toFixed(1)}M ${oiDirection !== 'estável' ? `(${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}%)` : ''}` };
        addToCache(oiHistoryCache, symbol, { data: { currentOI, timestamp: now }, timestamp: now });
        return result;
    } catch (error) { return null; }
}

async function calculateATR(symbol, timeframe = '15m', period = 14) {
    const cacheKey = `${symbol}_atr_${timeframe}`;
    const now = Date.now();
    const cached = atrCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < 300000) return cached.data;
    const candles = await getCandles(symbol, timeframe, period + 10);
    if (!candles || candles.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close;
        trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    const atrPercent = (atr / candles[candles.length - 1].close) * 100;
    const result = { atr, atrPercent };
    addToCache(atrCache, cacheKey, { data: result, timestamp: now });
    return result;
}

async function getFundingRates(symbols) {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) if (symbols.includes(i.symbol)) result[i.symbol] = parseFloat(i.lastFundingRate);
        return result;
    } catch (error) { return {}; }
}

async function getLSRData(symbols) {
    try {
        const result = {};
        for (const symbol of symbols.slice(0, 30)) {
            try {
                await rateLimiter.acquire();
                const res = await fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`);
                const data = await res.json();
                if (data && data.length && data[0] && data[0].longShortRatio) {
                    const lsr = parseFloat(data[0].longShortRatio);
                    result[symbol] = { value: lsr, emoji: lsr > 1.2 ? '📈' : (lsr < 0.8 ? '📉' : '➡️') };
                }
                await delay(50);
            } catch { result[symbol] = null; }
        }
        return result;
    } catch (error) { return {}; }
}

async function getAllSymbols() {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        return data.filter(i => i.symbol.endsWith('USDT') && parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)).map(i => ({ symbol: i.symbol, price: parseFloat(i.lastPrice), volume24h: parseFloat(i.quoteVolume) }));
    } catch (error) {
        console.log(`⚠️ Erro ao buscar símbolos: ${error.message}`);
        return [];
    }
}

function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0];
    return { date, time, full: `${date} ${time}` };
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(4);
    if (price > 0.1) return price.toFixed(5);
    if (price > 0.01) return price.toFixed(6);
    return price.toFixed(8);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function calculateTargets(entryPrice, stopPrice, tradeType) {
    const riskAmount = Math.abs(entryPrice - stopPrice);
    const ratios = CONFIG.MONITOR.SMC.TARGETS;
    const partialPercents = CONFIG.MONITOR.SMC.PARTIAL_CLOSE;
    const targets = [];
    for (let i = 0; i < ratios.length; i++) {
        let targetPrice = tradeType === 'BUY' ? entryPrice + (riskAmount * ratios[i]) : entryPrice - (riskAmount * ratios[i]);
        let profitPercent = tradeType === 'BUY' ? ((targetPrice - entryPrice) / entryPrice) * 100 : ((entryPrice - targetPrice) / entryPrice) * 100;
        targets.push({ ratio: ratios[i], price: targetPrice, profitPercent, partialClose: partialPercents[i] });
    }
    return targets;
}

function calculateWeightedScore(analysis) {
    const weights = {
        timeframeAlignment: 7,
        fvgValidity: 17,
        liquiditySweep: 7,
        orderBlockMitigation: 7,
        volumeConfirmation: 17,
        divergenceConvergence: 12,
        higherTimeframe: 5,
        cciSignal: 7,
        lsrSignal: 7,
        fundingSignal: 5,
        macdDivergence: 12,
        unicornModel: 10,
        turtleSoup: 7,
        displacement: 7,
        killzone: 7
    };
    
    let totalScore = 0;
    let maxPossible = 0;
    
    if (analysis.timeframesAligned) {
        totalScore += weights.timeframeAlignment;
    }
    maxPossible += weights.timeframeAlignment;
    
    if (analysis.hasValidFVG) {
        totalScore += weights.fvgValidity;
    }
    maxPossible += weights.fvgValidity;
    
    if (analysis.hasLiquiditySweep) {
        totalScore += weights.liquiditySweep;
    }
    maxPossible += weights.liquiditySweep;
    
    if (analysis.hasOBMitigation) {
        totalScore += weights.orderBlockMitigation;
    }
    maxPossible += weights.orderBlockMitigation;
    
    if (analysis.volumeConfirmed) {
        totalScore += weights.volumeConfirmation;
    }
    maxPossible += weights.volumeConfirmation;
    
    if (analysis.hasDivergence) {
        totalScore += weights.divergenceConvergence;
    }
    maxPossible += weights.divergenceConvergence;
    
    if (analysis.higherTimeframeAligned) {
        totalScore += weights.higherTimeframe;
    }
    maxPossible += weights.higherTimeframe;
    
    if (analysis.hasCCICrossover) {
        totalScore += weights.cciSignal;
    }
    maxPossible += weights.cciSignal;
    
    if (analysis.lsrConfirmed) {
        totalScore += weights.lsrSignal;
    }
    maxPossible += weights.lsrSignal;
    
    if (analysis.fundingConfirmed) {
        totalScore += weights.fundingSignal;
    }
    maxPossible += weights.fundingSignal;
    
    if (analysis.hasMACDDivergence) {
        totalScore += weights.macdDivergence;
    }
    maxPossible += weights.macdDivergence;
    
    if (analysis.unicornDetected) {
        totalScore += weights.unicornModel;
    }
    maxPossible += weights.unicornModel;
    
    if (analysis.turtleSoupDetected) {
        totalScore += weights.turtleSoup;
    }
    maxPossible += weights.turtleSoup;
    
    if (analysis.displacementDetected && analysis.displacementPullback) {
        totalScore += weights.displacement;
    }
    maxPossible += weights.displacement;
    
    if (analysis.inKillzone) {
        totalScore += weights.killzone;
    }
    maxPossible += weights.killzone;
    
    const finalScore = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0;
    return finalScore;
}

function analyzeTimeframeConflict(emaAnalysis) {
    if (!emaAnalysis) return { level: 'NEUTRO', message: ' Tendências neutras', score: 0 };
    const trends = {
        tf15m: emaAnalysis['15m']?.trend || 'NEUTRA',
        h1: emaAnalysis['1h']?.trend || 'NEUTRA',
        h4: emaAnalysis['4h']?.trend || 'NEUTRA'
    };
    const trendValues = { 'ALTA': 1, 'NEUTRA': 0, 'BAIXA': -1 };
    const sum = trendValues[trends.tf15m] + trendValues[trends.h1] + trendValues[trends.h4];
    if (sum === 3) return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS (15m/1h/4h)', score: 100 };
    if (sum === 2 || sum === -2) return { level: 'LEVE', message: '🟡 2 de 3 alinhados - conflito leve', score: 66 };
    if (sum === 1 || sum === -1) return { level: 'MODERADO', message: '⚠️ Conflito MODERADO entre timeframes', score: 50 };
    if (sum === -3) return { level: 'ALINHADO', message: '✔︎ TODOS TIMEFRAMES ALINHADOS (15m/1h/4h)', score: 100 };
    return { level: 'ALTO', message: '🔴 ALTO CONFLITO - Aguardar confirmação', score: 25 };
}

function analyzeScoreQuality(score) {
    if (score >= 80) return { emoji: '🏆', message: 'Setup #TOP ', recommendation: 'Entrada normal' };
    if (score >= 65) return { emoji: '🔥', message: 'Setup #MUITO #BOM ', recommendation: 'Entrada normal' };
    if (score >= 50) return { emoji: '✅', message: 'Setup VÁLIDO ', recommendation: 'Entrada moderada' };
    return { emoji: '⚠️', message: 'Setup FRACO ', recommendation: 'Entrada reduzida (50%) ou aguardar' };
}

async function analyzeSMC(symbolData) {
    const { symbol: fullSymbol, price } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
   
    try {
        const emaAnalysis = await analyzeMultiTimeframeEMAs(fullSymbol);
        if (!emaAnalysis) return null;
        
        const primaryTrend = emaAnalysis['15m'];
        const secondaryTrend = emaAnalysis['1h'];
        
        if (!primaryTrend) return null;
        
        const [fifteenCandles, oneHourCandles, fourHourCandles] = await Promise.all([
            getCandles(fullSymbol, '15m', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES),
            getCandles(fullSymbol, '1h', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES),
            getCandles(fullSymbol, '4h', CONFIG.MONITOR.SMC.LOOKBACK_CANDLES)
        ]);
        
        const higherTimeframe = await analyzeHigherTimeframe(fullSymbol);
        
        const clusters = findClusterLevels(fifteenCandles, price, 0.5, 2);
        
        let supportsText = '';
        if (clusters.supports && clusters.supports.length > 0) {
            const supportStrings = clusters.supports.map(s => {
                const strength = getClusterStrength(s.touches);
                return `${formatPrice(s.avgPrice)} (${s.touches}x) ${strength.emoji} ${strength.text}`;
            });
            supportsText = supportStrings.join(' | ');
        }
        
        let resistancesText = '';
        if (clusters.resistances && clusters.resistances.length > 0) {
            const resistanceStrings = clusters.resistances.map(r => {
                const strength = getClusterStrength(r.touches);
                return `${formatPrice(r.avgPrice)} (${r.touches}x) ${strength.emoji} ${strength.text}`;
            });
            resistancesText = resistanceStrings.join(' | ');
        }
        
        const fvgAnalysis1h = await analyzeFVG(fullSymbol, '1h', price);
        const fvgAnalysis15m = await analyzeFVG(fullSymbol, '15m', price);
        const bullishFVG = fvgAnalysis15m?.closestBullish || fvgAnalysis1h?.closestBullish;
        const bearishFVG = fvgAnalysis15m?.closestBearish || fvgAnalysis1h?.closestBearish;
        
        const bullishFVGValidation = fvgAnalysis15m?.bullishValidation || fvgAnalysis1h?.bullishValidation;
        const bearishFVGValidation = fvgAnalysis15m?.bearishValidation || fvgAnalysis1h?.bearishValidation;
        
        const fourHourOB = findOrderBlocksWithValidation(fourHourCandles, 40);
        const oneHourOB = findOrderBlocksWithValidation(oneHourCandles, 40);
        
        updateMitigationStatus(fourHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE);
        updateMitigationStatus(oneHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE);
        
        const breakerBlocks = detectBreakerBlocks([...fourHourOB.bullishOB, ...fourHourOB.bearishOB, ...oneHourOB.bullishOB, ...oneHourOB.bearishOB], price);
        
        const valueArea = getValueArea(fifteenCandles);
        const premiumDiscount = calculatePremiumDiscount(price, valueArea.low, valueArea.high);
        
        const recentHigh = Math.max(...fifteenCandles.slice(-20).map(c => c.high));
        const recentLow = Math.min(...fifteenCandles.slice(-20).map(c => c.low));
        const oteBuy = calculateOTE(recentHigh, recentLow, 'BUY');
        const oteSell = calculateOTE(recentHigh, recentLow, 'SELL');
        
        const structureBreaks = detectStructureBreaks(fifteenCandles);
        const liquiditySweep = detectLiquiditySweep(fifteenCandles, price);
        const bearishMitigation = checkMitigationAdvanced(fourHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bearish') || checkMitigationAdvanced(oneHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bearish');
        const bullishMitigation = checkMitigationAdvanced(fourHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bullish') || checkMitigationAdvanced(oneHourOB, price, CONFIG.MONITOR.SMC.ORDER_BLOCK_TOLERANCE, 'bullish');
        
        const oiAnalysis = await analyzeOpenInterest(fullSymbol);
        const [fundingRates, lsrData, rsi] = await Promise.all([getFundingRates([fullSymbol]), getLSRData([fullSymbol]), getRSI(fullSymbol, '15m')]);
        const funding = fundingRates[fullSymbol];
        const lsr = lsrData[fullSymbol];
        
        const [stoch4h, stochDaily] = await Promise.all([
            calculateStochastic(fullSymbol, '4h', 5, 3, 3),
            calculateStochastic(fullSymbol, '1d', 5, 3, 3)
        ]);
        
        const cciAnalysis = await analyzeCCI(fullSymbol, '4h');
        const cciDailyAnalysis = await analyzeCCIDaily(fullSymbol);
        const divergences = await analyzeDivergences(fullSymbol);
        const macdDivergenceAnalysis = await analyzeMACDDivergences(fullSymbol, null);
        const conflictAnalysis = analyzeTimeframeConflict(emaAnalysis);
        
        // NOVAS DETECÇÕES
        const killzone = getCurrentKillzone();
        const inKillzone = isHighProbabilityTime();
        const liquidityPools = detectLiquidityPools(fifteenCandles);
        const displacement = detectDisplacement(fifteenCandles, price);
        const displacementPullback = displacementPullbackStrategy(displacement, price);
        const unicornModel = detectUnicornModel(fifteenCandles, price, { bullishOB: [...fourHourOB.bullishOB, ...oneHourOB.bullishOB], bearishOB: [...fourHourOB.bearishOB, ...oneHourOB.bearishOB] }, 
            { closestBullish: bullishFVG, closestBearish: bearishFVG }, liquiditySweep);
        const turtleSoup = detectTurtleSoup(fifteenCandles, price);
        
        let tradeSignal = null, entryPrice = null, structureData = null, setupDescription = '';
        let volumeConfirmed = false;
        let hasValidFVG = false;
        let hasLiquiditySweep = false;
        let hasOBMitigation = false;
        let timeframesAligned = false;
        let higherTimeframeAligned = false;
        let hasDivergence = false;
        let hasCCICrossover = false;
        let lsrConfirmed = false;
        let fundingConfirmed = false;
        let hasMACDDivergence = false;
        let macdDivergenceSummary = '';
        let unicornDetected = false;
        let turtleSoupDetected = false;
        let displacementDetected = false;
        let displacementPullbackDetected = false;
        let specialSetupText = '';
        
        const hasDiv15mBuy = await checkDivergence15m(fullSymbol, 'BUY');
        const hasDiv15mSell = await checkDivergence15m(fullSymbol, 'SELL');
        const hasDivOtherBuy = await checkDivergenceOtherTF(fullSymbol, 'BUY');
        const hasDivOtherSell = await checkDivergenceOtherTF(fullSymbol, 'SELL');
        
        const hasMACDBuy = await checkMACDDivergence15m(fullSymbol, 'BUY') || await checkMACDDivergenceOtherTF(fullSymbol, 'BUY');
        const hasMACDSell = await checkMACDDivergence15m(fullSymbol, 'SELL') || await checkMACDDivergenceOtherTF(fullSymbol, 'SELL');
        
        const macdBuyTimeframes = hasMACDBuy ? await getMACDDivergenceTimeframesList(fullSymbol, 'BUY') : [];
        const macdSellTimeframes = hasMACDSell ? await getMACDDivergenceTimeframesList(fullSymbol, 'SELL') : [];
        
        const buyDivTimeframes = (hasDiv15mBuy || hasDivOtherBuy) ? await getDivergenceTimeframesList(fullSymbol, 'BUY') : [];
        const sellDivTimeframes = (hasDiv15mSell || hasDivOtherSell) ? await getDivergenceTimeframesList(fullSymbol, 'SELL') : [];
        
        // COMPRA (BUY)
        const isBuyTrendValid = (primaryTrend.trend === 'ALTA' && primaryTrend.isAboveEMA13) ||
                                (CONFIG.MONITOR.ALLOW_NEUTRAL_TREND && primaryTrend.trend === 'NEUTRA' && secondaryTrend?.trend === 'ALTA');
        
        if (isBuyTrendValid) {
            const isOverbought = isExtremeOverbought(rsi, stoch4h);
            const hasRequiredDivergence = hasDiv15mBuy && hasDivOtherBuy;
            
            if (cciAnalysis && cciAnalysis.direction === 'Alta') hasCCICrossover = true;
            if (lsr && lsr.value < 2.5) lsrConfirmed = true;
            if (funding && funding < 0) fundingConfirmed = true;
            
            if (hasMACDBuy) {
                hasMACDDivergence = true;
                macdDivergenceSummary = `🟢 MACD Bullish em: ${macdBuyTimeframes.join(', ')}`;
            }
            
            if (!isOverbought && hasRequiredDivergence) {
                let score = 0, reasons = [];
                const divergenciaTFs = buyDivTimeframes.filter(tf => tf !== '15m').join(', ');
                reasons.push(`🟢 DIVERGÊNCIA BULLISH (15m + ${divergenciaTFs}) - OBRIGATÓRIA`);
                
                const isFVGValid = bullishFVG && bullishFVG.distancePercent <= CONFIG.MONITOR.SMC.FVG_PROXIMITY_THRESHOLD;
                
                hasValidFVG = isFVGValid && bullishFVG;
                hasLiquiditySweep = liquiditySweep && liquiditySweep.direction === 'BUY';
                hasOBMitigation = bullishMitigation.mitigated;
                
                if (bullishFVG && isFVGValid) { 
                    score += bullishFVG.qualityScore === 3 ? 30 : (bullishFVG.qualityScore === 2 ? 25 : 20); 
                    reasons.push(`FVG Bullish ${bullishFVG.status === '' ? '' : ` ${bullishFVG.distancePercent.toFixed(2)}%`}`);
                    if (bullishFVGValidation?.confirmed) reasons.push(`FVG Validado (${bullishFVGValidation.multipleTimeframes} TFs)`);
                } else if (bullishFVG && !isFVGValid) {
                    reasons.push(`FVG Bullish distante (${bullishFVG.distancePercent.toFixed(2)}% > 1%) - ignorado`);
                }
                
                if (structureBreaks.bullish) { score += 20; reasons.push(structureBreaks.description); }
                if (liquiditySweep && liquiditySweep.direction === 'BUY') { score += 30; reasons.push('Liquidity Sweep'); hasLiquiditySweep = true; }
                if (bullishMitigation.mitigated) { score += 25; reasons.push(`Mitigação OB (${bullishMitigation.quality || 'MÉDIA'})`); hasOBMitigation = true; }
                if (oiAnalysis && (oiAnalysis.direction === 'subindo' || oiAnalysis.direction === 'subindo forte')) { score += 15; reasons.push('OI em alta'); }
                if (emaAnalysis['1h']?.trend === 'ALTA') { score += 10; reasons.push('EMA1h em alta'); }
                if (emaAnalysis['4h']?.trend === 'ALTA') { score += 5; reasons.push('EMA4h em alta'); }
                if (divergences.hasBullish) { score += 15; reasons.push(`Divergência RSI Bullish`); hasDivergence = true; }
                
                const volumeConf = await analyzeVolumeConfirmation(fullSymbol, bullishFVG?.targetPrice || price, 0);
                if (volumeConf.confirmed) { score += 10; reasons.push(`Volume ${volumeConf.strength} (${volumeConf.volumeRatio}x média)`); volumeConfirmed = true; }
                
                if (higherTimeframe.weeklyTrend === 'ALTA' || higherTimeframe.monthlyTrend === 'ALTA') {
                    score += 5;
                    reasons.push(`${higherTimeframe.marketPhase}`);
                    higherTimeframeAligned = true;
                }
                
                if (hasCCICrossover) {
                    score += 10;
                    reasons.push(`CCI Bullish Crossover (4h)`);
                }
                
                if (lsrConfirmed) {
                    score += 5;
                    reasons.push(`LSR favorável: ${lsr.value.toFixed(2)}`);
                }
                
                if (fundingConfirmed) {
                    score += 5;
                    reasons.push(`Funding negativo: ${(funding * 100).toFixed(3)}%`);
                }
                
                if (hasMACDDivergence) {
                    score += 5;
                    reasons.push(`MACD Bullish confirmado`);
                }
                
                if (unicornModel && unicornModel.detected) {
                    score += 30;
                    reasons.push(`🦄 UNICORN MODEL (Sweep:${formatPrice(unicornModel.sweepPrice)} + FVG:${formatPrice(unicornModel.fvgPrice)} + OB:${formatPrice(unicornModel.obPrice)})`);
                    unicornDetected = true;
                }
                
                if (turtleSoup && turtleSoup.detected && turtleSoup.direction === 'BUY') {
                    score += 25;
                    reasons.push(`🐢 TURTLE SOUP INVERSE (${turtleSoup.description})`);
                    turtleSoupDetected = true;
                }
                
                if (displacementPullback && displacementPullback.signal === 'BUY') {
                    score += 20;
                    reasons.push(`🔄 DISPLACEMENT PULLBACK (Gap ${displacementPullback.gapPercent}% Vol ${displacementPullback.volumeRatio}x)`);
                    displacementDetected = true;
                    displacementPullbackDetected = true;
                }
                
                if (inKillzone) {
                    score += 15;
                    reasons.push(`⏰ KILLZONE ATIVA: ${killzone.zone} (+${killzone.weight === 2.0 ? 'MÁXIMA LIQUIDEZ' : 'ALTA LIQUIDEZ'})`);
                }
                
                timeframesAligned = conflictAnalysis.level === 'ALINHADO';
                if (timeframesAligned) score += 10;
                
                if (score >= CONFIG.MONITOR.MIN_SCORE_ACCEPT && bullishFVG && isFVGValid) {
                    tradeSignal = 'BUY';
                    if (liquiditySweep) { entryPrice = price * 1.001; structureData = { sweepPrice: price }; }
                    else if (bullishMitigation.mitigated) { entryPrice = price * 1.002; structureData = { obPrice: price }; }
                    else if (bullishFVG) { entryPrice = bullishFVG.targetPrice * 1.001; }
                    else { entryPrice = price * 1.002; }
                    setupDescription = `${reasons.join(' + ')} (Score: ${score})`;
                    
                    if (unicornDetected) specialSetupText = `🦄 UNICORN MODEL CONFIRMADO (3 confluências perfeitas)`;
                    else if (turtleSoupDetected) specialSetupText = `🐢 TURTLE SOUP INVERSE (Caça a stops de venda)`;
                    else if (displacementPullbackDetected) specialSetupText = `🔄 DISPLACEMENT + FVG (Movimento institucional)`;
                }
            }
        }
        
        // VENDA (SELL)
        const isSellTrendValid = (primaryTrend.trend === 'BAIXA' && !primaryTrend.isAboveEMA13) ||
                                  (CONFIG.MONITOR.ALLOW_NEUTRAL_TREND && primaryTrend.trend === 'NEUTRA' && secondaryTrend?.trend === 'BAIXA');
        
        if (isSellTrendValid) {
            const isOversold = isExtremeOversold(rsi, stoch4h);
            const hasRequiredDivergence = hasDiv15mSell && hasDivOtherSell;
            
            if (cciAnalysis && cciAnalysis.direction === 'Baixa') hasCCICrossover = true;
            if (lsr && lsr.value > 2.5) lsrConfirmed = true;
            if (funding && funding > 0) fundingConfirmed = true;
            
            if (hasMACDSell) {
                hasMACDDivergence = true;
                macdDivergenceSummary = `🔴 MACD Bearish em: ${macdSellTimeframes.join(', ')}`;
            }
            
            if (!isOversold && hasRequiredDivergence) {
                let score = 0, reasons = [];
                const divergenciaTFs = sellDivTimeframes.filter(tf => tf !== '15m').join(', ');
                reasons.push(`🔴 DIVERGÊNCIA BEARISH (15m + ${divergenciaTFs}) - OBRIGATÓRIA`);
                
                const isFVGValid = bearishFVG && bearishFVG.distancePercent <= CONFIG.MONITOR.SMC.FVG_PROXIMITY_THRESHOLD;
                
                hasValidFVG = isFVGValid && bearishFVG;
                hasLiquiditySweep = liquiditySweep && liquiditySweep.direction === 'SELL';
                hasOBMitigation = bearishMitigation.mitigated;
                
                if (bearishFVG && isFVGValid) { 
                    score += bearishFVG.qualityScore === 3 ? 30 : (bearishFVG.qualityScore === 2 ? 25 : 20); 
                    reasons.push(`FVG Bearish ${bearishFVG.status === '' ? '' : ` ${bearishFVG.distancePercent.toFixed(2)}%`}`);
                    if (bearishFVGValidation?.confirmed) reasons.push(`FVG Validado (${bearishFVGValidation.multipleTimeframes} TFs)`);
                } else if (bearishFVG && !isFVGValid) {
                    reasons.push(`FVG Bearish distante (${bearishFVG.distancePercent.toFixed(2)}% > 1%) - ignorado`);
                }
                
                if (structureBreaks.bearish) { score += 20; reasons.push(structureBreaks.description); }
                if (liquiditySweep && liquiditySweep.direction === 'SELL') { score += 30; reasons.push('Liquidity Sweep'); hasLiquiditySweep = true; }
                if (bearishMitigation.mitigated) { score += 25; reasons.push(`Mitigação OB (${bearishMitigation.quality || 'MÉDIA'})`); hasOBMitigation = true; }
                if (oiAnalysis && (oiAnalysis.direction === 'subindo' || oiAnalysis.direction === 'subindo forte')) { score += 15; reasons.push('OI em alta'); }
                if (emaAnalysis['1h']?.trend === 'BAIXA') { score += 10; reasons.push('EMA1h em baixa'); }
                if (emaAnalysis['4h']?.trend === 'BAIXA') { score += 5; reasons.push('EMA4h em baixa'); }
                if (divergences.hasBearish) { score += 15; reasons.push(`Divergência RSI Bearish`); hasDivergence = true; }
                
                const volumeConf = await analyzeVolumeConfirmation(fullSymbol, bearishFVG?.targetPrice || price, 0);
                if (volumeConf.confirmed) { score += 10; reasons.push(`Volume ${volumeConf.strength} (${volumeConf.volumeRatio}x média)`); volumeConfirmed = true; }
                
                if (higherTimeframe.weeklyTrend === 'BAIXA' || higherTimeframe.monthlyTrend === 'BAIXA') {
                    score += 5;
                    reasons.push(`${higherTimeframe.marketPhase}`);
                    higherTimeframeAligned = true;
                }
                
                if (hasCCICrossover) {
                    score += 10;
                    reasons.push(`CCI Bearish Crossover (4h)`);
                }
                
                if (lsrConfirmed) {
                    score += 5;
                    reasons.push(`LSR favorável: ${lsr.value.toFixed(2)}`);
                }
                
                if (fundingConfirmed) {
                    score += 5;
                    reasons.push(`Funding positivo: ${(funding * 100).toFixed(3)}%`);
                }
                
                if (hasMACDDivergence) {
                    score += 5;
                    reasons.push(`MACD Bearish confirmado`);
                }
                
                if (unicornModel && unicornModel.detected) {
                    score += 30;
                    reasons.push(`🦄 UNICORN MODEL (Sweep:${formatPrice(unicornModel.sweepPrice)} + FVG:${formatPrice(unicornModel.fvgPrice)} + OB:${formatPrice(unicornModel.obPrice)})`);
                    unicornDetected = true;
                }
                
                if (turtleSoup && turtleSoup.detected && turtleSoup.direction === 'SELL') {
                    score += 25;
                    reasons.push(`🐢 TURTLE SOUP CLASSIC (${turtleSoup.description})`);
                    turtleSoupDetected = true;
                }
                
                if (displacementPullback && displacementPullback.signal === 'SELL') {
                    score += 20;
                    reasons.push(`🔄 DISPLACEMENT PULLBACK (Gap ${displacementPullback.gapPercent}% Vol ${displacementPullback.volumeRatio}x)`);
                    displacementDetected = true;
                    displacementPullbackDetected = true;
                }
                
                if (inKillzone) {
                    score += 15;
                    reasons.push(`⏰ KILLZONE ATIVA: ${killzone.zone} (+${killzone.weight === 2.0 ? 'MÁXIMA LIQUIDEZ' : 'ALTA LIQUIDEZ'})`);
                }
                
                timeframesAligned = conflictAnalysis.level === 'ALINHADO';
                if (timeframesAligned) score += 10;
                
                if (score >= CONFIG.MONITOR.MIN_SCORE_ACCEPT && bearishFVG && isFVGValid) {
                    tradeSignal = 'SELL';
                    if (liquiditySweep) { entryPrice = price * 0.999; structureData = { sweepPrice: price }; }
                    else if (bearishMitigation.mitigated) { entryPrice = price * 0.998; structureData = { obPrice: price }; }
                    else if (bearishFVG) { entryPrice = bearishFVG.targetPrice * 0.999; }
                    else { entryPrice = price * 0.998; }
                    setupDescription = `${reasons.join(' + ')} (Score: ${score})`;
                    
                    if (unicornDetected) specialSetupText = `🦄 UNICORN MODEL CONFIRMADO (3 confluências perfeitas)`;
                    else if (turtleSoupDetected) specialSetupText = `🐢 TURTLE SOUP CLASSIC (Caça a stops de compra)`;
                    else if (displacementPullbackDetected) specialSetupText = `🔄 DISPLACEMENT + FVG (Movimento institucional)`;
                }
            }
        }
        
        if (!tradeSignal) return null;
        
        const isConfirmed = await getCandleConfirmation(fullSymbol, '15m', tradeSignal);
        if (!isConfirmed) return null;
        
        const stopData = await calculateSmartStopLoss(fullSymbol, entryPrice, tradeSignal, price, structureData, fifteenCandles);
        const targets = calculateTargets(entryPrice, stopData.stopPrice, tradeSignal);
        
        let targetsText = '';
        for (let i = 0; i < targets.length; i++) {
            const t = targets[i];
            targetsText += `| ${i+1}: ${formatPrice(t.price)} (${t.profitPercent > 0 ? '+' : ''}${t.profitPercent.toFixed(1)}%) ${t.partialClose}% `;
        }
        
        const weightedScore = calculateWeightedScore({
            timeframesAligned,
            hasValidFVG,
            hasLiquiditySweep,
            hasOBMitigation,
            volumeConfirmed,
            hasDivergence,
            higherTimeframeAligned,
            hasCCICrossover,
            lsrConfirmed,
            fundingConfirmed,
            hasMACDDivergence,
            unicornDetected,
            turtleSoupDetected,
            displacementDetected: displacementPullbackDetected,
            inKillzone
        });
        
        if (weightedScore < CONFIG.MONITOR.MIN_SCORE_ACCEPT) {
            console.log(`❌ ${symbol} | Score ${weightedScore.toFixed(0)} < ${CONFIG.MONITOR.MIN_SCORE_ACCEPT} - ALERTA BLOQUEADO`);
            return null;
        }
        
        const scoreQuality = analyzeScoreQuality(weightedScore);
        
        const oteSuggested = tradeSignal === 'BUY' ? oteBuy : oteSell;
        const oteText = `${formatPrice(oteSuggested.entry)} (${oteSuggested.level})`;
        
        const lsrValueFormatted = lsr ? lsr.value.toFixed(2) : 'N/A';
        const lsrCheckFormatted = (tradeSignal === 'SELL' && lsrValueFormatted > 2.5) || (tradeSignal === 'BUY' && lsrValueFormatted < 2.5) ? '✅' : '';
        
        const fundingValueFormatted = funding ? (funding * 100).toFixed(3) : 'N/A';
        const fundingStatusFormatted = tradeSignal === 'SELL' ? 
            (funding > 0 ? 'positivo' : 'negativo') : 
            (funding < 0 ? 'negativo' : 'positivo');
        const fundingCheckFormatted = (tradeSignal === 'SELL' && funding > 0) || (tradeSignal === 'BUY' && funding < 0) ? '✅' : '';
        
        const rsiValueFormatted = rsi ? rsi.value.toFixed(0) : 'N/A';
        let rsiStatusFormatted = '';
        if (rsi) {
            if (rsi.value < 35) rsiStatusFormatted = 'sobrevendido';
            else if (rsi.value > 70) rsiStatusFormatted = 'sobrecomprado';
            else rsiStatusFormatted = 'neutro';
        }
        
        const stoch4hFormatted = stoch4h ? `K${stoch4h.k}${stoch4h.kTrend} D${stoch4h.d}` : '';
        const stochDailyFormatted = stochDaily ? `K${stochDaily.k}${stochDaily.kTrend} D${stochDaily.d}` : '';
        
        const supportShort = supportsText.split(' | ')[0]?.split(' ')[0] || 'N/A';
        const resistanceShort = resistancesText.split(' | ')[0]?.split(' ')[0] || 'N/A';
        
        const divTimeframesList = tradeSignal === 'BUY' ? buyDivTimeframes : sellDivTimeframes;
        
        const cci4hDisplay = cciAnalysis ? cciAnalysis.display : '➡️ Neutro';
        const cciDailyDisplay = cciDailyAnalysis ? cciDailyAnalysis.display : '➡️ Neutro';
        
        const stopComponentsShort = stopData.stopComponents.replace(/ \| /g, ' | ').substring(0, 60);
        
        // Montar texto de Liquidity Pools
        let liquidityPoolsText = '';
        if (liquidityPools && (liquidityPools.eqh.length > 0 || liquidityPools.eql.length > 0)) {
            const eqhShort = liquidityPools.eqh.slice(0, 2).map(e => formatPrice(e.price)).join('|');
            const eqlShort = liquidityPools.eql.slice(0, 2).map(e => formatPrice(e.price)).join('|');
            if (eqhShort) liquidityPoolsText += `EQH:${eqhShort} `;
            if (eqlShort) liquidityPoolsText += `EQL:${eqlShort} `;
            if (liquidityPools.bsl) liquidityPoolsText += `BSL:${formatPrice(liquidityPools.bsl.price)} `;
            if (liquidityPools.ssl) liquidityPoolsText += `SSL:${formatPrice(liquidityPools.ssl.price)}`;
        }
        
        // Montar texto do Displacement
        let displacementText = '';
        if (displacementPullbackDetected && displacementPullback) {
            displacementText = `Gap ${displacementPullback.gapPercent}% Vol ${displacementPullback.volumeRatio}x FVG:${displacementPullback.fvgDisplay}`;
        }
        
        return {
            symbol: symbol,
            fullSymbol: fullSymbol,
            price: price,
            tradeSignal: tradeSignal,
            entryPrice: entryPrice,
            stopPrice: stopData.stopPrice,
            stopPercent: stopData.stopPercent,
            stopType: stopData.stopType,
            stopComponents: stopComponentsShort,
            targetsText: targetsText,
            score: Math.round(weightedScore).toString(),
            scoreQuality: scoreQuality,
            divergenceInfo: divTimeframesList.join(','),
            macdDivergenceInfo: macdDivergenceSummary,
            hasMACDDivergence: hasMACDDivergence,
            bearishFVG: bearishFVG,
            bullishFVG: bullishFVG,
            structureBreaks: structureBreaks,
            premiumDiscount: premiumDiscount,
            oteText: oteText,
            rsiValue: rsiValueFormatted,
            rsiStatus: rsiStatusFormatted,
            rsiEmoji: rsi?.emoji || '',
            stoch4hFormatted: stoch4hFormatted,
            stochDailyFormatted: stochDailyFormatted,
            lsrValue: lsrValueFormatted,
            lsrCheck: lsrCheckFormatted,
            fundingValue: fundingValueFormatted,
            fundingStatus: fundingStatusFormatted,
            fundingCheck: fundingCheckFormatted,
            resistanceShort: resistanceShort,
            supportShort: supportShort,
            cci4hDisplay: cci4hDisplay,
            cciDailyDisplay: cciDailyDisplay,
            killzone: killzone,
            inKillzone: inKillzone,
            liquidityPoolsText: liquidityPoolsText,
            displacementText: displacementText,
            specialSetupText: specialSetupText,
            unicornDetected: unicornDetected,
            turtleSoupDetected: turtleSoupDetected,
            displacementPullbackDetected: displacementPullbackDetected
        };
       
    } catch (error) {
        console.log(`⚠️ Erro no SMC para ${fullSymbol}: ${error.message}`);
        return null;
    }
}

async function sendSMCAlert(analysis) {
    const dt = getBrazilianDateTime();
    const tradeEmoji = analysis.tradeSignal === 'SELL' ? '🔴' : '🟢';
    const tradeText = analysis.tradeSignal === 'SELL' ? 'VENDA' : 'COMPRA';
    
    const symbol = analysis.fullSymbol || `${analysis.symbol}USDT`;
    const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE%3A${symbol}`;
    const tvLinkText = `<a href="${tvLink}">🔍Ver_Gráfico</a>`;
    
    let scoreMedal = '';
    if (analysis.score >= 80) scoreMedal = '🏆 TOP';
    else if (analysis.score >= 65) scoreMedal = '🔥 MUITO BOM';
    else if (analysis.score >= 50) scoreMedal = '✅ VÁLIDO';
    else scoreMedal = '⚠️ FRACO';
    
    let fvgText = '';
    if (analysis.tradeSignal === 'SELL' && analysis.bearishFVG) {
        fvgText = `${formatPrice(analysis.bearishFVG.targetPrice)} `;
    } else if (analysis.tradeSignal === 'BUY' && analysis.bullishFVG) {
        fvgText = `${formatPrice(analysis.bullishFVG.targetPrice)} `;
    }
    
    let chochText = '';
    if (analysis.structureBreaks && analysis.structureBreaks.description) {
        chochText = `• ${analysis.structureBreaks.description}\n`;
    }
    
    let zoneText = '';
    if (analysis.premiumDiscount) {
        zoneText = `${analysis.premiumDiscount.emoji} ${analysis.premiumDiscount.zone}`;
    } else {
        zoneText = '➡️ JUSTO';
    }
    
    let killzoneText = '';
    if (analysis.inKillzone && analysis.killzone) {
        killzoneText = `⏰ ${analysis.killzone.zone} ${analysis.killzone.weight === 2.0 ? '🔥MÁXIMA LIQUIDEZ' : (analysis.killzone.weight >= 1.5 ? '⚡ALTA LIQUIDEZ' : '')}`;
    }
    
    let specialSetupHeader = '';
    if (analysis.specialSetupText) {
        specialSetupHeader = `🎯 ${analysis.specialSetupText}\n`;
    }
    
    let liquidityPoolsHeader = '';
    if (analysis.liquidityPoolsText) {
        liquidityPoolsHeader = `📊 LIQUIDITY POOLS: ${analysis.liquidityPoolsText}\n`;
    }
    
    let displacementHeader = '';
    if (analysis.displacementPullbackDetected && analysis.displacementText) {
        displacementHeader = `🔄 DISPLACEMENT: ${analysis.displacementText}\n`;
    }
    
    let message = ``;
    message += `<b>${tradeEmoji} ${tradeText} ${analysis.symbol}</b> - <code>${formatPrice(analysis.price)}</code>\n`;
    message += `<i>${dt.date.slice(0,5)} ${dt.time.slice(0,5)}hs</i> ${tvLinkText}\n`;
    if (killzoneText) message += `${killzoneText}\n`;
    message += `🔍🤖 IA Análise:\n`;
    message += `<b>#SCORE: ${analysis.score}</b> <i>${scoreMedal}</i>\n`;
    if (specialSetupHeader) message += `${specialSetupHeader}`;
    message += `<i>• Divergência RSI de ${analysis.tradeSignal === 'SELL' ? 'BAIXA' : 'ALTA'} (${analysis.divergenceInfo})</i>\n`;
    
    if (analysis.hasMACDDivergence && analysis.macdDivergenceInfo) {
        message += `<i>• ${analysis.macdDivergenceInfo}</i>\n`;
    }
    
    if (fvgText) {
        message += `<i>• FVG ${analysis.tradeSignal === 'SELL' ? 'Bearish' : 'Bullish'} a ${fvgText}</i>\n`;
    }
    
    if (displacementHeader) message += `${displacementHeader}`;
    if (liquidityPoolsHeader) message += `${liquidityPoolsHeader}`;
    if (chochText) message += `${chochText}`;
    
    message += `<i>• CCI 4h: ${analysis.cci4hDisplay}</i>\n`;
    message += `<i>• CCI 1D: ${analysis.cciDailyDisplay}</i>\n`;
    message += `<b>#Entrada:</b> <i>${formatPrice(analysis.entryPrice)}</i>\n`;
    message += `<b>#Entrada_OTE_ICT🐋:</b> <i>${analysis.oteText}</i>\n`;
    message += `<b>Alvos:</b> <i>${analysis.targetsText}</i>\n`;
    message += `<b>🛑 Stop:</b> <i>${formatPrice(analysis.stopPrice)} (${analysis.stopPercent.toFixed(0)}%) [${analysis.stopType}]</i>\n`;
    message += `<i>└─ ${analysis.stopComponents}</i>\n`;
    message += `<b>#SMC_Zone:</b> <i>${zoneText}</i>\n`;
    message += `<b>Indicadores:</b>\n`;
    message += `<i>• RSI ${analysis.rsiValue} (${analysis.rsiStatus}) ${analysis.rsiEmoji}</i>\n`;
    if (analysis.stoch4hFormatted && analysis.stochDailyFormatted) {
        message += `<i>• Stoch 4h: ${analysis.stoch4hFormatted} | Diário: ${analysis.stochDailyFormatted}</i>\n`;
    }
    message += `<i>• #LSR ${analysis.lsrValue} ${analysis.lsrCheck}</i>\n`;
    message += `<i>• Funding ${analysis.fundingValue}% (${analysis.fundingStatus}) ${analysis.fundingCheck}</i>\n`;
    message += `<b>🔺#RESISTÊNCIA:</b> <i>${analysis.resistanceShort}</i>\n`;
    message += `<b>🔻#SUPORTE:</b> <i>${analysis.supportShort}</i>\n`;
    message += `<i>✨ Titanium by @J4Rviz</i>`;
   
    await telegramQueue.add(message);
}

let isScanning = false;

async function scanAndAlert() {
    if (isScanning) return;
    isScanning = true;
   
    try {
        const symbols = await getAllSymbols();
        if (!symbols.length) return;
       
        console.log(`🔍 Escaneando ${symbols.length} símbolos...`);
        console.log(`📊 SCORE MÍNIMO OBRIGATÓRIO: ${CONFIG.MONITOR.MIN_SCORE_ACCEPT}`);
        let alertsSent = 0;
       
        for (const symbolData of symbols) {
            try {
                const analysis = await analyzeSMC(symbolData);
                if (!analysis) continue;
                
                const canSendAlert = canAlert(analysis.fullSymbol, analysis.tradeSignal, parseInt(analysis.score));
                
                if (analysis && canSendAlert) {
                    await sendSMCAlert(analysis);
                    markAlerted(analysis.fullSymbol, analysis.tradeSignal, parseInt(analysis.score));
                    alertsSent++;
                    const specialTag = analysis.unicornDetected ? '🦄' : (analysis.turtleSoupDetected ? '🐢' : (analysis.displacementPullbackDetected ? '🔄' : ''));
                    console.log(`✅ [${alertsSent}] ${specialTag} Alerta ${analysis.tradeSignal} para ${analysis.symbol} (Score: ${analysis.score})`);
                    await delay(5000);
                }
            } catch (error) {
                console.log(`⚠️ Erro ao processar ${symbolData.symbol}: ${error.message}`);
            }
        }
       
        console.log(`✅ Scan completo. ${alertsSent} alertas enviados.`);
       
    } catch (error) {
        console.log(`❌ Erro no scan: ${error.message}`);
    } finally {
        isScanning = false;
    }
}

async function sendInitMessage() {
    const msg = `<i>⚡ Titanium  ⚡</i>\n<i>Monitorando...</i>`;
    await telegramQueue.add(msg, true);
}

async function checkInternetConnection() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        await fetch('https://api.binance.com/api/v3/ping', { signal: controller.signal });
        clearTimeout(timeoutId);
        return true;
    } catch (error) {
        console.log(`⚠️ Sem conexão: ${error.message}`);
        return false;
    }
}

async function startMonitorWithReconnect() {
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_DELAY = 5000;
    let scanInterval = null;
    
    console.log('\n' + '='.repeat(70));
    console.log(' Titanium v2.0 - ICT Advanced SMC Scanner');
    console.log('='.repeat(70));
    console.log(`✅ Killzones ATIVAS | Unicorn Model ATIVO | Turtle Soup ATIVO | Displacement ATIVO`);
    console.log(`✅ SCORE MÍNIMO: ${CONFIG.MONITOR.MIN_SCORE_ACCEPT}`);
    console.log('='.repeat(70));
    
    while (true) {
        const hasInternet = await checkInternetConnection();
        
        if (!hasInternet) {
            reconnectAttempts++;
            const delayTime = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts - 1), 60000);
            console.log(`🌐 Sem internet. Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}. Reconectando em ${delayTime/1000}s...`);
            await delay(delayTime);
            continue;
        }
        
        reconnectAttempts = 0;
        
        try {
            console.log('✅ Conexão estabelecida. Iniciando monitor...');
            
            if (scanInterval) {
                clearInterval(scanInterval);
                scanInterval = null;
            }
            
            loadAlertedSymbols();
            await sendInitMessage();
            await scanAndAlert();
            
            scanInterval = setInterval(async () => {
                if (await checkInternetConnection()) {
                    await scanAndAlert();
                } else {
                    console.log('⚠️ Internet perdida, interrompendo scans...');
                    if (scanInterval) {
                        clearInterval(scanInterval);
                        scanInterval = null;
                    }
                }
            }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
            
            while (await checkInternetConnection()) {
                await delay(10000);
            }
            
            console.log('🔌 Conexão perdida! Tentando reconectar...');
            
        } catch (error) {
            console.log(`❌ Monitor falhou: ${error.message}`);
            
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log('🔴 Número máximo de tentativas. Encerrando...');
                process.exit(1);
            }
            
            const delayTime = Math.min(BASE_DELAY * Math.pow(2, reconnectAttempts), 60000);
            console.log(`🔄 Reconectando em ${delayTime/1000}s... (Tentativa ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            await delay(delayTime);
        }
    }
}

process.on('SIGINT', () => {
    console.log('🛑 Desligando Titanium Monitor...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.log(`❌ Erro não tratado: ${error.message}`);
    if (error.message.includes('fetch') || error.message.includes('network')) {
        console.log('🔄 Erro de rede detectado, o monitor tentará reconectar...');
    } else {
        console.log('⚠️ Reinicie o monitor se necessário');
    }
});

startMonitorWithReconnect().catch(console.error);
