
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
const envText = fs.readFileSync(envPath, 'utf8');
const match = envText.match(/FIREBASE_SERVICE_ACCOUNT_JSON='(\{[\s\S]+?\})'/);

if (!match) {
    console.error("Could not find FIREBASE_SERVICE_ACCOUNT_JSON in .env.local");
    process.exit(1);
}

const serviceAccount = JSON.parse(match[1]);

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function dumpConfig() {
    const doc = await db.collection('agent_configs').doc(userId).get();
    if (!doc.exists) {
        console.log("No config found for user.");
    } else {
        console.log(JSON.stringify(doc.data(), null, 2));
    }
}

dumpConfig();
