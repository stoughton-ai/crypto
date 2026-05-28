import { adminDb } from './src/lib/firebase-admin';
import { executePoolBuy } from './src/services/arenaService';
import { getArenaConfig } from './src/app/actions';

(async () => {
  const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
  const arena = await getArenaConfig(userId, 'CRYPTO');
  if (!arena) {
    console.error('Arena not found');
    return;
  }

  // Find pools
  const pool1 = arena.pools.find(p => p.poolId === 'POOL_1');
  const pool2 = arena.pools.find(p => p.poolId === 'POOL_2');

  // Hardcoded prices (will use for exact dollar amount conversion)
  const xrpPrice = 0.5132;
  const aavePrice = 104.50;

  const mctx = { btcPrice: 65000, btcChange24h: 0, tokenChange24h: 0, fearGreedIndex: 50 };

  console.log('Forcing $100 XRP buy...');
  const res1 = await executePoolBuy(
    userId, pool1, 'XRP', 100 / xrpPrice, xrpPrice,
    'USER OVERRIDE: Forced virtual test execution ($100).',
    mctx, 'Manually forced by user to verify dashboard functionality.', 'CRYPTO', true
  );
  console.log('XRP Trade:', res1.success, res1.error);

  console.log('Forcing $100 AAVE buy...');
  const res2 = await executePoolBuy(
    userId, pool2, 'AAVE', 100 / aavePrice, aavePrice,
    'USER OVERRIDE: Forced virtual test execution ($100).',
    mctx, 'Manually forced by user to verify dashboard functionality.', 'CRYPTO', true
  );
  console.log('AAVE Trade:', res2.success, res2.error);

  // Save the arena state with updated shared cash and pool holdings
  await adminDb.collection('arena_config').doc(userId).set(arena);
  console.log('Arena state saved. Total shared cash:', arena.sharedCash);

})();
