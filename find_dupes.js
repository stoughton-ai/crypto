
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

async function findDupes() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const tradesSnap = await db.collection('arena_trades_ftse').where('userId', '==', userId).get();
    const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    for (let i = 0; i < trades.length; i++) {
        for (let j = i + 1; j < trades.length; j++) {
            const t1 = trades[i];
            const t2 = trades[j];
            
            if (t1.ticker === t2.ticker && t1.type === t2.type && 
                Math.abs(t1.amount - t2.amount) < 0.000001 &&
                Math.abs(t1.price - t2.price) < 0.0001) {
                
                const timeDiffHours = Math.abs(new Date(t1.date).getTime() - new Date(t2.date).getTime()) / (1000 * 60 * 60);
                if (timeDiffHours < 4) { // within 4 hours
                    console.log(`⚠️ POTENTIAL DUPLICATE: ${t1.ticker} ${t1.type} @ £${t1.price.toFixed(4)} (Amt: ${t1.amount.toFixed(4)})`);
                    console.log(`  - 1: ${t1.id} (${t1.date})`);
                    console.log(`  - 2: ${t2.id} (${t2.date})`);
                    console.log(`  - Time Diff: ${timeDiffHours.toFixed(2)} hours`);
                }
            }
        }
    }
}

findDupes().then(() => process.exit(0));
