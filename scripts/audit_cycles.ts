import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const config = (await db.collection('agent_configs').doc(userId).get()).data()!;

    // Analysis cycle config
    console.log('=== ANALYSIS CYCLE CONFIG ===');
    console.log(`  analysisCycle: ${config.analysisCycle}`);
    console.log(`  trafficCycle: ${config.trafficCycle}`);
    console.log(`  sandboxCycle: ${config.sandboxCycle}`);
    console.log(`  aiCycle: ${config.aiCycle}`);

    // Cycle logs
    const logs = config.cycle_logs || [];
    console.log(`\n=== CYCLE LOGS: ${logs.length} entries ===`);
    logs.slice(0, 3).forEach((l: any, i: number) => {
        const exec = l.execution || {};
        console.log(`  [${i}] ${l.timestamp} | Trades: ${exec.trades?.length || 0} | Decisions: ${exec.decisions?.length || 0} | Cash: $${exec.newCashBalance?.toFixed(2) || '?'}`);
        if (exec.trades?.length > 0) {
            exec.trades.forEach((t: any) => console.log(`      → ${t.type} ${t.ticker}: $${t.total?.toFixed(2)} — ${t.reason}`));
        }
    });

    // Reflection history
    const history = config.reflectionHistory || [];
    console.log(`\n=== REFLECTION HISTORY: ${history.length} entries ===`);
    history.slice(0, 5).forEach((r: any, i: number) => {
        console.log(`  [${i}] ${r.generatedAt} | PΔ: ${r.portfolioChange?.toFixed(2)}% | MΔ: ${r.marketChange?.toFixed(2)}% | Trades: ${r.actions?.length || 0}`);
    });

    // Scan plan
    const sp = config.scanPlan;
    if (sp) {
        console.log(`\n=== SCAN PLAN ===`);
        console.log(`  Timestamp: ${sp.timestamp}`);
        console.log(`  Profile: ${sp.profile}`);
        console.log(`  Pulse: ${sp.pulse?.effective}x (${sp.pulse?.speedLabel})`);
        console.log(`  Scope: ${sp.scan?.dueForAnalysis}/${sp.scan?.totalWatchlist}`);
        console.log(`  Cycle Times: Traffic=${sp.cycleTimes?.traffic}, Standard=${sp.cycleTimes?.standard}, Sandbox=${sp.cycleTimes?.sandbox}, AI=${sp.cycleTimes?.ai}`);
    }

    // Recent trade dates  
    const trades = await db.collection('virtual_trades').where('userId', '==', userId).orderBy('date', 'desc').limit(15).get();
    console.log(`\n=== LAST 15 TRADES ===`);
    trades.docs.forEach(d => {
        const t = d.data();
        const pnl = t.pnl !== undefined ? ` PnL: ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} (${(t.pnlPct || 0).toFixed(1)}%)` : '';
        console.log(`  ${t.date?.substring(0, 19)} | ${t.type} ${t.ticker} | $${t.total?.toFixed(2)} @ $${t.price < 1 ? t.price.toFixed(6) : t.price.toFixed(2)} | ${t.reason}${pnl}`);
    });

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
