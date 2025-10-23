require('dotenv').config();
const Binance = require('node-binance-api');
const TelegramBot = require('node-telegram-bot-api');
const ccxt = require('ccxt');

// Configurações
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const binance = new Binance().options({
    'futures': true,
    'APIKEY': process.env.BINANCE_API_KEY,
    'APISECRET': process.env.BINANCE_SECRET,
    'reconnect': true
});

// Inicializa ccxt para Binance Futures
const binanceCCXT = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET,
    enableRateLimit: true,
    options: { defaultType: 'future' }
});

// Inicializa Telegram Bot com polling
let telegramBot;
if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('✅ Telegram Bot conectado com polling!');
} else {
    console.log('⚠️ Configurações do Telegram não encontradas. Mensagens só no console.');
}

// Configurações para listagens/deslistagens
let allUsdtSymbols = [];
let initialSymbols = new Set();

// Cache para suporte/resistência, RSI e MACD com expiração (1 hora)
const srCache = new Map();
const rsiCache = new Map();
const macdCache = new Map();
const CACHE_EXPIRY = 60 * 60 * 1000; // 1 hora em ms

// Função para limpar cache expirado
function clearExpiredCache() {
    const now = Date.now();
    for (const [key, { timestamp }] of rsiCache) {
        if (now - timestamp > CACHE_EXPIRY) rsiCache.delete(key);
    }
    for (const [key, { timestamp }] of macdCache) {
        if (now - timestamp > CACHE_EXPIRY) macdCache.delete(key);
    }
    for (const [key, { timestamp }] of srCache) {
        if (now - timestamp > CACHE_EXPIRY) srCache.delete(key);
    }
}

// Função para tentar novamente chamadas à API
async function retryApiCall(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i < retries - 1) {
                console.log(`⚠️ Tentativa ${i + 1} falhou, tentando novamente em ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

// 🔥 SUPORTE/RESISTÊNCIA
async function getSupportResistance(symbol, timeframe = '1m', limit = 100) {
    try {
        const cacheKey = `${symbol}_${timeframe}`;
        if (srCache.has(cacheKey) && Date.now() - srCache.get(cacheKey).timestamp < CACHE_EXPIRY) {
            return srCache.get(cacheKey).data;
        }

        // MÉTODO 1: Tenta velas do timeframe especificado
        try {
            const klines = await retryApiCall(() => binance.futuresCandles(symbol, timeframe, { limit }));
            if (klines && klines.length >= 50) {
                const validLows = klines.map(k => parseFloat(k[3])).filter(v => !isNaN(v) && v > 0);
                const validHighs = klines.map(k => parseFloat(k[2])).filter(v => !isNaN(v) && v > 0);
                
                if (validLows.length >= 20 && validHighs.length >= 20) {
                    const support = Math.min(...validLows);
                    const resistance = Math.max(...validHighs);
                    
                    const breakoutHigh = (resistance * 1.002).toFixed(2);
                    const breakoutLow = (support * 0.998).toFixed(2);
                    
                    const result = {
                        support: support.toFixed(2),
                        resistance: resistance.toFixed(2),
                        breakoutHigh: breakoutHigh,
                        breakoutLow: breakoutLow,
                        method: `${limit}_velas_${timeframe}`
                    };
                    
                    srCache.set(cacheKey, { data: result, timestamp: Date.now() });
                    console.log(`✅ S/R ${symbol} (${timeframe}): 🛡️ ${result.support} | 📈 ${result.resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                    return result;
                }
            }
        } catch (klineError) {
            console.log(`⚠️ Klines falhou ${symbol} (${timeframe}), método 2...`);
        }
        
        // MÉTODO 2: 24hr ticker
        try {
            const ticker24hr = await retryApiCall(() => binance.futures24hrPriceChange());
            const tickerData = ticker24hr.find(t => t.symbol === symbol);
            
            if (tickerData) {
                const low24h = parseFloat(tickerData.lowPrice);
                const high24h = parseFloat(tickerData.highPrice);
                
                const breakoutHigh = (high24h * 1.003).toFixed(2);
                const breakoutLow = (low24h * 0.997).toFixed(2);
                
                const result = {
                    support: (low24h * 0.999).toFixed(2),
                    resistance: (high24h * 1.001).toFixed(2),
                    breakoutHigh: breakoutHigh,
                    breakoutLow: breakoutLow,
                    method: '24hr_ticker'
                };
                
                srCache.set(cacheKey, { data: result, timestamp: Date.now() });
                console.log(`✅ S/R ${symbol} (24hr): 🛡️ ${result.support} | 📈 ${result.resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                return result;
            }
        } catch (tickerError) {
            console.log(`⚠️ 24hr ticker falhou ${symbol}, método 3...`);
        }
        
        // MÉTODO 3: Apenas preço atual
        try {
            const prices = await retryApiCall(() => binance.futuresPrices());
            const currentPrice = parseFloat(prices[symbol]);
            
            if (currentPrice > 0) {
                const support = (currentPrice * 0.995).toFixed(2);
                const resistance = (currentPrice * 1.005).toFixed(2);
                const breakoutHigh = (currentPrice * 1.008).toFixed(2);
                const breakoutLow = (currentPrice * 0.992).toFixed(2);
                
                const result = {
                    support: support,
                    resistance: resistance,
                    breakoutHigh: breakoutHigh,
                    breakoutLow: breakoutLow,
                    method: 'current_price'
                };
                
                srCache.set(cacheKey, { data: result, timestamp: Date.now() });
                console.log(`✅ S/R ${symbol} (preço): 🛡️ ${support} | 📈 ${resistance} | 📈🔥 ${breakoutHigh} | 🛠️🔥 ${breakoutLow}`);
                return result;
            }
        } catch (priceError) {
            console.log(`❌ Todas APIs falharam ${symbol}`);
        }
        
        return null;
        
    } catch (error) {
        console.log(`❌ Erro S/R ${symbol}:`, error.message);
        return null;
    }
}

// Função para calcular média móvel (usada para determinar tendências)
async function getMovingAverage(symbol, timeframe, period) {
    try {
        const klines = await retryApiCall(() => binance.futuresCandles(symbol, timeframe, { limit: period + 1 }));
        const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length >= period) {
            const sum = closes.reduce((a, b) => a + b, 0);
            return (sum / closes.length).toFixed(2);
        }
        console.log(`⚠️ Dados insuficientes para MA ${symbol} (${timeframe}): ${closes.length}/${period} velas`);
        return null;
    } catch (error) {
        console.log(`❌ Erro ao calcular MA ${symbol} (${timeframe}):`, error.message);
        return null;
    }
}

// Função para calcular RSI (14 períodos)
async function getRSI(symbol, timeframe, period = 14) {
    const cacheKey = `${symbol}_${timeframe}_rsi`;
    if (rsiCache.has(cacheKey) && Date.now() - rsiCache.get(cacheKey).timestamp < CACHE_EXPIRY) {
        return rsiCache.get(cacheKey).data;
    }

    const timeframes = [timeframe, timeframe === '15m' ? '1h' : timeframe === '1h' ? '4h' : '1d'];
    for (const tf of timeframes) {
        try {
            const klines = await retryApiCall(() => binance.futuresCandles(symbol, tf, { limit: 100 }));
            const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
            if (closes.length < period + 1) {
                console.log(`⚠️ Dados insuficientes para RSI ${symbol} (${tf}): ${closes.length}/${period + 1} velas`);
                continue;
            }

            let gains = 0, losses = 0;
            for (let i = 1; i < closes.length; i++) {
                const change = closes[i] - closes[i - 1];
                if (change > 0) gains += change;
                else losses -= change;
            }
            const avgGain = gains / period;
            const avgLoss = losses / period;
            const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
            const rsi = rs === Infinity ? 100 : 100 - (100 / (1 + rs));

            const result = {
                value: rsi.toFixed(2),
                status: rsi > 70 ? 'sobrecomprado' : rsi < 30 ? 'sobrevendido' : 'neutro',
                timeframeUsed: tf
            };

            rsiCache.set(cacheKey, { data: result, timestamp: Date.now() });
            console.log(`✅ RSI ${symbol} (${tf}): ${result.value} (${result.status})`);
            return result;
        } catch (error) {
            console.log(`❌ Erro ao calcular RSI ${symbol} (${tf}):`, error.message);
        }
    }

    // Tenta com ccxt como última alternativa
    try {
        const ohlcv = await retryApiCall(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, 100));
        const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < period + 1) {
            console.log(`⚠️ Dados insuficientes para RSI ${symbol} (${timeframe}) via ccxt: ${closes.length}/${period + 1} velas`);
            return null;
        }

        let gains = 0, losses = 0;
        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        const rsi = rs === Infinity ? 100 : 100 - (100 / (1 + rs));

        const result = {
            value: rsi.toFixed(2),
            status: rsi > 70 ? 'sobrecomprado' : rsi < 30 ? 'sobrevendido' : 'neutro',
            timeframeUsed: timeframe
        };

        rsiCache.set(cacheKey, { data: result, timestamp: Date.now() });
        console.log(`✅ RSI ${symbol} (${timeframe}) via ccxt: ${result.value} (${result.status})`);
        return result;
    } catch (error) {
        console.log(`❌ Erro ao calcular RSI ${symbol} (${timeframe}) via ccxt:`, error.message);
        return null;
    }
}

// Função para calcular MACD (12, 26, 9)
async function getMACD(symbol, timeframe) {
    const cacheKey = `${symbol}_${timeframe}_macd`;
    if (macdCache.has(cacheKey) && Date.now() - macdCache.get(cacheKey).timestamp < CACHE_EXPIRY) {
        return macdCache.get(cacheKey).data;
    }

    const timeframes = [timeframe, timeframe === '15m' ? '1h' : timeframe === '1h' ? '4h' : '1d'];
    for (const tf of timeframes) {
        try {
            const klines = await retryApiCall(() => binance.futuresCandles(symbol, tf, { limit: 100 }));
            const closes = klines.map(k => parseFloat(k[4])).filter(v => !isNaN(v) && v > 0);
            if (closes.length < 35) {
                console.log(`⚠️ Dados insuficientes para MACD ${symbol} (${tf}): ${closes.length}/35 velas`);
                continue;
            }

            const calculateEMA = (prices, period) => {
                const k = 2 / (period + 1);
                let ema = prices[0];
                const emaArray = [ema];
                for (let i = 1; i < prices.length; i++) {
                    ema = prices[i] * k + ema * (1 - k);
                    emaArray.push(ema);
                }
                return emaArray;
            };

            const ema12 = calculateEMA(closes, 12);
            const ema26 = calculateEMA(closes, 26);
            const macdLine = ema12.slice(-9).map((ema12, i) => ema12 - ema26[ema26.length - 9 + i]);
            const signalLine = calculateEMA(macdLine, 9);
            const latestMACD = macdLine[macdLine.length - 1];
            const latestSignal = signalLine[signalLine.length - 1];
            const histogram = latestMACD - latestSignal;

            const result = {
                macd: latestMACD.toFixed(2),
                signal: latestSignal.toFixed(2),
                histogram: histogram.toFixed(2),
                status: histogram > 0 ? 'bullish' : 'bearish',
                timeframeUsed: tf
            };

            macdCache.set(cacheKey, { data: result, timestamp: Date.now() });
            console.log(`✅ MACD ${symbol} (${tf}): ${result.status}, histograma ${result.histogram}`);
            return result;
        } catch (error) {
            console.log(`❌ Erro ao calcular MACD ${symbol} (${tf}):`, error.message);
        }
    }

    // Tenta com ccxt como última alternativa
    try {
        const ohlcv = await retryApiCall(() => binanceCCXT.fetchOHLCV(symbol, timeframe, undefined, 100));
        const closes = ohlcv.map(c => parseFloat(c[4])).filter(v => !isNaN(v) && v > 0);
        if (closes.length < 35) {
            console.log(`⚠️ Dados insuficientes para MACD ${symbol} (${timeframe}) via ccxt: ${closes.length}/35 velas`);
            return null;
        }

        const calculateEMA = (prices, period) => {
            const k = 2 / (period + 1);
            let ema = prices[0];
            const emaArray = [ema];
            for (let i = 1; i < prices.length; i++) {
                ema = prices[i] * k + ema * (1 - k);
                emaArray.push(ema);
            }
            return emaArray;
        };

        const ema12 = calculateEMA(closes, 12);
        const ema26 = calculateEMA(closes, 26);
        const macdLine = ema12.slice(-9).map((ema12, i) => ema12 - ema26[ema26.length - 9 + i]);
        const signalLine = calculateEMA(macdLine, 9);
        const latestMACD = macdLine[macdLine.length - 1];
        const latestSignal = signalLine[signalLine.length - 1];
        const histogram = latestMACD - latestSignal;

        const result = {
            macd: latestMACD.toFixed(2),
            signal: latestSignal.toFixed(2),
            histogram: histogram.toFixed(2),
            status: histogram > 0 ? 'bullish' : 'bearish',
            timeframeUsed: timeframe
        };

        macdCache.set(cacheKey, { data: result, timestamp: Date.now() });
        console.log(`✅ MACD ${symbol} (${timeframe}) via ccxt: ${result.status}, histograma ${result.histogram}`);
        return result;
    } catch (error) {
        console.log(`❌ Erro ao calcular MACD ${symbol} (${timeframe}) via ccxt:`, error.message);
        return null;
    }
}

// Mapeamento de símbolos para nomes completos das moedas
const coinNames = {
    'BTCUSDT': 'Bitcoin',
    'ADAUSDT': 'Cardano',
    'ETHUSDT': 'Ethereum',
    'BNBUSDT': 'Binance Coin',
    'XRPUSDT': 'XRP'
};

// Função genérica para análise de qualquer par
async function analyzePair(symbol) {
    const now = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // Obter nome da moeda
    const coinName = coinNames[symbol] || symbol.replace('USDT', '');

    try {
        // Verificar se o par existe
        const prices = await retryApiCall(() => binance.futuresPrices());
        if (!prices[symbol]) {
            throw new Error(`Par ${symbol} não encontrado na Binance Futures`);
        }

        // Obter preço atual
        const currentPrice = parseFloat(prices[symbol]).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

        // Limpar cache expirado
        clearExpiredCache();

        // Obter suportes e resistências para diferentes timeframes
        const weeklySR = await getSupportResistance(symbol, '1w', 100);
        const fourHourSR = await getSupportResistance(symbol, '4h', 100);
        const oneHourSR = await getSupportResistance(symbol, '1h', 100);
        const fifteenMinSR = await getSupportResistance(symbol, '15m', 100);

        // Calcular médias móveis para avaliar tendências
        const maWeekly = await getMovingAverage(symbol, '1w', 20);
        const maFourHour = await getMovingAverage(symbol, '4h', 20);
        const maOneHour = await getMovingAverage(symbol, '1h', 20);
        const maFifteenMin = await getMovingAverage(symbol, '15m', 20);

        // Calcular RSI e MACD para cada timeframe
        const rsiWeekly = await getRSI(symbol, '1w');
        const rsiFourHour = await getRSI(symbol, '4h');
        const rsiOneHour = await getRSI(symbol, '1h');
        const rsiFifteenMin = await getRSI(symbol, '15m');

        const macdWeekly = await getMACD(symbol, '1w');
        const macdFourHour = await getMACD(symbol, '4h');
        const macdOneHour = await getMACD(symbol, '1h');
        const macdFifteenMin = await getMACD(symbol, '15m');

        // Determinar tendências com base nas médias móveis
        const currentPriceFloat = parseFloat(prices[symbol]);
        const isWeeklyBullish = maWeekly && currentPriceFloat > parseFloat(maWeekly);
        const isFourHourBullish = maFourHour && currentPriceFloat > parseFloat(maFourHour);
        const isOneHourBullish = maOneHour && currentPriceFloat > parseFloat(maOneHour);
        const isFifteenMinBullish = maFifteenMin && currentPriceFloat > parseFloat(maFifteenMin);

        // Construir resumo com base em RSI e MACD
        const isOverbought = [rsiWeekly, rsiFourHour, rsiOneHour, rsiFifteenMin].some(rsi => rsi && rsi.status === 'sobrecomprado');
        const isOversold = [rsiWeekly, rsiFourHour, rsiOneHour, rsiFifteenMin].some(rsi => rsi && rsi.status === 'sobrevendido');
        const sentiment = isOverbought ? 'requer cautela (sobrecompra)' : isOversold ? 'indica oportunidade (sobrevenda)' : 'sugere equilíbrio';

        // Construir a análise com tom humanizado, elegante e resumido
        let analysis = `🤖 *Titanium: Análise ${symbol} (${coinName})*\n\n`;
        analysis += `**Data**: *${now}* (Horário de Brasília)\n\n`;
        analysis += `**Preço Atual**: *${currentPrice}*\n\n`;
        analysis += `---\n`;
        analysis += `#### 📈 Resumo do Mercado\n`;
        analysis += `${coinName} mostra ${isWeeklyBullish ? "força de longo prazo (acumulação, Wyckoff)" : "consolidação ou redistribuição"} e ${isFourHourBullish ? "momentum de alta no médio prazo" : "correção no médio prazo"}. Sentimento: ${sentiment}.\n\n`;
        analysis += `---\n`;
        analysis += `#### 🔍 Análise Técnica\n`;
        analysis += `- **Longo Prazo (Semanal)**: ${isWeeklyBullish ? "Tendência de alta (onda 3, Elliott)" : "Consolidação (fase B/C, Wyckoff)"}. RSI: ${rsiWeekly?.value || 'indisponível'} (${rsiWeekly?.status || 'neutro'}). MACD: ${macdWeekly?.status === 'bullish' ? 'alta' : 'baixa'}.\n`;
        analysis += `- **Médio Prazo (4h)**: ${isFourHourBullish ? "Alta (sign of strength)" : "Correção ou lateral"}. Suporte: *$${fourHourSR?.support || 'indefinido'}*. Resistência: *$${fourHourSR?.resistance || 'indefinido'}*.\n`;
        analysis += `- **Curto Prazo (1h)**: ${isOneHourBullish ? "Recuperação inicial" : "Indecisão"}. RSI: ${rsiOneHour?.value || 'indisponível'} (${rsiOneHour?.status || 'neutro'}).\n`;
        analysis += `- **Intraday (15min)**: ${isFifteenMinBullish ? "Alta ou lateral" : "Queda ou lateral"}. MACD: ${macdFifteenMin?.status === 'bullish' ? 'alta' : 'baixa'}.\n\n`;
        analysis += `---\n`;
        analysis += `#### 📊 Níveis Críticos\n`;
        analysis += `- *Resistências*: $${oneHourSR?.resistance || 'indefinido'} (curto prazo), $${weeklySR?.resistance || 'indefinido'} (longo prazo).\n`;
        analysis += `- *Suportes*: $${oneHourSR?.support || 'indefinido'} (curto prazo), $${fourHourSR?.support || 'indefinido'} (médio prazo).\n\n`;
        analysis += `---\n`;
        analysis += `#### ⏳ Cenário Provável\n`;
        analysis += `Preço pode testar *$${oneHourSR?.resistance || 'níveis superiores'}*. Sem rompimento, busca suporte em *$${fourHourSR?.support || 'níveis inferiores'}*. Rompimento de *$${weeklySR?.resistance || 'indefinido'}* sugere onda 3 (Elliott); quebra de *$${weeklySR?.support || 'indefinido'}* indica correção (onda A/B).\n\n`;
        analysis += `---\n`;
        analysis += `#### ⛔ Invalidação\n`;
        analysis += `- Queda abaixo de *$${oneHourSR?.support || 'suporte de curto prazo'}* (4h) enfraquece o cenário.\n`;
        analysis += `- Quebra de *$${weeklySR?.support || 'suporte de longo prazo'}* (semanal) sugere redistribuição (Wyckoff).\n\n`;
        analysis += `**✅ Nota**: Monitore volume e rompimentos. Gerencie o risco com disciplina.\n\n`;
        analysis += `⏰ *${now}*`;

        await sendTelegramMessage(analysis);
        console.log(`📊 Análise  ${symbol} (${coinName}) enviada às ${now}`);
    } catch (error) {
        console.error(`❌ Erro na análise de ${symbol}:`, error.message);
        const message = `⚠️ *Erro na Análise de ${symbol} (${coinName})*\nNão foi possível gerar a análise.\nMotivo: ${error.message}\n⏰ *${now}*`;
        await sendTelegramMessage(message);
    }
}

// Função para enviar mensagem no Telegram
async function sendTelegramMessage(message) {
    if (!telegramBot) {
        console.log(message);
        return;
    }
    
    try {
        await telegramBot.sendMessage(TELEGRAM_CHAT_ID, message, {
            parse_mode: 'Markdown'
        });
        console.log('📱 Mensagem enviada!');
    } catch (error) {
        console.error('❌ Erro Telegram:', error.message);
        console.log(message);
    }
}

// Busca símbolos USDT
async function fetchAllUsdtSymbols() {
    try {
        const exchangeInfo = await retryApiCall(() => binance.futuresExchangeInfo());
        const usdtSymbols = exchangeInfo.symbols
            .filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map(s => s.symbol)
            .sort();
        return usdtSymbols;
    } catch (error) {
        console.error('❌ Erro ao buscar símbolos USDT:', error.message);
        return [];
    }
}

// Listagens/deslistagens
async function checkListingsDelistings() {
    const currentSymbols = await fetchAllUsdtSymbols();
    
    if (initialSymbols.size === 0) {
        currentSymbols.forEach(symbol => initialSymbols.add(symbol));
        allUsdtSymbols = currentSymbols;
        console.log(`📊 Lista inicial: ${initialSymbols.size} pares USDT carregados.`);
        return;
    }
    
    const newSymbols = currentSymbols.filter(symbol => !initialSymbols.has(symbol));
    
    if (newSymbols.length > 0) {
        newSymbols.forEach(async (symbol) => {
            const now = new Date().toLocaleString('pt-BR', { 
                timeZone: 'America/Sao_Paulo',
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const message = `⚠️ *Nova Listagem ⚠️ Binance Futures:*\n\n\`${symbol}\`\n\n⏰ *${now}*`;
            await sendTelegramMessage(message);
        });
        console.log(`🆕 ${newSymbols.length} NOVA(S) LISTAGEM(ÕES)!`);
    }
    
    initialSymbols = new Set(currentSymbols);
    allUsdtSymbols = currentSymbols;
}

// Inicia monitoramento
async function startMonitoring() {
    console.log('🔍 Iniciando MONITORAMENTO DE LISTAGENS/DESLISTAGENS + ANÁLISE HORÁRIA BTCUSDT!');
    console.log('📊 APIs usadas: futuresCandles, futures24hrPriceChange, futuresPrices, ccxt.fetchOHLCV');
    console.log('📈 Indicadores: SMA, RSI, MACD');
    console.log('📅 Análise horária de BTCUSDT: ATIVADA');
    
    await checkListingsDelistings();
    setInterval(checkListingsDelistings, 30000);
    
    // Inicia análise horária de BTCUSDT
    await analyzePair('BTCUSDT');
    setInterval(() => analyzePair('BTCUSDT'), 60 * 60 * 1000);
    
    // Limpa cache periodicamente
    setInterval(clearExpiredCache, CACHE_EXPIRY);
}

// Lida com encerramento gracioso
process.on('SIGINT', () => {
    console.log('\n👋 Parando monitor...');
    console.log(`📊 Total pares USDT: ${allUsdtSymbols.length}`);
    process.exit(0);
});

if (!TELEGRAM_BOT_TOKEN) console.log('⚠️ TELEGRAM_BOT_TOKEN não encontrado');
if (!TELEGRAM_CHAT_ID) console.log('⚠️ TELEGRAM_CHAT_ID não encontrado');

startMonitoring();
