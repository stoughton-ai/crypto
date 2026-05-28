/**
 * Reset performance graph for the Crypto arena.
 * - Clears all pool.performance.dailySnapshots (embedded in arena_config)
 * - Deletes all docs in the arena_snapshots Firestore sub-collection
 * - Seeds a single clean Day-1 snapshot with today's correct NAV
 *   (token holdings at current averagePrice + sharedCash)
 *
 * Run: node_modules/.bin/tsx scripts/reset_performance_graph.ts
 */
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON!;
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(svcJson)) });
}
const db = admin.firestore();

const ARENA_SNAPSHOTS_COLLECTION = 'arena_snapshots'; // for crypto
const TODAY = new Date().toISOString().slice(0, 10);

async function deleteSubCollectionDocs(ref: admin.firestore.CollectionReference) {
  const snap = await ref.get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function run() {
  // Only operate on the crypto arena
  const arenaSnap = await db.collection('arena_config').get();

  for (const doc of arenaSnap.docs) {
    const arena = doc.data() as any;
    if (!arena.pools || !arena.initialized) continue;

    // Check this is the crypto arena (has btcDailyPrices or assetClass = CRYPTO)
    // We check sharedCash exists (only crypto arena has been migrated)
    if (typeof arena.sharedCash === 'undefined' && !arena.btcDailyPrices) {
      console.log(`⏭  Skipping ${doc.id} — not crypto arena`);
      continue;
    }

    console.log(`\n📊 Resetting performance graph for arena: ${doc.id}`);

    const sharedCash = arena.sharedCash ?? 0;
    const totalBudget = arena.totalBudget ?? 720;

    // ── 1. Reset each pool's dailySnapshots & build seed value ───────────────
    let totalHoldingsAtCost = 0;

    const updatedPools = await Promise.all(arena.pools.map(async (pool: any) => {
      // Compute this pool's current holding value at average price (no live price needed)
      let holdVal = 0;
      for (const h of Object.values(pool.holdings ?? {}) as any[]) {
        holdVal += (h.amount || 0) * (h.averagePrice || 0);
      }
      totalHoldingsAtCost += holdVal;

      // Seed snapshot: value = holdings at cost (conservative baseline)
      // pnlPct = 0 at reset point (graph starts flat from today)
      const seedSnapshot = { date: TODAY, value: holdVal, pnlPct: 0 };

      // ── 2. Delete Firestore sub-collection docs for this pool ──────────────
      let deleted = 0;
      try {
        const colRef = db
          .collection(ARENA_SNAPSHOTS_COLLECTION)
          .doc(doc.id)
          .collection(pool.poolId);
        deleted = await deleteSubCollectionDocs(colRef);
      } catch (e: any) {
        console.warn(`  ⚠️  Could not clear sub-collection for ${pool.poolId}: ${e.message}`);
      }

      console.log(`  ${pool.emoji} ${pool.name}: holdings@cost=$${holdVal.toFixed(2)}, cleared ${deleted} snapshot docs`);

      return {
        ...pool,
        performance: {
          ...(pool.performance || {}),
          dailySnapshots: [seedSnapshot],
          // Reset P&L stats — they'll rebuild naturally over cycles
          totalPnlPct: 0,
          totalPnl: 0,
          winCount: pool.performance?.winCount ?? 0,
          lossCount: pool.performance?.lossCount ?? 0,
        },
      };
    }));

    // ── 3. Compute correct seed NAV for the arena ─────────────────────────────
    const seedNAV = totalHoldingsAtCost + sharedCash;
    const seedPnlPct = totalBudget > 0 ? ((seedNAV - totalBudget) / totalBudget) * 100 : 0;

    console.log(`\n  💰 sharedCash: $${sharedCash.toFixed(2)}`);
    console.log(`  📈 Seed NAV: $${seedNAV.toFixed(2)} (${seedPnlPct.toFixed(2)}% vs $${totalBudget} budget)`);
    console.log(`  📅 Reset date: ${TODAY}`);

    // ── 4. Write back to Firestore ────────────────────────────────────────────
    await db.collection('arena_config').doc(doc.id).update({
      pools: updatedPools,
    });

    console.log(`\n✅ Done. Graph will start fresh from ${TODAY}.`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
