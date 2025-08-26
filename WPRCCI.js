require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT")
    .split(",")
    .map(s => s.trim()), // No initial validation, just split and trim
  INTERVALO_ALERTA_3M_MS: 600000, // 10 minutos
  TEMPO_COOLDOWN_MS: 15 * 60 * 1000,
  WPR_PERIOD: 14,
  WPR_LOW_THRESHOLD: -97,
  WPR_HIGH_THRESHOLD: -3,
  RSI_PERIOD: 10,
  CACHE_TTL: 30 * 60 * 1000, // 30 minutos
  EMA_13_PERIOD: 13,
  EMA_34_PERIOD: 34,
  MAX_CACHE_SIZE: 3000,
  MAX_HISTORICO_ALERTAS: 10,
  VOLUME_THRESHOLD_3M: 2.0,
  CCI_PERIOD: 14,
  CCI_SMA_PERIOD: 10,
  MIN_VOLUME_24H: 100000,
};

// Logger simplificado
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'quick_trading_bot.log', maxsize: 10485760, maxFiles: 5 })
  ],
});

// Estado global com Map para eficiência
const state = {
  ultimoAlertaPorAtivo: new Map(),
  ultimoEstocastico: new Map(),
  wprTriggerState: new Map(),
  dataCache: new Map(),
  paresValidos: new Set(),
};

// Inicialização tardia de exchanges e bot
let exchangeSpot, exchangeFutures, bot;
async function initializeExchangesAndBot() {
  console.time('initializeExchangesAndBot');
  exchangeSpot = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
    enableRateLimit: true,
    timeout: 20000,
    options: { defaultType: 'spot' },
  });
  exchangeFutures = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
    enableRateLimit: true,
    timeout: 20000,
    options: { defaultType: 'future' },
  });
  bot = new Bot(config.TELEGRAM_BOT_TOKEN || 'default_token');
  await Promise.all([
    exchangeSpot.loadMarkets().catch(e => logger.warn(`Erro ao carregar mercados spot: ${e.message}`)),
    exchangeFutures.loadMarkets().catch(e => logger.warn(`Erro ao carregar mercados futuros: ${e.message}`)),
    bot.init().catch(e => logger.warn(`Erro ao inicializar bot: ${e.message}`)),
  ]);
  console.timeEnd('initializeExchangesAndBot');
}

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
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function getCachedData(key) {
  const cacheEntry = state.dataCache.get(key);
  if (cacheEntry && Date.now() - cacheEntry.timestamp < config.CACHE_TTL) {
    return cacheEntry.data;
  }
  state.dataCache.delete(key);
  return null;
}

function setCachedData(key, data) {
  if (state.dataCache.size >= config.MAX_CACHE_SIZE) {
    const oldestKey = state.dataCache.keys().next().value;
    state.dataCache.delete(oldestKey);
  }
  state.dataCache.set(key, { timestamp: Date.now(), data });
}

async function limitConcurrency(items, fn, limit = 10) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...await Promise.all(batch.map(item => fn(item))));
    if (i + limit < items.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return results;
}

async function isValidPair(symbol) {
  // Early check for non-string or empty symbols
  if (typeof symbol !== 'string' || symbol.trim() === '') {
    logger.warn(`Símbolo inválido ignorado: ${symbol}`);
    return false;
  }
  const timerKey = `isValidPair_${symbol}_${Date.now()}`; // Unique timer key
  console.time(timerKey);
  if (state.paresValidos.has(symbol)) {
    console.timeEnd(timerKey);
    return true;
  }
  try {
    const ticker = await withRetry(() => exchangeSpot.fetchTicker(symbol));
    if (ticker?.baseVolume * ticker.last >= config.MIN_VOLUME_24H) {
      state.paresValidos.add(symbol);
      console.timeEnd(timerKey);
      return true;
    }
    logger.info(`Par ${symbol} ignorado: volume insuficiente`);
    console.timeEnd(timerKey);
    return false;
  } catch (e) {
    logger.warn(`Erro ao validar par ${symbol}: ${e.message}`);
    console.timeEnd(timerKey);
    return false;
  }
}

// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  return Array.isArray(data)
    ? data
        .map(c => ({
          time: c[0],
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5]),
        }))
        .filter(c => c.close > 0 && c.volume > 0 && c.high > 0 && c.low > 0)
    : [];
}

function calculateWPR(data) {
  if (data.length < config.WPR_PERIOD + 1) return [];
  return TechnicalIndicators.WilliamsR.calculate({
    period: config.WPR_PERIOD,
    high: data.map(d => d.high),
    low: data.map(d => d.low),
    close: data.map(d => d.close),
  }).filter(v => !isNaN(v));
}

function calculateRSI(data) {
  if (data.length < config.RSI_PERIOD + 1) return [];
  return TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close),
  }).filter(v => !isNaN(v));
}

function calculateStochastic(data, periodK = 5, smoothK = 3, periodD = 3) {
  if (data.length < periodK + smoothK + periodD - 2) return null;
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);
  const closes = data.map(c => c.close);
  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: periodK,
    signalPeriod: periodD,
    smoothing: smoothK,
  });
  return result.length ? { k: parseFloat(result[result.length - 1].k.toFixed(2)), d: parseFloat(result[result.length - 1].d.toFixed(2)) } : null;
}

function calculateEMA(data, period) {
  if (data.length < period) return [];
  return TechnicalIndicators.EMA.calculate({
    period,
    values: data.map(d => d.close),
  }).filter(v => !isNaN(v));
}

function calculateCCI(data, period) {
  if (data.length < period + 1) return [];
  const typicalPrice = data.map(c => (c.high + c.low + c.close) / 3);
  const sma = TechnicalIndicators.SMA.calculate({ period, values: typicalPrice });
  const meanDeviation = data.slice(period - 1).map((c, i) => {
    const tp = typicalPrice[i + period - 1];
    const currentSma = sma[i];
    const deviations = data.slice(i, i + period).map(d => Math.abs((d.high + d.low + d.close) / 3 - currentSma));
    return deviations.reduce((sum, dev) => sum + dev, 0) / period;
  });
  return sma.map((s, i) => {
    const tp = typicalPrice[i + period - 1];
    const md = meanDeviation[i];
    return md !== 0 ? (tp - s) / (0.015 * md) : 0;
  }).filter(v => !isNaN(v));
}

function calculateCCISMA(cci, period) {
  if (cci.length < period) return [];
  return TechnicalIndicators.SMA.calculate({ period, values: cci });
}

function calculateVolumeProfile(ohlcv, priceStepPercent = 0.1) {
  if (!ohlcv || ohlcv.length < 2) return { buyLiquidityZones: [], sellLiquidityZones: [] };
  const priceRange = Math.max(...ohlcv.map(c => c.high)) - Math.min(...ohlcv.map(c => c.low));
  const step = priceRange * priceStepPercent / 100;
  const volumeProfile = new Map();
  for (const candle of ohlcv) {
    const price = (candle.high + candle.low) / 2;
    if (isNaN(price) || isNaN(candle.volume)) continue;
    const bucket = Math.floor(price / step) * step;
    volumeProfile.set(bucket, (volumeProfile.get(bucket) || 0) + candle.volume);
  }
  const sortedBuckets = [...volumeProfile.entries()]
    .sort(([, volA], [, volB]) => volB - volA)
    .slice(0, 3)
    .map(([price]) => parseFloat(price));
  const lastClose = ohlcv[ohlcv.length - 1].close;
  return {
    buyLiquidityZones: sortedBuckets.filter(p => p <= lastClose).sort((a, b) => b - a),
    sellLiquidityZones: sortedBuckets.filter(p => p > lastClose).sort((a, b) => a - b),
  };
}

function calculateAbnormalVolume(ohlcv3m) {
  if (!ohlcv3m || ohlcv3m.length < 10) return { isAbnormal: false, volumeRatio: 0 };
  const volumes = ohlcv3m.map(c => c.volume);
  const avgVolume = volumes.slice(1).reduce((sum, v) => sum + v, 0) / (volumes.length - 1);
  const currentVolume = volumes[0];
  const volumeRatio = avgVolume !== 0 ? currentVolume / avgVolume : 0;
  return { isAbnormal: volumeRatio > config.VOLUME_THRESHOLD_3M, volumeRatio: parseFloat(volumeRatio.toFixed(2)) };
}

async function fetchLSR(symbol) {
  const cacheKey = `lsr_${symbol}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const res = await withRetry(() => axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 },
    }));
    if (!res.data || res.data.length < 2) return { value: null, isRising: false, percentChange: '0.00' };
    const currentLSR = parseFloat(res.data[0].longShortRatio);
    const previousLSR = parseFloat(res.data[1].longShortAccountRatio);
    const percentChange = previousLSR !== 0 ? ((currentLSR - previousLSR) / previousLSR * 100).toFixed(2) : '0.00';
    const result = { value: currentLSR, isRising: currentLSR > previousLSR, percentChange };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    return getCachedData(cacheKey) || { value: null, isRising: false, percentChange: '0.00' };
  }
}

async function fetchOpenInterest(symbol, timeframe, retries = 3) {
  const cacheKey = `oi_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const oiData = await withRetry(() => exchangeFutures.fetchOpenInterestHistory(symbol, timeframe, undefined, 10));
    if (!oiData || oiData.length < 3) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '5m') return await fetchOpenInterest(symbol, '15m', 3);
      return { isRising: false, percentChange: '0.00' };
    }
    const validOiData = oiData
      .filter(d => {
        const oiValue = d.openInterest || d.openInterestAmount || (d.info && d.info.sumOpenInterest);
        return typeof oiValue === 'number' && !isNaN(oiValue) && oiValue >= 0;
      })
      .map(d => ({ openInterest: oiValue }))
      .sort((a, b) => b.timestamp - a.timestamp);
    if (validOiData.length < 3) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await fetchOpenInterest(symbol, timeframe, retries - 1);
      }
      if (timeframe === '5m') return await fetchOpenInterest(symbol, '15m', 3);
      return { isRising: false, percentChange: '0.00' };
    }
    const recentOi = validOiData.slice(0, 3).map(d => d.openInterest);
    const sma = recentOi.reduce((sum, val) => sum + val, 0) / recentOi.length;
    const previousRecentOi = validOiData.slice(3, 6).map(d => d.openInterest);
    const previousSma = previousRecentOi.length >= 3 ? previousRecentOi.reduce((sum, val) => sum + val, 0) / previousRecentOi.length : recentOi[recentOi.length - 1];
    const oiPercentChange = previousSma !== 0 ? ((sma - previousSma) / previousSma * 100).toFixed(2) : '0.00';
    const result = { isRising: sma > previousSma, percentChange: oiPercentChange };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    return getCachedData(cacheKey) || { isRising: false, percentChange: '0.00' };
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
    return { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  }
}

async function calculateAggressiveDelta(symbol, timeframe = '3m', limit = 50) {
  const cacheKey = `delta_${symbol}_${timeframe}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;
  try {
    const trades = await withRetry(() => exchangeSpot.fetchTrades(symbol, undefined, limit));
    let buyVolume = 0, sellVolume = 0;
    const volumes = trades.map(trade => trade.amount).filter(amount => !isNaN(amount));
    const avgVolume = volumes.length > 0 ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : 0;
    const minVolumeThreshold = avgVolume * 0.001;
    for (const { side, amount, price } of trades) {
      if (!side || !amount || !price || isNaN(amount) || amount < minVolumeThreshold) continue;
      if (side === 'buy') buyVolume += amount;
      else if (side === 'sell') sellVolume += amount;
    }
    const totalVolume = buyVolume + sellVolume;
    if (totalVolume === 0) return { delta: 0, deltaPercent: 0, isBuyPressure: false, isSignificant: false };
    const delta = buyVolume - sellVolume;
    const deltaPercent = parseFloat((delta / totalVolume * 100).toFixed(2));
    const result = { delta, deltaPercent, isBuyPressure: delta > 0, isSignificant: Math.abs(deltaPercent) > 10 };
    setCachedData(cacheKey, result);
    return result;
  } catch (e) {
    return getCachedData(cacheKey) || { delta: 0, deltaPercent: 0, isBuyPressure: false, isSignificant: false };
  }
}

// ================= FUNÇÕES DE ALERTAS ================= //
function getStochasticEmoji(value) {
  if (!value) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}

function getSetaDirecao(current, previous) {
  if (!current || !previous) return "➡️";
  return current > previous ? "⬆️" : current < previous ? "⬇️" : "➡️";
}

async function sendAlert1h2h(symbol, data) {
  const { ohlcv3m, ohlcv15m, ohlcv1h, ohlcvDiario, ohlcv4h, price, wpr2h, wpr1h, rsi1h, lsr, volumeProfile, isOIRising5m, estocasticoD, estocastico4h, fundingRate, oi15m, ema13_3m, ema34_3m, previousEma13_3m, previousEma34_3m, cci15m, cciSma15m, previousCci15m, previousCciSma15m } = data;
  const agora = Date.now();
  const lastAlert = state.ultimoAlertaPorAtivo.get(symbol)?.get('1h_2h');
  if (lastAlert && agora - lastAlert < config.TEMPO_COOLDOWN_MS) return;

  const aggressiveDelta = await calculateAggressiveDelta(symbol);
  const volumeCheck = calculateAbnormalVolume(ohlcv3m);
  let wprState = state.wprTriggerState.get(symbol) || new Map();
  if (!wprState.has('1h_2h')) wprState.set('1h_2h', { buyTriggered: false, sellTriggered: false });

  if (wpr2h <= config.WPR_LOW_THRESHOLD && wpr1h <= config.WPR_LOW_THRESHOLD) {
    wprState.get('1h_2h').buyTriggered = true;
  } else if (wpr2h >= config.WPR_HIGH_THRESHOLD && wpr1h >= config.WPR_HIGH_THRESHOLD) {
    wprState.get('1h_2h').sellTriggered = true;
  }
  state.wprTriggerState.set(symbol, wprState);

  let stochState = state.ultimoEstocastico.get(symbol) || new Map();
  const kAnteriorD = stochState.get('kD') || estocasticoD?.k || 0;
  const kAnterior4h = stochState.get('k4h') || estocastico4h?.k || 0;
  stochState.set('kD', estocasticoD?.k);
  stochState.set('k4h', estocastico4h?.k);
  state.ultimoEstocastico.set(symbol, stochState);

  const direcaoD = getSetaDirecao(estocasticoD?.k, kAnteriorD);
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stochDEmoji = estocasticoD ? getStochasticEmoji(estocasticoD.k) : "";
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);

  const isCciCrossover = cci15m !== undefined && cciSma15m !== undefined && previousCci15m !== undefined && previousCciSma15m !== undefined
    ? cci15m > cciSma15m && previousCci15m <= previousCciSma15m
    : false;
  const isCciCrossunder = cci15m !== undefined && cciSma15m !== undefined && previousCci15m !== undefined && previousCciSma15m !== undefined
    ? cci15m < cciSma15m && previousCci15m >= previousCciSma15m
    : false;

  const isBuySignal = wprState.get('1h_2h').buyTriggered && isOIRising5m && ema13_3m > ema34_3m && previousEma13_3m <= previousEma34_3m && volumeCheck.isAbnormal && (isCciCrossover || cci15m === undefined);
  const isSellSignal = wprState.get('1h_2h').sellTriggered && !isOIRising5m && ema13_3m < ema34_3m && previousEma13_3m >= previousEma34_3m && volumeCheck.isAbnormal && (isCciCrossunder || cci15m === undefined);

  let lsrSymbol = '🔘Consol.';
  if (lsr.value !== null) lsrSymbol = lsr.value <= 1.4 ? '✅Baixo' : lsr.value >= 2.8 ? '📛Alto' : lsrSymbol;

  const rsi1hEmoji = rsi1h > 60 || rsi1h < 40 ? "☑︎" : "";
  let fundingRateEmoji = '';
  if (fundingRate.current !== null) {
    const fr = fundingRate.current;
    fundingRateEmoji = fr <= -0.002 ? '🟢🟢🟢' : fr <= -0.001 ? '🟢🟢' : fr <= -0.0005 ? '🟢' : fr >= 0.001 ? '🔴🔴🔴' : fr >= 0.0003 ? '🔴🔴' : fr >= 0.0002 ? '🔴' : '🟢';
  }

  const fundingRateText = fundingRate.current !== null ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}` : '🔹 Indisp.';
  const deltaText = aggressiveDelta.isSignificant ? `${aggressiveDelta.isBuyPressure ? '💹F.Comprador' : '⭕F.Vendedor'} ${aggressiveDelta.deltaPercent > 60 && lsr.value !== null && lsr.value < 1 ? '💥' : ''}(${aggressiveDelta.deltaPercent}%)` : '🔘Neutro';
  const volumeText = volumeCheck.isAbnormal ? `📈Vol.Anormal (${volumeCheck.volumeRatio}x)` : '🔘Vol.Normal';
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
  const cciText = cci15m !== undefined && cciSma15m !== undefined ? `${cci15m.toFixed(2)} (SMA: ${cciSma15m.toFixed(2)})` : 'N/A';

  let alertText = `🔹Ativo: *${symbol}* [- TradingView](${tradingViewLink})\n` +
    `💲 Preço: ${format(price)}\n` +
    `🔹 RSI 1h: ${rsi1h !== undefined ? rsi1h.toFixed(2) : 'N/A'} ${rsi1hEmoji}\n` +
    `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
    `🔹 Fund. R: ${fundingRateText}\n` +
    `🔸 Vol.Delta: ${deltaText}\n` +
    `🔸 Volume 3m: ${volumeText}\n` +
    `🔹 Stoch Diário %K: ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
    `🔹 Stoch 4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
    `🔹 CCI 15m: ${cciText}\n` +
    `☑︎ Monitor WPR 🤖 @J4Rviz\n`;

  if (isBuySignal || isSellSignal) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, `${isBuySignal ? '🟩*WPR/CCI -✳️Compra/Reversão✳️*' : '🟥*WPR/CCI -🔻Correção/Exaustão🔻*'}\n\n${alertText}`, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }));
      state.ultimoAlertaPorAtivo.set(symbol, new Map(state.ultimoAlertaPorAtivo.get(symbol) || []).set('1h_2h', agora));
      wprState.get('1h_2h')[isBuySignal ? 'buyTriggered' : 'sellTriggered'] = false;
      state.wprTriggerState.set(symbol, wprState);
    } catch (e) {
      logger.error(`Erro ao enviar alerta para ${symbol}: ${e.message}`);
    }
  }
}

async function checkConditions() {
  console.time('checkConditions');
  try {
    let successCount = 0;
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      // Validate pair before processing
      if (!(await isValidPair(symbol))) {
        logger.info(`Par ${symbol} inválido ou sem volume suficiente, ignorado.`);
        return;
      }

      const cacheKeyPrefix = `ohlcv_${symbol}`;
      const timeframes = ['3m', '15m', '1h', '2h', '4h', '1d'];
      const ohlcvPromises = timeframes.map(tf => 
        getCachedData(`${cacheKeyPrefix}_${tf}`) || 
        (tf === '3m' ? exchangeFutures : exchangeSpot).fetchOHLCV(symbol, tf, undefined, 50)
      );
      const [ohlcv3mRaw, ohlcv15mRaw, ohlcv1hRaw, ohlcv2hRaw, ohlcv4hRaw, ohlcvDiarioRaw] = await Promise.all(ohlcvPromises.map(p => withRetry(() => p)));
      timeframes.forEach((tf, i) => setCachedData(`${cacheKeyPrefix}_${tf}`, [ohlcv3mRaw, ohlcv15mRaw, ohlcv1hRaw, ohlcv2hRaw, ohlcv4hRaw, ohlcvDiarioRaw][i]));

      const ohlcv = [ohlcv3mRaw, ohlcv15mRaw, ohlcv1hRaw, ohlcv2hRaw, ohlcv4hRaw, ohlcvDiarioRaw].map(normalizeOHLCV);
      if (ohlcv.some(d => !d.length)) return;

      const closes3m = ohlcv[0].map(c => c.close);
      const currentPrice = closes3m[closes3m.length - 1];
      if (isNaN(currentPrice)) return;

      const wpr2hValues = calculateWPR(ohlcv[3]);
      const wpr1hValues = calculateWPR(ohlcv[2]);
      const rsi1hValues = calculateRSI(ohlcv[2]);
      const ema13_3mValues = calculateEMA(ohlcv[0], config.EMA_13_PERIOD);
      const ema34_3mValues = calculateEMA(ohlcv[0], config.EMA_34_PERIOD);
      const cci15mValues = calculateCCI(ohlcv[1], config.CCI_PERIOD);
      const cciSma15mValues = calculateCCISMA(cci15mValues, config.CCI_SMA_PERIOD);

      if (!wpr2hValues.length || !wpr1hValues.length || !rsi1hValues.length || !ema13_3mValues.length || !ema34_3mValues.length) return;

      await sendAlert1h2h(symbol, {
        ohlcv3m: ohlcv[0],
        ohlcv15m: ohlcv[1],
        ohlcv1h: ohlcv[2],
        ohlcvDiario: ohlcv[5],
        ohlcv4h: ohlcv[4],
        price: currentPrice,
        wpr2h: wpr2hValues[wpr2hValues.length - 1],
        wpr1h: wpr1hValues[wpr1hValues.length - 1],
        rsi1h: rsi1hValues[rsi1hValues.length - 1],
        lsr: await fetchLSR(symbol),
        volumeProfile: calculateVolumeProfile(ohlcv[1]),
        orderBookLiquidity: { buy: [], sell: [] }, // Placeholder for missing fetchLiquidityZones
        isOIRising5m: (await fetchOpenInterest(symbol, '5m')).isRising,
        estocasticoD: calculateStochastic(ohlcv[5], 5, 3, 3),
        estocastico4h: calculateStochastic(ohlcv[4], 5, 3, 3),
        fundingRate: await fetchFundingRate(symbol),
        oi15m: await fetchOpenInterest(symbol, '15m'),
        ema13_3m: ema13_3mValues[ema13_3mValues.length - 1],
        ema34_3m: ema34_3mValues[ema34_3mValues.length - 1],
        previousEma13_3m: ema13_3mValues[ema13_3mValues.length - 2] || 0,
        previousEma34_3m: ema34_3mValues[ema34_3mValues.length - 2] || 0,
        cci15m: cci15mValues[cci15mValues.length - 1],
        cciSma15m: cciSma15mValues[cciSma15mValues.length - 1],
        previousCci15m: cci15mValues[cci15mValues.length - 2],
        previousCciSma15m: cciSma15mValues[cciSma15mValues.length - 2],
      });
      successCount++;
    });
    logger.info(`Ciclo concluído: ${successCount}/${config.PARES_MONITORADOS.length} pares processados`);
  } catch (e) {
    logger.error(`Erro ao processar condições: ${e.message}`);
  }
  console.timeEnd('checkConditions');
}

async function reconectar() {
  console.time('reconectar');
  let tentativa = 0;
  while (tentativa < 2) {
    try {
      await exchangeSpot.fetchTime();
      console.timeEnd('reconectar');
      return true;
    } catch (e) {
      tentativa++;
      await new Promise(resolve => setTimeout(resolve, 500 * tentativa));
    }
  }
  console.timeEnd('reconectar');
  return false;
}

async function main() {
  console.time('main');
  try {
    // Desativar escrita em disco durante inicialização
    logger.transports[1].silent = true;

    // Inicializar exchanges e bot
    await initializeExchangesAndBot();

    // Verificar conexão
    if (!(await reconectar())) {
      logger.warn('Conexão inicial falhou, tentando novamente em 5s');
      setTimeout(main, 5000);
      return;
    }

    // Reativar escrita em arquivo
    logger.transports[1].silent = false;

    // Iniciar verificação de condições
    await checkConditions();
    setInterval(async () => {
      if (await reconectar()) await checkConditions();
    }, config.INTERVALO_ALERTA_3M_MS);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
    setTimeout(main, 5000);
  }
  console.timeEnd('main');
}

main();
