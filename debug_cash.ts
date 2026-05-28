import { adminDb } from './src/lib/firebase-admin';
import { syncRevolutBalances, getArenaConfig } from './src/services/arenaService';
import { runIntegrityChecks } from './src/services/integrityService';

async function run() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1'; // Default Chris user ID, but we can verify
    
    // override 1-hour interval for test by setting lastRevolutSyncAt = null
    const arena1 = await getArenaConfig(userId);
    if (!arena1) return console.log("Arena not found");
    
    console.log(`Current sharedCash: $${arena1.sharedCash}`);
    
    arena1.lastRevolutSyncAt = null; // force sync
    await adminDb.collection('arena_config').doc(userId).set(arena1);
    
    const arena2 = await getArenaConfig(userId);
    console.log("Forcing Revolut sync...");
    const syncRes = await syncRevolutBalances(userId, arena2 as any);
    console.log("Sync Result:", syncRes);
    
    console.log("Running integrity checks...");
    const arena3 = await getArenaConfig(userId);
    const alerts = await runIntegrityChecks(userId, arena3 as any, {});
    console.log("Integrity Alerts:", alerts.map(a => a.title));
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
