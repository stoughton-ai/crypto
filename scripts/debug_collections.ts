import * as admin from 'firebase-admin';
import 'dotenv/config';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function main() {
    console.log('--- arena_config ---');
    const arena = await db.collection('arena_config').get();
    arena.forEach(d => {
        const data = d.data();
        console.log(`User: ${d.id}`);
        if (data.pools) {
            data.pools.forEach((p: any) => console.log(`  ${p.poolId}: ${p.tokens.join(', ')}`));
        }
    });

    console.log('\n--- discovery_pools ---');
    const discovery = await db.collection('discovery_pools').get();
    discovery.forEach(d => {
        const data = d.data();
        console.log(`Pool: ${d.id} (${data.name}) | User: ${data.userId}`);
        console.log(`  Tokens: ${data.tokens?.join(', ')}`);
    });
}
main().catch(console.error);
