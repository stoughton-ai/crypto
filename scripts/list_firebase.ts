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

    console.log("Listing collections...");
    const collections = await adminDb.listCollections();
    console.log("Collections:", collections.map(c => c.id));

    for (const coll of collections) {
        if (coll.id.includes('usage') || coll.id.includes('eodhd')) {
            const snap = await coll.limit(5).get();
            console.log(`\nCollection: ${coll.id} (Total docs: ${snap.size})`);
            snap.docs.forEach(d => console.log(`- ${d.id}:`, JSON.stringify(d.data(), null, 2).slice(0, 200)));
        }
    }
}

run().catch(console.error);
