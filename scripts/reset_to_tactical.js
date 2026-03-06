(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const docRef = db.collection('agent_configs').doc(userId);

        // Fields to delete to force fall-through to profile defaults
        const fieldsToDelete = [
            'positionStopLoss', 'portfolioStopLoss', 'maxAllocationPerAsset',
            'minCashReservePct', 'aiScoreExitThreshold', 'buyScoreThreshold',
            'scalingScoreThreshold', 'minMarketCap', 'minOrderAmount',
            'antiWashHours', 'reentryPenalty'
        ];

        let updateData = { riskProfile: 'TACTICAL' };
        fieldsToDelete.forEach(f => {
            updateData[f] = admin.firestore.FieldValue.delete();
        });

        console.log(`--- RESETTING PROFILE TO TACTICAL ---`);
        await docRef.update(updateData);
        console.log('\n✅ Profile reset. UI should now show TACTICAL instead of CUSTOM.');

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
