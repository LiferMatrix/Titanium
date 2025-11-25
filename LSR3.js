require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

// === EXATAMENTE COMO NO TEU TITANIUM ST3 ===
const config = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  PARES_MONITORADOS: (process.env.COINS || "BTCUSDT,ETHUSDT,BNBUSDT,ENJUSDT").split(","),
};

if (!config.TELEGRAM_BOT_TOKEN) {
  console.error('ERRO: TELEGRAM_BOT_TOKEN não encontrado no .env');
  process.exit(1);
}

const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

async function getInfo(symbol) {
  const s = symbol.toUpperCase().trim();
  try {
    const [priceRes, k1h, k4h, k12h, k1d, lsrRes, oiRes, depthRes] = await Promise.all([
      axios.get(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${s}`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=4h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=12h&limit=100`),
      axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${s}&interval=1d&limit=100`),
      axios.get(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1h&limit=5`),
      axios.get(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`),
      axios.get(`https://fapi.binance.com/fapi/v1/depth?symbol=${s}&limit=20`)
    ].map(p => p.catch(() => ({ data: null }))));

    if (!priceRes.data) throw new Error('Símbolo inválido');

    const price = +priceRes.data.price;

    // RSI rápido
    const closes = k1h.data.map(c => +c[4]);
    const changes = closes.slice(-15).map((c, i, a) => i > 0 ? c - a[i-1] : 0);
    const gains = changes.filter(x => x > 0);
    const losses = changes.filter(x => x < 0).map(x => -x);
    const avgGain = gains.reduce((a,b)=>a+b,0)/14;
    const avgLoss = losses.reduce((a,b)=>a+b,0)/14 || 0.0001;
    const rsi = (100 - (100 / (1 + avgGain/avgLoss))).toFixed(1);

    // Stochastic simples
    const stoch = (data) => {
      if (data.length < 14) return { k: 'N/D', zone: '' };
      const h = data.slice(-14).map(c => +c[2]);
      const l = data.slice(-14).map(c => +c[3]);
      const c = +data[data.length-1][4];
      const hh = Math.max(...h);
      const ll = Math.min(...l);
      const k = hh === ll ? 50 : ((c - ll) / (hh - ll) * 100).toFixed(1);
      const zone = k > 80 ? 'Overbought' : k < 20 ? 'Oversold' : 'Neutral';
      return { k, zone };
    };

    const s4h = stoch(k4h.data);
    const s12h = stoch(k12h.data);
    const s1d = stoch(k1d.data);

    const lsr = +lsrRes.data[0].longShortRatio;
    const oiB = (+oiRes.data.openInterest / 1e9).toFixed(2);

    const thresh = price * 0.005;
    const bidsVol = depthRes.data.bids.reduce((a,[p,q]) => Math.abs(price - p) <= thresh ? a + +q : a, 0).toFixed(1);
    const asksVol = depthRes.data.asks.reduce((a,[p,q]) => Math.abs(price - p) <= thresh ? a + +q : a, 0).toFixed(1);

    return `*${s}* — Análise Rápida

💲 Preço: $${price.toFixed(price < 1 ? 6 : 2)}
📊 RSI 1h: ${rsi} ${rsi > 70 ? '🔴 Overbought' : rsi < 30 ? '🟢 Oversold' : ''}
Stoch 4h: %K ${s4h.k} ${s4h.zone}
Stoch 12h: %K ${s12h.k} ${s12h.zone}
Stoch 1d: %K ${s1d.k} ${s1d.zone}

#LSR: ${lsr.toFixed(3)}
Open Interest: $${oiB}B
Order Blocks ±0.5%: Bids ${bidsVol} | Asks ${asksVol}`;

  } catch (e) {
    return `❌ Erro ${s}: ${e.message}`;
  }
}

// Comando /info
bot.command('info', async (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) return ctx.reply('Uso: /info BTCUSDT');
  const symbol = args[1].toUpperCase();
  const loading = await ctx.reply('Analisando...');
  const texto = await getInfo(symbol);
  ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, texto, { parse_mode: 'Markdown' });
});

// Comando /all — análise de todos os teus pares do .env
bot.command('all', async (ctx) => {
  const loading = await ctx.reply('Analisando todos os pares...');
  let texto = '*Análise Completa - Seus Pares*\n\n';
  for (const par of config.PARES_MONITORADOS) {
    texto += await getInfo(par) + '\n\n';
  }
  ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, texto, { parse_mode: 'Markdown' });
});

bot.start(ctx => ctx.reply('Bot de análise rápida ativo!\n/info BTCUSDT ou /all para todos os pares do .env'));

bot.launch();
console.log('BOT DE ANÁLISE RODANDO NO TERMUX - usando teu .env exato');
