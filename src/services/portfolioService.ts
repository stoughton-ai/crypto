"use client";

import { db } from "@/lib/firebase";
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    where,
    getDocs,
    orderBy,
    Timestamp
} from "firebase/firestore";

const PORTFOLIO_COLLECTION = "portfolios";
const PORTFOLIO_HISTORY_COLLECTION = "portfolio_history";

export interface PortfolioSnapshot {
    id?: string;
    userId: string;
    totalValue: number;
    timestamp: string;
    createdAt: Timestamp;
}

export interface PortfolioItem {
    id: string;
    userId: string;
    ticker: string;
    amount: number;
    averagePrice: number;
    addedAt: string;
    tradeDate?: string;
}

const CASH_HISTORY_COLLECTION = "cash_history";

export interface CashHistoryItem {
    id: string;
    userId: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number;
    date: string;
    createdAt: Timestamp;
}

export const recordCashTransaction = async (userId: string, type: 'DEPOSIT' | 'WITHDRAWAL', amount: number) => {
    try {
        await addDoc(collection(db, CASH_HISTORY_COLLECTION), {
            userId,
            type,
            amount,
            date: new Date().toISOString(),
            createdAt: Timestamp.now(),
        });
        return true;
    } catch (error) {
        console.error("Error recording cash transaction:", error);
        return false;
    }
};

export const addToPortfolio = async (userId: string, ticker: string, amount: number, averagePrice: number, tradeDate?: string) => {
    try {
        const docRef = await addDoc(collection(db, PORTFOLIO_COLLECTION), {
            userId,
            ticker: ticker.toUpperCase(),
            amount,
            averagePrice,
            addedAt: new Date().toISOString(),
            tradeDate: tradeDate || new Date().toISOString(),
            createdAt: Timestamp.now(),
        });
        return docRef.id;
    } catch (error) {
        console.error("Error adding to portfolio:", error);
        throw error;
    }
};

export const fetchPortfolio = async (userId: string) => {
    try {
        const q = query(
            collection(db, PORTFOLIO_COLLECTION),
            where("userId", "==", userId),
            orderBy("createdAt", "desc")
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as PortfolioItem));
    } catch (error: any) {
        console.warn("Ordered portfolio fetch failed, attempting fallback:", error.message || error);

        try {
            // Fallback: Fetch all for user and sort on client
            const qBasic = query(collection(db, PORTFOLIO_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            const items = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as PortfolioItem));

            return items.sort((a: any, b: any) => {
                const timeA = a.createdAt?.toMillis?.() || new Date(a.addedAt || 0).getTime();
                const timeB = b.createdAt?.toMillis?.() || new Date(b.addedAt || 0).getTime();
                return timeB - timeA;
            });
        } catch (fallbackError) {
            console.error("Critical portfolio fetch failure:", fallbackError);
            return [];
        }
    }
};

export const updatePortfolioItem = async (id: string, data: Partial<Omit<PortfolioItem, "id" | "userId">>) => {
    try {
        const docRef = doc(db, PORTFOLIO_COLLECTION, id);
        await updateDoc(docRef, data);
        return true;
    } catch (error) {
        console.error("Error updating portfolio item:", error);
        throw error;
    }
};

export const removeFromPortfolio = async (id: string) => {
    try {
        await deleteDoc(doc(db, PORTFOLIO_COLLECTION, id));
        return true;
    } catch (error) {
        console.error("Error removing from portfolio:", error);
        throw error;
    }
};

export const recordPortfolioSnapshot = async (userId: string, totalValue: number) => {
    try {
        await addDoc(collection(db, PORTFOLIO_HISTORY_COLLECTION), {
            userId,
            totalValue,
            timestamp: new Date().toISOString(),
            createdAt: Timestamp.now(),
        });
        return true;
    } catch (error) {
        console.error("Error recording portfolio snapshot:", error);
        return false;
    }
};

export const fetchPortfolioHistory = async (userId: string) => {
    try {
        const q = query(
            collection(db, PORTFOLIO_HISTORY_COLLECTION),
            where("userId", "==", userId),
            orderBy("createdAt", "asc")
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as PortfolioSnapshot));
    } catch (error: any) {
        console.warn("Portfolio history index missing, falling back to client sort:", error.message || error);
        try {
            const qBasic = query(collection(db, PORTFOLIO_HISTORY_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as PortfolioSnapshot)).sort((a, b) => {
                const timeA = a.createdAt?.toMillis?.() || new Date(a.timestamp || 0).getTime();
                const timeB = b.createdAt?.toMillis?.() || new Date(b.timestamp || 0).getTime();
                return timeA - timeB; // Ascending for history
            });
        } catch (fallbackError) {
            console.error("Critical history fetch failure:", fallbackError);
            return [];
        }
    }
};

export const clearPortfolio = async (userId: string) => {
    try {
        const q = query(collection(db, PORTFOLIO_COLLECTION), where("userId", "==", userId));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        return true;
    } catch (error) {
        console.error("Error clearing portfolio:", error);
        return false;
    }
};

const REALIZED_PNL_COLLECTION = "realized_pnl";

export interface RealizedTrade {
    id: string;
    userId: string;
    ticker: string;
    sellAmount: number;
    sellPrice: number;
    costBasis: number;
    realizedPnl: number;
    date: string;
    createdAt: Timestamp;
}

// ... (no changes to this block yet, need to verify page.tsx)



export const recordTrade = async (userId: string, ticker: string, sellAmount: number, sellPrice: number, costBasis: number, date?: string) => {
    try {
        const realizedPnl = (sellPrice - costBasis) * sellAmount;
        await addDoc(collection(db, REALIZED_PNL_COLLECTION), {
            userId,
            ticker: ticker.toUpperCase(),
            sellAmount,
            sellPrice,
            costBasis,
            realizedPnl,
            date: date || new Date().toISOString(),
            createdAt: Timestamp.now(),
        });
        return true;
    } catch (error) {
        console.error("Error recording trade:", error);
        return false;
    }
};

export type TransactionHistoryItem =
    | (RealizedTrade & { type: 'TRADE' })
    | (CashHistoryItem & { ticker: 'USD' });

export const fetchRealizedTrades = async (userId: string): Promise<TransactionHistoryItem[]> => {
    try {
        // Fetch Trades
        const tradesQuery = query(
            collection(db, REALIZED_PNL_COLLECTION),
            where("userId", "==", userId)
        );
        const tradesSnap = await getDocs(tradesQuery);
        const trades = tradesSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            type: 'TRADE' as const
        } as TransactionHistoryItem));

        // Fetch Cash History
        const cashQuery = query(
            collection(db, CASH_HISTORY_COLLECTION),
            where("userId", "==", userId)
        );
        const cashSnap = await getDocs(cashQuery);
        const cash = cashSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            ticker: 'USD'
        } as TransactionHistoryItem));

        // Merge and Sort
        const all = [...trades, ...cash];
        return all.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA; // Descending
        });
    } catch (error) {
        console.error("Error fetching transaction history:", error);
        return [];
    }
};

const CASH_COLLECTION = "cash_balances";

export interface CashBalance {
    userId: string;
    balance: number;
    updatedAt: string;
}

export const getCashBalance = async (userId: string): Promise<number> => {
    try {
        const docRef = doc(db, CASH_COLLECTION, userId);
        const snapshot = await getDocs(query(collection(db, CASH_COLLECTION), where("userId", "==", userId)));

        if (snapshot.empty) {
            return 0;
        }
        return snapshot.docs[0].data().balance || 0;
    } catch (error) {
        console.error("Error fetching cash:", error);
        return 0;
    }
};

export const updateCashBalance = async (userId: string, newBalance: number) => {
    try {
        // We use setDoc with merge or create if not exists
        // Since we are using queries above, let's stick to a consistent ID strategy.
        // Let's assume document ID IS the userId for simplicity/efficiency? 
        // In the get above I used query. Let's switch to doc lookup if possible, but for safety with existing data (none) let's be robust.
        // Actually, let's force docId = userId for new standard.

        const { setDoc, getDoc } = await import("firebase/firestore"); // Dynamic import to avoid top-level changes if possible, or just use what we have
        const docRef = doc(db, CASH_COLLECTION, userId);
        await setDoc(docRef, {
            userId,
            balance: newBalance,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        return true;
    } catch (error) {
        console.error("Error updating cash:", error);
        return false;
    }
};

export const modifyCash = async (userId: string, amount: number) => {
    const current = await getCashBalance(userId);
    const newBalance = current + amount;
    await updateCashBalance(userId, newBalance);
    return newBalance;
};

export const purgeLegacyCashData = async (userId: string) => {
    try {
        // 1. Remove from portfolios (ticker US or USD)
        const qPort = query(collection(db, PORTFOLIO_COLLECTION), where("userId", "==", userId));
        const snapPort = await getDocs(qPort);
        const delPort = snapPort.docs
            .filter(d => ["US", "USD"].includes(d.data().ticker))
            .map(d => deleteDoc(d.ref));

        // 2. Remove from realized_pnl (ticker US or USD)
        const qReal = query(collection(db, REALIZED_PNL_COLLECTION), where("userId", "==", userId));
        const snapReal = await getDocs(qReal);
        const delReal = snapReal.docs
            .filter(d => ["US", "USD"].includes(d.data().ticker))
            .map(d => deleteDoc(d.ref));

        // 3. Clear new cash_history
        const qCashHist = query(collection(db, CASH_HISTORY_COLLECTION), where("userId", "==", userId));
        const snapCashHist = await getDocs(qCashHist);
        const delCashHist = snapCashHist.docs.map(d => deleteDoc(d.ref));

        // 4. Reset balance to 0
        await updateCashBalance(userId, 0);

        await Promise.all([...delPort, ...delReal, ...delCashHist]);
        return true;
    } catch (error) {
        console.error("Error purging legacy cash data:", error);
        return false;
    }
};
