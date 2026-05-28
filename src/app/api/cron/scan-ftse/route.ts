/**
 * FTSE INTELLIGENCE SCANNER — AM (Pre-Market) + PM (Post-Market)
 *
 * AM Scan: 07:00 UTC Mon-Fri (1h before LSE open)
 *   Scans the full 80-stock FTSE universe. Scores, ranks, selects Top 10 per pool.
 *
 * PM Scan: 16:45 UTC Mon-Fri (15min after LSE close)
 *   Re-scores Top 10, applies Dual Confirmation Gate with AM results.
 *   Promotes Top 2 confirmed candidates into pools (replaces weakest).
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { runIntelligenceScan } from '@/services/intelligenceScanner';

export const maxDuration = 300;

function getScanWindow(): 'MORNING' | 'EVENING' | null {
    const now = new Date();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return null; // Weekend

    const hour = now.getUTCHours();
    const min = now.getUTCMinutes();
    const totalMin = hour * 60 + min;

    // AM: 06:50–07:10 UTC (pre-market)
    if (totalMin >= 6 * 60 + 50 && totalMin <= 7 * 60 + 10) return 'MORNING';

    // PM: 16:40–17:00 UTC (post-market)
    if (totalMin >= 16 * 60 + 40 && totalMin <= 17 * 60) return 'EVENING';

    return null;
}

export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    const scanWindow = getScanWindow();
    if (!scanWindow) {
        return NextResponse.json({
            status: 'outside_scan_window',
            arena: 'FTSE',
            message: 'Not in AM (07:00) or PM (16:45) scan window — skipping.',
        });
    }

    try {
        const usersSnap = await adminDb.collection('agent_configs')
            .where('automationEnabled', '==', true)
            .limit(5)
            .get();

        if (usersSnap.empty) return NextResponse.json({ status: 'no_users' });

        const results: any[] = [];
        const today = new Date().toISOString().slice(0, 10);

        for (const doc of usersSnap.docs) {
            const userId = doc.id;
            const config = doc.data();

            // Idempotency: one AM scan + one PM scan per day
            const idempotencyKey = `ftseScan${scanWindow}Date`;
            if (config[idempotencyKey] === today) {
                results.push({ userId: userId.substring(0, 8), status: 'already_run_today', scanType: scanWindow });
                continue;
            }

            try {
                const scanResult = await runIntelligenceScan(userId, 'FTSE', scanWindow);

                // Mark as done
                await adminDb.collection('agent_configs').doc(userId).set(
                    { [idempotencyKey]: today },
                    { merge: true }
                );

                results.push({
                    userId: userId.substring(0, 8),
                    scanType: scanWindow,
                    status: 'completed',
                    poolsScanned: scanResult.scans.length,
                    promotions: scanResult.promotions.length,
                    message: scanResult.message,
                });
            } catch (e: any) {
                results.push({ userId: userId.substring(0, 8), status: 'error', error: e.message });
            }
        }

        return NextResponse.json({ status: 'ok', arena: 'FTSE', scanType: scanWindow, results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
