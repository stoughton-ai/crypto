/**
 * align_option_a.js
 * Fully aligns the agent configuration with Option A: Concentrated Momentum Focus.
 *
 * Changes applied:
 * 1. riskProfile: 'RISK' → 'TACTICAL'
 * 2. Watchlists rebuilt for concentrated, high-liquidity focus:
 *    Priority  (3): BTC, ETH, SOL  — highest liquidity anchors on Revolut X
 *    Standard  (4): XRP, AVAX, LINK, SUI — solid mid-large caps with proven Revolut support
 *    Sandbox   (2): PEPE, WIF — small speculative allowance (subject to buying rules)
 *    AI Watch  (0): cleared — engine will self-populate with merit-based discoveries
 * 3. All Option A thresholds confirmed (already set by apply_option_a.js)
 * 4. Analysis cycles tightened — fewer tokens = faster, tighter cycles
 */

require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const OPTION_A_CONFIG = {
    // ── RISK PROFILE ─────────────────────────────────────────────
    riskProfile: 'TACTICAL',  // Maps to Concentrated Momentum Focus

    // ── WATCHLISTS ────────────────────────────────────────────────
    // Priority: Anchor blue-chips — highest Revolut X liquidity, always monitored
    trafficLightTokens: ['BTC', 'ETH', 'SOL'],

    // Standard: Quality mid-large caps — proven Revolut tradeable, strong fundamentals
    standardTokens: ['XRP', 'AVAX', 'LINK', 'SUI'],

    // Sandbox: Minimal speculative exposure — strictly gated by new rules
    sandboxTokens: ['PEPE', 'WIF'],

    // AI Watch: Start empty — the engine will inject discovered high-scorers itself
    aiWatchlist: [],

    // ── ANALYSIS CYCLES (Hours) ───────────────────────────────────
    // Fewer tokens = we can afford faster, more responsive cycles
    trafficCycle: 0.166,   // Priority: every 10 minutes (unchanged — BTC/ETH/SOL pulse)
    analysisCycle: 2,      // Standard: every 2 hours (was 6h — more responsive)
    sandboxCycle: 6,       // Sandbox: every 6 hours (was 24h)
    aiCycle: 6,            // AI Watchlist: every 6 hours

    // ── THRESHOLDS (confirming Option A values) ────────────────────
    buyScoreThreshold: 72,
    scalingScoreThreshold: 80,
    aiScoreExitThreshold: 58,
    maxAllocationPerAsset: 400,
    minOrderAmount: 150,
    minCashReservePct: 10,
    positionStopLoss: -15,
    portfolioStopLoss: 25,
    minMarketCap: 100,
};

async function align() {
    const snap = await db.collection('agent_configs').get();
    if (snap.empty) {
        console.log('No agent_configs found.');
        return;
    }

    const batch = db.batch();
    snap.docs.forEach(doc => {
        batch.update(doc.ref, OPTION_A_CONFIG);
        console.log(`Queuing alignment for: ${doc.id}`);
    });

    await batch.commit();

    console.log('\n✅ Option A alignment complete.');
    console.log('\nWatchlists:');
    console.log(`  Priority  (${OPTION_A_CONFIG.trafficLightTokens.length}): ${OPTION_A_CONFIG.trafficLightTokens.join(', ')}`);
    console.log(`  Standard  (${OPTION_A_CONFIG.standardTokens.length}): ${OPTION_A_CONFIG.standardTokens.join(', ')}`);
    console.log(`  Sandbox   (${OPTION_A_CONFIG.sandboxTokens.length}): ${OPTION_A_CONFIG.sandboxTokens.join(', ')}`);
    console.log(`  AI Watch  (${OPTION_A_CONFIG.aiWatchlist.length}): (engine manages)`);
    console.log('\nThresholds:');
    console.log(`  Buy Score: ≥ ${OPTION_A_CONFIG.buyScoreThreshold}`);
    console.log(`  Exit Score: < ${OPTION_A_CONFIG.aiScoreExitThreshold}`);
    console.log(`  Min Order: $${OPTION_A_CONFIG.minOrderAmount}`);
    console.log(`  Max Per Position: $${OPTION_A_CONFIG.maxAllocationPerAsset}`);
    console.log(`  Cash Reserve: ${OPTION_A_CONFIG.minCashReservePct}%`);
    console.log(`  Analysis Cycle: ${OPTION_A_CONFIG.analysisCycle}h`);
    console.log(`  Risk Profile: ${OPTION_A_CONFIG.riskProfile}`);
}

align().catch(e => {
    console.error('Alignment failed:', e.message);
    process.exit(1);
});
