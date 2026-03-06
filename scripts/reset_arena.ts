import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // 1. Delete arena config
    console.log('Deleting arena_config...');
    await adminDb.collection('arena_config').doc(userId).delete();

    // 2. Delete all arena trades
    console.log('Deleting arena_trades...');
    const tradesSnap = await adminDb.collection('arena_trades').where('userId', '==', userId).get();
    const batch1 = adminDb.batch();
    tradesSnap.docs.forEach(d => batch1.delete(d.ref));
    if (tradesSnap.size > 0) await batch1.commit();
    console.log(`  Deleted ${tradesSnap.size} trade records.`);

    // 3. Delete all arena reflections
    console.log('Deleting arena_reflections...');
    try {
        const reflSnap = await adminDb.collection('arena_reflections').where('poolId', '!=', '').limit(500).get();
        const batch2 = adminDb.batch();
        reflSnap.docs.forEach(d => batch2.delete(d.ref));
        if (reflSnap.size > 0) await batch2.commit();
        console.log(`  Deleted ${reflSnap.size} reflection records.`);
    } catch (e) {
        console.log('  No reflections to delete (or index not ready).');
    }

    // 4. Verify realTradingEnabled is true
    const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    console.log('\nrealTradingEnabled:', config?.realTradingEnabled);
    if (!config?.realTradingEnabled) {
        console.log('Enabling realTradingEnabled...');
        await adminDb.collection('agent_configs').doc(userId).update({ realTradingEnabled: true });
    }

    // 5. Re-initialize the arena
    console.log('\n🏟️ Re-initializing arena with AI...');
    const { aiInitializeArena } = await import('../src/app/actions');
    const result = await aiInitializeArena(userId);
    console.log('Result:', JSON.stringify(result, null, 2));

    process.exit(result.success ? 0 : 1);
}
go().catch(e => { console.error(e); process.exit(1); });
