/**
 * FULL RESET: Sync with Revolut + restart 28-day competition cycle.
 *
 * What this does:
 *   1. Queries Revolut for ALL actual cash + crypto holdings
 *   2. Rebuilds pool holdings to match Revolut exactly
 *   3. Distributes legacy tokens (ADA→Pool3, AVAX→Pool4) and corrects amounts
 *   4. Sets new budget per pool = actual value of pool contents at current prices
 *   5. Resets all performance, score history, sell cooldowns, GPM state
 *   6. Sets new 28-day competition window starting NOW
 *   7. Records benchmark prices for BTC comparison
 *   8. Clears DCA fields (shared reserve starts at $0)
 *   9. Archives old trades (keeps them but new cycle starts fresh)
 *
 * Run: npx tsx scripts/reset_competition.ts          (dry run)
 *      npx tsx scripts/reset_competition.ts --apply   (apply changes)
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
const DRY_RUN = !process.argv.includes('--apply');

function fmt(n: number) { return '$' + n.toFixed(2); }

async function main() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`   COMPETITION RESET ${DRY_RUN ? '(DRY RUN)' : '🔴 APPLYING'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // ── 1. Load current arena ────────────────────────────────────────────
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data() as any;

    // ── 2. Query Revolut for actual state ─────────────────────────────────
    const configDoc = await db.collection('agent_configs').doc(USER_ID).get();
    const config = configDoc.data()!;
    const { RevolutX } = await import('../src/lib/revolut');
    const client = new RevolutX(
        config.revolutApiKey, config.revolutPrivateKey,
        config.revolutIsSandbox || false, config.revolutProxyUrl,
    );

    const balances = await client.getBalances();
    const revolutState: Record<string, number> = {};
    let revolutUsd = 0;

    for (const b of balances as any[]) {
        const currency = (b.currency || b.symbol || '').toUpperCase();
        const amount = parseFloat((b.available ?? b.balance ?? 0).toString());
        if (currency === 'USD') {
            revolutUsd = amount;
        } else if (amount > 0.00001) {
            revolutState[currency] = amount;
        }
    }

    console.log('REVOLUT STATE:');
    console.log(`  USD: ${fmt(revolutUsd)}`);
    for (const [t, a] of Object.entries(revolutState).sort()) {
        console.log(`  ${t}: ${a}`);
    }

    // ── 3. Get current market prices ──────────────────────────────────────
    // Fetch from CoinGecko-style via our price service
    const { getVerifiedPrices } = await import('../src/app/actions');
    const allTokens = [...Object.keys(revolutState), 'BTC'];
    const prices = await getVerifiedPrices(allTokens);
    
    console.log('\nCURRENT PRICES:');
    for (const [t, p] of Object.entries(prices).sort()) {
        console.log(`  ${t}: $${(p as any).price?.toFixed(4) || '?'}`);
    }

    // ── 4. New pool layout ───────────────────────────────────────────────
    // Keep existing pool assignments + add legacy tokens
    // Pool 1: XRP + BNB (XRP amount corrected to full Revolut)
    // Pool 2: LINK + AAVE (AAVE amount corrected to full Revolut)
    // Pool 3: DOT + ADA (ADA is legacy, added here)
    // Pool 4: SOL + AVAX (AVAX is legacy, added here)
    const poolAssignments: Record<string, { tokens: [string, string], emoji: string, name: string }> = {
        POOL_1: { tokens: ['XRP', 'BNB'], emoji: '🚀', name: 'Momentum Mavericks' },
        POOL_2: { tokens: ['LINK', 'AAVE'], emoji: '🐳', name: 'Deep Divers' },
        POOL_3: { tokens: ['DOT', 'ADA'], emoji: '⛵', name: 'Steady Sailers' },
        POOL_4: { tokens: ['SOL', 'AVAX'], emoji: '⚡', name: 'Agile Arbitrageurs' },
    };

    // ── 5. Build new pool states ─────────────────────────────────────────
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString();

    // Distribute cash equally across pools
    const cashPerPool = revolutUsd / 4;

    console.log('\n─── NEW POOL CONFIGURATION ───');
    const newPools: any[] = [];
    let totalNewValue = 0;

    for (const [poolId, assignment] of Object.entries(poolAssignments)) {
        const oldPool = arena.pools.find((p: any) => p.poolId === poolId);
        
        // Build holdings from Revolut actual amounts
        const holdings: Record<string, any> = {};
        let holdingsValue = 0;

        for (const token of assignment.tokens) {
            const revAmount = revolutState[token] ?? 0;
            const price = (prices[token] as any)?.price ?? 0;
            
            if (revAmount > 0 && price > 0) {
                holdings[token] = {
                    amount: revAmount,
                    averagePrice: price,  // Use current price as cost basis (fresh start)
                    peakPrice: price,
                    peakPnlPct: 0,
                    boughtAt: startDate,
                    gpmZone: 'CONVICTION',
                    gpmZoneConsecutiveCycles: 0,
                };
                holdingsValue += revAmount * price;
            }
        }

        const poolTotal = cashPerPool + holdingsValue;
        totalNewValue += poolTotal;

        const newPool = {
            poolId,
            name: assignment.name,
            emoji: assignment.emoji,
            tokens: assignment.tokens,
            strategy: oldPool?.strategy || {
                buyScoreThreshold: 75,
                exitThreshold: 40,
                momentumGateEnabled: true,
                momentumGateThreshold: -3,
                minOrderAmount: 10,
                antiWashHours: 24,
                reentryPenalty: 5,
                positionStopLoss: -8,
                maxAllocationPerToken: poolTotal * 0.45,
                takeProfitTarget: 3,
                trailingStopPct: 2,
                minWinPct: 0.5,
                description: oldPool?.strategy?.description || 'AI-managed trading strategy',
            },
            budget: poolTotal,
            cashBalance: cashPerPool,
            holdings,
            performance: {
                startDate,
                totalPnl: 0,
                totalPnlPct: 0,
                winCount: 0,
                lossCount: 0,
                totalTrades: 0,
                bestTrade: null,
                worstTrade: null,
                dailySnapshots: [],
            },
            createdAt: startDate,
            status: 'ACTIVE',
            selectionReasoning: oldPool?.selectionReasoning || 'Carried forward from previous cycle',
            weeklyReviews: [],
            strategyHistory: [],
            lastSoldAt: {},
            lastStopLossedAt: {},
            stopLossExitPrices: {},
            scoreHistory: {},
            lastEvaluatedAt: {},
            dcaReserve: 0,
            dcaContributions: 0,
            dcaDeployedTotal: 0,
            consecutiveIdleDays: {},
        };

        // Update maxAllocationPerToken to reflect new budget
        newPool.strategy.maxAllocationPerToken = poolTotal * 0.45;

        newPools.push(newPool);

        console.log(`\n  ${assignment.emoji} ${assignment.name}`);
        console.log(`    Cash: ${fmt(cashPerPool)}`);
        for (const [t, h] of Object.entries(holdings)) {
            const hd = h as any;
            const val = hd.amount * hd.averagePrice;
            console.log(`    ${t}: ${hd.amount.toFixed(8)} @ ${fmt(hd.averagePrice)} = ${fmt(val)}`);
        }
        console.log(`    Budget: ${fmt(poolTotal)}`);
    }

    console.log(`\n  TOTAL NAV: ${fmt(totalNewValue)}`);
    console.log(`  Revolut total: ${fmt(revolutUsd + Object.entries(revolutState).reduce((s, [t, a]) => s + a * ((prices[t] as any)?.price || 0), 0))}`);

    // ── 6. Build new arena config ────────────────────────────────────────
    const btcPrice = (prices['BTC'] as any)?.price || 0;

    const { FieldValue } = await import('firebase-admin/firestore');

    const newArena = {
        ...arena,
        startDate,
        endDate,
        currentWeek: 1,
        pools: newPools,
        tokensLocked: true,
        totalBudget: totalNewValue,
        initialized: true,
        benchmarkStartPrices: {
            BTC: btcPrice,
            XRP: (prices['XRP'] as any)?.price || 0,
            recordedAt: startDate,
        },
        btcDailyPrices: btcPrice > 0 ? {
            [now.toISOString().slice(0, 10)]: {
                open: btcPrice,
                close: btcPrice,
                high: btcPrice,
                low: btcPrice,
            },
        } : {},
        // Reset DCA
        sharedDcaReserve: 0,
        sharedDcaContributions: 0,
        sharedDcaDeployed: 0,
        lastRevolutSyncAt: startDate,
    };

    // Remove stale fields that shouldn't carry over
    delete newArena.completedAt;
    delete newArena.competitionMode;
    delete newArena.sandboxMode;

    console.log('\n─── COMPETITION SETTINGS ───');
    console.log(`  Start: ${startDate}`);
    console.log(`  End:   ${endDate}`);
    console.log(`  BTC benchmark: $${btcPrice.toFixed(2)}`);
    console.log(`  DCA: Shared reserve, $60/Saturday, starts at $0`);

    if (DRY_RUN) {
        console.log('\n══════════════════════════════════════════');
        console.log('  DRY RUN — no changes applied.');
        console.log('  Run with --apply to execute.');
        console.log('══════════════════════════════════════════\n');
    } else {
        // ── 7. Apply changes ─────────────────────────────────────────────
        console.log('\n🔴 APPLYING CHANGES...\n');

        // Save new arena config
        await db.collection('arena_config').doc(USER_ID).set(newArena);
        console.log('  ✅ Arena config updated');

        // Reset DCA config
        await db.collection('dca_config').doc(USER_ID).set({
            enabled: true,
            weeklyAmount: 60,
            totalDeposited: 0,
            totalDeployed: 0,
            history: [],
            lastDepositDate: null,
        }, { merge: false });
        console.log('  ✅ DCA config reset');

        // Clear daily snapshots collection for this user
        const snapshots = await db.collection('arena_snapshots').where('userId', '==', USER_ID).get();
        if (!snapshots.empty) {
            const batch = db.batch();
            snapshots.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log(`  ✅ Cleared ${snapshots.size} old snapshots`);
        }

        // Clear strategy reports
        await db.collection('arena_reports').doc(USER_ID).delete().catch(() => {});
        await db.collection('arena_weekly_reports').doc(USER_ID).delete().catch(() => {});
        console.log('  ✅ Cleared strategy/weekly reports');

        console.log('\n══════════════════════════════════════════');
        console.log('  ✅ COMPETITION RESET COMPLETE');
        console.log(`  New 28-day cycle: ${now.toISOString().slice(0, 10)} → ${new Date(now.getTime() + 28 * 86400000).toISOString().slice(0, 10)}`);
        console.log('  All holdings synced with Revolut');
        console.log('  Performance counters zeroed');
        console.log('  DCA shared reserve ready ($60/Saturday)');
        console.log('══════════════════════════════════════════\n');
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
