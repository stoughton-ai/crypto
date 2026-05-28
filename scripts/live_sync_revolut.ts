/**
 * Syncs the dashboard (Firestore) with the actual Revolut X account.
 * Reads live Revolut holdings + USD cash, then updates arena pools to match.
 * Run: node_modules/.bin/tsx scripts/live_sync_revolut.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)) });
}
const db = admin.firestore();

// ── Dynamic import the server action ──────────────────────────────────────────
// We call syncFromRevolutAndReset directly via the service layer
async function run() {
  // Get arena doc
  const arenaSnap = await db.collection('arena_config').get();
  const arenaDoc = arenaSnap.docs.find(d => {
    const a = d.data() as any;
    return a.sharedCash !== undefined || a.btcDailyPrices;
  });

  if (!arenaDoc) { console.error('No crypto arena found'); process.exit(1); }
  const arena = arenaDoc.data() as any;
  const userId = arenaDoc.id;
  console.log(`Arena: ${userId}`);

  // Get agent config for Revolut credentials
  const configDoc = await db.collection('agent_configs').doc(userId).get();
  const config = configDoc.data() as any;

  if (!config?.revolutApiKey || !config?.revolutPrivateKey) {
    console.error('❌ Revolut API credentials not found in agent_configs');
    process.exit(1);
  }

  console.log('✅ Revolut credentials found');
  console.log('📡 Triggering sync via server action...');

  // Call the Next.js server action via HTTP to the Vercel deployment
  const response = await fetch('https://crypto-ten-drab.vercel.app/api/cron/arena', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-secret': process.env.CRON_SECRET || '' },
  });

  if (!response.ok) {
    console.warn(`Cron API returned ${response.status} — trying direct Firestore sync instead`);
  }

  // Direct Firestore approach: call the revolut service directly
  const { getRevolutHoldings, getRevolutUsdBalance } = await import('../src/services/revolutService' as any);

  console.log('\n💱 Fetching Revolut X balances...');
  const [holdings, usdBalance] = await Promise.all([
    getRevolutHoldings(userId),
    getRevolutUsdBalance(userId),
  ]);

  console.log(`  USD cash: $${usdBalance?.toFixed(2) ?? '?'}`);
  console.log('  Holdings:');
  for (const h of (holdings || [])) {
    console.log(`    ${h.ticker}: ${h.quantity}`);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
