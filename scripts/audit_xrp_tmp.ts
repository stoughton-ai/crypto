import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const TOKEN = 'XRP';

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  XRP ARENA AUDIT');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Fetch arena config
    const arenaSnap = await db.collection('arena_config').doc(userId).get();
    if (!arenaSnap.exists) {
        console.log('❌ No arena_config found for user!');
        process.exit(1);
    }
    const arena = arenaSnap.data()!;

    console.log(`Arena initialized: ${arena.initialized}`);
    console.log(`Total Budget: $${arena.totalBudget}`);
    console.log(`Competition Active: ${arena.competitionActive}`);
    console.log(`Start Date: ${arena.startDate}`);
    console.log(`Pools: ${arena.pools?.length ?? 0}\n`);

    const now = Date.now();

    for (const pool of (arena.pools || [])) {
        const hasXRP = pool.tokens?.map((t: string) => t.toUpperCase()).includes(TOKEN);
        if (!hasXRP) continue;

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`  POOL: ${pool.emoji} ${pool.name} [${pool.poolId}]`);
        console.log(`  Status: ${pool.status}`);
        console.log(`  Cash Balance: $${(pool.cashBalance || 0).toFixed(2)}`);
        console.log(`  DCA Reserve: $${(pool.dcaReserve || 0).toFixed(2)}`);
        console.log(`  Tokens: ${pool.tokens?.join(', ')}`);
        console.log('');

        // Strategy details
        const s = pool.strategy || {};
        console.log('  ── STRATEGY ────────────────────────────────────────────');
        console.log(`  Buy Threshold:       ${s.buyScoreThreshold ?? 'N/A'} + buffer ${s.buyConfidenceBuffer ?? 0}`);
        console.log(`  AntiWash Hours:      ${s.antiWashHours ?? 'N/A'}h`);
        console.log(`  StopLoss RE-entry:   ${s.stopLossReentryHours ?? 6}h`);
        console.log(`  GPM Enabled:         ${s.gpmEnabled !== false}`);
        console.log(`  GPM Caution Zone:    < ${s.gpmCautionZoneScore ?? 70} (→ ${s.gpmCautionPositionPct ?? 50}% alloc)`);
        console.log(`  GPM Defensive Zone:  < ${s.gpmDefensiveZoneScore ?? 55} (→ ${s.gpmDefensivePositionPct ?? 25}% alloc)`);
        console.log(`  GPM Confirm Cycles:  ${s.gpmConfirmationCycles ?? 2}`);
        console.log(`  Max Alloc/Token:     $${s.maxAllocationPerToken ?? 'N/A'}`);
        console.log(`  MinHold Minutes:     ${s.minHoldMinutes ?? 120}`);
        console.log(`  Eval Cooldown:       ${s.evaluationCooldownMinutes ?? 15}min`);
        console.log(`  Momentum Gate:       ${s.momentumGateEnabled} (threshold: ${s.momentumGateThreshold ?? 'N/A'}%)`);
        console.log(`  Take Profit:         +${s.takeProfitTarget ?? 'N/A'}%`);
        console.log(`  Stop Loss:           ${s.positionStopLoss ?? 'N/A'}%`);
        console.log(`  Trailing Stop:       ${s.trailingStopPct ?? 'N/A'}%`);
        console.log('');

        // XRP-specific state
        console.log('  ── XRP POSITION STATE ───────────────────────────────────');
        const holding = pool.holdings?.[TOKEN];
        if (holding && holding.amount > 0) {
            console.log(`  ✅ HOLDING: ${holding.amount.toFixed(6)} XRP`);
            console.log(`     Avg Price:   $${(holding.averagePrice || 0).toFixed(4)}`);
            console.log(`     Bought At:   ${holding.boughtAt || 'unknown'}`);
            console.log(`     Peak PnL:    +${(holding.peakPnlPct || 0).toFixed(2)}%`);
            console.log(`     GPM Zone:    ${holding.gpmZone ?? 'N/A'}`);
            console.log(`     GPM Cycles:  ${holding.gpmZoneConsecutiveCycles ?? 'N/A'}`);
            if (holding.boughtAt) {
                const holdMin = (now - new Date(holding.boughtAt).getTime()) / (1000 * 60);
                console.log(`     Hold Time:   ${holdMin.toFixed(0)}min (min: ${s.minHoldMinutes ?? 120}min, mature: ${holdMin >= (s.minHoldMinutes ?? 120)})`);
            }
        } else {
            console.log(`  ❌ NOT HOLDING XRP`);
        }
        console.log('');

        // Anti-wash / cooldown state
        console.log('  ── COOLDOWN STATE (XRP) ─────────────────────────────────');
        const lastSold = pool.lastSoldAt?.[TOKEN];
        const lastStopLossed = pool.lastStopLossedAt?.[TOKEN];
        const stopLossExitPrice = pool.stopLossExitPrices?.[TOKEN];

        if (lastSold) {
            const hrsSinceSold = (now - new Date(lastSold).getTime()) / (1000 * 60 * 60);
            console.log(`  lastSoldAt:          ${lastSold} (${hrsSinceSold.toFixed(1)}h ago)`);
        } else {
            console.log(`  lastSoldAt:          NOT SET`);
        }

        if (lastStopLossed) {
            const hrsSinceSL = (now - new Date(lastStopLossed).getTime()) / (1000 * 60 * 60);
            const slReentryHours = s.stopLossReentryHours ?? 6;
            const blocked = hrsSinceSL < slReentryHours;
            console.log(`  lastStopLossedAt:    ${lastStopLossed} (${hrsSinceSL.toFixed(1)}h ago)`);
            console.log(`  SL Re-entry Hours:   ${slReentryHours}h — Currently ${blocked ? `🔴 BLOCKED (need ${(slReentryHours - hrsSinceSL).toFixed(1)}h more)` : '✅ CLEARED'}`);
        } else {
            console.log(`  lastStopLossedAt:    NOT SET`);
        }

        if (stopLossExitPrice) {
            console.log(`  stopLossExitPrice:   $${stopLossExitPrice.toFixed(4)}`);
        } else {
            console.log(`  stopLossExitPrice:   NOT SET`);
        }
        console.log('');

        // Determine which cooldown would apply
        const isLastSellStopLoss = !!lastStopLossed && (
            !lastSold || new Date(lastStopLossed).getTime() >= new Date(lastSold).getTime()
        );
        const cooldownHours = isLastSellStopLoss
            ? (s.stopLossReentryHours ?? 6)
            : s.antiWashHours;
        const relevantTimestamp = isLastSellStopLoss ? lastStopLossed : lastSold;

        console.log('  ── BUY ELIGIBILITY ANALYSIS ─────────────────────────────');
        if (holding && holding.amount > 0) {
            console.log(`  Currently holding XRP — buy path is GPM SCALE-UP, not fresh buy`);
            const holdingValueUsd = 0; // we can't compute without live price here, approximate
            const maxAlloc = s.maxAllocationPerToken ?? 0;
            console.log(`  Max Alloc: $${maxAlloc}. Cash: $${(pool.cashBalance || 0).toFixed(2)}`);
            console.log(`  GPM scale-up requires: holdingValueUsd < maxAlloc AND cashBalance >= $10`);
        } else {
            // Not holding — check cooldown
            if (relevantTimestamp && cooldownHours > 0) {
                const hrsSince = (now - new Date(relevantTimestamp).getTime()) / (1000 * 60 * 60);
                const blocked = hrsSince < cooldownHours;
                console.log(`  Cooldown type: ${isLastSellStopLoss ? 'STOP-LOSS RE-ENTRY' : 'ANTI-WASH'}`);
                console.log(`  Cooldown period: ${cooldownHours}h | Elapsed: ${hrsSince.toFixed(1)}h`);
                console.log(`  Buy eligibility: ${blocked ? `🔴 BLOCKED — need ${(cooldownHours - hrsSince).toFixed(1)}h more` : '✅ CLEARED'}`);
            } else if (!relevantTimestamp) {
                console.log(`  No cooldown flags set. Buy eligibility: ✅ OPEN (score-gated only)`);
            }
        }
        console.log('');

        // Score history
        console.log('  ── SCORE HISTORY (XRP) ──────────────────────────────────');
        const scoreHistory = pool.scoreHistory?.[TOKEN] || [];
        if (scoreHistory.length === 0) {
            console.log('  No score history recorded.');
        } else {
            const recent = scoreHistory.slice(-10);
            recent.forEach((e: any) => {
                const ageMin = (now - new Date(e.ts).getTime()) / (1000 * 60);
                console.log(`  ${e.ts?.substring(0, 19)} | Score: ${e.score} | ${ageMin < 60 ? `${ageMin.toFixed(0)}min ago` : `${(ageMin / 60).toFixed(1)}h ago`}`);
            });
            // Compute smoothed
            const last3 = recent.slice(-3).map((e: any) => e.score);
            const smoothed = Math.round(last3.reduce((a: number, b: number) => a + b, 0) / last3.length);
            const buyThresh = (s.buyScoreThreshold ?? 85) + (s.buyConfidenceBuffer ?? 0);
            console.log(`\n  Smoothed Score (last 3): ${smoothed} | Buy threshold: ${buyThresh}`);
            console.log(`  Score gate: ${smoothed >= buyThresh ? '✅ PASSES' : `🔴 FAILS (need ${buyThresh}, have ${smoothed})`}`);
        }
        console.log('');

        // Evaluation cooldown
        console.log('  ── EVALUATION COOLDOWN (XRP) ────────────────────────────');
        const lastEval = pool.lastEvaluatedAt?.[TOKEN];
        if (lastEval) {
            const minSinceEval = (now - new Date(lastEval).getTime()) / (1000 * 60);
            const evalCooldown = s.evaluationCooldownMinutes ?? 15;
            const evalBlocked = minSinceEval < evalCooldown;
            console.log(`  Last Evaluated: ${lastEval} (${minSinceEval.toFixed(1)}min ago)`);
            console.log(`  Eval Cooldown:  ${evalCooldown}min — ${evalBlocked ? `🔴 IN COOLDOWN (${(evalCooldown - minSinceEval).toFixed(1)}min remaining)` : '✅ READY'}`);
        } else {
            console.log(`  Not yet evaluated in this pool.`);
        }
        console.log('');

        // Recent trades for XRP in this pool
        console.log('  ── RECENT XRP ARENA TRADES ──────────────────────────────');
        const tradesSnap = await db.collection('arena_trades')
            .where('userId', '==', userId)
            .where('poolId', '==', pool.poolId)
            .where('ticker', '==', TOKEN)
            .orderBy('date', 'desc')
            .limit(10)
            .get();

        if (tradesSnap.empty) {
            console.log('  No XRP arena trades found for this pool.');
        } else {
            for (const doc of tradesSnap.docs) {
                const t = doc.data();
                const pnlStr = t.pnl !== undefined ? ` | PnL: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} (${t.pnlPct?.toFixed(2)}%)` : '';
                console.log(`  ${t.date?.substring(0, 19)} | ${t.type?.padEnd(4)} @ $${(t.price || 0).toFixed(4)} | $${(t.total || 0).toFixed(2)}${pnlStr}`);
                if (t.reason) console.log(`    → ${t.reason?.substring(0, 120)}`);
            }
        }
        console.log('');

        // Pool performance
        console.log('  ── POOL PERFORMANCE ─────────────────────────────────────');
        const perf = pool.performance || {};
        console.log(`  Total PnL%:   ${(perf.totalPnlPct || 0).toFixed(2)}%`);
        console.log(`  Wins:         ${perf.winCount || 0}`);
        console.log(`  Losses:       ${perf.lossCount || 0}`);
        console.log(`  Total Trades: ${perf.totalTrades || 0}`);
    }

    // Also check ticker_intel for XRP
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  XRP TICKER INTEL');
    console.log('═══════════════════════════════════════════════════════════\n');

    const intelDoc = await db.collection('ticker_intel').doc(`${userId}_${TOKEN}`).get();
    if (intelDoc.exists) {
        const intel = intelDoc.data()!;
        console.log(`  Current Price:   $${intel.currentPrice?.toFixed(4) ?? 'N/A'}`);
        console.log(`  24h Change:      ${intel.change24h?.toFixed(2) ?? 'N/A'}%`);
        console.log(`  Overall Score:   ${intel.overallScore ?? 'N/A'}`);
        console.log(`  Traffic Light:   ${intel.trafficLight ?? 'N/A'}`);
        console.log(`  Last Updated:    ${intel.lastUpdated ?? 'N/A'}`);
        console.log(`  Recommendation:  ${intel.recommendation ?? 'N/A'}`);
        if (intel.summary) console.log(`  Summary:         ${intel.summary?.substring(0, 200)}`);
    } else {
        console.log('  No ticker_intel document found for XRP.');
    }

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  AUDIT COMPLETE');
    console.log('══════════════════════════════════════════════════════════════\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
