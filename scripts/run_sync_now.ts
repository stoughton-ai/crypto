/**
 * Calls syncFromRevolutAndReset directly using the project's own action.
 * Run: node_modules/.bin/tsx scripts/run_sync_now.ts
 */
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Must set this before importing actions (which needs firebase-admin)
process.env.NEXT_RUNTIME = 'nodejs';

async function run() {
  const { syncFromRevolutAndReset } = await import('../src/app/actions');

  // Arena userId from the arena_config doc
  const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

  console.log('🔄 Starting Revolut X → Dashboard sync...\n');
  const result = await syncFromRevolutAndReset(userId, 'CRYPTO');

  if (result.success) {
    console.log('✅ Sync complete!');
    console.log('   ', result.message);
    if (result.detail) console.log('\n📊 Detail:\n', result.detail);
  } else {
    console.error('❌ Sync failed:', result.message);
    if (result.detail) console.error('Detail:', result.detail);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
