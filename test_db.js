const { adminDb } = require('./src/lib/firebase-admin');
async function test() {
  const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  console.log(d.data());
  process.exit(0);
}
test();
