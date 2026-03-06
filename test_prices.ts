import { getVerifiedPrices } from './src/app/actions';
import { RevolutX } from './src/lib/revolut';
import { adminDb } from './src/lib/firebase-admin';

async function test() {
    const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const config = d.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);

    // Get external price
    const prices = await getVerifiedPrices(['HNT']);
    console.log("External Price:", prices);

    // Get Resolut ticker prices directly
    try {
        const orderBook = await client.request('GET', '/api/1.0/order-book/HNT-USD');
        console.log("Revolut Order Book HNT-USD:", orderBook);
    } catch (e) { console.error("Could not fetch HNT-USD order book", e.message); }

    process.exit(0);
}
test();
