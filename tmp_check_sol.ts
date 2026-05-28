import { adminDb } from './src/lib/firebase-admin';

async function checkRecentSolTrades() {
    if (!adminDb) {
        console.error('Admin DB not initialized');
        return;
    }

    try {
        const collections = ['arena_trades', 'crypto_arena_trades'];
        for (const colName of collections) {
            console.log(`Checking collection: ${colName}`);
            const tradesSnap = await adminDb.collection(colName)
                .orderBy('date', 'desc')
                .limit(100)
                .get();

            if (tradesSnap.empty) {
                console.log(`No trades found in ${colName}`);
                continue;
            }

            const solTrades = tradesSnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter((t: any) => t.ticker === 'SOL');

            if (solTrades.length === 0) {
                console.log(`No SOL trades found in recent 100 docs of ${colName}`);
                continue;
            }

            solTrades.slice(0, 5).forEach((data: any) => {
                console.log('--- TRADE ---');
                console.log(`ID: ${data.id}`);
                console.log(`Type: ${data.type}`);
                console.log(`Date: ${data.date}`);
                console.log(`Price: ${data.price}`);
                console.log(`Total: ${data.total}`);
                console.log(`Reason: ${data.reason}`);
                console.log(`Pool: ${data.poolName} (${data.poolId})`);
                if (data.preTradeReflection) {
                    console.log(`Reflection: ${data.preTradeReflection}`);
                }
            });
        }
    } catch (error) {
        console.error('Error fetching trades:', error);
    }
}

checkRecentSolTrades().then(() => process.exit(0));
