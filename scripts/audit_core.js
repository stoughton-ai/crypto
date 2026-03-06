(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const configDoc = await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const cfg = configDoc.data();

        const vpDoc = await db.collection('virtual_portfolio').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const vp = vpDoc.data();

        console.log('--- Portfolio Core Numbers ---');
        console.log('Current totalValue:  ', vp.totalValue);
        console.log('Current netDeposits: ', vp.netDeposits);
        console.log('Initial Balance:     ', vp.initialBalance);
        console.log('legacyPnlOffset:     ', cfg.legacyPnlOffset);

        const invested = (vp.initialBalance || 0) + (vp.netDeposits || 0);
        console.log('Total Invested:      ', invested);
        console.log('Calculated P/L:      ', vp.totalValue - invested);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
