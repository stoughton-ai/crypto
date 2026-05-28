import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    const { generateStrategyReport, generateWeeklyComparisonReport } = await import('../src/app/actions');
    const { sendSystemAlert } = await import('../src/services/telegramService');

    // ─── Find user ────────────────────────────────────────────────────────
    const snap = await adminDb!.collection('arena_config').limit(1).get();
    if (snap.empty) { console.error('❌ No arena_config found'); process.exit(1); }
    const userId = snap.docs[0].id;
    console.log(`\n🎯 User: ${userId.substring(0, 12)}...\n`);

    // ─── Step 1: Delete stale reports ────────────────────────────────────
    console.log('🗑️  Deleting stale reports...');
    await adminDb!.collection('arena_reports').doc(userId).delete();
    console.log('   ✅ arena_reports deleted');
    await adminDb!.collection('arena_weekly_reports').doc(userId).delete();
    console.log('   ✅ arena_weekly_reports deleted');

    // ─── Step 2: Regenerate Strategy Report ──────────────────────────────
    console.log('\n📊 Regenerating Strategy Intelligence Report...');
    const report = await generateStrategyReport(userId);
    if (!report) {
        console.error('❌ Strategy report generation failed');
        process.exit(1);
    }
    console.log(`   ✅ Report generated: ${report.reportType}`);
    console.log(`   NAV: $${report.overallNAV.toFixed(2)} (${report.overallPnlPct >= 0 ? '+' : ''}${report.overallPnlPct.toFixed(2)}%)`);
    console.log(`   vs BTC: ${(report.overallVsBtc ?? 0) >= 0 ? '+' : ''}${(report.overallVsBtc ?? 0).toFixed(2)}%`);
    console.log(`   Leader: ${report.leaderPool} | Laggard: ${report.laggardPool}`);
    console.log('\n─── POOL GRADES ───');
    for (const pa of report.poolAnalyses) {
        console.log(`   ${pa.emoji} ${pa.poolName} [${pa.grade}] — ${pa.pnlPct >= 0 ? '+' : ''}${pa.pnlPct.toFixed(2)}%`);
        console.log(`     💡 ${pa.keyInsight}`);
    }

    // ─── Step 3: Regenerate Weekly Comparison Report ─────────────────────
    console.log('\n📋 Regenerating Weekly Comparison Report...');
    const weekly = await generateWeeklyComparisonReport(userId);
    if (!weekly) {
        console.error('❌ Weekly report generation failed');
        process.exit(1);
    }
    console.log(`   ✅ Weekly report generated — Week ${weekly.weekNumber}/4`);
    console.log(`   GPM Scale-Downs: ${weekly.gpmScaleDownCount} | Scale-Ups: ${weekly.gpmScaleUpCount} (${weekly.gpmEarlyScaleUpCount} early)`);
    console.log('\n─── PER POOL VERDICTS ───');
    weekly.perPoolSummaries.forEach(p => {
        console.log(`   ${p.emoji ?? ''} ${p.poolName} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%): ${p.verdict}`);
    });

    // ─── Step 4: Send Strategy Report to Telegram ────────────────────────
    console.log('\n📱 Sending regenerated strategy report to Telegram...');
    const now = new Date();
    const timeLabel = report.reportType === 'MORNING' ? '☀️ MORNING BRIEFING' : '🌙 EVENING BRIEFING';
    const overallIcon = report.overallPnlPct >= 0 ? '📈' : '📉';
    const benchmarkIcon = (report.overallVsBtc ?? 0) >= 0 ? '🟢' : '🔴';
    const benchmarkText = (report.overallVsBtc ?? 0) >= 0
        ? `OUTPERFORMING BTC by +${(report.overallVsBtc ?? 0).toFixed(2)}%`
        : `LAGGING BTC by ${(report.overallVsBtc ?? 0).toFixed(2)}%`;

    let msg = `🏟️ <b>SEMAPHORE ARENA — ${timeLabel}</b> [REGENERATED]\n`;
    msg += `📅 ${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC\n\n`;

    msg += `<b>━━━ PORTFOLIO STATUS ━━━</b>\n`;
    msg += `${overallIcon} <b>Total NAV:</b> $${report.overallNAV.toFixed(2)} (${report.overallPnlPct >= 0 ? '+' : ''}${report.overallPnlPct.toFixed(2)}%)\n`;
    msg += `${benchmarkIcon} <b>vs BTC:</b> ${benchmarkText}\n`;
    msg += `🏆 Leader: ${report.leaderPool}  |  📉 Laggard: ${report.laggardPool}\n\n`;

    msg += `<b>━━━ POOL SNAPSHOT ━━━</b>\n`;
    for (const pa of report.poolAnalyses) {
        const vsBtc = pa.vsBtc ?? 0;
        const poolIcon = pa.pnlPct >= 0 ? '🟢' : vsBtc >= -2 ? '🟡' : '🔴';
        msg += `${pa.emoji} <b>${pa.poolName}</b> [${pa.grade}] ${poolIcon}\n`;
        msg += `  $${pa.nav.toFixed(2)} (${pa.pnlPct >= 0 ? '+' : ''}${pa.pnlPct.toFixed(2)}% | ${vsBtc >= 0 ? '+' : ''}${vsBtc.toFixed(2)}% vs BTC)\n`;
        msg += `  ${pa.tokens?.join('/')} | ${pa.trades} trades (${pa.wins}W/${pa.losses}L)\n`;
        msg += `  <i>${pa.keyInsight}</i>\n\n`;
    }

    if (report.predictions && report.predictions.length > 0) {
        msg += `<b>━━━ 24H FORECAST ━━━</b>\n`;
        for (const pred of report.predictions) {
            const biasIcon = pred.bias === 'BULLISH' ? '🟢' : pred.bias === 'NEUTRAL_TO_BULLISH' ? '🔼' : pred.bias === 'NEUTRAL' ? '⬜' : pred.bias === 'NEUTRAL_TO_BEARISH' ? '🔽' : '🔴';
            msg += `${biasIcon} <b>${pred.token}</b>  $${pred.priceRangeLow.toFixed(3)}–$${pred.priceRangeHigh.toFixed(3)}\n`;
            msg += `  Watch: $${pred.keyLevelToWatch.toFixed(3)} | <i>${pred.rationale}</i>\n`;
        }
        msg += '\n';
    }

    msg += `<b>━━━ ANALYSIS ━━━</b>\n${report.comparativeAnalysis}\n\n`;
    msg += `<b>━━━ OUTLOOK ━━━</b>\n${report.marketOutlook}\n\n`;
    if (report.campaignProgress) msg += `<b>━━━ CAMPAIGN TRAJECTORY ━━━</b>\n${report.campaignProgress}\n\n`;
    if (report.recommendations.length > 0) {
        msg += `<b>━━━ RECOMMENDATIONS ━━━</b>\n`;
        report.recommendations.forEach(r => { msg += `▸ ${r}\n`; });
        msg += '\n';
    }
    if (report.riskAlerts.length > 0) {
        msg += `<b>⚡ WATCH POINTS</b>\n`;
        report.riskAlerts.forEach(r => { msg += `🟡 ${r}\n`; });
        msg += '\n';
    }
    if (report.tradeDecisions) msg += `<b>━━━ WHAT THE AI DID & WHY ━━━</b>\n${report.tradeDecisions}\n\n`;
    if (report.gpmSummary) msg += `<b>━━━ GPM SCALING ACTIVITY ━━━</b>\n${report.gpmSummary}\n\n`;

    await sendSystemAlert('Semaphore Arena — Regenerated Report', msg, '🔄');
    console.log('   ✅ Sent to Telegram!\n');

    console.log('🎉 Done — both reports deleted and regenerated successfully.');
    process.exit(0);
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
