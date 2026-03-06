
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
    const config = configSnap.docs[0].data();

    const allTickers = [
        ...config.trafficLightTokens,
        ...config.standardTokens,
        ...(config.sandboxTokens || []),
        ...(config.aiWatchlist || [])
    ];

    console.log("USER_ID:", userId);
    for (const t of allTickers) {
        const snap = await adminDb.collection('ticker_intel').doc(`${userId}_${t}`).get();
        const data = snap.data();
        console.log(`${t.padEnd(8)} Price: ${String(data?.currentPrice).padEnd(10)} Name: ${data?.name}`);
    }
}

check().catch(console.error);
