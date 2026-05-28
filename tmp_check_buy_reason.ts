import { adminDb } from './src/lib/firebase-admin';

async function find() {
    if (!adminDb) return;
    const snap = await adminDb.collection('arena_trades')
        .where('ticker', '==', 'SOL')
        .where('type', '==', 'BUY')
        .get();
    
    const today = '2026-04-08';
    snap.docs.forEach(d => {
        const data = d.data();
        if (data.date && data.date.startsWith(today)) {
            console.log('--- BUY ---');
            console.log('Date:', data.date);
            console.log('Reason:', data.reason);
            console.log('Reflection:', data.preTradeReflection);
        }
    });
}

find().then(() => process.exit(0));
