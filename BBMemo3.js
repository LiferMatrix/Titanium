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
        BATCH_SIZE: 6,
        SYMBOL_DELAY_MS: 2000,
        REQUEST_TIMEOUT: 8000,
        COOLDOWN_AFTER_BATCH_MS: 3000,
        MAX_REQUESTS_PER_MINUTE: 800,
        CACHE_DURATION_SECONDS: 30,
        TOP_SYMBOLS_LIMIT: 400
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
        MEMORY: {
            ENABLED: true,
            EXPIRY_HOURS: 48,
            CHECK_TIMEFRAME: '3m',
            EMA_FAST: 13,
            EMA_SLOW: 34,
            EMA_TREND: 55
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
                VERY_LOW: { THRESHOLD: 0.01, POINTS: -2 },
                LOW: { THRESHOLD: 0.02, POINTS: -3 },
                MEDIUM: { THRESHOLD: 0.1, POINTS: -5 },
                HIGH: { THRESHOLD: 0.2, POINTS: -6 }
            },
            NEGATIVE: {
                VERY_LOW: { THRESHOLD: -0.01, POINTS: -2 },
                LOW: { THRESHOLD: -0.02, POINTS: -3 },
                MEDIUM: { THRESHOLD: -0.1, POINTS: -5 },
                HIGH: { THRESHOLD: -0.2, POINTS: -6 }
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
            MAX_SYMBOLS: 80,
            SNAPSHOT_INTERVAL_MS: 15 * 60 * 1000,
            RECONNECT_DELAY_MS: 5000,
            WS_URL: 'wss://fstream.binance.com'
        }
    },
    RECONNECTION: {
        MAX_RETRIES: 3,
        INITIAL_DELAY_MS: 1000,
        MAX_DELAY_MS: 30000,
        BACKOFF_MULTIPLIER: 2,
        HEALTH_CHECK_INTERVAL_MS: 60000,
        CONNECTION_TIMEOUT_MS: 10000
    }
};

// =====================================================================
// === BUSCAR APENAS SÍMBOLOS ATIVOS DA BINANCE ===
// =====================================================================
let ACTIVE_SYMBOLS_SET = null;
let LAST_EXCHANGE_INFO_UPDATE = 0;
const EXCHANGE_INFO_CACHE_HOURS = 24;

async function getActiveSymbols() {
    if (ACTIVE_SYMBOLS_SET && (Date.now() - LAST_EXCHANGE_INFO_UPDATE) < EXCHANGE_INFO_CACHE_HOURS * 60 * 60 * 1000) {
        return ACTIVE_SYMBOLS_SET;
    }
    
    try {
        log('Buscando lista de símbolos ativos da Binance...', 'info');
        const data = await rateLimiter.makeRequest('https://fapi.binance.com/fapi/v1/exchangeInfo', 'exchange_info');
        
        const activeSymbols = data.symbols
            .filter(s => 
                s.status === 'TRADING' &&
                s.symbol.endsWith('USDT') &&
                s.contractType === 'PERPETUAL'
            )
            .map(s => s.symbol);
        
        ACTIVE_SYMBOLS_SET = new Set(activeSymbols);
        LAST_EXCHANGE_INFO_UPDATE = Date.now();
        
        log(`✅ Encontrados ${ACTIVE_SYMBOLS_SET.size} símbolos ativos na Binance Futures`, 'success');
        return ACTIVE_SYMBOLS_SET;
        
    } catch (error) {
        log(`Erro ao buscar exchangeInfo: ${error.message}`, 'error');
        const fallbackSymbols = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT',
            'AVAXUSDT', 'LINKUSDT', 'ATOMUSDT', 'POLUSDT', 'DOTUSDT', 'GALAUSDT', 'UNIUSDT'
        ];
        ACTIVE_SYMBOLS_SET = new Set(fallbackSymbols);
        return ACTIVE_SYMBOLS_SET;
    }
}

// =====================================================================
// === SISTEMA DE RECONEXÃO ROBUSTO ===
// =====================================================================
class ConnectionManager {
    constructor() {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastSuccessfulRequest = Date.now();
        this.reconnectTimer = null;
        this.healthCheckTimer = null;
        this.isReconnecting = false;
        
        this.startHealthCheck();
    }

    startHealthCheck() {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
        
        this.healthCheckTimer = setInterval(async () => {
            await this.performHealthCheck();
        }, CONFIG.RECONNECTION.HEALTH_CHECK_INTERVAL_MS);
    }

    async performHealthCheck() {
        const timeSinceLastSuccess = Date.now() - this.lastSuccessfulRequest;
        
        if (timeSinceLastSuccess > 60000 && !this.isReconnecting) {
            log(`⚠️ Health Check: ${Math.round(timeSinceLastSuccess / 1000)}s sem respostas`, 'warning');
            await this.attemptReconnection();
        }
    }

    async attemptReconnection() {
        if (this.isReconnecting || this.reconnectTimer) return;
        
        this.isReconnecting = true;
        
        try {
            log(`🔄 Tentativa de reconexão ${this.reconnectAttempts + 1}...`, 'warning');
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch('https://fapi.binance.com/fapi/v1/ping', { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.lastSuccessfulRequest = Date.now();
                log(`✅ Conexão restabelecida!`, 'success');
                
                cache.cache.clear();
                
                if (CONFIG.CVD.WEBSOCKET.ENABLED && realCVD) {
                    reconnectAllCVD();
                }
                return true;
            }
            
            throw new Error('Ping falhou');
            
        } catch (error) {
            this.reconnectAttempts++;
            log(`❌ Falha na reconexão: ${error.message}`, 'error');
            
            if (this.reconnectAttempts < CONFIG.RECONNECTION.MAX_RETRIES) {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), CONFIG.RECONNECTION.MAX_DELAY_MS);
                log(`⏳ Nova tentativa em ${Math.round(delay / 1000)}s...`, 'warning');
                
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.attemptReconnection();
                }, delay);
            } else {
                log(`❌ Falha definitiva após ${this.reconnectAttempts} tentativas`, 'error');
                this.reconnectAttempts = 0;
            }
            return false;
        } finally {
            this.isReconnecting = false;
        }
    }

    async executeWithRetry(fn, context = 'unknown', maxRetries = 2) {
        let lastError = null;
        let retries = 0;

        while (retries <= maxRetries) {
            try {
                if (!this.isConnected) {
                    await this.waitForConnection();
                }
                
                const result = await fn();
                this.onSuccess();
                return result;
                
            } catch (error) {
                lastError = error;
                retries++;
                
                const isTimeout = error.message?.includes('aborted') || error.name === 'AbortError';
                const isNetwork = error.message?.includes('fetch') || error.message?.includes('network');
                
                if ((isTimeout || isNetwork) && retries <= maxRetries) {
                    this.markDisconnected();
                    const delay = Math.min(1000 * retries, 3000);
                    log(`⚠️ Tentativa ${retries}/${maxRetries} falhou: ${error.message}. Aguardando ${delay}ms...`, 'warning');
                    await this.sleep(delay);
                    continue;
                } else if (retries <= maxRetries) {
                    await this.sleep(1000);
                    continue;
                }
                
                throw error;
            }
        }

        throw new Error(`Falha após ${maxRetries} tentativas: ${lastError?.message}`);
    }

    async waitForConnection() {
        const startTime = Date.now();
        
        while (!this.isConnected) {
            if (Date.now() - startTime > 30000) {
                await this.attemptReconnection();
            }
            await this.sleep(1000);
        }
        return true;
    }

    onSuccess() {
        const wasDisconnected = !this.isConnected;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.lastSuccessfulRequest = Date.now();
        
        if (wasDisconnected) {
            log(`✅ Conexão recuperada!`, 'success');
        }
    }

    markDisconnected() {
        if (this.isConnected) {
            this.isConnected = false;
            log(`🔌 Conexão instável detectada`, 'warning');
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const connectionManager = new ConnectionManager();

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
        this.memory = new Map();
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
        log(`📝 MEMÓRIA: ${symbol} ${direction} registrado para estudo`, 'success');
    }

    getStudy(symbol, direction) {
        const key = `${symbol}_${direction}`;
        const study = this.memory.get(key);
        
        if (!study) return null;
        
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
            log(`🧹 Limpeza: ${removed} estudos expirados removidos`, 'info');
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

const studyMemory = new StudyMemory();

// =====================================================================
// === FUNÇÕES DE EMA PARA CONFIRMAÇÃO ===
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
            return { confirmed: false, message: 'Dados insuficientes', ema13: null, ema34: null, ema55: null };
        }
        
        const closes = candles.map(c => c.close);
        
        const ema13Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_FAST);
        const ema34Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_SLOW);
        const ema55Series = calculateEMASeries(closes, CONFIG.ALERTS.MEMORY.EMA_TREND);
        
        const currentEMA13 = ema13Series[ema13Series.length - 1];
        const previousEMA13 = ema13Series.length >= 2 ? ema13Series[ema13Series.length - 2] : currentEMA13;
        
        const currentEMA34 = ema34Series[ema34Series.length - 1];
        const previousEMA34 = ema34Series.length >= 2 ? ema34Series[ema34Series.length - 2] : currentEMA34;
        
        const currentEMA55 = ema55Series[ema55Series.length - 1];
        const currentPrice = closes[closes.length - 1];
        
        let confirmed = false;
        let message = '';
        
        if (direction === 'COMPRA') {
            const ema13CrossedUp = previousEMA13 <= previousEMA34 && currentEMA13 > currentEMA34;
            const priceAboveEMA55 = currentPrice > currentEMA55;
            
            if (ema13CrossedUp && priceAboveEMA55) {
                confirmed = true;
                message = `✅ COMPRA confirmada: EMA13 cruzou EMA34 | Preço > EMA55`;
            } else if (ema13CrossedUp && !priceAboveEMA55) {
                message = `⏳ Aguardando fechamento acima da EMA55`;
            } else if (!ema13CrossedUp && priceAboveEMA55) {
                message = `⏳ Aguardando cruzamento da EMA13 sobre EMA34`;
            } else {
                message = `⏳ Aguardando confirmação`;
            }
        } else {
            const ema13CrossedDown = previousEMA13 >= previousEMA34 && currentEMA13 < currentEMA34;
            const priceBelowEMA55 = currentPrice < currentEMA55;
            
            if (ema13CrossedDown && priceBelowEMA55) {
                confirmed = true;
                message = `✅ VENDA confirmada: EMA13 cruzou EMA34 | Preço < EMA55`;
            } else if (ema13CrossedDown && !priceBelowEMA55) {
                message = `⏳ Aguardando fechamento abaixo da EMA55`;
            } else if (!ema13CrossedDown && priceBelowEMA55) {
                message = `⏳ Aguardando cruzamento da EMA13 abaixo da EMA34`;
            } else {
                message = `⏳ Aguardando confirmação`;
            }
        }
        
        return { confirmed, message, ema13: currentEMA13, ema34: currentEMA34, ema55: currentEMA55, currentPrice };
        
    } catch (error) {
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
            log(`Carregados ${dailyCounter.size} contadores diários`, 'info');
        }
    } catch (error) {
        log(`Erro ao carregar contadores: ${error.message}`, 'error');
    }
}

function saveDailyCounters() {
    try {
        const obj = Object.fromEntries(dailyCounter);
        fs.writeFileSync(DAILY_COUNTER_FILE, JSON.stringify(obj, null, 2));
    } catch (error) {
        log(`Erro ao salvar contadores: ${error.message}`, 'error');
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
    if (type === 'error') console.error(`❌ ${message}`);
    else if (type === 'success') console.log(`✅ ${message}`);
    else if (type === 'warning') console.log(`⚠️ ${message}`);
    else console.log(`ℹ️ ${message}`);
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, { flag: 'a' });
}

const alertCache = new Map();
const dailyCounter = new Map();
let currentTopSymbols = [];

const priorityQueue = { critical: [], high: [], medium: [], low: [] };
let isSendingTelegram = false;
let alertsSentThisScan = 0;

// =====================================================================
// === CVD REAL VIA WEBSOCKET PARA TOP 80 SÍMBOLOS ===
// =====================================================================

class RealCVDManager {
    constructor() {
        this.connections = new Map();
        this.snapshots = new Map();
        this.listeners = new Map();
        this.isInitialized = false;
        this.reconnectTimer = null;
        this.healthCheckInterval = null;
        this.isReconnecting = false;
    }

    async initialize(symbols) {
        if (!CONFIG.CVD.WEBSOCKET.ENABLED) {
            log('CVD WebSocket desativado, usando modo simulado', 'warning');
            return false;
        }

        const activeSymbols = await getActiveSymbols();
        const maxSymbols = CONFIG.CVD.WEBSOCKET.MAX_SYMBOLS;
        
        const validSymbols = symbols
            .filter(s => activeSymbols.has(s))
            .slice(0, maxSymbols);
        
        log(`Inicializando CVD Real para ${validSymbols.length} símbolos (TOP ${maxSymbols} por liquidez)...`, 'info');
        
        for (const symbol of validSymbols) {
            await this.connectSymbol(symbol);
            await new Promise(r => setTimeout(r, 100));
        }
        
        this.startHealthCheck();
        this.isInitialized = true;
        log(`✅ CVD Real ativo para ${validSymbols.length} símbolos`, 'success');
        return true;
    }

    startHealthCheck() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, CONFIG.RECONNECTION.HEALTH_CHECK_INTERVAL_MS);
    }

    async performHealthCheck() {
        const now = Date.now();
        let staleConnections = 0;
        
        for (const [symbol, snapshot] of this.snapshots) {
            if (now - snapshot.lastUpdate > 120000) {
                staleConnections++;
                log(`⚠️ Conexão CVD para ${symbol} parece inativa`, 'warning');
                await this.reconnectSymbol(symbol);
            }
        }
        
        if (staleConnections > 0) {
            log(`🔧 Health Check CVD: ${staleConnections} conexões restauradas`, 'info');
        }
    }

    async reconnectSymbol(symbol) {
        if (this.isReconnecting) return;
        
        this.isReconnecting = true;
        try {
            await this.disconnectSymbol(symbol);
            await new Promise(r => setTimeout(r, CONFIG.CVD.WEBSOCKET.RECONNECT_DELAY_MS));
            await this.connectSymbol(symbol);
        } catch (error) {
            log(`Erro ao reconectar ${symbol}: ${error.message}`, 'error');
        } finally {
            this.isReconnecting = false;
        }
    }

    async connectSymbol(symbol) {
        const activeSymbols = await getActiveSymbols();
        if (!activeSymbols.has(symbol)) {
            return;
        }
        
        if (this.connections.has(symbol)) {
            this.disconnectSymbol(symbol);
        }

        const streamName = `${symbol.toLowerCase()}@trade`;
        const wsUrl = `${CONFIG.CVD.WEBSOCKET.WS_URL}/ws/${streamName}`;
        
        const ws = new WebSocket(wsUrl);
        
        const connectionTimeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                log(`Timeout WebSocket ${symbol}`, 'warning');
                ws.close();
            }
        }, CONFIG.RECONNECTION.CONNECTION_TIMEOUT_MS);
        
        ws.on('open', () => {
            clearTimeout(connectionTimeout);
            log(`✅ WebSocket CVD conectado: ${symbol}`, 'success');
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
            clearTimeout(connectionTimeout);
            if (error.message.includes('4016') || error.message.includes('Invalid symbol')) {
                this.connections.delete(symbol);
                return;
            }
        });
        
        ws.on('close', () => {
            clearTimeout(connectionTimeout);
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
        
        const maxDeltas = 500;
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
        
        if (!snapshot || !snapshot.deltas || snapshot.deltas.length < 20) {
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
                stats.symbols.push({ symbol, deltas: snapshot.deltas.length });
            }
        }
        return stats;
    }

    shutdown() {
        if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
        for (const [symbol, ws] of this.connections) {
            ws.close();
        }
        this.connections.clear();
        this.snapshots.clear();
        log('CVD Real desligado', 'info');
    }
}

const realCVD = new RealCVDManager();

async function reconnectAllCVD() {
    if (!CONFIG.CVD.WEBSOCKET.ENABLED) return;
    
    log(`🔄 Verificando conexões CVD...`, 'info');
    
    for (const [symbol, ws] of realCVD.connections) {
        if (ws.readyState !== WebSocket.OPEN) {
            await realCVD.reconnectSymbol(symbol);
            await new Promise(r => setTimeout(r, 100));
        }
    }
    
    const stats = realCVD.getStats();
    log(`📊 CVD Status: ${stats.connected} conexões ativas`, 'info');
}

async function analyzeCVDHybrid(symbol, currentPrice, isGreenAlert) {
    if (CONFIG.CVD.WEBSOCKET.ENABLED && realCVD.isInitialized) {
        const realResult = realCVD.getCVDAnalysis(symbol, currentPrice, isGreenAlert);
        if (realResult.isReal && realResult.cvdSignal) {
            if (realResult.cvdConfirmed) {
                log(`✅ ${symbol} - CVD REAL confirmado! +${realResult.cvdScore}`, 'success');
            }
            return realResult;
        }
    }
    return { cvdScore: 0, cvdSignal: null, cvdConfirmed: false, isReal: false };
}

// =====================================================================
// === BUSCAR CANDLES COM CACHE E LIMITE DE CONCORRÊNCIA ===
// =====================================================================
class CandlesFetcher {
    constructor() {
        this.activeRequests = 0;
        this.maxConcurrent = 2;
    }

    async getCandles(symbol, interval, limit = 100) {
        const cacheKey = `candles_${symbol}_${interval}_${limit}`;
        
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        
        return connectionManager.executeWithRetry(async () => {
            while (this.activeRequests >= this.maxConcurrent) {
                await new Promise(r => setTimeout(r, 100));
            }
            
            this.activeRequests++;
            
            try {
                const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                const data = await rateLimiter.makeRequest(url, cacheKey);
                
                const candles = data.map(candle => ({
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4]),
                    volume: parseFloat(candle[5]),
                    time: candle[0]
                }));
                
                cache.set(cacheKey, candles);
                return candles;
            } finally {
                this.activeRequests--;
            }
        }, `candles_${symbol}_${interval}`, 2);
    }

    async fetchAllCandles(symbol) {
        const intervals = ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w', '3m'];
        const map = {};
        
        for (const interval of intervals) {
            try {
                map[interval] = await this.getCandles(symbol, interval, 100);
                await new Promise(r => setTimeout(r, 50));
            } catch (error) {
                log(`Erro ao buscar ${symbol} ${interval}: ${error.message}`, 'warning');
                map[interval] = [];
            }
        }
        
        return map;
    }
}

const candlesFetcher = new CandlesFetcher();

async function getCandles(symbol, interval, limit = 100) {
    return candlesFetcher.getCandles(symbol, interval, limit);
}

async function fetchAllCandles(symbol) {
    return candlesFetcher.fetchAllCandles(symbol);
}

// =====================================================================
// === RATE LIMITER INTELIGENTE ===
// =====================================================================
class IntelligentRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.consecutiveErrors = 0;
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
            log(`Rate limit, aguardando ${Math.ceil(waitTime / 1000)}s...`, 'warning');
            await new Promise(r => setTimeout(r, waitTime));
            this.requestCount = 0;
            this.minuteStart = Date.now();
        }
        
        const timeSinceLast = now - this.lastRequestTime;
        const baseDelay = CONFIG.SCAN.SYMBOL_DELAY_MS;
        if (timeSinceLast < baseDelay) {
            await new Promise(r => setTimeout(r, baseDelay - timeSinceLast));
        }
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    async makeRequest(url, cacheKey = null) {
        return connectionManager.executeWithRetry(async () => {
            if (cacheKey) {
                const cached = cache.get(cacheKey);
                if (cached) return cached;
            }
            
            await this.wait();
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.SCAN.REQUEST_TIMEOUT);
            
            try {
                cache.addRequest();
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                
                if (response.status === 429) {
                    await new Promise(r => setTimeout(r, 2000));
                    throw new Error('Rate limit');
                }
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                
                if (cacheKey) cache.set(cacheKey, data);
                return data;
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        }, url, 2);
    }
}

const rateLimiter = new IntelligentRateLimiter();

// =====================================================================
// === FUNÇÕES DE CLASSIFICAÇÃO DE SÍMBOLOS ===
// =====================================================================
async function getTopSymbols() {
    try {
        log('Buscando top símbolos por volume...');
        
        const activeSymbols = await getActiveSymbols();
        
        const data = await rateLimiter.makeRequest('https://fapi.binance.com/fapi/v1/ticker/24hr', 'top_symbols_24h');
        
        const topSymbols = data
            .filter(s => {
                if (!activeSymbols.has(s.symbol)) return false;
                if (!s.symbol.endsWith('USDT')) return false;
                if (parseFloat(s.volume) <= 0) return false;
                return true;
            })
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT)
            .map(s => s.symbol);
            
        log(`✅ Encontrados ${topSymbols.length} símbolos`, 'success');
        return topSymbols;
        
    } catch (e) {
        log('Falha ao buscar top symbols', 'warning');
        const activeSymbols = await getActiveSymbols();
        return Array.from(activeSymbols).slice(0, CONFIG.SCAN.TOP_SYMBOLS_LIMIT);
    }
}

function getSymbolCategory(symbol, topSymbols = []) {
    const top10 = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
                   'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'TONUSDT'];
    if (top10.includes(symbol)) return 'TOP_10';
    if (topSymbols.length > 0) {
        const rank = topSymbols.indexOf(symbol);
        if (rank !== -1 && rank < 50) return 'TOP_50';
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
        return { cci: currentCCI, ema: currentEMA, trend, emoji, text: text || `CCI ${currentCCI.toFixed(0)}` };
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

    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
        const lastPriceLow = pricePivots.lows[pricePivots.lows.length - 1];
        const prevPriceLow = pricePivots.lows[pricePivots.lows.length - 2];
        const lastRSILow = rsiPivots.lows[rsiPivots.lows.length - 1];
        const prevRSILow = rsiPivots.lows[rsiPivots.lows.length - 2];
        if (prevPriceLow.index < lastPriceLow.index && prevRSILow.index < lastRSILow.index) {
            if (lastPriceLow.value < prevPriceLow.value && lastRSILow.value > prevRSILow.value) {
                const isRecent = isPivotRecent(lastPriceLow.index, prices.length, timeframe);
                let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                divergences.push({ timeframe, type: 'bullish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📈', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                   rsiValue: lastRSILow.value, priceValue: lastPriceLow.value, isRecent });
            }
        }
    }
    
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
        const lastPriceHigh = pricePivots.highs[pricePivots.highs.length - 1];
        const prevPriceHigh = pricePivots.highs[pricePivots.highs.length - 2];
        const lastRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 1];
        const prevRSIHigh = rsiPivots.highs[rsiPivots.highs.length - 2];
        if (prevPriceHigh.index < lastPriceHigh.index && prevRSIHigh.index < lastRSIHigh.index) {
            if (lastPriceHigh.value > prevPriceHigh.value && lastRSIHigh.value < prevRSIHigh.value) {
                const isRecent = isPivotRecent(lastPriceHigh.index, prices.length, timeframe);
                let score = 2 * multiplier * CONFIG.RSI_DIVERGENCE.REGULAR_DIVERGENCE_MULTIPLIER;
                if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                divergences.push({ timeframe, type: 'bearish', subtype: 'regular', score: Math.round(score * 10) / 10,
                                   emoji: '📉', strength: Math.min(lastRSIHigh.strength, lastPriceHigh.strength),
                                   rsiValue: lastRSIHigh.value, priceValue: lastPriceHigh.value, isRecent });
            }
        }
    }

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
                    if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
                    divergences.push({ timeframe, type: 'bullish', subtype: 'hidden', score: Math.round(score * 10) / 10,
                                       emoji: '🔮', strength: Math.min(lastRSILow.strength, lastPriceLow.strength),
                                       rsiValue: lastRSILow.value, priceValue: lastPriceLow.value, extreme: rsiExtreme, isRecent });
                }
            }
        }
    }
    
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
                    if (!isRecent && CONFIG.ALERTS.DIVERGENCE_RECENCY.ENABLED) score += CONFIG.ALERTS.DIVERGENCE_RECENCY.PENALTY_FOR_OLD;
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
// === FUNÇÕES ADICIONAIS ===
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
    if (!CONFIG.FUNDING_PENALTY.ENABLED || funding === null) {
        return { hasPenalty: false, points: 0, message: '' };
    }
    const fundingPercent = funding * 100;
    let penaltyPoints = 0;
    let penaltyMessage = '';
    
    if (isGreenAlert && funding > 0 && CONFIG.FUNDING_PENALTY.BUY_PENALTY_FOR_POSITIVE) {
        if (funding >= 0.008) { penaltyPoints = -4; penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`; }
        else if (funding >= 0.004) { penaltyPoints = -3; penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`; }
        else if (funding >= 0.002) { penaltyPoints = -2; penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`; }
        else if (funding >= 0.001) { penaltyPoints = -1; penaltyMessage = `Fund +${fundingPercent.toFixed(2)}%`; }
    }
    
    if (!isGreenAlert && funding < 0 && CONFIG.FUNDING_PENALTY.SELL_PENALTY_FOR_NEGATIVE) {
        const absFunding = Math.abs(funding);
        if (absFunding >= 0.008) { penaltyPoints = -4; penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`; }
        else if (absFunding >= 0.004) { penaltyPoints = -3; penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`; }
        else if (absFunding >= 0.002) { penaltyPoints = -2; penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`; }
        else if (absFunding >= 0.001) { penaltyPoints = -1; penaltyMessage = `Fund ${fundingPercent.toFixed(2)}%`; }
    }
    
    if (penaltyPoints !== 0) {
        return { hasPenalty: true, points: penaltyPoints, message: penaltyMessage };
    }
    return { hasPenalty: false, points: 0, message: '' };
}

function computeStopAndTargets(currentPrice, isGreenAlert, timeframe, candles) {
    const atrMultiplier = CONFIG.STOP_LOSS.ATR_MULTIPLIER[timeframe] || 3.0;
    const minStopPercent = CONFIG.STOP_LOSS.MIN_STOP_DISTANCE_PERCENT[timeframe] || 2.0;
    const maxStopPercent = CONFIG.STOP_LOSS.MAX_STOP_DISTANCE_PERCENT[timeframe] || 7.0;
    
    if (!candles || candles.length < 20) {
        const defaultAtr = currentPrice * 0.02;
        let stopPrice = isGreenAlert ? currentPrice - defaultAtr * atrMultiplier : currentPrice + defaultAtr * atrMultiplier;
        let stopDistance = Math.abs(currentPrice - stopPrice) / currentPrice * 100;
        if (stopDistance < minStopPercent) {
            stopPrice = isGreenAlert ? currentPrice * (1 - minStopPercent / 100) : currentPrice * (1 + minStopPercent / 100);
        } else if (stopDistance > maxStopPercent) {
            stopPrice = isGreenAlert ? currentPrice * (1 - maxStopPercent / 100) : currentPrice * (1 + maxStopPercent / 100);
        }
        
        let tp1, tp2, tp3;
        if (isGreenAlert) {
            tp1 = currentPrice + defaultAtr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice + defaultAtr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice + defaultAtr * CONFIG.TARGETS.TP3_MULTIPLIER;
        } else {
            tp1 = currentPrice - defaultAtr * CONFIG.TARGETS.TP1_MULTIPLIER;
            tp2 = currentPrice - defaultAtr * CONFIG.TARGETS.TP2_MULTIPLIER;
            tp3 = currentPrice - defaultAtr * CONFIG.TARGETS.TP3_MULTIPLIER;
        }
        return { stop: stopPrice, tp1, tp2, tp3 };
    }

    const trValues = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i-1].close;
        trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    }
    const atr = trValues.slice(-14).reduce((a, b) => a + b, 0) / 14;

    let stopPrice = isGreenAlert ? currentPrice - (atr * atrMultiplier) : currentPrice + (atr * atrMultiplier);

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
            return { passed: false, message: 'Dados insuficientes', candleConfirmed: false, shouldStudy: false };
        }
        
        const bb = calculateBollingerBands(candles, CONFIG.ALERTS.BOLLINGER.PERIOD, CONFIG.ALERTS.BOLLINGER.STD_DEV);
        if (bb.upper === null || bb.lower === null) {
            return { passed: false, message: 'Falha no cálculo', candleConfirmed: false, shouldStudy: false };
        }
        
        const currentCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        const currentPrice = currentCandle.close;
        
        let shouldStudy = false;
        let candleConfirmed = false;
        
        if (isGreenAlert) {
            const touchedLowerBand = currentPrice <= bb.lower;
            if (touchedLowerBand && currentCandle.close > previousCandle.low) {
                shouldStudy = true;
                candleConfirmed = true;
            } else if (touchedLowerBand) {
                shouldStudy = true;
            }
        } else {
            const touchedUpperBand = currentPrice >= bb.upper;
            if (touchedUpperBand && currentCandle.close < previousCandle.high) {
                shouldStudy = true;
                candleConfirmed = true;
            } else if (touchedUpperBand) {
                shouldStudy = true;
            }
        }
        
        return { passed: false, shouldStudy, candleConfirmed, bbLower: bb.lower, bbUpper: bb.upper };
        
    } catch (error) {
        return { passed: false, message: 'Erro', candleConfirmed: false, shouldStudy: false };
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
        
        return {
            rsi, stoch1d: stoch1dFormatted, stoch4h: stoch4hFormatted, stoch1h: stoch1hFormatted,
            cci4h, cciDaily,
            volume1h: { ratio: volumeRatio1h, percentage: volume1h.percentage, text: volume1h.text,
                        direction: volume1h.direction, emoji: volume1h.emoji, ratioFormatted: volumeRatio1h.toFixed(2),
                        usdt: volumeUSDT1h },
            volume3m: { ratio: volumeRatio3m, percentage: volume3m.percentage, text: volume3m.text,
                        direction: volume3m.direction, emoji: volume3m.emoji, ratioFormatted: volumeRatio3m.toFixed(2) },
            volume24h: { pct: volume24hPct, text: volume1h.text, usdt: volume24hUSDT },
            lsr, funding
        };
    } catch (error) {
        return {
            rsi: 50, stoch1d: 'K50⤵️D55 🟡', stoch4h: 'K50⤵️D55 🟡', stoch1h: 'K50⤵️D55 🟡',
            cci4h: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            cciDaily: { cci: 0, ema: 0, trend: 'Neutro', emoji: '⚪', text: 'CCI N/A' },
            volume1h: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00', usdt: 0 },
            volume3m: { ratio: 1, percentage: 50, text: '⚪Neutro', direction: 'Neutro', emoji: '⚪', ratioFormatted: '1.00' },
            volume24h: { pct: '0%', text: '⚪Neutro', usdt: 0 },
            lsr: null, funding: null
        };
    }
}

// =====================================================================
// === VERIFICAÇÕES ===
// =====================================================================
function isCooldownActive(symbol, direction, timeframe) {
    const now = Date.now();
    const globalKey = `${symbol}_ANY`;
    const lastGlobal = alertCache.get(globalKey);
    if (lastGlobal) {
        const minutesDiff = (now - lastGlobal.timestamp) / (1000 * 60);
        if (minutesDiff < 15) return true;
    }
    const specificKey = `${symbol}_${direction}_${timeframe}`;
    const lastSpecific = alertCache.get(specificKey);
    if (lastSpecific) {
        const minutesDiff = (now - lastSpecific.timestamp) / (1000 * 60);
        const required = CONFIG.ALERTS.COOLDOWN_BY_TIMEFRAME[timeframe] || 30;
        if (minutesDiff < required) return true;
    }
    return false;
}

function isDailyLimitReached(symbol) {
    const dailyKey = `${symbol}_daily`;
    const count = dailyCounter.get(dailyKey) || 0;
    const limit = getDailyLimit(symbol);
    return count >= limit;
}

function isMinimumScoreReached(score) {
    const minScore = CONFIG.ALERTS.MIN_SCORE_TO_ALERT;
    return score >= minScore;
}

function checkVolumeDirection(volume1h, isGreenAlert) {
    if (!CONFIG.ALERTS.VOLUME_DIRECTION.REQUIRE_VOLUME_DIRECTION) {
        return { passed: true, message: '' };
    }
    
    const buyerPercentage = volume1h.percentage;
    
    if (isGreenAlert) {
        const minBuyer = CONFIG.ALERTS.VOLUME_DIRECTION.BUY_MIN_PERCENTAGE;
        if (buyerPercentage >= minBuyer) {
            return { passed: true, message: `Volume comprador ${buyerPercentage.toFixed(1)}%` };
        } else {
            return { passed: false, message: `Volume comprador insuficiente: ${buyerPercentage.toFixed(1)}%` };
        }
    } else {
        const maxBuyer = CONFIG.ALERTS.VOLUME_DIRECTION.SELL_MAX_PERCENTAGE;
        if (buyerPercentage <= maxBuyer) {
            return { passed: true, message: `Volume vendedor ${(100 - buyerPercentage).toFixed(1)}%` };
        } else {
            return { passed: false, message: `Volume vendedor insuficiente: ${(100 - buyerPercentage).toFixed(1)}%` };
        }
    }
}

function registerAlert(symbol, direction, price, timeframe) {
    const now = Date.now();
    const key = `${symbol}_${direction}_${timeframe}`;
    const symbolKey = `${symbol}_ANY`;
    const dailyKey = `${symbol}_daily`;
    alertCache.set(key, { timestamp: now, timeframe, direction });
    alertCache.set(symbolKey, { timestamp: now, timeframe: 'ANY', direction });
    const newCount = (dailyCounter.get(dailyKey) || 0) + 1;
    dailyCounter.set(dailyKey, newCount);
    saveDailyCounters();
    alertsSentThisScan++;
    return newCount;
}

function queueAlert(alert) {
    const priority = getPriorityLevel(alert.confirmationScore);
    priorityQueue[priority].push(alert);
}

async function processPriorityQueue() {
    if (isSendingTelegram) return;
    isSendingTelegram = true;
    const priorities = ['critical', 'high', 'medium', 'low'];
    for (const priority of priorities) {
        const alerts = priorityQueue[priority];
        if (alerts.length === 0) continue;
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
        if (response.ok) {
            const direction = alert.direction.includes('COMPRA') ? 'COMPRA' : 'VENDA';
            const tf = alert.timeframe === 'MULTI' ? 'MULTI' : alert.timeframe;
            registerAlert(alert.symbol, direction, alert.price, tf);
            log(`✅ Alerta enviado: ${alert.symbol} ${direction}`, 'success');
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
    let message = `<i>📊 ALERTAS AGRUPADOS (${priority.toUpperCase()})\n\n`;
    if (buyAlerts.length > 0) {
        message += `🟢 COMPRA (${buyAlerts.length})\n`;
        buyAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} Score: ${a.confirmationScore}\n`;
        });
        message += '\n';
    }
    if (sellAlerts.length > 0) {
        message += `🔴 VENDA (${sellAlerts.length})\n`;
        sellAlerts.slice(0, 5).forEach(a => {
            message += `• ${a.symbol.replace('USDT', '')} Score: ${a.confirmationScore}\n`;
        });
    }
    message += `\nAlerta Educativo</i>`;
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
        });
        log(`Alerta agrupado enviado`, 'success');
    } catch (error) {
        log(`Erro ao enviar alerta agrupado: ${error.message}`, 'error');
    }
}

// =====================================================================
// === FUNÇÃO PARA IDENTIFICAR CLUSTERS (ORIGINAL) ===
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

        const clusters = findClusterLevels(candles, currentPrice, 0.5, 2);

        const candles1h = allCandles['1h'];
        const candles3m = allCandles['3m'];
        const candlesDaily = allCandles['1d'];
        const candles4h = allCandles['4h'];
        const candles15m = allCandles['15m'];

        const additional = await getAdditionalData(symbol, currentPrice, candles1h, candles3m, candlesDaily, candles4h, candles15m);

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
            symbol, timeframe, price: currentPrice, isGreenAlert,
            confirmationScore, totalPenalty, penaltyMessages,
            lsrValue: additional.lsr, fundingValue: additional.funding,
            supports: clusters.supports, resistances: clusters.resistances,
            cci4h: additional.cci4h, cciDaily: additional.cciDaily,
            rsi: additional.rsi, stoch1d: additional.stoch1d,
            stoch4h: additional.stoch4h, stoch1h: additional.stoch1h,
            volume1h: additional.volume1h, volume3m: additional.volume3m,
            volume24h: additional.volume24h
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === ANALISAR SÍMBOLO ===
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const allCandles = await fetchAllCandles(symbol);
        
        const divergences = [];
        for (const tf of CONFIG.RSI_DIVERGENCE.TIMEFRAMES) {
            const candles = allCandles[tf];
            if (candles && candles.length >= 40) {
                const result = await analyzeDivergenceTimeframe(symbol, candles, tf, allCandles);
                if (result) divergences.push(result);
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
        
        const cvdAnalysis = await analyzeCVDHybrid(symbol, currentPrice, isGreenAlert);
        
        const volumeDirectionCheck = checkVolumeDirection(bestDivergence.volume1h, isGreenAlert);
        if (!volumeDirectionCheck.passed) return [];
        
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
        
        if (cvdAnalysis.cvdConfirmed) {
            maxScore += cvdAnalysis.cvdScore;
            log(`✅ ${symbol} - CVD REAL confirmado! Bônus +${cvdAnalysis.cvdScore}`, 'success');
        }
        
        if (!isMinimumScoreReached(maxScore)) return [];
        
        const directionStr = finalDirection.includes('COMPRA') ? 'COMPRA' : 'VENDA';
        const existingStudy = studyMemory.getStudy(symbol, directionStr);
        
        if (existingStudy) {
            const emaConfirmation = await checkEMAConfirmation(symbol, directionStr);
            
            if (emaConfirmation.confirmed) {
                if (isCooldownActive(symbol, directionStr, 'MULTI')) return [];
                if (isDailyLimitReached(symbol)) return [];
                
                let timeframeForTargets = '1h';
                let candlesForTargets = allCandles['1h'];
                if (bestDivergence.timeframe && allCandles[bestDivergence.timeframe] && allCandles[bestDivergence.timeframe].length >= 20) {
                    timeframeForTargets = bestDivergence.timeframe;
                    candlesForTargets = allCandles[timeframeForTargets];
                }
                
                const { stop, tp1, tp2, tp3 } = computeStopAndTargets(currentPrice, isGreenAlert, timeframeForTargets, candlesForTargets);
                
                const consolidated = {
                    ...bestDivergence,
                    symbol,
                    timeframe: 'MULTI',
                    direction: finalDirection,
                    price: currentPrice,
                    confirmationScore: maxScore,
                    clusterBonus: clusterScoreBonus,
                    clusterInfo: clusterInfo,
                    divergencesList: divergences.map(d => ({
                        timeframe: d.timeframe,
                        type: d.isGreenAlert ? 'bullish' : 'bearish',
                        score: d.confirmationScore
                    })),
                    bullishCount, bearishCount, isNearSupport, isNearResistance,
                    stopLoss: stop, tp1, tp2, tp3,
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
                    totalPenalty: bestDivergence.totalPenalty,
                    penaltyMessages: bestDivergence.penaltyMessages,
                    cvdConfirmed: cvdAnalysis.cvdConfirmed,
                    cvdScore: cvdAnalysis.cvdScore,
                    cvdSignal: cvdAnalysis.cvdSignal,
                    cvdIsReal: cvdAnalysis.isReal || false,
                    studyInfo: {
                        studiedAt: existingStudy.timestamp,
                        studiedPrice: existingStudy.price,
                        confirmedAt: Date.now()
                    }
                };
                
                studyMemory.removeStudy(symbol, directionStr);
                queueAlert(consolidated);
                return [consolidated];
            }
            return [];
        }
        
        const bollingerCheck = await checkBollingerWithMemory(symbol, isGreenAlert, maxScore, null);
        
        if (bollingerCheck.shouldStudy && CONFIG.ALERTS.MEMORY.ENABLED) {
            const studyData = {
                symbol, direction: directionStr, price: currentPrice,
                bbLower: bollingerCheck.bbLower, bbUpper: bollingerCheck.bbUpper,
                divergenceScore: maxScore
            };
            studyMemory.addStudy(symbol, directionStr, currentPrice, bollingerCheck.bbLower, bollingerCheck.bbUpper, maxScore, studyData);
            log(`📚 ${symbol} - NOVO ESTUDO registrado para ${directionStr}`, 'success');
        }
        
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
// === FORMATAR MENSAGEM ===
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
    const cvdTypeIcon = data.cvdIsReal ? '🏆REAL' : '🚨SIM';
    
    if (data.cvdConfirmed) {
        const cvdEmoji = data.cvdSignal?.type === 'bullish' ? '💹' : '🔻';
        cvdLine = `#CVD ${cvdTypeIcon}: ${cvdEmoji} +${data.cvdScore}`;
    } else {
        cvdLine = `#CVD ${cvdTypeIcon}: ❌`;
    }
    
    let divergencesText = '';
    if (data.divergencesList && data.divergencesList.length > 0) {
        const tfList = data.divergencesList.map(d => `${d.timeframe}`).join(',');
        divergencesText = `${data.bullishCount + data.bearishCount} divergências (${tfList})`;
    }
    
    const targets = `🎯 TP1: ${formatPrice(data.tp1)} | TP2: ${formatPrice(data.tp2)} | TP3: ${formatPrice(data.tp3)}`;
    const stop = `⛔ Stop: ${formatPrice(data.stopLoss)} (${((Math.abs(data.stopLoss - data.price) / data.price) * 100).toFixed(1)}%)`;
    
    let supportLine = '';
    let supportScoreBonus = 0;
    if (data.supports && data.supports.length > 0) {
        const supportStrings = data.supports.map(s => {
            const strength = getPivotStrength(s.touches);
            let scoreBonus = 0;
            if (s.touches >= 5) scoreBonus = 0.5;
            else if (s.touches >= 3) scoreBonus = 0.3;
            else scoreBonus = 0.1;
            supportScoreBonus += scoreBonus;
            return `${formatPrice(s.avgPrice)} (${s.touches}x) ${strength.emoji} ${strength.text}`;
        }).join(' | ');
        supportLine = `📉 Suporte: ${supportStrings}`;
    }
    
    let resistanceLine = '';
    let resistanceScoreBonus = 0;
    if (data.resistances && data.resistances.length > 0) {
        const resistanceStrings = data.resistances.map(r => {
            const strength = getPivotStrength(r.touches);
            let scoreBonus = 0;
            if (r.touches >= 5) scoreBonus = 0.5;
            else if (r.touches >= 3) scoreBonus = 0.3;
            else scoreBonus = 0.1;
            resistanceScoreBonus += scoreBonus;
            return `${formatPrice(r.avgPrice)} (${r.touches}x) ${strength.emoji} ${strength.text}`;
        }).join(' | ');
        resistanceLine = `📈 Resistência: ${resistanceStrings}`;
    }
    
    const totalPivotBonus = supportScoreBonus + resistanceScoreBonus;
    const finalScore = data.confirmationScore + totalPivotBonus;
    const scoreEmoji = getScoreEmoji(finalScore);
    
    let penaltiesLine = '';
    if (data.totalPenalty < 0 && data.penaltyMessages && data.penaltyMessages.length > 0) {
        const shortPenalties = data.penaltyMessages.map(msg => {
            if (msg.includes('LSR')) return 'LSR';
            if (msg.includes('Fund')) return 'Fund';
            return msg.split(' ')[0];
        }).join(', ');
        penaltiesLine = ` ⚠️ Penal: ${data.totalPenalty} (${shortPenalties})`;
    }
    
    let studyInfo = '';
    if (data.studyInfo) {
        const studyTime = new Date(data.studyInfo.studiedAt).toLocaleTimeString();
        const waitMinutes = Math.round((data.studyInfo.confirmedAt - data.studyInfo.studiedAt) / 60000);
        studyInfo = `\n📚 Estudo às ${studyTime} | Confirmado após ${waitMinutes}min`;
    }
    
    const timeframeText = data.timeframe === 'MULTI' ? 'Múltiplos TFs' : data.timeframe;
    
    return `<i>${data.direction} - ${symbolName} | 💲 ${formatPrice(data.price)}
${scoreEmoji} SCORE: ${finalScore.toFixed(1)} | ${time.date} ${time.time}
🔍 ${divergencesText}
${cvdLine}
${targets}
${stop}
▫️Vol 24h: ${data.volume24h.pct} ${data.volume24h.text}
#RSI 1h: ${data.rsi.toFixed(0)} ${rsiEmoji} | <a href="${tradingViewLink}">🔗 Gráfico</a>
${volume3mLine}
${volume1hLine}
#LSR: ${lsr} | Fund: ${fundingSign}${fundingPct}%
Stoch 1D: ${data.stoch1d}
Stoch 4H: ${data.stoch4h}
CCI 4H:${data.cci4h.text}
CCI 1D:${data.cciDaily.text}
📌 Pivôs (${timeframeText}):
${supportLine}
${resistanceLine}
${penaltiesLine}
${studyInfo}
🤖 Alerta Educativo, não é recomendação.
Titanium Prime X</i>`;
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function startScanner() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TITANIUM PRIME X - CVD REAL (TOP 80)');
    console.log('='.repeat(60));
    console.log('📚 Sistema de Memória + EMA13/34/55 (3m)');
    console.log('🔄 Reconexão automática otimizada');
    console.log('🎯 CVD Real para TOP 80 símbolos de liquidez');
    console.log('📊 Clusters completos + bônus por toques');
    console.log('='.repeat(60));
    
    let scannerRunning = true;
    
    const runScanner = async () => {
        while (scannerRunning) {
            try {
                await connectionManager.waitForConnection();
                
                currentTopSymbols = await getTopSymbols();
                log(`Monitorando ${currentTopSymbols.length} símbolos`, 'success');
                
                if (CONFIG.CVD.WEBSOCKET.ENABLED && !realCVD.isInitialized) {
                    log('Inicializando CVD Real para TOP 80 símbolos...', 'info');
                    await realCVD.initialize(currentTopSymbols);
                    
                    setTimeout(() => {
                        const stats = realCVD.getStats();
                        log(`✅ CVD Real: ${stats.connected} conexões ativas, ${stats.withData} com dados`, 'success');
                    }, 10000);
                }
                
                try {
                    const token = CONFIG.TELEGRAM.BOT_TOKEN;
                    const chatId = CONFIG.TELEGRAM.CHAT_ID;
                    const cvdStatus = CONFIG.CVD.WEBSOCKET.ENABLED ? 'CVD REAL (TOP 80)' : 'CVD Simulado';
                    const initMessage = `🚀 Titanium Prime X Ativado\n` +
                        `Monitorando: ${currentTopSymbols.length} símbolos\n` +
                        `${cvdStatus}\n` +
                        `📚 Estudo: Bollinger + Divergência → Confirmação EMA13/34/55 (3m)\n` +
                        `🔄 Reconexão automática ativa\n` +
                        `${getBrazilianDateTime().full}`;
                    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: initMessage, parse_mode: 'HTML' })
                    });
                } catch (e) {}
                
                setInterval(() => {
                    const now = new Date();
                    if (now.getHours() === 0 && now.getMinutes() === 0) {
                        dailyCounter.clear();
                        saveDailyCounters();
                        log('Contadores resetados', 'info');
                    }
                    studyMemory.cleanupExpired();
                    const stats = studyMemory.getStats();
                    log(`📚 Memória: ${stats.total} estudos ativos`, 'info');
                }, 60000);
                
                setInterval(() => processPriorityQueue(), 30000);
                
                let scanCount = 0;
                while (scannerRunning) {
                    try {
                        await connectionManager.waitForConnection();
                        
                        scanCount++;
                        alertsSentThisScan = 0;
                        log(`Scan #${scanCount} - ${getBrazilianDateTime().full}`, 'info');
                        
                        for (let i = 0; i < currentTopSymbols.length; i += CONFIG.SCAN.BATCH_SIZE) {
                            if (!scannerRunning) break;
                            
                            await connectionManager.waitForConnection();
                            
                            const batch = currentTopSymbols.slice(i, i + CONFIG.SCAN.BATCH_SIZE);
                            log(`Batch ${Math.floor(i/CONFIG.SCAN.BATCH_SIZE) + 1}/${Math.ceil(currentTopSymbols.length/CONFIG.SCAN.BATCH_SIZE)}`, 'info');
                            await Promise.allSettled(batch.map(symbol => analyzeSymbol(symbol)));
                            
                            if (i + CONFIG.SCAN.BATCH_SIZE < currentTopSymbols.length) {
                                await new Promise(r => setTimeout(r, CONFIG.SCAN.COOLDOWN_AFTER_BATCH_MS));
                            }
                        }
                        
                        log(`Scan #${scanCount} concluído. Alertas: ${alertsSentThisScan}`, 'success');
                        
                        if (scanCount % 10 === 0 && CONFIG.CVD.WEBSOCKET.ENABLED) {
                            const stats = realCVD.getStats();
                            log(`📊 CVD Real: ${stats.connected} conexões, ${stats.withData} com dados`, 'info');
                        }
                        
                        log(`Aguardando 30s...`, 'info');
                        await new Promise(r => setTimeout(r, 30000));
                        
                    } catch (error) {
                        log(`Erro no scan: ${error.message}`, 'error');
                        connectionManager.markDisconnected();
                        await new Promise(r => setTimeout(r, 30000));
                    }
                }
            } catch (error) {
                log(`Erro fatal: ${error.message}`, 'error');
                await new Promise(r => setTimeout(r, 30000));
            }
        }
    };
    
    runScanner();
}

process.on('SIGINT', () => {
    log('Desligando...', 'warning');
    if (CONFIG.CVD.WEBSOCKET.ENABLED) {
        realCVD.shutdown();
    }
    process.exit(0);
});

loadDailyCounters();
startScanner().catch(console.error);
