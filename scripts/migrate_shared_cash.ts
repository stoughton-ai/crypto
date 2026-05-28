/**
 * One-shot migration: moves all per-pool cashBalance into arena.sharedCash.
 * Run with: npx ts-node --skip-project scripts/migrate_shared_cash.ts
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!svcJson) { console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
}
const db = admin.firestore();

async function migrate() {
  const snap = await db.collection('arena_config').get();
  let updated = 0;

  for (const doc of snap.docs) {
    const arena = doc.data() as any;
    if (!arena.pools) continue;

    const poolCash: number = arena.pools.reduce((s: number, p: any) => s + (p.cashBalance || 0), 0);
    const existing: number = arena.sharedCash || 0;
    const total = poolCash + existing;

    if (poolCash < 0.01) {
      console.log(`⏭  ${doc.id}: pool cash already $0 (sharedCash=$${existing.toFixed(2)})`);
      continue;
    }

    const updatedPools = arena.pools.map((p: any) => ({ ...p, cashBalance: 0 }));

    await db.collection('arena_config').doc(doc.id).update({
      sharedCash: total,
      pools: updatedPools,
    });

    console.log(`✅ ${doc.id}: $${poolCash.toFixed(2)} pool cash + $${existing.toFixed(2)} existing → sharedCash=$${total.toFixed(2)}`);
    updated++;
  }

  console.log(`\nDone. ${updated} arena(s) migrated.`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
