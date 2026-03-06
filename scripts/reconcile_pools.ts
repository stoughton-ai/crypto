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
    console.log('=== Checking Revolut vs Pool State ===\n');

    // 1. Get Revolut actual holdings
    const config = await db.collection('agent_configs').doc(userId).get();
    const cfg = config.data()!;
    const rev = new RevolutX(cfg.revolutApiKey, cfg.revolutPrivateKey, cfg.revolutIsSandbox, cfg.revolutProxyUrl);
    const holdings = await rev.getHoldings();
    const cryptoAccounts = holdings.filter((a: any) => parseFloat(a.quantity || '0') > 0);

    console.log('Revolut holdings:');
    for (const a of cryptoAccounts) {
        console.log(`  ${a.ticker}: ${a.quantity}`);
    }
    const revHeld = new Set(cryptoAccounts.map((a: any) => (a.ticker || '').replace('-USD', '').toUpperCase()));

    // 2. Get pool docs
    const poolSnap = await db.collection('discovery_pools').where('userId', '==', userId).get();
    console.log(`\nPool docs (${poolSnap.size}):`);
    for (const doc of poolSnap.docs) {
        const p = doc.data();
        console.log(`  ${p.poolId}: ${p.emoji} ${p.name} | cash: $${p.cashBalance?.toFixed(2)}`);
        console.log(`    holdings: ${Object.keys(p.holdings || {}).join(', ')}`);
        for (const [ticker, h] of Object.entries(p.holdings || {} as any)) {
            const held = revHeld.has(ticker.toUpperCase());
            const hData = h as any;
            const value = hData.amount * hData.averagePrice;
            console.log(`      ${ticker}: ${hData.amount.toFixed(6)} @ $${hData.averagePrice.toFixed(4)} = $${value.toFixed(2)} | On Revolut: ${held ? '✅' : '❌ SOLD'}`);
        }
    }

    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
