import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  } else if (line.startsWith('EODHD_API_KEY=')) {
    process.env.EODHD_API_KEY = line.substring('EODHD_API_KEY='.length).replace(/\r$/, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  
  // ═══ 1. READ ARENA CONFIG ═══
  const usersSnap = await adminDb!.collection('arena_config_ftse').limit(1).get();
  if (usersSnap.empty) { console.log('No FTSE arena found'); return; }
  const userId = usersSnap.docs[0].id;
  const arena = usersSnap.docs[0].data();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FTSE ARENA FULL AUDIT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`User: ${userId}`);
  console.log(`totalBudget: ${arena.totalBudget}`);
  console.log(`sharedCash: ${arena.sharedCash}`);
  console.log(`sharedDcaContributions: ${arena.sharedDcaContributions || 0}`);
  console.log(`sharedDcaReserve: ${arena.sharedDcaReserve || 0}`);
  console.log(`sharedDcaDeployed: ${arena.sharedDcaDeployed || 0}`);
  console.log();

  // ═══ 2. READ ALL TRADES ═══
  const tradesSnap = await adminDb!.collection('arena_trades_ftse').where('userId', '==', userId).get();
  const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => (a.date > b.date ? 1 : -1));

  console.log(`Total trade records: ${trades.length}`);
  
  // ═══ 3. REPLAY ALL TRADES FROM SCRATCH ═══
  // Start with initial budget, replay every buy/sell to compute expected sharedCash
  let simulatedCash = arena.totalBudget || 600;
  const dca = (arena.sharedDcaContributions || 0);
  simulatedCash += dca;
  
  let totalBuys = 0;
  let totalSells = 0;
  let totalBuyUsd = 0;
  let totalSellUsd = 0;
  let totalRealizedPnl = 0;
  
  // Track simulated holdings to verify cost basis
  const simHoldings: Record<string, { amount: number; avgPrice: number; totalCost: number }> = {};

  console.log('\n─── TRADE REPLAY ───');
  for (const t of trades as any[]) {
    const ticker = t.ticker;
    const type = t.type;
    const amount = t.amount;
    const price = t.price;
    const total = t.total || (amount * price);
    
    if (type === 'BUY') {
      totalBuys++;
      totalBuyUsd += total;
      simulatedCash -= total;
      
      // Update simulated holdings
      const h = simHoldings[ticker] || { amount: 0, avgPrice: 0, totalCost: 0 };
      const oldCost = h.amount * h.avgPrice;
      h.amount += amount;
      h.totalCost = oldCost + total;
      h.avgPrice = h.totalCost / h.amount;
      simHoldings[ticker] = h;
      
    } else if (type === 'SELL') {
      totalSells++;
      totalSellUsd += total;
      simulatedCash += total;
      totalRealizedPnl += (t.pnl || 0);
      
      // Update simulated holdings
      const h = simHoldings[ticker];
      if (h) {
        const costBasis = amount * h.avgPrice;
        const actualPnl = total - costBasis;
        h.amount -= amount;
        h.totalCost = h.amount * h.avgPrice;
        if (h.amount < 0.0000001) {
          delete simHoldings[ticker];
        }
      }
    }
  }

  console.log(`\nTotal BUYs: ${totalBuys} (£${totalBuyUsd.toFixed(2)})`);
  console.log(`Total SELLs: ${totalSells} (£${totalSellUsd.toFixed(2)})`);
  console.log(`Realized P&L (sum of trade.pnl): £${totalRealizedPnl.toFixed(4)}`);
  console.log(`Net flow (sells - buys): £${(totalSellUsd - totalBuyUsd).toFixed(4)}`);
  
  console.log('\n─── SIMULATED CASH ───');
  console.log(`Starting budget: £${arena.totalBudget}`);
  console.log(`+ DCA contributions: £${dca}`);
  console.log(`- Total buys: £${totalBuyUsd.toFixed(4)}`);
  console.log(`+ Total sells: £${totalSellUsd.toFixed(4)}`);
  console.log(`= Expected sharedCash: £${simulatedCash.toFixed(4)}`);
  console.log(`  Actual sharedCash:   £${arena.sharedCash?.toFixed(4)}`);
  console.log(`  DELTA:               £${(arena.sharedCash - simulatedCash).toFixed(4)}`);
  
  // ═══ 4. COMPARE SIMULATED HOLDINGS VS ACTUAL ═══
  console.log('\n─── HOLDINGS COMPARISON ───');
  console.log('\n  Simulated (from trade replay):');
  let simHoldingsCost = 0;
  for (const [ticker, h] of Object.entries(simHoldings)) {
    console.log(`    ${ticker}: qty=${h.amount.toFixed(8)}, avgPrice=£${h.avgPrice.toFixed(4)}, cost=£${h.totalCost.toFixed(4)}`);
    simHoldingsCost += h.totalCost;
  }
  console.log(`  Total simulated holdings cost: £${simHoldingsCost.toFixed(4)}`);
  
  console.log('\n  Actual (from Firestore):');
  let actualHoldingsCost = 0;
  for (const pool of arena.pools) {
    for (const [ticker, h] of Object.entries(pool.holdings || {}) as any) {
      const cost = h.amount * h.averagePrice;
      actualHoldingsCost += cost;
      console.log(`    ${ticker} (${pool.poolId}): qty=${h.amount.toFixed(8)}, avgPrice=£${h.averagePrice.toFixed(4)}, cost=£${cost.toFixed(4)}`);
      
      // Compare with simulated
      const sim = simHoldings[ticker];
      if (sim) {
        const qtyDelta = h.amount - sim.amount;
        const avgDelta = h.averagePrice - sim.avgPrice;
        if (Math.abs(qtyDelta) > 0.0000001 || Math.abs(avgDelta) > 0.01) {
          console.log(`      ⚠️ MISMATCH! sim qty=${sim.amount.toFixed(8)} (Δ${qtyDelta.toFixed(8)}), sim avgP=£${sim.avgPrice.toFixed(4)} (Δ${avgDelta.toFixed(4)})`);
        } else {
          console.log(`      ✅ Matches simulation`);
        }
      } else {
        console.log(`      ⚠️ NOT IN SIMULATION — ghost holding?`);
      }
    }
  }
  console.log(`  Total actual holdings cost: £${actualHoldingsCost.toFixed(4)}`);
  
  // Check for simulated holdings NOT in actual
  for (const [ticker, h] of Object.entries(simHoldings)) {
    let found = false;
    for (const pool of arena.pools) {
      if (pool.holdings?.[ticker]) found = true;
    }
    if (!found) {
      console.log(`  ⚠️ ${ticker} is in simulation (qty=${h.amount.toFixed(8)}) but NOT in actual holdings!`);
    }
  }
  
  // ═══ 5. POOL CASH BALANCES ═══
  console.log('\n─── POOL CASH BALANCES ───');
  let totalPoolCash = 0;
  for (const pool of arena.pools) {
    console.log(`  ${pool.poolId} (${pool.name}): cashBalance = £${(pool.cashBalance || 0).toFixed(4)}`);
    totalPoolCash += (pool.cashBalance || 0);
  }
  console.log(`  Total pool cash: £${totalPoolCash.toFixed(4)}`);
  if (totalPoolCash > 0.01) {
    console.log(`  ⚠️ Pool cash should be 0 in shared-cash model!`);
  }
  
  // ═══ 6. NAV CALCULATION ═══
  console.log('\n─── NAV CALCULATION (using cost basis as proxy for market value) ───');
  const navAtCost = (arena.sharedCash || 0) + actualHoldingsCost + totalPoolCash;
  const effectiveBasis = (arena.totalBudget || 600) + dca;
  const pnlPct = ((navAtCost - effectiveBasis) / effectiveBasis) * 100;
  console.log(`  sharedCash:      £${(arena.sharedCash || 0).toFixed(4)}`);
  console.log(`  holdingsCost:    £${actualHoldingsCost.toFixed(4)}`);
  console.log(`  poolCash:        £${totalPoolCash.toFixed(4)}`);
  console.log(`  NAV (at cost):   £${navAtCost.toFixed(4)}`);
  console.log(`  effectiveBasis:  £${effectiveBasis.toFixed(4)}`);
  console.log(`  P&L at cost:     ${pnlPct.toFixed(4)}%`);
  
  // ═══ 7. ACCOUNTING IDENTITY CHECK ═══
  console.log('\n─── ACCOUNTING IDENTITY CHECK ───');
  // Cash + holdings cost should equal: initial budget + DCA + realized P&L
  // Because: cash flows in (sells) and out (buys). Holdings track unrealized at cost.
  // So: cash = initial + DCA - sum(buys) + sum(sells)
  //     holdings cost = sum(buys) - cost_of_sold_shares
  //     cash + holdings cost = initial + DCA + realized_pnl
  const expectedTotal = effectiveBasis + totalRealizedPnl;
  const actualTotal = (arena.sharedCash || 0) + actualHoldingsCost + totalPoolCash;
  console.log(`  Expected (budget + DCA + realized PnL): £${expectedTotal.toFixed(4)}`);
  console.log(`  Actual (sharedCash + holdingsCost + poolCash): £${actualTotal.toFixed(4)}`);
  console.log(`  DELTA: £${(actualTotal - expectedTotal).toFixed(4)}`);
  if (Math.abs(actualTotal - expectedTotal) > 0.02) {
    console.log(`  ❌ ACCOUNTING MISMATCH DETECTED!`);
  } else {
    console.log(`  ✅ Accounting identity holds.`);
  }
  
  // ═══ 8. CHECK INDIVIDUAL TRADE PNL ACCURACY ═══
  console.log('\n─── SELL TRADE PNL VERIFICATION (last 20 sells) ───');
  // Re-simulate to check each sell's reported pnl
  const simH2: Record<string, { amount: number; avgPrice: number }> = {};
  let pnlMismatches = 0;
  const sellChecks: any[] = [];
  
  for (const t of trades as any[]) {
    const ticker = t.ticker;
    if (t.type === 'BUY') {
      const h = simH2[ticker] || { amount: 0, avgPrice: 0 };
      const oldCost = h.amount * h.avgPrice;
      h.amount += t.amount;
      h.avgPrice = (oldCost + t.total) / h.amount;
      simH2[ticker] = h;
    } else if (t.type === 'SELL') {
      const h = simH2[ticker];
      if (h) {
        const expectedCostBasis = t.amount * h.avgPrice;
        const expectedPnl = t.total - expectedCostBasis;
        const reportedPnl = t.pnl || 0;
        const delta = Math.abs(expectedPnl - reportedPnl);
        
        sellChecks.push({
          date: t.date,
          ticker,
          amount: t.amount,
          price: t.price,
          total: t.total,
          reportedPnl,
          expectedPnl,
          delta,
          mismatch: delta > 0.02,
        });
        
        if (delta > 0.02) pnlMismatches++;
        
        h.amount -= t.amount;
        if (h.amount < 0.0000001) delete simH2[ticker];
      }
    }
  }
  
  // Show last 20 sells
  for (const s of sellChecks.slice(-20)) {
    const flag = s.mismatch ? '⚠️' : '✅';
    console.log(`  ${flag} [${s.date?.substring(0,19)}] SELL ${s.ticker} qty=${s.amount.toFixed(6)} @ £${s.price.toFixed(2)} = £${s.total.toFixed(2)} | reported PnL: £${s.reportedPnl.toFixed(4)} | expected: £${s.expectedPnl.toFixed(4)} | Δ£${s.delta.toFixed(4)}`);
  }
  console.log(`\n  Total PnL mismatches: ${pnlMismatches} / ${sellChecks.length}`);
  
  // ═══ 9. SUMMARY VERDICT ═══
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  AUDIT VERDICT');
  console.log('═══════════════════════════════════════════════════════════');
  const issues: string[] = [];
  if (Math.abs(actualTotal - expectedTotal) > 0.02) {
    issues.push(`ACCOUNTING MISMATCH: £${(actualTotal - expectedTotal).toFixed(4)} unexplained`);
  }
  if (Math.abs(arena.sharedCash - simulatedCash) > 0.02) {
    issues.push(`SHARED CASH DRIFT: actual £${arena.sharedCash.toFixed(4)} vs expected £${simulatedCash.toFixed(4)} (Δ£${(arena.sharedCash - simulatedCash).toFixed(4)})`);
  }
  if (totalPoolCash > 0.01) {
    issues.push(`POOL CASH LEAK: £${totalPoolCash.toFixed(4)} sitting in pool.cashBalance`);
  }
  if (pnlMismatches > 0) {
    issues.push(`${pnlMismatches} sell trades have mismatched PnL values`);
  }
  
  if (issues.length === 0) {
    console.log('  ✅ ALL CHECKS PASSED — FTSE arena figures are correct.');
  } else {
    console.log(`  ❌ ${issues.length} ISSUE(S) FOUND:`);
    issues.forEach(i => console.log(`     • ${i}`));
  }
}

main().catch(console.error);
