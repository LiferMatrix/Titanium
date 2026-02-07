const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { EMA, RSI, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES AJUSTÁVEIS DO SISTEMA ===
// =====================================================================

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === SISTEMA DE PRIORIDADE POR LIQUIDEZ E LSR ===
const PRIORITY_CONFIG = {
  // ATIVAR/DESATIVAR sistema de prioridade
  ENABLED: true,
  
  // ========== CONFIGURAÇÕES DE LIQUIDEZ ==========
  LIQUIDITY: {
    // VALOR MÍNIMO DE LIQUIDEZ (em USDT) para ser considerado "líquido"
    // Ajuste este valor conforme necessário:
    // - 1.000.000 = 1 milhão USDT (muito conservador)
    // - 500.000 = 500 mil USDT (conservador)
    // - 100.000 = 100 mil USDT (padrão)
    // - 50.000 = 50 mil USDT (agressivo)
    // - 0 = desconsiderar liquidez (monitora tudo)
    MIN_LIQUIDITY_USDT: 50000,
    
    // NÚMERO MÁXIMO DE ATIVOS LÍQUIDOS PARA PRIORIZAR
    // Ex: 50 = monitora os 50 mais líquidos primeiro
    MAX_LIQUID_SYMBOLS: 500,
    
    // PESO DA LIQUIDEZ NO CÁLCULO DE PRIORIDADE (0-100)
    // Quanto maior, mais importante é a liquidez
    LIQUIDITY_WEIGHT: 40
  },
  
  // ========== CONFIGURAÇÕES DE LSR (LONG/SHORT RATIO) ==========
  LSR: {
    // ATIVAR PRIORIDADE POR LSR
    ENABLED: true,
    
    // LSR IDEAL PARA COMPRAS (quanto menor, melhor para comprar)
    // Ativos com LSR abaixo deste valor têm PRIORIDADE ALTA para COMPRA
    IDEAL_BUY_LSR: 2.7,
    
    // LSR IDEAL PARA VENDAS (quanto maior, melhor para vender)
    // Ativos com LSR acima deste valor têm PRIORIDADE ALTA para VENDA
    IDEAL_SELL_LSR: 2.8,
    
    // PESO DO LSR NO CÁLCULO DE PRIORIDADE (0-100)
    // Quanto maior, mais importante é o LSR
    LSR_WEIGHT: 60,
    
    // BÔNUS DE PRIORIDADE PARA LSR IDEAL
    // Valor adicional na pontuação quando LSR está na zona ideal
    PRIORITY_BONUS: 50
  },
  
  // ========== CONFIGURAÇÕES GERAIS DE PRIORIDADE ==========
  GENERAL: {
    // TEMPO DE CACHE PARA DADOS DE PRIORIDADE (em milissegundos)
    // 300000 = 5 minutos
    PRIORITY_CACHE_TTL: 300000,
    
    // MODO DE ORDENAÇÃO:
    // 'LIQUIDITY_ONLY' = apenas pela liquidez
    // 'LSR_ONLY' = apenas pelo LSR
    // 'HYBRID' = combinação de liquidez e LSR (recomendado)
    // 'DYNAMIC' = ajusta pesos automaticamente
    SORT_MODE: 'HYBRID',
    
    // EXIBIR LOGS DETALHADOS DE PRIORIDADE
    VERBOSE_LOGS: true,
    
    // ATUALIZAR PRIORIDADES A CADA CICLO
    UPDATE_EACH_CYCLE: true,
    
    // MÍNIMO DE SÍMBOLOS PARA CONSIDERAR PRIORIDADE
    // Se tiver menos símbolos que isso, ignora prioridade
    MIN_SYMBOLS_FOR_PRIORITY: 10
  }
};

// === CONFIGURAÇÕES DE PERFORMANCE ===
const PERFORMANCE_CONFIG = {
  // TEMPO DE ESPERA ENTRE SÍMBOLOS (em milissegundos)
  SYMBOL_DELAY_MS: 200,
  
  // TEMPO ENTRE CICLOS COMPLETOS (em milissegundos)
  CYCLE_DELAY_MS: 30000,
  
  // NÚMERO MÁXIMO DE SÍMBOLOS POR CICLO
  // 0 = ilimitado (processa todos)
  MAX_SYMBOLS_PER_CYCLE: 0,
  
  // PRIORIZAR SÍMBOLOS COM SINAIS RECENTES
  PRIORITIZE_RECENT_SIGNALS: true,
  
  // TEMPO DE RESFRIAMENTO ENTRE ALERTAS DO MESMO SÍMBOLO (minutos)
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
        this.maxLogDays = 7; // Manter logs por 7 dias
        this.maxCacheDays = 1; // Manter cache por 1 dia
        this.memoryThreshold = 500 * 1024 * 1024; // 500MB
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
    
    // Verificar se símbolo está em cooldown
    isInCooldown(symbol) {
        if (!symbolCooldown[symbol]) return false;
        
        const cooldownMs = PERFORMANCE_CONFIG.COOLDOWN_MINUTES * 60 * 1000;
        return (Date.now() - symbolCooldown[symbol]) < cooldownMs;
    }
    
    // Registrar alerta para cooldown
    registerAlert(symbol) {
        symbolCooldown[symbol] = Date.now();
    }
    
    // Buscar dados de ticker para liquidez (volume 24h)
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
                        liquidity: parseFloat(ticker.quoteVolume) // Volume em USDT
                    };
                }
            });
            
            return tickerMap;
        } catch (error) {
            console.log(`⚠️  Erro ao buscar dados de ticker: ${error.message}`);
            return null;
        }
    }
    
    // Buscar dados de LSR para múltiplos símbolos
    async fetchLSRData(symbols) {
        try {
            const lsrData = {};
            
            // Buscar LSR para cada símbolo (limitado para evitar rate limit)
            const symbolsToFetch = symbols.slice(0, 20); // Limitar a 20 por vez
            
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
                        
                        // Pequena pausa entre requisições
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
    
    // Calcular pontuação de prioridade para um símbolo
    calculatePriorityScore(symbol, tickerData, lsrData) {
        let score = 0;
        const details = {
            symbol: symbol,
            liquidityScore: 0,
            lsrScore: 0,
            buyPriority: 0,
            sellPriority: 0,
            finalScore: 0
        };
        
        // Pontuação baseada na liquidez
        if (tickerData && tickerData[symbol]) {
            const liquidity = tickerData[symbol].liquidity || 0;
            const minLiquidity = PRIORITY_CONFIG.LIQUIDITY.MIN_LIQUIDITY_USDT;
            
            if (liquidity >= minLiquidity) {
                // Normalizar liquidez (0-100)
                const maxExpectedLiquidity = 100000000; // 100 milhões USDT
                const normalizedLiquidity = Math.min((liquidity / maxExpectedLiquidity) * 100, 100);
                details.liquidityScore = normalizedLiquidity;
                score += normalizedLiquidity * (PRIORITY_CONFIG.LIQUIDITY.LIQUIDITY_WEIGHT / 100);
            }
        }
        
        // Pontuação baseada no LSR
        if (lsrData && lsrData[symbol]) {
            const lsr = lsrData[symbol].lsr;
            const idealBuyLSR = PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR;
            const idealSellLSR = PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR;
            
            // Pontuação para COMPRA (LSR baixo é bom)
            if (lsr <= idealBuyLSR) {
                const buyScore = 100 - ((lsr / idealBuyLSR) * 100);
                details.buyPriority = buyScore;
                details.lsrScore += buyScore;
                score += buyScore * (PRIORITY_CONFIG.LSR.LSR_WEIGHT / 100);
                
                // Bônus adicional para LSR ideal
                if (lsr < idealBuyLSR * 0.8) { // 20% abaixo do ideal
                    score += PRIORITY_CONFIG.LSR.PRIORITY_BONUS;
                }
            }
            
            // Pontuação para VENDA (LSR alto é bom)
            if (lsr >= idealSellLSR) {
                const sellScore = Math.min((lsr / idealSellLSR) * 100, 150);
                details.sellPriority = sellScore;
                details.lsrScore += sellScore;
                score += sellScore * (PRIORITY_CONFIG.LSR.LSR_WEIGHT / 100);
                
                // Bônus adicional para LSR ideal
                if (lsr > idealSellLSR * 1.2) { // 20% acima do ideal
                    score += PRIORITY_CONFIG.LSR.PRIORITY_BONUS;
                }
            }
            
            // Pontuação neutra (entre os thresholds)
            if (lsr > idealBuyLSR && lsr < idealSellLSR) {
                // Mais perto do buy threshold = melhor para compra
                // Mais perto do sell threshold = melhor para venda
                const distanceToBuy = Math.abs(lsr - idealBuyLSR);
                const distanceToSell = Math.abs(lsr - idealSellLSR);
                
                if (distanceToBuy < distanceToSell) {
                    const neutralBuyScore = 50 - ((distanceToBuy / idealBuyLSR) * 50);
                    details.buyPriority = neutralBuyScore;
                    details.lsrScore = neutralBuyScore;
                    score += neutralBuyScore * (PRIORITY_CONFIG.LSR.LSR_WEIGHT / 100);
                } else {
                    const neutralSellScore = 50 - ((distanceToSell / idealSellLSR) * 50);
                    details.sellPriority = neutralSellScore;
                    details.lsrScore = neutralSellScore;
                    score += neutralSellScore * (PRIORITY_CONFIG.LSR.LSR_WEIGHT / 100);
                }
            }
        }
        
        details.finalScore = Math.round(score);
        return details;
    }
    
    // Ordenar símbolos por prioridade
    async prioritizeSymbols(symbols) {
        if (!PRIORITY_CONFIG.ENABLED || symbols.length < PRIORITY_CONFIG.GENERAL.MIN_SYMBOLS_FOR_PRIORITY) {
            return symbols; // Retorna na ordem original se desativado ou poucos símbolos
        }
        
        const now = Date.now();
        
        // Usar cache se disponível e recente
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
            // Buscar dados necessários
            const tickerData = await this.fetchTickerData();
            const lsrData = await this.fetchLSRData(symbols);
            
            if (!tickerData && !lsrData) {
                console.log('⚠️  Dados insuficientes para calcular prioridades, usando ordem original');
                return symbols;
            }
            
            // Calcular pontuações para cada símbolo
            const symbolScores = [];
            
            for (const symbol of symbols) {
                // Pular símbolos em cooldown
                if (this.isInCooldown(symbol)) {
                    if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
                        console.log(`⏸️  ${symbol} em cooldown, pulando priorização`);
                    }
                    continue;
                }
                
                const scoreDetails = this.calculatePriorityScore(symbol, tickerData, lsrData);
                
                // Aplicar modo de ordenação
                let finalScore = scoreDetails.finalScore;
                
                switch (PRIORITY_CONFIG.GENERAL.SORT_MODE) {
                    case 'LIQUIDITY_ONLY':
                        finalScore = scoreDetails.liquidityScore;
                        break;
                    case 'LSR_ONLY':
                        finalScore = scoreDetails.lsrScore;
                        break;
                    case 'HYBRID':
                        // Já calculado no calculatePriorityScore
                        break;
                    case 'DYNAMIC':
                        // Ajustar pesos dinamicamente baseado no mercado
                        const marketCondition = this.assessMarketCondition(lsrData);
                        if (marketCondition === 'BULLISH') {
                            finalScore = scoreDetails.liquidityScore * 0.3 + scoreDetails.buyPriority * 0.7;
                        } else if (marketCondition === 'BEARISH') {
                            finalScore = scoreDetails.liquidityScore * 0.3 + scoreDetails.sellPriority * 0.7;
                        }
                        break;
                }
                
                symbolScores.push({
                    symbol: symbol,
                    score: finalScore,
                    details: scoreDetails,
                    liquidity: tickerData && tickerData[symbol] ? tickerData[symbol].liquidity : 0,
                    lsr: lsrData && lsrData[symbol] ? lsrData[symbol].lsr : null
                });
                
                // Armazenar no cache de pontuações
                priorityCache.scores[symbol] = {
                    score: finalScore,
                    liquidity: tickerData && tickerData[symbol] ? tickerData[symbol].liquidity : 0,
                    lsr: lsrData && lsrData[symbol] ? lsrData[symbol].lsr : null,
                    timestamp: now
                };
            }
            
            // Ordenar por pontuação (maior primeiro)
            symbolScores.sort((a, b) => b.score - a.score);
            
            // Limitar número de símbolos se configurado
            let prioritizedSymbols = symbolScores.map(item => item.symbol);
            if (PRIORITY_CONFIG.LIQUIDITY.MAX_LIQUID_SYMBOLS > 0) {
                prioritizedSymbols = prioritizedSymbols.slice(0, PRIORITY_CONFIG.LIQUIDITY.MAX_LIQUID_SYMBOLS);
            }
            
            // Log detalhado se ativado
            if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS && symbolScores.length > 0) {
                console.log('\n🏆 TOP 10 SÍMBOLOS POR PRIORIDADE:');
                symbolScores.slice(0, 10).forEach((item, index) => {
                    const lsrInfo = item.lsr ? `LSR: ${item.lsr.toFixed(2)}` : 'LSR: N/A';
                    const liquidityInfo = item.liquidity ? `Liq: $${(item.liquidity/1000).toFixed(0)}K` : 'Liq: N/A';
                    console.log(`${index + 1}. ${item.symbol} - Score: ${item.score.toFixed(1)} | ${lsrInfo} | ${liquidityInfo}`);
                });
                
                // Mostrar símbolos ideais para compra/venda baseado no LSR
                const idealBuys = symbolScores
                    .filter(item => item.lsr && item.lsr < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR)
                    .slice(0, 5);
                
                const idealSells = symbolScores
                    .filter(item => item.lsr && item.lsr > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR)
                    .slice(0, 5);
                
                if (idealBuys.length > 0) {
                    console.log('\n🟢 IDEAL PARA COMPRA (LSR baixo):');
                    idealBuys.forEach(item => {
                        console.log(`   ${item.symbol} - LSR: ${item.lsr.toFixed(2)} | Score: ${item.score.toFixed(1)}`);
                    });
                }
                
                if (idealSells.length > 0) {
                    console.log('\n🔴 IDEAL PARA VENDA (LSR alto):');
                    idealSells.forEach(item => {
                        console.log(`   ${item.symbol} - LSR: ${item.lsr.toFixed(2)} | Score: ${item.score.toFixed(1)}`);
                    });
                }
            }
            
            // Atualizar cache
            priorityCache.symbols = prioritizedSymbols;
            priorityCache.timestamp = now;
            
            console.log(`✅ Prioridades calculadas: ${prioritizedSymbols.length} símbolos ordenados`);
            return prioritizedSymbols;
            
        } catch (error) {
            console.log(`⚠️  Erro ao calcular prioridades: ${error.message}, usando ordem original`);
            return symbols;
        }
    }
    
    // Avaliar condição geral do mercado baseado no LSR
    assessMarketCondition(lsrData) {
        if (!lsrData) return 'NEUTRAL';
        
        const lsrValues = Object.values(lsrData).map(d => d.lsr).filter(v => v);
        if (lsrValues.length === 0) return 'NEUTRAL';
        
        const avgLSR = lsrValues.reduce((a, b) => a + b, 0) / lsrValues.length;
        
        if (avgLSR < 2.0) return 'BULLISH'; // Muito otimismo pode indicar topo
        if (avgLSR > 2.6) return 'BEARISH'; // Muito pessimismo pode indicar fundo
        
        return 'NEUTRAL';
    }
    
    // Obter informações de prioridade para um símbolo específico
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

// === CONTADOR DE ALERTAS COM RESET DIÁRIO ===
function getAlertCountForSymbol(symbol, type) {
    const currentDate = getBrazilianDateString();
    
    const currentHour = getBrazilianHour();
    if (currentHour >= 21 && lastResetDate !== currentDate) {
        resetDailyCounters();
    }
    
    if (!alertCounter[symbol]) {
        alertCounter[symbol] = {
            buy: 0,
            sell: 0,
            total: 0,
            lastAlert: null,
            dailyBuy: 0,
            dailySell: 0,
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
        symbolBuy: alertCounter[symbol].buy,
        symbolSell: alertCounter[symbol].sell,
        symbolDailyTotal: alertCounter[symbol].dailyTotal,
        symbolDailyBuy: alertCounter[symbol].dailyBuy,
        symbolDailySell: alertCounter[symbol].dailySell,
        globalTotal: globalAlerts,
        dailyTotal: dailyAlerts
    };
}

function resetDailyCounters() {
    const currentDate = getBrazilianDateString();
    
    console.log(`\n🕘 ${getBrazilianDateTime().full} - RESETANDO CONTADORES DIÁRIOS (21h BR)`);
    
    Object.keys(alertCounter).forEach(symbol => {
        alertCounter[symbol].dailyBuy = 0;
        alertCounter[symbol].dailySell = 0;
        alertCounter[symbol].dailyTotal = 0;
    });
    
    dailyAlerts = 0;
    lastResetDate = currentDate;
    
    console.log(`✅ Contadores diários zerados. Global: ${globalAlerts} | Diário: ${dailyAlerts}`);
}

// === MENSAGEM DE INICIALIZAÇÃO SIMPLIFICADA ===
async function sendInitializationMessage() {
    try {
        const now = getBrazilianDateTime();
        
        const message = `
<b>🚀 TITANIUM INICIADO</b>

📅 ${now.full}

✅ Sistema ativo e monitorando
✨ Prioridade por LSR e Liquidez

<i>Alerta de inicialização automática</i>
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

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandles(symbol, '3m', 80);
        if (candles.length < 55) {
            return null;
        }

        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];

        const ema13 = EMA.calculate({ period: 13, values: closes });
        const ema34 = EMA.calculate({ period: 34, values: closes });
        const ema55 = EMA.calculate({ period: 55, values: closes });

        const latestEma13 = ema13[ema13.length - 1];
        const latestEma34 = ema34[ema34.length - 1];
        const latestEma55 = ema55[ema55.length - 1];
        const previousEma13 = ema13[ema13.length - 2];
        const previousEma34 = ema34[ema34.length - 2];

        return {
            currentPrice: currentPrice,
            ema13: latestEma13,
            ema34: latestEma34,
            ema55: latestEma55,
            isAboveEMA55: currentPrice > latestEma55,
            isEMA13CrossingUp: previousEma13 <= previousEma34 && latestEma13 > latestEma34,
            isEMA13CrossingDown: previousEma13 >= previousEma34 && latestEma13 < latestEma34,
            priceCloseAboveEMA55: candles[candles.length - 1].close > latestEma55,
            priceCloseBelowEMA55: candles[candles.length - 1].close < latestEma55
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular EMAs para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 80);
        if (candles.length < 14) {
            return null;
        }

        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        if (!rsiValues || rsiValues.length === 0) {
            return null;
        }

        const latestRSI = rsiValues[rsiValues.length - 1];
        
        return {
            value: latestRSI,
            status: latestRSI < 25 ? 'OVERSOLD' : latestRSI > 75 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular RSI para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getVolume3m(symbol) {
    try {
        const candles = await getCandles(symbol, '3m', 20);
        if (candles.length < 10) {
            return null;
        }

        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const volumeRatio = currentVolume / avgVolume;

        return {
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: volumeRatio,
            isRobust: volumeRatio > 1.2
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular volume para ${symbol}: ${error.message}`);
        return null;
    }
}

async function getVolume1h(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 20);
        if (candles.length < 10) {
            return null;
        }

        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        const volumeRatio = currentVolume / avgVolume;

        return {
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            ratio: volumeRatio
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular volume 1h para ${symbol}: ${error.message}`);
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

async function getATR(symbol) {
    try {
        const candles = await getCandles(symbol, '15m', 28);
        if (candles.length < 14) {
            return null;
        }

        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);

        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14
        });

        if (!atrValues || atrValues.length === 0) {
            return null;
        }

        const latestATR = atrValues[atrValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        const atrPercentage = (latestATR / currentPrice) * 100;

        return {
            value: latestATR,
            percentage: atrPercentage,
            volatility: atrPercentage > 2 ? 'HIGH' : atrPercentage > 1 ? 'MEDIUM' : 'LOW'
        };
    } catch (error) {
        console.log(`⚠️ Erro ao calcular ATR para ${symbol}: ${error.message}`);
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

function calculateEntryWithRetracement(currentPrice, isBullish, atrData) {
    let stopPercentage = 3.0;
    if (atrData) {
        if (atrData.volatility === 'HIGH') stopPercentage = 4.0;
        else if (atrData.volatility === 'MEDIUM') stopPercentage = 3.5;
        else stopPercentage = 2.5;
    }
    
    const stopPrice = isBullish ?
        currentPrice * (1 - stopPercentage / 100) :
        currentPrice * (1 + stopPercentage / 100);
    
    const retracementPercentage = 0.3;
    const entryPrice = isBullish ?
        currentPrice - (currentPrice - stopPrice) * retracementPercentage :
        currentPrice + (stopPrice - currentPrice) * retracementPercentage;
    
    return {
        originalPrice: currentPrice,
        entryPrice: entryPrice,
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        retracementPercentage: retracementPercentage * 100
    };
}

function calculateTargets(entryPrice, stopPrice, isBullish) {
    const TARGET_PERCENTAGES = [1.5, 3.0, 5.0, 8.0, 12.0];
    
    const distanceToStop = Math.abs(entryPrice - stopPrice);
    
    const targets = TARGET_PERCENTAGES.map(percent => {
        const targetPrice = isBullish ?
            entryPrice * (1 + percent / 100) :
            entryPrice * (1 - percent / 100);

        const distanceToTarget = Math.abs(targetPrice - entryPrice);
        const riskReward = distanceToTarget / distanceToStop;

        return {
            target: percent.toFixed(1),
            price: targetPrice.toFixed(6),
            riskReward: riskReward.toFixed(2)
        };
    });

    return targets;
}

// === SINAIS DE COMPRA E VENDA ===
async function checkBuySignal(symbol, prioritySystem) {
    try {
        // Verificar cooldown
        if (prioritySystem.isInCooldown(symbol)) {
            if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
                console.log(`⏸️  ${symbol} em cooldown, pulando análise de compra`);
            }
            return null;
        }

        const [emaData, rsiData, volume3mData] = await Promise.all([
            getEMAs3m(symbol),
            getRSI1h(symbol),
            getVolume3m(symbol)
        ]);

        if (!emaData || !rsiData || !volume3mData) {
            return null;
        }

        const isBuySignal = 
            emaData.isEMA13CrossingUp &&
            emaData.priceCloseAboveEMA55 &&
            rsiData.value < 62 &&
            volume3mData.isRobust;

        if (!isBuySignal) {
            return null;
        }

        const [lsrData, fundingData, atrData, pivotData, volume1hData] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            getATR(symbol),
            analyzePivotPoints(symbol, emaData.currentPrice, true),
            getVolume1h(symbol)
        ]);

        // Verificar se LSR está na zona ideal para compra
        const isIdealLSR = lsrData && lsrData.lsrValue < PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR;
        
        // Calcular entrada com retração
        const entryData = calculateEntryWithRetracement(emaData.currentPrice, true, atrData);
        const targets = calculateTargets(entryData.entryPrice, entryData.stopPrice, true);

        return {
            symbol: symbol,
            type: 'COMPRA',
            originalPrice: emaData.currentPrice,
            entryPrice: entryData.entryPrice,
            stopPrice: entryData.stopPrice,
            stopPercentage: entryData.stopPercentage,
            retracementPercentage: entryData.retracementPercentage,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            isIdealLSR: isIdealLSR,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivotData: pivotData,
            targets: targets,
            priorityInfo: prioritySystem.getSymbolPriorityInfo(symbol)
        };

    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal de compra para ${symbol}: ${error.message}`);
        return null;
    }
}

async function checkSellSignal(symbol, prioritySystem) {
    try {
        // Verificar cooldown
        if (prioritySystem.isInCooldown(symbol)) {
            if (PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
                console.log(`⏸️  ${symbol} em cooldown, pulando análise de venda`);
            }
            return null;
        }

        const [emaData, rsiData, volume3mData] = await Promise.all([
            getEMAs3m(symbol),
            getRSI1h(symbol),
            getVolume3m(symbol)
        ]);

        if (!emaData || !rsiData || !volume3mData) {
            return null;
        }

        const isSellSignal = 
            emaData.isEMA13CrossingDown &&
            emaData.priceCloseBelowEMA55 &&
            rsiData.value > 35 &&
            volume3mData.isRobust;

        if (!isSellSignal) {
            return null;
        }

        const [lsrData, fundingData, atrData, pivotData, volume1hData] = await Promise.all([
            getLSR(symbol),
            getFundingRate(symbol),
            getATR(symbol),
            analyzePivotPoints(symbol, emaData.currentPrice, false),
            getVolume1h(symbol)
        ]);

        // Verificar se LSR está na zona ideal para venda
        const isIdealLSR = lsrData && lsrData.lsrValue > PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR;
        
        // Calcular entrada com retração
        const entryData = calculateEntryWithRetracement(emaData.currentPrice, false, atrData);
        const targets = calculateTargets(entryData.entryPrice, entryData.stopPrice, false);

        return {
            symbol: symbol,
            type: 'VENDA',
            originalPrice: emaData.currentPrice,
            entryPrice: entryData.entryPrice,
            stopPrice: entryData.stopPrice,
            stopPercentage: entryData.stopPercentage,
            retracementPercentage: entryData.retracementPercentage,
            time: getBrazilianDateTime(),
            volume3m: volume3mData,
            volume1h: volume1hData,
            rsi: rsiData.value,
            lsr: lsrData?.lsrValue,
            isIdealLSR: isIdealLSR,
            funding: fundingData?.ratePercent,
            atr: atrData,
            pivotData: pivotData,
            targets: targets,
            priorityInfo: prioritySystem.getSymbolPriorityInfo(symbol)
        };

    } catch (error) {
        console.log(`⚠️ Erro ao verificar sinal de venda para ${symbol}: ${error.message}`);
        return null;
    }
}

// === MENSAGENS DE ALERTA ===
async function sendBuyAlert(signal, prioritySystem) {
    const alertCount = getAlertCountForSymbol(signal.symbol, 'buy');
    
    // Registrar alerta para cooldown
    prioritySystem.registerAlert(signal.symbol);
    
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
    
    const lsrEmoji = signal.lsr < 2.6 ? '🟢' : '🔴';
    
    // Adicionar indicador de LSR ideal
    const lsrIdealIndicator = signal.isIdealLSR ? '🏆 IDEAL' : '';
    
    // Informações de prioridade
    let priorityInfo = '';
    if (signal.priorityInfo) {
        priorityInfo = `\n🎯 Prioridade: ${signal.priorityInfo.score.toFixed(1)}`;
        if (signal.priorityInfo.liquidity) {
            priorityInfo += ` | Liq: $${(signal.priorityInfo.liquidity/1000).toFixed(0)}K`;
        }
        if (signal.priorityInfo.lsr) {
            priorityInfo += ` | LSR: ${signal.priorityInfo.lsr.toFixed(2)}`;
        }
    }
    
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 RESISTÊNCIA: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 SUPORTE: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.pivot) {
            pivotInfo += `\n⚖️ PIVÔ: $${signal.pivotData.pivot.toFixed(6)}`;
        }
    }
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🟢 <i>${signal.symbol} - COMPRA ${lsrIdealIndicator}</i>

${signal.time.full}
Alerta #${alertCount.symbolTotal} (Compra #${alertCount.symbolBuy})
Diário: ${alertCount.symbolDailyTotal} alertas${priorityInfo}

<i>Operação:</i>
• Preço atual: $${signal.originalPrice.toFixed(6)}
• <b>⚠️Região de Entrada:</b> $${signal.entryPrice.toFixed(6)} 
  (Tolerância até suporte: $${signal.pivotData.nearestSupport.price.toFixed(6)} - ${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)
• 💡DICA: Entre na retração (${signal.retracementPercentage}%) ou próximo ao suporte

<i> Indicadores:</i>
• RSI 1h: ${signal.rsi.toFixed(1)} (${signal.rsi < 62 ? '✅' : '❌'})
• Volume 3m: ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr < 2.6 ? '✅' : '❌'} ${signal.isIdealLSR ? '🏆' : ''}
${fundingRateText}
• ATR: ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})

<i> Níveis Importantes:</i>${pivotInfo}
<i> Alvos:</i>
${signal.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
<i>🛑STOP:</i>
• Preço: $${signal.stopPrice.toFixed(6)}
• Distância: ${signal.stopPercentage}%

<i>✨Titanium Volume Priority ✨</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de COMPRA enviado: ${signal.symbol} (Alerta #${alertCount.symbolTotal} deste ativo)`);
}

async function sendSellAlert(signal, prioritySystem) {
    const alertCount = getAlertCountForSymbol(signal.symbol, 'sell');
    
    // Registrar alerta para cooldown
    prioritySystem.registerAlert(signal.symbol);
    
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
    
    const lsrEmoji = signal.lsr > 3.0 ? '🔴' : '🟢';
    
    // Adicionar indicador de LSR ideal
    const lsrIdealIndicator = signal.isIdealLSR ? '🏆 IDEAL' : '';
    
    // Informações de prioridade
    let priorityInfo = '';
    if (signal.priorityInfo) {
        priorityInfo = `\n🎯 Prioridade: ${signal.priorityInfo.score.toFixed(1)}`;
        if (signal.priorityInfo.liquidity) {
            priorityInfo += ` | Liq: $${(signal.priorityInfo.liquidity/1000).toFixed(0)}K`;
        }
        if (signal.priorityInfo.lsr) {
            priorityInfo += ` | LSR: ${signal.priorityInfo.lsr.toFixed(2)}`;
        }
    }
    
    let pivotInfo = '';
    if (signal.pivotData) {
        if (signal.pivotData.nearestSupport) {
            pivotInfo += `\n🔻 SUPORTE: ${signal.pivotData.nearestSupport.type} $${signal.pivotData.nearestSupport.price.toFixed(6)} (${signal.pivotData.nearestSupport.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.nearestResistance) {
            pivotInfo += `\n🔺 RESISTÊNCIA: ${signal.pivotData.nearestResistance.type} $${signal.pivotData.nearestResistance.price.toFixed(6)} (${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)`;
        }
        if (signal.pivotData.pivot) {
            pivotInfo += `\n⚖️ PIVÔ: $${signal.pivotData.pivot.toFixed(6)}`;
        }
    }
    
    const volume3mChange = ((signal.volume3m.currentVolume - signal.volume3m.avgVolume) / signal.volume3m.avgVolume * 100).toFixed(1);
    const volume1hRatio = signal.volume1h ? ` (1h: ${signal.volume1h.ratio.toFixed(2)}x)` : '';
    
    const message = `
🔴 <i>${signal.symbol} - VENDA ${lsrIdealIndicator}</i>

${signal.time.full}
Alerta #${alertCount.symbolTotal} (Venda #${alertCount.symbolSell})
Diário: ${alertCount.symbolDailyTotal} alertas${priorityInfo}

<i>Operação:</i>
• Preço atual: $${signal.originalPrice.toFixed(6)}
• <b>⚠️Região de Entrada:</b> $${signal.entryPrice.toFixed(6)}
  (Tolerância até resistência: $${signal.pivotData.nearestResistance.price.toFixed(6)} - ${signal.pivotData.nearestResistance.distancePercent.toFixed(2)}%)
• 💡DICA: Entre na retração (${signal.retracementPercentage}%) ou próximo à resistência

<i> Indicadores:</i>
• RSI 1h: ${signal.rsi.toFixed(1)} (${signal.rsi > 35 ? '✅' : '❌'})
• Volume 3m: ${signal.volume3m.ratio.toFixed(2)}x (${volume3mChange}%)${volume1hRatio}
${lsrEmoji} LSR: ${signal.lsr?.toFixed(3) || 'N/A'} ${signal.lsr > 3.0 ? '✅' : '❌'} ${signal.isIdealLSR ? '🏆' : ''}
${fundingRateText}
• ATR: ${signal.atr?.percentage?.toFixed(2) || 'N/A'}% (${signal.atr?.volatility || 'N/A'})

<i> Níveis Importantes:</i>${pivotInfo}
<i> Alvos:</i>
${signal.targets.slice(0, 3).map(target => `• ${target.target}%: $${target.price} `).join('\n')}
<i>🛑STOP:</i>
• Preço: $${signal.stopPrice.toFixed(6)}
• Distância: ${signal.stopPercentage}%

<i>✨Titanium Volume Priority ✨</i>
`;

    await sendTelegramAlert(message);
    console.log(`✅ Alerta de VENDA enviado: ${signal.symbol} (Alerta #${alertCount.symbolTotal} deste ativo)`);
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
        
        // Verificar informações de prioridade
        const priorityInfo = prioritySystem.getSymbolPriorityInfo(symbol);
        if (priorityInfo && PRIORITY_CONFIG.GENERAL.VERBOSE_LOGS) {
            console.log(`   📊 Prioridade: ${priorityInfo.score.toFixed(1)} | LSR: ${priorityInfo.lsr?.toFixed(2) || 'N/A'}`);
        }
        
        const buySignal = await checkBuySignal(symbol, prioritySystem);
        if (buySignal) {
            await sendBuyAlert(buySignal, prioritySystem);
            return true;
        }
        
        const sellSignal = await checkSellSignal(symbol, prioritySystem);
        if (sellSignal) {
            await sendSellAlert(sellSignal, prioritySystem);
            return true;
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
        console.log(' TITANIUM ATIVADO - SISTEMA DE PRIORIDADE AVANÇADO');
        console.log('='.repeat(80) + '\n');

        const cleanupSystem = new AdvancedCleanupSystem();
        const prioritySystem = new PrioritySystem();
        
        let cycle = 0;
        while (true) {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} iniciado...`);
            
            // Executar limpeza automática
            cleanupSystem.performFullCleanup();
            
            // Verificar reset de contadores
            const currentHour = getBrazilianHour();
            if (currentHour >= 21 && lastResetDate !== getBrazilianDateString()) {
                resetDailyCounters();
            }
            
            // Ordenar símbolos por prioridade
            let symbolsToMonitor = symbols;
            if (PRIORITY_CONFIG.ENABLED) {
                symbolsToMonitor = await prioritySystem.prioritizeSymbols(symbols);
                
                // Limitar número de símbolos por ciclo se configurado
                if (PERFORMANCE_CONFIG.MAX_SYMBOLS_PER_CYCLE > 0) {
                    symbolsToMonitor = symbolsToMonitor.slice(0, PERFORMANCE_CONFIG.MAX_SYMBOLS_PER_CYCLE);
                    console.log(`📊 Monitorando ${symbolsToMonitor.length}/${symbols.length} símbolos (priorizados)`);
                }
            }
            
            let signalsFound = 0;
            let symbolsAnalyzed = 0;
            
            for (const symbol of symbolsToMonitor) {
                try {
                    const foundSignal = await monitorSymbol(symbol, prioritySystem);
                    if (foundSignal) signalsFound++;
                    
                    symbolsAnalyzed++;
                    
                    // Pausa entre símbolos
                    await new Promise(r => setTimeout(r, PERFORMANCE_CONFIG.SYMBOL_DELAY_MS));
                } catch (error) {
                    continue;
                }
            }
            
            console.log(`\n✅ Ciclo ${cycle} completo.`);
            console.log(`📊 Símbolos analisados: ${symbolsAnalyzed}/${symbols.length}`);
            console.log(`🎯 Sinais encontrados: ${signalsFound}`);
            console.log(`📈 Total global: ${globalAlerts} | Total diário: ${dailyAlerts}`);
            console.log(`🔍 Ativos monitorados: ${Object.keys(alertCounter).length}`);
            
            // Limpar cache básico
            cleanupSystem.cleanupCaches();
            
            // Pausa entre ciclos
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
        // Criar diretórios necessários
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM - SISTEMA DE PRIORIDADE AVANÇADO v2.0');
        console.log('📊 Sistema de Prioridade por Liquidez e LSR');
        console.log('🎯 Configurações Ativas:');
        console.log(`   • LSR Compra Ideal: < ${PRIORITY_CONFIG.LSR.IDEAL_BUY_LSR}`);
        console.log(`   • LSR Venda Ideal: > ${PRIORITY_CONFIG.LSR.IDEAL_SELL_LSR}`);
        console.log(`   • Liquidez: > $${(PRIORITY_CONFIG.LIQUIDITY.MIN_LIQUIDITY_USDT/1000).toFixed(0)}K`);
        console.log(`   • Peso LSR: ${PRIORITY_CONFIG.LSR.LSR_WEIGHT}%`);
        console.log(`   • Peso Liquidez: ${PRIORITY_CONFIG.LIQUIDITY.LIQUIDITY_WEIGHT}%`);
        console.log('🗑️  Sistema de Limpeza Avançado Ativado');
        console.log('⏱️  Cooldown entre alertas: 5 minutos');
        console.log('='.repeat(80) + '\n');
        
        // Verificar dependências
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }
        
        // Inicializar data do último reset
        lastResetDate = getBrazilianDateString();
        
        // Enviar mensagem de inicialização para Telegram
        await sendInitializationMessage();
        
        console.log('✅ Tudo pronto! Iniciando monitoramento com sistema de prioridade...');
        
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO NA INICIALIZAÇÃO: ${error.message}`);
        process.exit(1);
    }
}

// Executar com coleta de lixo forçada se disponível
if (global.gc) {
    console.log('🗑️  Coleta de lixo forçada disponível');
}

// Corrigido: Chama startBot() corretamente
startBot();
