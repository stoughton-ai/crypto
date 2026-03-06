(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const vpRef = db.collection('virtual_portfolio').doc(userId);

        // Target calculation based on audit:
        // Realized P&L: -333.29
        // Unrealized: ~0
        // Current Value: 643.68
        // Required Invested: 643.68 - (-333.29) = 976.97
        // Initial Balance: 607.98
        // New Net Deposits: 976.97 - 607.98 = 368.99

        const NEW_NET_DEPOSITS = 368.99;

        console.log('--- RECONCILIATION ---');
        console.log(`User: ${userId}`);
        console.log(`Setting netDeposits to: $${NEW_NET_DEPOSITS}`);

        await vpRef.update({ netDeposits: NEW_NET_DEPOSITS });
        console.log('\n✅ Ledger reconciled. Dashboard P&L should now match trade history.');

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
