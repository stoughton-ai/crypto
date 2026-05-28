import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function haltAllTrading() {
    console.log('--- GLOBAL TRADING HALT INITIATED ---');

    // 1. Pause all arenas
    const classes = ['CRYPTO', 'FTSE', 'NYSE', 'COMMODITIES'];
    for (const ac of classes) {
        let col = 'arena_config';
        if (ac !== 'CRYPTO') col = 'arena_config_' + ac.toLowerCase();
        
        try {
            const snap = await db.collection(col).doc(userId).get();
            if (snap.exists) {
                const data = snap.data();
                if (data && data.pools) {
                    console.log(`[${ac}] Pausing ${data.pools.length} pools...`);
                    const updatedPools = data.pools.map((p: any) => ({
                        ...p,
                        status: 'PAUSED',
                        pauseReason: 'USER EMERGENCY STOP: All trading halted manually by Antigravity AI on request.'
                    }));
                    await db.collection(col).doc(userId).update({ pools: updatedPools });
                    console.log(`[${ac}]   Done.`);
                }
            } else {
                console.log(`[${ac}]   Config not found.`);
            }
        } catch (e: any) {
            console.error(`[${ac}] Error: ${e.message}`);
        }
    }

    // 2. Disable automated cycles in agent_configs if possible
    try {
        const configSnap = await db.collection('agent_configs').doc(userId).get();
        if (configSnap.exists) {
            const config = configSnap.data();
            console.log('Updating agent_configs global flags...');
            await db.collection('agent_configs').doc(userId).update({
                tradingEnabled: false,
                automatedTrading: false,
                haltReason: 'USER EMERGENCY STOP'
            });
            console.log('Agent configs updated.');
        }
    } catch (e: any) {
        console.error('Error updating agent_configs:', e.message);
    }

    // To prevent immediate restart by a running cron, I'll log this as a major event.
    console.log('\n--- ALL TRADING HALTED ---');
}

haltAllTrading().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
