import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const doc = await adminDb.collection('arena_config').doc(userId).get();
    const arena = doc.data()!;

    // Fetch all trades
    const tradeSnap = await adminDb.collection('arena_trades')
        .where('userId', '==', userId)
        .get();

    const allTrades = tradeSnap.docs.map(d => d.data());

    console.log('=== EXPECTED vs REALISED PROFIT REPORT ===');
    console.log(`Date: ${new Date().toLocaleString('en-GB')}`);
    console.log(`Competition Day: ${Math.ceil((Date.now() - new Date(arena.startDate).getTime()) / 86400000)} of 28`);
    console.log(`Total Budget: $${arena.totalBudget}`);
    console.log('');

    for (const pool of arena.pools) {
        const poolTrades = allTrades.filter(t => t.poolId === pool.poolId);
        const buys = poolTrades.filter(t => t.type === 'BUY');
        const sells = poolTrades.filter(t => t.type === 'SELL');
        const realizedPnl = sells.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const realizedPnlPct = sells.length > 0 ? sells.reduce((sum, t) => sum + (t.pnlPct || 0), 0) / sells.length : 0;

        // Current unrealized P&L from holdings
        const holdingCount = Object.keys(pool.holdings).length;
        const unrealizedPnl = pool.performance.totalPnl - realizedPnl;

        // Calculate expected profit scenarios based on new strategy parameters
        const tp = pool.strategy.takeProfitTarget || 3;
        const sl = pool.strategy.positionStopLoss || -8;
        const minWin = pool.strategy.minWinPct || 0.5;

        // Scenario: If all current holdings hit take-profit
        let bestCaseFromHoldings = 0;
        let worstCaseFromHoldings = 0;
        for (const [ticker, holding] of Object.entries(pool.holdings)) {
            const h = holding as any;
            const positionValue = h.amount * h.averagePrice;
            bestCaseFromHoldings += positionValue * (tp / 100);
            worstCaseFromHoldings += positionValue * (sl / 100);
        }

        // Expected trades per day based on cycle frequency and strategy
        const avgCyclesPerDay = 24 * 60 / 5; // ~288 cycles/day at 5min intervals
        const tradeFrequency = poolTrades.length > 0
            ? poolTrades.length / Math.max(1, Math.ceil((Date.now() - new Date(arena.startDate).getTime()) / 86400000))
            : 2; // default assumption

        const remainingDays = 28 - Math.ceil((Date.now() - new Date(arena.startDate).getTime()) / 86400000);

        // Expected profit if maintaining current win rate
        const winRate = sells.length > 0 ? sells.filter(t => (t.pnlPct || 0) >= minWin).length / sells.length : 0.5;
        const avgWin = sells.filter(t => (t.pnlPct || 0) > 0).reduce((s, t) => s + (t.pnlPct || 0), 0) / Math.max(1, sells.filter(t => (t.pnlPct || 0) > 0).length) || tp;
        const avgLoss = sells.filter(t => (t.pnlPct || 0) < 0).reduce((s, t) => s + (t.pnlPct || 0), 0) / Math.max(1, sells.filter(t => (t.pnlPct || 0) < 0).length) || sl;

        const avgTradeSize = buys.length > 0 ? buys.reduce((s, t) => s + t.total, 0) / buys.length : pool.budget / 2;

        // Expected profit per trade = (winRate * avgWin) + ((1-winRate) * avgLoss)
        const expectedPctPerTrade = (winRate * avgWin) + ((1 - winRate) * avgLoss);
        const expectedTradesRemaining = tradeFrequency * remainingDays * 0.5; // assume 50% are round-trips
        const projectedProfit = expectedTradesRemaining * (expectedPctPerTrade / 100) * avgTradeSize;

        console.log(`${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`  Budget: $${pool.budget.toFixed(2)} | Cash: $${pool.cashBalance.toFixed(2)}`);
        console.log(`  Holdings: ${holdingCount} positions`);
        console.log('');
        console.log('  📊 TRADE ACTIVITY:');
        console.log(`    Total Trades: ${poolTrades.length} (${buys.length} buys, ${sells.length} sells)`);
        console.log(`    Trades/Day: ${tradeFrequency.toFixed(1)}`);
        console.log(`    Win Rate: ${(winRate * 100).toFixed(0)}% (min ${minWin}% to count)`);
        console.log('');
        console.log('  💰 REALISED P&L:');
        console.log(`    Closed Trades P&L: $${realizedPnl.toFixed(2)} (${realizedPnlPct >= 0 ? '+' : ''}${realizedPnlPct.toFixed(2)}% avg)`);
        console.log(`    Unrealised (open positions): $${unrealizedPnl.toFixed(2)}`);
        console.log(`    Total P&L: $${pool.performance.totalPnl.toFixed(2)} (${pool.performance.totalPnlPct.toFixed(2)}%)`);
        console.log('');
        console.log('  🎯 STRATEGY TARGETS:');
        console.log(`    Take Profit: +${tp}% | Stop Loss: ${sl}% | Trailing: ${pool.strategy.trailingStopPct || 'N/A'}%`);
        console.log(`    Buy Threshold: ${pool.strategy.buyScoreThreshold} | Exit Threshold: ${pool.strategy.exitThreshold}`);
        console.log('');
        console.log('  📈 PROFIT PROJECTIONS (remaining ' + remainingDays + ' days):');
        console.log(`    Best Case (all hits TP): $${bestCaseFromHoldings.toFixed(2)} from holdings + projected new trades`);
        console.log(`    Worst Case (all hits SL): $${worstCaseFromHoldings.toFixed(2)} from holdings`);
        console.log(`    Expected per trade: ${expectedPctPerTrade >= 0 ? '+' : ''}${expectedPctPerTrade.toFixed(2)}%`);
        console.log(`    Est. remaining round-trips: ${expectedTradesRemaining.toFixed(0)}`);
        console.log(`    Projected remaining profit: $${projectedProfit.toFixed(2)}`);
        console.log(`    Projected Final NAV: $${(pool.budget + pool.performance.totalPnl + projectedProfit).toFixed(2)}`);
        console.log('');

        // Individual sell trade breakdown
        if (sells.length > 0) {
            console.log('  📋 CLOSED TRADE DETAILS:');
            for (const s of sells) {
                console.log(`    ${s.ticker}: ${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(2)}% ($${s.pnl.toFixed(2)}) — ${s.reason?.substring(0, 60)}`);
            }
            console.log('');
        }

        console.log('─'.repeat(60));
    }

    // Overall summary
    const totalNAV = arena.pools.reduce((s, p) => s + p.budget + p.performance.totalPnl, 0);
    const totalPnl = totalNAV - arena.totalBudget;
    const totalPnlPct = (totalPnl / arena.totalBudget) * 100;
    const totalRealised = allTrades.filter(t => t.type === 'SELL').reduce((s, t) => s + (t.pnl || 0), 0);

    console.log('');
    console.log('═══ OVERALL SUMMARY ═══');
    console.log(`  Total NAV: $${totalNAV.toFixed(2)} / $${arena.totalBudget} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`);
    console.log(`  Realised P&L: $${totalRealised.toFixed(2)}`);
    console.log(`  Unrealised P&L: $${(totalPnl - totalRealised).toFixed(2)}`);
    console.log(`  Total Trades: ${allTrades.length}`);
    console.log('');
    console.log('  To break even: need +$' + Math.abs(totalPnl).toFixed(2) + ' (' + (Math.abs(totalPnlPct)).toFixed(2) + '%)');

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
