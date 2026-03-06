import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  console.warn("GOOGLE_GENERATIVE_AI_API_KEY is not set. AI features may not work.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

// Primary and Fallback models — ordered by preference
// gemini-1.5-flash-002 and gemini-1.5-pro are deprecated; use current stable models
const MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
];

/**
 * Robust content generation with model fallback and automatic retry
 */
export async function generateContentWithFallback(prompt: string, attempt: number = 0, useSearch: boolean = false): Promise<string> {
  const modelName = MODELS[Math.min(attempt, MODELS.length - 1)];
  const modelInstance = genAI.getGenerativeModel({
    model: modelName,
    // @ts-ignore
    tools: useSearch ? [{ googleSearch: {} }] : undefined
  });

  try {
    const result = await modelInstance.generateContent(prompt);
    return result.response.text();
  } catch (error: any) {
    const isRateLimit = error?.message?.includes("429") || error?.message?.includes("Resource exhausted");
    const isModelGone = error?.message?.includes("404") || error?.message?.includes("not found") || error?.message?.includes("deprecated");

    if ((isRateLimit || isModelGone) && attempt < MODELS.length - 1) {
      console.warn(`Model ${modelName} ${isModelGone ? 'unavailable' : 'exhausted'}. Falling back to ${MODELS[attempt + 1]}...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      return generateContentWithFallback(prompt, attempt + 1, useSearch);
    }

    throw error;
  }
}

// Keep the legacy export for compatibility where direct model access is used
export const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
});

export interface CryptoAnalysisResult {
  ticker: string;
  name: string;
  currentPrice: number;
  priceChange24h: number;
  marketCap: number;
  verificationStatus: string;
  trafficLight: "RED" | "AMBER" | "GREEN";
  overallScore: number;
  signals: {
    name: string;
    category: "Fundamental" | "Technical" | "Sentiment" | "On-Chain";
    weight: number;
    score: number; // 0-100
    whyItMatters: string;
    status: "RED" | "AMBER" | "GREEN";
  }[];
  summary: string;
  historicalInsight: string;
  targetPrice?: number;
  profitConfidence?: number; // 0-100
  entryType?: 'MOMENTUM' | 'DIP_RECOVERY' | 'BREAKOUT' | 'ACCUMULATION';
  researchNotes?: string[];

  savedAt?: string;
  createdAt?: any;
  content?: string;
  title?: string;
  type?: string;
  analysisType?: string;
}
