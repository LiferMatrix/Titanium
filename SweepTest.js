const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { SMA, EMA, RSI, Stochastic, ATR } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx6AG8p
const TELEGRAM_CHAT_ID = '-1002554


// Configurações do estudo
const FRACTAL_BARS = 3;
const N = 2;

// === FILTROS ===
const VOLUME_RELATIVE_THRESHOLD = 1.3;
const VOLUME_BUY_THRESHOLD = 55;
const VOLUME_SELL_THRESHOLD = 55;

const LSR_TIMEFRAME = '15m';
const LSR_BUY_THRESHOLD = 2.5;
const LSR_SELL_THRESHOLD = 2.5;

// === SUPORTE/RESISTÊNCIA ===
const CLUSTER_PERIODS = [50, 100, 200];
const CLUSTER_TIMEFRAME = '1h';
const CLUSTER_TOUCH_THRESHOLD = 3;

// === CONFIGURAÇÕES DE MEMÓRIA DE SWEEP ===
const SWEEP_MEMORY_HOURS = 6;
const SWEEP_MEMORY_MS = SWEEP_MEMORY_HOURS * 60 * 60 * 1000;
const SWEEP_CLEANUP_INTERVAL = 10;
const RECENT_SWEEP_MINUTES = 60;
const RECENT_SWEEP_MS = RECENT_SWEEP_MINUTES * 60 * 1000;

// TIMEFRAMES PARA DETECÇÃO DE SWEEP
const SWEEP_TIMEFRAMES = ['1h', '15m'];

// === RATE LIMIT ===
const MAX_REQUESTS_PER_MINUTE = 1200;
const SAFE_REQUEST_LIMIT = 900;
const REQUEST_WINDOW_MS = 60000;
const BATCH_SIZE = 10;

// === CIRCUIT BREAKER ===
let panicMode = false;
let panicModeUntil = 0;
let consecutiveGlobalErrors = 0;
const PANIC_DURATION_MIN = 180000;
const PANIC_DURATION_MAX = 300000;
const PANIC_TRIGGER_COUNT = 5;

// === BLACKLIST ===
const symbolBlacklist = new Map();
const BLACKLIST_DURATION = 15 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

// === CONTROLE DE RATE LIMIT ===
let requestCount = 0;
let requestWindowStart = Date.now();

// === CACHE PRINCIPAL ===
let cycleDataCache = new Map();
const CACHE_CYCLE_TTL = 60000;

// === MEMÓRIA DE SWEEPS ===
const sweepMemory = new Map();

// === CACHE DE SR ===
const srCache = new Map();
const SR_CACHE_TTL = 60 * 60 * 1000;

// === ESTATÍSTICAS DE REJEIÇÃO ===
let rejectionStats = {
    total: 0,
    byReason: new Map(),
    bySymbol: new Map(),
    lastReset: Date.now()
};

// === CONFIGURAÇÕES DE RESET ===
const RESET_STATS_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_STATS_TOTAL = 5000;

// === CONFIGURAÇÕES ATR ===
const TARGET_PERCENTAGES = [2.5, 5.0, 8.0, 12.0];
const ATR_PERIOD = 14;
const ATR_MULTIPLIER = 2.5;
const ATR_TIMEFRAME = '15m';
const MIN_ATR_PERCENTAGE = 1.5;
const MAX_ATR_PERCENTAGE = 6.0;

// Configurações de entrada
const ENTRY_RETRACTION_MULTIPLIER = 0.5;
const ENTRY_MIN_RETRACTION_PERCENT = 0.5;
const ENTRY_MAX_RETRACTION_PERCENT = 2.0;

// Cooldown entre alertas
const COOLDOWN = 30 * 60 * 1000;
const alertsCooldown = {};

// ============================================
// FUNÇÃO DE RESET DAS ESTATÍSTICAS
// ============================================

function checkAndResetRejectionStats() {
    const now = Date.now();
    let reset = false;
    
    if (now - rejectionStats.lastReset > RESET_STATS_INTERVAL) {
        reset = true;
        console.log('📊 Resetando estatísticas de rejeição (24h)');
    } else if (rejectionStats.total > MAX_STATS_TOTAL) {
        reset = true;
        console.log(`📊 Resetando estatísticas de rejeição (${rejectionStats.total} > ${MAX_STATS_TOTAL})`);
    }
    
    if (reset) {
        rejectionStats = {
            total: 0,
            byReason: new Map(),
            bySymbol: new Map(),
            lastReset: now
        };
    }
}

// ============================================
// FUNÇÃO DE LOG DE REJEIÇÃO
// ============================================

function logRejection(symbol, reason, details = {}) {
    rejectionStats.total++;
    
    const reasonCount = rejectionStats.byReason.get(reason) || 0;
    rejectionStats.byReason.set(reason, reasonCount + 1);
    
    const symbolCount = rejectionStats.bySymbol.get(symbol) || 0;
    rejectionStats.bySymbol.set(symbol, symbolCount + 1);
    
    const detailStr = Object.entries(details)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    
    logToFile(`❌ REJEITADO ${symbol}: ${reason} ${detailStr ? '| ' + detailStr : ''}`);
    
    checkAndResetRejectionStats();
}

// ============================================
// FUNÇÃO DE ANÁLISE DE MERCADO (RESUMIDA)
// ============================================

async function analyzeMarket(allData) {
    const now = Date.now();
    const recentThreshold = now - RECENT_SWEEP_MS;
    
    const stats = {
        totalSymbols: ALL_SYMBOLS.length,
        activeSweeps: sweepMemory.size,
        buySweeps: 0,
        sellSweeps: 0,
        recentSweeps: 0,
        sweepsByTimeframe: { '1h': 0, '15m': 0 },
        totalVolumeRatio: 0,
        volumeSamples: 0,
        totalRSI: 0,
        rsiSamples: 0,
        rsiOverbought: 0,
        rsiOversold: 0,
        emaAlignments: {
            above55: 0,
            below55: 0,
            crossingUp: 0,
            crossingDown: 0
        },
        topVolume: [],
        bottomVolume: [],
        topRejections: []
    };
    
    // Analisar sweeps ativos
    for (const [symbol, sweep] of sweepMemory) {
        if (sweep.type === 'BUY') stats.buySweeps++;
        if (sweep.type === 'SELL') stats.sellSweeps++;
        if (sweep.timeframe === '1h') stats.sweepsByTimeframe['1h']++;
        if (sweep.timeframe === '15m') stats.sweepsByTimeframe['15m']++;
        if (sweep.timestamp > recentThreshold) stats.recentSweeps++;
    }
    
    // Analisar dados de mercado (amostra de até 100 símbolos)
    let sampled = 0;
    const volumeList = [];
    
    for (const [symbol, data] of allData) {
        if (sampled >= 100) break;
        
        const candles3m = data['3m'];
        const candles1h = data['1h'];
        
        if (candles3m && candles3m.length > 55) {
            const lastCandle = candles3m[candles3m.length - 1];
            const prevVolumes = candles3m.slice(0, -1).map(c => c.volume);
            const avgVolume = prevVolumes.reduce((s, v) => s + v, 0) / prevVolumes.length;
            const volumeRatio = avgVolume > 0 ? lastCandle.volume / avgVolume : 0;
            
            stats.totalVolumeRatio += volumeRatio;
            stats.volumeSamples++;
            
            volumeList.push({ symbol, volume: volumeRatio });
            
            const emasData = calculateEMAsFromData(candles3m);
            if (emasData.currentPrice) {
                if (emasData.isAboveEMA55) stats.emaAlignments.above55++;
                if (emasData.isBelowEMA55) stats.emaAlignments.below55++;
                if (emasData.isEMA13CrossingUp) stats.emaAlignments.crossingUp++;
                if (emasData.isEMA13CrossingDown) stats.emaAlignments.crossingDown++;
            }
        }
        
        if (candles1h && candles1h.length > 20) {
            const rsiData = calculateRSIFromData(candles1h);
            if (rsiData.raw) {
                stats.totalRSI += rsiData.raw;
                stats.rsiSamples++;
                if (rsiData.raw > 70) stats.rsiOverbought++;
                if (rsiData.raw < 30) stats.rsiOversold++;
            }
        }
        
        sampled++;
    }
    
    // Calcular médias
    stats.avgVolumeRatio = stats.volumeSamples > 0 ? 
        (stats.totalVolumeRatio / stats.volumeSamples) : 0;
    stats.avgRSI = stats.rsiSamples > 0 ? 
        (stats.totalRSI / stats.rsiSamples) : 50;
    
    // Top 5 maiores volumes
    stats.topVolume = volumeList
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 5)
        .map(s => `${s.symbol}:${s.volume.toFixed(1)}x`);
    
    // Top 5 menores volumes
    stats.bottomVolume = volumeList
        .sort((a, b) => a.volume - b.volume)
        .slice(0, 5)
        .map(s => `${s.symbol}:${s.volume.toFixed(1)}x`);
    
    // Top 5 motivos de rejeição com %
    const totalRej = rejectionStats.total || 1;
    stats.topRejections = Array.from(rejectionStats.byReason.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}:${count}(${((count/totalRej)*100).toFixed(0)}%)`);
    
    return stats;
}

// ============================================
// FUNÇÃO DE MENSAGEM DE ANÁLISE (RESUMIDA)
// ============================================

function buildMarketAnalysisMessage(stats) {
    const brDateTime = getBrazilianDateTime();
    
    // Condição do mercado
    let marketEmoji = '⚪';
    if (stats.buySweeps > stats.sellSweeps * 1.5) marketEmoji = '🟢';
    else if (stats.sellSweeps > stats.buySweeps * 1.5) marketEmoji = '🔴';
    
    // Volume
    let volumeEmoji = '📊';
    if (stats.avgVolumeRatio < 1.0) volumeEmoji = '📉';
    else if (stats.avgVolumeRatio > 1.3) volumeEmoji = '📈';
    
    // RSI
    let rsiEmoji = '⚖️';
    if (stats.avgRSI > 65) rsiEmoji = '🔥';
    else if (stats.avgRSI < 35) rsiEmoji = '❄️';
    
    // Sweeps recentes %
    const recentPct = stats.activeSweeps > 0 ? 
        ((stats.recentSweeps / stats.activeSweeps) * 100).toFixed(0) : 0;
    
    const message = 
        `📊<b>ANÁLISE ${brDateTime.time}</b>\n` +
        `🎯${stats.totalSymbols} | 💾${stats.activeSweeps} ` +
        `🟢${stats.buySweeps} 🔴${stats.sellSweeps} ` +
        `⏱️${recentPct}% recente\n` +
        `📊1h:${stats.sweepsByTimeframe['1h']} ⚡15m:${stats.sweepsByTimeframe['15m']}\n` +
        `${volumeEmoji}Vol ${stats.avgVolumeRatio.toFixed(2)}x ` +
        `${rsiEmoji}RSI ${stats.avgRSI.toFixed(1)} ` +
        `🔥${stats.rsiOverbought} ❄️${stats.rsiOversold}\n` +
        `📈EMA55: ${stats.emaAlignments.above55}/${stats.emaAlignments.below55} ` +
        `⚡X:${stats.emaAlignments.crossingUp}/${stats.emaAlignments.crossingDown}\n` +
        `⬆️Vol: ${stats.topVolume.join(' ')}\n` +
        `⬇️Vol: ${stats.bottomVolume.join(' ')}\n` +
        `❌Rej: ${stats.topRejections.join(' ')}\n` +
        `✅by @J4Rviz`;
    
    return message;
}

// ============================================
// FUNÇÃO DE BUSCA DE DADOS
// ============================================

async function fetchAllCycleData(symbols) {
    console.log('📥 Buscando dados...');
    const now = Date.now();
    const dataMap = new Map();
    let successCount = 0;
    
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async (symbol) => {
            try {
                if (cycleDataCache.has(symbol)) {
                    const cached = cycleDataCache.get(symbol);
                    if (now - cached.timestamp < CACHE_CYCLE_TTL) {
                        dataMap.set(symbol, cached.data);
                        successCount++;
                        return;
                    }
                }
                
                const [c3m, c1h, c4h, c1d, c15m] = await Promise.allSettled([
                    getCandles(symbol, '3m', 200),
                    getCandles(symbol, '1h', 200),
                    getCandles(symbol, '4h', 200),
                    getCandles(symbol, '1d', 200),
                    getCandles(symbol, '15m', 100)
                ]);
                
                const data = {
                    '3m': c3m.status === 'fulfilled' ? c3m.value : [],
                    '1h': c1h.status === 'fulfilled' ? c1h.value : [],
                    '4h': c4h.status === 'fulfilled' ? c4h.value : [],
                    '1d': c1d.status === 'fulfilled' ? c1d.value : [],
                    '15m': c15m.status === 'fulfilled' ? c15m.value : [],
                    timestamp: now
                };
                
                if (data['3m'].length > 0 && data['1h'].length > 0) {
                    cycleDataCache.set(symbol, { data, timestamp: now });
                    dataMap.set(symbol, data);
                    successCount++;
                }
                
            } catch (error) {
                if (cycleDataCache.has(symbol)) {
                    dataMap.set(symbol, cycleDataCache.get(symbol).data);
                    successCount++;
                }
            }
        });
        
        await Promise.allSettled(promises);
        process.stdout.write(`\r📊 ${Math.min(i + BATCH_SIZE, symbols.length)}/${symbols.length} - ${successCount} ok`);
        await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(' ✅');
    return dataMap;
}

// ============================================
// FUNÇÃO DE DETECÇÃO DE SWEEP
// ============================================

function detectSweep(candles, timeframe) {
    if (!candles || candles.length < 100) return null;
    
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const currentIndex = closes.length - 1;
    const currentPrice = closes[currentIndex];
    
    if (isDnFractal(highs, currentIndex - N)) {
        const fractalLevel = highs[currentIndex - N];
        if (currentPrice > fractalLevel) {
            return {
                type: 'SELL',
                price: currentPrice,
                fractalLevel,
                timeframe,
                timestamp: Date.now()
            };
        }
    }
    
    if (isUpFractal(lows, currentIndex - N)) {
        const fractalLevel = lows[currentIndex - N];
        if (currentPrice < fractalLevel) {
            return {
                type: 'BUY',
                price: currentPrice,
                fractalLevel,
                timeframe,
                timestamp: Date.now()
            };
        }
    }
    
    return null;
}

// ============================================
// FUNÇÃO DE VOLUME
// ============================================

function calculateVolumeAtSweep(candles3m) {
    if (!candles3m || candles3m.length < 21) {
        return { ratio: 0, isValid: false };
    }
    
    const lastCandle = candles3m[candles3m.length - 1];
    const prevVolumes = candles3m.slice(0, -1).map(c => c.volume);
    const avgVolume = prevVolumes.reduce((s, v) => s + v, 0) / prevVolumes.length;
    const ratio = avgVolume > 0 ? lastCandle.volume / avgVolume : 0;
    
    return {
        ratio,
        isValid: ratio >= VOLUME_RELATIVE_THRESHOLD
    };
}

// ============================================
// FUNÇÃO DE ATUALIZAÇÃO DA MEMÓRIA
// ============================================

function updateSweepMemory(symbol, newSweep, volumeAtSweep) {
    const now = Date.now();
    const sixHoursAgo = now - SWEEP_MEMORY_MS;
    
    if (sweepMemory.has(symbol)) {
        const existing = sweepMemory.get(symbol);
        
        if (existing.timestamp < sixHoursAgo) {
            sweepMemory.set(symbol, {
                ...newSweep,
                volumeAtSweep
            });
            return true;
        }
        
        if (newSweep.timestamp > existing.timestamp) {
            sweepMemory.set(symbol, {
                ...newSweep,
                volumeAtSweep
            });
            return true;
        }
        
        return false;
    } else {
        sweepMemory.set(symbol, {
            ...newSweep,
            volumeAtSweep
        });
        return true;
    }
}

// ============================================
// FUNÇÃO DE DADOS OPCIONAIS
// ============================================

async function fetchOptionalDataIfNeeded(symbol) {
    const results = {
        taker: null,
        lsr: { lsrRatio: "N/A", raw: null },
        funding: { rate: "N/A", emoji: "" },
        orderbook: { bidVolume: "N/A", askVolume: "N/A" }
    };
    
    const currentUsage = requestCount / SAFE_REQUEST_LIMIT;
    
    if (currentUsage < 0.5) {
        try {
            const [taker, lsr, funding, orderbook] = await Promise.allSettled([
                getTakerVolume(symbol).catch(() => null),
                getLSR(symbol).catch(() => null),
                getFundingRate(symbol).catch(() => null),
                getOrderBook(symbol).catch(() => null)
            ]);
            
            if (taker.status === 'fulfilled' && taker.value) results.taker = taker.value;
            if (lsr.status === 'fulfilled' && lsr.value) results.lsr = lsr.value;
            if (funding.status === 'fulfilled' && funding.value) results.funding = funding.value;
            if (orderbook.status === 'fulfilled' && orderbook.value) results.orderbook = orderbook.value;
            
        } catch (e) {}
    }
    
    return results;
}

// ============================================
// FUNÇÃO PRINCIPAL DE MONITORAMENTO
// ============================================

async function monitorSymbols() {
    const now = Date.now();
    const sixHoursAgo = now - SWEEP_MEMORY_MS;
    const alerts = [];
    
    const allData = await fetchAllCycleData(ALL_SYMBOLS);
    
    console.log('🔍 Detectando novos sweeps...');
    let newSweepsCount = 0;
    
    for (const [symbol, data] of allData) {
        try {
            for (const tf of SWEEP_TIMEFRAMES) {
                const candles = data[tf];
                if (!candles || candles.length < 100) continue;
                
                const sweep = detectSweep(candles, tf);
                
                if (sweep) {
                    const volumeData = calculateVolumeAtSweep(data['3m']);
                    
                    if (!volumeData.isValid) {
                        logRejection(symbol, 'vol_insuf', {
                            tf: tf,
                            vol: volumeData.ratio.toFixed(2)
                        });
                        continue;
                    }
                    
                    const updated = updateSweepMemory(symbol, sweep, volumeData.ratio);
                    if (updated) newSweepsCount++;
                }
            }
        } catch (error) {
            logRejection(symbol, 'erro_detect', { error: error.message });
        }
    }
    
    console.log(`✅ ${newSweepsCount} novos sweeps`);
    console.log(`💾 Memória: ${sweepMemory.size} sweeps`);
    
    console.log('🔍 Verificando confirmações...');
    let confirmationsChecked = 0;
    
    for (const [symbol, sweep] of sweepMemory) {
        try {
            confirmationsChecked++;
            
            if (sweep.timestamp < sixHoursAgo) {
                logRejection(symbol, 'sweep_exp', { 
                    min: Math.round((now - sweep.timestamp) / 60000) 
                });
                sweepMemory.delete(symbol);
                continue;
            }
            
            const data = allData.get(symbol);
            if (!data) {
                logRejection(symbol, 'sem_dados');
                continue;
            }
            
            const candles3m = data['3m'];
            const candles1h = data['1h'];
            const candles4h = data['4h'];
            const candles1d = data['1d'];
            const candles15m = data['15m'];
            
            if (!candles3m || candles3m.length < 55) {
                logRejection(symbol, 'dados_insuf');
                continue;
            }
            
            const emasData = calculateEMAsFromData(candles3m);
            if (!emasData.currentPrice) {
                logRejection(symbol, 'erro_ema');
                continue;
            }
            
            const rsi1h = calculateRSIFromData(candles1h);
            
            let isConfirmed = true;
            let rejectReason = [];
            
            if (sweep.type === 'BUY') {
                if (!emasData.isAboveEMA55) {
                    isConfirmed = false;
                    rejectReason.push('abaixo55');
                }
                if (!emasData.isEMA13CrossingUp) {
                    isConfirmed = false;
                    rejectReason.push('sem_cross_up');
                }
                if (rsi1h.raw && rsi1h.raw >= 60) {
                    isConfirmed = false;
                    rejectReason.push(`rsi${rsi1h.raw.toFixed(0)}`);
                }
            } else {
                if (!emasData.isBelowEMA55) {
                    isConfirmed = false;
                    rejectReason.push('acima55');
                }
                if (!emasData.isEMA13CrossingDown) {
                    isConfirmed = false;
                    rejectReason.push('sem_cross_down');
                }
                if (rsi1h.raw && rsi1h.raw <= 60) {
                    isConfirmed = false;
                    rejectReason.push(`rsi${rsi1h.raw.toFixed(0)}`);
                }
            }
            
            if (!isConfirmed) {
                logRejection(symbol, 'condicoes', {
                    motivo: rejectReason.join(','),
                    tipo: sweep.type
                });
                continue;
            }
            
            const lastAlert = alertsCooldown[symbol]?.[sweep.type === 'BUY' ? 'lastBuyConfirmation' : 'lastSellConfirmation'] || 0;
            if (now - lastAlert < COOLDOWN) {
                const minutosRestantes = Math.round((COOLDOWN - (now - lastAlert)) / 60000);
                logRejection(symbol, 'cooldown', { rest: minutosRestantes });
                continue;
            }
            
            const lastCandle3m = candles3m[candles3m.length - 1];
            const prevVolumes = candles3m.slice(0, -1).map(c => c.volume);
            const avgVolume = prevVolumes.reduce((s, v) => s + v, 0) / prevVolumes.length;
            const currentVolumeRatio = avgVolume > 0 ? (lastCandle3m.volume / avgVolume).toFixed(2) : "0";
            
            const optionalData = await fetchOptionalDataIfNeeded(symbol);
            const srData = await getSupportResistance(symbol, candles1h);
            const atrData = calculateATRFromData(candles15m);
            const stoch4h = calculateStochFromData(candles4h);
            const stoch1d = calculateStochFromData(candles1d);
            
            const message = buildAlertMessage(
                sweep.type === 'BUY',
                symbol,
                emasData.currentPrice,
                getBrazilianDateTime(),
                atrData,
                rsi1h,
                stoch4h,
                stoch1d,
                optionalData.lsr,
                optionalData.funding,
                {
                    currentRatio: currentVolumeRatio,
                    sweepRatio: sweep.volumeAtSweep?.toFixed(2) || "N/A",
                    buyRatio: optionalData.taker?.buyRatio,
                    sellRatio: optionalData.taker?.sellRatio
                },
                optionalData.orderbook,
                srData,
                emasData,
                {
                    type: sweep.type,
                    minutesAgo: Math.round((now - sweep.timestamp) / 60000),
                    price: sweep.price,
                    fractalLevel: sweep.fractalLevel,
                    timeframe: sweep.timeframe
                }
            );
            
            alerts.push({
                symbol,
                type: sweep.type,
                message,
                timestamp: now,
                sweepAge: Math.round((now - sweep.timestamp) / 60000),
                sweepTf: sweep.timeframe
            });
            
            if (!alertsCooldown[symbol]) alertsCooldown[symbol] = {};
            if (sweep.type === 'BUY') {
                alertsCooldown[symbol].lastBuyConfirmation = now;
            } else {
                alertsCooldown[symbol].lastSellConfirmation = now;
            }
            
            logToFile(`✅ CONFIRMAÇÃO ${sweep.type} ${symbol} - Sweep ${sweep.timeframe} há ${Math.round((now - sweep.timestamp) / 60000)}min`);
            
        } catch (error) {
            logRejection(symbol, 'erro_conf', { error: error.message });
        }
    }
    
    console.log(`✅ ${alerts.length} confirmações de ${confirmationsChecked} sweeps`);
    
    const marketAnalysis = await analyzeMarket(allData);
    
    return { alerts, marketAnalysis };
}

// ============================================
// CONSTRUIR MENSAGEM DE ALERTA
// ============================================

function buildAlertMessage(isBullish, symbol, price, brDateTime, atrData, 
                          rsi1h, stoch4h, stoch1d, lsr, funding, 
                          volumeData, orderBook, srData, emasData, sweepInfo) {
    
    const title = isBullish ? '🟢<b>COMPRA</b>' : '🔴<b>VENDA</b>';
    const priceFormatted = formatNumber(price, symbol, true);
    const tfEmoji = sweepInfo.timeframe === '15m' ? '⚡' : '📊';
    
    let message = `${title} #${symbol}\n`;
    message += `${brDateTime.time} | $${priceFormatted}\n`;
    message += `${tfEmoji}Sweep ${sweepInfo.type} ${sweepInfo.minutesAgo}min\n`;
    
    if (srData.supportLevels.length > 0) {
        message += `🛡️S1:$${srData.supportLevels[0].formatted} `;
        if (srData.resistanceLevels.length > 0) {
            message += `🧱R1:$${srData.resistanceLevels[0].formatted}\n`;
        } else {
            message += `\n`;
        }
    }
    
    const entryImmediate = isBullish ? price * 0.995 : price * 1.005;
    message += `🎯E:$${formatNumber(entryImmediate, symbol, true)} `;
    message += `⛔S:$${formatNumber(atrData.atr ? (isBullish ? price*(1-Math.min(Math.max(atrData.atrPercent*ATR_MULTIPLIER,MIN_ATR_PERCENTAGE),MAX_ATR_PERCENTAGE)/100) : price*(1+Math.min(Math.max(atrData.atrPercent*ATR_MULTIPLIER,MIN_ATR_PERCENTAGE),MAX_ATR_PERCENTAGE)/100)) : 0, symbol, true)}\n`;
    
    message += `📊RSI${rsi1h.value||'N/A'} V${volumeData.currentRatio}x(SW${volumeData.sweepRatio}x)`;
    if (volumeData.buyRatio) message += ` C${volumeData.buyRatio}%`;
    message += `\n✅by @J4Rviz`;
    
    return message;
}

// ============================================
// FUNÇÕES DE CÁLCULO
// ============================================

function calculateEMAsFromData(candles) {
    if (!candles || candles.length < 55) {
        return {
            currentPrice: null,
            isAboveEMA55: false,
            isBelowEMA55: false,
            isEMA13CrossingUp: false,
            isEMA13CrossingDown: false
        };
    }
    
    try {
        const closes = candles.map(c => c.close);
        const currentPrice = closes[closes.length - 1];
        
        const ema13Values = EMA.calculate({ values: closes, period: 13 });
        const ema34Values = EMA.calculate({ values: closes, period: 34 });
        const ema55Values = EMA.calculate({ values: closes, period: 55 });
        
        if (ema13Values.length < 2 || ema34Values.length < 2) {
            return {
                currentPrice,
                isAboveEMA55: false,
                isBelowEMA55: false,
                isEMA13CrossingUp: false,
                isEMA13CrossingDown: false
            };
        }
        
        const ema13 = ema13Values[ema13Values.length - 1];
        const ema34 = ema34Values[ema34Values.length - 1];
        const ema55 = ema55Values.length > 0 ? ema55Values[ema55Values.length - 1] : null;
        
        const previousEma13 = ema13Values.length >= 2 ? ema13Values[ema13Values.length - 2] : null;
        const previousEma34 = ema34Values.length >= 2 ? ema34Values[ema34Values.length - 2] : null;
        
        const isEMA13CrossingUp = previousEma13 !== null && previousEma34 !== null && 
                                 previousEma13 <= previousEma34 && ema13 > ema34;
        const isEMA13CrossingDown = previousEma13 !== null && previousEma34 !== null && 
                                   previousEma13 >= previousEma34 && ema13 < ema34;
        
        return {
            currentPrice,
            isAboveEMA55: ema55 ? currentPrice > ema55 : false,
            isBelowEMA55: ema55 ? currentPrice < ema55 : false,
            isEMA13CrossingUp,
            isEMA13CrossingDown
        };
        
    } catch (error) {
        return {
            currentPrice: null,
            isAboveEMA55: false,
            isBelowEMA55: false,
            isEMA13CrossingUp: false,
            isEMA13CrossingDown: false
        };
    }
}

function calculateRSIFromData(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
        return { value: null, raw: null };
    }
    
    try {
        const closes = candles.map(c => c.close);
        const rsiValues = RSI.calculate({ values: closes, period });
        
        if (!rsiValues || rsiValues.length === 0) {
            return { value: null, raw: null };
        }
        
        const currentRSI = rsiValues[rsiValues.length - 1];
        return {
            value: currentRSI ? currentRSI.toFixed(2) : null,
            raw: currentRSI
        };
    } catch (error) {
        return { value: null, raw: null };
    }
}

function calculateStochFromData(candles, kPeriod = 5, dPeriod = 3) {
    if (!candles || candles.length < kPeriod + dPeriod + 10) {
        return { k: null, d: null, kDirection: "➡️", dDirection: "➡️" };
    }
    
    try {
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
            return { k: null, d: null, kDirection: "➡️", dDirection: "➡️" };
        }
        
        const current = stochValues[stochValues.length - 1];
        const previous = stochValues[stochValues.length - 2];
        
        const kDirection = current.k > previous.k ? "⬆️" : current.k < previous.k ? "⬇️" : "➡️";
        const dDirection = current.d > previous.d ? "⬆️" : current.d < previous.d ? "⬇️" : "➡️";
        
        return {
            k: current.k ? current.k.toFixed(2) : null,
            d: current.d ? current.d.toFixed(2) : null,
            kDirection,
            dDirection
        };
    } catch (error) {
        return { k: null, d: null, kDirection: "➡️", dDirection: "➡️" };
    }
}

function calculateATRFromData(candles, period = 14) {
    if (!candles || candles.length < period + 1) {
        return { atr: null, atrPercent: null };
    }
    
    try {
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const closes = candles.map(c => c.close);
        
        const atrValues = ATR.calculate({
            high: highs,
            low: lows,
            close: closes,
            period
        });
        
        if (!atrValues || atrValues.length === 0) {
            return { atr: null, atrPercent: null };
        }
        
        const currentATR = atrValues[atrValues.length - 1];
        const currentPrice = closes[closes.length - 1];
        const atrPercent = (currentATR / currentPrice) * 100;
        
        return {
            atr: currentATR,
            atrPercent,
            atrFormatted: currentATR.toFixed(4),
            atrPercentFormatted: atrPercent.toFixed(2),
            price: currentPrice
        };
    } catch (error) {
        return { atr: null, atrPercent: null };
    }
}

async function getSupportResistance(symbol, candles1h) {
    if (srCache.has(symbol)) {
        const cached = srCache.get(symbol);
        if (Date.now() - cached.timestamp < SR_CACHE_TTL) {
            return cached.data;
        }
    }
    
    if (!candles1h || candles1h.length < 200) {
        return { supportLevels: [], resistanceLevels: [] };
    }
    
    try {
        const closes = candles1h.map(c => c.close);
        const highs = candles1h.map(c => c.high);
        const lows = candles1h.map(c => c.low);
        const currentPrice = closes[closes.length - 1];
        
        const priceMap = new Map();
        const tickSize = currentPrice * 0.001;
        
        const roundToTick = (price) => Math.round(price / tickSize) * tickSize;
        
        for (let i = 1; i < candles1h.length - 1; i++) {
            if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) {
                const rounded = roundToTick(highs[i]);
                priceMap.set(rounded, (priceMap.get(rounded) || 0) + 1);
            }
            if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) {
                const rounded = roundToTick(lows[i]);
                priceMap.set(rounded, (priceMap.get(rounded) || 0) + 1);
            }
        }
        
        const clusters = Array.from(priceMap.entries())
            .map(([price, touches]) => ({ price, touches }))
            .filter(c => c.touches >= 2)
            .sort((a, b) => b.touches - a.touches);
        
        const supports = clusters
            .filter(c => c.price < currentPrice)
            .slice(0, 3)
            .map(c => ({
                price: c.price,
                touches: c.touches,
                formatted: formatNumber(c.price, symbol, true)
            }));
        
        const resistances = clusters
            .filter(c => c.price > currentPrice)
            .slice(0, 3)
            .map(c => ({
                price: c.price,
                touches: c.touches,
                formatted: formatNumber(c.price, symbol, true)
            }));
        
        const result = { supportLevels: supports, resistanceLevels: resistances };
        srCache.set(symbol, { data: result, timestamp: Date.now() });
        
        return result;
        
    } catch (error) {
        return { supportLevels: [], resistanceLevels: [] };
    }
}

// ============================================
// FUNÇÕES DE API
// ============================================

async function getCandles(symbol, timeframe, limit) {
    await checkRateLimit();
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
    const res = await fetchWithRetry(url);
    incrementRequestCount(1);
    
    const data = await res.json();
    return data.map(c => ({
        time: c[0],
        open: +c[1],
        high: +c[2],
        low: +c[3],
        close: +c[4],
        volume: +c[5]
    }));
}

async function getTakerVolume(symbol) {
    const url = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=1`;
    const res = await fetchWithRetry(url);
    incrementRequestCount(1);
    
    const data = await res.json();
    
    if (data && data.length > 0) {
        const latest = data[0];
        const buyVolume = parseFloat(latest.buyVol);
        const sellVolume = parseFloat(latest.sellVol);
        const totalVolume = buyVolume + sellVolume;
        const buyRatio = (buyVolume / totalVolume) * 100;
        
        return {
            buyRatio: buyRatio.toFixed(2),
            sellRatio: (100 - buyRatio).toFixed(2)
        };
    }
    return null;
}

async function getLSR(symbol) {
    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${LSR_TIMEFRAME}&limit=1`;
    const res = await fetchWithRetry(url);
    incrementRequestCount(1);
    
    const data = await res.json();
    
    if (data && data.length > 0) {
        const latest = data[0];
        const longAccount = parseFloat(latest.longAccount);
        const shortAccount = parseFloat(latest.shortAccount);
        const lsrRatio = longAccount / shortAccount;
        
        return {
            lsrRatio: lsrRatio.toFixed(4),
            raw: lsrRatio
        };
    }
    return { lsrRatio: "N/A", raw: null };
}

async function getFundingRate(symbol) {
    const url = `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`;
    const res = await fetchWithRetry(url);
    incrementRequestCount(1);
    
    const data = await res.json();
    
    if (data && data.lastFundingRate !== undefined) {
        const rate = parseFloat(data.lastFundingRate) * 100;
        
        let emoji = '';
        if (rate <= -0.2) emoji = '🟢🟢🟢🟢';
        else if (rate <= -0.1) emoji = '🟢🟢🟢';
        else if (rate <= -0.05) emoji = '🟢🟢';
        else if (rate >= 0.1) emoji = '🔴🔴🔴🔴';
        else if (rate >= 0.03) emoji = '🔴🔴🔴';
        else if (rate >= 0.02) emoji = '🔴🔴';
        
        return {
            rate: rate.toFixed(4),
            emoji
        };
    }
    return { rate: "N/A", emoji: "" };
}

async function getOrderBook(symbol) {
    const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=10`;
    const res = await fetchWithRetry(url);
    incrementRequestCount(1);
    
    const data = await res.json();
    
    const bidVolume = data.bids.slice(0, 5).reduce((sum, bid) => sum + +bid[1], 0).toFixed(2);
    const askVolume = data.asks.slice(0, 5).reduce((sum, ask) => sum + +ask[1], 0).toFixed(2);
    
    return { bidVolume, askVolume };
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

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

async function checkRateLimit() {
    const now = Date.now();
    
    if (now - requestWindowStart > REQUEST_WINDOW_MS) {
        requestCount = 0;
        requestWindowStart = now;
    }
    
    if (requestCount >= SAFE_REQUEST_LIMIT) {
        const waitTime = REQUEST_WINDOW_MS - (now - requestWindowStart) + 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return checkRateLimit();
    }
    
    return true;
}

function incrementRequestCount(count = 1) {
    requestCount += count;
}

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.status === 429) {
                const waitTime = 60000;
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return response;
            
        } catch (error) {
            lastError = error;
            
            if (attempt < maxRetries) {
                const delay = 2000 * Math.pow(2, attempt - 1);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    
    throw lastError;
}

function getBrazilianDateTime() {
    const now = new Date();
    const brasiliaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    return {
        date: `${String(brasiliaTime.getDate()).padStart(2,'0')}/${String(brasiliaTime.getMonth()+1).padStart(2,'0')}/${brasiliaTime.getFullYear()}`,
        time: `${String(brasiliaTime.getHours()).padStart(2,'0')}:${String(brasiliaTime.getMinutes()).padStart(2,'0')}`
    };
}

function formatNumber(num, symbol = null) {
    if (num === null || num === undefined || isNaN(num)) return "N/A";
    if (num > 1000) return num.toFixed(2);
    if (num > 1) return num.toFixed(3);
    if (num > 0.1) return num.toFixed(4);
    if (num > 0.01) return num.toFixed(5);
    return num.toFixed(6);
}

function logToFile(message) {
    try {
        const logDir = './logs';
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        
        const timestamp = new Date().toISOString();
        const logFile = path.join(logDir, `bot_${new Date().toISOString().split('T')[0]}.log`);
        fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
    } catch (e) {}
}

async function sendAlert(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'HTML'
            })
        });
        
        if (response.ok) {
            console.log(`✅ Alerta enviado`);
            return true;
        } else {
            console.log(`❌ Falha ao enviar alerta: ${response.status}`);
            return false;
        }
    } catch (e) {
        console.log(`❌ Erro Telegram: ${e.message}`);
        return false;
    }
}

async function fetchAllSymbols() {
    try {
        await checkRateLimit();
        const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
        const res = await fetchWithRetry(url);
        incrementRequestCount(1);
        
        const data = await res.json();
        
        return data.symbols
            .filter(s => s.symbol.endsWith('USDT') && s.status === 'TRADING')
            .map(s => s.symbol)
            .sort();
    } catch (error) {
        return [];
    }
}

// ============================================
// FUNÇÃO DE MENSAGEM DE INICIALIZAÇÃO
// ============================================

async function sendStartupMessage() {
    const brDateTime = getBrazilianDateTime();
    const message = 
        `🤖<b>SMC BOT INICIADO</b>\n` +
        `📅${brDateTime.date} ${brDateTime.time}\n` +
        `📊${ALL_SYMBOLS.length} ativos\n` +
        `⚡Sweep:1h+15m(6h) Vol>${VOLUME_RELATIVE_THRESHOLD}x\n` +
        `🔴Stop ATR:${ATR_MULTIPLIER}x(${MIN_ATR_PERCENTAGE}-${MAX_ATR_PERCENTAGE}%)\n` +
        `✅by @J4Rviz`;
    
    await sendAlert(message);
    console.log('📱 Mensagem de inicialização enviada');
}

// ============================================
// LIMPEZA DE CACHE
// ============================================

function cleanupCycleCache() {
    const now = Date.now();
    let removed = 0;
    
    for (const [symbol, data] of cycleDataCache) {
        const hasActiveSweep = sweepMemory.has(symbol);
        const isRecent = now - data.timestamp < CACHE_CYCLE_TTL * 2;
        
        if (!hasActiveSweep && !isRecent) {
            cycleDataCache.delete(symbol);
            removed++;
        }
    }
    
    if (removed > 0) {
        logToFile(`🧹 Cache: ${removed} entradas removidas`);
    }
}

// ============================================
// LOOP PRINCIPAL
// ============================================

let ALL_SYMBOLS = [];
let lastMarketAnalysisTime = 0;
const MARKET_ANALYSIS_INTERVAL = 60 * 60 * 1000; // 1 hora

async function mainLoop() {
    ALL_SYMBOLS = await fetchAllSymbols();
    if (ALL_SYMBOLS.length === 0) {
        console.log('❌ Nenhum símbolo carregado');
        process.exit(1);
    }
    
    console.log(`\n🤖 Monitorando ${ALL_SYMBOLS.length} ativos`);
    console.log(`⚡ Sweep: 1h+15m (memória ${SWEEP_MEMORY_HOURS}h)`);
    console.log(`📊 Análise de mercado a cada 1h\n`);
    
    await sendStartupMessage();
    
    let cycleCount = 0;
    
    while (true) {
        try {
            cycleCount++;
            console.log(`\n🔄 Ciclo ${cycleCount} - ${new Date().toLocaleTimeString()}`);
            
            const { alerts, marketAnalysis } = await monitorSymbols();
            
            for (const alert of alerts) {
                const tfIcon = alert.sweepTf === '15m' ? '⚡' : '📊';
                console.log(`✅ ${alert.type} ${alert.symbol} ${tfIcon} (${alert.sweepAge}min)`);
                await sendAlert(alert.message);
                await new Promise(r => setTimeout(r, 1000));
            }
            
            const now = Date.now();
            if (now - lastMarketAnalysisTime >= MARKET_ANALYSIS_INTERVAL || cycleCount === 1) {
                const marketMessage = buildMarketAnalysisMessage(marketAnalysis);
                await sendAlert(marketMessage);
                console.log('📊 Análise de mercado enviada');
                lastMarketAnalysisTime = now;
            }
            
            if (cycleCount % SWEEP_CLEANUP_INTERVAL === 0) {
                let removed = 0;
                const sixHoursAgo = Date.now() - SWEEP_MEMORY_MS;
                
                for (const [symbol, sweep] of sweepMemory) {
                    if (sweep.timestamp < sixHoursAgo) {
                        sweepMemory.delete(symbol);
                        removed++;
                    }
                }
                
                if (removed > 0) {
                    console.log(`🧹 Memória: ${removed} sweeps antigos removidos`);
                }
                
                cleanupCycleCache();
            }
            
            const usage = (requestCount / SAFE_REQUEST_LIMIT * 100).toFixed(1);
            console.log(`\n📊 Rate: ${requestCount}/${SAFE_REQUEST_LIMIT} (${usage}%)`);
            console.log(`💾 Sweeps: ${sweepMemory.size}`);
            console.log(`⏱️ Próximo ciclo em 60s...`);
            
            await new Promise(r => setTimeout(r, 60000));
            
        } catch (error) {
            console.log(`❌ Erro: ${error.message}`);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
}

// Iniciar
mainLoop().catch(console.error);
