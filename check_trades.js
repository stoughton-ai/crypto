
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
    const tradesSnap = await db.collection('virtual_trades').get();
    const trades = tradesSnap.docs.map(d => d.data());
    trades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log("Recent Trades (last 10):");
    trades.slice(0, 10).forEach(t => {
        console.log(`[${t.date}] ${t.ticker} ${t.type} ${t.amount} @ ${t.price} ($${t.total}) - ${t.reason}`);
    });
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
