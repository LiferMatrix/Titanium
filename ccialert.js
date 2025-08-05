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
  ttl: 5 * 60 * 1000, // 5 minutos
};

function getCachedData(key, symbol, fetchFunction, timeframe, limit) {
  const now = Date.now();
  if (cache[key][symbol] && now - cache[key][symbol].timestamp < cache.ttl) {
    return cache[key][symbol].data;
  }
  return fetchFunction().then(data => {
    cache[key][symbol] = { data, timestamp: now };
    return data;
  });
}

// ================= INICIALIZAÇÃO ================= //
const binance = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
});
const binanceFutures = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  options: { defaultType: 'future' },
});
const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

// Parâmetros do CCI, EMAs, RSI, Suporte/Resistência, ATR
const cciLength = 20;
const emaShortLength = 4;
const emaLongLength = 13;
const rsiLength = 14;
const supportResistanceLength = 20;
const atrLength = 14; // Período para cálculo do ATR
const timeframe15m = '15m';
const timeframe1h = '1h';
const timeframe3m = '3m';
const volumeLookback = 20; // Período para cálculo da média de volume
const volumeMultiplier = 2; // Volume atual deve ser 2x maior que a média
const minVolatility = 0.001; // Volatilidade mínima (ATR como 0.1% do preço)

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
async function monitorPair(symbol, index) {
  const symbolWithSlash = symbol.replace('USDT', '/USDT');
  try {
    logger.info(`Verificando ${symbol} (${symbolWithSlash})...`);

    // Buscar dados em paralelo
    const [ohlcv15m, ohlcv1h, ohlcv3m, ticker] = await Promise.all([
      getCachedData('ohlcv15m', symbol, () =>
        binance.fetchOHLCV(symbolWithSlash, timeframe15m, undefined, Math.max(cciLength + emaLongLength, supportResistanceLength, atrLength)),
        timeframe15m, Math.max(cciLength + emaLongLength, supportResistanceLength, atrLength)
      ),
      getCachedData('ohlcv1h', symbol, () =>
        binance.fetchOHLCV(symbolWithSlash, timeframe1h, undefined, rsiLength + 1),
        timeframe1h, rsiLength + 1
      ),
      getCachedData('ohlcv3m', symbol, () =>
        binance.fetchOHLCV(symbolWithSlash, timeframe3m, undefined, volumeLookback),
        timeframe3m, volumeLookback
      ),
      getCachedData('ticker', symbol, () =>
        binance.fetchTicker(symbolWithSlash),
        null, null
      )
    ]);

    // Validações
    if (!ohlcv15m || ohlcv15m.length < Math.max(cciLength + emaLongLength, supportResistanceLength, atrLength)) {
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
    const tp1 = (parseFloat(price) + parseFloat(atrValue)).toFixed(8); // Preço + 1×ATR
    const tp2 = (parseFloat(price) + 2 * parseFloat(atrValue)).toFixed(8); // Preço + 2×ATR
    const tp3 = (parseFloat(price) + 3 * parseFloat(atrValue)).toFixed(8); // Preço + 3×ATR
    const slBuy = (parseFloat(price) - 2.5 * parseFloat(atrValue)).toFixed(8); // Preço - 2.5×ATR
    const tp1Sell = (parseFloat(price) - parseFloat(atrValue)).toFixed(8); // Preço - 1×ATR
    const tp2Sell = (parseFloat(price) - 2 * parseFloat(atrValue)).toFixed(8); // Preço - 2×ATR
    const tp3Sell = (parseFloat(price) - 3 * parseFloat(atrValue)).toFixed(8); // Preço - 3×ATR
    const slSell = (parseFloat(price) + 2.5 * parseFloat(atrValue)).toFixed(8); // Preço + 2.5×ATR

    // Definir emoji para RSI de 1h
    const rsi1hEmoji = rsi1hValue < 50 ? '🟢' : rsi1hValue > 70 ? '🔴' : '';

    // Enviar alertas com critério de RSI, alvos e stop loss
    if (crossover && rsi1hValue < 55 && rsiRising && isVolumeAnomaly && isMinVolatility && lastSignals[symbol] !== 'COMPRA') {
      const message = `💹 *CCI Cross Bull: ${symbol}*
- *Preço Atual*: $${priceFormatted}
- *CCI (15m)*: ${cciValue}
- *RSI (15m)*: ${rsi15mValue}
- ${rsi1hEmoji} *RSI (1h)*: ${rsi1hValue}
- *Suporte*: $${supportValue}
- *Resistência*: $${resistanceValue}
- *ATR (15m)*: ${atrValueFormatted}
- *Volume Anormal (3m)*: Sim
- *Volatilidade Mínima*: Sim
- *TP1*: $${tp1} 
- *TP2*: $${tp2} 
- *TP3*: $${tp3} 
- *Stop Loss*: $${slBuy} `;
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      lastSignals[symbol] = 'COMPRA';
      logger.info(`Sinal de COMPRA enviado para ${symbol} (RSI subindo, volume anormal, volatilidade mínima)`);
    } else if (crossunder && rsi1hValue > 60 && rsiFalling && isVolumeAnomaly && isMinVolatility && lastSignals[symbol] !== 'VENDA') {
      const message = `🔻 *CCI Cross Bear: ${symbol}*
- *Preço Atual*: $${priceFormatted}
- *CCI (15m)*: ${cciValue}
- *RSI (15m)*: ${rsi15mValue}
- ${rsi1hEmoji} *RSI (1h)*: ${rsi1hValue}
- *Suporte*: $${supportValue}
- *Resistência*: $${resistanceValue}
- *ATR (15m)*: ${atrValueFormatted}
- *Volume Anormal (3m)*: Sim
- *Volatilidade Mínima*: Sim
- *TP1*: $${tp1Sell} 
- *TP2*: $${tp2Sell} 
- *TP3*: $${tp3Sell} 
- *Stop Loss*: $${slSell} `;
      await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
      lastSignals[symbol] = 'VENDA';
      logger.info(`Sinal de VENDA enviado para ${symbol} (RSI descendo, volume anormal, volatilidade mínima)`);
    }
  } catch (error) {
    logger.error(`Erro ao monitorar ${symbol}: ${error.message}`);
  }
}

// ================= MONITORAMENTO ESCALONADO ================= //
async function monitorCCICrossovers() {
  for (let i = 0; i < config.PARES_MONITORADOS.length; i++) {
    const symbol = config.PARES_MONITORADOS[i];
    setTimeout(() => monitorPair(symbol, i), i * 1000); // 1 segundo por par
  }
}

// ================= INICIALIZAÇÃO DO BOT ================= //
async function startBot() {
  try {
    const pairCount = config.PARES_MONITORADOS.length;
    const pairsList = pairCount > 5 ? `${config.PARES_MONITORADOS.slice(0, 5).join(', ')} e mais ${pairCount - 5} pares` : config.PARES_MONITORADOS.join(', ');
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `✅ *Titanium Start *\nMonitorando ${pairCount} pares: ${pairsList}`, { parse_mode: 'Markdown' });
    logger.info('Bot iniciado com sucesso');
  } catch (error) {
    logger.error(`Erro ao iniciar o bot: ${error.message}`);
    await bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `❌ Erro ao iniciar o bot: ${error.message}`);
  }

  setInterval(monitorCCICrossovers, 5 * 60 * 1000); // 5 minutos
  monitorCCICrossovers();
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