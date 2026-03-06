const { RevolutX } = require('./src/lib/revolut');
const { adminDb } = require('./src/lib/firebase-admin');

async function test() {
    const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const config = d.data();
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);

    try {
        const instruments = await client.request('GET', '/api/1.0/tickers');
        console.log("Returned Type:", typeof instruments);
        if (Array.isArray(instruments)) {
            console.log("First 3:", instruments.slice(0, 3));
        } else {
            console.log("Keys:", Object.keys(instruments).slice(0, 5));
            console.log("Values:", Object.values(instruments).slice(0, 3));
        }
    } catch (e) { console.error(e); }
    process.exit(0);
}
test();
