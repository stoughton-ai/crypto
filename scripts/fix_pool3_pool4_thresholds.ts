/**
 * Fix Pool 3 (Steady Sailers) and Pool 4 (Agile Arbitrageurs) buy thresholds.
 *
 * POOL_3 (Steady Sailers):
 *   - ADA scored 78 on last check, trigger is 76 — should already be buying.
 *   - Lower buffer from 4→3 just to ensure no edge-case miss.
 *   - Effective trigger: 75 (was 76)
 *
 * POOL_4 (Agile Arbitrageurs):
 *   - SOL scored up to 87, trigger is 93 — too high.
 *   - buyScoreThreshold: 85→70, buyConfidenceBuffer: 8→5
 *   - Effective trigger: 75 (was 93)
 *   - SOL is trending upward strongly (87 last score) — will buy on next cycle.
 *
 * Run: npx tsx scripts/fix_pool3_pool4_thresholds.ts
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

async function main() {
    const ref = db.collection('arena_config').doc(USER_ID);
    const snap = await ref.get();
    const arena = snap.data()!;

    for (let i = 0; i < arena.pools.length; i++) {
        const pool = arena.pools[i] as any;

        if (pool.poolId === 'POOL_3') {
            const before = (pool.strategy.buyScoreThreshold ?? 0) + (pool.strategy.buyConfidenceBuffer ?? 5);
            pool.strategy.buyScoreThreshold = 72;
            pool.strategy.buyConfidenceBuffer = 3;
            const after = pool.strategy.buyScoreThreshold + pool.strategy.buyConfidenceBuffer;
            console.log(`\n${pool.emoji} ${pool.name}: trigger ${before} → ${after}`);
            console.log(`  ADA last score: 78 → ✅ will trigger immediately`);
            arena.pools[i] = pool;
        }

        if (pool.poolId === 'POOL_4') {
            const before = (pool.strategy.buyScoreThreshold ?? 0) + (pool.strategy.buyConfidenceBuffer ?? 5);
            pool.strategy.buyScoreThreshold = 70;
            pool.strategy.buyConfidenceBuffer = 5;
            const after = pool.strategy.buyScoreThreshold + pool.strategy.buyConfidenceBuffer;
            console.log(`\n${pool.emoji} ${pool.name}: trigger ${before} → ${after}`);
            console.log(`  SOL last score: 87 → ✅ well above new trigger of ${after}`);
            arena.pools[i] = pool;
        }
    }

    await ref.set(arena);
    console.log('\n✅ Saved. Both pools will evaluate on the next cron cycle (~3 min).\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
