/**
 * Lower Pool 2 (Deep Divers) buy thresholds so LINK and AAVE can trigger entries.
 *
 * Current:  buyScoreThreshold=75, buyConfidenceBuffer=3 → effective trigger 78
 * New:      buyScoreThreshold=62, buyConfidenceBuffer=5 → effective trigger 67
 *
 * LINK has been scoring 68-78, will now trigger on its next good cycle.
 * AAVE has been scoring 62-69, will now trigger when it rebounds.
 *
 * Run: npx tsx scripts/fix_pool2_thresholds.ts
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

    const poolIdx = arena.pools.findIndex((p: any) => p.poolId === 'POOL_2');
    const pool = arena.pools[poolIdx] as any;

    console.log('\n🐳 Deep Divers — BEFORE:');
    console.log(`  buyScoreThreshold  : ${pool.strategy.buyScoreThreshold}`);
    console.log(`  buyConfidenceBuffer: ${pool.strategy.buyConfidenceBuffer}`);
    console.log(`  Effective trigger  : ${(pool.strategy.buyScoreThreshold ?? 0) + (pool.strategy.buyConfidenceBuffer ?? 5)}`);

    // Apply changes
    pool.strategy.buyScoreThreshold = 62;
    pool.strategy.buyConfidenceBuffer = 5;

    console.log('\n🐳 Deep Divers — AFTER:');
    console.log(`  buyScoreThreshold  : ${pool.strategy.buyScoreThreshold}`);
    console.log(`  buyConfidenceBuffer: ${pool.strategy.buyConfidenceBuffer}`);
    console.log(`  Effective trigger  : ${pool.strategy.buyScoreThreshold + pool.strategy.buyConfidenceBuffer}`);
    console.log('\n  LINK scores (recent): 72, 68, 71, 74, 68, 76, 74, 78, 74, 78 → ✅ will trigger');
    console.log('  AAVE scores (recent): 45, 48, 62, 58, 64, 68, 68, 68, 69, 66 → ✅ will trigger on recovery');

    arena.pools[poolIdx] = pool;
    await ref.set(arena);
    console.log('\n✅ Saved to Firestore. Deep Divers will evaluate on the next cron cycle (~3 min).\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
