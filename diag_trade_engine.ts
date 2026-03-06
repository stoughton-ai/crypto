import { adminDb } from './src/lib/firebase-admin';
import { executeVirtualTrades } from './src/services/virtualPortfolioAdmin';
import { getTickerReports } from './src/app/actions';

async function diagnose(userId: string) {
    if (!adminDb) {
        console.error("Admin DB not initialized");
        return;
    }

    console.log(`--- Diagnostic for ${userId} ---`);

    const configSnap = await adminDb.collection('agent_configs').doc(userId).get();
    if (!configSnap.exists) {
        console.error("Config not found");
        return;
    }
    const config = configSnap.data()!;
    console.log("Risk Profile:", config.riskProfile);
    console.log("Automation Enabled:", config.automationEnabled);
    console.log("Watchdog Enabled:", config.watchdogEnabled);

    const vpSnap = await adminDb.collection('virtual_portfolio').doc(userId).get();
    const vpData = vpSnap.data();
    console.log("Holdings:", Object.keys(vpData?.holdings || {}));
    if (vpData?.holdings) {
        for (const [ticker, data] of Object.entries(vpData.holdings as any)) {
            console.log(`  - ${ticker}: ${(data as any).amount} @ ${(data as any).averagePrice}`);
        }
    }

    // Get current intelligence
    const allTracked = [
        ...config.trafficLightTokens,
        ...config.standardTokens,
        ...(config.sandboxTokens || []),
        ...(config.aiWatchlist || [])
    ];

    console.log("Tracked Tokens Count:", allTracked.length);

    // Simulate rebalance
    const reports = await getTickerReports(userId, allTracked);
    console.log("Fetched reports count:", reports.length);

    console.log("--- Simulating Trade Cycle ---");
    const result = await executeVirtualTrades(userId, reports, config, { ignoreCooldowns: true });

    console.log("Decisions Made:", result.decisions.length);
    result.decisions.forEach((d: any) => {
        console.log(`[${d.action}] ${d.ticker}: ${d.reason} (Score: ${d.score})`);
    });

    console.log("Trades Executed:", result.trades.length);
    result.trades.forEach((t: any) => {
        console.log(`[${t.type}] ${t.ticker}: ${t.reason}`);
    });
}

const USER_ID = "677d245c472d4cc98d4d7cf5"; // Standard check UID if not provided, though I should check if I can find it
diagnose(USER_ID).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
