import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}

async function main() {
    const { runSandboxArenaCycle } = await import('./src/app/actions');
    
    console.log("Running FTSE Arena Cycle...");
    const resFtse = await runSandboxArenaCycle('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'FTSE');
    console.log("FTSE Result:", JSON.stringify(resFtse, null, 2));

    console.log("Running COMMODITIES Arena Cycle...");
    const resCom = await runSandboxArenaCycle('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'COMMODITIES');
    console.log("COMMODITIES Result:", JSON.stringify(resCom, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
