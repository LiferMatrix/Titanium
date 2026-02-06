const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { EMA, RSI, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7v';
const TELEGRAM_CHAT_ID = '-1002579';


// === DIRETÓRIOS ===
const LOG_DIR = './logs';

// === CONTADOR DE ALERTAS ===
let alertCounter = {};
let dailyAlerts = 0;
let globalAlerts = 0;
let lastResetDate = null;

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
class AdaptiveRateLimiter {
    constructor() {
        this.minuteWindow = { start: Date.now(), usedWeight: 0 };
        this.secondWindow = { start: Date.now(), usedWeight: 0 };
        this.queue = [];
        this.isProcessing = false;
        this.adaptiveDelay = 100;
        this.minDelay = 50;
        this.maxDelay = 500;
    }

    async makeRequest(url, options = {}, endpointType = 'klines') {
        const weight = 1;
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const request = {
                id: requestId,
                url,
                options,
                weight,
                resolve,
                reject,
                timestamp: Date.now()
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
                const request = this.queue.shift();
                if (!request) {
                    await this.delay(100);
                    continue;
                }

                try {
                    const result = await this.executeRequest(request);
                    request.resolve(result);
                } catch (error) {
                    request.reject(error);
                }

                await this.delay(this.adaptiveDelay);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    async executeRequest(request) {
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
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// === SISTEMA DE LIMPEZA ===
const candleCache = {};
const CANDLE_CACHE_TTL = 90000;
const MAX_CACHE_AGE = 12 * 60 * 1000;

function cleanupCaches() {
    const now = Date.now();
    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });
}

// === FUNÇÕES AUXILIARES ===
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);

    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

    return { date, time, full: `${date} ${time}` };
}

function getBrazilianHour() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.getHours();
}

function getBrazilianDateString() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    return brazilTime.toISOString().split('T')[0]; // YYYY-MM-DD
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
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// === CONTADOR DE ALERTAS COM RESET DIÁRIO ===
function getAlertCountForSymbol(symbol, type) {
    const currentDate = getBrazilianDateString();
    
    // Verificar se precisa resetar (21h de Brasília)
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
    
    // Inicializar contador do símbolo se não existir
    if (!alertCounter[symbol]) {
        alertCounter[symbol] = {
            buy: 0,
            sell: 0,
            total: 0,
            lastAlert: null,
            dailyBuy: 0,
            dailySell: 0,
            dailyTotal: 0
        };
    }
    
    // Atualizar contadores
    alertCounter[symbol][type.toLowerCase()]++;
    alertCounter[symbol].total++;
    alertCounter[symbol][`daily${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`]++;
    alertCounter[symbol].dailyTotal++;
    alertCounter[symbol].lastAlert = Date.now();
    
    dailyAlerts++;
    globalAlerts++;
    
    return {
        symbolTotal: alertCounter[symbol].total,
        symbolBuy: alertCounter[symbol].buy,
        symbolSell: alertCounter[symbol].sell,
        symbolDailyTotal: alertCounter[symbol].dailyTotal,
        symbolDailyBuy: alertCounter[symbol].dailyBuy,
        symbolDailySell: alertCounter[symbol].dailySell,
        globalTotal: globalAlerts,
        dailyTotal: dailyAlerts
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
    
    console.log(`\n🕘 ${getBrazilianDateTime().full} - RESETANDO CONTADORES DIÁRIOS (21h BR)`);
    
    // Resetar contadores diários de todos os símbolos
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyBuy = 0;
        alertCounter[symbol].dailySell = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
    
    dailyAlerts = 0;
    lastResetDate = currentDate;
    
    console.log(`✅ Contadores diários zerados. Global: ${globalAlerts} | Diário: ${dailyAlerts}`);
}

// === MENSAGEM DE INICIALIZAÇÃO ===
async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        
        const message = `
<b>🚀 TITANIUM ATIVADO</b>

📅 ${now.full}

✅ Sistema iniciado com sucesso!
📊 Monitorando Futuros Binance
🎯 Alertas de Compra/Venda ativos
📈 Entradas com retração ajustada
🔄 Contadores zeram às 21h (BR)

<i>✨ Titanium by @J4Rviz</i>
`;

        console.log('📤 Enviando mensagem de inicialização para Telegram...');
        const success = await sendTelegramAlert(message);
        
        if (success) {
            console.log('✅ Mensagem de inicialização enviada com sucesso!');
        } else {
            console.log('⚠️ Não foi possível enviar mensagem de inicialização');
        }
        
        return success;
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem de inicialização:', error.message);
        return false;
    }
}

// === FUNÇÕES DE ANÁLISE TÉCNICA SIMPLIFICADAS ===
async function getCandles(symbol, timeframe, limit = 80) {
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

        const interval = intervalMap[timeframe] || '3m';
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
        console.log(`⚠️ Erro ao buscar candles ${symbol} ${timeframe}: ${error.message}`);
        throw error;
    }
}

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandles(symbol, '3m', 80);
        if (candles.length < 55) {
            return null;
        }

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
            ema13: latestEma13,
            ema34: latestEma34,
            ema55: latestEma55,
            isAboveEMA55: currentPrice > latestEma55,
            isEMA13CrossingUp: previousEma13 <= previousEma34 && latestEma13 > latestEma34,
            isEMA13CrossingDown: previousEma13 >= previousEma34 && latestEma13 < latestEma34,
            priceCloseAboveEMA55: candles[candles.length - 1].close > latestEma55,
            priceCloseBelowEMA55: candles[candles.length - 1].close < latestEma55
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMAs para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 80);
        if (candles.length < 14) {
            return null;
        }

        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        if (!rsiValues || rsiValues.length === 0) {
            return null;
        }

        const latestRSI = rsiValues[rsiValues.length - 1];
        
        return {
            value: latestRSI,
            status: latestRSI < 25 ? 'OVERSOLD' : latestRSI > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular RSI para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getVolume3m(symbol) {
    try {
        const candles = await getCandles(symbol, '3m', 20);
        if (candles.length < 10) {
            return null;
        }

        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const volumeRatio = currentVolume / avgVolume;

        return {
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: volumeRatio,
            isRobust: volumeRatio > 1.2
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular volume para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getVolume1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 20);
        if (candles.length < 10) {
            return null;
        }

        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const volumeRatio = currentVolume / avgVolume;

        return {
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: volumeRatio
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular volume 1h para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const response = await rateLimiter.makeRequest(url, {}, 'klines');
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            return null;
        }
        
        const data = response[0];
        const lsrValue = parseFloat(data.longShortRatio);
        
        return {
            lsrValue: lsrValue,
            longAccount: parseFloat(data.longAccount),
            shortAccount: parseFloat(data.shortAccount)
        };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar LSR para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'fundingRate');

        if (!data || data.length === 0) {
            return null;
        }

        const fundingRate = parseFloat(data[0].fundingRate);
        
        return {
            rate: fundingRate,
            ratePercent: (fundingRate * 100).toFixed(5)
        };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar funding rate para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getATR(symbol) {
    try {
        const candles = await getCandles(symbol, '15m', 28);
        if (candles.length < 14) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14
        });

        if (!atrValues || atrValues.length === 0) {
            return null;
        }

        const latestATR = atrValues[atrValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        const atrPercentage = (latestATR / currentPrice) * 100;

        return {
            value: latestATR,
            percentage: atrPercentage,
            volatility: atrPercentage > 2 ? 'HIGH' : atrPercentage > 1 ? 'MEDIUM' : 'LOW'
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzePivotPoints(symbol, currentPrice, isBullish) {
    try {
        const candles = await getCandles(symbol, '15m', 50);
        if (candles.length < 20) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        // Encontrar suportes e resistências
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        
        // Calcular pivôs tradicionais
        const pivot = (recentHigh + recentLow + candles[candles.length - 1].close) / 3;
        const r1 = (2 * pivot) - recentLow;
        const s1 = (2 * pivot) - recentHigh;
        const r2 = pivot + (recentHigh - recentLow);
        const s2 = pivot - (recentHigh - recentLow);
        
        const resistances = [
            { price: r1, type: 'R1', distancePercent: ((r1 - currentPrice) / currentPrice) * 100 },
            { price: r2, type: 'R2', distancePercent: ((r2 - currentPrice) / currentPrice) * 100 },
            { price: recentHigh, type: 'HIGH', distancePercent: ((recentHigh - currentPrice) / currentPrice) * 100 }
        ].filter(r => r.price > currentPrice)
         .sort((a, b) => a.distancePercent - b.distancePercent);
        
        const supports = [
            { price: s1, type: 'S1', distancePercent: ((currentPrice - s1) / currentPrice) * 100 },
            { price: s2, type: 'S2', distancePercent: ((currentPrice - s2) / currentPrice) * 100 },
            { price: recentLow, type: 'LOW', distancePercent: ((currentPrice - recentLow) / currentPrice) * 100 }
        ].filter(s => s.price < currentPrice)
         .sort((a, b) => a.distancePercent - b.distancePercent);
        
        const nearestResistance = resistances.length > 0 ? resistances[0] : null;
        const nearestSupport = supports.length > 0 ? supports[0] : null;
        
        return {
            pivot: pivot,
            resistances: resistances,
            supports: supports,
            nearestResistance: nearestResistance,
            nearestSupport: nearestSupport,
            nearestPivot: isBullish ? nearestResistance : nearestSupport
        };
    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        return null;
    }
}

function calculateEntryWithRetracement(currentPrice, isBullish, atrData) {
    let stopPercentage = 3.0;
    if (atrData) {
        if (atrData.volatility === 'HIGH') stopPercentage = 4.0;
        else if (atrData.volatility === 'MEDIUM') stopPercentage = 3.5;
        else stopPercentage = 2.5;
    }
    
    // Calcular preço de stop
    const stopPrice = isBullish ?
        currentPrice * (1 - stopPercentage / 100) :
        currentPrice * (1 + stopPercentage / 100);
    
    // Calcular entrada com retração (30% da distância entre preço atual e stop)
    const retracementPercentage = 0.3; // 30% de retração
    const entryPrice = isBullish ?
        currentPrice - (currentPrice - stopPrice) * retracementPercentage :
        currentPrice + (stopPrice - currentPrice) * retracementPercentage;
    
    return {
        originalPrice: currentPrice,
        entryPrice: entryPrice,
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        retracementPercentage: retracementPercentage * 100
    };
}

function calculateTargets(entryPrice, stopPrice, isBullish) {
    const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
    
    const distanceToStop = Math.abs(entryPrice - stopPrice);
    
    const targets = TARGET_PERCENTAGES.map(percent => {
        const targetPrice = isBullish ?
            entryPrice * (1 + percent / 100) :
            entryPrice * (1 - percent / 100);

        const distanceToTarget = Math.abs(targetPrice - entryPrice);
        const riskReward = distanceToTarget / distanceToStop;

        return {
            target: percent.toFixed(1),
            price: targetPrice.toFixed(6),
            riskReward: riskReward.toFixed(2)
        };
    });

    return targets;
}

// === SINAIS DE COMPRA E VENDA ===
async function checkBuySignal(symbol) {
    try {
        const [emaData, rsiData, volume3mData] = await Promise.all([
            getEMAs3m(symbol),
            getRSI1h(symbol),
            getVolume3m(symbol)
        ]);

        if (!emaData || !rsiData || !volume3mData) {
            return null;
        }

        // Condições para COMPRA:
        const isBuySignal = 
            emaData.isEMA13CrossingUp &&
            emaData.priceCloseAboveEMA55 &&
            rsiData.value < 62 &&
            volume3mData.isRobust;

        if (!isBuySignal) {
            return null;
        }

        const [lsrData, fundingData, atrData, pivotData, volume1hData] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            getATR(symbol),
            analyzePivotPoints(symbol, emaData.currentPrice, true),
            getVolume1h(symbol)
        ]);

        // Calcular entrada com retração
        const entryData = calculateEntryWithRetracement(emaData.currentPrice, true, atrData);
        const targets = calculateTargets(entryData.entryPrice, entryData.stopPrice, true);

        return {
            symbol: symbol,
            type: 'COMPRA',
            originalPrice: emaData.currentPrice,
            entryPrice: entryData.entryPrice,
            stopPrice: entryData.stopPrice,
            stopPercentage: entryData.stopPercentage,
            retracementPercentage: entryData.retracementPercentage,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivotData: pivotData,
            targets: targets
        };

    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal de compra para ${symbol}: ${error.message}`);
        return null;
    }
}

async function checkSellSignal(symbol) {
    try {
        const [emaData, rsiData, volume3mData] = await Promise.all([
            getEMAs3m(symbol),
            getRSI1h(symbol),
            getVolume3m(symbol)
        ]);

        if (!emaData || !rsiData || !volume3mData) {
            return null;
        }

        // Condições para VENDA:
        const isSellSignal = 
            emaData.isEMA13CrossingDown &&
            emaData.priceCloseBelowEMA55 &&
            rsiData.value > 35 &&
            volume3mData.isRobust;

        if (!isSellSignal) {
            return null;
        }

        const [lsrData, fundingData, atrData, pivotData, volume1hData] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            getATR(symbol),
            analyzePivotPoints(symbol, emaData.currentPrice, false),
            getVolume1h(symbol)
        ]);

        // Calcular entrada com retração
        const entryData = calculateEntryWithRetracement(emaData.currentPrice, false, atrData);
        const targets = calculateTargets(entryData.entryPrice, entryData.stopPrice, false);

        return {
            symbol: symbol,
            type: 'VENDA',
            originalPrice: emaData.currentPrice,
            entryPrice: entryData.entryPrice,
            stopPrice: entryData.stopPrice,
            stopPercentage: entryData.stopPercentage,
            retracementPercentage: entryData.retracementPercentage,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivotData: pivotData,
            targets: targets
        };

    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal de venda para ${symbol}: ${error.message}`);
        return null;
    }
}

// === MENSAGENS DE ALERTA SIMPLIFICADAS ===
async function sendBuyAlert(signal) {
    const alertCount = getAlertCountForSymbol(signal.symbol, 'buy');
    
    const fundingRate = parseFloat(signal.funding || 0) / 100;
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
    
    const lsrEmoji = signal.lsr < 2.6 ? '🟢' : '🔴';
    
    // Informações de pivot
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 RESISTÊNCIA: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 SUPORTE: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.pivot) {
            pivotInfo += `\n⚖️ PIVÔ: $${signal.pivotData.pivot.toFixed(6)}`;
        }
    }
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🟢 <i>${signal.symbol} - COMPRA</i>

 ${signal.time.full}
 Alerta #${alertCount.symbolTotal} (Compra #${alertCount.symbolBuy})
 Diário: ${alertCount.symbolDailyTotal} alertas
<i> Preços:</i>
• Preço atual: $${signal.originalPrice.toFixed(6)}
• <i>ENTRADA (com retração):</i> $${signal.entryPrice.toFixed(6)}
• Retração: ${signal.retracementPercentage}% do movimento
<i> Indicadores:</i>
• RSI 1h: ${signal.rsi.toFixed(1)} (${signal.rsi < 62 ? '✅' : '❌'})
• Volume 3m: ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr < 2.6 ? '✅' : '❌'}
${fundingRateText}
• ATR: ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})
<i> NÍVEIS IMPORTANTES:</i>${pivotInfo}
<i>💰 Alvos:</i>
${signal.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}
<i>🛑 STOP :</i>
• Preço: $${signal.stopPrice.toFixed(6)}
• Distância: ${signal.stopPercentage}%

<i>✨ Titanium by @J4Rviz (Zera 21h BR)</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de COMPRA enviado: ${signal.symbol} (Alerta #${alertCount.symbolTotal} deste ativo)`);
}

async function sendSellAlert(signal) {
    const alertCount = getAlertCountForSymbol(signal.symbol, 'sell');
    
    const fundingRate = parseFloat(signal.funding || 0) / 100;
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
    
    const lsrEmoji = signal.lsr > 3.0 ? '🔴' : '🟢';
    
    // Informações de pivot
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 SUPORTE: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 RESISTÊNCIA: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.pivot) {
            pivotInfo += `\n⚖️ PIVÔ: $${signal.pivotData.pivot.toFixed(6)}`;
        }
    }
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🔴 <i>${signal.symbol} - VENDA</i>

${signal.time.full}
 Alerta #${alertCount.symbolTotal} (Venda #${alertCount.symbolSell})
 Diário: ${alertCount.symbolDailyTotal} alertas
 <i> Preços:</i>
• Preço atual: $${signal.originalPrice.toFixed(6)}
• <i>ENTRADA (com retração):</i> $${signal.entryPrice.toFixed(6)}
• Retração: ${signal.retracementPercentage}% do movimento
<i> Indicadores:</i>
• RSI 1h: ${signal.rsi.toFixed(1)} (${signal.rsi > 35 ? '✅' : '❌'})
• Volume 3m: ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr > 3.0 ? '✅' : '❌'}
${fundingRateText}
• ATR: ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})
<i> NÍVEIS IMPORTANTES:</i>${pivotInfo}
<i> Alvos:</i>
${signal.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}
<i>🛑 STOP:</i>
• Preço: $${signal.stopPrice.toFixed(6)}
• Distância: ${signal.stopPercentage}%

<i>✨ Titanium by @J4Rviz (Zera 21h BR)</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de VENDA enviado: ${signal.symbol} (Alerta #${alertCount.symbolTotal} deste ativo)`);
}

// === MONITORAMENTO PRINCIPAL ===
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
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function monitorSymbol(symbol) {
    try {
        console.log(`🔍 Analisando ${symbol}...`);
        
        const buySignal = await checkBuySignal(symbol);
        if (buySignal) {
            await sendBuyAlert(buySignal);
            return true;
        }
        
        const sellSignal = await checkSellSignal(symbol);
        if (sellSignal) {
            await sendSellAlert(sellSignal);
            return true;
        }
        
        return false;
    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return false;
    }
}

async function mainBotLoop() {
    try {
        const symbols = await fetchAllFuturesSymbols();
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM ATIVADO');
        console.log('📈 COMPRA: EMA13 ↑ EMA34 + Preço > EMA55 + RSI1h < 62');
        console.log('📉 VENDA: EMA13 ↓ EMA34 + Preço < EMA55 + RSI1h > 35');
        console.log('📊 Volume 3m robusto confirmado');
        console.log('🎯 Entrada com retração de 30% para melhor risco/retorno');
        console.log('💰 Alvos dinâmicos com base no ATR');
        console.log('🔄 Contadores zeram automaticamente às 21h (horário BR)');
        console.log('='.repeat(80) + '\n');

        let cycle = 0;
        while (true) {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
            
            // Verificar se é 21h para resetar contadores
            const currentHour = getBrazilianHour();
            if (currentHour >= 21 && lastResetDate !== getBrazilianDateString()) {
                resetDailyCounters();
            }
            
            let signalsFound = 0;
            
            for (const symbol of symbols) {
                try {
                    const foundSignal = await monitorSymbol(symbol);
                    if (foundSignal) signalsFound++;
                    
                    // Pequena pausa entre símbolos para não sobrecarregar
                    await new Promise(r => setTimeout(r, 200));
                } catch (error) {
                    continue;
                }
            }
            
            console.log(`✅ Ciclo ${cycle} completo. Sinais encontrados: ${signalsFound}`);
            console.log(`📊 Total global: ${globalAlerts} | Total diário: ${dailyAlerts}`);
            console.log(`📈 Ativos monitorados: ${Object.keys(alertCounter).length}`);
            
            // Limpar caches a cada ciclo
            cleanupCaches();
            
            // Pausa entre ciclos
            console.log(`⏳ Próximo ciclo em 30 segundos...\n`);
            await new Promise(r => setTimeout(r, 30000));
        }
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await mainBotLoop();
    }
}

// === INICIALIZAÇÃO ===
let rateLimiter = new AdaptiveRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - SISTEMA DE ALERTAS ATUALIZADO');
        console.log('📊 Contador por ativo ativado');
        console.log('🎯 Pivot points (suporte/resistência) incluídos');
        console.log('📈 Entrada com retração de 30% para melhor risco/retorno');
        console.log('🕘 Reset automático às 21h (horário BR)');
        console.log('='.repeat(80) + '\n');
        
        // Verificar dependências
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }
        
        // Inicializar data do último reset
        lastResetDate = getBrazilianDateString();
        
        // Enviar mensagem de inicialização para Telegram
        await sendInitializationMessage();
        
        console.log('✅ Tudo pronto! Iniciando monitoramento...');
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO NA INICIALIZAÇÃO: ${error.message}`);
        process.exit(1);
    }
}

startBot();
