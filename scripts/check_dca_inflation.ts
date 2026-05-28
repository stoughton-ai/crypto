/**
 * Check if DCA contributions inflate the weekly P&L.
 * Run: npx tsx scripts/check_dca_inflation.ts
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

async function check() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DCA INFLATION CHECK — WEEKLY REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load arena config
  const configSnap = await db.collection('arena_config').limit(1).get();
  const arena = configSnap.docs[0].data();
  const userId = configSnap.docs[0].id;

  // Load DCA history  
  const dcaDoc = await db.collection('dca_config').doc(userId).get();
  const dcaConfig = dcaDoc.data();

  console.log('DCA Config:');
  console.log(`  Enabled: ${dcaConfig?.enabled}`);
  console.log(`  Total deposited: $${dcaConfig?.totalDeposited ?? 0}`);
  console.log(`  Total deployed: $${dcaConfig?.totalDeployed ?? 0}`);

  // Check DCA contribution history
  const history = dcaConfig?.history || [];
  console.log(`\n  DCA Contributions (${history.length} total):`);
  
  const weekStart = new Date('2026-03-08T00:00:00Z');
  const weekEnd = new Date('2026-03-15T23:59:59Z');
  let weeklyDcaTotal = 0;

  for (const h of history) {
    const date = new Date(h.date);
    const inWeek = date >= weekStart && date <= weekEnd;
    console.log(`    ${h.date.slice(0, 10)}: $${h.credited?.toFixed(2)} → ${h.poolId}${inWeek ? ' ← THIS WEEK' : ''}`);
    if (inWeek) weeklyDcaTotal += h.credited || 0;
  }

  console.log(`\n  DCA credited THIS WEEK (Mar 8-15): $${weeklyDcaTotal.toFixed(2)}`);

  // Now trace the P&L calculation
  console.log('\n\n═══ P&L CALCULATION TRACE ═══\n');

  for (const pool of arena.pools) {
    const snapshots = pool.performance?.dailySnapshots || [];
    const weekSnapshots = snapshots.filter((s: any) => s.date >= '2026-03-08');
    const navStart = weekSnapshots.length > 0 ? weekSnapshots[0].value : pool.budget;
    
    // navEnd = getPoolTotalValue = cashBalance + holdings
    // But we can't get live prices here, so use the latest snapshot
    const latestSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    
    const dcaThisWeek = history
      .filter((h: any) => h.poolId === pool.poolId && new Date(h.date) >= weekStart && new Date(h.date) <= weekEnd)
      .reduce((sum: number, h: any) => sum + (h.credited || 0), 0);

    console.log(`  ${pool.emoji} ${pool.name}:`);
    console.log(`    Budget: $${pool.budget}`);
    console.log(`    Total DCA contributions (all time): $${pool.dcaContributions ?? 0}`);
    console.log(`    DCA deployed total: $${pool.dcaDeployedTotal ?? 0}`);
    console.log(`    DCA reserve (undeployed): $${pool.dcaReserve ?? 0}`);
    console.log(`    Cash balance: $${pool.cashBalance?.toFixed(2)}`);
    console.log(`    ---`);
    console.log(`    Nav start (snapshot ${weekSnapshots[0]?.date || 'N/A'}): $${navStart.toFixed(2)}`);
    console.log(`    Latest snapshot value: $${latestSnap?.value?.toFixed(2) || 'N/A'}`);
    console.log(`    DCA credited this week: $${dcaThisWeek.toFixed(2)}`);
    
    if (dcaThisWeek > 0) {
      console.log(`    ⚠️  WARNING: $${dcaThisWeek.toFixed(2)} DCA was added this week`);
      console.log(`    This DCA cash increases cashBalance → increases navEnd`);
      console.log(`    But navStart (from snapshot on ${weekSnapshots[0]?.date}) was BEFORE the DCA`);
      console.log(`    So the weekly P&L IS inflated by $${dcaThisWeek.toFixed(2)} of injected capital`);
      
      // Calculate the real vs inflated P&L
      const navEnd = latestSnap?.value || pool.cashBalance;
      const inflatedPnl = ((navEnd - navStart) / navStart) * 100;
      const realPnl = ((navEnd - dcaThisWeek - navStart) / navStart) * 100;
      console.log(`    Inflated P&L: ${inflatedPnl.toFixed(2)}%`);
      console.log(`    Real P&L (DCA-adjusted): ${realPnl.toFixed(2)}%`);
    } else {
      console.log(`    ✅ No DCA this week — P&L is clean`);
    }
    console.log('');
  }

  // Overall impact
  console.log('\n═══ OVERALL IMPACT ═══');
  const totalNavStart = arena.pools.reduce((sum: number, p: any) => {
    const snaps = p.performance?.dailySnapshots || [];
    const ws = snaps.filter((s: any) => s.date >= '2026-03-08');
    return sum + (ws.length > 0 ? ws[0].value : p.budget);
  }, 0);

  console.log(`  Total navStart: $${totalNavStart.toFixed(2)}`);
  console.log(`  DCA injected this week: $${weeklyDcaTotal.toFixed(2)}`);
  
  if (weeklyDcaTotal > 0) {
    const inflationPct = (weeklyDcaTotal / totalNavStart) * 100;
    console.log(`  DCA as % of navStart: ${inflationPct.toFixed(2)}%`);
    console.log(`  ⚠️ The reported +9.85% P&L includes ~${inflationPct.toFixed(1)}% from DCA injection`);
    console.log(`  True organic gain would be approximately +${(9.85 - inflationPct).toFixed(2)}%`);
  } else {
    console.log(`  ✅ No DCA this week — all gains are organic`);
  }
}

check().catch(console.error);
