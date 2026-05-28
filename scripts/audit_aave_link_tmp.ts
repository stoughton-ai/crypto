import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';
if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const TOKENS = ['AAVE', 'LINK'];

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const now = Date.now();

    const arenaSnap = await db.collection('arena_config').doc(userId).get();
    const arena = arenaSnap.data()!;

    for (const pool of (arena.pools || [])) {
        const poolTokens = pool.tokens?.map((t: string) => t.toUpperCase()) || [];
        const matches = TOKENS.filter(tk => poolTokens.includes(tk));
        if (matches.length === 0) continue;

        console.log(`\n${'═'.repeat(63)}`);
        console.log(`  POOL: ${pool.emoji} ${pool.name} [${pool.poolId}] — Status: ${pool.status}`);
        console.log(`  Cash: $${(pool.cashBalance || 0).toFixed(2)} | DCA Reserve: $${(pool.dcaReserve || 0).toFixed(2)}`);
        console.log(`  Tokens in pool: ${pool.tokens.join(', ')}`);
        console.log(`${'═'.repeat(63)}`);

        const s = pool.strategy || {};
        console.log(`\n  ── STRATEGY ─────────────────────────────────────────────`);
        console.log(`  Buy Threshold:       ${s.buyScoreThreshold ?? 'N/A'} + buffer ${s.buyConfidenceBuffer ?? 0} = ${(s.buyScoreThreshold ?? 85) + (s.buyConfidenceBuffer ?? 0)} needed`);
        console.log(`  AntiWash Hours:      ${s.antiWashHours ?? 24}h`);
        console.log(`  StopLoss RE-entry:   ${s.stopLossReentryHours ?? 6}h`);
        console.log(`  Momentum Gate:       ${s.momentumGateEnabled} (min 24h %change: ${s.momentumGateThreshold ?? 'N/A'}%)`);
        console.log(`  MaxAlloc/Token:      $${s.maxAllocationPerToken ?? 'N/A'}`);
        console.log(`  GPM Enabled:         ${s.gpmEnabled !== false}`);
        console.log(`  GPM Caution Zone:    score < ${s.gpmCautionZoneScore ?? 70} → ${s.gpmCautionPositionPct ?? 50}% alloc`);
        console.log(`  GPM Defensive Zone:  score < ${s.gpmDefensiveZoneScore ?? 55} → ${s.gpmDefensivePositionPct ?? 25}% alloc`);
        console.log(`  GPM Confirm Cycles:  ${s.gpmConfirmationCycles ?? 2}`);
        console.log(`  MinHold:             ${s.minHoldMinutes ?? 480}min`);
        console.log(`  Eval Cooldown:       ${s.evaluationCooldownMinutes ?? 15}min`);
        console.log(`  Rebound Entry %:     ${s.reboundEntryPct ?? 1.5}%`);
        console.log(`  Rebound RSI Min:     ${s.reboundRsiMin ?? 35}`);

        for (const TOKEN of matches) {
            console.log(`\n  ${'─'.repeat(59)}`);
            console.log(`  TOKEN: ${TOKEN}`);
            console.log(`  ${'─'.repeat(59)}`);

            // Position
            const holding = pool.holdings?.[TOKEN];
            if (holding && holding.amount > 0) {
                const holdMin = holding.boughtAt ? (now - new Date(holding.boughtAt).getTime()) / (1000 * 60) : null;
                console.log(`\n  POSITION: ✅ HOLDING ${holding.amount.toFixed(6)} ${TOKEN}`);
                console.log(`    Avg Price:   $${(holding.averagePrice || 0).toFixed(4)}`);
                console.log(`    Bought At:   ${holding.boughtAt}`);
                console.log(`    GPM Zone:    ${holding.gpmZone ?? 'N/A'} (${holding.gpmZoneConsecutiveCycles ?? 0} cycles)`);
                if (holdMin !== null) console.log(`    Hold Time:   ${holdMin.toFixed(0)}min (mature@${s.minHoldMinutes ?? 480}min: ${holdMin >= (s.minHoldMinutes ?? 480) ? '✅' : '⏳ NOT YET'})`);
            } else {
                console.log(`\n  POSITION: ❌ NOT HOLDING ${TOKEN}`);
            }

            // Cooldown flags
            const lastSold = pool.lastSoldAt?.[TOKEN];
            const lastStopLossed = pool.lastStopLossedAt?.[TOKEN];
            const stopLossExitPrice = pool.stopLossExitPrices?.[TOKEN];

            console.log(`\n  COOLDOWN STATE:`);
            if (lastSold) {
                const hrs = (now - new Date(lastSold).getTime()) / 3600000;
                console.log(`    lastSoldAt:       ${lastSold} (${hrs.toFixed(1)}h ago)`);
            } else {
                console.log(`    lastSoldAt:       NOT SET`);
            }
            if (lastStopLossed) {
                const hrs = (now - new Date(lastStopLossed).getTime()) / 3600000;
                const slHours = s.stopLossReentryHours ?? 6;
                console.log(`    lastStopLossedAt: ${lastStopLossed} (${hrs.toFixed(1)}h ago)`);
                console.log(`    SL re-entry gate: ${hrs < slHours ? `🔴 BLOCKED — ${(slHours - hrs).toFixed(1)}h remaining` : '✅ CLEARED'}`);
            } else {
                console.log(`    lastStopLossedAt: NOT SET`);
            }
            if (stopLossExitPrice) {
                console.log(`    stopLossExitPrice: $${stopLossExitPrice.toFixed(4)}`);
            } else {
                console.log(`    stopLossExitPrice: NOT SET`);
            }

            // Determine effective cooldown
            const isLastSellStopLoss = !!lastStopLossed && (
                !lastSold || new Date(lastStopLossed).getTime() >= new Date(lastSold).getTime()
            );
            const cooldownHours = isLastSellStopLoss ? (s.stopLossReentryHours ?? 6) : s.antiWashHours;
            const relevantTs = isLastSellStopLoss ? lastStopLossed : lastSold;

            console.log(`\n  BUY GATE ANALYSIS (fresh buy — not holding):`);
            if (holding && holding.amount > 0) {
                console.log(`    Token is HELD — buy path is GPM SCALE-UP, not fresh buy`);
            } else {
                const buyThresh = (s.buyScoreThreshold ?? 85) + (s.buyConfidenceBuffer ?? 0);
                if (relevantTs && cooldownHours > 0) {
                    const hrs = (now - new Date(relevantTs).getTime()) / 3600000;
                    const blocked = hrs < cooldownHours;
                    console.log(`    Cooldown Type:   ${isLastSellStopLoss ? 'STOP-LOSS RE-ENTRY' : 'ANTI-WASH'}`);
                    console.log(`    Cooldown Period: ${cooldownHours}h | Elapsed: ${hrs.toFixed(1)}h`);
                    if (blocked) {
                        console.log(`    Gate 1 (cooldown): 🔴 BLOCKED — ${(cooldownHours - hrs).toFixed(1)}h remaining`);
                    } else {
                        console.log(`    Gate 1 (cooldown): ✅ CLEARED`);
                        console.log(`    Gate 2 (score):    Need smoothed score ≥ ${buyThresh}`);

                        // Also check momentum gate
                        if (s.momentumGateEnabled) {
                            console.log(`    Gate 3 (momentum): Need 24h price change ≥ ${s.momentumGateThreshold ?? 1.5}%`);
                        }
                    }
                } else {
                    console.log(`    Gate 1 (cooldown): ✅ NO COOLDOWN SET`);
                    console.log(`    Gate 2 (score):    Need smoothed score ≥ ${buyThresh}`);
                    if (s.momentumGateEnabled) {
                        console.log(`    Gate 3 (momentum): Need 24h price change ≥ ${s.momentumGateThreshold ?? 1.5}%`);
                    }
                }
            }

            // Phase C (Rebound Watch) — only if stop-lossed and not holding
            if (lastStopLossed && (!holding || holding.amount === 0)) {
                const hrs = (now - new Date(lastStopLossed).getTime()) / 3600000;
                const slHours = s.stopLossReentryHours ?? 6;
                console.log(`\n  PHASE C (REBOUND WATCH):`);
                console.log(`    Cooldown gate:     ${hrs < slHours ? `🔴 ${(slHours - hrs).toFixed(1)}h remaining` : '✅ CLEARED'}`);
                if (stopLossExitPrice) {
                    console.log(`    Exit Price:        $${stopLossExitPrice.toFixed(4)}`);
                    console.log(`    Recovery needed:   +${s.reboundEntryPct ?? 1.5}% above $${stopLossExitPrice.toFixed(4)} = $${(stopLossExitPrice * (1 + (s.reboundEntryPct ?? 1.5) / 100)).toFixed(4)}`);
                    console.log(`    RSI floor:         RSI(14) ≥ ${s.reboundRsiMin ?? 35}`);
                }
            }

            // Score history
            console.log(`\n  SCORE HISTORY (${TOKEN}):`);
            const scoreHistory = pool.scoreHistory?.[TOKEN] || [];
            if (scoreHistory.length === 0) {
                console.log(`    No scores recorded.`);
            } else {
                const recent = scoreHistory.slice(-10);
                recent.forEach((e: any) => {
                    const ageMin = (now - new Date(e.ts).getTime()) / 60000;
                    console.log(`    ${e.ts?.substring(0, 19)} | Score: ${String(e.score).padStart(3)} | ${ageMin < 90 ? `${ageMin.toFixed(0)}min ago` : `${(ageMin / 60).toFixed(1)}h ago`}`);
                });
                const last3 = recent.slice(-3).map((e: any) => e.score);
                const smoothed = Math.round(last3.reduce((a: number, b: number) => a + b, 0) / last3.length);
                const buyThresh = (s.buyScoreThreshold ?? 85) + (s.buyConfidenceBuffer ?? 0);
                const isRising = last3.length >= 2 && last3.every((v: number, i: number) => i === 0 || v > last3[i - 1]);
                console.log(`\n    Smoothed (last 3): ${smoothed} | Trend: ${isRising ? '📈 RISING' : '➡️ flat/mixed'}`);
                console.log(`    Buy score gate:    ${smoothed >= buyThresh ? `✅ PASSES (${smoothed} ≥ ${buyThresh})` : `🔴 FAILS (${smoothed} vs ${buyThresh} needed)`}`);
            }

            // Eval cooldown
            console.log(`\n  EVAL COOLDOWN:`);
            const lastEval = pool.lastEvaluatedAt?.[TOKEN];
            if (lastEval) {
                const minSince = (now - new Date(lastEval).getTime()) / 60000;
                const evalCd = s.evaluationCooldownMinutes ?? 15;
                console.log(`    Last Eval:   ${lastEval} (${minSince.toFixed(1)}min ago)`);
                console.log(`    Cooldown:    ${evalCd}min — ${minSince < evalCd ? `🔴 IN COOLDOWN (${(evalCd - minSince).toFixed(1)}min left, next eval ~${new Date(new Date(lastEval).getTime() + evalCd * 60000).toISOString().substring(11, 16)} UTC)` : '✅ READY FOR EVAL'}`);
            } else {
                console.log(`    Never evaluated in this pool.`);
            }

            // Ticker intel
            const intelDoc = await db.collection('ticker_intel').doc(`${userId}_${TOKEN}`).get();
            if (intelDoc.exists) {
                const intel = intelDoc.data()!;
                console.log(`\n  TICKER INTEL (agent scoring system):`);
                console.log(`    Price:   $${(intel.currentPrice || 0).toFixed(2)}`);
                console.log(`    24h chg: ${(intel.change24h || 0).toFixed(2)}%`);
                console.log(`    Score:   ${intel.overallScore ?? 'N/A'}`);
                console.log(`    Light:   ${intel.trafficLight ?? 'N/A'}`);
                console.log(`    Updated: ${intel.lastUpdated ?? 'N/A'}`);
            }
        }
    }

    console.log(`\n${'═'.repeat(63)}\n  COMPLETE\n${'═'.repeat(63)}\n`);
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
