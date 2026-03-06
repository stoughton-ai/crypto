
import * as fs from 'fs';
import * as path from 'path';

// Load Env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
    }
}

async function check() {
    const { adminDb } = await import('./src/lib/firebase-admin');
    if (!adminDb) return;

    const configSnap = await adminDb.collection('agent_configs').limit(1).get();
    if (configSnap.empty) return;
    const userId = configSnap.docs[0].id;

    const vpDoc = await adminDb.collection('virtual_portfolio').doc(userId).get();
    const vpData = vpDoc.data();

    console.log("USER_ID:", userId);
    console.log("VIRTUAL_PORTFOLIO:", JSON.stringify(vpData, null, 2));

    const tickerIntel = await adminDb.collection('ticker_intel').doc(`${userId}_APT`).get();
    console.log("APT_INTEL:", JSON.stringify(tickerIntel.data(), null, 2));
}

check().catch(console.error);
