// Fix: Reverse $511.72 incorrectly classified as a deposit.
// The manual Revolut sale proceeds were misattributed to netDeposits.
// Run: node scripts/fix_net_deposits.js
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
const db = admin.firestore();

const CORRECTION = -511.72; // Reverse the incorrect deposit

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
    const newNetDeposits = oldNetDeposits + CORRECTION;

    console.log(`User: ${userId}`);
    console.log(`Current netDeposits: $${oldNetDeposits.toFixed(2)}`);
    console.log(`Correction:         $${CORRECTION.toFixed(2)}`);
    console.log(`New netDeposits:     $${newNetDeposits.toFixed(2)}`);

    await vpRef.update({ netDeposits: newNetDeposits });
    console.log(`\n✅ netDeposits corrected. Trading P&L will now reflect accurately.`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
