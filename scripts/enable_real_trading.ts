import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').update({
        realTradingEnabled: true
    });
    console.log('✅ realTradingEnabled set to TRUE');

    const doc = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const d = doc.data();
    console.log('Verified - realTradingEnabled:', d?.realTradingEnabled);
    console.log('revolutIsSandbox:', d?.revolutIsSandbox);
    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
