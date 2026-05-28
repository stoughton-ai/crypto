/**
 * Full audit: compare Revolut X balances (cash + crypto) vs dashboard (arena_config)
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

function fmt(n: number) { return '$' + n.toFixed(4); }

async function main() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   FULL REVOLUT vs DASHBOARD AUDIT');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Load arena config
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data() as any;

    // Load Revolut credentials
    const configDoc = await db.collection('agent_configs').doc(USER_ID).get();
    const config = configDoc.data()!;

    const { RevolutX } = await import('../src/lib/revolut');
    const client = new RevolutX(
        config.revolutApiKey, config.revolutPrivateKey,
        config.revolutIsSandbox || false, config.revolutProxyUrl,
    );

    // Get all Revolut balances
    const balances = await client.getBalances();
    console.log('RAW REVOLUT BALANCES:');
    console.log(JSON.stringify(balances, null, 2));

    // Parse Revolut holdings
    const revolutHoldings: Record<string, number> = {};
    let revolutUsd = 0;

    for (const b of balances as any[]) {
        const currency = (b.currency || b.symbol || '').toUpperCase();
        const amount = parseFloat((b.available ?? b.balance ?? 0).toString());
        if (currency === 'USD') {
            revolutUsd = amount;
        } else if (amount > 0) {
            revolutHoldings[currency] = amount;
        }
    }

    console.log('\n─── REVOLUT SUMMARY ───');
    console.log(`  USD Cash: $${revolutUsd.toFixed(2)}`);
    for (const [token, amount] of Object.entries(revolutHoldings)) {
        console.log(`  ${token}: ${amount}`);
    }

    // Parse dashboard holdings (across all pools)
    const dashboardHoldings: Record<string, { amount: number; pools: string[] }> = {};
    let dashboardCash = 0;

    for (const pool of arena.pools) {
        dashboardCash += pool.cashBalance || 0;
        for (const [token, holding] of Object.entries(pool.holdings || {})) {
            const h = holding as any;
            if (h.amount > 0) {
                if (!dashboardHoldings[token.toUpperCase()]) {
                    dashboardHoldings[token.toUpperCase()] = { amount: 0, pools: [] };
                }
                dashboardHoldings[token.toUpperCase()].amount += h.amount;
                dashboardHoldings[token.toUpperCase()].pools.push(`${pool.emoji} ${pool.name}`);
            }
        }
    }

    console.log('\n─── DASHBOARD SUMMARY ───');
    console.log(`  USD Cash: $${dashboardCash.toFixed(2)}`);
    for (const [token, data] of Object.entries(dashboardHoldings)) {
        console.log(`  ${token}: ${data.amount.toFixed(8)} (in: ${data.pools.join(', ')})`);
    }

    // ═══ COMPARISON ═══
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   COMPARISON');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Cash
    const cashDrift = revolutUsd - dashboardCash;
    console.log(`CASH: Revolut $${revolutUsd.toFixed(2)} | Dashboard $${dashboardCash.toFixed(2)} | Drift: ${cashDrift >= 0 ? '+' : ''}$${cashDrift.toFixed(2)} ${Math.abs(cashDrift) < 1 ? '✅' : '⚠️'}`);

    // Holdings
    const allTokens = new Set([...Object.keys(revolutHoldings), ...Object.keys(dashboardHoldings)]);
    
    let hasIssues = false;
    console.log('\nHOLDINGS:');
    console.log('  Token         | Revolut          | Dashboard        | Drift');
    console.log('  ──────────────┼──────────────────┼──────────────────┼─────────────');
    
    for (const token of [...allTokens].sort()) {
        const revAmt = revolutHoldings[token] ?? 0;
        const dashAmt = dashboardHoldings[token]?.amount ?? 0;
        const drift = revAmt - dashAmt;
        const pctDrift = dashAmt > 0 ? (drift / dashAmt) * 100 : (revAmt > 0 ? 100 : 0);
        const status = Math.abs(pctDrift) < 2 ? '✅' : revAmt > 0 && dashAmt === 0 ? '🔴 NOT TRACKED' : dashAmt > 0 && revAmt === 0 ? '🔴 PHANTOM' : '⚠️';
        
        if (Math.abs(pctDrift) >= 2 || (revAmt > 0 && dashAmt === 0) || (dashAmt > 0 && revAmt === 0)) {
            hasIssues = true;
        }
        
        console.log(`  ${token.padEnd(14)} | ${revAmt.toFixed(8).padStart(16)} | ${dashAmt.toFixed(8).padStart(16)} | ${drift >= 0 ? '+' : ''}${drift.toFixed(8)} ${status}`);
    }

    // Per-pool detail
    console.log('\n─── PER-POOL DETAIL ───');
    for (const pool of arena.pools) {
        const holdings = Object.entries(pool.holdings || {}).filter(([, h]: any) => (h as any).amount > 0);
        console.log(`\n  ${pool.emoji} ${pool.name} (cash: $${(pool.cashBalance || 0).toFixed(2)})`);
        if (holdings.length === 0) {
            console.log('    No holdings');
        } else {
            for (const [token, h] of holdings) {
                const holding = h as any;
                console.log(`    ${token}: ${holding.amount.toFixed(8)} @ avg $${holding.averagePrice?.toFixed(4) || '?'}`);
            }
        }
    }

    if (!hasIssues) {
        console.log('\n✅ All holdings match within 2% tolerance.\n');
    } else {
        console.log('\n⚠️  Holdings discrepancies detected! See above.\n');
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
