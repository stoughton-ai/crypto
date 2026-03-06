(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
        const doc = await db.collection('agent_configs').doc(userId).get();
        const data = doc.data();

        console.log('--- Active Watchlists ---');
        console.log('Anchor positions (Traffic Light):', (data.trafficLightTokens || []).join(', '));
        console.log('Conviction Targets (Standard):', (data.standardTokens || []).join(', '));
        console.log('Speculative Reserve (Sandbox):', (data.sandboxTokens || []).join(', '));
        console.log('Neural Discoveries (AI Watchlist):', (data.aiWatchlist || []).join(', '));

        const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
        const holdings = vpDoc.data()?.holdings || {};
        const held = Object.keys(holdings).filter(t => holdings[t].amount > 0);
        console.log('Current Holdings:', held.join(', '));

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
