// ==================== TITANIUM SENTINEL HÍBRIDA v12.4 (com ATR + 3 TPs) ====================
const fetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = fetch;

const TOKEN   = '8010060485:AAESqJMqL0J5OE6G1dTJVfP7dGqPQCqPv6A';
const CHANNEL = '-1002554953979';

const ATIVOS = [
    "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","SANDUSDT","MANAUSDT","VETUSDT","LTCUSDT","XRPUSDT","LINKUSDT","ADAUSDT","DOTUSDT","AVAXUSDT",
    "NEARUSDT","ATOMUSDT","FILUSDT","UNIUSDT","APEUSDT","SUSHIUSDT","FETUSDT","OPUSDT","SOLUSDT","API3USDT","SEIUSDT",
    "AXSUSDT","BCHUSDT","CHZUSDT","1INCHUSDT","C98USDT","DYDXUSDT","GALAUSDT","BANDUSDT","LDOUSDT","ZKUSDT","GRTUSDT","TIAUSDT",
    "SKLUSDT","VANRYUSDT","WLDUSDT","1000BONKUSDT","1000SHIBUSDT","WLDUSDT","SUIUSDT","ENAUSDT","TURBOUSDT","IOTAUSDT","1000PEPEUSDT"
];

async function tg(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: CHANNEL, text, parse_mode: 'HTML', disable_web_page_preview: true })
        });
    } catch (e) { console.log("Erro Telegram:", e.message); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function retry(url, retries = 6) {
    for (let i = 0; i < retries; i++) {
        try { return await fetch(url); }
        catch (e) { if (i === retries - 1) throw e; await sleep(1000 * 2 ** i); }
    }
}

async function klines(symbol, interval, limit = 350) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await retry(url);
    const data = await res.json();
    return data.map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
}

async function price(symbol) {
    const res = await retry(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat((await res.json()).price);
}

// === ATR (14 períodos) no 15m ===
function atr14(candles) {
    if (candles.length < 15) return 0;
    let tr = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].h, l = candles[i].l, pc = candles[i-1].c;
        tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return tr.slice(-14).reduce((a, b) => a + b, 0) / 14;
}

function ema(closes, period) {
    if (closes.length < period + 10) return 0;
    let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const k = 2 / (period + 1);
    for (let i = period; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
}

function adx(candles, period = 14) {
    if (candles.length < period * 2) return 0;
    let up = [], dn = [], tr = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].h, l = candles[i].l, ph = candles[i-1].h, pl = candles[i-1].l, pc = candles[i-1].c;
        up.push(h - ph > pl - l ? Math.max(h - ph, 0) : 0);
        dn.push(pl - l > h - ph ? Math.max(pl - l, 0) : 0);
        tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let sUp = up.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let sDn = dn.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let sTr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < up.length; i++) {
        sUp = (sUp * (period - 1) + up[i]) / period;
        sDn = (sDn * (period - 1) + dn[i]) / period;
        sTr = (sTr * (period - 1) + tr[i]) / period;
    }
    const pdi = 100 * sUp / sTr, mdi = 100 * sDn / sTr;
    const dx = Math.abs(pdi - mdi) / (pdi + mdi) * 100;
    let final = dx;
    for (let i = 1; i < period; i++) final = (final * (period - 1) + dx) / period;
    return +final.toFixed(1);
}

function cci(candles, period = 20) {
    if (candles.length < period) return 0;
    const tp = candles.slice(-period).map(c => (c.h + c.l + c.c) / 3);
    const sma = tp.reduce((a, b) => a + b, 0) / period;
    const md  = tp.reduce((a, v) => a + Math.abs(v - sma), 0) / period;
    return +((tp[tp.length - 1] - sma) / (0.015 * md)).toFixed(1);
}

async function wait15m() {
    const next = Math.ceil(Date.now() / (15 * 60 * 1000)) * (15 * 60 * 1000);
    await sleep(next - Date.now() + 4000);
}

(async () => {
    console.clear();
    await tg("<b>TITANIUM SENTINEL</b>\n46 ativos ");
    console.log("TITANIUM  ...");

    const hotList  = {};
    const antiSpam = {};

    await wait15m();

    while (true) {
        try {
            for (const sym of ATIVOS) {
                try {
                    const [p, m15, h1] = await Promise.all([price(sym), klines(sym,"15m",300), klines(sym,"1h",100)]);
                    if (m15.length < 100 || h1.length < 50) continue;

                    const closes15 = m15.map(c => c.c);
                    const ema8  = ema(closes15,8);
                    const ema21 = ema(closes15,21);
                    const ema55 = ema(closes15,55);
                    const cci15 = cci(m15);
                    const adx15 = adx(m15);
                    const adx1h = adx(h1);
                    const atr    = atr14(m15); // ATR 14 no 15m

                    const bullish = ema8 > ema21;
                    const bearish = ema8 < ema21;
                    const above55 = p > ema55;
                    const below55 = p < ema55;
                    const now = Date.now();

                    if (bullish && cci15 <= -100 && adx15 >= 28 && adx1h >= 25 && above55 && atr > 0) {
                        hotList[sym] = { type:"buy", price:p, ema55, atr, ts:now };
                    } else if (bearish && cci15 >= 100 && adx15 >= 28 && adx1h >= 25 && below55 && atr > 0) {
                        hotList[sym] = { type:"sell", price:p, ema55, atr, ts:now };
                    }
                } catch(e) {}
            }

            for (const sym in hotList) {
                const e = hotList[sym];
                if (Date.now() - e.ts > 9*60*1000) { delete hotList[sym]; continue; }
                if (antiSpam[sym] && Date.now() - antiSpam[sym] < 45*60*1000) continue;

                try {
                    const [p3, m3] = await Promise.all([price(sym), klines(sym,"3m",50)]);
                    const cci3 = cci(m3);

                    const okBuy  = e.type==="buy"  && cci3 <= -80 && p3 > e.ema55;
                    const okSell = e.type==="sell" && cci3 >=  80 && p3 < e.ema55;

                    if (okBuy || okSell) {
                        const lev = (e.type==="buy" ? cci3<=-120 : cci3>=120) ? "50x-70x" : "30x-50x";
                        const dir = e.type==="buy" ? "COMPRA " : "CORREÇÃO";

                        //const stop = e.type==="buy" ? p3 - e.atr * 1.9 : p3 + e.atr * 1.9;   // ← 1.9R (stop mais apertado)
                        //const tp1  = e.type==="buy" ? p3 + e.atr * 4.5 : p3 - e.atr * 4.5;   // ← 4.5R
                        //const tp2  = e.type==="buy" ? p3 + e.atr * 9.0 : p3 - e.atr * 9.0;   // ← 9R
                        //const tp3  = e.type==="buy" ? p3 + e.atr * 20.0 : p3 - e.atr * 20.0; // ← 20R (insano)

                        const stop = e.type==="buy" ? p3 - e.atr * 2.2 : p3 + e.atr * 2.2;   
                        const tp1  = e.type==="buy" ? p3 + e.atr * 3.5 : p3 - e.atr * 3.5;   
                        const tp2  = e.type==="buy" ? p3 + e.atr * 7.0 : p3 - e.atr * 7.0;   
                        const tp3  = e.type==="buy" ? p3 + e.atr * 14.0 : p3 - e.atr * 14.0; 
                        const msg = `
#TITANIUM HÍBRID0
<b>${sym.replace("USDT","")} ${dir}</b>
Preço: <b>$${p3.toFixed(p3<10?6:2)}</b>
<b>Alavancagem: ${lev}</b>

<b>Stop Loss:</b> $${stop.toFixed(p3<10?6:2)}
<b>TP1 (+2R):</b> $${tp1.toFixed(p3<10?6:2)}
<b>TP2 (+4R):</b> $${tp2.toFixed(p3<10?6:2)}
<b>TP3 (+8R):</b> $${tp3.toFixed(p3<10?6:2)}

CCI 15m ${e.type==="buy"?"≤-100":"≥+100"} → CCI 3m ${cci3}
Entrada confirmada!
                        `.trim();

                        console.log("\n" + msg.replace(/<[^>]*>/g,''));
                        await tg(msg);
                        antiSpam[sym] = Date.now();
                        delete hotList[sym];
                    }
                } catch(e) {}
            }

            process.stdout.write("✓");
            await wait15m();

        } catch (e) {
            console.log("Erro geral:", e.message);
            await sleep(10000);
        }
    }
})();
