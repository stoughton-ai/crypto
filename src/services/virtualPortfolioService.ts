
import { db } from "@/lib/firebase";
import {
    collection,
    doc,
    getDoc,
    query,
    where,
    getDocs,
    orderBy
} from "firebase/firestore";

const VP_COLLECTION = "virtual_portfolio";
const VP_HISTORY_COLLECTION = "virtual_portfolio_history";
const VP_TRADES_COLLECTION = "virtual_trades";
const VP_DECISIONS_COLLECTION = "virtual_decisions";

export interface VirtualPortfolio {
    userId: string;
    cashBalance: number;
    initialBalance: number;
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
        if (e instanceof Error && e.message.includes("index")) {
            console.warn("Firestore index missing for VP trades. Falling back to client-side sort.");
            const qBasic = query(collection(db, VP_TRADES_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VirtualTrade))
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
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
        if (e instanceof Error && e.message.includes("index")) {
            console.warn("Firestore index missing for VP history. Falling back to client-side sort.");
            const qBasic = query(collection(db, VP_HISTORY_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => doc.data())
                .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
        }
        return [];
    }
}

export interface VirtualDecision {
    id?: string;
    userId: string;
    ticker: string;
    action: 'BUY' | 'SELL' | 'HOLD' | 'SKIP';
    reason: string;
    score: number;
    price: number;
    date: string;
}

export const getVirtualDecisions = async (userId: string) => {
    try {
        const q = query(
            collection(db, VP_DECISIONS_COLLECTION),
            where("userId", "==", userId),
            orderBy("date", "desc")
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VirtualDecision));
    } catch (e) {
        console.error("Error fetching VP decisions", e);
        if (e instanceof Error && e.message.includes("index")) {
            console.warn("Firestore index missing for VP decisions. Falling back to client-side sort.");
            const qBasic = query(collection(db, VP_DECISIONS_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as VirtualDecision))
                .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
        return [];
    }
};
