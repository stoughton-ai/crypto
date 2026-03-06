/**
 * PATIENCE NOT ACTIVITY — Regime Deployment Script
 * 
 * 1. Updates all 4 pool strategies to the new hybrid hold regime
 * 2. Logs the change as a strategy mutation in strategyHistory
 * 3. Runs an AI re-evaluation of whether the current tokens are optimal
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';
import { GoogleGenerativeAI } from '@google/generative-ai';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

const PATIENCE_STRATEGY = {
    buyScoreThreshold: 90,
    exitThreshold: 40,        // 50-point gap from buy — only sell on genuine collapse
    takeProfitTarget: 8,      // 8% minimum — must exceed ~1% spread cost significantly
    trailingStopPct: 3,       // 3% trailing stop — reasonable pullback tolerance
    positionStopLoss: -8,     // -8% — crypto regularly moves ±3% daily, this is real pain
    momentumGateEnabled: true,
    momentumGateThreshold: 1, // Only buy tokens already trending slightly upward
    minOrderAmount: 50,       // Bigger positions — worth the spread
    antiWashHours: 24,        // 24h — no re-buying recently sold tokens
    reentryPenalty: 5,        // Penalty for re-entering a position
    maxAllocationPerToken: 100,
    minWinPct: 0,
    minHoldMinutes: 480,      // 8 hours — maximum patience
    evaluationCooldownMinutes: 60, // 1 hour — maximum cooldown
    buyConfidenceBuffer: 5,   // Score must be 95+ effective (90 + 5 buffer)
    exitHysteresis: 10,       // Large hysteresis to prevent oscillation
    positionSizeMultiplier: 0.9,
    strategyPersonality: 'PATIENT' as const,
};

async function deployPatienceRegime() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  DEPLOYING "PATIENCE NOT ACTIVITY" REGIME');
    console.log('  ' + new Date().toISOString());
    console.log('═══════════════════════════════════════════════════════\n');

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const docRef = db.collection('arena_config').doc(userId);
    const doc = await docRef.get();
    const arena = doc.data();
    if (!arena) { console.error('No arena found'); process.exit(1); }

    for (const pool of arena.pools) {
        const previousStrategy = { ...pool.strategy };

        // Apply the patience regime
        const newStrategy = {
            ...pool.strategy,
            ...PATIENCE_STRATEGY,
            description: `PATIENCE REGIME: Hold positions for maximum maturation. Only enter on extreme AI conviction (score 95+). Exit only via 8% take-profit, -8% stop-loss, or 3% trailing stop. AI score-based exits disabled. Spread-aware: each trade costs ~$0.50-1.00. Previously: ${pool.strategy.description.substring(0, 100)}`,
        };

        pool.strategy = newStrategy;

        // Record this as a strategy change in history
        if (!pool.strategyHistory) pool.strategyHistory = [];
        pool.strategyHistory.push({
            week: 0,
            previousStrategy,
            newStrategy,
            reasoning: 'MANUAL REGIME CHANGE — "Patience Not Activity" deployed. Forensic audit found: 15% win rate, $0.94 total loss from 60 trades in 34 hours, spread costs destroying value. AI score-based exits (Path 4) disabled. Minimum TP raised to 8%, SL set to -8%, buy threshold raised to 90, hold time set to 480min, anti-wash set to 24h. All pools set to PATIENT personality.',
            changedAt: new Date().toISOString(),
        });

        // Count the diffs
        const diffKeys = Object.keys(PATIENCE_STRATEGY).filter(k => {
            return (previousStrategy as any)[k] !== (newStrategy as any)[k];
        });

        console.log(`✅ ${pool.emoji} ${pool.name} (${pool.poolId})`);
        console.log(`   Changed ${diffKeys.length} parameters:`);
        for (const key of diffKeys) {
            console.log(`     ${key}: ${(previousStrategy as any)[key]} → ${(newStrategy as any)[key]}`);
        }
        console.log('');
    }

    // Save to Firestore
    await docRef.set(arena);
    console.log('✅ All pools updated in Firestore.\n');

    // ─── AI TOKEN RE-EVALUATION ──────────────────────────────────────────
    console.log('═══════════════════════════════════════════════════════');
    console.log('  AI TOKEN RE-EVALUATION');
    console.log('═══════════════════════════════════════════════════════\n');

    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Gather current holdings data
    const poolSummaries = arena.pools.map((pool: any) => {
        const holdings = Object.entries(pool.holdings).map(([ticker, h]: [string, any]) => {
            return `${ticker}: ${h.amount.toFixed(4)} units @ avg $${h.averagePrice.toFixed(6)} (bought ${h.boughtAt || 'unknown'})`;
        }).join(', ') || 'no current holdings';

        const scoreInfo = pool.tokens.map((t: string) => {
            const scores = pool.scoreHistory?.[t.toUpperCase()]?.map((s: any) => s.score) || [];
            if (scores.length < 2) return `${t}: no data`;
            const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
            return `${t}: avg score ${avg.toFixed(0)}/100 (last 5: [${scores.slice(-5).join(', ')}])`;
        }).join(', ');

        return `${pool.emoji} ${pool.name}:
  Tokens: ${pool.tokens.join(', ')}
  Current Holdings: ${holdings}
  Cash: $${pool.cashBalance.toFixed(2)} / $${pool.budget} budget
  P&L: ${pool.performance.totalPnlPct?.toFixed(2) || '?'}%
  Win Rate: ${pool.performance.winCount}W / ${pool.performance.lossCount}L
  AI Score History: ${scoreInfo}`;
    }).join('\n\n');

    const prompt = `You are a senior crypto portfolio analyst. A trading system has 4 pools, each locked to 2 tokens for 28 days. We are now on Day 2 of 28 with 26 days remaining.

The system has just adopted a "PATIENCE NOT ACTIVITY" regime:
- Only buy on extreme conviction (AI score 95+)
- Take-profit at 8% minimum
- Stop-loss at -8%
- Hold positions for 8+ hours minimum
- Prioritize HOLDING over trading
- Each trade costs ~$0.50-1.00 in Revolut spread (~1% round-trip)

Market conditions: BTC ~$73,000, Fear & Greed Index: 22 (Extreme Fear)

CURRENT POOL STATUS:
${poolSummaries}

The tokens are LOCKED — they cannot be swapped. However, you can evaluate:

For EACH pool, provide:
1. TOKEN ASSESSMENT: Are these good hold candidates for the next 26 days given Extreme Fear conditions? Rate each token 1-10 for "hold quality" (ability to recover/grow from current levels over 26 days).
2. POSITION SIZING: Given the patience regime, should the pool deploy more cash into existing tokens, or keep cash as a buffer?
3. RISK PROFILE: What's the realistic 26-day P&L range for each token at current prices?
4. OPTIMAL ACTION: Should the pool hold current positions as-is, deploy remaining cash into one/both tokens, or keep cash reserved?
5. KEY CONCERN: What's the single biggest risk for this pool over the next 26 days?

Then provide an OVERALL VERDICT:
- Which pool has the best chance of profiting under the patience regime?
- Which pool is most at risk?
- What's your confidence that at least one pool will be profitable after 26 days?
- Should any pools consider gradually liquidating their position if the stop-loss doesn't trigger?

Be specific with numbers. Don't be generically optimistic — give honest assessments.`;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        console.log(response);
        console.log('\n═══════════════════════════════════════════════════════');
        console.log('  REGIME DEPLOYMENT COMPLETE');
        console.log('═══════════════════════════════════════════════════════');
    } catch (e: any) {
        console.error('AI evaluation failed:', e.message);
    }

    process.exit(0);
}

deployPatienceRegime().catch(e => { console.error(e); process.exit(1); });
