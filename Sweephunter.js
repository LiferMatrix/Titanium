const fetch = require('node-fetch');
const { RSI, Stochastic } = require('technicalindicators');
const fs = require('fs').promises;
const path = require('path');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURAÇÕES ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSy
const TELEGRAM_CHAT_ID = '-100255

// Configurações do fractal (igual ao Pine Script)
const PERIODS = 2; // n = 2 no código original
const FRACTAL_BARS = 3; // 3 ou 5 barras
const MAX_HISTORICAL_FRACTALS = 20;

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
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Limpeza a cada 1 hora
const MAX_CACHE_SIZE = 500; // Máximo de 500 itens no cache
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10 MB máximo por arquivo de log
const MAX_BACKUP_FILES = 5; // Manter apenas 5 arquivos de backup
const ALERTS_HISTORY_LIMIT = 1000; // Manter apenas 1000 alertas no histórico
const DATA_RETENTION_DAYS = 7; // Manter dados por 7 dias

// === CONFIGURAÇÕES PARA EVITAR ALERTAS REPETIDOS ===
const MIN_PRICE_CHANGE_PERCENT = 0.5; // 0.5% de mudança mínima para novo alerta
const DIRECTION_CHANGE_THRESHOLD = 0.1; // 0.1% para considerar mudança de direção

// === VARIÁVEIS GLOBAIS ===
let requestCount = 0;
let requestWindowStart = Date.now();
let candleCache = new Map();
const alertsCooldown = {};
let VALID_SYMBOLS = [];
let totalAlertsSent = 0;
let alertsHistory = []; // Histórico de alertas enviados
let lastCleanup = Date.now();

// Armazenar o último alerta por símbolo para evitar repetições
const lastAlertBySymbol = new Map(); // { symbol: { type, price, fractalLevel, timestamp, direction } }

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
        // Criar diretórios necessários
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
                
                // Limpar backups antigos
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
            
            // Remover itens expirados do cache
            for (const [key, value] of candleCache.entries()) {
                if (now - value.timestamp > CACHE_TTL) {
                    candleCache.delete(key);
                    removedCount++;
                }
            }
            
            // Se ainda estiver acima do limite, remover os mais antigos
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
            
            // Remover alertas antigos
            alertsHistory = alertsHistory.filter(alert => {
                return (now - alert.timestamp) <= retentionTime;
            });
            
            // Limitar tamanho do histórico
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
                cooldownSize: Object.keys(alertsCooldown).length,
                alertsHistorySize: alertsHistory.length,
                lastAlertHistorySize: lastAlertBySymbol.size,
                validSymbolsCount: VALID_SYMBOLS.length,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            };
            
            const statsFile = path.join(this.dataDir, `stats_${new Date().toISOString().split('T')[0]}.json`);
            
            // Manter apenas os últimos 7 dias de estatísticas
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

// Inicializar gerenciador de limpeza
const cleanupManager = new DataCleanupManager();

// ============================================
// FUNÇÃO PARA VERIFICAR SE DEVE ENVIAR NOVO ALERTA
// ============================================

function shouldSendAlert(symbol, newAlert) {
    const lastAlert = lastAlertBySymbol.get(symbol);
    
    // Se não há alerta anterior para este símbolo, enviar
    if (!lastAlert) {
        return true;
    }
    
    const timeSinceLastAlert = Date.now() - lastAlert.timestamp;
    
    // Se passou mais de 30 minutos desde o último alerta, enviar (respeitando cooldown)
    if (timeSinceLastAlert >= COOLDOWN) {
        return true;
    }
    
    // Verificar se é uma direção diferente
    if (lastAlert.type !== newAlert.type) {
        // Direção oposta (BUY vs SELL) - enviar alerta imediatamente
        console.log(`🔄 Mudança de direção detectada em ${symbol}: ${lastAlert.type} -> ${newAlert.type}`);
        return true;
    }
    
    // Mesma direção, verificar se o nível mudou significativamente
    const priceChangePercent = Math.abs((newAlert.fractalLevel - lastAlert.fractalLevel) / lastAlert.fractalLevel) * 100;
    
    if (priceChangePercent >= MIN_PRICE_CHANGE_PERCENT) {
        // Novo nível significativamente diferente
        console.log(`📈 Novo nível detectado em ${symbol}: ${lastAlert.fractalLevel} -> ${newAlert.fractalLevel} (${priceChangePercent.toFixed(2)}% de diferença)`);
        return true;
    }
    
    // Mesmo nível e mesma direção - não enviar alerta repetido
    console.log(`⏭️ Alerta ignorado para ${symbol}: mesmo nível (${newAlert.fractalLevel}) e direção (${newAlert.type}) em menos de ${COOLDOWN/60000} minutos`);
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
// FUNÇÃO DE ENVIO PARA TELEGRAM
// ============================================

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
// DETECÇÃO DE SWEEP (CORRIGIDA - IGUAL AO PINE SCRIPT)
// ============================================

function detectSweep(candles) {
    if (!candles || candles.length < 50) return null;
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const currentIndex = closes.length - 1;
    const currentHigh = highs[currentIndex];
    const currentLow = lows[currentIndex];
    const currentClose = closes[currentIndex];
    
    let dnFractals = []; // Fractals de topo (resistência)
    let upFractals = []; // Fractals de fundo (suporte)
    
    // 1. IDENTIFICAR FRACTAIS (exatamente como no Pine Script)
    // Usar offset -n, começando de PERIODS até length - PERIODS - 1
    for (let i = PERIODS; i < candles.length - PERIODS - 1; i++) {
        // Down Fractal (topo) - Sell
        let isDnFractal = false;
        if (FRACTAL_BARS === 3) {
            // 3-bar fractal: (high[n-1] < high[n]) and (high[n+1] < high[n])
            isDnFractal = highs[i - 1] < highs[i] && highs[i + 1] < highs[i];
        } else if (FRACTAL_BARS === 5) {
            // 5-bar fractal: 2 antes e 2 depois
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
        
        // Up Fractal (fundo) - Buy
        let isUpFractal = false;
        if (FRACTAL_BARS === 3) {
            // 3-bar fractal: (low[n-1] > low[n]) and (low[n+1] > low[n])
            isUpFractal = lows[i - 1] > lows[i] && lows[i + 1] > lows[i];
        } else if (FRACTAL_BARS === 5) {
            // 5-bar fractal: 2 antes e 2 depois
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
    
    // Limitar quantidade de fractais históricos (max 20)
    if (dnFractals.length > MAX_HISTORICAL_FRACTALS) {
        dnFractals = dnFractals.slice(-MAX_HISTORICAL_FRACTALS);
    }
    if (upFractals.length > MAX_HISTORICAL_FRACTALS) {
        upFractals = upFractals.slice(-MAX_HISTORICAL_FRACTALS);
    }
    
    // 2. ANALISAR CADA FRACTAL E DETECTAR SWEEP (lógica completa do Pine Script)
    
    // Analisar Down Fractals (sweep de alta - SELL)
    for (let i = 0; i < dnFractals.length; i++) {
        const fractal = dnFractals[i];
        const fractalPrice = fractal.price;
        const fractalIndex = fractal.index;
        
        // Encontrar o próximo fractal mais alto (limitCount)
        // Isso determina até onde a linha deve ser desenhada
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
        
        // Se não há fractal mais alto, vai até o início
        if (!hasHigherFractal) {
            limitCount = 0;
        }
        
        // Procurar o último pavio que tocou este nível
        // Esta é a parte mais importante da lógica do Pine Script
        let lastWickIndex = -1;
        let wickFound = false;
        let lineActive = false;
        
        // Verificar se o fractal ainda é válido (não foi quebrado por candle fechado)
        for (let j = fractalIndex + 1; j <= currentIndex; j++) {
            // Se encontrou um fractal mais alto antes, parar
            if (hasHigherFractal && j >= limitCount) {
                break;
            }
            
            // Verificar se o preço tocou o nível do fractal
            if (highs[j] >= fractalPrice) {
                // Verificar se é apenas um candle fechado acima (wick)
                if (fractalPrice < closes[j]) {
                    // Candle fechou acima, fractal quebrado por candle fechado
                    // Deve deletar a linha (não é sweep válido)
                    break;
                } else {
                    // Encontrou um pavio que tocou o nível
                    lastWickIndex = j;
                    wickFound = true;
                }
            }
        }
        
        // Se encontrou um pavio, verificar se é o candle atual
        if (wickFound && lastWickIndex === currentIndex) {
            // O último pavio que tocou o nível é o candle atual
            // Isso significa que o sweep está ocorrendo AGORA
            lineActive = true;
        }
        
        // Se a linha está ativa (tocou o nível no candle atual)
        if (lineActive) {
            // Verificar se o preço atual tocou ou ultrapassou o fractal
            const isSweep = currentHigh >= fractalPrice;
            
            if (isSweep) {
                return {
                    type: 'SELL',
                    price: currentClose,
                    fractalLevel: fractalPrice,
                    fractalIndex: fractalIndex,
                    isActive: true
                };
            }
        }
    }
    
    // Analisar Up Fractals (sweep de baixa - BUY)
    for (let i = 0; i < upFractals.length; i++) {
        const fractal = upFractals[i];
        const fractalPrice = fractal.price;
        const fractalIndex = fractal.index;
        
        // Encontrar o próximo fractal mais baixo (limitCount)
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
        
        // Se não há fractal mais baixo, vai até o início
        if (!hasLowerFractal) {
            limitCount = 0;
        }
        
        // Procurar o último pavio que tocou este nível
        let lastWickIndex = -1;
        let wickFound = false;
        let lineActive = false;
        
        // Verificar se o fractal ainda é válido
        for (let j = fractalIndex + 1; j <= currentIndex; j++) {
            if (hasLowerFractal && j >= limitCount) {
                break;
            }
            
            // Verificar se o preço tocou o nível do fractal
            if (lows[j] <= fractalPrice) {
                // Verificar se é apenas um candle fechado abaixo
                if (fractalPrice > closes[j]) {
                    // Candle fechou abaixo, fractal quebrado
                    break;
                } else {
                    // Encontrou um pavio que tocou o nível
                    lastWickIndex = j;
                    wickFound = true;
                }
            }
        }
        
        // Se encontrou um pavio, verificar se é o candle atual
        if (wickFound && lastWickIndex === currentIndex) {
            lineActive = true;
        }
        
        // Se a linha está ativa (tocou o nível no candle atual)
        if (lineActive) {
            // Verificar se o preço atual tocou ou ultrapassou o fractal
            const isSweep = currentLow <= fractalPrice;
            
            if (isSweep) {
                return {
                    type: 'BUY',
                    price: currentClose,
                    fractalLevel: fractalPrice,
                    fractalIndex: fractalIndex,
                    isActive: true
                };
            }
        }
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
        
        return {
            rsi1h: { value: rsiValue }
        };
    } catch (error) {
        return { rsi1h: { value: 'N/A' } };
    }
}

async function getSupportResistance(symbol) {
    return { supports: [], resistances: [] };
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

// ============================================
// FUNÇÃO DE ENVIO DE ALERTA (COM DESTAQUE NA PRIMEIRA LINHA)
// ============================================

async function sendAlert(symbol, sweep, brDateTime, indicators) {
    const isBullish = sweep.type === 'BUY';
    const emoji = isBullish ? '🟢' : '🔴';
    const title = isBullish ? 'Sweep COMPRA' : 'Sweep VENDA';
    const fractalType = isBullish ? 'Fractal de Baixa (Suporte)' : 'Fractal de Alta (Resistência)';
    
    const priceFormatted = formatNumber(sweep.price);
    const fractalFormatted = formatNumber(sweep.fractalLevel);
    
    // Verificar se houve mudança de direção para adicionar destaque
    const lastAlert = lastAlertBySymbol.get(symbol);
    let directionChangeNote = '';
    if (lastAlert && lastAlert.type !== sweep.type) {
        directionChangeNote = '\n🔄 <b>MUDANÇA DE DIREÇÃO DETECTADA!</b>';
    }
    
    // Primeira linha com destaque: emoji + título + ativo + preço
    const message = `<i>${emoji} ${title} - ${symbol} - $${priceFormatted}</i>\n\n` +
                   `<i>Data/Hora: ${brDateTime.date} ${brDateTime.time}hs</i>\n` +
                   `<i>Nível do Fractal: $${fractalFormatted}</i>\n` +
                   `<i>Tipo: ${fractalType}</i>\n` +
                   `<i>RSI 1h: ${indicators.rsi1h.value}</i>${directionChangeNote}\n` +
                   `<i>🤖 Titanium Hunter - Sweep!</i>`;
    
    const sent = await sendTelegramMessage(message);
    
    if (sent) {
        console.log(`✅ ALERTA ENVIADO! ${symbol} - ${sweep.type} - Preço: ${sweep.price} | Fractal: ${sweep.fractalLevel}`);
        totalAlertsSent++;
        
        // Armazenar no histórico
        alertsHistory.push({
            timestamp: Date.now(),
            symbol,
            type: sweep.type,
            price: sweep.price,
            fractalLevel: sweep.fractalLevel,
            brDateTime
        });
        
        // Armazenar último alerta para controle de repetição
        lastAlertBySymbol.set(symbol, {
            type: sweep.type,
            price: sweep.price,
            fractalLevel: sweep.fractalLevel,
            timestamp: Date.now(),
            direction: sweep.type
        });
        
        return true;
    } else {
        console.log(`❌ FALHA AO ENVIAR ALERTA! ${symbol}`);
        return false;
    }
}

// ============================================
// PROCESSAR SÍMBOLO
// ============================================

async function processSymbol(symbol) {
    const now = Date.now();
    
    try {
        const lastAlert = alertsCooldown[symbol];
        if (lastAlert && now - lastAlert < COOLDOWN) {
            return false;
        }
        
        // Buscar candles para detecção de sweep
        const candles = await getCandles(symbol, '1h', CANDLE_LIMIT_SWEEP);
        if (!candles || candles.length < 50) return false;
        
        // Detectar sweep com a lógica corrigida
        const sweep = detectSweep(candles);
        
        if (sweep && sweep.isActive) {
            console.log(`\n🎯 SWEEP DETECTADO! ${symbol} - ${sweep.type}`);
            console.log(`💰 Preço Atual: ${sweep.price}`);
            console.log(`📍 Nível do Fractal: ${sweep.fractalLevel}`);
            console.log(`📊 Tipo: ${sweep.type === 'BUY' ? 'Compra (Suporte quebrado)' : 'Venda (Resistência quebrada)'}`);
            
            // Verificar se deve enviar o alerta (evitar repetições)
            const shouldSend = shouldSendAlert(symbol, sweep);
            
            if (!shouldSend) {
                console.log(`⏭️ Alerta ignorado para ${symbol}: repetido ou mesmo nível`);
                return false;
            }
            
            // Buscar indicadores para complementar
            const indicators = await getIndicators(symbol);
            const brDateTime = getBrazilianDateTime();
            
            // Enviar alerta
            const sent = await sendAlert(symbol, sweep, brDateTime, indicators);
            
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
    console.log(`🔄 Prevenção de repetição: ${MIN_PRICE_CHANGE_PERCENT}% de mudança mínima para mesmo nível`);
    
    for (let i = 0; i < VALID_SYMBOLS.length; i++) {
        const symbol = VALID_SYMBOLS[i];
        const result = await processSymbol(symbol);
        if (result) alertCount++;
        
        // Mostrar progresso
        if ((i + 1) % 10 === 0) {
            console.log(`📊 Progresso: ${i + 1}/${VALID_SYMBOLS.length} (${alertCount} alertas)`);
        }
        
        // Delay entre símbolos para evitar rate limit
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
        
        // Lista completa de símbolos para monitorar
        const symbols = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
            'AEVOUSDT', 'AXLUSDT', 'ZECUSDT', 'TRUMPUSDT', 'TRBUSDT',
            'POLUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT', 'LTCUSDT',
            'REZUSDT', 'PORTALUSDT', 'RVNUSDT', 'SEIUSDT', 'SKLUSDT',
            'SUIUSDT', 'THETAUSDT', 'TIAUSDT', 'UMAUSDT', 'VETUSDT',
            'ILVUSDT', 'ENJUSDT', 'FETUSDT', 'GMXUSDT', 'HBARUSDT',
            'IMXUSDT', 'KAVAUSDT', 'KSMUSDT', 'LDOUSDT', 'SANDUSDT',
            'MANAUSDT', 'TRXUSDT', 'MASKUSDT', 'MBOXUSDT', 'ONDOUSDT',
            'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'INJUSDT',
            'APEUSDT', 'FILUSDT', 'GALAUSDT', 'ICPUSDT', 'CRVUSDT',
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
    
    const testMsg = `<i>🤖 Titanium </i>\n` +
                   `<code>${'='.repeat(35)}</code>\n` +
                   ` <b>alertas :</b> ${MIN_PRICE_CHANGE_PERCENT}% de mudança mínima`;
    
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
    // Inicializar sistema de limpeza
    await cleanupManager.initialize();
    
    // Carregar símbolos
    VALID_SYMBOLS = await loadSymbols();
    
    if (VALID_SYMBOLS.length === 0) {
        console.log('❌ Nenhum símbolo válido encontrado!');
        process.exit(1);
    }
    
    // Testar Telegram
    const telegramOk = await testTelegram();
    if (!telegramOk) {
        console.log('❌ Telegram não está respondendo! Continuando sem envio de mensagens...');
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🤖 TITANIUM `);
    console.log(`${'='.repeat(60)}\n`);
    
    let cycle = 0;
    
    while (true) {
        try {
            cycle++;
            console.log(`\n🔄 CICLO ${cycle} - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
            console.log(`${'='.repeat(60)}`);
            
            await monitorSymbols();
            
            // Verificar se precisa fazer limpeza automática
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
console.log('🤖 TITANIUM ');
console.log('='.repeat(60) + '\n');

// Iniciar o sistema
mainLoop().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
