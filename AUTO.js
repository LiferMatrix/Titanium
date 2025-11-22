require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs/promises');

// ===================== CONFIGURAÇÕES =====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
const logFile = 'titanium.log';

// ===================== LOG =====================
async function logMessage(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  try { await fs.appendFile(logFile, logEntry + '\n', 'utf8'); } catch {}
}
setInterval(async () => {
  try { await fs.writeFile(logFile, '', 'utf8'); await logMessage('Logs limpos'); } catch {}
}, 2 * 24 * 60 * 60 * 1000);

// ===================== RECONEXÃO SEGURA =====================
async function safeRequest(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch { await new Promise(r => setTimeout(r, 5000 * (i + 1))); }
  }
  return null;
}

// ===================== FUNÇÕES DE INDICADORES =====================
const ema = (arr, period) => {
  const k = 2 / (period + 1);
  let val = arr[0];
  for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
  return val;
};

function calculateStochastic(klines) {
  if (klines.length < 15) return { k: 'N/A', d: 'N/A', kDir: '', dDir: '' };
  const h = klines.map(k => parseFloat(k[2]));
  const l = klines.map(k => parseFloat(k[3]));
  const c = klines.map(k => parseFloat(k[4]));

  const rawK = [];
  for (let i = 4; i < c.length; i++) {
    const hh = Math.max(...h.slice(i-4, i+1));
    const ll = Math.min(...l.slice(i-4, i+1));
    rawK.push(hh === ll ? 50 : 100 * ((c[i] - ll) / (hh - ll)));
  }
  const kLine = rawK.slice(-3).reduce((a,b) => a+b, 0) / 3;
  const dLine = rawK.slice(-6, -3).reduce((a,b) => a+b, 0) / 3;

  const prevK = rawK.length > 6 ? rawK.slice(-6, -3).reduce((a,b) => a+b, 0) / 3 : kLine;
  const prevD = rawK.length > 9 ? rawK.slice(-9, -6).reduce((a,b) => a+b, 0) / 3 : dLine;

  return {
    k: kLine.toFixed(2),
    d: dLine.toFixed(2),
    kDir: kLine > prevK ? '⬆︎' : kLine < prevK ? '⬇︎' : '➡︎',
    dDir: dLine > prevD ? '⬆︎' : dLine < prevD ? '⬇︎' : '➡︎'
  };
}

function calculateRSI(closes) {
  if (closes.length < 15) return 'N/A';
  let gains = 0, losses = 0;
  for (let i = 1; i <= 14; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / 14;
  let avgLoss = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    avgGain = (avgGain * 13 + (diff > 0 ? diff : 0)) / 14;
    avgLoss = (avgLoss * 13 + (diff < 0 ? -diff : 0)) / 14;
  }
  return avgLoss === 0 ? 100 : (100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
}

function calculateADX(high, low, close) {
  if (close.length < 15) return 0;
  let tr = [], dmPlus = [], dmMinus = [];
  for (let i = 1; i < close.length; i++) {
    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i-1]);
    const tr3 = Math.abs(low[i] - close[i-1]);
    tr.push(Math.max(tr1, tr2, tr3));
    const up = high[i] - high[i-1];
    const down = low[i-1] - low[i];
    dmPlus.push(up > down && up > 0 ? up : 0);
    dmMinus.push(down > up && down > 0 ? down : 0);
  }
  let atr = tr.slice(0,14).reduce((a,b)=>a+b,0)/14;
  let diPlus = dmPlus.slice(0,14).reduce((a,b)=>a+b,0)/atr;
  let diMinus = dmMinus.slice(0,14).reduce((a,b)=>a+b,0)/atr;
  const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
  return dx.toFixed(1);
}

// ===================== ALERTA INTELIGENTE ANTI-SPAM =====================
let lastBreakAlert = {
  time: 0,
  direction: null,     // 'UP' ou 'DOWN'
  priceLevel: 0
};

async function sendSmartBreakAlert(direction, emaLevel) {
  const now = Date.now();
  const cooldown = 30 * 60 * 1000; // 30 minutos entre qualquer alerta

  // 1. Cooldown geral
  if (now - lastBreakAlert.time < cooldown) return;

  // 2. Se for mesma direção → exige no mínimo +0.8% de movimento
  if (lastBreakAlert.direction === direction) {
    const pct = Math.abs(price - lastBreakAlert.priceLevel) / lastBreakAlert.priceLevel * 100;
    if (pct < 0.8) return;
  }

  // 3. ADX realmente forte
  const adx15 = parseFloat(adx15m);
  const adx1h = parseFloat(adx1h);
  if (direction === 'UP' && adx15 < 28 && adx1h < 28) return;
  if (direction === 'DOWN' && adx15 < 26 && adx1h < 26) return;

  const emoji = direction === 'UP' ? 'EXPLOSÃO DE ALTA' : 'PRESSÃO FORTE DE BAIXA';
  const msg = `
*${emoji} BTCUSDT ROMPEU EMA55!*

Preço: $${price.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1})}
EMA55: $${emaLevel.toFixed(1)}
ADX 15m: ${adx15m} | 1h: ${adx1h}
Movimento: ${(Math.abs(price - emaLevel)/emaLevel*100).toFixed(2)}%

${direction === 'UP' ? 'COMPRA AGRESSIVA!' : 'CUIDADO COM LONGS / POSSÍVEL SHORT'}

By @J4Rviz — Titanium 
  `.trim();

  await bot.sendMessage(TELEGRAM_CHAT_ID, msg, {parse_mode: 'Markdown'});
  await logMessage(`ALERTA INTELIGENTE ${direction} enviado`);

  lastBreakAlert = { time: now, direction, priceLevel: emaLevel };
}

// ===================== ANÁLISE BTC =====================
let price, adx15m, adx1h; // globais pro alerta

async function enviarAnaliseBTC() {
  try {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    const [
      priceRes, k1h, k15m, k3m, k4h, k12h, k1d,
      depthRes, oiRes, lsrRes, price1hAgoRes
    ] = await Promise.all([
      axios.get('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=100'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=100'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=3m&limit=100'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=50'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=12h&limit=50'),
      axios.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=50'),
      axios.get('https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000'),
      axios.get('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=13'),
      axios.get('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=15m&limit=2'),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=2&endTime=${oneHourAgo}`)
    ]);

    price = parseFloat(priceRes.data.price);
    const priceStr = price.toLocaleString('en-US', {minimumFractionDigits:1, maximumFractionDigits:1});

    const c1h = k1h.data.map(k=>parseFloat(k[4]));
    const c15m = k15m.data.map(k=>parseFloat(k[4]));
    const c3m = k3m.data.map(k=>parseFloat(k[4]));
    const h1h = k1h.data.map(k=>parseFloat(k[2]));
    const l1h = k1h.data.map(k=>parseFloat(k[3]));

    const ema13_1h = ema(c1h,13), ema34_1h = ema(c1h,34), ema55_1h = ema(c1h,55);
    const ema13_15m = ema(c15m,13), ema34_15m = ema(c15m,34), ema55_15m = ema(c15m,55);
    const ema55_3m = ema(c3m,55);

    const tendencia1h = ema13_1h > ema34_1h ? '⬆︎' : '⬇︎';
    const tendencia15m = ema13_15m > ema34_15m ? '⬆︎' : '⬇︎';

    adx15m = calculateADX(k15m.data.map(k=>parseFloat(k[2])), k15m.data.map(k=>parseFloat(k[3])), c15m);
    adx1h = calculateADX(k1h.data.map(k=>parseFloat(k[2])), k1h.data.map(k=>parseFloat(k[3])), c1h);

    // === ALERTA INTELIGENTE ===
    const prev15m = parseFloat(k15m.data.at(-2)[4]);
    const prev3m  = parseFloat(k3m.data.at(-2)[4]);
    const prev1h  = parseFloat(k1h.data.at(-2)[4]);

    if ((price > ema55_15m && prev15m <= ema55_15m) || 
        (price > ema55_3m  && prev3m  <= ema55_3m)  || 
        (price > ema55_1h  && prev1h  <= ema55_1h)) {
      await sendSmartBreakAlert('UP', Math.max(ema55_3m, ema55_15m, ema55_1h));
    }
    if ((price < ema55_15m && prev15m >= ema55_15m) || 
        (price < ema55_3m  && prev3m  >= ema55_3m)  || 
        (price < ema55_1h  && prev1h  >= ema55_1h)) {
      await sendSmartBreakAlert('DOWN', Math.min(ema55_3m, ema55_15m, ema55_1h));
    }

    // === RESTANTE DOS DADOS ===
    const stoch4h = calculateStochastic(k4h.data);
    const stoch12h = calculateStochastic(k12h.data);
    const stoch1d = calculateStochastic(k1d.data);

    const rsi1h = calculateRSI(c1h);
    const rsi4h = calculateRSI(k4h.data.map(k=>parseFloat(k[4])));

    const oiAtual = (parseFloat(oiRes.data.at(-1).sumOpenInterestValue)/1e9).toFixed(2);
    const oiVar = (parseFloat(oiRes.data.at(-1).sumOpenInterestValue) - parseFloat(oiRes.data[0].sumOpenInterestValue))/1e6;
    const dirOI = oiVar > 0 ? '⬆︎' : '⬇︎';

    const bids = depthRes.data.bids.filter(b=>parseFloat(b[0]) >= price*0.99);
    const asks = depthRes.data.asks.filter(a=>parseFloat(a[0]) <= price*1.01);
    const bidsBTC = bids.reduce((s,b)=>s+parseFloat(b[1]),0).toFixed(1);
    const asksBTC = asks.reduce((s,a)=>s+parseFloat(a[1]),0).toFixed(1);
    const deltaBTC = (bidsBTC - asksBTC).toFixed(1);
    const deltaPct = ((bidsBTC - asksBTC)/(parseFloat(bidsBTC)+parseFloat(asksBTC))*100).toFixed(1);
    const pressao = deltaPct > 15 ? 'Order Block COMPRA FORTE' :
                    deltaPct > 5 ? 'Pressão compradora' :
                    deltaPct < -15 ? 'Order Block VENDA FORTE' :
                    deltaPct < -5 ? 'Pressão vendedora' : 'Equilibrado';

    const lsr = lsrRes.data[0] ? parseFloat(lsrRes.data[0].longShortRatio).toFixed(2) : 'N/A';
    const price1hAgo = price1hAgoRes.data[0] ? parseFloat(price1hAgoRes.data[0][4]) : price;
    const change1h = ((price - price1hAgo)/price1hAgo*100).toFixed(2);
    const dir1h = change1h > 0 ? '⬆︎' : '⬇︎';

    const support = Math.min(...l1h.slice(-50)).toFixed(1);
    const resistance = Math.max(...h1h.slice(-50)).toFixed(1);

    const msg = `
*#BTCUSDT - #Titanium #IA* (${new Date().toLocaleString('pt-BR')})

*Preço:* $${priceStr}
*Tendência:* 1h → ${tendencia1h} | 15m → ${tendencia15m}

*EMA55*
├ 3m:  $${ema55_3m.toFixed(1)} ${price > ema55_3m ? '⬆︎' : '⬇︎'}
├ 15m: $${ema55_15m.toFixed(1)} ${price > ema55_15m ? '⬆︎' : '⬇︎'}
└ 1h:  $${ema55_1h.toFixed(1)} ${price > ema55_1h ? '⬆︎' : '⬇︎'}

*ADX* → 15m: ${adx15m} | 1h: ${adx1h}

*Stoch (5,3,3)*
├ 4h:  %K ${stoch4h.k} ${stoch4h.kDir} │ %D ${stoch4h.d} ${stoch4h.dDir}
├ 12h: %K ${stoch12h.k} ${stoch12h.kDir} │ %D ${stoch12h.d} ${stoch12h.dDir}
└ 1d:  %K ${stoch1d.k} ${stoch1d.kDir} │ %D ${stoch1d.d} ${stoch1d.dDir}

*RSI* → 1h: ${rsi1h} | 4h: ${rsi4h}
*OI:* $${oiAtual}B │ ${dirOI} ${Math.abs(oiVar).toFixed(0)}M
*LSR 15m:* ${lsr}

*Orderbook (±1%)*
├ Bids(vendas): *${bidsBTC} BTC* │ Asks(compras): *${asksBTC} BTC*
└ Delta: ${deltaBTC > 0 ? '+' : ''}${deltaBTC} BTC (${deltaPct}%) → *${pressao}*

*1h:* ${dir1h} ${Math.abs(change1h)}%
*Análise Rápida*
├ Suporte: $${support}
└ Resistência: $${resistance}

                    By @J4Rviz — Titanium 
    `.trim();

    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, {parse_mode: 'Markdown'});
    await logMessage('Análise completa enviada');

  } catch (err) {
    await logMessage('Erro: ' + err.message);
  }
}

// ===================== LISTAGENS + START =====================
const symbolsFile = 'initialSymbols.json';
let initialSymbols = new Set();
let isFirstRun = true;

async function loadInitialSymbols() {
  try {
    const data = await fs.readFile(symbolsFile, 'utf8');
    initialSymbols = new Set(JSON.parse(data));
    isFirstRun = false;
  } catch (err) { if (err.code !== 'ENOENT') console.error(err); isFirstRun = true; }
}

async function saveInitialSymbols(sym) { await fs.writeFile(symbolsFile, JSON.stringify(Array.from(sym)), 'utf8'); }

async function checkListings() {
  const res = await safeRequest(() => axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo'));
  if (!res) return;
  const current = res.data.symbols.filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT').map(s => s.symbol);

  if (isFirstRun) { initialSymbols = new Set(current); await saveInitialSymbols(initialSymbols); isFirstRun = false; return; }

  const novas = current.filter(s => !initialSymbols.has(s));
  if (novas.length > 0) {
    for (const s of novas) {
      await bot.sendMessage(TELEGRAM_CHAT_ID, `*NOVA LISTAGEM!*\n\n\`${s}\`\n\n${new Date().toLocaleString('pt-BR')}`, {parse_mode:'Markdown'});
      await logMessage(`NOVA: ${s}`);
    }
  }
  initialSymbols = new Set(current);
  await saveInitialSymbols(initialSymbols);
}

// ===================== START =====================
(async () => {
  await loadInitialSymbols();
  await logMessage('Titanium Elite 2025 iniciado!');
  await enviarAnaliseBTC();
  setInterval(enviarAnaliseBTC, 60*60*1000);   // análise completa 1x/hora
  setInterval(enviarAnaliseBTC, 3*60*1000);    // checa rompimento a cada 3min
  await checkListings();
  setInterval(checkListings, 30000);
})();

process.on('SIGINT', async () => {
  await saveInitialSymbols(initialSymbols);
  await logMessage('Bot encerrado.');
  process.exit(0);
});
