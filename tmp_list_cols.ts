import { adminDb } from './src/lib/firebase-admin';

async function listCollections() {
    if (!adminDb) return;
    const collections = await adminDb.listCollections();
    console.log('Collections:', collections.map(c => c.id));
}

listCollections().then(() => process.exit(0));
