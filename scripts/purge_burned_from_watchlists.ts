/**
 * One-shot cleanup script: removes any excluded/burned tokens
 * that are still sitting in watchlists in Firestore.
 * Run with: npx tsx scripts/purge_burned_from_watchlists.ts
 */
import * as fs from 'fs';
import * as path from 'path';

// Load env the same way as autonomous_brain.ts
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
    }
}

async function purge() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('Firebase Admin not initialized'); process.exit(1); }

    const snap = await adminDb.collection('agent_configs').get();
    let totalPurged = 0;

    for (const doc of snap.docs) {
        const data = doc.data();
        const excluded = new Set((data.excludedTokens || []).map((t: string) => t.toUpperCase()));

        if (excluded.size === 0) {
            console.log(`User ${doc.id} — No excluded tokens, skipping.`);
            continue;
        }

        const filterOut = (list: string[]) =>
            (list || []).filter((t: string) => !excluded.has(t.toUpperCase()));

        const newTraffic = filterOut(data.trafficLightTokens);
        const newStandard = filterOut(data.standardTokens);
        const newSandbox = filterOut(data.sandboxTokens);
        const newAi = filterOut(data.aiWatchlist);

        const removed =
            ((data.trafficLightTokens?.length || 0) - newTraffic.length) +
            ((data.standardTokens?.length || 0) - newStandard.length) +
            ((data.sandboxTokens?.length || 0) - newSandbox.length) +
            ((data.aiWatchlist?.length || 0) - newAi.length);

        if (removed > 0) {
            await doc.ref.update({
                trafficLightTokens: newTraffic,
                standardTokens: newStandard,
                sandboxTokens: newSandbox,
                aiWatchlist: newAi,
            });
            totalPurged += removed;
            console.log(`✅ User ${doc.id} — Purged ${removed} burned token(s) from watchlists`);
            console.log(`   Burn list:  ${Array.from(excluded).join(', ')}`);
            console.log(`   Priority:   [${data.trafficLightTokens?.join(', ')}] → [${newTraffic.join(', ')}]`);
            console.log(`   Standard:   [${data.standardTokens?.join(', ')}] → [${newStandard.join(', ')}]`);
            console.log(`   Sandbox:    [${data.sandboxTokens?.join(', ')}] → [${newSandbox.join(', ')}]`);
            console.log(`   AI Watch:   [${data.aiWatchlist?.join(', ')}] → [${newAi.join(', ')}]`);
        } else {
            console.log(`✅ User ${doc.id} — Watchlists are clean (no burned tokens present)`);
            console.log(`   Burn list:  ${Array.from(excluded).join(', ')}`);
        }
    }

    console.log(`\n🏁 Done. Total tokens purged: ${totalPurged}`);
}

purge().catch(console.error);
