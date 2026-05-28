import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    const snap = await db.collection('arena_config').doc(userId).get();
    const data = snap.data();
    if (!data) { console.log('NO ARENA DOC FOUND'); process.exit(1); }

    console.log('initialized:', data.initialized);
    console.log('pools count:', data.pools?.length);
    console.log('totalBudget:', data.totalBudget);
    console.log('sharedCash:', data.sharedCash);
    console.log('startDate:', data.startDate);
    console.log('endDate:', data.endDate);
    console.log('competitionMode:', data.competitionMode);
    console.log('tokensLocked:', data.tokensLocked);
    console.log('userId:', data.userId);
    console.log('\nAll top-level keys:', Object.keys(data).sort().join(', '));

    // Check each pool
    for (const pool of (data.pools || [])) {
        console.log(`\nPool ${pool.poolId} (${pool.name}):`);
        console.log(`  tokens: ${pool.tokens?.join(', ')}`);
        console.log(`  holdings: ${JSON.stringify(Object.keys(pool.holdings || {}))}`);
        console.log(`  cashBalance: ${pool.cashBalance}`);
        console.log(`  status: ${pool.status}`);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
