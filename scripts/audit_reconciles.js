(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const decs = await db.collection('virtual_decisions')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(50)
            .get();

        let docs = [];
        decs.forEach(doc => docs.push(doc.data()));
        docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        console.log('--- Recent Decisions Audit (Today) ---');
        docs.forEach(d => {
            if (d.reason && (d.reason.includes('Reconcile') || d.reason.includes('DEPOSIT') || d.reason.includes('WITHDRAWAL'))) {
                console.log(`${d.date} | ${d.action} ${d.ticker || ''} | ${d.reason}`);
            }
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
