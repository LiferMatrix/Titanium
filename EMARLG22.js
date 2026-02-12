const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES AJUSTÁVEIS DO SISTEMA ===
// =====================================================================

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AGJavdg';
const TELEGRAM_CHAT_ID = '-1002579';

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

// === CONFIGURAÇÃO DE RETRAÇÃO POR ATR ===
const RETRACTION_CONFIG = {
    ENABLED: true,
    ATR_TIMEFRAME: '15m',
    ATR_PERIOD: 14,
    COMPRA: {
        ENABLED: true,
        USE_ATR_MULTIPLIER: 0.5,        // 50% do ATR para entrada de retração
        MIN_PULLBACK_PERCENT: 0.1,      // Retração mínima de 0.1% para considerar
        MAX_PULLBACK_PERCENT: 2.0,      // Retração máxima de 2% para evitar entradas ruins
        WAIT_TIME_MS: 5000,             // Tempo para aguardar a retração (5 segundos)
        ALERT_MESSAGE: '📉 POSSÍVEL RETRAÇÃO DETECTADA - AGUARDANDO ENTRADA',
        ENTRY_MESSAGE: '✅ RETRAÇÃO CONFIRMADA - ENTRADA EXECUTADA',
        CANCEL_MESSAGE: '❌ RETRAÇÃO NÃO OCORREU - OPORTUNIDADE CANCELADA'
    },
    VENDA: {
        ENABLED: true,
        USE_ATR_MULTIPLIER: 0.5,        // 50% do ATR para entrada de retração
        MIN_PULLBACK_PERCENT: 0.1,      // Retração mínima de 0.1% para considerar
        MAX_PULLBACK_PERCENT: 2.0,      // Retração máxima de 2% para evitar entradas ruins
        WAIT_TIME_MS: 5000,             // Tempo para aguardar a retração (5 segundos)
        ALERT_MESSAGE: '📈 POSSÍVEL RETRAÇÃO DETECTADA - AGUARDANDO ENTRADA',
        ENTRY_MESSAGE: '✅ RETRAÇÃO CONFIRMADA - ENTRADA EXECUTADA',
        CANCEL_MESSAGE: '❌ RETRAÇÃO NÃO OCORREU - OPORTUNIDADE CANCELADA'
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

// === CACHE DE RETRAÇÃO POR ATR ===
const pullbackState = {};

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
        
        // Limpar estado de retração antigo
        Object.keys(pullbackState).forEach(key => {
            if (now - pullbackState[key].timestamp > 60000) { // 1 minuto
                delete pullbackState[key];
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
                
                let score = 50;
                
                if (tickerData && tickerData[symbol]) {
                    score += 25;
                }
                
                if (lsrData && lsrData[symbol]) {
                    const lsr = lsrData[symbol].lsr;
                    if (signalType === 'STOCHASTIC_COMPRA' && lsr < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR) {
                        score += 25;
                    } else if (signalType === 'STOCHASTIC_VENDA' && lsr > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR) {
                        score += 25;
                    }
                }
                
                symbolScores.push({
                    symbol: symbol,
                    score: score,
                    details: { emojiRanking: score > 80 ? '🏆🏆🏆' : score > 60 ? '🏆🏆' : '🏆' }
                });
                
                priorityCache.scores[symbol] = {
                    score: score,
                    timestamp: now,
                    emojiRanking: score > 80 ? '🏆🏆🏆' : score > 60 ? '🏆🏆' : '🏆'
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
📅 ${now.full}

<i>✅ Sistema otimizado com análise de TENDÊNCIA do RSI</i>
<i>✅ RSI 40-50 subindo = CONSOLIDAÇÃO DE ALTA (POSITIVO)</i>
<i>✅ Alertas somente no MOMENTO EXATO do cruzamento</i>
<i>✅ Fibonacci 4h com alvos estendidos 161.8%</i>
<i>✅ STOP por volatilidade adaptativa e estrutura 15m</i>
<i>✅ RETRAÇÃO CONTROLADA POR ATR ATIVADA</i>
<i>   • COMPRA: Aguarda retração de ${(RETRACTION_CONFIG.COMPRA.USE_ATR_MULTIPLIER * 100)}% do ATR</i>
<i>   • VENDA: Aguarda retração de ${(RETRACTION_CONFIG.VENDA.USE_ATR_MULTIPLIER * 100)}% do ATR</i>
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
        const rs = avgGain / (avgLoss || 0.001);
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
// === NOVAS FUNÇÕES: FIBONACCI 4H E STOP POR VOLATILIDADE ADAPTATIVA 15M ===
// =====================================================================

async function calculateFibonacciLevels4h(symbol, isBullish) {
    try {
        const candles = await getCandles(symbol, '4h', 100);
        if (candles.length < 50) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        let swingHigh, swingLow;
        
        if (isBullish) {
            swingLow = Math.min(...lows.slice(-48));
            swingHigh = Math.max(...highs.slice(-48));
        } else {
            swingHigh = Math.max(...highs.slice(-48));
            swingLow = Math.min(...lows.slice(-48));
        }
        
        const diff = swingHigh - swingLow;
        
        return {
            swingHigh,
            swingLow,
            diff,
            levels: {
                fib0: swingLow,
                fib0236: swingLow + diff * 0.236,
                fib0382: swingLow + diff * 0.382,
                fib05: swingLow + diff * 0.5,
                fib0618: swingLow + diff * 0.618,
                fib0786: swingLow + diff * 0.786,
                fib1: swingHigh
            },
            targets: isBullish ? {
                t1: swingLow + diff * 0.382,     // 8-12% (1-2 dias)
                t2: swingLow + diff * 0.618,     // 15-20% (2-3 dias)
                t3: swingLow + diff * 0.786,     // 25-30% (3-4 dias)
                t4: swingLow + diff * 1.000,     // 35-45% (4-6 dias)
                t5: swingLow + diff * 1.272,     // 50-70% (6-8 dias)
                t6: swingLow + diff * 1.618,     // 80-100% (8-12 dias)
                t7: swingLow + diff * 2.000,     // 100-150% (2-3 semanas)
                t8: swingLow + diff * 2.618,     // 150-200% (3-4 semanas)
                t9: swingLow + diff * 3.618,     // 200-300% (1-2 meses)
                t10: swingLow + diff * 4.236     // 300-400% (2-3 meses)
            } : {
                t1: swingHigh - diff * 0.382,
                t2: swingHigh - diff * 0.618,
                t3: swingHigh - diff * 0.786,
                t4: swingHigh - diff * 1.000,
                t5: swingHigh - diff * 1.272,
                t6: swingHigh - diff * 1.618,
                t7: swingHigh - diff * 2.000,
                t8: swingHigh - diff * 2.618,
                t9: swingHigh - diff * 3.618,
                t10: swingHigh - diff * 4.236
            }
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular Fibonacci 4h para ${symbol}: ${error.message}`);
        return null;
    }
}

async function calculateATR(symbol, timeframe = '15m', period = 14) {
    try {
        const candles = await getCandles(symbol, timeframe, period + 1);
        if (candles.length < period + 1) {
            return null;
        }

        let trSum = 0;
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trSum += tr;
        }

        const atr = trSum / period;
        const atrPercent = (atr / candles[candles.length - 1].close) * 100;

        return {
            atr,
            atrPercent,
            period,
            currentPrice: candles[candles.length - 1].close
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR para ${symbol}: ${error.message}`);
        return null;
    }
}

async function calculateSupportResistance15m(symbol, currentPrice) {
    try {
        const candles = await getCandles(symbol, '15m', 100);
        if (candles.length < 50) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        const recentHighs = highs.slice(-48).sort((a, b) => b - a);
        const recentLows = lows.slice(-48).sort((a, b) => a - b);
        
        const resistance1 = recentHighs[0];
        const resistance2 = recentHighs[1] || resistance1 * 0.99;
        
        const support1 = recentLows[0];
        const support2 = recentLows[1] || support1 * 0.99;
        
        return {
            resistances: {
                r1: { price: resistance1, distance: ((resistance1 - currentPrice) / currentPrice) * 100 },
                r2: { price: resistance2, distance: ((resistance2 - currentPrice) / currentPrice) * 100 }
            },
            supports: {
                s1: { price: support1, distance: ((currentPrice - support1) / currentPrice) * 100 },
                s2: { price: support2, distance: ((currentPrice - support2) / currentPrice) * 100 }
            },
            nearestResistance: resistance1 > currentPrice ? resistance1 : resistance2,
            nearestSupport: support1 < currentPrice ? support1 : support2
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular suportes/resistências 15m para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === SISTEMA DE RETRAÇÃO CONTROLADA POR ATR ===
// =====================================================================
async function waitForPullback(symbol, signalType, initialPrice, atrValue) {
    if (!RETRACTION_CONFIG.ENABLED) {
        return { confirmed: true, price: initialPrice, message: 'Retração desativada' };
    }

    const config = signalType === 'STOCHASTIC_COMPRA' 
        ? RETRACTION_CONFIG.COMPRA 
        : RETRACTION_CONFIG.VENDA;

    if (!config.ENABLED) {
        return { confirmed: true, price: initialPrice, message: 'Retração desativada' };
    }

    const cacheKey = `${symbol}_${signalType}_${Date.now()}`;
    const pullbackTarget = signalType === 'STOCHASTIC_COMPRA'
        ? initialPrice * (1 - (atrValue * config.USE_ATR_MULTIPLIER / 100))
        : initialPrice * (1 + (atrValue * config.USE_ATR_MULTIPLIER / 100));

    const minPullback = signalType === 'STOCHASTIC_COMPRA'
        ? initialPrice * (1 - config.MAX_PULLBACK_PERCENT / 100)
        : initialPrice * (1 + config.MAX_PULLBACK_PERCENT / 100);

    pullbackState[cacheKey] = {
        symbol,
        signalType,
        initialPrice,
        pullbackTarget,
        minPullback,
        timestamp: Date.now(),
        status: 'waiting'
    };

    console.log(`⏳ Aguardando retração para ${symbol}:`);
    console.log(`   • Preço inicial: $${initialPrice.toFixed(6)}`);
    console.log(`   • ATR ${config.USE_ATR_MULTIPLIER * 100}%: $${(atrValue * config.USE_ATR_MULTIPLIER).toFixed(6)}`);
    console.log(`   • Alvo retração: $${pullbackTarget.toFixed(6)}`);
    console.log(`   • Aguardando ${config.WAIT_TIME_MS / 1000}s...`);

    // Enviar alerta de possível retração
    const alertMessage = `
<b><i>${config.ALERT_MESSAGE}</i></b>
━━━━━━━━━━━━━━━━━
<b>${symbol}</b> • <b>$${initialPrice.toFixed(6)}</b>
⏱️ ${getBrazilianDateTime().full}

<i>📊 DETALHES DA RETRAÇÃO:</i>
• Tipo: ${signalType === 'STOCHASTIC_COMPRA' ? 'COMPRA (pullback)' : 'VENDA (pullback)'}
• Preço alerta: $${initialPrice.toFixed(6)}
• ATR 15m: ${atrValue.toFixed(3)}% 
• Alvo retração: $${pullbackTarget.toFixed(6)} (${(Math.abs((pullbackTarget - initialPrice) / initialPrice * 100)).toFixed(2)}%)
• Tempo máx: ${config.WAIT_TIME_MS / 1000}s

<i>⏳ AGUARDANDO CONFIRMAÇÃO...</i>
`;
    await sendTelegramAlert(alertMessage);

    // Aguardar o tempo configurado
    await new Promise(resolve => setTimeout(resolve, config.WAIT_TIME_MS));

    // Verificar preço atual após aguardar
    try {
        const currentPrice = await getCurrentPrice(symbol);
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (currentPrice <= pullbackTarget && currentPrice >= minPullback) {
                // Retração confirmada - preço caiu para o alvo
                pullbackState[cacheKey].status = 'confirmed';
                pullbackState[cacheKey].finalPrice = currentPrice;
                
                console.log(`✅ Retração confirmada para ${symbol}: $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: true, 
                    price: currentPrice, 
                    message: config.ENTRY_MESSAGE,
                    pullbackPercent: ((currentPrice - initialPrice) / initialPrice * 100).toFixed(2)
                };
            } else if (currentPrice > initialPrice) {
                // Preço subiu em vez de cair
                pullbackState[cacheKey].status = 'cancelled_up';
                console.log(`❌ Retração cancelada - preço subiu para $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: false, 
                    price: currentPrice, 
                    message: '❌ PREÇO SUBIU - RETRAÇÃO NÃO OCORREU',
                    reason: 'price_increased'
                };
            } else {
                // Não atingiu o alvo ou caiu demais
                pullbackState[cacheKey].status = 'cancelled';
                console.log(`❌ Retração não confirmada - preço atual: $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: false, 
                    price: currentPrice, 
                    message: config.CANCEL_MESSAGE,
                    reason: 'target_not_reached'
                };
            }
        } else {
            if (currentPrice >= pullbackTarget && currentPrice <= minPullback) {
                // Retração confirmada - preço subiu para o alvo
                pullbackState[cacheKey].status = 'confirmed';
                pullbackState[cacheKey].finalPrice = currentPrice;
                
                console.log(`✅ Retração confirmada para ${symbol}: $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: true, 
                    price: currentPrice, 
                    message: config.ENTRY_MESSAGE,
                    pullbackPercent: ((currentPrice - initialPrice) / initialPrice * 100).toFixed(2)
                };
            } else if (currentPrice < initialPrice) {
                // Preço caiu em vez de subir
                pullbackState[cacheKey].status = 'cancelled_down';
                console.log(`❌ Retração cancelada - preço caiu para $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: false, 
                    price: currentPrice, 
                    message: '❌ PREÇO CAIU - RETRAÇÃO NÃO OCORREU',
                    reason: 'price_decreased'
                };
            } else {
                // Não atingiu o alvo ou subiu demais
                pullbackState[cacheKey].status = 'cancelled';
                console.log(`❌ Retração não confirmada - preço atual: $${currentPrice.toFixed(6)}`);
                return { 
                    confirmed: false, 
                    price: currentPrice, 
                    message: config.CANCEL_MESSAGE,
                    reason: 'target_not_reached'
                };
            }
        }
    } catch (error) {
        console.log(`⚠️ Erro ao verificar retração para ${symbol}: ${error.message}`);
        return { confirmed: false, price: initialPrice, message: 'Erro na verificação', error: error.message };
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

        const [rsiData, lsrData, fundingData, pivotData, currentPrice, atrData] = await Promise.all([
            getRSI1h(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzePivotPoints(symbol, await getCurrentPrice(symbol), signalType === 'STOCHASTIC_COMPRA'),
            getCurrentPrice(symbol),
            calculateATR(symbol, RETRACTION_CONFIG.ATR_TIMEFRAME, RETRACTION_CONFIG.ATR_PERIOD)
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
        
        const fibonacciLevels = await calculateFibonacciLevels4h(symbol, signalType === 'STOCHASTIC_COMPRA');
        const srLevels = await calculateSupportResistance15m(symbol, currentPrice);

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
            isFreshCross: isFreshCross,
            fibonacci: fibonacciLevels,
            atr: atrData,
            srLevels: srLevels
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
    
    if (indicators.funding) {
        const fundingValue = parseFloat(indicators.funding) / 100;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (fundingValue <= -0.001) {
                factors.positive.push(`🟢🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue <= -0.0003) {
                factors.positive.push(`🟢 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue <= 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (levemente negativo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue <= 0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue <= 0.001) {
                factors.negative.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
            } else {
                factors.negative.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
            }
        } else {
            if (fundingValue >= 0.001) {
                factors.positive.push(`🔴🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo forte)`);
                totalScore += weights.FUNDING;
            } else if (fundingValue >= 0.0003) {
                factors.positive.push(`🔴 FUNDING: ${(fundingValue * 100).toFixed(4)}% (positivo moderado)`);
                totalScore += weights.FUNDING * 0.7;
            } else if (fundingValue > 0) {
                factors.positive.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (levemente positivo)`);
                totalScore += weights.FUNDING * 0.4;
            } else if (fundingValue >= -0.0003) {
                factors.negative.push(`🟡 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo baixo)`);
                totalScore += weights.FUNDING * 0.2;
            } else if (fundingValue >= -0.001) {
                factors.negative.push(`🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo moderado)`);
            } else {
                factors.negative.push(`🔵🔵 FUNDING: ${(fundingValue * 100).toFixed(4)}% (negativo forte)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ FUNDING: Indisponível`);
    }
    
    if (indicators.lsr) {
        const lsrValue = indicators.lsr;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (lsrValue < 1.5) {
                factors.positive.push(`🟢🟢 LSR: ${lsrValue.toFixed(3)} (shorts dominam)`);
                totalScore += weights.LSR;
            } else if (lsrValue < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR) {
                factors.positive.push(`🟢 LSR: ${lsrValue.toFixed(3)} (shorts em vantagem)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue < 3.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)} (equilíbrio)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue < 4.0) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)} (longs em vantagem)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔴 LSR: ${lsrValue.toFixed(3)} (longs dominam)`);
            }
        } else {
            if (lsrValue > 4.0) {
                factors.positive.push(`🔴🔴 LSR: ${lsrValue.toFixed(3)} (longs dominam)`);
                totalScore += weights.LSR;
            } else if (lsrValue > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR) {
                factors.positive.push(`🔴 LSR: ${lsrValue.toFixed(3)} (longs em vantagem)`);
                totalScore += weights.LSR * 0.8;
            } else if (lsrValue > 2.0) {
                factors.positive.push(`🟡 LSR: ${lsrValue.toFixed(3)} (equilíbrio)`);
                totalScore += weights.LSR * 0.5;
            } else if (lsrValue > 1.5) {
                factors.negative.push(`🟡 LSR: ${lsrValue.toFixed(3)} (shorts em vantagem)`);
                totalScore += weights.LSR * 0.2;
            } else {
                factors.negative.push(`🔵 LSR: ${lsrValue.toFixed(3)} (shorts dominam)`);
            }
        }
    } else {
        factors.neutral.push(`⚪ LSR: Indisponível`);
    }
    
    if (indicators.rsi) {
        const rsiValue = indicators.rsi;
        const rsiDetailed = indicators.rsiDetailed;
        
        let rsiTrend = 'NEUTRO';
        let rsiTrendEmoji = '➡️';
        let rsiDirection = 0;
        
        if (rsiDetailed) {
            const rsi7 = parseFloat(rsiDetailed.rsi7);
            const rsi14 = parseFloat(rsiDetailed.rsi14);
            const rsi21 = parseFloat(rsiDetailed.rsi21);
            const rsiMA5 = parseFloat(rsiDetailed.rsiMA5);
            
            if (rsi7 > rsi14 && rsi14 > rsi21) {
                rsiTrend = 'ALTA FORTE';
                rsiTrendEmoji = '📈📈';
                rsiDirection = 2;
            } 
            else if (rsi7 > rsi14 || rsi14 > rsi21) {
                rsiTrend = 'ALTA';
                rsiTrendEmoji = '📈';
                rsiDirection = 1;
            }
            else if (rsi7 < rsi14 && rsi14 < rsi21) {
                rsiTrend = 'BAIXA FORTE';
                rsiTrendEmoji = '📉📉';
                rsiDirection = -2;
            }
            else if (rsi7 < rsi14 || rsi14 < rsi21) {
                rsiTrend = 'BAIXA';
                rsiTrendEmoji = '📉';
                rsiDirection = -1;
            }
            
            if (rsiValue > rsiMA5) {
                rsiTrend += ' +MOM';
                rsiTrendEmoji = rsiTrendEmoji + '⚡';
                rsiDirection += 0.5;
            }
        }
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (rsiValue < 25) {
                factors.positive.push(`🟢🟢 RSI: ${rsiValue.toFixed(1)} (sobrevendido forte) ${rsiTrendEmoji}`);
                totalScore += weights.RSI;
            }
            else if (rsiValue < 30) {
                factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)} (sobrevendido) ${rsiTrendEmoji}`);
                totalScore += weights.RSI * 0.9;
            }
            else if (rsiValue < 40) {
                if (rsiDirection > 0) {
                    factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)} (recuperação) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.8;
                } else {
                    factors.neutral.push(`🟡 RSI: ${rsiValue.toFixed(1)} (próx sobrevenda) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.5;
                }
            }
            else if (rsiValue < 50) {
                if (rsiDirection > 0) {
                    factors.positive.push(`🟢 RSI: ${rsiValue.toFixed(1)} (consolidação de ALTA) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.7;
                } else {
                    factors.neutral.push(`⚪ RSI: ${rsiValue.toFixed(1)} (neutro) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.3;
                }
            }
            else if (rsiValue < 60) {
                if (rsiDirection > 0) {
                    factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)} (viés positivo) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.5;
                } else {
                    factors.neutral.push(`⚪ RSI: ${rsiValue.toFixed(1)} (neutro) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.2;
                }
            }
            else if (rsiValue < 70) {
                if (rsiDirection < 0 || rsiDetailed?.divergence === 'POSSÍVEL DIVERGÊNCIA DE BAIXA') {
                    factors.negative.push(`🔴 RSI: ${rsiValue.toFixed(1)} (perdendo força) ${rsiTrendEmoji}`);
                } else {
                    factors.neutral.push(`🟡 RSI: ${rsiValue.toFixed(1)} (elevado) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.2;
                }
            }
            else {
                if (rsiDetailed?.divergence === 'POSSÍVEL DIVERGÊNCIA DE BAIXA') {
                    factors.negative.push(`🔴🔴 RSI: ${rsiValue.toFixed(1)} (divergência baixa) ${rsiTrendEmoji}`);
                } else {
                    factors.negative.push(`🔴🔴 RSI: ${rsiValue.toFixed(1)} (sobrecomprado) ${rsiTrendEmoji}`);
                }
            }
        } else {
            if (rsiValue > 75) {
                factors.positive.push(`🔴🔴 RSI: ${rsiValue.toFixed(1)} (sobrecomprado forte) ${rsiTrendEmoji}`);
                totalScore += weights.RSI;
            }
            else if (rsiValue > 70) {
                factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)} (sobrecomprado) ${rsiTrendEmoji}`);
                totalScore += weights.RSI * 0.9;
            }
            else if (rsiValue > 60) {
                if (rsiDirection < 0) {
                    factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)} (queda) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.8;
                } else {
                    factors.neutral.push(`🟡 RSI: ${rsiValue.toFixed(1)} (próx sobrecompra) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.5;
                }
            }
            else if (rsiValue > 50) {
                if (rsiDirection < 0) {
                    factors.positive.push(`🔴 RSI: ${rsiValue.toFixed(1)} (consolidação de BAIXA) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.7;
                } else {
                    factors.neutral.push(`⚪ RSI: ${rsiValue.toFixed(1)} (neutro) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.3;
                }
            }
            else if (rsiValue > 40) {
                if (rsiDirection < 0) {
                    factors.positive.push(`🟡 RSI: ${rsiValue.toFixed(1)} (viés negativo) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.5;
                } else {
                    factors.neutral.push(`⚪ RSI: ${rsiValue.toFixed(1)} (neutro) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.2;
                }
            }
            else if (rsiValue > 30) {
                if (rsiDirection > 0 || rsiDetailed?.divergence === 'POSSÍVEL DIVERGÊNCIA DE ALTA') {
                    factors.negative.push(`🟢 RSI: ${rsiValue.toFixed(1)} (recuperando) ${rsiTrendEmoji}`);
                } else {
                    factors.neutral.push(`🟡 RSI: ${rsiValue.toFixed(1)} (baixo) ${rsiTrendEmoji}`);
                    totalScore += weights.RSI * 0.2;
                }
            }
            else {
                if (rsiDetailed?.divergence === 'POSSÍVEL DIVERGÊNCIA DE ALTA') {
                    factors.negative.push(`🟢🟢 RSI: ${rsiValue.toFixed(1)} (divergência alta) ${rsiTrendEmoji}`);
                } else {
                    factors.negative.push(`🟢🟢 RSI: ${rsiValue.toFixed(1)} (sobrevendido) ${rsiTrendEmoji}`);
                }
            }
        }
        
        if (rsiDetailed?.divergence) {
            if (signalType === 'STOCHASTIC_COMPRA' && rsiDetailed.divergence === 'POSSÍVEL DIVERGÊNCIA DE ALTA') {
                factors.positive.push(`🟢🟢 DIVERGÊNCIA BULLISH DETECTADA`);
                totalScore += 10;
            } else if (signalType === 'STOCHASTIC_VENDA' && rsiDetailed.divergence === 'POSSÍVEL DIVERGÊNCIA DE BAIXA') {
                factors.positive.push(`🔴🔴 DIVERGÊNCIA BEARISH DETECTADA`);
                totalScore += 10;
            }
        }
        
    } else {
        factors.neutral.push(`⚪ RSI: Indisponível`);
    }
    
    if (indicators.pivotData) {
        const pivot = indicators.pivotData;
        const currentPrice = indicators.currentPrice;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (pivot.nearestResistance) {
                const distToResistance = pivot.nearestResistance.distancePercent;
                
                if (distToResistance > 5) {
                    factors.positive.push(`🟢🟢 ESTRUTURA: Resistência distante ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE;
                } else if (distToResistance > 3) {
                    factors.positive.push(`🟢 ESTRUTURA: Resistência moderada ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToResistance > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA: Resistência próxima ${distToResistance.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔴 ESTRUTURA: Resistência muito próxima ${distToResistance.toFixed(2)}%`);
                }
            }
            
            if (currentPrice > pivot.pivot) {
                factors.positive.push(`🟢 PREÇO ACIMA DO PIVÔ: ${((currentPrice - pivot.pivot) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            }
            
        } else {
            if (pivot.nearestSupport) {
                const distToSupport = pivot.nearestSupport.distancePercent;
                
                if (distToSupport > 5) {
                    factors.positive.push(`🔴🔴 ESTRUTURA: Suporte distante ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE;
                } else if (distToSupport > 3) {
                    factors.positive.push(`🔴 ESTRUTURA: Suporte moderado ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.7;
                } else if (distToSupport > 1.5) {
                    factors.positive.push(`🟡 ESTRUTURA: Suporte próximo ${distToSupport.toFixed(2)}%`);
                    totalScore += weights.STRUCTURE * 0.4;
                } else {
                    factors.negative.push(`🔵 ESTRUTURA: Suporte muito próximo ${distToSupport.toFixed(2)}%`);
                }
            }
            
            if (currentPrice < pivot.pivot) {
                factors.positive.push(`🔵 PREÇO ABAIXO DO PIVÔ: ${((pivot.pivot - currentPrice) / pivot.pivot * 100).toFixed(2)}%`);
                totalScore += weights.STRUCTURE * 0.3;
            }
        }
    }
    
    if (indicators.volumeAnalysis && indicators.volumeAnalysis.analysis) {
        const vol = indicators.volumeAnalysis.analysis;
        
        if (signalType === 'STOCHASTIC_COMPRA') {
            if (vol.buyerPercentage >= 60) {
                factors.positive.push(`🟢🟢 VOLUME: ${vol.buyerPercentage}% comprador`);
                totalScore += 15;
            } else if (vol.buyerPercentage >= 55) {
                factors.positive.push(`🟢 VOLUME: ${vol.buyerPercentage}% comprador`);
                totalScore += 10;
            } else if (vol.buyerPercentage >= 50) {
                factors.positive.push(`🟡 VOLUME: ${vol.buyerPercentage}% comprador`);
                totalScore += 5;
            } else {
                factors.negative.push(`🔵 VOLUME: ${vol.sellerPercentage}% vendedor`);
            }
        } else {
            if (vol.sellerPercentage >= 60) {
                factors.positive.push(`🔴🔴 VOLUME: ${vol.sellerPercentage}% vendedor`);
                totalScore += 15;
            } else if (vol.sellerPercentage >= 55) {
                factors.positive.push(`🔴 VOLUME: ${vol.sellerPercentage}% vendedor`);
                totalScore += 10;
            } else if (vol.sellerPercentage >= 50) {
                factors.positive.push(`🟡 VOLUME: ${vol.buyerPercentage}% comp / ${vol.sellerPercentage}% vend`);
                totalScore += 5;
            } else {
                factors.negative.push(`🟢 VOLUME: ${vol.buyerPercentage}% comprador`);
            }
        }
    }
    
    factors.score = Math.min(100, Math.round((totalScore / factors.maxScore) * 100));
    
    if (signalType === 'STOCHASTIC_COMPRA') {
        if (factors.score >= 80) {
            factors.summary = '🏆 OPORTUNIDADE EXCELENTE PARA COMPRA';
            factors.recommendation = '✅ Entrada agressiva. Todos fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 OPORTUNIDADE FAVORÁVEL PARA COMPRA';
            factors.recommendation = '📊 Entrada moderada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ OPORTUNIDADE NEUTRA PARA COMPRA';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ OPORTUNIDADE DESFAVORÁVEL PARA COMPRA';
            factors.recommendation = '❌ Evitar entrada. Aguardar.';
        } else {
            factors.summary = '🚫 OPORTUNIDADE RUIM PARA COMPRA';
            factors.recommendation = '❌❌ Não entrar. Fatores negativos.';
        }
    } else {
        if (factors.score >= 80) {
            factors.summary = '🏆 OPORTUNIDADE EXCELENTE PARA CORREÇÃO';
            factors.recommendation = '✅ Entrada agressiva. Todos fatores alinhados.';
        } else if (factors.score >= 65) {
            factors.summary = '👍 OPORTUNIDADE FAVORÁVEL PARA CORREÇÃO';
            factors.recommendation = '📊 Entrada moderada. Aguardar confirmação.';
        } else if (factors.score >= 50) {
            factors.summary = '⚖️ OPORTUNIDADE NEUTRA PARA CORREÇÃO';
            factors.recommendation = '⚠️ Entrada cautelosa. Pesar riscos.';
        } else if (factors.score >= 35) {
            factors.summary = '⚠️ OPORTUNIDADE DESFAVORÁVEL PARA CORREÇÃO';
            factors.recommendation = '❌ Evitar entrada. Aguardar.';
        } else {
            factors.summary = '🚫 OPORTUNIDADE RUIM PARA CORREÇÃO';
            factors.recommendation = '❌❌ Não entrar. Fatores negativos.';
        }
    }
    
    return factors;
}

function formatFactorsAnalysis(factors) {
    let analysisText = '\n<b><i> ANÁLISE DE FATORES:</i></b>\n';
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
            sentiment = 'MUITO ALTO (Longs dominam)';
            sentimentEmoji = '🔴🔴';
        } else if (currentLSR > 2) {
            sentiment = 'ALTO (Longs vantagem)';
            sentimentEmoji = '🔴';
        } else if (currentLSR < 0.8) {
            sentiment = 'MUITO BAIXO (Shorts dominam)';
            sentimentEmoji = '🟢🟢';
        } else if (currentLSR < 1) {
            sentiment = 'BAIXO (Shorts vantagem)';
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
        
        if (rsi14 > 70 && closes[closes.length - 1] > closes[closes.length - 5] && 
            rsiValues[rsiValues.length - 1] < rsiValues[rsiValues.length - 5]) {
            divergence = 'DIVERGÊNCIA DE BAIXA';
            divergenceEmoji = '🔴';
        }
        else if (rsi14 < 30 && closes[closes.length - 1] < closes[closes.length - 5] && 
                 rsiValues[rsiValues.length - 1] > rsiValues[rsiValues.length - 5]) {
            divergence = 'DIVERGÊNCIA DE ALTA';
            divergenceEmoji = '🟢';
        }
        
        let trend = 'NEUTRO';
        let trendEmoji = '➡️';
        
        const last5RSI = rsiValues.slice(-5);
        const avgLast5 = last5RSI.reduce((a, b) => a + b, 0) / 5;
        const prev5RSI = rsiValues.slice(-10, -5);
        const avgPrev5 = prev5RSI.length > 0 ? prev5RSI.reduce((a, b) => a + b, 0) / prev5RSI.length : avgLast5;
        
        if (avgLast5 > avgPrev5 * 1.02) {
            trend = 'ALTA';
            trendEmoji = '📈';
        } else if (avgLast5 < avgPrev5 * 0.98) {
            trend = 'BAIXA';
            trendEmoji = '📉';
        }
        
        return {
            rsi14: rsi14.toFixed(1),
            rsi7: rsi7.toFixed(1),
            rsi21: rsi21.toFixed(1),
            rsiMA5: rsiMA5.toFixed(1),
            divergence,
            divergenceEmoji,
            trend,
            trendEmoji,
            rsiDirection: avgLast5 > avgPrev5 ? 1 : -1
        };
    } catch (error) {
        console.log(`⚠️ Erro ao analisar RSI detalhado para ${symbol}: ${error.message}`);
        return null;
    }
}

async function analyzeStructureDetailed4h(symbol, currentPrice, isBullish) {
    try {
        const [candles1h, candles4h, candles1d] = await Promise.all([
            getCandles(symbol, '1h', 100),
            getCandles(symbol, '4h', 50),
            getCandles(symbol, '1d', 30)
        ]);
        
        const highs4h = candles4h.map(c => c.high);
        const lows4h = candles4h.map(c => c.low);
        const highs1d = candles1d.map(c => c.high);
        const lows1d = candles1d.map(c => c.low);
        
        const recentHigh4h = Math.max(...highs4h.slice(-20));
        const recentLow4h = Math.min(...lows4h.slice(-20));
        const recentHigh1d = Math.max(...highs1d.slice(-20));
        const recentLow1d = Math.min(...lows1d.slice(-20));
        
        let trend = 'NEUTRO';
        let trendEmoji = '⚪';
        
        const ema9_4h = calculateEMA(candles4h.map(c => c.close), 9);
        const ema21_4h = calculateEMA(candles4h.map(c => c.close), 21);
        
        if (ema9_4h > ema21_4h && candles4h[candles4h.length - 1].close > ema9_4h) {
            trend = 'ALTA';
            trendEmoji = '🟢';
        } else if (ema9_4h < ema21_4h && candles4h[candles4h.length - 1].close < ema9_4h) {
            trend = 'BAIXA';
            trendEmoji = '🔴';
        }
        
        return {
            levels: {
                resistance4h: recentHigh4h,
                support4h: recentLow4h,
                resistance1d: recentHigh1d,
                support1d: recentLow1d
            },
            trend,
            trendEmoji,
            currentPrice
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao analisar estrutura detalhada 4h para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === ALERTA MELHORADO COM ALVOS LONGOS DE 4H E STOP 15M E RETRAÇÃO POR ATR ===
// =====================================================================
async function sendStochasticAlertEnhanced(signal, prioritySystem) {
    if (!signal.volumeAnalysis.isValid) {
        console.log(`⚠️  ${signal.symbol}: Volume 3m não atende aos critérios para alerta ${signal.type}`);
        return;
    }
    
    // Verificar e aguardar retração por ATR
    let entryPrice = signal.currentPrice;
    let pullbackResult = null;
    
    if (RETRACTION_CONFIG.ENABLED && signal.atr) {
        const config = signal.type === 'STOCHASTIC_COMPRA' 
            ? RETRACTION_CONFIG.COMPRA 
            : RETRACTION_CONFIG.VENDA;
        
        if (config.ENABLED) {
            pullbackResult = await waitForPullback(
                signal.symbol, 
                signal.type, 
                signal.currentPrice, 
                signal.atr.atrPercent
            );
            
            if (!pullbackResult.confirmed) {
                console.log(`❌ ${signal.symbol}: ${pullbackResult.message}`);
                
                // Enviar alerta de cancelamento
                const cancelMessage = `
<b><i>${pullbackResult.message}</i></b>
━━━━━━━━━━━━━━━━━
<b>${signal.symbol}</b> • <b>$${pullbackResult.price.toFixed(6)}</b>
⏱️ ${getBrazilianDateTime().full}

<i>📊 MOTIVO DO CANCELAMENTO:</i>
• Sinal: ${signal.type === 'STOCHASTIC_COMPRA' ? 'COMPRA' : 'VENDA'}
• Preço alerta: $${signal.currentPrice.toFixed(6)}
• Preço atual: $${pullbackResult.price.toFixed(6)}
• ATR 15m: ${signal.atr.atrPercent.toFixed(2)}%
• Retração necessária: ${(signal.atr.atrPercent * config.USE_ATR_MULTIPLIER).toFixed(2)}%

<i>⚠️ OPORTUNIDADE CANCELADA - AGUARDAR PRÓXIMO SINAL</i>
`;
                await sendTelegramAlert(cancelMessage);
                return;
            } else {
                console.log(`✅ ${signal.symbol}: ${pullbackResult.message}`);
                entryPrice = pullbackResult.price;
            }
        }
    }
    
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    prioritySystem.registerStochasticAlert(signal.symbol);
    
    const [fundingDetailed, lsrDetailed, rsiDetailed, structureDetailed] = await Promise.all([
        analyzeFundingRateDetailed(signal.symbol),
        analyzeLSRDetailed(signal.symbol),
        analyzeRSIDetailed(signal.symbol),
        analyzeStructureDetailed4h(signal.symbol, entryPrice, signal.type === 'STOCHASTIC_COMPRA')
    ]);
    
    signal.fundingDetailed = fundingDetailed;
    signal.lsrDetailed = lsrDetailed;
    signal.rsiDetailed = rsiDetailed;
    signal.structureDetailed = structureDetailed;
    
    const factors = await analyzeTradeFactors(signal.symbol, signal.type, {
        funding: signal.funding,
        lsr: signal.lsr,
        rsi: signal.rsi,
        rsiDetailed: signal.rsiDetailed,
        pivotData: signal.pivotData,
        currentPrice: entryPrice,
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
    const actionEmoji = signal.type === 'STOCHASTIC_COMPRA' ? '💚' : '🔻';
    const actionWord = signal.type === 'STOCHASTIC_COMPRA' ? 'compra' : 'correção';
    
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 R: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 S: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
    }
    
    let trendInfo = '';
    if (signal.structureDetailed) {
        trendInfo = `\n Tendência 4h: ${signal.structureDetailed.trendEmoji} ${signal.structureDetailed.trend}`;
    }
    
    let lsrDetailedInfo = '';
    if (signal.lsrDetailed) {
        lsrDetailedInfo = `\n LSR: ${signal.lsrDetailed.currentLSR.toFixed(3)} | Média ${signal.lsrDetailed.avgLSR.toFixed(3)}`;
        lsrDetailedInfo += `\n   ${signal.lsrDetailed.sentimentEmoji} ${signal.lsrDetailed.sentiment}`;
    }
    
    let fundingDetailedInfo = '';
    if (signal.fundingDetailed) {
        fundingDetailedInfo = `\n Funding: ${signal.fundingDetailed.currentRatePercent}% | Média ${signal.fundingDetailed.avgRatePercent}%`;
        fundingDetailedInfo += `\n   ${signal.fundingDetailed.trendEmoji} ${signal.fundingDetailed.trend}`;
    }
    
    let rsiDetailedInfo = '';
    if (signal.rsiDetailed) {
        rsiDetailedInfo = `\n RSI: 14:${signal.rsiDetailed.rsi14} | 7:${signal.rsiDetailed.rsi7} | 21:${signal.rsiDetailed.rsi21}`;
        rsiDetailedInfo += `\n   MA5:${signal.rsiDetailed.rsiMA5} ${signal.rsiDetailed.trendEmoji} ${signal.rsiDetailed.divergenceEmoji}`;
    }
    
    const rsiEmoji = signal.rsi < 30 ? '🔵' : signal.rsi > 70 ? '🔴' : '⚪';
    
    let volumeInfo = '';
    if (signal.volumeAnalysis && signal.volumeAnalysis.analysis) {
        const vol = signal.volumeAnalysis.analysis;
        volumeInfo = `\n<b><i>📊 Volume ${vol.timeframe}:</i></b>`;
        volumeInfo += `\n<i>${vol.volumeStatus}</i>`;
        volumeInfo += `\n<i>🟢${vol.buyerPercentage}% | 🔴${vol.sellerPercentage}%</i>`;
    }
    
    let pullbackInfo = '';
    if (pullbackResult && pullbackResult.confirmed) {
        const config = signal.type === 'STOCHASTIC_COMPRA' 
            ? RETRACTION_CONFIG.COMPRA 
            : RETRACTION_CONFIG.VENDA;
        pullbackInfo = `\n<b><i>📉 RETRAÇÃO CONFIRMADA:</i></b>`;
        pullbackInfo += `\n<i>• Preço alerta: $${signal.currentPrice.toFixed(6)}</i>`;
        pullbackInfo += `\n<i>• Preço entrada: $${entryPrice.toFixed(6)}</i>`;
        pullbackInfo += `\n<i>• Retração: ${pullbackResult.pullbackPercent || '0'}%</i>`;
        pullbackInfo += `\n<i>• ATR usado: ${(signal.atr.atrPercent * config.USE_ATR_MULTIPLIER).toFixed(2)}%</i>`;
    }
    
    const factorsAnalysis = formatFactorsAnalysis(factors);
    
    // ===== ALVOS LONGOS DE 4H COM FIBONACCI ESTENDIDO ATÉ 423.6% E STOP POR VOLATILIDADE ADAPTATIVA 15M =====
    let fibonacciInfo = '';
    let stopLossInfo = '';
    let takeProfitInfo = '';
    let riskRewardInfo = '';
    let timeframeInfo = '';
    
    if (signal.fibonacci) {
        const fib = signal.fibonacci;
        const price = entryPrice;
        
        if (signal.type === 'STOCHASTIC_COMPRA') {
            const stop1 = Math.max(fib.targets.t1 * 0.985, fib.swingLow * 0.99);
            
            if (signal.atr) {
                const atrStop = price - (signal.atr.atr * 2.0);
                
                if (signal.srLevels && signal.srLevels.nearestSupport) {
                    const stopCandlestick = Math.min(stop1, atrStop);
                    stopLossInfo = `🛑 <i>STOP:</i> $${(Math.min(stopCandlestick, signal.srLevels.nearestSupport * 0.99)).toFixed(6)}`;
                    stopLossInfo += `\n   ⚖️ ATR: ${signal.atr.atrPercent.toFixed(2)}% | Stop ~${((price - (Math.min(stopCandlestick, signal.srLevels.nearestSupport * 0.99))) / price * 100).toFixed(2)}%`;
                } else {
                    const stopCandlestick = Math.min(stop1, atrStop);
                    stopLossInfo = `🛑 <i>STOP:</i> $${stopCandlestick.toFixed(6)}`;
                    stopLossInfo += `\n   ⚖️ ATR: ${signal.atr.atrPercent.toFixed(2)}% | Stop ~${((price - stopCandlestick) / price * 100).toFixed(2)}%`;
                }
            } else {
                if (signal.srLevels && signal.srLevels.nearestSupport) {
                    stopLossInfo = `🛑 <i>STOP:</i> $${(signal.srLevels.nearestSupport * 0.99).toFixed(6)}`;
                    stopLossInfo += `\n   📉 Stop ~${((price - (signal.srLevels.nearestSupport * 0.99)) / price * 100).toFixed(2)}%`;
                } else {
                    stopLossInfo = `🛑 <i>STOP:</i> $${stop1.toFixed(6)}`;
                    stopLossInfo += `\n   📉 Stop ~${((price - stop1) / price * 100).toFixed(2)}%`;
                }
            }
            
            timeframeInfo = `\n ⏳ <i>HORIZONTE:</i> 4h-1D `;
            
            takeProfitInfo = `  <i>ALVOS:</i>\n`;
            takeProfitInfo += `   T1: $${fib.targets.t1.toFixed(6)} (${((fib.targets.t1 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T2: $${fib.targets.t2.toFixed(6)} (${((fib.targets.t2 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T3: $${fib.targets.t3.toFixed(6)} (${((fib.targets.t3 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T4: $${fib.targets.t4.toFixed(6)} (${((fib.targets.t4 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T5: $${fib.targets.t5.toFixed(6)} (${((fib.targets.t5 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T6: $${fib.targets.t6.toFixed(6)} (${((fib.targets.t6 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T7: $${fib.targets.t7.toFixed(6)} (${((fib.targets.t7 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T8: $${fib.targets.t8.toFixed(6)} (${((fib.targets.t8 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T9: $${fib.targets.t9.toFixed(6)} (${((fib.targets.t9 - price) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T10: $${fib.targets.t10.toFixed(6)} (${((fib.targets.t10 - price) / price * 100).toFixed(2)}%)`;
            
            const stopPrice = parseFloat(stopLossInfo.match(/\$([0-9.]+)/)?.[1] || price * 0.97);
            const riskPercent = ((price - stopPrice) / price) * 100;
            const rewardT10 = ((fib.targets.t10 - price) / price) * 100;
            
            if (riskPercent > 0) {
                const rr = (rewardT10 / riskPercent).toFixed(2);
                riskRewardInfo = `\n <i>RISCO/RETORNO (T10):</i> ${rr}x | Risco: ${riskPercent.toFixed(2)}% | Retorno: ${rewardT10.toFixed(2)}%`;
                
                if (rr >= 10) riskRewardInfo += ` 🚀🚀🚀 EXCELENTE`;
                else if (rr >= 7) riskRewardInfo += ` 🚀🚀 MUITO BOM`;
                else if (rr >= 5) riskRewardInfo += ` 🚀 BOM`;
                else if (rr >= 3) riskRewardInfo += ` ✅ ACEITÁVEL`;
                else riskRewardInfo += ` ⚠️ RUIM`;
            }
            
        } else {
            const stop1 = Math.min(fib.targets.t1 * 1.015, fib.swingHigh * 1.01);
            
            if (signal.atr) {
                const atrStop = price + (signal.atr.atr * 2.0);
                
                if (signal.srLevels && signal.srLevels.nearestResistance) {
                    const stopCandlestick = Math.max(stop1, atrStop);
                    stopLossInfo = `🛑 <i>STOP:</i> $${(Math.max(stopCandlestick, signal.srLevels.nearestResistance * 1.01)).toFixed(6)}`;
                    stopLossInfo += `\n   ⚖️ ATR: ${signal.atr.atrPercent.toFixed(2)}% | Stop ~${((stopCandlestick - price) / price * 100).toFixed(2)}%`;
                } else {
                    const stopCandlestick = Math.max(stop1, atrStop);
                    stopLossInfo = `🛑 <i>STOP:</i> $${stopCandlestick.toFixed(6)}`;
                    stopLossInfo += `\n   ⚖️ ATR: ${signal.atr.atrPercent.toFixed(2)}% | Stop ~${((stopCandlestick - price) / price * 100).toFixed(2)}%`;
                }
            } else {
                if (signal.srLevels && signal.srLevels.nearestResistance) {
                    stopLossInfo = `🛑 <i>STOP:</i> $${(signal.srLevels.nearestResistance * 1.01).toFixed(6)}`;
                    stopLossInfo += `\n   📈 Stop ~${(((signal.srLevels.nearestResistance * 1.01) - price) / price * 100).toFixed(2)}%`;
                } else {
                    stopLossInfo = `🛑 <i>STOP:</i> $${stop1.toFixed(6)}`;
                    stopLossInfo += `\n    Stop ~${((stop1 - price) / price * 100).toFixed(2)}%`;
                }
            }
            
            timeframeInfo = `\n ⏳ <i>HORIZONTE:</i> 4h-1D `;
            
            takeProfitInfo = `  <i>ALVOS:</i>\n`;
            takeProfitInfo += `   T1: $${fib.targets.t1.toFixed(6)} (${((price - fib.targets.t1) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T2: $${fib.targets.t2.toFixed(6)} (${((price - fib.targets.t2) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T3: $${fib.targets.t3.toFixed(6)} (${((price - fib.targets.t3) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T4: $${fib.targets.t4.toFixed(6)} (${((price - fib.targets.t4) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T5: $${fib.targets.t5.toFixed(6)} (${((price - fib.targets.t5) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T6: $${fib.targets.t6.toFixed(6)} (${((price - fib.targets.t6) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T7: $${fib.targets.t7.toFixed(6)} (${((price - fib.targets.t7) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T8: $${fib.targets.t8.toFixed(6)} (${((price - fib.targets.t8) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T9: $${fib.targets.t9.toFixed(6)} (${((price - fib.targets.t9) / price * 100).toFixed(2)}%)\n`;
            takeProfitInfo += `   T10: $${fib.targets.t10.toFixed(6)} (${((price - fib.targets.t10) / price * 100).toFixed(2)}%)`;
            
            const stopPrice = parseFloat(stopLossInfo.match(/\$([0-9.]+)/)?.[1] || price * 1.03);
            const riskPercent = ((stopPrice - price) / price) * 100;
            const rewardT10 = ((price - fib.targets.t10) / price) * 100;
            
            if (riskPercent > 0) {
                const rr = (rewardT10 / riskPercent).toFixed(2);
                riskRewardInfo = `\n <i>RISCO/RETORNO (T10):</i> ${rr}x | Risco: ${riskPercent.toFixed(2)}% | Retorno: ${rewardT10.toFixed(2)}%`;
                
                if (rr >= 10) riskRewardInfo += ` 🚀🚀🚀 EXCELENTE`;
                else if (rr >= 7) riskRewardInfo += ` 🚀🚀 MUITO BOM`;
                else if (rr >= 5) riskRewardInfo += ` 🚀 BOM`;
                else if (rr >= 3) riskRewardInfo += ` ✅ ACEITÁVEL`;
                else riskRewardInfo += ` ⚠️ RUIM`;
            }
        }
        
        fibonacciInfo = `\n <i>FIBONACCI 4h ESTENDIDO:</i>`;
        fibonacciInfo += `\n    Fundo: $${fib.swingLow.toFixed(6)} | Topo: $${fib.swingHigh.toFixed(6)}`;
        fibonacciInfo += `\n    Amplitude: $${fib.diff.toFixed(6)} (${(fib.diff / fib.swingLow * 100).toFixed(2)}%)`;
        fibonacciInfo += timeframeInfo;
    }
    
    let message = '';
    
    if (signal.type === 'STOCHASTIC_COMPRA') {
        message = `
<b><i>💹 COMPRA DETECTADA 💹</i></b>
━━━━━━━━━━━━━━━━━
<b>${signal.symbol}</b> • <b>$${entryPrice.toFixed(6)}</b>
 ${signal.time.full}
 <i>Alerta #${alertCount.symbolStochastic} </i>
<i>🔍 O que aconteceu?</i>
O Estocástico acabou de fazer um <i>cruzamento de alta</i> saindo de região de sobrevenda! 
Isso indica o INÍCIO DE UM NOVO CICLO DE ALTA com alvos de LONGO PRAZO. 🚀
${pullbackInfo}
<i>CONDIÇÕES ATUAIS:</i>
• Stoch %K: ${signal.stochastic.k.toFixed(2)} | %D: ${signal.stochastic.d.toFixed(2)} (${stochStatus})
• RSI 1h: ${rsiEmoji} ${signal.rsi?.toFixed(1) || 'N/A'} - ${signal.rsi < 40 ? 'ainda não está sobrecomprado, bom!' : 'atenção'}
• LSR: ${lsrEmoji} ${signal.lsr?.toFixed(3) || 'N/A'} - ${signal.isIdealLSR ? 'shorts dominando, combustível para alta massiva! 🏆' : 'equilíbrio'}
• Funding: ${fundingRateText} - ${fundingRate < 0 ? 'negativo = shorts pagando para segurar posição ✅' : 'positivo = custo pra manter'}
${takeProfitInfo}
${stopLossInfo}
${riskRewardInfo}
${volumeInfo}
${factorsAnalysis}
🤖 <i>ANÁLISE DO CENÁRIO - LONGO PRAZO:</i>
${factors.score >= 70 ? '🔥 OPORTUNIDADE HISTÓRICA! Todos os fatores estão alinhados para um MOVIMENTO DE LONGO PRAZO com alvos até 400%+. Considere posição com timeframe de semanas a meses.' : 
  factors.score >= 50 ? '⚡ O cenário é favorável para posições de médio prazo. Os fatores indicam potencial para movimentos de 100-200% nas próximas semanas.' : 
  '⚠️ O sinal existe, mas os fatores secundários não estão totalmente alinhados para posições longas. Considere aguardar confirmação.'}

<b><i>✨ Titanium by @J4Rviz ✨</i></b>
`;
    } else {
        message = `
<b><i>🔻 CORREÇÃO DETECTADA 🔻</i></b>
━━━━━━━━━━━━━━━━━
<b>${signal.symbol}</b> • <b>$${entryPrice.toFixed(6)}</b>
 ${signal.time.full}
 <i>Alerta #${alertCount.symbolStochastic} </i>
<i>🔍 O que aconteceu?</i>
O Estocástico acabou de fazer um <i>cruzamento de baixa</i> saindo de região de sobrecompra!
Isso sugere o INÍCIO DE UM NOVO CICLO DE CORREÇÃO com alvos de LONGO PRAZO. 📉
${pullbackInfo}
<i>CONDIÇÕES ATUAIS:</i>
• Estocástico %K: ${signal.stochastic.k.toFixed(2)} | %D: ${signal.stochastic.d.toFixed(2)} (${stochStatus})
• RSI 1h: ${rsiEmoji} ${signal.rsi?.toFixed(1) || 'N/A'} - ${signal.rsi > 60 ? 'saindo de sobrecompra, ideal para correção' : 'neutro'}
• LSR: ${lsrEmoji} ${signal.lsr?.toFixed(3) || 'N/A'} - ${signal.isIdealLSR ? 'longs dominando, muito líquido pra descer! 🏆' : 'equilíbrio'}
• Funding: ${fundingRateText} - ${fundingRate > 0 ? 'positivo = otimismo excessivo, correção iminente' : 'neutro'}
${takeProfitInfo}
${stopLossInfo}
${riskRewardInfo}
${volumeInfo}
${factorsAnalysis}
🤖 <i>ANÁLISE DO CENÁRIO - LONGO PRAZO:</i>
${factors.score >= 70 ? '❄️ OPORTUNIDADE HISTÓRICA DE CORREÇÃO! Todos os fatores apontam para um MOVIMENTO DE QUEDA DE LONGO PRAZO com alvos até 400%+.' : 
  factors.score >= 50 ? '🌪️ Cenário favorável para correção de médio prazo. Os fatores indicam potencial para quedas de 100-200% nas próximas semanas.' : 
  '⚠️ O sinal de correção existe, mas os fatores secundários não confirmam totalmente para posições longas. Melhor aguardar confirmação.'}

<b><i>✨ Titanium by @J4Rviz ✨</i></b>
`;
    }

    await sendTelegramAlert(message);
    console.log(`✅ Alento longo prazo enviado: ${signal.symbol} (${action})`);
    console.log(`   📊 Score: ${factors.score}% | ${factors.summary}`);
    console.log(`   ✅ ${factors.positive?.length || 0} | ❌ ${factors.negative?.length || 0}`);
    console.log(`   📐 Fibonacci 4h estendido ativo | Stop adaptativo 15m | Alvos até 423.6%`);
    if (pullbackResult) {
        console.log(`   📉 Retração: $${signal.currentPrice.toFixed(6)} → $${entryPrice.toFixed(6)} (${pullbackResult.pullbackPercent || '0'}%)`);
    }
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
        console.log(' TITANIUM LONG TERM - FIBONACCI 4h ATIVADO | STOP 15m | RETRAÇÃO ATR ');
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
            
            const now = Date.now();
            Object.keys(stochCrossState).forEach(symbol => {
                if (now - stochCrossState[symbol].lastCheck > 24 * 60 * 60 * 1000) {
                    delete stochCrossState[symbol];
                }
            });
            
            cleanupSystem.cleanupCaches();
            
            console.log(`\n⏳ Próximo ciclo em ${PERFORMANCE_CONFIG.CYCLE_DELAY_MS/1000}s...`);
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
        console.log('🚀 TITANIUM LONG TERM - ESTOCÁSTICO 12h + FIBONACCI 4h v8.1');
        console.log('🎯 Sistema com análise de TENDÊNCIA do RSI');
        console.log('📈 ALVOS LONGOS 4h ATÉ 423.6% FIBONACCI');
        console.log('🛑 STOP POR VOLATILIDADE ADAPTATIVA 15m + ESTRUTURA 15m');
        console.log('📉 RETRAÇÃO CONTROLADA POR ATR 15m ATIVADA');
        console.log('📊 Configurações Ativas:');
        console.log(`   • Estocástico: ${STOCHASTIC_CONFIG.ENABLED ? '✅ ATIVADO' : '❌ DESATIVADO'}`);
        console.log(`   • Config: ${STOCHASTIC_CONFIG.K_PERIOD}.${STOCHASTIC_CONFIG.D_PERIOD}.${STOCHASTIC_CONFIG.SLOWING} ${STOCHASTIC_CONFIG.TIMEFRAME}`);
        console.log(`   • RSI 40-50 SUBINDO = CONSOLIDAÇÃO DE ALTA ✅`);
        console.log(`   • FIBONACCI 4h ESTENDIDO: ✅ ATIVADO (423.6%)`);
        console.log(`   • STOP ATR 15m ADAPTATIVO: ✅ ATIVADO`);
        console.log(`   • ESTRUTURA 15m: ✅ ATIVADA`);
        console.log(`   • RETRAÇÃO COMPRA: ✅ ${RETRACTION_CONFIG.COMPRA.USE_ATR_MULTIPLIER * 100}% ATR`);
        console.log(`   • RETRAÇÃO VENDA: ✅ ${RETRACTION_CONFIG.VENDA.USE_ATR_MULTIPLIER * 100}% ATR`);
        console.log(`   • HORIZONTE: 1-7 DIAS (MÉDIO) | 1-3 MESES (LONGO)`);
        console.log('='.repeat(80) + '\n');
        
        lastResetDate = getBrazilianDateString();
        
        await sendInitializationMessage();
        
        console.log('✅ Tudo pronto! Iniciando monitoramento com ALVOS LONGOS 4h, STOP 15m e RETRAÇÃO ATR...');
        console.log('⚠️  Alertas SOMENTE no momento exato do cruzamento + confirmação de retração');
        console.log('📊  Fibonacci 4h ESTENDIDO (423.6%) integrado - HORIZONTE DE SEMANAS A MESES');
        console.log('🛑  STOP por volatilidade adaptativa (ATR 15m) + estrutura de suporte/resistência 15m');
        console.log('📉  RETRAÇÃO: Aguardando pullback de acordo com ATR antes de confirmar entrada');
        
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
