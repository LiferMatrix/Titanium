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
        BOT_TOKEN: '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A',
        CHAT_ID: '-1001990889297'
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
        MAX_DAILY_PER_SYMBOL: 50,
        COOLDOWN_HOURS: 4,
        PRICE_DEVIATION: 0.3
    },
    VOLUME: {
        EMA_PERIOD: 9
    },
    RSI: {
        PERIOD: 14
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '1h', '2h', '4h'],
        LOOKBACK_PERIODS: 10,
        SCORE_MULTIPLIER: {
            '15m': 0.5,
            '1h': 1.0,
            '2h': 1.5,
            '4h': 2.0
        }
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
    },
    REVERSAL: {
        MIN_CONFIRMATION_SCORE: 3,
        VOLUME_THRESHOLD: 1.2,
        STOCH_OVERSOLD: 25,
        STOCH_OVERBOUGHT: 75
    },
    LSR_PENALTY: {
        BUY_MAX_RATIO: 3.5,      // Acima disso penaliza compra
        SELL_MIN_RATIO: 1.0,      // Abaixo disso penaliza venda
        PENALTY_POINTS: -2         // Pontos de penalidade
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

function calculateSMA(values, period) {
    if (!values || values.length < period) return 0;
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

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

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) {
        return 50;
    }
    
    const changes = [];
    for (let i = 1; i < candles.length; i++) {
        changes.push(candles[i].close - candles[i-1].close);
    }
    
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);
    
    const avgGain = calculateRMA(gains, period);
    const avgLoss = calculateRMA(losses, period);
    
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.min(100, Math.max(0, Math.round(rsi * 100) / 100));
}

function calculateStochastic(candles, kPeriod, kSmooth, dPeriod) {
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) {
        return { k: 50, d: 50 };
    }
    
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
    
    const kSmoothValues = [];
    for (let i = kSmooth - 1; i < kRaw.length; i++) {
        const smoothSum = kRaw.slice(i - kSmooth + 1, i + 1).reduce((a, b) => a + b, 0);
        kSmoothValues.push(smoothSum / kSmooth);
    }
    
    const dValues = [];
    for (let i = dPeriod - 1; i < kSmoothValues.length; i++) {
        const dSum = kSmoothValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0);
        dValues.push(dSum / dPeriod);
    }
    
    const currentK = kSmoothValues.length > 0 ? kSmoothValues[kSmoothValues.length - 1] : 50;
    const currentD = dValues.length > 0 ? dValues[dValues.length - 1] : 50;
    
    return {
        k: Math.min(100, Math.max(0, Math.round(currentK * 100) / 100)),
        d: Math.min(100, Math.max(0, Math.round(currentD * 100) / 100))
    };
}

function formatStochastic(stoch, type) {
    const k = stoch.k;
    const d = stoch.d;
    
    let emoji = '🟡';
    
    if (k < 20 && d < 25) {
        emoji = '🟢';
    } else if (k > 80 && d > 75) {
        emoji = '🔴';
    }
    
    if (k > d) {
        return `K${Math.round(k)}⤴️D${Math.round(d)} ${emoji}`;
    } else {
        return `K${Math.round(k)}⤵️D${Math.round(d)} ${emoji}`;
    }
}

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
    
    let direction = 'Neutro';
    let emoji = '⚪';
    let text = '';
    
    if (buyerPercentage > 52) {
        direction = 'Comprador';
        emoji = '🟢';
        text = `${emoji}Comprador`;
    } else if (buyerPercentage < 48) {
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
        sellerPercentage: 100 - buyerPercentage,
        direction: direction,
        emaValue: ema9
    };
}

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
// === FUNÇÕES DE CONFIRMAÇÃO DE REVERSÃO ===
// =====================================================================

function isTrueReversal(candles, bb, touchedLower, touchedUpper) {
    if (!candles || candles.length < 5) return { isReversal: false, score: 0, details: {} };
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const prevPrevCandle = candles[candles.length - 3];
    const currentPrice = lastCandle.close;
    
    const details = {};
    let score = 0;
    
    if (touchedLower) {
        // CONDIÇÃO 1: Candle de alta (fechamento > abertura)
        const isBullishCandle = lastCandle.close > lastCandle.open;
        details.isBullishCandle = isBullishCandle;
        if (isBullishCandle) score++;
        
        // CONDIÇÃO 2: Fechou acima da banda inferior (com margem de 0.5%)
        const closedAboveLower = currentPrice > bb.lower * 1.005;
        details.closedAboveLower = closedAboveLower;
        if (closedAboveLower) score++;
        
        // CONDIÇÃO 3: Sombra inferior longa (rejeição)
        const lowerShadow = Math.min(lastCandle.open, lastCandle.close) - lastCandle.low;
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongLowerShadow = bodySize > 0 ? lowerShadow > bodySize * 0.5 : lowerShadow > 0;
        details.hasLongLowerShadow = hasLongLowerShadow;
        if (hasLongLowerShadow) score++;
        
        // CONDIÇÃO 4: Volume aumentando em relação ao candle anterior
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) score++;
        
        // CONDIÇÃO 5: Preço não está mais caindo (momentum)
        const priceStabilized = lastCandle.close > prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) score++;
        
        // CONDIÇÃO 6: Mínima do candle foi a mais baixa dos últimos 3 períodos
        const lowestIn3 = Math.min(prevPrevCandle.low, prevCandle.low, lastCandle.low) === lastCandle.low;
        details.lowestIn3 = lowestIn3;
        if (lowestIn3) score++;
    }
    
    if (touchedUpper) {
        // CONDIÇÃO 1: Candle de baixa (fechamento < abertura)
        const isBearishCandle = lastCandle.close < lastCandle.open;
        details.isBearishCandle = isBearishCandle;
        if (isBearishCandle) score++;
        
        // CONDIÇÃO 2: Fechou abaixo da banda superior
        const closedBelowUpper = currentPrice < bb.upper * 0.995;
        details.closedBelowUpper = closedBelowUpper;
        if (closedBelowUpper) score++;
        
        // CONDIÇÃO 3: Sombra superior longa (rejeição)
        const upperShadow = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);
        const bodySize = Math.abs(lastCandle.close - lastCandle.open);
        const hasLongUpperShadow = bodySize > 0 ? upperShadow > bodySize * 0.5 : upperShadow > 0;
        details.hasLongUpperShadow = hasLongUpperShadow;
        if (hasLongUpperShadow) score++;
        
        // CONDIÇÃO 4: Volume aumentando
        const volumeIncreasing = lastCandle.volume > prevCandle.volume * 1.1;
        details.volumeIncreasing = volumeIncreasing;
        if (volumeIncreasing) score++;
        
        // CONDIÇÃO 5: Preço não está mais subindo
        const priceStabilized = lastCandle.close < prevPrevCandle.close;
        details.priceStabilized = priceStabilized;
        if (priceStabilized) score++;
        
        // CONDIÇÃO 6: Máxima do candle foi a mais alta dos últimos 3 períodos
        const highestIn3 = Math.max(prevPrevCandle.high, prevCandle.high, lastCandle.high) === lastCandle.high;
        details.highestIn3 = highestIn3;
        if (highestIn3) score++;
    }
    
    return {
        isReversal: score >= CONFIG.REVERSAL.MIN_CONFIRMATION_SCORE,
        score: score,
        details: details
    };
}

// =====================================================================
// === NOVA FUNÇÃO: VERIFICAR DIVERGÊNCIA RSI EM MÚLTIPLOS TIMEFRAMES ===
// =====================================================================
function checkRSIDivergenceMultiTimeframe(candlesByTimeframe) {
    const divergences = [];
    let totalScore = 0;
    
    for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
        const candles = candlesByTimeframe[tf];
        if (!candles || candles.length < 20) continue;
        
        // Calcular RSI para os últimos candles
        const rsiValues = [];
        for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
            rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
        }
        
        if (rsiValues.length < CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS) continue;
        
        const prices = candles.map(c => c.close);
        
        // Pegar últimos períodos para análise
        const recentPrices = prices.slice(-CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS);
        const recentRSI = rsiValues.slice(-CONFIG.RSI_DIVERGENCE.LOOKBACK_PERIODS);
        
        // Encontrar fundos no preço e RSI
        const priceLows = [];
        const rsiLows = [];
        const priceHighs = [];
        const rsiHighs = [];
        
        for (let i = 2; i < recentPrices.length - 2; i++) {
            // Encontrar fundos
            if (recentPrices[i] < recentPrices[i-1] && recentPrices[i] < recentPrices[i+1]) {
                priceLows.push({ index: i, value: recentPrices[i] });
            }
            if (recentRSI[i] < recentRSI[i-1] && recentRSI[i] < recentRSI[i+1]) {
                rsiLows.push({ index: i, value: recentRSI[i] });
            }
            
            // Encontrar topos
            if (recentPrices[i] > recentPrices[i-1] && recentPrices[i] > recentPrices[i+1]) {
                priceHighs.push({ index: i, value: recentPrices[i] });
            }
            if (recentRSI[i] > recentRSI[i-1] && recentRSI[i] > recentRSI[i+1]) {
                rsiHighs.push({ index: i, value: recentRSI[i] });
            }
        }
        
        // Verificar divergência de alta (bullish)
        let bullishDivergence = false;
        if (priceLows.length >= 2 && rsiLows.length >= 2) {
            const lastPriceLow = priceLows[priceLows.length - 1];
            const prevPriceLow = priceLows[priceLows.length - 2];
            const lastRSILow = rsiLows[rsiLows.length - 1];
            const prevRSILow = rsiLows[rsiLows.length - 2];
            
            // Preço faz fundo mais baixo, RSI faz fundo mais alto
            if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
                bullishDivergence = true;
            }
        }
        
        // Verificar divergência de baixa (bearish)
        let bearishDivergence = false;
        if (priceHighs.length >= 2 && rsiHighs.length >= 2) {
            const lastPriceHigh = priceHighs[priceHighs.length - 1];
            const prevPriceHigh = priceHighs[priceHighs.length - 2];
            const lastRSIHigh = rsiHighs[rsiHighs.length - 1];
            const prevRSIHigh = rsiHighs[rsiHighs.length - 2];
            
            // Preço faz topo mais alto, RSI faz topo mais baixo
            if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
                bearishDivergence = true;
            }
        }
        
        const multiplier = CONFIG.RSI_DIVERGENCE.SCORE_MULTIPLIER[tf] || 1;
        
        if (bullishDivergence) {
            const score = 2 * multiplier;
            totalScore += score;
            divergences.push({
                timeframe: tf,
                type: 'bullish',
                score: score,
                emoji: '📈'
            });
        } else if (bearishDivergence) {
            const score = 2 * multiplier;
            totalScore += score;
            divergences.push({
                timeframe: tf,
                type: 'bearish',
                score: score,
                emoji: '📉'
            });
        }
    }
    
    return {
        hasDivergence: divergences.length > 0,
        divergences: divergences,
        totalScore: totalScore
    };
}

function checkStochasticReversal(stochK, stochD, isGreenAlert) {
    if (isGreenAlert) {
        // Para compra: estocástico abaixo de 30 e K > D (cruzando para cima)
        return stochK < CONFIG.REVERSAL.STOCH_OVERSOLD + 10 && stochK > stochD;
    } else {
        // Para venda: estocástico acima de 70 e K < D (cruzando para baixo)
        return stochK > CONFIG.REVERSAL.STOCH_OVERBOUGHT - 10 && stochK < stochD;
    }
}

// =====================================================================
// === NOVA FUNÇÃO: VERIFICAR PENALIDADE LSR ===
// =====================================================================
function checkLSRPenalty(lsr, isGreenAlert) {
    if (!lsr) return { hasPenalty: false, points: 0, message: '' };
    
    if (isGreenAlert && lsr > CONFIG.LSR_PENALTY.BUY_MAX_RATIO) {
        return {
            hasPenalty: true,
            points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
            message: `⚠️ LSR alto (${lsr.toFixed(2)}) - Muitos comprados (-2)`
        };
    }
    
    if (!isGreenAlert && lsr < CONFIG.LSR_PENALTY.SELL_MIN_RATIO) {
        return {
            hasPenalty: true,
            points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
            message: `⚠️ LSR baixo (${lsr.toFixed(2)}) - Muitos vendidos (-2)`
        };
    }
    
    return { hasPenalty: false, points: 0, message: '' };
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
        // Buscar candles para múltiplos timeframes
        const [candles1h, candles3m, candlesDaily, candles4h, candlesWeekly, candles15m, candles2h] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '3m', 100),
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100),
            getCandles(symbol, '1w', 50),
            getCandles(symbol, '15m', 100),
            getCandles(symbol, '2h', 100)
        ]);
        
        const bbDaily = calculateBollingerBands(candlesDaily, 20, 2);
        const bb4h = calculateBollingerBands(candles4h, 20, 2);
        
        let bbWeekly = null;
        if (candlesWeekly.length >= 20) {
            bbWeekly = calculateBollingerBands(candlesWeekly, 20, 2);
        } else if (candlesWeekly.length >= 10) {
            bbWeekly = calculateBollingerBands(candlesWeekly, candlesWeekly.length, 2);
        }
        
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        
        const rsi = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        
        const stochDaily = calculateStochastic(
            candlesDaily, 
            CONFIG.STOCHASTIC.DAILY.K_PERIOD,
            CONFIG.STOCHASTIC.DAILY.K_SMOOTH,
            CONFIG.STOCHASTIC.DAILY.D_PERIOD
        );
        
        const stoch4h = calculateStochastic(
            candles4h, 
            CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD,
            CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH,
            CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD
        );
        
        const stoch1dFormatted = formatStochastic(stochDaily, 'daily');
        const stoch4hFormatted = formatStochastic(stoch4h, '4h');
        
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1] || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
        let lsr = null;
        try {
            const lsrData = await rateLimiter.makeRequest(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`);
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        const volume24hText = volume1h.text;
        
        return {
            rsi,
            stoch1d: stoch1dFormatted,
            stoch4h: stoch4hFormatted,
            stochDailyValues: stochDaily,
            stoch4hValues: stoch4h,
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
                text: volume24hText
            },
            bbDaily: bbDaily ? {
                upper: bbDaily.upper,
                lower: bbDaily.lower
            } : {
                upper: currentPrice * 1.2,
                lower: currentPrice * 0.8
            },
            bb4h: bb4h ? {
                upper: bb4h.upper,
                lower: bb4h.lower
            } : {
                upper: currentPrice * 1.15,
                lower: currentPrice * 0.85
            },
            bbWeekly: bbWeekly ? {
                upper: bbWeekly.upper,
                lower: bbWeekly.lower
            } : {
                upper: currentPrice * 1.3,
                lower: currentPrice * 0.7
            },
            lsr,
            funding,
            // Candles para análise de divergência em múltiplos timeframes
            candlesByTimeframe: {
                '15m': candles15m.slice(-30),
                '1h': candles1h.slice(-30),
                '2h': candles2h.slice(-30),
                '4h': candles4h.slice(-30)
            }
        };
    } catch (error) {
        console.log(`⚠️ Erro em getAdditionalData para ${symbol}:`, error.message);
        return {
            rsi: 50,
            stoch1d: 'K50⤵️D55 🟡',
            stoch4h: 'K50⤵️D55 🟡',
            stochDailyValues: { k: 50, d: 55 },
            stoch4hValues: { k: 50, d: 55 },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro' },
            bbDaily: { upper: currentPrice * 1.2, lower: currentPrice * 0.8 },
            bb4h: { upper: currentPrice * 1.15, lower: currentPrice * 0.85 },
            bbWeekly: { upper: currentPrice * 1.3, lower: currentPrice * 0.7 },
            lsr: null,
            funding: null,
            candlesByTimeframe: {
                '15m': [],
                '1h': [],
                '2h': [],
                '4h': []
            }
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
    
    for (const [k, v] of alertCache) {
        if (now - v > 48 * 60 * 60 * 1000) {
            alertCache.delete(k);
        }
    }
}

// =====================================================================
// === ANALISAR SÍMBOLO - AGORA COM SUPORTE A 1D E 4H ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        // Buscar candles para ambos timeframes
        const [candlesDaily, candles4h] = await Promise.all([
            getCandles(symbol, '1d', 100),
            getCandles(symbol, '4h', 100)
        ]);
        
        const alerts = [];
        
        // ANALISAR TIMEFRAME DIÁRIO
        if (candlesDaily.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            const alertDaily = await analyzeTimeframe(symbol, candlesDaily, '1d');
            if (alertDaily) alerts.push(alertDaily);
        }
        
        // ANALISAR TIMEFRAME 4H
        if (candles4h.length >= CONFIG.BOLLINGER.PERIOD + 5) {
            const alert4h = await analyzeTimeframe(symbol, candles4h, '4h');
            if (alert4h) alerts.push(alert4h);
        }
        
        return alerts.length > 0 ? alerts : null;
        
    } catch (error) {
        return null;
    }
}

async function analyzeTimeframe(symbol, candles, timeframe) {
    try {
        const bb = calculateBollingerBands(candles, CONFIG.BOLLINGER.PERIOD, CONFIG.BOLLINGER.STD_DEV);
        if (!bb) return null;
        
        const currentPrice = bb.currentPrice;
        const lastCandle = candles[candles.length - 1];
        
        const touchedLower = lastCandle.low <= bb.lower * 1.003;
        const touchedUpper = lastCandle.high >= bb.upper * 0.997;
        
        if (!touchedLower && !touchedUpper) return null;
        
        const direction = touchedLower ? 'COMPRA' : 'VENDA';
        const timeframeEmoji = timeframe === '1d' ? '📅' : '🕓';
        const timeframeText = timeframe === '1d' ? 'DIÁRIO' : '4 HORAS';
        
        // VERIFICAR REVERSÃO VERDADEIRA
        const reversalCheck = isTrueReversal(candles.slice(-10), bb, touchedLower, touchedUpper);
        
        if (!reversalCheck.isReversal) {
            console.log(`⏭️ ${symbol} [${timeframe}] - tocou na banda mas SEM reversão (score: ${reversalCheck.score}/6)`);
            return null;
        }
        
        const additional = await getAdditionalData(symbol, currentPrice, touchedLower);
        
        // VERIFICAR DIVERGÊNCIA RSI EM MÚLTIPLOS TIMEFRAMES
        const divergenceMulti = checkRSIDivergenceMultiTimeframe(additional.candlesByTimeframe);
        
        // VERIFICAR ESTOCÁSTICO (usar timeframe apropriado)
        const stochValues = timeframe === '1d' ? additional.stochDailyValues : additional.stoch4hValues;
        const stochReversal = checkStochasticReversal(stochValues.k, stochValues.d, touchedLower);
        
        // VERIFICAR VOLUME
        const volumeConfirmation = timeframe === '1d' ? 
            additional.volume1h.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD : 
            additional.volume3m.ratio > CONFIG.REVERSAL.VOLUME_THRESHOLD - 0.2;
        
        // VERIFICAR PENALIDADE LSR
        const lsrPenalty = checkLSRPenalty(additional.lsr, touchedLower);
        
        // CALCULAR PONTUAÇÃO DE CONFIRMAÇÃO
        let confirmationScore = 0;
        let confirmations = [];
        let penaltyApplied = false;
        
        if (reversalCheck.score >= 5) {
            confirmationScore += 3;
            confirmations.push('🔥 Reversão muito forte');
        } else if (reversalCheck.score >= 4) {
            confirmationScore += 2;
            confirmations.push('✅ Reversão forte');
        } else if (reversalCheck.score >= 3) {
            confirmationScore += 1;
            confirmations.push('✓ Reversão moderada');
        }
        
        // ADICIONAR DIVERGÊNCIAS ENCONTRADAS
        if (divergenceMulti.hasDivergence) {
            confirmationScore += divergenceMulti.totalScore;
            
            // Formatar mensagem de divergências
            const divergenceLines = divergenceMulti.divergences.map(d => 
                `${d.emoji} ${d.timeframe} ${d.type === 'bullish' ? 'Alta' : 'Baixa'} (+${d.score})`
            ).join(' • ');
            
            confirmations.push(`📊 Divergências: ${divergenceLines}`);
        }
        
        if (stochReversal) {
            confirmationScore += 1;
            confirmations.push('📊 Estocástico confirmando');
        }
        
        if (volumeConfirmation) {
            confirmationScore += 1;
            confirmations.push('💪 Volume forte');
        }
        
        // APLICAR PENALIDADE LSR SE NECESSÁRIO
        if (lsrPenalty.hasPenalty) {
            confirmationScore += lsrPenalty.points; // -2 pontos
            confirmations.push(lsrPenalty.message);
            penaltyApplied = true;
        }
        
        // SÓ ENVIAR SE TIVER PONTUAÇÃO SUFICIENTE
        if (confirmationScore < 3) {
            console.log(`⏭️ ${symbol} [${timeframe}] - pontuação baixa (${confirmationScore}): ${confirmations.join(', ')}`);
            return null;
        }
        
        if (!canSendAlert(`${symbol}_${timeframe}`, direction, currentPrice)) return null;
        
        const support = touchedLower ? bb.lower * 0.98 : bb.lower;
        const resistance = touchedUpper ? bb.upper * 1.02 : bb.upper;
        
        // Ajustar ATR baseado no timeframe
        const atrMultiplier = timeframe === '1d' ? 1 : 0.5;
        const atr = (bb.upper - bb.lower) * 0.1 * atrMultiplier;
        
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
        
        console.log(`🎯 ${symbol} [${timeframe}] - REVERSÃO CONFIRMADA! Score: ${confirmationScore} | ${confirmations.join(' | ')}`);
        
        return {
            symbol,
            timeframe,
            timeframeEmoji,
            timeframeText,
            direction: touchedLower ? '🟢🔍 Analisar COMPRA' : '🔴🔍 Analisar CORREÇÃO',
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
            confirmationScore,
            confirmations: confirmations.join(' • '),
            reversalScore: reversalCheck.score,
            reversalDetails: reversalCheck.details,
            divergences: divergenceMulti.divergences,
            lsrPenalty: penaltyApplied,
            lsrValue: additional.lsr,
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
    
    let bbLines = '';
    if (data.isGreenAlert) {
        const bbDailyUpper = formatPrice(data.bbDaily.upper);
        const bb4hUpper = formatPrice(data.bb4h.upper);
        const bbWeeklyUpper = formatPrice(data.bbWeekly.upper);
        bbLines = ` Superior Diário : $${bbDailyUpper}\n Superior 4H    : $${bb4hUpper}\n Superior Semanal: $${bbWeeklyUpper}`;
    } else {
        const bbDailyLower = formatPrice(data.bbDaily.lower);
        const bb4hLower = formatPrice(data.bb4h.lower);
        const bbWeeklyLower = formatPrice(data.bbWeekly.lower);
        bbLines = ` Inferior Diário : $${bbDailyLower}\n Inferior 4H    : $${bb4hLower}\n Inferior Semanal: $${bbWeeklyLower}`;
    }
    
    // Formatar linhas de divergência
    let divergenceLines = '';
    if (data.divergences && data.divergences.length > 0) {
        const divergenceTexts = data.divergences.map(d => {
            const type = d.type === 'bullish' ? '📈 Alta' : '📉 Baixa';
            return `${d.timeframe} ${type}`;
        });
        divergenceLines = `\n 🔄 Divergências: ${divergenceTexts.join(' • ')}`;
    }
    
    const confirmationsLine = `🔍 Confirmações: ${data.confirmationScore} | ${data.confirmations}`;
    const reversalScoreLine = `📊 Score Reversão: ${data.reversalScore}/6`;
    
    // Adicionar aviso de LSR se aplicável
    const lsrWarning = data.lsrPenalty ? `\n ⚠️ LSR ${data.lsrValue.toFixed(2)} - Penalidade aplicada` : '';
    
    return `${data.direction} - ${symbolName} ${data.timeframeEmoji} ${data.timeframeText}
 <i>Alerta:${data.dailyCount} | ${time.full}hs
 💲Preço: $${formatPrice(data.price)}
 ${confirmationsLine}
 ${reversalScoreLine}${divergenceLines}${lsrWarning}
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
❅────────────❅
 🤖 IA Dica... <i>${data.isGreenAlert ? 'Observar Zonas de 🔹Suporte de Compra' : 'Realizar Lucro ou Parcial perto da 🔻Resistência.'}</i>
<i>Alerta Educativo, não é recomendação de investimento.</i>
 Titanium Prime by @J4Rviz`;
}

// =====================================================================
// === ENVIAR TELEGRAM ===
// =====================================================================
async function sendTelegramAlert(message) {
    const token = CONFIG.TELEGRAM.BOT_TOKEN;
    const chatId = CONFIG.TELEGRAM.CHAT_ID;
    
    if (!token) {
        console.log('❌ Token do Telegram não configurado');
        return false;
    }
    
    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (!response.ok) {
            const errorData = await response.text();
            console.log(`❌ Erro Telegram: ${response.status} - ${errorData}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.log('❌ Erro ao enviar mensagem Telegram:', error.message);
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
    console.log('📊 Titanium Prime Scanner - REVERSÕES CONFIRMADAS (1D e 4H)');
    console.log('='.repeat(60));
    
    const symbols = await fetchSymbols();
    console.log(`📈 Monitorando ${symbols.length} símbolos`);
    console.log(`⏱️  Scan a cada ${CONFIG.SCAN.INTERVAL_MINUTES} minutos`);
    console.log(`🎯 Score mínimo para reversão: ${CONFIG.REVERSAL.MIN_CONFIRMATION_SCORE}/6`);
    console.log(`📊 Timeframes: 1D (Diário) e 4H (4 Horas)`);
    console.log(`📊 RSI: Período ${CONFIG.RSI.PERIOD} (Wilder Smoothing)`);
    console.log(`📊 Timeframes divergência: ${CONFIG.RSI_DIVERGENCE.TIMEFRAMES.join(', ')}`);
    console.log(`📊 Estocástico Diário: K${CONFIG.STOCHASTIC.DAILY.K_PERIOD}, Smooth${CONFIG.STOCHASTIC.DAILY.K_SMOOTH}, D${CONFIG.STOCHASTIC.DAILY.D_PERIOD}`);
    console.log(`📊 Estocástico 4H: K${CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD}, Smooth${CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH}, D${CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD}`);
    console.log(`⚠️ Penalidade LSR:`);
    console.log(`   - Compra: LSR > ${CONFIG.LSR_PENALTY.BUY_MAX_RATIO} = -${Math.abs(CONFIG.LSR_PENALTY.PENALTY_POINTS)} pontos`);
    console.log(`   - Venda: LSR < ${CONFIG.LSR_PENALTY.SELL_MIN_RATIO} = -${Math.abs(CONFIG.LSR_PENALTY.PENALTY_POINTS)} pontos`);
    
    await sendTelegramAlert(`🤖 Titanium Scanner Ativado!\nMonitorando ${symbols.length} símbolos\nTimeframes: 1D e 4H\nScan a cada ${CONFIG.SCAN.INTERVAL_MINUTES}min\nScore mínimo reversão: ${CONFIG.REVERSAL.MIN_CONFIRMATION_SCORE}/6\nTimeframes divergência: ${CONFIG.RSI_DIVERGENCE.TIMEFRAMES.join(', ')}\nRSI: ${CONFIG.RSI.PERIOD}\nStoch Diário: K5/D3\nStoch 4H: K14/D3\n⚠️ Penalidade LSR: Compra >3.5 (-2) | Venda <1.0 (-2)`);
    
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
                        // Pode ser um array de alerts (1D e 4H) ou null
                        if (Array.isArray(result.value)) {
                            alerts.push(...result.value);
                        } else if (result.value) {
                            alerts.push(result.value);
                        }
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
                    registerAlert(`${alert.symbol}_${alert.timeframe}`, alert.direction, alert.price);
                    sentCount++;
                    const penaltyIcon = alert.lsrPenalty ? '⚠️' : '✅';
                    console.log(`${penaltyIcon} ${alert.direction} ${alert.symbol} [${alert.timeframe}] - Score: ${alert.confirmationScore} | LSR: ${alert.lsr?.toFixed(2) || 'N/A'} | RSI: ${alert.rsi.toFixed(0)}`);
                }
                
                await new Promise(r => setTimeout(r, 2000));
            }
            
            console.log(`📨 Alertas enviados: ${sentCount}/${alerts.length}`);
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
console.log('🚀 Iniciando Titanium Prime Scanner...');
startScanner().catch(console.error);
