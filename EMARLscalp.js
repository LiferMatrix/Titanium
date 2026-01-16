const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { EMA, RSI, Stochastic, ATR, MACD, SMA } = require('technicalindicators');

if (!globalThis.fetch) globalThis.fetch = fetch;

// === CONFIGURE AQUI SEU BOT E CHAT ===
const TELEGRAM_BOT_TOKEN = '7708427979:AAF7vVx';
const TELEGRAM_CHAT_ID = '-100255';

// === CONFIGURAÇÕES PARA ANÁLISE DE TODOS PARES ===
const ALL_PAIRS_SETTINGS = {
    nome: '🚀 TITANIUM SCANNER - ALL PAIRS',
    versao: '3.1',
    
    // Timeframes estratégicos
    timeframes: {
        tendencia: '1h',      // Tendência principal
        entrada: '15m',       // Ponto de entrada
        confirmação: '5m',    // Confirmação de entrada
        monitoramento: '3m'   // Monitoramento
    },
    
    // Indicadores otimizados para análise em massa
    indicadores: {
        // EMA multi-timeframe
        ema: {
            '1h': { rapida: 9, media: 21, lenta: 50 },
            '15m': { rapida: 7, media: 14 },
            '5m': { rapida: 5, media: 9 }
        },
        
        // RSI sensível
        rsi: {
            period: 7,
            sobrecomprado: 75,
            sobrevendido: 25,
            zonaNeutra: [35, 65]
        },
        
        // Stochastic
        stochastic: {
            period: 7,
            smooth: 2,
            signal: 2,
            sobrecomprado: 80,
            sobrevendido: 20
        },
        
        // Volume
        volume: {
            minimo: 1.5,      // 50% acima da média
            ideal: 2.0,       // 100% acima para entrada forte
            explosivo: 3.0    // 200% para momentum
        },
        
        // ATR para volatilidade
        atr: {
            period: 14,
            multiplier: 1.5
        }
    },
    
    // Filtros para todos os pares
    filtros: {
        // Filtros de mercado
        minVolume24h: 1000000,    // 1M USD mínimo
        minPreco: 0.01,           // Preço mínimo
        maxSpread: 0.1,           // Spread máximo 0.1%
        
        // Tendência
        tendenciaMinima: 'MODERADA',
        alinhamentoMinimo: 'BOM',
        
        // Setup
        scoreMinimo: 75,
        rrMinimo: 2.0,
        
        // Exclusões
        excluirFutures: false,
        excluirMargin: true,
        excluirLiquidacao: true
    },
    
    // Rate Limit inteligente
    rateLimit: {
        requestsPerMinute: 1200,     // Limite da Binance
        delayBase: 100,              // Delay base entre requests
        delayMax: 1000,              // Delay máximo
        batchSize: 10,               // Tamanho do batch
        retryAttempts: 3,            // Tentativas de retry
        coolDown: 60000              // Cooldown após erro (60s)
    },
    
    // Estratégia de varredura
    varredura: {
        cicloIntervalo: 300,         // 5 minutos entre ciclos completos
        monitoramentoIntervalo: 30,  // 30 segundos para monitoramento
        maxParesPorCiclo: 50,        // Máximo de pares analisados por ciclo
        priorizarVolume: true,       // Priorizar pares com mais volume
        cacheCandles: true,          // Cache de candles para performance
        cacheTTL: 300000,            // 5 minutos de cache
        atualizarParesIntervalo: 3600000 // 1 hora para recarregar pares
    },
    
    // Gerenciamento de sinais
    sinais: {
        maxSinaisSimultaneos: 10,
        cooldownPar: 3600000,        // 1 hora entre sinais no mesmo par
        priorizarScore: true,
        enviarTelegram: true,
        logDetalhado: true
    }
};

// === RATE LIMITER INTELIGENTE ===
class RateLimiterInteligente {
    constructor(config) {
        this.config = config;
        this.requests = [];
        this.queue = [];
        this.processing = false;
        this.paused = false;
        this.coolDownUntil = 0;
        this.consecutiveErrors = 0;
        
        console.log('📊 Rate Limiter Inteligente inicializado');
        console.log(`⚙️  Config: ${this.config.requestsPerMinute} req/min`);
    }
    
    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const request = {
                url,
                options,
                resolve,
                reject,
                timestamp: Date.now(),
                attempts: 0,
                maxAttempts: this.config.retryAttempts
            };
            
            this.queue.push(request);
            this.processQueue();
            
            return request;
        });
    }
    
    async processQueue() {
        if (this.processing || this.paused || this.queue.length === 0) return;
        
        this.processing = true;
        
        while (this.queue.length > 0 && !this.paused) {
            // Verificar cooldown
            const now = Date.now();
            if (now < this.coolDownUntil) {
                const waitTime = this.coolDownUntil - now;
                console.log(`⏳ Cooldown ativo. Aguardando ${waitTime}ms...`);
                await this.sleep(waitTime);
                continue;
            }
            
            // Gerenciar rate limit
            const minuteAgo = now - 60000;
            this.requests = this.requests.filter(req => req > minuteAgo);
            
            if (this.requests.length >= this.config.requestsPerMinute) {
                const oldest = this.requests[0];
                const waitTime = 60000 - (now - oldest);
                console.log(`⚠️ Rate limit próximo. Aguardando ${waitTime}ms...`);
                await this.sleep(waitTime);
                continue;
            }
            
            const request = this.queue.shift();
            
            try {
                const result = await this.executeRequest(request);
                this.requests.push(now);
                request.resolve(result);
                this.consecutiveErrors = 0;
                
                // Delay dinâmico entre requests
                const delay = this.calculateDynamicDelay();
                if (delay > 0) {
                    await this.sleep(delay);
                }
                
            } catch (error) {
                request.attempts++;
                
                if (request.attempts < request.maxAttempts) {
                    // Retry com backoff exponencial
                    const backoffDelay = Math.min(5000, Math.pow(2, request.attempts) * 500);
                    console.log(`🔄 Retry ${request.attempts}/${request.maxAttempts} para ${request.url} em ${backoffDelay}ms`);
                    
                    request.timestamp = now + backoffDelay;
                    this.queue.unshift(request);
                    
                } else {
                    // Máximo de tentativas atingido
                    request.reject(error);
                    this.consecutiveErrors++;
                    
                    if (this.consecutiveErrors >= 5) {
                        this.activateCooldown(this.config.coolDown);
                    }
                }
            }
        }
        
        this.processing = false;
    }
    
    calculateDynamicDelay() {
        const requestsLastMinute = this.requests.length;
        const utilization = requestsLastMinute / this.config.requestsPerMinute;
        
        if (utilization > 0.9) {
            return this.config.delayMax;
        } else if (utilization > 0.7) {
            return this.config.delayBase * 2;
        } else {
            return this.config.delayBase;
        }
    }
    
    async executeRequest(request) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
            const response = await fetch(request.url, {
                ...request.options,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 429) {
                    // Rate limit atingido
                    const retryAfter = response.headers.get('Retry-After') || 60;
                    this.activateCooldown(parseInt(retryAfter) * 1000);
                    throw new Error(`HTTP 429: Rate Limit Exceeded. Retry after ${retryAfter}s`);
                }
                
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
            
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
    
    activateCooldown(duration) {
        this.coolDownUntil = Date.now() + duration;
        this.paused = true;
        
        console.log(`🚨 Cooldown ativado por ${duration}ms`);
        
        setTimeout(() => {
            this.paused = false;
            this.consecutiveErrors = 0;
            console.log('✅ Cooldown finalizado. Retomando operações...');
            this.processQueue();
        }, duration);
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    getQueueLength() {
        return this.queue.length;
    }
    
    getRequestsLastMinute() {
        const minuteAgo = Date.now() - 60000;
        return this.requests.filter(req => req > minuteAgo).length;
    }
}

// === CACHE INTELIGENTE ===
class CacheInteligente {
    constructor(ttl = 300000) {
        this.cache = new Map();
        this.ttl = ttl;
        this.stats = {
            hits: 0,
            misses: 0,
            size: 0
        };
    }
    
    set(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        this.stats.size = this.cache.size;
    }
    
    get(key) {
        const item = this.cache.get(key);
        
        if (!item) {
            this.stats.misses++;
            return null;
        }
        
        // Verificar se expirou
        if (Date.now() - item.timestamp > this.ttl) {
            this.cache.delete(key);
            this.stats.misses++;
            this.stats.size = this.cache.size;
            return null;
        }
        
        this.stats.hits++;
        return item.data;
    }
    
    clear() {
        this.cache.clear();
        this.stats.size = 0;
    }
    
    clearExpired() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > this.ttl) {
                this.cache.delete(key);
            }
        }
        this.stats.size = this.cache.size;
    }
    
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : 0;
        
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            size: this.stats.size,
            hitRate: `${hitRate}%`
        };
    }
}

// === DIRETÓRIOS E ARQUIVOS ===
const LOG_DIR = './logs_all_pairs';
const DADOS_DIR = './dados_all_pairs';
const CACHE_DIR = './cache_all_pairs';

// === GLOBAL VARIABLES ===
const rateLimiter = new RateLimiterInteligente(ALL_PAIRS_SETTINGS.rateLimit);
const cacheCandles = new CacheInteligente(ALL_PAIRS_SETTINGS.varredura.cacheTTL);
const cacheTickers = new CacheInteligente(60000); // 1 minuto para tickers
let allPairs = [];
let ultimaAtualizacaoPares = 0;
let paresFiltrados = [];
let sinaisAtivos = new Map();
let cooldownPares = new Map();
let estatisticas = {
    ciclosCompletos: 0,
    paresAnalisados: 0,
    setupsEncontrados: 0,
    sinaisEnviados: 0,
    taxaSucesso: 0,
    inicio: Date.now()
};

// === FUNÇÃO PRINCIPAL DE ANÁLISE ===
class AnalisadorTodosPares {
    constructor() {
        this.config = ALL_PAIRS_SETTINGS;
        this.rateLimiter = rateLimiter;
        this.cacheCandles = cacheCandles;
        this.cacheTickers = cacheTickers;
        
        console.log('🚀 ANALISADOR DE TODOS PARES INICIALIZADO');
        console.log(`📊 Config: ${this.config.nome} v${this.config.versao}`);
        console.log(`🎯 Rate Limit: ${this.config.rateLimit.requestsPerMinute} req/min`);
    }
    
    async carregarTodosPares() {
        try {
            console.log('📥 Carregando todos os pares da Binance...');
            
            const url = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
            const data = await this.rateLimiter.makeRequest(url);
            
            if (!data || !data.symbols) {
                throw new Error('Falha ao carregar pares da Binance');
            }
            
            // Filtrar apenas USDT pairs ativos
            const usdtPairs = data.symbols.filter(symbol => 
                symbol.symbol.endsWith('USDT') && 
                symbol.status === 'TRADING' &&
                symbol.contractType === 'PERPETUAL'
            );
            
            console.log(`📊 ${usdtPairs.length} pares USDT encontrados`);
            
            // Carregar volume apenas para os top pares inicialmente
            const topPairs = usdtPairs.slice(0, 100); // Carrega volume apenas para os 100 primeiros
            
            const pairsWithVolume = await Promise.all(
                topPairs.map(async (symbol) => {
                    try {
                        const ticker = await this.buscarTicker24h(symbol.symbol);
                        if (!ticker) return null;
                        
                        return {
                            symbol: symbol.symbol,
                            volume24h: parseFloat(ticker.quoteVolume) || 0,
                            price: parseFloat(ticker.lastPrice) || 0,
                            lastUpdate: Date.now()
                        };
                    } catch (error) {
                        console.log(`⚠️ Erro volume ${symbol.symbol}: ${error.message}`);
                        return {
                            symbol: symbol.symbol,
                            volume24h: 0,
                            price: 0,
                            lastUpdate: Date.now()
                        };
                    }
                })
            );
            
            // Filtrar nulos e ordenar por volume
            const validPairs = pairsWithVolume.filter(p => p !== null);
            validPairs.sort((a, b) => b.volume24h - a.volume24h);
            
            allPairs = validPairs;
            ultimaAtualizacaoPares = Date.now();
            
            console.log(`✅ ${allPairs.length} pares carregados com volume`);
            console.log(`📊 Top 5 por volume:`);
            allPairs.slice(0, 5).forEach((pair, i) => {
                console.log(`   ${i+1}. ${pair.symbol} - $${(pair.volume24h/1000000).toFixed(2)}M`);
            });
            
            return allPairs;
            
        } catch (error) {
            console.log(`🚨 Erro ao carregar pares: ${error.message}`);
            // Tentar carregar lista de fallback se houver erro
            await this.carregarParesFallback();
            throw error;
        }
    }
    
    async carregarParesFallback() {
        console.log('🔄 Usando lista fallback de pares...');
        
        // Lista fallback de pares principais
        const paresPrincipais = [
            'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
            'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT',
            'DOGEUSDT', 'TRXUSDT', 'UNIUSDT', 'ATOMUSDT', 'FILUSDT',
            'LTCUSDT', 'ETCUSDT', 'XLMUSDT', 'VETUSDT', 'ALGOUSDT',
            'ICPUSDT', 'NEARUSDT', 'FTMUSDT', 'GRTUSDT', 'AAVEUSDT',
            'SUSHIUSDT', 'MKRUSDT', 'CRVUSDT', 'COMPUSDT', 'SNXUSDT'
        ];
        
        allPairs = paresPrincipais.map(symbol => ({
            symbol: symbol,
            volume24h: 10000000, // Valor padrão alto
            price: 1,
            lastUpdate: Date.now()
        }));
        
        console.log(`✅ ${allPairs.length} pares fallback carregados`);
        return allPairs;
    }
    
    async atualizarVolumesPares() {
        try {
            console.log('🔄 Atualizando volumes dos pares...');
            
            // Atualizar apenas volumes dos pares existentes
            const updatedPairs = await Promise.all(
                allPairs.map(async (pair) => {
                    try {
                        const ticker = await this.buscarTicker24h(pair.symbol);
                        if (ticker) {
                            return {
                                ...pair,
                                volume24h: parseFloat(ticker.quoteVolume) || pair.volume24h,
                                price: parseFloat(ticker.lastPrice) || pair.price,
                                lastUpdate: Date.now()
                            };
                        }
                        return pair;
                    } catch (error) {
                        console.log(`⚠️ Erro atualizar ${pair.symbol}: ${error.message}`);
                        return pair;
                    }
                })
            );
            
            // Ordenar por volume
            updatedPairs.sort((a, b) => b.volume24h - a.volume24h);
            allPairs = updatedPairs;
            ultimaAtualizacaoPares = Date.now();
            
            console.log(`✅ Volumes atualizados para ${allPairs.length} pares`);
            
        } catch (error) {
            console.log(`⚠️ Erro ao atualizar volumes: ${error.message}`);
        }
    }
    
    async filtrarPares() {
        try {
            console.log('\n🔍 Filtrando pares...');
            
            const agora = Date.now();
            const precisaAtualizarVolumes = agora - ultimaAtualizacaoPares > 3600000; // 1 hora
            
            if (precisaAtualizarVolumes) {
                await this.atualizarVolumesPares();
            }
            
            const paresValidos = [];
            
            // Filtrar em batches menores para evitar sobrecarga
            const batchSize = 5;
            
            for (let i = 0; i < allPairs.length; i += batchSize) {
                const batch = allPairs.slice(i, i + batchSize);
                
                const promises = batch.map(async (pair) => {
                    try {
                        // Verificar volume mínimo
                        if (pair.volume24h < this.config.filtros.minVolume24h) {
                            return null;
                        }
                        
                        // Verificar preço mínimo
                        if (pair.price < this.config.filtros.minPreco) {
                            return null;
                        }
                        
                        // Verificar se está em cooldown
                        const cooldown = cooldownPares.get(pair.symbol);
                        if (cooldown && agora < cooldown) {
                            return null;
                        }
                        
                        // Verificar spread (opcional - pode ser pesado)
                        // if (i < 20) { // Verificar apenas para os primeiros
                        //     const ticker = await this.buscarTicker24h(pair.symbol);
                        //     if (ticker) {
                        //         const spread = ((ticker.askPrice - ticker.bidPrice) / ticker.askPrice) * 100;
                        //         if (spread > this.config.filtros.maxSpread) {
                        //             return null;
                        //         }
                        //     }
                        // }
                        
                        return pair;
                        
                    } catch (error) {
                        console.log(`⚠️ Erro filtrar ${pair.symbol}: ${error.message}`);
                        return null;
                    }
                });
                
                const results = await Promise.all(promises);
                const validos = results.filter(p => p !== null);
                paresValidos.push(...validos);
                
                console.log(`   Processados ${Math.min(i + batch.length, allPairs.length)}/${allPairs.length} pares...`);
                
                // Aguardar entre batches para não sobrecarregar
                if (i + batchSize < allPairs.length) {
                    await this.sleep(200);
                }
            }
            
            // Ordenar por prioridade
            if (this.config.varredura.priorizarVolume) {
                paresValidos.sort((a, b) => b.volume24h - a.volume24h);
            }
            
            // Limitar número de pares por ciclo
            const limite = Math.min(this.config.varredura.maxParesPorCiclo, paresValidos.length);
            paresFiltrados = paresValidos.slice(0, limite);
            
            console.log(`✅ ${paresFiltrados.length} pares filtrados para análise`);
            
            return paresFiltrados;
            
        } catch (error) {
            console.log(`🚨 Erro ao filtrar pares: ${error.message}`);
            return [];
        }
    }
    
    async analisarPar(symbol) {
        try {
            const agora = Date.now();
            
            // Verificar cooldown
            const cooldown = cooldownPares.get(symbol);
            if (cooldown && agora < cooldown) {
                return { valido: false, motivo: 'Em cooldown' };
            }
            
            // Verificar se já tem sinal ativo para este par
            const sinalAtivo = Array.from(sinaisAtivos.values()).find(s => 
                s.symbol === symbol && s.status === 'ATIVO'
            );
            
            if (sinalAtivo) {
                return { valido: false, motivo: 'Sinal ativo já existe' };
            }
            
            // Verificar condições básicas
            const ticker = await this.buscarTicker24h(symbol);
            if (!ticker) {
                return { valido: false, motivo: 'Ticker não disponível' };
            }
            
            // 1. ANALISAR TENDÊNCIA 1H
            const tendencia1h = await this.analisarTendencia(symbol, '1h');
            if (!tendencia1h || !this.filtrarTendencia(tendencia1h)) {
                return { valido: false, motivo: 'Tendência inadequada' };
            }
            
            const isBullish = tendencia1h.direcao === 'BULLISH';
            
            // 2. ANALISAR SETUP 15M
            const setup15m = await this.analisarSetup(symbol, '15m', isBullish);
            if (!setup15m.valido) {
                return { valido: false, motivo: setup15m.motivo };
            }
            
            // 3. CONFIRMAÇÃO 5M
            const confirmacao5m = await this.confirmarSetup(symbol, '5m', isBullish, setup15m);
            if (!confirmacao5m.confirmado) {
                return { valido: false, motivo: confirmacao5m.motivo };
            }
            
            // 4. CALCULAR NÍVEIS
            const niveis = await this.calcularNiveis(symbol, setup15m.precoAtual, isBullish);
            
            // 5. CALCULAR SCORE
            const score = this.calcularScore(tendencia1h, setup15m, confirmacao5m, niveis);
            
            if (score.total < this.config.filtros.scoreMinimo) {
                return { valido: false, motivo: `Score baixo: ${score.total}` };
            }
            
            if (niveis.rr < this.config.filtros.rrMinimo) {
                return { valido: false, motivo: `RR baixo: ${niveis.rr.toFixed(2)}` };
            }
            
            // 6. CRIAR SINAL
            const sinal = this.criarSinal(symbol, isBullish, tendencia1h, setup15m, confirmacao5m, niveis, score);
            
            return {
                valido: true,
                sinal: sinal,
                score: score,
                tendencia: tendencia1h,
                setup: setup15m,
                confirmacao: confirmacao5m
            };
            
        } catch (error) {
            console.log(`⚠️ Erro análise ${symbol}: ${error.message}`);
            return { valido: false, motivo: `Erro: ${error.message}` };
        }
    }
    
    async analisarTendencia(symbol, timeframe) {
        try {
            const candles = await this.getCandles(symbol, timeframe, 100);
            if (candles.length < 50) return null;
            
            const closes = candles.map(c => c.close);
            
            // Calcular EMAs
            const emaConfig = this.config.indicadores.ema[timeframe];
            if (!emaConfig) return null;
            
            const emaRapida = EMA.calculate({ period: emaConfig.rapida, values: closes });
            const emaMedia = EMA.calculate({ period: emaConfig.media, values: closes });
            const emaLenta = emaConfig.lenta ? 
                EMA.calculate({ period: emaConfig.lenta, values: closes }) : null;
            
            if (!emaRapida || !emaMedia || emaRapida.length < 2 || emaMedia.length < 2) return null;
            
            const precoAtual = closes[closes.length - 1];
            const emaRapidaAtual = emaRapida[emaRapida.length - 1];
            const emaMediaAtual = emaMedia[emaMedia.length - 1];
            const emaLentaAtual = emaLenta ? emaLenta[emaLenta.length - 1] : null;
            
            // Determinar direção
            let direcao = 'NEUTRAL';
            if (precoAtual > emaRapidaAtual && emaRapidaAtual > emaMediaAtual) {
                direcao = 'BULLISH';
            } else if (precoAtual < emaRapidaAtual && emaRapidaAtual < emaMediaAtual) {
                direcao = 'BEARISH';
            } else if (precoAtual > emaMediaAtual) {
                direcao = 'BULLISH_MODERADO';
            } else if (precoAtual < emaMediaAtual) {
                direcao = 'BEARISH_MODERADO';
            }
            
            // Calcular força
            const forca = this.calcularForcaTendencia(closes, emaMedia, direcao);
            
            // Verificar alinhamento
            const alinhamento = this.verificarAlinhamentoEMA(
                precoAtual, emaRapidaAtual, emaMediaAtual, emaLentaAtual, direcao
            );
            
            return {
                direcao: direcao,
                forca: forca,
                alinhamento: alinhamento,
                preco: precoAtual,
                timeframe: timeframe
            };
            
        } catch (error) {
            console.log(`⚠️ Erro análise tendência ${symbol} ${timeframe}: ${error.message}`);
            return null;
        }
    }
    
    calcularForcaTendencia(closes, ema, direcao) {
        if (closes.length < 10 || ema.length < 10) return 'FRACA';
        
        // Calcular inclinação da EMA
        const emaRecent = ema.slice(-10);
        const primeiro = emaRecent[0];
        const ultimo = emaRecent[emaRecent.length - 1];
        const inclinacao = ((ultimo - primeiro) / primeiro) * 100;
        
        // Determinar força
        if (Math.abs(inclinacao) > 15) {
            return 'FORTE';
        } else if (Math.abs(inclinacao) > 8) {
            return 'MODERADA';
        } else {
            return 'FRACA';
        }
    }
    
    verificarAlinhamentoEMA(preco, emaRapida, emaMedia, emaLenta, direcao) {
        if (!emaMedia) return 'NEUTRAL';
        
        if (direcao.includes('BULLISH')) {
            if (emaLenta) {
                if (preco > emaRapida && emaRapida > emaMedia && emaMedia > emaLenta) {
                    return 'PERFEITO';
                }
            }
            return preco > emaMedia ? 'BOM' : 'RUIM';
        } else if (direcao.includes('BEARISH')) {
            if (emaLenta) {
                if (preco < emaRapida && emaRapida < emaMedia && emaMedia < emaLenta) {
                    return 'PERFEITO';
                }
            }
            return preco < emaMedia ? 'BOM' : 'RUIM';
        }
        
        return 'NEUTRAL';
    }
    
    filtrarTendencia(tendencia) {
        if (!tendencia || tendencia.direcao === 'NEUTRAL') return false;
        
        // Filtrar por força mínima
        if (tendencia.forca !== 'FORTE' && tendencia.forca !== 'MODERADA') {
            return false;
        }
        
        // Filtrar por alinhamento mínimo
        if (tendencia.alinhamento === 'RUIM') {
            return false;
        }
        
        return true;
    }
    
    async analisarSetup(symbol, timeframe, isBullish) {
        try {
            const candles = await this.getCandles(symbol, timeframe, 50);
            if (candles.length < 20) {
                return { valido: false, motivo: 'Dados insuficientes' };
            }
            
            const closes = candles.map(c => c.close);
            const volumes = candles.map(c => c.volume);
            
            const precoAtual = closes[closes.length - 1];
            const volumeAtual = volumes[volumes.length - 1];
            const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
            const volumeRatio = volumeAtual / avgVolume;
            
            // Calcular RSI
            const rsiValues = RSI.calculate({ 
                values: closes, 
                period: this.config.indicadores.rsi.period 
            });
            const rsi = rsiValues[rsiValues.length - 1] || 50;
            
            // Verificar condições simplificadas
            const condicoes = {
                // RSI na zona favorável
                rsiOk: isBullish ? 
                    rsi > this.config.indicadores.rsi.sobrevendido && rsi < 70 :
                    rsi < this.config.indicadores.rsi.sobrecomprado && rsi > 30,
                
                // Volume
                volumeOk: volumeRatio >= this.config.indicadores.volume.minimo,
                
                // Tendência do preço (simplificado)
                precoOk: isBullish ? 
                    precoAtual > closes[closes.length - 2] :
                    precoAtual < closes[closes.length - 2]
            };
            
            // Validar setup
            const condicoesAtendidas = Object.values(condicoes).filter(v => v).length;
            const valido = condicoesAtendidas >= 2;
            
            return {
                valido: valido,
                motivo: valido ? null : `${condicoesAtendidas}/3 condições`,
                tipo: this.determinarTipoSetup(condicoes),
                precoAtual: precoAtual,
                rsi: rsi,
                volume: {
                    ratio: volumeRatio,
                    atual: volumeAtual,
                    media: avgVolume,
                    classificacao: this.classificarVolume(volumeRatio)
                },
                condicoes: condicoes,
                condicoesAtendidas: condicoesAtendidas
            };
            
        } catch (error) {
            return { valido: false, motivo: `Erro: ${error.message}` };
        }
    }
    
    determinarTipoSetup(condicoes) {
        if (condicoes.volumeOk && condicoes.rsiOk) {
            return 'MOMENTUM';
        } else if (condicoes.volumeOk) {
            return 'VOLUME';
        } else if (condicoes.rsiOk) {
            return 'RSI';
        }
        return 'GERAL';
    }
    
    classificarVolume(ratio) {
        if (ratio >= 3.0) return 'EXPLOSIVO';
        if (ratio >= 2.0) return 'FORTE';
        if (ratio >= 1.5) return 'MODERADO';
        if (ratio >= 1.0) return 'NORMAL';
        return 'BAIXO';
    }
    
    async confirmarSetup(symbol, timeframe, isBullish, setup) {
        try {
            const candles = await this.getCandles(symbol, timeframe, 10);
            if (candles.length < 5) {
                return { confirmado: false, motivo: 'Dados insuficientes' };
            }
            
            const ultima = candles[candles.length - 1];
            
            // Verificar confirmações simplificadas
            const confirmacoes = {
                volume: true, // Simplificado - já verificado no setup
                direcao: isBullish ? ultima.close > ultima.open : ultima.close < ultima.open,
                forca: isBullish ? 
                    (ultima.close - ultima.open) / ultima.open > 0.0003 :
                    (ultima.open - ultima.close) / ultima.open > 0.0003
            };
            
            const confirmacoesAtendidas = Object.values(confirmacoes).filter(v => v).length;
            const confirmado = confirmacoesAtendidas >= 2;
            
            return {
                confirmado: confirmado,
                motivo: confirmado ? null : `${confirmacoesAtendidas}/3 confirmações`,
                confirmacoes: confirmacoes
            };
            
        } catch (error) {
            return { confirmado: false, motivo: `Erro: ${error.message}` };
        }
    }
    
    async calcularNiveis(symbol, precoAtual, isBullish) {
        try {
            // Calcular ATR simplificado
            const atr = await this.calcularATR(simplificado);
            const atrValue = atr || (precoAtual * 0.012);
            
            // Stop Loss
            const stopDistance = atrValue * this.config.indicadores.atr.multiplier;
            const stopPercent = (stopDistance / precoAtual) * 100;
            
            const stopPrice = isBullish ? 
                precoAtual - stopDistance : 
                precoAtual + stopDistance;
            
            // Take Profits escalonados
            const takeProfits = [
                { alvo: 1.5, percentual: 0.5, nivel: 1 },
                { alvo: 3.0, percentual: 0.3, nivel: 2 },
                { alvo: 5.0, percentual: 0.2, nivel: 3 }
            ].map(tp => {
                const distancia = precoAtual * (tp.alvo / 100);
                const precoTP = isBullish ? 
                    precoAtual + distancia : 
                    precoAtual - distancia;
                    
                return {
                    ...tp,
                    preco: precoTP,
                    distancia: distancia
                };
            });
            
            // Risk/Reward
            const risco = Math.abs(precoAtual - stopPrice);
            const recompensa = takeProfits[0].distancia;
            const rr = recompensa / risco;
            
            return {
                entrada: { ideal: precoAtual },
                stop: {
                    preco: stopPrice,
                    percentual: stopPercent,
                    metodo: 'ATR'
                },
                takeProfit: takeProfits,
                rr: rr,
                risco: risco,
                recompensa: recompensa
            };
            
        } catch (error) {
            console.log(`⚠️ Erro cálculo níveis ${symbol}: ${error.message}`);
            
            // Fallback simples
            const stopPercent = 1.5;
            const stopPrice = isBullish ? 
                precoAtual * (1 - stopPercent / 100) : 
                precoAtual * (1 + stopPercent / 100);
            
            return {
                entrada: { ideal: precoAtual },
                stop: { preco: stopPrice, percentual: stopPercent },
                takeProfit: [{ alvo: 2.5, preco: isBullish ? precoAtual * 1.025 : precoAtual * 0.975 }],
                rr: 1.67,
                risco: precoAtual * (stopPercent / 100),
                recompensa: precoAtual * (2.5 / 100)
            };
        }
    }
    
    async calcularATR(symbol) {
        try {
            const candles = await this.getCandles(symbol, '15m', 24); // Menos candles para performance
            if (candles.length < 14) return null;
            
            const highs = candles.map(c => c.high);
            const lows = candles.map(c => c.low);
            const closes = candles.map(c => c.close);
            
            const atrValues = ATR.calculate({
                high: highs,
                low: lows,
                close: closes,
                period: 14
            });
            
            return atrValues[atrValues.length - 1];
            
        } catch (error) {
            return null;
        }
    }
    
    calcularScore(tendencia, setup, confirmacao, niveis) {
        let score = 0;
        
        // TENDÊNCIA (40 pontos)
        if (tendencia.forca === 'FORTE') {
            score += 30;
        } else if (tendencia.forca === 'MODERADA') {
            score += 20;
        }
        
        if (tendencia.alinhamento === 'PERFEITO') {
            score += 10;
        } else if (tendencia.alinhamento === 'BOM') {
            score += 5;
        }
        
        // SETUP (30 pontos)
        score += Math.min(30, setup.condicoesAtendidas * 10);
        
        if (setup.volume.classificacao === 'EXPLOSIVO') {
            score += 10;
        } else if (setup.volume.classificacao === 'FORTE') {
            score += 5;
        }
        
        // CONFIRMAÇÃO (20 pontos)
        const confirmacoes = Object.values(confirmacao.confirmacoes || {}).filter(v => v).length;
        score += confirmacoes * 7;
        
        // RISCO/RECOMPENSA (10 pontos)
        if (niveis.rr >= 3.0) {
            score += 10;
        } else if (niveis.rr >= 2.0) {
            score += 7;
        } else if (niveis.rr >= 1.5) {
            score += 3;
        }
        
        // Classificação
        let classificacao = '';
        if (score >= 80) classificacao = 'EXCELENTE 🌟';
        else if (score >= 70) classificacao = 'MUITO BOM ✅';
        else if (score >= 60) classificacao = 'BOM 👍';
        else if (score >= 50) classificacao = 'REGULAR ⚠️';
        else classificacao = 'FRACO ❌';
        
        return {
            total: Math.min(100, score),
            classificacao: classificacao
        };
    }
    
    criarSinal(symbol, isBullish, tendencia, setup, confirmacao, niveis, score) {
        const timestamp = Date.now();
        const id = `${symbol}_${timestamp}_${Math.random().toString(36).substr(2, 6)}`;
        
        return {
            id: id,
            symbol: symbol,
            direcao: isBullish ? 'COMPRA' : 'VENDA',
            tipo: setup.tipo,
            timestamp: timestamp,
            
            // Preços
            entrada: {
                preco: setup.precoAtual,
                horario: new Date(timestamp).toISOString()
            },
            
            // Risco
            risco: {
                stop: niveis.stop,
                takeProfit: niveis.takeProfit,
                rr: niveis.rr,
                riscoPercentual: niveis.stop.percentual
            },
            
            // Análise
            analise: {
                tendencia: tendencia,
                setup: setup,
                score: score
            },
            
            // Status
            status: 'SINAL_GERADO',
            prioridade: score.total >= 80 ? 'ALTA' : score.total >= 70 ? 'MEDIA' : 'BAIXA'
        };
    }
    
    async buscarTicker24h(symbol) {
        try {
            // Verificar cache
            const cacheKey = `ticker_${symbol}`;
            const cached = this.cacheTickers.get(cacheKey);
            if (cached) return cached;
            
            const url = `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`;
            const response = await this.rateLimiter.makeRequest(url);
            
            if (response) {
                this.cacheTickers.set(cacheKey, response);
            }
            
            return response;
        } catch (error) {
            return null;
        }
    }
    
    async getCandles(symbol, timeframe, limit) {
        try {
            // Verificar cache
            const cacheKey = `candles_${symbol}_${timeframe}_${limit}`;
            const cached = this.cacheCandles.get(cacheKey);
            if (cached) return cached;
            
            const intervalMap = {
                '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m',
                '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d'
            };
            
            const interval = intervalMap[timeframe] || timeframe;
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            
            const response = await this.rateLimiter.makeRequest(url);
            
            const candles = response.map(candle => ({
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5]),
                time: candle[0]
            }));
            
            if (candles.length > 0) {
                this.cacheCandles.set(cacheKey, candles);
            }
            
            return candles;
            
        } catch (error) {
            console.log(`⚠️ Erro candles ${symbol} ${timeframe}: ${error.message}`);
            return [];
        }
    }
    
    async enviarAlertaTelegram(sinal) {
        if (!this.config.sinais.enviarTelegram) return false;
        
        try {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('pt-BR');
            const dateStr = now.toLocaleDateString('pt-BR');
            
            const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${sinal.symbol}`;
            
            let message = `
${sinal.direcao === 'COMPRA' ? '🟢' : '🔴'} <b>${sinal.symbol} - ${sinal.direcao}</b>
📅 ${dateStr} ${timeStr} | <a href="${tvLink}">📊 Gráfico</a>

<b>🎯 SETUP ${sinal.tipo}</b>
• Score: ${sinal.analise.score.total}/100 (${sinal.analise.score.classificacao})
• Tendência: ${sinal.analise.tendencia.forca} ${sinal.analise.tendencia.direcao}
• RSI: ${sinal.analise.setup.rsi.toFixed(1)}
• Volume: ${sinal.analise.setup.volume.ratio.toFixed(2)}x

<b>💰 NÍVEIS DE OPERAÇÃO</b>
• Entrada: $${sinal.entrada.preco.toFixed(6)}
• Stop: $${sinal.risco.stop.preco.toFixed(6)} (${sinal.risco.stop.percentual.toFixed(2)}%)
• TP1: $${sinal.risco.takeProfit[0].preco.toFixed(6)} (${sinal.risco.takeProfit[0].alvo}%)
• TP2: $${sinal.risco.takeProfit[1].preco.toFixed(6)} (${sinal.risco.takeProfit[1].alvo}%)
• TP3: $${sinal.risco.takeProfit[2].preco.toFixed(6)} (${sinal.risco.takeProfit[2].alvo}%)

<b>📊 RISCO/RECOMPENSA</b>
• RR: ${sinal.risco.rr.toFixed(2)}:1
• Prioridade: ${sinal.prioridade}

<i>✨ ${this.config.nome} v${this.config.versao} ✨</i>
            `;
            
            await this.sendTelegram(message);
            console.log(`📤 Alerta Telegram enviado: ${sinal.symbol}`);
            
            return true;
            
        } catch (error) {
            console.log(`⚠️ Erro enviar alerta Telegram: ${error.message}`);
            return false;
        }
    }
    
    async sendTelegram(message) {
        try {
            const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                })
            });
            
            return response.ok;
        } catch (error) {
            throw error;
        }
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    async monitorarSinais() {
        const agora = Date.now();
        const sinaisExpirados = [];
        
        for (const [id, sinal] of sinaisAtivos) {
            // Verificar se expirou (30 minutos)
            if (agora - sinal.timestamp > 1800000) {
                sinaisExpirados.push(id);
                console.log(`⏰ Sinal expirado: ${sinal.symbol}`);
            }
        }
        
        // Remover sinais expirados
        sinaisExpirados.forEach(id => sinaisAtivos.delete(id));
        
        return sinaisAtivos.size;
    }
    
    async executarCicloAnalise() {
        try {
            const inicioCiclo = Date.now();
            console.log(`\n🔄 INICIANDO CICLO DE ANÁLISE ${estatisticas.ciclosCompletos + 1}`);
            console.log(`📊 Pares carregados: ${allPairs.length}`);
            console.log(`📈 Rate Limit atual: ${rateLimiter.getRequestsLastMinute()}/${this.config.rateLimit.requestsPerMinute} req/min`);
            
            // 1. Verificar se precisa carregar pares (apenas na primeira vez)
            if (allPairs.length === 0) {
                await this.carregarTodosPares();
            }
            
            // 2. Filtrar pares
            const paresParaAnalisar = await this.filtrarPares();
            
            if (paresParaAnalisar.length === 0) {
                console.log('⚠️ Nenhum par filtrado para análise');
                return;
            }
            
            console.log(`📊 Analisando ${paresParaAnalisar.length} pares...`);
            
            // 3. Analisar cada par
            const sinaisEncontrados = [];
            
            for (const pair of paresParaAnalisar) {
                try {
                    estatisticas.paresAnalisados++;
                    
                    const resultado = await this.analisarPar(pair.symbol);
                    
                    if (resultado.valido && resultado.sinal) {
                        sinaisEncontrados.push(resultado.sinal);
                        
                        // Log detalhado
                        if (this.config.sinais.logDetalhado) {
                            console.log(`✅ SETUP: ${pair.symbol} ${resultado.sinal.direcao} Score: ${resultado.sinal.analise.score.total}`);
                        }
                    }
                    
                    // Aguardar entre análises
                    await this.sleep(100);
                    
                } catch (error) {
                    console.log(`⚠️ Erro análise ${pair.symbol}: ${error.message}`);
                }
            }
            
            // 4. Processar sinais encontrados
            estatisticas.setupsEncontrados += sinaisEncontrados.length;
            
            // Ordenar sinais por score
            sinaisEncontrados.sort((a, b) => b.analise.score.total - a.analise.score.total);
            
            // Limitar número de sinais simultâneos
            const sinaisParaEnviar = sinaisEncontrados.slice(0, this.config.sinais.maxSinaisSimultaneos);
            
            // Enviar sinais
            for (const sinal of sinaisParaEnviar) {
                try {
                    // Enviar alerta
                    const enviado = await this.enviarAlertaTelegram(sinal);
                    
                    if (enviado) {
                        // Adicionar cooldown para o par
                        cooldownPares.set(sinal.symbol, Date.now() + this.config.sinais.cooldownPar);
                        
                        // Registrar sinal ativo
                        sinaisAtivos.set(sinal.id, {
                            ...sinal,
                            status: 'ATIVO',
                            enviadoEm: Date.now()
                        });
                        
                        estatisticas.sinaisEnviados++;
                        
                        // Aguardar entre envios
                        await this.sleep(1500);
                    }
                    
                } catch (error) {
                    console.log(`⚠️ Erro processar sinal ${sinal.symbol}: ${error.message}`);
                }
            }
            
            // 5. Monitorar sinais ativos
            const sinaisAtivosCount = await this.monitorarSinais();
            
            // 6. Atualizar estatísticas
            const fimCiclo = Date.now();
            const duracaoCiclo = (fimCiclo - inicioCiclo) / 1000;
            
            estatisticas.ciclosCompletos++;
            
            // Limpar caches expirados periodicamente
            if (estatisticas.ciclosCompletos % 5 === 0) {
                this.cacheCandles.clearExpired();
                this.cacheTickers.clearExpired();
            }
            
            console.log(`\n📈 CICLO ${estatisticas.ciclosCompletos} COMPLETADO`);
            console.log(`⏱️  Duração: ${duracaoCiclo.toFixed(1)} segundos`);
            console.log(`📊 Setups encontrados: ${sinaisEncontrados.length}`);
            console.log(`📤 Sinais enviados: ${sinaisParaEnviar.length}`);
            console.log(`🏦 Sinais ativos: ${sinaisAtivosCount}`);
            console.log(`📊 Cache hit rate: ${this.cacheCandles.getStats().hitRate}`);
            console.log(`📈 Rate Limit: ${rateLimiter.getRequestsLastMinute()}/${this.config.rateLimit.requestsPerMinute} req/min`);
            
            // Gerar relatório a cada 5 ciclos
            if (estatisticas.ciclosCompletos % 5 === 0) {
                await this.gerarRelatorioCompleto();
            }
            
        } catch (error) {
            console.log(`🚨 ERRO NO CICLO DE ANÁLISE: ${error.message}`);
            console.log(error.stack);
        }
    }
    
    async gerarRelatorioCompleto() {
        try {
            const agora = new Date();
            const uptime = Math.floor((Date.now() - estatisticas.inicio) / 1000);
            const horas = Math.floor(uptime / 3600);
            const minutos = Math.floor((uptime % 3600) / 60);
            const segundos = uptime % 60;
            
            const statsCache = this.cacheCandles.getStats();
            
            const relatorio = `
📊 RELATÓRIO COMPLETO - ${agora.toLocaleDateString('pt-BR')} ${agora.toLocaleTimeString('pt-BR')}
⏱️ Uptime: ${horas}h ${minutos}m ${segundos}s

<b>ESTATÍSTICAS GERAIS</b>
• Ciclos completos: ${estatisticas.ciclosCompletos}
• Pares analisados: ${estatisticas.paresAnalisados}
• Setups encontrados: ${estatisticas.setupsEncontrados}
• Sinais enviados: ${estatisticas.sinaisEnviados}

<b>PERFORMANCE</b>
• Cache hit rate: ${statsCache.hitRate}
• Sinais ativos: ${sinaisAtivos.size}
• Pares em cooldown: ${cooldownPares.size}

<b>RATE LIMIT</b>
• Requests/min: ${rateLimiter.getRequestsLastMinute()}/${this.config.rateLimit.requestsPerMinute}
• Fila atual: ${rateLimiter.getQueueLength()}

<b>TOP PARES POR VOLUME</b>
${allPairs.slice(0, 5).map((p, i) => `${i+1}. ${p.symbol} - $${(p.volume24h/1000000).toFixed(2)}M`).join('\n')}

<i>✨ ${this.config.nome} v${this.config.versao} ✨</i>
            `;
            
            console.log(relatorio);
            
            if (this.config.sinais.enviarTelegram) {
                await this.sendTelegram(relatorio);
            }
            
            // Salvar relatório em arquivo
            const logFile = path.join(LOG_DIR, `relatorio_${Date.now()}.txt`);
            fs.writeFileSync(logFile, relatorio);
            
        } catch (error) {
            console.log(`⚠️ Erro gerar relatório: ${error.message}`);
        }
    }
}

// === FUNÇÃO PRINCIPAL ===
async function iniciarScannerTodosPares() {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🚀 TITANIUM SCANNER - TODOS OS PARES');
        console.log('🎯 Estratégia: Análise completa de todos pares Binance');
        console.log('⚡ Rate Limit: Inteligente e adaptativo');
        console.log('⏰ Operação: 24/7 sem bloqueio de horário');
        console.log('='.repeat(80) + '\n');
        
        // Criar diretórios
        if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
        if (!fs.existsSync(DADOS_DIR)) fs.mkdirSync(DADOS_DIR, { recursive: true });
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        
        const analisador = new AnalisadorTodosPares();
        
        console.log('🚀 Inicializando scanner...');
        
        let ciclo = 0;
        
        // Loop principal
        while (true) {
            ciclo++;
            console.log(`\n🌀 CICLO PRINCIPAL ${ciclo} - ${new Date().toLocaleTimeString('pt-BR')}`);
            
            try {
                // Executar ciclo de análise
                await analisador.executarCicloAnalise();
                
                // Aguardar próximo ciclo
                console.log(`⏳ Próximo ciclo em ${ALL_PAIRS_SETTINGS.varredura.cicloIntervalo} segundos...`);
                await analisador.sleep(ALL_PAIRS_SETTINGS.varredura.cicloIntervalo * 1000);
                
            } catch (error) {
                console.log(`🚨 ERRO NO CICLO PRINCIPAL ${ciclo}: ${error.message}`);
                console.log(`🔄 Tentando novamente em 30 segundos...`);
                await analisador.sleep(30000);
            }
        }
        
    } catch (error) {
        console.log(`🚨 ERRO CRÍTICO NO INICIALIZADOR: ${error.message}`);
        console.log(`🔄 Reiniciando em 60 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 60000));
        await iniciarScannerTodosPares();
    }
}

// === MANIPULADOR DE ERROS NÃO TRATADOS ===
process.on('uncaughtException', (error) => {
    console.log(`🚨 ERRO NÃO TRATADO: ${error.message}`);
    console.log(error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log(`🚨 PROMISE REJEITADA NÃO TRATADA: ${reason}`);
});

// === INICIAR O SCANNER ===
iniciarScannerTodosPares().catch(console.error);
