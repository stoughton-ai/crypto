import * as admin from 'firebase-admin';
import 'dotenv/config';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function main() {
    const snap = await db.collection('arena_config').get();
    console.log(`Found ${snap.size} arena_config documents.`);

    snap.forEach(doc => {
        const data = doc.data();
        console.log(`Document ID: ${doc.id}`);
        data.pools.forEach((p: any) => {
            console.log(`  Pool ${p.poolId}: ${p.tokens.join(', ')}`);
        });
    });
}
main().catch(console.error);
