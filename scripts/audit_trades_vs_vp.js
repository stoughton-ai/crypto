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

        let sumPnl = 0;
        let count = 0;
        tradesSnap.forEach(doc => {
            const d = doc.data();
            sumPnl += (d.pnlUsd || 0);
            count++;
        });

        console.log('--- Realized Trade Audit ---');
        console.log('User ID:       ', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1');
        console.log('Total Sells:   ', count);
        console.log('Total Trade P&L: $', sumPnl.toFixed(2));

        const vpDoc = await db.collection('virtual_portfolio').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const vp = vpDoc.data();

        const totalInvested = (vp.initialBalance || 0) + (vp.netDeposits || 0);
        const enginePnL = vp.totalValue - totalInvested;

        console.log('\n--- Virtual Portfolio ---');
        console.log('Total Invested: $', totalInvested.toFixed(2));
        console.log('Current Total:  $', vp.totalValue.toFixed(2));
        console.log('System Engine P&L: $', enginePnL.toFixed(2));

        console.log('\nDiscrepancy: $', (enginePnL - sumPnl).toFixed(2));
        console.log('Note: Discrepancy should represent unrealized P&L from open positions.');

        const openHoldings = Object.entries(vp.holdings || {}).length;
        console.log('\nOpen Positions: ', openHoldings);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
