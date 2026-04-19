const fetch = require('node-fetch');
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
        CVD: {
            CHECK_INTERVAL_SECONDS: 30,
            CVD_CHANGE_WINDOW: 60
        },
        FVG: {
            REQUIRED_CANDLE_CLOSE: true,
            CONFIRMATION_CANDLES: 1
        }
    }
};

// =====================================================================
// === MEMÓRIA DE FVG (RASTREIA FVGS JÁ CONFIRMADOS) ===
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
// === CACHE E CONTROLE DE ALERTAS ===
// =====================================================================
const rsiCache = new Map();
const divergenceCache = new Map();
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
// === FUNÇÕES PARA DETECÇÃO DE FVG (FAIR VALUE GAP) COM CONFIRMAÇÃO ===
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
                type: 'bull',
                candle1Close: candle1.close,
                candle2Close: candle2.close,
                candle3Close: candle3.close
            });
        }
        
        if (candle1.high < candle3.low) {
            fvgBear.push({
                top: candle3.low,
                bottom: candle1.high,
                index: i,
                time: candle1.time,
                type: 'bear',
                candle1Close: candle1.close,
                candle2Close: candle2.close,
                candle3Close: candle3.close
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
        
        if (distance < minDistance && isConfirmed) {
            minDistance = distance;
            closest = {
                ...fvg,
                distancePercent: distance,
                targetPrice: targetPrice,
                isAbove,
                isBelow,
                isInside: distance === 0,
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
        
        const closestBullFVG = checkFVGWithConfirmation(fvgs, currentPrice, candles, 'bull');
        const closestBearFVG = checkFVGWithConfirmation(fvgs, currentPrice, candles, 'bear');
        const closestSupport = checkProximityToLevel(currentPrice, supports, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        const closestResistance = checkProximityToLevel(currentPrice, resistances, CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD);
        
        let zoneType = 'NEUTRO';
        let zoneDescription = '';
        
        if (closestBullFVG && closestBullFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD && closestBullFVG.isConfirmed) {
            zoneType = 'COMPRA';
            zoneDescription = `FVG Bull ${timeframe} à ${closestBullFVG.distancePercent.toFixed(2)}% (Preço alvo: ${formatPrice(closestBullFVG.targetPrice)}) ✅ CONFIRMADO`;
        } else if (closestSupport && closestSupport.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD) {
            zoneType = 'COMPRA';
            zoneDescription = `Suporte ${timeframe} à ${closestSupport.distancePercent.toFixed(2)}% (Preço: ${formatPrice(closestSupport.targetPrice)})`;
        }
        
        if (closestBearFVG && closestBearFVG.distancePercent <= CONFIG.MONITOR.ZONE_PROXIMITY_THRESHOLD && closestBearFVG.isConfirmed) {
            zoneType = 'VENDA';
            zoneDescription = `FVG Bear ${timeframe} à ${closestBearFVG.distancePercent.toFixed(2)}% (Preço alvo: ${formatPrice(closestBearFVG.targetPrice)}) ✅ CONFIRMADO`;
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
// === FUNÇÃO: DETECTAR VOLUME ANORMAL COMPRADOR/VENDEDOR 3 MIN ===
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
// === ANÁLISE DE VOLUME PARA ALERTA FVG ===
// =====================================================================
async function analyzeVolumeAlert(symbol, currentPrice, divergencias) {
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
        
        // ALERTA DE COMPRA FVG
        if (volume3mBuyer && volume3mBuyer.isAnomaly) {
            const temDivergenciaAlta15m = divergencias && divergencias.hasBullish15mPlusOther;
            
            if (temDivergenciaAlta15m) {
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
        }
        
        // ALERTA DE VENDA FVG
        if (volume3mSeller && volume3mSeller.isAnomaly) {
            const temDivergenciaBaixa15m = divergencias && divergencias.hasBearish15mPlusOther;
            
            if (temDivergenciaBaixa15m) {
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
        
        let status = '';
        const kValue = currentK;
        
        if (kValue < 15) {
            status = '🔵';
        } else if (kValue >= 15 && kValue < 25) {
            status = '🟢';
        } else if (kValue >= 25 && kValue < 45) {
            status = '🟡';
        } else if (kValue >= 45 && kValue < 70) {
            status = '🟠';
        } else {
            status = '🔴';
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
        msg += `  🟢 FVG Bull: ${fvg.distancePercent.toFixed(2)}% ➜ ${formatPrice(fvg.targetPrice)} USDT ✅\n`;
    }
    
    if (structure.closestBearFVG) {
        const fvg = structure.closestBearFVG;
        msg += `  🔴 FVG Bear: ${fvg.distancePercent.toFixed(2)}% ➜ ${formatPrice(fvg.targetPrice)} USDT ✅\n`;
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
            alertaStoch = ` STOCH 4H (K${stoch4h.k}) - BAIXO.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.isOverbought) {
            alertaStoch = ` STOCH 4H (K${stoch4h.k}) - ALTO.`;
            condicaoFavoravel = false;
        } else if (stoch4h && stoch4h.rawK < 30) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - NEUTRO.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.rawK > 70) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - NEUTRO!`;
            condicaoFavoravel = false;
        } else {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - NEUTRO.`;
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
            alertaStoch = ` STOCH 4H ALTO (K${stoch4h.k}) - FAVORÁVEL PARA VENDA!`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.isOversold) {
            alertaStoch = ` STOCH 4H BAIXO (K${stoch4h.k}) - NÃO FAVORÁVEL PARA VENDA!`;
            condicaoFavoravel = false;
        } else if (stoch4h && stoch4h.rawK > 70) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - PRÓXIMO A ZONA DE VENDA.`;
            condicaoFavoravel = true;
        } else if (stoch4h && stoch4h.rawK < 30) {
            alertaStoch = ` STOCH 4H ${stoch4h.k} - PRÓXIMO A ZONA DE COMPRA!`;
            condicaoFavoravel = false;
        } else {
            alertaStoch = ` STOCH 4H ${stoch4h.k}.`;
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
// === FUNÇÃO PARA GERAR DICA ESTRATÉGICA ===
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
        
        return dica;
    }
    
    return '';
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
    
    const pricePivots = findPivots(prices, 5);
    const rsiPivots = findPivots(rsiValues, 5);
    
    // Divergências de Alta (Bullish)
    for (let i = 0; i < pricePivots.lows.length; i++) {
        for (let j = i + 1; j < pricePivots.lows.length; j++) {
            const priceLow1 = pricePivots.lows[i];
            const priceLow2 = pricePivots.lows[j];
            
            const priceLower = priceLow2.value < priceLow1.value;
            const priceDistance = Math.abs(priceLow2.index - priceLow1.index);
            
            if (priceLower && priceDistance >= 5) {
                const rsiLow1 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow1.index) <= 3);
                const rsiLow2 = rsiPivots.lows.find(r => Math.abs(r.index - priceLow2.index) <= 3);
                
                if (rsiLow1 && rsiLow2) {
                    const rsiHigher = rsiLow2.value > rsiLow1.value;
                    const strength = Math.abs(priceLow2.value - priceLow1.value) / priceLow1.value * 100;
                    const rsiDiff = Math.abs(rsiLow2.value - rsiLow1.value);
                    
                    if (rsiHigher && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH && rsiDiff >= 5) {
                        divergences.bullish.push({
                            type: 'bullish',
                            strength: strength,
                            rsiDiff: rsiDiff
                        });
                    }
                }
            }
        }
    }
    
    // Divergências de Baixa (Bearish)
    for (let i = 0; i < pricePivots.highs.length; i++) {
        for (let j = i + 1; j < pricePivots.highs.length; j++) {
            const priceHigh1 = pricePivots.highs[i];
            const priceHigh2 = pricePivots.highs[j];
            
            const priceHigher = priceHigh2.value > priceHigh1.value;
            const priceDistance = Math.abs(priceHigh2.index - priceHigh1.index);
            
            if (priceHigher && priceDistance >= 5) {
                const rsiHigh1 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh1.index) <= 3);
                const rsiHigh2 = rsiPivots.highs.find(r => Math.abs(r.index - priceHigh2.index) <= 3);
                
                if (rsiHigh1 && rsiHigh2) {
                    const rsiLower = rsiHigh2.value < rsiHigh1.value;
                    const strength = Math.abs(priceHigh2.value - priceHigh1.value) / priceHigh1.value * 100;
                    const rsiDiff = Math.abs(rsiHigh2.value - rsiHigh1.value);
                    
                    if (rsiLower && strength >= CONFIG.MONITOR.RSI.MIN_DIVERGENCE_STRENGTH && rsiDiff >= 5) {
                        divergences.bearish.push({
                            type: 'bearish',
                            strength: strength,
                            rsiDiff: rsiDiff
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
        hasBullish15mPlusOther: false,
        hasBearish15mPlusOther: false
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
            
            const divergences = findRSIDivergences(prices, rsi);
            
            if (divergences.bullish.length > 0) {
                result.hasBullishDivergence = true;
                result.bullishTimeframes.push(timeframe);
                
                if (timeframe === '15m') {
                    bullishOn15m = true;
                } else {
                    bullishOtherTimeframes.push(timeframe);
                }
            }
            
            if (divergences.bearish.length > 0) {
                result.hasBearishDivergence = true;
                result.bearishTimeframes.push(timeframe);
                
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
        const result = {};
        
        const batchSize = 50;
        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);
            const promises = batch.map(async s => {
                try {
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
            for (const item of batchResults) {
                result[item.symbol] = item.lsr;
            }
            
            if (i + batchSize < symbols.length) {
                await delay(500);
            }
        }
        
        return result;
    } catch (error) {
        log(`Erro LSR: ${error.message}`, 'error');
        return {};
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
// === VERIFICAR CRITÉRIOS E ENVIAR ALERTA FVG ===
// =====================================================================
async function checkAndAlert(symbolData, cvdManager) {
    const { symbol: fullSymbol, price, volume24h } = symbolData;
    const symbol = fullSymbol.replace('USDT', '');
    
    try {
        const fundingRates = await getFundingRates([fullSymbol]);
        const funding = fundingRates[fullSymbol];
        
        const lsrData = await getLSRData([fullSymbol]);
        const lsr = lsrData[fullSymbol];
        
        if (funding === undefined || funding === null) return;
        if (lsr === undefined || lsr === null) return;
        
        const [rsiValue, divergences, lsrTrendData] = await Promise.all([
            getRSIForSymbol(fullSymbol),
            analyzeDivergences(fullSymbol, cvdManager),
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
        
        const volumeAlert = await analyzeVolumeAlert(fullSymbol, price, divergences);
        
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
            stoch4h,
            stoch1d,
            cci4h,
            cci1d,
            volumeAlert
        };
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BULL' && canAlert(fullSymbol, 'VOLUME_BULL')) {
            await sendFVGAlert(asset, 'BULL');
            markAlerted(fullSymbol, 'VOLUME_BULL');
            log(`🟢 COMPRA FVG (ZONA ≤1% + VOLUME 3M COMPRADOR + DIVERGÊNCIA ALTA 15M): ${symbol}`, 'alert');
            await delay(500);
        }
        
        if (volumeAlert && volumeAlert.alertType === 'VOLUME_BEAR' && canAlert(fullSymbol, 'VOLUME_BEAR')) {
            await sendFVGAlert(asset, 'BEAR');
            markAlerted(fullSymbol, 'VOLUME_BEAR');
            log(`🔴 VENDA FVG (ZONA ≤1% + VOLUME 3M VENDEDOR + DIVERGÊNCIA BAIXA 15M): ${symbol}`, 'alert');
            await delay(500);
        }
        
    } catch (error) {
        if (!error.message.includes('Cannot read properties of undefined')) {
            log(`Erro ao verificar ${fullSymbol}: ${error.message}`, 'error');
        }
    }
}

// =====================================================================
// === ENVIAR ALERTA FVG ===
// =====================================================================
async function sendFVGAlert(asset, type) {
    const dt = getBrazilianDateTime();
    const volumeAlert = asset.volumeAlert;
    
    let message = '';
    
    if (type === 'BULL') {
        message = `<i>💹<b> COMPRA FVG 🔥!</b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` ${dt.full}hs\n`;
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
        message = `<i>🛑<b> VENDA FVG 🔥!</b>\n`;
        message += ` Ativo: <code>${asset.symbol}</code>\n`;
        message += ` ${dt.full}hs\n`;
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
// === MENSAGEM INICIAL ===
// =====================================================================
async function sendInitMessage() {
    let msg = `<i><b> TITANIUM PRIME X - FVG MONITOR </b>\n\n`;
    msg += `✅ Sistema de FVG Iniciado!\n`;
    msg += `📊 Monitorando apenas alertas de FVG com confirmação de candle\n`;
    msg += `⏰ Scan a cada ${CONFIG.MONITOR.SCAN_INTERVAL_SECONDS} segundos\n`;
    msg += `🔄 Cooldown de ${CONFIG.MONITOR.ALERT_COOLDOWN_MINUTES} minutos por ativo\n`;
    msg += `</i>`;
    
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
        
        log(`🔍 Escaneando ${symbols.length} símbolos para FVG...`, 'info');
        
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
        
        log(`✅ Scan FVG completo. ${alertCount} ativos verificados.`, 'success');
        
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
    console.log('🚀 TITANIUM PRIME X - FVG MONITOR');
    console.log('📊 Sistema especializado em Fair Value Gaps');
    console.log('✅ Critério obrigatório: Fechamento do candle');
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
