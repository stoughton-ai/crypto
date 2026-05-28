/**
 * sync_reset_from_revolut.ts
 * ─────────────────────────────────────────────────────────────────────────
 * One-shot Revolut X sync & full reset for the Semaphore crypto arena.
 *
 * What it does:
 *   1. Reads live USD cash balance from Revolut X
 *   2. Reads live crypto holdings from Revolut X
 *   3. Fetches current prices from CoinGecko (same source as dashboard)
 *   4. Updates each pool's cash balance (proportional to current share)
 *   5. Updates each pool's holdings to match Revolut exactly
 *   6. Sets current price as the new cost basis → all deltas reset to 0%
 *   7. Resets performance metrics (pnl, winCount, lossCount, snapshots)
 *   8. Clears arena_snapshots subcollection → fresh performance chart
 *   9. Writes a day-0 snapshot for today
 *
 * Does NOT place any trades on Revolut X.
 *
 * Run:  npx tsx scripts/sync_reset_from_revolut.ts
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';
import crypto from 'crypto';
import { ProxyAgent } from 'undici';

// ── Firebase init ──────────────────────────────────────────────────────────
if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON env var');
    const sa = JSON.parse(saStr);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
const ASSET_CLASS = 'CRYPTO';
const ARENA_COLLECTION = 'arena_config';
const SNAPSHOTS_COLLECTION = 'arena_snapshots';

// ── Revolut X API helper ────────────────────────────────────────────────────
async function revolutRequest(path: string, apiKey: string, privateKeyPem: string, proxyUrl?: string) {
    const timestamp = Date.now();
    const message = `${timestamp}GET${path}`;
    let formattedKey = privateKeyPem.trim();
    if (!formattedKey.includes('-----BEGIN PRIVATE KEY-----')) {
        formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
    }
    const sig = crypto.sign(undefined, Buffer.from(message), crypto.createPrivateKey(formattedKey));
    const headers: any = {
        'X-Revx-API-Key': apiKey,
        'X-Revx-Timestamp': timestamp.toString(),
        'X-Revx-Signature': sig.toString('base64'),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
    const options: any = { method: 'GET', headers };
    if (proxyUrl) {
        options.dispatcher = new ProxyAgent({ uri: proxyUrl, headersTimeout: 30000, bodyTimeout: 30000, connectTimeout: 30000 });
    }
    const res = await fetch(`https://revx.revolut.com${path}`, options);
    if (!res.ok) throw new Error(`Revolut API ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── CoinGecko price fetch (same as dashboard) ───────────────────────────────
const COINGECKO_IDS: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
    XRP: 'ripple', DOT: 'polkadot', AVAX: 'avalanche-2', LINK: 'chainlink',
    DOGE: 'dogecoin', SHIB: 'shiba-inu', LTC: 'litecoin', NEAR: 'near',
    HBAR: 'hedera-hashgraph', TRX: 'tron', BCH: 'bitcoin-cash',
    XLM: 'stellar', CRO: 'crypto-com-chain', BNB: 'binancecoin',
    AAVE: 'aave', ETC: 'ethereum-classic', ONDO: 'ondo-finance',
    WLD: 'worldcoin-wld', QNT: 'quant-network', ENA: 'ethena',
    FLR: 'flare-networks', ATOM: 'cosmos', ALGO: 'algorand',
    RENDER: 'render-token', ICP: 'internet-computer', FIL: 'filecoin',
    VET: 'vechain', XDC: 'xdce-crowd-sale', BONK: 'bonk',
    SEI: 'sei-network', VIRTUAL: 'virtual-protocol', FET: 'fetch-ai',
    INJ: 'injective-protocol', OP: 'optimism', ARB: 'arbitrum',
    PYTH: 'pyth-network', WIF: 'dogwifcoin',
};

async function getLivePrices(tickers: string[]): Promise<Record<string, number>> {
    const ids = tickers.map(t => COINGECKO_IDS[t.toUpperCase()]).filter(Boolean);
    if (ids.length === 0) return {};
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json() as Record<string, { usd: number }>;
    const out: Record<string, number> = {};
    for (const ticker of tickers) {
        const id = COINGECKO_IDS[ticker.toUpperCase()];
        if (id && data[id]?.usd) out[ticker.toUpperCase()] = data[id].usd;
    }
    return out;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n════════════════════════════════════════════════════');
    console.log('   REVOLUT X SYNC & FULL RESET — Semaphore Crypto');
    console.log('════════════════════════════════════════════════════\n');

    // 1. Load agent config (Revolut API key + proxy URL)
    const configSnap = await db.collection('agent_configs').doc(USER_ID).get();
    const agentConfig = configSnap.data();
    if (!agentConfig?.revolutApiKey || !agentConfig?.revolutPrivateKey) {
        throw new Error('Revolut API credentials not found in agent_configs');
    }
    console.log('✅ Revolut credentials loaded');

    // 2. Fetch live Revolut X balances
    console.log('📡 Fetching Revolut X balances...');
    const rawBalances = await revolutRequest(
        '/api/1.0/balances',
        agentConfig.revolutApiKey,
        agentConfig.revolutPrivateKey,
        agentConfig.revolutProxyUrl,
    ) as any[];
    console.log(`   Raw balances: ${JSON.stringify(rawBalances)}`);

    const usdEntry = rawBalances.find((b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'USD');
    const revolutUsd = parseFloat((usdEntry?.available ?? usdEntry?.balance ?? 0).toString());
    console.log(`   USD cash: $${revolutUsd.toFixed(2)}`);

    const revolutHoldings: Record<string, number> = {};
    for (const b of rawBalances) {
        const sym = (b.currency ?? b.symbol ?? '').toUpperCase();
        if (!sym || sym === 'USD') continue;
        const amt = parseFloat((b.available ?? b.balance ?? 0).toString());
        if (amt > 0) {
            revolutHoldings[sym] = amt;
            console.log(`   ${sym}: ${amt}`);
        }
    }
    console.log(`   Total crypto positions: ${Object.keys(revolutHoldings).length}`);

    // 3. Load arena config from Firestore
    const arenaSnap = await db.collection(ARENA_COLLECTION).doc(USER_ID).get();
    if (!arenaSnap.exists) throw new Error('Arena config not found in Firestore');
    const arena = arenaSnap.data() as any;
    if (!arena.initialized) throw new Error('Arena not initialised');
    console.log(`\n✅ Arena loaded — ${arena.pools.length} pools`);

    // 4. Fetch live prices for all pool tokens
    const allTickers: string[] = [];
    for (const pool of arena.pools) {
        for (const t of (pool.tokens || [])) allTickers.push(t.toUpperCase());
    }
    console.log(`\n📊 Fetching live prices for: ${allTickers.join(', ')}`);
    const prices = await getLivePrices(allTickers);
    console.log('   Prices:', Object.entries(prices).map(([t, p]) => `${t}=$${p}`).join(', '));

    // 5. Reconcile pools
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const currentTotalCash = arena.pools.reduce((s: number, p: any) => s + (p.cashBalance || 0), 0);
    const distributeEqual = currentTotalCash < 0.01;

    console.log(`\n🔄 Reconciling pools...`);
    console.log(`   Current arena cash total: $${currentTotalCash.toFixed(2)}`);
    console.log(`   Revolut USD to distribute: $${revolutUsd.toFixed(2)}`);

    for (const pool of arena.pools) {
        const oldCash = pool.cashBalance || 0;
        const oldHoldings = { ...pool.holdings };

        // ── Cash ──────────────────────────────────────────────────────
        if (distributeEqual) {
            pool.cashBalance = revolutUsd / arena.pools.length;
        } else {
            const ratio = oldCash / currentTotalCash;
            pool.cashBalance = Math.max(0, revolutUsd * ratio);
        }

        // ── Holdings ─────────────────────────────────────────────────
        const updatedHoldings: Record<string, any> = {};
        for (const ticker of (pool.tokens || [])) {
            const upper = ticker.toUpperCase();
            const revolutAmt = revolutHoldings[upper] ?? 0;
            if (revolutAmt <= 0) continue; // not held — clear it
            const livePrice = prices[upper] ?? pool.holdings?.[upper]?.averagePrice ?? 0;
            updatedHoldings[upper] = {
                amount: revolutAmt,
                averagePrice: livePrice,  // new cost basis → delta = 0%
                peakPrice: livePrice,
                peakPnlPct: 0,
                boughtAt: now,
            };
        }
        pool.holdings = updatedHoldings;

        // ── Pool value ─────────────────────────────────────────────────
        let holdVal = 0;
        for (const [tkr, h] of Object.entries(updatedHoldings) as [string, any][]) {
            holdVal += h.amount * (prices[tkr] ?? h.averagePrice ?? 0);
        }
        const poolValue = pool.cashBalance + holdVal;

        // ── Performance reset ─────────────────────────────────────────
        pool.budget = poolValue; // new cost basis = current total value
        pool.performance = {
            ...pool.performance,
            totalPnl: 0,
            totalPnlPct: 0,
            winCount: 0,
            lossCount: 0,
            bestTrade: null,
            worstTrade: null,
            dailySnapshots: [{ date: today, value: poolValue, pnlPct: 0 }],
        };

        console.log(`\n   ${pool.emoji} ${pool.name}:`);
        console.log(`      Cash:     $${oldCash.toFixed(2)} → $${pool.cashBalance.toFixed(2)}`);
        console.log(`      Holdings: ${JSON.stringify(Object.keys(oldHoldings))} → ${JSON.stringify(Object.keys(updatedHoldings))}`);
        for (const [tkr, h] of Object.entries(updatedHoldings) as [string, any][]) {
            console.log(`        ${tkr}: ${h.amount.toFixed(6)} @ $${h.averagePrice.toFixed(4)} (new basis)`);
        }
        console.log(`      New pool value: $${poolValue.toFixed(2)}`);
    }

    // 6. Write updated arena config back to Firestore
    console.log('\n💾 Writing updated arena config to Firestore...');
    await db.collection(ARENA_COLLECTION).doc(USER_ID).set(arena);
    console.log('   ✅ Arena config updated');

    // 7. Clear arena_snapshots sub-collections and write fresh day-0 snapshot
    console.log('🗑️  Clearing performance chart snapshots...');
    for (const pool of arena.pools) {
        const colRef = db.collection(SNAPSHOTS_COLLECTION).doc(USER_ID).collection(pool.poolId);
        const snap = await colRef.limit(200).get();
        if (snap.size > 0) {
            const batch = db.batch();
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            console.log(`   Deleted ${snap.size} snapshots for ${pool.name}`);
        }
        // Write fresh day-0 snapshot
        let holdVal = 0;
        for (const [tkr, h] of Object.entries(pool.holdings) as [string, any][]) {
            holdVal += h.amount * (prices[tkr] ?? h.averagePrice ?? 0);
        }
        const poolValue = pool.cashBalance + holdVal;
        await colRef.doc(today).set({ date: today, value: poolValue, pnlPct: 0, recordedAt: now }, { merge: true });
        console.log(`   ✅ Fresh snapshot written for ${pool.name}: $${poolValue.toFixed(2)}`);
    }

    // 8. Summary
    const totalNAV = arena.pools.reduce((s: number, p: any) => {
        let hv = 0;
        for (const [tkr, h] of Object.entries(p.holdings) as [string, any][]) {
            hv += h.amount * (prices[tkr] ?? h.averagePrice ?? 0);
        }
        return s + p.cashBalance + hv;
    }, 0);

    console.log('\n════════════════════════════════════════════════════');
    console.log('✅ SYNC & RESET COMPLETE');
    console.log(`   Total NAV after reset: $${totalNAV.toFixed(2)}`);
    console.log(`   USD cash (from Revolut): $${revolutUsd.toFixed(2)}`);
    console.log(`   Crypto positions synced: ${Object.keys(revolutHoldings).join(', ') || 'none'}`);
    console.log(`   All P&L deltas: reset to 0%`);
    console.log(`   Performance chart: cleared (fresh start from ${today})`);
    console.log('════════════════════════════════════════════════════\n');
}

main().catch(e => {
    console.error('\n❌ FAILED:', e.message);
    process.exit(1);
});
