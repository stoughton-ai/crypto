import { adminDb } from './src/lib/firebase-admin';
import { executePoolBuy, getArenaConfig } from './src/services/arenaService';
import { refreshArenaPrices } from './src/app/actions';

(async () => {
  const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
  const arena = await getArenaConfig(userId, 'CRYPTO');
  
  if (!arena) return;

  // 1. Wipe holdings and restore cash
  const pool1 = arena.pools.find(p => p.poolId === 'POOL_1');
  const pool2 = arena.pools.find(p => p.poolId === 'POOL_2');
  
  pool1.holdings = {};
  pool2.holdings = {};
  arena.sharedCash = 1050; // reset to pristine state

  // 2. Delete the two fake trades
  const tradesSnap = await adminDb.collection('arena_trades').where('userId', '==', userId).get();
  const batch = adminDb.batch();
  tradesSnap.docs.forEach(d => {
    if (d.data().reason.includes('USER OVERRIDE: Forced virtual test execution')) {
      batch.delete(d.ref);
    }
  });
  await batch.commit();

  // 3. Get REAL prices
  const prices = await refreshArenaPrices(userId, 'CRYPTO');
  const xrpPrice = prices['XRP']?.price;
  const aavePrice = prices['AAVE']?.price;

  if (!xrpPrice || !aavePrice) {
    console.error('Failed to get real prices');
    return;
  }

  // 4. Execute buys with REAL prices
  const mctx = { btcPrice: prices['BTC']?.price || 65000, btcChange24h: 0, tokenChange24h: 0, fearGreedIndex: 50 };

  pool1.cashBalance = 100;
  pool2.cashBalance = 100;

  const res1 = await executePoolBuy(userId, pool1, 'XRP', 100 / xrpPrice, xrpPrice, 'USER OVERRIDE: Initial Position ($100).', mctx, 'Manually forced by user to seed initial portfolio tracking.', 'CRYPTO', true);
  const res2 = await executePoolBuy(userId, pool2, 'AAVE', 100 / aavePrice, aavePrice, 'USER OVERRIDE: Initial Position ($100).', mctx, 'Manually forced by user to seed initial portfolio tracking.', 'CRYPTO', true);

  // 5. Reconcile
  arena.sharedCash -= 200;
  pool1.cashBalance = 0;
  pool2.cashBalance = 0;

  await adminDb.collection('arena_config').doc(userId).set(arena);

  if (res1.trade) await adminDb.collection('arena_trades').doc(res1.trade.id || res1.trade.date).set(res1.trade);
  if (res2.trade) await adminDb.collection('arena_trades').doc(res2.trade.id || res2.trade.date).set(res2.trade);

  console.log(`Executed XRP at $${xrpPrice}, AAVE at $${aavePrice}`);
})();
