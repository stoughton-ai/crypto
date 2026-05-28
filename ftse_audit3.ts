import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

  const tradesSnap = await adminDb!.collection('arena_trades_ftse').where('userId', '==', userId).get();
  const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() as any })).sort((a: any, b: any) => (a.date > b.date ? 1 : -1));

  // ═══ 1. FIND DUPLICATE TRADES ═══
  console.log('═══ SEARCHING FOR DUPLICATE TRADES ═══');
  const seen = new Map<string, any[]>();
  for (const t of trades) {
    // Key by: ticker + type + amount + price + date (to the minute)
    const dateMin = t.date?.substring(0, 16); // YYYY-MM-DDTHH:MM
    const key = `${t.ticker}|${t.type}|${t.amount}|${t.price}|${dateMin}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(t);
  }

  const dupes: any[] = [];
  for (const [key, group] of seen.entries()) {
    if (group.length > 1) {
      console.log(`\n⚠️ DUPLICATE (${group.length}×): ${key}`);
      for (const t of group) {
        console.log(`   ID: ${t.id} | date: ${t.date} | pool: ${t.poolId} | total: £${t.total?.toFixed(2)} | pnl: £${t.pnl?.toFixed(4) || 'n/a'}`);
        dupes.push(t);
      }
    }
  }

  if (dupes.length === 0) {
    console.log('  No exact duplicates found.');
  }

  // ═══ 2. TRACE THE EXACT £75 GAP ═══
  // The accounting says: expected cash = £107, actual = £32.35, delta = -£74.65
  // The holdings show: sim has AUTO=0.324 but actual=0.161
  // Missing AUTO qty = 0.163 × £461 avg = ~£75 in holdings cost
  // This means £75 of holdings is simply GONE — sold in the DB but the cash was never added
  // OR the sharedCash was double-decremented after our fix
  
  console.log('\n\n═══ DOUBLE-DEDUCTION ANALYSIS ═══');
  console.log('The fix we deployed yesterday made executePoolBuy deduct sharedCash in the DB.');
  console.log('But runSandboxArenaCycle ALSO deducts sharedCash in memory after the buy.');
  console.log('If both paths ran, every post-fix buy would be double-deducted.\n');
  
  // Post-fix buys
  const postFixBuys = trades.filter((t: any) => t.type === 'BUY' && t.date > '2026-03-24T13:45');
  let totalDoubleDeduction = 0;
  for (const t of postFixBuys as any[]) {
    console.log(`  BUY ${t.ticker} £${t.total.toFixed(2)} @ ${t.date?.substring(0,19)}`);
    totalDoubleDeduction += t.total;
  }
  console.log(`\nTotal post-fix BUYs: £${totalDoubleDeduction.toFixed(2)}`);
  console.log(`If each was double-deducted, the gap would be: £${totalDoubleDeduction.toFixed(2)}`);
  console.log(`Actual gap: ~£75`);
  
  // ═══ 3. Track sharedCash evolution through the sell path ═══
  console.log('\n\n═══ CHECK: executePoolSell ALSO adds to sharedCash ═══');
  console.log('executePoolSell adds sell total to arena.sharedCash AND saves to DB.');
  console.log('But runSandboxArenaCycle ALSO does: (arena as any).sharedCash += result.trade.total');
  console.log('This would DOUBLE-ADD sells if both paths ran.\n');
  
  const postFixSells = trades.filter((t: any) => t.type === 'SELL' && t.date > '2026-03-24T13:45');
  let totalDoubleAddition = 0;
  for (const t of postFixSells as any[]) {
    console.log(`  SELL ${t.ticker} £${t.total.toFixed(2)} @ ${t.date?.substring(0,19)}`);
    totalDoubleAddition += t.total;
  }
  console.log(`\nTotal post-fix SELLs: £${totalDoubleAddition.toFixed(2)}`);
  console.log(`If each was double-added, surplus would be: £${totalDoubleAddition.toFixed(2)}`);
  console.log(`Net effect: double-adds (£${totalDoubleAddition.toFixed(2)}) - double-deductions (£${totalDoubleDeduction.toFixed(2)}) = £${(totalDoubleAddition - totalDoubleDeduction).toFixed(2)}`);
  
  // ═══ 4. So the REAL picture: ═══
  // executePoolBuy now deducts from DB sharedCash
  // runSandboxArenaCycle also deducts from memory sharedCash
  // Then the final save persists the memory version → double deduction!
  // 
  // executePoolSell adds to DB sharedCash  
  // runSandboxArenaCycle also adds to memory sharedCash
  // Then the final save persists → double addition!
  //
  // Net = +double_sells - double_buys = £363.17 - £461.51 = -£98.34
  // But the gap is only £75, so there's also the duplicate AUTO sell (£72.90) to account for
  
  // ═══ 5. Let's do a PROPER simulation that handles the duplicate correctly
  console.log('\n\n═══ CORRECT SIMULATION (excluding duplicate trade) ═══');
  
  // Find the exact duplicate AUTO sell
  const autoSells0724_08 = trades.filter((t: any) => 
    t.ticker === 'AUTO' && t.type === 'SELL' && 
    t.date?.startsWith('2026-03-24T08')
  );
  console.log(`Duplicate AUTO sells on 2026-03-24T08: ${autoSells0724_08.length}`);
  for (const t of autoSells0724_08 as any[]) {
    console.log(`  ID: ${t.id} | amount: ${t.amount} | price: ${t.price} | total: ${t.total}`);
  }
  
  // The earlier AUTO sell at 07:00:50 was the real one.
  // The one at 08:00:52 is the duplicate. Let's identify its ID.
  const dupeId = autoSells0724_08.length > 0 ? (autoSells0724_08[0] as any).id : null;
  console.log(`\nDuplicate trade ID to remove: ${dupeId}`);
  
  // Simulate excluding the duplicate
  let cashSim = 600;
  const holdSim: Record<string, { amount: number; avgPrice: number }> = {};
  
  for (const t of trades as any[]) {
    if (t.id === dupeId) continue; // skip duplicate
    
    if (t.type === 'BUY') {
      cashSim -= t.total;
      const h = holdSim[t.ticker] || { amount: 0, avgPrice: 0 };
      const oldCost = h.amount * h.avgPrice;
      h.amount += t.amount;
      h.avgPrice = (oldCost + t.total) / h.amount;
      holdSim[t.ticker] = h;
    } else {
      cashSim += t.total;
      const h = holdSim[t.ticker];
      if (h) {
        h.amount -= t.amount;
        if (h.amount < 0.0000001) delete holdSim[t.ticker];
      }
    }
  }
  
  console.log(`\nCorrected expected cash: £${cashSim.toFixed(4)}`);
  let corrHoldCost = 0;
  for (const [ticker, h] of Object.entries(holdSim)) {
    corrHoldCost += h.amount * h.avgPrice;
    console.log(`  ${ticker}: qty=${h.amount.toFixed(8)}, avgP=£${h.avgPrice.toFixed(4)}, cost=£${(h.amount * h.avgPrice).toFixed(4)}`);
  }
  console.log(`Corrected holdings cost: £${corrHoldCost.toFixed(4)}`);
  console.log(`Corrected total: £${(cashSim + corrHoldCost).toFixed(4)}`);
  console.log(`Should equal budget (£600): ${Math.abs(cashSim + corrHoldCost - 600) < 0.02 ? '✅ YES' : '❌ NO (Δ£' + (cashSim + corrHoldCost - 600).toFixed(4) + ')'}`);
}

main().catch(console.error);
