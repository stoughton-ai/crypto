/**
 * Diagnose and nuke ALL snapshot data across every possible collection path,
 * then re-seed each pool with a single clean entry for today.
 *
 * Run: node_modules/.bin/tsx scripts/nuke_and_reseed_snapshots.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();
const TODAY = new Date().toISOString().slice(0, 10);

// All possible collection paths
const SNAPSHOT_COLLECTIONS = ['arena_snapshots', 'pool_snapshots', 'nav_history'];
const POOL_IDS = ['pool_1', 'pool_2', 'pool_3', 'pool_4',
                  'POOL_1', 'POOL_2', 'POOL_3', 'POOL_4'];

async function deleteAllInCollection(col: admin.firestore.CollectionReference): Promise<number> {
  let total = 0;
  // Paginate in case there are many docs
  let snap = await col.limit(500).get();
  while (!snap.empty) {
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    snap = await col.limit(500).get();
  }
  return total;
}

async function run() {
  const arenaSnap = await db.collection('arena_config').get();

  for (const doc of arenaSnap.docs) {
    const arena = doc.data() as any;
    if (!arena.pools || !arena.sharedCash === undefined && !arena.btcDailyPrices) continue;

    console.log(`\n🔍 Arena: ${doc.id}`);
    console.log(`   pools: ${arena.pools.map((p: any) => p.poolId).join(', ')}`);

    // ── 1. Find and delete all snapshot sub-collections ─────────────────────
    const poolIds = arena.pools.map((p: any) => p.poolId);
    let totalDeleted = 0;

    for (const colName of SNAPSHOT_COLLECTIONS) {
      // Check if the top-level doc exists
      const arenaDocRef = db.collection(colName).doc(doc.id);
      const arenaDocSnap = await arenaDocRef.get();

      for (const poolId of [...poolIds, ...POOL_IDS]) {
        const colRef = arenaDocRef.collection(poolId);
        const count = await deleteAllInCollection(colRef);
        if (count > 0) {
          console.log(`   🗑  Deleted ${count} docs from ${colName}/${doc.id}/${poolId}`);
          totalDeleted += count;
        }
      }

      // Also check userId-based paths
      if (arena.userId) {
        const userDocRef = db.collection(colName).doc(arena.userId);
        for (const poolId of [...poolIds, ...POOL_IDS]) {
          const colRef = userDocRef.collection(poolId);
          const count = await deleteAllInCollection(colRef);
          if (count > 0) {
            console.log(`   🗑  Deleted ${count} docs from ${colName}/${arena.userId}/${poolId}`);
            totalDeleted += count;
          }
        }
      }
    }
    console.log(`   Total snapshot docs deleted: ${totalDeleted}`);

    // ── 2. Reset all pool embedded snapshots + seed with today's clean entry ─
    const sharedCash = arena.sharedCash ?? 0;
    let totalHoldingsAtCost = 0;

    const updatedPools = arena.pools.map((pool: any) => {
      let holdCost = 0;
      let holdVal = 0;
      for (const h of Object.values(pool.holdings ?? {}) as any[]) {
        holdCost += (h.amount || 0) * (h.averagePrice || 0);
        holdVal  += (h.amount || 0) * (h.averagePrice || 0); // use cost as "value" for baseline
      }
      totalHoldingsAtCost += holdCost;

      // Seed: value = holdings at cost, pnlPct = 0 → chart starts perfectly flat
      const seedSnapshot = { date: TODAY, value: holdCost, pnlPct: 0 };
      console.log(`   📌 ${pool.emoji} ${pool.name}: seed $${holdCost.toFixed(2)}, pnlPct=0%`);

      return {
        ...pool,
        cashBalance: 0,  // ensure no stale cash
        performance: {
          ...(pool.performance || {}),
          dailySnapshots: [seedSnapshot],  // ONLY today's entry
          totalPnlPct: 0,
          totalPnl: 0,
        },
      };
    });

    const seedNAV = totalHoldingsAtCost + sharedCash;
    const budget = 720;
    const seedPnlPct = ((seedNAV - budget) / budget) * 100;
    console.log(`\n   💰 sharedCash: $${sharedCash.toFixed(2)}`);
    console.log(`   📈 Seed NAV: $${seedNAV.toFixed(2)} → ${seedPnlPct.toFixed(2)}% vs $${budget}`);

    await db.collection('arena_config').doc(doc.id).update({
      totalBudget: budget,
      pools: updatedPools,
    });

    console.log(`\n✅ Clean seed written for ${TODAY}. Graph will be flat from today forwards.`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
