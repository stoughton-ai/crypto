/**
 * Fix the dcaReserve field inconsistency.
 *
 * For any pool where pool.dcaReserve > pool.cashBalance,
 * cap dcaReserve at cashBalance. The excess was consumed by regular
 * trading buys and now exists as token holdings (still in the portfolio).
 *
 * This is a one-time data correction. No money is added or removed.
 * The NAV is not affected.
 *
 * Run: npx tsx scripts/fix_dca_reserve.ts
 * Dry-run (no writes): npx tsx scripts/fix_dca_reserve.ts --dry
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

async function main() {
    console.log(DRY ? '\n[DRY RUN] No writes will be made.\n' : '\n[WRITE MODE] Corrections will be saved to Firestore.\n');

    const arenaRef = db.collection('arena_config').doc(USER_ID);
    const snap = await arenaRef.get();
    if (!snap.exists) { console.error('No arena_config found'); process.exit(1); }
    const arena = snap.data()!;

    let changed = false;

    for (let i = 0; i < arena.pools.length; i++) {
        const pool = arena.pools[i] as any;
        const cash: number = pool.cashBalance ?? 0;
        const reserve: number = pool.dcaReserve ?? 0;

        if (reserve > cash + 0.005) {
            const corrected = Math.max(0, cash); // cap at current cashBalance
            const consumed = reserve - corrected;
            console.log(`⚠️  ${pool.emoji} ${pool.name} (${pool.poolId})`);
            console.log(`   cashBalance  : $${cash.toFixed(2)}`);
            console.log(`   dcaReserve   : $${reserve.toFixed(2)}  (overstated by $${consumed.toFixed(2)})`);
            console.log(`   Correction   : dcaReserve → $${corrected.toFixed(2)}`);
            console.log(`   Explanation  : $${consumed.toFixed(2)} of DCA reserve was spent on token buys.`);
            console.log(`                  Capital is still in the portfolio (as tokens), not lost.\n`);

            arena.pools[i].dcaReserve = corrected;
            changed = true;
        } else {
            console.log(`✅ ${pool.emoji} ${pool.name}: dcaReserve $${reserve.toFixed(2)} ≤ cashBalance $${cash.toFixed(2)} — OK`);
        }
    }

    if (!changed) {
        console.log('\nNo corrections needed.');
        process.exit(0);
    }

    if (!DRY) {
        await arenaRef.set(arena);
        console.log('\n✅ arena_config saved to Firestore.');
        console.log('   The dcaReserve field now accurately reflects the actual undeployed DCA cash.');
        console.log('   NAV is unchanged. dcaContributions (lifetime total) is unchanged.');
    } else {
        console.log('\n[DRY RUN] Would have written the above corrections to Firestore.');
        console.log('   Run without --dry to apply: npx tsx scripts/fix_dca_reserve.ts');
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
