(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const doc = await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const data = doc.data();

        console.log('--- Cycle Logs Audit ---');
        if (!data.cycle_logs || data.cycle_logs.length === 0) {
            console.log('No cycle logs found.');
        } else {
            data.cycle_logs.forEach((log, i) => {
                console.log(`${log.timestamp} | InitBal: ${log.execution?.initialBalance} | TotVal: ${log.execution?.newTotalValue}`);
            });
        }

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
