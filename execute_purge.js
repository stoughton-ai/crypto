
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Read service account from .env.local
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON='({[\s\S]*?})'/);

if (!match) {
    console.error("Could not find FIREBASE_SERVICE_ACCOUNT_JSON in .env.local");
    process.exit(1);
}

const serviceAccount = JSON.parse(match[1]);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
const userId = "SF87h3pQoxfkkFfD7zCSOXgtz5h1";

async function purge() {
    console.log(`[Script] Starting Purge for ${userId}`);
    const vpRef = db.collection('virtual_portfolio').doc(userId);
    const snap = await vpRef.get();

    if (!snap.exists) {
        console.log("Portfolio not found.");
        return;
    }

    const data = snap.data();
    const holdings = data.holdings || {};
    const tickers = Object.keys(holdings).filter(t => holdings[t].amount > 0);

    if (tickers.length === 0) {
        console.log("No holdings found. Already 100% Cash.");
        return;
    }

    console.log(`Found ${tickers.length} positions: ${tickers.join(', ')}`);

    // For the sake of this manual purge script, we won't hit Revolut API (to avoid proxy/key complexities)
    // but we will update the virtual portfolio to 100% cash.

    let newCash = data.cashBalance;
    for (const t of tickers) {
        // We'll use the last known price or average price as a fallback
        const val = holdings[t].amount * (data.lastMarketSnapshot?.[t]?.price || holdings[t].averagePrice);
        newCash += val;
        console.log(`- Purging ${t}: +$${val.toFixed(2)} cash`);
    }

    await vpRef.update({
        holdings: {},
        cashBalance: newCash,
        lastUpdated: new Date().toISOString(),
        totalValue: newCash
    });

    // Add history entry
    await db.collection('virtual_history').add({
        userId,
        totalValue: newCash,
        cashBalance: newCash,
        holdingsValue: 0,
        date: new Date().toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[Script] Purge complete. New Cash Balance: $${newCash.toFixed(2)}`);
}

purge().catch(console.error);
