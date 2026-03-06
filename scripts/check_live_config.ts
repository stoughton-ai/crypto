import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

// Init Firebase Admin
if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON env var");
    const sa = JSON.parse(saStr);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

// Profile defaults (mirrored from constants.ts)
const PROFILE_DEFAULTS: Record<string, any> = {
    STEADY: {
        portfolioStopLoss: 15, positionStopLoss: -8, maxAllocationPerAsset: 100,
        minCashReservePct: 15, aiScoreExitThreshold: 65, buyScoreThreshold: 70,
        scalingScoreThreshold: 85, minMarketCap: 1000, minOrderAmount: 20,
        maxOpenPositions: 16, requireMomentumForBuy: true, rotationMinScoreGap: 15,
        minProfitableHoldHours: 72, buyAmountScore90: 100, buyAmountScore80: 75,
        buyAmountDefault: 50, scalingChunkSize: 50,
    },
    TACTICAL: {
        portfolioStopLoss: 25, positionStopLoss: -15, maxAllocationPerAsset: 400,
        minCashReservePct: 10, aiScoreExitThreshold: 58, buyScoreThreshold: 72,
        scalingScoreThreshold: 70, minMarketCap: 100, minOrderAmount: 150,
        maxOpenPositions: 16, requireMomentumForBuy: true, rotationMinScoreGap: 12,
        minProfitableHoldHours: 48, buyAmountScore90: 400, buyAmountScore80: 250,
        buyAmountDefault: 150, scalingChunkSize: 100,
    },
    'ALPHA SWING': {
        portfolioStopLoss: 30, positionStopLoss: -25, maxAllocationPerAsset: 500,
        minCashReservePct: 0, aiScoreExitThreshold: 45, buyScoreThreshold: 60,
        scalingScoreThreshold: 70, minMarketCap: 0, minOrderAmount: 75,
        maxOpenPositions: 16, requireMomentumForBuy: false, rotationMinScoreGap: 6,
        minProfitableHoldHours: 12, buyAmountScore90: 500, buyAmountScore80: 300,
        buyAmountDefault: 150, scalingChunkSize: 125,
    },
};

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const doc = await db.collection('agent_configs').doc(userId).get();
    if (!doc.exists) { console.log('Config not found!'); return; }

    const data = doc.data()!;

    // Apply same migration as getServerAgentConfig
    const rawProfile = data.riskProfile || 'TACTICAL';
    let baseProfile = rawProfile;
    if (rawProfile === 'SAFE') baseProfile = 'STEADY';
    else if (rawProfile === 'BALANCED') baseProfile = 'TACTICAL';
    else if (rawProfile === 'RISK') baseProfile = 'ALPHA SWING';

    const defaults = PROFILE_DEFAULTS[baseProfile] || PROFILE_DEFAULTS.TACTICAL;

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║           LIVE FIRESTORE CONFIG — TRADING VALUES            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`  Raw riskProfile in Firestore:  "${rawProfile}"`);
    console.log(`  Resolved base profile:         "${baseProfile}"`);
    console.log('');

    const fields = [
        { key: 'buyScoreThreshold', label: 'AI Buy Threshold', unit: '' },
        { key: 'aiScoreExitThreshold', label: 'AI Exit Threshold', unit: '' },
        { key: 'scalingScoreThreshold', label: 'Scaling Score', unit: '' },
        { key: 'minOrderAmount', label: 'Min Order Size', unit: '$' },
        { key: 'maxAllocationPerAsset', label: 'Max Allocation/Asset', unit: '$' },
        { key: 'minCashReservePct', label: 'Min Cash Reserve', unit: '%' },
        { key: 'positionStopLoss', label: 'Position Stop Loss', unit: '%' },
        { key: 'portfolioStopLoss', label: 'Portfolio Stop Loss', unit: '%' },
        { key: 'minMarketCap', label: 'Min Market Cap', unit: 'M' },
        { key: 'maxOpenPositions', label: 'Max Open Positions', unit: '' },
        { key: 'requireMomentumForBuy', label: 'Require Momentum', unit: '' },
        { key: 'rotationMinScoreGap', label: 'Rotation Score Gap', unit: 'pts' },
        { key: 'minProfitableHoldHours', label: 'Min Profitable Hold', unit: 'hrs' },
        { key: 'buyAmountScore90', label: 'Buy Amount (Score≥90)', unit: '$' },
        { key: 'buyAmountScore80', label: 'Buy Amount (Score≥80)', unit: '$' },
        { key: 'buyAmountDefault', label: 'Buy Amount (Default)', unit: '$' },
        { key: 'scalingChunkSize', label: 'Scaling Chunk Size', unit: '$' },
    ];

    console.log('  ┌─────────────────────────┬───────────────┬───────────────┬──────────────┐');
    console.log('  │ Setting                 │ Firestore Raw │ Profile Def   │ Resolved     │');
    console.log('  ├─────────────────────────┼───────────────┼───────────────┼──────────────┤');

    for (const f of fields) {
        const raw = data[f.key];
        const def = defaults[f.key];
        const resolved = raw ?? def;
        const isCustom = raw !== undefined && raw !== def;
        const rawStr = raw !== undefined ? `${f.unit}${raw}` : '(not set)';
        const defStr = `${f.unit}${def}`;
        const resStr = `${f.unit}${resolved}${isCustom ? ' ⚠️' : ''}`;

        console.log(`  │ ${f.label.padEnd(23)} │ ${rawStr.toString().padEnd(13)} │ ${defStr.toString().padEnd(13)} │ ${resStr.toString().padEnd(12)} │`);
    }

    console.log('  └─────────────────────────┴───────────────┴───────────────┴──────────────┘');
    console.log('\n  ⚠️  = Custom override (differs from profile default)');
    console.log('  Values in "Resolved" column = what the engine will USE after the fix.\n');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
