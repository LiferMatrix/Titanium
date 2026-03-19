// =====================================================================
// DEMA ATR STRATEGY - BINANCE FUTURES (SOMENTE ALERTAS) - VERSÃO SEM FILTRADOS
// =====================================================================
const ccxt = require('ccxt');
const technicalIndicators = require('technicalindicators');
const NodeCache = require('node-cache');

// =====================================================================
// CONFIGURAÇÕES
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyz
        CHAT_ID: '-100255
    },
    TRADING: {
        TIMEFRAME: '3m',
        SCAN_INTERVAL: 3,
        DEMA_PERIOD: 55,
        DEMA_TREND_PERIOD: 200,
        ATR_PERIOD: 20,
        ATR_FACTOR: 1.20,
        MIN_VOLUME_24H: 0,
        MIN_VOLATILITY: 0.5,
        MAX_VOLATILITY: 5.0,
        TOP_COINS_COUNT: 40,
        
        // Filtros de sinal
        REQUIRE_CANDLE_CONFIRMATION: true,
        REQUIRE_TREND_FILTER: true,
        MIN_PULLBACK_PERCENT: 0.5,
        
        // Configurações de Volume
        VOLUME_MA_PERIOD: 9,
        VOLUME_ANORMAL_MULTIPLIER: 1.4,
        VOLUME_DIRECTIONAL_THRESHOLD: 0.6,
        VOLUME_SEND_FILTERED_ALERTS: false, // DESATIVADO - não envia mais alertas de sinais filtrados
        
        // Clusters de liquidez
        LIQUIDITY_CLUSTER_PERIOD: 100,
        LIQUIDITY_THRESHOLD: 0.05,
        LIQUIDITY_MIN_CLUSTER_SIZE: 3,
        
        // Stop Loss
        SL_ATR_MULTIPLIER: 2.5,
        SL_USE_CONSERVATIVE: true,
        SL_MIN_DISTANCE: 0.5,
        SL_MAX_DISTANCE: 3.0,
        
        // Take Profit
        TP_CLUSTER_LEVELS: 3,
        TP_CLUSTER_WEIGHTS: [0.3, 0.3, 0.4],
        TP_MIN_DISTANCE_PERCENT: 1.0,
        TP_ATR_MULTIPLIERS: [2.5, 4.5, 6.5],
        
        // Limites de alertas
        MAX_ALERTS_PER_DAY_PER_SYMBOL: 5,
        ALERT_COOLDOWN_MINUTES: 5
    },
    CACHE: {
        OHLCV_TTL: 60,
        TICKER_TTL: 300,
        MARKETS_TTL: 3600000,
        CHECK_PERIOD: 120
    },
    BATCH: {
        SIZE: 5,
        DELAY_MS: 1500
    },
    FORMAT: {
        DATE_FORMAT: 'pt-BR',
        TIME_ZONE: 'America/Sao_Paulo'
    }
};

// =====================================================================
// FUNÇÃO PARA FORMATAR DATA/HORA
// =====================================================================
function getCurrentFormattedTime() {
    return new Date().toLocaleString(CONFIG.FORMAT.DATE_FORMAT, { 
        timeZone: CONFIG.FORMAT.TIME_ZONE,
        dateStyle: 'short',
        timeStyle: 'medium'
    });
}

function getCurrentDate() {
    return new Date().toLocaleDateString(CONFIG.FORMAT.DATE_FORMAT, { 
        timeZone: CONFIG.FORMAT.TIME_ZONE 
    });
}

function getCurrentTime() {
    return new Date().toLocaleTimeString(CONFIG.FORMAT.DATE_FORMAT, { 
        timeZone: CONFIG.FORMAT.TIME_ZONE,
        timeStyle: 'medium'
    });
}

// =====================================================================
// INICIALIZAÇÃO DO CACHE
// =====================================================================
const cache = new NodeCache({ 
    stdTTL: CONFIG.CACHE.OHLCV_TTL,
    checkperiod: CONFIG.CACHE.CHECK_PERIOD,
    useClones: false
});

// =====================================================================
// INICIALIZAÇÃO DA BINANCE FUTURES
// =====================================================================
const exchange = new ccxt.binanceusdm({
    enableRateLimit: true,
    timeout: 30000,
    options: {
        defaultType: 'future'
    }
});

// Cache de markets
let cachedMarkets = null;
let lastMarketsLoad = 0;

// =====================================================================
// INICIALIZAÇÃO DO TELEGRAM
// =====================================================================
let telegram;
try {
    const TelegramBot = require('node-telegram-bot-api');
    telegram = new TelegramBot(CONFIG.TELEGRAM.BOT_TOKEN, { polling: false });
    console.log('✅ Módulo Telegram carregado');
} catch (error) {
    console.error('❌ Erro ao carregar módulo Telegram:', error.message);
    console.log('⚠️ Execute: npm install node-telegram-bot-api');
    process.exit(1);
}

// =====================================================================
// GERENCIAMENTO DE HISTÓRICO DE ALERTAS
// =====================================================================
const alertHistory = {};
let activeSymbols = [];
let lastSymbolsUpdate = 0;
const SYMBOLS_UPDATE_INTERVAL = 12 * 60 * 60 * 1000;

// Reset diário dos contadores
setInterval(() => {
    const today = getCurrentDate();
    let resetCount = 0;
    
    Object.keys(alertHistory).forEach(symbol => {
        if (alertHistory[symbol].lastAlertDate !== today) {
            alertHistory[symbol].signalsToday = 0;
            alertHistory[symbol].lastAlertDate = today;
            resetCount++;
        }
    });
    
    if (resetCount > 0) {
        console.log(`📊 Reset diário: ${resetCount} contadores zerados`);
    }
}, 60 * 60 * 1000);

// =====================================================================
// FUNÇÃO PARA CARREGAR MARKETS
// =====================================================================
async function getMarkets() {
    if (cachedMarkets && (Date.now() - lastMarketsLoad < CONFIG.CACHE.MARKETS_TTL)) {
        return cachedMarkets;
    }
    
    try {
        console.log('🌐 Carregando markets da Binance Futures...');
        const markets = await exchange.loadMarkets();
        cachedMarkets = markets;
        lastMarketsLoad = Date.now();
        console.log(`✅ ${Object.keys(markets).length} markets carregados`);
        return markets;
    } catch (error) {
        console.error('Erro ao carregar markets:', error.message);
        throw error;
    }
}

// =====================================================================
// FUNÇÃO PARA BUSCAR OHLCV
// =====================================================================
async function getCachedOHLCV(symbol, timeframe, limit = 500) {
    const cacheKey = `ohlcv_${symbol}_${timeframe}_${limit}`;
    
    let cachedData = cache.get(cacheKey);
    if (cachedData) {
        return cachedData;
    }
    
    try {
        const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
        cache.set(cacheKey, ohlcv);
        return ohlcv;
    } catch (error) {
        console.error(`Erro ao buscar OHLCV para ${symbol}:`, error.message);
        throw error;
    }
}

// =====================================================================
// FUNÇÃO PARA ANALISAR VOLUME E DIREÇÃO
// =====================================================================
function analyzeVolume(ohlcv, signal) {
    if (!ohlcv || ohlcv.length < CONFIG.TRADING.VOLUME_MA_PERIOD + 5) {
        return {
            isValid: false,
            isAnormal: false,
            volumeRatio: 1.0,
            direction: 'NEUTRO',
            currentVolume: 0,
            avgVolume: 0,
            directionalScore: 0,
            message: 'Dados insuficientes'
        };
    }
    
    try {
        const recentCandles = ohlcv.slice(-15);
        const volumes = recentCandles.map(c => Number(c[5]));
        const currentVolume = volumes[volumes.length - 1];
        
        const prevVolumes = volumes.slice(0, -1);
        const avgVolume = prevVolumes.length >= CONFIG.TRADING.VOLUME_MA_PERIOD
            ? prevVolumes.slice(-CONFIG.TRADING.VOLUME_MA_PERIOD).reduce((a, b) => a + b, 0) / CONFIG.TRADING.VOLUME_MA_PERIOD
            : prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
        
        const volumeRatio = currentVolume / avgVolume;
        const isAnormal = volumeRatio >= CONFIG.TRADING.VOLUME_ANORMAL_MULTIPLIER;
        
        // Analisar direção
        let directionalScore = 0;
        let totalWeight = 0;
        
        for (let i = Math.max(0, recentCandles.length - 3); i < recentCandles.length; i++) {
            const candle = recentCandles[i];
            const isBullish = Number(candle[4]) > Number(candle[1]);
            const candleVolume = Number(candle[5]);
            const volumeStrength = candleVolume / avgVolume;
            const weight = (i === recentCandles.length - 1) ? 1.5 : 1.0;
            
            if (signal === '🟢Compra' && isBullish) {
                directionalScore += volumeStrength * weight;
            } else if (signal === '🔴Correção' && !isBullish) {
                directionalScore += volumeStrength * weight;
            } else {
                directionalScore -= volumeStrength * weight;
            }
            
            totalWeight += weight;
        }
        
        const maxPossibleScore = totalWeight * CONFIG.TRADING.VOLUME_ANORMAL_MULTIPLIER * 2;
        const normalizedScore = Math.max(0, Math.min(1, (directionalScore + maxPossibleScore) / (2 * maxPossibleScore)));
        
        let direction = 'NEUTRO';
        if (normalizedScore >= CONFIG.TRADING.VOLUME_DIRECTIONAL_THRESHOLD) {
            direction = signal === '🟢Compra' ? 'COMPRADOR' : 'VENDEDOR';
        } else if (normalizedScore <= 1 - CONFIG.TRADING.VOLUME_DIRECTIONAL_THRESHOLD) {
            direction = signal === '🟢Compra' ? 'VENDEDOR' : 'COMPRADOR';
        }
        
        const isValid = direction === (signal === '🟢Compra' ? 'COMPRADOR' : 'VENDEDOR') && isAnormal;
        
        let message = '';
        if (isAnormal) {
            if (direction === 'COMPRADOR') {
                message = `🔥 VOLUME COMPRADOR ANORMAL (${(volumeRatio * 100).toFixed(0)}%)`;
            } else if (direction === 'VENDEDOR') {
                message = `💥 VOLUME VENDEDOR ANORMAL (${(volumeRatio * 100).toFixed(0)}%)`;
            } else {
                message = `⚠️ VOLUME ANORMAL (${(volumeRatio * 100).toFixed(0)}%)`;
            }
        } else {
            message = `📊 Volume ${(volumeRatio * 100).toFixed(0)}%`;
        }
        
        const directionalEmoji = normalizedScore >= 0.8 ? '🔴' : normalizedScore >= 0.6 ? '🟡' : '🟢';
        
        return {
            isValid,
            isAnormal,
            volumeRatio,
            direction,
            directionalScore: normalizedScore,
            currentVolume,
            avgVolume,
            message: `${message} ${directionalEmoji}`
        };
        
    } catch (error) {
        console.error('Erro na análise de volume:', error.message);
        return {
            isValid: false,
            isAnormal: false,
            volumeRatio: 1.0,
            direction: 'NEUTRO',
            currentVolume: 0,
            avgVolume: 0,
            directionalScore: 0,
            message: 'Erro na análise'
        };
    }
}

// =====================================================================
// FUNÇÃO PARA DETECTAR CLUSTERS DE LIQUIDEZ
// =====================================================================
function detectLiquidityClusters(highs, lows, closes, volumes, period = 100) {
    try {
        if (highs.length < period || lows.length < period) {
            return { 
                support: null, 
                resistance: null, 
                clusterLevels: [], 
                swingHighs: [], 
                swingLows: [],
                allClusters: [],
                hasValidClusters: false
            };
        }
        
        const recentHighs = highs.slice(-period);
        const recentLows = lows.slice(-period);
        const recentCloses = closes.slice(-period);
        const recentVolumes = volumes.slice(-period);
        const currentPrice = closes[closes.length - 1];
        
        const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        
        const swingHighs = [];
        const swingLows = [];
        
        for (let i = 2; i < recentHighs.length - 2; i++) {
            if (recentHighs[i] > recentHighs[i-1] && 
                recentHighs[i] > recentHighs[i-2] &&
                recentHighs[i] > recentHighs[i+1] && 
                recentHighs[i] > recentHighs[i+2]) {
                
                const volumeWeight = Math.log(recentVolumes[i] + 1) / Math.log(avgVolume + 1);
                swingHighs.push({
                    price: recentHighs[i],
                    weight: 2.0 + volumeWeight,
                });
            }
            
            if (recentLows[i] < recentLows[i-1] && 
                recentLows[i] < recentLows[i-2] &&
                recentLows[i] < recentLows[i+1] && 
                recentLows[i] < recentLows[i+2]) {
                
                const volumeWeight = Math.log(recentVolumes[i] + 1) / Math.log(avgVolume + 1);
                swingLows.push({
                    price: recentLows[i],
                    weight: 2.0 + volumeWeight,
                });
            }
        }
        
        const allPrices = [
            ...swingHighs.map(s => ({ price: s.price, weight: s.weight, type: 'swingHigh' })),
            ...swingLows.map(s => ({ price: s.price, weight: s.weight, type: 'swingLow' }))
        ];
        
        for (let i = recentHighs.length - 10; i < recentHighs.length; i++) {
            if (i >= 0) {
                const volumeWeight = Math.log(recentVolumes[i] + 1) / Math.log(avgVolume + 1);
                allPrices.push({ price: recentHighs[i], weight: 0.8 + volumeWeight, type: 'recentHigh' });
                allPrices.push({ price: recentLows[i], weight: 0.8 + volumeWeight, type: 'recentLow' });
            }
        }
        
        const avgPrice = (Math.max(...recentHighs) + Math.min(...recentLows)) / 2;
        const percentTolerance = CONFIG.TRADING.LIQUIDITY_THRESHOLD / 100;
        const tolerance = avgPrice * percentTolerance;
        
        const clusters = [];
        
        allPrices.forEach(item => {
            let foundCluster = false;
            
            for (let cluster of clusters) {
                if (Math.abs(cluster.avgPrice - item.price) <= tolerance) {
                    cluster.prices.push(item.price);
                    cluster.weights.push(item.weight);
                    cluster.totalWeight += item.weight;
                    
                    let sumWeighted = 0;
                    let sumWeights = 0;
                    for (let i = 0; i < cluster.prices.length; i++) {
                        sumWeighted += cluster.prices[i] * cluster.weights[i];
                        sumWeights += cluster.weights[i];
                    }
                    cluster.avgPrice = sumWeighted / sumWeights;
                    cluster.count++;
                    foundCluster = true;
                    break;
                }
            }
            
            if (!foundCluster) {
                clusters.push({
                    prices: [item.price],
                    weights: [item.weight],
                    avgPrice: item.price,
                    totalWeight: item.weight,
                    count: 1
                });
            }
        });
        
        const validClusters = clusters
            .filter(c => c.count >= CONFIG.TRADING.LIQUIDITY_MIN_CLUSTER_SIZE)
            .sort((a, b) => b.totalWeight - a.totalWeight)
            .map(c => ({
                price: c.avgPrice,
                strength: Math.min(c.totalWeight / (period * 1.5), 1.0),
                touches: c.count
            }));
        
        const clustersAbove = validClusters
            .filter(c => c.price > currentPrice)
            .sort((a, b) => a.price - b.price);
        
        const clustersBelow = validClusters
            .filter(c => c.price < currentPrice)
            .sort((a, b) => b.price - a.price);
        
        const support = clustersBelow.length > 0 ? clustersBelow[0].price : null;
        const resistance = clustersAbove.length > 0 ? clustersAbove[0].price : null;
        
        return {
            support,
            resistance,
            clusterLevels: validClusters.slice(0, 5),
            clustersAbove: clustersAbove.slice(0, 5),
            clustersBelow: clustersBelow.slice(0, 5),
            swingHighs: swingHighs.map(s => s.price).slice(-5),
            swingLows: swingLows.map(s => s.price).slice(-5),
            hasValidClusters: validClusters.length > 0,
            currentPrice
        };
        
    } catch (error) {
        console.error('Erro no cálculo de clusters:', error.message);
        return { 
            support: null, 
            resistance: null, 
            clusterLevels: [], 
            clustersAbove: [],
            clustersBelow: [],
            swingHighs: [], 
            swingLows: [],
            hasValidClusters: false
        };
    }
}

// =====================================================================
// FUNÇÃO PARA CALCULAR ALVOS
// =====================================================================
function calculateClusterTargets(position, entryPrice, liquidityClusters, atrValue) {
    const targets = [];
    
    if (!liquidityClusters) return targets;
    
    if (position === 'LONG') {
        const clustersAbove = liquidityClusters.clustersAbove || [];
        
        for (let i = 0; i < Math.min(3, clustersAbove.length); i++) {
            const cluster = clustersAbove[i];
            const distancePercent = ((cluster.price - entryPrice) / entryPrice) * 100;
            
            if (distancePercent >= CONFIG.TRADING.TP_MIN_DISTANCE_PERCENT) {
                targets.push({
                    price: cluster.price,
                    type: 'Cluster',
                    distance: distancePercent,
                    strength: cluster.strength,
                    touches: cluster.touches,
                    level: i + 1
                });
            }
        }
        
        if (targets.length < 3) {
            const atrMultipliers = CONFIG.TRADING.TP_ATR_MULTIPLIERS;
            for (let i = targets.length; i < 3; i++) {
                const multiplier = atrMultipliers[i];
                const price = entryPrice + (atrValue * multiplier);
                const distancePercent = ((price - entryPrice) / entryPrice) * 100;
                targets.push({
                    price: price,
                    type: 'ATR',
                    distance: distancePercent,
                    multiplier: multiplier,
                    level: i + 1
                });
            }
        }
        
    } else {
        const clustersBelow = liquidityClusters.clustersBelow || [];
        
        for (let i = 0; i < Math.min(3, clustersBelow.length); i++) {
            const cluster = clustersBelow[i];
            const distancePercent = ((entryPrice - cluster.price) / entryPrice) * 100;
            
            if (distancePercent >= CONFIG.TRADING.TP_MIN_DISTANCE_PERCENT) {
                targets.push({
                    price: cluster.price,
                    type: 'Cluster',
                    distance: distancePercent,
                    strength: cluster.strength,
                    touches: cluster.touches,
                    level: i + 1
                });
            }
        }
        
        if (targets.length < 3) {
            const atrMultipliers = CONFIG.TRADING.TP_ATR_MULTIPLIERS;
            for (let i = targets.length; i < 3; i++) {
                const multiplier = atrMultipliers[i];
                const price = entryPrice - (atrValue * multiplier);
                const distancePercent = ((entryPrice - price) / entryPrice) * 100;
                targets.push({
                    price: price,
                    type: 'ATR',
                    distance: distancePercent,
                    multiplier: multiplier,
                    level: i + 1
                });
            }
        }
    }
    
    return targets.sort((a, b) => a.distance - b.distance).slice(0, 3);
}

// =====================================================================
// FUNÇÃO PARA STOP LOSS
// =====================================================================
function calculateStopLoss(position, entryPrice, atrValue, liquidityClusters) {
    if (!position || !entryPrice || !atrValue) return null;
    
    const atrStop = position === 'LONG' 
        ? entryPrice - (atrValue * CONFIG.TRADING.SL_ATR_MULTIPLIER)
        : entryPrice + (atrValue * CONFIG.TRADING.SL_ATR_MULTIPLIER);
    
    let clusterStop = null;
    
    if (position === 'LONG' && liquidityClusters?.clustersBelow?.length > 0) {
        clusterStop = liquidityClusters.clustersBelow[0].price;
    }
    
    if (position === 'SHORT' && liquidityClusters?.clustersAbove?.length > 0) {
        clusterStop = liquidityClusters.clustersAbove[0].price;
    }
    
    let finalStop = clusterStop 
        ? (position === 'LONG' ? Math.max(atrStop, clusterStop) : Math.min(atrStop, clusterStop))
        : atrStop;
    
    const stopDistance = position === 'LONG' 
        ? ((entryPrice - finalStop) / entryPrice) * 100
        : ((finalStop - entryPrice) / entryPrice) * 100;
    
    if (stopDistance < CONFIG.TRADING.SL_MIN_DISTANCE) {
        finalStop = position === 'LONG'
            ? entryPrice * (1 - CONFIG.TRADING.SL_MIN_DISTANCE / 100)
            : entryPrice * (1 + CONFIG.TRADING.SL_MIN_DISTANCE / 100);
    } else if (stopDistance > CONFIG.TRADING.SL_MAX_DISTANCE) {
        finalStop = position === 'LONG'
            ? entryPrice * (1 - CONFIG.TRADING.SL_MAX_DISTANCE / 100)
            : entryPrice * (1 + CONFIG.TRADING.SL_MAX_DISTANCE / 100);
    }
    
    return finalStop;
}

// =====================================================================
// FUNÇÃO PARA BUSCAR MOEDAS
// =====================================================================
async function getTopLiquidSymbols() {
    try {
        console.log('🔄 Buscando contratos USDT Perpetual...');
        
        const markets = await getMarkets();
        
        const usdtPerps = Object.keys(markets).filter(symbol => {
            const m = markets[symbol];
            return m.swap && m.linear && m.quote === 'USDT' && m.active;
        });
        
        console.log(`📊 Encontrados ${usdtPerps.length} contratos`);
        
        if (usdtPerps.length === 0) {
            return getDefaultSymbols();
        }
        
        const symbolsToCheck = usdtPerps.slice(0, 80);
        const symbolsWithVolatility = [];
        
        for (let i = 0; i < symbolsToCheck.length; i++) {
            const symbol = symbolsToCheck[i];
            
            try {
                const ohlcv = await getCachedOHLCV(symbol, '15m', 20);
                
                if (ohlcv?.length >= 10) {
                    const closes = ohlcv.map(c => c[4]);
                    const highs = ohlcv.map(c => c[2]);
                    const lows = ohlcv.map(c => c[3]);
                    
                    let totalVolatility = 0;
                    for (let j = 0; j < closes.length; j++) {
                        totalVolatility += ((highs[j] - lows[j]) / closes[j]) * 100;
                    }
                    const avgVolatility = totalVolatility / closes.length;
                    
                    if (avgVolatility >= CONFIG.TRADING.MIN_VOLATILITY && 
                        avgVolatility <= CONFIG.TRADING.MAX_VOLATILITY) {
                        symbolsWithVolatility.push({
                            symbol: symbol,
                            volatility: avgVolatility
                        });
                    }
                }
                
                if ((i + 1) % 20 === 0) {
                    console.log(`📊 Processados ${i + 1}/${symbolsToCheck.length}`);
                }
                
            } catch (error) {
                continue;
            }
        }
        
        symbolsWithVolatility.sort((a, b) => b.volatility - a.volatility);
        
        const topSymbols = symbolsWithVolatility
            .slice(0, CONFIG.TRADING.TOP_COINS_COUNT)
            .map(item => item.symbol);
        
        console.log(`✅ Selecionados ${topSymbols.length} contratos`);
        
        return topSymbols.length > 0 ? topSymbols : getDefaultSymbols();
        
    } catch (error) {
        console.error('Erro ao buscar contratos:', error.message);
        return getDefaultSymbols();
    }
}

// =====================================================================
// LISTA PADRÃO DE MOEDAS
// =====================================================================
function getDefaultSymbols() {
    return [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
        'DOGEUSDT', 'ADAUSDT', 'TRXUSDT', 'LINKUSDT', 'AVAXUSDT',
        'DOTUSDT', 'POLUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT',
        'UNIUSDT', 'ETCUSDT', 'XLMUSDT', 'ICPUSDT', 'FILUSDT',
        'APTUSDT', 'NEARUSDT', 'ALGOUSDT', 'VETUSDT', 'GALAUSDT',
        'SANDUSDT', 'EGLDUSDT', 'THETAUSDT', 'AXSUSDT', 'APEUSDT',
        'MANAUSDT', 'ONDOUSDT', 'AAVEUSDT', 'KAVAUSDT', 'GRTUSDT',
        'RUNEUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT',
        'WIFUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 'ORDIUSDT',
        'TIAUSDT', 'PYTHUSDT', 'JUPUSDT', 'JTOUSDT', 'STRKUSDT'
    ];
}

// =====================================================================
// FUNÇÃO PARA ATUALIZAR LISTA DE MOEDAS
// =====================================================================
async function updateActiveSymbols() {
    try {
        const symbols = await getTopLiquidSymbols();
        activeSymbols = symbols;
        
        const today = getCurrentDate();
        
        symbols.forEach(symbol => {
            if (!alertHistory[symbol]) {
                alertHistory[symbol] = {
                    lastSignal: null,
                    lastAlertTime: 0,
                    signalsToday: 0,
                    lastAlertDate: today
                };
            }
        });
        
        Object.keys(alertHistory).forEach(symbol => {
            if (!symbols.includes(symbol)) delete alertHistory[symbol];
        });
        
        lastSymbolsUpdate = Date.now();
        
        console.log(`📊 Lista atualizada: ${symbols.length} contratos`);
        
    } catch (error) {
        console.error('Erro ao atualizar símbolos:', error.message);
        if (activeSymbols.length === 0) activeSymbols = getDefaultSymbols();
    }
}

// =====================================================================
// INDICADORES TÉCNICOS
// =====================================================================

function calculateDEMA(prices, period) {
    if (prices.length < period * 2) return null;
    
    try {
        const ema1 = technicalIndicators.EMA.calculate({ period, values: prices });
        if (ema1.length < period) return null;
        
        const ema2 = technicalIndicators.EMA.calculate({ period, values: ema1 });
        if (ema2.length === 0) return null;
        
        const dema = [];
        for (let i = 0; i < ema2.length; i++) {
            dema.push(2 * ema1[i + (ema1.length - ema2.length)] - ema2[i]);
        }
        
        return dema;
    } catch (error) {
        console.error('Erro no cálculo DEMA:', error.message);
        return null;
    }
}

function calculateATR(highs, lows, closes, period) {
    if (highs.length < period + 1) return null;
    
    try {
        return technicalIndicators.ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: period
        });
    } catch (error) {
        console.error('Erro no cálculo ATR:', error.message);
        return null;
    }
}

// =====================================================================
// DETECÇÃO DE SINAL
// =====================================================================
function detectSignal(prices, dema, demaTrend) {
    if (!prices || prices.length < 4 || !dema || dema.length < 3) {
        return { signal: null, demaValue: null };
    }
    
    const signalPrice = prices[prices.length - 2];
    const previousPrice = prices[prices.length - 3];
    const previousPrice2 = prices[prices.length - 4];
    
    const signalDEMA = dema[dema.length - 2];
    const previousDEMA = dema[dema.length - 3];
    
    const currentPrice = prices[prices.length - 1];
    const currentDEMATrend = demaTrend?.[demaTrend.length - 1];
    
    if (!signalDEMA || !previousDEMA) return { signal: null, demaValue: signalDEMA };
    
    let trendFilter = true;
    if (CONFIG.TRADING.REQUIRE_TREND_FILTER && currentDEMATrend) {
        trendFilter = currentPrice > currentDEMATrend ? 'LONG' : 'SHORT';
    }
    
    let pullbackConfirmed = true;
    if (CONFIG.TRADING.MIN_PULLBACK_PERCENT > 0) {
        const distanceToDEMA = Math.abs(currentPrice - signalDEMA) / signalDEMA * 100;
        pullbackConfirmed = distanceToDEMA <= CONFIG.TRADING.MIN_PULLBACK_PERCENT * 2;
    }
    
    const longCondition = (
        previousPrice <= previousDEMA && 
        signalPrice > signalDEMA && 
        (trendFilter === true || trendFilter === 'LONG') &&
        pullbackConfirmed
    );
    
    const shortCondition = (
        previousPrice >= previousDEMA && 
        signalPrice < signalDEMA && 
        (trendFilter === true || trendFilter === 'SHORT') &&
        pullbackConfirmed
    );
    
    if (longCondition && previousPrice2 <= previousDEMA * 1.01) {
        return { signal: '🟢Compra', demaValue: signalDEMA };
    }
    
    if (shortCondition && previousPrice2 >= previousDEMA * 0.99) {
        return { signal: '🔴Correção', demaValue: signalDEMA };
    }
    
    return { signal: null, demaValue: signalDEMA };
}

// =====================================================================
// ANÁLISE PRINCIPAL - SEM NOTIFICAÇÕES DE FILTRADOS
// =====================================================================
async function analyzeSymbol(symbol) {
    try {
        const ohlcv = await getCachedOHLCV(symbol, CONFIG.TRADING.TIMEFRAME, 500);
        
        if (!ohlcv || ohlcv.length < 200) return;
        
        const closes = ohlcv.map(c => c[4]);
        const highs = ohlcv.map(c => c[2]);
        const lows = ohlcv.map(c => c[3]);
        const volumes = ohlcv.map(c => c[5]);
        const currentPrice = closes[closes.length - 1];
        const currentTime = getCurrentTime();
        
        const dema = calculateDEMA(closes, CONFIG.TRADING.DEMA_PERIOD);
        const demaTrend = calculateDEMA(closes, CONFIG.TRADING.DEMA_TREND_PERIOD);
        const atrArray = calculateATR(highs, lows, closes, CONFIG.TRADING.ATR_PERIOD);
        
        if (!dema || !atrArray || dema.length < 2) return;
        
        const liquidityClusters = detectLiquidityClusters(
            highs, lows, closes, volumes, 
            CONFIG.TRADING.LIQUIDITY_CLUSTER_PERIOD
        );
        
        const { signal } = detectSignal(closes, dema, demaTrend);
        const volumeAnalysis = analyzeVolume(ohlcv, signal);
        
        const alertInfo = alertHistory[symbol];
        if (!alertInfo) return;
        
        const cooldownMinutes = (Date.now() - alertInfo.lastAlertTime) / (60 * 1000);
        const cooldownOk = cooldownMinutes >= CONFIG.TRADING.ALERT_COOLDOWN_MINUTES;
        const signalChanged = alertInfo.lastSignal !== signal;
        const alertsLimitOk = alertInfo.signalsToday < CONFIG.TRADING.MAX_ALERTS_PER_DAY_PER_SYMBOL;
        
        // Critério de volume: exige direção correta E volume anormal
        const volumeCriterioOk = signal && volumeAnalysis.isValid;
        
        if (!alertsLimitOk && signal && signalChanged) {
            console.log(`⚠️ Limite diário atingido para ${symbol}`);
        }
        
        // SÓ ENVIA ALERTA SE TODOS OS CRITÉRIOS FOREM ATENDIDOS
        // NÃO envia mais notificações de sinais filtrados
        if (signal && signalChanged && cooldownOk && alertsLimitOk && volumeCriterioOk) {
            alertInfo.lastSignal = signal;
            alertInfo.lastAlertTime = Date.now();
            alertInfo.signalsToday++;
            alertInfo.lastAlertDate = getCurrentDate();
            
            const currentATR = atrArray[atrArray.length - 1] * CONFIG.TRADING.ATR_FACTOR;
            
            const stopLoss = signal === '🟢Compra'
                ? calculateStopLoss('LONG', currentPrice, currentATR, liquidityClusters)
                : calculateStopLoss('SHORT', currentPrice, currentATR, liquidityClusters);
            
            const targets = calculateClusterTargets(
                signal === '🟢Compra' ? 'LONG' : 'SHORT',
                currentPrice,
                liquidityClusters,
                currentATR
            );
            
            const stopDistance = signal === '🟢Compra'
                ? ((currentPrice - stopLoss) / currentPrice) * 100
                : ((stopLoss - currentPrice) / currentPrice) * 100;
            
            const avgTargetDistance = targets.length > 0 
                ? targets.reduce((sum, t) => sum + t.distance, 0) / targets.length 
                : 0;
            
            const riskRewardRatio = stopDistance > 0 && avgTargetDistance > 0
                ? (avgTargetDistance / stopDistance).toFixed(2)
                : 'N/A';
            
            let targetsMessage = '';
            targets.forEach((target, index) => {
                const emoji = target.type === 'Cluster' ? '🔮' : '📊';
                const typeInfo = target.type === 'Cluster' 
                    ? `Cluster (${target.touches}x, ${(target.strength * 100).toFixed(0)}%)`
                    : `ATR ${target.multiplier}x`;
                
                targetsMessage += `_TP${index + 1} ${emoji} ${target.distance.toFixed(2)}%:_ _$${target.price.toFixed(8)}_ _[${typeInfo}]_\n`;
            });
            
            const clustersAboveMsg = liquidityClusters.clustersAbove?.length > 0
                ? liquidityClusters.clustersAbove.slice(0, 3)
                    .map(c => `_$${c.price.toFixed(4)} (${c.touches}x, ${(c.strength * 100).toFixed(0)}%)_`)
                    .join('\n')
                : '_Nenhum cluster de resistência_';
            
            const clustersBelowMsg = liquidityClusters.clustersBelow?.length > 0
                ? liquidityClusters.clustersBelow.slice(0, 3)
                    .map(c => `_$${c.price.toFixed(4)} (${c.touches}x, ${(c.strength * 100).toFixed(0)}%)_`)
                    .join('\n')
                : '_Nenhum cluster de suporte_';
            
            const noClustersWarning = !liquidityClusters.hasValidClusters 
                ? '\n_⚠️ Nenhum cluster significativo no período_' 
                : '';
            
            const alertsLeft = CONFIG.TRADING.MAX_ALERTS_PER_DAY_PER_SYMBOL - alertInfo.signalsToday;
            
            const message = 
                `_🔍 ${signal} - ${symbol}_\n` +
                `_Preço:_ _$${currentPrice.toFixed(8)}_\n` +
                `_Hora:_ _${currentTime}_\n` +
                `_ VOL: ${CONFIG.TRADING.VOLUME_MA_PERIOD}_\n` +
                `_${volumeAnalysis.message}_\n` +
                `_ Alvos (${targets.length}/3):_\n${targetsMessage}\n`+ 
                `_🛑 Stop (${stopDistance.toFixed(2)}%):_ _$${stopLoss.toFixed(8)}_\n` +
                `${noClustersWarning}\n` +
                `_ Resistência:_\n${clustersAboveMsg}\n` +
                `_ Suporte:_\n${clustersBelowMsg}\n\n` +
                `_ Alerta: ${alertInfo.signalsToday}/${CONFIG.TRADING.MAX_ALERTS_PER_DAY_PER_SYMBOL}_\n` +
                `_🤖 Titanium _`;
            
            if (telegram) {
                await telegram.sendMessage(CONFIG.TELEGRAM.CHAT_ID, message, { parse_mode: 'Markdown' });
            }
            
            console.log(`✅ Alerta ${signal} ${symbol} - R:R 1:${riskRewardRatio}`);
        }
        
    } catch (error) {
        console.error(`Erro ao analisar ${symbol}:`, error.message);
    }
}

// =====================================================================
// FUNÇÃO PRINCIPAL
// =====================================================================
async function runBot() {
    console.log('🤖 Bot DEMA-55 ATR - VERSÃO SEM FILTRADOS');
    console.log(`⏰ Scan: ${CONFIG.TRADING.SCAN_INTERVAL}min`);
    console.log(`📊 Moedas: ${CONFIG.TRADING.TOP_COINS_COUNT}`);
    console.log(`📈 Volume MA: ${CONFIG.TRADING.VOLUME_MA_PERIOD}`);
    console.log(`🔥 Volume anormal: >${CONFIG.TRADING.VOLUME_ANORMAL_MULTIPLIER}x`);
    console.log(`🎯 Critério: Volume direcional anormal OBRIGATÓRIO`);
    console.log(`🚫 Notificações de filtrados: DESATIVADAS\n`);
    
    await getMarkets();
    await updateActiveSymbols();
    
    if (telegram) {
        await telegram.sendMessage(
            CONFIG.TELEGRAM.CHAT_ID,
            `_🚀 Bot DEMA-55 ATR INICIADO_\n\n` +
            `_✅ Volume MA ${CONFIG.TRADING.VOLUME_MA_PERIOD}_\n` +
            `_✅ Anormal: >${CONFIG.TRADING.VOLUME_ANORMAL_MULTIPLIER}x_\n` +
            `_✅ ${CONFIG.TRADING.TOP_COINS_COUNT} moedas_\n` +
            `_✅ Limite: ${CONFIG.TRADING.MAX_ALERTS_PER_DAY_PER_SYMBOL}/dia_\n` +
            `_✅ Notificações de filtrados: DESATIVADAS_\n\n` +
            `_📅 ${getCurrentDate()}_`,
            { parse_mode: 'Markdown' }
        );
    }
    
    while (true) {
        const start = Date.now();
        
        try {
            console.log(`🔄 Ciclo iniciado - ${getCurrentTime()}`);
            
            if (Date.now() - lastSymbolsUpdate > SYMBOLS_UPDATE_INTERVAL) {
                await updateActiveSymbols();
            }
            
            for (let i = 0; i < activeSymbols.length; i += CONFIG.BATCH.SIZE) {
                const batch = activeSymbols.slice(i, i + CONFIG.BATCH.SIZE);
                
                await Promise.all(batch.map(async (symbol) => {
                    try {
                        await analyzeSymbol(symbol);
                    } catch (err) {
                        console.error(`❌ Erro em ${symbol}: ${err.message}`);
                    }
                }));
                
                if (i + CONFIG.BATCH.SIZE < activeSymbols.length) {
                    await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH.DELAY_MS));
                }
            }
            
            const duration = (Date.now() - start) / 1000;
            console.log(`✅ Ciclo completo em ${duration.toFixed(1)}s - ${getCurrentTime()}\n`);
            
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.TRADING.SCAN_INTERVAL * 60 * 1000)
            );
            
        } catch (error) {
            console.error('❌ Erro no ciclo:', error);
            await new Promise(resolve => setTimeout(resolve, 60000));
        }
    }
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
(async () => {
    try {
        console.log('🔧 Verificando conexões...');
        
        await exchange.fetchTime();
        console.log('✅ Conectado à Binance Futures');
        
        if (telegram) {
            try {
                await telegram.sendMessage(
                    CONFIG.TELEGRAM.CHAT_ID,
                    `_🟢 Bot conectado - ${getCurrentTime()}_`,
                    { parse_mode: 'Markdown' }
                );
                console.log('✅ Conectado ao Telegram');
            } catch (error) {
                console.log('⚠️ Telegram não configurado');
            }
        }
        
        await runBot();
        
    } catch (error) {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    }
})();

// =====================================================================
// TRATAMENTO DE DESLIGAMENTO
// =====================================================================
process.on('SIGINT', async () => {
    console.log('\n🔴 Desligando bot...');
    
    if (telegram) {
        try {
            await telegram.sendMessage(
                CONFIG.TELEGRAM.CHAT_ID,
                `_🔴 Bot desligado - ${getCurrentTime()}_`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {}
    }
    
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});
