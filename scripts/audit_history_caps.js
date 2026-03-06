(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const histSnap = await db.collection('portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(100)
            .get();

        let docs = [];
        histSnap.forEach(doc => docs.push(doc.data()));

        docs.sort((a, b) => {
            const da = a.createdAt ? (a.createdAt._seconds || 0) : 0;
            const db = b.createdAt ? (b.createdAt._seconds || 0) : 0;
            return db - da; // Descending
        });

        console.log('--- History Audit (Capitals) ---');
        docs.slice(0, 50).forEach(hd => {
            console.log(`${hd.date || 'no date'} | Total: \$${hd.totalValue?.toFixed(2)} | Init: \$${hd.initialBalance?.toFixed(2)} | NetDep: \$${hd.netDeposits?.toFixed(2)}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
