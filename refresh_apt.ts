
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
    const { refreshPrices, getServerAgentConfig } = await import('./src/app/actions');
    if (!adminDb) return;

    const configSnap = await adminDb.collection('agent_configs').limit(1).get();
    if (configSnap.empty) return;
    const userId = configSnap.docs[0].id;

    console.log("Refreshing price for APT...");
    await refreshPrices(userId, ['APT']);

    const tickerIntel = await adminDb.collection('ticker_intel').doc(`${userId}_APT`).get();
    const data = tickerIntel.data();
    console.log("UPDATED_APT_PRICE:", data?.currentPrice);
    console.log("UPDATED_APT_NAME:", data?.name);
}

check().catch(console.error);
