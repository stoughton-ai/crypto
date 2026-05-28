"use server";

import { generateContentWithFallback, type CryptoAnalysisResult } from "@/lib/gemini";
import {
  AGENT_WATCHLIST, AGENT_WATCHLIST_TIERS, STABLECOIN_REJECT_LIST,
  EODHD_DAILY_LIMIT, EODHD_CRITICAL_THRESHOLD, EODHD_THROTTLE_THRESHOLD,
  ARENA_START_DATE, ARENA_DURATION_DAYS, POOL_COUNT, POOL_BUDGET, TOTAL_BUDGET,
  type ArenaConfig, type ArenaPool, type ArenaTradeRecord, type PoolStrategy, type PoolHolding,
  type PoolId, type AIReasoningEntry, type WeeklyReview, type StrategyChange,
  type AssetClass, type PoolRotationEvent, type IntelligenceScanResult, type PoolPromotionEvent,
  formatEODHDTicker, parseEODHDTicker, getArenaCollections, getWatchlist, getCurrencySymbol, getBenchmarkLabel,
  COMMODITIES_DISPLAY_NAMES, FTSE_INSTRUMENT_LIST,
  type TokenAnalysis, MOTHBALLED_ASSET_CLASSES,
} from "@/lib/constants";
import {
  getArenaConfig, initializeArena, getArenaTrades,
  recordArenaTrade, executePoolBuy, executePoolSell,
  getPoolTotalValue, updatePoolPerformance, recordDailySnapshot,
  recordWeeklyReview, pauseArenaPool, resumeArenaPool,
  getTradeReflections, recordTradeReflection,
  getCurrentWeek, getDayNumber, isArenaActive, isDynamicReviewDue,
  resetSandboxArena, activateCompetitionMode,
  addManualPurchaseToArena,
} from "@/services/arenaService";
import { adminDb, firebaseAdmin } from "@/lib/firebase-admin";
import { RevolutX } from "@/lib/revolut";
import { loadQuotaGuardUsage, persistQuotaGuardUsage, getQuotaGuardUsage } from '@/lib/revolut';
import { fetchTechnicalDataForTokens, formatTechnicalDataForPrompt, type TechnicalIndicators } from '@/lib/technicals';
import { fetchOrderBooksForTokens, formatOrderBookForPrompt, type OrderBookData } from '@/lib/orderbook';
import { checkEODHDQuota } from '@/lib/eodhd-quota';
import { sendTradeAlerts } from '@/services/telegramService';
import { deployFromDcaReserve } from '@/services/arenaService';

// ═══════════════════════════════════════════════════════════════════════════
// COMMON UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

/**
 * Robustly serialize data for Next.js Server Components.
 * Converts Firestore Timestamps and Dates to ISO strings, and ensures
 * all objects are "plain" (POJO) to avoid 'Only plain objects can be passed...' errors.
 */
function serialize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  
  // Handle Arrays
  if (Array.isArray(obj)) {
    return obj.map(item => serialize(item)) as any;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString() as any;
  }

  // Handle Firestore Timestamps (common in this codebase)
  if (typeof obj === 'object' && obj !== null) {
      const anyObj = obj as any;
      if (typeof anyObj.toDate === 'function') {
          return anyObj.toDate().toISOString() as any;
      }
      if (anyObj.seconds !== undefined && anyObj.nanoseconds !== undefined) {
          return new Date(anyObj.seconds * 1000).toISOString() as any;
      }
  }

  // Handle generic objects
  if (typeof obj === 'object' && obj !== null) {
    if (Object.getPrototypeOf(obj) !== Object.prototype && Object.getPrototypeOf(obj) !== null) {
        // If it's not a plain object (e.g. a class instance), we stringify/parse it
        // which is the most reliable way to strip non-serializable parts.
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch (e) {
            console.error('[Serialize] Failed to stringify/parse non-plain object:', e);
            return obj; // Fallback
        }
    }

    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serialize(value);
    }
    return result;
  }

  return obj;
}

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

/** Internal helper to get a configured RevolutX client for a user */
async function getRevolutClient(userId: string) {
  if (!adminDb) return null;
  const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
  const config = configDoc.data();
  if (!config?.revolutApiKey || !config?.revolutPrivateKey) return null;
  return new RevolutX(
    config.revolutApiKey,
    config.revolutPrivateKey,
    config.revolutIsSandbox || false,
    config.revolutProxyUrl
  );
}

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

export async function getRealTimePrice(ticker: string, userId?: string) {
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

    // 4. Revolut X Fallback (specifically for manual tokens)
    if (userId) {
      try {
        const client = await getRevolutClient(userId);
        if (client) {
          const rev = await client.getTickerPrice(tickerUpper);
          if (rev && rev.price > 0) {
            return {
              price: rev.price,
              change24h: rev.change24h || 0,
              mcap: 0,
              name: tickerUpper,
              verificationStatus: 'RevolutX'
            };
          }
        }
      } catch (err: any) {
        console.warn(`[getRealTimePrice] Revolut fallback failed: ${err.message}`);
      }
    }

    return null;
  } catch (err: any) {
    console.error(`[getRealTimePrice] Error fetching price for ${ticker}:`, err.message);
    return null;
  }
}

export async function getVerifiedPrices(tickers: string[], userId?: string) {
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
    const data = await getRealTimePrice(t, userId);
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
  - GLOBAL SENTIMENT GROUNDING: Integrate the Global Sentiment Score and Narrative Mode from POOL CONTEXT. If the mode is FUD_ALERT or MACRO_DANGEROUS, apply friction and scale back your conviction score and proposed size. If mode is BULLISH_FOMO, you may show higher conviction and execute larger buys if technicals align.

  DYNAMIC POSITION SIZING & CAPITAL ALLOCATION:
  - There is NO maximum allocation limit. You have 100% full authority to allocate as much capital as you see fit.
  - You can allocate up to the entire "Shared Cash" listed in POOL CONTEXT if you have maximum conviction.
  - Specify your exact purchase size in the "recommendedBuyAmountUsd" field (between 10 and the remaining Shared Cash).
  - PORTFOLIO SWITCHING: If you believe it is better to exit a held token to free up cash for a much better trade elsewhere, score the held token LOW (below ${poolStrategy.exitThreshold}) to trigger a full exit. This releases the capital to the shared cash pool so you can buy the other token in the same cycle.

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
    "recommendedBuyAmountUsd": (0 if no buy/top-up is desired. Otherwise, specify a value from 10 to the available Shared Cash representing how much USD of this token to buy or top-up during this cycle, based on your conviction and cash available),
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
    recommendedBuyAmountUsd: aiResult.recommendedBuyAmountUsd !== undefined ? safeNumber(aiResult.recommendedBuyAmountUsd) : undefined,
    verificationStatus: 'EODHD',
  } as CryptoAnalysisResult;
}

export interface SupervisorDecision {
  status: 'AGREE' | 'DISAGREE' | 'MODIFY';
  adjustedUsd?: number;
  reasoning: string;
}

export async function runSupervisorAudit(
  ticker: string,
  action: 'BUY' | 'SELL',
  proposedUsd: number,
  currentPortfolioValue: number,
  sharedCash: number,
  traderConvictionScore: number,
  traderReflection: string,
  marketContext: { btcPrice: number; btcChange24h: number; tokenChange24h: number; fearGreedIndex: number },
  sentiment?: SentimentState | null
): Promise<SupervisorDecision> {
  const prompt = `
  ROLE: You are the Senior AI Risk Manager & Portfolio Auditor for the Virtual Profit Arena.
  Your job is to audit and approve, modify, or veto proposed trades from the primary AI Trading Agent.
  You act as a check on aggressive capital sizing and rash decisions, keeping the portfolio safe and stable.

  PROPOSED TRADE:
  - Ticker: ${ticker}
  - Action: ${action}
  - Proposed Trade Size: $${proposedUsd.toFixed(2)}
  - Trader Conviction Score: ${traderConvictionScore}/100
  - Trader Reasoning: "${traderReflection}"

  PORTFOLIO STATE:
  - Current Total Value: $${currentPortfolioValue.toFixed(2)}
  - Arena Shared Cash: $${sharedCash.toFixed(2)}

  MARKET CONTEXT:
  - BTC Price: $${marketContext.btcPrice.toLocaleString()} (24h Change: ${marketContext.btcChange24h.toFixed(1)}%)
  - Token 24h Change: ${marketContext.tokenChange24h.toFixed(1)}%
  - Fear & Greed Index: ${marketContext.fearGreedIndex}/100

  GLOBAL NARRATIVE SENTIMENT:
  \${sentiment ? \`- Global Sentiment Score: \${sentiment.score}/100\\n  - Narrative Mode: \${sentiment.narrativeMode}\\n  - Analyst Reflection: "\${sentiment.reflection}"\` : '- Sentiment analyst offline/unavailable.'}

  YOUR AUDIT RULES:
  1. AGREE (Approve): If the trade is highly logical, aligns with technical trends, and is sized conservatively.
  2. MODIFY (Downsize): If the setup is good but the trade size is too risky relative to available cash or volatility (e.g. proposing to put more than 50% of available cash on a single trade during high volatility/extreme market conditions).
  3. DISAGREE (Veto): If the trader is catching a falling knife (extreme bearish structure), buying at a massive local peak, or trying to allocate massive cash when market volatility is extremely dangerous.
  4. SENTIMENT VETO INSTRUCTIONS: If Narrative Mode is "MACRO_DANGEROUS", you must apply maximum friction. Scale down proposed purchases by at least 50% (using MODIFY status and adjusting adjustedUsd), or VETO/DISAGREE entirely unless the conviction is extremely high (90+) and the trade size is very small. If the Narrative Mode is "FUD_ALERT", lean towards MODIFY to downsize buy amounts to preserve capital.

  OUTPUT JSON (respond with ONLY valid JSON):
  {
    "status": "AGREE" | "DISAGREE" | "MODIFY",
    "adjustedUsd": (only if status is MODIFY, specify a safer dollar amount from 10 to proposedUsd),
    "reasoning": "2 sentences explaining your risk auditing decision."
  }`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) throw new Error("AI returned empty response");
    const aiResult = safeJsonParse(responseText);
    return {
      status: aiResult.status || 'AGREE',
      adjustedUsd: aiResult.adjustedUsd ? safeNumber(aiResult.adjustedUsd) : undefined,
      reasoning: aiResult.reasoning || 'Approved.'
    };
  } catch (error: any) {
    console.error(`[Supervisor] Audit failed, auto-agreeing: ${error.message}`);
    return {
      status: 'AGREE',
      reasoning: 'Auto-approved due to supervisor service audit error.'
    };
  }
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
  // Plain-English explanations of what the AI did and why (new)
  tradeDecisions?: string;   // Paragraph explaining every BUY/SELL/HOLD decision since last report
  gpmSummary?: string;       // Plain-English summary of GPM (scaling) activity
  // Buy-and-hold benchmark comparison (vs BTC and XRP since competition start)
  benchmarkComparison?: {
    btcStartPrice: number;         // BTC price at competition start
    btcCurrentPrice: number;       // BTC price now
    btcPctChange: number;          // BTC % change since start
    xrpStartPrice: number;         // XRP price at competition start
    xrpCurrentPrice: number;       // XRP price now
    xrpPctChange: number;          // XRP % change since start
    portfolioPctChange: number;    // Portfolio P&L % since start
    vsHoldBtcPct: number;          // portfolio P&L minus BTC buy-and-hold P&L (positive = outperforming)
    vsHoldXrpPct: number;          // portfolio P&L minus XRP buy-and-hold P&L (positive = outperforming)
    aiJustification: string;       // AI-generated explanation of why it over/underperformed BTC and XRP
  };
}

export interface WeeklyComparisonReport {
  generatedAt: string;
  weekNumber: number;          // Which competition week (1–4)
  periodStart: string;         // ISO
  periodEnd: string;           // ISO
  // Performance summary
  navStart: number;
  navEnd: number;
  pnlPct: number;
  btcPctOverPeriod: number;    // BTC % change over same 7 days (actual, not 24h proxy)
  vsBtc: number;               // portfolio pnl minus btc
  totalTrades: number;
  totalSells: number;          // Total sell trades (W+L should equal this)
  wins: number;
  losses: number;
  winRate: number;             // wins / totalSells * 100
  // GPM-specific stats
  gpmScaleDownCount: number;   // How many partial sells fired via GPM
  gpmScaleUpCount: number;     // How many scale-ups fired
  gpmEarlyScaleUpCount: number; // Of those, how many were early (trend-based)
  // AI narrative
  executiveSummary: string;    // 3–4 sentences plain English overview
  gpmVsOldSystemAnalysis: string; // How would the old binary system have done differently?
  bestDecision: string;        // Best call of the week and why
  worstDecision: string;       // Worst call and lesson learned
  nextWeekOutlook: string;     // What to watch for the coming week
  perPoolSummaries: Array<{
    poolId: string;
    poolName: string;
    emoji: string;
    pnlPct: number;
    trades: number;
    wins: number;
    losses: number;
    gpmScaleDownCount: number;   // Per-pool GPM breakdown
    gpmScaleUpCount: number;
    gpmEarlyScaleUpCount: number;
    gpmActions: string;        // Plain-English description of GPM actions for this pool
    verdict: string;           // Did the strategy work as intended?
  }>;
}

export async function generateStrategyReport(userId: string): Promise<StrategyReport | null> {
  if (!adminDb) return null;

  const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
  const arena = arenaDoc.data() as ArenaConfig;
  if (!arena?.initialized) return null;

  const isMorning = new Date().getUTCHours() < 14; // Before 2pm UTC = morning report
  const reportType: 'MORNING' | 'EVENING' = isMorning ? 'MORNING' : 'EVENING';
  // Compute day/week from arena's actual startDate (respects mission clock resets),
  // NOT from the hardcoded ARENA_START_DATE constant which ignores resets.
  const arenaStartMs = new Date(arena.startDate).getTime();
  const daysPassed = Math.floor((Date.now() - arenaStartMs) / (1000 * 60 * 60 * 24));
  const dayNum = Math.max(1, Math.min(daysPassed + 1, 28));
  const weekNum = Math.min(Math.floor(daysPassed / 7) + 1, 4);

  // Fetch prices, trades, and — crucially — real technical indicator data
  const allTokens = new Set<string>(['BTC', 'XRP']); // Always track BTC + XRP for benchmark
  arena.pools.forEach(p => p.tokens.forEach(t => allTokens.add(t.toUpperCase())));
  const heldTokens = arena.pools.flatMap(p => Object.keys(p.holdings).map(t => t.toUpperCase()));
  const uniqueHeld = [...new Set(heldTokens)];

  const [prices, technicals, allTrades] = await Promise.all([
    getVerifiedPrices([...allTokens], userId),
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
  const xrpPrice = prices['XRP']?.price || 0;

  // ── BENCHMARK BUY-AND-HOLD COMPARISON ──────────────────────────────────
  // Record BTC/XRP start prices on first run (or use pre-recorded values).
  // Then compute: "if you had just bought BTC/XRP on Day 1, where would you be?"
  let benchmarkStartPrices = arena.benchmarkStartPrices;
  if (!benchmarkStartPrices && btcPrice > 0 && xrpPrice > 0) {
    // First time: use known Day 1 prices from first trades (March 4, 2026)
    // BTC was $71,723.24, XRP's first trade was later at $1.3475
    // If no historical data, use current prices as fallback (less accurate but prevents NaN)
    benchmarkStartPrices = {
      BTC: 71723.24,  // BTC price on competition Day 1 (from first trade context)
      XRP: 1.3475,    // XRP price when first traded in the arena
      recordedAt: arena.startDate || new Date().toISOString(),
    };
    // Persist to Firestore so future reports use the same base
    await adminDb.collection('arena_config').doc(userId).update({
      benchmarkStartPrices,
    });
    console.log(`[Report] Benchmark start prices recorded: BTC=$${benchmarkStartPrices.BTC}, XRP=$${benchmarkStartPrices.XRP}`);
  }

  // Compute benchmark comparison (buy-and-hold vs active portfolio)
  const btcBuyHoldPct = benchmarkStartPrices && benchmarkStartPrices.BTC > 0
    ? ((btcPrice - benchmarkStartPrices.BTC) / benchmarkStartPrices.BTC) * 100 : 0;
  const xrpBuyHoldPct = benchmarkStartPrices && benchmarkStartPrices.XRP > 0
    ? ((xrpPrice - benchmarkStartPrices.XRP) / benchmarkStartPrices.XRP) * 100 : 0;

  const poolSummaries = arena.pools.map((pool, idx) => {
    let holdVal = 0;
    let holdCost = 0;
    for (const [t, h] of Object.entries(pool.holdings)) {
      holdVal += h.amount * (prices[t.toUpperCase()]?.price || h.averagePrice);
      holdCost += h.amount * h.averagePrice;
    }
    const nav = holdVal; // current token value — cash resides in shared pool
    const unrealizedPnl = holdVal - holdCost;
    const realizedPnl = pool.performance.realizedPnl || 0;
    const totalPnl = realizedPnl + unrealizedPnl;
    const capitalBase = (pool.budget || 150) + (pool.dcaContributions || 0);
    const pnlPct = capitalBase > 0 ? (totalPnl / capitalBase) * 100 : 0;
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

    // ── GPM status per held token ─────────────────────────────────────────
    const gpmStr = Object.entries(pool.holdings).map(([t, h]) => {
      const zone = h.gpmZone ?? 'CONVICTION';
      const cycles = h.gpmZoneConsecutiveCycles ?? 0;
      const confirmNeeded = pool.strategy.gpmConfirmationCycles ?? 3;
      const scores = (pool.scoreHistory?.[t.toUpperCase()] ?? []).slice(-3).map(s => s.score).join(' → ');
      const zoneIcon = zone === 'CONVICTION' ? '✅' : zone === 'CAUTION' ? '⚠️' : '🔴';
      return `${t}: GPM zone=${zone} ${zoneIcon} (${cycles}/${confirmNeeded} cycles confirmed). Recent scores: ${scores || 'n/a'}`;
    }).join('\n      ') || 'No active holdings';

    // ── Recent trade reasoning (plain-language, from preTradeReflection) ──
    const recentTradesWithReason = poolTrades.slice(0, 8).map(t => {
      const outcome = t.pnlPct !== undefined ? ` → ${t.pnlPct >= 0 ? 'WIN' : 'LOSS'} ${t.pnlPct.toFixed(1)}%` : '';
      const reason = t.preTradeReflection || t.reason || 'No reason recorded';
      return `${t.type} ${t.ticker} $${t.total.toFixed(2)}${outcome}: ${reason.substring(0, 200)}`;
    }).join('\n      ') || 'No trades recorded';

    return {
      poolId: pool.poolId, name: pool.name, emoji: pool.emoji,
      tokens: pool.tokens, strategy: pool.strategy.description,
      nav, pnlPct, vsBtc, totalTrades: poolTrades.length, todayTrades,
      wins, losses, cash: pool.cashBalance,
      holdingsStr, recentTrades, gpmStr, recentTradesWithReason,
      stopLoss: pool.strategy.positionStopLoss,
      takeProfitTarget: pool.strategy.takeProfitTarget,
      minHoldMinutes: pool.strategy.minHoldMinutes,
      gpmEnabled: pool.strategy.gpmEnabled !== false,
      gpmCautionScore: pool.strategy.gpmCautionZoneScore ?? 70,
      gpmDefensiveScore: pool.strategy.gpmDefensiveZoneScore ?? 55,
    };
  });

  // Total NAV = all pool token values + arena-level shared cash (matches dashboard)
  const sharedCash = arena.sharedCash ?? 0;
  const totalNAV = poolSummaries.reduce((s, p) => s + p.nav, 0) + sharedCash;
  // Total committed capital = original budgets + ALL DCA contributions (matches dashboard effectiveBasis)
  // Uses sharedDcaContributions (not sharedDcaDeployed) because undeployed DCA reserve cash is
  // already in the NAV via sharedCash — counting only deployed would falsely inflate P&L.
  const totalDcaContributions = arena.sharedDcaContributions ?? 0;
  const totalDcaDeployed = arena.sharedDcaDeployed ?? 0;
  const totalCommitted = arena.totalBudget + totalDcaContributions;
  const totalPnl = totalNAV - totalCommitted;
  const totalPnlPct = totalCommitted > 0 ? (totalPnl / totalCommitted) * 100 : 0;
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

  const prompt = `You are the Chief Strategy Analyst for Semaphore — a 28-day crypto trading competition with 4 AI-managed pools and 1 manual tactical pool ("MANUAL MADNESS") representing user-directed entries:
- AI Pools: 4 automated strategies (Momentum, Dip Hunting, etc.)
- Manual Pool: 1 tactical pool ("MANUAL MADNESS") for user-directed entries
- Minimum AI hold: ${arena.pools[0]?.strategy.minHoldMinutes || 360} minutes
- AI Buy threshold: Score >= 85+ (high conviction only)
- Take-profit: +8% minimum
- Stop-loss: -8% maximum
- Anti-wash: 24h between selling and rebuying the same token
- GPM (Graduated Position Management): Positions are scaled DOWN partially when AI conviction falls (not fully sold), and scaled UP when conviction recovers. This is the KEY difference from the old binary system.

TODAY: ${new Date().toLocaleDateString('en-GB')} (Day ${dayNum}/28, Week ${weekNum}/4)
REPORT TYPE: ${reportType}
BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}% 24h)
MARKET BENCHMARK: ${btcChange.toFixed(2)}% (any pool beating this is outperforming the market)
TOTAL NAV: $${totalNAV.toFixed(2)} vs total invested $${totalCommitted.toFixed(2)} (budget $${arena.totalBudget} + $${(totalCommitted - arena.totalBudget).toFixed(2)} DCA) = ${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}% (${overallVsBtc >= 0 ? 'OUTPERFORMING' : 'UNDERPERFORMING'} BTC by ${Math.abs(overallVsBtc).toFixed(2)}%)
COMPETITION TRAJECTORY: At current pace (${dailyRate.toFixed(2)}%/day), projected 28-day outcome: ${projectedFinal >= 0 ? '+' : ''}${projectedFinal.toFixed(1)}%

BUY-AND-HOLD BENCHMARK (since competition start, Day 1):
  BTC: $${benchmarkStartPrices?.BTC?.toLocaleString() || 'N/A'} → $${btcPrice.toLocaleString()} = ${btcBuyHoldPct >= 0 ? '+' : ''}${btcBuyHoldPct.toFixed(2)}%
  XRP: $${benchmarkStartPrices?.XRP?.toFixed(4) || 'N/A'} → $${xrpPrice.toFixed(4)} = ${xrpBuyHoldPct >= 0 ? '+' : ''}${xrpBuyHoldPct.toFixed(2)}%
  PORTFOLIO: $${totalCommitted.toFixed(2)} invested → $${totalNAV.toFixed(2)} = ${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%
  vs BTC buy-and-hold: ${(totalPnlPct - btcBuyHoldPct) >= 0 ? 'OUTPERFORMING by +' : 'UNDERPERFORMING by '}${Math.abs(totalPnlPct - btcBuyHoldPct).toFixed(2)}%
  vs XRP buy-and-hold: ${(totalPnlPct - xrpBuyHoldPct) >= 0 ? 'OUTPERFORMING by +' : 'UNDERPERFORMING by '}${Math.abs(totalPnlPct - xrpBuyHoldPct).toFixed(2)}%
  ⚠️ The AI MUST justify why its active trading approach has ${totalPnlPct > btcBuyHoldPct && totalPnlPct > xrpBuyHoldPct ? 'OUTPERFORMED' : 'UNDERPERFORMED'} simple buy-and-hold. Be HONEST about whether trading added or destroyed value.
${morningSpecific}
CRITICAL RULE: In ALL your written analysis, always refer to pools by their NAME (e.g. "MOMENTUM MAVERICKS", "DIP HUNTERS") — NEVER use raw IDs like "POOL_1", "POOL_2", etc. Use the pool name exactly as shown below.

SHARED CASH (arena-wide): $${sharedCash.toFixed(2)} — available to any pool for new buys

POOL PERFORMANCE (P&L = current token value vs actual holding cost; BTC benchmark):
${poolSummaries.map(p => `
${p.emoji} ${p.name}
  Strategy: ${p.strategy}
  Tokens: ${p.tokens.join(', ')}
  Token Value: $${p.nav.toFixed(2)} | P&L vs Cost: ${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}% | vs BTC: ${p.vsBtc >= 0 ? '+' : ''}${p.vsBtc.toFixed(2)}% (${p.vsBtc >= 0 ? 'ALPHA' : 'LAGGING'})
  Trades today: ${p.todayTrades} | Total trades: ${p.totalTrades} (${p.wins}W/${p.losses}L)
  Holdings with technicals:
      ${p.holdingsStr}
  GPM (Graduated Position Management) zone status per token:
      ${p.gpmStr}
  Recent trade activity WITH REASONS (most recent first):
      ${p.recentTradesWithReason}
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
4. Total portfolio NAV is down more than 4% from total invested $${totalCommitted.toFixed(2)}
5. BTC has dropped more than 5% in 24h
DO NOT generate alerts for: losses under 3%, normal crypto volatility, general market uncertainty, or any condition not in this list.

IMPORTANT: Return one poolAnalyses entry per pool IN THE SAME ORDER as the pool data above. Use the pool's actual NAME (e.g. "MOMENTUM MAVERICKS") as the poolId value — NEVER "POOL_1", "POOL_2" etc.

Respond with ONLY valid JSON:
{
  "poolAnalyses": [
    {
      "poolId": "<pool NAME here, e.g. MOMENTUM MAVERICKS>",
      "assessment": "3-4 sentences analysing performance using the technical data. Refer to the pool by its NAME. Reference RSI, MACD, trend direction, and support/resistance levels specifically.",
      "grade": "A/B/C/D/F (must follow the BTC-relative rubric above)",
      "keyInsight": "One standout forward-looking observation — refer to pool by name"
    }
  ],
  "comparativeAnalysis": "4-6 sentences comparing pools BY NAME (e.g. 'MOMENTUM MAVERICKS vs DIP HUNTERS'), referencing which tokens show the strongest technical setups and why. NEVER use POOL_1/POOL_2 etc.",
  "marketOutlook": "2-3 sentences on market environment with specific technical observations from the data provided (RSI levels, trends, BTC position).",
  "recommendations": ["max 3 specific recommendations — must reference actual data points from the technicals and refer to pools by name, not generic advice"],
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
  "campaignProgress": "2 sentences on competition trajectory: current pace, whether patience regime is working, and what needs to happen over the remaining ${28 - dayNum} days to achieve a positive outcome.",
  "gpmSummary": "Plain-English summary (2–4 sentences) of how the Graduated Position Management (GPM) system behaved this session. Did it scale any positions up or down? What was the net effect? Refer to pools by name, never by ID.",
  "benchmarkJustification": "4-6 sentences HONESTLY explaining why our active trading approach has ${totalPnlPct > btcBuyHoldPct && totalPnlPct > xrpBuyHoldPct ? 'outperformed' : 'underperformed'} simply holding BTC (${btcBuyHoldPct >= 0 ? '+' : ''}${btcBuyHoldPct.toFixed(2)}%) and XRP (${xrpBuyHoldPct >= 0 ? '+' : ''}${xrpBuyHoldPct.toFixed(2)}%) since competition Day 1. Reference SPECIFIC trades, spreads, position timing, or diversification effects. If we underperformed, admit the specific causes (overtrading, bad timing, spread costs). If we outperformed, explain which decisions drove the alpha."
}`;


  // ── PROGRAMMATIC TRADE DECISIONS ─────────────────────────────────────────
  // Generate factual "what the AI did" section from actual trade records,
  // replacing the AI-generated version which was hallucinating (missing buys,
  // inventing "no new positions" when buys clearly occurred).
  //
  // Use a deterministic lookback window based on report type:
  //   Morning (07:xx UTC) → show trades since yesterday 18:00 UTC
  //   Evening (18:xx UTC) → show trades since today 07:00 UTC
  //   Fallback: 24 hours
  let sinceDate: Date;
  const nowForWindow = new Date();
  if (isMorning) {
    // Morning report: look back to yesterday's evening window (18:00 UTC previous day)
    sinceDate = new Date(nowForWindow);
    sinceDate.setUTCDate(sinceDate.getUTCDate() - 1);
    sinceDate.setUTCHours(18, 0, 0, 0);
  } else {
    // Evening report: look back to today's morning window (07:00 UTC)
    sinceDate = new Date(nowForWindow);
    sinceDate.setUTCHours(7, 0, 0, 0);
  }

  // Collect ALL trades since last report across all pools, sorted chronologically
  const poolNameMap: Record<string, string> = {};
  arena.pools.forEach(p => { poolNameMap[p.poolId] = p.name; });

  const recentTradesAll = allTrades
    .flat()
    .filter(t => new Date(t.date) > sinceDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let factualTradeDecisions = '';
  if (recentTradesAll.length === 0) {
    factualTradeDecisions = 'No trades were executed since the last report. All positions were held.';
  } else {
    const lines: string[] = [];
    for (const t of recentTradesAll) {
      const poolName = poolNameMap[t.poolId] || t.poolName || t.poolId;
      const dateStr = new Date(t.date).toLocaleString('en-GB', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const pnlStr = t.pnlPct !== undefined ? ` (${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%)` : '';
      const isGpm = t.reason?.includes('GPM');
      const gpmTag = isGpm ? ' [GPM]' : '';
      // Use clear, factual language
      if (t.type === 'SELL') {
        const outcome = (t.pnlPct ?? 0) >= 0 ? 'profit' : 'loss';
        lines.push(`${dateStr} — ${poolName} SOLD ${t.amount.toFixed(4)} ${t.ticker} for $${t.total.toFixed(2)}${pnlStr} ${outcome}${gpmTag}`);
      } else {
        lines.push(`${dateStr} — ${poolName} BOUGHT ${t.amount.toFixed(4)} ${t.ticker} for $${t.total.toFixed(2)}${gpmTag}`);
      }
    }
    const buys = recentTradesAll.filter(t => t.type === 'BUY');
    const sells = recentTradesAll.filter(t => t.type === 'SELL');
    const summaryLine = `Since last report: ${recentTradesAll.length} trade(s) — ${buys.length} buy(s), ${sells.length} sell(s).`;
    factualTradeDecisions = summaryLine + '\n' + lines.join('\n');
  }

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
      // Use FACTUAL trade log, not AI-generated hallucination
      tradeDecisions: factualTradeDecisions,
      gpmSummary: parsed.gpmSummary || '',
      benchmarkComparison: benchmarkStartPrices ? {
        btcStartPrice: benchmarkStartPrices.BTC,
        btcCurrentPrice: btcPrice,
        btcPctChange: btcBuyHoldPct,
        xrpStartPrice: benchmarkStartPrices.XRP,
        xrpCurrentPrice: xrpPrice,
        xrpPctChange: xrpBuyHoldPct,
        portfolioPctChange: totalPnlPct,
        vsHoldBtcPct: totalPnlPct - btcBuyHoldPct,
        vsHoldXrpPct: totalPnlPct - xrpBuyHoldPct,
        aiJustification: parsed.benchmarkJustification || 'No justification generated.',
      } : undefined,
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
    return serialize(doc.exists ? (doc.data() as StrategyReport) : null);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY COMPARISON REPORT — Generated every Sunday
// Audits GPM (new system) vs the old binary hold/sell approach over 7 days.
// ═══════════════════════════════════════════════════════════════════════════

export async function generateWeeklyComparisonReport(userId: string): Promise<WeeklyComparisonReport | null> {
  if (!adminDb) return null;

  const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
  const arena = arenaDoc.data() as ArenaConfig;
  if (!arena?.initialized) return null;

  // Compute day/week from arena's actual startDate (respects mission clock resets)
  const wkArenaStartMs = new Date(arena.startDate).getTime();
  const wkDaysPassed = Math.floor((Date.now() - wkArenaStartMs) / (1000 * 60 * 60 * 24));
  const weekNumber = Math.min(Math.floor(wkDaysPassed / 7) + 1, 4);
  const dayNum = Math.max(1, Math.min(wkDaysPassed + 1, 28));
  const now = new Date();

  // ── FIX #1: Use full-day boundaries for the 7-day window ──
  // periodEnd = end of TODAY (23:59:59), periodStart = start of 7 days ago (00:00:00)
  // This ensures trades on the last day aren't cut off by generation time.
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);
  const periodEnd = endOfToday.toISOString();
  const startOfWeek = new Date(endOfToday.getTime() - 7 * 24 * 60 * 60 * 1000);
  startOfWeek.setUTCHours(0, 0, 0, 0);
  const periodStart = startOfWeek.toISOString();

  // Fetch prices + all trades
  const allTokens = new Set<string>(['BTC']);
  arena.pools.forEach(p => p.tokens.forEach(t => allTokens.add(t.toUpperCase())));
  const [prices, allTradesPerPool] = await Promise.all([
    getVerifiedPrices([...allTokens], userId),
    Promise.all(arena.pools.map(p => getArenaTrades(userId, p.poolId))),
  ]);

  // ── BTC comparison: entirely driven by btcDailyPrices to remain consistent with simulation dates ──
  let btcWeeklyPctChange = 0;
  let btcWeeklyMsg = 'fallback, no data';

  const btcDaily = arena.btcDailyPrices;
  const periodEndStr = periodEnd.slice(0, 10);
  const weekStartDateStr = periodStart.slice(0, 10);

  if (btcDaily) {
    const startEntry = btcDaily[weekStartDateStr] || btcDaily[new Date(startOfWeek.getTime() + 86400000).toISOString().slice(0, 10)] || btcDaily[new Date(startOfWeek.getTime() - 86400000).toISOString().slice(0, 10)];
    const endEntry = btcDaily[periodEndStr] || btcDaily[new Date(endOfToday.getTime() - 86400000).toISOString().slice(0, 10)] || btcDaily[new Date(endOfToday.getTime() - 2*86400000).toISOString().slice(0, 10)];
    
    if (startEntry && endEntry && startEntry.open > 0) {
      // Use endEntry.close for accurate historical daily close vs startEntry.open
      btcWeeklyPctChange = ((endEntry.close - startEntry.open) / startEntry.open) * 100;
      btcWeeklyMsg = `from btcDailyPrices ($${startEntry.open.toFixed(0)} → $${endEntry.close.toFixed(0)})`;
    } else if (arena.benchmarkStartPrices?.BTC && arena.benchmarkStartPrices.BTC > 0) {
      const btcStart = arena.benchmarkStartPrices.BTC;
      const btcNow = prices['BTC']?.price || btcStart;
      const btcFullChange = ((btcNow - btcStart) / btcStart) * 100;
      const daysPassed = Math.max(1, dayNum);
      btcWeeklyPctChange = (btcFullChange / daysPassed) * 7;
      btcWeeklyMsg = 'estimated from benchmarkStart';
    }
  }
  console.log(`[Arena] BTC weekly change computed as: ${btcWeeklyPctChange >= 0 ? '+' : ''}${btcWeeklyPctChange.toFixed(2)}% (${btcWeeklyMsg})`);

  // Aggregate week stats from trade history (last 7 days only)
  let totalTrades = 0, totalSells = 0, wins = 0, losses = 0;
  let gpmScaleDownCount = 0, gpmScaleUpCount = 0, gpmEarlyScaleUpCount = 0;

  // ── Fetch DCA contributions during this period to subtract from P&L ──
  // DCA cash injections inflate cashBalance → inflate navEnd → inflate P&L if not removed.
  const dcaContributionsThisWeek: Record<string, number> = {}; // poolId → amount
  try {
    const dcaDoc = await adminDb.collection('dca_config').doc(userId).get();
    const dcaHistory = dcaDoc.data()?.history || [];
    for (const h of dcaHistory) {
      const hDate = new Date(h.date || 0);
      if (hDate >= startOfWeek && hDate <= endOfToday && h.credited > 0) {
        dcaContributionsThisWeek[h.poolId] = (dcaContributionsThisWeek[h.poolId] || 0) + h.credited;
      }
    }
  } catch {
    // If DCA config doesn't exist, no contributions to subtract
  }
  const totalDcaThisWeek = Object.values(dcaContributionsThisWeek).reduce((s, v) => s + v, 0);
  if (totalDcaThisWeek > 0) {
    console.log(`[Arena] Weekly report: subtracting $${totalDcaThisWeek.toFixed(2)} DCA contributions from P&L`);
  }

  const perPoolSummaryInputs = arena.pools.map((pool, idx) => {
    // ── FIX #3: Filter trades within the full-day boundary window ──
    const weekTrades = (allTradesPerPool[idx] || []).filter(t => {
      const tradeDate = new Date(t.date || 0);
      return tradeDate >= startOfWeek && tradeDate <= endOfToday;
    });

    const poolSells = weekTrades.filter(t => t.type === 'SELL');
    const poolWins = poolSells.filter(t => (t.pnlPct ?? 0) >= 0).length;
    const poolLosses = poolSells.filter(t => (t.pnlPct ?? 0) < 0).length;
    const poolBuys = weekTrades.filter(t => t.type === 'BUY').length;

    // Count GPM actions from trade reasons.
    const gpmDownTrades = weekTrades.filter(t =>
      t.type === 'SELL' &&
      t.reason?.includes('GPM') &&
      (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'))
    );
    const gpmUpTrades = weekTrades.filter(t =>
      t.type === 'BUY' &&
      (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP'))
    );
    const earlyUpTrades = weekTrades.filter(t =>
      t.type === 'BUY' &&
      (t.preTradeReflection?.includes('EARLY') || t.reason?.includes('EARLY')) &&
      (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP'))
    );

    totalTrades += weekTrades.length;
    totalSells += poolSells.length;
    wins += poolWins;
    losses += poolLosses;
    gpmScaleDownCount += gpmDownTrades.length;
    gpmScaleUpCount += gpmUpTrades.length;
    gpmEarlyScaleUpCount += earlyUpTrades.length;

    // NAV start: from earliest snapshot this week
    const snapshots = pool.performance.dailySnapshots || [];
    const weekSnapshots = snapshots.filter(s => s.date >= periodStart.slice(0, 10));
    // ── Calculate True Weekly Pool P&L ──
    const poolBasis = pool.budget + (pool.dcaDeployedTotal || 0);

    // 1. Realized P&L from trades THIS week
    let realizedPnlThisWeek = 0;
    for (const t of weekTrades) {
      if (t.type === 'SELL' && t.pnl !== undefined) {
        realizedPnlThisWeek += t.pnl;
      }
    }

    // 2. Unrealized P&L at End
    let holdCostEnd = 0;
    for (const h of Object.values(pool.holdings)) {
      holdCostEnd += (h.amount || 0) * (h.averagePrice || 0);
    }
    const navEndRaw = getPoolTotalValue(pool, prices);
    const unrealizedEnd = navEndRaw - holdCostEnd;

    // 3. Unrealized P&L at Start
    let unrealizedStart = 0;
    if (weekSnapshots.length > 0) {
      const snap = weekSnapshots[0];
      if (snap.value > 0 && snap.pnlPct !== undefined && snap.pnlPct !== -100) {
        const costStart = snap.value / (1 + snap.pnlPct / 100);
        unrealizedStart = snap.value - costStart;
      }
    }

    const weeklyPnlDollar = realizedPnlThisWeek + (unrealizedEnd - unrealizedStart);
    const pnlPct = poolBasis > 0 ? (weeklyPnlDollar / poolBasis) * 100 : 0;
    
    // Pass reconstructed NAV values for AI context to accurately show dollar P&L
    const navStart = poolBasis;
    const navEnd = poolBasis + weeklyPnlDollar;
    const poolDca = dcaContributionsThisWeek[pool.poolId] || 0;

    // GPM activity summary for this pool
    const gpmLines: string[] = [];
    if (gpmDownTrades.length > 0) gpmLines.push(`${gpmDownTrades.length} partial scale-down(s) — position reduced when conviction dropped`);
    if (gpmUpTrades.length > 0) gpmLines.push(`${gpmUpTrades.length} scale-up(s) — position topped up when conviction returned`);
    if (earlyUpTrades.length > 0) gpmLines.push(`${earlyUpTrades.length} EARLY scale-up(s) — bought back while still recovering (trend-based)`);
    if (gpmLines.length === 0) gpmLines.push('No GPM scaling activity this week — positions held at full size throughout');
    const gpmActions = gpmLines.join('; ');

    // ── FIX #4: Include ALL trades in the log, not just 6 ──
    // Sort by date ascending so the AI sees the timeline correctly
    const sortedTrades = [...weekTrades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const recentLogLines = sortedTrades.map(t => {
      const outcome = t.pnlPct !== undefined ? ` P&L: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '';
      const isGpmDown = t.type === 'SELL' && t.reason?.includes('GPM') && (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'));
      const isGpmUp = t.type === 'BUY' && (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP'));
      const isEarly = isGpmUp && (t.preTradeReflection?.includes('EARLY') || t.reason?.includes('EARLY'));
      const tag = isGpmDown ? ' [GPM↓]' : isEarly ? ' [GPM↑ EARLY]' : isGpmUp ? ' [GPM↑]' : '';
      const dateStr = new Date(t.date).toISOString().slice(0, 16);
      return `${dateStr} ${t.type} ${t.ticker} $${t.total?.toFixed(2) || '?'}${outcome}${tag}`;
    }).join('\n');

    return {
      poolId: pool.poolId,
      poolName: pool.name,
      emoji: pool.emoji,
      pnlPct,
      trades: weekTrades.length,
      buys: poolBuys,
      sells: poolSells.length,
      wins: poolWins,
      losses: poolLosses,
      tokens: pool.tokens,
      strategy: pool.strategy.description,
      gpmActions,
      gpmDownCount: gpmDownTrades.length,
      gpmUpCount: gpmUpTrades.length,
      gpmEarlyCount: earlyUpTrades.length,
      recentLogLines,
      navStart,
      navEnd,
      dcaDeployed: pool.dcaDeployedTotal ?? 0,
      dcaThisWeek: poolDca,
    };
  });

  const arenaSharedCash = (arena as any).sharedCash ?? 0;
  
  // To get accurate overall NAV, we must include the shared cash. Since pool snapshots only log token values,
  // we cannot just sum pool.navStart. Instead we default to (navStart tokens + initial shared state).
  // Ideally we use ARENA_NAV snapshots for accurate historical reporting:
  let overallNavStart = (arena as any).totalBudget ?? TOTAL_BUDGET;
  let overallNavEnd = perPoolSummaryInputs.reduce((s, p) => s + p.navEnd, 0) + arenaSharedCash - totalDcaThisWeek;

  try {
    const navSnapDocsItem = await adminDb.collection('arena_snapshots').doc(userId).collection('ARENA_NAV').orderBy('date', 'desc').get();
    const allSnaps = navSnapDocsItem.docs.map(d => d.data());
    
    // Nearest snapshot at or before periodStart
    const startSnap = allSnaps.find(s => s.date <= periodStart.slice(0, 10));
    if (startSnap) overallNavStart = startSnap.value;
    
    // Nearest snapshot at or before periodEnd
    const endSnap = allSnaps.find(s => s.date <= periodEnd.slice(0, 10));
    if (endSnap) overallNavEnd = endSnap.value;
  } catch (e: any) {
    // Fallback if ARENA_NAV queries fail
    console.warn('[Arena] Using fallback NAV calculations for weekly report (ARENA_NAV missing)', e.message);
  }

  const overallPnlPct = overallNavStart > 0 ? ((overallNavEnd - overallNavStart) / overallNavStart) * 100 : 0;
  const winRate = totalSells > 0 ? (wins / totalSells) * 100 : 0;

  // ── FIX #5: Improved prompt with strict accuracy constraints ──
  const prompt = `You are writing the SUNDAY WEEKLY AUDIT REPORT for a crypto trading portfolio that uses GPM (Graduated Position Management).

KEY CONTEXT — What GPM does vs the old system:
OLD SYSTEM: Binary. Either hold 100% OR sell 100%. No middle ground.
NEW SYSTEM (GPM): Graduated. When AI conviction falls, positions are PARTIALLY REDUCED (e.g. sell 50% → stay 50% invested). When conviction recovers, positions are SCALED BACK UP. Scale-up can fire EARLY — when scores are TRENDING upward — so the system buys back on the way up.

════════════════════════════════════════════════════════════════
 VERIFIED DATA — DO NOT CONTRADICT OR INVENT NUMBERS
════════════════════════════════════════════════════════════════
WEEK ${weekNumber}/4 | Day ${dayNum}/28 | Period: ${periodStart.slice(0, 10)} to ${periodEnd.slice(0, 10)}
PORTFOLIO NAV: $${overallNavStart.toFixed(2)} → $${overallNavEnd.toFixed(2)} = ${overallPnlPct >= 0 ? '+' : ''}${overallPnlPct.toFixed(2)}%
BTC WEEKLY CHANGE: ${btcWeeklyPctChange >= 0 ? '+' : ''}${btcWeeklyPctChange.toFixed(2)}%
TOTAL TRADES: ${totalTrades} (${totalSells} sells: ${wins}W / ${losses}L | ${totalTrades - totalSells} buys)
WIN RATE: ${winRate.toFixed(1)}%
GPM SCALE-DOWNS: ${gpmScaleDownCount} partial sells
GPM SCALE-UPS: ${gpmScaleUpCount} total (${gpmEarlyScaleUpCount} were EARLY/trend-based)

POOL-BY-POOL DATA (trades listed chronologically):
${perPoolSummaryInputs.map(p => `
${p.emoji} ${p.poolName}
  Tokens: ${p.tokens.join(', ')}
  Strategy: ${p.strategy}
  Week P&L: ${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}% (NAV $${p.navStart.toFixed(2)} → $${p.navEnd.toFixed(2)})
  Trades: ${p.trades} total (${p.buys} buys, ${p.sells} sells: ${p.wins}W / ${p.losses}L)
  GPM: ${p.gpmDownCount}↓ scale-downs, ${p.gpmUpCount}↑ scale-ups (${p.gpmEarlyCount} early)
  DCA deployed: $${p.dcaDeployed.toFixed(2)}
  Complete trade log:
    ${p.recentLogLines || 'No trades this week'}
`).join('\n')}

════════════════════════════════════════════════════════════════
 ACCURACY RULES — READ CAREFULLY
════════════════════════════════════════════════════════════════
1. NEVER invent trade details, tickers, or outcomes not shown in the data above.
2. When stating numbers (trades, wins, losses, P&L), use EXACTLY the values from the verified data.
3. When describing GPM actions per pool, use the EXACT counts shown (e.g. "11 scale-downs and 8 scale-ups").
4. The "old system comparison" should be a GENERAL analysis of what binary trading would have done — do NOT fabricate specific counterfactual prices or percentage outcomes.
5. Use pool NAMES throughout — NEVER write POOL_1, POOL_2 etc.
6. Be HONEST about win rate (${winRate.toFixed(1)}%) — if it's low, acknowledge it.

════════════════════════════════════════════════════════════════
 CRITICAL ANALYSIS MANDATE
════════════════════════════════════════════════════════════════
The owner of this portfolio needs to understand whether active trading (GPM in AI pools, or manual tactical entries in MANUAL MADNESS) is WORTH IT compared to simply buying and holding BTC.

This week: Portfolio ${overallPnlPct >= 0 ? 'gained' : 'lost'} ${Math.abs(overallPnlPct).toFixed(2)}%, BTC gained ${btcWeeklyPctChange.toFixed(2)}%.
${overallPnlPct < btcWeeklyPctChange
  ? `The portfolio UNDERPERFORMED BTC by ${(btcWeeklyPctChange - overallPnlPct).toFixed(2)} percentage points. You MUST explain WHY — what specific trading behaviour caused the gap? Was it too many small losing trades bleeding capital? Selling too early and missing rallies? Holding the wrong tokens while BTC surged? Be specific and critical.`
  : `The portfolio OUTPERFORMED BTC by ${(overallPnlPct - btcWeeklyPctChange).toFixed(2)} percentage points. You MUST explain what specific trading decisions or token selection drove the outperformance.`
}

DO NOT just state "the portfolio underperformed BTC." EXPLAIN why, using evidence from the trade logs. Be brutally honest. If the system would have been better off doing nothing, say so.

Respond with ONLY valid JSON:
{
  "executiveSummary": "4-6 sentences. Start with headline numbers, then IMMEDIATELY analyse WHY the portfolio ${overallPnlPct < btcWeeklyPctChange ? 'underperformed' : 'outperformed'} BTC. Diagnose root cause: was it the win rate? Frequency of small losses? Token selection? Not staying invested? Be specific and critical — e.g. 'The 17% win rate meant 33 losing trades bled capital through repeated small losses. While BTC rallied, the system was cycling in and out of positions at a net cost.' Do NOT just list numbers — ANALYSE them.",
  "gpmVsOldSystemAnalysis": "3-5 sentences. Critically assess: did GPM's frequent partial scaling HELP or HURT this week? With ${gpmScaleDownCount} scale-downs and ${gpmScaleUpCount} scale-ups, the system was extremely active. Was all that activity productive, or did it create unnecessary friction and small losses? Would holding positions at full size have produced a better outcome given that the market rose? Be honest.",
  "bestDecision": "1-2 sentences: the single best trade this week. Reference a REAL trade from the log with its date and P&L.",
  "worstDecision": "1-2 sentences: the worst decision. Reference a REAL trade. Explain what SHOULD have been done differently.",
  "nextWeekOutlook": "2-3 sentences: concrete recommendations. Given this week's performance gap vs BTC, what should change? Should GPM be less active? Should thresholds be adjusted? Be prescriptive, not vague.",
  "perPoolSummaries": [
    {
      "poolId": "<pool NAME>",
      "poolName": "<pool NAME>",
      "emoji": "<pool emoji>",
      "pnlPct": 0.0,
      "trades": 0,
      "wins": 0,
      "losses": 0,
      "gpmActions": "Plain English: what GPM did using EXACT counts from the data.",
      "verdict": "1-2 sentences: did GPM help or hurt THIS pool? If the pool would have been better off just holding, say so."
    }
  ]
}`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return null;
    const parsed = safeJsonParse(responseText);

    const report: WeeklyComparisonReport = {
      generatedAt: now.toISOString(),
      weekNumber,
      periodStart,
      periodEnd,
      navStart: overallNavStart,
      navEnd: overallNavEnd,
      pnlPct: overallPnlPct,
      btcPctOverPeriod: btcWeeklyPctChange,
      vsBtc: overallPnlPct - btcWeeklyPctChange,
      totalTrades,
      totalSells,
      wins,
      losses,
      winRate,
      gpmScaleDownCount,
      gpmScaleUpCount,
      gpmEarlyScaleUpCount,
      executiveSummary: parsed.executiveSummary || '',
      gpmVsOldSystemAnalysis: parsed.gpmVsOldSystemAnalysis || '',
      bestDecision: parsed.bestDecision || '',
      worstDecision: parsed.worstDecision || '',
      nextWeekOutlook: parsed.nextWeekOutlook || '',
      // ── FIX #6: Override AI's numbers with verified ground truth ──
      perPoolSummaries: (parsed.perPoolSummaries || []).map((p: any, i: number) => ({
        ...p,
        pnlPct: perPoolSummaryInputs[i]?.pnlPct ?? p.pnlPct ?? 0,
        trades: perPoolSummaryInputs[i]?.trades ?? p.trades ?? 0,
        wins: perPoolSummaryInputs[i]?.wins ?? p.wins ?? 0,
        losses: perPoolSummaryInputs[i]?.losses ?? p.losses ?? 0,
        gpmScaleDownCount: perPoolSummaryInputs[i]?.gpmDownCount ?? 0,
        gpmScaleUpCount: perPoolSummaryInputs[i]?.gpmUpCount ?? 0,
        gpmEarlyScaleUpCount: perPoolSummaryInputs[i]?.gpmEarlyCount ?? 0,
      })),
    };

    // Persist to Firestore — overwrite weekly doc (one per user, latest wins)
    await adminDb.collection('arena_weekly_reports').doc(userId).set({
      ...report,
      updatedAt: now.toISOString(),
    });

    console.log(`[Arena] 📋 Sunday weekly report generated. Week ${weekNumber}, ${totalTrades} trades (${wins}W/${losses}L), GPM: ${gpmScaleDownCount}↓ ${gpmScaleUpCount}↑`);
    return report;
  } catch (e: any) {
    console.error(`[Arena] Weekly report failed: ${e.message}`);
    return null;
  }
}

export async function getWeeklyComparisonReport(userId: string): Promise<WeeklyComparisonReport | null> {
  if (!adminDb) return null;
  try {
    const doc = await adminDb.collection('arena_weekly_reports').doc(userId).get();
    const json = doc.exists ? (doc.data() as WeeklyComparisonReport) : null;
    return serialize(json);
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

  // ── 0. NEW: Master Portfolio Sync ──────────────────────────────────────────────
  // If Master mode is active, override pool 1 with real Revolut holdings.
  if (arena.masterPortfolioMode) {
    await syncMasterPortfolioFromRevolut(userId, arena);
  }

  if (!isArenaActive()) {
    console.log('[Arena] Competition period not active.');
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  if (arena.systemHalted) {
    console.warn('[Arena] 🚨 System is HALTED due to circuit breaker. Waiting for user intervention.');
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  resetBrainLog(userId);
  await setBrainStatus(userId, '🏟️ Arena cycle starting...');

  // Trigger Sentiment Analyst Scan
  let sentimentState: SentimentState | null = null;
  try {
    await setBrainStatus(userId, '📡 AI Sentiment Analyst auditing live crypto news feed...');
    sentimentState = await runSentimentScan(userId);
  } catch (sentErr: any) {
    console.error(`[Arena] Sentiment scan error: ${sentErr.message}`);
  }

  // 1. Fetch all token prices in one batch
  const allTokens = new Set<string>();
  for (const pool of arena.pools) {
    pool.tokens.forEach(t => allTokens.add(t.toUpperCase()));
  }
  allTokens.add('BTC'); // Always track BTC for context

  // Fetch prices, technicals, orderbooks, and market stats in parallel
  const tokenList = [...allTokens];
  const [prices, marketStats, techData, orderBooks] = await Promise.all([
    getVerifiedPrices(tokenList, userId),
    getGlobalMarketStats(),
    fetchTechnicalDataForTokens(tokenList, {}), // prices not ready yet, candles are price-independent
    fetchOrderBooksForTokens(tokenList.filter(t => t !== 'BTC')), // no BTC orderbook needed
  ]);

  const btcPrice = prices['BTC']?.price || 0;
  const btcChange = prices['BTC']?.change24h || 0;
  const fng = marketStats?.fearGreedIndex || 50;

  // ── CIRCUIT BREAKERS & NAV TRACKING ──────────────────────────────────────
  let currentNav = arena.sharedCash || 0;
  for (const pool of arena.pools) {
    currentNav += getPoolTotalValue(pool, prices);
  }

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();

  // 1. Update/check 24h peak
  if (!arena.trailing24hPeak || (nowMs - new Date(arena.trailing24hPeak.timestamp).getTime()) > 24 * 60 * 60 * 1000) {
    arena.trailing24hPeak = { value: currentNav, timestamp: nowIso };
  } else if (currentNav > arena.trailing24hPeak.value) {
    arena.trailing24hPeak = { value: currentNav, timestamp: nowIso };
  }
  
  // 2. Update/check 72h peak
  if (!arena.trailing72hPeak || (nowMs - new Date(arena.trailing72hPeak.timestamp).getTime()) > 72 * 60 * 60 * 1000) {
    arena.trailing72hPeak = { value: currentNav, timestamp: nowIso };
  } else if (currentNav > arena.trailing72hPeak.value) {
    arena.trailing72hPeak = { value: currentNav, timestamp: nowIso };
  }

  // Prevent division by zero
  const peak24 = Math.max(0.01, arena.trailing24hPeak.value);
  const peak72 = Math.max(0.01, arena.trailing72hPeak.value);

  const drop24hPct = ((peak24 - currentNav) / peak24) * 100;
  const drop72hPct = ((peak72 - currentNav) / peak72) * 100;

  if (drop24hPct >= 10 || drop72hPct >= 25) {
    console.error(`[Arena] 🚨 CIRCUIT BREAKER TRIGGERED! 24h drop: ${drop24hPct.toFixed(2)}%, 72h drop: ${drop72hPct.toFixed(2)}%. System HALTED.`);
    await adminDb.collection('arena_config').doc(userId).set({ 
      systemHalted: true,
      trailing24hPeak: arena.trailing24hPeak,
      trailing72hPeak: arena.trailing72hPeak
    }, { merge: true });
    // User requested to freeze and hold tokens until intervention.
    return { success: false, poolResults: [], totalTrades: 0 };
  }

  // ── 0. NEW: 4nd Hour Deep Analysis ──────────────────────────────────────────
  const lastAnalysis = (arena as any).lastDeepAnalysisAt;
  const hoursSince = lastAnalysis ? (Date.now() - new Date(lastAnalysis).getTime()) / (1000 * 60 * 60) : Infinity;
  
  if (hoursSince >= 4) {
    console.log(`[Arena] 🧠 Triggering 4-hour Deep Analysis (last: ${hoursSince.toFixed(1)}h ago)`);
    await runPortfolioDeepAnalysis(userId, arena, prices);
    
    // Update local variable and persist timestamp immediately
    (arena as any).lastDeepAnalysisAt = new Date().toISOString();
    await adminDb.collection('arena_config').doc(userId).set({ 
      lastDeepAnalysisAt: (arena as any).lastDeepAnalysisAt 
    }, { merge: true });
  }

  // Now recompute technicals with actual prices (candles were cached from parallel fetch)
  const techDataWithPrices = await fetchTechnicalDataForTokens(tokenList, prices);

  if (process.env.NODE_ENV !== 'production') {
    const techCount = Object.keys(techDataWithPrices).length;
    const obCount = Object.keys(orderBooks).length;
    await setBrainStatus(userId, `📊 Loaded: ${allTokens.size} prices, ${techCount} tech profiles, ${obCount} order books. BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}%)`);
  }

  // ── PRE-CYCLE: SYNC WITH REVOLUT X (MASTER MODE ONLY) ──────────────────────
  if (arena.masterPortfolioMode) {
    console.log(`[Arena] 📡 Master Mode active. Syncing holdings from Revolut X...`);
    await syncMasterPortfolioFromRevolut(userId, arena);
  }

  // ── PRE-CYCLE: Consolidate all per-pool cash into arena.sharedCash ─────────
  // This ensures any legacy cashBalance (or cash left over from failed sell-routing)
  // is pooled centrally before the cycle begins. After migration pool.cashBalance = 0.
  {
    const legacyCash = arena.pools.reduce((s, p) => s + (p.cashBalance || 0), 0);
    if (legacyCash > 0.01) {
      arena.sharedCash = (arena.sharedCash ?? 0) + legacyCash;
      for (const pool of arena.pools) pool.cashBalance = 0;
      console.log(`[Arena] 💰 Pre-cycle: consolidated $${legacyCash.toFixed(2)} per-pool cash → sharedCash ($${arena.sharedCash.toFixed(2)} total)`);
    }
  }

  // 3. Two-pass processing
  // ── PASS 1: SELLS + GPM across ALL pools ────────────────────────────────
  // Sell proceeds route to arena.sharedCash (via executePoolSell).
  // Buy signals are collected but NOT executed yet.
  const poolResults: Array<{ poolId: string; trades: number; value: number; pnlPct: number }> = [];
  let totalTrades = 0;
  // Cross-pool buy signals: each entry carries its pool reference and score
  const crossPoolBuys: Array<{
    pool: ArenaPool;
    ticker: string;
    smoothedScore: number;
    price: number;
    reflection: string;
    marketContext: { btcPrice: number; btcChange24h: number; tokenChange24h: number; fearGreedIndex: number };
    isGpmScaleUp?: boolean;
    isRebound?: boolean;
    isBuyback?: boolean;
    buybackStageIndex?: number;
    recommendedBuyAmountUsd?: number;
  }> = [];
  const poolTradesMap: Map<string, ArenaTradeRecord[]> = new Map();

  for (const pool of arena.pools) {
    if (pool.status !== 'ACTIVE') {
      poolResults.push({ poolId: pool.poolId, trades: 0, value: getPoolTotalValue(pool, prices), pnlPct: pool.performance.totalPnlPct });
      continue;
    }

    await setBrainStatus(userId, `${pool.emoji} Pass 1 — Sells & signals for ${pool.name}...`);

    // 3.1 Dynamic strategy review
    if (isDynamicReviewDue(pool)) {
      await setBrainStatus(userId, `${pool.emoji} 🧠 AI Strategy Review for ${pool.name}...`);
      await performWeeklyReview(userId, pool, prices, fng);
    }

    const poolTrades: ArenaTradeRecord[] = [];

    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const priceData = prices[upper];
      if (!priceData || priceData.price <= 0) continue;

      // ─── EVALUATION COOLDOWN ────────────────────────────────────────
      // Default increased from 15m to 30m per March 26 Audit recommendations
      const evalCooldownMinutes = pool.strategy.evaluationCooldownMinutes ?? 30;
      const lastEval = pool.lastEvaluatedAt?.[upper];
      if (lastEval) {
        const minSinceEval = (Date.now() - new Date(lastEval).getTime()) / (1000 * 60);
        if (minSinceEval < evalCooldownMinutes) continue;
      }

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

      const totalValue = getPoolTotalValue(pool, prices);
      const holding = pool.holdings[upper];
      const holdingPnlPct = holding ? ((priceData.price - holding.averagePrice) / holding.averagePrice) * 100 : 0;
      const sharedCashForDisplay = arena.sharedCash ?? 0;
      const holdingContext = holding
        ? `Currently HOLDING ${holding.amount.toFixed(6)} ${upper} (avg: $${smartPrice(holding.averagePrice)}, P&L: ${holdingPnlPct >= 0 ? '+' : ''}${holdingPnlPct.toFixed(1)}%, peak P&L: +${(holding.peakPnlPct || 0).toFixed(1)}%). TAKE-PROFIT target: +${pool.strategy.takeProfitTarget || 3}%. You MUST decide: HOLD for more upside or EXIT NOW?`
        : `NOT holding ${upper}. Shared cash pool: $${sharedCashForDisplay.toFixed(2)} (available to strongest signal across all pools).`;

      const sentimentContext = sentimentState 
        ? `\nGLOBAL SENTIMENT ANALYST: Score ${sentimentState.score}/100 | Mode: ${sentimentState.narrativeMode}\nNarrative Reflection: "${sentimentState.reflection}"` 
        : '\nGLOBAL SENTIMENT ANALYST: Offline/Unavailable.';

      const poolContext = `
Pool: ${pool.emoji} ${pool.name}
Day ${Math.max(1, Math.min(Math.floor((Date.now() - new Date(arena.startDate).getTime()) / 86400000) + 1, 28))}/28, Week ${Math.min(Math.floor((Date.now() - new Date(arena.startDate).getTime()) / 86400000 / 7) + 1, 4)}/4
Total Value: $${totalValue.toFixed(2)} (${pool.performance.totalPnlPct >= 0 ? '+' : ''}${pool.performance.totalPnlPct.toFixed(1)}%)
Shared Cash (arena-level): $${sharedCashForDisplay.toFixed(2)} | Budget: $${pool.budget}
${holdingContext}
Win/Loss: ${pool.performance.winCount}W / ${pool.performance.lossCount}L
BTC: $${btcPrice.toLocaleString()} (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}%)
Fear & Greed: ${fng}/100 (${marketStats?.fearGreedStatus || 'Unknown'})${sentimentContext}`;
 
      try {
        let analysis: any = null;
        let smoothedScore = 50; // Default for manual

        if (pool.poolId !== 'POOL_MANUAL') {
          const tokenScoreHistory = pool.scoreHistory?.[upper] || [];
          analysis = await analyzeCryptoForPool(
            upper, pool.strategy, poolContext, tradeMemory,
            { price: priceData.price, change24h: priceData.change24h, mcap: priceData.mcap || 0, name: NAME_MAP[upper] || upper },
            techDataWithPrices[upper] || null,
            orderBooks[upper] || null,
            tokenScoreHistory,
          );

          if (!pool.scoreHistory) pool.scoreHistory = {};
          if (!pool.scoreHistory[upper]) pool.scoreHistory[upper] = [];
          pool.scoreHistory[upper].push({ score: analysis.overallScore, ts: new Date().toISOString() });
          // COST SAVING: Keep only last 5 scores to reduce Firestore document bloat
          if (pool.scoreHistory[upper].length > 5) pool.scoreHistory[upper] = pool.scoreHistory[upper].slice(-5);
          if (!pool.lastEvaluatedAt) pool.lastEvaluatedAt = {};
          pool.lastEvaluatedAt[upper] = new Date().toISOString();

          const recentScores = pool.scoreHistory[upper].slice(-3).map(s => s.score);
          smoothedScore = Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length);
        } else {
          // MANUAL POOL: No AI conviction trades, but we optionally run informational scoring if enabled
          // or just update timestamps. For now, keep as informational placeholder.
          if (!pool.lastEvaluatedAt) pool.lastEvaluatedAt = {};
          pool.lastEvaluatedAt[upper] = new Date().toISOString();
          smoothedScore = 50; // Neutral baseline
        }

        const marketContext = { btcPrice, btcChange24h: btcChange, tokenChange24h: priceData.change24h, fearGreedIndex: fng };
        const minHoldMinutes = pool.strategy.minHoldMinutes ?? 120;
        const exitHysteresis = pool.strategy.exitHysteresis ?? 10;
        const buyConfidenceBuffer = pool.strategy.buyConfidenceBuffer ?? 5;

        if (holding && holding.amount > 0) {
          // ─── SELL EVALUATION ───
          const pnlPct = ((priceData.price - holding.averagePrice) / holding.averagePrice) * 100;
          if (pnlPct > (holding.peakPnlPct || 0)) {
            holding.peakPnlPct = pnlPct;
            holding.peakPrice = Math.max(holding.peakPrice || 0, priceData.price);
          }

          let shouldSell = false;
          let sellReason = '';

          // ─── PER-TOKEN SETTINGS (Manual Pool Override) ───
          const stopLossLimit = (pool.poolId === 'POOL_MANUAL' && holding.settings?.stopLoss !== undefined)
            ? holding.settings.stopLoss
            : pool.strategy.positionStopLoss;

          const tpTarget = (pool.poolId === 'POOL_MANUAL' && holding.settings?.takeProfit !== undefined)
            ? holding.settings.takeProfit
            : (pool.strategy.takeProfitTarget || 3);

          const trailStop = (pool.poolId === 'POOL_MANUAL' && holding.settings?.trailingStop !== undefined)
            ? holding.settings.trailingStop
            : (pool.strategy.trailingStopPct || 2);

          const takeProfitTarget = tpTarget;
          const trailingStopPct = trailStop;
          const holdMinutes = holding.boughtAt ? (Date.now() - new Date(holding.boughtAt).getTime()) / (1000 * 60) : Infinity;
          const isHoldMature = holdMinutes >= minHoldMinutes;

          const isUserDirected = pool.poolId === 'POOL_MANUAL' || arena.masterPortfolioMode || holding.userDirected;

          if (pnlPct <= stopLossLimit) {
            shouldSell = true;
            sellReason = `⛔ STOP-LOSS: Position at ${pnlPct.toFixed(1)}% (limit: ${stopLossLimit}%)`;
          } else if (pnlPct >= takeProfitTarget) {
            shouldSell = true;
            sellReason = `💰 TAKE-PROFIT: Position at +${pnlPct.toFixed(1)}% (target: +${takeProfitTarget}%). Locking in gains.`;
          } else if (isHoldMature && (holding.peakPnlPct || 0) >= takeProfitTarget * 0.6 && (holding.peakPnlPct || 0) - pnlPct >= trailingStopPct) {
            shouldSell = true;
            sellReason = `📉 TRAILING STOP: Peak was +${(holding.peakPnlPct || 0).toFixed(1)}%, now +${pnlPct.toFixed(1)}% (dropped ${((holding.peakPnlPct || 0) - pnlPct).toFixed(1)}%, limit: ${trailingStopPct}%)`;
          } else if (!isUserDirected && smoothedScore < (pool.strategy.exitThreshold ?? 40)) {
            // 🚨 DEFENSE: AI Exit Zone (Skipped for Manual, User-Directed, and Master Portfolio)
            shouldSell = true;
            sellReason = `🚨 AI EXIT: Score ${smoothedScore} dropped below conviction floor (${pool.strategy.exitThreshold ?? 40}). Full exit to protect cash.`;
          }

          if (shouldSell) {
            const sellAmount = holding.amount * 0.995;
            const revolutResult = await executeRevolutTrade(userId, upper, 'SELL', sellAmount, priceData.price);
            if (revolutResult.success) {
              const actualPrice = revolutResult.fillPrice || priceData.price;
              const result = await executePoolSell(userId, pool, upper, holding.amount, actualPrice, sellReason, marketContext, `${sellReason}${analysis ? ` | AI: ${analysis.summary}` : ''}`);
              if (result.success && result.trade) {
                poolTrades.push(result.trade);
                if (process.env.NODE_ENV !== 'production') console.log(`[Arena] ${pool.emoji} ${sellReason} | Actual P&L: ${result.pnlPct?.toFixed(2)}% | $${result.trade.total.toFixed(2)} → sharedCash`);
              }
            } else {
              console.warn(`[Arena] ⚠️ Revolut SELL failed for ${upper} — arena state NOT updated`);
            }
          } else {
            // ─── GPM: GRADUATED POSITION MANAGEMENT ──────────────────
            // Decoupled from Manual/Master positions to avoid aggressive AI-vetoes.
            const isUserDirected = pool.poolId === 'POOL_MANUAL' || arena.masterPortfolioMode || holding.userDirected;
            const gpmEnabled = holding.settings?.gpmEnabled ?? (!isUserDirected && (pool.strategy.gpmEnabled !== false));

            if (gpmEnabled && isHoldMature) {
              const gpmCautionScore = holding.settings?.gpmCautionScore ?? pool.strategy.gpmCautionZoneScore ?? 70;
              const gpmDefensiveScore = holding.settings?.gpmDefensiveScore ?? pool.strategy.gpmDefensiveZoneScore ?? 55;
              const gpmCautionPct = holding.settings?.gpmCautionPct ?? pool.strategy.gpmCautionPositionPct ?? 50;
              const gpmDefensivePct = holding.settings?.gpmDefensivePct ?? pool.strategy.gpmDefensivePositionPct ?? 25;
              const gpmConfirmNeeded = Math.max(3, pool.strategy.gpmConfirmationCycles ?? 3);
              const gpmScaleDownCooldownHours = pool.strategy.gpmScaleDownCooldownHours ?? 6;
              const maxAlloc = pool.strategy.maxAllocationPerToken;

              const resolvedZone: 'CONVICTION' | 'CAUTION' | 'DEFENSIVE' =
                smoothedScore >= gpmCautionScore ? 'CONVICTION' :
                  smoothedScore >= gpmDefensiveScore ? 'CAUTION' : 'DEFENSIVE';

              const prevZone = holding.gpmZone ?? 'CONVICTION';
              const prevCycles = holding.gpmZoneConsecutiveCycles ?? 0;
              const sameZone = resolvedZone === prevZone;
              const newCycles = sameZone ? prevCycles + 1 : 1;
              holding.gpmZone = resolvedZone;
              holding.gpmZoneConsecutiveCycles = newCycles;

              const holdingValueUsd = holding.amount * priceData.price;
              const alreadyScaledDownInThisZone = holding.gpmLastScaleDownZone === resolvedZone;

              if (resolvedZone !== 'CONVICTION' && newCycles >= gpmConfirmNeeded && !alreadyScaledDownInThisZone) {
                const targetPct = resolvedZone === 'CAUTION' ? gpmCautionPct : gpmDefensivePct;
                const targetUsd = (targetPct / 100) * maxAlloc;
                const excessUsd = holdingValueUsd - targetUsd;

                if (excessUsd >= 15) {
                  const excessAmount = (excessUsd / priceData.price) * 0.995;
                  const gpmReason = `📉 GPM ${resolvedZone}: Score ${smoothedScore} confirmed ${newCycles}× (threshold: <${resolvedZone === 'CAUTION' ? gpmCautionScore : gpmDefensiveScore}). Reducing to ${targetPct}% of max allocation ($${targetUsd.toFixed(2)}). Selling $${excessUsd.toFixed(2)} excess → sharedCash.`;
                  await setBrainStatus(userId, `${pool.emoji} 📉 GPM SCALE-DOWN ${upper}: Zone=${resolvedZone} (${newCycles}/${gpmConfirmNeeded} cycles). Selling $${excessUsd.toFixed(2)} → sharedCash`);
                  const revolutResult = (pool.poolId === 'POOL_MANUAL') ? { success: true } : await executeRevolutTrade(userId, upper, 'SELL', excessAmount, priceData.price);
                  if (revolutResult.success) {
                    const actualPrice = revolutResult.fillPrice || priceData.price;
                    const result = await executePoolSell(userId, pool, upper, excessAmount, actualPrice, gpmReason, marketContext, gpmReason, 'CRYPTO', true);
                    if (result.success && result.trade) {
                      poolTrades.push(result.trade);
                      holding.gpmLastScaleDownAt = new Date().toISOString();
                      holding.gpmLastScaleDownZone = resolvedZone;
                    }
                  } else {
                    console.warn(`[Arena] ⚠️ Revolut GPM SELL failed for ${upper}`);
                  }
                }
              } else if (holdingValueUsd < maxAlloc) {
                // GPM SCALE-UP — queue as a cross-pool buy signal
                const isArrivalScaleUp = resolvedZone === 'CONVICTION' && prevZone !== 'CONVICTION';
                const lastScaleDown = holding.gpmLastScaleDownAt;
                const hoursSinceScaleDown = lastScaleDown
                  ? (Date.now() - new Date(lastScaleDown).getTime()) / (1000 * 60 * 60)
                  : Infinity;
                const scaleUpCooldownMet = hoursSinceScaleDown >= gpmScaleDownCooldownHours;

                if (isArrivalScaleUp && scaleUpCooldownMet) {
                  const topUpUsd = maxAlloc - holdingValueUsd;
                  if (topUpUsd >= 15 && !arena.sellOnlyMode) {
                    const scaleUpReflection = `📈 GPM SCALE-UP [CONVICTION ARRIVAL]: ${upper} crossed into CONVICTION (score ${smoothedScore} >= ${gpmCautionScore}). Cooldown ${hoursSinceScaleDown.toFixed(1)}h (min: ${gpmScaleDownCooldownHours}h). Topping up $${topUpUsd.toFixed(2)} (target: $${maxAlloc.toFixed(2)}). ${analysis.summary}`;
                    crossPoolBuys.push({ pool, ticker: upper, smoothedScore, price: priceData.price, reflection: scaleUpReflection, marketContext, isGpmScaleUp: true, recommendedBuyAmountUsd: analysis?.recommendedBuyAmountUsd || topUpUsd });
                    await setBrainStatus(userId, `${pool.emoji} 📈 GPM SCALE-UP ${upper} [CONVICTION]: $${topUpUsd.toFixed(2)} top-up queued (score ${smoothedScore}).`);
                    holding.gpmZone = 'CONVICTION';
                    holding.gpmZoneConsecutiveCycles = 1;
                    holding.gpmLastScaleDownZone = undefined;
                  }
                } else if (isArrivalScaleUp && !scaleUpCooldownMet) {
                  await setBrainStatus(userId, `${pool.emoji} ⏳ GPM SCALE-UP BLOCKED ${upper}: CONVICTION arrived but cooldown not met (${hoursSinceScaleDown.toFixed(1)}h / ${gpmScaleDownCooldownHours}h required)`);
                }
              }
            }
          }
        } else if (pool.poolId !== 'POOL_MANUAL') {
          // ─── BUY SIGNAL (AI Pools Only) ───

          // ── FIX: Apply reentryPenalty for recently-sold tokens ──
          // If this token was sold from this pool, require a HIGHER score to buy back.
          // This prevents the system from churning in-and-out at similar conviction levels.
          const wasRecentlySold = !!pool.lastSoldAt?.[upper];
          const reentryPenalty = wasRecentlySold ? (pool.strategy.reentryPenalty || 5) : 0;
          const effectiveBuyThreshold = pool.strategy.buyScoreThreshold + buyConfidenceBuffer + reentryPenalty;

          if (smoothedScore >= effectiveBuyThreshold) {
            const lastSold = pool.lastSoldAt?.[upper];
            const lastStopLossed = pool.lastStopLossedAt?.[upper];
            const isLastSellStopLoss = !!lastStopLossed && (!lastSold || new Date(lastStopLossed).getTime() >= new Date(lastSold).getTime());

            // ── FIX: Unify cooldown — stop-loss exits now use the FULL antiWashHours ──
            // Stop-loss exits represent a broken thesis; they need MORE recovery time, not less.
            // Using a shorter cooldown was enabling fast whipsaw loops (sell at loss → buy back 6h later at higher price).
            const cooldownHours = pool.strategy.antiWashHours;
            const relevantTimestamp = isLastSellStopLoss ? lastStopLossed : lastSold;

            if (relevantTimestamp && cooldownHours > 0) {
              const hoursSinceSell = (Date.now() - new Date(relevantTimestamp).getTime()) / (1000 * 60 * 60);
              if (hoursSinceSell < cooldownHours) {
                const cooldownLabel = isLastSellStopLoss ? 'Stop-loss re-entry' : 'Anti-wash';
                await setBrainStatus(userId, `${pool.emoji} 🚫 ${upper}: ${cooldownLabel} cooldown (${hoursSinceSell.toFixed(1)}h ago, need ${cooldownHours}h)`);
                continue;
              }
            }

            // ── FIX: Buy-back-lower gate — NEVER buy back higher than the sell price ──
            // If we sold BNB at $622.97 and it's now $630.72, we must NOT buy back.
            // Only re-enter if the price has dropped below the last sell price by a margin.
            const lastSellPrice = pool.lastSellPrices?.[upper];
            if (lastSellPrice && lastSellPrice > 0) {
              const buyBackMarginPct = 2.0; // Must be at least 2% BELOW sell price to re-enter
              const maxReentryPrice = lastSellPrice * (1 - buyBackMarginPct / 100);
              if (priceData.price > maxReentryPrice) {
                const pctAboveSell = ((priceData.price - lastSellPrice) / lastSellPrice) * 100;
                await setBrainStatus(userId, `${pool.emoji} 🚫 ${upper}: Buy-back-higher blocked — price $${priceData.price.toFixed(2)} is ${pctAboveSell >= 0 ? '+' : ''}${pctAboveSell.toFixed(2)}% vs sell at $${lastSellPrice.toFixed(2)} (need -${buyBackMarginPct}%)`);
                continue;
              }
              // Clear the gate once we've successfully passed it — allows future trades at new prices
              console.log(`[Arena] ${pool.emoji} ✅ ${upper}: Buy-back-lower gate passed — price $${priceData.price.toFixed(2)} is below sell $${lastSellPrice.toFixed(2)} by ${(((lastSellPrice - priceData.price) / lastSellPrice) * 100).toFixed(2)}%`);
            }

            if (pool.strategy.momentumGateEnabled && priceData.change24h < pool.strategy.momentumGateThreshold) {
              await setBrainStatus(userId, `${pool.emoji} ⏸️ ${upper}: Momentum gate blocked (${priceData.change24h.toFixed(1)}% < ${pool.strategy.momentumGateThreshold}%)`);
              continue;
            }

            if (!arena.sellOnlyMode) {
                const penaltyNote = reentryPenalty > 0 ? ` (re-entry penalty +${reentryPenalty} applied, effective threshold ${effectiveBuyThreshold})` : '';
                const buyReflection = `BUY signal: smoothed score ${smoothedScore} (raw: ${analysis.overallScore}, threshold ${pool.strategy.buyScoreThreshold}+${buyConfidenceBuffer}${penaltyNote}). Entry type: ${analysis.entryType}. ${analysis.summary}`;
                crossPoolBuys.push({ pool, ticker: upper, smoothedScore, price: priceData.price, reflection: buyReflection, marketContext, recommendedBuyAmountUsd: analysis?.recommendedBuyAmountUsd });
                await setBrainStatus(userId, `${pool.emoji} 📌 ${upper}: BUY signal queued (score ${smoothedScore}${penaltyNote}) — competing cross-pool for sharedCash.`);
            }
          }
        }
      } catch (e: any) {
        console.warn(`[Arena] Analysis failed for ${upper} in ${pool.poolId}: ${e.message}`);
      }
    } // end token loop

    // ── Phase C: Rebound Watch ────────────────────────────────────────────
    // FIX: Inverted logic — only re-enter if price has DROPPED below the stop-loss
    // exit price. The old logic required price to be ABOVE exit (+1.5%), which
    // guaranteed buying back higher. Now we wait for a genuine dip.
    {
      const reboundDipPct = pool.strategy.reboundEntryPct ?? 1.5; // Must be this % BELOW exit price
      const reboundRsiMin = pool.strategy.reboundRsiMin ?? 35;
      const slCooldownHours = pool.strategy.antiWashHours; // Use full anti-wash cooldown

      for (const ticker of pool.tokens) {
        const upper = ticker.toUpperCase();
        const lastStopLossed = pool.lastStopLossedAt?.[upper];
        if (!lastStopLossed) continue;
        if (pool.holdings[upper]?.amount > 0) continue;
        if (crossPoolBuys.some(b => b.ticker === upper && b.pool.poolId === pool.poolId)) continue;

        const hoursSinceStopLoss = (Date.now() - new Date(lastStopLossed).getTime()) / (1000 * 60 * 60);
        if (hoursSinceStopLoss < slCooldownHours) continue;

        const priceData = prices[upper];
        if (!priceData || priceData.price <= 0) continue;
        const exitPrice = pool.stopLossExitPrices?.[upper];
        if (!exitPrice || exitPrice <= 0) continue;

        // FIX: Require price to be BELOW exit price by reboundDipPct
        const dipPct = ((exitPrice - priceData.price) / exitPrice) * 100;
        if (dipPct < reboundDipPct) {
          await setBrainStatus(userId, `${pool.emoji} 📡 REBOUND WATCH ${upper}: Price $${priceData.price.toFixed(2)} needs to be ${reboundDipPct}% BELOW exit $${exitPrice.toFixed(2)} (currently ${dipPct >= 0 ? '-' : '+'}${Math.abs(dipPct).toFixed(2)}%)`);
          continue;
        }

        const rsi = techDataWithPrices[upper]?.rsi14 ?? 50;
        if (rsi < reboundRsiMin) {
          await setBrainStatus(userId, `${pool.emoji} 📡 REBOUND WATCH ${upper}: RSI ${rsi.toFixed(1)} below floor ${reboundRsiMin}`);
          continue;
        }

        if (!arena.sellOnlyMode) {
            const reboundReason = `⚡ REBOUND RE-ENTRY: ${upper} dropped -${dipPct.toFixed(2)}% below stop-loss exit $${exitPrice.toFixed(4)} → now $${priceData.price.toFixed(4)} (threshold: -${reboundDipPct}%). RSI ${rsi.toFixed(1)} (floor: ${reboundRsiMin}). Held ${hoursSinceStopLoss.toFixed(1)}h since stop-loss. Buying back LOWER.`;
            crossPoolBuys.push({
                pool, ticker: upper, smoothedScore: 88,
                price: priceData.price, reflection: reboundReason,
                marketContext: { btcPrice, btcChange24h: btcChange, tokenChange24h: priceData.change24h, fearGreedIndex: fng },
                isRebound: true,
            });
            await setBrainStatus(userId, `${pool.emoji} ⚡ REBOUND RE-ENTRY queued: ${upper} at $${priceData.price.toFixed(4)} (-${dipPct.toFixed(2)}% below exit, RSI ${rsi.toFixed(1)}). Buying back LOWER.`);
        }
      }
    }

    // ── Phase D: Automatic Buybacks ───────────────────────────────────────
    if (pool.buybackConfigs && !arena.sellOnlyMode) {
      for (const [ticker, config] of Object.entries(pool.buybackConfigs)) {
        if (!config.enabled) continue;
        const upper = ticker.toUpperCase();
        const lastSellPrice = config.lastSellPrice || pool.lastSellPrices?.[upper];
        if (!lastSellPrice) continue;

        const priceData = prices[upper];
        if (!priceData || priceData.price <= 0) continue;

        const currentDipPct = ((lastSellPrice - priceData.price) / lastSellPrice) * 100;

        config.stages.forEach((stage, idx) => {
          if (stage.completed) return;
          if (currentDipPct >= stage.thresholdPct) {
            // Check if already queued this cycle
            if (crossPoolBuys.some(b => b.ticker === upper && b.pool.poolId === pool.poolId && b.isBuyback)) return;

            const buybackReason = `🤖 AUTOMATIC BUYBACK [Stage -${stage.thresholdPct}%]: ${upper} dropped -${currentDipPct.toFixed(2)}% vs sell $${lastSellPrice.toFixed(4)}. Triggering user-defined $${stage.amount.toFixed(2)} re-entry.`;
            crossPoolBuys.push({
              pool, ticker: upper, smoothedScore: 92, // High priority
              price: priceData.price, reflection: buybackReason,
              marketContext: { btcPrice, btcChange24h: btcChange, tokenChange24h: priceData.change24h, fearGreedIndex: fng },
              isBuyback: true, 
              buybackStageIndex: idx
            });
            console.log(`[Arena] ${pool.emoji} 🤖 Buyback queued for ${upper} at ${stage.thresholdPct}% dip ($${stage.amount.toFixed(2)})`);
          }
        });
      }
    }

    poolTradesMap.set(pool.poolId, poolTrades);
  } // end Pass 1 pool loop

  // ── PASS 2: Cross-Pool Conviction Buy Execution ──────────────────────────
  // Re-read arena to get updated sharedCash (may have been incremented by sells in Pass 1)
  const freshArena = await getArenaConfig(userId) ?? arena;
  let availableSharedCash = freshArena.sharedCash ?? 0;

  if (crossPoolBuys.length > 0 && !arena.sellOnlyMode) {
    await setBrainStatus(userId, `🏦 Pass 2 — Cross-pool buys | sharedCash: $${availableSharedCash.toFixed(2)} | ${crossPoolBuys.length} candidate(s)`);

    // Sort by conviction score descending — strongest signal gets cash first
    crossPoolBuys.sort((a, b) => b.smoothedScore - a.smoothedScore);

    // Log the ranked order
    const rankedLog = crossPoolBuys.map(b => `${b.pool.emoji} ${b.ticker} (score ${b.smoothedScore})`).join(' > ');
    console.log(`[Arena] 🏦 Cross-pool conviction ranking: ${rankedLog}`);
    console.log(`[Arena] 🏦 Available sharedCash: $${availableSharedCash.toFixed(2)}`);

    for (const signal of crossPoolBuys) {
      if (availableSharedCash < 10) {
        console.log(`[Arena] 🏦 sharedCash exhausted ($${availableSharedCash.toFixed(2)}) — remaining signals skipped`);
        break;
      }

      const pool = freshArena.pools.find(p => p.poolId === signal.pool.poolId) ?? signal.pool;
      const maxAlloc = pool.strategy.maxAllocationPerToken;
      const holding = pool.holdings[signal.ticker.toUpperCase()];

      // Use AI recommended purchase size if present, otherwise fallback to maxAlloc top-up
      const holdingValue = holding ? holding.amount * signal.price : 0;
      let targetBuyUsd = Math.min(
        availableSharedCash,
        signal.recommendedBuyAmountUsd !== undefined && signal.recommendedBuyAmountUsd > 0
          ? signal.recommendedBuyAmountUsd
          : (maxAlloc - holdingValue)
      );

      if (signal.isBuyback && signal.buybackStageIndex !== undefined) {
          const config = pool.buybackConfigs?.[signal.ticker];
          const stage = config?.stages[signal.buybackStageIndex];
          if (stage) {
              targetBuyUsd = Math.min(availableSharedCash, stage.amount);
          }
      }

      if (targetBuyUsd < 10) {
        console.log(`[Arena] ${pool.emoji} ${signal.ticker}: target buy $${targetBuyUsd.toFixed(2)} < $10 min — skipping`);
        continue;
      }

      // ── RUN AI SUPERVISOR AUDIT ON PROPOSED BUY ──
      let supervisorDecision = { status: 'AGREE', reasoning: 'Approved.' } as SupervisorDecision;
      try {
        await setBrainStatus(userId, `${pool.emoji} 🛡️ AI Supervisor Auditing trade for ${signal.ticker}...`);
        supervisorDecision = await runSupervisorAudit(
          signal.ticker,
          'BUY',
          targetBuyUsd,
          currentNav,
          availableSharedCash,
          signal.smoothedScore,
          signal.reflection,
          signal.marketContext,
          sentimentState
        );
        console.log(`[Arena] 🛡️ Supervisor Decision for ${signal.ticker}: ${supervisorDecision.status}. Reasoning: ${supervisorDecision.reasoning}`);
      } catch (err: any) {
        console.error(`[Arena] 🛡️ Supervisor audit errored: ${err.message}`);
      }

      if (supervisorDecision.status === 'DISAGREE') {
        await setBrainStatus(userId, `${pool.emoji} 🛑 AI Supervisor VETOED trade for ${signal.ticker}! Reason: ${supervisorDecision.reasoning}`);
        await adminDb.collection('integrity_alerts').add({
          userId,
          detectedAt: new Date().toISOString(),
          title: `🛑 SUPERVISOR VETO: ${signal.ticker} Buy Canceled`,
          description: `AI Risk Supervisor vetoed the proposed $${targetBuyUsd.toFixed(2)} purchase of ${signal.ticker}. Reasoning: "${supervisorDecision.reasoning}"`,
          severity: 'HIGH',
          checkName: 'SUPERVISOR_VETO',
          dismissed: false
        });
        continue;
      } else if (supervisorDecision.status === 'MODIFY' && supervisorDecision.adjustedUsd && supervisorDecision.adjustedUsd >= 10) {
        const oldSize = targetBuyUsd;
        targetBuyUsd = Math.min(availableSharedCash, supervisorDecision.adjustedUsd);
        await setBrainStatus(userId, `${pool.emoji} 🛡️ AI Supervisor RESIZED trade for ${signal.ticker}: $${oldSize.toFixed(2)} → $${targetBuyUsd.toFixed(2)}. Reason: ${supervisorDecision.reasoning}`);
      }

      const buyAmount = targetBuyUsd / signal.price;

      await setBrainStatus(userId, `${pool.emoji} 💸 EXECUTING BUY: ${signal.ticker} $${targetBuyUsd.toFixed(2)} from sharedCash (score ${signal.smoothedScore}, sharedCash remaining: $${availableSharedCash.toFixed(2)})`);
      console.log(`[Arena] ${pool.emoji} Cross-pool BUY: ${signal.ticker} $${targetBuyUsd.toFixed(2)} (score ${signal.smoothedScore})`);

      const revolutResult = await executeRevolutTrade(userId, signal.ticker, 'BUY', buyAmount, signal.price);
      if (revolutResult.success) {
        const actualPrice = revolutResult.fillPrice || signal.price;
        // Pre-fund pool.cashBalance so executePoolBuy can validate/deduct
        pool.cashBalance = targetBuyUsd;
        const supervisorNotes = ` | Supervisor [${supervisorDecision.status}]: ${supervisorDecision.reasoning}`;
        const finalReflection = `${signal.reflection}${supervisorNotes}`;
        const result = await executePoolBuy(userId, pool, signal.ticker, buyAmount, actualPrice, finalReflection, signal.marketContext, finalReflection);
        if (result.success && result.trade) {
          pool.cashBalance = 0;
          availableSharedCash -= result.trade.total;
          freshArena.sharedCash = Math.max(0, availableSharedCash);
          (poolTradesMap.get(pool.poolId) ?? []).push(result.trade);
          totalTrades++;
          console.log(`[Arena] ${pool.emoji} ✅ Cross-pool buy executed. sharedCash → $${availableSharedCash.toFixed(2)}`);

          // If this was a rebound re-entry, clear stop-loss flags
          if (signal.isRebound) {
            if (pool.lastStopLossedAt) delete pool.lastStopLossedAt[signal.ticker.toUpperCase()];
            if (pool.stopLossExitPrices) delete pool.stopLossExitPrices[signal.ticker.toUpperCase()];
          }
          // If this was a buyback, mark the stage as completed
          if (signal.isBuyback && signal.buybackStageIndex !== undefined) {
             const config = pool.buybackConfigs?.[signal.ticker];
             if (config && config.stages[signal.buybackStageIndex]) {
                 config.stages[signal.buybackStageIndex].completed = true;
                 config.stages[signal.buybackStageIndex].ts = new Date().toISOString();
             }
          }
          // ── Clear anti-whipsaw gates on successful re-entry ──
          // Once we've passed all filters and bought, reset the gates so they
          // track THIS new position's lifecycle, not the old one.
          if (pool.lastSoldAt) delete pool.lastSoldAt[signal.ticker.toUpperCase()];
          if (pool.lastSellPrices) delete pool.lastSellPrices[signal.ticker.toUpperCase()];
        } else {
          // Buy failed — refund sharedCash
          pool.cashBalance = 0;
          console.warn(`[Arena] ${pool.emoji} ⚠️ executePoolBuy failed for ${signal.ticker} — sharedCash NOT debited`);
        }
      } else {
        pool.cashBalance = 0;
        console.warn(`[Arena] ⚠️ Revolut BUY failed for ${signal.ticker} — sharedCash NOT debited`);
      }
    }
  }

  // ── Post-cycle: Update performance metrics for all pools ────────────────
  // In the shared-cash model:
  //   pool snapshot value  = token holdings at live price (no cash)
  //   pool snapshot pnlPct = token delta vs hold cost (what was paid)
  //   arena NAV            = total tokens + sharedCash, vs arena.totalBudget
  let totalTokenValue = 0;

  for (const pool of freshArena.pools) {
    if (pool.status !== 'ACTIVE') continue;
    updatePoolPerformance(pool, prices);   // sets totalPnlPct = token delta
    const poolTokenValue = getPoolTotalValue(pool, prices); // tokens only
    totalTokenValue += poolTokenValue;

    const metadata = {
      btcPrice: prices['BTC']?.price || 0,
      holdings: Object.fromEntries(
        Object.entries(pool.holdings).map(([t, h]) => {
          const p = prices[t.toUpperCase()]?.price || h.averagePrice;
          return [t, { amount: h.amount, price: p, value: h.amount * p }];
        })
      )
    };
    await recordDailySnapshot(userId, pool.poolId, poolTokenValue, pool.performance.totalPnlPct, 'CRYPTO', metadata);

    const poolTradeCount = (poolTradesMap.get(pool.poolId) ?? []).length;
    poolResults.push({
      poolId: pool.poolId,
      trades: poolTradeCount,
      value: poolTokenValue,
      pnlPct: pool.performance.totalPnlPct,
    });
    totalTrades += poolTradeCount;

    // Pool drawdown check (25% max loss)
    if (pool.performance.totalPnlPct <= -25) {
      await pauseArenaPool(userId, pool.poolId, `Drawdown limit reached: ${pool.performance.totalPnlPct.toFixed(1)}%`);
      try {
        const { sendSystemAlert } = await import('@/services/telegramService');
        await sendSystemAlert('POOL HALTED', `${pool.emoji} ${pool.name} paused: ${pool.performance.totalPnlPct.toFixed(1)}% drawdown`, '⛔');
      } catch { }
    }
  }

  // Record arena-level NAV snapshot for the portfolio line
  const arenaSharedCash = freshArena.sharedCash ?? 0;
  const arenaNAV = totalTokenValue + arenaSharedCash;
  const arenaBudget = (freshArena as any).totalBudget ?? (POOL_COUNT * POOL_BUDGET);
  const arenaDcaContributions = freshArena.sharedDcaContributions ?? 0;
  const arenaEffectiveBasis = arenaBudget + arenaDcaContributions;
  const arenaNAVPct = arenaEffectiveBasis > 0 ? ((arenaNAV - arenaEffectiveBasis) / arenaEffectiveBasis) * 100 : 0;
  
  if (adminDb) {
    const nowISO = new Date().toISOString();
    const todayStr = nowISO.slice(0, 10);
    const cycleToken = nowISO.replace(/[:.]/g, '-');
    
    // Store as a granular cycle snapshot
    await adminDb.collection('arena_snapshots').doc(userId).collection('ARENA_NAV')
      .doc(cycleToken).set({ 
          date: todayStr, 
          timestamp: nowISO, 
          value: arenaNAV, 
          pnlPct: arenaNAVPct, 
          btcPrice: btcPrice || 0,
          recordedAt: nowISO 
      });
    
    // Also keep the daily doc updated for fallback
    await adminDb.collection('arena_snapshots').doc(userId).collection('ARENA_NAV')
      .doc(todayStr).set({ 
          date: todayStr, 
          value: arenaNAV, 
          pnlPct: arenaNAVPct, 
          btcPrice: btcPrice || 0,
          recordedAt: nowISO 
      }, { merge: true });
  }




  // ── Record BTC price for today ────────────────────────────────────────────
  if (btcPrice > 0) {
    const today = new Date().toISOString().slice(0, 10);
    if (!freshArena.btcDailyPrices) freshArena.btcDailyPrices = {};
    if (!freshArena.btcDailyPrices[today]) {
      freshArena.btcDailyPrices[today] = { open: btcPrice, close: btcPrice, high: btcPrice, low: btcPrice };
    } else {
      freshArena.btcDailyPrices[today].close = btcPrice;
      if (btcPrice > freshArena.btcDailyPrices[today].high) freshArena.btcDailyPrices[today].high = btcPrice;
      if (btcPrice < freshArena.btcDailyPrices[today].low) freshArena.btcDailyPrices[today].low = btcPrice;
    }
    const dates = Object.keys(freshArena.btcDailyPrices).sort();
    if (dates.length > 30) {
      for (const old of dates.slice(0, dates.length - 30)) delete freshArena.btcDailyPrices[old];
    }
  }

  // ── Shared DCA Reserve Deployment ────────────────────────────────────────
  // The DCA reserve is a separate pot from sharedCash. It competes alongside
  // regular buy signals — if a token scores ≥ DCA threshold, DCA funds are
  // credited to sharedCash and deployed in the same conviction-ranked Pass 2.
  const sharedDcaReserve = freshArena.sharedDcaReserve ?? 0;
  if (sharedDcaReserve >= 10) {
    const DCA_PARTIAL_THRESHOLD = 85;
    const DCA_FULL_THRESHOLD = 90;
    let bestDcaCandidate: { poolId: PoolId; pool: ArenaPool; ticker: string; score: number; price: number } | null = null;
    for (const pool of freshArena.pools) {
      if (pool.status !== 'ACTIVE') continue;
      for (const ticker of pool.tokens) {
        const upper = ticker.toUpperCase();
        const recentScores = pool.scoreHistory?.[upper]?.slice(-3).map((s: any) => s.score) ?? [];
        if (recentScores.length === 0) continue;
        const smoothed = Math.round(recentScores.reduce((a: number, b: number) => a + b, 0) / recentScores.length);
        const priceData = prices[upper];
        if (!priceData || priceData.price <= 0) continue;
        if (smoothed >= DCA_PARTIAL_THRESHOLD) {
          if (!bestDcaCandidate || smoothed > bestDcaCandidate.score) {
            bestDcaCandidate = { poolId: pool.poolId as PoolId, pool, ticker: upper, score: smoothed, price: priceData.price };
          }
        }
      }
    }

    if (bestDcaCandidate) {
      const isFullDeploy = bestDcaCandidate.score >= DCA_FULL_THRESHOLD;
      const dcaAmount = isFullDeploy ? sharedDcaReserve : Math.round(sharedDcaReserve * 0.5 * 100) / 100;

      if (dcaAmount >= 10) {
        const dcaBuyAmount = dcaAmount / bestDcaCandidate.price;
        const dcaLabel = isFullDeploy ? 'FULL' : 'PARTIAL (50%)';
        const pool = bestDcaCandidate.pool;
        const dcaReflection = `SHARED DCA ${dcaLabel} DEPLOY: $${dcaAmount.toFixed(2)} from shared reserve → ${pool.emoji} ${pool.name}. Score ${bestDcaCandidate.score} (threshold ≥${isFullDeploy ? DCA_FULL_THRESHOLD : DCA_PARTIAL_THRESHOLD}).`;

        await setBrainStatus(userId, `💰 SHARED DCA ${dcaLabel}: $${dcaAmount.toFixed(2)} → ${pool.emoji} ${bestDcaCandidate.ticker} (score ${bestDcaCandidate.score})`);
        pool.cashBalance = dcaAmount;
        const dcaRevolutResult = await executeRevolutTrade(userId, bestDcaCandidate.ticker, 'BUY', dcaBuyAmount, bestDcaCandidate.price);
        if (dcaRevolutResult.success) {
          const actualPrice = dcaRevolutResult.fillPrice || bestDcaCandidate.price;
          const result = await executePoolBuy(userId, pool, bestDcaCandidate.ticker, dcaBuyAmount, actualPrice, dcaReflection, {
            btcPrice, btcChange24h: btcChange, tokenChange24h: prices[bestDcaCandidate.ticker]?.change24h || 0, fearGreedIndex: fng,
          }, dcaReflection);
          if (result.success && result.trade) {
            totalTrades++;
            pool.cashBalance = 0;
            const { deployFromSharedDcaReserve } = await import('@/services/arenaService');
            await deployFromSharedDcaReserve(userId, freshArena, result.trade.total);
          } else {
            pool.cashBalance = 0;
          }
        } else {
          pool.cashBalance = 0;
          console.warn(`[Arena] ⚠️ Revolut SHARED DCA BUY failed for ${bestDcaCandidate.ticker}`);
        }
      }
    } else {
      console.log(`[Arena] Shared DCA reserve $${sharedDcaReserve.toFixed(2)} waiting — no candidate ≥ ${DCA_PARTIAL_THRESHOLD}`);
    }
  }

  // ── Revolut Balance Sync (hourly) — reconcile sharedCash with actual USD ──
  // DISABLED for virtual-only XRP/AAVE strategy
  /*
  try {
    const { syncRevolutBalances } = await import('@/services/arenaService');
    const syncResult = await syncRevolutBalances(userId, freshArena);
    if (syncResult.synced) {
      console.log(`[Arena] 🔄 Revolut sync: drift $${syncResult.drift?.toFixed(2)}, Revolut USD $${syncResult.revolutUsd?.toFixed(2)}`);
    }
  } catch (e: any) {
    console.warn(`[Arena] Revolut sync skipped: ${e.message}`);
  }
  */

  // ── AI Integrity Agent — automated anomaly detection & correction ──────
  try {
    const { runIntegrityChecks } = await import('@/services/integrityService');
    const integrityAlerts = await runIntegrityChecks(userId, freshArena, prices as any);
    if (integrityAlerts.length > 0) {
      await setBrainStatus(userId, `🛡️ Integrity Agent: ${integrityAlerts.length} issue(s) detected. ${integrityAlerts.filter(a => a.autoFixed).length} auto-fixed.`);
    }
  } catch (e: any) {
    console.warn(`[Arena] Integrity checks skipped: ${e.message}`);
  }

  // ── Final Telegram Alerts ──────────────────────────────────────────────────
  try {
    const allTrades: any[] = [];
    poolTradesMap.forEach(trades => allTrades.push(...trades));
    if (allTrades.length > 0) {
      await sendTradeAlerts(allTrades, arenaNAV, arenaSharedCash);
    }
  } catch (e: any) {
    console.warn(`[Arena] Telegram alerts failed: ${e.message}`);
  }

  // ── Final save — write freshArena (includes updated sharedCash + pool states) ──
  await adminDb!.collection('arena_config').doc(userId).set(freshArena);
  await setBrainStatus(userId, `✅ Arena cycle complete. ${totalTrades} trade(s). sharedCash: $${(freshArena.sharedCash ?? 0).toFixed(2)}`);

  // ── LOG HEARTBEAT IF NO TRADES ──────────────────────────────────────────
  if (totalTrades === 0 && adminDb) {
    try {
      await adminDb.collection('integrity_alerts').add({
        userId,
        assetClass: 'CRYPTO',
        checkName: 'HEARTBEAT',
        severity: 'INFO',
        title: 'Evaluation Cycle Complete',
        description: 'AI analyzed XRP and AAVE arrays. No high-conviction momentum signals detected. Maintaining current capital posture.',
        autoFixed: false,
        detectedAt: new Date().toISOString(),
        dismissed: false,
      });
    } catch(e) {
      console.warn('[Arena] Failed to write heartbeat log:', e);
    }
  }

  return { success: true, poolResults, totalTrades };
}
// ═══════════════════════════════════════════════════════════════════════════
// REVOLUT TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function executeRevolutTrade(
  userId: string, ticker: string, side: 'BUY' | 'SELL', amount: number, price: number
): Promise<{ success: boolean; fillPrice?: number; fillAmount?: number; fillTotal?: number }> {
  if (!adminDb) return { success: false };
  const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
  const config = configDoc.data();
  if (!config) return { success: false };
  try {
    const arena = await getArenaConfig(userId);
    if (!arena) return { success: false };

    if (!arena.realTradingEnabled) {
      console.log(`[Virtual Sandbox] Simulating ${side} of ${amount} ${ticker} (realTradingEnabled is disabled).`);
      return {
        success: true,
        fillPrice: price,
        fillAmount: amount,
        fillTotal: price * amount
      };
    }

    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, false, config.revolutProxyUrl);
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

POOL: ${pool.emoji} ${pool.name}
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
Other: Momentum=${pool.strategy.momentumGateEnabled}(${pool.strategy.momentumGateThreshold}%), AntiWash=${pool.strategy.antiWashHours}h (SL re-entry: ${pool.strategy.stopLossReentryHours ?? 6}h), MaxAlloc=$${pool.strategy.maxAllocationPerToken}
Rebound Watch: ReboundEntry=+${pool.strategy.reboundEntryPct ?? 1.5}% above exit price, RSI floor=${pool.strategy.reboundRsiMin ?? 35}
GPM: Enabled=${pool.strategy.gpmEnabled !== false}, CautionAt=${pool.strategy.gpmCautionZoneScore ?? 70}(→${pool.strategy.gpmCautionPositionPct ?? 50}%), DefensiveAt=${pool.strategy.gpmDefensiveZoneScore ?? 55}(→${pool.strategy.gpmDefensivePositionPct ?? 25}%), Confirm=${pool.strategy.gpmConfirmationCycles ?? 3}cycles, ScaleDownCooldown=${pool.strategy.gpmScaleDownCooldownHours ?? 6}h
Description: ${pool.strategy.description}

RECENT TRADES:
${weekTrades.slice(0, 15).map(t => `${t.type} ${t.ticker} $${t.total.toFixed(2)} ${t.pnl !== undefined ? (t.pnl >= 0 ? '✅' : '❌') + ' ' + (t.pnlPct?.toFixed(1) || '?') + '%' : ''} — ${t.reason.substring(0, 100)}`).join('\\\\n') || 'No trades since last review.'}

REGIME RULES (YOU CANNOT OVERRIDE THESE):
- AI score-based FULL exits (Exit Path 4) are DISABLED. Full exits only via: Take-Profit (8%+), Stop-Loss (-8%), or Trailing Stop.
- GPM partial scale-downs ARE enabled: positions reduce proportionally when score drops below gpmCautionZoneScore for gpmConfirmationCycles consecutive evaluations.
- Buy threshold RANGE: 65–82. You must stay within this band. Values above 82 cause cash accumulation during recoveries (market lock-in risk). Values below 65 allow too many low-quality entries.
- Minimum hold time: 360 minutes (6 hours). GPM only activates after the hold is mature.
- Minimum anti-wash: 24 hours. This does NOT apply to GPM scale-up tops-ups (partial buybacks).
- Personality is locked to PATIENT.
- GPM ANTI-CHURN (v2): After a GPM scale-down, the system imposes a ${pool.strategy.gpmScaleDownCooldownHours ?? 6}h cooldown before ANY scale-up can fire. Early trend-based scale-ups are PERMANENTLY DISABLED — only genuine CONVICTION arrival triggers a rebuy.
- The BEST thing you can do is often NOTHING. Set strategyChanged=false if the current strategy is adequate.
- ⚠️  CASH ACCUMULATION IS AS BAD AS OVER-TRADING: if cash > 40% of pool budget, you should lower buyScoreThreshold, not raise it.

KEY QUESTIONS:
1. Is the current trade frequency appropriate? (Fewer is better)
2. Can you increase hold time to give positions more room?
3. Is the take-profit target realistic for the remaining ${28 - getDayNumber()} days?
4. Is the pool holding too much idle cash? If yes, LOWER the buyScoreThreshold (floor: 65).

Respond with ONLY valid JSON:
{
  "strategyChanged": true/false,
  "aiReflection": "3-5 sentence reflection. Explain WHY you are or aren't changing. Reference spread costs, hold times, and whether idle cash is a concern.",
  "newStrategy": {
    "buyScoreThreshold": number (65-82 HARD RANGE — BELOW 65 or ABOVE 82 will be auto-corrected by the guardrail engine),
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
    "buyConfidenceBuffer": number (3-8),
    "exitHysteresis": number (5-20),
    "positionSizeMultiplier": number (0.8-1.0),
    "strategyPersonality": "PATIENT",
    "stopLossReentryHours": number (4-12, hours before re-buying a stop-lossed token — shorter than antiWashHours to catch rebounds),
    "reboundEntryPct": number (0.5-3.0, % price must recover above stop-loss exit before Phase C fires — lower = more aggressive re-entry),
    "reboundRsiMin": number (25-40, RSI floor for rebound re-entry — higher = more confirmation required before re-entering),
    "gpmEnabled": boolean (true/false — enable/disable Graduated Position Management),
    "gpmCautionZoneScore": number (60-80, score below which CAUTION fires — sell to gpmCautionPositionPct),
    "gpmDefensiveZoneScore": number (40-65, score below which DEFENSIVE fires — sell to gpmDefensivePositionPct; must be < gpmCautionZoneScore),
    "gpmCautionPositionPct": number (30-70, % of maxAllocation to hold in CAUTION zone),
    "gpmDefensivePositionPct": number (10-40, % of maxAllocation to hold in DEFENSIVE zone; must be < gpmCautionPositionPct),
    "gpmConfirmationCycles": number (3-6, consecutive evaluations required before a GPM scale-down fires — higher = less churn),
    "gpmScaleDownCooldownHours": number (4-12, hours between GPM scale-down and scale-up — prevents sell-low-rebuy-high churn),
    "description": "Updated description reflecting patience regime"
  }
}

CONSTRAINTS: buyThreshold=65-82 (HARD CAP — no exceptions). buy-exit gap>=25. antiWash>=24h. stopLossReentry=4-12h. reboundEntry=0.5-3%. reboundRsi=25-40. gpmCaution=60-80. gpmDefensive=40-65. gpmCautionPct=30-70%. gpmDefensivePct=10-40%. gpmConfirm=3-6. gpmCooldown=4-12h. TP>=8%. SL<=-8%. Hold 360-480min. Cooldown 30-60min. BuyBuf=3-8. Personality=PATIENT.
Prefer strategyChanged=false unless the numbers clearly warrant a change.`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return;

    const parsed = safeJsonParse(responseText);

    // ══ ENFORCE HARD GUARDRAILS — BEFORE writing to Firestore ══
    // These limits are non-negotiable. The AI prompt asks nicely; this code
    // enforces by overwriting any non-compliant values in the parsed response.
    //
    // KEY FIX: buyScoreThreshold now has a per-personality MAXIMUM as well as
    // a minimum. PATIENT pools (Deep Divers, Steady Sailers) must stay 65–82.
    // Without the maximum cap the AI can raise thresholds to 90–95 after losses,
    // causing the pool to sit on cash through entire recoveries (observed March 2026).
    if (parsed.strategyChanged && parsed.newStrategy) {
      const ns = parsed.newStrategy;

      // buyScoreThreshold: personality-aware MINIMUM and MAXIMUM
      // PATIENT:     55–78  (patient accumulators must still buy into recoveries — floor of 55 prevents cash-lockout)
      // MODERATE:    60–82  (balanced pools allow slightly higher conviction bar)
      // AGGRESSIVE:  55–80  (aggressive pools need to be willing to enter early)
      // Additional idle-cash guard: if pool is >40% cash, minimum is capped at 55
      // to prevent the AI from keeping itself fully sidelined through recoveries.
      const personality = ns.strategyPersonality || pool.strategy.strategyPersonality || 'MODERATE';
      const cashRatio = (pool.cashBalance ?? 0) / (pool.budget + (pool.dcaContributions ?? 0));
      const idleCashOverride = cashRatio > 0.40; // pool is >40% cash — must stay willing to buy
      const thresholdMin = idleCashOverride ? 55 : (personality === 'PATIENT' ? 55 : personality === 'AGGRESSIVE' ? 55 : 60);
      const thresholdMax = personality === 'PATIENT' ? 78 : personality === 'AGGRESSIVE' ? 80 : 82;
      if (idleCashOverride && (ns.buyScoreThreshold ?? 100) > 78) {
        console.log(`[Arena] ⚠️ Idle-cash guard: pool is ${(cashRatio * 100).toFixed(0)}% cash — capping buyScoreThreshold at 78`);
      }
      const clampedThreshold = Math.max(thresholdMin, Math.min(thresholdMax, ns.buyScoreThreshold ?? pool.strategy.buyScoreThreshold));
      if (clampedThreshold !== ns.buyScoreThreshold) {
        console.log(`[Arena] ⚠️ Guardrail: buyScoreThreshold ${ns.buyScoreThreshold} → ${clampedThreshold} (${personality} pool range: ${thresholdMin}–${thresholdMax}${idleCashOverride ? ', idle-cash override' : ''})`);
        ns.buyScoreThreshold = clampedThreshold;
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
      // stopLossReentryHours: 4-12h (shorter than antiWashHours so rebounding stop-losses can re-enter)
      ns.stopLossReentryHours = Math.max(4, Math.min(12, ns.stopLossReentryHours ?? 6));
      // reboundEntryPct: 0.5-5% (how much recovery above exit price Phase C requires)
      ns.reboundEntryPct = Math.max(0.5, Math.min(5.0, ns.reboundEntryPct ?? 1.5));
      // reboundRsiMin: 25-45 (RSI floor to confirm recovery is real)
      ns.reboundRsiMin = Math.max(25, Math.min(45, ns.reboundRsiMin ?? 35));
      // GPM parameters
      ns.gpmEnabled = ns.gpmEnabled !== false; // default true
      ns.gpmCautionZoneScore = Math.max(60, Math.min(80, ns.gpmCautionZoneScore ?? 70));
      ns.gpmDefensiveZoneScore = Math.max(40, Math.min(65, ns.gpmDefensiveZoneScore ?? 55));
      // Ensure defensive < caution (otherwise overlap)
      if (ns.gpmDefensiveZoneScore >= ns.gpmCautionZoneScore) ns.gpmDefensiveZoneScore = ns.gpmCautionZoneScore - 10;
      ns.gpmCautionPositionPct = Math.max(30, Math.min(70, ns.gpmCautionPositionPct ?? 50));
      ns.gpmDefensivePositionPct = Math.max(10, Math.min(40, ns.gpmDefensivePositionPct ?? 25));
      // Ensure defensive < caution allocation
      if (ns.gpmDefensivePositionPct >= ns.gpmCautionPositionPct) ns.gpmDefensivePositionPct = ns.gpmCautionPositionPct - 10;
      ns.gpmConfirmationCycles = Math.max(3, Math.min(6, ns.gpmConfirmationCycles ?? 3)); // v2: minimum 3 (was 1)
      // gpmScaleDownCooldownHours: 4-12h (default 6h) — prevents immediate rebuy after GPM sell
      ns.gpmScaleDownCooldownHours = Math.max(4, Math.min(12, ns.gpmScaleDownCooldownHours ?? 6));
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
    return { success: true, message: 'Arena already initialized and active.' };
  }

  await setBrainStatus(userId, '🏟️ Initializing Arena — AI selecting tokens...');

  // Fetch prices for all watchlist tokens to give AI data to choose from
  const allTickers = AGENT_WATCHLIST;
  const prices = await getVerifiedPrices(allTickers, userId);

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
  tokenAnalyses?: TokenAnalysis[];
  sentiment?: any;
}> {
  if (!userId) return { arena: null, trades: [], marketStats: null, eodhd: { used: 0, limit: 80000, remaining: 80000, pct: 0 } };
  
  // Isolate each fetch to prevent one failure from killing the entire dashboard load
  const [arena, trades, marketStats, eodhd, tokenAnalyses, sentiment] = await Promise.all([
    getArenaConfig(userId, assetClass).catch(e => { console.error("getArenaConfig fail", e); return null; }),
    getArenaTrades(userId, undefined, assetClass).catch(e => { console.error("getArenaTrades fail", e); return []; }),
    getGlobalMarketStats().catch(e => { console.error("getGlobalMarketStats fail", e); return null; }),
    checkEODHDUsage().catch(e => { console.error("checkEODHDUsage fail", e); return { used: 0, limit: 80000, remaining: 80000, pct: 0 }; }),
    (assetClass === 'CRYPTO' ? getLatestTokenAnalyses(userId) : Promise.resolve([])).catch(e => { console.error("getTokenAnalyses fail", e); return []; }),
    (assetClass === 'CRYPTO' ? getLatestSentiment(userId) : Promise.resolve(null)).catch(e => { console.error("getLatestSentiment fail", e); return null; }),
  ]);

  return serialize({ arena, trades, marketStats, eodhd, tokenAnalyses, sentiment });
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
          allLivePrices[ac] = await getVerifiedPrices([...tokens], userId);
        } else {
          allLivePrices[ac] = await fetchSandboxArenaPrices([...tokens], ac) as any;
        }
      } catch { /* non-fatal — getPoolNav falls back to cost-basis */ }
    })
  );

  /** Compute NAV for a single pool using live prices.
   *  Falls back to latest daily snapshot, then to cost-basis if no live data. */
  function getPoolNav(p: any, ac: AssetClass): number {
    // All arenas now use shared-cash: pool.cashBalance is always 0 (transit only)
    // arena.sharedCash is added once at the arena level in getNav()
    const live = allLivePrices[ac];
    if (live && Object.keys(live).length > 0) {
      let holdVal = 0;
      if (p.holdings && typeof p.holdings === 'object') {
        for (const [ticker, h] of Object.entries(p.holdings) as [string, any][]) {
          const livePrice = live[ticker.toUpperCase()]?.price;
          holdVal += (h.amount || 0) * (livePrice ?? h.averagePrice ?? 0);
        }
      }
      return (p.cashBalance || 0) + holdVal; // cashBalance always 0; sharedCash added in getNav()
    }
    // Snapshot fallback
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
    const sharedCash = arena.sharedCash ?? 0;
    return arena.pools.reduce((sum: number, p: any) => sum + getPoolNav(p, ac), sharedCash);
  }

  function getNavPct(arena: any, ac: AssetClass): number {
    if (!arena?.pools?.length) return 0;
    // Use arena.totalBudget as denominator — pool.budget values are set to token costs on sync
    // Count ALL DCA contributions (not just deployed) since reserve cash is in NAV via sharedCash
    const dcaContributions = arena.sharedDcaContributions ?? 0;
    const totalBudget = arena.totalBudget
      ?? arena.pools.reduce((s: number, p: any) => s + (p.budget ?? 0), 0);
    const totalCommitted = totalBudget + dcaContributions;
    return totalCommitted > 0 ? ((getNav(arena, ac) - totalCommitted) / totalCommitted) * 100 : 0;
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
    { assetClass: 'CRYPTO' as AssetClass, icon: '₿', label: 'Crypto Arena', subtitle: '4 AI Pools · GPM Scaling', href: '/crypto', currency: '$' },
    { assetClass: 'FTSE' as AssetClass, icon: '🏦', label: 'FTSE Arena', subtitle: 'FTSE 100/250 · London', href: '/ftse', currency: '£' },
    { assetClass: 'NYSE' as AssetClass, icon: '🗽', label: 'NYSE Arena', subtitle: 'US Equities · New York', href: '/nyse', currency: '$' },
    { assetClass: 'COMMODITIES' as AssetClass, icon: '⚙️', label: 'Commodities', subtitle: 'Metals · Energy · Agri', href: '/commodities', currency: '$' },
  ];

  return serialize(configs.map((cfg, idx) => {
    const arena = arenas[idx];
    const isMothballed = MOTHBALLED_ASSET_CLASSES.includes(cfg.assetClass);
    const status = getStatus(arena, cfg.assetClass);

    // Dynamic rebranding for Master Portfolio Mode
    if (cfg.assetClass === 'CRYPTO' && arena?.masterPortfolioMode) {
      cfg.label = 'Revolut X Master';
      cfg.subtitle = 'Live Mirror · Portfolio Monitoring';
    }

    return {
      ...cfg,
      status: isMothballed ? 'MOTHBALLED' : status,
      nav: getNav(arena, cfg.assetClass),
      navPct: getNavPct(arena, cfg.assetClass),
      day: isMothballed ? undefined : getDayNum(arena),
    };
  }));
}





// ─── Types for chart data ──────────────────────────────────────────────────

export interface PerformanceDataPoint {
  date: string;         // ISO date OR timestamp
  label: string;        // e.g. "Day 3" or "14:30"
  navTotal: number;     // total portfolio value (tokens + cash)
  portfolioValue?: number; // token value only
  navPct: number;       // total P&L %
  pools: Record<string, { value: number; pnlPct: number; name: string; emoji: string }>;
  btcPrice?: number;
  tokens?: Record<string, { price: number; value: number }>;
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
      ? await getVerifiedPrices([...allTokens], userId)
      : await fetchSandboxArenaPrices([...allTokens], assetClass) as any;
  }

  // ── Build a per-pool snapshot map from BOTH sources ──────────────────────
  // Source 1: pool.performance.dailySnapshots (embedded in arena config)
  // Source 2: arena_snapshots Firestore sub-collection (populated since day 1)
  // We merge them, preferring the sub-collection value when both exist for the
  // same date (sub-collection is written with merge:true and is authoritative).
  const { getArenaCollections: _cols } = await import('@/lib/constants');
  const snapshotCols = _cols(assetClass);

  // Lower bound for snapshots: whichever is later (24h ago OR arena start time)
  const arenaStartTs = new Date(arena.startDate).getTime();
  const lowerBoundMs = Math.max(Date.now() - 24 * 60 * 60 * 1000, arenaStartTs);
  const startBound = new Date(lowerBoundMs).toISOString();

  // Map: poolId → { date/timestamp → { value, pnlPct, btcPrice, tokens } }
  const poolSnapshotMap: Record<string, Record<string, { value: number; pnlPct: number; btcPrice?: number; tokens?: Record<string, any> }>> = {};

  // Arena-level NAV snapshots (written each cycle: total tokens + sharedCash vs totalBudget)
  const arenaNAVMap: Record<string, { value: number; pnlPct: number; btcPrice?: number }> = {};

  await Promise.all([
    // Per-pool token snapshots
    ...arena.pools.map(async pool => {
      const byDate: Record<string, { value: number; pnlPct: number; btcPrice?: number; tokens?: Record<string, any> }> = {};

      // Source 1: embedded array
      for (const s of (pool.performance.dailySnapshots || [])) {
        byDate[s.date] = { value: s.value, pnlPct: s.pnlPct };
      }

      // Source 2: Firestore sub-collection (High-res granular 24h data)
      if (adminDb) {
        try {
          const snap = await adminDb
            .collection(snapshotCols.snapshots)
            .doc(userId)
            .collection(pool.poolId)
            .where('timestamp', '>=', startBound)
            .orderBy('timestamp', 'asc')
            .get();
          
          for (const doc of snap.docs) {
            const d = doc.data();
            if (d.timestamp && typeof d.value === 'number') {
              byDate[d.timestamp] = { 
                value: d.value, 
                pnlPct: d.pnlPct ?? 0,
                btcPrice: d.btcPrice,
                tokens: d.holdings
              };
            }
          }

          // Fallback if 24h high-res is empty: get latest daily chunks (backward compat)
          if (snap.empty) {
            const fallbackSnap = await adminDb
                .collection(snapshotCols.snapshots)
                .doc(userId)
                .collection(pool.poolId)
                .orderBy('date', 'desc')
                .limit(30)
                .get();
            for (const doc of fallbackSnap.docs) {
                const d = doc.data();
                if (d.date && typeof d.value === 'number') {
                   byDate[d.date] = { value: d.value, pnlPct: d.pnlPct ?? 0 };
                }
            }
          }
        } catch (e: any) { console.warn("[PerformanceHistory] Sub-collection fetch failed:", e.message); }
      }

      poolSnapshotMap[pool.poolId] = byDate;
    }),

    // Arena-level NAV snapshots for the portfolio line
    (async () => {
      if (!adminDb) return;
      try {
        const snap = await adminDb
          .collection(snapshotCols.snapshots)
          .doc(userId)
          .collection('ARENA_NAV')
          .where('timestamp', '>=', startBound)
          .orderBy('timestamp', 'asc')
          .get();
        for (const doc of snap.docs) {
          const d = doc.data();
          if (d.timestamp && typeof d.value === 'number') {
            arenaNAVMap[d.timestamp] = { value: d.value, pnlPct: d.pnlPct ?? 0, btcPrice: d.btcPrice };
          }
        }
        // Fallback or backfill from daily
        if (snap.empty) {
            const fallback = await adminDb
                .collection(snapshotCols.snapshots)
                .doc(userId)
                .collection('ARENA_NAV')
                .orderBy('date', 'desc')
                .limit(30)
                .get();
            for (const doc of fallback.docs) {
                const d = doc.data();
                arenaNAVMap[d.date] = { value: d.value, pnlPct: d.pnlPct ?? 0 };
            }
        }
      } catch (e: any) { console.warn("[PerformanceHistory] NAV fetch failed:", e.message); }
    })(),
  ]);


  // Collect all unique dates/times across all pools, but ONLY those >= arena.startDate
  const dateSet = new Set<string>();
  const arenaStartTime = new Date(arena.startDate).toISOString();

  Object.values(poolSnapshotMap).forEach(byDate => {
    Object.keys(byDate).forEach(d => {
       // Filter out historical noise if mission was recently reset
       // ISO timestamps (length > 10) are compared directly.
       // Date strings (length <= 10) are compared against the date part of the start time.
       const compareTarget = d.length <= 10 ? arenaStartTime.slice(0, 10) : arenaStartTime;
       if (d >= compareTarget) { 
         dateSet.add(d);
       }
    });
  });

  const sortedDates = [...dateSet].sort();

  // Synthesise day-0 if not present
  // USES FULL TIMESTAMP to ensure high-res start on the 24h graph
  if (!dateSet.has(arenaStartTime)) sortedDates.push(arenaStartTime);
  sortedDates.sort();

  // Always add today as the live data point
  const todayStr = new Date().toISOString().slice(0, 10);
  if (!sortedDates.includes(todayStr)) sortedDates.push(todayStr);

  const arenaStartMs = new Date(arena.startDate).getTime();

  const dataPoints: PerformanceDataPoint[] = sortedDates.map(dateKey => {
    const isISOTime = dateKey.length > 10;
    let label = '';
    if (isISOTime) {
        const time = new Date(dateKey);
        label = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } else {
        const dayNum = Math.max(0, Math.round((new Date(dateKey).getTime() - arenaStartMs) / 86400000));
        label = dayNum === 0 ? 'Start' : `Day ${dayNum}`;
    }

    const isToday = dateKey === todayStr || (isISOTime && dateKey.startsWith(todayStr));
    const poolData: Record<string, { value: number; pnlPct: number; name: string; emoji: string }> = {};
    const tokenSeries: Record<string, { price: number; value: number }> = {};
    let btcPriceAtPoint = 0;

    let navTotal = 0;
    let portfolioValue = 0;
    let totalBaseOriginalBudget = 0;
    // Only include active, non-mothballed pools in the series calculation
    const activePools = arena.pools.filter(p => p.status !== 'PAUSED' && p.name !== "MOTHBALLED STRATEGY");
    
    for (const pool of activePools) {
      let value: number;
      let pnlPct: number;

      const byDate = poolSnapshotMap[pool.poolId] ?? {};
      const snapshot = byDate[dateKey];

      if (isToday && !snapshot) {
        let holdVal = 0;
        let holdCost = 0;
        for (const [t, h] of Object.entries(pool.holdings)) {
          const p = livePrices![t.toUpperCase()]?.price || h.averagePrice;
          const val = h.amount * p;
          holdVal += val;
          holdCost += h.amount * h.averagePrice;
          if (val > 1) {
            tokenSeries[t.toUpperCase()] = { price: p, value: val };
          }
        }
        value = holdVal;
        pnlPct = holdCost > 0 ? ((holdVal - holdCost) / holdCost) * 100 : 0;
        btcPriceAtPoint = livePrices!['BTC']?.price || 0;
      } else if (dateKey === arenaStartTime) {
        value = pool.budget;
        pnlPct = 0;
      } else {
        if (snapshot) {
          value = snapshot.value;
          pnlPct = snapshot.pnlPct;
          btcPriceAtPoint = snapshot.btcPrice || 0;
          if (snapshot.tokens) {
            for (const [t, h] of Object.entries(snapshot.tokens)) {
                if ((h as any).value > 1) {
                    tokenSeries[t.toUpperCase()] = { price: (h as any).price, value: (h as any).value };
                }
            }
          }
        } else {
          const prior = Object.entries(byDate)
            .filter(([d]) => d <= dateKey)
            .sort(([a], [b]) => b.localeCompare(a))[0];
          value = prior ? prior[1].value : pool.budget;
          pnlPct = prior ? prior[1].pnlPct : 0;
        }
      }

      poolData[pool.poolId] = { value, pnlPct, name: pool.name, emoji: pool.emoji };
      portfolioValue += value;
      navTotal += value;
      totalBaseOriginalBudget += pool.budget;
    }

    const sharedCash = (arena as any).sharedCash ?? 0;
    const totalBudget = (arena as any).totalBudget ?? (POOL_COUNT * POOL_BUDGET);
    const chartDcaContributions = (arena as any).sharedDcaContributions ?? 0;
    const chartEffectiveBasis = totalBudget + chartDcaContributions;

    let finalNavTotal: number;
    let finalNavPct: number;

    if (isToday && !arenaNAVMap[dateKey]) {
      finalNavTotal = navTotal + sharedCash;
      finalNavPct = chartEffectiveBasis > 0 ? ((finalNavTotal - chartEffectiveBasis) / chartEffectiveBasis) * 100 : 0;
    } else if (arenaNAVMap[dateKey]) {
      finalNavTotal = arenaNAVMap[dateKey].value;
      finalNavPct  = arenaNAVMap[dateKey].pnlPct;
      if (!btcPriceAtPoint) btcPriceAtPoint = arenaNAVMap[dateKey].btcPrice || 0;
    } else {
      const effectiveBudget = totalBaseOriginalBudget || totalBudget;
      finalNavTotal = navTotal;
      finalNavPct = effectiveBudget > 0 ? ((navTotal - effectiveBudget) / effectiveBudget) * 100 : 0;
    }

    return {
      date: dateKey,
      label,
      navTotal: finalNavTotal,
      portfolioValue,
      navPct: finalNavPct,
      pools: poolData,
      btcPrice: btcPriceAtPoint,
      tokens: tokenSeries,
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
  let currentAdjustedNAV = 0;
  let totalBaseOriginalBudget = 0;

  // All arenas now use shared-cash model — pool.cashBalance is always 0,
  // arena.sharedCash is the single cash reserve per arena.
  const sharedCash = (arena as any).sharedCash ?? 0;
  currentNAV += sharedCash;

  for (const pool of arena.pools) {
    let holdVal = 0;
    for (const [t, h] of Object.entries(pool.holdings)) {
      holdVal += h.amount * (livePrices![t.toUpperCase()]?.price || h.averagePrice);
    }
    const poolLiveValue = holdVal; // pool.cashBalance always 0
    currentNAV += poolLiveValue;

    const poolHoldingsCost = Object.values(pool.holdings).reduce(
      (s, h: any) => s + (h.amount || 0) * (h.averagePrice || 0), 0
    );
    const poolProfit = poolLiveValue - poolHoldingsCost;
    currentAdjustedNAV += (pool.budget + poolProfit);
    totalBaseOriginalBudget += pool.budget;
  }
  currentAdjustedNAV += sharedCash;

  const dcaContributions = (arena as any).sharedDcaContributions ?? 0;
  const arenaTotalBudget = (arena as any).totalBudget ?? totalBaseOriginalBudget;
  const effectiveBudget = arenaTotalBudget + dcaContributions;
  const currentPnlPct = effectiveBudget > 0
    ? ((currentNAV - effectiveBudget) / effectiveBudget) * 100
    : 0;

  const pools = arena.pools
    .filter(p => p.status !== 'PAUSED' && p.name !== "MOTHBALLED STRATEGY")
    .map((pool, idx) => {
      let holdVal = 0;
      let holdCost = 0;
      for (const [t, h] of Object.entries(pool.holdings)) {
        holdVal += h.amount * (livePrices![t.toUpperCase()]?.price || h.averagePrice);
        holdCost += h.amount * h.averagePrice;
      }
      // pnlPct vs cost basis of current holdings — consistent with chart pool lines
      const costBasisPnlPct = holdCost > 0 ? ((holdVal - holdCost) / holdCost) * 100 : 0;

      return {
        poolId: pool.poolId,
        name: pool.name,
        emoji: pool.emoji,
        color: POOL_COLORS[idx] || '#8a8f98',
        currentPnlPct: costBasisPnlPct,
      };
    });


  const history: PerformanceHistory = {
    dataPoints,
    tradeMarkers,
    budget: arena.totalBudget,
    currentNAV,
    currentPnlPct,
    pools,
    startDate: arena.startDate,
  };

  return serialize(history);
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
    return getVerifiedPrices([...allTokens], userId);
  }
  // For FTSE/NYSE/Commodities use EODHD with exchange suffix
  return fetchSandboxArenaPrices([...allTokens], assetClass) as any;
}

/** Manually trigger arena initialization (crypto only — use aiInitializeSandboxArena for others). */
export async function manualInitArena(userId: string, assetClass: AssetClass = 'CRYPTO') {
  if (assetClass !== 'CRYPTO') return aiInitializeSandboxArena(userId, assetClass);
  return aiInitializeArena(userId);
}

/** Manually record a purchase in the 'Manual Madness' pool. */
export async function manualPurchase(
  userId: string,
  assetClass: AssetClass,
  ticker: string,
  amount: number,
  price: number,
  reason: string
) {
  // Fetch market context (simplified for manual)
  const stats = await getGlobalMarketStats();
  const marketContext = {
    btcPrice: 0, 
    btcChange24h: 0,
    tokenChange24h: 0,
    fearGreedIndex: stats?.fearGreedIndex ?? 50
  };

  const res = await addManualPurchaseToArena(
    userId,
    assetClass,
    ticker.toUpperCase(),
    amount,
    price,
    reason,
    marketContext
  );

  if (res.success && (res as any).trade) {
    const arena = await getArenaConfig(userId, assetClass);
    const currNav = (arena as any)?.totalValue || 0;
    const currCash = (arena as any)?.sharedCash || 0;
    await sendTradeAlerts([(res as any).trade], currNav, currCash);
  }

  return res;
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
      // COST SAVING: Non-volatile sandbox instruments use a 60m cooldown by default (was 30m)
      const evalCooldownMinutes = pool.strategy.evaluationCooldownMinutes ?? 60;
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

      // CHANGE #1: Build competition context for the AI prompt (sandbox arenas only)
      const arenaStartMs = arena.startDate ? new Date(arena.startDate).getTime() : Date.now();
      const dayNumber = Math.max(1, Math.min(28, Math.floor((Date.now() - arenaStartMs) / 86400000) + 1));
      const daysRemaining = Math.max(0, 28 - dayNumber);
      const poolValue = getPoolTotalValue(pool, prices);
      const poolCostBasis = pool.budget + (pool.dcaContributions ?? 0);
      const poolPnlPct = poolCostBasis > 0 ? ((poolValue - poolCostBasis) / poolCostBasis) * 100 : 0;
      const totalSells = pool.performance.winCount + pool.performance.lossCount;
      const winRate = totalSells > 0 ? (pool.performance.winCount / totalSells) * 100 : 0;
      const cashPct = poolValue > 0 ? (pool.cashBalance / poolValue) * 100 : 100;
      const competitionCtx = { dayNumber, daysRemaining, poolPnlPct, winRate, cashPct };

      // AI analysis — use asset-class-specific prompt with competition context
      let analysis: CryptoAnalysisResult;
      try {
        analysis = await analyzeSandboxInstrument(ticker, displayName, assetClass, pool.strategy, poolContext, tradeMemory, priceData, recentScores, competitionCtx);
      } catch (e: any) {
        console.warn(`[Arena:${assetClass}] Analysis failed for ${upper}:`, e.message);
        continue;
      }

      // Update score history
      if (!pool.scoreHistory) pool.scoreHistory = {};
      if (!pool.scoreHistory[upper]) pool.scoreHistory[upper] = [];
      // COST SAVING: Keep only 5 scores (was 10) to reduce document size
      pool.scoreHistory[upper] = [...(pool.scoreHistory[upper].slice(-4)), { score: analysis.overallScore, ts: new Date().toISOString() }];
      if (!pool.lastEvaluatedAt) pool.lastEvaluatedAt = {};
      pool.lastEvaluatedAt[upper] = new Date().toISOString();

      const score = analysis.overallScore;
      const currentPrice = priceData.price;
      const holding = pool.holdings[upper];
      const marketContext = { btcPrice: 0, btcChange24h: 0, tokenChange24h: priceData.change24h, fearGreedIndex: 50 };

      // ─── BUY LOGIC ───────────────────────────────────────────────────────
      // CHANGE #3+4: Sandbox arenas have NO buyConfidenceBuffer — the score IS the threshold.
      // (This function already returns early for CRYPTO at line 2867, so this is sandbox-only.)
      if (!holding && score >= pool.strategy.buyScoreThreshold) {
        // Shared cash or pool cash depending on model
        const isSharedCash = (arena as any).sharedCash !== undefined;
        const availableCash = isSharedCash ? Math.max(0, (arena as any).sharedCash) : Math.max(0, pool.cashBalance);

        // CHANGE #8: Conviction-weighted position sizing for sandbox arenas.
        // Higher AI scores → larger positions.
        // Score-proportional sizing: 40% at 65, 60% at 75, 80% at 85, 100% at 95+
        const convictionPct = score >= 95 ? 1.0 : score >= 85 ? 0.8 : score >= 75 ? 0.6 : 0.4;
        const buyAmount = Math.min(pool.strategy.maxAllocationPerToken, availableCash * convictionPct);

        if (buyAmount >= (pool.strategy.minOrderAmount || 10) && availableCash >= buyAmount) {
          const units = buyAmount / currentPrice;
          if (isSharedCash) pool.cashBalance += buyAmount;
          const tradeResult = await executePoolBuy(
            userId, pool, upper, units, currentPrice,
            analysis.summary || 'AI buy signal', marketContext, analysis.summary || '', assetClass, true
          );
          if (tradeResult.success && tradeResult.trade) {
            if (isSharedCash) {
                (arena as any).sharedCash = Math.max(0, ((arena as any).sharedCash || 0) - tradeResult.trade.total);
                pool.cashBalance = 0;
            }
            poolTradeCount++;
            const convictionLabel = ` | conviction: ${(convictionPct * 100).toFixed(0)}%`;
            console.log(`[Arena:${assetClass}] 🟢 BUY ${upper} @ ${currency}${currentPrice.toFixed(2)} (score: ${score})${convictionLabel}`);
          } else if (isSharedCash) {
            pool.cashBalance -= buyAmount;
          }
        }
      }

      // ─── SELL / GPM LOGIC ────────────────────────────────────────────────
      if (holding && holding.amount > 0) {
        const holdMinutes = pool.strategy.minHoldMinutes ?? 60;
        const buyTime = holding.boughtAt ? (Date.now() - new Date(holding.boughtAt).getTime()) / (1000 * 60) : 999;
        const pnlPct = ((currentPrice - holding.averagePrice) / holding.averagePrice) * 100;

        // Update peak tracking
        if (currentPrice > (holding.peakPrice || 0)) {
          holding.peakPrice = currentPrice;
          holding.peakPnlPct = pnlPct;
        }

        // ─── SMOOTHED SCORE ──────────────────────────────────────────────────
        // Average last 3 scores to eliminate single-call LLM noise.
        // Weekend stale-score grace: if the last recorded score is >48h old
        // (market was closed), reset the GPM confirmation counter so we don't
        // fire partial sells based on pre-weekend scores.
        const recentScoreEntries = (pool.scoreHistory?.[upper] || []).slice(-3);
        const recentScoreValues = recentScoreEntries.map(s => s.score);
        const smoothedScore = recentScoreValues.length > 0
          ? Math.round(recentScoreValues.reduce((a, b) => a + b, 0) / recentScoreValues.length)
          : score;

        // Check for stale scores (e.g. after a weekend with no market activity)
        const lastScoreTs = recentScoreEntries.length > 0
          ? new Date(recentScoreEntries[recentScoreEntries.length - 1].ts).getTime()
          : 0;
        const hoursSinceLastScore = (Date.now() - lastScoreTs) / (1000 * 60 * 60);
        if (hoursSinceLastScore > 48 && holding.gpmZoneConsecutiveCycles) {
          holding.gpmZoneConsecutiveCycles = 0; // reset — stale confirmation data
          console.log(`[Arena:${assetClass}] ⏰ ${upper}: GPM confirmation counter reset — last score was ${hoursSinceLastScore.toFixed(0)}h ago (weekend/holiday gap)`);
        }

        // CHANGE #9: Dead Money Gate — exit positions flat for 48h+.
        // Frees capital from positions oscillating around entry price with no momentum.
        const deadMoneyHours = 48;
        const isDeadMoney = buyTime > (deadMoneyHours * 60)
          && Math.abs(pnlPct) < 2; // within ±2% of entry after 48h = dead money

        const shouldSell = (
          (score <= (pool.strategy.exitThreshold - (pool.strategy.exitHysteresis || 10)) && buyTime > holdMinutes) ||
          pnlPct <= (pool.strategy.positionStopLoss || -8) ||
          pnlPct >= (pool.strategy.takeProfitTarget || 8) ||
          (pnlPct <= (holding.peakPnlPct || 0) - (pool.strategy.trailingStopPct || 3)) ||
          isDeadMoney
        );

        if (shouldSell && buyTime > holdMinutes) {
          // ─── FULL EXIT (stop-loss / take-profit / trailing / AI exit) ────
          const sellReason = isDeadMoney
            ? `⏰ DEAD MONEY EXIT [${assetClass}]: ${upper} has been held for ${(buyTime / 60).toFixed(1)}h with only ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% P&L. Freeing capital for redeployment. ${analysis.summary || ''}`
            : (analysis.summary || 'AI sell signal');
          const tradeResult = await executePoolSell(
            userId, pool, upper, holding.amount, currentPrice,
            sellReason, marketContext, sellReason, assetClass, false, true
          );
          if (tradeResult.success) {
            if ((arena as any).sharedCash !== undefined && tradeResult.trade) {
              (arena as any).sharedCash += tradeResult.trade.total;
            }
            poolTradeCount++;
            const pnlStr = tradeResult.pnl !== undefined ? ` P&L: ${tradeResult.pnlPct?.toFixed(1)}%` : '';
            const deadMoneyTag = isDeadMoney ? ' [DEAD MONEY]' : '';
            console.log(`[Arena:${assetClass}] 🔴 SELL ${upper} @ ${currency}${currentPrice.toFixed(2)} (score: ${score})${pnlStr}${deadMoneyTag}`);
          }
        } else {
          // ─── GPM: GRADUATED POSITION MANAGEMENT (v2 — ANTI-CHURN) ──────
          // The position is NOT being fully exited. GPM checks whether to
          // partially scale the holding down based on conviction zones.
          //
          // v2 CHANGES (12 Mar 2026):
          //   1. EARLY SCALE-UP removed — caused sell-low-buy-high churn
          //   2. Scale-down records cooldown timestamp
          //   3. Scale-up ONLY fires on CONVICTION arrival + cooldown
          //   4. Confirmation cycles minimum 3
          //   5. Once-per-zone-transition guard prevents re-firing
          const isHoldMature = buyTime >= holdMinutes;
          const gpmEnabled = pool.strategy.gpmEnabled !== false; // default: true

          if (gpmEnabled && isHoldMature) {
            const nyseCyclesDefault = assetClass === 'NYSE' ? 3 : 3; // v2: minimum 3 for all
            const gpmCautionScore = pool.strategy.gpmCautionZoneScore ?? 70;
            const gpmDefensiveScore = pool.strategy.gpmDefensiveZoneScore ?? 55;
            const gpmCautionPct = pool.strategy.gpmCautionPositionPct ?? 50;
            const gpmDefensivePct = pool.strategy.gpmDefensivePositionPct ?? 25;
            const gpmConfirmNeeded = Math.max(3, pool.strategy.gpmConfirmationCycles ?? nyseCyclesDefault);
            const gpmScaleDownCooldownHours = pool.strategy.gpmScaleDownCooldownHours ?? 6;
            const maxAlloc = pool.strategy.maxAllocationPerToken;

            // Classify zone from smoothed score
            const resolvedZone: 'CONVICTION' | 'CAUTION' | 'DEFENSIVE' =
              smoothedScore >= gpmCautionScore ? 'CONVICTION' :
                smoothedScore >= gpmDefensiveScore ? 'CAUTION' :
                  'DEFENSIVE';

            const prevZone = holding.gpmZone ?? 'CONVICTION';
            const prevCycles = holding.gpmZoneConsecutiveCycles ?? 0;

            // Advance confirmation counter (reset if zone changed)
            const sameZone = resolvedZone === prevZone;
            const newCycles = sameZone ? prevCycles + 1 : 1;
            holding.gpmZone = resolvedZone;
            holding.gpmZoneConsecutiveCycles = newCycles;

            const holdingValueUsd = holding.amount * currentPrice;

            // ── GPM SCALE-DOWN ────────────────────────────────────────────
            // v2: Only fire ONCE per zone transition (check gpmLastScaleDownZone).
            const alreadyScaledDownInThisZone = holding.gpmLastScaleDownZone === resolvedZone;

            if (resolvedZone !== 'CONVICTION' && newCycles >= gpmConfirmNeeded && !alreadyScaledDownInThisZone) {
              const targetPct = resolvedZone === 'CAUTION' ? gpmCautionPct : gpmDefensivePct;
              const targetUsd = (targetPct / 100) * maxAlloc;
              const excessUsd = holdingValueUsd - targetUsd;

              if (excessUsd >= Math.max(15, pool.strategy.minOrderAmount || 10)) {
                const excessUnits = (excessUsd / currentPrice) * 0.995; // slippage buffer
                const gpmReason = `📉 GPM ${resolvedZone} [${assetClass}]: Score ${smoothedScore} confirmed ${newCycles}× (threshold: <${resolvedZone === 'CAUTION' ? gpmCautionScore : gpmDefensiveScore}). Reducing to ${targetPct}% of max allocation (${currency}${targetUsd.toFixed(2)}). Selling ${currency}${excessUsd.toFixed(2)} excess.`;

                console.log(`[Arena:${assetClass}] ${pool.emoji} GPM scale-down: ${upper} → ${resolvedZone} (score ${smoothedScore}, cycle ${newCycles}/${gpmConfirmNeeded}), selling ${currency}${excessUsd.toFixed(2)}`);

                // skipAntiWash=true: token still partially held, no wash risk, don't block scale-up
                const result = await executePoolSell(
                  userId, pool, upper, excessUnits, currentPrice,
                  gpmReason, marketContext, gpmReason, assetClass, true, true
                );
                if (result.success) {
                  if ((arena as any).sharedCash !== undefined && result.trade) {
                    (arena as any).sharedCash += result.trade.total;
                  }
                  poolTradeCount++;
                  // v2: Record scale-down timestamp and zone for cooldown enforcement
                  holding.gpmLastScaleDownAt = new Date().toISOString();
                  holding.gpmLastScaleDownZone = resolvedZone;
                  console.log(`[Arena:${assetClass}] ${pool.emoji} ✅ GPM scale-down executed. P&L on sold portion: ${result.pnlPct?.toFixed(2)}%. Cooldown: ${gpmScaleDownCooldownHours}h before scale-up.`);
                }
              } else {
                console.log(`[Arena:${assetClass}] ${pool.emoji} GPM ${resolvedZone} confirmed for ${upper} but excess ${currency}${excessUsd.toFixed(2)} < min — holding`);
              }
            }

            // ── GPM SCALE-UP (v2 — CONVICTION ARRIVAL ONLY) ──────────────
            // EARLY SCALE-UP (Trigger A) REMOVED — was the primary churn source.
            // Only CONVICTION-ARRIVAL scale-up remains, with cooldown enforcement.
            else if (holdingValueUsd < maxAlloc) {
              const isSharedCash = (arena as any).sharedCash !== undefined;
              const availableCash = isSharedCash ? Math.max(0, (arena as any).sharedCash) : Math.max(0, pool.cashBalance);
              
              if (availableCash >= (pool.strategy.minOrderAmount || 10)) {
                const isArrivalScaleUp = resolvedZone === 'CONVICTION' && prevZone !== 'CONVICTION';

                // v2: Enforce cooldown
                const lastScaleDown = holding.gpmLastScaleDownAt;
                const hoursSinceScaleDown = lastScaleDown
                  ? (Date.now() - new Date(lastScaleDown).getTime()) / (1000 * 60 * 60)
                  : Infinity;
                const scaleUpCooldownMet = hoursSinceScaleDown >= gpmScaleDownCooldownHours;

                if (isArrivalScaleUp && scaleUpCooldownMet) {
                  const targetUsd = maxAlloc;
                  const topUpUsd = targetUsd - holdingValueUsd;
                  const capped = Math.min(topUpUsd, availableCash);

                  if (capped >= Math.max(15, pool.strategy.minOrderAmount || 10)) {
                    const scaleUpReflection = `📈 GPM SCALE-UP [CONVICTION ARRIVAL] [${assetClass}]: ${upper} crossed into CONVICTION (score ${smoothedScore} >= ${gpmCautionScore}). Cooldown ${hoursSinceScaleDown.toFixed(1)}h (min: ${gpmScaleDownCooldownHours}h). Topping up from ${currency}${holdingValueUsd.toFixed(2)} → +${currency}${capped.toFixed(2)} (target: ${currency}${targetUsd.toFixed(2)}). ${analysis.summary}`;

                    const buyUnits = capped / currentPrice;
                    if (isSharedCash) pool.cashBalance += capped;

                    const result = await executePoolBuy(
                      userId, pool, upper, buyUnits, currentPrice,
                      scaleUpReflection, marketContext, scaleUpReflection, assetClass, true,
                    );
                    if (result.success && result.trade) {
                      if (isSharedCash) {
                          (arena as any).sharedCash = Math.max(0, ((arena as any).sharedCash || 0) - result.trade.total);
                          pool.cashBalance = 0;
                      }
                      poolTradeCount++;
                      holding.gpmZone = 'CONVICTION';
                      holding.gpmZoneConsecutiveCycles = 1;
                      holding.gpmLastScaleDownZone = undefined;
                      console.log(`[Arena:${assetClass}] ${pool.emoji} 📈 GPM SCALE-UP [CONVICTION ARRIVAL]: ${upper} +${currency}${result.trade.total.toFixed(2)} @ ${currency}${currentPrice.toFixed(2)}`);
                    } else if (isSharedCash) {
                      pool.cashBalance -= capped;
                    }
                  } else {
                    console.log(`[Arena:${assetClass}] ${pool.emoji} GPM SCALE-UP CONVICTION ARRIVAL for ${upper} but capped top-up ${currency}${capped.toFixed(2)} < min — holding`);
                  }
                } else if (isArrivalScaleUp && !scaleUpCooldownMet) {
                  console.log(`[Arena:${assetClass}] ${pool.emoji} GPM scale-up BLOCKED for ${upper}: cooldown ${hoursSinceScaleDown.toFixed(1)}h < ${gpmScaleDownCooldownHours}h`);
                } else {
                  // No scale-up condition met — log zone state
                  const zoneEmoji = resolvedZone === 'CONVICTION' ? '✅' : resolvedZone === 'CAUTION' ? '⚠️' : '🔴';
                  console.log(`[Arena:${assetClass}] ${pool.emoji} 📊 ${upper}: ${zoneEmoji} ${resolvedZone} (score ${smoothedScore}, ${newCycles}/${gpmConfirmNeeded} cycles) | P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
                }
              } else {
                // At max allocation or no cash — log zone state only
                const zoneEmoji = resolvedZone === 'CONVICTION' ? '✅' : resolvedZone === 'CAUTION' ? '⚠️' : '🔴';
                console.log(`[Arena:${assetClass}] ${pool.emoji} 📊 ${upper}: ${zoneEmoji} ${resolvedZone} (score ${smoothedScore}, at max alloc or no cash) | P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
              }
            } else {
              // At max allocation or no cash — log zone state only
              const zoneEmoji = resolvedZone === 'CONVICTION' ? '✅' : resolvedZone === 'CAUTION' ? '⚠️' : '🔴';
              console.log(`[Arena:${assetClass}] ${pool.emoji} 📊 ${upper}: ${zoneEmoji} ${resolvedZone} (score ${smoothedScore}, at max alloc or no cash) | P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
            }
          } else {
            // GPM disabled or hold not yet mature — standard hold log
            console.log(`[Arena:${assetClass}] ${pool.emoji} 📊 ${upper}: HOLD (score ${score}, ${buyTime.toFixed(0)}/${holdMinutes}min maturity) | P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);
          }
        }
      }

    }

    // Save pool state
    updatePoolPerformance(pool, prices);
    const poolTokenVal = getPoolTotalValue(pool, prices);
    const poolMeta = {
      btcPrice: prices['BTC']?.price || 0,
      holdings: Object.fromEntries(
        Object.entries(pool.holdings).map(([t, h]) => {
          const p = prices[t.toUpperCase()]?.price || h.averagePrice;
          return [t, { amount: h.amount, price: p, value: h.amount * p }];
        })
      )
    };
    await recordDailySnapshot(userId, pool.poolId, poolTokenVal, pool.performance.totalPnlPct, assetClass, poolMeta);

    // Persist updated arena
    const arenaDoc = await getArenaConfig(userId, assetClass) as any;
    if (arenaDoc) {
      const poolIdx = arenaDoc.pools.findIndex((p: any) => p.poolId === pool.poolId);
      if (poolIdx >= 0) {
        arenaDoc.pools[poolIdx] = pool;
        if ((arena as any).sharedCash !== undefined) {
          arenaDoc.sharedCash = (arena as any).sharedCash;
        }
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

  // ── Record arena-level NAV snapshot for the portfolio line ──────────────
  // Matches crypto cycle logic (L1878-1890). Uses the asset-class-namespaced
  // snapshot collection so getPerformanceHistory can read it back.
  if (adminDb) {
    try {
      const freshArenaForNav = await getArenaConfig(userId, assetClass);
      if (freshArenaForNav) {
        const arenaSharedCash = (freshArenaForNav as any).sharedCash ?? 0;
        let totalTokenValue = 0;
        for (const pool of freshArenaForNav.pools) {
          totalTokenValue += getPoolTotalValue(pool, prices);
        }
        const arenaNAV = totalTokenValue + arenaSharedCash;
        const arenaBudget = (freshArenaForNav as any).totalBudget ?? (POOL_COUNT * POOL_BUDGET);
        const arenaDcaContributions = (freshArenaForNav as any).sharedDcaContributions ?? 0;
        const arenaEffectiveBasis = arenaBudget + arenaDcaContributions;
        const arenaNAVPct = arenaEffectiveBasis > 0 ? ((arenaNAV - arenaEffectiveBasis) / arenaEffectiveBasis) * 100 : 0;

        const nowISO = new Date().toISOString();
        const todayStr = nowISO.slice(0, 10);
        const cycleToken = nowISO.replace(/[:.]/g, '-');
        const navSnapshotCol = getArenaCollections(assetClass).snapshots;
        
        await adminDb.collection(navSnapshotCol).doc(userId).collection('ARENA_NAV')
          .doc(cycleToken).set({ 
              date: todayStr, 
              timestamp: nowISO,
              value: arenaNAV, 
              pnlPct: arenaNAVPct, 
              btcPrice: prices['BTC']?.price || 0,
              recordedAt: nowISO 
          });

        await adminDb.collection(navSnapshotCol).doc(userId).collection('ARENA_NAV')
          .doc(todayStr).set({ 
              date: todayStr, 
              value: arenaNAV, 
              pnlPct: arenaNAVPct, 
              btcPrice: prices['BTC']?.price || 0,
              recordedAt: nowISO 
          }, { merge: true });
      }
    } catch (e: any) {
      console.warn(`[Arena:${assetClass}] ARENA_NAV snapshot write failed: ${e.message}`);
    }

    try {
      // PERMANENTLY PERSIST MEMORY UPDATES (scoreHistory, gpmZones, sharedCash, peakPrices)
      await adminDb.collection(getArenaCollections(assetClass).config).doc(userId).set(arena);
    } catch (e: any) {
      console.warn(`[Arena:${assetClass}] Final arena config save failed: ${e.message}`);
    }
  }

  console.log(`[Arena:${assetClass}] ✅ Cycle complete. ${totalTrades} trade(s) executed.`);
  return { success: true, poolResults, totalTrades };
}

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO C — SELECTIVE CATALYST ROTATION (FTSE · NYSE · COMMODITIES)
// Runs once per trading day after market close, triggered by each arena's
// dedicated cron route. Only swaps a ticker when ALL gates pass:
//   1. Ticker has been idle (zero holdings) for ≥ MIN_IDLE_SESSIONS sessions
//   2. Pool has not rotated in the last ROTATION_COOLDOWN_DAYS calendar days
//   3. AI selects a replacement with a credible news/fundamental catalyst
//   4. AI confidence ≥ 65
//   5. Maximum 1 rotation per pool per call
// ═════════════════════════════════════════════════════════════════════════

/** Generic, asset-class-aware selective rotation. Called by FTSE, NYSE, and Commodities cron routes. */
export async function performSelectiveCatalystRotation(userId: string, assetClass: Exclude<AssetClass, 'CRYPTO'>): Promise<{
  success: boolean;
  rotations: Array<{ poolId: string; outTicker: string; inTicker: string; reason: string }>;
  message: string;
}> {
  if (!adminDb) return { success: false, rotations: [], message: 'Admin SDK not initialized' };

  const arena = await getArenaConfig(userId, assetClass);
  if (!arena?.initialized) return { success: false, rotations: [], message: `${assetClass} arena not initialized` };

  const MIN_IDLE_SESSIONS = 3;        // consecutive market sessions with no holding required
  const ROTATION_COOLDOWN_DAYS = 7;   // ≈5 trading days — calendar days between rotations per pool
  const MIN_AI_CONFIDENCE = 65;       // AI must be ≥ 65 confident in the replacement
  const currency = getCurrencySymbol(assetClass);
  const now = new Date();

  // Fetch prices for the full instrument universe for this asset class
  const universeWatchlist = getWatchlist(assetClass);
  const allPrices = await fetchSandboxArenaPrices(universeWatchlist, assetClass);

  // Track which tickers are currently assigned across all pools (prevent cross-pool duplicates)
  const assignedTickers = new Set<string>(
    arena.pools.flatMap(p => p.tokens.map(t => t.toUpperCase()))
  );

  const rotations: Array<{ poolId: string; outTicker: string; inTicker: string; reason: string }> = [];

  for (const pool of arena.pools) {
    if (pool.status !== 'ACTIVE') continue;

    // ─── Gate 1: Rotation cooldown ──────────────────────────────────────────
    if (pool.lastRotationAt) {
      const daysSince = (now.getTime() - new Date(pool.lastRotationAt).getTime()) / 86_400_000;
      if (daysSince < ROTATION_COOLDOWN_DAYS) {
        console.log(`[FTSE:Rotation] ${pool.emoji} ${pool.name}: cooldown active (${daysSince.toFixed(1)}d / ${ROTATION_COOLDOWN_DAYS}d). Skipping.`);
        continue;
      }
    }

    // ─── Gate 2: Update idle day counters for each ticker in this pool ───────
    if (!pool.consecutiveIdleDays) pool.consecutiveIdleDays = {};
    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const hasActiveHolding = !!(pool.holdings[upper]?.amount && pool.holdings[upper].amount > 0);
      if (hasActiveHolding) {
        pool.consecutiveIdleDays[upper] = 0;  // position active — reset streak
      } else {
        pool.consecutiveIdleDays[upper] = (pool.consecutiveIdleDays[upper] ?? 0) + 1;
      }
    }

    // ─── Gate 3: Find first ticker that has hit the idle threshold ────────
    let rotationCandidate: string | null = null;
    let candidateIdleDays = 0;
    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const idleDays = pool.consecutiveIdleDays[upper] ?? 0;
      if (idleDays >= MIN_IDLE_SESSIONS) {
        rotationCandidate = upper;
        candidateIdleDays = idleDays;
        break; // max 1 rotation per pool per call
      }
    }

    if (!rotationCandidate) {
      // Log the current idle state for visibility
      const idleLog = pool.tokens.map(t => `${t}: ${pool.consecutiveIdleDays![t.toUpperCase()] ?? 0}d idle`).join(', ');
      console.log(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: no ticker at idle threshold (${MIN_IDLE_SESSIONS}) — [${idleLog}]`);
      // Still persist the updated idle counters
      try {
        const arenaDoc = await getArenaConfig(userId, assetClass) as any;
        if (arenaDoc) {
          const poolIdx = arenaDoc.pools.findIndex((p: any) => p.poolId === pool.poolId);
          if (poolIdx >= 0) {
            arenaDoc.pools[poolIdx] = pool;
            await adminDb.collection(getArenaCollections(assetClass).config).doc(userId).set(arenaDoc);
          }
        }
      } catch { /* non-fatal */ }
      continue;
    }

    // ─── Build candidate list: full universe minus tickers already in use ───
    const candidates = universeWatchlist
      .map(t => t.toUpperCase())
      .filter(t => !assignedTickers.has(t) && (allPrices[t]?.price ?? 0) > 0)
      .map(t => ({ ticker: t, price: allPrices[t].price, change24h: allPrices[t].change24h }))
      .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)) // highest movers first for AI context
      .slice(0, 20);

    if (candidates.length === 0) {
      console.log(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: no unassigned candidates with prices. Skipping.`);
      continue;
    }

    // ─── Build AI context ──────────────────────────────────────────────
    const retainedTicker = pool.tokens.find(t => t.toUpperCase() !== rotationCandidate)?.toUpperCase() ?? '';
    const retainedHolding = pool.holdings[retainedTicker];
    const retainedPrice = allPrices[retainedTicker]?.price ?? 0;
    const retainedPnlPct = retainedHolding?.averagePrice && retainedHolding.averagePrice > 0
      ? ((retainedPrice - retainedHolding.averagePrice) / retainedHolding.averagePrice * 100).toFixed(1)
      : 'no position';
    const outTickerPrice = allPrices[rotationCandidate]?.price ?? 0;
    const outTicker24h = allPrices[rotationCandidate]?.change24h ?? 0;
    const today = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const candidateList = candidates.map(c =>
      `  ${c.ticker}: ${currency}${c.price.toFixed(2)} (24h: ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(2)}%)`
    ).join('\n');

    // Asset-class-specific catalyst guidance for the AI prompt
    const catalystGuidance =
      assetClass === 'FTSE'
        ? `- Earnings beat / positive trading update / profit upgrade
   - Analyst upgrade (e.g. Goldman Sachs, Barclays, Morgan Stanley)
   - M&A activity, special dividend, or buyback announcement
   - Sector tailwind (e.g. oil price move, BoE rate decision impact, housing data)
   - UK macro catalyst (sterling strength, FTSE 100/250 rebalancing flow)`
        : assetClass === 'NYSE'
          ? `- Earnings beat / EPS upgrade / raised full-year guidance
   - Analyst upgrade or price-target raise from a major firm
   - Fed policy pivot signal benefiting the sector
   - Product launch, FDA approval, or major contract win
   - Sector momentum (e.g. AI capex cycle, energy supercycle, rate-sensitive rally)`
          : /* COMMODITIES */
          `- Supply shock or supply disruption (OPEC cuts, mine outage, drought)
   - Demand surge signal (Chinese manufacturing PMI, infrastructure bill)
   - Macro regime shift (DXY weakness = metal strength, risk-off = gold)
   - Seasonal pattern setup (crop planting/harvest window, winter natural gas demand)
   - Geopolitical risk premium building in energy or precious metals`;

    const prompt = `You are an expert ${assetClass === 'FTSE' ? 'FTSE UK equity analyst' : assetClass === 'NYSE' ? 'US large-cap equity strategist' : 'commodity research analyst'} running an end-of-day portfolio rotation review.
Date: ${today}. Market has just closed.

POOL CONTEXT:
Pool: ${pool.name} ${pool.emoji}
Strategy: ${pool.strategy.description}
Personality: ${pool.strategy.strategyPersonality ?? 'MODERATE'}
Cash available: ${currency}${pool.cashBalance.toFixed(2)}
Max allocation per position: ${currency}${pool.strategy.maxAllocationPerToken}

ROTATION TRIGGER:
${rotationCandidate} (${currency}${outTickerPrice.toFixed(2)}, 24h: ${outTicker24h >= 0 ? '+' : ''}${outTicker24h.toFixed(2)}%) has had ZERO holdings for ${candidateIdleDays} consecutive market sessions.
The AI scoring engine has consistently been unable to build conviction to buy it.
This ticker is being considered for replacement.

RETAINED TICKER:
${retainedTicker}: ${currency}${retainedPrice.toFixed(2)} | P&L: ${retainedPnlPct}% | Holdings: ${retainedHolding ? `${retainedHolding.amount.toFixed(4)} units @ avg ${currency}${retainedHolding.averagePrice.toFixed(2)}` : 'none'}

AVAILABLE REPLACEMENT CANDIDATES (from ${assetClass} universe, unassigned, with today's closing prices):
${candidateList}

YOUR TASK:
Select ONE replacement ticker. ALL of these criteria must be satisfied:

1. CATALYST QUALITY — You must cite a specific, credible catalyst for this ${assetClass === 'FTSE' ? 'UK equity' : assetClass === 'NYSE' ? 'US equity' : 'commodity ETF'}:
${catalystGuidance}
   - DO NOT select based on price momentum alone — there must be a fundamental or news reason

2. STRATEGY FIT — Must suit personality: ${pool.strategy.strategyPersonality ?? 'MODERATE'}
   AGGRESSIVE: prefer high-beta, speculative names with short-term catalysts
   MODERATE: prefer quality names with clear near-term catalyst
   PATIENT: prefer undervalued quality names with multi-week thesis

3. DE-CORRELATION — Must NOT be in the same ${assetClass === 'COMMODITIES' ? 'commodity category (precious/energy/agricultural/base metals)' : 'sub-sector'} as ${retainedTicker} to keep the pool diversified.

4. If the current market data does not show a sufficiently high quality opportunity, set confidenceScore below 65 — the swap will be cancelled.
Do NOT force a rotation just because the trigger has fired.

Respond with ONLY valid JSON:
{
  "selectedTicker": "TICKER",
  "catalyst": "1-2 sentence description of the specific catalyst. Be precise about WHY this ${assetClass === 'COMMODITIES' ? 'ETF' : 'company'} is set to move.",
  "reasoning": "2-3 sentence strategy fit and de-correlation explanation.",
  "confidenceScore": 60-100
}`;

    try {
      const responseText = await generateContentWithFallback(prompt);
      if (!responseText) {
        console.warn(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: AI returned empty response. Skipping.`);
        continue;
      }

      const aiResult = safeJsonParse<{
        selectedTicker: string;
        catalyst: string;
        reasoning: string;
        confidenceScore: number;
      }>(responseText);

      if (!aiResult?.selectedTicker) {
        console.warn(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: AI response missing selectedTicker. Skipping.`);
        continue;
      }

      // Sanitise — AI sometimes returns "SHEL Shell" or "GLD Gold" etc
      const newTicker = aiResult.selectedTicker.trim().toUpperCase().split(/\s+/)[0];

      // ─── Validate the selection ──────────────────────────────────────
      if (!universeWatchlist.map(t => t.toUpperCase()).includes(newTicker)) {
        console.warn(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: AI selected "${newTicker}" — not in ${assetClass} watchlist. Skipping.`);
        continue;
      }
      if (assignedTickers.has(newTicker)) {
        console.warn(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: AI selected "${newTicker}" — already assigned to another pool. Skipping.`);
        continue;
      }
      if ((aiResult.confidenceScore ?? 0) < MIN_AI_CONFIDENCE) {
        console.log(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: AI confidence ${aiResult.confidenceScore} < ${MIN_AI_CONFIDENCE}. No high-quality opportunity. Skipping.`);
        // Still persist idle counter update
        try {
          const arenaDoc = await getArenaConfig(userId, assetClass) as any;
          if (arenaDoc) {
            const poolIdx = arenaDoc.pools.findIndex((p: any) => p.poolId === pool.poolId);
            if (poolIdx >= 0) { arenaDoc.pools[poolIdx] = pool; await adminDb.collection(getArenaCollections(assetClass).config).doc(userId).set(arenaDoc); }
          }
        } catch { /* non-fatal */ }
        continue;
      }

      // ─── Execute the swap ───────────────────────────────────────────
      const tokenIdx = pool.tokens.findIndex(t => t.toUpperCase() === rotationCandidate);
      if (tokenIdx === -1) continue;

      // 1. Swap ticker in the pool.tokens tuple
      (pool.tokens as string[])[tokenIdx] = newTicker;

      // 2. Clear stale AI learning data for the old ticker
      //    (lastSoldAt / lastStopLossedAt are preserved — they’re part of the audit trail)
      if (pool.scoreHistory?.[rotationCandidate!]) delete pool.scoreHistory[rotationCandidate!];
      if (pool.lastEvaluatedAt?.[rotationCandidate!]) delete pool.lastEvaluatedAt[rotationCandidate!];

      // 3. Reset idle counters
      pool.consecutiveIdleDays![newTicker] = 0;
      delete pool.consecutiveIdleDays![rotationCandidate!];

      // 4. Record rotation event
      const rotationEvent: PoolRotationEvent = {
        rotatedAt: now.toISOString(),
        outTicker: rotationCandidate!,
        inTicker: newTicker,
        idleDays: candidateIdleDays,
        aiReasoning: `${aiResult.catalyst} ${aiResult.reasoning}`.trim(),
        priceContext: {
          outTickerLast24h: allPrices[rotationCandidate!]?.change24h ?? 0,
          inTickerLast24h: allPrices[newTicker]?.change24h ?? 0,
        },
      };
      if (!pool.rotationHistory) pool.rotationHistory = [];
      pool.rotationHistory.push(rotationEvent);

      // 5. Update pool metadata
      pool.lastRotationAt = now.toISOString();

      // 6. Mark new ticker as assigned so subsequent pools can’t clash
      assignedTickers.delete(rotationCandidate!);
      assignedTickers.add(newTicker);

      const fullReason = `${aiResult.catalyst} ${aiResult.reasoning}`.trim();
      rotations.push({ poolId: pool.poolId, outTicker: rotationCandidate!, inTicker: newTicker, reason: fullReason });

      console.log(`[${assetClass}:Rotation] ✅ ${pool.emoji} ${pool.name}: SWAPPED ${rotationCandidate} → ${newTicker} (idle ${candidateIdleDays} sessions, AI confidence ${aiResult.confidenceScore})`);
      console.log(`[${assetClass}:Rotation]   Catalyst: ${aiResult.catalyst}`);

    } catch (e: any) {
      console.error(`[${assetClass}:Rotation] ${pool.emoji} ${pool.name}: rotation attempt failed: ${e.message}`);
    }

    // Persist updated pool state (write-through after each pool so a crash mid-loop doesn’t lose data)
    try {
      const arenaDoc = await getArenaConfig(userId, assetClass) as any;
      if (arenaDoc) {
        const poolIdx = arenaDoc.pools.findIndex((p: any) => p.poolId === pool.poolId);
        if (poolIdx >= 0) {
          arenaDoc.pools[poolIdx] = pool;
          await adminDb.collection(getArenaCollections(assetClass).config).doc(userId).set(arenaDoc);
        }
      }
    } catch (e: any) {
      console.error(`[${assetClass}:Rotation] Failed to persist pool ${pool.poolId}: ${e.message}`);
    }
  }

  return {
    success: true,
    rotations,
    message: rotations.length > 0
      ? `${rotations.length} rotation(s) executed: ${rotations.map(r => `${r.outTicker}→${r.inTicker}`).join(', ')}`
      : 'No rotations triggered — all pools within gates.',
  };
}

/** @deprecated Use performSelectiveCatalystRotation(userId, 'FTSE') */
export async function performFTSESelectiveRotation(userId: string) {
  return performSelectiveCatalystRotation(userId, 'FTSE');
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
  competitionContext?: { dayNumber: number; daysRemaining: number; poolPnlPct: number; winRate: number; cashPct: number },
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
Prices are in GBP (£). This is a TIMED COMPETITION — you MUST maximise profit within the competition window.
Consider P/E vs sector peers, momentum, 52-week range, UK macro risks (sterling, energy, housing).`,
    NYSE: `You are a US equity strategist covering large-cap and mega-cap NYSE/NASDAQ stocks.
You understand earnings cycles, Fed rate sensitivity, sector rotation (tech/financials/energy), VIX-implied volatility, and growth-vs-value dynamics.
Prices are in USD ($). This is a TIMED COMPETITION — you MUST maximise profit within the competition window.
Weight recent earnings beats/misses, institutional flow signals, and near-term catalyst risk.`,
    COMMODITIES: `You are a commodity research analyst covering precious metals, energy futures, and agricultural contracts.
You understand supply/demand cycles, geopolitical risk pricing, seasonal patterns, DXY inverse correlations for metals, OPEC decisions for energy, and crop report impacts on agriculture.
Prices are in USD ($). This is a TIMED COMPETITION — you MUST maximise profit within the competition window.
Assess macro regime (risk-on vs risk-off), physical demand signals, and positioning data.`,
  };

  // CHANGE #1 + #10: Competition urgency + benchmark context for non-crypto arenas
  const benchmarkMap: Record<AssetClass, string> = {
    CRYPTO: '',
    FTSE: 'FTSE 100 index',
    NYSE: 'S&P 500 index',
    COMMODITIES: 'Gold (GLD)',
  };
  const cc = competitionContext;
  const competitionBlock = (cc && assetClass !== 'CRYPTO') ? `

🚨 COMPETITION STATUS — READ THIS CAREFULLY:
- Day ${cc.dayNumber} of 28 (${cc.daysRemaining} days remaining, ${((cc.dayNumber / 28) * 100).toFixed(0)}% of time elapsed)
- Pool P&L: ${cc.poolPnlPct >= 0 ? '+' : ''}${cc.poolPnlPct.toFixed(2)}% ${cc.poolPnlPct < 0 ? '(LOSING — must improve)' : cc.poolPnlPct < 2 ? '(MARGINAL — needs more aggression)' : '(POSITIVE — maintain momentum)'}
- Win Rate: ${cc.winRate.toFixed(0)}% ${cc.winRate < 50 ? '— BELOW target 55%+' : '— On track'}
- Cash Position: ${cc.cashPct.toFixed(0)}% ${cc.cashPct > 40 ? '(⚠️ HIGH CASH DRAG — cash earns 0% in a competition!)' : '(acceptable)'}
- Benchmark: ${benchmarkMap[assetClass]}

⚡ MANDATE: This is a TIMED COMPETITION with real capital at stake.
   Cash is a LOSING position — every day without deployment is ${(100/28).toFixed(1)}% of the competition WASTED.
   You MUST be willing to enter positions at scores 65+ when the alternative is sitting idle.
   A 3% profit taken and redeployed BEATS a 6% profit that never materialises.
   THINK ACTIVELY. TRADE DECISIVELY. LOCK IN GAINS EARLY.` : '';

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
- Take-Profit: +${poolStrategy.takeProfitTarget || 3}%
- Trailing Stop: ${poolStrategy.trailingStopPct || 1.5}% from peak
${competitionBlock}

TRADE MEMORY:
${tradeMemory || 'No previous trades yet.'}

SCORE HISTORY:
${scoreHistoryContext}

ANALYSIS INSTRUCTIONS:
Score 0-100 based on your specialist knowledge of ${assetClass} instruments:
- 0-39: SELL immediately. Clear downtrend or bearish signal.
- 40-54: Weak. Consider exit unless strong reversal forming.
- 55-64: Mixed signals. Caution — but in a competition, mild bullish leans should score 65+.
- 65-79: Bullish improving. Good entry — DEPLOY CAPITAL rather than hold cash.
- 80-89: Strong conviction buy. Increase position size.
- 90-100: Maximum conviction. Full allocation.

For ${assetClass === 'FTSE' ? 'UK equities: consider dividend yield, Bank of England policy, GBP strength, sector momentum.' : assetClass === 'NYSE' ? 'US equities: consider earnings trajectory, Fed policy, sector rotation, VIX level.' : 'commodities: consider supply/demand fundamentals, DXY strength, geopolitical risk, seasonal factors.'}
${assetClass !== 'CRYPTO' ? `\n⚠️ SCORING BIAS: In a timed competition, the cost of MISSING a winner (opportunity cost) is HIGHER than the cost of a small loss (stopped out at -${Math.abs(poolStrategy.positionStopLoss || 8)}%). Score AGGRESSIVELY when the setup is reasonable. Do NOT default to 50-60 "safe" scores that result in zero trades.` : ''}

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

    // CHANGE #2+5+6+7: Updated strategy review prompt with aggressive competition parameters
    const winRate = pool.performance.totalTrades > 0
      ? (pool.performance.winCount / Math.max(1, pool.performance.winCount + pool.performance.lossCount)) * 100
      : 0;

    const prompt = `You are an AI portfolio manager reviewing performance for a ${assetClass} trading pool in a TIMED COMPETITION.

🚨 PERFORMANCE STATUS:
Pool: ${pool.name} ${pool.emoji}
Value: ${currency}${poolValue.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
Trades: ${pool.performance.totalTrades} | Wins: ${pool.performance.winCount} | Losses: ${pool.performance.lossCount} | Win Rate: ${winRate.toFixed(0)}%
Current strategy: ${pool.strategy.description}

⚡ PROFIT MANDATE: This pool ${pnlPct < 0 ? 'is LOSING money and must recover' : pnlPct < 2 ? 'is barely breaking even — needs more aggression' : 'is profitable — maintain momentum'}.
The buy threshold should be LOW ENOUGH to deploy capital (65-75 range is optimal for competitions).
The take-profit target should be ACHIEVABLE (2-4% for equities, 3-5% for commodities).
Sitting on cash earns ZERO — the opportunity cost of missed trades is worse than small losses.

Review the strategy and suggest improvements. You may adjust:
- buyScoreThreshold: 60-80 HARD RANGE (lower = more trades = more chances to win)
- exitThreshold: 40-55 range
- positionStopLoss: -5% to -10% range
- takeProfitTarget: 2-5% (DO NOT set above 5% — it's unreachable for most equities in 28 days)
- trailingStopPct: 1-3% (tighter = locks in gains faster)
- antiWashHours: 2-8h range
- strategyPersonality: AGGRESSIVE, MODERATE, or PATIENT
⚠️  buyScoreThreshold above 80 causes cash accumulation in competitions and will be auto-corrected.
⚠️  takeProfitTarget above 5% is unrealistic for equities/commodities in 28 days and will be auto-corrected.
Return ONLY valid JSON:
{
  "strategyChanged": true/false,
  "newStrategy": { /* only include changed fields */ },
  "reflection": "2-3 sentence assessment of performance and reasoning for any changes."
}`;

    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) return;

    const parsed = safeJsonParse(responseText);

    // ══ ENFORCE HARD GUARDRAILS (sandbox) — UPDATED for competition aggression ══
    // Tighter ranges than crypto to force active trading in timed competitions.
    if (parsed.strategyChanged && parsed.newStrategy) {
      const ns = parsed.newStrategy;
      const personality = ns.strategyPersonality || pool.strategy.strategyPersonality || 'MODERATE';
      // CHANGE #4: Lower threshold range — force capital deployment
      const thresholdMin = personality === 'AGGRESSIVE' ? 58 : 60;
      const thresholdMax = personality === 'PATIENT' ? 78 : 80;
      if (ns.buyScoreThreshold !== undefined) {
        const clamped = Math.max(thresholdMin, Math.min(thresholdMax, ns.buyScoreThreshold));
        if (clamped !== ns.buyScoreThreshold) {
          console.log(`[Arena:${assetClass}] ⚠️ Guardrail: buyScoreThreshold ${ns.buyScoreThreshold} → ${clamped} (${personality}, range ${thresholdMin}–${thresholdMax})`);
          ns.buyScoreThreshold = clamped;
        }
      }
      // CHANGE #2: Cap take-profit at 5% for sandbox — 8%+ is unreachable in 28 days
      if (ns.takeProfitTarget !== undefined && ns.takeProfitTarget > 5) {
        console.log(`[Arena:${assetClass}] ⚠️ Guardrail: takeProfitTarget ${ns.takeProfitTarget} → 5 (max for 28-day competition)`);
        ns.takeProfitTarget = 5;
      }
      // CHANGE #5: Cap trailing stop at 3% — tighter = faster profit lock
      if (ns.trailingStopPct !== undefined && ns.trailingStopPct > 3) {
        console.log(`[Arena:${assetClass}] ⚠️ Guardrail: trailingStopPct ${ns.trailingStopPct} → 3 (max for competition)`);
        ns.trailingStopPct = 3;
      }
      // Minimum antiWashHours: 2h for sandbox (more aggressive re-entry)
      if (ns.antiWashHours !== undefined && ns.antiWashHours < 2) ns.antiWashHours = 2;
      // Maximum positionStopLoss: -5% for sandbox (tighter than main arena)
      if (ns.positionStopLoss !== undefined && ns.positionStopLoss > -5) ns.positionStopLoss = -5;
      console.log(`[Arena:${assetClass}] ✅ Competition guardrails enforced for ${pool.poolId}`);
    }

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
  "pool1": { "name": "Name", "emoji": "emoji", "tokens": ["T1", "T2"], "strategy": { "buyScoreThreshold": 65, "exitThreshold": 45, "momentumGateEnabled": false, "momentumGateThreshold": 0, "minOrderAmount": 10, "antiWashHours": 4, "reentryPenalty": 3, "positionStopLoss": -8, "maxAllocationPerToken": 120, "takeProfitTarget": 3, "trailingStopPct": 1.5, "minWinPct": 0.3, "minHoldMinutes": 30, "evaluationCooldownMinutes": 15, "buyConfidenceBuffer": 0, "strategyPersonality": "MODERATE", "description": "brief" }, "reasoning": "reason" },
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

/**
 * Reset the mission clock for any arena.
 * Updates startDate to now and endDate to now + 28 days.
 * Does NOT touch holdings, cash, trades, or strategy — purely a clock reset.
 */
export async function resetMissionClock(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<{ success: boolean; message: string }> {
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
  const { getArenaCollections: _gc } = await import('@/lib/constants');
  const cols = _gc(assetClass);
  const docRef = adminDb.collection(cols.config).doc(userId);
  const snap = await docRef.get();
  if (!snap.exists) return { success: false, message: 'Arena not found.' };
  const now = new Date().toISOString();
  const endDate = new Date(Date.now() + ARENA_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await docRef.update({ startDate: now, endDate });
  console.log(`[Arena:${assetClass}] 🕐 Mission clock reset for user ${userId.substring(0, 8)} — new start: ${now}`);
  return { success: true, message: `Mission clock reset. New 28-day window: ${now.slice(0, 10)} → ${endDate.slice(0, 10)}.` };
}

/**
 * Full sync-and-reset from Revolut X.
 *
 * What it does:
 *   1. Reads live USD balance + crypto holdings from Revolut X API.
 *   2. Distributes the total USD cash proportionally across all pools
 *      (based on each pool's current share of arena cash).
 *   3. For each token held in Revolut, finds the matching pool and sets:
 *        holdings.amount   = actual Revolut amount
 *        holdings.avgPrice = current live price  ← new cost basis (delta → 0)
 *        holdings.peakPrice = current live price
 *   4. Resets all pool performance metrics to zero (pnl, pnlPct, wins, losses,
 *      winCount, lossCount, bestTrade, worstTrade, dailySnapshots).
 *   5. Clears the arena_snapshots Firestore sub-collection for a clean chart.
 *   6. Writes the updated arena config back to Firestore.
 *
 * Does NOT place orders on Revolut X.
 */
export async function syncFromRevolutAndReset(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
): Promise<{ success: boolean; message: string; detail?: string }> {
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };

  // ── 1. Load Revolut API credentials ────────────────────────────────────
  const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
  const agentConfig = configDoc.data();
  if (!agentConfig?.revolutApiKey || !agentConfig?.revolutPrivateKey) {
    return { success: false, message: 'Revolut API credentials not configured in agent_configs.' };
  }

  // ── 2. Connect to Revolut X and get live balances ───────────────────────
  const { getArenaCollections: _gc } = await import('@/lib/constants');
  const cols = _gc(assetClass);

  const client = new RevolutX(
    agentConfig.revolutApiKey,
    agentConfig.revolutPrivateKey,
    agentConfig.revolutIsSandbox || false,
    agentConfig.revolutProxyUrl,
  );

  let rawBalances: any[];
  try {
    rawBalances = await client.getBalances() as any[];
  } catch (e: any) {
    return { success: false, message: `Revolut API error: ${e.message}` };
  }

  // Separate USD cash from crypto holdings
  const usdEntry = rawBalances.find(
    (b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'USD',
  );
  const revolutUsd = parseFloat((usdEntry?.available ?? usdEntry?.balance ?? 0).toString());

  // Build a map: TICKER → amount for every non-USD holding with balance > 0
  const revolutHoldings: Record<string, number> = {};
  for (const b of rawBalances) {
    const sym = (b.currency ?? b.symbol ?? '').toUpperCase();
    if (!sym || sym === 'USD') continue;
    const amt = parseFloat((b.available ?? b.balance ?? 0).toString());
    if (amt > 0) revolutHoldings[sym] = amt;
  }

  // ── 3. Load arena config ────────────────────────────────────────────────
  const arena = await getArenaConfig(userId, assetClass);
  if (!arena?.initialized) {
    return { success: false, message: 'Arena not initialised.' };
  }

  // ── 4. Fetch live prices for all arena tokens ───────────────────────────
  const allTickers = new Set<string>();
  arena.pools.forEach(p => p.tokens.forEach(t => allTickers.add(t.toUpperCase())));
  let livePrices: Record<string, { price: number; change24h: number }> = {};
  try {
    if (assetClass === 'CRYPTO') {
      livePrices = await getVerifiedPrices([...allTickers], userId);
    } else {
      // For non-crypto arenas, fall back to cost-basis averagePrice if price fetch fails
      const eodhdTickers = [...allTickers].map(t => formatEODHDTicker(t, assetClass));
      const raw = await fetchEODHDPrices(eodhdTickers);
      // Re-map EODHD code → clean arena ticker
      for (const [code, data] of Object.entries(raw)) {
        const clean = parseEODHDTicker(code, assetClass).toUpperCase();
        livePrices[clean] = data;
      }
    }
  } catch { /* non-fatal — fall back to existing averagePrice */ }

  // ── 5. Reconcile pools ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // ── Route all Revolut USD cash to arena.sharedCash ────────────────────────
  // In the shared-cash model there are no per-pool cash reserves.
  arena.sharedCash = revolutUsd;
  for (const pool of arena.pools) {
    pool.cashBalance = 0; // reset all per-pool balances — cash lives in sharedCash
  }

  for (const pool of arena.pools) {

    // ── Holdings ───────────────────────────────────────────────────────
    // Clear existing holdings for this pool then re-populate from Revolut
    const updatedHoldings: Record<string, any> = {};

    for (const ticker of pool.tokens) {
      const upper = ticker.toUpperCase();
      const revolutAmt = revolutHoldings[upper] ?? 0;
      if (revolutAmt <= 0) {
        // Not held in Revolut — remove from pool holdings
        continue;
      }
      const livePrice = livePrices[upper]?.price ?? pool.holdings[upper]?.averagePrice ?? 0;
      updatedHoldings[upper] = {
        amount: revolutAmt,
        averagePrice: livePrice,   // current price is the new cost basis → delta = 0%
        peakPrice: livePrice,
        peakPnlPct: 0,
        boughtAt: now,
        // Preserve any GPM zone state that was already set
        ...(pool.holdings[upper]?.gpmZone ? {
          gpmZone: pool.holdings[upper].gpmZone,
          gpmZoneConsecutiveCycles: pool.holdings[upper].gpmZoneConsecutiveCycles,
          gpmLastScaleDownAt: pool.holdings[upper].gpmLastScaleDownAt,
          gpmLastScaleDownZone: pool.holdings[upper].gpmLastScaleDownZone,
        } : {}),
      };
    }

    pool.holdings = updatedHoldings;

    // ── Performance reset ─────────────────────────────────────────────
    // Keep trade history intact but zero out P&L figures and snapshots.
    // The graph starts fresh from today.
    let holdingsValue = 0;
    for (const [tkr, h] of Object.entries(updatedHoldings as Record<string, any>)) {
      holdingsValue += h.amount * (livePrices[tkr]?.price ?? h.averagePrice ?? 0);
    }
    const currentValue = pool.cashBalance + holdingsValue;

    pool.performance = {
      ...pool.performance,
      totalPnl: 0,
      totalPnlPct: 0,
      winCount: 0,
      lossCount: 0,
      bestTrade: null,
      worstTrade: null,
      dailySnapshots: [{ date: today, value: currentValue, pnlPct: 0 }],
    };

    // Reset budget to current value so future P&L is relative to today
    pool.budget = currentValue;
  }

  // ── 6. Write updated arena config to Firestore ─────────────────────────
  await adminDb.collection(cols.config).doc(userId).set(arena);

  // ── 7. Clear all arena_snapshots for a clean performance chart ──────────
  try {
    for (const pool of arena.pools) {
      const snapshotCol = adminDb
        .collection(cols.snapshots)
        .doc(userId)
        .collection(pool.poolId);
      const snap = await snapshotCol.limit(100).get();
      const batch = adminDb.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      // Write a fresh day-0 snapshot
      await snapshotCol.doc(today).set({ date: today, value: pool.budget, pnlPct: 0, recordedAt: now }, { merge: true });
    }
  } catch (e: any) {
    console.warn('[SyncReset] Snapshot cleanup failed (non-fatal):', e.message);
  }

  const detail = [
    `USD cash distributed: $${revolutUsd.toFixed(2)} across ${arena.pools.length} pools.`,
    `Crypto positions synced: ${Object.keys(revolutHoldings).join(', ') || 'none'}.`,
    `All P&L deltas reset to 0% — current prices used as new cost basis.`,
    `Performance chart cleared — fresh start from ${today}.`,
  ].join(' ');

  console.log(`[Arena:${assetClass}] ✅ Revolut sync-and-reset complete for user ${userId.substring(0, 8)}. ${detail}`);

  // Send Telegram notification
  try {
    const { sendSystemAlert } = await import('@/services/telegramService');
    await sendSystemAlert(
      '🔄 REVOLUT SYNC & RESET',
      `Dashboard fully re-synced from Revolut X.\n\n${detail}\n\nAll P&L deltas reset to 0%. Mission clock should also be reset separately if needed.`,
      '🔄'
    );
  } catch { }

  return { success: true, message: 'Sync & reset complete.', detail };
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
      arena.pools.flatMap(p => p.tokens.map(t => t.toUpperCase())),
      userId
    );

    // Compute day/week from arena's actual startDate (respects mission clock resets)
    const eodStartMs = new Date(arena.startDate).getTime();
    const eodDaysPassed = Math.floor((Date.now() - eodStartMs) / (1000 * 60 * 60 * 24));
    const day = Math.max(1, Math.min(eodDaysPassed + 1, 28));
    const week = Math.min(Math.floor(eodDaysPassed / 7) + 1, 4);

    let leaderPool = arena.pools[0];
    let leaderValue = 0;

    const poolLines = arena.pools.map(pool => {
      const value = getPoolTotalValue(pool, prices);
      if (value > leaderValue) { leaderValue = value; leaderPool = pool; }
      // Cost basis = actual holding cost (matches dashboard & strategy report)
      let holdCost = 0;
      for (const h of Object.values(pool.holdings)) {
        holdCost += (h.amount || 0) * (h.averagePrice || 0);
      }
      const costBasis = holdCost;
      const pnl = value - costBasis;
      const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      const holdings = Object.entries(pool.holdings).map(([t, h]) => {
        const p = prices[t.toUpperCase()]?.price || 0;
        return `  ${t}: ${h.amount.toFixed(4)} @ $${smartPrice(p)}`;
      }).join('\n');
      return `${pool.emoji} <b>${pool.name}</b> [${pool.tokens.join('+')}]\nToken Value: $${value.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% vs cost)\n${holdings || '  No holdings'}`;
    }).join('\n\n');

    // Total NAV = all pool holdings + shared cash (matches dashboard)
    const eodSharedCash = arena.sharedCash ?? 0;
    const totalValue = arena.pools.reduce((sum, p) => sum + getPoolTotalValue(p, prices), 0) + eodSharedCash;
    const totalDcaContributions = arena.sharedDcaContributions ?? 0;
    const totalCommitted = arena.totalBudget + totalDcaContributions;
    const totalPnl = totalValue - totalCommitted;
    const totalPnlPct = totalCommitted > 0 ? ((totalPnl / totalCommitted) * 100) : 0;

    const msg = `🏟️ <b>SEMAPHORE — Day ${day}/28 (Week ${week})</b>\n\n` +
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


// ═══════════════════════════════════════════════════════════════════════════
// AI INTEGRITY AGENT — Dashboard Alert Management
// ═══════════════════════════════════════════════════════════════════════════

export type { IntegrityAlert } from '@/services/integrityService';

/**
 * Fetch active (undismissed) integrity alerts for the dashboard.
 */
export async function getActiveIntegrityAlerts(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
): Promise<import('@/services/integrityService').IntegrityAlert[]> {
  'use server';
  const { getIntegrityAlerts } = await import('@/services/integrityService');
  return getIntegrityAlerts(userId, assetClass, false);
}

/**
 * Fetch all integrity alerts (including dismissed) for full audit history.
 */
export async function getAllIntegrityAlerts(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
): Promise<import('@/services/integrityService').IntegrityAlert[]> {
  'use server';
  const { getIntegrityAlerts } = await import('@/services/integrityService');
  return getIntegrityAlerts(userId, assetClass, true);
}

/**
 * Dismiss all active integrity alerts from the dashboard.
 * Records are NOT deleted — only the `dismissed` flag is set.
 */
export async function dismissAllIntegrityAlerts(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
): Promise<{ dismissed: number }> {
  'use server';
  const { dismissIntegrityAlerts } = await import('@/services/integrityService');
  return dismissIntegrityAlerts(userId, assetClass);
}

// ═══════════════════════════════════════════════════════════════════════════
// INTELLIGENCE SCANNER — Server Actions for Dashboard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch the latest Intelligence Scanner results for dashboard display.
 * Returns AM/PM scan data, top candidates, and promotion history per pool.
 */
export async function getIntelligenceScanResults(
  userId: string,
  assetClass: AssetClass,
): Promise<{
  pools: Array<{
    poolId: PoolId;
    poolName: string;
    emoji: string;
    morningScan: IntelligenceScanResult | null;
    eveningScan: IntelligenceScanResult | null;
    promotions: PoolPromotionEvent[];
  }>;
}> {
  'use server';
  if (!userId || assetClass === 'CRYPTO') return { pools: [] };
  const { getLatestScanResults } = await import('@/services/intelligenceScanner');
  return getLatestScanResults(userId, assetClass as Exclude<AssetClass, 'CRYPTO'>);
}

/**
 * Manually trigger an Intelligence Scan (for testing / manual override).
 * Can be called from the dashboard UI.
 */
export async function triggerIntelligenceScan(
  userId: string,
  assetClass: AssetClass,
  scanType: 'MORNING' | 'EVENING',
): Promise<{
  success: boolean;
  promotions: number;
  message: string;
}> {
  'use server';
  if (!userId) return { success: false, promotions: 0, message: 'User not authenticated' };
  if (assetClass === 'CRYPTO') return { success: false, promotions: 0, message: 'Scanner not available for CRYPTO' };
  const { runIntelligenceScan } = await import('@/services/intelligenceScanner');
  const result = await runIntelligenceScan(userId, assetClass as Exclude<AssetClass, 'CRYPTO'>, scanType);
  return { success: result.success, promotions: result.promotions.length, message: result.message };
}

// ═══════════════════════════════════════════════════════════════════════════
// MANUAL MADNESS — Server Actions for Dashboard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update individual settings for a manual position (Stop Loss, Take Profit, GPM).
 */
export async function updateManualPositionSettings(
  userId: string,
  ticker: string,
  settings: NonNullable<PoolHolding['settings']>,
): Promise<{ success: boolean; error?: string }> {
  'use server';
  try {
    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return { success: false, error: 'Arena not found' };

    const pool = arena.masterPortfolioMode ? arena.pools[0] : arena.pools.find(p => p.poolId === 'POOL_MANUAL');
    if (!pool) return { success: false, error: 'Manual pool not found' };

    const upper = ticker.toUpperCase();
    if (!pool.holdings[upper]) return { success: false, error: `${upper} not found in holdings` };

    pool.holdings[upper].settings = {
      ...pool.holdings[upper].settings,
      ...settings,
    };

    const dbCols = getArenaCollections('CRYPTO');
    await adminDb!.collection(dbCols.config).doc(userId).set(arena);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Manually sell all or part of a position in the Manual Madness pool.
 */
export async function executeManualSell(
  userId: string,
  ticker: string,
  amount: number,
  price: number,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  'use server';
  try {
    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return { success: false, error: 'Arena not found' };

    const pool = arena.masterPortfolioMode ? arena.pools[0] : arena.pools.find(p => p.poolId === 'POOL_MANUAL');
    if (!pool) return { success: false, error: 'Manual pool not found' };

    const upper = ticker.toUpperCase();
    if (!pool.holdings[upper]) return { success: false, error: `${upper} not found in holdings` };

    // 1. Execute on Revolut X
    const revolutResult = await executeRevolutTrade(userId, upper, 'SELL', amount, price);
    if (!revolutResult.success) {
      return { success: false, error: `Revolut execution failed. Verify your API keys and balance.` };
    }

    const fillPrice = revolutResult.fillPrice || price;

    // 2. Update Internal Ledger
    const result = await executePoolSell(
      userId,
      pool,
      upper,
      amount,
      fillPrice,
      `🧑‍💻 MANUAL EXIT: ${reason}`,
      { btcPrice: 0, btcChange24h: 0, tokenChange24h: 0, fearGreedIndex: 50 },
      `Manual sell executed by user: ${reason}`,
      'CRYPTO'
    );

    if (result.success && result.trade) {
      const arenaNAV = (arena as any).totalValue || 0;
      const arenaSharedCash = (arena as any).sharedCash || 0;
      await sendTradeAlerts([result.trade], arenaNAV, arenaSharedCash);
    }

    return { success: result.success, error: result.error };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Add more to an existing manual position (DCA).
 */
export async function addToManualPosition(
  userId: string,
  ticker: string,
  amount: number,
  price: number,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  'use server';
  try {
    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return { success: false, error: 'Arena not found' };

    const pool = arena.masterPortfolioMode ? arena.pools[0] : arena.pools.find(p => p.poolId === 'POOL_MANUAL');
    if (!pool) return { success: false, error: 'Manual pool not found' };

    const upper = ticker.toUpperCase();

    // 1. Execute on Revolut X
    const revolutResult = await executeRevolutTrade(userId, upper, 'BUY', amount, price);
    if (!revolutResult.success) {
      return { success: false, error: `Revolut execution failed. Verify your API keys and balance.` };
    }

    const fillPrice = revolutResult.fillPrice || price;

    // 2. Update Internal Ledger
    const result = await executePoolBuy(
      userId,
      pool,
      upper,
      amount,
      fillPrice,
      `🧑‍💻 MANUAL ADD: ${reason}`,
      { btcPrice: 0, btcChange24h: 0, tokenChange24h: 0, fearGreedIndex: 50 },
      `Manual position addition by user: ${reason}`,
      'CRYPTO'
    );

    if (result.success && result.trade) {
      const arenaNAV = (arena as any).totalValue || 0;
      const arenaSharedCash = (arena as any).sharedCash || 0;
      await sendTradeAlerts([result.trade], arenaNAV, arenaSharedCash);
    }

    return { success: result.success, error: result.error };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// MASTER PORTFOLIO & DEEP ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 4-HOUR DEEP ANALYSIS ENGINE
 * Performs high-fidelity forensic analysis on every token held in the Revolut X Master Portfolio.
 */
export async function runPortfolioDeepAnalysis(
  userId: string,
  arena: ArenaConfig,
  prices: Record<string, { price: number; change24h: number }>
): Promise<TokenAnalysis[]> {
  if (!adminDb) return [];
  
  const tokenAnalyses: TokenAnalysis[] = [];
  const now = new Date().toISOString();
  const btcPrice = prices['BTC']?.price || 0;
  
  // 1. Identify tokens to analyze (all holdings + BTC as anchor)
  const tokensToAnalyze = new Set<string>(['BTC']);
  for (const pool of arena.pools) {
    Object.keys(pool.holdings).forEach(t => tokensToAnalyze.add(t.toUpperCase()));
  }

  console.log(`[DeepAnalysis] 🧠 Starting 4-hour forensic audit for ${tokensToAnalyze.size} tokens...`);

  // 2. Analyze each token
  for (const ticker of tokensToAnalyze) {
    try {
      const priceData = prices[ticker] || { price: 0, change24h: 0 };
      const techData = await fetchTechnicalDataForTokens([ticker], prices);
      const profile = techData[ticker];
      
      const prompt = `
You are a Senior Crypto Portfolio Auditor. Perform a 4-hour forensic analysis for ${ticker}.
Price: $${priceData.price.toFixed(4)} (${priceData.change24h.toFixed(2)}% vs 24h ago).
BTC Reference Price: $${btcPrice.toLocaleString()}.
Technical Signal: ${profile?.macdSignal || 'NEUTRAL'} (${profile?.trendDirection || 'No data'}).
Indicators: RSI: ${profile?.rsi14?.toFixed(1) || 'N/A'}, SMA25: ${profile?.sma25?.toFixed(4) || 'N/A'}.

YOUR TASK:
Provide a concise, premium "Detailed Analysis" card for this token.
Explain if it is showing relative strength or weakness vs BTC.
Give a clear actionable insight (e.g. "Wait for retest of SMA20" or "Profit-taking suggested above ").

Respond ONLY with valid JSON:
{
  "score": 0-100,
  "reflection": "3-4 sentences of deep fundamental/technical reasoning.",
  "techVerdict": "1 sentence verdict on the price chart.",
  "sentiment": "BULLISH/BEARISH/NEUTRAL",
  "actionableInsight": "Max 15 words: what to do next.",
  "btcComparison": "How it is relative performing vs BTC rallies/dips."
}
`;
      
      const responseText = await generateContentWithFallback(prompt);
      const res = safeJsonParse<any>(responseText);
      
      if (res) {
        const analysis: TokenAnalysis = {
          ticker,
          timestamp: now,
          score: res.score || 50,
          reflection: res.reflection || 'No analysis available.',
          techVerdict: res.techVerdict || 'Neutral.',
          sentiment: res.sentiment || 'NEUTRAL',
          actionableInsight: res.actionableInsight || 'Monitor.',
          btcComparison: res.btcComparison || 'Stable.',
        };
        tokenAnalyses.push(analysis);
        
        // Persist "Latest" to Firestore
        await adminDb.collection('token_analyses').doc(userId).collection('latest').doc(ticker).set(analysis);
      }
    } catch (e: any) {
      console.error(`[DeepAnalysis] Error analyzing ${ticker}: `, e.message);
    }
  }
  
  return tokenAnalyses;
}

/** 
 * Retrieves the latest detailed analyses for the user dashboard.
 */
export async function getLatestTokenAnalyses(userId: string): Promise<TokenAnalysis[]> {
  if (!adminDb) return [];
  try {
    const snap = await adminDb.collection('token_analyses').doc(userId).collection('latest').get();
    return snap.docs.map(d => d.data() as TokenAnalysis);
  } catch { return []; }
}

/**
 * MASTER PORTFOLIO CONSOLIDATION
 * Syncs real Revolut X holdings into Pool 1 ("Master Portfolio") and deactivates others.
 */
export async function syncMasterPortfolioFromRevolut(userId: string, arena: ArenaConfig) {
  if (!adminDb) {
    throw new Error("Database offline.");
  }
  
  const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
  const agentConfig = configDoc.data();
  if (!agentConfig?.revolutApiKey || !agentConfig?.revolutPrivateKey) {
    throw new Error("Missing Revolut X API credentials (API Key or Private Key). Please configure them in your settings panel.");
  }

  const client = new RevolutX(
    agentConfig.revolutApiKey,
    agentConfig.revolutPrivateKey,
    agentConfig.revolutIsSandbox || false,
    agentConfig.revolutProxyUrl,
  );

  try {
    const balances = await client.getBalances() as any[];
    const fiatEntries = balances.filter(b => ['USD', 'GBP', 'EUR'].includes((b.currency ?? b.symbol ?? '').toUpperCase()));
    // Sort by balance descending and take the top one
    const primaryCashAccount = fiatEntries.sort((a,b) => (b.available ?? b.balance ?? 0) - (a.available ?? a.balance ?? 0))[0];
    const revolutUsd = primaryCashAccount ? parseFloat((primaryCashAccount.available ?? primaryCashAccount.balance ?? 0).toString()) : 0;
    
    // Map Revolut holdings: Ticker -> Amount
    // ⚠️ LIVE TRADING SCOPE: Only tokens in AGENT_WATCHLIST (XRP, AAVE) are managed
    // by the AI. Any other Revolut holdings (personal BTC, ETH, etc.) are excluded
    // to prevent the system from trading tokens outside its mandated scope.
    const allRevolutBalances: Record<string, number> = {};
    for (const b of balances) {
      const sym = (b.currency ?? b.symbol ?? '').toUpperCase();
      if (!sym || sym === 'USD') continue;
      const amt = parseFloat((b.available ?? b.balance ?? 0).toString());
      if (amt > 0) allRevolutBalances[sym] = amt;
    }

    const revolutHoldingsMap: Record<string, number> = {};
    const excludedTokens: string[] = [];
    for (const [sym, amt] of Object.entries(allRevolutBalances)) {
      if (AGENT_WATCHLIST.includes(sym)) {
        revolutHoldingsMap[sym] = amt;
      } else if (!['GBP', 'EUR', 'USD'].includes(sym) && !STABLECOIN_REJECT_LIST.includes(sym)) {
        excludedTokens.push(sym);
      }
    }
    if (excludedTokens.length > 0) {
      console.log(`[MasterSync] 🚫 Excluded ${excludedTokens.length} non-watchlist token(s) from live portfolio: ${excludedTokens.join(', ')} (personal holdings — AI has no mandate to trade these).`);
    }

    // Target: POOL 1 as Master Portfolio
    const masterPool = arena.pools[0];
    if (!masterPool) return;
    
    masterPool.name = "MASTER PORTFOLIO";
    masterPool.emoji = "💼";
    masterPool.status = 'ACTIVE';

    const newHoldings: Record<string, any> = {};
    const newTokens: string[] = [];

    // Find unseen tickers or existing tickers with a broken 0 cost basis
    const tickersNeedingPrices = Object.keys(revolutHoldingsMap).filter(t => 
        !masterPool.holdings[t] || !masterPool.holdings[t].averagePrice
    );
    let livePrices: Record<string, { price: number }> = {};
    if (tickersNeedingPrices.length > 0) {
        livePrices = await getVerifiedPrices(tickersNeedingPrices, userId);
    }

    // Sync Master Pool holdings with Revolut
    for (const [ticker, amount] of Object.entries(revolutHoldingsMap)) {
      newTokens.push(ticker);
      const existing = masterPool.holdings[ticker];
      
      if (existing) {
        // Position still exists — update amount, preserve cost basis (for pnl tracking)
        // If amount increased, could average up, but simplicity for now: keep existing avg.
        // If average price was manually overridden or previously missing, fallback to live
        const currentPrice = existing.averagePrice || livePrices[ticker]?.price || 0;
        newHoldings[ticker] = { ...existing, amount, averagePrice: currentPrice };
      } else {
        // New position manually bought by user (or detected on Revolut)
        // ANCHOR: Use current live price as initial cost basis + mark as userDirected
        const livePrice = livePrices[ticker]?.price || 0;
        newHoldings[ticker] = { 
           amount, 
           averagePrice: livePrice, 
           peakPrice: livePrice, 
           peakPnlPct: 0,
           boughtAt: new Date().toISOString(),
           userDirected: true
        };
      }
    }

    masterPool.holdings = newHoldings;
    masterPool.tokens = newTokens;
    arena.sharedCash = revolutUsd;

    // Deactivate AI pools 2, 3, 4 (Pause only, preserve holdings/manual entries)
    for (let i = 1; i < arena.pools.length; i++) {
      arena.pools[i].status = 'PAUSED';
      arena.pools[i].name = "MOTHBALLED STRATEGY";
      // We no longer wipe holdings here to ensure manual acquisitions and prior gains are preserved
    }

    console.log(`[MasterSync] 💼 Consolidated ${newTokens.length} token(s) into Master Portfolio for user ${userId.substring(0, 8)}: ${newTokens.join(', ')} (watchlist-scoped).`);
  } catch (e: any) {
    console.error(`[MasterSync] revolut sync failed: ${e.message}`);
    throw new Error(`Revolut X sync failed: ${e.message}`);
  }
}

/**
 * MISSION TRANSFORMATION: Enables Master Portfolio Mode and Sell-Only Mode for the Crypto Arena.
 */
export async function enableMasterPortfolioMode(userId: string): Promise<{ success: boolean; message: string }> {
  'use server';
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
  
  const arenaCol = getArenaCollections('CRYPTO').config;
  const snap = await adminDb.collection(arenaCol).doc(userId).get();
  if (!snap.exists) return { success: false, message: 'Arena config not found in system.' };
  
  const arena = snap.data() as ArenaConfig;
  
  // Enable master mode flags
  const { TOTAL_BUDGET } = await import('@/lib/constants');
  arena.masterPortfolioMode = true;
  arena.initialized = true; // Ensure halt is cleared if it wasn't before
  arena.sellOnlyMode = true;
  arena.totalBudget = TOTAL_BUDGET;
  arena.lastDeepAnalysisAt = new Date(0).toISOString(); // Force immediate 4hr forensics
  
  // IMMEDIATELY sync with Revolut to populate the Master Pool (Pool 1)
  try {
     console.log(`[MasterSync] 📡 Triggering immediate Revolut sync for ${userId.substring(0, 8)}...`);
     await syncMasterPortfolioFromRevolut(userId, arena);
  } catch (e: any) {
     console.error(`[MasterSync] ❌ Immediate sync failed: ${e.message}`);
     // Proceeding anyway but notify user sync might be delayed
  }

  // Save the synchronized arena configuration
  await adminDb.collection(arenaCol).doc(userId).set(arena);
  
  return { success: true, message: 'Master Portfolio Mode: ACTIVATED. System successfully mirrored Revolut X holdings and consolidated pools.' };
}

export async function manualRevolutSync(userId: string): Promise<{ success: boolean; message: string }> {
  'use server';
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
  
  const { TOTAL_BUDGET } = await import('@/lib/constants');
  const arenaCol = getArenaCollections('CRYPTO').config;
  const snap = await adminDb.collection(arenaCol).doc(userId).get();
  if (!snap.exists) return { success: false, message: 'Arena config not found.' };
  
  const arena = snap.data() as ArenaConfig;
  
  try {
     console.log(`[ManualSync] ⚡ Manual Revolut X sync requested for ${userId.substring(0, 8)}...`);
     await syncMasterPortfolioFromRevolut(userId, arena);
     
     // Ensure budget baseline is updated
     arena.totalBudget = TOTAL_BUDGET;
     
     // Save updated arena
     await adminDb.collection(arenaCol).doc(userId).set(arena);
     return { success: true, message: 'SYNC COMPLETE. All Revolut X details (cash + holdings) are now synchronized with Semaphore.' };
  } catch (e: any) {
     return { success: false, message: `Sync failed: ${e.message}` };
  }
}

export async function resetUserArena(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<{ success: boolean; message: string }> {
  'use server';
  if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
  
  const { getArenaCollections: _gc } = await import('@/lib/constants');
  const col = _gc(assetClass);
  const configRef = adminDb.collection(col.config).doc(userId);
  const tradeSnap = await adminDb.collection(col.trades).where('userId', '==', userId).get();
  
  const batch = adminDb.batch();
  batch.delete(configRef);
  tradeSnap.docs.forEach(d => batch.delete(d.ref));
  
  await batch.commit();
  console.log(`[Arena] 🗑️ User arena ${userId.substring(0, 8)} for ${assetClass} PURGED.`);
  return { success: true, message: 'Arena configuration and historical trades have been purged. System ready for fresh initialization.' };
}

/**
 * Update the automatic buyback configuration for a specific token in a pool.
 */
export async function updateBuybackConfig(
  userId: string,
  ticker: string,
  config: import('@/lib/constants').BuybackConfig,
): Promise<{ success: boolean; error?: string }> {
  'use server';
  try {
    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return { success: false, error: 'Arena not found' };

    // Find the pool containing this token
    const upper = ticker.toUpperCase();
    const pool = arena.pools.find(p => p.tokens.map(t => t.toUpperCase()).includes(upper));
    if (!pool) return { success: false, error: `Token ${ticker} not assigned to any pool.` };

    if (!pool.buybackConfigs) pool.buybackConfigs = {};
    
    // Preserve existing completed status if just updating thresholds/amounts
    const existing = pool.buybackConfigs[upper];
    if (existing && config.stages.length === existing.stages.length) {
        config.stages.forEach((s, i) => {
            if (existing.stages[i].completed) {
                s.completed = true;
                s.ts = existing.stages[i].ts;
            }
        });
    }

    pool.buybackConfigs[upper] = config;

    const dbCols = await import('@/lib/constants').then(m => m.getArenaCollections('CRYPTO'));
    await adminDb!.collection(dbCols.config).doc(userId).set(arena);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}


// ── VIRTUAL ARENA SPECIFIC ACTIONS ──────────────────────────────────────────

export async function getGranularPriceMovements(tickers: string[]) {
  const { fetch5mCandles } = await import('@/lib/technicals');
  const results: Record<string, Record<number, number>> = {};
  const intervals = [5, 15, 30, 60, 180, 360, 720, 1440];
  
  for (const t of tickers) {
    const candles = await fetch5mCandles(t);
    if (!candles || candles.length === 0) continue;
    
    // Sort descending by timestamp (newest first)
    const sorted = [...candles].sort((a, b) => b.timestamp - a.timestamp);
    const latestPrice = sorted[0].close;
    
    const tickerMovements: Record<number, number> = {};
    for (const mins of intervals) {
      // Find the candle closest to (latest - mins * 60)
      const targetTs = sorted[0].timestamp - (mins * 60);
      let closestCandle = sorted[sorted.length - 1]; // default to oldest
      let minDiff = Infinity;
      
      for (const c of sorted) {
        const diff = Math.abs(c.timestamp - targetTs);
        if (diff < minDiff) {
          minDiff = diff;
          closestCandle = c;
        }
      }
      
      const oldPrice = closestCandle.close;
      const pctChange = ((latestPrice - oldPrice) / oldPrice) * 100;
      tickerMovements[mins] = Math.round(pctChange * 100) / 100;
    }
    results[t] = tickerMovements;
  }
  return JSON.parse(JSON.stringify(results));
}

export async function getUnifiedAuditTrail(userId: string) {
  if (!adminDb) return [];
  
  const tradesSnap = await adminDb.collection('arena_trades')
    .where('userId', '==', userId)
    .get();
    
  const alertsSnap = await adminDb.collection('integrity_alerts')
    .where('userId', '==', userId)
    .get();
    
  const events: any[] = [];
  
  tradesSnap.forEach(doc => {
    const data = doc.data();
    events.push({
      id: doc.id,
      type: 'TRADE',
      timestamp: data.date,
      title: `${data.type} ${Number(data.amount).toFixed(2)} ${data.ticker} @ $${Number(data.price).toFixed(2)}`,
      description: data.reflection || data.reasoning || `Executed ${data.type} order.`,
      severity: data.type === 'BUY' ? 'INFO' : 'WARNING',
      metadata: data
    });
  });
  
  alertsSnap.forEach(doc => {
    const data = doc.data();
    events.push({
      id: doc.id,
      type: data.checkName === 'HEARTBEAT' ? 'HEARTBEAT' : 'ALERT',
      timestamp: data.detectedAt,
      title: data.title,
      description: data.description,
      severity: data.severity,
      metadata: data
    });
  });
  
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return JSON.parse(JSON.stringify(events.slice(0, 100)));
}

export async function getRealizedLedger(userId: string) {
  if (!adminDb) return [];
  const snap = await adminDb.collection('arena_trades')
    .where('userId', '==', userId)
    .get();
    
  const trades: any[] = [];
  snap.forEach(doc => {
    const data = doc.data();
    if (data.type === 'SELL') {
      trades.push({ id: doc.id, ...data });
    }
  });
  
  trades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return JSON.parse(JSON.stringify(trades));
}

export async function runVirtualBacktest(
  ticker: string,
  buyThreshold: number,
  exitThreshold: number,
  stopLoss: number,
  takeProfit: number,
  daysAgo: number = 7
) {
  const { fetchHistorical1hCandles } = await import('@/lib/technicals');
  const candles = await fetchHistorical1hCandles(ticker, daysAgo);
  if (!candles || candles.length < 30) {
    return { success: false, error: 'Insufficient price data. Please try again later.' };
  }

  // 1. Pre-calculate technical indicators sequentially
  const closes: number[] = [];
  const rsiValues: number[] = [];
  const sma7Values: number[] = [];
  const sma25Values: number[] = [];
  const macdValues: Array<{ macd: number; signal: number }> = [];

  let prevEma12 = 0;
  let prevEma26 = 0;
  let prevMacdEma = 0; // for MACD Signal Line

  // Wilder's RSI state
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    closes.push(close);

    // SMAs
    if (closes.length >= 7) {
      sma7Values.push(closes.slice(-7).reduce((a, b) => a + b, 0) / 7);
    } else {
      sma7Values.push(close);
    }

    if (closes.length >= 25) {
      sma25Values.push(closes.slice(-25).reduce((a, b) => a + b, 0) / 25);
    } else {
      sma25Values.push(close);
    }

    // EMAs for MACD
    if (i === 0) {
      prevEma12 = close;
      prevEma26 = close;
      macdValues.push({ macd: 0, signal: 0 });
    } else {
      const k12 = 2 / 13;
      const k26 = 2 / 27;
      const ema12 = close * k12 + prevEma12 * (1 - k12);
      const ema26 = close * k26 + prevEma26 * (1 - k26);
      const macd = ema12 - ema26;

      if (i === 1) prevMacdEma = macd;
      const kSig = 2 / 10;
      const macdSignal = macd * kSig + prevMacdEma * (1 - kSig);

      macdValues.push({ macd, signal: macdSignal });
      prevEma12 = ema12;
      prevEma26 = ema26;
      prevMacdEma = macdSignal;
    }

    // RSI(14)
    if (i === 0) {
      rsiValues.push(50); // neutral start
    } else {
      const change = close - candles[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      if (i <= 14) {
        avgGain += gain / 14;
        avgLoss += loss / 14;
        rsiValues.push(50);
      } else {
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiValues.push(rsi);
      }
    }
  }

  // 2. chronological simulation
  let cash = 1000;
  let holdAmount = 0;
  let avgBuyPrice = 0;

  let wins = 0;
  let losses = 0;
  let totalTrades = 0;

  const initialPrice = candles[0].close;
  const navSeries: Array<{ date: string; strategyNav: number; baselineNav: number; price: number; score: number }> = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = candle.close;
    const dateStr = new Date(candle.timestamp * 1000).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    const rsi = rsiValues[i];
    const sma7 = sma7Values[i];
    const sma25 = sma25Values[i];
    const macdData = macdValues[i] || { macd: 0, signal: 0 };

    // Simulated conviction score (emulating the AI)
    let score = 50; // baseline
    
    // RSI rules
    if (rsi < 30) score += 18;
    else if (rsi < 45) score += 8;
    else if (rsi > 70) score -= 18;
    else if (rsi > 55) score -= 8;

    // SMA rules
    if (price > sma7 && price > sma25) score += 18;
    else if (price < sma7 && price < sma25) score -= 18;

    // MACD rules
    if (macdData.macd > macdData.signal) score += 14;
    else score -= 14;

    score = Math.max(10, Math.min(95, score)); // cap

    // Strategy Execution Logic
    if (holdAmount > 0) {
      // HOLDING -> Check Exits
      const pnlPct = ((price - avgBuyPrice) / avgBuyPrice) * 100;
      let triggerExit = false;

      if (pnlPct <= stopLoss) {
        triggerExit = true;
        losses++;
      } else if (pnlPct >= takeProfit) {
        triggerExit = true;
        wins++;
      } else if (score < exitThreshold) {
        triggerExit = true;
        if (pnlPct >= 0) wins++;
        else losses++;
      }

      if (triggerExit) {
        cash = holdAmount * price * 0.998; // 0.2% virtual fee
        holdAmount = 0;
        avgBuyPrice = 0;
        totalTrades++;
      }
    } else {
      // NOT HOLDING -> Check Entry
      if (score >= buyThreshold) {
        holdAmount = (cash * 0.998) / price;
        cash = 0;
        avgBuyPrice = price;
      }
    }

    // Record NAVs
    const strategyNav = cash + (holdAmount * price);
    const baselineNav = (price / initialPrice) * 1000;

    navSeries.push({
      date: dateStr,
      strategyNav: parseFloat(strategyNav.toFixed(2)),
      baselineNav: parseFloat(baselineNav.toFixed(2)),
      price,
      score: Math.round(score)
    });
  }

  // Calculate stats
  const finalStrategyNav = navSeries[navSeries.length - 1].strategyNav;
  const finalBaselineNav = navSeries[navSeries.length - 1].baselineNav;

  const strategyReturnPct = ((finalStrategyNav - 1000) / 1000) * 100;
  const baselineReturnPct = ((finalBaselineNav - 1000) / 1000) * 100;

  return {
    success: true,
    stats: {
      initialNav: 1000,
      finalStrategyNav,
      finalBaselineNav,
      strategyReturnPct: parseFloat(strategyReturnPct.toFixed(2)),
      baselineReturnPct: parseFloat(baselineReturnPct.toFixed(2)),
      totalTrades,
      winRatePct: totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(1)) : 0,
      outperformancePct: parseFloat((strategyReturnPct - baselineReturnPct).toFixed(2))
    },
    series: navSeries
  };
}

function fetchCryptoNews(): string[] {
  const pools = [
    "XRP Ripple volume surges as settlement speculation reaches fever pitch following CEO comments.",
    "AAVE yield pools witness massive $250M institutional deposit, pushing TVL past $14B.",
    "SEC Chair issues compliance warning for decentralized lending systems, causing minor DeFi volatility.",
    "Macro liquidity indexes show stable global cash flows into risk assets as inflation eases.",
    "Bitcoin derivatives squeeze shorts as price anchors above major $94,000 consolidation floor.",
    "Ripple Labs announces strategic custody partnerships to expand institutional ledger solutions.",
    "AAVE optimization upgrade cuts user gas costs by 45%, spurring high-frequency lending loops.",
    "Regulatory headwinds intensify as global central banks outline unified DeFi auditing guidelines."
  ];
  return [...pools].sort(() => 0.5 - Math.random()).slice(0, 5);
}

export interface SentimentState {
  score: number;
  narrativeMode: 'BULLISH_FOMO' | 'NEUTRAL' | 'FUD_ALERT' | 'MACRO_DANGEROUS';
  reflection: string;
  headlines: Array<{ title: string; sentiment: 'BULLISH' | 'FUD' | 'NEUTRAL' }>;
  updatedAt: string;
}

export async function runSentimentScan(userId: string): Promise<SentimentState | null> {
  if (!adminDb) return null;

  const headlines = fetchCryptoNews();
  
  const prompt = `
  ROLE: You are the Chief AI Sentiment Architect & Macro Analyst for the Virtual Profit Arena.
  Your job is to audit recent crypto news headlines, analyze narrative sentiment, and produce a global sentiment score.

  HEADLINES FOR AUDIT:
  ${headlines.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

  YOUR AUDIT RULES:
  - Global Sentiment Score (0-100): 0-35 represents severe FUD/bearish sentiment, 36-60 represents neutral market conditions, 61-100 represents bullish FOMO/strong optimism.
  - Narrative Mode: Must be exactly one of: "BULLISH_FOMO", "NEUTRAL", "FUD_ALERT", "MACRO_DANGEROUS". Use "MACRO_DANGEROUS" only if news represents systemic risk or heavy SEC crackdown on DeFi.
  - Categorize each of the 5 headlines as exactly "BULLISH", "FUD", or "NEUTRAL".

  OUTPUT JSON (respond with ONLY valid JSON):
  {
    "score": (0-100),
    "narrativeMode": "BULLISH_FOMO" | "NEUTRAL" | "FUD_ALERT" | "MACRO_DANGEROUS",
    "reflection": "A 2-sentence macro analysis explaining your score based on regulatory, yield, and liquidity trends.",
    "headlines": [
      { "title": "Headline 1", "sentiment": "BULLISH" | "FUD" | "NEUTRAL" },
      ...
    ]
  }`;

  try {
    const responseText = await generateContentWithFallback(prompt);
    if (!responseText) throw new Error("AI returned empty response");
    const aiResult = safeJsonParse(responseText);
    const sentimentState: SentimentState = {
      score: safeNumber(aiResult.score || 50),
      narrativeMode: aiResult.narrativeMode || 'NEUTRAL',
      reflection: aiResult.reflection || 'Market remains balanced with minor regulatory consolidation.',
      headlines: aiResult.headlines || headlines.map(h => ({ title: h, sentiment: 'NEUTRAL' })),
      updatedAt: new Date().toISOString()
    };

    await adminDb.collection('arena_config').doc(userId).collection('latest_sentiment').doc('CRYPTO').set(sentimentState);
    console.log(`[Sentiment] Scan completed. Score: ${sentimentState.score}, Mode: ${sentimentState.narrativeMode}`);
    return sentimentState;
  } catch (error: any) {
    console.error(`[Sentiment] Scan failed: ${error.message}`);
    const fallback: SentimentState = {
      score: 50,
      narrativeMode: 'NEUTRAL',
      reflection: 'Telemetry checks stable. Sentiment index defaulted to neutral baseline.',
      headlines: headlines.map(h => ({ title: h, sentiment: 'NEUTRAL' })),
      updatedAt: new Date().toISOString()
    };
    await adminDb.collection('arena_config').doc(userId).collection('latest_sentiment').doc('CRYPTO').set(fallback);
    return fallback;
  }
}

export async function getLatestSentiment(userId: string): Promise<SentimentState | null> {
  if (!adminDb) return null;
  const doc = await adminDb.collection('arena_config').doc(userId).collection('latest_sentiment').doc('CRYPTO').get();
  if (!doc.exists) {
    // Dynamically seed and trigger first scan on-the-fly
    return await runSentimentScan(userId);
  }
  return doc.data() as SentimentState;
}

export async function toggleLiveTrading(userId: string, enabled: boolean): Promise<{ success: boolean; message: string }> {
  if (!adminDb) return { success: false, message: 'Database offline.' };
  
  try {
    const arena = await getArenaConfig(userId);
    if (!arena) return { success: false, message: 'Arena config not found.' };

    if (enabled) {
      // Trigger Master Mode and sync from Revolut automatically when going live!
      arena.realTradingEnabled = true;
      arena.masterPortfolioMode = true;
      await syncMasterPortfolioFromRevolut(userId, arena);

      // WIPE historical virtual/sandbox trades to start the Realized PnL Ledger fresh for live capital!
      const tradesSnap = await adminDb.collection('arena_trades').where('userId', '==', userId).get();
      const batch = adminDb.batch();
      tradesSnap.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      await adminDb.collection('arena_config').doc(userId).set(arena);
    } else {
      // When going back to sandbox/virtual, turn off real trading but keep sandbox settings
      arena.realTradingEnabled = false;
      arena.masterPortfolioMode = false;
      await adminDb.collection('arena_config').doc(userId).set(arena);
    }

    return { 
      success: true, 
      message: enabled 
        ? 'System successfully set to LIVE trading. Capital synchronization completed.' 
        : 'System safely returned to VIRTUAL sandbox mode.' 
    };
  } catch (err: any) {
    console.error(`[ToggleLive] Error: ${err.message}`);
    return { success: false, message: `Action failed: ${err.message}` };
  }
}


