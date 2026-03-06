(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const tradesSnap = await db.collection('virtual_trades')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .limit(500)
            .get();

        const today = new Date().toISOString().split('T')[0];
        let todayTrades = [];
        tradesSnap.forEach(t => {
            const d = t.data();
            if (d.date && d.date.startsWith(today)) {
                todayTrades.push(d);
            }
        });

        todayTrades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        console.log('--- Trades Today (In-Memory Filter) ---');
        todayTrades.forEach(d => {
            console.log(`${d.date} | ${d.type} ${d.ticker} | $${d.total?.toFixed(2)} | ${d.reason?.substring(0, 40)}`);
        });

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
