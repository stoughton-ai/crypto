import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function run() {
  // Check what collections exist for trades
  const possibleCols = ['arena_trades', 'trades', 'crypto_trades'];
  for (const col of possibleCols) {
    // Try as top-level collection
    const snap1 = await db.collection(col).limit(1).get();
    console.log(`${col} (top-level): ${snap1.size} docs`);

    // Try as sub-collection under userId
    const snap2 = await db.collection(col).doc(userId).collection('trades').limit(1).get();
    console.log(`${col}/${userId}/trades: ${snap2.size} docs`);
    if (snap2.size > 0) {
      const d = snap2.docs[0].data();
      console.log(`  Sample keys: ${Object.keys(d).join(', ')}`);
      console.log(`  date field: "${d.date}" (type: ${typeof d.date})`);
      console.log(`  Sample: ${JSON.stringify(d).substring(0, 200)}`);
    }

    // Try userId/all docs
    const snap3 = await db.collection(col).doc(userId).listCollections();
    if (snap3.length > 0) {
      console.log(`  Sub-collections under ${col}/${userId}: ${snap3.map(c => c.id).join(', ')}`);
    }
  }

  // Also try arena_trades directly (not sub-collection)
  const snap4 = await db.collection('arena_trades').doc(userId).get();
  if (snap4.exists) {
    const d = snap4.data() as any;
    console.log(`\narena_trades/${userId} doc fields: ${Object.keys(d).join(', ')}`);
  }

  // Check for trades as array field in arena_config
  const configDoc = await db.collection('arena_config').doc(userId).get();
  const config = configDoc.data() as any;
  if (config?.trades) console.log(`\narena_config has 'trades' field with ${config.trades.length} entries`);
  if (config?.tradeLog) console.log(`\narena_config has 'tradeLog' field with ${config.tradeLog.length} entries`);

  // Direct query with no date filter to find ANY trades
  const snap5 = await db.collection('arena_trades').doc(userId).collection('trades')
    .orderBy('date', 'desc').limit(3).get();
  console.log(`\narena_trades/${userId}/trades (no date filter, desc): ${snap5.size} docs`);
  for (const doc of snap5.docs) {
    const d = doc.data();
    console.log(`  ${doc.id}: date="${d.date}" type=${d.type} ticker=${d.ticker}`);
  }

  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
