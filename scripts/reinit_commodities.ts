/**
 * reinit_commodities.ts
 * Resets the Commodities arena and reinitialises it using the new ETF-based universe.
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // 1. Delete existing config
    console.log('Deleting existing Commodities config...');
    await adminDb.collection('arena_config_commodities').doc(userId).delete().catch(() => { });

    // 2. Delete all existing trades
    const tradesSnap = await adminDb.collection('arena_trades_commodities')
        .where('userId', '==', userId).get();
    if (tradesSnap.size > 0) {
        const batch = adminDb.batch();
        tradesSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`Deleted ${tradesSnap.size} old trade(s).`);
    }

    // 3. Delete reflections
    const refSnap = await adminDb.collection('arena_reflections_commodities')
        .where('poolId', '!=', '').limit(500).get().catch(() => ({ docs: [], size: 0 }));
    if (refSnap.docs.length > 0) {
        const batch2 = adminDb.batch();
        refSnap.docs.forEach((d: any) => batch2.delete(d.ref));
        await batch2.commit();
        console.log(`Deleted ${refSnap.docs.length} old reflection(s).`);
    }

    console.log('\nReset complete. Now calling aiInitializeSandboxArena for COMMODITIES...');

    // 4. Reinitialise
    const { aiInitializeSandboxArena } = await import('../src/app/actions');
    const result = await aiInitializeSandboxArena(userId, 'COMMODITIES');
    console.log('Init result:', JSON.stringify(result, null, 2));

    if (result.success) {
        // 5. Immediately activate competition mode
        console.log('\nActivating competition mode...');
        const { activateCompetitionMode } = await import('../src/services/arenaService');
        const activateResult = await activateCompetitionMode(userId, 'COMMODITIES');
        console.log('Activate result:', activateResult);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
