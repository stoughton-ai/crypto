require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    // 1. Portfolio
    const vp = (await db.collection('virtual_portfolio').doc(userId).get()).data();
    const totalInvested = (vp.initialBalance || 0) + (vp.netDeposits || 0);
    console.log('=== PORTFOLIO ===');
    console.log('Cash:', (vp.cashBalance || 0).toFixed(2));
    console.log('Value:', (vp.totalValue || 0).toFixed(2));
    console.log('Initial:', (vp.initialBalance || 0).toFixed(2));
    console.log('Deposits:', (vp.netDeposits || 0).toFixed(2));
    console.log('Invested:', totalInvested.toFixed(2));
    console.log('PnL:', ((vp.totalValue || 0) - totalInvested).toFixed(2));
    console.log('Holdings:', Object.keys(vp.holdings || {}).length);

    // 2. History
    const hist = (await db.collection('virtual_portfolio_history').where('userId', '==', userId).orderBy('date', 'asc').get()).docs.map(d => d.data());
    console.log('\n=== HISTORY (' + hist.length + ' snapshots) ===');
    const byDay = {};
    for (const h of hist) {
        const day = h.date.substring(0, 10);
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(h.totalValue || 0);
    }
    for (const [day, vals] of Object.entries(byDay)) {
        console.log(day, 'O:' + vals[0].toFixed(2), 'C:' + vals[vals.length - 1].toFixed(2), 'H:' + Math.max(...vals).toFixed(2), 'L:' + Math.min(...vals).toFixed(2), 'N:' + vals.length);
    }

    // 3. Trades
    const trades = (await db.collection('virtual_trades').where('userId', '==', userId).orderBy('date', 'asc').get()).docs.map(d => d.data());
    console.log('\n=== TRADES (' + trades.length + ') ===');
    const buys = trades.filter(t => t.type === 'BUY');
    const sells = trades.filter(t => ['SELL', 'TRIM', 'LIQUIDATE', 'BURN'].includes(t.type));
    const wins = sells.filter(t => (t.pnl || 0) > 0);
    const losses = sells.filter(t => (t.pnl || 0) < 0);
    console.log('Buys:', buys.length, 'Sells:', sells.length);
    console.log('Wins:', wins.length, 'Losses:', losses.length);
    console.log('WinRate:', sells.length > 0 ? (wins.length / sells.length * 100).toFixed(1) + '%' : 'N/A');
    const rPnl = sells.reduce((s, t) => s + (t.pnl || 0), 0);
    console.log('RealisedPnL:', rPnl.toFixed(2));
    const avgW = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length : 0;
    const avgL = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl || 0), 0) / losses.length : 0;
    const avgWP = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length : 0;
    const avgLP = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPct || 0), 0) / losses.length : 0;
    console.log('AvgWin: $' + avgW.toFixed(2) + ' (' + avgWP.toFixed(1) + '%)');
    console.log('AvgLoss: $' + avgL.toFixed(2) + ' (' + avgLP.toFixed(1) + '%)');
    const wr = sells.length > 0 ? wins.length / sells.length : 0;
    console.log('Expectancy: $' + ((wr * avgW) + ((1 - wr) * avgL)).toFixed(2));

    if (trades.length >= 2) {
        const days = (new Date(trades[trades.length - 1].date) - new Date(trades[0].date)) / (86400000);
        console.log('Window:', days.toFixed(1), 'days');
        console.log('Trades/day:', (trades.length / Math.max(1, days)).toFixed(1));
        console.log('Sells/day:', (sells.length / Math.max(1, days)).toFixed(1));
        console.log('First:', trades[0].date);
        console.log('Last:', trades[trades.length - 1].date);
    }
    console.log('BuyVol:', buys.reduce((s, t) => s + (t.total || 0), 0).toFixed(2));
    console.log('SellVol:', sells.reduce((s, t) => s + (t.total || 0), 0).toFixed(2));

    // Token breakdown
    console.log('\n=== BY TOKEN ===');
    const bt = {};
    for (const t of trades) {
        if (!bt[t.ticker]) bt[t.ticker] = { b: 0, s: 0, w: 0, l: 0, pnl: 0, vol: 0 };
        if (t.type === 'BUY') { bt[t.ticker].b++; bt[t.ticker].vol += (t.total || 0); }
        else { bt[t.ticker].s++; bt[t.ticker].pnl += (t.pnl || 0); if ((t.pnl || 0) > 0) bt[t.ticker].w++; if ((t.pnl || 0) < 0) bt[t.ticker].l++; }
    }
    for (const [tk, s] of Object.entries(bt).sort((a, b) => b[1].pnl - a[1].pnl)) {
        console.log(tk, s.b + 'B/' + s.s + 'S', s.w + 'W/' + s.l + 'L', '$' + s.pnl.toFixed(2));
    }

    // Daily PnL
    console.log('\n=== DAILY PNL ===');
    const dp = {};
    for (const t of trades) {
        const d = t.date.substring(0, 10);
        if (!dp[d]) dp[d] = { b: 0, s: 0, pnl: 0 };
        if (t.type === 'BUY') dp[d].b++; else { dp[d].s++; dp[d].pnl += (t.pnl || 0); }
    }
    for (const [d, s] of Object.entries(dp)) console.log(d, s.b + 'B/' + s.s + 'S', '$' + s.pnl.toFixed(2));

    // Config
    const cfg = (await db.collection('agent_configs').doc(userId).get()).data() || {};
    console.log('\n=== CONFIG ===');
    console.log('Profile:', cfg.riskProfile);
    console.log('Auto:', cfg.automationEnabled ? 'ON' : 'OFF');
    console.log('PortSL:', cfg.portfolioStopLoss, 'PosSL:', cfg.positionStopLoss);
    console.log('MaxAlloc:', cfg.maxAllocationPerAsset);
    console.log('MaxPos:', cfg.maxOpenPositions);
    console.log('BuyTh:', cfg.buyScoreThreshold, 'ExitTh:', cfg.aiScoreExitThreshold);
    console.log('StopTriggered:', cfg.stopLossTriggered ? 'YES' : 'No');

    // Reflections
    console.log('\n=== REFLECTIONS ===');
    for (const r of (cfg.reflectionHistory || []).slice(0, 10)) {
        console.log(r.generatedAt?.substring(0, 16), 'S:' + r.performanceScore, 'P:' + ((r.portfolioChange || 0).toFixed(2)) + '%', 'M:' + ((r.marketChange || 0).toFixed(2)) + '%', 'PnL24:$' + ((r.pnlAbs24h || 0).toFixed(2)), 'AT:$' + ((r.totalPnlAbs || 0).toFixed(2)));
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
