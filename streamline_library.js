
const admin = require('firebase-admin');
// Attempt to use environmental variable or find service account
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : require('./serviceAccount.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function streamlineLibrary(userId) {
    console.log(`Streamlining library for user: ${userId}`);

    // 1. Prune Strategy Reports (Keep 10)
    const strategySnap = await db.collection('intel_reports')
        .where('userId', '==', userId)
        .where('ticker', '==', 'STRATEGY')
        .get();

    console.log(`Found ${strategySnap.size} strategy reports.`);
    if (strategySnap.size > 10) {
        const docs = strategySnap.docs.map(d => ({ id: d.id, t: new Date(d.data().savedAt || 0).getTime() }));
        docs.sort((a, b) => a.t - b.t);
        const excess = strategySnap.size - 10;
        const toDelete = docs.slice(0, excess);

        const batch = db.batch();
        toDelete.forEach(d => batch.delete(db.collection('intel_reports').doc(d.id)));
        await batch.commit();
        console.log(`Deleted ${excess} old strategy reports.`);
    }

    // 2. enforce 500 limit for all reports
    const allSnap = await db.collection('intel_reports')
        .where('userId', '==', userId)
        .get();

    console.log(`Total reports: ${allSnap.size}`);
    const limit = 500;
    if (allSnap.size > limit) {
        const docs = allSnap.docs.map(d => ({ id: d.id, t: (d.data().createdAt?.toDate ? d.data().createdAt.toDate().getTime() : new Date(d.data().savedAt || 0).getTime()) }));
        docs.sort((a, b) => a.t - b.t);
        const excess = allSnap.size - limit;
        const toDelete = docs.slice(0, excess);

        console.log(`Pruning ${excess} oldest reports...`);
        // Batch in 400s
        for (let i = 0; i < toDelete.length; i += 400) {
            const batch = db.batch();
            const chunk = toDelete.slice(i, i + 400);
            chunk.forEach(d => batch.delete(db.collection('intel_reports').doc(d.id)));
            await batch.commit();
        }
        console.log(`Pruning complete.`);
    }
}

// Get user ID from command line or hardcoded if needed
const userId = process.argv[2];
if (!userId) {
    console.error("Please provide a userId.");
    process.exit(1);
}

streamlineLibrary(userId).catch(console.error);
