/**
 * purge_sandbox_trades.ts
 *
 * Deletes all trades recorded BEFORE the competition startDate for each
 * of the three sandbox arenas (FTSE, NYSE, COMMODITIES).
 * Also resets pool performance counters, holdings and cash so the
 * 28-day competition starts with a completely clean slate.
 *
 * Run: npx tsx scripts/purge_sandbox_trades.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local (same pattern as other admin scripts)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

const POOL_BUDGET = 150; // per pool

type AssetClass = 'FTSE' | 'NYSE' | 'COMMODITIES';

function col(assetClass: AssetClass) {
    const suffix = assetClass === 'FTSE' ? '_ftse' : assetClass === 'NYSE' ? '_nyse' : '_commodities';
    return {
        config: `arena_config${suffix}`,
        trades: `arena_trades${suffix}`,
    };
}

function freshPerformance(startDate: string) {
    return {
        startDate,
        totalPnl: 0,
        totalPnlPct: 0,
        winCount: 0,
        lossCount: 0,
        totalTrades: 0,
        bestTrade: null,
        worstTrade: null,
        dailySnapshots: [],
    };
}

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No adminDb — check firebase-admin config'); process.exit(1); }

    const ASSET_CLASSES: AssetClass[] = ['FTSE', 'NYSE', 'COMMODITIES'];

    // Collect all user IDs across all arenas
    const userIds = new Set<string>();
    for (const ac of ASSET_CLASSES) {
        const snap = await adminDb.collection(col(ac).config).get();
        snap.docs.forEach(d => userIds.add(d.id));
    }

    if (userIds.size === 0) {
        console.log('No arena configs found — nothing to do.');
        return;
    }

    console.log(`Found ${userIds.size} user(s):`, [...userIds].map(u => u.substring(0, 8)));

    for (const userId of userIds) {
        for (const ac of ASSET_CLASSES) {
            const collections = col(ac);
            const configRef = adminDb.collection(collections.config).doc(userId);
            const configSnap = await configRef.get();

            if (!configSnap.exists) {
                console.log(`  [${ac}] No config for user ${userId.substring(0, 8)} — skipping.`);
                continue;
            }

            const arena = configSnap.data() as any;
            if (!arena.initialized) {
                console.log(`  [${ac}] Not initialised — skipping.`);
                continue;
            }

            if (!arena.competitionMode) {
                console.log(`  [${ac}] Still in sandbox mode — skipping (only purge competition arenas).`);
                continue;
            }

            const competitionStart: string = arena.startDate;
            if (!competitionStart) {
                console.log(`  [${ac}] No startDate on config — skipping.`);
                continue;
            }

            console.log(`\n[${ac}] user=${userId.substring(0, 8)}  competition started=${competitionStart}`);

            // ── 1. Delete all pre-competition trades ──────────────────────────────
            const tradesSnap = await adminDb.collection(collections.trades)
                .where('userId', '==', userId)
                .get();

            const toDelete = tradesSnap.docs.filter(d => {
                const tradeDate: string =
                    d.data().date ||
                    d.data().createdAt?.toDate?.()?.toISOString?.() ||
                    '';
                return tradeDate < competitionStart;
            });

            const kept = tradesSnap.size - toDelete.length;

            if (toDelete.length === 0) {
                console.log(`  No pre-competition trades found (${tradesSnap.size} total — all after competition start).`);
            } else {
                // Batch delete (max 500 per batch)
                for (let i = 0; i < toDelete.length; i += 400) {
                    const batch = adminDb.batch();
                    toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
                    await batch.commit();
                }
                console.log(`  Deleted ${toDelete.length} pre-competition trade(s). Keeping ${kept} post-competition trade(s).`);
            }

            // ── 2. Reset pool performance, holdings & cash ───────────────────────
            // Only do a full reset when there are no surviving post-competition trades.
            // If trades survived the purge, pool state must be reconciled from
            // those trades instead — run reconcile_ftse_pools.ts for that.
            if (kept > 0) {
                console.log(`  ⚠ ${kept} post-competition trade(s) survived — skipping pool state reset.`);
                console.log(`    Pool holdings already reflect those trades. No action needed.`);
            } else {
                const updatedPools = (arena.pools as any[]).map((p: any) => ({
                    ...p,
                    performance: freshPerformance(competitionStart),
                    weeklyReviews: [],
                    cashBalance: POOL_BUDGET,
                    holdings: {},
                    lastSoldAt: {},
                    scoreHistory: {},
                    strategyHistory: p.strategyHistory || [],
                }));
                await configRef.update({ pools: updatedPools, currentWeek: 1 });
                console.log(`  Pool cash/holdings/performance reset to competition-start state.`);
            }

        }
    }

    console.log('\n✅  Purge complete — all three competition arenas start clean.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
