
import { db } from "@/lib/firebase";
import { adminDb } from "@/lib/firebase-admin";
import {
    collection,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    addDoc,
    query,
    where,
    getDocs,
    orderBy,
    Timestamp,
    runTransaction
} from "firebase/firestore";
import { FieldValue } from "firebase-admin/firestore";

const VP_COLLECTION = "virtual_portfolio";
const VP_HISTORY_COLLECTION = "virtual_portfolio_history";
const VP_TRADES_COLLECTION = "virtual_trades";

export interface VirtualPortfolio {
    userId: string;
    cashBalance: number;
    initialBalance: number; // Added to track ROI accurately
    holdings: Record<string, { amount: number, averagePrice: number }>; // ticker -> { amount, avgPrice }
    totalValue: number; // Cash + Holdings Value
    lastUpdated: string;
}

export interface VirtualTrade {
    id?: string;
    userId: string;
    ticker: string;
    type: 'BUY' | 'SELL';
    amount: number;
    price: number;
    total: number;
    reason: string;
    date: string;
}

// Client-side fetch
export const getVirtualPortfolio = async (userId: string) => {
    try {
        const docRef = doc(db, VP_COLLECTION, userId);
        const snapshot = await getDoc(docRef);
        if (snapshot.exists()) {
            return snapshot.data() as VirtualPortfolio;
        }
        return null;
    } catch (e) {
        console.error("Error fetching VP", e);
        return null;
    }
};

export const getVirtualTrades = async (userId: string) => {
    try {
        const q = query(
            collection(db, VP_TRADES_COLLECTION),
            where("userId", "==", userId),
            orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VirtualTrade));
    } catch (e) {
        console.error("Error fetching VP trades", e);
        return [];
    }
};

export const getVirtualHistory = async (userId: string) => {
    try {
        const q = query(
            collection(db, VP_HISTORY_COLLECTION),
            where("userId", "==", userId),
            orderBy("date", "asc")
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Error fetching VP history", e);
        return [];
    }
}


// Server-side Logic (Admin SDK)

/**
 * Initializes the virtual portfolio if it doesn't exist.
 */
export async function initVirtualPortfolio(userId: string, initialBalance: number = 600) {
    if (!adminDb) return;
    const docRef = adminDb.collection(VP_COLLECTION).doc(userId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        await docRef.set({
            userId,
            cashBalance: initialBalance,
            initialBalance: initialBalance, // Store the user's specific starting amount
            holdings: {},
            totalValue: initialBalance,
            lastUpdated: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp()
        });

        // Initial snapshot
        await adminDb.collection(VP_HISTORY_COLLECTION).add({
            userId,
            totalValue: initialBalance,
            cashBalance: initialBalance,
            holdingsValue: 0,
            date: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp()
        });

        console.log(`Initialized Virtual Portfolio for ${userId} with $${initialBalance}.`);
    }
}

/**
 * Executes trades based on AI analysis.
 * Rules:
 * - BUY: Score >= 75 (Green) AND Cash > 10. Buys $50 fixed or max cash.
 * - SELL: Score <= 45 (Red). Sells 100%.
 */
export async function executeVirtualTrades(userId: string, analyses: any[]) {
    if (!adminDb) return;

    const vpRef = adminDb.collection(VP_COLLECTION).doc(userId);

    // Transact to ensure safety
    await adminDb.runTransaction(async (t) => {
        const vpDoc = await t.get(vpRef);
        if (!vpDoc.exists) return; // Should have been initialized

        const vp = vpDoc.data() as VirtualPortfolio;
        let cash = vp.cashBalance;
        const holdings = vp.holdings || {}; // Ensure holdings object exists
        const trades: any[] = [];

        // 1. Process Sells First (to free up cash)
        for (const analysis of analyses) {
            const ticker = analysis.ticker.toUpperCase();
            const currentPrice = analysis.currentPrice;
            const score = analysis.overallScore;

            if (holdings[ticker] && score <= 45) { // RED Signal
                const amount = holdings[ticker].amount;
                const saleValue = amount * currentPrice;

                cash += saleValue;
                delete holdings[ticker]; // Remove asset

                trades.push({
                    userId,
                    ticker,
                    type: 'SELL',
                    amount,
                    price: currentPrice,
                    total: saleValue,
                    reason: `Bearish Signal (Score: ${score})`,
                    date: new Date().toISOString(),
                    createdAt: FieldValue.serverTimestamp()
                });

                console.log(`[VP] SELL ${ticker} @ $${currentPrice}`);
            }
        }

        // 2. Process Buys
        for (const analysis of analyses) {
            const ticker = analysis.ticker.toUpperCase();
            const currentPrice = analysis.currentPrice;
            const score = analysis.overallScore;

            // Don't buy if we already have it (Simple logic for now: 1 position per asset)
            if (!holdings[ticker] && score >= 75 && cash >= 10) { // GREEN Signal
                const buyAmountUSD = Math.min(50, cash); // Buy $50 chunks or remaining cash
                const tokenAmount = buyAmountUSD / currentPrice;

                cash -= buyAmountUSD;
                holdings[ticker] = {
                    amount: tokenAmount,
                    averagePrice: currentPrice
                };

                trades.push({
                    userId,
                    ticker,
                    type: 'BUY',
                    amount: tokenAmount,
                    price: currentPrice,
                    total: buyAmountUSD,
                    reason: `Bullish Signal (Score: ${score})`,
                    date: new Date().toISOString(),
                    createdAt: FieldValue.serverTimestamp()
                });

                console.log(`[VP] BUY ${ticker} ($${buyAmountUSD}) @ $${currentPrice}`);
            }
        }

        // 3. Calculate new total value (Cash + Current Value of Holdings)
        // We need current prices for all holdings. `analyses` might not cover all holdings if user manually holds others,
        // but for VP, we only trade watchlisted items which SHOULD be in `analyses` if this runs during monitoring.
        // Fallback: use averagePrice if no current price (shouldn't happen often in this flow).

        let holdingsValue = 0;
        Object.keys(holdings).forEach(ticker => {
            // Find current price in this batch of analysis
            const a = analyses.find((x: any) => x.ticker.toUpperCase() === ticker);
            const price = a ? a.currentPrice : holdings[ticker].averagePrice;
            holdingsValue += holdings[ticker].amount * price;
        });

        const totalValue = cash + holdingsValue;

        // 4. Update DB
        t.update(vpRef, {
            cashBalance: cash,
            holdings: holdings,
            totalValue: totalValue,
            lastUpdated: new Date().toISOString()
        });

        // 5. Save Trades
        trades.forEach(trade => {
            const tradeRef = adminDb!.collection(VP_TRADES_COLLECTION).doc();
            t.set(tradeRef, trade);
        });

        // 6. Record Snapshot
        const histRef = adminDb!.collection(VP_HISTORY_COLLECTION).doc();
        t.set(histRef, {
            userId,
            totalValue,
            cashBalance: cash,
            holdingsValue,
            date: new Date().toISOString(),
            createdAt: FieldValue.serverTimestamp()
        });
    });
}

/**
 * Resets the virtual portfolio to its initial state.
 */
export async function resetVirtualPortfolio(userId: string, initialBalance: number = 600) {
    if (!adminDb) return false;

    try {
        const batch = adminDb.batch();

        // 1. Delete Main Portfolio Doc
        const vpRef = adminDb.collection(VP_COLLECTION).doc(userId);
        batch.delete(vpRef);

        // 2. Delete History
        const historySnapshot = await adminDb.collection(VP_HISTORY_COLLECTION).where("userId", "==", userId).get();
        historySnapshot.forEach(doc => batch.delete(doc.ref));

        // 3. Delete Trades
        const tradesSnapshot = await adminDb.collection(VP_TRADES_COLLECTION).where("userId", "==", userId).get();
        tradesSnapshot.forEach(doc => batch.delete(doc.ref));

        await batch.commit();

        // 4. Re-init
        await initVirtualPortfolio(userId, initialBalance);

        return true;
    } catch (e) {
        console.error("Error resetting VP:", e);
        return false;
    }
}
