// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config({ path: '.env.local' });
import * as admin from 'firebase-admin';

// Load directly from the project's env
const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountString) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local.");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountString);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

async function findTargetUser() {
    console.log('Searching for arena config matching user report...');
    const snap = await db.collection('arena_config').get();

    let found = false;
    snap.forEach(doc => {
        const data = doc.data();
        if (!data.pools) return;
        const tokens = data.pools.flatMap((p: any) => p.tokens);

        // The user's reported tokens: ICP, RENDER, AAVE, LINK, DOT, ADA, FLOKI, SHIB
        if (tokens.includes('ICP') || tokens.includes('RENDER')) {
            console.log(`\n🎯 FOUND POTENTIAL MATCH: User ID ${doc.id}`);
            data.pools.forEach((p: any) => {
                console.log(`  Pool ${p.poolId} (${p.name}): ${p.tokens.join(', ')}`);
                console.log(`    Cash: $${p.cashBalance?.toFixed(2)}`);
            });
            found = true;
        }
    });

    if (!found) {
        console.log('No arena_config found matching ICP/RENDER.');
    }
}

findTargetUser().catch(console.error);
