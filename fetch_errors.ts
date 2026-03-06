import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

async function run() {
    console.log("Initializing firebase-admin...");
    if (!admin.apps.length) {
        const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!saStr) throw new Error("No env var");
        const sa = JSON.parse(saStr);
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    const adminDb = admin.firestore();

    console.log("Fetching recent FAIL decisions...");
    const snapshot = await adminDb.collection('virtual_decisions')
        .orderBy('timestamp', 'desc')
        .limit(100)
        .get();

    if (snapshot.empty) {
        console.log("No failed decisions found.");
        return;
    }

    const docs = snapshot.docs.map(d => d.data());
    const fails = docs.filter(d => d.action === 'FAIL');

    console.log(`Found ${fails.length} failed decisions out of last 100:`);
    fails.forEach(data => {
        console.log(`- [${data.timestamp}] ${data.ticker}: ${data.reason}`);
    });
}

run().catch(console.error);
