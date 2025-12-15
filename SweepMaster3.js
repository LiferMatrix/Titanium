const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL0J5OE';
const TELEGRAM_CHAT_ID = '-1002554';

// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// === CONFIGURAÇÕES DE VOLATILIDADE ===
const VOLATILITY_PERIOD = 20; // Número de velas para cálculo da volatilidade
const VOLATILITY_TIMEFRAME = '15m'; // Alterado para 15 minutos
const VOLATILITY_THRESHOLD = 0.5; // 0.5% de volatilidade mínima
// ATIVOS PARA MONITORAR 
const SYMBOLS = [
    'HUSDT', 'AERGOUSDT', 'HYPERUSDT', 'LABUSDT', 'PIPPINUSDT',
    'JCTUSDT', 'GUNUSDT', 'SFPUSDT', 'GIGGLEUSDT', 'SAHARAUSDT',
    '0GUSDT', 'KOMAUSDT', 'GLMUSDT', 'ZORAUSDT', 'SKYUSDT',
    'FLUXUSDT', 'TSTUSDT', 'SAPIENUSDT', 'ALTUSDT', 'NILUSDT',
    'ACHUSDT', 'VTHOUSDT', 'NXPCUSDT', 'GPSUSDT', 'HOLOUSDT',
    'STXUSDT', 'AWEUSDT', 'UBUSDT', 'CUSDT', 'EPICUSDT',
    'PUMPUSDT', 'PROVEUSDT', 'ERAUSDT', 'YFIUSDT', 'KAIAUSDT',
    'BARDUSDT', 'AVNTUSDT', 'ALLOUSDT', 'FARTCOINUSDT', 'DRIFTUSDT',
    'PUNDIXUSDT', 'FIDAUSDT', 'LINEAUSDT', 'RVVUSDT', 
    'AUSDT', 'OPENUSDT', 'GRIFFAINUSDT', 'FXSUSDT', 'SANTOSUSDT',
    'FHEUSDT', 'BEATUSDT', 'TANSSIUSDT', 'WETUSDT',
    'DAMUSDT', 'YALAUSDT', 'TRADOORUSDT', 'LIGHTUSDT', 'ATUSDT',
    'CGPTUSDT', 'OLUSDT', 'PUMPBTCUSDT', 'XPLUSDT', 'BANANAS31USDT',
    'SOMIUSDT', 'SYSUSDT', 'BRETTUSDT', 'DOGSUSDT', 'MBOXUSDT',
    'COSUSDT', 'FUSDT', 'INITUSDT', 'CCUSDT', 'CELRUSDT',
    'EDENUSDT', 'HEIUSDT', 'HEMIUSDT', 'MIRAUSDT', 'BELUSDT', 
    'TAIKOUSDT', 'GUSDT', 'WCTUSDT', 'SIRENUSDT', 'A2ZUSDT',
    'MOCAUSDT', 'WALUSDT', 'DMCUSDT', 'HMSTRUSDT',
    'BIGTIMEUSDT'
];


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

// 🔵 NOVO: Cache para Open Interest com histórico aprimorado
const oiCache = {};
const OI_CACHE_TTL = 1 * 60 * 1000; // 1 minuto de cache para OI
const OI_HISTORY_SIZE = 30; // Manter 30 pontos históricos
const OI_SMA_PERIOD = 10; // Período da SMA para suavização do OI

// Novos adicionados da lista SYMBOLS
    const DECIMALS_CONFIG = {
    'HUSDT': 5,
    'AERGOUSDT': 4,
    'HYPERUSDT': 5,
    'LABUSDT': 6,
    'PIPPINUSDT': 6,
    'JCTUSDT': 5,
    'GUNUSDT': 6,
    'SFPUSDT': 5,  
    'GIGGLEUSDT': 6,
    'SAHARAUSDT': 6,
    '0GUSDT': 5,
    'KOMAUSDT': 6,
    'GLMUSDT': 4,
    'ZORAUSDT': 5,
    'SKYUSDT': 4,
    'FLUXUSDT': 4,
    'TSTUSDT': 5,
    'SAPIENUSDT': 5,
    'ALTUSDT': 4,
    'NILUSDT': 5,
    'ACHUSDT': 5,
    'VTHOUSDT': 4,
    'NXPCUSDT': 4,
    'GPSUSDT': 4,
    'HOLOUSDT': 5,
    'STXUSDT': 4,
    'AWEUSDT': 5,
    'UBUSDT': 5,
    'CUSDT': 5,
    'EPICUSDT': 5,
    'PUMPUSDT': 6,
    'PROVEUSDT': 5,
    'ERAUSDT': 4,
    'YFIUSDT': 2,
    'KAIAUSDT': 4,
    'BARDUSDT': 5,
    'AVNTUSDT': 5,
    'ALLOUSDT': 5,
    'FARTCOINUSDT': 5,
    'DRIFTUSDT': 4,
    'PUNDIXUSDT': 4,
    'FIDAUSDT': 4,
    'LINEAUSDT': 4,
    'RVVUSDT': 5,
    'AUSDT': 5,
    'OPENUSDT': 4,
    'GRIFFAINUSDT': 5,
    'FXSUSDT': 4,
    'SANTOSUSDT': 4,
    'FHEUSDT': 5,
    'BEATUSDT': 5,
    'TANSSIUSDT': 5,
    'WETUSDT': 6,
    'DAMUSDT': 5,
    'YALAUSDT': 5,
    'TRADOORUSDT': 5,
    'LIGHTUSDT': 5,
    'ATUSDT': 5,
    'CGPTUSDT': 5,
    'OLUSDT': 5,
    'PUMPBTCUSDT': 5,
    'XPLUSDT': 5,
    'BANANAS31USDT': 6,
    'SOMIUSDT': 5,
    'FUSDT': 5,
    'INITUSDT': 5,
    'CCUSDT': 5,
    'CELRUSDT': 5,
    'EDENUSDT': 5,
    'HEIUSDT': 6,
    'HEMIUSDT': 5,
    'MIRAUSDT': 5,
    'BELUSDT': 5,
    'TAIKOUSDT': 4,
    'GUSDT': 6,
    'WCTUSDT': 5,
    'SIRENUSDT': 5,
    'A2ZUSDT': 6,
    'MOCAUSDT': 5,
    'WALUSDT': 6,
    'DMCUSDT': 5,
    'HMSTRUSDT': 6,
    'BIGTIMEUSDT': 5
};
// Default
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
                    console.log(`✅ Usando API histórica para OI de ${symbol} (${oiHistory.length} pontos)`);
                }
            }
        } catch (historicalError) {
            // API histórica não disponível
            console.log(`⚠️ API histórica não disponível para ${symbol}, usando método em memória`);
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

// 🔵 FUNÇÃO OTIMIZADA: Buscar candles com cache e TTL
async function getCandlesCached(symbol, timeframe = '1h', limit = 200) {
    const key = `${symbol}_${timeframe}_${limit}`;
    const now = Date.now();
    
    // Verificar se temos dados em cache válidos
    if (candleCache[key] && now - candleCache[key].ts < CANDLE_CACHE_TTL) {
        return candleCache[key].data;
    }
    
    try {
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
        
        // Armazenar no cache
        candleCache[key] = { data: candles, ts: now };
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
async function checkAbnormalVolume(symbol, multiplier = 2) {
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
        
        // Extrair volumes dos candles anteriores
        const previousVolumes = candles.slice(0, candles.length - 1).map(c => c.volume);
        
        // Calcular média dos volumes anteriores
        const avgVolume = previousVolumes.reduce((sum, vol) => sum + vol, 0) / previousVolumes.length;
        
        // Calcular ratio
        const ratio = avgVolume > 0 ? currentVolume / avgVolume : 0;
        
        // Verificar se é anormal
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
            rawRatio: ratio
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao verificar volume 3m (${symbol}): ${e.message}`);
        return { 
            isAbnormal: false, 
            currentVolume: 0, 
            avgVolume: 0, 
            ratio: 0,
            open: 0,
            close: 0,
            high: 0,
            low: 0,
            rawRatio: 0
        };
    }
}

// 🔴 FUNÇÃO SIMPLIFICADA: Verificar volume anormal
async function checkVolumeConfirmation(symbol, multiplier = 2) {
    const volumeData = await checkAbnormalVolume(symbol, multiplier);
    
    const isVolumeConfirmed = volumeData.isAbnormal;
    
    return {
        isConfirmed: isVolumeConfirmed,
        volumeData: volumeData,
        message: isVolumeConfirmed ? 
            `✅ Volume confirmado (${volumeData.ratio}x)` :
            `❌ Volume não confirmado (ratio: ${volumeData.ratio}x)`
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
        
        console.log(`🎯 ${symbol} - Stop ATR: ${atrData.atr.toFixed(6)} × ${ATR_MULTIPLIER} = ${atrValueUsed.toFixed(6)} (${finalStopPercentage.toFixed(2)}%)`);
        
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
        
        console.log(`⚠️ ${symbol} - ATR não disponível, usando stop fixo de ${stopPercentage}%`);
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

// 🔵 FUNÇÃO ATUALIZADA: Construir mensagem de alerta
function buildAlertMessage(isBullish, symbol, priceFormatted, brDateTime, targetsAndStop, 
                          rsi1h, stoch4h, stochDaily, lsrData, fundingRate, 
                          volumeCheck, orderBook, sweepTime, emas3mData, oiCheck, volatilityCheck) {
    
    const title = isBullish ? '🟢 <b>🤖 COMPRA  </b>' : '🔴 <b>🤖 CORREÇÃO </b>';
    const trend = isBullish ? '🟢Tendência 💹 ema 55 1h' : '🔴Tendência 📉 ema 55 1h';
    const sweepMinutes = sweepTime ? Math.round((Date.now() - sweepTime) / 60000) : 0;
    
    // 🔴 ADICIONAR INFORMAÇÕES DO STOP ATR
    const stopInfo = targetsAndStop.stopType === "ATR" ? 
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n` +
        `    ATR: ${targetsAndStop.atrData.atrFormatted} × ${targetsAndStop.atrMultiplier}\n` +
        `    Melhor R/R: ${targetsAndStop.bestRiskReward}:1\n` :
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n`;
    
    let message = `${title}\n`;
    message += `<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n`;
    message += `<b>#Ativo:</b> #${symbol}\n`;
    message += `<b>$Preço atual:</b> $${priceFormatted}\n`;
    
    // 🔴 ADICIONAR NÍVEIS DE ENTRADA COM RETRAÇÃO ATR
    if (targetsAndStop.entryLevels) {
        const entry = targetsAndStop.entryLevels;
        if (isBullish) {
            message += `<b>  Entrada Sugerida:</b>\n`;
            message += `    $${formatNumber(entry.levels[0].price, symbol, true)} (Imediata)\n`;
            message += `    $${formatNumber(entry.levels[2].price, symbol, true)} (Agressiva)\n`;
        } else {
            message += `<b>  Entrada em 3 níveis:</b>\n`;
            message += `    $${formatNumber(entry.levels[0].price, symbol, true)} (Imediata)\n`;
            message += `    $${formatNumber(entry.levels[2].price, symbol, true)} (Agressiva)\n`;
        }
    } else {
        message += `<b>Entrada:</b> $${priceFormatted}\n`;
    }
    
    message += stopInfo;
    
    // Adicionar alvos com Risk/Reward
    targetsAndStop.targets.forEach((target, index) => {
        const rr = target.riskReward;
        const rrEmoji = parseFloat(rr) >= 3 ? '🎯' : parseFloat(rr) >= 2 ? '✅' : '📊';
        message += isBullish ? 
            ` ${rrEmoji} Alvo ${index + 1} : $${target.formatted} (R/R: ${rr}:1)\n` :
            ` ${rrEmoji} Alvo ${index + 1}: $${target.formatted} (R/R: ${rr}:1)\n`;
    });
    
    // Adicionar indicadores
    if (isBullish) {
        message += ` ${trend}\n`;
    }
    
    message += ` #RSI 1h: <b>${rsi1h.value}</b>\n`;
    message += ` #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n`;
    message += ` #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n`;
    message += ` #LSR : <b>${lsrData.lsrRatio}</b> ${getLsrSymbol(lsrData.lsrRatio)}\n`;
    message += ` #OI 5m: ${oiCheck.trend} <b>${oiCheck.oiFormatted}</b> (${oiCheck.historySize} pts)\n`;
    message += ` #Volatilidade 15m: <b>${volatilityCheck.volatility}%</b> \n`;
    message += ` #Fund.R: ${fundingRate.emoji} <b>${fundingRate.rate}%</b>\n`;
    message += ` Vol 3m: <b>${volumeCheck.volumeData.ratio}x</b>\n`;
    message += ` Liquidez Cap: ${sweepMinutes} minutos\n`;
    message += ` Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n`;
    message += ` Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n`;
    message += `        <b>✔︎SMC Tecnology by @J4Rviz</b>`;
    
    return message;
}

// Função para determinar o símbolo do LSR com base no valor
function getLsrSymbol(lsrValue) {
    if (lsrValue === null || lsrValue === "N/A") return '🔘Consol.';
    const value = parseFloat(lsrValue);
    return value <= 1.4 ? '✅Baixo' : value >= 2.8 ? '📛Alto' : '🔘Consol.';
}

// Inicializar cooldown para cada ativo
function initAlertsCooldown() {
    SYMBOLS.forEach(symbol => {
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
            // Verificar volume anormal no 3m 
            const volumeCheck = await checkAbnormalVolume(symbol, 2);
            
            // Se não passar nos critérios, não armazenar
            if (!volumeCheck.isAbnormal) {
                return null;
            }

            // Armazenar informação do sweep
            const now = Date.now();
            if (buySweepDetected) {
                recentSweeps[symbol].lastBuySweep = now;
                recentSweeps[symbol].buySweepPrice = price;
                logToFile(`✅ Sweep Compra detectado para ${symbol} - Preço: $${price} - Volume: ${volumeCheck.ratio}x`);
            } else if (sellSweepDetected) {
                recentSweeps[symbol].lastSellSweep = now;
                recentSweeps[symbol].sellSweepPrice = price;
                logToFile(`✅ Sweep Venda detectado para ${symbol} - Preço: $${price} - Volume: ${volumeCheck.ratio}x`);
            }
            
            return {
                symbol: symbol,
                sweepType: buySweepDetected ? 'Compra' : 'Venda',
                price: price,
                volumeRatio: volumeCheck.ratio,
                timestamp: now
            };
        }
        
        return null;
    } catch (e) {
        logToFile(`❌ Erro ao detectar sweep ${symbol}: ${e.message}`);
        return null;
    }
}

// 🔵 FUNÇÃO ATUALIZADA: Monitorar confirmações de reversão
async function monitorConfirmation(symbol) {
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
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // 🔴 NOVO CRITÉRIO: Open Interest deve estar subindo (5 minutos)
            const oiCheck = await checkOpenInterestCriteria(symbol, true);
            
            // 🔴 NOVO CRITÉRIO: Volatilidade mínima (15 minutos)
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            
            // Verificar se passa em TODOS os novos critérios
            if (!volumeCheck.isConfirmed || !oiCheck.isValid || !volatilityCheck.isValid) {
                logToFile(`❌ Confirmação Bull rejeitada para ${symbol}: Volume=${volumeCheck.isConfirmed}, OI=${oiCheck.isValid}, Vol=${volatilityCheck.isValid} (${volatilityCheck.message})`);
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastBuyConfirmation > COOLDOWN) {
                // Buscar dados adicionais para a mensagem
                const [lsrData, orderBook, stoch4h, stochDaily] = await Promise.all([
                    getLSR(symbol, '15m'),
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d')
                ]);
                
                // 🔴 CALCULAR ALVOS E STOP DINÂMICO
                const targetsAndStop = await calculateTargetsAndStopATR(emas3mData.currentPrice, true, symbol);
                
                // 🔵 ATUALIZAR FUNÇÃO buildAlertMessage
                const msg = buildAlertMessage(
                    true,
                    symbol,
                    priceFormatted,
                    brDateTime,
                    targetsAndStop,
                    rsi1h,
                    stoch4h,
                    stochDaily,
                    lsrData,
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastBuySweep,
                    emas3mData,
                    oiCheck,
                    volatilityCheck
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
                    emas3mData: emas3mData
                };
                
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
            
            // 🔴 CRITÉRIO: Volume anormal (2x média)
            const volumeCheck = await checkVolumeConfirmation(symbol, 2);
            
            // 🔴 NOVO CRITÉRIO: Open Interest deve estar caindo (5 minutos)
            const oiCheck = await checkOpenInterestCriteria(symbol, false);
            
            // 🔴 NOVO CRITÉRIO: Volatilidade mínima (15 minutos)
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            
            // Verificar se passa em TODOS os novos critérios
            if (!volumeCheck.isConfirmed || !oiCheck.isValid || !volatilityCheck.isValid) {
                logToFile(`❌ Confirmação Bear rejeitada para ${symbol}: Volume=${volumeCheck.isConfirmed}, OI=${oiCheck.isValid}, Vol=${volatilityCheck.isValid} (${volatilityCheck.message})`);
                return null;
            }
            
            if (now - alertsCooldown[symbol].lastSellConfirmation > COOLDOWN) {
                // Buscar dados adicionais
                const [lsrData, orderBook, stoch4h, stochDaily] = await Promise.all([
                    getLSR(symbol, '15m'),
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d')
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
                    lsrData,
                    fundingRate,
                    volumeCheck,
                    orderBook,
                    recentSweeps[symbol].lastSellSweep,
                    emas3mData,
                    oiCheck,
                    volatilityCheck
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
                    emas3mData: emas3mData
                };
                
                alertsCooldown[symbol].lastSellConfirmation = now;
            }
        }
        
        return confirmationAlert;
        
    } catch (e) {
        logToFile(`❌ Erro ao monitorar confirmação ${symbol}: ${e.message}`);
        return null;
    }
}

// Função para mostrar status do monitoramento
function showMonitoringStatus() {
    const now = Date.now();
    let status = "\n📊 STATUS DO MONITORAMENTO:\n";
    status += "=".repeat(50) + "\n";
    
    // Agrupar ativos em colunas
    const symbolsPerColumn = Math.ceil(SYMBOLS.length / 3);
    
    for (let i = 0; i < symbolsPerColumn; i++) {
        let line = "";
        
        // Coluna 1
        if (i < SYMBOLS.length) {
            const symbol1 = SYMBOLS[i];
            const lastBuyConf1 = alertsCooldown[symbol1].lastBuyConfirmation;
            const lastSellConf1 = alertsCooldown[symbol1].lastSellConfirmation;
            
            const buyConfCooldown1 = lastBuyConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf1)) : 0;
            const sellConfCooldown1 = lastSellConf1 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf1)) : 0;
            
            const buyConfStatus1 = buyConfCooldown1 > 0 ? `⏳${Math.round(buyConfCooldown1/60000)}m` : '✅';
            const sellConfStatus1 = sellConfCooldown1 > 0 ? `⏳${Math.round(sellConfCooldown1/60000)}m` : '✅';
            
            const hadBuySweep1 = recentSweeps[symbol1].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep1 = recentSweeps[symbol1].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol1.padEnd(10)} S:${hadBuySweep1}/${hadSellSweep1} | C-B:${buyConfStatus1} C-V:${sellConfStatus1} | `;
        }
        
        // Coluna 2
        if (i + symbolsPerColumn < SYMBOLS.length) {
            const symbol2 = SYMBOLS[i + symbolsPerColumn];
            const lastBuyConf2 = alertsCooldown[symbol2].lastBuyConfirmation;
            const lastSellConf2 = alertsCooldown[symbol2].lastSellConfirmation;
            
            const buyConfCooldown2 = lastBuyConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf2)) : 0;
            const sellConfCooldown2 = lastSellConf2 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf2)) : 0;
            
            const buyConfStatus2 = buyConfCooldown2 > 0 ? `⏳${Math.round(buyConfCooldown2/60000)}m` : '✅';
            const sellConfStatus2 = sellConfCooldown2 > 0 ? `⏳${Math.round(sellConfCooldown2/60000)}m` : '✅';
            
            const hadBuySweep2 = recentSweeps[symbol2].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep2 = recentSweeps[symbol2].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol2.padEnd(10)} S:${hadBuySweep2}/${hadSellSweep2} | C-B:${buyConfStatus2} C-V:${sellConfStatus2} | `;
        }
        
        // Coluna 3
        if (i + symbolsPerColumn * 2 < SYMBOLS.length) {
            const symbol3 = SYMBOLS[i + symbolsPerColumn * 2];
            const lastBuyConf3 = alertsCooldown[symbol3].lastBuyConfirmation;
            const lastSellConf3 = alertsCooldown[symbol3].lastSellConfirmation;
            
            const buyConfCooldown3 = lastBuyConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastBuyConf3)) : 0;
            const sellConfCooldown3 = lastSellConf3 > 0 ? Math.max(0, COOLDOWN - (now - lastSellConf3)) : 0;
            
            const buyConfStatus3 = buyConfCooldown3 > 0 ? `⏳${Math.round(buyConfCooldown3/60000)}m` : '✅';
            const sellConfStatus3 = sellConfCooldown3 > 0 ? `⏳${Math.round(sellConfCooldown3/60000)}m` : '✅';
            
            const hadBuySweep3 = recentSweeps[symbol3].lastBuySweep ? '🟢' : '⚪';
            const hadSellSweep3 = recentSweeps[symbol3].lastSellSweep ? '🔴' : '⚪';
            
            line += `${symbol3.padEnd(10)} S:${hadBuySweep3}/${hadSellSweep3} | C-B:${buyConfStatus3} C-V:${sellConfStatus3}`;
        }
        
        status += line + "\n";
    }
    
    status += "=".repeat(50) + "\n";
    status += "Legenda: S=Sweep (🟢=Compra, 🔴=Venda, ⚪=Nenhum), C-B=Confirmação Bull, C-V=Confirmação Bear\n";
    status += "✅=Pronto, ⏳=Cooldown (minutos)\n";
    console.log(status);
}

// 🔵 FUNÇÃO OTIMIZADA: Processar múltiplos ativos em paralelo
async function processBatch(batch, processFunction) {
    const results = await Promise.allSettled(
        batch.map(symbol => processFunction(symbol))
    );
    
    const alerts = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            alerts.push(result.value);
        } else if (result.status === 'rejected') {
            const symbol = batch[index];
            logToFile(`❌ Erro no processamento de ${symbol}: ${result.reason.message}`);
        }
    });
    
    return alerts;
}

// Loop principal do bot
async function mainBotLoop() {
    // Inicializar sistema de cooldown
    initAlertsCooldown();
    
    const initMsg = '\n' +
        '='.repeat(70) + '\n' +
        ' 🤖 BOT DE CONFIRMAÇÕES SMC 1H INICIADO (ENTRADAS COM RETRAÇÃO ATR)\n' +
        ` 📊 MONITORANDO ${SYMBOLS.length} ATIVOS\n` +
        ` ⚡ PROCESSAMENTO EM LOTE (${BATCH_SIZE} ATIVOS EM PARALELO)\n` +
        ` 🚫 ALERTAS DE SWEEP DESATIVADOS\n` +
        ` ✅ APENAS CONFIRMAÇÕES BULL/BEAR\n` +
        ` 🔵 OPEN INTEREST APERFEIÇOADO\n` +
        ` 📈 VOLATILIDADE MÍNIMA DE ${VOLATILITY_THRESHOLD}% (${VOLATILITY_TIMEFRAME}, ${VOLATILITY_PERIOD} períodos)\n` +
        ` 🔴 STOP ATR AVANÇADO: Multiplicador ${ATR_MULTIPLIER}x (${ATR_TIMEFRAME}, ${ATR_PERIOD} períodos)\n` +
        ` 🔰 STOP LIMITES: Mínimo ${MIN_ATR_PERCENTAGE}%, Máximo ${MAX_ATR_PERCENTAGE}%\n` +
        ` 🎯 ENTRADAS COM RETRAÇÃO ATR: Multiplicador ${ENTRY_RETRACTION_MULTIPLIER}x\n` +
        ` 📊 NÍVEIS DE ENTRADA: ${ENTRY_MIN_RETRACTION_PERCENT}% - ${ENTRY_MAX_RETRACTION_PERCENT}% retração\n` +
        '='.repeat(70) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot iniciado - Monitorando ${SYMBOLS.length} ativos (entradas com retração ATR)`);
    
    // Mostrar configuração de casas decimais
    console.log('\n🔧 CONFIGURAÇÃO DE CASAS DECIMAIS:');
    console.log('='.repeat(60));
    
    // Mostrar em colunas
    const symbolsPerRow = 4;
    for (let i = 0; i < SYMBOLS.length; i += symbolsPerRow) {
        let line = "";
        for (let j = 0; j < symbolsPerRow && i + j < SYMBOLS.length; j++) {
            const symbol = SYMBOLS[i + j];
            const decimals = DECIMALS_CONFIG[symbol] || DEFAULT_DECIMALS;
            line += `${symbol}: ${decimals}c `.padEnd(20);
        }
        console.log(line);
    }
    console.log('='.repeat(60) + '\n');
    
    // Mostrar configuração completa
    console.log('🎯 CONFIGURAÇÃO COMPLETA:');
    console.log('='.repeat(80));
    console.log(`Alvos: ${TARGET_PERCENTAGES.map(p => p + '%').join(', ')}`);
    console.log(`\n🔴 STOP DINÂMICO:`);
    console.log(`  • Timeframe: ${ATR_TIMEFRAME}`);
    console.log(`  • Período: ${ATR_PERIOD} velas`);
    console.log(`  • Multiplicador: ${ATR_MULTIPLIER}x`);
    console.log(`  • Stop: ${MIN_ATR_PERCENTAGE}%`);
    console.log(`  • Stop máximo limite: ${MAX_ATR_PERCENTAGE}%`);
    console.log(`\n🎯 ENTR.RETRAÇÃO :`);
    console.log(`  • Retração ideal: ${ENTRY_RETRACTION_MULTIPLIER}x ATR`);
    console.log(`  • Máximo entrada: ${ENTRY_MAX_DISTANCE_MULTIPLIER}x ATR`);
    console.log(`  • Retração: ${ENTRY_MIN_RETRACTION_PERCENT}% - ${ENTRY_MAX_RETRACTION_PERCENT}%`);
    console.log(`  • 3 níveis de entrada para escala`);
    console.log('='.repeat(80) + '\n');
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>SMC Confirmation Bot </b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `📊 Monitorando ${SYMBOLS.length} ativos\n` +
                   
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
                const batchAlerts = await processBatch(batch, monitorConfirmation);
                
                // Enviar alertas do batch
                for (const alert of batchAlerts) {
                    console.log(`\n✅ CONFIRMAÇÃO DETECTADA PARA ${alert.symbol}!`);
                    console.log(`📊 ${alert.signal} - Preço: $${alert.priceFormatted}`);
                    console.log(`📈 Volume: ${alert.volumeConfirmation.volumeData.ratio}x`);
                    console.log(`🔵 Open Interest: ${alert.oiCheck.trend}`);
                    console.log(`📊 Volatilidade: ${alert.volatilityCheck.volatility}%`);
                    
                    // 🔴 MOSTRAR NÍVEIS DE ENTRADA
                    if (alert.targetsAndStop.entryLevels) {
                        const entry = alert.targetsAndStop.entryLevels;
                        console.log(`🎯 Entrada Ideal: $${entry.idealEntryFormatted} (retração ${entry.retractionPercent}%)`);
                        console.log(`🎪 3 Níveis de Entrada:`);
                        console.log(`   1. $${formatNumber(entry.levels[0].price, alert.symbol, true)} (Imediata)`);
                        console.log(`   2. $${formatNumber(entry.levels[1].price, alert.symbol, true)} (Ideal)`);
                        console.log(`   3. $${formatNumber(entry.levels[2].price, alert.symbol, true)} (Agressiva)`);
                    }
                    
                    logToFile(`ALERTA CONFIRMAÇÃO ${alert.signal} - ${alert.symbol} - Preço: $${alert.price} - Volume: ${alert.volumeConfirmation.volumeData.ratio}x - OI: ${alert.oiCheck.trend} - Volatilidade: ${alert.volatilityCheck.volatility}%`);
                    
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
            
            // Mostrar status a cada 10 ciclos
            if (cycleCount % 10 === 0) {
                showMonitoringStatus();
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

// Função principal com sistema de recuperação
async function startBot() {
    try {
        initLogSystem();
        
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
        
        await mainBotLoop();
        
    } catch (error) {
        const crashMsg = `🚨 BOT CRASHED: ${error.message}`;
        console.error(`\n${crashMsg}`);
        logToFile(`🚨 ${crashMsg}`);
        
        console.log('🔄 Reiniciando bot em 60 segundos...');
        logToFile('🔄 Reiniciando bot em 60 segundos...');
        
        await new Promise(r => setTimeout(r, 30000));
        await startBot();
    }
}

// Iniciar o bot
console.log('\n' + '='.repeat(80));
console.log('🤖 BOT DE CONFIRMAÇÕES SMC 1H (ENTRADAS COM RETRAÇÃO ATR)');
console.log('📈 Monitorando 76 ativos da Binance');
console.log('🔧 Configuração SMC - Canal Limpo');
console.log('🔴 STOP ATR AVANÇADO');
console.log('🎯 ENTRADAS OTIMIZADAS COM RETRAÇÃO ATR - 3 NÍVEIS');
console.log('='.repeat(80) + '\n');

// Verificar dependências
try {
    require('technicalindicators');
} catch (e) {
    console.log('⚠️ technicalindicators não encontrado. Instale com: npm install technicalindicators');
    process.exit(1);
}

startBot();
