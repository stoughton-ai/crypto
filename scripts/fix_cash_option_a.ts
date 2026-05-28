/**
 * OPTION A FIX: Revolut is Source of Truth
 * 
 * 1. Recalculates each pool's cashBalance from trade history (budget − buys + sells)
 *    WITHOUT DCA contributions (since no real DCA money was deposited to Revolut).
 * 2. Zeros out dcaReserve, dcaContributions, dcaDeployedTotal per pool.
 * 3. Pauses the DCA config document.
 * 
 * Run with --dry-run first:   npx tsx scripts/fix_cash_option_a.ts --dry-run
 * Then apply for real:        npx tsx scripts/fix_cash_option_a.ts --apply
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

async function main() {
    console.log('\n' + sep());
    console.log(`  OPTION A FIX — Revolut as Source of Truth ${DRY_RUN ? '[DRY RUN]' : '[APPLYING]'}`);
    console.log(sep());

    // ── 1. Read current state ──────────────────────────────────────────────
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    if (!arenaSnap.exists) { console.error('No arena_config found'); process.exit(1); }
    const arena = arenaSnap.data()! as any;

    // ── 2. Read all trades ─────────────────────────────────────────────────
    const tradesSnap = await db.collection('arena_trades')
        .where('userId', '==', USER_ID)
        .get();
    const allTrades = tradesSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    console.log(`\n  Total trades: ${allTrades.length}\n`);

    // ── 3. Calculate correct cashBalance per pool ──────────────────────────
    const fixes: { poolId: string; name: string; oldCash: number; newCash: number; oldDcaReserve: number; oldDcaContrib: number }[] = [];

    for (const pool of arena.pools) {
        const poolTrades = allTrades.filter((t: any) => t.poolId === pool.poolId);
        const buys = poolTrades.filter((t: any) => t.type === 'BUY');
        const sells = poolTrades.filter((t: any) => t.type === 'SELL');

        const totalBought = buys.reduce((s: number, t: any) => s + (t.total || 0), 0);
        const totalSold = sells.reduce((s: number, t: any) => s + (t.total || 0), 0);

        // Pure trade replay WITHOUT DCA: budget − buys + sells
        const correctCash = pool.budget - totalBought + totalSold;

        fixes.push({
            poolId: pool.poolId,
            name: `${pool.emoji} ${pool.name}`,
            oldCash: pool.cashBalance,
            newCash: correctCash,
            oldDcaReserve: pool.dcaReserve ?? 0,
            oldDcaContrib: pool.dcaContributions ?? 0,
        });

        console.log(`  ${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`    cashBalance : ${fmt(pool.cashBalance)} → ${fmt(correctCash)}  (delta: ${fmt(correctCash - pool.cashBalance)})`);
        console.log(`    dcaReserve  : ${fmt(pool.dcaReserve ?? 0)} → $0.00`);
        console.log(`    dcaContrib  : ${fmt(pool.dcaContributions ?? 0)} → $0.00`);
        console.log(`    dcaDeployed : ${fmt(pool.dcaDeployedTotal ?? 0)} → $0.00`);
        console.log('');
    }

    const totalOld = fixes.reduce((s, f) => s + f.oldCash, 0);
    const totalNew = fixes.reduce((s, f) => s + f.newCash, 0);
    const totalDcaRemoved = fixes.reduce((s, f) => s + f.oldDcaContrib, 0);

    console.log(sep('─'));
    console.log(`  SUMMARY`);
    console.log(sep('─'));
    console.log(`  Old total cash  : ${fmt(totalOld)}`);
    console.log(`  New total cash  : ${fmt(totalNew)}  (${fmt(totalNew - totalOld)} change)`);
    console.log(`  DCA removed     : ${fmt(totalDcaRemoved)}`);
    console.log('');

    // ── 4. Apply changes ───────────────────────────────────────────────────
    if (DRY_RUN) {
        console.log('  🔍 DRY RUN — no changes applied.');
        console.log('  Run with --apply to commit these changes.\n');
        process.exit(0);
    }

    // Apply pool-level fixes
    for (const pool of arena.pools) {
        const fix = fixes.find(f => f.poolId === pool.poolId)!;
        pool.cashBalance = fix.newCash;
        pool.dcaReserve = 0;
        pool.dcaContributions = 0;
        pool.dcaDeployedTotal = 0;
    }

    await db.collection('arena_config').doc(USER_ID).set(arena);
    console.log('  ✅ Arena config updated (cashBalance, dcaReserve, dcaContributions, dcaDeployedTotal)');

    // Pause the DCA config
    const dcaRef = db.collection('dca_config').doc(USER_ID);
    const dcaSnap = await dcaRef.get();
    if (dcaSnap.exists) {
        await dcaRef.update({
            enabled: false,
            pausedAt: new Date().toISOString(),
            pauseReason: 'Option A reconciliation — DCA paused because no real deposits made to Revolut. Re-enable after funding Revolut.',
        });
        console.log('  ✅ DCA config paused');
    }

    console.log('\n  ✅ All changes applied successfully.');
    console.log('  Run audit_cash_vs_trades.ts to verify.\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
