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

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function audit() {
    // 1. Recent trades
    console.log('=== RECENT TRADES (last 10) ===');
    const trades = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(10)
        .get();

    trades.docs.forEach(d => {
        const t = d.data();
        console.log(`${t.date} | ${t.type} ${t.ticker} | $${(t.total || 0).toFixed(2)} | ${t.reason} | Entry: ${t.entryType || 'N/A'}`);
    });

    // 2. Current holdings
    console.log('\n=== CURRENT HOLDINGS ===');
    const vp = await db.collection('virtual_portfolio').doc(userId).get();
    const holdings = vp.data()?.holdings || {};
    const cash = vp.data()?.cashBalance || 0;
    console.log(`Cash: $${cash.toFixed(2)}`);
    Object.entries(holdings).forEach(([ticker, data]: [string, any]) => {
        console.log(`  ${ticker}: ${data.amount?.toFixed(8)} @ $${data.averagePrice?.toFixed(6)} | Entry: ${data.entryType || 'N/A'}`);
    });

    // 3. Cash Deployment state
    console.log('\n=== CASH DEPLOYMENT STATE ===');
    const config = await db.collection('agent_configs').doc(userId).get();
    const cd = config.data()?.cashDeployment;
    console.log(JSON.stringify(cd, null, 2));

    // 4. Config thresholds
    console.log('\n=== CONFIG THRESHOLDS ===');
    console.log('buyScoreThreshold:', config.data()?.buyScoreThreshold);
    console.log('scalingScoreThreshold:', config.data()?.scalingScoreThreshold);
    console.log('riskProfile:', config.data()?.riskProfile);

    // 5. Recent BUY decisions
    console.log('\n=== RECENT BUY DECISIONS ===');
    const decisions = await db.collection('trade_decisions')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

    const buyDecisions = decisions.docs.filter(d => d.data().action === 'BUY');
    if (buyDecisions.length === 0) {
        console.log('  (no BUY decisions found in recent batch)');
    }
    buyDecisions.forEach(d => {
        const dd = d.data();
        console.log(`  ${dd.timestamp} | ${dd.action} ${dd.ticker} | Score: ${dd.score} | ${dd.reason}`);
    });

    // 6. Recent DIL skip decisions
    console.log('\n=== RECENT DIL SKIPS ===');
    const dilSkips = decisions.docs.filter(d => {
        const dd = d.data();
        return dd.action === 'SKIP' && dd.reason?.includes('DIL');
    });
    if (dilSkips.length === 0) {
        console.log('  (no DIL-related skips found — the new DIL features may not have run yet)');
    }
    dilSkips.forEach(d => {
        const dd = d.data();
        console.log(`  ${dd.timestamp} | SKIP ${dd.ticker} | Score: ${dd.score} | ${dd.reason}`);
    });

    process.exit(0);
}

audit().catch(console.error);
