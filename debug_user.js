
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Manual env parsing for multi-line JSON
const envPath = path.resolve(__dirname, '.env.local');
let serviceAccountStr = '';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*(['"])([\s\S]*?)\1/);
    if (match) {
        serviceAccountStr = match[2];
    }
}

if (!serviceAccountStr) {
    console.error("Could not find FIREBASE_SERVICE_ACCOUNT_JSON in .env.local");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountStr);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

async function run() {
    console.log("Fetching users...");
    const usersSnap = await db.collection('agent_configs').get();

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        const config = userDoc.data();
        console.log(`\n--- User: ${userId} ---`);
        console.log(`Risk Profile: ${config.riskProfile}`);
        console.log(`Automation Enabled: ${config.automationEnabled}`);

        const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
        if (vpDoc.exists) {
            const vp = vpDoc.data();
            console.log(`Cash Balance: $${vp.cashBalance}`);
            console.log(`Holdings:`, JSON.stringify(vp.holdings, null, 2));
        } else {
            console.log("No virtual portfolio found.");
        }

        // Check recent decisions (Client side sort to avoid index error)
        console.log("\nRecent Decisions (last 20):");
        const decSnap = await db.collection('virtual_decisions')
            .where('userId', '==', userId)
            .get();

        const decisions = decSnap.docs.map(d => d.data());
        decisions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        decisions.slice(0, 20).forEach(data => {
            console.log(`[${data.timestamp}] ${data.ticker} ${data.action}: ${data.reason} (Score: ${data.score}, Price: ${data.price})`);
        });

        // Check recent intel for ORCA and CC
        console.log("\nRecent Intel for ORCA/CC:");
        const intelSnap = await db.collection('ticker_intel')
            .where('userId', '==', userId)
            .get();

        intelSnap.forEach(d => {
            const data = d.data();
            const t = String(data.ticker).toUpperCase();
            if (t === 'ORCA' || t === 'CC') {
                console.log(`${t}: Score=${data.overallScore}, Price=${data.currentPrice}, Mcap=${data.marketCap}`);
            }
        });
    }
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
