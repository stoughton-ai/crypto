import * as fs from 'fs';
import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function main() {
  const { adminDb } = await import('../src/lib/firebase-admin');
  if (!adminDb) return;
  const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
  console.log("Checking history for user:", userId);

  const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
  const arena = arenaDoc.data();
  if (!arena) {
    console.log("No arena config found");
    return;
  }

  for (const pool of arena.pools) {
    console.log(`\n--- Pool: ${pool.name} ---`);
    console.log(`Base Budget: ${pool.budget}, DCA: ${pool.dcaContributions}`);
    const snaps = await adminDb.collection('arena_snapshots').doc(userId).collection(pool.poolId).orderBy('date', 'asc').get();
    
    let lastValue = pool.budget; // baseline
    snaps.docs.forEach(doc => {
      const d = doc.data();
      const diff = d.value - lastValue;
      console.log(`Date: ${d.date} | Value: $${d.value.toFixed(2)} | PnlPct: ${d.pnlPct?.toFixed(2)}% | ValueDiff: $${diff.toFixed(2)}`);
      lastValue = d.value;
    });
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
