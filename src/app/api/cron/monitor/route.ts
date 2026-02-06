import { NextResponse } from 'next/server';
import { adminDb, adminMessaging } from '@/lib/firebase-admin';
import { analyzeCrypto } from '@/app/actions';
import { AGENT_WATCHLIST } from '@/lib/constants';
import { initVirtualPortfolio, executeVirtualTrades } from '@/services/virtualPortfolioAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend timeout for multiple AI calls

export async function GET() {
    if (!adminDb || !adminMessaging) {
        console.error("Monitoring Cron: Firebase Admin SDK not initialized.");
        return NextResponse.json({ error: "Admin SDK missing" }, { status: 500 });
    }

    try {
        const now = new Date();

        // Find active users via their virtual portfolios (most reliable discovery)
        const vpSnapshot = await adminDb.collection('virtual_portfolio').get();
        console.log(`Cron: Scanning ${vpSnapshot.docs.length} users with active portfolios...`);

        const notificationPromises = vpSnapshot.docs.map(vDoc =>
            adminDb!.collection('users').doc(vDoc.id).collection('settings').doc('notifications').get()
        );
        const notificationSnaps = await Promise.all(notificationPromises);

        const validDocs = notificationSnaps.filter(s => s.exists && s.data()?.enabled === true);
        console.log(`Cron: Found ${validDocs.length} active notification configs.`);

        if (validDocs.length === 0) return NextResponse.json({ message: "No active monitors found." });

        const eligibleUsers: Array<{ uid: string, ref: FirebaseFirestore.DocumentReference, data: any, type: 'morning' | 'lunch' | 'evening' | 'night' }> = [];

        for (const doc of validDocs) {
            const data = doc.data();
            if (!data) continue;
            const timeZone = data.timeZone || 'UTC';

            // Time Check Logic
            const timeParts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
            const currentMinutes = timeParts[0] * 60 + timeParts[1];
            const userDateStr = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

            // Defaults: Night 00:00, Morning 06:00, Lunch 12:00, Evening 18:00
            const checks = [
                { type: 'night', time: "00:00", field: 'lastNightCheck' },
                { type: 'morning', time: data.morningTime || "06:00", field: 'lastMorningCheck' },
                { type: 'lunch', time: "12:00", field: 'lastLunchCheck' },
                { type: 'evening', time: data.eveningTime || "18:00", field: 'lastEveningCheck' }
            ];

            for (const check of checks) {
                const [h, m] = check.time.split(':').map(Number);
                const checkMinutes = h * 60 + m;

                // Trigger if past time AND not sent today
                if (currentMinutes >= checkMinutes && data[check.field] !== userDateStr) {
                    eligibleUsers.push({ uid: doc.ref.parent.parent!.id, ref: doc.ref, data, type: check.type as any });
                    break;
                }
            }
        }

        if (eligibleUsers.length === 0) return NextResponse.json({ message: "No alerts due.", now: now.toISOString() });

        // 2. Process Eligible Users
        const results = await Promise.all(eligibleUsers.map(async (user) => {
            console.log(`Generating reports for user ${user.uid} (${user.type})...`);

            let successCount = 0;
            let analysisResults: any[] = [];

            // Generate Reports for WL
            await Promise.all(AGENT_WATCHLIST.map(async (ticker) => {
                try {
                    const analysis = await analyzeCrypto(ticker);

                    if (analysis.verificationStatus.toLowerCase().includes("research")) {
                        console.warn(`Skipping unverified report for ${ticker} - Data source was research/fallback.`);
                        return;
                    }

                    analysisResults.push(analysis);

                    await adminDb!.collection('intel_reports').add({
                        ...analysis,
                        userId: user.uid,
                        savedAt: new Date().toISOString(),
                        createdAt: FieldValue.serverTimestamp(),
                        generatedBy: "AutoMonitor"
                    });
                    successCount++;
                } catch (err) {
                    console.error(`Failed to analyze ${ticker} for ${user.uid}`, err);
                }
            }));

            if (successCount > 0) {
                try {
                    await initVirtualPortfolio(user.uid);
                    await executeVirtualTrades(user.uid, analysisResults);
                } catch (err) {
                    console.error("Virtual Portfolio Error", err);
                }
            }

            if (successCount > 0 && user.data.fcmToken) {
                const titles = {
                    night: '🌙 Midnight Intelligence',
                    morning: '☀️ Morning Brief',
                    lunch: '🍱 Midday Market Update',
                    evening: '🌆 Evening Recap'
                };

                try {
                    await adminMessaging!.send({
                        token: user.data.fcmToken,
                        notification: {
                            title: titles[user.type],
                            body: `Analysis Complete: ${successCount} new market reports have been generated and saved to your Library.`,
                        },
                        webpush: { fcmOptions: { link: 'https://semaphore10.vercel.app/portfolio' } }
                    });
                } catch (e) {
                    console.error("Push failed", e);
                }
            }

            const timeZone = user.data.timeZone || 'UTC';
            const userDateStr = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

            // Determine field name dynamically
            const fieldMap: Record<string, string> = {
                night: 'lastNightCheck',
                morning: 'lastMorningCheck',
                lunch: 'lastLunchCheck',
                evening: 'lastEveningCheck'
            };
            const field = fieldMap[user.type];

            if (successCount > 0) {
                await user.ref.update({ [field]: userDateStr });
                console.log(`Successfully completed ${user.type} for ${user.uid}`);
            } else {
                console.warn(`No success in ${user.type} for ${user.uid}. Will retry on next cron.`);
            }

            return { uid: user.uid, reportsGenerated: successCount };
        }));

        return NextResponse.json({ success: true, results });

    } catch (error) {
        console.error("Cron Job Error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
