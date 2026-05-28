/**
 * One-time fix: add the missing DCA cashBalance to the pools.
 *
 * The creditDcaReserve() function was only updating dcaReserve/dcaContributions
 * but NOT pool.cashBalance. This means the $60 DCA deposit sat in Revolut as real USD
 * but was invisible to the NAV calculation (cashBalance + holdings).
 *
 * Fix: for each pool, add dcaReserve to cashBalance so that the arena state
 * accurately reflects the real money in the Revolut account.
 *
 * Revolut USD balance: ~$277.68
 * Arena cashBalance total before fix: $220.45
 * Gap: ~$57 == dcaReserve total ($53.59 after pool 1 correction earlier)
 *
 * Dry-run: npx tsx scripts/fix_cashbalance_dca.ts --dry
 * Apply:   npx tsx scripts/fix_cashbalance_dca.ts
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
    console.log(DRY ? '\n[DRY RUN] No writes.\n' : '\n[WRITE MODE] Applying fix.\n');

    const ref = db.collection('arena_config').doc(USER_ID);
    const snap = await ref.get();
    if (!snap.exists) { console.error('No arena_config'); process.exit(1); }
    const arena = snap.data()!;

    let totalAdded = 0;

    for (let i = 0; i < arena.pools.length; i++) {
        const pool = arena.pools[i] as any;
        const cash: number = pool.cashBalance ?? 0;
        const reserve: number = pool.dcaReserve ?? 0;
        const contrib: number = pool.dcaContributions ?? 0;

        // The missing amount is the dcaReserve that was never added to cashBalance.
        // Because dcaReserve should be INSIDE cashBalance, the correct cashBalance
        // should be the current cashBalance PLUS the dcaReserve (which was never credited).
        // We identify this because cash < (what cashBalance should be including DCA).
        //
        // However, we need to be careful: Pool 1's dcaReserve ($11.59) was spent in
        // trades that went through cashBalance — so Pool 1's cashBalance already consumed
        // $6.41 of the $18 DCA as if it were regular cash. In other words, Pool 1's
        // cashBalance already partially reflects the DCA (the $6.41 portion that was spent).
        //
        // The simplest correct fix: cashBalance should be current_cash + dcaReserve
        // BUT only for pools where the dcaReserve hasn't already been mixed into cashBalance.
        //
        // More precisely: in the broken state, cashBalance was NEVER incremented for DCA.
        // So the correction is: cashBalance += dcaContributions for each pool.
        // But Pool 1 already spent $6.41 of DCA through its existing cashBalance indirectly...
        //
        // Actually the cleanest fix: add dcaReserve to cashBalance, since dcaReserve is
        // what's actually confirmed to still be sitting in Revolut as unspent cash.
        // (The $6.41 was spent on tokens — those tokens ARE in the holdings already.)

        const addition = reserve; // add the unspent reserve to cashBalance
        const newCash = cash + addition;

        console.log(`\n${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`  cashBalance before : $${cash.toFixed(2)}`);
        console.log(`  dcaReserve         : $${reserve.toFixed(2)}`);
        console.log(`  dcaContributions   : $${contrib.toFixed(2)}`);
        console.log(`  Adding to cash     : +$${addition.toFixed(2)}`);
        console.log(`  cashBalance after  : $${newCash.toFixed(2)}`);

        arena.pools[i].cashBalance = newCash;
        totalAdded += addition;
    }

    console.log(`\n  Total added to cashBalance: $${totalAdded.toFixed(2)}`);
    console.log(`  Expected new NAV ≈ current NAV + $${totalAdded.toFixed(2)}`);

    if (!DRY) {
        await ref.set(arena);
        console.log('\n✅ arena_config saved. cashBalance fields now reflect DCA reserve cash.');
        console.log('   NAV will now match Revolut account balance.');
    } else {
        console.log('\n[DRY RUN] Would apply the above. Run without --dry to write.');
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
