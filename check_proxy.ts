
import * as fs from 'fs';
import * as path from 'path';

// Load Env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
    }
}

async function check() {
    const { adminDb } = await import('./src/lib/firebase-admin');
    if (!adminDb) return;

    const configSnap = await adminDb.collection('agent_configs').limit(1).get();
    if (configSnap.empty) return;
    const config = configSnap.docs[0].data();

    console.log("PROXY_URL:", config.revolutProxyUrl);
}

check().catch(console.error);
