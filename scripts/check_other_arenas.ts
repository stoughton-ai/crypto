import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
async function run() {
  const collections = ['arena_config_ftse', 'arena_config_nyse', 'arena_config_commodities'];
  for (const col of collections) {
    const s = await db.collection(col).get();
    for (const doc of s.docs) {
      const a = doc.data() as any;
      if (!a.pools) continue;
      const poolCash = a.pools.reduce((s: number, p: any) => s + (p.cashBalance || 0), 0);
      console.log(`${col} | ${doc.id.substring(0,8)} | sharedCash: ${a.sharedCash ?? 'NONE'} | poolCash: £${poolCash.toFixed(2)} | pools: ${a.pools.length}`);
    }
  }
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
