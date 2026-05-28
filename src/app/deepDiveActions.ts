"use server";

import { adminDb } from "@/lib/firebase-admin";
import { getArenaConfig } from "@/services/arenaService";
import { getVerifiedPrices } from "@/app/actions";
import { generateContentWithFallback } from "@/lib/gemini";

export interface DeepDiveTokenResult {
    ticker: string;
    analysis: string;
    rating: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
    target24h: number;
    target7d: number;
    target30d: number;
}

export interface DeepDiveReport {
    marketplaceNews: string;
    btcReference: {
        analysis: string;
        rating: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
        target24h: number;
        target7d: number;
        target30d: number;
    };
    tokenDeepDives: DeepDiveTokenResult[];
    generatedAt: string;
}

// Ensure the helper is available to clean AI output
function safeJsonParse<T = any>(raw: string): T {
    let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    s = s.replace(/[\x00-\x1F\x7F]/g, ' ');
    s = s.replace(/,\s*([}\]])/g, '$1');
    const match = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error('No JSON object found in AI response');
    return JSON.parse(match[0]) as T;
}

export async function fetchCryptoNews(): Promise<string> {
    try {
        const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
        if (!EODHD_API_KEY) return 'No news API key available.';
        const url = `https://eodhd.com/api/news?s=BTC-USD.CC&api_token=${EODHD_API_KEY}&limit=10&fmt=json`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return 'Failed to fetch market news.';
        const data = await res.json();
        return data.map((d: any) => `- ${d.title} (${d.date}): ${d.content?.substring(0, 200)}...`).join('\n\n');
    } catch {
        return 'News fetch failed.';
    }
}

export async function generateDeepDiveReport(userId: string): Promise<DeepDiveReport | null> {
    try {
        const arena = await getArenaConfig(userId, 'CRYPTO');
        if (!arena) return null;

        // Use the active pool based on Master Portfolio setting
        const activePool = arena.masterPortfolioMode 
            ? arena.pools[0] 
            : arena.pools.find(p => p.poolId === 'POOL_MANUAL') || arena.pools[0];

        // Gather all valid tokens
        const holdings = activePool.holdings || {};
        const tickersToPrice = Object.keys(holdings);
        if (!tickersToPrice.includes('BTC')) tickersToPrice.push('BTC');

        // Fetch prices
        const currentPrices = await getVerifiedPrices(tickersToPrice, userId);

        // Filter tokens where value is > $50
        const validTickers: string[] = [];
        for (const [ticker, holding] of Object.entries(holdings)) {
            const price = currentPrices[ticker]?.price || holding.averagePrice || 0;
            const value = holding.amount * price;
            if (value > 50) {
                validTickers.push(ticker);
            }
        }

        // Always include BTC
        if (!validTickers.includes('BTC')) validTickers.push('BTC');

        // Fetch recent news
        const marketNews = await fetchCryptoNews();

        // Build Prompt for AI
        const prompt = `
You are the Chief Intelligence Analyst for the Semaphore10 Crypto Master Portfolio.
Your task is to generate a deep-dive intelligence report covering the broader market and the user's specific high-value holdings.

LATEST MARKETPLACE NEWS:
${marketNews}

HELD ASSETS TO ANALYZE (Must be included):
${validTickers.map(t => {
    const p = currentPrices[t];
    return `- ${t}: Current Price $${p?.price.toFixed(4) || 'Unknown'}, 24h Change: ${p?.change24h.toFixed(2) || '0'}%`;
}).join('\n')}

INSTRUCTIONS:
You must output ONLY valid JSON matching the following structure:
{
  "marketplaceNews": "A very detailed summary of the current market news and its direct potential impact on the token marketplace.",
  "btcReference": {
    "analysis": "A deep dive analysis of BTC as the market reference point.",
    "rating": "A F-scale grade (e.g. A, B, C, D, E, F)",
    "target24h": <number prediction>,
    "target7d": <number prediction>,
    "target30d": <number prediction>
  },
  "tokenDeepDives": [
    {
      "ticker": "<TICKER>",
      "analysis": "A comprehensive, insightful paragraph predicting what will happen for this token, factoring in BTC's trajectory.",
      "rating": "A F-scale grade",
      "target24h": <number>,
      "target7d": <number>,
      "target30d": <number>
    }
  ]
}

Ensure every token (except BTC, which is covered under btcReference) listed in the "HELD ASSETS TO ANALYZE" appears exactly once in the "tokenDeepDives" array.
Use pure data and deep strategic intuition. Provide realistic price targets.
Do NOT use markdown backticks in your response. Output raw JSON only.
`;

        const rawAiResponse = await generateContentWithFallback(prompt);
        if (!rawAiResponse) return null;

        const report = safeJsonParse<Omit<DeepDiveReport, 'generatedAt'>>(rawAiResponse);
        
        const finalReport: DeepDiveReport = {
            ...report,
            generatedAt: new Date().toISOString()
        };

        // Save to Firestore
        if (adminDb) {
            await adminDb.collection('deep_dive_reports').doc(userId).set(finalReport);
        }

        return finalReport;
    } catch (e: any) {
        console.error("Error generating deep dive report:", e.message);
        return null;
    }
}

export async function getLatestDeepDiveReport(userId: string): Promise<DeepDiveReport | null> {
    if (!adminDb) return null;
    try {
        const doc = await adminDb.collection('deep_dive_reports').doc(userId).get();
        if (doc.exists) {
            return doc.data() as DeepDiveReport;
        }
        return null;
    } catch (e) {
        return null;
    }
}
