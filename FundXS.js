const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const MEMORY_FILE = path.join(__dirname, 'fundingMonitorMemory.json');

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8',
        CHAT_ID: '-10025'
    },
    MONITOR: {
        INTERVAL_MINUTES: 5,
        TOP_SIZE: 8,
        MIN_VOLUME_USDT: 1000000,
        MAX_SYMBOLS: 100,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        RSI: {
            PERIOD: 14,
            TIMEFRAMES: ['15m', '1h', '4h'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCE_STRENGTH: 3,
            MIN_VOLUME_CONFIRMATION: 55
        },
        CVD: {
            CHECK_INTERVAL_SECONDS: 30,
            CVD_CHANGE_WINDOW: 60
        }
    }
};

// =====================================================================
// === CACHE RSI E DIVERGÊNCIAS ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();

// =====================================================================
// === CVD MANAGER VIA WEBSOCKET ===
// =====================================================================
class CVDManager {
    constructor() {
        this.cvdData = new Map();
        this.subscribedSymbols = new Set();
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
    }

    subscribeToSymbol(symbol) {
        if (this.subscribedSymbols.has(symbol)) return;
        
        this.subscribedSymbols.add(symbol);
        
        this.cvdData.set(symbol, {
            value: 0,
            history: [],
            lastUpdate: Date.now(),
            buyVolume: 0,
            sellVolume: 0,
            lastPrice: null,
            ws: null,
            connected: false,
            direction: '⏺',
            directionChange: 0
        });
        
        this.connectWebSocket(symbol);
    }
    
    connectWebSocket(symbol) {
        const symbolLower = symbol.toLowerCase();
        const wsUrl = `wss://fstream.binance.com/ws/${symbolLower}@aggTrade`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            this.reconnectAttempts.set(symbol, 0);
            const data = this.cvdData.get(symbol);
            if (data) {
                data.ws = ws;
                data.connected = true;
            }
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (error) {}
        });
        
        ws.on('error', () => {
            this.handleDisconnect(symbol);
        });
        
        ws.on('close', () => {
            this.handleDisconnect(symbol);
        });
        
        const data = this.cvdData.get(symbol);
        if (data) data.ws = ws;
    }
    
    processTrade(symbol, trade) {
        const volume = parseFloat(trade.q);
        const isBuyerMaker = trade.m;
        const delta = isBuyerMaker ? -volume : +volume;
        
        const data = this.cvdData.get(symbol);
        if (!data) return;
        
        data.value += delta;
        data.lastUpdate = Date.now();
        data.lastPrice = parseFloat(trade.p);
        
        if (delta > 0) data.buyVolume += volume;
        else data.sellVolume += volume;
        
        data.history.push({
            timestamp: Date.now(),
            delta: delta,
            volume: volume,
            cvd: data.value
        });
        
        if (data.history.length > 1000) data.history.shift();
        this.updateDirection(symbol);
    }
    
    updateDirection(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length < 10) return;
        
        const now = Date.now();
        const cutoff = now - (CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW * 1000);
        
        let oldCVD = null;
        for (let i = data.history.length - 1; i >= 0; i--) {
            if (data.history[i].timestamp <= cutoff) {
                oldCVD = data.history[i];
                break;
            }
        }
        
        if (!oldCVD) return;
        
        const change = data.value - oldCVD.cvd;
        const changePercent = Math.abs(change / (Math.abs(oldCVD.cvd) || 1)) * 100;
        
        if (change > 0 && changePercent >= 1) data.direction = '⤴️';
        else if (change < 0 && changePercent >= 1) data.direction = '⤵️';
        else data.direction = '⏺';
    }
    
    handleDisconnect(symbol) {
        const attempts = this.reconnectAttempts.get(symbol) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, attempts);
            setTimeout(() => {
                this.reconnectAttempts.set(symbol, attempts + 1);
                this.connectWebSocket(symbol);
            }, delay);
        } else {
            const data = this.cvdData.get(symbol);
            if (data && data.ws) {
                try { data.ws.terminate(); } catch(e) {}
            }
        }
    }
    
    unsubscribeFromSymbol(symbol) {
        const data = this.cvdData.get(symbol);
        if (data && data.ws) {
            try { data.ws.close(); data.ws.terminate(); } catch(e) {}
        }
        this.subscribedSymbols.delete(symbol);
        this.cvdData.delete(symbol);
    }
    
    getCVD(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return null;
        return { direction: data.direction };
    }
    
    getVolumeProfile(symbol, minutesAgo = 5) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length === 0) return null;
        
        const now = Date.now();
        const cutoff = now - (minutesAgo * 60 * 1000);
        
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
        const sellerRatio = (sellVolume / totalVolume) * 100;
        
        return {
            buyerRatio: buyerRatio,
            sellerRatio: sellerRatio,
            totalVolume: totalVolume,
            dominant: buyerRatio > sellerRatio ? 'buyers' : 'sellers',
            dominantRatio: Math.max(buyerRatio, sellerRatio)
        };
    }
    
    cleanup() {
        for (const symbol of this.subscribedSymbols) {
            this.unsubscribeFromSymbol(symbol);
        }
    }
}

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
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

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const icons = { error: '❌', success: '✅', warning: '⚠️', info: 'ℹ️' };
    console.log(`${icons[type]} ${timestamp} - ${message}`);
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
// === FUNÇÃO PARA ENCONTRAR PIVÔS (MÁXIMOS E MÍNIMOS LOCAIS) ===
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
// === FUNÇÃO PARA DETECTAR DIVERGÊNCIAS DE RSI COM PIVÔS E VOLUME ===
// =====================================================================
function findRSIDivergences(prices, rsiValues, volumeProfile = null) {
    const divergences = { bullish: [], bearish: [] };
    
    if (prices.length < 30 || rsiValues.length < 30) return divergences;
    
    const pricePivots = findPivots(prices, 3);
    const rsiPivots = findPivots(rsiValues, 3);
    
    // DIVERGÊNCIA DE ALTA (BULLISH)
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
                        // Validar volume se disponível
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'buyers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bullish.push({
                            type: 'bullish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    // DIVERGÊNCIA DE BAIXA (BEARISH)
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
                        // Validar volume se disponível
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'sellers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bearish.push({
                            type: 'bearish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    return divergences;
}

// =====================================================================
// === ANALISAR DIVERGÊNCIAS EM MÚLTIPLOS TIMEFRAMES COM VOLUME ===
// =====================================================================
async function analyzeDivergences(symbol, cvdManager) {
    const cacheKey = `${symbol}_divergences`;
    const now = Date.now();
    const cached = divergenceCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < 300000) {
        return cached.data;
    }
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false,
        bullishTimeframes: [],
        bearishTimeframes: [],
        bestBullishVolumeScore: 0,
        bestBearishVolumeScore: 0
    };
    
    // Pega perfil de volume do CVD (últimos 5 minutos)
    const volumeProfile = cvdManager.getVolumeProfile(symbol, 5);
    
    for (const timeframe of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        try {
            const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) continue;
            
            const prices = candles.map(c => c.close);
            const rsi = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
            if (!rsi || rsi.length < 50) continue;
            
            const divergences = findRSIDivergences(prices, rsi, volumeProfile);
            
            if (divergences.bullish.length > 0) {
                result.hasBullishDivergence = true;
                result.bullishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bullish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBullishVolumeScore) {
                    result.bestBullishVolumeScore = maxVolumeScore;
                }
            }
            
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
                result.bearishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bearish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBearishVolumeScore) {
                    result.bestBearishVolumeScore = maxVolumeScore;
                }
            }
            
        } catch (error) {
            // continua para próximo timeframe
        }
    }
    
    divergenceCache.set(cacheKey, {
        data: result,
        timestamp: now
    });
    
    return result;
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
// === OBTER RSI 1h COM CACHE ===
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
// === EMOJI BASEADO NO RSI ===
// =====================================================================
function getRSIEmoji(rsiValue) {
    if (rsiValue === null || rsiValue === undefined) return '⚪';
    if (rsiValue < 20) return '🔵';
    if (rsiValue <= 35) return '🟢';
    if (rsiValue <= 45) return '🟡';
    if (rsiValue <= 58) return '🟠';
    if (rsiValue <= 75) return '🔴';
    return '🔥';
}

// =====================================================================
// === BUSCAR DADOS 24h ===
// =====================================================================
async function get24hData() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        const filtered = data.filter(i => 
            i.symbol.endsWith('USDT') && 
            parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && 
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)
        ).slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
        
        const result = {};
        for (const i of filtered) {
            result[i.symbol] = { 
                symbol: i.symbol, 
                price: parseFloat(i.lastPrice), 
                volume24h: parseFloat(i.quoteVolume)
            };
        }
        return result;
    } catch (error) {
        log(`Erro 24h: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR FUNDING RATES ===
// =====================================================================
async function getFundingRates(symbols) {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) {
            if (symbols.includes(i.symbol)) {
                result[i.symbol] = parseFloat(i.lastFundingRate);
            }
        }
        return result;
    } catch (error) {
        log(`Erro funding: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR LSR ===
// =====================================================================
async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const promises = symbols.map(async s => {
            try {
                const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${period}&limit=1`;
                const res = await fetch(url);
                const data = await res.json();
                return { symbol: s, lsr: data && data.length ? parseFloat(data[0].longShortRatio) : null };
            } catch {
                return { symbol: s, lsr: null };
            }
        });
        const results = await Promise.all(promises);
        const result = {};
        for (const i of results) {
            result[i.symbol] = i.lsr;
        }
        return result;
    } catch (error) {
        log(`Erro LSR: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === ATUALIZAR LISTA DE SÍMBOLOS COM CRITÉRIO DE DIVERGÊNCIA ===
// =====================================================================
async function updateWatchedSymbols(cvdManager) {
    const ticker = await get24hData();
    const symbols = Object.keys(ticker);
    if (!symbols.length) return null;
    
    const funding = await getFundingRates(symbols);
    const lsr = await getLSRData(symbols);
    
    const allSymbols = [];
    
    for (const s of symbols) {
        if (funding[s] !== undefined && lsr[s] !== null && lsr[s] > 0) {
            const rsiValue = await getRSIForSymbol(s);
            const divergences = await analyzeDivergences(s, cvdManager);
            const cvd = cvdManager.getCVD(s);
            
            allSymbols.push({ 
                symbol: s.replace('USDT', ''), 
                fullSymbol: s, 
                price: ticker[s].price, 
                funding: funding[s], 
                fundingPercent: funding[s] * 100, 
                lsr: lsr[s],
                rsi: rsiValue,
                rsiEmoji: getRSIEmoji(rsiValue),
                cvdDirection: cvd ? cvd.direction : '⏺',
                divergences: divergences
            });
        }
    }
    
    // LISTA POSITIVA (BEAR): Maior funding + Maior LSR + DIVERGÊNCIA DE BAIXA
    const positive = [...allSymbols]
        .filter(item => item.divergences.hasBearishDivergence === true)
        .sort((a, b) => b.funding - a.funding)
        .slice(0, CONFIG.MONITOR.TOP_SIZE * 2)
        .sort((a, b) => b.lsr - a.lsr)
        .slice(0, CONFIG.MONITOR.TOP_SIZE);
    
    // LISTA NEGATIVA (BULL): Menor funding + Menor LSR + DIVERGÊNCIA DE ALTA
    const negative = [...allSymbols]
        .filter(item => item.divergences.hasBullishDivergence === true)
        .sort((a, b) => a.funding - b.funding)
        .slice(0, CONFIG.MONITOR.TOP_SIZE * 2)
        .sort((a, b) => a.lsr - b.lsr)
        .slice(0, CONFIG.MONITOR.TOP_SIZE);
    
    return { positive, negative };
}

// =====================================================================
// === FORMATAR MENSAGEM DA LISTA COM NÚMERO DE VOLUME ===
// =====================================================================
function formatListMessage(positive, negative) {
    const dt = getBrazilianDateTime();
    const maxDisplay = 8;
    const posShow = positive.slice(0, maxDisplay);
    const negShow = negative.slice(0, maxDisplay);
    
    let msg = `<i>🎯Scanner: ${dt.full}hs...by @J4Rviz Technology</i>\n`;
    msg += `\n<i>🔴 Titanium Setup Bear</i>\n`;
    msg += `<i>🔍🤖 Em análise para 🔻Correção...</i>\n`;
    msg += `<i>Par    Preço     Funding     LSR   Vol</i>\n`;
    msg += `<i>--------------------------------------</i>\n`;
    
    if (posShow.length === 0) {
        msg += `<i>⚠️ Nenhum símbolo</i>\n`;
    } else {
        for (const item of posShow) {
            const funding = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
            const volumeScore = item.divergences.bestBearishVolumeScore || 0;
            msg += `<i>${item.rsiEmoji}${item.cvdDirection}${item.symbol.padEnd(6)} ${formatPrice(item.price).padEnd(10)} ${funding.padEnd(10)} ${item.lsr.toFixed(2)}  ${volumeScore}</i>\n`;
        }
    }
    
    if (positive.length > maxDisplay) {
        msg += `<i>... e mais ${positive.length - maxDisplay} símbolos</i>\n`;
    }
    
    msg += `\n<i>🟢 Titanium Setup Bull</i>\n`;
    msg += `<i>🔍🤖 Em análise para 💹Compra...</i>\n`;
    msg += `<i>Par    Preço     Funding     LSR   Vol</i>\n`;
    msg += `<i>--------------------------------------</i>\n`;
    
    if (negShow.length === 0) {
        msg += `<i>⚠️ Nenhum símbolo </i>\n`;
    } else {
        for (const item of negShow) {
            const funding = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
            const volumeScore = item.divergences.bestBullishVolumeScore || 0;
            msg += `<i>${item.rsiEmoji}${item.cvdDirection}${item.symbol.padEnd(6)} ${formatPrice(item.price).padEnd(10)} ${funding.padEnd(10)} ${item.lsr.toFixed(2)}  ${volumeScore}</i>\n`;
        }
    }
    
    if (negative.length > maxDisplay) {
        msg += `<i>... e mais ${negative.length - maxDisplay} símbolos</i>\n`;
    }
    
    return msg;
}

// =====================================================================
// === ENVIAR MENSAGEM TELEGRAM ===
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
        
        if (response.ok) {
            console.log(`✅ Mensagem enviada com sucesso!`);
            return true;
        }
        return false;
    } catch (error) {
        console.log(`❌ Telegram exception: ${error.message}`);
        return false;
    }
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i>Titanium Prime X</i>\n\n`;
    msg += `<i>✅ Monitor </i>\n`;
    msg += `<i>📊 Lista atualizada a cada 10 minutos</i>\n`;
   
    await sendToTelegram(msg);
}

// =====================================================================
// === SISTEMA DE MEMÓRIA ===
// =====================================================================
class FundingMemory {
    constructor() {
        this.watchedSymbols = { positive: [], negative: [] };
        this.loadFromFile();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                const data = fs.readFileSync(MEMORY_FILE, 'utf8');
                const loaded = JSON.parse(data);
                this.watchedSymbols = loaded.watchedSymbols || { positive: [], negative: [] };
                console.log(`📂 Memória carregada`);
            }
        } catch (error) {}
    }

    saveToFile() {
        try {
            const data = { watchedSymbols: this.watchedSymbols, lastUpdate: Date.now() };
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
        } catch (error) {}
    }

    updateWatchedSymbols(positive, negative) {
        this.watchedSymbols.positive = positive;
        this.watchedSymbols.negative = negative;
        this.saveToFile();
    }
}

// =====================================================================
// === MONITOR PRINCIPAL ===
// =====================================================================
const fundingMemory = new FundingMemory();
const cvdManager = new CVDManager();

async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X - MONITOR COMPLETO');
    console.log('='.repeat(70));
    
    await sendInitMessage();
    
    let currentPositive = [], currentNegative = [];
    
    const initial = await updateWatchedSymbols(cvdManager);
    if (initial) {
        currentPositive = initial.positive;
        currentNegative = initial.negative;
        fundingMemory.updateWatchedSymbols(currentPositive, currentNegative);
        
        for (const item of [...currentPositive, ...currentNegative]) {
            cvdManager.subscribeToSymbol(item.fullSymbol);
        }
        
        await sendToTelegram(formatListMessage(currentPositive, currentNegative));
    }
    
    setInterval(async () => {
        const result = await updateWatchedSymbols(cvdManager);
        if (result) {
            const oldSymbols = [...currentPositive.map(s => s.fullSymbol), ...currentNegative.map(s => s.fullSymbol)];
            const newSymbols = [...result.positive.map(p => p.fullSymbol), ...result.negative.map(n => n.fullSymbol)];
            
            for (const s of oldSymbols) {
                if (!newSymbols.includes(s)) {
                    cvdManager.unsubscribeFromSymbol(s);
                }
            }
            
            for (const item of [...result.positive, ...result.negative]) {
                if (!cvdManager.subscribedSymbols.has(item.fullSymbol)) {
                    cvdManager.subscribeToSymbol(item.fullSymbol);
                }
            }
            
            currentPositive = result.positive;
            currentNegative = result.negative;
            fundingMemory.updateWatchedSymbols(currentPositive, currentNegative);
            await sendToTelegram(formatListMessage(currentPositive, currentNegative));
        }
    }, CONFIG.MONITOR.INTERVAL_MINUTES * 60 * 1000);
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
