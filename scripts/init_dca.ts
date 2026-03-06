/**
 * init_dca.ts
 *
 * One-time script to create the dca_config document in Firestore
 * for the user, enabling the Saturday DCA deposit cron.
 *
 * Run with:
 *   npx ts-node -e "$(cat scripts/init_dca.ts)" -- or --
 *   npx ts-node scripts/init_dca.ts
 */

import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr!)) });
}

const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
const WEEKLY_AMOUNT = 60; // $60 per week total

async function initDca() {
    const db = admin.firestore();
    const dcaRef = db.collection('dca_config').doc(USER_ID);

    // Check if already exists
    const existing = await dcaRef.get();
    if (existing.exists) {
        const data = existing.data()!;
        console.log('✅ dca_config already exists:');
        console.log(`   enabled:        ${data.enabled}`);
        console.log(`   weeklyAmount:   $${data.weeklyAmount}`);
        console.log(`   totalDeposited: $${data.totalDeposited ?? 0}`);
        console.log(`   totalDeployed:  $${data.totalDeployed ?? 0}`);
        console.log(`   lastDeposit:    ${data.lastDepositDate || '(never)'}`);
        console.log(`   history:        ${(data.history ?? []).length} records`);
        console.log('\nNo changes made. To reset, delete the document and re-run.');
        process.exit(0);
    }

    // Create fresh document
    const dcaConfig = {
        userId: USER_ID,
        enabled: true,
        weeklyAmount: WEEKLY_AMOUNT,
        lastDepositDate: '',        // Empty = never deposited, will credit on next Saturday
        totalDeposited: 0,
        totalDeployed: 0,
        pausedAt: null,
        pauseReason: null,
        history: [],
        createdAt: new Date().toISOString(),
    };

    await dcaRef.set(dcaConfig);

    console.log('✅ dca_config created successfully!\n');
    console.log(`   User:           ${USER_ID}`);
    console.log(`   Enabled:        true`);
    console.log(`   Weekly amount:  $${WEEKLY_AMOUNT}`);
    console.log(`   First deposit:  Next Saturday at 09:05 UTC`);
    console.log('');
    console.log('The Saturday cron (/api/cron/dca-deposit) will now:');
    console.log('  1. Check market conditions (FNG, BTC 30d, NAV vs invested)');
    console.log('  2. Ask AI to split $60 across the 4 pools');
    console.log('  3. Credit each pool\'s dcaReserve');
    console.log('  4. Send you a Telegram summary');
    console.log('');
    console.log('The arena cron will deploy reserves when conviction score ≥ 85');
    console.log('(full reserve deployed at score ≥ 90).');

    process.exit(0);
}

initDca().catch((err) => {
    console.error('❌ Failed to init DCA config:', err.message);
    process.exit(1);
});
