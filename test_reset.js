require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

initializeApp({
  credential: cert(serviceAccount)
});

const adminDb = getFirestore();

// Copy of resetVirtualPortfolio directly to see where it fails
async function resetVirtualPortfolio(userId, initialBalance = 1000, initialHoldings = {}) {
  const VP_COLLECTION = "virtual_portfolio";
  const VP_HISTORY_COLLECTION = "virtual_portfolio_history";
  const VP_TRADES_COLLECTION = "virtual_trades";
  const VP_DECISIONS_COLLECTION = "virtual_decisions";
  const safeNum = (v) => Number(v) || 0;

  try {
    const allDocsToDelete = [];

    // 1. Gather Main Portfolio Doc
    const vpRef = adminDb.collection(VP_COLLECTION).doc(userId);
    allDocsToDelete.push(vpRef);

    console.log("Fetching snapshots...");

    // 2. Fetch all related documents to delete in parallel
    const [historySnapshot, tradesSnapshot, decisionsSnapshot] = await Promise.all([
      adminDb.collection(VP_HISTORY_COLLECTION).where("userId", "==", userId).get(),
      adminDb.collection(VP_TRADES_COLLECTION).where("userId", "==", userId).get(),
      adminDb.collection(VP_DECISIONS_COLLECTION).where("userId", "==", userId).get()
    ]);

    historySnapshot.forEach(doc => allDocsToDelete.push(doc.ref));
    tradesSnapshot.forEach(doc => allDocsToDelete.push(doc.ref));
    decisionsSnapshot.forEach(doc => allDocsToDelete.push(doc.ref));

    console.log(`Found ${allDocsToDelete.length} documents to delete...`);

    // Process deletions in chunks of 400, strictly in parallel
    const BATCH_SIZE = 400;
    const deletionPromises = [];
    for (let i = 0; i < allDocsToDelete.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      const chunk = allDocsToDelete.slice(i, i + BATCH_SIZE);
      chunk.forEach(ref => batch.delete(ref));
      deletionPromises.push(batch.commit());
    }

    console.log(`Committing ${deletionPromises.length} batches...`);
    await Promise.all(deletionPromises);
    console.log("Deletions committed!");

    // 5. Re-init (Force create since we just deleted it)
    const docRef = adminDb.collection(VP_COLLECTION).doc(userId);
    let holdingsValue = 0;
    for (const ticker in initialHoldings) {
      const h = initialHoldings[ticker];
      holdingsValue += (h.amount * h.averagePrice);
    }
    const totalValue = safeNum(safeNum(initialBalance) + holdingsValue);

    await docRef.set({
      userId,
      cashBalance: safeNum(initialBalance),
      initialBalance: totalValue,
      holdings: initialHoldings,
      totalValue: totalValue,
      lastUpdated: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    });

    const histRef = adminDb.collection(VP_HISTORY_COLLECTION).doc();
    await histRef.set({
      userId,
      totalValue: safeNum(totalValue),
      cashBalance: safeNum(initialBalance),
      holdingsValue: safeNum(holdingsValue),
      date: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp()
    });

    const past24hRef = adminDb.collection(VP_HISTORY_COLLECTION).doc();
    await past24hRef.set({
      userId,
      totalValue: safeNum(totalValue),
      cashBalance: safeNum(initialBalance),
      holdingsValue: safeNum(holdingsValue),
      date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      createdAt: FieldValue.serverTimestamp()
    });

    await adminDb.collection('agent_configs').doc(userId).update({
      stopLossTriggered: false,
      stopLossTriggeredAt: null,
      stopLossPeakValue: null,
      stopLossCurrentValue: null,
      stopLossDrawdownPct: null,
      stopLossResumedAt: new Date().toISOString()
    });

    return true;
  } catch (e) {
    console.error("Error resetting VP:", e);
    return false;
  }
}

resetVirtualPortfolio("SF87h3pQoxfkkFfD7zCSOXgtz5h1").then(() => console.log('Done'));
