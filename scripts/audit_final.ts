import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error("No FIREBASE_SERVICE_ACCOUNT_JSON");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // Focus: Last 3 hours to see the tail end
    const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const tradesSnap = await db.collection('virtual_trades')
        .where('userId', '==', userId)
        .where('date', '>=', since)
        .orderBy('date', 'desc')
        .limit(30)
        .get();

    console.log(`\nTrades in last 3 hours: ${tradesSnap.size}\n`);
    for (const doc of tradesSnap.docs) {
        const t = doc.data();
        const time = new Date(t.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const pnl = t.pnl ? `P&L: ${t.pnl >= 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '';
        console.log(`${time} | ${t.type.padEnd(5)} | ${(t.ticker || '').padEnd(6)} | $${Number(t.amount || 0).toFixed(2)} @ $${Number(t.price || 0).toFixed(4)} ${pnl}`);
        console.log(`  └─ ${t.reason || t.exitReason || 'no reason'}`);
    }

    // Check the raw portfolio document
    const vpDoc = await db.collection('virtual_portfolio').doc(userId).get();
    const vp = vpDoc.data();
    console.log('\n=== RAW PORTFOLIO ===');
    console.log(`Cash: ${vp?.cash}`);
    console.log(`Total Value: ${vp?.totalValue}`);
    console.log(`Holdings keys: ${Object.keys(vp?.holdings || {})}`);
    console.log(JSON.stringify(vp?.holdings || {}, null, 2));

    // Check Revolut holdings
    const configDoc = await db.collection('agent_configs').doc(userId).get();
    const config = configDoc.data()!;
    const rh = config.revolutHoldings || {};
    console.log('\n=== REVOLUT HOLDINGS ===');
    for (const [ticker, data] of Object.entries(rh)) {
        const d = data as any;
        console.log(`  ${ticker}: ${d.quantity} units | Value: $${d.value || '?'} | Price: $${d.price || '?'}`);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
