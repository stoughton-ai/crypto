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
    console.log('=== EMERGENCY REVOLUT RECONCILIATION - PART 2 (BUY REPLACEMENTS) ===\n');

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

    console.log('--- Step 1: Getting Live Prices ---');
    // We'll get prices from arena_prices/latest or just hardcode sensible defaults for sizing
    const prices: Record<string, number> = {
        'BNB': 600,
        'SOL': 140,
        'AVAX': 40,
        'XRP': 2.5,
    };

    try {
        const snap = await db.collection('arena_prices').doc('latest').get();
        const dbPrices = snap.data()?.prices || {};
        for (const t of ['BNB', 'SOL', 'AVAX', 'XRP']) {
            if (dbPrices[t]?.price) {
                prices[t] = dbPrices[t].price;
                console.log(`  Found DB price for ${t}: $${prices[t]}`);
            } else {
                console.log(`  Using default price for ${t}: $${prices[t]}`);
            }
        }
    } catch (e) {
        console.warn('  Could not fetch prices from DB, using defaults.');
    }

    console.log('\n--- Step 2: Checking Holdings ---');
    const holdings = await client.getHoldings();
    const currentSymbols = new Set(holdings.map(h => h.symbol.toUpperCase()));

    const needed = ['BNB', 'SOL', 'AVAX', 'XRP'].filter(r => !currentSymbols.has(r));

    if (needed.length === 0) {
        console.log('✅ All replacement tokens (XRP, BNB, SOL, AVAX) are present.');
        process.exit(0);
    }

    console.log(`🔄 Executing BUYs for: ${needed.join(', ')}`);
    for (const ticker of needed) {
        const price = prices[ticker];
        const usdAmount = 75; // Aim for $75 each
        const size = (usdAmount / price).toFixed(6);

        console.log(`  Buying $${usdAmount} of ${ticker} (Size: ${size} @ ~$${price})...`);
        try {
            const res = await client.createOrder({
                symbol: `${ticker}-USD`,
                side: 'BUY',
                size: size,
                type: 'market'
            });
            console.log(`  ✅ BOUGHT ${ticker}. Order ID: ${res.id || 'N/A'}`);
        } catch (e: any) {
            console.error(`  ❌ Failed to buy ${ticker}: ${e.message}`);
        }
    }

    console.log('\n=== Part 2 Complete ===');
}

fixRevolut().catch(console.error);
