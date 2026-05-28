/**
 * fix_reentry_thresholds.js
 *
 * Adjusts buy-side parameters for POOL_2 (Deep Divers) and POOL_3 (Steady Sailers)
 * so they re-enter the market faster after a stop-loss.
 *
 * Problem: Both pools are holding too much cash and not buying into recoveries
 * quickly enough after a stop-loss event.
 *
 * Root causes:
 *  1. buyScoreThreshold is too high for recovery mode — scored assets haven't
 *     fully recovered to where they'd normally qualify as "fresh" buys.
 *  2. buyConfidenceBuffer adds further points on top (POOL_3 requires +7pts above
 *     threshold, POOL_2 requires +5). In a recovery, scores may sit in the
 *     60-72 range — solid but not exceptional.
 *  3. stopLossReentryHours falls back to 6h default (not in Firestore). Good
 *     but we're tightening it here so it's explicit and Phase B fires sooner.
 *  4. reboundEntryPct (Phase C) defaults to 1.5% recovery before re-entry fires.
 *     Reducing to 1.0% lets the mechanical re-entry trigger earlier.
 *
 * Changes:
 *  POOL_2 (Deep Divers):
 *    buyScoreThreshold:    unchanged (already set by AI — we touch confidence buffer only)
 *    buyConfidenceBuffer:  5 → 3   (was requiring score >= threshold+5; now threshold+3)
 *    stopLossReentryHours: (default 6) → 4  (re-enter after 4h, not 6h)
 *    reboundEntryPct:      (default 1.5) → 1.0  (Phase C fires at 1% recovery)
 *    reboundRsiMin:        (default 35) → 32  (accept slightly lower RSI — recovery mode)
 *
 *  POOL_3 (Steady Sailers):
 *    buyScoreThreshold:    unchanged
 *    buyConfidenceBuffer:  7 → 4   (was very conservative; now more willing in recovery)
 *    stopLossReentryHours: (default 6) → 5  (slightly longer than Deep Divers given patience profile)
 *    reboundEntryPct:      (default 1.5) → 1.0
 *    reboundRsiMin:        (default 35) → 32
 *
 * Usage: node scripts/fix_reentry_thresholds.js
 */

require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
const db = admin.firestore();

const POOL_UPDATES = {
    POOL_2: {
        label: 'Deep Divers',
        changes: {
            buyConfidenceBuffer: 3,      // was 5 — score must exceed buyScoreThreshold by only 3pts
            stopLossReentryHours: 4,     // was 6h default — re-entry cooldown after stop-loss
            reboundEntryPct: 1.0,        // was 1.5% — Phase C recovery trigger
            reboundRsiMin: 32,           // was 35 — slightly more tolerant RSI floor
        },
    },
    POOL_3: {
        label: 'Steady Sailers',
        changes: {
            buyConfidenceBuffer: 4,      // was 7 — most conservative buffer, loosened to 4
            stopLossReentryHours: 5,     // was 6h default — slightly tighter cooldown
            reboundEntryPct: 1.0,        // was 1.5% — Phase C recovery trigger
            reboundRsiMin: 32,           // was 35 — slightly more tolerant RSI floor
        },
    },
};

async function run() {
    const snap = await db.collection('arena_config').get();
    if (snap.empty) {
        console.error('❌ No arena_config documents found.');
        process.exit(1);
    }

    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (!data.pools || !Array.isArray(data.pools)) {
            console.log(`  ⚠️  Skipping ${docSnap.id} — no pools array`);
            continue;
        }

        let changed = false;

        for (const pool of data.pools) {
            const update = POOL_UPDATES[pool.poolId];
            if (!update) continue;

            const strat = pool.strategy;
            console.log(`\n${pool.emoji || '🏊'} ${pool.name || update.label} (${pool.poolId})`);

            for (const [key, newVal] of Object.entries(update.changes)) {
                const oldVal = strat[key] ?? '(default/unset)';
                strat[key] = newVal;
                console.log(`   ${key}: ${oldVal} → ${newVal}`);
                changed = true;
            }

            console.log(`   buyScoreThreshold: ${strat.buyScoreThreshold} (unchanged — AI owns this)`);
            console.log(`   Effective entry threshold now: ${strat.buyScoreThreshold} + ${strat.buyConfidenceBuffer} = ${strat.buyScoreThreshold + strat.buyConfidenceBuffer}`);
        }

        if (changed) {
            await docSnap.ref.update({ pools: data.pools });
            console.log(`\n✅ Updated arena_config for user ${docSnap.id}`);
        } else {
            console.log(`\n⚠️  No target pools found in ${docSnap.id} — no changes made`);
        }
    }

    console.log('\n🎯 Done. Deep Divers and Steady Sailers will now re-enter the market faster after a stop-loss.');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
