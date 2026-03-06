(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
        const data = vpDoc.data();

        console.log('--- Portfolio Balance ---');
        console.log(`Cash Balance: \$${data.cashBalance?.toFixed(2)}`);
        console.log(`Total Value:  \$${data.totalValue?.toFixed(2)}`);

        const holdings = data.holdings || {};
        const held = Object.keys(holdings).filter(t => holdings[t].amount > 0);

        console.log('\n--- Holdings ---');
        held.forEach(t => {
            console.log(`${t}: ${holdings[t].amount} (Avg Price: \$${holdings[t].averagePrice})`);
        });

        const cashPct = (data.cashBalance / data.totalValue) * 100;
        console.log(`\nCash %: ${cashPct.toFixed(2)}%`);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
