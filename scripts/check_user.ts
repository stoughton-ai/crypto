import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr!)) });
}

async function check() {
    const db = admin.firestore();
    const doc = await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const data = doc.data()!;
    console.log('automationEnabled:', data.automationEnabled);
    console.log('realTradingEnabled:', data.realTradingEnabled);
    console.log('revolutApiKey:', !!data.revolutApiKey);
    console.log('revolutPrivateKey:', !!data.revolutPrivateKey);
    console.log('revolutIsSandbox:', data.revolutIsSandbox);
    process.exit(0);
}
check().catch(console.error);
