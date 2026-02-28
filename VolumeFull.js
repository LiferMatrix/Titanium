const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const z = require('zod');
require('dotenv').config();
if (!globalThis.fetch) globalThis.fetch = fetch;

// =====================================================================
// === CONFIGURAÇÕES CENTRALIZADAS ===
// =====================================================================
const CONFIG = {
    TELEGRAM: {
        BOT_TOKEN: '7633398974:AAHaVFA',
        CHAT_ID: '-100197'
    },
    PERFORMANCE: {
        SYMBOL_DELAY_MS: 50,
        SCAN_INTERVAL_MINUTES: 15,
        CANDLE_CACHE_TTL: 300000,
        BATCH_SIZE: 20,
        REQUEST_TIMEOUT: 10000
    },
    VOLUME: {
        TIMEFRAME: '1h',
        EMA_PERIOD: 9,
        MIN_VOLUME_RATIO: 0.5,
        TOP_COUNT: 10,
        BUYER_THRESHOLD: 50.1,
        SELLER_THRESHOLD: 49.9
    },
    RATE_LIMITER: {
        INITIAL_DELAY: 100,
        MAX_DELAY: 2000,
        BACKOFF_FACTOR: 1.5
    },
    DEBUG: {
        VERBOSE: false
    }
};

// =====================================================================
// === SCHEMAS DE VALIDAÇÃO ZOD ===
// =====================================================================
const CandleSchema = z.object({
    open: z.number().positive(),
    high: z.number().positive(),
    low: z.number().positive(),
    close: z.number().positive(),
    volume: z.number().positive(),
    time: z.number().int()
});

const KlineResponseSchema = z.array(
    z.tuple([
        z.number(), z.string(), z.string(), z.string(), z.string(),
        z.string(), z.number(), z.string(), z.number(), z.string(),
        z.string(), z.string()
    ])
);

const LSRResponseSchema = z.array(
    z.object({
        longShortRatio: z.string(),
        longAccount: z.string(),
        shortAccount: z.string()
    })
);

const FundingRateSchema = z.array(
    z.object({
        symbol: z.string(),
        fundingRate: z.string(),
        fundingTime: z.number()
    })
);

const ExchangeInfoSchema = z.object({
    symbols: z.array(
        z.object({
            symbol: z.string(),
            status: z.string()
        })
    )
});

const VolumeAnalysisSchema = z.object({
    symbol: z.string(),
    price: z.number(),
    volumeRatio: z.number(),
    buyerPercentage: z.number(),
    sellerPercentage: z.number(),
    direction: z.enum(['COMPRADOR', 'VENDEDOR', 'NEUTRO']),
    emoji: z.string(),
    lsr: z.number().optional().nullable(),
    funding: z.number().optional().nullable(),
    rsi: z.number().optional().nullable(),
    support: z.number().optional().nullable(),
    resistance: z.number().optional().nullable(),
    score: z.number()
});

// =====================================================================
// === DIRETÓRIOS ===
// =====================================================================
const LOG_DIR = './logs';
const CACHE_DIR = './cache';

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// =====================================================================
// === CACHE ===
// =====================================================================
const candleCache = new Map();
const cacheStats = { hits: 0, misses: 0 };

class CacheManager {
    static get(symbol, timeframe, limit) {
        const key = `${symbol}_${timeframe}_${limit}`;
        const cached = candleCache.get(key);
        if (cached && Date.now() - cached.timestamp < CONFIG.PERFORMANCE.CANDLE_CACHE_TTL) {
            cacheStats.hits++;
            return cached.data;
        }
        cacheStats.misses++;
        return null;
    }

    static set(symbol, timeframe, limit, data) {
        const key = `${symbol}_${timeframe}_${limit}`;
        candleCache.set(key, { data, timestamp: Date.now() });
    }
}

// =====================================================================
// === RATE LIMITER ===
// =====================================================================
class RateLimiter {
    constructor() {
        this.currentDelay = CONFIG.RATE_LIMITER.INITIAL_DELAY;
        this.consecutiveErrors = 0;
        this.lastRequestTime = 0;
    }

    async makeRequest(url, options = {}, type = 'klines') {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.currentDelay) {
            await new Promise(r => setTimeout(r, this.currentDelay - timeSinceLastRequest));
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.PERFORMANCE.REQUEST_TIMEOUT);

            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            this.lastRequestTime = Date.now();

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            this.consecutiveErrors = 0;
            this.currentDelay = Math.max(CONFIG.RATE_LIMITER.INITIAL_DELAY, this.currentDelay * 0.95);
            
            return await response.json();
        } catch (error) {
            this.consecutiveErrors++;
            this.currentDelay = Math.min(CONFIG.RATE_LIMITER.MAX_DELAY, this.currentDelay * CONFIG.RATE_LIMITER.BACKOFF_FACTOR);
            throw error;
        }
    }
}

const rateLimiter = new RateLimiter();

// =====================================================================
// === FUNÇÕES AUXILIARES ===
// =====================================================================
function getBrazilianDateTime() {
    const now = new Date();
    const offset = -3;
    const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
    const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
    const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);
    return { date, time, full: `${date} ${time}` };
}

function formatNumber(num, decimals = 2) {
    if (num === undefined || num === null) return 'N/A';
    if (num > 1000) return num.toFixed(decimals);
    if (num > 1) return num.toFixed(decimals);
    return num.toFixed(decimals);
}

function getFundingEmoji(rate) {
    if (!rate) return '⚪';
    if (rate <= -0.001) return '🟢🟢';
    if (rate <= -0.0005) return '🟢';
    if (rate <= -0.0001) return '🟡';
    if (rate >= 0.001) return '🔴🔴';
    if (rate >= 0.0005) return '🔴';
    if (rate >= 0.0001) return '🟡';
    return '⚪';
}

function getLSREmoji(lsr, direction) {
    if (!lsr) return '⚪';
    if (direction === 'COMPRADOR') {
        if (lsr < 1.5) return '🟢🟢';
        if (lsr < 2.0) return '🟢';
        if (lsr < 2.5) return '🟡';
        if (lsr < 3.0) return '🟠';
        return '🔴';
    } else {
        if (lsr > 3.5) return '🟢🟢';
        if (lsr > 3.0) return '🟢';
        if (lsr > 2.5) return '🟡';
        if (lsr > 2.0) return '🟠';
        return '🔴';
    }
}

function getRSIEmoji(rsi, direction) {
    if (!rsi) return '⚪';
    if (direction === 'COMPRADOR') {
        if (rsi < 30) return '🟢🟢';
        if (rsi < 40) return '🟢';
        if (rsi < 50) return '🟡';
        if (rsi < 60) return '🟠';
        return '🔴';
    } else {
        if (rsi > 70) return '🟢🟢';
        if (rsi > 60) return '🟢';
        if (rsi > 50) return '🟡';
        if (rsi > 40) return '🟠';
        return '🔴';
    }
}

// =====================================================================
// === FUNÇÕES DE CÁLCULO ===
// =====================================================================
function calculateEMA(values, period) {
    if (values.length < period) {
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }
    return ema;
}

async function getCandles(symbol, timeframe, limit = 50) {
    const cached = CacheManager.get(symbol, timeframe, limit);
    if (cached) return cached;

    const intervalMap = {
        '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h', '1d': '1d'
    };
    
    const interval = intervalMap[timeframe] || '1h';
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    try {
        const data = await rateLimiter.makeRequest(url, {}, 'klines');
        const validatedData = KlineResponseSchema.parse(data);
        
        const candles = validatedData.map(candle => ({
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5]),
            time: candle[0]
        }));
        
        CacheManager.set(symbol, timeframe, limit, candles);
        return candles;
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao buscar candles ${symbol}: ${error.message}`);
        }
        return [];
    }
}

async function getSupportResistance(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 100);
        if (candles.length < 20) return { support: null, resistance: null };
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        const recentHighs = highs.slice(-20).sort((a, b) => b - a).slice(0, 3);
        const resistance = recentHighs.reduce((a, b) => a + b, 0) / recentHighs.length;
        
        const recentLows = lows.slice(-20).sort((a, b) => a - b).slice(0, 3);
        const support = recentLows.reduce((a, b) => a + b, 0) / recentLows.length;
        
        return { support, resistance };
    } catch {
        return { support: null, resistance: null };
    }
}

async function getLSR(symbol) {
    try {
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=15m&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'lsr');
        const validated = LSRResponseSchema.parse(data);
        return validated.length > 0 ? parseFloat(validated[0].longShortRatio) : null;
    } catch {
        return null;
    }
}

async function getFundingRate(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
        const data = await rateLimiter.makeRequest(url, {}, 'funding');
        const validated = FundingRateSchema.parse(data);
        return validated.length > 0 ? parseFloat(validated[0].fundingRate) : null;
    } catch {
        return null;
    }
}

async function getRSI(symbol) {
    try {
        const candles = await getCandles(symbol, '1h', 20);
        if (candles.length < 14) return null;
        
        const closes = candles.map(c => c.close);
        let gains = 0, losses = 0;
        
        for (let i = 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff;
            else losses += Math.abs(diff);
        }
        
        const avgGain = gains / 14;
        const avgLoss = losses / 14 || 0.001;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    } catch {
        return null;
    }
}

async function analyzeSymbolVolume(symbol) {
    try {
        const candles = await getCandles(symbol, CONFIG.VOLUME.TIMEFRAME, CONFIG.VOLUME.EMA_PERIOD + 20);
        if (candles.length < CONFIG.VOLUME.EMA_PERIOD + 5) return null;
        
        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);
        
        const ema9 = calculateEMA(closes, CONFIG.VOLUME.EMA_PERIOD);
        
        const avgVolume = volumes.slice(-CONFIG.VOLUME.EMA_PERIOD).reduce((a, b) => a + b, 0) / CONFIG.VOLUME.EMA_PERIOD;
        const currentVolume = volumes[volumes.length - 1];
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
        
        let buyerVolume = 0, sellerVolume = 0, totalVolume = 0;
        const recentCandles = candles.slice(-24);
        
        recentCandles.forEach(candle => {
            const volume = candle.volume;
            totalVolume += volume;
            
            if (candle.close > ema9) {
                buyerVolume += volume;
            } else if (candle.close < ema9) {
                sellerVolume += volume;
            } else {
                buyerVolume += volume / 2;
                sellerVolume += volume / 2;
            }
        });
        
        const buyerPercentage = totalVolume > 0 ? (buyerVolume / totalVolume) * 100 : 50;
        const sellerPercentage = 100 - buyerPercentage;
        
        let direction = 'NEUTRO';
        let emoji = '⚪';
        
        if (buyerPercentage > CONFIG.VOLUME.BUYER_THRESHOLD) {
            direction = 'COMPRADOR';
            emoji = buyerPercentage > 60 ? '🟢🟢' : '🟢';
        } else if (sellerPercentage > (100 - CONFIG.VOLUME.SELLER_THRESHOLD)) {
            direction = 'VENDEDOR';
            emoji = sellerPercentage > 60 ? '🔴🔴' : '🔴';
        }
        
        const [lsrResult, fundingResult, rsiResult, srResult] = await Promise.allSettled([
            getLSR(symbol),
            getFundingRate(symbol),
            getRSI(symbol),
            getSupportResistance(symbol)
        ]);
        
        const lsrValue = lsrResult.status === 'fulfilled' ? lsrResult.value : null;
        const fundingValue = fundingResult.status === 'fulfilled' ? fundingResult.value : null;
        const rsiValue = rsiResult.status === 'fulfilled' ? rsiResult.value : null;
        const supportValue = srResult.status === 'fulfilled' ? srResult.value?.support : null;
        const resistanceValue = srResult.status === 'fulfilled' ? srResult.value?.resistance : null;
        
        let score = 50;
        
        if (direction === 'COMPRADOR') {
            if (lsrValue && lsrValue < 2.5) score += 10;
            if (lsrValue && lsrValue < 2.0) score += 10;
            if (fundingValue && fundingValue < -0.0005) score += 10;
            if (fundingValue && fundingValue < -0.001) score += 10;
            if (rsiValue && rsiValue < 50) score += 10;
            if (rsiValue && rsiValue < 40) score += 10;
            if (volumeRatio > 1.5) score += 10;
            if (volumeRatio > 2.0) score += 10;
            if (buyerPercentage > 55) score += 10;
        } else if (direction === 'VENDEDOR') {
            if (lsrValue && lsrValue > 2.8) score += 10;
            if (lsrValue && lsrValue > 3.5) score += 10;
            if (fundingValue && fundingValue > 0.0005) score += 10;
            if (fundingValue && fundingValue > 0.001) score += 10;
            if (rsiValue && rsiValue > 60) score += 10;
            if (rsiValue && rsiValue > 70) score += 10;
            if (volumeRatio > 1.5) score += 10;
            if (volumeRatio > 2.0) score += 10;
            if (sellerPercentage > 55) score += 10;
        }
        
        score = Math.min(100, Math.max(0, score));
        
        return {
            symbol,
            price: candles[candles.length - 1].close,
            volumeRatio,
            buyerPercentage,
            sellerPercentage,
            direction,
            emoji,
            lsr: lsrValue,
            funding: fundingValue,
            rsi: rsiValue,
            support: supportValue,
            resistance: resistanceValue,
            score
        };
        
    } catch (error) {
        if (CONFIG.DEBUG.VERBOSE) {
            console.log(`⚠️ Erro ao analisar ${symbol}: ${error.message}`);
        }
        return null;
    }
}

// =====================================================================
// === TELEGRAM ===
// =====================================================================
async function sendTelegramAlert(message) {
    try {
        if (!CONFIG.TELEGRAM.BOT_TOKEN || !CONFIG.TELEGRAM.CHAT_ID) {
            console.log('⚠️ Telegram não configurado');
            return false;
        }

        const url = `https://api.telegram.org/bot${CONFIG.TELEGRAM.BOT_TOKEN}/sendMessage`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CONFIG.TELEGRAM.CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Erro Telegram: ${errorText}`);
            return false;
        }
        
        return true;
    } catch (error) {
        console.log(`❌ Erro Telegram: ${error.message}`);
        return false;
    }
}

function formatRankingMessage(buyers, sellers, time) {
    const formatPrice = (price) => {
        if (!price) return '-';
        if (price > 1000) return price.toFixed(4);
        if (price > 1) return price.toFixed(6);
        if (price > 0.1) return price.toFixed(7);
        return price.toFixed(8);
    };

    const formatLine = (item, index, type) => {
        const dir = type === 'COMPRADOR' ? '🟢' : '🔴';
        const volPct = type === 'COMPRADOR' ? item.buyerPercentage.toFixed(0) : item.sellerPercentage.toFixed(0);
        const volEmoji = item.volumeRatio > 2 ? (type === 'COMPRADOR' ? '🟢🟢' : '🔴🔴') : 
                        (item.volumeRatio > 1.5 ? (type === 'COMPRADOR' ? '🟢' : '🔴') : '⚪');
        
        const lsrEmoji = getLSREmoji(item.lsr, type);
        const rsiEmoji = getRSIEmoji(item.rsi, type);
        const fundingEmoji = getFundingEmoji(item.funding);
        
        const fundingStr = item.funding ? (item.funding * 100).toFixed(4) : '0.0000';
        const fundingSign = item.funding && item.funding > 0 ? '+' : '';
        
        const supportStr = formatPrice(item.support);
        const resistanceStr = formatPrice(item.resistance);
        
        const symbolName = item.symbol.replace('USDT', '');
        
        // Adiciona uma linha em branco entre os ativos (exceto o último)
        const lineBreak = index < buyers.length - 1 ? '\n' : '';
        
        return `${index+1}. ${dir} <b>${symbolName}</b> R$${formatPrice(item.price)} | Vol:${volPct}%${volEmoji} (${item.volumeRatio.toFixed(2)}x) | #RSI 1H:${formatNumber(item.rsi, 0)}${rsiEmoji} | #LSR:${formatNumber(item.lsr, 2)}${lsrEmoji} | Fund:${fundingSign}${fundingStr}%${fundingEmoji} | S/R ${supportStr}/${resistanceStr} | #SCORE:${item.score}${lineBreak}`;
    };

    // Formata os compradores com uma linha em branco entre cada ativo
    let buyersText = buyers.length === 0 
        ? '🔝 <b>TOP 0 COMPRADOR</b> 🟢\n    Nenhum comprador significativo' 
        : `🔝 <b>TOP ${buyers.length} COMPRADOR</b> 🟢\n${buyers.map((item, i) => formatLine(item, i, 'COMPRADOR')).join('\n')}`;
    
    // Formata os vendedores com uma linha em branco entre cada ativo
    let sellersText = sellers.length === 0 
        ? '🔻 <b>TOP 0 VENDEDOR</b> 🔴\n    Nenhum vendedor significativo' 
        : `🔻 <b>TOP ${sellers.length} VENDEDOR</b> 🔴\n${sellers.map((item, i) => formatLine(item, i, 'VENDEDOR')).join('\n')}`;

    // Mensagem completa com tags <i> para itálico em todo o conteúdo
    return `<i>🚀 <b>RANKING VOLUME 1H</b> ${time.full}

${buyersText}

${sellersText}
 💡Dica o SCORE quanto mais alto melhor,
 observe o valor Suporte e Resistência
 nas mensagens do alerta,dica stop de 2%.
 Vol%  | RSI | LSR | Fund% | S/R | Score
🤖 Atualização a cada ${CONFIG.PERFORMANCE.SCAN_INTERVAL_MINUTES}min
✨ Titanium Scanner by @J4Rviz</i>`;
}

// =====================================================================
// === FETCH SYMBOLS ===
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        const data = await rateLimiter.makeRequest(
            'https://fapi.binance.com/fapi/v1/exchangeInfo',
            {},
            'exchangeInfo'
        );
        const validated = ExchangeInfoSchema.parse(data);
        
        return validated.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol);
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos, usando lista básica');
        return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
    }
}

// =====================================================================
// === SCANNER PRINCIPAL ===
// =====================================================================
async function scanVolumeRanking() {
    console.log('\n🔍 Iniciando scan de volume...');
    const startTime = Date.now();
    
    const symbols = await fetchAllFuturesSymbols();
    console.log(`📊 Analisando ${symbols.length} símbolos...`);
    
    const results = [];
    const batchSize = CONFIG.PERFORMANCE.BATCH_SIZE;
    
    for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const batchPromises = batch.map(symbol => analyzeSymbolVolume(symbol));
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                results.push(result.value);
            }
        });
        
        if (i + batchSize < symbols.length) {
            await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SYMBOL_DELAY_MS));
        }
        
        if ((i + batchSize) % 100 === 0 || i + batchSize >= symbols.length) {
            const progress = Math.min(100, ((i + batchSize) / symbols.length * 100)).toFixed(1);
            console.log(`⏳ Progresso: ${progress}% (${results.length} símbolos analisados)`);
        }
    }
    
    console.log(`✅ Análise concluída: ${results.length} símbolos válidos`);
    
    const buyers = results
        .filter(r => r.direction === 'COMPRADOR')
        .sort((a, b) => b.buyerPercentage - a.buyerPercentage)
        .slice(0, CONFIG.VOLUME.TOP_COUNT);
    
    const sellers = results
        .filter(r => r.direction === 'VENDEDOR')
        .sort((a, b) => b.sellerPercentage - a.sellerPercentage)
        .slice(0, CONFIG.VOLUME.TOP_COUNT);
    
    if (buyers.length === 0 && sellers.length === 0) {
        console.log('⚠️ Nenhum comprador/vendedor forte, buscando neutros...');
        
        const neutros = results
            .filter(r => r.direction === 'NEUTRO')
            .sort((a, b) => Math.max(b.buyerPercentage, b.sellerPercentage) - Math.max(a.buyerPercentage, a.sellerPercentage));
        
        const quaseCompradores = neutros
            .filter(r => r.buyerPercentage > 48)
            .slice(0, 5)
            .map(r => ({ ...r, direction: 'COMPRADOR', emoji: '🟡' }));
        
        const quaseVendedores = neutros
            .filter(r => r.sellerPercentage > 48)
            .slice(0, 5)
            .map(r => ({ ...r, direction: 'VENDEDOR', emoji: '🟡' }));
        
        buyers.push(...quaseCompradores);
        sellers.push(...quaseVendedores);
    }
    
    const scanTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⏱️ Scan completo em ${scanTime}s`);
    console.log(`📊 Encontrados: ${buyers.length} compradores, ${sellers.length} vendedores`);
    
    return { buyers, sellers, time: getBrazilianDateTime() };
}

// =====================================================================
// === LOOP PRINCIPAL ===
// =====================================================================
async function mainLoop() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TITANIUM VOLUME SCANNER');
    console.log('📊 Monitorando volume ');
    console.log('='.repeat(60) + '\n');
    
    let { buyers, sellers, time } = await scanVolumeRanking();
    const message = formatRankingMessage(buyers, sellers, time);
    await sendTelegramAlert(message);
    
    while (true) {
        console.log(`\n⏳ Próximo scan em ${CONFIG.PERFORMANCE.SCAN_INTERVAL_MINUTES} minutos...`);
        await new Promise(r => setTimeout(r, CONFIG.PERFORMANCE.SCAN_INTERVAL_MINUTES * 60 * 1000));
        
        const result = await scanVolumeRanking();
        const newMessage = formatRankingMessage(result.buyers, result.sellers, result.time);
        await sendTelegramAlert(newMessage);
    }
}

// =====================================================================
// === INICIALIZAÇÃO ===
// =====================================================================
async function startBot() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TITANIUM VOLUME SCANNER');
    console.log('='.repeat(60) + '\n');
    
    console.log('📅 Inicializando...');
    console.log(`📱 Telegram Token: ${CONFIG.TELEGRAM.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`📱 Telegram Chat ID: ${CONFIG.TELEGRAM.CHAT_ID ? '✅' : '❌'}`);
    
    const initTime = getBrazilianDateTime();
    const initMessage = `<i>🚀 <b>TITANIUM VOLUME SCANNER</b> 📅 ${initTime.full}

📊 Monitorando 
🔝 Top ${CONFIG.VOLUME.TOP_COUNT} comprador/vendedor
⏱️ A cada ${CONFIG.PERFORMANCE.SCAN_INTERVAL_MINUTES}min
📊 S/R$ incluídos no ranking

✅ Scanner ativo!</i>`;
    
    await sendTelegramAlert(initMessage);
    console.log('✅ Bot inicializado! Iniciando scanner...\n');
    
    await mainLoop();
}

// =====================================================================
// === HANDLERS DE ERRO ===
// =====================================================================
process.on('uncaughtException', (err) => {
    console.error('\n❌ UNCAUGHT EXCEPTION:', err.message);
    console.error('Stack:', err.stack);
});

process.on('unhandledRejection', (reason) => {
    console.error('\n❌ UNHANDLED REJECTION:', reason);
});

// =====================================================================
// === START ===
// =====================================================================
console.log('🚀 Iniciando Titanium Volume Scanner...');
startBot().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});
