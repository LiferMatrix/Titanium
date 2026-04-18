const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
require('dotenv').config();

// =====================================================================
// === ARQUIVOS DE MEMÓRIA ===
// =====================================================================
const MEMORY_FILE = path.join(__dirname, 'fundingMonitorMemory.json');
const ALERTED_FILE = path.join(__dirname, 'alertedSymbols.json');
const BTC_TF_STATE_FILE = path.join(__dirname, 'btcTimeframeState.json');
const VOLUME_MOMENTUM_FILE = path.join(__dirname, 'volumeMomentumMemory.json');

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
        TELEGRAM_DELAY_MS: 1500,
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
            MIN_VOLUME_CONFIRMATION: 55,
            RSI_BUY_THRESHOLD: 60,
            RSI_SELL_THRESHOLD: 50
        },
        BOLLINGER: {
            PERIOD: 20,
            STD_DEVIATION: 2.2,
            TIMEFRAME: '15m',
            TOUCH_THRESHOLD: 0.04
        },
        CVD: {
            CHECK_INTERVAL_SECONDS: 30,
            CVD_CHANGE_WINDOW: 60
        },
        BTC_MONITOR: {
            ENABLED: true,
            TIMEFRAMES: ['15m', '1h', '4h', '12h', '1d'],
            EMA_PERIOD: 55,
            CHECK_INTERVAL_SECONDS: 60,
            ALERT_COOLDOWN_MINUTES: 5
        }
    }
};

// =====================================================================
// === MEMÓRIA DE CRUZAMENTOS (VOLUME MOMENTUM) ===
// =====================================================================
let volumeMomentumMemory = {
    lastStochK: {},
    lastStochD: {},
    lastCCI: {},
    lastCrossState: {}
};

function loadVolumeMomentumMemory() {
    try {
        if (fs.existsSync(VOLUME_MOMENTUM_FILE)) {
            const data = fs.readFileSync(VOLUME_MOMENTUM_FILE, 'utf8');
            volumeMomentumMemory = JSON.parse(data);
            console.log(`📂 Memória de Volume Momentum carregada`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar memória de Volume Momentum: ${error.message}`);
    }
}

function saveVolumeMomentumMemory() {
    try {
        fs.writeFileSync(VOLUME_MOMENTUM_FILE, JSON.stringify(volumeMomentumMemory, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar memória de Volume Momentum: ${error.message}`);
    }
}

// =====================================================================
// === ESTADO DOS TIMEFRAMES DO BTC ===
// =====================================================================
let btcTimeframeState = {
    '15m': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '1h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '4h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '12h': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 },
    '1d': { isAbove: false, lastAlertSent: 0, currentPrice: 0, emaValue: 0, distance: 0 }
};

let initialStatusSent = false;

// =====================================================================
// === CARREGAR ESTADO DOS TIMEFRAMES ===
// =====================================================================
function loadBTCTimeframeState() {
    try {
        if (fs.existsSync(BTC_TF_STATE_FILE)) {
            const data = fs.readFileSync(BTC_TF_STATE_FILE, 'utf8');
            const loaded = JSON.parse(data);
            btcTimeframeState = loaded;
            console.log(`📂 Estado dos timeframes BTC carregado`);
        }
    } catch (error) {
        console.log(`⚠️ Erro ao carregar estado dos TFs BTC: ${error.message}`);
    }
}

function saveBTCTimeframeState() {
    try {
        fs.writeFileSync(BTC_TF_STATE_FILE, JSON.stringify(btcTimeframeState, null, 2));
    } catch (error) {
        console.log(`⚠️ Erro ao salvar estado dos TFs BTC: ${error.message}`);
    }
}

// =====================================================================
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();
const bollingerCache = new Map();
const lsrTrendCache = new Map();
const stochCache = new Map();
const cciCache = new Map();
const alertedSymbols = new Map();

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

function canAlertBTC(timeframe) {
    const lastAlert = btcTimeframeState[timeframe]?.lastAlertSent || 0;
    const cooldownMs = CONFIG.MONITOR.BTC_MONITOR.ALERT_COOLDOWN_MINUTES * 60 * 1000;
    return (Date.now() - lastAlert) > cooldownMs;
}

function markBTCAlerted(timeframe) {
    if (btcTimeframeState[timeframe]) {
        btcTimeframeState[timeframe].lastAlertSent = Date.now();
        saveBTCTimeframeState();
    }
}

// =====================================================================
// === SISTEMA DE FILA PARA TELEGRAM (RATE LIMITING) ===
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
            
            if (!this.isProcessing) {
                this.processQueue();
            }
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
                console.log(`📊 Rate limit resetado. Próximo minuto.`);
            }
            
            if (this.messageCount >= CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE) {
                const waitTime = 60000 - (now - this.minuteResetTime);
                console.log(`⏳ Rate limit atingido (${this.messageCount}/${CONFIG.TELEGRAM.MAX_MESSAGES_PER_MINUTE}). Aguardando ${Math.ceil(waitTime / 1000)}s...`);
                await delay(waitTime + 1000);
                continue;
            }
            
            const timeSinceLastMessage = now - this.lastMessageTime;
            if (timeSinceLastMessage < CONFIG.TELEGRAM.MESSAGE_DELAY_MS) {
                const waitTime = CONFIG.TELEGRAM.MESSAGE_DELAY_MS - timeSinceLastMessage;
                await delay(waitTime);
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
                console.log(`⚠️ Próximo do rate limit. Aguardando ${CONFIG.TELEGRAM.BURST_DELAY_MS / 1000}s...`);
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
                    console.log(`⚠️ Rate limit 429! Aguardando ${retryAfter}s...`);
                    
                    if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                        await delay(retryAfter * 1000 + 1000);
                        return this.sendWithRetry(message, attempt + 1);
                    }
                }
                
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`⏰ Timeout na requisição Telegram (tentativa ${attempt})`);
            } else {
                console.log(`❌ Erro na tentativa ${attempt}: ${error.message}`);
            }
            
            if (attempt <= CONFIG.TELEGRAM.RETRY_COUNT) {
                const waitTime = CONFIG.TELEGRAM.RETRY_DELAY_MS * attempt;
                console.log(`🔄 Tentando novamente em ${waitTime / 1000}s... (tentativa ${attempt + 1}/${CONFIG.TELEGRAM.RETRY_COUNT + 1})`);
                await delay(waitTime);
                return this.sendWithRetry(message, attempt + 1);
            }
            
            throw error;
        }
    }
}

const telegramQueue = new TelegramQueue();

// =====================================================================
// === FUNÇÕES PARA DETECÇÃO DE FVG (FAIR VALUE GAP) ===
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

function findClosestFVG(fvgs, currentPrice, type = null) {
    let closest = null;
    let minDistance = Infinity;
    
    const fvgsToCheck = type === 'bull' ? fvgs.bull : (type === 'bear' ? fvgs.bear : [...fvgs.bull, ...fvgs.bear]);
    
    for (const fvg of fvgsToCheck) {
        let distance;
        let isAbove = false;
        let isBelow = false;
        let targetPrice = null;
        
        if (fvg.type === 'bull') {
            targetPrice = fvg.bottom;
            if (currentPrice < targetPrice) {
                distance = ((targetPrice - currentPrice) / currentPrice) * 100;
                isBelow = true;
            } else if (currentPrice > fvg.top) {
                distance = ((currentPrice - fvg.top) / currentPrice) * 100;
                isAbove = true;
            } else if (currentPrice >= targetPrice && currentPrice <= fvg.top) {
                distance = 0;
            } else {
                continue;
            }
        } else {
            targetPrice = fvg.top;
            if (currentPrice > targetPrice) {
                distance = ((currentPrice - targetPrice) / currentPrice) * 100;
                isAbove = true;
            } else if (currentPrice < fvg.bottom) {
                distance = ((fvg.bottom - currentPrice) / currentPrice) * 100;
                isBelow = true;
            } else if (currentPrice >= fvg.bottom && currentPrice <= targetPrice) {
                distance = 0;
            } else {
                continue;
            }
        }
        
        if (distance < minDistance) {
            minDistance = distance;
            closest = {
                ...fvg,
                distancePercent: distance,
                targetPrice: targetPrice,
                isAbove,
                isBelow,
                isInside: distance === 0
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
            supports.push({
                price: prices[i],
                index: i,
                time: candles[i].time,
                strength: 1
            });
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
            resistances.push({
                price: prices[i],
                index: i,
                time: candles[i].time,
                strength: 1
            });
        }
    }
    
    const consolidatedSupports = consolidateLevels(supports, 0.005);
    const consolidatedResistances = consolidateLevels(resistances, 0.005);
    
    return { supports: consolidatedSupports, resistances: consolidatedResistances };
}

function consolidateLevels(levels, tolerancePercent) {
    if (levels.length === 0) return [];
    
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const consolidated = [];
    
    for (const level of sorted) {
        if (consolidated.length === 0) {
            consolidated.push({ ...level, strength: level.strength });
            continue;
        }
        
        const last = consolidated[consolidated.length - 1];
        const diffPercent = Math.abs((level.price - last.price) / last.price) * 100;
        
        if (diffPercent < tolerancePercent) {
            last.strength += level.strength;
            last.price = (last.price + level.price) / 2;
        } else {
            consolidated.push({ ...level, strength: level.strength });
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
        
        const closestBullFVG = findClosestFVG(fvgs, currentPrice, 'bull');
        const closestBearFVG = findClosestFVG(fvgs, currentPrice, 'bear');
        const closestSupport = checkProximityToLevel(currentPrice, supports, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        const closestResistance = checkProximityToLevel(currentPrice, resistances, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        
        let zoneType = 'NEUTRO';
        let zoneDescription = '';
        
        if (closestBullFVG && closestBullFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'COMPRA';
            zoneDescription = `FVG Bull ${timeframe} à ${closestBullFVG.distancePercent.toFixed(2)}% (Preço alvo: ${formatPrice(closestBullFVG.targetPrice)})`;
        } else if (closestSupport && closestSupport.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'COMPRA';
            zoneDescription = `Suporte ${timeframe} à ${closestSupport.distancePercent.toFixed(2)}% (Preço: ${formatPrice(closestSupport.targetPrice)})`;
        }
        
        if (closestBearFVG && closestBearFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'VENDA';
            zoneDescription = `FVG Bear ${timeframe} à ${closestBearFVG.distancePercent.toFixed(2)}% (Preço alvo: ${formatPrice(closestBearFVG.targetPrice)})`;
        } else if (closestResistance && closestResistance.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'VENDA';
            zoneDescription = `Resistência ${timeframe} à ${closestResistance.distancePercent.toFixed(2)}% (Preço: ${formatPrice(closestResistance.targetPrice)})`;
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
            zoneType,
            zoneDescription
        };
        
    } catch (error) {
        console.log(`⚠️ Erro ao analisar estrutura ${symbol} ${timeframe}: ${error.message}`);
        return null;
    }
}

async function detectVolumeAnomaly(symbol, timeframe = '1h') {
    try {
        const candles = await getCandles(symbol, timeframe, 30);
        if (!candles || candles.length < 20) return null;
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const prevVolumes = volumes.slice(0, -1);
        
        const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
        const volumeRatio = currentVolume / avgVolume;
        
        let type = null;
        let intensity = '';
        
        if (volumeRatio >= CONFIG.MONITOR.VOLUME_BULL_THRESHOLD) {
            type = 'bull';
            if (volumeRatio >= 3) intensity = '🔥🔥🔥';
            else if (volumeRatio >= 2) intensity = '🔥🔥';
            else intensity = '🔥';
        } else if (volumeRatio <= (1 / CONFIG.MONITOR.VOLUME_BEAR_THRESHOLD)) {
            type = 'bear';
            if (volumeRatio <= 0.33) intensity = '❄️❄️❄️';
            else if (volumeRatio <= 0.5) intensity = '❄️❄️';
            else intensity = '❄️';
        }
        
        return {
            type,
            volumeRatio,
            currentVolume,
            avgVolume,
            intensity,
            isHighVolume: volumeRatio >= CONFIG.MONITOR.VOLUME_BULL_THRESHOLD,
            isLowVolume: volumeRatio <= (1 / CONFIG.MONITOR.VOLUME_BEAR_THRESHOLD)
        };
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === NOVA FUNÇÃO: DETECTAR VOLUME ANORMAL COMPRADOR/VENDEDOR 3 MIN ===
// =====================================================================
async function detectVolume3mAnomaly(symbol, type = 'buyer') {
    try {
        const candles = await getCandles(symbol, '3m', 30);
        if (!candles || candles.length < 20) return null;
        
        const volumes = candles.map(c => c.volume);
        const currentVolume = volumes[volumes.length - 1];
        const prevVolumes = volumes.slice(0, -1);
        
        const avgVolume = prevVolumes.reduce((a, b) => a + b, 0) / prevVolumes.length;
        const volumeRatio = currentVolume / avgVolume;
        
        if (type === 'buyer') {
            const isAnomaly = volumeRatio >= CONFIG.MONITOR.VOLUME_3M_BUYER_THRESHOLD;
            return {
                isAnomaly,
                volumeRatio,
                currentVolume,
                avgVolume,
                type: 'buyer'
            };
        } else if (type === 'seller') {
            const isAnomaly = volumeRatio >= CONFIG.MONITOR.VOLUME_3M_SELLER_THRESHOLD;
            return {
                isAnomaly,
                volumeRatio,
                currentVolume,
                avgVolume,
                type: 'seller'
            };
        }
        
        return null;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === ANÁLISE DE VOLUME - AGORA COM VOLUME 3M ===
// =====================================================================
async function analyzeVolumeAlert(symbol, currentPrice) {
    try {
        const volume1h = await detectVolumeAnomaly(symbol, '1h');
        const volume4h = await detectVolumeAnomaly(symbol, '4h');
        const volume3mBuyer = await detectVolume3mAnomaly(symbol, 'buyer');
        const volume3mSeller = await detectVolume3mAnomaly(symbol, 'seller');
        
        const structure1h = await analyzeStructure(symbol, '1h', currentPrice);
        const structure4h = await analyzeStructure(symbol, '4h', currentPrice);
        
        let alertType = null;
        let mainTimeframe = null;
        let volumeData = null;
        let structureData = null;
        
        // ALERTA DE COMPRA: Volume anormal comprador 3m + FVG Bull ou Suporte
        if (volume3mBuyer && volume3mBuyer.isAnomaly) {
            if (structure4h && structure4h.zoneType === 'COMPRA') {
                alertType = 'VOLUME_BULL';
                mainTimeframe = '4h';
                volumeData = { ...volume4h, volume3mAnomaly: volume3mBuyer };
                structureData = structure4h;
            } else if (structure1h && structure1h.zoneType === 'COMPRA') {
                alertType = 'VOLUME_BULL';
                mainTimeframe = '1h';
                volumeData = { ...volume1h, volume3mAnomaly: volume3mBuyer };
                structureData = structure1h;
            }
        }
        
        // ALERTA DE VENDA: Volume anormal vendedor 3m + FVG Bear ou Resistência
        if (volume3mSeller && volume3mSeller.isAnomaly) {
            if (structure4h && structure4h.zoneType === 'VENDA') {
                alertType = 'VOLUME_BEAR';
                mainTimeframe = '4h';
                volumeData = { ...volume4h, volume3mAnomaly: volume3mSeller };
                structureData = structure4h;
            } else if (structure1h && structure1h.zoneType === 'VENDA') {
                alertType = 'VOLUME_BEAR';
                mainTimeframe = '1h';
                volumeData = { ...volume1h, volume3mAnomaly: volume3mSeller };
                structureData = structure1h;
            }
        }
        
        if (!alertType) return null;
        
        let alignment = '';
        let tradeSignal = '';
        
        if (alertType === 'VOLUME_BULL') {
            alignment = '✅ ALINHADO ';
            tradeSignal = '🟢 CONSIDERAR COMPRA';
        } else if (alertType === 'VOLUME_BEAR') {
            alignment = '✅ ALINHADO';
            tradeSignal = '🔴 CONSIDERAR CORREÇÃO';
        }
        
        return {
            alertType,
            mainTimeframe,
            volume: volumeData,
            structure: structureData,
            alignment,
            tradeSignal,
            volume1h,
            volume4h,
            volume3mBuyer,
            volume3mSeller,
            structure1h,
            structure4h
        };
        
    } catch (error) {
        console.log(`⚠️ Erro analyzeVolumeAlert ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR STOCHASTIC (5,3,3) ===
// =====================================================================
async function calculateStochastic(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_stoch_${timeframe}`;
        const now = Date.now();
        const cached = stochCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, timeframe, 50);
        if (!candles || candles.length < 20) return null;
        
        const periodK = 5;
        const periodD = 3;
        const periodSlow = 3;
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const kValues = [];
        
        for (let i = periodK - 1; i < closes.length; i++) {
            let highestHigh = Math.max(...highs.slice(i - periodK + 1, i + 1));
            let lowestLow = Math.min(...lows.slice(i - periodK + 1, i + 1));
            let currentClose = closes[i];
            
            let k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
            kValues.push(k);
        }
        
        const dValues = [];
        for (let i = periodD - 1; i < kValues.length; i++) {
            let sum = 0;
            for (let j = 0; j < periodD; j++) {
                sum += kValues[i - j];
            }
            dValues.push(sum / periodD);
        }
        
        const slowDValues = [];
        for (let i = periodSlow - 1; i < dValues.length; i++) {
            let sum = 0;
            for (let j = 0; j < periodSlow; j++) {
                sum += dValues[i - j];
            }
            slowDValues.push(sum / periodSlow);
        }
        
        const currentK = kValues[kValues.length - 1];
        const currentD = slowDValues[slowDValues.length - 1];
        const prevK = kValues[kValues.length - 2];
        const prevD = slowDValues[slowDValues.length - 2];
        
        const kTrend = currentK > prevK ? '⤴️' : (currentK < prevK ? '⤵️' : '');
        const dTrend = currentD > prevD ? '⤴️' : (currentD < prevD ? '⤵️' : '');
        
        const isOverbought = currentK > 80 && currentD > 80;
        const isOversold = currentK < 20 && currentD < 20;
        
        // NOVO SISTEMA DE CORES PARA O ESTOCÁSTICO
        let status = '';
        const kValue = currentK;
        
        if (kValue < 15) {
            status = '🔵'; // Azul - Extremamente oversold
        } else if (kValue >= 15 && kValue < 25) {
            status = '🟢'; // Verde - Oversold moderado
        } else if (kValue >= 25 && kValue < 45) {
            status = '🟡'; // Amarelo - Neutro baixo
        } else if (kValue >= 45 && kValue < 70) {
            status = '🟠'; // Laranja - Neutro alto
        } else {
            status = '🔴'; // Vermelho - Overbought
        }
        
        const result = {
            k: currentK.toFixed(0),
            d: currentD.toFixed(0),
            kTrend: kTrend,
            dTrend: dTrend,
            status: status,
            isOverbought,
            isOversold,
            rawK: currentK,
            rawD: currentD
        };
        
        stochCache.set(cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR CCI COM EMA 5 ===
// =====================================================================
async function calculateCCI(symbol, timeframe) {
    try {
        const cacheKey = `${symbol}_cci_${timeframe}`;
        const now = Date.now();
        const cached = cciCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const period = 20;
        const emaPeriod = 5;
        
        const candles = await getCandles(symbol, timeframe, 100);
        if (!candles || candles.length < period + emaPeriod) return null;
        
        const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
        
        const cciValues = [];
        
        for (let i = period - 1; i < typicalPrices.length; i++) {
            const slice = typicalPrices.slice(i - period + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / period;
            
            let meanDeviation = 0;
            for (let j = 0; j < slice.length; j++) {
                meanDeviation += Math.abs(slice[j] - sma);
            }
            meanDeviation = meanDeviation / period;
            
            if (meanDeviation === 0) {
                cciValues.push(0);
            } else {
                const cci = (typicalPrices[i] - sma) / (0.015 * meanDeviation);
                cciValues.push(cci);
            }
        }
        
        const emaValues = [];
        if (cciValues.length >= emaPeriod) {
            const multiplier = 2 / (emaPeriod + 1);
            let ema = cciValues[0];
            emaValues.push(ema);
            
            for (let i = 1; i < cciValues.length; i++) {
                ema = (cciValues[i] - ema) * multiplier + ema;
                emaValues.push(ema);
            }
        }
        
        const currentCCI = cciValues[cciValues.length - 1];
        const currentEMA = emaValues[emaValues.length - 1];
        const prevCCI = cciValues[cciValues.length - 2];
        
        const cciDirection = currentCCI > prevCCI ? '⤴️' : (currentCCI < prevCCI ? '⤵️' : '');
        
        let crossStatus = '';
        
        if (currentCCI > currentEMA) {
            crossStatus = 'ALTA';
        } else if (currentCCI < currentEMA) {
            crossStatus = 'BAIXA';
        } else {
            crossStatus = 'NEUTRO';
        }
        
        let valueCircle = '';
        
        if (currentCCI <= -200) {
            valueCircle = '🔵';
        } else if (currentCCI <= -100) {
            valueCircle = '🟢';
        } else if (currentCCI <= -50) {
            valueCircle = '🟡';
        } else if (currentCCI <= 0) {
            valueCircle = '🟡';
        } else if (currentCCI <= 50) {
            valueCircle = '🟠';
        } else if (currentCCI <= 100) {
            valueCircle = '🟠';
        } else if (currentCCI <= 200) {
            valueCircle = '🔴';
        } else {
            valueCircle = '🔥';
        }
        
        const result = {
            crossStatus: crossStatus,
            direction: cciDirection,
            circle: valueCircle,
            rawCCI: currentCCI,
            rawEMA: currentEMA
        };
        
        cciCache.set(cacheKey, { data: result, timestamp: now });
        return result;
        
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR CRUZAMENTO STOCH + CCI (VOLUME MOMENTUM) ===
// =====================================================================
function detectVolumeMomentumCross(symbol, stoch4h, cci4h) {
    if (!stoch4h || !cci4h) return null;
    
    const symbolKey = symbol;
    
    if (!volumeMomentumMemory.lastStochK[symbolKey]) {
        volumeMomentumMemory.lastStochK[symbolKey] = stoch4h.rawK;
        volumeMomentumMemory.lastStochD[symbolKey] = stoch4h.rawD;
        volumeMomentumMemory.lastCCI[symbolKey] = cci4h.crossStatus;
        volumeMomentumMemory.lastCrossState[symbolKey] = null;
        saveVolumeMomentumMemory();
        return null;
    }
    
    const prevStochK = volumeMomentumMemory.lastStochK[symbolKey];
    const prevStochD = volumeMomentumMemory.lastStochD[symbolKey];
    const prevCCIStatus = volumeMomentumMemory.lastCCI[symbolKey];
    const prevCrossState = volumeMomentumMemory.lastCrossState[symbolKey];
    
    const currentStochK = stoch4h.rawK;
    const currentStochD = stoch4h.rawD;
    const currentCCIStatus = cci4h.crossStatus;
    
    let stochBullCross = false;
    let stochBearCross = false;
    
    if (prevStochK < prevStochD && currentStochK > currentStochD) {
        stochBullCross = true;
    }
    if (prevStochK > prevStochD && currentStochK < currentStochD) {
        stochBearCross = true;
    }
    
    let cciBullCross = false;
    let cciBearCross = false;
    
    if (prevCCIStatus === 'BAIXA' && currentCCIStatus === 'ALTA') {
        cciBullCross = true;
    }
    if (prevCCIStatus === 'ALTA' && currentCCIStatus === 'BAIXA') {
        cciBearCross = true;
    }
    
    volumeMomentumMemory.lastStochK[symbolKey] = currentStochK;
    volumeMomentumMemory.lastStochD[symbolKey] = currentStochD;
    volumeMomentumMemory.lastCCI[symbolKey] = currentCCIStatus;
    
    let newCrossState = null;
    
    if (stochBullCross && cciBullCross) {
        newCrossState = 'bull';
    } else if (stochBearCross && cciBearCross) {
        newCrossState = 'bear';
    }
    
    const wasCrossed = (prevCrossState === 'bull' || prevCrossState === 'bear');
    const isNowCrossed = (newCrossState === 'bull' || newCrossState === 'bear');
    
    let shouldAlert = false;
    let alertType = null;
    
    if (!wasCrossed && isNowCrossed) {
        shouldAlert = true;
        alertType = newCrossState === 'bull' ? 'VOLUME_MOMENTUM_BULL' : 'VOLUME_MOMENTUM_BEAR';
    }
    
    volumeMomentumMemory.lastCrossState[symbolKey] = newCrossState;
    saveVolumeMomentumMemory();
    
    if (shouldAlert) {
        return alertType;
    }
    
    return null;
}

// =====================================================================
// === FUNÇÕES PARA FORMATAR MENSAGENS ===
// =====================================================================
function formatStochMessage(stoch4h, stoch1d) {
    let msg = '';
    if (stoch4h) {
        msg += `Stoch 4H: K${stoch4h.k}${stoch4h.kTrend} D${stoch4h.d}${stoch4h.dTrend} ${stoch4h.status}\n`;
    }
    if (stoch1d) {
        msg += `Stoch 1D: K${stoch1d.k}${stoch1d.kTrend} D${stoch1d.d}${stoch1d.dTrend} ${stoch1d.status}\n`;
    }
    return msg;
}

function formatCCIMessage(cci4h, cci1d) {
    let msg = '';
    if (cci4h) {
        msg += `CCI 4H: ${cci4h.crossStatus} ${cci4h.direction} ${cci4h.circle}\n`;
    }
    if (cci1d) {
        msg += `CCI 1D: ${cci1d.crossStatus} ${cci1d.direction} ${cci1d.circle}\n`;
    }
    return msg;
}

function formatStructureMessage(structure, timeframe) {
    if (!structure) return '';
    
    let msg = `📐 Estrutura ${timeframe}:\n`;
    
    if (structure.closestBullFVG) {
        const fvg = structure.closestBullFVG;
        msg += `  🟢 FVG Bull: ${fvg.distancePercent.toFixed(2)}% ➜ ${formatPrice(fvg.targetPrice)} USDT\n`;
    }
    
    if (structure.closestBearFVG) {
        const fvg = structure.closestBearFVG;
        msg += `  🔴 FVG Bear: ${fvg.distancePercent.toFixed(2)}% ➜ ${formatPrice(fvg.targetPrice)} USDT\n`;
    }
    
    if (structure.closestSupport) {
        msg += `  🟢 Suporte: ${structure.closestSupport.distancePercent.toFixed(2)}% ➜ ${formatPrice(structure.closestSupport.targetPrice)} USDT\n`;
    }
    
    if (structure.closestResistance) {
        msg += `  🔴 Resistência: ${structure.closestResistance.distancePercent.toFixed(2)}% ➜ ${formatPrice(structure.closestResistance.targetPrice)} USDT\n`;
    }
    
    msg += `  🎯 Zona: ${structure.zoneType} - ${structure.zoneDescription}\n`;
    
    return msg;
}

function formatVolumeMessage(volume, timeframe) {
    if (!volume || !volume.type) return '';
    const volumeEmoji = volume.type === 'bull' ? '🔥' : '❄️';
    const volumeText = volume.type === 'bull' ? 'ALTO' : 'BAIXO';
    return `${volumeEmoji} Vol ${timeframe}: ${volumeText} ${volume.volumeRatio.toFixed(2)} ${volume.intensity}\n`;
}

// =====================================================================
// === FUNÇÃO PARA ANALISAR STOCH E GERAR ALERTA DE CONDIÇÃO ===
// =====================================================================
function analisarStochParaOperacao(stoch4h, stoch1d, zoneType) {
    let alertaStoch = '';
    let condicaoFavoravel = true;
    
    if (zoneType === 'COMPRA') {
        if (stoch4h && stoch4h.isOversold) {
            alertaStoch = ` STOCH 4H  (K${stoch4h.k}) - BAIXO.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.isOverbought) {
            alertaStoch = ` STOCH 4H  (K${stoch4h.k}) - ALTO.`;
            condicaoFavoravel = false;
        } else if (stoch4h && stoch4h.rawK < 30) {
            alertaStoch = ` STOCH 4H  ${stoch4h.k} - NEUTRO. .`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.rawK > 70) {
            alertaStoch = ` STOCH 4H  ${stoch4h.k} - NEUTRO!`;
            condicaoFavoravel = false;
        } else {
            alertaStoch = ` STOCH 4H  ${stoch4h.k} - NEUTRO.`;
            condicaoFavoravel = true;
        }
        
        if (stoch1d && stoch1d.isOversold) {
            alertaStoch += `\n STOCH 1D BAIXO (K${stoch1d.k}) - FORTALECE COMPRA!`;
        } else if (stoch1d && stoch1d.isOverbought) {
            alertaStoch += `\n STOCH 1D ALTO (K${stoch1d.k}) - CONTRÁRIO PARA COMPRA!`;
            condicaoFavoravel = false;
        }
        
    } else if (zoneType === 'VENDA') {
        if (stoch4h && stoch4h.isOverbought) {
            alertaStoch = ` STOCH 4H ALTO (K${stoch4h.k}) - FAVORÁVEL PARA VENDA!.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.isOversold) {
            alertaStoch = ` STOCH 4H BAIXO (K${stoch4h.k}) - NÃO FAVORÁVEL PARA VENDA!.`;
            condicaoFavoravel = false;
        } else if (stoch4h && stoch4h.rawK > 70) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - PRÓXIMO A ZONA DE VENDA.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.rawK < 30) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - PRÓXIMO A ZONA DE COMPRA!`;
            condicaoFavoravel = false;
        } else {
            alertaStoch = ` STOCH 4H ${stoch4h.k} .`;
            condicaoFavoravel = true;
        }
        
        if (stoch1d && stoch1d.isOverbought) {
            alertaStoch += `\n STOCH 1D ALTO (K${stoch1d.k}) - FORTALECE VENDA!`;
        } else if (stoch1d && stoch1d.isOversold) {
            alertaStoch += `\n STOCH 1D BAIXO (K${stoch1d.k}) - CONTRÁRIO PARA VENDA!`;
            condicaoFavoravel = false;
        }
    }
    
    return { alertaStoch, condicaoFavoravel };
}

// =====================================================================
// === FUNÇÃO PARA GERAR DICA ESTRATÉGICA COM ANÁLISE DO STOCH ===
// =====================================================================
function getTradeDica(zoneType, structureData, currentPrice, stoch4h, stoch1d) {
    if (!structureData) return '';
    
    if (zoneType === 'COMPRA') {
        let targetPrice = '';
        if (structureData.closestBullFVG) {
            targetPrice = formatPrice(structureData.closestBullFVG.targetPrice);
        } else if (structureData.closestSupport) {
            targetPrice = formatPrice(structureData.closestSupport.targetPrice);
        }
        
        const stochAnalysis = analisarStochParaOperacao(stoch4h, stoch1d, 'COMPRA');
        
        let dica = `💡🤖 DICA de Compra:\n`;
        dica += `• Aguarde um PULLBACK até próximo de ${targetPrice} USDT\n`;
        dica += `• Use STOP abaixo da Compra (${(currentPrice * 0.98).toFixed(4)} USDT)\n`;
        dica += `• ${stochAnalysis.alertaStoch}\n`;
        
        if (!stochAnalysis.condicaoFavoravel) {
            
        }
        
        return dica;
        
    } else if (zoneType === 'VENDA') {
        let targetPrice = '';
        if (structureData.closestBearFVG) {
            targetPrice = formatPrice(structureData.closestBearFVG.targetPrice);
        } else if (structureData.closestResistance) {
            targetPrice = formatPrice(structureData.closestResistance.targetPrice);
        }
        
        const stochAnalysis = analisarStochParaOperacao(stoch4h, stoch1d, 'VENDA');
        
        let dica = `💡🤖 DICA na Correção:\n`;
        dica += `• Aguarde um PULLBACK (subida) até próximo de ${targetPrice} USDT\n`;
        dica += `• Use STOP acima da Venda (${(currentPrice * 1.02).toFixed(4)} USDT)\n`;
        dica += `• ${stochAnalysis.alertaStoch}\n`;
        
        if (!stochAnalysis.condicaoFavoravel) {
            
        }
        
        return dica;
    }
    
    return '';
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR EMA ===
// =====================================================================
function calculateEMA(prices, period) {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

// =====================================================================
// === FUNÇÃO PARA CALCULAR RSI ===
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
    const firstRSI = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
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
// === FUNÇÃO PARA CALCULAR BOLLINGER BANDS ===
// =====================================================================
function calculateBollingerBands(prices, period = 20, stdDev = 2.2) {
    if (prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
        sma: sma,
        upper: sma + (stdDev * standardDeviation),
        lower: sma - (stdDev * standardDeviation)
    };
}

// =====================================================================
// === FUNÇÃO PARA VERIFICAR BOLLINGER TOUCH ===
// =====================================================================
async function checkBollingerTouch(symbol, type) {
    try {
        const now = Date.now();
        const cached = bollingerCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const candles = await getCandles(symbol, CONFIG.MONITOR.BOLLINGER.TIMEFRAME, CONFIG.MONITOR.BOLLINGER.PERIOD + 10);
        if (!candles || candles.length < CONFIG.MONITOR.BOLLINGER.PERIOD) return false;
        
        const prices = candles.map(c => c.close);
        const bollinger = calculateBollingerBands(prices, CONFIG.MONITOR.BOLLINGER.PERIOD, CONFIG.MONITOR.BOLLINGER.STD_DEVIATION);
        if (!bollinger) return false;
        
        const currentPrice = prices[prices.length - 1];
        const threshold = CONFIG.MONITOR.BOLLINGER.TOUCH_THRESHOLD;
        
        let result = false;
        
        if (type === 'buy') {
            const lowerBand = bollinger.lower;
            const distance = (lowerBand - currentPrice) / currentPrice;
            result = currentPrice <= lowerBand || (distance > 0 && distance <= threshold);
        } else {
            const upperBand = bollinger.upper;
            const distance = (currentPrice - upperBand) / currentPrice;
            result = currentPrice >= upperBand || (distance > 0 && distance <= threshold);
        }
        
        bollingerCache.set(symbol, {
            data: result,
            timestamp: now
        });
        
        return result;
    } catch (error) {
        return false;
    }
}

// =====================================================================
// === FUNÇÃO PARA VERIFICAR TENDÊNCIA DO LSR ===
// =====================================================================
async function getLSRTrend(symbol) {
    try {
        const now = Date.now();
        const cached = lsrTrendCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.data;
        }
        
        const period = CONFIG.MONITOR.LSR_15M_PERIOD;
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data || data.length < 2) {
            return { trend: 'stable', changePercent: 0 };
        }
        
        const currentLSR = parseFloat(data[0].longShortRatio);
        const previousLSR = parseFloat(data[1].longShortRatio);
        
        const changePercent = ((currentLSR - previousLSR) / previousLSR) * 100;
        
        let trend = 'stable';
        if (changePercent > CONFIG.MONITOR.LSR_TREND_THRESHOLD) {
            trend = 'rising';
        } else if (changePercent < -CONFIG.MONITOR.LSR_TREND_THRESHOLD) {
            trend = 'falling';
        }
        
        const result = { trend, changePercent, currentLSR, previousLSR };
        
        lsrTrendCache.set(symbol, {
            data: result,
            timestamp: now
        });
        
        return result;
    } catch (error) {
        return { trend: 'stable', changePercent: 0 };
    }
}

// =====================================================================
// === FUNÇÃO PARA ENCONTRAR PIVÔS ===
// =====================================================================
function findPivots(data, lookback = 3) {
    const pivots = { highs: [], lows: [] };
    
    for (let i = lookback; i < data.length - lookback; i++) {
        let isHigh = true;
        let isLow = true;
        
        for (let j = 1; j <= lookback; j++) {
            if (data[i] <= data[i - j] || data[i] <= data[i + j]) isHigh = false;
            if (data[i] >= data[i - j] || data[i] >= data[i + j]) isLow = false;
        }
        
        if (isHigh) pivots.highs.push({ index: i, value: data[i] });
        if (isLow) pivots.lows.push({ index: i, value: data[i] });
    }
    
    return pivots;
}

// =====================================================================
// === FUNÇÃO PARA DETECTAR DIVERGÊNCIAS ===
// =====================================================================
function findRSIDivergences(prices, rsiValues, volumeProfile = null) {
    const divergences = { bullish: [], bearish: [] };
    
    if (prices.length < 30 || rsiValues.length < 30) return divergences;
    
    const pricePivots = findPivots(prices, 3);
    const rsiPivots = findPivots(rsiValues, 3);
    
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            
            if (priceLower) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 2);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 2);
                
                if (rsiLow1 && rsiLow2) {
                    const rsiHigher = rsiLow2.value > rsiLow1.value;
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    
                    if (rsiHigher && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'buyers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bullish.push({
                            type: 'bullish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    for (let i = 0; i < pricePivots.highs.length; i++) {
        for (let j = i + 1; j < pricePivots.highs.length; j++) {
            const priceHigh1 = pricePivots.highs[i];
            const priceHigh2 = pricePivots.highs[j];
            
            const priceHigher = priceHigh2.value > priceHigh1.value;
            
            if (priceHigher) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 2);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 2);
                
                if (rsiHigh1 && rsiHigh2) {
                    const rsiLower = rsiHigh2.value < rsiHigh1.value;
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    
                    if (rsiLower && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH) {
                        let volumeScore = 0;
                        let volumeConfirmed = false;
                        
                        if (volumeProfile && volumeProfile.dominant === 'sellers') {
                            volumeScore = Math.floor(volumeProfile.dominantRatio / 10);
                            volumeScore = Math.min(volumeScore, 9);
                            volumeConfirmed = volumeProfile.dominantRatio >= CONFIG.MONITOR.RSI.MIN_VOLUME_CONFIRMATION;
                        }
                        
                        divergences.bearish.push({
                            type: 'bearish',
                            strength: strength,
                            volumeScore: volumeScore,
                            volumeConfirmed: volumeConfirmed
                        });
                    }
                }
            }
        }
    }
    
    return divergences;
}

// =====================================================================
// === ANALISAR DIVERGÊNCIAS ===
// =====================================================================
async function analyzeDivergences(symbol, cvdManager) {
    const cacheKey = `${symbol}_divergences`;
    const now = Date.now();
    const cached = divergenceCache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < 300000) {
        return cached.data;
    }
    
    const result = {
        hasBullishDivergence: false,
        hasBearishDivergence: false,
        bullishTimeframes: [],
        bearishTimeframes: [],
        bestBullishVolumeScore: 0,
        bestBearishVolumeScore: 0,
        hasBullish15mPlusOther: false,
        hasBearish15mPlusOther: false
    };
    
    const volumeProfile = cvdManager.getVolumeProfile(symbol, 5);
    
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
            
            const divergences = findRSIDivergences(prices, rsi, volumeProfile);
            
            if (divergences.bullish.length > 0) {
                result.hasBullishDivergence = true;
                result.bullishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bullish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBullishVolumeScore) {
                    result.bestBullishVolumeScore = maxVolumeScore;
                }
                
                if (timeframe === '15m') {
                    bullishOn15m = true;
                } else {
                    bullishOtherTimeframes.push(timeframe);
                }
            }
            
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
                result.bearishTimeframes.push(timeframe);
                
                const maxVolumeScore = Math.max(...divergences.bearish.map(d => d.volumeScore));
                if (maxVolumeScore > result.bestBearishVolumeScore) {
                    result.bestBearishVolumeScore = maxVolumeScore;
                }
                
                if (timeframe === '15m') {
                    bearishOn15m = true;
                } else {
                    bearishOtherTimeframes.push(timeframe);
                }
            }
            
        } catch (error) {}
    }
    
    result.hasBullish15mPlusOther = bullishOn15m && bullishOtherTimeframes.length > 0;
    result.hasBearish15mPlusOther = bearishOn15m && bearishOtherTimeframes.length > 0;
    
    divergenceCache.set(cacheKey, {
        data: result,
        timestamp: now
    });
    
    return result;
}

// =====================================================================
// === BUSCAR CANDLES ===
// =====================================================================
async function getCandles(symbol, interval, limit = 100) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
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
        return [];
    }
}

// =====================================================================
// === OBTER RSI 1h ===
// =====================================================================
async function getRSIForSymbol(symbol) {
    try {
        const now = Date.now();
        const cached = rsiCache.get(symbol);
        if (cached && (now - cached.timestamp) < 300000) {
            return cached.value;
        }
        
        const candles = await getCandles(symbol, '1h', 50);
        if (!candles || candles.length < 30) return null;
        
        const prices = candles.map(c => c.close);
        const rsi = calculateRSI(prices, 14);
        if (!rsi || rsi.length === 0) return null;
        
        const rsiValue = rsi[rsi.length - 1];
        
        rsiCache.set(symbol, {
            value: rsiValue,
            timestamp: now
        });
        
        return rsiValue;
    } catch (error) {
        return null;
    }
}

// =====================================================================
// === EMOJI BASEADO NO RSI ===
// =====================================================================
function getRSIEmoji(rsiValue) {
    if (rsiValue === null || rsiValue === undefined) return '⚪';
    if (rsiValue < 20) return '🔵';
    if (rsiValue <= 30) return '🟢';
    if (rsiValue <= 45) return '🟡';
    if (rsiValue <= 58) return '🟠';
    if (rsiValue <= 75) return '🔴';
    return '🔥';
}

// =====================================================================
// === BUSCAR TODOS OS SÍMBOLOS ===
// =====================================================================
async function getAllSymbols() {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const data = await res.json();
        const filtered = data.filter(i => 
            i.symbol.endsWith('USDT') && 
            parseFloat(i.quoteVolume) >= CONFIG.MONITOR.MIN_VOLUME_USDT && 
            !CONFIG.MONITOR.EXCLUDE_SYMBOLS.includes(i.symbol)
        ).slice(0, CONFIG.MONITOR.MAX_SYMBOLS);
        
        return filtered.map(i => ({
            symbol: i.symbol,
            price: parseFloat(i.lastPrice),
            volume24h: parseFloat(i.quoteVolume)
        }));
    } catch (error) {
        log(`Erro ao buscar símbolos: ${error.message}`, 'error');
        return [];
    }
}

// =====================================================================
// === BUSCAR FUNDING RATES ===
// =====================================================================
async function getFundingRates(symbols) {
    try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
        const data = await res.json();
        const result = {};
        for (const i of data) {
            if (symbols.includes(i.symbol)) {
                result[i.symbol] = parseFloat(i.lastFundingRate);
            }
        }
        return result;
    } catch (error) {
        log(`Erro funding: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === BUSCAR LSR ===
// =====================================================================
async function getLSRData(symbols) {
    try {
        const period = CONFIG.MONITOR.LSRS_PERIOD;
        const promises = symbols.map(async s => {
            try {
                const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=${period}&limit=1`;
                const res = await fetch(url);
                const data = await res.json();
                return { symbol: s, lsr: data && data.length ? parseFloat(data[0].longShortRatio) : null };
            } catch {
                return { symbol: s, lsr: null };
            }
        });
        const results = await Promise.all(promises);
        const result = {};
        for (const i of results) {
            result[i.symbol] = i.lsr;
        }
        return result;
    } catch (error) {
        log(`Erro LSR: ${error.message}`, 'error');
        return {};
    }
}

// =====================================================================
// === CVD MANAGER VIA WEBSOCKET ===
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
            value: 0,
            history: [],
            lastUpdate: Date.now(),
            buyVolume: 0,
            sellVolume: 0,
            lastPrice: null,
            ws: null,
            connected: false,
            direction: '',
            directionChange: 0
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
            if (data) {
                data.ws = ws;
                data.connected = true;
            }
        });
        
        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data);
                this.processTrade(symbol, trade);
            } catch (error) {}
        });
        
        ws.on('error', () => {
            this.handleDisconnect(symbol);
        });
        
        ws.on('close', () => {
            this.handleDisconnect(symbol);
        });
        
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
        
        data.history.push({
            timestamp: Date.now(),
            delta: delta,
            volume: volume,
            cvd: data.value
        });
        
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
        const changePercent = Math.abs(change / (Math.abs(oldCVD.cvd) || 1)) * 100;
        
        if (change > 0 && changePercent >= 1) data.direction = '⤴️';
        else if (change < 0 && changePercent >= 1) data.direction = '⤵️';
        else data.direction = '';
    }
    
    handleDisconnect(symbol) {
        const attempts = this.reconnectAttempts.get(symbol) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, attempts);
            setTimeout(() => {
                this.reconnectAttempts.set(symbol, attempts + 1);
                this.connectWebSocket(symbol);
            }, delay);
        } else {
            const data = this.cvdData.get(symbol);
            if (data && data.ws) {
                try { data.ws.terminate(); } catch(e) {}
            }
        }
    }
    
    unsubscribeFromSymbol(symbol) {
        const data = this.cvdData.get(symbol);
        if (data && data.ws) {
            try { data.ws.close(); data.ws.terminate(); } catch(e) {}
        }
        this.subscribedSymbols.delete(symbol);
        this.cvdData.delete(symbol);
    }
    
    getCVD(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return null;
        return { direction: data.direction };
    }
    
    getCVDValue(symbol) {
        const data = this.cvdData.get(symbol);
        if (!data) return '';
        return data.direction;
    }
    
    getVolumeProfile(symbol, minutesAgo = 5) {
        const data = this.cvdData.get(symbol);
        if (!data || data.history.length === 0) return null;
        
        const now = Date.now();
        const cutoff = now - (minutesAgo * 60 * 1000);
        
        let buyVolume = 0, sellVolume = 0, totalVolume = 0;
        
        for (const trade of data.history) {
            if (trade.timestamp >= cutoff) {
                if (trade.delta > 0) buyVolume += trade.volume;
                else sellVolume += trade.volume;
                totalVolume += trade.volume;
            }
        }
        
        if (totalVolume === 0) return null;
        
        const buyerRatio = (buyVolume / totalVolume) * 100;
        const sellerRatio = (sellVolume / totalVolume) * 100;
        
        return {
            buyerRatio: buyerRatio,
            sellerRatio: sellerRatio,
            totalVolume: totalVolume,
            dominant: buyerRatio > sellerRatio ? 'buyers' : 'sellers',
            dominantRatio: Math.max(buyerRatio, sellerRatio)
        };
    }
    
    cleanup() {
        for (const symbol of this.subscribedSymbols) {
            this.unsubscribeFromSymbol(symbol);
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
// === VERIFICAR CRITÉRIOS E ENVIAR ALERTA (ALTCOINS) ===
// =====================================================================
async function checkAndAlert(symbolData, cvdManager) {
    const { symbol: fullSymbol, price, volume24h } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
    
    try {
        const [funding, lsr, rsiValue, divergences, lsrTrendData] = await Promise.all([
            getFundingRates([fullSymbol]).then(r => r[fullSymbol]),
            getLSRData([fullSymbol]).then(r => r[fullSymbol]),
            getRSIForSymbol(fullSymbol),
            analyzeDivergences(fullSymbol, cvdManager),
            getLSRTrend(fullSymbol)
        ]);
        
        if (funding === undefined || !lsr || !rsiValue) return;
        
        const bollingerBuy = await checkBollingerTouch(fullSymbol, 'buy');
        const bollingerSell = await checkBollingerTouch(fullSymbol, 'sell');
        const cvd = cvdManager.getCVD(fullSymbol);
        
        const [stoch4h, stoch1d, cci4h, cci1d] = await Promise.all([
            calculateStochastic(fullSymbol, '4h'),
            calculateStochastic(fullSymbol, '1d'),
            calculateCCI(fullSymbol, '4h'),
            calculateCCI(fullSymbol, '1d')
        ]);
        
        const volumeAlert = await analyzeVolumeAlert(fullSymbol, price);
        const volumeMomentumSignal = detectVolumeMomentumCross(fullSymbol, stoch4h, cci4h);
        
        const asset = {
            symbol,
            fullSymbol,
            price,
            funding,
            fundingPercent: funding * 100,
            lsr,
            lsrTrend: lsrTrendData.trend,
            rsi: rsiValue,
            rsiEmoji: getRSIEmoji(rsiValue),
            cvdDirection: cvd ? cvd.direction : '',
            divergences,
            bollingerBuy,
            bollingerSell,
            stoch4h,
            stoch1d,
            cci4h,
            cci1d,
            volumeMomentumSignal,
            volumeAlert
        };
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BULL' && canAlert(fullSymbol, 'VOLUME_BULL')) {
            await sendVolumeStructureAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'VOLUME_BULL');
            log(`🟢 VOLUME BULL (ZONA COMPRA ≤1% + VOLUME 3M COMPRADOR): ${symbol}`, 'alert');
            await delay(500);
        }
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BEAR' && canAlert(fullSymbol, 'VOLUME_BEAR')) {
            await sendVolumeStructureAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'VOLUME_BEAR');
            log(`🔴 VOLUME BEAR (ZONA VENDA ≤1% + VOLUME 3M VENDEDOR): ${symbol}`, 'alert');
            await delay(500);
        }
        
        if (volumeMomentumSignal === 'VOLUME_MOMENTUM_BULL' && canAlert(fullSymbol, 'VOLUME_MOMENTUM_BULL')) {
            await sendVolumeMomentumAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'VOLUME_MOMENTUM_BULL');
            log(`🟢 VOLUME MOMENTUM BULL: ${symbol}`, 'alert');
            await delay(500);
        }
        
        if (volumeMomentumSignal === 'VOLUME_MOMENTUM_BEAR' && canAlert(fullSymbol, 'VOLUME_MOMENTUM_BEAR')) {
            await sendVolumeMomentumAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'VOLUME_MOMENTUM_BEAR');
            log(`🔴 VOLUME MOMENTUM BEAR: ${symbol}`, 'alert');
            await delay(500);
        }
        
        const isBear = asset.divergences.hasBearish15mPlusOther &&
                       asset.rsi > CONFIG.MONITOR.RSI.RSI_SELL_THRESHOLD &&
                       asset.bollingerSell &&
                       asset.lsr > 2.6 &&
                       asset.funding > 0 &&
                       asset.lsrTrend === 'rising';
        
        const isBull = asset.divergences.hasBullish15mPlusOther &&
                       asset.rsi < CONFIG.MONITOR.RSI.RSI_BUY_THRESHOLD &&
                       asset.bollingerBuy &&
                       asset.lsr < 2.5 &&
                       asset.funding < 0 &&
                       asset.lsrTrend === 'falling';
        
        if (isBear && canAlert(fullSymbol, 'BEAR')) {
            await sendAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'BEAR');
            log(`🔴 ALERTA BEAR: ${symbol}`, 'alert');
        }
        
        if (isBull && canAlert(fullSymbol, 'BULL')) {
            await sendAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'BULL');
            log(`🟢 ALERTA BULL: ${symbol}`, 'alert');
        }
        
    } catch (error) {
        log(`Erro ao verificar ${fullSymbol}: ${error.message}`, 'error');
    }
}

// =====================================================================
// === ENVIAR ALERTA DE VOLUME COM ANÁLISE DE ESTRUTURA (COM DICA E STOCH) ===
// === MANTIDO EXATAMENTE COMO ESTAVA - SEM INFORMAÇÃO DO VOLUME 3M ===
// =====================================================================
async function sendVolumeStructureAlert(asset, type) {
    const dt = getBrazilianDateTime();
    const volumeAlert = asset.volumeAlert;
    
    let message = '';
    
    if (type === 'BULL') {
        message = `<i>💹<b> COMPRA FVG 🔥!</b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += `  ${dt.full}hs\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        
        if (volumeAlert.volume1h && volumeAlert.volume1h.type === 'bull') {
            message += formatVolumeMessage(volumeAlert.volume1h, '1h');
        }
        if (volumeAlert.volume4h && volumeAlert.volume4h.type === 'bull') {
            message += formatVolumeMessage(volumeAlert.volume4h, '4h');
        }
        
        if (volumeAlert.structure4h) {
            message += formatStructureMessage(volumeAlert.structure4h, '4h');
        }
        if (volumeAlert.structure1h && (!volumeAlert.structure4h || volumeAlert.structure1h.zoneType !== volumeAlert.structure4h.zoneType)) {
            message += formatStructureMessage(volumeAlert.structure1h, '1h');
        }
        
        message += ` 🤖✨ Decisão da IA: <b>${volumeAlert.tradeSignal}</b>\n`;
        
        
        if (volumeAlert.structure4h) {
            message += getTradeDica('COMPRA', volumeAlert.structure4h, asset.price, asset.stoch4h, asset.stoch1d);
        } else if (volumeAlert.structure1h) {
            message += getTradeDica('COMPRA', volumeAlert.structure1h, asset.price, asset.stoch4h, asset.stoch1d);
        }
        
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 Caindo' : '📈 Subindo'})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding < 0 ? '🟢 Negativo' : '🔴 Positivo'}\n`;
        message += ` RSI 1h: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji} | CVD: ${asset.cvdDirection}\n`;
        
        
        if (asset.stoch4h) {
            message += ` Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}\n`;
        }
        
        
        if (asset.stoch1d) {
            message += ` Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}\n`;
        }
        
        message += ` Titanium Prime X by @J4Rviz</i>\n`;
        
    } else {
        message = `<i>🛑<b> CORREÇÃO FVG 🔥!</b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += `  ${dt.full}hs\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        
        if (volumeAlert.volume1h && volumeAlert.volume1h.type === 'bear') {
            message += formatVolumeMessage(volumeAlert.volume1h, '1h');
        }
        if (volumeAlert.volume4h && volumeAlert.volume4h.type === 'bear') {
            message += formatVolumeMessage(volumeAlert.volume4h, '4h');
        }
        
        if (volumeAlert.structure4h) {
            message += formatStructureMessage(volumeAlert.structure4h, '4h');
        }
        if (volumeAlert.structure1h && (!volumeAlert.structure4h || volumeAlert.structure1h.zoneType !== volumeAlert.structure4h.zoneType)) {
            message += formatStructureMessage(volumeAlert.structure1h, '1h');
        }
        
        message += ` 🤖✨ Decisão da IA: <b>${volumeAlert.tradeSignal}</b>\n`;
       
        
        if (volumeAlert.structure4h) {
            message += getTradeDica('VENDA', volumeAlert.structure4h, asset.price, asset.stoch4h, asset.stoch1d);
        } else if (volumeAlert.structure1h) {
            message += getTradeDica('VENDA', volumeAlert.structure1h, asset.price, asset.stoch4h, asset.stoch1d);
        }
        
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 Subindo' : '📉 Caindo'})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
        message += ` RSI 1h: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji} | CVD: ${asset.cvdDirection}\n`;
        
        
        if (asset.stoch4h) {
            message += ` Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}\n`;
        }
        
    
        if (asset.stoch1d) {
            message += ` Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}\n`;
        }
        
        message += ` Titanium Prime X by @J4Rviz</i>\n`;
    }
    
    await telegramQueue.add(message);
}
// =====================================================================
// === ENVIAR ALERTA DE VOLUME MOMENTUM ===
// =====================================================================
async function sendVolumeMomentumAlert(asset, type) {
    const dt = getBrazilianDateTime();
    
    let message = '';
    
    if (type === 'BULL') {
        message = `<i>🟢<b>📊 VOLUME BULL </b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` ${dt.full}hs\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += ` CRUZAMENTO NO 4H:\n`;
        message += ` • Stoch (K⤴️D) cruzou para CIMA\n`;
        message += ` • CCI cruzou ⤴️ EMA para CIMA\n`;
        message += `  Indicadores:\n`;
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 Caindo' : '📈 Subindo'})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding < 0 ? '🟢 Negativo' : '🔴 Positivo'}\n`;
        message += ` RSI 1h: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection}\n`;
        
        if (asset.stoch4h) {
            message += ` Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}\n`;
        }
        if (asset.cci4h) {
            message += ` CCI 4H: ${asset.cci4h.crossStatus} ${asset.cci4h.direction} ${asset.cci4h.circle}\n`;
        }
         if (asset.stoch1d) {
            message += ` Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}\n`;
        }
        message += ` Titanium Prime X by @J4Rviz</i>\n`;
    } else {
        message = `<i>🔴<b>📊 VOLUME BEAR </b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` ${dt.full}hs\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += ` CRUZAMENTO NO 4H:\n`;
        message += ` • Stoch (K⤵️D) cruzou para BAIXO\n`;
        message += ` • CCI cruzou ⤵️ EMA para BAIXO\n`;
        message += `  Indicadores:\n`;
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 Subindo' : '📉 Caindo'})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> ${asset.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
        message += ` RSI 1h: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection}\n`;
        
        if (asset.stoch4h) {
            message += ` Stoch 4H: K${asset.stoch4h.k}${asset.stoch4h.kTrend} D${asset.stoch4h.d}${asset.stoch4h.dTrend} ${asset.stoch4h.status}\n`;
        }
        if (asset.cci4h) {
            message += ` CCI 4H: ${asset.cci4h.crossStatus} ${asset.cci4h.direction} ${asset.cci4h.circle}\n`;
        }
         if (asset.stoch1d) {
            message += ` Stoch 1D: K${asset.stoch1d.k}${asset.stoch1d.kTrend} D${asset.stoch1d.d}${asset.stoch1d.dTrend} ${asset.stoch1d.status}\n`;
        }
        
        message += ` Titanium Prime X by @J4Rviz</i>\n`;
    }
    
    await telegramQueue.add(message);
}

// =====================================================================
// === ENVIAR ALERTA INDIVIDUAL PARA TELEGRAM (ALTCOINS) ===
// =====================================================================
async function sendAlert(asset, type) {
    const dt = getBrazilianDateTime();
    
    let message = '';
    
    if (type === 'BULL') {
        message = `<i>🟢 Avaliar Reversão e Pontos de Entrada💹\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'falling' ? '📉 ' : '📈 '})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += ` RSI: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection}\n`;
        message += ` Divergência: ${asset.divergences.bullishTimeframes.join(' → ')}\n`;
        
        if (asset.stoch4h || asset.stoch1d) {
            message += `${formatStochMessage(asset.stoch4h, asset.stoch1d)}`;
        }
        if (asset.cci4h || asset.cci1d) {
            message += `${formatCCIMessage(asset.cci4h, asset.cci1d)}`;
        }
        
        message += ` ${dt.full}</i>`;
    } else {
        message = `<i>🔴 Avaliar Correção e Pontos de Entrada🔻\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` Preço: <code>${formatPrice(asset.price)} USDT</code>\n`;
        message += ` LSR: <code>${asset.lsr.toFixed(2)}</code> (${asset.lsrTrend === 'rising' ? '📈 ' : '📉 '})\n`;
        message += ` Funding: <code>${asset.fundingPercent.toFixed(4)}%</code> \n`;
        message += ` RSI: <code>${asset.rsi?.toFixed(1) || 'N/A'}</code> ${asset.rsiEmoji}\n`;
        message += ` CVD: ${asset.cvdDirection}\n`;
        message += ` Divergência: ${asset.divergences.bearishTimeframes.join(' → ')}\n`;
        
        if (asset.stoch4h || asset.stoch1d) {
            message += `${formatStochMessage(asset.stoch4h, asset.stoch1d)}`;
        }
        if (asset.cci4h || asset.cci1d) {
            message += `${formatCCIMessage(asset.cci4h, asset.cci1d)}`;
        }
        
        message += ` ${dt.full}</i>`;
    }
    
    await telegramQueue.add(message);
}

// =====================================================================
// === VERIFICAR BTC POR TIMEFRAME INDIVIDUAL ===
// =====================================================================
async function checkBTCByTimeframe() {
    try {
        const symbol = 'BTCUSDT';
        const results = {};
        let hasChanges = false;
        let changesList = [];
        
        for (const timeframe of CONFIG.MONITOR.BTC_MONITOR.TIMEFRAMES) {
            const candles = await getCandles(symbol, timeframe, 100);
            if (!candles || candles.length < 60) continue;
            
            const prices = candles.map(c => c.close);
            const currentPrice = prices[prices.length - 1];
            const ema = calculateEMA(prices, CONFIG.MONITOR.BTC_MONITOR.EMA_PERIOD);
            
            if (ema === null) continue;
            
            const isAbove = currentPrice > ema;
            const distance = ((currentPrice - ema) / ema) * 100;
            
            results[timeframe] = {
                currentPrice,
                ema,
                isAbove,
                isBelow: !isAbove,
                distance: distance.toFixed(2)
            };
            
            const wasAbove = btcTimeframeState[timeframe]?.isAbove || false;
            
            if (wasAbove !== isAbove) {
                hasChanges = true;
                changesList.push({
                    timeframe,
                    wasAbove,
                    isAbove,
                    currentPrice,
                    ema,
                    distance: distance.toFixed(2)
                });
                console.log(` MUDANÇA DETECTADA no BTC ${timeframe}: ${wasAbove ? 'ACIMA' : 'ABAIXO'} → ${isAbove ? 'ACIMA' : 'ABAIXO'} (${distance.toFixed(2)}%)`);
            }
            
            if (btcTimeframeState[timeframe]) {
                btcTimeframeState[timeframe].isAbove = isAbove;
                btcTimeframeState[timeframe].currentPrice = currentPrice;
                btcTimeframeState[timeframe].emaValue = ema;
                btcTimeframeState[timeframe].distance = distance;
            }
        }
        
        const [funding, lsr, rsiValue, lsrTrendData] = await Promise.all([
            getFundingRates([symbol]).then(r => r[symbol]),
            getLSRData([symbol]).then(r => r[symbol]),
            getRSIForSymbol(symbol),
            getLSRTrend(symbol)
        ]);
        
        const bollingerBuy = await checkBollingerTouch(symbol, 'buy');
        const bollingerSell = await checkBollingerTouch(symbol, 'sell');
        const cvd = cvdManager.getCVDValue(symbol);
        
        const [stoch4h, stoch1d, cci4h, cci1d] = await Promise.all([
            calculateStochastic(symbol, '4h'),
            calculateStochastic(symbol, '1d'),
            calculateCCI(symbol, '4h'),
            calculateCCI(symbol, '1d')
        ]);
        
        return {
            results,
            hasChanges,
            changesList,
            funding: funding || 0,
            fundingPercent: (funding || 0) * 100,
            lsr: lsr || 0,
            lsrTrend: lsrTrendData.trend,
            rsi: rsiValue,
            cvdDirection: cvd,
            bollingerBuy,
            bollingerSell,
            currentPrice: results[Object.keys(results)[0]]?.currentPrice || 0,
            stoch4h,
            stoch1d,
            cci4h,
            cci1d
        };
        
    } catch (error) {
        console.log(`❌ Erro ao verificar BTC: ${error.message}`);
        return { hasChanges: false, changesList: [], results: {} };
    }
}

// =====================================================================
// === ENVIAR ALERTA DO BTC POR TIMEFRAME ===
// =====================================================================
async function sendBTCAlert(change, btcData) {
    const dt = getBrazilianDateTime();
    const direction = change.isAbove ? 'ACIMA' : 'ABAIXO';
    const emoji = change.isAbove ? '🔴⤴️' : '🟢⤵️';
    
    let message = `<i>`;
    message += `${emoji} <b>👑❅✧❅ BTC ❅✧❅👑  EMA 55 - ${change.timeframe}</b> ${emoji}\n`;
    message += ` PREÇO ${direction} DA EMA 55\n\n`;
    message += ` Timeframe: ${change.timeframe}\n`;
    message += ` Preço Atual: ${formatPrice(change.currentPrice)} USDT\n`;
    message += ` EMA 55: ${formatPrice(change.ema)} USDT\n`;
    message += ` Distância: ${change.distance}%\n\n`;
    
    message += ` Timeframes:\n`;
    for (const [tf, data] of Object.entries(btcData.results)) {
        const tfEmoji = data.isAbove ? '⤴️' : '⤵️';
        const tfStatus = data.isAbove ? 'ACIMA' : 'ABAIXO';
        message += `  ${tfEmoji} ${tf}: ${tfStatus} (${data.distance}%)\n`;
    }
    
    message += ` Indicadores :\n`;
    message += `  LSR: ${btcData.lsr.toFixed(2)} (${btcData.lsrTrend === 'rising' ? '📈 Subindo' : (btcData.lsrTrend === 'falling' ? '📉 Caindo' : '⏺ Estável')})\n`;
    message += `  Funding: ${btcData.fundingPercent.toFixed(4)}% ${btcData.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
    message += `  RSI (1h): ${btcData.rsi?.toFixed(1) || 'N/A'} ${getRSIEmoji(btcData.rsi)}\n`;
    message += `  CVD: ${btcData.cvdDirection}\n`;
    
    if (btcData.stoch4h || btcData.stoch1d) {
        message += ` ${formatStochMessage(btcData.stoch4h, btcData.stoch1d)}`;
    }
    if (btcData.cci4h || btcData.cci1d) {
        message += ` ${formatCCIMessage(btcData.cci4h, btcData.cci1d)}`;
    }
    
    if (btcData.bollingerBuy || btcData.bollingerSell) {
        message += ` Bollinger: ${btcData.bollingerBuy ? 'Toque na banda inferior ✅' : (btcData.bollingerSell ? 'Toque na banda superior ✅' : 'Neutro')}\n`;
    }
    
    message += `  ${dt.full}\n`;
    message += `</i>`;
    
    await telegramQueue.add(message, true);
    log(` ALERTA BTC ${change.timeframe}: ${direction} da EMA 55`, 'alert');
}

// =====================================================================
// === ENVIAR STATUS INICIAL DO BTC ===
// =====================================================================
async function sendBTCInitialStatus(btcData) {
    const dt = getBrazilianDateTime();
    
    let message = `<i>`;
    message += `<b>👑❅✧❅ BTC ❅✧❅👑</b>\n`;
    message += ` Preço Atual: ${formatPrice(btcData.currentPrice)} USDT\n`;
    message += ` POSIÇÃO EM RELAÇÃO À EMA 55:\n`;
    
    for (const [tf, data] of Object.entries(btcData.results)) {
        const emoji = data.isAbove ? '⤴️' : '⤵️';
        const status = data.isAbove ? 'ACIMA' : 'ABAIXO';
        message += `  ${emoji} ${tf}: ${status} (${data.distance}%)\n`;
    }
    
    message += ` Indicadores :\n`;
    message += `  LSR: ${btcData.lsr.toFixed(2)} (${btcData.lsrTrend === 'rising' ? '📈 Subindo' : (btcData.lsrTrend === 'falling' ? '📉 Caindo' : '⏺ Estável')})\n`;
    message += `  Funding: ${btcData.fundingPercent.toFixed(4)}% ${btcData.funding > 0 ? '🔴 Positivo' : '🟢 Negativo'}\n`;
    message += `  RSI (1h): ${btcData.rsi?.toFixed(1) || 'N/A'} ${getRSIEmoji(btcData.rsi)}\n`;
    message += `  CVD: ${btcData.cvdDirection}\n`;
    
    if (btcData.stoch4h || btcData.stoch1d) {
        message += ` ${formatStochMessage(btcData.stoch4h, btcData.stoch1d)}`;
    }
    if (btcData.cci4h || btcData.cci1d) {
        message += ` ${formatCCIMessage(btcData.cci4h, btcData.cci1d)}`;
    }
    
    message += `Titanium monitorando!\n`;
    message += ` ${dt.full}\n`;
    message += `</i>`;
    
    await telegramQueue.add(message, true);
    log(`📢 STATUS INICIAL BTC ENVIADO`, 'alert');
}

// =====================================================================
// === MONITOR ESPECÍFICO DO BTC ===
// =====================================================================
let lastBTCScan = 0;

async function scanBTC() {
    const now = Date.now();
    const intervalMs = CONFIG.MONITOR.BTC_MONITOR.CHECK_INTERVAL_SECONDS * 1000;
    
    if (now - lastBTCScan < intervalMs) return;
    lastBTCScan = now;
    
    try {
        const btcData = await checkBTCByTimeframe();
        
        if (Object.keys(btcData.results).length === 0) {
            console.log(`⚠️ BTC: Nenhum timeframe válido`);
            return;
        }
        
        if (!initialStatusSent) {
            console.log(`📡 Enviando status inicial do BTC...`);
            await sendBTCInitialStatus(btcData);
            initialStatusSent = true;
            saveBTCTimeframeState();
            console.log(`✅ Status inicial BTC enviado com sucesso!`);
        }
        
        if (btcData.hasChanges && btcData.changesList.length > 0) {
            for (const change of btcData.changesList) {
                if (canAlertBTC(change.timeframe)) {
                    await sendBTCAlert(change, btcData);
                    markBTCAlerted(change.timeframe);
                    await delay(2000);
                } else {
                    console.log(`⏸️ BTC ${change.timeframe} em cooldown - alerta não enviado`);
                }
            }
        }
        
        let statusLog = ` BTC Status: `;
        for (const [tf, data] of Object.entries(btcData.results)) {
            statusLog += `${tf}:${data.isAbove ? '🔼' : '🔽'} `;
        }
        console.log(statusLog);
        
    } catch (error) {
        log(`Erro no scan BTC: ${error.message}`, 'error');
    }
}

// =====================================================================
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i><b> TITANIUM PRIME X </b>\n\n`;
    msg += `✅ Sistema Iniciado!\n`;
   
    
    await telegramQueue.add(msg, true);
}

// =====================================================================
// === MONITOR PRINCIPAL (SCAN CONTÍNUO) ===
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
        
        let alertCount = 0;
        for (const symbolData of symbols) {
            await checkAndAlert(symbolData, cvdManager);
            alertCount++;
            
            if (alertCount % 10 === 0) {
                await delay(100);
            }
        }
        
        log(`✅ Scan completo. ${alertCount} ativos verificados.`, 'success');
        
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
    console.log('🚀 TITANIUM PRIME X ');
   
    console.log('='.repeat(70));
    
    loadAlertedSymbols();
    loadBTCTimeframeState();
    loadVolumeMomentumMemory();
    
    await sendInitMessage();
    
    cvdManager.subscribeToSymbol('BTCUSDT');
    
    console.log(`📡 Obtendo dados do BTC para status inicial...`);
    const initialBTCData = await checkBTCByTimeframe();
    if (Object.keys(initialBTCData.results).length > 0) {
        console.log(`📡 Enviando status inicial do BTC...`);
        await sendBTCInitialStatus(initialBTCData);
        initialStatusSent = true;
        saveBTCTimeframeState();
        console.log(`✅ Status inicial BTC enviado !`);
    } else {
        console.log(`⚠️ Não foi possível obter dados do BTC para status inicial`);
    }
    
    await scanAndAlert();
    
    setInterval(async () => {
        await scanAndAlert();
    }, CONFIG.MONITOR.SCAN_INTERVAL_SECONDS * 1000);
    
    setInterval(async () => {
        await scanBTC();
    }, CONFIG.MONITOR.BTC_MONITOR.CHECK_INTERVAL_SECONDS * 1000);
}

process.on('SIGINT', () => {
    log('🛑 Desligando...', 'warning');
    saveVolumeMomentumMemory();
    cvdManager.cleanup();
    process.exit(0);
});

startMonitor().catch(console.error);
