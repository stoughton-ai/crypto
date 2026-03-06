/**
 * NYSE ARENA CRON — Every 60 minutes during NYSE market hours
 *
 * Market hours gate: 14:30–21:00 UTC, Mon–Fri only.
 * Uses EODHD with .US suffix for US equity pricing.
 * Works in both sandbox and competition mode.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle } from '@/app/actions';

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

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isNYSEOpen()) {
        return NextResponse.json({ status: 'market_closed', arena: 'NYSE', message: 'NYSE not open — skipping cycle.' });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        // Run for all users with automationEnabled — arenaEnabled is crypto-specific, not required here
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        if (usersSnap.empty) return NextResponse.json({ status: 'no_users' });

        const results = [];
        for (const doc of usersSnap.docs) {
            const userId = doc.id;
            try {
                const cycleResult = await runSandboxArenaCycle(userId, 'NYSE');
                results.push({
                    userId: userId.substring(0, 8),
                    status: cycleResult.success ? 'completed' : 'skipped',
                    trades: cycleResult.totalTrades,
                });
            } catch (e: any) {
                results.push({ userId: userId.substring(0, 8), status: 'error', error: e.message });
            }
        }

        return NextResponse.json({ status: 'ok', arena: 'NYSE', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
