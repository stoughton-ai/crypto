
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
    const vpData = vpDoc.data() || {};
    const holdings = vpData.holdings || {};

    console.log("USER_ID:", userId);
    console.log("TOTAL_VALUE:", vpData.totalValue);
    console.log("CASH_BALANCE:", vpData.cashBalance);
    console.log("HOLDINGS_FOR_APT:", JSON.stringify(holdings['APT'] || {}, null, 2));

    const tickerIntel = await adminDb.collection('ticker_intel').doc(`${userId}_APT`).get();
    const intel = tickerIntel.data() || {};
    console.log("APT_INTEL_PRICE:", intel.currentPrice);
    console.log("APT_INTEL_SOURCE:", intel.verificationStatus);
    console.log("APT_INTEL_NAME:", intel.name);
}

check().catch(console.error);
