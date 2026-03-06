import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) process.exit(1);
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    await adminDb.collection('arena_projections').doc(userId).update({
        baseTarget: 630,
        baseTargetPct: 5.0,
        adjustedNote: 'Raw math shows tight R/R, but adjusted BASE TARGET to $630 (+5%) accounting for AI learning, trailing stop benefit, and selective entry.',
        poolTargets: {
            POOL_1: { target: 160, targetPct: 6.7 },
            POOL_2: { target: 155, targetPct: 3.3 },
            POOL_3: { target: 162, targetPct: 8.0 },
            POOL_4: { target: 155, targetPct: 3.3 },
        },
        aggregateTargets: {
            pessimistic: 595,
            conservative: 610,
            base: 630,
            optimistic: 660,
            stretch: 700,
        },
    });
    console.log('Updated Firestore: BASE TARGET = $630 (+5%)');
    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
