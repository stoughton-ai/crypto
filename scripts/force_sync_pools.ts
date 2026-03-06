// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function fixMess() {
    console.log('=== Forcing Discovery Pools to Match Revolut Reality ===');

    // Exact amounts from user's Revolut account
    const revolutChz = 681.69;
    const revolutEna = 228.5299;

    const batch = db.batch();

    // 1. Force Pool A State
    const poolARef = db.collection('discovery_pools').doc(`${userId}_POOL_A`);
    const poolASnap = await poolARef.get();

    if (poolASnap.exists) {
        let cashA = poolASnap.data()?.cashBalance || 24.55;
        // BTC was sold. Let's add its original ~value back to cash ($50.45) if it hasn't been added already
        // Initial budget was 100.
        // If cash is around 24, we add 50.45.
        if (cashA < 50) {
            cashA += 50.45;
        }

        batch.update(poolARef, {
            cashBalance: cashA,
            holdings: {
                'CHZ': {
                    amount: revolutChz,
                    averagePrice: 0.0366404540836811,
                    peakPrice: 0.0366404540836811
                }
            },
            tokens: ['BTC', 'CHZ'], // Keep BTC in the tokens list so strategy keeps tracking it
            lastUpdated: new Date().toISOString()
        });
        console.log(`Pool A updated: Cash ~$${cashA.toFixed(2)}, CHZ: ${revolutChz}, BTC Removed.`);
    }

    // 2. Force Pool B State
    const poolBRef = db.collection('discovery_pools').doc(`${userId}_POOL_B`);
    const poolBSnap = await poolBRef.get();

    if (poolBSnap.exists) {
        let cashB = poolBSnap.data()?.cashBalance || 50.04;
        // ETH was sold. Add value back to cash ($24.96)
        if (cashB < 60) {
            cashB += 24.96;
        }

        batch.update(poolBRef, {
            cashBalance: cashB,
            holdings: {
                'ENA': {
                    amount: revolutEna,
                    averagePrice: 0.10929637402296066,
                    peakPrice: 0.10929637402296066
                }
            },
            tokens: ['ETH', 'ENA'], // Keep ETH
            lastUpdated: new Date().toISOString()
        });
        console.log(`Pool B updated: Cash ~$${cashB.toFixed(2)}, ENA: ${revolutEna}, ETH Removed.`);
    }

    await batch.commit();
    console.log('✅ Discovery Pools forcefully synchronized with actual Revolut balances.');
    process.exit(0);
}

fixMess().catch(e => { console.error('Fatal:', e); process.exit(1); });
