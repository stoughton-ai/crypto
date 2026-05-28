import 'dotenv/config';
import { adminDb } from '../src/lib/firebase-admin';
import { getArenaConfig, syncRevolutBalances } from '../src/services/arenaService';
import { runIntegrityChecks } from '../src/services/integrityService';

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1'; // Test Chris user
    
    // First, verify adminDb works
    if (!adminDb) {
        console.error("adminDb not initialized");
        return;
    }

    const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
    if (!arenaDoc.exists) {
        console.log("No arena doc");
        return;
    }
    const arena1 = arenaDoc.data() as any;
    
    console.log(`Current sharedCash: $${arena1.sharedCash}`);
    console.log(`totalBudget: $${arena1.totalBudget}`);
    console.log(`sharedDcaContributions: $${arena1.sharedDcaContributions}`);
    console.log(`lastRevolutSyncAt: ${arena1.lastRevolutSyncAt}`);

    console.log("Forcing sync by clearing lastRevolutSyncAt...");
    arena1.lastRevolutSyncAt = null;

    console.log("Calling syncRevolutBalances...");
    const syncRes = await syncRevolutBalances(userId, arena1);
    console.log("Sync Result:", syncRes);
    
    console.log(`sharedCash after sync: $${arena1.sharedCash}`);

    console.log("Calling runIntegrityChecks...");
    const alerts = await runIntegrityChecks(userId, arena1, {});
    console.log("Alerts generated:", alerts.map((a: any) => a.title));
    console.log(`sharedCash after integrity: $${arena1.sharedCash}`);
}

main().catch(console.error).finally(() => process.exit(0));
