import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  
  // Actually, trades are NOT subcollections of userId in the new db schema!
  // recordArenaTrade does: adminDb.collection('arena_trades_ftse').add({ ...trade })
  // So we just query where userId == ...

  const users = await adminDb!.collection('arena_config_ftse').limit(1).get();
  if (users.empty) return;
  const userId = users.docs[0].id;

  const tradesSnap = await adminDb!.collection('arena_trades_ftse')
    .where('userId', '==', userId)
    // sort by date string since its an ISO string
    .get();
    
  const trades = tradesSnap.docs.map(d => d.data()).sort((a,b) => (a.date > b.date ? 1 : -1));

  console.log("TRADES:");
  let totalSellsUsd = 0;
  let totalBuysUsd = 0;
  trades.forEach(t => {
      console.log(`[${t.date}] ${t.type} ${t.ticker} | qty: ${t.amount} @ ${t.price} | total: ${t.total}`);
      if (t.type === 'SELL') totalSellsUsd += t.total;
      if (t.type === 'BUY') totalBuysUsd += t.total;
  });
  console.log(`\nTOTAL BUYS: ${totalBuysUsd}`);
  console.log(`TOTAL SELLS: ${totalSellsUsd}`);

  // Query actual system_logs or whatever collection dividend uses
  const { getArenaCollections } = await import('./src/lib/constants');
  const cols = getArenaCollections('FTSE');
  
  // Dividends write to system_logs_ftse? No, let's grep where dividends are written.
}
main().catch(console.error);
