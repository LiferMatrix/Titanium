const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// =====================================================================
// 🆕 SISTEMA DE CONTAGEM DE ALERTAS
// =====================================================================
class AlertCounter {
    constructor() {
        this.dailyCounters = new Map(); // symbol -> count
        this.lastResetDate = this.getCurrentBrazilianDate();
        this.resetHour = 21; // 21h horário de Brasília
    }

    getCurrentBrazilianDate() {
        try {
            const now = new Date();
            const offset = -3; // UTC-3 para Brasília
            const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
            return brazilTime.toISOString().split('T')[0]; // YYYY-MM-DD
        } catch (error) {
            return new Date().toISOString().split('T')[0];
        }
    }

    getCurrentBrazilianHour() {
        try {
            const now = new Date();
            const offset = -3; // UTC-3 para Brasília
            const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);
            return brazilTime.getUTCHours(); // 0-23
        } catch (error) {
            return new Date().getUTCHours() - 3;
        }
    }

    checkAndReset() {
        try {
            const currentDate = this.getCurrentBrazilianDate();
            const currentHour = this.getCurrentBrazilianHour();
            
            // Se mudou o dia OU se é 21h ou mais, resetamos os contadores
            if (currentDate !== this.lastResetDate || currentHour >= this.resetHour) {
                console.log(`🔄 Resetando contadores de alerta (${currentDate} ${currentHour}h)`);
                this.dailyCounters.clear();
                this.lastResetDate = currentDate;
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Erro em checkAndReset:', error.message);
            return false;
        }
    }

    getAlertNumber(symbol) {
        try {
            this.checkAndReset(); // Verifica se precisa resetar
            
            if (!this.dailyCounters.has(symbol)) {
                this.dailyCounters.set(symbol, 1);
                return 1;
            } else {
                const currentCount = this.dailyCounters.get(symbol) + 1;
                this.dailyCounters.set(symbol, currentCount);
                return currentCount;
            }
        } catch (error) {
            console.error('❌ Erro em getAlertNumber:', error.message);
            return 1;
        }
    }

    getCurrentCount(symbol) {
        return this.dailyCounters.get(symbol) || 0;
    }

    resetAll() {
        this.dailyCounters.clear();
        this.lastResetDate = this.getCurrentBrazilianDate();
        console.log('🔄 Todos os contadores de alerta resetados');
    }
}

// Instância global do contador de alertas
const alertCounter = new AlertCounter();

// =====================================================================
// 🛡️ FALLBACK PARA TECHNICALINDICATORS
// =====================================================================
let technicalIndicators;
try {
    technicalIndicators = require('technicalindicators');
    console.log('✅ technicalindicators carregado com sucesso');
} catch (error) {
    console.error('❌ Erro ao carregar technicalindicators:', error.message);
    console.log('⚠️ Usando fallback para indicadores técnicos');
    
    technicalIndicators = {
        CCI: {
            calculate: ({ high, low, close, period }) => {
                try {
                    if (!high || !low || !close || high.length < period) return [];
                    
                    const result = [];
                    
                    for (let i = period - 1; i < close.length; i++) {
                        const typicalPrices = [];
                        for (let j = i - period + 1; j <= i; j++) {
                            typicalPrices.push((high[j] + low[j] + close[j]) / 3);
                        }
                        
                        const sma = typicalPrices.reduce((sum, price) => sum + price, 0) / period;
                        
                        let meanDeviation = 0;
                        for (let j = 0; j < typicalPrices.length; j++) {
                            meanDeviation += Math.abs(typicalPrices[j] - sma);
                        }
                        meanDeviation /= period;
                        
                        const cci = meanDeviation !== 0 ? 
                            (typicalPrices[typicalPrices.length - 1] - sma) / (0.015 * meanDeviation) : 0;
                        
                        result.push(cci);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback CCI:', error.message);
                    return [];
                }
            }
        },
        EMA: {
            calculate: ({ period, values }) => {
                try {
                    if (!values || values.length === 0) return [50];
                    if (values.length < period) return values.map(() => values[0]);
                    
                    const result = [];
                    const multiplier = 2 / (period + 1);
                    let ema = values[0];
                    
                    for (let i = 0; i < values.length; i++) {
                        if (i === 0) {
                            ema = values[i];
                        } else {
                            ema = (values[i] - ema) * multiplier + ema;
                        }
                        result.push(ema);
                    }
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback EMA:', error.message);
                    return values || [50];
                }
            }
        },
        RSI: {
            calculate: ({ values, period }) => {
                try {
                    if (!values || values.length < period + 1) return Array(values.length).fill(50);
                    
                    const result = [];
                    
                    for (let i = period; i < values.length; i++) {
                        let gains = 0;
                        let losses = 0;
                        
                        for (let j = i - period + 1; j <= i; j++) {
                            const diff = values[j] - values[j - 1];
                            if (diff > 0) gains += diff;
                            else losses += Math.abs(diff);
                        }
                        
                        const avgGain = gains / period;
                        const avgLoss = losses / period;
                        
                        if (avgLoss === 0) {
                            result.push(100);
                        } else {
                            const rs = avgGain / avgLoss;
                            result.push(100 - (100 / (1 + rs)));
                        }
                    }
                    
                    return result.length > 0 ? result : [50];
                } catch (error) {
                    console.log('⚠️ Erro no fallback RSI:', error.message);
                    return [50];
                }
            }
        },
        ADX: {
            calculate: ({ high, low, close, period }) => {
                try {
                    if (!high || !low || !close || high.length < period) return [];
                    
                    const result = [];
                    const atrPeriod = 14;
                    
                    for (let i = period - 1; i < close.length; i++) {
                        // Implementação simplificada do ADX
                        let plusDM = 0;
                        let minusDM = 0;
                        
                        for (let j = i - period + 2; j <= i; j++) {
                            const upMove = high[j] - high[j - 1];
                            const downMove = low[j - 1] - low[j];
                            
                            if (upMove > downMove && upMove > 0) {
                                plusDM += upMove;
                            } else if (downMove > upMove && downMove > 0) {
                                minusDM += downMove;
                            }
                        }
                        
                        const tr = Math.max(
                            high[i] - low[i],
                            Math.abs(high[i] - close[i - 1]),
                            Math.abs(low[i] - close[i - 1])
                        );
                        
                        const atr = tr; // Simplificado
                        
                        const plusDI = atr !== 0 ? (plusDM / atr) * 100 : 0;
                        const minusDI = atr !== 0 ? (minusDM / atr) * 100 : 0;
                        
                        const dx = (plusDI + minusDI) !== 0 ? 
                            Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
                        
                        result.push(dx);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback ADX:', error.message);
                    return Array(20).fill(20); // Valor padrão
                }
            }
        },
        ATR: {
            calculate: ({ high, low, close, period }) => {
                try {
                    if (!high || !low || !close || high.length < period) return [];
                    
                    const result = [];
                    const trValues = [];
                    
                    for (let i = 0; i < high.length; i++) {
                        let tr = 0;
                        if (i === 0) {
                            tr = high[i] - low[i];
                        } else {
                            const hl = high[i] - low[i];
                            const hc = Math.abs(high[i] - close[i - 1]);
                            const lc = Math.abs(low[i] - close[i - 1]);
                            tr = Math.max(hl, hc, lc);
                        }
                        trValues.push(tr);
                    }
                    
                    // Calcular ATR
                    for (let i = period - 1; i < trValues.length; i++) {
                        let sum = 0;
                        for (let j = i - period + 1; j <= i; j++) {
                            sum += trValues[j];
                        }
                        result.push(sum / period);
                    }
                    
                    return result;
                } catch (error) {
                    console.log('⚠️ Erro no fallback ATR:', error.message);
                    return [];
                }
            }
        }
    };
    console.log('✅ Fallback para indicadores técnicos configurado');
}

const { CCI, EMA, RSI, ADX, ATR } = technicalIndicators;

// =====================================================================
// 🛡️ FALLBACK PARA FETCH GLOBAL
// =====================================================================
if (!globalThis.fetch) {
    try {
        globalThis.fetch = fetch;
        console.log('✅ fetch configurado no globalThis');
    } catch (error) {
        console.error('❌ Erro ao configurar fetch:', error.message);
        globalThis.fetch = function() {
            return Promise.reject(new Error('Fetch não disponível'));
        };
    }
}

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vdg';
const TELEGRAM_CHAT_ID = '-100279';


// === DIRETÓRIOS ===
const LOG_DIR = './logs';

// === CACHE SETTINGS ===
const candleCache = {};
const marketDataCache = {};
const lsrCache = {};
const fundingCache = {};
const cciCache = {};
const supportResistanceCache = {};
const cci12hCache = {};
const cci1hCache = {};
const adxCache = {};
const volume3mCache = {};
const volatilityCache = {};
const ema55Cache = {};
const ema55_15mCache = {};
const atrCache = {};
const CANDLE_CACHE_TTL = 45000;
const MARKET_DATA_CACHE_TTL = 30000;
const LSR_CACHE_TTL = 30000;
const FUNDING_CACHE_TTL = 30000;
const CCI_CACHE_TTL = 300000;
const SR_CACHE_TTL = 60000;
const CCI12H_CACHE_TTL = 180000;
const CCI1H_CACHE_TTL = 120000;
const ADX_CACHE_TTL = 180000;
const VOLUME3M_CACHE_TTL = 60000;
const VOLATILITY_CACHE_TTL = 60000;
const EMA55_CACHE_TTL = 30000;
const EMA55_15M_CACHE_TTL = 30000;
const ATR_CACHE_TTL = 60000;
const MAX_CACHE_AGE = 10 * 60 * 1000;

// =====================================================================
// ⚙️ CONFIGURAÇÕES CCI DIÁRIO
// =====================================================================
const CCI_SETTINGS = {
    period: 20,
    emaPeriod: 5,
    timeframe: '1d',
    requiredCandles: 50,
    thresholds: {
        overbought: 100,
        oversold: -100,
        strongTrend: 200
    }
};

const CCI_ALERT_SETTINGS = {
    emaPeriod: 5,
    timeframe: '1d',
    volumeTimeframe: '1h',
    requiredCandles: 50,
    alertCooldown: 15 * 60 * 1000,
    volumeSensitivity: 1.1,
    alertCheckInterval: 60000,
    minVolumeForAlert: 100000,
    crossTolerance: 0.01,
    maxAlertsPerHour: 10,
    volumePercentThreshold: 10
};

// =====================================================================
// ⚙️ CONFIGURAÇÕES SCORE (128%) - ATUALIZADO COM EMA55
// =====================================================================
const SCORE_CONFIG = {
    // COMPRA (BULLISH) - 13 CRITÉRIOS (128 PONTOS)
    BUY: {
        RSI: { threshold: 63, points: 10 }, // RSI abaixo de 63
        FUNDING: { negative: true, points: 5 }, // Funding negativo
        LSR: { max: 2.5, points: 10 }, // LSR até 2.5
        SUPPORT: { proximity: 1.5, points: 8 }, // 1.5% do suporte
        RESISTANCE: { far: 2.0, points: 8 }, // Longe da resistência
        VOLATILITY: { min: 0.6, points: 8 }, // > 0.6%
        ADX: { min: 20, points: 6 }, // ADX > 20
        VOLUME_3M: { zScore: 1, buyer: true, points: 8 }, // Z-score > 1 (comprador 3m)
        CCI12H: { aboveEMA: true, points: 10 }, // CCI 12h acima EMA5
        CCI1H: { aboveEMA: true, points: 8 }, // CCI 1h acima EMA5
        VOLUME_INCREASE: { threshold: 10, points: 12 }, // Volume aumento ≥10%
        EMA55_1H: { above: true, points: 7 }, // NOVO: Preço acima EMA55 1h
        EMA55_15M: { closedAbove: true, points: 7 } // NOVO: Fechou acima EMA55 15m
    },
    // VENDA (BEARISH) - 13 CRITÉRIOS (128 PONTOS)
    SELL: {
        RSI: { threshold: 65, points: 10 }, // RSI acima de 65
        FUNDING: { positive: true, points: 5 }, // Funding positivo
        LSR: { min: 3, points: 10 }, // LSR acima de 3
        RESISTANCE: { proximity: 1.5, points: 8 }, // Próximo da resistência
        SUPPORT: { far: 2.0, points: 8 }, // Longe do suporte
        ADX: { min: 20, points: 6 }, // ADX > 20
        VOLATILIDADE: { min: 0.6, points: 8 }, // > 0.6%
        VOLUME_3M: { zScore: 1, seller: true, points: 8 }, // Z-score > 1 (vendedor 3m)
        CCI12H: { belowEMA: true, points: 10 }, // CCI 12h abaixo EMA5
        CCI1H: { belowEMA: true, points: 8 }, // CCI 1h abaixo EMA5
        VOLUME_INCREASE: { threshold: 10, points: 12 }, // Volume aumento ≥10%
        EMA55_1H: { below: true, points: 7 }, // NOVO: Preço abaixo EMA55 1h
        EMA55_15M: { closedBelow: true, points: 7 } // NOVO: Fechou abaixo EMA55 15m
    }
};

// =====================================================================
// 🆕 COOLDOWN PARA ALERTAS CCI
// =====================================================================
const cciAlertCooldownMap = new Map();

// =====================================================================
// 📊 FUNÇÕES AUXILIARES
// =====================================================================
function logToFile(message) {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            fs.mkdirSync(LOG_DIR, { recursive: true });
        }

        const logFile = path.join(LOG_DIR, `cci_alert_${new Date().toISOString().split('T')[0]}.log`);
        const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const logMessage = `[${timestamp}] ${message}\n`;

        fs.appendFileSync(logFile, logMessage, 'utf8');

    } catch (error) {
        console.error('❌ Erro ao escrever no log:', error.message);
    }
}

function getBrazilianDateTime() {
    try {
        const now = new Date();
        const offset = -3;
        const brazilTime = new Date(now.getTime() + offset * 60 * 60 * 1000);

        const date = brazilTime.toISOString().split('T')[0].split('-').reverse().join('/');
        const time = brazilTime.toISOString().split('T')[1].split('.')[0].substring(0, 5);

        return { date, time, full: `${date} ${time}` };
    } catch (error) {
        console.error('❌ Erro em getBrazilianDateTime:', error.message);
        return { date: '01/01/2024', time: '00:00', full: '01/01/2024 00:00' };
    }
}

function getScoreQuality(percentage) {
    if (percentage >= 90) {
        return { 
            emoji: '✨🟢✨', 
            text: 'Excelente',
            color: '🟢'
        };
    } else if (percentage >= 70) {
        return { 
            emoji: '🏆✨', 
            text: 'Muito Bom',
            color: '🟡'
        };
    } else if (percentage >= 50) {
        return { 
            emoji: '🏆', 
            text: 'Bom',
            color: '🟡'
        };
    } else {
        return { 
            emoji: '🔴', 
            text: 'Fraco',
            color: '🔴'
        };
    }
}

async function sendTelegramAlert(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
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
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }

        console.log('✅ Mensagem enviada para Telegram');
        logToFile(`📤 Alerta CCI enviado para Telegram`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta:', error.message);
        return false;
    }
}

// =====================================================================
// 📊 FUNÇÕES PARA OBTER DADOS DO MERCADO - VERSÃO REVISADA
// =====================================================================
async function getCandlesCached(symbol, timeframe, limit = 80) {
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

        const interval = intervalMap[timeframe] || '1d';
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 100)}`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data || !Array.isArray(data)) {
            console.log(`⚠️ Dados de candles inválidos para ${symbol}`);
            return [];
        }

        const candles = data.map(candle => ({
            open: parseFloat(candle[1]) || 0,
            high: parseFloat(candle[2]) || 0,
            low: parseFloat(candle[3]) || 0,
            close: parseFloat(candle[4]) || 0,
            volume: parseFloat(candle[5]) || 0,
            quoteVolume: parseFloat(candle[7]) || 0,
            trades: parseFloat(candle[8]) || 0,
            time: candle[0] || Date.now()
        }));

        candleCache[cacheKey] = { data: candles, timestamp: now };
        return candles;
    } catch (error) {
        console.log(`⚠️ Erro candles ${symbol}: ${error.message}`);
        return [];
    }
}

async function getMarketData(symbol) {
    try {
        const cacheKey = `market_${symbol}`;
        const now = Date.now();

        if (marketDataCache[cacheKey] && now - marketDataCache[cacheKey].timestamp < MARKET_DATA_CACHE_TTL) {
            return marketDataCache[cacheKey].data;
        }

        const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;

        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data) {
            console.log(`⚠️ Dados de mercado inválidos para ${symbol}`);
            return null;
        }

        const marketData = {
            priceChange: parseFloat(data.priceChange) || 0,
            priceChangePercent: parseFloat(data.priceChangePercent) || 0,
            weightedAvgPrice: parseFloat(data.weightedAvgPrice) || 0,
            lastPrice: parseFloat(data.lastPrice) || 0,
            volume: parseFloat(data.volume) || 0,
            quoteVolume: parseFloat(data.quoteVolume) || 0,
            highPrice: parseFloat(data.highPrice) || 0,
            lowPrice: parseFloat(data.lowPrice) || 0,
            openPrice: parseFloat(data.openPrice) || 0,
            prevClosePrice: parseFloat(data.prevClosePrice) || 0
        };

        marketDataCache[cacheKey] = { data: marketData, timestamp: now };
        return marketData;
    } catch (error) {
        console.log(`⚠️ Erro market data ${symbol}: ${error.message}`);
        return null;
    }
}

async function getBinanceLSRValue(symbol, period = '15m') {
    try {
        const cacheKey = `binance_lsr_${symbol}_${period}`;
        const now = Date.now();
        
        if (lsrCache[cacheKey] && now - lsrCache[cacheKey].timestamp < LSR_CACHE_TTL) {
            return lsrCache[cacheKey].data;
        }
        
        const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=2`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            console.log(`⚠️ Resposta da API LSR vazia para ${symbol}.`);
            return null;
        }
        
        const latestData = data[0];
        
        if (!latestData.longShortRatio || !latestData.longAccount || !latestData.shortAccount) {
            console.log(`⚠️ Estrutura de dados LSR inesperada para ${symbol}:`, latestData);
            return null;
        }
        
        const currentLSR = parseFloat(latestData.longShortRatio);
        
        let percentChange = '0.00';
        let isRising = false;
        
        if (data.length >= 2) {
            const previousData = data[1];
            const previousLSR = parseFloat(previousData.longShortRatio);
            
            if (previousLSR !== 0) {
                percentChange = ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2);
                isRising = currentLSR > previousLSR;
            }
        }
        
        const result = {
            lsrValue: currentLSR,
            longAccount: parseFloat(latestData.longAccount),
            shortAccount: parseFloat(latestData.shortAccount),
            percentChange: percentChange,
            isRising: isRising,
            timestamp: latestData.timestamp,
            raw: latestData
        };
        
        lsrCache[cacheKey] = { data: result, timestamp: now };
        
        console.log(`📊 Binance LSR ${symbol} (${period}): ${result.lsrValue.toFixed(3)} (${percentChange}%) ${isRising ? '⬆️' : '⬇️'}`);
        
        return result;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar LSR da Binance para ${symbol}:`, error.message);
        return null;
    }
}

async function checkFundingRate(symbol) {
    try {
        const cacheKey = `funding_${symbol}`;
        const now = Date.now();
        
        if (fundingCache[cacheKey] && now - fundingCache[cacheKey].timestamp < FUNDING_CACHE_TTL) {
            return fundingCache[cacheKey].data;
        }

        const response = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data || data.length === 0) {
            return { 
                raw: 0,
                emoji: '⚪',
                text: 'Indisponível',
                percentage: '0.00000'
            };
        }

        const fundingRate = parseFloat(data[0].fundingRate) || 0;
        
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
            : 'Indisponível';
        
        const result = {
            raw: fundingRate,
            emoji: fundingRateEmoji,
            text: fundingRateText,
            percentage: (fundingRate * 100).toFixed(5)
        };
        
        fundingCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
    } catch (error) {
        console.log(`⚠️ Erro funding rate ${symbol}: ${error.message}`);
        return { 
            raw: 0,
            emoji: '⚪',
            text: 'Indisponível',
            percentage: '0.00000'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR ATR (Average True Range)
// =====================================================================
async function calculateATR(symbol, period = 14) {
    try {
        const cacheKey = `atr_${symbol}_${period}`;
        const now = Date.now();
        
        if (atrCache[cacheKey] && now - atrCache[cacheKey].timestamp < ATR_CACHE_TTL) {
            return atrCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '1d', period + 20);
        if (candles.length < period + 5) return null;
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const atrValues = ATR.calculate({
            high: high,
            low: low,
            close: close,
            period: period
        });
        
        if (!atrValues || atrValues.length === 0) return null;
        
        const currentATR = atrValues[atrValues.length - 1];
        const currentPrice = close[close.length - 1];
        const atrPercent = (currentATR / currentPrice) * 100;
        
        const result = {
            value: currentATR,
            percent: atrPercent,
            stopDistance: currentATR * 1.5, // Stop adaptativo baseado no ATR
            formatted: `ATR: ${currentATR.toFixed(6)} (${atrPercent.toFixed(2)}%)`
        };
        
        atrCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro ATR ${symbol}: ${error.message}`);
        return {
            value: 0,
            percent: 0,
            stopDistance: 0,
            formatted: 'ATR: N/A'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÕES PARA CALCULAR SCORE - VERSÃO REVISADA
// =====================================================================
async function getRSI(symbol, timeframe = '1h', period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 25);
        if (candles.length < period + 10) return null;

        const closes = candles.map(c => c.close);
        
        const rsiValues = RSI.calculate({
            values: closes,
            period: period
        });
        
        if (!rsiValues || rsiValues.length === 0) {
            return null;
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        
        let status = 'NEUTRAL';
        let emoji = '⚪';
        
        if (currentRSI >= 30 && currentRSI <= 60) {
            status = 'ZONA DE COMPRA';
            emoji = '🟢';
        } 
        else if (currentRSI >= 61 && currentRSI <= 85) {
            status = 'ZONA DE VENDA';
            emoji = '🔴';
        }
        
        return {
            value: currentRSI,
            status: status,
            emoji: emoji,
            formatted: `${currentRSI.toFixed(1)} ${emoji} (${status})`
        };
    } catch (error) {
        console.log(`⚠️ Erro RSI ${symbol}: ${error.message}`);
        return {
            value: 50,
            status: 'NEUTRAL',
            emoji: '⚪',
            formatted: '50.0 ⚪ (NEUTRAL)'
        };
    }
}

async function getADX1h(symbol) {
    try {
        const cacheKey = `adx_1h_${symbol}`;
        const now = Date.now();
        
        if (adxCache[cacheKey] && now - adxCache[cacheKey].timestamp < ADX_CACHE_TTL) {
            return adxCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '1h', 50);
        if (candles.length < 30) return null;
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const adxValues = ADX.calculate({
            high: high,
            low: low,
            close: close,
            period: 14
        });
        
        if (!adxValues || adxValues.length === 0) return null;
        
        const currentADX = adxValues[adxValues.length - 1];
        
        const result = {
            value: currentADX,
            strong: currentADX > 25,
            formatted: `ADX 1h: ${currentADX.toFixed(1)} ${currentADX > 20 ? '🟢' : '🔴'}`
        };
        
        adxCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro ADX ${symbol}: ${error.message}`);
        return {
            value: 20,
            strong: false,
            formatted: 'ADX 1h: 20.0 🔴'
        };
    }
}

async function getCCI12h(symbol) {
    try {
        const cacheKey = `cci_12h_${symbol}`;
        const now = Date.now();
        
        if (cci12hCache[cacheKey] && now - cci12hCache[cacheKey].timestamp < CCI12H_CACHE_TTL) {
            return cci12hCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '12h', 50);
        if (candles.length < 30) return null;
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: high,
            low: low,
            close: close,
            period: 20
        });
        
        if (!cciValues || cciValues.length < 10) return null;
        
        const cciEmaValues = EMA.calculate({
            period: 5,
            values: cciValues
        });
        
        const currentCCI = cciValues[cciValues.length - 1];
        const currentCCI_EMA = cciEmaValues[cciEmaValues.length - 1];
        
        const result = {
            cciValue: currentCCI,
            cciEMA: currentCCI_EMA,
            aboveEMA: currentCCI > currentCCI_EMA,
            belowEMA: currentCCI < currentCCI_EMA,
            formatted: `CCI 12h: ${currentCCI.toFixed(2)} ${currentCCI > currentCCI_EMA ? '🟢' : '🔴'}`
        };
        
        cci12hCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro CCI 12h ${symbol}: ${error.message}`);
        return {
            cciValue: 0,
            cciEMA: 0,
            aboveEMA: false,
            belowEMA: false,
            formatted: 'CCI 12h: 0.00 ⚪'
        };
    }
}

async function getCCI1h(symbol) {
    try {
        const cacheKey = `cci_1h_${symbol}`;
        const now = Date.now();
        
        if (cci1hCache[cacheKey] && now - cci1hCache[cacheKey].timestamp < CCI1H_CACHE_TTL) {
            return cci1hCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '1h', 50);
        if (candles.length < 30) return null;
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: high,
            low: low,
            close: close,
            period: 20
        });
        
        if (!cciValues || cciValues.length < 10) return null;
        
        const cciEmaValues = EMA.calculate({
            period: 5,
            values: cciValues
        });
        
        const currentCCI = cciValues[cciValues.length - 1];
        const currentCCI_EMA = cciEmaValues[cciEmaValues.length - 1];
        
        const result = {
            cciValue: currentCCI,
            cciEMA: currentCCI_EMA,
            aboveEMA: currentCCI > currentCCI_EMA,
            belowEMA: currentCCI < currentCCI_EMA,
            formatted: `CCI 1h: ${currentCCI.toFixed(2)} ${currentCCI > currentCCI_EMA ? '🟢' : '🔴'}`
        };
        
        cci1hCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro CCI 1h ${symbol}: ${error.message}`);
        return {
            cciValue: 0,
            cciEMA: 0,
            aboveEMA: false,
            belowEMA: false,
            formatted: 'CCI 1h: 0.00 ⚪'
        };
    }
}

async function getVolumeAnalysis3m(symbol) {
    try {
        const cacheKey = `volume_3m_${symbol}`;
        const now = Date.now();
        
        if (volume3mCache[cacheKey] && now - volume3mCache[cacheKey].timestamp < VOLUME3M_CACHE_TTL) {
            return volume3mCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '3m', 20);
        if (candles.length < 10) return null;
        
        // Calcular Z-score do volume
        const volumes = candles.map(c => c.quoteVolume);
        const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const stdDev = Math.sqrt(
            volumes.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / volumes.length
        );
        
        const lastVolume = volumes[volumes.length - 1];
        const zScore = stdDev !== 0 ? (lastVolume - mean) / stdDev : 0;
        
        // Determinar se é comprador ou vendedor
        const lastCandle = candles[candles.length - 1];
        const isBuyerVolume = lastCandle.close > lastCandle.open;
        const isSellerVolume = lastCandle.close < lastCandle.open;
        
        const result = {
            zScore: zScore,
            lastVolume: lastVolume,
            meanVolume: mean,
            isBuyerVolume: isBuyerVolume,
            isSellerVolume: isSellerVolume,
            isSignificant: zScore > 1,
            formatted: `Volume 3m: ${(lastVolume / 1000).toFixed(1)}k (Z:${zScore.toFixed(2)}) ${zScore > 1 ? '🟢' : '🔴'}`
        };
        
        volume3mCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro volume 3m ${symbol}: ${error.message}`);
        return {
            zScore: 0,
            lastVolume: 0,
            meanVolume: 0,
            isBuyerVolume: false,
            isSellerVolume: false,
            isSignificant: false,
            formatted: 'Volume 3m: 0.0k (Z:0.00) ⚪'
        };
    }
}

async function getVolatility(symbol) {
    try {
        const cacheKey = `volatility_${symbol}`;
        const now = Date.now();
        
        if (volatilityCache[cacheKey] && now - volatilityCache[cacheKey].timestamp < VOLATILITY_CACHE_TTL) {
            return volatilityCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '15m', 20);
        if (candles.length < 10) return null;
        
        let totalRange = 0;
        for (let i = 1; i < candles.length; i++) {
            const range = (candles[i].high - candles[i].low) / candles[i - 1].close;
            totalRange += Math.abs(range) * 100; // Converter para percentual
        }
        
        const avgVolatility = totalRange / (candles.length - 1);
        
        const result = {
            value: avgVolatility,
            high: avgVolatility > 0.6,
            formatted: `Volatilidade: ${avgVolatility.toFixed(2)}% ${avgVolatility > 0.6 ? '🟢' : '🔴'}`
        };
        
        volatilityCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro volatilidade ${symbol}: ${error.message}`);
        return {
            value: 0.5,
            high: false,
            formatted: 'Volatilidade: 0.50% 🔴'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR EMA55 1H
// =====================================================================
async function checkEMA55_1H(symbol) {
    try {
        const cacheKey = `ema55_1h_${symbol}`;
        const now = Date.now();
        
        if (ema55Cache[cacheKey] && now - ema55Cache[cacheKey].timestamp < EMA55_CACHE_TTL) {
            return ema55Cache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '1h', 60);
        if (candles.length < 55) return null;
        
        const closes = candles.map(c => c.close);
        
        const ema55Values = EMA.calculate({
            period: 55,
            values: closes
        });
        
        if (!ema55Values || ema55Values.length === 0) return null;
        
        const currentEMA55 = ema55Values[ema55Values.length - 1];
        const lastClose = closes[closes.length - 1];
        
        const priceAboveEMA = lastClose > currentEMA55;
        const priceBelowEMA = lastClose < currentEMA55;
        
        const distancePercent = ((lastClose - currentEMA55) / currentEMA55) * 100;
        
        const result = {
            emaValue: currentEMA55,
            currentPrice: lastClose,
            above: priceAboveEMA,
            below: priceBelowEMA,
            distancePercent: distancePercent,
            formatted: `EMA55 1h: $${currentEMA55.toFixed(6)} | Preço: $${lastClose.toFixed(6)} ${priceAboveEMA ? '🟢 Acima' : '🔴 Abaixo'} (${distancePercent.toFixed(2)}%)`
        };
        
        ema55Cache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro EMA55 1h ${symbol}: ${error.message}`);
        return {
            emaValue: 0,
            currentPrice: 0,
            above: false,
            below: false,
            distancePercent: 0,
            formatted: 'EMA55 1h: $0.000000 | Preço: $0.000000 ⚪'
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR FECHAMENTO EM RELAÇÃO À EMA55 15M
// =====================================================================
async function checkEMA55_15M_Close(symbol) {
    try {
        const cacheKey = `ema55_15m_close_${symbol}`;
        const now = Date.now();
        
        if (ema55_15mCache[cacheKey] && now - ema55_15mCache[cacheKey].timestamp < EMA55_15M_CACHE_TTL) {
            return ema55_15mCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '15m', 60);
        if (candles.length < 55) return null;
        
        const closes = candles.map(c => c.close);
        
        const ema55Values = EMA.calculate({
            period: 55,
            values: closes
        });
        
        if (!ema55Values || ema55Values.length === 0) return null;
        
        const currentEMA55 = ema55Values[ema55Values.length - 1];
        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        
        // Verificar se a vela atual fechou acima/abaixo da EMA55
        const currentCloseAboveEMA = lastCandle.close > currentEMA55;
        const currentCloseBelowEMA = lastCandle.close < currentEMA55;
        
        // Verificar se a vela anterior fechou abaixo/acima (para verificar cruzamento)
        const previousClose = previousCandle ? previousCandle.close : lastCandle.close;
        const previousCloseAboveEMA = previousClose > currentEMA55;
        const previousCloseBelowEMA = previousClose < currentEMA55;
        
        // Verificar cruzamento
        const crossedAbove = previousCloseBelowEMA && currentCloseAboveEMA;
        const crossedBelow = previousCloseAboveEMA && currentCloseBelowEMA;
        
        const result = {
            emaValue: currentEMA55,
            currentClose: lastCandle.close,
            currentOpen: lastCandle.open,
            currentHigh: lastCandle.high,
            currentLow: lastCandle.low,
            closedAbove: currentCloseAboveEMA,
            closedBelow: currentCloseBelowEMA,
            crossedAbove: crossedAbove,
            crossedBelow: crossedBelow,
            distancePercent: ((lastCandle.close - currentEMA55) / currentEMA55) * 100,
            formatted: `Fechamento 15m: $${lastCandle.close.toFixed(6)} | EMA55: $${currentEMA55.toFixed(6)} ${currentCloseAboveEMA ? '🟢 Acima' : '🔴 Abaixo'}`
        };
        
        ema55_15mCache[cacheKey] = { data: result, timestamp: now };
        return result;
    } catch (error) {
        console.log(`⚠️ Erro EMA55 15m close ${symbol}: ${error.message}`);
        return {
            emaValue: 0,
            currentClose: 0,
            currentOpen: 0,
            currentHigh: 0,
            currentLow: 0,
            closedAbove: false,
            closedBelow: false,
            crossedAbove: false,
            crossedBelow: false,
            distancePercent: 0,
            formatted: 'Fechamento 15m: $0.000000 | EMA55: $0.000000 ⚪'
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO PARA CALCULAR SUPORTE/RESISTÊNCIA - VERSÃO REVISADA
// =====================================================================
async function calculateSupportResistance(symbol) {
    try {
        const cacheKey = `sr_${symbol}`;
        const now = Date.now();
        
        if (supportResistanceCache[cacheKey] && now - supportResistanceCache[cacheKey].timestamp < SR_CACHE_TTL) {
            return supportResistanceCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, '1d', 30);
        if (candles.length < 15) {
            return {
                supports: [],
                resistances: [],
                currentPrice: 0
            };
        }
        
        const marketData = await getMarketData(symbol);
        if (!marketData) {
            return {
                supports: [],
                resistances: [],
                currentPrice: 0
            };
        }
        
        const currentPrice = marketData.lastPrice;
        
        // Identificar topos e fundos
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        
        // Encontrar resistências (topos)
        const resistances = [];
        for (let i = 2; i < highs.length - 2; i++) {
            if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && 
                highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
                resistances.push({
                    level: `R${resistances.length + 1}`,
                    value: highs[i],
                    distance: Math.abs((highs[i] - currentPrice) / currentPrice * 100)
                });
            }
        }
        
        // Encontrar suportes (fundos)
        const supports = [];
        for (let i = 2; i < lows.length - 2; i++) {
            if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && 
                lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
                supports.push({
                    level: `S${supports.length + 1}`,
                    value: lows[i],
                    distance: Math.abs((lows[i] - currentPrice) / currentPrice * 100)
                });
            }
        }
        
        // Ordenar por proximidade
        supports.sort((a, b) => a.distance - b.distance);
        resistances.sort((a, b) => a.distance - b.distance);
        
        // Pegar os 2 mais próximos de cada
        const nearestSupports = supports.slice(0, 3);
        const nearestResistances = resistances.slice(0, 3);
        
        const result = {
            supports: nearestSupports,
            resistances: nearestResistances,
            currentPrice: currentPrice
        };
        
        supportResistanceCache[cacheKey] = { data: result, timestamp: now };
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular suporte/resistência ${symbol}: ${error.message}`);
        return {
            supports: [],
            resistances: [],
            currentPrice: 0
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA BUSCAR TODOS OS DADOS NECESSÁRIOS PARA A MENSAGEM
// =====================================================================
async function getAllMarketData(symbol) {
    try {
        console.log(`📊 Buscando todos os dados para ${symbol}...`);
        
        // Buscar dados em paralelo
        const [
            marketData,
            rsiData,
            fundingData,
            lsrData,
            volume3mData,
            cci1hData,
            atrData,
            srData
        ] = await Promise.allSettled([
            getMarketData(symbol),
            getRSI(symbol, '1h'),
            checkFundingRate(symbol),
            getBinanceLSRValue(symbol, '15m'),
            getVolumeAnalysis3m(symbol),
            getCCI1h(symbol),
            calculateATR(symbol),
            calculateSupportResistance(symbol)
        ]);
        
        return {
            marketData: marketData.status === 'fulfilled' ? marketData.value : null,
            rsi: rsiData.status === 'fulfilled' ? rsiData.value : { value: 50, emoji: '⚪' },
            funding: fundingData.status === 'fulfilled' ? fundingData.value : { raw: 0, emoji: '⚪', percentage: '0.00000' },
            lsr: lsrData.status === 'fulfilled' ? lsrData.value : { lsrValue: 0, isRising: false, percentChange: '0.00' },
            volume3m: volume3mData.status === 'fulfilled' ? volume3mData.value : { lastVolume: 0, zScore: 0, isBuyerVolume: false, isSellerVolume: false },
            cci1h: cci1hData.status === 'fulfilled' ? cci1hData.value : { cciValue: 0, aboveEMA: false, belowEMA: false },
            atr: atrData.status === 'fulfilled' ? atrData.value : { stopDistance: 0, percent: 0 },
            sr: srData.status === 'fulfilled' ? srData.value : { supports: [], resistances: [], currentPrice: 0 }
        };
    } catch (error) {
        console.log(`⚠️ Erro ao buscar dados para ${symbol}: ${error.message}`);
        return {
            marketData: null,
            rsi: { value: 50, emoji: '⚪' },
            funding: { raw: 0, emoji: '⚪', percentage: '0.00000' },
            lsr: { lsrValue: 0, isRising: false, percentChange: '0.00' },
            volume3m: { lastVolume: 0, zScore: 0, isBuyerVolume: false, isSellerVolume: false },
            cci1h: { cciValue: 0, aboveEMA: false, belowEMA: false },
            atr: { stopDistance: 0, percent: 0 },
            sr: { supports: [], resistances: [], currentPrice: 0 }
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR SCORE - VERSÃO CORRIGIDA
// =====================================================================
async function calculateScore(symbol, signalType, volumeIncreasePercent) {
    try {
        let score = 0;
        let maxScore = 128;
        let criteria = [];
        
        // Buscar todos os dados necessários para o score
        const allData = await getAllMarketData(symbol);
        
        // Extrair dados
        const { rsiData, fundingData, lsrData, volume3mData, cci1hData } = await (async () => {
            // Buscar dados adicionais necessários para o score
            const [
                rsi,
                funding,
                lsr,
                adxData,
                cci12hData,
                cci1h,
                volume3m,
                volatilityData,
                srData,
                ema55_1hData,
                ema55_15mData
            ] = await Promise.allSettled([
                getRSI(symbol, '1h'),
                checkFundingRate(symbol),
                getBinanceLSRValue(symbol, '15m'),
                getADX1h(symbol),
                getCCI12h(symbol),
                getCCI1h(symbol),
                getVolumeAnalysis3m(symbol),
                getVolatility(symbol),
                calculateSupportResistance(symbol),
                checkEMA55_1H(symbol),
                checkEMA55_15M_Close(symbol)
            ]);
            
            return {
                rsiData: rsi.status === 'fulfilled' ? rsi.value : { value: 50, status: 'NEUTRAL', emoji: '⚪' },
                fundingData: funding.status === 'fulfilled' ? funding.value : { raw: 0, emoji: '⚪', percentage: '0.00000' },
                lsrData: lsr.status === 'fulfilled' ? lsr.value : { lsrValue: 2.0, isRising: false, percentChange: '0.00' },
                adxData: adxData.status === 'fulfilled' ? adxData.value : { value: 20, strong: false },
                cci12hData: cci12hData.status === 'fulfilled' ? cci12hData.value : { cciValue: 0, cciEMA: 0, aboveEMA: false, belowEMA: false },
                cci1hData: cci1h.status === 'fulfilled' ? cci1h.value : { cciValue: 0, cciEMA: 0, aboveEMA: false, belowEMA: false },
                volume3mData: volume3m.status === 'fulfilled' ? volume3m.value : { zScore: 0, isBuyerVolume: false, isSellerVolume: false },
                volatilityData: volatilityData.status === 'fulfilled' ? volatilityData.value : { value: 0.5, high: false },
                srData: srData.status === 'fulfilled' ? srData.value : { supports: [{ distance: 100 }], resistances: [{ distance: 100 }], currentPrice: 0 },
                ema55_1hData: ema55_1hData.status === 'fulfilled' ? ema55_1hData.value : { above: false, below: false, distancePercent: 0 },
                ema55_15mData: ema55_15mData.status === 'fulfilled' ? ema55_15mData.value : { closedAbove: false, closedBelow: false }
            };
        })();
        
        if (signalType === 'BULLISH') {
            // RSI (5 pontos)
            if (rsiData && rsiData.value < SCORE_CONFIG.BUY.RSI.threshold) {
                score += SCORE_CONFIG.BUY.RSI.points;
                criteria.push(`RSI ${rsiData.value.toFixed(1)} < ${SCORE_CONFIG.BUY.RSI.threshold} (+${SCORE_CONFIG.BUY.RSI.points})`);
            }
            
            // Funding Rate (5 pontos)
            if (fundingData && fundingData.raw < 0) {
                score += SCORE_CONFIG.BUY.FUNDING.points;
                criteria.push(`Funding negativo ${fundingData.percentage}% (+${SCORE_CONFIG.BUY.FUNDING.points})`);
            }
            
            // LSR (12 pontos)
            if (lsrData && lsrData.lsrValue && lsrData.lsrValue <= SCORE_CONFIG.BUY.LSR.max) {
                score += SCORE_CONFIG.BUY.LSR.points;
                criteria.push(`LSR ${lsrData.lsrValue.toFixed(2)} <= ${SCORE_CONFIG.BUY.LSR.max} (+${SCORE_CONFIG.BUY.LSR.points})`);
            }
            
            // Proximidade do suporte (8 pontos)
            if (srData && srData.supports && srData.supports.length > 0) {
                const nearestSupport = Math.min(...srData.supports.map(s => s.distance));
                if (nearestSupport <= SCORE_CONFIG.BUY.SUPPORT.proximity) {
                    score += SCORE_CONFIG.BUY.SUPPORT.points;
                    criteria.push(`Suporte próximo ${nearestSupport.toFixed(2)}% (+${SCORE_CONFIG.BUY.SUPPORT.points})`);
                }
            }
            
            // Distância da resistência (8 pontos)
            if (srData && srData.resistances && srData.resistances.length > 0) {
                const nearestResistance = Math.min(...srData.resistances.map(r => r.distance));
                if (nearestResistance >= SCORE_CONFIG.BUY.RESISTANCE.far) {
                    score += SCORE_CONFIG.BUY.RESISTANCE.points;
                    criteria.push(`Resistência distante ${nearestResistance.toFixed(2)}% (+${SCORE_CONFIG.BUY.RESISTANCE.points})`);
                }
            }
            
            // Volatilidade (8 pontos)
            if (volatilityData && volatilityData.value > SCORE_CONFIG.BUY.VOLATILITY.min) {
                score += SCORE_CONFIG.BUY.VOLATILITY.points;
                criteria.push(`Volatilidade ${volatilityData.value.toFixed(2)}% > ${SCORE_CONFIG.BUY.VOLATILITY.min}% (+${SCORE_CONFIG.BUY.VOLATILITY.points})`);
            }
            
            // ADX (6 pontos)
            if (adxData && adxData.value > SCORE_CONFIG.BUY.ADX.min) {
                score += SCORE_CONFIG.BUY.ADX.points;
                criteria.push(`ADX ${adxData.value.toFixed(1)} > ${SCORE_CONFIG.BUY.ADX.min} (+${SCORE_CONFIG.BUY.ADX.points})`);
            }
            
            // Volume 3m (10 pontos) - COMPRADOR
            if (volume3mData && volume3mData.isBuyerVolume && volume3mData.zScore > SCORE_CONFIG.BUY.VOLUME_3M.zScore) {
                score += SCORE_CONFIG.BUY.VOLUME_3M.points;
                criteria.push(`Volume comprador Z:${volume3mData.zScore.toFixed(2)} > ${SCORE_CONFIG.BUY.VOLUME_3M.zScore} (+${SCORE_CONFIG.BUY.VOLUME_3M.points})`);
            }
            
            // CCI 12h (10 pontos)
            if (cci12hData && cci12hData.aboveEMA) {
                score += SCORE_CONFIG.BUY.CCI12H.points;
                criteria.push(`CCI 12h acima EMA5 (+${SCORE_CONFIG.BUY.CCI12H.points})`);
            }
            
            // CCI 1h (8 pontos)
            if (cci1hData && cci1hData.aboveEMA) {
                score += SCORE_CONFIG.BUY.CCI1H.points;
                criteria.push(`CCI 1h acima EMA5 (+${SCORE_CONFIG.BUY.CCI1H.points})`);
            }
            
            // Volume aumento (13 pontos)
            if (volumeIncreasePercent >= SCORE_CONFIG.BUY.VOLUME_INCREASE.threshold) {
                score += SCORE_CONFIG.BUY.VOLUME_INCREASE.points;
                criteria.push(`Volume ↑ ${volumeIncreasePercent.toFixed(1)}% ≥ ${SCORE_CONFIG.BUY.VOLUME_INCREASE.threshold}% (+${SCORE_CONFIG.BUY.VOLUME_INCREASE.points})`);
            }
            
            // EMA55 1H - Preço acima (7 pontos)
            if (ema55_1hData && ema55_1hData.above) {
                score += SCORE_CONFIG.BUY.EMA55_1H.points;
                criteria.push(`Preço acima EMA55 1h (${ema55_1hData.distancePercent.toFixed(2)}%) (+${SCORE_CONFIG.BUY.EMA55_1H.points})`);
            }
            
            // EMA55 15M - Fechou acima (7 pontos)
            if (ema55_15mData && ema55_15mData.closedAbove) {
                score += SCORE_CONFIG.BUY.EMA55_15M.points;
                criteria.push(`Fechou acima EMA55 15m (+${SCORE_CONFIG.BUY.EMA55_15M.points})`);
            }
            
        } else if (signalType === 'BEARISH') {
            // RSI (5 pontos)
            if (rsiData && rsiData.value > SCORE_CONFIG.SELL.RSI.threshold) {
                score += SCORE_CONFIG.SELL.RSI.points;
                criteria.push(`RSI ${rsiData.value.toFixed(1)} > ${SCORE_CONFIG.SELL.RSI.threshold} (+${SCORE_CONFIG.SELL.RSI.points})`);
            }
            
            // Funding Rate (5 pontos)
            if (fundingData && fundingData.raw > 0) {
                score += SCORE_CONFIG.SELL.FUNDING.points;
                criteria.push(`Funding positivo ${fundingData.percentage}% (+${SCORE_CONFIG.SELL.FUNDING.points})`);
            }
            
            // LSR (12 pontos)
            if (lsrData && lsrData.lsrValue && lsrData.lsrValue >= SCORE_CONFIG.SELL.LSR.min) {
                score += SCORE_CONFIG.SELL.LSR.points;
                criteria.push(`LSR ${lsrData.lsrValue.toFixed(2)} ≥ ${SCORE_CONFIG.SELL.LSR.min} (+${SCORE_CONFIG.SELL.LSR.points})`);
            }
            
            // Proximidade da resistência (8 pontos)
            if (srData && srData.resistances && srData.resistances.length > 0) {
                const nearestResistance = Math.min(...srData.resistances.map(r => r.distance));
                if (nearestResistance <= SCORE_CONFIG.SELL.RESISTANCE.proximity) {
                    score += SCORE_CONFIG.SELL.RESISTANCE.points;
                    criteria.push(`Resistência próxima ${nearestResistance.toFixed(2)}% (+${SCORE_CONFIG.SELL.RESISTANCE.points})`);
                }
            }
            
            // Distância do suporte (8 pontos)
            if (srData && srData.supports && srData.supports.length > 0) {
                const nearestSupport = Math.min(...srData.supports.map(s => s.distance));
                if (nearestSupport >= SCORE_CONFIG.SELL.SUPPORT.far) {
                    score += SCORE_CONFIG.SELL.SUPPORT.points;
                    criteria.push(`Suporte distante ${nearestSupport.toFixed(2)}% (+${SCORE_CONFIG.SELL.SUPPORT.points})`);
                }
            }
            
            // ADX (6 pontos)
            if (adxData && adxData.value > SCORE_CONFIG.SELL.ADX.min) {
                score += SCORE_CONFIG.SELL.ADX.points;
                criteria.push(`ADX ${adxData.value.toFixed(1)} > ${SCORE_CONFIG.SELL.ADX.min} (+${SCORE_CONFIG.SELL.ADX.points})`);
            }
            
            // Volatilidade (8 pontos)
            if (volatilityData && volatilityData.value > SCORE_CONFIG.SELL.VOLATILITY.min) {
                score += SCORE_CONFIG.SELL.VOLATILITY.points;
                criteria.push(`Volatilidade ${volatilityData.value.toFixed(2)}% > ${SCORE_CONFIG.SELL.VOLATILITY.min}% (+${SCORE_CONFIG.SELL.VOLATILITY.points})`);
            }
            
            // Volume 3m (10 pontos) - VENDEDOR
            if (volume3mData && volume3mData.isSellerVolume && volume3mData.zScore > SCORE_CONFIG.SELL.VOLUME_3M.zScore) {
                score += SCORE_CONFIG.SELL.VOLUME_3M.points;
                criteria.push(`Volume vendedor Z:${volume3mData.zScore.toFixed(2)} > ${SCORE_CONFIG.SELL.VOLUME_3M.zScore} (+${SCORE_CONFIG.SELL.VOLUME_3M.points})`);
            }
            
            // CCI 12h (10 pontos)
            if (cci12hData && cci12hData.belowEMA) {
                score += SCORE_CONFIG.SELL.CCI12H.points;
                criteria.push(`CCI 12h abaixo EMA5 (+${SCORE_CONFIG.SELL.CCI12H.points})`);
            }
            
            // CCI 1h (8 pontos)
            if (cci1hData && cci1hData.belowEMA) {
                score += SCORE_CONFIG.SELL.CCI1H.points;
                criteria.push(`CCI 1h abaixo EMA5 (+${SCORE_CONFIG.SELL.CCI1H.points})`);
            }
            
            // Volume aumento (13 pontos)
            if (volumeIncreasePercent >= SCORE_CONFIG.SELL.VOLUME_INCREASE.threshold) {
                score += SCORE_CONFIG.SELL.VOLUME_INCREASE.points;
                criteria.push(`Volume ↑ ${volumeIncreasePercent.toFixed(1)}% ≥ ${SCORE_CONFIG.SELL.VOLUME_INCREASE.threshold}% (+${SCORE_CONFIG.SELL.VOLUME_INCREASE.points})`);
            }
            
            // EMA55 1H - Preço abaixo (7 pontos)
            if (ema55_1hData && ema55_1hData.below) {
                score += SCORE_CONFIG.SELL.EMA55_1H.points;
                criteria.push(`Preço abaixo EMA55 1h (${Math.abs(ema55_1hData.distancePercent).toFixed(2)}%) (+${SCORE_CONFIG.SELL.EMA55_1H.points})`);
            }
            
            // EMA55 15M - Fechou abaixo (7 pontos)
            if (ema55_15mData && ema55_15mData.closedBelow) {
                score += SCORE_CONFIG.SELL.EMA55_15M.points;
                criteria.push(`Fechou abaixo EMA55 15m (+${SCORE_CONFIG.SELL.EMA55_15M.points})`);
            }
        }
        
        // Garantir que score não ultrapasse 128
        score = Math.min(score, maxScore);
        
        return {
            score: score,
            maxScore: maxScore,
            percentage: Math.round((score / maxScore) * 100),
            quality: getScoreQuality(Math.round((score / maxScore) * 100)),
            criteria: criteria,
            details: {
                rsi: rsiData,
                funding: fundingData,
                lsr: lsrData,
                adx: adxData,
                cci12h: cci12hData,
                cci1h: cci1hData,
                volume3m: volume3mData,
                volatility: volatilityData,
                supportResistance: srData,
                ema55_1h: ema55_1hData,
                ema55_15m: ema55_15mData
            }
        };
        
    } catch (error) {
        console.log(`⚠️ Erro calcular score ${symbol}: ${error.message}`);
        return {
            score: 64,
            maxScore: 128,
            percentage: 50,
            quality: getScoreQuality(50),
            criteria: [],
            details: {}
        };
    }
}

// =====================================================================
// 📊 FUNÇÃO PRINCIPAL: CALCULAR CCI DIÁRIO - VERSÃO REVISADA
// =====================================================================
async function calculateCCIDaily(symbol) {
    try {
        const cacheKey = `cci_daily_${symbol}`;
        const now = Date.now();
        
        if (cciCache[cacheKey] && now - cciCache[cacheKey].timestamp < CCI_CACHE_TTL) {
            return cciCache[cacheKey].data;
        }
        
        const candles = await getCandlesCached(symbol, CCI_SETTINGS.timeframe, CCI_SETTINGS.requiredCandles);
        
        if (candles.length < CCI_SETTINGS.period + 10) {
            console.log(`⚠️ ${symbol}: Dados insuficientes para CCI diário`);
            return null;
        }
        
        const high = candles.map(c => c.high);
        const low = candles.map(c => c.low);
        const close = candles.map(c => c.close);
        
        const cciValues = CCI.calculate({
            high: high,
            low: low,
            close: close,
            period: CCI_SETTINGS.period
        });
        
        if (!cciValues || cciValues.length < CCI_SETTINGS.emaPeriod + 5) {
            return null;
        }
        
        const cciEmaValues = EMA.calculate({
            period: CCI_SETTINGS.emaPeriod,
            values: cciValues
        });
        
        const currentCCI = cciValues[cciValues.length - 1];
        const previousCCI = cciValues[cciValues.length - 2];
        const currentCCI_EMA = cciEmaValues[cciEmaValues.length - 1];
        const previousCCI_EMA = cciEmaValues[cciEmaValues.length - 2];
        
        const cciAboveEMA = currentCCI > currentCCI_EMA;
        const previousCCIAboveEMA = previousCCI > previousCCI_EMA;
        const cciBelowEMA = currentCCI < currentCCI_EMA;
        const previousCCIBelowEMA = previousCCI < previousCCI_EMA;
        
        let crossoverSignal = null;
        
        if (cciAboveEMA && !previousCCIAboveEMA) {
            crossoverSignal = {
                type: 'BULLISH',
                strength: 'CROSSOVER_UP',
                message: `CCI (${currentCCI.toFixed(2)}) ⤴️ EMA5 (${currentCCI_EMA.toFixed(2)})`,
                cciValue: currentCCI,
                cciEMA: currentCCI_EMA
            };
        }
        else if (cciBelowEMA && !previousCCIBelowEMA) {
            crossoverSignal = {
                type: 'BEARISH',
                strength: 'CROSSOVER_DOWN',
                message: `CCI (${currentCCI.toFixed(2)}) ⤵️ EMA5 (${currentCCI_EMA.toFixed(2)})`,
                cciValue: currentCCI,
                cciEMA: currentCCI_EMA
            };
        }
        
        // Análise de volume de 1h
        const hourlyCandles = await getCandlesCached(symbol, '1h', 10);
        let volumeAnalysis = null;
        
        if (hourlyCandles.length >= 3) {
            const lastHourVolume = hourlyCandles[hourlyCandles.length - 1]?.quoteVolume || 0;
            const previousHourVolume = hourlyCandles[hourlyCandles.length - 2]?.quoteVolume || 0;
            
            let volumeIncreasePercent = 0;
            if (previousHourVolume > 0) {
                volumeIncreasePercent = ((lastHourVolume - previousHourVolume) / previousHourVolume) * 100;
            }
            
            const lastHourCandle = hourlyCandles[hourlyCandles.length - 1];
            const isBullishCandle = lastHourCandle.close > lastHourCandle.open;
            const isBearishCandle = lastHourCandle.close < lastHourCandle.open;
            
            volumeAnalysis = {
                lastHourVolume: lastHourVolume,
                previousHourVolume: previousHourVolume,
                volumeIncreasePercent: volumeIncreasePercent,
                isBullishCandle: isBullishCandle,
                isBearishCandle: isBearishCandle,
                volumeIncreased: volumeIncreasePercent >= CCI_ALERT_SETTINGS.volumePercentThreshold,
                volumeSignificant: lastHourVolume > CCI_ALERT_SETTINGS.minVolumeForAlert
            };
        }
        
        let alertSignal = null;
        
        // 🟢 CONDICIONAL BULLISH
        if (crossoverSignal && crossoverSignal.type === 'BULLISH') {
            if (volumeAnalysis && volumeAnalysis.volumeSignificant) {
                if (volumeAnalysis.isBullishCandle && volumeAnalysis.volumeIncreased) {
                    // Calcular score
                    const scoreData = await calculateScore(symbol, 'BULLISH', volumeAnalysis.volumeIncreasePercent);
                    
                    // Obter número do alerta
                    const alertNumber = alertCounter.getAlertNumber(symbol);
                    
                    alertSignal = {
                        type: 'BULLISH',
                        emoji: '🟢',
                        message: '🤖IA análise de Compra',
                        description: `CCI (${currentCCI.toFixed(2)}) cruzou acima da EMA5 (${currentCCI_EMA.toFixed(2)})`,
                        volumeChange: `+${volumeAnalysis.volumeIncreasePercent.toFixed(1)}%`,
                        volumeType: 'COMPRADOR',
                        cciValue: currentCCI,
                        cciEMA: currentCCI_EMA,
                        currentVolume: volumeAnalysis.lastHourVolume,
                        previousVolume: volumeAnalysis.previousHourVolume,
                        volumePercent: volumeAnalysis.volumeIncreasePercent,
                        score: scoreData,
                        alertNumber: alertNumber,
                        timestamp: Date.now()
                    };
                }
            }
        }
        
        // 🔴 CONDICIONAL BEARISH
        if (crossoverSignal && crossoverSignal.type === 'BEARISH') {
            if (volumeAnalysis && volumeAnalysis.volumeSignificant) {
                if (volumeAnalysis.isBearishCandle && volumeAnalysis.volumeIncreased) {
                    // Calcular score
                    const scoreData = await calculateScore(symbol, 'BEARISH', volumeAnalysis.volumeIncreasePercent);
                    
                    // Obter número do alerta
                    const alertNumber = alertCounter.getAlertNumber(symbol);
                    
                    alertSignal = {
                        type: 'BEARISH',
                        emoji: '🔴',
                        message: '🤖IA análise de Venda',
                        description: `CCI (${currentCCI.toFixed(2)}) cruzou abaixo da EMA5 (${currentCCI_EMA.toFixed(2)})`,
                        volumeChange: `+${volumeAnalysis.volumeIncreasePercent.toFixed(1)}%`,
                        volumeType: 'VENDEDOR',
                        cciValue: currentCCI,
                        cciEMA: currentCCI_EMA,
                        currentVolume: volumeAnalysis.lastHourVolume,
                        previousVolume: volumeAnalysis.previousHourVolume,
                        volumePercent: volumeAnalysis.volumeIncreasePercent,
                        score: scoreData,
                        alertNumber: alertNumber,
                        timestamp: Date.now()
                    };
                }
            }
        }
        
        const result = {
            hasAlert: alertSignal !== null,
            alert: alertSignal,
            currentCCI: currentCCI,
            currentCCI_EMA: currentCCI_EMA,
            previousCCI: previousCCI,
            previousCCI_EMA: previousCCI_EMA,
            crossover: crossoverSignal,
            volumeAnalysis: volumeAnalysis,
            timestamp: Date.now()
        };
        
        cciCache[cacheKey] = { data: result, timestamp: now };
        
        if (crossoverSignal) {
            console.log(`📊 CCI ${symbol}: ${currentCCI.toFixed(2)} | EMA5: ${currentCCI_EMA.toFixed(2)} | ${crossoverSignal.type} ${crossoverSignal.type === 'BULLISH' ? '🟢' : '🔴'}`);
            if (volumeAnalysis) {
                console.log(`   Volume: ${(volumeAnalysis.lastHourVolume / 1000).toFixed(1)}k (${volumeAnalysis.volumeIncreased ? '+' : ''}${volumeAnalysis.volumeIncreasePercent.toFixed(1)}%)`);
            }
        }
        
        return result;
        
    } catch (error) {
        console.log(`⚠️ Erro ao calcular CCI diário para ${symbol}: ${error.message}`);
        return null;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA CALCULAR ENTRADA IDEAL BASEADA NA VOLATILIDADE
// =====================================================================
function calculateEntryPrice(signalType, srData, atrData, currentPrice) {
    try {
        if (!srData || !atrData) {
            return {
                entry: currentPrice,
                stopLoss: currentPrice * 0.98,
                takeProfit: currentPrice * 1.02,
                distance: 0
            };
        }

        let entryPrice = currentPrice;
        let stopLoss = currentPrice;
        let takeProfit = currentPrice;
        
        // Calcular baseado no tipo de sinal
        if (signalType === 'BULLISH') {
            // Para compra: entrada mais perto do suporte
            if (srData.supports && srData.supports.length > 0) {
                const nearestSupport = srData.supports[0];
                const distanceToSupport = Math.abs(nearestSupport.value - currentPrice);
                
                // Ajustar entrada baseado na volatilidade (ATR)
                const atrOffset = atrData.value * 0.3; // 30% do ATR
                
                // Se muito distante do suporte, usar uma entrada mais conservadora
                if (distanceToSupport > atrData.value * 2) {
                    entryPrice = currentPrice - atrOffset;
                } else {
                    // Mais próximo do suporte, mas com um pequeno buffer
                    entryPrice = Math.max(
                        nearestSupport.value + (atrData.value * 0.1), // 10% do ATR acima do suporte
                        currentPrice - (atrData.value * 0.5) // Ou 50% do ATR abaixo do preço atual
                    );
                }
                
                // Stop loss abaixo do suporte mais próximo
                if (srData.supports.length > 1) {
                    const secondSupport = srData.supports[1];
                    stopLoss = secondSupport.value - (atrData.value * 0.5);
                } else {
                    stopLoss = nearestSupport.value - (atrData.value * 1.5);
                }
                
                // Take profit baseado na resistência mais próxima
                if (srData.resistances && srData.resistances.length > 0) {
                    const nearestResistance = srData.resistances[0];
                    takeProfit = nearestResistance.value - (atrData.value * 0.3);
                } else {
                    takeProfit = entryPrice + (atrData.value * 2); // 2x ATR
                }
            }
        } else if (signalType === 'BEARISH') {
            // Para venda: entrada mais perto da resistência
            if (srData.resistances && srData.resistances.length > 0) {
                const nearestResistance = srData.resistances[0];
                const distanceToResistance = Math.abs(nearestResistance.value - currentPrice);
                
                // Ajustar entrada baseado na volatilidade (ATR)
                const atrOffset = atrData.value * 0.3; // 30% do ATR
                
                // Se muito distante da resistência, usar uma entrada mais conservadora
                if (distanceToResistance > atrData.value * 2) {
                    entryPrice = currentPrice + atrOffset;
                } else {
                    // Mais próximo da resistência, mas com um pequeno buffer
                    entryPrice = Math.min(
                        nearestResistance.value - (atrData.value * 0.1), // 10% do ATR abaixo da resistência
                        currentPrice + (atrData.value * 0.5) // Ou 50% do ATR acima do preço atual
                    );
                }
                
                // Stop loss acima da resistência mais próxima
                if (srData.resistances.length > 1) {
                    const secondResistance = srData.resistances[1];
                    stopLoss = secondResistance.value + (atrData.value * 0.5);
                } else {
                    stopLoss = nearestResistance.value + (atrData.value * 1.5);
                }
                
                // Take profit baseado no suporte mais próximo
                if (srData.supports && srData.supports.length > 0) {
                    const nearestSupport = srData.supports[0];
                    takeProfit = nearestSupport.value + (atrData.value * 0.3);
                } else {
                    takeProfit = entryPrice - (atrData.value * 2); // 2x ATR
                }
            }
        }
        
        // Garantir que os valores são válidos
        entryPrice = Math.max(entryPrice, 0.000001);
        stopLoss = Math.max(stopLoss, 0.000001);
        takeProfit = Math.max(takeProfit, 0.000001);
        
        const distancePercent = Math.abs((entryPrice - currentPrice) / currentPrice * 100);
        
        return {
            entry: entryPrice,
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            distance: distancePercent,
            stopLossDistance: Math.abs((stopLoss - entryPrice) / entryPrice * 100),
            takeProfitDistance: Math.abs((takeProfit - entryPrice) / entryPrice * 100)
        };
    } catch (error) {
        console.log(`⚠️ Erro calcular entrada: ${error.message}`);
        return {
            entry: currentPrice,
            stopLoss: currentPrice * 0.98,
            takeProfit: currentPrice * 1.02,
            distance: 0
        };
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA VERIFICAR COOLDOWN DE ALERTA CCI
// =====================================================================
function checkCCIAlertCooldown(symbol) {
    try {
        const now = Date.now();
        
        if (cciAlertCooldownMap.has(symbol)) {
            const lastAlertTime = cciAlertCooldownMap.get(symbol);
            const minutesSinceLastAlert = (now - lastAlertTime) / (1000 * 60);
            
            if (minutesSinceLastAlert < 15) {
                const remainingMinutes = Math.ceil(15 - minutesSinceLastAlert);
                console.log(`   ${symbol}: ⏳ Cooldown ativo (${remainingMinutes} min restantes)`);
                return false;
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ Erro em checkCCIAlertCooldown:', error.message);
        return true;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA ENVIAR ALERTA CCI - VERSÃO COMPLETA COM NOVAS INFORMAÇÕES
// =====================================================================
async function sendCCIAlert(symbol, alertData) {
    try {
        const now = getBrazilianDateTime();
        
        // Buscar TODOS os dados necessários para a mensagem
        const allData = await getAllMarketData(symbol);
        
        const currentPrice = allData.marketData ? allData.marketData.lastPrice : 0;
        
        // Calcular entrada ideal
        const entryData = calculateEntryPrice(
            alertData.type,
            allData.sr,
            allData.atr,
            currentPrice
        );
        
        // Formatar suportes e resistências
        let supportsText = 'Suportes: N/A';
        let resistancesText = 'Resistências: N/A';
        
        if (allData.sr && allData.sr.supports && allData.sr.supports.length > 0) {
            supportsText = 'Suportes:\n';
            allData.sr.supports.forEach((s, i) => {
                if (i < 3) { // Mostrar até 3 suportes
                    supportsText += `S${i+1}: $${s.value.toFixed(6)} (${s.distance.toFixed(2)}%)\n`;
                }
            });
        }
        
        if (allData.sr && allData.sr.resistances && allData.sr.resistances.length > 0) {
            resistancesText = 'Resistências:\n';
            allData.sr.resistances.forEach((r, i) => {
                if (i < 3) { // Mostrar até 3 resistências
                    resistancesText += `R${i+1}: $${r.value.toFixed(6)} (${r.distance.toFixed(2)}%)\n`;
                }
            });
        }
        
        // Formatar dados principais com os dados reais
        let rsiText = 'RSI 1h: N/A';
        let fundingText = 'Funding: N/A';
        let lsrText = 'LSR: N/A';
        let volume3mText = 'Volume 3m: N/A';
        let cci1hText = 'CCI 1h: N/A';
        let atrText = 'ATR: N/A';
        
        // Usar os dados buscados
        if (allData.rsi && allData.rsi.value) {
            rsiText = `RSI 1h: ${allData.rsi.value.toFixed(1)} ${allData.rsi.emoji || '⚪'}`;
        }
        
        if (allData.funding && allData.funding.percentage) {
            fundingText = `Funding: ${allData.funding.emoji || '⚪'} ${allData.funding.percentage}%`;
        }
        
        if (allData.lsr && allData.lsr.lsrValue !== undefined) {
            const lsr = allData.lsr;
            const changeSign = lsr.isRising ? '+' : '-';
            lsrText = `LSR: ${lsr.lsrValue?.toFixed(3) || 'N/A'} ${lsr.isRising ? '⬆️' : '⬇️'} (${changeSign}${Math.abs(parseFloat(lsr.percentChange || 0)).toFixed(2)}%)`;
        }
        
        if (allData.volume3m && allData.volume3m.lastVolume !== undefined) {
            const vol = allData.volume3m;
            const volType = vol.isBuyerVolume ? '🟢 Comprador' : (vol.isSellerVolume ? '🔴 Vendedor' : '⚪ Neutro');
            volume3mText = `Volume 3m: ${(vol.lastVolume / 1000).toFixed(1)}k (Z:${vol.zScore?.toFixed(2) || '0.00'}) ${volType}`;
        }
        
        if (allData.cci1h && allData.cci1h.cciValue !== undefined) {
            const cci1h = allData.cci1h;
            cci1hText = `CCI 1h: ${cci1h.cciValue.toFixed(2)} ${cci1h.aboveEMA ? '🟢' : (cci1h.belowEMA ? '🔴' : '⚪')}`;
        }
        
        if (allData.atr && allData.atr.value) {
            atrText = `ATR: ${allData.atr.value.toFixed(6)} (${allData.atr.percent.toFixed(2)}%)`;
        }
        
        // Criar mensagem com formatação
        const message = 
`${alertData.emoji} ${alertData.message} - ${symbol}
${now.date} ${now.time} Alerta ${alertData.alertNumber}

📊 **SCORE: ${alertData.score.percentage}%** ${alertData.score.quality.emoji}

💰 **PREÇO ATUAL:** $${currentPrice.toFixed(6)}

🎯 **NÍVEIS DE SUPORTE E RESISTÊNCIA:**
${supportsText}
${resistancesText}

⚙️ **PARÂMETROS TÉCNICOS:**
• ${rsiText}
• ${fundingText}
• ${lsrText}
• ${volume3mText}
• ${cci1hText}
• ${atrText}
${alertData.volumeType === 'VENDEDOR' ? '🔴' : '🟢'} **Volume ${alertData.volumeType.toLowerCase()}** aumentando +${alertData.volumePercent.toFixed(1)}%.

 **SETUP Titanium IA:**

${alertData.type === 'BULLISH' ? '🟢 Operação de COMPRA' : '🔴Operação de VENDA'} 
**ENTRADA SUGERIDA:** $${entryData.entry.toFixed(6)}
${alertData.type === 'BULLISH' ? 
  `• Entrada próxima do suporte (${entryData.distance.toFixed(2)}% do preço atual)` :
  `• Entrada próxima da resistência (${entryData.distance.toFixed(2)}% do preço atual)`}
**STOP :** $${entryData.stopLoss.toFixed(6)}
• Stop%: ${entryData.stopLossDistance.toFixed(2)}%
**TAKE:** $${entryData.takeProfit.toFixed(6)}
• Alvo: ${entryData.takeProfitDistance.toFixed(2)}%

✨ **Titanium Matrix by @J4Rviz ** ✨`;

        console.log('📤 Tentando enviar mensagem para Telegram...');
        
        // Usar Markdown
        const sent = await sendTelegramAlertMarkdown(message);
        
        if (sent) {
            console.log(`\n${alertData.emoji} ALERTA ENVIADO: ${symbol}`);
            console.log(`   Tipo: ${alertData.type}`);
            console.log(`   Alerta: ${alertData.alertNumber}`);
            console.log(`   Score: ${alertData.score.percentage}% ${alertData.score.quality.emoji} ${alertData.score.quality.text}`);
            console.log(`   Preço: $${currentPrice.toFixed(6)}`);
            console.log(`   Entrada sugerida: $${entryData.entry.toFixed(6)}`);
            console.log(`   Stop Loss ATR: $${entryData.stopLoss.toFixed(6)} (${entryData.stopLossDistance.toFixed(2)}%)`);
            console.log(`   Take Profit: $${entryData.takeProfit.toFixed(6)} (${entryData.takeProfitDistance.toFixed(2)}%)`);
            
            // Log dos dados que estão sendo enviados
            console.log(`\n📊 DADOS ENVIADOS:`);
            console.log(`   ${rsiText}`);
            console.log(`   ${fundingText}`);
            console.log(`   ${lsrText}`);
            console.log(`   ${volume3mText}`);
            console.log(`   ${cci1hText}`);
            console.log(`   ${atrText}`);
        } else {
            console.log(`❌ Falha ao enviar alerta para ${symbol}`);
        }
        
        return sent;
        
    } catch (error) {
        console.error(`❌ Erro enviando alerta CCI ${symbol}:`, error.message);
        
        // Fallback simples
        try {
            const now = getBrazilianDateTime();
            const marketData = await getMarketData(symbol);
            const currentPrice = marketData ? marketData.lastPrice : 0;
            
            const fallbackMessage = 
`${alertData.emoji} ${alertData.message} - ${symbol}
${now.date} ${now.time} Alerta ${alertData.alertNumber}
✨ SCORE: ${alertData.score.percentage}%
Preço: $${currentPrice.toFixed(6)}
CCI: ${alertData.cciValue.toFixed(2)} | EMA5: ${alertData.cciEMA.toFixed(2)}
Volume 1H: ${(alertData.currentVolume / 1000).toFixed(1)}k (+${alertData.volumePercent.toFixed(1)}%)

✨ Titanium Matrix ✨`;
            
            return await sendTelegramAlertMarkdown(fallbackMessage);
        } catch (fallbackError) {
            console.error('❌ Fallback também falhou:', fallbackError.message);
            return false;
        }
    }
}

// =====================================================================
// 🆕 FUNÇÃO AUXILIAR PARA ENVIAR COM MARKDOWN
// =====================================================================
async function sendTelegramAlertMarkdown(message) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }

        console.log('✅ Mensagem enviada para Telegram (Markdown)');
        logToFile(`📤 Alerta CCI enviado para Telegram (Markdown)`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao enviar alerta Markdown:', error.message);
        return false;
    }
}

// =====================================================================
// 🆕 FUNÇÃO PARA BUSCAR TODOS OS PARES FUTURES
// =====================================================================
async function fetchAllFuturesSymbols() {
    try {
        console.log('🔍 Buscando TODOS os pares Futures da Binance...');
        
        const response = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const exchangeInfo = await response.json();
        
        if (!exchangeInfo || !exchangeInfo.symbols) {
            console.log('❌ Não foi possível obter informações da exchange');
            return getDefaultSymbols();
        }
        
        const usdtSymbols = exchangeInfo.symbols.filter(symbol => {
            const isUSDT = symbol.quoteAsset === 'USDT';
            const isTrading = symbol.status === 'TRADING';
            const isPerpetual = symbol.contractType === 'PERPETUAL';
            
            const excludedTerms = ['BULL', 'BEAR', 'UP', 'DOWN'];
            const hasExcludedTerm = excludedTerms.some(term => 
                symbol.symbol.includes(term)
            );
            
            return isUSDT && isTrading && isPerpetual && !hasExcludedTerm;
        });
        
        const symbols = usdtSymbols.map(s => s.symbol);
        
        console.log(`✅ ${symbols.length} pares USDT Perpetual encontrados`);
        
        return symbols;
        
    } catch (error) {
        console.log('❌ Erro ao buscar símbolos:', error.message);
        return getDefaultSymbols();
    }
}

function getDefaultSymbols() {
    return [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 
        'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'TRXUSDT',
        'SHIBUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT', 'ETCUSDT',
        'FILUSDT', 'APTUSDT', 'ARBUSDT', 'NEARUSDT', 'VETUSDT', 'OPUSDT'
    ];
}

// =====================================================================
// 🆕 MONITOR PARA ALERTAS CCI DIÁRIO
// =====================================================================
class CCIDailyAlertMonitor {
    constructor() {
        try {
            this.symbols = [];
            this.stats = {
                totalChecks: 0,
                crossoversDetected: 0,
                alertsSent: 0,
                startTime: Date.now()
            };
            console.log('✅ CCIDailyAlertMonitor inicializado');
        } catch (error) {
            console.error('❌ Erro ao inicializar CCIDailyAlertMonitor:', error.message);
            this.symbols = [];
            this.stats = { totalChecks: 0, startTime: Date.now() };
        }
    }

    async initializeSymbols() {
        try {
            this.symbols = await fetchAllFuturesSymbols();
            console.log(`📊 ${this.symbols.length} pares configurados para monitoramento CCI diário`);
            return this.symbols;
        } catch (error) {
            console.error('Erro inicializando símbolos CCI:', error.message);
            this.symbols = getDefaultSymbols();
            return this.symbols;
        }
    }

    async monitorCCICrossovers() {
        try {
            console.log(`\n🔍 Monitorando cruzamentos CCI diário em ${this.symbols.length} pares...`);
            
            // Verificar se precisa resetar contadores (21h)
            alertCounter.checkAndReset();
            
            let alertsFound = 0;
            const batchSize = 5;
            
            for (let i = 0; i < this.symbols.length; i += batchSize) {
                const batch = this.symbols.slice(i, i + batchSize);
                
                const batchPromises = batch.map(symbol => 
                    this.checkSymbolForCCIAlert(symbol)
                );
                
                const batchResults = await Promise.allSettled(batchPromises);
                alertsFound += batchResults.filter(r => r.status === 'fulfilled' && r.value).length;
                
                if (i + batchSize < this.symbols.length) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            
            if (alertsFound > 0) {
                console.log(`✅ ${alertsFound} alertas CCI encontrados nesta verificação`);
            } else {
                console.log(`⏭️  Nenhum cruzamento CCI detectado`);
            }
            
            this.cleanupOldHistory();
            
        } catch (error) {
            console.error(`Erro no monitor CCI: ${error.message}`);
        }
    }

    async checkSymbolForCCIAlert(symbol) {
        try {
            this.stats.totalChecks++;
            
            if (!checkCCIAlertCooldown(symbol)) {
                return false;
            }
            
            const cciData = await calculateCCIDaily(symbol);
            
            if (!cciData || !cciData.hasAlert || !cciData.alert) {
                return false;
            }
            
            this.stats.crossoversDetected++;
            
            console.log(`\n🎯 ${symbol}: ${cciData.alert.type} DETECTADO!`);
            console.log(`   Alerta: ${cciData.alert.alertNumber}`);
            console.log(`   Score: ${cciData.alert.score.percentage}% ${cciData.alert.score.quality.emoji} ${cciData.alert.score.quality.text}`);
            console.log(`   CCI: ${cciData.alert.cciValue.toFixed(2)} | EMA5: ${cciData.alert.cciEMA.toFixed(2)}`);
            console.log(`   Volume: ${(cciData.alert.currentVolume / 1000).toFixed(1)}k (+${cciData.alert.volumePercent.toFixed(1)}%)`);
            
            const sent = await sendCCIAlert(symbol, cciData.alert);
            
            if (sent) {
                this.stats.alertsSent++;
                cciAlertCooldownMap.set(symbol, Date.now());
                
                await new Promise(r => setTimeout(r, 1000));
            }
            
            return sent;
            
        } catch (error) {
            console.log(`⚠️ Erro ${symbol}: ${error.message}`);
            return false;
        }
    }

    cleanupOldHistory() {
        try {
            const now = Date.now();
            const oneHourAgo = now - 3600000;
            
            for (const [symbol, timestamp] of cciAlertCooldownMap.entries()) {
                if (timestamp < oneHourAgo) {
                    cciAlertCooldownMap.delete(symbol);
                }
            }
        } catch (error) {
            console.error('❌ Erro em cleanupOldHistory:', error.message);
        }
    }

    logStats() {
        try {
            const uptime = Date.now() - this.stats.startTime;
            const hours = Math.floor(uptime / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            
            const successRate = this.stats.totalChecks > 0 ? 
                ((this.stats.crossoversDetected / this.stats.totalChecks) * 100).toFixed(2) : 0;
            
            console.log(`\n📊 ESTATÍSTICAS CCI (${hours}h${minutes}m):`);
            console.log(`   • Pares verificados: ${this.stats.totalChecks}`);
            console.log(`   • Cruzamentos detectados: ${this.stats.crossoversDetected}`);
            console.log(`   • Alertas enviados: ${this.stats.alertsSent}`);
            console.log(`   • Taxa de detecção: ${successRate}%`);
            console.log(`   • Em cooldown: ${cciAlertCooldownMap.size} pares`);
        } catch (error) {
            console.error('❌ Erro em logStats:', error.message);
        }
    }
}

// =====================================================================
// 🔄 LIMPEZA DE CACHE
// =====================================================================
function cleanupCaches() {
    try {
        const now = Date.now();

        Object.keys(candleCache).forEach(key => {
            if (now - candleCache[key].timestamp > MAX_CACHE_AGE) {
                delete candleCache[key];
            }
        });

        Object.keys(marketDataCache).forEach(key => {
            if (now - marketDataCache[key].timestamp > 600000) {
                delete marketDataCache[key];
            }
        });

        Object.keys(lsrCache).forEach(key => {
            if (now - lsrCache[key].timestamp > 300000) {
                delete lsrCache[key];
            }
        });

        Object.keys(fundingCache).forEach(key => {
            if (now - fundingCache[key].timestamp > 300000) {
                delete fundingCache[key];
            }
        });

        Object.keys(cciCache).forEach(key => {
            if (now - cciCache[key].timestamp > 300000) {
                delete cciCache[key];
            }
        });
        
        Object.keys(supportResistanceCache).forEach(key => {
            if (now - supportResistanceCache[key].timestamp > 300000) {
                delete supportResistanceCache[key];
            }
        });
        
        Object.keys(cci12hCache).forEach(key => {
            if (now - cci12hCache[key].timestamp > 300000) {
                delete cci12hCache[key];
            }
        });
        
        Object.keys(cci1hCache).forEach(key => {
            if (now - cci1hCache[key].timestamp > 300000) {
                delete cci1hCache[key];
            }
        });
        
        Object.keys(adxCache).forEach(key => {
            if (now - adxCache[key].timestamp > 300000) {
                delete adxCache[key];
            }
        });
        
        Object.keys(volume3mCache).forEach(key => {
            if (now - volume3mCache[key].timestamp > 300000) {
                delete volume3mCache[key];
            }
        });
        
        Object.keys(volatilityCache).forEach(key => {
            if (now - volatilityCache[key].timestamp > 300000) {
                delete volatilityCache[key];
            }
        });
        
        Object.keys(ema55Cache).forEach(key => {
            if (now - ema55Cache[key].timestamp > 300000) {
                delete ema55Cache[key];
            }
        });
        
        Object.keys(ema55_15mCache).forEach(key => {
            if (now - ema55_15mCache[key].timestamp > 300000) {
                delete ema55_15mCache[key];
            }
        });
        
        Object.keys(atrCache).forEach(key => {
            if (now - atrCache[key].timestamp > 300000) {
                delete atrCache[key];
            }
        });
        
        const hourAgo = Date.now() - (60 * 60 * 1000);
        for (const [symbol, timestamp] of cciAlertCooldownMap.entries()) {
            if (timestamp < hourAgo) {
                cciAlertCooldownMap.delete(symbol);
            }
        }
    } catch (error) {
        console.error('❌ Erro em cleanupCaches:', error.message);
    }
}

// =====================================================================
// 🚀 LOOP PRINCIPAL
// =====================================================================
async function mainCCIMonitorLoop() {
    const cciAlertMonitor = new CCIDailyAlertMonitor();

    await cciAlertMonitor.initializeSymbols();

    console.log(`\n🚨 SISTEMA DE ALERTA CCI DIÁRIO COMPLETO`);
    console.log('='.repeat(80));
    console.log(`⚙️  FUNCIONALIDADES ADICIONADAS:`);
    console.log(`   • Stop Loss ATR adaptativo de volatilidade`);
    console.log(`   • Dica de entrada próxima ao suporte/resistência`);
    console.log(`   • 2 suportes abaixo e 2 resistências acima`);
    console.log(`   • Cálculo baseado na estrutura e volatilidade`);
    console.log('='.repeat(80));
    console.log(`📊 FORMATO DO ALERTA:`);
    console.log(`   🟢 🤖IA análise de Compra - BTCUSDT`);
    console.log(`   🔴 🤖IA análise de Venda - ETHUSDT`);
    console.log(`   Com todos os parâmetros técnicos e setup de operação`);
    console.log('='.repeat(80));
    console.log(`🤖 Iniciando monitoramento...\n`);

    let consecutiveErrors = 0;
    let lastReportTime = Date.now();

    while (true) {
        try {
            const startTime = Date.now();
            
            await cciAlertMonitor.monitorCCICrossovers();
            
            const endTime = Date.now();
            const processingTime = (endTime - startTime) / 1000;
            
            console.log(`\n✅ Verificação concluída em ${processingTime.toFixed(1)}s`);
            
            cleanupCaches();
            consecutiveErrors = 0;

            if (Date.now() - lastReportTime >= 300000) {
                cciAlertMonitor.logStats();
                lastReportTime = Date.now();
            }

            const waitTime = CCI_ALERT_SETTINGS.alertCheckInterval;
            console.log(`⏱️  Próxima verificação em ${waitTime/1000}s...\n${'─'.repeat(80)}`);
            await new Promise(r => setTimeout(r, waitTime));

        } catch (error) {
            consecutiveErrors++;
            console.error(`\n❌ ERRO NO LOOP (${consecutiveErrors}):`, error.message);

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
// 🛡️ HANDLERS DE ERRO GLOBAL
// =====================================================================
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error.message);
    logToFile(`❌ Unhandled Rejection: ${error.message}`);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    logToFile(`❌ Uncaught Exception: ${error.message}`);
    setTimeout(() => {
        mainCCIMonitorLoop();
    }, 60000);
});

// =====================================================================
// ▶️ INICIALIZAÇÃO
// =====================================================================
async function startCCIBot() {
    try {
        if (!fs.existsSync(LOG_DIR)) {
            try {
                fs.mkdirSync(LOG_DIR, { recursive: true });
            } catch (error) {
                console.error('❌ Erro ao criar diretório de logs:', error.message);
            }
        }

        console.log('\n' + '='.repeat(80));
        console.log('🚀 CCI ALERT SYSTEM COMPLETO COM SUPORTE/RESISTÊNCIA');
        console.log('='.repeat(80));
        
        console.log('🔍 Iniciando sistema...');
        console.log('📊 Monitorando TODOS os pares Futures USDT da Binance');
        console.log('🎯 Sistema completo com suporte/resistência e ATR');
        console.log('⚡ Entradas calculadas baseadas em volatilidade');
        console.log('='.repeat(80) + '\n');

        await mainCCIMonitorLoop();

    } catch (error) {
        console.error(`\n🚨 ERRO CRÍTICO: ${error.message}`);
        console.log('🔄 Reiniciando em 30 segundos...');
        await new Promise(r => setTimeout(r, 30000));
        await startCCIBot();
    }
}

// =====================================================================
// 🚀 INICIAR O BOT
// =====================================================================
startCCIBot();
