import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const ref = db.collection('agent_configs').doc(userId);

    // Read current state
    const snap = await ref.get();
    const data = snap.data()!;

    console.log('\n=== BEFORE FIX ===');
    console.log(`  riskProfile:              ${data.riskProfile}`);
    console.log(`  maxAllocationPerAsset:    ${data.maxAllocationPerAsset}`);
    console.log(`  watchdogEnabled:          ${data.watchdogEnabled}`);

    // Fix 1: Remove stale custom override so TACTICAL defaults ($400) apply
    // Fix 2: Enable watchdog
    const fieldsToDelete = [
        'positionStopLoss', 'portfolioStopLoss', 'maxAllocationPerAsset',
        'minCashReservePct', 'aiScoreExitThreshold', 'buyScoreThreshold',
        'scalingScoreThreshold', 'minMarketCap', 'minOrderAmount',
        'maxOpenPositions', 'requireMomentumForBuy', 'rotationMinScoreGap',
        'minProfitableHoldHours', 'aiWatchlistCap', 'aiDisplacementMargin',
        'sandboxBudgetPct', 'buyAmountScore90', 'buyAmountScore80',
        'buyAmountDefault', 'scalingChunkSize', 'antiWashHours',
        'reentryPenalty', 'entrySizeMultiplier', 'strategyLabel',
        'strategyDescription',
    ];

    const update: Record<string, any> = {
        watchdogEnabled: true,
    };

    for (const field of fieldsToDelete) {
        update[field] = admin.firestore.FieldValue.delete();
    }

    await ref.update(update);

    // Verify
    const after = (await ref.get()).data()!;
    console.log('\n=== AFTER FIX ===');
    console.log(`  riskProfile:              ${after.riskProfile}`);
    console.log(`  maxAllocationPerAsset:    ${after.maxAllocationPerAsset ?? '(deleted — will default to TACTICAL: $400)'}`);
    console.log(`  watchdogEnabled:          ${after.watchdogEnabled}`);

    console.log('\n✅ Fix applied. All custom overrides deleted. TACTICAL defaults ($400 max alloc) will now apply.');
    console.log('✅ Watchdog enabled.');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
