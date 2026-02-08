import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  console.warn("GOOGLE_GENERATIVE_AI_API_KEY is not set. AI features may not work.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

// Primary and Fallback models
const MODELS = ["gemini-2.0-flash", "gemini-1.5-flash-002", "gemini-1.5-flash-8b", "gemini-1.5-pro"];

/**
 * Robust content generation with model fallback and automatic retry
 */
export async function generateContentWithFallback(prompt: string, attempt: number = 0): Promise<string> {
  const modelName = MODELS[Math.min(attempt, MODELS.length - 1)];
  const modelInstance = genAI.getGenerativeModel({ model: modelName });

  try {
    const result = await modelInstance.generateContent(prompt);
    return result.response.text();
  } catch (error: any) {
    const isRateLimit = error?.message?.includes("429") || error?.message?.includes("Resource exhausted");

    if (isRateLimit && attempt < MODELS.length - 1) {
      console.warn(`Model ${modelName} exhausted. Falling back to ${MODELS[attempt + 1]}...`);
      // Wait a bit before retry to let the burst clear
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      return generateContentWithFallback(prompt, attempt + 1);
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
  savedAt?: string;
}
