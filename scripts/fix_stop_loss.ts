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

    console.log('=== BEFORE FIX ===');
    console.log(`  positionStopLoss: ${data.positionStopLoss} (POSITIVE = BUG — triggers on every position!)`);
    console.log(`  TACTICAL default: -15 (negative)`);

    // Fix: Delete the custom override so the TACTICAL default (-15) applies
    await ref.update({
        positionStopLoss: admin.firestore.FieldValue.delete(),
    });

    const after = (await ref.get()).data()!;
    console.log('\n=== AFTER FIX ===');
    console.log(`  positionStopLoss: ${after.positionStopLoss ?? '(deleted — will use TACTICAL default: -15)'}`);

    console.log('\n✅ Stop loss fixed. The TACTICAL profile default of -15% will now apply.');
    console.log('   Positions will only be sold when they lose 15% or more from entry.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
