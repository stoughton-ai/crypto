const { adminDb } = require('./src/lib/firebase-admin');

async function test() {
    const snaps = await adminDb.collection('virtual_trades').where('ticker', '==', 'HNT').get();
    console.log(snaps.docs.map(d => d.data()));
    process.exit(0);
}
test();
