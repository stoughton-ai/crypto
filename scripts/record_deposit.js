require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function recordDeposit() {
    const snap = await db.collection('virtual_portfolio').limit(1).get();
    if (snap.empty) {
        console.error('No portfolio found');
        process.exit(1);
    }

    const docId = snap.docs[0].id;
    const ref = db.collection('virtual_portfolio').doc(docId);
    const data = snap.docs[0].data();

    const currentNetDeposits = data.netDeposits || 0;
    const amount = 30; // $30 deposit
    const newNetDeposits = currentNetDeposits + amount;

    await ref.update({ netDeposits: newNetDeposits });
    console.log(`Recorded $${amount} deposit for user ${docId}`);
    console.log(`Previous netDeposits: $${currentNetDeposits}`);
    console.log(`New netDeposits: $${newNetDeposits}`);
    process.exit(0);
}

recordDeposit().catch(e => { console.error(e); process.exit(1); });
