/**
 * Comprehensive 7-Day CRYPTO Metrics Audit
 * Trades are stored as TOP-LEVEL docs in arena_trades, not sub-collections.
 *
 * Run: node_modules/.bin/tsx scripts/crypto_audit.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
const PERIOD_START = '2026-03-09';
const PERIOD_END   = '2026-03-16';
const DAYS = 7;

async function run() {
  // Get ALL trades for this user (top-level docs in arena_trades)
  const allSnap = await db.collection('arena_trades')
    .where('userId', '==', userId)
    .get();

  // Filter to last 7 days in JS (no composite index needed)
  const allTrades = allSnap.docs.map(d => d.data() as any);
  const trades = allTrades
    .filter(t => t.date >= PERIOD_START && t.date <= PERIOD_END + 'T23:59:59Z')
    .sort((a, b) => a.date.localeCompare(b.date));

  const buys = trades.filter(t => t.type === 'BUY');
  const sells = trades.filter(t => t.type === 'SELL');

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         CRYPTO ARENA — 7-DAY METRICS AUDIT                         ║');
  console.log('║         Period: 2026-03-09 → 2026-03-16                            ║');
  console.log('║         Benchmark: Changes deployed 12 March 2026                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // ── 1. Trades/day ──────────────────────────────────────────────────────────
  const tradesPerDay = trades.length / DAYS;

  // Daily breakdown
  const dailyCounts: Record<string, { total: number; buys: number; sells: number }> = {};
  for (const t of trades) {
    const day = t.date.slice(0, 10);
    if (!dailyCounts[day]) dailyCounts[day] = { total: 0, buys: 0, sells: 0 };
    dailyCounts[day].total++;
    if (t.type === 'BUY') dailyCounts[day].buys++;
    else dailyCounts[day].sells++;
  }

  // ── 2. Win rate ────────────────────────────────────────────────────────────
  const sellsWithPnl = sells.filter(s => s.pnlPct !== undefined && s.pnlPct !== null);
  const wins = sellsWithPnl.filter(s => s.pnlPct > 0);
  const losses = sellsWithPnl.filter(s => s.pnlPct <= 0);
  const winRate = sellsWithPnl.length > 0 ? (wins.length / sellsWithPnl.length) * 100 : 0;

  // ── 3. vs BTC gap ──────────────────────────────────────────────────────────
  const configDoc = await db.collection('arena_config').doc(userId).get();
  const arena = configDoc.data() as any;
  const btcPrices = arena.btcDailyPrices || {};
  const btcDates = Object.keys(btcPrices).sort();
  const btcStartDate = btcDates.find(d => d >= PERIOD_START);
  const btcEndDate = btcDates[btcDates.length - 1];
  const btcStart = btcStartDate ? btcPrices[btcStartDate] : 0;
  const btcEnd = btcEndDate ? btcPrices[btcEndDate] : 0;
  const btcPct = btcStart > 0 ? ((btcEnd - btcStart) / btcStart) * 100 : 0;

  const totalHold = arena.pools.reduce((s: number, p: any) => {
    let hv = 0;
    for (const h of Object.values(p.holdings ?? {}) as any[]) hv += (h.amount||0) * (h.averagePrice||0);
    return s + hv;
  }, 0);
  const nav = totalHold + (arena.sharedCash ?? 0);
  const budget = arena.totalBudget ?? 720;
  const navPct = ((nav - budget) / budget) * 100;
  const btcGap = navPct - btcPct;

  // ── 4. GPM scale-downs/ups ─────────────────────────────────────────────────
  const gpmDowns = sells.filter(t =>
    (t.reason || '').includes('GPM') && ((t.reason || '').includes('CAUTION') || (t.reason || '').includes('DEFENSIVE'))
  );
  const gpmUps = buys.filter(t =>
    (t.reason || t.preTradeReflection || '').includes('GPM') &&
    ((t.reason || t.preTradeReflection || '').includes('SCALE-UP') || (t.reason || t.preTradeReflection || '').includes('scale-up'))
  );

  // ── 5. Take-profits ───────────────────────────────────────────────────────
  const takeProfits = sells.filter(t => {
    const r = ((t.reason || '') + (t.preTradeReflection || '')).toLowerCase();
    return r.includes('take-profit') || r.includes('take profit') || r.includes('profit target') || r.includes('tp hit');
  });

  // ── 6. Stop-losses ────────────────────────────────────────────────────────
  const stopLosses = sells.filter(t => {
    const r = ((t.reason || '') + (t.preTradeReflection || '')).toLowerCase();
    return r.includes('stop-loss') || r.includes('stop loss') || r.includes('drawdown limit');
  });

  // Helpers
  const flg = (val: number, red: number, green: number, inv: boolean = false): string => {
    if (inv) { return val < red ? '🔴 RED' : val >= green ? '🟢 HEALTHY' : '🟡 WATCH'; }
    return val > red ? '🔴 RED' : val <= green ? '🟢 HEALTHY' : '🟡 WATCH';
  };

  // ── OUTPUT ────────────────────────────────────────────────────────────────
  console.log(`\n  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │  📊 SCORECARD                                              │`);
  console.log(`  ├─────────────────────┬─────────────────────┬────────────────┤`);
  console.log(`  │ Metric              │ Value               │ Status         │`);
  console.log(`  ├─────────────────────┼─────────────────────┼────────────────┤`);
  console.log(`  │ Total trades        │ ${String(trades.length).padEnd(19)} │ ${buys.length}B / ${sells.length}S`.padEnd(17 + 48) + `│`);
  console.log(`  │ Trades/day          │ ${tradesPerDay.toFixed(1).padEnd(19)} │ ${flg(tradesPerDay, 5, 2)}`.padEnd(17 + 48) + `│`);
  console.log(`  │ Win rate            │ ${(winRate.toFixed(1) + '% (' + wins.length + 'W/' + losses.length + 'L)').padEnd(19)} │ ${flg(winRate, 25, 40, true)}`.padEnd(17 + 48) + `│`);
  console.log(`  │ GPM scale-downs     │ ${(gpmDowns.length + ' (' + (gpmDowns.length / DAYS).toFixed(1) + '/day)').padEnd(19)} │ ${flg(gpmDowns.length / DAYS, 3, 1)}`.padEnd(17 + 48) + `│`);
  console.log(`  │ GPM scale-ups       │ ${String(gpmUps.length).padEnd(19)} │`.padEnd(17 + 48) + `│`);
  console.log(`  │ Take-profits        │ ${String(takeProfits.length).padEnd(19)} │ ${flg(takeProfits.length, 0, 2, true)}`.padEnd(17 + 48) + `│`);
  console.log(`  │ Stop-losses         │ ${String(stopLosses.length).padEnd(19)} │ ${flg(stopLosses.length, 2, 1)}`.padEnd(17 + 48) + `│`);
  console.log(`  │ vs BTC gap          │ ${(btcGap >= 0 ? '+' : '') + btcGap.toFixed(2) + '%'.padEnd(15)} │ ${btcGap > -4 ? '🟢' : btcGap > -8 ? '🟡' : '🔴'}`.padEnd(17 + 48) + `│`);
  console.log(`  └─────────────────────┴─────────────────────┴────────────────┘`);

  // NAV detail
  console.log(`\n  NAV: $${nav.toFixed(2)} (${navPct >= 0 ? '+' : ''}${navPct.toFixed(2)}% vs $${budget} budget)`);
  console.log(`  BTC: $${Number(btcStart||0).toFixed(0)} -> $${Number(btcEnd||0).toFixed(0)} (${btcPct >= 0 ? '+' : ''}${btcPct.toFixed(2)}%)`);
  console.log(`  Gap: ${btcGap >= 0 ? '+' : ''}${btcGap.toFixed(2)}%`);

  // Daily breakdown
  console.log(`\n  📅 DAILY TRADE COUNTS`);
  console.log(`  ─────────────────────────────────────────────`);
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(2026, 2, 9 + i)).toISOString().slice(0, 10);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d).getUTCDay()];
    const dc = dailyCounts[d] || { total: 0, buys: 0, sells: 0 };
    const bar = '█'.repeat(Math.min(dc.total, 20));
    const dayFlag = dc.total > 5 ? ' 🔴' : dc.total <= 2 ? '' : ' 🟡';
    console.log(`  ${d} (${dayName}) │ ${String(dc.total).padStart(2)} (${dc.buys}B/${dc.sells}S) ${bar}${dayFlag}`);
  }

  // Per-pool breakdown
  const poolMap: Record<string, any[]> = {};
  for (const t of trades) { const pid = t.poolId || 'unknown'; if (!poolMap[pid]) poolMap[pid] = []; poolMap[pid].push(t); }

  console.log(`\n  🏊 PER-POOL BREAKDOWN`);
  console.log(`  ${'─'.repeat(65)}`);
  for (const pool of (arena.pools || [])) {
    const pt = poolMap[pool.poolId] || [];
    const pBuys = pt.filter(t => t.type === 'BUY');
    const pSells = pt.filter(t => t.type === 'SELL');
    const pSellsWithPnl = pSells.filter(s => s.pnlPct !== undefined);
    const pWins = pSellsWithPnl.filter(s => s.pnlPct > 0).length;
    const pLosses = pSellsWithPnl.filter(s => s.pnlPct <= 0).length;
    const pWinRate = (pWins + pLosses) > 0 ? (pWins / (pWins + pLosses) * 100) : 0;
    const pGpm = pSells.filter(t => (t.reason || '').includes('GPM')).length;
    const pTp = pSells.filter(t => ((t.reason||'')+(t.preTradeReflection||'')).toLowerCase().includes('take-profit')).length;
    const pSl = pSells.filter(t => ((t.reason||'')+(t.preTradeReflection||'')).toLowerCase().includes('stop-loss')).length;

    let holdVal = 0;
    for (const h of Object.values(pool.holdings ?? {}) as any[]) holdVal += (h.amount||0) * (h.averagePrice||0);

    console.log(`\n  ${pool.emoji || '◆'} ${pool.name}`);
    console.log(`    Trades: ${pt.length} (${pBuys.length}B/${pSells.length}S) | Win: ${pWinRate.toFixed(0)}% (${pWins}W/${pLosses}L) | GPM↓: ${pGpm} | TP: ${pTp} | SL: ${pSl}`);
    console.log(`    Holdings: $${holdVal.toFixed(2)}`);

    if (pt.length > 0) {
      console.log(`    All trades this period:`);
      for (const t of pt) {
        const date = t.date?.slice(0, 16) || '?';
        const pnl = t.pnlPct !== undefined ? ` P&L: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '';
        const reasonShort = (t.reason || '').substring(0, 50);
        console.log(`      ${date} ${t.type.padEnd(4)} ${t.ticker.padEnd(5)} $${(t.total?.toFixed(2) || '?').padEnd(8)}${pnl}`);
        if (reasonShort) console.log(`        └─ ${reasonShort}`);
      }
    }
  }

  // Portfolio summary
  console.log(`\n  💼 PORTFOLIO SUMMARY`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Holdings:  $${totalHold.toFixed(2)}`);
  console.log(`  Cash:      $${(arena.sharedCash ?? 0).toFixed(2)}`);
  console.log(`  NAV:       $${nav.toFixed(2)} (${navPct >= 0 ? '+' : ''}${navPct.toFixed(2)}% vs $${budget} budget)`);
  console.log(`  Total trades (all time): ${allTrades.length}`);

  // Pre/post benchmark split
  const preBenchmark = allTrades.filter(t => t.date < '2026-03-12').sort((a, b) => a.date.localeCompare(b.date));
  const postBenchmark = allTrades.filter(t => t.date >= '2026-03-12').sort((a, b) => a.date.localeCompare(b.date));
  console.log(`\n  🔄 PRE vs POST BENCHMARK (12 Mar)`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Pre-benchmark trades:  ${preBenchmark.length}`);
  console.log(`  Post-benchmark trades: ${postBenchmark.length}`);
  
  const preSells = preBenchmark.filter(t => t.type === 'SELL' && t.pnlPct !== undefined);
  const postSells = postBenchmark.filter(t => t.type === 'SELL' && t.pnlPct !== undefined);
  const preWR = preSells.length > 0 ? (preSells.filter(s => s.pnlPct > 0).length / preSells.length * 100) : 0;
  const postWR = postSells.length > 0 ? (postSells.filter(s => s.pnlPct > 0).length / postSells.length * 100) : 0;
  const preTPD = preBenchmark.length > 0 ? preBenchmark.length / Math.max(1, Math.ceil((new Date('2026-03-12').getTime() - new Date(preBenchmark[0].date).getTime()) / 86400000)) : 0;
  const postTPD = postBenchmark.length > 0 ? postBenchmark.length / Math.max(1, Math.ceil((new Date('2026-03-16').getTime() - new Date('2026-03-12').getTime()) / 86400000)) : 0;

  console.log(`  Pre  win rate:  ${preWR.toFixed(1)}% (${preSells.filter(s => s.pnlPct > 0).length}W/${preSells.filter(s => s.pnlPct <= 0).length}L) | ${preTPD.toFixed(1)} trades/day`);
  console.log(`  Post win rate:  ${postWR.toFixed(1)}% (${postSells.filter(s => s.pnlPct > 0).length}W/${postSells.filter(s => s.pnlPct <= 0).length}L) | ${postTPD.toFixed(1)} trades/day`);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
