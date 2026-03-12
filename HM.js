const axios = require('axios');
const fs = require('fs');
const path = require('path');

// =====================================================================
// === CONFIGURAÇÕES MÍNIMAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979',
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
        TOLERANCE: 0.03,
        HARMONIC: {
            GARTLEY: { 
                bull: { XA: 0.618, AB: [0.382, 0.886], BC: [1.130, 1.270] },
                bear: { XA: 0.618, AB: [0.382, 0.886], BC: [1.130, 1.270] }
            },
            BAT: { 
                bull: { XA: [0.382, 0.500], AB: [0.382, 0.886], BC: [1.618, 2.240] },
                bear: { XA: [0.382, 0.500], AB: [0.382, 0.886], BC: [1.618, 2.240] }
            },
            BUTTERFLY: { 
                bull: { XA: 0.786, AB: [0.382, 0.886], BC: [1.270, 1.414] },
                bear: { XA: 0.786, AB: [0.382, 0.886], BC: [1.270, 1.414] }
            },
            CRAB: { 
                bull: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.240, 3.618] },
                bear: { XA: [0.382, 0.618], AB: [0.382, 0.886], BC: [2.240, 3.618] }
            }
        }
    },
    VOLUME: {
        ABNORMAL_THRESHOLD: 1.4,
        CHECK_MINUTES: 3
    },
    ATR: {
        PERIOD: 14,
        MULTIPLIER: 2.5,
        TIMEFRAME: '1h'
    },
    LIQUIDITY: {
        LOOKBACK_CANDLES: 100,
        CLUSTER_THRESHOLD: 0.01, 
        MIN_CLUSTER_TOUCHES: 3
    },
    RSI: {
        PERIOD: 14,
        TIMEFRAME: '1h'
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
    rsi: (msg) => Logger.log('📈', msg)
};

// =====================================================================
// === UTILITÁRIOS ===
// =====================================================================
const Utils = {
    getBrazilianTime() {
        return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
                await Utils.sleep(1000 * Math.pow(2, i));
            }
        }
    }
};

// =====================================================================
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor(minDelay = 100) {
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
                parse_mode: 'HTML'
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
// === RSI CALCULATOR (Cálculo idêntico ao TradingView) ===
// =====================================================================
class RSICalculator {
    constructor() {
        this.rsiCache = new Map();
    }

    // Implementação exata do RSI do TradingView/Pine Script
    calculateRSI(prices, period = CONFIG.RSI.PERIOD) {
        if (prices.length < period + 1) return null;

        // Calcular mudanças (change)
        const changes = [];
        for (let i = 1; i < prices.length; i++) {
            changes.push(prices[i] - prices[i - 1]);
        }

        // Inicializar médias
        let avgGain = 0;
        let avgLoss = 0;
        
        // Primeiro cálculo SMA
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

        // RMA (Wilder's Smoothing) - igual ao TradingView
        const rma = (prev, current, period) => {
            return (prev * (period - 1) + current) / period;
        };

        // Calcular para todos os valores
        const rsiValues = [];
        
        // Primeiro RSI
        if (avgLoss === 0) {
            rsiValues.push(100);
        } else {
            const rs = avgGain / avgLoss;
            rsiValues.push(100 - (100 / (1 + rs)));
        }

        // Calcular RMA para os períodos seguintes
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

    async getRSI(symbol, fetcher, limiter) {
        try {
            const cached = this.rsiCache.get(symbol);
            if (cached && Date.now() - cached.timestamp < 300000) { // Cache de 5 minutos
                return cached.value;
            }

            // Buscar candles para o timeframe 1h
            const candles = await fetcher.getKlines(symbol, CONFIG.RSI.TIMEFRAME, CONFIG.RSI.PERIOD + 50);
            if (!candles || candles.length < CONFIG.RSI.PERIOD + 1) return null;

            const prices = candles.map(c => c.close);
            const rsiValue = this.calculateRSI(prices, CONFIG.RSI.PERIOD);

            if (rsiValue !== null) {
                this.rsiCache.set(symbol, {
                    value: rsiValue,
                    timestamp: Date.now()
                });
                
                Logger.rsi(`📈 RSI ${symbol} 1h: ${rsiValue.toFixed(2)}`);
            }

            return rsiValue;

        } catch (error) {
            Logger.debug(`Erro RSI ${symbol}: ${error.message}`);
            return null;
        }
    }

    getRSIState(rsi) {
        if (rsi === null) return '---';
        if (rsi > 70) return 'SOBRECOMPRADO 🔴';
        if (rsi < 30) return 'SOBREVENDIDO 🟢';
        if (rsi > 60) return 'COMPRADOR 📈';
        if (rsi < 40) return 'VENDEDOR 📉';
        return 'NEUTRO ⚪';
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
            if (cached && Date.now() - cached.timestamp < 3600000) { // Cache de 1 hora
                return cached.value;
            }

            // Buscar candles para identificar clusters de liquidez
            const candles = await fetcher.getKlines(symbol, '1h', CONFIG.LIQUIDITY.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) return null;

            // Mapear pontos de liquidez (máximas e mínimas)
            const liquidityPoints = [];
            
            for (let i = 1; i < candles.length - 1; i++) {
                // Máximas (resistência)
                if (candles[i].high > candles[i-1].high && candles[i].high > candles[i+1].high) {
                    liquidityPoints.push({
                        price: candles[i].high,
                        type: 'RESISTANCE',
                        strength: 1
                    });
                }
                
                // Mínimas (suporte)
                if (candles[i].low < candles[i-1].low && candles[i].low < candles[i+1].low) {
                    liquidityPoints.push({
                        price: candles[i].low,
                        type: 'SUPPORT',
                        strength: 1
                    });
                }
            }

            // Agrupar em clusters baseados em proximidade
            const clusters = [];
            const threshold = candles[candles.length - 1].close * CONFIG.LIQUIDITY.CLUSTER_THRESHOLD;

            for (const point of liquidityPoints) {
                let found = false;
                
                for (const cluster of clusters) {
                    if (Math.abs(cluster.avgPrice - point.price) <= threshold) {
                        cluster.points.push(point);
                        cluster.avgPrice = cluster.points.reduce((sum, p) => sum + p.price, 0) / cluster.points.length;
                        cluster.strength++;
                        cluster.type = point.type; // Atualiza com o tipo mais recente (pode ser refinado)
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

            // Filtrar clusters com força mínima e ordenar
            const significantClusters = clusters
                .filter(c => c.strength >= CONFIG.LIQUIDITY.MIN_CLUSTER_TOUCHES)
                .sort((a, b) => b.strength - a.strength);

            // Separar suportes e resistências
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

            // Log dos clusters encontrados
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

            Logger.debug(`📊 ATR ${symbol}: $${atr.toFixed(2)} (${atrPercentage.toFixed(2)}%) | Stop: ${(atrPercentage * CONFIG.ATR.MULTIPLIER).toFixed(2)}%`);

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
// === VOLUME ANALYZER ===
// =====================================================================
class VolumeAnalyzer {
    constructor() {
        this.volumeHistory = new Map();
    }

    async analyzeVolume(symbol, fetcher, limiter) {
        try {
            const candles = await fetcher.getKlines(symbol, '1m', 10);
            if (!candles || candles.length < 5) return null;

            const volumes = candles.map(c => c.volume);
            const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const lastVolume = volumes[volumes.length - 1];
            const volumeMultiple = avgVolume > 0 ? lastVolume / avgVolume : 0;
            const isAbnormal = volumeMultiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD;
            
            if (!this.volumeHistory.has(symbol)) {
                this.volumeHistory.set(symbol, []);
            }
            
            const history = this.volumeHistory.get(symbol);
            history.push({
                timestamp: Date.now(),
                volume: lastVolume,
                multiple: volumeMultiple,
                isAbnormal
            });
            
            if (history.length > 50) history.shift();
            
            return {
                currentVolume: lastVolume,
                avgVolume,
                multiple: volumeMultiple,
                isAbnormal,
                direction: this.determineVolumeDirection(history)
            };
            
        } catch (error) {
            Logger.debug(`Erro análise volume ${symbol}: ${error.message}`);
            return null;
        }
    }

    determineVolumeDirection(history) {
        if (history.length < 3) return null;
        
        const recent = history.slice(-3);
        const increasing = recent.every((v, i) => i === 0 || v.volume >= recent[i-1].volume);
        const decreasing = recent.every((v, i) => i === 0 || v.volume <= recent[i-1].volume);
        
        if (increasing) return 'AUMENTANDO';
        if (decreasing) return 'DIMINUINDO';
        return 'ESTÁVEL';
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
            
            Logger.debug(`📊 LSR real ${symbol}: ${lsrValue.toFixed(0)} (${lsrData.longShortRatio.toFixed(2)} ratio)`);
            
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
// === DETECTOR DE PADRÕES ===
// =====================================================================
class PatternDetector {
    matchRatio(value, target) {
        if (Array.isArray(target)) {
            return value >= target[0] && value <= target[1];
        }
        return Math.abs(value - target) <= CONFIG.PATTERNS.TOLERANCE;
    }

    detectHarmonic(pivots) {
        if (!pivots || pivots.length < 5) return [];
        
        const patterns = [];
        
        for (let i = 0; i <= pivots.length - 5; i++) {
            const types = pivots.slice(i, i + 5).map(p => p.type);
            if (!types.every((t, idx) => idx === 0 || t !== types[idx-1])) continue;
            
            const [x, a, b, c, d] = pivots.slice(i, i + 5);
            if (!x || !a || !b || !c || !d) continue;
            
            const direction = a.price < x.price ? 'BULLISH' : 'BEARISH';
            const key = direction === 'BULLISH' ? 'bull' : 'bear';
            
            const ratios = Utils.calculateRatios([x.price, a.price, b.price, c.price, d.price]);
            
            for (const [name, config] of Object.entries(CONFIG.PATTERNS.HARMONIC)) {
                const pattern = config[key];
                if (!pattern) continue;
                
                const matchXA = pattern.XA ? this.matchRatio(ratios.AB_XA, pattern.XA) : true;
                const matchAB = pattern.AB ? this.matchRatio(ratios.BC_AB, pattern.AB) : true;
                const matchBC = pattern.BC ? this.matchRatio(ratios.CD_BC, pattern.BC) : true;
                
                if (matchXA && matchAB && matchBC) {
                    const moveBC = Math.abs(c.price - b.price);
                    
                    const target = direction === 'BULLISH' 
                        ? d.price + (moveBC * 1.618)
                        : d.price - (moveBC * 1.618);
                    
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

    detectABCD(pivots) {
        if (!pivots || pivots.length < 4) return [];
        
        const patterns = [];
        
        for (let i = 0; i <= pivots.length - 4; i++) {
            const types = pivots.slice(i, i + 4).map(p => p.type);
            if (!types.every((t, idx) => idx === 0 || t !== types[idx-1])) continue;
            
            const [a, b, c, d] = pivots.slice(i, i + 4);
            if (!a || !b || !c || !d) continue;
            
            const moveAB = Math.abs(b.price - a.price);
            const moveBC = Math.abs(c.price - b.price);
            
            if (moveAB === 0 || moveBC === 0) continue;
            
            const ratioAB = moveBC / moveAB;
            
            let direction = null;
            if (a.price < b.price && c.price < b.price && d.price > c.price) {
                direction = 'BULLISH';
            } else if (a.price > b.price && c.price > b.price && d.price < c.price) {
                direction = 'BEARISH';
            } else {
                continue;
            }
            
            if (ratioAB >= 0.382 && ratioAB <= 0.886) {
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
// === ZIGZAG SIMPLES ===
// =====================================================================
class Zigzag {
    constructor(period = 12) {
        this.period = period;
        this.pivots = [];
    }

    findPivots(highs, lows) {
        this.pivots = [];
        const half = Math.floor(this.period / 2);
        
        for (let i = half; i < highs.length - half; i++) {
            let isHigh = true, isLow = true;
            
            for (let j = i - half; j <= i + half; j++) {
                if (highs[j] > highs[i]) isHigh = false;
                if (lows[j] < lows[i]) isLow = false;
            }
            
            if (isHigh) {
                this.pivots.push({ price: highs[i], type: 'high' });
            } else if (isLow) {
                this.pivots.push({ price: lows[i], type: 'low' });
            }
        }
        
        return this;
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
                        Logger.info(`⏭️ Ignorando: ${s.symbol}`);
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
// === SCANNER PRINCIPAL ===
// =====================================================================
class HarmonicScanner {
    constructor(timeframe, limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator) {
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
        this.zigzag = new Zigzag(12);
        this.detector = new PatternDetector();
        
        this.patternsDetected = new Map();
        this.alertsSent = new Map();
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

    async scan(symbol) {
        try {
            this.stats.scanned++;
            
            if (!this.symbolManager.isValid(symbol)) return;

            const candles = await this.fetcher.getKlines(symbol, 
                this.timeframe === '1H' ? '1h' : '4h'
            );
            
            if (!candles || candles.length < 50) {
                this.symbolManager.markInvalid(symbol);
                return;
            }

            const currentPrice = await this.fetcher.getPrice(symbol);
            if (!currentPrice) return;

            // Análise de volume
            const volumeData = await this.volumeAnalyzer.analyzeVolume(symbol, this.fetcher, this.limiter);
            
            // Calcular LSR REAL da Binance
            const lsrData = await this.lsrCalculator.calculateLSR(symbol, this.fetcher, this.limiter);
            
            // Calcular ATR adaptativo para o símbolo
            const atrData = await this.atrCalculator.calculateATR(symbol, this.fetcher, this.limiter);
            
            // Detectar clusters de liquidez (Suporte/Resistência)
            const liquidityClusters = await this.liquidityDetector.detectClusters(symbol, this.fetcher, this.limiter);
            
            // Calcular RSI 1h (cálculo exato do TradingView)
            const rsiValue = await this.rsiCalculator.getRSI(symbol, this.fetcher, this.limiter);
            const rsiState = this.rsiCalculator.getRSIState(rsiValue);
            
            // Determinar ação do preço
            const prevClose = candles[candles.length - 2]?.close;
            const priceAction = this.determinePriceAction(currentPrice, prevClose);

            // Verificar volume anormal para alertas
            const isAbnormalBuyer = volumeData && 
                                    volumeData.isAbnormal && 
                                    priceAction === 'UP' &&
                                    volumeData.direction === 'AUMENTANDO' &&
                                    volumeData.multiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD;

            const isAbnormalSeller = volumeData && 
                                     volumeData.isAbnormal && 
                                     priceAction === 'DOWN' &&
                                     volumeData.direction === 'AUMENTANDO' &&
                                     volumeData.multiple >= CONFIG.VOLUME.ABNORMAL_THRESHOLD;

            // Log de volume anormal
            if (volumeData?.isAbnormal) {
                const direction = priceAction === 'UP' ? 'COMPRADOR' : priceAction === 'DOWN' ? 'VENDEDOR' : 'NEUTRO';
                Logger.volume(`📊 ${symbol} Volume ${direction}: ${volumeData.multiple.toFixed(1)}x média (${Utils.formatVolume(volumeData.currentVolume)})`);
            }

            this.zigzag.findPivots(
                candles.map(c => c.high),
                candles.map(c => c.low)
            );
            
            const pivots = this.zigzag.getLastPivots(15);
            
            const patterns = [
                ...this.detector.detectHarmonic(pivots),
                ...this.detector.detectABCD(pivots)
            ];
            
            for (const pattern of patterns) {
                const key = `${symbol}_${pattern.type}_${this.timeframe}`;
                const now = Date.now();
                
                if (this.alertsSent.has(key)) continue;
                
                if (!this.patternsDetected.has(key)) {
                    this.patternsDetected.set(key, {
                        entryPrice: pattern.entry,
                        targetPrice: pattern.target,
                        direction: pattern.direction,
                        points: pattern.points,
                        type: pattern.type,
                        detectedAt: now
                    });
                    this.stats.detected++;
                    Logger.info(`📐 ${pattern.type} ${symbol} - Entrada: $${Utils.formatPrice(pattern.entry)} | Target: $${Utils.formatPrice(pattern.target)}`);
                    continue;
                }
                
                const detected = this.patternsDetected.get(key);
                const priceDiff = Math.abs(currentPrice - detected.entryPrice) / detected.entryPrice;
                const isAtEntry = priceDiff <= 0.001;
                
                if (isAtEntry) {
                    const targetDist = detected.direction === 'BULLISH'
                        ? ((detected.targetPrice - currentPrice) / currentPrice * 100).toFixed(1)
                        : ((currentPrice - detected.targetPrice) / currentPrice * 100).toFixed(1);
                    
                    // VERIFICAÇÃO DE VOLUME - SÓ ALERTA SE VOLUME ANORMAL COMPATÍVEL COM A DIREÇÃO
                    let hasValidAbnormalVolume = false;
                    
                    if (detected.direction === 'BULLISH' && isAbnormalBuyer) {
                        hasValidAbnormalVolume = true;
                        Logger.volume(`🔥 Volume COMPRADOR anormal confirmado para entrada BULLISH!`);
                    } else if (detected.direction === 'BEARISH' && isAbnormalSeller) {
                        hasValidAbnormalVolume = true;
                        Logger.volume(`🔥 Volume VENDEDOR anormal confirmado para entrada BEARISH!`);
                    } else {
                        // Volume normal ou anormal incompatível - NÃO ENVIA ALERTA
                        if (volumeData?.isAbnormal) {
                            Logger.volume(`⏭️ Ignorando alerta: Volume anormal mas direção incompatível (${detected.direction} vs ${priceAction === 'UP' ? 'COMPRADOR' : 'VENDEDOR'})`);
                        } else {
                            Logger.volume(`⏭️ Ignorando alerta: Volume normal (${volumeData?.multiple.toFixed(1) || '0'}x) - Necessário ${CONFIG.VOLUME.ABNORMAL_THRESHOLD}x`);
                        }
                        continue; // PULA O ALERTA
                    }
                    
                    // Calcular stop baseado no ATR
                    let stopPrice = null;
                    let stopPercentage = null;
                    
                    if (atrData) {
                        stopPrice = this.atrCalculator.calculateStopPrice(currentPrice, detected.direction, atrData);
                        stopPercentage = atrData.stopPercentage;
                        Logger.stop(`🛑 Stop ATR ${symbol}: $${Utils.formatPrice(stopPrice)} (${stopPercentage.toFixed(1)}%)`);
                    }
                    
                    const msg = this.formatAlert(
                        detected, 
                        symbol, 
                        currentPrice, 
                        targetDist, 
                        volumeData, 
                        hasValidAbnormalVolume,
                        lsrData,
                        atrData,
                        stopPrice,
                        liquidityClusters,
                        rsiValue,
                        rsiState
                    );
                    
                    await this.telegram.send(msg);
                    
                    Logger.pattern(`🚨 ${pattern.type} ${symbol} - Entrada: $${Utils.formatPrice(currentPrice)} | Alvo: $${Utils.formatPrice(detected.targetPrice)} (${targetDist}%) | Stop: $${stopPrice ? Utils.formatPrice(stopPrice) : '---'} (${stopPercentage ? stopPercentage.toFixed(1) : '---'}%)`);
                    
                    if (hasValidAbnormalVolume) {
                        Logger.volume(`🔥 Volume anormal ${detected.direction === 'BULLISH' ? 'COMPRADOR' : 'VENDEDOR'} confirmado!`);
                    }
                    
                    if (liquidityClusters) {
                        Logger.liquidity(`💧 Clusters: ${liquidityClusters.supports.length} Sup | ${liquidityClusters.resistances.length} Res`);
                    }
                    
                    if (rsiValue) {
                        Logger.rsi(`📈 RSI 1h: ${rsiValue.toFixed(2)} - ${rsiState}`);
                    }
                    
                    this.alertsSent.set(key, { alertedAt: now });
                    this.patternsDetected.delete(key);
                    this.stats.alerts++;
                }
            }
            
        } catch (error) {
            this.stats.errors++;
            if (error.response?.status === 400) {
                this.symbolManager.markInvalid(symbol);
            }
        }
    }

    formatAlert(pattern, symbol, price, targetDist, volumeData, hasValidAbnormalVolume, lsrData, atrData, stopPrice, liquidityClusters, rsiValue, rsiState) {
        const emoji = pattern.direction === 'BULLISH' ? '🟢' : '🔴';
        const targetEmoji = pattern.direction === 'BULLISH' ? '📈' : '📉';
        const stopEmoji = pattern.direction === 'BULLISH' ? '🛑' : '⛔';
        
        // Volume info
        const volumeInfo = volumeData ? 
            `${hasValidAbnormalVolume ? '🔥' : ''} Volume: ${Utils.formatVolume(volumeData.currentVolume)} (${volumeData.multiple.toFixed(1)}x)` :
            ' Volume: ---';
        
        const volumeType = hasValidAbnormalVolume ? 
            (pattern.direction === 'BULLISH' ? 'COMPRADOR' : 'VENDEDOR') : 
            'NORMAL';
        
        // LSR info
        let lsrInfo = ` LSR: ---`;
        if (lsrData) {
            lsrInfo = ` LSR: ${lsrData.rawRatio}`;
        }
        
        // RSI info
        let rsiInfo = ` RSI 1h: ---`;
        if (rsiValue !== null) {
            rsiInfo = ` RSI 1h: ${rsiValue.toFixed(2)} (${rsiState})`;
        }
        
        // Liquidity Clusters info
        let liquidityInfo = '';
        if (liquidityClusters && (liquidityClusters.supports.length > 0 || liquidityClusters.resistances.length > 0)) {
            liquidityInfo = '\n <b>Níveis Importantes:</b>';
            
            if (liquidityClusters.supports.length > 0) {
                liquidityInfo += '\n   Suporte: ';
                liquidityInfo += liquidityClusters.supports.map(s => 
                    `$${Utils.formatPrice(s.price)} (${s.strength}x)`
                ).join(' | ');
            }
            
            if (liquidityClusters.resistances.length > 0) {
                liquidityInfo += '\n   Resistência: ';
                liquidityInfo += liquidityClusters.resistances.map(r => 
                    `$${Utils.formatPrice(r.price)} (${r.strength}x)`
                ).join(' | ');
            }
        }
        
        // ATR / Stop info
        let stopInfo = '';
        if (atrData && stopPrice) {
            const stopPercent = atrData.stopPercentage.toFixed(1);
            const riskReward = (Math.abs(parseFloat(targetDist)) / stopPercent).toFixed(1);
            stopInfo = `\n ${stopEmoji} Stop: $${Utils.formatPrice(stopPrice)} (${stopPercent}%) `;
        }
        
        return `
${emoji} <i>${pattern.type} ${this.timeframe} - Operação Ativada</i> ${emoji}

<i> ${symbol}</i> | ${pattern.direction}
 Preço: $${Utils.formatPrice(price)}
<i> Operação:</i> ${Utils.getBrazilianTime()}
 Entrada: $${Utils.formatPrice(pattern.entryPrice)}
${targetEmoji} Alvo: $${Utils.formatPrice(pattern.targetPrice)} (${targetDist}%)${stopInfo}
<i> Análise:</i>
 ${volumeInfo} | ${volumeType}
 ${lsrInfo}
 ${rsiInfo}${liquidityInfo}

<i>Titanium by J4Rviz</i>`;
    }

    getStats() {
        return this.stats;
    }
}

// =====================================================================
// === MAIN ===
// =====================================================================
async function main() {
    console.log('\n🚀 SCANNER HARMÔNICO - COM CLUSTERS DE LIQUIDEZ E RSI 1h');
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
    
    await symbolManager.loadSymbols(limiter);
    
    const scanner1h = new HarmonicScanner('1H', limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator);
    const scanner4h = new HarmonicScanner('4H', limiter, fetcher, symbolManager, telegram, volumeAnalyzer, lsrCalculator, atrCalculator, liquidityDetector, rsiCalculator);
    
    await telegram.send(`
<b>🤖 Titanium  INICIADO</b>

 ${symbolManager.validSymbols.size} pares válidos
 🔥 Volume  (${CONFIG.VOLUME.ABNORMAL_THRESHOLD}x)
${Utils.getBrazilianTime()}
    `);
    
    let scanCount = 0;
    let lastStatsTime = Date.now();
    
    while (true) {
        scanCount++;
        Logger.info(`\n🔄 Scan #${scanCount} - ${Utils.getBrazilianTime()}`);
        
        const allSymbols = Array.from(symbolManager.validSymbols);
        
        // Scan 1H
        Logger.info(`\n⏰ 1H (${allSymbols.length} símbolos)...`);
        for (let i = 0; i < allSymbols.length; i += 5) {
            const batch = allSymbols.slice(i, i + 5);
            await Promise.all(batch.map(s => scanner1h.scan(s)));
            
            if (i % 50 === 0) {
                const percent = ((i + 5) / allSymbols.length * 100).toFixed(1);
                Logger.info(`   Progresso: ${Math.min(i + 5, allSymbols.length)}/${allSymbols.length} (${percent}%)`);
            }
            
            await Utils.sleep(500);
        }
        
        // Scan 4H
        Logger.info(`\n⏰ 4H (${allSymbols.length} símbolos)...`);
        for (let i = 0; i < allSymbols.length; i += 5) {
            const batch = allSymbols.slice(i, i + 5);
            await Promise.all(batch.map(s => scanner4h.scan(s)));
            
            if (i % 50 === 0) {
                const percent = ((i + 5) / allSymbols.length * 100).toFixed(1);
                Logger.info(`   Progresso: ${Math.min(i + 5, allSymbols.length)}/${allSymbols.length} (${percent}%)`);
            }
            
            await Utils.sleep(500);
        }
        
        // Estatísticas
        if (scanCount % 6 === 0) {
            const runtime = ((Date.now() - lastStatsTime) / 1000 / 60).toFixed(0);
            Logger.info(`\n📊 ESTATÍSTICAS (${runtime}min):`);
            Logger.info(`   1H - Detectados: ${scanner1h.getStats().detected} | Alertas: ${scanner1h.getStats().alerts}`);
            Logger.info(`   4H - Detectados: ${scanner4h.getStats().detected} | Alertas: ${scanner4h.getStats().alerts}`);
            lastStatsTime = Date.now();
        }
        
        Logger.info(`\n⏱️  Aguardando 5 minutos...`);
        await Utils.sleep(CONFIG.SCAN_INTERVAL);
    }
}

// Tratamento de erros
process.on('uncaughtException', (error) => {
    Logger.error(`Erro fatal: ${error.message}`);
});

process.on('SIGINT', () => {
    Logger.info('\n👋 Encerrando...');
    process.exit(0);
});

main();
