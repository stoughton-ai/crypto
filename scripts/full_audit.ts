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

    // ═══════════════════════════════════════════════════════════════════
    // 1. CONFIG STATE
    // ═══════════════════════════════════════════════════════════════════
    const configSnap = await db.collection('agent_configs').doc(userId).get();
    const config = configSnap.data()!;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 1: LIVE CONFIG & BRAIN STATE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`  Risk Profile:        ${config.riskProfile}`);
    console.log(`  Automation:          ${config.automationEnabled ? '✅ ON' : '❌ OFF'}`);
    console.log(`  Real Trading:        ${config.realTradingEnabled !== false ? '✅ ON' : '❌ OFF'}`);
    console.log(`  Watchdog:            ${config.watchdogEnabled !== false ? '✅ ON' : '❌ OFF'}`);
    console.log(`  Stop-Loss Triggered: ${config.stopLossTriggered ? '🚨 YES' : '✅ No'}`);
    console.log(`  Audit Auto-Disabled: ${config.auditAutoDisabled ? '⚠️ YES' : '✅ No'}`);
    console.log(`  Last Audit Passed:   ${config.lastAuditPassed !== false ? '✅ Yes' : '❌ No'}`);
    console.log(`  Last Audit At:       ${config.lastAuditAt || 'Never'}`);
    console.log('');

    const bs = config.brainState;
    if (bs) {
        const lastActiveAgo = bs.lastActive ? ((Date.now() - new Date(bs.lastActive).getTime()) / 1000 / 60).toFixed(1) : '?';
        console.log(`  Brain Last Active:   ${bs.lastActive} (${lastActiveAgo} min ago)`);
        console.log(`  Brain Current Action: ${bs.currentAction}`);
        console.log(`  Brain Stage:         ${bs.stage}`);
        console.log(`  Cycle Complete:      ${bs.cycleComplete}`);
        if (bs.vibe) {
            console.log(`  Market Vibe:         ${bs.vibe.label} (FNG: ${bs.vibe.fng}, Change: ${bs.vibe.globalChange}%, Speed: ${bs.vibe.multiplier}x)`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 2. WATCHLIST STATE
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 2: WATCHLIST HEALTH');
    console.log('═══════════════════════════════════════════════════════════\n');

    const traffic = config.trafficLightTokens || [];
    const standard = config.standardTokens || [];
    const sandbox = config.sandboxTokens || [];
    const ai = config.aiWatchlist || [];

    console.log(`  Traffic (6 cap):     ${traffic.length}/6 — ${traffic.join(', ')}`);
    console.log(`  Standard (10 cap):   ${standard.length}/10 — ${standard.join(', ')}`);
    console.log(`  Sandbox (10 cap):    ${sandbox.length}/10 — ${sandbox.join(', ')}`);
    console.log(`  AI Watchlist (10):   ${ai.length}/10 — ${ai.join(', ')}`);
    const totalSlots = traffic.length + standard.length + sandbox.length + ai.length;
    console.log(`  TOTAL:               ${totalSlots}/36`);
    if (totalSlots < 36) console.log(`  ⚠️ DEFICIT: ${36 - totalSlots} empty slots!`);
    else console.log(`  ✅ All watchlist slots filled.`);

    // Check for duplicates across tiers
    const allWatchlist = [...traffic, ...standard, ...sandbox, ...ai];
    const seen = new Set<string>();
    const dupes: string[] = [];
    allWatchlist.forEach(t => { if (seen.has(t)) dupes.push(t); seen.add(t); });
    if (dupes.length > 0) console.log(`  ⚠️ DUPLICATES: ${dupes.join(', ')}`);

    const excluded = config.excludedTokens || [];
    console.log(`  Excluded (Burn List): ${excluded.length} — ${excluded.join(', ')}`);

    // ═══════════════════════════════════════════════════════════════════
    // 3. PORTFOLIO STATE
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 3: PORTFOLIO STATE');
    console.log('═══════════════════════════════════════════════════════════\n');

    const vpSnap = await db.collection('virtual_portfolio').doc(userId).get();
    const vp = vpSnap.data()!;
    const holdings = vp.holdings || {};
    const heldTickers = Object.keys(holdings).filter(t => holdings[t].amount > 0);

    console.log(`  Cash Balance:        $${(vp.cashBalance || 0).toFixed(2)}`);
    console.log(`  Initial Balance:     $${vp.initialBalance || 'N/A'}`);
    console.log(`  Net Deposits:        $${vp.netDeposits || 0}`);
    console.log(`  Total Value:         $${(vp.totalValue || 0).toFixed(2)}`);
    console.log(`  Last Updated:        ${vp.lastUpdated}`);
    console.log(`  Holdings Count:      ${heldTickers.length}`);
    console.log('');

    let totalHoldingsVal = 0;
    for (const ticker of heldTickers) {
        const h = holdings[ticker];
        const intelDoc = await db.collection('ticker_intel').doc(`${userId}_${ticker}`).get();
        const intel = intelDoc.exists ? intelDoc.data() : null;
        const currentPrice = intel?.currentPrice || h.averagePrice;
        const score = intel?.overallScore ?? 'N/A';
        const pnlPct = h.averagePrice > 0 ? ((currentPrice - h.averagePrice) / h.averagePrice) * 100 : 0;
        const value = h.amount * currentPrice;
        totalHoldingsVal += value;

        const lastTrade = config.lastTrade?.[ticker];
        const holdHours = lastTrade ? ((Date.now() - new Date(lastTrade).getTime()) / (1000 * 60 * 60)) : 999;
        const light = intel?.trafficLight || '?';
        const entryType = h.entryType || 'legacy';

        const exitThreshold = config.aiScoreExitThreshold || 58;
        const posStopLoss = config.positionStopLoss || -15;
        const isProtected = pnlPct > 0 && holdHours < (config.minProfitableHoldHours || 48);

        let status = '✅ HOLD';
        if (pnlPct <= posStopLoss) status = '🚨 STOP-LOSS';
        else if (score !== 'N/A' && score < exitThreshold && !isProtected) status = '⚠️ EXIT-DUE';
        else if (isProtected && score < exitThreshold) status = '🛡️ PROTECTED';

        console.log(`  ${ticker.padEnd(8)} Score: ${String(score).padEnd(4)} | ${light.padEnd(10)} | PnL: ${(pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(1) + '%'}  | Val: $${value.toFixed(2).padEnd(8)} | Hold: ${holdHours.toFixed(0)}h | Entry: ${entryType.padEnd(12)} | ${status}`);
    }

    const actualTotal = (vp.cashBalance || 0) + totalHoldingsVal;
    console.log(`\n  Calculated Total:    $${actualTotal.toFixed(2)} (Cash: $${(vp.cashBalance || 0).toFixed(2)} + Holdings: $${totalHoldingsVal.toFixed(2)})`);
    if (vp.totalValue && Math.abs(actualTotal - vp.totalValue) > 1) {
        console.log(`  ⚠️ VALUE MISMATCH: Stored totalValue $${vp.totalValue.toFixed(2)} vs calculated $${actualTotal.toFixed(2)} (Δ$${(actualTotal - vp.totalValue).toFixed(2)})`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4. RECENT TRADES (Last 10)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 4: RECENT TRADES (Last 10)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const tradesSnap = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(10)
        .get();

    if (tradesSnap.empty) {
        console.log('  No trades found.');
    } else {
        for (const doc of tradesSnap.docs) {
            const t = doc.data();
            const pnlStr = t.pnl !== undefined ? ` PnL: ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)} (${t.pnlPct?.toFixed(1)}%)` : '';
            const entryStr = t.entryType ? ` [${t.entryType}]` : '';
            console.log(`  ${t.date?.substring(0, 19)} | ${t.type?.padEnd(4)} ${t.ticker?.padEnd(8)} | $${t.total?.toFixed(2)} @ $${t.price?.toFixed(t.price < 1 ? 6 : 2)} | ${t.reason}${pnlStr}${entryStr}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 5. RECENT DECISIONS (Last 15)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 5: RECENT DECISIONS (Last 15)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const decisionsSnap = await db.collection('virtual_decisions')
        .where('userId', '==', userId)
        .orderBy('date', 'desc')
        .limit(15)
        .get();

    if (decisionsSnap.empty) {
        console.log('  No decisions found.');
    } else {
        for (const doc of decisionsSnap.docs) {
            const d = doc.data();
            console.log(`  ${d.date?.substring(0, 19)} | ${d.action?.padEnd(5)} ${d.ticker?.padEnd(8)} | Score: ${String(d.score).padEnd(3)} | ${d.reason}`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6. CYCLE LOGS (Last 3)
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 6: CYCLE LOGS (Last 3)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const cycleLogs = config.cycle_logs || [];
    if (cycleLogs.length === 0) {
        console.log('  No cycle logs found.');
    } else {
        const last3 = cycleLogs.slice(0, 3);
        for (const log of last3) {
            const exec = log.execution || {};
            console.log(`  Cycle at ${log.timestamp || 'unknown'}:`);
            console.log(`    Duration:   ${log.durationMs ? (log.durationMs / 1000).toFixed(1) + 's' : '?'}`);
            console.log(`    Trades:     ${exec.trades?.length || 0}`);
            console.log(`    Decisions:  ${exec.decisions?.length || 0}`);
            console.log(`    Cash After: $${exec.newCashBalance?.toFixed(2) || '?'}`);
            console.log(`    Total After: $${exec.newTotalValue?.toFixed(2) || '?'}`);
            if (exec.trades?.length > 0) {
                exec.trades.forEach((t: any) => {
                    console.log(`      → ${t.type} ${t.ticker}: $${t.total?.toFixed(2)} — ${t.reason}`);
                });
            }
            if (exec.decisions?.length > 0) {
                const skips = exec.decisions.filter((d: any) => d.action === 'SKIP');
                const buys = exec.decisions.filter((d: any) => d.action === 'BUY');
                const sells = exec.decisions.filter((d: any) => d.action === 'SELL' || d.action === 'TRIM');
                console.log(`      Decisions: ${buys.length} BUY, ${sells.length} SELL/TRIM, ${skips.length} SKIP`);
                skips.forEach((d: any) => {
                    console.log(`        SKIP ${d.ticker}: ${d.reason}`);
                });
            }
            console.log('');
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 7. AUDIT VIOLATIONS
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 7: AUDIT VIOLATIONS');
    console.log('═══════════════════════════════════════════════════════════\n');

    const violations = config.auditViolations || [];
    if (violations.length === 0) {
        console.log('  ✅ No violations recorded.');
    } else {
        for (const v of violations) {
            const icon = v.severity === 'CRITICAL' ? '🚨' : '⚠️';
            console.log(`  ${icon} ${v.type}: ${v.message} (${v.timestamp || 'unknown'})`);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. DAILY REFLECTION
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 8: DAILY REFLECTION');
    console.log('═══════════════════════════════════════════════════════════\n');

    const reflection = config.dailyReflection;
    if (reflection) {
        console.log(`  Generated At:  ${reflection.generatedAt}`);
        console.log(`  Portfolio Δ:   ${reflection.portfolioChange?.toFixed(2)}%`);
        console.log(`  Market Δ:      ${reflection.marketChange?.toFixed(2)}%`);
        console.log(`  Synopsis:\n`);
        const lines = (reflection.synopsis || '').split('\n');
        lines.forEach((l: string) => console.log(`    ${l}`));
    } else {
        console.log('  No reflection found.');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 9. SELF-CORRECTION PROMPT
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 9: SELF-CORRECTION (NEURAL PATCH)');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (config.selfCorrectionPrompt) {
        console.log(`  ${config.selfCorrectionPrompt}`);
    } else {
        console.log('  No self-correction prompt active.');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 10. LAST CHECK TIMESTAMPS
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 10: ANALYSIS FRESHNESS (lastCheck)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const lastCheck = config.lastCheck || {};
    const allTracked = [...traffic, ...standard, ...sandbox, ...ai, ...heldTickers];
    const unique = [...new Set(allTracked.map(t => t.toUpperCase()))];

    const now = Date.now();
    const stale: string[] = [];
    const fresh: string[] = [];

    for (const ticker of unique) {
        const lc = lastCheck[ticker];
        if (!lc) {
            stale.push(`${ticker}: NEVER checked`);
        } else {
            const ageMin = (now - new Date(lc).getTime()) / (1000 * 60);
            if (ageMin > 120) {
                stale.push(`${ticker}: ${ageMin.toFixed(0)} min ago`);
            } else {
                fresh.push(ticker);
            }
        }
    }

    console.log(`  Fresh (<2h): ${fresh.length} tokens — ${fresh.join(', ')}`);
    if (stale.length > 0) {
        console.log(`  ⚠️ STALE (>2h):`);
        stale.forEach(s => console.log(`    ${s}`));
    } else {
        console.log(`  ✅ All tokens recently analyzed.`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 11. REGIME / AUTONOMY STATE
    // ═══════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  SECTION 11: AUTONOMY STATE');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`  Last Regime Recommendation: ${(config as any).lastRegimeRecommendation || 'none'}`);
    console.log(`  Regime Consecutive Count:   ${(config as any).regimeConsecutiveCount || 0}`);
    console.log(`  Last Regime Switch At:      ${(config as any).lastRegimeSwitchAt || 'never'}`);
    console.log(`  Last Regime Switch From:    ${(config as any).lastRegimeSwitchFrom || 'N/A'}`);
    console.log(`  Entry Type Stats:           ${JSON.stringify((config as any).entryTypeStats || 'none')}`);
    console.log(`  Last Heartbeat Alert:       ${(config as any).lastHeartbeatAlert || 'never'}`);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  AUDIT COMPLETE');
    console.log('══════════════════════════════════════════════════════════════\n');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
