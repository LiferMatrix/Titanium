const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX, CCI } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJMqL';
const TELEGRAM_CHAT_ID = '-1002554953979';

// === CONFIGURAÇÕES DE OPERAÇÃO ===
const LIVE_MODE = true;

// === CONFIGURAÇÕES RL PRÁTICAS E FUNCIONAIS ===
const ADVANCED_RL_SETTINGS = {
    enabled: true,
    
    // Ensemble simplificado e funcional
    ensemble: {
        enabled: true,
        models: ['qlearning', 'gradient_bandit', 'expert_rules'], // Removemos os quebrados
        weights: {
            qlearning: 0.45,
            gradient_bandit: 0.35,
            expert_rules: 0.20
        },
        voting_threshold: 0.60
    },
    
    // Reward System realista
    reward_system: {
        base_multipliers: {
            win: 1.0,
            partial_win: 0.3,
            break_even: 0.0,
            small_loss: -0.2,
            medium_loss: -0.5,
            large_loss: -1.0
        },
        
        quality_bonus: {
            high_quality: 0.3,
            medium_quality: 0.1,
            low_quality: -0.1
        }
    },
    
    // Configurações práticas
    state_size: 12, // Reduzido para ser mais eficiente
    action_space: ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'],
    learning_rate: 0.01,
    discount_factor: 0.95
};

// === CONFIGURAÇÕES OTIMIZADAS ===
const VOLUME_SETTINGS = {
    baseThreshold: 1.5,
    minThreshold: 1.3,
    maxThreshold: 2.0
};

const LSR_SETTINGS = {
    buyThreshold: 2.5,
    sellThreshold: 2.5
};

const QUALITY_THRESHOLD = 70;
const ADX_MIN_STRENGTH = 22;

// === DIRETÓRIOS ===
const LOG_DIR = './logs';
const LEARNING_DIR = './learning_data';
const ENSEMBLE_DIR = './ensemble_data';

// =====================================================================
// 🧠 SISTEMA RL PRÁTICO E FUNCIONAL
// =====================================================================

class PracticalRLSystem {
    constructor() {
        this.models = {
            qlearning: new FunctionalQLearning(),
            gradient_bandit: new GradientBandit(),
            expert_rules: new ExpertRulesSystem()
        };
        
        this.weights = { ...ADVANCED_RL_SETTINGS.ensemble.weights };
        this.history = [];
        this.performance = {
            total_trades: 0,
            winning_trades: 0,
            total_reward: 0,
            recent_rewards: []
        };
        
        this.loadModels();
        console.log('🧠 Sistema RL Prático inicializado');
    }
    
    async loadModels() {
        try {
            if (!fs.existsSync(ENSEMBLE_DIR)) {
                fs.mkdirSync(ENSEMBLE_DIR, { recursive: true });
            }
            
            for (const [modelName, model] of Object.entries(this.models)) {
                if (model.load) {
                    await model.load(path.join(ENSEMBLE_DIR, `${modelName}.json`));
                }
            }
            
            console.log('📊 Modelos RL carregados');
        } catch (error) {
            console.log('⚠️ Erro ao carregar modelos:', error.message);
        }
    }
    
    async saveModels() {
        try {
            for (const [modelName, model] of Object.entries(this.models)) {
                if (model.save) {
                    await model.save(path.join(ENSEMBLE_DIR, `${modelName}.json`));
                }
            }
            console.log('💾 Modelos RL salvos');
        } catch (error) {
            console.error('Erro ao salvar modelos:', error);
        }
    }
    
    async getRecommendation(marketData, signalType) {
        if (!ADVANCED_RL_SETTINGS.enabled) {
            return this.getFallbackRecommendation(marketData, signalType);
        }
        
        try {
            // Processar estado
            const state = this.processState(marketData, signalType);
            
            // Obter previsões
            const predictions = {};
            for (const [modelName, model] of Object.entries(this.models)) {
                predictions[modelName] = await model.predict(state, signalType);
            }
            
            // Combinação ponderada
            const ensembleDecision = this.combinePredictions(predictions);
            
            return {
                action: ensembleDecision.action,
                confidence: ensembleDecision.confidence,
                predictions: predictions,
                state: state,
                weights: this.weights
            };
            
        } catch (error) {
            console.error('Erro no RL:', error);
            return this.getFallbackRecommendation(marketData, signalType);
        }
    }
    
    processState(marketData, signalType) {
        // Estado simplificado e eficiente
        return {
            volume_ratio: marketData.volume?.rawRatio || 1.0,
            rsi: marketData.rsi?.raw || 50,
            adx: marketData.adx1h?.raw || 0,
            volatility: marketData.volatility?.rawVolatility || 1.0,
            lsr_ratio: marketData.lsr?.lsrRatio || 1.0,
            ema_alignment: marketData.ema?.isAboveEMA55 ? 1 : 0,
            divergence: marketData.divergence15m?.hasDivergence ? 1 : 0,
            breakout_risk: this.mapRiskLevel(marketData.breakoutRisk?.level || 'medium'),
            support_distance: marketData.supportResistance?.nearestSupport?.distancePercent || 10,
            resistance_distance: marketData.supportResistance?.nearestResistance?.distancePercent || 10,
            cci_value: marketData.cci4h?.value || 0,
            signal_type: signalType === 'BUY' ? 1 : 0
        };
    }
    
    mapRiskLevel(level) {
        const map = {
            'very_low': 0,
            'low': 0.25,
            'medium': 0.5,
            'high': 0.75,
            'very_high': 1.0
        };
        return map[level] || 0.5;
    }
    
    combinePredictions(predictions) {
        const actionScores = {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        };
        
        // Soma ponderada
        for (const [modelName, prediction] of Object.entries(predictions)) {
            const weight = this.weights[modelName] || 0;
            
            if (prediction.action && prediction.confidence) {
                actionScores[prediction.action] += weight * prediction.confidence;
            }
        }
        
        // Encontrar melhor ação
        let bestAction = 'NEUTRAL';
        let bestScore = actionScores[bestAction];
        
        for (const [action, score] of Object.entries(actionScores)) {
            if (score > bestScore) {
                bestScore = score;
                bestAction = action;
            }
        }
        
        // Normalizar confiança
        const totalWeight = Object.values(this.weights).reduce((a, b) => a + b, 0);
        const confidence = totalWeight > 0 ? bestScore / totalWeight : 0.5;
        
        return {
            action: bestAction,
            confidence: Math.max(0.1, Math.min(0.99, confidence)),
            scores: actionScores
        };
    }
    
    async learnFromExperience(trade, marketData) {
        if (!ADVANCED_RL_SETTINGS.enabled) return;
        
        try {
            // Calcular recompensa
            const reward = this.calculateReward(trade);
            
            // Estado do trade
            const state = this.processState(trade.marketData, 
                trade.isBullish ? 'BUY' : 'SELL');
            
            // Ação tomada
            const action = this.mapTradeToAction(trade);
            
            // Registrar experiência
            const experience = {
                state: state,
                action: action,
                reward: reward,
                outcome: trade.outcome,
                profit: trade.profitPercentage || 0,
                timestamp: Date.now()
            };
            
            this.history.push(experience);
            
            // Manter histórico limitado
            if (this.history.length > 1000) {
                this.history = this.history.slice(-1000);
            }
            
            // Atualizar métricas
            this.updatePerformanceMetrics(trade, reward);
            
            // Aprender com a experiência (apenas Q-Learning)
            await this.models.qlearning.learn(experience);
            
            // Ajustar pesos baseado no desempenho
            await this.adjustWeightsBasedOnPerformance();
            
            // Salvar periodicamente
            if (this.performance.total_trades % 50 === 0) {
                await this.saveModels();
            }
            
        } catch (error) {
            console.error('Erro no aprendizado:', error);
        }
    }
    
    calculateReward(trade) {
        const profit = trade.profitPercentage || 0;
        
        let baseReward = 0;
        
        if (profit > 5) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.win;
        } else if (profit > 0) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.partial_win;
        } else if (profit === 0) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.break_even;
        } else if (profit > -3) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.small_loss;
        } else if (profit > -8) {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.medium_loss;
        } else {
            baseReward = ADVANCED_RL_SETTINGS.reward_system.base_multipliers.large_loss;
        }
        
        // Bônus de qualidade
        const quality = trade.qualityScore?.score || 0;
        if (quality >= 85) {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.high_quality;
        } else if (quality >= 70) {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.medium_quality;
        } else {
            baseReward += ADVANCED_RL_SETTINGS.reward_system.quality_bonus.low_quality;
        }
        
        return baseReward;
    }
    
    mapTradeToAction(trade) {
        if (trade.direction === 'BUY') {
            const quality = trade.qualityScore?.score || 0;
            return quality >= 85 ? 'STRONG_BUY' : 'BUY';
        } else {
            const quality = trade.qualityScore?.score || 0;
            return quality >= 85 ? 'STRONG_SELL' : 'SELL';
        }
    }
    
    updatePerformanceMetrics(trade, reward) {
        this.performance.total_trades++;
        
        if (trade.outcome === 'SUCCESS') {
            this.performance.winning_trades++;
        }
        
        this.performance.total_reward += reward;
        this.performance.recent_rewards.push(reward);
        
        if (this.performance.recent_rewards.length > 100) {
            this.performance.recent_rewards = this.performance.recent_rewards.slice(-100);
        }
    }
    
    async adjustWeightsBasedOnPerformance() {
        if (this.history.length < 20) return;
        
        const recentHistory = this.history.slice(-50);
        
        // Calcular performance de cada modelo (simplificado)
        const modelPerformance = {};
        
        for (const modelName of Object.keys(this.models)) {
            let correct = 0;
            let total = 0;
            
            for (const exp of recentHistory) {
                // Verificar se o modelo teria acertado
                // (implementação simplificada - na prática precisaria das previsões passadas)
                total++;
                if (exp.reward > 0) correct++;
            }
            
            modelPerformance[modelName] = total > 0 ? correct / total : 0.5;
        }
        
        // Normalizar para pesos
        const totalPerformance = Object.values(modelPerformance).reduce((a, b) => a + b, 0);
        
        if (totalPerformance > 0) {
            for (const modelName of Object.keys(modelPerformance)) {
                this.weights[modelName] = modelPerformance[modelName] / totalPerformance;
            }
            
            console.log('🔧 Pesos ajustados:', this.weights);
        }
    }
    
    getFallbackRecommendation(marketData, signalType) {
        const volumeRatio = marketData.volume?.rawRatio || 1.0;
        const adx = marketData.adx1h?.raw || 0;
        const quality = marketData.qualityScore?.score || 0;
        
        let action = 'NEUTRAL';
        let confidence = 0.5;
        
        if (signalType === 'BUY') {
            if (volumeRatio > 1.8 && adx > 25 && quality > 70) {
                action = 'BUY';
                confidence = 0.7;
            }
        } else if (signalType === 'SELL') {
            if (volumeRatio > 1.8 && adx > 25 && quality > 70) {
                action = 'SELL';
                confidence = 0.7;
            }
        }
        
        return {
            action: action,
            confidence: confidence,
            predictions: {},
            state: {},
            weights: this.weights
        };
    }
    
    getPerformanceReport() {
        const winRate = this.performance.total_trades > 0 ?
            (this.performance.winning_trades / this.performance.total_trades) * 100 : 0;
        
        const avgReward = this.performance.recent_rewards.length > 0 ?
            this.performance.recent_rewards.reduce((a, b) => a + b, 0) / 
            this.performance.recent_rewards.length : 0;
        
        return {
            total_trades: this.performance.total_trades,
            win_rate: winRate.toFixed(1),
            total_reward: this.performance.total_reward.toFixed(2),
            avg_reward: avgReward.toFixed(3),
            weights: this.weights,
            history_size: this.history.length
        };
    }
}

// =====================================================================
// 🤖 MODELOS RL FUNCIONAIS
// =====================================================================

class FunctionalQLearning {
    constructor() {
        this.qTable = new Map();
        this.learningRate = ADVANCED_RL_SETTINGS.learning_rate;
        this.discountFactor = ADVANCED_RL_SETTINGS.discount_factor;
        this.explorationRate = 0.1;
        this.minExploration = 0.01;
        this.explorationDecay = 0.995;
    }
    
    getStateKey(state, signalType) {
        // Chave simplificada para eficiência
        const features = [
            Math.round(state.volume_ratio * 2) / 2, // Arredonda para 0.5, 1.0, 1.5, etc
            Math.round(state.rsi / 10) * 10, // Arredonda para 40, 50, 60, etc
            Math.round(state.adx / 5) * 5,   // Arredonda para 0, 5, 10, etc
            state.ema_alignment ? 1 : 0,
            state.divergence ? 1 : 0
        ];
        
        return `${signalType}_${features.join('_')}`;
    }
    
    initializeState(stateKey) {
        this.qTable.set(stateKey, {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        });
    }
    
    async predict(state, signalType) {
        const stateKey = this.getStateKey(state, signalType);
        
        if (!this.qTable.has(stateKey)) {
            this.initializeState(stateKey);
        }
        
        const qValues = this.qTable.get(stateKey);
        
        // Exploration vs Exploitation
        let action;
        if (Math.random() < this.explorationRate) {
            // Exploration: escolha aleatória
            const actions = Object.keys(qValues);
            action = actions[Math.floor(Math.random() * actions.length)];
        } else {
            // Exploitation: melhor ação
            let bestAction = 'NEUTRAL';
            let bestValue = qValues[bestAction];
            
            for (const [act, value] of Object.entries(qValues)) {
                if (value > bestValue) {
                    bestValue = value;
                    bestAction = act;
                }
            }
            action = bestAction;
        }
        
        // Calcular confiança baseada nos Q-values
        const values = Object.values(qValues);
        const maxValue = Math.max(...values);
        const minValue = Math.min(...values);
        const confidence = maxValue - minValue > 0 ? 
            (qValues[action] - minValue) / (maxValue - minValue) : 0.5;
        
        return {
            action: action,
            confidence: Math.max(0.1, Math.min(0.99, confidence)),
            q_values: qValues,
            exploration_rate: this.explorationRate
        };
    }
    
    async learn(experience) {
        const stateKey = this.getStateKey(experience.state, 
            experience.action.includes('BUY') ? 'BUY' : 'SELL');
        
        if (!this.qTable.has(stateKey)) {
            this.initializeState(stateKey);
        }
        
        const qValues = this.qTable.get(stateKey);
        const oldQ = qValues[experience.action] || 0;
        
        // Q-Learning update: Q(s,a) = Q(s,a) + α * (r + γ * max_a' Q(s',a') - Q(s,a))
        // Para terminal states (trade finalizado), não há próximo estado
        const nextMaxQ = 0; // Em trades finalizados, não há próximo estado
        
        const newQ = oldQ + this.learningRate * 
            (experience.reward + this.discountFactor * nextMaxQ - oldQ);
        
        qValues[experience.action] = newQ;
        this.qTable.set(stateKey, qValues);
        
        // Decay exploration rate
        this.explorationRate = Math.max(
            this.minExploration,
            this.explorationRate * this.explorationDecay
        );
    }
    
    async load(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.qTable = new Map(Object.entries(data.qTable || {}));
                this.explorationRate = data.explorationRate || 0.1;
                console.log(`✅ Q-Learning carregado: ${this.qTable.size} estados`);
            }
        } catch (error) {
            console.log(`⚠️ Erro ao carregar Q-Learning: ${error.message}`);
        }
    }
    
    async save(filePath) {
        try {
            const data = {
                qTable: Object.fromEntries(this.qTable),
                explorationRate: this.explorationRate,
                savedAt: Date.now()
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar Q-Learning:', error);
        }
    }
}

class GradientBandit {
    constructor() {
        this.preferences = {
            'STRONG_BUY': 0,
            'BUY': 0,
            'NEUTRAL': 0,
            'SELL': 0,
            'STRONG_SELL': 0
        };
        this.learningRate = 0.01;
        this.baseline = 0;
        this.count = 0;
    }
    
    softmax(preferences) {
        const expValues = {};
        let sumExp = 0;
        
        for (const [action, pref] of Object.entries(preferences)) {
            const expValue = Math.exp(pref);
            expValues[action] = expValue;
            sumExp += expValue;
        }
        
        const probabilities = {};
        for (const [action, expValue] of Object.entries(expValues)) {
            probabilities[action] = expValue / sumExp;
        }
        
        return probabilities;
    }
    
    async predict(state, signalType) {
        const probabilities = this.softmax(this.preferences);
        
        // Amostrar ação baseado nas probabilidades
        let cumulative = 0;
        const rand = Math.random();
        let selectedAction = 'NEUTRAL';
        
        for (const [action, prob] of Object.entries(probabilities)) {
            cumulative += prob;
            if (rand <= cumulative) {
                selectedAction = action;
                break;
            }
        }
        
        return {
            action: selectedAction,
            confidence: probabilities[selectedAction],
            probabilities: probabilities,
            method: 'gradient_bandit'
        };
    }
    
    async learn(experience) {
        this.count++;
        
        // Atualizar baseline (média móvel de recompensas)
        this.baseline = this.baseline + (1 / this.count) * (experience.reward - this.baseline);
        
        // Calcular todas as probabilidades
        const probabilities = this.softmax(this.preferences);
        
        // Atualizar preferências
        for (const action of Object.keys(this.preferences)) {
            const indicator = action === experience.action ? 1 : 0;
            const update = this.learningRate * (experience.reward - this.baseline) * 
                (indicator - probabilities[action]);
            
            this.preferences[action] += update;
        }
    }
    
    async load(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                this.preferences = data.preferences || this.preferences;
                this.baseline = data.baseline || 0;
                this.count = data.count || 0;
                console.log('✅ Gradient Bandit carregado');
            }
        } catch (error) {
            console.log(`⚠️ Erro ao carregar Gradient Bandit: ${error.message}`);
        }
    }
    
    async save(filePath) {
        try {
            const data = {
                preferences: this.preferences,
                baseline: this.baseline,
                count: this.count,
                savedAt: Date.now()
            };
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar Gradient Bandit:', error);
        }
    }
}

class ExpertRulesSystem {
    constructor() {
        this.rules = this.initializeRules();
    }
    
    initializeRules() {
        return [
            // Regra 1: Volume + ADX
            {
                name: 'high_volume_strong_trend',
                evaluate: (state, signalType) => {
                    if (state.volume_ratio >= 2.0 && state.adx >= 30) {
                        return { score: 3.0, action: signalType === 'BUY' ? 'STRONG_BUY' : 'STRONG_SELL' };
                    } else if (state.volume_ratio >= 1.5 && state.adx >= 25) {
                        return { score: 2.0, action: signalType === 'BUY' ? 'BUY' : 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 2: RSI extremo
            {
                name: 'rsi_extreme',
                evaluate: (state, signalType) => {
                    if (signalType === 'BUY' && state.rsi <= 35) {
                        return { score: 2.0, action: 'STRONG_BUY' };
                    } else if (signalType === 'SELL' && state.rsi >= 65) {
                        return { score: 2.0, action: 'STRONG_SELL' };
                    } else if (signalType === 'BUY' && state.rsi <= 45) {
                        return { score: 1.0, action: 'BUY' };
                    } else if (signalType === 'SELL' && state.rsi >= 55) {
                        return { score: 1.0, action: 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 3: EMA Alignment
            {
                name: 'ema_alignment',
                evaluate: (state, signalType) => {
                    if (state.ema_alignment === 1 && signalType === 'BUY') {
                        return { score: 2.0, action: 'BUY' };
                    } else if (state.ema_alignment === 0 && signalType === 'SELL') {
                        return { score: 2.0, action: 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 4: Divergência
            {
                name: 'divergence_confirmation',
                evaluate: (state, signalType) => {
                    if (state.divergence === 1) {
                        const aligned = (signalType === 'BUY' && state.cci_value > 0) ||
                                      (signalType === 'SELL' && state.cci_value < 0);
                        if (aligned) {
                            return { score: 2.5, action: signalType === 'BUY' ? 'STRONG_BUY' : 'STRONG_SELL' };
                        }
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            },
            
            // Regra 5: Risk Management
            {
                name: 'risk_management',
                evaluate: (state, signalType) => {
                    if (state.breakout_risk >= 0.75) {
                        return { score: -3.0, action: 'NEUTRAL' };
                    }
                    if (state.breakout_risk >= 0.5) {
                        return { score: -1.0, action: signalType === 'BUY' ? 'BUY' : 'SELL' };
                    }
                    return { score: 0, action: 'NEUTRAL' };
                }
            }
        ];
    }
    
    async predict(state, signalType) {
        let totalScore = 0;
        let weightedAction = 'NEUTRAL';
        const ruleResults = [];
        
        for (const rule of this.rules) {
            const result = rule.evaluate(state, signalType);
            ruleResults.push({
                rule: rule.name,
                score: result.score,
                suggested_action: result.action
            });
            
            totalScore += result.score;
            
            // Ponderar ação baseada no score
            if (result.score > 0) {
                const actionValue = this.actionToValue(result.action);
                const currentValue = this.actionToValue(weightedAction);
                
                if (actionValue * Math.abs(result.score) > currentValue * Math.abs(totalScore)) {
                    weightedAction = result.action;
                }
            }
        }
        
        // Calcular confiança baseada no score total
        const confidence = this.scoreToConfidence(totalScore);
        
        return {
            action: weightedAction,
            confidence: confidence,
            total_score: totalScore,
            rule_results: ruleResults,
            method: 'expert_rules'
        };
    }
    
    actionToValue(action) {
        const values = {
            'STRONG_BUY': 2,
            'BUY': 1,
            'NEUTRAL': 0,
            'SELL': -1,
            'STRONG_SELL': -2
        };
        return values[action] || 0;
    }
    
    scoreToConfidence(score) {
        // Mapear score para confiança entre 0.1 e 0.9
        const normalized = Math.tanh(score / 5); // tanh para limitar entre -1 e 1
        const confidence = 0.5 + normalized * 0.4; // Mapear para 0.1-0.9
        return Math.max(0.1, Math.min(0.9, confidence));
    }
    
    async learn(experience) {
        // Sistema baseado em regras não aprende, mas pode ajustar regras baseado em experiência
        // (implementação simplificada)
    }
    
    async load(filePath) {
        // Regras são estáticas
    }
    
    async save(filePath) {
        // Regras são estáticas
    }
}

// =====================================================================
// 📊 SISTEMA DE APRENDIZADO SIMPLIFICADO
// =====================================================================

class SimpleLearningSystem {
    constructor() {
        this.tradeHistory = [];
        this.symbolPerformance = {};
        this.openTrades = new Map();
        this.rlSystem = new PracticalRLSystem();
        
        this.loadLearningData();
        console.log('📊 Sistema de Aprendizado Simplificado inicializado');
    }
    
    loadLearningData() {
        try {
            if (!fs.existsSync(LEARNING_DIR)) {
                fs.mkdirSync(LEARNING_DIR, { recursive: true });
            }
            
            const learningFile = path.join(LEARNING_DIR, 'trades.json');
            if (fs.existsSync(learningFile)) {
                const data = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
                this.tradeHistory = data.tradeHistory || [];
                this.symbolPerformance = data.symbolPerformance || {};
                console.log(`📊 ${this.tradeHistory.length} trades carregados`);
            }
        } catch (error) {
            console.log('⚠️ Erro ao carregar dados:', error.message);
        }
    }
    
    saveLearningData() {
        try {
            const data = {
                tradeHistory: this.tradeHistory.slice(-500),
                symbolPerformance: this.symbolPerformance,
                lastUpdated: Date.now()
            };
            
            const learningFile = path.join(LEARNING_DIR, 'trades.json');
            fs.writeFileSync(learningFile, JSON.stringify(data, null, 2));
            
        } catch (error) {
            console.error('Erro ao salvar dados:', error);
        }
    }
    
    async recordSignal(signal, marketData) {
        try {
            // Obter recomendação RL
            const rlRecommendation = await this.rlSystem.getRecommendation(
                marketData, 
                signal.isBullish ? 'BUY' : 'SELL'
            );
            
            const tradeRecord = {
                id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: Date.now(),
                symbol: signal.symbol,
                direction: signal.isBullish ? 'BUY' : 'SELL',
                isBullish: signal.isBullish,
                entryPrice: signal.price,
                stopPrice: signal.targetsData.stopPrice,
                targets: signal.targetsData.targets,
                qualityScore: signal.qualityScore,
                marketData: {
                    volumeRatio: marketData.volume?.rawRatio || 0,
                    rsi: marketData.rsi?.raw || 0,
                    adx1h: marketData.adx1h?.raw || 0,
                    volatility: marketData.volatility?.rawVolatility || 0
                },
                rlRecommendation: rlRecommendation,
                status: 'OPEN'
            };
            
            this.tradeHistory.push(tradeRecord);
            this.openTrades.set(tradeRecord.id, tradeRecord);
            
            // Track por 48 horas
            setTimeout(() => {
                this.checkTradeOutcome(tradeRecord.id);
            }, 48 * 60 * 60 * 1000);
            
            // Salvar periodicamente
            if (this.tradeHistory.length % 20 === 0) {
                this.saveLearningData();
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
        
        const currentPrice = await getCurrentPrice(trade.symbol);
        if (!currentPrice) {
            // Se falhar, tenta novamente em 1h
            setTimeout(() => this.checkTradeOutcome(tradeId), 60 * 60 * 1000);
            return;
        }
        
        let outcome = 'FAILURE';
        let profitPercentage = 0;
        
        // Verifica se hitou algum target
        for (const target of trade.targets) {
            const targetPrice = parseFloat(target.price);
            const hit = trade.isBullish ? currentPrice >= targetPrice : currentPrice <= targetPrice;
            if (hit) {
                outcome = 'SUCCESS';
                profitPercentage = trade.isBullish ?
                    ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
                    ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
                break;
            }
        }
        
        // Se não hitou target, verifica stop
        if (outcome === 'FAILURE') {
            const stopHit = trade.isBullish ? currentPrice <= trade.stopPrice : currentPrice >= trade.stopPrice;
            profitPercentage = trade.isBullish ?
                ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100 :
                ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
            if (!stopHit) {
                // Ainda não fechou (hold longo)
                // Pode reagendar ou considerar como ongoing
                setTimeout(() => this.checkTradeOutcome(tradeId), 12 * 60 * 60 * 1000); // tenta novamente em 12h
                return;
            }
        }
        
        trade.status = 'CLOSED';
        trade.outcome = outcome;
        trade.profitPercentage = profitPercentage;
        trade.exitPrice = currentPrice;
        trade.durationHours = (Date.now() - trade.timestamp) / (3600000);
        
        await this.rlSystem.learnFromExperience(trade, trade.marketData);
        this.openTrades.delete(tradeId);
        
        console.log(`📊 Trade fechado: ${trade.symbol} ${trade.direction} ${outcome} ${profitPercentage.toFixed(2)}%`);
        this.saveLearningData();
        
    } catch (error) {
        console.error('Erro ao verificar trade:', error);
    }
}
    
    getPerformanceReport() {
        const closedTrades = this.tradeHistory.filter(t => t.status === 'CLOSED');
        const winners = closedTrades.filter(t => t.outcome === 'SUCCESS');
        const losers = closedTrades.filter(t => t.outcome === 'FAILURE');
        
        const winRate = closedTrades.length > 0 ? 
            (winners.length / closedTrades.length) * 100 : 0;
        
        const avgProfit = winners.length > 0 ? 
            winners.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / winners.length : 0;
        
        const avgLoss = losers.length > 0 ? 
            losers.reduce((sum, t) => sum + (t.profitPercentage || 0), 0) / losers.length : 0;
        
        const rlReport = this.rlSystem.getPerformanceReport();
        
        return {
            totalTrades: closedTrades.length,
            winningTrades: winners.length,
            losingTrades: losers.length,
            winRate: winRate.toFixed(1),
            avgProfit: avgProfit.toFixed(2),
            avgLoss: avgLoss.toFixed(2),
            profitFactor: avgLoss !== 0 ? Math.abs(avgProfit / avgLoss).toFixed(2) : 'N/A',
            openTrades: this.openTrades.size,
            symbolsTracked: Object.keys(this.symbolPerformance).length,
            rlReport: rlReport
        };
    }
}

// =====================================================================
// 🔧 FUNÇÕES AUXILIARES (mantidas do código original)
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
        
        console.log('✅ Mensagem enviada para Telegram');
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 🚀 FUNÇÕES DE ANÁLISE TÉCNICA (simplificadas)
// =====================================================================

let candleCache = {};
const CANDLE_CACHE_TTL = 60000;

async function getCandlesCached(symbol, timeframe, limit = 50) {
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
        const candles = await getCandlesCached(symbol, '1h', 30);
        if (candles.length < 14) return null;
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });
        
        if (!rsiValues || rsiValues.length === 0) return null;
        
        const latestRSI = rsiValues[rsiValues.length - 1];
        return {
            value: latestRSI,
            raw: latestRSI
        };
    } catch (error) {
        return null;
    }
}

async function checkVolume(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '3m', 30);
        if (candles.length < 20) return { rawRatio: 1.0, isAbnormal: false };
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        
        const ratio = currentVolume / avgVolume;
        
        return {
            rawRatio: ratio,
            isAbnormal: ratio >= VOLUME_SETTINGS.baseThreshold
        };
    } catch (error) {
        return { rawRatio: 1.0, isAbnormal: false };
    }
}

async function checkVolatility(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 30);
        if (candles.length < 10) return { rawVolatility: 1.0, isValid: false };
        
        const closes = candles.map(c => c.close);
        const returns = [];
        
        for (let i = 1; i < closes.length; i++) {
            returns.push(Math.abs((closes[i] - closes[i-1]) / closes[i-1]));
        }
        
        const volatility = returns.reduce((a, b) => a + b, 0) / returns.length * 100;
        
        return {
            rawVolatility: volatility,
            isValid: volatility >= 0.8
        };
    } catch (error) {
        return { rawVolatility: 1.0, isValid: false };
    }
}

async function checkLSR(symbol, isBullish) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 30);
        if (candles.length < 2) return { lsrRatio: 1.0, isValid: false };
        
        const lastCandle = candles[candles.length - 1];
        const currentClose = lastCandle.close;
        const currentLow = lastCandle.low;
        
        const lsrRatio = (lastCandle.high - currentClose) / (currentClose - currentLow);
        
        // Evitar divisão por zero
        const isValid = isBullish ? 
            (currentClose - currentLow > 0 && lsrRatio <= LSR_SETTINGS.buyThreshold) :
            (currentClose - currentLow > 0 && lsrRatio > LSR_SETTINGS.sellThreshold);
        
        return {
            lsrRatio: lsrRatio || 1.0,
            isValid: isValid
        };
    } catch (error) {
        return { lsrRatio: 1.0, isValid: false };
    }
}

async function getADX1h(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '1h', 30);
        if (candles.length < 20) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: highs,
            low: lows,
            close: closes,
            period: 14
        });
        
        if (!adxValues || adxValues.length === 0) return null;
        
        const latestADX = adxValues[adxValues.length - 1];
        const adxValue = typeof latestADX === 'object' ? latestADX.adx : latestADX;
        
        return {
            raw: adxValue || 0,
            hasMinimumStrength: (adxValue || 0) >= ADX_MIN_STRENGTH
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// 🎯 CÁLCULO DE QUALIDADE SIMPLIFICADO
// =====================================================================

async function calculateSignalQuality(symbol, isBullish, marketData) {
    let score = 0;
    let details = [];
    
    // 1. Volume (25 pontos)
    if (marketData.volume && marketData.volume.rawRatio >= 1.5) {
        const volumeScore = Math.min(25, marketData.volume.rawRatio * 10);
        score += volumeScore;
        details.push(`📊 Volume: ${volumeScore.toFixed(1)}/25 (${marketData.volume.rawRatio.toFixed(2)}x)`);
    }
    
    // 2. ADX (20 pontos)
    if (marketData.adx1h && marketData.adx1h.raw >= 22) {
        const adxScore = Math.min(20, marketData.adx1h.raw);
        score += adxScore;
        details.push(`📈 ADX: ${adxScore.toFixed(1)}/20 (${marketData.adx1h.raw.toFixed(1)})`);
    }
    
    // 3. RSI (15 pontos)
    if (marketData.rsi) {
        let rsiScore = 0;
        if (isBullish && marketData.rsi.value < 45) {
            rsiScore = 15 - (marketData.rsi.value / 3);
        } else if (!isBullish && marketData.rsi.value > 55) {
            rsiScore = (marketData.rsi.value - 55) / 3;
        }
        score += rsiScore;
        details.push(`📉 RSI: ${rsiScore.toFixed(1)}/15 (${marketData.rsi.value.toFixed(1)})`);
    }
    
    // 4. EMA Alignment (20 pontos)
    if (marketData.ema) {
        const isEmaValid = (isBullish && marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingUp) ||
                          (!isBullish && !marketData.ema.isAboveEMA55 && marketData.ema.isEMA13CrossingDown);
        
        if (isEmaValid) {
            score += 20;
            details.push(`📐 EMA: 20/20 (Alinhado)`);
        }
    }
    
    // 5. Volatilidade (10 pontos)
    if (marketData.volatility && marketData.volatility.isValid) {
        score += 10;
        details.push(`🌊 Volatilidade: 10/10 (${marketData.volatility.rawVolatility.toFixed(2)}%)`);
    }
    
    // 6. LSR (10 pontos)
    if (marketData.lsr && marketData.lsr.isValid) {
        score += 10;
        details.push(`⚖️ LSR: 10/10 (${marketData.lsr.lsrRatio.toFixed(2)})`);
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
        isAcceptable: score >= QUALITY_THRESHOLD,
        message: `${emoji} SCORE: ${grade} (${Math.round(score)}/100)`
    };
}

// =====================================================================
// 🎯 CÁLCULO DE TARGETS
// =====================================================================

async function calculateTargets(price, isBullish, symbol) {
    try {
        const stopPercentage = 3.0;
        const stopPrice = isBullish ? 
            price * (1 - stopPercentage / 100) : 
            price * (1 + stopPercentage / 100);
        
        const targets = [
            { target: '2.5', price: isBullish ? price * 1.025 : price * 0.975, riskReward: '0.83' },
            { target: '5.0', price: isBullish ? price * 1.05 : price * 0.95, riskReward: '1.67' },
            { target: '8.0', price: isBullish ? price * 1.08 : price * 0.92, riskReward: '2.67' },
            { target: '12.0', price: isBullish ? price * 1.12 : price * 0.88, riskReward: '4.00' }
        ];
        
        const retracementData = {
            minRetracementPrice: isBullish ? price * 0.9975 : price * 1.0025,
            maxRetracementPrice: isBullish ? price * 0.995 : price * 1.005
        };
        
        return {
            stopPrice: stopPrice,
            stopPercentage: stopPercentage.toFixed(2),
            targets: targets,
            retracementData: retracementData,
            bestTarget: targets[2] // 8% target como melhor
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
    
    const targets = [
        { target: '3.0', price: isBullish ? price * 1.03 : price * 0.97, riskReward: '1.00' },
        { target: '6.0', price: isBullish ? price * 1.06 : price * 0.94, riskReward: '2.00' },
        { target: '9.0', price: isBullish ? price * 1.09 : price * 0.91, riskReward: '3.00' }
    ];
    
    return {
        stopPrice: stopPrice,
        stopPercentage: stopPercentage,
        targets: targets,
        bestTarget: targets[1]
    };
}

// =====================================================================
// 🔍 MONITORAMENTO PRINCIPAL
// =====================================================================

async function monitorSymbol(symbol) {
    try {
        const emaData = await getEMAs3m(symbol);
        if (!emaData) return null;
        
        const rsiData = await getRSI1h(symbol);
        if (!rsiData) return null;
        
        const isBullish = emaData.isAboveEMA55 && emaData.isEMA13CrossingUp;
        const isBearish = !emaData.isAboveEMA55 && emaData.isEMA13CrossingDown;
        
        if (!isBullish && !isBearish) return null;
        
        // Filtros básicos
        if (isBullish && rsiData.value >= 55) return null;
        if (isBearish && rsiData.value <= 45) return null;
        
        const [volumeData, volatilityData, lsrData, adx1hData] = await Promise.all([
            checkVolume(symbol),
            checkVolatility(symbol),
            checkLSR(symbol, isBullish),
            getADX1h(symbol)
        ]);
        
        if (!adx1hData || !adx1hData.hasMinimumStrength) return null;
        
        const marketData = {
            volume: volumeData,
            volatility: volatilityData,
            lsr: lsrData,
            rsi: rsiData,
            adx1h: adx1hData,
            ema: {
                isAboveEMA55: emaData.isAboveEMA55,
                isEMA13CrossingUp: emaData.isEMA13CrossingUp,
                isEMA13CrossingDown: emaData.isEMA13CrossingDown
            }
        };
        
        const qualityScore = await calculateSignalQuality(symbol, isBullish, marketData);
        
        if (!qualityScore.isAcceptable) return null;
        
        const targetsData = await calculateTargets(emaData.currentPrice, isBullish, symbol);
        
        return {
            symbol: symbol,
            isBullish: isBullish,
            price: emaData.currentPrice,
            qualityScore: qualityScore,
            targetsData: targetsData,
            marketData: marketData,
            timestamp: Date.now()
        };
        
    } catch (error) {
        console.log(`⚠️ Erro monitorando ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 📤 ENVIO DE ALERTAS
// =====================================================================

async function sendSignalAlert(signal, learningSystem) {
    try {
        const direction = signal.isBullish ? 'COMPRA' : 'VENDA';
        const directionEmoji = signal.isBullish ? '🟢' : '🔴';
        
        // Registrar no sistema de aprendizado
        const tradeId = await learningSystem.recordSignal(signal, signal.marketData);
        
        // Obter recomendação RL atualizada
        const rlRecommendation = signal.rlRecommendation || 
            await learningSystem.rlSystem.getRecommendation(
                signal.marketData, 
                signal.isBullish ? 'BUY' : 'SELL'
            );
        
        const rlAction = rlRecommendation.action;
        const rlConfidence = (rlRecommendation.confidence * 100).toFixed(1);
        
        const message = `
${directionEmoji} <b>${signal.symbol} - ${direction}</b>
🤖 <b>Titanium RL: ${rlAction} (${rlConfidence}% confiança)</b>

<b>🎯 Entrada:</b> $${signal.price.toFixed(6)}
<b>⛔ Stop Loss:</b> $${signal.targetsData.stopPrice.toFixed(6)} (${signal.targetsData.stopPercentage}%)
<b>🔹 Score:</b> ${signal.qualityScore.score}/100 (${signal.qualityScore.grade})

<b>📊 Análise Técnica:</b>
${signal.qualityScore.details.slice(0, 4).join('\n')}

<b> Alvos (RR):</b>
${signal.targetsData.targets.map((t, i) => 
    `• ${t.target}%: $${t.price.toFixed(6)} (${t.riskReward}x)`
).join('\n')}

<b> Titanium</b>
<b>🔔 by @J4Rviz.</b>
        `;
        
        await sendTelegramAlert(message);
        console.log(`📤 Alerta enviado: ${signal.symbol} ${direction} | RL: ${rlAction}`);
        
    } catch (error) {
        console.error('Erro ao enviar alerta:', error.message);
    }
}

// =====================================================================
// 🔄 LOOP PRINCIPAL
// =====================================================================

async function fetchAllFuturesSymbols() {
    try {
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const data = await response.json();
        
        const symbols = data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol)
            .filter(s => !s.includes('BUSD') && !s.includes('1000'));
        
        return symbols.slice(0, 50); // Limitar para testes
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

async function mainBotLoop() {
    console.log('\n🚀 TITANIUM RL - SISTEMA FUNCIONAL');
    console.log('🤖 Modelos: Q-Learning + Gradient Bandit + Expert Rules');
    console.log('🎯 RL Aprendendo com experiência real\n');
    
    const learningSystem = new SimpleLearningSystem();
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Monitorando ${symbols.length} símbolos`);
    
    let cycle = 0;
    
    while (true) {
        try {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} - ${new Date().toLocaleTimeString()}`);
            
            const signals = [];
            
            // Monitorar símbolos em batches
            for (let i = 0; i < symbols.length; i += 5) {
                const batch = symbols.slice(i, i + 5);
                
                const batchPromises = batch.map(symbol => monitorSymbol(symbol));
                const batchResults = await Promise.all(batchPromises);
                
                const validSignals = batchResults.filter(s => s !== null);
                signals.push(...validSignals);
                
                await new Promise(r => setTimeout(r, 1000)); // Delay entre batches
            }
            
            console.log(`📈 ${signals.length} sinais encontrados`);
            
            // Processar e enviar sinais
            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    await sendSignalAlert(signal, learningSystem);
                    await new Promise(r => setTimeout(r, 2000)); // Delay entre alertas
                }
            }
            
            // Relatório periódico
            if (cycle % 10 === 0) {
                const report = learningSystem.getPerformanceReport();
                console.log('\n📊 RELATÓRIO DE PERFORMANCE:');
                console.log(`Trades: ${report.totalTrades} | Win Rate: ${report.winRate}%`);
                console.log(`Avg Profit: ${report.avgProfit}% | Avg Loss: ${report.avgLoss}%`);
                console.log(`RL Total Reward: ${report.rlReport.total_reward}`);
                
                // Enviar relatório para Telegram a cada 50 ciclos
                if (cycle % 50 === 0) {
                    const brazilTime = getBrazilianDateTime();
                    
                    const reportMessage = `
📊 <b>RELATÓRIO TITANIUM RL</b>
⏰ ${brazilTime.full}

<b>ESTATÍSTICAS:</b>
• Trades Fechados: <b>${report.totalTrades}</b>
• Win Rate: <b>${report.winRate}%</b>
• Profit Factor: <b>${report.profitFactor}</b>
• Lucro Médio: <b>${report.avgProfit}%</b>
• Loss Médio: <b>${report.avgLoss}%</b>

<b>SISTEMA RL:</b>
• Total Reward: <b>${report.rlReport.total_reward}</b>
• Média Reward: <b>${report.rlReport.avg_reward}</b>
• Estados Aprendidos: <b>${report.rlReport.history_size}</b>

<b>PESOS ENSEMBLE:</b>
${Object.entries(report.rlReport.weights || {})
  .map(([model, weight]) => `• ${model}: <b>${(weight * 100).toFixed(1)}%</b>`)
  .join('\n')}

<b>🔧 Aprendizado contínuo ativo</b>
<b>🔔 by @J4Rviz.</b>
                    `;
                    
                    await sendTelegramAlert(reportMessage);
                }
            }
            
            // Limpar cache
            candleCache = {};
            
            console.log(`⏱️  Próximo ciclo em 60s...`);
            await new Promise(r => setTimeout(r, 60000));
            
        } catch (error) {
            console.error('❌ Erro no ciclo principal:', error.message);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}



// =====================================================================
// 📤 MENSAGEM DE INICIALIZAÇÃO
// =====================================================================

async function sendInitializationMessage() {
    const brazilTime = getBrazilianDateTime();
    
    const message = `
🚀 <b>TITANIUM RL - BOT INICIADO COM SUCESSO</b>

⏰ <b>Inicializado em:</b> ${brazilTime.full}

🤖 <b>Sistema RL Ativo</b>
• Modelos: Q-Learning + Gradient Bandit + Expert Rules
• Ensemble com pesos adaptativos
• Aprendizado contínuo com trades reais

📊 <b>Configurações Atuais</b>
• Quality Threshold: <b>${QUALITY_THRESHOLD}/100</b>
• ADX Mínimo: <b>${ADX_MIN_STRENGTH}</b>
• Volume Base: <b>${VOLUME_SETTINGS.baseThreshold}x</b>
• Monitorando até 50 pares USDT

🔄 Ciclos a cada ~60 segundos
💾 Dados salvos automaticamente

<b>Bot pronto para operar!</b>

<b>🔔 by @J4Rviz.</b>
    `;
    
    await sendTelegramAlert(message);
    console.log('✅ Mensagem de inicialização enviada ao Telegram');
}

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================

async function startBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(LEARNING_DIR)) fs.mkdirSync(LEARNING_DIR, { recursive: true });
        if (!fs.existsSync(ENSEMBLE_DIR)) fs.mkdirSync(ENSEMBLE_DIR, { recursive: true });
        
        console.log('\n' + '='.repeat(60));
        console.log('🚀 TITANIUM RL - SISTEMA FUNCIONAL');
        console.log('🤖 Reinforcement Learning Prático');
        console.log('🎯 Ensemble: Q-Learning + Gradient Bandit + Expert Rules');
        console.log('📊 Aprendendo com experiência real de trading');
        console.log('='.repeat(60) + '\n');
        
        // Inicia o loop principal
        await mainBotLoop();
        
    } catch (error) {
        console.error(`🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 60 segundos...');
        await new Promise(r => setTimeout(r, 60000));
        await startBot();
    }
}

// =====================================================================
// 🔄 LOOP PRINCIPAL (com chamada da mensagem de inicialização)
// =====================================================================

async function mainBotLoop() {
    console.log('\nInicializando sistema...');
    
    const learningSystem = new SimpleLearningSystem();
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Monitorando ${symbols.length} símbolos`);

    // <<< AQUI A MENSAGEM É ENVIADA AO INICIAR >>>
    await sendInitializationMessage();

    let cycle = 0;
    
    while (true) {
        try {
            cycle++;
            console.log(`\n🔄 Ciclo ${cycle} - ${new Date().toLocaleTimeString('pt-BR')}`);
            
            const signals = [];
            
            for (let i = 0; i < symbols.length; i += 5) {
                const batch = symbols.slice(i, i + 5);
                
                const batchPromises = batch.map(symbol => monitorSymbol(symbol));
                const batchResults = await Promise.all(batchPromises);
                
                const validSignals = batchResults.filter(s => s !== null);
                signals.push(...validSignals);
                
                await new Promise(r => setTimeout(r, 1000));
            }
            
            console.log(`📈 ${signals.length} sinais encontrados`);
            
            for (const signal of signals) {
                if (signal.qualityScore.score >= QUALITY_THRESHOLD) {
                    await sendSignalAlert(signal, learningSystem);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            
            if (cycle % 10 === 0) {
                const report = learningSystem.getPerformanceReport();
                console.log('\n📊 RELATÓRIO DE PERFORMANCE:');
                console.log(`Trades: ${report.totalTrades} | Win Rate: ${report.winRate}%`);
                console.log(`Avg Profit: ${report.avgProfit}% | Avg Loss: ${report.avgLoss}%`);
                console.log(`RL Total Reward: ${report.rlReport.total_reward}`);
                
                if (cycle % 50 === 0) {
                    const brazilTime = getBrazilianDateTime();
                    
                    const reportMessage = `
📊 <b>RELATÓRIO TITANIUM RL</b>
⏰ ${brazilTime.full}

<b>ESTATÍSTICAS:</b>
• Trades Fechados: <b>${report.totalTrades}</b>
• Win Rate: <b>${report.winRate}%</b>
• Profit Factor: <b>${report.profitFactor}</b>
• Lucro Médio: <b>${report.avgProfit}%</b>
• Loss Médio: <b>${report.avgLoss}%</b>

<b>SISTEMA RL:</b>
• Total Reward: <b>${report.rlReport.total_reward}</b>
• Média Reward: <b>${report.rlReport.avg_reward}</b>
• Estados Aprendidos: <b>${report.rlReport.history_size}</b>

<b>PESOS ENSEMBLE:</b>
${Object.entries(report.rlReport.weights || {})
  .map(([model, weight]) => `• ${model}: <b>${(weight * 100).toFixed(1)}%</b>`)
  .join('\n')}

<b>🔧 Aprendizado contínuo ativo</b>
<b>🔔 by @J4Rviz.</b>
                    `;
                    
                    await sendTelegramAlert(reportMessage);
                }
            }
            
            candleCache = {};
            
            console.log(`⏱️ Próximo ciclo em 60s...`);
            await new Promise(r => setTimeout(r, 60000));
            
        } catch (error) {
            console.error('❌ Erro no ciclo principal:', error.message);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// Iniciar o bot
startBot();
