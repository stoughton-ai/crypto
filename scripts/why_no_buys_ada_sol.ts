/**
 * Why haven't ADA and SOL been bought?
 * Run: npx tsx scripts/why_no_buys_ada_sol.ts
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
    const snap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = snap.data()!;

    console.log('\n' + sep());
    console.log('  WHY HAVEN\'T ADA AND SOL BEEN BOUGHT?');
    console.log(sep());

    // Find which pools hold ADA / SOL as tokens
    const targets = ['ADA', 'SOL'];

    for (const pool of arena.pools as any[]) {
        const relevantTokens = pool.tokens.filter((t: string) => targets.includes(t.toUpperCase()));
        if (relevantTokens.length === 0) continue;

        const s = pool.strategy;
        const effBuy = (s.buyScoreThreshold ?? 0) + (s.buyConfidenceBuffer ?? 5);
        const cash = pool.cashBalance ?? 0;
        const reserve = pool.dcaReserve ?? 0;
        const freeCash = Math.max(0, cash - reserve);

        console.log(`\n${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`  Tokens in this pool : ${pool.tokens.join(', ')}`);
        console.log(`  Status              : ${pool.status}`);
        console.log(`  cashBalance         : $${cash.toFixed(2)}`);
        console.log(`  freeCash            : $${freeCash.toFixed(2)}`);
        console.log(`  buyScoreThreshold   : ${s.buyScoreThreshold}  +  buffer ${s.buyConfidenceBuffer ?? 5}  = effective ${effBuy}`);
        console.log(`  momentumGate        : ${s.momentumGateEnabled ? `enabled (threshold: ${s.momentumGateThreshold})` : 'disabled'}`);
        console.log(`  strategyPersonality : ${s.strategyPersonality ?? 'MODERATE'}`);
        console.log(`  maxAllocationPerToken: $${s.maxAllocationPerToken}`);
        console.log(`  minOrderAmount      : $${s.minOrderAmount}`);

        const scoreHistory = pool.scoreHistory ?? {};

        for (const token of relevantTokens) {
            const scores = (scoreHistory[token.toUpperCase()] ?? []).slice(-10);
            const lastSold = pool.lastSoldAt?.[token.toUpperCase()];
            const lastStopped = pool.lastStopLossedAt?.[token.toUpperCase()];
            const holding = pool.holdings?.[token.toUpperCase()];

            console.log(`\n  ── ${token} ──`);
            if (holding?.amount > 0) {
                console.log(`  Currently HELD: ${holding.amount.toFixed(4)} @ avg $${holding.averagePrice.toFixed(4)}`);
            } else {
                console.log(`  Currently: NOT HELD`);
            }

            if (scores.length === 0) {
                console.log(`  Scores: ❌ NO SCORE HISTORY — token has never been evaluated`);
            } else {
                const max = Math.max(...scores.map((s: any) => s.score));
                const latest = scores[scores.length - 1];
                console.log(`  Scores (last 10): [${scores.map((s: any) => s.score).join(', ')}]`);
                console.log(`  Max score: ${max}  vs buy trigger: ${effBuy}  → ${max >= effBuy ? '✅ has reached trigger' : `❌ never reached ${effBuy}`}`);
                console.log(`  Last score: ${latest.score} at ${latest.ts}`);
            }

            if (lastSold) {
                const h = (Date.now() - new Date(lastSold).getTime()) / 3600000;
                console.log(`  Last sold: ${lastSold} (${h.toFixed(1)}h ago, wash=${s.antiWashHours}h) ${h < s.antiWashHours ? '⛔ WASH BLOCKED' : '✅ expired'}`);
            }
            if (lastStopped) {
                const h = (Date.now() - new Date(lastStopped).getTime()) / 3600000;
                const reentry = s.stopLossReentryHours ?? 6;
                console.log(`  Stop-loss: ${lastStopped} (${h.toFixed(1)}h ago, reentry=${reentry}h) ${h < reentry ? '⛔ BLOCKED' : '✅ expired'}`);
            }
        }

        // Diagnosis
        console.log(`\n  📋 DIAGNOSIS:`);
        for (const token of relevantTokens) {
            const scores = (scoreHistory[token.toUpperCase()] ?? []).slice(-10);
            if (scores.length === 0) {
                console.log(`  ${token}: Never evaluated — cron may not have assessed this token recently`);
            } else {
                const max = Math.max(...scores.map((s: any) => s.score));
                if (max < effBuy) {
                    console.log(`  ${token}: Scores (max=${max}) have NEVER reached buy trigger (${effBuy})`);
                } else {
                    console.log(`  ${token}: Scores hit ${max} — check wash/stop blocks above`);
                }
            }
        }
    }

    console.log('\n' + sep() + '\n');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
