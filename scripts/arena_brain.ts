import * as fs from 'fs';
import * as path from 'path';

// Load Environment Variables
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
        console.log('Environment variables loaded natively from .env.local');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTIVE CYCLE TIMING
// ═══════════════════════════════════════════════════════════════════════════
// Instead of fixed 3-min intervals, the brain adjusts its polling rate:
//   - FAST (2 min):  When holding positions AND any held token moved >3% in 24h
//   - NORMAL (5 min): Default pace — balanced between responsiveness and API budget
//   - SLOW (10 min):  When all tokens are moving <1% — nothing's happening
//
// This saves API calls during quiet periods and reacts faster during volatility.

const CYCLE_FAST_MS = 2 * 60 * 1000;     // 2 minutes
const CYCLE_NORMAL_MS = 5 * 60 * 1000;   // 5 minutes
const CYCLE_SLOW_MS = 10 * 60 * 1000;    // 10 minutes

let lastCycleResult: {
    hasHoldings: boolean;
    maxChange24h: number;
    tradesExecuted: number;
} = { hasHoldings: false, maxChange24h: 0, tradesExecuted: 0 };

function getAdaptiveInterval(): { ms: number; label: string } {
    const { hasHoldings, maxChange24h, tradesExecuted } = lastCycleResult;

    // If a trade just happened, check again soon
    if (tradesExecuted > 0) {
        return { ms: CYCLE_FAST_MS, label: 'FAST (trade just executed)' };
    }

    // If holding AND volatile, monitor closely
    if (hasHoldings && Math.abs(maxChange24h) > 3) {
        return { ms: CYCLE_FAST_MS, label: `FAST (holding + ${maxChange24h > 0 ? '+' : ''}${maxChange24h.toFixed(1)}% volatility)` };
    }

    // If everything is calm (all tokens <1% change), slow down
    if (Math.abs(maxChange24h) < 1) {
        return { ms: CYCLE_SLOW_MS, label: `SLOW (max change ${maxChange24h > 0 ? '+' : ''}${maxChange24h.toFixed(1)}%)` };
    }

    // Default
    return { ms: CYCLE_NORMAL_MS, label: 'NORMAL' };
}

async function main() {
    console.log('\n' + '═'.repeat(60));
    console.log('  🏟️ SEMAPHORE ARENA BRAIN v2.0');
    console.log('  Mode: Autonomous Multi-Strategy • Real-Trading');
    console.log('  Features: Real Technicals • Order Book • Adaptive Timing');
    console.log('  Reports: 8:00 AM (Morning) • 6:00 PM (Evening) via Telegram');
    console.log('═'.repeat(60));

    const { adminDb } = await import('../src/lib/firebase-admin');
    const { runArenaCycle, generateStrategyReport } = await import('../src/app/actions');
    const { sendSystemAlert } = await import('../src/services/telegramService');

    if (!adminDb) {
        console.error('CRITICAL: Firebase Admin SDK not initialized.');
        process.exit(1);
    }

    let isRunning = false;
    let cycleCount = 0;

    // ── Report scheduling ───────────────────────────────────────────────
    const REPORT_HOURS = [8, 18]; // 8am and 6pm
    let lastReportHour = -1;

    async function checkAndSendReport(userId: string) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Only trigger within the first 10 minutes of a report hour
        if (!REPORT_HOURS.includes(currentHour) || currentMinute > 10) return;
        if (lastReportHour === currentHour) return; // Already sent this hour

        lastReportHour = currentHour;
        console.log(`\n  📊 Generating ${currentHour < 12 ? 'MORNING' : 'EVENING'} Strategy Intelligence Report...`);

        try {
            const report = await generateStrategyReport(userId);
            if (!report) {
                console.warn('  ⚠️ Report generation returned null');
                return;
            }

            // Format Telegram message
            const timeLabel = report.reportType === 'MORNING' ? '☀️ MORNING BRIEFING' : '🌙 EVENING BRIEFING';
            const pnlIcon = report.overallPnlPct >= 0 ? '📈' : '📉';

            let msg = `🏟️ <b>SEMAPHORE ARENA — ${timeLabel}</b>\n`;
            msg += `📅 ${now.toLocaleDateString('en-GB')} at ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}\n\n`;
            msg += `${pnlIcon} <b>Total NAV:</b> $${report.overallNAV.toFixed(2)} (${report.overallPnlPct >= 0 ? '+' : ''}${report.overallPnlPct.toFixed(2)}%)\n\n`;

            msg += `<b>━━━ POOL GRADES ━━━</b>\n`;
            for (const pa of report.poolAnalyses) {
                const pIcon = pa.pnlPct >= 0 ? '🟢' : '🔴';
                msg += `${pa.emoji} <b>${pa.poolName}</b> [${pa.grade}] ${pIcon}\n`;
                msg += `  $${pa.nav.toFixed(2)} (${pa.pnlPct >= 0 ? '+' : ''}${pa.pnlPct.toFixed(2)}%) | ${pa.trades} trades (${pa.wins}W/${pa.losses}L)\n`;
                msg += `  <i>${pa.keyInsight}</i>\n\n`;
            }

            msg += `<b>━━━ ANALYSIS ━━━</b>\n`;
            msg += `${report.comparativeAnalysis}\n\n`;

            msg += `<b>━━━ OUTLOOK ━━━</b>\n`;
            msg += `${report.marketOutlook}\n\n`;

            if (report.recommendations.length > 0) {
                msg += `<b>━━━ RECOMMENDATIONS ━━━</b>\n`;
                report.recommendations.forEach(r => { msg += `▸ ${r}\n`; });
                msg += '\n';
            }

            if (report.riskAlerts.length > 0) {
                msg += `<b>⚠️ RISK ALERTS</b>\n`;
                report.riskAlerts.forEach(r => { msg += `🔴 ${r}\n`; });
                msg += '\n';
            }

            msg += `🏆 Leader: ${report.leaderPool} | 📊 Laggard: ${report.laggardPool}`;

            await sendSystemAlert('Strategy Intelligence Report', msg, '📊');
            console.log(`  ✅ ${report.reportType} report sent to Telegram.`);
        } catch (e: any) {
            console.error(`  ❌ Report failed: ${e.message}`);
        }
    }

    const triggerCheck = async () => {
        if (isRunning) return;
        isRunning = true;
        cycleCount++;
        const cycleStart = Date.now();

        try {
            const interval = getAdaptiveInterval();
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`  🔥 ARENA CYCLE #${cycleCount} [${new Date().toLocaleTimeString()}] | Mode: ${interval.label}`);
            console.log('─'.repeat(60));

            const arenaSnap = await adminDb.collection('arena_config').where('initialized', '==', true).get();

            if (arenaSnap.empty) {
                console.log('  ⏳ No active initialized arenas. Awaiting initialization.');
                lastCycleResult = { hasHoldings: false, maxChange24h: 0, tradesExecuted: 0 };
                return;
            }

            for (const doc of arenaSnap.docs) {
                const userId = doc.id;

                try {
                    const result = await runArenaCycle(userId);

                    if (result.success) {
                        const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
                        console.log(`\n  ✅ Cycle #${cycleCount} complete in ${elapsed}s — ${result.totalTrades} trade(s)`);

                        // Track state for adaptive timing
                        const arenaData = doc.data();
                        let hasHoldings = false;
                        let maxChange = 0;

                        for (const pool of arenaData.pools || []) {
                            if (Object.keys(pool.holdings || {}).length > 0) hasHoldings = true;
                        }

                        result.poolResults.forEach((p: any) => {
                            console.log(`     ${p.poolId}: ${p.trades} trades | $${p.value.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%)`);
                            if (Math.abs(p.pnlPct) > Math.abs(maxChange)) maxChange = p.pnlPct;
                        });

                        lastCycleResult = {
                            hasHoldings,
                            maxChange24h: maxChange,
                            tradesExecuted: result.totalTrades,
                        };

                        // Check if it's time for a scheduled report
                        await checkAndSendReport(userId);
                    } else {
                        console.log(`  📉 Cycle unsuccessful for user ${userId.substring(0, 8)}`);
                    }
                } catch (userErr: any) {
                    console.error(`  ❌ Error for ${userId.substring(0, 8)}: ${userErr.message?.substring(0, 120)}`);
                }
            }
        } catch (error: any) {
            console.error(`  ❌ Fatal: ${error.message}`);
        } finally {
            isRunning = false;

            // Schedule next cycle with adaptive timing
            const next = getAdaptiveInterval();
            const nextMin = (next.ms / 60000).toFixed(1);
            console.log(`\n  ⏱️  Next cycle in ${nextMin}m [${next.label}]`);
            console.log(`  💡 Press [ENTER] to force immediate scan`);

            setTimeout(triggerCheck, next.ms);
        }
    };

    // Keyboard listener for manual triggers
    process.stdin.on('data', (data) => {
        if (data.toString().trim() === '') {
            console.log('\n  ⚡ Manual trigger — forcing immediate scan...');
            triggerCheck();
        }
    });

    // Start immediately
    await triggerCheck();
}

main().catch(console.error);
