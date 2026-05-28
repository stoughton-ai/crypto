import { adminDb } from './src/lib/firebase-admin';
import { generateWeeklyComparisonReport } from './src/app/actions';

async function main() {
    try {
        const snap = await adminDb.collection('arena_config').limit(1).get();
        if (snap.empty) {
            console.log("No arena_config found");
            return;
        }
        const userId = snap.docs[0].id;
        console.log("Running audit for user:", userId);
        const report = await generateWeeklyComparisonReport(userId);
        if (report) {
            console.log("\n=== AUDIT REPORT ===\n");
            console.log(report.executiveSummary);
            console.log("\n=== GPM VS OLD SYSTEM ===\n");
            console.log(report.gpmVsOldSystemAnalysis);
            console.log("\n=== BEST DECISION ===\n");
            console.log(report.bestDecision);
            console.log("\n=== WORST DECISION ===\n");
            console.log(report.worstDecision);
            console.log("\n=== NEXT WEEK OUTLOOK ===\n");
            console.log(report.nextWeekOutlook);
            console.log("\n=== PER POOL VERDICTS ===\n");
            report.perPoolSummaries.forEach(p => {
                console.log(`${p.poolName} (${p.pnlPct.toFixed(2)}%): ${p.verdict}`);
            });
        } else {
            console.log("Failed to generate report (possibly not initialized).");
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

main();
