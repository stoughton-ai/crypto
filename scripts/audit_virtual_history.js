(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const histSnap = await db.collection('virtual_portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .get();

        let docs = [];
        histSnap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));

        docs.sort((a, b) => {
            const ta = a.timestamp || a.date || 0;
            const tb = b.timestamp || b.date || 0;
            return new Date(tb).getTime() - new Date(ta).getTime(); // Descending
        });

        console.log('--- Latest 20 Virtual Portfolio History Entries ---');
        docs.slice(0, 20).forEach(hd => {
            console.log(`${hd.timestamp || hd.date || 'no-date'} | Total: \$${hd.totalValue?.toFixed(2)} | NetDep: ${hd.netDeposits}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
