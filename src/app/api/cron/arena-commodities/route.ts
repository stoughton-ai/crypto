/**
 * COMMODITIES ARENA CRON — Every 60 minutes during extended trading hours
 *
 * Market hours gate: Mon 23:00 UTC – Fri 22:00 UTC (CME Globex schedule).
 * Effectively runs Mon–Fri during daytime and overnight hours.
 * Uses EODHD with .US suffix for commodity ETF pricing (GLD, USO, WEAT etc.).
 * Works in both sandbox and competition mode.
 *
 * EOD ROTATION (Scenario C) — fires once per trading day at 21:05–21:15 UTC.
 * Commodity ETFs track NYSE hours (21:00 UTC close), so the rotation window
 * mirrors the NYSE one. Only swaps a ticker when ALL gates pass:
 *   - ≥ 3 consecutive idle sessions for the outgoing ticker
 *   - ≥ 7 calendar days since the pool's last rotation
 *   - AI confidence ≥ 65 in the replacement candidate
 * Catalyst guidance for commodities focuses on supply/demand fundamentals,
 * macro regime shifts, and geopolitical risk rather than company earnings.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle, performSelectiveCatalystRotation } from '@/app/actions';
import { sendSystemAlert } from '@/services/telegramService';

export const maxDuration = 300;

// CME Globex commodities trade roughly Sun 23:00 – Fri 22:00 UTC.
// Simple gate: active Mon–Fri all hours, inactive Sat–Sun.
function isCommoditiesOpen(): boolean {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    // Active Mon(1)–Fri(5). Also active Sunday evening from 23:00.
    if (day === 6) return false; // Saturday — fully closed
    if (day === 0) {
        // Sunday — open after 23:00 UTC
        return now.getUTCHours() >= 23;
    }
    if (day === 5) {
        // Friday — closes at 22:00 UTC
        return now.getUTCHours() < 22;
    }
    return true; // Mon–Thu: always open
}

// EOD rotation window: 21:05–21:15 UTC — mirrors NYSE ETF close (21:00 UTC)
// Commodity ETFs (GLD, USO, WEAT etc.) all trade on NYSE and settle at 21:00 UTC.
function isEODRotationWindow(): boolean {
    const now = new Date();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return false;

    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const totalMin = hour * 60 + min;

    return totalMin >= 21 * 60 + 5 && totalMin <= 21 * 60 + 15;
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { MOTHBALLED_ASSET_CLASSES } = await import('@/lib/constants');
    if (MOTHBALLED_ASSET_CLASSES.includes('COMMODITIES')) {
        return NextResponse.json({ status: 'mothballed', arena: 'COMMODITIES' });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        if (usersSnap.empty) return NextResponse.json({ status: 'no_users' });

        const results: any[] = [];

        // ── 1. Standard hourly trading cycle ─────────────────────────────────
        if (isCommoditiesOpen()) {
            for (const doc of usersSnap.docs) {
                const userId = doc.id;
                try {
                    const cycleResult = await runSandboxArenaCycle(userId, 'COMMODITIES');
                    results.push({
                        userId: userId.substring(0, 8),
                        action: 'trading_cycle',
                        status: cycleResult.success ? 'completed' : 'skipped',
                        trades: cycleResult.totalTrades,
                    });
                } catch (e: any) {
                    results.push({ userId: userId.substring(0, 8), action: 'trading_cycle', status: 'error', error: e.message });
                }
            }
        }

        // ── 2. Scenario C — EOD Selective Catalyst Rotation ──────────────────
        if (isEODRotationWindow()) {
            const today = new Date().toISOString().slice(0, 10);

            for (const doc of usersSnap.docs) {
                const userId = doc.id;
                const config = doc.data();

                // Idempotency — only run once per calendar day per user
                const rotationKey = `commoditiesRotationRunDate`;
                if (config[rotationKey] === today) {
                    results.push({ userId: userId.substring(0, 8), action: 'eod_rotation', status: 'already_run_today' });
                    continue;
                }

                try {
                    const rotationResult = await performSelectiveCatalystRotation(userId, 'COMMODITIES');

                    if (rotationResult.rotations.length > 0) {
                        const now = new Date();
                        let msg = `🔄 <b>COMMODITIES SCENARIO C — EOD ROTATION</b>\n`;
                        msg += `📅 ${now.toLocaleDateString('en-GB')} | Selective Catalyst Rotation\n\n`;
                        for (const r of rotationResult.rotations) {
                            msg += `📊 <b>Pool ${r.poolId}</b>\n`;
                            msg += `  OUT: <s>${r.outTicker}</s>  →  IN: <b>${r.inTicker}</b>\n`;
                            msg += `  <i>${r.reason.substring(0, 250)}</i>\n\n`;
                        }
                        msg += `<i>Next rotation eligible in 7 calendar days per pool.</i>`;
                        try { await sendSystemAlert('Commodities EOD Rotation', msg, '🔄'); } catch { /* non-fatal */ }
                    }

                    await adminDb.collection('agent_configs').doc(userId).set(
                        { [rotationKey]: today },
                        { merge: true }
                    );

                    results.push({
                        userId: userId.substring(0, 8),
                        action: 'eod_rotation',
                        status: 'completed',
                        rotations: rotationResult.rotations.length,
                        message: rotationResult.message,
                    });
                } catch (e: any) {
                    results.push({ userId: userId.substring(0, 8), action: 'eod_rotation', status: 'error', error: e.message });
                }
            }
        }

        if (!isCommoditiesOpen() && !isEODRotationWindow()) {
            return NextResponse.json({
                status: 'market_closed',
                arena: 'COMMODITIES',
                message: 'CME Globex closed and not in EOD rotation window — skipping.',
            });
        }

        return NextResponse.json({ status: 'ok', arena: 'COMMODITIES', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
