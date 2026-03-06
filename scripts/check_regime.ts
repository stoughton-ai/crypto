import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function main() {
    const d = await db.collection("agent_configs").doc("SF87h3pQoxfkkFfD7zCSOXgtz5h1").get();
    const c = d.data()!;
    console.log("riskProfile:", c.riskProfile);
    console.log("lastRegimeRecommendation:", c.lastRegimeRecommendation);
    console.log("regimeConsecutiveCount:", c.regimeConsecutiveCount);
    console.log("lastRegimeSwitchAt:", c.lastRegimeSwitchAt);
    console.log("lastRegimeSwitchFrom:", c.lastRegimeSwitchFrom);
    console.log("momentum:", c.momentumSentinel?.currentMomentum);
    console.log("momentumChange:", c.momentumSentinel?.changePercent);
    console.log("automationEnabled:", c.automationEnabled);
    console.log("newsAlerts:", c.newsIntelligence?.activeAlerts?.length || 0);
    const now = new Date();
    for (const a of (c.newsIntelligence?.activeAlerts || [])) {
        const expired = new Date(a.expiresAt) < now;
        console.log(`  [${a.severity}] ${expired ? 'EXPIRED' : 'ACTIVE'} exp:${a.expiresAt} | ${(a.headline || '').substring(0, 70)}`);
    }
    console.log("lastNewsCheck:", c.newsIntelligence?.lastChecked);
    process.exit(0);
}
main();
