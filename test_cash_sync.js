const { syncRevolutHoldings } = require('./src/app/actions');
const { adminDb } = require('./src/lib/firebase-admin');

async function test() {
  await syncRevolutHoldings('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
  const vpSnap = await adminDb.collection('virtual_portfolio').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  console.log('Cash Balance:', vpSnap.data().cashBalance);
  process.exit(0);
}
test();
