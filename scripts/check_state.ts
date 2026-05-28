import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();
async function run() {
  const doc = await db.collection('arena_config').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  const a = doc.data() as any;
  console.log('\n💼 CURRENT STATE:');
  console.log(`  sharedCash: $${(a.sharedCash ?? 0).toFixed(2)}`);
  console.log(`  totalBudget: $${a.totalBudget}`);
  let totalTokens = 0;
  for (const pool of a.pools) {
    let holdVal = 0;
    for (const [t, h] of Object.entries(pool.holdings as any)) {
      const hh = h as any;
      holdVal += hh.amount * hh.averagePrice;
    }
    totalTokens += holdVal;
    console.log(`  ${pool.emoji} ${pool.name}: poolCash=$${(pool.cashBalance||0).toFixed(2)}, tokens@cost=$${holdVal.toFixed(2)}`);
  }
  const nav = totalTokens + (a.sharedCash ?? 0);
  console.log(`\n  TOTAL tokens@cost: $${totalTokens.toFixed(2)}`);
  console.log(`  NAV (tokens+cash): $${nav.toFixed(2)}`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
