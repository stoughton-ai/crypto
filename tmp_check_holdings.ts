import { adminDb } from './src/lib/firebase-admin';

async function checkArenaConfigs() {
    if (!adminDb) return;
    const snap = await adminDb.collection('arena_config').get();
    console.log(`Found ${snap.size} arena configs`);
    snap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`User: ${doc.id}`);
        data.pools?.forEach((pool: any) => {
            if (pool.holdings) {
                Object.keys(pool.holdings).forEach(ticker => {
                    if (ticker.toUpperCase() === 'SOL') {
                        console.log(`  Pool: ${pool.name} (${pool.poolId}) holds SOL:`, pool.holdings[ticker]);
                    }
                });
            }
        });
    });
}

checkArenaConfigs().then(() => process.exit(0));
