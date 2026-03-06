import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const doc = await adminDb.collection('arena_config').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const arena = doc.data();

    for (const pool of arena!.pools) {
        console.log('\n' + pool.emoji + ' ' + pool.name + ' (' + pool.poolId + ')');
        console.log('  Tokens:', pool.tokens.join(', '));
        console.log('  Strategy:', pool.strategy.description);
        console.log('  Buy Score Threshold:', pool.strategy.buyScoreThreshold);
        console.log('  Exit Threshold:', pool.strategy.exitThreshold);
        console.log('  Momentum Gate:', pool.strategy.momentumGateEnabled ? 'ON (' + pool.strategy.momentumGateThreshold + '%)' : 'OFF');
        console.log('  Position Stop Loss:', pool.strategy.positionStopLoss + '%');
        console.log('  Max Allocation:', '$' + pool.strategy.maxAllocationPerToken);
        console.log('  Cash Balance:', '$' + pool.cashBalance.toFixed(2));
        const holdings = Object.entries(pool.holdings);
        if (holdings.length > 0) {
            for (const [k, v] of holdings) {
                const h = v as any;
                console.log('  Holding:', k, h.amount.toFixed(6), '@ $' + h.averagePrice.toFixed(6));
            }
        } else {
            console.log('  Holdings: NONE (all cash)');
        }
        console.log('  W/L:', pool.performance.winCount + 'W / ' + pool.performance.lossCount + 'L');
        console.log('  Total Trades:', pool.performance.totalTrades);
    }

    // Also check trades
    for (const pool of arena!.pools) {
        const snap = await adminDb.collection('arena_trades')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .where('poolId', '==', pool.poolId)
            .orderBy('date', 'desc')
            .limit(5)
            .get();

        console.log('\n  Recent trades for', pool.name + ':');
        if (snap.empty) {
            console.log('    (none)');
        } else {
            for (const d of snap.docs) {
                const t = d.data();
                console.log('    ' + t.type + ' ' + t.ticker + ' $' + t.total.toFixed(2) + ' @ $' + t.price.toFixed(6) + (t.pnlPct !== undefined ? ' P&L: ' + t.pnlPct.toFixed(2) + '%' : ''));
            }
        }
    }

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
