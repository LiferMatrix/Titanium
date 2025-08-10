require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,ENJUSDT").split(","),
  CACHE_TTL: 5 * 60 * 1000, // 5 minutos
};

// ================= LOGGER ================= //
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ],
});

// ================= CACHE ================= //
const cache = {
  ohlcv15m: {},
  ohlcv1h: {},
  ohlcv3m: {},
  ticker: {},
  lsr: {},
  fundingRate: {},
  ttl: config.CACHE_TTL,
};

// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 3, delayBase = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) {
        logger.warn(`Falha após ${retries} tentativas: ${e.message}`);
        throw e;
      }
      const delay = Math.pow(2, attempt - 1) * delayBase;
      logger.info(`Tentativa ${attempt} falhou, retry após ${delay}ms: ${e.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function getCachedData(key, symbol) {
  const cacheKey = `${key}_${symbol}`;
  const cacheEntry = cache[key][symbol];
  if (cacheEntry && Date.now() - cacheEntry.timestamp < cache.ttl && cacheEntry.data?.value !== null) {
    logger.info(`Usando cache para ${cacheKey}`);
    return cacheEntry.data;
  }
  return null;
}

function setCachedData(key, symbol, data) {
  const cacheKey = `${key}_${symbol}`;
  cache[key][symbol] = { data, timestamp: Date.now() };
}

// Função para buscar LSR usando a API de futuros da Binance
async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData('lsr', symbol);
  if (cached) return cached;
  try {
    const symbolWithoutSlash = symbol.replace('/', '');
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbolWithoutSlash, period: '5m', limit: 2 }
    }));
    if (!res.data || res.data.length < 2) {
      logger.warn(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return { value: null, error: 'Dados insuficientes', isRising: false, percentChange: '0.00' };
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const previousLSR = parseFloat(res.data[1].longShortRatio);
    if (isNaN(currentLSR) || currentLSR < 0 || isNaN(previousLSR) || previousLSR < 0) {
      logger.warn(`LSR inválido para ${symbol}`);
      return { value: null, error: 'LSR inválido', isRising: false, percentChange: '0.00' };
    }
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, isRising: currentLSR > previousLSR, percentChange };
    setCachedData('lsr', symbol, result);
    logger.info(`LSR obtido para ${symbol}: ${currentLSR}, variação: ${percentChange}%`);
    return result;
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return { value: null, error: `Erro ao buscar LSR: ${e.message}`, isRising: false, percentChange: '0.00' };
  }
}

// ================= INICIALIZAÇÃO ================= //
const binance = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  options: { defaultType: 'spot' }
});
const binanceFutures = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  options: { defaultType: 'future', defaultSubType: 'linear' }
});
const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Parâmetros do CCI, EMAs, RSI, Suporte/Resistência, ATR
const cciLength = 20;
const emaShortLength = 5;
const emaLongLength = 13;
const emaPriceLength = 9; // Novo parâmetro para EMA de 9 períodos
const rsiLength = 14;
const supportResistanceLength = 20;
const atrLength = 14;
const timeframe15m = '15m';
const timeframe1h = '1h';
const timeframe3m = '3m';
const volumeLookback = 20;
const volumeMultiplier = 2;
const minVolatility = 0.001;

// Estado para rastrear o último sinal enviado
const lastSignals = {};

// ================= FUNÇÕES DE CÁLCULO ================= //
function calculateCCI(ohlcv) {
  const typicalPrices = ohlcv.map(candle => (candle[2] + candle[3] + candle[4]) / 3);
  const cci = TechnicalIndicators.CCI.calculate({
    high: ohlcv.map(c => c[2]),
    low: ohlcv.map(c => c[3]),
    close: ohlcv.map(c => c[4]),
    period: cciLength,
  });
  return cci;
}

function calculateEMA(data, period) {
  return TechnicalIndicators.EMA.calculate({ period, values: data });
}

function calculateRSI(ohlcv, period = rsiLength) {
  const rsi = TechnicalIndicators.RSI.calculate({
    values: ohlcv.map(c => c[4]),
    period,
  });
  return rsi;
}

function calculateSupportResistance(ohlcv, period = supportResistanceLength) {
  const recentCandles = ohlcv.slice(-period);
  const highs = recentCandles.map(c => c[2]);
  const lows = recentCandles.map(c => c[3]);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  return { support, resistance };
}

function calculateATR(ohlcv, period = atrLength) {
  const atr = TechnicalIndicators.ATR.calculate({
    high: ohlcv.map(c => c[2]),
    low: ohlcv.map(c => c[3]),
    close: ohlcv.map(c => c[4]),
    period,
  });
  return atr;
}

function calculateVolumeAnomaly(ohlcv, lookback = volumeLookback) {
  const volumes = ohlcv.slice(-lookback).map(c => c[5]);
  const avgVolume = volumes.slice(0, -1).reduce((sum, vol) => sum + vol, 0) / (lookback - 1);
  const currentVolume = volumes[volumes.length - 1];
  return currentVolume > avgVolume * volumeMultiplier;
}

// ================= MONITORAMENTO INDIVIDUAL ================= //
async function monitorPair(symbol) {
  const symbolWithSlash = symbol.replace('USDT', '/USDT');
  try {
    logger.info(`Verificando ${symbol} (${symbolWithSlash})...`);

    // Buscar dados em paralelo
    const [ohlcv15m, ohlcv1h, ohlcv3m, ticker, lsr, fundingRate] = await Promise.all([
      withRetry(() => binance.fetchOHLCV(symbolWithSlash, timeframe15m, undefined, Math.max(cciLength + emaLongLength, supportResistanceLength, atrLength, emaPriceLength))
        .then(data => { setCachedData('ohlcv15m', symbol, data); return data; })),
      withRetry(() => binance.fetchOHLCV(symbolWithSlash, timeframe1h, undefined, rsiLength + 1)
        .then(data => { setCachedData('ohlcv1h', symbol, data); return data; })),
      withRetry(() => binance.fetchOHLCV(symbolWithSlash, timeframe3m, undefined, volumeLookback)
        .then(data => { setCachedData('ohlcv3m', symbol, data); return data; })),
      withRetry(() => binance.fetchTicker(symbolWithSlash)
        .then(data => { setCachedData('ticker', symbol, data); return data; })),
      fetchLSR(symbolWithSlash),
      withRetry(() => binanceFutures.fetchFundingRate(symbolWithSlash)
        .then(data => { setCachedData('fundingRate', symbol, { current: data.fundingRate || null, isRising: data.fundingRate > 0 }); return { current: data.fundingRate || null, isRising: data.fundingRate > 0 }; }))
    ]);

    // Validações
    if (!ohlcv15m || ohlcv15m.length < Math.max(cciLength + emaLongLength, supportResistanceLength, atrLength, emaPriceLength)) {
      logger.warn(`Dados insuficientes para ${symbol} (15m)`);
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `⚠️ Dados insuficientes para ${symbol} (15m).`);
      return;
    }
    if (!ohlcv1h || ohlcv1h.length < rsiLength) {
      logger.warn(`Dados insuficientes para ${symbol} (1h)`);
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `⚠️ Dados insuficientes para ${symbol} (1h).`);
      return;
    }
    if (!ohlcv3m || ohlcv3m.length < volumeLookback) {
      logger.warn(`Dados insuficientes para ${symbol} (3m)`);
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `⚠️ Dados insuficientes para ${symbol} (3m).`);
      return;
    }
    if (!ticker || ticker.last === undefined) {
      logger.warn(`Preço não disponível para ${symbol}`);
      return;
    }

    // Verificar se houve erro no LSR
    if (lsr.error) {
      logger.warn(`Não foi possível obter LSR para ${symbol}: ${lsr.error}`);
      return;
    }

    // Calcular CCI (15m)
    const cci = calculateCCI(ohlcv15m);
    if (!cci || cci.length < 2) {
      logger.warn(`CCI não calculado para ${symbol} (15m)`);
      return;
    }

    // Calcular RSI para 15m e 1h
    const rsi15m = calculateRSI(ohlcv15m);
    const rsi1h = calculateRSI(ohlcv1h);
    if (!rsi15m || rsi15m.length < 2 || !rsi1h || rsi1h.length < 1) {
      logger.warn(`RSI não calculado para ${symbol}`);
      return;
    }

    // Calcular EMAs sobre CCI (15m)
    const emaShort = calculateEMA(cci, emaShortLength);
    const emaLong = calculateEMA(cci, emaLongLength);
    if (emaShort.length < 2 || emaLong.length < 2) {
      logger.warn(`EMAs não calculadas para ${symbol}`);
      return;
    }

    // Calcular EMA de 9 períodos sobre o preço de fechamento (15m)
    const emaPrice = calculateEMA(ohlcv15m.map(c => c[4]), emaPriceLength);
    if (!emaPrice || emaPrice.length < 1) {
      logger.warn(`EMA de preço (9 períodos) não calculada para ${symbol}`);
      return;
    }

    // Calcular Suporte e Resistência (15m)
    const { support, resistance } = calculateSupportResistance(ohlcv15m);

    // Calcular ATR (15m)
    const atr = calculateATR(ohlcv15m);
    if (!atr || atr.length < 1) {
      logger.warn(`ATR não calculado para ${symbol} (15m)`);
      return;
    }

    // Calcular Volume Anormal (3m)
    const isVolumeAnomaly = calculateVolumeAnomaly(ohlcv3m);

    // Verificar Volatilidade Mínima
    const price = parseFloat(ticker.last);
    const atrValue = atr[atr.length - 1];
    const isMinVolatility = atrValue / price >= minVolatility;

    const emaShortCurrent = emaShort[emaShort.length - 1];
    const emaShortPrevious = emaShort[emaShort.length - 2];
    const emaLongCurrent = emaLong[emaLong.length - 1];
    const emaLongPrevious = emaLong[emaLong.length - 2];
    const rsi15mCurrent = rsi15m[rsi15m.length - 1];
    const rsi15mPrevious = rsi15m[rsi15m.length - 2];
    const emaPriceCurrent = emaPrice[emaPrice.length - 1];
    const currentClose = ohlcv15m[ohlcv15m.length - 1][4];

    // Verificar cruzamentos e condições de RSI
    const crossover = emaShortPrevious <= emaLongPrevious && emaShortCurrent > emaLongCurrent;
    const crossunder = emaShortPrevious >= emaLongPrevious && emaShortCurrent < emaLongCurrent;
    const rsiRising = rsi15mCurrent > rsi15mPrevious;
    const rsiFalling = rsi15mCurrent < rsi15mPrevious;

    const cciValue = cci[cci.length - 1].toFixed(2);
    const rsi15mValue = rsi15mCurrent.toFixed(2);
    const rsi1hValue = rsi1h[rsi1h.length - 1].toFixed(2);
    const supportValue = support.toFixed(8);
    const resistanceValue = resistance.toFixed(8);
    const atrValueFormatted = atrValue.toFixed(8);
    const priceFormatted = price.toFixed(8);

    // Definir alvos e stop loss
    const tp1 = (parseFloat(price) + parseFloat(atrValue)).toFixed(8);
    const tp2 = (parseFloat(price) + 2 * parseFloat(atrValue)).toFixed(8);
    const tp3 = (parseFloat(price) + 3 * parseFloat(atrValue)).toFixed(8);
    const slBuy = (parseFloat(price) - 2.7 * parseFloat(atrValue)).toFixed(8);
    const tp1Sell = (parseFloat(price) - parseFloat(atrValue)).toFixed(8);
    const tp2Sell = (parseFloat(price) - 2 * parseFloat(atrValue)).toFixed(8);
    const tp3Sell = (parseFloat(price) - 3 * parseFloat(atrValue)).toFixed(8);
    const slSell = (parseFloat(price) + 2.7 * parseFloat(atrValue)).toFixed(8);

    // Definir emoji para RSI de 1h
    const rsi1hEmoji = rsi1hValue < 50 ? '🟢' : rsi1hValue > 70 ? '🔴' : '';

    // Definir LSR Symbol e texto com variação
    let lsrSymbol = '🔘 Consol.';
    let lsrText = lsr.value !== null ? `${lsr.value.toFixed(2)} (${lsr.percentChange}%)` : '🔹 Indisp.';
    if (lsr.value !== null) {
      if (lsr.value <= 1.4) lsrSymbol = '✅ Baixo';
      else if (lsr.value >= 2.8) lsrSymbol = '📛 Alto';
    }

    // Definir Funding Rate Emoji
    let fundingRateEmoji = '';
    let fundingRateText = '🔹 Indisp.';
    if (fundingRate.current !== null) {
      if (fundingRate.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
      else if (fundingRate.current <= -0.001) fundingRateEmoji = '🟢🟢';
      else if (fundingRate.current <= -0.0005) fundingRateEmoji = '🟢';
      else if (fundingRate.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
      else if (fundingRate.current >= 0.0003) fundingRateEmoji = '🔴🔴';
      else if (fundingRate.current >= 0.0002) fundingRateEmoji = '🔴';
      else fundingRateEmoji = '🟢';
      fundingRateText = `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}`;
    }

    // Enviar alertas com critério de RSI, alvos, stop loss, LSR, Funding Rate e EMA de preço
    if (crossover && rsi1hValue < 55 && rsiRising && isVolumeAnomaly && isMinVolatility && currentClose > emaPriceCurrent && lastSignals[symbol] !== 'COMPRA') {
      const message = `💹 *CCI Cross - Compra💥: ${symbol}*
- *Preço Atual*: $${priceFormatted}
- *RSI (15m)*: ${rsi15mValue}
- ${rsi1hEmoji} *RSI (1h)*: ${rsi1hValue}
- *LSR*: ${lsrText} ${lsrSymbol}
- *Fund. Rate*: ${fundingRateText}
- *🟰Resistência*: $${resistanceValue}
- *➖Suporte*: $${supportValue}
- *TP1*: $${tp1} 
- *TP2*: $${tp2} 
- *TP3*: $${tp3} 
- *⛔Stop*: $${slBuy} `;
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      lastSignals[symbol] = 'COMPRA';
      logger.info(`Sinal de COMPRA enviado para ${symbol} (RSI subindo, volume anormal, volatilidade mínima, fechamento acima da EMA 9)`);
    } else if (crossunder && rsi1hValue > 60 && rsiFalling && isVolumeAnomaly && isMinVolatility && currentClose < emaPriceCurrent && lastSignals[symbol] !== 'VENDA') {
      const message = `🔻 *CCI Cross - Correção💥: ${symbol}*
- *Preço Atual*: $${priceFormatted}
- *RSI (15m)*: ${rsi15mValue}
- ${rsi1hEmoji} *RSI (1h)*: ${rsi1hValue}
- *LSR*: ${lsrText} ${lsrSymbol}
- *Fund. Rate*: ${fundingRateText}
- *🟰Resistência*: $${resistanceValue}
- *➖Suporte*: $${supportValue}
- *TP1*: $${tp1Sell} 
- *TP2*: $${tp2Sell} 
- *TP3*: $${tp3Sell} 
- *⛔Stop*: $${slSell} `;
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      lastSignals[symbol] = 'VENDA';
      logger.info(`Sinal de VENDA enviado para ${symbol} (RSI descendo, volume anormal, volatilidade mínima, fechamento abaixo da EMA 9)`);
    }
  } catch (error) {
    logger.error(`Erro ao monitorar ${symbol}: ${error.message}`);
  }
}

// ================= MONITORAMENTO ESCALONADO ================= //
async function monitorCCICrossovers() {
  for (let i = 0; i < config.PARES_MONITORADOS.length; i++) {
    const symbol = config.PARES_MONITORADOS[i];
    setTimeout(() => monitorPair(symbol), i * 5000);
  }
}

// ================= INICIALIZAÇÃO DO BOT ================= //
async function startBot() {
  try {
    const pairCount = config.PARES_MONITORADOS.length;
    const pairsList = pairCount > 5 ? `${config.PARES_MONITORADOS.slice(0, 5).join(', ')} e mais ${pairCount - 5} pares` : config.PARES_MONITORADOS.join(', ');
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `✅ *Titanium Start *\nMonitorando ${pairCount} pares: ${pairsList}`, { parse_mode: 'Markdown' });
    logger.info('Bot iniciado com sucesso');
    setInterval(monitorCCICrossovers, 5 * 60 * 1000); // 5 minutos
    monitorCCICrossovers();
  } catch (error) {
    logger.error(`Erro ao iniciar o bot: ${error.message}`);
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `❌ Erro ao iniciar o bot: ${error.message}`);
  }
}

// ================= COMANDOS DO TELEGRAM ================= //
bot.command('price', async (ctx) => {
  const coin = ctx.match ? ctx.match.toUpperCase() + 'USDT' : null;
  if (!coin) {
    await ctx.reply('Uso: /price <símbolo> (ex: /price ENJ)');
    return;
  }
  const coinWithSlash = coin.replace('USDT', '/USDT');
  try {
    const ticker = await binance.fetchTicker(coinWithSlash);
    if (ticker && ticker.last !== undefined) {
      await ctx.reply(`${coin}: $${ticker.last.toFixed(2)}`);
      logger.info(`Consulta de preço para ${coin}`);
    } else {
      await ctx.reply(`❌ Par ${coin} não encontrado.`);
    }
  } catch (error) {
    await ctx.reply(`❌ Erro ao obter preço para ${coin}: ${error.message}`);
    logger.error(`Erro na consulta de preço para ${coin}: ${error.message}`);
  }
});

// Iniciar o bot
startBot();

bot.start();
logger.info('Bot está rodando...');
