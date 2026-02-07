"use server";

import { model, generateContentWithFallback, type CryptoAnalysisResult } from "@/lib/gemini";
import { consultCryptoAgent, type AgentConsultationResult } from "@/lib/agent";
import { type PortfolioItem } from "@/services/portfolioService";
import { AGENT_WATCHLIST } from "@/lib/constants";
import { initVirtualPortfolio, executeVirtualTrades, resetVirtualPortfolio } from "@/services/virtualPortfolioAdmin";

/**
 * Source 1: CoinGecko (Historical + Metadata + Price)
 */
async function fetchAveragePrice(id: string, days: number) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
    if (!res.ok) return null;
    const data = await res.json();
    const prices = data.prices;
    if (!prices || prices.length === 0) return null;
    const sum = prices.reduce((acc: number, curr: any) => acc + curr[1], 0);
    return sum / prices.length;
  } catch {
    return null;
  }
}

/**
 * Source 2: Binance (Direct Spot Price)
 */
async function fetchBinancePrice(ticker: string) {
  try {
    const symbol = `${ticker.toUpperCase()}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

/**
 * Source 3: Kraken (Direct Spot Price)
 */
async function fetchKrakenPrice(ticker: string) {
  try {
    const pair = `${ticker.toUpperCase()}USD`;
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`);
    if (!res.ok) return null;
    const data = await res.json();
    const keys = Object.keys(data.result);
    if (keys.length === 0) return null;
    const result = data.result[keys[0]];
    return parseFloat(result.c[0]);
  } catch {
    return null;
  }
}

/**
 * Fetch and verify real-time price data from multiple providers.
 */
export async function getRealTimePrice(ticker: string) {
  try {
    const tickerUpper = ticker.toUpperCase();

    // Expanded map for high-reliability mapping
    const tickerMap: Record<string, string> = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
      'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
      'GODS': 'gods-unchained', 'DOGE': 'dogecoin', 'MATIC': 'polygon', 'OP': 'optimism',
      'ARB': 'arbitrum', 'TIA': 'celestia', 'SUI': 'sui', 'SEI': 'sei-network',
      'PEPE': 'pepe', 'SHIB': 'shiba-inu', 'LTC': 'litecoin', 'NEAR': 'near',
      'ICP': 'internet-computer', 'STX': 'stack', 'INJ': 'injective-protocol',
      'RENDER': 'render-token', 'KAS': 'kaspa', 'FET': 'fetch-ai', 'HBAR': 'hedera-hashgraph',
      'DASH': 'dash', 'MNT': 'mantle', 'LEO': 'unus-sed-leo', 'HYPE': 'hyperliquid'
    };

    let id = tickerMap[tickerUpper];
    if (!id) {
      try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${tickerUpper}`, { next: { revalidate: 3600 } });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const match = searchData.coins.find((c: any) => c.symbol === tickerUpper);
          if (match) id = match.id;
        }
      } catch (e) {
        console.warn(`ID Search failed for ${tickerUpper}`);
      }
    }
    if (!id) id = ticker.toLowerCase();

    // Parallel fetch with individual error handling
    const [cgData, binancePrice] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
      fetchBinancePrice(tickerUpper)
    ]);

    let finalPrice = 0;
    let verificationStatus = "Unverified";
    let change24h = 0;
    let high24h = 0;
    let low24h = 0;
    let mcap = 0;
    let ath = 0;
    let atl = 0;
    let name = tickerUpper;

    if (cgData) {
      const cgPrice = cgData.market_data.current_price.usd;
      change24h = cgData.market_data.price_change_percentage_24h;
      high24h = cgData.market_data.high_24h.usd;
      low24h = cgData.market_data.low_24h.usd;
      mcap = cgData.market_data.market_cap.usd;
      ath = cgData.market_data.ath.usd;
      atl = cgData.market_data.atl.usd;
      name = cgData.name;

      if (binancePrice) {
        const diff = Math.abs((cgPrice - binancePrice) / cgPrice) * 100;
        if (diff > 1.0) {
          const krakenPrice = await fetchKrakenPrice(tickerUpper);
          if (krakenPrice) {
            const diffCGK = Math.abs((cgPrice - krakenPrice) / cgPrice) * 100;
            const diffBinanceK = Math.abs((binancePrice - krakenPrice) / binancePrice) * 100;

            if (diffCGK < diffBinanceK && diffCGK < 1.0) {
              finalPrice = (cgPrice + krakenPrice) / 2;
              verificationStatus = "CoinGecko & Kraken";
            } else if (diffBinanceK < 1.0) {
              finalPrice = (binancePrice + krakenPrice) / 2;
              verificationStatus = "Binance & Kraken";
            } else {
              finalPrice = (cgPrice + binancePrice + krakenPrice) / 3;
              verificationStatus = "Consensus (CG/Binance/Kraken)";
            }
          } else {
            finalPrice = (cgPrice + binancePrice) / 2;
            verificationStatus = "CoinGecko & Binance";
          }
        } else {
          finalPrice = (cgPrice + binancePrice) / 2;
          verificationStatus = "CoinGecko & Binance";
        }
      } else {
        finalPrice = cgPrice;
        verificationStatus = "CoinGecko";
      }
    } else if (binancePrice) {
      finalPrice = binancePrice;
      verificationStatus = "Binance";
      const krakenPrice = await fetchKrakenPrice(tickerUpper);
      if (krakenPrice) {
        finalPrice = (binancePrice + krakenPrice) / 2;
        verificationStatus = "Binance & Kraken";
      }
    } else {
      const krakenPrice = await fetchKrakenPrice(tickerUpper);
      if (krakenPrice) {
        finalPrice = (krakenPrice);
        verificationStatus = "Kraken";
      } else {
        // Source 4: CoinCap (Fallback for rate limits)
        try {
          const capRes = await fetch(`https://api.coincap.io/v2/assets/${id || ticker.toLowerCase()}`);
          if (capRes.ok) {
            const capData = await capRes.json();
            if (capData.data?.priceUsd) {
              finalPrice = parseFloat(capData.data.priceUsd);
              verificationStatus = "CoinCap (Fallback)";
              change24h = parseFloat(capData.data.changePercent24Hr) || 0;
              mcap = parseFloat(capData.data.marketCapUsd) || 0;
            }
          }
        } catch (e) {
          console.warn("CoinCap fallback failed", e);
        }
      }
    }

    if (finalPrice === 0) return null;

    const idForAverages = id || ticker.toLowerCase();
    const avg7d = await fetchAveragePrice(idForAverages, 7);
    const avg30d = await fetchAveragePrice(idForAverages, 30);

    return {
      price: finalPrice,
      change24h,
      ath,
      athDate: cgData?.market_data.ath_date.usd || "N/A",
      atl,
      atlDate: cgData?.market_data.atl_date.usd || "N/A",
      mcap,
      high24h,
      low24h,
      avg7d: avg7d || 0,
      avg30d: avg30d || 0,
      name,
      verificationStatus
    };
  } catch (error) {
    console.warn("Pricing verification engine failed:", error);
    return null;
  }
}

/**
 * Perform a deep research analysis on a crypto ticker using Gemini with Google Search grounding.
 */
export async function analyzeCrypto(ticker: string, historyContextString?: string): Promise<CryptoAnalysisResult> {
  const [realTimeData] = await Promise.all([
    getRealTimePrice(ticker),
  ]);

  const historyContext = historyContextString
    ? `HISTORICAL CONTEXT FROM YOUR LIBRARY: ${historyContextString}`
    : "This is the first time you are analyzing this asset for the user's library.";

  const groundingContext = realTimeData
    ? `IMPORTANT FACTUAL DATA: The current real-time price of ${realTimeData.name} is $${realTimeData.price.toFixed(realTimeData.price < 1 ? 4 : 2)}. 
       Verification Status: ${realTimeData.verificationStatus}.
       24h Change: ${realTimeData.change24h}%. Market Cap: $${realTimeData.mcap}.
       24h HIGH: $${realTimeData.high24h?.toFixed(realTimeData.high24h < 1 ? 4 : 2) || "N/A"}.
       24h LOW: $${realTimeData.low24h?.toFixed(realTimeData.low24h < 1 ? 4 : 2) || "N/A"}.
       7-Day AVERAGE Price: ${realTimeData.avg7d > 0 ? `$${realTimeData.avg7d.toFixed(realTimeData.avg7d < 1 ? 4 : 2)}` : "DATA NOT AVAILABLE"}.
       30-Day AVERAGE Price: ${realTimeData.avg30d > 0 ? `$${realTimeData.avg30d.toFixed(realTimeData.avg30d < 1 ? 4 : 2)}` : "DATA NOT AVAILABLE"}.
       ATH: $${realTimeData.ath.toFixed(realTimeData.ath < 1 ? 4 : 2)} (Date: ${realTimeData.athDate}). 
       ATL: $${realTimeData.atl.toFixed(realTimeData.atl < 1 ? 4 : 2)} (Date: ${realTimeData.atlDate}). 
       YOU MUST USE THESE EXACT NUMBERS for all price and average fields. If a field says DATA NOT AVAILABLE, set its value to 0 in your JSON.`
    : "";

  const prompt = `
    Analyze the cryptocurrency with the ticker "${ticker}" based on the following 10 research signals.
    ${groundingContext}
    
    HISTORICAL INTELLIGENCE (FROM USER LIBRARY):
    ${historyContext || "No prior research found for this asset."}
    
    You MUST search for real-time data or recent reports from the last 30 days to calculate technical levels.
    
    Current Date: ${new Date().toLocaleDateString('en-GB')}
    
    The 10 signals and their weights are:
    1. Fundamental: Tokenomics (Supply & Demand) - 15%
    2. Fundamental: MVRV Z-Score - 15%
    3. Technical: Relative Strength Index (RSI) - 10%
    4. Sentiment: Fear & Greed Index (Overall market & asset specific if possible) - 10%
    5. Technical: Moving Averages (50/200 Day) - 10%
    6. Fundamental: Active Addresses - 10%
    7. Fundamental: Developer Activity (GitHub commits, upgrades) - 10%
    8. On-Chain: Exchange Net Flow (Whale movements) - 10%
    9. Technical: Volume (Confirmation of price moves) - 5%
    10. Fundamental: Market Cap vs. FDV (Hidden inflation check) - 5%

    For each signal:
    - Provide a score from 0 to 100.
    - Provide a status: GREEN (Bullish/Safe), AMBER (Neutral/Wait), or RED (Bearish/Danger).
    - Provide a concise "Why it matters" explanation based on current data.

    Finally, calculate an overall weighted score (0-100) and assign a Traffic Light:
    - 66-100: GREEN
    - 50-65: AMBER
    - 0-49: RED

    **HISTORICAL INSIGHT SECTION**:
    - Analyze the provided "HISTORICAL INTELLIGENCE" JSON data (if it exists).
    - Compare the current analysis with previous dates.
    - Identification of TRENDS: Is the score rising or falling? Are prices higher or lower than previous analyses?
    - If no history exists, state "First analysis for this asset - baseline established."
    - This should be a 2-3 sentence strategic observation.

    Return the result strictly in JSON format matching this structure:
    {
      "ticker": "${ticker}",
      "name": "${realTimeData?.name || ticker}",
      "currentPrice": number (YOU MUST USE THE EXACT REAL-TIME PRICE PROVIDED ABOVE),
      "priceChange24h": number (percentage change),
      "price7dAvg": number (average price over 7 days),
      "price30dAvg": number (average price over 30 days),
      "dailyHigh": number (highest price in last 24h),
      "dailyLow": number (lowest price in last 24h),
      "allTimeHigh": number (highest price ever),
      "athDate": "YYYY-MM-DD",
      "allTimeLow": number (lowest price ever),
      "atlDate": "YYYY-MM-DD",
      "marketCap": number (current market cap in USD),
      "verificationStatus": "${realTimeData?.verificationStatus || "Live Pricing Unavailable"}",
      "trafficLight": "GREEN" | "AMBER" | "RED",
      "overallScore": number,
      "signals": [
        {
          "name": "Tokenomics",
          "category": "Fundamental",
          "weight": 15,
          "score": number,
          "status": "GREEN" | "AMBER" | "RED",
          "whyItMatters": "..."
        },
        ... (all 10 signals)
      ],
      "summary": "Short 2-3 sentence executive summary.",
      "historicalInsight": "Your trend analysis here..."
    }

    CRITICAL: If the currentPrice provided in IMPORTANT FACTUAL DATA is 0 or missing, you MUST return a currentPrice of 0. NEVER guess or provide approximate historical prices from your training data.
  `;

  try {
    const responseText = await generateContentWithFallback(prompt);

    // Clean up the response if it contains markdown code blocks
    const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const finalResult = JSON.parse(cleanJson) as CryptoAnalysisResult;

    return finalResult;
  } catch (error) {
    console.error("Analysis failed:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`AI Analysis Failed: ${errorMessage}`);
  }
}

/**
 * Migration helper: loads local JSON data for one-time move to cloud.
 */
export async function getLegacyReports() {
  const fs = require('fs/promises');
  const path = require('path');
  const legacyPath = path.join(process.cwd(), "data", "reports.json");
  try {
    const data = await fs.readFile(legacyPath, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Fetch basic price data for a list of tickers (for Portfolio valuation)
 */
export async function getSimplePrices(tickers: string[]) {
  const prices: Record<string, number> = {};

  await Promise.all(tickers.map(async (ticker) => {
    // Try Binance first as it's fastest and reliable for major pairs
    // EXCEPT for mapped tokens where we prefer CoinGecko ID
    const tickerMap: Record<string, string> = {
      'GODS': 'gods-unchained',
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
      'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
      'LTC': 'litecoin', 'SHIB': 'shiba-inu', 'PEPE': 'pepe', 'DASH': 'dash',
      'HBAR': 'hedera-hashgraph', 'MNT': 'mantle', 'LEO': 'unus-sed-leo', 'HYPE': 'hyperliquid'
    };

    const mappedId = tickerMap[ticker.toUpperCase()];
    if (mappedId) {
      try {
        const pRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${mappedId}&vs_currencies=usd`);
        const pData = await pRes.json();
        if (pData[mappedId]?.usd) {
          prices[ticker.toUpperCase()] = pData[mappedId].usd;
          return; // Skip Binance if mapped ID worked
        }
      } catch (e) {
        console.warn(`Mapped fetch failed for ${ticker}, trying Binance...`);
      }
    }

    const bPrice = await fetchBinancePrice(ticker);
    if (bPrice) {
      prices[ticker.toUpperCase()] = bPrice;
    } else {
      // Fallback to CoinGecko search for obscure coins
      try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${ticker}`);
        const searchData = await searchRes.json();
        const coin = searchData.coins[0];
        if (coin) {
          const pRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd`);
          const pData = await pRes.json();
          prices[ticker.toUpperCase()] = pData[coin.id].usd;
        }
      } catch (e) {
        console.error(`Failed to fetch price for ${ticker}`, e);
      }
    }
  }));

  return prices;
}

/**
 * Robustly fetch prices for portfolio revaluation using the multi-source verification engine.
 */
export async function getVerifiedPrices(tickers: string[]) {
  const results: Record<string, {
    price: number;
    source: string;
    timestamp: number;
    high24h?: number;
    low24h?: number;
    change24h?: number;
  }> = {};

  const MAX_ATTEMPTS = 3;

  for (const ticker of tickers) {
    let data = null;

    // Exhaustive retry chain using direct exchange APIs ONLY
    // We avoid AI fallbacks for "total accuracy" as requested
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      data = await getRealTimePrice(ticker);
      if (data) break;

      // Exponential backoff to clear rate limits
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }

    if (data) {
      results[ticker.toUpperCase()] = {
        price: data.price,
        source: data.verificationStatus,
        timestamp: Date.now(),
        high24h: data.high24h,
        low24h: data.low24h,
        change24h: data.change24h
      };
    }
  }

  return results;
}

/**
 * Cleanup helper: deletes local file after migration.
 */
export async function deleteLegacyFile() {
  const fs = require('fs/promises');
  const path = require('path');
  const legacyPath = path.join(process.cwd(), "data", "reports.json");
  try {
    await fs.unlink(legacyPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Agent Consultation Action
 */
import { getAgentTargetsAdmin, updateAgentTargetsAdmin } from "@/services/virtualPortfolioAdmin";

export async function getAgentTargets(userId: string) {
  return await getAgentTargetsAdmin(userId);
}

export async function updateAgentTargets(userId: string, targets: string[]) {
  return await updateAgentTargetsAdmin(userId, targets);
}

export async function getAgentConsultation(
  userId: string,
  portfolio: PortfolioItem[],
  providedPrices?: Record<string, { price: number; source: string; timestamp: number }>
): Promise<AgentConsultationResult> {

  // 1. Get Live Prices (Use provided or fetch new)
  const targets = await getAgentTargetsAdmin(userId);
  let prices = providedPrices;
  if (!prices) {
    prices = await getVerifiedPrices(targets);
  }

  // 2. Prepare Context
  const portfolioContext = portfolio.map(p => {
    const marketData = prices![p.ticker];
    const currentPrice = marketData ? marketData.price : 0;

    return {
      ticker: p.ticker,
      amount: p.amount,
      avgPrice: p.averagePrice,
      currentValue: currentPrice * p.amount,
      pnl: (currentPrice - p.averagePrice) * p.amount
    };
  });

  // 3. Consult Agent
  return await consultCryptoAgent(portfolioContext, prices, targets);
}

/**
 * Manually trigger the AI Agent to analyze the market and trade for the Virtual Portfolio.
 * Useful for the initial kickstart or testing.
 */
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Manually trigger the AI Agent to analyze the market, SAVE reports, and trade.
 * This mirrors the Cron logic for user-initiated checks.
 */
/**
 * Analyzes a SINGLE asset.
 * allow the frontend to call this in a loop for progress tracking.
 */
export async function manualAgentAnalyzeSingle(userId: string, ticker: string) {
  if (!adminDb) return { success: false, message: "Admin SDK missing" };

  const MAX_RETRIES = 1; // Client handles loop now

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const historyContext = await fetchHistoricalContext(userId, ticker);

      // Artificial delay on retries to let API cool down
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }

      const analysis = await analyzeCrypto(ticker, historyContext);

      if (analysis.verificationStatus.toLowerCase().includes("research") || analysis.currentPrice === 0) {
        if (attempt === MAX_RETRIES) {
          return { success: false, message: `Price Verification Failed (${analysis.verificationStatus})` };
        }
        continue;
      }

      // ONLY SAVE IF VERIFIED & PRICE > 0
      try {
        await adminDb.collection('intel_reports').add({
          ...analysis,
          userId: userId,
          savedAt: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp(),
          generatedBy: "ManualTrigger"
        });

        // Enforce 500 report limit (recycle oldest)
        await enforceLibraryLimit(userId);
        return {
          success: true,
          score: analysis.overallScore,
          signal: analysis.trafficLight,
          price: analysis.currentPrice,
          verificationStatus: analysis.verificationStatus,
          fullAnalysis: analysis
        };
      } catch (e) {
        console.error("Failed to save report to library", e);
        return { success: false, message: "Database Save Error" };
      }
    } catch (e) {
      console.warn(`Analysis attempt ${attempt + 1} failed for ${ticker}:`, e);
      if (attempt === MAX_RETRIES) {
        return { success: false, message: "Analysis Error after retries" };
      }
    }
  }
  return { success: false, message: "Unknown Error" };
}

/**
 * Executes trades based on recent reports (last 15 mins).
 */
export async function manualAgentExecuteTrades(userId: string, initialBalance: number = 600) {
  if (!adminDb) return { success: false };

  try {
    // Fetch recent reports (created in last 20 mins) to trade on
    const analysisResults: any[] = [];
    const MAX_LOOKBACK_MS = 20 * 60 * 1000; // 20 minutes

    const targets = await getAgentTargetsAdmin(userId);

    for (const ticker of targets) {
      const reportsRef = adminDb.collection('intel_reports');
      const snapshot = await reportsRef
        .where('userId', '==', userId)
        .where('ticker', '==', ticker.toUpperCase())
        .get();

      if (!snapshot.empty) {
        // In-memory sort to find latest
        const docs = snapshot.docs.map(d => d.data());
        docs.sort((a, b) => {
          const tA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
          const tB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
          return tB - tA; // Descending
        });

        const latest = docs[0];
        if (latest && latest.createdAt) {
          const createdTime = latest.createdAt.toDate ? latest.createdAt.toDate().getTime() : new Date(latest.createdAt).getTime();
          if ((Date.now() - createdTime) < MAX_LOOKBACK_MS) {
            analysisResults.push(latest);
          }
        }
      }
    }

    if (analysisResults.length === 0) return { success: false, message: "No fresh reports found." };

    // Execute Trades
    await initVirtualPortfolio(userId, initialBalance);
    await executeVirtualTrades(userId, analysisResults);

    return { success: true };
  } catch (e) {
    console.error("Trade Execution Error", e);
    return { success: false };
  }
}

/**
 * Legacy wrapper for backward compatibility or bulk runs if needed.
 */
export async function manualAgentCheck(userId: string, initialBalance: number = 600) {
  // Use the new granular functions
  let successCount = 0;
  const targets = await getAgentTargetsAdmin(userId);
  for (const ticker of targets) {
    const res = await manualAgentAnalyzeSingle(userId, ticker);
    if (res.success) successCount++;
  }

  if (successCount > 0) {
    await manualAgentExecuteTrades(userId, initialBalance);
    return { success: true, message: "Cycle Complete" };
  }
  return { success: false, message: "Failed" };
}

/**
 * Helper to get historical context for the AI from Firestore (Admin SDK).
 */
async function fetchHistoricalContext(userId: string, ticker: string): Promise<string> {
  if (!adminDb) return "";

  try {
    const reportsRef = adminDb.collection('intel_reports');
    // Fetch all reports for this user/ticker without strict ordering to avoid index requirements
    const snapshot = await reportsRef
      .where('userId', '==', userId)
      .where('ticker', '==', ticker.toUpperCase())
      .get();

    if (snapshot.empty) return "";

    // Client-side sort and limit
    const docs = snapshot.docs.map(doc => doc.data())
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt.toDate ? a.createdAt.toDate() : a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt.toDate ? b.createdAt.toDate() : b.createdAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, 3);

    const history = docs.map((data: any) => {
      return `Date: ${new Date(data.savedAt).toLocaleDateString()} | Price: $${data.currentPrice} | Score: ${data.overallScore} | Signal: ${data.trafficLight}`;
    }).join("\n");

    return history;
  } catch (error) {
    console.warn(`Failed to fetch history for ${ticker}:`, error);
    return "";
  }
}

export async function resetAIChallenge(userId: string, initialAmount: number = 600) {
  try {
    const success = await resetVirtualPortfolio(userId, initialAmount);
    if (success) {
      return { success: true, message: "AI Challenge reset successfully." };
    }
    return { success: false, message: "Failed to reset challenge." };
  } catch (e) {
    return { success: false, message: "Error resetting challenge." };
  }
}

/**
 * Enforce a strict limit of 500 reports in the user's library.
 * This function deletes the oldest reports exceeding the limit.
 */
async function enforceLibraryLimit(userId: string) {
  if (!adminDb) return;
  const LIMIT = 500;

  try {
    const reportsRef = adminDb.collection('intel_reports');

    // Fetch minimal data (just createdAt) for ALL user reports
    // Client-side sorting is acceptable for <1000 items and avoids complex indexes
    const snapshot = await reportsRef
      .where('userId', '==', userId)
      .select('createdAt')
      .get();

    if (snapshot.size <= LIMIT) return;

    // Sort logic: Oldest first (ASC)
    const docs = snapshot.docs.map(doc => ({
      id: doc.id,
      createdAt: doc.data().createdAt
    }));

    docs.sort((a, b) => {
      const tA = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt).getTime()) : 0;
      const tB = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt).getTime()) : 0;
      return tA - tB;
    });

    const excess = docs.length - LIMIT;
    // The first 'excess' items are the oldest
    const toDelete = docs.slice(0, excess);

    if (toDelete.length > 0) {
      const batch = adminDb.batch();
      toDelete.forEach(doc => {
        batch.delete(reportsRef.doc(doc.id));
      });
      await batch.commit();
      console.log(`Recycled ${toDelete.length} old reports for user ${userId}`);
    }
  } catch (e) {
    console.warn("Failed to enforce library limit", e);
  }
}
