import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) process.exit(1);

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    await adminDb.collection('agent_configs').doc(userId).set({
        automationEnabled: true,
        arenaEnabled: true,
        realTradingEnabled: true,
    }, { merge: true });

    console.log('✅ Flags updated:');
    console.log('  automationEnabled: true');
    console.log('  arenaEnabled: true');
    console.log('  realTradingEnabled: true');

    // Verify
    const doc = await adminDb.collection('agent_configs').doc(userId).get();
    const d = doc.data();
    console.log('\nVerification:', JSON.stringify({
        automationEnabled: d?.automationEnabled,
        arenaEnabled: d?.arenaEnabled,
        realTradingEnabled: d?.realTradingEnabled,
    }));

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
