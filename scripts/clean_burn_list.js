// Clean burn list: remove tokens that ARE in our verified AGENT_WATCHLIST
// These were incorrectly burned and need to be available for watchlist slots.
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const db = admin.firestore();

const AGENT_WATCHLIST = [
    'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'TRX', 'DOGE', 'ADA', 'BCH', 'LINK',
    'XLM', 'LTC', 'HBAR', 'AVAX', 'SHIB', 'CRO', 'DOT',
    'AAVE', 'NEAR', 'ETC', 'ONDO', 'ICP', 'WLD', 'ATOM', 'QNT', 'ENA',
    'FLR', 'ALGO', 'FIL', 'RENDER', 'XDC', 'VET',
    'BONK', 'SEI', 'VIRTUAL', 'DASH', 'XTZ', 'FET', 'CRV', 'IP', 'CHZ',
    'INJ', 'PYTH', 'TIA', 'JASMY', 'FLOKI', 'LDO', 'SYRUP', 'HNT', 'OP',
    'ENS', 'AXS', 'SAND', 'WIF', 'MANA', 'BAT',
    'CVX', 'GALA', 'RAY', 'GLM', 'TRAC', 'EGLD', 'BERA', '1INCH', 'SNX',
    'JTO', 'KTA', 'AMP', 'LPT', 'EIGEN', 'APE', 'W', 'YFI', 'ROSE',
    'RSR', 'ZRX', 'KSM', 'AKT',
];
const masterSet = new Set(AGENT_WATCHLIST.map(t => t.toUpperCase()));

async function run() {
    const snap = await db.collection('agent_configs').limit(1).get();
    if (snap.empty) { console.error('No config found'); process.exit(1); }

    const data = snap.docs[0].data();
    const excluded = data.excludedTokens || [];

    const wronglyBurned = excluded.filter(t => masterSet.has(t.toUpperCase()));
    const legitimatelyBurned = excluded.filter(t => !masterSet.has(t.toUpperCase()));

    console.log('Wrongly burned (in AGENT_WATCHLIST):', wronglyBurned.join(', ') || 'None');
    console.log('Legitimately burned (not in AGENT_WATCHLIST):', legitimatelyBurned.join(', ') || 'None');
    console.log('');
    console.log(`Keeping ${legitimatelyBurned.length} burns, removing ${wronglyBurned.length}`);

    await snap.docs[0].ref.update({ excludedTokens: legitimatelyBurned });
    console.log(`\n✅ Burn list cleaned — ${wronglyBurned.length} tokens restored to availability`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
