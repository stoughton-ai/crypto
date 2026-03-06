import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Get current arena state
    const arenaDoc = await adminDb.collection('arena_config').doc(userId).get();
    const arena = arenaDoc.data();
    if (!arena) { console.error('No arena found'); process.exit(1); }

    // Find POOL_4 (Agile Arbitrageurs — SHIB/FLOKI)
    const pool4 = arena.pools.find((p: any) => p.poolId === 'POOL_4');
    if (!pool4) { console.error('POOL_4 not found'); process.exit(1); }

    console.log('Current POOL_4 state:');
    console.log('  Cash:', pool4.cashBalance);
    console.log('  Holdings:', JSON.stringify(pool4.holdings, null, 2));
    console.log('  Trades:', pool4.performance.totalTrades);
    console.log('  Wins:', pool4.performance.winCount, 'Losses:', pool4.performance.lossCount);

    // The arena sold SHIB but Revolut didn't — we need to undo the arena sell.
    // The SHIB was bought for $56.25, then "sold" for $56.35 in the arena but NOT on Revolut.
    // So we need to put the SHIB holdings back and reduce cash by the sell amount.

    if (!pool4.holdings['SHIB']) {
        console.log('\n  SHIB is not in holdings — the sell was recorded. Reverting...');

        // Restore SHIB holding (original buy: 10065020.688545 @ $0.000005589)
        pool4.holdings['SHIB'] = {
            amount: 10065020.688545,
            averagePrice: 0.000005589,
            peakPrice: 0.0000056,
            boughtAt: '2026-03-04T10:11:32Z',
        };

        // Reduce cash (undo the sell credit of ~$56.35)
        pool4.cashBalance = pool4.cashBalance - 56.35;

        // Undo the win count from the fake sell
        pool4.performance.winCount = Math.max(0, pool4.performance.winCount - 1);
        pool4.performance.totalTrades = Math.max(0, pool4.performance.totalTrades - 1);

        console.log('  Restored SHIB holding');
        console.log('  New cash:', pool4.cashBalance);
    } else {
        console.log('\n  SHIB is still in holdings — no fix needed.');
    }

    // Save
    const poolIdx = arena.pools.findIndex((p: any) => p.poolId === 'POOL_4');
    arena.pools[poolIdx] = pool4;
    await adminDb.collection('arena_config').doc(userId).set(arena);

    console.log('\n✅ Arena state fixed. POOL_4 now matches Revolut.');
    process.exit(0);
}
go().catch(e => { console.error(e); process.exit(1); });
