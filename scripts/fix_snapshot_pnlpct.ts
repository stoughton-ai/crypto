/**
 * Retroactively corrects pnlPct in all stored daily snapshots.
 *
 * Old formula: pnlPct = (value - budget) / budget
 * New formula: pnlPct = (value - (budget + dcaContributions)) / (budget + dcaContributions)
 *
 * Writes to BOTH:
 *  1. arena_config.pools[].performance.dailySnapshots (embedded array)
 *  2. arena_snapshots/{userId}/{poolId}/{date} (sub-collection, authoritative)
 *
 * Run: npx tsx scripts/fix_snapshot_pnlpct.ts
 * Dry:  npx tsx scripts/fix_snapshot_pnlpct.ts --dry
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();
const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
const DRY = process.argv.includes('--dry');

function recalcPnlPct(value: number, costBasis: number): number {
    return costBasis > 0 ? ((value - costBasis) / costBasis) * 100 : 0;
}

async function main() {
    console.log(DRY ? '\n[DRY RUN] No writes.\n' : '\n[WRITE MODE] Correcting snapshots.\n');

    const arenaRef = db.collection('arena_config').doc(USER_ID);
    const snap = await arenaRef.get();
    if (!snap.exists) { console.error('No arena_config'); process.exit(1); }
    const arena = snap.data()!;

    let totalSnapshotsFixed = 0;

    for (let i = 0; i < arena.pools.length; i++) {
        const pool = arena.pools[i] as any;
        const costBasis = (pool.budget ?? 0) + (pool.dcaContributions ?? 0);

        console.log(`\n${pool.emoji} ${pool.name} (${pool.poolId})  costBasis=$${costBasis.toFixed(2)}`);

        // ── 1. Fix embedded dailySnapshots ──
        const snaps = pool.performance?.dailySnapshots ?? [];
        let embeddedFixed = 0;
        for (const s of snaps) {
            const correct = recalcPnlPct(s.value, costBasis);
            if (Math.abs(correct - (s.pnlPct ?? 0)) > 0.01) {
                console.log(`   Embedded ${s.date}: pnlPct ${(s.pnlPct ?? 0).toFixed(2)}% → ${correct.toFixed(2)}%`);
                s.pnlPct = correct;
                embeddedFixed++;
                totalSnapshotsFixed++;
            }
        }
        if (embeddedFixed === 0) console.log('   Embedded: (no changes needed)');

        // ── 2. Fix Firestore sub-collection ──
        const colRef = db.collection('arena_snapshots').doc(USER_ID).collection(pool.poolId);
        const colSnap = await colRef.get();
        let subFixed = 0;

        const batch = db.batch();
        for (const doc of colSnap.docs) {
            const d = doc.data();
            if (typeof d.value !== 'number') continue;
            const correct = recalcPnlPct(d.value, costBasis);
            if (Math.abs(correct - (d.pnlPct ?? 0)) > 0.01) {
                console.log(`   Sub-coll ${d.date}: pnlPct ${(d.pnlPct ?? 0).toFixed(2)}% → ${correct.toFixed(2)}%`);
                if (!DRY) batch.update(doc.ref, { pnlPct: correct });
                subFixed++;
                totalSnapshotsFixed++;
            }
        }
        if (subFixed === 0) console.log('   Sub-coll: (no changes needed)');
        if (!DRY && subFixed > 0) await batch.commit();
    }

    // ── 3. Save embedded array changes back ──
    if (!DRY) {
        await arenaRef.set(arena);
    }

    console.log(`\n${DRY ? '[DRY RUN] Would have fixed' : '✅ Fixed'} ${totalSnapshotsFixed} snapshot(s) total.`);
    if (DRY) console.log('Run without --dry to apply.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
