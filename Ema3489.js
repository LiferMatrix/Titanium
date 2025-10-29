require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');
const cron = require('node-cron');
const fs = require('fs');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_ALERTA_3M_MS: 5 * 60 * 1000, // 5 minutos
  TEMPO_COOLDOWN_MS: 30 * 60 * 1000, // 30 minutos
  RSI_PERIOD: 14,
  LSR_BUY_MAX: 2.5, // Limite máximo de LSR para compra
  LSR_SELL_MIN: 2.6, // Limite mínimo de LSR para venda
  CACHE_TTL: 10 * 60 * 1000, // 10 minutos
  MAX_CACHE_SIZE: 100,
  MAX_HISTORICO_ALERTAS: 10,
  EMA_FAST: 34, // Período da EMA rápida
  EMA_SLOW: 89, // Período da EMA lenta
  EMA_MIN_DIFFERENCE_FACTOR: 0.001, // Fator mínimo de diferença para confirmar cruzamento (0.1% do preço)
  EMA_HISTORY_LENGTH: 100, // Número de candles para calcular EMAs (mais dados para robustez)
  LOG_FILE: 'simple_trading_bot.log', // Nome do arquivo de log
  LOG_CLEAN_INTERVAL: '0 0 */2 * *', // Cron para limpeza a cada 2 dias (às 00:00)
};

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: config.LOG_FILE }),
    new winston.transports.Console()
  ]
});

// Função para limpar o arquivo de log
function cleanLogFile() {
  fs.truncate(config.LOG_FILE, 0, (err) => {
    if (err) {
      logger.error(`Erro ao limpar o arquivo de log: ${err.message}`);
    } else {
      logger.info('Arquivo de log limpo com sucesso.');
    }
  });
}

// Agendar limpeza de logs a cada 2 dias
cron.schedule(config.LOG_CLEAN_INTERVAL, cleanLogFile);
logger.info('Limpeza de logs agendada a cada 2 dias.');

// Estado global
const state = {
  ultimoAlertaPorAtivo: {},
  dataCache: new Map()
};

// Validação de variáveis de ambiente
function validateEnv() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'COINS'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`Missing environment variable: ${key}`);
      process.exit(1);
    }
  }
}
validateEnv();

// Inicialização do Telegram e Exchanges
const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
const exchangeSpot = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 30000,
  options: { defaultType: 'spot' }
});
const exchangeFutures = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 30000,
  options: { defaultType: 'future' }
});

// ================= UTILITÁRIOS ================= //
async function withRetry(fn, retries = 5, delayBase = 1000) {
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

function getCachedData(key) {
  const cacheEntry = state.dataCache.get(key);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < config.CACHE_TTL) {
    logger.info(`Usando cache para ${key}`);
    return cacheEntry.data;
  }
  state.dataCache.delete(key);
  return null;
}

function setCachedData(key, data) {
  if (state.dataCache.size >= config.MAX_CACHE_SIZE) {
    const oldestKey = state.dataCache.keys().next().value;
    state.dataCache.delete(oldestKey);
    logger.info(`Cache cheio, removido item mais antigo: ${oldestKey}`);
  }
  state.dataCache.set(key, { timestamp: Date.now(), data });
  setTimeout(() => {
    if (state.dataCache.has(key) && Date.now() - state.dataCache.get(key).timestamp >= config.CACHE_TTL) {
      state.dataCache.delete(key);
      logger.info(`Cache limpo para ${key}`);
    }
  }, config.CACHE_TTL + 1000);
}

async function limitConcurrency(items, fn, limit = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(item => fn(item)));
    results.push(...batchResults);
  }
  return results;
}

function getStochasticEmoji(value) {
  if (!value) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}

// ================= NORMALIZAÇÃO OHLCV ================= //
function normalizeOHLCV(ohlcv) {
  return ohlcv.map(candle => ({
    time: candle[0],
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5]
  }));
}

// ================= INDICADORES ================= //
function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) return [];
  const rsi = TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close)
  });
  return rsi.filter(v => !isNaN(v));
}

function calculateEMA(data, period) {
  if (!data || data.length < period) return [];
  const ema = TechnicalIndicators.EMA.calculate({
    period: period,
    values: data.map(d => d.close)
  });
  return ema.filter(v => !isNaN(v));
}

function calculateEMACrossover(data, price) {
  if (!data || data.length < config.EMA_SLOW + 1) return { isBullish: false, isBearish: false };

  // Ignorar candle aberto e usar apenas candles fechados
  const now = Date.now();
  const lastCandle = data[data.length - 1];
  const candles = lastCandle.time + 3 * 60 * 1000 > now ? data.slice(0, -1) : data;

  if (candles.length < config.EMA_SLOW + 1) return { isBullish: false, isBearish: false };

  // Calcular EMAs com mais dados para robustez
  const emaFast = calculateEMA(candles, config.EMA_FAST);
  const emaSlow = calculateEMA(candles, config.EMA_SLOW);

  if (emaFast.length < 2 || emaSlow.length < 2) return { isBullish: false, isBearish: false };

  const currentFast = emaFast[emaFast.length - 1];
  const previousFast = emaFast[emaFast.length - 2];
  const currentSlow = emaSlow[emaSlow.length - 1];
  const previousSlow = emaSlow[emaSlow.length - 2];

  // Min difference para evitar falsos cruzamentos
  const minDifference = price * config.EMA_MIN_DIFFERENCE_FACTOR;

  // Verificar se o cruzamento aconteceu exatamente no último candle fechado
  const isBullish = (previousFast <= previousSlow) && 
                    (currentFast > currentSlow) && 
                    (currentFast - currentSlow > minDifference) && 
                    // Confirmação adicional: EMA rápida está acelerando (slope positivo)
                    (currentFast - previousFast > 0);

  const isBearish = (previousFast >= previousSlow) && 
                    (currentFast < currentSlow) && 
                    (currentSlow - currentFast > minDifference) && 
                    // Confirmação adicional: EMA rápida está desacelerando (slope negativo)
                    (currentFast - previousFast < 0);

  return { isBullish, isBearish, emaFast: currentFast, emaSlow: currentSlow };
}

async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    }));
    if (!res.data || res.data.length < 2) {
      logger.warn(`Dados insuficientes de LSR para ${symbol}: ${res.data?.length || 0} registros`);
      return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00' };
    }
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const previousLSR = parseFloat(res.data[1].longShortRatio);
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, isRising: currentLSR > previousLSR, percentChange };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00' };
  }
}

async function fetchFundingRate(symbol) {
  const cacheKey = `funding_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const fundingData = await withRetry(() => exchangeFutures.fetchFundingRateHistory(symbol, undefined, 2));
    if (fundingData && fundingData.length >= 2) {
      const currentFunding = parseFloat(fundingData[fundingData.length - 1].fundingRate);
      const previousFunding = parseFloat(fundingData[fundingData.length - 2].fundingRate);
      const percentChange = previousFunding !== 0 ? ((currentFunding - previousFunding) / Math.abs(previousFunding) * 100).toFixed(2) : '0.00';
      const result = { current: currentFunding, isRising: currentFunding > previousFunding, percentChange };
      setCachedData(cacheKey, result);
      return result;
    }
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  }
}

// ================= FUNÇÕES DE ALERTAS ================= //
async function sendAlertEMATrend(symbol, data) {
  const { ohlcv3m, ohlcv1h, price, rsi1h, emaCrossover, lsr, fundingRate } = data;
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = { historico: [] };
  if (state.ultimoAlertaPorAtivo[symbol]['3m'] && agora - state.ultimoAlertaPorAtivo[symbol]['3m'] < config.TEMPO_COOLDOWN_MS) {
    logger.info(`Cooldown ativo para ${symbol}, último alerta: ${state.ultimoAlertaPorAtivo[symbol]['3m']}`);
    return;
  }

  if (!emaCrossover) {
    logger.warn(`Cruzamento EMA 34/89 inválido para ${symbol}`);
    return;
  }

  const isBullishCrossover = emaCrossover.isBullish;
  const isBearishCrossover = emaCrossover.isBearish;

  logger.info(`EMA 34/89 (3m) para ${symbol}: Bullish=${isBullishCrossover}, Bearish=${isBearishCrossover}, EMA34=${emaCrossover.emaFast}, EMA89=${emaCrossover.emaSlow}`);

  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  

  const cacheKey4h = `ohlcv_${symbol}_4h`;
  const cacheKey1d = `ohlcv_${symbol}_1d`;
  const ohlcv4hRaw = getCachedData(cacheKey4h) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 50));
  const ohlcv1dRaw = getCachedData(cacheKey1d) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 50));
  setCachedData(cacheKey4h, ohlcv4hRaw);
  setCachedData(cacheKey1d, ohlcv1dRaw);

  const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
  const ohlcv1d = normalizeOHLCV(ohlcv1dRaw);

  let stoch4h = 'N/A';
  let stoch1d = 'N/A';
  if (ohlcv4h.length >= 14) {
    const stochResult4h = TechnicalIndicators.Stochastic.calculate({
      high: ohlcv4h.map(c => c.high),
      low: ohlcv4h.map(c => c.low),
      close: ohlcv4h.map(c => c.close),
      period: 5,
      signalPeriod: 3
    });
    stoch4h = stochResult4h.length > 0 ? stochResult4h[stochResult4h.length - 1].k.toFixed(2) : 'N/A';
  }
  if (ohlcv1d.length >= 14) {
    const stochResult1d = TechnicalIndicators.Stochastic.calculate({
      high: ohlcv1d.map(c => c.high),
      low: ohlcv1d.map(c => c.low),
      close: ohlcv1d.map(c => c.close),
      period: 5,
      signalPeriod: 3
    });
    stoch1d = stochResult1d.length > 0 ? stochResult1d[stochResult1d.length - 1].k.toFixed(2) : 'N/A';
  }

  

  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=3`;
  const rsi1hEmoji = rsi1h > 60 ? "☑︎" : rsi1h < 40 ? "☑︎" : "";
  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) {
    if (lsr.value <= 1.4) lsrSymbol = '✅Baixo';
    else if (lsr.value >= 2.8) lsrSymbol = '📛Alto';
  }
  let fundingRateEmoji = '';
  if (fundingRate.current !== null) {
    if (fundingRate.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
    else if (fundingRate.current <= -0.001) fundingRateEmoji = '🟢🟢';
    else if (fundingRate.current <= -0.0005) fundingRateEmoji = '🟢';
    else if (fundingRate.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
    else if (fundingRate.current >= 0.0003) fundingRateEmoji = '🔴🔴';
    else if (fundingRate.current >= 0.0002) fundingRateEmoji = '🔴';
    else fundingRateEmoji = '🟢';
  }
  const fundingRateText = fundingRate.current !== null 
    ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}%  ${fundingRate.isRising ? '⬆️' : '⬇️'}`
    : '🔹 Indisp.';
 
  
  
  const stoch4hText = stoch4h !== 'N/A' ? `Stoch 4h: ${stoch4h} ${getStochasticEmoji(parseFloat(stoch4h))}` : '🔹 Stoch 4h';
  const stoch1dText = stoch1d !== 'N/A' ? `Stoch 1d: ${stoch1d} ${getStochasticEmoji(parseFloat(stoch1d))}` : '🔹 Stoch 1d';
  
 
  

  let alertText = '';
  const isBuySignal = isBullishCrossover &&
                      rsi1h < 60  
                     
                      
  
  const isSellSignal = isBearishCrossover &&
                       rsi1h > 60 
                        
                      

  
  if (isBuySignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r => 
      r.direcao === 'buy' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_MS
    );
    if (!foiAlertado) {
      alertText = `🟢✅*Bull ⤴️ *\n\n` +
                  `🔹#Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
                  `💲 $Preço: ${format(price)}\n` +
                  `🔹 RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹 ${stoch4hText}\n` +
                  `🔹 ${stoch1dText}\n` +
                  `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹 Fund. R: ${fundingRateText}\n` +
                  ` ☑︎ Gerencie seu Risco -🤖 @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['3m'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'buy', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      logger.info(`Sinal de compra detectado para ${symbol}: Preço=${format(price)}, EMA 34/89(3m)=Bullish, RSI 1h=${rsi1h.toFixed(2)},`);
    }
  } else if (isSellSignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r => 
      r.direcao === 'sell' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_MS
    );
    if (!foiAlertado) {
      alertText = `🔴📍*Bear ⤵️ *\n\n` +
                  `🔹#Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
                  `💲 $Preço: ${format(price)}\n` +
                  `🔹 RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹 ${stoch4hText}\n` +
                  `🔹 ${stoch1dText}\n` +
                  `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹 Fund. R: ${fundingRateText}\n` +
                  ` ☑︎ Gerencie seu Risco -🤖 @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['3m'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'sell', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      logger.info(`Sinal de venda detectado para ${symbol}: Preço=${format(price)}, EMA 34/89(3m)=Bearish, RSI 1h=${rsi1h.toFixed(2)},`);
    }
  }

  if (alertText) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info(`Alerta de sinal OI-EMA enviado para ${symbol}: ${alertText}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta para ${symbol}: ${e.message}`);
    }
  }
}

async function checkConditions() {
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const cacheKeyPrefix = `ohlcv_${symbol}`;
      const ohlcv3mRaw = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, config.EMA_HISTORY_LENGTH));
      const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, config.RSI_PERIOD + 1));
      setCachedData(`${cacheKeyPrefix}_3m`, ohlcv3mRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);

      if (!ohlcv3mRaw || !ohlcv1hRaw) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}, pulando...`);
        return;
      }

      const ohlcv3m = normalizeOHLCV(ohlcv3mRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const closes3m = ohlcv3m.map(c => c.close).filter(c => !isNaN(c));
      const currentPrice = closes3m[closes3m.length - 1];

      if (isNaN(currentPrice)) {
        logger.warn(`Preço atual inválido para ${symbol}, pulando...`);
        return;
      }

      if (ohlcv3m.length < config.EMA_SLOW + 1) {
        logger.warn(`Candles insuficientes para EMA 34/89 (3m) em ${symbol}: ${ohlcv3m.length}`);
        return;
      }

      const rsi1hValues = calculateRSI(ohlcv1h);
      const emaCrossover = calculateEMACrossover(ohlcv3m, currentPrice);
      const lsr = await fetchLSR(symbol);
      const fundingRate = await fetchFundingRate(symbol);
     

      if (!rsi1hValues.length || !emaCrossover) {
        logger.warn(`Indicadores insuficientes para ${symbol}, pulando...`);
        return;
      }

      logger.info(`Últimos 5 candles 3m para ${symbol}: ${JSON.stringify(ohlcv3m.slice(-5))}`);

      await sendAlertEMATrend(symbol, {
        ohlcv3m,
        ohlcv1h,
        price: currentPrice,
        rsi1h: rsi1hValues[rsi1hValues.length - 1],
        emaCrossover,
        lsr,
        fundingRate
        
      });
    }, 5);
  } catch (e) {
    logger.error(`Erro ao processar condições: ${e.message}`);
  }
}

async function main() {
  logger.info('Iniciando simple trading bot');
  try {
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 Titanium 💹EMA...'));
    await checkConditions();
    setInterval(checkConditions, config.INTERVALO_ALERTA_3M_MS);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
  }
}

main().catch(e => logger.error(`Erro fatal: ${e.message}`));
