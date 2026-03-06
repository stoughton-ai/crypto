const { RevolutX } = require('./src/lib/revolut');
const { adminDb } = require('./src/lib/firebase-admin');

async function test() {
  const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  const config = d.data();
  const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);
  const accounts = await client.getBalances();
  console.log(JSON.stringify(accounts.filter(a => a.currency === 'FIAT' || a.currency === 'USD' || (a.currency && a.currency.includes('USD'))), null, 2));
  process.exit(0);
}
test();
