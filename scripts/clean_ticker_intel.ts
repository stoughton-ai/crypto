import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

// Combined Revolut + EODHD available tokens — the AGENT_WATCHLIST from constants.ts
const VALID_TICKERS = new Set([
    // Tier 1 — Large Cap
    'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'TRX', 'DOGE', 'ADA', 'BCH', 'LINK',
    'XLM', 'LTC', 'HBAR', 'AVAX', 'SHIB', 'CRO', 'DOT',
    // Tier 2 — Mid Cap
    'AAVE', 'NEAR', 'ETC', 'ONDO', 'ICP', 'WLD', 'ATOM', 'QNT', 'ENA',
    'FLR', 'ALGO', 'FIL', 'RENDER', 'XDC', 'VET',
    // Tier 3 — Small-Mid Cap
    'BONK', 'SEI', 'VIRTUAL', 'DASH', 'XTZ', 'FET', 'CRV', 'IP', 'CHZ',
    'INJ', 'PYTH', 'TIA', 'JASMY', 'FLOKI', 'LDO', 'SYRUP', 'HNT', 'OP',
    'ENS', 'AXS', 'SAND', 'WIF', 'MANA', 'BAT',
    // Tier 4 — Small Cap
    'CVX', 'GALA', 'RAY', 'GLM', 'TRAC', 'EGLD', 'BERA', '1INCH', 'SNX',
    'JTO', 'KTA', 'AMP', 'LPT', 'EIGEN', 'APE', 'W', 'YFI', 'ROSE',
    'RSR', 'ZRX', 'KSM', 'AKT',
]);

async function main() {
    console.log(`Valid tokens in watchlist: ${VALID_TICKERS.size}`);

    // Fetch ALL ticker_intel documents
    const allDocs = await db.collection('ticker_intel').get();
    console.log(`Total ticker_intel documents: ${allDocs.size}`);

    const toDelete: { id: string; ticker: string }[] = [];
    const toKeep: string[] = [];

    for (const doc of allDocs.docs) {
        const data = doc.data();
        // Doc IDs are formatted as {userId}_{TICKER}
        const ticker = (data.ticker || doc.id.split('_').pop() || '').toUpperCase();

        if (VALID_TICKERS.has(ticker)) {
            toKeep.push(ticker);
        } else {
            toDelete.push({ id: doc.id, ticker });
        }
    }

    console.log(`\nKeeping: ${toKeep.length} documents (valid tokens)`);
    console.log(`Deleting: ${toDelete.length} documents (not in Revolut/EODHD list)\n`);

    if (toDelete.length === 0) {
        console.log('✅ Library is already clean. No orphaned tokens found.');
        process.exit(0);
    }

    // Show what we're deleting
    const deletedTickers = [...new Set(toDelete.map(d => d.ticker))].sort();
    console.log(`Tokens being removed: ${deletedTickers.join(', ')}`);
    console.log('');

    // Delete in batches of 500 (Firestore limit)
    const BATCH_SIZE = 450;
    let deleted = 0;

    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = toDelete.slice(i, i + BATCH_SIZE);

        for (const { id } of chunk) {
            batch.delete(db.collection('ticker_intel').doc(id));
        }

        await batch.commit();
        deleted += chunk.length;
        console.log(`  Deleted batch: ${deleted}/${toDelete.length}`);
    }

    console.log(`\n✅ Done. Removed ${toDelete.length} orphaned documents (${deletedTickers.length} unique tickers).`);
    console.log(`   Remaining: ${toKeep.length} valid documents.`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
