(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const now = new Date();
        const targetTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const histSnap = await db.collection('virtual_portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .get();

        let docs = [];
        histSnap.forEach(doc => {
            const data = doc.data();
            const ts = new Date(data.timestamp || data.date);
            docs.push({ id: doc.id, ...data, time: ts });
        });

        docs.sort((a, b) => a.time.getTime() - b.time.getTime());

        // Find the entry closest to 24h ago
        let baseline = null;
        let minDiff = Infinity;
        docs.forEach(d => {
            const diff = Math.abs(d.time.getTime() - targetTime.getTime());
            if (diff < minDiff) {
                minDiff = diff;
                baseline = d;
            }
        });

        if (baseline) {
            console.log('--- Baseline (24h ago) ---');
            console.log(`ID: ${baseline.id}`);
            console.log(`Timestamp: ${baseline.timestamp || baseline.date}`);
            console.log(`Total: ${baseline.totalValue}`);
            console.log(`NetDep: ${baseline.netDeposits}`);
            console.log(`Diff: ${Math.round(minDiff / 1000 / 60)} mins from target`);
        } else {
            console.log('No baseline found.');
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
