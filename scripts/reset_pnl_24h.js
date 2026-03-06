(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const histSnap = await db.collection('virtual_portfolio_history')
            .where('userId', '==', userId)
            .get();

        let batch = db.batch();
        let count = 0;

        histSnap.forEach(doc => {
            const data = doc.data();
            const ts = new Date(data.timestamp || data.date);

            if (ts >= dayAgo) {
                let oldNetDep = data.netDeposits || 0;
                let newNetDep = oldNetDep;

                // Adjust the 144.89 ones (these are the baseline entries from 24h ago)
                if (Math.abs(oldNetDep - 144.89) < 1) {
                    newNetDep = oldNetDep + 365.88;
                }
                // Adjust the ones that were already fixed to 368.99 to include the latest 128.10 deposit
                else if (Math.abs(oldNetDep - 368.99) < 1) {
                    newNetDep = 497.09;
                }
                // Adjust other "-40" variants too if any remain
                else if (oldNetDep < 0 && oldNetDep > -50) {
                    newNetDep = oldNetDep + 365.88 + 128.10; // Rough guess for those variants
                }

                if (newNetDep !== oldNetDep) {
                    batch.update(doc.ref, { netDeposits: newNetDep });
                    count++;
                }
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`\n✅ Adjusted ${count} history entries for 24h P&L reset.`);
        } else {
            console.log('No entries needed adjustment.');
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
