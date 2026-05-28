import * as fs from 'fs';
const envStr = fs.readFileSync('.env.local', 'utf8');
for (const line of envStr.split('\n')) {
  if (line.startsWith('FIREBASE_SERVICE_ACCOUNT_JSON=')) {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = line.substring('FIREBASE_SERVICE_ACCOUNT_JSON='.length).replace(/\r$/, '').replace(/^'|'$/g, '');
  }
}

async function main() {
  const { adminDb } = await import('./src/lib/firebase-admin');
  const users = await adminDb!.collection('arena_config_ftse').get();

  for (const userDoc of users.docs) {
    const userId = userDoc.id;
    const arena = userDoc.data();

    // Sum all trades for this user
    const tradesSnap = await adminDb!.collection('arena_trades_ftse')
        .where('userId', '==', userId)
        .get();

    let totalBuys = 0;
    let totalSells = 0;
    const duplicateIds: string[] = [];
    
    // We only need to delete the specific 08:00 ITV and AUTO trades
    tradesSnap.docs.forEach(d => {
        const t = d.data();
        if (t.type === 'SELL' && t.ticker === 'ITV' && t.date.startsWith('2026-03-23T08:00:49')) {
            console.log(`Found duplicate ITV trade: ${d.id}`);
            duplicateIds.push(d.id);
            return; // don't count it
        }
        if (t.type === 'SELL' && t.ticker === 'AUTO' && t.date.startsWith('2026-03-23T08:00:52')) {
            console.log(`Found duplicate AUTO trade: ${d.id}`);
            duplicateIds.push(d.id);
            return; // don't count it
        }

        if (t.type === 'BUY') totalBuys += t.total;
        if (t.type === 'SELL') totalSells += t.total;
    });

    const budget = arena.totalBudget ?? 600;
    const dca = arena.sharedDcaDeployed ?? 0;
    const expectedCash = budget + dca - totalBuys + totalSells;

    console.log(`User ${userId.substring(0, 8)}`);
    console.log(`Current Cash: ${arena.sharedCash}`);
    console.log(`Corrected Expected Cash: ${expectedCash}`);

    if (duplicateIds.length > 0) {
        console.log(`Deleting ${duplicateIds.length} duplicate phantom trades and correcting cash...`);
        for (const tid of duplicateIds) {
            await adminDb!.collection('arena_trades_ftse').doc(tid).delete();
        }

        await adminDb!.collection('arena_config_ftse').doc(userId).set({
            sharedCash: expectedCash
        }, { merge: true });
        
        await adminDb!.collection('arena_config_ftse').doc(userId).collection('system_logs').add({
            timestamp: new Date().toISOString(),
            type: 'BUG_FIX',
            description: `Fixed Intelligence Scanner race condition. Deleted 2 duplicate trades and corrected sharedCash to $${expectedCash.toFixed(2)}.`
        });
        console.log("Done.");
    }
  }
}

main().catch(console.error);
