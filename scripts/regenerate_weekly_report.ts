/**
 * Delete the old weekly report and trigger regeneration.
 * 
 * Run: npx tsx scripts/regenerate_weekly_report.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : null;
  if (!sa) { console.error('No FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

async function run() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DELETING OLD WEEKLY REPORT + TRIGGERING REGENERATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Find the user
  const configSnap = await db.collection('arena_config').limit(1).get();
  if (configSnap.empty) { console.error('No arena config found'); return; }
  const userId = configSnap.docs[0].id;
  console.log(`User: ${userId}`);

  // 2. Delete old report
  const reportRef = db.collection('arena_weekly_reports').doc(userId);
  const oldReport = await reportRef.get();
  if (oldReport.exists) {
    const oldData = oldReport.data();
    console.log(`\nOld report found:`);
    console.log(`  Generated: ${oldData?.generatedAt}`);
    console.log(`  Trades: ${oldData?.totalTrades} (${oldData?.wins}W/${oldData?.losses}L)`);
    console.log(`  Period: ${oldData?.periodStart?.slice(0,10)} → ${oldData?.periodEnd?.slice(0,10)}`);
    
    await reportRef.delete();
    console.log('\n✅ Old report DELETED from Firestore.');
  } else {
    console.log('\nNo existing report found — nothing to delete.');
  }

  // 3. Also clear the dedup flag so the EOD cron can regenerate
  const today = new Date().toISOString().slice(0, 10);
  const weeklyKey = `lastWeeklyReportSent_${today}`;
  await db.collection('agent_configs').doc(userId).set({
    [weeklyKey]: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  console.log(`✅ Cleared dedup flag: ${weeklyKey}`);

  // 4. Now generate the new report programmatically
  console.log('\n\n🔄 Generating new report with corrected code...\n');
  
  // Dynamic import to use the latest code
  const { generateWeeklyComparisonReport } = await import('../src/app/actions');
  const report = await generateWeeklyComparisonReport(userId);
  
  if (report) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  ✅ NEW REPORT GENERATED SUCCESSFULLY');
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log(`Generated: ${report.generatedAt}`);
    console.log(`Period: ${report.periodStart.slice(0, 10)} → ${report.periodEnd.slice(0, 10)}`);
    console.log(`NAV: $${report.navStart.toFixed(2)} → $${report.navEnd.toFixed(2)}`);
    console.log(`P&L: ${report.pnlPct >= 0 ? '+' : ''}${report.pnlPct.toFixed(2)}%`);
    console.log(`BTC over period: ${report.btcPctOverPeriod >= 0 ? '+' : ''}${report.btcPctOverPeriod.toFixed(2)}%`);
    console.log(`vs BTC: ${report.vsBtc >= 0 ? '+' : ''}${report.vsBtc.toFixed(2)}%`);
    console.log(`Total trades: ${report.totalTrades}`);
    console.log(`Total sells: ${report.totalSells}`);
    console.log(`Wins: ${report.wins} | Losses: ${report.losses} | Win Rate: ${report.winRate.toFixed(1)}%`);
    console.log(`GPM: ${report.gpmScaleDownCount}↓ / ${report.gpmScaleUpCount}↑ (${report.gpmEarlyScaleUpCount} early)`);
    
    console.log(`\nPool summaries:`);
    for (const ps of report.perPoolSummaries) {
      console.log(`  ${ps.emoji} ${ps.poolName}: ${ps.pnlPct >= 0 ? '+' : ''}${ps.pnlPct.toFixed(2)}% | ${ps.trades} trades (${ps.wins}W/${ps.losses}L) | GPM: ${ps.gpmScaleDownCount}↓ ${ps.gpmScaleUpCount}↑ (${ps.gpmEarlyScaleUpCount} early)`);
    }
    
    console.log(`\n📊 Executive Summary:\n${report.executiveSummary}`);
    console.log(`\n⚖️ GPM vs Old System:\n${report.gpmVsOldSystemAnalysis}`);
    console.log(`\n✅ Best Decision:\n${report.bestDecision}`);
    console.log(`\n⚠️ Lesson Learned:\n${report.worstDecision}`);
    console.log(`\n🔭 Next Week:\n${report.nextWeekOutlook}`);
  } else {
    console.error('\n❌ Report generation failed!');
  }
}

run().catch(console.error);
