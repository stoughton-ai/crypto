// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    console.log('=== Purging Stale Holdings for Swapped Tokens ===\n');

    const doc = await db.collection('arena_config').doc(userId).get();
    const arena = doc.data() as any;

    const staleTokens = ['ICP', 'RENDER', 'SHIB', 'FLOKI'];
    let purgedCount = 0;

    arena.pools.forEach((pool: any) => {
        const holdings = pool.holdings || {};
        staleTokens.forEach(t => {
            if (holdings[t]) {
                const amount = holdings[t].amount;
                const value = amount * holdings[t].averagePrice;
                console.log(`🗑️ Purged ${t} in ${pool.poolId}: $${value.toFixed(2)} returned to cash.`);
                pool.cashBalance = (pool.cashBalance || 0) + value;
                delete holdings[t];
                purgedCount++;
            }
        });
        pool.holdings = holdings;
    });

    if (purgedCount > 0) {
        await db.collection('arena_config').doc(userId).set(arena);
        console.log(`\n✅ Purged ${purgedCount} stale holdings.`);
    } else {
        console.log('No stale holdings found.');
    }
}

main().catch(console.error);
