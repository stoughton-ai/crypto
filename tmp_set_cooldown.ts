import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const usersSnap = await db.collection('agent_configs').get();
    
    for (const doc of usersSnap.docs) {
        const config = doc.data();
        if (!config.arenaEnabled) continue;

        const arenaRef = db.collection('arena_config').doc(doc.id);
        const arenaSnap = await arenaRef.get();
        const arena = arenaSnap.data();
        if (!arena) continue;

        if (arena.pools) {
            for (let i = 0; i < arena.pools.length; i++) {
                arena.pools[i].strategy.evaluationCooldownMinutes = 3;
            }
            await arenaRef.set({ pools: arena.pools }, { merge: true });
            console.log(`Updated evaluationCooldownMinutes to 3 for user: ${doc.id}`);
        }
    }
}
main().then(() => process.exit(0));
