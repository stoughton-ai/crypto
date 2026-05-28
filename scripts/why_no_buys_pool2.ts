/**
 * Why hasn't Deep Divers (POOL_2) bought anything?
 * Shows:
 *   - Pool 2's strategy config (buyScoreThreshold, tokens, etc.)
 *   - All trades ever for Pool 2
 *   - Score history for AAVE and LINK
 *   - Pool 2's status in Firestore
 *   - Recent decisions mentioning AAVE or LINK
 *
 * Run: npx tsx scripts/why_no_buys_pool2.ts
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
const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

function sep(n = 72) { return '═'.repeat(n); }

async function main() {
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data()!;
    const pool2 = arena.pools.find((p: any) => p.poolId === 'POOL_2') as any;

    console.log('\n' + sep());
    console.log('  WHY HAS DEEP DIVERS (POOL_2) NEVER BOUGHT?');
    console.log(sep());

    // ── 1. Pool config ────────────────────────────────────────────────────
    console.log('\n📋 POOL CONFIG:');
    console.log(`  Status         : ${pool2.status}`);
    console.log(`  Tokens         : ${pool2.tokens.join(', ')}`);
    console.log(`  cashBalance    : $${(pool2.cashBalance ?? 0).toFixed(2)}`);
    console.log(`  dcaReserve     : $${(pool2.dcaReserve ?? 0).toFixed(2)}`);
    console.log(`  freeCash       : $${Math.max(0, (pool2.cashBalance ?? 0) - (pool2.dcaReserve ?? 0)).toFixed(2)}`);
    console.log(`  pauseReason    : ${pool2.pauseReason ?? '(none)'}`);

    const s = pool2.strategy;
    console.log('\n🎯 STRATEGY:');
    console.log(`  buyScoreThreshold      : ${s.buyScoreThreshold}`);
    console.log(`  buyConfidenceBuffer    : ${s.buyConfidenceBuffer ?? 5}`);
    console.log(`  Effective buy trigger  : ${(s.buyScoreThreshold ?? 0) + (s.buyConfidenceBuffer ?? 5)} (threshold + buffer)`);
    console.log(`  exitThreshold         : ${s.exitThreshold}`);
    console.log(`  maxAllocationPerToken : $${s.maxAllocationPerToken}`);
    console.log(`  minOrderAmount        : $${s.minOrderAmount}`);
    console.log(`  antiWashHours         : ${s.antiWashHours}h`);
    console.log(`  momentumGateEnabled   : ${s.momentumGateEnabled}`);
    console.log(`  momentumGateThreshold : ${s.momentumGateThreshold}`);
    console.log(`  strategyPersonality   : ${s.strategyPersonality ?? '(none)'}`);
    console.log(`  positionStopLoss      : ${s.positionStopLoss}%`);
    console.log(`  description           : ${s.description}`);

    // ── 2. Score history ──────────────────────────────────────────────────
    console.log('\n📊 SCORE HISTORY (last 10 per token):');
    const scoreHistory = pool2.scoreHistory ?? {};
    for (const token of pool2.tokens) {
        const scores = (scoreHistory[token.toUpperCase()] ?? []).slice(-10);
        if (scores.length === 0) {
            console.log(`  ${token}: No score history recorded`);
        } else {
            const scoreLine = scores.map((s: any) => `${s.score}`).join(', ');
            const latest = scores[scores.length - 1];
            const effBuy = (pool2.strategy.buyScoreThreshold ?? 0) + (pool2.strategy.buyConfidenceBuffer ?? 5);
            const maxScore = Math.max(...scores.map((s: any) => s.score));
            console.log(`  ${token}: scores=[${scoreLine}]  max=${maxScore}  buy_trigger=${effBuy}  ${maxScore >= effBuy ? '✅ WAS high enough' : `❌ NEVER reached ${effBuy}`}`);
            console.log(`         last score: ${latest.score} at ${latest.ts}`);
        }
    }

    // ── 3. Anti-wash / last sold dates ───────────────────────────────────
    console.log('\n🚫 ANTI-WASH / COOLDOWNS:');
    const lastSoldAt = pool2.lastSoldAt ?? {};
    const lastStopLossedAt = pool2.lastStopLossedAt ?? {};
    for (const token of pool2.tokens) {
        const sold = lastSoldAt[token.toUpperCase()];
        const stopped = lastStopLossedAt[token.toUpperCase()];
        const washHours = s.antiWashHours ?? 0;
        if (sold) {
            const hoursSince = (Date.now() - new Date(sold).getTime()) / (1000 * 60 * 60);
            console.log(`  ${token} last sold: ${sold}  (${hoursSince.toFixed(1)}h ago, wash=${washHours}h)  ${hoursSince < washHours ? '⛔ WASH BLOCKED' : '✅ cooldown expired'}`);
        } else {
            console.log(`  ${token}: Never sold`);
        }
        if (stopped) {
            const washStopHours = s.stopLossReentryHours ?? 6;
            const hoursSince = (Date.now() - new Date(stopped).getTime()) / (1000 * 60 * 60);
            console.log(`  ${token} stop-loss: ${stopped}  (${hoursSince.toFixed(1)}h ago, reentry=${washStopHours}h)  ${hoursSince < washStopHours ? '⛔ STOP-LOSS BLOCKED' : '✅ cooldown expired'}`);
        }
    }

    // ── 4. All trades for Pool 2 ──────────────────────────────────────────
    console.log('\n📈 ALL TRADES FOR POOL_2:');
    const tradesSnap = await db.collection('arena_trades')
        .where('userId', '==', USER_ID)
        .where('poolId', '==', 'POOL_2')
        .orderBy('date', 'desc')
        .limit(20)
        .get();

    if (tradesSnap.empty) {
        console.log('  ❌ NO TRADES EVER for POOL_2');
    } else {
        for (const doc of tradesSnap.docs) {
            const t = doc.data();
            console.log(`  ${t.type} ${t.ticker} @ $${(t.price ?? 0).toFixed(4)} × ${(t.amount ?? 0).toFixed(4)} = $${(t.total ?? 0).toFixed(2)}  [${t.date}]`);
        }
    }

    // ── 5. Recent decisions mentioning AAVE or LINK ───────────────────────
    console.log('\n🧠 RECENT DECISIONS (AAVE or LINK, last 48h):');
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    let decisionsFound = 0;
    for (const token of pool2.tokens) {
        const decSnap = await db.collection('arena_decisions')
            .where('userId', '==', USER_ID)
            .where('ticker', '==', token.toUpperCase())
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        for (const doc of decSnap.docs) {
            const d = doc.data();
            if (d.createdAt < since) continue;
            console.log(`  [${d.createdAt}] ${token} poolId=${d.poolId} score=${d.score ?? '?'} action=${d.action ?? '?'} reason=${(d.reason ?? '').substring(0, 80)}`);
            decisionsFound++;
        }
    }
    if (decisionsFound === 0) console.log('  No recent decisions found for AAVE or LINK');

    // ── 6. Summary ─────────────────────────────────────────────────────────
    console.log('\n' + sep());
    console.log('  DIAGNOSIS:');
    const effBuy = (s.buyScoreThreshold ?? 0) + (s.buyConfidenceBuffer ?? 5);
    console.log(`  Effective buy trigger: ${effBuy}`);
    console.log(`  Pool status: ${pool2.status}`);
    const maxScores: number[] = [];
    for (const token of pool2.tokens) {
        const scores = (scoreHistory[token.toUpperCase()] ?? []).slice(-10);
        if (scores.length > 0) maxScores.push(Math.max(...scores.map((s: any) => s.score)));
    }
    if (maxScores.length > 0) {
        const overallMax = Math.max(...maxScores);
        if (overallMax < effBuy) {
            console.log(`  ❌ ROOT CAUSE: Scores have NEVER reached ${effBuy} (highest seen: ${overallMax})`);
            console.log(`     AAVE and LINK are scoring below the buy trigger.`);
            console.log(`     Either the threshold is too high, or market conditions are too bearish.`);
        } else {
            console.log(`  ⚠️  Scores reached ${overallMax} (>= ${effBuy}) at some point — check wash/other blocks above.`);
        }
    } else {
        console.log('  ⚠️  No score history at all — tokens may never have been evaluated.');
        console.log('     Check if the Arena cron is running correctly and evaluating Pool 2.');
    }
    console.log(sep() + '\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
