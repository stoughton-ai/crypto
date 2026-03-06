(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const doc = await db.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        if (!doc.exists) { console.error('No agent_config found'); process.exit(1); }
        const data = doc.data();

        console.log('--- Agent Config Meta ---');
        console.log('Risk Profile:    ', data.riskProfile);
        console.log('Automation:      ', data.automationEnabled);
        console.log('Last Snapshot:   ', data.lastSnapshotTime);
        console.log('Keys:            ', Object.keys(data).sort().join(', '));

        if (data.cycle_logs && data.cycle_logs.length > 0) {
            console.log('\n--- Latest Cycle Log ---');
            const latest = data.cycle_logs[0];
            console.log('Time:        ', latest.timestamp);
            console.log('Net Deposits:', latest.execution?.netDeposits);
            console.log('Total Value: ', latest.execution?.newTotalValue);
            console.log('Initial Bal: ', latest.execution?.initialBalance);
            console.log('Trades:      ', latest.execution?.trades?.length || 0);
        } else {
            console.log('\nNo cycle logs found.');
        }

        const vpDoc = await db.collection('virtual_portfolio').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
        const vp = vpDoc.data();
        console.log('\n--- Virtual Portfolio Current ---');
        console.log('Initial Bal: ', vp.initialBalance);
        console.log('Net Deposits:', vp.netDeposits);
        console.log('Total Value: ', vp.totalValue);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
