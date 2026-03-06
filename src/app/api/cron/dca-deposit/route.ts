/**
 * DCA DEPOSIT CRON — Every Saturday at 09:05 UTC
 * Schedule: 5 9 * * 6
 *
 * Triggered just after the user's £60 Revolut auto-transfer lands at 9am.
 * Evaluates market conditions, asks the strategy AI to split the $60
 * across the 4 pools, then credits each pool's ring-fenced dcaReserve.
 *
 * The AI makes the deployment decision (score ≥ 85 / full deploy at ≥ 90)
 * inside the normal 3-minute arena cron — this cron ONLY credits the reserve.
 *
 * Market condition gate (DCA only runs while market is depressed):
 *   ACTIVE if ANY of:
 *     - Fear & Greed Index ≤ 40 (Fear / Extreme Fear)
 *     - BTC 30-day return ≤ -10%
 *     - Total portfolio NAV < 95% of totalInvested
 *
 *   AUTO-PAUSES when ALL three flip positive (market recovered).
 *   AUTO-RESTARTS when bear conditions return.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getArenaConfig, creditDcaReserve, getDcaConfig } from '@/services/arenaService';
import { getPoolTotalValue } from '@/services/arenaService';
import type { PoolId } from '@/lib/constants';

const CRON_SECRET = process.env.CRON_SECRET || '';
const EODHD_API_KEY = process.env.EODHD_API_KEY || '';

const DCA_WEEKLY_AMOUNT = 60;
const DCA_MARKET_FNG_THRESHOLD = 40;          // Active if FNG ≤ this
const DCA_MARKET_BTC30D_THRESHOLD = -10;      // Active if BTC 30d ≤ this (%)
const DCA_MARKET_NAV_THRESHOLD = 0.95;         // Active if NAV/invested ≤ this

export async function GET(req: NextRequest) {
    // ── Auth ────────────────────────────────────────────────────────────────
    const secret = req.headers.get('authorization')?.replace('Bearer ', '');
    if (secret !== CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const results: Record<string, any> = {};

    try {
        // ── 1. Load all active users with DCA enabled ────────────────────────
        const dcaSnap = await adminDb.collection('dca_config')
            .where('enabled', '==', true)
            .get();

        if (dcaSnap.empty) {
            console.log('[DCA Cron] No users with DCA enabled.');
            return NextResponse.json({ success: true, message: 'No DCA users configured.' });
        }

        // ── 2. Fetch market conditions once (shared across all users) ───────
        const marketCondition = await fetchMarketConditions();
        const dcaActive = isDcaMarketActive(marketCondition);

        console.log(`[DCA Cron] Market condition: FNG=${marketCondition.fng}, BTC30d=${marketCondition.btc30d.toFixed(1)}%, DCA=${dcaActive ? 'ACTIVE' : 'PAUSED'}`);

        // ── 3. Process each user ─────────────────────────────────────────────
        for (const doc of dcaSnap.docs) {
            const userId = doc.id;
            const dcaConfig = doc.data();

            try {
                // Idempotency guard — don't double-credit if cron runs twice
                if (dcaConfig.lastDepositDate === today) {
                    console.log(`[DCA Cron] ${userId.substring(0, 8)} already credited today — skipping`);
                    results[userId.substring(0, 8)] = { skipped: 'already_credited_today' };
                    continue;
                }

                const arena = await getArenaConfig(userId, 'CRYPTO');
                if (!arena?.initialized) {
                    results[userId.substring(0, 8)] = { skipped: 'arena_not_initialized' };
                    continue;
                }

                const activePools = arena.pools.filter(p => p.status === 'ACTIVE');
                if (activePools.length === 0) {
                    results[userId.substring(0, 8)] = { skipped: 'no_active_pools' };
                    continue;
                }

                // Calculate NAV vs invested for this user's market condition check
                const prices = await fetchLatestPrices(arena);
                const totalNAV = arena.pools.reduce((sum, p) => sum + getPoolTotalValue(p, prices), 0);
                const totalInvested = arena.pools.reduce((sum, p) => sum + p.budget + (p.dcaContributions ?? 0), 0);
                const navRatio = totalInvested > 0 ? totalNAV / totalInvested : 1;
                const userMarketCondition = { ...marketCondition, navVsInvested: navRatio };
                const userDcaActive = dcaActive || navRatio < DCA_MARKET_NAV_THRESHOLD;

                if (!userDcaActive) {
                    // Market has recovered — auto-pause
                    await adminDb.collection('dca_config').doc(userId).set({
                        pausedAt: now.toISOString(),
                        pauseReason: `Market recovered: FNG=${marketCondition.fng}, BTC30d=${marketCondition.btc30d.toFixed(1)}%, NAV=${(navRatio * 100).toFixed(1)}%`,
                        lastDepositDate: today, // Mark today so we don't keep checking
                    }, { merge: true });

                    const message = `⏸️ DCA skipped — market has recovered.\nFear & Greed: ${marketCondition.fng}/100\nBTC 30d: ${marketCondition.btc30d.toFixed(1)}%\nPortfolio: ${(navRatio * 100).toFixed(1)}% of invested capital\n\nWatching for re-entry into bear conditions.`;
                    await sendTelegramAlert(userId, message);

                    results[userId.substring(0, 8)] = { paused: true, reason: 'market_recovered' };
                    continue;
                }

                // ── 4. Ask AI to decide pool split ───────────────────────────
                const split = await aiDecidePoolSplit(arena, activePools.length, DCA_WEEKLY_AMOUNT, prices);

                // ── 5. Credit each pool's dcaReserve ────────────────────────
                const credited: Record<string, number> = {};
                for (const pool of activePools) {
                    const amount = split[pool.poolId] ?? 0;
                    if (amount <= 0) continue;

                    await creditDcaReserve(userId, pool.poolId as PoolId, amount, userMarketCondition);
                    credited[pool.poolId] = amount;
                }

                // ── 6. Send Telegram summary ─────────────────────────────────
                const splitLines = Object.entries(credited)
                    .map(([pid, amt]) => {
                        const p = arena.pools.find(x => x.poolId === pid);
                        return `  ${p?.emoji ?? '●'} ${p?.name ?? pid}: +$${amt.toFixed(2)}`;
                    })
                    .join('\n');

                const message = [
                    `💰 *Weekly DCA Deposit — ${today}*`,
                    ``,
                    `Market Gate: ACTIVE ✅`,
                    `  Fear & Greed: ${marketCondition.fng}/100`,
                    `  BTC 30d: ${marketCondition.btc30d.toFixed(1)}%`,
                    `  Portfolio NAV: ${(navRatio * 100).toFixed(1)}% of invested`,
                    ``,
                    `$${DCA_WEEKLY_AMOUNT} credited (AI-decided split):`,
                    splitLines,
                    ``,
                    `AI will deploy when conviction score ≥ 85`,
                    `(Full reserve deploy at score ≥ 90)`,
                ].join('\n');

                await sendTelegramAlert(userId, message);

                results[userId.substring(0, 8)] = { credited, total: DCA_WEEKLY_AMOUNT };
                console.log(`[DCA Cron] ✅ ${userId.substring(0, 8)} credited $${DCA_WEEKLY_AMOUNT}: ${JSON.stringify(credited)}`);

            } catch (userErr: any) {
                console.error(`[DCA Cron] Error for ${userId.substring(0, 8)}: ${userErr.message}`);
                results[userId.substring(0, 8)] = { error: userErr.message };
            }
        }

        return NextResponse.json({ success: true, date: today, marketCondition, results });

    } catch (err: any) {
        console.error(`[DCA Cron] Fatal error: ${err.message}`);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

// ── Market Condition Helpers ───────────────────────────────────────────────

async function fetchMarketConditions(): Promise<{ fng: number; btc30d: number }> {
    let fng = 50; // Default neutral
    let btc30d = 0;

    // Fear & Greed Index
    try {
        const fngRes = await fetch('https://api.alternative.me/fng/?limit=1', { cache: 'no-store' });
        if (fngRes.ok) {
            const fngData = await fngRes.json();
            fng = parseInt(fngData.data?.[0]?.value ?? '50', 10);
        }
    } catch { /* use default */ }

    // BTC 30-day return via EODHD
    if (EODHD_API_KEY) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const from30 = now - 30 * 24 * 60 * 60;
            const url = `https://eodhd.com/api/intraday/BTC-USD.CC?api_token=${EODHD_API_KEY}&fmt=json&interval=1d&from=${from30}&to=${now}`;
            const btcRes = await fetch(url, { cache: 'no-store' });
            if (btcRes.ok) {
                const candles = await btcRes.json();
                if (Array.isArray(candles) && candles.length >= 2) {
                    const oldest = parseFloat(candles[0].close);
                    const newest = parseFloat(candles[candles.length - 1].close);
                    btc30d = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
                }
            }
        } catch { /* use default */ }
    }

    return { fng, btc30d };
}

function isDcaMarketActive(mc: { fng: number; btc30d: number }): boolean {
    return mc.fng <= DCA_MARKET_FNG_THRESHOLD || mc.btc30d <= DCA_MARKET_BTC30D_THRESHOLD;
}

// ── AI Pool Split ─────────────────────────────────────────────────────────

async function aiDecidePoolSplit(
    arena: any,
    activePoolCount: number,
    totalAmount: number,
    prices: Record<string, { price: number }>,
): Promise<Record<string, number>> {
    // Build a simple equal-fallback split in case AI is unavailable
    const equalSplit = Math.round((totalAmount / activePoolCount) * 100) / 100;
    const fallback: Record<string, number> = {};
    let remaining = totalAmount;
    const activePools = arena.pools.filter((p: any) => p.status === 'ACTIVE');
    activePools.forEach((p: any, i: number) => {
        fallback[p.poolId] = i === activePools.length - 1 ? Math.round(remaining * 100) / 100 : equalSplit;
        remaining -= equalSplit;
    });

    // Ask Gemini to recommend a split based on pool performance
    try {
        const { generateContentWithFallback } = await import('@/lib/gemini');

        const poolSummaries = activePools.map((p: any) => {
            const nav = getPoolTotalValue(p, prices);
            const reserve = p.dcaReserve ?? 0;
            return `${p.emoji} ${p.name} (${p.poolId}): NAV=$${nav.toFixed(2)}, P&L=${p.performance.totalPnlPct.toFixed(1)}%, DCA Reserve=$${reserve.toFixed(2)}`;
        }).join('\n');

        const prompt = `You are allocating a weekly $${totalAmount} DCA investment across ${activePoolCount} AI trading pools.

Pool status:
${poolSummaries}

Rules:
- Total must equal exactly $${totalAmount}
- Minimum $5 per pool, maximum $${totalAmount * 0.5} per pool
- Prefer pools with: lower reserves (capital is sitting idle), worse P&L (recovery focus), or better recent momentum
- Amounts in whole dollars (no cents needed)

Respond with ONLY a JSON object like: {"POOL_1": 18, "POOL_2": 12, "POOL_3": 18, "POOL_4": 12}`;

        const response = await generateContentWithFallback(prompt);
        const match = response.match(/\{[^}]+\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);
            // Validate total
            const total = Object.values(parsed as Record<string, number>).reduce((s, v) => s + v, 0);
            if (Math.abs(total - totalAmount) < 2) {
                return parsed as Record<string, number>;
            }
        }
    } catch (e: any) {
        console.warn(`[DCA Cron] AI split failed, using equal split: ${e.message}`);
    }

    return fallback;
}

// ── Price fetch (lightweight) ─────────────────────────────────────────────

async function fetchLatestPrices(arena: any): Promise<Record<string, { price: number }>> {
    const prices: Record<string, { price: number }> = {};
    if (!EODHD_API_KEY) return prices;

    const allTickers = [...new Set(arena.pools.flatMap((p: any) => p.tokens))] as string[];
    try {
        const primary = allTickers[0];
        const extras = allTickers.slice(1).join(',');
        const url = `https://eodhd.com/api/real-time/${primary}-USD.CC?s=${extras.split(',').filter(Boolean).map((t: string) => `${t}-USD.CC`).join(',')}&api_token=${EODHD_API_KEY}&fmt=json`;
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                const ticker = item.code?.replace('-USD.CC', '') ?? '';
                if (ticker) prices[ticker] = { price: parseFloat(item.close) || 0 };
            }
        }
    } catch { /* use empty prices */ }

    return prices;
}

// ── Telegram ──────────────────────────────────────────────────────────────

async function sendTelegramAlert(userId: string, message: string) {
    try {
        const { sendSystemAlert } = await import('@/services/telegramService');
        await sendSystemAlert('DCA Deposit', message, '💰');
    } catch { /* non-critical */ }
}
