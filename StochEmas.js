require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
// ================= CONFIGURAÇÃO ================= //
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT").split(","),
  INTERVALO_ALERTA_4H_MS: 15 * 60 * 1000, // 15 minutos
  TEMPO_COOLDOWN_MS: 60 * 60 * 1000, // 1 hora
  RSI_PERIOD: 14,
  STOCHASTIC_PERIOD_K: 5,
  STOCHASTIC_SMOOTH_K: 3,
  STOCHASTIC_PERIOD_D: 3,
  STOCHASTIC_BUY_MAX: 70, // Limite máximo para compra (4h e Diário)
  STOCHASTIC_SELL_MIN: 75, // Limite mínimo para venda (4h e Diário)
  LSR_BUY_MAX: 2.5, // Limite máximo de LSR para compra
  LSR_SELL_MIN: 2.6, // Limite mínimo de LSR para venda
  CACHE_TTL: 10 * 60 * 1000, // 10 minutos
  MAX_CACHE_SIZE: 100,
  MAX_HISTORICO_ALERTAS: 10,
  BUY_TOLERANCE_PERCENT: 0.025, // 2.5% abaixo do preço de alerta para entrada de compra
  ATR_MULTIPLIER_BUY: 1.5, // Multiplicador ATR para entrada máxima de compra
  ATR_MULTIPLIER_SELL: 1.5, // Multiplicador ATR para entrada mínima de venda
  LOG_MAX_SIZE: '100m', // Tamanho máximo de cada arquivo de log
  LOG_MAX_FILES: 2, // Manter logs dos últimos 2 dias
  LOG_CLEANUP_INTERVAL_MS: 2 * 24 * 60 * 60 * 1000, // 2 dias em milissegundos
  VOLUME_LOOKBACK: 20, // Período de lookback para calcular volume médio (candles de 3m)
  VOLUME_MULTIPLIER: 1.5, // Multiplicador para considerar volume "anormal" (ex: 1.5x o médio)
};
// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: 'logs/simple_trading_bot_error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      filename: 'logs/simple_trading_bot_combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.LOG_MAX_SIZE,
      maxFiles: config.LOG_MAX_FILES,
      zippedArchive: true,
    }),
    new winston.transports.Console()
  ]
});
// Estado global
const state = {
  ultimoAlertaPorAtivo: {},
  ultimoEstocastico: {},
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
// ================= LIMPEZA DE ARQUIVOS ANTIGOS ================= //
async function cleanupOldLogs() {
  try {
    const logDir = path.join(__dirname, 'logs');
    const files = await fs.readdir(logDir).catch(() => []);
    const now = Date.now();
    const maxAgeMs = config.LOG_CLEANUP_INTERVAL_MS; // 2 dias em milissegundos
    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats) continue; // Pula se o arquivo não for acessível
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath);
        logger.info(`Arquivo de log antigo excluído: ${filePath}`);
      } else {
        logger.info(`Arquivo de log mantido: ${filePath} (idade: ${(now - stats.mtimeMs) / (24 * 60 * 60 * 1000)} dias)`);
      }
    }
  } catch (e) {
    logger.error(`Erro ao limpar logs antigos: ${e.message}`);
  }
}
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
// ================= INDICADORES ================= //
function normalizeOHLCV(data) {
  const normalized = data.map(c => ({
    time: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  })).filter(c => !isNaN(c.close) && !isNaN(c.volume));
  if (normalized.length < data.length) {
    logger.warn(`Filtrados ${data.length - normalized.length} candles inválidos durante normalização. Candles válidos: ${normalized.length}`);
  }
  return normalized;
}
function calculateRSI(data) {
  if (!data || data.length < config.RSI_PERIOD + 1) {
    logger.warn(`Dados insuficientes para RSI: ${data?.length || 0} candles, necessário ${config.RSI_PERIOD + 1}`);
    return [];
  }
  const rsi = TechnicalIndicators.RSI.calculate({
    period: config.RSI_PERIOD,
    values: data.map(d => d.close || d[4])
  });
  return rsi.filter(v => !isNaN(v));
}
function calculateStochastic(data) {
  if (!data || data.length < config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2) {
    logger.warn(`Dados insuficientes para Estocástico: ${data?.length || 0} candles, necessário ${config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D - 2}`);
    return null;
  }
  const highs = data.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = data.map(c => c.low || c[3]).filter(l => !isNaN(l));
  const closes = data.map(c => c.close || c[4]).filter(cl => !isNaN(cl));
  if (highs.length < config.STOCHASTIC_PERIOD_K || lows.length < config.STOCHASTIC_PERIOD_K || closes.length < config.STOCHASTIC_PERIOD_K) {
    logger.warn(`Dados insuficientes após filtragem para Estocástico: highs=${highs.length}, lows=${lows.length}, closes=${closes.length}`);
    return null;
  }
  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: config.STOCHASTIC_PERIOD_K,
    signalPeriod: config.STOCHASTIC_PERIOD_D,
    smoothing: config.STOCHASTIC_SMOOTH_K
  });
  return result.length ? { k: parseFloat(result[result.length - 1].k.toFixed(2)), d: parseFloat(result[result.length - 1].d.toFixed(2)) } : null;
}
function calculateATR(data) {
  if (!data || data.length < 14) {
    logger.warn(`Dados insuficientes para ATR: ${data?.length || 0} candles, necessário 14`);
    return [];
  }
  const atr = TechnicalIndicators.ATR.calculate({
    period: 14,
    high: data.map(c => c.high || c[2]),
    low: data.map(c => c.low || c[3]),
    close: data.map(c => c.close || c[4])
  });
  return atr.filter(v => !isNaN(v));
}
function calculateEMA(data, period) {
  if (!data || data.length < period) {
    logger.warn(`Dados insuficientes para EMA${period}: ${data?.length || 0} candles, necessário ${period}`);
    return [];
  }
  const ema = TechnicalIndicators.EMA.calculate({
    period,
    values: data.map(d => d.close || d[4])
  });
  if (ema.length === 0) {
    logger.warn(`EMA${period} retornou array vazio, verifique valores de fechamento: ${JSON.stringify(data.map(d => d.close).slice(-5))}`);
  }
  return ema.filter(v => !isNaN(v));
}
function calculateVWAP(data) {
  if (!data || data.length < 1) {
    logger.warn(`Dados insuficientes para VWAP: ${data?.length || 0} candles`);
    return null;
  }
  let totalVolume = 0;
  let volumePriceSum = 0;
  data.forEach(candle => {
    const typicalPrice = ((candle.high || candle[2]) + (candle.low || candle[3]) + (candle.close || candle[4])) / 3;
    const volume = candle.volume || candle[5];
    if (!isNaN(typicalPrice) && !isNaN(volume)) {
      volumePriceSum += typicalPrice * volume;
      totalVolume += volume;
    }
  });
  return totalVolume > 0 ? volumePriceSum / totalVolume : null;
}
function isAbnormalVolume(ohlcv) {
  if (!ohlcv || ohlcv.length < config.VOLUME_LOOKBACK + 1) {
    logger.warn(`Dados insuficientes para volume anormal: ${ohlcv?.length || 0} candles, necessário ${config.VOLUME_LOOKBACK + 1}`);
    return false;
  }
  const volumes = ohlcv.slice(-config.VOLUME_LOOKBACK - 1, -1).map(c => c.volume).filter(v => !isNaN(v));
  if (volumes.length < config.VOLUME_LOOKBACK) {
    logger.warn(`Volumes insuficientes para cálculo médio: ${volumes.length}`);
    return false;
  }
  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
  const currentVolume = ohlcv[ohlcv.length - 1].volume;
  return currentVolume > avgVolume * config.VOLUME_MULTIPLIER;
}
function detectarQuebraEstrutura(ohlcv, atr) {
  if (!ohlcv || ohlcv.length < 2 || !atr) {
    logger.warn(`Dados insuficientes para detectar quebra de estrutura: ohlcv=${ohlcv?.length || 0}, atr=${atr}`);
    return { suporte: 0, resistencia: 0 };
  }
  const lookbackPeriod = 50;
  const previousCandles = ohlcv.slice(0, -1).slice(-lookbackPeriod);
  const highs = previousCandles.map(c => c.high || c[2]).filter(h => !isNaN(h));
  const lows = previousCandles.map(c => c.low || c[3]).filter(l => !isNaN(l));
  if (highs.length === 0 || lows.length === 0) {
    logger.warn(`Nenhum dado válido para quebra de estrutura: highs=${highs.length}, lows=${lows.length}`);
    return { suporte: 0, resistencia: 0 };
  }
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  return {
    suporte: minLow - 0.5 * atr,
    resistencia: maxHigh + 0.5 * atr
  };
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
    logger.warn(`Dados insuficientes de Funding Rate para ${symbol}: ${fundingData?.length || 0} registros`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return getCachedData(cacheKey) || { current: null, isRising: false, percentChange: '0.00' };
  }
}
// ================= FUNÇÕES DE ALERTAS ================= //
function getStochasticEmoji(value) {
  if (!value && value !== 0) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}
function getVWAPEmoji(price, vwap) {
  if (!vwap || isNaN(price)) return "";
  const diff = Math.abs(price - vwap) / vwap;
  return diff < 0.01 ? "✅" : price > vwap ? "🔴" : "🟢";
}
function getSetaDirecao(current, previous) {
  if (current === undefined || previous === undefined) return "➡️";
  return current > previous ? "⬆️" : current < previous ? "⬇️" : "➡️";
}
async function sendAlertStochasticCross(symbol, data) {
  const { ohlcv15m, ohlcv4h, ohlcv1h, ohlcvDiario, price, rsi1h, lsr, fundingRate, estocastico4h, estocasticoD, atr, ema13_15m, ema34_15m, ema55_15m, ema13_15m_prev, ema34_15m_prev, vwap1h } = data;
  const agora = Date.now();
  if (!state.ultimoAlertaPorAtivo[symbol]) state.ultimoAlertaPorAtivo[symbol] = { historico: [] };
  if (state.ultimoAlertaPorAtivo[symbol]['4h'] && agora - state.ultimoAlertaPorAtivo[symbol]['4h'] < config.TEMPO_COOLDOWN_MS) return;
  const precision = price < 1 ? 8 : price < 10 ? 6 : price < 100 ? 4 : 2;
  const format = v => isNaN(v) ? 'N/A' : v.toFixed(precision);
  const zonas = detectarQuebraEstrutura(ohlcv15m, atr);
  // Calcular preços de entrada com tolerância baseada em ATR
  const buyEntryLow = price * (1 - config.BUY_TOLERANCE_PERCENT); // 2.5% abaixo do preço atual
  const buyEntryMax = price + (atr * config.ATR_MULTIPLIER_BUY); // Entrada máxima com ATR
  const sellEntryHigh = price * (1 + config.BUY_TOLERANCE_PERCENT); // 2.5% acima do preço atual
  const buyStopLoss = price - (atr * config.ATR_MULTIPLIER_BUY); // Stop Loss para Compra
  const sellStopLoss = price + (atr * config.ATR_MULTIPLIER_SELL); // Stop Loss para Venda
  const sellEntryMin = price - (atr * config.ATR_MULTIPLIER_SELL); // Entrada mínima com ATR
  const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${symbol.replace('/', '')}&interval=15`;
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
    ? `${fundingRateEmoji} ${(fundingRate.current * 100).toFixed(5)}% ${fundingRate.isRising ? '⬆️' : '⬇️'}`
    : '🔹 Indisp.';
  const vwap1hText = vwap1h ? `${getVWAPEmoji(price, vwap1h)} VWAP 1h: ${format(vwap1h)}` : '🔹 VWAP Indisp.';
  if (!state.ultimoEstocastico[symbol]) state.ultimoEstocastico[symbol] = {};
  const kAnteriorD = state.ultimoEstocastico[symbol].kD || estocasticoD?.k || 0;
  const kAnterior4h = state.ultimoEstocastico[symbol].k4h || estocastico4h?.k || 0;
  state.ultimoEstocastico[symbol].kD = estocasticoD?.k;
  state.ultimoEstocastico[symbol].k4h = estocastico4h?.k;
  const direcaoD = getSetaDirecao(estocasticoD?.k, kAnteriorD);
  const direcao4h = getSetaDirecao(estocastico4h?.k, kAnterior4h);
  const stochDEmoji = estocasticoD ? getStochasticEmoji(estocasticoD.k) : "";
  const stoch4hEmoji = estocastico4h ? getStochasticEmoji(estocastico4h.k) : "";
  let alertText = '';
  // Condições para compra: %K > %D (4h), %K <= 70 (4h e Diário), RSI 1h < 60, LSR < 2.5, EMA 13 > EMA 34 (15m), preço > EMA 55 (15m) - EMA 13 e 34 no candle fechado anterior
  const isBuySignal = estocastico4h && estocasticoD &&
                      estocastico4h.k > estocastico4h.d &&
                      estocastico4h.k <= config.STOCHASTIC_BUY_MAX &&
                      estocasticoD.k <= config.STOCHASTIC_BUY_MAX &&
                      (lsr.value === null || lsr.value < config.LSR_BUY_MAX) &&
                      ema13_15m_prev > ema34_15m_prev &&
                      ema55_15m !== null && price > ema55_15m &&
                      data.isAbnormalVol;
  // Condições para venda: %K < %D (4h), %K >= 75 (4h e Diário), RSI 1h > 60, EMA 13 < EMA 34 (15m), preço < EMA 55 (15m) - EMA 13 e 34 no candle fechado anterior
  const isSellSignal = estocastico4h && estocasticoD &&
                       estocastico4h.k < estocastico4h.d &&
                       estocastico4h.k >= config.STOCHASTIC_SELL_MIN &&
                       estocasticoD.k >= config.STOCHASTIC_SELL_MIN &&
                       ema13_15m_prev < ema34_15m_prev &&
                       ema55_15m !== null && price < ema55_15m &&
                       data.isAbnormalVol;
  // Configurar texto da EMA 55 com emoji
  let ema55Text = '';
  let ema55Emoji = '';
  if (ema55_15m !== null) {
    if (price > ema55_15m) {
      ema55Text = `🔹 #15m (${format(ema55_15m)}), Bullish 🟢`;
      ema55Emoji = '✅';
    } else if (price < ema55_15m) {
      ema55Text = `🔹 #15m (${format(ema55_15m)}), Bearish 🔴`;
      ema55Emoji = '✅';
    }
  } else {
    ema55Text = `🔹 EMA 55 15m: Indisponível`;
    ema55Emoji = '';
  }
  if (isBuySignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r =>
      r.direcao === 'buy' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_MS
    );
    if (!foiAlertado) {
      alertText = `💹*Bull Vol⤴️ Compra*\n\n` +
                  `🔹Ativo: $${symbol} [- TradingView](${tradingViewLink})\n` +
                  `💲 Preço Atual: ${format(price)}\n` +
                  `🤖📈Análise de Compra / Retração: ${format(zonas.suporte)}...${format(buyEntryLow)}\n` +
                  `🛑 Stop abaixo de: ${format(zonas.suporte)}\n` +
                  `🔹RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹Fund. R: ${fundingRateText}\n` +
                  `🔹 ${vwap1hText} ${ema55Emoji}\n` +
                  `🔹 Stoch #1D %K: ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
                  `🔹 Stoch #4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
                  `🔹 Suporte: ${format(zonas.suporte)}\n` +
                  `🔹 Resistência: ${format(zonas.resistencia)}\n` +
                  `${ema55Text}\n` +
                  ` ☑︎ Gerencie seu Risco-🤖 @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['4h'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'buy', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      logger.info(`Sinal de compra detectado para ${symbol}: Preço=${format(price)}, Entrada Ideal=${format(buyEntryLow)}, Entrada Máxima=${format(buyEntryMax)}, Stoch 4h K=${estocastico4h.k}, D=${estocastico4h.d}, Stoch Diário K=${estocasticoD.k}, RSI 1h=${rsi1h.toFixed(2)}, LSR=${lsr.value ? lsr.value.toFixed(2) : 'N/A'}, VWAP 1h=${vwap1h ? format(vwap1h) : 'N/A'}, EMA 55 15m=${ema55_15m ? format(ema55_15m) : 'N/A'}`);
    }
  } else if (isSellSignal) {
    const foiAlertado = state.ultimoAlertaPorAtivo[symbol].historico.some(r =>
      r.direcao === 'sell' && (agora - r.timestamp) < config.TEMPO_COOLDOWN_MS
    );
    if (!foiAlertado) {
      alertText = `♦️*Bear Correção⤵️*\n\n` +
                  `🔹Ativo: $${symbol} [- TradingView](${tradingViewLink})\n` +
                  `💲 Preço Atual: ${format(price)}\n` +
                  `🤖📉Análise de Venda / Exaustão: ${format(zonas.resistencia)}...${format(sellEntryHigh)}\n` +
                  `🛑 Stop acima de: ${format(zonas.resistencia)}\n` +
                  `🔹 RSI 1h: ${rsi1h.toFixed(2)} ${rsi1hEmoji}\n` +
                  `🔹 LSR: ${lsr.value ? lsr.value.toFixed(2) : '🔹Spot'} ${lsrSymbol} (${lsr.percentChange}%)\n` +
                  `🔹 Fund. R: ${fundingRateText}\n` +
                  `🔹 ${vwap1hText} ${ema55Emoji}\n` +
                  `🔹 Stoch #1D : ${estocasticoD ? estocasticoD.k.toFixed(2) : '--'} ${stochDEmoji} ${direcaoD}\n` +
                  `🔹 Stoch #4H %K: ${estocastico4h ? estocastico4h.k.toFixed(2) : '--'} ${stoch4hEmoji} ${direcao4h}\n` +
                  `🟰 Suporte: ${format(zonas.suporte)}\n` +
                  `🟰 Resistência: ${format(zonas.resistencia)}\n` +
                  `${ema55Text}\n` +
                  ` ☑︎ Gerencie seu Risco-🤖 @J4Rviz\n`;
      state.ultimoAlertaPorAtivo[symbol]['4h'] = agora;
      state.ultimoAlertaPorAtivo[symbol].historico.push({ direcao: 'sell', timestamp: agora });
      state.ultimoAlertaPorAtivo[symbol].historico = state.ultimoAlertaPorAtivo[symbol].historico.slice(-config.MAX_HISTORICO_ALERTAS);
      logger.info(`Sinal de venda detectado para ${symbol}: Preço=${format(price)}, Entrada Ideal=${format(sellEntryHigh)}, Entrada Mínima=${format(sellEntryMin)}, Stoch 4h K=${estocastico4h.k}, D=${estocastico4h.d}, Stoch Diário K=${estocasticoD.k}, RSI 1h=${rsi1h.toFixed(2)}, LSR=${lsr.value ? lsr.value.toFixed(2) : 'N/A'}, VWAP 1h=${vwap1h ? format(vwap1h) : 'N/A'}, EMA 55 15m=${ema55_15m ? format(ema55_15m) : 'N/A'}`);
    }
  }
  if (alertText) {
    try {
      await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, alertText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }));
      logger.info(`Alerta de sinal estocástico enviado para ${symbol}`);
    } catch (e) {
      logger.error(`Erro ao enviar alerta para ${symbol}: ${e.message}`);
    }
  }
}
async function checkConditions() {
  try {
    await limitConcurrency(config.PARES_MONITORADOS, async (symbol) => {
      const cacheKeyPrefix = `ohlcv_${symbol}`;
      const ohlcv3mRaw = getCachedData(`${cacheKeyPrefix}_3m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '3m', undefined, config.VOLUME_LOOKBACK + 1));
      const ohlcv15mRaw = getCachedData(`${cacheKeyPrefix}_15m`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 90));
      const ohlcv4hRaw = getCachedData(`${cacheKeyPrefix}_4h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '4h', undefined, config.STOCHASTIC_PERIOD_K + config.STOCHASTIC_SMOOTH_K + config.STOCHASTIC_PERIOD_D));
      const ohlcv1hRaw = getCachedData(`${cacheKeyPrefix}_1h`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 60)); // Aumentado para 60 candles para suportar EMA 55 se necessário
      const ohlcvDiarioRaw = getCachedData(`${cacheKeyPrefix}_1d`) || await withRetry(() => exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 20));
      setCachedData(`${cacheKeyPrefix}_3m`, ohlcv3mRaw);
      setCachedData(`${cacheKeyPrefix}_15m`, ohlcv15mRaw);
      setCachedData(`${cacheKeyPrefix}_4h`, ohlcv4hRaw);
      setCachedData(`${cacheKeyPrefix}_1h`, ohlcv1hRaw);
      setCachedData(`${cacheKeyPrefix}_1d`, ohlcvDiarioRaw);
      if (!ohlcv3mRaw || !ohlcv15mRaw || !ohlcv4hRaw || !ohlcv1hRaw || !ohlcvDiarioRaw) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}: 3m=${ohlcv3mRaw?.length || 0}, 15m=${ohlcv15mRaw?.length || 0}, 4h=${ohlcv4hRaw?.length || 0}, 1h=${ohlcv1hRaw?.length || 0}, 1d=${ohlcvDiarioRaw?.length || 0}`);
        return;
      }
      const ohlcv3m = normalizeOHLCV(ohlcv3mRaw);
      const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
      const ohlcv4h = normalizeOHLCV(ohlcv4hRaw);
      const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
      const ohlcvDiario = normalizeOHLCV(ohlcvDiarioRaw);
      logger.info(`Dados normalizados para ${symbol}: 3m=${ohlcv3m.length}, 15m=${ohlcv15m.length}, 4h=${ohlcv4h.length}, 1h=${ohlcv1h.length}, 1d=${ohlcvDiario.length}`);
      if (!ohlcv3m.length || !ohlcv15m.length || !ohlcv4h.length || !ohlcv1h.length || !ohlcvDiario.length) {
        logger.warn(`Dados normalizados insuficientes para ${symbol}: 3m=${ohlcv3m.length}, 15m=${ohlcv15m.length}, 4h=${ohlcv4h.length}, 1h=${ohlcv1h.length}, 1d=${ohlcvDiario.length}`);
        return;
      }
      const closes15m = ohlcv15m.map(c => c.close).filter(c => !isNaN(c));
      const currentPrice = closes15m[closes15m.length - 1];
      if (isNaN(currentPrice)) {
        logger.warn(`Preço atual inválido para ${symbol}, pulando...`);
        return;
      }
      const rsi1hValues = calculateRSI(ohlcv1h);
      const estocastico4h = calculateStochastic(ohlcv4h);
      const estocasticoD = calculateStochastic(ohlcvDiario);
      const lsr = await fetchLSR(symbol);
      const fundingRate = await fetchFundingRate(symbol);
      const atrValues = calculateATR(ohlcv15m);
      const ema13_15mValues = calculateEMA(ohlcv15m, 13);
      const ema34_15mValues = calculateEMA(ohlcv15m, 34);
      const ema55_15mValues = calculateEMA(ohlcv15m, 55);
      const vwap1h = calculateVWAP(ohlcv1h);
      const isAbnormalVol = isAbnormalVolume(ohlcv3m);
      if (!rsi1hValues.length || !estocastico4h || !estocasticoD || !atrValues.length || ema13_15mValues.length < 2 || ema34_15mValues.length < 2 || !ema55_15mValues.length) {
        logger.warn(`Indicadores insuficientes para ${symbol}: RSI=${rsi1hValues.length}, Stoch4h=${estocastico4h}, StochD=${estocasticoD}, ATR=${atrValues.length}, EMA13(15m)=${ema13_15mValues.length}, EMA34(15m)=${ema34_15mValues.length}, EMA55(15m)=${ema55_15mValues.length}`);
        return;
      }
      await sendAlertStochasticCross(symbol, {
        ohlcv15m,
        ohlcv4h,
        ohlcv1h,
        ohlcvDiario,
        price: currentPrice,
        rsi1h: rsi1hValues[rsi1hValues.length - 1],
        lsr,
        fundingRate,
        estocastico4h,
        estocasticoD,
        atr: atrValues[atrValues.length - 1],
        ema13_15m: ema13_15mValues[ema13_15mValues.length - 1],
        ema34_15m: ema34_15mValues[ema34_15mValues.length - 1],
        ema55_15m: ema55_15mValues[ema55_15mValues.length - 1],
        ema13_15m_prev: ema13_15mValues[ema13_15mValues.length - 2],
        ema34_15m_prev: ema34_15mValues[ema34_15mValues.length - 2],
        vwap1h,
        isAbnormalVol
      });
    }, 5);
  } catch (e) {
    logger.error(`Erro ao processar condições: ${e.message}`);
  }
}
async function main() {
  logger.info('Iniciando simple trading bot');
  try {
    await fs.mkdir(path.join(__dirname, 'logs'), { recursive: true });
    await cleanupOldLogs(); // Executar limpeza imediatamente na inicialização
    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, '🤖 Titanium 133455VOL...'));
    await checkConditions();
    setInterval(checkConditions, config.INTERVALO_ALERTA_4H_MS);
    setInterval(cleanupOldLogs, config.LOG_CLEANUP_INTERVAL_MS); // Agendar limpeza a cada 2 dias
    logger.info(`Limpeza de logs agendada a cada ${config.LOG_CLEANUP_INTERVAL_MS / (24 * 60 * 60 * 1000)} dias`);
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`);
  }
}
main().catch(e => logger.error(`Erro fatal: ${e.message}`));
