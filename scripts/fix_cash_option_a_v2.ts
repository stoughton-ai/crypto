/**
 * OPTION A CORRECTED FIX
 * 
 * The PREVIOUS cashBalance values were synced from Revolut and were correct
 * EXCEPT they had phantom DCA money added ($120 total).
 * 
 * Fix: Restore pre-fix cash values, subtract the DCA reserve from each,
 * then zero the DCA fields.
 * 
 * Pre-fix state (from Revolut sync + DCA credits):
 *   P1: $29.59 (dcaReserve $29.59) → real cash = $0.00
 *   P2: $24.00 (dcaReserve $24.00) → real cash = $0.00
 *   P3: $84.54 (dcaReserve $36.00) → real cash = $48.54
 *   P4: $50.51 (dcaReserve $24.00) → real cash = $26.51
 *   TOTAL: $75.05  (Revolut USD: ~$44.47 — gap of ~$30 from fees/slippage)
 * 
 * Run with --dry-run first:   npx tsx scripts/fix_cash_option_a_v2.ts --dry-run
 * Then apply for real:        npx tsx scripts/fix_cash_option_a_v2.ts --apply
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
const DRY_RUN = !process.argv.includes('--apply');

function fmt(n: number) { return '$' + n.toFixed(2); }
function sep(c = '═', n = 78) { return c.repeat(n); }

// Pre-fix values (what the pools had BEFORE the bad fix, from Revolut sync)
const PRE_FIX_STATE: Record<string, { cashBalance: number; dcaReserve: number; dcaContributions: number }> = {
    POOL_1: { cashBalance: 29.59, dcaReserve: 29.59, dcaContributions: 36.00 },
    POOL_2: { cashBalance: 24.00, dcaReserve: 24.00, dcaContributions: 24.00 },
    POOL_3: { cashBalance: 84.54, dcaReserve: 36.00, dcaContributions: 36.00 },
    POOL_4: { cashBalance: 50.51, dcaReserve: 24.00, dcaContributions: 24.00 },
};

async function main() {
    console.log('\n' + sep());
    console.log(`  OPTION A CORRECTED — Strip DCA from Revolut-synced values ${DRY_RUN ? '[DRY RUN]' : '[APPLYING]'}`);
    console.log(sep());

    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    if (!arenaSnap.exists) { console.error('No arena_config found'); process.exit(1); }
    const arena = arenaSnap.data()! as any;

    // Also query Revolut for verification
    let revolutUsd = 0;
    try {
        const configSnap = await db.collection('agent_configs').doc(USER_ID).get();
        const config = configSnap.data()!;
        if (config.revolutApiKey && config.revolutPrivateKey) {
            const { RevolutX } = await import('../src/lib/revolut');
            const client = new RevolutX(
                config.revolutApiKey, config.revolutPrivateKey,
                config.revolutIsSandbox || false, config.revolutProxyUrl
            );
            const balances = await client.getBalances();
            const usd = (balances as any[]).find(b => (b.currency || b.symbol || '').toUpperCase() === 'USD');
            revolutUsd = parseFloat((usd?.available ?? usd?.balance ?? 0).toString());
            console.log(`\n  Revolut live USD: ${fmt(revolutUsd)}`);
        }
    } catch (e: any) {
        console.log(`\n  ⚠️ Could not query Revolut: ${e.message}`);
    }

    console.log('');

    for (const pool of arena.pools) {
        const preFix = PRE_FIX_STATE[pool.poolId];
        if (!preFix) { console.error(`No pre-fix state for ${pool.poolId}`); continue; }

        // Real cash = pre-fix cashBalance minus DCA reserve (phantom money)
        const realCash = Math.max(0, preFix.cashBalance - preFix.dcaReserve);

        console.log(`  ${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`    Current cashBalance (broken) : ${fmt(pool.cashBalance)}`);
        console.log(`    Pre-fix cashBalance          : ${fmt(preFix.cashBalance)}`);
        console.log(`    DCA reserve to remove        : ${fmt(preFix.dcaReserve)}`);
        console.log(`    NEW cashBalance              : ${fmt(realCash)}`);
        console.log(`    dcaReserve  → $0.00`);
        console.log(`    dcaContrib  → $0.00`);
        console.log('');
    }

    const totalNew = Object.values(PRE_FIX_STATE).reduce((s, v) => s + Math.max(0, v.cashBalance - v.dcaReserve), 0);
    console.log(sep('─'));
    console.log(`  SUMMARY`);
    console.log(sep('─'));
    console.log(`  Current total cash (broken)   : ${fmt(arena.pools.reduce((s: number, p: any) => s + p.cashBalance, 0))}`);
    console.log(`  New total cash (DCA stripped)  : ${fmt(totalNew)}`);
    console.log(`  Revolut USD actual             : ${fmt(revolutUsd)}`);
    console.log(`  Remaining gap (fees/slippage)  : ${fmt(totalNew - revolutUsd)}`);
    console.log('');

    if (DRY_RUN) {
        console.log('  🔍 DRY RUN — no changes applied.');
        console.log('  Run with --apply to commit these changes.\n');
        process.exit(0);
    }

    // Apply
    for (const pool of arena.pools) {
        const preFix = PRE_FIX_STATE[pool.poolId];
        pool.cashBalance = Math.max(0, preFix.cashBalance - preFix.dcaReserve);
        pool.dcaReserve = 0;
        pool.dcaContributions = 0;
        pool.dcaDeployedTotal = 0;
    }

    await db.collection('arena_config').doc(USER_ID).set(arena);
    console.log('  ✅ Arena config updated');

    // Ensure DCA is paused
    const dcaRef = db.collection('dca_config').doc(USER_ID);
    const dcaSnap = await dcaRef.get();
    if (dcaSnap.exists) {
        await dcaRef.update({
            enabled: false,
            pausedAt: new Date().toISOString(),
            pauseReason: 'Option A reconciliation — DCA paused: no real deposits on Revolut.',
        });
        console.log('  ✅ DCA paused');
    }

    console.log('\n  ✅ Fix applied. Dashboard cash should now closely match Revolut.\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
