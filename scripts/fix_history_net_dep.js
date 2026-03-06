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

        // Current netDeposits is 497.09
        // We want history to reflect capital at that time.
        // If we just added 128.10 moments ago, then entries BEFORE that should be around 368.99.
        // Entries before the big 409.71 correction should be adjusted too.

        const depositTime = new Date('2026-03-01T12:59:00Z'); // Roughly when I added 128.10
        const correctionTime = new Date('2026-03-01T12:55:00Z'); // Roughly when I did the big correction

        histSnap.forEach(doc => {
            const data = doc.data();
            const ts = new Date(data.timestamp || data.date);

            if (ts >= dayAgo) {
                let targetNetDep = data.netDeposits || 0;

                // If it's a "bad" value (around -40), fix it.
                if (targetNetDep < 0 && targetNetDep > -50) {
                    // This was the corrupted state. 
                    // We should add the 409.71 correction.
                    targetNetDep += 409.71;
                }

                // If it was recorded before my 128.10 deposit, it stays at the corrected base.
                // If it's very recent, it might already have it.

                console.log(`Updating ${ts.toISOString()} | Old NetDep: ${data.netDeposits} -> New: ${targetNetDep}`);
                batch.update(doc.ref, { netDeposits: targetNetDep });
                count++;
            }
        });

        if (count > 0) {
            await batch.commit();
            console.log(`\n✅ Updated ${count} history entries.`);
        } else {
            console.log('No entries to update.');
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
