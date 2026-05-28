import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function check() {
    const usersSnap = await db.collection('agent_configs').get();
    for (const doc of usersSnap.docs) {
        const config = doc.data();
        if (!config.arenaEnabled) continue;
        
        const arenaSnap = await db.collection('arena_config').doc(doc.id).get();
        const arena = arenaSnap.data();
        
        console.log(`\nUser: ${doc.id}`);
        console.log(`Shared Cash: $${arena?.sharedCash}`);
        if (arena?.pools) {
            for (const pool of arena.pools) {
                console.log(`\nPool: ${pool.name}`);
                const holdings = pool.holdings || {};
                const keys = Object.keys(holdings);
                if (keys.length === 0) {
                    console.log(`  Holdings: None`);
                } else {
                    for (const k of keys) {
                        const h = holdings[k];
                        console.log(`  ${k}: ${h.amount} tokens @ $${h.averagePrice}`);
                    }
                }
            }
        }
    }
}
check().then(() => process.exit(0));
