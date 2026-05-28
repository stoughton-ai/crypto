import { adminDb } from './src/lib/firebase-admin';

async function findSolTradesToday() {
    if (!adminDb) return;
    const today = '2026-04-08';
    const collections = ['arena_trades', 'discovery_pool_trades', 'virtual_trades'];

    for (const colName of collections) {
        console.log(`Checking ${colName} (in-memory filter)...`);
        const snap = await adminDb.collection(colName)
            .where('date', '>=', today)
            .get();

        if (snap.empty) continue;

        snap.docs.forEach(doc => {
            const data = doc.data();
            if (data.ticker === 'SOL') {
                console.log(`--- SOL Trade in ${colName} ---`);
                console.log(`Type: ${data.type}`);
                console.log(`Date: ${data.date}`);
                console.log(`Reason: ${data.reason}`);
                console.log(`Pool: ${data.poolName}`);
                console.log(`PnL: ${data.pnl || 0} (${data.pnlPct || 0}%)`);
            }
        });
    }

    // Also check reflections
    console.log(`\nChecking reflections for SOL today...`);
    const reflSnap = await adminDb.collection('arena_reflections')
        .where('ticker', '==', 'SOL')
        .get();
    
    reflSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.createdAt && data.createdAt.startsWith(today)) {
            console.log(`--- SOL Reflection ---`);
            console.log(`Type: ${data.type}`);
            console.log(`Reasoning: ${data.reasoning}`);
            if (data.outcome) {
                console.log(`Outcome PnL: ${data.outcome.pnlPct.toFixed(2)}%`);
                console.log(`Lesson: ${data.outcome.lessonLearned}`);
            }
        }
    });
}

findSolTradesToday().then(() => process.exit(0));
