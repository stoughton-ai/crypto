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
  console.log(`\ntotalBudget: $${a.totalBudget}`);
  console.log(`sharedCash: $${(a.sharedCash??0).toFixed(2)}`);
  let sumBudget = 0;
  for (const pool of a.pools) {
    const holdCost = Object.values(pool.holdings as any).reduce((s:number,h:any) => s + h.amount*h.averagePrice, 0);
    console.log(`  ${pool.emoji} ${pool.name}: budget=$${pool.budget}, holdCost=$${(holdCost as number).toFixed(2)}, cashBalance=$${(pool.cashBalance||0).toFixed(2)}`);
    sumBudget += (pool.budget || 0);
  }
  console.log(`\nSum pool.budget: $${sumBudget}`);
  console.log(`Expected effectiveBudget: $${sumBudget} (should be $720)`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
