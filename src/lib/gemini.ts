import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

if (!apiKey) {
  console.warn("GOOGLE_GENERATIVE_AI_API_KEY is not set. AI features may not work.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");

export const model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash",
});

export interface CryptoAnalysisResult {
  ticker: string;
  name: string;
  currentPrice: number;
  priceChange24h: number;
  price7dAvg: number;
  price30dAvg: number;
  allTimeHigh: number;
  athDate: string;
  allTimeLow: number;
  atlDate: string;
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
  savedAt?: string;
}
