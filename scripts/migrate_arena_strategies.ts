/**
 * Migration script to update existing sandbox arena pool strategies
 * with the new competition-mode parameters from the audit.
 * 
 * This updates ALL pools in FTSE, NYSE, and Commodities arenas
 * with the optimized parameters — it does NOT touch Crypto.
 * 
 * Run:  npx tsx scripts/migrate_arena_strategies.ts
 * (Requires FIREBASE_SERVICE_ACCOUNT_JSON env var or .env.local)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : null;

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON not found. Cannot run migration.');
    process.exit(1);
  }
}

const db = admin.firestore();

// The new competition-optimized strategy defaults
const COMPETITION_STRATEGY_UPDATES: Record<string, number> = {
  buyScoreThreshold: 65,        // DOWN from 70 — more entries
  buyConfidenceBuffer: 0,       // DOWN from 5 — no hidden tax
  takeProfitTarget: 3,          // DOWN from 8 — achievable, enables compounding
  trailingStopPct: 1.5,         // DOWN from 3 — lock gains faster
  minHoldMinutes: 30,           // DOWN from 60 — faster cycling
  evaluationCooldownMinutes: 15, // DOWN from 30 — 2x more scoring chances
  reentryPenalty: 3,            // DOWN from 5 — faster re-entry
  exitThreshold: 45,            // DOWN from 50 — hold a bit longer
};

// Arena collection names (from getArenaCollections in constants.ts: arena_config_${ns})
const ARENA_COLLECTIONS: Record<string, string> = {
  FTSE: 'arena_config_ftse',
  NYSE: 'arena_config_nyse',
  COMMODITIES: 'arena_config_commodities',
};

async function migrate() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ARENA STRATEGY MIGRATION — Competition Mode Parameters');
  console.log('  Updating FTSE, NYSE, and Commodities arenas');
  console.log('  Crypto arena is NOT affected.');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const [assetClass, collection] of Object.entries(ARENA_COLLECTIONS)) {
    console.log(`\n📊 Processing ${assetClass} arena (${collection})...`);

    const snap = await db.collection(collection).get();
    if (snap.empty) {
      console.log(`   ⚠️ No documents found in ${collection}. Skipping.`);
      continue;
    }

    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.initialized || !data.pools) {
        console.log(`   ⚠️ ${doc.id}: Not initialized. Skipping.`);
        continue;
      }

      console.log(`   🔧 Updating ${doc.id} (${data.pools.length} pools):`);

      let anyChanged = false;
      for (const pool of data.pools) {
        const strategy = pool.strategy;
        if (!strategy) continue;

        const changes: string[] = [];

        for (const [key, newValue] of Object.entries(COMPETITION_STRATEGY_UPDATES)) {
          const oldValue = strategy[key];
          // Only update if current value is more conservative (or missing)
          const shouldUpdate = (oldValue === undefined || oldValue > newValue);

          if (shouldUpdate) {
            changes.push(`${key}: ${oldValue ?? 'undefined'} → ${newValue}`);
            strategy[key] = newValue;
            anyChanged = true;
          }
        }

        if (changes.length > 0) {
          console.log(`      ${pool.emoji} ${pool.name}:`);
          changes.forEach((c: string) => console.log(`         ✅ ${c}`));
        } else {
          console.log(`      ${pool.emoji} ${pool.name}: Already optimal — no changes needed.`);
        }
      }

      if (anyChanged) {
        await db.collection(collection).doc(doc.id).set(data);
        console.log(`   💾 Saved ${doc.id} to Firestore.`);
      } else {
        console.log(`   ℹ️ ${doc.id}: No changes needed.`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ✅ MIGRATION COMPLETE');
  console.log('  All sandbox arena pools now have competition-optimized params.');
  console.log('  Next cron cycle will use the new configuration.');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

migrate().catch(console.error);
