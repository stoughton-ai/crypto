(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const today = new Date().toISOString().split('T')[0];
        const decsSnap = await db.collection('virtual_decisions')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(500)
            .get();

        let todayDecs = [];
        decsSnap.forEach(d => {
            const data = d.data();
            if (data.date && data.date.startsWith(today)) {
                todayDecs.push(data);
            }
        });

        todayDecs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        console.log('--- Decisions Today ---');
        todayDecs.forEach(d => {
            console.log(`${d.date} | ${d.action} ${d.ticker || ''} | ${d.reason?.substring(0, 100)}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
