// Fix: Reset netDeposits to correct value ($100).
//
// BACKGROUND:
// The total_reset.js script set netDeposits=0, then $100 was manually deposited
// on 2026-02-28 (fix_deposit_feb28.js). However, the reconciliation logic's
// low $5 threshold caused repeated false "withdrawal" detections from spread
// costs and slippage on Revolut market orders. This accumulated to push
// netDeposits down to -$25.47 (as of 2026-03-01).
//
// The reconciliation code has been fixed (proportional 1% threshold + recent
// trade guard), so this should not recur.
//
// Run: node scripts/fix_net_deposits_mar01.js

require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
const db = admin.firestore();

const CORRECT_NET_DEPOSITS = 100; // $100 actual deposit on Feb 28

async function run() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Read current virtual portfolio
    const vpRef = db.collection('virtual_portfolio').doc(userId);
    const vpSnap = await vpRef.get();
    if (!vpSnap.exists) { console.error('No virtual portfolio found'); process.exit(1); }

    const data = vpSnap.data();
    const oldNetDeposits = data.netDeposits || 0;

    console.log(`User: ${userId}`);
    console.log(`Current netDeposits:  $${oldNetDeposits.toFixed(2)}`);
    console.log(`Correct netDeposits:  $${CORRECT_NET_DEPOSITS.toFixed(2)}`);
    console.log(`Correction:           $${(CORRECT_NET_DEPOSITS - oldNetDeposits).toFixed(2)}`);

    // Update the main portfolio document
    await vpRef.update({ netDeposits: CORRECT_NET_DEPOSITS });
    console.log(`\n✅ Main portfolio netDeposits corrected to $${CORRECT_NET_DEPOSITS.toFixed(2)}.`);

    // Also fix today's history snapshots that have the wrong netDeposits
    const todayStart = '2026-03-01T00:00:00.000Z';
    const collections = ['virtual_portfolio_history', 'portfolio_history'];

    for (const collName of collections) {
        try {
            const histSnap = await db.collection(collName)
                .where('userId', '==', userId)
                .where('date', '>=', todayStart)
                .get();

            if (histSnap.size > 0) {
                console.log(`\nFixing ${histSnap.size} history snapshots in ${collName}...`);
                const batch = db.batch();
                histSnap.docs.forEach(doc => {
                    batch.update(doc.ref, { netDeposits: CORRECT_NET_DEPOSITS });
                });
                await batch.commit();
                console.log(`✅ ${histSnap.size} snapshots updated.`);
            } else {
                console.log(`\nNo history snapshots from today in ${collName}.`);
            }
        } catch (e) {
            console.log(`\n⚠ Could not fix ${collName}: ${e.message}`);
        }
    }

    console.log(`\n🎉 Done. Net deposits corrected. P&L calculations will be accurate.`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
