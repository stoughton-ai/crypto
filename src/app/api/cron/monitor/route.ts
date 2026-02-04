import { NextResponse } from 'next/server';
import { adminDb, adminMessaging, firebaseAdmin } from '@/lib/firebase-admin';
import { getVerifiedPrices } from '@/app/actions';

export const dynamic = 'force-dynamic';

export async function GET() {
    if (!adminDb || !adminMessaging) {
        console.error("Monitoring Cron: Firebase Admin SDK not initialized. Missing FIREBASE_SERVICE_ACCOUNT_JSON.");
        return NextResponse.json({
            error: "Admin SDK missing",
            detail: "Please configure FIREBASE_SERVICE_ACCOUNT_JSON in .env.local to enable alerts."
        }, { status: 500 });
    }

    try {
        const now = new Date();

        // 1. Get all active notification settings
        // Note: 'collectionGroup' queries all collections named 'settings'.
        // We expect the document id to be 'notifications' to confirm it's the right config.
        const snapshot = await adminDb.collectionGroup('settings')
            .where('enabled', '==', true)
            .get();

        // Filter strictly for the notifications document to avoid picking up other settings
        const validDocs = snapshot.docs.filter(d => d.id === 'notifications');

        if (validDocs.length === 0) {
            return NextResponse.json({ message: "No active monitors found." });
        }

        // 2. Identify who needs an alert
        const eligibleUsers: Array<{
            uid: string,
            ref: FirebaseFirestore.DocumentReference,
            data: any,
            type: 'morning' | 'evening'
        }> = [];

        for (const doc of validDocs) {
            const data = doc.data();
            const timeZone = data.timeZone || 'UTC';

            // Get user's local date and time components
            const dateStr = new Intl.DateTimeFormat('en-CA', {
                timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(now); // YYYY-MM-DD

            const timeParts = new Intl.DateTimeFormat('en-GB', {
                timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).format(now).split(':').map(Number);

            const currentMinutes = timeParts[0] * 60 + timeParts[1];

            // Parse Settings
            const [mH, mM] = (data.morningTime || "07:30").split(':').map(Number);
            const morningMinutes = mH * 60 + mM;

            const [eH, eM] = (data.eveningTime || "19:30").split(':').map(Number);
            const eveningMinutes = eH * 60 + eM;

            // Check Morning
            // Trigger if: Current time is past target AND we haven't sent it today
            if (currentMinutes >= morningMinutes && data.lastMorningCheck !== dateStr) {
                // Avoid triggering if it's too late (e.g. > 2 hours past)? Optional. 
                // For now, simpler is better: ensure we send once per day after the time.
                eligibleUsers.push({ uid: doc.ref.parent.parent!.id, ref: doc.ref, data, type: 'morning' });
            }
            // Check Evening
            else if (currentMinutes >= eveningMinutes && data.lastEveningCheck !== dateStr) {
                eligibleUsers.push({ uid: doc.ref.parent.parent!.id, ref: doc.ref, data, type: 'evening' });
            }
        }

        if (eligibleUsers.length === 0) {
            return NextResponse.json({ message: "No alerts due at this time." });
        }

        // 3. Fetch Portfolios for Eligible Users
        const portfolios = await Promise.all(eligibleUsers.map(async (u) => {
            const pRef = adminDb!.collection('users').doc(u.uid).collection('portfolio');
            const pSnap = await pRef.get();
            const items = pSnap.docs.map(d => d.data());
            return { ...u, items };
        }));

        // Start Price Fetch
        const allTickers = new Set<string>();
        portfolios.forEach(p => p.items.forEach((i: any) => allTickers.add(i.ticker)));

        if (allTickers.size === 0) {
            return NextResponse.json({ message: "Users need alerts but have no assets." });
        }

        // 4. Get Verified Prices
        // We use the shared action logic but calling it here.
        const prices = await getVerifiedPrices(Array.from(allTickers));

        // 5. Send Notifications
        const results = await Promise.all(portfolios.map(async (user) => {
            if (user.items.length === 0) return { uid: user.uid, status: 'skipped-empty' };

            const totalValue = user.items.reduce((acc: number, item: any) => acc + (item.amount * (prices[item.ticker.toUpperCase()] || item.averagePrice)), 0);
            const costBasis = user.items.reduce((acc: number, item: any) => acc + (item.amount * item.averagePrice), 0);
            const pnl = totalValue - costBasis;
            const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            const isProfit = pnl >= 0;
            const emoji = isProfit ? "🟢" : "🔴";

            // Individual Traffic Lights (Top 3 by value)
            const topAssets = user.items
                .sort((a: any, b: any) => (b.amount * (prices[b.ticker.toUpperCase()] || 0)) - (a.amount * (prices[a.ticker.toUpperCase()] || 0)))
                .slice(0, 3)
                .map((item: any) => {
                    const currentPrice = prices[item.ticker.toUpperCase()] || item.averagePrice;
                    const iPnl = (currentPrice - item.averagePrice) / item.averagePrice;
                    return `${item.ticker} ${iPnl >= 0 ? '🟢' : '🔴'}`;
                }).join(', ');

            const body = `Total: $${totalValue.toLocaleString()} (${isProfit ? '+' : ''}${pnlPct.toFixed(1)}%)\n` +
                `Holdings: ${topAssets}${user.items.length > 3 ? '...' : ''}`;

            try {
                if (user.data.fcmToken) {
                    await adminMessaging!.send({
                        token: user.data.fcmToken,
                        notification: {
                            title: `${user.type === 'morning' ? '☀️ Morning' : '🌙 Evening'} Portfolio Snapshot`,
                            body: body,
                        },
                        webpush: {
                            fcmOptions: {
                                link: 'https://semaphore10.vercel.app/portfolio' // Replace with actual URL
                            }
                        }
                    });
                }

                // Update Firestore to mark as sent
                const field = user.type === 'morning' ? 'lastMorningCheck' : 'lastEveningCheck';
                const timeZone = user.data.timeZone || 'UTC';
                const sentDate = new Intl.DateTimeFormat('en-CA', {
                    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
                }).format(now);

                await user.ref.update({ [field]: sentDate });
                return { uid: user.uid, status: 'sent', type: user.type };
            } catch (err) {
                console.error(`Failed to send to ${user.uid}`, err);
                return { uid: user.uid, status: 'failed' };
            }
        }));

        return NextResponse.json({ success: true, processed: results.length, results });

    } catch (error) {
        console.error("Cron Job Error", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
