const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR, ADX } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A';
const TELEGRAM_CHAT_ID = '-1001990889297';
// Configurações do estudo
const FRACTAL_BARS = 3;
const N = 2;

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
const VOLATILITY_THRESHOLD = 0.6;

// === FILTRO DO LSR RATIO ===
const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;

// === FILTRO DE FUNDING RATE ===
const FUNDING_BUY_MAX = -0.001;
const FUNDING_SELL_MIN = 0.001;

// === COOLDOWN DIFERENCIADO ===
const COOLDOWN_SETTINGS = {
    sameDirection: 30 * 60 * 1000,     // 30 minutos para mesma direção
    oppositeDirection: 5 * 60 * 1000,  // 5 minutos para direção oposta
    useDifferentiated: true
};

// === ALERTAS DE QUASE SINAL ===
const DEBUG_SETTINGS = {
    enableNearSignals: true,
    minScore: 60,
    maxScore: 69,
    sendTelegram: false,  // Mudar para true se quiser receber no Telegram
    logOnly: true         // Apenas loga no console/arquivo
};

// === QUALITY SCORE AJUSTADO ===
const QUALITY_THRESHOLD = 70;
const QUALITY_WEIGHTS = {
    volume: 25,           // Reduzido de 30 para 25
    oi: 20,
    volatility: 15,
    lsr: 15,
    rsi: 10,
    emaAlignment: 10,
    rsiTrigger: 20,       // Aumentado de 10 para 20 (é o trigger principal)
    adx: 10
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

// Configuração do RSI Trigger
const RSI_TRIGGER_SETTINGS = {
    period: 14,
    timeframe: '15m',
    oversoldZone: 23,
    overboughtZone: 75,
    memoryBars: 5,
    triggerBars: 3
};

const ADX_SETTINGS = {
    period: 14,
    timeframe: '15m',
    strongTrendThreshold: 25
};

const ADX_1H_SETTINGS = {
    period: 14,
    timeframe: '1h',
    strongTrendThreshold: 25
};

const DECIMALS_BY_PRICE = {
    HIGH: 2,
    MEDIUM: 3,
    LOW: 4,
    VERY_LOW: 6,
    MICRO: 8
};

// Memória para RSI por símbolo
const rsiMemory = {};

// Função para inicializar memória do RSI
function initRSIMemory(symbol) {
    if (!rsiMemory[symbol]) {
        rsiMemory[symbol] = {
            visitedOversold: false,
            visitedOverbought: false,
            oversoldVisitTime: 0,
            overboughtVisitTime: 0,
            lastOversoldBar: 0,
            lastOverboughtBar: 0,
            history: []
        };
    }
}

// Função para atualizar memória do RSI
async function updateRSIMemory(symbol) {
    try {
        initRSIMemory(symbol);
        
        const candles = await getCandlesCached(symbol, RSI_TRIGGER_SETTINGS.timeframe, RSI_TRIGGER_SETTINGS.period + RSI_TRIGGER_SETTINGS.memoryBars + 10);
        
        if (candles.length < RSI_TRIGGER_SETTINGS.period + 1) {
            return null;
        }
        
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({
            values: closes,
            period: RSI_TRIGGER_SETTINGS.period
        });
        
        if (!rsiValues || rsiValues.length === 0) {
            return null;
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        const previousRSI = rsiValues.length > 1 ? rsiValues[rsiValues.length - 2] : currentRSI;
        
        let visitedOversold = rsiMemory[symbol].visitedOversold;
        let visitedOverbought = rsiMemory[symbol].visitedOverbought;
        let oversoldVisitTime = rsiMemory[symbol].oversoldVisitTime;
        let overboughtVisitTime = rsiMemory[symbol].overboughtVisitTime;
        
        // Verificar zona de oversold (23)
        if (currentRSI <= RSI_TRIGGER_SETTINGS.oversoldZone || previousRSI <= RSI_TRIGGER_SETTINGS.oversoldZone) {
            if (!visitedOversold) {
                visitedOversold = true;
                oversoldVisitTime = Date.now();
                rsiMemory[symbol].lastOversoldBar = candles.length - 1;
                console.log(`📊 ${symbol}: RSI visitou zona de oversold (${currentRSI.toFixed(2)})`);
                logToFile(`${symbol}: RSI visitou zona de oversold (${currentRSI.toFixed(2)})`);
            }
        }
        
        // Verificar zona de overbought (75)
        if (currentRSI >= RSI_TRIGGER_SETTINGS.overboughtZone || previousRSI >= RSI_TRIGGER_SETTINGS.overboughtZone) {
            if (!visitedOverbought) {
                visitedOverbought = true;
                overboughtVisitTime = Date.now();
                rsiMemory[symbol].lastOverboughtBar = candles.length - 1;
                console.log(`📊 ${symbol}: RSI visitou zona de overbought (${currentRSI.toFixed(2)})`);
                logToFile(`${symbol}: RSI visitou zona de overbought (${currentRSI.toFixed(2)})`);
            }
        }
        
        rsiMemory[symbol] = {
            visitedOversold: visitedOversold,
            visitedOverbought: visitedOverbought,
            oversoldVisitTime: oversoldVisitTime,
            overboughtVisitTime: overboughtVisitTime,
            lastOversoldBar: rsiMemory[symbol].lastOversoldBar,
            lastOverboughtBar: rsiMemory[symbol].lastOverboughtBar,
            currentRSI: currentRSI,
            previousRSI: previousRSI,
            history: [...(rsiMemory[symbol].history || []), {
                timestamp: Date.now(),
                rsi: currentRSI,
                barIndex: candles.length - 1
            }].slice(-20)
        };
        
        return rsiMemory[symbol];
        
    } catch (error) {
        logToFile(`⚠️ Erro ao atualizar memória RSI(${symbol}): ${error.message}`);
        return null;
    }
}

// Função para verificar trigger do RSI
async function checkRSITrigger(symbol, isBullishSignal) {
    try {
        const memory = await updateRSIMemory(symbol);
        
        if (!memory) {
            return {
                isValid: false,
                message: `RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ⚪ Dados insuficientes`,
                rsiValue: "N/A",
                visitedZone: false,
                barsSinceVisit: 0
            };
        }
        
        const currentBar = (await getCandlesCached(symbol, RSI_TRIGGER_SETTINGS.timeframe, 1)).length - 1;
        
        if (isBullishSignal) {
            if (memory.visitedOversold) {
                const barsSinceVisit = currentBar - memory.lastOversoldBar;
                const isValid = barsSinceVisit <= RSI_TRIGGER_SETTINGS.triggerBars && barsSinceVisit > 0;
                
                return {
                    isValid: isValid,
                    message: isValid ? 
                        `✅ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (visitou oversold ${barsSinceVisit} bar(s) atrás)` :
                        `❌ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (visitou oversold há muito tempo: ${barsSinceVisit} bars)`,
                    rsiValue: memory.currentRSI.toFixed(2),
                    visitedZone: memory.visitedOversold,
                    barsSinceVisit: barsSinceVisit,
                    rawRSI: memory.currentRSI,
                    zone: 'oversold',
                    zoneValue: RSI_TRIGGER_SETTINGS.oversoldZone
                };
            } else {
                return {
                    isValid: false,
                    message: `❌ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (não visitou zona de oversold ${RSI_TRIGGER_SETTINGS.oversoldZone})`,
                    rsiValue: memory.currentRSI.toFixed(2),
                    visitedZone: false,
                    barsSinceVisit: 0,
                    rawRSI: memory.currentRSI,
                    zone: 'oversold',
                    zoneValue: RSI_TRIGGER_SETTINGS.oversoldZone
                };
            }
        } else {
            if (memory.visitedOverbought) {
                const barsSinceVisit = currentBar - memory.lastOverboughtBar;
                const isValid = barsSinceVisit <= RSI_TRIGGER_SETTINGS.triggerBars && barsSinceVisit > 0;
                
                return {
                    isValid: isValid,
                    message: isValid ? 
                        `✅ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (visitou overbought ${barsSinceVisit} bar(s) atrás)` :
                        `❌ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (visitou overbought há muito tempo: ${barsSinceVisit} bars)`,
                    rsiValue: memory.currentRSI.toFixed(2),
                    visitedZone: memory.visitedOverbought,
                    barsSinceVisit: barsSinceVisit,
                    rawRSI: memory.currentRSI,
                    zone: 'overbought',
                    zoneValue: RSI_TRIGGER_SETTINGS.overboughtZone
                };
            } else {
                return {
                    isValid: false,
                    message: `❌ RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ${memory.currentRSI.toFixed(2)} (não visitou zona de overbought ${RSI_TRIGGER_SETTINGS.overboughtZone})`,
                    rsiValue: memory.currentRSI.toFixed(2),
                    visitedZone: false,
                    barsSinceVisit: 0,
                    rawRSI: memory.currentRSI,
                    zone: 'overbought',
                    zoneValue: RSI_TRIGGER_SETTINGS.overboughtZone
                };
            }
        }
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar trigger RSI(${symbol}): ${error.message}`);
        return {
            isValid: false,
            message: `RSI ${RSI_TRIGGER_SETTINGS.timeframe}: ⚪ Erro na verificação`,
            rsiValue: "N/A",
            visitedZone: false,
            barsSinceVisit: 0,
            rawRSI: null
        };
    }
}

// NOVA: Função para calcular threshold de volume adaptativo
async function calculateAdaptiveVolumeThreshold(symbol) {
    try {
        if (!VOLUME_SETTINGS.useAdaptive) {
            return VOLUME_SETTINGS.baseThreshold;
        }
        
        const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
        
        if (!volatilityCheck.rawVolatility) {
            return VOLUME_SETTINGS.baseThreshold;
        }
        
        // Fórmula: threshold base + (volatilidade * multiplicador)
        let dynamicThreshold = VOLUME_SETTINGS.baseThreshold + 
                              (volatilityCheck.rawVolatility * VOLUME_SETTINGS.volatilityMultiplier);
        
        // Limitar entre min e max
        dynamicThreshold = Math.max(VOLUME_SETTINGS.minThreshold, 
                                   Math.min(VOLUME_SETTINGS.maxThreshold, dynamicThreshold));
        
        console.log(`📊 ${symbol}: Threshold volume adaptativo = ${dynamicThreshold.toFixed(2)}x (vol: ${volatilityCheck.rawVolatility.toFixed(2)}%)`);
        
        return dynamicThreshold;
        
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular threshold volume adaptativo(${symbol}): ${error.message}`);
        return VOLUME_SETTINGS.baseThreshold;
    }
}

// MODIFICADA: Função de confirmação de volume com threshold adaptativo
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

// NOVA: Função para verificar cooldown diferenciado
function checkCooldown(symbol, isBullish, now) {
    if (!COOLDOWN_SETTINGS.useDifferentiated) {
        // Usar cooldown padrão
        if (isBullish) {
            return now - alertsCooldown[symbol].lastBuyConfirmation > COOLDOWN;
        } else {
            return now - alertsCooldown[symbol].lastSellConfirmation > COOLDOWN;
        }
    }
    
    // Cooldown diferenciado
    if (isBullish) {
        const lastBuyTime = alertsCooldown[symbol].lastBuyConfirmation || 0;
        const lastSellTime = alertsCooldown[symbol].lastSellConfirmation || 0;
        
        // Para compra: 30min desde última compra, apenas 5min desde última venda
        const timeSinceLastBuy = now - lastBuyTime;
        const timeSinceLastSell = now - lastSellTime;
        
        return timeSinceLastBuy > COOLDOWN_SETTINGS.sameDirection && 
               timeSinceLastSell > COOLDOWN_SETTINGS.oppositeDirection;
    } else {
        const lastBuyTime = alertsCooldown[symbol].lastBuyConfirmation || 0;
        const lastSellTime = alertsCooldown[symbol].lastSellConfirmation || 0;
        
        // Para venda: 30min desde última venda, apenas 5min desde última compra
        const timeSinceLastBuy = now - lastBuyTime;
        const timeSinceLastSell = now - lastSellTime;
        
        return timeSinceLastSell > COOLDOWN_SETTINGS.sameDirection && 
               timeSinceLastBuy > COOLDOWN_SETTINGS.oppositeDirection;
    }
}

// NOVA: Função para atualizar cooldown
function updateCooldown(symbol, isBullish, now) {
    if (isBullish) {
        alertsCooldown[symbol].lastBuyConfirmation = now;
    } else {
        alertsCooldown[symbol].lastSellConfirmation = now;
    }
}

// NOVA: Função para enviar alerta de quase sinal
async function sendNearSignalAlert(signalData) {
    try {
        const brDateTime = getBrazilianDateTime();
        
        let message = `⚡ <b>QUASE SINAL - OBSERVE</b>\n`;
        message += `<b>Horário:</b> ${brDateTime.date} - ${brDateTime.time}\n`;
        message += `<b>Ativo:</b> ${signalData.symbol}\n`;
        message += `<b>Direção:</b> ${signalData.isBullish ? 'COMPRA' : 'VENDA'}\n`;
        message += `<b>Preço:</b> $${signalData.priceFormatted}\n`;
        message += `<b>Score:</b> ${signalData.qualityScore.score}/100 (${signalData.qualityScore.grade})\n`;
        message += `<b>Motivo:</b> ${signalData.failureReasons.join(', ')}\n`;
        message += `\n<b>Filtros que passaram:</b>\n`;
        
        if (signalData.rsiTrigger.isValid) message += `✅ ${signalData.rsiTrigger.message}\n`;
        if (signalData.volumeCheck.isConfirmed) message += `✅ Volume: ${signalData.volumeCheck.volumeData.ratio}x\n`;
        if (signalData.oiCheck.isValid) message += `✅ OI: ${signalData.oiCheck.trend}\n`;
        if (signalData.volatilityCheck.isValid) message += `✅ Vol: ${signalData.volatilityCheck.volatility}%\n`;
        if (signalData.lsrCheck.isValid) message += `✅ LSR: ${signalData.lsrCheck.lsrRatio}\n`;
        
        message += `\n<b>Filtros que falharam:</b>\n`;
        signalData.failedChecks.forEach(check => {
            message += `❌ ${check}\n`;
        });
        
        message += `\n🔍 <i>Monitorar para possível entrada se confirmar</i>`;
        
        if (DEBUG_SETTINGS.sendTelegram) {
            await sendAlert(message);
        }
        
        console.log(`\n⚡ QUASE SINAL PARA ${signalData.symbol}`);
        console.log(`📊 Score: ${signalData.qualityScore.score}/100 (${signalData.qualityScore.grade})`);
        console.log(`🎯 Preço: $${signalData.priceFormatted}`);
        console.log(`📈 Direção: ${signalData.isBullish ? 'COMPRA' : 'VENDA'}`);
        
        logToFile(`QUASE SINAL: ${signalData.symbol} - Score: ${signalData.qualityScore.score} - ${signalData.isBullish ? 'COMPRA' : 'VENDA'} - $${signalData.price} - Motivo: ${signalData.failureReasons.join(', ')}`);
        
    } catch (error) {
        logToFile(`⚠️ Erro ao enviar alerta de quase sinal: ${error.message}`);
    }
}

async function checkRateLimit(weight = 1) {
    const now = Date.now();
    const windowSize = 60 * 1000;
    
    if (now - rateLimitCounter.windowStart >= windowSize) {
        rateLimitCounter.windowStart = now;
        rateLimitCounter.usedWeight = 0;
        rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
    }
    
    if (rateLimitCounter.usedWeight + weight > BINANCE_RATE_LIMIT.requestsPerMinute) {
        const waitTime = windowSize - (now - rateLimitCounter.windowStart) + 1000;
        logToFile(`⏳ Rate limit próximo: ${rateLimitCounter.usedWeight}/${BINANCE_RATE_LIMIT.requestsPerMinute}. Aguardando ${Math.ceil(waitTime/1000)}s`);
        console.log(`⏳ Rate limit próximo. Aguardando ${Math.ceil(waitTime/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        rateLimitCounter.windowStart = Date.now();
        rateLimitCounter.usedWeight = 0;
        rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute;
    }
    
    rateLimitCounter.usedWeight += weight;
    rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute - rateLimitCounter.usedWeight;
    
    await new Promise(resolve => setTimeout(resolve, 100));
}

async function fetchAllFuturesSymbols() {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.exchangeInfo);
        
        const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        const response = await fetchWithRetry(url);
        
        if (!response.ok) {
            throw new Error(`Falha ao buscar exchangeInfo: ${response.status}`);
        }
        
        const data = await response.json();
        
        const symbols = data.symbols
            .filter(symbol => 
                symbol.quoteAsset === 'USDT' && 
                symbol.status === 'TRADING' &&
                symbol.contractType === 'PERPETUAL'
            )
            .map(symbol => symbol.symbol);
        
        console.log(`✅ Encontrados ${symbols.length} símbolos USDT PERPETUAL na Binance Futures`);
        
        await fetchSymbolsDecimals(data.symbols);
        
        return symbols;
        
    } catch (error) {
        console.error(`❌ Erro ao buscar símbolos: ${error.message}`);
        logToFile(`❌ Erro ao buscar símbolos: ${error.message}`);
        
        return [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT',
            'AVAXUSDT', 'LINKUSDT', 'TRXUSDT', 'UNIUSDT', 'ATOMUSDT'
        ];
    }
}

async function fetchSymbolsDecimals(symbolsData) {
    try {
        for (const symbolInfo of symbolsData) {
            if (symbolInfo.quoteAsset !== 'USDT' || symbolInfo.status !== 'TRADING') {
                continue;
            }
            
            const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
            const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
            
            if (priceFilter && priceFilter.tickSize) {
                const symbol = symbolInfo.symbol;
                const tickSize = parseFloat(priceFilter.tickSize);
                
                TICK_SIZE_CONFIG[symbol] = tickSize;
                
                let decimals = 0;
                
                if (tickSize < 1) {
                    const tickSizeStr = priceFilter.tickSize;
                    const decimalIndex = tickSizeStr.indexOf('.');
                    if (decimalIndex !== -1) {
                        const decimalPart = tickSizeStr.substring(decimalIndex + 1);
                        let firstNonZero = -1;
                        for (let i = 0; i < decimalPart.length; i++) {
                            if (decimalPart[i] !== '0') {
                                firstNonZero = i;
                                break;
                            }
                        }
                        
                        if (firstNonZero === -1) {
                            decimals = 0;
                        } else {
                            decimals = decimalPart.length;
                        }
                    }
                }
                
                const isLowPriceToken = symbol.includes('1000') || 
                                      symbol.includes('BONK') || 
                                      symbol.includes('PEPE') || 
                                      symbol.includes('SHIB') ||
                                      symbol.includes('FLOKI') ||
                                      symbol.includes('WIF');
                
                const isMicroCap = symbol.includes('PEPE') || 
                                 symbol.includes('SHIB') || 
                                 symbol.includes('FLOKI');
                
                if (isMicroCap) {
                    decimals = Math.max(decimals, 8);
                } else if (isLowPriceToken) {
                    decimals = Math.max(decimals, 6);
                } else if (symbol === 'BTCUSDT' || symbol === 'ETHUSDT' || symbol === 'BNBUSDT') {
                    decimals = 2;
                } else if (tickSize >= 0.01 && tickSize < 0.1) {
                    decimals = Math.max(decimals, 3);
                } else if (tickSize >= 0.001 && tickSize < 0.01) {
                    decimals = Math.max(decimals, 4);
                } else if (tickSize >= 0.0001 && tickSize < 0.001) {
                    decimals = Math.max(decimals, 5);
                } else if (tickSize >= 0.00001 && tickSize < 0.0001) {
                    decimals = Math.max(decimals, 6);
                } else {
                    decimals = Math.max(decimals, 2);
                }
                
                decimals = Math.min(decimals, 8);
                
                DECIMALS_CONFIG[symbol] = decimals;
                
                console.log(`  ${symbol}: ${decimals} decimais (tickSize: ${tickSize})`);
            }
        }
        
        console.log(`✅ Configuração de decimais carregada para ${Object.keys(DECIMALS_CONFIG).length} símbolos`);
        
    } catch (error) {
        console.error(`❌ Erro ao buscar decimais: ${error.message}`);
        logToFile(`❌ Erro ao buscar decimais: ${error.message}`);
        
        const defaultSymbols = {
            'BTCUSDT': 2,
            'ETHUSDT': 2,
            'BNBUSDT': 2,
            'SOLUSDT': 3,
            'XRPUSDT': 4,
            'ADAUSDT': 4,
            'DOGEUSDT': 5,
            'MATICUSDT': 4,
            'DOTUSDT': 3,
            'LTCUSDT': 2,
            'SHIBUSDT': 8,
            'PEPEUSDT': 8,
            'FLOKIUSDT': 8,
            'BONKUSDT': 6
        };
        
        Object.assign(DECIMALS_CONFIG, defaultSymbols);
    }
}

function formatNumber(num, symbol = null, isPrice = true, isPercentage = false) {
    if (num === "N/A" || num === undefined || num === null) return "N/A";
    
    if (typeof num === 'string') {
        num = parseFloat(num);
    }
    
    if (isNaN(num)) return "N/A";
    
    if (isPercentage) {
        return num.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + '%';
    }
    
    if (isPrice && symbol && DECIMALS_CONFIG[symbol] !== undefined) {
        const decimals = DECIMALS_CONFIG[symbol];
        
        const rounded = Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
        
        return rounded.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
    
    if (num >= 1000000) {
        return (num / 1000000).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + 'K';
    }
    
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatNumberForTelegram(num, symbol = null, isPrice = true) {
    if (num === "N/A" || num === undefined || num === null) return "N/A";
    
    if (typeof num === 'string') {
        num = parseFloat(num);
    }
    
    if (isNaN(num)) return "N/A";
    
    if (isPrice && symbol && DECIMALS_CONFIG[symbol] !== undefined) {
        const decimals = DECIMALS_CONFIG[symbol];
        
        const rounded = Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
        
        return rounded.toFixed(decimals);
    }
    
    return num.toFixed(2);
}

function roundToTickSize(value, symbol) {
    if (!symbol || !TICK_SIZE_CONFIG[symbol]) return value;
    
    const tickSize = TICK_SIZE_CONFIG[symbol];
    return Math.round(value / tickSize) * tickSize;
}

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
        
        let totalATR = 0;
        let count = 0;
        
        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const previous = candles[i-1];
            
            const highLow = current.high - current.low;
            const highClose = Math.abs(current.high - previous.close);
            const lowClose = Math.abs(current.low - previous.close);
            
            const trueRange = Math.max(highLow, highClose, lowClose);
            const atrPercent = (trueRange / previous.close) * 100;
            
            totalATR += atrPercent;
            count++;
        }
        
        const avgVolatility = count > 0 ? totalATR / count : 0;
        
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
        
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
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
        
        const roundedATR = roundToTickSize(currentATR, symbol);
        
        return {
            atr: roundedATR,
            atrPercent: atrPercent,
            atrFormatted: formatNumberForTelegram(roundedATR, symbol, true),
            atrPercentFormatted: atrPercent.toFixed(2),
            price: currentPrice,
            message: `ATR: ${formatNumberForTelegram(roundedATR, symbol, true)} (${atrPercent.toFixed(2)}%)`,
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

async function getADX(symbol, period = ADX_SETTINGS.period) {
    try {
        const candles = await getCandlesCached(symbol, ADX_SETTINGS.timeframe, period * 3 + 10);

        if (candles.length < period * 2) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_SETTINGS.timeframe}: ⚪ Dados insuficientes`,
                raw: null
            };
        }

        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));
        const closes = candles.map(c => parseFloat(c.close));

        const adxInput = {
            high: highs,
            low: lows,
            close: closes,
            period: period
        };

        const adxValues = ADX.calculate(adxInput);

        if (!adxValues || adxValues.length === 0) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_SETTINGS.timeframe}: ⚪ Erro no cálculo`,
                raw: null
            };
        }

        const lastResult = adxValues[adxValues.length - 1];
        const currentADX = lastResult.adx;

        if (typeof currentADX !== 'number' || isNaN(currentADX) || currentADX < 0) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_SETTINGS.timeframe}: ⚪ Valor inválido`,
                raw: null
            };
        }

        const isStrongTrend = currentADX > ADX_SETTINGS.strongTrendThreshold;

        return {
            adx: currentADX.toFixed(2),
            isStrongTrend: isStrongTrend,
            raw: currentADX,
            message: isStrongTrend ?
                `✅ ADX ${ADX_SETTINGS.timeframe}: ${currentADX.toFixed(2)} (tendência forte)` :
                `⚠️ ADX ${ADX_SETTINGS.timeframe}: ${currentADX.toFixed(2)} (tendência fraca)`
        };

    } catch (error) {
        logToFile(`⚠️ Erro ao calcular ADX ${ADX_SETTINGS.timeframe}(${symbol}): ${error.message}`);
        return {
            adx: "N/A",
            isStrongTrend: false,
            message: `ADX ${ADX_SETTINGS.timeframe}: ⚪ Erro na análise`,
            raw: null
        };
    }
}

async function getADX1h(symbol, period = ADX_1H_SETTINGS.period) {
    try {
        const candles = await getCandlesCached(symbol, ADX_1H_SETTINGS.timeframe, period * 3 + 10);

        if (candles.length < period * 2) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_1H_SETTINGS.timeframe}: ⚪ Dados insuficientes`,
                raw: null
            };
        }

        const highs = candles.map(c => parseFloat(c.high));
        const lows = candles.map(c => parseFloat(c.low));
        const closes = candles.map(c => parseFloat(c.close));

        const adxInput = {
            high: highs,
            low: lows,
            close: closes,
            period: period
        };

        const adxValues = ADX.calculate(adxInput);

        if (!adxValues || adxValues.length === 0) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_1H_SETTINGS.timeframe}: ⚪ Erro no cálculo`,
                raw: null
            };
        }

        const lastResult = adxValues[adxValues.length - 1];
        const currentADX = lastResult.adx;

        if (typeof currentADX !== 'number' || isNaN(currentADX) || currentADX < 0) {
            return {
                adx: "N/A",
                isStrongTrend: false,
                message: `ADX ${ADX_1H_SETTINGS.timeframe}: ⚪ Valor inválido`,
                raw: null
            };
        }

        const isStrongTrend = currentADX > ADX_1H_SETTINGS.strongTrendThreshold;

        return {
            adx: currentADX.toFixed(2),
            isStrongTrend: isStrongTrend,
            raw: currentADX,
            message: `ADX ${ADX_1H_SETTINGS.timeframe}: ${currentADX.toFixed(2)} ${isStrongTrend ? '(tendência forte)' : '(tendência fraca)'}`
        };

    } catch (error) {
        logToFile(`⚠️ Erro ao calcular ADX ${ADX_1H_SETTINGS.timeframe}(${symbol}): ${error.message}`);
        return {
            adx: "N/A",
            isStrongTrend: false,
            message: `ADX ${ADX_1H_SETTINGS.timeframe}: ⚪ Erro na análise`,
            raw: null
        };
    }
}

async function getFundingRate(symbol) {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.fundingRate);
        
        const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
        const res = await fetchWithRetry(url);
        
        const data = await res.json();
        
        if (data && data.lastFundingRate !== undefined) {
            const rate = parseFloat(data.lastFundingRate) * 100;
            const rawRate = parseFloat(data.lastFundingRate);
            
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
                raw: rawRate,
                formatted: `${rate.toFixed(4)}% ${fundingRateEmoji}`
            };
        }
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null,
            formatted: "N/A"
        };
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar Funding Rate(${symbol}): ${e.message}`);
        return { 
            rate: "N/A", 
            emoji: "", 
            raw: null,
            formatted: "N/A"
        };
    }
}

async function checkFundingRateCriteria(symbol, isBullish) {
    try {
        const fundingData = await getFundingRate(symbol);
        
        if (fundingData.raw === null || fundingData.raw === undefined) {
            return {
                isValid: true,
                fundingRate: "N/A",
                message: "Funding: ⚪ Dados insuficientes",
                raw: null
            };
        }
        
        const fundingValue = fundingData.raw * 100;
        
        if (isBullish) {
            const isValid = fundingValue <= FUNDING_BUY_MAX;
            return {
                isValid: isValid,
                fundingRate: fundingData.formatted,
                raw: fundingData.raw,
                message: isValid ? 
                    `✅ Funding: ${fundingData.formatted} (≤ ${FUNDING_BUY_MAX}% - bom para compra)` : 
                    `❌ Funding: ${fundingData.formatted} (> ${FUNDING_BUY_MAX}% - requerido ≤ ${FUNDING_BUY_MAX}% para COMPRA)`
            };
        } else {
            const isValid = fundingValue >= FUNDING_SELL_MIN;
            return {
                isValid: isValid,
                fundingRate: fundingData.formatted,
                raw: fundingData.raw,
                message: isValid ? 
                    `✅ Funding: ${fundingData.formatted} (≥ ${FUNDING_SELL_MIN}% - bom para venda)` : 
                    `❌ Funding: ${fundingData.formatted} (< ${FUNDING_SELL_MIN}% - requerido ≥ ${FUNDING_SELL_MIN}% para VENDA)`
            };
        }
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar critério Funding Rate(${symbol}): ${error.message}`);
        return {
            isValid: true,
            fundingRate: "N/A",
            message: "Funding: ⚪ Erro na verificação",
            raw: null
        };
    }
}

async function getOpenInterestWithSMA(symbol) {
    const cacheKey = `${symbol}_OI_5m`;
    const now = Date.now();
    
    if (oiCache[cacheKey] && now - oiCache[cacheKey].timestamp < OI_CACHE_TTL) {
        return oiCache[cacheKey];
    }
    
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.openInterest);
        
        const currentOIUrl = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
        const currentRes = await fetchWithRetry(currentOIUrl);
        const currentData = await currentRes.json();
        
        if (!currentData || !currentData.openInterest) {
            throw new Error('Dados de Open Interest inválidos');
        }
        
        const currentOI = parseFloat(currentData.openInterest);
        const timestamp = currentData.time || now;
        
        let oiHistory = [];
        let useHistoricalAPI = false;
        
        try {
            await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.openInterest);
            const historicalUrl = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=30`;
            const historicalRes = await fetchWithRetry(historicalUrl, {}, 1);
            
            if (historicalRes.status === 200) {
                const historicalData = await historicalRes.json();
                
                if (Array.isArray(historicalData) && historicalData.length > 0) {
                    oiHistory = historicalData.map(item => ({
                        value: parseFloat(item.sumOpenInterest),
                        timestamp: item.timestamp
                    }));
                    
                    oiHistory.sort((a, b) => a.timestamp - b.timestamp);
                    
                    oiHistory.push({
                        value: currentOI,
                        timestamp: timestamp
                    });
                    
                    if (oiHistory.length > OI_HISTORY_SIZE) {
                        oiHistory = oiHistory.slice(-OI_HISTORY_SIZE);
                    }
                    
                    useHistoricalAPI = true;
                }
            }
        } catch (historicalError) {
        }
        
        if (!useHistoricalAPI) {
            if (oiCache[cacheKey] && oiCache[cacheKey].history) {
                oiHistory = [...oiCache[cacheKey].history];
                
                const lastTimestamp = oiHistory.length > 0 ? oiHistory[oiHistory.length - 1].timestamp : 0;
                
                if (now - lastTimestamp > 55000) {
                    oiHistory.push({
                        value: currentOI,
                        timestamp: now
                    });
                    
                    if (oiHistory.length > OI_HISTORY_SIZE) {
                        oiHistory = oiHistory.slice(-OI_HISTORY_SIZE);
                    }
                } else {
                    if (oiHistory.length > 0) {
                        oiHistory[oiHistory.length - 1] = {
                            value: currentOI,
                            timestamp: now
                        };
                    }
                }
            } else {
                oiHistory.push({
                    value: currentOI,
                    timestamp: now
                });
            }
        }
        
        let sma = null;
        let trend = "➡️";
        let oiFormatted = formatNumber(currentOI, symbol, false);
        
        if (oiHistory.length >= OI_SMA_PERIOD) {
            const recentValues = oiHistory.slice(-OI_SMA_PERIOD).map(h => h.value);
            
            sma = SMA.calculate({
                values: recentValues,
                period: OI_SMA_PERIOD
            }).pop();
            
            if (sma !== null && sma > 0) {
                const percentageDiff = ((currentOI - sma) / sma) * 100;
                
                if (percentageDiff > 0.3) {
                    trend = "🟢⬆️";
                } else if (percentageDiff < -0.3) {
                    trend = "🔴⬇️";
                }
            }
            
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
        
        oiCache[cacheKey] = result;
        
        return result;
        
    } catch (error) {
        logToFile(`⚠️ Erro ao buscar Open Interest(${symbol}): ${error.message}`);
        
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

async function checkOpenInterestCriteria(symbol, isBullishSignal) {
    try {
        const oiData = await getOpenInterestWithSMA(symbol);
        
        if (oiData.trend === "➡️" || oiData.sma === null || oiData.historySize < OI_SMA_PERIOD) {
            return {
                isValid: true,
                trend: oiData.trend,
                oiFormatted: oiData.oiFormatted,
                historySize: oiData.historySize,
                message: "OI: ⚪ Neutro (dados insuficientes)"
            };
        }
        
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

async function getLSR(symbol, period = '15m') {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.lsr);
        
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

async function checkLSRCriteria(symbol, isBullishSignal) {
    try {
        const lsrData = await getLSR(symbol, LSR_TIMEFRAME);
        
        if (lsrData.raw === null || lsrData.raw === undefined) {
            return {
                isValid: true,
                lsrRatio: "N/A",
                message: "LSR: ⚪ Dados insuficientes",
                threshold: isBullishSignal ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD
            };
        }
        
        const lsrValue = lsrData.raw;
        
        if (isBullishSignal) {
            const isValid = lsrValue < LSR_BUY_THRESHOLD;
            return {
                isValid: isValid,
                lsrRatio: lsrValue.toFixed(4),
                raw: lsrValue,
                message: isValid ? 
                    `✅ LSR: ${lsrValue.toFixed(4)} (< ${LSR_BUY_THRESHOLD})` : 
                    `❌ LSR: ${lsrValue.toFixed(4)} (≥ ${LSR_BUY_THRESHOLD} - requerido < ${LSR_BUY_THRESHOLD} para COMPRA)`,
                threshold: LSR_BUY_THRESHOLD,
                timeframe: LSR_TIMEFRAME
            };
        } else {
            const isValid = lsrValue > LSR_SELL_THRESHOLD;
            return {
                isValid: isValid,
                lsrRatio: lsrValue.toFixed(4),
                raw: lsrValue,
                message: isValid ? 
                    `✅ LSR: ${lsrValue.toFixed(4)} (> ${LSR_SELL_THRESHOLD})` : 
                    `❌ LSR: ${lsrValue.toFixed(4)} (≤ ${LSR_SELL_THRESHOLD} - requerido > ${LSR_SELL_THRESHOLD} para VENDA)`,
                threshold: LSR_SELL_THRESHOLD,
                timeframe: LSR_TIMEFRAME
            };
        }
        
    } catch (error) {
        logToFile(`⚠️ Erro ao verificar critério LSR(${symbol}): ${error.message}`);
        return {
            isValid: true,
            lsrRatio: "N/A",
            message: "LSR: ⚪ Erro na verificação",
            threshold: isBullishSignal ? LSR_BUY_THRESHOLD : LSR_SELL_THRESHOLD,
            timeframe: LSR_TIMEFRAME
        };
    }
}

async function getRSI15mDirection(symbol) {
    try {
        const candles = await getCandlesCached(symbol, '15m', 16);
        if (candles.length < 16) {
            return { direction: "neutral", current: null, previous: null };
        }

        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period: 14 });

        if (rsiValues.length < 2) {
            return { direction: "neutral", current: null, previous: null };
        }

        const currentRSI = rsiValues[rsiValues.length - 1];
        const previousRSI = rsiValues[rsiValues.length - 2];

        if (currentRSI > previousRSI) {
            return { direction: "rising", current: currentRSI, previous: previousRSI };
        } else if (currentRSI < previousRSI) {
            return { direction: "falling", current: currentRSI, previous: previousRSI };
        } else {
            return { direction: "neutral", current: currentRSI, previous: previousRSI };
        }
    } catch (error) {
        logToFile(`⚠️ Erro ao calcular RSI 15m direction (${symbol}): ${error.message}`);
        return { direction: "neutral", current: null, previous: null };
    }
}

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

function initLogSystem() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    cleanupOldLogs();
}

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

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await checkRateLimit(1);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After') || 60;
                const waitTime = parseInt(retryAfter) * 1000 + 2000;
                
                logToFile(`⚠️ Rate limit atingido (429). Tentativa ${attempt}/${maxRetries}. Aguardando ${retryAfter}s...`);
                console.log(`⚠️ Rate limit atingido. Aguardando ${retryAfter}s...`);
                
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
            }
            
            const usedWeight = response.headers.get('X-MBX-USED-WEIGHT-1M');
            if (usedWeight) {
                rateLimitCounter.usedWeight = parseInt(usedWeight);
                rateLimitCounter.remainingWeight = BINANCE_RATE_LIMIT.requestsPerMinute - rateLimitCounter.usedWeight;
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
            
            if (attempt < maxRetries) {
                const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError || new Error(`Falha após ${maxRetries} tentativas`);
}

async function checkInternetConnection() {
    try {
        await checkRateLimit(1);
        await fetchWithRetry('https://api.binance.com/api/v3/ping', {}, 1);
        return true;
    } catch (error) {
        return false;
    }
}

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

function cleanupCaches() {
    const now = Date.now();
    
    Object.keys(candleCache).forEach(key => {
        if (now - candleCache[key].ts > MAX_CACHE_AGE) {
            delete candleCache[key];
        }
    });
    
    Object.keys(oiCache).forEach(key => {
        if (now - oiCache[key].timestamp > 10 * 60 * 1000) {
            delete oiCache[key];
        }
    });
    
    Object.keys(COMPRESSED_CANDLE_CACHE).forEach(key => {
        if (now - COMPRESSED_CANDLE_CACHE[key].timestamp > MAX_CACHE_AGE) {
            delete COMPRESSED_CANDLE_CACHE[key];
        }
    });
}

function compressCandles(candles, symbol) {
    if (!candles || candles.length === 0) return [];
    
    const decimals = DECIMALS_CONFIG[symbol] || 8;
    const multiplier = Math.pow(10, decimals);
    
    return candles.map(c => [
        Math.round(c.time / 60000),
        Math.round(c.open * multiplier) / multiplier,
        Math.round(c.high * multiplier) / multiplier,
        Math.round(c.low * multiplier) / multiplier,
        Math.round(c.close * multiplier) / multiplier,
        Math.round(c.volume)
    ]);
}

function decompressCandles(compressed) {
    if (!compressed || compressed.length === 0) return [];
    
    return compressed.map(c => ({
        time: c[0] * 60000,
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5]
    }));
}

async function getCandlesCached(symbol, timeframe = '15m', limit = 200) {
    const key = `${symbol}_${timeframe}_${limit}`;
    const now = Date.now();
    
    if (COMPRESS_CANDLES) {
        if (COMPRESSED_CANDLE_CACHE[key] && now - COMPRESSED_CANDLE_CACHE[key].timestamp < CANDLE_CACHE_TTL) {
            return decompressCandles(COMPRESSED_CANDLE_CACHE[key].data);
        }
    } else {
        if (candleCache[key] && now - candleCache[key].ts < CANDLE_CACHE_TTL) {
            return candleCache[key].data;
        }
    }
    
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.klines);
        
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
        
        if (COMPRESS_CANDLES) {
            const compressed = compressCandles(candles, symbol);
            COMPRESSED_CANDLE_CACHE[key] = { 
                data: compressed, 
                timestamp: now,
                originalSize: JSON.stringify(candles).length,
                compressedSize: JSON.stringify(compressed).length
            };
            
            if (Math.random() < 0.01) {
                const savings = (1 - (COMPRESSED_CANDLE_CACHE[key].compressedSize / COMPRESSED_CANDLE_CACHE[key].originalSize)) * 100;
                console.log(`📦 Compressão: ${savings.toFixed(1)}% economia para ${key}`);
            }
        } else {
            candleCache[key] = { data: candles, ts: now };
        }
        
        return candles;
        
    } catch (e) {
        logToFile(`⚠️ Erro ao buscar candles(${symbol}): ${e.message}`);
        return [];
    }
}

async function getRSI(symbol, timeframe, period = 14) {
    try {
        const candles = await getCandlesCached(symbol, timeframe, period + 50);
        
        if (candles.length < period + 1) {
            return { value: "N/A", timeframe: timeframe };
        }
        
        const closes = candles.map(c => c.close);
        
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

async function getOrderBook(symbol) {
    try {
        await checkRateLimit(BINANCE_RATE_LIMIT.weightPerRequest.orderBook);
        
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
            bidVolume: formatNumber(bidVolume, symbol, false),
            askVolume: formatNumber(askVolume, symbol, false),
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

async function checkAbnormalVolume(symbol, multiplier = VOLUME_SETTINGS.baseThreshold) {
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
        
        const latestCandle = candles[candles.length - 1];
        const open = latestCandle.open;
        const high = latestCandle.high;
        const low = latestCandle.low;
        const close = latestCandle.close;
        const currentVolume = latestCandle.volume;
        
        const previousVolumes = candles.slice(0, candles.length - 1).map(c => c.volume);
        
        const avgVolume = previousVolumes.reduce((sum, vol) => sum + vol, 0) / previousVolumes.length;
        
        const ratio = avgVolume > 0 ? currentVolume / avgVolume : 0;
        
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
            rawRatio: ratio,
            threshold: multiplier,
            isAboveThreshold: ratio >= multiplier
        };
        
    } catch (e) {
        logToFile(`⚠️ Erro ao verificar volume 3m (${symbol}): ${error.message}`);
        return { 
            isAbnormal: false, 
            currentVolume: 0, 
            avgVolume: 0, 
            ratio: 0,
            open: 0,
            close: 0,
            high: 0,
            low: 0,
            rawRatio: 0,
            threshold: VOLUME_SETTINGS.baseThreshold,
            isAboveThreshold: false
        };
    }
}

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
        
        const ema13Series = calculateEMACompleteSeries(closes, 13);
        const ema34Series = calculateEMACompleteSeries(closes, 34);
        const ema55Series = calculateEMACompleteSeries(closes, 55);
        
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
        
        const ema13 = ema13Series[ema13Series.length - 1];
        const ema34 = ema34Series[ema34Series.length - 1];
        const ema55 = ema55Series.length > 0 ? ema55Series[ema55Series.length - 1] : null;
        
        const previousEma13 = ema13Series.length >= 2 ? ema13Series[ema13Series.length - 2] : null;
        const previousEma34 = ema34Series.length >= 2 ? ema34Series[ema34Series.length - 2] : null;
        
        const isEMA13CrossingUp = previousEma13 !== null && previousEma34 !== null && 
                                 previousEma13 <= previousEma34 && ema13 > ema34;
        const isEMA13CrossingDown = previousEma13 !== null && previousEma34 !== null && 
                                   previousEma13 >= previousEma34 && ema13 < ema34;
        
        const priceFormatted = formatNumberForTelegram(currentPrice, symbol, true);
        const ema13Formatted = formatNumberForTelegram(ema13, symbol, true);
        const ema34Formatted = formatNumberForTelegram(ema34, symbol, true);
        const ema55Formatted = ema55 ? formatNumberForTelegram(ema55, symbol, true) : "N/A";
        
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

function calculateEntryLevelsATR(currentPrice, atrValue, isBullish, symbol) {
    const retractionATR = atrValue * ENTRY_RETRACTION_MULTIPLIER;
    const maxDistanceATR = atrValue * ENTRY_MAX_DISTANCE_MULTIPLIER;
    
    const retractionPercent = (retractionATR / currentPrice) * 100;
    const maxDistancePercent = (maxDistanceATR / currentPrice) * 100;
    
    const finalRetractionPercent = Math.max(
        ENTRY_MIN_RETRACTION_PERCENT,
        Math.min(retractionPercent, ENTRY_MAX_RETRACTION_PERCENT)
    );
    
    let idealEntry, maxEntry, retractionPrice, maxEntryPrice;
    
    if (isBullish) {
        retractionPrice = currentPrice * (1 - finalRetractionPercent / 100);
        idealEntry = roundToTickSize(retractionPrice, symbol);
        
        maxEntryPrice = currentPrice * (1 + maxDistancePercent / 100);
        maxEntry = roundToTickSize(maxEntryPrice, symbol);
    } else {
        retractionPrice = currentPrice * (1 + finalRetractionPercent / 100);
        idealEntry = roundToTickSize(retractionPrice, symbol);
        
        maxEntryPrice = currentPrice * (1 - maxDistancePercent / 100);
        maxEntry = roundToTickSize(maxEntryPrice, symbol);
    }
    
    return {
        currentPrice: currentPrice,
        idealEntry: idealEntry,
        idealEntryFormatted: formatNumberForTelegram(idealEntry, symbol, true),
        maxEntry: maxEntry,
        maxEntryFormatted: formatNumberForTelegram(maxEntry, symbol, true),
        retractionPrice: retractionPrice,
        retractionPriceFormatted: formatNumberForTelegram(retractionPrice, symbol, true),
        retractionPercent: finalRetractionPercent.toFixed(2),
        maxDistancePercent: maxDistancePercent.toFixed(2),
        atrValueUsed: retractionATR,
        isBullish: isBullish,
        levels: isBullish ? [
            { level: 1, price: roundToTickSize(currentPrice * 0.995, symbol), label: "Entrada imediata" },
            { level: 2, price: idealEntry, label: "Entrada ideal (retração)" },
            { level: 3, price: roundToTickSize(currentPrice * 0.985, symbol), label: "Entrada agressiva" }
        ] : [
            { level: 1, price: roundToTickSize(currentPrice * 1.005, symbol), label: "Entrada imediata" },
            { level: 2, price: idealEntry, label: "Entrada ideal (retração)" },
            { level: 3, price: roundToTickSize(currentPrice * 1.015, symbol), label: "Entrada agressiva" }
        ]
    };
}

async function calculateTargetsAndStopATR(entryPrice, isBullish, symbol) {
    const targets = [];
    
    const atrData = await calculateATR(symbol, ATR_TIMEFRAME, ATR_PERIOD);
    
    let stopPrice, stopPercentage, stopType, atrValueUsed;
    
    if (atrData.atr && atrData.atr > 0) {
        atrValueUsed = atrData.atr * ATR_MULTIPLIER;
        stopType = "ATR";
        
        const atrStopPercentage = (atrValueUsed / entryPrice) * 100;
        
        const finalStopPercentage = Math.max(
            MIN_ATR_PERCENTAGE, 
            Math.min(atrStopPercentage, MAX_ATR_PERCENTAGE)
        );
        
        stopPercentage = finalStopPercentage;
        
        if (isBullish) {
            stopPrice = roundToTickSize(entryPrice * (1 - finalStopPercentage / 100), symbol);
        } else {
            stopPrice = roundToTickSize(entryPrice * (1 + finalStopPercentage / 100), symbol);
        }
        
    } else {
        stopType = "Fixo";
        stopPercentage = 3.0;
        atrValueUsed = null;
        
        if (isBullish) {
            stopPrice = roundToTickSize(entryPrice * (1 - stopPercentage / 100), symbol);
        } else {
            stopPrice = roundToTickSize(entryPrice * (1 + stopPercentage / 100), symbol);
        }
    }
    
    let entryLevels = null;
    if (atrData.atr && atrData.atr > 0) {
        entryLevels = calculateEntryLevelsATR(entryPrice, atrData.atr, isBullish, symbol);
    }
    
    if (isBullish) {
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = roundToTickSize(entryPrice * (1 + percentage / 100), symbol);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumberForTelegram(targetPrice, symbol, true),
                riskReward: (percentage / stopPercentage).toFixed(2)
            });
        }
    } else {
        for (const percentage of TARGET_PERCENTAGES) {
            const targetPrice = roundToTickSize(entryPrice * (1 - percentage / 100), symbol);
            targets.push({
                percentage: percentage,
                price: targetPrice,
                formatted: formatNumberForTelegram(targetPrice, symbol, true),
                riskReward: (percentage / stopPercentage).toFixed(2)
            });
        }
    }
    
    return {
        targets: targets,
        stopPrice: stopPrice,
        stopFormatted: formatNumberForTelegram(stopPrice, symbol, true),
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

async function calculateSignalQuality(symbol, isBullish, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, rsiTrigger, adx, fundingCheck) {
    let score = 0;
    let details = [];
    let failedChecks = [];
    
    if (volumeCheck.isConfirmed) {
        const volumeRatio = parseFloat(volumeCheck.volumeData.ratio);
        let volumeScore = 0;
        
        if (volumeRatio >= 2.0) {
            volumeScore = QUALITY_WEIGHTS.volume;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 2.0x)`);
        } else if (volumeRatio >= 1.5) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.8;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x ≥ 1.5x)`);
        } else if (volumeRatio >= 1.3) {
            volumeScore = QUALITY_WEIGHTS.volume * 0.5;
            details.push(`📊 Volume: ${volumeScore}/${QUALITY_WEIGHTS.volume} (${volumeRatio}x mínimo)`);
        } else {
            failedChecks.push(`Volume: ${volumeRatio}x < ${volumeCheck.dynamicThreshold.toFixed(2)}x`);
        }
        
        score += volumeScore;
    } else {
        failedChecks.push(`Volume: ${volumeCheck.volumeData.ratio}x < ${volumeCheck.dynamicThreshold.toFixed(2)}x`);
        details.push(`📊 Volume: 0/${QUALITY_WEIGHTS.volume} (não confirmado)`);
    }
    
    if (oiCheck.isValid && oiCheck.trend !== "➡️") {
        score += QUALITY_WEIGHTS.oi;
        details.push(`📈 OI: ${QUALITY_WEIGHTS.oi}/${QUALITY_WEIGHTS.oi} (${oiCheck.trend})`);
    } else {
        failedChecks.push(`OI: ${oiCheck.trend} (não alinhado)`);
        details.push(`📈 OI: 0/${QUALITY_WEIGHTS.oi} (neutro ou inválido)`);
    }
    
    if (volatilityCheck.isValid) {
        const volValue = parseFloat(volatilityCheck.volatility);
        let volScore = 0;
        
        if (volValue >= 1.0) {
            volScore = QUALITY_WEIGHTS.volatility;
            details.push(`⚡ Vol: ${volScore}/${QUALITY_WEIGHTS.volatility} (${volValue}% ≥ 1.0%)`);
        } else if (volValue >= 0.5) {
            volScore = QUALITY_WEIGHTS.volatility * 0.7;
            details.push(`⚡ Vol: ${volScore}/${QUALITY_WEIGHTS.volatility} (${volValue}% mínimo)`);
        } else {
            failedChecks.push(`Volatilidade: ${volValue}% < 0.5%`);
        }
        
        score += volScore;
    } else {
        failedChecks.push(`Volatilidade: ${volatilityCheck.volatility}% < ${VOLATILITY_THRESHOLD}%`);
        details.push(`⚡ Vol: 0/${QUALITY_WEIGHTS.volatility} (insuficiente)`);
    }
    
    if (lsrCheck.isValid) {
        const lsrValue = parseFloat(lsrCheck.raw || 0);
        let lsrScore = 0;
        
        if (isBullish) {
            if (lsrValue < 2.0) {
                lsrScore = QUALITY_WEIGHTS.lsr;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} < 2.0)`);
            } else if (lsrValue < 2.5) {
                lsrScore = QUALITY_WEIGHTS.lsr * 0.6;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} < 2.5)`);
            } else {
                failedChecks.push(`LSR: ${lsrValue.toFixed(2)} ≥ 2.5 (para compra)`);
            }
        } else {
            if (lsrValue > 3.0) {
                lsrScore = QUALITY_WEIGHTS.lsr;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} > 3.0)`);
            } else if (lsrValue > 2.5) {
                lsrScore = QUALITY_WEIGHTS.lsr * 0.6;
                details.push(`⚖️ LSR: ${lsrScore}/${QUALITY_WEIGHTS.lsr} (${lsrValue.toFixed(2)} > 2.5)`);
            } else {
                failedChecks.push(`LSR: ${lsrValue.toFixed(2)} ≤ 2.5 (para venda)`);
            }
        }
        
        score += lsrScore;
    } else {
        failedChecks.push(`LSR: fora do range esperado`);
        details.push(`⚖️ LSR: 0/${QUALITY_WEIGHTS.lsr} (fora do range)`);
    }
    
    if (rsi1h.raw !== null && !isNaN(rsi1h.raw)) {
        const rsiValue = rsi1h.raw;
        let rsiScore = 0;
        
        if (isBullish) {
            if (rsiValue > 30 && rsiValue < 50) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📉 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} oversold)`);
            } else if (rsiValue >= 50 && rsiValue < 60) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.5;
                details.push(`📉 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} neutro)`);
            } else {
                failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} (muito alto para compra)`);
            }
        } else {
            if (rsiValue > 50 && rsiValue < 70) {
                rsiScore = QUALITY_WEIGHTS.rsi;
                details.push(`📈 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} overbought)`);
            } else if (rsiValue >= 40 && rsiValue <= 50) {
                rsiScore = QUALITY_WEIGHTS.rsi * 0.5;
                details.push(`📈 RSI: ${rsiScore}/${QUALITY_WEIGHTS.rsi} (${rsiValue.toFixed(2)} neutro)`);
            } else {
                failedChecks.push(`RSI 1h: ${rsiValue.toFixed(2)} (muito baixo para venda)`);
            }
        }
        
        score += rsiScore;
    } else {
        failedChecks.push(`RSI 1h: dados indisponíveis`);
        details.push(`📉 RSI: 0/${QUALITY_WEIGHTS.rsi} (dados indisponíveis)`);
    }
    
    if (emas3mData.ema13 !== "N/A" && emas3mData.ema34 !== "N/A" && emas3mData.ema55 !== "N/A") {
        let emaScore = 0;
        
        if (isBullish) {
            if (emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
                emaScore = QUALITY_WEIGHTS.emaAlignment;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (alinhadas bullish)`);
            } else if (emas3mData.isAboveEMA55) {
                emaScore = QUALITY_WEIGHTS.emaAlignment * 0.5;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (acima da 55)`);
            } else {
                failedChecks.push(`EMAs: não alinhadas bullish`);
            }
        } else {
            if (emas3mData.isBelowEMA55 && emas3mData.isEMA13CrossingDown) {
                emaScore = QUALITY_WEIGHTS.emaAlignment;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (alinhadas bearish)`);
            } else if (emas3mData.isBelowEMA55) {
                emaScore = QUALITY_WEIGHTS.emaAlignment * 0.5;
                details.push(`📊 EMAs: ${emaScore}/${QUALITY_WEIGHTS.emaAlignment} (abaixo da 55)`);
            } else {
                failedChecks.push(`EMAs: não alinhadas bearish`);
            }
        }
        
        score += emaScore;
    } else {
        failedChecks.push(`EMAs: dados insuficientes`);
        details.push(`📊 EMAs: 0/${QUALITY_WEIGHTS.emaAlignment} (dados insuficientes)`);
    }
    
    if (rsiTrigger && rsiTrigger.isValid) {
        const rsiScore = QUALITY_WEIGHTS.rsiTrigger;
        score += rsiScore;
        details.push(`📊 RSI Trigger ${RSI_TRIGGER_SETTINGS.timeframe}: ${rsiScore}/${QUALITY_WEIGHTS.rsiTrigger} (${rsiTrigger.message})`);
    } else {
        failedChecks.push(`RSI Trigger: ${rsiTrigger.message}`);
        details.push(`📊 RSI Trigger ${RSI_TRIGGER_SETTINGS.timeframe}: 0/${QUALITY_WEIGHTS.rsiTrigger} (trigger não ativado)`);
    }
    
    if (adx && adx.raw !== null) {
        let adxScore = 0;
        
        if (adx.isStrongTrend) {
            adxScore = QUALITY_WEIGHTS.adx;
            details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: ${adxScore}/${QUALITY_WEIGHTS.adx} (${adx.adx} > ${ADX_SETTINGS.strongTrendThreshold} - tendência forte)`);
        } else {
            adxScore = QUALITY_WEIGHTS.adx * 0.3;
            details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: ${adxScore}/${QUALITY_WEIGHTS.adx} (${adx.adx} ≤ ${ADX_SETTINGS.strongTrendThreshold} - tendência fraca)`);
            failedChecks.push(`ADX: ${adx.adx} (tendência fraca)`);
        }
        
        score += adxScore;
    } else {
        failedChecks.push(`ADX: dados indisponíveis`);
        details.push(`📊 ADX ${ADX_SETTINGS.timeframe}: 0/${QUALITY_WEIGHTS.adx} (dados indisponíveis)`);
    }
    
    if (fundingCheck && fundingCheck.isValid) {
        const fundingValue = fundingCheck.raw * 100;
        
        if (isBullish) {
            if (fundingValue <= -0.1) {
                score += 10;
                details.push(`💰 Funding: +10 bônus (${fundingValue.toFixed(4)}% muito bom para compra)`);
            } else if (fundingValue <= -0.05) {
                score += 5;
                details.push(`💰 Funding: +5 bônus (${fundingValue.toFixed(4)}% bom para compra)`);
            } else if (fundingValue <= FUNDING_BUY_MAX) {
                score += 3;
                details.push(`💰 Funding: +3 bônus (${fundingValue.toFixed(4)}% dentro do critério para compra)`);
            } else {
                failedChecks.push(`Funding: ${fundingValue.toFixed(4)}% > ${FUNDING_BUY_MAX}% (para compra)`);
            }
        } else {
            if (fundingValue >= 0.1) {
                score += 10;
                details.push(`💰 Funding: +10 bônus (${fundingValue.toFixed(4)}% muito bom para venda)`);
            } else if (fundingValue >= 0.05) {
                score += 5;
                details.push(`💰 Funding: +5 bônus (${fundingValue.toFixed(4)}% bom para venda)`);
            } else if (fundingValue >= FUNDING_SELL_MIN) {
                score += 3;
                details.push(`💰 Funding: +3 bônus (${fundingValue.toFixed(4)}% dentro do critério para venda)`);
            } else {
                failedChecks.push(`Funding: ${fundingValue.toFixed(4)}% < ${FUNDING_SELL_MIN}% (para venda)`);
            }
        }
    } else {
        failedChecks.push(`Funding: critério não atendido`);
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
        message: `${emoji} Probabilidade: ${grade} (${Math.round(score)}/100) ${score >= QUALITY_THRESHOLD ? '✅' : '❌'}`
    };
}

function buildAlertMessage(isBullish, symbol, priceFormatted, brDateTime, targetsAndStop, 
                          rsi1h, stoch4h, stochDaily, lsrData, fundingRate, 
                          volumeCheck, orderBook, emas3mData, oiCheck, volatilityCheck, lsrCheck,
                          qualityScore, rsiTrigger, adx, fundingCheck, adx1h) {
    
    const title = isBullish ? '🟢 <b>🤖 COMPRA  </b>' : '🔴 <b>🤖 CORREÇÃO </b>';
    
    const stopInfo = targetsAndStop.stopType === "ATR" ? 
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n` +
        `    Melhor R/R: ${targetsAndStop.bestRiskReward}:1\n` :
        `⛔Stop ${targetsAndStop.stopType}: $${targetsAndStop.stopFormatted} (${targetsAndStop.stopPercentage}%)\n`;
    
    let message = `${title}\n`;
    message += `<b>Alertou:</b> ${brDateTime.date} - ${brDateTime.time}\n`;
    message += `<b>#ATIVO:</b> ${symbol}\n`;
    message += `<b>$Preço atual:</b> $${priceFormatted}\n`;
    
    message += `${qualityScore.message}\n`;
    
    if (rsiTrigger && rsiTrigger.isValid) {
        message += `${rsiTrigger.message}\n`;
    }
    
    if (adx1h && adx1h.adx !== "N/A") {
        message += `${adx1h.message}\n`;
    }
    
    if (targetsAndStop.entryLevels) {
        const entry = targetsAndStop.entryLevels;
        if (isBullish) {
            message += `<b>  Entrada Sugerida:</b>\n`;
            message += `    $${entry.levels[0].price.toLocaleString('en-US', {minimumFractionDigits: DECIMALS_CONFIG[symbol] || 4, maximumFractionDigits: DECIMALS_CONFIG[symbol] || 4})} (Imediata)\n`;
            message += `    $${entry.levels[2].price.toLocaleString('en-US', {minimumFractionDigits: DECIMALS_CONFIG[symbol] || 4, maximumFractionDigits: DECIMALS_CONFIG[symbol] || 4})} (Agressiva)\n`;
        } else {
            message += `<b>  Entrada Sugerida:</b>\n`;
            message += `    $${entry.levels[0].price.toLocaleString('en-US', {minimumFractionDigits: DECIMALS_CONFIG[symbol] || 4, maximumFractionDigits: DECIMALS_CONFIG[symbol] || 4})} (Imediata)\n`;
            message += `    $${entry.levels[2].price.toLocaleString('en-US', {minimumFractionDigits: DECIMALS_CONFIG[symbol] || 4, maximumFractionDigits: DECIMALS_CONFIG[symbol] || 4})} (Agressiva)\n`;
        }
    } else {
        message += `<b>Entrada:</b> $${priceFormatted}\n`;
    }
    
    message += stopInfo;
    
    targetsAndStop.targets.forEach((target, index) => {
        const rr = target.riskReward;
        const rrEmoji = parseFloat(rr) >= 3 ? '🎯' : parseFloat(rr) >= 2 ? '✅' : '⚠️';
        message += isBullish ? 
            ` ${rrEmoji} Alvo ${index + 1} : $${target.formatted}\n` :
            ` ${rrEmoji} Alvo ${index + 1}: $${target.formatted} \n`;
    });
    
    message += ` #RSI 1h: <b>${rsi1h.value}</b>\n`;
    message += ` #Stoch 4h: K=${stoch4h.k} ${stoch4h.kDirection} D=${stoch4h.d} ${stoch4h.dDirection}\n`;
    message += ` #Stoch 1D: K=${stochDaily.k} ${stochDaily.kDirection} D=${stochDaily.d} ${stochDaily.dDirection}\n`;
    message += ` #LSR : <b>${lsrCheck.lsrRatio}</b> ${lsrCheck.message.includes('✅') ? '✅' : lsrCheck.message.includes('❌') ? '❌' : '⚪'}\n`;
    message += ` #OI 5m: ${oiCheck.trend} <b>${oiCheck.oiFormatted}</b> (${oiCheck.historySize} pts)\n`;
    message += ` #Volatilidade: <b>${volatilityCheck.volatility}%</b> \n`;
    message += ` #ADX ${ADX_SETTINGS.timeframe}: <b>${adx.adx}</b> ${adx.isStrongTrend ? '✅' : '⚠️'}\n`;
    if (adx1h && adx1h.adx !== "N/A") {
        message += ` #ADX ${ADX_1H_SETTINGS.timeframe}: <b>${adx1h.adx}</b> ${adx1h.isStrongTrend ? '✅' : '⚠️'}\n`;
    }
    if (rsiTrigger && rsiTrigger.rsiValue !== "N/A") {
        message += ` #RSI Trigger ${RSI_TRIGGER_SETTINGS.timeframe}: <b>${rsiTrigger.rsiValue}</b> ${rsiTrigger.isValid ? '✅' : '❌'}\n`;
    }
    message += ` #Fund.R: ${fundingRate.emoji} <b>${fundingRate.rate}%</b>\n`;
    message += ` Vol 3m: <b>${volumeCheck.volumeData.ratio}x</b> (≥ ${volumeCheck.dynamicThreshold.toFixed(2)}x)\n`;
    message += ` Vol Bid(Compras): <b>${orderBook.bidVolume}</b>\n`;
    message += ` Vol Ask(Vendas): <b>${orderBook.askVolume}</b>\n`;
    message += `   <b>✔︎IA Tecnology by @J4Rviz</b>`;
    
    return message;
}

function initAlertsCooldown(symbols) {
    symbols.forEach(symbol => {
        alertsCooldown[symbol] = {
            lastBuyConfirmation: 0,
            lastSellConfirmation: 0
        };
        initRSIMemory(symbol);
    });
}

async function monitorSignals(symbol) {
    try {
        const rsiTriggerBuy = await checkRSITrigger(symbol, true);
        const rsiTriggerSell = await checkRSITrigger(symbol, false);
        
        if (!rsiTriggerBuy.isValid && !rsiTriggerSell.isValid) {
            return null;
        }
        
        const emas3mData = await getEMAs3m(symbol);
        
        if (emas3mData.ema55 === "N/A" || emas3mData.ema13 === "N/A" || emas3mData.ema34 === "N/A") {
            return null;
        }
        
        const rsi1h = await getRSI(symbol, '1h');
        const rsiValue = parseFloat(rsi1h.value);
        
        const rsi15mDirection = await getRSI15mDirection(symbol);
        
        const brDateTime = getBrazilianDateTime();
        const priceFormatted = emas3mData.priceFormatted;
        
        const now = Date.now();
        let signalAlert = null;
        let nearSignal = null;
        
        if (rsiTriggerBuy.isValid && emas3mData.isAboveEMA55 && emas3mData.isEMA13CrossingUp) {
            if (rsiValue >= 60 || isNaN(rsiValue)) {
                return null;
            }
            
            if (rsi15mDirection.direction !== "rising") {
                return null;
            }
            
            const volumeCheck = await checkVolumeConfirmation(symbol);
            const oiCheck = await checkOpenInterestCriteria(symbol, true);
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            const lsrCheck = await checkLSRCriteria(symbol, true);
            const fundingCheck = await checkFundingRateCriteria(symbol, true);
            const adx = await getADX(symbol);
            const adx1h = await getADX1h(symbol);
            
            const qualityScore = await calculateSignalQuality(
                symbol, true, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, rsiTriggerBuy, adx, fundingCheck
            );
            
            const allCriteriaValid = volumeCheck.isConfirmed && 
                                    oiCheck.isValid && 
                                    volatilityCheck.isValid && 
                                    lsrCheck.isValid && 
                                    fundingCheck.isValid && 
                                    qualityScore.isAcceptable;
            
            if (!allCriteriaValid && DEBUG_SETTINGS.enableNearSignals) {
                // Verifica se é um "quase sinal" (score 60-69)
                if (qualityScore.score >= DEBUG_SETTINGS.minScore && 
                    qualityScore.score <= DEBUG_SETTINGS.maxScore) {
                    
                    nearSignal = {
                        symbol: symbol,
                        isBullish: true,
                        price: emas3mData.currentPrice,
                        priceFormatted: priceFormatted,
                        qualityScore: qualityScore,
                        rsiTrigger: rsiTriggerBuy,
                        volumeCheck: volumeCheck,
                        oiCheck: oiCheck,
                        volatilityCheck: volatilityCheck,
                        lsrCheck: lsrCheck,
                        fundingCheck: fundingCheck,
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
                    rsiTriggerBuy,
                    adx,
                    fundingCheck,
                    adx1h
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
                    rsiTrigger: rsiTriggerBuy,
                    adx: adx,
                    adx1h: adx1h,
                    fundingCheck: fundingCheck,
                    rsi15mDirection: rsi15mDirection
                };
                
                updateCooldown(symbol, true, now);
                if (rsiMemory[symbol]) {
                    rsiMemory[symbol].visitedOversold = false;
                }
            }
        }
        
        if (rsiTriggerSell.isValid && emas3mData.isBelowEMA55 && emas3mData.isEMA13CrossingDown) {
            if (rsiValue <= 40 || isNaN(rsiValue)) {
                return null;
            }
            
            if (rsi15mDirection.direction !== "falling") {
                return null;
            }
            
            const volumeCheck = await checkVolumeConfirmation(symbol);
            const oiCheck = await checkOpenInterestCriteria(symbol, false);
            const volatilityCheck = await checkVolatility(symbol, VOLATILITY_TIMEFRAME, VOLATILITY_PERIOD, VOLATILITY_THRESHOLD);
            const lsrCheck = await checkLSRCriteria(symbol, false);
            const fundingCheck = await checkFundingRateCriteria(symbol, false);
            const adx = await getADX(symbol);
            const adx1h = await getADX1h(symbol);
            
            const qualityScore = await calculateSignalQuality(
                symbol, false, volumeCheck, oiCheck, volatilityCheck, lsrCheck, rsi1h, emas3mData, rsiTriggerSell, adx, fundingCheck
            );
            
            const allCriteriaValid = volumeCheck.isConfirmed && 
                                    oiCheck.isValid && 
                                    volatilityCheck.isValid && 
                                    lsrCheck.isValid && 
                                    fundingCheck.isValid && 
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
                        rsiTrigger: rsiTriggerSell,
                        volumeCheck: volumeCheck,
                        oiCheck: oiCheck,
                        volatilityCheck: volatilityCheck,
                        lsrCheck: lsrCheck,
                        fundingCheck: fundingCheck,
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
                    rsiTriggerSell,
                    adx,
                    fundingCheck,
                    adx1h
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
                    rsiTrigger: rsiTriggerSell,
                    adx: adx,
                    adx1h: adx1h,
                    fundingCheck: fundingCheck,
                    rsi15mDirection: rsi15mDirection
                };
                
                updateCooldown(symbol, false, now);
                if (rsiMemory[symbol]) {
                    rsiMemory[symbol].visitedOverbought = false;
                }
            }
        }
        
        if (nearSignal) {
            await sendNearSignalAlert(nearSignal);
        }
        
        return signalAlert;
        
    } catch (e) {
        logToFile(`⚠️ Erro no monitorSignals(${symbol}): ${e.message}`);
        return null;
    }
}

async function processBatch(batch, processFunction) {
    const results = await Promise.allSettled(
        batch.map(symbol => processFunction(symbol))
    );
    
    const alerts = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            alerts.push(result.value);
        }
    });
    
    return alerts;
}

async function mainBotLoop() {
    console.log('\n🔍 Buscando todos os pares USDT da Binance Futures...');
    SYMBOLS = await fetchAllFuturesSymbols();
    
    if (SYMBOLS.length === 0) {
        console.log('❌ Não foi possível encontrar símbolos. Usando lista fallback.');
        SYMBOLS = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'LTCUSDT'
        ];
    }
    
    initAlertsCooldown(SYMBOLS);
    
    const initMsg = '\n' +
        '='.repeat(70) + '\n' +
        ` 🤖 BOT DE SINAIS SMC COM RSI TRIGGER (MELHORIAS RÁPIDAS IMPLEMENTADAS)\n` +
        ` 📊 MONITORANDO ${SYMBOLS.length} ATIVOS DINAMICAMENTE\n` +
        ` ⚡ PROCESSAMENTO EM LOTE (${BATCH_SIZE} ATIVOS EM PARALELO)\n` +
        ` 📈 TRIGGER PRINCIPAL: RSI ${RSI_TRIGGER_SETTINGS.timeframe} (período ${RSI_TRIGGER_SETTINGS.period})\n` +
        ` 🔵 ZONAS RSI: Oversold ${RSI_TRIGGER_SETTINGS.oversoldZone} | Overbought ${RSI_TRIGGER_SETTINGS.overboughtZone}\n` +
        ` 🎯 NOVAS MELHORIAS IMPLEMENTADAS:\n` +
        `   1. Volume Adaptativo: ${VOLUME_SETTINGS.baseThreshold}x base (${VOLUME_SETTINGS.minThreshold}-${VOLUME_SETTINGS.maxThreshold}x)\n` +
        `   2. Quality Score Ajustado: RSI Trigger ↑${QUALITY_WEIGHTS.rsiTrigger}, Volume ↓${QUALITY_WEIGHTS.volume}\n` +
        `   3. Cooldown Diferenciado: ${COOLDOWN_SETTINGS.sameDirection/60000}min mesma direção, ${COOLDOWN_SETTINGS.oppositeDirection/60000}min oposta\n` +
        `   4. Alertas Quase Sinal: ${DEBUG_SETTINGS.enableNearSignals ? 'ATIVADO' : 'DESATIVADO'}\n` +
        '='.repeat(70) + '\n';
    
    console.log(initMsg);
    logToFile(`🤖 Bot iniciado com melhorias rápidas - Monitorando ${SYMBOLS.length} ativos`);
    
    const brDateTime = getBrazilianDateTime();
    await sendAlert(`🤖 <b>SMC RSI TRIGGER BOT (VERSÃO MELHORADA)</b>\n` +
                    `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                    `📊 <b>Ativos monitorados:</b> ${SYMBOLS.length} pares USDT\n` +
                    `📈 <b>Trigger principal:</b> RSI ${RSI_TRIGGER_SETTINGS.timeframe} (zona ${RSI_TRIGGER_SETTINGS.oversoldZone}/${RSI_TRIGGER_SETTINGS.overboughtZone})\n` +
                    `🎯 <b>Melhorias implementadas:</b>\n` +
                    `   • Volume threshold adaptativo (${VOLUME_SETTINGS.baseThreshold}x base)\n` +
                    `   • Cooldown diferenciado por direção\n` +
                    `   • Quality score ajustado\n` +
                    `   • Alertas de quase sinal ${DEBUG_SETTINGS.enableNearSignals ? 'ativados' : 'desativados'}\n` +
                    `⚠️ <b>ATENÇÃO:</b> Testar em conta demo primeiro\n` +
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
            let nearSignalsDetected = 0;
            
            console.log(`\n🔄 Ciclo ${cycleCount} - Verificando ${SYMBOLS.length} ativos...`);
            console.log(`📊 Rate Limit: ${rateLimitCounter.usedWeight}/${BINANCE_RATE_LIMIT.requestsPerMinute} (${rateLimitCounter.remainingWeight} restantes)`);
            
            console.log(`🔍 Analisando sinais baseados no RSI Trigger ${RSI_TRIGGER_SETTINGS.timeframe}...`);
            for (let i = 0; i < SYMBOLS.length; i += BATCH_SIZE) {
                const batch = SYMBOLS.slice(i, i + BATCH_SIZE);
                const batchAlerts = await processBatch(batch, monitorSignals);
                
                for (const alert of batchAlerts) {
                    console.log(`\n✅ SINAL DETECTADO PARA ${alert.symbol}!`);
                    console.log(`📊 ${alert.signal} - Preço: $${alert.priceFormatted}`);
                    console.log(`📈 Score: ${alert.qualityScore.grade} (${alert.qualityScore.score}/100)`);
                    console.log(`📊 RSI Trigger ${RSI_TRIGGER_SETTINGS.timeframe}: ${alert.rsiTrigger.message}`);
                    console.log(`📊 Volume: ${alert.volumeConfirmation.volumeData.ratio}x (threshold: ${alert.volumeConfirmation.dynamicThreshold.toFixed(2)}x)`);
                    console.log(`💰 Funding: ${alert.fundingCheck.message}`);
                    console.log(`📊 RSI 15min: ${alert.rsi15mDirection.direction === 'rising' ? 'Subindo ↗️' : 'Caindo ↘️'}`);
                    
                    logToFile(`SINAL ${alert.signal} - ${alert.symbol} - Preço: $${alert.price} - Score: ${alert.qualityScore.score} - RSI Trigger: ${alert.rsiTrigger.message} - Volume: ${alert.volumeConfirmation.volumeData.ratio}x`);
                    
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
console.log(`🤖 BOT DE SINAIS SMC COM RSI TRIGGER (MELHORIAS RÁPIDAS IMPLEMENTADAS)`);
console.log(`📊 VOLUME ADAPTATIVO: ${VOLUME_SETTINGS.baseThreshold}x base (${VOLUME_SETTINGS.minThreshold}-${VOLUME_SETTINGS.maxThreshold}x)`);
console.log(`🎯 QUALITY SCORE AJUSTADO: RSI Trigger ↑${QUALITY_WEIGHTS.rsiTrigger}, Volume ↓${QUALITY_WEIGHTS.volume}`);
console.log(`⏱️ COOLDOWN DIFERENCIADO: ${COOLDOWN_SETTINGS.sameDirection/60000}min mesma direção, ${COOLDOWN_SETTINGS.oppositeDirection/60000}min oposta`);
console.log(`🔔 ALERTAS QUASE SINAL: ${DEBUG_SETTINGS.enableNearSignals ? 'ATIVADO' : 'DESATIVADO'}`);
console.log('='.repeat(80) + '\n');

try {
    require('technicalindicators');
} catch (e) {
    console.log('⚠️ technicalindicators não encontrado. Instale com: npm install technicalindicators');
    process.exit(1);
}

startBot();
