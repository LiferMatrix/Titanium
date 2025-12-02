// ==================== TITANIUM SENTINEL HÍBRIDA v12.3 – VERSÃO 3M (MENSAGEM FIXA) ====================
const fetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = fetch;

const TOKEN   = '8010060485:AAESqJ';
const CHANNEL = '-100255';

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

async function klines(symbol, interval, limit = 400) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await retry(url);
    const data = await res.json();
    return data.map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
}

async function price(symbol) {
    const res = await retry(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat((await res.json()).price);
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
        const h = candles[i].h, l = candles[i].l;
        const ph = candles[i-1].h, pl = candles[i-1].l, pc = candles[i-1].c;
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

async function wait3m() {
    const next = Math.ceil(Date.now() / (3 * 60 * 1000)) * (3 * 60 * 1000);
    await sleep(next - Date.now() + 3000);
}

(async () => {
    console.clear();
    console.log("Enviando mensagem de inicialização...");

    // ← MENSAGEM GARANTIDA ANTES DE TUDO
    await tg("<b>TITANIUM SENTINEL HÍBRIDA v12.3 – VERSÃO 3M</b>\n\n27 ativos • Tudo no 3m • 5x mais rápido • 30-70x\n\nBot iniciado com sucesso!");

    console.log("TITANIUM HÍBRIDA v12.3 3M rodando perfeitamente...");

    const hotList  = {};
    const antiSpam = {};

    await wait3m();   // espera o primeiro candle fechar

    while (true) {
        try {
            for (const sym of ATIVOS) {
                try {
                    const [p, m3, h1] = await Promise.all([price(sym), klines(sym,"3m",400), klines(sym,"1h",100)]);
                    if (m3.length < 150 || h1.length < 50) continue;

                    const closes3 = m3.map(c => c.c);
                    const ema8  = ema(closes3,8);
                    const ema21 = ema(closes3,21);
                    const ema55 = ema(closes3,55);
                    const cci3  = cci(m3);
                    const adx3  = adx(m3);
                    const adx1h = adx(h1);

                    const bullish = ema8 > ema21;
                    const bearish = ema8 < ema21;
                    const above55 = p > ema55;
                    const below55 = p < ema55;
                    const now = Date.now();

                    if (bullish && cci3 <= -100 && adx3 >= 28 && adx1h >= 25 && above55) {
                        hotList[sym] = { type:"buy", price:p, ema55, ts:now };
                    } else if (bearish && cci3 >= 100 && adx3 >= 28 && adx1h >= 25 && below55) {
                        hotList[sym] = { type:"sell", price:p, ema55, ts:now };
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
                        const dir = e.type==="buy" ? "COMPRA AGORA" : "VENDA AGORA";

                        const msg = `
#TITANIUM HÍBRIDA 3M
<b>${sym.replace("USDT","")} ${dir}</b>
Preço: <b>$${p3.toFixed(p3<10?6:2)}</b>
<b>Alavancagem: ${lev}</b>
CCI 3m ${e.type==="buy"?"≤-100":"≥+100"} → CCI 3m ${cci3}
Entrada confirmada no fundo/topo!
                        `.trim();

                        console.log("\n" + msg.replace(/<[^>]*>/g,''));
                        await tg(msg);
                        antiSpam[sym] = Date.now();
                        delete hotList[sym];
                    }
                } catch(e) {}
            }

            process.stdout.write("Active");
            await wait3m();

        } catch (e) {
            console.log("Erro geral:", e.message);
            await sleep(10000);
        }
    }
})();
