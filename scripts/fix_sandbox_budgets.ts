/**
 * One-time fix: Correct totalBudget for non-crypto (sandbox) arenas.
 *
 * Bug: All arenas were initialized with totalBudget = 720 (crypto's budget
 * including DCA top-ups). FTSE, NYSE, Commodities don't get DCA, so their
 * totalBudget should be 600 (4 pools × $150).
 *
 * Run: npx tsx scripts/fix_sandbox_budgets.ts
 */

import { adminDb } from '../src/lib/firebase-admin';
import { POOL_COUNT, POOL_BUDGET, type AssetClass, getArenaCollections } from '../src/lib/constants';

const CORRECT_BUDGET = POOL_COUNT * POOL_BUDGET; // 600

async function fixSandboxBudgets() {
  if (!adminDb) {
    console.error('❌ Admin SDK not initialized');
    process.exit(1);
  }

  const sandboxClasses: AssetClass[] = ['FTSE', 'NYSE', 'COMMODITIES'];

  for (const assetClass of sandboxClasses) {
    const colName = getArenaCollections(assetClass).config;
    const snap = await adminDb.collection(colName).limit(10).get();

    if (snap.empty) {
      console.log(`[${assetClass}] No arena configs found — skipping.`);
      continue;
    }

    for (const doc of snap.docs) {
      const data = doc.data();
      const currentBudget = data.totalBudget;

      if (currentBudget === CORRECT_BUDGET) {
        console.log(`[${assetClass}] ✅ ${doc.id.substring(0, 8)}: already correct ($${CORRECT_BUDGET})`);
        continue;
      }

      console.log(`[${assetClass}] 🔧 ${doc.id.substring(0, 8)}: $${currentBudget} → $${CORRECT_BUDGET}`);
      await doc.ref.update({ totalBudget: CORRECT_BUDGET });
    }
  }

  console.log('\n✅ Done. All sandbox arena budgets corrected.');
}

fixSandboxBudgets().then(() => process.exit(0)).catch(e => {
  console.error('❌ Error:', e);
  process.exit(1);
});
