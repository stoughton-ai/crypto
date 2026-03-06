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

    const snap = await ref.get();
    const data = snap.data()!;

    console.log('=== BEFORE REVERT ===');
    console.log(`  buyScoreThreshold:  ${data.buyScoreThreshold}`);
    console.log(`  positionStopLoss:   ${data.positionStopLoss}`);

    await ref.update({
        buyScoreThreshold: 72,
        positionStopLoss: 15,
    });

    const after = (await ref.get()).data()!;
    console.log('\n=== AFTER REVERT ===');
    console.log(`  buyScoreThreshold:  ${after.buyScoreThreshold} (was 68 → reverted to 72)`);
    console.log(`  positionStopLoss:   ${after.positionStopLoss} (was 20 → reverted to 15)`);

    console.log('\n✅ Both Cortex Review changes have been reversed.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
