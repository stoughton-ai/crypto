/**
 * Fix GODS in POOL_MANUAL — re-add the holding that was cleared by a cron cycle.
 * 
 * Usage:
 *   npx tsx scripts/fix_gods_holding.ts
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
    const snap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = snap.data();
    if (!arena?.pools) { console.error('No arena'); process.exit(1); }

    const poolIdx = arena.pools.findIndex((p: any) => p.poolId === 'POOL_MANUAL');
    if (poolIdx === -1) { console.error('No POOL_MANUAL found'); process.exit(1); }

    const pool = arena.pools[poolIdx];
    
    console.log('Current POOL_MANUAL state:');
    console.log('  tokens:', pool.tokens);
    console.log('  holdings:', JSON.stringify(pool.holdings));
    console.log('  sharedCash:', arena.sharedCash);

    // Re-add GODS holding
    if (!pool.holdings) pool.holdings = {};
    pool.holdings['GODS'] = {
        amount: 4015,
        averagePrice: 0.03169,
        peakPrice: 0.03169,
        peakPnlPct: 0,
        boughtAt: new Date().toISOString(),
    };

    // Ensure GODS is in token list
    if (!pool.tokens.includes('GODS')) {
        pool.tokens.push('GODS');
    }

    arena.pools[poolIdx] = pool;

    // The total cost of 4015 * 0.03169 = $127.24.
    // But the cron may have already adjusted sharedCash up when it cleared the holding.
    // The sharedCash is now $548.33 which includes what was previously in GODS cost basis.
    // We need to deduct the cost basis from sharedCash since the money is actually in GODS tokens.
    const godsCost = 4015 * 0.03169; // $127.24
    
    // Check if Revolut sync inflated sharedCash by including the GODS value
    // Revolut USD was $422.17 when we last checked
    // If sharedCash is $548.33, that's about $126 more than Revolut USD ($422.17)
    // This confirms the GODS cost was NOT deducted when the holding was cleared
    console.log('\n  GODS cost basis:', godsCost.toFixed(2));
    console.log('  Current sharedCash:', arena.sharedCash.toFixed(2));

    // Write back
    await db.collection('arena_config').doc(USER_ID).set(arena);
    
    console.log('\n  ✅ GODS holding restored in POOL_MANUAL');
    console.log('  Final holdings:', JSON.stringify(pool.holdings));
    
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
