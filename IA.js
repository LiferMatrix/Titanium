// titanium-sentinel.js → COM ADX 1h + 15m NOS ALERTAS (versão corrigida com ADX suave, EMA correta, filtro ADX, anti-spam, alavancagem reduzida, probabilidade de sucesso, reconexão automática e limpeza de console a cada 2 dias)
const fetch = require('node-fetch');
if (!globalThis.fetch) globalThis.fetch = fetch;

const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVF';
const TELEGRAM_CHANNEL_ID = '-100199';

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

// === FUNÇÃO ADX CORRIGIDA (com suavização Wilder) ===
function calculateADX(candles, period = 14) {
    if (candles.length < period * 2) return 0;

    let plusDM = [], minusDM = [], tr = [];

    for (let i = 1; i < candles.length; i++) {
        const up = candles[i].h - candles[i - 1].h;
        const down = candles[i - 1].l - candles[i].l;
        plusDM.push(up > down && up > 0 ? up : 0);
        minusDM.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(
            candles[i].h - candles[i].l,
            Math.abs(candles[i].h - candles[i - 1].c),
            Math.abs(candles[i].l - candles[i - 1].c)
        ));
    }

    // Suavização Wilder para +DM, -DM, TR
    let smoothPlus = new Array(plusDM.length).fill(0);
    let smoothMinus = new Array(minusDM.length).fill(0);
    let smoothTR = new Array(tr.length).fill(0);

    smoothPlus[period - 1] = plusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
    smoothMinus[period - 1] = minusDM.slice(0, period).reduce((a, b) => a + b, 0) / period;
    smoothTR[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < plusDM.length; i++) {
        smoothPlus[i] = (smoothPlus[i - 1] * (period - 1) + plusDM[i]) / period;
        smoothMinus[i] = (smoothMinus[i - 1] * (period - 1) + minusDM[i]) / period;
        smoothTR[i] = (smoothTR[i - 1] * (period - 1) + tr[i]) / period;
    }

    // +DI e -DI
    let plusDI = [];
    let minusDI = [];
    for (let i = period - 1; i < smoothPlus.length; i++) {
        plusDI.push(100 * smoothPlus[i] / smoothTR[i]);
        minusDI.push(100 * smoothMinus[i] / smoothTR[i]);
    }

    // DX
    let dx = [];
    for (let i = 0; i < plusDI.length; i++) {
        const diSum = plusDI[i] + minusDI[i];
        dx.push(diSum > 0 ? Math.abs(plusDI[i] - minusDI[i]) / diSum * 100 : 0);
    }

    // ADX (suavização Wilder do DX)
    let adx = new Array(dx.length).fill(0);
    adx[period - 1] = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dx.length; i++) {
        adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
    }

    return adx[adx.length - 1].toFixed(1);
}

// === FUNÇÃO EMA CORRIGIDA ===
function calculateEMA(closes, period) {
    if (closes.length < period) return 0;
    let ema = new Array(closes.length).fill(0);
    ema[period - 1] = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const alpha = 2 / (period + 1);
    for (let i = period; i < closes.length; i++) {
        ema[i] = closes[i] * alpha + ema[i - 1] * (1 - alpha);
    }
    return ema[ema.length - 1];
}

// === RESTANTE DAS FUNÇÕES (mantidas com ajustes) ===
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

// === NOVA: FUNÇÃO PARA CALCULAR PROBABILIDADE (0-100%) ===
function calculateProb(cci, adx1h, volZ, lsr15, rsi1h, isBuy) {
    let prob = 50; // Base

    // Baseado em CCI (mais extremo = maior prob)
    if (isBuy) {
        if (cci <= -150) prob += 25;
        else if (cci <= -130) prob += 20;
        else if (cci <= -90) prob += 15;
    } else {
        if (cci >= 150) prob += 25;
        else if (cci >= 130) prob += 20;
        else if (cci >= 90) prob += 15;
    }

    // ADX: tendência forte aumenta prob
    if (adx1h > 35) prob += 20;
    else if (adx1h > 25) prob += 15;
    else if (adx1h > 20) prob += 10;

    // Volume: up = bom
    if (volZ > 20) prob += 15;
    else if (volZ > 0) prob += 10;

    // LSR: favorável ao lado
    if (isBuy) {
        if (lsr15 > 70) prob += 15;
        else if (lsr15 > 50) prob += 10;
    } else {
        if (lsr15 < 30) prob += 15;
        else if (lsr15 < 50) prob += 10;
    }

    // RSI: oversold/overbought
    if (isBuy) {
        if (rsi1h < 20) prob += 15;
        else if (rsi1h < 30) prob += 10;
    } else {
        if (rsi1h > 80) prob += 15;
        else if (rsi1h > 70) prob += 10;
    }

    return Math.min(100, Math.max(0, Math.floor(prob)));
}

// === NOVA: FUNÇÃO PARA RECONEXÃO AUTOMÁTICA ===
async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fetch(url, options);
        } catch (e) {
            if (i === retries - 1) throw e;
            const delay = backoff * Math.pow(2, i); // Exponential backoff
            console.log(`Reconectando após erro de rede: tentativa ${i + 1}/${retries} - aguardando ${delay/1000}s`);
            await sleep(delay);
        }
    }
}

// === ATUALIZAÇÃO EM getData PARA USAR fetchWithRetry ===
async function getData() {
    const [priceRes, h1Res, m15Res] = await Promise.all([
        fetchWithRetry('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
        fetchWithRetry('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100'),
        fetchWithRetry('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100')
    ]);

    const price = parseFloat((await priceRes.json()).price);
    const h1 = (await h1Res.json()).map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
    const m15 = (await m15Res.json()).map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4] }));

    return { price, h1, m15 };
}

(async () => {
    console.clear();

    const bootMsg = `
<b>🤖 IA TITANIUM SENTINEL ATIVADA </b>

Data/Hora: <b>${new Date().toLocaleString('pt-BR')}</b>
Status: <b>Online • Modo Caça Extrema</b>
Aguardando setup BTC…
    `.trim();

    console.log(bootMsg.replace(/<[^>]*>/g, ''));
    await sendToTelegram(bootMsg);

    let lastAlert = { type: null, time: 0 }; // Anti-spam: min 1h entre alertas do mesmo lado
    let lastClean = Date.now(); // Para limpeza automática a cada 2 dias
    const cleanInterval = 2 * 24 * 60 * 60 * 1000; // 2 dias em ms

    while (true) {
        try {
            const now = Date.now();

            // Limpeza automática de console a cada 2 dias (não há arquivos, então só limpa console)
            if (now - lastClean > cleanInterval) {
                console.clear();
                console.log('Limpeza automática executada: console limpo.');
                lastClean = now;
            }

            const { price, h1, m15 } = await getData();

            const closesH1 = h1.map(c => c.c);
            const cci = parseFloat(calculateCCI(h1));
            const rsi1h = parseFloat(calculateRSI(closesH1));
            const ema8 = calculateEMA(closesH1, 8);
            const ema21 = calculateEMA(closesH1, 21);
            const bullish = ema8 > ema21;

            const atr = calculateATR(h1);
            const stopDistance = atr * 1.5;

            const longs15 = m15.slice(-20).filter(c => c.c > c.o).length;
            const shorts15 = m15.slice(-20).filter(c => c.c < c.o).length;
            const lsr15 = (longs15 / (longs15 + shorts15) * 100).toFixed(1);

            const vol5 = h1.slice(-5).reduce((s,c)=>s+c.v,0)/5;
            const vol20 = h1.slice(-20).reduce((s,c)=>s+c.v,0)/20;
            const volZ = ((vol5 / vol20 - 1) * 100).toFixed(1);

            const adx1h = parseFloat(calculateADX(h1));
            const adx1hPrev = parseFloat(calculateADX(h1.slice(0, -1))); // ADX anterior para checar se está caindo
            const adx15m = parseFloat(calculateADX(m15));

            const minTimeBetweenAlerts = 3600000; // 1h

            if (bullish && cci <= -90 && adx1h > 20 && (now - lastAlert.time > minTimeBetweenAlerts || lastAlert.type !== 'buy')) {
                const prob = calculateProb(cci, adx1h, volZ, lsr15, rsi1h, true);
                const alert = `
#🤖 IA TITANIUM SENTINEL

<b>🟢BTC COMPRA</b>
Preço: <b>$${price.toFixed(0)}</b>
Alavancagem: <b>${cci<=-130?'10x–20x':'5x–10x'}</b>
Stop: <b>$${(price - stopDistance).toFixed(0)}</b>
TP1: $${(price + atr*2).toFixed(0)} │ TP2: $${(price + atr*4).toFixed(0)} │ TP3: $${(price + atr*7).toFixed(0)}
RSI 1h: ${rsi1h}% • LSR: ${lsr15}% • Vol ${volZ>0?'up':'down'}${volZ}%
<b>ADX 1h: ${adx1h} │ ADX 15m: ${adx15m}</b>
<b>Probabilidade de Sucesso: ${prob}%</b>
<b>Reversão Forte — COMPRA!</b>
                `.trim();

                console.log(alert);
                await sendToTelegram(alert);
                lastAlert = { type: 'buy', time: now };
            }
            else if (!bullish && cci >= 90 && adx1h > 20 && (now - lastAlert.time > minTimeBetweenAlerts || lastAlert.type !== 'sell')) {
                const prob = calculateProb(cci, adx1h, volZ, lsr15, rsi1h, false);
                const alert = `
#🤖 IA TITANIUM SENTINEL

<b>🔴BTC CORREÇÃO</b>
Preço: <b>$${price.toFixed(0)}</b>
Alavancagem: <b>${cci>=130?'10x–20x':'5x–10x'}</b>
Stop: <b>$${(price + stopDistance).toFixed(0)}</b>
TP1: $${(price - atr*2).toFixed(0)} │ TP2: $${(price - atr*4).toFixed(0)} │ TP3: $${(price - atr*7).toFixed(0)}
RSI 1h: ${rsi1h}% • LSR: ${lsr15}% • Vol ${volZ>0?'up':'down'}${volZ}%
<b>ADX 1h: ${adx1h} │ ADX 15m: ${adx15m}</b>
<b>Probabilidade de Sucesso: ${prob}%</b>
<b>Possível Topo  — Correção!</b>
                `.trim();

                console.log(alert);
                await sendToTelegram(alert);
                lastAlert = { type: 'sell', time: now };
            }
            else {
                process.stdout.write(`.`);
            }

            await sleep(240000); // Mantido 4 min, mas otimizar se quiser (ex: rodar só no final das velas)

        } catch (e) {
            console.log(`Erro geral: ${e.message}. Tentando reconectar...`);
            await sleep(10000); // Delay base no catch geral
        }
    }
})();
