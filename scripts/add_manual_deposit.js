(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const vpRef = db.collection('virtual_portfolio').doc(userId);

        const snap = await vpRef.get();
        const currentNetDeposits = snap.data().netDeposits || 0;
        const DEPOSIT_AMOUNT = 128.10;
        const NEW_TOTAL = currentNetDeposits + DEPOSIT_AMOUNT;

        console.log(`Current netDeposits: $${currentNetDeposits.toFixed(2)}`);
        console.log(`Adding Deposit:      $${DEPOSIT_AMOUNT.toFixed(2)}`);
        console.log(`New netDeposits:     $${NEW_TOTAL.toFixed(2)}`);

        await vpRef.update({ netDeposits: NEW_TOTAL });

        // Also add a record to virtual_decisions so the history is clear
        await db.collection('virtual_decisions').add({
            userId,
            action: 'DEPOSIT',
            amount: DEPOSIT_AMOUNT,
            reason: 'Manual User Deposit',
            date: new Date().toISOString()
        });

        console.log('\n✅ Deposit recorded.');
        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
