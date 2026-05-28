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

    tradesSnap.docs.forEach(d => {
        const t = d.data();
        if (t.type === 'BUY') totalBuys += t.total;
        if (t.type === 'SELL') totalSells += t.total;
    });

    const budget = arena.totalBudget ?? 600;
    const dca = arena.sharedDcaDeployed ?? 0;
    const expectedCash = budget + dca - totalBuys + totalSells;

    console.log(`User ${userId.substring(0, 8)}`);
    console.log(`Actual Cash: ${arena.sharedCash}`);
    console.log(`Expected Cash: ${expectedCash}`);

    if (Math.abs((arena.sharedCash ?? 0) - expectedCash) > 5) {
        console.log(`-> Correcting cash to ${expectedCash}`);
        await adminDb!.collection('arena_config_ftse').doc(userId).set({
            sharedCash: expectedCash
        }, { merge: true });
        
        // Let's also log a fix note to system_logs_ftse
        await adminDb!.collection('arena_config_ftse').doc(userId).collection('system_logs').add({
            timestamp: new Date().toISOString(),
            type: 'BUG_FIX',
            description: `Fixed Intelligence Scanner race condition that double-credited cash. Adjusted sharedCash from $${arena.sharedCash?.toFixed(2)} to $${expectedCash.toFixed(2)}.`
        });
    }
  }
}

main().catch(console.error);
