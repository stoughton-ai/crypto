import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    // 1. Delete all documents in cortex_reviews collection
    const reviewsSnap = await db.collection('cortex_reviews').get();
    console.log(`Found ${reviewsSnap.size} cortex_reviews document(s) to delete.`);

    for (const doc of reviewsSnap.docs) {
        await doc.ref.delete();
        console.log(`  Deleted: ${doc.id}`);
    }

    // 2. Clear cortexReflection from all agent_configs and set start date to today
    const configsSnap = await db.collection('agent_configs').get();
    const today = new Date().toISOString();

    for (const doc of configsSnap.docs) {
        const data = doc.data();
        const updates: Record<string, any> = {
            cortexReflectionStartDate: today,
        };
        if (data.cortexReflection) {
            updates.cortexReflection = admin.firestore.FieldValue.delete();
        }
        await doc.ref.update(updates);
        console.log(`  User ${doc.id.substring(0, 8)}: ${data.cortexReflection ? 'Cleared cortexReflection + ' : ''}Set start date → ${today}`);
    }

    console.log('\n✅ Done. Cortex Reflection monitoring starts from today.');
    console.log(`   First weekly report:  ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
    console.log(`   First monthly report: ${new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
