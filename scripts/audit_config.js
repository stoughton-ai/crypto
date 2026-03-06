require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
    const d = (await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get()).data();
    const fields = ['riskProfile', 'buyScoreThreshold', 'aiScoreExitThreshold', 'maxAllocationPerAsset',
        'minCashReservePct', 'positionStopLoss', 'portfolioStopLoss', 'maxOpenPositions', 'minOrderAmount',
        'buyAmountScore90', 'buyAmountScore80', 'buyAmountDefault', 'scalingChunkSize', 'antiWashHours',
        'reentryPenalty', 'requireMomentumForBuy', 'rotationMinScoreGap', 'minProfitableHoldHours',
        'minMarketCap', 'scalingScoreThreshold', 'automationEnabled'];
    for (const f of fields) {
        const v = d[f];
        console.log(f + ': ' + (v === undefined ? '<NOT SET>' : v));
    }
    // Active strategy
    if (d.activeStrategy) {
        console.log('\nactiveStrategy.strategyId: ' + d.activeStrategy.strategyId);
        console.log('activeStrategy.name: ' + d.activeStrategy.name);
        console.log('activeStrategy.overrides: ' + JSON.stringify(d.activeStrategy.overrides));
    }
    // Recent trades
    const trades = (await db.collection('virtual_trades')
        .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
        .orderBy('date', 'desc').limit(15).get()).docs.map(d => d.data());
    console.log('\n=== LAST 15 TRADES ===');
    for (const t of trades) {
        console.log(`${t.date?.substring(0, 16)} ${t.type} ${t.ticker} $${(t.total || 0).toFixed(2)} @ $${(t.price || 0).toFixed(4)} | ${t.reason || ''}`);
    }
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
