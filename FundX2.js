const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === SISTEMA DE LIMPEZA AUTOMÁTICA DE ARMAZENAMENTO ===
// =====================================================================
class StorageCleaner {
    constructor(options = {}) {
        this.maxFileSizeMB = options.maxFileSizeMB || 10;
        this.maxTotalSizeMB = options.maxTotalSizeMB || 50;
        this.maxFilesPerDir = options.maxFilesPerDir || 5;
        this.maxAgeDays = options.maxAgeDays || 7;
        this.checkIntervalMs = options.checkIntervalMs || 3600000;
        this.cleanupOnStart = options.cleanupOnStart !== false;
        
        this.init();
    }
    
    init() {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        if (this.cleanupOnStart) {
            this.performFullCleanup();
        }
        
        setInterval(() => this.performFullCleanup(), this.checkIntervalMs);
        
        console.log('✅ Sistema de limpeza automática inicializado');
    }
    
    getFileSizeMB(filePath) {
        try {
            const stats = fs.statSync(filePath);
            return stats.size / (1024 * 1024);
        } catch {
            return 0;
        }
    }
    
    rotateFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) return;
            
            const sizeMB = this.getFileSizeMB(filePath);
            if (sizeMB < this.maxFileSizeMB) return;
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const ext = path.extname(filePath);
            const basename = path.basename(filePath, ext);
            const backupDir = path.join(__dirname, 'backups');
            const backupPath = path.join(backupDir, `${basename}_${timestamp}${ext}`);
            
            const content = fs.readFileSync(filePath, 'utf8');
            fs.writeFileSync(backupPath, content);
            
            let resetContent = '{}';
            if (filePath.includes('alerts')) {
                resetContent = '[]';
            }
            fs.writeFileSync(filePath, resetContent);
            
            console.log(`📦 Arquivo rotacionado: ${path.basename(filePath)} (${sizeMB.toFixed(2)}MB)`);
            
        } catch (error) {
            console.log(`Erro ao rotacionar arquivo: ${error.message}`);
        }
    }
    
    cleanOldBackups() {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) return;
        
        try {
            const files = fs.readdirSync(backupDir);
            const now = Date.now();
            const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000;
            
            let deletedCount = 0;
            
            for (const file of files) {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                const ageMs = now - stats.mtimeMs;
                
                if (ageMs > maxAgeMs) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            }
            
            if (deletedCount > 0) {
                console.log(`🗑️ Removidos ${deletedCount} backups antigos (> ${this.maxAgeDays} dias)`);
            }
            
            const remainingFiles = fs.readdirSync(backupDir);
            if (remainingFiles.length > this.maxFilesPerDir) {
                const filesWithStats = remainingFiles.map(file => ({
                    name: file,
                    path: path.join(backupDir, file),
                    mtime: fs.statSync(path.join(backupDir, file)).mtimeMs
                }));
                
                filesWithStats.sort((a, b) => a.mtime - b.mtime);
                
                const toDelete = filesWithStats.slice(0, remainingFiles.length - this.maxFilesPerDir);
                for (const file of toDelete) {
                    fs.unlinkSync(file.path);
                    console.log(`🗑️ Removido backup excedente: ${file.name}`);
                }
            }
            
        } catch (error) {
            console.log(`Erro ao limpar backups: ${error.message}`);
        }
    }
    
    compressMemoryFile(memoryFile) {
        if (!fs.existsSync(memoryFile)) return;
        
        try {
            const content = fs.readFileSync(memoryFile, 'utf8');
            const data = JSON.parse(content);
            
            const now = Date.now();
            const maxHistoryAge = 7 * 24 * 60 * 60 * 1000;
            
            if (data.rsiDivergenceHistory) {
                for (const symbol in data.rsiDivergenceHistory) {
                    const history = data.rsiDivergenceHistory[symbol];
                    
                    if (history.bullishDivergences) {
                        history.bullishDivergences = history.bullishDivergences.filter(
                            d => (now - d.timestamp) < maxHistoryAge
                        );
                    }
                    
                    if (history.bearishDivergences) {
                        history.bearishDivergences = history.bearishDivergences.filter(
                            d => (now - d.timestamp) < maxHistoryAge
                        );
                    }
                }
            }
            
            if (data.bollingerHistory) {
                for (const symbol in data.bollingerHistory) {
                    const history = data.bollingerHistory[symbol];
                    if (history.lastAlert && (now - history.lastAlert) > maxHistoryAge) {
                        delete data.bollingerHistory[symbol];
                    }
                }
            }
            
            fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2));
            
            const newSizeMB = this.getFileSizeMB(memoryFile);
            console.log(`📦 Memória compactada: ${newSizeMB.toFixed(2)}MB`);
            
        } catch (error) {
            console.log(`Erro ao compactar memória: ${error.message}`);
        }
    }
    
    checkTotalSize(memoryFile, alertHistoryFile) {
        const files = [memoryFile, alertHistoryFile];
        let totalSizeMB = 0;
        
        for (const file of files) {
            if (fs.existsSync(file)) {
                totalSizeMB += this.getFileSizeMB(file);
            }
        }
        
        const backupDir = path.join(__dirname, 'backups');
        if (fs.existsSync(backupDir)) {
            const backups = fs.readdirSync(backupDir);
            for (const backup of backups) {
                totalSizeMB += this.getFileSizeMB(path.join(backupDir, backup));
            }
        }
        
        if (totalSizeMB > this.maxTotalSizeMB) {
            console.log(`⚠️ Tamanho total excedido: ${totalSizeMB.toFixed(2)}MB / ${this.maxTotalSizeMB}MB`);
            this.cleanOldBackups();
            this.compressMemoryFile(memoryFile);
        }
        
        return totalSizeMB;
    }
    
    performFullCleanup(memoryFile, alertHistoryFile) {
        try {
            console.log('🧹 Iniciando limpeza automática...');
            
            this.rotateFile(memoryFile);
            this.rotateFile(alertHistoryFile);
            this.cleanOldBackups();
            if (memoryFile) this.compressMemoryFile(memoryFile);
            if (memoryFile && alertHistoryFile) {
                const totalSize = this.checkTotalSize(memoryFile, alertHistoryFile);
                console.log(`🧹 Limpeza concluída. Tamanho total: ${totalSize.toFixed(2)}MB`);
            }
            
        } catch (error) {
            console.log(`Erro na limpeza automática: ${error.message}`);
        }
    }
}

// =====================================================================
// === RATE LIMITER ADAPTATIVO ROBUSTO ===
// =====================================================================
class AdaptiveRateLimiter {
    constructor(options = {}) {
        this.baseDelayMs = options.baseDelayMs || 100;
        this.maxDelayMs = options.maxDelayMs || 10000;
        this.minDelayMs = options.minDelayMs || 50;
        this.errorThreshold = options.errorThreshold || 5;
        this.successThreshold = options.successThreshold || 10;
        this.backoffMultiplier = options.backoffMultiplier || 1.5;
        this.recoveryMultiplier = options.recoveryMultiplier || 0.9;
        
        this.currentDelay = this.baseDelayMs;
        this.consecutiveErrors = 0;
        this.consecutiveSuccesses = 0;
        this.requestHistory = [];
        this.lastRequestTime = 0;
        this.statusCounts = {
            success: 0,
            error: 0,
            rateLimit: 0,
            timeout: 0
        };
        
        this.endpointStats = new Map();
        
        this.init();
    }
    
    init() {
        setInterval(() => this.resetStats(), 3600000);
        console.log('⚡ Rate Limiter Adaptativo inicializado');
    }
    
    getEndpointKey(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.hostname}${urlObj.pathname}`;
        } catch {
            return url;
        }
    }
    
    updateEndpointStats(endpoint, success, statusCode) {
        if (!this.endpointStats.has(endpoint)) {
            this.endpointStats.set(endpoint, {
                requests: 0,
                errors: 0,
                rateLimits: 0,
                avgResponseTime: 0,
                lastRequest: 0
            });
        }
        
        const stats = this.endpointStats.get(endpoint);
        stats.requests++;
        stats.lastRequest = Date.now();
        
        if (!success) {
            stats.errors++;
            if (statusCode === 429 || statusCode === 418) {
                stats.rateLimits++;
            }
        }
    }
    
    calculateOptimalDelay() {
        const now = Date.now();
        const recentRequests = this.requestHistory.filter(r => now - r.timestamp < 60000);
        
        if (recentRequests.length === 0) return this.currentDelay;
        
        const errorRate = recentRequests.filter(r => !r.success).length / recentRequests.length;
        const rateLimitRate = recentRequests.filter(r => r.statusCode === 429 || r.statusCode === 418).length / recentRequests.length;
        
        let optimalDelay = this.currentDelay;
        
        if (errorRate > 0.1) {
            optimalDelay = Math.min(this.maxDelayMs, optimalDelay * this.backoffMultiplier);
            console.log(`⚠️ Alta taxa de erro (${(errorRate*100).toFixed(1)}%) - Aumentando delay para ${optimalDelay}ms`);
        } else if (errorRate < 0.02 && this.consecutiveSuccesses > this.successThreshold) {
            optimalDelay = Math.max(this.minDelayMs, optimalDelay * this.recoveryMultiplier);
            if (optimalDelay !== this.currentDelay) {
                console.log(`✅ Taxa de erro baixa - Reduzindo delay para ${optimalDelay}ms`);
            }
        }
        
        if (rateLimitRate > 0.05) {
            optimalDelay = Math.min(this.maxDelayMs, optimalDelay * 2);
            console.log(`🚫 Detectado rate limit - Aumentando delay para ${optimalDelay}ms`);
        }
        
        return optimalDelay;
    }
    
    async waitIfNeeded() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.currentDelay) {
            const waitTime = this.currentDelay - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }
    
    recordRequest(success, statusCode = null, responseTime = 0, endpoint = 'unknown') {
        this.requestHistory.push({
            timestamp: Date.now(),
            success,
            statusCode,
            responseTime,
            endpoint
        });
        
        if (this.requestHistory.length > 1000) {
            this.requestHistory.shift();
        }
        
        if (success) {
            this.consecutiveSuccesses++;
            this.consecutiveErrors = 0;
            this.statusCounts.success++;
        } else {
            this.consecutiveErrors++;
            this.consecutiveSuccesses = 0;
            this.statusCounts.error++;
            
            if (statusCode === 429 || statusCode === 418) {
                this.statusCounts.rateLimit++;
                this.currentDelay = Math.min(this.maxDelayMs, this.currentDelay * 2);
                console.log(`🚫 Rate limit detectado (${statusCode}) - Delay ajustado para ${this.currentDelay}ms`);
            }
        }
        
        if (this.consecutiveErrors >= this.errorThreshold) {
            this.currentDelay = Math.min(this.maxDelayMs, this.currentDelay * this.backoffMultiplier);
            console.log(`⚠️ ${this.consecutiveErrors} erros consecutivos - Delay aumentado para ${this.currentDelay}ms`);
            this.consecutiveErrors = 0;
        } else if (this.consecutiveSuccesses >= this.successThreshold) {
            const newDelay = Math.max(this.minDelayMs, this.currentDelay * this.recoveryMultiplier);
            if (newDelay !== this.currentDelay) {
                this.currentDelay = newDelay;
                console.log(`✅ ${this.consecutiveSuccesses} sucessos consecutivos - Delay reduzido para ${this.currentDelay}ms`);
            }
            this.consecutiveSuccesses = 0;
        }
        
        if (responseTime > 5000 && success) {
            this.currentDelay = Math.min(this.maxDelayMs, this.currentDelay * 1.2);
            console.log(`⏱️ Resposta lenta (${responseTime}ms) - Ajustando delay para ${this.currentDelay}ms`);
        }
    }
    
    getStats() {
        const total = this.statusCounts.success + this.statusCounts.error;
        const successRate = total > 0 ? (this.statusCounts.success / total * 100).toFixed(1) : 100;
        
        return {
            currentDelay: this.currentDelay,
            consecutiveErrors: this.consecutiveErrors,
            consecutiveSuccesses: this.consecutiveSuccesses,
            successRate: `${successRate}%`,
            ...this.statusCounts,
            endpoints: Array.from(this.endpointStats.entries()).map(([name, stats]) => ({
                name,
                ...stats
            }))
        };
    }
    
    resetStats() {
        const stats = this.getStats();
        console.log(`📊 Estatísticas do Rate Limiter: Delay=${stats.currentDelay}ms, Taxa de sucesso=${stats.successRate}`);
        
        this.consecutiveErrors = 0;
        this.consecutiveSuccesses = 0;
        this.statusCounts = {
            success: 0,
            error: 0,
            rateLimit: 0,
            timeout: 0
        };
    }
    
    async executeWithRateLimit(fn, url, context = '') {
        await this.waitIfNeeded();
        
        const startTime = Date.now();
        let success = false;
        let statusCode = null;
        let result = null;
        let error = null;
        
        try {
            result = await fn();
            success = true;
            statusCode = 200;
        } catch (err) {
            error = err;
            success = false;
            statusCode = err.status || err.statusCode || 500;
            
            if (err.message && err.message.includes('timeout')) {
                this.statusCounts.timeout++;
            }
        }
        
        const responseTime = Date.now() - startTime;
        const endpoint = this.getEndpointKey(url);
        
        this.recordRequest(success, statusCode, responseTime, endpoint);
        this.updateEndpointStats(endpoint, success, statusCode);
        
        if (!success) {
            throw error;
        }
        
        return result;
    }
}

// =====================================================================
// === CVD REAL COM WEBSOCKET ===
// =====================================================================
class RealCVDManager {
    constructor() {
        this.cvdData = new Map(); // symbol -> { value, history, lastUpdate, ws }
        this.subscribedSymbols = new Set();
        this.updateCallbacks = [];
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
    }
    
    subscribeToSymbol(symbol, callback = null) {
        if (this.subscribedSymbols.has(symbol)) {
            console.log(`ℹ️ ${symbol} já está inscrito no CVD Real`);
            return;
        }
        
        if (callback) {
            this.updateCallbacks.push({ symbol, callback });
        }
        
        this.subscribedSymbols.add(symbol);
        
        // Inicializar dados do símbolo
        this.cvdData.set(symbol, {
            value: 0,
            history: [],
            lastUpdate: Date.now(),
            buyVolume: 0,
            sellVolume: 0,
            totalTrades: 0,
            lastPrice: null
        });
        
        this.connectWebSocket(symbol);
        console.log(`🔌 Conectando CVD Real para ${symbol}`);
    }
    
    connectWebSocket(symbol) {
        const symbolLower = symbol.toLowerCase();
        const wsUrl = `wss://fstream.binance.com/ws/${symbolLower}@aggTrade`;
        
        console.log(`🌐 Conectando WebSocket: ${symbolLower}@aggTrade`);
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log(`✅ WebSocket CVD conectado para ${symbol}`);
            this.reconnectAttempts.set(symbol, 0);
            
            // Salvar referência do WebSocket
            const data = this.cvdData.get(symbol);
            if (data) {
                data.ws = ws;
                data.connected = true;
            }
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (error) {
                console.log(`Erro ao processar trade ${symbol}: ${error.message}`);
            }
        });
        
        ws.on('error', (error) => {
            console.log(`❌ Erro WebSocket ${symbol}: ${error.message}`);
            this.handleDisconnect(symbol);
        });
        
        ws.on('close', () => {
            console.log(`🔌 WebSocket desconectado para ${symbol}`);
            this.handleDisconnect(symbol);
        });
        
        // Salvar WebSocket
        const data = this.cvdData.get(symbol);
        if (data) {
            data.ws = ws;
        }
    }
    
    processTrade(symbol, trade) {
        const volume = parseFloat(trade.q);
        const price = parseFloat(trade.p);
        const isBuyerMaker = trade.m; // true = seller aggressive (sell), false = buyer aggressive (buy)
        
        // Calcular delta: +volume para compras, -volume para vendas
        let delta;
        if (isBuyerMaker) {
            // Seller aggressive = venda
            delta = -volume;
        } else {
            // Buyer aggressive = compra
            delta = +volume;
        }
        
        const data = this.cvdData.get(symbol);
        if (!data) return;
        
        // Atualizar CVD
        data.value += delta;
        data.lastUpdate = Date.now();
        data.lastPrice = price;
        
        // Atualizar volumes
        if (delta > 0) {
            data.buyVolume += volume;
        } else {
            data.sellVolume += volume;
        }
        data.totalTrades++;
        
        // Manter histórico (últimos 1000 trades para análise)
        data.history.push({
            timestamp: Date.now(),
            delta: delta,
            volume: volume,
            price: price,
            cvd: data.value,
            isBuy: !isBuyerMaker
        });
        
        // Limitar histórico
        if (data.history.length > 1000) {
            data.history.shift();
        }
        
        // Notificar callbacks
        for (const cb of this.updateCallbacks) {
            if (cb.symbol === symbol && cb.callback) {
                cb.callback({
                    symbol,
                    cvd: data.value,
                    lastPrice: price,
                    buyVolume: data.buyVolume,
                    sellVolume: data.sellVolume,
                    totalTrades: data.totalTrades,
                    lastDelta: delta
                });
            }
        }
    }
    
    handleDisconnect(symbol) {
        const attempts = this.reconnectAttempts.get(symbol) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, attempts);
            console.log(`🔄 Tentando reconectar ${symbol} em ${delay/1000}s (tentativa ${attempts + 1}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.reconnectAttempts.set(symbol, attempts + 1);
                this.connectWebSocket(symbol);
            }, delay);
        } else {
            console.log(`❌ Falha ao reconectar ${symbol} após ${this.maxReconnectAttempts} tentativas`);
            
            // Limpar dados
            const data = this.cvdData.get(symbol);
            if (data && data.ws) {
                try {
                    data.ws.terminate();
                } catch(e) {}
            }
        }
    }
    
    unsubscribeFromSymbol(symbol) {
        const data = this.cvdData.get(symbol);
        if (data && data.ws) {
            try {
                data.ws.close();
                data.ws.terminate();
            } catch(e) {}
        }
        
        this.subscribedSymbols.delete(symbol);
        this.cvdData.delete(symbol);
        
        // Remover callbacks
        this.updateCallbacks = this.updateCallbacks.filter(cb => cb.symbol !== symbol);
        
        console.log(`🔌 Desinscrito CVD Real para ${symbol}`);
    }
    
    getCVD(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return null;
        
        return {
            symbol,
            cvd: data.value,
            lastUpdate: data.lastUpdate,
            lastPrice: data.lastPrice,
            buyVolume: data.buyVolume,
            sellVolume: data.sellVolume,
            totalTrades: data.totalTrades,
            buySellRatio: data.sellVolume > 0 ? data.buyVolume / data.sellVolume : 1
        };
    }
    
    getCVDHistory(symbol, limit = 100) {
        const data = this.cvdData.get(symbol);
        if (!data) return [];
        
        return data.history.slice(-limit);
    }
    
    calculateCVDChange(symbol, seconds = 60) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length === 0) return 0;
        
        const now = Date.now();
        const cutoff = now - (seconds * 1000);
        
        const oldCVD = data.history.find(h => h.timestamp <= cutoff);
        if (!oldCVD) return 0;
        
        const change = data.value - oldCVD.cvd;
        const changePercent = Math.abs(change / (Math.abs(oldCVD.cvd) || 1)) * 100;
        
        return {
            change,
            changePercent,
            currentCVD: data.value,
            oldCVD: oldCVD.cvd,
            period: seconds
        };
    }
    
    cleanup() {
        for (const symbol of this.subscribedSymbols) {
            this.unsubscribeFromSymbol(symbol);
        }
        console.log('🧹 CVD Manager limpo');
    }
}

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG
        CHAT_ID: '-1002554
    },
    MONITOR: {
        INTERVAL_MINUTES: 15,
        TOP_SIZE: 5,
        MIN_VOLUME_USDT: 500000,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        CVD: {
            TIMEFRAME_1H: '1h',
            TIMEFRAME_15M: '15m',
            CHECK_INTERVAL_SECONDS: 60,
            LOOKBACK_CANDLES: 20,
            MIN_CVD_CHANGE_PERCENT: 5,
            CVD_HISTORY_SECONDS: 300, // 5 minutos de histórico para análise
            CVD_CHANGE_WINDOW: 60 // Janela de 60 segundos para calcular mudança
        },
        RSI: {
            PERIOD: 14,
            OVERBOUGHT: 70,
            OVERSOLD: 30,
            TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h', '12h', '1d', '3d', '1w'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCES_REQUIRED: 2,
            MIN_DIVERGENCE_STRENGTH: 5
        },
        BOLLINGER: {
            PERIOD: 20,
            STD_DEVIATION: 2,
            TIMEFRAME: '15m'
        },
        STORAGE: {
            MAX_FILE_SIZE_MB: 10,
            MAX_TOTAL_SIZE_MB: 50,
            MAX_BACKUP_AGE_DAYS: 7,
            CLEANUP_INTERVAL_HOURS: 1
        }
    }
};

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const MEMORY_FILE = path.join(__dirname, 'fundingMonitorMemory.json');
const ALERT_HISTORY_FILE = path.join(__dirname, 'fundingAlerts.json');

// Inicializar sistema de limpeza
const storageCleaner = new StorageCleaner({
    maxFileSizeMB: CONFIG.MONITOR.STORAGE.MAX_FILE_SIZE_MB,
    maxTotalSizeMB: CONFIG.MONITOR.STORAGE.MAX_TOTAL_SIZE_MB,
    maxAgeDays: CONFIG.MONITOR.STORAGE.MAX_BACKUP_AGE_DAYS,
    checkIntervalMs: CONFIG.MONITOR.STORAGE.CLEANUP_INTERVAL_HOURS * 3600000
});

// Inicializar rate limiter
const rateLimiter = new AdaptiveRateLimiter({
    baseDelayMs: 200,
    maxDelayMs: 15000,
    minDelayMs: 100,
    errorThreshold: 3,
    successThreshold: 15,
    backoffMultiplier: 1.8,
    recoveryMultiplier: 0.85
});

// Inicializar CVD Real Manager
const cvdManager = new RealCVDManager();

// =====================================================================
// === FUNÇÃO DE FETCH COM RATE LIMITING ===
// =====================================================================
async function rateLimitedFetch(url, options = {}) {
    return rateLimiter.executeWithRateLimit(
        () => fetch(url, options),
        url,
        'binance-api'
    );
}

// =====================================================================
// === SISTEMA DE MEMÓRIA ===
// =====================================================================
class FundingMemory {
    constructor() {
        this.watchedSymbols = {
            positive: [],
            negative: []
        };
        this.lastUpdate = null;
        this.cvdStatus = new Map();
        this.rsiDivergenceHistory = new Map();
        this.bollingerHistory = new Map();
        this.loadFromFile();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                const data = fs.readFileSync(MEMORY_FILE, 'utf8');
                const loaded = JSON.parse(data);
                this.watchedSymbols = loaded.watchedSymbols || { positive: [], negative: [] };
                this.lastUpdate = loaded.lastUpdate;
                this.rsiDivergenceHistory = loaded.rsiDivergenceHistory || {};
                this.bollingerHistory = loaded.bollingerHistory || {};
                
                console.log(`📂 Carregados ${this.watchedSymbols.positive.length} positivos e ${this.watchedSymbols.negative.length} negativos da memória`);
            }
        } catch (error) {
            console.log(`Erro ao carregar memória: ${error.message}`);
        }
    }

    saveToFile() {
        try {
            const data = {
                watchedSymbols: this.watchedSymbols,
                lastUpdate: this.lastUpdate,
                rsiDivergenceHistory: this.rsiDivergenceHistory,
                bollingerHistory: this.bollingerHistory
            };
            fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.log(`Erro ao salvar memória: ${error.message}`);
        }
    }

    updateWatchedSymbols(positive, negative) {
        this.watchedSymbols.positive = positive;
        this.watchedSymbols.negative = negative;
        this.lastUpdate = Date.now();
        this.saveToFile();
        
        console.log(`📝 Memória atualizada: ${positive.length} positivos, ${negative.length} negativos`);
    }

    getWatchedSymbols() {
        return this.watchedSymbols;
    }

    shouldAlertCVD(symbol, type, cvdData) {
        const key = `${symbol}_${type}`;
        const last = this.cvdStatus.get(key);
        
        if (!last) {
            this.cvdStatus.set(key, { lastAlert: null, lastCvd: cvdData });
            return true;
        }
        
        if (last.lastAlert && (Date.now() - last.lastAlert) < 5 * 60 * 1000) {
            return false;
        }
        
        if (last.lastCvd && cvdData) {
            const changePercent = Math.abs((cvdData - last.lastCvd) / (last.lastCvd || 1)) * 100;
            if (changePercent < CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
                return false;
            }
        }
        
        this.cvdStatus.set(key, { lastAlert: Date.now(), lastCvd: cvdData });
        this.saveToFile();
        return true;
    }

    shouldAlertBollinger(symbol, type) {
        const key = symbol;
        const last = this.bollingerHistory.get(key);
        
        if (last && last.lastAlert && (Date.now() - last.lastAlert) < 4 * 3600000) {
            return false;
        }
        
        this.bollingerHistory.set(key, { lastAlert: Date.now(), lastTouch: Date.now() });
        this.saveToFile();
        return true;
    }

    addRSIDivergence(symbol, type, timeframe, details) {
        const key = symbol;
        if (!this.rsiDivergenceHistory[key]) {
            this.rsiDivergenceHistory[key] = {
                bullishDivergences: [],
                bearishDivergences: [],
                lastAlert: null
            };
        }
        
        const history = this.rsiDivergenceHistory[key];
        const divergenceList = type === 'bullish' ? history.bullishDivergences : history.bearishDivergences;
        
        const exists = divergenceList.some(d => d.timeframe === timeframe && (Date.now() - d.timestamp) < 3600000);
        
        if (!exists) {
            divergenceList.push({
                timeframe: timeframe,
                timestamp: Date.now(),
                details: details
            });
            
            if (divergenceList.length > 10) divergenceList.shift();
            
            this.saveToFile();
            return true;
        }
        return false;
    }

    getRSIDivergenceCount(symbol) {
        const history = this.rsiDivergenceHistory[symbol];
        if (!history) return { bullish: 0, bearish: 0, bullishTimeframes: [], bearishTimeframes: [] };
        
        const now = Date.now();
        const recentBullish = history.bullishDivergences.filter(d => (now - d.timestamp) < 86400000);
        const recentBearish = history.bearishDivergences.filter(d => (now - d.timestamp) < 86400000);
        
        return {
            bullish: recentBullish.length,
            bearish: recentBearish.length,
            bullishTimeframes: recentBullish.map(d => d.timeframe),
            bearishTimeframes: recentBearish.map(d => d.timeframe),
            details: {
                bullish: recentBullish,
                bearish: recentBearish
            }
        };
    }

    shouldAlertRSI(symbol, type) {
        const history = this.rsiDivergenceHistory[symbol];
        if (!history) return false;
        
        if (history.lastAlert && (Date.now() - history.lastAlert) < 4 * 3600000) {
            return false;
        }
        
        const counts = this.getRSIDivergenceCount(symbol);
        const required = CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
        
        let hasEnoughDivergences = false;
        if (type === 'bullish' && counts.bullish >= required) {
            hasEnoughDivergences = true;
        } else if (type === 'bearish' && counts.bearish >= required) {
            hasEnoughDivergences = true;
        }
        
        if (hasEnoughDivergences) {
            history.lastAlert = Date.now();
            this.saveToFile();
            return true;
        }
        
        return false;
    }
}

const fundingMemory = new FundingMemory();

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
    if (price > 1) return price.toFixed(4);
    if (price > 0.1) return price.toFixed(5);
    if (price > 0.01) return price.toFixed(6);
    return price.toFixed(8);
}

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    if (type === 'error') console.error(`❌ ${timestamp} - ${message}`);
    else if (type === 'success') console.log(`✅ ${timestamp} - ${message}`);
    else if (type === 'warning') console.log(`⚠️ ${timestamp} - ${message}`);
    else console.log(`ℹ️ ${timestamp} - ${message}`);
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await rateLimitedFetch(url);
        const data = await response.json();
        
        if (!Array.isArray(data)) return [];
        
        return data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
    } catch (error) {
        log(`Erro ao buscar candles ${symbol} ${interval}: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === CÁLCULO DAS BANDAS DE BOLLINGER ===
// =====================================================================
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    const squaredDiffs = recentPrices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    const upperBand = sma + (stdDev * standardDeviation);
    const lowerBand = sma - (stdDev * standardDeviation);
    
    return {
        sma: sma,
        upper: upperBand,
        lower: lowerBand,
        currentPrice: prices[prices.length - 1]
    };
}

// =====================================================================
// === VERIFICAR TOQUE NAS BANDAS DE BOLLINGER ===
// =====================================================================
async function checkBollingerTouch(symbol, type) {
    try {
        const candles = await getCandles(symbol, CONFIG.MONITOR.BOLLINGER.TIMEFRAME, CONFIG.MONITOR.BOLLINGER.PERIOD + 10);
        
        if (!candles || candles.length < CONFIG.MONITOR.BOLLINGER.PERIOD) {
            return false;
        }
        
        const prices = candles.map(c => c.close);
        const bollinger = calculateBollingerBands(prices, CONFIG.MONITOR.BOLLINGER.PERIOD, CONFIG.MONITOR.BOLLINGER.STD_DEVIATION);
        
        if (!bollinger) return false;
        
        const currentPrice = bollinger.currentPrice;
        
        if (type === 'buy') {
            const touchedLowerBand = currentPrice <= bollinger.lower;
            if (touchedLowerBand) {
                log(`📊 ${symbol} - TOQUE NA BANDA INFERIOR: Preço ${formatPrice(currentPrice)} ≤ Banda Inferior ${formatPrice(bollinger.lower)}`, 'success');
                return true;
            }
        }
        
        if (type === 'sell') {
            const touchedUpperBand = currentPrice >= bollinger.upper;
            if (touchedUpperBand) {
                log(`📊 ${symbol} - TOQUE NA BANDA SUPERIOR: Preço ${formatPrice(currentPrice)} ≥ Banda Superior ${formatPrice(bollinger.upper)}`, 'success');
                return true;
            }
        }
        
        return false;
        
    } catch (error) {
        log(`Erro ao verificar Bollinger para ${symbol}: ${error.message}`, 'error');
        return false;
    }
}

// =====================================================================
// === CÁLCULO DO RSI ===
// =====================================================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    const rsiValues = [null];
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
        
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
    }
    
    return rsiValues;
}

// =====================================================================
// === DETECTAR DIVERGÊNCIAS DE RSI ===
// =====================================================================
function findRSIDivergences(prices, rsiValues) {
    const divergences = {
        bullish: [],
        bearish: []
    };
    
    if (prices.length < 30 || !rsiValues || rsiValues.length < 30) return divergences;
    
    const CONFIG_DIVERGENCE = {
        LOOKBACK_WINDOW: 15,
        MIN_PRICE_MOVE_PERCENT: 1.5,
        MIN_RSI_DIFF: 3,
        CONFIRMATION_CANDLES: 2,
        MAX_PIVOT_DISTANCE: 25,
        MIN_DIVERGENCE_RATIO: 1.2,
        ZIGZAG_REVERSION_PERCENT: 2
    };
    
    function findPivotPoints(data, minReversionPercent = CONFIG_DIVERGENCE.ZIGZAG_REVERSION_PERCENT) {
        const pivots = { highs: [], lows: [] };
        if (data.length < 5) return pivots;
        
        let lastPivotType = null;
        let lastPivotIndex = 0;
        let lastPivotValue = 0;
        
        for (let i = 2; i < data.length - 2; i++) {
            const isHigh = data[i] > data[i-1] && data[i] > data[i-2] && 
                          data[i] > data[i+1] && data[i] > data[i+2];
            const isLow = data[i] < data[i-1] && data[i] < data[i-2] && 
                         data[i] < data[i+1] && data[i] < data[i+2];
            
            if (isHigh) {
                if (lastPivotType === 'low' && lastPivotIndex > 0) {
                    const movePercent = Math.abs((data[i] - lastPivotValue) / lastPivotValue) * 100;
                    if (movePercent >= minReversionPercent) {
                        pivots.highs.push(i);
                        lastPivotType = 'high';
                        lastPivotIndex = i;
                        lastPivotValue = data[i];
                    }
                } else if (lastPivotType === null) {
                    pivots.highs.push(i);
                    lastPivotType = 'high';
                    lastPivotIndex = i;
                    lastPivotValue = data[i];
                }
            }
            
            if (isLow) {
                if (lastPivotType === 'high' && lastPivotIndex > 0) {
                    const movePercent = Math.abs((data[i] - lastPivotValue) / lastPivotValue) * 100;
                    if (movePercent >= minReversionPercent) {
                        pivots.lows.push(i);
                        lastPivotType = 'low';
                        lastPivotIndex = i;
                        lastPivotValue = data[i];
                    }
                } else if (lastPivotType === null) {
                    pivots.lows.push(i);
                    lastPivotType = 'low';
                    lastPivotIndex = i;
                    lastPivotValue = data[i];
                }
            }
        }
        
        return pivots;
    }
    
    const pricePivots = findPivotPoints(prices);
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        const currentPriceIndex = pricePivots.lows[i];
        const currentPrice = prices[currentPriceIndex];
        const currentRsi = rsiValues[currentPriceIndex];
        
        if (currentRsi === null) continue;
        
        for (let j = i + 1; j < pricePivots.lows.length && (pricePivots.lows[j] - currentPriceIndex) <= CONFIG_DIVERGENCE.MAX_PIVOT_DISTANCE; j++) {
            const prevPriceIndex = pricePivots.lows[j];
            const prevPrice = prices[prevPriceIndex];
            const prevRsi = rsiValues[prevPriceIndex];
            
            if (prevRsi === null) continue;
            
            const priceLowerLow = currentPrice < prevPrice;
            const priceMovePercent = Math.abs((currentPrice - prevPrice) / prevPrice) * 100;
            
            if (priceLowerLow && priceMovePercent >= CONFIG_DIVERGENCE.MIN_PRICE_MOVE_PERCENT) {
                const rsiHigherLow = currentRsi > prevRsi;
                const rsiDiff = currentRsi - prevRsi;
                
                if (rsiHigherLow && rsiDiff >= CONFIG_DIVERGENCE.MIN_RSI_DIFF) {
                    const strength = (rsiDiff / Math.abs(prevRsi)) * 100;
                    const divergenceRatio = (currentPrice / prevPrice) / (currentRsi / prevRsi);
                    
                    if (strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH && 
                        divergenceRatio >= CONFIG_DIVERGENCE.MIN_DIVERGENCE_RATIO) {
                        
                        let confirmation = false;
                        const confirmEnd = Math.min(currentPriceIndex + CONFIG_DIVERGENCE.CONFIRMATION_CANDLES, prices.length - 1);
                        for (let k = currentPriceIndex + 1; k <= confirmEnd; k++) {
                            if (prices[k] > prices[currentPriceIndex]) {
                                confirmation = true;
                                break;
                            }
                        }
                        
                        divergences.bullish.push({
                            index: currentPriceIndex,
                            price: currentPrice,
                            rsi: currentRsi,
                            prevIndex: prevPriceIndex,
                            prevPrice: prevPrice,
                            prevRsi: prevRsi,
                            strength: strength,
                            priceMovePercent: priceMovePercent,
                            rsiDiff: rsiDiff,
                            divergenceRatio: divergenceRatio,
                            confirmed: confirmation
                        });
                    }
                }
            }
        }
    }
    
    for (let i = 0; i < pricePivots.highs.length; i++) {
        const currentPriceIndex = pricePivots.highs[i];
        const currentPrice = prices[currentPriceIndex];
        const currentRsi = rsiValues[currentPriceIndex];
        
        if (currentRsi === null) continue;
        
        for (let j = i + 1; j < pricePivots.highs.length && (pricePivots.highs[j] - currentPriceIndex) <= CONFIG_DIVERGENCE.MAX_PIVOT_DISTANCE; j++) {
            const prevPriceIndex = pricePivots.highs[j];
            const prevPrice = prices[prevPriceIndex];
            const prevRsi = rsiValues[prevPriceIndex];
            
            if (prevRsi === null) continue;
            
            const priceHigherHigh = currentPrice > prevPrice;
            const priceMovePercent = Math.abs((currentPrice - prevPrice) / prevPrice) * 100;
            
            if (priceHigherHigh && priceMovePercent >= CONFIG_DIVERGENCE.MIN_PRICE_MOVE_PERCENT) {
                const rsiLowerHigh = currentRsi < prevRsi;
                const rsiDiff = prevRsi - currentRsi;
                
                if (rsiLowerHigh && rsiDiff >= CONFIG_DIVERGENCE.MIN_RSI_DIFF) {
                    const strength = (rsiDiff / Math.abs(prevRsi)) * 100;
                    const divergenceRatio = (currentPrice / prevPrice) / (prevRsi / currentRsi);
                    
                    if (strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH && 
                        divergenceRatio >= CONFIG_DIVERGENCE.MIN_DIVERGENCE_RATIO) {
                        
                        let confirmation = false;
                        const confirmEnd = Math.min(currentPriceIndex + CONFIG_DIVERGENCE.CONFIRMATION_CANDLES, prices.length - 1);
                        for (let k = currentPriceIndex + 1; k <= confirmEnd; k++) {
                            if (prices[k] < prices[currentPriceIndex]) {
                                confirmation = true;
                                break;
                            }
                        }
                        
                        divergences.bearish.push({
                            index: currentPriceIndex,
                            price: currentPrice,
                            rsi: currentRsi,
                            prevIndex: prevPriceIndex,
                            prevPrice: prevPrice,
                            prevRsi: prevRsi,
                            strength: strength,
                            priceMovePercent: priceMovePercent,
                            rsiDiff: rsiDiff,
                            divergenceRatio: divergenceRatio,
                            confirmed: confirmation
                        });
                    }
                }
            }
        }
    }
    
    const filterDivergences = (divList) => {
        const filtered = [];
        const usedIndices = new Set();
        const sorted = [...divList].sort((a, b) => b.strength - a.strength);
        
        for (const div of sorted) {
            if (!usedIndices.has(div.index)) {
                filtered.push(div);
                usedIndices.add(div.index);
                for (let i = -3; i <= 3; i++) {
                    usedIndices.add(div.index + i);
                }
            }
        }
        
        return filtered;
    };
    
    divergences.bullish = filterDivergences(divergences.bullish);
    divergences.bearish = filterDivergences(divergences.bearish);
    
    return divergences;
}

// =====================================================================
// === ANALISAR RSI EM MÚLTIPLOS TIMEFRAMES ===
// =====================================================================
async function analyzeRSIDivergences(symbol) {
    const results = [];
    let totalBullishDivergences = 0;
    let totalBearishDivergences = 0;
    const bullishTimeframes = [];
    const bearishTimeframes = [];
    
    for (const timeframe of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        try {
            const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
            
            if (!candles || candles.length < 30) continue;
            
            const prices = candles.map(c => c.close);
            const rsiValues = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
            
            if (!rsiValues || rsiValues.length < 20) continue;
            
            const divergences = findRSIDivergences(prices, rsiValues);
            const lastRSI = rsiValues[rsiValues.length - 1];
            
            for (const div of divergences.bullish) {
                if (div.confirmed) {
                    const added = fundingMemory.addRSIDivergence(symbol, 'bullish', timeframe, div);
                    if (added) {
                        totalBullishDivergences++;
                        if (!bullishTimeframes.includes(timeframe)) bullishTimeframes.push(timeframe);
                        log(`  🟢 Divergência BULLISH confirmada em ${timeframe} - Força: ${div.strength.toFixed(1)}%`, 'success');
                    }
                }
            }
            
            for (const div of divergences.bearish) {
                if (div.confirmed) {
                    const added = fundingMemory.addRSIDivergence(symbol, 'bearish', timeframe, div);
                    if (added) {
                        totalBearishDivergences++;
                        if (!bearishTimeframes.includes(timeframe)) bearishTimeframes.push(timeframe);
                        log(`  🔴 Divergência BEARISH confirmada em ${timeframe} - Força: ${div.strength.toFixed(1)}%`, 'success');
                    }
                }
            }
            
            results.push({
                timeframe,
                hasBullish: divergences.bullish.length > 0,
                hasBearish: divergences.bearish.length > 0,
                bullishCount: divergences.bullish.filter(d => d.confirmed).length,
                bearishCount: divergences.bearish.filter(d => d.confirmed).length,
                lastRSI: lastRSI,
                isOverbought: lastRSI > CONFIG.MONITOR.RSI.OVERBOUGHT,
                isOversold: lastRSI < CONFIG.MONITOR.RSI.OVERSOLD,
                divergences
            });
            
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            log(`Erro ao analisar RSI para ${symbol} ${timeframe}: ${error.message}`, 'error');
        }
    }
    
    const counts = fundingMemory.getRSIDivergenceCount(symbol);
    
    return {
        symbol,
        totalBullishDivergences: counts.bullish,
        totalBearishDivergences: counts.bearish,
        bullishTimeframes: counts.bullishTimeframes,
        bearishTimeframes: counts.bearishTimeframes,
        details: results
    };
}

// =====================================================================
// === ANALISAR CVD REAL COM WEBSOCKET ===
// =====================================================================
async function analyzeRealCVD(symbol, isPositive) {
    try {
        const cvdData = cvdManager.getCVD(symbol);
        
        if (!cvdData) {
            log(`CVD Real não disponível para ${symbol}`, 'warning');
            return { direction: null, changePercent: 0, cvdValue: 0, buySellRatio: 0 };
        }
        
        // Calcular mudança nos últimos segundos configurados
        const cvdChange = cvdManager.calculateCVDChange(symbol, CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW);
        
        // Analisar tendência baseada no histórico
        const history = cvdManager.getCVDHistory(symbol, 100);
        let trend = 0;
        let trendStrength = 0;
        
        if (history.length >= 10) {
            const oldCVD = history[0].cvd;
            const newCVD = history[history.length - 1].cvd;
            trend = newCVD - oldCVD;
            trendStrength = Math.abs(trend / (Math.abs(oldCVD) || 1)) * 100;
        }
        
        let direction = null;
        let alertReason = '';
        
        // Determinar direção baseado no CVD
        if (isPositive) {
            // Funding alto: queremos CVD caindo (sinal de venda)
            if (cvdChange.change < 0 && cvdChange.changePercent >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
                direction = 'SELL';
                alertReason = `CVD caindo ${cvdChange.changePercent.toFixed(1)}%`;
            } else if (trend < 0 && trendStrength >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
                direction = 'SELL';
                alertReason = `Tendência CVD negativa ${trendStrength.toFixed(1)}%`;
            }
        } else {
            // Funding baixo: queremos CVD subindo (sinal de compra)
            if (cvdChange.change > 0 && cvdChange.changePercent >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
                direction = 'BUY';
                alertReason = `CVD subindo ${cvdChange.changePercent.toFixed(1)}%`;
            } else if (trend > 0 && trendStrength >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
                direction = 'BUY';
                alertReason = `Tendência CVD positiva ${trendStrength.toFixed(1)}%`;
            }
        }
        
        return {
            direction,
            changePercent: cvdChange.changePercent,
            cvdValue: cvdData.cvd,
            buySellRatio: cvdData.buySellRatio,
            buyVolume: cvdData.buyVolume,
            sellVolume: cvdData.sellVolume,
            totalTrades: cvdData.totalTrades,
            lastPrice: cvdData.lastPrice,
            alertReason,
            trend,
            trendStrength
        };
        
    } catch (error) {
        log(`Erro ao analisar CVD Real para ${symbol}: ${error.message}`, 'error');
        return { direction: null, changePercent: 0, cvdValue: 0, buySellRatio: 0 };
    }
}

// =====================================================================
// === BUSCAR DADOS DE 24H ===
// =====================================================================
async function get24hData() {
    try {
        const response = await rateLimitedFetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await response.json();
        
        const filtered = data.filter(item => 
            item.symbol.endsWith('USDT') && 
            parseFloat(item.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT &&
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(item.symbol)
        );
        
        const result = {};
        for (const item of filtered) {
            result[item.symbol] = {
                symbol: item.symbol,
                price: parseFloat(item.lastPrice),
                volume24h: parseFloat(item.quoteVolume),
                change24h: parseFloat(item.priceChangePercent)
            };
        }
        return result;
    } catch (error) {
        log(`Erro ao buscar dados 24h: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR FUNDING RATE ===
// =====================================================================
async function getFundingRates(symbols) {
    try {
        const response = await rateLimitedFetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await response.json();
        
        const result = {};
        for (const item of data) {
            if (symbols.includes(item.symbol)) {
                result[item.symbol] = parseFloat(item.lastFundingRate);
            }
        }
        return result;
    } catch (error) {
        log(`Erro ao buscar funding rates: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR LSR ===
// =====================================================================
async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const promises = symbols.map(async (symbol) => {
            try {
                const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
                const response = await rateLimitedFetch(url);
                const data = await response.json();
                if (data && data.length > 0) {
                    return { symbol, lsr: parseFloat(data[0].longShortRatio) };
                }
                return { symbol, lsr: null };
            } catch (e) {
                return { symbol, lsr: null };
            }
        });
        
        const results = await Promise.all(promises);
        const result = {};
        for (const item of results) {
            result[item.symbol] = item.lsr;
        }
        return result;
    } catch (error) {
        log(`Erro ao buscar LSR: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === OBTER RANKING E ATUALIZAR MEMÓRIA ===
// =====================================================================
async function updateWatchedSymbols() {
    const tickerData = await get24hData();
    const symbols = Object.keys(tickerData);
    
    if (symbols.length === 0) {
        log('Nenhum símbolo encontrado', 'warning');
        return null;
    }
    
    const fundingRates = await getFundingRates(symbols);
    const lsrData = await getLSRData(symbols);
    
    const combined = [];
    for (const symbol of symbols) {
        const ticker = tickerData[symbol];
        const funding = fundingRates[symbol];
        const lsr = lsrData[symbol];
        
        if (funding !== undefined && lsr !== null && lsr > 0) {
            combined.push({
                symbol: symbol.replace('USDT', ''),
                fullSymbol: symbol,
                price: ticker.price,
                funding: funding,
                fundingPercent: funding * 100,
                lsr: lsr,
                volume24h: ticker.volume24h,
                change24h: ticker.change24h
            });
        }
    }
    
    log(`Analisando ${combined.length} símbolos...`, 'info');
    
    const positive = [...combined]
        .sort((a, b) => b.funding - a.funding)
        .slice(0, CONFIG.MONITOR.TOP_SIZE * 2)
        .sort((a, b) => b.lsr - a.lsr)
        .slice(0, CONFIG.MONITOR.TOP_SIZE);
    
    const negative = [...combined]
        .sort((a, b) => a.funding - b.funding)
        .slice(0, CONFIG.MONITOR.TOP_SIZE * 2)
        .sort((a, b) => a.lsr - b.lsr)
        .slice(0, CONFIG.MONITOR.TOP_SIZE);
    
    fundingMemory.updateWatchedSymbols(positive, negative);
    
    return { positive, negative, total: combined.length };
}

// =====================================================================
// === MONITORAR CVD REAL + BOLLINGER + VALIDAÇÃO DE RSI ===
// =====================================================================
async function monitorCVDAndRSI() {
    const watched = fundingMemory.getWatchedSymbols();
    const alerts = [];
    
    const allSymbols = [...watched.positive, ...watched.negative];
    const rsiResults = new Map();
    
    // Inscrever símbolos no CVD Real WebSocket se ainda não estiverem
    for (const item of allSymbols) {
        cvdManager.subscribeToSymbol(item.fullSymbol, (cvdUpdate) => {
            // Callback em tempo real, mas não precisamos fazer nada aqui
            // Os dados serão coletados na análise
        });
    }
    
    for (const item of allSymbols) {
        log(`Analisando RSI para ${item.fullSymbol}...`, 'info');
        const rsiAnalysis = await analyzeRSIDivergences(item.fullSymbol);
        rsiResults.set(item.fullSymbol, rsiAnalysis);
        
        if (rsiAnalysis.totalBullishDivergences > 0 || rsiAnalysis.totalBearishDivergences > 0) {
            log(`📊 ${item.symbol}: ${rsiAnalysis.totalBullishDivergences} divergências de ALTA | ${rsiAnalysis.totalBearishDivergences} divergências de BAIXA`, 'info');
            if (rsiAnalysis.bullishTimeframes.length > 0) {
                log(`   🟢 Timeframes ALTA: ${rsiAnalysis.bullishTimeframes.join(', ')}`, 'info');
            }
            if (rsiAnalysis.bearishTimeframes.length > 0) {
                log(`   🔴 Timeframes BAIXA: ${rsiAnalysis.bearishTimeframes.join(', ')}`, 'info');
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    for (const item of watched.positive) {
        const cvdReal = await analyzeRealCVD(item.fullSymbol, true);
        
        if (cvdReal.direction === 'SELL') {
            const bollingerTouched = await checkBollingerTouch(item.fullSymbol, 'sell');
            const rsiAnalysis = rsiResults.get(item.fullSymbol);
            const hasEnoughBearishDivergences = rsiAnalysis && rsiAnalysis.totalBearishDivergences >= CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
            
            if (bollingerTouched && hasEnoughBearishDivergences && fundingMemory.shouldAlertCVD(item.fullSymbol, 'positive', cvdReal.cvdValue) && fundingMemory.shouldAlertBollinger(item.fullSymbol, 'sell')) {
                alerts.push({
                    ...item,
                    type: 'positive',
                    action: 'VENDA',
                    cvd: cvdReal,
                    timeframe: 'REAL_TIME',
                    volumeChange: cvdReal.changePercent,
                    cvdChangePercent: cvdReal.changePercent,
                    bollingerTouch: 'superior',
                    buySellRatio: cvdReal.buySellRatio,
                    rsiDivergences: {
                        count: rsiAnalysis.totalBearishDivergences,
                        timeframes: rsiAnalysis.bearishTimeframes,
                        details: rsiAnalysis.details
                    }
                });
                log(`✅ Analisar Correção: ${item.symbol} -  + ${rsiAnalysis.totalBearishDivergences} divergências de RSI`, 'success');
                log(`   📊 CVD: ${cvdReal.alertReason} | Buy/Sell Ratio: ${cvdReal.buySellRatio.toFixed(2)}`, 'info');
            } else if (!bollingerTouched) {
                log(`⏳ Aguardando toque na banda SUPERIOR para ${item.symbol} (VENDA)`, 'warning');
            } else if (!hasEnoughBearishDivergences && rsiAnalysis) {
                log(`⏳ Aguardando mais divergências de RSI para ${item.symbol} (VENDA): atualmente ${rsiAnalysis.totalBearishDivergences}/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED}`, 'warning');
            }
        }
    }
    
    for (const item of watched.negative) {
        const cvdReal = await analyzeRealCVD(item.fullSymbol, false);
        
        if (cvdReal.direction === 'BUY') {
            const bollingerTouched = await checkBollingerTouch(item.fullSymbol, 'buy');
            const rsiAnalysis = rsiResults.get(item.fullSymbol);
            const hasEnoughBullishDivergences = rsiAnalysis && rsiAnalysis.totalBullishDivergences >= CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
            
            if (bollingerTouched && hasEnoughBullishDivergences && fundingMemory.shouldAlertCVD(item.fullSymbol, 'negative', cvdReal.cvdValue) && fundingMemory.shouldAlertBollinger(item.fullSymbol, 'buy')) {
                alerts.push({
                    ...item,
                    type: 'negative',
                    action: 'COMPRA',
                    cvd: cvdReal,
                    timeframe: 'REAL_TIME',
                    volumeChange: cvdReal.changePercent,
                    cvdChangePercent: cvdReal.changePercent,
                    bollingerTouch: 'inferior',
                    buySellRatio: cvdReal.buySellRatio,
                    rsiDivergences: {
                        count: rsiAnalysis.totalBullishDivergences,
                        timeframes: rsiAnalysis.bullishTimeframes,
                        details: rsiAnalysis.details
                    }
                });
                log(`✅ Analisar COMPRA: ${item.symbol} -  + ${rsiAnalysis.totalBullishDivergences} divergências de RSI`, 'success');
                log(`   📊 CVD: ${cvdReal.alertReason} | Buy/Sell Ratio: ${cvdReal.buySellRatio.toFixed(2)}`, 'info');
            } else if (!bollingerTouched) {
                log(`⏳ Aguardando toque na banda INFERIOR para ${item.symbol} (COMPRA)`, 'warning');
            } else if (!hasEnoughBullishDivergences && rsiAnalysis) {
                log(`⏳ Aguardando mais divergências de RSI para ${item.symbol} (COMPRA): atualmente ${rsiAnalysis.totalBullishDivergences}/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED}`, 'warning');
            }
        }
    }
    
    return alerts;
}

// =====================================================================
// === FORMATAR ALERTA ===
// =====================================================================
function formatCompleteAlert(alert) {
    const dateTime = getBrazilianDateTime();
    const priceFormatted = formatPrice(alert.price);
    
    const volumeIcon = alert.volumeChange > 0 ? '📈' : '📉';
    const volumeText = alert.volumeChange > 0 ? `+${alert.volumeChange.toFixed(1)}%` : `${alert.volumeChange.toFixed(1)}%`;
    
    const isBuy = alert.type === 'negative';
    const emoji = isBuy ? '🟢💹' : '🔴🔥';
    const acao = alert.action;
    const divergenciaTipo = isBuy ? 'ALTA (Bullish)' : 'BAIXA (Bearish)';
    const divergenciaCount = alert.rsiDivergences.count;
    const required = CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
    const buySellRatio = alert.buySellRatio || 0;
    const ratioText = buySellRatio > 1 ? `🚀 ${buySellRatio.toFixed(2)}x` : `📉 ${buySellRatio.toFixed(2)}x`;
    
    let message = `<i>${emoji} Analisar ${acao}</i>\n`;
    message += `<i>${alert.symbol} | ${priceFormatted} | ${dateTime.full}</i>\n\n`;
    
    message += `<i> FUNDING + LSR</i>\n`;
    if (isBuy) {
        message += `<i>Funding: ${alert.funding >= 0 ? '+' : ''}${alert.fundingPercent.toFixed(4)}% (BAIXO)</i>\n`;
        message += `<i>LSR: ${alert.lsr.toFixed(2)} (BAIXO)</i>\n`;
    } else {
        message += `<i>Funding: ${alert.funding >= 0 ? '+' : ''}${alert.fundingPercent.toFixed(4)}% (ALTO)</i>\n`;
        message += `<i>LSR: ${alert.lsr.toFixed(2)} (ALTO)</i>\n`;
    }
    
    message += `\n<i>📈 CVD</i>\n`;
    message += `<i>${alert.cvd.alertReason}</i>\n`;
    message += `<i>Buy/Sell Ratio: ${ratioText}</i>\n`;
    if (isBuy) {
        message += `<i>Volume de compras: ${(alert.cvd.buyVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    } else {
        message += `<i>Volume de vendas: ${(alert.cvd.sellVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    }
    message += `<i>Total trades: ${alert.cvd.totalTrades}</i>\n`;
    
    message += `\n<i> DIVERGÊNCIA DE RSI (${divergenciaTipo})</i>\n`;
    message += `<i>Timeframes confirmados: ${alert.rsiDivergences.timeframes.join(', ')}</i>\n`;
    message += `\n<i>🤖 Titanium Prime X</i>\n`;
    message += `<i> ${divergenciaCount}/${required} divergências confirmadas</i>`;
    message += `\n<i>⚡ CVD em Tempo Real</i>`;
    
    return message;
}

// =====================================================================
// === FORMATAR MENSAGEM DE ATUALIZAÇÃO ===
// =====================================================================
function formatListMessage(positive, negative, total) {
    const dateTime = getBrazilianDateTime();
    
    let message = `<i> Titanium Prime X</i>\n`;
    message += `<i> ${dateTime.full}</i>\n\n`;
    message += `<i>🔴 FUNDING ALTO (+) + LSR ALTO </i>\n`;
    message += `<i>Par          Preço        Funding%      LSR</i>\n`;
    message += `<i>------------------------------------------------</i>\n`;
    
    for (const item of positive) {
        const fundingStr = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
        message += `<i>${item.symbol.padEnd(12)} ${formatPrice(item.price).padEnd(12)} ${fundingStr.padEnd(12)} ${item.lsr.toFixed(2).padEnd(8)}</i>\n`;
    }
    
    message += `\n<i>🟢 FUNDING BAIXO (-) + LSR BAIXO </i>\n`;
    message += `<i>Par          Preço        Funding%      LSR</i>\n`;
    message += `<i>------------------------------------------------</i>\n`;
    
    for (const item of negative) {
        const fundingStr = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
        message += `<i>${item.symbol.padEnd(12)} ${formatPrice(item.price).padEnd(12)} ${fundingStr.padEnd(12)} ${item.lsr.toFixed(2).padEnd(8)}</i>\n`;
    }
    
    message += `\n<i> Total analisado: ${total} pares</i>`;
    message += `\n<i>⚡ CVD em tempo real</i>`;
    
    return message;
}

// =====================================================================
// === ENVIAR MENSAGEM PARA TELEGRAM ===
// =====================================================================
async function sendToTelegram(message) {
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (response.ok) {
            log('Mensagem enviada com sucesso!', 'success');
            return true;
        } else {
            const error = await response.text();
            log(`Erro ao enviar: ${response.status}`, 'error');
            return false;
        }
    } catch (error) {
        log(`Erro ao enviar Telegram: ${error.message}`, 'error');
        return false;
    }
}

// =====================================================================
// === MENSAGEM DE INICIALIZAÇÃO ===
// =====================================================================
async function sendInitMessage() {
    const dateTime = getBrazilianDateTime();
    const rateLimiterStats = rateLimiter.getStats();
    
    let message = `<i>🚀 Titanium Prime X - Sistema Completo</i>\n\n`;
    message += `<i>✅ Módulos ativos:</i>\n`;
    message += `<i>  • CVD REAL (WebSocket - Aggregated Trades)</i>\n`;
    message += `<i>  • RSI Divergence (${CONFIG.MONITOR.RSI.TIMEFRAMES.length} timeframes)</i>\n`;
    message += `<i>  • Bollinger Bands (${CONFIG.MONITOR.BOLLINGER.TIMEFRAME})</i>\n`;
    message += `<i>  • Rate Limiter Adaptativo</i>\n`;
    message += `<i>  • Storage Cleaner Automático</i>\n\n`;
    message += `<i>⚡ Rate Limiter: ${rateLimiterStats.currentDelay}ms delay</i>\n`;
    message += `<i>🧹 Storage: max ${CONFIG.MONITOR.STORAGE.MAX_TOTAL_SIZE_MB}MB</i>\n`;
    message += `<i>📊 CVD: janela ${CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW}s</i>\n\n`;
    message += `<i>⏰ Sistema iniciado: ${dateTime.full}</i>`;
    
    await sendToTelegram(message);
}

// =====================================================================
// === LOOP PRINCIPAL ===
// =====================================================================
async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X - SISTEMA COMPLETO');
    console.log('='.repeat(70));
    console.log(`📊 Lista atualizada: a cada ${CONFIG.MONITOR.INTERVAL_MINUTES} minutos`);
    console.log(`🔄 CVD Real: WebSocket Aggregated Trades (tempo real)`);
    console.log(`📊 Bollinger (15m): Período ${CONFIG.MONITOR.BOLLINGER.PERIOD} | Desvio ${CONFIG.MONITOR.BOLLINGER.STD_DEVIATION}`);
    console.log(`⭐ RSI: Mínimo ${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED} divergências obrigatórias`);
    console.log(`⚡ Rate Limiter: Delay base ${rateLimiter.baseDelayMs}ms | Max ${rateLimiter.maxDelayMs}ms`);
    console.log(`🧹 Storage Cleaner: Max ${CONFIG.MONITOR.STORAGE.MAX_TOTAL_SIZE_MB}MB | Backup ${CONFIG.MONITOR.STORAGE.MAX_BACKUP_AGE_DAYS} dias`);
    console.log(`📊 CVD Real: Janela ${CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW}s | Min mudança ${CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT}%`);
    console.log('='.repeat(70));
    
    await sendInitMessage();
    
    let listUpdateCount = 0;
    let currentPositive = [];
    let currentNegative = [];
    let totalSymbols = 0;
    
    const initial = await updateWatchedSymbols();
    if (initial) {
        currentPositive = initial.positive;
        currentNegative = initial.negative;
        totalSymbols = initial.total;
        
        // Inscrever todos os símbolos no CVD Real
        for (const item of [...currentPositive, ...currentNegative]) {
            cvdManager.subscribeToSymbol(item.fullSymbol);
        }
        
        const listMessage = formatListMessage(currentPositive, currentNegative, totalSymbols);
        await sendToTelegram(listMessage);
    }
    
    // Monitoramento CVD Real + RSI + Bollinger
    setInterval(async () => {
        try {
            log('🔍 Iniciando verificação de CVD Real + Bollinger + Divergências RSI...', 'info');
            const alerts = await monitorCVDAndRSI();
            
            for (const alert of alerts) {
                const message = formatCompleteAlert(alert);
                await sendToTelegram(message);
                log(`🔔 ALERTA COMPLETO: ${alert.symbol} - ${alert.action}`, 'success');
            }
            
            if (alerts.length > 0) {
                log(`Total de alertas enviados: ${alerts.length}`, 'success');
            }
            
            if (Math.random() < 0.1) {
                const stats = rateLimiter.getStats();
                log(`📊 Rate Limiter Stats: Delay=${stats.currentDelay}ms, Sucesso=${stats.successRate}`, 'info');
            }
            
        } catch (error) {
            log(`Erro no monitoramento: ${error.message}`, 'error');
        }
    }, CONFIG.MONITOR.CVD.CHECK_INTERVAL_SECONDS * 1000);
    
    // Atualização da lista
    setInterval(async () => {
        try {
            listUpdateCount++;
            log(`Atualizando lista #${listUpdateCount}...`, 'info');
            
            const result = await updateWatchedSymbols();
            
            if (result) {
                // Remover inscrições antigas
                const oldSymbols = [...currentPositive.map(s => s.fullSymbol), ...currentNegative.map(s => s.fullSymbol)];
                for (const symbol of oldSymbols) {
                    if (![...result.positive.map(s => s.fullSymbol), ...result.negative.map(s => s.fullSymbol)].includes(symbol)) {
                        cvdManager.unsubscribeFromSymbol(symbol);
                    }
                }
                
                currentPositive = result.positive;
                currentNegative = result.negative;
                totalSymbols = result.total;
                
                // Inscrever novos símbolos
                for (const item of [...currentPositive, ...currentNegative]) {
                    cvdManager.subscribeToSymbol(item.fullSymbol);
                }
                
                const listMessage = formatListMessage(currentPositive, currentNegative, totalSymbols);
                await sendToTelegram(listMessage);
                
                log(`Lista atualizada: ${currentPositive.length} positivos, ${currentNegative.length} negativos`, 'success');
            }
            
        } catch (error) {
            log(`Erro na atualização da lista: ${error.message}`, 'error');
        }
    }, CONFIG.MONITOR.INTERVAL_MINUTES * 60 * 1000);
    
    // Limpeza periódica de storage
    setInterval(() => {
        storageCleaner.performFullCleanup(MEMORY_FILE, ALERT_HISTORY_FILE);
    }, CONFIG.MONITOR.STORAGE.CLEANUP_INTERVAL_HOURS * 3600000);
    
    // Relatório diário de estatísticas
    setInterval(() => {
        const stats = rateLimiter.getStats();
        log(`📊 RELATÓRIO DIÁRIO RATE LIMITER: Delay=${stats.currentDelay}ms, Requests=${stats.success + stats.error}, Erros=${stats.error}, RateLimits=${stats.rateLimit}`, 'info');
        
        // Reportar status dos WebSockets
        const activeConnections = cvdManager.subscribedSymbols.size;
        log(`📡 WebSockets ativos: ${activeConnections} conexões CVD Real`, 'info');
    }, 24 * 3600000);
}

process.on('SIGINT', () => {
    log('\n🛑 Desligando monitor...', 'warning');
    log('📊 Estatísticas finais do Rate Limiter:', 'info');
    console.log(rateLimiter.getStats());
    
    log('🔌 Fechando conexões WebSocket CVD Real...', 'warning');
    cvdManager.cleanup();
    
    process.exit(0);
});

startMonitor().catch(console.error);
