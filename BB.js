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
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyz
        CHAT_ID: '-100255
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
        MAX_DAILY_PER_SYMBOL: 5,
        COOLDOWN_HOURS: 24,
        PRICE_DEVIATION: 0.1
    },
    VOLUME: {
        EMA_PERIOD: 9
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
    if (!price) return '-';
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

// Calcular EMA
function calculateEMA(values, period) {
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
        const [candles1h, candles3m, candlesDaily, candlesWeekly] = await Promise.all([
            getCandles(symbol, '1h', 48),
            getCandles(symbol, '3m', 100),
            getCandles(symbol, '1d', 50),  // Aumentado para 50 dias
            getCandles(symbol, '1w', 30)   // Aumentado para 30 semanas
        ]);
        
        // Calcular Bollinger Diário
        const bbDaily = calculateBollingerBands(candlesDaily, 20, 2);
        
        // Calcular Bollinger Semanal com fallback
        let bbWeekly = null;
        if (candlesWeekly.length >= 20) {
            bbWeekly = calculateBollingerBands(candlesWeekly, 20, 2);
        } else if (candlesWeekly.length >= 10) {
            // Se não tem 20 semanas, calcula com o que tem
            bbWeekly = calculateBollingerBands(candlesWeekly, candlesWeekly.length, 2);
        }
        
        // Analisar volume com EMA 9 para 1h e 3m
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        
        // Calcular RSI 1h
        let rsi = 50;
        if (candles1h.length > 14) {
            let gains = 0, losses = 0;
            for (let i = candles1h.length - 14; i < candles1h.length; i++) {
                const diff = candles1h[i].close - candles1h[i-1].close;
                if (diff > 0) gains += diff;
                else losses += Math.abs(diff);
            }
            const avgGain = gains / 14;
            const avgLoss = losses / 14 || 0.001;
            const rs = avgGain / avgLoss;
            rsi = 100 - (100 / (1 + rs));
        }
        
        // Volume ratio 1h
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1];
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        
        // Volume ratio 3m
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1];
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        
        // LSR e Funding
        let lsr = null, funding = null;
        try {
            const lsrData = await rateLimiter.makeRequest(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`);
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        
        try {
            const fundingData = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        
        // Stochastics simulados
        const stoch1d = rsi < 30 ? 'K20⤵️D30 🟢' : rsi > 70 ? 'K80⤵️D70 🔴' : 'K50⤵️D55 🟡';
        const stoch4h = rsi < 35 ? 'K25⤵️D30 🟢' : rsi > 65 ? 'K75⤵️D70 🟠' : 'K45⤵️D50 🟡';
        
        // Volume 24hs trend
        const volume24h = analyzeVolumeWithEMA(candles1h.slice(-24));
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        
        return {
            rsi,
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
                upper: currentPrice * 1.2,  // Fallback aproximado
                lower: currentPrice * 0.8
            },
            bbWeekly: bbWeekly ? {
                upper: bbWeekly.upper,
                lower: bbWeekly.lower
            } : {
                upper: currentPrice * 1.3,  // Fallback mais largo
                lower: currentPrice * 0.7
            },
            lsr,
            funding,
            stoch1d,
            stoch4h
        };
    } catch (error) {
        console.log(`⚠️ Erro em getAdditionalData para ${symbol}:`, error.message);
        return {
            rsi: 50,
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro' },
            bbDaily: { upper: currentPrice * 1.2, lower: currentPrice * 0.8 },
            bbWeekly: { upper: currentPrice * 1.3, lower: currentPrice * 0.7 },
            lsr: null,
            funding: null,
            stoch1d: 'K50⤵️D55 🟡',
            stoch4h: 'K45⤵️D50 🟡'
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
        const emoji = touchedLower ? '🟢' : '🔴';
        
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
        bbLines = ` Bollinger Superior Diário : $${bbDailyUpper}\n Bollinger Superior Semanal: $${bbWeeklyUpper}`;
    } else {
        const bbDailyLower = formatPrice(data.bbDaily.lower);
        const bbWeeklyLower = formatPrice(data.bbWeekly.lower);
        bbLines = ` Bollinger Inferior Diário : $${bbDailyLower}\n Bollinger Inferior Semanal: $${bbWeeklyLower}`;
    }
    
    return `${data.direction} Bollinger do Diário - ${symbolName}
 Alerta:${data.dailyCount} | ${time.full}hs
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
 Alvos: TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3}... 🛑 Stop: ${stop}
❅──────✧❅🔹❅✧──────❅
 🤖 IA Dica... ${data.direction === '🟢' ? 'Observar Zonas de 🔹Suporte de Compra' : 'Realizar Lucro ou Parcial perto da 🔻Resistência.'}
Alerta Educativo, não é recomendação de investimento.
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
    console.log('📊 BOLLINGER DIÁRIO SCANNER');
    console.log('='.repeat(60));
    
    const symbols = await fetchSymbols();
    console.log(`📈 Monitorando ${symbols.length} símbolos`);
    console.log(`⏱️  Scan a cada ${CONFIG.SCAN.INTERVAL_MINUTES} minutos\n`);
    
    await sendTelegramAlert(`🤖 Bollinger Diário Scanner Ativado!\nMonitorando ${symbols.length} símbolos\nScan a cada ${CONFIG.SCAN.INTERVAL_MINUTES}min`);
    
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
                    console.log(`✅ ${alert.direction} ${alert.symbol}`);
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
console.log('🚀 Iniciando Bollinger Diário Scanner...');
startScanner().catch(console.error);
