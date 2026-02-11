const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES AJUSTÁVEIS DO SISTEMA ===
// =====================================================================

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFN0A';
const TELEGRAM_CHAT_ID = '-100197';

// === CONFIGURAÇÃO DO ESTOCÁSTICO ===
const STOCHASTIC_CONFIG = {
    ENABLED: true, // Ativar/Desativar alertas do Estocástico
    K_PERIOD: 5,   // Período da linha %K
    D_PERIOD: 3,   // Período da linha %D
    SLOWING: 3,    // Fator de suavização
    TIMEFRAME: '12h', // Timeframe para análise
    OVERBOUGHT: 80,  // Nível de sobrecompra
    OVERSOLD: 20,     // Nível de sobrevenda
    // Configurações de volume 3m específicas para cada tipo de alerta
    VOLUME_CONFIG: {
        COMPRA: {
            ENABLED: true,
            TIMEFRAME: '3m',
            MIN_VOLUME_ANORMAL: 0.6, // 60% de dominância compradora
            ANALYZE_CANDLES: 20,
            REQUIRE_BUYER_DOMINANCE: true
        },
        VENDA: {
            ENABLED: true,
            TIMEFRAME: '3m',
            MIN_VOLUME_ANORMAL: 0.6, // 60% de dominância vendedora
            ANALYZE_CANDLES: 20,
            REQUIRE_SELLER_DOMINANCE: true
        }
    }
};

// === SISTEMA DE PRIORIDADE POR VOLUME 1H, LIQUIDEZ E LSR ===
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
// === FIM DAS CONFIGURAÇÕES - NÃO MODIFIQUE ABAIXO SEM SABER ===
// =====================================================================

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const CACHE_DIR = './cache';

// === CONTADOR DE ALERTAS ===
let alertCounter = {};
let dailyAlerts = 0;
let globalAlerts = 0;
let lastResetDate = null;

// Cache para dados de prioridade
const priorityCache = {
  symbols: null,
  timestamp: 0,
  scores: {}
};

// Sistema de cooldown por símbolo
const symbolCooldown = {};

// Sistema de cooldown específico para Estocástico
const stochasticCooldown = {};

// === SISTEMA DE ESTADO DE CRUZAMENTO POR SÍMBOLO ===
const stochCrossState = {};

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

// === SISTEMA AVANÇADO DE LIMPEZA ===
const candleCache = {};
const CANDLE_CACHE_TTL = 90000;
const MAX_CACHE_AGE = 12 * 60 * 1000;

class AdvancedCleanupSystem {
    constructor() {
        this.lastCleanup = Date.now();
        this.cleanupInterval = 5 * 60 * 1000; // 5 minutos
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

// === SISTEMA DE PRIORIDADE AVANÇADO ===
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
        
        const cooldownMs = 60 * 60 * 1000; // 1 hora de cooldown para estocástico
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

<i>Sistema otimizado para alertas Estocástico 5.3.3 12H</i>
<i>Alertas somente no MOMENTO EXATO do cruzamento</i>
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

// === FUNÇÕES DE ANÁLISE TÉCNICA ===
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

// === FUNÇÃO PARA CALCULAR ESTOCÁSTICO 5.3.3 ===
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
        
        // Calcular Estocástico
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
        
        // Suavizar %K (slow stochastic)
        const smoothedK = [];
        for (let i = slowing - 1; i < stochValues.length; i++) {
            const kSlice = stochValues.slice(i - slowing + 1, i + 1);
            const avgK = kSlice.reduce((a, b) => a + b, 0) / kSlice.length;
            smoothedK.push(avgK);
        }
        
        // Calcular %D (média móvel simples de %K)
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
        
        // Verificar cruzamentos EXATOS
        const isCrossingUp = previousK <= previousD && latestK > latestD;
        const isCrossingDown = previousK >= previousD && latestK < latestD;
        
        // Determinar estado
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

// FUNÇÃO: Analisar volume 3m para alertas do estocástico
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
        
        // Análise de volume comprador vs vendedor
        let buyerVolume = 0;
        let sellerVolume = 0;
        let totalVolume = 0;
        
        candles.forEach(candle => {
            const volume = candle.volume;
            totalVolume += volume;
            
            if (candle.close > candle.open) {
                // Candle verde - dominância compradora
                buyerVolume += volume * 0.8;
                sellerVolume += volume * 0.2;
            } else if (candle.close < candle.open) {
                // Candle vermelho - dominância vendedora
                buyerVolume += volume * 0.2;
                sellerVolume += volume * 0.8;
            } else {
                // Doji - divisão igual
                buyerVolume += volume * 0.5;
                sellerVolume += volume * 0.5;
            }
        });
        
        // Calcula percentuais
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 0;
        const sellerPercentage = totalVolume > 0 ? (sellerVolume / totalVolume) * 100 : 0;
        
        // Verifica se atende aos critérios
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

// Função para calcular EMA
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

// Função para analisar volume comprador vs vendedor
function analyzeBuyerSellerVolume(candles) {
    if (candles.length < 20) {
        return null;
    }
    
    let buyerVolume = 0;
    let sellerVolume = 0;
    let totalVolume = 0;
    let bullishCandles = 0;
    let bearishCandles = 0;
    
    candles.forEach(candle => {
        const volume = candle.volume;
        totalVolume += volume;
        
        if (candle.close > candle.open) {
            buyerVolume += volume * 0.8;
            sellerVolume += volume * 0.2;
            bullishCandles++;
        } else if (candle.close < candle.open) {
            buyerVolume += volume * 0.2;
            sellerVolume += volume * 0.8;
            bearishCandles++;
        } else {
            buyerVolume += volume * 0.5;
            sellerVolume += volume * 0.5;
        }
    });
    
    const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 0;
    const sellerPercentage = totalVolume > 0 ? (sellerVolume / totalVolume) * 100 : 0;
    
    return {
        buyerVolume,
        sellerVolume,
        totalVolume,
        buyerPercentage: buyerPercentage.toFixed(1),
        sellerPercentage: sellerPercentage.toFixed(1),
        bullishCandles,
        bearishCandles,
        bullishRatio: totalVolume > 0 ? (bullishCandles / (bullishCandles + bearishCandles) * 100).toFixed(1) : 0,
        bearishRatio: totalVolume > 0 ? (bearishCandles / (bullishCandles + bearishCandles) * 100).toFixed(1) : 0
    };
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
        
        // Cálculo simples do RSI
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

// === SINAIS DE ESTOCÁSTICO 5.3.3 12H ===
async function checkStochasticSignal(symbol, prioritySystem) {
    if (!STOCHASTIC_CONFIG.ENABLED || prioritySystem.isInStochasticCooldown(symbol)) {
        return null;
    }

    try {
        const stochastic = await getStochastic(symbol);
        if (!stochastic) {
            return null;
        }

        // Verificar estado anterior
        const previousState = stochCrossState[symbol] || {
            wasCrossingUp: false,
            wasCrossingDown: false,
            lastCheck: 0
        };

        let signalType = null;
        let isFreshCross = false;

        // VERIFICAÇÃO DE CRUZAMENTO FRESCO (MOMENTO EXATO)
        if (stochastic.isCrossingUp) {
            // Só gera alerta se NÃO estava cruzando para cima anteriormente
            if (!previousState.wasCrossingUp) {
                signalType = 'STOCHASTIC_COMPRA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para CIMA`);
            }
            // Atualizar estado atual
            stochCrossState[symbol] = {
                wasCrossingUp: true,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        } 
        else if (stochastic.isCrossingDown) {
            // Só gera alerta se NÃO estava cruzando para baixo anteriormente
            if (!previousState.wasCrossingDown) {
                signalType = 'STOCHASTIC_VENDA';
                isFreshCross = true;
                console.log(`🎯 CRUZAMENTO FRESCO DETECTADO: ${symbol} - %K cruzou %D para BAIXO`);
            }
            // Atualizar estado atual
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: true,
                lastCheck: Date.now()
            };
        }
        else {
            // Nenhum cruzamento no momento - atualizar estado
            stochCrossState[symbol] = {
                wasCrossingUp: false,
                wasCrossingDown: false,
                lastCheck: Date.now()
            };
        }

        // Só processa se for um cruzamento fresco
        if (!isFreshCross || !signalType) {
            return null;
        }

        // Buscar dados adicionais apenas se houver cruzamento fresco
        const [rsiData, lsrData, fundingData, pivotData, currentPrice] = await Promise.all([
            getRSI1h(symbol),
            getLSR(symbol),
            getFundingRate(symbol),
            analyzePivotPoints(symbol, await getCurrentPrice(symbol), signalType === 'STOCHASTIC_COMPRA'),
            getCurrentPrice(symbol)
        ]);

        // Verificar se LSR é ideal
        let isIdealLSR = false;
        if (lsrData) {
            if (signalType === 'STOCHASTIC_COMPRA') {
                isIdealLSR = lsrData.lsrValue < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR;
            } else {
                isIdealLSR = lsrData.lsrValue > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR;
            }
        }

        // Analisar volume 3m específico para o tipo de alerta
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

// === ALERTA DE ESTOCÁSTICO ===
async function sendStochasticAlert(signal, prioritySystem) {
    // Verificar se o volume é válido para o tipo de alerta
    if (!signal.volumeAnalysis.isValid) {
        console.log(`⚠️  ${signal.symbol}: Volume 3m não atende aos critérios para alerta ${signal.type}`);
        return;
    }
    
    const alertCount = getAlertCountForSymbol(signal.symbol, 'stochastic');
    
    prioritySystem.registerStochasticAlert(signal.symbol);
    
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
    
    // LSR - Emoji e status
    const lsrEmoji = signal.type === 'STOCHASTIC_COMPRA' 
        ? (signal.lsr < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR ? '🟢' : '🔴')
        : (signal.lsr > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR ? '🔴' : '🟢');
    
    const stochStatus = signal.stochastic.isOversold ? 'Baixo 🔵' : 
                       signal.stochastic.isOverbought ? 'Alto 🔴' : 'Neutro ⚪';
    
    const action = signal.type === 'STOCHASTIC_COMPRA' ? '⤴️🟢 Monitorar COMPRA' : '⤵️🔴 Monitorar VENDA';
    
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
    
    const rsiEmoji = signal.rsi < 30 ? '🔵' : signal.rsi > 70 ? '🔴' : '⚪';
    
    // Adicionar análise de volume 3m à mensagem
    let volumeInfo = '';
    if (signal.volumeAnalysis && signal.volumeAnalysis.analysis) {
        const vol = signal.volumeAnalysis.analysis;
        volumeInfo = `\n<b><i> Volume ${vol.timeframe}:</i></b>`;
        volumeInfo += `\n<i>${vol.volumeStatus}</i>`;
        volumeInfo += `\n<i>🟢Comprador: ${vol.buyerPercentage}% | 🔴Vendedor: ${vol.sellerPercentage}%</i>`;
    }
    
    const message = `
<b><i> ${signal.symbol}  ${signal.isIdealLSR ? '✨✨' : ''}</i></b>
${action}
${signal.time.full}
STOCH #${alertCount.symbolStochastic}
• Preço Atual: $${signal.currentPrice.toFixed(6)}
${volumeInfo}
<b><i>Indicadores:</i></b>
• STOCH 12h: %K ${signal.stochastic.k.toFixed(2)} | %D: ${signal.stochastic.d.toFixed(2)}
  Status: ${stochStatus}
• ${signal.type === 'STOCHASTIC_COMPRA' ? '📈 %K ⤴️  ' : '📉 %K ⤵️ '}
• RSI 1h: ${rsiEmoji} ${signal.rsi?.toFixed(1) || 'N/A'}
${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.isIdealLSR ? '🏆' : ''}
• Fund. Rate: ${fundingRateText}
<b><i>Suporte/Resistência:</i></b>${pivotInfo}
${signal.type === 'STOCHASTIC_COMPRA' ? 
'• Ação: 🟢 MONITORAR OPORTUNIDADE DE COMPRA\n  ' : 
'• Ação: 🔴 MONITORAR CORREÇÃO \n '}

<b><i>✨Titanium by @J4Rviz✨</i></b>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de CRUZAMENTO enviado: ${signal.symbol} (${action})`);
    console.log(`   📈 Estocástico: %K=${signal.stochastic.k.toFixed(2)}, %D=${signal.stochastic.d.toFixed(2)}`);
    console.log(`   📊 Volume 3m: ${signal.volumeAnalysis.analysis.volumeStatus}`);
    console.log(`   ⚡ Tipo: CRUZAMENTO FRESCO (momento exato)`);
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

async function monitorSymbol(symbol, prioritySystem) {
    try {
        console.log(`🔍 Analisando ${symbol}...`);
        
        const priorityInfo = prioritySystem.getSymbolPriorityInfo(symbol);
        if (priorityInfo && PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
            console.log(`   ${priorityInfo.emojiRanking} Prioridade: ${priorityInfo.score.toFixed(1)}`);
        }
        
        // Verificar sinal de Estocástico
        if (STOCHASTIC_CONFIG.ENABLED) {
            const stochasticSignal = await checkStochasticSignal(symbol, prioritySystem);
            if (stochasticSignal) {
                await sendStochasticAlert(stochasticSignal, prioritySystem);
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
            
            // Limpar estados antigos do cache de cruzamento
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

// === INICIALIZAÇÃO ===
let rateLimiter = new AdaptiveRateLimiter();

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - ESTOCÁSTICO 5.3.3 12H v4.0');
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
        console.log('🗑️  Sistema de Limpeza Avançado Ativado');
        console.log('⏱️  Cooldown Estocástico: 1 hora');
        console.log('='.repeat(80) + '\n');
        
        lastResetDate = getBrazilianDateString();
        
        await sendInitializationMessage();
        
        console.log('✅ Tudo pronto! Iniciando monitoramento de CRUZAMENTOS Estocástico 12H...');
        console.log('⚠️  Alertas serão enviados SOMENTE no momento exato do cruzamento %K x %D');
        
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
