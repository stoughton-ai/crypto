"use client";

import { db } from "@/lib/firebase";
import { type CryptoAnalysisResult } from "@/lib/gemini";
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

const LIBRARY_COLLECTION = "intel_reports";

export interface LibraryReport extends CryptoAnalysisResult {
    id: string;
    userId: string;
    savedAt: string;
}

export const saveToLibrary = async (userId: string, result: CryptoAnalysisResult) => {
    // Basic verification check like in the original library
    if (result.verificationStatus.toLowerCase().includes("research")) {
        console.log("Skipping library save: Low confidence verification result.");
        return null;
    }

    try {
        const docRef = await addDoc(collection(db, LIBRARY_COLLECTION), {
            ...result,
            userId,
            savedAt: new Date().toISOString(),
            createdAt: Timestamp.now(),
        });
        return docRef.id;
    } catch (error) {
        console.error("Error saving to library:", error);
        throw error;
    }
};

export const fetchLibrary = async (userId: string) => {
    try {
        const q = query(
            collection(db, LIBRARY_COLLECTION),
            where("userId", "==", userId),
            orderBy("createdAt", "desc")
        );
        const querySnapshot = await getDocs(q);
        const reports = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as LibraryReport));

        return reports;
    } catch (error) {
        console.error("Error fetching library (Primary):", error);

        // Fallback: If Sorted Query fails (likely missing index), try basic query + client-side sort
        try {
            console.warn("Falling back to client-side filter/sort.");
            const qBasic = query(collection(db, LIBRARY_COLLECTION), where("userId", "==", userId));
            const snapshot = await getDocs(qBasic);
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as LibraryReport)).sort((a: any, b: any) =>
                new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
            );
        } catch (fallbackError) {
            console.error("Error fetching library (Fallback):", fallbackError);
            throw fallbackError;
        }
    }
};

export const deleteReport = async (reportId: string) => {
    try {
        await deleteDoc(doc(db, LIBRARY_COLLECTION, reportId));
        return true;
    } catch (error) {
        console.error("Error deleting report:", error);
        return false;
    }
};

/**
 * Migration utility to move local reports to Firestore
 */
export const migrateLegacyLibrary = async (userId: string, legacyReports: any[]) => {
    console.log(`Starting migration for ${legacyReports.length} reports...`);
    const results = [];
    for (const report of legacyReports) {
        try {
            // Check if already exists to prevent duplicates (optional but good)
            const q = query(
                collection(db, LIBRARY_COLLECTION),
                where("userId", "==", userId),
                where("ticker", "==", report.ticker),
                where("savedAt", "==", report.savedAt)
            );
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                const docId = await saveToLibrary(userId, report);
                results.push(docId);
            }
        } catch (err) {
            console.error(`Failed to migrate ${report.ticker}:`, err);
        }
    }
    return results;
};

export const clearLibrary = async (userId: string) => {
    try {
        const q = query(collection(db, LIBRARY_COLLECTION), where("userId", "==", userId));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(d => deleteDoc(doc(db, LIBRARY_COLLECTION, d.id)));
        await Promise.all(deletePromises);
        return true;
    } catch (error) {
        console.error("Error clearing library:", error);
        return false;
    }
};
