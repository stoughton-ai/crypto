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
            .get();

        const today = new Date().toISOString().split('T')[0];
        let sumPnl = 0;
        let count = 0;
        tradesSnap.forEach(t => {
            const d = t.data();
            if (d.date && d.date.startsWith(today)) {
                sumPnl += (d.pnl || d.pnlUsd || 0);
                count++;
            }
        });

        console.log('--- Realized P&L Today ---');
        console.log('Count:', count);
        console.log('Total P&L Today: $', sumPnl.toFixed(2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
