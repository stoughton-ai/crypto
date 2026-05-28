import { adminDb } from './src/lib/firebase-admin';

async function check() {
    const users = await adminDb!.collection('agent_configs').get();
    for (const doc of users.docs) {
        const data = doc.data();
        if (data.brainState?.brainLog) {
            console.log(`User: ${doc.id}`);
            data.brainState.brainLog.slice(-10).forEach((l: any) => {
                console.log(l.ts, l.text);
            });
        }
    }
}
check().catch(console.error);
