(async () => {
    try {
        const admin = require('firebase-admin');
        require('dotenv').config({ path: '.env.local' });
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        const db = admin.firestore();

        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

        // 1. Sum up Realized P&L from trades
        const tradesSnap = await db.collection('virtual_trades')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .where('type', '==', 'SELL')
            .get();

        let realizedPnl = 0;
        let tradeCount = 0;
        tradesSnap.forEach(t => {
            const data = t.data();
            if (data.date >= dayAgo) {
                realizedPnl += (data.pnl || data.pnlUsd || 0);
                tradeCount++;
            }
        });

        // 2. Estimate Unrealized P&L change
        // This is harder without historical prices for all assets 24h ago.
        // But we can look at the totalValue change adjusted for deposits.

        console.log('--- Trading Performance (Last 24h) ---');
        console.log(`Sell Trades: ${tradeCount}`);
        console.log(`Realized P&L: $${realizedPnl.toFixed(2)}`);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e.message);
        process.exit(1);
    }
})();
