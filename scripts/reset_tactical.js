require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Reset to TRUE TACTICAL defaults
    const updates = {
        minOrderAmount: 150,
        buyAmountDefault: 150,
        buyAmountScore80: 250,
        buyAmountScore90: 400,
        scalingChunkSize: 100,
        maxAllocationPerAsset: 400,
        minCashReservePct: 10,
        minMarketCap: 100,
        maxOpenPositions: 6,  // B5: Concentrated positions
    };

    console.log('Resetting to TACTICAL defaults:');
    for (const [k, v] of Object.entries(updates)) {
        console.log(`  ${k}: → ${v}`);
    }

    await db.collection('agent_configs').doc(userId).update(updates);
    console.log('\n✅ Config reset complete.');

    // Verify
    const d = (await db.collection('agent_configs').doc(userId).get()).data();
    console.log('\nVerification:');
    for (const k of Object.keys(updates)) {
        console.log(`  ${k}: ${d[k]}`);
    }

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
