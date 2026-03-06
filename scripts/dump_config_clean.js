(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const doc = await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        let data = doc.data();
        delete data.cycle_logs;

        console.log('--- Clean Agent Config ---');
        console.log(JSON.stringify(data, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
