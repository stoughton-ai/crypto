import * as fs from 'fs';
import * as path from 'path';

// 1. Load Environment Variables using Native Node.js support (handles multi-line JSON perfectly)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore - process.loadEnvFile is available in Node 20.6.0+
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
        console.log('Environment variables loaded natively from .env.local');
    }
}

async function main() {
    console.log('\n--- 🧠 HYBRID ADAPTIVE TRADING BRAIN INITIALIZING ---');
    console.log('   Mode: Hybrid (Time + Volatility + Correlation + Macro Vibe)');

    // 2. Dynamically import modules AFTER env is loaded
    const { adminDb } = await import('../src/lib/firebase-admin');
    const { runAutomatedAgentCheck, runHoldingsWatchdog } = await import('../src/app/actions');

    console.log('   IP Identity:', await fetch('https://ifconfig.me/ip').then(r => r.text()));
    console.log('   System Time:', new Date().toLocaleString());

    if (!adminDb) {
        console.error('CRITICAL: Firebase Admin SDK not initialized. check .env.local');
        process.exit(1);
    }

    let isRunning = false;
    const triggerCheck = async () => {
        if (isRunning) return;
        isRunning = true;
        try {
            console.log(`\n--- 🔥 TRIGGERING ANALYTICS & TRADING CYCLE [${new Date().toLocaleTimeString()}] ---`);

            if (!adminDb) throw new Error("Firebase Admin not initialized");

            // Query users with automation enabled OR stop-loss triggered (so we can still run the check)
            const [activeSnap, haltedSnap] = await Promise.all([
                adminDb.collection('agent_configs').where('automationEnabled', '==', true).get(),
                adminDb.collection('agent_configs').where('stopLossTriggered', '==', true).get(),
            ]);

            const seenIds = new Set<string>();
            const allDocs = [...activeSnap.docs, ...haltedSnap.docs].filter(d => {
                if (seenIds.has(d.id)) return false;
                seenIds.add(d.id);
                return true;
            });

            if (allDocs.length === 0) {
                console.log('No users have automation enabled.');
            }

            for (const doc of allDocs) {
                const userId = doc.id;
                const config = doc.data();

                // 20-minute Net Worth Snapshot Logic
                const now = Date.now();
                const lastSnapshot = config.lastSnapshotTime ? new Date(config.lastSnapshotTime).getTime() : 0;
                // 20 minutes = 20 * 60 * 1000 = 1,200,000 ms
                if (now - lastSnapshot > 20 * 60 * 1000) {
                    console.log(`[Local Brain] 📸 Capturing Net Worth Snapshot for ${userId}...`);
                    try {
                        const { syncRevolutHoldings } = await import('../src/app/actions');
                        await syncRevolutHoldings(userId);
                        await adminDb.collection('agent_configs').doc(userId).update({ lastSnapshotTime: new Date().toISOString() });
                    } catch (snapErr) {
                        console.error(`[Local Brain] Snapshot failed for ${userId}:`, snapErr);
                    }
                }

                console.log(`[Local Brain] Processing tasks for User: ${userId}`);

                // ── STEP 0: STOP-LOSS CHECK (highest priority) ────────────
                const { auditRiskCompliance, getAdvisorReport, purgeExcludedFromWatchlists, checkStopLoss } = await import('../src/app/actions');

                if (config.stopLossTriggered) {
                    console.error(`[Local Brain] 🛑 STOP LOSS ACTIVE for ${userId} — trading halted. Awaiting user approval to resume.`);
                    console.error(`   Triggered: ${config.stopLossTriggeredAt || 'unknown'} | Drawdown: ${config.stopLossDrawdownPct || '?'}%`);
                    continue; // Skip all analysis and trading for this user
                }

                try {
                    const slRes = await checkStopLoss(userId);
                    if (slRes.triggered) {
                        console.error(`[Local Brain] 🚨 STOP LOSS TRIGGERED for ${userId}!`);
                        console.error(`   ${slRes.reason}`);
                        console.error(`   ⛔ All holdings liquidated. Automation disabled. User must approve to resume.`);
                        continue; // Skip the rest of this cycle
                    }
                } catch (slErr) {
                    console.error(`[Local Brain] Stop-loss check failed:`, slErr);
                }

                // ── STEP 1: PURGE BURNED TOKENS ───────────────────────────
                try {
                    const purgeRes = await purgeExcludedFromWatchlists(userId);
                    if (purgeRes.success && (purgeRes as any).removedCount > 0) {
                        console.log(`[Local Brain] 🔥 Purged ${(purgeRes as any).removedCount} burned token(s) from watchlists.`);
                    }
                } catch (purgeErr) {
                    console.error(`[Local Brain] Purge failed:`, purgeErr);
                }

                // 1. Audit Compliance BEFORE actions
                const rawProfile = config.riskProfile || 'TACTICAL';
                let riskProfile: string = 'TACTICAL';
                if (rawProfile === 'SAFE') riskProfile = 'STEADY';
                else if (rawProfile === 'BALANCED') riskProfile = 'TACTICAL';
                else if (rawProfile === 'RISK') riskProfile = 'ALPHA SWING';
                else riskProfile = rawProfile;

                console.log(`[Local Brain] ⚖️  Checking Risk Level Restrictions (${riskProfile})...`);
                const preAudit = await auditRiskCompliance(userId);

                if (preAudit) {
                    if (!preAudit.isCompliant) {
                        console.log(`[Local Brain] ⚠️  Non-Compliance Detected! ${preAudit.violations.length} Required Compliance Tasks:`);
                        preAudit.violations.forEach(v => console.log(`   • [${v.severity}] ${v.actionNeeded}`));
                    } else {
                        console.log(`[Local Brain] ✅ Risk Protocol: COMPLIANT`);
                    }
                }

                // 24/7 Watchdog Protection
                if (config.watchdogEnabled !== false) {
                    console.log(`[Local Brain] 🛡️ Running Watchdog for ${userId}...`);
                    try {
                        const watchdogRes = await runHoldingsWatchdog(userId);
                        if (watchdogRes.success && watchdogRes.message) {
                            console.log(`[Local Brain] Watchdog: ${watchdogRes.message}`);
                        }
                    } catch (watchdogErr) {
                        console.error(`[Local Brain] Watchdog failed for ${userId}:`, watchdogErr);
                    }
                }

                const result = await runAutomatedAgentCheck(userId, config);

                // Already defined above via mapping
                const scoreThreshold = (riskProfile === 'STEADY') ? 70 : (riskProfile === 'ALPHA SWING') ? 55 : 60;

                if (result.success && result.execution) {
                    const { trades, decisions, newCashBalance, newTotalValue, initialBalance } = result.execution;
                    const netProfit = (newTotalValue || 0) - (initialBalance || 0);
                    const profitPct = (initialBalance && initialBalance > 0) ? (netProfit / initialBalance) * 100 : 0;
                    const profitEmoji = netProfit >= 0 ? '📈' : '📉';

                    // ── TRADE EXECUTION SUMMARY ──────────────────────────────
                    console.log(`\n${'─'.repeat(60)}`);
                    console.log(`  📊 TRADING CYCLE REPORT  [Profile: ${riskProfile} | Threshold: ${scoreThreshold}+]`);
                    console.log(`${'─'.repeat(60)}`);

                    if (trades && trades.length > 0) {
                        console.log(`\n  ✅ EXECUTED TRADES (${trades.length}):`);
                        trades.forEach((t: any) => {
                            const emoji = t.type === 'BUY' ? '🟢' : '🔴';
                            console.log(`     ${emoji} [${t.type}] ${t.ticker.padEnd(8)} ${t.amount.toFixed(6)} units @ $${t.price.toFixed(2).padStart(10)} = $${t.total.toFixed(2).padStart(8)}`);
                            console.log(`         Reason: ${t.reason}`);
                        });
                    } else {
                        console.log(`\n  💤 NO TRADES EXECUTED THIS CYCLE`);
                    }

                    // ── DECISION BREAKDOWN ───────────────────────────────────
                    if (decisions && decisions.length > 0) {
                        // Group by action type
                        const buys = decisions.filter((d: any) => d.action === 'BUY');
                        const sells = decisions.filter((d: any) => d.action === 'SELL');
                        const skips = decisions.filter((d: any) => d.action === 'SKIP');
                        const throttled = decisions.filter((d: any) => d.action === 'THROTTLED');
                        const fails = decisions.filter((d: any) => d.action === 'FAIL');

                        // ── SKIPPED — grouped by reason category ─────────────
                        if (skips.length > 0 || throttled.length > 0) {
                            console.log(`\n  🚫 SKIPPED / BLOCKED (${skips.length + throttled.length} tokens):`);

                            // Sub-group skips by root cause
                            const lowScore = skips.filter((d: any) => d.reason?.includes('below threshold'));
                            const alreadyHeld = skips.filter((d: any) => d.reason?.includes('Already holding'));
                            const mcapBlock = skips.filter((d: any) => d.reason?.includes('Market Cap'));
                            const cooldown = [...skips.filter((d: any) => d.reason?.includes('Cooldown')), ...throttled];
                            const liquidity = skips.filter((d: any) => d.reason?.includes('liquidity') || d.reason?.includes('Insufficient'));
                            const other = skips.filter((d: any) =>
                                !d.reason?.includes('below threshold') &&
                                !d.reason?.includes('Already holding') &&
                                !d.reason?.includes('Market Cap') &&
                                !d.reason?.includes('Cooldown') &&
                                !d.reason?.includes('liquidity') &&
                                !d.reason?.includes('Insufficient')
                            );

                            if (lowScore.length > 0) {
                                console.log(`\n     📉 LOW SCORE (need ${scoreThreshold}+):`);
                                lowScore.forEach((d: any) => {
                                    const score = d.score ?? '?';
                                    const gap = typeof score === 'number' ? scoreThreshold - score : '?';
                                    const bar = typeof score === 'number'
                                        ? `[${'█'.repeat(Math.floor(score / 10))}${'░'.repeat(10 - Math.floor(score / 10))}]`
                                        : '';
                                    console.log(`        ${d.ticker.padEnd(8)} Score: ${String(score).padStart(3)} / ${scoreThreshold}  ${bar}  (${gap} short)`);
                                });
                            }

                            if (mcapBlock.length > 0) {
                                console.log(`\n     🏦 MARKET CAP TOO SMALL:`);
                                mcapBlock.forEach((d: any) => console.log(`        ${d.ticker.padEnd(8)} ${d.reason}`));
                            }

                            if (alreadyHeld.length > 0) {
                                console.log(`\n     📦 ALREADY HOLDING:`);
                                alreadyHeld.forEach((d: any) => console.log(`        ${d.ticker.padEnd(8)} Position already open`));
                            }

                            if (cooldown.length > 0) {
                                console.log(`\n     ⏳ ON COOLDOWN (traded recently):`);
                                cooldown.forEach((d: any) => console.log(`        ${d.ticker.padEnd(8)} ${d.reason}`));
                            }

                            if (liquidity.length > 0) {
                                console.log(`\n     💸 INSUFFICIENT CASH:`);
                                liquidity.forEach((d: any) => console.log(`        ${d.ticker.padEnd(8)} ${d.reason}`));
                            }

                            if (other.length > 0) {
                                console.log(`\n     ⚠️  OTHER:`);
                                other.forEach((d: any) => console.log(`        ${d.ticker.padEnd(8)} ${d.reason}`));
                            }
                        }

                        if (fails.length > 0) {
                            console.log(`\n  ❌ EXECUTION FAILURES (${fails.length}):`);
                            fails.forEach((d: any) => console.log(`     ${d.ticker.padEnd(8)} ${d.reason}`));
                        }
                    }

                    // ── PORTFOLIO SNAPSHOT ───────────────────────────────────
                    console.log(`\n${'─'.repeat(60)}`);
                    console.log(`  💰 Cash Balance: $${newCashBalance.toFixed(2)}`);
                    console.log(`  ${profitEmoji} Profit & Loss: $${netProfit.toFixed(2)} (${profitPct.toFixed(2)}%)`);
                    console.log(`${'─'.repeat(60)}\n`);

                } else if (!result.success) {
                    console.error(`[Local Brain] ❌ Trading Failed:`, (result as any).error || (result as any).message);
                }

                // 2. Audit Compliance AFTER actions to verify resolution
                const postAudit = await auditRiskCompliance(userId);
                if (postAudit) {
                    if (postAudit.isCompliant) {
                        console.log(`[Local Brain] ✅ Status: COMPLIANT (${postAudit.riskProfile}) - All risk restrictions enforced.`);
                    } else {
                        console.log(`[Local Brain] ⚠️ Status: NON-COMPLIANT (${postAudit.riskProfile})`);
                        console.log(`[Local Brain] 📋 Remaining Compliance Tasks:`);
                        postAudit.violations.forEach(v => console.log(`   • [${v.severity}] ${v.actionNeeded} (STILL PENDING)`));
                    }
                }


                // 3. AI Advisor Task Summary
                try {
                    console.log(`[Local Brain] 🧠 Fetching Strategic Advisor Tasks...`);
                    const vpRef = adminDb.collection('virtual_portfolio').doc(userId);
                    const vpSnap = await vpRef.get();
                    if (vpSnap.exists) {
                        const vpData = vpSnap.data();
                        const holdings = vpData?.holdings || {};
                        const portfolioItems = Object.entries(holdings).map(([ticker, h]: [string, any]) => ({
                            ticker,
                            amount: h.amount,
                            averagePrice: h.averagePrice
                        }));
                        const report = await getAdvisorReport(userId, portfolioItems, vpData?.cashBalance || 0, postAudit?.totalValue || 0);
                        if (report.taskSummary && report.taskSummary.length > 0) {
                            console.log(`[Strategic Advisor] 💡 Strategic Recommendations for Next Cycle (Confidence: ${report.confidenceScore}%):`);
                            report.taskSummary.forEach(task => console.log(`   • ${task}`));
                        }
                    }
                } catch (taskErr) {
                    console.error(`[Local Brain] Failed to fetch advisor tasks:`, taskErr);
                }
            }

        } catch (error) {
            console.error('[Local Brain Error]', error);
        } finally {
            isRunning = false;
            console.log(`\n✅ Adaptive Check Complete. [Time: ${new Date().toLocaleTimeString()}]`);
            console.log(`   Brain State: Idle. Monitoring Volatility & Ecosystems in background...`);
            console.log(`   Tip: Press [ENTER] to force a Manual Hybrid Scan.`);
        }
    };

    // Keyboard listener for manual triggers
    process.stdin.on('data', (data) => {
        if (data.toString().trim() === '') {
            console.log('\n[Manual] ⚡ Forcing immediate Hybrid Analysis Scan...');
            triggerCheck();
        }
    });

    console.log('   Tip: Press [ENTER] at any time to force an immediate analysis check.');

    // Start initial check immediately
    await triggerCheck();

    // Set recurring timer
    console.log('   Polling for due tasks every 1 minute...');
    setInterval(triggerCheck, 1 * 60 * 1000);
}

main().catch(console.error);
