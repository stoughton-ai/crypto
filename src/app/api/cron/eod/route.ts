/**
 * EOD CRON — Runs every 5 minutes on Vercel
 *
 * Handles:
 *   1. Morning Strategy Intelligence Report
 *        Weekdays (Mon–Fri): 07:05 UTC
 *        Weekends (Sat–Sun): 08:00 UTC
 *   2. Evening Strategy Intelligence Report: 18:00 UTC (daily)
 *   3. Sunday Weekly Comparison Report: 09:00 UTC every Sunday
 *        GPM (new system) vs binary (old system) audit — plain English
 *   4. End-of-day Telegram summary: 21:00 UTC (configurable per user)
 *
 * This replaces the local arena_brain.ts report scheduling,
 * ensuring reports are sent even when the local process isn't running.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { generateDeepDiveReport } from '@/app/deepDiveActions';

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

        const results = [];
        const now = new Date();
        const currentHour = now.getUTCHours();
        const currentMinute = now.getUTCMinutes();
        const today = now.toISOString().slice(0, 10);

        for (const doc of usersSnap.docs) {
            const userId = doc.id;
            const config = doc.data();
            
            // ── ALL LEGACY TELEGRAM REPORTS HALTED PENDING NEW ARCHITECTURE ──
            results.push({ userId: userId.substring(0, 8), status: 'legacy_reporting_halted' });

            // ── NEW DEEP DIVE INTELLIGENCE (Every 6 Hours) ──
            if (currentHour % 6 === 0 && currentMinute <= 10) {
                const reportKey = `lastDeepDive_${currentHour}_${today}`;
                if (config[reportKey] !== true) {
                    try {
                        await generateDeepDiveReport(userId);
                        await adminDb.collection('agent_configs').doc(userId).set({
                            [reportKey]: true,
                        }, { merge: true });
                        results.push({ userId: userId.substring(0, 8), action: 'deep_dive_report', hour: currentHour, status: 'generated' });
                    } catch (e: any) {
                        results.push({ userId: userId.substring(0, 8), action: 'deep_dive_report', error: e.message });
                    }
                }
            }
        }

        return NextResponse.json({ status: 'ok', message: 'Legacy halted. New Pipeline Active.', results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
