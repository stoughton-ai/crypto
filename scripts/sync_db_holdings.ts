import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function syncDashboardWithRevolut() {
    console.log('=== SYNCING DASHBOARD (DB) WITH REVOLUT HOLDINGS ===\n');

    // 1. Get Keys
    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);

    // 2. Fetch Real Data
    console.log('Fetching live Revolut state...');
    const balances = await client.getBalances();
    const usdBalance = parseFloat(balances.find(b => (b.currency || b.symbol) === 'USD')?.balance?.toString() || '0');
    const holdings = await client.getHoldings();

    console.log(`Live USD Balance: $${usdBalance.toFixed(2)}`);
    console.log(`Live Holdings count: ${holdings.length}`);

    // 3. Get DB Config
    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data() as any;

    if (!arena) {
        throw new Error('No arena_config found for user');
    }

    // 4. Map Holdings to Pools
    // We'll iterate through each pool and see which of its assigned tokens are in the Revolut holdings
    let totalAssignedHoldingsValue = 0;

    for (const pool of arena.pools) {
        console.log(`\nSyncing Pool: ${pool.name} (${pool.poolId})...`);
        const poolTokens = pool.tokens.map((t: string) => t.toUpperCase());
        const poolHoldings: any = {};
        let poolHoldingsValue = 0;

        for (const h of holdings) {
            const symbol = h.symbol.toUpperCase();
            if (poolTokens.includes(symbol)) {
                // Approximate price (using last known or just 1 as we mainly need amount for dashboard)
                // The dashboard will fetch fresh prices itself, we just need to provide the amount/averagePrice
                // For averagePrice, we'll try to find it in previous DB state or provide a sensible placeholder
                const existing = pool.holdings?.[symbol] || {};

                // Fetch a fresh price for the averagePrice field so it doesn't look like 0% PnL
                let currentPrice = 0;
                try {
                    const priceRes = await (await fetch(`https://api.binance.com/api/3/ticker/price?symbol=${symbol}USDT`)).json();
                    currentPrice = parseFloat(priceRes.price);
                } catch (e) {
                    currentPrice = existing.averagePrice || 1;
                }

                poolHoldings[symbol] = {
                    amount: h.amount,
                    averagePrice: existing.averagePrice || currentPrice, // preserve basis if exists, else use current
                    peakPrice: Math.max(existing.peakPrice || 0, currentPrice),
                    boughtAt: existing.boughtAt || new Date().toISOString()
                };

                const value = h.amount * currentPrice;
                poolHoldingsValue += value;
                console.log(`  + Found ${h.amount.toFixed(6)} ${symbol} (Value ~$${value.toFixed(2)})`);
            }
        }

        pool.holdings = poolHoldings;
        totalAssignedHoldingsValue += poolHoldingsValue;
    }

    // 5. Redistribute Cash
    // This is tricky. Total asset value vs total cash. 
    // We'll calculate the total portfolio value and divide the cash proportionally to match the original $150 budget targets.
    // Or just subtract what's held from the $150.
    for (const pool of arena.pools) {
        let holdVal = 0;
        for (const [t, h] of Object.entries(pool.holdings)) {
            const hData = h as any;
            holdVal += hData.amount * hData.averagePrice;
        }
        // Pool target is $150. If holdings are $140, cash is $10.
        // If holdings grew to $160, cash is 0 but NAV is $160.
        pool.cashBalance = Math.max(0, 150 - holdVal);

        // If we have "excess" cash (USD balance > sum of pool cash), we distribute it.
    }

    // Adjust total cash to match real USD balance if possible, but the above is safer for "showing holdings"

    // 6. Write to DB
    await db.collection('arena_config').doc(userId).set(arena);
    console.log('\n✅ Dashboard sync complete. Holdings are now visible in Firestore.');
}

syncDashboardWithRevolut().catch(console.error);
