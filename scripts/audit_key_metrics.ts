/**
 * Audit Key Metrics — 7-day benchmark check
 * Run: npx tsx scripts/audit_key_metrics.ts
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

async function audit() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  KEY METRICS AUDIT — 7-DAY BENCHMARK CHECK');
  console.log('  Period: 2026-03-08 → 2026-03-15');
  console.log('  Benchmark deployed: 2026-03-12');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const weekStart = new Date('2026-03-08T00:00:00Z');
  const weekEnd = new Date('2026-03-15T23:59:59Z');

  // Fetch all trades
  const tradesSnap = await db.collection('arena_trades')
    .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
    .limit(200)
    .get();

  const allTrades = tradesSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .filter(t => {
      const d = new Date(t.date || 0);
      return d >= weekStart && d <= weekEnd;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  console.log(`Total trades in period: ${allTrades.length}\n`);

  // ═══ 1. TRADES PER DAY ═══
  console.log('━━━ 1. TRADES PER DAY ━━━');
  console.log('Target: <2 (Healthy) | >5 (Red Flag)\n');

  const tradesByDay: Record<string, any[]> = {};
  for (const t of allTrades) {
    const day = new Date(t.date).toISOString().slice(0, 10);
    if (!tradesByDay[day]) tradesByDay[day] = [];
    tradesByDay[day].push(t);
  }

  const days = Object.keys(tradesByDay).sort();
  let totalDays = 0;
  for (const day of days) {
    const count = tradesByDay[day].length;
    const flag = count > 5 ? '🔴' : count <= 2 ? '🟢' : '🟡';
    console.log(`  ${day}: ${count} trades ${flag}`);
    totalDays++;
  }
  const avgTradesPerDay = allTrades.length / Math.max(1, totalDays);
  const tradesFlag = avgTradesPerDay > 5 ? '🔴 RED FLAG' : avgTradesPerDay <= 2 ? '🟢 HEALTHY' : '🟡 CAUTION';
  console.log(`\n  Average: ${avgTradesPerDay.toFixed(1)} trades/day → ${tradesFlag}\n`);

  // ═══ 2. WIN RATE ═══
  console.log('━━━ 2. WIN RATE ━━━');
  console.log('Target: >40% (Healthy) | <25% (Red Flag)\n');

  const sells = allTrades.filter(t => t.type === 'SELL');
  const wins = sells.filter(t => (t.pnlPct ?? 0) >= 0);
  const losses = sells.filter(t => (t.pnlPct ?? 0) < 0);
  const winRate = sells.length > 0 ? (wins.length / sells.length) * 100 : 0;
  const winFlag = winRate >= 40 ? '🟢 HEALTHY' : winRate >= 25 ? '🟡 CAUTION' : '🔴 RED FLAG';
  console.log(`  Sells: ${sells.length} | Wins: ${wins.length} | Losses: ${losses.length}`);
  console.log(`  Win Rate: ${winRate.toFixed(1)}% → ${winFlag}\n`);

  // ═══ 3. vs BTC GAP ═══
  console.log('━━━ 3. vs BTC GAP ━━━');
  console.log('Target: >-4% or positive (Healthy) | >-8% (Red Flag)\n');

  // Read from the latest weekly report
  const reportDoc = await db.collection('arena_weekly_reports').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  const report = reportDoc.data();
  const vsBtc = report?.vsBtc ?? 0;
  const btcFlag = vsBtc >= -4 ? '🟢 HEALTHY' : vsBtc >= -8 ? '🟡 CAUTION' : '🔴 RED FLAG';
  console.log(`  Portfolio P&L: ${report?.pnlPct?.toFixed(2) ?? '?'}%`);
  console.log(`  BTC Change: ${report?.btcPctOverPeriod?.toFixed(2) ?? '?'}%`);
  console.log(`  vs BTC: ${vsBtc >= 0 ? '+' : ''}${vsBtc.toFixed(2)}% → ${btcFlag}\n`);

  // ═══ 4. GPM SCALE-DOWNS PER DAY ═══
  console.log('━━━ 4. GPM SCALE-DOWNS PER DAY ━━━');
  console.log('Target: 0-1/day (Healthy) | >3/day (Red Flag)\n');

  const gpmDowns = allTrades.filter(t =>
    t.type === 'SELL' &&
    t.reason?.includes('GPM') &&
    (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'))
  );

  const gpmDownsByDay: Record<string, number> = {};
  for (const t of gpmDowns) {
    const day = new Date(t.date).toISOString().slice(0, 10);
    gpmDownsByDay[day] = (gpmDownsByDay[day] || 0) + 1;
  }

  for (const day of days) {
    const count = gpmDownsByDay[day] || 0;
    const flag = count > 3 ? '🔴' : count <= 1 ? '🟢' : '🟡';
    console.log(`  ${day}: ${count} scale-downs ${flag}`);
  }
  const avgGpmDown = gpmDowns.length / Math.max(1, totalDays);
  const gpmFlag = avgGpmDown > 3 ? '🔴 RED FLAG' : avgGpmDown <= 1 ? '🟢 HEALTHY' : '🟡 CAUTION';
  console.log(`\n  Total: ${gpmDowns.length} | Average: ${avgGpmDown.toFixed(1)}/day → ${gpmFlag}\n`);

  // ═══ 5. TAKE-PROFITS HIT ═══
  console.log('━━━ 5. TAKE-PROFITS HIT ━━━');
  console.log('Target: 2+ in 7 days (Healthy) | 0 in 7 days (Red Flag)\n');

  // Take-profit: sells with reason containing "take-profit" or "TP" or positive P&L above threshold
  const takeProfits = sells.filter(t =>
    t.reason?.toLowerCase().includes('take-profit') ||
    t.reason?.toLowerCase().includes('take profit') ||
    t.reason?.includes('TP:') ||
    t.reason?.includes('TAKE_PROFIT')
  );

  // Also check for organic wins with significant P&L (>2%) as potential TP hits
  const significantWins = wins.filter(t => (t.pnlPct ?? 0) >= 2.0);

  console.log(`  Explicit take-profit exits: ${takeProfits.length}`);
  console.log(`  Wins with P&L >= 2%: ${significantWins.length}`);
  for (const t of significantWins) {
    console.log(`    ${new Date(t.date).toISOString().slice(0, 16)} | ${t.ticker} | +${t.pnlPct?.toFixed(2)}% | ${(t.reason || '').substring(0, 80)}`);
  }
  const tpCount = Math.max(takeProfits.length, significantWins.length);
  const tpFlag = tpCount >= 2 ? '🟢 HEALTHY' : tpCount === 0 ? '🔴 RED FLAG' : '🟡 CAUTION';
  console.log(`\n  Take-profits: ${tpCount} → ${tpFlag}\n`);

  // ═══ 6. NEW STOP-LOSSES ═══
  console.log('━━━ 6. NEW STOP-LOSSES ━━━');
  console.log('Target: 0-1 in 7 days (Healthy) | >2 in 7 days (Red Flag)\n');

  // Stop-loss: sells with large losses (> -5%) or reason containing "stop" 
  const stopLosses = sells.filter(t =>
    t.reason?.toLowerCase().includes('stop-loss') ||
    t.reason?.toLowerCase().includes('stop loss') ||
    t.reason?.includes('STOP_LOSS') ||
    (t.pnlPct ?? 0) <= -5  // Treat >5% loss as effective stop-loss
  );

  console.log(`  Explicit stop-loss exits: ${sells.filter(t => t.reason?.toLowerCase().includes('stop')).length}`);
  console.log(`  Sells with P&L <= -5%: ${sells.filter(t => (t.pnlPct ?? 0) <= -5).length}`);
  for (const t of stopLosses) {
    console.log(`    ${new Date(t.date).toISOString().slice(0, 16)} | ${t.ticker} | ${t.pnlPct?.toFixed(2)}% | ${(t.reason || '').substring(0, 80)}`);
  }
  const slFlag = stopLosses.length <= 1 ? '🟢 HEALTHY' : stopLosses.length <= 2 ? '🟡 CAUTION' : '🔴 RED FLAG';
  console.log(`\n  Stop-losses: ${stopLosses.length} → ${slFlag}\n`);

  // ═══ OVERALL SCORECARD ═══
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SCORECARD SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const metrics = [
    { name: 'Trades/day', value: `${avgTradesPerDay.toFixed(1)}`, target: '<2', actual: tradesFlag },
    { name: 'Win rate', value: `${winRate.toFixed(1)}%`, target: '>40%', actual: winFlag },
    { name: 'vs BTC gap', value: `${vsBtc.toFixed(2)}%`, target: '>-4%', actual: btcFlag },
    { name: 'GPM scale-downs/day', value: `${avgGpmDown.toFixed(1)}`, target: '0-1/day', actual: gpmFlag },
    { name: 'Take-profits hit', value: `${tpCount}`, target: '2+', actual: tpFlag },
    { name: 'Stop-losses', value: `${stopLosses.length}`, target: '0-1', actual: slFlag },
  ];

  const redFlags = metrics.filter(m => m.actual.includes('RED'));
  const healthy = metrics.filter(m => m.actual.includes('HEALTHY'));

  for (const m of metrics) {
    console.log(`  ${m.actual.split(' ')[0]} ${m.name}: ${m.value} (target: ${m.target})`);
  }

  console.log(`\n  Score: ${healthy.length}/6 healthy, ${redFlags.length}/6 red flags`);
  
  if (redFlags.length >= 4) {
    console.log('\n  ⛔ OVERALL: CRITICAL — majority of metrics are red flags');
  } else if (redFlags.length >= 2) {
    console.log('\n  ⚠️ OVERALL: CONCERNING — multiple metrics failing');
  } else {
    console.log('\n  ✅ OVERALL: IMPROVING — most metrics on track');
  }
}

audit().catch(console.error);
