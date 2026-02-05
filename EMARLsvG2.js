const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { EMA, RSI, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === DIRETÓRIOS ===
const LOG_DIR = './logs';

// === CONTADOR DE ALERTAS ===
let alertCounter = {
    buy: 0,
    sell: 0,
    total: 0,
    lastReset: Date.now()
};

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
        
        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        
        const resistanceLevel = {
            price: recentHigh,
            type: 'RESISTÊNCIA',
            distancePercent: ((recentHigh - currentPrice) / currentPrice) * 100
        };
        
        const supportLevel = {
            price: recentLow,
            type: 'SUPORTE',
            distancePercent: ((currentPrice - recentLow) / currentPrice) * 100
        };
        
        const nearestPivot = isBullish ? resistanceLevel : supportLevel;
        
        return {
            supports: [supportLevel],
            resistances: [resistanceLevel],
            nearestPivot: {
                ...nearestPivot,
                isNear: Math.abs(nearestPivot.distancePercent) < 1
            }
        };
    } catch (error) {
        console.log(`⚠️ Erro análise pivot points ${symbol}: ${error.message}`);
        return null;
    }
}

function calculateTargetsAndStop(price, isBullish, atrData) {
    const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
    
    let stopPercentage = 3.0;
    if (atrData) {
        if (atrData.volatility === 'HIGH') stopPercentage = 4.0;
        else if (atrData.volatility === 'MEDIUM') stopPercentage = 3.5;
        else stopPercentage = 2.5;
    }
    
    const stopPrice = isBullish ?
        price * (1 - stopPercentage / 100) :
        price * (1 + stopPercentage / 100);

    const targets = TARGET_PERCENTAGES.map(percent => {
        const targetPrice = isBullish ?
            price * (1 + percent / 100) :
            price * (1 - percent / 100);

        const distanceToStop = Math.abs(price - stopPrice);
        const distanceToTarget = Math.abs(targetPrice - price);
        const riskReward = distanceToTarget / distanceToStop;

        return {
            target: percent.toFixed(1),
            price: targetPrice.toFixed(6),
            riskReward: riskReward.toFixed(2)
        };
    });

    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage.toFixed(2),
        targets: targets.slice(0, 3) // Mostrar apenas 3 alvos
    };
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
        // 1. EMA 13 cruzando para cima da EMA 34 (3m)
        // 2. Preço fechando acima da EMA 55 (3m)
        // 3. RSI 1h menor que 62
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

        const targetsData = calculateTargetsAndStop(emaData.currentPrice, true, atrData);

        return {
            symbol: symbol,
            type: 'COMPRA',
            price: emaData.currentPrice,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivot: pivotData?.nearestPivot,
            targets: targetsData
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
        // 1. EMA 13 cruzando para baixo da EMA 34 (3m)
        // 2. Preço fechando abaixo da EMA 55 (3m)
        // 3. RSI 1h maior que 35
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

        const targetsData = calculateTargetsAndStop(emaData.currentPrice, false, atrData);

        return {
            symbol: symbol,
            type: 'VENDA',
            price: emaData.currentPrice,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivot: pivotData?.nearestPivot,
            targets: targetsData
        };

    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal de venda para ${symbol}: ${error.message}`);
        return null;
    }
}

// === MENSAGENS DE ALERTA SIMPLIFICADAS ===
async function sendBuyAlert(signal) {
    alertCounter.buy++;
    alertCounter.total++;
    
    const fundingEmoji = signal.funding < 0 ? '🟢' : '🔴';
    const lsrEmoji = signal.lsr < 2.6 ? '🟢' : '🔴';
    const pivotInfo = signal.pivot ? 
        `\n🔹 PIVOT: ${signal.pivot.type} ${signal.pivot.distancePercent?.toFixed(2) || '0.00'}%` : 
        `\n🔹 PIVOT: Não detectado`;
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🟢 <i>${signal.symbol} - COMPRA </i>

 ${signal.time.full}
 Alerta #${alertCounter.total} (Compra #${alertCounter.buy})

 <i>ENTRADA:</i> $${signal.price.toFixed(6)}
 <i>RSI 1h:</i> ${signal.rsi.toFixed(1)} (${signal.rsi < 62 ? '✅' : '❌'})
 <i>Volume 3m:</i> ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} <i>LSR:</i> ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr < 2.6 ? '✅' : '❌'}
${fundingEmoji} <i>Funding:</i> ${signal.funding || '0.00000'}%
 <i>ATR:</i> ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})
${pivotInfo}

<i> ALVOS:</i>
${signal.targets.targets.map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}

<i>🛑 STOP:</i> $${signal.targets.stopPrice.toFixed(6)} (${signal.targets.stopPercentage}%)

<i>✨ Titanium by @J4Rviz</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de COMPRA enviado: ${signal.symbol}`);
}

async function sendSellAlert(signal) {
    alertCounter.sell++;
    alertCounter.total++;
    
    const fundingEmoji = signal.funding > 0 ? '🔴' : '🟢';
    const lsrEmoji = signal.lsr > 3.0 ? '🔴' : '🟢';
    const pivotInfo = signal.pivot ? 
        `\n🔹 PIVOT: ${signal.pivot.type} ${signal.pivot.distancePercent?.toFixed(2) || '0.00'}%` : 
        `\n🔹 PIVOT: Não detectado`;
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🔴 <i>${signal.symbol} - VENDA</i>

 ${signal.time.full}
 Alerta #${alertCounter.total} (Venda #${alertCounter.sell})

 <i>ENTRADA:</i> $${signal.price.toFixed(6)}
 <i>RSI 1h:</i> ${signal.rsi.toFixed(1)} (${signal.rsi > 35 ? '✅' : '❌'})
 <i>Volume 3m:</i> ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} <i>LSR:</i> ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr > 3.0 ? '✅' : '❌'}
${fundingEmoji} <i>Funding:</i> ${signal.funding || '0.00000'}%
 <i>ATR:</i> ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})
${pivotInfo}

<i> ALVOS:</i>
${signal.targets.targets.map(target => `• ${target.target}%: $${target.price} (RR:${target.riskReward}x)`).join('\n')}

<i>🛑 STOP:</i> $${signal.targets.stopPrice.toFixed(6)} (${signal.targets.stopPercentage}%)

<i>✨ Titanium by @J4Rviz</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de VENDA enviado: ${signal.symbol}`);
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
        
        console.log('\n' + '='.repeat(60));
        console.log('🚀 TITANIUM ATIVADO');
        console.log(`📋 ${symbols.length} ativos `);
        console.log('='.repeat(60) + '\n');

        let cycle = 0;
        while (true) {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
            
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
            console.log(`📊 Estatísticas: Total: ${alertCounter.total} | Compras: ${alertCounter.buy} | Vendas: ${alertCounter.sell}`);
            
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
        console.log('🚀 TITANIUM - SISTEMA DE ALERTAS');
        console.log('📈 COMPRA: EMA13 ↑ EMA34 + Preço > EMA55 + RSI1h < 62');
        console.log('📉 VENDA: EMA13 ↓ EMA34 + Preço < EMA55 + RSI1h > 35');
        console.log('📊 Volume 3m robusto confirmado');
        console.log('💰 Alvos dinâmicos com ATR por volatilidade');
        console.log('='.repeat(80) + '\n');
        
        // Verificar dependências
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }
        
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
