import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function go() {
    const doc = await db.collection('arena_config').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const arena = doc.data();
    if (!arena) { console.error('No arena'); process.exit(1); }

    console.log('════════════════════════════════════════════════════');
    console.log('  FULL AI STRATEGY AUDIT — ' + new Date().toISOString());
    console.log('════════════════════════════════════════════════════\n');

    let totalChanges = 0;
    let totalReviews = 0;
    let totalTrades = 0;

    for (const pool of arena.pools) {
        const changes = pool.strategyHistory || [];
        const reviews = pool.weeklyReviews || [];
        totalChanges += changes.length;
        totalReviews += reviews.length;
        totalTrades += pool.performance.totalTrades;

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  Tokens: ${pool.tokens.join(', ')}`);
        console.log(`  Status: ${pool.status}`);
        console.log(`  Budget: $${pool.budget} | Cash: $${pool.cashBalance.toFixed(2)}`);
        console.log(`  W/L: ${pool.performance.winCount}W / ${pool.performance.lossCount}L`);
        console.log(`  Total Trades: ${pool.performance.totalTrades}`);
        console.log(`  Total P&L: $${pool.performance.totalPnl?.toFixed(2) || '?'} (${pool.performance.totalPnlPct?.toFixed(2) || '?'}%)`);

        const s = pool.strategy;
        console.log('\n  ┌── CURRENT STRATEGY ──');
        console.log(`  │ Buy >= ${s.buyScoreThreshold} (+${s.buyConfidenceBuffer ?? '?'} buf) | Exit < ${s.exitThreshold} (-${s.exitHysteresis ?? '?'} hyst)`);
        console.log(`  │ TP: ${s.takeProfitTarget}% | Trail: ${s.trailingStopPct}% | SL: ${s.positionStopLoss}%`);
        console.log(`  │ Hold: ${s.minHoldMinutes ?? '?'}min | Cooldown: ${s.evaluationCooldownMinutes ?? '?'}min`);
        console.log(`  │ Size: ${s.positionSizeMultiplier ?? '?'}x | AntiWash: ${s.antiWashHours}h`);
        console.log(`  │ Momentum: ${s.momentumGateEnabled ? 'ON (' + s.momentumGateThreshold + '%)' : 'OFF'}`);
        console.log(`  │ MaxAlloc: $${s.maxAllocationPerToken} | MinOrder: $${s.minOrderAmount}`);
        console.log(`  │ Personality: ${s.strategyPersonality || 'not set'}`);
        console.log(`  │ Description: ${s.description}`);
        console.log(`  └──────────────────────`);

        if (changes.length > 0) {
            console.log(`\n  ┌── STRATEGY CHANGES (${changes.length}) ──`);
            for (const change of changes) {
                console.log(`  │`);
                console.log(`  │ 📅 ${change.changedAt} (Week ${change.week})`);
                console.log(`  │ 💬 ${change.reasoning}`);

                const prev = change.previousStrategy;
                const next = change.newStrategy;
                const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
                const diffs: string[] = [];
                for (const key of keys) {
                    if (key === 'description') continue;
                    const ov = (prev as any)[key];
                    const nv = (next as any)[key];
                    if (ov !== nv && nv !== undefined) {
                        diffs.push(`${key}: ${ov} → ${nv}`);
                    }
                }
                if (prev.description !== next.description) {
                    diffs.push(`description changed`);
                }
                console.log(`  │ DIFFS (${diffs.length}):`);
                for (const d of diffs) {
                    console.log(`  │   ${d}`);
                }
            }
            console.log(`  └──────────────────────`);
        }

        if (reviews.length > 0) {
            console.log(`\n  ┌── AI REVIEWS (${reviews.length}) ──`);
            for (const review of reviews) {
                console.log(`  │`);
                console.log(`  │ 📅 ${review.timestamp} (Week ${review.week})`);
                console.log(`  │ P&L: $${review.pnl?.toFixed(2)} (${review.pnlPct?.toFixed(2)}%)`);
                console.log(`  │ Trades: ${review.trades} (${review.wins}W/${review.losses}L)`);
                console.log(`  │ Changed: ${review.strategyChanged ? '✅ YES' : '❌ NO'}`);
                console.log(`  │ Reflection: ${review.aiReflection}`);
            }
            console.log(`  └──────────────────────`);
        }

        if (pool.scoreHistory) {
            console.log(`\n  ┌── SCORE HISTORY ──`);
            for (const [ticker, scores] of Object.entries(pool.scoreHistory)) {
                const scoreArr = scores as { score: number; ts: string }[];
                const vals = scoreArr.map((s: any) => s.score);
                const avg = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const stddev = Math.sqrt(vals.reduce((s: number, v: number) => s + Math.pow(v - avg, 2), 0) / vals.length);
                console.log(`  │ ${ticker}: ${vals.length} scores | avg=${avg.toFixed(1)} | range=${min}-${max} | stddev=±${stddev.toFixed(1)}`);
                console.log(`  │   Last 5: [${vals.slice(-5).join(', ')}]`);
            }
            console.log(`  └──────────────────────`);
        }

        const holdings = Object.entries(pool.holdings);
        if (holdings.length > 0) {
            console.log(`\n  ┌── CURRENT HOLDINGS ──`);
            for (const [ticker, h] of holdings) {
                const holding = h as any;
                console.log(`  │ ${ticker}: ${holding.amount.toFixed(6)} @ avg $${holding.averagePrice.toFixed(6)} | peak P&L: +${(holding.peakPnlPct || 0).toFixed(1)}%`);
                if (holding.boughtAt) console.log(`  │   Bought: ${holding.boughtAt}`);
            }
            console.log(`  └──────────────────────`);
        }

        console.log('');
    }

    // All sells
    const allSellsSnap = await db.collection('arena_trades')
        .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
        .where('type', '==', 'SELL')
        .orderBy('date', 'desc')
        .get();

    let allRealizedPnl = 0;
    let allSellCount = 0;
    let allWinCount = 0;
    const sellsByPool: Record<string, { wins: number; losses: number; pnl: number; trades: any[] }> = {};

    for (const d of allSellsSnap.docs) {
        const t = d.data();
        if (t.pnl !== undefined) {
            allRealizedPnl += t.pnl;
            allSellCount++;
            if (t.pnl >= 0) allWinCount++;

            if (!sellsByPool[t.poolId]) sellsByPool[t.poolId] = { wins: 0, losses: 0, pnl: 0, trades: [] };
            sellsByPool[t.poolId].pnl += t.pnl;
            if (t.pnl >= 0) sellsByPool[t.poolId].wins++;
            else sellsByPool[t.poolId].losses++;
            sellsByPool[t.poolId].trades.push({
                ticker: t.ticker,
                total: t.total,
                pnl: t.pnl,
                pnlPct: t.pnlPct,
                date: t.date,
                reason: t.reason?.substring(0, 120),
            });
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  SELL TRADE ANALYSIS BY POOL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const [poolId, data] of Object.entries(sellsByPool)) {
        const pool = arena.pools.find((p: any) => p.poolId === poolId);
        console.log(`\n  ${pool?.emoji || ''} ${pool?.name || poolId}:`);
        console.log(`    Win/Loss: ${data.wins}W / ${data.losses}L (${data.wins + data.losses > 0 ? ((data.wins / (data.wins + data.losses)) * 100).toFixed(0) : 0}%)`);
        console.log(`    Realized P&L: $${data.pnl.toFixed(2)}`);
        for (const t of data.trades) {
            console.log(`      ${t.ticker} $${t.total.toFixed(2)} → ${t.pnl >= 0 ? '✅' : '❌'} $${t.pnl.toFixed(2)} (${t.pnlPct?.toFixed(2)}%) | ${t.date}`);
            console.log(`        Reason: ${t.reason}`);
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  AGGREGATE STATISTICS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Total Strategy Changes: ${totalChanges}`);
    console.log(`  Total AI Reviews: ${totalReviews}`);
    console.log(`  Total Trades: ${totalTrades}`);
    console.log(`  All Completed Sells: ${allSellCount}`);
    console.log(`  Win Rate: ${allSellCount > 0 ? ((allWinCount / allSellCount) * 100).toFixed(1) : '0'}% (${allWinCount}W / ${allSellCount - allWinCount}L)`);
    console.log(`  Total Realized P&L: $${allRealizedPnl.toFixed(2)}`);
    console.log(`  Avg P&L per sell: $${allSellCount > 0 ? (allRealizedPnl / allSellCount).toFixed(2) : '0'}`);

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
