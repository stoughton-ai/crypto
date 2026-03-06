import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const UID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    // Replicate fetchTickerIntelAdmin
    const snap = await db.collection('ticker_intel').where('userId', '==', UID).get();
    const intel: Record<string, any> = {};
    snap.docs.forEach(d => {
        const data = d.data();
        if (data?.ticker) intel[String(data.ticker).toUpperCase()] = { id: d.id, ...data };
    });

    // Replicate allReportsMap
    const allReportsMap: Record<string, any> = {};
    Object.values(intel).forEach((report: any) => {
        if (report && report.ticker && report.overallScore) {
            allReportsMap[report.ticker.toUpperCase()] = report;
        }
    });

    const combinedReports = Object.values(allReportsMap);
    console.log('combinedReports.length:', combinedReports.length);
    console.log('BTC in combinedReports:', combinedReports.some(r => r.ticker === 'BTC'));
    console.log('ETH in combinedReports:', combinedReports.some(r => r.ticker === 'ETH'));
    console.log('SOL in combinedReports:', combinedReports.some(r => r.ticker === 'SOL'));
    console.log('NEAR in combinedReports:', combinedReports.some(r => r.ticker === 'NEAR'));

    // Now check what executeVirtualTrades does
    const conf = await db.collection('agent_configs').doc(UID).get();
    const config = conf.data()!;

    const HARD_BLACKLIST = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'TUSD', 'USDP', 'EUR', 'GBP', 'STABLE']);
    const userExcluded = (config.excludedTokens || []).map((t: string) => t.toUpperCase());
    const excludedTokens = new Set([...userExcluded, ...Array.from(HARD_BLACKLIST)]);

    // The analyses param IS combinedReports
    const analyses = combinedReports;

    // sortedAnalyses = analyses sorted by score desc
    const sortedAnalyses = [...analyses].sort((a, b) => (b.overallScore || 0) - (a.overallScore || 0));

    console.log('\nTop 10 sorted analyses:');
    sortedAnalyses.slice(0, 10).forEach((a, i) => {
        console.log(`  ${i + 1}. ${a.ticker} score=${a.overallScore} excluded=${excludedTokens.has(a.ticker?.toUpperCase())}`);
    });

    // Trace BTC through the loop
    for (const ticker of ['BTC', 'ETH', 'SOL', 'NEAR']) {
        const analysis = sortedAnalyses.find(a => a.ticker?.toUpperCase() === ticker);
        if (!analysis) {
            console.log(`\n${ticker}: NOT IN sortedAnalyses!`);
            continue;
        }
        console.log(`\n${ticker}: IN sortedAnalyses, score=${analysis.overallScore}`);
        console.log(`  excluded: ${excludedTokens.has(ticker)}`);

        const lastSoldMap = config.lastSold || {};
        const lastSoldStr = lastSoldMap[ticker];
        const nowMs = Date.now();
        const lastSoldT = lastSoldStr ? new Date(lastSoldStr).getTime() : 0;
        const hoursSinceSold = (nowMs - lastSoldT) / (1000 * 60 * 60);
        const ANTI_WASH_HOURS = config.antiWashHours ?? 2;
        console.log(`  lastSold: ${lastSoldStr || 'never'} (${hoursSinceSold.toFixed(1)}h ago)`);
        console.log(`  antiWashHours: ${ANTI_WASH_HOURS}`);
        console.log(`  wouldBlock: ${hoursSinceSold < ANTI_WASH_HOURS}`);
    }

    process.exit(0);
}
main();
