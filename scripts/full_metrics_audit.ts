/**
 * Comprehensive 7-Day Metrics Audit — All Arenas
 * Benchmark: Changes implemented 12 March 2026
 * Period: Last 7 days (2026-03-09 → 2026-03-16)
 *
 * Metrics tracked per the user's watchlist:
 *   1. Trades/day     — Red: >5 | Healthy: <2
 *   2. Win rate        — Red: <25% | Healthy: >40%
 *   3. vs BTC gap      — Red: widening >-8% | Healthy: narrowing <-4% or positive
 *   4. GPM scale-downs — Red: >3/day | Healthy: 0-1/day
 *   5. Take-profits    — Red: 0 in 7 days | Healthy: 2+ in 7 days
 *   6. New stop-losses — Red: >2 in 7 days | Healthy: 0-1 in 7 days
 *
 * Run: node_modules/.bin/tsx scripts/full_metrics_audit.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();

const PERIOD_START = '2026-03-09T00:00:00Z';
const PERIOD_END   = '2026-03-16T23:59:59Z';
const DAYS = 7;

interface ArenaSpec {
  label: string;
  currency: string;
  configCol: string;
  tradesCol: string;
  assetClass: string;
}

const ARENAS: ArenaSpec[] = [
  { label: 'CRYPTO',      currency: '$', configCol: 'arena_config',             tradesCol: 'arena_trades',             assetClass: 'CRYPTO' },
  { label: 'FTSE',        currency: '£', configCol: 'arena_config_ftse',        tradesCol: 'arena_trades_ftse',        assetClass: 'FTSE' },
  { label: 'NYSE',        currency: '$', configCol: 'arena_config_nyse',        tradesCol: 'arena_trades_nyse',        assetClass: 'NYSE' },
  { label: 'COMMODITIES', currency: '$', configCol: 'arena_config_commodities', tradesCol: 'arena_trades_commodities', assetClass: 'COMMODITIES' },
];

function flag(val: number, redThreshold: number, greenThreshold: number, higher_is_worse: boolean = true): string {
  if (higher_is_worse) {
    if (val > redThreshold) return '🔴 RED';
    if (val <= greenThreshold) return '🟢 HEALTHY';
    return '🟡 WATCH';
  } else {
    if (val < redThreshold) return '🔴 RED';
    if (val >= greenThreshold) return '🟢 HEALTHY';
    return '🟡 WATCH';
  }
}

async function auditArena(spec: ArenaSpec) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${spec.label} ARENA — 7-DAY AUDIT (Mar 9-16, 2026)`);
  console.log(`${'═'.repeat(70)}`);

  // Get arena config
  const configSnap = await db.collection(spec.configCol).get();
  const arenaDoc = configSnap.docs[0];
  if (!arenaDoc) { console.log('  ⚠️  No arena config found'); return; }
  const arena = arenaDoc.data() as any;
  const userId = arenaDoc.id;

  // Get all trades in period
  const tradesSnap = await db.collection(spec.tradesCol)
    .doc(userId)
    .collection('trades')
    .where('date', '>=', PERIOD_START)
    .where('date', '<=', PERIOD_END)
    .orderBy('date', 'asc')
    .get();

  const trades = tradesSnap.docs.map(d => d.data() as any);
  const totalTrades = trades.length;
  const buys = trades.filter(t => t.type === 'BUY');
  const sells = trades.filter(t => t.type === 'SELL');

  // ── 1. Trades/day ──────────────────────────────────────────────────────────
  const tradesPerDay = totalTrades / DAYS;
  const tpdFlag = flag(tradesPerDay, 5, 2);

  // Daily breakdown
  const dailyCounts: Record<string, number> = {};
  for (const t of trades) {
    const day = t.date.slice(0, 10);
    dailyCounts[day] = (dailyCounts[day] || 0) + 1;
  }

  // ── 2. Win rate ────────────────────────────────────────────────────────────
  const sellsWithPnl = sells.filter(s => s.pnlPct !== undefined && s.pnlPct !== null);
  const wins = sellsWithPnl.filter(s => s.pnlPct > 0);
  const losses = sellsWithPnl.filter(s => s.pnlPct <= 0);
  const winRate = sellsWithPnl.length > 0 ? (wins.length / sellsWithPnl.length) * 100 : 0;
  const wrFlag = flag(winRate, 25, 40, false);

  // ── 3. BTC gap (CRYPTO only) ───────────────────────────────────────────────
  let btcGapStr = 'N/A';
  let btcGapFlag = '';
  if (spec.assetClass === 'CRYPTO') {
    const nav = arena.pools.reduce((s: number, p: any) => {
      let hv = 0;
      for (const h of Object.values(p.holdings ?? {}) as any[]) hv += (h.amount||0) * (h.averagePrice||0);
      return s + hv;
    }, 0) + (arena.sharedCash ?? 0);
    const totalBudget = arena.totalBudget ?? 720;
    const navPct = ((nav - totalBudget) / totalBudget) * 100;

    // BTC performance over same period (from btcDailyPrices if available)
    const btcPrices = arena.btcDailyPrices || {};
    const btcDates = Object.keys(btcPrices).sort();
    const btcStart = btcPrices[btcDates.find((d: string) => d >= '2026-03-09') || btcDates[btcDates.length-2]];
    const btcEnd = btcPrices[btcDates[btcDates.length - 1]];
    const btcPct = btcStart && btcEnd ? ((btcEnd - btcStart) / btcStart) * 100 : 0;
    const gap = navPct - btcPct;
    btcGapStr = `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}% (NAV: ${navPct.toFixed(2)}%, BTC: ${btcPct >= 0 ? '+' : ''}${btcPct.toFixed(2)}%)`;
    btcGapFlag = gap > -4 ? '🟢 HEALTHY' : gap > -8 ? '🟡 WATCH' : '🔴 RED';
  }

  // ── 4. GPM scale-downs ─────────────────────────────────────────────────────
  const gpmDowns = sells.filter(t =>
    t.reason?.includes('GPM') && (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE') || t.reason?.includes('scale-down'))
  );
  const gpmDownsPerDay = gpmDowns.length / DAYS;
  const gpmFlag = flag(gpmDownsPerDay, 3, 1);

  const gpmUps = buys.filter(t =>
    t.reason?.includes('GPM') && (t.reason?.includes('SCALE-UP') || t.reason?.includes('scale-up'))
  );

  // ── 5. Take-profits ───────────────────────────────────────────────────────
  const takeProfits = sells.filter(t =>
    t.reason?.toLowerCase().includes('take-profit') ||
    t.reason?.toLowerCase().includes('take profit') ||
    t.reason?.toLowerCase().includes('tp ') ||
    t.reason?.toLowerCase().includes('profit target')
  );
  const tpFlag = flag(takeProfits.length, 0, 2, false);

  // ── 6. New stop-losses ────────────────────────────────────────────────────
  const stopLosses = sells.filter(t =>
    t.reason?.toLowerCase().includes('stop-loss') ||
    t.reason?.toLowerCase().includes('stop loss') ||
    t.reason?.toLowerCase().includes('sl ') ||
    t.reason?.toLowerCase().includes('drawdown')
  );
  const slFlag = flag(stopLosses.length, 2, 1);

  // ── Per-pool breakdown ────────────────────────────────────────────────────
  const poolMap: Record<string, any[]> = {};
  for (const t of trades) {
    const pid = t.poolId || 'unknown';
    if (!poolMap[pid]) poolMap[pid] = [];
    poolMap[pid].push(t);
  }

  // ── OUTPUT ────────────────────────────────────────────────────────────────
  console.log(`\n  📊 SCORECARD\n  ${'─'.repeat(60)}`);
  console.log(`  Metric              │ Value           │ Status`);
  console.log(`  ────────────────────┼─────────────────┼──────────────`);
  console.log(`  Total trades        │ ${String(totalTrades).padEnd(15)} │ (${buys.length}B / ${sells.length}S)`);
  console.log(`  Trades/day          │ ${tradesPerDay.toFixed(1).padEnd(15)} │ ${tpdFlag}`);
  console.log(`  Win rate            │ ${winRate.toFixed(1)}% (${wins.length}W/${losses.length}L)`.padEnd(38) + `│ ${wrFlag}`);
  console.log(`  GPM scale-downs     │ ${gpmDowns.length} total (${gpmDownsPerDay.toFixed(1)}/day)`.padEnd(38) + `│ ${gpmFlag}`);
  console.log(`  GPM scale-ups       │ ${String(gpmUps.length).padEnd(15)} │`);
  console.log(`  Take-profits        │ ${String(takeProfits.length).padEnd(15)} │ ${tpFlag}`);
  console.log(`  Stop-losses         │ ${String(stopLosses.length).padEnd(15)} │ ${slFlag}`);
  if (spec.assetClass === 'CRYPTO') {
    console.log(`  vs BTC gap          │ ${btcGapStr.substring(0, 15).padEnd(15)} │ ${btcGapFlag}`);
  }

  // Daily breakdown
  console.log(`\n  📅 DAILY TRADE COUNTS`);
  console.log(`  ${'─'.repeat(40)}`);
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(2026, 2, 9 + i)).toISOString().slice(0, 10);
    const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d).getUTCDay()];
    const count = dailyCounts[d] || 0;
    const bar = '█'.repeat(Math.min(count, 20));
    const dayFlag = count > 5 ? ' 🔴' : count <= 2 ? '' : ' 🟡';
    console.log(`  ${d} (${dayName}) │ ${String(count).padStart(2)} ${bar}${dayFlag}`);
  }

  // Per-pool breakdown
  console.log(`\n  🏊 PER-POOL BREAKDOWN`);
  console.log(`  ${'─'.repeat(60)}`);
  for (const pool of (arena.pools || [])) {
    const poolTrades = poolMap[pool.poolId] || [];
    const pBuys = poolTrades.filter(t => t.type === 'BUY').length;
    const pSells = poolTrades.filter(t => t.type === 'SELL');
    const pWins = pSells.filter(s => s.pnlPct > 0).length;
    const pLosses = pSells.filter(s => s.pnlPct !== undefined && s.pnlPct <= 0).length;
    const pWinRate = (pWins + pLosses) > 0 ? (pWins / (pWins + pLosses) * 100) : 0;

    let holdVal = 0, holdCost = 0;
    for (const h of Object.values(pool.holdings ?? {}) as any[]) {
      holdVal += (h.amount || 0) * (h.averagePrice || 0);
      holdCost += (h.amount || 0) * (h.averagePrice || 0);
    }

    const pGpmDown = pSells.filter(t => t.reason?.includes('GPM') && (t.reason?.includes('CAUTION') || t.reason?.includes('DEFENSIVE'))).length;
    const pTp = pSells.filter(t => t.reason?.toLowerCase().includes('take-profit') || t.reason?.toLowerCase().includes('take profit')).length;
    const pSl = pSells.filter(t => t.reason?.toLowerCase().includes('stop-loss') || t.reason?.toLowerCase().includes('stop loss') || t.reason?.toLowerCase().includes('drawdown')).length;

    console.log(`  ${pool.emoji || '◆'} ${pool.name}`);
    console.log(`    Trades: ${poolTrades.length} (${pBuys}B/${pSells.length}S) | Win: ${pWinRate.toFixed(0)}% (${pWins}W/${pLosses}L)`);
    console.log(`    Holdings: ${spec.currency}${holdVal.toFixed(2)} | GPM↓: ${pGpmDown} | TP: ${pTp} | SL: ${pSl}`);

    // List actual trades
    if (poolTrades.length > 0) {
      console.log(`    Recent trades:`);
      for (const t of poolTrades.slice(-8)) {
        const date = t.date?.slice(0, 16) || '?';
        const pnl = t.pnlPct !== undefined ? ` P&L: ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%` : '';
        const reason = t.reason ? ` [${t.reason.substring(0, 40)}]` : '';
        console.log(`      ${date} ${t.type} ${t.ticker} ${spec.currency}${t.total?.toFixed(2) || '?'}${pnl}${reason}`);
      }
    }
    console.log('');
  }

  // Portfolio summary
  const totalHold = arena.pools.reduce((s: number, p: any) => {
    let hv = 0;
    for (const h of Object.values(p.holdings ?? {}) as any[]) hv += (h.amount||0) * (h.averagePrice||0);
    return s + hv;
  }, 0);
  const cash = arena.sharedCash ?? 0;
  const nav = totalHold + cash;
  const budget = arena.totalBudget ?? arena.pools.reduce((s: number, p: any) => s + (p.budget || 0), 0);
  const navPct = budget > 0 ? ((nav - budget) / budget) * 100 : 0;

  console.log(`  💼 PORTFOLIO SUMMARY`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Holdings:  ${spec.currency}${totalHold.toFixed(2)}`);
  console.log(`  Cash:      ${spec.currency}${cash.toFixed(2)}`);
  console.log(`  NAV:       ${spec.currency}${nav.toFixed(2)} (${navPct >= 0 ? '+' : ''}${navPct.toFixed(2)}% vs ${spec.currency}${budget.toFixed(0)} budget)`);
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║         COMPREHENSIVE 7-DAY METRICS AUDIT — ALL ARENAS             ║');
  console.log('║         Period: 2026-03-09 → 2026-03-16                            ║');
  console.log('║         Benchmark: Changes deployed 12 March 2026                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  for (const spec of ARENAS) {
    await auditArena(spec);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('  AUDIT COMPLETE');
  console.log(`${'═'.repeat(70)}`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
