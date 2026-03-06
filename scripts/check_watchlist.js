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

const STABLECOINS = new Set([
    'USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'TUSD', 'USDP', 'EUR', 'GBP',
    'WBTC', 'WETH', 'WSTETH', 'SAVAX', 'METH', 'STETH', 'USDD', 'USDE',
    'USDG', 'USDS', 'LUSD', 'FRAX', 'GHO', 'USD0', 'A7A5', 'RLUSD',
    'USDAI', 'USDTB', 'BFUSD', 'JTRSY', 'USDF', 'USTB', 'OUSG', 'JAAA',
    'STABLE', 'BUSD', 'EUT', 'EUTBL', 'XAUT', 'PAXG'
]);

(async () => {
    const snap = await db.collection('agent_configs').limit(1).get();
    const userId = snap.docs[0].id;
    const d = snap.docs[0].data();

    const excluded = new Set((d.excludedTokens || []).map(t => t.toUpperCase()));
    const tracked = new Set([
        ...(d.trafficLightTokens || []),
        ...(d.standardTokens || []),
        ...(d.sandboxTokens || []),
        ...(d.aiWatchlist || []),
    ].map(t => t.toUpperCase()));

    // Holdings
    const vpSnap = await db.collection('virtual_portfolio').doc(userId).get();
    if (vpSnap.exists) {
        Object.keys(vpSnap.data().holdings || {}).forEach(t => {
            if ((vpSnap.data().holdings[t]?.amount || 0) > 0) excluded.add(t.toUpperCase());
        });
    }

    // Pool candidates
    const pool = AGENT_WATCHLIST.map(t => t.toUpperCase()).filter(t => !excluded.has(t) && !tracked.has(t));
    console.log(`Pool candidates: ${pool.length}`);

    // Check each for criteria
    const intelSnaps = await Promise.all(pool.map(t => db.collection('ticker_intel').doc(`${userId}_${t}`).get()));
    const minMcapUSD = (d.minMarketCap || 100) * 1_000_000;

    let passCount = 0;
    let failReasons = {};

    pool.forEach((t, i) => {
        const snap = intelSnaps[i];
        const intel = snap.exists ? snap.data() : null;

        // Stablecoin check
        if (STABLECOINS.has(t) || t.includes('USD') || t.includes('EUR') || t.includes('GBP')) {
            failReasons[t] = 'STABLECOIN';
            return;
        }

        // Score check
        if (intel && intel.overallScore > 0 && intel.overallScore < 30) {
            failReasons[t] = `SCORE_TOO_LOW (${intel.overallScore})`;
            return;
        }

        // Mcap check
        if (minMcapUSD > 0 && intel?.marketCap > 0 && intel.marketCap < minMcapUSD) {
            failReasons[t] = `MCAP_TOO_LOW ($${(intel.marketCap / 1e6).toFixed(0)}M < $${minMcapUSD / 1e6}M)`;
            return;
        }

        passCount++;
        console.log(`  ✓ ${t}: score=${intel?.overallScore || 'N/A'}, mcap=$${((intel?.marketCap || 0) / 1e9).toFixed(2)}B`);
    });

    console.log(`\nPassed criteria: ${passCount}/${pool.length}`);
    console.log('Failed:');
    Object.entries(failReasons).forEach(([t, r]) => console.log(`  ✗ ${t}: ${r}`));

    // How many slots to fill?
    const CAPS = { traffic: 6, standard: 10, sandbox: 10, ai: 10 };
    const trafficNeed = CAPS.traffic - (d.trafficLightTokens || []).length;
    const standardNeed = CAPS.standard - (d.standardTokens || []).length;
    const sandboxNeed = CAPS.sandbox - (d.sandboxTokens || []).length;
    const aiNeed = CAPS.ai - (d.aiWatchlist || []).length;

    console.log(`\nSlots needed: Traffic=${trafficNeed}, Standard=${standardNeed}, Sandbox=${sandboxNeed}, AI=${aiNeed}`);
    console.log(`Total needed: ${trafficNeed + standardNeed + sandboxNeed + aiNeed}`);
    console.log(`Available passing candidates: ${passCount}`);

    process.exit(0);
})();
