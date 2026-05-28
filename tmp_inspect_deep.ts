
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();
const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    console.log('--- Inspecting Agent Config for User ' + USER_ID + ' ---');
    const agentRef = db.collection('agent_configs').doc(USER_ID);
    const agentSnap = await agentRef.get();
    if (agentSnap.exists) {
        console.log('Agent Config:', JSON.stringify(agentSnap.data(), null, 2));
    }

    console.log('\n--- Recent System Logs ---');
    const logsSnap = await db.collection('arena_config').doc(USER_ID).collection('system_logs')
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();
    logsSnap.docs.forEach(d => console.log(`[${d.data().timestamp}] ${d.data().type}: ${d.data().description}`));

    console.log('\n--- DCA Config History (full) ---');
    const dcaSnap = await db.collection('dca_config').doc(USER_ID).get();
    if (dcaSnap.exists) {
        console.log(JSON.stringify(dcaSnap.data()?.history || [], null, 2));
    }
}

main().catch(console.error);
