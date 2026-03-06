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

    console.log("Fetching EODHD usage records...");
    const snapshot = await adminDb.collection('eodhd_usage')
        .orderBy('date', 'desc')
        .limit(1)
        .get();

    if (snapshot.empty) {
        console.log("No usage records found.");
        return;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    console.log(`\nDate: ${data.date}`);
    console.log(`Latest: ${JSON.stringify(data.latest, null, 2)}`);

    if (data.snapshots && data.snapshots.length > 0) {
        const lastFew = data.snapshots.slice(-10);
        console.log("\nLast 10 snapshots:");
        lastFew.forEach((s: any) => {
            console.log(`- [${s.ts}] Used: ${s.used} (${s.pct}%)`);
        });

        // Calculate rate per hour
        if (data.snapshots.length > 1) {
            const first = data.snapshots[0];
            const last = data.snapshots[data.snapshots.length - 1];
            const diff = last.used - first.used;
            const timeDiff = (new Date(last.ts).getTime() - new Date(first.ts).getTime()) / (1000 * 60 * 60);
            console.log(`\nEstimated rate: ${Math.round(diff / timeDiff)} calls/hour`);
        }
    }
}

run().catch(console.error);
