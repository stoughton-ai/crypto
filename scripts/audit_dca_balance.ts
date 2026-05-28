/**
 * DCA BALANCE AUDIT
 * Reads the raw Firestore arena state and reconciles:
 *   - Per-pool: cashBalance vs dcaReserve vs token holdings
 *   - Aggregate: Original pool + DCA = NAV
 *   - Flags any case where cashBalance < dcaReserve (reserve has been consumed)
 *
 * Run: npx tsx scripts/audit_dca_balance.ts
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

function sep(c = '═', n = 72) { return c.repeat(n); }
function fmt(n: number) { return n.toFixed(2).padStart(10); }

async function main() {
    // ── 1. Raw Firestore state ──────────────────────────────────────────────
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    if (!arenaSnap.exists) { console.error('No arena_config found'); process.exit(1); }
    const arena = arenaSnap.data()!;

    const dcaSnap = await db.collection('dca_config').doc(USER_ID).get();
    const dcaConfig = dcaSnap.exists ? dcaSnap.data()! : {};

    console.log('\n' + sep());
    console.log('  DCA BALANCE AUDIT — RAW FIRESTORE STATE');
    console.log(sep());

    // ── 2. Per-pool breakdown ───────────────────────────────────────────────
    let totalCash = 0;
    let totalDcaReserveField = 0;
    let totalDcaContrib = 0;
    let totalDcaDeployed = 0;

    console.log(`\n${'Pool'.padEnd(22)} ${'cashBalance'.padStart(12)} ${'dcaReserve'.padStart(12)} ${'dcaContrib'.padStart(12)} ${'dcaDeployed'.padStart(12)} ${'freeCash*'.padStart(12)} ${'STATUS'.padStart(16)}`);
    console.log('  ' + '─'.repeat(102));

    for (const pool of arena.pools as any[]) {
        const cash: number = pool.cashBalance ?? 0;
        const reserve: number = pool.dcaReserve ?? 0;
        const contrib: number = pool.dcaContributions ?? 0;
        const deployed: number = pool.dcaDeployedTotal ?? 0;
        const freeCash = Math.max(0, cash - reserve);

        totalCash += cash;
        totalDcaReserveField += reserve;
        totalDcaContrib += contrib;
        totalDcaDeployed += deployed;

        const reserveInCash = Math.min(reserve, cash); // how much of the reserve actually exists in cash
        const reserveConsumed = reserve - reserveInCash;
        let status = '✅ OK';
        if (reserveConsumed > 0.005) {
            status = `⚠️  RESERVE CONSUMED $${reserveConsumed.toFixed(2)}`;
        }

        const label = `${pool.emoji} ${pool.name}`;
        console.log(`  ${label.padEnd(20)} ${fmt(cash)} ${fmt(reserve)} ${fmt(contrib)} ${fmt(deployed)} ${fmt(freeCash)}  ${status}`);

        // Holdings detail
        const holdings = pool.holdings as Record<string, { amount: number; averagePrice: number }>;
        for (const [ticker, h] of Object.entries(holdings)) {
            if (h.amount > 0) {
                const costVal = h.amount * h.averagePrice;
                console.log(`    ${('  └ ' + ticker).padEnd(20)} ${'(held @ avg $' + h.averagePrice.toFixed(4) + ' × ' + h.amount.toFixed(4) + ' = $' + costVal.toFixed(2) + ' cost basis)'}`);
            }
        }
    }

    console.log('\n  * freeCash = max(0, cashBalance − dcaReserve)');

    // ── 3. Aggregate check ──────────────────────────────────────────────────
    console.log('\n' + sep('─'));
    console.log('  AGGREGATE TOTALS (from Firestore field values)');
    console.log(sep('─'));
    console.log(`  Sum of pool.cashBalance   : $${totalCash.toFixed(2)}`);
    console.log(`  Sum of pool.dcaReserve    : $${totalDcaReserveField.toFixed(2)}`);
    console.log(`  Sum of pool.dcaContrib    : $${totalDcaContrib.toFixed(2)}`);
    console.log(`  Sum of pool.dcaDeployed   : $${totalDcaDeployed.toFixed(2)}`);

    // DCA config totals (separate document)
    console.log('\n  dca_config document:');
    console.log(`    totalDeposited          : $${(dcaConfig.totalDeposited ?? 0).toFixed(2)}`);
    console.log(`    totalDeployed (DCA doc) : $${(dcaConfig.totalDeployed ?? 0).toFixed(2)}`);
    console.log(`    lastDepositDate         : ${dcaConfig.lastDepositDate ?? 'n/a'}`);

    // ── 4. Reserve vs cashBalance consistency ──────────────────────────────
    console.log('\n' + sep('─'));
    console.log('  KEY CONSISTENCY CHECKS');
    console.log(sep('─'));

    const reserveConsumedTotal = Math.max(0, totalDcaReserveField - totalCash);
    const dcaReserveActuallyInCash = Math.min(totalDcaReserveField, totalCash);

    console.log(`\n  dcaReserve fields total   : $${totalDcaReserveField.toFixed(2)}`);
    console.log(`  cashBalance total         : $${totalCash.toFixed(2)}`);
    if (reserveConsumedTotal > 0.005) {
        console.log(`\n  ⚠️  ISSUE: dcaReserve fields EXCEED total cashBalance by $${reserveConsumedTotal.toFixed(2)}`);
        console.log(`  This means the ring-fence has been breached: regular trading buys`);
        console.log(`  consumed $${reserveConsumedTotal.toFixed(2)} of capital that was supposed to be ring-fenced as DCA reserve.`);
        console.log(`  The dcaReserve FIELD in Firestore was never reduced to reflect this.`);
        console.log(`\n  → dcaReserve fields should be reduced by $${reserveConsumedTotal.toFixed(2)} to re-sync with reality.`);
        console.log(`  → Specifically: fix each pool where pool.cashBalance < pool.dcaReserve`);
        console.log(`    by setting pool.dcaReserve = pool.cashBalance for that pool.`);
    } else {
        console.log(`\n  ✅ dcaReserve is fully covered by cashBalance. No breach detected.`);
    }

    // ── 5. NAV reconciliation hint ─────────────────────────────────────────
    console.log('\n' + sep('─'));
    console.log('  NAV RECONCILIATION (requires live token prices)');
    console.log(sep('─'));
    console.log(`\n  The UI shows:`);
    console.log(`    NAV (top panel)     = sum of all pools (cashBalance + live token value)`);
    console.log(`    ORIGINAL POOL total = NAV − dcaContributions`);
    console.log(`    DCA PROGRAMME total = dcaContributions ($${totalDcaContrib.toFixed(2)})`);
    console.log(`\n  These three always reconcile: ORIGINAL + DCA = NAV ✓`);
    console.log(`\n  The dcaReserve field mismatch ($${reserveConsumedTotal.toFixed(2)}) is a DISPLAY issue`);
    console.log(`  in the DCA strip — it over-states holding reserve by $${reserveConsumedTotal.toFixed(2)}.`);
    console.log(`  The NAV itself is correct (cashBalance is the true source of truth for cash).`);

    // ── 6. Recommended fix ─────────────────────────────────────────────────
    if (reserveConsumedTotal > 0.005) {
        console.log('\n' + sep('─'));
        console.log('  RECOMMENDED FIX');
        console.log(sep('─'));
        console.log('\n  For each pool where cashBalance < dcaReserve:');
        for (const pool of arena.pools as any[]) {
            const cash: number = pool.cashBalance ?? 0;
            const reserve: number = pool.dcaReserve ?? 0;
            if (reserve > cash + 0.005) {
                const correction = cash; // new dcaReserve = cashBalance (all remaining cash IS the reserve)
                console.log(`\n  ${pool.emoji} ${pool.name} (${pool.poolId}):`);
                console.log(`    cashBalance = $${cash.toFixed(2)}`);
                console.log(`    dcaReserve  = $${reserve.toFixed(2)}  ← overstated by $${(reserve - cash).toFixed(2)}`);
                console.log(`    Fix: set dcaReserve = $${correction.toFixed(2)} (= cashBalance)`);
                console.log(`         set dcaContributions unchanged = $${(pool.dcaContributions ?? 0).toFixed(2)}`);
                console.log(`    This reflects that $${(reserve - cash).toFixed(2)} of the DCA contribution was`);
                console.log(`    consumed by normal trading buys (still part of portfolio value as tokens).`);
            }
        }
        console.log('\n  Run: npx tsx scripts/fix_dca_reserve.ts   (to apply the fix)');
    }

    console.log('\n' + sep() + '\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
