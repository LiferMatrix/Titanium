const fetch = require('node-fetch');
const { RSI, Stochastic } = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURAÇÕES ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// Configurações do fractal (igual ao Pine Script)
const PERIODS = 2;
const FRACTAL_BARS = 3;
const MAX_HISTORICAL_FRACTALS = 20;

// === CONFIGURAÇÕES DE RSI PARA ALERTAS ===
const RSI_BUY_MAX = 62;  // Compra somente com RSI 1h MENOR que 62
const RSI_SELL_MIN = 66; // Venda somente com RSI 1h MAIOR que 66

// === CONFIGURAÇÕES DE CLUSTER ===
const CLUSTER_PROXIMITY_THRESHOLD = 0.005; // 0.5% de proximidade para agrupar níveis
const MIN_CLUSTER_SIZE = 2; // Mínimo de 2 pontos para formar um cluster
const STRONG_CLUSTER_THRESHOLD = 3; // Cluster com 3+ pontos é considerado forte
const MAX_CLUSTERS_TO_SHOW = 3; // Mostrar até 3 clusters de cada tipo

// === OTIMIZAÇÕES DE PERFORMANCE ===
const MIN_DELAY_BETWEEN_SYMBOLS = 7000;
const CACHE_TTL = 120000;
const COOLDOWN = 30 * 60 * 1000;

// Limites de candles
const CANDLE_LIMIT_SWEEP = 200;
const CANDLE_LIMIT_INDICATORS = 50;
const CANDLE_LIMIT_CLUSTER = 200;

// Rate limit
const REQUESTS_PER_MINUTE = 1200;
const REQUEST_WINDOW_MS = 60000;

// === CONFIGURAÇÕES DE LIMPEZA AUTOMÁTICA ===
const CLEANUP_INTERVAL = 60 * 60 * 1000;
const MAX_CACHE_SIZE = 500;
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024;
const MAX_BACKUP_FILES = 5;
const ALERTS_HISTORY_LIMIT = 1000;
const DATA_RETENTION_DAYS = 7;

// === CONFIGURAÇÕES PARA EVITAR ALERTAS REPETIDOS ===
const MIN_PRICE_CHANGE_PERCENT = 0.5;

// === VARIÁVEIS GLOBAIS ===
let requestCount = 0;
let requestWindowStart = Date.now();
let candleCache = new Map();
let fundingRateCache = new Map();
let lsrCache = new Map();
const alertsCooldown = {};
let VALID_SYMBOLS = [];
let totalAlertsSent = 0;
let alertsHistory = [];
let lastCleanup = Date.now();

// Armazenar o último alerta por símbolo para evitar repetições
const lastAlertBySymbol = new Map();

// ============================================
// SISTEMA DE LIMPEZA AUTOMÁTICA
// ============================================

class DataCleanupManager {
    constructor() {
        this.logsDir = path.join(__dirname, 'logs');
        this.backupDir = path.join(__dirname, 'backups');
        this.dataDir = path.join(__dirname, 'data');
    }

    async initialize() {
        const dirs = [this.logsDir, this.backupDir, this.dataDir];
        for (const dir of dirs) {
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch (error) {
                console.log(`⚠️ Não foi possível criar diretório ${dir}: ${error.message}`);
            }
        }
    }

    async cleanupOldLogs() {
        try {
            const files = await fs.readdir(this.logsDir);
            const now = Date.now();
            const retentionTime = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

            for (const file of files) {
                const filePath = path.join(this.logsDir, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > retentionTime) {
                    await fs.unlink(filePath);
                    console.log(`🗑️ Log antigo removido: ${file}`);
                }
            }
        } catch (error) {
            console.log(`⚠️ Erro ao limpar logs antigos: ${error.message}`);
        }
    }

    async rotateLogFile(logFile) {
        try {
            const stats = await fs.stat(logFile).catch(() => null);
            
            if (stats && stats.size > MAX_LOG_FILE_SIZE) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupFile = path.join(this.backupDir, `log_${timestamp}.txt`);
                await fs.rename(logFile, backupFile);
                console.log(`📋 Log rotacionado: ${path.basename(logFile)} -> ${path.basename(backupFile)}`);
                await this.cleanupOldBackups();
            }
        } catch (error) {
            console.log(`⚠️ Erro ao rotacionar log: ${error.message}`);
        }
    }

    async cleanupOldBackups() {
        try {
            const files = await fs.readdir(this.backupDir);
            const backupFiles = files.filter(f => f.startsWith('log_')).sort();
            
            if (backupFiles.length > MAX_BACKUP_FILES) {
                const toDelete = backupFiles.slice(0, backupFiles.length - MAX_BACKUP_FILES);
                for (const file of toDelete) {
                    await fs.unlink(path.join(this.backupDir, file));
                    console.log(`🗑️ Backup antigo removido: ${file}`);
                }
            }
        } catch (error) {
            console.log(`⚠️ Erro ao limpar backups: ${error.message}`);
        }
    }

    cleanupCache() {
        try {
            const now = Date.now();
            let removedCount = 0;
            
            for (const [key, value] of candleCache.entries()) {
                if (now - value.timestamp > CACHE_TTL) {
                    candleCache.delete(key);
                    removedCount++;
                }
            }
            
            for (const [key, value] of fundingRateCache.entries()) {
                if (now - value.timestamp > CACHE_TTL) {
                    fundingRateCache.delete(key);
                    removedCount++;
                }
            }
            
            for (const [key, value] of lsrCache.entries()) {
                if (now - value.timestamp > CACHE_TTL) {
                    lsrCache.delete(key);
                    removedCount++;
                }
            }
            
            if (candleCache.size > MAX_CACHE_SIZE) {
                const sortedEntries = Array.from(candleCache.entries())
                    .sort((a, b) => a[1].timestamp - b[1].timestamp);
                
                const toRemove = sortedEntries.slice(0, candleCache.size - MAX_CACHE_SIZE);
                for (const [key] of toRemove) {
                    candleCache.delete(key);
                    removedCount++;
                }
            }
            
            if (removedCount > 0) {
                console.log(`🧹 Cache limpo: ${removedCount} itens removidos. Cache atual: ${candleCache.size}`);
            }
        } catch (error) {
            console.log(`⚠️ Erro ao limpar cache: ${error.message}`);
        }
    }

    cleanupAlertsHistory() {
        try {
            const now = Date.now();
            const retentionTime = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
            
            alertsHistory = alertsHistory.filter(alert => {
                return (now - alert.timestamp) <= retentionTime;
            });
            
            if (alertsHistory.length > ALERTS_HISTORY_LIMIT) {
                alertsHistory = alertsHistory.slice(-ALERTS_HISTORY_LIMIT);
            }
            
            console.log(`📊 Histórico de alertas: ${alertsHistory.length} registros`);
        } catch (error) {
            console.log(`⚠️ Erro ao limpar histórico de alertas: ${error.message}`);
        }
    }

    cleanupCooldown() {
        try {
            const now = Date.now();
            let removedCount = 0;
            
            for (const [symbol, timestamp] of Object.entries(alertsCooldown)) {
                if (now - timestamp > COOLDOWN) {
                    delete alertsCooldown[symbol];
                    removedCount++;
                }
            }
            
            if (removedCount > 0) {
                console.log(`🧹 Cooldown limpo: ${removedCount} símbolos removidos`);
            }
        } catch (error) {
            console.log(`⚠️ Erro ao limpar cooldown: ${error.message}`);
        }
    }

    cleanupLastAlertHistory() {
        try {
            const now = Date.now();
            const retentionTime = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
            let removedCount = 0;
            
            for (const [symbol, alertData] of lastAlertBySymbol.entries()) {
                if (now - alertData.timestamp > retentionTime) {
                    lastAlertBySymbol.delete(symbol);
                    removedCount++;
                }
            }
            
            if (removedCount > 0) {
                console.log(`🧹 Histórico de últimos alertas limpo: ${removedCount} símbolos removidos`);
            }
        } catch (error) {
            console.log(`⚠️ Erro ao limpar histórico de últimos alertas: ${error.message}`);
        }
    }

    async saveStatistics() {
        try {
            const stats = {
                timestamp: Date.now(),
                totalAlertsSent,
                cacheSize: candleCache.size,
                fundingRateCacheSize: fundingRateCache.size,
                lsrCacheSize: lsrCache.size,
                cooldownSize: Object.keys(alertsCooldown).length,
                alertsHistorySize: alertsHistory.length,
                lastAlertHistorySize: lastAlertBySymbol.size,
                validSymbolsCount: VALID_SYMBOLS.length,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            };
            
            const statsFile = path.join(this.dataDir, `stats_${new Date().toISOString().split('T')[0]}.json`);
            
            const files = await fs.readdir(this.dataDir);
            const statsFiles = files.filter(f => f.startsWith('stats_'));
            
            if (statsFiles.length > DATA_RETENTION_DAYS) {
                const toDelete = statsFiles.slice(0, statsFiles.length - DATA_RETENTION_DAYS);
                for (const file of toDelete) {
                    await fs.unlink(path.join(this.dataDir, file));
                }
            }
            
            await fs.writeFile(statsFile, JSON.stringify(stats, null, 2));
            console.log(`📊 Estatísticas salvas: ${statsFile}`);
        } catch (error) {
            console.log(`⚠️ Erro ao salvar estatísticas: ${error.message}`);
        }
    }

    async performFullCleanup() {
        const startTime = Date.now();
        console.log('\n🧹 INICIANDO LIMPEZA AUTOMÁTICA DE DADOS...');
        
        try {
            this.cleanupCache();
            this.cleanupAlertsHistory();
            this.cleanupCooldown();
            this.cleanupLastAlertHistory();
            await this.cleanupOldLogs();
            await this.saveStatistics();
            
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ LIMPEZA CONCLUÍDA em ${duration}s`);
            console.log(`📊 Estatísticas atuais:`);
            console.log(`   - Cache: ${candleCache.size} itens`);
            console.log(`   - Funding Rate Cache: ${fundingRateCache.size} itens`);
            console.log(`   - LSR Cache: ${lsrCache.size} itens`);
            console.log(`   - Cooldown: ${Object.keys(alertsCooldown).length} símbolos`);
            console.log(`   - Histórico: ${alertsHistory.length} alertas`);
            console.log(`   - Últimos alertas: ${lastAlertBySymbol.size} símbolos`);
            console.log(`   - Total alertas: ${totalAlertsSent}`);
            console.log(`   - Uso de memória: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB\n`);
            
        } catch (error) {
            console.log(`❌ Erro durante limpeza automática: ${error.message}`);
        }
    }
}

const cleanupManager = new DataCleanupManager();

// ============================================
// FUNÇÃO PARA VERIFICAR SE DEVE ENVIAR NOVO ALERTA
// ============================================

function shouldSendAlert(symbol, newAlert) {
    const lastAlert = lastAlertBySymbol.get(symbol);
    
    if (!lastAlert) {
        return true;
    }
    
    const timeSinceLastAlert = Date.now() - lastAlert.timestamp;
    
    if (timeSinceLastAlert >= COOLDOWN) {
        return true;
    }
    
    if (lastAlert.type !== newAlert.type) {
        console.log(`🔄 Mudança de direção detectada em ${symbol}: ${lastAlert.type} -> ${newAlert.type}`);
        return true;
    }
    
    const priceChangePercent = Math.abs((newAlert.fractalLevel - lastAlert.fractalLevel) / lastAlert.fractalLevel) * 100;
    
    if (priceChangePercent >= MIN_PRICE_CHANGE_PERCENT) {
        console.log(`📈 Novo nível detectado em ${symbol}: ${lastAlert.fractalLevel} -> ${newAlert.fractalLevel} (${priceChangePercent.toFixed(2)}% de diferença)`);
        return true;
    }
    
    console.log(`⏭️ Alerta ignorado para ${symbol}: mesmo nível (${newAlert.fractalLevel}) e direção (${newAlert.type}) em menos de ${COOLDOWN/60000} minutos`);
    return false;
}

// ============================================
// FUNÇÃO PARA VERIFICAR CONDIÇÃO DO RSI
// ============================================

function checkRSICondition(rsiValue, alertType) {
    if (rsiValue === 'N/A') {
        console.log(`⚠️ RSI não disponível, ignorando condição`);
        return false;
    }
    
    const rsi = parseFloat(rsiValue);
    
    if (alertType === 'BUY') {
        // Compra: RSI 1h MENOR que 62
        const isValid = rsi < RSI_BUY_MAX;
        console.log(`📊 RSI 1h: ${rsi} | Condição para COMPRA: RSI < ${RSI_BUY_MAX} = ${isValid ? '✅ OK' : '❌ BLOQUEADO'}`);
        return isValid;
    } 
    
    if (alertType === 'SELL') {
        // Venda: RSI 1h MAIOR que 66
        const isValid = rsi > RSI_SELL_MIN;
        console.log(`📊 RSI 1h: ${rsi} | Condição para VENDA: RSI > ${RSI_SELL_MIN} = ${isValid ? '✅ OK' : '❌ BLOQUEADO'}`);
        return isValid;
    }
    
    return false;
}

// ============================================
// OTIMIZAÇÃO DE RATE LIMIT
// ============================================

async function checkRateLimit(weight = 1) {
    const now = Date.now();
    
    if (now - requestWindowStart > REQUEST_WINDOW_MS) {
        requestCount = 0;
        requestWindowStart = now;
    }
    
    if (requestCount + weight > REQUESTS_PER_MINUTE) {
        const waitTime = REQUEST_WINDOW_MS - (now - requestWindowStart) + 1000;
        console.log(`⏳ Rate limit (${requestCount}/${REQUESTS_PER_MINUTE}), aguardando ${Math.round(waitTime/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return checkRateLimit(weight);
    }
    
    requestCount += weight;
    return true;
}

// ============================================
// FUNÇÕES DE API OTIMIZADAS
// ============================================

async function getCandles(symbol, timeframe, limit, skipCache = false) {
    const cacheKey = `${symbol}_${timeframe}_${limit}`;
    
    if (!skipCache) {
        const cached = candleCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }
    
    await checkRateLimit(Math.ceil(limit / 100));
    
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (!Array.isArray(data)) return [];
        
        const candles = data.map(c => ({
            time: c[0],
            open: +c[1],
            high: +c[2],
            low: +c[3],
            close: +c[4],
            volume: +c[5]
        }));
        
        candleCache.set(cacheKey, { data: candles, timestamp: Date.now() });
        return candles;
    } catch (error) {
        return [];
    }
}

async function getCurrentPrice(symbol) {
    await checkRateLimit(1);
    
    try {
        const url = `https://fapi.binance.com/fapi/v1/ticker?symbol=${symbol}`;
        const response = await fetch(url);
        const data = await response.json();
        return { close: parseFloat(data.lastPrice) };
    } catch (error) {
        return { close: 0 };
    }
}

// ============================================
// FUNÇÕES PARA LSR (LONG/SHORT RATIO)
// ============================================

async function getLongShortRatio(symbol) {
    const cacheKey = `lsr_${symbol}`;
    
    const cached = lsrCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    await checkRateLimit(2);
    
    try {
        // Tenta pegar do endpoint de top traders (mais confiável)
        let url = `https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
        let response = await fetch(url);
        let data = await response.json();
        
        if (data && data.length > 0 && data[0].longShortRatio) {
            const ratio = parseFloat(data[0].longShortRatio);
            const result = {
                ratio: ratio.toFixed(3),
                longPercent: ((ratio / (1 + ratio)) * 100).toFixed(1),
                shortPercent: ((1 / (1 + ratio)) * 100).toFixed(1),
                source: 'top_traders'
            };
            lsrCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
        
        // Fallback para o endpoint de posições
        url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`;
        response = await fetch(url);
        data = await response.json();
        
        if (data && data.length > 0 && data[0].longShortRatio) {
            const ratio = parseFloat(data[0].longShortRatio);
            const result = {
                ratio: ratio.toFixed(3),
                longPercent: ((ratio / (1 + ratio)) * 100).toFixed(1),
                shortPercent: ((1 / (1 + ratio)) * 100).toFixed(1),
                source: 'global'
            };
            lsrCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
        
        return { ratio: 'N/A', longPercent: 'N/A', shortPercent: 'N/A', source: 'N/A' };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar LSR para ${symbol}: ${error.message}`);
        return { ratio: 'N/A', longPercent: 'N/A', shortPercent: 'N/A', source: 'N/A' };
    }
}

// ============================================
// FUNÇÕES PARA FUNDING RATE
// ============================================

async function getFundingRate(symbol) {
    const cacheKey = `funding_${symbol}`;
    
    const cached = fundingRateCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    await checkRateLimit(1);
    
    try {
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data && data.lastFundingRate) {
            const fundingRate = parseFloat(data.lastFundingRate) * 100;
            const result = {
                rate: fundingRate.toFixed(4),
                nextFundingTime: data.nextFundingTime,
                isPositive: fundingRate > 0,
                formatted: fundingRate > 0 ? `+${fundingRate.toFixed(4)}%` : `${fundingRate.toFixed(4)}%`
            };
            fundingRateCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        }
        
        return { rate: 'N/A', formatted: 'N/A', isPositive: null };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar Funding Rate para ${symbol}: ${error.message}`);
        return { rate: 'N/A', formatted: 'N/A', isPositive: null };
    }
}

// ============================================
// DETECÇÃO DE CLUSTERS COM CONTAGEM DE TOQUES
// ============================================

function detectPriceClusters(candles, lookbackBars = 200) {
    if (!candles || candles.length < 50) return { supportClusters: [], resistanceClusters: [] };
    
    // Pegar apenas os últimos 'lookbackBars' candles para análise
    const recentCandles = candles.slice(-lookbackBars);
    
    // Coletar todos os níveis de preço relevantes (máximos e mínimos)
    const priceLevels = [];
    
    for (let i = 0; i < recentCandles.length; i++) {
        const candle = recentCandles[i];
        
        // Adicionar máximo (possível resistência)
        priceLevels.push({
            price: candle.high,
            type: 'resistance',
            index: i,
            touches: 1
        });
        
        // Adicionar mínimo (possível suporte)
        priceLevels.push({
            price: candle.low,
            type: 'support',
            index: i,
            touches: 1
        });
        
        // Adicionar fechamento (importante para zonas de valor)
        priceLevels.push({
            price: candle.close,
            type: 'value',
            index: i,
            touches: 1
        });
    }
    
    // Função para agrupar níveis próximos
    function clusterLevels(levels, isSupport) {
        const filteredLevels = levels.filter(l => isSupport ? 
            l.type === 'support' || l.type === 'value' : 
            l.type === 'resistance' || l.type === 'value');
        
        const clusters = [];
        
        for (const level of filteredLevels) {
            let foundCluster = false;
            
            for (const cluster of clusters) {
                const percentDiff = Math.abs((level.price - cluster.centerPrice) / cluster.centerPrice);
                
                if (percentDiff <= CLUSTER_PROXIMITY_THRESHOLD) {
                    cluster.prices.push(level.price);
                    cluster.centerPrice = cluster.prices.reduce((a, b) => a + b, 0) / cluster.prices.length;
                    cluster.touches++;
                    foundCluster = true;
                    break;
                }
            }
            
            if (!foundCluster) {
                clusters.push({
                    centerPrice: level.price,
                    prices: [level.price],
                    touches: 1,
                    type: isSupport ? 'support' : 'resistance'
                });
            }
        }
        
        // Ordenar clusters por número de toques (maior primeiro)
        clusters.sort((a, b) => b.touches - a.touches);
        
        // Filtrar clusters com pelo menos MIN_CLUSTER_SIZE toques
        const strongClusters = clusters.filter(c => c.touches >= MIN_CLUSTER_SIZE);
        
        // Ordenar os clusters por preço (crescente para suporte e decrescente para resistência)
        if (isSupport) {
            strongClusters.sort((a, b) => a.centerPrice - b.centerPrice);
        } else {
            strongClusters.sort((a, b) => b.centerPrice - a.centerPrice);
        }
        
        // Pegar os mais fortes (até MAX_CLUSTERS_TO_SHOW)
        return strongClusters.slice(0, MAX_CLUSTERS_TO_SHOW);
    }
    
    const resistanceClusters = clusterLevels(priceLevels, false);
    const supportClusters = clusterLevels(priceLevels, true);
    
    return { supportClusters, resistanceClusters };
}

// ============================================
// FUNÇÃO PARA DETECTAR PIVÔS (PONTOS DE VIRADA)
// ============================================

function detectPivots(candles) {
    if (!candles || candles.length < 50) return { highPivots: [], lowPivots: [] };
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    
    const highPivots = [];
    const lowPivots = [];
    
    for (let i = 2; i < candles.length - 2; i++) {
        const isHighPivot = highs[i] > highs[i-1] && 
                           highs[i] > highs[i-2] && 
                           highs[i] > highs[i+1] && 
                           highs[i] > highs[i+2];
        
        if (isHighPivot) {
            highPivots.push({
                price: highs[i],
                index: i,
                strength: 1,
                type: 'HIGH_PIVOT'
            });
        }
        
        const isLowPivot = lows[i] < lows[i-1] && 
                          lows[i] < lows[i-2] && 
                          lows[i] < lows[i+1] && 
                          lows[i] < lows[i+2];
        
        if (isLowPivot) {
            lowPivots.push({
                price: lows[i],
                index: i,
                strength: 1,
                type: 'LOW_PIVOT'
            });
        }
    }
    
    const filteredHighPivots = [];
    const filteredLowPivots = [];
    
    for (let i = 0; i < highPivots.length; i++) {
        let isSignificant = true;
        for (let j = 0; j < highPivots.length; j++) {
            if (i !== j && Math.abs(highPivots[i].index - highPivots[j].index) < 5) {
                if (highPivots[j].price > highPivots[i].price) {
                    isSignificant = false;
                    break;
                }
            }
        }
        if (isSignificant) {
            filteredHighPivots.push(highPivots[i]);
        }
    }
    
    for (let i = 0; i < lowPivots.length; i++) {
        let isSignificant = true;
        for (let j = 0; j < lowPivots.length; j++) {
            if (i !== j && Math.abs(lowPivots[i].index - lowPivots[j].index) < 5) {
                if (lowPivots[j].price < lowPivots[i].price) {
                    isSignificant = false;
                    break;
                }
            }
        }
        if (isSignificant) {
            filteredLowPivots.push(lowPivots[i]);
        }
    }
    
    return { 
        highPivots: filteredHighPivots.slice(-MAX_HISTORICAL_FRACTALS),
        lowPivots: filteredLowPivots.slice(-MAX_HISTORICAL_FRACTALS)
    };
}

// ============================================
// FUNÇÃO PARA VERIFICAR SE SWEEP ESTÁ ALINHADO COM PIVÔ
// ============================================

function isSweepAlignedWithPivot(sweep, pivots) {
    if (!sweep || !sweep.isActive) return false;
    
    if (sweep.type === 'BUY') {
        for (const pivot of pivots.highPivots) {
            const priceDifference = Math.abs(sweep.fractalLevel - pivot.price) / pivot.price * 100;
            if (priceDifference <= 0.5) {
                console.log(`✅ Sweep BUY alinhado com Pivô de ALTA em ${pivot.price}`);
                return true;
            }
        }
        console.log(`❌ Sweep BUY NÃO alinhado com nenhum Pivô de ALTA`);
        return false;
    }
    
    if (sweep.type === 'SELL') {
        for (const pivot of pivots.lowPivots) {
            const priceDifference = Math.abs(sweep.fractalLevel - pivot.price) / pivot.price * 100;
            if (priceDifference <= 0.5) {
                console.log(`✅ Sweep SELL alinhado com Pivô de BAIXA em ${pivot.price}`);
                return true;
            }
        }
        console.log(`❌ Sweep SELL NÃO alinhado com nenhum Pivô de BAIXA`);
        return false;
    }
    
    return false;
}

// ============================================
// DETECÇÃO DE SWEEP COM VALIDAÇÃO DE PIVÔS
// ============================================

function detectSweepWithPivotValidation(candles) {
    if (!candles || candles.length < 50) return null;
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const currentIndex = closes.length - 1;
    const currentHigh = highs[currentIndex];
    const currentLow = lows[currentIndex];
    const currentClose = closes[currentIndex];
    
    let dnFractals = [];
    let upFractals = [];
    
    for (let i = PERIODS; i < candles.length - PERIODS - 1; i++) {
        let isDnFractal = false;
        if (FRACTAL_BARS === 3) {
            isDnFractal = highs[i - 1] < highs[i] && highs[i + 1] < highs[i];
        } else if (FRACTAL_BARS === 5) {
            isDnFractal = highs[i - 2] < highs[i] && 
                          highs[i - 1] < highs[i] && 
                          highs[i + 1] < highs[i] && 
                          highs[i + 2] < highs[i];
        }
        
        if (isDnFractal) {
            dnFractals.push({
                price: highs[i],
                index: i,
                barIndex: i
            });
        }
        
        let isUpFractal = false;
        if (FRACTAL_BARS === 3) {
            isUpFractal = lows[i - 1] > lows[i] && lows[i + 1] > lows[i];
        } else if (FRACTAL_BARS === 5) {
            isUpFractal = lows[i - 2] > lows[i] && 
                          lows[i - 1] > lows[i] && 
                          lows[i + 1] > lows[i] && 
                          lows[i + 2] > lows[i];
        }
        
        if (isUpFractal) {
            upFractals.push({
                price: lows[i],
                index: i,
                barIndex: i
            });
        }
    }
    
    if (dnFractals.length > MAX_HISTORICAL_FRACTALS) {
        dnFractals = dnFractals.slice(-MAX_HISTORICAL_FRACTALS);
    }
    if (upFractals.length > MAX_HISTORICAL_FRACTALS) {
        upFractals = upFractals.slice(-MAX_HISTORICAL_FRACTALS);
    }
    
    const pivots = detectPivots(candles);
    
    let sweepDetected = null;
    
    for (let i = 0; i < dnFractals.length; i++) {
        const fractal = dnFractals[i];
        const fractalPrice = fractal.price;
        const fractalIndex = fractal.index;
        
        let limitCount = 0;
        let hasHigherFractal = false;
        
        for (let t = i + 1; t < dnFractals.length; t++) {
            const nextFractal = dnFractals[t];
            if (fractalPrice < nextFractal.price) {
                limitCount = nextFractal.index;
                hasHigherFractal = true;
                break;
            }
        }
        
        if (!hasHigherFractal) {
            limitCount = 0;
        }
        
        let lastWickIndex = -1;
        let wickFound = false;
        let lineActive = false;
        
        for (let j = fractalIndex + 1; j <= currentIndex; j++) {
            if (hasHigherFractal && j >= limitCount) {
                break;
            }
            
            if (highs[j] >= fractalPrice) {
                if (fractalPrice < closes[j]) {
                    break;
                } else {
                    lastWickIndex = j;
                    wickFound = true;
                }
            }
        }
        
        if (wickFound && lastWickIndex === currentIndex) {
            lineActive = true;
        }
        
        if (lineActive) {
            const isSweep = currentHigh >= fractalPrice;
            
            if (isSweep) {
                sweepDetected = {
                    type: 'BUY',
                    price: currentClose,
                    fractalLevel: fractalPrice,
                    fractalIndex: fractalIndex,
                    isActive: true
                };
                break;
            }
        }
    }
    
    if (sweepDetected && sweepDetected.type === 'BUY') {
        const isValid = isSweepAlignedWithPivot(sweepDetected, pivots);
        if (!isValid) {
            console.log(`🚫 Sweep BUY rejeitado: não está alinhado com Pivô de ALTA`);
            return null;
        }
        return sweepDetected;
    }
    
    for (let i = 0; i < upFractals.length; i++) {
        const fractal = upFractals[i];
        const fractalPrice = fractal.price;
        const fractalIndex = fractal.index;
        
        let limitCount = 0;
        let hasLowerFractal = false;
        
        for (let t = i + 1; t < upFractals.length; t++) {
            const nextFractal = upFractals[t];
            if (fractalPrice > nextFractal.price) {
                limitCount = nextFractal.index;
                hasLowerFractal = true;
                break;
            }
        }
        
        if (!hasLowerFractal) {
            limitCount = 0;
        }
        
        let lastWickIndex = -1;
        let wickFound = false;
        let lineActive = false;
        
        for (let j = fractalIndex + 1; j <= currentIndex; j++) {
            if (hasLowerFractal && j >= limitCount) {
                break;
            }
            
            if (lows[j] <= fractalPrice) {
                if (fractalPrice > closes[j]) {
                    break;
                } else {
                    lastWickIndex = j;
                    wickFound = true;
                }
            }
        }
        
        if (wickFound && lastWickIndex === currentIndex) {
            lineActive = true;
        }
        
        if (lineActive) {
            const isSweep = currentLow <= fractalPrice;
            
            if (isSweep) {
                sweepDetected = {
                    type: 'SELL',
                    price: currentClose,
                    fractalLevel: fractalPrice,
                    fractalIndex: fractalIndex,
                    isActive: true
                };
                break;
            }
        }
    }
    
    if (sweepDetected && sweepDetected.type === 'SELL') {
        const isValid = isSweepAlignedWithPivot(sweepDetected, pivots);
        if (!isValid) {
            console.log(`🚫 Sweep SELL rejeitado: não está alinhado com Pivô de BAIXA`);
            return null;
        }
        return sweepDetected;
    }
    
    return null;
}

// ============================================
// INDICADORES SIMPLIFICADOS
// ============================================

async function getIndicators(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', CANDLE_LIMIT_INDICATORS);
        
        let rsiValue = 'N/A';
        if (candles && candles.length > 14) {
            const closes = candles.map(c => c.close);
            const rsiValues = RSI.calculate({ values: closes, period: 14 });
            if (rsiValues && rsiValues.length > 0) {
                rsiValue = rsiValues[rsiValues.length - 1].toFixed(2);
            }
        }
        
        // Buscar LSR e Funding Rate
        const lsr = await getLongShortRatio(symbol);
        const funding = await getFundingRate(symbol);
        
        return {
            rsi1h: { value: rsiValue },
            lsr: lsr,
            funding: funding
        };
    } catch (error) {
        return { 
            rsi1h: { value: 'N/A' },
            lsr: { ratio: 'N/A', longPercent: 'N/A', shortPercent: 'N/A' },
            funding: { rate: 'N/A', formatted: 'N/A' }
        };
    }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function getBrazilianDateTime() {
    const now = new Date();
    const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return {
        date: `${String(brasiliaTime.getDate()).padStart(2, '0')}/${String(brasiliaTime.getMonth() + 1).padStart(2, '0')}/${brasiliaTime.getFullYear()}`,
        time: `${String(brasiliaTime.getHours()).padStart(2, '0')}:${String(brasiliaTime.getMinutes()).padStart(2, '0')}:${String(brasiliaTime.getSeconds()).padStart(2, '0')}`
    };
}

function formatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return 'N/A';
    if (num >= 1000) return num.toFixed(2);
    if (num >= 1) return num.toFixed(3);
    if (num >= 0.1) return num.toFixed(4);
    return num.toFixed(6);
}

function getFundingEmoji(funding) {
    if (!funding || funding.rate === 'N/A') return '⚪';
    const rate = parseFloat(funding.rate);
    if (rate > 0.01) return '🔴';
    if (rate > 0.005) return '🟠';
    if (rate > 0) return '🟡';
    if (rate < -0.01) return '🟢';
    if (rate < -0.005) return '🟢';
    if (rate < 0) return '🟢';
    return '';
}

function getLSREmoji(lsr) {
    if (!lsr || lsr.ratio === 'N/A') return '';
    const ratio = parseFloat(lsr.ratio);
    if (ratio > 3.5) return '💥💥';
    if (ratio > 3.0) return '🔴';
    if (ratio > 2.5) return '🟠';
    if (ratio > 1.5) return '🟡';
    if (ratio > 1.2) return '🟢';
    if (ratio > 0.8) return '🔵';
    return '';
}

// ============================================
// FUNÇÃO DE ENVIO DE ALERTA COM CLUSTERS E RSI
// ============================================

async function sendAlert(symbol, sweep, brDateTime, indicators, supportClusters, resistanceClusters) {
    const isBullish = sweep.type === 'BUY';
    const emoji = isBullish ? '🟢' : '🔴';
    const title = isBullish ? '🔍Analisar Compra' : '🔍Analisar Correção';
    
    const priceFormatted = formatNumber(sweep.price);
    
    // Formatar clusters de suporte em ordem crescente
    let supportText = '';
    if (supportClusters && supportClusters.length > 0) {
        const supportStrings = supportClusters.map(cluster => 
            `$${formatNumber(cluster.centerPrice)} (${cluster.touches}x)`
        );
        supportText = `Suporte: ${supportStrings.join(' | ')}`;
    } else {
        supportText = `Suporte: N/A`;
    }
    
    // Formatar clusters de resistência em ordem crescente
    let resistanceText = '';
    if (resistanceClusters && resistanceClusters.length > 0) {
        const sortedResistance = [...resistanceClusters].sort((a, b) => a.centerPrice - b.centerPrice);
        const resistanceStrings = sortedResistance.map(cluster => 
            `$${formatNumber(cluster.centerPrice)} (${cluster.touches}x)`
        );
        resistanceText = `Resistência: ${resistanceStrings.join(' | ')}`;
    } else {
        resistanceText = `Resistência: N/A`;
    }
    
    // Formatar LSR
    const lsr = indicators.lsr;
    const lsrEmoji = getLSREmoji(lsr);
    let lsrText = '';
    if (lsr && lsr.ratio !== 'N/A') {
        lsrText = `${lsrEmoji} LSR: ${lsr.ratio} (${lsr.longPercent}% L / ${lsr.shortPercent}% S)`;
    } else {
        lsrText = `⚪ LSR: N/A`;
    }
    
    // Formatar Funding Rate
    const funding = indicators.funding;
    const fundingEmoji = getFundingEmoji(funding);
    let fundingText = '';
    if (funding && funding.rate !== 'N/A') {
        fundingText = `${fundingEmoji} Funding: ${funding.formatted}`;
    } else {
        fundingText = `⚪ Funding: N/A`;
    }
    
    const lastAlert = lastAlertBySymbol.get(symbol);
    let directionChangeNote = '';
    if (lastAlert && lastAlert.type !== sweep.type) {
        directionChangeNote = '\n🔄 <i>Swing!</i>';
    }
    
    const message = `<i>${emoji} ${title} - ${symbol} - $${priceFormatted}</i>\n\n` +
                   `<i>Data/Hora: ${brDateTime.date} ${brDateTime.time}hs</i>\n` +
                   `<i>RSI 1h: ${indicators.rsi1h.value}</i>\n` +
                   `<i>${lsrText}</i>\n` +
                   `<i>${fundingText}</i>${directionChangeNote}\n` +
                    `<i>Níveis Importantes:</i>\n` +
                   `<i>🔹${supportText}</i>\n` +
                   `<i>🔻${resistanceText}</i>\n` +
                   `<i>🤖 Titanium Hunter!</i>`;
    
    const sent = await sendTelegramMessage(message);
    
    if (sent) {
        console.log(`✅ ALERTA ENVIADO! ${symbol} - ${sweep.type} - Preço: ${sweep.price} | Fractal: ${sweep.fractalLevel}`);
        console.log(`   📊 RSI 1h: ${indicators.rsi1h.value} | LSR: ${lsr.ratio} | Funding: ${funding.formatted}`);
        totalAlertsSent++;
        
        alertsHistory.push({
            timestamp: Date.now(),
            symbol,
            type: sweep.type,
            price: sweep.price,
            fractalLevel: sweep.fractalLevel,
            rsiValue: indicators.rsi1h.value,
            brDateTime,
            supportClusters,
            resistanceClusters,
            lsr: lsr,
            funding: funding
        });
        
        lastAlertBySymbol.set(symbol, {
            type: sweep.type,
            price: sweep.price,
            fractalLevel: sweep.fractalLevel,
            timestamp: Date.now(),
            direction: sweep.type,
            rsiValue: indicators.rsi1h.value,
            lsr: lsr,
            funding: funding
        });
        
        return true;
    } else {
        console.log(`❌ FALHA AO ENVIAR ALERTA! ${symbol}`);
        return false;
    }
}

async function sendTelegramMessage(message) {
    try {
        await checkRateLimit(1);
        
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });
        
        const result = await response.json();
        return response.ok && result.ok;
    } catch (error) {
        return false;
    }
}

// ============================================
// PROCESSAR SÍMBOLO COM VALIDAÇÃO DE RSI
// ============================================

async function processSymbol(symbol) {
    const now = Date.now();
    
    try {
        const lastAlert = alertsCooldown[symbol];
        if (lastAlert && now - lastAlert < COOLDOWN) {
            return false;
        }
        
        const candles = await getCandles(symbol, '1h', CANDLE_LIMIT_SWEEP);
        if (!candles || candles.length < 50) return false;
        
        const sweep = detectSweepWithPivotValidation(candles);
        
        if (sweep && sweep.isActive) {
            console.log(`\n🎯 SWEEP D! ${symbol} - ${sweep.type}`);
            console.log(`💰 Preço Atual: ${sweep.price}`);
            console.log(`📍 Nível do Fractal: ${sweep.fractalLevel}`);
            
            // Buscar indicadores (inclui RSI)
            const indicators = await getIndicators(symbol);
            console.log(`📊 RSI 1h: ${indicators.rsi1h.value} | LSR: ${indicators.lsr.ratio} | Funding: ${indicators.funding.formatted}`);
            
            // VALIDAÇÃO DO RSI ANTES DE CONTINUAR
            const rsiValid = checkRSICondition(indicators.rsi1h.value, sweep.type);
            
            if (!rsiValid) {
                console.log(`🚫 Alerta ignorado para ${symbol}: RSI não atende critério para ${sweep.type}`);
                console.log(`   Critério: ${sweep.type === 'BUY' ? `RSI < ${RSI_BUY_MAX}` : `RSI > ${RSI_SELL_MIN}`}`);
                return false;
            }
            
            const shouldSend = shouldSendAlert(symbol, sweep);
            
            if (!shouldSend) {
                console.log(`⏭️ Alerta ignorado para ${symbol}: repetido ou mesmo nível`);
                return false;
            }
            
            // Detectar clusters de suporte e resistência
            const { supportClusters, resistanceClusters } = detectPriceClusters(candles, CANDLE_LIMIT_CLUSTER);
            
            console.log(`📊 Suportes encontrados: ${supportClusters.length} clusters`);
            supportClusters.forEach(c => console.log(`   - $${formatNumber(c.centerPrice)} (${c.touches}x toques)`));
            console.log(`📊 Resistências encontradas: ${resistanceClusters.length} clusters`);
            resistanceClusters.forEach(c => console.log(`   - $${formatNumber(c.centerPrice)} (${c.touches}x toques)`));
            
            const brDateTime = getBrazilianDateTime();
            
            const sent = await sendAlert(symbol, sweep, brDateTime, indicators, supportClusters, resistanceClusters);
            
            if (sent) {
                alertsCooldown[symbol] = now;
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error(`Erro ao processar ${symbol}:`, error.message);
        return false;
    }
}

// ============================================
// MONITORAMENTO PRINCIPAL
// ============================================

async function monitorSymbols() {
    let alertCount = 0;
    console.log(`\n🔍 Varredura: ${VALID_SYMBOLS.length} símbolos...`);
    console.log(`⚙️ Configuração: Fractal ${FRACTAL_BARS} barras | Período: ${PERIODS}`);
    console.log(`📊 RSI 1h: COMPRA < ${RSI_BUY_MAX} | VENDA > ${RSI_SELL_MIN}`);
    console.log(`📊 Cluster: ${CLUSTER_PROXIMITY_THRESHOLD * 100}% de proximidade | Mínimo ${MIN_CLUSTER_SIZE} toques`);
    console.log(`🔄 Prevenção de repetição: ${MIN_PRICE_CHANGE_PERCENT}% de mudança mínima para mesmo nível`);
    console.log(`📊 Monitorando LSR e Funding Rate em tempo real`);
    
    for (let i = 0; i < VALID_SYMBOLS.length; i++) {
        const symbol = VALID_SYMBOLS[i];
        const result = await processSymbol(symbol);
        if (result) alertCount++;
        
        if ((i + 1) % 10 === 0) {
            console.log(`📊 Progresso: ${i + 1}/${VALID_SYMBOLS.length} (${alertCount} alertas)`);
        }
        
        await new Promise(r => setTimeout(r, MIN_DELAY_BETWEEN_SYMBOLS));
    }
    
    console.log(`\n✅ Concluído: ${alertCount} alertas enviados. Total acumulado: ${totalAlertsSent}`);
    return alertCount;
}

// ============================================
// CARREGAR SÍMBOLOS
// ============================================

async function loadSymbols() {
    try {
        console.log('🔍 Carregando símbolos...');
        
        const symbols = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
            'AEVOUSDT', 'AXLUSDT', 'ZECUSDT', 'TRUMPUSDT', 'TRBUSDT',
            'POLUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
            'ZEREBROUSDT', '1000SHIBUSDT', '1000PEPEUSDT', 'API3USDT', 'AXLUSDT',
            'ARUSDT', 'BANDUSDT', 'RUNEUSDT', 'BOMEUSDT', 'STGUSDT',
            'CHRUSDT', 'CKBUSDT', 'GMTUSDT', 'GRTUSDT', 'HOTUSDT',
            'REZUSDT', 'PORTALUSDT', 'RVNUSDT', 'SEIUSDT', 'SKLUSDT',
            'SUIUSDT', 'THETAUSDT', 'TIAUSDT', 'UMAUSDT', 'VETUSDT',
            'ILVUSDT', 'ENJUSDT', 'FETUSDT', 'GMXUSDT', 'HBARUSDT',
            'IMXUSDT', 'KAVAUSDT', 'KSMUSDT', 'LDOUSDT', 'SANDUSDT',
            'MANAUSDT', 'TRXUSDT', 'MASKUSDT', 'MBOXUSDT', 'ONDOUSDT',
            'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
            'APEUSDT', 'FILUSDT', 'GALAUSDT', 'ICPUSDT', 'CRVUSDT',
            'ZILUSDT', 'ZROUSDT', 'ZRXUSDT', 'XLMUSDT', 'TAOUSDT',
            'ENAUSDT', 'MANTAUSDT', 'WLDUSDT', 'SUSHIUSDT', 'AAVEUSDT',
            '1INCHUSDT', 'DYDXUSDT', 'AXSUSDT', 'BCHUSDT', 'CHZUSDT'
        ];
        
        console.log(`✅ Carregados ${symbols.length} símbolos para monitoramento`);
        return symbols;
        
    } catch (error) {
        console.log(`❌ Erro ao carregar símbolos: ${error.message}`);
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    }
}

// ============================================
// TESTE DO TELEGRAM
// ============================================

async function testTelegram() {
    console.log('\n🔍 Testando conexão com Telegram...');
    
    const testMsg = `<i>🤖 Titanium Hunter iniciado!</i>\n` +
                   `<code>${'='.repeat(35)}</code>\n` +
                   `<i>RSI 1h: COMPRA < ${RSI_BUY_MAX} | VENDA > ${RSI_SELL_MIN}</i>\n` +
                   `<i>Cluster: ${CLUSTER_PROXIMITY_THRESHOLD * 100}% de proximidade</i>\n` +
                   `<i>Mudança mínima: ${MIN_PRICE_CHANGE_PERCENT}%</i>\n` +
                   `<i>LSR e Funding Rate: ATIVOS</i>`;
    
    const sent = await sendTelegramMessage(testMsg);
    
    if (sent) {
        console.log('✅ Telegram conectado e funcionando!');
        return true;
    } else {
        console.log('❌ Falha na conexão com Telegram! Verifique o token e chat ID.');
        return false;
    }
}

// ============================================
// LOOP PRINCIPAL
// ============================================

async function mainLoop() {
    await cleanupManager.initialize();
    
    VALID_SYMBOLS = await loadSymbols();
    
    if (VALID_SYMBOLS.length === 0) {
        console.log('❌ Nenhum símbolo válido encontrado!');
        process.exit(1);
    }
    
    const telegramOk = await testTelegram();
    if (!telegramOk) {
        console.log('❌ Telegram não está respondendo! Continuando sem envio de mensagens...');
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🤖 TITANIUM HUNTER - SWEEP COM VALIDAÇÃO DE PIVÔS E CLUSTERS`);
    console.log(`📊 Regras de RSI 1h:`);
    console.log(`   🔹 COMPRA: RSI < ${RSI_BUY_MAX}`);
    console.log(`   🔹 VENDA: RSI > ${RSI_SELL_MIN}`);
    console.log(`📊 Regras: Sweep COMPRA → Pivô de ALTA | Sweep VENDA → Pivô de BAIXA`);
    console.log(`📊 Cluster: ${CLUSTER_PROXIMITY_THRESHOLD * 100}% de proximidade | Mínimo ${MIN_CLUSTER_SIZE} toques`);
    console.log(`📊 LSR (Long/Short Ratio) e Funding Rate: MONITORADOS`);
    console.log(`${'='.repeat(60)}\n`);
    
    let cycle = 0;
    
    while (true) {
        try {
            cycle++;
            console.log(`\n🔄 CICLO ${cycle} - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
            console.log(`${'='.repeat(60)}`);
            
            await monitorSymbols();
            
            const now = Date.now();
            if (now - lastCleanup >= CLEANUP_INTERVAL) {
                await cleanupManager.performFullCleanup();
                lastCleanup = now;
            }
            
            console.log(`\n⏱️ Aguardando 5 minutos para próximo ciclo...`);
            await new Promise(r => setTimeout(r, 5 * 60 * 1000));
            
        } catch (error) {
            console.error(`❌ Erro no ciclo principal: ${error.message}`);
            console.log(`⏱️ Aguardando 1 minuto antes de reiniciar...`);
            await new Promise(r => setTimeout(r, 60000));
        }
    }
}

// ============================================
// INICIALIZAÇÃO
// ============================================

console.log('\n' + '='.repeat(60));
console.log('🤖 TITANIUM HUNTER - SWEEP COM VALIDAÇÃO DE PIVÔS E CLUSTERS');
console.log('📈 Versão Aprimorada: Com detecção de clusters, LSR, Funding Rate e RSI 1h');
console.log('='.repeat(60) + '\n');

mainLoop().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
