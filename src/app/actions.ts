"use server";

import { generateContentWithFallback, type CryptoAnalysisResult } from "@/lib/gemini";
import {
  AGENT_WATCHLIST, AGENT_WATCHLIST_TIERS, STABLECOIN_REJECT_LIST,
  EODHD_DAILY_LIMIT, EODHD_CRITICAL_THRESHOLD, EODHD_THROTTLE_THRESHOLD,
  ARENA_START_DATE, ARENA_DURATION_DAYS, POOL_COUNT, POOL_BUDGET,
  type ArenaConfig, type ArenaPool, type ArenaTradeRecord, type PoolStrategy,
  type PoolId, type AIReasoningEntry, type WeeklyReview, type StrategyChange,
  type AssetClass,
  formatEODHDTicker, parseEODHDTicker, getArenaCollections, getWatchlist, getCurrencySymbol, getBenchmarkLabel,
  COMMODITIES_DISPLAY_NAMES,
} from "@/lib/constants";
import {
  getArenaConfig, initializeArena, getArenaTrades,
  recordArenaTrade, executePoolBuy, executePoolSell,
  getPoolTotalValue, updatePoolPerformance, recordDailySnapshot,
  recordWeeklyReview, pauseArenaPool, resumeArenaPool,
  getTradeReflections, recordTradeReflection,
  getCurrentWeek, getDayNumber, isArenaActive, isDynamicReviewDue,
  resetSandboxArena, activateCompetitionMode,
} from "@/services/arenaService";
import { adminDb, firebaseAdmin } from "@/lib/firebase-admin";
import { RevolutX } from "@/lib/revolut";
import { loadQuotaGuardUsage, persistQuotaGuardUsage, getQuotaGuardUsage } from '@/lib/revolut';
import { fetchTechnicalDataForTokens, formatTechnicalDataForPrompt, type TechnicalIndicators } from '@/lib/technicals';
import { fetchOrderBooksForTokens, formatOrderBookForPrompt, type OrderBookData } from '@/lib/orderbook';
import { checkEODHDQuota } from '@/lib/eodhd-quota';
import { deployFromDcaReserve } from '@/services/arenaService';

// ═══════════════════════════════════════════════════════════════════════════
// COMMON UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

function safeNumber(val: any, fallback: number = 0): number {
  const num = Number(val);
  return isNaN(num) || !isFinite(num) ? fallback : num;
}

/**
 * Robustly parse JSON from an AI response:
 * 1. Strip markdown code fences
 * 2. Remove illegal control characters (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) that
 *    AI models sometimes embed inside string values, causing JSON.parse to throw
 *    "Bad control character in string literal"
 * 3. Remove trailing commas before } or ]
 * 4. Extract the first {...} or [...] block
 */
function safeJsonParse<T = any>(raw: string): T {
  // 1. Strip markdown fences
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 2. Remove ALL bare control characters (0x00–0x1F and 0x7F).
  //    This includes \n, \r, \t which are legal JSON *structural* whitespace
  //    but are ILLEGAL inside JSON string values when unescaped.
  //    Since JSON is whitespace-insensitive between tokens, replacing with
  //    a space is safe everywhere — structural whitespace → space, and
  //    embedded string newlines → space (cleaner than crashing).
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1F\x7F]/g, ' ');

  // 3. Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // 4. Extract first complete JSON object or array
  const match = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!match) throw new Error('No JSON object found in AI response');

  return JSON.parse(match[0]) as T;
}


function smartPrice(price: number): string {
  if (!price || price <= 0) return "0";
  if (price >= 1) return price.toFixed(2);
  const decimals = Math.max(2, Math.ceil(-Math.log10(price)) + 3);
  return price.toFixed(Math.min(decimals, 12));
}

// ═══════════════════════════════════════════════════════════════════════════
// TICKER MAPS (CoinGecko ID resolution)
// ═══════════════════════════════════════════════════════════════════════════

const TICKER_MAP: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
  'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
  'DOGE': 'dogecoin', 'SHIB': 'shiba-inu', 'LTC': 'litecoin', 'NEAR': 'near',
  'HBAR': 'hedera-hashgraph', 'TRX': 'tron', 'BCH': 'bitcoin-cash',
  'XLM': 'stellar', 'CRO': 'crypto-com-chain', 'BNB': 'binancecoin',
  'ICP': 'internet-computer', 'FIL': 'filecoin', 'VET': 'vechain',
  'ATOM': 'cosmos', 'ALGO': 'algorand', 'RENDER': 'render-token',
  'AAVE': 'aave', 'ETC': 'ethereum-classic', 'ONDO': 'ondo-finance',
  'WLD': 'worldcoin-wld', 'QNT': 'quant-network', 'ENA': 'ethena',
  'FLR': 'flare-networks', 'XDC': 'xdce-crowd-sale',
  'BONK': 'bonk', 'SEI': 'sei-network', 'VIRTUAL': 'virtual-protocol',
  'DASH': 'dash', 'XTZ': 'tezos', 'FET': 'fetch-ai', 'CRV': 'curve-dao-token',
  'IP': 'story-protocol', 'CHZ': 'chiliz', 'INJ': 'injective-protocol',
  'PYTH': 'pyth-network', 'TIA': 'celestia', 'JASMY': 'jasmycoin',
  'FLOKI': 'floki', 'LDO': 'lido-dao', 'HNT': 'helium',
  'OP': 'optimism', 'ENS': 'ethereum-name-service', 'AXS': 'axie-infinity',
  'SAND': 'the-sandbox', 'WIF': 'dogwifcoin', 'MANA': 'decentraland',
  'BAT': 'basic-attention-token', 'CVX': 'convex-finance', 'GALA': 'gala',
  'RAY': 'raydium', 'GLM': 'golem', 'TRAC': 'origintrail', 'EGLD': 'elrond-erd-2',
  'BERA': 'berachain', '1INCH': '1inch', 'SNX': 'havven', 'JTO': 'jito-governance-token',
  'KTA': 'kta', 'AMP': 'amp-token', 'LPT': 'livepeer', 'EIGEN': 'eigenlayer',
  'APE': 'apecoin', 'W': 'wormhole', 'YFI': 'yearn-finance', 'ROSE': 'oasis-network',
  'RSR': 'reserve-rights-token', 'ZRX': '0x', 'KSM': 'kusama', 'AKT': 'akash-network',
  'SYRUP': 'maple', 'POL': 'polygon-ecosystem-token',
};

const NAME_MAP: Record<string, string> = {
  'BTC': 'Bitcoin', 'ETH': 'Ethereum', 'SOL': 'Solana',
  'XRP': 'Ripple', 'BNB': 'BNB', 'ADA': 'Cardano',
};

// ═══════════════════════════════════════════════════════════════════════════
// BRAIN STATUS (Dashboard real-time updates)
// ═══════════════════════════════════════════════════════════════════════════

const brainLogBuffer: Map<string, Array<{ text: string; ts: string }>> = new Map();

async function setBrainStatus(userId: string, action: string, metadata?: any) {
  if (!adminDb) return;
  try {
    const now = new Date().toISOString();
    const existing = brainLogBuffer.get(userId) || [];
    const updated = [...existing, { text: action, ts: now }].slice(-30);
    brainLogBuffer.set(userId, updated);

    await adminDb.collection('agent_configs').doc(userId).update({
      brainState: {
        lastActive: now,
        currentAction: action,
        brainLog: updated,
        ...metadata
      }
    });
  } catch (e) {
    console.warn("[Brain Status] Update failed:", e);
  }
}

function resetBrainLog(userId: string) {
  brainLogBuffer.set(userId, []);
}

// ═══════════════════════════════════════════════════════════════════════════
// EODHD PRICING ENGINE
// ═══════════════════════════════════════════════════════════════════════════

const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
const eodhdCache: Map<string, { data: { price: number; change24h: number; volume: number; source: string }; ts: number }> = new Map();
const EODHD_CACHE_TTL_MS = 20_000; // 20s cache for aggressive 3-min refreshes

// ── Quota check delegates to shared module (also used by technicals.ts) ──────
async function checkEODHDUsage() {
  return checkEODHDQuota();
}

export async function getEODHDUsage() {
  return checkEODHDQuota();
}

export async function fetchEODHDPrices(tickers: string[]): Promise<Record<string, { price: number; change24h: number; volume: number; source: string }>> {
  if (!EODHD_API_KEY || tickers.length === 0) return {};

  const usage = await checkEODHDUsage();
  if (usage.pct >= EODHD_CRITICAL_THRESHOLD) return {};

  const effectiveTTL = usage.pct >= EODHD_THROTTLE_THRESHOLD ? 120_000 : EODHD_CACHE_TTL_MS;
  const result: Record<string, { price: number; change24h: number; volume: number; source: string }> = {};
  const now = Date.now();

  const uncached: string[] = [];
  for (const t of tickers) {
    const up = t.toUpperCase();
    const cached = eodhdCache.get(up);
    if (cached && (now - cached.ts) < effectiveTTL) {
      result[up] = cached.data;
    } else {
      uncached.push(up);
    }
  }

  if (uncached.length === 0) return result;

  const CHUNK_SIZE = 45;
  const chunks: string[][] = [];
  for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
    chunks.push(uncached.slice(i, i + CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    try {
      const EODHD_TICKER_ALIAS: Record<string, string> = { 'POL': 'MATIC' };
      const reverseAlias: Record<string, string> = {};
      const eodhTickers = chunk.map(t => {
        const aliased = EODHD_TICKER_ALIAS[t] || t;
        if (aliased !== t) reverseAlias[aliased] = t;
        return `${aliased}-USD.CC`;
      });
      const primary = eodhTickers[0];
      const extras = eodhTickers.slice(1).join(',');
      const url = `https://eodhd.com/api/real-time/${primary}?${extras ? `s=${extras}&` : ''}api_token=${EODHD_API_KEY}&fmt=json`;

      const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } });
      if (!res.ok) continue;

      let data = await res.json();
      if (!Array.isArray(data)) data = [data];

      for (const item of data) {
        if (!item.code || item.close === 'NA' || item.close === undefined) continue;
        let ticker = item.code.replace('-USD.CC', '');
        if (reverseAlias[ticker]) ticker = reverseAlias[ticker];
        const price = parseFloat(item.close);
        if (isNaN(price) || price <= 0) continue;

        const prevClose = parseFloat(item.previousClose);
        const change24h = (!isNaN(prevClose) && prevClose > 0)
          ? ((price - prevClose) / prevClose) * 100
          : (parseFloat(item.change_p) || 0);

        const entry = { price, change24h, volume: parseFloat(item.volume) || 0, source: 'EODHD' };
        result[ticker] = entry;
        eodhdCache.set(ticker, { data: entry, ts: now });
      }
    } catch (e: any) {
      console.warn('[EODHD] Batch fetch failed:', e.message);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// COINGECKO / BINANCE / COINCAP FALLBACKS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchBinanceData(ticker: string) {
  try {
    const symbol = `${ticker}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, {
      headers: COMMON_HEADERS, cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      price: parseFloat(data.lastPrice) || 0,
      change24h: parseFloat(data.priceChangePercent) || 0,
    };
  } catch { return null; }
}

const COINCAP_ID_MAP: Record<string, string> = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
  'XRP': 'xrp', 'DOT': 'polkadot', 'AVAX': 'avalanche', 'LINK': 'chainlink',
  'DOGE': 'dogecoin', 'LTC': 'litecoin', 'BCH': 'bitcoin-cash',
};

async function fetchCoinCapPrice(ticker: string): Promise<{ price: number; change24h: number } | null> {
  const ccId = COINCAP_ID_MAP[ticker.toUpperCase()];
  if (!ccId) return null;
  try {
    const res = await fetch(`https://api.coincap.io/v2/assets/${ccId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      price: parseFloat(data.data?.priceUsd) || 0,
      change24h: parseFloat(data.data?.changePercent24Hr) || 0,
    };
  } catch { return null; }
}

function priceConsensus(
  sources: { name: string; price: number; change24h: number }[]
): { price: number; change24h: number; source: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } {
  if (sources.length === 0) return { price: 0, change24h: 0, source: 'NONE', confidence: 'LOW' };
  if (sources.length === 1) return { ...sources[0], source: sources[0].name, confidence: 'LOW' };
  if (sources.length === 2) {
    const avg = (sources[0].price + sources[1].price) / 2;
    const div = Math.abs(sources[0].price - sources[1].price) / avg;
    if (div > 0.10) return { price: sources[0].price, change24h: sources[0].change24h, source: `${sources[0].name} (divergence)`, confidence: 'LOW' };
    return { price: avg, change24h: (sources[0].change24h + sources[1].change24h) / 2, source: `${sources[0].name}+${sources[1].name}`, confidence: 'MEDIUM' };
  }
  // 3+ sources: median
  const sorted = [...sources].sort((a, b) => a.price - b.price);
  const median = sorted[Math.floor(sorted.length / 2)];
  return { price: median.price, change24h: median.change24h, source: `Consensus(${sources.length})`, confidence: 'HIGH' };
}

export async function getRealTimePrice(ticker: string) {
  try {
    const tickerUpper = ticker.toUpperCase();
    // 1. Try EODHD first
    const eodhd = await fetchEODHDPrices([tickerUpper]);
    if (eodhd[tickerUpper]?.price > 0) {
      return {
        price: eodhd[tickerUpper].price,
        change24h: eodhd[tickerUpper].change24h,
        mcap: 0,
        name: tickerUpper,
        verificationStatus: 'EODHD'
      };
    }
    // 2. CoinGecko fallback
    const cgId = TICKER_MAP[tickerUpper] || ticker.toLowerCase();
    try {
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/${cgId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, {
        headers: COMMON_HEADERS, cache: 'no-store'
      });
      if (cgRes.ok) {
        const d = await cgRes.json();
        if (d?.market_data?.current_price?.usd > 0) {
          return {
            price: d.market_data.current_price.usd,
            change24h: d.market_data.price_change_percentage_24h ?? 0,
            mcap: d.market_data.market_cap?.usd ?? 0,
            name: d.name,
            verificationStatus: 'CoinGecko'
          };
        }
      }
    } catch { }
    // 3. Binance fallback
    const bin = await fetchBinanceData(tickerUpper);
    if (bin && bin.price && bin.price > 0) {
      return { price: bin.price, change24h: bin.change24h ?? 0, mcap: 0, name: tickerUpper, verificationStatus: 'Binance' };
    }
    return null;
  } catch { return null; }
}

export async function getVerifiedPrices(tickers: string[]) {
  const result: Record<string, { price: number; change24h: number; mcap: number; source: string }> = {};
  // Batch EODHD first
  const eodhd = await fetchEODHDPrices(tickers);
  for (const t of tickers) {
    const up = t.toUpperCase();
    if (eodhd[up]?.price > 0) {
      result[up] = { price: eodhd[up].price, change24h: eodhd[up].change24h, mcap: 0, source: 'EODHD' };
    }
  }
  // Fallback for missing
  const missing = tickers.filter(t => !result[t.toUpperCase()]);
  for (const t of missing) {
    const data = await getRealTimePrice(t);
    if (data) {
      result[t.toUpperCase()] = { price: data.price, change24h: data.change24h, mcap: data.mcap, source: data.verificationStatus };
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL MARKET STATS
// ═══════════════════════════════════════════════════════════════════════════

export async function getGlobalMarketStats() {
  try {
    const [cpRes, fngRes] = await Promise.all([
      fetch('https://api.coinpaprika.com/v1/global', { cache: 'no-store' }),
      fetch('https://api.alternative.me/fng/?limit=1', { cache: 'no-store' })
    ]);
    let marketCap = 0, marketCapChange24h = 0;
    if (cpRes.ok) {
      const cpData = await cpRes.json();
      marketCap = cpData.market_cap_usd || 0;
      marketCapChange24h = cpData.market_cap_change_24h || 0;
    }
    let fearGreedIndex = 50, fearGreedStatus = 'Neutral';
    if (fngRes.ok) {
      const fngData = await fngRes.json();
      fearGreedIndex = parseInt(fngData.data[0].value);
      fearGreedStatus = fngData.data[0].value_classification;
    }
    return { marketCap, marketCapChange24h, fearGreedIndex, fearGreedStatus, updatedAt: new Date().toISOString() };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI CRYPTO ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeCryptoForPool(
  ticker: string,
  poolStrategy: PoolStrategy,
  poolContext: string,
  tradeMemory: string,
  preFetchedData?: { price: number; change24h: number; mcap: number; name: string },
  technicals?: TechnicalIndicators | null,
  orderBook?: OrderBookData | null,
  recentScores?: { score: number; ts: string }[],
): Promise<CryptoAnalysisResult> {
  const realTimeData = preFetchedData || await getRealTimePrice(ticker);

  const groundingContext = realTimeData
    ? `GROUND TRUTH DATA: Price: $${smartPrice(realTimeData.price)}. 24h: ${realTimeData.change24h?.toFixed(2)}%. Market Cap: $${realTimeData.mcap?.toLocaleString()}.`
    : "LIVE PRICING UNAVAILABLE. DO NOT TRADE.";

  // Real computed technical data (replaces hallucinated indicators)
  const techSection = technicals
    ? formatTechnicalDataForPrompt(technicals)
    : '  TECHNICAL DATA: Unavailable this cycle. Use price action only.';

  const obSection = orderBook
    ? formatOrderBookForPrompt(orderBook)
    : '';

  // ─── SCORE HISTORY CONTEXT ──────────────────────────────────────────
  // Shows the AI its own recent scores so it can see oscillation patterns
  const scoreHistoryContext = (recentScores && recentScores.length > 0)
    ? recentScores.slice(-5).map(s => {
      const ago = Math.round((Date.now() - new Date(s.ts).getTime()) / (1000 * 60));
      return `Score ${s.score} (${ago}min ago)`;
    }).join(' → ')
    : 'No previous scores. This is the first evaluation.';

  // ─── PERSONALITY-AWARE INSTRUCTIONS ─────────────────────────────────
  // Different pools get different scoring guidance based on their strategy type
  const personality = poolStrategy.strategyPersonality || 'MODERATE';
  const personalityInstructions = personality === 'PATIENT'
    ? `⚠️ STRATEGY: PATIENT ACCUMULATOR
  - You are a PATIENT trader. Your goal is to find HIGH-CONVICTION entries and HOLD them.
  - Prefer HOLDING winners. Only exit on STRONG bearish confirmation (RSI < 30 + below both MAs + sell pressure).
  - If a position is profitable and momentum is intact, score HIGH to keep holding.
  - Do NOT exit just because RSI is slightly overbought or price dipped 1-2%. These are normal fluctuations.
  - Only score below ${poolStrategy.exitThreshold} if the TREND has genuinely reversed, not just paused.
  - A declining position with no reversal signal: score LOW. But a flat/slightly positive position: score MID-HIGH to hold.`
    : personality === 'AGGRESSIVE'
      ? `⚠️ STRATEGY: AGGRESSIVE TRADER
  - You are an AGGRESSIVE trader. Your goal is quick, decisive trades with tight exits.
  - Be DECISIVE. No mid-range scores (50-65) — commit to BUY (70+) or SELL (below 40).
  - If momentum is fading even slightly, score LOW immediately to exit.
  - Profit is realized by SELLING at a gain. Don't hold hoping for more — take what the market gives.
  - Every hour holding a flat position is wasted capital that could be redeployed.
  - Move fast: if technicals weaken, score BELOW ${poolStrategy.exitThreshold} immediately.`
      : `⚠️ STRATEGY: BALANCED TRADER
  - You are a BALANCED trader. Your goal is to catch momentum moves and ride them.
  - If HOLDING a profitable position: continue holding if momentum supports it. Exit if momentum fades.
  - If HOLDING a losing position: be patient if the thesis is intact. Exit if the trend has reversed.
  - Profit requires both good entries AND well-timed exits.
  - Don't hold forever — but don't exit on noise either. Wait for genuine technical changes.
  - A declining position with no reversal signal should score BELOW ${poolStrategy.exitThreshold} to force a sell.`;

  const prompt = `
  ROLE: You are an elite AI Crypto Trader controlling a competition pool. Your ONLY goal is maximum profit over 28 days.

  ═══════════════════════════════════════════════════════
  MARKET DATA (GROUND TRUTH — DO NOT CONTRADICT THESE VALUES)
  ═══════════════════════════════════════════════════════
  ${groundingContext}

  ${techSection}
  ${obSection}

  ═══════════════════════════════════════════════════════
  POOL CONTEXT
  ═══════════════════════════════════════════════════════
  ${poolContext}

  POOL STRATEGY:
  ${poolStrategy.description}
  - Buy Threshold: ${poolStrategy.buyScoreThreshold}
  - Exit Threshold: ${poolStrategy.exitThreshold}
  - Momentum Gate: ${poolStrategy.momentumGateEnabled ? `Enabled (${poolStrategy.momentumGateThreshold}%)` : 'Disabled'}
  - Position Stop-Loss: ${poolStrategy.positionStopLoss}%
  - Take-Profit Target: +${poolStrategy.takeProfitTarget || 3}%
  - Trailing Stop: ${poolStrategy.trailingStopPct || 2}% from peak
  - Max Allocation/Token: $${poolStrategy.maxAllocationPerToken}

  ═══════════════════════════════════════════════════════
  TRADE MEMORY (YOUR PAST DECISIONS & OUTCOMES)
  ═══════════════════════════════════════════════════════
  ${tradeMemory || 'No previous trades yet. This is a fresh start.'}

  DATE: ${new Date().toLocaleDateString('en-GB')} (Day ${getDayNumber()} of 28)

  ═══════════════════════════════════════════════════════
  SCORE HISTORY (YOUR PREVIOUS SCORES FOR THIS TOKEN)
  ═══════════════════════════════════════════════════════
  ${scoreHistoryContext}

  ═══════════════════════════════════════════════════════
  ANALYSIS INSTRUCTIONS
  ═══════════════════════════════════════════════════════
  Use the COMPUTED TECHNICAL INDICATORS above as PRIMARY input for your signals.
  These are calculated from real 1-hour candle data — DO NOT contradict them.
  
  KEY RULES:
  - RSI > 70 = overbought (caution on new buys). RSI < 30 = oversold (potential dip entry).
  - Price ABOVE SMA7 AND SMA25 = bullish structure. BELOW both = bearish.
  - MACD BULLISH + high volume ratio = strong momentum confirmation.
  - Buy/Sell pressure ratio from the order book indicates immediate supply/demand.
  - 3d/7d changes reveal the medium-term trend — don't chase a single green day in a red week.

  ${personalityInstructions}

  SCORING BASED ON REAL DATA:
  - 0-39: SELL IMMEDIATELY. Bearish on all timeframes, no recovery signal.
  - 40-54: WEAK. Likely should exit unless strong reversal signal is forming.
  - 55-64: Mixed signals. Be cautious with new entries.
  - 65-79: Technicals improving. Good for new entries if strategy supports it.
  - 80-89: Strong bullish alignment — confident entry territory.
  - 90-100: Exceptional setup — maximum conviction.

  ⚠️ SCORE CONSISTENCY:
  - Review your SCORE HISTORY above. If your scores are oscillating (e.g. 62→47→63→48), the market is ambiguous.
  - In ambiguous conditions: if HOLDING, lean toward your previous score direction. If NOT holding, lean toward NOT entering.
  - Only change your score direction by 20+ points if there is a genuine change in the technicals, not just noise.
  
  Learn from past trades. Similar setup → loss before? Be more cautious.
  Similar setup → win before? Have more confidence.

  OUTPUT JSON (respond with ONLY valid JSON):
  {
    "ticker": "${ticker}",
    "name": "Token Name",
    "currentPrice": (from GROUND TRUTH),
    "priceChange24h": (from GROUND TRUTH),
    "trafficLight": "RED" | "AMBER" | "GREEN",
    "overallScore": (0-100),
    "entryType": "MOMENTUM" | "DIP_RECOVERY" | "BREAKOUT" | "ACCUMULATION",
    "summary": "2-3 sentences referencing the ACTUAL technical data (RSI value, MA positions, volume ratio, order book pressure) and your decision.",
    "signals": [
      {"name": "RSI(14)", "score": (map RSI 0-100 to a conviction score), "status": "RED"|"AMBER"|"GREEN"},
      {"name": "Trend & MAs", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
      {"name": "Volume & Liquidity", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
      {"name": "Order Flow", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
      {"name": "Multi-Day Momentum", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"}
    ]
  }`;

  const responseText = await generateContentWithFallback(prompt);
  if (!responseText) throw new Error("AI returned empty response");

  const aiResult = safeJsonParse(responseText);

  if (!realTimeData || !realTimeData.price || realTimeData.price <= 0) {
    throw new Error(`LIVE PRICING UNAVAILABLE for ${ticker}`);
  }

  return {
    ...aiResult,
    ticker: ticker.toUpperCase(),
    currentPrice: safeNumber(realTimeData.price),
    priceChange24h: safeNumber(realTimeData.change24h ?? 0),
    marketCap: safeNumber(realTimeData.mcap ?? 0),
    overallScore: safeNumber(aiResult.overallScore),
    verificationStatus: 'EODHD',
  } as CryptoAnalysisResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI STRATEGY INTELLIGENCE REPORT
// ═══════════════════════════════════════════════════════════════════════════

export interface TokenPrediction {
  token: string;
  bias: 'BULLISH' | 'NEUTRAL_TO_BULLISH' | 'NEUTRAL' | 'NEUTRAL_TO_BEARISH' | 'BEARISH';
  priceRangeLow: number;
  priceRangeHigh: number;
  keyLevelToWatch: number;
  rationale: string;
  triggerToReassess: string;
}

export interface StrategyReport {
  generatedAt: string;
  reportType: 'MORNING' | 'EVENING';
  overallNAV: number;
  overallPnl: number;
  overallPnlPct: number;
  overallVsBtc: number; // portfolio P&L minus BTC 24h change
  leaderPool: string;
  laggardPool: string;
  poolAnalyses: Array<{
    poolId: string;
    poolName: string;
    emoji: string;
    nav: number;
    pnlPct: number;
    vsBtc: number;  // pool P&L minus BTC 24h change
    trades: number;
    wins: number;
    losses: number;
    tokens: string[];
    assessment: string;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    keyInsight: string;
  }>;
  comparativeAnalysis: string;
  marketOutlook: string;
  recommendations: string[];
  riskAlerts: string[];
  predictions: TokenPrediction[];
  campaignProgress: string;
}

export async function generateStrategyReport(userId: string): Promise<StrategyReport | null> {
  if (!adminDb) return null;

  const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
  const arena = arenaDoc.data() as ArenaConfig;
  if (!arena?.initialized) return null;

  const isMorning = new Date().getUTCHours() < 14; // Before 2pm UTC = morning report
  const reportType: 'MORNING' | 'EVENING' = isMorning ? 'MORNING' : 'EVENING';
  const dayNum = getDayNumber();
  const weekNum = getCurrentWeek();

  // Fetch prices, trades, and — crucially — real technical indicator data
  const allTokens = new Set<string>(['BTC']);
  arena.pools.forEach(p => p.tokens.forEach(t => allTokens.add(t.toUpperCase())));
  const heldTokens = arena.pools.flatMap(p => Object.keys(p.holdings).map(t => t.toUpperCase()));
  const uniqueHeld = [...new Set(heldTokens)];

  const [prices, technicals, allTrades] = await Promise.all([
    getVerifiedPrices([...allTokens]),
    fetchTechnicalDataForTokens(uniqueHeld, Object.fromEntries(
      [...allTokens].map(t => [t, { price: 0 }]) // prices fetched below, use empty initially
    )),
    Promise.all(arena.pools.map(p => getArenaTrades(userId, p.poolId))),
  ]);

  // Re-fetch technicals with real prices
  const priceMap: Record<string, { price: number }> = {};
  for (const t of allTokens) priceMap[t] = { price: prices[t]?.price || 0 };
  const technicalsReal = await fetchTechnicalDataForTokens(uniqueHeld, priceMap);

  const btcPrice = prices['BTC']?.price || 0;
  const btcChange = prices['BTC']?.change24h || 0;

  const poolSummaries = arena.pools.map((pool, idx) => {
    let holdVal = 0;
    for (const [t, h] of Object.entries(pool.holdings)) {
      holdVal += h.amount * (prices[t.toUpperCase()]?.price || h.averagePrice);
    }
    const nav = pool.cashBalance + holdVal;
    const pnl = nav - pool.budget;
    const pnlPct = pool.budget > 0 ? (pnl / pool.budget) * 100 : 0;
    const vsBtc = pnlPct - btcChange; // alpha vs holding BTC
    const poolTrades = allTrades[idx] || [];
    const sells = poolTrades.filter(t => t.type === 'SELL');
    const wins = sells.filter(t => (t.pnl || 0) >= 0).length;
    const losses = sells.filter(t => (t.pnl || 0) < 0).length;
    const todayTrades = poolTrades.filter(t => {
      const d = new Date(t.date || 0);
      const now = new Date();
      return d.toDateString() === now.toDateString();
    }).length;

    const holdingsStr = Object.entries(pool.holdings)
      .map(([t, h]) => {
        const pr = prices[t.toUpperCase()]?.price || h.averagePrice;
        const hPnl = ((pr - h.averagePrice) / h.averagePrice * 100).toFixed(1);
        const tech = technicalsReal[t.toUpperCase()];
        const techSummary = tech ? ` [RSI:${tech.rsi14.toFixed(0)} MACD:${tech.macdSignal} Trend:${tech.trendDirection}]` : '';
        return `${t}: ${h.amount.toFixed(4)} @ $${h.averagePrice.toFixed(4)} (now $${pr.toFixed(4)}, ${parseFloat(hPnl) >= 0 ? '+' : ''}${hPnl}%)${techSummary}`;
      }).join('\n      ') || 'Cash only';

    const recentTrades = poolTrades.slice(0, 5).map(t =>
      `${t.type} ${t.ticker} $${t.total.toFixed(2)} ${t.pnlPct !== undefined ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%` : ''}`
    ).join(' | ') || 'No trades yet';

    return {
      poolId: pool.poolId, name: pool.name, emoji: pool.emoji,
      tokens: pool.tokens, strategy: pool.strategy.description,
      nav, pnlPct, vsBtc, totalTrades: poolTrades.length, todayTrades,
      wins, losses, cash: pool.cashBalance,
      holdingsStr, recentTrades,
      stopLoss: pool.strategy.positionStopLoss,
      takeProfitTarget: pool.strategy.takeProfitTarget,
      minHoldMinutes: pool.strategy.minHoldMinutes,
    };
  });

  const totalNAV = poolSummaries.reduce((s, p) => s + p.nav, 0);
  const totalPnl = totalNAV - arena.totalBudget;
  const totalPnlPct = arena.totalBudget > 0 ? (totalPnl / arena.totalBudget) * 100 : 0;
  const overallVsBtc = totalPnlPct - btcChange;

  // Build technical data block for all held tokens
  const techBlock = uniqueHeld.map(t => {
    const tech = technicalsReal[t];
    if (!tech) return `${t}: No technical data available`;
    return formatTechnicalDataForPrompt(tech);
  }).join('\n\n');

  // Campaign trajectory estimate
  const daysLeft = Math.max(1, 28 - dayNum);
  const dailyRate = dayNum > 1 ? totalPnlPct / dayNum : totalPnlPct;
  const projectedFinal = totalPnlPct + (dailyRate * daysLeft);

  // Risk alert conditions (hard-coded thresholds — no AI discretion)
  const hardRiskAlerts: string[] = [];
  for (const p of poolSummaries) {
    if (p.pnlPct < -5) hardRiskAlerts.push(`${p.emoji} ${p.name} is down ${p.pnlPct.toFixed(1)}% vs budget — approaching significant loss threshold.`);
    if (p.todayTrades > 15) hardRiskAlerts.push(`${p.emoji} ${p.name} has executed ${p.todayTrades} trades today — churn rate is too high.`);
    const consecutiveLosses = (() => { let c = 0; for (const t of (allTrades[arena.pools.indexOf(arena.pools.find(ap => ap.poolId === p.poolId)!)] || []).filter(t => t.type === 'SELL')) { if ((t.pnl || 0) < 0) c++; else break; } return c; })();
    if (consecutiveLosses >= 5) hardRiskAlerts.push(`${p.emoji} ${p.name} has ${consecutiveLosses} consecutive losing trades.`);
  }
  if (totalPnlPct < -4) hardRiskAlerts.push(`Portfolio NAV is down ${totalPnlPct.toFixed(1)}% — approaching 4% drawdown threshold.`);
  if (btcChange < -5) hardRiskAlerts.push(`BTC dropped ${btcChange.toFixed(1)}% in 24h — systemic market shock in progress.`);

  const morningSpecific = isMorning ? `
TODAY'S SESSION FOCUS (Morning Report):
You are generating the MORNING BRIEFING. Focus on:
1. What to WATCH for today — which tokens are at critical levels?
2. Are any positions at risk of hitting stop-loss today given current overnight moves?
3. What conditions would trigger a re-evaluation of each position?
4. Provide forward-looking 24h price bias for each held token.
` : `
TODAY'S SESSION REVIEW (Evening Report):
You are generating the EVENING BRIEFING. Focus on:
1. What HAPPENED today — was today's performance better or worse than expected?
2. Did the patience regime hold? (< 5 trades per pool = good)
3. Which positions are maturing well vs which need monitoring?
4. Set expectations for overnight and tomorrow morning.
`;

  const prompt = `You are the Chief Strategy Analyst for the Semaphore Arena — a 28-day crypto trading competition with 4 AI-managed pools, each running under a strict "Patience Not Activity" regime:
- Minimum hold: ${arena.pools[0]?.strategy.minHoldMinutes || 360} minutes
- Buy threshold: Score ≥ 85+ (high conviction only)
- Take-profit: +8% minimum
- Stop-loss: -8% maximum
- Anti-wash: 24h between selling and rebuying the same token

TODAY: ${new Date().toLocaleDateString('en-GB')} (Day ${dayNum}/28, Week ${weekNum}/4)
REPORT TYPE: ${reportType}
BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}% 24h)
MARKET BENCHMARK: ${btcChange.toFixed(2)}% (any pool beating this is outperforming the market)
TOTAL NAV: $${totalNAV.toFixed(2)} vs budget $${arena.totalBudget} = ${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}% (${overallVsBtc >= 0 ? 'OUTPERFORMING' : 'UNDERPERFORMING'} BTC by ${Math.abs(overallVsBtc).toFixed(2)}%)
COMPETITION TRAJECTORY: At current pace (${dailyRate.toFixed(2)}%/day), projected 28-day outcome: ${projectedFinal >= 0 ? '+' : ''}${projectedFinal.toFixed(1)}%
${morningSpecific}
POOL PERFORMANCE (all P&L shown vs budget AND vs BTC benchmark):
${poolSummaries.map(p => `
${p.emoji} ${p.name} (${p.poolId})
  Strategy: ${p.strategy}
  Tokens: ${p.tokens.join(', ')}
  NAV: $${p.nav.toFixed(2)} | P&L: ${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}% | vs BTC: ${p.vsBtc >= 0 ? '+' : ''}${p.vsBtc.toFixed(2)}% (${p.vsBtc >= 0 ? 'ALPHA' : 'LAGGING'})
  Trades today: ${p.todayTrades} | Total trades: ${p.totalTrades} (${p.wins}W/${p.losses}L)
  Cash: $${p.cash.toFixed(2)}
  Holdings with technicals:
      ${p.holdingsStr}
  Recent activity: ${p.recentTrades}
`).join('\n')}
REAL TECHNICAL INDICATORS (computed from live 1h OHLCV candle data):
${techBlock || 'No technical data available for current holdings.'}

GRADING RUBRIC — grades MUST be relative to BTC's 24h move of ${btcChange.toFixed(1)}%:
A: Pool outperforms BTC by >2% OR Pool P&L is positive when BTC is negative
B: Pool outperforms BTC by 0–2% OR Pool P&L is within 0.5% of BTC performance
C: Pool underperforms BTC by 0–2% (slightly worse than market)
D: Pool underperforms BTC by 2–5% (meaningfully worse than market)
F: Pool underperforms BTC by >5% (severe underperformance)
NOTE: On a day where BTC = ${btcChange.toFixed(1)}%, a pool at ${(btcChange + 1).toFixed(1)}% gets an A, not a C.

RISK ALERT RULES — Return an EMPTY riskAlerts array UNLESS at least one of these specific conditions is met:
1. A pool is down MORE than 5% vs its own budget (not market — absolute portfolio loss)
2. A pool has executed more than 15 trades in the current calendar day (churn)
3. A pool has 5+ consecutive losing trades
4. Total portfolio NAV is down more than 4% from starting $${arena.totalBudget}
5. BTC has dropped more than 5% in 24h
DO NOT generate alerts for: losses under 3%, normal crypto volatility, general market uncertainty, or any condition not in this list.

Respond with ONLY valid JSON:
{
  "poolAnalyses": [
    {
      "poolId": "POOL_X",
      "assessment": "3-4 sentences analysing performance using the technical data provided. Reference RSI, MACD, trend direction, and support/resistance levels specifically.",
      "grade": "A/B/C/D/F (must follow the BTC-relative rubric above)",
      "keyInsight": "One standout forward-looking observation"
    }
  ],
  "comparativeAnalysis": "4-6 sentences comparing pools, referencing which tokens show the strongest technical setups and why. Use the indicator data.",
  "marketOutlook": "2-3 sentences on market environment with specific technical observations from the data provided (RSI levels, trends, BTC position).",
  "recommendations": ["max 3 specific recommendations — must reference actual data points from the technicals, not generic advice"],
  "riskAlerts": ["only include if hard thresholds above are breached — otherwise leave empty array"],
  "predictions": [
    {
      "token": "TICKER",
      "bias": "BULLISH|NEUTRAL_TO_BULLISH|NEUTRAL|NEUTRAL_TO_BEARISH|BEARISH",
      "priceRangeLow": 0.00,
      "priceRangeHigh": 0.00,
      "keyLevelToWatch": 0.00,
      "rationale": "1 sentence using RSI/MACD/support data to justify the range",
      "triggerToReassess": "specific price or indicator condition that would change this outlook"
    }
  ],
  "campaignProgress": "2 sentences on competition trajectory: current pace, whether patience regime is working, and what needs to happen over the remaining ${28 - dayNum} days to achieve a positive outcome."
}`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return null;

    const parsed = safeJsonParse(responseText);

    const leaderIdx = poolSummaries.reduce((b, p, i) => p.pnlPct > (poolSummaries[b]?.pnlPct ?? -Infinity) ? i : b, 0);
    const laggardIdx = poolSummaries.reduce((b, p, i) => p.pnlPct < (poolSummaries[b]?.pnlPct ?? Infinity) ? i : b, 0);

    // Merge hard-coded risk alerts with any AI generated ones (AI should return empty under the new rules)
    const allRiskAlerts = [...hardRiskAlerts, ...(parsed.riskAlerts || [])]
      .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

    const report: StrategyReport = {
      generatedAt: new Date().toISOString(),
      reportType,
      overallNAV: totalNAV,
      overallPnl: totalPnl,
      overallPnlPct: totalPnlPct,
      overallVsBtc,
      leaderPool: poolSummaries[leaderIdx].name,
      laggardPool: poolSummaries[laggardIdx].name,
      poolAnalyses: parsed.poolAnalyses.map((a: any, i: number) => ({
        ...a,
        poolName: poolSummaries[i]?.name || a.poolId,
        emoji: poolSummaries[i]?.emoji || '📊',
        nav: poolSummaries[i]?.nav || 0,
        pnlPct: poolSummaries[i]?.pnlPct || 0,
        vsBtc: poolSummaries[i]?.vsBtc || 0,
        trades: poolSummaries[i]?.totalTrades || 0,
        wins: poolSummaries[i]?.wins || 0,
        losses: poolSummaries[i]?.losses || 0,
        tokens: poolSummaries[i]?.tokens || [],
      })),
      comparativeAnalysis: parsed.comparativeAnalysis,
      marketOutlook: parsed.marketOutlook,
      recommendations: parsed.recommendations || [],
      riskAlerts: allRiskAlerts,
      predictions: (parsed.predictions || []) as TokenPrediction[],
      campaignProgress: parsed.campaignProgress || '',
    };

    // Persist to Firestore
    await adminDb.collection('arena_reports').doc(userId).set({
      ...report,
      updatedAt: new Date().toISOString(),
    });

    console.log(`[Arena] 📊 ${reportType} strategy report generated. Leader: ${report.leaderPool} | vs BTC: ${overallVsBtc >= 0 ? '+' : ''}${overallVsBtc.toFixed(2)}%`);
    return report;
  } catch (e: any) {
    console.error(`[Arena] Report generation failed: ${e.message}`);
    return null;
  }
}

export async function getLatestStrategyReport(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<StrategyReport | null> {
  if (!adminDb) return null;
  try {
    const collection = assetClass === 'CRYPTO' ? 'arena_reports' : `arena_reports_${assetClass.toLowerCase()}`;
    const doc = await adminDb.collection(collection).doc(userId).get();
    return doc.exists ? (doc.data() as StrategyReport) : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// ARENA ENGINE — Core Trading Logic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a single arena cycle: analyze all pool tokens, make trading decisions.
 * Called every 3 minutes by the arena cron.
 */
export async function runArenaCycle(userId: string): Promise<{
  success: boolean;
  poolResults: Array<{ poolId: string; trades: number; value: number; pnlPct: number }>;
  totalTrades: number;
}> {
  if (!adminDb) return { success: false, poolResults: [], totalTrades: 0 };

  const arena = await getArenaConfig(userId);
  if (!arena?.initialized) {
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  if (!isArenaActive()) {
    console.log('[Arena] Competition period not active.');
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  resetBrainLog(userId);
  await setBrainStatus(userId, '🏟️ Arena cycle starting...');

  // 1. Fetch all token prices in one batch
  const allTokens = new Set<string>();
  for (const pool of arena.pools) {
    pool.tokens.forEach(t => allTokens.add(t.toUpperCase()));
  }
  allTokens.add('BTC'); // Always track BTC for context

  // Fetch prices, technicals, orderbooks, and market stats in parallel
  const tokenList = [...allTokens];
  const [prices, marketStats, techData, orderBooks] = await Promise.all([
    getVerifiedPrices(tokenList),
    getGlobalMarketStats(),
    fetchTechnicalDataForTokens(tokenList, {}), // prices not ready yet, candles are price-independent
    fetchOrderBooksForTokens(tokenList.filter(t => t !== 'BTC')), // no BTC orderbook needed
  ]);

  const btcPrice = prices['BTC']?.price || 0;
  const btcChange = prices['BTC']?.change24h || 0;
  const fng = marketStats?.fearGreedIndex || 50;

  // Now recompute technicals with actual prices (candles were cached from parallel fetch)
  const techDataWithPrices = await fetchTechnicalDataForTokens(tokenList, prices);

  const techCount = Object.keys(techDataWithPrices).length;
  const obCount = Object.keys(orderBooks).length;
  await setBrainStatus(userId, `📊 Loaded: ${allTokens.size} prices, ${techCount} tech profiles, ${obCount} order books. BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}%)`);

  // 3. Process each pool
  const poolResults: Array<{ poolId: string; trades: number; value: number; pnlPct: number }> = [];
  let totalTrades = 0;

  for (const pool of arena.pools) {
    if (pool.status !== 'ACTIVE') {
      poolResults.push({ poolId: pool.poolId, trades: 0, value: getPoolTotalValue(pool, prices), pnlPct: pool.performance.totalPnlPct });
      continue;
    }

    await setBrainStatus(userId, `${pool.emoji} Processing ${pool.name}...`);

    // 3.1 Dynamic strategy review — AI can change its own strategy whenever needed
    //     Triggers: weekly boundary, OR 5+ trades since last review, OR P&L dropped 3%+ since last review
    if (isDynamicReviewDue(pool)) {
      await setBrainStatus(userId, `${pool.emoji} 🧠 AI Strategy Review for ${pool.name}...`);
      await performWeeklyReview(userId, pool, prices, fng);
    }

    // 3.2 Analyze each token in the pool
    const poolTrades: ArenaTradeRecord[] = [];

    // ── Phase A: collect buy signals ────────────────────────────────────
    // Sells execute immediately within the loop (they free cash).
    // Buys are deferred to Phase B so we can size them proportionally
    // using conviction (score²) weighting across all candidates.
    const pendingBuys: Array<{
      ticker: string;
      smoothedScore: number;
      price: number;
      buyAmount: number; // units, sized in Phase B
      reflection: string;
      marketContext: { btcPrice: number; btcChange24h: number; tokenChange24h: number; fearGreedIndex: number };
    }> = [];

    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const priceData = prices[upper];
      if (!priceData || priceData.price <= 0) continue;

      // ─── EVALUATION COOLDOWN ────────────────────────────────────────
      // Prevent re-scoring the same token too frequently (AI-controllable per pool)
      const evalCooldownMinutes = pool.strategy.evaluationCooldownMinutes ?? 15;
      const lastEval = pool.lastEvaluatedAt?.[upper];
      if (lastEval) {
        const minSinceEval = (Date.now() - new Date(lastEval).getTime()) / (1000 * 60);
        if (minSinceEval < evalCooldownMinutes) {
          // Skip evaluation this cycle — not enough time has passed
          continue;
        }
      }

      // Get trade history for learning context (may fail if index not ready)
      let tradeMemory = '';
      try {
        const reflections = await getTradeReflections(userId, pool.poolId, upper, 10);
        tradeMemory = reflections.length > 0
          ? reflections.map(r => {
            const outcome = r.outcome ? ` → ${r.outcome.pnl >= 0 ? 'WIN' : 'LOSS'} ${r.outcome.pnlPct.toFixed(1)}% (held ${r.outcome.holdDurationHours.toFixed(0)}h). Lesson: ${r.outcome.lessonLearned}` : '';
            return `${r.type} ${r.ticker} @ $${smartPrice(r.price)} — ${r.reasoning}${outcome}`;
          }).join('\n')
          : '';
      } catch (reflErr: any) {
        console.warn(`[Arena] Reflections unavailable for ${upper}: ${reflErr.message?.substring(0, 80)}`);
      }

      // Build pool context
      const totalValue = getPoolTotalValue(pool, prices);
      const holding = pool.holdings[upper];
      const holdingPnlPct = holding ? ((priceData.price - holding.averagePrice) / holding.averagePrice) * 100 : 0;
      const holdingContext = holding
        ? `Currently HOLDING ${holding.amount.toFixed(6)} ${upper} (avg: $${smartPrice(holding.averagePrice)}, P&L: ${holdingPnlPct >= 0 ? '+' : ''}${holdingPnlPct.toFixed(1)}%, peak P&L: +${(holding.peakPnlPct || 0).toFixed(1)}%). TAKE-PROFIT target: +${pool.strategy.takeProfitTarget || 3}%. You MUST decide: HOLD for more upside or EXIT NOW?`
        : `NOT holding ${upper}. Cash: $${pool.cashBalance.toFixed(2)}. Looking for entry opportunity.`;

      const poolContext = `
Pool: ${pool.emoji} ${pool.name} (${pool.poolId})
Day ${getDayNumber()}/28, Week ${getCurrentWeek()}/4
Total Value: $${totalValue.toFixed(2)} (${pool.performance.totalPnlPct >= 0 ? '+' : ''}${pool.performance.totalPnlPct.toFixed(1)}%)
Cash: $${pool.cashBalance.toFixed(2)} | Budget: $${pool.budget}
${holdingContext}
Win/Loss: ${pool.performance.winCount}W / ${pool.performance.lossCount}L
BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}%)
Fear & Greed: ${fng}/100 (${marketStats?.fearGreedStatus || 'Unknown'})`;

      try {
        // ─── GET SCORE HISTORY for this token ────────────────────────
        const tokenScoreHistory = pool.scoreHistory?.[upper] || [];

        const analysis = await analyzeCryptoForPool(
          upper, pool.strategy, poolContext, tradeMemory,
          { price: priceData.price, change24h: priceData.change24h, mcap: priceData.mcap || 0, name: NAME_MAP[upper] || upper },
          techDataWithPrices[upper] || null,
          orderBooks[upper] || null,
          tokenScoreHistory, // Pass score history to the AI
        );

        // ─── STORE SCORE & UPDATE EVALUATION TIMESTAMP ───────────────
        if (!pool.scoreHistory) pool.scoreHistory = {};
        if (!pool.scoreHistory[upper]) pool.scoreHistory[upper] = [];
        pool.scoreHistory[upper].push({
          score: analysis.overallScore,
          ts: new Date().toISOString(),
        });
        // Keep only last 10 scores per token to avoid Firestore bloat
        if (pool.scoreHistory[upper].length > 10) {
          pool.scoreHistory[upper] = pool.scoreHistory[upper].slice(-10);
        }
        // Update evaluation timestamp
        if (!pool.lastEvaluatedAt) pool.lastEvaluatedAt = {};
        pool.lastEvaluatedAt[upper] = new Date().toISOString();

        // ─── SMOOTHED SCORE (average of last 3) ─────────────────────
        // Eliminates single-call LLM noise by averaging recent scores
        const recentScores = pool.scoreHistory[upper].slice(-3).map(s => s.score);
        const smoothedScore = Math.round(
          recentScores.reduce((a, b) => a + b, 0) / recentScores.length
        );

        const marketContext = {
          btcPrice, btcChange24h: btcChange,
          tokenChange24h: priceData.change24h, fearGreedIndex: fng,
        };

        // ─── READ EXECUTION PARAMETERS FROM POOL STRATEGY ────────────
        // These are AI-controllable per pool — no more global constants
        const minHoldMinutes = pool.strategy.minHoldMinutes ?? 120;
        const exitHysteresis = pool.strategy.exitHysteresis ?? 10;
        const buyConfidenceBuffer = pool.strategy.buyConfidenceBuffer ?? 5;

        // Trading decision logic (uses SMOOTHED score)
        if (holding && holding.amount > 0) {
          // ─── SELL EVALUATION (4 exit paths) ───
          const pnlPct = ((priceData.price - holding.averagePrice) / holding.averagePrice) * 100;

          // Update peak tracking for trailing stops
          if (pnlPct > (holding.peakPnlPct || 0)) {
            holding.peakPnlPct = pnlPct;
            holding.peakPrice = Math.max(holding.peakPrice || 0, priceData.price);
          }

          let shouldSell = false;
          let sellReason = '';
          const takeProfitTarget = pool.strategy.takeProfitTarget || 3;
          const trailingStopPct = pool.strategy.trailingStopPct || 2;

          // Min hold time from pool strategy (AI-controllable)
          const holdMinutes = holding.boughtAt
            ? (Date.now() - new Date(holding.boughtAt).getTime()) / (1000 * 60)
            : Infinity;
          const isHoldMature = holdMinutes >= minHoldMinutes;

          // EXIT PATH 1: Hard stop-loss (ALWAYS active)
          if (pnlPct <= pool.strategy.positionStopLoss) {
            shouldSell = true;
            sellReason = `⛔ STOP-LOSS: Position at ${pnlPct.toFixed(1)}% (limit: ${pool.strategy.positionStopLoss}%)`;
          }

          // EXIT PATH 2: Take-profit target hit (ALWAYS active)
          else if (pnlPct >= takeProfitTarget) {
            shouldSell = true;
            sellReason = `💰 TAKE-PROFIT: Position at +${pnlPct.toFixed(1)}% (target: +${takeProfitTarget}%). Locking in gains.`;
          }

          // EXIT PATH 3: Trailing stop (only after minimum hold)
          else if (isHoldMature &&
            (holding.peakPnlPct || 0) >= takeProfitTarget * 0.6 &&
            (holding.peakPnlPct || 0) - pnlPct >= trailingStopPct) {
            shouldSell = true;
            sellReason = `📉 TRAILING STOP: Peak was +${(holding.peakPnlPct || 0).toFixed(1)}%, now +${pnlPct.toFixed(1)}% (dropped ${((holding.peakPnlPct || 0) - pnlPct).toFixed(1)}%, limit: ${trailingStopPct}%)`;
          }

          // EXIT PATH 4: AI exit signal — DISABLED under "Patience Not Activity" regime
          // Positions now ONLY exit via Take-Profit, Stop-Loss, or Trailing Stop.
          // AI score-based exits caused excessive churning due to LLM score noise.
          // else if (isHoldMature && smoothedScore < (pool.strategy.exitThreshold - exitHysteresis)) {
          //   shouldSell = true;
          //   sellReason = `🤖 AI EXIT: Smoothed score ${smoothedScore} ...`;
          // }

          if (shouldSell) {
            const sellAmount = holding.amount * 0.995; // 0.5% slippage buffer
            const revolutResult = await executeRevolutTrade(userId, upper, 'SELL', sellAmount, priceData.price);
            if (revolutResult.success) {
              const actualPrice = revolutResult.fillPrice || priceData.price;
              const result = await executePoolSell(userId, pool, upper, holding.amount, actualPrice, sellReason, marketContext, `${sellReason} | AI: ${analysis.summary}`);
              if (result.success && result.trade) {
                poolTrades.push(result.trade);
                console.log(`[Arena] ${pool.emoji} ${sellReason} | Actual P&L: ${result.pnlPct?.toFixed(2)}%`);
              }
            } else {
              console.warn(`[Arena] ⚠️ Revolut SELL failed for ${upper} — arena state NOT updated`);
            }
          } else {
            // Not selling — log the hold decision for visibility
            const holdStatus = !isHoldMature ? ` ⏳ hold ${holdMinutes.toFixed(0)}/${minHoldMinutes}min` : '';
            await setBrainStatus(userId, `${pool.emoji} 📊 ${upper}: HOLD at ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% (peak: +${(holding.peakPnlPct || 0).toFixed(1)}%, TP: +${takeProfitTarget}%, SL: ${pool.strategy.positionStopLoss}%) — Score: ${smoothedScore} (raw: ${analysis.overallScore})${holdStatus}`);
          }
        } else {
          // ─── BUY EVALUATION ───
          // Uses SMOOTHED score + per-pool confidence buffer.
          // Instead of executing immediately, push to pendingBuys so Phase B
          // can weight the allocation by conviction before executing.
          if (smoothedScore >= pool.strategy.buyScoreThreshold + buyConfidenceBuffer) {
            // Anti-wash check
            const lastSold = pool.lastSoldAt?.[upper];
            if (lastSold && pool.strategy.antiWashHours > 0) {
              const hoursSinceSell = (Date.now() - new Date(lastSold).getTime()) / (1000 * 60 * 60);
              if (hoursSinceSell < pool.strategy.antiWashHours) {
                await setBrainStatus(userId, `${pool.emoji} 🚫 ${upper}: Anti-wash cooldown (sold ${hoursSinceSell.toFixed(1)}h ago, need ${pool.strategy.antiWashHours}h)`);
                continue;
              }
            }

            // Momentum gate check
            if (pool.strategy.momentumGateEnabled && priceData.change24h < pool.strategy.momentumGateThreshold) {
              await setBrainStatus(userId, `${pool.emoji} ⏸️ ${upper}: Momentum gate blocked (${priceData.change24h.toFixed(1)}% < ${pool.strategy.momentumGateThreshold}%)`);
              continue;
            }

            // Queue for Phase B — sizing happens after all tokens are evaluated
            const tokenMarketContext = {
              btcPrice, btcChange24h: btcChange,
              tokenChange24h: priceData.change24h, fearGreedIndex: fng,
            };
            const buyReflection = `BUY signal: smoothed score ${smoothedScore} (raw: ${analysis.overallScore}, threshold ${pool.strategy.buyScoreThreshold}+${buyConfidenceBuffer}). Entry type: ${analysis.entryType}. ${analysis.summary}`;
            pendingBuys.push({
              ticker: upper,
              smoothedScore,
              price: priceData.price,
              buyAmount: 0, // sized in Phase B
              reflection: buyReflection,
              marketContext: tokenMarketContext,
            });
            await setBrainStatus(userId, `${pool.emoji} 📌 ${upper}: BUY signal queued (score ${smoothedScore}). Sizing after all tokens evaluated.`);
          }
        }
      } catch (e: any) {
        console.warn(`[Arena] Analysis failed for ${upper} in ${pool.poolId}: ${e.message}`);
      }
    } // end Phase A token loop

    // ── Phase B: Conviction-weighted buy execution ────────────────────────
    // Score² amplification naturally produces decisive 60/40–70/30 splits
    // when two tokens both pass the threshold at different conviction levels.
    if (pendingBuys.length > 0) {
      const availableCash = pool.cashBalance;

      // Compute score²-amplified weights
      const withWeight = pendingBuys.map(b => ({
        ...b,
        amp: b.smoothedScore * b.smoothedScore,
      }));
      const totalAmp = withWeight.reduce((sum, b) => sum + b.amp, 0);

      // Build sized allocations — skip any below $10 minimum
      const allocations: typeof withWeight = [];
      for (const signal of withWeight) {
        const weight = signal.amp / totalAmp;
        const targetAllocation = pendingBuys.length === 1
          ? Math.min(availableCash, pool.strategy.maxAllocationPerToken)
          : Math.min(availableCash * weight, pool.strategy.maxAllocationPerToken);

        if (targetAllocation < 10) {
          console.log(`[Arena] ${pool.emoji} ${signal.ticker}: conviction allocation $${targetAllocation.toFixed(2)} < $10 minimum — skipping`);
          continue;
        }
        signal.buyAmount = targetAllocation / signal.price;
        allocations.push(signal);
      }

      if (pendingBuys.length > 1 && allocations.length > 0) {
        const splits = allocations.map(a => `${a.ticker} ${((a.amp / totalAmp) * 100).toFixed(0)}%`).join(' / ');
        console.log(`[Arena] ${pool.emoji} Conviction sizing: ${splits}`);
        await setBrainStatus(userId, `${pool.emoji} 🧠 Conviction-weighted allocation: ${splits}`);
      }

      // Execute buys in conviction order (highest score first)
      allocations.sort((a, b) => b.smoothedScore - a.smoothedScore);
      for (const alloc of allocations) {
        const revolutResult = await executeRevolutTrade(userId, alloc.ticker, 'BUY', alloc.buyAmount, alloc.price);
        if (revolutResult.success) {
          const actualPrice = revolutResult.fillPrice || alloc.price;
          const result = await executePoolBuy(userId, pool, alloc.ticker, alloc.buyAmount, actualPrice, alloc.reflection, alloc.marketContext, alloc.reflection);
          if (result.success && result.trade) poolTrades.push(result.trade);
        } else {
          console.warn(`[Arena] ⚠️ Revolut BUY failed for ${alloc.ticker} — arena state NOT updated`);
        }
      }
    }

    // ── Phase B.2: DCA Reserve Deployment ───────────────────────────────
    // Runs after regular buys. Checks if there is ring-fenced DCA capital
    // waiting and if any signal meets the higher 85/90 conviction bar.
    //
    //   score 85–89: deploy 50% of dcaReserve (partial — good but not exceptional)
    //   score 90+:   deploy 100% of dcaReserve (exceptional — maximum capital)
    const dcaReserve = pool.dcaReserve ?? 0;
    if (dcaReserve >= 10 && pendingBuys.length > 0) {
      const bestSignal = [...pendingBuys].sort((a, b) => b.smoothedScore - a.smoothedScore)[0];

      const DCA_PARTIAL_THRESHOLD = 85;
      const DCA_FULL_THRESHOLD = 90;

      if (bestSignal.smoothedScore >= DCA_PARTIAL_THRESHOLD) {
        const isFullDeploy = bestSignal.smoothedScore >= DCA_FULL_THRESHOLD;
        const dcaAmount = isFullDeploy ? dcaReserve : Math.round(dcaReserve * 0.5 * 100) / 100;

        if (dcaAmount >= 10) {
          const dcaBuyAmount = dcaAmount / bestSignal.price;
          const dcaLabel = isFullDeploy ? 'FULL' : 'PARTIAL (50%)';
          const dcaReflection = `DCA RESERVE ${dcaLabel} DEPLOY: $${dcaAmount.toFixed(2)} from ring-fenced reserve. Score ${bestSignal.smoothedScore} (≥${isFullDeploy ? DCA_FULL_THRESHOLD : DCA_PARTIAL_THRESHOLD} threshold). ${bestSignal.reflection}`;

          await setBrainStatus(userId, `${pool.emoji} 💰 DCA reserve ${dcaLabel}: $${dcaAmount.toFixed(2)} → ${bestSignal.ticker} (score ${bestSignal.smoothedScore})`);
          console.log(`[Arena] ${pool.emoji} DCA deploy ${dcaLabel}: $${dcaAmount.toFixed(2)} into ${bestSignal.ticker}`);

          const dcaRevolutResult = await executeRevolutTrade(userId, bestSignal.ticker, 'BUY', dcaBuyAmount, bestSignal.price);
          if (dcaRevolutResult.success) {
            const actualPrice = dcaRevolutResult.fillPrice || bestSignal.price;
            const result = await executePoolBuy(userId, pool, bestSignal.ticker, dcaBuyAmount, actualPrice, dcaReflection, bestSignal.marketContext, dcaReflection);
            if (result.success && result.trade) {
              poolTrades.push(result.trade);
              // Update DCA accounting (decrements dcaReserve, increments dcaDeployedTotal)
              await deployFromDcaReserve(userId, pool, dcaAmount);
            }
          } else {
            console.warn(`[Arena] ⚠️ Revolut DCA BUY failed for ${bestSignal.ticker} — reserve NOT deployed`);
          }
        }
      } else {
        console.log(`[Arena] ${pool.emoji} DCA reserve $${dcaReserve.toFixed(2)} waiting — best score ${bestSignal.smoothedScore} < ${DCA_PARTIAL_THRESHOLD} threshold`);
      }
    }

    // Update pool performance
    updatePoolPerformance(pool, prices);
    const totalValue = getPoolTotalValue(pool, prices);

    // Daily snapshot
    await recordDailySnapshot(userId, pool.poolId, totalValue, pool.performance.totalPnlPct);

    // Pool drawdown check (25% max loss)
    if (pool.performance.totalPnlPct <= -25) {
      await pauseArenaPool(userId, pool.poolId, `Drawdown limit reached: ${pool.performance.totalPnlPct.toFixed(1)}%`);
      try {
        const { sendSystemAlert } = await import('@/services/telegramService');
        await sendSystemAlert('POOL HALTED', `${pool.emoji} ${pool.name} paused: ${pool.performance.totalPnlPct.toFixed(1)}% drawdown`, '⛔');
      } catch { }
    }

    // Trade alerts disabled — daily reports only (8am/6pm via Telegram)

    poolResults.push({
      poolId: pool.poolId,
      trades: poolTrades.length,
      value: totalValue,
      pnlPct: pool.performance.totalPnlPct,
    });
    totalTrades += poolTrades.length;
  }

  // Save updated arena state
  await adminDb.collection('arena_config').doc(userId).set(arena);
  await setBrainStatus(userId, `✅ Arena cycle complete. ${totalTrades} trade(s).`);

  return { success: true, poolResults, totalTrades };
}

// ═══════════════════════════════════════════════════════════════════════════
// REVOLUT TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function executeRevolutTrade(
  userId: string, ticker: string, side: 'BUY' | 'SELL', amount: number, price: number
): Promise<{ success: boolean; fillPrice?: number; fillAmount?: number; fillTotal?: number }> {
  if (!adminDb) return { success: false };
  try {
    const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    if (!config?.realTradingEnabled || !config?.revolutApiKey || !config?.revolutPrivateKey) {
      return { success: false };
    }

    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);
    const symbol = `${ticker}-USD`;
    const result = await client.createOrder({
      symbol,
      side,
      size: amount.toFixed(8),
      type: 'market',
    });

    // Extract fill data from Revolut response if available
    const fillPrice = parseFloat(result?.executed_price || result?.price || result?.average_price || 0) || price;
    const fillAmount = parseFloat(result?.executed_quantity || result?.filled_size || result?.size || 0) || amount;
    const fillTotal = fillPrice > 0 && fillAmount > 0 ? fillPrice * fillAmount : price * amount;

    console.log(`[Revolut] ${side} ${amount.toFixed(6)} ${ticker} | Requested: $${smartPrice(price)} | Fill: $${smartPrice(fillPrice)} | Total: $${fillTotal.toFixed(2)} | Order: ${result?.id || 'submitted'}`);
    return { success: true, fillPrice, fillAmount, fillTotal };
  } catch (e: any) {
    console.error(`[Revolut] Trade failed: ${e.message}`);
    return { success: false };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY STRATEGY REVIEW
// ═══════════════════════════════════════════════════════════════════════════

async function performWeeklyReview(
  userId: string, pool: ArenaPool,
  prices: Record<string, any>, fng: number,
): Promise<void> {
  const currentWeek = getCurrentWeek();
  const trades = await getArenaTrades(userId, pool.poolId);
  const weekStart = new Date(new Date(ARENA_START_DATE).getTime() + (currentWeek - 2) * 7 * 24 * 60 * 60 * 1000);
  const weekTrades = trades.filter(t => new Date(t.date) >= weekStart);

  const wins = weekTrades.filter(t => t.type === 'SELL' && (t.pnl || 0) >= 0).length;
  const losses = weekTrades.filter(t => t.type === 'SELL' && (t.pnl || 0) < 0).length;
  const totalValue = getPoolTotalValue(pool, prices);
  const weekPnl = totalValue - pool.budget;
  const weekPnlPct = pool.budget > 0 ? (weekPnl / pool.budget) * 100 : 0;

  // ─── COMPUTE EXECUTION METRICS for strategy review ──────────────────
  const sellTrades = weekTrades.filter(t => t.type === 'SELL');
  const avgHoldHours = sellTrades.length > 0
    ? sellTrades.reduce((sum, sell) => {
      const buys = weekTrades.filter(t => t.type === 'BUY' && t.ticker === sell.ticker && new Date(t.date) < new Date(sell.date));
      const lastBuy = buys.length > 0 ? buys[buys.length - 1] : null;
      const holdH = lastBuy ? (new Date(sell.date).getTime() - new Date(lastBuy.date).getTime()) / (1000 * 60 * 60) : 0;
      return sum + holdH;
    }, 0) / sellTrades.length
    : 0;

  const quickRoundTrips = sellTrades.filter(sell => {
    const buys = weekTrades.filter(t => t.type === 'BUY' && t.ticker === sell.ticker && new Date(t.date) < new Date(sell.date));
    const lastBuy = buys.length > 0 ? buys[buys.length - 1] : null;
    if (!lastBuy) return false;
    return (new Date(sell.date).getTime() - new Date(lastBuy.date).getTime()) / (1000 * 60 * 60) < 2;
  }).length;

  const scoreVarianceInfo = pool.tokens.map(t => {
    const scores = pool.scoreHistory?.[t.toUpperCase()]?.map(s => s.score) || [];
    if (scores.length < 2) return `${t}: insufficient data`;
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const stddev = Math.round(Math.sqrt(scores.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / scores.length));
    return `${t}: avg=${Math.round(mean)}, stddev=\u00B1${stddev} (${scores.length} scores)`;
  }).join(', ');

  const totalSpreadCost = sellTrades.length * 0.75;

  const buyAndHoldComparison = pool.tokens.map(t => {
    const upper = t.toUpperCase();
    const currentPrice = prices[upper]?.price || 0;
    const firstBuy = weekTrades.find(tr => tr.type === 'BUY' && tr.ticker === upper);
    if (!firstBuy) return `${upper}: no trades`;
    const bAndHPct = ((currentPrice - firstBuy.price) / firstBuy.price * 100).toFixed(1);
    return `${upper}: buy-and-hold would be ${Number(bAndHPct) >= 0 ? '+' : ''}${bAndHPct}%`;
  }).join(', ');

  const prompt = `You are the autonomous AI strategist for a trading pool operating under the "PATIENCE NOT ACTIVITY" regime.

YOUR PRIMARY DIRECTIVE: HOLD positions and let them mature. You are NOT rewarded for trading activity. You ARE rewarded for patience and compounding gains over the 28-day arena.

CRITICAL COST CONSTRAINT: Every round-trip trade costs approximately $0.50-$1.00 in Revolut spread (~1%). This means:
- A 3% raw gain becomes only 2% after spread cost
- A 1% raw gain becomes a NET LOSS after spread
- The fewer trades you make, the less value you destroy

POOL: ${pool.emoji} ${pool.name} (${pool.poolId})
DAY: ${getDayNumber()} of 28, WEEK: ${currentWeek} of 4
TOKENS: ${pool.tokens.join(', ')} (CANNOT BE CHANGED)
TOTAL VALUE: $${totalValue.toFixed(2)} (${weekPnlPct >= 0 ? '+' : ''}${weekPnlPct.toFixed(1)}%)
TRADES: ${weekTrades.length} (${wins}W / ${losses}L) | CASH: $${pool.cashBalance.toFixed(2)} | FNG: ${fng}/100

EXECUTION METRICS:
- Avg hold: ${avgHoldHours.toFixed(1)}h | Quick round-trips (<2h): ${quickRoundTrips}/${sellTrades.length}
- Spread cost: ~$${totalSpreadCost.toFixed(2)} | Score variance: ${scoreVarianceInfo}
- Buy-and-hold: ${buyAndHoldComparison}
${quickRoundTrips > 0 ? '🚨 ANY quick round-trips indicate the strategy is still too active' : '✅ No quick round-trips — patience is working'}
${weekTrades.length > 5 ? '🚨 TOO MANY TRADES — reduce activity further' : ''}

CURRENT STRATEGY:
Signal: Buy=${pool.strategy.buyScoreThreshold}, Exit=${pool.strategy.exitThreshold}, TP=${pool.strategy.takeProfitTarget || 8}%, Trail=${pool.strategy.trailingStopPct || 2}%, SL=${pool.strategy.positionStopLoss}%
Execution: Hold=${pool.strategy.minHoldMinutes ?? 360}min, Cooldown=${pool.strategy.evaluationCooldownMinutes ?? 60}min, BuyBuf=${pool.strategy.buyConfidenceBuffer ?? 5}, ExitHyst=${pool.strategy.exitHysteresis ?? 10}, SizeMult=${pool.strategy.positionSizeMultiplier ?? 0.9}, Personality=${pool.strategy.strategyPersonality || 'PATIENT'}
Other: Momentum=${pool.strategy.momentumGateEnabled}(${pool.strategy.momentumGateThreshold}%), AntiWash=${pool.strategy.antiWashHours}h, MaxAlloc=$${pool.strategy.maxAllocationPerToken}
Description: ${pool.strategy.description}

RECENT TRADES:
${weekTrades.slice(0, 15).map(t => `${t.type} ${t.ticker} $${t.total.toFixed(2)} ${t.pnl !== undefined ? (t.pnl >= 0 ? '✅' : '❌') + ' ' + (t.pnlPct?.toFixed(1) || '?') + '%' : ''} — ${t.reason.substring(0, 100)}`).join('\\\\n') || 'No trades since last review.'}

REGIME RULES (YOU CANNOT OVERRIDE THESE):
- AI score-based exits (Exit Path 4) are DISABLED. Positions only exit via: Take-Profit (8%+), Stop-Loss (-8%), or Trailing Stop.
- Minimum buy threshold: 85. Only enter on EXTREME conviction.
- Minimum hold time: 360 minutes (6 hours). Positions need time to develop.
- Minimum anti-wash: 24 hours. No re-buying recently sold tokens.
- Personality is locked to PATIENT.
- The BEST thing you can do is often NOTHING. Set strategyChanged=false if the current strategy is adequate.

KEY QUESTIONS:
1. Is the current trade frequency appropriate? (Fewer is better)
2. Can you increase hold time to give positions more room?
3. Is the take-profit target realistic for the remaining ${28 - getDayNumber()} days?
4. Should you deploy more cash into positions, or keep a cash reserve?

Respond with ONLY valid JSON:
{
  "strategyChanged": true/false,
  "aiReflection": "3-5 sentence reflection. Explain WHY you are or aren't changing. Reference spread costs and hold times.",
  "newStrategy": {
    "buyScoreThreshold": number (min 85),
    "exitThreshold": number (buy - exit >= 25),
    "takeProfitTarget": number (min 8),
    "trailingStopPct": number,
    "momentumGateEnabled": boolean,
    "momentumGateThreshold": number,
    "minOrderAmount": number,
    "antiWashHours": number (min 24),
    "reentryPenalty": number,
    "positionStopLoss": number (max -8),
    "maxAllocationPerToken": number,
    "minWinPct": number,
    "minHoldMinutes": number (360-480),
    "evaluationCooldownMinutes": number (30-60),
    "buyConfidenceBuffer": number (3-15),
    "exitHysteresis": number (5-20),
    "positionSizeMultiplier": number (0.8-1.0),
    "strategyPersonality": "PATIENT",
    "description": "Updated description reflecting patience regime"
  }
}

CONSTRAINTS: buyThreshold>=85. buy-exit gap>=25. antiWash>=24h. TP>=8%. SL<=-8%. Hold 360-480min. Cooldown 30-60min. Personality=PATIENT.
Prefer strategyChanged=false unless the numbers clearly warrant a change.`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return;

    const parsed = safeJsonParse(responseText);

    // ══ ENFORCE HARD GUARDRAILS — BEFORE writing to Firestore ══
    // These limits are non-negotiable. The AI prompt asks nicely; this code
    // enforces by overwriting any non-compliant values in the parsed response.
    if (parsed.strategyChanged && parsed.newStrategy) {
      const ns = parsed.newStrategy;

      // Minimum buy threshold: 85 (only high-conviction entries)
      if ((ns.buyScoreThreshold ?? 0) < 85) {
        console.log(`[Arena] ⚠️ Guardrail: buyScoreThreshold ${ns.buyScoreThreshold} → 85`);
        ns.buyScoreThreshold = 85;
      }
      // Minimum 25-point gap between buy and exit thresholds
      if (ns.buyScoreThreshold - ns.exitThreshold < 25) {
        ns.exitThreshold = Math.max(20, ns.buyScoreThreshold - 25);
        console.log(`[Arena] ⚠️ Guardrail: exitThreshold → ${ns.exitThreshold} (25-pt gap from buy=${ns.buyScoreThreshold})`);
      }
      // Minimum antiWashHours: 24h
      if ((ns.antiWashHours ?? 0) < 24) {
        console.log(`[Arena] ⚠️ Guardrail: antiWashHours ${ns.antiWashHours} → 24`);
        ns.antiWashHours = 24;
      }
      // Minimum takeProfitTarget: 8% (must exceed ~1% spread cost significantly)
      if ((ns.takeProfitTarget ?? 0) < 8) {
        console.log(`[Arena] ⚠️ Guardrail: takeProfitTarget ${ns.takeProfitTarget} → 8`);
        ns.takeProfitTarget = 8;
      }
      // Maximum stop-loss: -8% (no tighter — crypto moves ±3% daily)
      if ((ns.positionStopLoss ?? 0) > -8) {
        console.log(`[Arena] ⚠️ Guardrail: positionStopLoss ${ns.positionStopLoss} → -8`);
        ns.positionStopLoss = -8;
      }
      // minHoldMinutes: 360-480 (minimum 6 hours, maximum 8 hours)
      ns.minHoldMinutes = Math.max(360, Math.min(480, ns.minHoldMinutes ?? 360));
      // evaluationCooldownMinutes: 30-60 (minimum 30 min between re-scores)
      ns.evaluationCooldownMinutes = Math.max(30, Math.min(60, ns.evaluationCooldownMinutes ?? 60));
      // buyConfidenceBuffer: 3-15
      ns.buyConfidenceBuffer = Math.max(3, Math.min(15, ns.buyConfidenceBuffer ?? 5));
      // exitHysteresis: 5-20
      ns.exitHysteresis = Math.max(5, Math.min(20, ns.exitHysteresis ?? 10));
      // positionSizeMultiplier: forced 1.0 — maximum capital usage on entries
      ns.positionSizeMultiplier = 1.0;
      // strategyPersonality: must be PATIENT under this regime
      ns.strategyPersonality = 'PATIENT';
      console.log(`[Arena] ✅ Patience regime guardrails enforced for ${pool.poolId} BEFORE Firestore write`);
    }

    const review: WeeklyReview = {
      week: currentWeek - 1,
      pnl: weekPnl,
      pnlPct: weekPnlPct,
      trades: weekTrades.length,
      wins,
      losses,
      strategyChanged: parsed.strategyChanged || false,
      aiReflection: parsed.aiReflection || 'No reflection generated.',
      timestamp: new Date().toISOString(),
    };

    // Firestore write now receives the already-guardrailed strategy
    await recordWeeklyReview(
      userId, pool.poolId, review,
      parsed.strategyChanged ? parsed.newStrategy : undefined,
    );

    // ── Sync in-memory pool state so runArenaCycle doesn't overwrite ──
    // NOTE: parsed.newStrategy is already guardrail-clamped from the block above
    pool.weeklyReviews.push(review);
    if (parsed.strategyChanged && parsed.newStrategy) {
      const ns = parsed.newStrategy; // Already guardrail-enforced
      pool.strategyHistory.push({
        week: review.week,
        previousStrategy: { ...pool.strategy },
        newStrategy: ns,
        reasoning: review.aiReflection,
        changedAt: new Date().toISOString(),
      });
      pool.strategy = ns;
    }

    // Telegram notification
    try {
      const { sendSystemAlert } = await import('@/services/telegramService');
      await sendSystemAlert(
        `WEEKLY REVIEW — ${pool.name}`,
        `${pool.emoji} Week ${currentWeek - 1} Summary:\n\nP&L: ${weekPnlPct >= 0 ? '+' : ''}${weekPnlPct.toFixed(1)}%\nTrades: ${weekTrades.length} (${wins}W/${losses}L)\nStrategy ${parsed.strategyChanged ? 'CHANGED' : 'UNCHANGED'}\n\n${parsed.aiReflection}`,
        '📊'
      );
    } catch { }

    console.log(`[Arena] Weekly review for ${pool.poolId}: ${parsed.strategyChanged ? 'Strategy CHANGED' : 'No change'}. ${parsed.aiReflection.substring(0, 100)}...`);
  } catch (e: any) {
    console.error(`[Arena] Weekly review failed for ${pool.poolId}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI ARENA INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AI selects 8 tokens and creates 4 competing pool strategies.
 */
export async function aiInitializeArena(userId: string): Promise<{ success: boolean; message: string }> {
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };

  // Check if already initialized
  const existing = await getArenaConfig(userId);
  if (existing?.initialized) {
    return { success: false, message: 'Arena already initialized.' };
  }

  await setBrainStatus(userId, '🏟️ Initializing Arena — AI selecting tokens...');

  // Fetch prices for all watchlist tokens to give AI data to choose from
  const allTickers = AGENT_WATCHLIST;
  const prices = await getVerifiedPrices(allTickers);

  const tokenData = Object.entries(prices)
    .filter(([, v]) => v.price > 0)
    .map(([ticker, data]) => ({
      ticker,
      price: data.price,
      change24h: data.change24h,
      mcap: data.mcap,
    }))
    .sort((a, b) => (b.mcap || 0) - (a.mcap || 0));

  const prompt = `You are an elite AI portfolio architect. You must select 8 tokens and design 4 CONTRASTING trading strategies for a 28-day competition starting ${new Date(ARENA_START_DATE).toLocaleDateString('en-GB')}.

AVAILABLE TOKENS (with current market data):
${tokenData.slice(0, 60).map(t => `  ${t.ticker}: $${smartPrice(t.price)} (24h: ${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(1)}%, MCap: $${(t.mcap / 1e9).toFixed(1)}B)`).join('\n')}

RULES:
- Select exactly 8 UNIQUE tokens across 4 pools (2 tokens per pool)
- Each pool gets $150 budget
- Tokens are LOCKED for 28 days — choose wisely for long-term potential
- Each pool should test a FUNDAMENTALLY DIFFERENT strategy
- Consider diversification: mix of large/mid/small caps, different sectors
- Consider correlation: avoid putting highly correlated tokens in the same pool
- Consider the next 28 days: what tokens are likely to perform well?

REQUIRED POOL ARCHETYPES:
1. MOMENTUM RIDER — Buy confirmed uptrends, tight stops
2. DIP HUNTER — Buy significant dips, wider stops, mean-reversion
3. PATIENT ACCUMULATOR — Scale in slowly, minimal trading
4. AGGRESSIVE SWINGER — High frequency, tight entries/exits

Respond with ONLY valid JSON:
{
  "selectionReasoning": "2-3 paragraphs explaining your token selection rationale and why these 8 tokens are the best picks for the next 28 days",
  "pool1": {
    "name": "Creative Name",
    "emoji": "single emoji",
    "tokens": ["TOKEN1", "TOKEN2"],
    "strategy": {
      "buyScoreThreshold": 65-85,
      "exitThreshold": 45-70,
      "momentumGateEnabled": true/false,
      "momentumGateThreshold": -5 to 2,
      "minOrderAmount": 10-30,
      "antiWashHours": 0-24,
      "reentryPenalty": 0-15,
      "positionStopLoss": -5 to -30,
      "maxAllocationPerToken": 50-150,
      "description": "Brief strategy rationale"
    }
  },
  "pool2": { same structure },
  "pool3": { same structure },
  "pool4": { same structure }
}`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return { success: false, message: 'AI returned empty response.' };

    const config = safeJsonParse(responseText);
    const reasoning = config.selectionReasoning || 'AI-selected based on market analysis.';

    // Validate all pools have tokens
    for (const key of ['pool1', 'pool2', 'pool3', 'pool4']) {
      if (!config[key]?.tokens?.length || config[key].tokens.length < 2) {
        return { success: false, message: `Pool ${key} missing tokens.` };
      }
    }

    const result = await initializeArena(userId, {
      pool1: { ...config.pool1, reasoning: `${config.pool1.strategy?.description}\n\n${reasoning}` },
      pool2: { ...config.pool2, reasoning: `${config.pool2.strategy?.description}\n\n${reasoning}` },
      pool3: { ...config.pool3, reasoning: `${config.pool3.strategy?.description}\n\n${reasoning}` },
      pool4: { ...config.pool4, reasoning: `${config.pool4.strategy?.description}\n\n${reasoning}` },
    });

    if (result.success) {
      // Send Telegram notification
      try {
        const { sendSystemAlert } = await import('@/services/telegramService');
        const poolList = ['pool1', 'pool2', 'pool3', 'pool4'].map(k => {
          const p = config[k];
          return `${p.emoji} <b>${p.name}</b>: ${p.tokens.join(' + ')}`;
        }).join('\n');
        await sendSystemAlert(
          '🏟️ ARENA INITIALIZED',
          `4 pools created with $150 each ($600 total).\n\n${poolList}\n\n${reasoning.substring(0, 300)}`,
          '🏟️'
        );
      } catch { }
    }

    return result;
  } catch (e: any) {
    console.error('[Arena] AI initialization failed:', e);
    return { success: false, message: `AI initialization failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD DATA EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/** Get full arena status for the dashboard. */
export async function getArenaStatus(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<{
  arena: ArenaConfig | null;
  trades: ArenaTradeRecord[];
  marketStats: any;
  eodhd: { used: number; limit: number; remaining: number; pct: number };
}> {
  if (!userId) return { arena: null, trades: [], marketStats: null, eodhd: { used: 0, limit: 80000, remaining: 80000, pct: 0 } };
  const [arena, trades, marketStats, eodhd] = await Promise.all([
    getArenaConfig(userId, assetClass),
    getArenaTrades(userId, undefined, assetClass),
    getGlobalMarketStats(),
    checkEODHDUsage(),
  ]);


  return { arena, trades, marketStats, eodhd };
}

/** Get mission selector cards for all 4 arenas — called by page.tsx via server action. */
export async function getAllArenaStatuses(userId: string) {
  const assetClasses: AssetClass[] = ['CRYPTO', 'FTSE', 'NYSE', 'COMMODITIES'];

  // Fetch all arena configs in parallel
  const arenas = await Promise.all(
    assetClasses.map(ac => getArenaConfig(userId, ac).catch(() => null))
  );

  // Fetch live prices for every initialized arena in parallel
  // CRYPTO → getVerifiedPrices (CoinGecko/Binance)
  // Others → fetchSandboxArenaPrices (EODHD with exchange suffix)
  const allLivePrices: Record<string, Record<string, { price: number; change24h: number }>> = {};
  await Promise.all(
    assetClasses.map(async (ac, idx) => {
      const arena = arenas[idx];
      if (!arena?.initialized) return;
      try {
        const tokens = new Set<string>();
        arena.pools.forEach((p: any) => p.tokens?.forEach((t: string) => tokens.add(t.toUpperCase())));
        if (ac === 'CRYPTO') {
          tokens.add('BTC');
          allLivePrices[ac] = await getVerifiedPrices([...tokens]);
        } else {
          allLivePrices[ac] = await fetchSandboxArenaPrices([...tokens], ac) as any;
        }
      } catch { /* non-fatal — getPoolNav falls back to cost-basis */ }
    })
  );

  /** Compute NAV for a single pool using live prices.
   *  Falls back to latest daily snapshot, then to cost-basis if no live data. */
  function getPoolNav(p: any, ac: AssetClass): number {
    const live = allLivePrices[ac];
    if (live && Object.keys(live).length > 0) {
      let holdVal = 0;
      if (p.holdings && typeof p.holdings === 'object') {
        for (const [ticker, h] of Object.entries(p.holdings) as [string, any][]) {
          const livePrice = live[ticker.toUpperCase()]?.price;
          holdVal += (h.amount || 0) * (livePrice ?? h.averagePrice ?? 0);
        }
      }
      return (p.cashBalance || 0) + holdVal;
    }
    // Snapshot fallback (e.g. market closed / EODHD unavailable)
    const snapshots: any[] = p.performance?.dailySnapshots || [];
    if (snapshots.length > 0) {
      const latest = snapshots.reduce((a: any, b: any) =>
        (a.date || '') >= (b.date || '') ? a : b
      );
      if (latest?.value && latest.value > 0) return latest.value;
    }
    // Final fallback: cost-basis
    let holdVal = 0;
    if (p.holdings && typeof p.holdings === 'object') {
      for (const h of Object.values(p.holdings) as any[]) {
        holdVal += (h.amount || 0) * (h.averagePrice || 0);
      }
    }
    return (p.cashBalance || 0) + holdVal;
  }

  function getNav(arena: any, ac: AssetClass): number {
    if (!arena?.pools) return 0;
    return arena.pools.reduce((sum: number, p: any) => sum + getPoolNav(p, ac), 0);
  }

  function getNavPct(arena: any, ac: AssetClass): number {
    if (!arena?.pools?.length || !arena.totalBudget) return 0;
    return ((getNav(arena, ac) - arena.totalBudget) / arena.totalBudget) * 100;
  }

  function getStatus(arena: any, ac: AssetClass): 'LIVE' | 'SANDBOX' | 'IDLE' | 'COMPLETE' {
    if (!arena?.initialized) return 'IDLE';
    if (ac === 'CRYPTO') {
      return new Date() > new Date(arena.endDate) ? 'COMPLETE' : 'LIVE';
    }
    return arena.competitionMode ? 'LIVE' : 'SANDBOX';
  }

  function getDayNum(arena: any): number | undefined {
    if (!arena?.startDate) return undefined;
    const days = Math.floor((Date.now() - new Date(arena.startDate).getTime()) / 86400000) + 1;
    return Math.max(1, Math.min(days, 28));
  }

  const configs = [
    { assetClass: 'CRYPTO' as AssetClass, icon: '₿', label: 'Crypto Arena', subtitle: 'Semaphore10 · 4 AI Pools', href: '/crypto', currency: '$' },
    { assetClass: 'FTSE' as AssetClass, icon: '🏦', label: 'FTSE Arena', subtitle: 'FTSE 100/250 · London', href: '/ftse', currency: '£' },
    { assetClass: 'NYSE' as AssetClass, icon: '🗽', label: 'NYSE Arena', subtitle: 'US Equities · New York', href: '/nyse', currency: '$' },
    { assetClass: 'COMMODITIES' as AssetClass, icon: '⚙️', label: 'Commodities', subtitle: 'Metals · Energy · Agri', href: '/commodities', currency: '$' },
  ];

  return configs.map((cfg, idx) => {
    const arena = arenas[idx];
    return {
      ...cfg,
      status: getStatus(arena, cfg.assetClass),
      nav: getNav(arena, cfg.assetClass),
      navPct: getNavPct(arena, cfg.assetClass),
      day: getDayNum(arena),
    };
  });
}





// ─── Types for chart data ──────────────────────────────────────────────────

export interface PerformanceDataPoint {
  date: string;         // ISO date YYYY-MM-DD
  label: string;        // e.g. "Day 3"
  navTotal: number;     // total portfolio value
  navPct: number;       // total P&L %
  pools: Record<string, { value: number; pnlPct: number; name: string; emoji: string }>;
}

export interface TradeMarker {
  date: string;
  type: 'BUY' | 'SELL';
  ticker: string;
  poolId: string;
  poolName: string;
  pnlPct?: number;
  total: number;
}

export interface PerformanceHistory {
  dataPoints: PerformanceDataPoint[];
  tradeMarkers: TradeMarker[];
  budget: number;
  currentNAV: number;
  currentPnlPct: number;
  pools: { poolId: string; name: string; emoji: string; color: string; currentPnlPct: number }[];
  startDate: string;
}

const POOL_COLORS = ['#4ba3e3', '#4caf50', '#ffb74d', '#ff6659'];

/** Return historical performance snapshots + trade markers for the progress chart. */
export async function getPerformanceHistory(
  userId: string,
  prices?: Record<string, { price: number; change24h: number }>,
  assetClass: AssetClass = 'CRYPTO'
): Promise<PerformanceHistory | null> {
  const arena = await getArenaConfig(userId, assetClass);
  if (!arena?.initialized) return null;

  // Get live prices if not passed in
  let livePrices = prices;
  if (!livePrices) {
    const allTokens = new Set<string>();
    arena.pools.forEach(p => p.tokens.forEach(t => allTokens.add(t.toUpperCase())));
    livePrices = assetClass === 'CRYPTO'
      ? await getVerifiedPrices([...allTokens])
      : await fetchSandboxArenaPrices([...allTokens], assetClass) as any;
  }

  // Collect all unique dates across all pools' snapshots
  const dateSet = new Set<string>();
  arena.pools.forEach(pool => {
    (pool.performance.dailySnapshots || []).forEach(s => dateSet.add(s.date));
  });

  const sortedDates = [...dateSet].sort();

  // If we have no snapshots yet, synthesise a "day 0" starting point
  const startDateStr = new Date(arena.startDate).toISOString().slice(0, 10);
  if (!dateSet.has(startDateStr)) sortedDates.unshift(startDateStr);

  // Always add today as the live data point
  const todayStr = new Date().toISOString().slice(0, 10);
  if (!sortedDates.includes(todayStr)) sortedDates.push(todayStr);

  const arenaStartMs = new Date(arena.startDate).getTime();

  const dataPoints: PerformanceDataPoint[] = sortedDates.map(date => {
    const dayNum = Math.max(0, Math.round((new Date(date).getTime() - arenaStartMs) / 86400000));
    const isToday = date === todayStr;
    const poolData: Record<string, { value: number; pnlPct: number; name: string; emoji: string }> = {};

    let navTotal = 0;
    for (const pool of arena.pools) {
      let value: number;
      let pnlPct: number;

      if (isToday) {
        // Use live prices for today
        let holdVal = 0;
        for (const [t, h] of Object.entries(pool.holdings)) {
          holdVal += h.amount * (livePrices![t.toUpperCase()]?.price || h.averagePrice);
        }
        value = pool.cashBalance + holdVal;
        pnlPct = pool.budget > 0 ? ((value - pool.budget) / pool.budget) * 100 : 0;
      } else if (date === startDateStr) {
        // Start at budget
        value = pool.budget;
        pnlPct = 0;
      } else {
        // Find snapshot closest to this date
        const snap = (pool.performance.dailySnapshots || []).find(s => s.date === date);
        if (snap) {
          value = snap.value;
          pnlPct = snap.pnlPct;
        } else {
          // Interpolate from nearest prior snapshot
          const prior = [...(pool.performance.dailySnapshots || [])]
            .filter(s => s.date <= date)
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          value = prior ? prior.value : pool.budget;
          pnlPct = prior ? prior.pnlPct : 0;
        }
      }

      poolData[pool.poolId] = { value, pnlPct, name: pool.name, emoji: pool.emoji };
      navTotal += value;
    }

    const navPct = arena.totalBudget > 0
      ? ((navTotal - arena.totalBudget) / arena.totalBudget) * 100
      : 0;

    return {
      date,
      label: dayNum === 0 ? 'Start' : `Day ${dayNum}`,
      navTotal,
      navPct,
      pools: poolData,
    };
  });

  // Build trade markers
  const trades = await getArenaTrades(userId, undefined, assetClass);
  const tradeMarkers: TradeMarker[] = trades.map(t => ({
    date: new Date(t.date).toISOString().slice(0, 10),
    type: t.type,
    ticker: t.ticker,
    poolId: t.poolId,
    poolName: t.poolName,
    pnlPct: t.pnlPct,
    total: t.total,
  }));

  // Current live stats
  let currentNAV = 0;
  for (const pool of arena.pools) {
    let holdVal = 0;
    for (const [t, h] of Object.entries(pool.holdings)) {
      holdVal += h.amount * (livePrices![t.toUpperCase()]?.price || h.averagePrice);
    }
    currentNAV += pool.cashBalance + holdVal;
  }
  const currentPnlPct = arena.totalBudget > 0
    ? ((currentNAV - arena.totalBudget) / arena.totalBudget) * 100
    : 0;

  const pools = arena.pools.map((pool, idx) => {
    let holdVal = 0;
    for (const [t, h] of Object.entries(pool.holdings)) {
      holdVal += h.amount * (livePrices![t.toUpperCase()]?.price || h.averagePrice);
    }
    const value = pool.cashBalance + holdVal;
    const pnlPct = pool.budget > 0 ? ((value - pool.budget) / pool.budget) * 100 : 0;
    return {
      poolId: pool.poolId,
      name: pool.name,
      emoji: pool.emoji,
      color: POOL_COLORS[idx] || '#8a8f98',
      currentPnlPct: pnlPct,
    };
  });

  return {
    dataPoints,
    tradeMarkers,
    budget: arena.totalBudget,
    currentNAV,
    currentPnlPct,
    pools,
    startDate: arena.startDate,
  };
}

/** Get fresh prices for all arena tokens. */
/** Get fresh prices for all arena tokens. */
export async function refreshArenaPrices(
  userId: string,
  assetClass: AssetClass = 'CRYPTO'
): Promise<Record<string, { price: number; change24h: number }>> {
  if (!userId) return {};
  const arena = await getArenaConfig(userId, assetClass);
  if (!arena) return {};

  const allTokens = new Set<string>();
  arena.pools.forEach(p => p.tokens.forEach(t => allTokens.add(t.toUpperCase())));
  if (assetClass === 'CRYPTO') {
    allTokens.add('BTC'); // Always include BTC for the crypto dashboard oracle
    return getVerifiedPrices([...allTokens]);
  }
  // For FTSE/NYSE/Commodities use EODHD with exchange suffix
  return fetchSandboxArenaPrices([...allTokens], assetClass) as any;
}

/** Manually trigger arena initialization (crypto only — use aiInitializeSandboxArena for others). */
export async function manualInitArena(userId: string, assetClass: AssetClass = 'CRYPTO') {
  if (assetClass !== 'CRYPTO') return aiInitializeSandboxArena(userId, assetClass);
  return aiInitializeArena(userId);
}

// ═══════════════════════════════════════════════════════════════════════════
// SANDBOX ARENA ACTIONS (FTSE · NYSE · COMMODITIES)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch prices for non-crypto arenas using EODHD with asset-class-appropriate exchange suffix.
 * Reuses the existing EODHD pricing engine but wraps/unwraps tickers via formatEODHDTicker.
 */
async function fetchSandboxArenaPrices(
  tickers: string[],
  assetClass: AssetClass
): Promise<Record<string, { price: number; change24h: number; volume: number; source: string }>> {
  if (assetClass === 'CRYPTO' || tickers.length === 0) return {};

  // Normalise: the AI sometimes returns "HG COPPER" or "CL CRUDE OIL" instead
  // of just "HG" / "CL". Strip anything after the first whitespace so the
  // formatEODHDTicker lookup works correctly.
  const cleanTickers = tickers.map(t => t.trim().split(/\s+/)[0].toUpperCase());

  // Map arena tickers → EODHD format
  const eodhdTickers = cleanTickers.map(t => formatEODHDTicker(t, assetClass));
  // Also build a map from EODHD code back to the clean short ticker
  const eodhdToClean: Record<string, string> = {};
  cleanTickers.forEach((t, i) => { eodhdToClean[eodhdTickers[i]] = t; });


  const usage = await checkEODHDUsage();
  if (usage.pct >= EODHD_CRITICAL_THRESHOLD) return {};

  const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
  if (!EODHD_API_KEY) return {};

  const result: Record<string, { price: number; change24h: number; volume: number; source: string }> = {};

  // Batch in chunks of 45
  const CHUNK_SIZE = 45;
  for (let i = 0; i < eodhdTickers.length; i += CHUNK_SIZE) {
    const chunk = eodhdTickers.slice(i, i + CHUNK_SIZE);
    try {
      const primary = chunk[0];
      const extras = chunk.slice(1).join(',');
      const url = `https://eodhd.com/api/real-time/${primary}?${extras ? `s=${extras}&` : ''}api_token=${EODHD_API_KEY}&fmt=json`;

      const res = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } });
      if (!res.ok) continue;

      let data = await res.json();
      if (!Array.isArray(data)) data = [data];

      for (const item of data) {
        if (!item.code || item.close === 'NA' || item.close === undefined) continue;
        const eodhdCode = item.code;
        // Prefer our own eodhdToClean map, fallback to parseEODHDTicker
        const arenaTicker = eodhdToClean[eodhdCode] ?? parseEODHDTicker(eodhdCode, assetClass);
        const price = parseFloat(item.close);
        if (isNaN(price) || price <= 0) continue;

        const prevClose = parseFloat(item.previousClose);
        const change24h = (!isNaN(prevClose) && prevClose > 0)
          ? ((price - prevClose) / prevClose) * 100
          : (parseFloat(item.change_p) || 0);

        result[arenaTicker] = { price, change24h, volume: parseFloat(item.volume) || 0, source: `EODHD:${assetClass}` };

      }
    } catch (e: any) {
      console.warn(`[EODHD:${assetClass}] Batch fetch failed:`, e.message);
    }
  }

  return result;
}

/**
 * Main trading cycle for sandbox arenas (FTSE, NYSE, Commodities).
 * Mirrors runArenaCycle but
 *   - uses fetchSandboxArenaPrices instead of getVerifiedPrices
 *   - skips Revolut execution (virtual trading only)
 *   - skips Telegram reporting
 *   - works whether in SANDBOX or COMPETITION mode
 */
export async function runSandboxArenaCycle(userId: string, assetClass: AssetClass): Promise<{
  success: boolean;
  poolResults: Array<{ poolId: string; trades: number; value: number; pnlPct: number }>;
  totalTrades: number;
}> {
  if (!adminDb || assetClass === 'CRYPTO') return { success: false, poolResults: [], totalTrades: 0 };

  const arena = await getArenaConfig(userId, assetClass);
  if (!arena?.initialized) {
    console.log(`[Arena:${assetClass}] Not initialized, skipping.`);
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  const currency = getCurrencySymbol(assetClass);
  const benchmark = getBenchmarkLabel(assetClass);

  // 1. Fetch all token prices
  const allTokens = new Set<string>();
  for (const pool of arena.pools) {
    pool.tokens.forEach(t => allTokens.add(t.toUpperCase()));
  }

  const tokenList = [...allTokens];
  const priceMap = await fetchSandboxArenaPrices(tokenList, assetClass);

  // Convert to price format expected by arena engine
  const prices: Record<string, { price: number; change24h: number; mcap: number; source: string }> = {};
  for (const [ticker, data] of Object.entries(priceMap)) {
    prices[ticker] = { price: data.price, change24h: data.change24h, mcap: 0, source: data.source };
  }

  const poolResults: Array<{ poolId: string; trades: number; value: number; pnlPct: number }> = [];
  let totalTrades = 0;

  for (const pool of arena.pools) {
    if (pool.status !== 'ACTIVE') {
      poolResults.push({ poolId: pool.poolId, trades: 0, value: getPoolTotalValue(pool, prices), pnlPct: pool.performance.totalPnlPct });
      continue;
    }

    // Dynamic strategy review (same gate as crypto)
    if (isDynamicReviewDue(pool)) {
      await performSandboxReview(userId, pool, prices, assetClass);
    }

    let poolTradeCount = 0;

    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const priceData = prices[upper];
      if (!priceData || priceData.price <= 0) {
        console.warn(`[Arena:${assetClass}] No price for ${upper} — skipping.`);
        continue;
      }

      // Evaluation cooldown check
      const evalCooldownMinutes = pool.strategy.evaluationCooldownMinutes ?? 30;
      const lastEval = pool.lastEvaluatedAt?.[upper];
      if (lastEval) {
        const minSinceEval = (Date.now() - new Date(lastEval).getTime()) / (1000 * 60);
        if (minSinceEval < evalCooldownMinutes) continue;
      }

      // Build trade memory
      let tradeMemory = '';
      try {
        const reflections = await getTradeReflections(userId, pool.poolId, upper, 5, assetClass);
        if (reflections.length > 0) {
          tradeMemory = reflections.map(r =>
            `${r.type} @ ${currency}${r.price.toFixed(2)}: ${r.reasoning.substring(0, 100)}`
          ).join('\n');
        }
      } catch { }

      // Pool context string
      const holdingsStr = Object.entries(pool.holdings).map(([t, h]) => {
        const currentPrice = prices[t.toUpperCase()]?.price || h.averagePrice;
        const pnlPct = ((currentPrice - h.averagePrice) / h.averagePrice * 100).toFixed(1);
        return `${t}: ${h.amount.toFixed(4)} @ ${currency}${h.averagePrice.toFixed(2)} (now ${currency}${currentPrice.toFixed(2)}, ${parseFloat(pnlPct) >= 0 ? '+' : ''}${pnlPct}%)`;
      }).join(', ') || 'No current holdings';

      const displayName = (assetClass === 'COMMODITIES' && COMMODITIES_DISPLAY_NAMES[upper]) ? COMMODITIES_DISPLAY_NAMES[upper] : upper;

      const poolContext = `Pool: ${pool.name} ${pool.emoji} | Cash: ${currency}${pool.cashBalance.toFixed(2)} | Holdings: ${holdingsStr}
Arena: ${assetClass} | Mode: SANDBOX
Currency: ${currency} | Benchmark: ${benchmark}`;

      // Score history for this token
      const recentScores = (pool.scoreHistory?.[upper] || []).slice(-5);

      // AI analysis — use asset-class-specific prompt
      let analysis: CryptoAnalysisResult;
      try {
        analysis = await analyzeSandboxInstrument(ticker, displayName, assetClass, pool.strategy, poolContext, tradeMemory, priceData, recentScores);
      } catch (e: any) {
        console.warn(`[Arena:${assetClass}] Analysis failed for ${upper}:`, e.message);
        continue;
      }

      // Update score history
      if (!pool.scoreHistory) pool.scoreHistory = {};
      if (!pool.scoreHistory[upper]) pool.scoreHistory[upper] = [];
      pool.scoreHistory[upper] = [...(pool.scoreHistory[upper].slice(-9)), { score: analysis.overallScore, ts: new Date().toISOString() }];
      if (!pool.lastEvaluatedAt) pool.lastEvaluatedAt = {};
      pool.lastEvaluatedAt[upper] = new Date().toISOString();

      const score = analysis.overallScore;
      const currentPrice = priceData.price;
      const holding = pool.holdings[upper];
      const marketContext = { btcPrice: 0, btcChange24h: 0, tokenChange24h: priceData.change24h, fearGreedIndex: 50 };

      // ─── BUY LOGIC ───────────────────────────────────────────────────────
      if (!holding && score >= (pool.strategy.buyScoreThreshold + (pool.strategy.buyConfidenceBuffer || 5))) {
        const buyAmount = Math.min(pool.strategy.maxAllocationPerToken, pool.cashBalance * 0.8);
        if (buyAmount >= (pool.strategy.minOrderAmount || 10) && pool.cashBalance >= buyAmount) {
          const units = buyAmount / currentPrice;
          const tradeResult = await executePoolBuy(
            userId, pool, upper, units, currentPrice,
            analysis.summary || 'AI buy signal', marketContext, analysis.summary || '', assetClass
          );
          if (tradeResult.success) {
            poolTradeCount++;
            console.log(`[Arena:${assetClass}] 🟢 BUY ${upper} @ ${currency}${currentPrice.toFixed(2)} (score: ${score})`);
          }
        }
      }

      // ─── SELL LOGIC ──────────────────────────────────────────────────────
      if (holding && holding.amount > 0) {
        const holdMinutes = pool.strategy.minHoldMinutes ?? 60;
        const buyTime = holding.boughtAt ? (Date.now() - new Date(holding.boughtAt).getTime()) / (1000 * 60) : 999;
        const pnlPct = ((currentPrice - holding.averagePrice) / holding.averagePrice) * 100;

        // Update peak tracking
        if (currentPrice > (holding.peakPrice || 0)) {
          holding.peakPrice = currentPrice;
          holding.peakPnlPct = pnlPct;
        }

        const shouldSell = (
          (score <= (pool.strategy.exitThreshold - (pool.strategy.exitHysteresis || 10)) && buyTime > holdMinutes) ||
          pnlPct <= (pool.strategy.positionStopLoss || -8) ||
          pnlPct >= (pool.strategy.takeProfitTarget || 8) ||
          (pnlPct <= (holding.peakPnlPct || 0) - (pool.strategy.trailingStopPct || 3))
        );

        if (shouldSell && buyTime > holdMinutes) {
          const tradeResult = await executePoolSell(
            userId, pool, upper, holding.amount, currentPrice,
            analysis.summary || 'AI sell signal', marketContext, analysis.summary || '', assetClass
          );
          if (tradeResult.success) {
            poolTradeCount++;
            const pnlStr = tradeResult.pnl !== undefined ? ` P&L: ${tradeResult.pnlPct?.toFixed(1)}%` : '';
            console.log(`[Arena:${assetClass}] 🔴 SELL ${upper} @ ${currency}${currentPrice.toFixed(2)} (score: ${score})${pnlStr}`);
          }
        }
      }
    }

    // Save pool state
    updatePoolPerformance(pool, prices);
    await recordDailySnapshot(userId, pool.poolId, getPoolTotalValue(pool, prices), pool.performance.totalPnlPct, assetClass);

    // Persist updated arena
    const arenaDoc = await getArenaConfig(userId, assetClass) as any;
    if (arenaDoc) {
      const poolIdx = arenaDoc.pools.findIndex((p: any) => p.poolId === pool.poolId);
      if (poolIdx >= 0) {
        arenaDoc.pools[poolIdx] = pool;
        await adminDb.collection(getArenaCollections(assetClass).config).doc(userId).set(arenaDoc);
      }
    }

    poolResults.push({
      poolId: pool.poolId,
      trades: poolTradeCount,
      value: getPoolTotalValue(pool, prices),
      pnlPct: pool.performance.totalPnlPct,
    });
    totalTrades += poolTradeCount;
  }

  console.log(`[Arena:${assetClass}] ✅ Cycle complete. ${totalTrades} trade(s) executed.`);
  return { success: true, poolResults, totalTrades };
}

/**
 * AI scoring for non-crypto instruments. Uses asset-class-specific prompt personality.
 * Returns a CryptoAnalysisResult (same shape — score 0-100, summary, signals).
 */
async function analyzeSandboxInstrument(
  ticker: string,
  displayName: string,
  assetClass: AssetClass,
  poolStrategy: PoolStrategy,
  poolContext: string,
  tradeMemory: string,
  priceData: { price: number; change24h: number },
  recentScores: { score: number; ts: string }[],
): Promise<CryptoAnalysisResult> {
  const currency = getCurrencySymbol(assetClass);

  const groundingContext = `GROUND TRUTH DATA: Price: ${currency}${priceData.price.toFixed(2)}. 24h change: ${priceData.change24h?.toFixed(2)}%.`;

  const scoreHistoryContext = (recentScores && recentScores.length > 0)
    ? recentScores.slice(-5).map(s => {
      const ago = Math.round((Date.now() - new Date(s.ts).getTime()) / (1000 * 60));
      return `Score ${s.score} (${ago}min ago)`;
    }).join(' → ')
    : 'No previous scores. This is the first evaluation.';

  const personalityMap: Record<AssetClass, string> = {
    CRYPTO: 'You are an elite AI Crypto Trader.',
    FTSE: `You are an institutional equity analyst specialising in FTSE 100 and FTSE 250 stocks.
You understand UK market microstructure, sector rotation, dividend dynamics, BoE rate sensitivity, and commodity-linked UK stocks.
Prices are in GBP (£). This is a SANDBOX environment — run with full conviction as if it were a live competition.
Consider P/E vs sector peers, momentum, 52-week range, UK macro risks (sterling, energy, housing).`,
    NYSE: `You are a US equity strategist covering large-cap and mega-cap NYSE/NASDAQ stocks.
You understand earnings cycles, Fed rate sensitivity, sector rotation (tech/financials/energy), VIX-implied volatility, and growth-vs-value dynamics.
Prices are in USD ($). This is a SANDBOX environment — run with full conviction as if it were a live competition.
Weight recent earnings beats/misses, institutional flow signals, and near-term catalyst risk.`,
    COMMODITIES: `You are a commodity research analyst covering precious metals, energy futures, and agricultural contracts.
You understand supply/demand cycles, geopolitical risk pricing, seasonal patterns, DXY inverse correlations for metals, OPEC decisions for energy, and crop report impacts on agriculture.
Prices are in USD ($). This is a SANDBOX environment — run with full conviction as if it were a live competition.
Assess macro regime (risk-on vs risk-off), physical demand signals, and positioning data.`,
  };

  const prompt = `
ROLE: ${personalityMap[assetClass]}
Your ONLY goal is maximum profit for each pool over the competition period.

══════════════════════════════════════════════════════
INSTRUMENT: ${displayName} (${ticker.toUpperCase()})
ASSET CLASS: ${assetClass}
MARKET DATA (GROUND TRUTH — DO NOT CONTRADICT)
══════════════════════════════════════════════════════
${groundingContext}

POOL CONTEXT:
${poolContext}

STRATEGY:
${poolStrategy.description}
- Buy Threshold: ${poolStrategy.buyScoreThreshold}
- Exit Threshold: ${poolStrategy.exitThreshold}
- Stop-Loss: ${poolStrategy.positionStopLoss}%
- Take-Profit: +${poolStrategy.takeProfitTarget || 8}%

TRADE MEMORY:
${tradeMemory || 'No previous trades yet.'}

SCORE HISTORY:
${scoreHistoryContext}

ANALYSIS INSTRUCTIONS:
Score 0-100 based on your specialist knowledge of ${assetClass} instruments:
- 0-39: SELL immediately. Clear downtrend or bearish signal.
- 40-54: Weak. Consider exit unless strong reversal forming.
- 55-64: Mixed signals. Caution.
- 65-79: Bullish improving. Good entry if strategy supports.
- 80-89: Strong conviction buy.
- 90-100: Maximum conviction.

For ${assetClass === 'FTSE' ? 'UK equities: consider dividend yield, Bank of England policy, GBP strength, sector momentum.' : assetClass === 'NYSE' ? 'US equities: consider earnings trajectory, Fed policy, sector rotation, VIX level.' : 'commodities: consider supply/demand fundamentals, DXY strength, geopolitical risk, seasonal factors.'}

OUTPUT JSON (ONLY valid JSON, no markdown):
{
  "ticker": "${ticker.toUpperCase()}",
  "name": "${displayName}",
  "currentPrice": ${priceData.price},
  "priceChange24h": ${priceData.change24h},
  "trafficLight": "RED"|"AMBER"|"GREEN",
  "overallScore": 0-100,
  "entryType": "MOMENTUM"|"DIP_RECOVERY"|"BREAKOUT"|"ACCUMULATION",
  "summary": "2-3 sentences with your reasoning and decision.",
  "signals": [
    {"name": "Price Momentum", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
    {"name": "Trend Direction", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
    {"name": "Volume & Liquidity", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
    {"name": "Macro Environment", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"},
    {"name": "Relative Strength", "score": 0-100, "status": "RED"|"AMBER"|"GREEN"}
  ]
}`;

  const responseText = await generateContentWithFallback(prompt);
  if (!responseText) throw new Error('AI returned empty response');

  const aiResult = safeJsonParse(responseText);

  return {
    ...aiResult,
    ticker: ticker.toUpperCase(),
    currentPrice: priceData.price,
    priceChange24h: priceData.change24h,
    marketCap: 0,
    overallScore: Number(aiResult.overallScore) || 50,
    verificationStatus: `EODHD:${assetClass}`,
  } as CryptoAnalysisResult;
}

/** AI strategy review for sandbox pools — same pattern as performWeeklyReview. */
async function performSandboxReview(userId: string, pool: ArenaPool, prices: Record<string, { price: number }>, assetClass: AssetClass): Promise<void> {
  try {
    const poolValue = getPoolTotalValue(pool, prices);
    const pnlPct = pool.budget > 0 ? ((poolValue - pool.budget) / pool.budget) * 100 : 0;
    const currency = getCurrencySymbol(assetClass);

    const prompt = `You are an AI portfolio manager reviewing performance for a ${assetClass} trading pool in a sandbox competition.

Pool: ${pool.name} ${pool.emoji}
Value: ${currency}${poolValue.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
Trades: ${pool.performance.totalTrades} | Wins: ${pool.performance.winCount} | Losses: ${pool.performance.lossCount}
Current strategy: ${pool.strategy.description}

Review the strategy and suggest improvements. You may adjust buyScoreThreshold, exitThreshold, positionStopLoss, takeProfitTarget, antiWashHours, strategyPersonality.
Return ONLY valid JSON:
{
  "strategyChanged": true/false,
  "newStrategy": { /* only include changed fields */ },
  "reflection": "2-3 sentence assessment of performance and reasoning for any changes."
}`;

    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return;

    const parsed = safeJsonParse(responseText);

    const week = pool.weeklyReviews.length + 1;
    const review: WeeklyReview = {
      week,
      pnl: poolValue - pool.budget,
      pnlPct,
      trades: pool.performance.totalTrades,
      wins: pool.performance.winCount,
      losses: pool.performance.lossCount,
      strategyChanged: parsed.strategyChanged || false,
      aiReflection: parsed.reflection || 'No reflection generated.',
      timestamp: new Date().toISOString(),
    };

    const newStrategy = parsed.strategyChanged && parsed.newStrategy
      ? { ...pool.strategy, ...parsed.newStrategy, description: parsed.newStrategy.description || pool.strategy.description }
      : undefined;

    await recordWeeklyReview(userId, pool.poolId, review, newStrategy, assetClass);
  } catch (e: any) {
    console.warn(`[Arena:${assetClass}] Strategy review failed:`, e.message);
  }
}

/** AI-driven initialization for sandbox arenas (FTSE, NYSE, Commodities). */
export async function aiInitializeSandboxArena(userId: string, assetClass: AssetClass): Promise<{ success: boolean; message: string }> {
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
  if (assetClass === 'CRYPTO') return aiInitializeArena(userId);

  const existing = await getArenaConfig(userId, assetClass);
  if (existing?.initialized) {
    return { success: false, message: `${assetClass} arena already initialized. Reset it first.` };
  }

  const watchlist = getWatchlist(assetClass);
  const currency = getCurrencySymbol(assetClass);
  const now = new Date().toLocaleDateString('en-GB');

  // Fetch prices for the instrument universe
  const priceMap = await fetchSandboxArenaPrices(watchlist, assetClass);
  const instrumentData = watchlist
    .filter(t => priceMap[t.toUpperCase()]?.price > 0)
    .map(t => ({
      ticker: t,
      price: priceMap[t.toUpperCase()].price,
      change24h: priceMap[t.toUpperCase()].change24h,
    }))
    .slice(0, 40); // limit prompt size

  const prompt = `You are an AI portfolio architect designing 4 contrasting trading pools for a ${assetClass} sandbox arena.
Date: ${now}. Each pool gets ${currency}150 budget. Select 2 instruments per pool (8 total, all unique).

AVAILABLE ${assetClass} INSTRUMENTS (with live prices):
${instrumentData.map(i => `  ${i.ticker}: ${currency}${i.price.toFixed(2)} (24h: ${i.change24h >= 0 ? '+' : ''}${i.change24h.toFixed(1)}%)`).join('\n')}

RULES:
- 8 unique instruments, 4 pools, 2 per pool
- Each pool must test a DIFFERENT strategy (momentum/dip-hunter/patient/aggressive)
- For ${assetClass === 'FTSE' ? 'FTSE: consider sector diversification (energy, pharma, financials, consumer)' : assetClass === 'NYSE' ? 'NYSE: consider sector rotation (tech, energy, healthcare, financials)' : 'Commodities: spread across metals, energy, and agriculture categories'}
- CRITICAL: tokens arrays must contain ONLY the SHORT TICKER CODE (e.g. "HG" not "HG COPPER", "CL" not "CL CRUDE OIL"). No descriptions, no spaces, just the ticker symbol as shown in the instrument list above.

Respond with ONLY valid JSON:
{
  "selectionReasoning": "2-3 paragraphs on instrument selection",
  "pool1": { "name": "Name", "emoji": "emoji", "tokens": ["T1", "T2"], "strategy": { "buyScoreThreshold": 70, "exitThreshold": 50, "momentumGateEnabled": false, "momentumGateThreshold": 0, "minOrderAmount": 10, "antiWashHours": 4, "reentryPenalty": 5, "positionStopLoss": -8, "maxAllocationPerToken": 120, "takeProfitTarget": 8, "trailingStopPct": 3, "minWinPct": 0.5, "minHoldMinutes": 60, "evaluationCooldownMinutes": 30, "strategyPersonality": "MODERATE", "description": "brief" }, "reasoning": "reason" },
  "pool2": { same },
  "pool3": { same },
  "pool4": { same }
}`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return { success: false, message: 'AI returned empty response.' };

    const config = safeJsonParse(responseText);

    // Validate
    for (const key of ['pool1', 'pool2', 'pool3', 'pool4']) {
      if (!config[key]?.tokens?.length || config[key].tokens.length < 2) {
        return { success: false, message: `Pool ${key} missing tokens.` };
      }
    }

    const result = await initializeArena(userId, {
      pool1: { ...config.pool1, reasoning: config.pool1.reasoning || config.selectionReasoning },
      pool2: { ...config.pool2, reasoning: config.pool2.reasoning || config.selectionReasoning },
      pool3: { ...config.pool3, reasoning: config.pool3.reasoning || config.selectionReasoning },
      pool4: { ...config.pool4, reasoning: config.pool4.reasoning || config.selectionReasoning },
    }, assetClass);

    return result;
  } catch (e: any) {
    console.error(`[Arena:${assetClass}] AI initialization failed:`, e);
    return { success: false, message: `AI initialization failed: ${e.message}` };
  }
}

/** Reset a sandbox arena (wipes all data in new arena collections, never touches CRYPTO). */
export async function sandboxResetArena(userId: string, assetClass: AssetClass): Promise<{ success: boolean; message: string }> {
  return resetSandboxArena(userId, assetClass);
}

/** Activate competition mode for a sandbox arena (one-way gate). */
export async function activateSandboxCompetition(userId: string, assetClass: AssetClass): Promise<{ success: boolean; message: string }> {
  return activateCompetitionMode(userId, assetClass);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: 'STRATEGY_CHANGE' | 'WEEKLY_REVIEW' | 'TRADE' | 'POOL_PAUSE' | 'ARENA_INIT';
  poolId: string;
  poolName: string;
  poolEmoji: string;
  title: string;
  description: string;
  details?: Record<string, any>;
}

export interface StrategyDiffField {
  field: string;
  label: string;
  oldValue: any;
  newValue: any;
  impact: 'neutral' | 'positive' | 'negative' | 'info';
}

export interface AuditStrategyChange {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  week: number;
  changedAt: string;
  reasoning: string;
  diffs: StrategyDiffField[];
}

export interface AuditWeeklyReview {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  week: number;
  timestamp: string;
  pnl: number;
  pnlPct: number;
  trades: number;
  wins: number;
  losses: number;
  strategyChanged: boolean;
  aiReflection: string;
}

export interface AuditPoolSummary {
  poolId: string;
  poolName: string;
  poolEmoji: string;
  totalStrategyChanges: number;
  totalReviews: number;
  totalTrades: number;
  currentPersonality: string;
  scoreHistoryCount: Record<string, number>;
}

export interface AuditTrailData {
  strategyChanges: AuditStrategyChange[];
  weeklyReviews: AuditWeeklyReview[];
  timeline: AuditEvent[];
  poolSummaries: AuditPoolSummary[];
  totalChanges: number;
  totalReviews: number;
  arenaStartDate: string;
}

const STRATEGY_FIELD_LABELS: Record<string, string> = {
  buyScoreThreshold: 'Buy Score Threshold',
  exitThreshold: 'Exit Threshold',
  takeProfitTarget: 'Take-Profit Target',
  trailingStopPct: 'Trailing Stop',
  momentumGateEnabled: 'Momentum Gate',
  momentumGateThreshold: 'Momentum Threshold',
  minOrderAmount: 'Min Order Amount',
  antiWashHours: 'Anti-Wash Hours',
  reentryPenalty: 'Re-entry Penalty',
  positionStopLoss: 'Position Stop-Loss',
  maxAllocationPerToken: 'Max Allocation/Token',
  minWinPct: 'Min Win %',
  minHoldMinutes: 'Min Hold Time',
  evaluationCooldownMinutes: 'Eval Cooldown',
  buyConfidenceBuffer: 'Buy Confidence Buffer',
  exitHysteresis: 'Exit Hysteresis',
  positionSizeMultiplier: 'Position Size Mult',
  strategyPersonality: 'Personality',
  description: 'Strategy Description',
};

function computeStrategyDiffs(prev: PoolStrategy, next: PoolStrategy): StrategyDiffField[] {
  const diffs: StrategyDiffField[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const key of allKeys) {
    if (key === 'description') continue;
    const oldVal = (prev as any)[key];
    const newVal = (next as any)[key];
    if (oldVal !== newVal && newVal !== undefined) {
      let impact: 'neutral' | 'positive' | 'negative' | 'info' = 'info';
      if (key === 'minHoldMinutes' || key === 'antiWashHours' || key === 'evaluationCooldownMinutes') {
        impact = (newVal > oldVal) ? 'positive' : 'negative';
      } else if (key === 'positionSizeMultiplier') {
        impact = newVal > oldVal ? 'positive' : 'neutral';
      } else if (key === 'takeProfitTarget') {
        impact = 'info';
      }
      diffs.push({
        field: key,
        label: STRATEGY_FIELD_LABELS[key] || key,
        oldValue: oldVal,
        newValue: newVal,
        impact,
      });
    }
  }

  // Always include description change at end
  if (prev.description !== next.description) {
    diffs.push({
      field: 'description',
      label: 'Strategy Description',
      oldValue: prev.description,
      newValue: next.description,
      impact: 'info',
    });
  }

  return diffs;
}

export async function getAuditTrail(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<AuditTrailData> {
  const empty: AuditTrailData = {
    strategyChanges: [], weeklyReviews: [], timeline: [],
    poolSummaries: [], totalChanges: 0, totalReviews: 0,
    arenaStartDate: ARENA_START_DATE,
  };
  if (!adminDb) return empty;

  const arena = await getArenaConfig(userId, assetClass);
  if (!arena?.initialized) return empty;

  const allChanges: AuditStrategyChange[] = [];
  const allReviews: AuditWeeklyReview[] = [];
  const timeline: AuditEvent[] = [];
  const poolSummaries: AuditPoolSummary[] = [];

  // Arena initialization event
  timeline.push({
    id: 'arena-init',
    timestamp: arena.startDate,
    type: 'ARENA_INIT',
    poolId: 'ALL',
    poolName: 'Arena',
    poolEmoji: '🏟️',
    title: 'Arena Initialized',
    description: `4 pools deployed with $${arena.totalBudget} total budget. Tokens locked for ${ARENA_DURATION_DAYS} days.`,
  });

  for (const pool of arena.pools) {
    // Extract strategy changes
    for (const change of (pool.strategyHistory || [])) {
      const diffs = computeStrategyDiffs(change.previousStrategy, change.newStrategy);
      allChanges.push({
        poolId: pool.poolId,
        poolName: pool.name,
        poolEmoji: pool.emoji,
        week: change.week,
        changedAt: change.changedAt,
        reasoning: change.reasoning,
        diffs,
      });

      timeline.push({
        id: `sc-${pool.poolId}-${change.changedAt}`,
        timestamp: change.changedAt,
        type: 'STRATEGY_CHANGE',
        poolId: pool.poolId,
        poolName: pool.name,
        poolEmoji: pool.emoji,
        title: `Strategy Changed — ${diffs.length} parameter(s)`,
        description: change.reasoning.substring(0, 200),
        details: { diffsCount: diffs.length },
      });
    }

    // Extract weekly reviews
    for (const review of (pool.weeklyReviews || [])) {
      allReviews.push({
        poolId: pool.poolId,
        poolName: pool.name,
        poolEmoji: pool.emoji,
        week: review.week,
        timestamp: review.timestamp,
        pnl: review.pnl,
        pnlPct: review.pnlPct,
        trades: review.trades,
        wins: review.wins,
        losses: review.losses,
        strategyChanged: review.strategyChanged,
        aiReflection: review.aiReflection,
      });

      timeline.push({
        id: `wr-${pool.poolId}-${review.timestamp}`,
        timestamp: review.timestamp,
        type: 'WEEKLY_REVIEW',
        poolId: pool.poolId,
        poolName: pool.name,
        poolEmoji: pool.emoji,
        title: `AI Review — ${review.strategyChanged ? 'Strategy CHANGED' : 'No Change'}`,
        description: review.aiReflection.substring(0, 200),
        details: {
          pnlPct: review.pnlPct,
          trades: review.trades,
          wins: review.wins,
          losses: review.losses,
        },
      });
    }

    // Pool pauses
    if (pool.status === 'PAUSED' && pool.pauseReason) {
      timeline.push({
        id: `pause-${pool.poolId}`,
        timestamp: new Date().toISOString(),
        type: 'POOL_PAUSE',
        poolId: pool.poolId,
        poolName: pool.name,
        poolEmoji: pool.emoji,
        title: 'Pool Paused',
        description: pool.pauseReason,
      });
    }

    // Score history count
    const scoreHistoryCount: Record<string, number> = {};
    if (pool.scoreHistory) {
      for (const [ticker, scores] of Object.entries(pool.scoreHistory)) {
        scoreHistoryCount[ticker] = scores.length;
      }
    }

    poolSummaries.push({
      poolId: pool.poolId,
      poolName: pool.name,
      poolEmoji: pool.emoji,
      totalStrategyChanges: (pool.strategyHistory || []).length,
      totalReviews: (pool.weeklyReviews || []).length,
      totalTrades: pool.performance.totalTrades,
      currentPersonality: pool.strategy.strategyPersonality || 'MODERATE',
      scoreHistoryCount,
    });
  }

  // Add recent trades to timeline
  const trades = await getArenaTrades(userId);
  for (const trade of trades.slice(0, 50)) {
    timeline.push({
      id: `trade-${trade.id || trade.date}`,
      timestamp: trade.date,
      type: 'TRADE',
      poolId: trade.poolId,
      poolName: trade.poolName,
      poolEmoji: '',
      title: `${trade.type} ${trade.ticker}`,
      description: `$${trade.total.toFixed(2)} @ $${trade.price.toFixed(6)}${trade.pnlPct !== undefined ? ` (P&L: ${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(2)}%)` : ''}`,
      details: { reason: trade.reason },
    });
  }

  // Sort timeline by timestamp descending (newest first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Sort changes by date descending
  allChanges.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
  allReviews.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    strategyChanges: allChanges,
    weeklyReviews: allReviews,
    timeline,
    poolSummaries,
    totalChanges: allChanges.length,
    totalReviews: allReviews.length,
    arenaStartDate: ARENA_START_DATE,
  };
}

/** Get server config (simplified for arena). */
export async function getServerAgentConfig(userId: string) {
  if (!adminDb) return null;
  const doc = await adminDb.collection('agent_configs').doc(userId).get();
  if (!doc.exists) return null;
  return doc.data();
}

// ═══════════════════════════════════════════════════════════════════════════
// EOD TELEGRAM REPORT
// ═══════════════════════════════════════════════════════════════════════════

export async function sendEndOfDayTelegramReport(userId: string) {
  if (!adminDb) return { success: false };
  try {
    const arena = await getArenaConfig(userId);
    if (!arena?.initialized) return { success: false, reason: 'Arena not initialized' };

    const prices = await getVerifiedPrices(
      arena.pools.flatMap(p => p.tokens.map(t => t.toUpperCase()))
    );

    const day = getDayNumber();
    const week = getCurrentWeek();

    let leaderPool = arena.pools[0];
    let leaderValue = 0;

    const poolLines = arena.pools.map(pool => {
      const value = getPoolTotalValue(pool, prices);
      if (value > leaderValue) { leaderValue = value; leaderPool = pool; }
      const pnl = value - pool.budget;
      const pnlPct = pool.budget > 0 ? (pnl / pool.budget) * 100 : 0;
      const holdings = Object.entries(pool.holdings).map(([t, h]) => {
        const p = prices[t.toUpperCase()]?.price || 0;
        return `  ${t}: ${h.amount.toFixed(4)} @ $${smartPrice(p)}`;
      }).join('\n');
      return `${pool.emoji} <b>${pool.name}</b> [${pool.tokens.join('+')}]\nValue: $${value.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)\nCash: $${pool.cashBalance.toFixed(2)}\n${holdings || '  No holdings'}`;
    }).join('\n\n');

    const totalValue = arena.pools.reduce((sum, p) => sum + getPoolTotalValue(p, prices), 0);
    const totalPnl = totalValue - (POOL_COUNT * POOL_BUDGET);
    const totalPnlPct = ((totalPnl / (POOL_COUNT * POOL_BUDGET)) * 100);

    const msg = `🏟️ <b>SEMAPHORE ARENA — Day ${day}/28 (Week ${week})</b>\n\n` +
      `💰 Total: $${totalValue.toFixed(2)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%)\n` +
      `🏆 Leader: ${leaderPool.emoji} ${leaderPool.name}\n\n` +
      poolLines;

    const { sendSystemAlert } = await import('@/services/telegramService');
    await sendSystemAlert('ARENA EOD REPORT', msg, '🏟️');

    // Mark as sent today
    const today = new Date().toISOString().slice(0, 10);
    await adminDb.collection('agent_configs').doc(userId).update({
      telegramLastReportDate: today,
    });

    return { success: true };
  } catch (e: any) {
    console.error('[EOD] Report failed:', e.message);
    return { success: false, error: e.message };
  }
}
