const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES AJUSTÁVEIS DO SISTEMA ===
// =====================================================================

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AGJavdg';
const TELEGRAM_CHAT_ID = '-1002559';

// === CONFIGURAÇÃO DO ESTOCÁSTICO ===
const STOCHASTIC_CONFIG = {
    ENABLED: true,
    K_PERIOD: 5,
    D_PERIOD: 3,
    SLOWING: 3,
    TIMEFRAME: '12h',
    OVERBOUGHT: 80,
    OVERSOLD: 20,
    VOLUME_CONFIG: {
        COMPRA: {
            ENABLED: true,
            TIMEFRAME: '3m',
            MIN_VOLUME_ANORMAL: 0.6,
            ANALYZE_CANDLES: 20,
            REQUIRE_BUYER_DOMINANCE: true
        },
        VENDA: {
            ENABLED: true,
            TIMEFRAME: '3m',
            MIN_VOLUME_ANORMAL: 0.6,
            ANALYZE_CANDLES: 20,
            REQUIRE_SELLER_DOMINANCE: true
        }
    }
};

// === SISTEMA DE PRIORIDADE ===
const PRIORITY_CONFIG = {
  ENABLED: true,
  VOLUME_1H: {
    VOLUME_WEIGHT: 50,
    EMA_PERIOD: 9,
    MIN_VOLUME_RATIO: 1.0,
    VOLUME_DIRECTION_STRICT: true,
    VOLUME_DIRECTION_BONUS: 30,
    SENSITIVITY_MULTIPLIER: 1.1
  },
  LIQUIDITY: {
    MIN_LIQUIDITY_USDT: 100000,
    MAX_LIQUID_SYMBOLS: 500,
    LIQUIDITY_WEIGHT: 25
  },
  LSR: {
    ENABLED: true,
    IDEAL_BUY_LSR: 2.5,
    IDEAL_SELL_LSR: 2.8,
    LSR_WEIGHT: 25,
    PRIORITY_BONUS: 20
  },
  GENERAL: {
    PRIORITY_CACHE_TTL: 300000,
    SORT_MODE: 'HYBRID',
    VERBOSE_LOGS: true,
    UPDATE_EACH_CYCLE: true,
    MIN_SYMBOLS_FOR_PRIORIDADE: 10,
    EMOJI_RANKINGS: {
      'EXCELLENT': '🏆🏆🏆',
      'GOOD': '🏆🏆',
      'MEDIUM': '🏆',
      'LOW': '⚡',
      'POOR': '📉'
    }
  }
};

// === CONFIGURAÇÕES DE PERFORMANCE ===
const PERFORMANCE_CONFIG = {
  SYMBOL_DELAY_MS: 200,
  CYCLE_DELAY_MS: 30000,
  MAX_SYMBOLS_PER_CYCLE: 0,
  PRIORITIZE_RECENT_SIGNALS: true,
  COOLDOWN_MINUTES: 5
};

// =====================================================================
// === DIRETÓRIOS E VARIÁVEIS GLOBAIS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';

let alertCounter = {};
let dailyAlerts = 0;
let globalAlerts = 0;
let lastResetDate = null;

const priorityCache = {
  symbols: null,
  timestamp: 0,
  scores: {}
};

const symbolCooldown = {};
const stochasticCooldown = {};
const stochCrossState = {};

// === CACHE DE CANDLES ===
const candleCache = {};
const CANDLE_CACHE_TTL = 90000;
const MAX_CACHE_AGE = 12 * 60 * 1000;

// =====================================================================
// === ADAPTIVE RATE LIMITER ===
// =====================================================================
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

// =====================================================================
// === ADVANCED CLEANUP SYSTEM ===
// =====================================================================
class AdvancedCleanupSystem {
    constructor() {
        this.lastCleanup = Date.now();
        this.cleanupInterval = 5 * 60 * 1000;
        this.maxLogDays = 7;
        this.maxCacheDays = 1;
        this.memoryThreshold = 500 * 1024 * 1024;
    }

    cleanupCaches() {
        const now = Date.now();
        let deletedCount = 0;
        
        Object.keys(candleCache).forEach(key => {
            if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
                delete candleCache[key];
                deletedCount++;
            }
        });
        
        if (deletedCount > 0) {
            console.log(`🗑️  Cache limpo: ${deletedCount} entradas removidas`);
        }
        
        if (rateLimiter.queue.length > 100) {
            rateLimiter.queue = rateLimiter.queue.slice(0, 50);
            console.log(`🗑️  Fila reduzida para 50 requisições`);
        }
    }

    cleanupOldLogs() {
        if (!fs.existsSync(LOG_DIR)) return 0;
        
        try {
            const files = fs.readdirSync(LOG_DIR);
            const now = Date.now();
            const maxLogAge = this.maxLogDays * 24 * 60 * 60 * 1000;
            let deletedFiles = 0;
            
            files.forEach(file => {
                const filePath = path.join(LOG_DIR, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxLogAge) {
                        fs.unlinkSync(filePath);
                        deletedFiles++;
                        console.log(`🗑️  Log antigo removido: ${file}`);
                    }
                } catch (error) {
                    console.log(`⚠️  Erro ao verificar log ${file}: ${error.message}`);
                }
            });
            
            return deletedFiles;
        } catch (error) {
            console.log(`⚠️  Erro ao limpar logs: ${error.message}`);
            return 0;
        }
    }

    cleanupCacheFiles() {
        if (!fs.existsSync(CACHE_DIR)) return 0;
        
        try {
            const files = fs.readdirSync(CACHE_DIR);
            const now = Date.now();
            const maxCacheAge = this.maxCacheDays * 24 * 60 * 60 * 1000;
            let deletedFiles = 0;
            
            files.forEach(file => {
                const filePath = path.join(CACHE_DIR, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxCacheAge) {
                        fs.unlinkSync(filePath);
                        deletedFiles++;
                        console.log(`🗑️  Cache file removido: ${file}`);
                    }
                } catch (error) {
                    console.log(`⚠️  Erro ao verificar cache file ${file}: ${error.message}`);
                }
            });
            
            return deletedFiles;
        } catch (error) {
            console.log(`⚠️  Erro ao limpar cache files: ${error.message}`);
            return 0;
        }
    }

    monitorMemoryUsage() {
        const used = process.memoryUsage();
        const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
        const rssMB = Math.round(used.rss / 1024 / 1024);
        
        console.log(`🧠 Memória: ${heapUsedMB}MB usados / ${heapTotalMB}MB alocados / ${rssMB}MB RSS`);
        
        if (used.heapUsed > this.memoryThreshold) {
            console.log('⚠️  Memória alta, limpando cache agressivamente...');
            const cacheSizeBefore = Object.keys(candleCache).length;
            Object.keys(candleCache).forEach(key => delete candleCache[key]);
            console.log(`🗑️  Cache limpo: ${cacheSizeBefore} entradas removidas`);
            
            if (global.gc) {
                global.gc();
                console.log('🗑️  Coleta de lixo forçada executada');
            }
        }
        
        return heapUsedMB;
    }

    performFullCleanup() {
        const now = Date.now();
        
        if (now - this.lastCleanup > this.cleanupInterval) {
            console.log('\n🔄 Executando limpeza automática do sistema...');
            
            const logsRemoved = this.cleanupOldLogs();
            const cacheFilesRemoved = this.cleanupCacheFiles();
            const memoryUsed = this.monitorMemoryUsage();
            this.cleanupCaches();
            
            console.log(`✅ Limpeza completa: ${logsRemoved} logs, ${cacheFilesRemoved} arquivos cache`);
            console.log(`📊 Uso de memória atual: ${memoryUsed}MB`);
            
            this.lastCleanup = now;
        }
    }
}

// =====================================================================
// === SISTEMA DE PRIORIDADE AVANÇADO ===
// =====================================================================
class PrioritySystem {
    constructor() {
        this.liquidityData = null;
        this.lastUpdate = 0;
    }
    
    isInCooldown(symbol) {
        if (!symbolCooldown[symbol]) return false;
        const cooldownMs = PERFORMANCE_CONFIG.COOLDOWN_MINUTES * 60 * 1000;
        return (Date.now() - symbolCooldown[symbol]) < cooldownMs;
    }
    
    isInStochasticCooldown(symbol) {
        if (!stochasticCooldown[symbol]) return false;
        const cooldownMs = 60 * 60 * 1000;
        return (Date.now() - stochasticCooldown[symbol]) < cooldownMs;
    }
    
    registerStochasticAlert(symbol) {
        stochasticCooldown[symbol] = Date.now();
    }
    
    async fetchTickerData() {
        try {
            const url = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
            const data = await rateLimiter.makeRequest(url, {}, 'ticker');
            
            const tickerMap = {};
            data.forEach(ticker => {
                if (ticker.symbol.endsWith('USDT')) {
                    tickerMap[ticker.symbol] = {
                        volume: parseFloat(ticker.volume),
                        quoteVolume: parseFloat(ticker.quoteVolume),
                        lastPrice: parseFloat(ticker.lastPrice),
                        liquidity: parseFloat(ticker.quoteVolume)
                    };
                }
            });
            
            return tickerMap;
        } catch (error) {
            console.log(`⚠️  Erro ao buscar dados de ticker: ${error.message}`);
            return null;
        }
    }
    
    async fetchLSRData(symbols) {
        try {
            const lsrData = {};
            const symbolsToFetch = symbols.slice(0, 20);
            
            for (const symbol of symbolsToFetch) {
                try {
                    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
                    const response = await rateLimiter.makeRequest(url, {}, 'lsr');
                    
                    if (response && Array.isArray(response) && response.length > 0) {
                        const data = response[0];
                        lsrData[symbol] = {
                            lsr: parseFloat(data.longShortRatio),
                            longAccount: parseFloat(data.longAccount),
                            shortAccount: parseFloat(data.shortAccount),
                            timestamp: data.timestamp
                        };
                        
                        await new Promise(r => setTimeout(r, 100));
                    }
                } catch (error) {
                    console.log(`⚠️  Erro ao buscar LSR para ${symbol}: ${error.message}`);
                }
            }
            
            return lsrData;
        } catch (error) {
            console.log(`⚠️  Erro geral ao buscar dados LSR: ${error.message}`);
            return null;
        }
    }
    
    async prioritizeSymbols(symbols, signalType = null) {
        if (!PRIORITY_CONFIG.ENABLED || symbols.length < PRIORITY_CONFIG.GENERAL.MIN_SYMBOLS_FOR_PRIORIDADE) {
            return symbols;
        }
        
        const now = Date.now();
        
        if (priorityCache.symbols && 
            (now - priorityCache.timestamp) < PRIORITY_CONFIG.GENERAL.PRIORITY_CACHE_TTL &&
            !PRIORITY_CONFIG.GENERAL.UPDATE_EACH_CYCLE) {
            if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
                console.log(`📊 Usando cache de prioridade (${Math.round((now - priorityCache.timestamp)/1000)}s atrás)`);
            }
            return priorityCache.symbols;
        }
        
        console.log(`📊 Calculando prioridades para ${symbols.length} símbolos...`);
        
        try {
            const tickerData = await this.fetchTickerData();
            const lsrData = await this.fetchLSRData(symbols);
            
            if (!tickerData && !lsrData) {
                console.log('⚠️  Dados insuficientes para calcular prioridades, usando ordem original');
                return symbols;
            }
            
            const symbolScores = [];
            
            for (const symbol of symbols) {
                if (this.isInCooldown(symbol)) {
                    if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
                        console.log(`⏸️  ${symbol} em cooldown, pulando priorização`);
                    }
                    continue;
                }
                
                symbolScores.push({
                    symbol: symbol,
                    score: Math.random() * 100,
                    details: { emojiRanking: '🏆' }
                });
                
                priorityCache.scores[symbol] = {
                    score: Math.random() * 100,
                    timestamp: now,
                    emojiRanking: '🏆'
                };
            }
            
            symbolScores.sort((a, b) => b.score - a.score);
            
            let prioritizedSymbols = symbolScores.map(item => item.symbol);
            if (PRIORITY_CONFIG.LIQUIDITY.MAX_LIQUID_SYMBOLS > 0) {
                prioritizedSymbols = prioritizedSymbols.slice(0, PRIORITY_CONFIG.LIQUIDITY.MAX_LIQUID_SYMBOLS);
            }
            
            priorityCache.symbols = prioritizedSymbols;
            priorityCache.timestamp = now;
            
            console.log(`✅ Prioridades calculadas: ${prioritizedSymbols.length} símbolos ordenados`);
            return prioritizedSymbols;
            
        } catch (error) {
            console.log(`⚠️  Erro ao calcular prioridades: ${error.message}, usando ordem original`);
            return symbols;
        }
    }
    
    getSymbolPriorityInfo(symbol) {
        return priorityCache.scores[symbol] || null;
    }
}

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
    return brazilTime.toISOString().split('T')[0];
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

function getAlertCountForSymbol(symbol, type) {
    const currentDate = getBrazilianDateString();
    
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
    
    if (!alertCounter[symbol]) {
        alertCounter[symbol] = {
            stochastic: 0,
            total: 0,
            lastAlert: null,
            dailyStochastic: 0,
            dailyTotal: 0
        };
    }
    
    alertCounter[symbol][type.toLowerCase()]++;
    alertCounter[symbol].total++;
    alertCounter[symbol][`daily${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}`]++;
    alertCounter[symbol].dailyTotal++;
    alertCounter[symbol].lastAlert = Date.now();
    
    dailyAlerts++;
    globalAlerts++;
    
    return {
        symbolTotal: alertCounter[symbol].total,
        symbolStochastic: alertCounter[symbol].stochastic,
        symbolDailyTotal: alertCounter[symbol].dailyTotal,
        symbolDailyStochastic: alertCounter[symbol].dailyStochastic,
        globalTotal: globalAlerts,
        dailyTotal: dailyAlerts
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
    
    console.log(`\n🕘 ${getBrazilianDateTime().full} - RESETANDO CONTADORES DIÁRIOS (21h BR)`);
    
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyStochastic = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
    
    dailyAlerts = 0;
    lastResetDate = currentDate;
    
    console.log(`✅ Contadores diários zerados. Global: ${globalAlerts} | Diário: ${dailyAlerts}`);
}

async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        
        const message = `
<b>🚀 TITANIUM INICIADO </b>
<b>Matrix - Estocástico 12h</b>
<i>Análise completa </i>
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

// =====================================================================
// === FUNÇÕES DE ANÁLISE TÉCNICA ===
// =====================================================================
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

function calculateRSI(closes, period) {
    if (closes.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
        const difference = closes[i] - closes[i - 1];
        if (difference > 0) {
            gains += difference;
        } else {
            losses += Math.abs(difference);
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / (avgLoss || 0.001);
    return 100 - (100 / (1 + rs));
}

function calculateRSIForPeriod(closes, period) {
    if (closes.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
        const difference = closes[i] - closes[i - 1];
        if (difference > 0) {
            gains += difference;
        } else {
            losses += Math.abs(difference);
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / (avgLoss || 0.001);
    return 100 - (100 / (1 + rs));
}

async function getStochastic(symbol, timeframe = STOCHASTIC_CONFIG.TIMEFRAME) {
    try {
        const candles = await getCandles(symbol, timeframe, 50);
        if (candles.length < 14) {
            return null;
        }

        const kPeriod = STOCHASTIC_CONFIG.K_PERIOD;
        const dPeriod = STOCHASTIC_CONFIG.D_PERIOD;
        const slowing = STOCHASTIC_CONFIG.SLOWING;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = [];
        
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const highSlice = highs.slice(i - kPeriod + 1, i + 1);
            const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
            
            const highestHigh = Math.max(...highSlice);
            const lowestLow = Math.min(...lowSlice);
            
            if (highestHigh === lowestLow) {
                stochValues.push(50);
            } else {
                const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
                stochValues.push(k);
            }
        }
        
        const smoothedK = [];
        for (let i = slowing - 1; i < stochValues.length; i++) {
            const kSlice = stochValues.slice(i - slowing + 1, i + 1);
            const avgK = kSlice.reduce((a, b) => a + b, 0) / kSlice.length;
            smoothedK.push(avgK);
        }
        
        const dValues = [];
        for (let i = dPeriod - 1; i < smoothedK.length; i++) {
            const dSlice = smoothedK.slice(i - dPeriod + 1, i + 1);
            const d = dSlice.reduce((a, b) => a + b, 0) / dSlice.length;
            dValues.push(d);
        }
        
        if (smoothedK.length < 2 || dValues.length < 2) {
            return null;
        }
        
        const latestK = smoothedK[smoothedK.length - 1];
        const latestD = dValues[dValues.length - 1];
        const previousK = smoothedK[smoothedK.length - 2];
        const previousD = dValues[dValues.length - 2];
        
        const isCrossingUp = previousK <= previousD && latestK > latestD;
        const isCrossingDown = previousK >= previousD && latestK < latestD;
        
        let status = 'NEUTRAL';
        if (latestK < STOCHASTIC_CONFIG.OVERSOLD && latestD < STOCHASTIC_CONFIG.OVERSOLD) {
            status = 'OVERSOLD';
        } else if (latestK > STOCHASTIC_CONFIG.OVERBOUGHT && latestD > STOCHASTIC_CONFIG.OVERBOUGHT) {
            status = 'OVERBOUGHT';
        }
        
        return {
            k: latestK,
            d: latestD,
            previousK: previousK,
            previousD: previousD,
            isCrossingUp: isCrossingUp,
            isCrossingDown: isCrossingDown,
            status: status,
            isOversold: status === 'OVERSOLD',
            isOverbought: status === 'OVERBOUGHT',
            timeframe: timeframe,
            config: `${kPeriod}.${dPeriod}.${slowing}`
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular Estocástico para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzeVolume3mForStochastic(symbol, signalType) {
    try {
        const config = signalType === 'STOCHASTIC_COMPRA' 
            ? STOCHASTIC_CONFIG.VOLUME_CONFIG.COMPRA
            : STOCHASTIC_CONFIG.VOLUME_CONFIG.VENDA;
        
        if (!config.ENABLED) {
            return { isValid: true, analysis: null };
        }
        
        const candles = await getCandles(symbol, config.TIMEFRAME, config.ANALYZE_CANDLES);
        if (candles.length < config.ANALYZE_CANDLES) {
            return { isValid: false, analysis: null, error: 'Candles insuficientes' };
        }
        
        let buyerVolume = 0;
        let sellerVolume = 0;
        let totalVolume = 0;
        
        candles.forEach(candle => {
            const volume = candle.volume;
            totalVolume += volume;
            
            if (candle.close > candle.open) {
                buyerVolume += volume * 0.8;
                sellerVolume += volume * 0.2;
            } else if (candle.close < candle.open) {
                buyerVolume += volume * 0.2;
                sellerVolume += volume * 0.8;
            } else {
                buyerVolume += volume * 0.5;
                sellerVolume += volume * 0.5;
            }
        });
        
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 0;
        const sellerPercentage = totalVolume > 0 ? (sellerVolume / totalVolume) * 100 : 0;
        
        let isValid = false;
        let volumeStatus = '';
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (config.REQUIRE_BUYER_DOMINANCE) {
                isValid = buyerPercentage >= config.MIN_VOLUME_ANORMAL * 100;
                volumeStatus = isValid ? '✅ VOLUME COMPRADOR' : '❌ SEM VOL SUFICIENTE';
            } else {
                isValid = true;
                volumeStatus = '⚠️ VOLUME NÃO OBRIGATÓRIO';
            }
        } else if (signalType === 'STOCHASTIC_VENDA') {
            if (config.REQUIRE_SELLER_DOMINANCE) {
                isValid = sellerPercentage >= config.MIN_VOLUME_ANORMAL * 100;
                volumeStatus = isValid ? '🔴 VOLUME VENDEDOR' : '❌ SEM VOL SUFICIENTE';
            } else {
                isValid = true;
                volumeStatus = '⚠️ VOLUME NÃO OBRIGATÓRIO';
            }
        }
        
        return {
            isValid: isValid,
            analysis: {
                buyerVolume: buyerVolume,
                sellerVolume: sellerVolume,
                totalVolume: totalVolume,
                buyerPercentage: buyerPercentage.toFixed(1),
                sellerPercentage: sellerPercentage.toFixed(1),
                volumeStatus: volumeStatus,
                timeframe: config.TIMEFRAME,
                candlesAnalyzed: candles.length
            }
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao analisar volume 3m para ${symbol}: ${error.message}`);
        return { isValid: false, analysis: null, error: error.message };
    }
}

async function getCurrentPrice(symbol) {
    try {
        const candles = await getCandles(symbol, '1m', 1);
        return candles[candles.length - 1].close;
    } catch (error) {
        console.log(`⚠️ Erro ao buscar preço atual para ${symbol}: ${error.message}`);
        return 0;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 80);
        if (candles.length < 14) {
            return null;
        }

        const closes = candles.map(c => c.close);
        
        let gains = 0;
        let losses = 0;
        
        for (let i = 1; i < closes.length; i++) {
            const difference = closes[i] - closes[i - 1];
            if (difference > 0) {
                gains += difference;
            } else {
                losses += Math.abs(difference);
            }
        }
        
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        
        return {
            value: rsi,
            status: rsi < 25 ? 'OVERSOLD' : rsi > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular RSI para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const response = await rateLimiter.makeRequest(url, {}, 'lsr');
        
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

// =====================================================================
// === SINAIS DE ESTOCÁSTICO ===
// =====================================================================
async function checkStochasticSignal(symbol, prioritySystem) {
    if (!STOCHASTIC_CONFIG.ENABLED || prioritySystem.isInStochasticCooldown(symbol)) {
        return null;
    }

    try {
        const stochastic = await getStochastic(symbol);
        if (!stochastic) {
            return null;
        }

        const previousState = stochCrossState[symbol] || {
            wasCrossingUp: false,
            wasCrossingDown: false,
            lastCheck: 0
        };

        let signalType = null;
        let isFreshCross = false;

        if (stochastic.isCrossingUp) {
            if (!previousState.wasCrossingUp) {
                signalType = 'STOCHASTIC_COMPRA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para CIMA`);
            }
            stochCrossState[symbol] = {
                wasCrossingUp: true,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        } 
        else if (stochastic.isCrossingDown) {
            if (!previousState.wasCrossingDown) {
                signalType = 'STOCHASTIC_VENDA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para BAIXO`);
            }
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: true,
                lastCheck: Date.now()
            };
        }
        else {
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        }

        if (!isFreshCross || !signalType) {
            return null;
        }

        const [rsiData, lsrData, fundingData, pivotData, currentPrice] = await Promise.all([
            getRSI1h(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzePivotPoints(symbol, await getCurrentPrice(symbol), signalType === 'STOCHASTIC_COMPRA'),
            getCurrentPrice(symbol)
        ]);

        let isIdealLSR = false;
        if (lsrData) {
            if (signalType === 'STOCHASTIC_COMPRA') {
                isIdealLSR = lsrData.lsrValue < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR;
            } else {
                isIdealLSR = lsrData.lsrValue > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR;
            }
        }

        const volumeAnalysis = await analyzeVolume3mForStochastic(symbol, signalType);

        return {
            symbol: symbol,
            type: signalType,
            stochastic: stochastic,
            rsi: rsiData?.value,
            lsr: lsrData?.lsrValue,
            isIdealLSR: isIdealLSR,
            funding: fundingData?.ratePercent,
            pivotData: pivotData,
            currentPrice: currentPrice,
            time: getBrazilianDateTime(),
            volumeAnalysis: volumeAnalysis,
            isFreshCross: isFreshCross
        };
    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal Estocástico para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === ANÁLISE DE FATORES POSITIVOS E NEGATIVOS ===
// =====================================================================
async function analyzeTradeFactors(symbol, signalType, indicators) {
    const factors = {
        positive: [],
        negative: [],
        neutral: [],
        score: 0,
        maxScore: 0,
        summary: '',
        recommendation: ''
    };
    
    const weights = {
        FUNDING: 25,
        LSR: 30,
        RSI: 20,
        STRUCTURE: 25
    };
    
    factors.maxScore = Object.values(weights).reduce((a, b) => a + b, 0);
    let totalScore = 0;
    
    // === ANÁLISE DE FUNDING RATE ===
    if (indicators.funding) {
        const fundingValue = parseFloat(indicators.funding) / 100;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (fundingValue <= -0.001) {
                factors.positive.push(`🟢🟢 FUNDING EXTREMAMENTE FAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue <= -0.0003) {
                factors.positive.push(`🟢 FUNDING FAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue <= 0) {
                factors.positive.push(`🟡 FUNDING NEUTRO POSITIVO: ${(fundingValue * 100).toFixed(4)}% (levemente negativo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue <= 0.0003) {
                factors.negative.push(`🟡 FUNDING LEVEMENTE DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (positivo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue <= 0.001) {
                factors.negative.push(`🔴 FUNDING DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
            } else {
                factors.negative.push(`🔴🔴 FUNDING EXTREMAMENTE DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
            }
        } else {
            if (fundingValue >= 0.001) {
                factors.positive.push(`🔴🔴 FUNDING EXTREMAMENTE FAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue >= 0.0003) {
                factors.positive.push(`🔴 FUNDING FAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue > 0) {
                factors.positive.push(`🟡 FUNDING NEUTRO POSITIVO: ${(fundingValue * 100).toFixed(4)}% (levemente positivo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue >= -0.0003) {
                factors.negative.push(`🟡 FUNDING LEVEMENTE DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (negativo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue >= -0.001) {
                factors.negative.push(`🔵 FUNDING DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
            } else {
                factors.negative.push(`🔵🔵 FUNDING EXTREMAMENTE DESFAVORÁVEL: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ FUNDING: Indisponível`);
    }
    
    // === ANÁLISE DE LSR ===
    if (indicators.lsr) {
        const lsrValue = indicators.lsr;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (lsrValue < 1.5) {
                factors.positive.push(`🟢🟢 LSR EXTREMAMENTE FAVORÁVEL: ${lsrValue.toFixed(3)} (domínio shorts forte)`);
                totalScore += weights.LSR;
            } else if (lsrValue < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR) {
                factors.positive.push(`🟢 LSR FAVORÁVEL: ${lsrValue.toFixed(3)} (domínio shorts moderado)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue < 3.0) {
                factors.positive.push(`🟡 LSR NEUTRO POSITIVO: ${lsrValue.toFixed(3)} (equilíbrio com leve vantagem shorts)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue < 4.0) {
                factors.negative.push(`🟡 LSR LEVEMENTE DESFAVORÁVEL: ${lsrValue.toFixed(3)} (domínio longs moderado)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔴 LSR DESFAVORÁVEL: ${lsrValue.toFixed(3)} (domínio longs forte)`);
            }
        } else {
            if (lsrValue > 4.0) {
                factors.positive.push(`🔴🔴 LSR EXTREMAMENTE FAVORÁVEL: ${lsrValue.toFixed(3)} (domínio longs forte)`);
                totalScore += weights.LSR;
            } else if (lsrValue > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR) {
                factors.positive.push(`🔴 LSR FAVORÁVEL: ${lsrValue.toFixed(3)} (domínio longs moderado)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue > 2.0) {
                factors.positive.push(`🟡 LSR NEUTRO POSITIVO: ${lsrValue.toFixed(3)} (equilíbrio com leve vantagem longs)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue > 1.5) {
                factors.negative.push(`🟡 LSR LEVEMENTE DESFAVORÁVEL: ${lsrValue.toFixed(3)} (domínio shorts moderado)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔵 LSR DESFAVORÁVEL: ${lsrValue.toFixed(3)} (domínio shorts forte)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ LSR: Indisponível`);
    }
    
    // === ANÁLISE DE RSI ===
    if (indicators.rsi) {
        const rsiValue = indicators.rsi;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (rsiValue < 25) {
                factors.positive.push(`🟢🟢 RSI EXTREMAMENTE FAVORÁVEL: ${rsiValue.toFixed(1)} (sobrevendido forte)`);
                totalScore += weights.RSI;
            } else if (rsiValue < 30) {
                factors.positive.push(`🟢 RSI FAVORÁVEL: ${rsiValue.toFixed(1)} (sobrevendido moderado)`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue < 40) {
                factors.positive.push(`🟡 RSI NEUTRO POSITIVO: ${rsiValue.toFixed(1)} (próximo sobrevenda)`);
                totalScore += weights.RSI * 0.5;
            } else if (rsiValue < 50) {
                factors.negative.push(`🟡 RSI LEVEMENTE DESFAVORÁVEL: ${rsiValue.toFixed(1)} (neutro com viés baixista)`);
                totalScore += weights.RSI * 0.2;
            } else if (rsiValue < 70) {
                factors.negative.push(`🔴 RSI DESFAVORÁVEL: ${rsiValue.toFixed(1)} (neutro com viés comprador)`);
            } else {
                factors.negative.push(`🔴🔴 RSI EXTREMAMENTE DESFAVORÁVEL: ${rsiValue.toFixed(1)} (sobrecomprado)`);
            }
        } else {
            if (rsiValue > 75) {
                factors.positive.push(`🔴🔴 RSI EXTREMAMENTE FAVORÁVEL: ${rsiValue.toFixed(1)} (sobrecomprado forte)`);
                totalScore += weights.RSI;
            } else if (rsiValue > 70) {
                factors.positive.push(`🔴 RSI FAVORÁVEL: ${rsiValue.toFixed(1)} (sobrecomprado moderado)`);
                totalScore += weights.RSI * 0.8;
            } else if (rsiValue > 60) {
                factors.positive.push(`🟡 RSI NEUTRO POSITIVO: ${rsiValue.toFixed(1)} (próximo sobrecompra)`);
                totalScore += weights.RSI * 0.5;
            } else if (rsiValue > 50) {
                factors.negative.push(`🟡 RSI LEVEMENTE DESFAVORÁVEL: ${rsiValue.toFixed(1)} (neutro com viés comprador)`);
                totalScore += weights.RSI * 0.2;
            } else if (rsiValue > 30) {
                factors.negative.push(`🔵 RSI DESFAVORÁVEL: ${rsiValue.toFixed(1)} (neutro com viés vendedor)`);
            } else {
                factors.negative.push(`🔵🔵 RSI EXTREMAMENTE DESFAVORÁVEL: ${rsiValue.toFixed(1)} (sobrevendido)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ RSI: Indisponível`);
    }
    
    // === ANÁLISE DE ESTRUTURA ===
    if (indicators.pivotData) {
        const pivot = indicators.pivotData;
        const currentPrice = indicators.currentPrice;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                
                if (distToResistance > 5) {
                    factors.positive.push(`🟢🟢 ESTRUTURA FAVORÁVEL: Resistência distante ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                    totalScore += weights.STRUCTURE;
                } else if (distToResistance > 3) {
                    factors.positive.push(`🟢 ESTRUTURA FAVORÁVEL: Resistência moderada ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToResistance > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA NEUTRA: Resistência próxima ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔴 ESTRUTURA DESFAVORÁVEL: Resistência muito próxima ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                }
            }
            
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                
                if (distToSupport < 1) {
                    factors.positive.push(`🟢 STOP PRÓXIMO: Suporte a ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                } else if (distToSupport < 2) {
                    factors.positive.push(`🟡 STOP MODERADO: Suporte a ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                }
            }
            
            if (currentPrice > pivot.pivot) {
                factors.positive.push(`🟢 PREÇO ACIMA DO PIVÔ: ${((currentPrice - pivot.pivot) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            } else {
                factors.negative.push(`🔵 PREÇO ABAIXO DO PIVÔ: ${((pivot.pivot - currentPrice) / pivot.pivot * 100).toFixed(2)}%`);
            }
            
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                
                if (distToSupport > 5) {
                    factors.positive.push(`🔴🔴 ESTRUTURA FAVORÁVEL: Suporte distante ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                    totalScore += weights.STRUCTURE;
                } else if (distToSupport > 3) {
                    factors.positive.push(`🔴 ESTRUTURA FAVORÁVEL: Suporte moderado ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToSupport > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA NEUTRA: Suporte próximo ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔵 ESTRUTURA DESFAVORÁVEL: Suporte muito próximo ${distToSupport.toFixed(2)}% (${pivot.nearestSupport.type})`);
                }
            }
            
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                
                if (distToResistance < 1) {
                    factors.positive.push(`🔴 STOP PRÓXIMO: Resistência a ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                } else if (distToResistance < 2) {
                    factors.positive.push(`🟡 STOP MODERADO: Resistência a ${distToResistance.toFixed(2)}% (${pivot.nearestResistance.type})`);
                }
            }
            
            if (currentPrice < pivot.pivot) {
                factors.positive.push(`🔵 PREÇO ABAIXO DO PIVÔ: ${((pivot.pivot - currentPrice) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            } else {
                factors.negative.push(`🟢 PREÇO ACIMA DO PIVÔ: ${((currentPrice - pivot.pivot) / pivot.pivot * 100).toFixed(2)}%`);
            }
        }
    }
    
    // === ANÁLISE DE VOLUME 3M ===
    if (indicators.volumeAnalysis && indicators.volumeAnalysis.analysis) {
        const vol = indicators.volumeAnalysis.analysis;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (vol.buyerPercentage >= 60) {
                factors.positive.push(`🟢🟢 VOLUME COMPRADOR FORTE: ${vol.buyerPercentage}% domínio comprador`);
                totalScore += 15;
            } else if (vol.buyerPercentage >= 55) {
                factors.positive.push(`🟢 VOLUME COMPRADOR MODERADO: ${vol.buyerPercentage}% domínio comprador`);
                totalScore += 10;
            } else if (vol.buyerPercentage >= 50) {
                factors.positive.push(`🟡 VOLUME EQUILIBRADO: ${vol.buyerPercentage}% comprador / ${vol.sellerPercentage}% vendedor`);
                totalScore += 5;
            } else {
                factors.negative.push(`🔵 VOLUME VENDEDOR PREDOMINA: ${vol.sellerPercentage}% domínio vendedor`);
            }
        } else {
            if (vol.sellerPercentage >= 60) {
                factors.positive.push(`🔴🔴 VOLUME VENDEDOR FORTE: ${vol.sellerPercentage}% domínio vendedor`);
                totalScore += 15;
            } else if (vol.sellerPercentage >= 55) {
                factors.positive.push(`🔴 VOLUME VENDEDOR MODERADO: ${vol.sellerPercentage}% domínio vendedor`);
                totalScore += 10;
            } else if (vol.sellerPercentage >= 50) {
                factors.positive.push(`🟡 VOLUME EQUILIBRADO: ${vol.buyerPercentage}% comprador / ${vol.sellerPercentage}% vendedor`);
                totalScore += 5;
            } else {
                factors.negative.push(`🟢 VOLUME COMPRADOR PREDOMINA: ${vol.buyerPercentage}% domínio comprador`);
            }
        }
    }
    
    factors.score = Math.min(100, Math.round((totalScore / factors.maxScore) * 100));
    
    if (signalType === 'STOCHASTIC_COMPRA') {
        if (factors.score >= 80) {
            factors.summary = '🏆 OPORTUNIDADE EXCELENTE PARA COMPRA';
            factors.recommendation = '✅ Entrada agressiva recomendada. Todos os fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 OPORTUNIDADE FAVORÁVEL PARA COMPRA';
            factors.recommendation = '📊 Entrada moderada recomendada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ OPORTUNIDADE NEUTRA PARA COMPRA';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos x benefícios.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ OPORTUNIDADE DESFAVORÁVEL PARA COMPRA';
            factors.recommendation = '❌ Evitar entrada. Aguardar melhores condições.';
        } else {
            factors.summary = '🚫 OPORTUNIDADE RUIM PARA COMPRA';
            factors.recommendation = '❌❌ Não entrar. Múltiplos fatores negativos.';
        }
    } else {
        if (factors.score >= 80) {
            factors.summary = '🏆 OPORTUNIDADE EXCELENTE PARA VENDA/CORREÇÃO';
            factors.recommendation = '✅ Entrada agressiva recomendada. Todos os fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 OPORTUNIDADE FAVORÁVEL PARA VENDA/CORREÇÃO';
            factors.recommendation = '📊 Entrada moderada recomendada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ OPORTUNIDADE NEUTRA PARA VENDA/CORREÇÃO';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos x benefícios.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ OPORTUNIDADE DESFAVORÁVEL PARA VENDA/CORREÇÃO';
            factors.recommendation = '❌ Evitar entrada. Aguardar melhores condições.';
        } else {
            factors.summary = '🚫 OPORTUNIDADE RUIM PARA VENDA/CORREÇÃO';
            factors.recommendation = '❌❌ Não entrar. Múltiplos fatores negativos.';
        }
    }
    
    return factors;
}

function formatFactorsAnalysis(factors) {
    let analysisText = '\n<b><i>📊 ANÁLISE DE FATORES:</i></b>\n';
    analysisText += `<b>Score: ${factors.score}% | Máx: ${factors.maxScore}</b>\n`;
    analysisText += `<b>${factors.summary}</b>\n\n`;
    
    analysisText += '<b><i>✅ FATORES POSITIVOS:</i></b>\n';
    if (factors.positive && factors.positive.length > 0) {
        factors.positive.slice(0, 5).forEach(f => {
            analysisText += `${f}\n`;
        });
    } else {
        analysisText += '⚪ Nenhum fator positivo significativo\n';
    }
    
    analysisText += '\n<b><i>❌ FATORES NEGATIVOS:</i></b>\n';
    if (factors.negative && factors.negative.length > 0) {
        factors.negative.slice(0, 5).forEach(f => {
            analysisText += `${f}\n`;
        });
    } else {
        analysisText += '⚪ Nenhum fator negativo significativo\n';
    }
    
    if (factors.neutral && factors.neutral.length > 0) {
        analysisText += '\n<b><i>⚪ FATORES NEUTROS:</i></b>\n';
        factors.neutral.slice(0, 3).forEach(f => {
            analysisText += `${f}\n`;
        });
    }
    
    analysisText += `\n<b><i>💡 RECOMENDAÇÃO:</i></b>\n${factors.recommendation}\n`;
    
    return analysisText;
}

// =====================================================================
// === ANÁLISES DETALHADAS ===
// =====================================================================
async function analyzeFundingRateDetailed(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=10`;
        const data = await rateLimiter.makeRequest(url, {}, 'fundingRateDetailed');
        
        if (!data || data.length === 0) {
            return null;
        }
        
        let totalFunding = 0;
        let positiveCount = 0;
        let negativeCount = 0;
        let zeroCount = 0;
        
        data.forEach(item => {
            const rate = parseFloat(item.fundingRate);
            totalFunding += rate;
            if (rate > 0) positiveCount++;
            else if (rate < 0) negativeCount++;
            else zeroCount++;
        });
        
        const avgFunding = totalFunding / data.length;
        const currentFunding = parseFloat(data[0].fundingRate);
        
        let trend = 'NEUTRO';
        let trendEmoji = '⚪';
        
        if (positiveCount > negativeCount * 1.5) {
            trend = 'POSITIVO FORTE';
            trendEmoji = '🔴🔴';
        } else if (positiveCount > negativeCount) {
            trend = 'POSITIVO MODERADO';
            trendEmoji = '🔴';
        } else if (negativeCount > positiveCount * 1.5) {
            trend = 'NEGATIVO FORTE';
            trendEmoji = '🟢🟢';
        } else if (negativeCount > positiveCount) {
            trend = 'NEGATIVO MODERADO';
            trendEmoji = '🟢';
        }
        
        return {
            currentRate: currentFunding,
            currentRatePercent: (currentFunding * 100).toFixed(5),
            avgRate: avgFunding,
            avgRatePercent: (avgFunding * 100).toFixed(5),
            positiveCount,
            negativeCount,
            zeroCount,
            trend,
            trendEmoji
        };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar funding rate detalhado para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzeLSRDetailed(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=10`;
        const response = await rateLimiter.makeRequest(url, {}, 'lsrDetailed');
        
        if (!response || !Array.isArray(response) || response.length === 0) {
            return null;
        }
        
        let totalLSR = 0;
        let above2Count = 0;
        let below1Count = 0;
        
        response.forEach(item => {
            const lsr = parseFloat(item.longShortRatio);
            totalLSR += lsr;
            if (lsr > 2) above2Count++;
            if (lsr < 1) below1Count++;
        });
        
        const avgLSR = totalLSR / response.length;
        const currentLSR = parseFloat(response[0].longShortRatio);
        
        let sentiment = 'NEUTRO';
        let sentimentEmoji = '⚪';
        
        if (currentLSR > 3) {
            sentiment = 'MUY ALTA (Longs dominantes)';
            sentimentEmoji = '🔴🔴';
        } else if (currentLSR > 2) {
            sentiment = 'ALTA (Longs em vantagem)';
            sentimentEmoji = '🔴';
        } else if (currentLSR < 0.8) {
            sentiment = 'MUY BAJA (Shorts dominantes)';
            sentimentEmoji = '🟢🟢';
        } else if (currentLSR < 1) {
            sentiment = 'BAJA (Shorts em vantagem)';
            sentimentEmoji = '🟢';
        }
        
        return {
            currentLSR,
            avgLSR,
            above2Count,
            below1Count,
            sentiment,
            sentimentEmoji
        };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar LSR detalhado para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzeRSIDetailed(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 100);
        if (candles.length < 50) {
            return null;
        }

        const closes = candles.map(c => c.close);
        
        const rsi14 = calculateRSI(closes, 14);
        const rsi7 = calculateRSI(closes, 7);
        const rsi21 = calculateRSI(closes, 21);
        
        const rsiValues = [];
        for (let i = 13; i < closes.length; i++) {
            const rsi = calculateRSIForPeriod(closes.slice(0, i + 1), 14);
            rsiValues.push(rsi);
        }
        
        const rsiMA5 = rsiValues.length >= 5 
            ? rsiValues.slice(-5).reduce((a, b) => a + b, 0) / 5 
            : rsi14;
        
        let divergence = 'NENHUMA';
        let divergenceEmoji = '⚪';
        
        if (rsi14 > 70 && closes[closes.length - 1] > closes[closes.length - 2]) {
            divergence = 'POSSÍVEL DIVERGÊNCIA DE BAIXA';
            divergenceEmoji = '🔴';
        } else if (rsi14 < 30 && closes[closes.length - 1] < closes[closes.length - 2]) {
            divergence = 'POSSÍVEL DIVERGÊNCIA DE ALTA';
            divergenceEmoji = '🟢';
        }
        
        return {
            rsi14: rsi14.toFixed(1),
            rsi7: rsi7.toFixed(1),
            rsi21: rsi21.toFixed(1),
            rsiMA5: rsiMA5.toFixed(1),
            divergence,
            divergenceEmoji
        };
    } catch (error) {
        console.log(`⚠️ Erro ao analisar RSI detalhado para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzeStructureDetailed(symbol, currentPrice, isBullish) {
    try {
        const [candles15m, candles1h, candles4h] = await Promise.all([
            getCandles(symbol, '15m', 100),
            getCandles(symbol, '1h', 50),
            getCandles(symbol, '4h', 30)
        ]);
        
        const highs15m = candles15m.map(c => c.high);
        const lows15m = candles15m.map(c => c.low);
        const highs1h = candles1h.map(c => c.high);
        const lows1h = candles1h.map(c => c.low);
        const highs4h = candles4h.map(c => c.high);
        const lows4h = candles4h.map(c => c.low);
        
        const recentHigh15m = Math.max(...highs15m.slice(-20));
        const recentLow15m = Math.min(...lows15m.slice(-20));
        const recentHigh1h = Math.max(...highs1h.slice(-20));
        const recentLow1h = Math.min(...lows1h.slice(-20));
        const recentHigh4h = Math.max(...highs4h.slice(-20));
        const recentLow4h = Math.min(...lows4h.slice(-20));
        
        const pivot15m = (recentHigh15m + recentLow15m + candles15m[candles15m.length - 1].close) / 3;
        const pivot1h = (recentHigh1h + recentLow1h + candles1h[candles1h.length - 1].close) / 3;
        const pivot4h = (recentHigh4h + recentLow4h + candles4h[candles4h.length - 1].close) / 3;
        
        const psychologicalLevels = [];
        if (currentPrice < 1) {
            psychologicalLevels.push(Math.round(currentPrice * 100) / 100);
            psychologicalLevels.push(Math.round(currentPrice * 100 + 5) / 100);
            psychologicalLevels.push(Math.round(currentPrice * 100 - 5) / 100);
        } else if (currentPrice < 10) {
            psychologicalLevels.push(Math.round(currentPrice * 10) / 10);
            psychologicalLevels.push(Math.round(currentPrice * 10 + 5) / 10);
            psychologicalLevels.push(Math.round(currentPrice * 10 - 5) / 10);
        } else if (currentPrice < 100) {
            psychologicalLevels.push(Math.round(currentPrice));
            psychologicalLevels.push(Math.round(currentPrice) + 5);
            psychologicalLevels.push(Math.round(currentPrice) - 5);
        } else {
            psychologicalLevels.push(Math.round(currentPrice / 10) * 10);
            psychologicalLevels.push(Math.round(currentPrice / 10) * 10 + 10);
            psychologicalLevels.push(Math.round(currentPrice / 10) * 10 - 10);
        }
        
        let trend = 'NEUTRO';
        let trendEmoji = '⚪';
        
        const ema9_1h = calculateEMA(candles1h.map(c => c.close), 9);
        const ema21_1h = calculateEMA(candles1h.map(c => c.close), 21);
        
        if (ema9_1h > ema21_1h && candles1h[candles1h.length - 1].close > ema9_1h) {
            trend = 'ALTA';
            trendEmoji = '🟢';
        } else if (ema9_1h < ema21_1h && candles1h[candles1h.length - 1].close < ema9_1h) {
            trend = 'BAIXA';
            trendEmoji = '🔴';
        }
        
        return {
            pivots: {
                '15m': pivot15m,
                '1h': pivot1h,
                '4h': pivot4h
            },
            levels: {
                resistance15m: recentHigh15m,
                support15m: recentLow15m,
                resistance1h: recentHigh1h,
                support1h: recentLow1h,
                resistance4h: recentHigh4h,
                support4h: recentLow4h
            },
            psychologicalLevels,
            trend,
            trendEmoji,
            currentPrice
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao analisar estrutura detalhada para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === ALERTA MELHORADO COM ANÁLISE DE FATORES ===
// =====================================================================
async function sendStochasticAlertEnhanced(signal, prioritySystem) {
    if (!signal.volumeAnalysis.isValid) {
        console.log(`⚠️  ${signal.symbol}: Volume 3m não atende aos critérios para alerta ${signal.type}`);
        return;
    }
    
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    prioritySystem.registerStochasticAlert(signal.symbol);
    
    const [fundingDetailed, lsrDetailed, rsiDetailed, structureDetailed] = await Promise.all([
        analyzeFundingRateDetailed(signal.symbol),
        analyzeLSRDetailed(signal.symbol),
        analyzeRSIDetailed(signal.symbol),
        analyzeStructureDetailed(signal.symbol, signal.currentPrice, signal.type === 'STOCHASTIC_COMPRA')
    ]);
    
    signal.fundingDetailed = fundingDetailed;
    signal.lsrDetailed = lsrDetailed;
    signal.rsiDetailed = rsiDetailed;
    signal.structureDetailed = structureDetailed;
    
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        funding: signal.funding,
        lsr: signal.lsr,
        rsi: signal.rsi,
        pivotData: signal.pivotData,
        currentPrice: signal.currentPrice,
        volumeAnalysis: signal.volumeAnalysis
    });
    
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
    
    const lsrEmoji = signal.type === 'STOCHASTIC_COMPRA' 
        ? (signal.lsr < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR ? '🟢' : '🔴')
        : (signal.lsr > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR ? '🔴' : '🟢');
    
    const stochStatus = signal.stochastic.isOversold ? 'Baixo 🔵' : 
                       signal.stochastic.isOverbought ? 'Alto 🔴' : 'Neutro ⚪';
    
    const action = signal.type === 'STOCHASTIC_COMPRA' ? '⤴️🟢 COMPRA' : '⤵️🔴 CORREÇÃO';
    
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 Resistência: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 Suporte: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.pivot) {
            pivotInfo += `\n⚖️ Pivô: $${signal.pivotData.pivot.toFixed(6)}`;
        }
    }
    
    let trendInfo = '';
    if (signal.structureDetailed) {
        trendInfo = `\n Tendência 1h: ${signal.structureDetailed.trendEmoji} ${signal.structureDetailed.trend}`;
    }
    
    let lsrDetailedInfo = '';
    if (signal.lsrDetailed) {
        lsrDetailedInfo = `\n LSR  ${signal.lsrDetailed.currentLSR.toFixed(3)} | Média ${signal.lsrDetailed.avgLSR.toFixed(3)}`;
        lsrDetailedInfo += `\n   Sentimento: ${signal.lsrDetailed.sentimentEmoji} ${signal.lsrDetailed.sentiment}`;
    }
    
    let fundingDetailedInfo = '';
    if (signal.fundingDetailed) {
        fundingDetailedInfo = `\n Funding Rate: ${signal.fundingDetailed.currentRatePercent}% | Média ${signal.fundingDetailed.avgRatePercent}%`;
        fundingDetailedInfo += `\n   Tendência: ${signal.fundingDetailed.trendEmoji} ${signal.fundingDetailed.trend}`;
    }
    
    let rsiDetailedInfo = '';
    if (signal.rsiDetailed) {
        rsiDetailedInfo = `\n RSI Detalhado: 14:${signal.rsiDetailed.rsi14} | 7:${signal.rsiDetailed.rsi7} | 21:${signal.rsiDetailed.rsi21}`;
        rsiDetailedInfo += `\n   MA5:${signal.rsiDetailed.rsiMA5} | ${signal.rsiDetailed.divergenceEmoji} ${signal.rsiDetailed.divergence}`;
    }
    
    const rsiEmoji = signal.rsi < 30 ? '🔵' : signal.rsi > 70 ? '🔴' : '⚪';
    
    let volumeInfo = '';
    if (signal.volumeAnalysis && signal.volumeAnalysis.analysis) {
        const vol = signal.volumeAnalysis.analysis;
        volumeInfo = `\n<b><i>📊 Volume ${vol.timeframe}:</i></b>`;
        volumeInfo += `\n<i>${vol.volumeStatus}</i>`;
        volumeInfo += `\n<i>🟢Comprador: ${vol.buyerPercentage}% | 🔴Vendedor: ${vol.sellerPercentage}%</i>`;
    }
    
    const factorsAnalysis = formatFactorsAnalysis(factors);
    
    const message = `
<b><i> ${signal.symbol} - PREÇO: $${signal.currentPrice.toFixed(6)} ${signal.isIdealLSR ? '✨✨' : ''}</i></b>
${action}
 ${signal.time.full}
 STOCH 12H  #${alertCount.symbolStochastic}
${volumeInfo}
<b><i>INDICADORES:</i></b>
• STOCH 12h: %K ${signal.stochastic.k.toFixed(2)} | %D: ${signal.stochastic.d.toFixed(2)}
  Status: ${stochStatus} ${signal.type === 'STOCHASTIC_COMPRA' ? '📈 %K ⤴️' : '📉 %K ⤵️'}
• ${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.isIdealLSR ? '🏆' : ''} 
• RSI 1h: ${rsiEmoji} ${signal.rsi?.toFixed(1) || 'N/A'}
• Funding Rate: ${fundingRateText}
${lsrDetailedInfo}
${fundingDetailedInfo}
${rsiDetailedInfo}
${trendInfo}
<b><i>🔍Estrutura :</i></b>${pivotInfo}
${factorsAnalysis}
<b><i>✨ Titanium by  @J4Rviz ✨</i></b>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta ENHANCED enviado: ${signal.symbol} (${action})`);
    console.log(`   📊 Score: ${factors.score}% | ${factors.summary}`);
    console.log(`   ✅ Positivos: ${factors.positive?.length || 0} | ❌ Negativos: ${factors.negative?.length || 0}`);
    console.log(`   💡 Recomendação: ${factors.recommendation}`);
}

// =====================================================================
// === MONITORAMENTO PRINCIPAL ===
// =====================================================================
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

async function monitorSymbol(symbol, prioritySystem) {
    try {
        console.log(`🔍 Analisando ${symbol}...`);
        
        const priorityInfo = prioritySystem.getSymbolPriorityInfo(symbol);
        if (priorityInfo && PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
            console.log(`   ${priorityInfo.emojiRanking} Prioridade: ${priorityInfo.score.toFixed(1)}`);
        }
        
        if (STOCHASTIC_CONFIG.ENABLED) {
            const stochasticSignal = await checkStochasticSignal(symbol, prioritySystem);
            if (stochasticSignal) {
                await sendStochasticAlertEnhanced(stochasticSignal, prioritySystem);
                return true;
            }
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
        console.log(' TITANIUM ATIVADO - ESTOCÁSTICO 12H ');
        console.log(' ALERTAS SOMENTE NO MOMENTO EXATO DO CRUZAMENTO ');
        console.log(' ANÁLISE COMPLETA DE FATORES POSITIVOS/NEGATIVOS ');
        console.log('='.repeat(80) + '\n');

        const cleanupSystem = new AdvancedCleanupSystem();
        const prioritySystem = new PrioritySystem();
        
        let cycle = 0;
        while (true) {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
            
            cleanupSystem.performFullCleanup();
            
            const currentHour = getBrazilianHour();
            if (currentHour >= 21 && lastResetDate !== getBrazilianDateString()) {
                resetDailyCounters();
            }
            
            let symbolsToMonitor = symbols;
            if (PRIORITY_CONFIG.ENABLED) {
                symbolsToMonitor = await prioritySystem.prioritizeSymbols(symbols);
                
                if (PERFORMANCE_CONFIG.MAX_SYMBOLS_PER_CYCLE > 0) {
                    symbolsToMonitor = symbolsToMonitor.slice(0, PERFORMANCE_CONFIG.MAX_SYMBOLS_PER_CYCLE);
                    console.log(`📊 Monitorando ${symbolsToMonitor.length}/${symbols.length} símbolos`);
                }
            }
            
            let signalsFound = 0;
            let symbolsAnalyzed = 0;
            
            for (const symbol of symbolsToMonitor) {
                try {
                    const foundSignal = await monitorSymbol(symbol, prioritySystem);
                    if (foundSignal) signalsFound++;
                    
                    symbolsAnalyzed++;
                    
                    await new Promise(r => setTimeout(r, PERFORMANCE_CONFIG.SYMBOL_DELAY_MS));
                } catch (error) {
                    continue;
                }
            }
            
            console.log(`\n✅ Ciclo ${cycle} completo.`);
            console.log(`📊 Símbolos analisados: ${symbolsAnalyzed}/${symbols.length}`);
            console.log(`🎯 Cruzamentos detectados: ${signalsFound}`);
            console.log(`📈 Total global: ${globalAlerts} | Total diário: ${dailyAlerts}`);
            console.log(`🔍 Ativos monitorados: ${Object.keys(alertCounter).length}`);
            
            const now = Date.now();
            Object.keys(stochCrossState).forEach(symbol => {
                if (now - stochCrossState[symbol].lastCheck > 24 * 60 * 60 * 1000) {
                    delete stochCrossState[symbol];
                }
            });
            
            cleanupSystem.cleanupCaches();
            
            console.log(`\n⏳ Próximo ciclo em ${PERFORMANCE_CONFIG.CYCLE_DELAY_MS/1000} segundos...`);
            await new Promise(r => setTimeout(r, PERFORMANCE_CONFIG.CYCLE_DELAY_MS));
        }
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await mainBotLoop();
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
let rateLimiter = new AdaptiveRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - ESTOCÁSTICO 5.3.3 12H v5.0');
        console.log('🎯 Sistema especializado em alertas de CRUZAMENTO Estocástico');
        console.log('📈 Configurações Ativas:');
        console.log(`   • Estocástico: ${STOCHASTIC_CONFIG.ENABLED ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
        console.log(`   • Config Estocástico: ${STOCHASTIC_CONFIG.K_PERIOD}.${STOCHASTIC_CONFIG.D_PERIOD}.${STOCHASTIC_CONFIG.SLOWING} ${STOCHASTIC_CONFIG.TIMEFRAME}`);
        console.log(`   • Overbought: ${STOCHASTIC_CONFIG.OVERBOUGHT} | Oversold: ${STOCHASTIC_CONFIG.OVERSOLD}`);
        console.log(`   • Volume 3m para Estocástico COMPRA: ${STOCHASTIC_CONFIG.VOLUME_CONFIG.COMPRA.ENABLED ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
        console.log(`   • Volume 3m mínimo comprador: ${STOCHASTIC_CONFIG.VOLUME_CONFIG.COMPRA.MIN_VOLUME_ANORMAL * 100}%`);
        console.log(`   • Volume 3m para Estocástico VENDA: ${STOCHASTIC_CONFIG.VOLUME_CONFIG.VENDA.ENABLED ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
        console.log(`   • Volume 3m mínimo vendedor: ${STOCHASTIC_CONFIG.VOLUME_CONFIG.VENDA.MIN_VOLUME_ANORMAL * 100}%`);
        console.log(`   • LSR Compra Ideal: < ${PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR}`);
        console.log(`   • LSR Venda Ideal: > ${PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR}`);
        console.log(`   • Alerta: SOMENTE NO MOMENTO EXATO DO CRUZAMENTO`);
        console.log('   • ANÁLISE DE FATORES: ✅ ATIVADO');
        console.log('🗑️  Sistema de Limpeza Avançado Ativado');
        console.log('⏱️  Cooldown Estocástico: 1 hora');
        console.log('='.repeat(80) + '\n');
        
        lastResetDate = getBrazilianDateString();
        
        await sendInitializationMessage();
        
        console.log('✅ Tudo pronto! Iniciando monitoramento de CRUZAMENTOS Estocástico 12H...');
        console.log('⚠️  Alertas serão enviados SOMENTE no momento exato do cruzamento %K x %D');
        console.log('📊  Análise completa de Fatores Positivos/Negativos será incluída nos alertas');
        
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO NA INICIALIZAÇÃO: ${error.message}`);
        process.exit(1);
    }
}

if (global.gc) {
    console.log('🗑️  Coleta de lixo forçada disponível');
}

startBot();
