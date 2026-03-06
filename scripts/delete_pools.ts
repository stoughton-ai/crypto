// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

(async () => {
    console.log('Deleting stale discovery pool documents...');
    const snap = await db.collection('discovery_pools').where('userId', '==', userId).get();
    if (snap.empty) {
        console.log('No pools found to delete.');
    } else {
        const batch = db.batch();
        snap.docs.forEach(doc => {
            console.log(`  Deleting ${doc.id}...`);
            batch.delete(doc.ref);
        });
        // Also disable pools in config
        batch.update(db.collection('agent_configs').doc(userId), { discoveryPoolsEnabled: false });
        await batch.commit();
        console.log(`✅ Deleted ${snap.docs.length} pool document(s) and disabled pools.`);
    }
    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
