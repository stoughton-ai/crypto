require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

initializeApp({
    credential: cert(serviceAccount)
});

const adminDb = getFirestore();

async function check() {
    const users = await adminDb.collection("virtual_portfolio").get();
    let userId = '';
    users.forEach(u => {
        console.log('User found:', u.id);
        userId = u.id;
    });

    if (!userId) return;

    const vpRef = adminDb.collection('virtual_portfolio').doc(userId);
    const hs = await adminDb.collection('virtual_portfolio_history').where("userId", "==", userId).get();
    const tr = await adminDb.collection('virtual_trades').where("userId", "==", userId).get();
    const dec = await adminDb.collection('virtual_decisions').where("userId", "==", userId).get();

    console.log(`History count: ${hs.size}`);
    console.log(`Trades count: ${tr.size}`);
    console.log(`Decisions count: ${dec.size}`);
}

check().catch(console.error);
