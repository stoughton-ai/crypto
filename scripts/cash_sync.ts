import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function syncDashboardWithRevolut() {
    console.log('=== FINAL CASH SYNC ===\n');

    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);

    const balances = await client.getBalances();
    const usdRaw = balances.find(b => (b.currency || b.symbol) === 'USD') as any;

    // Explicitly check for 'available' or 'total' property from Revolut X API
    const usdBalance = parseFloat((usdRaw?.available || usdRaw?.total || usdRaw?.balance || 0).toString());
    console.log(`Verified USD Balance: $${usdBalance.toFixed(2)}`);

    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data() as any;

    arena.pools.forEach((pool: any) => {
        // Distribute USD balance evenly
        pool.cashBalance = usdBalance / 4;
    });

    await db.collection('arena_config').doc(userId).update({
        pools: arena.pools
    });

    console.log(`\n✅ Liquid status updated: $${(usdBalance / 4).toFixed(2)} per pool.`);
}

syncDashboardWithRevolut().catch(console.error);
