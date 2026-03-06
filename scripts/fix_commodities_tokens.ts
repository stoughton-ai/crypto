/**
 * fix_commodities_tokens.ts
 * Strips description text from token names in the Commodities arena pools.
 * e.g. "HG COPPER" → "HG", "CL CRUDE OIL" → "CL"
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const ref = adminDb.collection('arena_config_commodities').doc(userId);
    const snap = await ref.get();
    if (!snap.exists) { console.error('No commodities config'); process.exit(1); }

    const arena = snap.data() as any;
    let changed = 0;

    const updatedPools = arena.pools.map((pool: any) => {
        const cleanTokens = (pool.tokens || []).map((t: string) => {
            const clean = t.trim().split(/\s+/)[0].toUpperCase();
            if (clean !== t) { console.log(`  ${pool.poolId}: "${t}" → "${clean}"`); changed++; }
            return clean;
        });
        return { ...pool, tokens: cleanTokens };
    });

    if (changed === 0) {
        console.log('All tokens already clean — no changes needed.');
        process.exit(0);
    }

    await ref.update({ pools: updatedPools });
    console.log(`\n✅ Fixed ${changed} token(s) in Firestore.`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
