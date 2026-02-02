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
}

export const addToPortfolio = async (userId: string, ticker: string, amount: number, averagePrice: number) => {
    try {
        const docRef = await addDoc(collection(db, PORTFOLIO_COLLECTION), {
            userId,
            ticker: ticker.toUpperCase(),
            amount,
            averagePrice,
            addedAt: new Date().toISOString(),
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
        const items = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as PortfolioItem));

        return items;
    } catch (error) {
        console.error("Error fetching portfolio:", error);
        // Fallback or check for index errors
        if (error instanceof Error && error.message.includes("index")) {
            console.warn("Firestore index required for portfolio. Falling back to client-side sort.");
            const qBasic = query(collection(db, PORTFOLIO_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as PortfolioItem)).sort((a: any, b: any) => {
                const timeA = a.createdAt?.toMillis() || 0;
                const timeB = b.createdAt?.toMillis() || 0;
                return timeB - timeA;
            });
        }
        throw error;
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
    } catch (error) {
        console.error("Error fetching portfolio history:", error);
        return [];
    }
};
