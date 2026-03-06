// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function main() {
    const doc = await db.collection('arena_config').doc(userId).get();
    const arena = doc.data() as any;

    console.log('Current pools state:');
    arena.pools.forEach((p: any) => console.log(`  - ${p.poolId}: ${p.tokens.join(', ')}`));

    const swaps = {
        'XRP': 'ICP',
        'BNB': 'RENDER',
        'AVAX': 'SHIB',
        'SOL': 'FLOKI'
    };

    arena.pools.forEach((pool: any) => {
        pool.tokens = pool.tokens.map((t: string) => {
            const up = t.toUpperCase();
            if (swaps[up as keyof typeof swaps]) {
                console.log(`Replacing ${t} with ${swaps[up as keyof typeof swaps]} in ${pool.poolId}`);
                return swaps[up as keyof typeof swaps];
            }
            return t;
        });
    });

    await db.collection('arena_config').doc(userId).set(arena);
    console.log('\nFinal pools state:');
    arena.pools.forEach((p: any) => console.log(`  - ${p.poolId}: ${p.tokens.join(', ')}`));
}

main().catch(console.error);
