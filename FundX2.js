const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const MEMORY_FILE = path.join(__dirname, 'fundingMonitorMemory.json');
const ALERT_HISTORY_FILE = path.join(__dirname, 'fundingAlerts.json');
const ALERT_COUNTERS_FILE = path.join(__dirname, 'alertCounters.json');

// =====================================================================
// === SISTEMA DE CONTADOR DE ALERTAS POR ATIVO ===
// =====================================================================
class AlertCounter {
    constructor() {
        this.counters = {}; // Estrutura: { "TURBO": { total: 2, alerts: { "cvd_rsi_buy": 1, "complete_buy": 1 }, lastReset: timestamp } }
        this.loadFromFile();
        this.scheduleDailyReset();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(ALERT_COUNTERS_FILE)) {
                const data = fs.readFileSync(ALERT_COUNTERS_FILE, 'utf8');
                this.counters = JSON.parse(data);
                console.log('📊 Contadores de alertas carregados');
            }
        } catch (error) {
            console.log(`Erro ao carregar contadores: ${error.message}`);
        }
    }

    saveToFile() {
        try {
            fs.writeFileSync(ALERT_COUNTERS_FILE, JSON.stringify(this.counters, null, 2));
        } catch (error) {
            console.log(`Erro ao salvar contadores: ${error.message}`);
        }
    }

    scheduleDailyReset() {
        const now = new Date();
        const target = new Date();
        target.setHours(21, 0, 0, 0); // 21:00:00

        let msUntilTarget = target - now;
        if (msUntilTarget < 0) {
            msUntilTarget += 24 * 60 * 60 * 1000;
        }

        console.log(`⏰ Reset diário de contadores agendado para ${target.toLocaleString()}`);

        setTimeout(() => {
            this.resetAllCounters();
            setInterval(() => this.resetAllCounters(), 24 * 60 * 60 * 1000);
        }, msUntilTarget);
    }

    resetAllCounters() {
        const today = new Date().toISOString().split('T')[0];
        console.log(`🔄 Resetando contadores de alertas (${today})...`);
        
        for (const symbol in this.counters) {
            this.counters[symbol] = {
                total: 0,
                alerts: {
                    cvd_rsi_buy: 0,
                    cvd_rsi_sell: 0,
                    complete_buy: 0,
                    complete_sell: 0
                },
                lastReset: Date.now(),
                resetDate: today
            };
        }
        
        this.saveToFile();
        console.log('✅ Contadores de alertas resetados!');
    }

    // Registra um alerta e retorna o número do alerta (ex: "Alerta 1")
    registerAlert(symbol, alertType, direction) {
        const normalizedSymbol = symbol.replace('USDT', '');
        
        if (!this.counters[normalizedSymbol]) {
            this.counters[normalizedSymbol] = {
                total: 0,
                alerts: {
                    cvd_rsi_buy: 0,
                    cvd_rsi_sell: 0,
                    complete_buy: 0,
                    complete_sell: 0
                },
                lastReset: Date.now(),
                resetDate: new Date().toISOString().split('T')[0]
            };
        }
        
        const counter = this.counters[normalizedSymbol];
        let key = '';
        
        if (alertType === 'cvd_rsi') {
            key = direction === 'COMPRA' ? 'cvd_rsi_buy' : 'cvd_rsi_sell';
        } else {
            key = direction === 'COMPRA' ? 'complete_buy' : 'complete_sell';
        }
        
        // Incrementa o contador específico
        counter.alerts[key] = (counter.alerts[key] || 0) + 1;
        counter.total++;
        
        this.saveToFile();
        
        // Retorna o número do alerta para este tipo específico
        return counter.alerts[key];
    }

    // Obtém o número do próximo alerta para um tipo específico
    getNextAlertNumber(symbol, alertType, direction) {
        const normalizedSymbol = symbol.replace('USDT', '');
        
        if (!this.counters[normalizedSymbol]) {
            return 1;
        }
        
        const counter = this.counters[normalizedSymbol];
        let key = '';
        
        if (alertType === 'cvd_rsi') {
            key = direction === 'COMPRA' ? 'cvd_rsi_buy' : 'cvd_rsi_sell';
        } else {
            key = direction === 'COMPRA' ? 'complete_buy' : 'complete_sell';
        }
        
        return (counter.alerts[key] || 0) + 1;
    }

    // Obtém estatísticas para um símbolo
    getStats(symbol) {
        const normalizedSymbol = symbol.replace('USDT', '');
        return this.counters[normalizedSymbol] || null;
    }
}

// =====================================================================
// === SISTEMA DE LIMPEZA AUTOMÁTICA DE ARMAZENAMENTO ===
// =====================================================================
class StorageCleaner {
    constructor(options = {}, memoryFile = null, alertHistoryFile = null) {
        this.maxFileSizeMB = options.maxFileSizeMB || 10;
        this.maxTotalSizeMB = options.maxTotalSizeMB || 50;
        this.maxFilesPerDir = options.maxFilesPerDir || 5;
        this.maxAgeDays = options.maxAgeDays || 7;
        this.checkIntervalMs = options.checkIntervalMs || 3600000;
        this.cleanupOnStart = options.cleanupOnStart !== false;
        
        this.memoryFile = memoryFile;
        this.alertHistoryFile = alertHistoryFile;
        
        this.init();
    }
    
    init() {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        if (this.cleanupOnStart && this.memoryFile && this.alertHistoryFile) {
            this.performFullCleanup(this.memoryFile, this.alertHistoryFile);
        }
        
        setInterval(() => {
            if (this.memoryFile && this.alertHistoryFile) {
                this.performFullCleanup(this.memoryFile, this.alertHistoryFile);
            }
        }, this.checkIntervalMs);
        
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
        this.baseDelayMs = options.baseDelayMs || 200;
        this.maxDelayMs = options.maxDelayMs || 30000;
        this.minDelayMs = options.minDelayMs || 100;
        this.errorThreshold = options.errorThreshold || 3;
        this.successThreshold = options.successThreshold || 10;
        this.backoffMultiplier = options.backoffMultiplier || 1.8;
        this.recoveryMultiplier = options.recoveryMultiplier || 0.85;
        
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
        this.cvdData = new Map();
        this.subscribedSymbols = new Set();
        this.updateCallbacks = [];
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.lastCVDAlert = new Map();
        
        // Iniciar o reset diário às 21h
        this.scheduleDailyReset();
    }
    
    // Agenda o reset dos volumes para às 21h todos os dias
    scheduleDailyReset() {
        const now = new Date();
        const target = new Date();
        target.setHours(21, 0, 0, 0); // 21:00:00
        
        let msUntilTarget = target - now;
        if (msUntilTarget < 0) {
            // Se já passou das 21h hoje, agenda para amanhã
            msUntilTarget += 24 * 60 * 60 * 1000;
        }
        
        console.log(`⏰ Reset diário de volumes agendado para ${target.toLocaleString()}`);
        
        setTimeout(() => {
            this.resetDailyVolumes();
            // Após o primeiro reset, agenda para executar a cada 24h
            setInterval(() => this.resetDailyVolumes(), 24 * 60 * 60 * 1000);
        }, msUntilTarget);
    }
    
    // Reseta os volumes acumulados de todos os símbolos
    resetDailyVolumes() {
        console.log('🔄 Resetando volumes acumulados (ciclo diário 21h)...');
        
        for (const [symbol, data] of this.cvdData.entries()) {
            data.buyVolume = 0;
            data.sellVolume = 0;
            data.totalTrades = 0;
            // Mantém o histórico? Vamos resetar também para não acumular dados antigos
            data.history = [];
            console.log(`   📊 ${symbol}: volumes resetados`);
        }
        
        console.log('✅ Reset diário de volumes concluído!');
    }
    
    subscribeToSymbol(symbol, callback = null) {
        if (this.subscribedSymbols.has(symbol)) {
            if (callback && !this.updateCallbacks.some(cb => cb.symbol === symbol && cb.callback === callback)) {
                this.updateCallbacks.push({ symbol, callback });
            }
            return;
        }
        
        if (callback) {
            this.updateCallbacks.push({ symbol, callback });
        }
        
        this.subscribedSymbols.add(symbol);
        
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
        
        const data = this.cvdData.get(symbol);
        if (data) {
            data.ws = ws;
        }
    }
    
    processTrade(symbol, trade) {
        const volume = parseFloat(trade.q);
        const price = parseFloat(trade.p);
        const isBuyerMaker = trade.m;
        
        let delta;
        if (isBuyerMaker) {
            delta = -volume;
        } else {
            delta = +volume;
        }
        
        const data = this.cvdData.get(symbol);
        if (!data) return;
        
        data.value += delta;
        data.lastUpdate = Date.now();
        data.lastPrice = price;
        
        if (delta > 0) {
            data.buyVolume += volume;
        } else {
            data.sellVolume += volume;
        }
        data.totalTrades++;
        
        data.history.push({
            timestamp: Date.now(),
            delta: delta,
            volume: volume,
            price: price,
            cvd: data.value,
            isBuy: !isBuyerMaker
        });
        
        if (data.history.length > 1000) {
            data.history.shift();
        }
        
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
        if (!data || data.history.length === 0) return { change: 0, changePercent: 0, currentCVD: 0, oldCVD: 0, period: seconds };
        
        const now = Date.now();
        const cutoff = now - (seconds * 1000);
        
        let oldCVD = null;
        for (let i = data.history.length - 1; i >= 0; i--) {
            if (data.history[i].timestamp <= cutoff) {
                oldCVD = data.history[i];
                break;
            }
        }
        
        if (!oldCVD) return { change: 0, changePercent: 0, currentCVD: data.value, oldCVD: 0, period: seconds };
        
        const change = data.value - oldCVD.cvd;
        let changePercent = Math.abs(change / (Math.abs(oldCVD.cvd) || 1)) * 100;
        changePercent = Math.min(changePercent, 500);
        
        return {
            change,
            changePercent,
            currentCVD: data.value,
            oldCVD: oldCVD.cvd,
            period: seconds
        };
    }
    
    shouldAlertCVDRSI(symbol, type) {
        const key = `${symbol}_${type}`;
        const last = this.lastCVDAlert.get(key);
        const now = Date.now();
        
        if (last && (now - last) < 10 * 60 * 1000) {
            return false;
        }
        
        this.lastCVDAlert.set(key, now);
        return true;
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
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979'
    },
    MONITOR: {
        INTERVAL_MINUTES: 15,
        TOP_SIZE: 8,
        MIN_VOLUME_USDT: 500000,
        MAX_SYMBOLS: 100,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        CVD: {
            TIMEFRAME_1H: '1h',
            TIMEFRAME_15M: '15m',
            CHECK_INTERVAL_SECONDS: 60,
            LOOKBACK_CANDLES: 20,
            MIN_CVD_CHANGE_PERCENT: 5,
            CVD_HISTORY_SECONDS: 300,
            CVD_CHANGE_WINDOW: 60,
            MAX_CVD_CHANGE_PERCENT: 500
        },
        RSI: {
            PERIOD: 14,
            OVERBOUGHT: 70,
            OVERSOLD: 30,
            TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h', '12h', '1d'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCES_REQUIRED: 2,
            MIN_DIVERGENCE_STRENGTH: 5,
            CVD_RSI_BUY_THRESHOLD: 60,
            CVD_RSI_SELL_THRESHOLD: 65,
            CVD_LSR_MAX_BUY: 1.5,  // LSR máximo para alerta de COMPRA (não alertar acima disso)
            CVD_LSR_MIN_SELL: 2.5   // LSR mínimo para alerta de VENDA (só alertar acima disso)
        },
        BOLLINGER: {
            PERIOD: 20,
            STD_DEVIATION: 2,
            TIMEFRAME: '15m',
            APPROACH_PERCENTAGE: 0.5
        },
        STORAGE: {
            MAX_FILE_SIZE_MB: 10,
            MAX_TOTAL_SIZE_MB: 50,
            MAX_BACKUP_AGE_DAYS: 7,
            CLEANUP_INTERVAL_HOURS: 1
        },
        CLUSTERS: {
            LOOKBACK_CANDLES: 200,
            CLUSTER_THRESHOLD: 3,
            MAX_CLUSTERS: 5,
            PRICE_GROUP_PERCENTAGE: 0.5,
            MIN_CLUSTER_STRENGTH: 3,
            ROBUST_CLUSTER_THRESHOLD: 4
        }
    }
};

// =====================================================================
// === INSTANCIAÇÃO ===
// =====================================================================
const storageCleaner = new StorageCleaner({
    maxFileSizeMB: CONFIG.MONITOR.STORAGE.MAX_FILE_SIZE_MB,
    maxTotalSizeMB: CONFIG.MONITOR.STORAGE.MAX_TOTAL_SIZE_MB,
    maxAgeDays: CONFIG.MONITOR.STORAGE.MAX_BACKUP_AGE_DAYS,
    checkIntervalMs: CONFIG.MONITOR.STORAGE.CLEANUP_INTERVAL_HOURS * 3600000
}, MEMORY_FILE, ALERT_HISTORY_FILE);

const rateLimiter = new AdaptiveRateLimiter({
    baseDelayMs: 500,
    maxDelayMs: 30000,
    minDelayMs: 200,
    errorThreshold: 3,
    successThreshold: 10,
    backoffMultiplier: 2,
    recoveryMultiplier: 0.9
});

const cvdManager = new RealCVDManager();
const alertCounter = new AlertCounter();

async function rateLimitedFetch(url, options = {}) {
    return rateLimiter.executeWithRateLimit(
        () => fetch(url, options),
        url,
        'binance-api'
    );
}

// =====================================================================
// === FUNÇÃO ENVIO TELEGRAM COM SANITIZAÇÃO HTML ===
// =====================================================================
async function sendToTelegram(message, retryCount = 0) {
    try {
        const token = CONFIG.TELEGRAM.BOT_TOKEN;
        const chatId = CONFIG.TELEGRAM.CHAT_ID;
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        
        let finalMessage = message;
        
        // Remove tags HTML vazias ou malformadas
        finalMessage = finalMessage.replace(/<i><\/i>/g, '');
        finalMessage = finalMessage.replace(/<i>\s*<\/i>/g, '');
        finalMessage = finalMessage.replace(/<b><\/b>/g, '');
        finalMessage = finalMessage.replace(/<code><\/code>/g, '');
        
        // Verifica balanceamento de tags
        const openTags = (finalMessage.match(/<i>/g) || []).length;
        const closeTags = (finalMessage.match(/<\/i>/g) || []).length;
        if (openTags !== closeTags) {
            finalMessage = finalMessage.replace(/<[^>]*>/g, '');
            console.log(`⚠️ Tags HTML desbalanceadas, removendo formatação`);
        }
        
        // Verifica tamanho
        if (finalMessage.length > 4000) {
            finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
            console.log(`⚠️ Mensagem truncada (${message.length} -> ${finalMessage.length})`);
        }
        
        // Escapa caracteres especiais
        finalMessage = finalMessage.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, '&amp;');
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: finalMessage,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (response.ok) {
            console.log(`✅ Mensagem enviada com sucesso!`);
            return true;
        } else {
            const errorText = await response.text();
            console.log(`❌ Telegram erro ${response.status}: ${errorText.substring(0, 200)}`);
            
            if (response.status === 400 && retryCount === 0 && finalMessage.includes('<')) {
                console.log(`🔄 Tentando enviar sem formatação HTML...`);
                const plainMessage = finalMessage.replace(/<[^>]*>/g, '');
                return await sendToTelegram(plainMessage, retryCount + 1);
            }
            return false;
        }
    } catch (error) {
        console.log(`❌ Telegram exception: ${error.message}`);
        if (retryCount === 0) {
            console.log(`🔄 Tentativa final sem formatação HTML...`);
            const plainMessage = message.replace(/<[^>]*>/g, '');
            return await sendToTelegram(plainMessage, retryCount + 1);
        }
        return false;
    }
}

// =====================================================================
// === SISTEMA DE MEMÓRIA ===
// =====================================================================
class FundingMemory {
    constructor() {
        this.watchedSymbols = { positive: [], negative: [] };
        this.lastUpdate = null;
        this.cvdStatus = new Map();
        this.cvdRsiAlertStatus = new Map();
        this.rsiDivergenceHistory = new Map();
        this.bollingerHistory = new Map();
        this.clusterHistory = new Map(); // Armazenar histórico de clusters
        this.loadFromFile();
    }

    loadFromFile() {
        try {
            if (fs.existsSync(MEMORY_FILE)) {
                const data = fs.readFileSync(MEMORY_FILE, 'utf8');
                const loaded = JSON.parse(data);
                this.watchedSymbols = loaded.watchedSymbols || { positive: [], negative: [] };
                this.lastUpdate = loaded.lastUpdate;
                
                if (loaded.rsiDivergenceHistory) {
                    this.rsiDivergenceHistory = new Map();
                    for (const [key, value] of Object.entries(loaded.rsiDivergenceHistory)) {
                        this.rsiDivergenceHistory.set(key, value);
                    }
                }
                
                if (loaded.bollingerHistory) {
                    this.bollingerHistory = new Map();
                    for (const [key, value] of Object.entries(loaded.bollingerHistory)) {
                        this.bollingerHistory.set(key, value);
                    }
                }
                
                if (loaded.cvdRsiAlertStatus) {
                    this.cvdRsiAlertStatus = new Map();
                    for (const [key, value] of Object.entries(loaded.cvdRsiAlertStatus)) {
                        this.cvdRsiAlertStatus.set(key, value);
                    }
                }
                
                if (loaded.clusterHistory) {
                    this.clusterHistory = new Map();
                    for (const [key, value] of Object.entries(loaded.clusterHistory)) {
                        this.clusterHistory.set(key, value);
                    }
                }
                
                console.log(`📂 Carregados ${this.watchedSymbols.positive.length} positivos e ${this.watchedSymbols.negative.length} negativos`);
            }
        } catch (error) {
            console.log(`Erro ao carregar memória: ${error.message}`);
        }
    }

    saveToFile() {
        try {
            const rsiDivergenceHistoryObj = {};
            for (const [key, value] of this.rsiDivergenceHistory.entries()) {
                rsiDivergenceHistoryObj[key] = value;
            }
            
            const bollingerHistoryObj = {};
            for (const [key, value] of this.bollingerHistory.entries()) {
                bollingerHistoryObj[key] = value;
            }
            
            const cvdRsiAlertStatusObj = {};
            for (const [key, value] of this.cvdRsiAlertStatus.entries()) {
                cvdRsiAlertStatusObj[key] = value;
            }
            
            const clusterHistoryObj = {};
            for (const [key, value] of this.clusterHistory.entries()) {
                clusterHistoryObj[key] = value;
            }
            
            const data = {
                watchedSymbols: this.watchedSymbols,
                lastUpdate: this.lastUpdate,
                rsiDivergenceHistory: rsiDivergenceHistoryObj,
                bollingerHistory: bollingerHistoryObj,
                cvdRsiAlertStatus: cvdRsiAlertStatusObj,
                clusterHistory: clusterHistoryObj
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
        
        if (last.lastAlert && (Date.now() - last.lastAlert) < 5 * 60 * 1000) return false;
        
        if (last.lastCvd && cvdData) {
            const changePercent = Math.abs((cvdData - last.lastCvd) / (last.lastCvd || 1)) * 100;
            if (changePercent < CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) return false;
        }
        
        this.cvdStatus.set(key, { lastAlert: Date.now(), lastCvd: cvdData });
        this.saveToFile();
        return true;
    }
    
    shouldAlertCVDRSI(symbol, type) {
        const key = `${symbol}_${type}_cvd_rsi`;
        const last = this.cvdRsiAlertStatus.get(key);
        
        if (last && last.lastAlert && (Date.now() - last.lastAlert) < 10 * 60 * 1000) return false;
        
        this.cvdRsiAlertStatus.set(key, { lastAlert: Date.now() });
        this.saveToFile();
        return true;
    }

    shouldAlertBollinger(symbol, type) {
        const last = this.bollingerHistory.get(symbol);
        if (last && last.lastAlert && (Date.now() - last.lastAlert) < 4 * 3600000) return false;
        
        this.bollingerHistory.set(symbol, { lastAlert: Date.now() });
        this.saveToFile();
        return true;
    }

    addRSIDivergence(symbol, type, timeframe, details) {
        if (!this.rsiDivergenceHistory.has(symbol)) {
            this.rsiDivergenceHistory.set(symbol, {
                bullishDivergences: [],
                bearishDivergences: [],
                lastAlert: null
            });
        }
        
        const history = this.rsiDivergenceHistory.get(symbol);
        const divergenceList = type === 'bullish' ? history.bullishDivergences : history.bearishDivergences;
        
        const exists = divergenceList.some(d => d.timeframe === timeframe && (Date.now() - d.timestamp) < 3600000);
        
        if (!exists) {
            divergenceList.push({ timeframe, timestamp: Date.now(), details });
            const unique = [...new Map(divergenceList.map(d => [d.timeframe, d])).values()];
            history[type === 'bullish' ? 'bullishDivergences' : 'bearishDivergences'] = unique.slice(-10);
            this.rsiDivergenceHistory.set(symbol, history);
            this.saveToFile();
            return true;
        }
        return false;
    }

    getRSIDivergenceCount(symbol) {
        const history = this.rsiDivergenceHistory.get(symbol);
        if (!history) return { bullish: 0, bearish: 0, bullishTimeframes: [], bearishTimeframes: [] };
        
        const now = Date.now();
        const recentBullish = history.bullishDivergences.filter(d => (now - d.timestamp) < 86400000);
        const recentBearish = history.bearishDivergences.filter(d => (now - d.timestamp) < 86400000);
        
        return {
            bullish: recentBullish.length,
            bearish: recentBearish.length,
            bullishTimeframes: [...new Set(recentBullish.map(d => d.timeframe))],
            bearishTimeframes: [...new Set(recentBearish.map(d => d.timeframe))]
        };
    }
    
    // Função para verificar se existe divergência em timeframe específico (15m ou 1h)
    hasDivergenceInTimeframe(symbol, type) {
        const history = this.rsiDivergenceHistory.get(symbol);
        if (!history) return false;
        
        const now = Date.now();
        const relevantTimeframes = ['15m', '1h'];
        
        if (type === 'bullish') {
            const bullishDivs = history.bullishDivergences.filter(d => 
                relevantTimeframes.includes(d.timeframe) && (now - d.timestamp) < 86400000
            );
            return bullishDivs.length > 0;
        } else {
            const bearishDivs = history.bearishDivergences.filter(d => 
                relevantTimeframes.includes(d.timeframe) && (now - d.timestamp) < 86400000
            );
            return bearishDivs.length > 0;
        }
    }

    shouldAlertRSI(symbol, type) {
        const history = this.rsiDivergenceHistory.get(symbol);
        if (!history) return false;
        if (history.lastAlert && (Date.now() - history.lastAlert) < 4 * 3600000) return false;
        
        const counts = this.getRSIDivergenceCount(symbol);
        const required = CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
        const hasEnough = type === 'bullish' ? counts.bullish >= required : counts.bearish >= required;
        
        if (hasEnough) {
            history.lastAlert = Date.now();
            this.rsiDivergenceHistory.set(symbol, history);
            this.saveToFile();
            return true;
        }
        return false;
    }
    
    updateClusterHistory(symbol, clusters) {
        this.clusterHistory.set(symbol, {
            supports: clusters.supports,
            resistances: clusters.resistances,
            lastUpdate: Date.now()
        });
        this.saveToFile();
    }
    
    getClusterHistory(symbol) {
        return this.clusterHistory.get(symbol) || null;
    }
}

const fundingMemory = new FundingMemory();

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
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
    const icons = { error: '❌', success: '✅', warning: '⚠️', info: 'ℹ️' };
    console.log(`${icons[type]} ${timestamp} - ${message}`);
}

// =====================================================================
// === FUNÇÕES DE CLUSTERS (SUPORTE E RESISTÊNCIA) ROBUSTAS ===
// =====================================================================
async function getClusterLevels(symbol, currentPrice) {
    try {
        // Buscar candles para análise de clusters - usar 1h para maior confiabilidade
        const candles = await getCandles(symbol, '1h', CONFIG.MONITOR.CLUSTERS.LOOKBACK_CANDLES);
        if (!candles || candles.length < 50) return { supports: [], resistances: [] };
        
        // Extrair pontos de virada (máximos e mínimos locais) com janela maior para robustez
        const highs = [];
        const lows = [];
        const lookback = 5; // Janela de 5 candles para identificar topos e fundos
        
        for (let i = lookback; i < candles.length - lookback; i++) {
            let isHigh = true;
            let isLow = true;
            
            for (let j = 1; j <= lookback; j++) {
                if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
                if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
            }
            
            if (isHigh) highs.push(candles[i].high);
            if (isLow) lows.push(candles[i].low);
        }
        
        // Agrupar níveis próximos com percentual ajustado
        const groupPercentage = CONFIG.MONITOR.CLUSTERS.PRICE_GROUP_PERCENTAGE / 100;
        
        function groupLevels(levels, isSupport = true) {
            if (levels.length === 0) return [];
            
            const sorted = [...levels].sort((a, b) => a - b);
            const groups = [];
            
            for (const level of sorted) {
                let added = false;
                for (const group of groups) {
                    const diff = Math.abs(group.price - level) / level;
                    if (diff <= groupPercentage) {
                        group.count++;
                        group.price = (group.price * (group.count - 1) + level) / group.count;
                        added = true;
                        break;
                    }
                }
                if (!added) {
                    groups.push({ price: level, count: 1 });
                }
            }
            
            // Filtrar por threshold mínimo de força (ROBUST_CLUSTER_THRESHOLD)
            const robustThreshold = CONFIG.MONITOR.CLUSTERS.ROBUST_CLUSTER_THRESHOLD;
            return groups
                .filter(g => g.count >= robustThreshold)
                .sort((a, b) => b.count - a.count)
                .slice(0, CONFIG.MONITOR.CLUSTERS.MAX_CLUSTERS);
        }
        
        const supportGroups = groupLevels(lows, true);
        const resistanceGroups = groupLevels(highs, false);
        
        // Filtrar apenas níveis abaixo (suportes) e acima (resistências) do preço atual
        // Para suportes, pegar os mais próximos do preço atual (até 3)
        let supports = supportGroups
            .filter(g => g.price < currentPrice)
            .sort((a, b) => b.price - a.price)
            .slice(0, 3);
        
        // Para resistências, pegar os mais próximos do preço atual (até 3)
        let resistances = resistanceGroups
            .filter(g => g.price > currentPrice)
            .sort((a, b) => a.price - b.price)
            .slice(0, 3);
        
        // Validar se os clusters encontrados são válidos (distância mínima do preço)
        const minDistancePercent = 0.5; // 0.5% de distância mínima
        supports = supports.filter(s => (currentPrice - s.price) / currentPrice * 100 >= minDistancePercent);
        resistances = resistances.filter(r => (r.price - currentPrice) / currentPrice * 100 >= minDistancePercent);
        
        // Se não encontrou clusters robustos, tentar com threshold mais baixo
        if (supports.length === 0 && resistances.length === 0) {
            const fallbackGroups = groupLevels([...lows, ...highs], true);
            const fallbackSupports = fallbackGroups
                .filter(g => g.price < currentPrice && g.count >= CONFIG.MONITOR.CLUSTERS.CLUSTER_THRESHOLD)
                .sort((a, b) => b.price - a.price)
                .slice(0, 2);
            
            const fallbackResistances = fallbackGroups
                .filter(g => g.price > currentPrice && g.count >= CONFIG.MONITOR.CLUSTERS.CLUSTER_THRESHOLD)
                .sort((a, b) => a.price - b.price)
                .slice(0, 2);
            
            return { supports: fallbackSupports, resistances: fallbackResistances };
        }
        
        return { supports, resistances };
        
    } catch (error) {
        log(`Erro ao calcular clusters para ${symbol}: ${error.message}`, 'error');
        return { supports: [], resistances: [] };
    }
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
            open: parseFloat(candle[1]), high: parseFloat(candle[2]), low: parseFloat(candle[3]),
            close: parseFloat(candle[4]), volume: parseFloat(candle[5]), time: candle[0]
        }));
    } catch (error) {
        log(`Erro ao buscar candles ${symbol} ${interval}: ${error.message}`, 'error');
        return [];
    }
}

async function getRSIForTimeframe(symbol, timeframe = '1h') {
    try {
        const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
        if (!candles || candles.length < CONFIG.MONITOR.RSI.PERIOD + 1) return null;
        
        const prices = candles.map(c => c.close);
        const rsiValues = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
        if (!rsiValues || rsiValues.length === 0) return null;
        
        const lastRSI = rsiValues[rsiValues.length - 1];
        return { value: lastRSI, isOverbought: lastRSI > 70, isOversold: lastRSI < 30 };
    } catch (error) {
        log(`Erro ao calcular RSI para ${symbol}: ${error.message}`, 'error');
        return null;
    }
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    return {
        sma, upper: sma + (stdDev * standardDeviation), lower: sma - (stdDev * standardDeviation),
        currentPrice: prices[prices.length - 1]
    };
}

async function checkBollingerTouch(symbol, type) {
    try {
        const candles = await getCandles(symbol, CONFIG.MONITOR.BOLLINGER.TIMEFRAME, CONFIG.MONITOR.BOLLINGER.PERIOD + 10);
        if (!candles || candles.length < CONFIG.MONITOR.BOLLINGER.PERIOD) return false;
        
        const prices = candles.map(c => c.close);
        const bollinger = calculateBollingerBands(prices, CONFIG.MONITOR.BOLLINGER.PERIOD, CONFIG.MONITOR.BOLLINGER.STD_DEVIATION);
        if (!bollinger) return false;
        
        const approach = CONFIG.MONITOR.BOLLINGER.APPROACH_PERCENTAGE;
        if (type === 'buy') {
            const dist = ((bollinger.currentPrice - bollinger.lower) / bollinger.lower) * 100;
            if (dist <= approach && bollinger.currentPrice <= bollinger.sma) return true;
        } else {
            const dist = ((bollinger.upper - bollinger.currentPrice) / bollinger.currentPrice) * 100;
            if (dist <= approach && bollinger.currentPrice >= bollinger.sma) return true;
        }
        return false;
    } catch (error) {
        log(`Erro Bollinger ${symbol}: ${error.message}`, 'error');
        return false;
    }
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period, avgLoss = losses / period;
    const rsiValues = [null];
    rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
        rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    }
    return rsiValues;
}

function findRSIDivergences(prices, rsiValues) {
    const divergences = { bullish: [], bearish: [] };
    if (prices.length < 30) return divergences;
    
    const cfg = { MIN_PRICE_MOVE: 1.5, MIN_RSI_DIFF: 3, MAX_DIST: 20, LOOKBACK: 3, MIN_REVERSION: 2.0 };
    
    function findPivots(data) {
        const pivots = { highs: [], lows: [] };
        for (let i = cfg.LOOKBACK; i < data.length - cfg.LOOKBACK; i++) {
            let isHigh = true, isLow = true;
            for (let j = 1; j <= cfg.LOOKBACK; j++) {
                if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
                if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
            }
            if (isHigh) pivots.highs.push(i);
            if (isLow) pivots.lows.push(i);
        }
        return pivots;
    }
    
    const pivots = findPivots(prices);
    
    for (let i = 0; i < pivots.lows.length; i++) {
        for (let j = i + 1; j < pivots.lows.length && pivots.lows[j] - pivots.lows[i] <= cfg.MAX_DIST; j++) {
            const curr = pivots.lows[i], prev = pivots.lows[j];
            if (prices[curr] < prices[prev] && rsiValues[curr] > rsiValues[prev] && 
                (rsiValues[curr] - rsiValues[prev]) >= cfg.MIN_RSI_DIFF) {
                divergences.bullish.push({ index: curr, confirmed: true });
            }
        }
    }
    
    for (let i = 0; i < pivots.highs.length; i++) {
        for (let j = i + 1; j < pivots.highs.length && pivots.highs[j] - pivots.highs[i] <= cfg.MAX_DIST; j++) {
            const curr = pivots.highs[i], prev = pivots.highs[j];
            if (prices[curr] > prices[prev] && rsiValues[curr] < rsiValues[prev] && 
                (rsiValues[prev] - rsiValues[curr]) >= cfg.MIN_RSI_DIFF) {
                divergences.bearish.push({ index: curr, confirmed: true });
            }
        }
    }
    
    return divergences;
}

async function analyzeRSIDivergences(symbol) {
    let bullishTimeframes = [], bearishTimeframes = [];
    
    for (const tf of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        const candles = await getCandles(symbol, tf, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
        if (!candles || candles.length < 30) continue;
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
        if (!rsi) continue;
        
        const divs = findRSIDivergences(prices, rsi);
        for (const d of divs.bullish) if (d.confirmed && fundingMemory.addRSIDivergence(symbol, 'bullish', tf, d)) bullishTimeframes.push(tf);
        for (const d of divs.bearish) if (d.confirmed && fundingMemory.addRSIDivergence(symbol, 'bearish', tf, d)) bearishTimeframes.push(tf);
    }
    
    const counts = fundingMemory.getRSIDivergenceCount(symbol);
    return {
        symbol,
        totalBullishDivergences: counts.bullish,
        totalBearishDivergences: counts.bearish,
        bullishTimeframes: counts.bullishTimeframes,
        bearishTimeframes: counts.bearishTimeframes
    };
}

async function analyzeRealCVD(symbol, isPositive) {
    try {
        const data = cvdManager.getCVD(symbol);
        if (!data) return { direction: null };
        
        const change = cvdManager.calculateCVDChange(symbol, CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW);
        const capped = Math.min(change.changePercent, CONFIG.MONITOR.CVD.MAX_CVD_CHANGE_PERCENT);
        
        let direction = null, reason = '';
        if (isPositive && change.change < 0 && capped >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
            direction = 'SELL'; reason = `CVD caindo ${capped.toFixed(1)}%`;
        } else if (!isPositive && change.change > 0 && capped >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT) {
            direction = 'BUY'; reason = `CVD subindo ${capped.toFixed(1)}%`;
        }
        
        return { direction, alertReason: reason, changePercent: capped, buySellRatio: data.buySellRatio,
                 buyVolume: data.buyVolume, sellVolume: data.sellVolume, totalTrades: data.totalTrades, lastPrice: data.lastPrice };
    } catch (error) {
        return { direction: null };
    }
}

async function monitorCVDRSIAlerts() {
    const watched = fundingMemory.getWatchedSymbols();
    const alerts = [];
    
    for (const item of [...watched.positive, ...watched.negative]) {
        const cvd = cvdManager.getCVD(item.fullSymbol);
        if (!cvd) continue;
        
        const change = cvdManager.calculateCVDChange(item.fullSymbol, CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW);
        const capped = Math.min(change.changePercent, CONFIG.MONITOR.CVD.MAX_CVD_CHANGE_PERCENT);
        const isUp = change.change > 0 && capped >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT;
        const isDown = change.change < 0 && capped >= CONFIG.MONITOR.CVD.MIN_CVD_CHANGE_PERCENT;
        
        if (!isUp && !isDown) continue;
        
        const rsi = await getRSIForTimeframe(item.fullSymbol, '1h');
        if (!rsi) continue;
        
        // NOVOS CRITÉRIOS PARA CVD+RSI:
        // 1. Para COMPRA (CVD subindo): LSR deve ser <= 1.5 e deve ter divergência de ALTA em 15m ou 1h
        if (isUp && rsi.value < CONFIG.MONITOR.RSI.CVD_RSI_BUY_THRESHOLD) {
            // Verifica LSR máximo para compra
            if (item.lsr > CONFIG.MONITOR.RSI.CVD_LSR_MAX_BUY) {
                console.log(`🚫 Alerta CVD+RSI COMPRA bloqueado para ${item.symbol}: LSR ${item.lsr.toFixed(2)} > ${CONFIG.MONITOR.RSI.CVD_LSR_MAX_BUY}`);
                continue;
            }
            
            // Verifica se tem divergência de ALTA em 15m ou 1h
            const hasBullishDiv = fundingMemory.hasDivergenceInTimeframe(item.fullSymbol, 'bullish');
            if (!hasBullishDiv) {
                console.log(`🚫 Alerta CVD+RSI COMPRA bloqueado para ${item.symbol}: Sem divergência de ALTA em 15m ou 1h`);
                continue;
            }
            
            if (fundingMemory.shouldAlertCVDRSI(item.fullSymbol, 'buy')) {
                // Registrar alerta no contador
                const alertNumber = alertCounter.registerAlert(item.fullSymbol, 'cvd_rsi', 'COMPRA');
                alerts.push({ ...item, type: 'cvd_rsi_buy', action: 'COMPRA (CVD + RSI)', cvdChange: { changePercent: capped },
                              rsi1h: rsi.value, buySellRatio: cvd.buySellRatio, buyVolume: cvd.buyVolume, sellVolume: cvd.sellVolume,
                              totalTrades: cvd.totalTrades, lastPrice: cvd.lastPrice, alertNumber: alertNumber });
            }
        }
        
        // 2. Para VENDA (CVD descendo): LSR deve ser >= 2.5 e deve ter divergência de BAIXA em 15m ou 1h
        if (isDown && rsi.value > CONFIG.MONITOR.RSI.CVD_RSI_SELL_THRESHOLD) {
            // Verifica LSR mínimo para venda
            if (item.lsr < CONFIG.MONITOR.RSI.CVD_LSR_MIN_SELL) {
                console.log(`🚫 Alerta CVD+RSI VENDA bloqueado para ${item.symbol}: LSR ${item.lsr.toFixed(2)} < ${CONFIG.MONITOR.RSI.CVD_LSR_MIN_SELL}`);
                continue;
            }
            
            // Verifica se tem divergência de BAIXA em 15m ou 1h
            const hasBearishDiv = fundingMemory.hasDivergenceInTimeframe(item.fullSymbol, 'bearish');
            if (!hasBearishDiv) {
                console.log(`🚫 Alerta CVD+RSI VENDA bloqueado para ${item.symbol}: Sem divergência de BAIXA em 15m ou 1h`);
                continue;
            }
            
            if (fundingMemory.shouldAlertCVDRSI(item.fullSymbol, 'sell')) {
                // Registrar alerta no contador
                const alertNumber = alertCounter.registerAlert(item.fullSymbol, 'cvd_rsi', 'VENDA');
                alerts.push({ ...item, type: 'cvd_rsi_sell', action: 'VENDA (CVD + RSI)', cvdChange: { changePercent: capped },
                              rsi1h: rsi.value, buySellRatio: cvd.buySellRatio, buyVolume: cvd.buyVolume, sellVolume: cvd.sellVolume,
                              totalTrades: cvd.totalTrades, lastPrice: cvd.lastPrice, alertNumber: alertNumber });
            }
        }
    }
    return alerts;
}

async function monitorCVDAndRSI() {
    const watched = fundingMemory.getWatchedSymbols();
    const alerts = [];
    const results = new Map();
    
    // Analisar divergências apenas para os símbolos que estão sendo monitorados
    for (const item of [...watched.positive, ...watched.negative]) {
        results.set(item.fullSymbol, await analyzeRSIDivergences(item.fullSymbol));
    }
    
    // Para símbolos com funding positivo (alta) - deve ter divergência de BAIXA (bearish)
    for (const item of watched.positive) {
        const cvd = await analyzeRealCVD(item.fullSymbol, true);
        if (cvd.direction === 'SELL') {
            const bollinger = await checkBollingerTouch(item.fullSymbol, 'sell');
            const rsiData = results.get(item.fullSymbol);
            
            // Para VENDA, precisamos de divergências de BAIXA (bearish)
            const hasDiv = rsiData && rsiData.totalBearishDivergences >= CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
            
            if (bollinger && hasDiv && fundingMemory.shouldAlertCVD(item.fullSymbol, 'positive', cvd.cvdValue) && fundingMemory.shouldAlertBollinger(item.fullSymbol, 'sell')) {
                // Adicionar RSI 1h para o alerta
                const rsi1h = await getRSIForTimeframe(item.fullSymbol, '1h');
                
                // Calcular clusters de suporte e resistência
                const clusters = await getClusterLevels(item.fullSymbol, item.price);
                
                // Registrar alerta no contador
                const alertNumber = alertCounter.registerAlert(item.fullSymbol, 'complete', 'VENDA');
                
                alerts.push({ 
                    ...item, 
                    type: 'positive', 
                    action: 'VENDA', 
                    cvd, 
                    bollingerTouch: 'superior',
                    rsiDivergences: { 
                        bearishCount: rsiData.totalBearishDivergences, 
                        bullishCount: rsiData.totalBullishDivergences, 
                        bearishTimeframes: rsiData.bearishTimeframes, 
                        bullishTimeframes: rsiData.bullishTimeframes 
                    },
                    rsi1h: rsi1h ? rsi1h.value : null,
                    clusters: clusters,
                    alertNumber: alertNumber
                });
            }
        }
    }
    
    // Para símbolos com funding negativo (baixa) - deve ter divergência de ALTA (bullish)
    for (const item of watched.negative) {
        const cvd = await analyzeRealCVD(item.fullSymbol, false);
        if (cvd.direction === 'BUY') {
            const bollinger = await checkBollingerTouch(item.fullSymbol, 'buy');
            const rsiData = results.get(item.fullSymbol);
            
            // Para COMPRA, precisamos de divergências de ALTA (bullish)
            const hasDiv = rsiData && rsiData.totalBullishDivergences >= CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED;
            
            if (bollinger && hasDiv && fundingMemory.shouldAlertCVD(item.fullSymbol, 'negative', cvd.cvdValue) && fundingMemory.shouldAlertBollinger(item.fullSymbol, 'buy')) {
                // Adicionar RSI 1h para o alerta
                const rsi1h = await getRSIForTimeframe(item.fullSymbol, '1h');
                
                // Calcular clusters de suporte e resistência
                const clusters = await getClusterLevels(item.fullSymbol, item.price);
                
                // Registrar alerta no contador
                const alertNumber = alertCounter.registerAlert(item.fullSymbol, 'complete', 'COMPRA');
                
                alerts.push({ 
                    ...item, 
                    type: 'negative', 
                    action: 'COMPRA', 
                    cvd, 
                    bollingerTouch: 'inferior',
                    rsiDivergences: { 
                        bearishCount: rsiData.totalBearishDivergences, 
                        bullishCount: rsiData.totalBullishDivergences, 
                        bearishTimeframes: rsiData.bearishTimeframes, 
                        bullishTimeframes: rsiData.bullishTimeframes 
                    },
                    rsi1h: rsi1h ? rsi1h.value : null,
                    clusters: clusters,
                    alertNumber: alertNumber
                });
            }
        }
    }
    return alerts;
}

function formatCVDRSIAlert(alert) {
    const dt = getBrazilianDateTime();
    const isBuy = alert.type === 'cvd_rsi_buy';
    const emoji = isBuy ? '🟢📈 Analisar' : '🔴📉 Analisar';
    const cvdPct = alert.cvdChange.changePercent.toFixed(1);
    const ratio = alert.buySellRatio || 0;
    const ratioText = ratio > 1 ? `🚀 ${ratio.toFixed(2)}x` : `📉 ${ratio.toFixed(2)}x`;
    const rsiStatus = alert.rsi1h > 66 ? '🔴 ' : (alert.rsi1h < 51 ? '🟢' : '');
    
    let msg = `<i>${emoji} ${alert.symbol} - Preço: ${formatPrice(alert.lastPrice || alert.price)} </i>\n`;
    msg += `<i>🔹Alerta: ${alert.alertNumber} - ${dt.full}hs</i>\n`;
    msg += `<i>Criterios: ${alert.action} </i>\n`;
    msg += `<i>Funding: ${alert.funding >= 0 ? '+' : ''}${alert.fundingPercent.toFixed(4)}%</i>\n`;
    msg += `<i>LSR: ${alert.lsr.toFixed(2)}</i>\n`;
    msg += `<i>RSI 1h: ${alert.rsi1h.toFixed(1)} ${rsiStatus}</i>\n`;
    msg += `<i>CVD variação: ${isBuy ? '+' : ''}${cvdPct}% em 60s</i>\n`;
    msg += `<i>Buy/Sell Ratio: ${ratioText}</i>\n`;
    msg += `<i>Volume:</i>\n`;
    msg += `<i>🟢Compras: ${(alert.buyVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    msg += `<i>🔴Vendas: ${(alert.sellVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    msg += `<i>🔍Total trades: ${alert.totalTrades}</i>\n`;
    
    // Adicionar Suportes e Resistências (clusters)
    const clusters = alert.clusters || { supports: [], resistances: [] };
    
    // Formatar suportes - apenas se existirem clusters com dados
    let suporteText = '';
    if (clusters.supports && clusters.supports.length > 0) {
        for (let i = 0; i < clusters.supports.length; i++) {
            const s = clusters.supports[i];
            const forca = s.count >= 5 ? '🔥 FORTE' : (s.count >= 4 ? '⚡ MÉDIO' : '⚠️ FRACO');
            const emojiForca = s.count >= 5 ? '🔥' : (s.count >= 4 ? '⚡' : '⚠️');
            suporteText += `${formatPrice(s.price)} (${s.count}x) ${emojiForca} ${forca}`;
            if (i < clusters.supports.length - 1) suporteText += '  |  ';
        }
    } else {
        suporteText = 'Não Encontrado ';
    }
    
    // Formatar resistências - apenas se existirem clusters com dados
    let resistenciaText = '';
    if (clusters.resistances && clusters.resistances.length > 0) {
        for (let i = 0; i < clusters.resistances.length; i++) {
            const r = clusters.resistances[i];
            const forca = r.count >= 5 ? '🔥 FORTE' : (r.count >= 4 ? '⚡ MÉDIO' : '⚠️ FRACO');
            const emojiForca = r.count >= 5 ? '🔥' : (r.count >= 4 ? '⚡' : '⚠️');
            resistenciaText += `${formatPrice(r.price)} (${r.count}x) ${emojiForca} ${forca}`;
            if (i < clusters.resistances.length - 1) resistenciaText += '  |  ';
        }
    } else {
        resistenciaText = 'Não Encontrado';
    }
    
    msg += `<i> Suporte : ${suporteText}</i>\n`;
    msg += `<i> Resistência : ${resistenciaText}</i>\n`;
    msg += `<i>⭐ Divergência: ${isBuy ? 'ALTA:' : 'BAIXA:'} 15m/1h</i>\n`;
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by  @J4Rviz</i>`;
    return msg;
}

function formatCompleteAlert(alert) {
    const dt = getBrazilianDateTime();
    const isBuy = alert.type === 'negative';
    const emoji = isBuy ? '🟢💹' : '🔴🔥';
    const ratio = alert.cvd.buySellRatio || 0;
    const ratioText = ratio > 1 ? `🚀 ${ratio.toFixed(2)}x` : `📉 ${ratio.toFixed(2)}x`;
    
    // RSI 1h
    const rsiValue = alert.rsi1h;
    const rsiStatus = rsiValue ? (rsiValue > 66 ? '🔴' : (rsiValue < 51 ? '🟢' : '')) : '';
    const rsiLine = rsiValue ? `\n<i>RSI 1h: ${rsiValue.toFixed(1)} ${rsiStatus}</i>` : '';
    
    let msg = `<i>${emoji} ${alert.symbol} Analisar ${alert.action}</i>\n`;
    msg += `<i>🔹Alerta: ${alert.alertNumber} - ${dt.full}hs</i>\n`;
    msg += `<i>Preço: ${formatPrice(alert.lastPrice || alert.price)}</i>\n`;
    msg += `<i>Criterios: FUNDING + LSR</i>\n`;
    msg += `<i>Funding: ${alert.funding >= 0 ? '+' : ''}${alert.fundingPercent.toFixed(4)}%</i>\n`;
    msg += `<i>LSR: ${alert.lsr.toFixed(2)}</i>${rsiLine}\n`;
    msg += `<i>⭐ ${alert.cvd.alertReason}</i>\n`;
    msg += `<i>Buy/Sell Ratio: ${ratioText}</i>\n`;
    msg += `<i>Volume:</i>\n`;
    msg += `<i>🟢Compras CVD: ${(alert.cvd.buyVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    msg += `<i>🔴Vendas CVD: ${(alert.cvd.sellVolume / 1000000).toFixed(2)}M USDT</i>\n`;
    msg += `<i>🔍Total trades: ${alert.cvd.totalTrades}</i>\n`;
    
    // Adicionar Suportes e Resistências (clusters)
    const clusters = alert.clusters || { supports: [], resistances: [] };
    
    // Formatar suportes - apenas se existirem clusters com dados
    let suporteText = '';
    if (clusters.supports && clusters.supports.length > 0) {
        for (let i = 0; i < clusters.supports.length; i++) {
            const s = clusters.supports[i];
            const forca = s.count >= 5 ? '🔥 FORTE' : (s.count >= 4 ? '⚡ MÉDIO' : '⚠️ FRACO');
            const emojiForca = s.count >= 5 ? '🔥' : (s.count >= 4 ? '⚡' : '⚠️');
            suporteText += `${formatPrice(s.price)} (${s.count}x) ${emojiForca} ${forca}`;
            if (i < clusters.supports.length - 1) suporteText += '  |  ';
        }
    } else {
        suporteText = 'Não Encontrado';
    }
    
    // Formatar resistências - apenas se existirem clusters com dados
    let resistenciaText = '';
    if (clusters.resistances && clusters.resistances.length > 0) {
        for (let i = 0; i < clusters.resistances.length; i++) {
            const r = clusters.resistances[i];
            const forca = r.count >= 5 ? '🔥 FORTE' : (r.count >= 4 ? '⚡ MÉDIO' : '⚠️ FRACO');
            const emojiForca = r.count >= 5 ? '🔥' : (r.count >= 4 ? '⚡' : '⚠️');
            resistenciaText += `${formatPrice(r.price)} (${r.count}x) ${emojiForca} ${forca}`;
            if (i < clusters.resistances.length - 1) resistenciaText += '  |  ';
        }
    } else {
        resistenciaText = 'Não Encontrado';
    }
    
    msg += `<i> Suporte : ${suporteText}</i>\n`;
    msg += `<i> Resistência : ${resistenciaText}</i>\n`;
    msg += `<i>⭐ DIVERGÊNCIA DE RSI</i>\n`;
    
    // Mostrar apenas as divergências relevantes para o tipo de alerta
    if (isBuy) {
        // Alerta de COMPRA - mostrar apenas divergências de ALTA (bullish)
        if (alert.rsiDivergences.bullishCount > 0) {
            msg += `<i>📈 ALTA: ${alert.rsiDivergences.bullishCount}/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED} divergências em ${alert.rsiDivergences.bullishTimeframes.join(', ') || 'Nenhum'}</i>\n`;
        } else {
            msg += `<i>📈 ALTA: 0/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED} divergências em Nenhum</i>\n`;
        }
    } else {
        // Alerta de VENDA - mostrar apenas divergências de BAIXA (bearish)
        if (alert.rsiDivergences.bearishCount > 0) {
            msg += `<i>📉 BAIXA: ${alert.rsiDivergences.bearishCount}/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED} divergências em ${alert.rsiDivergences.bearishTimeframes.join(', ') || 'Nenhum'}</i>\n`;
        } else {
            msg += `<i>📉 BAIXA: 0/${CONFIG.MONITOR.RSI.MIN_DIVERGENCES_REQUIRED} divergências em Nenhum</i>\n`;
        }
    }
    msg += `<i>"Não é recomendação de investimento"</i>\n`;
    msg += `<i>🤖 Titanium Prime X by  @J4Rviz</i>`;
    return msg;
}

function formatListMessage(positive, negative) {
    const maxDisplay = 8;
    const posShow = positive.slice(0, maxDisplay);
    const negShow = negative.slice(0, maxDisplay);
    
    let msg = `<i>🔴 FUNDING ALTO + LSR ALTO (${positive.length})</i>\n`;
    msg += `<i>Par     Preço     Funding%    LSR</i>\n`;
    msg += `<i>----------------------------------------</i>\n`;
    for (const item of posShow) {
        const funding = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
        msg += `<i>${item.symbol.padEnd(12)} ${formatPrice(item.price).padEnd(12)} ${funding.padEnd(12)} ${item.lsr.toFixed(2)}</i>\n`;
    }
    if (positive.length > maxDisplay) msg += `<i>... e mais ${positive.length - maxDisplay} símbolos</i>\n`;
    
    msg += `\n<i>🟢 FUNDING BAIXO + LSR BAIXO (${negative.length})</i>\n`;
    msg += `<i>Par     Preço     Funding%    LSR</i>\n`;
    msg += `<i>----------------------------------------</i>\n`;
    for (const item of negShow) {
        const funding = `${item.funding >= 0 ? '+' : ''}${item.fundingPercent.toFixed(4)}%`;
        msg += `<i>${item.symbol.padEnd(12)} ${formatPrice(item.price).padEnd(12)} ${funding.padEnd(12)} ${item.lsr.toFixed(2)}</i>\n`;
    }
    if (negative.length > maxDisplay) msg += `<i>... e mais ${negative.length - maxDisplay} símbolos</i>\n`;
    return msg;
}

async function get24hData() {
    try {
        const res = await rateLimitedFetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        const filtered = data.filter(i => i.symbol.endsWith('USDT') && parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)).slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
        const result = {};
        for (const i of filtered) result[i.symbol] = { symbol: i.symbol, price: parseFloat(i.lastPrice), volume24h: parseFloat(i.quoteVolume), change24h: parseFloat(i.priceChangePercent) };
        return result;
    } catch (error) {
        log(`Erro 24h: ${error.message}`, 'error');
        return {};
    }
}

async function getFundingRates(symbols) {
    try {
        const res = await rateLimitedFetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) if (symbols.includes(i.symbol)) result[i.symbol] = parseFloat(i.lastFundingRate);
        return result;
    } catch (error) {
        log(`Erro funding: ${error.message}`, 'error');
        return {};
    }
}

async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const promises = symbols.map(async s => {
            try {
                const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${period}&limit=1`;
                const res = await rateLimitedFetch(url);
                const data = await res.json();
                return { symbol: s, lsr: data && data.length ? parseFloat(data[0].longShortRatio) : null };
            } catch { return { symbol: s, lsr: null }; }
        });
        const results = await Promise.all(promises);
        const result = {};
        for (const i of results) result[i.symbol] = i.lsr;
        return result;
    } catch (error) {
        log(`Erro LSR: ${error.message}`, 'error');
        return {};
    }
}

async function updateWatchedSymbols() {
    const ticker = await get24hData();
    const symbols = Object.keys(ticker);
    if (!symbols.length) return null;
    
    const funding = await getFundingRates(symbols);
    const lsr = await getLSRData(symbols);
    const combined = [];
    for (const s of symbols) {
        if (funding[s] !== undefined && lsr[s] !== null && lsr[s] > 0) {
            combined.push({ symbol: s.replace('USDT', ''), fullSymbol: s, price: ticker[s].price, funding: funding[s], fundingPercent: funding[s] * 100, lsr: lsr[s] });
        }
    }
    
    const positive = [...combined].sort((a, b) => b.funding - a.funding).slice(0, CONFIG.MONITOR.TOP_SIZE * 2).sort((a, b) => b.lsr - a.lsr).slice(0, CONFIG.MONITOR.TOP_SIZE);
    const negative = [...combined].sort((a, b) => a.funding - b.funding).slice(0, CONFIG.MONITOR.TOP_SIZE * 2).sort((a, b) => a.lsr - b.lsr).slice(0, CONFIG.MONITOR.TOP_SIZE);
    fundingMemory.updateWatchedSymbols(positive, negative);
    return { positive, negative };
}

async function sendInitMessage() {
    const dt = getBrazilianDateTime();
    const stats = rateLimiter.getStats();
    let msg = `<i>🚀 Titanium Prime X</i>\n\n`;
    
    await sendToTelegram(msg);
}

async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X');
    console.log('='.repeat(70));
    
    await sendInitMessage();
    
    let currentPositive = [], currentNegative = [];
    const initial = await updateWatchedSymbols();
    if (initial) {
        currentPositive = initial.positive;
        currentNegative = initial.negative;
        for (const i of [...currentPositive, ...currentNegative]) cvdManager.subscribeToSymbol(i.fullSymbol);
        await sendToTelegram(formatListMessage(currentPositive, currentNegative));
    }
    
    // Monitoramento combinado - ambos os tipos de alertas
    setInterval(async () => {
        try {
            // Alertas completos (CVD + Bollinger + Divergências RSI)
            const alerts = await monitorCVDAndRSI();
            for (const a of alerts) {
                await sendToTelegram(formatCompleteAlert(a));
            }
            
            // Alertas CVD+RSI (simples com novos critérios)
            const cvdRsiAlerts = await monitorCVDRSIAlerts();
            for (const a of cvdRsiAlerts) {
                await sendToTelegram(formatCVDRSIAlert(a));
            }
        } catch (error) {
            console.log(`Erro no monitoramento: ${error.message}`);
        }
    }, CONFIG.MONITOR.CVD.CHECK_INTERVAL_SECONDS * 1000);
    
    setInterval(async () => {
        const result = await updateWatchedSymbols();
        if (result) {
            const old = [...currentPositive.map(s => s.fullSymbol), ...currentNegative.map(s => s.fullSymbol)];
            for (const s of old) if (![...result.positive.map(p => p.fullSymbol), ...result.negative.map(n => n.fullSymbol)].includes(s)) cvdManager.unsubscribeFromSymbol(s);
            currentPositive = result.positive;
            currentNegative = result.negative;
            for (const i of [...currentPositive, ...currentNegative]) cvdManager.subscribeToSymbol(i.fullSymbol);
            await sendToTelegram(formatListMessage(currentPositive, currentNegative));
        }
    }, CONFIG.MONITOR.INTERVAL_MINUTES * 60 * 1000);
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
