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

    if (!config?.revolutApiKey || !config?.revolutPrivateKey) {
        console.error('Revolut API keys not found in config.');
        process.exit(1);
    }

    // 2. Create Revolut client (bypass automationEnabled check — this is manual override)
    const revolut = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);
    console.log('✅ Revolut client created\n');

    // 3. Check Revolut for actual XDC holdings
    console.log('Fetching real-time positions from Revolut...');
    const holdings = await revolut.getHoldings();
    console.log(`Found ${holdings.length} position(s):`);
    holdings.forEach(h => console.log(`  - ${h.symbol}: ${h.amount} (available: ${h.available})`));

    const xdc = holdings.find(h => h.symbol.startsWith('XDC'));
    if (!xdc || xdc.available <= 0) {
        console.log('\n⚠️ No XDC found on Revolut. Checking virtual portfolio...');
    } else {
        const sellAmt = Math.floor(xdc.available * 1e8) / 1e8;
        console.log(`\n💸 Selling ${sellAmt} XDC on Revolut...`);
        try {
            const result = await revolut.createOrder({
                symbol: 'XDC-USD',
                side: 'SELL',
                size: sellAmt.toFixed(8),
                type: 'market'
            });
            console.log(`✅ Revolut SELL order placed. Order ID: ${result.id || 'N/A'}`);
        } catch (e: any) {
            console.error(`❌ Revolut SELL failed: ${e.message}`);
        }
    }

    // 4. Also clear XDC from virtual portfolio if present
    const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
    const vpData = vpDoc.data() as any;
    const vpHoldings = vpData?.holdings || {};

    if (vpHoldings['XDC']) {
        const h = vpHoldings['XDC'];
        const estValue = h.amount * h.averagePrice;
        console.log(`\n📊 Virtual portfolio has XDC: ${h.amount} @ $${h.averagePrice.toFixed(4)} (≈$${estValue.toFixed(2)})`);

        delete vpHoldings['XDC'];
        const newCash = (vpData?.cashBalance || 0) + estValue;
        await db.collection('virtual_portfolio').doc(userId).update({
            holdings: vpHoldings,
            cashBalance: newCash,
            totalValue: newCash + Object.values(vpHoldings).reduce((sum: number, hh: any) => sum + (hh.amount * hh.averagePrice), 0),
            lastUpdated: new Date().toISOString(),
        });
        console.log(`✅ XDC removed from virtual portfolio. Cash: $${newCash.toFixed(2)}`);

        // Record the sell trade
        await db.collection('virtual_trades').add({
            userId,
            ticker: 'XDC',
            type: 'SELL',
            amount: h.amount,
            price: h.averagePrice,
            total: estValue,
            reason: 'Manual liquidation — rogue auto-resume trade',
            pnl: 0,
            pnlPercent: 0,
            date: new Date().toISOString(),
        });
        console.log('✅ Sell trade recorded in trade history');
    } else {
        console.log('\n📊 XDC not found in virtual portfolio (may have been a pool trade only).');
    }

    // 5. Check discovery pool holdings too
    const poolSnaps = await db.collection('discovery_pools').where('userId', '==', userId).get();
    for (const pDoc of poolSnaps.docs) {
        const pool = pDoc.data();
        if (pool.holdings?.['XDC']) {
            console.log(`\n🧪 Found XDC in pool ${pool.poolId}. Clearing...`);
            const poolH = pool.holdings['XDC'];
            const val = poolH.amount * poolH.averagePrice;
            delete pool.holdings['XDC'];
            await pDoc.ref.update({
                holdings: pool.holdings,
                cashBalance: pool.cashBalance + val,
            });
            console.log(`✅ XDC cleared from pool ${pool.poolId}. Pool cash: $${(pool.cashBalance + val).toFixed(2)}`);
        }
    }

    console.log('\n=== DONE ===');
    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
