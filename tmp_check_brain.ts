import { adminDb } from './src/lib/firebase-admin';

async function checkBrainLogs() {
    if (!adminDb) return;
    const snap = await adminDb.collection('agent_configs').get();
    snap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`\n--- User: ${doc.id} ---`);
        if (data.brainState?.brainLog) {
            data.brainState.brainLog.forEach((log: any) => {
                console.log(`[${log.ts}] ${log.text}`);
            });
        }
    });
}

checkBrainLogs().then(() => process.exit(0));
