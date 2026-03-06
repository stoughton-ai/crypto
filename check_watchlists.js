require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function check() {
    const snap = await db.collection('agent_configs').get();
    snap.docs.forEach(doc => {
        const d = doc.data();
        const traffic = d.trafficLightTokens || [];
        const standard = d.standardTokens || [];
        const sandbox = d.sandboxTokens || [];
        const ai = d.aiWatchlist || [];
        const total = traffic.length + standard.length + sandbox.length + ai.length;

        console.log(`\n=== User: ${doc.id} ===`);
        console.log(`Priority   (${traffic.length}): ${traffic.join(', ')}`);
        console.log(`Standard   (${standard.length}): ${standard.join(', ')}`);
        console.log(`Sandbox    (${sandbox.length}): ${sandbox.join(', ')}`);
        console.log(`AI Watch   (${ai.length}): ${ai.join(', ')}`);
        console.log(`Total tracked: ${total} tokens`);
        console.log(`Risk Profile: ${d.riskProfile}`);
        console.log(`Buy Threshold: ${d.buyScoreThreshold}, Exit: ${d.aiScoreExitThreshold}, Min Order: $${d.minOrderAmount}`);
    });
}

check().catch(e => { console.error(e); process.exit(1); });
