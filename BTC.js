const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8g',
        CHAT_ID: '-1002559'
    },
    MONITOR: {
        SYMBOL: 'BTCUSDT',
        STOCH: {
            K_PERIOD: 5,
            D_PERIOD: 3,
            SLOW_K: 3,
            TIMEFRAMES: ['4h', '12h', '1d']
        },
        CCI: {
            PERIOD: 20,
            EMA_PERIOD: 5,
            TIMEFRAMES: ['4h', '1d']
        },
        RSI: {
            PERIOD: 14,
            TIMEFRAMES: ['15m', '1h', '4h'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCE_STRENGTH: 3,
            RSI_BUY_THRESHOLD: 60,
            RSI_SELL_THRESHOLD: 65
        },
        BOLLINGER: {
            PERIOD: 20,
            STD_DEVIATION: 2.2,
            TIMEFRAME: '15m',
            TOUCH_THRESHOLD: 0.04
        },
        STOP_LOSS: {
            ATR_MULTIPLIER: 2.5,
            MIN_STOP_PERCENT: 1.5,
            MAX_STOP_PERCENT: 5.0
        },
        TARGETS: {
            TP1_MULTIPLIER: 1.5,
            TP2_MULTIPLIER: 2.5,
            TP3_MULTIPLIER: 4.0
        },
        CVD: {
            BUY_THRESHOLD: 7,      // Score mínimo para alerta de CVD comprador (0-9)
            SELL_THRESHOLD: 7,     // Score mínimo para alerta de CVD vendedor (0-9)
            LOOKBACK_MINUTES: 5,   // Minutos para análise do CVD
            MIN_VOLUME_USD: 1000000 // Volume mínimo em USD para considerar alerta
        }
    },
    CACHE: {
        CLEANUP_INTERVAL: 3600000,
        MAX_CACHE_AGE: 3600000,
        COOLDOWN_DURATION: 3600000
    }
};

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS COM LIMPEZA AUTOMÁTICA ===
// =====================================================================
class TimedCache {
    constructor(maxAge = CONFIG.CACHE.MAX_CACHE_AGE) {
        this.cache = new Map();
        this.maxAge = maxAge;
        this.startCleanup();
    }

    set(key, value) {
        this.cache.set(key, {
            data: value,
            timestamp: Date.now()
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() - item.timestamp > this.maxAge) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    startCleanup() {
        setInterval(() => {
            for (const [key, item] of this.cache.entries()) {
                if (Date.now() - item.timestamp > this.maxAge) {
                    this.cache.delete(key);
                }
            }
        }, CONFIG.CACHE.CLEANUP_INTERVAL);
    }
}

const alertCooldown = new TimedCache(CONFIG.CACHE.COOLDOWN_DURATION);
const divergenceCache = new TimedCache(CONFIG.CACHE.MAX_CACHE_AGE);
const bollingerCache = new TimedCache(CONFIG.CACHE.MAX_CACHE_AGE);
const rsiCache = new TimedCache(CONFIG.CACHE.MAX_CACHE_AGE);
const stochCache = new TimedCache(CONFIG.CACHE.MAX_CACHE_AGE);
const cciCache = new TimedCache(CONFIG.CACHE.MAX_CACHE_AGE);
const clusterCache = { supports: [], resistances: [], lastUpdate: 0 };

// =====================================================================
// === FUNÇÃO PARA CALCULAR ESTOCÁSTICO ===
// =====================================================================
function calculateStochastic(highs, lows, closes, kPeriod = 5, dPeriod = 3, slowK = 3) {
    if (closes.length < kPeriod) return null;
    
    const kValues = [];
    
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const highestHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
        const lowestLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
        const currentClose = closes[i];
        
        let k = 0;
        if (highestHigh !== lowestLow) {
            k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        }
        kValues.push(k);
    }
    
    const slowKValues = [];
    for (let i = slowK - 1; i < kValues.length; i++) {
        const avgK = kValues.slice(i - slowK + 1, i + 1).reduce((a, b) => a + b, 0) / slowK;
        slowKValues.push(avgK);
    }
    
    const dValues = [];
    for (let i = dPeriod - 1; i < slowKValues.length; i++) {
        const avgD = slowKValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod;
        dValues.push(avgD);
    }
    
    const currentK = slowKValues[slowKValues.length - 1];
    const currentD = dValues[dValues.length - 1];
    const prevK = slowKValues.length > 1 ? slowKValues[slowKValues.length - 2] : currentK;
    const prevD = dValues.length > 1 ? dValues[dValues.length - 2] : currentD;
    
    let crossStatus = '⚪ ';
    let crossEmoji = '➖';
    
    if (prevK <= prevD && currentK > currentD) {
        crossStatus = '🟢 ';
        crossEmoji = '⤴️';
    } else if (prevK >= prevD && currentK < currentD) {
        crossStatus = '🔴 ';
        crossEmoji = '⤵️';
    }
    
    return {
        k: currentK,
        d: currentD,
        prevK: prevK,
        prevD: prevD,
        crossUp: prevK <= prevD && currentK > currentD,
        crossDown: prevK >= prevD && currentK < currentD,
        crossStatus: crossStatus,
        crossEmoji: crossEmoji
    };
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR CCI ===
// =====================================================================
function calculateCCI(highs, lows, closes, period = 20) {
    if (closes.length < period) return null;
    
    const typicalPrices = [];
    for (let i = 0; i < closes.length; i++) {
        typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
    }
    
    const cciValues = [];
    
    for (let i = period - 1; i < typicalPrices.length; i++) {
        const sma = typicalPrices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        
        let mad = 0;
        for (let j = i - period + 1; j <= i; j++) {
            mad += Math.abs(typicalPrices[j] - sma);
        }
        mad /= period;
        
        const cci = mad === 0 ? 0 : (typicalPrices[i] - sma) / (0.015 * mad);
        cciValues.push(cci);
    }
    
    const emaValues = [];
    const emaPeriod = CONFIG.MONITOR.CCI.EMA_PERIOD;
    
    for (let i = 0; i < cciValues.length; i++) {
        if (i === 0) {
            emaValues.push(cciValues[i]);
        } else {
            const multiplier = 2 / (emaPeriod + 1);
            const ema = (cciValues[i] - emaValues[i - 1]) * multiplier + emaValues[i - 1];
            emaValues.push(ema);
        }
    }
    
    const currentCCI = cciValues[cciValues.length - 1];
    const currentEMA = emaValues[emaValues.length - 1];
    const prevCCI = cciValues.length > 1 ? cciValues[cciValues.length - 2] : currentCCI;
    const prevEMA = emaValues.length > 1 ? emaValues[emaValues.length - 2] : currentEMA;
    
    let crossStatus = '⚪ NEUTRO';
    let crossEmoji = '➖';
    
    if (prevCCI <= prevEMA && currentCCI > currentEMA) {
        crossStatus = '💹 ';
        crossEmoji = '📈';
    } else if (prevCCI >= prevEMA && currentCCI < currentEMA) {
        crossStatus = '🔻 ';
        crossEmoji = '📉';
    } else if (currentCCI > currentEMA) {
        crossStatus = '💹 ';
        crossEmoji = '📈';
    } else if (currentCCI < currentEMA) {
        crossStatus = '🔻 ';
        crossEmoji = '📉';
    }
    
    return {
        cci: currentCCI,
        ema: currentEMA,
        prevCCI: prevCCI,
        prevEMA: prevEMA,
        crossUp: prevCCI <= prevEMA && currentCCI > currentEMA,
        crossDown: prevCCI >= prevEMA && currentCCI < currentEMA,
        crossStatus: crossStatus,
        crossEmoji: crossEmoji
    };
}

// =====================================================================
// === FUNÇÃO PARA BUSCAR CANDLES COM TRATAMENTO DE ERRO ===
// =====================================================================
async function getCandles(symbol, interval, limit = 150) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            console.log(`⚠️ Erro HTTP ${response.status} ao buscar candles ${symbol} ${interval}`);
            return [];
        }
        
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        
        return data.map(candle => ({
            open: parseFloat(candle[1]), 
            high: parseFloat(candle[2]), 
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]), 
            volume: parseFloat(candle[5]), 
            time: candle[0]
        }));
    } catch (error) {
        console.log(`⚠️ Erro ao buscar candles ${symbol} ${interval}: ${error.message}`);
        return [];
    }
}

// =====================================================================
// === OBTER ESTOCÁSTICO PARA TIMEFRAME ===
// =====================================================================
async function getStochastic(symbol, timeframe) {
    const cacheKey = `${symbol}_stoch_${timeframe}`;
    const cached = stochCache.get(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    try {
        const candles = await getCandles(symbol, timeframe, 150);
        if (!candles || candles.length < 50) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stoch = calculateStochastic(
            highs, lows, closes,
            CONFIG.MONITOR.STOCH.K_PERIOD,
            CONFIG.MONITOR.STOCH.D_PERIOD,
            CONFIG.MONITOR.STOCH.SLOW_K
        );
        
        stochCache.set(cacheKey, stoch);
        return stoch;
    } catch (error) {
        console.log(`⚠️ Erro no stochastic ${timeframe}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === OBTER CCI PARA TIMEFRAME ===
// =====================================================================
async function getCCI(symbol, timeframe) {
    const cacheKey = `${symbol}_cci_${timeframe}`;
    const cached = cciCache.get(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    try {
        const candles = await getCandles(symbol, timeframe, 150);
        if (!candles || candles.length < 50) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const cci = calculateCCI(highs, lows, closes, CONFIG.MONITOR.CCI.PERIOD);
        
        cciCache.set(cacheKey, cci);
        return cci;
    } catch (error) {
        console.log(`⚠️ Erro no CCI ${timeframe}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === BUSCAR CLUSTERS (SUPORTE E RESISTÊNCIA) ===
// =====================================================================
async function getClusters(symbol) {
    const now = Date.now();
    
    if (clusterCache.lastUpdate && (now - clusterCache.lastUpdate) < 120000) {
        if (clusterCache.supports.length > 0 || clusterCache.resistances.length > 0) {
            return clusterCache;
        }
    }
    
    try {
        const orderBookRes = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=100`);
        
        if (!orderBookRes.ok) {
            return clusterCache;
        }
        
        const orderBook = await orderBookRes.json();
        
        if (!orderBook.bids || !orderBook.asks) {
            return clusterCache;
        }
        
        const bids = orderBook.bids.map(b => parseFloat(b[0]));
        const asks = orderBook.asks.map(a => parseFloat(a[0]));
        
        const currentPrice = (bids[0] + asks[0]) / 2;
        const clusterPercent = 0.005;
        
        const supportClusters = [];
        const resistanceClusters = [];
        
        const usedBids = new Array(bids.length).fill(false);
        
        for (let i = 0; i < bids.length; i++) {
            if (usedBids[i]) continue;
            
            let clusterPrice = bids[i];
            let clusterCount = 1;
            let clusterPrices = [bids[i]];
            
            for (let j = i + 1; j < bids.length; j++) {
                if (usedBids[j]) continue;
                
                const diffPercent = Math.abs(bids[j] - bids[i]) / currentPrice * 100;
                if (diffPercent <= clusterPercent) {
                    clusterCount++;
                    clusterPrices.push(bids[j]);
                    clusterPrice = (clusterPrice + bids[j]) / 2;
                    usedBids[j] = true;
                }
            }
            
            usedBids[i] = true;
            
            const avgPrice = clusterPrices.reduce((a, b) => a + b, 0) / clusterPrices.length;
            const spread = Math.max(...clusterPrices) - Math.min(...clusterPrices);
            const density = clusterCount / (spread / currentPrice * 100);
            
            let strengthText = '💨 FRACO';
            if (clusterCount >= 15 || density > 50) strengthText = '🔥 FORTE';
            else if (clusterCount >= 8 || density > 25) strengthText = '⚠️ MÉDIO';
            
            supportClusters.push({
                price: avgPrice,
                count: clusterCount,
                strengthText: strengthText
            });
        }
        
        const usedAsks = new Array(asks.length).fill(false);
        
        for (let i = 0; i < asks.length; i++) {
            if (usedAsks[i]) continue;
            
            let clusterPrice = asks[i];
            let clusterCount = 1;
            let clusterPrices = [asks[i]];
            
            for (let j = i + 1; j < asks.length; j++) {
                if (usedAsks[j]) continue;
                
                const diffPercent = Math.abs(asks[j] - asks[i]) / currentPrice * 100;
                if (diffPercent <= clusterPercent) {
                    clusterCount++;
                    clusterPrices.push(asks[j]);
                    clusterPrice = (clusterPrice + asks[j]) / 2;
                    usedAsks[j] = true;
                }
            }
            
            usedAsks[i] = true;
            
            const avgPrice = clusterPrices.reduce((a, b) => a + b, 0) / clusterPrices.length;
            const spread = Math.max(...clusterPrices) - Math.min(...clusterPrices);
            const density = clusterCount / (spread / currentPrice * 100);
            
            let strengthText = '💨 FRACO';
            if (clusterCount >= 15 || density > 50) strengthText = '🔥 FORTE';
            else if (clusterCount >= 8 || density > 25) strengthText = '⚠️ MÉDIO';
            
            resistanceClusters.push({
                price: avgPrice,
                count: clusterCount,
                strengthText: strengthText
            });
        }
        
        supportClusters.sort((a, b) => b.count - a.count);
        resistanceClusters.sort((a, b) => b.count - a.count);
        
        const maxDistancePercent = 2;
        
        const filteredSupports = supportClusters.filter(s => 
            Math.abs(s.price - currentPrice) / currentPrice * 100 <= maxDistancePercent
        );
        
        const filteredResistances = resistanceClusters.filter(r => 
            Math.abs(r.price - currentPrice) / currentPrice * 100 <= maxDistancePercent
        );
        
        clusterCache.supports = filteredSupports.slice(0, 3);
        clusterCache.resistances = filteredResistances.slice(0, 3);
        clusterCache.lastUpdate = now;
        
        return clusterCache;
    } catch (error) {
        console.log(`⚠️ Erro ao buscar clusters: ${error.message}`);
        return clusterCache;
    }
}

// =====================================================================
// === FORMATAR MENSAGEM DE CLUSTERS ===
// =====================================================================
async function formatClustersMessage(symbol) {
    const clusters = await getClusters(symbol);
    
    let msg = '';
    
    if (clusters.supports.length > 0) {
        msg += `<i>🟢 SUPORTES:</i>\n`;
        for (const sup of clusters.supports) {
            msg += `<i>   📍 ${formatPrice(sup.price)} - ${sup.strengthText} (${sup.count} ordens)</i>\n`;
        }
    } else {
        msg += `<i>🟢 SUPORTES: Nenhum cluster relevante</i>\n`;
    }
    
    msg += `\n`;
    
    if (clusters.resistances.length > 0) {
        msg += `<i>🔴 RESISTÊNCIAS:</i>\n`;
        for (const res of clusters.resistances) {
            msg += `<i>   📍 ${formatPrice(res.price)} - ${res.strengthText} (${res.count} ordens)</i>\n`;
        }
    } else {
        msg += `<i>🔴 RESISTÊNCIAS: Nenhum cluster relevante</i>\n`;
    }
    
    return msg;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR RSI ===
// =====================================================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const rsiValues = [null];
    rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
        rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    }
    return rsiValues;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR BOLLINGER ===
// =====================================================================
function calculateBollingerBands(prices, period = 20, stdDev = 2.2) {
    if (prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
        sma: sma,
        upper: sma + (stdDev * standardDeviation),
        lower: sma - (stdDev * standardDeviation)
    };
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR ATR ===
// =====================================================================
async function calculateATR(symbol, timeframe = '1h', period = 14) {
    try {
        const candles = await getCandles(symbol, timeframe, period + 20);
        if (!candles || candles.length < period + 1) return null;
        
        const trValues = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i-1].close;
            trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        
        if (trValues.length < period) return null;
        
        const atr = trValues.slice(-period).reduce((a, b) => a + b, 0) / period;
        const currentPrice = candles[candles.length - 1].close;
        
        return { atr, atrPercent: (atr / currentPrice) * 100, currentPrice };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR STOP LOSS E ALVOS ===
// =====================================================================
function computeStopAndTargets(currentPrice, isLong, atr, candles = null) {
    const atrMultiplier = CONFIG.MONITOR.STOP_LOSS.ATR_MULTIPLIER;
    const minStopPercent = CONFIG.MONITOR.STOP_LOSS.MIN_STOP_PERCENT;
    const maxStopPercent = CONFIG.MONITOR.STOP_LOSS.MAX_STOP_PERCENT;
    
    let stopPrice;
    if (isLong) {
        stopPrice = currentPrice - (atr * atrMultiplier);
        let stopPercent = (currentPrice - stopPrice) / currentPrice * 100;
        
        if (stopPercent < minStopPercent) {
            stopPrice = currentPrice * (1 - minStopPercent / 100);
        } else if (stopPercent > maxStopPercent) {
            stopPrice = currentPrice * (1 - maxStopPercent / 100);
        }
        
        if (candles && candles.length > 20) {
            const relevantCandles = candles.slice(-20);
            const structureLow = Math.min(...relevantCandles.map(c => c.low));
            if (structureLow > stopPrice) {
                stopPrice = structureLow - (structureLow * 0.002);
            }
        }
        
        const tp1 = currentPrice + atr * CONFIG.MONITOR.TARGETS.TP1_MULTIPLIER;
        const tp2 = currentPrice + atr * CONFIG.MONITOR.TARGETS.TP2_MULTIPLIER;
        const tp3 = currentPrice + atr * CONFIG.MONITOR.TARGETS.TP3_MULTIPLIER;
        
        return { stop: stopPrice, tp1, tp2, tp3 };
    } else {
        stopPrice = currentPrice + (atr * atrMultiplier);
        let stopPercent = (stopPrice - currentPrice) / currentPrice * 100;
        
        if (stopPercent < minStopPercent) {
            stopPrice = currentPrice * (1 + minStopPercent / 100);
        } else if (stopPercent > maxStopPercent) {
            stopPrice = currentPrice * (1 + maxStopPercent / 100);
        }
        
        if (candles && candles.length > 20) {
            const relevantCandles = candles.slice(-20);
            const structureHigh = Math.max(...relevantCandles.map(c => c.high));
            if (structureHigh < stopPrice) {
                stopPrice = structureHigh + (structureHigh * 0.002);
            }
        }
        
        const tp1 = currentPrice - atr * CONFIG.MONITOR.TARGETS.TP1_MULTIPLIER;
        const tp2 = currentPrice - atr * CONFIG.MONITOR.TARGETS.TP2_MULTIPLIER;
        const tp3 = currentPrice - atr * CONFIG.MONITOR.TARGETS.TP3_MULTIPLIER;
        
        return { stop: stopPrice, tp1, tp2, tp3 };
    }
}

// =====================================================================
// === FUNÇÃO PARA ENCONTRAR PIVÔS MELHORADA ===
// =====================================================================
function findPivots(data, lookback = 3, minSignificance = 0.002) {
    const pivots = { highs: [], lows: [] };
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
            if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
        }
        
        if (isHigh) {
            const prevPivot = pivots.highs[pivots.highs.length - 1];
            if (!prevPivot || Math.abs(data[i] - prevPivot.value) / prevPivot.value >= minSignificance) {
                pivots.highs.push({ index: i, value: data[i] });
            }
        }
        if (isLow) {
            const prevPivot = pivots.lows[pivots.lows.length - 1];
            if (!prevPivot || Math.abs(data[i] - prevPivot.value) / prevPivot.value >= minSignificance) {
                pivots.lows.push({ index: i, value: data[i] });
            }
        }
    }
    
    return pivots;
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR DIVERGÊNCIAS MELHORADA ===
// =====================================================================
function findRSIDivergences(prices, rsiValues) {
    const divergences = { bullish: [], bearish: [] };
    
    if (prices.length < 30 || rsiValues.length < 30) return divergences;
    
    const pricePivots = findPivots(prices, 3);
    const rsiPivots = findPivots(rsiValues, 3);
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            
            if (priceLower) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 2);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 2);
                
                if (rsiLow1 && rsiLow2) {
                    const rsiHigher = rsiLow2.value > rsiLow1.value;
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    
                    if (rsiHigher && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        divergences.bullish.push({ 
                            strength: strength,
                            priceLow1: priceLow1.value,
                            priceLow2: priceLow2.value,
                            rsiLow1: rsiLow1.value,
                            rsiLow2: rsiLow2.value
                        });
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
            
            if (priceHigher) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 2);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 2);
                
                if (rsiHigh1 && rsiHigh2) {
                    const rsiLower = rsiHigh2.value < rsiHigh1.value;
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    
                    if (rsiLower && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        divergences.bearish.push({ 
                            strength: strength,
                            priceHigh1: priceHigh1.value,
                            priceHigh2: priceHigh2.value,
                            rsiHigh1: rsiHigh1.value,
                            rsiHigh2: rsiHigh2.value
                        });
                    }
                }
            }
        }
    }
    
    return divergences;
}

// =====================================================================
// === WEBHOOK TELEGRAM COM RATE LIMITING ===
// =====================================================================
let lastTelegramSend = 0;
const TELEGRAM_MIN_INTERVAL = 1000;

async function sendToTelegram(message) {
    try {
        const now = Date.now();
        const timeSinceLastSend = now - lastTelegramSend;
        if (timeSinceLastSend < TELEGRAM_MIN_INTERVAL) {
            await new Promise(resolve => setTimeout(resolve, TELEGRAM_MIN_INTERVAL - timeSinceLastSend));
        }
        
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
        
        lastTelegramSend = Date.now();
        
        if (!response.ok) {
            console.log(`⚠️ Telegram API error: ${response.status}`);
        }
        
        return response.ok;
    } catch (error) {
        console.log(`❌ Telegram error: ${error.message}`);
        return false;
    }
}

// =====================================================================
// === FORMATAR PREÇO MELHORADO ===
// =====================================================================
function formatPrice(price) {
    if (price === null || price === undefined || isNaN(price)) return '-';
    const numPrice = Number(price);
    if (isNaN(numPrice)) return '-';
    if (numPrice > 1000) return numPrice.toFixed(2);
    if (numPrice > 1) return numPrice.toFixed(2);
    if (numPrice > 0.1) return numPrice.toFixed(4);
    if (numPrice > 0.01) return numPrice.toFixed(5);
    return numPrice.toFixed(8);
}

function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0];
    return { date, time, full: `${date} ${time}` };
}

// =====================================================================
// === FORMATAR MENSAGEM ESTOCÁSTICO ===
// =====================================================================
function formatStochMessage(stoch, timeframe) {
    if (!stoch) return `${timeframe}: ❌`;
    
    const k = stoch.k.toFixed(0);
    const d = stoch.d.toFixed(0);
    
    let color = '⚪';
    if (stoch.k >= 80) color = '🔴';
    else if (stoch.k <= 20) color = '🔵';
    else if (stoch.k >= 60) color = '🟠';
    else if (stoch.k <= 30) color = '🟢';
    
    return `${timeframe}: K${k}${stoch.crossEmoji}D${d} ${color} | ${stoch.crossStatus}`;
}

// =====================================================================
// === FORMATAR MENSAGEM CCI ===
// =====================================================================
function formatCCIMessage(cci, timeframe) {
    if (!cci) return `${timeframe}: ❌`;
    
    return `${timeframe}: CCI ${cci.cci.toFixed(0)} | EMA ${cci.ema.toFixed(0)} ${cci.crossEmoji} | ${cci.crossStatus}`;
}

// =====================================================================
// === OBTER TODOS INDICADORES PARA MENSAGEM ===
// =====================================================================
async function getAllIndicators(symbol) {
    const [stoch4h, stoch12h, stochDaily, cci4h, cciDaily] = await Promise.all([
        getStochastic(symbol, '4h'),
        getStochastic(symbol, '12h'),
        getStochastic(symbol, '1d'),
        getCCI(symbol, '4h'),
        getCCI(symbol, '1d')
    ]);
    
    return { stoch4h, stoch12h, stochDaily, cci4h, cciDaily };
}

// =====================================================================
// === ANALISAR DIVERGÊNCIAS ===
// =====================================================================
async function analyzeDivergences(symbol) {
    const cacheKey = `${symbol}_divergences`;
    const cached = divergenceCache.get(cacheKey);
    
    if (cached) {
        return cached;
    }
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false,
        bullishDetails: [],
        bearishDetails: []
    };
    
    for (const timeframe of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        try {
            const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) continue;
            
            const prices = candles.map(c => c.close);
            const rsi = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
            if (!rsi || rsi.length < 50) continue;
            
            const divergences = findRSIDivergences(prices, rsi);
            
            if (divergences.bullish.length > 0) {
                result.hasBullishDivergence = true;
                result.bullishDetails.push({ timeframe, divergences: divergences.bullish });
            }
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
                result.bearishDetails.push({ timeframe, divergences: divergences.bearish });
            }
            
        } catch (error) {
            console.log(`⚠️ Erro ao analisar divergências ${timeframe}: ${error.message}`);
        }
    }
    
    divergenceCache.set(cacheKey, result);
    return result;
}

// =====================================================================
// === VERIFICAR BOLLINGER TOUCH ===
// =====================================================================
async function checkBollingerTouch(symbol, type) {
    try {
        const cached = bollingerCache.get(symbol);
        if (cached) return cached;
        
        const candles = await getCandles(symbol, CONFIG.MONITOR.BOLLINGER.TIMEFRAME, CONFIG.MONITOR.BOLLINGER.PERIOD + 10);
        if (!candles || candles.length < CONFIG.MONITOR.BOLLINGER.PERIOD) return false;
        
        const prices = candles.map(c => c.close);
        const bollinger = calculateBollingerBands(prices, CONFIG.MONITOR.BOLLINGER.PERIOD, CONFIG.MONITOR.BOLLINGER.STD_DEVIATION);
        if (!bollinger) return false;
        
        const currentPrice = prices[prices.length - 1];
        const threshold = CONFIG.MONITOR.BOLLINGER.TOUCH_THRESHOLD;
        
        let result = false;
        if (type === 'buy') {
            const lowerBand = bollinger.lower;
            const distance = (lowerBand - currentPrice) / currentPrice;
            result = currentPrice <= lowerBand || (distance > 0 && distance <= threshold);
        } else {
            const upperBand = bollinger.upper;
            const distance = (currentPrice - upperBand) / currentPrice;
            result = currentPrice >= upperBand || (distance > 0 && distance <= threshold);
        }
        
        bollingerCache.set(symbol, result);
        return result;
    } catch (error) {
        console.log(`⚠️ Erro ao verificar Bollinger: ${error.message}`);
        return false;
    }
}

// =====================================================================
// === OBTER RSI ===
// =====================================================================
async function getRSIForSymbol(symbol) {
    try {
        const cached = rsiCache.get(symbol);
        if (cached) return cached;
        
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 30) return null;
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        if (!rsi || rsi.length === 0) return null;
        
        const rsiValue = rsi[rsi.length - 1];
        rsiCache.set(symbol, rsiValue);
        
        return rsiValue;
    } catch (error) {
        console.log(`⚠️ Erro ao obter RSI: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === OBTER LSR ===
// =====================================================================
async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
        const res = await fetch(url);
        
        if (!res.ok) return null;
        
        const data = await res.json();
        return data && data.length ? parseFloat(data[0].longShortRatio) : null;
    } catch (error) {
        console.log(`⚠️ Erro ao obter LSR: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === OBTER FUNDING RATE ===
// =====================================================================
async function getFundingRate(symbol) {
    try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
        
        if (!res.ok) return 0;
        
        const data = await res.json();
        return parseFloat(data.lastFundingRate);
    } catch (error) {
        console.log(`⚠️ Erro ao obter Funding Rate: ${error.message}`);
        return 0;
    }
}

// =====================================================================
// === VERIFICAR CONDIÇÕES DE COMPRA MELHORADA ===
// =====================================================================
async function checkBuyConditions(symbol, currentPrice, lsr, fundingPercent, rsi, volumeScore) {
    const divergences = await analyzeDivergences(symbol);
    if (!divergences.hasBullishDivergence) return false;
    
    if (rsi === null || rsi >= CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD) return false;
    
    const bollingerTouch = await checkBollingerTouch(symbol, 'buy');
    if (!bollingerTouch) return false;
    
    if (lsr && lsr >= 2.2) return false;
    
    if (volumeScore < 3) return false;
    
    const cooldownKey = `${symbol}_buy`;
    if (alertCooldown.has(cooldownKey)) return false;
    
    return true;
}

// =====================================================================
// === VERIFICAR CONDIÇÕES DE VENDA MELHORADA ===
// =====================================================================
async function checkSellConditions(symbol, currentPrice, lsr, fundingPercent, rsi, volumeScore) {
    const divergences = await analyzeDivergences(symbol);
    if (!divergences.hasBearishDivergence) return false;
    
    if (rsi === null || rsi <= CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD) return false;
    
    const bollingerTouch = await checkBollingerTouch(symbol, 'sell');
    if (!bollingerTouch) return false;
    
    if (lsr && lsr <= 2.0) return false;
    
    if (volumeScore < 3) return false;
    
    const cooldownKey = `${symbol}_sell`;
    if (alertCooldown.has(cooldownKey)) return false;
    
    return true;
}

// =====================================================================
// === ENVIAR ALERTA DE COMPRA ===
// =====================================================================
async function sendBuyAlert(symbol, price, lsr, fundingPercent, rsi, volumeScore, stopData, timeframe, cvdDetails = null) {
    const dt = getBrazilianDateTime();
    const indicators = await getAllIndicators(symbol);
    const clustersMessage = await formatClustersMessage(symbol);
    
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🟢 COMPRA - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>💰 Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi.toFixed(1)} | LSR: ${lsr ? lsr.toFixed(2) : '-'} | Funding: ${(fundingPercent * 100).toFixed(4)}%</i>\n`;
    msg += `<i>✨Volume CVD: ${volumeScore}/9</i>\n\n`;
    
    if (cvdDetails) {
        msg += `<i>📊 CVD DETALHADO:</i>\n`;
        msg += `<i>   🟢 Compradores: ${cvdDetails.buyVolumePercent.toFixed(1)}% (${(cvdDetails.buyVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
        msg += `<i>   🔴 Vendedores: ${cvdDetails.sellVolumePercent.toFixed(1)}% (${(cvdDetails.sellVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
        msg += `<i>   📊 Delta Líquido: ${cvdDetails.deltaUSD > 0 ? '+' : ''}${(cvdDetails.deltaUSD / 1000000).toFixed(2)}M USD</i>\n`;
        msg += `<i>   🎯 Score CVD: ${cvdDetails.score}/9</i>\n`;
        msg += `<i>   📈 Dominância: ${cvdDetails.dominantSide === 'buy' ? 'COMPRADORES' : 'VENDEDORES'}</i>\n`;
        msg += `<i>   ⏱️ Período: ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES} minutos</i>\n\n`;
    }
    
    msg += `<i>${formatStochMessage(indicators.stoch4h, '4H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stoch12h, '12H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stochDaily, '1D')}</i>\n\n`;
    msg += `<i>${formatCCIMessage(indicators.cci4h, '4H')}</i>\n`;
    msg += `<i>${formatCCIMessage(indicators.cciDaily, '1D')}</i>\n\n`;
    msg += `${clustersMessage}\n`;
    msg += `<i>Alvos:</i>\n`;
    msg += `<i>Alvo 1: ${formatPrice(stopData.tp1)}</i>\n`;
    msg += `<i>Alvo 2: ${formatPrice(stopData.tp2)}</i>\n`;
    msg += `<i>Alvo 3: ${formatPrice(stopData.tp3)}</i>\n`;
    msg += `<i>⛔ Stop: ${formatPrice(stopData.stop)} (${((price - stopData.stop) / price * 100).toFixed(2)}%)</i>\n\n`;
    msg += `<i>"O Volume CVD quanto maior melhor"</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🟢 ALERTA COMPRA: ${symbol} at ${formatPrice(price)}`);
}

// =====================================================================
// === ENVIAR ALERTA DE VENDA ===
// =====================================================================
async function sendSellAlert(symbol, price, lsr, fundingPercent, rsi, volumeScore, stopData, timeframe, cvdDetails = null) {
    const dt = getBrazilianDateTime();
    const indicators = await getAllIndicators(symbol);
    const clustersMessage = await formatClustersMessage(symbol);
    
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🔴 CORREÇÃO - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>💰 Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi.toFixed(1)} | LSR: ${lsr ? lsr.toFixed(2) : '-'} | Funding: ${(fundingPercent * 100).toFixed(4)}%</i>\n`;
    msg += `<i>✨Volume CVD: ${volumeScore}/9</i>\n\n`;
    
    if (cvdDetails) {
        msg += `<i>📊 CVD DETALHADO:</i>\n`;
        msg += `<i>   🟢 Compradores: ${cvdDetails.buyVolumePercent.toFixed(1)}% (${(cvdDetails.buyVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
        msg += `<i>   🔴 Vendedores: ${cvdDetails.sellVolumePercent.toFixed(1)}% (${(cvdDetails.sellVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
        msg += `<i>   📊 Delta Líquido: ${cvdDetails.deltaUSD > 0 ? '+' : ''}${(cvdDetails.deltaUSD / 1000000).toFixed(2)}M USD</i>\n`;
        msg += `<i>   🎯 Score CVD: ${cvdDetails.score}/9</i>\n`;
        msg += `<i>   📈 Dominância: ${cvdDetails.dominantSide === 'buy' ? 'COMPRADORES' : 'VENDEDORES'}</i>\n`;
        msg += `<i>   ⏱️ Período: ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES} minutos</i>\n\n`;
    }
    
    msg += `<i>${formatStochMessage(indicators.stoch4h, '4H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stoch12h, '12H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stochDaily, '1D')}</i>\n\n`;
    msg += `<i>${formatCCIMessage(indicators.cci4h, '4H')}</i>\n`;
    msg += `<i>${formatCCIMessage(indicators.cciDaily, '1D')}</i>\n\n`;
    msg += `${clustersMessage}\n`;
    msg += `<i>Alvos:</i>\n`;
    msg += `<i>Alvo 1: ${formatPrice(stopData.tp1)}</i>\n`;
    msg += `<i>Alvo 2: ${formatPrice(stopData.tp2)}</i>\n`;
    msg += `<i>Alvo 3: ${formatPrice(stopData.tp3)}</i>\n`;
    msg += `<i>⛔ Stop: ${formatPrice(stopData.stop)} (${((stopData.stop - price) / price * 100).toFixed(2)}%)</i>\n\n`;
    msg += `<i>"O Volume CVD quanto maior melhor"</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🔴 ALERTA VENDA: ${symbol} at ${formatPrice(price)}`);
}

// =====================================================================
// === ENVIAR ALERTA DE CVD COMPRADOR ===
// =====================================================================
async function sendCVDBuyAlert(symbol, price, lsr, fundingPercent, rsi, cvdDetails, indicators, clustersMessage) {
    const dt = getBrazilianDateTime();
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🟢📊 CVD COMPRADOR FORTE - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>💰 Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi?.toFixed(1) || '-'} | LSR: ${lsr ? lsr.toFixed(2) : '-'} | Funding: ${(fundingPercent * 100).toFixed(4)}%</i>\n\n`;
    
    msg += `<i>📊 CVD DETALHADO:</i>\n`;
    msg += `<i>   🟢 COMPRADORES: ${cvdDetails.buyVolumePercent.toFixed(1)}% (${(cvdDetails.buyVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
    msg += `<i>   🔴 Vendedores: ${cvdDetails.sellVolumePercent.toFixed(1)}% (${(cvdDetails.sellVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
    msg += `<i>   📊 Delta Líquido: +${(cvdDetails.deltaUSD / 1000000).toFixed(2)}M USD</i>\n`;
    msg += `<i>   🎯 Score CVD: ${cvdDetails.score}/9 (ALTO)</i>\n`;
    msg += `<i>   📈 Dominância: ${cvdDetails.buyVolumePercent.toFixed(1)}% COMPRADORES</i>\n`;
    msg += `<i>   📦 Volume Total: ${(cvdDetails.totalVolumeUSD / 1000000).toFixed(2)}M USD</i>\n`;
    msg += `<i>   ⏱️ Período: ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES} minutos</i>\n\n`;
    
    msg += `<i>${formatStochMessage(indicators.stoch4h, '4H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stoch12h, '12H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stochDaily, '1D')}</i>\n\n`;
    msg += `<i>${formatCCIMessage(indicators.cci4h, '4H')}</i>\n`;
    msg += `<i>${formatCCIMessage(indicators.cciDaily, '1D')}</i>\n\n`;
    msg += `${clustersMessage}\n`;
    msg += `<i>💡 Interpretação: Pressão compradora extremamente forte nos últimos minutos</i>\n`;
    msg += `<i>"O Volume CVD quanto maior melhor"</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🟢📊 ALERTA CVD COMPRADOR: ${symbol} - Score ${cvdDetails.score}/9`);
}

// =====================================================================
// === ENVIAR ALERTA DE CVD VENDEDOR ===
// =====================================================================
async function sendCVDSellAlert(symbol, price, lsr, fundingPercent, rsi, cvdDetails, indicators, clustersMessage) {
    const dt = getBrazilianDateTime();
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🔴📊 CVD VENDEDOR FORTE - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>💰 Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi?.toFixed(1) || '-'} | LSR: ${lsr ? lsr.toFixed(2) : '-'} | Funding: ${(fundingPercent * 100).toFixed(4)}%</i>\n\n`;
    
    msg += `<i>📊 CVD DETALHADO:</i>\n`;
    msg += `<i>   🟢 Compradores: ${cvdDetails.buyVolumePercent.toFixed(1)}% (${(cvdDetails.buyVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
    msg += `<i>   🔴 VENDEDORES: ${cvdDetails.sellVolumePercent.toFixed(1)}% (${(cvdDetails.sellVolumeUSD / 1000000).toFixed(2)}M USD)</i>\n`;
    msg += `<i>   📊 Delta Líquido: ${(cvdDetails.deltaUSD / 1000000).toFixed(2)}M USD</i>\n`;
    msg += `<i>   🎯 Score CVD: ${cvdDetails.score}/9 (ALTO)</i>\n`;
    msg += `<i>   📈 Dominância: ${cvdDetails.sellVolumePercent.toFixed(1)}% VENDEDORES</i>\n`;
    msg += `<i>   📦 Volume Total: ${(cvdDetails.totalVolumeUSD / 1000000).toFixed(2)}M USD</i>\n`;
    msg += `<i>   ⏱️ Período: ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES} minutos</i>\n\n`;
    
    msg += `<i>${formatStochMessage(indicators.stoch4h, '4H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stoch12h, '12H')}</i>\n`;
    msg += `<i>${formatStochMessage(indicators.stochDaily, '1D')}</i>\n\n`;
    msg += `<i>${formatCCIMessage(indicators.cci4h, '4H')}</i>\n`;
    msg += `<i>${formatCCIMessage(indicators.cciDaily, '1D')}</i>\n\n`;
    msg += `${clustersMessage}\n`;
    msg += `<i>💡 Interpretação: Pressão vendedora extremamente forte nos últimos minutos</i>\n`;
    msg += `<i>"O Volume CVD quanto maior melhor"</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🔴📊 ALERTA CVD VENDEDOR: ${symbol} - Score ${cvdDetails.score}/9`);
}

// =====================================================================
// === MONITOR BTC VIA WEBSOCKET ===
// =====================================================================
class BTCMonitor {
    constructor() {
        this.wsConnections = null;
        this.currentPrice = 0;
        this.cvdData = { value: 0, buyVolume: 0, sellVolume: 0, history: [] };
        this.lastCheck = 0;
        this.checkInterval = 5 * 60 * 1000;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.lastCVDAlertTime = 0;
        this.cvdAlertCooldown = 10 * 60 * 1000; // 10 minutos entre alertas CVD
    }
    
    async start() {
        console.log('🚀 Iniciando Monitor BTCUSDT...');
        console.log('📊 Configuração:');
        console.log(`   - Estocástico: ${CONFIG.MONITOR.STOCH.K_PERIOD}.${CONFIG.MONITOR.STOCH.D_PERIOD}.${CONFIG.MONITOR.STOCH.SLOW_K}`);
        console.log(`   - CCI: período ${CONFIG.MONITOR.CCI.PERIOD} | EMA ${CONFIG.MONITOR.CCI.EMA_PERIOD}`);
        console.log(`   - Timeframes: ${CONFIG.MONITOR.STOCH.TIMEFRAMES.join(', ')}`);
        console.log(`   - CVD: Threshold ${CONFIG.MONITOR.CVD.BUY_THRESHOLD}/9 | Lookback ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES}min`);
        console.log(`   - Check a cada: ${this.checkInterval / 1000} segundos`);
        
        await this.connectWebSocket();
        this.startPeriodicCheck();
    }
    
    async connectWebSocket() {
        const symbol = CONFIG.MONITOR.SYMBOL.toLowerCase();
        
        const tradeWs = new WebSocket(`wss://fstream.binance.com/ws/${symbol}@aggTrade`);
        
        tradeWs.on('message', (data) => this.handleTrade(data));
        tradeWs.on('error', (err) => console.log(`⚠️ Erro WS trade: ${err.message}`));
        tradeWs.on('close', () => {
            console.log('❌ WS trade desconectado, reconectando...');
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                const delay = Math.min(5000 * this.reconnectAttempts, 30000);
                setTimeout(() => this.connectWebSocket(), delay);
            } else {
                console.log('❌ Máximo de tentativas de reconexão atingido');
            }
        });
        
        tradeWs.on('open', () => {
            console.log('✅ WebSocket conectado');
            this.reconnectAttempts = 0;
        });
        
        this.wsConnections = { tradeWs };
    }
    
    handleTrade(rawData) {
        try {
            const trade = JSON.parse(rawData);
            const volume = parseFloat(trade.q);
            const price = parseFloat(trade.p);
            const volumeUSD = volume * price;
            const isBuyerMaker = trade.m;
            const delta = isBuyerMaker ? -volumeUSD : +volumeUSD;
            
            this.cvdData.value += delta;
            if (delta > 0) this.cvdData.buyVolume += volumeUSD;
            else this.cvdData.sellVolume += volumeUSD;
            
            this.cvdData.history.push({
                timestamp: Date.now(),
                delta: delta,
                volume: volume,
                volumeUSD: volumeUSD,
                price: price,
                cvd: this.cvdData.value
            });
            
            if (this.cvdData.history.length > 5000) this.cvdData.history.shift();
            
        } catch (error) {
            // Ignora erros de parsing
        }
    }
    
    startPeriodicCheck() {
        setInterval(async () => {
            await this.performCheck();
        }, this.checkInterval);
        
        setTimeout(() => this.performCheck(), 10000);
    }
    
    async performCheck() {
        const now = Date.now();
        if (now - this.lastCheck < 30000) return;
        this.lastCheck = now;
        
        try {
            console.log('🔍 Verificando condições BTCUSDT...');
            
            const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT');
            
            if (!tickerRes.ok) {
                console.log('⚠️ Erro ao obter ticker');
                return;
            }
            
            const ticker = await tickerRes.json();
            const currentPrice = parseFloat(ticker.price);
            this.currentPrice = currentPrice;
            
            const [rsi, lsr, funding, indicators] = await Promise.all([
                getRSIForSymbol('BTCUSDT'),
                getLSR('BTCUSDT'),
                getFundingRate('BTCUSDT'),
                getAllIndicators('BTCUSDT')
            ]);
            
            const fundingPercent = funding * 100;
            const volumeScore = this.getVolumeScore();
            const cvdDetails = this.getCVDDetails();
            
            // Verificar alertas de CVD
            await this.checkCVDAlerts(currentPrice, lsr, fundingPercent, rsi, indicators, cvdDetails);
            
            const stochAlerts = await this.checkStochAlerts(currentPrice);
            for (const alert of stochAlerts) {
                await this.sendStochAlert(alert);
            }
            
            const buyConditions = await checkBuyConditions('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, volumeScore);
            if (buyConditions) {
                const atrData = await calculateATR('BTCUSDT', '1h', 14);
                if (atrData) {
                    const candles = await getCandles('BTCUSDT', '1h', 50);
                    const stopData = computeStopAndTargets(currentPrice, true, atrData.atr, candles);
                    alertCooldown.set('BTCUSDT_buy', true);
                    await sendBuyAlert('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, volumeScore, stopData, '15m/1h/4h', cvdDetails);
                }
            }
            
            const sellConditions = await checkSellConditions('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, volumeScore);
            if (sellConditions) {
                const atrData = await calculateATR('BTCUSDT', '1h', 14);
                if (atrData) {
                    const candles = await getCandles('BTCUSDT', '1h', 50);
                    const stopData = computeStopAndTargets(currentPrice, false, atrData.atr, candles);
                    alertCooldown.set('BTCUSDT_sell', true);
                    await sendSellAlert('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, volumeScore, stopData, '15m/1h/4h', cvdDetails);
                }
            }
            
            console.log(`✅ Verificação concluída - Preço: ${formatPrice(currentPrice)} | RSI: ${rsi?.toFixed(0)} | Vol: ${volumeScore}/9 | CVD Score: ${cvdDetails.score}/9`);
            
        } catch (error) {
            console.log(`❌ Erro na verificação: ${error.message}`);
        }
    }
    
    async checkCVDAlerts(currentPrice, lsr, fundingPercent, rsi, indicators, cvdDetails) {
        const now = Date.now();
        
        // Verificar se passou o cooldown
        if (now - this.lastCVDAlertTime < this.cvdAlertCooldown) return;
        
        const clustersMessage = await formatClustersMessage('BTCUSDT');
        
        // Alerta de CVD COMPRADOR forte
        if (cvdDetails.score >= CONFIG.MONITOR.CVD.BUY_THRESHOLD && cvdDetails.dominantSide === 'buy') {
            const cooldownKey = `BTCUSDT_cvd_buy`;
            if (!alertCooldown.has(cooldownKey)) {
                await sendCVDBuyAlert('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, cvdDetails, indicators, clustersMessage);
                alertCooldown.set(cooldownKey, true);
                this.lastCVDAlertTime = now;
            }
        }
        
        // Alerta de CVD VENDEDOR forte
        if (cvdDetails.score >= CONFIG.MONITOR.CVD.SELL_THRESHOLD && cvdDetails.dominantSide === 'sell') {
            const cooldownKey = `BTCUSDT_cvd_sell`;
            if (!alertCooldown.has(cooldownKey)) {
                await sendCVDSellAlert('BTCUSDT', currentPrice, lsr, fundingPercent, rsi, cvdDetails, indicators, clustersMessage);
                alertCooldown.set(cooldownKey, true);
                this.lastCVDAlertTime = now;
            }
        }
    }
    
    getCVDDetails() {
        const data = this.cvdData;
        if (data.history.length === 0) {
            return {
                score: 0,
                buyVolumeUSD: 0,
                sellVolumeUSD: 0,
                totalVolumeUSD: 0,
                buyVolumePercent: 0,
                sellVolumePercent: 0,
                deltaUSD: 0,
                dominantSide: 'neutral'
            };
        }
        
        const now = Date.now();
        const cutoff = now - (CONFIG.MONITOR.CVD.LOOKBACK_MINUTES * 60 * 1000);
        
        let buyVolumeUSD = 0, sellVolumeUSD = 0, totalVolumeUSD = 0;
        
        for (const trade of data.history) {
            if (trade.timestamp >= cutoff) {
                if (trade.delta > 0) buyVolumeUSD += trade.volumeUSD;
                else sellVolumeUSD += Math.abs(trade.volumeUSD);
                totalVolumeUSD += trade.volumeUSD;
            }
        }
        
        if (totalVolumeUSD === 0) {
            return {
                score: 0,
                buyVolumeUSD: 0,
                sellVolumeUSD: 0,
                totalVolumeUSD: 0,
                buyVolumePercent: 0,
                sellVolumePercent: 0,
                deltaUSD: 0,
                dominantSide: 'neutral'
            };
        }
        
        const buyVolumePercent = (buyVolumeUSD / totalVolumeUSD) * 100;
        const sellVolumePercent = (sellVolumeUSD / totalVolumeUSD) * 100;
        const deltaUSD = buyVolumeUSD - sellVolumeUSD;
        const dominantRatio = Math.max(buyVolumePercent, sellVolumePercent);
        const score = Math.min(Math.floor(dominantRatio / 10), 9);
        const dominantSide = buyVolumePercent > sellVolumePercent ? 'buy' : 'sell';
        
        // Verificar se o volume total é significativo (mínimo em USD)
        if (totalVolumeUSD < CONFIG.MONITOR.CVD.MIN_VOLUME_USD) {
            return {
                score: 0,
                buyVolumeUSD,
                sellVolumeUSD,
                totalVolumeUSD,
                buyVolumePercent,
                sellVolumePercent,
                deltaUSD,
                dominantSide: 'neutral'
            };
        }
        
        return {
            score,
            buyVolumeUSD,
            sellVolumeUSD,
            totalVolumeUSD,
            buyVolumePercent,
            sellVolumePercent,
            deltaUSD,
            dominantSide
        };
    }
    
    getVolumeScore() {
        const data = this.cvdData;
        if (data.history.length === 0) return 0;
        
        const now = Date.now();
        const cutoff = now - (CONFIG.MONITOR.CVD.LOOKBACK_MINUTES * 60 * 1000);
        
        let buyVolume = 0, sellVolume = 0, totalVolume = 0;
        
        for (const trade of data.history) {
            if (trade.timestamp >= cutoff) {
                if (trade.delta > 0) buyVolume += trade.volume;
                else sellVolume += trade.volume;
                totalVolume += trade.volume;
            }
        }
        
        if (totalVolume === 0) return 0;
        
        const buyerRatio = (buyVolume / totalVolume) * 100;
        const dominantRatio = Math.max(buyerRatio, 100 - buyerRatio);
        return Math.min(Math.floor(dominantRatio / 10), 9);
    }
    
    async checkStochAlerts(currentPrice) {
        const alerts = [];
        
        for (const tf of CONFIG.MONITOR.STOCH.TIMEFRAMES) {
            const stoch = await getStochastic('BTCUSDT', tf);
            if (!stoch) continue;
            
            if (stoch.k >= 80) {
                const cooldownKey = `BTCUSDT_exhaustion_${tf}`;
                if (!alertCooldown.has(cooldownKey)) {
                    alerts.push({ type: 'exhaustion', tf: tf, stoch: stoch, price: currentPrice });
                    alertCooldown.set(cooldownKey, true);
                }
            }
            
            if (stoch.k <= 30) {
                const cooldownKey = `BTCUSDT_demand_${tf}`;
                if (!alertCooldown.has(cooldownKey)) {
                    alerts.push({ type: 'demand', tf: tf, stoch: stoch, price: currentPrice });
                    alertCooldown.set(cooldownKey, true);
                }
            }
            
            if (tf === '12h') {
                if (stoch.crossDown) {
                    const cooldownKey = `BTCUSDT_crossdown_12h`;
                    if (!alertCooldown.has(cooldownKey)) {
                        alerts.push({ type: 'crossdown_12h', tf: tf, stoch: stoch, price: currentPrice });
                        alertCooldown.set(cooldownKey, true);
                    }
                }
                if (stoch.crossUp) {
                    const cooldownKey = `BTCUSDT_crossup_12h`;
                    if (!alertCooldown.has(cooldownKey)) {
                        alerts.push({ type: 'crossup_12h', tf: tf, stoch: stoch, price: currentPrice });
                        alertCooldown.set(cooldownKey, true);
                    }
                }
            }
            
            if (tf === '1d') {
                if (stoch.crossDown) {
                    const cooldownKey = `BTCUSDT_crossdown_1d`;
                    if (!alertCooldown.has(cooldownKey)) {
                        alerts.push({ type: 'crossdown_1d', tf: tf, stoch: stoch, price: currentPrice });
                        alertCooldown.set(cooldownKey, true);
                    }
                }
                if (stoch.crossUp) {
                    const cooldownKey = `BTCUSDT_crossup_1d`;
                    if (!alertCooldown.has(cooldownKey)) {
                        alerts.push({ type: 'crossup_1d', tf: tf, stoch: stoch, price: currentPrice });
                        alertCooldown.set(cooldownKey, true);
                    }
                }
            }
        }
        
        return alerts;
    }
    
    async sendStochAlert(alert) {
        const dt = getBrazilianDateTime();
        const [indicators, rsi, lsr, funding] = await Promise.all([
            getAllIndicators('BTCUSDT'),
            getRSIForSymbol('BTCUSDT'),
            getLSR('BTCUSDT'),
            getFundingRate('BTCUSDT')
        ]);
        const clustersMessage = await formatClustersMessage('BTCUSDT');
        
        let title = '';
        let message = '';
        
        switch (alert.type) {
            case 'exhaustion':
                title = `🔴 BTC EXAUSTÃO - ${alert.tf}`;
                message = ' Região de sobrecompra - Monitorar reversão';
                break;
            case 'demand':
                title = `🟢 BTC REGIÃO DE DEMANDA - ${alert.tf}`;
                message = ' Zona de sobrevenda - Possível bottom';
                break;
            case 'crossup_12h':
                title = `📈 BTC TENDÊNCIA ALTA 12H`;
                message = ' K subiu acima da D 🟢';
                break;
            case 'crossdown_12h':
                title = `📉 BTC TENDÊNCIA BAIXA 12H`;
                message = ' K caiu abaixo da D 🔴';
                break;
            case 'crossup_1d':
                title = `📈 BTC TENDÊNCIA ALTA DIÁRIO`;
                message = ' Tendência de ALTA no Diário 🟢';
                break;
            case 'crossdown_1d':
                title = `📉 BTC TENDÊNCIA BAIXA DIÁRIO`;
                message = ' Tendência de BAIXA no Diário 🔴';
                break;
        }
        
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BTCUSDT&interval=60`;
        const fundingPercent = funding * 100;
        
        let msg = `<i>${title}</i>\n`;
        msg += `<i>🔹 ${dt.full}hs</i>\n`;
        msg += `<i>💰 Preço: ${formatPrice(alert.price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
        msg += `<i>RSI 1h: ${rsi?.toFixed(1) || '-'} | LSR: ${lsr?.toFixed(2) || '-'} | Funding: ${fundingPercent.toFixed(4)}%</i>\n`;
        msg += `<i>${formatStochMessage(indicators.stoch4h, '4H')}</i>\n`;
        msg += `<i>${formatStochMessage(indicators.stoch12h, '12H')}</i>\n`;
        msg += `<i>${formatStochMessage(indicators.stochDaily, '1D')}</i>\n`;
        msg += `<i>${formatCCIMessage(indicators.cci4h, '4H')}</i>\n`;
        msg += `<i>${formatCCIMessage(indicators.cciDaily, '1D')}</i>\n\n`;
        msg += `${clustersMessage}\n`;
        msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
        
        await sendToTelegram(msg);
        console.log(`📢 ALERTA: ${title}`);
    }
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i>🤖 TITANIUM PRIME X - BTC </i>\n\n`;
    msg += `<i>✅ Sistema ativo com alertas CVD</i>\n`;
    msg += `<i>📊 Configuração CVD:</i>\n`;
    msg += `<i>   - Alerta Comprador: ≥${CONFIG.MONITOR.CVD.BUY_THRESHOLD}/9</i>\n`;
    msg += `<i>   - Alerta Vendedor: ≥${CONFIG.MONITOR.CVD.SELL_THRESHOLD}/9</i>\n`;
    msg += `<i>   - Período: ${CONFIG.MONITOR.CVD.LOOKBACK_MINUTES} minutos</i>\n`;
    msg += `<i>   - Volume mínimo: $${(CONFIG.MONITOR.CVD.MIN_VOLUME_USD / 1000000).toFixed(0)}M</i>\n`;
    
    await sendToTelegram(msg);
}

// =====================================================================
// === INICIAR SISTEMA ===
// =====================================================================
async function start() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X - BTC COM ALERTAS CVD');
    console.log('='.repeat(70) + '\n');
    
    await sendInitMessage();
    
    const btcMonitor = new BTCMonitor();
    await btcMonitor.start();
    
    console.log('✅ Sistema em execução. Aguardando alertas...');
    console.log('📊 Alertas CVD ativos: Comprador e Vendedor');
}

process.on('SIGINT', () => {
    console.log('\n🛑 Desligando...');
    process.exit(0);
});

start().catch(console.error);
