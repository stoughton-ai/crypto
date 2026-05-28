const admin = require('firebase-admin');

const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!svcJson) { console.error('Missing FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
const svc = JSON.parse(svcJson);

admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

async function migrate() {
  const snap = await db.collection('arena_config').get();
  let updated = 0;

  for (const doc of snap.docs) {
    const arena = doc.data();
    if (!arena.pools) continue;

    // Sum up all per-pool cashBalance + existing sharedCash
    const poolCash = arena.pools.reduce((s, p) => s + (p.cashBalance || 0), 0);
    const existing = arena.sharedCash || 0;
    const total = poolCash + existing;

    if (poolCash < 0.01 && existing > 0) {
      console.log(`${doc.id}: already migrated (sharedCash=$${existing.toFixed(2)})`);
      continue;
    }

    // Zero out all per-pool cashBalance
    const updatedPools = arena.pools.map(p => ({ ...p, cashBalance: 0 }));

    await db.collection('arena_config').doc(doc.id).update({
      sharedCash: total,
      pools: updatedPools,
    });

    console.log(`✅ ${doc.id}: migrated $${poolCash.toFixed(2)} pool cash + $${existing.toFixed(2)} existing → sharedCash=$${total.toFixed(2)}`);
    updated++;
  }

  console.log(`\nDone. ${updated} arena(s) migrated.`);
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
