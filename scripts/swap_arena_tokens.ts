// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

// ─── TOKEN SWAP MAP ───────────────────────────────────────────────────────────
// OLD (remove) → NEW (insert)
// Based on regime evaluation: meme tokens and weak-catalyst tokens replaced with
// institutional-grade assets that have March 2026 catalysts.
const SWAP_MAP: Record<string, string> = {
    'FLOKI': 'SOL',   // Meme → High-performance L1 with Alpenglow upgrade
    'SHIB': 'AVAX',  // Meme → L1 DeFi ecosystem, less correlation to retail sentiment
    'ICP': 'XRP',   // No March catalyst → Regulatory clarity breakout candidate
    'RENDER': 'BNB',   // AI/GPU narrative dead → Exchange token with consistent burns
};

const REMOVED = Object.keys(SWAP_MAP);
const ADDED = Object.values(SWAP_MAP);

async function swapTokens() {
    console.log('=== Arena Token Swap — Patience Regime Re-alignment ===\n');
    console.log('Swaps to apply:');
    for (const [old, next] of Object.entries(SWAP_MAP)) {
        console.log(`  ❌ ${old} → ✅ ${next}`);
    }
    console.log();

    const arenaDoc = await db.collection('arena_config').doc(userId).get();
    if (!arenaDoc.exists) {
        console.error('❌ No arena_config document found for user', userId);
        process.exit(1);
    }

    const arena = arenaDoc.data() as any;
    const pools: any[] = arena.pools || [];

    if (!pools.length) {
        console.error('❌ No pools in arena_config.');
        process.exit(1);
    }

    let swapsApplied = 0;
    let holdingsPurged = 0;

    for (const pool of pools) {
        const originalTokens: string[] = [...pool.tokens];

        // ── 1. Swap tokens in the pool's token pair ────────────────────────
        pool.tokens = pool.tokens.map((t: string) => SWAP_MAP[t.toUpperCase()] || t);

        const changed = pool.tokens.some((t: string, i: number) => t !== originalTokens[i]);
        if (changed) {
            console.log(`🔄 Pool ${pool.emoji} ${pool.name} (${pool.poolId}): [${originalTokens.join(', ')}] → [${pool.tokens.join(', ')}]`);
            swapsApplied++;
        }

        // ── 2. Purge holdings for removed tokens ──────────────────────────
        const holdings: Record<string, any> = pool.holdings || {};
        for (const removedToken of REMOVED) {
            const upper = removedToken.toUpperCase();
            if (holdings[upper]) {
                const h = holdings[upper];
                const value = (h.amount || 0) * (h.averagePrice || 0);
                console.log(`  💸 Purging ${upper} holding from ${pool.poolId}: ${h.amount?.toFixed(6)} @ $${h.averagePrice?.toFixed(4)} ≈ $${value.toFixed(2)} → returned to cash`);
                pool.cashBalance = (pool.cashBalance || 0) + value;
                delete holdings[upper];
                holdingsPurged++;
            }
        }
        pool.holdings = holdings;

        // ── 3. Clear score history for removed tokens ─────────────────────
        const scoreHistory: Record<string, any> = pool.scoreHistory || {};
        for (const removedToken of REMOVED) {
            const upper = removedToken.toUpperCase();
            if (scoreHistory[upper]) {
                delete scoreHistory[upper];
                console.log(`  🧹 Cleared score history for ${upper} in ${pool.poolId}`);
            }
        }
        pool.scoreHistory = scoreHistory;

        // ── 4. Clear lastEvaluatedAt for removed tokens ───────────────────
        const lastEvaluatedAt: Record<string, any> = pool.lastEvaluatedAt || {};
        for (const removedToken of REMOVED) {
            const upper = removedToken.toUpperCase();
            if (lastEvaluatedAt[upper]) {
                delete lastEvaluatedAt[upper];
            }
        }
        pool.lastEvaluatedAt = lastEvaluatedAt;

        // ── 5. Clear lastSoldAt anti-wash records for ALL affected tokens ─
        // Also clear new tokens' lastSoldAt so anti-wash doesn't block fresh entries
        const lastSoldAt: Record<string, any> = pool.lastSoldAt || {};
        for (const t of [...REMOVED, ...ADDED]) {
            const upper = t.toUpperCase();
            if (lastSoldAt[upper]) {
                delete lastSoldAt[upper];
                console.log(`  🚿 Cleared anti-wash cooldown for ${upper} in ${pool.poolId}`);
            }
        }
        pool.lastSoldAt = lastSoldAt;

        // ── 6. Update strategy description to note the regime swap ────────
        pool.strategy.description = `[Re-aligned ${new Date().toISOString().slice(0, 10)}: ${REMOVED.filter(t => originalTokens.includes(t)).join(',')}→${originalTokens.filter(t => REMOVED.includes(t)).map(t => SWAP_MAP[t]).join(',')}] ${pool.strategy.description || ''}`.trim();
    }

    // ── 7. Mark tokens locked (still locked — just different tokens) ──────────
    arena.pools = pools;
    arena.lastTokenSwap = new Date().toISOString();
    arena.tokenSwapReason = 'Patience Regime Re-alignment: FLOKI/SHIB/ICP/RENDER replaced with SOL/AVAX/XRP/BNB — meme tokens and no-catalyst tokens removed in Extreme Fear / Bitcoin Season environment.';

    // ── 8. Write back ─────────────────────────────────────────────────────────
    await db.collection('arena_config').doc(userId).set(arena);

    console.log('\n=== Summary ===');
    console.log(`✅ Swaps applied: ${swapsApplied} pool(s) modified`);
    console.log(`💸 Holdings purged: ${holdingsPurged} position(s) liquidated to cash`);
    console.log('\nNew pool token assignments:');
    for (const pool of pools) {
        console.log(`  ${pool.emoji} ${pool.name}: ${pool.tokens.join(' + ')} | Cash: $${pool.cashBalance?.toFixed(2)}`);
    }
    console.log('\n⚠️  Note: No real Revolut sells were executed for purged holdings.');
    console.log('   If any of FLOKI/SHIB/ICP/RENDER had active positions on Revolut,');
    console.log('   those must be sold manually on the Revolut platform.');
    process.exit(0);
}

swapTokens().catch(e => { console.error('Fatal:', e); process.exit(1); });
