import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function run() {
  // Check the top-level arena_trades doc
  const doc = await db.collection('arena_trades').doc(userId).get();
  if (doc.exists) {
    const d = doc.data() as any;
    console.log('Top-level doc fields:', Object.keys(d));
    if (Array.isArray(d.trades)) {
      console.log(`trades array: ${d.trades.length} entries`);
      // Show last 5
      for (const t of d.trades.slice(-5)) {
        console.log(`  ${t.date} ${t.type} ${t.ticker} $${t.total?.toFixed(2)} pnl:${t.pnlPct ?? '--'}`);
      }
    }
  }

  // Also check sub-collections of the doc
  const subCols = await db.collection('arena_trades').doc(userId).listCollections();
  console.log('\nSub-collections:', subCols.map(c => c.id));
  for (const col of subCols) {
    const snap = await col.orderBy('date', 'desc').limit(3).get();
    console.log(`  ${col.id}: ${snap.size} docs`);
    for (const d of snap.docs) {
      const data = d.data();
      console.log(`    ${d.id}: date=${data.date} type=${data.type} ticker=${data.ticker}`);
    }
  }

  // Also check if trades are just documents directly in arena_trades collection (not sub-col)
  const allDocs = await db.collection('arena_trades').limit(5).get();
  console.log(`\nAll arena_trades top-level docs: ${allDocs.size}`);
  for (const d of allDocs.docs) {
    console.log(`  ${d.id}: keys=${Object.keys(d.data()).slice(0, 5).join(',')}`);
  }

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
