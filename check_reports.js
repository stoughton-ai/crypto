const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
    }
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
}

async function run() {
    const userId = "SF87h3pQoxfkkFfD7zCSOXgtz5h1";
    const snap = await admin.firestore().collection('ticker_intel').where('userId', '==', userId).get();
    const reports = snap.docs.map(d => ({
        id: d.id,
        ticker: d.data().ticker,
        score: d.data().overallScore,
        savedAt: d.data().savedAt
    }));
    reports.sort((a, b) => (b.score || 0) - (a.score || 0));
    console.log(JSON.stringify(reports, null, 2));
}

run();
