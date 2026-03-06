import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr!)) });
}

async function check() {
    const doc = await admin.firestore().collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const data = doc.data()!;
    console.log('traffic:', data.trafficLightTokens);
    console.log('standard:', data.standardTokens);
    console.log('sandbox:', data.sandboxTokens);
    console.log('ai:', data.aiWatchlist);
    process.exit(0);
}
check().catch(console.error);
