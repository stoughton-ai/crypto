// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';
import { RevolutX } from '../src/lib/revolut';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

(async () => {
    // 1. Get config for Revolut credentials
    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data() as any;

    // 2. Get current holdings
    const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
    const vpData = vpDoc.data() as any;
    const holdings = vpData?.holdings || {};
    const tickers = Object.keys(holdings);

    if (tickers.length === 0) {
        console.log('No holdings to liquidate.');
        process.exit(0);
    }

    console.log(`\n=== LIQUIDATING ${tickers.length} POSITIONS ===\n`);

    // 3. Create Revolut client
    let revolutClient: RevolutX | null = null;
    if (config?.automationEnabled && config?.realTradingEnabled !== false && config?.revolutApiKey && config?.revolutPrivateKey) {
        revolutClient = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);
        console.log('✅ Revolut client created (LIVE trades will be placed)\n');
    } else {
        console.log('⚠️  Revolut not configured — virtual-only liquidation\n');
    }

    let totalValue = 0;
    const trades: any[] = [];

    for (const ticker of tickers) {
        const h = holdings[ticker];
        const amount = h.amount;
        const avgPrice = h.averagePrice;
        const estValue = amount * avgPrice;
        totalValue += estValue;

        console.log(`SELL ${ticker}: ${amount.toFixed(8)} @ ~$${avgPrice.toFixed(4)} = ~$${estValue.toFixed(2)}`);

        // Sell on Revolut
        if (revolutClient) {
            try {
                const sizeStr = amount.toFixed(8).replace(/\.?0+$/, '');
                await revolutClient.createOrder({
                    symbol: `${ticker}-USD`,
                    side: 'SELL',
                    size: sizeStr || '0',
                    type: 'market'
                });
                console.log(`  ✅ Revolut SELL order placed`);
            } catch (e: any) {
                console.error(`  ❌ Revolut SELL failed: ${e.message}`);
            }
        }

        // Record trade
        trades.push({
            userId,
            ticker,
            type: 'SELL',
            amount,
            price: avgPrice,
            total: estValue,
            reason: 'Manual Portfolio Reset — Strategy Overhaul',
            pnl: 0,
            pnlPercent: 0,
            date: new Date().toISOString(),
        });
    }

    // 4. Update virtual portfolio — clear all holdings, add value back to cash
    const newCash = (vpData?.cashBalance || 0) + totalValue;
    await db.collection('virtual_portfolio').doc(userId).update({
        holdings: {},
        cashBalance: newCash,
        totalValue: newCash,
    });
    console.log(`\n✅ Virtual portfolio cleared. Cash balance: $${newCash.toFixed(2)}`);

    // 5. Record trades
    const batch = db.batch();
    for (const t of trades) {
        const ref = db.collection('virtual_trades').doc();
        batch.set(ref, t);
    }
    await batch.commit();
    console.log(`✅ ${trades.length} sell trades recorded`);

    // 6. Clear ALL cooldowns — lastSold, lastSellScore, lastSellReason, lastTrade
    const cooldownResets: Record<string, any> = {
        lastSold: {},
        lastSellScore: {},
        lastSellReason: {},
        lastTrade: {},
    };
    await db.collection('agent_configs').doc(userId).update(cooldownResets);
    console.log(`✅ All cooldowns cleared (lastSold, lastSellScore, lastSellReason, lastTrade)`);

    // 7. Summary
    console.log(`\n=== DONE ===`);
    console.log(`Sold ${tickers.length} positions for ~$${totalValue.toFixed(2)}`);
    console.log(`New cash balance: $${newCash.toFixed(2)}`);
    console.log(`All tokens are now immediately available for purchase`);

    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
