/**
 * CASH vs TRADES RECONCILIATION AUDIT
 * Reads Firestore arena state + all trade records, reconstructs what each
 * pool's cashBalance SHOULD be, and compares with the actual stored value.
 * Also queries Revolut X for the real USD balance.
 *
 * Run: npx tsx scripts/audit_cash_vs_trades.ts
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

function sep(c = '═', n = 78) { return c.repeat(n); }
function fmt(n: number) { return '$' + n.toFixed(2); }

async function main() {
    console.log('\n' + sep());
    console.log('  CASH vs TRADES RECONCILIATION AUDIT');
    console.log('  ' + new Date().toISOString());
    console.log(sep());

    // ── 1. Arena Config (current state) ────────────────────────────────────
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    if (!arenaSnap.exists) { console.error('No arena_config found'); process.exit(1); }
    const arena = arenaSnap.data()!;

    // ── 2. All trades (no limit — get everything) ──────────────────────────
    const tradesSnap = await db.collection('arena_trades')
        .where('userId', '==', USER_ID)
        .get();
    const allTrades = tradesSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    console.log(`\n  Total trades in Firestore: ${allTrades.length}\n`);

    // ── 3. DCA Config ──────────────────────────────────────────────────────
    const dcaSnap = await db.collection('dca_config').doc(USER_ID).get();
    const dcaConfig = dcaSnap.exists ? dcaSnap.data()! : {};

    // ── 4. Per-pool reconciliation ─────────────────────────────────────────
    let grandTotalActual = 0;
    let grandTotalExpected = 0;
    let grandTotalDiscrepancy = 0;

    for (const pool of (arena.pools as any[])) {
        const poolTrades = allTrades.filter((t: any) => t.poolId === pool.poolId);
        const buys = poolTrades.filter((t: any) => t.type === 'BUY');
        const sells = poolTrades.filter((t: any) => t.type === 'SELL');

        const totalBought = buys.reduce((s: number, t: any) => s + (t.total || 0), 0);
        const totalSold = sells.reduce((s: number, t: any) => s + (t.total || 0), 0);
        const dcaContrib = pool.dcaContributions ?? 0;

        // Expected cash = starting budget - buys + sells + DCA contributions
        const expectedCash = pool.budget + dcaContrib - totalBought + totalSold;
        const actualCash = pool.cashBalance ?? 0;
        const discrepancy = actualCash - expectedCash;

        grandTotalActual += actualCash;
        grandTotalExpected += expectedCash;
        grandTotalDiscrepancy += discrepancy;

        const flag = Math.abs(discrepancy) > 0.01 ? '⚠️' : '✅';

        console.log(sep('─'));
        console.log(`  ${pool.emoji} ${pool.name} (${pool.poolId})  ${flag}`);
        console.log(sep('─'));
        console.log(`  Starting budget     : ${fmt(pool.budget)}`);
        console.log(`  DCA contributions   : ${fmt(dcaContrib)}`);
        console.log(`  Total buys  (${buys.length.toString().padStart(3)}) : ${fmt(totalBought)}`);
        console.log(`  Total sells (${sells.length.toString().padStart(3)}) : ${fmt(totalSold)}`);
        console.log(`  ──────────────────────────`);
        console.log(`  Expected cashBalance: ${fmt(expectedCash)}`);
        console.log(`  Actual   cashBalance: ${fmt(actualCash)}`);
        console.log(`  DISCREPANCY         : ${fmt(discrepancy)} ${flag}`);

        // Current holdings
        const holdings = pool.holdings as Record<string, { amount: number; averagePrice: number }>;
        const holdingEntries = Object.entries(holdings).filter(([_, h]) => h.amount > 0);
        if (holdingEntries.length > 0) {
            console.log(`\n  Current holdings:`);
            for (const [ticker, h] of holdingEntries) {
                const costBasis = h.amount * h.averagePrice;
                console.log(`    ${ticker}: ${h.amount.toFixed(6)} × $${h.averagePrice.toFixed(4)} = ${fmt(costBasis)} (cost basis)`);
            }
        }

        // Trade-by-trade detail for discrepant pools
        if (Math.abs(discrepancy) > 0.01) {
            console.log(`\n  Trade-by-trade replay for ${pool.poolId}:`);
            let runningCash = pool.budget + dcaContrib;
            console.log(`    START: ${fmt(runningCash)}`);
            for (const t of poolTrades) {
                if (t.type === 'BUY') {
                    runningCash -= t.total;
                } else {
                    runningCash += t.total;
                }
                console.log(`    ${t.date?.substring(0, 16)} ${t.type.padEnd(4)} ${t.ticker.padEnd(6)} ${fmt(t.total).padStart(10)} → cash: ${fmt(runningCash)}`);
            }
            console.log(`    END:   ${fmt(runningCash)} (expected)  vs  ${fmt(actualCash)} (Firestore)`);
        }

        // DCA reserve state
        if (pool.dcaReserve) {
            console.log(`\n  DCA State:`);
            console.log(`    dcaReserve       : ${fmt(pool.dcaReserve ?? 0)}`);
            console.log(`    dcaContributions : ${fmt(pool.dcaContributions ?? 0)}`);
            console.log(`    dcaDeployed      : ${fmt(pool.dcaDeployedTotal ?? 0)}`);
            if (pool.dcaReserve > actualCash) {
                console.log(`    ⚠️ dcaReserve EXCEEDS cashBalance by ${fmt(pool.dcaReserve - actualCash)}!`);
            }
        }
        console.log('');
    }

    // ── 5. Grand totals ────────────────────────────────────────────────────
    console.log(sep());
    console.log('  GRAND TOTALS');
    console.log(sep());
    console.log(`  Sum of expected cashBalances : ${fmt(grandTotalExpected)}`);
    console.log(`  Sum of actual cashBalances   : ${fmt(grandTotalActual)}`);
    console.log(`  TOTAL DISCREPANCY            : ${fmt(grandTotalDiscrepancy)} ${Math.abs(grandTotalDiscrepancy) > 0.01 ? '⚠️' : '✅'}`);

    // ── 6. Revolut X balance (if API keys available) ───────────────────────
    try {
        const configSnap = await db.collection('agent_configs').doc(USER_ID).get();
        const config = configSnap.data()!;

        if (config.revolutApiKey && config.revolutPrivateKey) {
            const { RevolutX } = await import('../src/lib/revolut');
            const client = new RevolutX(
                config.revolutApiKey,
                config.revolutPrivateKey,
                config.revolutIsSandbox || false,
                config.revolutProxyUrl
            );

            console.log('\n' + sep('─'));
            console.log('  REVOLUT X — LIVE BALANCES');
            console.log(sep('─'));

            const balances = await client.getBalances();
            console.log(`\n  Raw API response (${balances.length} entries):`);

            let revolutUsd = 0;
            const revolutCryptoHoldings: { symbol: string; balance: number }[] = [];
            const fiatCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];

            for (const b of balances as any[]) {
                const currency = (b.currency || b.symbol || '').toUpperCase();
                const balance = parseFloat((b.balance ?? b.amount ?? b.available ?? b.total ?? 0).toString());
                const available = parseFloat((b.available ?? b.balance ?? b.amount ?? 0).toString());
                
                console.log(`    ${currency.padEnd(8)} balance: ${balance.toFixed(8).padStart(18)}  available: ${available.toFixed(8).padStart(18)}`);
                
                if (currency === 'USD') {
                    revolutUsd = available;
                }
                if (!fiatCurrencies.includes(currency) && balance > 0) {
                    revolutCryptoHoldings.push({ symbol: currency, balance });
                }
            }

            console.log(`\n  Revolut USD available: ${fmt(revolutUsd)}`);
            
            // Compare arena holdings vs Revolut holdings
            console.log('\n' + sep('─'));
            console.log('  HOLDINGS COMPARISON: ARENA CONFIG vs REVOLUT X');
            console.log(sep('─'));

            // Aggregate all arena holdings
            const arenaHoldings: Record<string, number> = {};
            for (const pool of arena.pools as any[]) {
                for (const [ticker, h] of Object.entries(pool.holdings as Record<string, { amount: number }>)) {
                    if (h.amount > 0) {
                        arenaHoldings[ticker.toUpperCase()] = (arenaHoldings[ticker.toUpperCase()] || 0) + h.amount;
                    }
                }
            }

            // Build combined list of all tickers
            const allTickers = new Set([
                ...Object.keys(arenaHoldings),
                ...revolutCryptoHoldings.map(h => h.symbol.toUpperCase())
            ]);

            console.log(`\n  ${'Ticker'.padEnd(10)} ${'Arena Amount'.padStart(18)} ${'Revolut Amount'.padStart(18)} ${'Difference'.padStart(18)} ${'Status'.padStart(8)}`);
            console.log('  ' + '─'.repeat(76));

            for (const ticker of [...allTickers].sort()) {
                const arenaAmt = arenaHoldings[ticker] || 0;
                const revolutAmt = revolutCryptoHoldings.find(h => h.symbol === ticker)?.balance || 0;
                const diff = revolutAmt - arenaAmt;
                const flag = Math.abs(diff) > 0.000001 ? '⚠️' : '✅';

                console.log(`  ${ticker.padEnd(10)} ${arenaAmt.toFixed(8).padStart(18)} ${revolutAmt.toFixed(8).padStart(18)} ${diff.toFixed(8).padStart(18)} ${flag}`);
            }

            // Total USD value comparison
            console.log(`\n  Arena total cash (all pools) : ${fmt(grandTotalActual)}`);
            console.log(`  Revolut USD available        : ${fmt(revolutUsd)}`);
            console.log(`  Cash difference              : ${fmt(revolutUsd - grandTotalActual)} ${Math.abs(revolutUsd - grandTotalActual) > 0.01 ? '⚠️' : '✅'}`);
        }
    } catch (e: any) {
        console.log(`\n  ⚠️ Could not query Revolut X: ${e.message}`);
    }

    // ── 7. DCA History detail ──────────────────────────────────────────────
    if (dcaConfig.history) {
        console.log('\n' + sep('─'));
        console.log('  DCA DEPOSIT HISTORY');
        console.log(sep('─'));
        for (const entry of (dcaConfig.history as any[])) {
            console.log(`  ${entry.date?.substring(0, 10)} | ${entry.poolId.padEnd(8)} | credited: ${fmt(entry.credited)} | deployed: ${fmt(entry.deployed)}`);
        }
        console.log(`\n  dca_config.totalDeposited : ${fmt(dcaConfig.totalDeposited ?? 0)}`);
        console.log(`  dca_config.totalDeployed  : ${fmt(dcaConfig.totalDeployed ?? 0)}`);
    }

    console.log('\n' + sep() + '\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
