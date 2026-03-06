// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

// ─── REVERSE SWAP MAP ────────────────────────────────────────────────────────
// OLD (actual current) → NEW (desired)
const SWAP_MAP: Record<string, string> = {
    'XRP': 'ICP',
    'BNB': 'RENDER',
    'AVAX': 'SHIB',
    'SOL': 'FLOKI',
};

const REMOVED = Object.keys(SWAP_MAP);
const ADDED = Object.values(SWAP_MAP);

async function reverseSwap() {
    console.log('=== Reversing Arena Token Swap per Immediate User Request ===\n');

    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    if (!arenaDoc.exists) {
        console.error('❌ No arena_config document found for user', userId);
        process.exit(1);
    }

    const arena = arenaDoc.data() as any;
    const pools: any[] = arena.pools || [];

    for (const pool of pools) {
        const originalTokens: string[] = [...pool.tokens];
        pool.tokens = pool.tokens.map((t: string) => SWAP_MAP[t.toUpperCase()] || t);

        const changed = pool.tokens.some((t: string, i: number) => t !== originalTokens[i]);
        if (changed) {
            console.log(`🔄 Pool ${pool.emoji} ${pool.name}: [${originalTokens.join(', ')}] → [${pool.tokens.join(', ')}]`);
        }

        // Clean up state for the tokens we are removing (XRP, BNB, AVAX, SOL)
        const holdings: Record<string, any> = pool.holdings || {};
        for (const removedToken of REMOVED) {
            if (holdings[removedToken]) {
                const h = holdings[removedToken];
                const value = (h.amount || 0) * (h.averagePrice || 0);
                console.log(`  💸 Liquidating ${removedToken} in ${pool.poolId}: returning $${value.toFixed(2)} to cash`);
                pool.cashBalance = (pool.cashBalance || 0) + value;
                delete holdings[removedToken];
            }
        }
        pool.holdings = holdings;

        // Reset tracking for the new tokens (ICP, RENDER, SHIB, FLOKI)
        const scoreHistory = pool.scoreHistory || {};
        const lastEvaluatedAt = pool.lastEvaluatedAt || {};
        const lastSoldAt = pool.lastSoldAt || {};

        for (const addedToken of ADDED) {
            delete scoreHistory[addedToken];
            delete lastEvaluatedAt[addedToken];
            delete lastSoldAt[addedToken];
        }

        pool.scoreHistory = scoreHistory;
        pool.lastEvaluatedAt = lastEvaluatedAt;
        pool.lastSoldAt = lastSoldAt;
    }

    arena.pools = pools;
    arena.lastTokenSwap = new Date().toISOString();
    arena.tokenSwapReason = 'Immediate user request to revert back to previous token selection: ICP, RENDER, SHIB, FLOKI.';

    await db.collection('arena_config').doc(userId).set(arena);
    console.log('\n✅ Tokens swapped back successfully.');
}

reverseSwap().catch(console.error);
