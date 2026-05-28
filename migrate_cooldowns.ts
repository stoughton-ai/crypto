
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

async function migrate() {
    console.log('--- 🛡️ Cost-Saving Migration: Evaluation Cooldowns ---');
    
    const arenas = ['CRYPTO', 'FTSE', 'NYSE', 'COMMODITIES'];
    
    for (const a of arenas) {
        const col = a === 'CRYPTO' ? 'arena_config' : `arena_config_${a.toLowerCase()}`;
        const ref = db.collection(col).doc(USER_ID);
        const snap = await ref.get();
        if (!snap.exists) continue;
        
        const data = snap.data()!;
        if (!data.pools) continue;
        
        let changed = false;
        for (let i = 0; i < data.pools.length; i++) {
            const pool = data.pools[i];
            const oldCooldown = pool.strategy.evaluationCooldownMinutes || 15;
            
            // Set cooldowns based on asset class volatility
            let newCooldown = 30; // Default crypto
            if (a !== 'CRYPTO') newCooldown = 120; // 2 hours for stocks/commos
            
            if (oldCooldown < newCooldown) {
                console.log(`[${a}] ${pool.name}: Cooldown ${oldCooldown}m -> ${newCooldown}m`);
                data.pools[i].strategy.evaluationCooldownMinutes = newCooldown;
                changed = true;
            }
        }
        
        if (changed) {
            await ref.set(data);
            console.log(`✅ ${a} arena config updated.`);
        } else {
            console.log(`[${a}] No changes needed.`);
        }
    }
    
    console.log('\n--- Migration Complete ---');
}

migrate().catch(console.error);
