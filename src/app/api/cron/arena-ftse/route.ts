/**
 * FTSE ARENA CRON — Every 60 minutes during LSE market hours
 *
 * Market hours gate: 08:00–16:30 London time (BST/GMT), Mon–Fri only.
 * Uses EODHD with .LSE suffix for UK equity pricing.
 * Works in both sandbox and competition mode.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runSandboxArenaCycle } from '@/app/actions';

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

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isLSEOpen()) {
        return NextResponse.json({ status: 'market_closed', arena: 'FTSE', message: 'LSE not open — skipping cycle.' });
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
                const cycleResult = await runSandboxArenaCycle(userId, 'FTSE');
                results.push({
                    userId: userId.substring(0, 8),
                    status: cycleResult.success ? 'completed' : 'skipped',
                    trades: cycleResult.totalTrades,
                });
            } catch (e: any) {
                results.push({ userId: userId.substring(0, 8), status: 'error', error: e.message });
            }
        }

        return NextResponse.json({ status: 'ok', arena: 'FTSE', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
