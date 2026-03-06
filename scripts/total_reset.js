(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

        console.log(`--- TOTAL RESET FOR USER: ${userId} ---`);

        // 1. Get current portfolio value to set as the new baseline
        const vpRef = db.collection('virtual_portfolio').doc(userId);
        const vpSnap = await vpRef.get();
        const currentTotal = vpSnap.data().totalValue || 643.64;

        console.log(`Current Portfolio Value: \$${currentTotal.toFixed(2)}`);
        console.log('Resetting Baseline...');

        // 2. Clear collections (batch delete)
        const collectionsToClear = [
            'virtual_portfolio_history',
            'portfolio_history',
            'virtual_trades',
            'virtual_decisions'
        ];

        for (const collName of collectionsToClear) {
            const snap = await db.collection(collName).where('userId', '==', userId).get();
            if (snap.size > 0) {
                console.log(`Deleting ${snap.size} entries from ${collName}...`);
                const batch = db.batch();
                snap.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            } else {
                console.log(`Collection ${collName} is already empty for this user.`);
            }
        }

        // 3. Reset Agent Configuration (Chronicles & Cycles)
        console.log('Clearing Neural Chronicles & Cycle Logs...');
        await db.collection('agent_configs').doc(userId).update({
            reflectionHistory: [],
            dailyReflection: null,
            cycle_logs: [],
            // Clear legacy offsets if they exist
            legacyPnlOffset: 0
        });

        // 4. Reset Portfolio Baseline
        console.log(`Resetting initialBalance to \$${currentTotal.toFixed(2)} and netDeposits to 0...`);
        await vpRef.update({
            initialBalance: currentTotal,
            netDeposits: 0,
            lastUpdated: new Date().toISOString()
        });

        console.log('\n🚀 ALL DATA RESET. New performance period starts NOW.');
        process.exit(0);
    } catch (e) {
        console.error('Error during reset:', e.message);
        process.exit(1);
    }
})();
