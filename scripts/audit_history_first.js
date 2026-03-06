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
        histSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            docs.push(data);
        });

        docs.sort((a, b) => {
            const da = a.createdAt ? (a.createdAt._seconds || 0) : 0;
            const db = b.createdAt ? (b.createdAt._seconds || 0) : 0;
            return da - db; // Ascending
        });

        console.log('--- First 20 Portfolio History Entries ---');
        docs.slice(0, 20).forEach(hd => {
            console.log(`${hd.date || 'no date'} | Total: $${hd.totalValue?.toFixed(2)} | NetDep: $${hd.netDeposits?.toFixed(2)} | Cash: $${hd.cashBalance?.toFixed(2)}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
