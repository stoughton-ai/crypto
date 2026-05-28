/**
 * fix_reentry_thresholds_v2.js
 *
 * Phase 2 fix: Reset the AI-inflated buyScoreThreshold back to realistic
 * values for POOL_2 (Deep Divers) and POOL_3 (Steady Sailers).
 *
 * Problem found: The AI self-reviewed and cranked buyScoreThreshold to:
 *   - Deep Divers:   95  (prev: 90)
 *   - Steady Sailers: 90  (prev: 85)
 *
 * With the confidence buffer on top (now 3 and 4 respectively), the AI needs
 * to score 98 or 94 to execute a buy — essentially impossible in a choppy
 * recovery, which is why these pools are sitting on cash.
 *
 * Fix: Reset buyScoreThreshold to values appropriate for recovery entry:
 *   - Deep Divers:    95 → 75  (these are the "patient dip hunters" — 75 is their mode)
 *   - Steady Sailers: 90 → 72  (PATIENT accumulators — 72 is sensible for their style)
 *
 * This is NOT permanently overriding the AI — the AI can still raise these
 * again in its next strategy review. We're just overriding the over-correction.
 *
 * Usage: node scripts/fix_reentry_thresholds_v2.js
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

const THRESHOLD_RESETS = {
    POOL_2: {
        label: 'Deep Divers',
        buyScoreThreshold: 75,   // Reset from AI-inflated 95 → 75 (dip-hunting mode)
    },
    POOL_3: {
        label: 'Steady Sailers',
        buyScoreThreshold: 72,   // Reset from AI-inflated 90 → 72 (patient accumulation mode)
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
            const reset = THRESHOLD_RESETS[pool.poolId];
            if (!reset) continue;

            const strat = pool.strategy;
            const oldThreshold = strat.buyScoreThreshold;
            const newThreshold = reset.buyScoreThreshold;
            const buffer = strat.buyConfidenceBuffer;

            strat.buyScoreThreshold = newThreshold;
            changed = true;

            console.log(`\n${pool.emoji || '🏊'} ${pool.name || reset.label} (${pool.poolId})`);
            console.log(`   buyScoreThreshold: ${oldThreshold} → ${newThreshold}`);
            console.log(`   buyConfidenceBuffer: ${buffer} (unchanged)`);
            console.log(`   ✅ Effective buy trigger: score >= ${newThreshold + buffer} (was ${oldThreshold + buffer})`);
        }

        if (changed) {
            await docSnap.ref.update({ pools: data.pools });
            console.log(`\n✅ Updated arena_config for user ${docSnap.id}`);
        } else {
            console.log(`\n⚠️  No target pools found — no changes made`);
        }
    }

    console.log('\n🎯 Done. Thresholds reset. Pools will now buy at sensible recovery scores.');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
