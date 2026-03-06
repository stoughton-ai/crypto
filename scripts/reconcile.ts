import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

/**
 * ARENA ↔ REVOLUT RECONCILIATION
 * 
 * Fetches actual holdings from Revolut, compares against arena state,
 * and reports/fixes any discrepancies.
 * 
 * Usage:
 *   npx tsx scripts/reconcile.ts          # Report only
 *   npx tsx scripts/reconcile.ts --fix    # Report + fix arena state
 */

const FIX_MODE = process.argv.includes('--fix');

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    const { RevolutX } = await import('../src/lib/revolut');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // 1. Get Revolut config
    const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    if (!config?.revolutApiKey || !config?.revolutPrivateKey) {
        console.error('No Revolut credentials found'); process.exit(1);
    }

    // 2. Get arena state
    const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data();
    if (!arena?.pools) { console.error('No arena found'); process.exit(1); }

    // 3. Fetch actual Revolut balances
    console.log('📡 Fetching Revolut balances...');
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox || false, config.revolutProxyUrl);
    const balances = await client.getBalances();

    // Parse Revolut balances into a map
    const revolutHoldings: Record<string, { amount: number; currency: string }> = {};
    let revolutUSD = 0;

    for (const b of balances) {
        const currency = (b.currency || b.symbol || '').toUpperCase();
        const amount = parseFloat((b.balance ?? b.amount ?? b.total ?? 0).toString());
        if (amount <= 0) continue;

        if (['USD', 'EUR', 'GBP'].includes(currency)) {
            if (currency === 'USD') revolutUSD = amount;
            continue;
        }
        revolutHoldings[currency] = { amount, currency };
    }

    // 4. Build arena holdings map (across all pools)
    const arenaHoldings: Record<string, { amount: number; pool: string; avgPrice: number }> = {};
    let arenaCashTotal = 0;

    for (const pool of arena.pools) {
        arenaCashTotal += pool.cashBalance;
        for (const [ticker, holding] of Object.entries(pool.holdings || {})) {
            const h = holding as any;
            if (h.amount > 0) {
                arenaHoldings[ticker.toUpperCase()] = {
                    amount: h.amount,
                    pool: pool.poolId,
                    avgPrice: h.averagePrice,
                };
            }
        }
    }

    // 5. Reconcile
    console.log('\n' + '═'.repeat(70));
    console.log('  ARENA ↔ REVOLUT RECONCILIATION');
    console.log('═'.repeat(70));

    // All tokens across both systems
    const allTokens = new Set([
        ...Object.keys(arenaHoldings),
        ...Object.keys(revolutHoldings),
    ]);

    // Tokens in the arena (to filter Revolut holdings)
    const arenaTokens = new Set<string>();
    for (const pool of arena.pools) {
        pool.tokens.forEach((t: string) => arenaTokens.add(t.toUpperCase()));
    }

    let hasDiscrepancy = false;
    const discrepancies: Array<{
        ticker: string;
        arenaAmount: number;
        revolutAmount: number;
        diffPct: number;
        pool: string;
    }> = [];

    console.log('\n  Token         Arena Amount         Revolut Amount       Diff %    Status');
    console.log('  ' + '─'.repeat(66));

    for (const ticker of [...allTokens].sort()) {
        // Only reconcile tokens that are in the arena
        if (!arenaTokens.has(ticker)) continue;

        const arenaAmt = arenaHoldings[ticker]?.amount || 0;
        const revolutAmt = revolutHoldings[ticker]?.amount || 0;
        const pool = arenaHoldings[ticker]?.pool || '???';

        let diffPct = 0;
        let status = '✅ MATCH';

        if (arenaAmt > 0 && revolutAmt > 0) {
            diffPct = ((revolutAmt - arenaAmt) / arenaAmt) * 100;
            if (Math.abs(diffPct) > 1) {
                status = '⚠️  MISMATCH';
                hasDiscrepancy = true;
                discrepancies.push({ ticker, arenaAmount: arenaAmt, revolutAmount: revolutAmt, diffPct, pool });
            }
        } else if (arenaAmt > 0 && revolutAmt === 0) {
            status = '❌ ARENA ONLY';
            diffPct = -100;
            hasDiscrepancy = true;
            discrepancies.push({ ticker, arenaAmount: arenaAmt, revolutAmount: 0, diffPct, pool });
        } else if (arenaAmt === 0 && revolutAmt > 0) {
            status = '❌ REVOLUT ONLY';
            diffPct = 100;
            hasDiscrepancy = true;
            discrepancies.push({ ticker, arenaAmount: 0, revolutAmount: revolutAmt, diffPct, pool });
        }

        const arenaStr = arenaAmt > 0 ? arenaAmt.toFixed(6) : '—';
        const revolutStr = revolutAmt > 0 ? revolutAmt.toFixed(6) : '—';
        const diffStr = diffPct !== 0 ? `${diffPct > 0 ? '+' : ''}${diffPct.toFixed(2)}%` : '—';

        console.log(`  ${ticker.padEnd(13)} ${arenaStr.padStart(18)}   ${revolutStr.padStart(18)}  ${diffStr.padStart(8)}    ${status}`);
    }

    // Cash summary
    console.log('\n  ' + '─'.repeat(66));
    console.log(`  Cash (Arena):    $${arenaCashTotal.toFixed(2)}`);
    console.log(`  USD (Revolut):   $${revolutUSD.toFixed(2)}`);

    // Non-arena tokens on Revolut
    const extraTokens = Object.keys(revolutHoldings).filter(t => !arenaTokens.has(t));
    if (extraTokens.length > 0) {
        console.log(`\n  ℹ️  Non-arena tokens on Revolut: ${extraTokens.join(', ')}`);
    }

    if (!hasDiscrepancy) {
        console.log('\n  ✅ All arena holdings match Revolut. No action needed.');
    } else {
        console.log(`\n  ⚠️  ${discrepancies.length} discrepancy(ies) found.`);

        if (FIX_MODE) {
            console.log('\n  🔧 FIX MODE — Updating arena state to match Revolut...');

            for (const d of discrepancies) {
                const poolIdx = arena.pools.findIndex((p: any) => p.poolId === d.pool);
                if (poolIdx === -1) {
                    // Token exists on Revolut but not in any arena pool — can't auto-fix
                    console.log(`  ⏭️  ${d.ticker}: Cannot auto-fix (not in any pool).`);
                    continue;
                }

                const pool = arena.pools[poolIdx];

                if (d.revolutAmount > 0 && d.arenaAmount === 0) {
                    // Token on Revolut but not in arena — need to figure out which pool
                    console.log(`  ⏭️  ${d.ticker}: On Revolut but not in arena. Manual assignment needed.`);
                } else if (d.revolutAmount === 0 && d.arenaAmount > 0) {
                    // Token in arena but not on Revolut — clear from arena
                    const valueCleared = d.arenaAmount * (pool.holdings[d.ticker]?.averagePrice || 0);
                    delete pool.holdings[d.ticker];
                    pool.cashBalance += valueCleared;
                    console.log(`  ✅ ${d.ticker}: Cleared from arena (was $${valueCleared.toFixed(2)}). Cash restored.`);
                } else {
                    // Amount mismatch — update arena to match Revolut
                    pool.holdings[d.ticker].amount = d.revolutAmount;
                    console.log(`  ✅ ${d.ticker}: Arena amount updated ${d.arenaAmount.toFixed(6)} → ${d.revolutAmount.toFixed(6)} (${d.diffPct > 0 ? '+' : ''}${d.diffPct.toFixed(2)}%)`);
                }

                arena.pools[poolIdx] = pool;
            }

            await adminDb.collection('arena_config').doc(userId).set(arena);
            console.log('\n  ✅ Arena state saved.');
        } else {
            console.log('  Run with --fix to auto-correct: npx tsx scripts/reconcile.ts --fix');
        }
    }

    console.log('\n' + '═'.repeat(70));
    process.exit(0);
}

go().catch(e => { console.error(e); process.exit(1); });
