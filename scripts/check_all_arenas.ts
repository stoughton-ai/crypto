import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function check() {
    const classes = ['CRYPTO', 'FTSE', 'NYSE', 'COMMODITIES'];
    for (const ac of classes) {
        let col = 'arena_config';
        if (ac !== 'CRYPTO') col = 'arena_config_' + ac.toLowerCase().replace(' ', '_');
        const snap = await db.collection(col).doc(userId).get();
        const data = snap.data();
        console.log(`${ac}: ${data ? 'Exists' : 'Missing'}, Initialized: ${data?.initialized ?? 'N/A'}`);
        if (data?.initialized === false) {
            console.log(`  Warning: ${ac} is EXISTS but NOT INITIALIZED`);
        }
    }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
