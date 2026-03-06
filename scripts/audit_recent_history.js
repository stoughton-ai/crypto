(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const histSnap = await db.collection('portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(1000)
            .get();

        let docs = [];
        histSnap.forEach(doc => {
            const data = doc.data();
            const ts = new Date(data.timestamp);
            if (ts >= dayAgo) {
                docs.push({ id: doc.id, ...data, time: ts });
            }
        });

        console.log(`Found ${docs.length} entries in memory for last 24h.`);

        docs.sort((a, b) => a.time.getTime() - b.time.getTime());

        docs.forEach(hd => {
            console.log(`${hd.timestamp} | Total: \$${hd.totalValue?.toFixed(2)} | NetDep: \$${hd.netDeposits}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
