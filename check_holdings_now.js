require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function check() {
    const snap = await db.collection('virtual_portfolio').get();
    snap.docs.forEach(doc => {
        const d = doc.data();
        const holdings = d.holdings || {};
        const tickers = Object.keys(holdings);
        console.log(`\n=== VP: ${doc.id} ===`);
        console.log(`Cash: $${(d.cashBalance || 0).toFixed(2)}`);
        console.log(`Total Value (DB): $${(d.totalValue || 0).toFixed(2)}`);
        console.log(`Holdings (${tickers.length}):`);
        tickers.forEach(t => {
            const h = holdings[t];
            console.log(`  ${t}: ${h.amount?.toFixed(6)} units @ avg $${h.averagePrice?.toFixed(4)}`);
        });
    });
}
check().catch(e => { console.error(e); process.exit(1); });
