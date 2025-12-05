const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7633398974:AAHaVFs_';
const TELEGRAM_CHAT_ID   = '-100199';
// Configurações do estudo (iguais ao TV)
const FRACTAL_BARS = 3;
const N = 2;

// 🔵 AJUSTADO PARA O 1H
const TIMEFRAME = '1h';
const SYMBOL = 'BTCUSDT';

// Configurações de Logs
const LOG_DIR = './logs';
const MAX_LOG_FILES = 10; // Mantém apenas os últimos 10 arquivos de log
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB por arquivo de log

// Configurações de Reconexão
const INITIAL_RETRY_DELAY = 5000; // 5 segundos
const MAX_RETRY_DELAY = 60000; // 1 minuto
const MAX_RETRY_ATTEMPTS = 10;

// Função para obter data e hora de Brasília
function getBrazilianDateTime() {
  const now = new Date();
  // Converter para horário de Brasília (GMT-3)
  const brasiliaTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
  
  const day = String(brasiliaTime.getDate()).padStart(2, '0');
  const month = String(brasiliaTime.getMonth() + 1).padStart(2, '0');
  const year = brasiliaTime.getFullYear();
  const hours = String(brasiliaTime.getHours()).padStart(2, '0');
  const minutes = String(brasiliaTime.getMinutes()).padStart(2, '0');
  const seconds = String(brasiliaTime.getSeconds()).padStart(2, '0');
  
  return {
    date: `${day}/${month}/${year}`,
    time: `${hours}:${minutes}:${seconds}`,
    full: `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`
  };
}

// Função para inicializar sistema de logs
function initLogSystem() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  cleanupOldLogs();
}

// Função para limpar logs antigos
function cleanupOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(file => file.startsWith('bot_') && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(LOG_DIR, file),
        time: fs.statSync(path.join(LOG_DIR, file)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    // Manter apenas os últimos MAX_LOG_FILES
    if (files.length > MAX_LOG_FILES) {
      files.slice(MAX_LOG_FILES).forEach(file => {
        try {
          fs.unlinkSync(file.path);
          logToFile(`🗑️ Log antigo removido: ${file.name}`);
        } catch (e) {
          console.error(`Erro ao remover log: ${e.message}`);
        }
      });
    }
  } catch (e) {
    console.error(`Erro na limpeza de logs: ${e.message}`);
  }
}

// Função para logar em arquivo
function logToFile(message) {
  try {
    const timestamp = new Date().toISOString();
    const logDate = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `bot_${logDate}.log`);
    
    // Verificar tamanho do arquivo
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_LOG_SIZE) {
        // Rotacionar log
        const rotatedFile = path.join(LOG_DIR, `bot_${logDate}_${Date.now()}.log`);
        fs.renameSync(logFile, rotatedFile);
      }
    }
    
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
  } catch (e) {
    console.error(`Erro ao escrever log: ${e.message}`);
  }
}

// Função para verificar conexão com internet
async function checkInternetConnection() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    await fetch('https://api.binance.com/api/v3/ping', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return true;
  } catch (error) {
    return false;
  }
}

// Função para reconexão com backoff exponencial
async function reconnectWithBackoff(attempt = 1) {
  const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
  
  logToFile(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
  console.log(`🔌 Tentativa ${attempt} de reconexão em ${delay/1000} segundos...`);
  
  await new Promise(resolve => setTimeout(resolve, delay));
  
  const isConnected = await checkInternetConnection();
  if (isConnected) {
    logToFile('✅ Conexão restaurada!');
    console.log('✅ Conexão restaurada!');
    return true;
  }
  
  if (attempt >= MAX_RETRY_ATTEMPTS) {
    logToFile('❌ Máximo de tentativas de reconexão atingido');
    console.log('❌ Máximo de tentativas de reconexão atingido');
    return false;
  }
  
  return await reconnectWithBackoff(attempt + 1);
}

// Função para formatar números
function formatNumber(num, decimals = 2) {
  if (num === "N/A" || num === undefined || num === null) return "N/A";
  return parseFloat(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// Função para buscar dados ADX
async function getADX(timeframe) {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${timeframe}&limit=50`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const data = await res.json();
    
    // Cálculo simplificado do ADX (para produção, use biblioteca técnica)
    const highs = data.map(c => +c[2]);
    const lows = data.map(c => +c[3]);
    const closes = data.map(c => +c[4]);
    
    // Cálculo básico de tendência
    const priceChange = ((closes[closes.length-1] - closes[0]) / closes[0]) * 100;
    const trendStrength = Math.min(Math.abs(priceChange) * 1.5, 100);
    
    return {
      value: trendStrength.toFixed(2),
      timeframe: timeframe
    };
  } catch (e) {
    logToFile(`⚠️ Erro ao buscar ADX(${timeframe}): ${e.message}`);
    return { value: "N/A", timeframe: timeframe };
  }
}

// Função para buscar Long/Short Ratio - CORRIGIDA
async function getLSR(period = '15m') {
  try {
    const url = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${SYMBOL}&period=${period}&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const data = await res.json();
    
    if (data && data.length > 0) {
      const latest = data[0]; // Pega o primeiro (mais recente)
      
      // Converter as strings para números
      const longAccount = parseFloat(latest.longAccount);
      const shortAccount = parseFloat(latest.shortAccount);
      
      // Calcular o LSR (Long/Short Ratio)
      const lsrRatio = longAccount / shortAccount;
      
      return {
        longAccount: longAccount.toFixed(4),
        shortAccount: shortAccount.toFixed(4),
        lsrRatio: lsrRatio.toFixed(4),
        period: period
      };
    }
    return { 
      longAccount: "N/A", 
      shortAccount: "N/A", 
      lsrRatio: "N/A", 
      period: period 
    };
  } catch (e) {
    logToFile(`⚠️ Erro ao buscar LSR(${period}): ${e.message}`);
    return { 
      longAccount: "N/A", 
      shortAccount: "N/A", 
      lsrRatio: "N/A", 
      period: period 
    };
  }
}

// Função para buscar livro de ordens
async function getOrderBook() {
  try {
    const url = `https://fapi.binance.com/fapi/v1/depth?symbol=${SYMBOL}&limit=10`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    const data = await res.json();
    
    // Pegar o melhor bid e ask
    const bestBid = data.bids[0] ? +data.bids[0][0] : 0;
    const bestAsk = data.asks[0] ? +data.asks[0][0] : 0;
    
    // Calcular volume total nos primeiros 5 níveis
    const bidVolume = data.bids.slice(0, 5).reduce((sum, bid) => sum + +bid[1], 0);
    const askVolume = data.asks.slice(0, 5).reduce((sum, ask) => sum + +ask[1], 0);
    
    return {
      bestBid: bestBid,
      bestAsk: bestAsk,
      bidVolume: bidVolume.toFixed(2),
      askVolume: askVolume.toFixed(2),
      spread: bestBid > 0 ? ((bestAsk - bestBid) / bestBid * 10000).toFixed(2) : "N/A"
    };
  } catch (e) {
    logToFile(`⚠️ Erro ao buscar Order Book: ${e.message}`);
    return {
      bestBid: "N/A",
      bestAsk: "N/A",
      bidVolume: "N/A",
      askVolume: "N/A",
      spread: "N/A"
    };
  }
}

async function sendAlert(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
  } catch (e) {
    logToFile(`❌ Erro ao enviar Telegram: ${e.message}`);
    console.log('❌ Erro ao enviar Telegram:', e.message);
  }
}

async function getCandles() {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=${TIMEFRAME}&limit=200`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  
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

async function mainBotLoop() {
  // 🔵 MENSAGEM DE INICIALIZAÇÃO
  const initMsg = '\n' +
    '==============================\n' +
    ' BOT DO SWEEP 1H INICIADO\n' +
    ' MONITORANDO BTCUSDT\n' +
    ' TIMEFRAME: 1H\n' +
    ' SISTEMA DE LOGS ATIVADO\n' +
    ' RECONEXÃO AUTOMÁTICA: ON\n' +
    ' AGUARDANDO SWEEP DE LIQUIDEZ...\n' +
    '==============================\n';
  
  console.log(initMsg);
  logToFile('🤖 Bot iniciado - Sistema de logs ativado');
  
  const brDateTime = getBrazilianDateTime();
  await sendAlert(`🤖 <b>BOT INICIADO</b>\n` +
                  `📍 <b>Horário Brasil (BRT):</b> ${brDateTime.full}\n` +
                  `Sistema de logs e reconexão automática ativados\n` +
                  `Monitorando BTC/USDT 1H...`);

  let lastBuyAlert = 0;
  let lastSellAlert = 0;
  const COOLDOWN = 30 * 60 * 1000; // 30 minutos
  let consecutiveErrors = 0;

  while (true) {
    try {
      // Verificar conexão periodicamente
      if (consecutiveErrors > 3) {
        logToFile('⚠️ Muitos erros consecutivos, verificando conexão...');
        const isConnected = await checkInternetConnection();
        if (!isConnected) {
          logToFile('🌐 Sem conexão com internet, tentando reconectar...');
          console.log('🌐 Sem conexão com internet, tentando reconectar...');
          const reconnected = await reconnectWithBackoff();
          if (!reconnected) {
            logToFile('❌ Falha na reconexão, reiniciando bot em 30 segundos...');
            await new Promise(r => setTimeout(r, 30000));
            continue;
          }
        }
        consecutiveErrors = 0;
      }

      const candles = await getCandles();
      if (candles.length < 100) {
        logToFile('⚠️ Dados de candles insuficientes');
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }

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
            
            // Buscar dados adicionais
            const [adx15m, adx1h, lsrData, orderBook] = await Promise.all([
              getADX('15m'),
              getADX('1h'),
              getLSR('15m'),
              getOrderBook()
            ]);
            
            const brDateTime = getBrazilianDateTime();
            const msg = `🛑 <b>LIQUIDEZ BEAR SWEEP DETECTADA</b>\n\n` +
                       `⏰<b>Data/Hora:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                       ` <b>Par:</b> ${SYMBOL}\n` +
                       ` <b>Preço Atual:</b> $${formatNumber(price)}\n` +
                       ` <b>Nível Sweep:</b> $${formatNumber(fractalHigh)}\n` +
                       ` <b>Timeframe:</b> 1H\n\n` +
                       ` <b>ANÁLISE TÉCNICA</b>\n` +
                       `• ADX (15m): <b>${adx15m.value}</b>\n` +
                       `• ADX (1h): <b>${adx1h.value}</b>\n` +
                       `• Long Account: <b>${lsrData.longAccount}</b>\n` +
                       `• Short Account: <b>${lsrData.shortAccount}</b>\n` +
                       `• LSR Ratio: <b>${lsrData.lsrRatio}</b>\n\n` +
                       ` <b>BOOK DE ORDENS</b>\n` +
                       `• Melhor Bid: <b>$${formatNumber(orderBook.bestBid)}</b>\n` +
                       `• Melhor Ask: <b>$${formatNumber(orderBook.bestAsk)}</b>\n` +
                       `• Volume Bid: <b>${orderBook.bidVolume}</b>\n` +
                       `• Volume Ask: <b>${orderBook.askVolume}</b>\n` +
                       `• Spread: <b>${orderBook.spread} bps</b>\n\n` +
                       `   <b>Titanium Sweep System v2.0</b>`;
            
            console.log(`\n${msg}`);
            logToFile(`SWEEP BEAR DETECTADO - Preço: $${price} - Nível: $${fractalHigh} - ${brDateTime.full}`);
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
            
            // Buscar dados adicionais
            const [adx15m, adx1h, lsrData, orderBook] = await Promise.all([
              getADX('15m'),
              getADX('1h'),
              getLSR('15m'),
              getOrderBook()
            ]);
            
            const brDateTime = getBrazilianDateTime();
            const msg = `🟢 <b>LIQUIDEZ BULL SWEEP DETECTADA</b>\n\n` +
                       `⏰<b>Data/Hora:</b> ${brDateTime.date} - ${brDateTime.time}\n` +
                       ` <b>Par:</b> ${SYMBOL}\n` +
                       ` <b>Preço Atual:</b> $${formatNumber(price)}\n` +
                       ` <b>Nível Sweep:</b> $${formatNumber(fractalLow)}\n` +
                       ` <b>Timeframe:</b> 1H\n\n` +
                       ` <b>ANÁLISE TÉCNICA</b>\n` +
                       `• ADX (15m): <b>${adx15m.value}</b>\n` +
                       `• ADX (1h): <b>${adx1h.value}</b>\n` +
                       `• Long Account: <b>${lsrData.longAccount}</b>\n` +
                       `• Short Account: <b>${lsrData.shortAccount}</b>\n` +
                       `• LSR Ratio: <b>${lsrData.lsrRatio}</b>\n\n` +
                       ` <b>BOOK DE ORDENS</b>\n` +
                       `• Melhor Bid: <b>$${formatNumber(orderBook.bestBid)}</b>\n` +
                       `• Melhor Ask: <b>$${formatNumber(orderBook.bestAsk)}</b>\n` +
                       `• Volume Bid: <b>${orderBook.bidVolume}</b>\n` +
                       `• Volume Ask: <b>${orderBook.askVolume}</b>\n` +
                       `• Spread: <b>${orderBook.spread} bps</b>\n\n` +
                       `   <b>Titanium Sweep System v2.0</b>`;
            
            console.log(`\n${msg}`);
            logToFile(`SWEEP BULL DETECTADO - Preço: $${price} - Nível: $${fractalLow} - ${brDateTime.full}`);
            await sendAlert(msg);
            lastBuyAlert = now;
            buySignal = true;
          }
        }
      }

      if (!buySignal && !sellSignal) {
        process.stdout.write('.');
      } else {
        process.stdout.write('\n🔔 ALERTA ENVIADO!\n');
      }

      consecutiveErrors = 0; // Resetar contador de erros
      await new Promise(r => setTimeout(r, 30000));

    } catch (e) {
      consecutiveErrors++;
      const errorMsg = `Erro no loop principal (${consecutiveErrors}): ${e.message}`;
      console.log(`\n❌ ${errorMsg}`);
      logToFile(`❌ ${errorMsg}`);
      
      // Esperar um tempo antes de tentar novamente
      const waitTime = Math.min(10000 * consecutiveErrors, 60000);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
}

// Função principal com sistema de recuperação
async function startBot() {
  try {
    // Inicializar sistema de logs
    initLogSystem();
    
    // Verificar conexão inicial
    logToFile('🔍 Verificando conexão inicial...');
    console.log('🔍 Verificando conexão inicial...');
    
    const isConnected = await checkInternetConnection();
    if (!isConnected) {
      console.log('🌐 Sem conexão inicial, tentando reconectar...');
      const reconnected = await reconnectWithBackoff();
      if (!reconnected) {
        throw new Error('Não foi possível estabelecer conexão inicial');
      }
    }
    
    // Iniciar loop principal do bot
    await mainBotLoop();
    
  } catch (error) {
    const crashMsg = `🚨 BOT CRASHED: ${error.message}`;
    console.error(`\n${crashMsg}`);
    logToFile(`🚨 ${crashMsg}`);
    
    // Tentar reiniciar após 30 segundos
    console.log('🔄 Reiniciando bot em 30 segundos...');
    logToFile('🔄 Reiniciando bot em 30 segundos...');
    
    await new Promise(r => setTimeout(r, 30000));
    await startBot(); // Reiniciar recursivamente
  }
}

// Iniciar o bot
startBot();
