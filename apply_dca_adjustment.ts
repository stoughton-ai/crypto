
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
    console.log('--- Adjusting DCA Injection for User ' + USER_ID + ' ---');
    
    // 1. Arena Config Update
    const arenaRef = db.collection('arena_config').doc(USER_ID);
    const arenaSnap = await arenaRef.get();
    if (!arenaSnap.exists) {
        console.error('No arena_config found');
        process.exit(1);
    }
    const arena = arenaSnap.data()!;
    const oldReserve = arena.sharedDcaReserve ?? 0;
    const injectionAmount = 60; // Based on detected deposit in contributions (120 - 60)
    
    arena.sharedDcaReserve = oldReserve + injectionAmount;
    // sharedDcaContributions is already 120 (detected by Revolut sync), 
    // but let's ensure it matches the total.
    // If it was already updated by sync, we don't need to add it again, 
    // otherwise we'd be double counting.
    // My previous inspection showed Contributions = 120, so it's already accounted for in total invested.
    
    console.log(`Arena sharedDcaReserve: $${oldReserve} -> $${arena.sharedDcaReserve}`);
    await arenaRef.set(arena);

    // 2. DCA Config Update
    const dcaRef = db.collection('dca_config').doc(USER_ID);
    const dcaSnap = await dcaRef.get();
    if (!dcaSnap.exists) {
        console.error('No dca_config found');
        process.exit(1);
    }
    const dcaConfig = dcaSnap.data()!;
    const oldDeposited = dcaConfig.totalDeposited ?? 0;
    
    dcaConfig.totalDeposited = oldDeposited + injectionAmount;
    
    // History entry
    const historyEntry = {
        date: new Date().toISOString(),
        poolId: 'SHARED',
        credited: injectionAmount,
        deployed: 0,
        marketCondition: {
            fng: 20, // Approximate fear
            btc30d: -5,
            navVsInvested: 0.95
        }
    };
    dcaConfig.history = [...(dcaConfig.history || []), historyEntry];
    
    // Cancel Saturday's deposit by setting lastDepositDate to Saturday's date
    // Saturday is March 28, 2026
    dcaConfig.lastDepositDate = '2026-03-28';
    
    console.log(`DCA totalDeposited: $${oldDeposited} -> $${dcaConfig.totalDeposited}`);
    console.log(`DCA lastDepositDate: ${dcaConfig.lastDepositDate} (Saturday cancelled)`);
    
    await dcaRef.set(dcaConfig);
    
    console.log('\n--- Done! ---');
}

main().catch(console.error);
