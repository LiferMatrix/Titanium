const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J';
const TELEGRAM_CHAT_ID = '-10025549';

// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// === FILTRO DE VOLUME RELATIVO ===
const VOLUME_RELATIVE_THRESHOLD = 1.5; // 30% acima da média

// === CONFIGURAÇÕES DE VOLATILIDADE ===
const VOLATILITY_PERIOD = 20; // Número de velas para cálculo da volatilidade
const VOLATILITY_TIMEFRAME = '15m'; // Alterado para 15 minutos
const VOLATILITY_THRESHOLD = 0.7; // 0.5% de volatilidade mínima

// === FILTRO DO LSR RATIO ===
const LSR_TIMEFRAME = '15m'; // Timeframe para LSR
const LSR_BUY_THRESHOLD = 2.5; // Para compra LSR menor que 2.5
const LSR_SELL_THRESHOLD = 2.5; // Para sinal de correção LSR maior que 2.5

// 🔵 CONFIGURAÇÃO DINÂMICA - Buscar todos os ativos automaticamente
let SYMBOLS = []; // Será preenchido dinamicamente
let DECIMALS_CONFIG = {}; // Será preenchido dinamicamente

// 🔵 CONFIGURAÇÕES DE RATE LIMIT
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1200, // Limite da Binance Futures API
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 2,
        openInterest: 1,
        fundingRate: 1,
        orderBook: 2,
        lsr: 1
    }
};

// Contador de rate limit
let rateLimitCounter = {
    windowStart: Date.now(),
    usedWeight: 0,
    remainingWeight: 1200
};

// Configurações de Logs
const LOG_DIR = './logs';
const MAX_LOG_FILES = 10;
const MAX_LOG_SIZE = 10 * 1024 * 1024;

// Configurações de Reconexão
const INITIAL_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 60000;
const MAX_RETRY_ATTEMPTS = 10;

// Objeto para armazenar alertas por ativo
const alertsCooldown = {};
const COOLDOWN = 30 * 60 * 1000; // 30 minutos

// Objeto para rastrear sweeps recentes para confirmações
const recentSweeps = {};

// 🔵 Cache para Open Interest com histórico aprimorado
const oiCache = {};
const OI_CACHE_TTL = 1 * 60 * 1000; // 1 minuto de cache para OI
const OI_HISTORY_SIZE = 30; // Manter 30 pontos históricos
const OI_SMA_PERIOD = 10; // Período da SMA para suavização do OI

const DEFAULT_DECIMALS = 4;

// 🔴 CONFIGURAÇÕES AVANÇADAS PARA STOP ATR E ENTRADAS
const TARGET_PERCENTAGES = [2.5, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14; // Período para cálculo do ATR
const ATR_MULTIPLIER = 2.5; // Multiplicador do ATR para stop mais largo
const ATR_TIMEFRAME = '15m'; // Timeframe para cálculo do ATR
const MIN_ATR_PERCENTAGE = 1.5; // Stop mínimo em porcentagem
const MAX_ATR_PERCENTAGE = 6.0; // Stop máximo em porcentagem

// 🔴 CONFIGURAÇÕES PARA ENTRADAS COM RETRAÇÃO ATR
const ENTRY_RETRACTION_MULTIPLIER = 0.5; // Retração de 0.5x ATR
const ENTRY_MAX_DISTANCE_MULTIPLIER = 0.3; // Máximo de 0.3x ATR acima do preço
const ENTRY_MIN_RETRACTION_PERCENT = 0.5; // Retração mínima de 0.5%
const ENTRY_MAX_RETRACTION_PERCENT = 2.0; // Retração máxima de 2.0%

// 🔵 OTIMIZAÇÕES ADICIONADAS
const BATCH_SIZE = 15; 
const candleCache = {}; 
const CANDLE_CACHE_TTL = 50000; // 50 segundos
const SWEEP_CLEANUP_INTERVAL = 10; // Limpar sweeps a cada 10 ciclos
const MAX_SWEEP_AGE = 6 * 60 * 60 * 1000; // 6 horas
const MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutos

// 🔵 CONFIGURAÇÕES PARA COMPRESSÃO DE DADOS
const COMPRESS_CANDLES = true; // Ativar compressão de candles
const COMPRESSED_CANDLE_CACHE = {}; // Cache para candles comprimidos

// 🔵 CONFIGURAÇÕES PARA FILTRO DE QUALIDADE
const QUALITY_THRESHOLD = 70; // Score mínimo para aceitar sinal (0-100)
const QUALITY_WEIGHTS = {
    volume: 25,      // Peso do volume
    oi: 15,          // Peso do Open Interest
    volatility: 10,  // Peso da volatilidade
    lsr: 10,         // Peso do LSR
    rsi: 10,         // Peso do RSI
    emaAlignment: 10, // Peso do alinhamento das EMAs
    marketStructure: 20 // REMOVIDO: Peso da estrutura de mercado
};

// =====================================================================
// 🧠 SISTEMA DE APRENDIZADO
// =====================================================================

class LearningSystem {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.patterns = { winning: {}, losing: {} };
        this.learningEnabled = true;
        this.minTradesForLearning = 5;
        this.learningDir = './learning_smc';
        
        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado SMC inicializado');
    }
    
    loadLearningData() {
        try {
            if (!fs.existsSync(this.learningDir)) {
                fs.mkdirSync(this.learningDir, { recursive: true });
            }
            
            const learningFile = path.join(this.learningDir, 'learning_data.json');
            if (fs.existsSync(learningFile)) {
                const data = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
                
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
                this.patterns = data.patterns || this.patterns;
                
                console.log(`📊 Aprendizado: ${this.tradeHistory.length} trades carregados`);
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados de aprendizado:', error.message);
        }
    }
    
    saveLearningData() {
        try {
            const data = {
                tradeHistory: this.tradeHistory.slice(-1000),
                symbolPerformance: this.symbolPerformance,
                patterns: this.patterns,
                lastUpdated: Date.now()
            };
            
            const learningFile = path.join(this.learningDir, 'learning_data.json');
            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
            
        } catch (error) {
            console.error('Erro ao salvar dados de aprendizado:', error);
        }
    }
    
    async recordTrade(signal, marketData) {
        if (!this.learningEnabled) return;
        
        try {
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
                entryPrice: signal.price,
                qualityScore: signal.qualityScore?.score || 0,
                marketData: {
                    volumeRatio: marketData.volumeCheck?.volumeData?.rawRatio || 0,
                    rsi: marketData.rsi1h?.raw || 0,
                    volatility: marketData.volatilityCheck?.rawVolatility || 0,
                    lsr: marketData.lsrCheck?.raw || 0,
                    emaAlignment: marketData.emas3mData?.isAboveEMA55 || false,
                    oiTrend: marketData.oiCheck?.trend || '➡️',
                    adx15m: marketData.adx15m?.rawADX || 0,
                    adx1h: marketData.adx1h?.rawADX || 0
                },
                status: 'OPEN'
            };
            
            this.tradeHistory.push(tradeRecord);
            
            if (!this.symbolPerformance[signal.symbol]) {
                this.symbolPerformance[signal.symbol] = {
                    totalSignals: 0,
                    successfulSignals: 0,
                    totalProfit: 0,
                    recentScores: []
                };
            }
            
            const symbolStats = this.symbolPerformance[signal.symbol];
            symbolStats.totalSignals++;
            symbolStats.recentScores.push(signal.qualityScore?.score || 0);
            
            if (symbolStats.recentScores.length > 20) {
                symbolStats.recentScores = symbolStats.recentScores.slice(-20);
            }
            
            // Salvar periodicamente
            if (this.tradeHistory.length % 10 === 0) {
                this.saveLearningData();
            }
            
        } catch (error) {
            console.error('Erro ao registrar trade:', error);
        }
    }
    
    getSymbolPerformance(symbol) {
        return this.symbolPerformance[symbol] || {
            totalSignals: 0,
            successfulSignals: 0,
            totalProfit: 0,
            winRate: 0,
            recentScores: []
        };
    }
    
    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
        
        const winRate = closedTrades.length > 0 ? 
            (winners.length / closedTrades.length) * 100 : 0;
        
        const bestSymbols = Object.entries(this.symbolPerformance)
            .filter(([_, stats]) => stats.totalSignals >= 3)
            .sort((a, b) => {
                const winRateA = a[1].successfulSignals / a[1].totalSignals;
                const winRateB = b[1].successfulSignals / b[1].totalSignals;
                return winRateB - winRateA;
            })
            .slice(0, 5);
        
        return {
            totalTrades: this.tradeHistory.length,
            closedTrades: closedTrades.length,
            winningTrades: winners.length,
            winRate: winRate.toFixed(1),
            bestSymbols: bestSymbols.map(([symbol, stats]) => ({
                symbol,
                winRate: ((stats.successfulSignals / stats.totalSignals) * 100).toFixed(1),
                totalSignals: stats.totalSignals
            }))
        };
    }
}

// 🔵 NOVA FUNÇÃO: Calcular ADX (Average Directional Index)
async function getADX(symbol, timeframe = '15m', period = 14) {
    try {
        // Pegar candles suficientes (period * 2 + 1)
        const candles = await getCandlesCached(symbol, timeframe, period * 2 + 1);
        
        if (candles.length < period * 2 + 1) {
            return {
                adx: "N/A",
                pdi: "N/A",  // +DI
                mdi: "N/A",  // -DI
                trend: "⚪",
                strength: "Dados insuficientes",
                message: `ADX${timeframe}: ⚪ Dados insuficientes`,
                timeframe: timeframe,
                period: period
            };
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Calcular ADX usando technicalindicators
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });
        
        if (!adxValues || adxValues.length === 0) {
            return {
                adx: "N/A",
                pdi: "N/A",
                mdi: "N/A",
                trend: "⚪",
                strength: "Erro no cálculo",
                message: `ADX${timeframe}: ⚪ Erro`,
                timeframe: timeframe,
                period: period
            };
        }
        
        const latestADX = adxValues[adxValues.length - 1];
        
        // Determinar tendência baseada em +DI e -DI
        let trend = "➡️"; // neutro
        let trendStrength = "";
        
        if (latestADX.adx >= 25) {
            // Tendência forte
            if (latestADX.pdi > latestADX.mdi) {
                trend = "🟢⬆️"; // Tendência de alta forte
                trendStrength = "Forte Alta";
            } else if (latestADX.mdi > latestADX.pdi) {
                trend = "🔴⬇️"; // Tendência de baixa forte
                trendStrength = "Forte Baixa";
            }
        } else if (latestADX.adx >= 20) {
            // Tendência moderada
            if (latestADX.pdi > latestADX.mdi) {
                trend = "🟢↗️"; // Tendência de alta moderada
                trendStrength = "Moderada Alta";
            } else if (latestADX.mdi > latestADX.pdi) {
                trend = "🔴↘️"; // Tendência de baixa moderada
                trendStrength = "Moderada Baixa";
            }
        } else {
            // Mercado lateral (sem tendência)
            trend = "⚪➡️";
            trendStrength = "Sem Tendência";
        }
        
        // Determinar força do ADX
        let strength = "";
        if (latestADX.adx >= 40) strength = "Forte 📈";
        else if (latestADX.adx >= 25) strength = "Bom ✅";
        else if (latestADX.adx >= 20) strength = "Regular ⚠️";
        else strength = "Fraco ❌";
        
        return {
            adx: latestADX.adx.toFixed(2),
            pdi: latestADX.pdi.toFixed(2),
            mdi: latestADX.mdi.toFixed(2),
            trend: trend,
            trendStrength: trendStrength,
            strength: strength,
            rawADX: latestADX.adx,
            rawPDI: latestADX.pdi,
            rawMDI: latestADX.mdi,
            message: `ADX${timeframe}: ${latestADX.adx.toFixed(2)} (${strength}) ${trend}`,
            timeframe: timeframe,
            period: period,
            hasStrongTrend: latestADX.adx >= 25,
            isBullishTrend: latestADX.pdi > latestADX.mdi,
            isBearishTrend: latestADX.mdi > latestADX.pdi
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular ADX(${symbol}, ${timeframe}): ${error.message}`);
        return {
            adx: "N/A",
            pdi: "N/A",
            mdi: "N/A",
            trend: "⚪",
            strength: "Erro",
            message: `ADX${timeframe}: ⚪ Erro`,
            timeframe: timeframe,
            period: period
        };
    }
}

// 🔵 NOVA FUNÇÃO: Controlar Rate Limit da Binance
async function checkRateLimit(weight = 1) {
    const now = Date.now();
    const windowSize = 60 * 1000; // 1 minuto em milissegundos
    
    // Resetar contador se a janela expirou
    if (now - rateLimitCounter.windowStart >= windowSize) {
        rateLimitCounter.windowStart = now;
        rateLimitCounter.usedWeight = 0;
        rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
    }
    
    // Verificar se podemos fazer a requisição
    if (rateLimitCounter.usedWeight + weight > BINANCE_RATE_LIMIT.requestsPerMinute) {
        const waitTime = windowSize - (now - rateLimitCounter.windowStart) + 1000;
        logToFile(`⏳ Rate limit próximo: ${rateLimitCounter.usedWeight}/${BINANCE_RATE_LIMIT.requestsPerMinute}. Aguardando ${Math.ceil(waitTime/1000)}s`);
        console.log(`⏳ Rate limit próximo. Aguardando ${Math.ceil(waitTime/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        // Resetar após espera
        rateLimitCounter.windowStart = Date.now();
        rateLimitCounter.usedWeight = 0;
        rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
    }
    
    // Atualizar contador
    rateLimitCounter.usedWeight += weight;
    rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute - rateLimitCounter.usedWeight;
    
    // Pequeno delay entre requisições
    await new Promise(resolve => setTimeout(resolve, 100));
}

// 🔵 NOVA FUNÇÃO: Buscar todos os símbolos da Binance Futures
async function fetchAllFuturesSymbols() {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.exchangeInfo);
        
        const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        const response = await fetchWithRetry(url);
        
        if (!response.ok) {
            throw new Error(`Falha ao buscar exchangeInfo: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Filtrar apenas símbolos USDT e ativos tradáveis
        const symbols = data.symbols
            .filter(symbol => 
                symbol.quoteAsset === 'USDT' && 
                symbol.status === 'TRADING' &&
                symbol.contractType === 'PERPETUAL'
            )
            .map(symbol => symbol.symbol);
        
        console.log(`✅ Encontrados ${symbols.length} símbolos USDT PERPETUAL na Binance Futures`);
        
        // Obter informações de decimais para cada símbolo
        await fetchSymbolsDecimals(data.symbols);
        
        return symbols;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar símbolos: ${error.message}`);
        logToFile(`❌ Erro ao buscar símbolos: ${error.message}`);
        
        // Fallback para lista básica se a API falhar
        return [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT',
            'AVAXUSDT', 'LINKUSDT', 'TRXUSDT', 'UNIUSDT', 'ATOMUSDT'
        ];
    }
}

// 🔵 NOVA FUNÇÃO: Buscar informações de decimais dos símbolos
async function fetchSymbolsDecimals(symbolsData) {
    try {
        for (const symbolInfo of symbolsData) {
            if (symbolInfo.quoteAsset !== 'USDT' || symbolInfo.status !== 'TRADING') {
                continue;
            }
            
            // Encontrar filtro de preço
            const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
            const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
            
            if (priceFilter && priceFilter.tickSize) {
                // Calcular casas decimais baseado no tickSize
                const tickSize = parseFloat(priceFilter.tickSize);
                let decimals = 0;
                
                if (tickSize < 1) {
                    const decimalStr = tickSize.toString();
                    const decimalIndex = decimalStr.indexOf('.');
                    if (decimalIndex !== -1) {
                        // Contar zeros após o ponto decimal
                        const parts = decimalStr.split('.')[1];
                        let count = 0;
                        for (let char of parts) {
                            if (char === '0') count++;
                            else break;
                        }
                        decimals = count + 1;
                    }
                } else if (tickSize >= 1) {
                    decimals = 0;
                }
                
                // Ajustar decimais baseado no símbolo
                const symbol = symbolInfo.symbol;
                
                // Regras específicas para certos símbolos
                if (symbol.includes('1000') || symbol.includes('BONK') || symbol.includes('PEPE') || symbol.includes('SHIB')) {
                    decimals = Math.max(decimals, 6);
                } else if (symbol.includes('USDT') && !symbol.includes('1000')) {
                    // Para a maioria dos pares USDT
                    if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT' || symbol === 'BNBUSDT') {
                        decimals = 2;
                    } else if (parseFloat(priceFilter.minPrice) < 0.01) {
                        decimals = Math.max(decimals, 4);
                    } else if (parseFloat(priceFilter.minPrice) < 1) {
                        decimals = Math.max(decimals, 3);
                    } else {
                        decimals = Math.max(decimals, 2);
                    }
                }
                
                DECIMALS_CONFIG[symbol] = decimals;
            }
        }
        
        console.log(`✅ Configuração de decimais carregada para ${Object.keys(DECIMALS_CONFIG).length} símbolos`);
        
    } catch (error) {
        console.error(`❌ Erro ao buscar decimais: ${error.message}`);
        logToFile(`❌ Erro ao buscar decimais: ${error.message}`);
        
        // Fallback para configuração básica
        DECIMALS_CONFIG['BTCUSDT'] = 2;
        DECIMALS_CONFIG['ETHUSDT'] = 2;
        DECIMALS_CONFIG['BNBUSDT'] = 2;
        DECIMALS_CONFIG['SOLUSDT'] = 3;
        DECIMALS_CONFIG['XRPUSDT'] = 4;
    }
}

// 🔵 NOVA FUNÇÃO: Calcular série completa de EMA para detectar cruzamentos
function calculateEMACompleteSeries(prices, period) {
    if (!prices || prices.length < period) return null;
    
    try {
        return EMA.calculate({
            values: prices,
            period: period
        });
    } catch (error) {
        console.error(`Erro ao calcular série EMA: ${error.message}`);
        return null;
    }
}

// 🔵 NOVA FUNÇÃO: Calcular volatilidade (ATR percentual) em 15 minutos
async function checkVolatility(symbol, timeframe = VOLATILITY_TIMEFRAME, period = VOLATILITY_PERIOD, threshold = VOLATILITY_THRESHOLD) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 1);
        
        if (candles.length < period) {
            return {
                isValid: true,
                volatility: 0,
                message: "Vol: ⚪ Dados insuficientes",
                threshold: threshold,
                timeframe: timeframe
            };
        }
        
        // Calcular ATR (Average True Range) percentual
        let totalATR = 0;
        let count = 0;
        
        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i-1];
            
            // True Range
            const highLow = current.high - current.low;
            const highClose = Math.abs(current.high - previous.close);
            const lowClose = Math.abs(current.low - previous.close);
            
            const trueRange = Math.max(highLow, highClose, lowClose);
            const atrPercent = (trueRange / previous.close) * 100;
            
            totalATR += atrPercent;
            count++;
        }
        
        const avgVolatility = count > 0 ? totalATR / count : 0;
        
        // Verificar se atinge o limite mínimo
        const isValid = avgVolatility >= threshold;
        
        return {
            isValid: isValid,
            volatility: avgVolatility.toFixed(2),
            rawVolatility: avgVolatility,
            message: isValid ? 
                `✅ Vol: ${avgVolatility.toFixed(2)}% (≥ ${threshold}%)` :
                `❌ Vol: ${avgVolatility.toFixed(2)}% (< ${threshold}%)`,
            threshold: threshold,
            candlesUsed: count,
            timeframe: timeframe
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular volatilidade(${symbol}, ${timeframe}): ${error.message}`);
        return {
            isValid: true,
            volatility: 0,
            message: "Vol: ⚪ Erro no cálculo",
            threshold: threshold,
            timeframe: timeframe
        };
    }
}

// 🔴 NOVA FUNÇÃO: Calcular ATR (Average True Range) para stop dinâmico
async function calculateATR(symbol, timeframe = ATR_TIMEFRAME, period = ATR_PERIOD) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 1);
        
        if (candles.length < period + 1) {
            return {
                atr: null,
                atrPercent: null,
                message: "ATR: ⚪ Dados insuficientes",
                period: period,
                timeframe: timeframe
            };
        }
        
        // Preparar dados para technicalindicators
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Calcular ATR usando technicalindicators
        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });
        
        if (!atrValues || atrValues.length === 0) {
            return {
                atr: null,
                atrPercent: null,
                message: "ATR: ⚪ Erro no cálculo",
                period: period,
                timeframe: timeframe
            };
        }
        
        const currentATR = atrValues[atrValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        const atrPercent = (currentATR / currentPrice) * 100;
        
        return {
            atr: currentATR,
            atrPercent: atrPercent,
            atrFormatted: currentATR.toFixed(DECIMALS_CONFIG[symbol] || DEFAULT_DECIMALS),
            atrPercentFormatted: atrPercent.toFixed(2),
            price: currentPrice,
            message: `ATR: ${currentATR.toFixed(DECIMALS_CONFIG[symbol] || DEFAULT_DECIMALS)} (${atrPercent.toFixed(2)}%)`,
            period: period,
            timeframe: timeframe,
            raw: currentATR
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular ATR(${symbol}, ${timeframe}): ${error.message}`);
        return {
            atr: null,
            atrPercent: null,
            message: "ATR: ⚪ Erro",
            period: period,
            timeframe: timeframe
        };
    }
}

// 🔵 FUNÇÃO MELHORADA: Buscar Open Interest com histórico aprimorado
async function getOpenInterestWithSMA(symbol) {
    const cacheKey = `${symbol}_OI_5m`;
    const now = Date.now();
    
    // Verificar cache
    if (oiCache[cacheKey] && now - oiCache[cacheKey].timestamp < OI_CACHE_TTL) {
        return oiCache[cacheKey];
    }
    
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.openInterest);
        
        // Buscar o Open Interest atual
        const currentOIUrl = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const currentRes = await fetchWithRetry(currentOIUrl);
        const currentData = await currentRes.json();
        
        if (!currentData || !currentData.openInterest) {
            throw new Error('Dados de Open Interest inválidos');
        }
        
        const currentOI = parseFloat(currentData.openInterest);
        const timestamp = currentData.time || now;
        
        // 🔵 MELHORIA: Tentar buscar histórico se disponível
        let oiHistory = [];
        let useHistoricalAPI = false;
        
        try {
            // Tentar API de histórico
            await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.openInterest);
            const historicalUrl = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=30`;
            const historicalRes = await fetchWithRetry(historicalUrl, {}, 1);
            
            if (historicalRes.status === 200) {
                const historicalData = await historicalRes.json();
                
                if (Array.isArray(historicalData) && historicalData.length > 0) {
                    // Processar dados históricos
                    oiHistory = historicalData.map(item => ({
                        value: parseFloat(item.sumOpenInterest),
                        timestamp: item.timestamp
                    }));
                    
                    // Ordenar por timestamp
                    oiHistory.sort((a, b) => a.timestamp - b.timestamp);
                    
                    // Adicionar o valor atual ao final
                    oiHistory.push({
                        value: currentOI,
                        timestamp: timestamp
                    });
                    
                    // Manter apenas os últimos OI_HISTORY_SIZE pontos
                    if (oiHistory.length > OI_HISTORY_SIZE) {
                        oiHistory = oiHistory.slice(-OI_HISTORY_SIZE);
                    }
                    
                    useHistoricalAPI = true;
                }
            }
        } catch (historicalError) {
            // API histórica não disponível
        }
        
        // Se não usou API histórica, usar método em memória
        if (!useHistoricalAPI) {
            // Se já temos histórico, usar ele e adicionar o novo valor
            if (oiCache[cacheKey] && oiCache[cacheKey].history) {
                oiHistory = [...oiCache[cacheKey].history];
                
                // Adicionar novo ponto se passou tempo suficiente (> 55 segundos)
                const lastTimestamp = oiHistory.length > 0 ? oiHistory[oiHistory.length - 1].timestamp : 0;
                
                if (now - lastTimestamp > 55000) {
                    oiHistory.push({
                        value: currentOI,
                        timestamp: now
                    });
                    
                    // Manter apenas os últimos OI_HISTORY_SIZE pontos
                    if (oiHistory.length > OI_HISTORY_SIZE) {
                        oiHistory = oiHistory.slice(-OI_HISTORY_SIZE);
                    }
                } else {
                    // Atualizar o último valor se for muito recente
                    if (oiHistory.length > 0) {
                        oiHistory[oiHistory.length - 1] = {
                            value: currentOI,
                            timestamp: now
                        };
                    }
                }
            } else {
                // Primeira vez, inicializar com valor atual
                oiHistory.push({
                    value: currentOI,
                    timestamp: now
                });
            }
        }
        
        // Calcular SMA e tendência
        let sma = null;
        let trend = "➡️"; // neutro
        let oiFormatted = currentOI.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        });
        
        if (oiHistory.length >= OI_SMA_PERIOD) {
            // Pegar os últimos OI_SMA_PERIOD valores para SMA
            const recentValues = oiHistory.slice(-OI_SMA_PERIOD).map(h => h.value);
            
            // Calcular SMA usando technicalindicators
            sma = SMA.calculate({
                values: recentValues,
                period: OI_SMA_PERIOD
            }).pop();
            
            // Determinar tendência comparando valor atual com SMA
            if (sma !== null && sma > 0) {
                const percentageDiff = ((currentOI - sma) / sma) * 100;
                
                if (percentageDiff > 0.3) {
                    trend = "🟢⬆️";
                } else if (percentageDiff < -0.3) {
                    trend = "🔴⬇️";
                }
            }
            
            // 🔵 MELHORIA: Verificar também tendência nos últimos 3 pontos
            if (oiHistory.length >= 3) {
                const lastThree = oiHistory.slice(-3).map(h => h.value);
                const isConsistentRise = lastThree[2] > lastThree[1] && lastThree[1] > lastThree[0];
                const isConsistentFall = lastThree[2] < lastThree[1] && lastThree[1] < lastThree[0];
                
                if (isConsistentRise) trend = "🟢⬆️";
                if (isConsistentFall) trend = "🔴⬇️";
            }
        }
        
        const result = {
            currentOI: currentOI,
            oiFormatted: oiFormatted,
            sma: sma,
            trend: trend,
            history: oiHistory,
            timestamp: now,
            historySize: oiHistory.length
        };
        
        // Salvar no cache
        oiCache[cacheKey] = result;
        
        return result;
        
    } catch (error) {
        logToFile(`⚠️ Erro ao buscar Open Interest(${symbol}): ${error.message}`);
        
        // Retornar dados do cache se disponível
        if (oiCache[cacheKey]) {
            return oiCache[cacheKey];
        }
        
        return {
            currentOI: 0,
            oiFormatted: "N/A",
            sma: null,
            trend: "➡️",
            history: [],
            timestamp: now,
            historySize: 0
        };
    }
}

// 🔵 NOVA FUNÇÃO: Verificar critério do Open Interest
async function checkOpenInterestCriteria(symbol, isBullishSignal) {
    try {
        const oiData = await getOpenInterestWithSMA(symbol);
        
        // Se não temos dados suficientes, retornar verdadeiro
        if (oiData.trend === "➡️" || oiData.sma === null || oiData.historySize < OI_SMA_PERIOD) {
            return {
                isValid: true,
                trend: oiData.trend,
                oiFormatted: oiData.oiFormatted,
                historySize: oiData.historySize,
                message: "OI: ⚪ Neutro (dados insuficientes)"
            };
        }
        
        // Para sinal de COMPRA: OI deve estar subindo (🟢⬆️)
        // Para sinal de VENDA: OI deve estar caindo (🔴⬇️)
        if (isBullishSignal) {
            const isValid = oiData.trend === "🟢⬆️";
            return {
                isValid: isValid,
                trend: oiData.trend,
                oiFormatted: oiData.oiFormatted,
                historySize: oiData.historySize,
                message: isValid ? 
                    `OI: ${oiData.trend} Subindo` : 
                    `OI: ${oiData.trend} Não está subindo (requerido para COMPRA)`
            };
        } else {
            const isValid = oiData.trend === "🔴⬇️";
            return {
                isValid: isValid,
                trend: oiData.trend,
                oiFormatted: oiData.oiFormatted,
                historySize: oiData.historySize,
                message: isValid ? 
                    `OI: ${oiData.trend} Caindo` : 
                    `OI: ${oiData.trend} Não está caindo (requerido para VENDA)`
            };
        }
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar critério OI(${symbol}): ${error.message}`);
        return {
            isValid: true,
            trend: "➡️",
            oiFormatted: "N/A",
            historySize: 0,
            message: "OI: ⚪ Erro na verificação"
        };
    }
}

// 🔵 NOVA FUNÇÃO: Verificar critério do LSR ratio
async function checkLSRCriteria(symbol, isBullishSignal) {
    try {
        const lsrData = await getLSR(symbol, LSR_TIMEFRAME);
        
        // Se não temos dados do LSR, retornar verdadeiro (não bloquear)
        if (lsrData.raw === null || lsrData.raw === undefined) {
            return {
                isValid: true,
                lsrRatio: "N/A",
                message: "LSR: ⚪ Dados insuficientes",
                threshold: isBullishSignal ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD
            };
        }
        
        const lsrValue = lsrData.raw;
        
        // Para sinal de COMPRA: LSR deve ser menor que 2.5
        // Para sinal de VENDA: LSR deve ser maior que 2.5
        if (isBullishSignal) {
            const isValid = lsrValue < LSR_BUY_THRESHOLD;
            return {
                isValid: isValid,
                lsrRatio: lsrData.lsrRatio,
                raw: lsrValue,
                message: isValid ? 
                    `✅ LSR: ${lsrData.lsrRatio} (< ${LSR_BUY_THRESHOLD})` : 
                    `❌ LSR: ${lsrData.lsrRatio} (≥ ${LSR_BUY_THRESHOLD} - requerido < ${LSR_BUY_THRESHOLD} para COMPRA)`,
                threshold: LSR_BUY_THRESHOLD,
                timeframe: LSR_TIMEFRAME
            };
        } else {
            const isValid = lsrValue > LSR_SELL_THRESHOLD;
            return {
                isValid: isValid,
                lsrRatio: lsrData.lsrRatio,
                raw: lsrValue,
                message: isValid ? 
                    `✅ LSR: ${lsrData.lsrRatio} (> ${LSR_SELL_THRESHOLD})` : 
                    `❌ LSR: ${lsrData.lsrRatio} (≤ ${LSR_SELL_THRESHOLD} - requerido > ${LSR_SELL_THRESHOLD} para VENDA)`,
                threshold: LSR_SELL_THRESHOLD,
                timeframe: LSR_TIMEFRAME
            };
        }
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar critério LSR(${symbol}): ${error.message}`);
        return {
            isValid: true,
            lsrRatio: "N/A",
            message: "LSR: ⚪ Erro na verificação",
            threshold: isBullishSignal ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD,
            timeframe: LSR_TIMEFRAME
        };
    }
}

// Função para obter data e hora de Brasília
function getBrazilianDateTime() {
    const now = new Date();
    const brasiliaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    const day = String(brasiliaTime.getDate()).padStart(2, '0');
    const month = String(brasiliaTime.getMonth() + 1).padStart(2, '0');
    const year = brasiliaTime.getFullYear();
    const hours = String(brasiliaTime.getHours()).padStart(2, '0');
    const minutes = String(brasiliaTime.getMinutes()).padStart(2, '0');
    const seconds = String(brasiliaTime.getSeconds()).padStart(2, '0');
    
    return {
        date: `${day}/${month}/${year}`,
        time: `${hours}:${minutes}:${seconds}`,
        full: `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`,
        timestamp: brasiliaTime.getTime()
    };
}

// Função para inicializar sistema de logs
function initLogSystem() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    cleanupOldLogs();
}

// Função para limpar logs antigos
function cleanupOldLogs() {
    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter(file => file.startsWith('bot_') && file.endsWith('.log'))
            .map(file => ({
                name: file,
                path: path.join(LOG_DIR, file),
                time: fs.statSync(path.join(LOG_DIR, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > MAX_LOG_FILES) {
            files.slice(MAX_LOG_FILES).forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    logToFile(`🗑️ Log antigo removido: ${file.name}`);
                } catch (e) {
                    console.error(`Erro ao remover log: ${e.message}`);
                }
            });
        }
    } catch (e) {
        console.error(`Erro na limpeza de logs: ${e.message}`);
    }
}

// Função para logar em arquivo
function logToFile(message) {
    try {
        const timestamp = new Date().toISOString();
        const logDate = new Date().toISOString().split('T')[0];
        const logFile = path.join(LOG_DIR, `bot_${logDate}.log`);
        
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_LOG_SIZE) {
                const rotatedFile = path.join(LOG_DIR, `bot_${logDate}_${Date.now()}.log`);
                fs.renameSync(logFile, rotatedFile);
            }
        }
        
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logFile, logMessage);
    } catch (e) {
        console.error(`Erro ao escrever log: ${e.message}`);
    }
}

// 🔵 FUNÇÃO OTIMIZADA: fetch com tratamento de rate limit e retry
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Verificar rate limit antes de fazer a requisição
            await checkRateLimit(1);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            // Verificar rate limit (429 Too Many Requests)
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || 60;
                const waitTime = parseInt(retryAfter) * 1000 + 2000;
                
                logToFile(`⚠️ Rate limit atingido (429). Tentativa ${attempt}/${maxRetries}. Aguardando ${retryAfter}s...`);
                console.log(`⚠️ Rate limit atingido. Aguardando ${retryAfter}s...`);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            // Verificar headers de rate limit da Binance
            const usedWeight = response.headers.get('X-MBX-USED-WEIGHT-1M');
            if (usedWeight) {
                rateLimitCounter.usedWeight = parseInt(usedWeight);
                rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute - rateLimitCounter.usedWeight;
            }
            
            return response;
            
        } catch (error) {
            lastError = error;
            
            if (error.name === 'AbortError') {
                logToFile(`⏱️ Timeout na tentativa ${attempt}/${maxRetries}`);
                console.log(`⏱️ Timeout na tentativa ${attempt}/${maxRetries}`);
            } else {
                logToFile(`⚠️ Erro na tentativa ${attempt}/${maxRetries}: ${error.message}`);
            }
            
            // Aguardar antes da próxima tentativa (exponencial backoff)
            if (attempt < maxRetries) {
                const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error(`Falha após ${maxRetries} tentativas`);
}

// Função para verificar conexão
async function checkInternetConnection() {
    try {
        await checkRateLimit(1);
        await fetchWithRetry('https://api.binance.com/api/v3/ping', {}, 1);
        return true;
    } catch (error) {
        return false;
    }
}

// Função para reconexão
async function reconnectWithBackoff(attempt = 1) {
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
    
    logToFile(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
    console.log(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    const isConnected = await checkInternetConnection();
    if (isConnected) {
        logToFile('✅ Conexão restaurada!');
        console.log('✅ Conexão restaurada!');
        return true;
    }
    
    if (attempt >= MAX_RETRY_ATTEMPTS) {
        logToFile('❌ Máximo de tentativas de reconexão atingido');
        console.log('❌ Máximo de tentativas de reconexão atingido');
        return false;
    }
    
    return await reconnectWithBackoff(attempt + 1);
}

// 🔵 FUNÇÃO MELHORADA: Limpar caches periodicamente
function cleanupCaches() {
    const now = Date.now();
    
    // Limpar candleCache antigo
    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].ts > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });
    
    // Limpar OI cache antigo
    Object.keys(oiCache).forEach(key => {
        if (now - oiCache[key].timestamp > 10 * 60 * 1000) {
            delete oiCache[key];
        }
    });
    
    // Limpar sweeps muito antigos
    Object.keys(recentSweeps).forEach(symbol => {
        if (recentSweeps[symbol].lastBuySweep && 
            now - recentSweeps[symbol].lastBuySweep > MAX_SWEEP_AGE) {
            recentSweeps[symbol].lastBuySweep = null;
            recentSweeps[symbol].buySweepPrice = 0;
        }
        
        if (recentSweeps[symbol].lastSellSweep && 
            now - recentSweeps[symbol].lastSellSweep > MAX_SWEEP_AGE) {
            recentSweeps[symbol].lastSellSweep = null;
            recentSweeps[symbol].sellSweepPrice = 0;
        }
    });
    
    // Limpar cache comprimido
    Object.keys(COMPRESSED_CANDLE_CACHE).forEach(key => {
        if (now - COMPRESSED_CANDLE_CACHE[key].timestamp > MAX_CACHE_AGE) {
            delete COMPRESSED_CANDLE_CACHE[key];
        }
    });
}

// Função para formatar números com base no ativo
function formatNumber(num, symbol = null, isPrice = true) {
    if (num === "N/A" || num === undefined || num === null) return "N/A";
    
    if (typeof num === 'string') {
        num = parseFloat(num);
    }
    
    if (isNaN(num)) return "N/A";
    
    if (isPrice && symbol && DECIMALS_CONFIG[symbol] !== undefined) {
        return num.toLocaleString('en-US', {
            minimumFractionDigits: DECIMALS_CONFIG[symbol],
            maximumFractionDigits: DECIMALS_CONFIG[symbol]
        });
    }
    
    // Para outros números usar 2 casas
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// 🔵 NOVA FUNÇÃO: Buscar Funding Rate
async function getFundingRate(symbol) {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.fundingRate);
        
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        
        if (data && data.lastFundingRate !== undefined) {
            const rate = parseFloat(data.lastFundingRate) * 100;
            
            // Determinar emojis
            let fundingRateEmoji = '';
            if (rate <= -0.2) fundingRateEmoji = '🟢🟢🟢🟢';
            else if (rate <= -0.1) fundingRateEmoji = '🟢🟢🟢';
            else if (rate <= -0.05) fundingRateEmoji = '🟢🟢';
            else if (rate >= 0.1) fundingRateEmoji = '🔴🔴🔴🔴';
            else if (rate >= 0.03) fundingRateEmoji = '🔴🔴🔴';
            else if (rate >= 0.02) fundingRateEmoji = '🔴🔴';
            
            return {
                rate: rate.toFixed(4),
                emoji: fundingRateEmoji,
                raw: rate
            };
        }
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Funding Rate(${symbol}): ${e.message}`);
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null
        };
    }
}

// 🔵 NOVA FUNÇÃO: Comprimir candles para economizar memória
function compressCandles(candles) {
    if (!candles || candles.length === 0) return [];
    
    return candles.map(c => [
        Math.round(c.time / 60000),           // Minutos desde epoch (reduz de 13 para 8-9 dígitos)
        Math.round(c.open * 10000) / 10000,   // 4 casas decimais
        Math.round(c.high * 10000) / 10000,
        Math.round(c.low * 10000) / 10000,
        Math.round(c.close * 10000) / 10000,
        Math.round(c.volume)                  // Volume inteiro
    ]);
}

// 🔵 NOVA FUNÇÃO: Descomprimir candles
function decompressCandles(compressed) {
    if (!compressed || compressed.length === 0) return [];
    
    return compressed.map(c => ({
        time: c[0] * 60000,   // Converter de minutos para milissegundos
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
    }));
}

// 🔵 FUNÇÃO OTIMIZADA: Buscar candles com cache, compressão e TTL
async function getCandlesCached(symbol, timeframe = '1h', limit = 200) {
    const key = `${symbol}_${timeframe}_${limit}`;
    const now = Date.now();
    
    // Verificar se temos dados em cache válidos (comprimidos ou não)
    if (COMPRESS_CANDLES) {
        if (COMPRESSED_CANDLE_CACHE[key] && now - COMPRESSED_CANDLE_CACHE[key].timestamp < CANDLE_CACHE_TTL) {
            return decompressCandles(COMPRESSED_CANDLE_CACHE[key].data);
        }
    } else {
        if (candleCache[key] && now - candleCache[key].ts < CANDLE_CACHE_TTL) {
            return candleCache[key].data;
        }
    }
    
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.klines);
        
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        const candles = data.map(c => ({
            time: c[0],
            open: +c[1],
            high: +c[2],
            low: +c[3],
            close: +c[4],
            volume: +c[5]
        }));
        
        // Armazenar no cache com compressão ou sem
        if (COMPRESS_CANDLES) {
            const compressed = compressCandles(candles);
            COMPRESSED_CANDLE_CACHE[key] = { 
                data: compressed, 
                timestamp: now,
                originalSize: JSON.stringify(candles).length,
                compressedSize: JSON.stringify(compressed).length
            };
            
            // Log de economia de memória (ocasionalmente)
            if (Math.random() < 0.01) { // 1% das vezes
                const savings = (1 - (COMPRESSED_CANDLE_CACHE[key].compressedSize / COMPRESSED_CANDLE_CACHE[key].originalSize)) * 100;
                console.log(`📦 Compressão: ${savings.toFixed(1)}% economia para ${key}`);
            }
        } else {
            candleCache[key] = { data: candles, ts: now };
        }
        
        return candles;
        
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar candles(${symbol}): ${e.message}`);
        return [];
    }
}

// 🔵 FUNÇÃO MELHORADA: Buscar RSI usando technicalindicators
async function getRSI(symbol, timeframe, period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 50);
        
        if (candles.length < period + 1) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        const closes = candles.map(c => c.close);
        
        // Usar technicalindicators
        const rsiValues = RSI.calculate({
            values: closes,
            period: period
        });
        
        if (!rsiValues || rsiValues.length === 0) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        return {
            value: currentRSI.toFixed(2),
            timeframe: timeframe,
            raw: currentRSI
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar RSI(${symbol}, ${timeframe}): ${e.message}`);
        return { value: "N/A", timeframe: timeframe, raw: null };
    }
}

// 🔵 FUNÇÃO MELHORADA: Buscar Estocástico usando technicalindicators
async function getStochastic(symbol, timeframe, kPeriod = 5, dPeriod = 3, smooth = 3) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, kPeriod + dPeriod + smooth + 20);
        
        if (candles.length < kPeriod + dPeriod + smooth) {
            return { 
                k: "N/A", 
                d: "N/A", 
                kDirection: "➡️", 
                dDirection: "➡️", 
                timeframe: timeframe 
            };
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Usar technicalindicators
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: kPeriod,
            signalPeriod: dPeriod
        });
        
        if (!stochValues || stochValues.length === 0) {
            return { 
                k: "N/A", 
                d: "N/A", 
                kDirection: "➡️", 
                dDirection: "➡️", 
                timeframe: timeframe 
            };
        }
        
        const currentStoch = stochValues[stochValues.length - 1];
        const previousStoch = stochValues.length > 1 ? stochValues[stochValues.length - 2] : currentStoch;
        
        const kDirection = currentStoch.k > previousStoch.k ? "⬆️" : 
                          currentStoch.k < previousStoch.k ? "⬇️" : "➡️";
        const dDirection = currentStoch.d > previousStoch.d ? "⬆️" : 
                          currentStoch.d < previousStoch.d ? "⬇️" : "➡️";
        
        return {
            k: currentStoch.k.toFixed(2),
            d: currentStoch.d.toFixed(2),
            kDirection: kDirection,
            dDirection: dDirection,
            timeframe: timeframe,
            rawK: currentStoch.k,
            rawD: currentStoch.d
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Estocástico(${symbol}, ${timeframe}): ${e.message}`);
        return { 
            k: "N/A", 
            d: "N/A", 
            kDirection: "➡️", 
            dDirection: "➡️", 
            timeframe: timeframe,
            rawK: null,
            rawD: null
        };
    }
}

// Função para buscar Long/Short Ratio
async function getLSR(symbol, period = '15m') {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.lsr);
        
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        
        if (data && data.length > 0) {
            const latest = data[0];
            const longAccount = parseFloat(latest.longAccount);
            const shortAccount = parseFloat(latest.shortAccount);
            const lsrRatio = longAccount / shortAccount;
            
            return {
                longAccount: longAccount.toFixed(4),
                shortAccount: shortAccount.toFixed(4),
                lsrRatio: lsrRatio.toFixed(4),
                period: period,
                raw: lsrRatio
            };
        }
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period,
            raw: null
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar LSR(${symbol}, ${period}): ${e.message}`);
        return { 
            longAccount: "N/A", 
            shortAccount: "N/A", 
            lsrRatio: "N/A", 
            period: period,
            raw: null
        };
    }
}

// Função para buscar livro de ordens
async function getOrderBook(symbol) {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.orderBook);
        
        const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        
        const bestBid = data.bids[0] ? +data.bids[0][0] : 0;
        const bestAsk = data.asks[0] ? +data.asks[0][0] : 0;
        
        const bidVolume = data.bids.slice(0, 5).reduce((sum, bid) => sum + +bid[1], 0);
        const askVolume = data.asks.slice(0, 5).reduce((sum, ask) => sum + +ask[1], 0);
        
        return {
            bestBid: bestBid,
            bestAsk: bestAsk,
            bidVolume: bidVolume.toFixed(2),
            askVolume: askVolume.toFixed(2),
            spread: bestBid > 0 ? ((bestAsk - bestBid) / bestBid * 10000).toFixed(2) : "N/A"
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Order Book(${symbol}): ${e.message}`);
        return {
            bestBid: "N/A",
            bestAsk: "N/A",
            bidVolume: "N/A",
            askVolume: "N/A",
            spread: "N/A"
        };
    }
}

// 🔵 FUNÇÃO MELHORADA: Enviar alerta com retry
async function sendAlert(text, maxRetries = 3) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: text,
                    parse_mode: 'HTML'
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
            }
            
            const data = await response.json();
            if (!data.ok) {
                throw new Error(`Telegram error: ${data.description}`);
            }
            
            console.log('✅ Alerta enviado com sucesso para Telegram');
            return true;
            
        } catch (e) {
            logToFile(`❌ Erro ao enviar Telegram (tentativa ${attempt}/${maxRetries}): ${e.message}`);
            
            if (attempt < maxRetries) {
                const delay = 2000 * Math.pow(2, attempt - 1);
                console.log(`⏱️  Aguardando ${delay/1000}s antes de tentar novamente...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.log('❌ Falha ao enviar alerta para Telegram após todas as tentativas');
                return false;
            }
        }
    }
}

// 🔴 FUNÇÃO MELHORADA: Verificar volume anormal no timeframe de 3 minutos
async function checkAbnormalVolume(symbol, multiplier = VOLUME_RELATIVE_THRESHOLD) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 21);
        
        if (candles.length < 21) {
            logToFile(`⚠️ Dados insuficientes para volume 3m (${symbol})`);
            return { 
                isAbnormal: false, 
                currentVolume: 0, 
                avgVolume: 0, 
                ratio: 0,
                open: 0,
                close: 0,
                high: 0,
                low: 0
            };
        }
        
        // Extrair dados do último candle
        const latestCandle = candles[candles.length - 1];
        const open = latestCandle.open;
        const high = latestCandle.high;
        const low = latestCandle.low;
        const close = latestCandle.close;
        const currentVolume = latestCandle.volume;
        
        // Extrair volumes dos candles anteriores (20 períodos)
        const previousVolumes = candles.slice(0, candles.length - 1).map(c => c.volume);
        
        // Calcular média dos volumes anteriores
        const avgVolume = previousVolumes.reduce((sum, vol) => sum + vol, 0) / previousVolumes.length;
        
        // Calcular ratio
        const ratio = avgVolume > 0 ? currentVolume / avgVolume : 0;
        
        // Verificar se é anormal (usando VOLUME_RELATIVE_THRESHOLD)
        const isAbnormal = ratio >= multiplier;
        
        return {
            isAbnormal: isAbnormal,
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: ratio.toFixed(2),
            open: open,
            close: close,
            high: high,
            low: low,
            rawRatio: ratio,
            threshold: multiplier,
            isAboveThreshold: ratio >= VOLUME_RELATIVE_THRESHOLD
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao verificar volume 3m (${symbol}): ${error.message}`);
        return { 
            isAbnormal: false, 
            currentVolume: 0, 
            avgVolume: 0, 
            ratio: 0,
            open: 0,
            close: 0,
            high: 0,
            low: 0,
            rawRatio: 0,
            threshold: VOLUME_RELATIVE_THRESHOLD,
            isAboveThreshold: false
        };
    }
}

// 🔴 FUNÇÃO SIMPLIFICADA: Verificar volume anormal
async function checkVolumeConfirmation(symbol, multiplier = VOLUME_RELATIVE_THRESHOLD) {
    const volumeData = await checkAbnormalVolume(symbol, multiplier);
    
    const isVolumeConfirmed = volumeData.isAbnormal && volumeData.isAboveThreshold;
    
    return {
        isConfirmed: isVolumeConfirmed,
        volumeData: volumeData,
        message: isVolumeConfirmed ? 
            `✅ Volume confirmado (${volumeData.ratio}x ≥ ${VOLUME_RELATIVE_THRESHOLD}x)` :
            `❌ Volume não confirmado (${volumeData.ratio}x < ${VOLUME_RELATIVE_THRESHOLD}x)`
    };
}

// 🔵 FUNÇÃO MELHORADA: Buscar EMAs 13, 34 e 55 no timeframe de 3 minutos
async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 100);
        
        if (candles.length < 55) {
            logToFile(`⚠️ Dados insuficientes para EMAs 3m (${symbol})`);
            return {
                ema13: "N/A",
                ema34: "N/A",
                ema55: "N/A",
                currentPrice: "N/A",
                isAboveEMA55: false,
                isBelowEMA55: false,
                isEMA13CrossingUp: false,
                isEMA13CrossingDown: false,
                priceFormatted: "N/A",
                ema13Formatted: "N/A",
                ema34Formatted: "N/A",
                ema55Formatted: "N/A"
            };
        }
        
        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];
        
        // Calcular série completa de EMA
        const ema13Series = calculateEMACompleteSeries(closes, 13);
        const ema34Series = calculateEMACompleteSeries(closes, 34);
        const ema55Series = calculateEMACompleteSeries(closes, 55);
        
        // Verificar se os cálculos foram bem-sucedidos
        if (!ema13Series || !ema34Series || !ema55Series || 
            ema13Series.length < 2 || ema34Series.length < 2) {
            logToFile(`⚠️ Erro ao calcular séries EMA para ${symbol}`);
            return {
                ema13: "N/A",
                ema34: "N/A",
                ema55: "N/A",
                currentPrice: "N/A",
                isAboveEMA55: false,
                isBelowEMA55: false,
                isEMA13CrossingUp: false,
                isEMA13CrossingDown: false,
                priceFormatted: "N/A",
                ema13Formatted: "N/A",
                ema34Formatted: "N/A",
                ema55Formatted: "N/A"
            };
        }
        
        // Pegar valores atuais
        const ema13 = ema13Series[ema13Series.length - 1];
        const ema34 = ema34Series[ema34Series.length - 1];
        const ema55 = ema55Series.length > 0 ? ema55Series[ema55Series.length - 1] : null;
        
        // Detectar cruzamento
        const previousEma13 = ema13Series.length >= 2 ? ema13Series[ema13Series.length - 2] : null;
        const previousEma34 = ema34Series.length >= 2 ? ema34Series[ema34Series.length - 2] : null;
        
        const isEMA13CrossingUp = previousEma13 !== null && previousEma34 !== null && 
                                 previousEma13 <= previousEma34 && ema13 > ema34;
        const isEMA13CrossingDown = previousEma13 !== null && previousEma34 !== null && 
                                   previousEma13 >= previousEma34 && ema13 < ema34;
        
        // Formatar os valores
        const priceFormatted = formatNumber(currentPrice, symbol, true);
        const ema13Formatted = formatNumber(ema13, symbol, true);
        const ema34Formatted = formatNumber(ema34, symbol, true);
        const ema55Formatted = ema55 ? formatNumber(ema55, symbol, true) : "N/A";
        
        return {
            ema13: ema13,
            ema34: ema34,
            ema55: ema55,
            currentPrice: currentPrice,
            isAboveEMA55: ema55 ? currentPrice > ema55 : false,
            isBelowEMA55: ema55 ? currentPrice < ema55 : false,
            isEMA13CrossingUp: isEMA13CrossingUp,
            isEMA13CrossingDown: isEMA13CrossingDown,
            priceFormatted: priceFormatted,
            ema13Formatted: ema13Formatted,
            ema34Formatted: ema34Formatted,
            ema55Formatted: ema55Formatted,
            previousEma13: previousEma13,
            previousEma34: previousEma34
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar EMAs 3m (${symbol}): ${e.message}`);
        return {
            ema13: "N/A",
            ema34: "N/A",
            ema55: "N/A",
            currentPrice: "N/A",
            isAboveEMA55: false,
            isBelowEMA55: false,
            isEMA13CrossingUp: false,
            isEMA13CrossingDown: false,
            priceFormatted: "N/A",
            ema13Formatted: "N/A",
            ema34Formatted: "N/A",
            ema55Formatted: "N/A"
        };
    }
}

// Funções de detecção de fractal
function isUpFractal(lows, index) {
    if (FRACTAL_BARS === 5) {
        return lows[index-N-2] > lows[index-N] &&
               lows[index-N-1] > lows[index-N] &&
               lows[index-N+1] > lows[index-N] &&
               lows[index-N+2] > lows[index-N];
    } else {
        return lows[index-N-1] > lows[index-N] &&
               lows[index-N+1] > lows[index-N];
    }
}

function isDnFractal(highs, index) {
    if (FRACTAL_BARS === 5) {
        return highs[index-N-2] < highs[index-N] &&
               highs[index-N-1] < highs[index-N] &&
               highs[index-N+1] < highs[index-N] &&
               highs[index-N+2] < highs[index-N];
    } else {
        return highs[index-N-1] < highs[index-N] &&
               highs[index-N+1] < highs[index-N];
    }
}

// 🔴 FUNÇÃO AVANÇADA: Calcular níveis de entrada baseados em retração ATR
function calculateEntryLevelsATR(currentPrice, atrValue, isBullish, symbol) {
    const retractionATR = atrValue * ENTRY_RETRACTION_MULTIPLIER;
    const maxDistanceATR = atrValue * ENTRY_MAX_DISTANCE_MULTIPLIER;
    
    // Calcular retração em porcentagem
    const retractionPercent = (retractionATR / currentPrice) * 100;
    const maxDistancePercent = (maxDistanceATR / currentPrice) * 100;
    
    // Aplicar limites mínimo e máximo para retração
    const finalRetractionPercent = Math.max(
        ENTRY_MIN_RETRACTION_PERCENT,
        Math.min(retractionPercent, ENTRY_MAX_RETRACTION_PERCENT)
    );
    
    let idealEntry, maxEntry, retractionPrice, maxEntryPrice;
    
    if (isBullish) {
        // Para COMPRA: retração abaixo do preço atual
        retractionPrice = currentPrice * (1 - finalRetractionPercent / 100);
        idealEntry = retractionPrice;
        
        // Máximo de compra
        maxEntryPrice = currentPrice * (1 + maxDistancePercent / 100);
        maxEntry = maxEntryPrice;
    } else {
        // Para VENDA: retração acima do preço atual
        retractionPrice = currentPrice * (1 + finalRetractionPercent / 100);
        idealEntry = retractionPrice;
        
        // Mínimo de venda
        maxEntryPrice = currentPrice * (1 - maxDistancePercent / 100);
        maxEntry = maxEntryPrice;
    }
    
    return {
        currentPrice: currentPrice,
        idealEntry: idealEntry,
        idealEntryFormatted: formatNumber(idealEntry, symbol, true),
        maxEntry: maxEntry,
        maxEntryFormatted: formatNumber(maxEntry, symbol, true),
        retractionPrice: retractionPrice,
        retractionPriceFormatted: formatNumber(retractionPrice, symbol, true),
        retractionPercent: finalRetractionPercent.toFixed(2),
        maxDistancePercent: maxDistancePercent.toFixed(2),
        atrValueUsed: retractionATR,
        isBullish: isBullish,
        // Níveis intermediários para escala
        levels: isBullish ? [
            { level: 1, price: currentPrice * 0.995, label: "Entrada imediata" },
            { level: 2, price: idealEntry, label: "Entrada ideal (retração)" },
            { level: 3, price: currentPrice * 0.985, label: "Entrada agressiva" }
        ] : [
            { level: 1, price: currentPrice * 1.005, label: "Entrada imediata" },
            { level: 2, price: idealEntry, label: "Entrada ideal (retração)" },
            { level: 3, price: currentPrice * 1.015, label: "Entrada agressiva" }
        ]
    };
}

// 🔴 FUNÇÃO AVANÇADA: Calcular alvos e stop baseado em ATR
async function calculateTargetsAndStopATR(entryPrice, isBullish, symbol) {
    const targets = [];
    
    // 🔴 CALCULAR ATR PARA STOP DINÂMICO
    const atrData = await calculateATR(symbol, ATR_TIMEFRAME, ATR_PERIOD);
    
    let stopPrice, stopPercentage, stopType, atrValueUsed;
    
    if (atrData.atr && atrData.atr > 0) {
        // Usar ATR para stop dinâmico
        atrValueUsed = atrData.atr * ATR_MULTIPLIER;
        stopType = "ATR";
        
        // Calcular porcentagem do stop baseado no ATR
        const atrStopPercentage = (atrValueUsed / entryPrice) * 100;
        
        // Aplicar limites mínimo e máximo
        const finalStopPercentage = Math.max(
            MIN_ATR_PERCENTAGE, 
            Math.min(atrStopPercentage, MAX_ATR_PERCENTAGE)
        );
        
        stopPercentage = finalStopPercentage;
        
        if (isBullish) {
            stopPrice = entryPrice * (1 - finalStopPercentage / 100);
        } else {
            stopPrice = entryPrice * (1 + finalStopPercentage / 100);
        }
        
    } else {
        // Fallback para stop percentual fixo
        stopType = "Fixo";
        stopPercentage = 3.0;
        atrValueUsed = null;
        
        if (isBullish) {
            stopPrice = entryPrice * (1 - stopPercentage / 100);
        } else {
            stopPrice = entryPrice * (1 + stopPercentage / 100);
        }
    }
    
    // 🔴 CALCULAR NÍVEIS DE ENTRADA BASEADOS EM RETRAÇÃO ATR
    let entryLevels = null;
    if (atrData.atr && atrData.atr > 0) {
        entryLevels = calculateEntryLevelsATR(entryPrice, atrData.atr, isBullish, symbol);
    }
    
    // Calcular alvos de lucro
    if (isBullish) {
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = entryPrice * (1 + percentage / 100);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumber(targetPrice, symbol, true),
                riskReward: (percentage / stopPercentage).toFixed(2)
            });
        }
    } else {
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = entryPrice * (1 - percentage / 100);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumber(targetPrice, symbol, true),
                riskReward: (percentage / stopPercentage).toFixed(2)
            });
        }
    }
    
    return {
        targets: targets,
        stopPrice: stopPrice,
        stopFormatted: formatNumber(stopPrice, symbol, true),
        stopPercentage: stopPercentage.toFixed(2),
        stopType: stopType,
        atrData: atrData,
        atrValueUsed: atrValueUsed,
        atrMultiplier: ATR_MULTIPLIER,
        entryLevels: entryLevels,
        riskRewardRatios: targets.map(t => t.riskReward),
        bestRiskReward: Math.max(...targets.map(t => parseFloat(t.riskReward))).toFixed(2)
    };
}

// 🔵 FUNÇÃO MELHORADA: Filtro de Qualidade de Sinal (sem Market Structure)
async function calculateSignalQuality(symbol, isBullish, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData) {
    let score = 0;
    let details = [];
    
    // 1. Volume (25 pontos)
    if (volumeCheck.isConfirmed) {
        const volumeRatio = parseFloat(volumeCheck.volumeData.ratio);
        let volumeScore = 0;
        
        if (volumeRatio >= 2.0) {
            volumeScore = QUALITY_WEIGHTS.volume;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 2.0x)`);
        } else if (volumeRatio >= 1.5) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.8;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 1.5x)`);
        } else if (volumeRatio >= 1.3) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.5;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x mínimo)`);
        }
        
        score += volumeScore;
    } else {
        details.push(`📊 Volume: 0/${QUALITY_WEIGHTS.volume} (não confirmado)`);
    }
    
    // 2. Open Interest (15 pontos)
    if (oiCheck.isValid && oiCheck.trend !== "➡️") {
        score += QUALITY_WEIGHTS.oi;
        details.push(`📈 OI: ${QUALITY_WEIGHTS.oi}/${QUALITY_WEIGHTS.oi} (${oiCheck.trend})`);
    } else {
        details.push(`📈 OI: 0/${QUALITY_WEIGHTS.oi} (neutro ou inválido)`);
    }
    
    // 3. Volatilidade (10 pontos)
    if (volatilityCheck.isValid) {
        const volValue = parseFloat(volatilityCheck.volatility);
        let volScore = 0;
        
        if (volValue >= 1.0) {
            volScore = QUALITY_WEIGHTS.volatility;
            details.push(`⚡ Vol: ${volScore}/${QUALITY_WEIGHTS.volatility} (${volValue}% ≥ 1.0%)`);
        } else if (volValue >= 0.5) {
            volScore = QUALITY_WEIGHTS.volatility * 0.7;
            details.push(`⚡ Vol: ${volScore}/${QUALITY_WEIGHTS.volatility} (${volValue}% mínimo)`);
        }
        
        score += volScore;
    } else {
        details.push(`⚡ Vol: 0/${QUALITY_WEIGHTS.volatility} (insuficiente)`);
    }
    
    // 4. LSR (10 pontos)
    if (lsrCheck.isValid) {
        const lsrValue = parseFloat(lsrCheck.raw || 0);
        let lsrScore = 0;
        
        if (isBullish) {
            if (lsrValue < 2.0) {
                lsrScore = QUALITY_WEIGHTS.lsr;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} < 2.0)`);
            } else if (lsrValue < 2.5) {
                lsrScore = QUALITY_WEIGHTS.lsr * 0.6;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} < 2.5)`);
            }
        } else {
            if (lsrValue > 3.0) {
                lsrScore = QUALITY_WEIGHTS.lsr;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} > 3.0)`);
            } else if (lsrValue > 2.5) {
                lsrScore = QUALITY_WEIGHTS.lsr * 0.6;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} > 2.5)`);
            }
        }
        
        score += lsrScore;
    } else {
        details.push(`⚖️ LSR: 0/${QUALITY_WEIGHTS.lsr} (fora do range)`);
    }
    
    // 5. RSI (10 pontos)
    if (rsi1h.raw !== null && !isNaN(rsi1h.raw)) {
        const rsiValue = rsi1h.raw;
        let rsiScore = 0;
        
        if (isBullish) {
            if (rsiValue > 30 && rsiValue < 50) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📉 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} oversold)`);
            } else if (rsiValue >= 50 && rsiValue < 60) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.5;
                details.push(`📉 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} neutro)`);
            }
        } else {
            if (rsiValue > 50 && rsiValue < 70) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📈 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} overbought)`);
            } else if (rsiValue >= 40 && rsiValue <= 50) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.5;
                details.push(`📈 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} neutro)`);
            }
        }
        
        score += rsiScore;
    } else {
        details.push(`📉 RSI: 0/${QUALITY_WEIGHTS.rsi} (dados indisponíveis)`);
    }
    
    // 6. Alinhamento das EMAs (10 pontos)
    if (emas3mData.ema13 !== "N/A" && emas3mData.ema34 !== "N/A" && emas3mData.ema55 !== "N/A") {
        let emaScore = 0;
        
        if (isBullish) {
            if (emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
                emaScore = QUALITY_WEIGHTS.emaAlignment;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (alinhadas bullish)`);
            } else if (emas3mData.isAboveEMA55) {
                emaScore = QUALITY_WEIGHTS.emaAlignment * 0.5;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (acima da 55)`);
            }
        } else {
            if (emas3mData.isBelowEMA55 && emas3mData.isEMA13CrossingDown) {
                emaScore = QUALITY_WEIGHTS.emaAlignment;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (alinhadas bearish)`);
            } else if (emas3mData.isBelowEMA55) {
                emaScore = QUALITY_WEIGHTS.emaAlignment * 0.5;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (abaixo da 55)`);
            }
        }
        
        score += emaScore;
    } else {
        details.push(`📊 EMAs: 0/${QUALITY_WEIGHTS.emaAlignment} (dados insuficientes)`);
    }
    
    // 🔵 REMOVIDO: Market Structure (20 pontos) 
    // Simplesmente não incluímos mais esta seção
    
    // Determinar classificação
    let grade, emoji;
    if (score >= 85) {
        grade = "A✨";
        emoji = "🏆";
    } else if (score >= 70) {
        grade = "B";
        emoji = "✅";
    } else if (score >= 60) {
        grade = "C";
        emoji = "⚠️";
    } else {
        grade = "D";
        emoji = "❌";
    }
    
    return {
        score: Math.min(100, Math.round(score)),
        grade: grade,
        emoji: emoji,
        details: details,
        isAcceptable: score >= QUALITY_THRESHOLD,
        threshold: QUALITY_THRESHOLD,
        message: `${emoji} SCORE Classe: ${grade} (${Math.round(score)}/100) ${score >= QUALITY_THRESHOLD ? '✅' : '❌'}`
    };
}

// 🔵 FUNÇÃO ATUALIZADA: Construir mensagem de alerta mais objetiva e resumida
function buildAlertMessage(isBullish, symbol, priceFormatted, brDateTime, targetsAndStop, 
                          rsi1h, stoch4h, stochDaily, lsrData, fundingRate, 
                          volumeCheck, orderBook, sweepTime, emas3mData, oiCheck, volatilityCheck, lsrCheck,
                          qualityScore, adx15m, adx1h, learningSystem) {
    
    const title = isBullish ? '🟢 COMPRA' : '🔴 VENDA';
    const symbolPerformance = learningSystem.getSymbolPerformance(symbol);
    const winRate = symbolPerformance.totalSignals > 0 ? 
        ((symbolPerformance.successfulSignals / symbolPerformance.totalSignals) * 100).toFixed(1) : 'N/A';
    
    // 🔴 INFORMAÇÕES DO STOP ATR
    const stopInfo = targetsAndStop.stopType === "ATR" ? 
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)` :
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)`;
    
    // Mensagem muito mais resumida
    let message = `${title} | ${symbol}\n`;
    message += `🕒 ${brDateTime.time} | 💰$${priceFormatted}\n`;
    message += `📊 Score: ${qualityScore.grade} (${qualityScore.score}/100)\n`;
    message += `🎯 WinRate: ${winRate}% | ${symbolPerformance.totalSignals} ops\n\n`;
    
    // Entrada e stop
    message += `${stopInfo}\n`;
    message += `📈 ADX 15m: ${adx15m.adx} ${adx15m.trend}\n`;
    message += `📈 ADX 1h: ${adx1h.adx} ${adx1h.trend}\n\n`;
    
    // Alvos
    message += `🎯 Alvos:\n`;
    targetsAndStop.targets.forEach((target, index) => {
        message += isBullish ? 
            `${target.percentage}%: $${target.formatted}\n` :
            `${target.percentage}%: $${target.formatted}\n`;
    });
    
    message += `\n📊 Vol 3m: ${volumeCheck.volumeData.ratio}x\n`;
    message += `📈 OI: ${oiCheck.trend} | ⚖️ LSR: ${lsrCheck.lsrRatio}\n`;
    message += `📉 RSI: ${rsi1h.value} | 🔄 Stoch4h: ${stoch4h.k}/${stoch4h.d}\n`;
    
    message += `\nby @J4Rviz`;
    
    return message;
}

// 🔵 FUNÇÃO MODIFICADA: Inicializar cooldown para todos os símbolos
function initAlertsCooldown(symbols) {
    symbols.forEach(symbol => {
        alertsCooldown[symbol] = {
            lastBuyConfirmation: 0,
            lastSellConfirmation: 0
        };
        recentSweeps[symbol] = {
            lastBuySweep: null,
            lastSellSweep: null,
            buySweepPrice: 0,
            sellSweepPrice: 0
        };
    });
}

// 🔵 FUNÇÃO MODIFICADA: Apenas detectar sweeps (sem enviar alertas)
async function detectSweeps(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 100);
        if (candles.length < 100) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        const currentIndex = candles.length - 1;
        const price = closes[currentIndex];

        let buySweepDetected = false;
        let sellSweepDetected = false;
        let fractalLevel = 0;

        // Sweep BEAR - para detecção apenas
        if (isDnFractal(highs, currentIndex - N)) {
            fractalLevel = highs[currentIndex - N];
            if (price > fractalLevel) {
                sellSweepDetected = true;
            }
        }

        // Sweep BULL - para detecção apenas
        if (isUpFractal(lows, currentIndex - N)) {
            fractalLevel = lows[currentIndex - N];
            if (price < fractalLevel) {
                buySweepDetected = true;
            }
        }

        // 🔴 VERIFICAÇÃO DE CRITÉRIOS PARA SWEEP
        if (buySweepDetected || sellSweepDetected) {
            // Verificar volume relativo no 3m usando o threshold
            const volumeCheck = await checkAbnormalVolume(symbol, VOLUME_RELATIVE_THRESHOLD);
            
            // Se não passar no critério de volume, não armazenar
            if (!volumeCheck.isAboveThreshold) {
                return null;
            }

            // Armazenar informação do sweep
            const now = Date.now();
            if (buySweepDetected) {
                recentSweeps[symbol].lastBuySweep = now;
                recentSweeps[symbol].buySweepPrice = price;
            } else if (sellSweepDetected) {
                recentSweeps[symbol].lastSellSweep = now;
                recentSweeps[symbol].sellSweepPrice = price;
            }
            
            return {
                symbol: symbol,
                sweepType: buySweepDetected ? 'Compra' : 'Venda',
                price: price,
                volumeRatio: volumeCheck.ratio,
                timestamp: now,
                volumeThreshold: VOLUME_RELATIVE_THRESHOLD
            };
        }
        
        return null;
    } catch (e) {
        return null;
    }
}

// 🔵 FUNÇÃO ATUALIZADA: Monitorar confirmações de reversão com ADX
async function monitorConfirmation(symbol, learningSystem) {
    try {
        // Verificar se houve um sweep recente (últimas 6 horas)
        const now = Date.now();
        const sixHoursAgo = now - MAX_SWEEP_AGE;
        
        const hadBuySweep = recentSweeps[symbol].lastBuySweep && 
                           recentSweeps[symbol].lastBuySweep > sixHoursAgo;
        const hadSellSweep = recentSweeps[symbol].lastSellSweep && 
                            recentSweeps[symbol].lastSellSweep > sixHoursAgo;
        
        if (!hadBuySweep && !hadSellSweep) {
            return null;
        }
        
        // Obter dados das EMAs 13, 34 e 55 no timeframe de 3 minutos
        const emas3mData = await getEMAs3m(symbol);
        
        if (emas3mData.ema55 === "N/A" || emas3mData.ema13 === "N/A" || emas3mData.ema34 === "N/A") {
            return null;
        }
        
        // Buscar RSI 1h para verificar critérios
        const rsi1h = await getRSI(symbol, '1h');
        const rsiValue = parseFloat(rsi1h.value);
        
        // 🔵 ADICIONAR FUNDING RATE
        const fundingRate = await getFundingRate(symbol);
        
        const brDateTime = getBrazilianDateTime();
        const priceFormatted = formatNumber(emas3mData.currentPrice, symbol, true);
        
        let confirmationAlert = null;
        
        // 🔵 CONFIRMAÇÃO BULL: 
        // 1. EMA 13 cruzando para cima a EMA 34 no 3m
        // 2. Preço fechando acima da EMA 55 no 3m
        // 3. Após sweep de compra
        if (hadBuySweep && emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
            // 🔴 CRITÉRIO: RSI 1h deve ser menor que 60
            if (rsiValue >= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume relativo (≥ 1.3x da média)
            const volumeCheck = await checkVolumeConfirmation(symbol, VOLUME_RELATIVE_THRESHOLD);
            
            // 🔴 NOVO CRITÉRIO: Open Interest deve estar subindo (5 minutos)
            const oiCheck = await checkOpenInterestCriteria(symbol, true);
            
            // 🔴 NOVO CRITÉRIO: Volatilidade mínima (15 minutos)
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            
            // 🔴 NOVO CRITÉRIO: LSR ratio menor que 2.5 (15 minutos)
            const lsrCheck = await checkLSRCriteria(symbol, true);
            
            // 🔵 NOVO: Calcular qualidade do sinal (sem Market Structure)
            const qualityScore = await calculateSignalQuality(
                symbol, true, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData
            );
            
            // Verificar se passa em TODOS os novos critérios
            if (!volumeCheck.isConfirmed || !oiCheck.isValid || !volatilityCheck.isValid || !lsrCheck.isValid || !qualityScore.isAcceptable) {
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastBuyConfirmation > COOLDOWN) {
                // Buscar dados adicionais para a mensagem (incluindo ADX)
                const [orderBook, stoch4h, stochDaily, adx15m, adx1h] = await Promise.all([
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d'),
                    getADX(symbol, '15m', 14),
                    getADX(symbol, '1h', 14)
                ]);
                
                // 🔴 CALCULAR ALVOS E STOP DINÂMICO
                const targetsAndStop = await calculateTargetsAndStopATR(emas3mData.currentPrice, true, symbol);
                
                // 🔵 ATUALIZAR FUNÇÃO buildAlertMessage com ADX
                const msg = buildAlertMessage(
                    true,
                    symbol,
                    priceFormatted,
                    brDateTime,
                    targetsAndStop,
                    rsi1h,
                    stoch4h,
                    stochDaily,
                    { lsrRatio: lsrCheck.lsrRatio },
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastBuySweep,
                    emas3mData,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    qualityScore,
                    adx15m,
                    adx1h,
                    learningSystem
                );
                
                confirmationAlert = {
                    symbol: symbol,
                    signal: 'Confirmação Bull',
                    message: msg,
                    price: emas3mData.currentPrice,
                    brDateTime: brDateTime,
                    priceFormatted: priceFormatted,
                    targetsAndStop: targetsAndStop,
                    volumeConfirmation: volumeCheck,
                    oiCheck: oiCheck,
                    volatilityCheck: volatilityCheck,
                    lsrCheck: lsrCheck,
                    emas3mData: emas3mData,
                    qualityScore: qualityScore,
                    adx15m: adx15m,
                    adx1h: adx1h
                };
                
                // Registrar no sistema de aprendizado
                await learningSystem.recordTrade(confirmationAlert, {
                    volumeCheck,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    rsi1h,
                    emas3mData,
                    adx15m,
                    adx1h
                });
                
                alertsCooldown[symbol].lastBuyConfirmation = now;
            }
        }
        
        // 🔴 CONFIRMAÇÃO BEAR:
        // 1. EMA 13 cruzando para baixo a EMA 34 no 3m
        // 2. Preço fechando abaixo da EMA 55 no 3m
        // 3. Após sweep de venda
        if (hadSellSweep && emas3mData.isBelowEMA55 && emas3mData.isEMA13CrossingDown) {
            // 🔴 CRITÉRIO: RSI 1h deve ser maior que 60
            if (rsiValue <= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            // 🔴 CRITÉRIO: Volume relativo (≥ 1.3x da média)
            const volumeCheck = await checkVolumeConfirmation(symbol, VOLUME_RELATIVE_THRESHOLD);
            
            // 🔴 NOVO CRITÉRIO: Open Interest deve estar caindo (5 minutos)
            const oiCheck = await checkOpenInterestCriteria(symbol, false);
            
            // 🔴 NOVO CRITÉRIO: Volatilidade mínima (15 minutos)
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            
            // 🔴 NOVO CRITÉRIO: LSR ratio maior que 2.5 (15 minutos)
            const lsrCheck = await checkLSRCriteria(symbol, false);
            
            // 🔵 NOVO: Calcular qualidade do sinal (sem Market Structure)
            const qualityScore = await calculateSignalQuality(
                symbol, false, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData
            );
            
            // Verificar se passa em TODOS os novos critérios
            if (!volumeCheck.isConfirmed || !oiCheck.isValid || !volatilityCheck.isValid || !lsrCheck.isValid || !qualityScore.isAcceptable) {
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastSellConfirmation > COOLDOWN) {
                // Buscar dados adicionais (incluindo ADX)
                const [orderBook, stoch4h, stochDaily, adx15m, adx1h] = await Promise.all([
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d'),
                    getADX(symbol, '15m', 14),
                    getADX(symbol, '1h', 14)
                ]);
                
                // 🔴 CALCULAR ALVOS E STOP DINÂMICO
                const targetsAndStop = await calculateTargetsAndStopATR(emas3mData.currentPrice, false, symbol);
                
                const msg = buildAlertMessage(
                    false,
                    symbol,
                    priceFormatted,
                    brDateTime,
                    targetsAndStop,
                    rsi1h,
                    stoch4h,
                    stochDaily,
                    { lsrRatio: lsrCheck.lsrRatio },
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastSellSweep,
                    emas3mData,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    qualityScore,
                    adx15m,
                    adx1h,
                    learningSystem
                );
                
                confirmationAlert = {
                    symbol: symbol,
                    signal: 'Confirmação Bear',
                    message: msg,
                    price: emas3mData.currentPrice,
                    brDateTime: brDateTime,
                    priceFormatted: priceFormatted,
                    targetsAndStop: targetsAndStop,
                    volumeConfirmation: volumeCheck,
                    oiCheck: oiCheck,
                    volatilityCheck: volatilityCheck,
                    lsrCheck: lsrCheck,
                    emas3mData: emas3mData,
                    qualityScore: qualityScore,
                    adx15m: adx15m,
                    adx1h: adx1h
                };
                
                // Registrar no sistema de aprendizado
                await learningSystem.recordTrade(confirmationAlert, {
                    volumeCheck,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    rsi1h,
                    emas3mData,
                    adx15m,
                    adx1h
                });
                
                alertsCooldown[symbol].lastSellConfirmation = now;
            }
        }
        
        return confirmationAlert;
        
    } catch (e) {
        return null;
    }
}

// 🔵 FUNÇÃO OTIMIZADA: Processar múltiplos ativos em paralelo
async function processBatch(batch, processFunction, learningSystem = null) {
    const results = await Promise.allSettled(
        batch.map(symbol => learningSystem ? 
            processFunction(symbol, learningSystem) : 
            processFunction(symbol))
    );
    
    const alerts = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            alerts.push(result.value);
        }
    });
    
    return alerts;
}

// 🔵 FUNÇÃO ATUALIZADA: Loop principal do bot com ADX
async function mainBotLoop(learningSystem) {
    // Buscar símbolos dinamicamente
    console.log('\n🔍 Buscando todos os pares USDT da Binance Futures...');
    SYMBOLS = await fetchAllFuturesSymbols();
    
    if (SYMBOLS.length === 0) {
        console.log('❌ Não foi possível encontrar símbolos. Usando lista fallback.');
        SYMBOLS = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT'
        ];
    }
    
    // Inicializar sistema de cooldown com símbolos dinâmicos
    initAlertsCooldown(SYMBOLS);
    
    const initMsg = '\n' +
        '='.repeat(70) + '\n' +
        ' 🤖 BOT DE CONFIRMAÇÕES SMC 1H (TODOS OS PARES BINANCE FUTURES)\n' +
        ` 📊 MONITORANDO ${SYMBOLS.length} ATIVOS DINAMICAMENTE\n` +
        ` ⚡ PROCESSAMENTO EM LOTE (${BATCH_SIZE} ATIVOS EM PARALELO)\n` +
        ` 🚫 ALERTAS DE SWEEP DESATIVADOS\n` +
        ` ✅ APENAS CONFIRMAÇÕES BULL/BEAR\n` +
        ` 🔵 OPEN INTEREST APERFEIÇOADO\n` +
        ` 📈 VOLATILIDADE MÍNIMA DE ${VOLATILITY_THRESHOLD}% (${VOLATILITY_TIMEFRAME}, ${VOLATILITY_PERIOD} períodos)\n` +
        ` 📊 FILTRO DE VOLUME RELATIVO: ${VOLUME_RELATIVE_THRESHOLD}x (3m, 20 períodos)\n` +
        ` 🔴 STOP ATR AVANÇADO: Multiplicador ${ATR_MULTIPLIER}x (${ATR_TIMEFRAME}, ${ATR_PERIOD} períodos)\n` +
        ` 🔰 STOP LIMITES: Mínimo ${MIN_ATR_PERCENTAGE}%, Máximo ${MAX_ATR_PERCENTAGE}%\n` +
        ` 🎯 ENTRADAS COM RETRAÇÃO ATR: Multiplicador ${ENTRY_RETRACTION_MULTIPLIER}x\n` +
        ` 📊 NÍVEIS DE ENTRADA: ${ENTRY_MIN_RETRACTION_PERCENT}% - ${ENTRY_MAX_RETRACTION_PERCENT}% retração\n` +
        ` 🔵 FILTRO LSR: Compra < ${LSR_BUY_THRESHOLD}, Venda > ${LSR_SELL_THRESHOLD} (${LSR_TIMEFRAME})\n` +
        ` 📦 COMPRESSÃO DE CACHE: ${COMPRESS_CANDLES ? 'ATIVADA' : 'DESATIVADA'}\n` +
        ` 📊 FILTRO DE QUALIDADE: Score mínimo ${QUALITY_THRESHOLD}/100\n` +
        ` 📈 ADX INCLUÍDO: 15m e 1h para análise de tendência\n` +
        ` 🧠 SISTEMA DE APRENDIZADO: ATIVADO\n` +
        '='.repeat(70) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot iniciado - Monitorando ${SYMBOLS.length} ativos dinamicamente`);
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>SMC Confirmation Bot (Todos os pares Binance Futures)</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `📊 <b>Ativos monitorados:</b> ${SYMBOLS.length} pares USDT\n` +
                    `📊 <b>Filtro de qualidade:</b> ${QUALITY_THRESHOLD}/100\n` +
                    `🧠 <b>Sistema de aprendizado:</b> ATIVADO\n` +
                    `⚠️ <b>ATENÇÃO:</b> Sem limites de risco - todos os alertas serão enviados\n` +
                    `by @J4Rviz.`);

    let consecutiveErrors = 0;
    let cycleCount = 0;

    while (true) {
        try {
            cycleCount++;
            
            // Verificar conexão periodicamente
            if (consecutiveErrors > 3) {
                logToFile('⚠️ Muitos erros consecutivos, verificando conexão...');
                const isConnected = await checkInternetConnection();
                if (!isConnected) {
                    logToFile('🌐 Sem conexão com internet, tentando reconectar...');
                    console.log('🌐 Sem conexão com internet, tentando reconectar...');
                    const reconnected = await reconnectWithBackoff();
                    if (!reconnected) {
                        logToFile('❌ Falha na reconexão, reiniciando bot em 30 segundos...');
                        await new Promise(r => setTimeout(r, 30000));
                        continue;
                    }
                }
                consecutiveErrors = 0;
            }

            let sweepsDetected = 0;
            let confirmationAlertsSent = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            console.log(`📊 Rate Limit: ${rateLimitCounter.usedWeight}/${BINANCE_RATE_LIMIT.requestsPerMinute} (${rateLimitCounter.remainingWeight} restantes)`);
            
            // 🔵 PROCESSAR DETECÇÃO DE SWEEPS (SILENCIOSA)
            console.log('🔍 Detectando sweeps (sem alertas)...');
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchResults = await processBatch(batch, detectSweeps);
                
                sweepsDetected += batchResults.length;
                
                // Pequena pausa entre lotes
                if (i + BATCH_SIZE < SYMBOLS.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            
            // 🔵 PROCESSAR CONFIRMAÇÕES EM LOTES
            console.log('\n🔍 Verificando confirmações de reversão...');
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchAlerts = await processBatch(batch, monitorConfirmation, learningSystem);
                
                // Enviar alertas do batch
                for (const alert of batchAlerts) {
                    console.log(`\n✅ CONFIRMAÇÃO DETECTADA PARA ${alert.symbol}!`);
                    console.log(`📊 ${alert.signal} - Preço: $${alert.priceFormatted}`);
                    console.log(`📈 Score: ${alert.qualityScore.grade} (${alert.qualityScore.score}/100)`);
                    console.log(`📊 ADX 15m: ${alert.adx15m.adx} (${alert.adx15m.strength})`);
                    console.log(`📊 ADX 1h: ${alert.adx1h.adx} (${alert.adx1h.strength})`);
                    
                    logToFile(`ALERTA CONFIRMAÇÃO ${alert.signal} - ${alert.symbol} - Preço: $${alert.price} - Score: ${alert.qualityScore.score} - ADX15m: ${alert.adx15m.adx} - ADX1h: ${alert.adx1h.adx}`);
                    
                    await sendAlert(alert.message);
                    
                    confirmationAlertsSent++;
                    
                    // Pequena pausa entre alertas
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                // Pequena pausa entre lotes
                if (i + BATCH_SIZE < SYMBOLS.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (sweepsDetected > 0) {
                console.log(`\n🔍 ${sweepsDetected} sweep(s) detectado(s) (sem alerta)`);
            }
            if (confirmationAlertsSent > 0) {
                console.log(`📊 Total de ${confirmationAlertsSent} alerta(s) de CONFIRMAÇÃO enviado(s) nesta verificação`);
            }
            if (sweepsDetected === 0 && confirmationAlertsSent === 0) {
                console.log(' ✓ Nenhuma confirmação detectada');
            }

            // 🔵 LIMPEZA DE CACHES
            cleanupCaches();
            
            // Resetar rate limit counter se passou um minuto
            if (Date.now() - rateLimitCounter.windowStart >= 60000) {
                rateLimitCounter.windowStart = Date.now();
                rateLimitCounter.usedWeight = 0;
                rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
            }

            consecutiveErrors = 0;
            
            console.log(`\n⏱️  Próxima verificação em 60 segundos...`);
            
            // Verificação a cada 1 minuto
            await new Promise(r => setTimeout(r, 60000));

        } catch (e) {
            consecutiveErrors++;
            const errorMsg = `Erro no loop principal (${consecutiveErrors}): ${e.message}`;
            console.log(`\n❌ ${errorMsg}`);
            logToFile(`❌ ${errorMsg}`);
            
            const waitTime = Math.min(10000 * consecutiveErrors, 60000);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

// 🔵 FUNÇÃO ATUALIZADA: Iniciar bot
async function startBot() {
    try {
        initLogSystem();
        
        // Inicializar sistema de aprendizado
        const learningSystem = new LearningSystem();
        
        logToFile('🔍 Verificando conexão inicial...');
        console.log('🔍 Verificando conexão inicial...');
        
        const isConnected = await checkInternetConnection();
        if (!isConnected) {
            console.log('🌐 Sem conexão inicial, tentando reconectar...');
            const reconnected = await reconnectWithBackoff();
            if (!reconnected) {
                throw new Error('Não foi possível estabelecer conexão inicial');
            }
        }
        
        await mainBotLoop(learningSystem);
        
    } catch (error) {
        const crashMsg = `🚨 BOT CRASHED: ${error.message}`;
        console.error(`\n${crashMsg}`);
        logToFile(`🚨 ${crashMsg}`);
        
        console.log('🔄 Reiniciando bot em 60 segundos...');
        logToFile('🔄 Reiniciando bot em 60 segundos...');
        
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
    }
}

// Iniciar o bot
console.log('\n' + '='.repeat(80));
console.log('🤖 BOT DE CONFIRMAÇÕES SMC 1H (TODOS OS PARES BINANCE FUTURES)');
console.log('='.repeat(80) + '\n');

// Verificar dependências
try {
    require('technicalindicators');
} catch (e) {
    console.log('⚠️ technicalindicators não encontrado. Instale com: npm install technicalindicators');
    process.exit(1);
}

startBot();
