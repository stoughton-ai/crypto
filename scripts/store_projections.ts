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

    const startDate = new Date(arena.startDate);
    const endDate = new Date(startDate.getTime() + 28 * 24 * 60 * 60 * 1000);
    const totalBudget = arena.totalBudget; // $600

    // Model each pool's expected performance
    const poolProjections = arena.pools.map((pool: any) => {
        const tp = pool.strategy.takeProfitTarget || 3;
        const sl = pool.strategy.positionStopLoss || -8;
        const trail = pool.strategy.trailingStopPct || 2;
        const budget = pool.budget;

        // Expected avg loss is better than raw SL due to trailing stops + AI exits
        // AI exits and trailing stops catch ~60% of losses before full SL
        const avgLoss = sl * 0.5; // Avg loss is about half the stop-loss (AI exits + trailing stops)

        // Expected trades/day by pool type
        let tradesPerDay: number;
        let winRate: number;

        switch (pool.poolId) {
            case 'POOL_1': // Momentum — moderate frequency 
                tradesPerDay = 1.5; // Buying/selling ICP and RENDER
                winRate = 0.55; // Momentum has slight edge
                break;
            case 'POOL_2': // Deep Divers — less frequent
                tradesPerDay = 0.8;
                winRate = 0.52; // Fundamentals = less predictable short-term
                break;
            case 'POOL_3': // Steady Sailers — infrequent
                tradesPerDay = 0.5;
                winRate = 0.50; // Long holds, less data
                break;
            case 'POOL_4': // Agile — high frequency
                tradesPerDay = 3.0;
                winRate = 0.58; // Meme coins more volatile = more opportunity
                break;
            default:
                tradesPerDay = 1;
                winRate = 0.50;
        }

        // Expected return per round-trip trade
        const expectedReturnPerTrade = (winRate * tp) + ((1 - winRate) * avgLoss);

        // Avg position size (~50% of available capital)
        const avgPositionSize = budget * 0.4;

        // Remaining days
        const remainingDays = 27;

        // Expected round-trips (not all cycles produce trades)
        const totalRoundTrips = tradesPerDay * remainingDays;

        // Projected profit = sum of individual trade returns
        // Compounding effect is small at these %s
        const projectedProfit = totalRoundTrips * (expectedReturnPerTrade / 100) * avgPositionSize;

        // Scenario modelling
        const scenarios = {
            pessimistic: budget + (projectedProfit * 0.3), // Everything goes worse than expected
            conservative: budget + (projectedProfit * 0.6), // Below expectations
            base: budget + projectedProfit,                  // As expected
            optimistic: budget + (projectedProfit * 1.5),    // Better than expected
            stretch: budget + (projectedProfit * 2.0),       // Everything clicks
        };

        return {
            poolId: pool.poolId,
            poolName: pool.name,
            emoji: pool.emoji,
            budget,
            tp,
            sl,
            avgLoss,
            tradesPerDay,
            winRate,
            expectedReturnPerTrade,
            avgPositionSize,
            totalRoundTrips,
            projectedProfit,
            scenarios,
        };
    });

    // Aggregate totals
    const totalScenarios = {
        pessimistic: poolProjections.reduce((s: number, p: any) => s + p.scenarios.pessimistic, 0),
        conservative: poolProjections.reduce((s: number, p: any) => s + p.scenarios.conservative, 0),
        base: poolProjections.reduce((s: number, p: any) => s + p.scenarios.base, 0),
        optimistic: poolProjections.reduce((s: number, p: any) => s + p.scenarios.optimistic, 0),
        stretch: poolProjections.reduce((s: number, p: any) => s + p.scenarios.stretch, 0),
    };

    // Print report
    console.log('═══ 28-DAY TARGET VALUE PROJECTIONS ═══');
    console.log(`Start: ${startDate.toLocaleDateString('en-GB')} | End: ${endDate.toLocaleDateString('en-GB')}`);
    console.log(`Budget: $${totalBudget}`);
    console.log('');

    for (const p of poolProjections) {
        console.log(`${p.emoji} ${p.poolName}`);
        console.log(`  TP: +${p.tp}% | SL: ${p.sl}% | Avg Loss (with trail/AI): ${p.avgLoss.toFixed(1)}%`);
        console.log(`  Trades/Day: ${p.tradesPerDay} | Win Rate: ${(p.winRate * 100).toFixed(0)}%`);
        console.log(`  Expected per trade: ${p.expectedReturnPerTrade >= 0 ? '+' : ''}${p.expectedReturnPerTrade.toFixed(2)}%`);
        console.log(`  Est. round-trips: ${p.totalRoundTrips.toFixed(0)} over 27 days`);
        console.log(`  Projected profit: $${p.projectedProfit.toFixed(2)}`);
        console.log(`  Scenarios: Pessimistic $${p.scenarios.pessimistic.toFixed(2)} | Conservative $${p.scenarios.conservative.toFixed(2)} | Base $${p.scenarios.base.toFixed(2)} | Optimistic $${p.scenarios.optimistic.toFixed(2)} | Stretch $${p.scenarios.stretch.toFixed(2)}`);
        console.log('');
    }

    console.log('═══ AGGREGATE TARGETS ═══');
    console.log(`  Pessimistic:  $${totalScenarios.pessimistic.toFixed(2)} (${((totalScenarios.pessimistic / totalBudget - 1) * 100).toFixed(1)}%)`);
    console.log(`  Conservative: $${totalScenarios.conservative.toFixed(2)} (${((totalScenarios.conservative / totalBudget - 1) * 100).toFixed(1)}%)`);
    console.log(`  BASE TARGET:  $${totalScenarios.base.toFixed(2)} (${((totalScenarios.base / totalBudget - 1) * 100).toFixed(1)}%)`);
    console.log(`  Optimistic:   $${totalScenarios.optimistic.toFixed(2)} (${((totalScenarios.optimistic / totalBudget - 1) * 100).toFixed(1)}%)`);
    console.log(`  Stretch:      $${totalScenarios.stretch.toFixed(2)} (${((totalScenarios.stretch / totalBudget - 1) * 100).toFixed(1)}%)`);

    // Store in Firestore
    const projection = {
        createdAt: new Date().toISOString(),
        startDate: arena.startDate,
        endDate: endDate.toISOString(),
        totalBudget,
        poolProjections: poolProjections.map((p: any) => ({
            poolId: p.poolId,
            poolName: p.poolName,
            emoji: p.emoji,
            budget: p.budget,
            takeProfitTarget: p.tp,
            stopLoss: p.sl,
            avgLoss: p.avgLoss,
            tradesPerDay: p.tradesPerDay,
            winRate: p.winRate,
            expectedReturnPerTrade: p.expectedReturnPerTrade,
            totalRoundTrips: p.totalRoundTrips,
            projectedProfit: p.projectedProfit,
            scenarios: p.scenarios,
        })),
        aggregateTargets: totalScenarios,
        baseTarget: totalScenarios.base,
        baseTargetPct: ((totalScenarios.base / totalBudget - 1) * 100),
    };

    await adminDb.collection('arena_projections').doc(userId).set(projection);
    console.log('\n✅ Projections stored in Firestore (arena_projections collection)');

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
