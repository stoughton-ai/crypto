// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    console.log('=== Executing Immediate Token Swap ===\n');

    const doc = await db.collection('arena_config').doc(userId).get();
    if (!doc.exists) {
        console.error('❌ User config not found');
        process.exit(1);
    }

    const arena = doc.data() as any;

    // Map of EXACT current tokens to their replacements
    const swapMap: Record<string, string> = {
        'ICP': 'XRP',
        'RENDER': 'BNB',
        'SHIB': 'AVAX',
        'FLOKI': 'SOL'
    };

    let swappedCount = 0;

    arena.pools.forEach((pool: any) => {
        const pre = [...pool.tokens];
        pool.tokens = pool.tokens.map((t: string) => {
            const up = t.toUpperCase();
            if (swapMap[up]) {
                swappedCount++;
                console.log(`✅ Swapping ${t} -> ${swapMap[up]} in ${pool.poolId}`);
                return swapMap[up];
            }
            return t;
        });
    });

    if (swappedCount === 0) {
        console.log('⚠️ No tokens matched the swap criteria. Current tokens:');
        arena.pools.forEach((p: any) => console.log(`  - ${p.poolId}: ${p.tokens.join(', ')}`));
    } else {
        await db.collection('arena_config').doc(userId).set(arena);
        console.log(`\n🎉 Success! Swapped ${swappedCount} tokens.`);
    }
}

main().catch(console.error);
