p = 2; // Stop-loss em 2x ATR
  const atrMultiplierTarget = 3; // Take-profit em 3x ATR (Alvo 2)
  const stop = isBuy ? entry - atrMultiplierStop * coin.atr : entry + atrMultiplierStop * coin.atr;
  const target = isBuy ? entry + atrMultiplierTarget * coin.atr : entry - atrMultiplierTarget * coin.atr;
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return reward / risk > 0 ? (reward / risk).toFixed(2) : 'N/A';
}

// ================= ALERTAS ================= //
async function sendMonitorAlert(coins) {
  const topLow = coins
    .filter(c => c.lsr !== null && c.rsi !== null)
    .sort((a, b) => (a.lsr + a.rsi) - (b.lsr + b.rsi))
    .slice(0, 20);
  const topHigh = coins
    .filter(c => c.lsr !== null && c.rsi !== null)
    .sort((a, b) => (b.lsr + b.rsi) - (a.lsr + b.rsi))
    .slice(0, 20);

  // Identificar moedas com Volume Delta mais positivo/negativo
  const topPositiveDelta = topLow
    .filter(c => c.delta.isBuyPressure)
    .sort((a, b) => b.delta.deltaPercent - a.delta.deltaPercent)
    .slice(0, 10)
    .map(c => c.symbol);
  const topNegativeDelta = topHigh
    .filter(c => !c.delta.isBuyPressure)
    .sort((a, b) => a.delta.deltaPercent - b.delta.deltaPercent)
    .slice(0, 10)
    .map(c => c.symbol);

  const format = (v, precision = 2) => isNaN(v) || v === null ? 'N/A' : v.toFixed(precision);
  const formatPrice = (price) => price < 1 ? price.toFixed(8) : price < 10 ? price.toFixed(6) : price < 100 ? price.toFixed(4) : price.toFixed(2);

  // Filtrar moedas com estrela (⭐)
  const starCoins = topLow.filter(coin => 
    topPositiveDelta.includes(coin.symbol) && 
    coin.delta.isBuyPressure && 
    coin.oi5m.isRising && 
    coin.oi15m.isRising && 
    coin.funding.current < 0 &&
    coin.lsr <= 2.7 &&
    coin.volume >= config.MIN_VOLUME_USDT &&
    coin.oi15m.value >= config.MIN_OPEN_INTEREST
  );

  // Filtrar moedas com caveira (💀)
  const skullCoins = topHigh.filter(coin => 
    topNegativeDelta.includes(coin.symbol) && 
    !coin.delta.isBuyPressure && 
    !coin.oi5m.isRising && 
    !coin.oi15m.isRising && 
    coin.funding.current > 0 &&
    coin.lsr >= 2.8 &&
    coin.volume >= config.MIN_VOLUME_USDT &&
    coin.oi15m.value >= config.MIN_OPEN_INTEREST
  );

  // Alerta para moedas com estrela
  if (starCoins.length > 0) {
    let starAlertText = `🟢*Possível Compra *\n\n`;
    starAlertText += await Promise.all(starCoins.map(async (coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const deltaText = coin.delta.isBuyPressure ? `💹${format(coin.delta.deltaPercent)}%` : `⭕${format(coin.delta.deltaPercent)}%`;
      let lsrSymbol = '';
      if (coin.lsr !== null) {
        if (coin.lsr <= 1.8) lsrSymbol = '✅Baixo';
        else if (coin.lsr >= 2.8) lsrSymbol = '📛Alto';
      }
      let fundingRateEmoji = '';
      if (coin.funding.current !== null) {
        if (coin.funding.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (coin.funding.current <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (coin.funding.current <= -0.0005) fundingRateEmoji = '🟢';
        else if (coin.funding.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (coin.funding.current >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (coin.funding.current >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
      }
      const oi5mText = coin.oi5m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const oi15mText = coin.oi15m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const atr = coin.atr !== null ? coin.atr : 'N/A';
      const target1 = atr !== 'N/A' ? formatPrice(coin.price + 1.5 * atr) : 'N/A';
      const target2 = atr !== 'N/A' ? formatPrice(coin.price + 3 * atr) : 'N/A';
      const target3 = atr !== 'N/A' ? formatPrice(coin.price + 5 * atr) : 'N/A';
      const target4 = atr !== 'N/A' ? formatPrice(coin.price + 7 * atr) : 'N/A';
      const stopLoss = atr !== 'N/A' ? formatPrice(coin.price - 2 * atr) : 'N/A';
      const riskReward = calculateRiskReward(coin, true);
      const isVolumeSpike = await detectVolumeSpike(coin.symbol);
      const isFundingAnomaly = await detectFundingRateChange(coin.symbol, coin.funding.current);
      const anomalyText = isVolumeSpike || isFundingAnomaly ? `🚨 Anomalia: ${isVolumeSpike ? 'Pico de Volume' : ''}${isVolumeSpike && isFundingAnomaly ? ' | ' : ''}${isFundingAnomaly ? 'Mudança no Funding Rate' : ''}\n` : '';
      return `${i + 1}. 🔹 *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n` +
             `     LSR: ${format(coin.lsr)} ${lsrSymbol}\n` +
             `     RSI (15m): ${format(coin.rsi)}\n` +
             `     RSI (1h): ${format(coin.rsi1h)}\n` +
             `     Vol.Delta: ${deltaText}\n` +
             `     Fund.Rate: ${fundingRateEmoji}${format(coin.funding.current, 5)}%\n` +
             `     OI 5m: ${oi5mText}\n` +
             `     OI 15m: ${oi15mText}\n` +
             `     Alvo 1: ${target1}\n` +
             `     Alvo 2: ${target2} (R:R = ${riskReward})\n` +
             `     Alvo 3: ${target3}\n` +
             `     Alvo 4: ${target4}\n` +
             `   ⛔Stop: ${stopLoss}\n` +
             anomalyText;
    })).then(results => results.join('\n'));
    starAlertText += `\n☑︎ 🤖 Monitor Titanium Optmus Prime`;

    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, starAlertText, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }));
    logger.info('Alerta de moedas com estrela enviado com sucesso');
  }

  // Alerta para moedas com caveira
  if (skullCoins.length > 0) {
    let skullAlertText = `🔴*Possível Correção *\n\n`;
    skullAlertText += await Promise.all(skullCoins.map(async (coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const deltaText = coin.delta.isBuyPressure ? `💹${format(coin.delta.deltaPercent)}%` : `⭕${format(coin.delta.deltaPercent)}%`;
      let lsrSymbol = '';
      if (coin.lsr !== null) {
        if (coin.lsr <= 1.8) lsrSymbol = '✅Baixo';
        else if (coin.lsr >= 2.8) lsrSymbol = '📛Alto';
      }
      let fundingRateEmoji = '';
      if (coin.funding.current !== null) {
        if (coin.funding.current <= -0.002) fundingRateEmoji = '🟢🟢🟢';
        else if (coin.funding.current <= -0.001) fundingRateEmoji = '🟢🟢';
        else if (coin.funding.current <= -0.0005) fundingRateEmoji = '🟢';
        else if (coin.funding.current >= 0.001) fundingRateEmoji = '🔴🔴🔴';
        else if (coin.funding.current >= 0.0003) fundingRateEmoji = '🔴🔴';
        else if (coin.funding.current >= 0.0002) fundingRateEmoji = '🔴';
        else fundingRateEmoji = '🟢';
      }
      const oi5mText = coin.oi5m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const oi15mText = coin.oi15m.isRising ? '⬆️ Subindo' : '⬇️ Descendo';
      const atr = coin.atr !== null ? coin.atr : 'N/A';
      const target1 = atr !== 'N/A' ? formatPrice(coin.price - 1.5 * atr) : 'N/A';
      const target2 = atr !== 'N/A' ? formatPrice(coin.price - 3 * atr) : 'N/A';
      const target3 = atr !== 'N/A' ? formatPrice(coin.price - 5 * atr) : 'N/A';
      const target4 = atr !== 'N/A' ? formatPrice(coin.price - 7 * atr) : 'N/A';
      const stopLoss = atr !== 'N/A' ? formatPrice(coin.price + 2 * atr) : 'N/A';
      const riskReward = calculateRiskReward(coin, false);
      const isVolumeSpike = await detectVolumeSpike(coin.symbol);
      const isFundingAnomaly = await detectFundingRateChange(coin.symbol, coin.funding.current);
      const anomalyText = isVolumeSpike || isFundingAnomaly ? `🚨 Anomalia: ${isVolumeSpike ? 'Pico de Volume' : ''}${isVolumeSpike && isFundingAnomaly ? ' | ' : ''}${isFundingAnomaly ? 'Mudança no Funding Rate' : ''}\n` : '';
      return `${i + 1}. 🔻 *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n` +
             `     LSR: ${format(coin.lsr)} ${lsrSymbol}\n` +
             `     RSI (15m): ${format(coin.rsi)}\n` +
             `     RSI (1h): ${format(coin.rsi1h)}\n` +
             `     Vol.Delta: ${deltaText}\n` +
             `     Fund.Rate: ${fundingRateEmoji}${format(coin.funding.current, 5)}%\n` +
             `     OI 5m: ${oi5mText}\n` +
             `     OI 15m: ${oi15mText}\n` +
             `     Alvo 1: ${target1}\n` +
             `     Alvo 2: ${target2} (R:R = ${riskReward})\n` +
             `     Alvo 3: ${target3}\n` +
             `     Alvo 4: ${target4}\n` +
             `   ⛔Stop: ${stopLoss}\n` +
             anomalyText;
    })).then(results => results.join('\n'));
    skullAlertText += `\n☑︎ 🤖 Gerencie seu risco @J4Rviz`;

    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, skullAlertText, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }));
    logger.info('Alerta de moedas com caveira enviado com sucesso');
  }

  // Alerta de anomalias
  const anomalyCoins = coins.filter(coin => coin.anomalyDetected);
  if (anomalyCoins.length > 0) {
    let anomalyAlertText = `🚨 *Alerta* 🚨\n\n`;
    anomalyAlertText += anomalyCoins.map((coin, i) => {
      const tradingViewLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${coin.symbol.replace('/', '')}&interval=15`;
      const anomalyText = coin.volumeSpike || coin.fundingAnomaly ? `🚨Volume: ${coin.volumeSpike ? 'Pico de Volume' : ''}${coin.volumeSpike && coin.fundingAnomaly ? ' | ' : ''}${coin.fundingAnomaly ? 'Mudança no Funding Rate' : ''}` : '';
      return `${i + 1}. *${coin.symbol}* [- TradingView](${tradingViewLink})\n` +
             `   ${anomalyText}\n` +
             `   💲 Preço: ${formatPrice(coin.price)}\n`;
    }).join('\n');
    anomalyAlertText += `\n☑︎ 🤖 Monitor Titanium Optmus Prime`;

    await withRetry(() => bot.api.sendMessage(config.TELEGRAM_CHAT_ID, anomalyAlertText, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }));
    logger.info('Alerta de anomalias enviado com sucesso');
  }

  if (starCoins.length === 0 && skullCoins.length === 0 && anomalyCoins.length === 0) {
    logger.info('Nenhuma moeda válida para alertas (estrela, caveira ou anomalia), nenhum alerta enviado.');
  } else {
    logger.info('Alertas de monitoramento processados com sucesso');
  }
}

// ================= LÓGICA PRINCIPAL ================= //
async function checkCoins() {
  try {
    const markets = await withRetry(() => exchangeFutures.loadMarkets());
    const usdtPairs = Object.keys(markets)
      .filter(symbol => symbol.endsWith('/USDT') && markets[symbol].active)
      .slice(0, 100); // Limita a 100 pares para evitar sobrecarga

    const coinsData = await limitConcurrency(usdtPairs, async (symbol) => {
      try {
        // Obter preço atual e volume
        const ticker = await withRetry(() => exchangeFutures.fetchTicker(symbol));
        const price = ticker?.last || null;
        const volume = ticker?.baseVolume * price || 0; // Volume em USDT
        if (!price) {
          logger.warn(`Preço inválido para ${symbol}, pulando...`);
          return null;
        }

        // Obter OHLCV para RSI (15m) e ATR
        const ohlcv15mRaw = getCachedData(`ohlcv_${symbol}_15m`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '15m', undefined, Math.max(config.RSI_PERIOD, config.ATR_PERIOD) + 1));
        setCachedData(`ohlcv_${symbol}_15m`, ohlcv15mRaw);
        const ohlcv15m = normalizeOHLCV(ohlcv15mRaw);
        if (!ohlcv15m.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (15m), pulando...`);
          return null;
        }

        // Obter OHLCV para RSI (1h)
        const ohlcv1hRaw = getCachedData(`ohlcv_${symbol}_1h`) ||
          await withRetry(() => exchangeFutures.fetchOHLCV(symbol, '1h', undefined, config.RSI_PERIOD + 1));
        setCachedData(`ohlcv_${symbol}_1h`, ohlcv1hRaw);
        const ohlcv1h = normalizeOHLCV(ohlcv1hRaw);
        if (!ohlcv1h.length) {
          logger.warn(`Dados OHLCV insuficientes para ${symbol} (1h), pulando...`);
          return null;
        }
