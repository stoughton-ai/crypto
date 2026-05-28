import { adminDb } from './src/lib/firebase-admin';
import { getArenaTrades } from './src/services/arenaService';

async function main() {
    try {
        const snap = await adminDb.collection('arena_config').limit(1).get();
        if (snap.empty) return;
        const userId = snap.docs[0].id;
        console.log("User:", userId);

        const trades = await getArenaTrades(userId, undefined, 'CRYPTO');

        const thirtyDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).getTime();
        const recentTrades = trades.filter(t => new Date(t.date).getTime() >= thirtyDaysAgo);

        console.log(`Total trades last 4 days: ${recentTrades.length}`);

        let wins = 0, losses = 0;
        let totalPnl = 0;
        let totalPnlPct = 0;
        const typeCounts = { BUY: 0, SELL: 0 };
        const reasons = [];

        recentTrades.forEach(t => {
            typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
            if (t.type === 'SELL') {
                if (t.pnl < 0) losses++; else wins++;
                totalPnl += t.pnl || 0;
                totalPnlPct += t.pnlPct || 0;
                if (t.reason) reasons.push(t.reason);
            }
        });

        console.log(`Buys: ${typeCounts.BUY}, Sells: ${typeCounts.SELL}`);
        console.log(`Wins: ${wins}, Losses: ${losses}`);
        console.log(`Realized PnL from these sells: $${totalPnl.toFixed(2)} (${totalPnlPct.toFixed(2)}%)`);

        console.log("\nLast 10 trades summary (Reasoning from SELLs):");
        reasons.slice(0, 10).forEach(r => console.log("-", r.replace(/\n/g, ' ')));

    } catch (e) { console.error(e); }
    process.exit(0);
}
main();
