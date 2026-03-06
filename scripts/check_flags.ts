import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) process.exit(1);
    const doc = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const d = doc.data();
    console.log('automationEnabled:', d?.automationEnabled);
    console.log('arenaEnabled:', d?.arenaEnabled);
    console.log('realTradingEnabled:', d?.realTradingEnabled);
    console.log('telegramReportHour:', d?.telegramReportHour);
    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
