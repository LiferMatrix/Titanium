const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '7708427979:AAF7vVx6AG8pSyzQ
        CHAT_ID: process.env.TELEGRAM_CHAT_ID || '-1002554
    },
    BOLLINGER: {
        PERIOD: 20,
        STD_DEV: 2,
        TIMEFRAME: '1d'
    },
    SCAN: {
        INTERVAL_MINUTES: 15,
        BATCH_SIZE: 20,
        SYMBOL_DELAY_MS: 100,
        REQUEST_TIMEOUT: 10000
    },
    ALERTS: {
        MAX_DAILY_PER_SYMBOL: 30,
        COOLDOWN_HOURS: 24,
        PRICE_DEVIATION: 0.1
    },
    VOLUME: {
        EMA_PERIOD: 9
    },
    RSI: {
        PERIOD: 14
    },
    STOCHASTIC: {
        DAILY: {
            K_PERIOD: 5,
            K_SMOOTH: 3,
            D_PERIOD: 3
        },
        FOUR_HOUR: {
            K_PERIOD: 14,
            K_SMOOTH: 3,
            D_PERIOD: 3
        }
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

function formatPrice(price) {
    if (!price || isNaN(price)) return '-';
    if (price > 1000) return price.toFixed(2);
    if (price > 1) return price.toFixed(3);
    if (price > 0.1) return price.toFixed(4);
    if (price > 0.01) return price.toFixed(5);
    if (price > 0.001) return price.toFixed(6);
    return price.toFixed(8);
}

// Cache simples
const alertCache = new Map();
const dailyCounter = new Map();

// =====================================================================
// === RATE LIMITER SIMPLES ===
// =====================================================================
class SimpleRateLimiter {
    constructor() {
        this.lastRequest = 0;
        this.minDelay = 200;
    }

    async wait() {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequest;
        if (timeSinceLast < this.minDelay) {
            await new Promise(r => setTimeout(r, this.minDelay - timeSinceLast));
        }
        this.lastRequest = Date.now();
    }

    async makeRequest(url) {
        await this.wait();
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN.REQUEST_TIMEOUT);
            
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            throw error;
        }
    }
}

const rateLimiter = new SimpleRateLimiter();

// =====================================================================
// === FUNÇÕES DE CÁLCULO ===
// =====================================================================

// Calcular SMA
function calculateSMA(values, period) {
    if (!values || values.length < period) return 0;
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

// Calcular EMA
function calculateEMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

// RMA (Wilder's Smoothing) - usado no RSI oficial
function calculateRMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    let rma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const alpha = 1 / period;
    
    for (let i = period; i < values.length; i++) {
        rma = alpha * values[i] + (1 - alpha) * rma;
    }
    return rma;
}

// Calcular RSI OFICIAL (igual ao TradingView)
function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) {
        return 50;
    }
    
    // Calcular mudanças de preço
    const changes = [];
    for (let i = 1; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i-1].close);
    }
    
    // Separar ganhos e perdas
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    // Calcular RMA (Wilder's Smoothing) para gains e losses
    const avgGain = calculateRMA(gains, period);
    const avgLoss = calculateRMA(losses, period);
    
    // Calcular RSI
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.min(100, Math.max(0, Math.round(rsi * 100) / 100));
}

// Calcular Estocástico (igual ao TradingView)
function calculateStochastic(candles, kPeriod, kSmooth, dPeriod) {
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) {
        return { k: 50, d: 50 };
    }
    
    // Calcular %K raw (Stochastic rápido)
    const kRaw = [];
    for (let i = kPeriod - 1; i < candles.length; i++) {
        const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
        const highestHigh = Math.max(...periodCandles.map(c => c.high));
        const lowestLow = Math.min(...periodCandles.map(c => c.low));
        const currentClose = candles[i].close;
        
        if (highestHigh - lowestLow === 0) {
            kRaw.push(50);
        } else {
            const kValue = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
            kRaw.push(Math.min(100, Math.max(0, kValue)));
        }
    }
    
    // Suavizar %K com SMA (kSmooth)
    const kSmoothValues = [];
    for (let i = kSmooth - 1; i < kRaw.length; i++) {
        const smoothSum = kRaw.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kSmoothValues.push(smoothSum / kSmooth);
    }
    
    // Calcular %D (SMA do %K suavizado)
    const dValues = [];
    for (let i = dPeriod - 1; i < kSmoothValues.length; i++) {
        const dSum = kSmoothValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
        dValues.push(dSum / dPeriod);
    }
    
    // Pegar os valores mais recentes
    const currentK = kSmoothValues.length > 0 ? kSmoothValues[kSmoothValues.length - 1] : 50;
    const currentD = dValues.length > 0 ? dValues[dValues.length - 1] : 50;
    
    return {
        k: Math.min(100, Math.max(0, Math.round(currentK * 100) / 100)),
        d: Math.min(100, Math.max(0, Math.round(currentD * 100) / 100))
    };
}

// Formatar Estocástico para exibição
function formatStochastic(stoch, type) {
    const k = stoch.k;
    const d = stoch.d;
    
    let emoji = '🟡';
    let signal = '';
    
    if (k < 20 && d < 25) {
        emoji = '🟢'; // Sobre vendido
        signal = '';
    } else if (k > 80 && d > 75) {
        emoji = '🔴'; // Sobre comprado
        signal = '';
    }
    
    if (k > d) {
        return `K${Math.round(k)}⤴️D${Math.round(d)} ${emoji} ${signal}`.trim();
    } else {
        return `K${Math.round(k)}⤵️D${Math.round(d)} ${emoji} ${signal}`.trim();
    }
}

// Determinar Comprador vs Vendedor baseado no EMA 9
function analyzeVolumeWithEMA(candles) {
    if (!candles || candles.length < CONFIG.VOLUME.EMA_PERIOD + 1) {
        return { 
            text: '⚪Neutro', 
            emoji: '⚪',
            percentage: 50,
            direction: 'Neutro'
        };
    }
    
    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, CONFIG.VOLUME.EMA_PERIOD);
    
    let bullishVolume = 0;
    let bearishVolume = 0;
    let totalVolume = 0;
    
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const volume = candle.volume;
        const close = candle.close;
        
        totalVolume += volume;
        
        if (close > ema9) {
            bullishVolume += volume;
        } 
        else if (close < ema9) {
            bearishVolume += volume;
        } 
        else {
            bullishVolume += volume / 2;
            bearishVolume += volume / 2;
        }
    }
    
    const buyerPercentage = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    const sellerPercentage = 100 - buyerPercentage;
    
    let direction = 'Neutro';
    let emoji = '⚪';
    let text = '';
    
    if (buyerPercentage > 52) {
        direction = 'Comprador';
        emoji = '🟢';
        text = `${emoji}Comprador`;
    } else if (sellerPercentage > 52) {
        direction = 'Vendedor';
        emoji = '🔴';
        text = `${emoji}Vendedor`;
    } else {
        text = '⚪Neutro';
    }
    
    return {
        text: text,
        emoji: emoji,
        percentage: buyerPercentage,
        sellerPercentage: sellerPercentage,
        direction: direction,
        emaValue: ema9
    };
}

// Calcular Bandas de Bollinger
function calculateBollingerBands(candles, period = 20, stdDev = 2) {
    if (!candles || candles.length < period) {
        return null;
    }
    
    const closes = candles.map(c => c.close);
    const recentCloses = closes.slice(-period);
    
    const sma = recentCloses.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentCloses.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const stdDeviation = Math.sqrt(variance);
    
    const upperBand = sma + (stdDev * stdDeviation);
    const lowerBand = sma - (stdDev * stdDeviation);
    
    return {
        upper: upperBand,
        middle: sma,
        lower: lowerBand,
        currentPrice: closes[closes.length - 1]
    };
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const data = await rateLimiter.makeRequest(url);
        
        return data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
    } catch (error) {
        return [];
    }
}

// =====================================================================
// === DADOS ADICIONAIS PARA O ALERTA ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice, isGreenAlert) {
    try {
        // Buscar candles para diferentes timeframes
        const [candles1h, candles3m, candlesDaily, candles4h, candlesWeekly] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '3m', 100),
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100),
            getCandles(symbol, '1w', 50)
        ]);
        
        // Calcular Bollinger Diário
        const bbDaily = calculateBollingerBands(candlesDaily, 20, 2);
        
        // Calcular Bollinger Semanal com fallback
        let bbWeekly = null;
        if (candlesWeekly.length >= 20) {
            bbWeekly = calculateBollingerBands(candlesWeekly, 20, 2);
        } else if (candlesWeekly.length >= 10) {
            bbWeekly = calculateBollingerBands(candlesWeekly, candlesWeekly.length, 2);
        }
        
        // Analisar volume com EMA 9 para 1h e 3m
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        
        // Calcular RSI 1h oficial
        const rsi = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        
        // Calcular Estocástico Diário (períodos do TradingView)
        const stochDaily = calculateStochastic(
            candlesDaily, 
            CONFIG.STOCHASTIC.DAILY.K_PERIOD,
            CONFIG.STOCHASTIC.DAILY.K_SMOOTH,
            CONFIG.STOCHASTIC.DAILY.D_PERIOD
        );
        
        // Calcular Estocástico 4h (períodos do TradingView)
        const stoch4h = calculateStochastic(
            candles4h, 
            CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD,
            CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH,
            CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD
        );
        
        // Formatar Estocásticos para exibição
        const stoch1dFormatted = formatStochastic(stochDaily, 'daily');
        const stoch4hFormatted = formatStochastic(stoch4h, '4h');
        
        // Volume ratio 1h
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        
        // Volume ratio 3m
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1] || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
        // LSR (Long/Short Ratio) - MANTIDO IGUAL AO ORIGINAL
        let lsr = null;
        try {
            const lsrData = await rateLimiter.makeRequest(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`);
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        
        // Funding Rate - MANTIDO IGUAL AO ORIGINAL
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        
        // Volume 24hs trend
        const volume24h = analyzeVolumeWithEMA(candles1h.slice(-24));
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        
        return {
            rsi,
            stoch1d: stoch1dFormatted,
            stoch4h: stoch4hFormatted,
            volume1h: {
                ratio: volumeRatio1h,
                percentage: volume1h.percentage,
                text: volume1h.text,
                ratioFormatted: volumeRatio1h.toFixed(2)
            },
            volume3m: {
                ratio: volumeRatio3m,
                percentage: volume3m.percentage,
                text: volume3m.text,
                ratioFormatted: volumeRatio3m.toFixed(2)
            },
            volume24h: {
                pct: volume24hPct,
                text: volume24h.text
            },
            bbDaily: bbDaily ? {
                upper: bbDaily.upper,
                lower: bbDaily.lower
            } : {
                upper: currentPrice * 1.2,
                lower: currentPrice * 0.8
            },
            bbWeekly: bbWeekly ? {
                upper: bbWeekly.upper,
                lower: bbWeekly.lower
            } : {
                upper: currentPrice * 1.3,
                lower: currentPrice * 0.7
            },
            lsr,
            funding
        };
    } catch (error) {
        console.log(`⚠️ Erro em getAdditionalData para ${symbol}:`, error.message);
        return {
            rsi: 50,
            stoch1d: 'K50⤵️D55 🟡',
            stoch4h: 'K50⤵️D55 🟡',
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro' },
            bbDaily: { upper: currentPrice * 1.2, lower: currentPrice * 0.8 },
            bbWeekly: { upper: currentPrice * 1.3, lower: currentPrice * 0.7 },
            lsr: null,
            funding: null
        };
    }
}

// =====================================================================
// === VERIFICAR SE PODE ENVIAR ALERTA ===
// =====================================================================
function canSendAlert(symbol, direction, price) {
    const now = Date.now();
    const key = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    const lastAlert = alertCache.get(key);
    if (lastAlert) {
        const hoursDiff = (now - lastAlert) / (1000 * 60 * 60);
        if (hoursDiff < CONFIG.ALERTS.COOLDOWN_HOURS) {
            return false;
        }
    }
    
    const lastPrice = alertCache.get(priceKey);
    if (lastPrice) {
        const priceDiff = Math.abs((price - lastPrice) / lastPrice * 100);
        if (priceDiff < CONFIG.ALERTS.PRICE_DEVIATION) {
            return false;
        }
    }
    
    const dailyCount = dailyCounter.get(dailyKey) || 0;
    if (dailyCount >= CONFIG.ALERTS.MAX_DAILY_PER_SYMBOL) {
        return false;
    }
    
    return true;
}

function registerAlert(symbol, direction, price) {
    const now = Date.now();
    const key = `${symbol}_${direction}`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    
    alertCache.set(key, now);
    alertCache.set(priceKey, price);
    
    const dailyCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, dailyCount);
    
    // Limpar cache antigo
    for (const [k, v] of alertCache) {
        if (now - v > 48 * 60 * 60 * 1000) {
            alertCache.delete(k);
        }
    }
}

// =====================================================================
// === ANALISAR BOLLINGER ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const candles = await getCandles(symbol, '1d', 50);
        if (candles.length < CONFIG.BOLLINGER.PERIOD) return null;
        
        const bb = calculateBollingerBands(candles, CONFIG.BOLLINGER.PERIOD, CONFIG.BOLLINGER.STD_DEV);
        if (!bb) return null;
        
        const currentPrice = bb.currentPrice;
        const touchedLower = currentPrice <= bb.lower * 1.001;
        const touchedUpper = currentPrice >= bb.upper * 0.999;
        
        if (!touchedLower && !touchedUpper) return null;
        
        const direction = touchedLower ? 'COMPRA' : 'VENDA';
        const emoji = touchedLower ? '🟢🔍 Analisar' : '🔴🔍 Analisar';
        
        if (!canSendAlert(symbol, direction, currentPrice)) return null;
        
        const additional = await getAdditionalData(symbol, currentPrice, touchedLower);
        
        const support = bb.lower * 0.98;
        const resistance = bb.upper * 1.02;
        
        const atr = (bb.upper - bb.lower) * 0.1;
        let stopLoss, tp1, tp2, tp3;
        
        if (touchedLower) {
            stopLoss = currentPrice - atr * 1.5;
            tp1 = currentPrice + atr * 2;
            tp2 = currentPrice + atr * 3;
            tp3 = currentPrice + atr * 4;
        } else {
            stopLoss = currentPrice + atr * 1.5;
            tp1 = currentPrice - atr * 2;
            tp2 = currentPrice - atr * 3;
            tp3 = currentPrice - atr * 4;
        }
        
        const dailyCount = dailyCounter.get(`${symbol}_daily`) || 0;
        
        return {
            symbol,
            direction: emoji,
            price: currentPrice,
            bbLower: bb.lower,
            bbUpper: bb.upper,
            support,
            resistance,
            stopLoss,
            tp1,
            tp2,
            tp3,
            dailyCount: dailyCount + 1,
            isGreenAlert: touchedLower,
            ...additional
        };
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FORMATAR MENSAGEM ===
// =====================================================================
function formatAlert(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    
    const fundingPct = data.funding ? (data.funding * 100).toFixed(4) : '0.0000';
    const fundingSign = data.funding && data.funding > 0 ? '+' : '';
    
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '⚪';
    
    const tp1 = formatPrice(data.tp1);
    const tp2 = formatPrice(data.tp2);
    const tp3 = formatPrice(data.tp3);
    const stop = formatPrice(data.stopLoss);
    
    const lsr = data.lsr ? data.lsr.toFixed(2) : 'N/A';
    
    const volume1hLine = `#Vol 1h: ${data.volume1h.ratioFormatted}x (${data.volume1h.percentage.toFixed(0)}%) ${data.volume1h.text}`;
    const volume3mLine = `#Vol 3m: ${data.volume3m.ratioFormatted}x (${data.volume3m.percentage.toFixed(0)}%) ${data.volume3m.text}`;
    
    // Formatar Bollinger bands
    let bbLines = '';
    if (data.isGreenAlert) {
        const bbDailyUpper = formatPrice(data.bbDaily.upper);
        const bbWeeklyUpper = formatPrice(data.bbWeekly.upper);
        bbLines = ` Superior Diário : $${bbDailyUpper}\n Superior Semanal: $${bbWeeklyUpper}`;
    } else {
        const bbDailyLower = formatPrice(data.bbDaily.lower);
        const bbWeeklyLower = formatPrice(data.bbWeekly.lower);
        bbLines = ` Inferior Diário : $${bbDailyLower}\n Inferior Semanal: $${bbWeeklyLower}`;
    }
    
    return `${data.direction} Convergência - ${symbolName}
 <i>Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 ▫️Vol 24hs: ${data.volume24h.pct} ${data.volume24h.text}
 #RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} 
 ${volume3mLine}
 ${volume1hLine}
 #LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
 Stoch 1D: ${data.stoch1d}
 Stoch 4H: ${data.stoch4h}
 🔻Resist: ${formatPrice(data.resistance)} | ${formatPrice(data.bbUpper)}
 🔹Supt: ${formatPrice(data.support)} | ${formatPrice(data.bbLower)}
${bbLines}
 Alvos: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop: ${stop}</i>
❅──────✧❅🔸❅✧──────❅
 🤖 IA Dica... <i>${data.direction === '🟢 Analisar' ? 'Observar Zonas de 🔹Suporte de Compra' : 'Realizar Lucro ou Parcial perto da 🔻Resistência.'}</i>
<i>Alerta Educativo, não é recomendação de investimento.</i>
 Titanium Prime by @J4Rviz`;
}

// =====================================================================
// === ENVIAR TELEGRAM ===
// =====================================================================
async function sendTelegramAlert(message) {
    if (!CONFIG.TELEGRAM.BOT_TOKEN) return false;
    
    try {
        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        return response.ok;
    } catch (error) {
        return false;
    }
}

// =====================================================================
// === BUSCAR SÍMBOLOS ===
// =====================================================================
async function fetchSymbols() {
    try {
        const data = await rateLimiter.makeRequest('https://fapi.binance.com/fapi/v1/exchangeInfo');
        
        return data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
    } catch (error) {
        // Fallback para símbolos populares se a API falhar
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 
                'ADAUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT', 'MATICUSDT', 'NEARUSDT',
                'AAVEUSDT', 'AXSUSDT', 'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'APEUSDT'];
    }
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Convergência');
    console.log('='.repeat(60));
    
    const symbols = await fetchSymbols();
    console.log(`📈 Monitorando ${symbols.length} símbolos`);
    console.log(`⏱️  Scan a cada ${CONFIG.SCAN.INTERVAL_MINUTES} minutos\n`);
    console.log(`📊 RSI: Período ${CONFIG.RSI.PERIOD} (Wilder Smoothing)`);
    console.log(`📊 Estocástico Diário: K${CONFIG.STOCHASTIC.DAILY.K_PERIOD}, Smooth${CONFIG.STOCHASTIC.DAILY.K_SMOOTH}, D${CONFIG.STOCHASTIC.DAILY.D_PERIOD}`);
    console.log(`📊 Estocástico 4H: K${CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD}, Smooth${CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH}, D${CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD}`);
    
    await sendTelegramAlert(`🤖 Titanium Scanner Ativado!\nMonitorando ${symbols.length} símbolos\nScan a cada ${CONFIG.SCAN.INTERVAL_MINUTES}min\nRSI: ${CONFIG.RSI.PERIOD} (Wilder)\nStoch Diário: K5/D3\nStoch 4H: K14/D3`);
    
    let scanCount = 0;
    
    while (true) {
        try {
            scanCount++;
            console.log(`\n📡 Scan #${scanCount} - ${getBrazilianDateTime().full}`);
            
            const alerts = [];
            
            for (let i = 0; i < symbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = symbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                
                const results = await Promise.allSettled(
                    batch.map(symbol => analyzeSymbol(symbol))
                );
                
                results.forEach(result => {
                    if (result.status === 'fulfilled' && result.value) {
                        alerts.push(result.value);
                    }
                });
                
                if (i + CONFIG.SCAN.BATCH_SIZE < symbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.SYMBOL_DELAY_MS));
                }
            }
            
            let sentCount = 0;
            for (const alert of alerts) {
                const message = formatAlert(alert);
                const sent = await sendTelegramAlert(message);
                
                if (sent) {
                    registerAlert(alert.symbol, alert.direction, alert.price);
                    sentCount++;
                    console.log(`✅ ${alert.direction} ${alert.symbol} - RSI: ${alert.rsi.toFixed(0)} | LSR: ${alert.lsr ? alert.lsr.toFixed(2) : 'N/A'} | Stoch D: ${alert.stoch1d}`);
                }
                
                await new Promise(r => setTimeout(r, 2000));
            }
            
            console.log(`📨 Alertas: ${sentCount}/${alerts.length}`);
            console.log(`⏳ Próximo scan em ${CONFIG.SCAN.INTERVAL_MINUTES} minutos`);
            
            await new Promise(r => setTimeout(r, CONFIG.SCAN.INTERVAL_MINUTES * 60 * 1000));
            
        } catch (error) {
            console.log('❌ Erro no scan:', error.message);
            await new Promise(r => setTimeout(r, 60000));
        }
    }
}

// =====================================================================
// === INICIAR ===
// =====================================================================
console.log('🚀 Iniciando ...');
startScanner().catch(console.error);
