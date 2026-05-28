import { adminDb } from './src/lib/firebase-admin';

async function checkRecentActivity() {
    if (!adminDb) return;
    const collections = ['arena_trades', 'arena_trades_ftse', 'arena_trades_nyse', 'arena_trades_commodities', 'discovery_pool_trades', 'virtual_trades'];
    
    for (const colName of collections) {
        console.log(`\n--- ${colName} (Last 10) ---`);
        try {
            const snap = await adminDb.collection(colName)
                .orderBy('date', 'desc')
                .limit(10)
                .get();

            if (snap.empty) {
                console.log('No trades found.');
                continue;
            }

            snap.docs.forEach(doc => {
                const data = doc.data();
                console.log(`[${data.type}] ${data.date} | ${data.ticker} | ${data.poolName} | Reason: ${data.reason}`);
            });
        } catch (e: any) {
            console.log(`Error: ${e.message}`);
        }
    }
}

checkRecentActivity().then(() => process.exit(0));
