import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function syncDashboardWithRevolut() {
    console.log('=== REFINED SYNC: DATABASE HOLDINGS & CASH ===\n');

    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);

    // 1. Fetch live Revolut state
    const balances = await client.getBalances();
    const usdRaw = balances.find(b => (b.currency || b.symbol) === 'USD');
    const usdBalance = parseFloat((usdRaw?.balance || usdRaw?.amount || 0).toString());
    const holdings = await client.getHoldings();

    // 2. Fetch Prices for reconciliation
    const prices: Record<string, number> = {
        'BNB': 600, 'SOL': 140, 'AVAX': 40, 'XRP': 2.5, 'LINK': 9.4, 'AAVE': 117, 'DOT': 1.5, 'ADA': 0.27
    };
    try {
        const snap = await db.collection('arena_prices').doc('latest').get();
        const dbPrices = snap.data()?.prices || {};
        Object.keys(prices).forEach(t => {
            if (dbPrices[t]?.price) prices[t] = dbPrices[t].price;
        });
    } catch { }

    // 3. Update Arena Config
    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data() as any;

    arena.pools.forEach((pool: any) => {
        const poolTokens = pool.tokens.map((t: string) => t.toUpperCase());
        const newHoldings: any = {};

        for (const h of holdings) {
            const sym = h.symbol.toUpperCase();
            if (poolTokens.includes(sym)) {
                newHoldings[sym] = {
                    amount: h.amount,
                    averagePrice: prices[sym], // best guess
                    boughtAt: new Date().toISOString()
                };
                console.log(`Pool ${pool.poolId}: Attached ${h.amount} ${sym}`);
            }
        }
        pool.holdings = newHoldings;

        // Distribute USD balance evenly (approx) across pools for dashboard display
        pool.cashBalance = usdBalance / 4;
    });

    await db.collection('arena_config').doc(userId).update({
        pools: arena.pools,
        lastSyncedAt: new Date().toISOString()
    });

    console.log(`\n✅ Database updated with ${holdings.length} holdings and $${usdBalance} total cash.`);
}

syncDashboardWithRevolut().catch(console.error);
