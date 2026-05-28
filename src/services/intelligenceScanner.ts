/**
 * INTELLIGENCE SCANNER SERVICE
 *
 * Runs twice daily (AM pre-market + PM post-market) for each non-crypto arena:
 *   1. MORNING SCAN  — Fetches prices, news, technicals for entire expanded universe.
 *                       Scores and ranks. Selects Top 10 candidates per pool.
 *   2. EVENING SCAN  — Re-scores Top 10, applies Dual Confirmation Gate,
 *                       promotes Top 2 confirmed candidates into pools.
 *
 * Replaces Scenario C for stock selection while keeping Scenario C's rotation
 * infrastructure for backward compatibility.
 *
 * Data flow: EODHD prices + EODHD news → Technical indicators → Multi-factor score → AI deep analysis → Promotion
 */

import { adminDb } from '@/lib/firebase-admin';
import { generateContentWithFallback } from '@/lib/gemini';
import {
    type AssetClass, type ArenaPool, type PoolId,
    type ScanCandidate, type IntelligenceScanResult, type PoolPromotionEvent,
    type PoolRotationEvent,
    getWatchlist, getArenaCollections, getCurrencySymbol, formatEODHDTicker,
    COMMODITIES_DISPLAY_NAMES, EODHD_CRITICAL_THRESHOLD,
} from '@/lib/constants';
import { fetch5mCandles, computeTechnicalIndicators, formatTechnicalDataForPrompt } from '@/lib/technicals';
import { checkEODHDQuota } from '@/lib/eodhd-quota';
import { sendSystemAlert } from '@/services/telegramService';

// ─── EODHD NEWS FETCHER ──────────────────────────────────────────────────────

interface EODHDNewsItem {
    title: string;
    date: string;
    content: string;
    link: string;
    symbols?: string[];
    sentiment?: { polarity: string };
}

const newsCache: Map<string, { data: EODHDNewsItem[]; ts: number }> = new Map();
const NEWS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function fetchNewsForTicker(ticker: string, assetClass: AssetClass): Promise<EODHDNewsItem[]> {
    const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
    if (!EODHD_API_KEY) return [];

    const cacheKey = `${ticker}:${assetClass}`;
    const cached = newsCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < NEWS_CACHE_TTL) return cached.data;

    try {
        const eodhdTicker = formatEODHDTicker(ticker, assetClass);
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        const url = `https://eodhd.com/api/news?s=${eodhdTicker}&from=${yesterday}&to=${today}&limit=5&api_token=${EODHD_API_KEY}&fmt=json`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return cached?.data ?? [];

        const data = await res.json();
        const items: EODHDNewsItem[] = Array.isArray(data) ? data.slice(0, 5) : [];
        newsCache.set(cacheKey, { data: items, ts: Date.now() });
        return items;
    } catch (e: any) {
        console.warn(`[IntelScanner] News fetch failed for ${ticker}: ${e.message}`);
        return cached?.data ?? [];
    }
}

// ─── BATCH NEWS FETCH (batched to conserve API calls) ──────────────────────

async function fetchNewsForUniverse(
    tickers: string[],
    assetClass: AssetClass,
): Promise<Record<string, EODHDNewsItem[]>> {
    const result: Record<string, EODHDNewsItem[]> = {};
    // Fetch news in parallel batches of 10 to avoid overwhelming EODHD
    const BATCH = 10;
    for (let i = 0; i < tickers.length; i += BATCH) {
        const batch = tickers.slice(i, i + BATCH);
        const promises = batch.map(async (t) => {
            result[t.toUpperCase()] = await fetchNewsForTicker(t, assetClass);
        });
        await Promise.all(promises);
    }
    return result;
}

// ─── PRICE FETCHER (reuses EODHD real-time API) ──────────────────────────────

async function fetchUniversePrices(
    tickers: string[],
    assetClass: AssetClass,
): Promise<Record<string, { price: number; change24h: number; volume: number }>> {
    const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
    if (!EODHD_API_KEY || tickers.length === 0) return {};

    const quota = await checkEODHDQuota();
    if (quota.blocked) return {};

    const cleanTickers = tickers.map(t => t.trim().split(/\s+/)[0].toUpperCase());
    const eodhdTickers = cleanTickers.map(t => formatEODHDTicker(t, assetClass));
    const eodhdToClean: Record<string, string> = {};
    cleanTickers.forEach((t, i) => { eodhdToClean[eodhdTickers[i]] = t; });

    const result: Record<string, { price: number; change24h: number; volume: number }> = {};

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
                const arenaTicker = eodhdToClean[item.code] ?? item.code;
                const price = parseFloat(item.close);
                if (isNaN(price) || price <= 0) continue;

                const prevClose = parseFloat(item.previousClose);
                const change24h = (!isNaN(prevClose) && prevClose > 0)
                    ? ((price - prevClose) / prevClose) * 100
                    : (parseFloat(item.change_p) || 0);

                result[arenaTicker] = { price, change24h, volume: parseFloat(item.volume) || 0 };
            }
        } catch (e: any) {
            console.warn(`[IntelScanner] Price batch failed: ${e.message}`);
        }
    }

    return result;
}

// ─── TECHNICAL SCORING (0-25) ────────────────────────────────────────────────

function computeTechnicalScore(ticker: string, tech: any | null): number {
    if (!tech) return 12; // neutral default

    let score = 0;

    // RSI component (0-8): oversold = bullish, overbought = bearish
    if (tech.rsi14 < 30) score += 8;          // Oversold — strong buy signal
    else if (tech.rsi14 < 40) score += 6;
    else if (tech.rsi14 < 50) score += 4;
    else if (tech.rsi14 < 60) score += 3;
    else if (tech.rsi14 < 70) score += 2;
    else score += 0;                          // Overbought — sell risk

    // MACD component (0-5)
    if (tech.macdSignal === 'BULLISH') score += 5;
    else if (tech.macdSignal === 'NEUTRAL') score += 2;

    // Trend direction (0-5)
    if (tech.trendDirection === 'UP') score += 5;
    else if (tech.trendDirection === 'SIDEWAYS') score += 2;

    // Volume strength (0-4)
    if (tech.volumeRatio > 1.5) score += 4;
    else if (tech.volumeRatio > 1.0) score += 2;
    else score += 1;

    // Price momentum (0-3)
    if (tech.change3d > 2) score += 3;
    else if (tech.change3d > 0) score += 2;
    else if (tech.change3d > -2) score += 1;

    return Math.min(25, score);
}

// ─── VALUE SCORING (0-25) ────────────────────────────────────────────────────

function computeValueScore(price: number, change24h: number, tech: any | null): number {
    let score = 12; // neutral baseline

    // Price position in range (approaching support = value)
    if (tech) {
        if (tech.pricePosition24h < 20) score += 5;      // Near low — value zone
        else if (tech.pricePosition24h < 40) score += 3;
        else if (tech.pricePosition24h > 80) score -= 3;  // Near high — risk

        // Away from resistance means room to run
        if (tech.resistanceLevel > price && price > 0) {
            const roomPct = ((tech.resistanceLevel - price) / price) * 100;
            if (roomPct > 10) score += 4;
            else if (roomPct > 5) score += 2;
        }
    }

    // Recent pullback (buying opportunity)
    if (change24h < -3) score += 4;
    else if (change24h < -1) score += 2;
    else if (change24h > 5) score -= 2; // Already moved — chase risk

    return Math.max(0, Math.min(25, score));
}

// ─── NEWS SCORING (0-25) ─────────────────────────────────────────────────────

function computeNewsCatalystScore(news: EODHDNewsItem[]): { score: number; headlines: string[] } {
    if (!news || news.length === 0) return { score: 5, headlines: [] }; // No news = neutral

    const headlines = news.slice(0, 3).map(n => n.title.substring(0, 120));
    let score = 8; // Base: has news coverage

    // Sentiment analysis
    let positiveCount = 0;
    let negativeCount = 0;
    for (const item of news) {
        const sentiment = String(item.sentiment?.polarity || '').toLowerCase();
        const title = item.title.toLowerCase();

        if (sentiment === 'positive' || title.includes('beat') || title.includes('upgrade') ||
            title.includes('rally') || title.includes('surge') || title.includes('gains')) {
            positiveCount++;
        }
        if (sentiment === 'negative' || title.includes('miss') || title.includes('downgrade') ||
            title.includes('crash') || title.includes('loss') || title.includes('warns')) {
            negativeCount++;
        }

        // Catalyst detection
        if (title.includes('earnings') || title.includes('results') || title.includes('dividend')) score += 3;
        if (title.includes('acquisition') || title.includes('merger') || title.includes('buyback')) score += 3;
        if (title.includes('analyst') || title.includes('price target') || title.includes('rating')) score += 2;
        if (title.includes('fda') || title.includes('approval') || title.includes('patent')) score += 2;
        if (title.includes('contract') || title.includes('partnership') || title.includes('deal')) score += 2;
    }

    score += positiveCount * 2;
    score -= negativeCount * 3;

    return { score: Math.max(0, Math.min(25, score)), headlines };
}

// ─── MACRO SCORING (0-25) — uses market-wide signals ─────────────────────────

function computeMacroScore(assetClass: AssetClass, change24h: number): number {
    // Simplified macro scoring — can be enhanced with actual macro data later
    let score = 12; // Neutral baseline

    // Asset class tendencies
    if (assetClass === 'COMMODITIES') {
        // Commodities: momentum matters more in trending markets
        if (change24h > 1) score += 5;
        else if (change24h > 0) score += 3;
        else if (change24h < -2) score -= 2;
    } else {
        // Equities: moderate positive momentum is ideal
        if (change24h > 0.5 && change24h < 3) score += 4;
        else if (change24h > 0) score += 2;
        else if (change24h < -3) score -= 3; // Falling market
    }

    return Math.max(0, Math.min(25, score));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCANNER: runIntelligenceScan()
// Called by AM and PM cron routes. Scans entire universe, scores, ranks,
// and for PM scans, compares with AM results for dual confirmation.
// ═══════════════════════════════════════════════════════════════════════════

export async function runIntelligenceScan(
    userId: string,
    assetClass: Exclude<AssetClass, 'CRYPTO'>,
    scanType: 'MORNING' | 'EVENING',
): Promise<{
    success: boolean;
    scans: IntelligenceScanResult[];
    promotions: Array<{ poolId: string; inTicker: string; outTicker?: string; reason: string }>;
    message: string;
}> {
    if (!adminDb) return { success: false, scans: [], promotions: [], message: 'Admin SDK not initialized' };

    const collections = getArenaCollections(assetClass);
    const arenaDoc = await adminDb.collection(collections.config).doc(userId).get();
    if (!arenaDoc.exists) return { success: false, scans: [], promotions: [], message: `${assetClass} arena not found` };

    const arena = arenaDoc.data() as any;
    if (!arena?.initialized) return { success: false, scans: [], promotions: [], message: `${assetClass} arena not initialized` };

    const currency = getCurrencySymbol(assetClass);
    const universe = getWatchlist(assetClass);
    const now = new Date();

    console.log(`[IntelScanner:${assetClass}] Starting ${scanType} scan — ${universe.length} instruments in universe`);

    // 1. Fetch prices for entire universe
    const prices = await fetchUniversePrices(universe, assetClass);
    const pricedTickers = Object.keys(prices).filter(t => prices[t].price > 0);
    console.log(`[IntelScanner:${assetClass}] Got prices for ${pricedTickers.length}/${universe.length} instruments`);

    if (pricedTickers.length === 0) {
        return { success: false, scans: [], promotions: [], message: 'No prices available' };
    }

    // 2. Fetch news for top movers (limit to top 30 by absolute price change to conserve API)
    const sortedByMovement = [...pricedTickers].sort((a, b) =>
        Math.abs(prices[b].change24h) - Math.abs(prices[a].change24h)
    );
    const newsTargets = sortedByMovement.slice(0, 30);
    const allNews = await fetchNewsForUniverse(newsTargets, assetClass);

    // 3. Fetch technicals for same top movers
    const techResults: Record<string, any> = {};
    const techPromises = newsTargets.slice(0, 20).map(async (ticker) => {
        try {
            const eodhdTicker = formatEODHDTicker(ticker, assetClass);
            const candles = await fetch5mCandles(ticker, eodhdTicker);
            if (candles.length > 0) {
                techResults[ticker] = computeTechnicalIndicators(ticker, candles, prices[ticker].price);
            }
        } catch { /* non-fatal */ }
    });
    await Promise.all(techPromises);

    // 4. Track which tickers are already assigned to pools
    const assignedTickers = new Set<string>(
        arena.pools.flatMap((p: ArenaPool) => p.tokens.map((t: string) => t.toUpperCase()))
    );

    // 5. Score every instrument in the universe
    const allCandidates: ScanCandidate[] = [];
    for (const ticker of pricedTickers) {
        const p = prices[ticker];
        const news = allNews[ticker] || [];
        const tech = techResults[ticker] || null;

        const { score: newsScore, headlines } = computeNewsCatalystScore(news);
        const techScore = computeTechnicalScore(ticker, tech);
        const valueScore = computeValueScore(p.price, p.change24h, tech);
        const macroScore = computeMacroScore(assetClass, p.change24h);
        const compositeScore = newsScore + techScore + valueScore + macroScore;

        const displayName = (assetClass === 'COMMODITIES' && COMMODITIES_DISPLAY_NAMES[ticker])
            ? COMMODITIES_DISPLAY_NAMES[ticker]
            : ticker;

        allCandidates.push({
            ticker,
            displayName,
            price: p.price,
            change24h: p.change24h,
            volume: p.volume,
            newsCatalystScore: newsScore,
            technicalScore: techScore,
            valueScore: valueScore,
            macroScore: macroScore,
            compositeScore,
            newsHeadlines: headlines,
            technicalSummary: tech ? formatTechnicalDataForPrompt(tech) : 'No technical data available',
            aiSummary: '', // Filled by AI deep analysis below
        });
    }

    // Sort by composite score (descending)
    allCandidates.sort((a, b) => b.compositeScore - a.compositeScore);

    // 6. Per pool: select Top 10 candidates (excluding already-assigned tickers)
    const scans: IntelligenceScanResult[] = [];
    const promotions: Array<{ poolId: string; inTicker: string; outTicker?: string; reason: string }> = [];

    for (const pool of arena.pools as ArenaPool[]) {
        if (pool.status !== 'ACTIVE') continue;

        // Filter candidates: not already in ANY pool
        const eligibleCandidates = allCandidates
            .filter(c => !assignedTickers.has(c.ticker))
            .slice(0, 10);

        if (eligibleCandidates.length === 0) {
            console.log(`[IntelScanner:${assetClass}] ${pool.emoji} ${pool.name}: No eligible candidates (all assigned)`);
            continue;
        }

        // COST SAVING: AI deep analysis temporarily disabled per March 27 Spend Cap Emergency
        /*
        for (const candidate of eligibleCandidates.slice(0, 1)) {
            try {
                const prompt = `You are a ${assetClass === 'FTSE' ? 'FTSE UK equity analyst' : assetClass === 'NYSE' ? 'US equity strategist' : 'commodity research analyst'}.

INSTRUMENT: ${candidate.displayName} (${candidate.ticker})
Price: ${currency}${candidate.price.toFixed(2)} | 24h: ${candidate.change24h >= 0 ? '+' : ''}${candidate.change24h.toFixed(2)}%

${candidate.newsHeadlines.length > 0 ? `RECENT NEWS:\n${candidate.newsHeadlines.map(h => `- ${h}`).join('\n')}` : 'No recent news.'}

${candidate.technicalSummary}

SCORING BREAKDOWN:
- News Catalyst: ${candidate.newsCatalystScore}/25
- Technical: ${candidate.technicalScore}/25
- Value: ${candidate.valueScore}/25
- Macro: ${candidate.macroScore}/25
- COMPOSITE: ${candidate.compositeScore}/100

Provide a 2-3 sentence analysis of this instrument's near-term outlook (1-5 day horizon). Focus on the key catalyst, risk, and whether this is a strong candidate for active trading. Be specific and actionable.

Respond with ONLY the text analysis, no JSON, no markdown.`;

                const summary = await generateContentWithFallback(prompt);
                if (summary) candidate.aiSummary = summary.trim().substring(0, 500);
            } catch { }
        }
        */

        const scanId = `${assetClass}-${pool.poolId}-${scanType}-${now.toISOString().slice(0, 10)}`;
        const scanResult: IntelligenceScanResult = {
            scanId,
            arena: assetClass,
            scanType,
            scanTimestamp: now.toISOString(),
            poolId: pool.poolId,
            universeSize: pricedTickers.length,
            topCandidates: eligibleCandidates,
            promotionCandidates: [],
            confirmed: false,
        };

        // ── EVENING: Dual Confirmation Gate + Promotion ─────────────────────
        if (scanType === 'EVENING') {
            const morningScan = pool.lastMorningScan;

            if (morningScan && morningScan.topCandidates.length > 0) {
                // Find candidates that appeared in BOTH AM and PM top 10
                const amTickers = new Set(morningScan.topCandidates.map(c => c.ticker));
                const confirmedCandidates = eligibleCandidates
                    .filter(c => amTickers.has(c.ticker))
                    .sort((a, b) => {
                        const amA = morningScan.topCandidates.find(m => m.ticker === a.ticker);
                        const amB = morningScan.topCandidates.find(m => m.ticker === b.ticker);
                        const avgA = (a.compositeScore + (amA?.compositeScore ?? 0)) / 2;
                        const avgB = (b.compositeScore + (amB?.compositeScore ?? 0)) / 2;
                        return avgB - avgA;
                    })
                    .slice(0, 2); // Top 2 confirmed candidates

                scanResult.promotionCandidates = confirmedCandidates.map(c => c.ticker);
                scanResult.confirmed = confirmedCandidates.length > 0;

                // Check promotion cooldown (24h between promotions per pool)
                const lastPromo = pool.lastPromotionAt;
                const hoursSincePromo = lastPromo
                    ? (now.getTime() - new Date(lastPromo).getTime()) / (1000 * 60 * 60)
                    : Infinity;

                if (hoursSincePromo < 24) {
                    console.log(`[IntelScanner:${assetClass}] ${pool.emoji} ${pool.name}: Promotion cooldown (${hoursSincePromo.toFixed(1)}h < 24h)`);
                } else {
                    // Execute promotions
                    for (const candidate of confirmedCandidates) {
                        if (assignedTickers.has(candidate.ticker)) continue;

                        const amCandidate = morningScan.topCandidates.find(c => c.ticker === candidate.ticker);
                        const amScore = amCandidate?.compositeScore ?? 0;

                        // Minimum composite threshold: avg of AM+PM must be >= 55
                        const avgScore = (candidate.compositeScore + amScore) / 2;
                        if (avgScore < 55) {
                            console.log(`[IntelScanner:${assetClass}] ${pool.emoji} ${candidate.ticker}: Confirmed but avg score ${avgScore.toFixed(0)} < 55. Skipping.`);
                            continue;
                        }

                        // Determine which existing ticker to replace (if any)
                        let outTicker: string | undefined;
                        let replacementReason: string | undefined;

                        // Find worst-performing ticker in pool
                        let worstPnl = Infinity;
                        let worstTicker: string | null = null;
                        for (const pTicker of pool.tokens) {
                            const upper = pTicker.toUpperCase();
                            const holding = pool.holdings[upper];
                            if (!holding || holding.amount <= 0) {
                                // Empty slot — use it without replacing
                                const idleDays = pool.consecutiveIdleDays?.[upper] ?? 0;
                                if (idleDays >= 2) {
                                    outTicker = upper;
                                    replacementReason = `Idle for ${idleDays} sessions with no position. Replaced by stronger Intelligence Scanner candidate.`;
                                    break;
                                }
                            } else {
                                const livePrice = prices[upper]?.price ?? holding.averagePrice;
                                const pnl = ((livePrice - holding.averagePrice) / holding.averagePrice) * 100;
                                if (pnl < worstPnl) {
                                    worstPnl = pnl;
                                    worstTicker = upper;
                                }
                            }
                        }

                        // Only replace a held position if it's losing > 5% and held > 3 days
                        if (!outTicker && worstTicker && worstPnl < -5) {
                            const holding = pool.holdings[worstTicker];
                            const holdHours = holding?.boughtAt
                                ? (now.getTime() - new Date(holding.boughtAt).getTime()) / (1000 * 60 * 60)
                                : 0;
                            if (holdHours > 72) {
                                outTicker = worstTicker;
                                replacementReason = `Underperforming at ${worstPnl.toFixed(1)}% over ${(holdHours / 24).toFixed(0)} days. Replaced by Intelligence Scanner candidate with avg score ${avgScore.toFixed(0)}.`;
                            }
                        }

                        if (!outTicker) {
                            console.log(`[IntelScanner:${assetClass}] ${pool.emoji} ${pool.name}: No slot available for ${candidate.ticker}. All positions healthy.`);
                            continue;
                        }

                        // ── EXECUTE PROMOTION ────────────────────────────────────
                        const tokenIdx = pool.tokens.findIndex((t: string) => t.toUpperCase() === outTicker);
                        if (tokenIdx === -1) continue;

                        // Swap ticker
                        (pool.tokens as string[])[tokenIdx] = candidate.ticker;

                        // Clear stale data for old ticker
                        if (pool.scoreHistory?.[outTicker!]) delete pool.scoreHistory[outTicker!];
                        if (pool.lastEvaluatedAt?.[outTicker!]) delete pool.lastEvaluatedAt[outTicker!];
                        if (pool.consecutiveIdleDays?.[outTicker!]) delete pool.consecutiveIdleDays[outTicker!];

                        // Init new ticker state
                        if (!pool.consecutiveIdleDays) pool.consecutiveIdleDays = {};
                        pool.consecutiveIdleDays[candidate.ticker] = 0;

                        // Also record as a PoolRotationEvent for backward compat with Scenario C audit trail
                        const rotationEvent: PoolRotationEvent = {
                            rotatedAt: now.toISOString(),
                            outTicker: outTicker!,
                            inTicker: candidate.ticker,
                            idleDays: pool.consecutiveIdleDays?.[outTicker!] ?? 0,
                            aiReasoning: `[Intelligence Scanner] ${candidate.aiSummary || candidateToSummary(candidate)}`,
                            priceContext: {
                                outTickerLast24h: prices[outTicker!]?.change24h ?? 0,
                                inTickerLast24h: candidate.change24h,
                            },
                        };
                        if (!pool.rotationHistory) pool.rotationHistory = [];
                        pool.rotationHistory.push(rotationEvent);
                        pool.lastRotationAt = now.toISOString();

                        // Record promotion event
                        const promoEvent: PoolPromotionEvent = {
                            promotedAt: now.toISOString(),
                            inTicker: candidate.ticker,
                            outTicker: outTicker,
                            replacementReason,
                            morningScore: amScore,
                            eveningScore: candidate.compositeScore,
                            newsContext: candidate.newsHeadlines.join(' | ') || 'No specific news catalyst',
                            aiReasoning: candidate.aiSummary || candidateToSummary(candidate),
                        };
                        if (!pool.promotionHistory) pool.promotionHistory = [];
                        pool.promotionHistory.push(promoEvent);
                        pool.lastPromotionAt = now.toISOString();

                        // Update assigned tickers
                        assignedTickers.delete(outTicker!);
                        assignedTickers.add(candidate.ticker);

                        promotions.push({
                            poolId: pool.poolId,
                            inTicker: candidate.ticker,
                            outTicker,
                            reason: `Score: AM ${amScore} + PM ${candidate.compositeScore} = avg ${avgScore.toFixed(0)}. ${replacementReason || ''}`,
                        });

                        console.log(`[IntelScanner:${assetClass}] ✅ ${pool.emoji} PROMOTED: ${outTicker} → ${candidate.ticker} (avg score ${avgScore.toFixed(0)})`);
                        break; // Max 1 promotion per pool per cycle
                    }
                }
            } else {
                console.log(`[IntelScanner:${assetClass}] ${pool.emoji} ${pool.name}: No morning scan found for dual confirmation. PM scan recorded only.`);
            }
        }

        // Store scan result on pool
        if (scanType === 'MORNING') {
            pool.lastMorningScan = scanResult;
        } else {
            pool.lastEveningScan = scanResult;
        }

        scans.push(scanResult);
    }

    // ── Persist updated arena to Firestore ────────────────────────────────────
    try {
        // FETCH FRESH ARENA TO AVOID RACE CONDITIONS WITH CONCURRENT TRADING CYCLES
        const freshArenaDoc = await adminDb.collection(collections.config).doc(userId).get();
        if (freshArenaDoc.exists) {
            const freshArena = freshArenaDoc.data() as any;
            
            // Carefully merge ONLY the scan results and promotion history back into the fresh arena
            for (const updatedPool of arena.pools) {
                const freshPoolIdx = freshArena.pools.findIndex((p: any) => p.poolId === updatedPool.poolId);
                if (freshPoolIdx >= 0) {
                    const freshPool = freshArena.pools[freshPoolIdx];
                    if (scanType === 'MORNING') {
                        freshPool.lastMorningScan = updatedPool.lastMorningScan;
                    } else {
                        freshPool.lastEveningScan = updatedPool.lastEveningScan;
                    }
                    if (updatedPool.lastRotationAt) freshPool.lastRotationAt = updatedPool.lastRotationAt;
                    if (updatedPool.lastPromotionAt) freshPool.lastPromotionAt = updatedPool.lastPromotionAt;
                    if (updatedPool.rotationHistory) freshPool.rotationHistory = updatedPool.rotationHistory;
                    if (updatedPool.promotionHistory) freshPool.promotionHistory = updatedPool.promotionHistory;
                    if (updatedPool.consecutiveIdleDays) freshPool.consecutiveIdleDays = updatedPool.consecutiveIdleDays;
                    // Most importantly, the tokens list might have been updated by promotion
                    freshPool.tokens = updatedPool.tokens;
                }
            }
            await adminDb.collection(collections.config).doc(userId).set(freshArena);
        } else {
            await adminDb.collection(collections.config).doc(userId).set(arena);
        }
        
        console.log(`[IntelScanner:${assetClass}] ✅ ${scanType} scan complete. ${scans.length} pools scanned, ${promotions.length} promotion(s).`);
    } catch (e: any) {
        console.error(`[IntelScanner:${assetClass}] Failed to persist scan results: ${e.message}`);
    }

    // ── Telegram notification ─────────────────────────────────────────────────
    try {
        const emoji = scanType === 'MORNING' ? '☀️' : '🌙';
        let msg = `${emoji} <b>${assetClass} INTELLIGENCE SCANNER — ${scanType}</b>\n`;
        msg += `📅 ${now.toLocaleDateString('en-GB')} | Universe: ${pricedTickers.length} instruments\n\n`;

        for (const scan of scans) {
            const pool = arena.pools.find((p: ArenaPool) => p.poolId === scan.poolId);
            msg += `📊 <b>${pool?.name || scan.poolId} ${pool?.emoji || ''}</b>\n`;
            msg += `Top 3: ${scan.topCandidates.slice(0, 3).map(c =>
                `${c.ticker} (${c.compositeScore})`
            ).join(', ')}\n`;

            if (scan.confirmed && scan.promotionCandidates.length > 0) {
                msg += `✅ <b>CONFIRMED:</b> ${scan.promotionCandidates.join(', ')}\n`;
            }
            msg += '\n';
        }

        if (promotions.length > 0) {
            msg += `🔄 <b>PROMOTIONS:</b>\n`;
            for (const p of promotions) {
                msg += `  ${p.outTicker ? `<s>${p.outTicker}</s> → ` : ''}<b>${p.inTicker}</b> (${p.poolId})\n`;
            }
        }

        await sendSystemAlert(`${assetClass} Intelligence ${scanType}`, msg, emoji);
    } catch { /* non-fatal */ }

    return {
        success: true,
        scans,
        promotions,
        message: `${scanType} scan complete: ${scans.length} pools, ${promotions.length} promotion(s)`,
    };
}

// ─── HELPER ──────────────────────────────────────────────────────────────────

function candidateToSummary(c: ScanCandidate): string {
    return `${c.displayName} (${c.ticker}) — Composite: ${c.compositeScore}/100 [News: ${c.newsCatalystScore}, Technical: ${c.technicalScore}, Value: ${c.valueScore}, Macro: ${c.macroScore}]. ${c.newsHeadlines[0] || 'No specific news catalyst.'}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH LATEST SCAN RESULTS (for dashboard display)
// ═══════════════════════════════════════════════════════════════════════════

export async function getLatestScanResults(
    userId: string,
    assetClass: Exclude<AssetClass, 'CRYPTO'>,
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
    if (!adminDb) return { pools: [] };

    const collections = getArenaCollections(assetClass);
    const doc = await adminDb.collection(collections.config).doc(userId).get();
    if (!doc.exists) return { pools: [] };

    const arena = doc.data() as any;
    if (!arena?.initialized) return { pools: [] };

    return {
        pools: (arena.pools as ArenaPool[]).map(pool => ({
            poolId: pool.poolId,
            poolName: pool.name,
            emoji: pool.emoji,
            morningScan: pool.lastMorningScan || null,
            eveningScan: pool.lastEveningScan || null,
            promotions: (pool.promotionHistory || []).slice(-5), // last 5 promotions
        })),
    };
}
