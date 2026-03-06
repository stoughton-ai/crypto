// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

(async () => {
    // Check config
    const config = await db.collection('agent_configs').doc(userId).get();
    console.log('discoveryPoolsEnabled:', config.data()?.discoveryPoolsEnabled);

    // Check pools
    const pools = await db.collection('discovery_pools').where('userId', '==', userId).get();
    console.log(`\nFound ${pools.docs.length} pool(s):`);
    for (const doc of pools.docs) {
        const d = doc.data();
        console.log(`  ${doc.id}: ${d.emoji} ${d.name} | status: ${d.status} | tokens: ${d.tokens?.join(', ')} | cash: $${d.cashBalance?.toFixed(2)} | holdings:`, JSON.stringify(d.holdings));
    }

    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
