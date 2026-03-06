// Fix: Record $100 manual deposit on 2026-02-28.
// User deposited $100 into Revolut and then bought $100 of XRP.
// The reconciliation detected the new XRP holding but didn't classify
// it as a deposit, so it appeared as instant profit.
//
// This script increments netDeposits by $100 and also fixes any
// history snapshots from today that have stale netDeposits values.
//
// Run: node scripts/fix_deposit_feb28.js

require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
const db = admin.firestore();

const DEPOSIT_AMOUNT = 100; // $100 manual deposit

async function run() {
    // Find the user
    const snap = await db.collection('agent_configs').limit(1).get();
    if (snap.empty) { console.error('No agent_config found'); process.exit(1); }
    const userId = snap.docs[0].id;

    // Read current virtual portfolio
    const vpRef = db.collection('virtual_portfolio').doc(userId);
    const vpSnap = await vpRef.get();
    if (!vpSnap.exists) { console.error('No virtual portfolio found'); process.exit(1); }

    const data = vpSnap.data();
    const oldNetDeposits = data.netDeposits || 0;
    const newNetDeposits = oldNetDeposits + DEPOSIT_AMOUNT;

    console.log(`User: ${userId}`);
    console.log(`Current netDeposits: $${oldNetDeposits.toFixed(2)}`);
    console.log(`Adding deposit:      $${DEPOSIT_AMOUNT.toFixed(2)}`);
    console.log(`New netDeposits:      $${newNetDeposits.toFixed(2)}`);

    // Update the main portfolio document
    await vpRef.update({ netDeposits: newNetDeposits });
    console.log(`\n✅ Main portfolio netDeposits updated.`);

    // Also fix history snapshots from today (2026-02-28) that recorded the old netDeposits
    const todayStart = '2026-02-28T00:00:00.000Z';
    const histSnap = await db.collection('virtual_portfolio_history')
        .where('userId', '==', userId)
        .where('date', '>=', todayStart)
        .get();

    if (histSnap.size > 0) {
        console.log(`\nFixing ${histSnap.size} history snapshots from today...`);
        const batch = db.batch();
        histSnap.docs.forEach(doc => {
            batch.update(doc.ref, { netDeposits: newNetDeposits });
        });
        await batch.commit();
        console.log(`✅ ${histSnap.size} history snapshots updated with correct netDeposits.`);
    } else {
        console.log(`\nNo history snapshots from today to fix.`);
    }

    console.log(`\n🎉 Done. Trading P&L will now correctly exclude the $${DEPOSIT_AMOUNT} deposit.`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
