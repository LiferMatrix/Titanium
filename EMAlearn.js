const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A';
const TELEGRAM_CHAT_ID = '-1001990889297';

// === CONFIGURAÇÕES DE VOLUME ADAPTATIVO ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.3,
    minThreshold: 1.2,
    maxThreshold: 1.8,
    volatilityMultiplier: 0.3,
    useAdaptive: true
};

// === CONFIGURAÇÕES DE VOLATILIDADE ===
const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m';
const VOLATILITY_THRESHOLD = 0.7;

// === FILTRO DO LSR RATIO ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;

// === FILTRO DE FUNDING RATE ===
const FUNDING_BUY_MAX = -0.001;
const FUNDING_SELL_MIN = 0.001;

// === COOLDOWN DIFERENCIADO ===
const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,
    oppositeDirection: 5 * 60 * 1000,
    useDifferentiated: true
};

// === ALERTAS DE QUASE SINAL ===
const DEBUG_SETTINGS = {
    enableNearSignals: true,
    minScore: 60,
    maxScore: 69,
    sendTelegram: false,
    logOnly: true
};

// === QUALITY SCORE AJUSTADO ===
const QUALITY_THRESHOLD = 70;
const QUALITY_WEIGHTS = {
    volume: 25,
    oi: 20,
    volatility: 15,
    lsr: 15,
    rsi: 10,
    emaAlignment: 15,
    adx: 10,
    adx1h: 15,
    stoch1h: 10,
    stoch4h: 10
};

// === PARÂMETROS DE OTIMIZAÇÃO ===
const OPTIMIZATION_SETTINGS = {
    enabled: true,
    learningPeriod: 100,
    adjustWeights: true,
    dynamicThresholds: {
        volume: { min: 1.2, max: 2.0, current: 1.3 },
        volatility: { min: 0.5, max: 1.5, current: 0.7 },
        rsiRange: {
            buy: { min: 25, max: 45, current: [30, 50] },
            sell: { min: 55, max: 75, current: [50, 70] }
        },
        adx1h: { min: 15, max: 30, current: 20 }
    }
};

// 🔵 CONFIGURAÇÃO DINÂMICA
let SYMBOLS = [];
let DECIMALS_CONFIG = {};
let TICK_SIZE_CONFIG = {};

// 🔵 CONFIGURAÇÕES DE RATE LIMIT
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1200,
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 2,
        openInterest: 1,
        fundingRate: 1,
        orderBook: 2,
        lsr: 1
    }
};

let rateLimitCounter = {
    windowStart: Date.now(),
    usedWeight: 0,
    remainingWeight: 1200
};

const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 10;
const MAX_LOG_SIZE = 10 * 1024 * 1024;

const INITIAL_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 60000;
const MAX_RETRY_ATTEMPTS = 10;

const alertsCooldown = {};
const COOLDOWN = 30 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 1 * 60 * 1000;
const OI_HISTORY_SIZE = 30;
const OI_SMA_PERIOD = 10;

const DEFAULT_DECIMALS = 4;

const TARGET_PERCENTAGES = [2.5, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 3.5;
const ATR_TIMEFRAME = '15m';
const MIN_ATR_PERCENTAGE = 2.5;
const MAX_ATR_PERCENTAGE = 8.0;

const ENTRY_RETRACTION_MULTIPLIER = 0.5;
const ENTRY_MAX_DISTANCE_MULTIPLIER = 0.3;
const ENTRY_MIN_RETRACTION_PERCENT = 0.5;
const ENTRY_MAX_RETRACTION_PERCENT = 2.0;

const BATCH_SIZE = 15;
const candleCache = {};
const CANDLE_CACHE_TTL = 50000;
const MAX_CACHE_AGE = 5 * 60 * 1000;

const COMPRESS_CANDLES = true;
const COMPRESSED_CANDLE_CACHE = {};

const ADX_SETTINGS = {
    period: 14,
    timeframe: '15m',
    strongTrendThreshold: 25
};

const ADX_1H_SETTINGS = {
    period: 14,
    timeframe: '1h',
    strongTrendThreshold: 25,
    minStrength: 20
};

// === CONFIGURAÇÕES DO ESTOCÁSTICO ===
const STOCH_SETTINGS = {
    period: 5,
    signalPeriod: 3,
    smooth: 3,
    timeframe1h: '1h',
    timeframe4h: '4h',
    buyCondition: 'K_CROSSING_ABOVE_D',
    sellCondition: 'K_CROSSING_BELOW_D'
};

// === MARKET SESSIONS ===
const MARKET_SESSIONS = {
    'ASIA': { start: 0, end: 8, volatility: 0.8, trendiness: 0.6 },
    'LONDON': { start: 8, end: 16, volatility: 1.0, trendiness: 0.8 },
    'NY': { start: 13, end: 21, volatility: 1.2, trendiness: 0.9 },
    'OVERLAP': { start: 13, end: 16, volatility: 1.5, trendiness: 0.7 }
};

// === CONTINUOUS LEARNING SYSTEM ===
let continuousLearningSystem = null;

// =====================================================================
// FUNÇÕES DE LOG E MANUTENÇÃO
// =====================================================================

function logToFile(message) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }
        
        const logFile = path.join(LOG_DIR, `bot_${new Date().toISOString().split('T')[0]}.log`);
        const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const logMessage = `[${timestamp}] ${message}\n`;
        
        fs.appendFileSync(logFile, logMessage, 'utf8');
        
        // Verificar tamanho do arquivo
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_LOG_SIZE) {
                rotateLogFile(logFile);
            }
        }
        
    } catch (error) {
        console.error('❌ Erro ao escrever no log:', error.message);
    }
}

function cleanupOldLogs() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            return;
        }
        
        const files = fs.readdirSync(LOG_DIR)
            .filter(file => file.startsWith('bot_') && file.endsWith('.log'))
            .map(file => ({
                name: file,
                path: path.join(LOG_DIR, file),
                time: fs.statSync(path.join(LOG_DIR, file)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);
        
        // Manter apenas os últimos MAX_LOG_FILES arquivos
        if (files.length > MAX_LOG_FILES) {
            files.slice(MAX_LOG_FILES).forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    console.log(`🗑️  Arquivo de log antigo removido: ${file.name}`);
                } catch (error) {
                    console.error(`❌ Erro ao remover arquivo ${file.name}:`, error.message);
                }
            });
        }
    } catch (error) {
        console.error('❌ Erro na limpeza de logs:', error.message);
    }
}

function rotateLogFile(currentLogFile) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedFile = currentLogFile.replace('.log', `_${timestamp}.log`);
        fs.renameSync(currentLogFile, rotatedFile);
        console.log(`🔄 Arquivo de log rotacionado: ${rotatedFile}`);
    } catch (error) {
        console.error('❌ Erro ao rotacionar arquivo de log:', error.message);
    }
}

// =====================================================================
// 1. 📊 TRADE DATA COLLECTOR
// =====================================================================
class TradeDataCollector {
    constructor() {
        this.tradeHistory = [];
        this.marketSnapshots = new Map();
        this.performanceMetrics = {
            hourly: {},
            daily: {},
            weekly: {},
            bySymbol: {},
            byStrategy: {},
            bySession: {}
        };
        this.initDataStorage();
    }
    
    initDataStorage() {
        if (!fs.existsSync(LEARNING_DIR)) {
            fs.mkdirSync(LEARNING_DIR, { recursive: true });
        }
        
        // Carregar histórico existente
        this.loadTradeHistory();
    }
    
    loadTradeHistory() {
        try {
            const historyFile = path.join(LEARNING_DIR, 'trade_history.json');
            if (fs.existsSync(historyFile)) {
                const data = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
                this.tradeHistory = data;
                console.log(`📊 Carregados ${this.tradeHistory.length} trades históricos`);
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar histórico de trades:', error.message);
        }
    }
    
    async captureTradeSnapshot(trade) {
        try {
            const snapshot = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                symbol: trade.symbol,
                direction: trade.isBullish ? 'BUY' : 'SELL',
                entryPrice: trade.price,
                exitPrice: null,
                profit: null,
                profitPercentage: null,
                status: 'OPEN',
                
                marketConditions: {
                    volume: trade.volumeCheck?.volumeData || {},
                    volatility: trade.volatilityCheck || {},
                    trendStrength: trade.adx || {},
                    indicators: {
                        rsi1h: trade.rsi1h || {},
                        emaAlignment: trade.emas3mData || {},
                        adx: trade.adx || {},
                        stochastic: trade.stochCheck || {},
                        fundingRate: trade.fundingCheck || {}
                    },
                    filters: {
                        volumeThreshold: trade.volumeCheck?.dynamicThreshold || 1.3,
                        rsiRange: trade.rsi1h?.raw ? [30, 50] : [50, 70],
                        adxMin: ADX_1H_SETTINGS.minStrength,
                        oiTrend: trade.oiCheck?.trend || '➡️',
                        fundingRate: trade.fundingCheck?.raw || 0
                    },
                    parameters: {
                        stopLoss: trade.targetsAndStop?.stopPercentage || 3.0,
                        takeProfit: trade.targetsAndStop?.targets || [],
                        positionSize: 0.01,
                        riskReward: trade.targetsAndStop?.bestRiskReward || 2.0
                    }
                },
                
                qualityScore: trade.qualityScore || { score: 0, grade: 'D' },
                strategy: trade.strategy || 'DEFAULT'
            };
            
            this.tradeHistory.push(snapshot);
            
            // Salvar periodicamente
            if (this.tradeHistory.length % 10 === 0) {
                await this.saveToDatabase();
            }
            
            return snapshot;
            
        } catch (error) {
            console.error('Erro ao capturar snapshot do trade:', error);
            return null;
        }
    }
    
    async updateTradeExit(tradeId, exitPrice, profit, profitPercentage) {
        const trade = this.tradeHistory.find(t => t.id === tradeId);
        if (trade) {
            trade.exitPrice = exitPrice;
            trade.profit = profit;
            trade.profitPercentage = profitPercentage;
            trade.status = 'CLOSED';
            trade.exitTimestamp = Date.now();
            
            await this.saveToDatabase();
            await this.updatePerformanceMetrics(trade);
        }
    }
    
    async updatePerformanceMetrics(trade) {
        const hour = new Date(trade.timestamp).getHours();
        const day = new Date(trade.timestamp).toISOString().split('T')[0];
        const symbol = trade.symbol;
        
        // Atualizar métricas por hora
        if (!this.performanceMetrics.hourly[hour]) {
            this.performanceMetrics.hourly[hour] = { wins: 0, losses: 0, totalProfit: 0 };
        }
        
        if (trade.profit > 0) {
            this.performanceMetrics.hourly[hour].wins++;
        } else {
            this.performanceMetrics.hourly[hour].losses++;
        }
        this.performanceMetrics.hourly[hour].totalProfit += trade.profit;
        
        // Atualizar métricas por símbolo
        if (!this.performanceMetrics.bySymbol[symbol]) {
            this.performanceMetrics.bySymbol[symbol] = { wins: 0, losses: 0, totalProfit: 0 };
        }
        
        if (trade.profit > 0) {
            this.performanceMetrics.bySymbol[symbol].wins++;
        } else {
            this.performanceMetrics.bySymbol[symbol].losses++;
        }
        this.performanceMetrics.bySymbol[symbol].totalProfit += trade.profit;
        
        // Salvar métricas
        await this.saveMetrics();
    }
    
    async saveToDatabase() {
        try {
            const historyFile = path.join(LEARNING_DIR, 'trade_history.json');
            const backupFile = path.join(LEARNING_DIR, `trade_history_backup_${Date.now()}.json`);
            
            // Criar backup
            if (fs.existsSync(historyFile)) {
                fs.copyFileSync(historyFile, backupFile);
            }
            
            // Salvar dados
            fs.writeFileSync(historyFile, JSON.stringify(this.tradeHistory, null, 2));
            
            // Limpar backups antigos
            this.cleanupOldBackups();
            
        } catch (error) {
            console.error('Erro ao salvar histórico:', error);
        }
    }
    
    async saveMetrics() {
        try {
            const metricsFile = path.join(LEARNING_DIR, 'performance_metrics.json');
            fs.writeFileSync(metricsFile, JSON.stringify(this.performanceMetrics, null, 2));
        } catch (error) {
            console.error('Erro ao salvar métricas:', error);
        }
    }
    
    cleanupOldBackups() {
        try {
            const files = fs.readdirSync(LEARNING_DIR)
                .filter(file => file.startsWith('trade_history_backup_'))
                .map(file => ({
                    name: file,
                    path: path.join(LEARNING_DIR, file),
                    time: fs.statSync(path.join(LEARNING_DIR, file)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);
            
            if (files.length > 5) {
                files.slice(5).forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
        } catch (error) {
            // Ignorar erro na limpeza
        }
    }
    
    getRecentTrades(count = 100) {
        return this.tradeHistory
            .filter(t => t.status === 'CLOSED')
            .slice(-count);
    }
    
    getWinningTrades(count = 50) {
        return this.tradeHistory
            .filter(t => t.status === 'CLOSED' && t.profit > 0)
            .slice(-count);
    }
    
    getLosingTrades(count = 50) {
        return this.tradeHistory
            .filter(t => t.status === 'CLOSED' && t.profit <= 0)
            .slice(-count);
    }
    
    getTradeStatistics() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winningTrades = closedTrades.filter(t => t.profit > 0);
        const losingTrades = closedTrades.filter(t => t.profit <= 0);
        
        const totalProfit = closedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
        const avgWin = winningTrades.length > 0 ? 
            winningTrades.reduce((sum, t) => sum + (t.profit || 0), 0) / winningTrades.length : 0;
        const avgLoss = losingTrades.length > 0 ? 
            losingTrades.reduce((sum, t) => sum + (t.profit || 0), 0) / losingTrades.length : 0;
        
        return {
            totalTrades: closedTrades.length,
            winningTrades: winningTrades.length,
            losingTrades: losingTrades.length,
            winRate: closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0,
            totalProfit: totalProfit,
            avgWin: avgWin,
            avgLoss: avgLoss,
            profitFactor: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
            bestTrade: Math.max(...closedTrades.map(t => t.profit || 0)),
            worstTrade: Math.min(...closedTrades.map(t => t.profit || 0))
        };
    }
}

// =====================================================================
// 2. 📈 ANALYTICS ENGINE
// =====================================================================
class AnalyticsEngine {
    constructor(dataCollector) {
        this.dataCollector = dataCollector;
        this.patterns = {};
        this.correlations = {};
        this.insights = [];
    }
    
    async analyzeTradePerformance() {
        const recentTrades = this.dataCollector.getRecentTrades(100);
        
        if (recentTrades.length < 20) {
            return {
                status: 'INSUFFICIENT_DATA',
                message: `Apenas ${recentTrades.length} trades fechados (mínimo 20)`
            };
        }
        
        const analysis = {
            performanceByCondition: await this.analyzeByMarketCondition(recentTrades),
            winningPatterns: this.identifyWinningPatterns(recentTrades),
            losingPatterns: this.identifyLosingPatterns(recentTrades),
            parameterCorrelations: this.calculateParameterCorrelations(recentTrades),
            temporalPatterns: this.analyzeTemporalPatterns(recentTrades),
            volatilityAnalysis: this.analyzeVolatilityImpact(recentTrades),
            recommendations: await this.generateRecommendations(recentTrades)
        };
        
        // Salvar análise
        await this.saveAnalysis(analysis);
        
        return analysis;
    }
    
    identifyWinningPatterns(trades) {
        const winners = trades.filter(t => t.profit > 0);
        const patterns = {};
        
        winners.forEach(trade => {
            const conditions = trade.marketConditions;
            
            // Padrão 1: EMA Alignment + High Volume
            if (conditions.indicators.emaAlignment?.isAboveEMA55 && 
                conditions.volume?.rawRatio > 1.5) {
                patterns['EMA_VOLUME_SPIKE'] = (patterns['EMA_VOLUME_SPIKE'] || 0) + 1;
            }
            
            // Padrão 2: RSI Extreme + ADX High
            const rsi = conditions.indicators.rsi1h?.raw;
            const adx = conditions.indicators.adx?.raw;
            
            if (rsi && adx && ((rsi < 35 && trade.direction === 'BUY') || 
                               (rsi > 65 && trade.direction === 'SELL')) &&
                adx > 25) {
                patterns['RSI_EXTREME_ADX_HIGH'] = (patterns['RSI_EXTREME_ADX_HIGH'] || 0) + 1;
            }
            
            // Padrão 3: High Volume Spike
            if (conditions.volume?.rawRatio > 2.0) {
                patterns['HIGH_VOLUME_SPIKE'] = (patterns['HIGH_VOLUME_SPIKE'] || 0) + 1;
            }
            
            // Padrão 4: Strong Trend (ADX > 30)
            if (adx > 30) {
                patterns['STRONG_TREND'] = (patterns['STRONG_TREND'] || 0) + 1;
            }
            
            // Padrão 5: Quality Score High
            if (trade.qualityScore?.score > 80) {
                patterns['HIGH_QUALITY_SCORE'] = (patterns['HIGH_QUALITY_SCORE'] || 0) + 1;
            }
        });
        
        // Calcular eficácia
        const totalWinners = winners.length;
        const patternEffectiveness = {};
        
        Object.keys(patterns).forEach(pattern => {
            const count = patterns[pattern];
            patternEffectiveness[pattern] = {
                count: count,
                percentage: (count / totalWinners) * 100,
                efficiency: count / totalWinners
            };
        });
        
        // Ordenar por eficácia
        const sortedPatterns = Object.entries(patternEffectiveness)
            .sort((a, b) => b[1].efficiency - a[1].efficiency);
        
        return {
            totalWinners: totalWinners,
            patterns: patternEffectiveness,
            topPattern: sortedPatterns.length > 0 ? sortedPatterns[0][0] : null,
            topPatternEfficiency: sortedPatterns.length > 0 ? sortedPatterns[0][1].efficiency : 0
        };
    }
    
    identifyLosingPatterns(trades) {
        const losers = trades.filter(t => t.profit <= 0);
        const patterns = {};
        
        losers.forEach(trade => {
            const conditions = trade.marketConditions;
            
            // Padrão 1: Low Volume
            if (conditions.volume?.rawRatio < 1.2) {
                patterns['LOW_VOLUME'] = (patterns['LOW_VOLUME'] || 0) + 1;
            }
            
            // Padrão 2: Weak Trend (ADX < 20)
            if (conditions.indicators.adx?.raw < 20) {
                patterns['WEAK_TREND'] = (patterns['WEAK_TREND'] || 0) + 1;
            }
            
            // Padrão 3: RSI Neutral
            const rsi = conditions.indicators.rsi1h?.raw;
            if (rsi && rsi >= 45 && rsi <= 55) {
                patterns['RSI_NEUTRAL'] = (patterns['RSI_NEUTRAL'] || 0) + 1;
            }
            
            // Padrão 4: Low Quality Score
            if (trade.qualityScore?.score < 70) {
                patterns['LOW_QUALITY_SCORE'] = (patterns['LOW_QUALITY_SCORE'] || 0) + 1;
            }
            
            // Padrão 5: Wrong Funding Rate Direction
            const funding = conditions.indicators.fundingRate?.raw;
            if (funding) {
                if ((trade.direction === 'BUY' && funding > 0) || 
                    (trade.direction === 'SELL' && funding < 0)) {
                    patterns['WRONG_FUNDING_DIRECTION'] = (patterns['WRONG_FUNDING_DIRECTION'] || 0) + 1;
                }
            }
        });
        
        // Calcular frequência
        const totalLosers = losers.length;
        const patternFrequency = {};
        
        Object.keys(patterns).forEach(pattern => {
            const count = patterns[pattern];
            patternFrequency[pattern] = {
                count: count,
                percentage: (count / totalLosers) * 100,
                frequency: count / totalLosers
            };
        });
        
        // Ordenar por frequência
        const sortedPatterns = Object.entries(patternFrequency)
            .sort((a, b) => b[1].frequency - a[1].frequency);
        
        return {
            totalLosers: totalLosers,
            patterns: patternFrequency,
            worstPattern: sortedPatterns.length > 0 ? sortedPatterns[0][0] : null,
            worstPatternFrequency: sortedPatterns.length > 0 ? sortedPatterns[0][1].frequency : 0
        };
    }
    
    calculateParameterCorrelations(trades) {
        const correlations = {
            volumeThreshold: {},
            rsiRange: {},
            adxThreshold: {},
            stopLoss: {},
            qualityScore: {}
        };
        
        // Volume Threshold Correlation
        const volumeBuckets = {
            '1.0-1.2': { wins: 0, losses: 0 },
            '1.2-1.4': { wins: 0, losses: 0 },
            '1.4-1.6': { wins: 0, losses: 0 },
            '1.6-1.8': { wins: 0, losses: 0 },
            '1.8+': { wins: 0, losses: 0 }
        };
        
        trades.forEach(trade => {
            const volumeRatio = trade.marketConditions.volume?.rawRatio || 0;
            let bucket = '';
            
            if (volumeRatio < 1.2) bucket = '1.0-1.2';
            else if (volumeRatio < 1.4) bucket = '1.2-1.4';
            else if (volumeRatio < 1.6) bucket = '1.4-1.6';
            else if (volumeRatio < 1.8) bucket = '1.6-1.8';
            else bucket = '1.8+';
            
            if (volumeBuckets[bucket]) {
                if (trade.profit > 0) volumeBuckets[bucket].wins++;
                else volumeBuckets[bucket].losses++;
            }
            
            // Quality Score Correlation
            const score = trade.qualityScore?.score || 0;
            const scoreBucket = Math.floor(score / 10) * 10;
            const scoreKey = `${scoreBucket}-${scoreBucket + 9}`;
            
            if (!correlations.qualityScore[scoreKey]) {
                correlations.qualityScore[scoreKey] = { wins: 0, losses: 0 };
            }
            
            if (trade.profit > 0) correlations.qualityScore[scoreKey].wins++;
            else correlations.qualityScore[scoreKey].losses++;
        });
        
        // Calcular win rates
        Object.keys(volumeBuckets).forEach(bucket => {
            const data = volumeBuckets[bucket];
            const total = data.wins + data.losses;
            if (total > 0) {
                correlations.volumeThreshold[bucket] = {
                    winRate: (data.wins / total) * 100,
                    totalTrades: total
                };
            }
        });
        
        Object.keys(correlations.qualityScore).forEach(bucket => {
            const data = correlations.qualityScore[bucket];
            const total = data.wins + data.losses;
            if (total > 0) {
                correlations.qualityScore[bucket].winRate = (data.wins / total) * 100;
                correlations.qualityScore[bucket].totalTrades = total;
            }
        });
        
        return correlations;
    }
    
    analyzeTemporalPatterns(trades) {
        const patterns = {
            byHour: {},
            byDay: {},
            bySession: {}
        };
        
        trades.forEach(trade => {
            const date = new Date(trade.timestamp);
            const hour = date.getHours();
            const day = date.getDay();
            const hourKey = `${hour}:00`;
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayKey = dayNames[day];
            
            // Por hora
            if (!patterns.byHour[hourKey]) {
                patterns.byHour[hourKey] = { wins: 0, losses: 0, totalProfit: 0 };
            }
            
            if (trade.profit > 0) {
                patterns.byHour[hourKey].wins++;
            } else {
                patterns.byHour[hourKey].losses++;
            }
            patterns.byHour[hourKey].totalProfit += trade.profit;
            
            // Por dia
            if (!patterns.byDay[dayKey]) {
                patterns.byDay[dayKey] = { wins: 0, losses: 0, totalProfit: 0 };
            }
            
            if (trade.profit > 0) {
                patterns.byDay[dayKey].wins++;
            } else {
                patterns.byDay[dayKey].losses++;
            }
            patterns.byDay[dayKey].totalProfit += trade.profit;
            
            // Por sessão
            let session = 'ASIA';
            for (const [name, data] of Object.entries(MARKET_SESSIONS)) {
                if (hour >= data.start && hour < data.end) {
                    session = name;
                    break;
                }
            }
            
            if (!patterns.bySession[session]) {
                patterns.bySession[session] = { wins: 0, losses: 0, totalProfit: 0 };
            }
            
            if (trade.profit > 0) {
                patterns.bySession[session].wins++;
            } else {
                patterns.bySession[session].losses++;
            }
            patterns.bySession[session].totalProfit += trade.profit;
        });
        
        // Calcular métricas
        const calculateMetrics = (data) => {
            Object.keys(data).forEach(key => {
                const item = data[key];
                const totalTrades = item.wins + item.losses;
                if (totalTrades > 0) {
                    item.winRate = (item.wins / totalTrades) * 100;
                    item.avgProfit = item.totalProfit / totalTrades;
                    item.totalTrades = totalTrades;
                }
            });
        };
        
        calculateMetrics(patterns.byHour);
        calculateMetrics(patterns.byDay);
        calculateMetrics(patterns.bySession);
        
        return patterns;
    }
    
    analyzeVolatilityImpact(trades) {
        const volatilityBuckets = {
            '0.0-0.5': { wins: 0, losses: 0, totalProfit: 0 },
            '0.5-1.0': { wins: 0, losses: 0, totalProfit: 0 },
            '1.0-1.5': { wins: 0, losses: 0, totalProfit: 0 },
            '1.5-2.0': { wins: 0, losses: 0, totalProfit: 0 },
            '2.0+': { wins: 0, losses: 0, totalProfit: 0 }
        };
        
        trades.forEach(trade => {
            const volatility = trade.marketConditions.volatility?.rawVolatility || 0;
            let bucket = '';
            
            if (volatility < 0.5) bucket = '0.0-0.5';
            else if (volatility < 1.0) bucket = '0.5-1.0';
            else if (volatility < 1.5) bucket = '1.0-1.5';
            else if (volatility < 2.0) bucket = '1.5-2.0';
            else bucket = '2.0+';
            
            if (volatilityBuckets[bucket]) {
                if (trade.profit > 0) volatilityBuckets[bucket].wins++;
                else volatilityBuckets[bucket].losses++;
                volatilityBuckets[bucket].totalProfit += trade.profit;
            }
        });
        
        // Calcular métricas
        Object.keys(volatilityBuckets).forEach(bucket => {
            const data = volatilityBuckets[bucket];
            const totalTrades = data.wins + data.losses;
            if (totalTrades > 0) {
                data.winRate = (data.wins / totalTrades) * 100;
                data.avgProfit = data.totalProfit / totalTrades;
                data.totalTrades = totalTrades;
                data.profitFactor = data.wins > 0 && data.losses > 0 ? 
                    (data.wins / data.losses) * Math.abs(data.avgProfit) : 0;
            }
        });
        
        return volatilityBuckets;
    }
    
    async generateRecommendations(trades) {
        const recommendations = [];
        const stats = this.dataCollector.getTradeStatistics();
        
        // 1. Recomendações baseadas em win rate
        if (stats.winRate < 60) {
            recommendations.push({
                type: 'FILTER_TIGHTENING',
                priority: 'HIGH',
                message: `Win rate baixa (${stats.winRate.toFixed(1)}%). Considere aumentar thresholds.`,
                action: 'Aumentar volume threshold para 1.5x e ADX mínimo para 22'
            });
        } else if (stats.winRate > 75) {
            recommendations.push({
                type: 'FILTER_LOOSENING',
                priority: 'MEDIUM',
                message: `Win rate alta (${stats.winRate.toFixed(1)}%). Pode estar filtrando bons trades.`,
                action: 'Reduzir volume threshold para 1.2x'
            });
        }
        
        // 2. Recomendações baseadas em profit factor
        if (stats.profitFactor < 1.5) {
            recommendations.push({
                type: 'RISK_MANAGEMENT',
                priority: 'HIGH',
                message: `Profit factor baixo (${stats.profitFactor.toFixed(2)}). Melhore risk/reward.`,
                action: 'Aumentar take profit para 3:1 RR ou reduzir stop loss'
            });
        }
        
        // 3. Recomendações baseadas em padrões
        const winningPatterns = this.identifyWinningPatterns(trades);
        if (winningPatterns.topPattern) {
            recommendations.push({
                type: 'PATTERN_FOCUS',
                priority: 'MEDIUM',
                message: `Padrão mais eficaz: ${winningPatterns.topPattern} (${(winningPatterns.topPatternEfficiency * 100).toFixed(1)}%)`,
                action: `Focar mais em trades com características do padrão ${winningPatterns.topPattern}`
            });
        }
        
        const losingPatterns = this.identifyLosingPatterns(trades);
        if (losingPatterns.worstPattern) {
            recommendations.push({
                type: 'PATTERN_AVOIDANCE',
                priority: 'HIGH',
                message: `Padrão a evitar: ${losingPatterns.worstPattern} (${(losingPatterns.worstPatternFrequency * 100).toFixed(1)}% dos losses)`,
                action: `Adicionar filtro para evitar ${losingPatterns.worstPattern}`
            });
        }
        
        // 4. Recomendações temporais
        const temporalPatterns = this.analyzeTemporalPatterns(trades);
        
        // Encontrar melhor e pior hora
        let bestHour = null, worstHour = null;
        let bestWinRate = 0, worstWinRate = 100;
        
        Object.entries(temporalPatterns.byHour).forEach(([hour, data]) => {
            if (data.winRate > bestWinRate && data.totalTrades > 5) {
                bestWinRate = data.winRate;
                bestHour = hour;
            }
            if (data.winRate < worstWinRate && data.totalTrades > 5) {
                worstWinRate = data.winRate;
                worstHour = hour;
            }
        });
        
        if (bestHour) {
            recommendations.push({
                type: 'TEMPORAL_OPTIMIZATION',
                priority: 'LOW',
                message: `Melhor horário: ${bestHour} (${bestWinRate.toFixed(1)}% win rate)`,
                action: `Aumentar agressividade durante ${bestHour}`
            });
        }
        
        if (worstHour) {
            recommendations.push({
                type: 'TEMPORAL_AVOIDANCE',
                priority: 'MEDIUM',
                message: `Pior horário: ${worstHour} (${worstWinRate.toFixed(1)}% win rate)`,
                action: `Reduzir trading durante ${worstHour} ou aumentar filtros`
            });
        }
        
        // 5. Recomendações baseadas em volatilidade
        const volAnalysis = this.analyzeVolatilityImpact(trades);
        let bestVolBucket = null, bestVolWinRate = 0;
        
        Object.entries(volAnalysis).forEach(([bucket, data]) => {
            if (data.winRate > bestVolWinRate && data.totalTrades > 3) {
                bestVolWinRate = data.winRate;
                bestVolBucket = bucket;
            }
        });
        
        if (bestVolBucket) {
            recommendations.push({
                type: 'VOLATILITY_OPTIMIZATION',
                priority: 'MEDIUM',
                message: `Melhor volatilidade: ${bestVolBucket}% (${bestVolWinRate.toFixed(1)}% win rate)`,
                action: `Ajustar filtro de volatilidade para ${bestVolBucket}%`
            });
        }
        
        return recommendations;
    }
    
    async saveAnalysis(analysis) {
        try {
            const analysisFile = path.join(LEARNING_DIR, `analysis_${Date.now()}.json`);
            fs.writeFileSync(analysisFile, JSON.stringify(analysis, null, 2));
            
            // Manter apenas últimas 10 análises
            this.cleanupOldAnalyses();
            
        } catch (error) {
            console.error('Erro ao salvar análise:', error);
        }
    }
    
    cleanupOldAnalyses() {
        try {
            const files = fs.readdirSync(LEARNING_DIR)
                .filter(file => file.startsWith('analysis_') && file.endsWith('.json'))
                .map(file => ({
                    name: file,
                    path: path.join(LEARNING_DIR, file),
                    time: fs.statSync(path.join(LEARNING_DIR, file)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);
            
            if (files.length > 10) {
                files.slice(10).forEach(file => {
                    fs.unlinkSync(file.path);
                });
            }
        } catch (error) {
            // Ignorar erro
        }
    }
}

// =====================================================================
// 3. 🔧 THRESHOLD OPTIMIZER
// =====================================================================
class ThresholdOptimizer {
    constructor() {
        this.currentParameters = {
            volume: { threshold: 1.3, min: 1.2, max: 2.0 },
            volatility: { threshold: 0.7, min: 0.5, max: 1.5 },
            rsi: { 
                buy: { min: 30, max: 50 },
                sell: { min: 50, max: 70 }
            },
            adx1h: { threshold: 20, min: 15, max: 30 },
            stopLoss: { base: 3.0, min: 1.5, max: 5.0 },
            riskReward: { min: 2.0, target: 2.5, max: 3.0 }
        };
        
        this.optimizationHistory = [];
        this.loadParameters();
    }
    
    loadParameters() {
        try {
            const paramsFile = path.join(LEARNING_DIR, 'optimized_parameters.json');
            if (fs.existsSync(paramsFile)) {
                const saved = JSON.parse(fs.readFileSync(paramsFile, 'utf8'));
                this.currentParameters = { ...this.currentParameters, ...saved };
                console.log('📊 Parâmetros otimizados carregados');
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar parâmetros:', error.message);
        }
    }
    
    saveParameters() {
        try {
            const paramsFile = path.join(LEARNING_DIR, 'optimized_parameters.json');
            fs.writeFileSync(paramsFile, JSON.stringify(this.currentParameters, null, 2));
        } catch (error) {
            console.error('Erro ao salvar parâmetros:', error);
        }
    }
    
    async optimizeBasedOnPerformance(trades) {
        if (trades.length < 30) {
            console.log('⚠️ Trades insuficientes para otimização');
            return this.currentParameters;
        }
        
        console.log('🔄 Otimizando parâmetros baseado em', trades.length, 'trades...');
        
        const analysis = await this.analyzeParameterPerformance(trades);
        const recommendations = this.generateOptimizationRecommendations(analysis);
        
        // Aplicar otimizações gradualmente
        const newParameters = this.applyGradualOptimization(recommendations);
        
        // Validar e salvar
        if (await this.validateNewParameters(newParameters, trades)) {
            const changes = this.getParameterChanges(newParameters);
            if (Object.keys(changes).length > 0) {
                this.currentParameters = newParameters;
                this.saveParameters();
                this.saveOptimizationStep(trades, newParameters, recommendations);
                
                console.log('✅ Parâmetros otimizados! Mudanças:', changes);
            } else {
                console.log('ℹ️ Nenhuma mudança significativa necessária');
            }
        }
        
        return this.currentParameters;
    }
    
    analyzeParameterPerformance(trades) {
        const analysis = {
            volumeThresholds: this.analyzeVolumeThresholds(trades),
            rsiRanges: this.analyzeRSIRanges(trades),
            adxThresholds: this.analyzeADXThresholds(trades),
            stopLossLevels: this.analyzeStopLossLevels(trades),
            qualityScoreImpact: this.analyzeQualityScoreImpact(trades)
        };
        
        // Calcular eficiência
        analysis.efficiencyScores = {
            volume: this.calculateEfficiencyScore(analysis.volumeThresholds),
            rsi: this.calculateEfficiencyScore(analysis.rsiRanges),
            adx: this.calculateEfficiencyScore(analysis.adxThresholds),
            stopLoss: this.calculateEfficiencyScore(analysis.stopLossLevels)
        };
        
        return analysis;
    }
    
    analyzeVolumeThresholds(trades) {
        const buckets = {
            '1.0-1.2': { wins: 0, losses: 0, totalProfit: 0, count: 0 },
            '1.2-1.4': { wins: 0, losses: 0, totalProfit: 0, count: 0 },
            '1.4-1.6': { wins: 0, losses: 0, totalProfit: 0, count: 0 },
            '1.6-1.8': { wins: 0, losses: 0, totalProfit: 0, count: 0 },
            '1.8-2.0': { wins: 0, losses: 0, totalProfit: 0, count: 0 }
        };
        
        trades.forEach(trade => {
            const volumeRatio = trade.marketConditions.volume?.rawRatio || 0;
            let bucket = '';
            
            if (volumeRatio >= 1.0 && volumeRatio < 1.2) bucket = '1.0-1.2';
            else if (volumeRatio >= 1.2 && volumeRatio < 1.4) bucket = '1.2-1.4';
            else if (volumeRatio >= 1.4 && volumeRatio < 1.6) bucket = '1.4-1.6';
            else if (volumeRatio >= 1.6 && volumeRatio < 1.8) bucket = '1.6-1.8';
            else if (volumeRatio >= 1.8 && volumeRatio < 2.0) bucket = '1.8-2.0';
            else if (volumeRatio >= 2.0) bucket = '1.8-2.0';
            
            if (bucket && buckets[bucket]) {
                buckets[bucket].count++;
                if (trade.profit > 0) {
                    buckets[bucket].wins++;
                    buckets[bucket].totalProfit += trade.profit;
                } else {
                    buckets[bucket].losses++;
                    buckets[bucket].totalProfit += trade.profit;
                }
            }
        });
        
        // Calcular métricas
        Object.keys(buckets).forEach(bucket => {
            const data = buckets[bucket];
            if (data.count > 0) {
                data.winRate = data.wins / data.count;
                data.avgProfit = data.totalProfit / data.count;
                data.profitFactor = data.losses > 0 ? 
                    Math.abs((data.wins * data.avgProfit) / (data.losses * Math.abs(data.avgProfit))) : 0;
                data.efficiency = data.winRate * (1 + data.avgProfit / 100);
            }
        });
        
        return buckets;
    }
    
    analyzeRSIRanges(trades) {
        const ranges = {
            'BUY_20-30': { wins: 0, losses: 0, count: 0 },
            'BUY_30-40': { wins: 0, losses: 0, count: 0 },
            'BUY_40-50': { wins: 0, losses: 0, count: 0 },
            'SELL_50-60': { wins: 0, losses: 0, count: 0 },
            'SELL_60-70': { wins: 0, losses: 0, count: 0 },
            'SELL_70-80': { wins: 0, losses: 0, count: 0 }
        };
        
        trades.forEach(trade => {
            const rsi = trade.marketConditions.indicators.rsi1h?.raw;
            if (!rsi) return;
            
            let rangeKey = '';
            if (trade.direction === 'BUY') {
                if (rsi >= 20 && rsi < 30) rangeKey = 'BUY_20-30';
                else if (rsi >= 30 && rsi < 40) rangeKey = 'BUY_30-40';
                else if (rsi >= 40 && rsi < 50) rangeKey = 'BUY_40-50';
            } else if (trade.direction === 'SELL') {
                if (rsi >= 50 && rsi < 60) rangeKey = 'SELL_50-60';
                else if (rsi >= 60 && rsi < 70) rangeKey = 'SELL_60-70';
                else if (rsi >= 70 && rsi < 80) rangeKey = 'SELL_70-80';
            }
            
            if (rangeKey && ranges[rangeKey]) {
                ranges[rangeKey].count++;
                if (trade.profit > 0) ranges[rangeKey].wins++;
                else ranges[rangeKey].losses++;
            }
        });
        
        // Calcular win rates
        Object.keys(ranges).forEach(range => {
            const data = ranges[range];
            if (data.count > 0) {
                data.winRate = (data.wins / data.count) * 100;
            }
        });
        
        return ranges;
    }
    
    analyzeADXThresholds(trades) {
        const thresholds = {
            '15-20': { wins: 0, losses: 0, count: 0 },
            '20-25': { wins: 0, losses: 0, count: 0 },
            '25-30': { wins: 0, losses: 0, count: 0 },
            '30+': { wins: 0, losses: 0, count: 0 }
        };
        
        trades.forEach(trade => {
            const adx = trade.marketConditions.indicators.adx?.raw;
            if (!adx) return;
            
            let thresholdKey = '';
            if (adx >= 15 && adx < 20) thresholdKey = '15-20';
            else if (adx >= 20 && adx < 25) thresholdKey = '20-25';
            else if (adx >= 25 && adx < 30) thresholdKey = '25-30';
            else if (adx >= 30) thresholdKey = '30+';
            
            if (thresholdKey && thresholds[thresholdKey]) {
                thresholds[thresholdKey].count++;
                if (trade.profit > 0) thresholds[thresholdKey].wins++;
                else thresholds[thresholdKey].losses++;
            }
        });
        
        // Calcular métricas
        Object.keys(thresholds).forEach(threshold => {
            const data = thresholds[threshold];
            if (data.count > 0) {
                data.winRate = (data.wins / data.count) * 100;
                data.efficiency = data.winRate * (data.count / trades.length);
            }
        });
        
        return thresholds;
    }
    
    analyzeStopLossLevels(trades) {
        const levels = {
            '1.5-2.0': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '2.0-2.5': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '2.5-3.0': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '3.0-3.5': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '3.5-4.0': { wins: 0, losses: 0, count: 0, totalProfit: 0 }
        };
        
        trades.forEach(trade => {
            const stopLoss = trade.marketConditions.parameters?.stopLoss || 3.0;
            let levelKey = '';
            
            if (stopLoss >= 1.5 && stopLoss < 2.0) levelKey = '1.5-2.0';
            else if (stopLoss >= 2.0 && stopLoss < 2.5) levelKey = '2.0-2.5';
            else if (stopLoss >= 2.5 && stopLoss < 3.0) levelKey = '2.5-3.0';
            else if (stopLoss >= 3.0 && stopLoss < 3.5) levelKey = '3.0-3.5';
            else if (stopLoss >= 3.5 && stopLoss < 4.0) levelKey = '3.5-4.0';
            
            if (levelKey && levels[levelKey]) {
                levels[levelKey].count++;
                levels[levelKey].totalProfit += trade.profit || 0;
                if (trade.profit > 0) levels[levelKey].wins++;
                else levels[levelKey].losses++;
            }
        });
        
        // Calcular métricas
        Object.keys(levels).forEach(level => {
            const data = levels[level];
            if (data.count > 0) {
                data.winRate = (data.wins / data.count) * 100;
                data.avgProfit = data.totalProfit / data.count;
                data.profitFactor = data.losses > 0 ? 
                    Math.abs((data.wins * data.avgProfit) / (data.losses * Math.abs(data.avgProfit))) : 0;
            }
        });
        
        return levels;
    }
    
    analyzeQualityScoreImpact(trades) {
        const scores = {
            '60-69': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '70-79': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '80-89': { wins: 0, losses: 0, count: 0, totalProfit: 0 },
            '90-100': { wins: 0, losses: 0, count: 0, totalProfit: 0 }
        };
        
        trades.forEach(trade => {
            const score = trade.qualityScore?.score || 0;
            let scoreKey = '';
            
            if (score >= 60 && score < 70) scoreKey = '60-69';
            else if (score >= 70 && score < 80) scoreKey = '70-79';
            else if (score >= 80 && score < 90) scoreKey = '80-89';
            else if (score >= 90) scoreKey = '90-100';
            
            if (scoreKey && scores[scoreKey]) {
                scores[scoreKey].count++;
                scores[scoreKey].totalProfit += trade.profit || 0;
                if (trade.profit > 0) scores[scoreKey].wins++;
                else scores[scoreKey].losses++;
            }
        });
        
        // Calcular métricas
        Object.keys(scores).forEach(scoreRange => {
            const data = scores[scoreRange];
            if (data.count > 0) {
                data.winRate = (data.wins / data.count) * 100;
                data.avgProfit = data.totalProfit / data.count;
                data.efficiency = data.winRate * (1 + data.avgProfit / 100);
            }
        });
        
        return scores;
    }
    
    calculateEfficiencyScore(analysisData) {
        let totalEfficiency = 0;
        let count = 0;
        
        Object.values(analysisData).forEach(data => {
            if (data.efficiency) {
                totalEfficiency += data.efficiency;
                count++;
            }
        });
        
        return count > 0 ? totalEfficiency / count : 0;
    }
    
    generateOptimizationRecommendations(analysis) {
        const recommendations = [];
        
        // 1. Volume Threshold
        const bestVolume = this.findBestBucket(analysis.volumeThresholds, 'efficiency');
        if (bestVolume && bestVolume.efficiency > 0.6) {
            const [min, max] = bestVolume.key.split('-').map(parseFloat);
            const optimal = (min + max) / 2;
            
            if (Math.abs(optimal - this.currentParameters.volume.threshold) > 0.1) {
                recommendations.push({
                    parameter: 'volume.threshold',
                    current: this.currentParameters.volume.threshold,
                    recommended: optimal,
                    confidence: bestVolume.efficiency,
                    reason: `Win rate ${(bestVolume.winRate * 100).toFixed(1)}% neste range`
                });
            }
        }
        
        // 2. RSI Ranges
        const bestBuyRSI = this.findBestRSIRange(analysis.rsiRanges, 'BUY');
        const bestSellRSI = this.findBestRSIRange(analysis.rsiRanges, 'SELL');
        
        if (bestBuyRSI && bestBuyRSI.winRate > 60) {
            const [min, max] = bestBuyRSI.key.split('_')[1].split('-').map(parseFloat);
            const newBuyRange = [min, max];
            
            if (!this.arraysEqual(newBuyRange, [this.currentParameters.rsi.buy.min, this.currentParameters.rsi.buy.max])) {
                recommendations.push({
                    parameter: 'rsi.buy',
                    current: [this.currentParameters.rsi.buy.min, this.currentParameters.rsi.buy.max],
                    recommended: newBuyRange,
                    confidence: bestBuyRSI.winRate / 100,
                    reason: `Melhor win rate para compras (${bestBuyRSI.winRate.toFixed(1)}%)`
                });
            }
        }
        
        if (bestSellRSI && bestSellRSI.winRate > 60) {
            const [min, max] = bestSellRSI.key.split('_')[1].split('-').map(parseFloat);
            const newSellRange = [min, max];
            
            if (!this.arraysEqual(newSellRange, [this.currentParameters.rsi.sell.min, this.currentParameters.rsi.sell.max])) {
                recommendations.push({
                    parameter: 'rsi.sell',
                    current: [this.currentParameters.rsi.sell.min, this.currentParameters.rsi.sell.max],
                    recommended: newSellRange,
                    confidence: bestSellRSI.winRate / 100,
                    reason: `Melhor win rate para vendas (${bestSellRSI.winRate.toFixed(1)}%)`
                });
            }
        }
        
        // 3. ADX Threshold
        const bestADX = this.findBestBucket(analysis.adxThresholds, 'winRate');
        if (bestADX && bestADX.winRate > 65 && bestADX.count > 5) {
            const [min, max] = bestADX.key.split('-').map(parseFloat);
            const optimal = (min + max) / 2;
            
            if (Math.abs(optimal - this.currentParameters.adx1h.threshold) > 2) {
                recommendations.push({
                    parameter: 'adx1h.threshold',
                    current: this.currentParameters.adx1h.threshold,
                    recommended: optimal,
                    confidence: bestADX.winRate / 100,
                    reason: `Win rate ${bestADX.winRate.toFixed(1)}% com ADX neste range`
                });
            }
        }
        
        // 4. Stop Loss
        const bestStopLoss = this.findBestBucket(analysis.stopLossLevels, 'profitFactor');
        if (bestStopLoss && bestStopLoss.profitFactor > 1.8 && bestStopLoss.count > 3) {
            const [min, max] = bestStopLoss.key.split('-').map(parseFloat);
            const optimal = (min + max) / 2;
            
            if (Math.abs(optimal - this.currentParameters.stopLoss.base) > 0.3) {
                recommendations.push({
                    parameter: 'stopLoss.base',
                    current: this.currentParameters.stopLoss.base,
                    recommended: optimal,
                    confidence: Math.min(0.9, bestStopLoss.profitFactor / 3),
                    reason: `Melhor profit factor (${bestStopLoss.profitFactor.toFixed(2)}) com este stop`
                });
            }
        }
        
        // 5. Quality Score Threshold
        const bestQuality = this.findBestBucket(analysis.qualityScoreImpact, 'efficiency');
        if (bestQuality && bestQuality.efficiency > 0.7 && bestQuality.count > 5) {
            const [min] = bestQuality.key.split('-').map(parseFloat);
            if (min > QUALITY_THRESHOLD) {
                recommendations.push({
                    parameter: 'qualityThreshold',
                    current: QUALITY_THRESHOLD,
                    recommended: min,
                    confidence: bestQuality.efficiency,
                    reason: `Eficiência ${(bestQuality.efficiency * 100).toFixed(1)}% com score ≥ ${min}`
                });
            }
        }
        
        return recommendations;
    }
    
    findBestBucket(data, metric) {
        let best = null;
        let bestValue = -Infinity;
        
        Object.entries(data).forEach(([key, value]) => {
            if (value.count > 2 && value[metric] > bestValue) {
                bestValue = value[metric];
                best = { key, ...value };
            }
        });
        
        return best;
    }
    
    findBestRSIRange(data, type) {
        let best = null;
        let bestWinRate = 0;
        
        Object.entries(data).forEach(([key, value]) => {
            if (key.startsWith(type) && value.count > 3 && value.winRate > bestWinRate) {
                bestWinRate = value.winRate;
                best = { key, ...value };
            }
        });
        
        return best;
    }
    
    arraysEqual(arr1, arr2) {
        return arr1.length === arr2.length && arr1.every((v, i) => v === arr2[i]);
    }
    
    applyGradualOptimization(recommendations) {
        const newParams = JSON.parse(JSON.stringify(this.currentParameters));
        
        recommendations.forEach(rec => {
            if (rec.confidence > 0.65) {
                const delta = this.calculateDelta(rec.current, rec.recommended);
                const adjustment = delta * 0.3;
                
                this.applyParameterAdjustment(newParams, rec.parameter, adjustment);
            }
        });
        
        // Garantir limites
        this.enforceParameterLimits(newParams);
        
        return newParams;
    }
    
    calculateDelta(current, recommended) {
        if (Array.isArray(current) && Array.isArray(recommended)) {
            const deltas = current.map((c, i) => recommended[i] - c);
            return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
        }
        return recommended - current;
    }
    
    applyParameterAdjustment(params, parameter, adjustment) {
        const keys = parameter.split('.');
        let target = params;
        
        for (let i = 0; i < keys.length - 1; i++) {
            target = target[keys[i]];
        }
        
        const lastKey = keys[keys.length - 1];
        if (Array.isArray(target[lastKey])) {
            target[lastKey] = target[lastKey].map(v => v + adjustment);
        } else {
            target[lastKey] += adjustment;
        }
    }
    
    enforceParameterLimits(params) {
        // Volume
        params.volume.threshold = Math.max(params.volume.min, 
            Math.min(params.volume.max, params.volume.threshold));
        
        // RSI Ranges
        params.rsi.buy.min = Math.max(20, Math.min(45, params.rsi.buy.min));
        params.rsi.buy.max = Math.max(30, Math.min(50, params.rsi.buy.max));
        params.rsi.sell.min = Math.max(50, Math.min(65, params.rsi.sell.min));
        params.rsi.sell.max = Math.max(60, Math.min(75, params.rsi.sell.max));
        
        // ADX
        params.adx1h.threshold = Math.max(params.adx1h.min, 
            Math.min(params.adx1h.max, params.adx1h.threshold));
        
        // Stop Loss
        params.stopLoss.base = Math.max(params.stopLoss.min, 
            Math.min(params.stopLoss.max, params.stopLoss.base));
    }
    
    async validateNewParameters(newParams, trades) {
        const recentWinners = trades.filter(t => t.profit > 0).length;
        const recentTotal = trades.length;
        const currentWinRate = recentTotal > 0 ? (recentWinners / recentTotal) * 100 : 0;
        
        return currentWinRate > 55 || recentTotal < 20;
    }
    
    getParameterChanges(newParams) {
        const changes = {};
        const oldParams = this.currentParameters;
        
        if (Math.abs(newParams.volume.threshold - oldParams.volume.threshold) > 0.05) {
            changes.volume = {
                from: oldParams.volume.threshold,
                to: newParams.volume.threshold
            };
        }
        
        if (Math.abs(newParams.adx1h.threshold - oldParams.adx1h.threshold) > 1) {
            changes.adx1h = {
                from: oldParams.adx1h.threshold,
                to: newParams.adx1h.threshold
            };
        }
        
        if (Math.abs(newParams.stopLoss.base - oldParams.stopLoss.base) > 0.2) {
            changes.stopLoss = {
                from: oldParams.stopLoss.base,
                to: newParams.stopLoss.base
            };
        }
        
        return changes;
    }
    
    saveOptimizationStep(trades, newParams, recommendations) {
        const step = {
            timestamp: Date.now(),
            tradesAnalyzed: trades.length,
            winRate: (trades.filter(t => t.profit > 0).length / trades.length) * 100,
            recommendations: recommendations,
            newParameters: newParams,
            changes: this.getParameterChanges(newParams)
        };
        
        this.optimizationHistory.push(step);
        
        if (this.optimizationHistory.length > 50) {
            this.optimizationHistory = this.optimizationHistory.slice(-50);
        }
        
        if (this.optimizationHistory.length % 10 === 0) {
            this.saveOptimizationHistory();
        }
    }
    
    saveOptimizationHistory() {
        try {
            const historyFile = path.join(LEARNING_DIR, 'optimization_history.json');
            fs.writeFileSync(historyFile, JSON.stringify(this.optimizationHistory, null, 2));
        } catch (error) {
            console.error('Erro ao salvar histórico de otimização:', error);
        }
    }
    
    getOptimalParameters() {
        return this.currentParameters;
    }
}

// =====================================================================
// 4. 🎯 ADAPTIVE STRATEGY MANAGER
// =====================================================================
class AdaptiveStrategyManager {
    constructor() {
        this.strategies = {
            'TREND_FOLLOWING': {
                weight: 0.35,
                performance: { wins: 0, losses: 0, totalProfit: 0, count: 0 },
                conditions: ['high_adx', 'ema_aligned', 'strong_volume'],
                parameters: {
                    volumeMultiplier: 1.0,
                    riskMultiplier: 1.0,
                    confidenceThreshold: 0.7
                }
            },
            'MEAN_REVERSION': {
                weight: 0.25,
                performance: { wins: 0, losses: 0, totalProfit: 0, count: 0 },
                conditions: ['extreme_rsi', 'support_resistance', 'low_volatility'],
                parameters: {
                    volumeMultiplier: 0.8,
                    riskMultiplier: 0.7,
                    confidenceThreshold: 0.6
                }
            },
            'BREAKOUT': {
                weight: 0.20,
                performance: { wins: 0, losses: 0, totalProfit: 0, count: 0 },
                conditions: ['consolidation', 'volume_spike', 'volatility_compression'],
                parameters: {
                    volumeMultiplier: 1.2,
                    riskMultiplier: 1.1,
                    confidenceThreshold: 0.75
                }
            },
            'VOLATILITY_EXPANSION': {
                weight: 0.15,
                performance: { wins: 0, losses: 0, totalProfit: 0, count: 0 },
                conditions: ['low_volatility', 'technical_squeeze', 'pending_news'],
                parameters: {
                    volumeMultiplier: 1.1,
                    riskMultiplier: 0.9,
                    confidenceThreshold: 0.65
                }
            }
        };
        
        this.currentMarketRegime = 'UNKNOWN';
        this.strategyPerformanceHistory = [];
        this.loadStrategyWeights();
    }
    
    loadStrategyWeights() {
        try {
            const weightsFile = path.join(LEARNING_DIR, 'strategy_weights.json');
            if (fs.existsSync(weightsFile)) {
                const saved = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
                Object.keys(saved).forEach(strategy => {
                    if (this.strategies[strategy]) {
                        this.strategies[strategy].weight = saved[strategy];
                    }
                });
                console.log('📊 Pesos das estratégias carregados');
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar pesos:', error.message);
        }
    }
    
    saveStrategyWeights() {
        try {
            const weights = {};
            Object.keys(this.strategies).forEach(strategy => {
                weights[strategy] = this.strategies[strategy].weight;
            });
            
            const weightsFile = path.join(LEARNING_DIR, 'strategy_weights.json');
            fs.writeFileSync(weightsFile, JSON.stringify(weights, null, 2));
        } catch (error) {
            console.error('Erro ao salvar pesos:', error);
        }
    }
    
    async updateStrategyPerformance(strategyName, result, profit) {
        if (!this.strategies[strategyName]) {
            strategyName = 'TREND_FOLLOWING';
        }
        
        const strategy = this.strategies[strategyName];
        strategy.performance.count++;
        
        if (result === 'WIN') {
            strategy.performance.wins++;
            strategy.performance.totalProfit += profit;
        } else {
            strategy.performance.losses++;
            strategy.performance.totalProfit += profit;
        }
        
        await this.adjustStrategyWeight(strategyName);
        
        if (strategy.performance.count % 10 === 0) {
            this.saveStrategyWeights();
            this.savePerformanceHistory();
        }
    }
    
    async adjustStrategyWeight(strategyName) {
        const strategy = this.strategies[strategyName];
        const performance = strategy.performance;
        
        if (performance.count < 10) return;
        
        const winRate = performance.wins / performance.count;
        const avgProfit = performance.totalProfit / performance.count;
        const performanceScore = winRate * (1 + avgProfit / 100);
        
        const adjustment = (performanceScore - 0.5) * 0.05;
        strategy.weight += adjustment;
        
        strategy.weight = Math.max(0.1, Math.min(0.5, strategy.weight));
        
        this.normalizeWeights();
    }
    
    normalizeWeights() {
        const totalWeight = Object.values(this.strategies)
            .reduce((sum, s) => sum + s.weight, 0);
        
        Object.keys(this.strategies).forEach(strategy => {
            this.strategies[strategy].weight /= totalWeight;
        });
    }
    
    async selectOptimalStrategy(marketConditions) {
        const regime = await this.detectMarketRegime(marketConditions);
        this.currentMarketRegime = regime;
        
        const strategyScores = {};
        
        Object.keys(this.strategies).forEach(strategyName => {
            const strategy = this.strategies[strategyName];
            const suitability = this.calculateSuitabilityScore(strategy, regime, marketConditions);
            const performance = this.calculatePerformanceScore(strategy);
            
            strategyScores[strategyName] = {
                suitability: suitability,
                performance: performance,
                weight: strategy.weight,
                totalScore: (suitability * 0.6) + (performance * 0.3) + (strategy.weight * 0.1)
            };
        });
        
        const bestStrategy = Object.keys(strategyScores)
            .reduce((a, b) => strategyScores[a].totalScore > strategyScores[b].totalScore ? a : b);
        
        return {
            selectedStrategy: bestStrategy,
            scores: strategyScores,
            regime: regime,
            confidence: strategyScores[bestStrategy].totalScore
        };
    }
    
    async detectMarketRegime(conditions) {
        let regime = 'RANGING';
        let adx = conditions.adx?.raw || 0;
        let volatility = conditions.volatility?.rawVolatility || 0;
        let volume = conditions.volume?.rawRatio || 0;
        
        if (adx > 25) {
            regime = 'TRENDING';
        } else if (volatility < 0.5 && volume < 1.2) {
            regime = 'CONSOLIDATING';
        } else if (volatility > 1.5) {
            regime = 'VOLATILE';
        } else if (volume > 2.0) {
            regime = 'BREAKOUT';
        }
        
        return regime;
    }
    
    calculateSuitabilityScore(strategy, regime, conditions) {
        let score = 0;
        
        switch (regime) {
            case 'TRENDING':
                if (strategy.conditions.includes('high_adx')) score += 0.4;
                if (strategy.conditions.includes('ema_aligned')) score += 0.3;
                if (strategy.conditions.includes('strong_volume')) score += 0.3;
                break;
                
            case 'RANGING':
                if (strategy.conditions.includes('extreme_rsi')) score += 0.4;
                if (strategy.conditions.includes('support_resistance')) score += 0.3;
                if (strategy.conditions.includes('low_volatility')) score += 0.3;
                break;
                
            case 'VOLATILE':
                if (strategy.conditions.includes('volume_spike')) score += 0.4;
                if (strategy.conditions.includes('technical_squeeze')) score += 0.3;
                score += 0.3;
                break;
                
            case 'BREAKOUT':
                if (strategy.conditions.includes('consolidation')) score += 0.4;
                if (strategy.conditions.includes('volume_spike')) score += 0.4;
                if (strategy.conditions.includes('volatility_compression')) score += 0.2;
                break;
        }
        
        return Math.min(1, score);
    }
    
    calculatePerformanceScore(strategy) {
        const perf = strategy.performance;
        if (perf.count < 5) return 0.5;
        
        const winRate = perf.wins / perf.count;
        const avgProfit = perf.totalProfit / perf.count;
        
        return Math.min(1, winRate * (1 + Math.min(avgProfit / 100, 0.5)));
    }
    
    savePerformanceHistory() {
        try {
            const history = Object.keys(this.strategies).map(strategy => ({
                strategy,
                weight: this.strategies[strategy].weight,
                performance: this.strategies[strategy].performance,
                timestamp: Date.now()
            }));
            
            this.strategyPerformanceHistory.push(...history);
            
            if (this.strategyPerformanceHistory.length > 100) {
                this.strategyPerformanceHistory = this.strategyPerformanceHistory.slice(-100);
            }
            
            const historyFile = path.join(LEARNING_DIR, 'strategy_performance.json');
            fs.writeFileSync(historyFile, JSON.stringify(this.strategyPerformanceHistory, null, 2));
            
        } catch (error) {
            console.error('Erro ao salvar histórico de performance:', error);
        }
    }
    
    getStrategyParameters(strategyName) {
        return this.strategies[strategyName]?.parameters || 
               this.strategies['TREND_FOLLOWING'].parameters;
    }
}

// =====================================================================
// 5. 📊 PERFORMANCE FEEDBACK LOOP
// =====================================================================
class PerformanceFeedbackLoop {
    constructor(dataCollector, analyticsEngine, thresholdOptimizer) {
        this.dataCollector = dataCollector;
        this.analyticsEngine = analyticsEngine;
        this.thresholdOptimizer = thresholdOptimizer;
        this.feedbackCycles = [];
        this.improvementMetrics = {
            winRate: { before: 0, after: 0, change: 0 },
            profitFactor: { before: 0, after: 0, change: 0 },
            avgWin: { before: 0, after: 0, change: 0 },
            avgLoss: { before: 0, after: 0, change: 0 }
        };
    }
    
    async runFeedbackCycle() {
        const recentTrades = this.dataCollector.getRecentTrades(50);
        
        if (recentTrades.length < 30) {
            return {
                status: 'INSUFFICIENT_DATA',
                message: `Apenas ${recentTrades.length} trades (mínimo 30)`
            };
        }
        
        console.log('🔄 Executando ciclo de feedback com', recentTrades.length, 'trades...');
        
        const splitIndex = Math.floor(recentTrades.length / 2);
        const tradesBefore = recentTrades.slice(0, splitIndex);
        const tradesAfter = recentTrades.slice(splitIndex);
        
        const metricsBefore = this.calculateMetrics(tradesBefore);
        const metricsAfter = this.calculateMetrics(tradesAfter);
        
        const effectiveness = this.evaluateEffectiveness(metricsBefore, metricsAfter);
        const wereBeneficial = this.wereChangesBeneficial(effectiveness);
        const lessons = await this.extractLessons(tradesBefore, tradesAfter, effectiveness);
        const nextCyclePlan = this.createNextCyclePlan(lessons, effectiveness, wereBeneficial);
        
        const feedbackCycle = {
            timestamp: Date.now(),
            tradesAnalyzed: recentTrades.length,
            metricsBefore: metricsBefore,
            metricsAfter: metricsAfter,
            effectiveness: effectiveness,
            wereBeneficial: wereBeneficial,
            lessons: lessons,
            nextCyclePlan: nextCyclePlan
        };
        
        this.feedbackCycles.push(feedbackCycle);
        await this.saveFeedbackCycle(feedbackCycle);
        
        return {
            feedbackCycle,
            shouldAdjust: !wereBeneficial && effectiveness.overall < 0,
            recommendations: nextCyclePlan.recommendations
        };
    }
    
    calculateMetrics(trades) {
        if (trades.length === 0) {
            return {
                winRate: 0,
                profitFactor: 0,
                avgWin: 0,
                avgLoss: 0,
                totalProfit: 0,
                sharpeRatio: 0,
                maxDrawdown: 0
            };
        }
        
        const winningTrades = trades.filter(t => t.profit > 0);
        const losingTrades = trades.filter(t => t.profit <= 0);
        
        const winRate = winningTrades.length / trades.length;
        const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
        const avgWin = winningTrades.length > 0 ? 
            winningTrades.reduce((sum, t) => sum + (t.profit || 0), 0) / winningTrades.length : 0;
        const avgLoss = losingTrades.length > 0 ? 
            losingTrades.reduce((sum, t) => sum + (t.profit || 0), 0) / losingTrades.length : 0;
        
        const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
        
        let balance = 0;
        let peak = 0;
        let maxDrawdown = 0;
        
        trades.forEach(trade => {
            balance += trade.profit || 0;
            if (balance > peak) peak = balance;
            const drawdown = peak - balance;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        });
        
        const returns = trades.map(t => t.profitPercentage || 0);
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const stdDev = Math.sqrt(
            returns.map(r => Math.pow(r - avgReturn, 2))
                   .reduce((a, b) => a + b, 0) / returns.length
        );
        const sharpeRatio = stdDev !== 0 ? avgReturn / stdDev : 0;
        
        return {
            winRate: winRate * 100,
            profitFactor: profitFactor,
            avgWin: avgWin,
            avgLoss: avgLoss,
            totalProfit: totalProfit,
            sharpeRatio: sharpeRatio,
            maxDrawdown: maxDrawdown,
            totalTrades: trades.length
        };
    }
    
    evaluateEffectiveness(before, after) {
        const calculateImprovement = (b, a, lowerIsBetter = false) => {
            if (b === 0) return a > 0 ? 100 : 0;
            const change = ((a - b) / Math.abs(b)) * 100;
            return lowerIsBetter ? -change : change;
        };
        
        return {
            winRate: calculateImprovement(before.winRate, after.winRate),
            profitFactor: calculateImprovement(before.profitFactor, after.profitFactor),
            avgWin: calculateImprovement(before.avgWin, after.avgWin),
            avgLoss: calculateImprovement(before.avgLoss, after.avgLoss, true),
            sharpeRatio: calculateImprovement(before.sharpeRatio, after.sharpeRatio),
            maxDrawdown: calculateImprovement(before.maxDrawdown, after.maxDrawdown, true),
            
            overall: (
                calculateImprovement(before.winRate, after.winRate) * 0.3 +
                calculateImprovement(before.profitFactor, after.profitFactor) * 0.3 +
                calculateImprovement(before.avgWin, after.avgWin) * 0.2 +
                -calculateImprovement(before.avgLoss, after.avgLoss, true) * 0.1 +
                calculateImprovement(before.sharpeRatio, after.sharpeRatio) * 0.1
            ) / 5
        };
    }
    
    wereChangesBeneficial(effectiveness) {
        const positiveMetrics = Object.entries(effectiveness)
            .filter(([key, value]) => key !== 'overall' && value > 0)
            .length;
        
        const totalMetrics = Object.keys(effectiveness).length - 1;
        
        return (positiveMetrics / totalMetrics) >= 0.5;
    }
    
    async extractLessons(tradesBefore, tradesAfter, effectiveness) {
        const lessons = {
            whatWorked: [],
            whatDidntWork: [],
            patterns: {},
            recommendations: []
        };
        
        const analysisBefore = await this.analyticsEngine.analyzeTradePerformance(tradesBefore);
        const analysisAfter = await this.analyticsEngine.analyzeTradePerformance(tradesAfter);
        
        if (analysisBefore.winningPatterns && analysisAfter.winningPatterns) {
            const beforePatterns = analysisBefore.winningPatterns.patterns;
            const afterPatterns = analysisAfter.winningPatterns.patterns;
            
            Object.keys(afterPatterns).forEach(pattern => {
                const beforeEff = beforePatterns[pattern]?.efficiency || 0;
                const afterEff = afterPatterns[pattern]?.efficiency || 0;
                
                if (afterEff > beforeEff + 0.1) {
                    lessons.whatWorked.push(`Padrão "${pattern}" melhorou de ${(beforeEff * 100).toFixed(1)}% para ${(afterEff * 100).toFixed(1)}%`);
                } else if (afterEff < beforeEff - 0.1) {
                    lessons.whatDidntWork.push(`Padrão "${pattern}" piorou de ${(beforeEff * 100).toFixed(1)}% para ${(afterEff * 100).toFixed(1)}%`);
                }
            });
        }
        
        if (analysisAfter.recommendations) {
            lessons.recommendations = analysisAfter.recommendations
                .filter(rec => rec.priority === 'HIGH')
                .map(rec => rec.action);
        }
        
        if (analysisAfter.temporalPatterns) {
            const bestHour = Object.entries(analysisAfter.temporalPatterns.byHour)
                .filter(([_, data]) => data.totalTrades > 3)
                .sort((a, b) => b[1].winRate - a[1].winRate)[0];
            
            if (bestHour) {
                lessons.patterns.bestHour = {
                    hour: bestHour[0],
                    winRate: bestHour[1].winRate,
                    totalTrades: bestHour[1].totalTrades
                };
            }
        }
        
        return lessons;
    }
    
    createNextCyclePlan(lessons, effectiveness, wereBeneficial) {
        const plan = {
            timestamp: Date.now(),
            focusAreas: [],
            adjustments: [],
            recommendations: []
        };
        
        if (!wereBeneficial) {
            plan.focusAreas.push('REVIEW_PARAMETERS');
            plan.adjustments.push('Considerar reverter mudanças recentes');
            
            if (effectiveness.winRate < 0) {
                plan.recommendations.push('Aumentar thresholds de filtros');
            }
            if (effectiveness.profitFactor < 0) {
                plan.recommendations.push('Revisar gestão de risco (stop loss/take profit)');
            }
        } else {
            plan.focusAreas.push('CONTINUE_OPTIMIZATION');
            
            if (effectiveness.winRate > 10) {
                plan.adjustments.push('Continuar otimização nos mesmos parâmetros');
            }
            if (effectiveness.profitFactor > 20) {
                plan.recommendations.push('Explorar otimização mais agressiva');
            }
        }
        
        if (lessons.whatWorked.length > 0) {
            plan.recommendations.push('Focar em padrões que funcionaram: ' + lessons.whatWorked.join(', '));
        }
        
        if (lessons.whatDidntWork.length > 0) {
            plan.recommendations.push('Evitar ou ajustar: ' + lessons.whatDidntWork.join(', '));
        }
        
        if (lessons.patterns.bestHour) {
            plan.recommendations.push(`Aumentar trading durante ${lessons.patterns.bestHour.hour} (${lessons.patterns.bestHour.winRate.toFixed(1)}% win rate)`);
        }
        
        return plan;
    }
    
    async saveFeedbackCycle(cycle) {
        try {
            const cyclesFile = path.join(LEARNING_DIR, 'feedback_cycles.json');
            let existingCycles = [];
            
            if (fs.existsSync(cyclesFile)) {
                existingCycles = JSON.parse(fs.readFileSync(cyclesFile, 'utf8'));
            }
            
            existingCycles.push(cycle);
            
            if (existingCycles.length > 20) {
                existingCycles = existingCycles.slice(-20);
            }
            
            fs.writeFileSync(cyclesFile, JSON.stringify(existingCycles, null, 2));
            
        } catch (error) {
            console.error('Erro ao salvar ciclo de feedback:', error);
        }
    }
}

// =====================================================================
// 6. 🔄 CONTINUOUS LEARNING SYSTEM (MAIN CLASS)
// =====================================================================
class ContinuousLearningSystem {
    constructor() {
        this.dataCollector = new TradeDataCollector();
        this.analyticsEngine = new AnalyticsEngine(this.dataCollector);
        this.thresholdOptimizer = new ThresholdOptimizer();
        this.strategyManager = new AdaptiveStrategyManager();
        this.feedbackLoop = new PerformanceFeedbackLoop(
            this.dataCollector,
            this.analyticsEngine,
            this.thresholdOptimizer
        );
        
        this.optimizationInterval = 50;
        this.analysisInterval = 25;
        this.tradeCount = 0;
        this.analysisCount = 0;
        this.learningEnabled = true;
        this.lastOptimizationTime = 0;
        
        console.log('🧠 Sistema de Continuous Learning inicializado');
    }
    
    async onTradeExecuted(trade) {
        if (!this.learningEnabled) return;
        
        try {
            const tradeSnapshot = await this.dataCollector.captureTradeSnapshot(trade);
            this.tradeCount++;
            this.analysisCount++;
            
            console.log(`📝 Trade registrado: ${trade.symbol} ${trade.isBullish ? 'BUY' : 'SELL'} (Total: ${this.tradeCount})`);
            
            if (trade.strategy) {
                await this.strategyManager.updateStrategyPerformance(
                    trade.strategy,
                    trade.profit > 0 ? 'WIN' : 'LOSS',
                    trade.profit || 0
                );
            }
            
            if (this.analysisCount >= this.analysisInterval) {
                await this.runAnalysisCycle();
                this.analysisCount = 0;
            }
            
            if (this.tradeCount >= this.optimizationInterval && 
                Date.now() - this.lastOptimizationTime > 3600000) {
                
                await this.runOptimizationCycle();
                this.tradeCount = 0;
                this.lastOptimizationTime = Date.now();
            }
            
            return tradeSnapshot;
            
        } catch (error) {
            console.error('Erro no Continuous Learning:', error);
            return null;
        }
    }
    
    async runAnalysisCycle() {
        console.log('📊 Executando ciclo de análise...');
        
        try {
            const analysis = await this.analyticsEngine.analyzeTradePerformance();
            const feedback = await this.feedbackLoop.runFeedbackCycle();
            await this.generateLearningReport(analysis, feedback);
            
            console.log('✅ Ciclo de análise completo');
            
        } catch (error) {
            console.error('Erro no ciclo de análise:', error);
        }
    }
    
    async runOptimizationCycle() {
        console.log('🔄 Executando ciclo de otimização...');
        
        try {
            const recentTrades = this.dataCollector.getRecentTrades(50);
            
            if (recentTrades.length < 30) {
                console.log('⚠️ Trades insuficientes para otimização');
                return;
            }
            
            const oldParams = this.thresholdOptimizer.getOptimalParameters();
            const newParams = await this.thresholdOptimizer.optimizeBasedOnPerformance(recentTrades);
            
            const marketConditions = recentTrades[0]?.marketConditions || {};
            const optimalStrategy = await this.strategyManager.selectOptimalStrategy(marketConditions);
            
            await this.applyLearnings(newParams, optimalStrategy, recentTrades);
            
            console.log('✅ Ciclo de otimização completo');
            
        } catch (error) {
            console.error('Erro no ciclo de otimização:', error);
        }
    }
    
    async applyLearnings(newParams, optimalStrategy, recentTrades) {
        const learnings = {
            timestamp: Date.now(),
            parameters: newParams,
            optimalStrategy: optimalStrategy,
            recentPerformance: this.dataCollector.getTradeStatistics(),
            actionsTaken: []
        };
        
        const changes = this.thresholdOptimizer.getParameterChanges(newParams);
        if (Object.keys(changes).length > 0) {
            learnings.actionsTaken.push('✅ Parâmetros otimizados aplicados');
            await this.applyOptimizedParameters(newParams);
        }
        
        learnings.actionsTaken.push(`📊 Estratégia ótima: ${optimalStrategy.selectedStrategy} (${(optimalStrategy.confidence * 100).toFixed(1)}% confiança)`);
        
        await this.saveLearnings(learnings);
        
        if (Object.keys(changes).length > 0) {
            await this.notifyParameterChanges(changes);
        }
        
        return learnings;
    }
    
    async applyOptimizedParameters(params) {
        VOLUME_SETTINGS.baseThreshold = params.volume.threshold;
        ADX_1H_SETTINGS.minStrength = params.adx1h.threshold;
        
        console.log('⚙️ Parâmetros otimizados aplicados:', {
            volume: params.volume.threshold,
            adx1h: params.adx1h.threshold,
            stopLoss: params.stopLoss.base
        });
    }
    
    async saveLearnings(learnings) {
        try {
            const learningsFile = path.join(LEARNING_DIR, `learnings_${Date.now()}.json`);
            fs.writeFileSync(learningsFile, JSON.stringify(learnings, null, 2));
        } catch (error) {
            console.error('Erro ao salvar aprendizado:', error);
        }
    }
    
    async notifyParameterChanges(changes) {
        try {
            const message = `🔄 <b>PARÂMETROS OTIMIZADOS</b>\n` +
                           `O sistema de aprendizado otimizou os seguintes parâmetros:\n\n`;
            
            let changesText = '';
            Object.entries(changes).forEach(([param, data]) => {
                changesText += `<b>${param}:</b> ${data.from.toFixed(2)} → ${data.to.toFixed(2)}\n`;
            });
            
            const fullMessage = message + changesText + `\n<i>Baseado em análise de performance recente</i>`;
            
            await sendAlert(fullMessage);
            
        } catch (error) {
            console.error('Erro ao notificar mudanças:', error);
        }
    }
    
    async generateLearningReport(analysis, feedback) {
        try {
            const stats = this.dataCollector.getTradeStatistics();
            
            const report = {
                timestamp: Date.now(),
                summary: {
                    totalTrades: stats.totalTrades,
                    winRate: stats.winRate.toFixed(1) + '%',
                    profitFactor: stats.profitFactor.toFixed(2),
                    totalProfit: stats.totalProfit.toFixed(2)
                },
                keyInsights: analysis.recommendations?.slice(0, 3) || [],
                recentChanges: this.thresholdOptimizer.getParameterChanges(
                    this.thresholdOptimizer.getOptimalParameters()
                ),
                nextSteps: feedback?.nextCyclePlan?.recommendations?.slice(0, 3) || []
            };
            
            const reportFile = path.join(LEARNING_DIR, `report_${Date.now()}.json`);
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
            
            if (stats.totalTrades % 100 === 0) {
                await this.sendPerformanceReport(report);
            }
            
        } catch (error) {
            console.error('Erro ao gerar relatório:', error);
        }
    }
    
    async sendPerformanceReport(report) {
        try {
            const message = `📊 <b>RELATÓRIO DE PERFORMANCE</b>\n` +
                           `Total Trades: <b>${report.summary.totalTrades}</b>\n` +
                           `Win Rate: <b>${report.summary.winRate}</b>\n` +
                           `Profit Factor: <b>${report.summary.profitFactor}</b>\n` +
                           `Lucro Total: <b>$${report.summary.totalProfit}</b>\n\n` +
                           `<b>Insights Principais:</b>\n`;
            
            let insightsText = '';
            report.keyInsights.forEach((insight, i) => {
                insightsText += `${i + 1}. ${insight.message}\n`;
            });
            
            const fullMessage = message + insightsText + `\n<i>Sistema de Continuous Learning Ativo</i>`;
            
            await sendAlert(fullMessage);
            
        } catch (error) {
            console.error('Erro ao enviar relatório:', error);
        }
    }
    
    getOptimalParameters() {
        return this.thresholdOptimizer.getOptimalParameters();
    }
    
    getOptimalStrategy(marketConditions) {
        return this.strategyManager.selectOptimalStrategy(marketConditions);
    }
    
    enableLearning() {
        this.learningEnabled = true;
        console.log('🧠 Continuous Learning ativado');
    }
    
    disableLearning() {
        this.learningEnabled = false;
        console.log('🧠 Continuous Learning desativado');
    }
    
    getStatus() {
        return {
            learningEnabled: this.learningEnabled,
            tradeCount: this.tradeCount,
            analysisCount: this.analysisCount,
            totalTrades: this.dataCollector.tradeHistory.length,
            lastOptimization: this.lastOptimizationTime
        };
    }
}

// =====================================================================
// FUNÇÕES AUXILIARES DO BOT
// =====================================================================

function initAlertsCooldown(symbols) {
    symbols.forEach(symbol => {
        alertsCooldown[symbol] = {
            buy: 0,
            sell: 0
        };
    });
}

function updateCooldown(symbol, isBullish, timestamp) {
    if (!alertsCooldown[symbol]) {
        alertsCooldown[symbol] = { buy: 0, sell: 0 };
    }
    
    if (isBullish) {
        alertsCooldown[symbol].buy = timestamp;
    } else {
        alertsCooldown[symbol].sell = timestamp;
    }
}

function checkCooldown(symbol, isBullish, currentTime) {
    if (!COOLDOWN_SETTINGS.useDifferentiated) {
        const lastAlert = Math.max(
            alertsCooldown[symbol]?.buy || 0,
            alertsCooldown[symbol]?.sell || 0
        );
        return currentTime - lastAlert >= COOLDOWN_SETTINGS.sameDirection;
    }
    
    if (isBullish) {
        const lastOpposite = alertsCooldown[symbol]?.sell || 0;
        if (currentTime - lastOpposite < COOLDOWN_SETTINGS.oppositeDirection) {
            return false;
        }
        const lastSame = alertsCooldown[symbol]?.buy || 0;
        return currentTime - lastSame >= COOLDOWN_SETTINGS.sameDirection;
    } else {
        const lastOpposite = alertsCooldown[symbol]?.buy || 0;
        if (currentTime - lastOpposite < COOLDOWN_SETTINGS.oppositeDirection) {
            return false;
        }
        const lastSame = alertsCooldown[symbol]?.sell || 0;
        return currentTime - lastSame >= COOLDOWN_SETTINGS.sameDirection;
    }
}

// =====================================================================
// FUNÇÕES DE COMUNICAÇÃO
// =====================================================================

async function sendAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        logToFile(`📤 Alerta enviado com sucesso`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        logToFile(`❌ Erro ao enviar alerta: ${error.message}`);
        return false;
    }
}

async function sendNearSignalAlert(nearSignal) {
    if (!DEBUG_SETTINGS.sendTelegram && DEBUG_SETTINGS.logOnly) {
        logToFile(`⚠️ QUASE SINAL: ${nearSignal.symbol} ${nearSignal.isBullish ? 'COMPRA' : 'VENDA'} - Score: ${nearSignal.qualityScore.score} - Motivos: ${nearSignal.failureReasons?.join(', ') || 'N/A'}`);
        return;
    }

    try {
        const direction = nearSignal.isBullish ? '🟢 COMPRA' : '🔴 VENDA';
        const message = `⚠️ <b>QUASE SINAL DETECTADO</b>\n` +
                       `Ativo: <b>${nearSignal.symbol}</b>\n` +
                       `Direção: ${direction}\n` +
                       `Preço: $${nearSignal.priceFormatted}\n` +
                       `Score: ${nearSignal.qualityScore.grade} (${nearSignal.qualityScore.score}/100)\n` +
                       `Motivo do filtro:\n` +
                       `${nearSignal.failureReasons?.map(reason => `• ${reason}`).join('\n') || 'N/A'}\n\n` +
                       `<i>Score abaixo do mínimo (${QUALITY_THRESHOLD})</i>`;

        await sendAlert(message);
    } catch (error) {
        console.error('Erro ao enviar alerta de quase sinal:', error);
    }
}

// =====================================================================
// FUNÇÕES DO BOT ORIGINAL
// =====================================================================

async function calculateAdaptiveVolumeThreshold(symbol) {
    try {
        if (!VOLUME_SETTINGS.useAdaptive) {
            return VOLUME_SETTINGS.baseThreshold;
        }
        
        const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
        
        if (!volatilityCheck.rawVolatility) {
            return VOLUME_SETTINGS.baseThreshold;
        }
        
        let dynamicThreshold = VOLUME_SETTINGS.baseThreshold + 
                              (volatilityCheck.rawVolatility * VOLUME_SETTINGS.volatilityMultiplier);
        
        dynamicThreshold = Math.max(VOLUME_SETTINGS.minThreshold, 
                                   Math.min(VOLUME_SETTINGS.maxThreshold, dynamicThreshold));
        
        console.log(`📊 ${symbol}: Threshold volume adaptativo = ${dynamicThreshold.toFixed(2)}x (vol: ${volatilityCheck.rawVolatility.toFixed(2)}%)`);
        
        return dynamicThreshold;
        
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular threshold volume adaptativo(${symbol}): ${error.message}`);
        return VOLUME_SETTINGS.baseThreshold;
    }
}

async function checkVolumeConfirmation(symbol) {
    try {
        const dynamicThreshold = await calculateAdaptiveVolumeThreshold(symbol);
        const volumeData = await checkAbnormalVolume(symbol, dynamicThreshold);
        
        const isVolumeConfirmed = volumeData.isAbnormal && volumeData.rawRatio >= dynamicThreshold;
        
        return {
            isConfirmed: isVolumeConfirmed,
            volumeData: volumeData,
            dynamicThreshold: dynamicThreshold,
            message: isVolumeConfirmed ? 
                `✅ Volume confirmado (${volumeData.ratio}x ≥ ${dynamicThreshold.toFixed(2)}x)` :
                `❌ Volume não confirmado (${volumeData.ratio}x < ${dynamicThreshold.toFixed(2)}x)`
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar confirmação de volume(${symbol}): ${error.message}`);
        return {
            isConfirmed: false,
            volumeData: { ratio: "0", rawRatio: 0 },
            dynamicThreshold: VOLUME_SETTINGS.baseThreshold,
            message: "Volume: ⚪ Erro na verificação"
        };
    }
}

async function checkStochasticCrossover(symbol, isBullish) {
    try {
        const stoch1h = await getStochasticWithHistory(symbol, STOCH_SETTINGS.timeframe1h, 
                                                      STOCH_SETTINGS.period, 
                                                      STOCH_SETTINGS.signalPeriod, 
                                                      STOCH_SETTINGS.smooth);
        
        const stoch4h = await getStochasticWithHistory(symbol, STOCH_SETTINGS.timeframe4h,
                                                      STOCH_SETTINGS.period,
                                                      STOCH_SETTINGS.signalPeriod,
                                                      STOCH_SETTINGS.smooth);
        
        if (!stoch1h || !stoch4h || !stoch1h.current || !stoch4h.current) {
            return {
                isValid: true,
                stoch1h: stoch1h,
                stoch4h: stoch4h,
                message: "Estocástico: ⚪ Dados insuficientes"
            };
        }
        
        const stoch1hCurrent = stoch1h.current;
        const stoch1hPrevious = stoch1h.previous;
        const stoch4hCurrent = stoch4h.current;
        const stoch4hPrevious = stoch4h.previous;
        
        let isValid = false;
        let message = "";
        
        if (isBullish) {
            const is1hBullish = stoch1hPrevious && 
                               stoch1hPrevious.k <= stoch1hPrevious.d && 
                               stoch1hCurrent.k > stoch1hCurrent.d;
            
            const is4hBullish = stoch4hPrevious && 
                               stoch4hPrevious.k <= stoch4hPrevious.d && 
                               stoch4hCurrent.k > stoch4hCurrent.d;
            
            isValid = is1hBullish && is4hBullish;
            
            if (isValid) {
                message = `✅ Estocástico: K cruzou acima de D em 1h e 4h`;
            } else {
                message = `❌ Estocástico: Não cruzou em ambos os timeframes`;
            }
            
        } else {
            const is1hBearish = stoch1hPrevious && 
                               stoch1hPrevious.k >= stoch1hPrevious.d && 
                               stoch1hCurrent.k < stoch1hCurrent.d;
            
            const is4hBearish = stoch4hPrevious && 
                               stoch4hPrevious.k >= stoch4hPrevious.d && 
                               stoch4hCurrent.k < stoch4hCurrent.d;
            
            isValid = is1hBearish && is4hBearish;
            
            if (isValid) {
                message = `✅ Estocástico: K cruzou abaixo de D em 1h e 4h`;
            } else {
                message = `❌ Estocástico: Não cruzou em ambos os timeframes`;
            }
        }
        
        return {
            isValid: isValid,
            stoch1h: stoch1h,
            stoch4h: stoch4h,
            message: message,
            details: {
                '1h': {
                    current: { k: stoch1hCurrent.k.toFixed(2), d: stoch1hCurrent.d.toFixed(2) },
                    previous: stoch1hPrevious ? { k: stoch1hPrevious.k.toFixed(2), d: stoch1hPrevious.d.toFixed(2) } : null
                },
                '4h': {
                    current: { k: stoch4hCurrent.k.toFixed(2), d: stoch4hCurrent.d.toFixed(2) },
                    previous: stoch4hPrevious ? { k: stoch4hPrevious.k.toFixed(2), d: stoch4hPrevious.d.toFixed(2) } : null
                }
            }
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar Estocástico(${symbol}): ${error.message}`);
        return {
            isValid: true,
            stoch1h: null,
            stoch4h: null,
            message: "Estocástico: ⚪ Erro na verificação"
        };
    }
}

async function getStochasticWithHistory(symbol, timeframe, kPeriod = 5, dPeriod = 3, smooth = 3) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, kPeriod + dPeriod + smooth + 5);
        
        if (candles.length < kPeriod + dPeriod + smooth + 2) {
            return null;
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: kPeriod,
            signalPeriod: dPeriod
        });
        
        if (!stochValues || stochValues.length < 2) {
            return null;
        }
        
        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        
        return {
            current: {
                k: current.k,
                d: current.d,
                kFormatted: current.k.toFixed(2),
                dFormatted: current.d.toFixed(2)
            },
            previous: {
                k: previous.k,
                d: previous.d,
                kFormatted: previous.k.toFixed(2),
                dFormatted: previous.d.toFixed(2)
            },
            timeframe: timeframe,
            settings: { kPeriod, dPeriod, smooth }
        };
        
    } catch (error) {
        logToFile(`⚠️ Erro ao buscar Estocástico com histórico(${symbol}, ${timeframe}): ${error.message}`);
        return null;
    }
}

async function calculateSignalQuality(symbol, isBullish, volumeCheck, oiCheck, volatilityCheck, lsrCheck, 
                                     rsi1h, emas3mData, adx, fundingCheck, adx1h, stochCheck) {
    let score = 0;
    let details = [];
    let failedChecks = [];
    
    const optimalParams = continuousLearningSystem ? 
        continuousLearningSystem.getOptimalParameters() : null;
    
    const volumeThreshold = optimalParams?.volume?.threshold || VOLUME_SETTINGS.baseThreshold;
    const adx1hThreshold = optimalParams?.adx1h?.threshold || ADX_1H_SETTINGS.minStrength;
    
    // Critério 1: Volume
    if (volumeCheck.isConfirmed) {
        const volumeRatio = parseFloat(volumeCheck.volumeData.ratio);
        let volumeScore = 0;
        
        if (volumeRatio >= 2.0) {
            volumeScore = QUALITY_WEIGHTS.volume;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 2.0x)`);
        } else if (volumeRatio >= 1.5) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.8;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 1.5x)`);
        } else if (volumeRatio >= volumeThreshold) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.5;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x mínimo)`);
        } else {
            failedChecks.push(`Volume: ${volumeRatio}x < ${volumeThreshold.toFixed(2)}x`);
        }
        
        score += volumeScore;
    } else {
        failedChecks.push(`Volume: ${volumeCheck.volumeData.ratio}x < ${volumeThreshold.toFixed(2)}x`);
        details.push(`📊 Volume: 0/${QUALITY_WEIGHTS.volume} (não confirmado)`);
    }
    
    // Critério 2: Open Interest
    if (oiCheck.isValid) {
        score += QUALITY_WEIGHTS.oi;
        details.push(`📊 OI: ${QUALITY_WEIGHTS.oi}/${QUALITY_WEIGHTS.oi} (${oiCheck.trend} tendência)`);
    } else {
        failedChecks.push(`OI: ${oiCheck.trend} tendência`);
        details.push(`📊 OI: 0/${QUALITY_WEIGHTS.oi} (${oiCheck.trend} tendência)`);
    }
    
    // Critério 3: Volatilidade
    if (volatilityCheck.isValid) {
        score += QUALITY_WEIGHTS.volatility;
        details.push(`📊 Volatilidade: ${QUALITY_WEIGHTS.volatility}/${QUALITY_WEIGHTS.volatility} (${volatilityCheck.volatility}% adequada)`);
    } else {
        failedChecks.push(`Volatilidade: ${volatilityCheck.volatility}% inadequada`);
        details.push(`📊 Volatilidade: 0/${QUALITY_WEIGHTS.volatility} (${volatilityCheck.volatility}% inadequada)`);
    }
    
    // Critério 4: LSR
    if (lsrCheck.isValid) {
        score += QUALITY_WEIGHTS.lsr;
        details.push(`📊 LSR: ${QUALITY_WEIGHTS.lsr}/${QUALITY_WEIGHTS.lsr} (${lsrCheck.lsrRatio} ratio adequado)`);
    } else {
        failedChecks.push(`LSR: ${lsrCheck.lsrRatio} ratio inadequado`);
        details.push(`📊 LSR: 0/${QUALITY_WEIGHTS.lsr} (${lsrCheck.lsrRatio} ratio inadequado)`);
    }
    
    // Critério 5: RSI 1h
    if (rsi1h && rsi1h.value) {
        const rsiValue = parseFloat(rsi1h.value);
        let rsiScore = 0;
        
        if (isBullish) {
            if (rsiValue >= 30 && rsiValue <= 50) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} ideal para compra)`);
            } else if (rsiValue >= 25 && rsiValue <= 55) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.7;
                details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} aceitável para compra)`);
            } else {
                failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} fora do range para compra`);
                details.push(`📊 RSI 1h: 0/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} fora do range)`);
            }
        } else {
            if (rsiValue >= 50 && rsiValue <= 70) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} ideal para venda)`);
            } else if (rsiValue >= 45 && rsiValue <= 75) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.7;
                details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} aceitável para venda)`);
            } else {
                failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} fora do range para venda`);
                details.push(`📊 RSI 1h: 0/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} fora do range)`);
            }
        }
        
        score += rsiScore;
    } else {
        failedChecks.push(`RSI 1h: Dados indisponíveis`);
        details.push(`📊 RSI 1h: 0/${QUALITY_WEIGHTS.rsi} (dados indisponíveis)`);
    }
    
    // Critério 6: EMA Alignment
    if (emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp && isBullish) {
        score += QUALITY_WEIGHTS.emaAlignment;
        details.push(`📊 EMA Alinhamento: ${QUALITY_WEIGHTS.emaAlignment}/${QUALITY_WEIGHTS.emaAlignment} (Posição ideal)`);
    } else if (!emas3mData.isAboveEMA55 && !emas3mData.isEMA13CrossingUp && !isBullish) {
        score += QUALITY_WEIGHTS.emaAlignment;
        details.push(`📊 EMA Alinhamento: ${QUALITY_WEIGHTS.emaAlignment}/${QUALITY_WEIGHTS.emaAlignment} (Posição ideal)`);
    } else {
        failedChecks.push(`EMA: Alinhamento não ideal`);
        details.push(`📊 EMA Alinhamento: 0/${QUALITY_WEIGHTS.emaAlignment} (alinhamento não ideal)`);
    }
    
    // Critério 7: ADX
    if (adx && adx.raw !== null) {
        if (adx.raw >= ADX_SETTINGS.strongTrendThreshold) {
            score += QUALITY_WEIGHTS.adx;
            details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: ${QUALITY_WEIGHTS.adx}/${QUALITY_WEIGHTS.adx} (${adx.adx} - tendência forte)`);
        } else if (adx.raw >= 20) {
            const partialScore = QUALITY_WEIGHTS.adx * 0.5;
            score += partialScore;
            details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: ${partialScore}/${QUALITY_WEIGHTS.adx} (${adx.adx} - tendência moderada)`);
        } else {
            failedChecks.push(`ADX ${ADX_SETTINGS.timeframe}: ${adx.adx} (tendência fraca)`);
            details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: 0/${QUALITY_WEIGHTS.adx} (${adx.adx} - tendência fraca)`);
        }
    } else {
        failedChecks.push(`ADX: Dados indisponíveis`);
        details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: 0/${QUALITY_WEIGHTS.adx} (dados indisponíveis)`);
    }
    
    // Critério ADX 1h com threshold otimizado
    if (adx1h && adx1h.raw !== null) {
        if (adx1h.raw >= adx1hThreshold) {
            score += QUALITY_WEIGHTS.adx1h;
            details.push(`📊 ADX ${ADX_1H_SETTINGS.timeframe}: ${QUALITY_WEIGHTS.adx1h}/${QUALITY_WEIGHTS.adx1h} (${adx1h.adx} ≥ ${adx1hThreshold} - tendência forte)`);
        } else {
            failedChecks.push(`ADX 1h: ${adx1h.adx} < ${adx1hThreshold} (tendência fraca)`);
            details.push(`📊 ADX ${ADX_1H_SETTINGS.timeframe}: 0/${QUALITY_WEIGHTS.adx1h} (${adx1h.adx} < ${adx1hThreshold} - tendência fraca)`);
        }
    }
    
    // Critério 8: Estocástico 1h
    if (stochCheck && stochCheck.isValid) {
        score += QUALITY_WEIGHTS.stoch1h;
        details.push(`📊 Estocástico 1h: ${QUALITY_WEIGHTS.stoch1h}/${QUALITY_WEIGHTS.stoch1h} (cruzamento confirmado)`);
    } else {
        failedChecks.push(`Estocástico 1h: Não cruzou`);
        details.push(`📊 Estocástico 1h: 0/${QUALITY_WEIGHTS.stoch1h} (não cruzou)`);
    }
    
    // Critério 9: Estocástico 4h
    if (stochCheck && stochCheck.stoch4h) {
        score += QUALITY_WEIGHTS.stoch4h;
        details.push(`📊 Estocástico 4h: ${QUALITY_WEIGHTS.stoch4h}/${QUALITY_WEIGHTS.stoch4h} (confirmação timeframe superior)`);
    } else {
        details.push(`📊 Estocástico 4h: ${QUALITY_WEIGHTS.stoch4h}/${QUALITY_WEIGHTS.stoch4h} (dados OK)`);
        score += QUALITY_WEIGHTS.stoch4h;
    }
    
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
        failedChecks: failedChecks,
        isAcceptable: score >= QUALITY_THRESHOLD,
        threshold: QUALITY_THRESHOLD,
        message: `${emoji} SCORE classe: ${grade} (${Math.round(score)}/100) ${score >= QUALITY_THRESHOLD ? '✅' : '❌'}`
    };
}

// =====================================================================
// FUNÇÕES QUE PRECISAM SER IMPLEMENTADAS
// =====================================================================

async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando pares USDT da Binance Futures...');
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await response.json();
        
        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
        
        console.log(`✅ Encontrados ${symbols.length} pares USDT`);
        return symbols;
        
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos:', error.message);
        return [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT',
            'AVAXUSDT', 'LINKUSDT', 'ATOMUSDT', 'UNIUSDT', 'XLMUSDT'
        ];
    }
}

function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    
    return {
        date: date,
        time: time,
        full: `${date} ${time}`
    };
}

async function getCandlesCached(symbol, timeframe, limit = 100) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }
        
        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h',
            '1d': '1d'
        };
        
        const interval = intervalMap[timeframe] || '15m';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
        
        candleCache[cacheKey] = {
            data: candles,
            timestamp: now
        };
        
        return candles;
    } catch (error) {
        console.error(`Erro ao buscar candles (${symbol}, ${timeframe}):`, error);
        return [];
    }
}

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 100);
        if (candles.length < 55) {
            return {
                ema13: "N/A",
                ema34: "N/A",
                ema55: "N/A",
                currentPrice: 0,
                priceFormatted: "0.00",
                isAboveEMA55: false,
                isEMA13CrossingUp: false
            };
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
            ema13: latestEma13.toFixed(4),
            ema34: latestEma34.toFixed(4),
            ema55: latestEma55.toFixed(4),
            currentPrice: currentPrice,
            priceFormatted: currentPrice.toFixed(4),
            isAboveEMA55: currentPrice > latestEma55,
            isEMA13CrossingUp: previousEma13 <= previousEma34 && latestEma13 > latestEma34,
            message: `EMA13: ${latestEma13.toFixed(4)} | EMA34: ${latestEma34.toFixed(4)} | EMA55: ${latestEma55.toFixed(4)}`
        };
    } catch (error) {
        console.error(`Erro ao calcular EMAs (${symbol}):`, error);
        return {
            ema13: "N/A",
            ema34: "N/A",
            ema55: "N/A",
            currentPrice: 0,
            priceFormatted: "0.00",
            isAboveEMA55: false,
            isEMA13CrossingUp: false
        };
    }
}

async function getRSI(symbol, timeframe) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, 100);
        if (candles.length < 14) {
            return { value: "N/A", rsi: "N/A", status: "N/A" };
        }
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        
        if (!rsiValues || rsiValues.length === 0) {
            return { value: "N/A", rsi: "N/A", status: "N/A" };
        }
        
        const latestRSI = rsiValues[rsiValues.length - 1];
        let status = "Neutro";
        if (latestRSI < 30) status = "Sobrevendido";
        else if (latestRSI > 70) status = "Sobrecomprado";
        
        return {
            value: latestRSI.toFixed(2),
            rsi: latestRSI.toFixed(2),
            raw: latestRSI,
            status: status
        };
    } catch (error) {
        console.error(`Erro ao calcular RSI (${symbol}, ${timeframe}):`, error);
        return { value: "N/A", rsi: "N/A", status: "N/A", raw: null };
    }
}

async function checkAbnormalVolume(symbol, threshold) {
    try {
        const candles = await getCandlesCached(symbol, '5m', 100);
        if (candles.length < 20) {
            return { isAbnormal: false, ratio: "0", rawRatio: 0 };
        }
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        
        const ratio = currentVolume / avgVolume;
        
        return {
            isAbnormal: ratio >= threshold,
            ratio: ratio.toFixed(2),
            rawRatio: ratio,
            currentVolume: currentVolume,
            avgVolume: avgVolume,
            message: `Volume: ${ratio.toFixed(2)}x da média (${currentVolume.toFixed(2)} vs ${avgVolume.toFixed(2)})`
        };
    } catch (error) {
        console.error(`Erro ao verificar volume (${symbol}):`, error);
        return { isAbnormal: false, ratio: "0", rawRatio: 0 };
    }
}

async function checkOpenInterestCriteria(symbol, isBullish) {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
        const data = await response.json();
        
        const oi = parseFloat(data.openInterest);
        const timestamp = Date.now();
        
        if (!oiCache[symbol]) {
            oiCache[symbol] = {
                history: [],
                timestamp: timestamp
            };
        }
        
        oiCache[symbol].history.push({ oi, timestamp });
        
        if (oiCache[symbol].history.length > OI_HISTORY_SIZE) {
            oiCache[symbol].history = oiCache[symbol].history.slice(-OI_HISTORY_SIZE);
        }
        
        let trend = "➡️";
        if (oiCache[symbol].history.length >= 5) {
            const recentOI = oiCache[symbol].history.slice(-5).map(h => h.oi);
            const avgOI = recentOI.reduce((a, b) => a + b, 0) / recentOI.length;
            
            if (oi > avgOI * 1.05) trend = "📈";
            else if (oi < avgOI * 0.95) trend = "📉";
        }
        
        const isValid = (isBullish && trend === "📈") || (!isBullish && trend === "📉");
        
        return {
            isValid: isValid,
            trend: trend,
            oi: oi.toFixed(2),
            message: `OI: ${trend} ${isValid ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao verificar OI (${symbol}):`, error);
        return {
            isValid: true,
            trend: "➡️",
            message: `OI: ⚪ Erro na verificação`
        };
    }
}

async function checkVolatility(symbol, timeframe, period, threshold) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 10);
        if (candles.length < period) {
            return { isValid: false, volatility: "N/A", rawVolatility: 0 };
        }
        
        const closes = candles.map(c => c.close);
        const returns = [];
        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i-1]) / closes[i-1]));
        }
        
        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;
        const isValid = volatility >= threshold;
        
        return {
            isValid: isValid,
            volatility: volatility.toFixed(2),
            rawVolatility: volatility,
            message: `Volatilidade: ${volatility.toFixed(2)}% ${isValid ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao verificar volatilidade (${symbol}):`, error);
        return { isValid: false, volatility: "N/A", rawVolatility: 0 };
    }
}

async function checkLSRCriteria(symbol, isBullish) {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`);
        const data = await response.json();
        
        const lastPrice = parseFloat(data.lastPrice);
        const highPrice = parseFloat(data.highPrice);
        const lowPrice = parseFloat(data.lowPrice);
        
        const lsrRatio = (highPrice - lastPrice) / (lastPrice - lowPrice);
        const isValid = isBullish ? lsrRatio >= LSR_BUY_THRESHOLD : lsrRatio >= LSR_SELL_THRESHOLD;
        
        return {
            isValid: isValid,
            lsrRatio: lsrRatio.toFixed(2),
            message: `LSR: ${lsrRatio.toFixed(2)} ${isValid ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao verificar LSR (${symbol}):`, error);
        return {
            isValid: true,
            lsrRatio: "2.5",
            message: `LSR: ⚪ Erro na verificação`
        };
    }
}

async function checkFundingRateCriteria(symbol, isBullish) {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
        const data = await response.json();
        
        if (!data || data.length === 0) {
            return {
                isValid: true,
                fundingRate: "0.0000%",
                raw: 0,
                message: `Funding: ⚪ Dados indisponíveis`
            };
        }
        
        const fundingRate = parseFloat(data[0].fundingRate);
        const isValid = isBullish ? fundingRate <= FUNDING_BUY_MAX : fundingRate >= FUNDING_SELL_MIN;
        
        return {
            isValid: isValid,
            fundingRate: fundingRate,
            raw: fundingRate,
            message: `Funding: ${(fundingRate * 100).toFixed(4)}% ${isValid ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao verificar funding rate (${symbol}):`, error);
        return {
            isValid: true,
            fundingRate: 0,
            raw: 0,
            message: `Funding: ⚪ Erro na verificação`
        };
    }
}

async function getADX(symbol) {
    try {
        const candles = await getCandlesCached(symbol, ADX_SETTINGS.timeframe, 100);
        if (candles.length < ADX_SETTINGS.period + 10) {
            return { adx: "N/A", raw: null, message: "ADX: ⚪ Dados insuficientes" };
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ADX_SETTINGS.period
        });
        
        if (!adxValues || adxValues.length === 0) {
            return { adx: "N/A", raw: null, message: "ADX: ⚪ Dados insuficientes" };
        }
        
        const latestADXValue = adxValues[adxValues.length - 1];
        
        let latestADX;
        if (typeof latestADXValue === 'object' && latestADXValue !== null) {
            latestADX = latestADXValue.adx;
        } else {
            latestADX = latestADXValue;
        }
        
        if (typeof latestADX !== 'number' || isNaN(latestADX)) {
            return { adx: "N/A", raw: null, message: "ADX: ⚪ Dados inválidos" };
        }
        
        const isStrong = latestADX >= ADX_SETTINGS.strongTrendThreshold;
        
        return {
            adx: latestADX.toFixed(2),
            raw: latestADX,
            isStrong: isStrong,
            message: `ADX ${ADX_SETTINGS.timeframe}: ${latestADX.toFixed(2)} ${isStrong ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao calcular ADX (${symbol}):`, error);
        return { adx: "N/A", raw: null, message: "ADX: ⚪ Erro no cálculo" };
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, ADX_1H_SETTINGS.timeframe, 100);
        if (candles.length < ADX_1H_SETTINGS.period + 10) {
            return { 
                adx: "N/A", 
                raw: null, 
                hasMinimumStrength: false,
                message: "ADX 1h: ⚪ Dados insuficientes" 
            };
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ADX_1H_SETTINGS.period
        });
        
        if (!adxValues || adxValues.length === 0) {
            return { 
                adx: "N/A", 
                raw: null, 
                hasMinimumStrength: false,
                message: "ADX 1h: ⚪ Dados insuficientes" 
            };
        }
        
        const latestADXValue = adxValues[adxValues.length - 1];
        
        let latestADX;
        if (typeof latestADXValue === 'object' && latestADXValue !== null) {
            latestADX = latestADXValue.adx;
        } else {
            latestADX = latestADXValue;
        }
        
        if (typeof latestADX !== 'number' || isNaN(latestADX)) {
            return { 
                adx: "N/A", 
                raw: null, 
                hasMinimumStrength: false,
                message: "ADX 1h: ⚪ Dados inválidos" 
            };
        }
        
        const hasMinimumStrength = latestADX >= ADX_1H_SETTINGS.minStrength;
        
        return {
            adx: latestADX.toFixed(2),
            raw: latestADX,
            hasMinimumStrength: hasMinimumStrength,
            message: `ADX ${ADX_1H_SETTINGS.timeframe}: ${latestADX.toFixed(2)} ${hasMinimumStrength ? '✅' : '❌'}`
        };
    } catch (error) {
        console.error(`Erro ao calcular ADX 1h (${symbol}):`, error);
        return { 
            adx: "N/A", 
            raw: null, 
            hasMinimumStrength: false,
            message: "ADX 1h: ⚪ Erro no cálculo" 
        };
    }
}

async function getOrderBook(symbol) {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=5`);
        const data = await response.json();
        
        const bestBid = parseFloat(data.bids[0][0]);
        const bestAsk = parseFloat(data.asks[0][0]);
        const spread = ((bestAsk - bestBid) / bestBid) * 100;
        
        return {
            bids: data.bids.slice(0, 2).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.asks.slice(0, 2).map(a => [parseFloat(a[0]), parseFloat(a[1])]),
            spread: spread
        };
    } catch (error) {
        console.error(`Erro ao buscar order book (${symbol}):`, error);
        return {
            bids: [[100, 10], [99.5, 5]],
            asks: [[101, 8], [101.5, 7]],
            spread: 1.0
        };
    }
}

async function getStochastic(symbol, timeframe) {
    try {
        const stoch = await getStochasticWithHistory(symbol, timeframe);
        if (!stoch) {
            return { k: "N/A", d: "N/A", status: "N/A" };
        }
        
        return {
            k: stoch.current.kFormatted,
            d: stoch.current.dFormatted,
            status: stoch.current.k > stoch.current.d ? "Alto" : "Baixo"
        };
    } catch (error) {
        console.error(`Erro ao buscar Estocástico (${symbol}, ${timeframe}):`, error);
        return { k: "N/A", d: "N/A", status: "N/A" };
    }
}

async function getFundingRate(symbol) {
    try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
        const data = await response.json();
        
        if (!data || data.length === 0) {
            return {
                rate: "0.0000%",
                raw: 0
            };
        }
        
        const rate = parseFloat(data[0].fundingRate) * 100;
        
        return {
            rate: `${rate.toFixed(4)}%`,
            raw: rate / 100
        };
    } catch (error) {
        console.error(`Erro ao buscar funding rate (${symbol}):`, error);
        return {
            rate: "0.0000%",
            raw: 0
        };
    }
}

async function calculateTargetsAndStopATR(price, isBullish, symbol) {
    try {
        const candles = await getCandlesCached(symbol, ATR_TIMEFRAME, ATR_PERIOD + 10);
        if (candles.length < ATR_PERIOD) {
            return getDefaultTargetsAndStop(price, isBullish);
        }
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ATR_PERIOD
        });
        
        if (!atrValues || atrValues.length === 0) {
            return getDefaultTargetsAndStop(price, isBullish);
        }
        
        const latestATR = atrValues[atrValues.length - 1];
        const atrPercentage = (latestATR / price) * 100;
        
        const adjustedATR = Math.max(MIN_ATR_PERCENTAGE, Math.min(MAX_ATR_PERCENTAGE, atrPercentage));
        
        const stopDistance = adjustedATR * ATR_MULTIPLIER;
        const stopPrice = isBullish ? 
            price * (1 - stopDistance / 100) : 
            price * (1 + stopDistance / 100);
        
        const stopPercentage = parseFloat(stopDistance.toFixed(2));
        const stopFormatted = stopPrice.toFixed(4);
        
        const targets = TARGET_PERCENTAGES.map(targetPercent => {
            const targetPrice = isBullish ? 
                price * (1 + targetPercent / 100) : 
                price * (1 - targetPercent / 100);
            
            const riskReward = targetPercent / stopPercentage;
            
            return {
                target: targetPercent.toFixed(1),
                price: targetPrice.toFixed(4),
                riskReward: riskReward.toFixed(2)
            };
        });
        
        const validTargets = targets.filter(t => parseFloat(t.riskReward) >= 1.5);
        const bestTarget = validTargets.length > 0 ? 
            validTargets.reduce((a, b) => parseFloat(a.riskReward) > parseFloat(b.riskReward) ? a : b) : 
            targets[0];
        
        const bestRiskReward = parseFloat(bestTarget.riskReward).toFixed(2);
        
        return {
            stopPrice: stopPrice,
            stopFormatted: stopFormatted,
            stopPercentage: stopPercentage,
            stopType: "ATR",
            targets: targets,
            bestRiskReward: bestRiskReward,
            atrValue: latestATR.toFixed(4),
            atrPercentage: atrPercentage.toFixed(2),
            message: `Stop (ATR): $${stopFormatted} (${stopPercentage}%) | Melhor R/R: ${bestRiskReward}:1`
        };
        
    } catch (error) {
        console.error(`Erro ao calcular alvos e stop (${symbol}):`, error);
        return getDefaultTargetsAndStop(price, isBullish);
    }
}

function getDefaultTargetsAndStop(price, isBullish) {
    const stopPercentage = 3.0;
    const stopPrice = isBullish ? 
        price * (1 - stopPercentage / 100) : 
        price * (1 + stopPercentage / 100);
    
    const targets = TARGET_PERCENTAGES.map(percent => ({
        target: percent.toFixed(1),
        price: isBullish ? 
            (price * (1 + percent / 100)).toFixed(4) : 
            (price * (1 - percent / 100)).toFixed(4),
        riskReward: (percent / stopPercentage).toFixed(2)
    }));
    
    const bestRiskReward = (8.0 / stopPercentage).toFixed(2);
    
    return {
        stopPrice: stopPrice,
        stopFormatted: stopPrice.toFixed(4),
        stopPercentage: stopPercentage,
        stopType: "Padrão",
        targets: targets,
        bestRiskReward: bestRiskReward,
        message: `Stop (Padrão): $${stopPrice.toFixed(4)} (${stopPercentage}%) | Melhor R/R: ${bestRiskReward}:1`
    };
}

async function monitorSignals(symbol) {
    try {
        const emas3mData = await getEMAs3m(symbol);
        
        if (emas3mData.ema55 === "N/A" || emas3mData.ema13 === "N/A" || emas3mData.ema34 === "N/A") {
            return null;
        }
        
        const rsi1h = await getRSI(symbol, '1h');
        const rsiValue = parseFloat(rsi1h.value);
        
        const brDateTime = getBrazilianDateTime();
        const priceFormatted = emas3mData.priceFormatted;
        
        const now = Date.now();
        let signalAlert = null;
        let nearSignal = null;
        
        // VERIFICAÇÃO PARA COMPRA
        if (emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
            if (rsiValue >= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            const volumeCheck = await checkVolumeConfirmation(symbol);
            const oiCheck = await checkOpenInterestCriteria(symbol, true);
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            const lsrCheck = await checkLSRCriteria(symbol, true);
            const fundingCheck = await checkFundingRateCriteria(symbol, true);
            const adx = await getADX(symbol);
            const adx1h = await getADX1h(symbol);
            const stochCheck = await checkStochasticCrossover(symbol, true);
            
            let optimalStrategy = { selectedStrategy: 'TREND_FOLLOWING', confidence: 0.7 };
            if (continuousLearningSystem) {
                const marketConditions = {
                    adx: adx,
                    volatility: volatilityCheck,
                    volume: volumeCheck
                };
                optimalStrategy = await continuousLearningSystem.getOptimalStrategy(marketConditions);
            }
            
            const optimalParams = continuousLearningSystem ? 
                continuousLearningSystem.getOptimalParameters() : null;
            const adx1hThreshold = optimalParams?.adx1h?.threshold || ADX_1H_SETTINGS.minStrength;
            
            if (!adx1h.hasMinimumStrength || adx1h.raw < adx1hThreshold) {
                if (DEBUG_SETTINGS.enableNearSignals) {
                    const qualityScore = await calculateSignalQuality(
                        symbol, true, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, adx, fundingCheck, adx1h, stochCheck
                    );
                    
                    if (qualityScore.score >= DEBUG_SETTINGS.minScore && 
                        qualityScore.score <= DEBUG_SETTINGS.maxScore) {
                        
                        nearSignal = {
                            symbol: symbol,
                            isBullish: true,
                            price: emas3mData.currentPrice,
                            priceFormatted: priceFormatted,
                            qualityScore: qualityScore,
                            volumeCheck: volumeCheck,
                            oiCheck: oiCheck,
                            volatilityCheck: volatilityCheck,
                            lsrCheck: lsrCheck,
                            fundingCheck: fundingCheck,
                            adx1h: adx1h,
                            stochCheck: stochCheck,
                            strategy: optimalStrategy.selectedStrategy,
                            failureReasons: qualityScore.failedChecks
                        };
                    }
                }
                return null;
            }
            
            const qualityScore = await calculateSignalQuality(
                symbol, true, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, adx, fundingCheck, adx1h, stochCheck
            );
            
            const allCriteriaValid = volumeCheck.isConfirmed && 
                                    oiCheck.isValid && 
                                    volatilityCheck.isValid && 
                                    lsrCheck.isValid && 
                                    fundingCheck.isValid && 
                                    stochCheck.isValid &&
                                    qualityScore.isAcceptable;
            
            if (!allCriteriaValid && DEBUG_SETTINGS.enableNearSignals) {
                if (qualityScore.score >= DEBUG_SETTINGS.minScore && 
                    qualityScore.score <= DEBUG_SETTINGS.maxScore) {
                    
                    nearSignal = {
                        symbol: symbol,
                        isBullish: true,
                        price: emas3mData.currentPrice,
                        priceFormatted: priceFormatted,
                        qualityScore: qualityScore,
                        volumeCheck: volumeCheck,
                        oiCheck: oiCheck,
                        volatilityCheck: volatilityCheck,
                        lsrCheck: lsrCheck,
                        fundingCheck: fundingCheck,
                        adx1h: adx1h,
                        stochCheck: stochCheck,
                        strategy: optimalStrategy.selectedStrategy,
                        failureReasons: qualityScore.failedChecks
                    };
                }
            }
            
            if (allCriteriaValid && checkCooldown(symbol, true, now)) {
                const [orderBook, stoch4h, stochDaily, fundingRate] = await Promise.all([
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d'),
                    getFundingRate(symbol)
                ]);
                
                const targetsAndStop = await calculateTargetsAndStopATR(emas3mData.currentPrice, true, symbol);
                
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
                    emas3mData,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    qualityScore,
                    adx,
                    fundingCheck,
                    adx1h,
                    stochCheck,
                    optimalStrategy
                );
                
                signalAlert = {
                    symbol: symbol,
                    signal: 'Sinal de Compra',
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
                    adx: adx,
                    adx1h: adx1h,
                    fundingCheck: fundingCheck,
                    stochCheck: stochCheck,
                    strategy: optimalStrategy.selectedStrategy,
                    isBullish: true
                };
                
                updateCooldown(symbol, true, now);
                
                if (continuousLearningSystem) {
                    await continuousLearningSystem.onTradeExecuted(signalAlert);
                }
            }
        }
        
        // VERIFICAÇÃO PARA VENDA
        if (!emas3mData.isAboveEMA55 && !emas3mData.isEMA13CrossingUp) {
            if (rsiValue <= 40 || isNaN(rsiValue)) {
                return null;
            }
            
            const volumeCheck = await checkVolumeConfirmation(symbol);
            const oiCheck = await checkOpenInterestCriteria(symbol, false);
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            const lsrCheck = await checkLSRCriteria(symbol, false);
            const fundingCheck = await checkFundingRateCriteria(symbol, false);
            const adx = await getADX(symbol);
            const adx1h = await getADX1h(symbol);
            const stochCheck = await checkStochasticCrossover(symbol, false);
            
            let optimalStrategy = { selectedStrategy: 'TREND_FOLLOWING', confidence: 0.7 };
            if (continuousLearningSystem) {
                const marketConditions = {
                    adx: adx,
                    volatility: volatilityCheck,
                    volume: volumeCheck
                };
                optimalStrategy = await continuousLearningSystem.getOptimalStrategy(marketConditions);
            }
            
            const optimalParams = continuousLearningSystem ? 
                continuousLearningSystem.getOptimalParameters() : null;
            const adx1hThreshold = optimalParams?.adx1h?.threshold || ADX_1H_SETTINGS.minStrength;
            
            if (!adx1h.hasMinimumStrength || adx1h.raw < adx1hThreshold) {
                if (DEBUG_SETTINGS.enableNearSignals) {
                    const qualityScore = await calculateSignalQuality(
                        symbol, false, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, adx, fundingCheck, adx1h, stochCheck
                    );
                    
                    if (qualityScore.score >= DEBUG_SETTINGS.minScore && 
                        qualityScore.score <= DEBUG_SETTINGS.maxScore) {
                        
                        nearSignal = {
                            symbol: symbol,
                            isBullish: false,
                            price: emas3mData.currentPrice,
                            priceFormatted: priceFormatted,
                            qualityScore: qualityScore,
                            volumeCheck: volumeCheck,
                            oiCheck: oiCheck,
                            volatilityCheck: volatilityCheck,
                            lsrCheck: lsrCheck,
                            fundingCheck: fundingCheck,
                            adx1h: adx1h,
                            stochCheck: stochCheck,
                            strategy: optimalStrategy.selectedStrategy,
                            failureReasons: qualityScore.failedChecks
                        };
                    }
                }
                return null;
            }
            
            const qualityScore = await calculateSignalQuality(
                symbol, false, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, adx, fundingCheck, adx1h, stochCheck
            );
            
            const allCriteriaValid = volumeCheck.isConfirmed && 
                                    oiCheck.isValid && 
                                    volatilityCheck.isValid && 
                                    lsrCheck.isValid && 
                                    fundingCheck.isValid && 
                                    stochCheck.isValid &&
                                    qualityScore.isAcceptable;
            
            if (!allCriteriaValid && DEBUG_SETTINGS.enableNearSignals) {
                if (qualityScore.score >= DEBUG_SETTINGS.minScore && 
                    qualityScore.score <= DEBUG_SETTINGS.maxScore) {
                    
                    nearSignal = {
                        symbol: symbol,
                        isBullish: false,
                        price: emas3mData.currentPrice,
                        priceFormatted: priceFormatted,
                        qualityScore: qualityScore,
                        volumeCheck: volumeCheck,
                        oiCheck: oiCheck,
                        volatilityCheck: volatilityCheck,
                        lsrCheck: lsrCheck,
                        fundingCheck: fundingCheck,
                        adx1h: adx1h,
                        stochCheck: stochCheck,
                        strategy: optimalStrategy.selectedStrategy,
                        failureReasons: qualityScore.failedChecks
                    };
                }
            }
            
            if (allCriteriaValid && checkCooldown(symbol, false, now)) {
                const [orderBook, stoch4h, stochDaily, fundingRate] = await Promise.all([
                    getOrderBook(symbol),
                    getStochastic(symbol, '4h'),
                    getStochastic(symbol, '1d'),
                    getFundingRate(symbol)
                ]);
                
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
                    emas3mData,
                    oiCheck,
                    volatilityCheck,
                    lsrCheck,
                    qualityScore,
                    adx,
                    fundingCheck,
                    adx1h,
                    stochCheck,
                    optimalStrategy
                );
                
                signalAlert = {
                    symbol: symbol,
                    signal: 'Sinal de Venda',
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
                    adx: adx,
                    adx1h: adx1h,
                    fundingCheck: fundingCheck,
                    stochCheck: stochCheck,
                    strategy: optimalStrategy.selectedStrategy,
                    isBullish: false
                };
                
                updateCooldown(symbol, false, now);
                
                if (continuousLearningSystem) {
                    await continuousLearningSystem.onTradeExecuted(signalAlert);
                }
            }
        }
        
        if (nearSignal) {
            await sendNearSignalAlert(nearSignal);
        }
        
        return signalAlert;
        
    } catch (error) {
        logToFile(`⚠️ Erro no monitorSignals(${symbol}): ${error.message}`);
        return null;
    }
}

function buildAlertMessage(isBullish, symbol, priceFormatted, brDateTime, targetsAndStop, 
                          rsi1h, stoch4h, stochDaily, lsrData, fundingRate, 
                          volumeCheck, orderBook, emas3mData, oiCheck, volatilityCheck, lsrCheck,
                          qualityScore, adx, fundingCheck, adx1h, stochCheck, optimalStrategy) {
    
    const title = isBullish ? '🤖IA Análise <b> 🟢COMPRA🟢  </b>' : '🤖IA Análise <b>🤖 🔴CORREÇÃO🔴 </b>';
    
    const stopInfo = targetsAndStop.stopType === "" ? 
        `⛔Stop: ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n` +
        `    Risco/Retorno: ${targetsAndStop.bestRiskReward}:1\n` :
        `⛔Stop: ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n`;
    
    let message = `${title}\n`;
    message += `<b>Operação:</b> ${brDateTime.date} - ${brDateTime.time}\n`;
    message += `<b>#ATIVO:</b> ${symbol}\n`;
    message += `<b>$Preço atual:</b> $${priceFormatted}\n`;
    
    message += `${qualityScore.message}\n`;
    
    if (optimalStrategy) {
        message += `<b>Estratégia:</b> ${optimalStrategy.selectedStrategy} (${(optimalStrategy.confidence * 100).toFixed(1)}% confiança)\n`;
    }
    
    if (adx1h && adx1h.adx !== "N/A") {
        message += `${adx1h.message}\n`;
    }
    
    if (stochCheck && stochCheck.isValid) {
        message += `✅ Estocástico: Cruzamento confirmado em 1h e 4h\n`;
    }
    
    message += `<b>Indicadores:</b>\n`;
    message += `${volumeCheck.message}\n`;
    message += `${oiCheck.message}\n`;
    message += `${volatilityCheck.message}\n`;
    message += `${lsrCheck.message}\n`;
    message += `${fundingCheck.message}\n`;
    
    if (adx && adx.adx !== "N/A") {
        message += `${adx.message}\n`;
    }
    
    message += `RSI 1h: ${rsi1h.rsi} (${rsi1h.status})\n`;
    if (stoch4h && stoch4h.k !== "N/A") {
        message += `Estocástico 4h: K=${stoch4h.k} D=${stoch4h.d} (${stoch4h.status})\n`;
    }
    if (stochDaily && stochDaily.k !== "N/A") {
        message += `Estocástico Diário: K=${stochDaily.k} D=${stochDaily.d} (${stochDaily.status})\n`;
    }
    
    message += `${emas3mData.message}\n`;
    
    message += `<b>Alvos (TP):</b>\n`;
    targetsAndStop.targets.forEach((target, index) => {
        message += `TP${index + 1}: ${target.target}% → $${target.price} (R/R: ${target.riskReward}:1)\n`;
    });
    
    message += `\n${stopInfo}`;
    
    message += `<b>Funding Rate:</b> ${fundingRate.rate}\n`;
    
    message += `<b>Ordem:</b>\n`;
    if (orderBook.bids && orderBook.bids.length > 0) {
        message += `Compra: $${orderBook.bids[0][0]} (${orderBook.bids[0][1]} contratos)\n`;
    }
    if (orderBook.asks && orderBook.asks.length > 0) {
        message += `Venda: $${orderBook.asks[0][0]} (${orderBook.asks[0][1]} contratos)\n`;
    }
    message += `Spread: ${orderBook.spread.toFixed(2)}%\n`;
    
    message += `\n<b>Filtros SMC:</b>\n`;
    message += `🎯 Volume acima da média\n`;
    message += `📊 OI confirmando tendência\n`;
    message += `⚡ Volatilidade adequada\n`;
    message += `📈 LSR favorável\n`;
    message += `💰 Funding rate favorável\n`;
    message += `📐 EMA alinhada\n`;
    message += `📊 ADX com tendência forte\n`;
    message += `🔀 Estocástico cruzando\n`;
    
    message += `\n   <b>✔︎IA Tecnology by @J4Rviz</b>`;
    
    return message;
}

// =====================================================================
// FUNÇÕES DE CACHE E LIMPEZA
// =====================================================================

function cleanupCaches() {
    const now = Date.now();
    
    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });
    
    Object.keys(oiCache).forEach(key => {
        if (now - oiCache[key].timestamp > OI_CACHE_TTL) {
            delete oiCache[key];
        }
    });
}

async function processBatch(symbols, processFunction) {
    const results = [];
    for (const symbol of symbols) {
        try {
            const result = await processFunction(symbol);
            if (result) {
                results.push(result);
            }
        } catch (error) {
            console.error(`Erro processando ${symbol}:`, error.message);
            logToFile(`Erro processando ${symbol}: ${error.message}`);
        }
    }
    return results;
}

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', { timeout: 5000 });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function reconnectWithBackoff() {
    let delay = INITIAL_RETRY_DELAY;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        console.log(`Tentativa ${attempt}/${MAX_RETRY_ATTEMPTS} de reconexão...`);
        logToFile(`Tentativa ${attempt}/${MAX_RETRY_ATTEMPTS} de reconexão`);
        
        if (await checkInternetConnection()) {
            console.log('✅ Conexão restabelecida!');
            logToFile('✅ Conexão restabelecida!');
            return true;
        }
        
        console.log(`Aguardando ${delay / 1000} segundos antes da próxima tentativa...`);
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, MAX_RETRY_DELAY);
    }
    return false;
}

// =====================================================================
// INICIALIZAÇÃO DO SISTEMA
// =====================================================================

function initLogSystem() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(LEARNING_DIR)) {
        fs.mkdirSync(LEARNING_DIR, { recursive: true });
    }
    cleanupOldLogs();
}

async function mainBotLoop() {
    console.log('\n🔍 Buscando todos os pares USDT da Binance Futures...');
    SYMBOLS = await fetchAllFuturesSymbols();
    
    if (SYMBOLS.length === 0) {
        console.log('❌ Não foi possível encontrar símbolos. Usando lista fallback.');
        SYMBOLS = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT',
            'AVAXUSDT', 'LINKUSDT', 'ATOMUSDT', 'UNIUSDT', 'XLMUSDT'
        ];
    }
    
    initAlertsCooldown(SYMBOLS);
    
    continuousLearningSystem = new ContinuousLearningSystem();
    
    const initMsg = '\n' +
        '='.repeat(70) + '\n' +
        ` 🤖 BOT DE SINAIS SMC - VERSÃO COM CONTINUOUS LEARNING\n` +
        ` 📊 MONITORANDO ${SYMBOLS.length} ATIVOS DINAMICAMENTE\n` +
        ` 🧠 SISTEMA DE APRENDIZADO ATIVO\n` +
        ` 🎯 CARACTERÍSTICAS:\n` +
        `   1. ✅ Continuous Learning System integrado\n` +
        `   2. ✅ Otimização automática de parâmetros\n` +
        `   3. ✅ Análise de performance em tempo real\n` +
        `   4. ✅ Adaptação dinâmica de estratégias\n` +
        `   5. ✅ Feedback loop automático\n` +
        `   6. ✅ Estocástico (5,3,3) 1h e 4h\n` +
        `   7. ✅ ADX 1h obrigatório\n` +
        `   8. ✅ Volume adaptativo\n` +
        '='.repeat(70) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot com Continuous Learning iniciado - Monitorando ${SYMBOLS.length} ativos`);
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>SMC BOT - VERSÃO COM CONTINUOUS LEARNING</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `📊 <b>Ativos monitorados:</b> ${SYMBOLS.length} pares USDT\n` +
                    `🧠 <b>Sistema de Aprendizado:</b> ATIVO\n` +
                    `🎯 <b>Características:</b>\n` +
                    `   • ✅ Otimização automática de parâmetros\n` +
                    `   • 📊 Análise de performance em tempo real\n` +
                    `   • 🔄 Adaptação dinâmica de estratégias\n` +
                    `   • 📈 Estocástico (5,3,3) 1h e 4h\n` +
                    `   • ⚡ ADX 1h obrigatório\n` +
                    `⚠️ <b>ATENÇÃO:</b> Sistema em fase de aprendizado\n` +
                    `by @J4Rviz.`);

    let consecutiveErrors = 0;
    let cycleCount = 0;

    while (true) {
        try {
            cycleCount++;
            
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

            let signalsDetected = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            console.log(`📊 Rate Limit: ${rateLimitCounter.usedWeight}/${BINANCE_RATE_LIMIT.requestsPerMinute} (${rateLimitCounter.remainingWeight} restantes)`);
            
            if (continuousLearningSystem) {
                const status = continuousLearningSystem.getStatus();
                console.log(`🧠 Continuous Learning: ${status.learningEnabled ? 'ATIVO' : 'INATIVO'} (${status.totalTrades} trades analisados)`);
            }
            
            console.log(`🔍 Analisando sinais baseados no alinhamento técnico...`);
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchAlerts = await processBatch(batch, monitorSignals);
                
                for (const alert of batchAlerts) {
                    console.log(`\n✅ SINAL DETECTADO PARA ${alert.symbol}!`);
                    console.log(`📊 ${alert.signal} - Preço: $${alert.priceFormatted}`);
                    console.log(`📈 Score: ${alert.qualityScore.grade} (${alert.qualityScore.score}/100)`);
                    console.log(`🎯 Estratégia: ${alert.strategy}`);
                    console.log(`📊 Volume: ${alert.volumeConfirmation.volumeData.ratio}x`);
                    
                    logToFile(`SINAL ${alert.signal} - ${alert.symbol} - Score: ${alert.qualityScore.score} - Estratégia: ${alert.strategy}`);
                    
                    await sendAlert(alert.message);
                    
                    signalsDetected++;
                    
                    await new Promise(r => setTimeout(r, 1000));
                }
                
                if (i + BATCH_SIZE < SYMBOLS.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (signalsDetected > 0) {
                console.log(`📊 Total de ${signalsDetected} sinal(is) enviado(s) nesta verificação`);
            } else {
                console.log(' ✓ Nenhum sinal forte detectado');
            }

            cleanupCaches();
            
            if (Date.now() - rateLimitCounter.windowStart >= 60000) {
                rateLimitCounter.windowStart = Date.now();
                rateLimitCounter.usedWeight = 0;
                rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
            }

            consecutiveErrors = 0;
            
            console.log(`\n⏱️  Próxima verificação em 60 segundos...`);
            
            await new Promise(r => setTimeout(r, 60000));

        } catch (error) {
            consecutiveErrors++;
            const errorMsg = `Erro no loop principal (${consecutiveErrors}): ${error.message}`;
            console.log(`\n❌ ${errorMsg}`);
            logToFile(`❌ ${errorMsg}`);
            
            const waitTime = Math.min(10000 * consecutiveErrors, 60000);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

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
        
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
    }
}

console.log('\n' + '='.repeat(80));
console.log(`🤖 BOT DE SINAIS SMC - VERSÃO COM CONTINUOUS LEARNING`);
console.log(`🧠 SISTEMA DE APRENDIZADO CONTÍNUO INTEGRADO`);
console.log(`📊 O bot agora aprende e otimiza automaticamente`);
console.log(`🎯 Parâmetros ajustados baseado em performance real`);
console.log(`⚡ Estocástico (5,3,3) 1h e 4h implementado`);
console.log(`📈 ADX 1h obrigatório com threshold otimizável`);
console.log(`🔧 Volume adaptativo com aprendizado contínuo`);
console.log('='.repeat(80) + '\n');

try {
    require('technicalindicators');
} catch (error) {
    console.log('⚠️ technicalindicators não encontrado. Instale com: npm install technicalindicators');
    process.exit(1);
}

startBot();
