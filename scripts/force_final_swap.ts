import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function forceSwap() {
    console.log('--- FORCING ARENA SWAP ---');

    // 1. READ
    const doc = await db.collection('arena_config').doc(userId).get();
    if (!doc.exists) {
        console.error('No doc found');
        return;
    }
    const arena = doc.data() as any;

    // 2. LOG CURRENT
    console.log('Current pools:');
    arena.pools.forEach((p: any) => console.log(`  - ${p.poolId}: ${p.tokens.join(', ')}`));

    // 3. MODIFY
    const swaps: Record<string, string> = {
        'ICP': 'XRP',
        'RENDER': 'BNB',
        'FLOKI': 'SOL',
        'SHIB': 'AVAX'
    };

    arena.pools.forEach((pool: any) => {
        pool.tokens = pool.tokens.map((t: string) => swaps[t.toUpperCase()] || t);
    });

    // 4. WRITE
    await db.collection('arena_config').doc(userId).update({
        pools: arena.pools,
        lastTokenSwap: new Date().toISOString(),
        tokenSwapReason: 'Forced alignment with XRP, BNB, SOL, AVAX strategy.'
    });
    console.log('Update committed.');

    // 5. VERIFY
    const docAfter = await db.collection('arena_config').doc(userId).get();
    const arenaAfter = docAfter.data() as any;
    console.log('\nVerification - New tokens in DB:');
    arenaAfter.pools.forEach((p: any) => console.log(`  - ${p.poolId}: ${p.tokens.join(', ')}`));
}

forceSwap().catch(console.error);
