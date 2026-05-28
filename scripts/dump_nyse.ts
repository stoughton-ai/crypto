import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';
import * as fs from 'fs';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const snap = await db.collection('arena_config_nyse').get();
    if (!snap.empty) {
        fs.writeFileSync('/tmp/nyse_dump.json', JSON.stringify(snap.docs[0].data(), null, 2));
        console.log("Dumped to /tmp/nyse_dump.json");
    }
}
main().catch(console.error).finally(() => process.exit(0));
