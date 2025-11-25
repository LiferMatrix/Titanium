require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const chatId = process.env.TELEGRAM_CHAT_ID;
const pares = (process.env.PARES_MONITORADOS || 'BTCUSDT,ETHUSDT,BNBUSDT').split(',');
const intervalo = parseInt(process.env.INTERVALO_MONITORAMENTO) || 300000; // 5min default

async function getInfo(symbol) {
  const s = symbol.toUpperCase().trim();

  try {
    const [
      priceRes,
      klines1h,
      klines4h,
      klines12h,
      klinesDaily,
      lsrRes,
      oiRes,
      depthRes
    ] = await Promise.all([
      axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${s}`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=4h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=12h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1d&limit=100`),
      axios.get(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=5`),
      axios.get(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`),
      axios.get(`https://fapi.binance.com/fapi/v1/depth?symbol=${s}&limit=20`)
    ]);

    const price = parseFloat(priceRes.data.price);
    const trend1h = parseFloat(klines1h.data[klines1h.data.length - 1][4]) > parseFloat(klines1h.data[klines1h.data.length - 2][4]) ? '📈Alta' : '📉Baixa';

    // RSI 1h
    const closes1h = klines1h.data.map(k => parseFloat(k[4]));
    const rsi1h = calculateRSI(closes1h, 14);
    const rsiText = rsi1h >= 70 ? `🔴 ${rsi1h.toFixed(1)}` : rsi1h <= 30 ? `🟢 ${rsi1h.toFixed(1)}` : `${rsi1h.toFixed(1)}`;

    // MACD 1h
    const macd = calculateMACD(closes1h);
    const macdDir = macd.hist > macd.prevHist ? '⤴︎' : macd.hist < macd.prevHist ? '⤵︎' : '➡︎';
    const macdSignal = macd.hist > 0 ? '🟢bullish' : '🔴bearish';

    // Suporte e Resistência (50 velas 1h)
    const last50 = klines1h.data.slice(-50);
    const resistance = Math.max(...last50.map(k => parseFloat(k[2])));
    const support = Math.min(...last50.map(k => parseFloat(k[3])));

    // Estocásticos
    const stoch4h = getStoch(klines4h.data);
    const stoch12h = getStoch(klines12h.data);
    const stoch1d = getStoch(klinesDaily.data);

    // LSR
    const currentLSR = parseFloat(lsrRes.data[0].longShortRatio).toFixed(3);
    const prevLSR = parseFloat(lsrRes.data[1]?.longShortRatio || currentLSR);
    const lsrChange = (currentLSR - prevLSR).toFixed(4);

    // Open Interest
    const oiData = oiRes.data;
    const currentOI = (parseFloat(oiData.openInterest) / 1e9).toFixed(3); // em bilhões

    // Order Blocks (±0.5%)
    const threshold = price * 0.005;
    let bidsVol = 0, asksVol = 0;

    depthRes.data.bids.forEach(([p, q]) => {
      if (Math.abs(price - parseFloat(p)) <= threshold) bidsVol += parseFloat(q);
    });
    depthRes.data.asks.forEach(([p, q]) => {
      if (Math.abs(price - parseFloat(p)) <= threshold) asksVol += parseFloat(q);
    });

    const base = s.replace('USDT', '');

    return `#ATIVO: ${s}
Preço Atual: $${price.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
Tendência 1h: ${trend1h}

NÍVEIS - #1H
Suporte próximo: $${support.toFixed(2)}
Resistência próxima: $${resistance.toFixed(2)}

INDICADORES
• RSI 1h - ${rsiText}
• MACD 1h - Hist ${macd.hist.toFixed(2)} ${macdDir} ${macdSignal}
• ESTOCÁSTICO (5,3,3)
• #4h - ${stoch4h.text} ${stoch4h.zone}
• #12h- ${stoch12h.text} ${stoch12h.zone}
• #1d - ${stoch1d.text} ${stoch1d.zone}

MERCADO INSTITUCIONAL
#LSR: ${currentLSR} (${lsrChange > 0 ? '+' : ''}${lsrChange})
Open Interest: $${currentOI}B

ORDER BLOCKS (±0.5% do preço atual)
🟢Bids (compras): ${bidsVol.toFixed(2)} ${base}
🔴Asks (vendas): ${asksVol.toFixed(2)} ${base}`;

  } catch (error) {
    console.error('Erro ao analisar:', error.message);
    return `Erro ao analisar ${s}: ${error.message}`;
  }
}

// Funções auxiliares (já estavam, corrigi acessos at(-1) pra compatibilidade)
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = Math.abs(losses) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(closes) {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let emaVal = data[0];
    for (let i = 1; i < data.length; i++) emaVal = data[i] * k + emaVal * (1 - k);
    return emaVal;
  };

  const ema12 = ema(closes.slice(-50), 12);
  const ema26 = ema(closes.slice(-50), 26);
  const macdLine = ema12 - ema26;

  const prevCloses = closes.slice(0, -1);
  const prevEma12 = ema(prevCloses.slice(-50), 12);
  const prevEma26 = ema(prevCloses.slice(-50), 26);
  const prevMacd = prevEma12 - prevEma26;

  const hist = macdLine;
  const prevHist = prevMacd;

  return { hist, prevHist };
}

function getStoch(klines) {
  const length = klines.length;
  if (length < 20) return { text: "N/D", zone: "" };

  const highs = klines.slice(-20).map(k => parseFloat(k[2]));
  const lows = klines.slice(-20).map(k => parseFloat(k[3]));
  const closes = klines.slice(-20).map(k => parseFloat(k[4]));

  const high14 = Math.max(...highs.slice(-14));
  const low14 = Math.min(...lows.slice(-14));
  const k = low14 === high14 ? 50 : ((closes[closes.length - 1] - low14) / (high14 - low14)) * 100;

  const prevHigh = Math.max(...highs.slice(-15, -1));
  const prevLow = Math.min(...lows.slice(-15, -1));
  const prevK = prevLow === prevHigh ? 50 : ((closes[closes.length - 2] - prevLow) / (prevHigh - prevLow)) * 100;

  const slowK = (k + prevK + (closes[closes.length - 3] && ((closes[closes.length - 3] - Math.min(...lows.slice(-16, -2))) / (Math.max(...highs.slice(-16, -2)) - Math.min(...lows.slice(-16, -2)))) * 100 || k)) / 3;
  const d = slowK;

  const kDir = k > prevK ? '⤴︎' : k < prevK ? '⤵︎' : '➡︎';
  const zone = k > 80 ? '🔴' : k < 20 ? '🟢' : k > d ? '📈Alta' : '📉Baixa';

  return { text: `%K ${k.toFixed(1)} ${kDir} | %D ${d.toFixed(1)}`, zone };
}

// Comando /info (sob demanda)
bot.command('info', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Uso: /info BTCUSDT');

  const symbol = args[1].toUpperCase();
  const texto = await getInfo(symbol);
  ctx.reply(texto, { parse_mode: 'Markdown' });
});

// Comando /start (pra pegar chat ID se precisar)
bot.start((ctx) => ctx.reply(`Bot pronto! Seu chat ID: ${ctx.chat.id}. Use /info SYMBOL`));

// Monitoramento automático (cada par a cada intervalo)
async function monitorarPares() {
  for (const par of pares) {
    const texto = await getInfo(par);
    await bot.telegram.sendMessage(chatId, texto, { parse_mode: 'Markdown' }).catch(err => console.error('Erro envio:', err));
  }
}

setInterval(monitorarPares, intervalo);

bot.launch();
console.log('Bot rodando no Termux - monitoramento ativo!');
