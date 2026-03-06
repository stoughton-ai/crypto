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

    // 1. Recent trades (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tradesSnap = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .where('date', '>=', since)
        .orderBy('date', 'desc')
        .limit(50)
        .get();

    console.log(`\n${'═'.repeat(80)}`);
    console.log('  TRADE AUDIT — Last 24 Hours');
    console.log(`${'═'.repeat(80)}`);
    console.log(`  Total trades: ${tradesSnap.size}\n`);

    for (const doc of tradesSnap.docs) {
        const t = doc.data();
        const time = new Date(t.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(t.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        const pnl = t.pnl ? ` | P&L: ${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)} (${t.pnlPct >= 0 ? '+' : ''}${Number(t.pnlPct || 0).toFixed(1)}%)` : '';
        console.log(`  ${date} ${time} | ${t.type.padEnd(5)} | ${(t.ticker || '').padEnd(6)} | $${Number(t.amount || 0).toFixed(2)} @ $${Number(t.price || 0).toFixed(4)}${pnl}`);
        if (t.reason) console.log(`    └─ Reason: ${t.reason}`);
        if (t.exitReason) console.log(`    └─ Exit Reason: ${t.exitReason}`);
        if (t.aiScore !== undefined) console.log(`    └─ AI Score: ${t.aiScore}`);
        console.log('');
    }

    // 2. Current portfolio
    const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
    const vp = vpDoc.data();
    console.log(`${'─'.repeat(80)}`);
    console.log('  CURRENT PORTFOLIO');
    console.log(`${'─'.repeat(80)}`);
    if (vp) {
        console.log(`  Cash: $${Number(vp.cash || 0).toFixed(2)}`);
        console.log(`  Total Value: $${Number(vp.totalValue || 0).toFixed(2)}`);
        const holdings = vp.holdings || {};
        const holdingKeys = Object.keys(holdings);
        if (holdingKeys.length === 0) {
            console.log('  Holdings: NONE (100% cash)');
        } else {
            for (const ticker of holdingKeys) {
                const h = holdings[ticker];
                console.log(`  ${ticker}: ${h.amount} units @ avg $${Number(h.avgPrice || 0).toFixed(4)} | Current: $${Number(h.currentPrice || 0).toFixed(4)}`);
            }
        }
    }

    // 3. Check recent cycle logs for sell triggers
    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data()!;

    console.log(`\n${'─'.repeat(80)}`);
    console.log('  CURRENT CONFIG (sell-relevant)');
    console.log(`${'─'.repeat(80)}`);
    console.log(`  aiScoreExitThreshold: ${config.aiScoreExitThreshold ?? 'default'}`);
    console.log(`  positionStopLoss: ${config.positionStopLoss ?? 'default'}%`);
    console.log(`  portfolioStopLoss: ${config.portfolioStopLoss ?? 'default'}%`);
    console.log(`  buyScoreThreshold: ${config.buyScoreThreshold ?? 'default'}`);
    console.log(`  riskProfile: ${config.riskProfile}`);
    console.log(`  automationEnabled: ${config.automationEnabled}`);
    console.log(`  activeStrategy: ${config.activeStrategy ?? 'none'}`);

    // 4. Check latest reflection for context
    const reflection = config.dailyReflection;
    if (reflection) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log('  LATEST NEURAL REFLECTION');
        console.log(`${'─'.repeat(80)}`);
        console.log(`  Generated: ${reflection.generatedAt || 'unknown'}`);
        console.log(`  Market: ${reflection.marketContext || 'unknown'}`);
        console.log(`  Score: ${reflection.performanceScore || 'unknown'}/10`);
        if (reflection.narrative) console.log(`  Narrative: ${reflection.narrative.substring(0, 200)}...`);
    }

    // 5. Check cycle_logs for watchdog/stop-loss triggers
    const cycleLogs = config.cycle_logs || [];
    const recentLogs = cycleLogs.slice(0, 5);
    if (recentLogs.length > 0) {
        console.log(`\n${'─'.repeat(80)}`);
        console.log('  RECENT CYCLE LOGS (last 5)');
        console.log(`${'─'.repeat(80)}`);
        for (const log of recentLogs) {
            const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '??:??';
            console.log(`  ${time} | Holdings: ${log.holdingsCount ?? '?'} | Actions: ${JSON.stringify(log.actions || log.sellActions || []).substring(0, 100)}`);
            if (log.watchdogTriggered) console.log(`    └─ ⚠️ WATCHDOG TRIGGERED`);
            if (log.stopLossTriggered) console.log(`    └─ 🛑 STOP-LOSS TRIGGERED`);
            if (log.sellDecisions) console.log(`    └─ Sells: ${JSON.stringify(log.sellDecisions).substring(0, 150)}`);
        }
    }

    // 6. Check virtual_decisions for recent SELL decisions
    try {
        const decisionsSnap = await db.collection('virtual_decisions')
            .where('userId', '==', userId)
            .where('date', '>=', since)
            .orderBy('date', 'desc')
            .limit(20)
            .get();

        const sellDecisions = decisionsSnap.docs.filter(d => {
            const data = d.data();
            return data.action === 'SELL' || data.type === 'SELL' || data.decision === 'SELL';
        });

        if (sellDecisions.length > 0) {
            console.log(`\n${'─'.repeat(80)}`);
            console.log('  SELL DECISIONS (last 24h)');
            console.log(`${'─'.repeat(80)}`);
            for (const doc of sellDecisions) {
                const d = doc.data();
                console.log(`  ${d.ticker}: ${d.reason || d.exitReason || 'no reason'} | Score: ${d.aiScore ?? '?'}`);
            }
        }
    } catch { /* virtual_decisions may not exist */ }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
