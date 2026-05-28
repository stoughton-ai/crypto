import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    console.log("=== NYSE ARENA DIAGNOSTIC ===");
    const snap = await db.collection('arena_config_nyse').get();
    for (const doc of snap.docs) {
        const data = doc.data();
        console.log(`\nUser: ${doc.id}`);
        console.log(`Shared Cash: ${data.sharedCash ?? 'None'}`);
        
        const pools = data.pools || [];
        let totalCash = 0;
        let totalInvested = 0;
        
        polls_loop: for (const p of pools) {
            totalCash += (p.cashBalance || 0);
            
            const holdings = p.holdings || {};
            let invested = 0;
            for (const ticker of Object.keys(holdings)) {
                invested += (holdings[ticker].amount || 0) * (holdings[ticker].avgPrice || 0);
            }
            totalInvested += invested;
        }

        console.log(`Pool Cash: $${totalCash.toFixed(2)}`);
        console.log(`Pool Invested (Cost Basis): $${totalInvested.toFixed(2)}`);
        
        let targetCashPct = 0;
        if (data.minCashReservePct) {
            targetCashPct = data.minCashReservePct;
        }
        console.log(`Target Minimum Cash Pct: ${targetCashPct}%`);

        if (data.totalValue) {
            console.log(`Total Value reported: $${data.totalValue}`);
        }
    }
}

main().catch(console.error).finally(() => process.exit(0));
