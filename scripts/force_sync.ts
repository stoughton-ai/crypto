import 'dotenv/config';
import { adminDb } from '../src/lib/firebase-admin';
import { getArenaConfig, syncRevolutBalances } from '../src/services/arenaService';
import { runIntegrityChecks } from '../src/services/integrityService';

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1'; // Default Chris user
    
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
    
    if (!arena1.sharedCash || arena1.sharedCash > 45) {
        console.log("Forcing sync by clearing lastRevolutSyncAt...");
        arena1.lastRevolutSyncAt = null;

        const syncRes = await syncRevolutBalances(userId, arena1);
        console.log("Sync Result:", syncRes);
        console.log(`sharedCash after sync: $${arena1.sharedCash}`);

        const alerts = await runIntegrityChecks(userId, arena1, {});
        
        await adminDb.collection('arena_config').doc(userId).set(arena1);
        console.log("Successfully saved fixed arena to Firestore.");
    } else {
         console.log("Already fixed. Cash is:", arena1.sharedCash);
    }
}

main().catch(console.error).finally(() => process.exit(0));
