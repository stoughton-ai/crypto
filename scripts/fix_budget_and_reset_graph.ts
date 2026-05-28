/**
 * Fix arena.totalBudget to $720 (correctly reflects the actual invested capital)
 * and re-seed the performance graph from today with pnlPct based on $720.
 *
 * Run: node_modules/.bin/tsx scripts/fix_budget_and_reset_graph.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();

const ARENA_SNAPSHOTS_COLLECTION = 'arena_snapshots';
const TODAY = new Date().toISOString().slice(0, 10);
const CORRECT_TOTAL_BUDGET = 720; // $720 total invested

async function deleteSubCollectionDocs(ref: admin.firestore.CollectionReference) {
  const snap = await ref.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function run() {
  const arenaSnap = await db.collection('arena_config').get();

  for (const doc of arenaSnap.docs) {
    const arena = doc.data() as any;
    if (!arena.pools || !arena.initialized) continue;
    if (typeof arena.sharedCash === 'undefined' && !arena.btcDailyPrices) {
      console.log(`⏭  Skipping ${doc.id}`);
      continue;
    }

    console.log(`\n🔧 Fixing arena: ${doc.id}`);
    console.log(`   Old totalBudget: $${arena.totalBudget} → New: $${CORRECT_TOTAL_BUDGET}`);

    const sharedCash = arena.sharedCash ?? 0;
    let totalHoldingsAtCost = 0;

    const updatedPools = await Promise.all(arena.pools.map(async (pool: any) => {
      let holdVal = 0;
      for (const h of Object.values(pool.holdings ?? {}) as any[]) {
        holdVal += (h.amount || 0) * (h.averagePrice || 0);
      }
      totalHoldingsAtCost += holdVal;

      // pnlPct is 0 at reset — graph starts flat from this point
      const seedSnapshot = { date: TODAY, value: holdVal, pnlPct: 0 };

      // Clear sub-collection
      let deleted = 0;
      try {
        const colRef = db
          .collection(ARENA_SNAPSHOTS_COLLECTION)
          .doc(doc.id)
          .collection(pool.poolId);
        deleted = await deleteSubCollectionDocs(colRef);
      } catch {}

      console.log(`   ${pool.emoji} ${pool.name}: $${holdVal.toFixed(2)} @ cost | cleared ${deleted} docs`);

      return {
        ...pool,
        performance: {
          ...(pool.performance || {}),
          dailySnapshots: [seedSnapshot],
          totalPnlPct: 0,
          totalPnl: 0,
        },
      };
    }));

    const seedNAV = totalHoldingsAtCost + sharedCash;
    const seedPnlPct = ((seedNAV - CORRECT_TOTAL_BUDGET) / CORRECT_TOTAL_BUDGET) * 100;

    console.log(`\n   💰 sharedCash: $${sharedCash.toFixed(2)}`);
    console.log(`   📈 Seed NAV: $${seedNAV.toFixed(2)} → ${seedPnlPct.toFixed(2)}% vs $${CORRECT_TOTAL_BUDGET}`);

    await db.collection('arena_config').doc(doc.id).update({
      totalBudget: CORRECT_TOTAL_BUDGET,
      pools: updatedPools,
    });

    console.log(`\n✅ Done. Graph reset from ${TODAY}. All future cycles will build on this baseline.`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
