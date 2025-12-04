const fetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '8010060485:AAESqJ';
const TELEGRAM_CHAT_ID   = '-100255';

// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// 🔵 AJUSTADO PARA O 1H
const TIMEFRAME = '1h';

const SYMBOL = 'BTCUSDT';

async function sendAlert(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      })
    });
  } catch (e) {
    console.log('Erro ao enviar Telegram:', e.message);
  }
}

async function getCandles() {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${TIMEFRAME}&limit=200`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map(c => ({
    time: c[0],
    open: +c[1],
    high: +c[2],
    low: +c[3],
    close: +c[4]
  }));
}

function isUpFractal(lows, index) {
  if (FRACTAL_BARS === 5) {
    return lows[index-N-2] > lows[index-N] &&
           lows[index-N-1] > lows[index-N] &&
           lows[index-N+1] > lows[index-N] &&
           lows[index-N+2] > lows[index-N];
  } else {
    return lows[index-N-1] > lows[index-N] &&
           lows[index-N+1] > lows[index-N];
  }
}

function isDnFractal(highs, index) {
  if (FRACTAL_BARS === 5) {
    return highs[index-N-2] < highs[index-N] &&
           highs[index-N-1] < highs[index-N] &&
           highs[index-N+1] < highs[index-N] &&
           highs[index-N+2] < highs[index-N];
  } else {
    return highs[index-N-1] < highs[index-N] &&
           highs[index-N+1] < highs[index-N];
  }
}

(async () => {
  console.clear();

  // 🔵 MENSAGEM DE INICIALIZAÇÃO
  console.log('\n==============================');
  console.log(' BOT DO SWEEP 1H INICIADO');
  console.log(' MONITORANDO BTCUSDT');
  console.log(' TIMEFRAME: 1H');
  console.log(' AGUARDANDO SWEEP DE LIQUIDEZ...');
  console.log('==============================\n');

  await sendAlert('🔵 BOT INICIADO\nMonitorando...');

  let lastBuyAlert = 0;
  let lastSellAlert = 0;
  const COOLDOWN = 3 * 60 * 1000; // 30 minutos

  while (true) {
    try {
      const candles = await getCandles();
      if (candles.length < 100) continue;

      const highs = candles.map(c => c.high);
      const lows  = candles.map(c => c.low);
      const closes = candles.map(c => c.close);
      const currentIndex = candles.length - 1;
      const price = closes[currentIndex];

      let buySignal = false;
      let sellSignal = false;

      // Sweep BEAR
      if (isDnFractal(highs, currentIndex - N)) {
        const fractalHigh = highs[currentIndex - N];
        if (price > fractalHigh) {
          const now = Date.now();
          if (now - lastSellAlert > COOLDOWN) {
            const msg = `BTC Liquidez Bear Capturada\n${SYMBOL}\n` +
                        `Preço: $${price.toFixed(2)}\n` +
                        `TF: 1H\n` +
                        `Titanium Sweep`;
            console.log(msg);
            await sendAlert(msg);
            lastSellAlert = now;
            sellSignal = true;
          }
        }
      }

      // Sweep BULL
      if (isUpFractal(lows, currentIndex - N)) {
        const fractalLow = lows[currentIndex - N];
        if (price < fractalLow) {
          const now = Date.now();
          if (now - lastBuyAlert > COOLDOWN) {
            const msg = `BTC Liquidez Bull Capturada \n${SYMBOL}\n` +
                        `Preço: $${price.toFixed(2)}\n` +
                        `TF: 1H\n` +
                        `Titanium Sweep`;
            console.log(msg);
            await sendAlert(msg);
            lastBuyAlert = now;
            buySignal = true;
          }
        }
      }

      if (!buySignal && !sellSignal) {
        process.stdout.write('.');
      } else {
        process.stdout.write('\nALERTA ENVIADO!\n');
      }

      await new Promise(r => setTimeout(r, 30000));

    } catch (e) {
      console.log('Erro:', e.message);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
})();
