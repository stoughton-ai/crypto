/**
 * reconcile_ftse_pools.ts
 *
 * Re-derives pool holdings + cashBalance from the post-competition trade ledger.
 * Run this after a purge that wiped pool state but kept post-competition trades.
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

const POOL_BUDGET = 150;

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Read arena config
    const configRef = adminDb.collection('arena_config_ftse').doc(userId);
    const configSnap = await configRef.get();
    if (!configSnap.exists) { console.error('No FTSE config'); process.exit(1); }
    const arena = configSnap.data() as any;

    // Read all trades
    const tradesSnap = await adminDb
        .collection('arena_trades_ftse')
        .where('userId', '==', userId)
        .get();

    const trades = tradesSnap.docs
        .map(d => d.data())
        .sort((a, b) => (a.date || '').localeCompare(b.date || '')); // chronological

    console.log(`Found ${trades.length} trade(s) to replay:\n`);
    trades.forEach(t => console.log(`  ${t.date?.substring(11, 19)} ${t.type} ${t.ticker} x${t.amount} @ ${t.price} | pool: ${t.poolId}`));

    // Build fresh pool state by replaying trades
    const poolState: Record<string, { cashBalance: number; holdings: Record<string, { amount: number; averagePrice: number; totalCost: number }> }> = {};

    // Initialise each pool with full budget
    for (const pool of arena.pools) {
        poolState[pool.poolId] = { cashBalance: POOL_BUDGET, holdings: {} };
    }

    for (const trade of trades) {
        const poolId = trade.poolId;
        if (!poolState[poolId]) {
            console.warn(`  ⚠ Unknown poolId ${poolId} in trade — skipping`);
            continue;
        }
        const ps = poolState[poolId];
        const ticker = (trade.ticker || '').toUpperCase();
        const amount = trade.amount || 0;
        const price = trade.price || 0;
        const total = trade.total || amount * price;

        if (trade.type === 'BUY') {
            ps.cashBalance -= total;
            if (!ps.holdings[ticker]) ps.holdings[ticker] = { amount: 0, averagePrice: price, totalCost: 0 };
            const h = ps.holdings[ticker];
            const newTotalCost = h.totalCost + total;
            const newAmount = h.amount + amount;
            h.averagePrice = newTotalCost / newAmount;
            h.totalCost = newTotalCost;
            h.amount = newAmount;
        } else if (trade.type === 'SELL') {
            ps.cashBalance += total;
            const h = ps.holdings[ticker];
            if (h) {
                h.amount -= amount;
                h.totalCost -= amount * h.averagePrice;
                if (h.amount <= 0.0001) delete ps.holdings[ticker];
            }
        }
    }

    console.log('\n=== Reconciled Pool State ===');
    const updatedPools = arena.pools.map((pool: any) => {
        const ps = poolState[pool.poolId] || { cashBalance: POOL_BUDGET, holdings: {} };
        console.log(`\n  ${pool.poolId} | ${pool.name}`);
        console.log(`    cashBalance: £${ps.cashBalance.toFixed(2)}`);
        Object.entries(ps.holdings).forEach(([t, h]: any) =>
            console.log(`    ${t}: ${h.amount.toFixed(6)} shares @ avg £${h.averagePrice.toFixed(2)}`)
        );

        // Reformat holdings to match the arena engine's expected schema
        const formattedHoldings: Record<string, any> = {};
        for (const [ticker, h] of Object.entries(ps.holdings) as any[]) {
            formattedHoldings[ticker] = {
                amount: h.amount,
                averagePrice: h.averagePrice,
                totalCost: h.totalCost,
            };
        }

        return { ...pool, cashBalance: Math.max(0, ps.cashBalance), holdings: formattedHoldings };
    });

    await configRef.update({ pools: updatedPools });
    console.log('\n✅ Pool state reconciled and written to Firestore.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
