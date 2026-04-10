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
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    MONITOR: {
        TOP_SIZE: 8,
        MIN_VOLUME_USDT: 1000000,
        MAX_SYMBOLS: 150,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        RSI: {
            PERIOD: 14,
            TIMEFRAMES: ['15m', '1h', '4h'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCE_STRENGTH: 3,
            MIN_VOLUME_CONFIRMATION: 55,
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
        }
    }
};

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const alertCooldown = new Map();
const divergenceCache = new Map();
const bollingerCache = new Map();
const rsiCache = new Map();
const activeSymbolsCache = { symbols: null, timestamp: 0 };
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas

// =====================================================================
// === FUNÇÃO PARA BUSCAR SÍMBOLOS VÁLIDOS DA BINANCE FUTURES ===
// =====================================================================
async function getValidActiveSymbols() {
    const now = Date.now();
    
    if (activeSymbolsCache.symbols && (now - activeSymbolsCache.timestamp) < CACHE_DURATION) {
        return activeSymbolsCache.symbols;
    }
    
    try {
        console.log('📡 Buscando símbolos válidos na Binance Futures...');
        
        const exchangeRes = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const exchangeData = await exchangeRes.json();
        
        const validSymbolsSet = new Set(
            exchangeData.symbols
                .filter(s => 
                    s.status === 'TRADING' &&
                    s.symbol.endsWith('USDT') &&
                    s.contractType === 'PERPETUAL'
                )
                .map(s => s.symbol)
        );
        
        console.log(`✅ Encontrados ${validSymbolsSet.size} símbolos ativos na Binance Futures`);
        
        activeSymbolsCache.symbols = validSymbolsSet;
        activeSymbolsCache.timestamp = now;
        
        return validSymbolsSet;
        
    } catch (error) {
        console.log(`❌ Erro ao buscar exchangeInfo: ${error.message}`);
        
        const fallbackSymbols = new Set([
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 
            'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
            'POLUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
            'BCHUSDT', 'NEARUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT'
        ]);
        
        console.log(`⚠️ Usando lista fallback com ${fallbackSymbols.size} símbolos`);
        return fallbackSymbols;
    }
}

// =====================================================================
// === WEBHOOK TELEGRAM ===
// =====================================================================
async function sendToTelegram(message) {
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        let finalMessage = message;
        
        finalMessage = finalMessage.replace(/<i><\/i>/g, '');
        finalMessage = finalMessage.replace(/<i>\s*<\/i>/g, '');
        
        const openTags = (finalMessage.match(/<i>/g) || []).length;
        const closeTags = (finalMessage.match(/<\/i>/g) || []).length;
        if (openTags !== closeTags) {
            finalMessage = finalMessage.replace(/<[^>]*>/g, '');
        }
        
        if (finalMessage.length > 4000) {
            finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
        }
        
        finalMessage = finalMessage.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, '&amp;');
        
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
        
        return response.ok;
    } catch (error) {
        console.log(`❌ Telegram error: ${error.message}`);
        return false;
    }
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
        const candles = await getCandles(symbol, timeframe, period + 10);
        if (!candles || candles.length < period + 1) return null;
        
        const trValues = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i-1].close;
            trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        
        const atr = trValues.slice(-period).reduce((a, b) => a + b, 0) / period;
        const currentPrice = candles[candles.length - 1].close;
        
        return { atr, atrPercent: (atr / currentPrice) * 100, currentPrice };
    } catch (error) {
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
// === FUNÇÃO PARA ENCONTRAR PIVÔS ===
// =====================================================================
function findPivots(data, lookback = 3) {
    const pivots = { highs: [], lows: [] };
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
            if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
        }
        
        if (isHigh) pivots.highs.push({ index: i, value: data[i] });
        if (isLow) pivots.lows.push({ index: i, value: data[i] });
    }
    
    return pivots;
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR DIVERGÊNCIAS ===
// =====================================================================
function findRSIDivergences(prices, rsiValues) {
    const divergences = { bullish: [], bearish: [] };
    
    if (prices.length < 30 || rsiValues.length < 30) return divergences;
    
    const pricePivots = findPivots(prices, 3);
    const rsiPivots = findPivots(rsiValues, 3);
    
    // Divergência de ALTA (Bullish)
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
                        divergences.bullish.push({ strength: strength });
                    }
                }
            }
        }
    }
    
    // Divergência de BAIXA (Bearish)
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
                        divergences.bearish.push({ strength: strength });
                    }
                }
            }
        }
    }
    
    return divergences;
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        
        return data.map(candle => ({
            open: parseFloat(candle[1]), high: parseFloat(candle[2]), low: parseFloat(candle[3]),
            close: parseFloat(candle[4]), volume: parseFloat(candle[5]), time: candle[0]
        }));
    } catch (error) {
        return [];
    }
}

// =====================================================================
// === FUNÇÃO PARA ESPERAR FECHAMENTO DE CANDLE (CLOSE CONFIRMATION) ===
// =====================================================================
async function waitForCandleClose(symbol, timeframe, timeoutMs = 60000) {
    return new Promise(async (resolve) => {
        const intervalMs = getIntervalMilliseconds(timeframe);
        const startTime = Date.now();
        
        // Buscar candle atual
        const candles = await getCandles(symbol, timeframe, 2);
        if (!candles || candles.length < 2) {
            resolve(false);
            return;
        }
        
        const currentCandle = candles[candles.length - 1];
        const candleOpenTime = currentCandle.time;
        const candleCloseTime = candleOpenTime + intervalMs;
        const now = Date.now();
        const timeToClose = candleCloseTime - now;
        
        if (timeToClose <= 0) {
            // Candle já fechou
            resolve(true);
            return;
        }
        
        if (timeToClose > timeoutMs) {
            resolve(false);
            return;
        }
        
        console.log(`⏳ Aguardando fechamento do candle ${timeframe} para ${symbol}: ${(timeToClose / 1000).toFixed(0)}s`);
        
        // Aguardar o fechamento do candle
        setTimeout(() => {
            resolve(true);
        }, timeToClose);
    });
}

// =====================================================================
// === FUNÇÃO PARA OBTER INTERVALO EM MILISSEGUNDOS ===
// =====================================================================
function getIntervalMilliseconds(timeframe) {
    const intervals = {
        '15m': 15 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000
    };
    return intervals[timeframe] || 60 * 60 * 1000;
}

// =====================================================================
// === VERIFICAR CONDIÇÕES COM CONFIRMAÇÃO DE FECHAMENTO ===
// =====================================================================
async function verifyWithCandleClose(symbol, type, currentPrice, lsr, fundingPercent, rsi, volumeScore, timeframe) {
    try {
        // Aguardar fechamento do candle do timeframe correspondente
        const candleClosed = await waitForCandleClose(symbol, timeframe, 60000);
        
        if (!candleClosed) {
            console.log(`⏰ Timeout aguardando candle ${timeframe} para ${symbol}`);
            return false;
        }
        
        // Após fechamento, revalidar todas as condições
        console.log(`✅ Candle ${timeframe} fechado para ${symbol}. Revalidando condições...`);
        
        // Revalidar divergência com dados atualizados
        const divergences = await analyzeDivergences(symbol);
        
        if (type === 'buy') {
            if (!divergences.hasBullishDivergence) return false;
            
            const newRsi = await getRSIForSymbol(symbol);
            if (newRsi === null || newRsi >= CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD) return false;
            
            const bollingerTouch = await checkBollingerTouch(symbol, 'buy');
            if (!bollingerTouch) return false;
            
            // Revalidar LSR
            const newLsr = await getLSR(symbol);
            if (newLsr === null || newLsr >= 1.8) return false;
            
            // Revalidar volume score
            const volumeProfile = getLatestVolumeProfile(symbol);
            const newVolumeScore = volumeProfile ? volumeProfile.volumeScore : 0;
            if (newVolumeScore < 3) return false;
            
            console.log(`✅ Todas as condições revalidadas para COMPRA ${symbol} após fechamento do candle`);
            return true;
            
        } else {
            if (!divergences.hasBearishDivergence) return false;
            
            const newRsi = await getRSIForSymbol(symbol);
            if (newRsi === null || newRsi <= CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD) return false;
            
            const bollingerTouch = await checkBollingerTouch(symbol, 'sell');
            if (!bollingerTouch) return false;
            
            const newLsr = await getLSR(symbol);
            if (newLsr === null || newLsr <= 2.5) return false;
            
            const volumeProfile = getLatestVolumeProfile(symbol);
            const newVolumeScore = volumeProfile ? volumeProfile.volumeScore : 0;
            if (newVolumeScore < 3) return false;
            
            console.log(`✅ Todas as condições revalidadas para VENDA ${symbol} após fechamento do candle`);
            return true;
        }
        
    } catch (error) {
        console.log(`❌ Erro na verificação pós-candle para ${symbol}: ${error.message}`);
        return false;
    }
}

// =====================================================================
// === OBTER PERFIL DE VOLUME ATUAL ===
// =====================================================================
let globalVolumeProfile = {};

function setLatestVolumeProfile(symbol, profile) {
    globalVolumeProfile[symbol] = profile;
}

function getLatestVolumeProfile(symbol) {
    return globalVolumeProfile[symbol] || null;
}

// =====================================================================
// === OBTER RSI 1h ===
// =====================================================================
async function getRSIForSymbol(symbol) {
    try {
        const now = Date.now();
        const cached = rsiCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.value;
        }
        
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 30) return null;
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        if (!rsi || rsi.length === 0) return null;
        
        const rsiValue = rsi[rsi.length - 1];
        
        rsiCache.set(symbol, {
            value: rsiValue,
            timestamp: now
        });
        
        return rsiValue;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === VERIFICAR BOLLINGER TOUCH ===
// =====================================================================
async function checkBollingerTouch(symbol, type) {
    try {
        const now = Date.now();
        const cached = bollingerCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
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
        
        bollingerCache.set(symbol, {
            data: result,
            timestamp: now
        });
        
        return result;
    } catch (error) {
        return false;
    }
}

// =====================================================================
// === ANALISAR DIVERGÊNCIAS ===
// =====================================================================
async function analyzeDivergences(symbol) {
    const cacheKey = `${symbol}_divergences`;
    const now = Date.now();
    const cached = divergenceCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < 300000) {
        return cached.data;
    }
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false
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
            }
            
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
            }
            
        } catch (error) {
            // continua
        }
    }
    
    divergenceCache.set(cacheKey, {
        data: result,
        timestamp: now
    });
    
    return result;
}

// =====================================================================
// === FORMATAR PREÇO ===
// =====================================================================
function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(4);
    if (price > 0.1) return price.toFixed(5);
    if (price > 0.01) return price.toFixed(6);
    return price.toFixed(8);
}

function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

// =====================================================================
// === ENVIAR ALERTA DE COMPRA ===
// =====================================================================
async function sendBuyAlert(symbol, price, lsr, fundingPercent, rsi, volumeScore, stopData, timeframe) {
    const dt = getBrazilianDateTime();
    
    // Construir link do TradingView no timeframe 15min
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🟢 COMPRA - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">🔗 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi.toFixed(1)}/ #LSR: ${lsr.toFixed(2)}/ #Fund: ${fundingPercent}%</i>\n`;
    msg += `<i>✨Volume CVD: ${volumeScore}/9</i>\n`;
    msg += `<i>Alvo 1: ${formatPrice(stopData.tp1)}</i>\n`;
    msg += `<i>Alvo 2: ${formatPrice(stopData.tp2)}</i>\n`;
    msg += `<i>Alvo 3: ${formatPrice(stopData.tp3)}</i>\n`;
    msg += `<i>⛔ Stop: ${formatPrice(stopData.stop)} (${((price - stopData.stop) / price * 100).toFixed(2)}%)</i>\n`;
    msg += `<i>"Faça sua análise, opere sempre com stop de segurança"</i>\n`;
    msg += `<i>"O Volume CVD quanto maior melhor"</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🟢 ALERTA COMPRA: ${symbol} at ${formatPrice(price)}`);
}

// =====================================================================
// === ENVIAR ALERTA DE VENDA ===
// =====================================================================
async function sendSellAlert(symbol, price, lsr, fundingPercent, rsi, volumeScore, stopData, timeframe) {
    const dt = getBrazilianDateTime();
    
    // Construir link do TradingView no timeframe 15min
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=${symbol}&interval=15`;
    
    let msg = `<i>🔴 Correção - ${symbol}</i>\n`;
    msg += `<i>🔹 ${dt.full}hs</i>\n`;
    msg += `<i>Preço: ${formatPrice(price)} | <a href="${tradingViewLink}">📊 Gráfico</a></i>\n`;
    msg += `<i>RSI 1h: ${rsi.toFixed(1)} | LSR: ${lsr.toFixed(2)} | Fund: ${fundingPercent}%</i>\n`;
    msg += `<i>Volume CVD: ${volumeScore}/9</i>\n`;
    msg += `<i>Alvo 1: ${formatPrice(stopData.tp1)}</i>\n`;
    msg += `<i>Alvo 2: ${formatPrice(stopData.tp2)}</i>\n`;
    msg += `<i>Alvo 3: ${formatPrice(stopData.tp3)}</i>\n`;
    msg += `<i>⛔ Stop: ${formatPrice(stopData.stop)} (${((stopData.stop - price) / price * 100).toFixed(2)}%)</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by @J4Rviz</i>`;
    
    await sendToTelegram(msg);
    console.log(`🔴 ALERTA VENDA: ${symbol} at ${formatPrice(price)}`);
}
// =====================================================================
// === VERIFICAR CONDIÇÕES DE COMPRA ===
// =====================================================================
async function checkBuyConditions(symbol, currentPrice, lsr, fundingPercent, rsi, volumeScore) {
    const divergences = await analyzeDivergences(symbol);
    if (!divergences.hasBullishDivergence) return false;
    
    if (rsi === null || rsi >= CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD) return false;
    
    const bollingerTouch = await checkBollingerTouch(symbol, 'buy');
    if (!bollingerTouch) return false;
    
    if (lsr >= 2.5) return false;
    
    if (volumeScore < 3) return false;
    
    const cooldownKey = `${symbol}_buy`;
    const lastAlert = alertCooldown.get(cooldownKey);
    if (lastAlert && (Date.now() - lastAlert) < 3600000) return false;
    
    return true;
}

// =====================================================================
// === VERIFICAR CONDIÇÕES DE VENDA ===
// =====================================================================
async function checkSellConditions(symbol, currentPrice, lsr, fundingPercent, rsi, volumeScore) {
    const divergences = await analyzeDivergences(symbol);
    if (!divergences.hasBearishDivergence) return false;
    
    if (rsi === null || rsi <= CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD) return false;
    
    const bollingerTouch = await checkBollingerTouch(symbol, 'sell');
    if (!bollingerTouch) return false;
    
    if (lsr <= 2.6) return false;
    
    if (volumeScore < 3) return false;
    
    const cooldownKey = `${symbol}_sell`;
    const lastAlert = alertCooldown.get(cooldownKey);
    if (lastAlert && (Date.now() - lastAlert) < 3600000) return false;
    
    return true;
}

// =====================================================================
// === OBTER LSR ===
// =====================================================================
async function getLSR(symbol) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        return data && data.length ? parseFloat(data[0].longShortRatio) : null;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === MONITOR EM TEMPO REAL VIA WEBSOCKET ===
// =====================================================================
class RealtimeAlertManager {
    constructor() {
        this.subscribedSymbols = new Set();
        this.cvdData = new Map();
        this.priceData = new Map();
        this.wsConnections = new Map();
        this.pendingAlerts = new Map();
    }
    
    async initialize() {
        const symbols = await this.getHighVolumeSymbols();
        console.log(`📊 Inicializando monitor para ${symbols.length} símbolos VÁLIDOS`);
        
        for (const symbol of symbols) {
            this.subscribeToSymbol(symbol);
        }
        
        setInterval(async () => {
            const newSymbols = await this.getHighVolumeSymbols();
            this.updateSubscriptions(newSymbols);
        }, 10 * 60 * 1000);
    }
    
    async getHighVolumeSymbols() {
        try {
            const validSymbolsSet = await getValidActiveSymbols();
            
            const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
            const data = await res.json();
            
            const filtered = data
                .filter(i => {
                    if (!i.symbol.endsWith('USDT')) return false;
                    if (!validSymbolsSet.has(i.symbol)) return false;
                    if (CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)) return false;
                    
                    const volume = parseFloat(i.quoteVolume);
                    return volume >= CONFIG.MONITOR.MIN_VOLUME_USDT;
                })
                .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
                .slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
            
            const symbols = filtered.map(i => i.symbol);
            console.log(`📊 Selecionados ${symbols.length} símbolos (todos válidos e ativos)`);
            
            return symbols;
            
        } catch (error) {
            console.log(`❌ Erro ao buscar símbolos: ${error.message}`);
            return [];
        }
    }
    
    subscribeToSymbol(symbol) {
        if (this.subscribedSymbols.has(symbol)) return;
        
        this.subscribedSymbols.add(symbol);
        
        const tradeWs = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@aggTrade`);
        tradeWs.on('message', (data) => this.handleTrade(symbol, data));
        tradeWs.on('error', () => console.log(`⚠️ Erro WS trade ${symbol}`));
        tradeWs.on('close', () => setTimeout(() => this.subscribeToSymbol(symbol), 5000));
        
        const candleWs = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_15m`);
        candleWs.on('message', (data) => this.handleCandle(symbol, data));
        candleWs.on('error', () => console.log(`⚠️ Erro WS candle ${symbol}`));
        candleWs.on('close', () => setTimeout(() => this.subscribeToSymbol(symbol), 5000));
        
        this.wsConnections.set(symbol, { tradeWs, candleWs });
        
        this.cvdData.set(symbol, { value: 0, buyVolume: 0, sellVolume: 0, history: [] });
        this.priceData.set(symbol, { price: 0, timestamp: 0 });
        
        console.log(`🔌 Conectado: ${symbol}`);
    }
    
    handleTrade(symbol, rawData) {
        try {
            const trade = JSON.parse(rawData);
            const volume = parseFloat(trade.q);
            const isBuyerMaker = trade.m;
            const delta = isBuyerMaker ? -volume : +volume;
            
            const data = this.cvdData.get(symbol);
            if (!data) return;
            
            data.value += delta;
            if (delta > 0) data.buyVolume += volume;
            else data.sellVolume += volume;
            
            data.history.push({
                timestamp: Date.now(),
                delta: delta,
                volume: volume,
                cvd: data.value
            });
            
            if (data.history.length > 1000) data.history.shift();
            
            this.checkConditions(symbol);
            
        } catch (error) {}
    }
    
    handleCandle(symbol, rawData) {
        try {
            const data = JSON.parse(rawData);
            const candle = data.k;
            
            // Quando o candle fecha (candle.x === true)
            if (candle.x) {
                const price = parseFloat(candle.c);
                this.priceData.set(symbol, { price: price, timestamp: Date.now() });
                console.log(`📊 Candle 15m fechado para ${symbol}: ${formatPrice(price)}`);
                
                // Verificar alertas pendentes que aguardavam confirmação
                this.checkPendingAlerts(symbol, price);
                
                // Verificar condições novamente
                this.checkConditions(symbol);
            }
        } catch (error) {}
    }
    
    async checkPendingAlerts(symbol, currentPrice) {
        const pendingKey = `${symbol}_pending`;
        const pending = this.pendingAlerts.get(pendingKey);
        
        if (!pending) return;
        
        console.log(`🔍 Verificando alerta pendente para ${symbol} após fechamento do candle`);
        
        // Revalidar todas as condições
        const [rsi, funding, lsrData, volumeProfile] = await Promise.all([
            getRSIForSymbol(symbol),
            this.getFundingRate(symbol),
            this.getLSR(symbol),
            Promise.resolve(this.getVolumeProfile(symbol))
        ]);
        
        if (!rsi || !funding || !lsrData) return;
        
        const fundingPercent = funding * 100;
        const volumeScore = volumeProfile ? volumeProfile.volumeScore : 0;
        
        if (pending.type === 'buy') {
            const buyConditions = await checkBuyConditions(symbol, currentPrice, lsrData, fundingPercent, rsi, volumeScore);
            if (buyConditions) {
                const atrData = await calculateATR(symbol, '1h', 14);
                if (atrData) {
                    const candles = await getCandles(symbol, '1h', 50);
                    const stopData = computeStopAndTargets(currentPrice, true, atrData.atr, candles);
                    
                    alertCooldown.set(`${symbol}_buy`, Date.now());
                    await sendBuyAlert(symbol, currentPrice, lsrData, fundingPercent.toFixed(4), rsi, volumeScore, stopData, '15m/1h/4h');
                    
                    // Remover pendência
                    this.pendingAlerts.delete(pendingKey);
                }
            }
        } else if (pending.type === 'sell') {
            const sellConditions = await checkSellConditions(symbol, currentPrice, lsrData, fundingPercent, rsi, volumeScore);
            if (sellConditions) {
                const atrData = await calculateATR(symbol, '1h', 14);
                if (atrData) {
                    const candles = await getCandles(symbol, '1h', 50);
                    const stopData = computeStopAndTargets(currentPrice, false, atrData.atr, candles);
                    
                    alertCooldown.set(`${symbol}_sell`, Date.now());
                    await sendSellAlert(symbol, currentPrice, lsrData, fundingPercent.toFixed(4), rsi, volumeScore, stopData, '15m/1h/4h');
                    
                    // Remover pendência
                    this.pendingAlerts.delete(pendingKey);
                }
            }
        }
    }
    
    getVolumeProfile(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length === 0) return null;
        
        const now = Date.now();
        const cutoff = now - (5 * 60 * 1000);
        
        let buyVolume = 0, sellVolume = 0, totalVolume = 0;
        
        for (const trade of data.history) {
            if (trade.timestamp >= cutoff) {
                if (trade.delta > 0) buyVolume += trade.volume;
                else sellVolume += trade.volume;
                totalVolume += trade.volume;
            }
        }
        
        if (totalVolume === 0) return null;
        
        const buyerRatio = (buyVolume / totalVolume) * 100;
        const dominantRatio = Math.max(buyerRatio, 100 - buyerRatio);
        const volumeScore = Math.floor(dominantRatio / 10);
        
        const profile = {
            buyerRatio: buyerRatio,
            sellerRatio: 100 - buyerRatio,
            dominantRatio: dominantRatio,
            volumeScore: Math.min(volumeScore, 9)
        };
        
        setLatestVolumeProfile(symbol, profile);
        return profile;
    }
    
    async checkConditions(symbol) {
        try {
            const lastCheckKey = `${symbol}_last_check`;
            const lastCheck = alertCooldown.get(lastCheckKey);
            if (lastCheck && (Date.now() - lastCheck) < 30000) return;
            alertCooldown.set(lastCheckKey, Date.now());
            
            const priceData = this.priceData.get(symbol);
            if (!priceData || priceData.price === 0) return;
            
            const currentPrice = priceData.price;
            
            const [rsi, funding, lsrData, volumeProfile] = await Promise.all([
                getRSIForSymbol(symbol),
                this.getFundingRate(symbol),
                this.getLSR(symbol),
                Promise.resolve(this.getVolumeProfile(symbol))
            ]);
            
            if (!rsi || !funding || !lsrData) return;
            
            const fundingPercent = funding * 100;
            const volumeScore = volumeProfile ? volumeProfile.volumeScore : 0;
            
            // Verificar condições de COMPRA
            const buyConditionsMet = await checkBuyConditions(symbol, currentPrice, lsrData, fundingPercent, rsi, volumeScore);
            if (buyConditionsMet) {
                // Aguardar confirmação do candle 15m
                const pendingKey = `${symbol}_pending`;
                if (!this.pendingAlerts.has(pendingKey)) {
                    console.log(`⏳ Aguardando confirmação de candle 15m para COMPRA ${symbol}`);
                    this.pendingAlerts.set(pendingKey, { type: 'buy', timestamp: Date.now() });
                }
                return;
            }
            
            // Verificar condições de VENDA
            const sellConditionsMet = await checkSellConditions(symbol, currentPrice, lsrData, fundingPercent, rsi, volumeScore);
            if (sellConditionsMet) {
                const pendingKey = `${symbol}_pending`;
                if (!this.pendingAlerts.has(pendingKey)) {
                    console.log(`⏳ Aguardando confirmação de candle 15m para VENDA ${symbol}`);
                    this.pendingAlerts.set(pendingKey, { type: 'sell', timestamp: Date.now() });
                }
                return;
            }
            
        } catch (error) {}
    }
    
    async getFundingRate(symbol) {
        try {
            const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
            const data = await res.json();
            return parseFloat(data.lastFundingRate);
        } catch (error) {
            return null;
        }
    }
    
    async getLSR(symbol) {
        try {
            const period = CONFIG.MONITOR.LSRS_PERIOD;
            const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
            const res = await fetch(url);
            const data = await res.json();
            return data && data.length ? parseFloat(data[0].longShortRatio) : null;
        } catch (error) {
            return null;
        }
    }
    
    updateSubscriptions(newSymbols) {
        const newSet = new Set(newSymbols);
        
        for (const symbol of this.subscribedSymbols) {
            if (!newSet.has(symbol)) {
                this.unsubscribeFromSymbol(symbol);
            }
        }
        
        for (const symbol of newSymbols) {
            if (!this.subscribedSymbols.has(symbol)) {
                this.subscribeToSymbol(symbol);
            }
        }
    }
    
    unsubscribeFromSymbol(symbol) {
        const conn = this.wsConnections.get(symbol);
        if (conn) {
            if (conn.tradeWs) conn.tradeWs.close();
            if (conn.candleWs) conn.candleWs.close();
            this.wsConnections.delete(symbol);
        }
        this.subscribedSymbols.delete(symbol);
        this.cvdData.delete(symbol);
        this.priceData.delete(symbol);
        this.pendingAlerts.delete(`${symbol}_pending`);
        console.log(`🔌 Desconectado: ${symbol}`);
    }
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i>Titanium Prime X </i>\n\n`;
    msg += `<i>✅ Sistema ativo</i>\n`;
   
   
    await sendToTelegram(msg);
}

// =====================================================================
// === INICIAR SISTEMA ===
// =====================================================================
async function start() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X ');
    console.log('='.repeat(70));
    
    await sendInitMessage();
    
    const alertManager = new RealtimeAlertManager();
    await alertManager.initialize();
    
    console.log('✅ Sistema em execução. Aguardando alertas...');
    console.log('📌 Alertas só serão enviados APÓS o fechamento do candle 15m');
}

process.on('SIGINT', () => {
    console.log('\n🛑 Desligando...');
    process.exit(0);
});

start().catch(console.error);
