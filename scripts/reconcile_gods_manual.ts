/**
 * GODS Reconciliation Script — Manual Account
 * 
 * Records the manually-purchased GODS position on Revolut X
 * into the POOL_MANUAL (Manual Madness) pool in Firestore.
 * 
 * Facts:
 *   - 4,015 GODS tokens bought on Revolut X
 *   - Average price: $0.03169
 *   - Total cost: 4015 × 0.03169 = $127.24
 * 
 * This script:
 *   1. Reads the current arena state
 *   2. Finds or creates the POOL_MANUAL pool
 *   3. Adds GODS holding with correct amount/avgPrice
 *   4. Deducts total cost from arena.sharedCash
 *   5. Records a trade record in arena_trades
 *   6. Runs full reconciliation against Revolut to verify
 * 
 * Usage:
 *   npx tsx scripts/reconcile_gods_manual.ts          # Dry run
 *   npx tsx scripts/reconcile_gods_manual.ts --apply   # Apply changes
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
const APPLY = process.argv.includes('--apply');

// ── GODS purchase details ─────────────────────────────────────────────────
const TICKER = 'GODS';
const AMOUNT = 4015;
const AVG_PRICE = 0.03169;
const TOTAL_COST = +(AMOUNT * AVG_PRICE).toFixed(2); // $127.24

function sep(c = '═', n = 72) { return c.repeat(n); }
function $$(n: number) { return `$${n.toFixed(2)}`; }

async function main() {
    console.log('\n' + sep());
    console.log('  GODS MANUAL PURCHASE — RECONCILIATION');
    console.log(sep());
    console.log(`\n  Ticker:     ${TICKER}`);
    console.log(`  Amount:     ${AMOUNT}`);
    console.log(`  Avg Price:  $${AVG_PRICE}`);
    console.log(`  Total Cost: ${$$(TOTAL_COST)}`);
    console.log(`  Mode:       ${APPLY ? '🔧 APPLY' : '👀 DRY RUN'}`);

    // ── 1. Load arena state ───────────────────────────────────────────────
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data();
    if (!arena?.pools) {
        console.error('\n  ❌ No arena found. Aborting.');
        process.exit(1);
    }

    const sharedCashBefore = arena.sharedCash ?? 0;
    console.log(`\n  Arena shared cash (before): ${$$(sharedCashBefore)}`);

    // ── 2. Find or create POOL_MANUAL ─────────────────────────────────────
    let manualPoolIdx = arena.pools.findIndex((p: any) => p.poolId === 'POOL_MANUAL');
    
    if (manualPoolIdx === -1) {
        console.log('  📦 Creating POOL_MANUAL (Manual Madness)...');
        const now = new Date().toISOString();
        const newPool = {
            poolId: 'POOL_MANUAL',
            name: 'MANUAL MADNESS',
            emoji: '🔥',
            tokens: [],
            strategy: {
                buyScoreThreshold: 70,
                exitThreshold: 50,
                momentumGateEnabled: true,
                momentumGateThreshold: 1.5,
                minOrderAmount: 10,
                antiWashHours: 24,
                reentryPenalty: 5,
                positionStopLoss: -15,
                maxAllocationPerToken: 300,
                takeProfitTarget: 5,
                trailingStopPct: 2,
                minWinPct: 0.5,
                description: "MANUAL MADNESS: User-directed tactical entries following standard SQ execution & tracking rules.",
                strategyPersonality: 'AGGRESSIVE',
                gpmEnabled: true,
            },
            strategyHistory: [],
            budget: 0,
            cashBalance: 0,
            holdings: {},
            performance: {
                startDate: arena.startDate,
                totalPnl: 0,
                totalPnlPct: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                winCount: 0,
                lossCount: 0,
                totalTrades: 0,
                bestTrade: null,
                worstTrade: null,
                dailySnapshots: [],
            },
            createdAt: now,
            status: 'ACTIVE',
            selectionReasoning: "Manually added by user.",
            weeklyReviews: [],
        };
        arena.pools.push(newPool);
        manualPoolIdx = arena.pools.length - 1;
    }

    const pool = arena.pools[manualPoolIdx];

    // ── 3. Check if GODS already exists in the pool ───────────────────────
    const existingHolding = pool.holdings?.[TICKER];
    if (existingHolding && existingHolding.amount > 0) {
        console.log(`\n  ⚠️  GODS already exists in POOL_MANUAL:`);
        console.log(`      Amount: ${existingHolding.amount}`);
        console.log(`      Avg Price: $${existingHolding.averagePrice}`);
        console.log(`\n  This script will OVERWRITE the holding with the new figures.`);
        console.log(`  (User confirmed total is now 4,015 @ $0.03169)`);
    }

    // ── 4. Add/Update GODS holding ────────────────────────────────────────
    if (!pool.holdings) pool.holdings = {};
    
    // Calculate the cost delta — if position already existed, we only deduct the NEW cost
    const oldCostBasis = existingHolding ? (existingHolding.amount * existingHolding.averagePrice) : 0;
    const costDelta = TOTAL_COST - oldCostBasis;

    pool.holdings[TICKER] = {
        amount: AMOUNT,
        averagePrice: AVG_PRICE,
        peakPrice: AVG_PRICE,
        peakPnlPct: 0,
        boughtAt: new Date().toISOString(),
    };

    // Add to tokens list if not already there
    if (!pool.tokens) pool.tokens = [];
    if (!pool.tokens.includes(TICKER)) {
        pool.tokens.push(TICKER);
    }

    // Increment trade count
    pool.performance.totalTrades = (pool.performance.totalTrades || 0) + 1;

    // ── 5. Deduct cost from sharedCash ────────────────────────────────────
    const sharedCashAfter = Math.max(0, sharedCashBefore - costDelta);
    arena.sharedCash = sharedCashAfter;
    arena.pools[manualPoolIdx] = pool;

    console.log('\n' + sep('─'));
    console.log('  CHANGES SUMMARY');
    console.log(sep('─'));
    console.log(`  POOL_MANUAL holdings:`);
    console.log(`    ${TICKER}: ${AMOUNT} @ $${AVG_PRICE} = ${$$(TOTAL_COST)}`);
    if (existingHolding) {
        console.log(`    (was: ${existingHolding.amount} @ $${existingHolding.averagePrice} = ${$$(oldCostBasis)})`);
    }
    console.log(`  sharedCash: ${$$(sharedCashBefore)} → ${$$(sharedCashAfter)} (delta: -${$$(costDelta)})`);

    // ── 6. Show full portfolio summary ────────────────────────────────────
    console.log('\n' + sep('─'));
    console.log('  FULL PORTFOLIO STATE (POST-RECONCILIATION)');
    console.log(sep('─'));

    let totalHoldingsValue = 0;
    for (const p of arena.pools) {
        let poolHoldingsValue = 0;
        const holdingLines: string[] = [];
        for (const [t, h] of Object.entries(p.holdings as Record<string, any>)) {
            if (h.amount > 0) {
                const val = h.amount * h.averagePrice;
                poolHoldingsValue += val;
                holdingLines.push(`      ${t.padEnd(8)} ${h.amount} × $${h.averagePrice.toFixed(6)} = ${$$(val)}`);
            }
        }
        totalHoldingsValue += poolHoldingsValue;
        console.log(`\n  ${p.emoji} ${p.name} (${p.poolId})`);
        console.log(`    Holdings value: ${$$(poolHoldingsValue)}`);
        holdingLines.forEach(l => console.log(l));
    }

    const totalNAV = sharedCashAfter + totalHoldingsValue;
    const totalInvested = arena.totalBudget + (arena.sharedDcaContributions ?? 0);
    const totalPnl = totalNAV - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    console.log('\n' + sep('─'));
    console.log(`  Shared Cash:    ${$$(sharedCashAfter)}`);
    console.log(`  Holdings Value: ${$$(totalHoldingsValue)}`);
    console.log(`  Total NAV:      ${$$(totalNAV)}`);
    console.log(`  Total Invested: ${$$(totalInvested)} (budget ${$$(arena.totalBudget)} + DCA ${$$(arena.sharedDcaContributions ?? 0)})`);
    console.log(`  P&L:            ${$$(totalPnl)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`);
    console.log(sep('─'));

    if (!APPLY) {
        console.log('\n  👀 DRY RUN — No changes written.');
        console.log('  Run with --apply to write to Firestore:\n');
        console.log('    npx tsx scripts/reconcile_gods_manual.ts --apply\n');
        process.exit(0);
    }

    // ── 7. Write to Firestore ─────────────────────────────────────────────
    console.log('\n  💾 Writing arena config to Firestore...');
    await db.collection('arena_config').doc(USER_ID).set(arena);
    console.log('  ✅ Arena config saved.');

    // ── 8. Record trade in arena_trades ────────────────────────────────────
    console.log('  📝 Recording trade in arena_trades...');
    const tradeRecord = {
        userId: USER_ID,
        poolId: 'POOL_MANUAL',
        poolName: 'MANUAL MADNESS',
        ticker: TICKER,
        type: 'BUY',
        amount: AMOUNT,
        price: AVG_PRICE,
        total: TOTAL_COST,
        reason: `[MANUAL] Direct purchase on Revolut X — 4,015 GODS @ $0.03169 avg`,
        date: new Date().toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        marketContext: {
            btcPrice: 0,
            btcChange24h: 0,
            tokenChange24h: 0,
            fearGreedIndex: 50,
        },
        preTradeReflection: 'Manual Revolut X purchase recorded via reconciliation script.',
    };
    await db.collection('arena_trades').add(tradeRecord);
    console.log('  ✅ Trade recorded.');

    // ── 9. Run Revolut reconciliation ─────────────────────────────────────
    console.log('\n  🔄 Running Revolut balance reconciliation...');
    try {
        const configDoc = await db.collection('agent_configs').doc(USER_ID).get();
        const config = configDoc.data();
        if (config?.revolutApiKey && config?.revolutPrivateKey) {
            const { RevolutX: RX } = await import('../src/lib/revolut');
            const client = new RX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);
            const balances = await client.getBalances();

            const usdEntry = (balances as any[]).find(
                (b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'USD'
            );
            const revolutUsd = parseFloat((usdEntry?.available ?? usdEntry?.balance ?? 0).toString());

            // Check for GODS on Revolut
            const godsEntry = (balances as any[]).find(
                (b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'GODS'
            );
            const revolutGods = godsEntry ? parseFloat((godsEntry?.available ?? godsEntry?.balance ?? 0).toString()) : 0;

            console.log(`\n  Revolut USD:  $${revolutUsd.toFixed(2)}`);
            console.log(`  Revolut GODS: ${revolutGods}`);
            console.log(`  Arena GODS:   ${AMOUNT}`);

            if (revolutGods > 0) {
                const diff = Math.abs(revolutGods - AMOUNT);
                const diffPct = (diff / AMOUNT) * 100;
                if (diffPct < 1) {
                    console.log(`  ✅ GODS balance matches (diff: ${diffPct.toFixed(2)}%)`);
                } else {
                    console.log(`  ⚠️  GODS diff: ${diffPct.toFixed(2)}% (Revolut: ${revolutGods}, Arena: ${AMOUNT})`);
                }
            } else {
                console.log(`  ℹ️  GODS not visible via API (Revolut X exchange tokens may not appear in /balances)`);
            }

            // Sync sharedCash to Revolut USD
            const cashDrift = Math.abs(revolutUsd - sharedCashAfter);
            if (cashDrift > 0.50) {
                console.log(`\n  ⚠️  Cash drift detected: Arena ${$$(sharedCashAfter)} vs Revolut $${revolutUsd.toFixed(2)}`);
                console.log(`  🔄 Syncing sharedCash to Revolut USD: ${$$(sharedCashAfter)} → $${revolutUsd.toFixed(2)}`);
                arena.sharedCash = revolutUsd;
                arena.lastRevolutSyncAt = new Date().toISOString();
                await db.collection('arena_config').doc(USER_ID).set(arena);
                console.log('  ✅ Cash synced to Revolut.');
            } else {
                console.log(`\n  ✅ Cash in sync (drift: $${cashDrift.toFixed(2)})`);
            }
        } else {
            console.log('  ⏭️  No Revolut API keys found — skipping live reconciliation.');
        }
    } catch (e: any) {
        console.warn(`  ⚠️  Revolut reconciliation failed (non-fatal): ${e.message}`);
    }

    console.log('\n' + sep());
    console.log('  ✅ RECONCILIATION COMPLETE');
    console.log(sep() + '\n');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
