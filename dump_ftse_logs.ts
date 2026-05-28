import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  const users = await adminDb!.collection('arena_config_ftse').limit(1).get();
  if (users.empty) return;
  const userId = users.docs[0].id;

  const logsSnap = await adminDb!.collection('arena_config_ftse')
    .doc(userId)
    .collection('system_logs')
    .orderBy('timestamp', 'asc')
    .get();
    
  console.log("\nSYSTEM LOGS:");
  logsSnap.docs.forEach(d => console.log(d.data()));
}
main().catch(console.error);
