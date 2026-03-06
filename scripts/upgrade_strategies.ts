import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

/**
 * Update pool strategies with aggressive profit-taking parameters.
 * 
 * New fields per pool:
 *  - takeProfitTarget: auto-sell at this % gain
 *  - trailingStopPct: sell if drops this % from peak
 *  - minWinPct: minimum % to count as a "win"
 *  - Tighter exitThresholds to make AI sell more decisively
 */
async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const doc = await adminDb.collection('arena_config').doc(userId).get();
    const arena = doc.data();
    if (!arena?.pools) { console.error('No arena'); process.exit(1); }

    const upgrades: Record<string, any> = {
        'POOL_1': { // Momentum Mavericks — fast momentum, tight targets
            takeProfitTarget: 3,      // Take profit at +3%
            trailingStopPct: 1.5,     // Trail by 1.5% from peak
            minWinPct: 0.5,           // Must make at least 0.5% to be a "win"
            exitThreshold: 55,        // Tightened from 60 → 55 (AI can exit more easily)
        },
        'POOL_2': { // Deep Divers — fundamentals, patient but not passive
            takeProfitTarget: 5,      // Take profit at +5%
            trailingStopPct: 2,       // Trail by 2% from peak
            minWinPct: 0.5,
            exitThreshold: 50,        // Tightened from 45 → 50 (was way too sticky)
        },
        'POOL_3': { // Steady Sailers — longer holds, bigger targets
            takeProfitTarget: 8,      // Take profit at +8%
            trailingStopPct: 3,       // Trail by 3% from peak
            minWinPct: 0.5,
            exitThreshold: 50,        // Tightened from 55 → 50
        },
        'POOL_4': { // Agile Arbitrageurs — rapid in/out, tiny targets
            takeProfitTarget: 2,      // Take profit at +2% (fast scalps)
            trailingStopPct: 1,       // Trail by 1% from peak
            minWinPct: 0.3,           // Even 0.3% counts for scalpers
            exitThreshold: 65,        // Tightened from 70 → 65
        },
    };

    for (const pool of arena.pools) {
        const upgrade = upgrades[pool.poolId];
        if (upgrade) {
            const oldExit = pool.strategy.exitThreshold;
            pool.strategy.takeProfitTarget = upgrade.takeProfitTarget;
            pool.strategy.trailingStopPct = upgrade.trailingStopPct;
            pool.strategy.minWinPct = upgrade.minWinPct;
            pool.strategy.exitThreshold = upgrade.exitThreshold;

            // Also initialize peakPnlPct on existing holdings
            for (const [ticker, holding] of Object.entries(pool.holdings)) {
                const h = holding as any;
                if (!h.peakPnlPct) h.peakPnlPct = 0;
            }

            console.log(`${pool.emoji} ${pool.name}:`);
            console.log(`  Take Profit: +${upgrade.takeProfitTarget}%`);
            console.log(`  Trailing Stop: ${upgrade.trailingStopPct}%`);
            console.log(`  Min Win: ${upgrade.minWinPct}%`);
            console.log(`  Exit Threshold: ${oldExit} → ${upgrade.exitThreshold}`);
        }
    }

    await adminDb.collection('arena_config').doc(userId).set(arena);
    console.log('\n✅ All pool strategies upgraded with profit-taking parameters.');
    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
