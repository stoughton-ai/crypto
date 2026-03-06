import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { generateStrategyReport } = await import('../src/app/actions');
    const { sendSystemAlert } = await import('../src/services/telegramService');

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    console.log('📊 Generating Strategy Intelligence Report (FULL TEST)...');
    console.log('─────────────────────────────────────────────────────');

    const report = await generateStrategyReport(userId);
    if (!report) {
        console.error('❌ Report generation failed');
        process.exit(1);
    }

    console.log(`\n✅ Report generated: ${report.reportType}`);
    console.log(`   NAV: $${report.overallNAV.toFixed(2)} (${report.overallPnlPct >= 0 ? '+' : ''}${report.overallPnlPct.toFixed(2)}%)`);
    console.log(`   vs BTC: ${(report.overallVsBtc ?? 0) >= 0 ? '+' : ''}${(report.overallVsBtc ?? 0).toFixed(2)}% (${(report.overallVsBtc ?? 0) >= 0 ? 'OUTPERFORMING' : 'LAGGING'})`);
    console.log(`   Leader: ${report.leaderPool} | Laggard: ${report.laggardPool}`);

    console.log('\n─── POOL GRADES ───');
    for (const pa of report.poolAnalyses) {
        const vsBtcStr = `${(pa.vsBtc ?? 0) >= 0 ? '+' : ''}${(pa.vsBtc ?? 0).toFixed(2)}% vs BTC`;
        console.log(`  ${pa.emoji} ${pa.poolName} [${pa.grade}] — ${pa.pnlPct >= 0 ? '+' : ''}${pa.pnlPct.toFixed(2)}% (${vsBtcStr})`);
        console.log(`     ${pa.assessment}`);
        console.log(`     💡 ${pa.keyInsight}`);
    }

    console.log('\n─── 24H PREDICTIONS ───');
    for (const pred of (report.predictions || [])) {
        console.log(`  ${pred.token}: ${pred.bias} ($${pred.priceRangeLow.toFixed(3)}–$${pred.priceRangeHigh.toFixed(3)}) | Watch: $${pred.keyLevelToWatch.toFixed(3)}`);
        console.log(`     ${pred.rationale}`);
    }

    console.log(`\n─── ANALYSIS ───`);
    console.log(`  ${report.comparativeAnalysis}`);
    console.log(`\n─── OUTLOOK ───`);
    console.log(`  ${report.marketOutlook}`);
    console.log(`\n─── CAMPAIGN TRAJECTORY ───`);
    console.log(`  ${report.campaignProgress}`);
    console.log(`\n─── RECOMMENDATIONS ───`);
    report.recommendations.forEach(r => console.log(`  ▸ ${r}`));
    if (report.riskAlerts.length > 0) {
        console.log(`\n─── ⚡ WATCH POINTS ───`);
        report.riskAlerts.forEach(r => console.log(`  🟡 ${r}`));
    } else {
        console.log('\n  ✅ No risk alerts — thresholds not breached');
    }

    // Build the new-format Telegram message (matching eod/route.ts)
    const now = new Date();
    const timeLabel = report.reportType === 'MORNING' ? '☀️ MORNING BRIEFING' : '🌙 EVENING BRIEFING';
    const overallIcon = report.overallPnlPct >= 0 ? '📈' : '📉';
    const benchmarkIcon = (report.overallVsBtc ?? 0) >= 0 ? '🟢' : '🔴';
    const benchmarkText = (report.overallVsBtc ?? 0) >= 0
        ? `OUTPERFORMING BTC by +${(report.overallVsBtc ?? 0).toFixed(2)}%`
        : `LAGGING BTC by ${(report.overallVsBtc ?? 0).toFixed(2)}%`;

    let msg = `🏟️ <b>SEMAPHORE ARENA — ${timeLabel}</b> [TEST]\n`;
    msg += `📅 ${now.toLocaleDateString('en-GB')} | ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC\n\n`;

    // Portfolio status block
    msg += `<b>━━━ PORTFOLIO STATUS ━━━</b>\n`;
    msg += `${overallIcon} <b>Total NAV:</b> $${report.overallNAV.toFixed(2)} (${report.overallPnlPct >= 0 ? '+' : ''}${report.overallPnlPct.toFixed(2)}%)\n`;
    msg += `${benchmarkIcon} <b>vs BTC Benchmark:</b> ${benchmarkText}\n`;
    msg += `🏆 Leader: ${report.leaderPool}  |  📉 Laggard: ${report.laggardPool}\n\n`;

    // Pool snapshot — compact, colour-coded
    msg += `<b>━━━ POOL SNAPSHOT ━━━</b>\n`;
    for (const pa of report.poolAnalyses) {
        const vsBtc = pa.vsBtc ?? 0;
        const poolIcon = pa.pnlPct >= 0 ? '🟢' : vsBtc >= -2 ? '🟡' : '🔴';
        const pnlStr = `${pa.pnlPct >= 0 ? '+' : ''}${pa.pnlPct.toFixed(2)}%`;
        const vsBtcStr = `${vsBtc >= 0 ? '+' : ''}${vsBtc.toFixed(2)}% vs BTC`;
        msg += `${pa.emoji} <b>${pa.poolName}</b> [${pa.grade}] ${poolIcon}\n`;
        msg += `  $${pa.nav.toFixed(2)} (${pnlStr} | ${vsBtcStr})\n`;
        msg += `  ${pa.tokens?.join('/')} | ${pa.trades} trades (${pa.wins}W/${pa.losses}L)\n`;
        msg += `  <i>${pa.keyInsight}</i>\n\n`;
    }

    // 24h Token Predictions
    if (report.predictions && report.predictions.length > 0) {
        msg += `<b>━━━ 24H FORECAST ━━━</b>\n`;
        for (const pred of report.predictions) {
            const biasIcon =
                pred.bias === 'BULLISH' ? '🟢' :
                    pred.bias === 'NEUTRAL_TO_BULLISH' ? '🔼' :
                        pred.bias === 'NEUTRAL' ? '⬜' :
                            pred.bias === 'NEUTRAL_TO_BEARISH' ? '🔽' : '🔴';
            msg += `${biasIcon} <b>${pred.token}</b>  $${pred.priceRangeLow.toFixed(3)}–$${pred.priceRangeHigh.toFixed(3)}\n`;
            msg += `  Watch: $${pred.keyLevelToWatch.toFixed(3)} | <i>${pred.rationale}</i>\n`;
        }
        msg += '\n';
    }

    // Comparative analysis
    msg += `<b>━━━ ANALYSIS ━━━</b>\n`;
    msg += `${report.comparativeAnalysis}\n\n`;

    // Market outlook
    msg += `<b>━━━ OUTLOOK ━━━</b>\n`;
    msg += `${report.marketOutlook}\n\n`;

    // Campaign progress
    if (report.campaignProgress) {
        msg += `<b>━━━ CAMPAIGN TRAJECTORY ━━━</b>\n`;
        msg += `${report.campaignProgress}\n\n`;
    }

    // Recommendations
    if (report.recommendations.length > 0) {
        msg += `<b>━━━ RECOMMENDATIONS ━━━</b>\n`;
        report.recommendations.forEach(r => { msg += `▸ ${r}\n`; });
        msg += '\n';
    }

    // Risk alerts — only shown if real threshold breaches
    if (report.riskAlerts.length > 0) {
        msg += `<b>⚡ WATCH POINTS</b>\n`;
        report.riskAlerts.forEach(r => { msg += `🟡 ${r}\n`; });
        msg += '\n';
    }

    console.log('\n─────────────────────────────────────────────────────');
    console.log('📱 Sending to Telegram...');
    await sendSystemAlert('Strategy Intelligence Report — ONE-OFF TEST', msg, '📊');
    console.log('✅ Report sent to Telegram!');

    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
