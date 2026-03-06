const { adminDb } = require('./src/lib/firebase-admin');
async function test() {
    const vpSnap = await adminDb.collection("virtual_portfolio").doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    console.log(JSON.stringify(vpSnap.data(), null, 2));
    process.exit(0);
}
test();
