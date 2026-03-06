// Seed QuotaGuard usage in Firestore with already-consumed calls
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());

const admin = require('firebase-admin');

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON env var");
    const sa = JSON.parse(saStr);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = admin.firestore();

async function seed() {
    const monthKey = '2026-03';
    const ALREADY_USED = 1161;

    console.log(`Seeding QuotaGuard usage for ${monthKey} with ${ALREADY_USED} calls...`);

    await db.collection('quotaguard_usage').doc(monthKey).set({
        month: monthKey,
        totalCalls: ALREADY_USED,
        lastUpdated: new Date().toISOString(),
        seededAt: new Date().toISOString(),
        seedReason: 'Manual seed from QuotaGuard dashboard - 1161 calls already used before tracking was implemented',
    });

    const snap = await db.collection('quotaguard_usage').doc(monthKey).get();
    const data = snap.data();
    console.log(`✅ Seeded: ${JSON.stringify(data, null, 2)}`);
    console.log(`\nBudget: ${ALREADY_USED} / 18,000 used (${(ALREADY_USED / 18000 * 100).toFixed(1)}%)`);
    console.log(`Remaining: ${18000 - ALREADY_USED}`);
    console.log(`Days remaining in March: ${31 - new Date().getDate() + 1}`);
    console.log(`Daily budget: ${Math.floor((18000 - ALREADY_USED) / (31 - new Date().getDate() + 1))}/day`);
}

seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
