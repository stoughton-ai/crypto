(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const histSnap = await db.collection('portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(500)
            .get();

        console.log('--- Search for non-null netDeposits in History ---');
        let count = 0;
        histSnap.forEach(doc => {
            const data = doc.data();
            if (data.netDeposits !== undefined && data.netDeposits !== null) {
                console.log(`${data.date} | NetDep: ${data.netDeposits} | Total: ${data.totalValue}`);
                count++;
            }
        });

        console.log('Found:', count);
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
