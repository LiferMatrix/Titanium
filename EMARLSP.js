const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { Stochastic, EMA, RSI, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const marketDataCache = {};
const orderBookCache = {};
const lsrCache = {};
const fundingCache = {};
const CANDLE_CACHE_TTL = 45000;
const MARKET_DATA_CACHE_TTL = 30000;
const ORDERBOOK_CACHE_TTL = 20000;
const LSR_CACHE_TTL = 30000;
const FUNDING_CACHE_TTL = 30000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

// === CONFIGURAÇÕES PARA DETECÇÃO DE ZONAS ===
const ZONE_SETTINGS = {
    timeframe: '15m',
    lookbackPeriod: 100,
    proximityThreshold: 0.3,
    checkInterval: 30000,
    bidAskZoneSize: 0.25,
    requiredConfirmations: 2,
    maxConcurrentRequests: 3,
    requestTimeout: 15000,
    retryAttempts: 2,
    minBidAskVolume: 0.5,
    supportResistanceLookback: 50
};

// === CONFIGURAÇÕES PARA STOCHASTIC ===
const STOCHASTIC_12H_SETTINGS = {
    period: 5,
    smooth: 3,
    signalPeriod: 3,
    timeframe: '12h',
    requiredCandles: 20
};

const STOCHASTIC_DAILY_SETTINGS = {
    period: 5,
    smooth: 3,
    signalPeriod: 3,
    timeframe: '1d',
    requiredCandles: 30
};

// === CONFIGURAÇÕES PARA BTC RELATIVE STRENGTH ===
const BTC_STRENGTH_SETTINGS = {
    btcSymbol: 'BTCUSDT',
    timeframe: '1h',
    lookbackPeriod: 50,
    strengthWeights: {
        priceChange: 0.5,
        volumeRatio: 0.3,
        dominance: 0.2
    },
    threshold: {
        strongBuy: 70,
        moderateBuy: 60,
        neutral: 40,
        moderateSell: 30,
        strongSell: 20
    }
};

// =====================================================================
// 🆕 CONFIGURAÇÕES PARA EMA 3 MINUTOS COM SUPORTE/RESISTÊNCIA ===
// =====================================================================

const EMA_ZONE_SETTINGS = {
    ema13Period: 13,
    ema34Period: 34,
    ema55Period: 55,
    timeframe: '3m',
    requiredCandles: 100,
    checkInterval: 30000,
    alertCooldown: 5 * 60 * 1000,
    alertGroups: 6,
    // Configurações para zona de suporte/resistência
    zoneProximity: 0.5, // 0.5% de proximidade da zona
    zoneTimeframe: '15m', // Timeframe para detectar zonas
    minZoneStrength: 1, // Força mínima da zona
    requireZoneConfirmation: true // Requer confirmação de zona
};

// =====================================================================
// 🔄 CIRCUIT BREAKER CLASS
// =====================================================================

class CircuitBreaker {
    constructor() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.resetTimeout = 120000;
        this.failureThreshold = 5;
        this.halfOpenMaxRequests = 2;
        this.consecutive429s = 0;
        this.last429Time = null;
    }

    canExecute() {
        const now = Date.now();

        if (this.consecutive429s >= 3 && this.last429Time && (now - this.last429Time) < 60000) {
            return false;
        }

        switch (this.state) {
            case 'CLOSED':
                return true;
            case 'OPEN':
                if (this.lastFailureTime && (now - this.lastFailureTime) >= this.resetTimeout) {
                    this.state = 'HALF_OPEN';
                    this.successCount = 0;
                    return true;
                }
                return false;
            case 'HALF_OPEN':
                if (this.successCount >= this.halfOpenMaxRequests) {
                    this.state = 'CLOSED';
                    this.failureCount = 0;
                    this.consecutive429s = 0;
                }
                return this.successCount < this.halfOpenMaxRequests;
            default:
                return false;
        }
    }

    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
        } else if (this.state === 'CLOSED') {
            this.failureCount = Math.max(0, this.failureCount - 1);
        }
        this.consecutive429s = 0;
    }

    recordFailure(error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (error.message && error.message.includes('429')) {
            this.consecutive429s++;
            this.last429Time = Date.now();
        } else {
            this.consecutive429s = 0;
        }

        if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        } else if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
        }
    }

    getStatus() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            consecutive429s: this.consecutive429s,
            lastFailureTime: this.lastFailureTime,
            canExecute: this.canExecute()
        };
    }
}

// =====================================================================
// 🚀 RATE LIMITER COM DELAY ADAPTATIVO
// =====================================================================

class AdaptiveRateLimiter {
    constructor() {
        this.minuteWindow = { start: Date.now(), usedWeight: 0 };
        this.secondWindow = { start: Date.now(), usedWeight: 0 };
        this.dailyWindow = { start: Date.now(), usedWeight: 0 };

        this.circuitBreaker = new CircuitBreaker();
        this.queue = [];
        this.isProcessing = false;
        this.lastStatusLog = Date.now();
        this.totalRequests = 0;
        this.failedRequests = 0;

        this.adaptiveDelay = 200;
        this.minDelay = 100;
        this.maxDelay = 2000;
        this.usageThreshold = 0.6;

        this.endpointWeights = {
            'klines': 1,
            'depth': 2,
            'ticker': 1,
            'exchangeInfo': 5,
            'globalLongShort': 1,
            'fundingRate': 1
        };

        console.log('🚀 Rate Limiter Adaptativo inicializado');
    }

    async makeRequest(url, options = {}, endpointType = 'klines') {
        const weight = this.endpointWeights[endpointType] || 1;
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const request = {
                id: requestId,
                url,
                options,
                weight,
                endpointType,
                resolve,
                reject,
                timestamp: Date.now(),
                retryCount: 0,
                timeout: ZONE_SETTINGS.requestTimeout
            };

            this.queue.push(request);
            this.totalRequests++;

            if (!this.isProcessing) {
                this.processQueue();
            }

            setTimeout(() => {
                const index = this.queue.findIndex(req => req.id === requestId);
                if (index !== -1) {
                    this.queue.splice(index, 1);
                    this.failedRequests++;
                    reject(new Error(`Request timeout: ${url}`));
                }
            }, request.timeout);
        });
    }

    async processQueue() {
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(5000);
                    continue;
                }

                if (this.getConcurrentRequests() >= ZONE_SETTINGS.maxConcurrentRequests) {
                    await this.delay(this.adaptiveDelay * 2);
                    continue;
                }

                const request = this.queue.shift();
                if (!request) {
                    await this.delay(100);
                    continue;
                }

                if (!this.checkLimits(request.weight)) {
                    this.queue.unshift(request);
                    await this.waitForLimits(request.weight);
                    continue;
                }

                try {
                    const result = await this.executeRequest(request);
                    request.resolve(result);
                    this.circuitBreaker.recordSuccess();
                    this.adjustDelay(true);

                } catch (error) {
                    request.reject(error);
                    this.circuitBreaker.recordFailure(error);
                    this.failedRequests++;

                    if (error.message && error.message.includes('429')) {
                        this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 2);
                        await this.delay(30000);
                    } else if (request.retryCount < ZONE_SETTINGS.retryAttempts) {
                        request.retryCount++;
                        this.queue.unshift(request);
                        await this.delay(2000 * request.retryCount);
                    }
                }

                await this.delay(this.adaptiveDelay);
            }
        } finally {
            this.isProcessing = false;
        }

        if (Date.now() - this.lastStatusLog >= 60000) {
            this.logStatus();
            this.lastStatusLog = Date.now();
        }
    }

    getConcurrentRequests() {
        return Math.floor(this.queue.length / 10) + 1;
    }

    checkLimits(weight) {
        const now = Date.now();

        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.dailyWindow.start >= 86400000) {
            this.dailyWindow = { start: now, usedWeight: 0 };
        }

        const minuteUsage = this.minuteWindow.usedWeight / 1200;
        const secondUsage = this.secondWindow.usedWeight / 30;
        const dailyUsage = this.dailyWindow.usedWeight / 100000;

        return minuteUsage < 0.8 && secondUsage < 0.7 && dailyUsage < 0.9;
    }

    adjustDelay(success) {
        const minuteUsage = this.minuteWindow.usedWeight / 1200;

        if (!success || minuteUsage > this.usageThreshold) {
            this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.2);
        } else if (minuteUsage < this.usageThreshold * 0.3) {
            this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.8);
        }
    }

    async waitForLimits(weight) {
        const now = Date.now();
        const minuteRemaining = 60000 - (now - this.minuteWindow.start);
        const secondRemaining = 1000 - (now - this.secondWindow.start);

        const minuteUsage = this.minuteWindow.usedWeight / 1200;
        const secondUsage = this.secondWindow.usedWeight / 30;

        if (minuteUsage > 0.8) {
            const waitTime = minuteRemaining + 1000;
            await this.delay(waitTime);
        } else if (secondUsage > 0.7) {
            const waitTime = secondRemaining + 500;
            await this.delay(waitTime);
        } else {
            await this.delay(this.adaptiveDelay * 3);
        }
    }

    async executeRequest(request) {
        for (let attempt = 0; attempt <= request.retryCount + 1; attempt++) {
            try {
                if (attempt > 0) {
                    await this.delay(3000 * Math.pow(1.5, attempt - 1));
                }

                this.updateCounters(request.weight);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), request.timeout);

                const response = await fetch(request.url, {
                    ...request.options,
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0'
                    }
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
                }

                const data = await response.json();
                
                if (data.code && data.code !== 200) {
                    throw new Error(`API Error ${data.code}: ${data.msg || 'Unknown error'}`);
                }

                return data;

            } catch (error) {
                if (attempt === (request.retryCount + 1)) {
                    throw error;
                }
                
                if (error.name === 'AbortError') {
                    request.timeout = Math.min(45000, request.timeout * 1.5);
                }
            }
        }
    }

    updateCounters(weight) {
        const now = Date.now();

        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }

        if (now - this.dailyWindow.start >= 86400000) {
            this.dailyWindow = { start: now, usedWeight: 0 };
        }

        this.minuteWindow.usedWeight += weight;
        this.secondWindow.usedWeight += weight;
        this.dailyWindow.usedWeight += weight;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logStatus() {
        const minuteUsage = (this.minuteWindow.usedWeight / 1200 * 100).toFixed(1);
        const secondUsage = (this.secondWindow.usedWeight / 30 * 100).toFixed(1);
        const successRate = this.totalRequests > 0 ? 
            ((this.totalRequests - this.failedRequests) / this.totalRequests * 100).toFixed(1) : 100;

        console.log(`📊 Rate Limit: ${minuteUsage}% min | ${secondUsage}% seg | Delay: ${this.adaptiveDelay}ms | Sucesso: ${successRate}%`);
    }
}

// =====================================================================
// 📊 FUNÇÕES AUXILIARES
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

function getBrazilianDateTimeFromTimestamp(timestamp) {
    const date = new Date(timestamp);
    const offset = -3;
    const brazilTime = new Date(date.getTime() + offset * 60 * 60 * 1000);

    const dateStr = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const timeStr = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

    return { date: dateStr, time: timeStr, full: `${dateStr} ${timeStr}` };
}

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
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
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }

        console.log('✅ Mensagem enviada para Telegram');
        logToFile(`📤 Alerta enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA OBTER DADOS DO MERCADO
// =====================================================================

let rateLimiter = new AdaptiveRateLimiter();

async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando símbolos disponíveis...');
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );

        const symbols = data.symbols
            .filter(s => {
                if (!s.symbol.endsWith('USDT')) return false;
                if (s.status !== 'TRADING') return false;
                
                const excluded = ['BULL', 'BEAR', 'UP', 'DOWN', 'EUR', 'GBP', 'JPY', 'AUD', 'BRL'];
                if (excluded.some(term => s.symbol.includes(term))) return false;
                
                return true;
            })
            .slice(0, 40)
            .map(s => s.symbol);

        console.log(`✅ ${symbols.length} pares USDT selecionados`);
        return symbols;

    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 
                'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT', 'AVAXUSDT', 'LINKUSDT'];
    }
}

async function getCandlesCached(symbol, timeframe, limit = 80) {
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

        const interval = intervalMap[timeframe] || '15m';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 100)}`;

        const data = await rateLimiter.makeRequest(url, {}, 'klines');

        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            quoteVolume: parseFloat(candle[7]),
            trades: parseFloat(candle[8]),
            time: candle[0]
        }));

        candleCache[cacheKey] = { data: candles, timestamp: now };
        return candles;
    } catch (error) {
        console.log(`⚠️ Erro candles ${symbol}: ${error.message}`);
        return [];
    }
}

async function getOrderBook(symbol, limit = 100) {
    try {
        const cacheKey = `orderbook_${symbol}_${limit}`;
        const now = Date.now();

        if (orderBookCache[cacheKey] && now - orderBookCache[cacheKey].timestamp < ORDERBOOK_CACHE_TTL) {
            return orderBookCache[cacheKey].data;
        }

        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${Math.min(limit, 100)}`;

        const data = await rateLimiter.makeRequest(url, {}, 'depth');

        const orderBook = {
            bids: data.bids.map(bid => ({ price: parseFloat(bid[0]), quantity: parseFloat(bid[1]) })),
            asks: data.asks.map(ask => ({ price: parseFloat(ask[0]), quantity: parseFloat(ask[1]) }))
        };

        orderBookCache[cacheKey] = { data: orderBook, timestamp: now };
        return orderBook;
    } catch (error) {
        console.log(`⚠️ Erro orderbook ${symbol}: ${error.message}`);
        return null;
    }
}

async function getMarketData(symbol) {
    try {
        const cacheKey = `market_${symbol}`;
        const now = Date.now();

        if (marketDataCache[cacheKey] && now - marketDataCache[cacheKey].timestamp < MARKET_DATA_CACHE_TTL) {
            return marketDataCache[cacheKey].data;
        }

        const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;

        const data = await rateLimiter.makeRequest(url, {}, 'ticker');

        const marketData = {
            priceChange: parseFloat(data.priceChange),
            priceChangePercent: parseFloat(data.priceChangePercent),
            weightedAvgPrice: parseFloat(data.weightedAvgPrice),
            lastPrice: parseFloat(data.lastPrice),
            volume: parseFloat(data.volume),
            quoteVolume: parseFloat(data.quoteVolume),
            highPrice: parseFloat(data.highPrice),
            lowPrice: parseFloat(data.lowPrice),
            openPrice: parseFloat(data.openPrice),
            prevClosePrice: parseFloat(data.prevClosePrice)
        };

        marketDataCache[cacheKey] = { data: marketData, timestamp: now };
        return marketData;
    } catch (error) {
        console.log(`⚠️ Erro market data ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA LSR E FUNDING RATE (DO ORIGINAL)
// =====================================================================

async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        if (lsrCache[cacheKey] && now - lsrCache[cacheKey].timestamp < LSR_CACHE_TTL) {
            return lsrCache[cacheKey].data;
        }
        
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const response = await rateLimiter.makeRequest(url, {}, 'globalLongShort');
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            console.log(`⚠️ Resposta da API LSR vazia para ${symbol}.`);
            return null;
        }
        
        const latestData = response[0];
        
        if (!latestData.longShortRatio || !latestData.longAccount || !latestData.shortAccount) {
            console.log(`⚠️ Estrutura de dados LSR inesperada para ${symbol}:`, latestData);
            return null;
        }
        
        const currentLSR = parseFloat(latestData.longShortRatio);
        
        let percentChange = '0.00';
        let isRising = false;
        
        if (response.length >= 2) {
            const previousData = response[1];
            const previousLSR = parseFloat(previousData.longShortRatio);
            
            if (previousLSR !== 0) {
                percentChange = ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2);
                isRising = currentLSR > previousLSR;
            }
        }
        
        const result = {
            lsrValue: currentLSR,
            longAccount: parseFloat(latestData.longAccount),
            shortAccount: parseFloat(latestData.shortAccount),
            percentChange: percentChange,
            isRising: isRising,
            timestamp: latestData.timestamp,
            raw: latestData
        };
        
        lsrCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Binance LSR ${symbol} (${period}): ${result.lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar LSR da Binance para ${symbol}:`, error.message);
        return null;
    }
}

async function checkFundingRate(symbol) {
    try {
        const cacheKey = `funding_${symbol}`;
        const now = Date.now();
        
        if (fundingCache[cacheKey] && now - fundingCache[cacheKey].timestamp < FUNDING_CACHE_TTL) {
            return fundingCache[cacheKey].data;
        }

        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`,
            {},
            'fundingRate'
        );

        if (!data || data.length === 0) {
            return { 
                raw: 0
            };
        }

        const fundingRate = parseFloat(data[0].fundingRate);
        
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
            : 'Indisponível';
        
        const result = {
            raw: fundingRate,
            emoji: fundingRateEmoji,
            text: fundingRateText,
            percentage: (fundingRate * 100).toFixed(5)
        };
        
        fundingCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
    } catch (error) {
        console.log(`⚠️ Erro funding rate ${symbol}: ${error.message}`);
        return { 
            raw: 0,
            emoji: '⚪',
            text: 'Indisponível',
            percentage: '0.00000'
        };
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA ANÁLISE TÉCNICA
// =====================================================================

async function getSupportResistanceLevels(symbol, timeframe = '15m') {
    try {
        const candles = await getCandlesCached(symbol, timeframe, ZONE_SETTINGS.supportResistanceLookback);
        if (candles.length < 20) return [];

        const levels = [];
        const sensitivity = 3;

        for (let i = sensitivity; i < candles.length - sensitivity; i++) {
            const currentHigh = candles[i].high;
            const currentLow = candles[i].low;
            
            let isLocalHigh = true;
            let isLocalLow = true;
            
            for (let j = i - sensitivity; j <= i + sensitivity; j++) {
                if (j !== i) {
                    if (candles[j].high > currentHigh) isLocalHigh = false;
                    if (candles[j].low < currentLow) isLocalLow = false;
                }
            }
            
            if (isLocalHigh) {
                levels.push({
                    price: currentHigh,
                    type: 'RESISTANCE',
                    strength: 1,
                    volume: candles[i].volume,
                    time: candles[i].time
                });
            }
            
            if (isLocalLow) {
                levels.push({
                    price: currentLow,
                    type: 'SUPPORT',
                    strength: 1,
                    volume: candles[i].volume,
                    time: candles[i].time
                });
            }
        }

        const groupedLevels = [];
        const priceTolerance = 0.001;

        levels.forEach(level => {
            const existingGroup = groupedLevels.find(group => 
                Math.abs(group.price - level.price) / group.price < priceTolerance
            );
            
            if (existingGroup) {
                existingGroup.count++;
                existingGroup.strength += level.strength;
                existingGroup.volume += level.volume;
                existingGroup.price = (existingGroup.price + level.price) / 2;
            } else {
                groupedLevels.push({
                    price: level.price,
                    type: level.type,
                    strength: level.strength,
                    volume: level.volume,
                    count: 1
                });
            }
        });

        return groupedLevels
            .filter(level => level.count >= 2)
            .sort((a, b) => (b.strength * b.volume) - (a.strength * a.volume))
            .slice(0, 5);

    } catch (error) {
        console.log(`⚠️ Erro S/R ${symbol}: ${error.message}`);
        return [];
    }
}

async function getRSI(symbol, timeframe = '1h', period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 10);
        if (candles.length < period + 10) return null;

        const closes = candles.map(c => c.close);
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i <= period; i++) {
            const difference = closes[i] - closes[i-1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        let status = 'NEUTRAL';
        let emoji = '⚪';
        
        if (rsi < 30) {
            status = 'OVERSOLD';
            emoji = '🟢';
        } else if (rsi < 40) {
            status = 'COMPRA';
            emoji = '🟢';
        } else if (rsi > 70) {
            status = 'OVERBOUGHT';
            emoji = '🔴';
        } else if (rsi > 60) {
            status = 'VENDA';
            emoji = '🔴';
        }
        
        return {
            value: rsi,
            status: status,
            emoji: emoji
        };
    } catch (error) {
        console.log(`⚠️ Erro RSI ${symbol}: ${error.message}`);
        return null;
    }
}

async function getStochastic(symbol, timeframe = '12h') {
    try {
        const candles = await getCandlesCached(symbol, timeframe, 20);
        if (candles.length < 14) return null;

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const period = 14;
        const smooth = 3;
        
        let kValues = [];
        
        for (let i = period - 1; i < closes.length; i++) {
            const periodHigh = Math.max(...highs.slice(i - period + 1, i + 1));
            const periodLow = Math.min(...lows.slice(i - period + 1, i + 1));
            
            if (periodHigh === periodLow) {
                kValues.push(50);
            } else {
                const k = ((closes[i] - periodLow) / (periodHigh - periodLow)) * 100;
                kValues.push(k);
            }
        }
        
        let smoothedK = [];
        for (let i = smooth - 1; i < kValues.length; i++) {
            const avg = kValues.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b, 0) / smooth;
            smoothedK.push(avg);
        }
        
        const signalPeriod = 3;
        let dValues = [];
        for (let i = signalPeriod - 1; i < smoothedK.length; i++) {
            const avg = smoothedK.slice(i - signalPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / signalPeriod;
            dValues.push(avg);
        }
        
        if (smoothedK.length === 0 || dValues.length === 0) return null;
        
        const currentK = smoothedK[smoothedK.length - 1];
        const currentD = dValues[dValues.length - 1];
        
        let zone = 'NEUTRAL';
        if (currentK < 20 && currentD < 20) zone = 'OVERSOLD';
        else if (currentK > 80 && currentD > 80) zone = 'OVERBOUGHT';
        
        return {
            k: currentK,
            d: currentD,
            zone: zone,
            isBullish: currentK > currentD,
            isBearish: currentK < currentD
        };
    } catch (error) {
        console.log(`⚠️ Erro Stochastic ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR EMA 13, 34, 55 NO TIMEFRAME 3 MINUTOS
// =====================================================================

async function checkEMA3133455(symbol) {
    try {
        const candles = await getCandlesCached(symbol, EMA_ZONE_SETTINGS.timeframe, EMA_ZONE_SETTINGS.requiredCandles);
        
        if (candles.length < EMA_ZONE_SETTINGS.requiredCandles) {
            console.log(`⚠️ Dados insuficientes para EMA ${symbol} no timeframe ${EMA_ZONE_SETTINGS.timeframe}`);
            return null;
        }

        // Extrair preços de fechamento
        const closes = candles.map(c => c.close);
        
        // Calcular EMA 13, 34, 55
        const ema13Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema13Period,
            values: closes
        });
        
        const ema34Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema34Period,
            values: closes
        });
        
        const ema55Values = EMA.calculate({
            period: EMA_ZONE_SETTINGS.ema55Period,
            values: closes
        });
        
        if (ema13Values.length < 3 || ema34Values.length < 3 || ema55Values.length < 3) {
            return null;
        }
        
        // Obter os últimos valores
        const currentEma13 = ema13Values[ema13Values.length - 1];
        const currentEma34 = ema34Values[ema34Values.length - 1];
        const currentEma55 = ema55Values[ema55Values.length - 1];
        
        const previousEma13 = ema13Values[ema13Values.length - 2];
        const previousEma34 = ema34Values[ema34Values.length - 2];
        
        // Verificar cruzamento de EMA 13 com EMA 34
        const ema13AboveEma34 = currentEma13 > currentEma34;
        const previousEma13AboveEma34 = previousEma13 > previousEma34;
        
        const ema13BelowEma34 = currentEma13 < currentEma34;
        const previousEma13BelowEma34 = previousEma13 < previousEma34;
        
        // Preço atual (último fechamento)
        const currentPrice = closes[closes.length - 1];
        
        // Verificar posição do preço em relação à EMA 55
        const priceAboveEma55 = currentPrice > currentEma55;
        const priceBelowEma55 = currentPrice < currentEma55;
        
        // Detectar cruzamentos
        let crossoverSignal = null;
        
        // COMPRA: EMA 13 cruza para CIMA da EMA 34 E preço fecha ACIMA da EMA 55
        if (ema13AboveEma34 && !previousEma13AboveEma34 && priceAboveEma55) {
            crossoverSignal = {
                type: 'COMPRA',
                message: `EMA 13 (${currentEma13.toFixed(6)}) cruzou para CIMA da EMA 34 (${currentEma34.toFixed(6)}) e preço (${currentPrice.toFixed(6)}) está ACIMA da EMA 55 (${currentEma55.toFixed(6)})`,
                ema13: currentEma13,
                ema34: currentEma34,
                ema55: currentEma55,
                price: currentPrice,
                time: candles[candles.length - 1].time
            };
        }
        // VENDA: EMA 13 cruza para BAIXO da EMA 34 E preço fecha ABAIXO da EMA 55
        else if (ema13BelowEma34 && !previousEma13BelowEma34 && priceBelowEma55) {
            crossoverSignal = {
                type: 'VENDA',
                message: `EMA 13 (${currentEma13.toFixed(6)}) cruzou para BAIXO da EMA 34 (${currentEma34.toFixed(6)}) e preço (${currentPrice.toFixed(6)}) está ABAIXO da EMA 55 (${currentEma55.toFixed(6)})`,
                ema13: currentEma13,
                ema34: currentEma34,
                ema55: currentEma55,
                price: currentPrice,
                time: candles[candles.length - 1].time
            };
        }
        
        return {
            ema13: currentEma13,
            ema34: currentEma34,
            ema55: currentEma55,
            price: currentPrice,
            priceAboveEma55: priceAboveEma55,
            priceBelowEma55: priceBelowEma55,
            ema13AboveEma34: ema13AboveEma34,
            ema13BelowEma34: ema13BelowEma34,
            crossover: crossoverSignal,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMA para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR SUPORTE/RESISTÊNCIA E DEPOIS EMA
// =====================================================================

async function checkZoneThenEMA(symbol) {
    try {
        console.log(`🔍 Analisando ${symbol}: Verificando zonas primeiro...`);
        
        // 1. PRIMEIRO: Verificar se está perto de suporte/resistência
        const zones = await getSupportResistanceLevels(symbol, EMA_ZONE_SETTINGS.zoneTimeframe);
        const marketData = await getMarketData(symbol);
        
        if (!marketData || !zones || zones.length === 0) {
            console.log(`   ⚠️ Sem zonas S/R encontradas para ${symbol}`);
            return null;
        }
        
        const currentPrice = marketData.lastPrice;
        let nearZone = null;
        
        // Verificar se está perto de alguma zona
        for (const zone of zones) {
            const distancePercent = Math.abs((currentPrice - zone.price) / currentPrice) * 100;
            
            if (distancePercent <= EMA_ZONE_SETTINGS.zoneProximity) {
                nearZone = {
                    type: zone.type,
                    price: zone.price,
                    strength: zone.strength,
                    distancePercent: distancePercent,
                    isSupport: zone.type === 'SUPPORT',
                    isResistance: zone.type === 'RESISTANCE'
                };
                break;
            }
        }
        
        if (!nearZone) {
            console.log(`   ⚠️ ${symbol} não está perto de zona S/R (mínimo ${EMA_ZONE_SETTINGS.zoneProximity}%)`);
            return null;
        }
        
        console.log(`   ✅ ${symbol} perto de ${nearZone.type} $${nearZone.price.toFixed(6)} (${nearZone.distancePercent.toFixed(2)}%)`);
        
        // 2. SEGUNDO: Verificar cruzamento das EMAs
        const emaData = await checkEMA3133455(symbol);
        
        if (!emaData || !emaData.crossover) {
            console.log(`   ⚠️ Sem cruzamento de EMA para ${symbol}`);
            return null;
        }
        
        // 3. VERIFICAR SE O SINAL DE EMA CORRESPONDE À ZONA
        const isBuySignal = emaData.crossover.type === 'COMPRA';
        const isSellSignal = emaData.crossover.type === 'VENDA';
        
        // Compra: deve estar perto de SUPORTE
        if (isBuySignal && !nearZone.isSupport) {
            console.log(`   ⚠️ Sinal de COMPRA mas está perto de RESISTÊNCIA - ignorando`);
            return null;
        }
        
        // Venda: deve estar perto de RESISTÊNCIA
        if (isSellSignal && !nearZone.isResistance) {
            console.log(`   ⚠️ Sinal de VENDA mas está perto de SUPORTE - ignorando`);
            return null;
        }
        
        console.log(`   🎯 Setup completo detectado: ${emaData.crossover.type} com confirmação de ${nearZone.type}`);
        
        return {
            symbol: symbol,
            zone: nearZone,
            ema: emaData,
            marketData: marketData,
            signalType: emaData.crossover.type,
            confidence: Math.min(100, 70 + (nearZone.strength * 10))
        };
        
    } catch (error) {
        console.log(`⚠️ Erro checkZoneThenEMA ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA ENVIAR ALERTA DE ZONA + EMA
// =====================================================================

async function sendZoneEMAAlert(setupData) {
    try {
        const { symbol, zone, ema, marketData, signalType, confidence } = setupData;
        
        const now = getBrazilianDateTime();
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}&interval=3`;
        
        // Obter outros indicadores para contexto
        const [rsiData, lsrData, fundingData, btcStrength] = await Promise.all([
            getRSI(symbol, '1h'),
            getBinanceLSRValue(symbol, '15m'),
            checkFundingRate(symbol),
            calculateBTCRelativeStrength(symbol)
        ]);
        
        const isBuySignal = signalType === 'COMPRA';
        const actionEmoji = isBuySignal ? '🟢' : '🔴';
        const zoneType = zone.isSupport ? 'SUPORTE' : 'RESISTÊNCIA';
        
        // Formatar LSR
        let lsrInfo = 'N/A';
        if (lsrData) {
            lsrInfo = `${lsrData.lsrValue.toFixed(3)} ${lsrData.isRising ? '⬆️' : '⬇️'}`;
            if (lsrData.percentChange !== '0.00') {
                lsrInfo += ` (${lsrData.percentChange}%)`;
            }
        }
        
        const message = `
${actionEmoji} <i>${symbol} - Operação ${EMA_ZONE_SETTINGS.timeframe}</i>
 <i>Sinal de ${signalType} confirmado por ${zoneType}</i>
${now.full} <a href="${tradingViewLink}">Gráfico 3m</a>
• ${zoneType}: $${zone.price.toFixed(6)}
<i>Distâncias:</i>
• Preço → ${zoneType}: ${zone.distancePercent.toFixed(2)}%

 <i>Indicadores:</i>
• RSI 1h: ${rsiData ? `${rsiData.emoji} ${rsiData.value.toFixed(1)} (${rsiData.status})` : 'N/A'}
• LSR: ${lsrInfo}
• Funding Rate: ${fundingData.text}
• Força vs BTC: ${btcStrength.emoji} ${btcStrength.status}
• Confiança: ${confidence.toFixed(0)}%

 <i>Análise 24h:</i>
• Variação: ${marketData.priceChangePercent >= 0 ? '🟢' : '🔴'} ${marketData.priceChangePercent.toFixed(2)}%
• Vol: $${(marketData.quoteVolume / 1000000).toFixed(1)}M
• Range: $${marketData.lowPrice.toFixed(6)} - $${marketData.highPrice.toFixed(6)}


 <i>Titanium by @J4Rviz</i>
        `;
        
        const sent = await sendTelegramAlert(message);
        
        if (sent) {
            console.log(`\n${actionEmoji} Alerta Zona+EMA enviado: ${symbol} - ${signalType}`);
            console.log(`   ${zoneType}: $${zone.price.toFixed(6)} (${zone.distancePercent.toFixed(2)}%)`);
            console.log(`   EMA 13: $${ema.ema13.toFixed(6)} | EMA 34: $${ema.ema34.toFixed(6)}`);
            console.log(`   Preço: $${ema.price.toFixed(6)} | EMA 55: $${ema.ema55.toFixed(6)}`);
            console.log(`   Confiança: ${confidence.toFixed(0)}%`);
        }
        
        return sent;
        
    } catch (error) {
        console.error(`Erro enviando alerta Zona+EMA ${symbol}:`, error.message);
        return false;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR FORÇA RELATIVA EM RELAÇÃO AO BTC (DO ORIGINAL)
// =====================================================================

async function calculateBTCRelativeStrength(symbol) {
    try {
        if (symbol === 'BTCUSDT') {
            return {
                strengthScore: 50,
                status: 'NEUTRAL',
                emoji: '⚪',
                message: 'É o BTC'
            };
        }
        
        const settings = BTC_STRENGTH_SETTINGS;
        
        const assetCandles = await getCandlesCached(symbol, settings.timeframe, settings.lookbackPeriod);
        const btcCandles = await getCandlesCached(settings.btcSymbol, settings.timeframe, settings.lookbackPeriod);
        
        if (assetCandles.length < 5 || btcCandles.length < 5) {
            return {
                strengthScore: 50,
                status: 'NEUTRAL',
                emoji: '⚪',
                message: 'Dados insuficientes'
            };
        }

        const assetPriceChange = ((assetCandles[assetCandles.length - 1].close - assetCandles[0].close) / assetCandles[0].close) * 100;
        const btcPriceChange = ((btcCandles[btcCandles.length - 1].close - btcCandles[0].close) / btcCandles[0].close) * 100;
        
        const relativeChange = assetPriceChange - btcPriceChange;
        
        const assetVolumeAvg = assetCandles.reduce((sum, candle) => sum + candle.volume, 0) / assetCandles.length;
        const btcVolumeAvg = btcCandles.reduce((sum, candle) => sum + candle.volume, 0) / btcCandles.length;
        const volumeRatio = assetVolumeAvg / btcVolumeAvg;

        const weights = settings.strengthWeights;
        
        let priceStrength = 50;
        if (relativeChange > 5) priceStrength = 90;
        else if (relativeChange > 3) priceStrength = 75;
        else if (relativeChange > 1) priceStrength = 65;
        else if (relativeChange > 0) priceStrength = 55;
        else if (relativeChange > -1) priceStrength = 45;
        else if (relativeChange > -3) priceStrength = 35;
        else if (relativeChange > -5) priceStrength = 25;
        else priceStrength = 10;

        let volumeStrength = 50;
        if (volumeRatio > 0.05) volumeStrength = 80;
        else if (volumeRatio > 0.02) volumeStrength = 70;
        else if (volumeRatio > 0.01) volumeStrength = 60;
        else if (volumeRatio > 0.005) volumeStrength = 50;
        else if (volumeRatio > 0.002) volumeStrength = 40;
        else if (volumeRatio > 0.001) volumeStrength = 30;
        else volumeStrength = 20;

        const combinedScore = 
            (priceStrength * weights.priceChange) + 
            (volumeStrength * weights.volumeRatio) + 
            (50 * weights.dominance);

        let status, emoji;
        if (combinedScore >= settings.threshold.strongBuy) {
            status = 'FORTE PARA COMPRA';
            emoji = '🟢🟢🟢';
        } else if (combinedScore >= settings.threshold.moderateBuy) {
            status = 'MODERADO PARA COMPRA';
            emoji = '🟢🟢';
        } else if (combinedScore >= settings.threshold.neutral) {
            status = 'NEUTRO';
            emoji = '⚪';
        } else if (combinedScore >= settings.threshold.moderateSell) {
            status = 'MODERADO PARA VENDA';
            emoji = '🔴🔴';
        } else {
            status = 'FORTE PARA VENDA';
            emoji = '🔴🔴🔴';
        }

        return {
            strengthScore: Math.round(combinedScore),
            status: status,
            emoji: emoji,
            relativeChange: relativeChange,
            volumeRatio: volumeRatio
        };

    } catch (error) {
        console.log(`⚠️ Erro força BTC ${symbol}: ${error.message}`);
        return {
            strengthScore: 50,
            status: 'NEUTRAL',
            emoji: '⚪',
            message: 'Erro na análise'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA DETECTAR ZONAS DE ROMPIMENTO (15m)
// =====================================================================

async function getBreakoutStructure15m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 50); // Últimas 50 velas de 15m
        
        if (candles.length < 20) {
            return {
                breakoutHigh: null,
                breakoutLow: null,
                structureHighs: [],
                structureLows: []
            };
        }

        // Encontrar máximas e mínimas da estrutura
        const structureHighs = [];
        const structureLows = [];
        const lookback = 5; // Verificar 5 velas para cada lado

        for (let i = lookback; i < candles.length - lookback; i++) {
            const currentHigh = candles[i].high;
            const currentLow = candles[i].low;
            
            let isHigh = true;
            let isLow = true;
            
            // Verificar se é máxima local
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i) {
                    if (candles[j].high > currentHigh) isHigh = false;
                    if (candles[j].low < currentLow) isLow = false;
                }
            }
            
            if (isHigh) {
                structureHighs.push({
                    price: currentHigh,
                    time: candles[i].time,
                    volume: candles[i].volume
                });
            }
            
            if (isLow) {
                structureLows.push({
                    price: currentLow,
                    time: candles[i].time,
                    volume: candles[i].volume
                });
            }
        }

        // Ordenar e pegar as 3 mais recentes
        structureHighs.sort((a, b) => b.time - a.time);
        structureLows.sort((a, b) => b.time - a.time);
        
        const recentHighs = structureHighs.slice(0, 3);
        const recentLows = structureLows.slice(0, 3);

        // Encontrar a máxima mais alta e mínima mais baixa
        const highestHigh = recentHighs.length > 0 
            ? Math.max(...recentHighs.map(h => h.price))
            : null;
            
        const lowestLow = recentLows.length > 0
            ? Math.min(...recentLows.map(l => l.price))
            : null;

        // Verificar se há rompimento
        const currentPrice = candles[candles.length - 1].close;
        let breakoutHigh = null;
        let breakoutLow = null;

        if (highestHigh && currentPrice > highestHigh) {
            breakoutHigh = highestHigh;
        }

        if (lowestLow && currentPrice < lowestLow) {
            breakoutLow = lowestLow;
        }

        return {
            breakoutHigh: breakoutHigh,
            breakoutLow: breakoutLow,
            structureHighs: recentHighs,
            structureLows: recentLows,
            currentPrice: currentPrice
        };

    } catch (error) {
        console.log(`⚠️ Erro estrutura 15m ${symbol}: ${error.message}`);
        return {
            breakoutHigh: null,
            breakoutLow: null,
            structureHighs: [],
            structureLows: []
        };
    }
}

// =====================================================================
// 🆕 MONITOR PARA ALERTAS DE ZONA + EMA
// =====================================================================

class ZoneEMAMonitor {
    constructor() {
        this.symbolGroups = [];
        this.currentGroupIndex = 0;
        this.alertCooldowns = new Map();
        this.totalAlertsSent = 0;
        this.lastAlertTime = new Map();
        this.confirmationTracker = new Map();
    }

    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllFuturesSymbols();
            
            // Criar grupos
            const groupSize = Math.ceil(allSymbols.length / EMA_ZONE_SETTINGS.alertGroups);
            this.symbolGroups = this.createGroups(allSymbols, groupSize);
            
            console.log(`📊 ${allSymbols.length} ativos para monitoramento Zona+EMA`);
            console.log(`📊 ${this.symbolGroups.length} grupos criados`);
            
            return allSymbols;
            
        } catch (error) {
            console.error('Erro inicializando símbolos:', error.message);
            return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
        }
    }

    createGroups(symbols, groupSize) {
        const groups = [];
        for (let i = 0; i < symbols.length; i += groupSize) {
            groups.push(symbols.slice(i, i + groupSize));
        }
        return groups;
    }

    getNextGroup() {
        const group = this.symbolGroups[this.currentGroupIndex];
        this.currentGroupIndex = (this.currentGroupIndex + 1) % this.symbolGroups.length;
        return group;
    }

    canSendAlert(symbol, signalType) {
        const key = `${symbol}_${signalType}`;
        const lastAlert = this.lastAlertTime.get(key);
        
        if (!lastAlert) return true;
        
        return Date.now() - lastAlert > EMA_ZONE_SETTINGS.alertCooldown;
    }

    recordAlert(symbol, signalType) {
        const key = `${symbol}_${signalType}`;
        this.lastAlertTime.set(key, Date.now());
        this.totalAlertsSent++;
        
        // Limpar alerts antigos
        const now = Date.now();
        for (const [k, timestamp] of this.lastAlertTime.entries()) {
            if (now - timestamp > 86400000) {
                this.lastAlertTime.delete(k);
            }
        }
    }

    trackConfirmation(symbol, zonePrice, signalType) {
        const key = `${symbol}_${zonePrice.toFixed(6)}_${signalType}`;
        
        if (!this.confirmationTracker.has(key)) {
            this.confirmationTracker.set(key, {
                count: 1,
                firstSeen: Date.now(),
                lastSeen: Date.now()
            });
        } else {
            const data = this.confirmationTracker.get(key);
            data.count++;
            data.lastSeen = Date.now();
        }
        
        const now = Date.now();
        for (const [k, data] of this.confirmationTracker.entries()) {
            if (now - data.lastSeen > 3600000) {
                this.confirmationTracker.delete(k);
            }
        }
        
        const data = this.confirmationTracker.get(key);
        return data ? data.count : 0;
    }

    async monitorZoneEMASignals() {
        try {
            const symbols = this.getNextGroup();
            if (!symbols || symbols.length === 0) return;
            
            console.log(`\n📊 Monitorando Zona+EMA ${EMA_ZONE_SETTINGS.timeframe}: ${symbols.join(', ')}`);
            
            for (const symbol of symbols) {
                try {
                    await new Promise(r => setTimeout(r, 1000)); // Delay para evitar rate limit
                    
                    // Verificar setup completo: zona primeiro, depois EMA
                    const setupData = await checkZoneThenEMA(symbol);
                    
                    if (!setupData) {
                        continue;
                    }
                    
                    const { zone, signalType } = setupData;
                    
                    // Verificar confirmações
                    const confirmations = this.trackConfirmation(symbol, zone.price, signalType);
                    
                    if (confirmations >= 1 && this.canSendAlert(symbol, signalType)) {
                        await sendZoneEMAAlert(setupData);
                        this.recordAlert(symbol, signalType);
                        
                        // Aguardar entre alerts
                        await new Promise(r => setTimeout(r, 3000));
                    } else if (confirmations >= 1) {
                        console.log(`   ⏱️  ${symbol}: Setup detectado mas em cooldown (${signalType})`);
                    }
                    
                } catch (error) {
                    console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
        } catch (error) {
            console.error(`Erro no monitor Zona+EMA: ${error.message}`);
        }
    }
}

// =====================================================================
// 🔄 MONITORAMENTO PRINCIPAL COM ZONA + EMA
// =====================================================================

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(10000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function mainZoneEMAMonitorLoop() {
    const zoneEMAMonitor = new ZoneEMAMonitor();

    await zoneEMAMonitor.initializeSymbols();

    console.log(`\n🚨 SISTEMA DE ALERTA ZONA + EMA`);
    console.log(`📊 Sequência de análise:`);
    console.log(`  1. Verificar proximidade com suporte/resistência (${EMA_ZONE_SETTINGS.zoneTimeframe})`);
    console.log(`  2. Verificar cruzamento EMA 13/34/55 (${EMA_ZONE_SETTINGS.timeframe})`);
    console.log(`  3. Confirmar posição do preço em relação à EMA 55`);
    console.log(`⏱️  Intervalo: ${EMA_ZONE_SETTINGS.checkInterval / 1000}s`);
    console.log(`💰 Monitorando: ${EMA_ZONE_SETTINGS.zoneProximity}% de proximidade da zona`);
    console.log(`🤖 Iniciando...\n`);

    let consecutiveErrors = 0;
    let totalAlerts = 0;
    let lastReportTime = Date.now();

    while (true) {
        try {
            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 60s...');
                await new Promise(r => setTimeout(r, 60000));
                consecutiveErrors++;
                continue;
            }

            const startTime = Date.now();
            
            // Monitorar sinais de zona + EMA
            await zoneEMAMonitor.monitorZoneEMASignals();
            
            const endTime = Date.now();
            console.log(`✅ Ciclo completo: ${((endTime - startTime) / 1000).toFixed(1)}s`);

            cleanupCaches();
            consecutiveErrors = 0;

            if (Date.now() - lastReportTime >= 600000) {
                console.log(`\n📊 STATUS: ${zoneEMAMonitor.totalAlertsSent} alertas Zona+EMA enviados`);
                lastReportTime = Date.now();
            }

            const waitTime = EMA_ZONE_SETTINGS.checkInterval;
            console.log(`⏱️  Próximo ciclo em ${waitTime/1000}s...`);
            await new Promise(r => setTimeout(r, waitTime));

        } catch (error) {
            consecutiveErrors++;
            console.error(`\n❌ ERRO LOOP (${consecutiveErrors}):`, error.message);

            if (consecutiveErrors >= 2) {
                console.log('🔄 Muitos erros. Pausa de 120s...');
                await new Promise(r => setTimeout(r, 120000));
                consecutiveErrors = 0;
            }

            await new Promise(r => setTimeout(r, Math.min(30000 * consecutiveErrors, 120000)));
        }
    }
}

// =====================================================================
// 🔄 FUNÇÃO DE LIMPEZA DE CACHE
// =====================================================================

function cleanupCaches() {
    const now = Date.now();

    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });

    Object.keys(marketDataCache).forEach(key => {
        if (now - marketDataCache[key].timestamp > 600000) {
            delete marketDataCache[key];
        }
    });

    Object.keys(orderBookCache).forEach(key => {
        if (now - orderBookCache[key].timestamp > 300000) {
            delete orderBookCache[key];
        }
    });

    Object.keys(lsrCache).forEach(key => {
        if (now - lsrCache[key].timestamp > 300000) {
            delete lsrCache[key];
        }
    });

    Object.keys(fundingCache).forEach(key => {
        if (now - fundingCache[key].timestamp > 300000) {
            delete fundingCache[key];
        }
    });
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startZoneEMABot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

        console.log('\n' + '='.repeat(80));
        console.log('🚨 SISTEMA DE ALERTA ZONA + EMA');
        console.log('📊 Sequência: Suporte/Resistência → EMA 13/34/55 → Preço/EMA 55');
        console.log(`⏱️  Timeframe: ${EMA_ZONE_SETTINGS.timeframe} para EMA | ${EMA_ZONE_SETTINGS.zoneTimeframe} para zonas`);
        console.log(`📍 Proximidade: ${EMA_ZONE_SETTINGS.zoneProximity}% da zona`);
        console.log('⚠️  Alerta só após setup completo');
        console.log('='.repeat(80) + '\n');

        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }

        console.log('🔍 Verificando conexão...');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            if (await checkInternetConnection()) {
                connected = true;
                break;
            }
            console.log(`Tentativa ${i+1}/3 falhou. Aguardando...`);
            await new Promise(r => setTimeout(r, 10000));
        }

        if (!connected) {
            console.log('❌ Sem conexão com a Binance. Verifique sua internet.');
            process.exit(1);
        }

        console.log('✅ Conexão OK! Iniciando monitoramento Zona+EMA...');

        await mainZoneEMAMonitorLoop();

    } catch (error) {
        console.error(`\n🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 180 segundos...');
        await new Promise(r => setTimeout(r, 180000));
        await startZoneEMABot();
    }
}

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error.message);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    setTimeout(() => {
        startZoneEMABot();
    }, 60000);
});

// Iniciar o bot Zona+EMA
startZoneEMABot();
