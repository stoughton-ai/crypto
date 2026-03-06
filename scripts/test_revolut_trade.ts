/**
 * REVOLUT TRADE TEST SCRIPT
 * ─────────────────────────
 * Proves the Revolut API integration works end-to-end.
 * Loads Revolut API credentials from Firestore (same as the main agent).
 *
 * Steps:
 *   1. Load credentials from Firestore for the first automation-enabled user
 *   2. Fetch current ETH price from CoinGecko
 *   3. BUY $20 worth of ETH at market price
 *   4. Wait 60 seconds
 *   5. SELL the entire ETH position
 *
 * Usage:
 *   npx tsx scripts/test_revolut_trade.ts
 *   npx tsx scripts/test_revolut_trade.ts --user <userId>
 */

import * as fs from 'fs';
import * as path from 'path';

// Load env vars before any imports
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    if (typeof (process as any).loadEnvFile === 'function') {
        (process as any).loadEnvFile(envPath);
        console.log('✅ Environment loaded from .env.local');
    } else {
        const raw = fs.readFileSync(envPath, 'utf-8');
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
            process.env[key] = val;
        }
        console.log('✅ Environment loaded (manual parser)');
    }
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getEthPrice(): Promise<number> {
    console.log('\n📡 Fetching ETH price from CoinGecko...');
    const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { headers: { 'Accept': 'application/json' } }
    );
    const data = await res.json() as any;
    const price = data?.ethereum?.usd;
    if (!price || price <= 0) throw new Error('Failed to get ETH price from CoinGecko');
    console.log(`   ETH/USD: $${price.toFixed(2)}`);
    return price;
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  🧪 REVOLUT TRADE TEST — BUY $20 ETH → SELL ALL  ');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Time: ${new Date().toLocaleString()}`);

    // ── Load Firebase Admin ───────────────────────────────────────
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) {
        console.error('❌ Firebase Admin SDK not initialized. Check .env.local');
        process.exit(1);
    }

    // ── Find user with Revolut credentials ───────────────────────
    const args = process.argv.slice(2); // skip node and script path
    const userFlagIdx = args.findIndex(a => a === '--user' || a.startsWith('--user='));
    let targetUserId: string | undefined;
    if (userFlagIdx >= 0) {
        if (args[userFlagIdx].includes('=')) {
            targetUserId = args[userFlagIdx].split('=')[1];
        } else {
            targetUserId = args[userFlagIdx + 1];
        }
    }

    let userId: string;
    let apiKey: string;
    let privateKey: string;
    let isSandbox: boolean;

    if (targetUserId) {
        console.log(`\n🔍 Using specified user: ${targetUserId}`);
        const doc = await adminDb.collection('agent_configs').doc(targetUserId).get();
        if (!doc.exists) {
            console.error(`❌ User ${targetUserId} not found in agent_configs`);
            process.exit(1);
        }
        const data = doc.data()!;
        apiKey = data.revolutApiKey;
        privateKey = data.revolutPrivateKey;
        isSandbox = data.revolutIsSandbox || false;
        userId = targetUserId;
    } else {
        console.log('\n🔍 Searching for user with Revolut credentials...');
        const snap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .get();

        let found: any = null;
        for (const doc of snap.docs) {
            const data = doc.data();
            if (data.revolutApiKey && data.revolutPrivateKey) {
                found = { id: doc.id, ...data };
                break;
            }
        }

        if (!found) {
            console.error('❌ No user found with Revolut API credentials in Firestore.');
            console.error('   Make sure you have set your Revolut API key in the Settings modal.');
            process.exit(1);
        }

        userId = found.id;
        apiKey = found.revolutApiKey;
        privateKey = found.revolutPrivateKey;
        isSandbox = found.revolutIsSandbox || false;
    }

    const proxyUrl = process.env.REVOLUT_PROXY_URL;

    console.log(`\n👤 User: ${userId}`);
    console.log(`🔑 API Key: ${apiKey.slice(0, 8)}...`);
    console.log(`🌐 Mode: ${isSandbox ? 'SANDBOX' : 'LIVE'}`);
    if (proxyUrl) console.log(`🔀 Proxy: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);

    // ── Import RevolutX ───────────────────────────────────────────
    const { RevolutX } = await import('../src/lib/revolut');
    const client = new RevolutX(apiKey, privateKey, isSandbox, proxyUrl);

    // ── Step 1: Check current balances ────────────────────────────
    console.log('\n─── STEP 1: Checking Balances ───');
    let balances: any[];
    try {
        balances = await client.getBalances();
        console.log('Raw balances:', JSON.stringify(balances, null, 2));
    } catch (e: any) {
        console.error('❌ Failed to fetch balances:', e.message);
        process.exit(1);
    }

    const usdBalance = balances.find(
        (b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'USD'
    );
    const usdAvailable = parseFloat((usdBalance?.available ?? usdBalance?.balance ?? 0).toString());
    console.log(`💵 USD Available: $${usdAvailable.toFixed(2)}`);

    if (usdAvailable < 20) {
        console.error(`❌ Insufficient USD balance. Need $20, have $${usdAvailable.toFixed(2)}`);
        process.exit(1);
    }

    // ── Step 2: Get ETH price ─────────────────────────────────────
    const ethPrice = await getEthPrice();
    const BUY_USD = 20;
    const ethAmount = BUY_USD / ethPrice;
    const ethAmountStr = ethAmount.toFixed(6);

    console.log(`\n─── STEP 2: Placing BUY Order ───`);
    console.log(`   Buying: ${ethAmountStr} ETH (~$${BUY_USD})`);

    // ── Step 3: BUY ───────────────────────────────────────────────
    let buyOrder: any;
    try {
        buyOrder = await client.createOrder({
            symbol: 'ETH-USD',
            side: 'BUY',
            size: ethAmountStr,
            type: 'market'
        });
        console.log('✅ BUY Order Placed!');
        console.log('   Order details:', JSON.stringify(buyOrder, null, 2));
    } catch (e: any) {
        console.error('❌ BUY Order Failed:', e.message);
        process.exit(1);
    }

    // ── Step 4: Wait 60 seconds ───────────────────────────────────
    console.log('\n─── STEP 3: Waiting 60 seconds before selling... ───');
    for (let i = 60; i > 0; i -= 10) {
        console.log(`   ⏳ ${i}s remaining...`);
        await sleep(10_000);
    }

    // ── Step 5: Check ETH holdings ───────────────────────────────
    console.log('\n─── STEP 4: Checking ETH Holdings ───');
    let holdings: any[];
    try {
        holdings = await client.getHoldings();
        console.log('Holdings:', JSON.stringify(holdings, null, 2));
    } catch (e: any) {
        console.error('❌ Failed to fetch holdings:', e.message);
        process.exit(1);
    }

    const ethHolding = holdings.find((h: any) => h.symbol.toUpperCase() === 'ETH');
    if (!ethHolding || ethHolding.available <= 0) {
        console.error('❌ No ETH holding found to sell. The buy may not have settled yet.');
        console.log('   Try running the sell manually after a few minutes.');
        process.exit(1);
    }

    // Use 8 decimal places to match Revolut's precision, but floor (not round) to avoid exceeding available
    const sellAmount = Math.floor(ethHolding.available * 1e8) / 1e8;
    const sellAmountStr = sellAmount.toFixed(8);
    console.log(`   ETH available: ${ethHolding.available}, selling: ${sellAmountStr}`);

    // ── Step 6: SELL ──────────────────────────────────────────────
    console.log(`\n─── STEP 5: Placing SELL Order ───`);
    console.log(`   Selling: ${sellAmount} ETH`);

    let sellOrder: any;
    try {
        sellOrder = await client.createOrder({
            symbol: 'ETH-USD',
            side: 'SELL',
            size: sellAmountStr,
            type: 'market'
        });
        console.log('✅ SELL Order Placed!');
        console.log('   Order details:', JSON.stringify(sellOrder, null, 2));
    } catch (e: any) {
        console.error('❌ SELL Order Failed:', e.message);
        process.exit(1);
    }

    // ── Final balances ────────────────────────────────────────────
    console.log('\n─── STEP 6: Final Balances ───');
    await sleep(2000);
    const finalBalances = await client.getBalances();
    const finalUsd = (finalBalances as any[]).find(
        (b: any) => (b.currency ?? b.symbol ?? '').toUpperCase() === 'USD'
    );
    const finalUsdAvailable = parseFloat((finalUsd?.available ?? finalUsd?.balance ?? 0).toString());
    console.log(`💵 Final USD Balance: $${finalUsdAvailable.toFixed(2)}`);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ TEST COMPLETE — Revolut trading is WORKING!   ');
    console.log('═══════════════════════════════════════════════════');
}

main().catch(e => {
    console.error('\n💥 Test script crashed:', e);
    process.exit(1);
});
