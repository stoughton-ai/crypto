import * as admin from 'firebase-admin';
require('dotenv').config({ path: '.env.local' });
import { RevolutX } from '../src/lib/revolut';

// Target User
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

// Setup Firebase
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function fixRevolut() {
    console.log('=== EMERGENCY REVOLUT RECONCILIATION ===\n');

    // 1. Get Config & Keys
    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data();
    if (!config?.revolutApiKey || !config?.revolutPrivateKey) {
        throw new Error('Missing Revolut API keys in agent_configs');
    }

    const client = new RevolutX(
        config.revolutApiKey,
        config.revolutPrivateKey,
        config.revolutIsSandbox || false,
        config.revolutProxyUrl
    );

    console.log('--- Step 1: Fetching Current Holdings ---');
    const holdings = await client.getHoldings();
    console.log('Current Revolut Holdings:', JSON.stringify(holdings, null, 2));

    const illegalTokens = ['RENDER', 'ICP', 'SHIB', 'FLOKI'];
    const toSell = holdings.filter(h => illegalTokens.includes(h.symbol.toUpperCase()));

    if (toSell.length === 0) {
        console.log('✅ No illegal tokens (RENDER, ICP, SHIB, FLOKI) found in holdings.');
    } else {
        console.log(`🚨 Found ${toSell.length} illegal token(s). Executing SELLS...`);
        for (const h of toSell) {
            console.log(`  Selling ${h.available} ${h.symbol}...`);
            try {
                const res = await client.createOrder({
                    symbol: `${h.symbol}-USD`,
                    side: 'SELL',
                    size: h.available.toString(),
                    type: 'market'
                });
                console.log(`  ✅ SOLD ${h.symbol}. Order ID: ${res.id}`);
            } catch (e: any) {
                console.error(`  ❌ Failed to sell ${h.symbol}: ${e.message}`);
            }
        }
    }

    console.log('\n--- Step 2: Executing Swaps (Buys) ---');
    // We want to replace with: XRP, BNB, SOL, AVAX
    // Based on user allocation, we'll aim for ~$75 per token (roughly $150 per pool)
    const replacements = ['XRP', 'BNB', 'SOL', 'AVAX'];

    // Check if we already have them
    const currentSymbols = holdings.map(h => h.symbol.toUpperCase());
    const needed = replacements.filter(r => !currentSymbols.includes(r));

    if (needed.length === 0) {
        console.log('✅ Replacement tokens (XRP, BNB, SOL, AVAX) already present.');
    } else {
        console.log(`🔄 Executing BUYs for needed replacements: ${needed.join(', ')}`);
        // We'll use a fixed $75 market buy for each
        for (const ticker of needed) {
            console.log(`  Buying ~$75 of ${ticker}...`);
            // Note: Revolut X market buy requires size in BASE currency (e.g. amount of XRP).
            // So we need a price estimate.
            try {
                // For simplicity in an emergency script, we use a large enough size 
                // but usually market buys on Revolut X can be done by "size" (base amt).
                // Let's get a price first to estimate size.
                const priceSnap = await db.collection('arena_prices').doc('latest').get();
                const prices = priceSnap.data()?.prices || {};
                const price = prices[ticker]?.price || 1; // fallback to 1 if missing

                const size = (75 / price).toFixed(6);
                console.log(`  Estimated size for $75 ${ticker}: ${size} (Price: ~$${price})`);

                const res = await client.createOrder({
                    symbol: `${ticker}-USD`,
                    side: 'BUY',
                    size: size,
                    type: 'market'
                });
                console.log(`  ✅ BOUGHT ${ticker}. Order ID: ${res.id}`);
            } catch (e: any) {
                console.error(`  ❌ Failed to buy ${ticker}: ${e.message}`);
            }
        }
    }

    console.log('\n=== Reconciliation Complete ===');
}

fixRevolut().catch(console.error);
