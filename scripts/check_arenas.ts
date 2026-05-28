import * as dotenv from 'dotenv'; import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
import * as admin from 'firebase-admin';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
const db = admin.firestore();
db.collection('arena_config').get().then(s => {
  for (const doc of s.docs) {
    const a = doc.data() as any;
    if (!a.pools) continue;
    const poolCash = a.pools.reduce((s: number, p: any) => s + (p.cashBalance || 0), 0);
    console.log(doc.id.substring(0,8), '| assetClass:', a.assetClass, '| sharedCash:', a.sharedCash ?? 'NONE', '| poolCash sum:', poolCash.toFixed(2));
  }
  process.exit(0);
});
