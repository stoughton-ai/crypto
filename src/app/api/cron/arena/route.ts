/**
 * ARENA CRON — Every 3 minutes
 *
 * Executes the arena trading cycle:
 *   1. EODHD budget check
 *   2. Price refresh for all 8 tokens
 *   3. AI trading decisions per pool
 *   4. Revolut trade execution
 *   5. Performance tracking
 *   6. Telegram alerts
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runArenaCycle, getServerAgentConfig } from '@/app/actions';

export const maxDuration = 300; // 5 minutes

export async function GET(request: Request) {
    const startTime = Date.now();

    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        // Find active users
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        if (usersSnap.empty) {
            return NextResponse.json({ status: 'no_users' });
        }

        const results = [];

        for (const doc of usersSnap.docs) {
            const userId = doc.id;
            const config = doc.data();

            // Skip if arena not enabled
            if (!config.arenaEnabled) {
                results.push({ userId: userId.substring(0, 8), status: 'arena_disabled' });
                continue;
            }

            try {
                console.log(`[Arena Cron] 🏟️ Processing user ${userId.substring(0, 8)}...`);
                const cycleResult = await runArenaCycle(userId);

                results.push({
                    userId: userId.substring(0, 8),
                    status: cycleResult.success ? 'completed' : 'skipped',
                    trades: cycleResult.totalTrades,
                    pools: cycleResult.poolResults,
                });
            } catch (e: any) {
                console.error(`[Arena Cron] Error for ${userId.substring(0, 8)}: ${e.message}`);
                results.push({ userId: userId.substring(0, 8), status: 'error', error: e.message });
            }
        }

        const durationMs = Date.now() - startTime;
        console.log(`[Arena Cron] ✅ Complete in ${(durationMs / 1000).toFixed(1)}s. ${results.length} user(s) processed.`);

        return NextResponse.json({
            status: 'ok',
            duration: `${(durationMs / 1000).toFixed(1)}s`,
            results,
        });
    } catch (e: any) {
        console.error('[Arena Cron] Fatal error:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
