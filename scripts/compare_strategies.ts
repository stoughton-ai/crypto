import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') (process as any).loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const doc = await adminDb.collection('arena_config').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const arena = doc.data();
    if (!arena) { console.error('No arena found'); process.exit(1); }

    const dayNum = Math.floor((Date.now() - new Date(arena.startDate).getTime()) / 86400000) + 1;
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  ARENA: Day ${dayNum}/28  |  Budget: $${arena.totalBudget}`);
    console.log('═══════════════════════════════════════════════════════\n');

    for (const pool of arena.pools) {
        const s = pool.strategy;
        console.log(`${pool.emoji}  ${pool.name} (${pool.poolId}) — ${pool.status}`);
        console.log(`   Tokens:          ${pool.tokens.join(' / ')}`);
        console.log(`   Cash:            $${pool.cashBalance.toFixed(2)} / $${pool.budget}`);

        const holdings = Object.entries(pool.holdings || {});
        if (holdings.length > 0) {
            for (const [k, v] of holdings) {
                const h = v as any;
                console.log(`   Holding:         ${k}  ${h.amount.toFixed(6)} @ $${h.averagePrice.toFixed(6)}  (peak P&L: +${(h.peakPnlPct || 0).toFixed(1)}%)`);
            }
        } else {
            console.log(`   Holdings:        NONE (all cash)`);
        }

        console.log(`   W/L:             ${pool.performance.winCount}W / ${pool.performance.lossCount}L  (${pool.performance.totalTrades} trades)`);
        console.log(`   P&L:             ${pool.performance.totalPnlPct >= 0 ? '+' : ''}${pool.performance.totalPnlPct.toFixed(2)}%`);

        console.log(`\n   ── ENTRY ──`);
        console.log(`   buyScoreThreshold:       ${s.buyScoreThreshold}`);
        console.log(`   buyConfidenceBuffer:     ${s.buyConfidenceBuffer ?? 5}  (effective: ${(s.buyScoreThreshold || 0) + (s.buyConfidenceBuffer ?? 5)})`);
        console.log(`   momentumGate:            ${s.momentumGateEnabled ? `ON (${s.momentumGateThreshold}%)` : 'OFF'}`);
        console.log(`   maxAllocationPerToken:   $${s.maxAllocationPerToken}`);
        console.log(`   positionSizeMultiplier:  ${s.positionSizeMultiplier ?? 0.8}`);

        console.log(`\n   ── EXIT ──`);
        console.log(`   exitThreshold:           ${s.exitThreshold}  (fires at ${(s.exitThreshold || 0) - (s.exitHysteresis ?? 10)} with hysteresis)`);
        console.log(`   takeProfitTarget:        +${s.takeProfitTarget ?? 3}%`);
        console.log(`   trailingStopPct:         ${s.trailingStopPct ?? 2}% from peak`);
        console.log(`   positionStopLoss:        ${s.positionStopLoss}%`);

        console.log(`\n   ── TIMING ──`);
        console.log(`   minHoldMinutes:          ${s.minHoldMinutes ?? 120} min`);
        console.log(`   evaluationCooldown:      ${s.evaluationCooldownMinutes ?? 15} min`);
        console.log(`   antiWashHours:           ${s.antiWashHours}h`);

        console.log(`\n   ── PERSONALITY ──`);
        console.log(`   personality:             ${s.strategyPersonality ?? 'MODERATE'}`);
        console.log(`   description:             ${s.description}`);

        const reviews = pool.weeklyReviews || [];
        if (reviews.length > 0) {
            const last = reviews[reviews.length - 1];
            console.log(`\n   ── LAST REVIEW (week ${last.week}) ──`);
            console.log(`   strategyChanged:         ${last.strategyChanged}`);
            console.log(`   reflection: ${last.aiReflection?.substring(0, 300)}`);
        } else {
            console.log(`\n   No strategy reviews yet.`);
        }

        console.log('\n───────────────────────────────────────────────────────\n');
    }

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
