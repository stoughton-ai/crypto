import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

async function run() {
    if (!admin.apps.length) {
        const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!saStr) throw new Error("No env var");
        const sa = JSON.parse(saStr);
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    const adminDb = admin.firestore();

    // Update ALL users' maxOpenPositions to 16
    const snap = await adminDb.collection('agent_configs').get();
    console.log(`Found ${snap.size} user config(s). Updating maxOpenPositions to 16...`);

    for (const doc of snap.docs) {
        const current = doc.data().maxOpenPositions;
        await doc.ref.update({ maxOpenPositions: 16 });
        console.log(`  ${doc.id.substring(0, 8)}: ${current ?? 'unset'} → 16`);
    }

    console.log('Done!');
}

run().catch(console.error);
