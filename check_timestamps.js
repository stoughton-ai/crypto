
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env.local');
let serviceAccountStr = '';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*(['"])([\s\S]*?)\1/);
    if (match) {
        serviceAccountStr = match[2];
    }
}

const serviceAccount = JSON.parse(serviceAccountStr);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

async function run() {
    const usersSnap = await db.collection('agent_configs').get();

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const config = userDoc.data();
        console.log(`\n--- User: ${userId} ---`);
        console.log(`Last Checks:`, config.lastCheck);
        console.log(`Last Trades:`, config.lastTrade);
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
