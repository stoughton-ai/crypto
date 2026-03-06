// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function simulateGetDiscoveryPoolStatus() {
    console.log('\n=== Simulating getDiscoveryPoolStatus ===\n');

    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const discoveryPoolsEnabled = configDoc.exists ? configDoc.data()?.discoveryPoolsEnabled === true : false;
    console.log('discoveryPoolsEnabled (raw from Firestore):', discoveryPoolsEnabled);

    const snap = await db.collection('discovery_pools').where('userId', '==', userId).get();
    const pools = snap.docs.map(d => d.data());
    console.log(`\nPools found: ${pools.length}`);

    const effectivelyEnabled = discoveryPoolsEnabled || pools.length > 0;
    console.log('effectivelyEnabled:', effectivelyEnabled);

    if (!effectivelyEnabled) {
        console.log('→ Would return: { enabled: false, pools: [] }');
        return;
    }

    for (const p of pools) {
        console.log(`\nPool: ${p.poolId} | ${p.emoji} ${p.name} | status: ${p.status}`);
        console.log(`  tokens: ${p.tokens?.join(', ')}`);
        console.log(`  cash: $${p.cashBalance?.toFixed(2)}`);
        console.log(`  holdings keys: ${Object.keys(p.holdings || {}).join(', ')}`);
        console.log(`  performance: `, p.performance);
        console.log(`  strategy: `, p.strategy);
    }

    // Check pool trades
    const tradesSnap = await db.collection('pool_trades').where('userId', '==', userId).limit(10).get();
    console.log(`\nPool trades found: ${tradesSnap.size}`);

    console.log('\n→ Would return: { enabled: true, pools: [' + pools.length + ' pools] }');
}

simulateGetDiscoveryPoolStatus()
    .then(() => process.exit(0))
    .catch(e => { console.error('Fatal:', e); process.exit(1); });
