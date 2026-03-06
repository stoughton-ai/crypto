import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function rebalanceToConviction() {
    console.log('=== SYSTEM REBALANCING: 100% CONVICTION ALLOCATION ===\n');

    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);

    // 1. Current Price Snapshot (Ground Truth from User Report)
    const livePrices: Record<string, number> = {
        'XRP': 1.4264, 'BNB': 656.457, 'LINK': 9.373, 'DOT': 1.521,
        'SOL': 90.897, 'AAVE': 117.362, 'ADA': 0.2742, 'AVAX': 9.417
    };

    // 2. Fetch Live Holdings
    const holdings = await client.getHoldings();
    const currentQty: Record<string, number> = {};
    holdings.forEach(h => currentQty[h.symbol.toUpperCase()] = h.amount);

    console.log('Current Revolut Quantities:');
    Object.keys(livePrices).forEach(t => console.log(`  ${t}: ${currentQty[t] || 0}`));

    // 3. Targets ($74.50 per token = $149 per pool)
    const targetUsd = 74.50;

    // We execute SELLS first to free up any necessary cash (though we have $136 already)
    // Then BUYS.

    console.log('\n--- PHASE 1: SELLING EXCESS ---');
    for (const ticker of Object.keys(livePrices)) {
        const qty = currentQty[ticker] || 0;
        const val = qty * livePrices[ticker];
        if (val > targetUsd + 2) { // 2$ buffer
            const excessUsd = val - targetUsd;
            const sizeToSell = (excessUsd / livePrices[ticker]).toFixed(6);
            console.log(`  [SELL] ${ticker}: Value $${val.toFixed(2)} > Target $${targetUsd}. Selling ${sizeToSell}...`);
            try {
                await client.createOrder({
                    symbol: `${ticker}-USD`,
                    side: 'SELL',
                    size: sizeToSell,
                    type: 'market'
                });
            } catch (e: any) {
                console.error(`  ❌ Failed to sell ${ticker}: ${e.message}`);
            }
        }
    }

    console.log('\n--- PHASE 2: BUYING DEFICITS ---');
    for (const ticker of Object.keys(livePrices)) {
        const qty = currentQty[ticker] || 0;
        const val = qty * livePrices[ticker];
        if (val < targetUsd - 2) {
            const deficitUsd = targetUsd - val;
            const sizeToBuy = (deficitUsd / livePrices[ticker]).toFixed(6);
            console.log(`  [BUY] ${ticker}: Value $${val.toFixed(2)} < Target $${targetUsd}. Buying ${sizeToBuy}...`);
            try {
                await client.createOrder({
                    symbol: `${ticker}-USD`,
                    side: 'BUY',
                    size: sizeToBuy,
                    type: 'market'
                });
            } catch (e: any) {
                console.error(`  ❌ Failed to buy ${ticker}: ${e.message}`);
            }
        }
    }

    console.log('\n--- PHASE 3: DATABASE SYNC ---');
    // Wait for orders to settle (market orders are usually instant)
    await new Promise(r => setTimeout(r, 2000));

    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data() as any;

    // Fetch fresh holdings for sync
    const finalHoldings = await client.getHoldings();
    const balances = await client.getBalances();
    const usdRaw = balances.find(b => (b.currency || b.symbol) === 'USD') as any;
    const finalUsd = parseFloat((usdRaw?.available || usdRaw?.total || 0).toString());

    arena.pools.forEach((pool: any) => {
        const poolTokens = pool.tokens.map((t: string) => t.toUpperCase());
        const newHoldings: any = {};
        for (const h of finalHoldings) {
            const sym = h.symbol.toUpperCase();
            if (poolTokens.includes(sym)) {
                newHoldings[sym] = {
                    amount: h.amount,
                    averagePrice: livePrices[sym], // Reset basis to NOW
                    boughtAt: new Date().toISOString()
                };
            }
        }
        pool.holdings = newHoldings;
        pool.cashBalance = finalUsd / 4;
        pool.budget = 150; // Ensure budget is exactly 150
    });

    await db.collection('arena_config').doc(userId).update({
        pools: arena.pools,
        lastRebalancedAt: new Date().toISOString()
    });

    console.log(`\n✅ REBALANCING COMPLETE. All pools normalized to ~$150 with ~100% allocation.`);
}

rebalanceToConviction().catch(console.error);
