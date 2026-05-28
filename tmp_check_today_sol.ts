import { adminDb } from './src/lib/firebase-admin';

async function checkTodaySolTrades() {
    if (!adminDb) return;
    const collections = ['arena_trades', 'arena_trades_ftse', 'arena_trades_nyse', 'arena_trades_commodities', 'virtual_trades'];
    const today = '2026-04-08';

    for (const colName of collections) {
        console.log(`Checking ${colName} for SOL trades on ${today}...`);
        const snap = await adminDb.collection(colName)
            .where('ticker', '==', 'SOL')
            .where('date', '>=', today)
            .get();

        if (snap.empty) {
            console.log(`  No SOL trades found in ${colName}`);
            continue;
        }

        snap.docs.forEach(doc => {
            const data = doc.data();
            console.log(`  [${data.type}] ${data.date} | ${data.poolName} | Reason: ${data.reason}`);
        });
    }
}

checkTodaySolTrades().then(() => process.exit(0));
