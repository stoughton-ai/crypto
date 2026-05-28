/**
 * Manual Revolut sync — triggers the balance sync immediately.
 * Run: npx tsx scripts/sync_revolut_now.ts
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

const USER_ID = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

function fmt(n: number) { return '$' + n.toFixed(2); }

async function main() {
    console.log('\n═══ MANUAL REVOLUT SYNC ═══\n');

    // Load arena config
    const arenaSnap = await db.collection('arena_config').doc(USER_ID).get();
    const arena = arenaSnap.data() as any;

    // Clear lastRevolutSyncAt so the sync fires immediately
    arena.lastRevolutSyncAt = null;

    // Show before state
    console.log('BEFORE:');
    let totalBefore = 0;
    for (const pool of arena.pools) {
        console.log(`  ${pool.emoji} ${pool.name}: ${fmt(pool.cashBalance)}`);
        totalBefore += pool.cashBalance;
    }
    console.log(`  TOTAL: ${fmt(totalBefore)}\n`);

    // Load Revolut credentials
    const configDoc = await db.collection('agent_configs').doc(USER_ID).get();
    const config = configDoc.data()!;

    const { RevolutX } = await import('../src/lib/revolut');
    const client = new RevolutX(
        config.revolutApiKey, config.revolutPrivateKey,
        config.revolutIsSandbox || false, config.revolutProxyUrl,
    );

    // Get live Revolut balance
    const balances = await client.getBalances();
    const usdEntry = (balances as any[]).find(
        (b: any) => (b.currency || b.symbol || '').toUpperCase() === 'USD',
    );
    const revolutUsd = parseFloat((usdEntry?.available ?? usdEntry?.balance ?? 0).toString());
    console.log(`REVOLUT USD: ${fmt(revolutUsd)}\n`);

    // Calculate drift
    const drift = revolutUsd - totalBefore;
    console.log(`DRIFT: ${fmt(drift)} ${Math.abs(drift) < 0.50 ? '(negligible)' : '⚠️'}\n`);

    // Apply proportional correction
    if (totalBefore > 0.01) {
        for (const pool of arena.pools) {
            const ratio = pool.cashBalance / totalBefore;
            const newCash = Math.max(0, revolutUsd * ratio);
            console.log(`  ${pool.emoji} ${pool.name}: ${fmt(pool.cashBalance)} → ${fmt(newCash)} (${(ratio * 100).toFixed(1)}%)`);
            pool.cashBalance = newCash;
        }
    } else {
        const perPool = revolutUsd / arena.pools.length;
        for (const pool of arena.pools) {
            pool.cashBalance = Math.max(0, perPool);
            console.log(`  ${pool.emoji} ${pool.name}: → ${fmt(perPool)} (equal split)`);
        }
    }

    arena.lastRevolutSyncAt = new Date().toISOString();

    // Save
    await db.collection('arena_config').doc(USER_ID).set(arena);

    const totalAfter = arena.pools.reduce((s: number, p: any) => s + p.cashBalance, 0);
    console.log(`\nAFTER:`);
    console.log(`  TOTAL: ${fmt(totalAfter)}`);
    console.log(`  REVOLUT: ${fmt(revolutUsd)}`);
    console.log(`  MATCH: ${Math.abs(totalAfter - revolutUsd) < 0.01 ? '✅ EXACT' : '⚠️ ' + fmt(totalAfter - revolutUsd)}`);
    console.log('\n✅ Sync complete.\n');

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
