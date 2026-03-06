(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const doc = await db.collection('virtual_portfolio').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const d = doc.data();

        console.log('--- Current Holdings Detail ---');
        console.log('Cash Balance: $', d.cashBalance?.toFixed(2));

        const holdings = d.holdings || {};
        let totalHoldingsValue = 0;
        for (const [ticker, h] of Object.entries(holdings)) {
            const val = h.amount * h.averagePrice;
            console.log(`${ticker}: ${h.amount.toFixed(6)} @ $${h.averagePrice.toFixed(6)} = $${val.toFixed(2)}`);
            totalHoldingsValue += val;
        }

        console.log('\nTotal Assets Value: $', totalHoldingsValue.toFixed(2));
        console.log('Total Portfolio:    $', (d.cashBalance + totalHoldingsValue).toFixed(2));
        console.log('Reported Total:     $', d.totalValue.toFixed(2));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
