
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
    targets?: string[]; // Asset targets for the AI Agent
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
import { AGENT_WATCHLIST } from "@/lib/constants";

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
            targets: AGENT_WATCHLIST, // Default targets
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

const VP_DECISIONS_COLLECTION = "virtual_decisions";

/**
 * Executes trades based on AI analysis.
 * Rules:
 * - BUY: Score >= 66 (Green) AND Cash > 10. Buys $50 fixed or max cash.
 * - SELL: Score <= 49 (Red). Sells 100%.
 */
export async function executeVirtualTrades(userId: string, analyses: any[]) {
    if (!adminDb) return;

    const vpRef = adminDb.collection(VP_COLLECTION).doc(userId);
    const MAX_ALLOCATION_PER_ASSET = 400; // Max exposure per coin
    const MIN_CASH_RESERVE = 5;

    // Transact to ensure safety
    await adminDb.runTransaction(async (t) => {
        const vpDoc = await t.get(vpRef);
        if (!vpDoc.exists) return;

        const vp = vpDoc.data() as VirtualPortfolio;
        let cash = vp.cashBalance;
        const holdings = vp.holdings || {}; // Ensure holdings object exists
        const trades: any[] = [];
        const decisions: any[] = [];

        // 1. Process Sells & Profit Taking First (to free up cash)
        for (const analysis of analyses) {
            const ticker = analysis.ticker.toUpperCase();
            const currentPrice = analysis.currentPrice;
            const score = analysis.overallScore;

            if (holdings[ticker]) {
                const currentAmt = holdings[ticker].amount;
                const avgPrice = holdings[ticker].averagePrice;
                const currentValue = currentAmt * currentPrice;
                const pnlPercent = ((currentPrice - avgPrice) / avgPrice) * 100;

                // --- STRATEGY: SELLING ---
                if (score <= 49) {
                    // RED SIGNAL: Full Dump
                    const saleValue = currentValue;
                    cash += saleValue;
                    delete holdings[ticker];

                    const trade = createTradeRecord(userId, ticker, 'SELL', currentAmt, currentPrice, saleValue, `Bearish Signal (Score: ${score})`);
                    trades.push(trade);
                    decisions.push(createDecisionRecord(userId, ticker, 'SELL', score, currentPrice, `Sold All: Score ${score} <= 49`));
                    console.log(`[VP] SELL ALL ${ticker} @ $${currentPrice}`);

                } else if (score >= 50 && score <= 59) {
                    // AMBER SIGNAL: Risk Management
                    if (pnlPercent > 15) {
                        // Take Profit: Sell 50% if we have nice gains but sentiment is explicitly neutral
                        const sellAmt = currentAmt * 0.5;
                        const sellVal = sellAmt * currentPrice;

                        cash += sellVal;
                        holdings[ticker].amount -= sellAmt;
                        // Average price doesn't change on sell

                        const trade = createTradeRecord(userId, ticker, 'SELL', sellAmt, currentPrice, sellVal, `Take Profit (Amber Signal +${pnlPercent.toFixed(1)}%)`);
                        trades.push(trade);
                        decisions.push(createDecisionRecord(userId, ticker, 'TRIM', score, currentPrice, `Trim 50%: Profit taking on neutral signal`));
                        console.log(`[VP] TRIM ${ticker} (Profit Taking)`);
                    } else if (pnlPercent < -10) {
                        // Stop Loss: Trim 50% if we are bleeding and sentiment is neutral
                        const sellAmt = currentAmt * 0.5;
                        const sellVal = sellAmt * currentPrice;

                        cash += sellVal;
                        holdings[ticker].amount -= sellAmt;

                        const trade = createTradeRecord(userId, ticker, 'SELL', sellAmt, currentPrice, sellVal, `Risk Reduction (Amber Signal ${pnlPercent.toFixed(1)}%)`);
                        trades.push(trade);
                        decisions.push(createDecisionRecord(userId, ticker, 'TRIM', score, currentPrice, `Trim 50%: Risk reduction on neutral signal`));
                        console.log(`[VP] TRIM ${ticker} (Stop Loss)`);
                    } else {
                        // Hold
                        decisions.push(createDecisionRecord(userId, ticker, 'HOLD', score, currentPrice, `Holding: Neutral Signal (PnL ${pnlPercent.toFixed(1)}%)`));
                    }
                }
            }
        }

        // 2. Process Buys (Scaling In)
        for (const analysis of analyses) {
            const ticker = analysis.ticker.toUpperCase();
            const currentPrice = analysis.currentPrice;
            const score = analysis.overallScore;

            // --- STRATEGY: DYNAMIC BUYING ---
            // Threshold lowered to 60 for "Speculative" entry
            if (score >= 60) {
                // Determine Conviction Tier
                let baseBuyAmount = 0;
                let conviction = "Speculative";

                if (score >= 80) {
                    baseBuyAmount = 100; // High Confidence
                    conviction = "High Conviction";
                } else if (score >= 70) {
                    baseBuyAmount = 50;  // Standard
                    conviction = "Standard";
                } else {
                    baseBuyAmount = 25;  // Speculative (60-69)
                    conviction = "Speculative";
                }

                // Check Current Allocation
                const currentHoldingsVal = holdings[ticker] ? (holdings[ticker].amount * currentPrice) : 0;
                const remainingAllocation = MAX_ALLOCATION_PER_ASSET - currentHoldingsVal;

                if (remainingAllocation > 10 && cash > MIN_CASH_RESERVE) {
                    // Determine actual buy amount (Limit by Cash, Allocation, and Conviction)
                    // We also want to ensure we don't drain cash instantly. 
                    const maxAffordable = Math.max(0, cash - MIN_CASH_RESERVE);
                    const finalBuyUSD = Math.min(baseBuyAmount, remainingAllocation, maxAffordable);

                    if (finalBuyUSD >= 10) { // Minimum trade size $10
                        const tokenAmount = finalBuyUSD / currentPrice;

                        cash -= finalBuyUSD;

                        // Update or Create Holding
                        if (holdings[ticker]) {
                            const oldAmt = holdings[ticker].amount;
                            const oldAvg = holdings[ticker].averagePrice;
                            const totalCost = (oldAmt * oldAvg) + finalBuyUSD;
                            const newAmt = oldAmt + tokenAmount;

                            holdings[ticker] = {
                                amount: newAmt,
                                averagePrice: totalCost / newAmt
                            };
                        } else {
                            holdings[ticker] = {
                                amount: tokenAmount,
                                averagePrice: currentPrice
                            };
                        }

                        const trade = createTradeRecord(userId, ticker, 'BUY', tokenAmount, currentPrice, finalBuyUSD, `${conviction} Buy (Score: ${score})`);
                        trades.push(trade);
                        decisions.push(createDecisionRecord(userId, ticker, 'BUY', score, currentPrice, `Accumulating: ${conviction} tier`));
                        console.log(`[VP] BUY ${ticker} ($${finalBuyUSD.toFixed(2)}) - ${conviction}`);
                    } else {
                        decisions.push(createDecisionRecord(userId, ticker, 'SKIP', score, currentPrice, `Skipped: Capped at Max Allocation or Insufficient Cash`));
                    }
                } else {
                    decisions.push(createDecisionRecord(userId, ticker, 'HOLD', score, currentPrice, `Max Allocation Reached ($${currentHoldingsVal.toFixed(0)})`));
                }
            } else if (score < 50 && !holdings[ticker]) {
                // Not holding, and score is bad -> Ignore
                decisions.push(createDecisionRecord(userId, ticker, 'SKIP', score, currentPrice, `Avoid: Score ${score} < 60`));
            }
        }

        // 3. Calculate new total value
        let holdingsValue = 0;
        Object.keys(holdings).forEach(ticker => {
            // Use current price from analysis if available, otherwise last known avg
            const a = analyses.find((x: any) => x.ticker.toUpperCase() === ticker);
            // If we have a fresh price, use it for valuation, but don't change the avgPrice in DB unless we trade
            const price = a ? a.currentPrice : holdings[ticker].averagePrice;
            holdingsValue += holdings[ticker].amount * price;
        });
        const totalValue = cash + holdingsValue;

        // 4. Update DB - ALWAYS update lastUpdated to trigger frontend refresh
        t.update(vpRef, {
            cashBalance: cash,
            holdings: holdings,
            totalValue: totalValue,
            lastUpdated: new Date().toISOString()
        });

        // 5. Save Trades & Decisions
        trades.forEach(trade => {
            const tradeRef = adminDb!.collection(VP_TRADES_COLLECTION).doc();
            t.set(tradeRef, trade);
        });

        decisions.forEach(decision => {
            const decisionRef = adminDb!.collection(VP_DECISIONS_COLLECTION).doc();
            t.set(decisionRef, decision);
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
    return; // Added return statement at the end of the transaction
}

// Helpers
function createTradeRecord(userId: string, ticker: string, type: string, amount: number, price: number, total: number, reason: string) {
    return {
        userId, ticker, type, amount, price, total, reason,
        date: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp()
    };
}

function createDecisionRecord(userId: string, ticker: string, action: string, score: number, price: number, reason: string) {
    return {
        userId, ticker, action, score, price, reason,
        date: new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp()
    };
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

/**
 * Fetches the user's AI Agent targets.
 */
export async function getAgentTargetsAdmin(userId: string): Promise<string[]> {
    if (!adminDb) return AGENT_WATCHLIST;
    try {
        const docRef = adminDb.collection(VP_COLLECTION).doc(userId);
        const snapshot = await docRef.get();
        if (snapshot.exists) {
            const data = snapshot.data();
            return data?.targets || AGENT_WATCHLIST;
        }
    } catch (e) {
        console.error("Error fetching targets", e);
    }
    return AGENT_WATCHLIST;
}

/**
 * Updates the user's AI Agent targets. Max 15.
 */
export async function updateAgentTargetsAdmin(userId: string, targets: string[]) {
    if (!adminDb) return { success: false, message: "Admin SDK missing" };

    // Validate
    const cleanedTargets = targets
        .map(t => t.trim().toUpperCase())
        .filter(t => t.length > 0)
        .slice(0, 15);

    try {
        const docRef = adminDb.collection(VP_COLLECTION).doc(userId);
        await docRef.update({
            targets: cleanedTargets,
            lastUpdated: new Date().toISOString()
        });
        return { success: true, targets: cleanedTargets };
    } catch (e) {
        console.error("Error updating targets", e);
        return { success: false, message: "Update failed" };
    }
}
