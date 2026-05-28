/**
 * Audit script: verify the Sunday Weekly Audit report accuracy
 * by pulling actual trade data from Firestore.
 * 
 * Run: npx tsx scripts/audit_weekly_report.ts
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

const PERIOD_START = '2026-03-08';
const PERIOD_END = '2026-03-15';

async function audit() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  WEEKLY REPORT ACCURACY AUDIT');
  console.log(`  Period: ${PERIOD_START} → ${PERIOD_END}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Get arena config
  const configSnap = await db.collection('arena_config').limit(1).get();
  if (configSnap.empty) { console.error('No arena config found'); return; }
  const userId = configSnap.docs[0].id;
  const arena = configSnap.docs[0].data();
  console.log(`User: ${userId}`);
  console.log(`Pools: ${arena.pools.length}`);

  // 2. Get all trades (no orderBy to avoid composite index requirement)
  const tradesSnap = await db.collection('arena_trades')
    .where('userId', '==', userId)
    .get();

  const allTrades = tradesSnap.docs.map(d => d.data());
  console.log(`Total trades in DB: ${allTrades.length}\n`);

  // 3. Filter to this week
  const weekTrades = allTrades.filter(t => {
    const d = new Date(t.date).toISOString().slice(0, 10);
    return d >= PERIOD_START && d <= PERIOD_END;
  });

  console.log(`\n═══ TRADES THIS WEEK: ${weekTrades.length} ═══\n`);

  // 4. Break down by pool
  const poolMap: Record<string, any[]> = {};
  for (const t of weekTrades) {
    const key = t.poolName || t.poolId || 'UNKNOWN';
    if (!poolMap[key]) poolMap[key] = [];
    poolMap[key].push(t);
  }

  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalGpmDown = 0;
  let totalGpmUp = 0;
  let totalGpmEarly = 0;
  let totalBuys = 0;
  let totalSells = 0;

  for (const [poolName, trades] of Object.entries(poolMap)) {
    console.log(`\n── ${poolName} ──`);
    console.log(`  Total trades: ${trades.length}`);

    const buys = trades.filter(t => t.type === 'BUY');
    const sells = trades.filter(t => t.type === 'SELL');
    const wins = sells.filter(t => (t.pnlPct ?? 0) >= 0);
    const losses = sells.filter(t => (t.pnlPct ?? 0) < 0);

    console.log(`  Buys: ${buys.length} | Sells: ${sells.length}`);
    console.log(`  Wins: ${wins.length} | Losses: ${losses.length}`);

    // GPM actions
    const gpmDown = trades.filter(t =>
      t.type === 'SELL' &&
      t.reason?.includes('GPM') &&
      (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'))
    );
    const gpmUp = trades.filter(t =>
      t.type === 'BUY' &&
      (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP'))
    );
    const gpmEarly = trades.filter(t =>
      t.type === 'BUY' &&
      (t.preTradeReflection?.includes('EARLY') || t.reason?.includes('EARLY')) &&
      (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP'))
    );

    console.log(`  GPM Scale-Down: ${gpmDown.length}`);
    console.log(`  GPM Scale-Up: ${gpmUp.length} (${gpmEarly.length} early)`);

    totalTrades += trades.length;
    totalBuys += buys.length;
    totalSells += sells.length;
    totalWins += wins.length;
    totalLosses += losses.length;
    totalGpmDown += gpmDown.length;
    totalGpmUp += gpmUp.length;
    totalGpmEarly += gpmEarly.length;

    // Print each trade for detailed verification
    console.log(`\n  📝 Individual trades:`);
    for (const t of trades) {
      const pnlStr = t.pnlPct !== undefined ? ` P&L: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '';
      const gpmTag = 
        (t.reason?.includes('GPM') && (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'))) ? ' [GPM↓]' :
        (t.preTradeReflection?.includes('GPM SCALE-UP') || t.reason?.includes('GPM SCALE-UP')) ?
          ((t.preTradeReflection?.includes('EARLY') || t.reason?.includes('EARLY')) ? ' [GPM↑ EARLY]' : ' [GPM↑]') : '';
      const date = new Date(t.date).toISOString().slice(0, 16);
      console.log(`    ${date} | ${t.type.padEnd(4)} ${t.ticker.padEnd(6)} | $${t.total?.toFixed(2) || '?'}${pnlStr}${gpmTag}`);
    }
  }

  // 5. Summary comparison
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  REPORT vs ACTUAL — COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const reportClaims = {
    totalTrades: 66,
    wins: 7,
    losses: 30,
    gpmDown: 35,
    gpmUp: 24,
    gpmEarly: 11,
    pools: {
      'Momentum Mavericks': { pnlPct: 12.04, trades: 19, wins: 3, losses: 8 },
      'Deep Divers': { pnlPct: 9.29, trades: 17, wins: 1, losses: 9 },
      'Steady Sailers': { pnlPct: 9.90, trades: 15, wins: 1, losses: 7 },
      'Agile Arbitrageurs': { pnlPct: 7.64, trades: 15, wins: 2, losses: 6 },
    }
  };

  console.log('AGGREGATE STATS:');
  console.log(`  Total trades: Report says ${reportClaims.totalTrades}, Actual: ${totalTrades} ${reportClaims.totalTrades === totalTrades ? '✅' : '❌'}`);
  console.log(`  Total buys: ${totalBuys} | Total sells: ${totalSells}`);
  console.log(`  Wins: Report says ${reportClaims.wins}, Actual: ${totalWins} ${reportClaims.wins === totalWins ? '✅' : '❌'}`);
  console.log(`  Losses: Report says ${reportClaims.losses}, Actual: ${totalLosses} ${reportClaims.losses === totalLosses ? '✅' : '❌'}`);
  console.log(`  W+L = ${totalWins + totalLosses} (should match total sells: ${totalSells})`);
  console.log(`  GPM Down: Report says ${reportClaims.gpmDown}, Actual: ${totalGpmDown} ${reportClaims.gpmDown === totalGpmDown ? '✅' : '❌'}`);
  console.log(`  GPM Up: Report says ${reportClaims.gpmUp}, Actual: ${totalGpmUp} ${reportClaims.gpmUp === totalGpmUp ? '✅' : '❌'}`);
  console.log(`  GPM Early: Report says ${reportClaims.gpmEarly}, Actual: ${totalGpmEarly} ${reportClaims.gpmEarly === totalGpmEarly ? '✅' : '❌'}`);

  // Math check: 7W + 30L = 37 sells. But 66 total trades. So 66 - 37 = 29 buys.
  // GPM: 35↓ + 24↑ = 59 GPM actions. But only 66 total trades. That means 93% are GPM??
  console.log(`\n\n  ⚠️ ARITHMETIC CHECK:`);
  console.log(`  Report: 66 trades, 7W/30L = 37 sells → 29 buys`);
  console.log(`  Report: GPM 35↓ + 24↑ = 59 GPM actions out of 66 total (89%)`);
  console.log(`  If 35 GPM sells + 24 GPM buys = 59, and 66 total, only 7 non-GPM trades`);
  console.log(`  That means only 7 "organic" trades out of 66 — does that seem right?`);

  // 6. Also fetch weekly report from Firestore
  console.log('\n\n═══ STORED WEEKLY REPORT ═══');
  const reportDoc = await db.collection('arena_weekly_reports').doc(userId).get();
  if (reportDoc.exists) {
    const report = reportDoc.data();
    console.log(`  Generated: ${report?.generatedAt}`);
    console.log(`  Week: ${report?.weekNumber}`);
    console.log(`  Period: ${report?.periodStart?.slice(0,10)} → ${report?.periodEnd?.slice(0,10)}`);
    console.log(`  NAV: $${report?.navStart?.toFixed(2)} → $${report?.navEnd?.toFixed(2)}`);
    console.log(`  P&L: ${report?.pnlPct?.toFixed(2)}%`);
    console.log(`  BTC over period: ${report?.btcPctOverPeriod?.toFixed(2)}%`);
    console.log(`  vs BTC: ${report?.vsBtc?.toFixed(2)}%`);
    console.log(`  Trades: ${report?.totalTrades} (${report?.wins}W/${report?.losses}L)`);
    console.log(`  GPM: ${report?.gpmScaleDownCount}↓ / ${report?.gpmScaleUpCount}↑ (${report?.gpmEarlyScaleUpCount} early)`);
    console.log(`\n  Pool summaries:`);
    for (const ps of (report?.perPoolSummaries || [])) {
      console.log(`    ${ps.emoji} ${ps.poolName}: ${ps.pnlPct?.toFixed(2)}% | ${ps.trades} trades (${ps.wins}W/${ps.losses}L)`);
    }
  } else {
    console.log('  No weekly report found in Firestore.');
  }

  // 7. Get pool snapshots for NAV start verification
  console.log('\n\n═══ POOL NAV VERIFICATION ═══');
  for (const pool of arena.pools) {
    const snapshots = pool.performance?.dailySnapshots || [];
    const weekSnaps = snapshots.filter((s: any) => s.date >= PERIOD_START);
    const startSnap = weekSnaps.length > 0 ? weekSnaps[0] : null;
    console.log(`  ${pool.emoji} ${pool.name}:`);
    console.log(`    Budget: $${pool.budget}`);
    console.log(`    DCA contributions: $${pool.dcaContributions ?? 0}`);
    console.log(`    Week start NAV (from snapshot): $${startSnap?.value?.toFixed(2) ?? 'NO SNAPSHOT'}`);
    console.log(`    Current cash: $${pool.cashBalance?.toFixed(2)}`);
    let holdVal = 0;
    for (const [, h] of Object.entries(pool.holdings)) {
      holdVal += ((h as any).amount || 0) * ((h as any).averagePrice || 0);
    }
    console.log(`    Holdings at cost: $${holdVal.toFixed(2)}`);
  }
}

audit().catch(console.error);
