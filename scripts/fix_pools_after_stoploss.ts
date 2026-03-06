// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

// Live prices at time of stop-loss sell (approximate — use avg prices recorded in Holdings)
// We'll calculate what cash SHOULD be: pool budget minus what's lost

async function fixPools() {
    console.log('=== Reconciling Pool Holdings After Stop-Loss ===\n');

    const poolSnap = await db.collection('discovery_pools').where('userId', '==', userId).get();
    const batch = db.batch();
    const now = new Date().toISOString();

    let totalRecoveredCash = 0;

    for (const doc of poolSnap.docs) {
        const pool = doc.data();
        const holdings = pool.holdings || {};
        const currentCash = pool.cashBalance || 0;

        // Calculate the value of sold holdings using their average price
        // (best approximation since we don't have actual sell price)
        let soldValue = 0;
        for (const [ticker, h] of Object.entries(holdings as any)) {
            const hData = h as any;
            const value = hData.amount * hData.averagePrice;
            soldValue += value;
            console.log(`  ${pool.poolId} ${ticker}: sold ~$${value.toFixed(2)} (at avg entry price — actual may differ)`);
        }

        // New cash = existing cash + proceeds from sold holdings
        const newCash = currentCash + soldValue;
        totalRecoveredCash += soldValue;

        console.log(`\n  ${pool.poolId} ${pool.emoji} ${pool.name}:`);
        console.log(`    Was: cash $${currentCash.toFixed(2)} + $${soldValue.toFixed(2)} holdings`);
        console.log(`    Now: cash $${newCash.toFixed(2)} + no holdings`);

        // Record liquidation as pool trades
        for (const [ticker, h] of Object.entries(holdings as any)) {
            const hData = h as any;
            const price = hData.averagePrice;
            const amount = hData.amount;
            const total = amount * price;
            const tradeRef = db.collection('pool_trades').doc();
            batch.set(tradeRef, {
                userId,
                poolId: pool.poolId,
                poolName: pool.name,
                ticker,
                type: 'SELL',
                amount,
                price,
                total,
                reason: 'Emergency stop-loss: all Revolut holdings liquidated by system',
                pnl: 0,
                pnlPct: 0,
                date: now,
            });
        }

        // Update pool: clear holdings, restore cash, add stop-loss note
        batch.update(doc.ref, {
            holdings: {},
            cashBalance: newCash,
            lastUpdated: now,
            'performance.totalPnl': 0,
            'performance.totalPnlPct': 0,
            pauseReason: `Stop-loss triggered at ${now}. All holdings liquidated. Cash preserved: $${newCash.toFixed(2)}. Pool remains ACTIVE — will re-invest on next brain cycle.`,
        });
    }

    await batch.commit();
    console.log(`\n✅ Done. Total holdings value recovered as cash: ~$${totalRecoveredCash.toFixed(2)}`);
    console.log('Pools are now cash-only and marked ACTIVE — they will re-invest on next cycle.');
    process.exit(0);
}

fixPools().catch(e => { console.error('Fatal:', e); process.exit(1); });
