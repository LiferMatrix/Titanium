require('dotenv').config();
const ccxt = require('ccxt');
const TechnicalIndicators = require('technicalindicators');
const { Bot } = require('grammy');
const winston = require('winston');
const axios = require('axios');

// ================= CONFIGURAÇÃO ================= //
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const INTERVALO_MONITORAMENTO_TEMPO_REAL_MS = 3 * 60 * 1000; // Monitoramento a cada 3 minutos
const API_DELAY_MS = 1000; // Aumentado para evitar rate limits
const ALERTA_COOLDOWN_S = 3600; // 1 hora de cooldown para alertas

// Lista de pares monitorados
const MONITORED_PAIRS = [
  'BTC/USDT',
  'ETH/USDT',
  'BNB/USDT',
  'ADA/USDT',
  'XRP/USDT',
  'SOL/USDT',
  'DOGE/USDT',
  'FIL/USDT',
  'AVAX/USDT',
  'DOT/USDT',
  '1INCH/USDT',
  'APE/USDT',
  'RUNE/USDT',
  'VANRY/USDT',
  'AAVE/USDT',
  'BCH/USDT',
  'CHZ/USDT',
  'CRV/USDT',
  'INJ/USDT',
  'ENA/USDT',
  'SEI/USDT',
  'SUI/USDT',
  'C98/USDT',
  'ETC/USDT',
  'ENJ/USDT',
  'FET/USDT',
  'GMT/USDT',
  'MANTA/USDT',
  'TIA/USDT',
  'SKL/USDT',
  'ZK/USDT',
  'SUSHI/USDT',
  'GALA/USDT',
  'AXS/USDT',
  'DEGO/USDT',
  'PUNDIX/USDT',
  'BONK/USDT',
  'PEPE/USDT',
  'SHIB/USDT',
  'FLOKI/USDT',
  'NEO/USDT',
  'FIDA/USDT',
  'RIF/USDT',
  'ALT/USDT',
  'AXS/USDT',
  'AUCTION/USDT',
  'DOGS/USDT',
  'OXT/USDT',
  'POPCAT/USDT',
  'HOOK/USDT',
  'YGG/USDT',
  'DEXE/USDT',
  'ATOM/USDT',
  'BAND/USDT',
  'ICP/USDT',
  'IOTA/USDT',
  'LDO/USDT',
  'MAGIC/USDT',
  'OP/USDT',
  'ONE/USDT',
  'PEOPLE/USDT',
  'REZ/USDT',
  'RENDER/USDT',
  'RLC/USDT',
  'RVN/USDT',
  'STG/USDT',
  'TRB/USDT',
  'VET/USDT',
  'ZEC/USDT',
  'XLM/USDT',
  'WLD/USDT',
  'POL/USDT',
  'NEAR/USDT',
  'DYDX/USDT',
  'C98/USDT',
  'ETC/USDT',
  'ENJ/USDT',
  'FET/USDT',
  'GMT/USDT',
  'MANTA/USDT',
  'TIA/USDT',
  'SKL/USDT',
  'ZK/USDT',
  'SUSHI/USDT',
  'POL/USDT',
  'API3/USDT',
  'HBAR/USDT',
  'EGLD/USDT',
  'GMX/USDT',
  'IMX/USDT',
  'PORTAL/USDT',
  'GRT/USDT',
  'LTC/USDT',
  'KSM/USDT',
  'MANA/USDT',
  'SAND/USDT',
  'ONDO/USDT',
  'PENDLE/USDT',
  'RARE/USDT',
  'ROSE/USDT',
  'RSR/USDT',
  'STX/USDT',
  'ZRO/USDT',
  'SYS/USDT',
  'TRU/USDT',
  'ORDI/USDT',
  'APT/USDT',
  'ATA/USDT',
  'AR/USDT',
  'IOST/USDT',
  'IOTX/USDT',
  'ILV/USDT',
  'HYPER/USDT',
  'AEVO/USDT',
  'AXL/USDT',
  'KERNEL/USDT',
  'LISTA/USDT',
  'TWT/USDT',
  'NOT/USDT',
  'SONIC/USDT',
  'BOME/USDT',
  'TON/USDT',
  'LINEA/USDT',
  'NEIRO/USDT',
  'DOGS/USDT',
  'PHA/USDT',
  'THETA/USDT',
  'ANIME/USDT',
  'COOKIE/USDT',
  'BEL/USDT',
  'CHR/USDT',
  'HOT/USDT',
  'JASMY/USDT',
  'CTSI/USDT',
  'TRUMP/USDT',
  'MELANIA/USDT',
  'OM/USDT',
  'UMA/USDT',
  'MOODENG/USDT',
  'PNUT/USDT',
  'COW/USDT',
  'MBOX/USDT',
  'NKN/USDT',
  'MTL/USDT',
  'MEME/USDT',
  'DOT/USDT',
  'UNI/USDT',
  'MASK/USDT',
  'JUP/USDT',
  'TURBO/USDT',
  'BLUR/USDT',
  'RUNE/USDT',
  'ZRX/USDT',
  'BCH/USDT',
  'LDO/USDT',
  'OGN/USDT',
  'HIPPO/USDT',
  'IP/USDT',
  'SNX/USDT',
  'HYPER/USDT',
  'TAO/USDT',
  'YFI/USDT',
  'KNC/USDT',
  'KAVA/USDT',
  'LRC/USDT',
  'EGLD/USDT',
  'FLM/USDT',
  'ZEN/USDT',
  'COTI/USDT',
  'ALICE/USDT',
  'MTL/USDT',
  'GTC/USDT',
  'IOTX/USDT',
  'ATA/USDT',
  'LPT/USDT',
  'PEOPLE/USDT',
  'ROSE/USDT',
  'WOO/USDT',
  'STG/USDT',
  'RDNT/USDT',
  'MINA/USDT',
  'BICO/USDT',
  'CBK/USDT',
  'ARB/USDT',
  'YFI/USDT',
  'KAS/USDT',
  'LINK/USDT'
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
const atrPeriod = 14;

// Funções de indicadores
function calculateRSI(data) {
  if (!data || data.length < rsiPeriod + 1) return null;
  return TechnicalIndicators.RSI.calculate({
    period: rsiPeriod,
    values: data.map(d => d.close)
  });
}

function calculateATR(data) {
  if (!data || data.length < atrPeriod + 1) return null;
  return TechnicalIndicators.ATR.calculate({
    period: atrPeriod,
    high: data.map(d => d.high),
    low: data.map(d => d.low),
    close: data.map(d => d.close)
  });
}

function calculateCVD(data) {
  let cvd = 0;
  const avgVolume = data.reduce((sum, d) => sum + d[5], 0) / data.length; // Normalização por volume médio
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    const volumeNormalized = curr[5] / avgVolume;
    if (curr[4] > curr[1]) cvd += volumeNormalized;
    else if (curr[4] < curr[1]) cvd -= volumeNormalized;
  }
  return cvd;
}

function calculateOBV(data) {
  let obv = 0;
  const avgVolume = data.reduce((sum, d) => sum + d[5], 0) / data.length; // Normalização
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    const prev = data[i - 1];
    const volumeNormalized = curr[5] / avgVolume;
    if (curr[4] > prev[4]) obv += volumeNormalized;
    else if (curr[4] < prev[4]) obv -= volumeNormalized;
  }
  return obv;
}

function calculateMACD(closes) {
  if (!closes || closes.length < 26) return null;
  const macdResult = TechnicalIndicators.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9
  });
  return macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;
}

function detectarQuebraEstrutura(ohlcv15m) {
  if (!ohlcv15m || ohlcv15m.length < 5) { // Aumentado mínimo para evitar ruído
    return { estruturaAlta: 0, estruturaBaixa: 0, buyLiquidityZones: [], sellLiquidityZones: [] };
  }

  const highs = ohlcv15m.map(c => c.high).filter(h => !isNaN(h));
  const lows = ohlcv15m.map(c => c.low).filter(l => !isNaN(l));
  const volumes = ohlcv15m.map(c => c.volume).filter(v => !isNaN(v));

  if (highs.length < 5 || lows.length < 5 || volumes.length < 5) {
    return { estruturaAlta: 0, estruturaBaixa: 0, buyLiquidityZones: [], sellLiquidityZones: [] };
  }

  // Threshold dinâmico: média + 1 desvio padrão
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const stdDevVolume = Math.sqrt(volumes.reduce((a, b) => a + Math.pow(b - avgVolume, 2), 0) / volumes.length);
  const volumeThreshold = avgVolume + stdDevVolume;

  // Detectar pivots simples (highs/lows locais)
  let estruturaAlta = 0;
  let estruturaBaixa = Infinity;
  const buyLiquidityZones = [];
  const sellLiquidityZones = [];

  for (let i = 2; i < ohlcv15m.length - 2; i++) { // Ignora bordas para evitar ruído
    const candle = ohlcv15m[i];
    if (candle.volume >= volumeThreshold) {
      // Pivot high: high > vizinhos
      if (candle.high > ohlcv15m[i-1].high && candle.high > ohlcv15m[i-2].high &&
          candle.high > ohlcv15m[i+1].high && candle.high > ohlcv15m[i+2].high) {
        sellLiquidityZones.push(candle.high);
        estruturaAlta = Math.max(estruturaAlta, candle.high);
      }
      // Pivot low: low < vizinhos
      if (candle.low < ohlcv15m[i-1].low && candle.low < ohlcv15m[i-2].low &&
          candle.low < ohlcv15m[i+1].low && candle.low < ohlcv15m[i+2].low) {
        buyLiquidityZones.push(candle.low);
        estruturaBaixa = Math.min(estruturaBaixa, candle.low);
      }
    }
  }

  // Fallback para max/min se nenhum pivot
  if (estruturaAlta === 0) estruturaAlta = Math.max(...highs);
  if (estruturaBaixa === Infinity) estruturaBaixa = Math.min(...lows);

  // Unique e sort, limitar a 3 zonas
  const uniqueBuyZones = [...new Set(buyLiquidityZones.sort((a, b) => b - a))].slice(0, 3);
  const uniqueSellZones = [...new Set(sellLiquidityZones.sort((a, b) => a - b))].slice(0, 3);

  return {
    estruturaAlta,
    estruturaBaixa,
    buyLiquidityZones: uniqueBuyZones.length > 0 ? uniqueBuyZones : [Math.min(...lows)],
    sellLiquidityZones: uniqueSellZones.length > 0 ? uniqueSellZones : [Math.max(...highs)]
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

async function fetchLSR(symbol) {
  try {
    const accountRes = await axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    });
    const accountLSR = accountRes.data && accountRes.data.length >= 2 ? {
      value: parseFloat(accountRes.data[0].longShortRatio),
      status: parseFloat(accountRes.data[0].longShortRatio) > parseFloat(accountRes.data[1].longShortRatio) ? "Subindo" : "Caindo",
      percentChange: accountRes.data[1].longShortRatio > 0 ? ((parseFloat(accountRes.data[0].longShortRatio) - parseFloat(accountRes.data[1].longShortRatio)) / parseFloat(accountRes.data[1].longShortRatio) * 100).toFixed(2) : 0
    } : { value: null, status: "Indisponível", percentChange: 0 };

    const positionRes = await axios.get('https://fapi.binance.com/futures/data/topLongShortPositionRatio', {
      params: { symbol: symbol.replace('/', ''), period: '15m', limit: 2 }
    });
    const positionLSR = positionRes.data && positionRes.data.length >= 2 ? {
      value: parseFloat(positionRes.data[0].longShortRatio),
      status: parseFloat(positionRes.data[0].longShortRatio) > parseFloat(positionRes.data[1].longShortRatio) ? "Subindo" : "Caindo",
      percentChange: positionRes.data[1].longShortRatio > 0 ? ((parseFloat(positionRes.data[0].longShortRatio) - parseFloat(positionRes.data[1].longShortRatio)) / parseFloat(positionRes.data[1].longShortRatio) * 100).toFixed(2) : 0
    } : { value: null, status: "Indisponível", percentChange: 0 };

    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    return { account: accountLSR, position: positionLSR };
  } catch (e) {
    logger.warn(`Erro ao buscar LSR para ${symbol}: ${e.message}`);
    return {
      account: { value: null, status: "Indisponível", percentChange: 0 },
      position: { value: null, status: "Indisponível", percentChange: 0 }
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
        status: currentOI > previousOI ? `+${percentChange}%` : `${percentChange}%`,
        percentChange: parseFloat(percentChange)
      };
    }
    return { value: null, status: "Indisponível", percentChange: 0 };
  } catch (e) {
    logger.warn(`Erro ao buscar Open Interest para ${symbol} no timeframe ${timeframe}: ${e.message}`);
    return { value: null, status: "Indisponível", percentChange: 0 };
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
        status: currentFunding > previousFunding ? "Subindo" : "Caindo"
      };
    }
    return { current: null, status: "Indisponível" };
  } catch (e) {
    logger.warn(`Erro ao buscar Funding Rate para ${symbol}: ${e.message}`);
    return { current: null, status: "Indisponível" };
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
  const priceDirection = price > prevPrice ? "Subindo" : "Caindo";

  let wyckoffPhase = "Indefinida";
  let wyckoffAnalysis = "";

  if (volumeIncreasing && priceDirection === "Subindo") {
    wyckoffPhase = "Acumulação (Fase B/C) ou Mark-Up";
    wyckoffAnalysis = "Indícios de acumulação ou início de uma tendência de alta.";
  } else if (volumeIncreasing && priceDirection === "Caindo") {
    wyckoffPhase = "Distribuição (Fase B/C) ou Mark-Down";
    wyckoffAnalysis = "Indícios de distribuição ou início de uma tendência de baixa.";
  } else if (!volumeIncreasing && price > prevPrice) {
    wyckoffPhase = "Acumulação (Fase A) ou Reacumulação";
    wyckoffAnalysis = "Possível acumulação ou reacumulação.";
  } else {
    wyckoffPhase = "Indefinida";
    wyckoffAnalysis = "Mercado em consolidação ou indefinido.";
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
    waveAnalysis = "O preço está em uma possível onda impulsiva de alta.";
  } else if (lastPrice < prevPrice && lastPrice <= lastLow * 1.01) {
    waveStatus = "Onda Corretiva (Possível Onda A ou C)";
    waveAnalysis = "O preço está em uma possível onda corretiva.";
  } else {
    waveStatus = "Indefinida";
    waveAnalysis = "Sem padrão claro de Elliott Wave no momento.";
  }

  return { status: waveStatus, analysis: waveAnalysis };
}

function determineTargets(fibLevels, zonas, rsi1hVal, rsi15mVal, cvd15mStatus, obv15mStatus, estocasticoD, estocastico4h, wyckoff, elliott, orderBook, lsrData, currentPrice, atr, oi15m, fundingRate, macd) {
  if (!fibLevels) return { 
    buyTargets: [], 
    sellTargets: [], 
    buyExplanations: [], 
    sellExplanations: [], 
    bestBuyZone: null, 
    bestSellZone: null, 
    breakoutAbove: [], 
    breakoutBelow: [],
    stopLossBuy: null,
    stopLossSell: null 
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
  let stopLossBuy = price - (atr * 1.5);
  let stopLossSell = price + (atr * 1.5);

  if (zonas.buyLiquidityZones.length > 0 && zonas.buyLiquidityZones[0] < stopLossBuy) {
    stopLossBuy = Math.min(...zonas.buyLiquidityZones);
  }
  if (zonas.sellLiquidityZones.length > 0 && zonas.sellLiquidityZones[0] > stopLossSell) {
    stopLossSell = Math.max(...zonas.sellLiquidityZones);
  }

  // Pesos configuráveis
  const weights = {
    liquidity: 2.5,  // Mais importante
    rsi: 1.5,
    cvd_obv: 1.2,
    stoch: 1.5,
    wyckoff: 1.0,
    elliott: 1.0,
    orderbook: 1.2,
    lsr: 1.2,
    oi: 1.5,
    funding: 1.0,
    macd: 1.5
  };

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
    let categories = new Set();

    const nearBuyZone = zonas.buyLiquidityZones.some(z => Math.abs(z - level) / level < 0.01);
    if (nearBuyZone) { relevance += "Liquidez compra. "; score += weights.liquidity; categories.add('liquidity'); }
    if (rsi15mVal < 35 || rsi1hVal < 35) { relevance += "RSI sobrevenda. "; score += weights.rsi; categories.add('rsi'); }
    if (cvd15mStatus === "Bullish" || obv15mStatus === "Bullish") { relevance += "CVD/OBV bullish. "; score += weights.cvd_obv; categories.add('cvd_obv'); }
    if ((estocasticoD?.k < 20 && estocasticoD?.k > estocasticoD?.d) || (estocastico4h?.k < 20 && estocastico4h?.k > estocastico4h?.d)) { relevance += "Stoch sobrevenda. "; score += weights.stoch; categories.add('stoch'); }
    if (wyckoff.phase.includes("Acumulação")) { relevance += "Wyckoff acumulação. "; score += weights.wyckoff; categories.add('wyckoff'); }
    if (elliott.status.includes("Onda Corretiva")) { relevance += "Elliott corretiva. "; score += weights.elliott; categories.add('elliott'); }
    if (orderBook.totalBidVolume > orderBook.totalAskVolume * 1.2) { relevance += "Bids > Asks. "; score += weights.orderbook; categories.add('orderbook'); }
    if (lsrData.account.value > 1.2 || lsrData.position.value > 1.2) { relevance += `LSR bullish. `; score += weights.lsr; categories.add('lsr'); }
    if (oi15m?.status.includes("+")) { relevance += "OI subindo. "; score += weights.oi; categories.add('oi'); }
    if (fundingRate.current < 0) { relevance += "Funding negativo (bom para long). "; score += weights.funding; categories.add('funding'); }
    if (macd && macd.MACD > macd.signal && macd.MACD > 0) { relevance += "MACD bullish. "; score += weights.macd; categories.add('macd'); }

    if (score > 3 && categories.size >= 2) {
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
    let categories = new Set();

    const nearSellZone = zonas.sellLiquidityZones.some(z => Math.abs(z - level) / level < 0.01);
    if (nearSellZone) { relevance += "Liquidez venda. "; score += weights.liquidity; categories.add('liquidity'); }
    if (rsi15mVal > 65 || rsi1hVal > 65) { relevance += "RSI sobrecompra. "; score += weights.rsi; categories.add('rsi'); }
    if (cvd15mStatus === "Bearish" || obv15mStatus === "Bearish") { relevance += "CVD/OBV bearish. "; score += weights.cvd_obv; categories.add('cvd_obv'); }
    if ((estocasticoD?.k > 80 && estocasticoD?.k < estocasticoD?.d) || (estocastico4h?.k > 80 && estocastico4h?.k < estocastico4h?.d)) { relevance += "Stoch sobrecompra. "; score += weights.stoch; categories.add('stoch'); }
    if (wyckoff.phase.includes("Distribuição")) { relevance += "Wyckoff distribuição. "; score += weights.wyckoff; categories.add('wyckoff'); }
    if (elliott.status.includes("Onda Impulsiva")) { relevance += "Elliott impulsiva. "; score += weights.elliott; categories.add('elliott'); }
    if (orderBook.totalAskVolume > orderBook.totalBidVolume * 1.2) { relevance += "Asks > Bids. "; score += weights.orderbook; categories.add('orderbook'); }
    if (lsrData.account.value < 0.8 || lsrData.position.value < 0.8) { relevance += `LSR bearish. `; score += weights.lsr; categories.add('lsr'); }
    if (oi15m?.status.includes("-")) { relevance += "OI caindo. "; score += weights.oi; categories.add('oi'); }
    if (fundingRate.current > 0) { relevance += "Funding positivo (bom para short). "; score += weights.funding; categories.add('funding'); }
    if (macd && macd.MACD < macd.signal && macd.MACD < 0) { relevance += "MACD bearish. "; score += weights.macd; categories.add('macd'); }

    if (score > 3 && categories.size >= 2) {
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
    let relevance = "Resistência. ";
    let score = 1;

    const nearSellZone = zonas.sellLiquidityZones.some(z => Math.abs(z - zonas.estruturaAlta) / zonas.estruturaAlta < 0.01);
    if (nearSellZone) { relevance += "Liquidez venda. "; score += 2; }
    if (fibLevels['61.8'] && Math.abs(zonas.estruturaAlta - fibLevels['61.8']) / zonas.estruturaAlta < 0.01) { relevance += "Fib 61.8%. "; score += 1; }
    else if (fibLevels['78.6'] && Math.abs(zonas.estruturaAlta - fibLevels['78.6']) / zonas.estruturaAlta < 0.01) { relevance += "Fib 78.6%. "; score += 1; }
    else if (fibLevels['100.0'] && Math.abs(zonas.estruturaAlta - fibLevels['100.0']) / zonas.estruturaAlta < 0.01) { relevance += "Fib 100.0%. "; score += 1; }
    if (lsrData.account.value < 0.8 || lsrData.position.value < 0.8) { relevance += `LSR bearish. `; score += 1; }

    breakoutAbove.push({ level: zonas.estruturaAlta, label: 'Estrutura Alta', explanation: relevance });

    const futureAboveLevels = [
      { level: fibLevels['78.6'], label: 'Fib 78.6%' },
      { level: fibLevels['100.0'], label: 'Fib 100.0%' }
    ].filter(l => l.level > zonas.estruturaAlta && l.level > 0);

    futureAboveLevels.forEach(({ level, label }) => {
      let futureRelevance = "Alvo pós-rompimento alta. ";
      if (zonas.sellLiquidityZones.some(z => Math.abs(z - level) / level < 0.01)) {
        futureRelevance += "Liquidez venda. ";
      }
      breakoutAbove.push({ level, label, explanation: futureRelevance });
    });
  }

  if (zonas.estruturaBaixa > 0 && zonas.estruturaBaixa < price) {
    let relevance = "Suporte. ";
    let score = 1;

    const nearBuyZone = zonas.buyLiquidityZones.some(z => Math.abs(z - zonas.estruturaBaixa) / zonas.estruturaBaixa < 0.01);
    if (nearBuyZone) { relevance += "Liquidez compra. "; score += 2; }
    if (fibLevels['38.2'] && Math.abs(zonas.estruturaBaixa - fibLevels['38.2']) / zonas.estruturaBaixa < 0.01) { relevance += "Fib 38.2%. "; score += 1; }
    else if (fibLevels['23.6'] && Math.abs(zonas.estruturaBaixa - fibLevels['23.6']) / zonas.estruturaBaixa < 0.01) { relevance += "Fib 23.6%. "; score += 1; }
    else if (fibLevels['0.0'] && Math.abs(zonas.estruturaBaixa - fibLevels['0.0']) / zonas.estruturaBaixa < 0.01) { relevance += "Fib 0.0%. "; score += 1; }
    if (lsrData.account.value > 1.2 || lsrData.position.value > 1.2) { relevance += `LSR bullish. `; score += 1; }

    breakoutBelow.push({ level: zonas.estruturaBaixa, label: 'Estrutura Baixa', explanation: relevance });

    const futureBelowLevels = [
      { level: fibLevels['23.6'], label: 'Fib 23.6%' },
      { level: fibLevels['0.0'], label: 'Fib 0.0%' }
    ].filter(l => l.level < zonas.estruturaBaixa && l.level > 0);

    futureBelowLevels.forEach(({ level, label }) => {
      let futureRelevance = "Alvo pós-rompimento baixa. ";
      if (zonas.buyLiquidityZones.some(z => Math.abs(z - level) / level < 0.01)) {
        futureRelevance += "Liquidez compra. ";
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
    breakoutBelow,
    stopLossBuy: stopLossBuy.toFixed(4),
    stopLossSell: stopLossSell.toFixed(4)
  };
}

function formatPrice(value, referencePrice) {
  let num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num) || num === Infinity || num === 0) return 'N/A';
  const price = referencePrice || num;
  return price < 1 ? num.toFixed(8) : price < 10 ? num.toFixed(6) : price < 100 ? num.toFixed(4) : num.toFixed(2);
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

      const ohlcv15m = await exchangeSpot.fetchOHLCV(symbol, '15m', undefined, 50); // Aumentado para melhor detecção
      const ohlcv4h = await exchangeSpot.fetchOHLCV(symbol, '4h', undefined, 20);
      const ohlcvDiario = await exchangeSpot.fetchOHLCV(symbol, '1d', undefined, 20);
      const ohlcv1h = await exchangeSpot.fetchOHLCV(symbol, '1h', undefined, 20);
      if (!ohlcv15m || !ohlcv4h || !ohlcvDiario || !ohlcv1h) {
        logger.warn(`Dados OHLCV insuficientes para ${symbol}`);
        continue;
      }

      const closes15m = ohlcv15m.map(c => c[4]);
      const rsi4h = calculateRSI(ohlcv4h.map(c => ({ close: c[4] })));
      const rsiDiario = calculateRSI(ohlcvDiario.map(c => ({ close: c[4] })));
      const rsi1h = calculateRSI(ohlcv1h.map(c => ({ close: c[4] })));
      const rsi15m = calculateRSI(ohlcv15m.map(c => ({ close: c[4] })));
      const rsi1hVal = rsi1h && rsi1h.length ? rsi1h[rsi1h.length - 1].toFixed(1) : null;
      const rsi15mVal = rsi15m && rsi15m.length ? rsi15m[rsi15m.length - 1].toFixed(1) : null;
      const estocastico4h = calculateStochastic(ohlcv4h.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
      const estocasticoD = calculateStochastic(ohlcvDiario.map(c => ({ high: c[2], low: c[3], close: c[4] })), 5, 3, 3);
      const zonas = detectarQuebraEstrutura(ohlcv15m.map(c => ({ high: c[2], low: c[3], volume: c[5] })));
      const fibLevels = calculateFibonacciLevels(ohlcvDiario);
      const wyckoff = analyzeWyckoff(ohlcvDiario, ohlcv4h, ohlcvDiario[ohlcvDiario.length - 1][5], ohlcvDiario[ohlcvDiario.length - 2][5]);
      const elliott = analyzeElliott(ohlcv4h);
      const orderBook = await fetchOrderBook(symbol);
      const lsrData = await fetchLSR(symbol);
      const cvd15mValue = calculateCVD(ohlcv15m);
      const cvd15mStatus = cvd15mValue > 0 ? "Bullish" : "Bearish";
      const obv15mValue = calculateOBV(ohlcv15m);
      const obv15mStatus = obv15mValue > 0 ? "Bullish" : "Bearish";
      const oi15m = await fetchOpenInterest(symbol, '15m');
      const fundingRate = await fetchFundingRate(symbol);
      const atrData = calculateATR(ohlcv15m.map(c => ({ high: c[2], low: c[3], close: c[4] })));
      const atr = atrData && atrData.length ? atrData[atrData.length - 1] : 0;
      const macd = calculateMACD(closes15m);

      const targets = determineTargets(fibLevels, zonas, rsi1hVal, rsi15mVal, cvd15mStatus, obv15mStatus, estocasticoD, estocastico4h, wyckoff, elliott, orderBook, lsrData, currentPrice, atr, oi15m, fundingRate, macd);

      if (!ultimaEstrutura[symbol]) ultimaEstrutura[symbol] = { price: null, estruturaAlta: null, estruturaBaixa: null };
      if (!ultimoAlertaTempo[symbol]) ultimoAlertaTempo[symbol] = {};

      let alertas = [];

      // Alerta para proximidade de zona de compra
      if (targets.bestBuyZone && Math.abs(currentPrice - parseFloat(targets.bestBuyZone.level)) / parseFloat(targets.bestBuyZone.level) < 0.01) {
        const alertaKey = `${symbol}_proximo_compra`;
        const ultimoAlerta = ultimoAlertaTempo[symbol][alertaKey] || 0;
        if ((Date.now() / 1000) - ultimoAlerta > ALERTA_COOLDOWN_S) {
          const buyZoneLevel = parseFloat(targets.bestBuyZone.level);
          const alvo1 = formatPrice(buyZoneLevel + 2 * atr, currentPrice);
          const alvo2 = formatPrice(buyZoneLevel + 4 * atr, currentPrice);
          const alvo3 = formatPrice(buyZoneLevel + 6 * atr, currentPrice);
          alertas.push(`🟢 *${symbol} FVG/ Zona de Compra* \n💲Preço: ${formatPrice(currentPrice, currentPrice)}\n🔹Zona Compra: ${targets.bestBuyZone.level} (${targets.bestBuyZone.label})\nAnálise Atual: ${targets.bestBuyZone.explanation}\n⛔Stop Loss: ${formatPrice(targets.stopLossBuy, currentPrice)}\n🔹Estrutura Alta: ${formatPrice(zonas.estruturaAlta, currentPrice)}\n🔻Estrutura Baixa: ${formatPrice(zonas.estruturaBaixa, currentPrice)}\n🎯Alvos: ${alvo1}, ${alvo2}, ${alvo3}\n 🤖 Aguarde a confirmação de um FVG 15m ou entrada de volume!`);
          ultimoAlertaTempo[symbol][alertaKey] = Date.now() / 1000;
        }
      }

      // Alerta para proximidade de zona de venda
      if (targets.bestSellZone && Math.abs(currentPrice - parseFloat(targets.bestSellZone.level)) / parseFloat(targets.bestSellZone.level) < 0.01) {
        const alertaKey = `${symbol}_proximo_venda`;
        const ultimoAlerta = ultimoAlertaTempo[symbol][alertaKey] || 0;
        if ((Date.now() / 1000) - ultimoAlerta > ALERTA_COOLDOWN_S) {
          const sellZoneLevel = parseFloat(targets.bestSellZone.level);
          const alvo1 = formatPrice(sellZoneLevel - 2 * atr, currentPrice);
          const alvo2 = formatPrice(sellZoneLevel - 4 * atr, currentPrice);
          const alvo3 = formatPrice(sellZoneLevel - 6 * atr, currentPrice);
          alertas.push(`🔴 *${symbol} FVG/ Zona de Venda* \n💲Preço: ${formatPrice(currentPrice, currentPrice)}\n🔹Zona Venda: ${targets.bestSellZone.level} (${targets.bestSellZone.label})\nAnálise Atual: ${targets.bestSellZone.explanation}\n⛔Stop Loss: ${formatPrice(targets.stopLossSell, currentPrice)}\n🔹Estrutura Alta: ${formatPrice(zonas.estruturaAlta, currentPrice)}\n🔻Estrutura Baixa: ${formatPrice(zonas.estruturaBaixa, currentPrice)}\n🎯Alvos: ${alvo1}, ${alvo2}, ${alvo3}\n 🤖 Observar a formação de FVG e mudança de tendência, Proteja seus lucros!`);
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
    // Tentar novamente após um delay
    await new Promise(resolve => setTimeout(resolve, API_DELAY_MS));
    try {
      const markets = await exchangeSpot.loadMarkets();
      return !!markets[symbol];
    } catch (retryError) {
      logger.error(`Erro ao validar par ${symbol} na segunda tentativa: ${retryError.message}`);
      return false;
    }
  }
}

// Comando de teste para verificar se o bot está funcionando
bot.command('test', async (ctx) => {
  await ctx.reply('Bot funcionando! Use /info BTCUSDT para análise.');
  logger.info('Comando /test executado');
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
        ctx.reply('Ocorreu um erro interno. Tente novamente mais tarde.');
      }
    });

    // Listener para debug de mensagens
    bot.on('message', (ctx) => {
      logger.info(`Mensagem recebida: ${ctx.message.text} de ${ctx.from?.username || 'desconhecido'}`);
    });

    logger.info('Bot configurado, iniciando...');
    await bot.api.sendMessage(TELEGRAM_CHAT_ID, 'Titanium.');
    
    setInterval(monitorRealTime, INTERVALO_MONITORAMENTO_TEMPO_REAL_MS);
    await monitorRealTime();

    await bot.start();
    logger.info('Bot iniciado com sucesso');
  } catch (e) {
    logger.error(`Erro ao iniciar bot: ${e.message}`, { stack: e.stack });
  }
}

main();
