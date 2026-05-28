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
  const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() as any })).sort((a, b) => (a.date > b.date ? 1 : -1));

  // Track AUTO specifically
  console.log('═══ AUTO TRADE HISTORY ═══');
  let autoQty = 0;
  let autoAvgP = 0;
  const autoTrades = trades.filter(t => t.ticker === 'AUTO');
  
  for (const t of autoTrades) {
    if (t.type === 'BUY') {
      const oldCost = autoQty * autoAvgP;
      autoQty += t.amount;
      autoAvgP = (oldCost + t.total) / autoQty;
      console.log(`[${t.date?.substring(0,19)}] BUY  ${t.amount.toFixed(8)} @ £${t.price.toFixed(2)} = £${t.total.toFixed(2)} | Running: qty=${autoQty.toFixed(8)} avgP=£${autoAvgP.toFixed(4)}`);
    } else {
      const costBasis = t.amount * autoAvgP;
      autoQty -= t.amount;
      console.log(`[${t.date?.substring(0,19)}] SELL ${t.amount.toFixed(8)} @ £${t.price.toFixed(2)} = £${t.total.toFixed(2)} PnL=£${t.pnl?.toFixed(4)} | Running: qty=${autoQty.toFixed(8)} avgP=£${autoAvgP.toFixed(4)}`);
    }
  }
  console.log(`\nFinal simulated AUTO: qty=${autoQty.toFixed(8)}, avgPrice=£${autoAvgP.toFixed(4)}`);
  
  // Get actual
  const doc = await adminDb!.collection('arena_config_ftse').doc(userId).get();
  const arena = doc.data()!;
  for (const pool of arena.pools) {
    const h = pool.holdings?.AUTO;
    if (h) {
      console.log(`Actual AUTO (${pool.poolId}): qty=${h.amount.toFixed(8)}, avgPrice=£${h.averagePrice.toFixed(4)}`);
      console.log(`MISSING QTY: ${(autoQty - h.amount).toFixed(8)}`);
      console.log(`MISSING VALUE at avgPrice: £${((autoQty - h.amount) * autoAvgP).toFixed(4)}`);
    }
  }

  // Now let's check: are there trades recorded AFTER the executePoolBuy fix that may have 
  // double-deducted sharedCash? Look for trades after our fix (around 2026-03-24T13:45)
  console.log('\n═══ TRADES AFTER BUG FIX (2026-03-24T13:45+) ═══');
  const postFixTrades = trades.filter(t => t.date > '2026-03-24T13:45');
  for (const t of postFixTrades) {
    console.log(`[${t.date?.substring(0,19)}] ${t.type} ${t.ticker} qty=${t.amount.toFixed(8)} @ £${t.price.toFixed(2)} = £${t.total.toFixed(2)} (pool: ${t.poolId})`);
  }

  // Also check: what's the actual total of BUYs post-fix?
  let postFixBuys = 0;
  let postFixSells = 0;
  for (const t of postFixTrades) {
    if (t.type === 'BUY') postFixBuys += t.total;
    else postFixSells += t.total;
  }
  console.log(`\nPost-fix: BUYs=£${postFixBuys.toFixed(2)}, SELLs=£${postFixSells.toFixed(2)}, net=£${(postFixSells - postFixBuys).toFixed(2)}`);
}

main().catch(console.error);
