import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON env var");
    const sa = JSON.parse(saStr);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Current VP state
    const vpSnap = await db.collection('virtual_portfolio').doc(userId).get();
    const vp = vpSnap.data()!;
    console.log('\n═══ CURRENT VIRTUAL PORTFOLIO STATE ═══');
    console.log(`  cashBalance:    $${vp.cashBalance?.toFixed(2)}`);
    console.log(`  totalValue:     $${vp.totalValue?.toFixed(2)}`);
    console.log(`  initialBalance: $${vp.initialBalance?.toFixed(2)}`);
    console.log(`  netDeposits:    $${vp.netDeposits?.toFixed(2)}`);
    console.log(`  lastUpdated:    ${vp.lastUpdated}`);

    const holdings = vp.holdings || {};
    console.log(`  Holdings:`);
    for (const [ticker, h] of Object.entries(holdings) as any) {
        console.log(`    ${ticker}: ${h.amount?.toFixed(6)} @ avg $${h.averagePrice?.toFixed(4)}`);
    }

    // Recent history snapshots
    const histSnap = await db.collection('portfolio_history')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

    console.log('\n═══ RECENT PORTFOLIO HISTORY (newest first) ═══');
    histSnap.docs.forEach(h => {
        const hd = h.data();
        console.log(`  ${hd.date} | total: $${hd.totalValue?.toFixed(2)} | cash: $${hd.cashBalance?.toFixed(2)} | holdings: $${hd.holdingsValue?.toFixed(2)} | netDep: $${hd.netDeposits?.toFixed(2)}`);
    });

    // Check recent trades for anything unusual
    const tradesSnap = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(10)
        .get();

    console.log('\n═══ RECENT TRADES (newest first) ═══');
    tradesSnap.docs.forEach(t => {
        const td = t.data();
        console.log(`  ${td.date} | ${td.side} ${td.ticker} | ${td.amount?.toFixed(6)} @ $${td.price?.toFixed(4)} = $${td.value?.toFixed(2)} | ${td.reason?.substring(0, 50)}`);
    });

    // Check recent decisions
    const decSnap = await db.collection('virtual_decisions')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(10)
        .get();

    console.log('\n═══ RECENT DECISIONS (newest first) ═══');
    decSnap.docs.forEach(d => {
        const dd = d.data();
        console.log(`  ${dd.date} | ${dd.action} ${dd.ticker} | score: ${dd.overallScore} | ${dd.reason?.substring(0, 60)}`);
    });

    // Calculate what the numbers SHOULD be
    const tradePnl = (vp.totalValue || 0) - (vp.initialBalance || 0) - (vp.netDeposits || 0);
    const returnPct = ((vp.initialBalance || 0) + (vp.netDeposits || 0)) > 0
        ? (tradePnl / ((vp.initialBalance || 0) + (vp.netDeposits || 0))) * 100
        : 0;

    console.log('\n═══ DERIVED VALUES ═══');
    console.log(`  Total Invested (initial + netDep): $${((vp.initialBalance || 0) + (vp.netDeposits || 0)).toFixed(2)}`);
    console.log(`  Trading P&L:        $${tradePnl.toFixed(2)}`);
    console.log(`  Return:             ${returnPct.toFixed(2)}%`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
