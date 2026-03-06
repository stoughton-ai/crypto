import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const configSnap = await db.collection('agent_configs').doc(userId).get();
    const config = configSnap.data()!;
    const vpSnap = await db.collection('virtual_portfolio').doc(userId).get();
    const vp = vpSnap.data()!;

    const heldTickers = Object.keys(vp.holdings || {}).filter(t => (vp.holdings[t]?.amount || 0) > 0);

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  WHY ISN\'T THE ENGINE BUYING? — DIAGNOSTIC');
    console.log('══════════════════════════════════════════════════════════\n');

    // 1. Capital analysis
    const cash = vp.cashBalance || 0;
    const totalVal = vp.totalValue || 0;
    const minCashPct = config.minCashReservePct ?? 15;
    const minCashReserve = totalVal * (minCashPct / 100);
    const deployableCash = cash - minCashReserve;
    const maxAlloc = config.maxAllocationPerAsset ?? 400;
    const minOrder = config.minOrderAmount ?? 150;
    const maxPositions = config.maxOpenPositions ?? 8;
    const buyThreshold = config.buyScoreThreshold ?? 72;
    const momentumGate = config.requireMomentumForBuy ?? true;

    console.log('  ── CAPITAL STATUS ──');
    console.log(`  Cash:               $${cash.toFixed(2)}`);
    console.log(`  Total Portfolio:    $${totalVal.toFixed(2)}`);
    console.log(`  Min Cash Reserve:   ${minCashPct}% = $${minCashReserve.toFixed(2)}`);
    console.log(`  Deployable Cash:    $${deployableCash.toFixed(2)} ${deployableCash > minOrder ? '✅ Can buy' : '🚨 CANNOT BUY — below minOrder'}`);
    console.log(`  Min Order Amount:   $${minOrder}`);
    console.log(`  Max Alloc Per Asset: $${maxAlloc}`);
    console.log(`  Max Open Positions: ${maxPositions}`);
    console.log(`  Current Positions:  ${heldTickers.length} (${heldTickers.join(', ')})`);
    console.log(`  Can Open More:      ${heldTickers.length < maxPositions ? '✅ YES' : '🚨 AT CAPACITY'} (${maxPositions - heldTickers.length} slots free)`);
    console.log('');

    // 2. Buy gates
    console.log('  ── BUY GATES ──');
    console.log(`  Buy Score Threshold: ${buyThreshold}`);
    console.log(`  Momentum Gate:       ${momentumGate ? '🚨 ON — 24h change must be positive' : '✅ OFF'}`);
    console.log(`  Risk Profile:        ${config.riskProfile}`);
    console.log(`  Automation:          ${config.automationEnabled ? '✅ ON' : '❌ OFF'}`);
    console.log(`  Stop-Loss:           ${config.stopLossTriggered ? '🚨 TRIGGERED — ALL BUYING BLOCKED' : '✅ No'}`);
    console.log('');

    // 3. Check top-scoring tokens
    console.log('  ── TOP SCORING TOKENS (potential buys) ──');
    const intelSnap = await db.collection('ticker_intel').where('userId', '==', userId).get();
    const allIntel: any[] = [];
    intelSnap.docs.forEach(d => {
        const data = d.data();
        if (data.overallScore) allIntel.push(data);
    });
    allIntel.sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

    const excluded = new Set((config.excludedTokens || []).map((t: string) => t.toUpperCase()));
    const held = new Set(heldTickers.map(t => t.toUpperCase()));

    const topCandidates = allIntel.filter(t => {
        const tk = t.ticker?.toUpperCase();
        return !excluded.has(tk) && !held.has(tk);
    }).slice(0, 20);

    for (const t of topCandidates) {
        const score = t.overallScore;
        const change24h = t.priceChange24h ?? 0;
        const meetsScore = score >= buyThreshold;
        const meetsMomentum = !momentumGate || change24h > 0;
        const status = meetsScore && meetsMomentum ? '✅ ELIGIBLE' :
            !meetsScore ? `❌ Score ${score} < ${buyThreshold}` :
                `❌ Momentum ${change24h.toFixed(1)}% ≤ 0`;
        console.log(`  ${(t.ticker || '?').padEnd(8)} Score: ${String(score).padEnd(3)} | 24h: ${(change24h >= 0 ? '+' : '') + change24h.toFixed(1).padEnd(6)}% | ${t.trafficLight?.padEnd(6) || '?'} | ${status}`);
    }

    // 4. Check anti-wash blocks
    console.log('\n  ── ANTI-WASH & RE-ENTRY BLOCKS ──');
    const lastTrade = config.lastTrade || {};
    const antiWashHours = config.antiWashHours ?? 6;
    const reentryPenalty = config.reentryPenalty ?? 10;
    const now = Date.now();

    let blockedCount = 0;
    for (const ticker of Object.keys(lastTrade)) {
        const lastMs = new Date(lastTrade[ticker]).getTime();
        const hoursAgo = (now - lastMs) / (1000 * 60 * 60);
        if (hoursAgo < antiWashHours) {
            blockedCount++;
            console.log(`  ${ticker.padEnd(8)} Last trade: ${hoursAgo.toFixed(1)}h ago (blocked for ${antiWashHours}h)`);
        }
    }
    if (blockedCount === 0) console.log('  ✅ No anti-wash blocks active.');

    // 5. Recent decisions
    console.log('\n  ── RECENT DECISIONS (last 20) ──');
    const decisionsSnap = await db.collection('virtual_decisions')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(20)
        .get();

    const buyDecisions = decisionsSnap.docs.filter(d => d.data().action === 'BUY');
    const skipDecisions = decisionsSnap.docs.filter(d => d.data().action === 'SKIP');
    const sellDecisions = decisionsSnap.docs.filter(d => d.data().action === 'SELL' || d.data().action === 'TRIM');

    console.log(`  BUY decisions:  ${buyDecisions.length}`);
    console.log(`  SKIP decisions: ${skipDecisions.length}`);
    console.log(`  SELL/TRIM:      ${sellDecisions.length}`);

    // Skip reason breakdown
    const skipReasons: Record<string, number> = {};
    skipDecisions.forEach(d => {
        const reason = d.data().reason || 'unknown';
        // Extract the first meaningful phrase
        const key = reason.split(':')[0].trim();
        skipReasons[key] = (skipReasons[key] || 0) + 1;
    });

    if (Object.keys(skipReasons).length > 0) {
        console.log('\n  Skip Reason Breakdown:');
        Object.entries(skipReasons)
            .sort((a, b) => b[1] - a[1])
            .forEach(([reason, count]) => {
                console.log(`    ${count}× ${reason}`);
            });
    }

    // 6. Scan plan
    console.log('\n  ── SCAN PLAN ──');
    if (config.scanPlan) {
        const sp = config.scanPlan;
        console.log(`  Timestamp:  ${sp.timestamp}`);
        console.log(`  Pulse:      ${sp.pulse?.effective}× (${sp.pulse?.speedLabel})`);
        console.log(`  FNG:        ${sp.market?.fng} (${sp.market?.fngLabel})`);
        console.log(`  Due:        ${sp.scan?.dueForAnalysis}/${sp.scan?.totalWatchlist}`);
    } else {
        console.log('  ⚠️ No scan plan found — adaptive pulse hasn\'t run yet');
    }

    // 7. Cycle logs - last 5 cycles trade count
    console.log('\n  ── CYCLE TRADE HISTORY ──');
    const cycleLogs = config.cycle_logs || [];
    const last5 = cycleLogs.slice(0, 5);
    let totalCycleTrades = 0;
    for (const log of last5) {
        const trades = log.execution?.trades?.length || 0;
        totalCycleTrades += trades;
        const decisions = log.execution?.decisions?.length || 0;
        console.log(`  ${log.timestamp || '?'}: ${trades} trades, ${decisions} decisions`);
    }
    console.log(`  Total trades in last 5 cycles: ${totalCycleTrades}`);

    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  DIAGNOSIS');
    console.log('══════════════════════════════════════════════════════════\n');

    // Diagnose
    const issues: string[] = [];
    if (momentumGate) {
        const eligibleCount = topCandidates.filter(t => t.overallScore >= buyThreshold && (t.priceChange24h ?? 0) > 0).length;
        if (eligibleCount === 0) {
            issues.push(`MOMENTUM GATE is blocking ALL buys. FNG is ${config.brainState?.vibe?.fng || '?'} (Extreme Fear). Every token has negative 24h change. The engine CANNOT buy anything until at least one token shows positive 24h momentum.`);
        }
    }
    if (deployableCash < minOrder) {
        issues.push(`CASH RESERVE is blocking buys. Deployable cash ($${deployableCash.toFixed(2)}) is below minimum order ($${minOrder}).`);
    }
    if (heldTickers.length >= maxPositions) {
        issues.push(`POSITION CAP reached. ${heldTickers.length}/${maxPositions} positions filled.`);
    }
    if (config.stopLossTriggered) {
        issues.push(`STOP-LOSS is active. All trading is halted.`);
    }

    if (issues.length === 0) {
        console.log('  ✅ No blocking issues found — system should be buying.');
    } else {
        issues.forEach((issue, i) => {
            console.log(`  🚨 Issue ${i + 1}: ${issue}`);
        });
    }

    console.log('');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
