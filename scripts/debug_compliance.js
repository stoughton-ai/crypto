(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        // We need to import the real function from actions, but we can't easily in a standalone script.
        // So we'll simulate the logic or see what's in constants.
        const { PROFILE_DEFAULTS } = require('../src/lib/constants');

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const targetProfile = 'TACTICAL';
        const defaults = PROFILE_DEFAULTS[targetProfile];

        console.log('--- Tactical Defaults from constants.ts ---');
        console.log(JSON.stringify(defaults, null, 2));

        const configSnap = await db.collection('agent_configs').doc(userId).get();
        const currentData = configSnap.data();

        console.log('--- Current Data in Firestore ---');
        console.log('portfolioStopLoss:', currentData.portfolioStopLoss);
        console.log('maxAllocationPerAsset:', currentData.maxAllocationPerAsset);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
