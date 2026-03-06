import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Since we're in node not next, shim cache
// @ts-ignore
global.jest = { mock: () => { } };

const mockModule = require('module');
const originalRequire = mockModule.prototype.require;
mockModule.prototype.require = function (request: string) {
    if (request === 'next/cache') {
        return { revalidatePath: () => { }, revalidateTag: () => { } };
    }
    return originalRequire.apply(this, arguments);
};

async function forceScan() {
    try {
        const { adminDb } = await import('../src/lib/firebase-admin');
        const { runAutomatedAgentCheck } = await import('../src/app/actions');

        if (!adminDb) throw new Error('Admin SDK not initialized');

        const [activeSnap, haltedSnap] = await Promise.all([
            adminDb.collection('agent_configs').where('automationEnabled', '==', true).get(),
            adminDb.collection('agent_configs').where('stopLossTriggered', '==', true).get(),
        ]);

        const seenIds = new Set<string>();
        const allDocs = [...activeSnap.docs, ...haltedSnap.docs].filter(d => {
            if (seenIds.has(d.id)) return false;
            seenIds.add(d.id);
            return true;
        });

        console.log(`[Force Scan] Found ${allDocs.length} user(s) to process.`);
        if (allDocs.length === 0) {
            // Probably want to grab admin user manually
            const allUsers = await adminDb.collection('agent_configs').get();
            for (const doc of allUsers.docs) {
                console.log(`[Fallback] Running for ${doc.id} even though automationEnabled is false...`);
                await runAutomatedAgentCheck(doc.id, doc.data());
            }
            return;
        }

        for (const doc of allDocs) {
            const userId = doc.id;
            const config = doc.data();
            console.log(`[Force Scan] Processing user ${userId} (${config.automationEnabled ? 'Auto' : 'Halted'})`);
            const result = await runAutomatedAgentCheck(userId, config);
            console.log(`[Force Scan] Result for ${userId}:`, result);
        }
    } catch (e: any) {
        console.error("Scan Failed:", e);
    } finally {
        process.exit(0);
    }
}
forceScan();
