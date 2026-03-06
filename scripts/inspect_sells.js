(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const tradesSnap = await db.collection('virtual_trades')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .where('type', '==', 'SELL')
            .limit(5)
            .get();

        tradesSnap.forEach(doc => {
            console.log('Trade ID:', doc.id);
            console.log('Data:', JSON.stringify(doc.data(), null, 2));
            console.log('------------------');
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
