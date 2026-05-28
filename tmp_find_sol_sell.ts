import { adminDb } from './src/lib/firebase-admin';

async function findSolSellsToday() {
    if (!adminDb) return;
    const collections = ['arena_trades', 'arena_trades_ftse', 'arena_trades_nyse', 'arena_trades_commodities', 'discovery_pool_trades', 'virtual_trades'];
    const today = '2026-04-08';

    for (const colName of collections) {
        console.log(`Searching ${colName} for SOL SELL trades today...`);
        const snap = await adminDb.collection(colName)
            .where('ticker', '==', 'SOL')
            .where('type', '==', 'SELL')
            .where('date', '>=', today)
            .get();

        if (snap.empty) continue;

        snap.docs.forEach(doc => {
            const data = doc.data();
            console.log(`[${colName}] FOUND SELL:`);
            console.log(`  Date: ${data.date}`);
            console.log(`  Pool: ${data.poolName}`);
            console.log(`  Reason: ${data.reason}`);
            console.log(`  PnL: ${data.pnl} (${data.pnlPct}%)`);
            if (data.preTradeReflection) console.log(`  Reflection: ${data.preTradeReflection}`);
        });
    }
}

findSolSellsToday().then(() => process.exit(0));
