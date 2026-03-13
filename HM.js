const axios = require('axios');
const fs = require('fs');
const path = require('path');

// =====================================================================
// === CONFIGURAÇÕES OTIMIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSy
        CHAT_ID: '-1002554
        DELAY_BETWEEN_MSGS: 3000
    },
    BINANCE: {
        BASE_URL: 'https://fapi.binance.com',
        TIMEOUT: 10000
    },
    TIMEFRAMES: [
        { interval: '1h', name: '1H' },
        { interval: '4h', name: '4H' }
    ],
    SCAN_INTERVAL: 5 * 60 * 1000,
    PATTERNS: {
        BASE_TOLERANCE: 0.02,
        ENTRY_TOLERANCE: {
            '1H': 0.010, // 1.0% para 1h
            '4H': 0.015  // 1.5% para 4h
        },
        DYNAMIC_TOLERANCE: {
            MIN: 0.015,
            MAX: 0.06,
            TIMEFRAME_MULTIPLIER: {
                '1m': 2.2,
                '5m': 2.0,
                '15m': 1.7,
                '30m': 1.4,
                '1h': 1.0,
                '4h': 0.8,
                '1d': 0.5
            },
            VOLATILITY_MULTIPLIER: {
                LOW: 0.7,
                MEDIUM: 1.0,
                HIGH: 1.6,
                EXTREME: 2.2
            }
        },
        HARMONIC: {
            GARTLEY: { 
                bull: { XA: 0.618, AB: [0.382, 0.886], BC: [1.13, 2.0], CD: [0.786, 0.886] },
                bear: { XA: 0.618, AB: [0.382, 0.886], BC: [1.13, 2.0], CD: [0.786, 0.886] }
            },
            BAT: { 
                bull: { XA: [0.382, 0.5], AB: [0.382, 0.886], BC: [1.618, 2.618], CD: [0.886, 0.886] },
                bear: { XA: [0.382, 0.5], AB: [0.382, 0.886], BC: [1.618, 2.618], CD: [0.886, 0.886] }
            },
            BUTTERFLY: { 
                bull: { XA: 0.786, AB: [0.382, 0.886], BC: [1.27, 1.618], CD: [1.27, 1.618] },
                bear: { XA: 0.786, AB: [0.382, 0.886], BC: [1.27, 1.618], CD: [1.27, 1.618] }
            },
            CRAB: { 
                bull: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.24, 4.236], CD: [1.618, 1.618] },
                bear: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.24, 4.236], CD: [1.618, 1.618] }
            },
            SHARK: {
                bull: { XA: [0.382, 0.618], AB: [0.886, 1.13], BC: [1.13, 1.618], CD: [0.886, 1.13] },
                bear: { XA: [0.382, 0.618], AB: [0.886, 1.13], BC: [1.13, 1.618], CD: [0.886, 1.13] }
            },
            CYPHER: {
                bull: { XA: [0.382, 0.618], AB: [0.382, 0.618], BC: [1.13, 1.414], CD: [0.786, 0.886] },
                bear: { XA: [0.382, 0.618], AB: [0.382, 0.618], BC: [1.13, 1.414], CD: [0.786, 0.886] }
            },
            DEEP_CRAB: {
                bull: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.0, 4.236], CD: [1.618, 2.24] },
                bear: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.0, 4.236], CD: [1.618, 2.24] }
            }
        }
    },
    ZIGZAG: {
        TYPE: 'PERCENTAGE',
        PERCENTAGE: {
            DEVIATION: 4,
            MIN_PIPS: 15
        },
        WAVES: {
            MAX_PRICE_PERCENT: 4,
            MIN_TREND_PERCENT: 0.8
        },
        MAX_PIVOTS: 20
    },
    VOLUME: {
        ABNORMAL_THRESHOLD: 1.8,
        CHECK_MINUTES: 3,
        MA_PERIOD: 9,  // Média móvel para volume
        TIMEFRAMES: {
            '3m': 3,
            '1h': 60,
            '24h': 1440
        }
    },
    ATR: {
        PERIOD: 14,
        MULTIPLIER: 2.2,
        TIMEFRAME: '1h'
    },
    LIQUIDITY: {
        LOOKBACK_CANDLES: 150,
        CLUSTER_THRESHOLD: 0.008,
        MIN_CLUSTER_TOUCHES: 2
    },
    RSI: {
        PERIOD: 14,
        TIMEFRAME: '1h',
        OVERSOLD: 30,
        OVERBOUGHT: 70
    },
    DIVERGENCE: {
        TIMEFRAMES: ['15m', '1h', '2h', '4h', '1d'],
        LOOKBACK: 50
    },
    FILTERS: {
        SKIP_NON_ASCII: true
    },
    PATHS: {
        LOGS: './logs'
    }
};

// Criar diretório de logs
if (!fs.existsSync(CONFIG.PATHS.LOGS)) fs.mkdirSync(CONFIG.PATHS.LOGS, { recursive: true });

// =====================================================================
// === LOGGER SIMPLES ===
// =====================================================================
const Logger = {
    log(emoji, message) {
        const timestamp = new Date().toISOString();
        console.log(`${timestamp} ${emoji} ${message}`);
        
        try {
            const logFile = path.join(CONFIG.PATHS.LOGS, `${new Date().toISOString().split('T')[0]}.log`);
            fs.appendFileSync(logFile, `${timestamp} ${emoji} ${message}\n`);
        } catch (error) {}
    },
    info: (msg) => Logger.log('📘', msg),
    warn: (msg) => Logger.log('⚠️', msg),
    error: (msg) => Logger.log('❌', msg),
    success: (msg) => Logger.log('✅', msg),
    pattern: (msg) => Logger.log('🎯', msg),
    debug: (msg) => Logger.log('🔍', msg),
    volume: (msg) => Logger.log('📊', msg),
    stop: (msg) => Logger.log('🛑', msg),
    liquidity: (msg) => Logger.log('💧', msg),
    rsi: (msg) => Logger.log('📈', msg),
    zigzag: (msg) => Logger.log('📐', msg),
    divergence: (msg) => Logger.log('🔄', msg)
};

// =====================================================================
// === UTILITÁRIOS ===
// =====================================================================
const Utils = {
    getBrazilianTime() {
        return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    },

    getBrazilianDate() {
        return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    },

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    formatPrice(p) {
        if (!p || isNaN(p)) return "---";
        if (p < 0.0001) return p.toFixed(8);
        if (p < 0.001) return p.toFixed(6);
        if (p < 0.01) return p.toFixed(5);
        if (p < 0.1) return p.toFixed(4);
        if (p < 1) return p.toFixed(3);
        if (p < 10) return p.toFixed(2);
        if (p < 100) return p.toFixed(1);
        return Math.round(p).toString();
    },

    formatVolume(v) {
        if (!v || isNaN(v)) return "---";
        if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
        if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
        return v.toFixed(0);
    },

    formatPercentage(value) {
        if (!value || isNaN(value)) return "---";
        return value.toFixed(1) + '%';
    },

    isAscii(symbol) {
        return /^[A-Z0-9]+$/.test(symbol);
    },

    calculateRatios(points) {
        const [x, a, b, c, d] = points;
        const XA = Math.abs(a - x);
        const AB = Math.abs(b - a);
        const BC = Math.abs(c - b);
        const CD = Math.abs(d - c);
        
        return {
            AB_XA: XA > 0 ? AB / XA : 0,
            BC_AB: AB > 0 ? BC / AB : 0,
            CD_BC: BC > 0 ? CD / BC : 0
        };
    },

    async fetchWithRetry(fn, retries = 2) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) throw error;
                await Utils.sleep(500 * Math.pow(2, i));
            }
        }
    },

    calculateDynamicTolerance(baseTolerance, atrPercentage, timeframe) {
        let tolerance = baseTolerance || CONFIG.PATTERNS.BASE_TOLERANCE;
        
        const tfMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.TIMEFRAME_MULTIPLIER[timeframe] || 1.0;
        tolerance *= tfMultiplier;
        
        if (atrPercentage) {
            let volMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.VOLATILITY_MULTIPLIER.MEDIUM;
            
            if (atrPercentage < 1) {
                volMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.VOLATILITY_MULTIPLIER.LOW;
            } else if (atrPercentage >= 1 && atrPercentage < 3) {
                volMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.VOLATILITY_MULTIPLIER.MEDIUM;
            } else if (atrPercentage >= 3 && atrPercentage < 5) {
                volMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.VOLATILITY_MULTIPLIER.HIGH;
            } else if (atrPercentage >= 5) {
                volMultiplier = CONFIG.PATTERNS.DYNAMIC_TOLERANCE.VOLATILITY_MULTIPLIER.EXTREME;
            }
            
            tolerance *= volMultiplier;
        }
        
        return Math.min(
            Math.max(tolerance, CONFIG.PATTERNS.DYNAMIC_TOLERANCE.MIN),
            CONFIG.PATTERNS.DYNAMIC_TOLERANCE.MAX
        );
    },

    calculateSMA(data, period) {
        if (data.length < period) return null;
        const sum = data.slice(-period).reduce((a, b) => a + b, 0);
        return sum / period;
    },

    calculateEMA(data, period) {
        if (data.length < period) return null;
        
        const multiplier = 2 / (period + 1);
        let ema = data[0];
        
        for (let i = 1; i < data.length; i++) {
            ema = (data[i] - ema) * multiplier + ema;
        }
        
        return ema;
    }
};

// =====================================================================
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor(minDelay = 50) {
        this.queue = [];
        this.processing = false;
        this.lastRequest = 0;
        this.minDelay = minDelay;
    }

    async execute(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            if (!this.processing) this.process();
        });
    }

    async process() {
        if (this.queue.length === 0) { this.processing = false; return; }
        this.processing = true;

        const now = Date.now();
        const waitTime = Math.max(0, this.minDelay - (now - this.lastRequest));
        if (waitTime > 0) await Utils.sleep(waitTime);

        const item = this.queue.shift();
        try {
            this.lastRequest = Date.now();
            const result = await item.fn();
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        }

        setTimeout(() => this.process(), 10);
    }
}

// =====================================================================
// === TELEGRAM SENDER ===
// =====================================================================
class TelegramSender {
    constructor(botToken, chatId) {
        this.botToken = botToken;
        this.chatId = chatId;
        this.queue = [];
        this.processing = false;
        this.lastMsg = 0;
    }

    async send(message) {
        return new Promise((resolve, reject) => {
            this.queue.push({ message, resolve, reject });
            if (!this.processing) this.process();
        });
    }

    async process() {
        if (this.queue.length === 0) { this.processing = false; return; }
        this.processing = true;

        const now = Date.now();
        const waitTime = Math.max(0, CONFIG.TELEGRAM.DELAY_BETWEEN_MSGS - (now - this.lastMsg));
        if (waitTime > 0) await Utils.sleep(waitTime);

        const item = this.queue.shift();
        try {
            await axios.post(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
                chat_id: this.chatId,
                text: item.message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
            this.lastMsg = Date.now();
            item.resolve();
        } catch (error) {
            if (error.response?.status === 429) {
                this.queue.unshift(item);
                await Utils.sleep(30000);
            } else {
                item.reject(error);
            }
        }

        setTimeout(() => this.process(), 100);
    }
}

// =====================================================================
// === RSI CALCULATOR ===
// =====================================================================
class RSICalculator {
    constructor() {
        this.rsiCache = new Map();
    }

    calculateRSI(prices, period = CONFIG.RSI.PERIOD) {
        if (prices.length < period + 1) return null;

        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        let avgGain = 0;
        let avgLoss = 0;
        
        for (let i = 0; i < period; i++) {
            const change = changes[i];
            if (change > 0) {
                avgGain += change;
            } else {
                avgLoss += Math.abs(change);
            }
        }
        
        avgGain = avgGain / period;
        avgLoss = avgLoss / period;

        const rma = (prev, current, period) => {
            return (prev * (period - 1) + current) / period;
        };

        const rsiValues = [];
        
        if (avgLoss === 0) {
            rsiValues.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsiValues.push(100 - (100 / (1 + rs)));
        }

        for (let i = period; i < changes.length; i++) {
            const change = changes[i];
            const currentGain = change > 0 ? change : 0;
            const currentLoss = change < 0 ? Math.abs(change) : 0;

            avgGain = rma(avgGain, currentGain, period);
            avgLoss = rma(avgLoss, currentLoss, period);

            if (avgLoss === 0) {
                rsiValues.push(100);
            } else if (avgGain === 0) {
                rsiValues.push(0);
            } else {
                const rs = avgGain / avgLoss;
                rsiValues.push(100 - (100 / (1 + rs)));
            }
        }

        return rsiValues[rsiValues.length - 1];
    }

    async getRSI(symbol, fetcher, limiter, timeframe = '1h') {
        try {
            const cacheKey = `${symbol}_${timeframe}`;
            const cached = this.rsiCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < 300000) {
                return cached.value;
            }

            const candles = await fetcher.getKlines(symbol, timeframe, CONFIG.RSI.PERIOD + 50);
            if (!candles || candles.length < CONFIG.RSI.PERIOD + 1) return null;

            const prices = candles.map(c => c.close);
            const rsiValue = this.calculateRSI(prices, CONFIG.RSI.PERIOD);

            if (rsiValue !== null) {
                this.rsiCache.set(cacheKey, {
                    value: rsiValue,
                    timestamp: Date.now()
                });
            }

            return rsiValue;

        } catch (error) {
            Logger.debug(`Erro RSI ${symbol}: ${error.message}`);
            return null;
        }
    }

    getRSIState(rsi) {
        if (rsi === null) return '---';
        if (rsi > CONFIG.RSI.OVERBOUGHT) return 'SOBRECOMPRADO 🔴';
        if (rsi < CONFIG.RSI.OVERSOLD) return 'SOBREVENDIDO 🟢';
        if (rsi > 60) return 'COMPRADOR 📈';
        if (rsi < 40) return 'VENDEDOR 📉';
        return 'NEUTRO ⚪';
    }
}

// =====================================================================
// === DIVERGENCE DETECTOR ===
// =====================================================================
class DivergenceDetector {
    constructor() {
        this.divergenceCache = new Map();
    }

    async detectDivergences(symbol, fetcher, limiter) {
        try {
            const cacheKey = symbol;
            const cached = this.divergenceCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < 300000) {
                return cached.value;
            }

            const divergences = [];

            for (const timeframe of CONFIG.DIVERGENCE.TIMEFRAMES) {
                const candles = await fetcher.getKlines(symbol, timeframe, CONFIG.DIVERGENCE.LOOKBACK);
                if (!candles || candles.length < 30) continue;

                const prices = candles.map(c => c.close);
                const rsiValues = [];
                
                // Calcular RSI para cada candle
                for (let i = 14; i < prices.length; i++) {
                    const rsi = this.calculateRSI(prices.slice(0, i + 1));
                    if (rsi !== null) rsiValues.push(rsi);
                }

                if (rsiValues.length < 20) continue;

                // Detectar divergências de alta
                const bullishDiv = this.detectBullishDivergence(prices, rsiValues, candles);
                if (bullishDiv) {
                    divergences.push({
                        type: 'BULL',
                        timeframe,
                        price: bullishDiv.price,
                        rsi: bullishDiv.rsi,
                        strength: bullishDiv.strength
                    });
                    Logger.divergence(`🟢 Divergência BULL ${timeframe} em ${symbol}`);
                }

                // Detectar divergências de baixa
                const bearishDiv = this.detectBearishDivergence(prices, rsiValues, candles);
                if (bearishDiv) {
                    divergences.push({
                        type: 'BEAR',
                        timeframe,
                        price: bearishDiv.price,
                        rsi: bearishDiv.rsi,
                        strength: bearishDiv.strength
                    });
                    Logger.divergence(`🔴 Divergência BEAR ${timeframe} em ${symbol}`);
                }
            }

            const result = {
                divergences,
                timestamp: Date.now()
            };

            this.divergenceCache.set(cacheKey, {
                value: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            Logger.debug(`Erro divergências ${symbol}: ${error.message}`);
            return null;
        }
    }

    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return null;

        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        let avgGain = 0;
        let avgLoss = 0;
        
        for (let i = 0; i < period; i++) {
            const change = changes[i];
            if (change > 0) {
                avgGain += change;
            } else {
                avgLoss += Math.abs(change);
            }
        }
        
        avgGain = avgGain / period;
        avgLoss = avgLoss / period;

        if (avgLoss === 0) return 100;
        
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    detectBullishDivergence(prices, rsiValues, candles) {
        // Encontrar topos e fundos nos preços e RSI
        const priceLows = this.findLows(prices);
        const rsiLows = this.findLows(rsiValues);

        if (priceLows.length < 2 || rsiLows.length < 2) return null;

        // Pegar os dois últimos fundos
        const [low1, low2] = priceLows.slice(-2);
        const [rsiLow1, rsiLow2] = rsiLows.slice(-2);

        if (!low1 || !low2 || !rsiLow1 || !rsiLow2) return null;

        // Verificar divergência de alta: preço faz fundo mais baixo, RSI faz fundo mais alto
        const priceLower = low2.price < low1.price;
        const rsiHigher = rsiLow2.value > rsiLow1.value;

        if (priceLower && rsiHigher) {
            const strength = Math.abs((rsiLow2.value - rsiLow1.value) / rsiLow1.value * 100);
            return {
                price: low2.price,
                rsi: rsiLow2.value,
                strength: Math.min(strength, 100)
            };
        }

        return null;
    }

    detectBearishDivergence(prices, rsiValues, candles) {
        // Encontrar topos nos preços e RSI
        const priceHighs = this.findHighs(prices);
        const rsiHighs = this.findHighs(rsiValues);

        if (priceHighs.length < 2 || rsiHighs.length < 2) return null;

        // Pegar os dois últimos topos
        const [high1, high2] = priceHighs.slice(-2);
        const [rsiHigh1, rsiHigh2] = rsiHighs.slice(-2);

        if (!high1 || !high2 || !rsiHigh1 || !rsiHigh2) return null;

        // Verificar divergência de baixa: preço faz topo mais alto, RSI faz topo mais baixo
        const priceHigher = high2.price > high1.price;
        const rsiLower = rsiHigh2.value < rsiHigh1.value;

        if (priceHigher && rsiLower) {
            const strength = Math.abs((rsiHigh2.value - rsiHigh1.value) / rsiHigh1.value * 100);
            return {
                price: high2.price,
                rsi: rsiHigh2.value,
                strength: Math.min(strength, 100)
            };
        }

        return null;
    }

    findLows(values) {
        const lows = [];
        for (let i = 2; i < values.length - 2; i++) {
            if (values[i] < values[i-1] && values[i] < values[i-2] && 
                values[i] < values[i+1] && values[i] < values[i+2]) {
                lows.push({
                    index: i,
                    value: values[i]
                });
            }
        }
        return lows;
    }

    findHighs(values) {
        const highs = [];
        for (let i = 2; i < values.length - 2; i++) {
            if (values[i] > values[i-1] && values[i] > values[i-2] && 
                values[i] > values[i+1] && values[i] > values[i+2]) {
                highs.push({
                    index: i,
                    value: values[i]
                });
            }
        }
        return highs;
    }

    formatDivergenceMessage(divergences) {
        if (!divergences || divergences.length === 0) return '';

        const bullDivs = divergences.filter(d => d.type === 'BULL');
        const bearDivs = divergences.filter(d => d.type === 'BEAR');

        let message = '';

        if (bullDivs.length > 0) {
            message += '🟢 Bull: ' + bullDivs.map(d => d.timeframe).join(', ');
        }

        if (bearDivs.length > 0) {
            if (message) message += ' | ';
            message += '🔴 Bear: ' + bearDivs.map(d => d.timeframe).join(', ');
        }

        return message;
    }
}

// =====================================================================
// === LIQUIDITY CLUSTER DETECTOR ===
// =====================================================================
class LiquidityClusterDetector {
    constructor() {
        this.clusterCache = new Map();
    }

    async detectClusters(symbol, fetcher, limiter) {
        try {
            const cached = this.clusterCache.get(symbol);
            if (cached && Date.now() - cached.timestamp < 3600000) {
                return cached.value;
            }

            const candles = await fetcher.getKlines(symbol, '1h', CONFIG.LIQUIDITY.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) return null;

            const liquidityPoints = [];
            
            for (let i = 1; i < candles.length - 1; i++) {
                if (candles[i].high > candles[i-1].high && candles[i].high > candles[i+1].high) {
                    liquidityPoints.push({
                        price: candles[i].high,
                        type: 'RESISTANCE',
                        strength: 1
                    });
                }
                
                if (candles[i].low < candles[i-1].low && candles[i].low < candles[i+1].low) {
                    liquidityPoints.push({
                        price: candles[i].low,
                        type: 'SUPPORT',
                        strength: 1
                    });
                }
            }

            const clusters = [];
            const threshold = candles[candles.length - 1].close * CONFIG.LIQUIDITY.CLUSTER_THRESHOLD;

            for (const point of liquidityPoints) {
                let found = false;
                
                for (const cluster of clusters) {
                    if (Math.abs(cluster.avgPrice - point.price) <= threshold) {
                        cluster.points.push(point);
                        cluster.avgPrice = cluster.points.reduce((sum, p) => sum + p.price, 0) / cluster.points.length;
                        cluster.strength++;
                        cluster.type = point.type;
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    clusters.push({
                        points: [point],
                        avgPrice: point.price,
                        strength: 1,
                        type: point.type
                    });
                }
            }

            const significantClusters = clusters
                .filter(c => c.strength >= CONFIG.LIQUIDITY.MIN_CLUSTER_TOUCHES)
                .sort((a, b) => b.strength - a.strength);

            const currentPrice = candles[candles.length - 1].close;
            
            const supports = significantClusters
                .filter(c => c.type === 'SUPPORT' && c.avgPrice < currentPrice)
                .sort((a, b) => b.avgPrice - a.avgPrice)
                .slice(0, 3);
                
            const resistances = significantClusters
                .filter(c => c.type === 'RESISTANCE' && c.avgPrice > currentPrice)
                .sort((a, b) => a.avgPrice - b.avgPrice)
                .slice(0, 3);

            const result = {
                supports: supports.map(s => ({
                    price: s.avgPrice,
                    strength: s.strength
                })),
                resistances: resistances.map(r => ({
                    price: r.avgPrice,
                    strength: r.strength
                })),
                timestamp: Date.now()
            };

            if (supports.length > 0 || resistances.length > 0) {
                Logger.liquidity(`💧 ${symbol} Clusters: Sup ${supports.length} | Res ${resistances.length}`);
            }

            this.clusterCache.set(symbol, {
                value: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            Logger.debug(`Erro clusters ${symbol}: ${error.message}`);
            return null;
        }
    }

    formatLiquidityMessage(clusters) {
        if (!clusters || (!clusters.supports.length && !clusters.resistances.length)) {
            return '💧 Liquidez: Sem clusters significativos';
        }

        let message = '💧 <b>Clusters de Liquidez:</b>\n';
        
        if (clusters.supports.length > 0) {
            message += '   Suportes: ';
            message += clusters.supports.map(s => 
                `$${Utils.formatPrice(s.price)} (${s.strength}x)`
            ).join(' | ');
            message += '\n';
        }
        
        if (clusters.resistances.length > 0) {
            message += '   Resistências: ';
            message += clusters.resistances.map(r => 
                `$${Utils.formatPrice(r.price)} (${r.strength}x)`
            ).join(' | ');
        }
        
        return message;
    }
}

// =====================================================================
// === ATR CALCULATOR ===
// =====================================================================
class ATRCalculator {
    constructor() {
        this.atrCache = new Map();
    }

    async calculateATR(symbol, fetcher, limiter, timeframe = CONFIG.ATR.TIMEFRAME) {
        try {
            const cached = this.atrCache.get(symbol);
            if (cached && Date.now() - cached.timestamp < 300000) {
                return cached.value;
            }

            const candles = await fetcher.getKlines(symbol, timeframe, CONFIG.ATR.PERIOD + 1);
            if (!candles || candles.length < CONFIG.ATR.PERIOD + 1) return null;

            const trueRanges = [];
            for (let i = 1; i < candles.length; i++) {
                const high = candles[i].high;
                const low = candles[i].low;
                const prevClose = candles[i-1].close;
                
                const tr1 = high - low;
                const tr2 = Math.abs(high - prevClose);
                const tr3 = Math.abs(low - prevClose);
                
                const trueRange = Math.max(tr1, tr2, tr3);
                trueRanges.push(trueRange);
            }

            const atr = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
            const currentPrice = candles[candles.length - 1].close;
            const atrPercentage = (atr / currentPrice) * 100;

            const atrInfo = {
                value: atr,
                percentage: atrPercentage,
                stopDistance: atr * CONFIG.ATR.MULTIPLIER,
                stopPercentage: atrPercentage * CONFIG.ATR.MULTIPLIER,
                multiplier: CONFIG.ATR.MULTIPLIER,
                timeframe: timeframe,
                timestamp: Date.now()
            };

            this.atrCache.set(symbol, {
                value: atrInfo,
                timestamp: Date.now()
            });

            return atrInfo;

        } catch (error) {
            Logger.debug(`Erro ATR ${symbol}: ${error.message}`);
            return null;
        }
    }

    calculateStopPrice(entryPrice, direction, atrInfo) {
        if (!atrInfo) return null;
        
        if (direction === 'BULLISH') {
            return entryPrice - atrInfo.stopDistance;
        } else {
            return entryPrice + atrInfo.stopDistance;
        }
    }
}

// =====================================================================
// === VOLUME ANALYZER MELHORADO COM MÚLTIPLOS TIMEFRAMES ===
// =====================================================================
class VolumeAnalyzer {
    constructor() {
        this.volumeHistory = new Map();
        this.volumeEMA = new Map();
    }

    async analyzeVolume(symbol, fetcher, limiter) {
        try {
            const result = {};

            // Volume 3 minutos (já existente)
            const candles3m = await fetcher.getKlines(symbol, '1m', 5);
            if (candles3m && candles3m.length >= 3) {
                const volumes3m = candles3m.slice(-3).map(c => c.volume);
                const volumeMA9 = Utils.calculateSMA(volumes3m, 3) || volumes3m[0];
                const lastVolume = volumes3m[volumes3m.length - 1];
                const volumeMultiple = volumeMA9 > 0 ? lastVolume / volumeMA9 : 0;
                
                result['3m'] = {
                    currentVolume: lastVolume,
                    volumeMA9,
                    multiple: volumeMultiple,
                    volumePercent: ((lastVolume - volumeMA9) / volumeMA9) * 100,
                    isAbnormal: volumeMultiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD,
                    direction: this.determineVolumeDirection(volumes3m, 3)
                };
            }

            // Volume 1 hora
            const candles1h = await fetcher.getKlines(symbol, '5m', 12); // 12 * 5min = 1h
            if (candles1h && candles1h.length >= 12) {
                const volumes1h = candles1h.map(c => c.volume);
                const volumeMA9 = Utils.calculateSMA(volumes1h, 9);
                if (volumeMA9) {
                    const lastVolume = volumes1h[volumes1h.length - 1];
                    const volumeMultiple = lastVolume / volumeMA9;
                    
                    result['1h'] = {
                        currentVolume: volumes1h.reduce((a, b) => a + b, 0),
                        volumeMA9,
                        multiple: volumeMultiple,
                        volumePercent: ((lastVolume - volumeMA9) / volumeMA9) * 100,
                        isAbnormal: volumeMultiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD,
                        direction: this.determineVolumeDirection(volumes1h.slice(-5), 5)
                    };
                }
            }

            // Volume 24 horas
            const candles24h = await fetcher.getKlines(symbol, '1h', 24);
            if (candles24h && candles24h.length >= 24) {
                const volumes24h = candles24h.map(c => c.volume);
                const volumeMA9 = Utils.calculateSMA(volumes24h, 9);
                if (volumeMA9) {
                    const lastVolume = volumes24h[volumes24h.length - 1];
                    const volumeMultiple = lastVolume / volumeMA9;
                    
                    result['24h'] = {
                        currentVolume: volumes24h.reduce((a, b) => a + b, 0),
                        volumeMA9,
                        multiple: volumeMultiple,
                        volumePercent: ((lastVolume - volumeMA9) / volumeMA9) * 100,
                        isAbnormal: volumeMultiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD,
                        direction: this.determineVolumeDirection(volumes24h.slice(-5), 5)
                    };
                }
            }

            return result;

        } catch (error) {
            Logger.debug(`Erro análise volume ${symbol}: ${error.message}`);
            return null;
        }
    }

    determineVolumeDirection(volumes, period) {
        if (volumes.length < period) return 'ESTÁVEL';
        
        const recent = volumes.slice(-period);
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgPrevious = volumes.slice(-period * 2, -period).reduce((a, b) => a + b, 0) / period;
        
        if (avgRecent > avgPrevious * 1.2) return 'AUMENTANDO 📈';
        if (avgRecent < avgPrevious * 0.8) return 'DIMINUINDO 📉';
        return 'ESTÁVEL ⚪';
    }

    getVolumeDirectionText(direction) {
        if (direction === 'AUMENTANDO 📈') return 'COMPRADOR';
        if (direction === 'DIMINUINDO 📉') return 'VENDEDOR';
        return 'NEUTRO';
    }

    formatVolumeMessage(volumeData, timeframe) {
        if (!volumeData || !volumeData[timeframe]) return ` Vol ${timeframe}: ---`;

        const data = volumeData[timeframe];
        const volumeType = data.isAbnormal ? 
            (data.direction.includes('AUMENTANDO') ? 'COMPRADOR FORTE' : 
             data.direction.includes('DIMINUINDO') ? 'VENDEDOR FORTE' : 'ANORMAL') : 'NORMAL';
        
        const direction = this.getVolumeDirectionText(data.direction);
        const multiple = data.multiple.toFixed(1);
        
        return ` Vol ${timeframe}: ${Utils.formatVolume(data.currentVolume)} (${multiple}x) | ${direction}`;
    }
}

// =====================================================================
// === LSR CALCULATOR ===
// =====================================================================
class LSRCalculator {
    constructor() {
        this.lsrCache = new Map();
        this.topLongShortAccountRatioUrl = 'https://fapi.binance.com/futures/data/topLongShortAccountRatio';
        this.topLongShortPositionRatioUrl = 'https://fapi.binance.com/futures/data/topLongShortPositionRatio';
        this.globalLongShortAccountRatioUrl = 'https://fapi.binance.com/futures/data/globalLongShortAccountRatio';
    }

    async calculateLSR(symbol, fetcher, limiter) {
        try {
            const cached = this.lsrCache.get(symbol);
            if (cached && Date.now() - cached.timestamp < 120000) {
                return cached.value;
            }

            let lsrData = await this.fetchTopTraderRatio(symbol, limiter);
            
            if (!lsrData) {
                lsrData = await this.fetchTopPositionRatio(symbol, limiter);
            }
            
            if (!lsrData) {
                lsrData = await this.fetchGlobalRatio(symbol, limiter);
            }
            
            if (!lsrData) return null;

            const lsrValue = this.convertBinanceRatio(lsrData.longShortRatio);
            
            let dominance = 'NEUTRO';
            if (lsrValue > 55) {
                dominance = 'COMPRADOR';
            } else if (lsrValue < 45) {
                dominance = 'VENDEDOR';
            }
            
            const lsrInfo = {
                value: lsrValue,
                dominance,
                rawRatio: lsrData.longShortRatio.toFixed(2),
                longAccount: lsrData.longAccount ? lsrData.longAccount.toFixed(1) : null,
                shortAccount: lsrData.shortAccount ? lsrData.shortAccount.toFixed(1) : null,
                timestamp: Date.now()
            };
            
            this.lsrCache.set(symbol, {
                value: lsrInfo,
                timestamp: Date.now()
            });
            
            return lsrInfo;
            
        } catch (error) {
            Logger.debug(`Erro LSR ${symbol}: ${error.message}`);
            return null;
        }
    }

    async fetchTopTraderRatio(symbol, limiter) {
        try {
            const response = await limiter.execute(async () => {
                return await axios.get(this.topLongShortAccountRatioUrl, {
                    params: {
                        symbol: symbol,
                        period: '15m',
                        limit: 1
                    }
                });
            });
            
            if (response.data && response.data.length > 0) {
                const data = response.data[0];
                return {
                    longShortRatio: parseFloat(data.longShortRatio),
                    longAccount: parseFloat(data.longAccount),
                    shortAccount: parseFloat(data.shortAccount)
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async fetchTopPositionRatio(symbol, limiter) {
        try {
            const response = await limiter.execute(async () => {
                return await axios.get(this.topLongShortPositionRatioUrl, {
                    params: {
                        symbol: symbol,
                        period: '15m',
                        limit: 1
                    }
                });
            });
            
            if (response.data && response.data.length > 0) {
                const data = response.data[0];
                return {
                    longShortRatio: parseFloat(data.longShortRatio),
                    longAccount: null,
                    shortAccount: null
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async fetchGlobalRatio(symbol, limiter) {
        try {
            const response = await limiter.execute(async () => {
                return await axios.get(this.globalLongShortAccountRatioUrl, {
                    params: {
                        symbol: symbol,
                        period: '15m',
                        limit: 1
                    }
                });
            });
            
            if (response.data && response.data.length > 0) {
                const data = response.data[0];
                return {
                    longShortRatio: parseFloat(data.longShortRatio),
                    longAccount: null,
                    shortAccount: null
                };
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    convertBinanceRatio(ratio) {
        if (ratio >= 1) {
            return 50 + (50 * (ratio - 1) / ratio);
        } else {
            return 50 * ratio;
        }
    }
}

// =====================================================================
// === DETECTOR DE PADRÕES MELHORADO ===
// =====================================================================
class PatternDetector {
    constructor() {
        this.toleranceCache = new Map();
    }

    getDynamicTolerance(atrPercentage, timeframe) {
        const cacheKey = `${atrPercentage?.toFixed(2) || 'null'}_${timeframe}`;
        
        if (this.toleranceCache.has(cacheKey)) {
            const cached = this.toleranceCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 300000) {
                return cached.value;
            }
        }
        
        const tolerance = Utils.calculateDynamicTolerance(
            CONFIG.PATTERNS.BASE_TOLERANCE,
            atrPercentage,
            timeframe
        );
        
        this.toleranceCache.set(cacheKey, {
            value: tolerance,
            timestamp: Date.now()
        });
        
        return tolerance;
    }

    debugPatternDetection(pivots, atrPercentage, timeframe) {
        if (pivots.length < 5) {
            Logger.debug(`📐 Poucos pivôs (${pivots.length}) para detectar padrões`);
            return;
        }
        
        const tolerance = this.getDynamicTolerance(atrPercentage, timeframe);
        Logger.debug(`📐 Analisando ${pivots.length} pivôs com tolerância ${(tolerance*100).toFixed(1)}%`);
    }

    matchRatio(value, target, tolerance) {
        if (Array.isArray(target)) {
            if (target.length === 2) {
                const [min, max] = target;
                const range = max - min;
                const expandedMin = min - (range * tolerance);
                const expandedMax = max + (range * tolerance);
                return value >= expandedMin && value <= expandedMax;
            }
            return false;
        }
        return Math.abs(value - target) <= target * tolerance;
    }

    detectHarmonic(pivots, atrPercentage, timeframe) {
        if (!pivots || pivots.length < 5) return [];
        
        const patterns = [];
        const tolerance = this.getDynamicTolerance(atrPercentage, timeframe);
        
        for (let i = 0; i <= pivots.length - 5; i++) {
            const types = pivots.slice(i, i + 5).map(p => p.type);
            // Verifica alternância de tipos
            if (!types.every((t, idx) => idx === 0 || t !== types[idx-1])) continue;
            
            const [x, a, b, c, d] = pivots.slice(i, i + 5);
            if (!x || !a || !b || !c || !d) continue;
            
            // Determina direção baseado nos primeiros pontos
            let direction = null;
            
            // Para padrões de alta: X > A (primeiro movimento para baixo) e A < B, B > C, C < D
            if (x.price > a.price && a.price < b.price && b.price > c.price && c.price < d.price) {
                direction = 'BULLISH';
            }
            // Para padrões de baixa: X < A (primeiro movimento para cima) e A > B, B < C, C > D
            else if (x.price < a.price && a.price > b.price && b.price < c.price && c.price > d.price) {
                direction = 'BEARISH';
            } else {
                continue;
            }
            
            const ratios = Utils.calculateRatios([x.price, a.price, b.price, c.price, d.price]);
            const key = direction === 'BULLISH' ? 'bull' : 'bear';
            
            for (const [name, config] of Object.entries(CONFIG.PATTERNS.HARMONIC)) {
                const pattern = config[key];
                if (!pattern) continue;
                
                const matchXA = pattern.XA ? this.matchRatio(ratios.AB_XA, pattern.XA, tolerance) : true;
                const matchAB = pattern.AB ? this.matchRatio(ratios.BC_AB, pattern.AB, tolerance) : true;
                const matchBC = pattern.BC ? this.matchRatio(ratios.CD_BC, pattern.BC, tolerance) : true;
                
                if (matchXA && matchAB && matchBC) {
                    const moveBC = Math.abs(c.price - b.price);
                    
                    // Calcula alvo baseado no padrão
                    let targetMultiplier = 1.618;
                    if (pattern.CD && Array.isArray(pattern.CD)) {
                        targetMultiplier = pattern.CD[0];
                    } else if (pattern.CD) {
                        targetMultiplier = pattern.CD;
                    }
                    
                    const target = direction === 'BULLISH' 
                        ? d.price + (moveBC * targetMultiplier)
                        : d.price - (moveBC * targetMultiplier);
                    
                    Logger.debug(`✅ ${name} ${direction} detectado - Entrada: $${d.price} | Target: $${target}`);
                    
                    patterns.push({
                        type: name,
                        direction,
                        points: { x, a, b, c, d },
                        entry: d.price,
                        target: target,
                        detectedAt: Date.now()
                    });
                    break;
                }
            }
        }
        
        return patterns;
    }

    detectABCD(pivots, atrPercentage, timeframe) {
        if (!pivots || pivots.length < 4) return [];
        
        const patterns = [];
        const tolerance = this.getDynamicTolerance(atrPercentage, timeframe);
        
        for (let i = 0; i <= pivots.length - 4; i++) {
            const types = pivots.slice(i, i + 4).map(p => p.type);
            // Verifica alternância de tipos
            if (!types.every((t, idx) => idx === 0 || t !== types[idx-1])) continue;
            
            const [a, b, c, d] = pivots.slice(i, i + 4);
            if (!a || !b || !c || !d) continue;
            
            const moveAB = Math.abs(b.price - a.price);
            const moveBC = Math.abs(c.price - b.price);
            
            if (moveAB === 0 || moveBC === 0) continue;
            
            const ratioAB = moveBC / moveAB;
            
            // Verifica direção do ABCD
            let direction = null;
            // ABCD de alta: A > B, B < C, C > D (com D > A para extensão)
            if (a.price > b.price && b.price < c.price && c.price > d.price && d.price > a.price) {
                direction = 'BULLISH';
            }
            // ABCD de baixa: A < B, B > C, C < D (com D < A para extensão)
            else if (a.price < b.price && b.price > c.price && c.price < d.price && d.price < a.price) {
                direction = 'BEARISH';
            } else {
                continue;
            }
            
            // Verifica se o ratio está dentro do range do padrão ABCD (0.382-0.886)
            if (ratioAB >= 0.382 - (0.382 * tolerance) && ratioAB <= 0.886 + (0.886 * tolerance)) {
                Logger.debug(`✅ ABCD ${direction} detectado - Entrada: $${c.price} | Target: $${d.price}`);
                
                patterns.push({
                    type: 'ABCD',
                    direction,
                    points: { a, b, c, d },
                    entry: c.price,
                    target: d.price,
                    detectedAt: Date.now()
                });
            }
        }
        
        return patterns;
    }
}

// =====================================================================
// === ZIGZAG MELHORADO ===
// =====================================================================
class Zigzag {
    constructor() {
        this.pivots = [];
        this.type = CONFIG.ZIGZAG.TYPE;
        this.percentage = CONFIG.ZIGZAG.PERCENTAGE;
        this.waves = CONFIG.ZIGZAG.WAVES;
        this.maxPivots = CONFIG.ZIGZAG.MAX_PIVOTS;
    }

    findPivotsPercentage(highs, lows) {
        this.pivots = [];
        
        if (highs.length < 3) return this;
        
        const avgRange = (Math.max(...highs) - Math.min(...lows)) / highs.length;
        const minMove = avgRange * (this.percentage.DEVIATION / 100);
        
        for (let i = 1; i < highs.length - 1; i++) {
            if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) {
                const prevLow = Math.min(...lows.slice(Math.max(0, i-5), i));
                const move = Math.abs(highs[i] - prevLow) / prevLow * 100;
                
                if (move >= this.percentage.DEVIATION) {
                    this.pivots.push({
                        price: highs[i],
                        type: 'high',
                        index: i,
                        strength: move
                    });
                }
            }
            
            if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) {
                const prevHigh = Math.max(...highs.slice(Math.max(0, i-5), i));
                const move = Math.abs(prevHigh - lows[i]) / prevHigh * 100;
                
                if (move >= this.percentage.DEVIATION) {
                    this.pivots.push({
                        price: lows[i],
                        type: 'low',
                        index: i,
                        strength: move
                    });
                }
            }
        }
        
        this.filterClosePivots();
        this.limitPivots();
        
        Logger.zigzag(`📐 Zigzag encontrou ${this.pivots.length} pivôs (desvio ${this.percentage.DEVIATION}%)`);
        
        return this;
    }

    findPivotsWaves(highs, lows) {
        this.pivots = [];
        
        if (highs.length < 10) return this;
        
        let lastPivot = null;
        
        for (let i = 2; i < highs.length - 2; i++) {
            const isHigherHigh = highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
                                highs[i] > highs[i+1] && highs[i] > highs[i+2];
            
            const isLowerLow = lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
                              lows[i] < lows[i+1] && lows[i] < lows[i+2];
            
            if (isHigherHigh) {
                if (!lastPivot || lastPivot.type !== 'high') {
                    const moveFromLow = lastPivot ? 
                        Math.abs(highs[i] - lastPivot.price) / lastPivot.price * 100 : 100;
                    
                    if (moveFromLow >= this.waves.MIN_TREND_PERCENT) {
                        this.pivots.push({
                            price: highs[i],
                            type: 'high',
                            index: i,
                            strength: moveFromLow
                        });
                        lastPivot = this.pivots[this.pivots.length - 1];
                    }
                }
            } else if (isLowerLow) {
                if (!lastPivot || lastPivot.type !== 'low') {
                    const moveFromHigh = lastPivot ? 
                        Math.abs(lastPivot.price - lows[i]) / lastPivot.price * 100 : 100;
                    
                    if (moveFromHigh >= this.waves.MIN_TREND_PERCENT) {
                        this.pivots.push({
                            price: lows[i],
                            type: 'low',
                            index: i,
                            strength: moveFromHigh
                        });
                        lastPivot = this.pivots[this.pivots.length - 1];
                    }
                }
            }
        }
        
        this.filterLargeWaves();
        this.limitPivots();
        
        Logger.zigzag(`📐 Zigzag Waves encontrou ${this.pivots.length} pivôs`);
        
        return this;
    }

    filterClosePivots() {
        if (this.pivots.length < 2) return;
        
        const filtered = [];
        let lastPrice = null;
        
        for (const pivot of this.pivots) {
            if (lastPrice === null) {
                filtered.push(pivot);
                lastPrice = pivot.price;
                continue;
            }
            
            const movePercent = Math.abs(pivot.price - lastPrice) / lastPrice * 100;
            
            if (movePercent >= this.percentage.DEVIATION / 2) {
                filtered.push(pivot);
                lastPrice = pivot.price;
            }
        }
        
        this.pivots = filtered;
    }

    filterLargeWaves() {
        if (this.pivots.length < 2) return;
        
        const filtered = [];
        let lastPivot = null;
        
        for (const pivot of this.pivots) {
            if (lastPivot === null) {
                filtered.push(pivot);
                lastPivot = pivot;
                continue;
            }
            
            const movePercent = Math.abs(pivot.price - lastPivot.price) / lastPivot.price * 100;
            
            if (movePercent <= this.waves.MAX_PRICE_PERCENT * 3) {
                filtered.push(pivot);
                lastPivot = pivot;
            }
        }
        
        this.pivots = filtered;
    }

    limitPivots() {
        if (this.pivots.length > this.maxPivots) {
            this.pivots = this.pivots.slice(-this.maxPivots);
        }
    }

    findPivots(highs, lows) {
        if (this.type === 'PERCENTAGE') {
            return this.findPivotsPercentage(highs, lows);
        } else {
            return this.findPivotsWaves(highs, lows);
        }
    }

    getLastPivots(n = 10) {
        return this.pivots.slice(-Math.min(n, this.pivots.length));
    }
}

// =====================================================================
// === SYMBOL MANAGER ===
// =====================================================================
class SymbolManager {
    constructor() {
        this.validSymbols = new Set();
        this.invalidSymbols = new Set();
    }

    async loadSymbols(limiter) {
        try {
            const response = await limiter.execute(async () => {
                return await axios.get(`${CONFIG.BINANCE.BASE_URL}/fapi/v1/exchangeInfo`);
            });

            this.validSymbols.clear();
            
            response.data.symbols.forEach(s => {
                if (s.contractType === 'PERPETUAL' && s.status === 'TRADING') {
                    if (CONFIG.FILTERS.SKIP_NON_ASCII && !Utils.isAscii(s.symbol)) {
                        return;
                    }
                    this.validSymbols.add(s.symbol);
                }
            });

            Logger.success(`✅ ${this.validSymbols.size} símbolos carregados`);
        } catch (error) {
            Logger.error(`Erro ao carregar símbolos: ${error.message}`);
        }
    }

    isValid(symbol) {
        return this.validSymbols.has(symbol) && !this.invalidSymbols.has(symbol);
    }

    markInvalid(symbol) {
        this.invalidSymbols.add(symbol);
        Logger.warn(`⚠️ ${symbol} marcado como inválido`);
    }
}

// =====================================================================
// === DATA FETCHER ===
// =====================================================================
class DataFetcher {
    constructor(limiter) {
        this.limiter = limiter;
    }

    async getKlines(symbol, interval, limit = 200) {
        return Utils.fetchWithRetry(async () => {
            const response = await this.limiter.execute(async () => {
                return await axios.get(`${CONFIG.BINANCE.BASE_URL}/fapi/v1/klines`, {
                    params: { symbol, interval, limit }
                });
            });
            
            return response.data.map(k => ({
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            })).filter(c => c.high > 0 && c.low > 0);
        });
    }

    async getPrice(symbol) {
        const response = await this.limiter.execute(async () => {
            return await axios.get(`${CONFIG.BINANCE.BASE_URL}/fapi/v1/ticker/price`, {
                params: { symbol }
            });
        });
        return parseFloat(response.data.price);
    }
}

// =====================================================================
// === SCANNER PRINCIPAL CORRIGIDO COM TODOS OS AJUSTES ===
// =====================================================================
class HarmonicScanner {
    constructor(timeframe, limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator, divergenceDetector) {
        this.timeframe = timeframe;
        this.limiter = limiter;
        this.fetcher = fetcher;
        this.symbolManager = symbolManager;
        this.telegram = telegram;
        this.volumeAnalyzer = volumeAnalyzer;
        this.lsrCalculator = lsrCalculator;
        this.atrCalculator = atrCalculator;
        this.liquidityDetector = liquidityDetector;
        this.rsiCalculator = rsiCalculator;
        this.divergenceDetector = divergenceDetector;
        this.zigzag = new Zigzag();
        this.detector = new PatternDetector();
        
        this.patternsDetected = new Map();  // Padrões aguardando entrada
        this.alertsSent = new Map();        // Alertas já enviados
        this.lastVolumeCheck = new Map();
        
        this.stats = { scanned: 0, detected: 0, alerts: 0, errors: 0 };
    }

    determinePriceAction(currentPrice, previousPrice) {
        if (!previousPrice) return null;
        const change = ((currentPrice - previousPrice) / previousPrice) * 100;
        if (change > 0.1) return 'UP';
        if (change < -0.1) return 'DOWN';
        return 'SIDE';
    }

    // Calcula stop loss combinado (ATR + Liquidez)
    calculateCombinedStop(entryPrice, direction, atrStop, liquidityClusters) {
        if (!atrStop) return null;
        
        let finalStop = atrStop;
        
        if (liquidityClusters) {
            if (direction === 'BULLISH' && liquidityClusters.supports.length > 0) {
                // Pega o suporte mais próximo abaixo do preço
                const nearestSupport = liquidityClusters.supports[0].price;
                // Coloca stop 0.5% abaixo do suporte
                const supportStop = nearestSupport * 0.995;
                // Escolhe o stop mais conservador (o mais baixo)
                finalStop = Math.min(atrStop, supportStop);
                Logger.debug(`📊 Stop combinado: ATR $${atrStop.toFixed(2)} | Suporte $${supportStop.toFixed(2)} → Escolhido $${finalStop.toFixed(2)}`);
            } else if (direction === 'BEARISH' && liquidityClusters.resistances.length > 0) {
                // Pega a resistência mais próxima acima do preço
                const nearestResistance = liquidityClusters.resistances[0].price;
                // Coloca stop 0.5% acima da resistência
                const resistanceStop = nearestResistance * 1.005;
                // Escolhe o stop mais conservador (o mais alto)
                finalStop = Math.max(atrStop, resistanceStop);
                Logger.debug(`📊 Stop combinado: ATR $${atrStop.toFixed(2)} | Resistência $${resistanceStop.toFixed(2)} → Escolhido $${finalStop.toFixed(2)}`);
            }
        }
        
        return finalStop;
    }

    async scan(symbol) {
        try {
            this.stats.scanned++;
            
            if (!this.symbolManager.isValid(symbol)) return;

            const interval = this.timeframe === '1H' ? '1h' : '4h';
            const candles = await this.fetcher.getKlines(symbol, interval, 100);
            
            if (!candles || candles.length < 50) {
                this.symbolManager.markInvalid(symbol);
                return;
            }

            const currentPrice = await this.fetcher.getPrice(symbol);
            if (!currentPrice) return;

            // Coleta todos os dados
            const volumeData = await this.volumeAnalyzer.analyzeVolume(symbol, this.fetcher, this.limiter);
            const lsrData = await this.lsrCalculator.calculateLSR(symbol, this.fetcher, this.limiter);
            const atrData = await this.atrCalculator.calculateATR(symbol, this.fetcher, this.limiter);
            const liquidityClusters = await this.liquidityDetector.detectClusters(symbol, this.fetcher, this.limiter);
            const rsiValue = await this.rsiCalculator.getRSI(symbol, this.fetcher, this.limiter);
            const rsiState = this.rsiCalculator.getRSIState(rsiValue);
            const divergences = await this.divergenceDetector.detectDivergences(symbol, this.fetcher, this.limiter);
            
            const prevClose = candles[candles.length - 2]?.close;
            const priceAction = this.determinePriceAction(currentPrice, prevClose);

            // ===== PARTE CORRIGIDA: DETECÇÃO DE PADRÕES COM ZIGZAG =====
            // 1. Calcular pivots com Zigzag
            this.zigzag.findPivots(
                candles.map(c => c.high),
                candles.map(c => c.low)
            );
            
            const pivots = this.zigzag.getLastPivots(CONFIG.ZIGZAG.MAX_PIVOTS);

            // Debug rápido - verifica se tem pivôs suficientes
            if (pivots.length < 5) {
                Logger.debug(`📐 ${symbol} ${this.timeframe}: poucos pivôs (${pivots.length})`);
                return;
            }
            
            Logger.zigzag(`📐 ${symbol} ${this.timeframe}: ${pivots.length} pivôs analisados`);

            // 2. Detectar padrões harmônicos e ABCD
            const patterns = [
                ...this.detector.detectHarmonic(pivots, atrData?.percentage, this.timeframe),
                ...this.detector.detectABCD(pivots, atrData?.percentage, this.timeframe)
            ];

            // 3. Log de quantos padrões foram encontrados
            if (patterns.length > 0) {
                Logger.pattern(`🎯 ${patterns.length} padrões encontrados em ${symbol} ${this.timeframe}`);
            } else {
                Logger.debug(`Nenhum padrão harmônico detectado em ${symbol} ${this.timeframe}`);
            }

            // 4. Registrar padrões recém-detectados
            for (const pattern of patterns) {
                // Chave única: símbolo + tipo + entrada arredondada + timeframe
                const key = `${symbol}_${pattern.type}_${Math.round(pattern.entry * 100)}_${this.timeframe}`;
                
                if (!this.patternsDetected.has(key) && !this.alertsSent.has(key)) {
                    this.patternsDetected.set(key, {
                        ...pattern,
                        symbol,
                        timeframe: this.timeframe,
                        detectedAt: Date.now()
                    });
                    
                    Logger.pattern(`🎯 NOVO ${pattern.type} ${pattern.direction} → ${symbol} ${this.timeframe}`);
                    Logger.pattern(`   Entrada: $${Utils.formatPrice(pattern.entry)} | Alvo: $${Utils.formatPrice(pattern.target)}`);
                    this.stats.detected++;
                }
            }

            // 5. Verificar se preço está na zona de entrada de algum padrão detectado
            const toRemove = [];
            
            // Define tolerância baseada no timeframe
            const entryTolerance = CONFIG.PATTERNS.ENTRY_TOLERANCE[this.timeframe] || 0.012;
            
            for (const [key, pattern] of this.patternsDetected.entries()) {
                // Só processa padrões do mesmo timeframe
                if (pattern.timeframe !== this.timeframe) continue;
                
                const priceDiff = Math.abs(currentPrice - pattern.entry) / pattern.entry;
                
                // Tolerância ajustada por timeframe
                if (priceDiff <= entryTolerance) {
                    const targetDist = pattern.direction === 'BULLISH'
                        ? ((pattern.target - currentPrice) / currentPrice * 100).toFixed(1)
                        : ((currentPrice - pattern.target) / currentPrice * 100).toFixed(1);
                    
                    // Verifica volume compatível para 3 minutos
                    let hasValidVolume = false;
                    const volumeType3m = this.getVolumeType(volumeData?.['3m'], pattern.direction);
                    
                    if (pattern.direction === 'BULLISH' && volumeData?.['3m']?.isAbnormal && volumeData['3m'].multiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD) {
                        hasValidVolume = true;
                        Logger.volume(`🔥 Volume 3m COMPRADOR anormal confirmado: ${volumeData['3m'].multiple.toFixed(1)}x`);
                    } else if (pattern.direction === 'BEARISH' && volumeData?.['3m']?.isAbnormal && volumeData['3m'].multiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD) {
                        hasValidVolume = true;
                        Logger.volume(`🔥 Volume 3m VENDEDOR anormal confirmado: ${volumeData['3m'].multiple.toFixed(1)}x`);
                    }
                    
                    if (!hasValidVolume) {
                        if (volumeData?.['3m']?.isAbnormal) {
                            Logger.volume(`⏭️ Ignorando ${pattern.type} ${symbol}: volume 3m anormal mas direção incompatível`);
                        } else {
                            Logger.volume(`⏭️ Ignorando ${pattern.type} ${symbol}: volume 3m normal (${volumeData?.['3m']?.multiple.toFixed(1) || '0'}x)`);
                        }
                        continue;
                    }
                    
                    // Calcula stop-loss baseado em ATR
                    let atrStop = null;
                    let stopPercent = null;
                    if (atrData) {
                        atrStop = this.atrCalculator.calculateStopPrice(currentPrice, pattern.direction, atrData);
                        stopPercent = atrData.stopPercentage?.toFixed(1);
                    }
                    
                    // Calcula stop combinado (ATR + Liquidez)
                    const finalStop = this.calculateCombinedStop(currentPrice, pattern.direction, atrStop, liquidityClusters);
                    
                    if (finalStop) {
                        Logger.stop(`🛑 Stop final: $${Utils.formatPrice(finalStop)} (${stopPercent}%)`);
                    }
                    
                    // Envia alerta
                    const msg = this.formatAlert(
                        pattern,
                        symbol,
                        currentPrice,
                        targetDist,
                        volumeData,
                        hasValidVolume,
                        lsrData,
                        atrData,
                        finalStop,
                        liquidityClusters,
                        rsiValue,
                        rsiState,
                        volumeType3m,
                        entryTolerance * 100,
                        divergences
                    );
                    
                    await this.telegram.send(msg);
                    
                    Logger.success(`🚨 ALERTA ENVIADO: ${pattern.type} ${symbol} @ $${Utils.formatPrice(currentPrice)} | Alvo: $${Utils.formatPrice(pattern.target)} (${targetDist}%) | Tolerância: ${(entryTolerance*100).toFixed(1)}%`);
                    
                    this.alertsSent.set(key, { alertedAt: Date.now() });
                    toRemove.push(key);
                    this.stats.alerts++;
                }
                
                // Limpa padrões antigos (> 8 horas)
                if (Date.now() - pattern.detectedAt > 8 * 60 * 60 * 1000) {
                    toRemove.push(key);
                }
            }

            // Remove os padrões processados ou expirados
            toRemove.forEach(key => this.patternsDetected.delete(key));
            
        } catch (error) {
            this.stats.errors++;
            if (error.response?.status === 400) {
                this.symbolManager.markInvalid(symbol);
            }
            Logger.debug(`Erro scan ${symbol}: ${error.message}`);
        }
    }

    getVolumeType(volumeData, direction) {
        if (!volumeData || !volumeData.isAbnormal) return 'NORMAL';
        
        const multiple = volumeData.multiple;
        
        if (direction === 'BULLISH') {
            if (multiple >= 2.5) return 'COMPRADOR FORTE 🔥🔥 🔥';
            if (multiple >= 1.8) return 'COMPRADOR FORTE 🔥🔥';
            return 'COMPRADOR 🔥';
        }
        
        if (direction === 'BEARISH') {
            if (multiple >= 2.5) return 'VENDEDOR FORTE 💥💥 💥';
            if (multiple >= 1.8) return 'VENDEDOR FORTE 💥💥';
            return 'VENDEDOR 💥';
        }
        
        return 'NORMAL';
    }

    formatAlert(pattern, symbol, price, targetDist, volumeData, hasValidVolume, lsrData, atrData, finalStop, liquidityClusters, rsiValue, rsiState, volumeType3m, toleranceUsed, divergences) {
        const emoji = pattern.direction === 'BULLISH' ? '🟢' : '🔴';
        const targetEmoji = pattern.direction === 'BULLISH' ? '📈' : '📉';
        const stopEmoji = pattern.direction === 'BULLISH' ? '🛑' : '⛔';
        
        // Link do TradingView (não aparece na mensagem, apenas como link clicável)
        const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol}PERP&interval=60`;
        
        // Formata data e hora completas
        const dateStr = Utils.getBrazilianDate();
        const timeStr = Utils.getBrazilianTime();
        
        // Informações de LSR
        let lsrInfo = ` LSR: ${lsrData?.rawRatio || '---'}`;
        
        // Informações de volume para cada timeframe
        let volumeInfo = '';
        if (volumeData) {
            if (volumeData['3m']) {
                const v3m = volumeData['3m'];
                volumeInfo += ` Vol 3m: ${Utils.formatVolume(v3m.currentVolume)} (${v3m.multiple.toFixed(1)}x) | ${volumeType3m}\n`;
            }
            if (volumeData['1h']) {
                const v1h = volumeData['1h'];
                const direction1h = this.volumeAnalyzer.getVolumeDirectionText(v1h.direction);
                volumeInfo += ` Vol 1h: ${v1h.volumePercent > 0 ? '+' : ''}${v1h.volumePercent.toFixed(0)}% ${direction1h}\n`;
            }
            if (volumeData['24h']) {
                const v24h = volumeData['24h'];
                const direction24h = this.volumeAnalyzer.getVolumeDirectionText(v24h.direction);
                volumeInfo += ` vol 24hs: ${v24h.volumePercent > 0 ? '+' : ''}${v24h.volumePercent.toFixed(0)}% ${direction24h}\n`;
            }
        } else {
            volumeInfo = ' Vol 3m: ---\n Vol 1h: ---\n vol 24hs: ---\n';
        }
        
        // RSI
        let rsiInfo = ` RSI 1h: ${rsiValue !== null ? rsiValue.toFixed(2) : '---'}\n`;
        
        // Divergências
        let divergenceInfo = '';
        if (divergences && divergences.divergences.length > 0) {
            const bullDivs = divergences.divergences.filter(d => d.type === 'BULL').map(d => d.timeframe).join(', ');
            const bearDivs = divergences.divergences.filter(d => d.type === 'BEAR').map(d => d.timeframe).join(', ');
            
            if (bullDivs) divergenceInfo += ` Divergências: Bull ${bullDivs}`;
            if (bearDivs) {
                if (divergenceInfo) divergenceInfo += ' | ';
                divergenceInfo += `Bear ${bearDivs}`;
            }
            divergenceInfo += '\n';
        } else {
            divergenceInfo = ' Divergências: ---\n';
        }
        
        // Níveis importantes
        let liquidityInfo = '';
        if (liquidityClusters && (liquidityClusters.supports.length > 0 || liquidityClusters.resistances.length > 0)) {
            liquidityInfo = ' <i>Níveis Importantes:</i>\n';
            
            if (liquidityClusters.supports.length > 0) {
                const supportsList = liquidityClusters.supports.map(s => 
                    `$${Utils.formatPrice(s.price)} (${s.strength}x)`
                );
                liquidityInfo += '  Suporte: ' + supportsList.join(' | ') + '\n';
            }
            
            if (liquidityClusters.resistances.length > 0) {
                const resistancesList = liquidityClusters.resistances.map(r => 
                    `$${Utils.formatPrice(r.price)} (${r.strength}x)`
                );
                liquidityInfo += '  Resistência: ' + resistancesList.join(' | ');
            }
        }
        
        // Stop loss
        let stopInfo = '';
        if (atrData && finalStop) {
            const stopPercent = atrData.stopPercentage.toFixed(1);
            stopInfo = `\n ${stopEmoji} Stop: $${Utils.formatPrice(finalStop)} (${stopPercent}%)`;
        }
        
        // Monta mensagem final
        return `
${emoji} 🔍<i>Operação</i> ${emoji} <a href="${tradingViewLink}">🔗 TradingView</a>
 
<i>${symbol}</i> | ${pattern.direction} 🔹 ${lsrInfo}
 <i>Preço: $${Utils.formatPrice(price)}</i>
 <i>Alerta: ${dateStr} | ${timeStr}hs</i>
 🤖<i>IA Análise:</i>
 <i>Entrada: $${Utils.formatPrice(pattern.entry)} (tol. ${toleranceUsed.toFixed(1)}%)</i>
 <i>${targetEmoji} Alvo: $${Utils.formatPrice(pattern.target)} (${targetDist}%)${stopInfo}</i>
<i>Padrão: ${pattern.type} ${this.timeframe}</i>
 ${volumeInfo}${rsiInfo}${divergenceInfo}${liquidityInfo}

<i>Titanium Harmonic by J4Rviz</i>`;
    }

    getStats() {
        return this.stats;
    }
}

// =====================================================================
// === MAIN ===
// =====================================================================
async function main() {
    console.log('\n🚀 SCANNER HARMÔNICO CORRIGIDO - v4.0');
    console.log('='.repeat(70));
    console.log(`📊 Configurações:`);
    console.log(`   • Zigzag: ${CONFIG.ZIGZAG.TYPE} (${CONFIG.ZIGZAG.PERCENTAGE.DEVIATION}% desvio)`);
    console.log(`   • Tolerância dinâmica: ${(CONFIG.PATTERNS.DYNAMIC_TOLERANCE.MIN*100).toFixed(0)}-${(CONFIG.PATTERNS.DYNAMIC_TOLERANCE.MAX*100).toFixed(0)}%`);
    console.log(`   • Tolerância entrada: 1H ${(CONFIG.PATTERNS.ENTRY_TOLERANCE['1H']*100).toFixed(1)}% | 4H ${(CONFIG.PATTERNS.ENTRY_TOLERANCE['4H']*100).toFixed(1)}%`);
    console.log(`   • Volume anormal: ${CONFIG.VOLUME.ABNORMAL_THRESHOLD}x (Média 9)`);
    console.log(`   • Timeframes volume: 3m, 1h, 24h`);
    console.log(`   • Divergências: 15m, 1h, 2h, 4h, 1d`);
    console.log(`   • Stop ATR: ${CONFIG.ATR.MULTIPLIER}x + Liquidez`);
    console.log('='.repeat(70));
    
    const limiter = new RateLimiter(150);
    const fetcher = new DataFetcher(limiter);
    const symbolManager = new SymbolManager();
    const telegram = new TelegramSender(CONFIG.TELEGRAM.BOT_TOKEN, CONFIG.TELEGRAM.CHAT_ID);
    const volumeAnalyzer = new VolumeAnalyzer();
    const lsrCalculator = new LSRCalculator();
    const atrCalculator = new ATRCalculator();
    const liquidityDetector = new LiquidityClusterDetector();
    const rsiCalculator = new RSICalculator();
    const divergenceDetector = new DivergenceDetector();
    
    await symbolManager.loadSymbols(limiter);
    
    const scanner1h = new HarmonicScanner('1H', limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator, divergenceDetector);
    const scanner4h = new HarmonicScanner('4H', limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator, divergenceDetector);
    
    await telegram.send(`
<b>🤖 Titanium Scanner v4.0</b>

 <b>Configurações:</b>
 • ${symbolManager.validSymbols.size} pares válidos
 • Zigzag: ${CONFIG.ZIGZAG.PERCENTAGE.DEVIATION}% desvio
 • Tolerância entrada: 1H ${(CONFIG.PATTERNS.ENTRY_TOLERANCE['1H']*100).toFixed(1)}% | 4H ${(CONFIG.PATTERNS.ENTRY_TOLERANCE['4H']*100).toFixed(1)}%
 • Volume: ${CONFIG.VOLUME.ABNORMAL_THRESHOLD}x (Média 9) em 3m, 1h, 24h
 • Divergências: 15m, 1h, 2h, 4h, 1d
 • Stop: ATR ${CONFIG.ATR.MULTIPLIER}x + Liquidez

⏰ ${Utils.getBrazilianTime()}
    `);
    
    let scanCount = 0;
    let lastStatsTime = Date.now();
    
    while (true) {
        scanCount++;
        Logger.info(`\n🔄 Scan #${scanCount} - ${Utils.getBrazilianTime()}`);
        
        const allSymbols = Array.from(symbolManager.validSymbols);
        
        Logger.info(`\n⏰ 1H (${allSymbols.length} símbolos)...`);
        for (let i = 0; i < allSymbols.length; i += 10) {
            const batch = allSymbols.slice(i, i + 10);
            await Promise.all(batch.map(s => scanner1h.scan(s)));
            
            if (i % 50 === 0) {
                const percent = ((i + 5) / allSymbols.length * 100).toFixed(1);
                Logger.info(`   Progresso: ${Math.min(i + 5, allSymbols.length)}/${allSymbols.length} (${percent}%)`);
            }
            
            await Utils.sleep(200);
        }
        
        Logger.info(`\n⏰ 4H (${allSymbols.length} símbolos)...`);
        for (let i = 0; i < allSymbols.length; i += 10) {
            const batch = allSymbols.slice(i, i + 10);
            await Promise.all(batch.map(s => scanner4h.scan(s)));
            
            if (i % 50 === 0) {
                const percent = ((i + 5) / allSymbols.length * 100).toFixed(1);
                Logger.info(`   Progresso: ${Math.min(i + 5, allSymbols.length)}/${allSymbols.length} (${percent}%)`);
            }
            
            await Utils.sleep(200);
        }
        
        if (scanCount % 6 === 0) {
            const runtime = ((Date.now() - lastStatsTime) / 1000 / 60).toFixed(0);
            Logger.info(`\n📊 ESTATÍSTICAS (${runtime}min):`);
            Logger.info(`   1H - Detectados: ${scanner1h.getStats().detected} | Alertas: ${scanner1h.getStats().alerts}`);
            Logger.info(`   4H - Detectados: ${scanner4h.getStats().detected} | Alertas: ${scanner4h.getStats().alerts}`);
            Logger.info(`   Total erros: ${scanner1h.getStats().errors + scanner4h.getStats().errors}`);
            lastStatsTime = Date.now();
        }
        
        Logger.info(`\n⏱️  Aguardando 5 minutos...`);
        await Utils.sleep(CONFIG.SCAN_INTERVAL);
    }
}

// Tratamento de erros
process.on('uncaughtException', (error) => {
    Logger.error(`Erro fatal: ${error.message}`);
    console.error(error);
});

process.on('SIGINT', () => {
    Logger.info('\n👋 Encerrando...');
    process.exit(0);
});

main();
