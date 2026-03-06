require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({
  credential: cert(serviceAccount)
});

const adminDb = getFirestore();
const userId = "tZgUqXYVl6e7B1T9iZ98w77v6Fq2"; // We don't have the user ID. We need to find the user ID.

async function check() {
  const users = await adminDb.collection("agent_configs").get();
  users.forEach(u => console.log(u.id));
}
check();
