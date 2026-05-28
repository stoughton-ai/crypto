import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function run() {
  // Get one doc to see the full structure
  const sample = await db.collection('arena_trades').limit(1).get();
  if (sample.size > 0) {
    console.log('Full sample doc:');
    console.log(JSON.stringify(sample.docs[0].data(), null, 2));
  }

  // Count total docs for this user
  const allForUser = await db.collection('arena_trades')
    .where('userId', '==', userId)
    .get();
  console.log(`\nTotal trades for ${userId}: ${allForUser.size}`);

  // Recent trades
  const recent = await db.collection('arena_trades')
    .where('userId', '==', userId)
    .orderBy('date', 'desc')
    .limit(10)
    .get();
  console.log(`\nLast 10 trades:`);
  for (const doc of recent.docs) {
    const d = doc.data();
    const pnl = d.pnlPct !== undefined ? ` P&L:${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(2)}%` : '';
    console.log(`  ${d.date} ${d.type} ${d.ticker}(${d.poolName}) $${d.total?.toFixed(2)}${pnl}`);
  }

  // Trades in last 7 days
  const weekAgo = '2026-03-09T00:00:00';
  const weekTrades = await db.collection('arena_trades')
    .where('userId', '==', userId)
    .where('date', '>=', weekAgo)
    .orderBy('date', 'desc')
    .get();
  console.log(`\nTrades since ${weekAgo}: ${weekTrades.size}`);

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
