import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  const users = await adminDb!.collection('arena_config_ftse').limit(1).get();
  if (users.empty) return;
  const userId = users.docs[0].id;

  const tradesSnap = await adminDb!.collection('arena_trades_ftse')
    .where('userId', '==', userId)
    .where('ticker', '==', 'TSCO')
    .get();
    
  const trades = tradesSnap.docs.map(d => d.data()).sort((a,b) => (a.date > b.date ? 1 : -1));

  console.log("TSCO TRADES:");
  trades.forEach(t => {
      console.log(`[${t.date}] ${t.type} ${t.ticker} | qty: ${t.amount} @ ${t.price} | total: ${t.total}`);
  });
}
main().catch(console.error);
