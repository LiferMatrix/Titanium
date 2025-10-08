require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const INTERVALO_RELATORIO_15M_MS = 15 * 60 * 1000;
const INTERVALO_ANALISE_AUTOMATICA_MS = 30 * 60 * 1000;
const INTERVALO_MONITORAMENTO_TEMPO_REAL_MS = 5 * 60 * 1000;
const API_DELAY_MS = 500;
const ALERTA_COOLDOWN_S = 3600;

const MONITORED_PAIRS = [
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'ADA/USDT', 'XRP/USDT', 'SOL/USDT', 'LINK/USDT'
];

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'crypto_analysis_bot.log' }),
    new winston.transports.Console()
  ]
});

const ultimoEstocastico = {};
const ultimoRSI = {};
const ultimaEstrutura = {};
const ultimoAlertaTempo = {};

function validateEnv() {
  const required = ['BINANCE_API_KEY', 'BINANCE_SECRET_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  for (const key of required) {
    if (!process.env[key]) {
      logger.error(`Variável de ambiente ausente: ${key}`);
      process.exit(1);
    }
  }
}
validateEnv();

const bot = new Bot(TELEGRAM_BOT_TOKEN);

const exchangeSpot = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 60000,
  options: { defaultType: 'spot' }
});

const exchangeFutures = new ccxt.binance({
  apiKey: process.env.BINANCE_API_KEY,
  secret: process.env.BINANCE_SECRET_KEY,
  enableRateLimit: true,
  timeout: 30000,
  options: { defaultType: 'future' }
});

const rsiPeriod = 14;

// Funções de indicadores
function calculateRSI(data) {
  if (!data || data.length < rsiPeriod + 1) return null;
  return TechnicalIndicators.RSI.calculate({
    period: rsiPeriod,
    values: data.map(d => d.close)
  });
}

function calculateCVD(data) {
  let cvd = 0;
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    if (curr[4] > curr[1]) cvd += curr[5];
    else if (curr[4] < curr[1]) cvd -= curr[5];
  }
  return cvd;
}

function calculateOBV(data) {
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    const prev = data[i - 1];
    if (curr[4] > prev[4]) obv += curr[5];
    else if (curr[4] < prev[4]) obv -= curr[5];
  }
  return obv;
}

function calculateVWAP(ohlcv) {
  if (!ohlcv || ohlcv.length < 1) return { vwap: null, max: null, min: null };
  
  let totalVolume = 0;
  let totalPriceVolume = 0;

  ohlcv.forEach(candle => {
    const typicalPrice = (candle[2] + candle[3] + candle[4]) / 3;
    const volume = candle[5];
    totalPriceVolume += typicalPrice * volume;
    totalVolume += volume;
  });

  const vwap = totalVolume > 0 ? totalPriceVolume / totalVolume : null;
  if (!vwap) return { vwap: null, max: null, min: null };

  const vwapMax = vwap * 1.01;
  const vwapMin = vwap * 0.99;

  return { vwap: vwap.toFixed(4), max: vwapMax.toFixed(4), min: vwapMin.toFixed(4) };
}

function detectarQuebraEstrutura(ohlcv15m) {
  if (!ohlcv15m || ohlcv15m.length < 2) {
    return {
      estruturaAlta: 0,
      estruturaBaixa: 0,
      buyLiquidityZones: [],
      sellLiquidityZones: []
    };
  }

  const highs = ohlcv15m.map(c => c.high).filter(h => !isNaN(h) && h !== null);
  const lows = ohlcv15m.map(c => c.low).filter(l => !isNaN(l) && l !== null);
  const volumes = ohlcv15m.map(c => c.volume).filter(v => !isNaN(v) && v !== null);

  if (highs.length === 0 || lows.length === 0 || volumes.length === 0) {
    return {
      estruturaAlta: 0,
      estruturaBaixa: 0,
      buyLiquidityZones: [],
      sellLiquidityZones: []
    };
  }

  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const volumeThreshold = Math.max(...volumes) * 0.7;

  const buyLiquidityZones = [];
  const sellLiquidityZones = [];

  ohlcv15m.forEach(candle => {
    if (candle.volume >= volumeThreshold && !isNaN(candle.low) && !isNaN(candle.high)) {
      if (candle.low <= minLow * 1.01) {
        buyLiquidityZones.push(candle.low);
      }
      if (candle.high >= maxHigh * 0.99) {
        sellLiquidityZones.push(candle.high);
      }
    }
  });

  const uniqueBuyZones = [...new Set(buyLiquidityZones.filter(z => !isNaN(z)).sort((a, b) => b - a))].slice(0, 2);
  const uniqueSellZones = [...new Set(sellLiquidityZones.filter(z => !isNaN(z)).sort((a, b) => a - b))].slice(0, 2);

  return {
    estruturaAlta: isNaN(maxHigh) ? 0 : maxHigh,
    estruturaBaixa: isNaN(minLow) ? 0 : minLow,
    buyLiquidityZones: uniqueBuyZones.length > 0 ? uniqueBuyZones : [minLow].filter(z => !isNaN(z)),
    sellLiquidityZones: uniqueSellZones.length > 0 ? uniqueSellZones : [maxHigh].filter(z => !isNaN(z))
  };
}

function calculateStochastic(data, periodK = 5, smoothK = 3, periodD = 3) {
  if (!data || data.length < periodK + smoothK + periodD - 2) {
    logger.warn(`Dados insuficientes para calcular estocástico: ${data?.length || 0} velas`);
    return null;
  }

  const highs = data.map(c => c.high).filter(h => !isNaN(h) && h !== null);
  const lows = data.map(c => c.low).filter(l => !isNaN(l) && l !== null);
  const closes = data.map(c => c.close).filter(cl => !isNaN(cl) && cl !== null);

  if (highs.length < periodK || lows.length < periodK || closes.length < periodK) {
    logger.warn(`Dados filtrados insuficientes: highs=${highs.length}, lows=${lows.length}, closes=${closes.length}`);
    return null;
  }

  const result = TechnicalIndicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: periodK,
    signalPeriod: periodD,
    smoothing: smoothK
  });

  if (!result || result.length === 0) {
    logger.warn('Nenhum resultado do cálculo estocástico');
    return null;
  }

  const lastResult = result[result.length - 1];
  return {
    k: parseFloat(lastResult.k.toFixed(2)),
    d: parseFloat(lastResult.d.toFixed(2))
  };
}

function getStochasticEmoji(value) {
  if (!value) return "";
  return value < 10 ? "🔵" : value < 25 ? "🟢" : value <= 55 ? "🟡" : value <= 70 ? "🟠" : value <= 80 ? "🔴" : "💥";
}

function getSetaDirecao(current, previous) {
  if (!current || !previous) return "➡️";
  if (current > previous) return "⬆️";
  if (current < previous) return "⬇️";
  return "➡️";
}

async function fetchLSR(symbol) {
  try {
    const accountRes = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    });
    const accountLSR = accountRes.data && accountRes.data.length >= 2 ? {
      value: parseFloat(accountRes.data[0].longShortRatio),
      status: parseFloat(accountRes.data[0].longShortRatio) > parseFloat(accountRes.data[1].longShortRatio) ? "⬆️ Subindo" : "⬇️ Caindo",
      percentChange: accountRes.data[1].longShortRatio > 0 ? ((parseFloat(accountRes.data[0].longShortRatio) - parseFloat(accountRes.data[1].longShortRatio)) / parseFloat(accountRes.data[1].longShortRatio) * 100).toFixed(2) : 0
    } : { value: null, status: "🔹 Indisponível", percentChange: 0 };

    const positionRes = await axios.get('https://fapi.binance.com/futures/data/topLongShortPositionRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    });
    const positionLSR = positionRes.data && positionRes.data.length >= 2 ? {
      value: parseFloat(positionRes.data[0].longShortRatio),
      status: parseFloat(positionRes.data[0].longShortRatio) > parseFloat(positionRes.data[1].longShortRatio) ? "⬆️ Subindo" : "⬇️ Caindo",
      percentChange: positionRes.data[1].longShortRatio > 0 ? ((parseFloat(positionRes.data[0].longShortRatio) - parseFloat(accountRes.data[1].longShortRatio)) / parseFloat(accountRes.data[1].longShortRatio) * 100).toFixed(2) : 0
    } : { value: null, status: "🔹 Indisponível", percentChange: 0 };

    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    return { account: accountLSR, position: positionLSR };
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return {
      account: { value: null, status: "🔹 Indisponível", percentChange: 0 },
      position: { value: null, status: "🔹 Indisponível", percentChange: 0 }
    };
  }
}

async function fetchOpenInterest(symbol, timeframe) {
  try {
    const oiData = await exchangeFutures.fetchOpenInterestHistory(symbol, timeframe, undefined, 2);
    if (oiData && oiData.length >= 2) {
      const currentOI = oiData[oiData.length - 1].openInterest;
      const previousOI = oiData[oiData.length - 2].openInterest;
      const percentChange = previousOI > 0 ? ((currentOI - previousOI) / previousOI * 100).toFixed(2) : 0;
      await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      return {
        value: currentOI,
        status: currentOI > previousOI ? `⬆️ +${percentChange}%` : `⬇️ ${percentChange}%`,
        percentChange: parseFloat(percentChange)
      };
    }
    return { value: null, status: "🔹 Indisponível", percentChange: 0 };
  } catch (e) {
    logger.warn(`Erro ao buscar Open Interest para ${symbol} no timeframe ${timeframe}: ${e.message}`);
    return { value: null, status: "🔹 Indisponível", percentChange: 0 };
  }
}

async function fetchTotalOpenInterest(symbol) {
  try {
    const res = await axios.get('https://fapi.binance.com/fapi/v1/openInterest', {
      params: { symbol: symbol.replace('/', '') }
    });
    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    return res.data && res.data.sumOpenInterestValue ? parseFloat(res.data.sumOpenInterestValue).toFixed(2) : null;
  } catch (e) {
    logger.warn(`Erro ao buscar Open Interest total para ${symbol}: ${e.message}`);
    return null;
  }
}

async function fetchOrderBook(symbol) {
  try {
    const orderBook = await exchangeSpot.fetchOrderBook(symbol, 10);
    if (!orderBook.bids || !orderBook.asks || orderBook.bids.length === 0 || orderBook.asks.length === 0) {
      return { bids: [], asks: [], totalBidVolume: 0, totalAskVolume: 0 };
    }

    const bids = orderBook.bids.map(([price, amount]) => ({ price, amount })).slice(0, 5);
    const asks = orderBook.asks.map(([price, amount]) => ({ price, amount })).slice(0, 5);
    const totalBidVolume = bids.reduce((sum, bid) => sum + bid.amount, 0);
    const totalAskVolume = asks.reduce((sum, ask) => sum + ask.amount, 0);

    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    return { bids, asks, totalBidVolume, totalAskVolume };
  } catch (e) {
    logger.warn(`Erro ao buscar order book para ${symbol}: ${e.message}`);
    return { bids: [], asks: [], totalBidVolume: 0, totalAskVolume: 0 };
  }
}

async function fetchFundingRate(symbol) {
  try {
    const fundingData = await exchangeFutures.fetchFundingRateHistory(symbol, undefined, 2);
    if (fundingData && fundingData.length >= 2) {
      const currentFunding = fundingData[fundingData.length - 1].fundingRate;
      const previousFunding = fundingData[fundingData.length - 2].fundingRate;
      await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      return {
        current: currentFunding,
        status: currentFunding > previousFunding ? "⬆️ Subindo" : "⬇️ Caindo"
      };
    }
    return { current: null, status: "🔹 Indisponível" };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return { current: null, status: "🔹 Indisponível" };
  }
}

function calculateFibonacciLevels(ohlcvDiario) {
  const highs = ohlcvDiario.map(c => c[2]).filter(h => !isNaN(h) && h !== null);
  const lows = ohlcvDiario.map(c => c[3]).filter(l => !isNaN(l) && l !== null);
  if (highs.length === 0 || lows.length === 0) return null;

  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const range = maxHigh - minLow;

  return {
    '0.0': minLow,
    '23.6': minLow + range * 0.236,
    '38.2': minLow + range * 0.382,
    '50.0': minLow + range * 0.5,
    '61.8': minLow + range * 0.618,
    '78.6': minLow + range * 0.786,
    '100.0': maxHigh
  };
}

function analyzeWyckoff(ohlcvDiario, ohlcv4h, volume24hAtual, volume24hAnterior) {
  const lastCandle = ohlcvDiario[ohlcvDiario.length - 1];
  const prevCandle = ohlcvDiario[ohlcvDiario.length - 2];
  const volumeIncreasing = volume24hAtual > volume24hAnterior;
  const price = lastCandle[4];
  const prevPrice = prevCandle[4];
  const priceDirection = price > prevPrice ? "⬆️ Subindo" : "⬇️ Caindo";

  let wyckoffPhase = "Indefinida";
  let wyckoffAnalysis = "";

  if (volumeIncreasing && priceDirection === "⬆️ Subindo") {
    wyckoffPhase = "Acumulação (Fase B/C) ou Mark-Up";
    wyckoffAnalysis = "📈 Indícios de acumulação ou início de uma tendência de alta.";
  } else if (volumeIncreasing && priceDirection === "⬇️ Caindo") {
    wyckoffPhase = "Distribuição (Fase B/C) ou Mark-Down";
    wyckoffAnalysis = "📉 Indícios de distribuição ou início de uma tendência de baixa.";
  } else if (!volumeIncreasing && price > prevPrice) {
    wyckoffPhase = "Acumulação (Fase A) ou Reacumulação";
    wyckoffAnalysis = "📊 Possível acumulação ou reacumulação.";
  } else {
    wyckoffPhase = "Indefinida";
    wyckoffAnalysis = "⚖️ Mercado em consolidação ou indefinido.";
  }

  return { phase: wyckoffPhase, analysis: wyckoffAnalysis };
}

function analyzeElliott(ohlcv4h) {
  const highs = ohlcv4h.map(c => c[2]).slice(-10);
  const lows = ohlcv4h.map(c => c[3]).slice(-10);
  let waveAnalysis = "";
  let waveStatus = "Indefinida";

  const lastHigh = Math.max(...highs);
  const lastLow = Math.min(...lows);
  const lastPrice = ohlcv4h[ohlcv4h.length - 1][4];
  const prevPrice = ohlcv4h[ohlcv4h.length - 2][4];

  if (lastPrice > prevPrice && lastPrice >= lastHigh * 0.99) {
    waveStatus = "Onda Impulsiva (Possível Onda 3 ou 5)";
    waveAnalysis = "📈 O preço está em uma possível onda impulsiva de alta.";
  } else if (lastPrice < prevPrice && lastPrice <= lastLow * 1.01) {
    waveStatus = "Onda Corretiva (Possível Onda A ou C)";
    waveAnalysis = "📉 O preço está em uma possível onda corretiva.";
  } else {
    waveStatus = "Indefinida";
    waveAnalysis = "⚖️ Sem padrão claro de Elliott Wave no momento.";
  }

  return { status: waveStatus, analysis: waveAnalysis };
}

function determineTargets(fibLevels, zonas, rsi1hVal, rsi15mVal, cvd15mStatus, obv15mStatus, estocasticoD, estocastico4h, wyckoff, elliott, orderBook, lsrData, currentPrice) {
  if (!fibLevels) return { 
    buyTargets: [], 
    sellTargets: [], 
    buyExplanations: [], 
    sellExplanations: [], 
    bestBuyZone: null, 
    bestSellZone: null, 
    breakoutAbove: [], 
    breakoutBelow: [] 
  };

  const price = currentPrice || fibLevels['50.0'];
  const buyTargets = [];
  const sellTargets = [];
  const buyExplanations = [];
  const sellExplanations = [];
  let bestBuyZone = null;
  let bestSellZone = null;
  let bestBuyScore = -1;
  let bestSellScore = -1;
  let bestBuyExplanation = '';
  let bestSellExplanation = '';
  const breakoutAbove = [];
  const breakoutBelow = [];

  const potentialBuyLevels = [
    { level: fibLevels['23.6'], label: '23.6%' },
    { level: fibLevels['38.2'], label: '38.2%' },
    { level: fibLevels['50.0'], label: '50.0%' }
  ].filter(l => l.level < price && l.level > 0);

  const potentialSellLevels = [
    { level: fibLevels['61.8'], label: '61.8%' },
    { level: fibLevels['78.6'], label: '78.6%' },
    { level: fibLevels['100.0'], label: '100.0%' }
  ].filter(l => l.level > price && l.level > 0);

  potentialBuyLevels.forEach(({ level, label }) => {
    let relevance = "";
    let score = 0;

    const nearBuyZone = zonas.buyLiquidityZones.some(z => Math.abs(z - level) / level < 0.01);
    if (nearBuyZone) { relevance += "🟢 Liquidez compra. "; score += 2; }
    if (rsi15mVal < 40 || rsi1hVal < 40) { relevance += "📉 RSI sobrevenda. "; score += 1.5; }
    if (cvd15mStatus === "⬆️ Bullish" || obv15mStatus === "⬆️ Bullish") { relevance += "📈 CVD/OBV bullish. "; score += 1; }
    if ((estocasticoD?.k < 25 && estocasticoD?.k > estocasticoD?.d) || (estocastico4h?.k < 25 && estocastico4h?.k > estocastico4h?.d)) { relevance += "📊 Stoch sobrevenda. "; score += 1.5; }
    if (wyckoff.phase.includes("Acumulação")) { relevance += "📚 Wyckoff acumulação. "; score += 1; }
    if (elliott.status.includes("Onda Corretiva")) { relevance += "🌊 Elliott corretiva. "; score += 1; }
    if (orderBook.totalBidVolume > orderBook.totalAskVolume * 1.2) { relevance += "📖 Bids > Asks. "; score += 1; }
    if (lsrData.account.value > 1.2 || lsrData.position.value > 1.2) { relevance += `📉 LSR bullish. `; score += 1; }

    if (score > 0) {
      buyTargets.push(level);
      buyExplanations.push(`${label} (${level.toFixed(4)}): ${relevance}`);
      if (score > bestBuyScore) {
        bestBuyScore = score;
        bestBuyZone = { level, label };
        bestBuyExplanation = relevance;
      }
    }
  });

  potentialSellLevels.forEach(({ level, label }) => {
    let relevance = "";
    let score = 0;

    const nearSellZone = zonas.sellLiquidityZones.some(z => Math.abs(z - level) / level < 0.01);
    if (nearSellZone) { relevance += "🔴 Liquidez venda. "; score += 2; }
    if (rsi15mVal > 60 || rsi1hVal > 60) { relevance += "📉 RSI sobrecompra. "; score += 1.5; }
    if (cvd15mStatus === "⬇️ Bearish" || obv15mStatus === "⬇️ Bearish") { relevance += "📈 CVD/OBV bearish. "; score += 1; }
    if ((estocasticoD?.k > 75 && estocasticoD?.k < estocasticoD?.d) || (estocastico4h?.k > 75 && estocastico4h?.k < estocastico4h?.d)) { relevance += "📊 Stoch sobrecompra. "; score += 1.5; }
    if (wyckoff.phase.includes("Distribuição")) { relevance += "📚 Wyckoff distribuição. "; score += 1; }
    if (elliott.status.includes("Onda Impulsiva")) { relevance += "🌊 Elliott impulsiva. "; score += 1; }
    if (orderBook.totalAskVolume > orderBook.totalBidVolume * 1.2) { relevance += "📖 Asks > Bids. "; score += 1; }
    if (lsrData.account.value < 0.8 || lsrData.position.value < 0.8) { relevance += `📉 LSR bearish. `; score += 1; }

    if (score > 0) {
      sellTargets.push(level);
      sellExplanations.push(`${label} (${level.toFixed(4)}): ${relevance}`);
      if (score > bestSellScore) {
        bestSellScore = score;
        bestSellZone = { level, label };
        bestSellExplanation = relevance;
      }
    }
  });

  if (zonas.estruturaAlta > 0 && zonas.estruturaAlta > price) {
    let relevance = "🔝 Resistência. ";
    let score = 1;

    const nearSellZone = zonas.sellLiquidityZones.some(z => Math.abs(z - zonas.estruturaAlta) / zonas.estruturaAlta < 0.01);
    if (nearSellZone) { relevance += "🔴 Liquidez venda. "; score += 2; }
    if (fibLevels['61.8'] && Math.abs(zonas.estruturaAlta - fibLevels['61.8']) / zonas.estruturaAlta < 0.01) { relevance += "📏 Fib 61.8%. "; score += 1; }
    else if (fibLevels['78.6'] && Math.abs(zonas.estruturaAlta - fibLevels['78.6']) / zonas.estruturaAlta < 0.01) { relevance += "📏 Fib 78.6%. "; score += 1; }
    else if (fibLevels['100.0'] && Math.abs(zonas.estruturaAlta - fibLevels['100.0']) / zonas.estruturaAlta < 0.01) { relevance += "📏 Fib 100.0%. "; score += 1; }
    if (lsrData.account.value < 0.8 || lsrData.position.value < 0.8) { relevance += `📉 LSR bearish. `; score += 1; }

    breakoutAbove.push({ level: zonas.estruturaAlta, label: 'Estrutura Alta', explanation: relevance });

    const futureAboveLevels = [
      { level: fibLevels['78.6'], label: 'Fib 78.6%' },
      { level: fibLevels['100.0'], label: 'Fib 100.0%' }
    ].filter(l => l.level > zonas.estruturaAlta && l.level > 0);

    futureAboveLevels.forEach(({ level, label }) => {
      let futureRelevance = "🎯 Alvo pós-rompimento alta. ";
      if (zonas.sellLiquidityZones.some(z => Math.abs(z - level) / level < 0.01)) {
        futureRelevance += "🔴 Liquidez venda. ";
      }
      breakoutAbove.push({ level, label, explanation: futureRelevance });
    });
  }

  if (zonas.estruturaBaixa > 0 && zonas.estruturaBaixa < price) {
    let relevance = "🔍 Suporte. ";
    let score = 1;

    const nearBuyZone = zonas.buyLiquidityZones.some(z => Math.abs(z - zonas.estruturaBaixa) / zonas.estruturaBaixa < 0.01);
    if (nearBuyZone) { relevance += "🟢 Liquidez compra. "; score += 2; }
    if (fibLevels['38.2'] && Math.abs(zonas.estruturaBaixa - fibLevels['38.2']) / zonas.estruturaBaixa < 0.01) { relevance += "📏 Fib 38.2%. "; score += 1; }
    else if (fibLevels['23.6'] && Math.abs(zonas.estruturaBaixa - fibLevels['23.6']) / zonas.estruturaBaixa < 0.01) { relevance += "📏 Fib 23.6%. "; score += 1; }
    else if (fibLevels['0.0'] && Math.abs(zonas.estruturaBaixa - fibLevels['0.0']) / zonas.estruturaBaixa < 0.01) { relevance += "📏 Fib 0.0%. "; score += 1; }
    if (lsrData.account.value > 1.2 || lsrData.position.value > 1.2) { relevance += `📉 LSR bullish. `; score += 1; }

    breakoutBelow.push({ level: zonas.estruturaBaixa, label: 'Estrutura Baixa', explanation: relevance });

    const futureBelowLevels = [
      { level: fibLevels['23.6'], label: 'Fib 23.6%' },
      { level: fibLevels['0.0'], label: 'Fib 0.0%' }
    ].filter(l => l.level < zonas.estruturaBaixa && l.level > 0);

    futureBelowLevels.forEach(({ level, label }) => {
      let futureRelevance = "🎯 Alvo pós-rompimento baixa. ";
      if (zonas.buyLiquidityZones.some(z => Math.abs(z - level) / level < 0.01)) {
        futureRelevance += "🟢 Liquidez compra. ";
      }
      breakoutBelow.push({ level, label, explanation: futureRelevance });
    });
  }

  return {
    buyTargets,
    sellTargets,
    buyExplanations,
    sellExplanations,
    bestBuyZone: bestBuyZone ? { level: bestBuyZone.level.toFixed(4), label: bestBuyZone.label, explanation: bestBuyExplanation } : null,
    bestSellZone: bestSellZone ? { level: bestSellZone.level.toFixed(4), label: bestSellZone.label, explanation: bestSellExplanation } : null,
    breakoutAbove,
    breakoutBelow
  };
}

function generateHumanizedSuggestion(rsi1hVal, rsi15mVal, estocasticoD, estocastico4h, currentPrice, bestBuyZone, bestSellZone, breakoutAbove, breakoutBelow, lsrData) {
  if (rsi15mVal < 30 || rsi1hVal < 30 || estocasticoD?.k < 20 || estocastico4h?.k < 20 || lsrData.account.value > 1.2) {
    return bestBuyZone 
      ? `🟢 Compra em ${bestBuyZone.level} (${bestBuyZone.label}). Confirme com volume.`
      : "🟢 Sobrevenda detectada. Aguarde suporte para entrada.";
  } else if (rsi15mVal > 70 || rsi1hVal > 70 || estocasticoD?.k > 80 || estocastico4h?.k > 80 || lsrData.account.value < 0.8) {
    return bestSellZone 
      ? `🔴 Venda em ${bestSellZone.level} (${bestSellZone.label}). Proteja lucros.`
      : "🔴 Sobrecompra detectada. Aguarde resistência para saída.";
  } else if (breakoutAbove.length > 0 && currentPrice > breakoutAbove[0].level * 0.99) {
    return `🚀 Rompimento de alta em ${breakoutAbove[0].level}. Entre com volume forte.`;
  } else if (breakoutBelow.length > 0 && currentPrice < breakoutBelow[0].level * 1.01) {
    return `📉 Rompimento de baixa em ${breakoutBelow[0].level}. Proteja posições.`;
  }
  return "⚖️ Mercado neutro. Monitore suporte e resistência.";
}

async function monitorRealTime() {
  try {
    for (const symbol of MONITORED_PAIRS) {
      const isValidSymbol = await validateSymbol(symbol);
      if (!isValidSymbol) {
        logger.warn(`Par inválido no monitoramento em tempo real: ${symbol}`);
        continue;
      }

      const ticker = await exchangeSpot.fetchTicker(symbol);
      const currentPrice = ticker.last;
      if (!currentPrice) {
        logger.warn(`Preço atual indisponível para ${symbol}`);
        continue;
      }

      const ohlcv15m = await exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 20);
      const ohlcv4h = await exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 20);
      const ohlcvDiario = await exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 20);
      const ohlcv1h = await exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 20);
      if (!ohlcv15m || !ohlcv4h || !ohlcvDiario || !ohlcv1h) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}`);
        continue;
      }

      const rsi4h = calculateRSI(ohlcv4h.map(c => ({ close: c[4] })));
      const rsiDiario = calculateRSI(ohlcvDiario.map(c => ({ close: c[4] })));
      const rsi1h = calculateRSI(ohlcv1h.map(c => ({ close: c[4] })));
      const rsi15m = calculateRSI(ohlcv15m.map(c => ({ close: c[4] })));
      const rsi4hVal = rsi4h && rsi4h.length ? rsi4h[rsi4h.length - 1].toFixed(1) : null;
      const rsiDiarioVal = rsiDiario && rsiDiario.length ? rsiDiario[rsiDiario.length - 1].toFixed(1) : null;
      const rsi1hVal = rsi1h && rsi1h.length ? rsi1h[rsi1h.length - 1].toFixed(1) : null;
      const rsi15mVal = rsi15m && rsi15m.length ? rsi15m[rsi15m.length - 1].toFixed(1) : null;
      const estocastico4h = calculateStochastic(ohlcv4h.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
      const estocasticoDiario = calculateStochastic(ohlcvDiario.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
      const estocasticoD = calculateStochastic(ohlcvDiario.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
      const zonas = detectarQuebraEstrutura(ohlcv15m.map(c => ({ high: c[2], low: c[3], volume: c[5] })));
      const fibLevels = calculateFibonacciLevels(ohlcvDiario);
      const wyckoff = analyzeWyckoff(ohlcvDiario, ohlcv4h, ohlcvDiario[ohlcvDiario.length - 1][5], ohlcvDiario[ohlcvDiario.length - 2][5]);
      const elliott = analyzeElliott(ohlcv4h);
      const orderBook = await fetchOrderBook(symbol);
      const lsrData = await fetchLSR(symbol);
      const cvd15mStatus = calculateCVD(ohlcv15m) > 0 ? "⬆️ Bullish" : "⬇️ Bearish";
      const obv15mStatus = calculateOBV(ohlcv15m) > 0 ? "⬆️ Bullish" : "⬇️ Bearish";

      const targets = determineTargets(fibLevels, zonas, rsi1hVal, rsi15mVal, cvd15mStatus, obv15mStatus, estocasticoD, estocastico4h, wyckoff, elliott, orderBook, lsrData, currentPrice);

      if (!ultimoRSI[symbol]) ultimoRSI[symbol] = { rsi4h: null, rsiDiario: null };
      if (!ultimoEstocastico[symbol]) ultimoEstocastico[symbol] = { k4h: null, kDiario: null };
      if (!ultimaEstrutura[symbol]) ultimaEstrutura[symbol] = { price: null, estruturaAlta: null, estruturaBaixa: null };
      if (!ultimoAlertaTempo[symbol]) ultimoAlertaTempo[symbol] = {};

      let alertas = [];

      if (zonas.estruturaAlta > 0 && ultimaEstrutura[symbol].estruturaAlta && currentPrice > zonas.estruturaAlta && ultimaEstrutura[symbol].price <= ultimaEstrutura[symbol].estruturaAlta) {
        const alertaKey = `${symbol}_rompimento_alta`;
        const ultimoAlerta = ultimoAlertaTempo[symbol][alertaKey] || 0;
        if ((Date.now() / 1000) - ultimoAlerta > ALERTA_COOLDOWN_S) {
          const format = v => currentPrice < 1 ? v.toFixed(8) : currentPrice < 10 ? v.toFixed(6) : currentPrice < 100 ? v.toFixed(4) : v.toFixed(2);
          alertas.push(`🚨 *Rompimento Alta ${symbol}* 🚀\nPreço: ${format(currentPrice)} > Resistência: ${format(zonas.estruturaAlta)}. Entre longo se volume confirmar!`);
          ultimoAlertaTempo[symbol][alertaKey] = Date.now() / 1000;
        }
      }
      if (zonas.estruturaBaixa > 0 && ultimaEstrutura[symbol].estruturaBaixa && currentPrice < zonas.estruturaBaixa && ultimaEstrutura[symbol].price >= ultimaEstrutura[symbol].estruturaBaixa) {
        const alertaKey = `${symbol}_rompimento_baixa`;
        const ultimoAlerta = ultimoAlertaTempo[symbol][alertaKey] || 0;
        if ((Date.now() / 1000) - ultimoAlerta > ALERTA_COOLDOWN_S) {
          const format = v => currentPrice < 1 ? v.toFixed(8) : currentPrice < 10 ? v.toFixed(6) : currentPrice < 100 ? v.toFixed(4) : v.toFixed(2);
          alertas.push(`🚨 *Rompimento Baixa ${symbol}* 📉\nPreço: ${format(currentPrice)} < Suporte: ${format(zonas.estruturaBaixa)}. Proteja posições!`);
          ultimoAlertaTempo[symbol][alertaKey] = Date.now() / 1000;
        }
      }

      for (const alerta of alertas) {
        await bot.api.sendMessage(TELEGRAM_CHAT_ID, alerta, { parse_mode: 'Markdown' });
        logger.info(`Alerta enviado para ${symbol}: ${alerta}`);
        await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
      }

      ultimaEstrutura[symbol] = {
        price: currentPrice,
        estruturaAlta: zonas.estruturaAlta,
        estruturaBaixa: zonas.estruturaBaixa
      };
      ultimoRSI[symbol] = {
        rsi4h: rsi4hVal,
        rsiDiario: rsiDiarioVal
      };
      ultimoEstocastico[symbol] = {
        k4h: estocastico4h ? estocastico4h.k : null,
        kDiario: estocasticoDiario ? estocasticoDiario.k : null
      };

      await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    }
  } catch (e) {
    logger.error(`Erro no monitoramento em tempo real: ${e.message}`);
  }
}

async function validateSymbol(symbol) {
  try {
    const markets = await exchangeSpot.loadMarkets();
    return !!markets[symbol];
  } catch (e) {
    logger.error(`Erro ao validar par ${symbol}: ${e.message}`);
    return false;
  }
}

async function sendRandomPairAnalysis() {
  try {
    const randomIndex = Math.floor(Math.random() * MONITORED_PAIRS.length);
    const symbol = MONITORED_PAIRS[randomIndex];
    logger.info(`Enviando análise automática para ${symbol}`);
    await bot.api.sendMessage(TELEGRAM_CHAT_ID, `🤖 Titanium Gerando análise para ${symbol}...`);
    await sendStatusReport(symbol, TELEGRAM_CHAT_ID);
  } catch (e) {
    logger.error(`Erro ao enviar análise automática: ${e.message}`);
  }
}

async function sendStatusReport(symbol, chatId) {
  try {
    const isValidSymbol = await validateSymbol(symbol);
    if (!isValidSymbol) {
      await bot.api.sendMessage(chatId, `⚠️ Par inválido: ${symbol}. Exemplo: /info BTCUSDT`);
      return;
    }

    let texto = `*🤖 Análise:  🔘${symbol}*\n`;

    const ohlcv1h = await exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 20);
    const ohlcv15m = await exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 20);
    const ohlcvDiario = await exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 20);
    const ohlcv4h = await exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 20);

    if (!ohlcv1h || !ohlcv15m || !ohlcvDiario || !ohlcv4h) {
      logger.warn(`Dados insuficientes para ${symbol}`);
      texto += `⚠️ Dados insuficientes\n`;
      await bot.api.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
      return;
    }

    const price = ohlcv1h[ohlcv1h.length - 1][4];
    const format = v => price < 1 ? v.toFixed(8) : price < 10 ? v.toFixed(6) : price < 100 ? v.toFixed(4) : v.toFixed(2);
    texto += `💲 Preço: ${format(price)}\n`;

    const vwap1h = calculateVWAP(ohlcv1h);
    texto += `📈 VWAP 1H: ${vwap1h.vwap || '--'} (${vwap1h.min || '--'} - ${vwap1h.max || '--'})\n`;

    const rsi1h = calculateRSI(ohlcv1h.map(c => ({ close: c[4] })));
    const rsi15m = calculateRSI(ohlcv15m.map(c => ({ close: c[4] })));
    const rsi1hVal = rsi1h && rsi1h.length ? rsi1h[rsi1h.length - 1] : null;
    const rsi15mVal = rsi15m && rsi15m.length ? rsi15m[rsi15m.length - 1] : null;
    const rsi1hEmoji = rsi1hVal > 60 ? "🔴" : rsi1hVal < 40 ? "🟢" : "";
    const rsi15mEmoji = rsi15mVal > 60 ? "🔴" : rsi15mVal < 40 ? "🟢" : "";
    texto += `📈 RSI 15M: ${rsi15mVal?.toFixed(1) || '--'}${rsi15mEmoji}\n`;
    texto += `📈 RSI 1H: ${rsi1hVal?.toFixed(1) || '--'}${rsi1hEmoji}\n`;

    const estocasticoD = calculateStochastic(ohlcvDiario.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
    const estocastico4h = calculateStochastic(ohlcv4h.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
    const kDEmoji = getStochasticEmoji(estocasticoD?.k);
    const k4hEmoji = getStochasticEmoji(estocastico4h?.k);
    texto += `📊 Stoch D %K: ${estocasticoD ? estocasticoD.k.toFixed(1) : '--'}${kDEmoji}\n`;
    texto += `📊 Stoch 4H %K: ${estocastico4h ? estocastico4h.k.toFixed(1) : '--'}${k4hEmoji}\n`;

    const lsrData = await fetchLSR(symbol);
    const lsrEmoji = lsrData.account.value > 2.5 ? "🔴" : lsrData.account.value < 1.3 ? "🟢" : "";
    texto += `📉 LSR 15M: ${lsrData.account.value?.toFixed(2) || '--'}${lsrEmoji}\n`;

    const zonas = detectarQuebraEstrutura(ohlcv15m.map(c => ({ high: c[2], low: c[3], volume: c[5] })));
    texto += `🔹 Suporte: ${format(zonas.estruturaBaixa) || '--'}\n`;
    texto += `🔹 Resistência: ${format(zonas.estruturaAlta) || '--'}\n\n`;

    const fibLevels = calculateFibonacciLevels(ohlcvDiario);
    const targets = determineTargets(fibLevels, zonas, rsi1hVal, rsi15mVal, calculateCVD(ohlcv15m) > 0 ? "⬆️ Bullish" : "⬇️ Bearish", calculateOBV(ohlcv15m) > 0 ? "⬆️ Bullish" : "⬇️ Bearish", estocasticoD, estocastico4h, analyzeWyckoff(ohlcvDiario, ohlcv4h, ohlcvDiario[ohlcvDiario.length - 1][5], ohlcvDiario[ohlcvDiario.length - 2][5]), analyzeElliott(ohlcv4h), await fetchOrderBook(symbol), lsrData, price);
    texto += `🟢 Melhor Compra: ${targets.bestBuyZone ? `${targets.bestBuyZone.label} (${targets.bestBuyZone.level})` : 'Nenhuma'}\n`;
    texto += `🔴 Melhor Venda: ${targets.bestSellZone ? `${targets.bestSellZone.label} (${targets.bestSellZone.level})` : 'Nenhuma'}\n\n`;

    texto += `💡 Sugestão: ${generateHumanizedSuggestion(rsi1hVal, rsi15mVal, estocasticoD, estocastico4h, price, targets.bestBuyZone, targets.bestSellZone, targets.breakoutAbove, targets.breakoutBelow, lsrData)}`;

    await bot.api.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
  } catch (e) {
    logger.error(`Erro no relatório para ${symbol}: ${e.message}`);
    await bot.api.sendMessage(chatId, `⚠️ Erro ao gerar relatório: ${e.message}`);
  }
}

bot.command('info', async (ctx) => {
  try {
    logger.info('Comando /info recebido', {
      update: JSON.stringify(ctx.update, null, 2),
      chatId: ctx.chat?.id,
      messageText: ctx.message?.text || ctx.channelPost?.text,
      from: ctx.from,
      chatType: ctx.chat?.type
    });

    const text = ctx.message?.text || ctx.channelPost?.text;
    if (!text) {
      logger.warn('Nenhuma mensagem válida recebida no comando /info');
      await ctx.reply('⚠️ Nenhuma mensagem válida recebida. Use: /info <par>, ex.: /info BTCUSDT');
      return;
    }

    const args = text.trim().split(/\s+/).slice(1);
    const symbolInput = args[0]?.toUpperCase();
    logger.info(`Símbolo extraído: ${symbolInput}`);

    if (!symbolInput) {
      logger.warn('Nenhum par de moedas fornecido no comando /info');
      await ctx.reply('⚠️ Por favor, forneça um par de moedas. Exemplo: /info BTCUSDT');
      return;
    }

    const normalizedSymbol = symbolInput.includes('/') ? symbolInput : `${symbolInput.slice(0, -4)}/${symbolInput.slice(-4)}`;
    logger.info(`Símbolo normalizado: ${normalizedSymbol}`);

    const isValidSymbol = await validateSymbol(normalizedSymbol);
    if (!isValidSymbol) {
      logger.warn(`Par inválido fornecido: ${normalizedSymbol}`);
      await ctx.reply(`⚠️ Par inválido: ${normalizedSymbol}. Exemplo: /info BTCUSDT`);
      return;
    }

    await ctx.reply(`🔄 Gerando análise para ${normalizedSymbol}...`);
    logger.info(`Iniciando geração de relatório para ${normalizedSymbol}`);

    await sendStatusReport(normalizedSymbol, ctx.chat.id);
    logger.info(`Relatório enviado para ${normalizedSymbol}`);
  } catch (e) {
    logger.error(`Erro no comando /info: ${e.message}`, { stack: e.stack });
    await ctx.reply(`⚠️ Erro ao processar o comando /info: ${e.message}`);
  }
});

async function main() {
  logger.info('Iniciando bot de análise de criptomoedas');
  try {
    bot.catch((err, ctx) => {
      logger.error(`Erro no bot: ${err.message}`, {
        stack: err.stack,
        update: ctx.update
      });
      if (ctx.chat) {
        ctx.reply('⚠️ Ocorreu um erro interno. Tente novamente mais tarde.');
      }
    });

    logger.info('Bot configurado, iniciando...');
    await bot.api.sendMessage(TELEGRAM_CHAT_ID, '🤖 Titanium Análises I.A.');
    
    setInterval(sendRandomPairAnalysis, INTERVALO_ANALISE_AUTOMATICA_MS);
    setInterval(monitorRealTime, INTERVALO_MONITORAMENTO_TEMPO_REAL_MS);
    await sendRandomPairAnalysis();
    await monitorRealTime();

    await bot.start();
    logger.info('Bot iniciado com sucesso');
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`, { stack: e.stack });
  }
}

main();