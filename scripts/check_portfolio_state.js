(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });

        if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
            console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
            process.exit(1);
        }
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const snap = await db.collection('virtual_portfolio').get();
        if (snap.empty) {
            console.log('No portfolio documents found.');
        }
        snap.forEach(doc => {
            const d = doc.data();
            console.log('--- Portfolio Snapshot ---');
            console.log('Document ID:    ', doc.id);
            console.log('Cash Balance:   ', d.cashBalance);
            console.log('Net Deposits:   ', d.netDeposits);
            console.log('Initial Balance:', d.initialBalance);
            console.log('Total Portfolio Value:', d.totalValue);
            console.log('Holdings:       ', Object.keys(d.holdings || {}).length);
            const totalInvested = (d.initialBalance || 0) + (d.netDeposits || 0);
            const tradePnL = (d.totalValue || 0) - totalInvested;
            const pnlPct = totalInvested > 0 ? (tradePnL / totalInvested) * 100 : 0;
            console.log('Calculated Invested Capital:', totalInvested);
            console.log('Calculated Trade P/L:       ', tradePnL.toFixed(2));
            console.log('Calculated P/L %:           ', pnlPct.toFixed(2) + '%');
            console.log('---------------------------');
        });
        process.exit(0);
    } catch (e) {
        console.error('Error reading Firestore:', e.message);
        process.exit(1);
    }
})();
