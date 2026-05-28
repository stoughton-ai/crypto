/**
 * FTSE ARENA CRON — Every 60 minutes during LSE market hours
 *
 * Market hours gate: 08:00–16:30 London time (BST/GMT), Mon–Fri only.
 * Uses EODHD with .LSE suffix for UK equity pricing.
 * Works in both sandbox and competition mode.
 *
 * EOD ROTATION (Scenario C) — fires once per trading day at 16:35–16:45 UTC.
 * Checks idle-ticker gates for each pool and asks the AI to propose a
 * catalyst-driven replacement if one qualifies. All swaps are gated on:
 *   - ≥ 3 consecutive idle sessions for the outgoing ticker
 *   - ≥ 7 calendar days since the pool's last rotation
 *   - AI confidence ≥ 65 in the replacement candidate
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle, performFTSESelectiveRotation } from '@/app/actions';
import { sendSystemAlert } from '@/services/telegramService';

export const maxDuration = 300;

// Is it currently within LSE market hours? (UTC)
// BST (Mar–Oct): 07:00–15:30 UTC. GMT (Oct–Mar): 08:00–16:30 UTC.
// We gate broadly 07:00–16:30 UTC Mon–Fri to cover both DST states.
function isLSEOpen(): boolean {
    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;

    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const totalMin = hour * 60 + min;

    // 07:00–16:30 UTC bracket (conservative — covers GMT and BST)
    return totalMin >= 7 * 60 && totalMin <= 16 * 60 + 30;
}

// Is it currently within the EOD rotation window? (16:35–16:45 UTC, Mon–Fri)
// Fires after the last trading cycle but before the day's data goes stale.
function isEODRotationWindow(): boolean {
    const now = new Date();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return false;

    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const totalMin = hour * 60 + min;

    // 16:35–16:45 UTC — just after market close
    return totalMin >= 16 * 60 + 35 && totalMin <= 16 * 60 + 45;
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { MOTHBALLED_ASSET_CLASSES } = await import('@/lib/constants');
    if (MOTHBALLED_ASSET_CLASSES.includes('FTSE')) {
        return NextResponse.json({ status: 'mothballed', arena: 'FTSE' });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        // Run for all users with automationEnabled
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        if (usersSnap.empty) return NextResponse.json({ status: 'no_users' });

        const results: any[] = [];

        // ── 1. Standard hourly trading cycle ─────────────────────────────────
        if (isLSEOpen()) {
            for (const doc of usersSnap.docs) {
                const userId = doc.id;
                try {
                    const cycleResult = await runSandboxArenaCycle(userId, 'FTSE');
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
        // Runs once per day in the 16:35–16:45 UTC window.
        // Checks each user's FTSE pools for idle slots and proposes AI-driven swaps.
        if (isEODRotationWindow()) {
            const today = new Date().toISOString().slice(0, 10);

            for (const doc of usersSnap.docs) {
                const userId = doc.id;
                const config = doc.data();

                // Idempotency guard — only run rotation once per calendar day per user
                const rotationKey = `ftseRotationRunDate`;
                if (config[rotationKey] === today) {
                    results.push({ userId: userId.substring(0, 8), action: 'eod_rotation', status: 'already_run_today' });
                    continue;
                }

                try {
                    const rotationResult = await performFTSESelectiveRotation(userId);

                    // Telegram notification for any successful swaps
                    if (rotationResult.rotations.length > 0) {
                        const now = new Date();
                        let msg = `🔄 <b>FTSE SCENARIO C — EOD ROTATION</b>\n`;
                        msg += `📅 ${now.toLocaleDateString('en-GB')} | Selective Catalyst Rotation\n\n`;
                        for (const r of rotationResult.rotations) {
                            msg += `📊 <b>Pool ${r.poolId}</b>\n`;
                            msg += `  OUT: <s>${r.outTicker}</s>  →  IN: <b>${r.inTicker}</b>\n`;
                            msg += `  <i>${r.reason.substring(0, 250)}</i>\n\n`;
                        }
                        msg += `<i>Next rotation eligible in 7 calendar days per pool.</i>`;
                        try {
                            await sendSystemAlert('FTSE EOD Rotation', msg, '🔄');
                        } catch { /* non-fatal */ }
                    }

                    // Mark today's rotation as done (idempotency)
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

        // If neither window is active, return a clean status
        if (!isLSEOpen() && !isEODRotationWindow()) {
            return NextResponse.json({
                status: 'market_closed',
                arena: 'FTSE',
                message: 'LSE not open and not in EOD rotation window — skipping.',
            });
        }

        return NextResponse.json({ status: 'ok', arena: 'FTSE', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
