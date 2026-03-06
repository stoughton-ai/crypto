import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function finishRebalance() {
    console.log('=== FINISHING REBALANCE (AVAX TOP-UP - ATTEMPT 2) ===\n');

    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);

    try {
        const size = (54 / 9.41).toFixed(6);
        console.log(`Buying $54 of AVAX (Size: ${size})...`);
        await client.createOrder({
            symbol: 'AVAX-USD',
            side: 'BUY',
            size: size,
            type: 'market'
        });
        console.log('✅ AVAX purchase submitted.');
    } catch (e: any) {
        console.error(`❌ Failed to buy AVAX: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000));

    const holdings = await client.getHoldings();
    const balances = await client.getBalances();
    const usdRaw = balances.find(b => (b.currency || b.symbol) === 'USD') as any;
    const finalUsd = parseFloat((usdRaw?.available || usdRaw?.total || 0).toString());

    const prices: Record<string, number> = {
        'XRP': 1.426, 'BNB': 656.4, 'LINK': 9.37, 'DOT': 1.52,
        'SOL': 90.8, 'AAVE': 117.3, 'ADA': 0.274, 'AVAX': 9.41
    };

    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data() as any;

    arena.pools.forEach((pool: any) => {
        const poolTokens = pool.tokens.map((t: string) => t.toUpperCase());
        const newHoldings: any = {};
        for (const h of finalHoldings || []) {
            const sym = h.symbol.toUpperCase();
            if (poolTokens.includes(sym)) {
                newHoldings[sym] = {
                    amount: h.amount,
                    averagePrice: prices[sym],
                    boughtAt: new Date().toISOString()
                };
            }
        }
        for (const h of holdings) {
            const sym = h.symbol.toUpperCase();
            if (poolTokens.includes(sym)) {
                newHoldings[sym] = {
                    amount: h.amount,
                    averagePrice: prices[sym],
                    boughtAt: new Date().toISOString()
                };
            }
        }
        pool.holdings = newHoldings;
        pool.cashBalance = finalUsd / 4;
        pool.budget = 150;
    });

    await db.collection('arena_config').doc(userId).update({
        pools: arena.pools
    });

    console.log(`\n✅ FINAL SYNC COMPLETE. Cash: $${finalUsd.toFixed(2)} total.`);
}

finishRebalance().catch(console.error);
