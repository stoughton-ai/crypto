/**
 * Migrates FTSE, NYSE, and Commodities arenas to the shared-cash model.
 * Consolidates all pool.cashBalance values into arena.sharedCash,
 * zeros out all pool.cashBalance fields, and resets performance snapshots
 * with a clean Day-1 baseline.
 *
 * Run: node_modules/.bin/tsx scripts/migrate_other_arenas_to_shared_cash.ts
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

const ARENA_COLLECTIONS = [
  { col: 'arena_config_ftse',        snapCol: 'arena_snapshots_ftse',        label: 'FTSE',        currency: '£' },
  { col: 'arena_config_nyse',        snapCol: 'arena_snapshots_nyse',        label: 'NYSE',        currency: '$' },
  { col: 'arena_config_commodities', snapCol: 'arena_snapshots_commodities', label: 'Commodities', currency: '$' },
];

async function deleteAll(col: admin.firestore.CollectionReference): Promise<number> {
  let total = 0;
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

async function migrateArena(colName: string, snapColName: string, label: string, currency: string) {
  const snap = await db.collection(colName).get();
  for (const doc of snap.docs) {
    const arena = doc.data() as any;
    if (!arena.pools || !arena.initialized) continue;

    console.log(`\n📊 ${label} arena: ${doc.id.substring(0, 8)}`);

    // ── 1. Consolidate per-pool cash → arena.sharedCash ───────────────────
    const poolCash: number = arena.pools.reduce((s: number, p: any) => s + (p.cashBalance || 0), 0);
    const existingSharedCash: number = arena.sharedCash ?? 0;
    const totalSharedCash = poolCash + existingSharedCash;

    console.log(`   Pool cash total: ${currency}${poolCash.toFixed(2)}`);
    console.log(`   Existing sharedCash: ${currency}${existingSharedCash.toFixed(2)}`);
    console.log(`   → New sharedCash: ${currency}${totalSharedCash.toFixed(2)}`);

    // ── 2. Reset each pool's snapshots and zero cashBalance ───────────────
    let totalHoldingsAtCost = 0;

    const updatedPools = await Promise.all(arena.pools.map(async (pool: any) => {
      let holdCost = 0;
      for (const h of Object.values(pool.holdings ?? {}) as any[]) {
        holdCost += (h.amount || 0) * (h.averagePrice || 0);
      }
      totalHoldingsAtCost += holdCost;

      // Clear sub-collection snapshots
      let deleted = 0;
      try {
        deleted = await deleteAll(
          db.collection(snapColName).doc(doc.id).collection(pool.poolId)
        );
      } catch {}

      const seedSnapshot = { date: TODAY, value: holdCost, pnlPct: 0 };
      console.log(`   ${pool.emoji ?? '◆'} ${pool.name}: holdCost=${currency}${holdCost.toFixed(2)}, cleared ${deleted} snapshots`);

      return {
        ...pool,
        cashBalance: 0,          // zeroed — cash now lives in arena.sharedCash
        performance: {
          ...(pool.performance || {}),
          dailySnapshots: [seedSnapshot],
          totalPnlPct: 0,
          totalPnl: 0,
        },
      };
    }));

    // ── 3. Compute seed NAV and write back ────────────────────────────────
    const seedNAV = totalHoldingsAtCost + totalSharedCash;
    const budget = arena.totalBudget ?? arena.pools.reduce((s: number, p: any) => s + (p.budget || 0), 0);
    const seedPnlPct = budget > 0 ? ((seedNAV - budget) / budget) * 100 : 0;

    console.log(`\n   Seed NAV: ${currency}${seedNAV.toFixed(2)} (${seedPnlPct.toFixed(2)}% vs ${currency}${budget.toFixed(2)} budget)`);

    // Also clear ARENA_NAV sub-collection
    try {
      await deleteAll(db.collection(snapColName).doc(doc.id).collection('ARENA_NAV'));
    } catch {}

    await db.collection(colName).doc(doc.id).update({
      sharedCash: totalSharedCash,
      pools: updatedPools,
    });

    console.log(`   ✅ ${label} migrated to shared-cash model.`);
  }
}

async function run() {
  for (const { col, snapCol, label, currency } of ARENA_COLLECTIONS) {
    await migrateArena(col, snapCol, label, currency);
  }

  console.log('\n🎉 All arenas now use the shared-cash model.');
  console.log('   The next trading cycle will allocate cash to the highest-conviction signals across all pools.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
