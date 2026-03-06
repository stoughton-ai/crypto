/**
 * IMMEDIATE GUARDRAIL REMEDIATION
 * 
 * The four arena pools have non-compliant strategies in Firestore because the
 * guardrail enforcement ran AFTER the Firestore write on Day 1 reviews.
 * This script clamps all pool strategies to the Patience Regime minimums NOW.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

// ── Hard minimums — identical to the guardrails now in actions.ts ──
function enforceGuardrails(strategy: any, poolId: string): { strategy: any; changes: string[] } {
    const changes: string[] = [];
    const s = { ...strategy };

    if ((s.buyScoreThreshold ?? 0) < 85) {
        changes.push(`buyScoreThreshold: ${s.buyScoreThreshold} → 85`);
        s.buyScoreThreshold = 85;
    }
    if (s.buyScoreThreshold - s.exitThreshold < 25) {
        const newExit = Math.max(20, s.buyScoreThreshold - 25);
        changes.push(`exitThreshold: ${s.exitThreshold} → ${newExit} (25pt gap enforced)`);
        s.exitThreshold = newExit;
    }
    if ((s.antiWashHours ?? 0) < 24) {
        changes.push(`antiWashHours: ${s.antiWashHours} → 24`);
        s.antiWashHours = 24;
    }
    if ((s.takeProfitTarget ?? 0) < 8) {
        changes.push(`takeProfitTarget: ${s.takeProfitTarget} → 8`);
        s.takeProfitTarget = 8;
    }
    if ((s.positionStopLoss ?? 0) > -8) {
        changes.push(`positionStopLoss: ${s.positionStopLoss} → -8`);
        s.positionStopLoss = -8;
    }
    const clampedHold = Math.max(360, Math.min(480, s.minHoldMinutes ?? 360));
    if (clampedHold !== s.minHoldMinutes) {
        changes.push(`minHoldMinutes: ${s.minHoldMinutes} → ${clampedHold}`);
        s.minHoldMinutes = clampedHold;
    }
    const clampedCooldown = Math.max(30, Math.min(60, s.evaluationCooldownMinutes ?? 60));
    if (clampedCooldown !== s.evaluationCooldownMinutes) {
        changes.push(`evaluationCooldownMinutes: ${s.evaluationCooldownMinutes} → ${clampedCooldown}`);
        s.evaluationCooldownMinutes = clampedCooldown;
    }
    const clampedBuffer = Math.max(3, Math.min(15, s.buyConfidenceBuffer ?? 5));
    if (clampedBuffer !== s.buyConfidenceBuffer) {
        changes.push(`buyConfidenceBuffer: ${s.buyConfidenceBuffer} → ${clampedBuffer}`);
        s.buyConfidenceBuffer = clampedBuffer;
    }
    const clampedHyst = Math.max(5, Math.min(20, s.exitHysteresis ?? 10));
    if (clampedHyst !== s.exitHysteresis) {
        changes.push(`exitHysteresis: ${s.exitHysteresis} → ${clampedHyst}`);
        s.exitHysteresis = clampedHyst;
    }
    if (s.positionSizeMultiplier !== 1.0) {
        changes.push(`positionSizeMultiplier: ${s.positionSizeMultiplier} → 1.0`);
        s.positionSizeMultiplier = 1.0;
    }
    if (s.strategyPersonality !== 'PATIENT') {
        changes.push(`strategyPersonality: ${s.strategyPersonality} → PATIENT`);
        s.strategyPersonality = 'PATIENT';
    }

    return { strategy: s, changes };
}

async function run() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  GUARDRAIL REMEDIATION — Patience Not Activity Regime');
    console.log('  ' + new Date().toISOString());
    console.log('═══════════════════════════════════════════════════════\n');

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const docRef = db.collection('arena_config').doc(userId);
    const doc = await docRef.get();
    const arena = doc.data();
    if (!arena) { console.error('❌ No arena found'); process.exit(1); }

    let totalChanges = 0;

    for (const pool of arena.pools) {
        console.log(`\n${pool.emoji}  ${pool.name} (${pool.poolId})`);

        const before = pool.strategy;
        const { strategy: after, changes } = enforceGuardrails(before, pool.poolId);

        if (changes.length === 0) {
            console.log('   ✅ Already compliant — no changes needed.');
        } else {
            console.log(`   ⚠️  ${changes.length} violation(s) corrected:`);
            for (const c of changes) {
                console.log(`      • ${c}`);
            }
            pool.strategy = after;

            // Log this correction in strategyHistory
            if (!pool.strategyHistory) pool.strategyHistory = [];
            pool.strategyHistory.push({
                week: 1,
                previousStrategy: before,
                newStrategy: after,
                reasoning: `GUARDRAIL REMEDIATION (2026-03-05): Day 1 AI strategy review wrote non-compliant values to Firestore before guardrails were applied. Corrected ${changes.length} parameter(s): ${changes.join('; ')}`,
                changedAt: new Date().toISOString(),
            });

            totalChanges += changes.length;
        }

        // Show final state
        const s = pool.strategy;
        console.log(`\n   Final strategy:`);
        console.log(`     Buy threshold:   ${s.buyScoreThreshold} + ${s.buyConfidenceBuffer} buffer = ${s.buyScoreThreshold + s.buyConfidenceBuffer} effective`);
        console.log(`     Exit threshold:  ${s.exitThreshold} (-${s.exitHysteresis} hyst = fires at ${s.exitThreshold - s.exitHysteresis})`);
        console.log(`     Take-profit:     +${s.takeProfitTarget}%`);
        console.log(`     Stop-loss:       ${s.positionStopLoss}%`);
        console.log(`     Anti-wash:       ${s.antiWashHours}h`);
        console.log(`     Min hold:        ${s.minHoldMinutes} min`);
        console.log(`     Eval cooldown:   ${s.evaluationCooldownMinutes} min`);
        console.log(`     Personality:     ${s.strategyPersonality}`);
    }

    if (totalChanges > 0) {
        await docRef.set(arena);
        console.log(`\n\n✅ Firestore updated — ${totalChanges} total parameter(s) corrected across all pools.`);
    } else {
        console.log('\n\n✅ All pools already compliant. No Firestore write needed.');
    }

    console.log('\n═══════════════════════════════════════════════════════\n');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
