import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, updateDoc, Timestamp, arrayUnion, arrayRemove } from "firebase/firestore";

const COLLECTION_NAME = "agent_configs";

export interface AgentConfig {
    userId: string;
    trafficLightTokens: string[]; // Max 3
    standardTokens: string[];     // Max 7 (Total 10)
    lastCheck?: { [ticker: string]: string }; // ISO timestamps
}

// Default configuration for new users
const DEFAULT_CONFIG: Omit<AgentConfig, "userId"> = {
    trafficLightTokens: ["BTC", "ETH", "SOL"],
    standardTokens: ["XRP", "DOGE", "ADA", "DOT", "LINK", "MATIC", "AVAX"]
};

export const getAgentConfig = async (userId: string): Promise<AgentConfig> => {
    try {
        const docRef = doc(db, COLLECTION_NAME, userId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return { userId, ...docSnap.data() } as AgentConfig;
        } else {
            // Create default if not exists
            const newConfig: AgentConfig = { userId, ...DEFAULT_CONFIG };
            await setDoc(docRef, newConfig);
            return newConfig;
        }
    } catch (error) {
        console.error("Error fetching agent config:", error);
        // Return a safe default to prevent crashes
        return { userId, ...DEFAULT_CONFIG };
    }
};

export const updateTrafficLightTokens = async (userId: string, tokens: string[]) => {
    if (tokens.length > 3) throw new Error("Maximum 3 traffic light tokens allowed.");
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { trafficLightTokens: tokens });
};

export const updateStandardTokens = async (userId: string, tokens: string[]) => {
    if (tokens.length > 8) throw new Error("Maximum 8 standard tokens allowed.");
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { standardTokens: tokens });
};

export const addTokenToAgent = async (userId: string, ticker: string, type: 'traffic' | 'standard') => {
    const config = await getAgentConfig(userId);
    const upperTicker = ticker.toUpperCase();

    // Check duplicates
    if (config.trafficLightTokens.includes(upperTicker) || config.standardTokens.includes(upperTicker)) {
        throw new Error("Token already being tracked.");
    }

    if (type === 'traffic') {
        if (config.trafficLightTokens.length >= 3) throw new Error("Traffic Light list full (Max 3). Demote one first.");
        await updateTrafficLightTokens(userId, [...config.trafficLightTokens, upperTicker]);
    } else {
        if (config.standardTokens.length >= 8) throw new Error("Standard list full (Max 8). Remove one first.");
        await updateStandardTokens(userId, [...config.standardTokens, upperTicker]);
    }
};

export const removeTokenFromAgent = async (userId: string, ticker: string) => {
    const config = await getAgentConfig(userId);
    const upperTicker = ticker.toUpperCase();

    if (config.trafficLightTokens.includes(upperTicker)) {
        await updateTrafficLightTokens(userId, config.trafficLightTokens.filter(t => t !== upperTicker));
    } else if (config.standardTokens.includes(upperTicker)) {
        await updateStandardTokens(userId, config.standardTokens.filter(t => t !== upperTicker));
    }
};

export const updateTokenCheckTimestamp = async (userId: string, ticker: string) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    const key = `lastCheck.${ticker.toUpperCase()}`;
    await updateDoc(docRef, {
        [key]: new Date().toISOString()
    });
};

export const resetAgentTimeline = async (userId: string) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, {
        lastCheck: {}
    });
};
