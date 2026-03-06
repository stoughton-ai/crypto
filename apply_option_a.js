/**
 * apply_option_a.js
 * Pushes Option A (Concentrated Momentum Focus) settings into Firebase agent_configs.
 * Run once with: node apply_option_a.js
 */
require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// OPTION A — Concentrated Momentum Focus
const OPTION_A_SETTINGS = {
    // Scoring: only enter on HIGH CONVICTION
    buyScoreThreshold: 72,
    scalingScoreThreshold: 80,
    aiScoreExitThreshold: 58,
    // Sizing: meaningful positions only
    maxAllocationPerAsset: 400,
    minOrderAmount: 150,
    // Cash cushion
    minCashReservePct: 10,
    // Stop losses unchanged
    positionStopLoss: -15,
    portfolioStopLoss: 25,
    // Market cap: medium-large only
    minMarketCap: 100,
};

async function apply() {
    const usersSnap = await db.collection('agent_configs').get();
    if (usersSnap.empty) {
        console.log('No agent_configs documents found.');
        return;
    }

    const batch = db.batch();
    usersSnap.docs.forEach(docSnap => {
        batch.update(docSnap.ref, OPTION_A_SETTINGS);
        console.log(`Queued update for user: ${docSnap.id}`);
    });

    await batch.commit();
    console.log('\n✅ Option A settings applied to all agent_configs.');
    console.log('New values:', OPTION_A_SETTINGS);
}

apply().catch(e => {
    console.error('Failed:', e);
    process.exit(1);
});
