/**
 * COMMODITIES ARENA CRON — Every 60 minutes during extended trading hours
 *
 * Market hours gate: Mon 23:00 UTC – Fri 22:00 UTC (CME Globex schedule).
 * Effectively runs Mon–Fri during daytime and overnight hours.
 * Uses EODHD with .FOREX (metals) and .COMM (energy/agri) suffixes.
 * Works in both sandbox and competition mode.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle } from '@/app/actions';

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

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isCommoditiesOpen()) {
        return NextResponse.json({ status: 'market_closed', arena: 'COMMODITIES', message: 'CME Globex closed — skipping cycle.' });
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
                const cycleResult = await runSandboxArenaCycle(userId, 'COMMODITIES');
                results.push({
                    userId: userId.substring(0, 8),
                    status: cycleResult.success ? 'completed' : 'skipped',
                    trades: cycleResult.totalTrades,
                });
            } catch (e: any) {
                results.push({ userId: userId.substring(0, 8), status: 'error', error: e.message });
            }
        }

        return NextResponse.json({ status: 'ok', arena: 'COMMODITIES', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
