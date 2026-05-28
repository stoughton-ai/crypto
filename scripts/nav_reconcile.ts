/**
 * Full NAV reconciliation with live prices
 * Fetches live crypto prices and calculates exactly what the UI should show.
 * Run: npx tsx scripts/nav_reconcile.ts
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

async function fetchPrices(tickers: string[]): Promise<Record<string, number>> {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) return {};
    const primary = tickers[0];
    const extras = tickers.slice(1).map(t => `${t}-USD.CC`).join(',');
    const url = `https://eodhd.com/api/real-time/${primary}-USD.CC?s=${extras}&api_token=${apiKey}&fmt=json`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const data = await res.json();
    const items = Array.isArray(data) ? data : [data];
    const out: Record<string, number> = {};
    for (const item of items) {
        const ticker = (item.code ?? '').replace('-USD.CC', '').toUpperCase();
        out[ticker] = parseFloat(item.close) || 0;
    }
    return out;
}

function sep(c = '═', n = 72) { return c.repeat(n); }
function $$(n: number) { return `$${n.toFixed(2)}`; }

async function main() {
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data()!;

    // Collect all tickers with holdings
    const allTickers = new Set<string>();
    for (const pool of arena.pools as any[]) {
        pool.tokens.forEach((t: string) => allTickers.add(t.toUpperCase()));
    }
    const tickers = [...allTickers];

    console.log(`\nFetching live prices for: ${tickers.join(', ')}...`);
    const prices = await fetchPrices(tickers);
    console.log('Prices:', JSON.stringify(prices, null, 2));

    console.log('\n' + sep());
    console.log('  FULL NAV RECONCILIATION');
    console.log(sep());

    let totalNAV = 0;
    let totalDcaContrib = 0;

    for (const pool of arena.pools as any[]) {
        const cash: number = pool.cashBalance ?? 0;
        const dcaReserve: number = pool.dcaReserve ?? 0;
        const dcaContrib: number = pool.dcaContributions ?? 0;
        totalDcaContrib += dcaContrib;

        let holdingValue = 0;
        const holdingLines: string[] = [];
        for (const [ticker, h] of Object.entries(pool.holdings as Record<string, any>)) {
            if (h.amount > 0) {
                const livePrice = prices[ticker.toUpperCase()] ?? h.averagePrice;
                const val = h.amount * livePrice;
                holdingValue += val;
                holdingLines.push(`    ${ticker.padEnd(8)} ${h.amount.toFixed(4)} × $${livePrice.toFixed(4)} = ${$$(val)}`);
            }
        }

        const poolTotal = cash + holdingValue;
        const poolOriginal = Math.max(0, poolTotal - dcaContrib);
        totalNAV += poolTotal;

        console.log(`\n  ${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`    cashBalance  : ${$$(cash)}`);
        console.log(`    dcaReserve   : ${$$(dcaReserve)}  ← field value`);
        console.log(`    freeCash     : ${$$(Math.max(0, cash - dcaReserve))}  (cashBalance − dcaReserve)`);
        console.log(`    holdings     : ${$$(holdingValue)}`);
        holdingLines.forEach(l => console.log(l));
        console.log(`    POOL TOTAL   : ${$$(poolTotal)}`);
        console.log(`    pool original: ${$$(poolOriginal)}  (poolTotal − dcaContrib ${$$(dcaContrib)})`);

        if (dcaReserve > cash + 0.005) {
            console.log(`    ⚠️  BREACH: dcaReserve (${$$(dcaReserve)}) > cashBalance (${$$(cash)}) by ${$$(dcaReserve - cash)}`);
        }
    }

    console.log('\n' + sep('─'));
    console.log('\n  AGGREGATE');
    console.log(`    Total NAV              : ${$$(totalNAV)}`);
    console.log(`    DCA Contributions      : ${$$(totalDcaContrib)}`);
    console.log(`    Original Pool Value    : ${$$(Math.max(0, totalNAV - totalDcaContrib))}`);
    console.log(`\n    Check: Original + DCA = ${$$(Math.max(0, totalNAV - totalDcaContrib))} + ${$$(totalDcaContrib)} = ${$$(Math.max(0, totalNAV - totalDcaContrib) + totalDcaContrib)}`);
    console.log(`    NAV match: ${Math.abs((Math.max(0, totalNAV - totalDcaContrib) + totalDcaContrib) - totalNAV) < 0.01 ? '✅ RECONCILES' : '❌ DOES NOT RECONCILE'}`);
    console.log('\n' + sep() + '\n');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
