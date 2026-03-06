import { RevolutX } from './src/lib/revolut';
import { adminDb } from './src/lib/firebase-admin';

async function test() {
    const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const config = d.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);

    try {
        const orderBook = await client.request('GET', '/api/1.0/order-book/HNT-USD');
        console.log("Revolut Order Book HNT-USD BIDS:", orderBook.data.bids.slice(0, 3));
        console.log("Revolut Order Book HNT-USD ASKS:", orderBook.data.asks.slice(0, 3));
    } catch (e) { console.error("Could not fetch HNT-USD order book", e.message); }

    try {
        const p = await client.request('GET', '/api/1.0/exchange/quote', { base: 'HNT', quote: 'USD', side: 'SELL', amount: '1' });
        console.log("Revolut Quote HNT->USD 1 unit:", p);
    } catch (e) { console.error("Could not fetch HNT-USD quote", e.message); }

    process.exit(0);
}
test();
