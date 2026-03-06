const admin = require('firebase-admin');

// No service account provided, but the admin.initializeApp() might pick up environment variables 
// or the already initialized app if this was running in the same process.
// However, since this is a separate process, I'll try to use the same logic as firebase-admin.ts

if (!admin.apps.length) {
    try {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
            : null;

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } else {
            console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not found.");
            process.exit(1);
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error);
        process.exit(1);
    }
}

const db = admin.firestore();

async function listUsers() {
    const snap = await db.collection('agent_configs').get();
    console.log(`Found ${snap.size} users`);
    snap.forEach(doc => {
        console.log(`- ${doc.id}`);
    });
}

listUsers();
