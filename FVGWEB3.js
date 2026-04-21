const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const ALERTED_FILE = path.join(__dirname, 'alertedSymbols.json');
const FVG_MEMORY_FILE = path.join(__dirname, 'fvgMemory.json');

// =====================================================================
// === CONFIGURAÇÃO ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7708427979:AAF7vVx6AG8pSyzQU8Xbao87VLhKcbJavdg',
        CHAT_ID: '-1002554953979',
        MESSAGE_DELAY_MS: 18000,
        MAX_MESSAGES_PER_MINUTE: 20,
        BURST_DELAY_MS: 10000,
        RETRY_COUNT: 3,
        RETRY_DELAY_MS: 5000
    },
    MONITOR: {
        SCAN_INTERVAL_SECONDS: 60,
        MIN_VOLUME_USDT: 1000000,
        MAX_SYMBOLS: 280,
        EXCLUDE_SYMBOLS: ['USDCUSDT'],
        LSRS_PERIOD: '5m',
        LSR_15M_PERIOD: '15m',
        LSR_TREND_THRESHOLD: 0.05,
        ALERT_COOLDOWN_MINUTES: 30,
        VOLUME_BULL_THRESHOLD: 1.5,
        VOLUME_BEAR_THRESHOLD: 1.5,
        VOLUME_3M_BUYER_THRESHOLD: 1.8,
        VOLUME_3M_SELLER_THRESHOLD: 1.8,
        FVG_PROXIMITY_THRESHOLD: 1.0,
        ZONE_PROXIMITY_THRESHOLD: 1.0,
        RSI: {
            PERIOD: 14,
            TIMEFRAMES: ['15m', '30m', '1h', '2h', '4h'],
            LOOKBACK_CANDLES: 100,
            MIN_DIVERGENCE_STRENGTH: 3,
            MIN_CONVERGENCE_STRENGTH: 2
        },
        CVD: {
            CHECK_INTERVAL_SECONDS: 30,
            CVD_CHANGE_WINDOW: 60
        },
        FVG: {
            REQUIRED_CANDLE_CLOSE: true,
            CONFIRMATION_CANDLES: 1
        },
        STOP_LOSS: {
            ATR_PERIOD: 14,
            ATR_MULTIPLIER: 2.0,
            MIN_STOP_PERCENT: 2.5,
            MAX_STOP_PERCENT: 8.0,
            STRUCTURE_BUFFER: 0.002
        },
        TAKE_PROFIT: {
            RISK_REWARD_RATIOS: [1.5, 2.5, 4.0],
            PARTIAL_CLOSE_PERCENTS: [25, 25, 50]
        },
        PIVOT: {
            LEFT_BARS: 5,
            RIGHT_BARS: 5,
            STRENGTH_THRESHOLD: 1,
            CONFLUENCE_RADIUS_PERCENT: 0.5,
            MAX_PIVOT_DISTANCE_PERCENT: 15
        }
    }
};

// =====================================================================
// === MEMÓRIA DE FVG ===
// =====================================================================
let fvgMemory = {
    confirmedBullFVG: {},
    confirmedBearFVG: {},
    pendingBullFVG: {},
    pendingBearFVG: {}
};

function loadFVGMemory() {
    try {
        if (fs.existsSync(FVG_MEMORY_FILE)) {
            const data = fs.readFileSync(FVG_MEMORY_FILE, 'utf8');
            fvgMemory = JSON.parse(data);
            console.log(`📂 Memória de FVG carregada`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar memória de FVG: ${error.message}`);
    }
}

function saveFVGMemory() {
    try {
        fs.writeFileSync(FVG_MEMORY_FILE, JSON.stringify(fvgMemory, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar memória de FVG: ${error.message}`);
    }
}

// =====================================================================
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor(maxRequestsPerMinute = 1100) {
        this.maxRequests = maxRequestsPerMinute;
        this.requests = [];
        this.pendingRequests = [];
        this.isProcessing = false;
    }

    async acquire() {
        return new Promise((resolve) => {
            this.pendingRequests.push(resolve);
            if (!this.isProcessing) this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.pendingRequests.length > 0) {
            const now = Date.now();
            this.requests = this.requests.filter(t => t > now - 60000);
            
            if (this.requests.length >= this.maxRequests) {
                const waitTime = 60000 - (now - this.requests[0]);
                if (waitTime > 0) await this.delay(waitTime + 100);
                continue;
            }
            
            const resolve = this.pendingRequests.shift();
            this.requests.push(Date.now());
            resolve();
            await this.delay(50);
        }
        this.isProcessing = false;
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

const rateLimiter = new RateLimiter(1100);

// =====================================================================
// === CACHE ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();
const convergenceCache = new Map();
const pivotCache = new Map();
const lsrTrendCache = new Map();
const stochCache = new Map();
const cciCache = new Map();
const alertedSymbols = new Map();
const atrCache = new Map();
const candlesCache = new Map();

function loadAlertedSymbols() {
    try {
        if (fs.existsSync(ALERTED_FILE)) {
            const data = fs.readFileSync(ALERTED_FILE, 'utf8');
            const loaded = JSON.parse(data);
            for (const [symbol, timestamp] of Object.entries(loaded)) {
                alertedSymbols.set(symbol, timestamp);
            }
            console.log(`📂 ${alertedSymbols.size} alertas anteriores carregados`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar alertas: ${error.message}`);
    }
}

function saveAlertedSymbols() {
    try {
        const data = {};
        for (const [symbol, timestamp] of alertedSymbols.entries()) {
            data[symbol] = timestamp;
        }
        fs.writeFileSync(ALERTED_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar alertas: ${error.message}`);
    }
}

function canAlert(symbol, type) {
    const key = `${symbol}_${type}`;
    const lastAlert = alertedSymbols.get(key);
    if (!lastAlert) return true;
    const cooldownMs = CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markAlerted(symbol, type) {
    const key = `${symbol}_${type}`;
    alertedSymbols.set(key, Date.now());
    saveAlertedSymbols();
}

// =====================================================================
// === SISTEMA ROBUSTO DE PIVÔS ===
// =====================================================================
function findPivotsRobust(data, leftBars = 5, rightBars = 5) {
    const pivots = { high: [], low: [] };
    
    for (let i = leftBars; i < data.length - rightBars; i++) {
        let isHighPivot = true;
        let isLowPivot = true;
        
        for (let j = 1; j <= leftBars; j++) {
            if (data[i] <= data[i - j]) isHighPivot = false;
            if (data[i] >= data[i - j]) isLowPivot = false;
        }
        
        for (let j = 1; j <= rightBars; j++) {
            if (data[i] <= data[i + j]) isHighPivot = false;
            if (data[i] >= data[i + j]) isLowPivot = false;
        }
        
        if (isHighPivot) {
            pivots.high.push({
                index: i,
                price: data[i],
                type: 'high',
                strength: 1,
                timestamp: null
            });
        }
        
        if (isLowPivot) {
            pivots.low.push({
                index: i,
                price: data[i],
                type: 'low',
                strength: 1,
                timestamp: null
            });
        }
    }
    
    return pivots;
}

function mergePivotsByConfluence(pivots, priceTolerancePercent = 0.5) {
    if (pivots.length === 0) return [];
    
    const sorted = [...pivots].sort((a, b) => a.price - b.price);
    const merged = [];
    
    for (const pivot of sorted) {
        if (merged.length === 0) {
            merged.push({ ...pivot, strength: pivot.strength, confluenceCount: 1 });
            continue;
        }
        
        const last = merged[merged.length - 1];
        const diffPercent = Math.abs((pivot.price - last.price) / last.price) * 100;
        
        if (diffPercent < priceTolerancePercent) {
            last.strength += pivot.strength;
            last.confluenceCount++;
            last.price = (last.price + pivot.price) / 2;
        } else {
            merged.push({ ...pivot, strength: pivot.strength, confluenceCount: 1 });
        }
    }
    
    return merged;
}

function identifyPivotZones(candles, timeframe, currentPrice) {
    try {
        const prices = candles.map(c => c.close);
        const pivots = findPivotsRobust(prices, CONFIG.MONITOR.PIVOT.LEFT_BARS, CONFIG.MONITOR.PIVOT.RIGHT_BARS);
        
        const mergedHighPivots = mergePivotsByConfluence(pivots.high, CONFIG.MONITOR.PIVOT.CONFLUENCE_RADIUS_PERCENT);
        const mergedLowPivots = mergePivotsByConfluence(pivots.low, CONFIG.MONITOR.PIVOT.CONFLUENCE_RADIUS_PERCENT);
        
        const supports = mergedLowPivots
            .filter(p => p.price < currentPrice)
            .map(p => ({
                price: p.price,
                strength: p.strength,
                confluenceCount: p.confluenceCount,
                distancePercent: ((currentPrice - p.price) / currentPrice) * 100,
                type: 'support'
            }))
            .sort((a, b) => a.distancePercent - b.distancePercent);
        
        const resistances = mergedHighPivots
            .filter(p => p.price > currentPrice)
            .map(p => ({
                price: p.price,
                strength: p.strength,
                confluenceCount: p.confluenceCount,
                distancePercent: ((p.price - currentPrice) / currentPrice) * 100,
                type: 'resistance'
            }))
            .sort((a, b) => a.distancePercent - b.distancePercent);
        
        const closestSupports = supports.slice(0, 3);
        const closestResistances = resistances.slice(0, 3);
        
        const maxDistance = CONFIG.MONITOR.PIVOT.MAX_PIVOT_DISTANCE_PERCENT;
        const validSupports = closestSupports.filter(s => s.distancePercent <= maxDistance);
        const validResistances = closestResistances.filter(r => r.distancePercent <= maxDistance);
        
        return {
            timeframe,
            supports: validSupports,
            resistances: validResistances,
            bestSupport: validSupports.length > 0 ? validSupports[0] : null,
            bestResistance: validResistances.length > 0 ? validResistances[0] : null
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === SISTEMA DE DIVERGÊNCIAS E CONVERGÊNCIAS ===
// =====================================================================
function findDivergencesWithPivots(prices, rsiValues, pivotZones, currentPrice) {
    const divergences = { bullish: [], bearish: [] };
    
    if (!prices || prices.length < 30 || !rsiValues || rsiValues.length < 30) return divergences;
    if (!pivotZones) return divergences;
    
    for (const support of pivotZones.supports) {
        const priceLow = support.price;
        const currentPriceLow = Math.min(...prices.slice(-10));
        
        if (currentPriceLow < priceLow) {
            const rsiAtSupport = rsiValues.find((r, idx) => Math.abs(prices[idx] - priceLow) / priceLow < 0.01);
            const currentRsi = rsiValues[rsiValues.length - 1];
            
            if (rsiAtSupport && currentRsi > rsiAtSupport) {
                const strength = ((priceLow - currentPriceLow) / priceLow) * 100;
                if (strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                    divergences.bullish.push({
                        type: 'bullish',
                        pivotPrice: priceLow,
                        pivotRsi: rsiAtSupport,
                        currentRsi: currentRsi,
                        strength: strength,
                        timeframe: pivotZones.timeframe,
                        distancePercent: support.distancePercent
                    });
                }
            }
        }
    }
    
    for (const resistance of pivotZones.resistances) {
        const priceHigh = resistance.price;
        const currentPriceHigh = Math.max(...prices.slice(-10));
        
        if (currentPriceHigh > priceHigh) {
            const rsiAtResistance = rsiValues.find((r, idx) => Math.abs(prices[idx] - priceHigh) / priceHigh < 0.01);
            const currentRsi = rsiValues[rsiValues.length - 1];
            
            if (rsiAtResistance && currentRsi < rsiAtResistance) {
                const strength = ((currentPriceHigh - priceHigh) / priceHigh) * 100;
                if (strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                    divergences.bearish.push({
                        type: 'bearish',
                        pivotPrice: priceHigh,
                        pivotRsi: rsiAtResistance,
                        currentRsi: currentRsi,
                        strength: strength,
                        timeframe: pivotZones.timeframe,
                        distancePercent: resistance.distancePercent
                    });
                }
            }
        }
    }
    
    return divergences;
}

function findConvergencesWithPivots(prices, rsiValues, pivotZones, currentPrice) {
    const convergences = { bullish: [], bearish: [] };
    
    if (!prices || prices.length < 30 || !rsiValues || rsiValues.length < 30) return convergences;
    if (!pivotZones) return convergences;
    
    // Convergência Bullish: preço e RSI fazem fundos mais altos juntos
    for (let i = 0; i < pivotZones.supports.length; i++) {
        for (let j = i + 1; j < pivotZones.supports.length; j++) {
            const support1 = pivotZones.supports[i];
            const support2 = pivotZones.supports[j];
            
            if (support2.price > support1.price) {
                const rsiAtSupport1 = rsiValues.find((r, idx) => Math.abs(prices[idx] - support1.price) / support1.price < 0.01);
                const rsiAtSupport2 = rsiValues.find((r, idx) => Math.abs(prices[idx] - support2.price) / support2.price < 0.01);
                
                if (rsiAtSupport1 && rsiAtSupport2 && rsiAtSupport2 > rsiAtSupport1) {
                    const strength = ((support2.price - support1.price) / support1.price) * 100;
                    if (strength >= CONFIG.MONITOR.RSI.MIN_CONVERGENCE_STRENGTH) {
                        convergences.bullish.push({
                            type: 'bullish_convergence',
                            pivotPrice: support2.price,
                            pivotRsi: rsiAtSupport2,
                            strength: strength,
                            timeframe: pivotZones.timeframe
                        });
                    }
                }
            }
        }
    }
    
    // Convergência Bearish: preço e RSI fazem topos mais baixos juntos
    for (let i = 0; i < pivotZones.resistances.length; i++) {
        for (let j = i + 1; j < pivotZones.resistances.length; j++) {
            const resistance1 = pivotZones.resistances[i];
            const resistance2 = pivotZones.resistances[j];
            
            if (resistance2.price < resistance1.price) {
                const rsiAtResistance1 = rsiValues.find((r, idx) => Math.abs(prices[idx] - resistance1.price) / resistance1.price < 0.01);
                const rsiAtResistance2 = rsiValues.find((r, idx) => Math.abs(prices[idx] - resistance2.price) / resistance2.price < 0.01);
                
                if (rsiAtResistance1 && rsiAtResistance2 && rsiAtResistance2 < rsiAtResistance1) {
                    const strength = ((resistance1.price - resistance2.price) / resistance1.price) * 100;
                    if (strength >= CONFIG.MONITOR.RSI.MIN_CONVERGENCE_STRENGTH) {
                        convergences.bearish.push({
                            type: 'bearish_convergence',
                            pivotPrice: resistance2.price,
                            pivotRsi: rsiAtResistance2,
                            strength: strength,
                            timeframe: pivotZones.timeframe
                        });
                    }
                }
            }
        }
    }
    
    return convergences;
}

// =====================================================================
// === ANÁLISE COMPLETA COM PIVÔS, DIVERGÊNCIAS E CONVERGÊNCIAS ===
// =====================================================================
async function analyzeDivergencesWithPivots(symbol, currentPrice) {
    const cacheKey = `${symbol}_divergences_pivots_${currentPrice}`;
    const now = Date.now();
    const cached = divergenceCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < 300000) return cached.data;
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false,
        hasBullishConvergence: false,
        hasBearishConvergence: false,
        hasBullish15mPlusOther: false,
        hasBearish15mPlusOther: false,
        bestBullishDivergence: null,
        bestBearishDivergence: null,
        bestBullishConvergence: null,
        bestBearishConvergence: null,
        nearestSupport: null,
        nearestResistance: null,
        allSupports: [],
        allResistances: []
    };
    
    let bullishOn15m = false;
    let bearishOn15m = false;
    let bullishOtherTimeframes = [];
    let bearishOtherTimeframes = [];
    
    for (const timeframe of CONFIG.MONITOR.RSI.TIMEFRAMES) {
        try {
            const candles = await getCandles(symbol, timeframe, CONFIG.MONITOR.RSI.LOOKBACK_CANDLES);
            if (!candles || candles.length < 50) continue;
            
            const prices = candles.map(c => c.close);
            const rsi = calculateRSI(prices, CONFIG.MONITOR.RSI.PERIOD);
            if (!rsi || rsi.length < 50) continue;
            
            const pivotZones = identifyPivotZones(candles, timeframe, currentPrice);
            if (pivotZones) {
                if (pivotZones.bestSupport) {
                    result.allSupports.push({
                        ...pivotZones.bestSupport,
                        timeframe
                    });
                }
                if (pivotZones.bestResistance) {
                    result.allResistances.push({
                        ...pivotZones.bestResistance,
                        timeframe
                    });
                }
                
                const divergences = findDivergencesWithPivots(prices, rsi, pivotZones, currentPrice);
                const convergences = findConvergencesWithPivots(prices, rsi, pivotZones, currentPrice);
                
                if (divergences.bullish.length > 0) {
                    result.hasBullishDivergence = true;
                    const bestBullish = divergences.bullish.reduce((a, b) => a.strength > b.strength ? a : b);
                    if (!result.bestBullishDivergence || bestBullish.strength > result.bestBullishDivergence.strength) {
                        result.bestBullishDivergence = { ...bestBullish, timeframe };
                    }
                    
                    if (timeframe === '15m') bullishOn15m = true;
                    else bullishOtherTimeframes.push(timeframe);
                }
                
                if (divergences.bearish.length > 0) {
                    result.hasBearishDivergence = true;
                    const bestBearish = divergences.bearish.reduce((a, b) => a.strength > b.strength ? a : b);
                    if (!result.bestBearishDivergence || bestBearish.strength > result.bestBearishDivergence.strength) {
                        result.bestBearishDivergence = { ...bestBearish, timeframe };
                    }
                    
                    if (timeframe === '15m') bearishOn15m = true;
                    else bearishOtherTimeframes.push(timeframe);
                }
                
                // ===== CAPTURA CONVERGÊNCIAS COM TIMEFRAME =====
                if (convergences.bullish.length > 0) {
                    result.hasBullishConvergence = true;
                    const bestBullishConv = convergences.bullish.reduce((a, b) => a.strength > b.strength ? a : b);
                    if (!result.bestBullishConvergence || bestBullishConv.strength > result.bestBullishConvergence.strength) {
                        result.bestBullishConvergence = { ...bestBullishConv, timeframe };
                    }
                }
                
                if (convergences.bearish.length > 0) {
                    result.hasBearishConvergence = true;
                    const bestBearishConv = convergences.bearish.reduce((a, b) => a.strength > b.strength ? a : b);
                    if (!result.bestBearishConvergence || bestBearishConv.strength > result.bestBearishConvergence.strength) {
                        result.bestBearishConvergence = { ...bestBearishConv, timeframe };
                    }
                }
            }
            
        } catch (error) {}
    }
    
    if (result.allSupports.length > 0) {
        result.allSupports.sort((a, b) => a.distancePercent - b.distancePercent);
        result.nearestSupport = result.allSupports[0];
    }
    
    if (result.allResistances.length > 0) {
        result.allResistances.sort((a, b) => a.distancePercent - b.distancePercent);
        result.nearestResistance = result.allResistances[0];
    }
    
    result.hasBullish15mPlusOther = bullishOn15m && bullishOtherTimeframes.length > 0;
    result.hasBearish15mPlusOther = bearishOn15m && bearishOtherTimeframes.length > 0;
    
    divergenceCache.set(cacheKey, { data: result, timestamp: now });
    return result;
}

// =====================================================================
// === TELEGRAM QUEUE ===
// =====================================================================
class TelegramQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.messageCount = 0;
        this.lastMessageTime = 0;
        this.minuteResetTime = Date.now();
    }

    async add(message, priority = false) {
        return new Promise((resolve, reject) => {
            this.queue.push({ message, resolve, reject, priority, timestamp: Date.now() });
            this.queue.sort((a, b) => {
                if (a.priority && !b.priority) return -1;
                if (!a.priority && b.priority) return 1;
                return a.timestamp - b.timestamp;
            });
            if (!this.isProcessing) this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            
            if (now - this.minuteResetTime >= 60000) {
                this.messageCount = 0;
                this.minuteResetTime = now;
                console.log(`📊 Rate limit resetado.`);
            }
            
            if (this.messageCount >= CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE) {
                const waitTime = 60000 - (now - this.minuteResetTime);
                console.log(`⏳ Rate limit atingido. Aguardando ${Math.ceil(waitTime / 1000)}s...`);
                await delay(waitTime + 1000);
                continue;
            }
            
            const timeSinceLastMessage = now - this.lastMessageTime;
            if (timeSinceLastMessage < CONFIG.TELEGRAM.MESSAGE_DELAY_MS) {
                await delay(CONFIG.TELEGRAM.MESSAGE_DELAY_MS - timeSinceLastMessage);
            }
            
            const item = this.queue.shift();
            
            try {
                await this.sendWithRetry(item.message);
                item.resolve(true);
                this.messageCount++;
                this.lastMessageTime = Date.now();
                console.log(`✅ Mensagem enviada (${this.messageCount}/${CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE})`);
            } catch (error) {
                console.log(`❌ Erro ao enviar mensagem: ${error.message}`);
                item.reject(error);
            }
            
            if (this.messageCount >= CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE * 0.8) {
                await delay(CONFIG.TELEGRAM.BURST_DELAY_MS);
            }
        }
        this.isProcessing = false;
    }

    async sendWithRetry(message, attempt = 1) {
        try {
            const token = CONFIG.TELEGRAM.BOT_TOKEN;
            const chatId = CONFIG.TELEGRAM.CHAT_ID;
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            
            let finalMessage = message;
            finalMessage = finalMessage.replace(/<i><\/i>/g, '');
            finalMessage = finalMessage.replace(/<i>\s*<\/i>/g, '');
            
            const openTags = (finalMessage.match(/<i>/g) || []).length;
            const closeTags = (finalMessage.match(/<\/i>/g) || []).length;
            if (openTags !== closeTags) {
                finalMessage = finalMessage.replace(/<[^>]*>/g, '');
            }
            
            if (finalMessage.length > 4000) {
                finalMessage = finalMessage.substring(0, 3950) + '\n\n... mensagem truncada';
            }
            
            finalMessage = finalMessage.replace(/&(?!(amp;|lt;|gt;|quot;|apos;))/g, '&amp;');
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: finalMessage,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    disable_notification: false
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return true;
            } else {
                const errorText = await response.text();
                if (response.status === 429) {
                    const retryAfter = parseInt(errorText.match(/retry after (\d+)/)?.[1] || '5');
                    if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                        await delay(retryAfter * 1000 + 1000);
                        return this.sendWithRetry(message, attempt + 1);
                    }
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                await delay(CONFIG.TELEGRAM.RETRY_DELAY_MS * attempt);
                return this.sendWithRetry(message, attempt + 1);
            }
            throw error;
        }
    }
}

const telegramQueue = new TelegramQueue();

// =====================================================================
// === FUNÇÃO PARA CALCULAR ATR ===
// =====================================================================
async function calculateATR(symbol, timeframe = '1h', period = 14) {
    try {
        const cacheKey = `${symbol}_atr_${timeframe}`;
        const now = Date.now();
        const cached = atrCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const candles = await getCandles(symbol, timeframe, period + 10);
        if (!candles || candles.length < period + 1) return null;
        
        const trueRanges = [];
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            const tr1 = high - low;
            const tr2 = Math.abs(high - prevClose);
            const tr3 = Math.abs(low - prevClose);
            trueRanges.push(Math.max(tr1, tr2, tr3));
        }
        
        const recentTR = trueRanges.slice(-period);
        const atr = recentTR.reduce((a, b) => a + b, 0) / period;
        const atrPercent = (atr / candles[candles.length - 1].close) * 100;
        const result = { atr, atrPercent };
        
        atrCache.set(cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR STOP LOSS ===
// =====================================================================
async function calculateSmartStopLoss(symbol, entryPrice, zoneType, structureData) {
    try {
        const atrData = await calculateATR(symbol, '1h', CONFIG.MONITOR.STOP_LOSS.ATR_PERIOD);
        let baseStopPercent = CONFIG.MONITOR.STOP_LOSS.MIN_STOP_PERCENT;
        
        if (atrData && atrData.atrPercent) {
            baseStopPercent = Math.min(
                Math.max(atrData.atrPercent * CONFIG.MONITOR.STOP_LOSS.ATR_MULTIPLIER,
                    CONFIG.MONITOR.STOP_LOSS.MIN_STOP_PERCENT),
                CONFIG.MONITOR.STOP_LOSS.MAX_STOP_PERCENT
            );
        }
        
        let stopPrice;
        let stopPercent = baseStopPercent;
        let stopType = "ATR";
        
        if (zoneType === 'COMPRA') {
            stopPrice = entryPrice * (1 - baseStopPercent / 100);
            
            if (structureData) {
                let structureStop = null;
                if (structureData.closestSupport) {
                    structureStop = structureData.closestSupport.targetPrice * (1 - CONFIG.MONITOR.STOP_LOSS.STRUCTURE_BUFFER);
                } else if (structureData.closestBullFVG) {
                    structureStop = structureData.closestBullFVG.bottom * (1 - CONFIG.MONITOR.STOP_LOSS.STRUCTURE_BUFFER);
                }
                
                if (structureStop && structureStop < stopPrice) {
                    stopPrice = structureStop;
                    stopPercent = ((entryPrice - stopPrice) / entryPrice) * 100;
                    stopType = "ESTRUTURA";
                }
            }
        } else {
            stopPrice = entryPrice * (1 + baseStopPercent / 100);
            
            if (structureData) {
                let structureStop = null;
                if (structureData.closestResistance) {
                    structureStop = structureData.closestResistance.targetPrice * (1 + CONFIG.MONITOR.STOP_LOSS.STRUCTURE_BUFFER);
                } else if (structureData.closestBearFVG) {
                    structureStop = structureData.closestBearFVG.top * (1 + CONFIG.MONITOR.STOP_LOSS.STRUCTURE_BUFFER);
                }
                
                if (structureStop && structureStop > stopPrice) {
                    stopPrice = structureStop;
                    stopPercent = ((stopPrice - entryPrice) / entryPrice) * 100;
                    stopType = "ESTRUTURA";
                }
            }
        }
        
        stopPercent = Math.min(Math.max(stopPercent, CONFIG.MONITOR.STOP_LOSS.MIN_STOP_PERCENT), CONFIG.MONITOR.STOP_LOSS.MAX_STOP_PERCENT);
        
        if (zoneType === 'COMPRA') {
            stopPrice = entryPrice * (1 - stopPercent / 100);
        } else {
            stopPrice = entryPrice * (1 + stopPercent / 100);
        }
        
        return { stopPrice, stopPercent, stopType };
    } catch (error) {
        if (zoneType === 'COMPRA') {
            return { stopPrice: entryPrice * 0.965, stopPercent: 3.5, stopType: "PADRÃO" };
        } else {
            return { stopPrice: entryPrice * 1.035, stopPercent: 3.5, stopType: "PADRÃO" };
        }
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR TAKE PROFITS ===
// =====================================================================
function calculateDynamicTakeProfits(entryPrice, stopPrice, zoneType) {
    let riskAmount;
    
    if (zoneType === 'COMPRA') {
        riskAmount = entryPrice - stopPrice;
    } else {
        riskAmount = stopPrice - entryPrice;
    }
    
    if (riskAmount <= 0) {
        riskAmount = entryPrice * 0.035;
    }
    
    const targets = [];
    const ratios = CONFIG.MONITOR.TAKE_PROFIT.RISK_REWARD_RATIOS;
    const partialPercents = CONFIG.MONITOR.TAKE_PROFIT.PARTIAL_CLOSE_PERCENTS;
    
    for (let i = 0; i < ratios.length; i++) {
        let targetPrice;
        let profitPercent;
        
        if (zoneType === 'COMPRA') {
            targetPrice = entryPrice + (riskAmount * ratios[i]);
            profitPercent = ((targetPrice - entryPrice) / entryPrice) * 100;
        } else {
            targetPrice = entryPrice - (riskAmount * ratios[i]);
            profitPercent = ((entryPrice - targetPrice) / entryPrice) * 100;
        }
        
        targets.push({
            ratio: ratios[i],
            price: targetPrice,
            profitPercent: profitPercent,
            partialClose: partialPercents[i]
        });
    }
    
    const stopPercent = (riskAmount / entryPrice) * 100;
    
    return { targets, stopPercent, riskAmount };
}

// =====================================================================
// === DETECÇÃO DE FVG ===
// =====================================================================
function detectFVG(candles) {
    if (!candles || candles.length < 3) return { bull: [], bear: [] };
    
    const fvgBull = [];
    const fvgBear = [];
    
    for (let i = 0; i < candles.length - 2; i++) {
        const candle1 = candles[i];
        const candle2 = candles[i + 1];
        const candle3 = candles[i + 2];
        
        if (candle1.low > candle3.high) {
            fvgBull.push({
                top: candle1.low,
                bottom: candle3.high,
                index: i,
                time: candle1.time,
                type: 'bull'
            });
        }
        
        if (candle1.high < candle3.low) {
            fvgBear.push({
                top: candle3.low,
                bottom: candle1.high,
                index: i,
                time: candle1.time,
                type: 'bear'
            });
        }
    }
    
    return { bull: fvgBull, bear: fvgBear };
}

function isFVGConfirmed(fvg, currentCandles) {
    if (!CONFIG.MONITOR.FVG.REQUIRED_CANDLE_CLOSE) return true;
    if (!currentCandles || currentCandles.length < CONFIG.MONITOR.FVG.CONFIRMATION_CANDLES + 1) return false;
    
    const lastCandle = currentCandles[currentCandles.length - 1];
    
    if (fvg.type === 'bull') {
        return lastCandle.close > fvg.bottom;
    } else {
        return lastCandle.close < fvg.top;
    }
}

function checkFVGWithConfirmation(fvgs, currentPrice, currentCandles, type = null) {
    let closest = null;
    let minDistance = Infinity;
    
    const fvgsToCheck = type === 'bull' ? fvgs.bull : (type === 'bear' ? fvgs.bear : [...fvgs.bull, ...fvgs.bear]);
    
    for (const fvg of fvgsToCheck) {
        const isConfirmed = isFVGConfirmed(fvg, currentCandles);
        
        let distance;
        let targetPrice = null;
        
        if (fvg.type === 'bull') {
            targetPrice = fvg.bottom;
            if (currentPrice < targetPrice) {
                distance = ((targetPrice - currentPrice) / currentPrice) * 100;
            } else if (currentPrice > fvg.top) {
                distance = ((currentPrice - fvg.top) / currentPrice) * 100;
            } else if (currentPrice >= targetPrice && currentPrice <= fvg.top) {
                distance = 0;
            } else {
                continue;
            }
        } else {
            targetPrice = fvg.top;
            if (currentPrice > targetPrice) {
                distance = ((currentPrice - targetPrice) / currentPrice) * 100;
            } else if (currentPrice < fvg.bottom) {
                distance = ((fvg.bottom - currentPrice) / currentPrice) * 100;
            } else if (currentPrice >= fvg.bottom && currentPrice <= targetPrice) {
                distance = 0;
            } else {
                continue;
            }
        }
        
        if (distance < minDistance && isConfirmed) {
            minDistance = distance;
            closest = {
                ...fvg,
                distancePercent: distance,
                targetPrice: targetPrice,
                isConfirmed: true
            };
        }
    }
    
    return closest;
}

function detectSupportResistance(candles, lookback = 5) {
    if (!candles || candles.length < lookback * 2) return { supports: [], resistances: [] };
    
    const supports = [];
    const resistances = [];
    const prices = candles.map(c => c.close);
    
    for (let i = lookback; i < prices.length - lookback; i++) {
        let isLocalLow = true;
        for (let j = 1; j <= lookback; j++) {
            if (prices[i] >= prices[i - j] || prices[i] >= prices[i + j]) {
                isLocalLow = false;
                break;
            }
        }
        if (isLocalLow) {
            supports.push({ price: prices[i], index: i, time: candles[i].time, strength: 1 });
        }
    }
    
    for (let i = lookback; i < prices.length - lookback; i++) {
        let isLocalHigh = true;
        for (let j = 1; j <= lookback; j++) {
            if (prices[i] <= prices[i - j] || prices[i] <= prices[i + j]) {
                isLocalHigh = false;
                break;
            }
        }
        if (isLocalHigh) {
            resistances.push({ price: prices[i], index: i, time: candles[i].time, strength: 1 });
        }
    }
    
    return { supports: consolidateLevels(supports, 0.005), resistances: consolidateLevels(resistances, 0.005) };
}

function consolidateLevels(levels, tolerancePercent) {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const consolidated = [];
    
    for (const level of sorted) {
        if (consolidated.length === 0) {
            consolidated.push({ ...level });
            continue;
        }
        const last = consolidated[consolidated.length - 1];
        const diffPercent = Math.abs((level.price - last.price) / last.price) * 100;
        if (diffPercent < tolerancePercent) {
            last.strength += level.strength;
            last.price = (last.price + level.price) / 2;
        } else {
            consolidated.push({ ...level });
        }
    }
    return consolidated;
}

function checkProximityToLevel(price, levels, thresholdPercent = 0.5) {
    if (!levels || levels.length === 0) return null;
    
    let closest = null;
    let minDistance = Infinity;
    
    for (const level of levels) {
        const distance = Math.abs(price - level.price);
        const distancePercent = (distance / price) * 100;
        
        if (distancePercent < thresholdPercent && distancePercent < minDistance) {
            minDistance = distancePercent;
            closest = {
                ...level,
                distancePercent,
                targetPrice: level.price,
                isAbove: price > level.price,
                isBelow: price < level.price
            };
        }
    }
    return closest;
}

async function analyzeStructure(symbol, timeframe, currentPrice) {
    try {
        const candles = await getCandles(symbol, timeframe, 100);
        if (!candles || candles.length < 50) return null;
        
        const fvgs = detectFVG(candles);
        const { supports, resistances } = detectSupportResistance(candles);
        
        const closestBullFVG = checkFVGWithConfirmation(fvgs, currentPrice, candles, 'bull');
        const closestBearFVG = checkFVGWithConfirmation(fvgs, currentPrice, candles, 'bear');
        const closestSupport = checkProximityToLevel(currentPrice, supports, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        const closestResistance = checkProximityToLevel(currentPrice, resistances, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        
        let zoneType = 'NEUTRO';
        
        if (closestBullFVG && closestBullFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'COMPRA';
        } else if (closestSupport && closestSupport.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'COMPRA';
        }
        
        if (closestBearFVG && closestBearFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'VENDA';
        } else if (closestResistance && closestResistance.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'VENDA';
        }
        
        return {
            timeframe,
            fvgs,
            supports,
            resistances,
            closestBullFVG,
            closestBearFVG,
            closestSupport,
            closestResistance,
            zoneType
        };
    } catch (error) {
        return null;
    }
}

async function detectVolumeAnomaly(symbol, timeframe = '1h') {
    try {
        const candles = await getCandles(symbol, timeframe, 30);
        if (!candles || candles.length < 20) return null;
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
        const volumeRatio = currentVolume / avgVolume;
        
        let type = null;
        let intensity = '';
        
        if (volumeRatio >= CONFIG.MONITOR.VOLUME_BULL_THRESHOLD) {
            type = 'bull';
            intensity = volumeRatio >= 3 ? '🔥🔥🔥' : (volumeRatio >= 2 ? '🔥🔥' : '🔥');
        } else if (volumeRatio <= (1 / CONFIG.MONITOR.VOLUME_BEAR_THRESHOLD)) {
            type = 'bear';
            intensity = volumeRatio <= 0.33 ? '❄️❄️❄️' : (volumeRatio <= 0.5 ? '❄️❄️' : '❄️');
        }
        
        return { type, volumeRatio, currentVolume, avgVolume, intensity };
    } catch (error) {
        return null;
    }
}

async function detectVolume3mAnomaly(symbol, type = 'buyer') {
    try {
        const candles = await getCandles(symbol, '3m', 30);
        if (!candles || candles.length < 20) return null;
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
        const volumeRatio = currentVolume / avgVolume;
        
        if (type === 'buyer') {
            return { isAnomaly: volumeRatio >= CONFIG.MONITOR.VOLUME_3M_BUYER_THRESHOLD, volumeRatio, type: 'buyer' };
        } else {
            return { isAnomaly: volumeRatio >= CONFIG.MONITOR.VOLUME_3M_SELLER_THRESHOLD, volumeRatio, type: 'seller' };
        }
    } catch (error) {
        return null;
    }
}

async function analyzeVolumeAlert(symbol, currentPrice, divergencias, convergencias) {
    try {
        const volume1h = await detectVolumeAnomaly(symbol, '1h');
        const volume4h = await detectVolumeAnomaly(symbol, '4h');
        const volume3mBuyer = await detectVolume3mAnomaly(symbol, 'buyer');
        const volume3mSeller = await detectVolume3mAnomaly(symbol, 'seller');
        
        const structure1h = await analyzeStructure(symbol, '1h', currentPrice);
        const structure4h = await analyzeStructure(symbol, '4h', currentPrice);
        
        let alertType = null;
        let mainTimeframe = null;
        let structureData = null;
        
        if (volume3mBuyer && volume3mBuyer.isAnomaly) {
            const temDivergenciaAlta = divergencias && divergencias.hasBullish15mPlusOther;
            const temConvergenciaAlta = convergencias && convergencias.hasBullishConvergence;
            
            if (temDivergenciaAlta && temConvergenciaAlta) {
                if (structure4h && structure4h.zoneType === 'COMPRA') {
                    alertType = 'VOLUME_BULL';
                    mainTimeframe = '4h';
                    structureData = structure4h;
                } else if (structure1h && structure1h.zoneType === 'COMPRA') {
                    alertType = 'VOLUME_BULL';
                    mainTimeframe = '1h';
                    structureData = structure1h;
                }
            }
        }
        
        if (volume3mSeller && volume3mSeller.isAnomaly) {
            const temDivergenciaBaixa = divergencias && divergencias.hasBearish15mPlusOther;
            const temConvergenciaBaixa = convergencias && convergencias.hasBearishConvergence;
            
            if (temDivergenciaBaixa && temConvergenciaBaixa) {
                if (structure4h && structure4h.zoneType === 'VENDA') {
                    alertType = 'VOLUME_BEAR';
                    mainTimeframe = '4h';
                    structureData = structure4h;
                } else if (structure1h && structure1h.zoneType === 'VENDA') {
                    alertType = 'VOLUME_BEAR';
                    mainTimeframe = '1h';
                    structureData = structure1h;
                }
            }
        }
        
        if (!alertType) return null;
        
        return {
            alertType,
            mainTimeframe,
            structure: structureData,
            volume1h,
            volume4h,
            volume3mBuyer,
            volume3mSeller,
            structure1h,
            structure4h
        };
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === STOCHASTIC E CCI ===
// =====================================================================
async function calculateStochastic(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_stoch_${timeframe}`;
        const now = Date.now();
        const cached = stochCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 20) return null;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const kValues = [];
        for (let i = 4; i < closes.length; i++) {
            const highestHigh = Math.max(...highs.slice(i - 4, i + 1));
            const lowestLow = Math.min(...lows.slice(i - 4, i + 1));
            const k = ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
            kValues.push(k);
        }
        
        const dValues = [];
        for (let i = 2; i < kValues.length; i++) {
            dValues.push((kValues[i] + kValues[i-1] + kValues[i-2]) / 3);
        }
        
        const currentK = kValues[kValues.length - 1];
        const currentD = dValues[dValues.length - 1];
        const prevK = kValues[kValues.length - 2];
        const prevD = dValues[dValues.length - 2];
        
        const kTrend = currentK > prevK ? '⤴️' : (currentK < prevK ? '⤵️' : '');
        const dTrend = currentD > prevD ? '⤴️' : (currentD < prevD ? '⤵️' : '');
        
        let status = '';
        if (currentK < 15) status = '🔵';
        else if (currentK < 25) status = '🟢';
        else if (currentK < 45) status = '🟡';
        else if (currentK < 70) status = '🟠';
        else status = '🔴';
        
        const result = { k: currentK.toFixed(0), d: currentD.toFixed(0), kTrend, dTrend, status };
        stochCache.set(cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

async function calculateCCI(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_cci_${timeframe}`;
        const now = Date.now();
        const cached = cciCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const candles = await getCandles(symbol, timeframe, 100);
        if (!candles || candles.length < 20) return null;
        
        const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
        const period = 20;
        const cciValues = [];
        
        for (let i = period - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - period + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / period;
            let meanDeviation = 0;
            for (let j = 0; j < slice.length; j++) {
                meanDeviation += Math.abs(slice[j] - sma);
            }
            meanDeviation = meanDeviation / period;
            const cci = meanDeviation === 0 ? 0 : (typicalPrices[i] - sma) / (0.015 * meanDeviation);
            cciValues.push(cci);
        }
        
        const currentCCI = cciValues[cciValues.length - 1];
        let valueCircle = '';
        if (currentCCI <= -200) valueCircle = '🔵';
        else if (currentCCI <= -100) valueCircle = '🟢';
        else if (currentCCI <= 0) valueCircle = '🟡';
        else if (currentCCI <= 100) valueCircle = '🟠';
        else valueCircle = '🔴';
        
        const result = { circle: valueCircle, value: currentCCI.toFixed(0) };
        cciCache.set(cacheKey, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return null;
    }
}

function formatStochMessage(stoch4h, stoch1d) {
    let msg = '';
    if (stoch4h) msg += `Stoch 4h: K${stoch4h.k}${stoch4h.kTrend} D${stoch4h.d}${stoch4h.dTrend} ${stoch4h.status}\n`;
    if (stoch1d) msg += `Stoch 1d: K${stoch1d.k}${stoch1d.kTrend} D${stoch1d.d}${stoch1d.dTrend} ${stoch1d.status}`;
    return msg;
}

// =====================================================================
// === RSI ===
// =====================================================================
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const rsiValues = [null];
    let firstRSI = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    rsiValues.push(firstRSI);
    
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change >= 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
        const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        rsiValues.push(rsi);
    }
    return rsiValues;
}

// =====================================================================
// === BUSCAR DADOS ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    const cacheKey = `${symbol}_${interval}_${limit}`;
    const now = Date.now();
    const cached = candlesCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < 30000) return cached.data;
    
    try {
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        
        const candles = data.map(candle => ({
            open: parseFloat(candle[1]), high: parseFloat(candle[2]), low: parseFloat(candle[3]),
            close: parseFloat(candle[4]), volume: parseFloat(candle[5]), time: candle[0]
        }));
        
        candlesCache.set(cacheKey, { data: candles, timestamp: now });
        return candles;
    } catch (error) {
        return [];
    }
}

async function getRSIForSymbol(symbol) {
    try {
        const now = Date.now();
        const cached = rsiCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) return cached.value;
        
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 30) return null;
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        if (!rsi || rsi.length === 0) return null;
        const rsiValue = rsi[rsi.length - 1];
        
        rsiCache.set(symbol, { value: rsiValue, timestamp: now });
        return rsiValue;
    } catch (error) {
        return null;
    }
}

function getRSIEmoji(rsiValue) {
    if (rsiValue === null || rsiValue === undefined) return '⚪';
    if (rsiValue < 20) return '🔵';
    if (rsiValue <= 30) return '🟢';
    if (rsiValue <= 45) return '🟡';
    if (rsiValue <= 58) return '🟠';
    if (rsiValue <= 75) return '🔴';
    return '🔥';
}

async function getAllSymbols() {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        const filtered = data.filter(i => 
            i.symbol.endsWith('USDT') && 
            parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && 
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)
        ).slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
        
        return filtered.map(i => ({ symbol: i.symbol, price: parseFloat(i.lastPrice), volume24h: parseFloat(i.quoteVolume) }));
    } catch (error) {
        log(`Erro ao buscar símbolos: ${error.message}`, 'error');
        return [];
    }
}

async function getFundingRates(symbols) {
    try {
        await rateLimiter.acquire();
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) {
            if (symbols.includes(i.symbol)) result[i.symbol] = parseFloat(i.lastFundingRate);
        }
        return result;
    } catch (error) {
        return {};
    }
}

async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const result = {};
        const batchSize = 20;
        
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const promises = batch.map(async s => {
                try {
                    await rateLimiter.acquire();
                    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${period}&limit=1`;
                    const res = await fetch(url);
                    const data = await res.json();
                    if (data && data.length && data[0] && data[0].longShortRatio) {
                        return { symbol: s, lsr: parseFloat(data[0].longShortRatio) };
                    }
                    return { symbol: s, lsr: null };
                } catch {
                    return { symbol: s, lsr: null };
                }
            });
            
            const batchResults = await Promise.all(promises);
            for (const item of batchResults) result[item.symbol] = item.lsr;
            if (i + batchSize < symbols.length) await delay(1000);
        }
        return result;
    } catch (error) {
        return {};
    }
}

async function getLSRTrend(symbol) {
    try {
        const now = Date.now();
        const cached = lsrTrendCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) return cached.data;
        
        const period = CONFIG.MONITOR.LSR_15M_PERIOD;
        await rateLimiter.acquire();
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data || data.length < 2) return { trend: 'stable', changePercent: 0 };
        
        const currentLSR = parseFloat(data[0].longShortRatio);
        const previousLSR = parseFloat(data[1].longShortRatio);
        const changePercent = ((currentLSR - previousLSR) / previousLSR) * 100;
        let trend = 'stable';
        if (changePercent > CONFIG.MONITOR.LSR_TREND_THRESHOLD) trend = 'rising';
        else if (changePercent < -CONFIG.MONITOR.LSR_TREND_THRESHOLD) trend = 'falling';
        
        const result = { trend, changePercent, currentLSR, previousLSR };
        lsrTrendCache.set(symbol, { data: result, timestamp: now });
        return result;
    } catch (error) {
        return { trend: 'stable', changePercent: 0 };
    }
}

// =====================================================================
// === CVD MANAGER ===
// =====================================================================
class CVDManager {
    constructor() {
        this.cvdData = new Map();
        this.subscribedSymbols = new Set();
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
    }

    subscribeToSymbol(symbol) {
        if (this.subscribedSymbols.has(symbol)) return;
        this.subscribedSymbols.add(symbol);
        this.cvdData.set(symbol, {
            value: 0, history: [], lastUpdate: Date.now(),
            buyVolume: 0, sellVolume: 0, lastPrice: null,
            ws: null, connected: false, direction: ''
        });
        this.connectWebSocket(symbol);
    }
    
    connectWebSocket(symbol) {
        const symbolLower = symbol.toLowerCase();
        const wsUrl = `wss://fstream.binance.com/ws/${symbolLower}@aggTrade`;
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            this.reconnectAttempts.set(symbol, 0);
            const data = this.cvdData.get(symbol);
            if (data) { data.ws = ws; data.connected = true; }
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (error) {}
        });
        
        ws.on('error', () => this.handleDisconnect(symbol));
        ws.on('close', () => this.handleDisconnect(symbol));
        
        const data = this.cvdData.get(symbol);
        if (data) data.ws = ws;
    }
    
    processTrade(symbol, trade) {
        const volume = parseFloat(trade.q);
        const isBuyerMaker = trade.m;
        const delta = isBuyerMaker ? -volume : +volume;
        const data = this.cvdData.get(symbol);
        if (!data) return;
        
        data.value += delta;
        data.lastUpdate = Date.now();
        data.lastPrice = parseFloat(trade.p);
        if (delta > 0) data.buyVolume += volume;
        else data.sellVolume += volume;
        
        data.history.push({ timestamp: Date.now(), delta, volume, cvd: data.value });
        if (data.history.length > 1000) data.history.shift();
        this.updateDirection(symbol);
    }
    
    updateDirection(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length < 10) return;
        
        const now = Date.now();
        const cutoff = now - (CONFIG.MONITOR.CVD.CVD_CHANGE_WINDOW * 1000);
        let oldCVD = null;
        for (let i = data.history.length - 1; i >= 0; i--) {
            if (data.history[i].timestamp <= cutoff) {
                oldCVD = data.history[i];
                break;
            }
        }
        if (!oldCVD) return;
        
        const change = data.value - oldCVD.cvd;
        if (change > 0) data.direction = '⤴️';
        else if (change < 0) data.direction = '⤵️';
        else data.direction = '';
    }
    
    handleDisconnect(symbol) {
        const attempts = this.reconnectAttempts.get(symbol) || 0;
        if (attempts < this.maxReconnectAttempts) {
            const delayTime = this.reconnectDelay * Math.pow(2, attempts);
            setTimeout(() => {
                this.reconnectAttempts.set(symbol, attempts + 1);
                this.connectWebSocket(symbol);
            }, delayTime);
        }
    }
    
    getCVD(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return null;
        return { direction: data.direction };
    }
    
    cleanup() {
        for (const symbol of this.subscribedSymbols) {
            const data = this.cvdData.get(symbol);
            if (data && data.ws) {
                try { data.ws.close(); data.ws.terminate(); } catch(e) {}
            }
        }
    }
}

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0];
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
    const icons = { error: '❌', success: '✅', warning: '⚠️', info: 'ℹ️', alert: '🚨' };
    console.log(`${icons[type] || 'ℹ️'} [${timestamp}] ${message}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =====================================================================
// === VERIFICAR CRITÉRIOS ===
// =====================================================================
async function checkAndAlert(symbolData, cvdManager) {
    const { symbol: fullSymbol, price } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
    
    try {
        const fundingRates = await getFundingRates([fullSymbol]);
        const funding = fundingRates[fullSymbol];
        const lsrData = await getLSRData([fullSymbol]);
        const lsr = lsrData[fullSymbol];
        
        if (funding === undefined || funding === null) return;
        if (lsr === undefined || lsr === null) return;
        
        const [rsiValue, divergenciasCompletas, lsrTrendData] = await Promise.all([
            getRSIForSymbol(fullSymbol),
            analyzeDivergencesWithPivots(fullSymbol, price),
            getLSRTrend(fullSymbol)
        ]);
        
        if (!rsiValue) return;
        
        const cvd = cvdManager.getCVD(fullSymbol);
        const [stoch4h, stoch1d, cci4h, cci1d] = await Promise.all([
            calculateStochastic(fullSymbol, '4h'),
            calculateStochastic(fullSymbol, '1d'),
            calculateCCI(fullSymbol, '4h'),
            calculateCCI(fullSymbol, '1d')
        ]);
        
        const divergencias = {
            hasBullish15mPlusOther: divergenciasCompletas.hasBullish15mPlusOther,
            hasBearish15mPlusOther: divergenciasCompletas.hasBearish15mPlusOther,
            hasBullishConvergence: divergenciasCompletas.hasBullishConvergence,
            hasBearishConvergence: divergenciasCompletas.hasBearishConvergence
        };
        
        const volumeAlert = await analyzeVolumeAlert(fullSymbol, price, divergencias, divergenciasCompletas);
        
        const asset = {
            symbol, fullSymbol, price, funding, fundingPercent: funding * 100,
            lsr, lsrTrend: lsrTrendData.trend, rsi: rsiValue, rsiEmoji: getRSIEmoji(rsiValue),
            cvdDirection: cvd ? cvd.direction : '', divergencias: divergenciasCompletas,
            stoch4h, stoch1d, cci4h, cci1d, volumeAlert
        };
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BULL' && canAlert(fullSymbol, 'VOLUME_BULL')) {
            await sendFVGAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'VOLUME_BULL');
            log(`🟢 COMPRA FVG: ${symbol}`, 'alert');
            await delay(500);
        }
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BEAR' && canAlert(fullSymbol, 'VOLUME_BEAR')) {
            await sendFVGAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'VOLUME_BEAR');
            log(`🔴 VENDA FVG: ${symbol}`, 'alert');
            await delay(500);
        }
    } catch (error) {
        log(`Erro ao verificar ${fullSymbol}: ${error.message}`, 'error');
    }
}

// =====================================================================
// === ENVIAR ALERTA FVG ===
// =====================================================================
async function sendFVGAlert(asset, type) {
    const dt = getBrazilianDateTime();
    const volumeAlert = asset.volumeAlert;
    const zoneType = type === 'BULL' ? 'COMPRA' : 'VENDA';
    const structureData = volumeAlert.structure4h || volumeAlert.structure1h;
    const currentPrice = asset.price;
    const divergencias = asset.divergencias;
    
    // ===== INFORMAÇÕES DE DIVERGÊNCIA, CONVERGÊNCIA E PIVÔ =====
    let divergenciaInfo = '';
    let convergenciaInfo = '';
    let supportInfo = '';
    let resistanceInfo = '';
    
    if (type === 'BULL') {
        if (divergencias.bestBullishDivergence) {
            const div = divergencias.bestBullishDivergence;
            divergenciaInfo = `📈 Divergência Bullish ${div.timeframe}`;
        }
        if (divergencias.bestBullishConvergence) {
            const conv = divergencias.bestBullishConvergence;
            convergenciaInfo = `🔄 Convergência Bullish ${conv.timeframe}`;
        }
        if (divergencias.nearestSupport) {
            const sup = divergencias.nearestSupport;
            supportInfo = `📍 Suporte ${sup.timeframe} em ${formatPrice(sup.price)} USDT (dist ${sup.distancePercent.toFixed(2)}%)`;
        }
    } else {
        if (divergencias.bestBearishDivergence) {
            const div = divergencias.bestBearishDivergence;
            divergenciaInfo = `📉 Divergência Bearish ${div.timeframe}`;
        }
        if (divergencias.bestBearishConvergence) {
            const conv = divergencias.bestBearishConvergence;
            convergenciaInfo = `🔄 Convergência Bearish ${conv.timeframe}`;
        }
        if (divergencias.nearestResistance) {
            const res = divergencias.nearestResistance;
            resistanceInfo = `📍 Resistência ${res.timeframe} em ${formatPrice(res.price)} USDT (dist ${res.distancePercent.toFixed(2)}%)`;
        }
    }
    
    // ===== DEFINE O PREÇO DE ENTRADA =====
    let entryPrice;
    
    if (type === 'BULL') {
        const bullFVG = volumeAlert.structure4h?.closestBullFVG?.targetPrice;
        const support = volumeAlert.structure4h?.closestSupport?.targetPrice;
        let possibleEntry = bullFVG || support;
        
        if (possibleEntry && possibleEntry < currentPrice) {
            entryPrice = possibleEntry;
        } else if (divergencias.nearestSupport && divergencias.nearestSupport.price < currentPrice) {
            entryPrice = divergencias.nearestSupport.price;
        } else {
            entryPrice = currentPrice * 0.995;
        }
    } else {
        const bearFVG = volumeAlert.structure4h?.closestBearFVG?.targetPrice;
        const resistance = volumeAlert.structure4h?.closestResistance?.targetPrice;
        let possibleEntry = bearFVG || resistance;
        
        if (possibleEntry && possibleEntry > currentPrice) {
            entryPrice = possibleEntry;
        } else if (divergencias.nearestResistance && divergencias.nearestResistance.price > currentPrice) {
            entryPrice = divergencias.nearestResistance.price;
        } else {
            entryPrice = currentPrice * 1.005;
        }
    }
    
    // ===== CALCULA O STOP =====
    const stopData = await calculateSmartStopLoss(asset.fullSymbol, entryPrice, zoneType, structureData);
    
    let finalStopPrice = stopData.stopPrice;
    let finalStopPercent = stopData.stopPercent;
    
    if (zoneType === 'COMPRA') {
        if (finalStopPrice >= entryPrice) {
            finalStopPrice = entryPrice * 0.965;
            finalStopPercent = 3.5;
        }
    } else {
        if (finalStopPrice <= entryPrice) {
            finalStopPrice = entryPrice * 1.035;
            finalStopPercent = 3.5;
        }
    }
    
    // ===== CALCULA OS ALVOS =====
    const targets = calculateDynamicTakeProfits(entryPrice, finalStopPrice, zoneType);
    
    // ===== MENSAGEM =====
    let message = '';
    
    if (type === 'BULL') {
        message = `<i>🟢 COMPRA 🟢\n`;
        message += ` ATIVO: ${asset.symbol}\n`;
        message += ` ${dt.full} hs\n`;
        message += ` Preço atual: ${formatPrice(currentPrice)} USDT\n`;
        
        if (divergenciaInfo) message += `🔍 ${divergenciaInfo}\n`;
        if (convergenciaInfo) message += `  ${convergenciaInfo}\n`;
        if (supportInfo) message += ` ${supportInfo}\n`;
        
        if (volumeAlert.mainTimeframe) {
            message += `📍 Região de Compra (${volumeAlert.mainTimeframe}):\n`;
        }
        if (volumeAlert.structure4h?.closestBullFVG) {
            message += ` FVG Bull à ${volumeAlert.structure4h.closestBullFVG.distancePercent.toFixed(2)}%\n`;
        }
        
        message += `🔍🤖 Estratégia\n`;
        message += `✅ COMPRA no pullback\n`;
        message += ` 📍 Entrada: ${formatPrice(entryPrice)} USDT\n`;
        message += ` 🛑 Stop: ${formatPrice(finalStopPrice)} USDT (${finalStopPercent.toFixed(2)}%)\n`;
        
        message += ` ALVOS:\n`;
        for (let i = 0; i < targets.targets.length; i++) {
            const t = targets.targets[i];
            message += ` Alvo ${i+1} (${t.ratio}:1): ${formatPrice(t.price)} USDT (+${t.profitPercent.toFixed(2)}%) - Fechar ${t.partialClose}%\n`;
        }
        
        message += ` Mercado:\n`;
        message += ` LSR: ${asset.lsr.toFixed(2)} (${asset.lsrTrend === 'falling' ? 'caindo ✅' : 'subindo'})\n`;
        message += ` Funding: ${asset.fundingPercent.toFixed(4)}% ${asset.funding < 0 ? 'negativo ✅' : 'positivo'}\n`;
        message += ` RSI 1h: ${asset.rsi?.toFixed(1) || 'N/A'} ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection || 'neutro'}\n`;

        message += `STOCH:\n`;
        message += `${formatStochMessage(asset.stoch4h, asset.stoch1d)}\n`;
        
        message += ` Titanium Prime X by @J4Rviz</i>`;
        
    } else {
        message = `<i>🔴 VENDA 🔴\n`;
        message += ` ATIVO: ${asset.symbol}\n`;
        message += ` ${dt.full} hs\n`;
        message += ` Preço atual: ${formatPrice(currentPrice)} USDT\n`;
        
        if (divergenciaInfo) message += `🔍 ${divergenciaInfo}\n`;
        if (convergenciaInfo) message += `  ${convergenciaInfo}\n`;
        if (resistanceInfo) message += ` ${resistanceInfo}\n`;
        
        if (volumeAlert.mainTimeframe) {
            message += `📍 Região de Venda (${volumeAlert.mainTimeframe}):\n`;
        }
        if (volumeAlert.structure4h?.closestBearFVG) {
            message += ` FVG Bear à ${volumeAlert.structure4h.closestBearFVG.distancePercent.toFixed(2)}%\n`;
        }
        
        message += `🔍🤖 Estratégia\n`;
        message += `✅ VENDA no pullback\n`;
        message += ` 📍 Entrada: ${formatPrice(entryPrice)} USDT\n`;
        message += ` 🛑 Stop: ${formatPrice(finalStopPrice)} USDT (${finalStopPercent.toFixed(2)}%)\n`;
        
        message += ` ALVOS:\n`;
        for (let i = 0; i < targets.targets.length; i++) {
            const t = targets.targets[i];
            message += ` Alvo ${i+1} (${t.ratio}:1): ${formatPrice(t.price)} USDT (${t.profitPercent.toFixed(2)}%) - Fechar ${t.partialClose}%\n`;
        }
        
        message += ` Mercado:\n`;
        message += ` LSR: ${asset.lsr.toFixed(2)} (${asset.lsrTrend === 'rising' ? 'subindo ✅' : 'caindo'})\n`;
        message += ` Funding: ${asset.fundingPercent.toFixed(4)}% ${asset.funding > 0 ? 'positivo ✅' : 'negativo'}\n`;
        message += ` RSI 1h: ${asset.rsi?.toFixed(1) || 'N/A'} ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection || 'neutro'}\n`;
        
        message += `STOCH:\n`;
        message += `${formatStochMessage(asset.stoch4h, asset.stoch1d)}\n`;
        
        message += ` Titanium Prime X by @J4Rviz</i>`;
    }
    
    await telegramQueue.add(message);
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i>🚀 TITANIUM PRIME X\n`;
    msg += `✅ Sistema iniciado!\n`;
    msg += `</i>`;
    await telegramQueue.add(msg, true);
}

// =====================================================================
// === MONITOR PRINCIPAL ===
// =====================================================================
const cvdManager = new CVDManager();
let isScanning = false;

async function scanAndAlert() {
    if (isScanning) return;
    isScanning = true;
    
    try {
        const symbols = await getAllSymbols();
        if (!symbols.length) return;
        
        log(`🔍 Escaneando ${symbols.length} símbolos...`, 'info');
        
        for (const s of symbols) {
            if (!cvdManager.subscribedSymbols.has(s.symbol)) {
                cvdManager.subscribeToSymbol(s.symbol);
            }
        }
        
        let count = 0;
        for (const symbolData of symbols) {
            await checkAndAlert(symbolData, cvdManager);
            count++;
            if (count % 10 === 0) await delay(200);
        }
        
        log(`✅ Scan completo. ${count} ativos verificados.`, 'success');
    } catch (error) {
        log(`Erro no scan: ${error.message}`, 'error');
    } finally {
        isScanning = false;
    }
}

// =====================================================================
// === INICIAR MONITOR ===
// =====================================================================
async function startMonitor() {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 TITANIUM PRIME X');
    console.log('='.repeat(70));
    
    loadAlertedSymbols();
    loadFVGMemory();
    
    await sendInitMessage();
    await scanAndAlert();
    
    setInterval(async () => {
        await scanAndAlert();
    }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    saveFVGMemory();
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
