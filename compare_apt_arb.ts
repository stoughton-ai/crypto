
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

    const aptIntel = await adminDb.collection('ticker_intel').doc(`${userId}_APT`).get();
    const arbIntel = await adminDb.collection('ticker_intel').doc(`${userId}_ARB`).get();

    console.log("APT_INTEL_PRICE:", aptIntel.data()?.currentPrice);
    console.log("ARB_INTEL_PRICE:", arbIntel.data()?.currentPrice);
}

check().catch(console.error);
