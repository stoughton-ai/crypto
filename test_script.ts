import { adminDb } from './src/lib/firebase-admin';
import { getVerifiedPrices } from './src/app/actions';

async function main() {
  const userId = 'GdbbZzBup3eXyFjGbbjF1nUONZ83'; // Find user from DB
  const users = await adminDb.collection('agent_configs').limit(1).get();
  const uid = users.docs[0].id;
  
  const arena = await adminDb.collection('arena_config').doc(uid).get();
  const data = arena.data();
  console.log('BTC Daily Prices:', data?.btcDailyPrices);

  const prices = await getVerifiedPrices(['BTC']);
  console.log('BTC Price Array:', prices);
  process.exit(0);
}
main();
