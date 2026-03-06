require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

initializeApp({
    credential: cert(serviceAccount)
});

const adminDb = getFirestore();

async function check() {
    const users = await adminDb.collection("agent_configs").get();
    console.log('Configs:', users.docs.length);
    users.forEach(u => console.log(u.id));
}

check().catch(console.error);
