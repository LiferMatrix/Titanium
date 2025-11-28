// titanium-sentinel.js → COM ADX 1h + 15m NOS ALERTAS
const fetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = fetch;

const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_D_oZfswILgUd0i2wHgF88fo4N0A';
const TELEGRAM_CHANNEL_ID = '-1001990889297';

async function sendToTelegram(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHANNEL_ID,
                text: text,
                parse_mode: 'HTML'
            })
        });
    } catch (e) {
        console.log('Erro Telegram:', e.message);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// === NOVO: FUNÇÃO ADX (período 14) ===
function calculateADX(candles, period = 14) {
    if (candles.length < period + 1) return 0;

    let plusDM = [];
    let minusDM = [];
    let tr = [];

    for (let i = 1; i < candles.length; i++) {
        const upMove = candles[i].h - candles[i - 1].h;
        const downMove = candles[i - 1].l - candles[i].l;

        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

        const trueRange = Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - candles[i - 1].c),
            Math.abs(candles[i].l - candles[i - 1].c)
        );
        tr.push(trueRange);
    }

    let atr = tr.slice(-period).reduce((a, b) => a + b) / period;
    let plusDI = 100 * (plusDM.slice(-period).reduce((a, b) => a + b) / period) / atr;
    let minusDI = 100 * (minusDM.slice(-period).reduce((a, b) => a + b) / period) / atr;

    let dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return dx.toFixed(1);
}

// === RESTANTE DAS FUNÇÕES (mantidas) ===
async function getData() {
    const [priceRes, h1Res, m15Res] = await Promise.all([
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
        fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100'),
        fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100')
    ]);

    const price = parseFloat((await priceRes.json()).price);
    const h1 = (await h1Res.json()).map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
    const m15 = (await m15Res.json()).map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));

    return { price, h1, m15 };
}

function calculateATR(candles, period = 14) {
    let trs = [];
    for (let i = 1; i < candles.length; i++) {
        const tr = Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - candles[i-1].c),
            Math.abs(candles[i].l - candles[i-1].c)
        );
        trs.push(tr);
    }
    return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
}

function calculateRSI(closes, period =14) {
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[closes.length-i] - closes[closes.length-i-1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = Math.abs(losses) / period;
    return (100 - (100 / (1 + avgGain/avgLoss))).toFixed(1);
}

function calculateCCI(h1) {
    const period = 20;
    const last = h1.slice(-period);
    const tp = last.map(c => (c.h + c.l + c.c)/3);
    const sma = tp.reduce((a,b)=>a+b)/period;
    const md = tp.reduce((s,v)=>s+Math.abs(v-sma),0)/period;
    return (tp[tp.length-1] - sma) / (0.015 * md);
}

(async () => {
    console.clear();

    const bootMsg = `
<b>🤖 IA TITANIUM SENTINEL ATIVADA</b>

Data/Hora: <b>${new Date().toLocaleString('pt-BR')}</b>
Status: <b>Online • Modo Caça Extrema</b>
Aguardando setup BTC…
    `.trim();

    console.log(bootMsg.replace(/<[^>]*>/g, ''));
    await sendToTelegram(bootMsg);

    while (true) {
        try {
            const { price, h1, m15 } = await getData();

            const closesH1 = h1.map(c => c.c);
            const cci = parseFloat(calculateCCI(h1));
            const rsi1h = parseFloat(calculateRSI(closesH1));
            const ema8 = closesH1.slice(-8).reduce((a,b)=>b*(2/9)+a*(7/9), closesH1[closesH1.length-9]);
            const ema21 = closesH1.slice(-21).reduce((a,b)=>b*(2/22)+a*(20/22), closesH1[closesH1.length-22]);
            const bullish = ema8 > ema21;

            const atr = calculateATR(h1);
            const stopDistance = atr * 1.5;

            const longs15 = m15.slice(-20).filter(c => c.c > c.o).length;
            const shorts15 = m15.slice(-20).filter(c => c.c < c.o).length;
            const lsr15 = (longs15 / (longs15 + shorts15) * 100).toFixed(1);

            const vol5 = h1.slice(-5).reduce((s,c)=>s+c.v,0)/5;
            const vol20 = h1.slice(-20).reduce((s,c)=>s+c.v,0)/20;
            const volZ = ((vol5 / vol20 - 1) * 100).toFixed(1);

            
            const adx1h = calculateADX(h1);
            const adx15m = calculateADX(m15);

            if (bullish && cci <= -90) {
                const alert = `
#🤖 IA TITANIUM SENTINEL

<b>🟢BTC COMPRA</b>
Preço: <b>$${price.toFixed(0)}</b>
Alavancagem: <b>${cci<=-130?'20x–50x':'10x–25x'}</b>
Stop: <b>$${(price - stopDistance).toFixed(0)}</b>
TP1: $${(price + atr*2).toFixed(0)} │ TP2: $${(price + atr*4).toFixed(0)} │ TP3: $${(price + atr*7).toFixed(0)}
RSI 1h: ${rsi1h}% • LSR: ${lsr15}% • Vol ${volZ>0?'up':'down'}${volZ}%
<b>ADX 1h: ${adx1h} │ ADX 15m: ${adx15m}</b>
<b>Reversão — COMPRA!</b>
                `.trim();

                console.log(alert);
                await sendToTelegram(alert);
            }
            else if (!bullish && cci >= 90) {
                const alert = `
#🤖 IA TITANIUM SENTINEL

<b>🔴BTC CORREÇÃO</b>
Preço: <b>$${price.toFixed(0)}</b>
Alavancagem: <b>${cci>=130?'20x–50x':'10x–25x'}</b>
Stop: <b>$${(price + stopDistance).toFixed(0)}</b>
TP1: $${(price - atr*2).toFixed(0)} │ TP2: $${(price - atr*4).toFixed(0)} │ TP3: $${(price - atr*7).toFixed(0)}
RSI 1h: ${rsi1h}% • LSR: ${lsr15}% • Vol ${volZ>0?'up':'down'}${volZ}%
<b>ADX 1h: ${adx1h} │ ADX 15m: ${adx15m}</b>
<b>Possível Topo  — Correção!</b>
                `.trim();

                console.log(alert);
                await sendToTelegram(alert);
            }
            else {
                process.stdout.write(`.`);
            }

            await sleep(240000);

        } catch (e) {
            process.stdout.write(`x`);
            await sleep(10000);
        }
    }
})();
