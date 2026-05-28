/**
 * NYSE ARENA CRON — Every 60 minutes during NYSE market hours
 *
 * Market hours gate: 14:30–21:00 UTC, Mon–Fri only.
 * Uses EODHD with .US suffix for US equity pricing.
 * Works in both sandbox and competition mode.
 *
 * EOD ROTATION (Scenario C) — fires once per trading day at 21:05–21:15 UTC.
 * Checks idle-ticker gates for each pool and asks the AI to propose a
 * catalyst-driven replacement if one qualifies. All swaps are gated on:
 *   - ≥ 3 consecutive idle sessions for the outgoing ticker
 *   - ≥ 7 calendar days since the pool's last rotation
 *   - AI confidence ≥ 65 in the replacement candidate
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle, performSelectiveCatalystRotation } from '@/app/actions';
import { sendSystemAlert } from '@/services/telegramService';

export const maxDuration = 300;

// NYSE: 09:30–16:00 ET = 14:30–21:00 UTC (no DST complexity — ET shifts too)
// We gate 14:00–21:30 UTC to give a slight buffer around open/close.
function isNYSEOpen(): boolean {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;

    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const totalMin = hour * 60 + min;

    // 14:00–21:30 UTC bracket
    return totalMin >= 14 * 60 && totalMin <= 21 * 60 + 30;
}

// EOD rotation window: 21:05–21:15 UTC — just after NYSE close (21:00 UTC)
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
    if (MOTHBALLED_ASSET_CLASSES.includes('NYSE')) {
        return NextResponse.json({ status: 'mothballed', arena: 'NYSE' });
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
        if (isNYSEOpen()) {
            for (const doc of usersSnap.docs) {
                const userId = doc.id;
                try {
                    const cycleResult = await runSandboxArenaCycle(userId, 'NYSE');
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
                const rotationKey = `nyseRotationRunDate`;
                if (config[rotationKey] === today) {
                    results.push({ userId: userId.substring(0, 8), action: 'eod_rotation', status: 'already_run_today' });
                    continue;
                }

                try {
                    const rotationResult = await performSelectiveCatalystRotation(userId, 'NYSE');

                    if (rotationResult.rotations.length > 0) {
                        const now = new Date();
                        let msg = `🔄 <b>NYSE SCENARIO C — EOD ROTATION</b>\n`;
                        msg += `📅 ${now.toLocaleDateString('en-GB')} | Selective Catalyst Rotation\n\n`;
                        for (const r of rotationResult.rotations) {
                            msg += `📊 <b>Pool ${r.poolId}</b>\n`;
                            msg += `  OUT: <s>${r.outTicker}</s>  →  IN: <b>${r.inTicker}</b>\n`;
                            msg += `  <i>${r.reason.substring(0, 250)}</i>\n\n`;
                        }
                        msg += `<i>Next rotation eligible in 7 calendar days per pool.</i>`;
                        try { await sendSystemAlert('NYSE EOD Rotation', msg, '🔄'); } catch { /* non-fatal */ }
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

        if (!isNYSEOpen() && !isEODRotationWindow()) {
            return NextResponse.json({
                status: 'market_closed',
                arena: 'NYSE',
                message: 'NYSE not open and not in EOD rotation window — skipping.',
            });
        }

        return NextResponse.json({ status: 'ok', arena: 'NYSE', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
