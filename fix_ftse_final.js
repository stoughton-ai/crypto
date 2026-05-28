
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env.local');
let serviceAccountStr = '';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/FIREBASE_SERVICE_ACCOUNT_JSON\s*=\s*(['"])([\s\S]*?)\1/);
    if (match) serviceAccountStr = match[2];
}
const serviceAccount = JSON.parse(serviceAccountStr);
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function fixData() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    
    // 1. Delete the duplicate trade
    const dupeId = 'x325h4imxgSHrTWI1BOI';
    console.log(`Deleting duplicate trade ${dupeId}...`);
    await db.collection('arena_trades_ftse').doc(dupeId).delete();
    
    // 2. Update config (re-calculate from ledger to be safe)
    const tradesSnap = await db.collection('arena_trades_ftse').where('userId', '==', userId).get();
    let totalBuys = 0;
    let totalSells = 0;
    const trades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const autoHoldings = { amount: 0, cost: 0 };
    const itvHoldings = { amount: 0, cost: 0 };
    // ... just calculate all holdings from ledger
    const ledgerHoldings = {};

    trades.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    trades.forEach(t => {
        if (t.type === 'BUY') {
            totalBuys += t.total;
            const h = ledgerHoldings[t.ticker] || { amount: 0, cost: 0 };
            h.amount += t.amount;
            h.cost += t.total;
            ledgerHoldings[t.ticker] = h;
        } else {
            totalSells += t.total;
            const h = ledgerHoldings[t.ticker];
            if (h) {
                const ratio = t.amount / h.amount;
                h.cost -= (h.cost * ratio); // reduce cost basis proportionally
                h.amount -= t.amount;
                if (h.amount < 0.000001) delete ledgerHoldings[t.ticker];
            }
        }
    });
    
    const budget = 600;
    const expectedCash = budget - totalBuys + totalSells;
    
    console.log(`Recalculated Cash: £${expectedCash.toFixed(2)}`);
    console.log(`Recalculated AUTO: ${ledgerHoldings['AUTO']?.amount.toFixed(4)} @ £${(ledgerHoldings['AUTO']?.cost / ledgerHoldings['AUTO']?.amount).toFixed(4)}`);
    
    // Update config
    const configRef = db.collection('arena_config_ftse').doc(userId);
    const configSnap = await configRef.get();
    const arena = configSnap.data();
    
    arena.sharedCash = expectedCash;
    arena.pools.forEach(p => {
        Object.keys(p.holdings).forEach(ticker => {
            const lh = ledgerHoldings[ticker];
            if (lh) {
                p.holdings[ticker].amount = lh.amount;
                p.holdings[ticker].averagePrice = lh.cost / lh.amount;
            } else {
                delete p.holdings[ticker];
            }
        });
        // Add back missing holdings if any
        Object.entries(ledgerHoldings).forEach(([ticker, lh]) => {
            if (p.tokens.includes(ticker) && !p.holdings[ticker]) {
                p.holdings[ticker] = {
                    amount: lh.amount,
                    averagePrice: lh.cost / lh.amount,
                    peakPrice: 0, peakPnlPct: 0
                };
            }
        });
    });
    
    await configRef.set(arena);
    console.log("✅ Fixed arena config and deleted dupe trade.");

    // Log the fix to system_logs
    await configRef.collection('system_logs').add({
        timestamp: new Date().toISOString(),
        type: 'BUG_FIX',
        description: `Forensic audit fix: Deleted 1 duplicate AUTO sell (£72.90), corrected sharedCash from £49.16 to £${expectedCash.toFixed(2)}, and restored missing AUTO holdings (0.3243 units).`
    });
}

fixData().then(() => process.exit(0));
