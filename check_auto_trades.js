
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env.local');
let serviceAccountStr = '';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*(['"])([\s\S]*?)\1/);
    if (match) serviceAccountStr = match[2];
}
const serviceAccount = JSON.parse(serviceAccountStr);
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function checkAuto() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const tradesSnap = await db.collection('arena_trades_ftse')
        .where('userId', '==', userId)
        .where('ticker', '==', 'ITV')
        .get();
    
    const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    console.log("ITV Trades:");
    trades.forEach(t => {
        console.log(`[${t.date}] ${t.type} ${t.amount.toFixed(4)} @ £${t.price.toFixed(2)} (Total: £${t.total.toFixed(2)}) ID: ${t.id}`);
    });
}

checkAuto().then(() => process.exit(0));
