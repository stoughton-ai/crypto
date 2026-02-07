import fs from "fs/promises";
import path from "path";
import { type CryptoAnalysisResult } from "./gemini";

const LIBRARY_PATH = path.join(process.cwd(), "data", "reports.json");

/**
 * Ensures the data directory and reports file exist.
 */
async function ensureDirectory() {
    const dir = path.dirname(LIBRARY_PATH);
    try {
        await fs.access(dir);
    } catch {
        await fs.mkdir(dir, { recursive: true });
    }
}

/**
 * Save a report to the library ONLY if it has multi-source verification.
 */
export async function saveToLibrary(result: CryptoAnalysisResult) {
    if (result.verificationStatus.toLowerCase().includes("research")) {
        console.log("Skipping library save: Low confidence verification result.");
        return null;
    }

    await ensureDirectory();

    const entry = {
        ...result,
        savedAt: new Date().toISOString(),
        id: Math.random().toString(36).substring(7),
    };

    const reports = await getLibrary();
    reports.unshift(entry);
    await fs.writeFile(LIBRARY_PATH, JSON.stringify(reports, null, 2));
    return entry;
}

/**
 * Purge any existing records that are based on research rather than hard data.
 */
async function cleanupLibrary() {
    try {
        const data = await fs.readFile(LIBRARY_PATH, "utf-8");
        const reports = JSON.parse(data);
        const filtered = reports.filter((r: any) =>
            !r.verificationStatus.toLowerCase().includes("research")
        );

        if (filtered.length !== reports.length) {
            await fs.writeFile(LIBRARY_PATH, JSON.stringify(filtered, null, 2));
            console.log(`Library cleaned: ${reports.length - filtered.length} low-source records removed.`);
        }
        return filtered;
    } catch {
        return [];
    }
}

/**
 * Get all reports from the library (auto-cleans low quality ones).
 */
export async function getLibrary() {
    return await cleanupLibrary();
}

/**
 * Delete a specific report from the library.
 */
export async function deleteFromLibrary(id: string) {
    const reports = await getLibrary();
    const filtered = reports.filter((r: any) => r.id !== id);
    if (filtered.length !== reports.length) {
        await fs.writeFile(LIBRARY_PATH, JSON.stringify(filtered, null, 2));
        return true;
    }
    return false;
}

/**
 * Get reports for a specific ticker to provide historical context.
 */
export async function getTickerHistory(ticker: string) {
    const reports = await getLibrary();
    return reports
        .filter((r: any) => r.ticker.toUpperCase() === ticker.toUpperCase())
        .slice(0, 3);
}
