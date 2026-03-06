import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';
import { RevolutX } from './src/lib/revolut';

async function run() {
    console.log("Initializing firebase-admin...");
    if (!admin.apps.length) {
        const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (!saStr) throw new Error("No env var");
        const sa = JSON.parse(saStr);
        admin.initializeApp({ credential: admin.credential.cert(sa) });
    }
    const adminDb = admin.firestore();

    console.log("Fetching config...");
    const snapshot = await adminDb.collection('agent_configs').limit(1).get();
    if (snapshot.empty) return console.log("No config");

    const config = snapshot.docs[0].data();
    if (!config.revolutApiKey) return console.log("No API key");

    console.log(`Hitting API using proxy ${config.revolutProxyUrl}...`);
    const client = new RevolutX(config.revolutApiKey, config.revolutPrivateKey, config.revolutIsSandbox, config.revolutProxyUrl);

    console.log("\nChecking proxy health...");
    try {
        const health = await client.checkHealth();
        console.log("Health Check Result:", JSON.stringify(health));

        console.log("\nGetting holdings via proxy...");
        const holdings = await client.getHoldings();
        console.log("Holdings:", JSON.stringify(holdings));

        console.log("\nPlacing mock order via proxy...");
        await client.createOrder({ symbol: 'ATOM-USD', side: 'BUY', size: '0.1', type: 'market' });
    } catch (e: any) {
        console.error("Proxy connection failed:", e.message);
    }
}

run().catch(console.error);
