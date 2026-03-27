const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

/// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A',
        CHAT_ID: '-1001990889297'
    },
    SCAN: {
        BATCH_SIZE: 10,
        SYMBOL_DELAY_MS: 4000,
        REQUEST_TIMEOUT: 10000,
        COOLDOWN_AFTER_BATCH_MS: 2000,
        MAX_REQUESTS_PER_MINUTE: 1200,
        CACHE_DURATION_SECONDS: 30,
        TOP_SYMBOLS_LIMIT: 350
    },
    ALERTS: {
        COOLDOWN_MINUTES: 15,
        ALLOW_OPPOSITE_DIRECTION: false,
        COOLDOWN_BY_SCORE: {
           3: 15,
           4: 15,
           5: 15,
           6: 15,
           7: 15,
           8: 15
        },
        COOLDOWN_BY_TIMEFRAME: {
            '15m': 15,
            '30m': 15,
            '1h': 15,
            '2h': 15,
            '4h': 15,
            '12h': 15,
            '1d': 15,
            '3d': 15,
            '1w': 15
        },
        DAILY_LIMITS: {
            TOP_10: 55,
            TOP_50: 60,
            OTHER: 75,
            LOW_VOLUME: 50
        },
        MIN_VOLUME_USDT: 50000,
        MIN_VOLUME_RATIO: 1.7,
        MIN_24H_VOLUME_USDT: 100000,
        VOLUME_DIRECTION: {
            BUY_MIN_PERCENTAGE: 52,
            SELL_MAX_PERCENTAGE: 45,
            STRICT_MODE: true,
            REQUIRE_VOLUME_DIRECTION: true
        },
        MIN_TREND_STRENGTH: 3,
        PRICE_DEVIATION: 1.0,
        RSI: {
            BUY_MAX: 64,
            SELL_MIN: 66
        },
        PRIORITY_LEVELS: {
            CRITICAL: 7,
            HIGH: 5,
            MEDIUM: 4,
            LOW: 3
        },
        GROUP_SIMILAR: true,
        GROUP_WINDOW_MINUTES: 10,
        MAX_GROUP_SIZE: 3,
        SIMILAR_PRICE_DIFF: 1.0,
        MIN_SCORE_TO_ALERT: 3,
        MAX_ALERTS_PER_SCAN: 30,
        IGNORE_LOW_VOLUME_SYMBOLS: true,
        TELEGRAM_DELAY_MS: 5000,
        MIN_15M_VOLATILITY: {
            ENABLED: true,
            MIN_ATR_PERCENT: 0.5,
            MIN_BB_WIDTH_PERCENT: 1.2,
            CHECK_TIMEFRAMES: ['1h', '4h', '1d', '3d', '1w']
        },
        PROXIMITY_THRESHOLD_PERCENT: 1.5,
        BOLLINGER: {
            ENABLED: true,
            PERIOD: 20,
            STD_DEV: 2.0,
            TIMEFRAME: '15m'
        },
        DIVERGENCE_RECENCY: {
            ENABLED: true,
            MAX_CANDLES_BACK: {
                '15m': 8,
                '30m': 8,
                '1h': 10,
                '2h': 10,
                '4h': 12,
                '12h': 12,
                '1d': 18,
                '3d': 24,
                '1w': 30
            },
            PENALTY_FOR_OLD: -2
        },
        CLUSTER_BONUS_LIMITS: {
            MAX_TOTAL_BONUS: 1.5,
            PER_TOUCH_BONUS: 0.2,
            MULTI_CLUSTER_BONUS: 0.8
        },
        STOP_LOSS_ADJUSTMENT: {
            MIN_STOP_PERCENT: {
                '15m': 2.0,
                '30m': 2.2,
                '1h': 2.5,
                '2h': 3.0,
                '4h': 3.5,
                '12h': 4.0,
                '1d': 5.0,
                '3d': 6.0,
                '1w': 7.0
            },
            MAX_STOP_PERCENT: {
                '15m': 5.0,
                '30m': 5.5,
                '1h': 7.0,
                '2h': 8.0,
                '4h': 10.0,
                '12h': 12.0,
                '1d': 14.0,
                '3d': 16.0,
                '1w': 20.0
            },
            ATR_MULTIPLIER: {
                '15m': 3.0,
                '30m': 3.3,
                '1h': 3.8,
                '2h': 4.0,
                '4h': 4.2,
                '12h': 4.5,
                '1d': 5.0,
                '3d': 5.5,
                '1w': 6.0
            }
        },
        // CONFIGURAÇÕES DA MEMÓRIA DE ESTUDO
        MEMORY: {
            ENABLED: true,
            EXPIRY_HOURS: 48,           // Mantém o estudo na memória por 48 horas
            CHECK_TIMEFRAME: '3m',      // Timeframe para confirmação da reversão
            EMA_FAST: 13,               // EMA rápida para cruzamento
            EMA_SLOW: 34,               // EMA lenta para cruzamento
            EMA_TREND: 55               // EMA de tendência para fechamento
        }
    },
    VOLUME: { EMA_PERIOD: 9 },
    RSI: {
        PERIOD: 14,
        OVERSOLD: 30,
        OVERBOUGHT: 70,
        EXTREME_OVERSOLD: 25,
        EXTREME_OVERBOUGHT: 75
    },
    RSI_DIVERGENCE: {
        TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'],
        LOOKBACK_PERIODS: 30,
        MIN_PIVOT_STRENGTH: 0.5,
        SCORE_MULTIPLIER: {
            '15m': 0.5,
            '30m': 0.7,
            '1h': 1.0,
            '2h': 1.2,
            '4h': 2.0,
            '12h': 2.5,
            '1d': 3.0,
            '3d': 4.0,
            '1w': 5.0
        },
        REQUIRE_EXTREME_FOR_HIDDEN: true,
        HIDDEN_DIVERGENCE_MULTIPLIER: 1.5,
        REGULAR_DIVERGENCE_MULTIPLIER: 1.0,
        MIN_RSI_EXTREME_FOR_HIDDEN: {
            bullish: 30,
            bearish: 70
        }
    },
    STOCHASTIC: {
        DAILY: { K_PERIOD: 5, K_SMOOTH: 3, D_PERIOD: 3 },
        FOUR_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 },
        ONE_HOUR: { K_PERIOD: 14, K_SMOOTH: 3, D_PERIOD: 3 }
    },
    CCI: { PERIOD: 20, EMA_PERIOD: 5 },
    REVERSAL: {
        MIN_CONFIRMATION_SCORE: 3,
        VOLUME_THRESHOLD: 1.2,
        STOCH_OVERSOLD: 25,
        STOCH_OVERBOUGHT: 75
    },
    LSR_PENALTY: {
        BUY_MAX_RATIO: 3.0,
        SELL_MIN_RATIO: 1.3,
        PENALTY_POINTS: -4
    },
    FUNDING_PENALTY: {
        ENABLED: true,
        LEVELS: {
            POSITIVE: {
                VERY_LOW: { THRESHOLD: 0.001, POINTS: -1 },
                LOW: { THRESHOLD: 0.002, POINTS: -2 },
                MEDIUM: { THRESHOLD: 0.004, POINTS: -3 },
                HIGH: { THRESHOLD: 0.008, POINTS: -4 }
            },
            NEGATIVE: {
                VERY_LOW: { THRESHOLD: -0.001, POINTS: -1 },
                LOW: { THRESHOLD: -0.002, POINTS: -2 },
                MEDIUM: { THRESHOLD: -0.004, POINTS: -3 },
                HIGH: { THRESHOLD: -0.008, POINTS: -4 }
            }
        },
        BUY_PENALTY_FOR_POSITIVE: true,
        SELL_PENALTY_FOR_NEGATIVE: true,
        MAX_TOTAL_PENALTY: -10
    },
    STOP_LOSS: {
        ATR_MULTIPLIER: {
            '15m': 3.0,
            '30m': 3.3,
            '1h': 3.8,
            '2h': 4.0,
            '4h': 4.2,
            '12h': 4.5,
            '1d': 5.0,
            '3d': 5.5,
            '1w': 6.0
        },
        STRUCTURE_MULTIPLIER: 0.15,
        USE_CLUSTER_ZONE: true,
        CLUSTER_ZONE_MULTIPLIER: 0.1,
        MIN_STOP_DISTANCE_PERCENT: {
            '15m': 2.0,
            '30m': 2.2,
            '1h': 2.5,
            '2h': 3.0,
            '4h': 3.5,
            '12h': 4.0,
            '1d': 5.0,
            '3d': 6.0,
            '1w': 7.0
        },
        MAX_STOP_DISTANCE_PERCENT: {
            '15m': 5.0,
            '30m': 5.5,
            '1h': 7.0,
            '2h': 8.0,
            '4h': 10.0,
            '12h': 12.0,
            '1d': 14.0,
            '3d': 16.0,
            '1w': 20.0
        }
    },
    TARGETS: {
        TP1_MULTIPLIER: 1.0,
        TP2_MULTIPLIER: 1.5,
        TP3_MULTIPLIER: 2.0
    },
    CVD: {
        ENABLED: true,
        TIMEFRAME: '15m',
        LOOKBACK_CANDLES: 20,
        MIN_VOLUME_USDT: 100000,
        SCORE_BONUS: {
            BULLISH_DIVERGENCE: 2.0,
            BEARISH_DIVERGENCE: 2.0,
            TREND_BONUS: 1.0
        },
        WEBSOCKET: {
            ENABLED: true,
            MAX_SYMBOLS: 100,
            SNAPSHOT_INTERVAL_MS: 15 * 60 * 1000,
            RECONNECT_DELAY_MS: 5000,
            WS_URL: 'wss://fstream.binance.com'
        }
    }
};

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
const MEMORY_FILE = path.join(__dirname, 'studyMemory.json');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// =====================================================================
// === SISTEMA DE MEMÓRIA DE ESTUDO ===
// =====================================================================
class StudyMemory {
    constructor() {
        this.memory = new Map(); // symbol -> { direction, timestamp, price, bbLower, bbUpper, divergenceScore, studyData }
        this.loadFromFile();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                const data = fs.readFileSync(MEMORY_FILE, 'utf8');
                const loaded = JSON.parse(data);
                for (const [key, value] of Object.entries(loaded)) {
                    this.memory.set(key, value);
                }
                log(`Carregados ${this.memory.size} estudos da memória`, 'info');
            }
        } catch (error) {
            log(`Erro ao carregar memória: ${error.message}`, 'error');
        }
    }

    saveToFile() {
        try {
            const obj = Object.fromEntries(this.memory);
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2));
        } catch (error) {
            log(`Erro ao salvar memória: ${error.message}`, 'error');
        }
    }

    addStudy(symbol, direction, price, bbLower, bbUpper, divergenceScore, studyData) {
        const key = `${symbol}_${direction}`;
        const expiryHours = CONFIG.ALERTS.MEMORY.EXPIRY_HOURS || 48;
        
        this.memory.set(key, {
            symbol,
            direction,
            price,
            bbLower,
            bbUpper,
            divergenceScore,
            studyData,
            timestamp: Date.now(),
            expiryTime: Date.now() + (expiryHours * 60 * 60 * 1000)
        });
        
        this.saveToFile();
        log(`📝 MEMÓRIA: ${symbol} ${direction} registrado para estudo (válido por ${expiryHours}h)`, 'success');
    }

    getStudy(symbol, direction) {
        const key = `${symbol}_${direction}`;
        const study = this.memory.get(key);
        
        if (!study) return null;
        
        // Verifica se expirou
        if (Date.now() > study.expiryTime) {
            this.memory.delete(key);
            this.saveToFile();
            return null;
        }
        
        return study;
    }

    hasStudy(symbol, direction) {
        return this.getStudy(symbol, direction) !== null;
    }

    removeStudy(symbol, direction) {
        const key = `${symbol}_${direction}`;
        this.memory.delete(key);
        this.saveToFile();
    }

    cleanupExpired() {
        let removed = 0;
        for (const [key, study] of this.memory) {
            if (Date.now() > study.expiryTime) {
                this.memory.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            this.saveToFile();
            log(`🧹 Limpeza de memória: ${removed} estudos expirados removidos`, 'info');
        }
    }

    getStats() {
        const stats = { total: this.memory.size, byDirection: { COMPRA: 0, VENDA: 0 } };
        for (const [key, study] of this.memory) {
            if (study.direction === 'COMPRA') stats.byDirection.COMPRA++;
            else stats.byDirection.VENDA++;
        }
        return stats;
    }
}

// Instância global da memória
const studyMemory = new StudyMemory();

// =====================================================================
// === FUNÇÕES DE EMA PARA CONFIRMAÇÃO NO GRÁFICO 3 MINUTOS ===
// =====================================================================
function calculateEMASeries(values, period) {
    if (!values || values.length === 0) return [];
    if (values.length < period) return values.map(v => v);
    
    const multiplier = 2 / (period + 1);
    const emaSeries = [];
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaSeries.push(ema);
    
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
        emaSeries.push(ema);
    }
    
    return emaSeries;
}

async function checkEMAConfirmation(symbol, direction) {
    try {
        const timeframe = CONFIG.ALERTS.MEMORY.CHECK_TIMEFRAME || '3m';
        const candles = await getCandles(symbol, timeframe, 100);
        
        if (!candles || candles.length < 60) {
            return { confirmed: false, message: 'Dados insuficientes no timeframe 3m', ema13: null, ema34: null, ema55: null };
        }
        
        const closes = candles.map(c => c.close);
        
        // Calcula EMAs
        const ema13Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_FAST);
        const ema34Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_SLOW);
        const ema55Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_TREND);
        
        const currentEMA13 = ema13Series[ema13Series.length - 1];
        const previousEMA13 = ema13Series.length >= 2 ? ema13Series[ema13Series.length - 2] : currentEMA13;
        
        const currentEMA34 = ema34Series[ema34Series.length - 1];
        const previousEMA34 = ema34Series.length >= 2 ? ema34Series[ema34Series.length - 2] : currentEMA34;
        
        const currentEMA55 = ema55Series[ema55Series.length - 1];
        const currentPrice = closes[closes.length - 1];
        const currentCandle = candles[candles.length - 1];
        
        let confirmed = false;
        let message = '';
        
        if (direction === 'COMPRA') {
            // CRITÉRIO DE COMPRA: EMA13 cruza para cima da EMA34 E preço fecha acima da EMA55
            const ema13CrossedUp = previousEMA13 <= previousEMA34 && currentEMA13 > currentEMA34;
            const priceAboveEMA55 = currentPrice > currentEMA55;
            
            if (ema13CrossedUp && priceAboveEMA55) {
                confirmed = true;
                message = `✅ COMPRA confirmada: EMA13 cruzou EMA34 (${currentEMA13.toFixed(2)} > ${currentEMA34.toFixed(2)}) | Preço (${formatPrice(currentPrice)}) > EMA55 (${currentEMA55.toFixed(2)})`;
                log(`📈 ${symbol} - ${message}`, 'success');
            } else if (ema13CrossedUp && !priceAboveEMA55) {
                message = `⏳ Aguardando fechamento acima da EMA55 (${formatPrice(currentPrice)} < ${currentEMA55.toFixed(2)})`;
            } else if (!ema13CrossedUp && priceAboveEMA55) {
                message = `⏳ Aguardando cruzamento da EMA13 sobre EMA34 (${currentEMA13.toFixed(2)} < ${currentEMA34.toFixed(2)})`;
            } else {
                message = `⏳ Aguardando confirmação: EMA13:${currentEMA13.toFixed(2)} | EMA34:${currentEMA34.toFixed(2)} | Preço/EMA55:${formatPrice(currentPrice)}/${currentEMA55.toFixed(2)}`;
            }
        } else {
            // CRITÉRIO DE VENDA: EMA13 cruza para baixo da EMA34 E preço fecha abaixo da EMA55
            const ema13CrossedDown = previousEMA13 >= previousEMA34 && currentEMA13 < currentEMA34;
            const priceBelowEMA55 = currentPrice < currentEMA55;
            
            if (ema13CrossedDown && priceBelowEMA55) {
                confirmed = true;
                message = `✅ VENDA confirmada: EMA13 cruzou EMA34 (${currentEMA13.toFixed(2)} < ${currentEMA34.toFixed(2)}) | Preço (${formatPrice(currentPrice)}) < EMA55 (${currentEMA55.toFixed(2)})`;
                log(`📉 ${symbol} - ${message}`, 'success');
            } else if (ema13CrossedDown && !priceBelowEMA55) {
                message = `⏳ Aguardando fechamento abaixo da EMA55 (${formatPrice(currentPrice)} > ${currentEMA55.toFixed(2)})`;
            } else if (!ema13CrossedDown && priceBelowEMA55) {
                message = `⏳ Aguardando cruzamento da EMA13 abaixo da EMA34 (${currentEMA13.toFixed(2)} > ${currentEMA34.toFixed(2)})`;
            } else {
                message = `⏳ Aguardando confirmação: EMA13:${currentEMA13.toFixed(2)} | EMA34:${currentEMA34.toFixed(2)} | Preço/EMA55:${formatPrice(currentPrice)}/${currentEMA55.toFixed(2)}`;
            }
        }
        
        return {
            confirmed,
            message,
            ema13: currentEMA13,
            ema34: currentEMA34,
            ema55: currentEMA55,
            currentPrice,
            candles
        };
        
    } catch (error) {
        log(`Erro ao verificar EMA para ${symbol}: ${error.message}`, 'error');
        return { confirmed: false, message: 'Erro na verificação EMA', ema13: null, ema34: null, ema55: null };
    }
}

// =====================================================================
// === PERSISTÊNCIA DOS CONTADORES DIÁRIOS ===
// =====================================================================
const DAILY_COUNTER_FILE = path.join(__dirname, 'dailyCounters.json');

function loadDailyCounters() {
    try {
        if (fs.existsSync(DAILY_COUNTER_FILE)) {
            const data = fs.readFileSync(DAILY_COUNTER_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [key, value] of Object.entries(loaded)) {
                dailyCounter.set(key, value);
            }
            log(`Carregados ${dailyCounter.size} contadores diários do arquivo`, 'info');
        }
    } catch (error) {
        log(`Erro ao carregar contadores diários: ${error.message}`, 'error');
    }
}

function saveDailyCounters() {
    try {
        const obj = Object.fromEntries(dailyCounter);
        fs.writeFileSync(DAILY_COUNTER_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
        log(`Erro ao salvar contadores diários: ${error.message}`, 'error');
    }
}

// =====================================================================
// === CACHE INTELIGENTE ===
// =====================================================================
class SmartCache {
    constructor() {
        this.cache = new Map();
        this.requestTimestamps = [];
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > CONFIG.SCAN.CACHE_DURATION_SECONDS * 1000) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    set(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    canMakeRequest() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
        return this.requestTimestamps.length < CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE;
    }

    addRequest() {
        this.requestTimestamps.push(Date.now());
    }

    getWaitTime() {
        if (this.requestTimestamps.length === 0) return 0;
        const now = Date.now();
        const oldestRequest = this.requestTimestamps[0];
        const requestsLastMinute = this.requestTimestamps.length;
        if (requestsLastMinute < CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE) return 0;
        const timeUntilExpiry = 60000 - (now - oldestRequest);
        return Math.max(0, timeUntilExpiry);
    }
}

const cache = new SmartCache();

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

function getScoreEmoji(score) {
    if (score >= 7) return '🔥';
    if (score >= 5) return '⭐';
    if (score >= 3) return '✅';
    return '❌';
}

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    if (type === 'error') console.error(`❌ ${message}`);
    else if (type === 'success') console.log(`✅ ${message}`);
    else if (type === 'warning') console.log(`⚠️ ${message}`);
    else console.log(`ℹ️ ${message}`);
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\n', { flag: 'a' });
}

// Caches
const alertCache = new Map();
const dailyCounter = new Map();
let currentTopSymbols = [];

// Filas
const priorityQueue = { critical: [], high: [], medium: [], low: [] };
let isSendingTelegram = false;
let alertsSentThisScan = 0;

// =====================================================================
// === CVD REAL VIA WEBSOCKET ===
// =====================================================================

class RealCVDManager {
    constructor() {
        this.connections = new Map();
        this.snapshots = new Map();
        this.listeners = new Map();
        this.isInitialized = false;
        this.reconnectTimer = null;
    }

    async initialize(symbols) {
        if (!CONFIG.CVD.WEBSOCKET.ENABLED) {
            log('CVD WebSocket desativado, usando modo simulado', 'warning');
            return false;
        }

        const maxSymbols = CONFIG.CVD.WEBSOCKET.MAX_SYMBOLS;
        const activeSymbols = symbols.slice(0, maxSymbols);
        
        log(`Inicializando CVD Real para ${activeSymbols.length} símbolos...`, 'info');
        
        for (const symbol of activeSymbols) {
            await this.connectSymbol(symbol);
            await new Promise(r => setTimeout(r, 100));
        }
        
        this.isInitialized = true;
        log(`CVD Real ativo para ${activeSymbols.length} símbolos`, 'success');
        return true;
    }

    async connectSymbol(symbol) {
        if (this.connections.has(symbol)) {
            this.disconnectSymbol(symbol);
        }

        const streamName = `${symbol.toLowerCase()}@trade`;
        const wsUrl = `${CONFIG.CVD.WEBSOCKET.WS_URL}/ws/${streamName}`;
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            log(`✅ WebSocket conectado para ${symbol}`, 'success');
            this.snapshots.set(symbol, {
                cumulative: 0,
                deltas: [],
                lastUpdate: Date.now(),
                startPrice: null,
                lastPrice: null
            });
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (e) {}
        });
        
        ws.on('error', (error) => {
            log(`Erro WebSocket ${symbol}: ${error.message}`, 'error');
        });
        
        ws.on('close', () => {
            log(`WebSocket fechado para ${symbol}, reconectando...`, 'warning');
            this.connections.delete(symbol);
            setTimeout(() => this.connectSymbol(symbol), CONFIG.CVD.WEBSOCKET.RECONNECT_DELAY_MS);
        });
        
        this.connections.set(symbol, ws);
    }

    disconnectSymbol(symbol) {
        const ws = this.connections.get(symbol);
        if (ws) {
            ws.close();
            this.connections.delete(symbol);
        }
    }

    processTrade(symbol, trade) {
        const snapshot = this.snapshots.get(symbol);
        if (!snapshot) return;
        
        const price = parseFloat(trade.p);
        const quantity = parseFloat(trade.q);
        const value = price * quantity;
        const isAggressiveBuy = !trade.m;
        const delta = isAggressiveBuy ? value : -value;
        snapshot.cumulative += delta;
        
        snapshot.deltas.push({
            delta: delta,
            price: price,
            timestamp: trade.T || Date.now(),
            cumulative: snapshot.cumulative
        });
        
        snapshot.lastPrice = price;
        if (!snapshot.startPrice) snapshot.startPrice = price;
        
        const maxDeltas = 900;
        if (snapshot.deltas.length > maxDeltas) {
            snapshot.deltas = snapshot.deltas.slice(-maxDeltas);
        }
        
        snapshot.lastUpdate = Date.now();
        
        const listeners = this.listeners.get(symbol);
        if (listeners) {
            listeners.forEach(cb => cb({
                symbol,
                price,
                delta,
                cumulative: snapshot.cumulative,
                timestamp: trade.T
            }));
        }
    }

    onTrade(symbol, callback) {
        if (!this.listeners.has(symbol)) {
            this.listeners.set(symbol, []);
        }
        this.listeners.get(symbol).push(callback);
    }

    getCVDAnalysis(symbol, currentPrice, isGreenAlert) {
        const snapshot = this.snapshots.get(symbol);
        
        if (!snapshot || !snapshot.deltas || snapshot.deltas.length < 10) {
            return { cvdConfirmed: false, cvdScore: 0, cvdSignal: null, isReal: false };
        }
        
        const deltas = snapshot.deltas;
        const recentDeltas = deltas.slice(-50);
        
        const cvdValues = recentDeltas.map(d => d.cumulative);
        const cvdStart = cvdValues[0] || 0;
        const cvdEnd = cvdValues[cvdValues.length - 1] || 0;
        const cvdTrend = cvdEnd - cvdStart;
        
        const prices = recentDeltas.map(d => d.price);
        const priceStart = prices[0] || currentPrice;
        const priceEnd = prices[prices.length - 1] || currentPrice;
        const priceTrend = priceEnd - priceStart;
        
        let divergence = null;
        
        if (priceTrend < 0 && cvdTrend > 0) {
            divergence = {
                type: 'bullish',
                description: 'Preço caindo, CVD subindo (acumulação)',
                strength: Math.abs(cvdTrend / (Math.abs(priceStart) || 1)) * 100,
                score: CONFIG.CVD.SCORE_BONUS.BULLISH_DIVERGENCE
            };
        } else if (priceTrend > 0 && cvdTrend < 0) {
            divergence = {
                type: 'bearish',
                description: 'Preço subindo, CVD caindo (distribuição)',
                strength: Math.abs(cvdTrend / (Math.abs(priceStart) || 1)) * 100,
                score: CONFIG.CVD.SCORE_BONUS.BEARISH_DIVERGENCE
            };
        } else if ((priceTrend > 0 && cvdTrend > 0) || (priceTrend < 0 && cvdTrend < 0)) {
            divergence = {
                type: priceTrend > 0 ? 'bullish' : 'bearish',
                description: 'CVD alinhado com tendência',
                strength: Math.abs(cvdTrend / (Math.abs(priceStart) || 1)) * 100,
                score: CONFIG.CVD.SCORE_BONUS.TREND_BONUS
            };
        }
        
        if (divergence) {
            const isAligned = (isGreenAlert && divergence.type === 'bullish') ||
                              (!isGreenAlert && divergence.type === 'bearish');
            
            return {
                cvdConfirmed: isAligned,
                cvdScore: divergence.score,
                cvdSignal: divergence,
                isReal: true,
                cvdTrend: cvdTrend,
                priceTrend: priceTrend,
                deltaCount: recentDeltas.length
            };
        }
        
        return { cvdConfirmed: false, cvdScore: 0, cvdSignal: null, isReal: true };
    }

    getStats() {
        const stats = { connected: this.connections.size, withData: 0, symbols: [] };
        for (const [symbol, snapshot] of this.snapshots) {
            if (snapshot.deltas.length > 0) {
                stats.withData++;
                stats.symbols.push({ symbol, deltas: snapshot.deltas.length, cumulative: snapshot.cumulative.toFixed(2) });
            }
        }
        return stats;
    }

    shutdown() {
        for (const [symbol, ws] of this.connections) {
            ws.close();
        }
        this.connections.clear();
        this.snapshots.clear();
        log('CVD Real desligado', 'info');
    }
}

const realCVD = new RealCVDManager();

async function analyzeCVDHybrid(symbol, currentPrice, isGreenAlert) {
    if (CONFIG.CVD.WEBSOCKET.ENABLED && realCVD.isInitialized) {
        const realResult = realCVD.getCVDAnalysis(symbol, currentPrice, isGreenAlert);
        if (realResult.isReal && realResult.cvdSignal) {
            if (realResult.cvdConfirmed) {
                log(`✅ ${symbol} - CVD REAL ${realResult.cvdSignal.type} +${realResult.cvdScore} (${realResult.deltaCount} trades)`, 'success');
            }
            return realResult;
        }
    }
    return await analyzeCVDSimulated(symbol, currentPrice, isGreenAlert);
}

async function getCVDDataSimulated(symbol) {
    try {
        const interval = CONFIG.CVD.TIMEFRAME;
        const limit = CONFIG.CVD.LOOKBACK_CANDLES + 15;
        const candles = await getCandles(symbol, interval, limit);
        
        if (!candles || candles.length < 15) return null;
        
        let cumulativeDelta = 0;
        const deltas = [];
        
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            const isBullish = candle.close > candle.open;
            const delta = isBullish ? candle.volume : -candle.volume;
            cumulativeDelta += delta;
            deltas.push({
                time: candle.time,
                delta: delta,
                cumulative: cumulativeDelta,
                price: candle.close,
                volume: candle.volume,
                direction: isBullish ? 'buy' : 'sell'
            });
        }
        
        return { symbol, interval, currentCVD: cumulativeDelta, deltas, lastCandle: deltas[deltas.length - 1], previousCandle: deltas.length >= 2 ? deltas[deltas.length - 2] : null };
    } catch (error) {
        return null;
    }
}

function findLocalExtremes(values, type) {
    const extremes = [];
    for (let i = 1; i < values.length - 1; i++) {
        if (type === 'high') {
            if (values[i] > values[i-1] && values[i] > values[i+1]) {
                extremes.push({ index: i, value: values[i] });
            }
        } else {
            if (values[i] < values[i-1] && values[i] < values[i+1]) {
                extremes.push({ index: i, value: values[i] });
            }
        }
    }
    return extremes;
}

function detectCVDDivergenceSimulated(cvdData, candles) {
    if (!cvdData || !cvdData.deltas || cvdData.deltas.length < 15) return null;
    
    const deltas = cvdData.deltas;
    const prices = candles.map(c => c.close);
    const lookback = Math.min(CONFIG.CVD.LOOKBACK_CANDLES, deltas.length - 2);
    const recentDeltas = deltas.slice(-lookback);
    const recentPrices = prices.slice(-lookback);
    
    if (recentPrices.length < 10 || recentDeltas.length < 10) return null;
    
    const priceHighs = findLocalExtremes(recentPrices, 'high');
    const priceLows = findLocalExtremes(recentPrices, 'low');
    const cvdValues = recentDeltas.map(d => d.cumulative);
    const cvdHighs = findLocalExtremes(cvdValues, 'high');
    const cvdLows = findLocalExtremes(cvdValues, 'low');
    
    let divergence = null;
    
    if (priceLows.length >= 2 && cvdLows.length >= 2) {
        const lastPriceLow = priceLows[priceLows.length - 1];
        const prevPriceLow = priceLows[priceLows.length - 2];
        const lastCvdLow = cvdLows[cvdLows.length - 1];
        const prevCvdLow = cvdLows[cvdLows.length - 2];
        
        if (lastPriceLow.index > prevPriceLow.index && lastCvdLow.index > prevCvdLow.index) {
            if (lastPriceLow.value < prevPriceLow.value && lastCvdLow.value > prevCvdLow.value) {
                divergence = {
                    type: 'bullish',
                    description: 'Preço fez nova mínima, CVD fez mínima mais alta',
                    strength: Math.abs((lastCvdLow.value - prevCvdLow.value) / (prevCvdLow.value || 1) * 100),
                    score: CONFIG.CVD.SCORE_BONUS.BULLISH_DIVERGENCE
                };
            }
        }
    }
    
    if (!divergence && priceHighs.length >= 2 && cvdHighs.length >= 2) {
        const lastPriceHigh = priceHighs[priceHighs.length - 1];
        const prevPriceHigh = priceHighs[priceHighs.length - 2];
        const lastCvdHigh = cvdHighs[cvdHighs.length - 1];
        const prevCvdHigh = cvdHighs[cvdHighs.length - 2];
        
        if (lastPriceHigh.index > prevPriceHigh.index && lastCvdHigh.index > prevCvdHigh.index) {
            if (lastPriceHigh.value > prevPriceHigh.value && lastCvdHigh.value < prevCvdHigh.value) {
                divergence = {
                    type: 'bearish',
                    description: 'Preço fez nova máxima, CVD fez máxima mais baixa',
                    strength: Math.abs((prevCvdHigh.value - lastCvdHigh.value) / (prevCvdHigh.value || 1) * 100),
                    score: CONFIG.CVD.SCORE_BONUS.BEARISH_DIVERGENCE
                };
            }
        }
    }
    
    if (!divergence) {
        const last5CVD = cvdValues.slice(-5);
        const cvdTrend = last5CVD[last5CVD.length - 1] - last5CVD[0];
        const last5Prices = recentPrices.slice(-5);
        const priceTrend = last5Prices[last5Prices.length - 1] - last5Prices[0];
        
        if (cvdTrend > 0 && priceTrend > 0) {
            divergence = {
                type: 'bullish',
                description: 'CVD em tendência de alta',
                strength: Math.abs(cvdTrend),
                score: CONFIG.CVD.SCORE_BONUS.TREND_BONUS
            };
        } else if (cvdTrend < 0 && priceTrend < 0) {
            divergence = {
                type: 'bearish',
                description: 'CVD em tendência de baixa',
                strength: Math.abs(cvdTrend),
                score: CONFIG.CVD.SCORE_BONUS.TREND_BONUS
            };
        }
    }
    
    return divergence;
}

async function analyzeCVDSimulated(symbol, currentPrice, isGreenAlert) {
    if (!CONFIG.CVD.ENABLED) return { cvdScore: 0, cvdSignal: null, cvdConfirmed: false, isReal: false };
    
    try {
        const candles = await getCandles(symbol, CONFIG.CVD.TIMEFRAME, 40);
        const cvdData = await getCVDDataSimulated(symbol);
        
        if (!cvdData || !candles || candles.length < 15) {
            return { cvdScore: 0, cvdSignal: null, cvdConfirmed: false, isReal: false };
        }
        
        const cvdDivergence = detectCVDDivergenceSimulated(cvdData, candles);
        
        if (cvdDivergence) {
            const isAligned = (isGreenAlert && cvdDivergence.type === 'bullish') ||
                              (!isGreenAlert && cvdDivergence.type === 'bearish');
            
            if (isAligned) {
                return {
                    cvdScore: cvdDivergence.score,
                    cvdSignal: { type: cvdDivergence.type, description: cvdDivergence.description, strength: cvdDivergence.strength },
                    cvdConfirmed: true,
                    isReal: false
                };
            } else {
                return { cvdScore: 0, cvdSignal: cvdDivergence, cvdConfirmed: false, isReal: false };
            }
        }
        
        return { cvdScore: 0, cvdSignal: null, cvdConfirmed: false, isReal: false };
        
    } catch (error) {
        return { cvdScore: 0, cvdSignal: null, cvdConfirmed: false, isReal: false };
    }
}

// =====================================================================
// === RATE LIMITER INTELIGENTE ===
// =====================================================================
class IntelligentRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.consecutiveErrors = 0;
        this.errorBackoff = 1000;
        this.maxBackoff = 60000;
        this.requestCount = 0;
        this.minuteStart = Date.now();
    }

    async wait() {
        const now = Date.now();
        if (now - this.minuteStart > 60000) {
            this.requestCount = 0;
            this.minuteStart = now;
        }
        if (this.requestCount >= CONFIG.SCAN.MAX_REQUESTS_PER_MINUTE) {
            const waitTime = 60000 - (now - this.minuteStart);
            log(`Rate limit por minuto atingido, aguardando ${Math.ceil(waitTime / 1000)}s...`, 'warning');
            await new Promise(r => setTimeout(r, waitTime));
            this.requestCount = 0;
            this.minuteStart = Date.now();
        }
        const timeSinceLast = now - this.lastRequestTime;
        const baseDelay = CONFIG.SCAN.SYMBOL_DELAY_MS;
        const adaptiveDelay = baseDelay + (this.consecutiveErrors * 100);
        if (timeSinceLast < adaptiveDelay) {
            await new Promise(r => setTimeout(r, adaptiveDelay - timeSinceLast));
        }
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    async makeRequest(url, cacheKey = null) {
        if (cacheKey) {
            const cached = cache.get(cacheKey);
            if (cached) return cached;
        }
        if (!cache.canMakeRequest()) {
            const waitTime = cache.getWaitTime();
            log(`Aguardando ${Math.ceil(waitTime / 1000)}s para respeitar rate limit...`, 'warning');
            await new Promise(r => setTimeout(r, waitTime));
        }
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
            try {
                await this.wait();
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN.REQUEST_TIMEOUT);
                cache.addRequest();
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.status === 429) {
                    this.consecutiveErrors++;
                    const backoffTime = Math.min(this.errorBackoff * Math.pow(2, attempts), this.maxBackoff);
                    log(`Rate limit 429, aguardando ${backoffTime / 1000}s...`, 'warning');
                    await new Promise(r => setTimeout(r, backoffTime));
                    attempts++;
                    continue;
                }
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 1);
                if (cacheKey) cache.set(cacheKey, data);
                return data;
            } catch (error) {
                if (error.name === 'AbortError') log(`Timeout na requisição`, 'warning');
                else log(`Erro na requisição: ${error.message}`, 'error');
                this.consecutiveErrors++;
                attempts++;
                if (attempts < maxAttempts) {
                    const backoffTime = Math.min(this.errorBackoff * Math.pow(2, attempts), this.maxBackoff);
                    await new Promise(r => setTimeout(r, backoffTime));
                }
            }
        }
        throw new Error(`Falha após ${maxAttempts} tentativas`);
    }
}

const rateLimiter = new IntelligentRateLimiter();

// =====================================================================
// === FUNÇÕES DE CLASSIFICAÇÃO DE SÍMBOLOS ===
// =====================================================================
async function getTopSymbols() {
    try {
        log('Buscando top símbolos por volume...');
        const data = await rateLimiter.makeRequest('https://fapi.binance.com/fapi/v1/ticker/24hr', 'top_symbols_24h');
        const topSymbols = data
            .filter(s => s.symbol.endsWith('USDT') && parseFloat(s.volume) > 0)
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
        log(`Encontrados ${topSymbols.length} símbolos top por volume`);
        return topSymbols;
    } catch (e) {
        log('Falha ao buscar top symbols, usando lista estática expandida', 'warning');
        return [
            'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','TONUSDT',
            'MATICUSDT','DOTUSDT','TRXUSDT','UNIUSDT','ATOMUSDT','ETCUSDT','ICPUSDT','FILUSDT','NEARUSDT','APTUSDT',
            'LTCUSDT','BCHUSDT','ARBUSDT','OPUSDT','INJUSDT','IMXUSDT','STXUSDT','HBARUSDT','VETUSDT','RUNEUSDT',
            'ALGOUSDT','EGLDUSDT','MANAUSDT','SANDUSDT','AXSUSDT','APEUSDT','CHZUSDT','GALAUSDT','FLOWUSDT','THETAUSDT',
            'AAVEUSDT','MKRUSDT','COMPUSDT','SNXUSDT','YFIUSDT','CRVUSDT','BALUSDT','1INCHUSDT','ENJUSDT','ZILUSDT'
        ];
    }
}

function getSymbolCategory(symbol, topSymbols = []) {
    const top10 = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
                   'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'];
    if (top10.includes(symbol)) return 'TOP_10';
    if (topSymbols.length > 0) {
        const rank = topSymbols.indexOf(symbol);
        if (rank !== -1 && rank < 50) return 'TOP_50';
        if (rank !== -1 && rank < 150) return 'TOP_150';
    }
    return 'OTHER';
}

function getDailyLimit(symbol) {
    const category = getSymbolCategory(symbol, currentTopSymbols);
    return CONFIG.ALERTS.DAILY_LIMITS[category] || CONFIG.ALERTS.DAILY_LIMITS.OTHER;
}

function getPriorityLevel(score) {
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.CRITICAL) return 'critical';
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.HIGH) return 'high';
    if (score >= CONFIG.ALERTS.PRIORITY_LEVELS.MEDIUM) return 'medium';
    return 'low';
}

// =====================================================================
// === FUNÇÕES DE ANÁLISE TÉCNICA ===
// =====================================================================
function calculateSMA(values, period) {
    if (!values || values.length < period) return 0;
    const sum = values.slice(-period).reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

function calculateRMA(values, period) {
    if (!values || values.length === 0) return 0;
    if (values.length < period) return values.reduce((a, b) => a + b, 0) / values.length;
    let rma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const alpha = 1 / period;
    for (let i = period; i < values.length; i++) {
        rma = alpha * values[i] + (1 - alpha) * rma;
    }
    return rma;
}

function calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return 50;
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
    if (!candles || candles.length < kPeriod + kSmooth + dPeriod) return { k: 50, d: 50 };
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
    return { k: Math.min(100, Math.max(0, Math.round(currentK * 100) / 100)),
             d: Math.min(100, Math.max(0, Math.round(currentD * 100) / 100)) };
}

function formatStochastic(stoch) {
    const k = stoch.k;
    const d = stoch.d;
    let emoji = '🟡';
    if (k < 20 && d < 25) emoji = '🟢';
    if (k > 80 && d > 75) emoji = '🔴';
    return `K${Math.round(k)}${k > d ? '⤴️' : '⤵️'}D${Math.round(d)} ${emoji}`;
}

function calculateCCIWithEMA(candles, period = 20, emaPeriod = 5) {
    if (!candles || candles.length < period + emaPeriod) {
        return { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' };
    }
    const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
    const cciValues = [];
    for (let i = period - 1; i < typicalPrices.length; i++) {
        const tpSlice = typicalPrices.slice(i - period + 1, i + 1);
        const sma = tpSlice.reduce((a, b) => a + b, 0) / period;
        let meanDeviation = 0;
        for (let j = 0; j < tpSlice.length; j++) {
            meanDeviation += Math.abs(tpSlice[j] - sma);
        }
        meanDeviation = meanDeviation / period;
        if (meanDeviation === 0) {
            cciValues.push(0);
        } else {
            const cci = (tpSlice[tpSlice.length - 1] - sma) / (0.015 * meanDeviation);
            cciValues.push(cci);
        }
    }
    if (cciValues.length === 0) return { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' };
    const currentCCI = cciValues[cciValues.length - 1];
    const emaValues = [];
    if (cciValues.length >= emaPeriod) {
        let ema = cciValues.slice(0, emaPeriod).reduce((a, b) => a + b, 0) / emaPeriod;
        emaValues.push(ema);
        const multiplier = 2 / (emaPeriod + 1);
        for (let i = emaPeriod; i < cciValues.length; i++) {
            ema = (cciValues[i] - ema) * multiplier + ema;
            emaValues.push(ema);
        }
        const currentEMA = emaValues[emaValues.length - 1];
        let trend = 'Neutro';
        let emoji = '⚪';
        let text = '';
        if (cciValues.length >= 2) {
            const prevCCI = cciValues[cciValues.length - 2];
            const prevEMA = emaValues.length >= 2 ? emaValues[emaValues.length - 2] : currentEMA;
            if (prevCCI <= prevEMA && currentCCI > currentEMA) {
                trend = 'ALTA';
                emoji = '💹';
                text = `CCI ${trend} ${emoji}`;
            } else if (prevCCI >= prevEMA && currentCCI < currentEMA) {
                trend = 'BAIXA';
                emoji = '🔴';
                text = `CCI ${trend} ${emoji}`;
            } else if (currentCCI > currentEMA) {
                trend = 'ALTA';
                emoji = '💹';
                text = `CCI ${trend} ${emoji}`;
            } else if (currentCCI < currentEMA) {
                trend = 'BAIXA';
                emoji = '🔴';
                text = `CCI ${trend} ${emoji}`;
            } else {
                text = `CCI Neutro ⚪`;
            }
        }
        return { cci: currentCCI, ema: currentEMA, trend, emoji, text: text || `CCI ${currentCCI.toFixed(0)} | EMA ${currentEMA.toFixed(0)}` };
    }
    return { cci: currentCCI, ema: 0, trend: 'Neutro', emoji: '⚪', text: `CCI ${currentCCI.toFixed(0)}` };
}

function analyzeVolumeWithEMA(candles) {
    if (!candles || candles.length < CONFIG.VOLUME.EMA_PERIOD + 1) {
        return { text: '⚪Neutro', emoji: '⚪', percentage: 50, direction: 'Neutro', ratio: 1 };
    }
    const closes = candles.map(c => c.close);
    const ema9 = calculateEMA(closes, CONFIG.VOLUME.EMA_PERIOD);
    let bullishVolume = 0, bearishVolume = 0, totalVolume = 0;
    for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        const volume = candle.volume;
        const close = candle.close;
        totalVolume += volume;
        if (close > ema9) bullishVolume += volume;
        else if (close < ema9) bearishVolume += volume;
        else { bullishVolume += volume / 2; bearishVolume += volume / 2; }
    }
    const buyerPercentage = totalVolume > 0 ? (bullishVolume / totalVolume) * 100 : 50;
    let direction = 'Neutro', emoji = '⚪', text = '';
    if (buyerPercentage > 52) { direction = 'Comprador'; emoji = '🟢'; text = `${emoji}Comprador`; }
    else if (buyerPercentage < 48) { direction = 'Vendedor'; emoji = '🔴'; text = `${emoji}Vendedor`; }
    else text = '⚪Neutro';
    return { text, emoji, percentage: buyerPercentage, sellerPercentage: 100 - buyerPercentage,
             direction, emaValue: ema9 };
}

function checkTrendStrength(candles) {
    if (!candles || candles.length < 20) return 0;
    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const currentPrice = closes[closes.length - 1];
    const recentCandles = candles.slice(-10);
    const deviations = recentCandles.map(c => Math.abs(c.close - ema20) / ema20 * 100);
    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;
    return avgDeviation;
}

// =====================================================================
// === FUNÇÕES AVANÇADAS DE DIVERGÊNCIA RSI ===
// =====================================================================
function findSignificantPivots(values, minStrength = 0.5) {
    const pivots = { highs: [], lows: [] };
    if (values.length < 5) return pivots;
    for (let i = 2; i < values.length - 2; i++) {
        const curr = values[i];
        const p2 = values[i-2], p1 = values[i-1];
        const n1 = values[i+1], n2 = values[i+2];
        if (curr > p1 && curr > p2 && curr > n1 && curr > n2) {
            const avg = (p2 + p1 + n1 + n2) / 4;
            const strength = ((curr - avg) / avg) * 100;
            if (strength >= minStrength) pivots.highs.push({ index: i, value: curr, strength });
        }
        if (curr < p1 && curr < p2 && curr < n1 && curr < n2) {
            const avg = (p2 + p1 + n1 + n2) / 4;
            const strength = ((avg - curr) / avg) * 100;
            if (strength >= minStrength) pivots.lows.push({ index: i, value: curr, strength });
        }
    }
    return pivots;
}

function isExtremeRSI(value, type) {
    if (type === 'bullish') return value <= CONFIG.RSI.EXTREME_OVERSOLD;
    else return value >= CONFIG.RSI.EXTREME_OVERBOUGHT;
}

function isPivotRecent(index, totalLength, timeframe) {
    if (!CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) return true;
    const maxBack = CONFIG.ALERTS.DIVERGENCE_RECENCY.MAX_CANDLES_BACK[timeframe] || 12;
    const candlesBack = totalLength - index;
    return candlesBack <= maxBack;
}

function detectAdvancedDivergences(prices, rsiValues, timeframe) {
    const divergences = [];
    if (prices.length < 20 || rsiValues.length < 20) return divergences;
    const pricePivots = findSignificantPivots(prices, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH);
    const rsiPivots = findSignificantPivots(rsiValues, CONFIG.RSI_DIVERGENCE.MIN_PIVOT_STRENGTH * 2);
    const multiplier = CONFIG.RSI_DIVERGENCE.SCORE_MULTIPLIER[timeframe] || 1;

    // Divergências Regulares - Bullish
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        if (prevPriceLow.index < lastPriceLow.index && prevRSILow.index < lastRSILow.index) {
            if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
                const isRecent = isPivotRecent(lastPriceLow.index, prices.length, timeframe);
                let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                
                if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) {
                    score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                }
                
                divergences.push({ timeframe, type: 'bullish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📈', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                   rsiValue: lastRSILow.value, priceValue: lastPriceLow.value, isRecent });
            }
        }
    }
    
    // Divergências Regulares - Bearish
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        if (prevPriceHigh.index < lastPriceHigh.index && prevRSIHigh.index < lastRSIHigh.index) {
            if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
                const isRecent = isPivotRecent(lastPriceHigh.index, prices.length, timeframe);
                let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                
                if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) {
                    score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                }
                
                divergences.push({ timeframe, type: 'bearish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📉', strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                                   rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value, isRecent });
            }
        }
    }

    // Divergências Ocultas - Bullish
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        if (prevPriceLow.index < lastPriceLow.index && prevRSILow.index < lastRSILow.index) {
            if (lastPriceLow.value > prevPriceLow.value && lastRSILow.value < prevRSILow.value) {
                const rsiExtreme = isExtremeRSI(lastRSILow.value, 'bullish');
                if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                    const isRecent = isPivotRecent(lastPriceLow.index, prices.length, timeframe);
                    let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.HIDDEN_DIVERGENCE_MULTIPLIER;
                    
                    if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) {
                        score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                    }
                    
                    divergences.push({ timeframe, type: 'bullish', subtype: 'hidden', score: Math.round(score * 10) / 10,
                                       emoji: '🔮', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                       rsiValue: lastRSILow.value, priceValue: lastPriceLow.value, extreme: rsiExtreme, isRecent });
                }
            }
        }
    }
    
    // Divergências Ocultas - Bearish
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        if (prevPriceHigh.index < lastPriceHigh.index && prevRSIHigh.index < lastRSIHigh.index) {
            if (lastPriceHigh.value < prevPriceHigh.value && lastRSIHigh.value > prevRSIHigh.value) {
                const rsiExtreme = isExtremeRSI(lastRSIHigh.value, 'bearish');
                if (!CONFIG.RSI_DIVERGENCE.REQUIRE_EXTREME_FOR_HIDDEN || rsiExtreme) {
                    const isRecent = isPivotRecent(lastPriceHigh.index, prices.length, timeframe);
                    let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.HIDDEN_DIVERGENCE_MULTIPLIER;
                    
                    if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) {
                        score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                    }
                    
                    divergences.push({ timeframe, type: 'bearish', subtype: 'hidden', score: Math.round(score * 10) / 10,
                                       emoji: '🔮', strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                                       rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value, extreme: rsiExtreme, isRecent });
                }
            }
        }
    }
    return divergences;
}

// =====================================================================
// === FUNÇÕES ADICIONAIS (LSR, Funding, Stop Loss, etc.) ===
// =====================================================================
function checkLSRPenalty(lsr, isGreenAlert) {
    if (!lsr) return { hasPenalty: false, points: 0, message: '' };
    if (isGreenAlert && lsr > CONFIG.LSR_PENALTY.BUY_MAX_RATIO) {
        return { hasPenalty: true, points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
                 message: `LSR ${lsr.toFixed(2)}` };
    }
    if (!isGreenAlert && lsr < CONFIG.LSR_PENALTY.SELL_MIN_RATIO) {
        return { hasPenalty: true, points: CONFIG.LSR_PENALTY.PENALTY_POINTS,
                 message: `LSR ${lsr.toFixed(2)}` };
    }
    return { hasPenalty: false, points: 0, message: '' };
}

function checkFundingPenalty(funding, isGreenAlert) {
    if (!CONFIG.FUNDING_PENALTY.ENABLED || funding === null || funding === undefined) {
        return { hasPenalty: false, points: 0, message: '' };
    }
    const fundingPercent = funding * 100;
    let penaltyPoints = 0;
    let penaltyMessage = '';
    
    if (isGreenAlert && funding > 0 && CONFIG.FUNDING_PENALTY.BUY_PENALTY_FOR_POSITIVE) {
        const absFunding = funding;
        if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.HIGH.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.HIGH.POINTS;
            penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.MEDIUM.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.MEDIUM.POINTS;
            penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.LOW.POINTS;
            penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.VERY_LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.POSITIVE.VERY_LOW.POINTS;
            penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`;
        }
    }
    
    if (!isGreenAlert && funding < 0 && CONFIG.FUNDING_PENALTY.SELL_PENALTY_FOR_NEGATIVE) {
        const absFunding = Math.abs(funding);
        if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.HIGH.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.HIGH.POINTS;
            penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.MEDIUM.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.MEDIUM.POINTS;
            penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.LOW.POINTS;
            penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`;
        } else if (absFunding >= CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.VERY_LOW.THRESHOLD) {
            penaltyPoints = CONFIG.FUNDING_PENALTY.LEVELS.NEGATIVE.VERY_LOW.POINTS;
            penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`;
        }
    }
    
    if (penaltyPoints !== 0) {
        return { hasPenalty: true, points: penaltyPoints, message: penaltyMessage };
    }
    
    return { hasPenalty: false, points: 0, message: '' };
}

async function check15MinVolatility(symbol) {
    if (!CONFIG.ALERTS.MIN_15M_VOLATILITY.ENABLED) return { passed: true, message: '', metrics: {} };
    try {
        const candles15m = await getCandles(symbol, '15m', 30);
        if (!candles15m || candles15m.length < 20) {
            return { passed: false, message: 'Dados insuficientes 15m', metrics: {} };
        }
        const trValues = [];
        for (let i = 1; i < candles15m.length; i++) {
            const high = candles15m[i].high;
            const low = candles15m[i].low;
            const prevClose = candles15m[i-1].close;
            trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
        }
        const recentTR = trValues.slice(-14);
        const atr = recentTR.reduce((a, b) => a + b, 0) / recentTR.length;
        const currentPrice = candles15m[candles15m.length - 1].close;
        const atrPercent = (atr / currentPrice) * 100;
        const minATR = CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_ATR_PERCENT;
        const atrPassed = atrPercent >= minATR;
        
        const bb = calculateBollingerBands(candles15m, 20, 2);
        let bbWidth = 0;
        if (bb.middle && bb.middle > 0) {
            bbWidth = ((bb.upper - bb.lower) / bb.middle) * 100;
        }
        const minBBWidth = CONFIG.ALERTS.MIN_15M_VOLATILITY.MIN_BB_WIDTH_PERCENT;
        const bbPassed = bbWidth >= minBBWidth;
        
        const passed = atrPassed && bbPassed;
        let message = '';
        if (!passed) {
            message = `⚠️ Baixa volatilidade 15m: ATR=${atrPercent.toFixed(2)}% (min ${minATR}%), BB Width=${bbWidth.toFixed(2)}% (min ${minBBWidth}%)`;
        }
        return { passed, message, metrics: { atrPercent, atrPassed, bbWidth, bbPassed } };
    } catch (error) {
        log(`Erro ao verificar volatilidade 15m para ${symbol}: ${error.message}`, 'error');
        return { passed: false, message: 'Erro na verificação 15m', metrics: {} };
    }
}

function computeStopAndTargets(currentPrice, isGreenAlert, timeframe, candles) {
    const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 3.0;
    const minStopPercent = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 2.0;
    const maxStopPercent = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 7.0;
    
    if (!candles || candles.length < 20) {
        const defaultAtr = currentPrice * 0.02;
        const stop = isGreenAlert ? currentPrice - defaultAtr * atrMultiplier : currentPrice + defaultAtr * atrMultiplier;
        const atr = defaultAtr;
        let tp1, tp2, tp3;
        if (isGreenAlert) {
            tp1 = currentPrice + atr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice + atr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice + atr * CONFIG.TARGETS.TP3_MULTIPLIER;
        } else {
            tp1 = currentPrice - atr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice - atr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice - atr * CONFIG.TARGETS.TP3_MULTIPLIER;
        }
        
        let stopDistance = Math.abs(currentPrice - stop) / currentPrice * 100;
        let finalStop = stop;
        if (stopDistance < minStopPercent) {
            finalStop = isGreenAlert ? currentPrice * (1 - minStopPercent / 100) : currentPrice * (1 + minStopPercent / 100);
        } else if (stopDistance > maxStopPercent) {
            finalStop = isGreenAlert ? currentPrice * (1 - maxStopPercent / 100) : currentPrice * (1 + maxStopPercent / 100);
        }
        
        return { stop: finalStop, tp1, tp2, tp3 };
    }

    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = trValues.slice(-14).reduce((a, b) => a + b, 0) / 14;

    let stopPrice = isGreenAlert ? currentPrice - (atr * atrMultiplier)
                                 : currentPrice + (atr * atrMultiplier);

    const lookback = timeframe === '1w' ? 12 : (timeframe === '3d' ? 15 : (timeframe === '1d' ? 20 : (timeframe === '4h' ? 30 : 40)));
    const relevantCandles = candles.slice(-lookback);
    let structureLow = Math.min(...relevantCandles.map(c => c.low));
    let structureHigh = Math.max(...relevantCandles.map(c => c.high));
    const touchCount = {};
    relevantCandles.forEach(c => {
        const lowKey = Math.round(c.low * 1000) / 1000;
        const highKey = Math.round(c.high * 1000) / 1000;
        touchCount[lowKey] = (touchCount[lowKey] || 0) + 1;
        touchCount[highKey] = (touchCount[highKey] || 0) + 1;
    });
    let clusterZone = isGreenAlert ? structureLow : structureHigh;
    let maxTouches = 0;
    Object.entries(touchCount).forEach(([price, touches]) => {
        const priceNum = parseFloat(price);
        if (isGreenAlert && priceNum < currentPrice && priceNum > structureLow * 0.95) {
            if (touches > maxTouches) { maxTouches = touches; clusterZone = priceNum; }
        } else if (!isGreenAlert && priceNum > currentPrice && priceNum < structureHigh * 1.05) {
            if (touches > maxTouches) { maxTouches = touches; clusterZone = priceNum; }
        }
    });

    if (isGreenAlert) {
        const clusterAdjustedStop = Math.min(stopPrice, clusterZone - (clusterZone * 0.002));
        if (clusterZone < currentPrice) stopPrice = Math.min(stopPrice, clusterAdjustedStop);
        let stopDistance = (currentPrice - stopPrice) / currentPrice * 100;
        if (stopDistance < minStopPercent) stopPrice = currentPrice * (1 - minStopPercent / 100);
        else if (stopDistance > maxStopPercent) stopPrice = currentPrice * (1 - maxStopPercent / 100);
    } else {
        const clusterAdjustedStop = Math.max(stopPrice, clusterZone + (clusterZone * 0.002));
        if (clusterZone > currentPrice) stopPrice = Math.max(stopPrice, clusterAdjustedStop);
        let stopDistance = (stopPrice - currentPrice) / currentPrice * 100;
        if (stopDistance < minStopPercent) stopPrice = currentPrice * (1 + minStopPercent / 100);
        else if (stopDistance > maxStopPercent) stopPrice = currentPrice * (1 + maxStopPercent / 100);
    }

    let tp1, tp2, tp3;
    if (isGreenAlert) {
        tp1 = currentPrice + atr * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice + atr * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice + atr * CONFIG.TARGETS.TP3_MULTIPLIER;
    } else {
        tp1 = currentPrice - atr * CONFIG.TARGETS.TP1_MULTIPLIER;
        tp2 = currentPrice - atr * CONFIG.TARGETS.TP2_MULTIPLIER;
        tp3 = currentPrice - atr * CONFIG.TARGETS.TP3_MULTIPLIER;
    }

    return { stop: stopPrice, tp1, tp2, tp3 };
}

// =====================================================================
// === BOLLINGER BANDS (15m) COM CONFIRMAÇÃO DE CANDLE E MEMÓRIA ===
// =====================================================================
function calculateBollingerBands(candles, period, stdDev) {
    if (!candles || candles.length < period) {
        return { upper: null, middle: null, lower: null };
    }
    const closes = candles.map(c => c.close);
    const sma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
    const variance = closes.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    const upper = sma + (stdDev * sd);
    const lower = sma - (stdDev * sd);
    return { upper, middle: sma, lower };
}

async function checkBollingerWithMemory(symbol, isGreenAlert, divergenceScore, studyData) {
    if (!CONFIG.ALERTS.BOLLINGER.ENABLED) return { passed: true, message: '', candleConfirmed: true, shouldStudy: false };
    
    try {
        const candles = await getCandles(symbol, CONFIG.ALERTS.BOLLINGER.TIMEFRAME, CONFIG.ALERTS.BOLLINGER.PERIOD + 5);
        if (!candles || candles.length < CONFIG.ALERTS.BOLLINGER.PERIOD) {
            return { passed: false, message: 'Dados insuficientes para Bollinger Bands', candleConfirmed: false, shouldStudy: false };
        }
        
        const bb = calculateBollingerBands(candles, CONFIG.ALERTS.BOLLINGER.PERIOD, CONFIG.ALERTS.BOLLINGER.STD_DEV);
        if (bb.upper === null || bb.lower === null) {
            return { passed: false, message: 'Falha no cálculo das Bollinger Bands', candleConfirmed: false, shouldStudy: false };
        }
        
        const currentCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        const currentPrice = currentCandle.close;
        
        let passed = false;
        let message = '';
        let candleConfirmed = false;
        let shouldStudy = false;
        
        const direction = isGreenAlert ? 'COMPRA' : 'VENDA';
        
        if (isGreenAlert) {
            const touchedLowerBand = currentPrice <= bb.lower;
            
            if (touchedLowerBand && currentCandle.close > previousCandle.low) {
                // TOCOU NA BANDA INFERIOR COM CANDLE DE ALTA - ESTUDAR
                passed = false; // Não alerta ainda, só estuda
                shouldStudy = true;
                candleConfirmed = true;
                message = `📚 ESTUDO: ${symbol} tocou banda inferior (${formatPrice(currentPrice)} ≤ ${formatPrice(bb.lower)}) com divergência de COMPRA. Aguardando confirmação EMA 3m...`;
                log(`📝 ${symbol} - Registrando estudo para ${direction}`, 'info');
            } else if (touchedLowerBand) {
                shouldStudy = true;
                message = `📚 ESTUDO: ${symbol} tocou banda inferior mas candle não confirmado. Aguardando...`;
            } else {
                message = `❌ Preço ($${formatPrice(currentPrice)}) acima da banda inferior ($${formatPrice(bb.lower)})`;
            }
        } else {
            const touchedUpperBand = currentPrice >= bb.upper;
            
            if (touchedUpperBand && currentCandle.close < previousCandle.high) {
                // TOCOU NA BANDA SUPERIOR COM CANDLE DE BAIXA - ESTUDAR
                passed = false; // Não alerta ainda, só estuda
                shouldStudy = true;
                candleConfirmed = true;
                message = `📚 ESTUDO: ${symbol} tocou banda superior (${formatPrice(currentPrice)} ≥ ${formatPrice(bb.upper)}) com divergência de VENDA. Aguardando confirmação EMA 3m...`;
                log(`📝 ${symbol} - Registrando estudo para ${direction}`, 'info');
            } else if (touchedUpperBand) {
                shouldStudy = true;
                message = `📚 ESTUDO: ${symbol} tocou banda superior mas candle não confirmado. Aguardando...`;
            } else {
                message = `❌ Preço ($${formatPrice(currentPrice)}) abaixo da banda superior ($${formatPrice(bb.upper)})`;
            }
        }
        
        return { passed, message, bands: bb, candleConfirmed, shouldStudy, touchedBollinger: (isGreenAlert ? currentPrice <= bb.lower : currentPrice >= bb.upper), bbLower: bb.lower, bbUpper: bb.upper };
        
    } catch (error) {
        log(`Erro ao verificar Bollinger para ${symbol}: ${error.message}`, 'error');
        return { passed: false, message: 'Erro na verificação Bollinger', candleConfirmed: false, shouldStudy: false };
    }
}

// =====================================================================
// === BUSCAR CANDLES COM CACHE ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const cacheKey = `candles_${symbol}_${interval}_${limit}`;
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const data = await rateLimiter.makeRequest(url, cacheKey);
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
// === DADOS ADICIONAIS ===
// =====================================================================
async function getAdditionalData(symbol, currentPrice, candles1h, candles3m, candlesDaily, candles4h, candles15m) {
    try {
        const volume1h = analyzeVolumeWithEMA(candles1h);
        const volume3m = analyzeVolumeWithEMA(candles3m);
        const rsi = calculateRSI(candles1h, CONFIG.RSI.PERIOD);
        const stochDaily = calculateStochastic(candlesDaily, CONFIG.STOCHASTIC.DAILY.K_PERIOD,
                                               CONFIG.STOCHASTIC.DAILY.K_SMOOTH, CONFIG.STOCHASTIC.DAILY.D_PERIOD);
        const stoch4h = calculateStochastic(candles4h, CONFIG.STOCHASTIC.FOUR_HOUR.K_PERIOD,
                                            CONFIG.STOCHASTIC.FOUR_HOUR.K_SMOOTH, CONFIG.STOCHASTIC.FOUR_HOUR.D_PERIOD);
        const stoch1h = calculateStochastic(candles1h, CONFIG.STOCHASTIC.ONE_HOUR.K_PERIOD,
                                            CONFIG.STOCHASTIC.ONE_HOUR.K_SMOOTH, CONFIG.STOCHASTIC.ONE_HOUR.D_PERIOD);
        const stoch1dFormatted = formatStochastic(stochDaily);
        const stoch4hFormatted = formatStochastic(stoch4h);
        const stoch1hFormatted = formatStochastic(stoch1h);
        
        const cci4h = calculateCCIWithEMA(candles4h, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD);
        const cciDaily = calculateCCIWithEMA(candlesDaily, CONFIG.CCI.PERIOD, CONFIG.CCI.EMA_PERIOD);
        
        const volumes1h = candles1h.map(c => c.volume);
        const avgVolume1h = volumes1h.slice(-24).reduce((a, b) => a + b, 0) / 24;
        const currentVolume1h = volumes1h[volumes1h.length - 1] || 0;
        const volumeRatio1h = avgVolume1h > 0 ? currentVolume1h / avgVolume1h : 1;
        const volumeUSDT1h = currentVolume1h * currentPrice;
        const volumes3m = candles3m.map(c => c.volume);
        const avgVolume3m = volumes3m.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentVolume3m = volumes3m[volumes3m.length - 1] || 0;
        const volumeRatio3m = avgVolume3m > 0 ? currentVolume3m / avgVolume3m : 1;
        const volume24hUSDT = volumes1h.slice(-24).reduce((sum, vol) => sum + (vol * currentPrice), 0);
        let lsr = null;
        try {
            const lsrData = await rateLimiter.makeRequest(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`, `lsr_${symbol}`);
            lsr = lsrData.length > 0 ? parseFloat(lsrData[0].longShortRatio) : null;
        } catch {}
        let funding = null;
        try {
            const fundingData = await rateLimiter.makeRequest(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`, `funding_${symbol}`);
            funding = parseFloat(fundingData.lastFundingRate) || null;
        } catch {}
        const volumeChangePct = ((volumeRatio1h - 1) * 100);
        const volume24hPct = volumeChangePct > 0 ? `+${volumeChangePct.toFixed(0)}%` : `${volumeChangePct.toFixed(0)}%`;
        const trendStrength = checkTrendStrength(candles1h);
        return {
            rsi, stoch1d: stoch1dFormatted, stoch4h: stoch4hFormatted, stoch1h: stoch1hFormatted,
            stochDailyValues: stochDaily, stoch4hValues: stoch4h, stoch1hValues: stoch1h,
            cci4h, cciDaily,
            volume1h: { ratio: volumeRatio1h, percentage: volume1h.percentage, text: volume1h.text,
                        direction: volume1h.direction, emoji: volume1h.emoji, ratioFormatted: volumeRatio1h.toFixed(2),
                        usdt: volumeUSDT1h },
            volume3m: { ratio: volumeRatio3m, percentage: volume3m.percentage, text: volume3m.text,
                        direction: volume3m.direction, emoji: volume3m.emoji, ratioFormatted: volumeRatio3m.toFixed(2) },
            volume24h: { pct: volume24hPct, text: volume1h.text, usdt: volume24hUSDT },
            trendStrength, lsr, funding,
            candles1h, candles4h, candlesDaily, candles15m
        };
    } catch (error) {
        log(`Erro em getAdditionalData para ${symbol}: ${error.message}`, 'error');
        return {
            rsi: 50, stoch1d: 'K50⤵️D55 🟡', stoch4h: 'K50⤵️D55 🟡', stoch1h: 'K50⤵️D55 🟡',
            stochDailyValues: { k: 50, d: 55 }, stoch4hValues: { k: 50, d: 55 }, stoch1hValues: { k: 50, d: 55 },
            cci4h: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            cciDaily: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00', usdt: 0 },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro', usdt: 0 },
            trendStrength: 0, lsr: null, funding: null,
            candles1h: [], candles4h: [], candlesDaily: [], candles15m: []
        };
    }
}

// =====================================================================
// === VERIFICAÇÃO DE COOLDOWN ===
// =====================================================================
function isCooldownActive(symbol, direction, timeframe) {
    const now = Date.now();
    const globalKey = `${symbol}_ANY`;
    const lastGlobal = alertCache.get(globalKey);
    if (lastGlobal) {
        const minutesDiff = (now - lastGlobal.timestamp) / (1000 * 60);
        if (minutesDiff < 15) {
            log(`⏱️ Cooldown global ativo para ${symbol} (${minutesDiff.toFixed(1)}min < 30min)`, 'warning');
            return true;
        }
    }
    const specificKey = `${symbol}_${direction}_${timeframe}`;
    const lastSpecific = alertCache.get(specificKey);
    if (lastSpecific) {
        const minutesDiff = (now - lastSpecific.timestamp) / (1000 * 60);
        const required = CONFIG.ALERTS.COOLDOWN_BY_TIMEFRAME[timeframe] || 30;
        if (minutesDiff < required) {
            log(`⏱️ Cooldown ${timeframe} ativo para ${symbol} ${direction} (${minutesDiff.toFixed(1)}min < ${required}min)`, 'warning');
            return true;
        }
    }
    return false;
}

// =====================================================================
// === VERIFICAÇÃO DE LIMITE DIÁRIO ===
// =====================================================================
function isDailyLimitReached(symbol) {
    const dailyKey = `${symbol}_daily`;
    const count = dailyCounter.get(dailyKey) || 0;
    const limit = getDailyLimit(symbol);
    if (count >= limit) {
        log(`📅 Limite diário atingido para ${symbol}: ${count}/${limit}`, 'warning');
        return true;
    }
    return false;
}

// =====================================================================
// === VERIFICAÇÃO DE SCORE MÍNIMO ===
// =====================================================================
function isMinimumScoreReached(score) {
    const minScore = CONFIG.ALERTS.MIN_SCORE_TO_ALERT;
    if (score < minScore) {
        log(`📊 Score insuficiente: ${score.toFixed(1)} < ${minScore} - Alerta bloqueado`, 'warning');
        return false;
    }
    return true;
}

// =====================================================================
// === VERIFICAÇÃO DE DIREÇÃO DO VOLUME ===
// =====================================================================
function checkVolumeDirection(volume1h, isGreenAlert) {
    if (!CONFIG.ALERTS.VOLUME_DIRECTION.REQUIRE_VOLUME_DIRECTION) {
        return { passed: true, message: '' };
    }
    
    const buyerPercentage = volume1h.percentage;
    
    if (isGreenAlert) {
        const minBuyer = CONFIG.ALERTS.VOLUME_DIRECTION.BUY_MIN_PERCENTAGE;
        if (buyerPercentage >= minBuyer) {
            return { passed: true, message: `Volume comprador ${buyerPercentage.toFixed(1)}% ≥ ${minBuyer}%` };
        } else {
            return { passed: false, message: `❌ Volume comprador insuficiente: ${buyerPercentage.toFixed(1)}% < ${minBuyer}%` };
        }
    } else {
        const maxBuyer = CONFIG.ALERTS.VOLUME_DIRECTION.SELL_MAX_PERCENTAGE;
        const sellerPercentage = 100 - buyerPercentage;
        const minSeller = 100 - maxBuyer;
        if (buyerPercentage <= maxBuyer) {
            return { passed: true, message: `Volume vendedor ${sellerPercentage.toFixed(1)}% ≥ ${minSeller}%` };
        } else {
            return { passed: false, message: `❌ Volume vendedor insuficiente: ${sellerPercentage.toFixed(1)}% < ${minSeller}%` };
        }
    }
}

// =====================================================================
// === REGISTRAR ALERTA ===
// =====================================================================
function registerAlert(symbol, direction, price, timeframe) {
    const now = Date.now();
    const key = `${symbol}_${direction}_${timeframe}`;
    const symbolKey = `${symbol}_ANY`;
    const priceKey = `${symbol}_price`;
    const dailyKey = `${symbol}_daily`;
    alertCache.set(key, { timestamp: now, timeframe, direction });
    alertCache.set(symbolKey, { timestamp: now, timeframe: 'ANY', direction });
    alertCache.set(priceKey, { price, timestamp: now });
    const newCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, newCount);
    saveDailyCounters();
    alertsSentThisScan++;
    for (const [k, v] of alertCache) {
        if (now - v.timestamp > 48 * 60 * 60 * 1000) alertCache.delete(k);
    }
    log(`Registrado alerta ${symbol} ${direction} [${timeframe}] #${newCount} do dia`, 'success');
    return newCount;
}

// =====================================================================
// === SISTEMA DE FILAS PRIORITÁRIAS ===
// =====================================================================
function queueAlert(alert) {
    const priority = getPriorityLevel(alert.confirmationScore);
    priorityQueue[priority].push(alert);
    log(`Alerta ${alert.symbol} [${alert.timeframe}] adicionado à fila ${priority} (score ${alert.confirmationScore})`, 'info');
}

async function processPriorityQueue() {
    if (isSendingTelegram) return;
    isSendingTelegram = true;
    const priorities = ['critical', 'high', 'medium', 'low'];
    for (const priority of priorities) {
        const alerts = priorityQueue[priority];
        if (alerts.length === 0) continue;
        log(`Processando ${alerts.length} alertas ${priority}...`, 'info');
        if (priority === 'low' && alerts.length > 3) {
            await sendGroupedAlerts(alerts, priority);
        } else {
            for (const alert of alerts) {
                await sendSingleAlert(alert);
                await new Promise(r => setTimeout(r, CONFIG.ALERTS.TELEGRAM_DELAY_MS));
            }
        }
        priorityQueue[priority] = [];
    }
    isSendingTelegram = false;
}

async function sendSingleAlert(alert) {
    const message = formatAlert(alert);
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        if (!response.ok) {
            const errorData = await response.text();
            log(`Erro Telegram: ${response.status}`, 'error');
        } else {
            const direction = alert.direction.includes('COMPRA') ? 'COMPRA' : 'VENDA';
            const tf = alert.timeframe === 'MULTI' ? 'MULTI' : alert.timeframe;
            const newCount = registerAlert(alert.symbol, direction, alert.price, tf);
            alert.displayDailyCount = newCount;
            const penaltyIcon = alert.totalPenalty < 0 ? '⚠️' : '✅';
            const cvdType = alert.cvdIsReal ? 'REAL' : 'SIM';
            log(`${penaltyIcon} ALERTA ENVIADO: ${alert.direction} ${alert.symbol} [${alert.timeframe}] - Score: ${alert.confirmationScore} | CVD: ${alert.cvdConfirmed ? '✅' : '❌'} (${cvdType}) | Volume: ${alert.volume1h.direction} (${alert.volume1h.percentage.toFixed(1)}%) | Penalidades: ${alert.totalPenalty}`, 'success');
        }
        return true;
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
        return false;
    }
}

async function sendGroupedAlerts(alerts, priority) {
    if (alerts.length === 0) return;
    const buyAlerts = alerts.filter(a => a.direction.includes('COMPRA'));
    const sellAlerts = alerts.filter(a => a.direction.includes('CORREÇÃO'));
    let message = `<i>📊 **ALERTAS AGRUPADOS (${priority.toUpperCase()})**\n\n`;
    if (buyAlerts.length > 0) {
        message += `🟢 **COMPRA** (${buyAlerts.length})\n`;
        buyAlerts.slice(0, 5).forEach(a => {
            const cvdType = a.cvdIsReal ? '🔴' : '🟡';
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore} | CVD: ${a.cvdConfirmed ? '✅' : '❌'} ${cvdType} | Vol: ${a.volume1h.direction} (${a.volume1h.percentage.toFixed(1)}%) | Penal: ${a.totalPenalty}\n`;
        });
        if (buyAlerts.length > 5) message += `... e mais ${buyAlerts.length - 5}\n`;
        message += '\n';
    }
    if (sellAlerts.length > 0) {
        message += `🔴 **VENDA** (${sellAlerts.length})\n`;
        sellAlerts.slice(0, 5).forEach(a => {
            const cvdType = a.cvdIsReal ? '🔴' : '🟡';
            message += `• ${a.symbol.replace('USDT', '')} [${a.timeframe}] Score: ${a.confirmationScore} | CVD: ${a.cvdConfirmed ? '✅' : '❌'} ${cvdType} | Vol: ${(100 - a.volume1h.percentage).toFixed(1)}% vendedor | Penal: ${a.totalPenalty}\n`;
        });
        if (sellAlerts.length > 5) message += `... e mais ${sellAlerts.length - 5}\n`;
    }
    message += `\nAlerta Educativo, não é recomendação.</i>`;
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        log(`Alerta agrupado enviado com ${alerts.length} sinais`, 'success');
    } catch (error) {
        log(`Erro ao enviar alerta agrupado: ${error.message}`, 'error');
    }
}

// =====================================================================
// === FUNÇÃO PARA IDENTIFICAR CLUSTERS ===
// =====================================================================
function findClusterLevels(candles, currentPrice, tolerancePercent = 0.5, maxClusters = 2) {
    const allSupports = [];
    const allResistances = [];
    const tolerance = tolerancePercent / 100;

    for (const candle of candles) {
        const low = candle.low;
        const high = candle.high;

        if (low < currentPrice) {
            let foundSupport = false;
            for (const cluster of allSupports) {
                const diffPercent = Math.abs(low - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + low;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundSupport = true;
                    break;
                }
            }
            if (!foundSupport) {
                allSupports.push({ avgPrice: low, touches: 1 });
            }
        }

        if (high > currentPrice) {
            let foundResistance = false;
            for (const cluster of allResistances) {
                const diffPercent = Math.abs(high - cluster.avgPrice) / cluster.avgPrice;
                if (diffPercent <= tolerance) {
                    const total = cluster.avgPrice * cluster.touches + high;
                    cluster.touches++;
                    cluster.avgPrice = total / cluster.touches;
                    foundResistance = true;
                    break;
                }
            }
            if (!foundResistance) {
                allResistances.push({ avgPrice: high, touches: 1 });
            }
        }
    }

    allSupports.sort((a, b) => b.touches - a.touches);
    allResistances.sort((a, b) => b.touches - a.touches);

    return {
        supports: allSupports.slice(0, maxClusters),
        resistances: allResistances.slice(0, maxClusters)
    };
}

// =====================================================================
// === ANALISAR TIMEFRAME ===
// =====================================================================
async function analyzeDivergenceTimeframe(symbol, candles, timeframe, allCandles) {
    try {
        if (!candles || candles.length < 40) return null;
        const currentPrice = candles[candles.length - 1].close;
        const rsiValues = [];
        const prices = [];
        for (let i = CONFIG.RSI.PERIOD; i < candles.length; i++) {
            rsiValues.push(calculateRSI(candles.slice(0, i + 1), CONFIG.RSI.PERIOD));
            prices.push(candles[i].close);
        }
        if (rsiValues.length < 25) return null;
        const divergences = detectAdvancedDivergences(prices, rsiValues, timeframe);
        if (divergences.length === 0) return null;
        const bestDiv = divergences.reduce((a, b) => a.score > b.score ? a : b);
        const isGreenAlert = bestDiv.type === 'bullish';
        const direction = isGreenAlert ? 'COMPRA' : 'VENDA';

        const clusters = findClusterLevels(candles, currentPrice, 0.5, 2);

        const candles1h = allCandles['1h'];
        const candles3m = allCandles['3m'];
        const candlesDaily = allCandles['1d'];
        const candles4h = allCandles['4h'];
        const candles15m = allCandles['15m'];

        const additional = await getAdditionalData(symbol, currentPrice, candles1h, candles3m, candlesDaily, candles4h, candles15m);

        let volatilityWarning = null;
        if (CONFIG.ALERTS.MIN_15M_VOLATILITY.CHECK_TIMEFRAMES.includes(timeframe)) {
            const volatilityCheck = await check15MinVolatility(symbol);
            if (!volatilityCheck.passed) {
                volatilityWarning = volatilityCheck.message;
            }
        }

        const lsrPenalty = checkLSRPenalty(additional.lsr, isGreenAlert);
        const fundingPenalty = checkFundingPenalty(additional.funding, isGreenAlert);
        let confirmationScore = bestDiv.score;
        let totalPenalty = 0;
        let penaltyMessages = [];

        if (lsrPenalty.hasPenalty) {
            confirmationScore += lsrPenalty.points;
            totalPenalty += lsrPenalty.points;
            penaltyMessages.push(lsrPenalty.message);
        }
        if (fundingPenalty.hasPenalty) {
            confirmationScore += fundingPenalty.points;
            totalPenalty += fundingPenalty.points;
            penaltyMessages.push(fundingPenalty.message);
        }
        if (totalPenalty < CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY) {
            const excess = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY - totalPenalty;
            confirmationScore -= excess;
            totalPenalty = CONFIG.FUNDING_PENALTY.MAX_TOTAL_PENALTY;
        }

        let cciScoreAdjustment = 0;
        if (isGreenAlert && additional.cci4h.trend === 'ALTA') cciScoreAdjustment += 1;
        if (isGreenAlert && additional.cci4h.trend === 'BAIXA') cciScoreAdjustment -= 1;
        if (!isGreenAlert && additional.cci4h.trend === 'BAIXA') cciScoreAdjustment += 1;
        if (!isGreenAlert && additional.cci4h.trend === 'ALTA') cciScoreAdjustment -= 1;
        if (isGreenAlert && additional.cciDaily.trend === 'ALTA') cciScoreAdjustment += 2;
        if (isGreenAlert && additional.cciDaily.trend === 'BAIXA') cciScoreAdjustment -= 2;
        if (!isGreenAlert && additional.cciDaily.trend === 'BAIXA') cciScoreAdjustment += 2;
        if (!isGreenAlert && additional.cciDaily.trend === 'ALTA') cciScoreAdjustment -= 2;

        confirmationScore += cciScoreAdjustment;
        totalPenalty += cciScoreAdjustment;

        return {
            symbol,
            timeframe,
            timeframeEmoji: timeframe === '1w' ? '' : (timeframe === '3d' ? '' : (timeframe === '1d' ? '' : (timeframe === '4h' ? '' : ''))),
            timeframeText: `#${timeframe.toUpperCase()}`,
            direction: isGreenAlert ? '🟢🔍 Divergência de ALTA' : '🔴🔍 Divergência de BAIXA',
            price: currentPrice,
            isGreenAlert,
            confirmationScore,
            confirmations: `Divergência ${bestDiv.subtype} (${bestDiv.emoji}) com score ${bestDiv.score} ${bestDiv.isRecent ? '✅' : '⚠️'}`,
            divergenceType: bestDiv.subtype,
            divergenceEmoji: bestDiv.emoji,
            rsiValue: bestDiv.rsiValue,
            priceAtDivergence: bestDiv.priceValue,
            isDivergenceRecent: bestDiv.isRecent,
            lsrPenalty: lsrPenalty.hasPenalty,
            fundingPenalty: fundingPenalty.hasPenalty,
            totalPenalty,
            penaltyMessages,
            lsrValue: additional.lsr,
            fundingValue: additional.funding,
            usedTimeframe: timeframe,
            supports: clusters.supports,
            resistances: clusters.resistances,
            cci4h: additional.cci4h,
            cciDaily: additional.cciDaily,
            rsi: additional.rsi,
            stoch1d: additional.stoch1d,
            stoch4h: additional.stoch4h,
            stoch1h: additional.stoch1h,
            volume1h: additional.volume1h,
            volume3m: additional.volume3m,
            volume24h: additional.volume24h,
            trendStrength: additional.trendStrength,
            candles1h, candles4h, candlesDaily, candles15m,
            originalCandles: candles
        };
    } catch (error) {
        log(`Erro em analyzeDivergenceTimeframe ${symbol} [${timeframe}]: ${error.message}`, 'error');
        return null;
    }
}

// =====================================================================
// === BUSCAR TODOS OS CANDLES ===
// =====================================================================
async function fetchAllCandles(symbol) {
    const intervals = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w', '3m'];
    const promises = intervals.map(interval => getCandles(symbol, interval, 100));
    const results = await Promise.all(promises);
    const map = {};
    intervals.forEach((interval, idx) => { map[interval] = results[idx]; });
    return map;
}

// =====================================================================
// === ANALISAR SÍMBOLO COM SISTEMA DE MEMÓRIA ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const allCandles = await fetchAllCandles(symbol);
        
        const divergences = [];
        for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
            const candles = allCandles[tf];
            if (candles && candles.length >= 40) {
                const result = await analyzeDivergenceTimeframe(symbol, candles, tf, allCandles);
                if (result) {
                    divergences.push(result);
                }
            }
        }
        if (divergences.length === 0) return [];

        const bestDivergence = divergences.reduce((a, b) => a.confirmationScore > b.confirmationScore ? a : b);
        let maxScore = bestDivergence.confirmationScore;
        
        const bullishCount = divergences.filter(d => d.isGreenAlert).length;
        const bearishCount = divergences.filter(d => !d.isGreenAlert).length;
        
        const supports = bestDivergence.supports || [];
        const resistances = bestDivergence.resistances || [];
        const currentPrice = bestDivergence.price;
        const proximityThreshold = CONFIG.ALERTS.PROXIMITY_THRESHOLD_PERCENT / 100;
        
        let isNearSupport = false;
        let isNearResistance = false;
        
        for (const s of supports) {
            const distancePercent = (currentPrice - s.avgPrice) / currentPrice;
            if (distancePercent >= 0 && distancePercent <= proximityThreshold) {
                isNearSupport = true;
                break;
            }
        }
        
        for (const r of resistances) {
            const distancePercent = (r.avgPrice - currentPrice) / currentPrice;
            if (distancePercent >= 0 && distancePercent <= proximityThreshold) {
                isNearResistance = true;
                break;
            }
        }
        
        let finalDirection = '';
        let isGreenAlert = false;
        
        if (bullishCount >= 2 && isNearSupport) {
            finalDirection = '🟢 COMPRA';
            isGreenAlert = true;
        } else if (bearishCount >= 2 && isNearResistance) {
            finalDirection = '🔴 CORREÇÃO';
            isGreenAlert = false;
        } else {
            return [];
        }
        
        // ANÁLISE DO CVD (HÍBRIDO: REAL + SIMULADO)
        const cvdAnalysis = await analyzeCVDHybrid(symbol, currentPrice, isGreenAlert);
        
        // VERIFICAÇÃO DE DIREÇÃO DO VOLUME
        const volumeDirectionCheck = checkVolumeDirection(bestDivergence.volume1h, isGreenAlert);
        if (!volumeDirectionCheck.passed) {
            log(`❌ ${symbol} - ${finalDirection} bloqueado: ${volumeDirectionCheck.message}`, 'warning');
            return [];
        }
        
        // PONTUAÇÃO DOS CLUSTERS
        let clusterScoreBonus = 0;
        let clusterInfo = '';
        const maxClusterBonus = CONFIG.ALERTS.CLUSTER_BONUS_LIMITS.MAX_TOTAL_BONUS;
        const perTouchBonus = CONFIG.ALERTS.CLUSTER_BONUS_LIMITS.PER_TOUCH_BONUS;
        const multiClusterBonus = CONFIG.ALERTS.CLUSTER_BONUS_LIMITS.MULTI_CLUSTER_BONUS;

        if (isNearSupport && supports.length > 0) {
            const strongestSupport = supports.reduce((a, b) => a.touches > b.touches ? a : b);
            let bonus = Math.min(maxClusterBonus, strongestSupport.touches * perTouchBonus);
            clusterScoreBonus += bonus;
            clusterInfo += ` 📈 Suporte +${bonus.toFixed(1)} (${strongestSupport.touches} toques)`;
        }

        if (isNearResistance && resistances.length > 0) {
            const strongestResistance = resistances.reduce((a, b) => a.touches > b.touches ? a : b);
            let bonus = Math.min(maxClusterBonus, strongestResistance.touches * perTouchBonus);
            clusterScoreBonus += bonus;
            clusterInfo += ` 📉 Resistência +${bonus.toFixed(1)} (${strongestResistance.touches} toques)`;
        }

        if ((isNearSupport && supports.length >= 2) || (isNearResistance && resistances.length >= 2)) {
            clusterScoreBonus += multiClusterBonus;
            clusterInfo += ` 🔥 Multi-cluster +${multiClusterBonus}`;
        }
        
        clusterScoreBonus = Math.min(maxClusterBonus * 2, clusterScoreBonus);
        maxScore += clusterScoreBonus;
        
        // ADICIONA O SCORE DO CVD
        if (cvdAnalysis.cvdConfirmed) {
            maxScore += cvdAnalysis.cvdScore;
            const cvdType = cvdAnalysis.isReal ? 'REAL' : 'SIM';
            log(`✅ ${symbol} - CVD ${cvdType} confirmado! Bônus +${cvdAnalysis.cvdScore} | Score total: ${maxScore.toFixed(1)}`, 'success');
        }
        
        // VERIFICAÇÃO DE SCORE MÍNIMO
        if (!isMinimumScoreReached(maxScore)) {
            log(`❌ ${symbol} - Score ${maxScore.toFixed(1)} < ${CONFIG.ALERTS.MIN_SCORE_TO_ALERT} - Alerta bloqueado`, 'warning');
            return [];
        }
        
        // =====================================================================
        // === SISTEMA DE MEMÓRIA E CONFIRMAÇÃO EMA ===
        // =====================================================================
        
        const directionStr = finalDirection.includes('COMPRA') ? 'COMPRA' : 'VENDA';
        
        // Primeiro, verifica se já existe um estudo ativo na memória para este símbolo/direção
        const existingStudy = studyMemory.getStudy(symbol, directionStr);
        
        if (existingStudy) {
            // Já temos um estudo ativo - verifica confirmação das EMAs
            log(`📚 ${symbol} - Estudo ativo encontrado para ${directionStr} (desde ${new Date(existingStudy.timestamp).toLocaleString()})`, 'info');
            
            // Verifica confirmação no gráfico 3m
            const emaConfirmation = await checkEMAConfirmation(symbol, directionStr);
            
            if (emaConfirmation.confirmed) {
                // CONFIRMAÇÃO OBTIDA! Envia o alerta com os dados do estudo
                log(`✅ ${symbol} - CONFIRMAÇÃO OBTIDA! Enviando alerta...`, 'success');
                
                // Prepara o estudoData com a confirmação
                const studyData = {
                    ...existingStudy.studyData,
                    emaConfirmation: emaConfirmation,
                    confirmedAt: Date.now()
                };
                
                // Verifica Bollinger novamente para pegar dados atualizados
                const bollingerCheck = await checkBollingerWithMemory(symbol, isGreenAlert, maxScore, studyData);
                
                // Verifica cooldown
                if (isCooldownActive(symbol, directionStr, 'MULTI')) return [];
                if (isDailyLimitReached(symbol)) return [];
                
                // Timeframe para stop
                let timeframeForTargets = '1h';
                let candlesForTargets = allCandles['1h'];
                if (bestDivergence.usedTimeframe && allCandles[bestDivergence.usedTimeframe] && allCandles[bestDivergence.usedTimeframe].length >= 20) {
                    timeframeForTargets = bestDivergence.usedTimeframe;
                    candlesForTargets = allCandles[timeframeForTargets];
                }
                
                const { stop, tp1, tp2, tp3 } = computeStopAndTargets(currentPrice, isGreenAlert, timeframeForTargets, candlesForTargets);
                
                // Pega as bandas do estudo existente
                const bbInfo = existingStudy.bbLower ? 
                    `📊 BB 15m: ${formatPrice(existingStudy.bbLower)} / ${formatPrice((existingStudy.bbLower + existingStudy.bbUpper) / 2)} / ${formatPrice(existingStudy.bbUpper)}` : '';
                
                const allPenaltyMessages = [];
                if (bestDivergence.penaltyMessages) {
                    allPenaltyMessages.push(...bestDivergence.penaltyMessages);
                }
                
                const consolidated = {
                    ...bestDivergence,
                    timeframe: 'MULTI',
                    timeframeEmoji: '✨',
                    timeframeText: '#MULTI',
                    direction: finalDirection,
                    confirmationScore: maxScore,
                    clusterBonus: clusterScoreBonus,
                    clusterInfo: clusterInfo,
                    divergencesList: divergences.map(d => ({
                        timeframe: d.timeframe,
                        type: d.direction,
                        subtype: d.divergenceType,
                        score: d.confirmationScore,
                        rsiValue: d.rsiValue,
                        priceAtDivergence: d.priceAtDivergence,
                        emoji: d.divergenceEmoji,
                        isRecent: d.isDivergenceRecent
                    })),
                    bullishCount,
                    bearishCount,
                    isNearSupport,
                    isNearResistance,
                    finalText: (isGreenAlert ? `Potencial de Compra CONFIRMADO (${bullishCount} divergências de ALTA + suporte)` : `Potencial de Correção CONFIRMADO (${bearishCount} divergências de BAIXA + resistência)`),
                    bollingerMessage: `✅ CONFIRMADO: ${directionStr} após estudo de ${Math.round((Date.now() - existingStudy.timestamp) / 60000)} minutos | ${emaConfirmation.message}`,
                    bollingerInfo: bbInfo,
                    candleConfirmed: true,
                    stopLoss: stop,
                    tp1, tp2, tp3,
                    volume1h: bestDivergence.volume1h,
                    volume3m: bestDivergence.volume3m,
                    volume24h: bestDivergence.volume24h,
                    rsi: bestDivergence.rsi,
                    stoch1d: bestDivergence.stoch1d,
                    stoch4h: bestDivergence.stoch4h,
                    stoch1h: bestDivergence.stoch1h,
                    cci4h: bestDivergence.cci4h,
                    cciDaily: bestDivergence.cciDaily,
                    supports: bestDivergence.supports,
                    resistances: bestDivergence.resistances,
                    lsrValue: bestDivergence.lsrValue,
                    fundingValue: bestDivergence.fundingValue,
                    lsrPenalty: bestDivergence.lsrPenalty,
                    fundingPenalty: bestDivergence.fundingPenalty,
                    totalPenalty: bestDivergence.totalPenalty,
                    penaltyMessages: allPenaltyMessages,
                    cvdConfirmed: cvdAnalysis.cvdConfirmed,
                    cvdScore: cvdAnalysis.cvdScore,
                    cvdSignal: cvdAnalysis.cvdSignal,
                    cvdIsReal: cvdAnalysis.isReal || false,
                    studyInfo: {
                        studiedAt: existingStudy.timestamp,
                        studiedPrice: existingStudy.price,
                        confirmedAt: Date.now(),
                        ema13: emaConfirmation.ema13,
                        ema34: emaConfirmation.ema34,
                        ema55: emaConfirmation.ema55
                    }
                };
                
                // Remove o estudo da memória após o alerta
                studyMemory.removeStudy(symbol, directionStr);
                queueAlert(consolidated);
                return [consolidated];
                
            } else {
                // Ainda aguardando confirmação
                log(`⏳ ${symbol} - Aguardando confirmação EMA para ${directionStr}: ${emaConfirmation.message}`, 'info');
                return [];
            }
        }
        
        // =====================================================================
        // === NÃO TEM ESTUDO ATIVO - VERIFICA BOLLINGER PARA CRIAR NOVO ESTUDO ===
        // =====================================================================
        
        const bollingerCheck = await checkBollingerWithMemory(symbol, isGreenAlert, maxScore, null);
        
        if (bollingerCheck.shouldStudy && CONFIG.ALERTS.MEMORY.ENABLED) {
            // Criar novo estudo na memória
            const studyData = {
                symbol,
                direction: directionStr,
                price: currentPrice,
                bbLower: bollingerCheck.bbLower,
                bbUpper: bollingerCheck.bbUpper,
                divergenceScore: maxScore,
                divergences: divergences.map(d => ({ timeframe: d.timeframe, type: d.direction, subtype: d.divergenceType, score: d.confirmationScore })),
                bullishCount,
                bearishCount,
                isNearSupport,
                isNearResistance,
                supports,
                resistances,
                volume1h: bestDivergence.volume1h,
                rsi: bestDivergence.rsi
            };
            
            studyMemory.addStudy(symbol, directionStr, currentPrice, bollingerCheck.bbLower, bollingerCheck.bbUpper, maxScore, studyData);
            log(`📚 ${symbol} - NOVO ESTUDO registrado para ${directionStr}. Aguardando confirmação EMA...`, 'success');
            return [];
        }
        
        // Se chegou aqui, não tem estudo e não tocou Bollinger - alerta normal? Não, pois queremos só com estudo
        // Então retorna vazio
        return [];
        
    } catch (error) {
        log(`Erro em analyzeSymbol ${symbol}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === FUNÇÃO AUXILIAR PARA CLASSIFICAR FORÇA DO PIVÔ ===
// =====================================================================
function getPivotStrength(touches) {
    if (touches >= 5) return { text: 'FORTE', emoji: '🔥' };
    if (touches >= 3) return { text: 'MEDIANO', emoji: '⚡' };
    return { text: 'FRACO', emoji: '⚠️' };
}

// =====================================================================
// === FORMATAR MENSAGEM COM INFORMAÇÕES DO ESTUDO ===
// =====================================================================
function formatAlert(data) {
    const time = getBrazilianDateTime();
    const symbolName = data.symbol.replace('USDT', '');
    const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${data.symbol}&interval=60`;
    const fundingPct = data.fundingValue ? (data.fundingValue * 100).toFixed(4) : '0.0000';
    const fundingSign = data.fundingValue && data.fundingValue > 0 ? '+' : '';
    const rsiEmoji = data.rsi < 40 ? '🟢' : data.rsi > 60 ? '🔴' : '';
    const lsr = data.lsrValue ? data.lsrValue.toFixed(2) : 'N/A';
    const volumeEmoji = data.volume1h.emoji;
    const volumeDirectionText = data.volume1h.direction !== 'Neutro' ? `${volumeEmoji} ${data.volume1h.direction}` : ' Neutro';
    const volume1hLine = `#Vol 1h: ${data.volume1h.ratioFormatted}x (${data.volume1h.percentage.toFixed(0)}%) ${volumeDirectionText}`;
    const volume3mLine = `#Vol 3m: ${data.volume3m.ratioFormatted}x (${data.volume3m.percentage.toFixed(0)}%) ${data.volume3m.text}`;
    
    let cvdLine = '';
    const cvdTypeIcon = data.cvdIsReal ? '🔴' : '🟡';
    
    if (data.cvdConfirmed) {
        const cvdEmoji = data.cvdSignal?.type === 'bullish' ? '💹' : '🔻';
        cvdLine = `#CVD ${cvdTypeIcon}: ${cvdEmoji} ${data.cvdSignal?.type === 'bullish' ? '#BULL' : '#BEAR'} +${data.cvdScore} ${data.cvdIsReal ? '(REAL)' : '(SIM)'}`;
    } else if (data.cvdSignal && !data.cvdConfirmed) {
        cvdLine = `#CVD🐋 ${cvdTypeIcon}: ⚠️ ${data.cvdSignal.type === 'bullish' ? '#BULL' : '#BEAR'} (não alinhado)`;
    } else {
        cvdLine = `#CVD🐋 ${cvdTypeIcon}: ❌ Indefinido`;
    }
    
    let divergencesText = '';
    if (data.divergencesList && data.divergencesList.length > 0) {
        const tfList = data.divergencesList.map(d => `${d.timeframe}${d.isRecent ? '✅' : '⚠️'}`).join(',');
        divergencesText = `${data.bullishCount + data.bearishCount} divergências (${tfList})`;
    } else {
        divergencesText = `${data.divergenceType}`;
    }
    
    const targets = `🎯 TP1: ${formatPrice(data.tp1)} | TP2: ${formatPrice(data.tp2)} | TP3: ${formatPrice(data.tp3)}`;
    const stop = `⛔ Stop: ${formatPrice(data.stopLoss)} (${((Math.abs(data.stopLoss - data.price) / data.price) * 100).toFixed(1)}%)`;
    
    function getTimeframeIcon(tf) {
        const icons = {
            '1w': '',
            '3d': '',
            '1d': '',
            '4h': '',
            '2h': '',
            '1h': '',
            '30m': '',
            '15m': '',
            'MULTI': ''
        };
        return icons[tf] || '';
    }
    
    let supportLine = '';
    let supportScoreBonus = 0;
    if (data.supports && data.supports.length > 0) {
        const supportStrings = data.supports.map(s => {
            const strength = getPivotStrength(s.touches);
            let scoreBonus = 0;
            const tfMultiplier = data.usedTimeframe === '1w' ? 1.5 : 
                                 data.usedTimeframe === '1d' ? 1.2 : 
                                 data.usedTimeframe === '4h' ? 0.8 : 0.5;
            
            if (s.touches >= 5) scoreBonus = 0.5 * tfMultiplier;
            else if (s.touches >= 3) scoreBonus = 0.3 * tfMultiplier;
            else scoreBonus = 0.1 * tfMultiplier;
            
            supportScoreBonus += scoreBonus;
            const timeframeIcon = getTimeframeIcon(data.usedTimeframe);
            return `${formatPrice(s.avgPrice)} (${s.touches}x) ${strength.emoji} ${strength.text} ${timeframeIcon}`;
        }).join(' | ');
        const timeframeIcon = getTimeframeIcon(data.usedTimeframe);
        supportLine = `📉 Suporte ${timeframeIcon}: ${supportStrings}`;
    }
    
    let resistanceLine = '';
    let resistanceScoreBonus = 0;
    if (data.resistances && data.resistances.length > 0) {
        const resistanceStrings = data.resistances.map(r => {
            const strength = getPivotStrength(r.touches);
            let scoreBonus = 0;
            const tfMultiplier = data.usedTimeframe === '1w' ? 1.5 : 
                                 data.usedTimeframe === '1d' ? 1.2 : 
                                 data.usedTimeframe === '4h' ? 0.8 : 0.5;
            
            if (r.touches >= 5) scoreBonus = 0.5 * tfMultiplier;
            else if (r.touches >= 3) scoreBonus = 0.3 * tfMultiplier;
            else scoreBonus = 0.1 * tfMultiplier;
            
            resistanceScoreBonus += scoreBonus;
            const timeframeIcon = getTimeframeIcon(data.usedTimeframe);
            return `${formatPrice(r.avgPrice)} (${r.touches}x) ${strength.emoji} ${strength.text} ${timeframeIcon}`;
        }).join(' | ');
        const timeframeIcon = getTimeframeIcon(data.usedTimeframe);
        resistanceLine = `📈 Resistência ${timeframeIcon}: ${resistanceStrings}`;
    }
    
    const totalPivotBonus = supportScoreBonus + resistanceScoreBonus;
    const finalScore = data.confirmationScore + totalPivotBonus;
    
    const cci4hText = data.cci4h && data.cci4h.text ? data.cci4h.text : 'CCI 4H N/A';
    const cciDailyText = data.cciDaily && data.cciDaily.text ? data.cciDaily.text : 'CCI 1D N/A';
    
    const formattedDateTime = `${time.date} ${time.time}hs`;
    const scoreEmoji = getScoreEmoji(finalScore);
    
    let penaltiesLine = '';
    if (data.totalPenalty < 0 && data.penaltyMessages && data.penaltyMessages.length > 0) {
        const shortPenalties = data.penaltyMessages.map(msg => {
            if (msg.includes('LSR')) return 'LSR';
            if (msg.includes('Fund')) return 'Fund';
            return msg.split(' ')[0];
        }).join(', ');
        penaltiesLine = ` ⚠️ Penal: ${data.totalPenalty} (${shortPenalties})`;
    } else if (data.totalPenalty < 0) {
        penaltiesLine = ` ⚠️ Penal: ${data.totalPenalty}`;
    }
    
    // Adiciona informações do estudo se disponível
    let studyInfo = '';
    if (data.studyInfo) {
        const studyTime = new Date(data.studyInfo.studiedAt).toLocaleTimeString();
        const confirmTime = new Date(data.studyInfo.confirmedAt).toLocaleTimeString();
        const waitMinutes = Math.round((data.studyInfo.confirmedAt - data.studyInfo.studiedAt) / 60000);
        studyInfo = `\n📚 ESTUDO: Registrado às ${studyTime} | Confirmado após ${waitMinutes}min | EMA13:${data.studyInfo.ema13?.toFixed(2)} | EMA34:${data.studyInfo.ema34?.toFixed(2)} | EMA55:${data.studyInfo.ema55?.toFixed(2)}`;
    }
    
    const timeframeIcon = getTimeframeIcon(data.usedTimeframe);
    const timeframeText = data.usedTimeframe === '1w' ? ' Semanal' : 
                          data.usedTimeframe === '1d' ? ' Diário' : 
                          data.usedTimeframe === '4h' ? ' 4 Horas' : 
                          data.usedTimeframe === '1h' ? ' 1 Hora' : ' 15 Minutos';
    
    return `<i>${data.direction} - ${symbolName} | 💲 ${formatPrice(data.price)}
${scoreEmoji} #SCORE: ${finalScore.toFixed(1)} (Pivôs +${totalPivotBonus.toFixed(1)}) | Data: ${formattedDateTime}
🔍 ${divergencesText}
${cvdLine}
${targets}
${stop}
▫️Vol 24h: ${data.volume24h.pct} ${data.volume24h.text}
#RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} | <a href="${tradingViewLink}">🔗 TV</a>
${volume3mLine}
${volume1hLine}
#LSR: ${lsr} | #Fund: ${fundingSign}${fundingPct}%
Stoch 1D: ${data.stoch1d}
Stoch 4H: ${data.stoch4h}
CCI 4H:${cci4hText}
CCI 1D:${cciDailyText}
📌 Pivôs (${timeframeText}):
${supportLine ? supportLine : ''}
${resistanceLine ? resistanceLine : ''}
${penaltiesLine}
${studyInfo}
 🤖...Alerta Educativo, não é recomendação de investimento.
Titanium Prime X by @J4Rviz</i>`;
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X - COM MEMÓRIA DE ESTUDO');
    console.log('='.repeat(70));
    console.log('📚 Sistema de Memória: Registra toques nas Bollinger + divergências');
    console.log('✅ Confirmação: EMA13/34 (cruzamento) + fechamento acima/abaixo EMA55 (3m)');
    console.log('='.repeat(70));
    
    currentTopSymbols = await getTopSymbols();
    log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
    
    // Inicializa CVD Real
    if (CONFIG.CVD.WEBSOCKET.ENABLED) {
        log('Inicializando CVD Real via WebSocket...', 'info');
        await realCVD.initialize(currentTopSymbols);
        
        setTimeout(() => {
            const stats = realCVD.getStats();
            log(`CVD Real: ${stats.connected} conexões ativas, ${stats.withData} com dados`, 'success');
        }, 10000);
    }
    
    log(`CVD (Cumulative Volume Delta) - TIMEFRAME: ${CONFIG.CVD.TIMEFRAME}`, 'success');
    log(`📚 Memória de estudo: ATIVADA | Expira em ${CONFIG.ALERTS.MEMORY.EXPIRY_HOURS}h`, 'success');
    log(`✅ Confirmação EMA: ${CONFIG.ALERTS.MEMORY.EMA_FAST}/${CONFIG.ALERTS.MEMORY.EMA_SLOW} cruzamento | Fechamento EMA${CONFIG.ALERTS.MEMORY.EMA_TREND} (${CONFIG.ALERTS.MEMORY.CHECK_TIMEFRAME})`, 'success');
    
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const cvdStatus = CONFIG.CVD.WEBSOCKET.ENABLED ? 'CVD REAL via WebSocket' : 'CVD Simulado';
        const initMessage = `🚀 Titanium Prime X v4.0 Ativado (COM MEMÓRIA DE ESTUDO)\n` +
            `Monitorando: ${currentTopSymbols.length} símbolos\n` +
            `${cvdStatus}\n` +
            `📚 Estudo: Toque na Bollinger + Divergência → Aguarda confirmação EMA13/34/55 (3m)\n` +
            `✅ Alerta só após reversão confirmada\n` +
            `${getBrazilianDateTime().full}`;
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: initMessage, parse_mode: 'HTML' })
        });
        if (response.ok) log('Mensagem de inicialização enviada', 'success');
        else log(`Erro ao enviar mensagem de inicialização: ${response.status}`, 'warning');
    } catch (e) {
        log(`Erro ao enviar mensagem de inicialização: ${e.message}`, 'warning');
    }
    
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === 0 && now.getMinutes() === 0) {
            dailyCounter.clear();
            saveDailyCounters();
            log('Contadores diários resetados', 'info');
        }
        // Limpeza de memória expirada a cada hora
        studyMemory.cleanupExpired();
        const stats = studyMemory.getStats();
        log(`📚 Memória: ${stats.total} estudos ativos (COMPRA: ${stats.byDirection.COMPRA}, VENDA: ${stats.byDirection.VENDA})`, 'info');
    }, 60000);
    
    setInterval(() => processPriorityQueue(), 30000);
    
    let scanCount = 0;
    while (true) {
        try {
            scanCount++;
            alertsSentThisScan = 0;
            log(`Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
            
            for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                log(`Batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)}`, 'info');
                await Promise.allSettled(batch.map(symbol => analyzeSymbol(symbol)));
                if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                    await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                }
            }
            
            log(`Scan #${scanCount} concluído. Alertas enviados: ${alertsSentThisScan}`, 'success');
            
            const memoryStats = studyMemory.getStats();
            log(`📚 Status da memória: ${memoryStats.total} estudos ativos (COMPRA: ${memoryStats.byDirection.COMPRA}, VENDA: ${memoryStats.byDirection.VENDA})`, 'info');
            
            if (scanCount % 10 === 0 && CONFIG.CVD.WEBSOCKET.ENABLED) {
                const stats = realCVD.getStats();
                log(`📊 CVD Real Stats: ${stats.connected} conexões, ${stats.withData} com dados`, 'info');
            }
            
            log(`Aguardando 30s para próximo scan...`, 'info');
            await new Promise(r => setTimeout(r, 30000));
        } catch (error) {
            log(`Erro no scan: ${error.message}`, 'error');
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// Tratamento de desligamento gracioso
process.on('SIGINT', () => {
    log('Desligando...', 'warning');
    const stats = studyMemory.getStats();
    log(`Memória final: ${stats.total} estudos salvos`, 'info');
    if (CONFIG.CVD.WEBSOCKET.ENABLED) {
        realCVD.shutdown();
    }
    process.exit(0);
});

loadDailyCounters();
startScanner().catch(console.error);
