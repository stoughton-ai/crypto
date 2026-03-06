
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
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const doc = await db.collection('agent_configs').doc(userId).get();
    if (doc.exists) {
        const data = doc.data();
        console.log("Risk Profile:", data.riskProfile);
        console.log("Automation:", data.automationEnabled);
        console.log("Excluded Tokens:", data.excludedTokens);
        console.log("Traffic Light:", data.trafficLightTokens);
        console.log("Standard:", data.standardTokens);
        console.log("Sandbox:", data.sandboxTokens);
        console.log("AI Watchlist:", data.aiWatchlist);
    } else {
        console.log("Not found");
    }
    process.exit(0);
}
run();
