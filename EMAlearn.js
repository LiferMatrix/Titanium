const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs';
const TELEGRAM_CHAT_ID = '-100199';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true; // 🔥 AGORA É TRUE - MODO REAL ATIVADO
const DRY_RUN_PREFIX = '[TESTE] '; // Prefixo mantido para logs

// === CONFIGURAÇÕES OTIMIZADAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.0,
    volatilityMultiplier: 0.2,
    useAdaptive: true
};

const VOLATILITY_PERIOD = 20;
const VOLATILITY_TIMEFRAME = '15m'; // Timeframe da volatilidade
const VOLATILITY_THRESHOLD = 0.8;

// === CONFIGURAÇÕES LSR AJUSTADAS ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;      // ALTERADO: Máximo até 2.5 para compra
const LSR_SELL_THRESHOLD = 2.5;     // ALTERADO: Maior que 2.5 para venda

const FUNDING_BUY_MAX = -0.0005;
const FUNDING_SELL_MIN = 0.0005;

const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,
    oppositeDirection: 10 * 60 * 1000,
    useDifferentiated: true
};

// === QUALITY SCORE COMPLETO - COM NOVOS INDICADORES ===
const QUALITY_THRESHOLD = 70;
const QUALITY_WEIGHTS = {
    volume: 20,           // Reduzido de 25 para 20
    oi: 10,
    volatility: 10,
    lsr: 10,
    rsi: 10,
    emaAlignment: 15,
    adx: 5,
    adx1h: 15,
    stoch1h: 5,
    stoch4h: 10,          // NOVO: Stochastic 4h
    cci4h: 15             // NOVO: CCI 4h
};

// === CONFIGURAÇÕES DE RATE LIMIT ADAPTATIVO ===
const BINANCE_RATE_LIMIT = {
    requestsPerMinute: 1000,
    requestsPerSecond: 30,
    weightPerRequest: {
        exchangeInfo: 10,
        klines: 1,
        openInterest: 1,
        fundingRate: 1,
        ticker24hr: 1,
        ping: 1
    },
    maxWeightPerMinute: 2200,
    maxWeightPerSecond: 40,
    retryConfig: {
        maxRetries: 3,
        initialDelay: 2000,
        maxDelay: 15000,
        backoffFactor: 2.5
    },
    circuitBreaker: {
        failureThreshold: 8,
        resetTimeout: 90000,
        halfOpenMaxRequests: 3
    }
};

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const MAX_LOG_FILES = 15;

// === CACHE SETTINGS ===
const candleCache = {};
const CANDLE_CACHE_TTL = 60000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

const oiCache = {};
const OI_CACHE_TTL = 2 * 60 * 1000;
const OI_HISTORY_SIZE = 20;

// === CONFIGURAÇÕES TÉCNICAS ===
const ADX_SETTINGS = {
    period: 14,
    timeframe: '15m',
    strongTrendThreshold: 28
};

const ADX_1H_SETTINGS = {
    period: 14,
    timeframe: '1h',
    strongTrendThreshold: 25,
    minStrength: 22
};

const STOCH_SETTINGS = {
    period: 5,
    signalPeriod: 3,
    smooth: 3,
    timeframe1h: '1h'
};

// NOVAS CONFIGURAÇÕES PARA STOCHASTIC 4H
const STOCH_4H_SETTINGS = {
    period: 14,
    signalPeriod: 3,
    smooth: 3,
    timeframe: '4h'
};

// NOVAS CONFIGURAÇÕES PARA CCI 4H
const CCI_4H_SETTINGS = {
    period: 20,
    maPeriod: 14,
    timeframe: '4h'
};

const TARGET_PERCENTAGES = [2.5, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 3.5;
const ATR_TIMEFRAME = '15m';

// =====================================================================
// 🔄 CIRCUIT BREAKER CLASS
// =====================================================================

class CircuitBreaker {
    constructor() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.resetTimeout = BINANCE_RATE_LIMIT.circuitBreaker.resetTimeout;
        this.failureThreshold = BINANCE_RATE_LIMIT.circuitBreaker.failureThreshold;
        this.halfOpenMaxRequests = BINANCE_RATE_LIMIT.circuitBreaker.halfOpenMaxRequests;
    }

    canExecute() {
        const now = Date.now();
        
        switch (this.state) {
            case 'CLOSED':
                return true;
                
            case 'OPEN':
                if (this.lastFailureTime && (now - this.lastFailureTime) >= this.resetTimeout) {
                    this.state = 'HALF_OPEN';
                    this.successCount = 0;
                    console.log('🔧 Circuit Breaker: Mudando para HALF_OPEN');
                    return true;
                }
                return false;
                
            case 'HALF_OPEN':
                if (this.successCount >= this.halfOpenMaxRequests) {
                    this.state = 'CLOSED';
                    this.failureCount = 0;
                    console.log('🔧 Circuit Breaker: Mudando para CLOSED (recuperado)');
                }
                return this.successCount < this.halfOpenMaxRequests;
                
            default:
                return false;
        }
    }

    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
        } else if (this.state === 'CLOSED') {
            this.failureCount = Math.max(0, this.failureCount - 1);
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            console.log(`🚨 Circuit Breaker: Mudando para OPEN (falhas: ${this.failureCount})`);
        } else if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            console.log('🚨 Circuit Breaker: Retornando para OPEN (falha no half-open)');
        }
    }

    getStatus() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            canExecute: this.canExecute()
        };
    }
}

// =====================================================================
// 🧠 SISTEMA DE APRENDIZADO COMPLETO (COM TRADE TRACKING)
// =====================================================================

class AdvancedLearningSystem {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.openTrades = new Map();
        this.patterns = { winning: {}, losing: {} };
        this.parameterEvolution = {
            volumeThreshold: [],
            qualityThreshold: [],
            adxThreshold: []
        };
        
        this.learningEnabled = true;
        this.minTradesForLearning = 10;
        this.tradeTrackingHours = 24;
        
        this.loadLearningData();
        console.log('🧠 Sistema de Aprendizado Avançado inicializado');
    }
    
    loadLearningData() {
        try {
            if (!fs.existsSync(LEARNING_DIR)) {
                fs.mkdirSync(LEARNING_DIR, { recursive: true });
            }
            
            const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
            if (fs.existsSync(learningFile)) {
                const data = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
                
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
                this.patterns = data.patterns || this.patterns;
                this.parameterEvolution = data.parameterEvolution || this.parameterEvolution;
                
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
                parameterEvolution: this.parameterEvolution,
                lastUpdated: Date.now()
            };
            
            const learningFile = path.join(LEARNING_DIR, 'learning_data.json');
            const backupFile = path.join(LEARNING_DIR, `learning_backup_${Date.now()}.json`);
            
            if (fs.existsSync(learningFile)) {
                fs.copyFileSync(learningFile, backupFile);
            }
            
            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
            this.cleanupOldBackups();
            
        } catch (error) {
            console.error('Erro ao salvar dados de aprendizado:', error);
        }
    }
    
    cleanupOldBackups() {
        try {
            const files = fs.readdirSync(LEARNING_DIR)
                .filter(file => file.startsWith('learning_backup_'))
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
            // Ignorar erro
        }
    }
    
    async recordSignal(signal, marketData) {
        if (!this.learningEnabled) return null;
        
        try {
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
                entryPrice: signal.price,
                stopPrice: signal.targetsData.stopPrice,
                targets: signal.targetsData.targets.map(t => ({
                    price: parseFloat(t.price),
                    percentage: parseFloat(t.target),
                    rr: parseFloat(t.riskReward)
                })),
                bestTarget: signal.targetsData.targets.reduce((a, b) => 
                    parseFloat(b.riskReward) > parseFloat(a.riskReward) ? b : a
                ),
                qualityScore: signal.qualityScore,
                marketData: {
                    volumeRatio: marketData.volume?.rawRatio || 0,
                    rsi: marketData.rsi?.raw || 0,
                    adx1h: marketData.adx1h?.raw || 0,
                    volatility: marketData.volatility?.rawVolatility || 0,
                    lsr: marketData.lsr?.lsrRatio || 0,
                    emaAlignment: marketData.ema?.isAboveEMA55 || false,
                    stoch4hValid: marketData.stoch4h?.isValid || false,      // NOVO
                    cci4hValid: marketData.cci4h?.isValid || false,         // NOVO
                    cci4hValue: marketData.cci4h?.value || 0,               // NOVO
                    cci4hMA: marketData.cci4h?.maValue || 0                 // NOVO
                },
                status: 'OPEN',
                outcome: null,
                exitPrice: null,
                profitPercentage: null,
                durationHours: null
            };
            
            this.tradeHistory.push(tradeRecord);
            this.openTrades.set(tradeRecord.id, tradeRecord);
            
            setTimeout(() => {
                this.checkTradeOutcome(tradeRecord.id);
            }, this.tradeTrackingHours * 60 * 60 * 1000);
            
            if (!this.symbolPerformance[signal.symbol]) {
                this.symbolPerformance[signal.symbol] = {
                    totalSignals: 0,
                    successfulSignals: 0,
                    totalProfit: 0,
                    avgHoldingTime: 0,
                    recentScores: []
                };
            }
            
            const symbolStats = this.symbolPerformance[signal.symbol];
            symbolStats.totalSignals++;
            symbolStats.recentScores.push(signal.qualityScore.score);
            
            if (symbolStats.recentScores.length > 20) {
                symbolStats.recentScores = symbolStats.recentScores.slice(-20);
            }
            
            if (this.tradeHistory.length % 20 === 0) {
                this.saveLearningData();
                await this.analyzePatterns();
            }
            
            return tradeRecord.id;
            
        } catch (error) {
            console.error('Erro ao registrar sinal:', error);
            return null;
        }
    }
    
    async checkTradeOutcome(tradeId) {
        try {
            const trade = this.openTrades.get(tradeId);
            if (!trade || trade.status !== 'OPEN') return;
            
            const currentPrice = await this.getCurrentPrice(trade.symbol);
            if (!currentPrice) return;
            
            let outcome = 'FAILURE';
            let exitPrice = trade.stopPrice;
            let profitPercentage = 0;
            
            for (const target of trade.targets) {
                const targetReached = trade.direction === 'BUY' 
                    ? currentPrice >= target.price
                    : currentPrice <= target.price;
                
                if (targetReached) {
                    outcome = 'SUCCESS';
                    exitPrice = target.price;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                    break;
                }
            }
            
            if (outcome === 'FAILURE') {
                const stopHit = trade.direction === 'BUY'
                    ? currentPrice <= trade.stopPrice
                    : currentPrice >= trade.stopPrice;
                
                if (stopHit) {
                    profitPercentage = trade.direction === 'BUY'
                        ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                } else {
                    exitPrice = currentPrice;
                    profitPercentage = trade.direction === 'BUY'
                        ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
                        : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
                }
            }
            
            trade.status = 'CLOSED';
            trade.outcome = outcome;
            trade.exitPrice = exitPrice;
            trade.profitPercentage = profitPercentage;
            trade.durationHours = (Date.now() - trade.timestamp) / (1000 * 60 * 60);
            
            const symbolStats = this.symbolPerformance[trade.symbol];
            if (outcome === 'SUCCESS') {
                symbolStats.successfulSignals++;
                symbolStats.totalProfit += profitPercentage;
            }
            
            symbolStats.avgHoldingTime = symbolStats.successfulSignals > 0
                ? (symbolStats.avgHoldingTime * (symbolStats.successfulSignals - 1) + trade.durationHours) / symbolStats.successfulSignals
                : trade.durationHours;
            
            this.openTrades.delete(tradeId);
            
            await this.analyzePatterns();
            
            console.log(`📊 Trade ${trade.symbol} ${trade.direction} ${outcome}: ${profitPercentage.toFixed(2)}%`);
            
        } catch (error) {
            console.error('Erro ao verificar outcome do trade:', error);
        }
    }
    
    async getCurrentPrice(symbol) {
        try {
            const candles = await getCandlesCached(symbol, '1m', 2);
            if (candles.length > 0) {
                return candles[candles.length - 1].close;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    
    async analyzePatterns() {
        try {
            const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
            if (closedTrades.length < 5) return;
            
            const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
            const losers = closedTrades.filter(t => t.outcome === 'FAILURE');
            
            winners.forEach(trade => {
                const patterns = this.extractPatterns(trade);
                patterns.forEach(pattern => {
                    this.patterns.winning[pattern] = (this.patterns.winning[pattern] || 0) + 1;
                });
            });
            
            losers.forEach(trade => {
                const patterns = this.extractPatterns(trade);
                patterns.forEach(pattern => {
                    this.patterns.losing[pattern] = (this.patterns.losing[pattern] || 0) + 1;
                });
            });
            
            if (closedTrades.length >= this.minTradesForLearning) {
                await this.optimizeParameters(closedTrades);
            }
            
            console.log(`📊 Análise: ${winners.length} vencedores, ${losers.length} perdedores`);
            
        } catch (error) {
            console.error('Erro na análise de padrões:', error);
        }
    }
    
    extractPatterns(trade) {
        const patterns = [];
        const data = trade.marketData;
        
        if (data.volumeRatio >= 1.8 && data.adx1h >= 25) {
            patterns.push('HIGH_VOL_STRONG_TREND');
        }
        if (data.volumeRatio >= 1.5 && data.volumeRatio < 1.8 && data.adx1h >= 22) {
            patterns.push('MOD_VOL_GOOD_TREND');
        }
        if (data.rsi <= 35 || data.rsi >= 65) {
            patterns.push('RSI_EXTREME');
        }
        if (data.volatility >= 1.0 && data.volatility <= 1.5) {
            patterns.push('OPTIMAL_VOLATILITY');
        }
        if (data.lsr >= 3.0) {
            patterns.push('HIGH_LSR');
        }
        // NOVOS PADRÕES
        if (data.stoch4hValid && data.cci4hValid) {
            patterns.push('STOCH_CCI_4H_BULLISH');
        }
        if (data.cci4hValue > 100 || data.cci4hValue < -100) {
            patterns.push('CCI_EXTREME');
        }
        
        return patterns;
    }
    
    async optimizeParameters(closedTrades) {
        try {
            const volumeAnalysis = this.analyzeParameter(
                closedTrades, 
                t => t.marketData.volumeRatio,
                [1.3, 1.5, 1.7, 1.9, 2.1],
                VOLUME_SETTINGS.baseThreshold
            );
            
            if (volumeAnalysis.bestValue && volumeAnalysis.winRate > 0.6) {
                const adjustment = (volumeAnalysis.bestValue - VOLUME_SETTINGS.baseThreshold) * 0.1;
                VOLUME_SETTINGS.baseThreshold += adjustment;
                VOLUME_SETTINGS.baseThreshold = Math.max(1.3, Math.min(2.0, VOLUME_SETTINGS.baseThreshold));
                
                this.parameterEvolution.volumeThreshold.push({
                    timestamp: Date.now(),
                    old: VOLUME_SETTINGS.baseThreshold - adjustment,
                    new: VOLUME_SETTINGS.baseThreshold,
                    winRate: volumeAnalysis.winRate
                });
            }
            
            const adxAnalysis = this.analyzeParameter(
                closedTrades,
                t => t.marketData.adx1h,
                [18, 20, 22, 24, 26, 28],
                ADX_1H_SETTINGS.minStrength
            );
            
            if (adxAnalysis.bestValue && adxAnalysis.winRate > 0.6) {
                const adjustment = (adxAnalysis.bestValue - ADX_1H_SETTINGS.minStrength) * 0.1;
                ADX_1H_SETTINGS.minStrength += adjustment;
                ADX_1H_SETTINGS.minStrength = Math.max(18, Math.min(30, ADX_1H_SETTINGS.minStrength));
                
                this.parameterEvolution.adxThreshold.push({
                    timestamp: Date.now(),
                    old: ADX_1H_SETTINGS.minStrength - adjustment,
                    new: ADX_1H_SETTINGS.minStrength,
                    winRate: adxAnalysis.winRate
                });
            }
            
            console.log(`⚙️  Parâmetros otimizados: Volume=${VOLUME_SETTINGS.baseThreshold.toFixed(2)}, ADX=${ADX_1H_SETTINGS.minStrength.toFixed(1)}`);
            this.saveLearningData();
            
        } catch (error) {
            console.error('Erro na otimização:', error);
        }
    }
    
    analyzeParameter(trades, getValueFn, thresholds, currentValue) {
        let bestThreshold = currentValue;
        let bestWinRate = 0;
        
        thresholds.forEach(threshold => {
            const filtered = trades.filter(t => getValueFn(t) >= threshold);
            if (filtered.length >= 3) {
                const winners = filtered.filter(t => t.outcome === 'SUCCESS');
                const winRate = winners.length / filtered.length;
                
                if (winRate > bestWinRate) {
                    bestWinRate = winRate;
                    bestThreshold = threshold;
                }
            }
        });
        
        return {
            bestValue: bestWinRate > 0 ? bestThreshold : null,
            winRate: bestWinRate
        };
    }
    
    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
        const losers = closedTrades.filter(t => t.outcome === 'FAILURE');
        
        const winRate = closedTrades.length > 0 ? winners.length / closedTrades.length : 0;
        const avgProfit = winners.length > 0 ? 
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        const avgLoss = losers.length > 0 ? 
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;
        
        const profitFactor = avgLoss !== 0 ? Math.abs(avgProfit / avgLoss) : 0;
        
        const winningPatterns = Object.entries(this.patterns.winning)
            .filter(([_, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        const losingPatterns = Object.entries(this.patterns.losing)
            .filter(([_, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        return {
            totalTrades: closedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate * 100,
            profitFactor: profitFactor.toFixed(2),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            bestPatterns: winningPatterns,
            worstPatterns: losingPatterns,
            openTrades: this.openTrades.size,
            monitoredSymbols: Object.keys(this.symbolPerformance).length
        };
    }
    
    async sendPerformanceReport() {
        try {
            const report = this.getPerformanceReport();
            
            if (report.totalTrades < 5) {
                return;
            }
            
            const message = `
🧠 <b>RELATÓRIO DE PERFORMANCE - APRENDIZADO</b>

📊 <b>ESTATÍSTICAS:</b>
• Trades Fechados: <b>${report.totalTrades}</b>
• Win Rate: <b>${report.winRate.toFixed(1)}%</b>
• Profit Factor: <b>${report.profitFactor}</b>
• Média Gain: <b>${report.avgProfit}%</b>
• Média Loss: <b>${report.avgLoss}%</b>
• Trades Abertos: <b>${report.openTrades}</b>

📈 <b>PADRÕES VENCEDORES:</b>
${report.bestPatterns.map(([pattern, count]) => `• ${pattern}: ${count} trades`).join('\n') || '• Coletando dados...'}

📉 <b>PADRÕES PERDEDORES:</b>
${report.worstPatterns.map(([pattern, count]) => `• ${pattern}: ${count} trades`).join('\n') || '• Coletando dados...'}

⚙️ <b>PARÂMETROS ATUAIS:</b>
• Volume Threshold: <b>${VOLUME_SETTINGS.baseThreshold.toFixed(2)}x</b>
• ADX Mínimo: <b>${ADX_1H_SETTINGS.minStrength.toFixed(1)}</b>
• Quality Threshold: <b>${QUALITY_THRESHOLD}</b>

🔧 <i>Sistema em aprendizado contínuo</i>
🔔 by @J4Rviz.
            `;
            
            await sendTelegramAlert(message, !LIVE_MODE);
            
        } catch (error) {
            console.error('Erro ao enviar relatório:', error);
        }
    }
}

// =====================================================================
// 🚀 RATE LIMITER COM DELAY ADAPTATIVO
// =====================================================================

class AdaptiveRateLimiter {
    constructor() {
        this.minuteWindow = { start: Date.now(), usedWeight: 0 };
        this.secondWindow = { start: Date.now(), usedWeight: 0 };
        
        this.circuitBreaker = new CircuitBreaker();
        this.queue = [];
        this.isProcessing = false;
        this.lastStatusLog = Date.now();
        
        this.adaptiveDelay = 100;
        this.minDelay = 50;
        this.maxDelay = 500;
        this.usageThreshold = 0.7;
        
        console.log('🚀 Rate Limiter Adaptativo inicializado');
    }
    
    async makeRequest(url, options = {}, endpointType = 'klines') {
        const weight = BINANCE_RATE_LIMIT.weightPerRequest[endpointType] || 1;
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return new Promise((resolve, reject) => {
            const request = {
                id: requestId,
                url,
                options,
                weight,
                endpointType,
                resolve,
                reject,
                timestamp: Date.now(),
                retryCount: 0
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
                if (!this.circuitBreaker.canExecute()) {
                    await this.delay(1000);
                    continue;
                }
                
                const request = this.queue.shift();
                if (!request) {
                    await this.delay(100);
                    continue;
                }
                
                if (!this.checkLimits(request.weight)) {
                    this.queue.unshift(request);
                    await this.waitForLimits(request.weight);
                    continue;
                }
                
                try {
                    const result = await this.executeRequest(request);
                    request.resolve(result);
                    this.circuitBreaker.recordSuccess();
                    this.adjustDelay();
                    
                } catch (error) {
                    request.reject(error);
                    this.circuitBreaker.recordFailure();
                    
                    if (error.message && error.message.includes('429')) {
                        console.log('⏳ Rate Limit 429. Aumentando delay...');
                        this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.5);
                        await this.delay(10000);
                    }
                }
                
                await this.delay(this.adaptiveDelay);
            }
        } finally {
            this.isProcessing = false;
        }
        
        if (Date.now() - this.lastStatusLog >= 30000) {
            this.logStatus();
            this.lastStatusLog = Date.now();
        }
    }
    
    checkLimits(weight) {
        const now = Date.now();
        
        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }
        
        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }
        
        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        const secondUsage = this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond;
        
        return minuteUsage < 0.85 && secondUsage < 0.8;
    }
    
    adjustDelay() {
        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        
        if (minuteUsage > this.usageThreshold) {
            this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay * 1.1);
        } else if (minuteUsage < this.usageThreshold * 0.5) {
            this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay * 0.9);
        }
    }
    
    async waitForLimits(weight) {
        const now = Date.now();
        const minuteRemaining = 60000 - (now - this.minuteWindow.start);
        const secondRemaining = 1000 - (now - this.secondWindow.start);
        
        const minuteUsage = this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute;
        const secondUsage = this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond;
        
        if (minuteUsage > 0.85) {
            await this.delay(minuteRemaining + 200);
        } else if (secondUsage > 0.8) {
            await this.delay(secondRemaining + 200);
        } else {
            await this.delay(this.adaptiveDelay * 2);
        }
    }
    
    async executeRequest(request) {
        for (let attempt = 0; attempt <= BINANCE_RATE_LIMIT.retryConfig.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delayTime = Math.min(
                        BINANCE_RATE_LIMIT.retryConfig.maxDelay,
                        BINANCE_RATE_LIMIT.retryConfig.initialDelay * 
                        Math.pow(BINANCE_RATE_LIMIT.retryConfig.backoffFactor, attempt - 1)
                    );
                    await this.delay(delayTime);
                }
                
                this.updateCounters(request.weight);
                
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
                
            } catch (error) {
                if (attempt === BINANCE_RATE_LIMIT.retryConfig.maxRetries) {
                    throw error;
                }
            }
        }
    }
    
    updateCounters(weight) {
        const now = Date.now();
        
        if (now - this.minuteWindow.start >= 60000) {
            this.minuteWindow = { start: now, usedWeight: 0 };
        }
        
        if (now - this.secondWindow.start >= 1000) {
            this.secondWindow = { start: now, usedWeight: 0 };
        }
        
        this.minuteWindow.usedWeight += weight;
        this.secondWindow.usedWeight += weight;
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    logStatus() {
        const minuteUsage = (this.minuteWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerMinute * 100).toFixed(1);
        const secondUsage = (this.secondWindow.usedWeight / BINANCE_RATE_LIMIT.maxWeightPerSecond * 100).toFixed(1);
        
        console.log(`📊 Rate Limit: ${minuteUsage}% minuto | ${secondUsage}% segundo | Delay: ${this.adaptiveDelay}ms`);
    }
}

// =====================================================================
// 📊 FUNÇÕES AUXILIARES
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
        
    } catch (error) {
        console.error('❌ Erro ao escrever no log:', error.message);
    }
}

function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    
    return { date, time, full: `${date} ${time}` };
}

async function sendTelegramAlert(message, isDryRun = false) {
    try {
        // Em modo DRY-RUN, apenas log no console
        if (isDryRun && !LIVE_MODE) {
            console.log(`\n${DRY_RUN_PREFIX}══════════════════════════════════════════════════`);
            console.log(`${DRY_RUN_PREFIX}ALERTA (NÃO ENVIADO):`);
            
            const cleanMessage = message
                .replace(/<b>/g, '')
                .replace(/<\/b>/g, '')
                .replace(/<i>/g, '')
                .replace(/<\/i>/g, '');
            
            console.log(`${DRY_RUN_PREFIX}${cleanMessage.substring(0, 300)}...`);
            console.log(`${DRY_RUN_PREFIX}══════════════════════════════════════════════════\n`);
            return true;
        }
        
        // Em modo REAL, envia para o Telegram
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        console.log('✅ Mensagem enviada para Telegram com sucesso!');
        logToFile(`📤 Alerta REAL enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 🚀 FUNÇÃO ESPECIAL PARA MENSAGEM DE INICIALIZAÇÃO
// =====================================================================

async function sendInitializationMessage(allSymbols) {
    try {
        const brazilTime = getBrazilianDateTime();
        
        const message = `
🚀 <b>SISTEMA BINANCE FUTURES INICIADO</b>

📊 <b>Configuração:</b>
• Ativos: <b>${allSymbols.length}</b> pares USDT
• Modo: <b>${LIVE_MODE ? 'REAL 🔥' : 'DRY-RUN (TESTE) 🧪'}</b>
• Aprendizado: <b>ATIVO AVANÇADO 🧠</b>
• Rate Limit: <b>ADAPTATIVO ⚡</b>

🧠 <b>Recursos Avançados:</b>
✅ Monitoramento completo com LSR e Volatilidade
✅ Sistema de aprendizado com tracking de trades
✅ Delay adaptativo entre grupos
✅ Otimização automática de parâmetros
✅ Relatórios de performance

⏰ <b>Início:</b> ${brazilTime.full}
🔔 by @J4Rviz.
        `;
        
        console.log('\n📤 ENVIANDO MENSAGEM DE INICIALIZAÇÃO PARA TELEGRAM...');
        
        // Enviar para Telegram (sempre, independente do modo)
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: LIVE_MODE ? message : `🧪 ${DRY_RUN_PREFIX} ${message}`,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
            timeout: 10000
        });
        
        if (!response.ok) {
            console.log(`⚠️ Não foi possível enviar para Telegram (${response.status})`);
            console.log('📋 Mensagem que seria enviada:');
            console.log('\n' + '='.repeat(60));
            console.log('🚀 SISTEMA BINANCE FUTURES INICIADO');
            console.log(`📊 Ativos: ${allSymbols.length} pares USDT`);
            console.log(`🎯 Modo: ${LIVE_MODE ? 'REAL' : 'DRY-RUN (TESTE)'}`);
            console.log(`⏰ Início: ${brazilTime.full}`);
            console.log('='.repeat(60) + '\n');
        } else {
            console.log('✅ Mensagem de inicialização enviada para Telegram!');
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem de inicialização:', error.message);
        return false;
    }
}

// =====================================================================
// 🔍 FUNÇÕES DE ANÁLISE TÉCNICA
// =====================================================================

let rateLimiter = new AdaptiveRateLimiter();
let learningSystem = new AdvancedLearningSystem();

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
        console.log('❌ Erro ao buscar símbolos, usando fallback');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function getCandlesCached(symbol, timeframe, limit = 80) {
    try {
        const cacheKey = `${symbol}_${timeframe}_${limit}`;
        const now = Date.now();
        
        if (candleCache[cacheKey] && now - candleCache[cacheKey].timestamp < CANDLE_CACHE_TTL) {
            return candleCache[cacheKey].data;
        }
        
        const intervalMap = {
            '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
            '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h'
        };
        
        const interval = intervalMap[timeframe] || '15m';
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
        return [];
    }
}

async function getEMAs3m(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 80);
        if (candles.length < 55) return null;
        
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
            isAboveEMA55: currentPrice > latestEma55,
            isEMA13CrossingUp: previousEma13 <= previousEma34 && latestEma13 > latestEma34,
            isEMA13CrossingDown: previousEma13 >= previousEma34 && latestEma13 < latestEma34
        };
    } catch (error) {
        return null;
    }
}

async function getRSI1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 80);
        if (candles.length < 14) return null;
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        
        if (!rsiValues || rsiValues.length === 0) return null;
        
        const latestRSI = rsiValues[rsiValues.length - 1];
        return {
            value: latestRSI,
            raw: latestRSI,
            status: latestRSI < 30 ? 'OVERSOLD' : latestRSI > 70 ? 'OVERBOUGHT' : 'NEUTRAL'
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        // ALTERADO: De 5m para 3m
        const candles = await getCandlesCached(symbol, '3m', 50);
        if (candles.length < 20) return { rawRatio: 0, isAbnormal: false };
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        
        const ratio = currentVolume / avgVolume;
        
        return {
            rawRatio: ratio,
            isAbnormal: ratio >= VOLUME_SETTINGS.baseThreshold
        };
    } catch (error) {
        return { rawRatio: 0, isAbnormal: false };
    }
}

async function checkVolatility(symbol) {
    try {
        // JÁ ESTÁ EM 15m (CORRETO)
        const candles = await getCandlesCached(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD + 10);
        if (candles.length < VOLATILITY_PERIOD) return { rawVolatility: 0, isValid: false };
        
        const closes = candles.map(c => c.close);
        const returns = [];
        
        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i-1]) / closes[i-1]));
        }
        
        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;
        
        return {
            rawVolatility: volatility,
            isValid: volatility >= VOLATILITY_THRESHOLD
        };
    } catch (error) {
        return { rawVolatility: 0, isValid: false };
    }
}

async function checkLSR(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, LSR_TIMEFRAME, 50);
        if (candles.length < 2) return { lsrRatio: 0, isValid: false };
        
        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        
        const currentHigh = lastCandle.high;
        const currentLow = lastCandle.low;
        const currentClose = lastCandle.close;
        
        const previousHigh = previousCandle.high;
        const previousLow = previousCandle.low;
        
        const lsrRatio = (currentHigh - currentClose) / (currentClose - currentLow);
        // ALTERADO: lsrRatio <= 2.5 para compra, lsrRatio > 2.5 para venda
        const isValid = isBullish ? lsrRatio <= LSR_BUY_THRESHOLD : lsrRatio > LSR_SELL_THRESHOLD;
        
        return {
            lsrRatio: lsrRatio,
            isValid: isValid
        };
    } catch (error) {
        return { lsrRatio: 0, isValid: false };
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 80);
        if (candles.length < ADX_1H_SETTINGS.period + 5) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: ADX_1H_SETTINGS.period
        });
        
        if (!adxValues || adxValues.length === 0) return null;
        
        const latestADX = adxValues[adxValues.length - 1];
        const adxValue = typeof latestADX === 'object' ? latestADX.adx : latestADX;
        
        if (typeof adxValue !== 'number' || isNaN(adxValue)) return null;
        
        return {
            raw: adxValue,
            hasMinimumStrength: adxValue >= ADX_1H_SETTINGS.minStrength
        };
    } catch (error) {
        return null;
    }
}

async function checkStochastic(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 30);
        if (candles.length < 20) return { isValid: false };
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: STOCH_SETTINGS.period,
            signalPeriod: STOCH_SETTINGS.signalPeriod
        });
        
        if (!stochValues || stochValues.length < 2) return { isValid: false };
        
        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        
        if (isBullish) {
            return {
                isValid: previous.k <= previous.d && current.k > current.d
            };
        } else {
            return {
                isValid: previous.k >= previous.d && current.k < current.d
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

// NOVA FUNÇÃO: STOCHASTIC 4H
async function checkStochastic4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 40);
        if (candles.length < STOCH_4H_SETTINGS.period + 5) return { isValid: false };
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const stochValues = Stochastic.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: STOCH_4H_SETTINGS.period,
            signalPeriod: STOCH_4H_SETTINGS.signalPeriod,
            smooth: STOCH_4H_SETTINGS.smooth
        });
        
        if (!stochValues || stochValues.length < 2) return { isValid: false };
        
        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        
        if (isBullish) {
            return {
                isValid: previous.k <= previous.d && current.k > current.d,
                kValue: current.k,
                dValue: current.d
            };
        } else {
            return {
                isValid: previous.k >= previous.d && current.k < current.d,
                kValue: current.k,
                dValue: current.d
            };
        }
    } catch (error) {
        return { isValid: false };
    }
}

// NOVA FUNÇÃO: CCI 4H
async function checkCCI4h(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '4h', 50);
        if (candles.length < CCI_4H_SETTINGS.period + 10) return { 
            value: 0, 
            maValue: 0, 
            isValid: false 
        };
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        // Calcular CCI
        const cciValues = CCI.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: CCI_4H_SETTINGS.period
        });
        
        if (!cciValues || cciValues.length === 0) return { 
            value: 0, 
            maValue: 0, 
            isValid: false 
        };
        
        const latestCCI = cciValues[cciValues.length - 1];
        
        // Calcular MMS (Simple Moving Average) do CCI
        const cciForMA = cciValues.slice(-CCI_4H_SETTINGS.maPeriod);
        const cciMA = cciForMA.reduce((sum, value) => sum + value, 0) / cciForMA.length;
        
        // Critério: CCI acima da MMS para compra, abaixo para venda
        const isValid = isBullish ? 
            latestCCI > cciMA :  // Compra explosiva: CCI > MMS
            latestCCI < cciMA;   // Venda explosiva: CCI < MMS
        
        return {
            value: latestCCI,
            maValue: cciMA,
            isValid: isValid,
            deviation: Math.abs(latestCCI - cciMA)
        };
    } catch (error) {
        return { 
            value: 0, 
            maValue: 0, 
            isValid: false 
        };
    }
}

async function checkOpenInterest(symbol, isBullish) {
    try {
        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, 
            {}, 
            'openInterest'
        );
        
        const oi = parseFloat(data.openInterest);
        const timestamp = Date.now();
        
        if (!oiCache[symbol]) {
            oiCache[symbol] = { history: [], timestamp: timestamp };
        }
        
        oiCache[symbol].history.push({ oi, timestamp });
        
        if (oiCache[symbol].history.length > OI_HISTORY_SIZE) {
            oiCache[symbol].history = oiCache[symbol].history.slice(-OI_HISTORY_SIZE);
        }
        
        let trend = "➡️";
        if (oiCache[symbol].history.length >= 3) {
            const recentOI = oiCache[symbol].history.slice(-3).map(h => h.oi);
            const avgOI = recentOI.reduce((a, b) => a + b, 0) / recentOI.length;
            
            if (oi > avgOI * 1.05) trend = "📈";
            else if (oi < avgOI * 0.95) trend = "📉";
        }
        
        const isValid = (isBullish && trend === "📈") || (!isBullish && trend === "📉");
        
        return {
            isValid: isValid,
            trend: trend
        };
    } catch (error) {
        return { isValid: false, trend: "➡️" };
    }
}

async function checkFundingRate(symbol, isBullish) {
    try {
        const data = await rateLimiter.makeRequest(
            `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`, 
            {}, 
            'fundingRate'
        );
        
        if (!data || data.length === 0) {
            return { isValid: false, raw: 0 };
        }
        
        const fundingRate = parseFloat(data[0].fundingRate);
        const isValid = isBullish ? fundingRate <= FUNDING_BUY_MAX : fundingRate >= FUNDING_SELL_MIN;
        
        return {
            isValid: isValid,
            raw: fundingRate
        };
    } catch (error) {
        return { isValid: false, raw: 0 };
    }
}

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    let failedChecks = [];
    
    if (marketData.volume && marketData.volume.rawRatio >= VOLUME_SETTINGS.baseThreshold) {
        const volumeScore = Math.min(QUALITY_WEIGHTS.volume, 
            QUALITY_WEIGHTS.volume * (marketData.volume.rawRatio / 2.0));
        score += volumeScore;
        details.push(`📊 Volume 3m: ${volumeScore.toFixed(1)}/${QUALITY_WEIGHTS.volume} (${marketData.volume.rawRatio.toFixed(2)}x)`);
    } else {
        failedChecks.push(`Volume 3m: ${marketData.volume?.rawRatio.toFixed(2) || 0}x < ${VOLUME_SETTINGS.baseThreshold}x`);
    }
    
    if (marketData.volatility && marketData.volatility.isValid) {
        const volScore = QUALITY_WEIGHTS.volatility;
        score += volScore;
        details.push(`📊 Volatilidade 15m: ${volScore}/${QUALITY_WEIGHTS.volatility} (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    } else {
        failedChecks.push(`Volatilidade 15m: ${marketData.volatility?.rawVolatility.toFixed(2) || 0}% < ${VOLATILITY_THRESHOLD}%`);
    }
    
    if (marketData.lsr && marketData.lsr.isValid) {
        const lsrScore = QUALITY_WEIGHTS.lsr;
        score += lsrScore;
        details.push(`📊 LSR 15m: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${marketData.lsr.lsrRatio.toFixed(2)} ratio)`);
    } else {
        failedChecks.push(`LSR 15m: ${marketData.lsr?.lsrRatio.toFixed(2) || 0} ${isBullish ? '>' : '<='} ${LSR_BUY_THRESHOLD}`);
    }
    
    // ALTERADO: RSI < 60 para compra, > 60 para venda
    if (marketData.rsi) {
        const rsiValue = marketData.rsi.value;
        let rsiScore = 0;
        
        if (isBullish && rsiValue < 60) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} < 60 ideal para compra)`);
        } else if (!isBullish && rsiValue > 60) {
            rsiScore = QUALITY_WEIGHTS.rsi;
            details.push(`📊 RSI 1h: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} > 60 ideal para venda)`);
        } else {
            failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} ${isBullish ? '≥ 60' : '≤ 60'} (${isBullish ? 'compra precisa RSI < 60' : 'venda precisa RSI > 60'})`);
        }
        score += rsiScore;
    }
    
    if (marketData.adx1h && marketData.adx1h.raw >= ADX_1H_SETTINGS.minStrength) {
        const adxScore = QUALITY_WEIGHTS.adx1h;
        score += adxScore;
        details.push(`📊 ADX 1h: ${adxScore}/${QUALITY_WEIGHTS.adx1h} (${marketData.adx1h.raw.toFixed(2)} ≥ ${ADX_1H_SETTINGS.minStrength})`);
    } else {
        failedChecks.push(`ADX 1h: ${marketData.adx1h?.raw?.toFixed(2) || 0} < ${ADX_1H_SETTINGS.minStrength}`);
    }
    
    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
                          (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);
        
        if (isEmaValid) {
            const emaScore = QUALITY_WEIGHTS.emaAlignment;
            score += emaScore;
            details.push(`📊 EMA 3m: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (alinhamento ${isBullish ? 'bullish' : 'bearish'})`);
        } else {
            failedChecks.push(`EMA 3m: Alinhamento incorreto`);
        }
    }
    
    if (marketData.stoch && marketData.stoch.isValid) {
        const stochScore = QUALITY_WEIGHTS.stoch1h;
        score += stochScore;
        details.push(`📊 Stoch 1h: ${stochScore}/${QUALITY_WEIGHTS.stoch1h} (cruzamento confirmado)`);
    } else {
        failedChecks.push(`Stoch 1h: Sem cruzamento`);
    }
    
    // NOVO: STOCHASTIC 4H
    if (marketData.stoch4h && marketData.stoch4h.isValid) {
        const stoch4hScore = QUALITY_WEIGHTS.stoch4h;
        score += stoch4hScore;
        details.push(`📊 Stoch 4h: ${stoch4hScore}/${QUALITY_WEIGHTS.stoch4h} (cruzamento ${isBullish ? 'bullish' : 'bearish'} confirmado)`);
    } else {
        failedChecks.push(`Stoch 4h: Sem cruzamento ${isBullish ? 'bullish' : 'bearish'} no 4h`);
    }
    
    // NOVO: CCI 4H
    if (marketData.cci4h && marketData.cci4h.isValid) {
        const cci4hScore = QUALITY_WEIGHTS.cci4h;
        score += cci4hScore;
        const deviation = marketData.cci4h.deviation.toFixed(2);
        details.push(`📈 CCI 4h: ${cci4hScore}/${QUALITY_WEIGHTS.cci4h} (${marketData.cci4h.value.toFixed(2)} ${isBullish ? '>' : '<'} ${marketData.cci4h.maValue.toFixed(2)} MMS, dev: ${deviation})`);
    } else {
        failedChecks.push(`CCI 4h: ${marketData.cci4h?.value?.toFixed(2) || 0} ${isBullish ? '≤' : '≥'} ${marketData.cci4h?.maValue?.toFixed(2) || 0} MMS`);
    }
    
    if (marketData.oi && marketData.oi.isValid) {
        const oiScore = QUALITY_WEIGHTS.oi;
        score += oiScore;
        details.push(`📊 OI: ${oiScore}/${QUALITY_WEIGHTS.oi} (${marketData.oi.trend} tendência)`);
    } else {
        failedChecks.push(`OI: Tendência ${marketData.oi?.trend || 'indefinida'} não confirma`);
    }
    
    if (marketData.funding && marketData.funding.isValid) {
        score += 5;
        details.push(`💰 Funding: +5/${5} (${(marketData.funding.raw * 100).toFixed(4)}% ${isBullish ? 'negativo' : 'positivo'})`);
    }
    
    let grade, emoji;
    if (score >= 85) {
        grade = "A✨";
        emoji = "🏆";
    } else if (score >= 70) {
        grade = "B";
        emoji = "✅";
    } else if (score >= QUALITY_THRESHOLD) {
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
        message: `${emoji} Score: ${grade} (${Math.round(score)}/100)`
    };
}

async function calculateTargetsAndStop(price, isBullish, symbol) {
    try {
        const candles = await getCandlesCached(symbol, ATR_TIMEFRAME, ATR_PERIOD + 10);
        if (candles.length < ATR_PERIOD) {
            return getDefaultTargets(price, isBullish);
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
            return getDefaultTargets(price, isBullish);
        }
        
        const latestATR = atrValues[atrValues.length - 1];
        const atrPercentage = (latestATR / price) * 100;
        const adjustedATR = Math.max(2.5, Math.min(8.0, atrPercentage));
        
        const stopDistance = adjustedATR * ATR_MULTIPLIER;
        const stopPrice = isBullish ? 
            price * (1 - stopDistance / 100) : 
            price * (1 + stopDistance / 100);
        
        const targets = TARGET_PERCENTAGES.map(percent => {
            const targetPrice = isBullish ? 
                price * (1 + percent / 100) : 
                price * (1 - percent / 100);
            
            const riskReward = percent / stopDistance;
            
            return {
                target: percent.toFixed(1),
                price: targetPrice.toFixed(4),
                riskReward: riskReward.toFixed(2)
            };
        });
        
        const validTargets = targets.filter(t => parseFloat(t.riskReward) >= 1.5);
        const bestTarget = validTargets.length > 0 ? 
            validTargets.reduce((a, b) => parseFloat(a.riskReward) > parseFloat(b.riskReward) ? a : b) : 
            targets[0];
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopDistance.toFixed(2),
            targets: targets,
            bestRiskReward: parseFloat(bestTarget.riskReward).toFixed(2),
            atrValue: latestATR.toFixed(4)
        };
        
    } catch (error) {
        return getDefaultTargets(price, isBullish);
    }
}

function getDefaultTargets(price, isBullish) {
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
    
    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        targets: targets,
        bestRiskReward: (8.0 / stopPercentage).toFixed(2)
    };
}

// =====================================================================
// 🔄 MONITORAMENTO PRINCIPAL COM DELAY ADAPTATIVO
// =====================================================================

class AdaptiveSymbolGroupManager {
    constructor() {
        this.symbolGroups = [];
        this.currentGroupIndex = 0;
        this.totalCycles = 0;
        this.groupSize = 25;
        this.signalsDetected = 0;
        this.baseDelay = 8000;
        this.minDelay = 4000;
        this.maxDelay = 15000;
        this.consecutiveNoSignals = 0;
    }
    
    async initializeSymbols() {
        try {
            const allSymbols = await fetchAllFuturesSymbols();
            
            const filteredSymbols = allSymbols.filter(symbol => {
                const blacklist = ['1000', 'BULL', 'BEAR', 'UP', 'DOWN', 'MOVR'];
                return !blacklist.some(term => symbol.includes(term));
            });
            
            this.symbolGroups = this.createGroups(filteredSymbols, this.groupSize);
            
            console.log(`📊 ${filteredSymbols.length} ativos divididos em ${this.symbolGroups.length} grupos`);
            
            return filteredSymbols;
            
        } catch (error) {
            console.error('Erro ao inicializar símbolos:', error.message);
            return [];
        }
    }
    
    createGroups(symbols, groupSize) {
        const groups = [];
        for (let i = 0; i < symbols.length; i += groupSize) {
            groups.push(symbols.slice(i, i + groupSize));
        }
        return groups;
    }
    
    getNextGroup() {
        const group = this.symbolGroups[this.currentGroupIndex];
        this.currentGroupIndex = (this.currentGroupIndex + 1) % this.symbolGroups.length;
        
        if (this.currentGroupIndex === 0) {
            this.totalCycles++;
            
            this.adjustDelayBasedOnUsage();
            
            if (this.totalCycles % 5 === 0) {
                return { symbols: [], pause: 30000 };
            }
        }
        
        return { symbols: group, pause: 0 };
    }
    
    adjustDelayBasedOnUsage() {
        if (this.consecutiveNoSignals > 3) {
            this.baseDelay = Math.max(this.minDelay, this.baseDelay * 0.8);
            console.log(`⚡ Reduzindo delay para ${this.baseDelay}ms (poucos sinais)`);
            this.consecutiveNoSignals = 0;
        }
        
        if (this.signalsDetected > 0) {
            this.consecutiveNoSignals = 0;
        }
    }
    
    getCurrentDelay() {
        return this.baseDelay;
    }
    
    getCurrentStatus() {
        return {
            totalGroups: this.symbolGroups.length,
            currentGroup: this.currentGroupIndex,
            totalCycles: this.totalCycles,
            signalsDetected: this.signalsDetected,
            currentDelay: this.baseDelay,
            consecutiveNoSignals: this.consecutiveNoSignals
        };
    }
}

async function monitorSymbol(symbol) {
    try {
        const emaData = await getEMAs3m(symbol);
        if (!emaData) return null;
        
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) return null;
        
        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;
        
        if (!isBullish && !isBearish) return null;
        
        // ALTERADO: RSI < 60 para compra, > 60 para venda
        if (isBullish && rsiData.value >= 60) return null;      // RSI ≥ 60 não é bom para compra
        if (isBearish && rsiData.value <= 60) return null;      // RSI ≤ 60 não é bom para venda
        
        // ADICIONADOS NOVOS INDICADORES: Stochastic 4h e CCI 4h
        const [volumeData, volatilityData, lsrData, adx1hData, stochData, stoch4hData, cci4hData, oiData, fundingData] = await Promise.all([
            checkVolume(symbol),      // AGORA EM 3m
            checkVolatility(symbol),  // MANTIDO EM 15m
            checkLSR(symbol, isBullish),
            getADX1h(symbol),
            checkStochastic(symbol, isBullish),
            checkStochastic4h(symbol, isBullish),  // NOVO: Stochastic 4h
            checkCCI4h(symbol, isBullish),         // NOVO: CCI 4h
            checkOpenInterest(symbol, isBullish),
            checkFundingRate(symbol, isBullish)
        ]);
        
        if (!adx1hData || !adx1hData.hasMinimumStrength) return null;
        
        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            adx1h: adx1hData,
            stoch: stochData,
            stoch4h: stoch4hData,  // NOVO
            cci4h: cci4hData,      // NOVO
            oi: oiData,
            funding: fundingData,
            ema: {
                isAboveEMA55: emaData.isAboveEMA55,
                isEMA13CrossingUp: emaData.isEMA13CrossingUp,
                isEMA13CrossingDown: emaData.isEMA13CrossingDown
            }
        };
        
        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);
        
        if (!qualityScore.isAcceptable) return null;
        
        const targetsData = await calculateTargetsAndStop(emaData.currentPrice, isBullish, symbol);
        
        const signal = {
            symbol: symbol,
            isBullish: isBullish,
            price: emaData.currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            timestamp: Date.now()
        };
        
        if (learningSystem) {
            await learningSystem.recordSignal(signal, marketData);
        }
        
        console.log(`✅ ${symbol}: ${isBullish ? 'COMPRA' : 'VENDA'} (Score: ${qualityScore.score} ${qualityScore.grade})`);
        
        return signal;
        
    } catch (error) {
        return null;
    }
}

async function processSymbolGroup(symbols) {
    const results = [];
    
    for (const symbol of symbols) {
        try {
            await new Promise(r => setTimeout(r, 200));
            const signal = await monitorSymbol(symbol);
            if (signal) results.push(signal);
        } catch (error) {
            continue;
        }
    }
    
    return results;
}

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

async function sendSignalAlert(signal) {
    try {
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '📈' : '📉';
        
        // Mensagem atualizada com os novos indicadores
        const message = `
${directionEmoji} <b>SINAL DE ${direction} DETECTADO - ${signal.symbol}</b>

💰 <b>Preço Atual:</b> $${signal.price.toFixed(4)}
🎯 <b>Qualidade:</b> ${signal.qualityScore.grade} (${signal.qualityScore.score}/100)

📊 <b>Indicadores:</b>
${signal.qualityScore.details.join('\n')}

🛑 <b>Stop Loss:</b> ${signal.targetsData.stopPercentage}%
🎯 <b>Melhor Risk/Reward:</b> ${signal.targetsData.bestRiskReward}:1

🎯 <b>Alvos Sugeridos:</b>
${signal.targetsData.targets.slice(0, 3).map((target, index) => 
    `• Target ${index + 1}: $${target.price} (${target.target}%) | R/R: ${target.riskReward}:1`
).join('\n')}

📅 <b>Horário BR:</b> ${getBrazilianDateTime().full}
🧠 <b>Sistema com Aprendizado Automático</b>
📈 <b>Indicadores 4h Ativos:</b> Stochastic e CCI

⚠️ <b>Gestão de Risco:</b>
• Sempre use stop loss
• Gerenciar alvos progressivamente
• Ajustar tamanho da posição

${LIVE_MODE ? '🚀 **MODO REAL ATIVO**' : '🧪 **MODO DRY-RUN (TESTE)**'}
🔔 by @J4Rviz.
        `;
        
        await sendTelegramAlert(message, !LIVE_MODE);
        
        console.log(`📤 ${LIVE_MODE ? 'Alerta REAL enviado' : 'Alerta DRY-RUN'}: ${signal.symbol} ${direction}`);
        
    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

// =====================================================================
// 🚀 LOOP PRINCIPAL DO BOT
// =====================================================================

async function checkInternetConnection() {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping', {
            signal: AbortSignal.timeout(5000)
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function mainBotLoop() {
    const symbolManager = new AdaptiveSymbolGroupManager();
    
    const allSymbols = await symbolManager.initializeSymbols();
    
    if (allSymbols.length === 0) {
        console.log('❌ Não foi possível carregar símbolos.');
        return;
    }
    
    console.log(`\n🚀 ${LIVE_MODE ? 'MODO REAL ATIVADO' : 'MODO DRY-RUN (TESTE)'}`);
    console.log(`📊 ${allSymbols.length} ativos Binance Futures`);
    console.log(`🧠 Sistema de Aprendizado Avançado`);
    console.log(`⚡ Rate Limiter Adaptativo`);
    console.log(`📈 Indicadores 4h: Stochastic e CCI ATIVOS`);
    
    // ENVIAR MENSAGEM DE INICIALIZAÇÃO
    await sendInitializationMessage(allSymbols);
    
    let consecutiveErrors = 0;
    let totalSignals = 0;
    let lastReportTime = Date.now();
    
    while (true) {
        try {
            const groupInfo = symbolManager.getNextGroup();
            
            if (groupInfo.pause > 0) {
                console.log(`⏸️  Pausa estratégica de ${groupInfo.pause/1000}s...`);
                await new Promise(r => setTimeout(r, groupInfo.pause));
                continue;
            }
            
            const currentSymbols = groupInfo.symbols;
            if (currentSymbols.length === 0) continue;
            
            console.log(`\n🔄 Ciclo ${symbolManager.totalCycles}, Grupo ${symbolManager.currentGroupIndex}/${symbolManager.symbolGroups.length}`);
            console.log(`📊 ${currentSymbols.length} ativos | Delay: ${symbolManager.getCurrentDelay()}ms`);
            
            if (!await checkInternetConnection()) {
                console.log('🌐 Sem conexão. Aguardando 30s...');
                await new Promise(r => setTimeout(r, 30000));
                continue;
            }
            
            const startTime = Date.now();
            const signals = await processSymbolGroup(currentSymbols);
            const endTime = Date.now();
            
            totalSignals += signals.length;
            symbolManager.signalsDetected += signals.length;
            
            if (signals.length === 0) {
                symbolManager.consecutiveNoSignals++;
            } else {
                symbolManager.consecutiveNoSignals = 0;
            }
            
            console.log(`✅ ${((endTime - startTime) / 1000).toFixed(1)}s | Sinais: ${signals.length} (Total: ${totalSignals})`);
            
            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    await sendSignalAlert(signal);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            
            cleanupCaches();
            
            if (Date.now() - lastReportTime >= 3600000) {
                await learningSystem.sendPerformanceReport();
                lastReportTime = Date.now();
            }
            
            const status = symbolManager.getCurrentStatus();
            console.log(`📊 Progresso: ${status.consecutiveNoSignals} grupos sem sinais`);
            
            consecutiveErrors = 0;
            
            const delay = symbolManager.getCurrentDelay();
            console.log(`⏱️  Próximo grupo em ${delay/1000}s...\n`);
            await new Promise(r => setTimeout(r, delay));
            
        } catch (error) {
            consecutiveErrors++;
            console.error(`❌ Erro (${consecutiveErrors}):`, error.message);
            
            if (consecutiveErrors >= 3) {
                console.log('🔄 Muitos erros. Pausa de 60s...');
                await new Promise(r => setTimeout(r, 60000));
                consecutiveErrors = 0;
            }
            
            await new Promise(r => setTimeout(r, Math.min(10000 * consecutiveErrors, 60000)));
        }
    }
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(80));
        console.log('🚀 BINANCE FUTURES BOT 10/10 - VERSÃO PERFEITA');
        console.log('🧠 Sistema de Aprendizado Avançado com Trade Tracking');
        console.log('⚡ Rate Limiter Adaptativo com Delay Inteligente');
        console.log('📊 Monitoramento Completo (LSR + Volatilidade)');
        console.log('📈 NOVO: Stochastic 4h e CCI 4h adicionados');
        console.log('🎯 ' + (LIVE_MODE ? 'MODO REAL ATIVADO' : 'MODO DRY-RUN ATIVADO'));
        console.log('='.repeat(80) + '\n');
        
        try {
            require('technicalindicators');
        } catch (error) {
            console.log('❌ Execute: npm install technicalindicators');
            process.exit(1);
        }
        
        console.log('🔍 Verificando conexão...');
        let connected = false;
        for (let i = 0; i < 3; i++) {
            if (await checkInternetConnection()) {
                connected = true;
                break;
            }
            await new Promise(r => setTimeout(r, 5000));
        }
        
        if (!connected) {
            console.log('❌ Sem conexão com a Binance');
            process.exit(1);
        }
        
        console.log('✅ Tudo pronto! Iniciando monitoramento...');
        
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 120 segundos...');
        await new Promise(r => setTimeout(r, 120000));
        await startBot();
    }
}

// Iniciar
startBot();
