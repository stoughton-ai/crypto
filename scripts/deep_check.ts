import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Check if decisions exist at all for the last 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    console.log('\n=== DECISIONS IN LAST 24H ===');
    const decisionsSnap = await db.collection('virtual_decisions')
        .where('userId', '==', userId)
        .where('date', '>=', since)
        .orderBy('date', 'desc')
        .limit(30)
        .get();

    console.log(`Found: ${decisionsSnap.size}`);
    decisionsSnap.docs.forEach(d => {
        const data = d.data();
        console.log(`  ${data.date} | ${data.action?.padEnd(5)} ${data.ticker?.padEnd(8)} | Score: ${data.score} | ${data.reason}`);
    });

    // Check trades in last 24h
    console.log('\n=== TRADES IN LAST 24H ===');
    const tradesSnap = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .where('date', '>=', since)
        .orderBy('date', 'desc')
        .limit(20)
        .get();

    console.log(`Found: ${tradesSnap.size}`);
    tradesSnap.docs.forEach(d => {
        const data = d.data();
        console.log(`  ${data.date} | ${data.type?.padEnd(4)} ${data.ticker?.padEnd(8)} | $${data.total?.toFixed(2)} | ${data.reason}`);
    });

    // Check brain state
    console.log('\n=== BRAIN STATE ===');
    const configSnap = await db.collection('agent_configs').doc(userId).get();
    const config = configSnap.data()!;
    const bs = config.brainState;
    console.log(`  lastActive:     ${bs?.lastActive}`);
    console.log(`  currentAction:  ${bs?.currentAction}`);
    console.log(`  stage:          ${bs?.stage}`);
    console.log(`  cycleComplete:  ${bs?.cycleComplete}`);

    // Check the most recent cycle_log timestamp
    const cycleLogs = config.cycle_logs || [];
    console.log(`\n=== CYCLE LOGS ===`);
    console.log(`  Total stored: ${cycleLogs.length}`);
    if (cycleLogs.length > 0) {
        console.log(`  Latest: ${cycleLogs[0]?.timestamp}`);
        console.log(`  Oldest: ${cycleLogs[cycleLogs.length - 1]?.timestamp}`);
    }

    // Check the scanPlan
    console.log(`\n=== SCAN PLAN ===`);
    console.log(config.scanPlan ? JSON.stringify(config.scanPlan, null, 2) : 'undefined');

    // Check automation flags
    console.log(`\n=== AUTOMATION FLAGS ===`);
    console.log(`  automationEnabled:     ${config.automationEnabled}`);
    console.log(`  realTradingEnabled:    ${config.realTradingEnabled}`);
    console.log(`  stopLossTriggered:     ${config.stopLossTriggered}`);
    console.log(`  auditAutoDisabled:     ${config.auditAutoDisabled}`);

    // Check if the brain's "lastActive" matches cron timing
    if (bs?.lastActive) {
        const lastActiveMs = new Date(bs.lastActive).getTime();
        const sinceLastActive = (Date.now() - lastActiveMs) / 60000;
        console.log(`\n  Minutes since brain last active: ${sinceLastActive.toFixed(1)}`);
        if (sinceLastActive > 10) {
            console.log(`  ⚠️ Brain hasn't been active in ${sinceLastActive.toFixed(0)} min — cron may be failing silently`);
        }
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
