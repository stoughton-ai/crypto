/**
 * Re-enable DCA with the new shared reserve model.
 * Sets dca_config.enabled = true and initialises the shared DCA fields on arena_config.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    // 1. Re-enable DCA with a clean state
    await db.collection('dca_config').doc(USER_ID).set({
        enabled: true,
        weeklyAmount: 60,
        pausedAt: admin.firestore.FieldValue.delete(),
        pauseReason: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    console.log('✅ DCA config re-enabled (shared reserve model)');

    // 2. Initialise shared DCA fields on arena_config
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data() as any;
    
    // Only init if not already set
    if (arena.sharedDcaReserve === undefined) {
        arena.sharedDcaReserve = 0;
        arena.sharedDcaContributions = 0;
        arena.sharedDcaDeployed = 0;
        await db.collection('arena_config').doc(USER_ID).set(arena);
        console.log('✅ Shared DCA fields initialised on arena_config');
    } else {
        console.log('ℹ️  Shared DCA fields already exist on arena_config');
    }

    console.log(`\n  Current state:`);
    console.log(`    sharedDcaReserve:       $${(arena.sharedDcaReserve ?? 0).toFixed(2)}`);
    console.log(`    sharedDcaContributions: $${(arena.sharedDcaContributions ?? 0).toFixed(2)}`);
    console.log(`    sharedDcaDeployed:      $${(arena.sharedDcaDeployed ?? 0).toFixed(2)}`);
    console.log(`\n  DCA will credit $60 to the shared reserve each Saturday.`);
    console.log(`  Strongest candidate across all pools deploys at score ≥ 85.\n`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
