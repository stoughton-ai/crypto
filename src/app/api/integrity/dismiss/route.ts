/**
 * REST API — Dismiss Integrity Alerts
 *
 * POST /api/integrity/dismiss
 * Body: { userId: string, assetClass?: string }
 *
 * Marks all active integrity alerts as dismissed (hidden from dashboard).
 * The underlying alert records are NEVER deleted — they persist permanently
 * for audit trail purposes.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import type { AssetClass } from '@/lib/constants';

export async function POST(request: Request) {
    // Verify auth (CRON_SECRET or Bearer token)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!adminDb) {
        return NextResponse.json({ error: 'Admin SDK not initialized' }, { status: 500 });
    }

    try {
        const body = await request.json();
        const userId = body.userId;
        const assetClass: AssetClass = body.assetClass || 'CRYPTO';

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        const { dismissIntegrityAlerts } = await import('@/services/integrityService');
        const result = await dismissIntegrityAlerts(userId, assetClass);

        return NextResponse.json({
            status: 'ok',
            dismissed: result.dismissed,
            message: result.dismissed > 0
                ? `${result.dismissed} alert(s) dismissed from dashboard. Records preserved.`
                : 'No active alerts to dismiss.',
        });
    } catch (e: any) {
        console.error('[IntegrityAPI] Dismiss failed:', e.message);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
