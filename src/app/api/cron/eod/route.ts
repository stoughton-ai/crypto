/**
 * EOD CRON — Runs every 5 minutes on Vercel
 *
 * Handles:
 *   1. Morning Strategy Intelligence Report
 *        Weekdays (Mon–Fri): 07:05 UTC
 *        Weekends (Sat–Sun): 08:00 UTC
 *   2. Evening Strategy Intelligence Report: 18:00 UTC (daily)
 *   3. End-of-day Telegram summary: 21:00 UTC (configurable per user)
 *
 * This replaces the local arena_brain.ts report scheduling,
 * ensuring reports are sent even when the local process isn't running.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendEndOfDayTelegramReport, generateStrategyReport } from '@/app/actions';
import { sendSystemAlert } from '@/services/telegramService';

export const maxDuration = 120;

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();
        const today = now.toISOString().slice(0, 10);

        // Day-of-week awareness (0 = Sunday, 6 = Saturday)
        const dayOfWeek = now.getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // Morning hour: 07:xx UTC on weekdays, 08:xx UTC on weekends
        const morningHour = isWeekend ? 8 : 7;
        // Evening hour: 18:xx UTC every day
        const eveningHour = 18;

        const results = [];

        for (const doc of usersSnap.docs) {
            const userId = doc.id;
            const config = doc.data();

            // ── 1. Strategy Intelligence Reports ──
            const isMorningWindow = currentHour === morningHour && currentMinute <= 10;
            const isEveningWindow = currentHour === eveningHour && currentMinute <= 10;

            if (isMorningWindow || isEveningWindow) {
                // Dedup key includes the actual trigger hour to avoid collisions
                const reportKey = `lastReportSent_${currentHour}_${today}`;

                // Check if already sent this hour today
                if (config[reportKey] !== true) {
                    try {
                        const report = await generateStrategyReport(userId);
                        if (report) {
                            const timeLabel = report.reportType === 'MORNING' ? '☀️ MORNING BRIEFING' : '🌙 EVENING BRIEFING';
                            const overallIcon = report.overallPnlPct >= 0 ? '📈' : '📉';
                            const benchmarkIcon = (report.overallVsBtc ?? 0) >= 0 ? '🟢' : '🔴';
                            const benchmarkText = (report.overallVsBtc ?? 0) >= 0
                                ? `OUTPERFORMING BTC by +${(report.overallVsBtc ?? 0).toFixed(2)}%`
                                : `LAGGING BTC by ${(report.overallVsBtc ?? 0).toFixed(2)}%`;

                            let msg = `🏟️ <b>SEMAPHORE ARENA — ${timeLabel}</b>\n`;
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

                            // Comparative analysis (shortened if needed)
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

                            await sendSystemAlert('Strategy Intelligence Report', msg, '📊');

                            // Mark as sent to prevent duplicate
                            await adminDb.collection('agent_configs').doc(userId).set({
                                [reportKey]: true,
                            }, { merge: true });

                            results.push({ userId: userId.substring(0, 8), action: 'strategy_report', hour: currentHour, status: 'sent' });
                        }
                    } catch (e: any) {
                        results.push({ userId: userId.substring(0, 8), action: 'strategy_report', error: e.message });
                    }
                }
            }

            // ── 2. EOD Telegram Report (configurable hour, default 21:00 UTC) ──
            const reportHour = config.telegramReportHour ?? 21;
            if (currentHour === reportHour) {
                if (config.telegramLastReportDate !== today) {
                    try {
                        const result = await sendEndOfDayTelegramReport(userId);
                        results.push({ userId: userId.substring(0, 8), action: 'eod_report', ...result });
                    } catch (e: any) {
                        results.push({ userId: userId.substring(0, 8), action: 'eod_report', error: e.message });
                    }
                }
            }
        }

        return NextResponse.json({ status: 'ok', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
