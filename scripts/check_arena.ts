import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function check() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) return;
    const snap = await adminDb.collection('arena').get();
    console.log(`Found ${snap.size} arena documents.`);
    snap.forEach(doc => {
        const data = doc.data();
        console.log(`User: ${doc.id}, initialized: ${data.initialized}`);
    });
}
check();
