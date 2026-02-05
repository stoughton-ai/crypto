"use server";

import { model, type CryptoAnalysisResult } from "@/lib/gemini";
import { consultCryptoAgent, type AgentConsultationResult } from "@/lib/agent";
import { type PortfolioItem } from "@/services/portfolioService";
import { AGENT_WATCHLIST } from "@/lib/constants";

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
async function getRealTimePrice(ticker: string) {
  try {
    const tickerUpper = ticker.toUpperCase();
    const tickerMap: Record<string, string> = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
      'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
      'GODS': 'gods-unchained',
    };
    let id = tickerMap[tickerUpper];
    if (!id) {
      const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${tickerUpper}`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const match = searchData.coins.find((c: any) => c.symbol === tickerUpper);
        if (match) id = match.id;
      }
    }
    if (!id) id = ticker.toLowerCase();

    // 1. Fetch from Primary (CoinGecko) and Secondary (Binance)
    const [cgRes, binancePrice] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`),
      fetchBinancePrice(tickerUpper)
    ]);

    if (!cgRes.ok) throw new Error(`CoinGecko fetch failed for ID: ${id}`);
    const cgData = await cgRes.json();
    const cgPrice = cgData.market_data.current_price.usd;

    let finalPrice = cgPrice;
    let verificationStatus = "CoinGecko";

    // 2. Cross-check logic
    if (binancePrice) {
      const diff = Math.abs((cgPrice - binancePrice) / cgPrice) * 100;
      if (diff > 1.0) {
        // DISCREPANCY DETECTED (> 1%) -> Fetch Source 3 (Kraken)
        const krakenPrice = await fetchKrakenPrice(tickerUpper);
        if (krakenPrice) {
          // Compare Kraken with both to find the consensus
          const diffCGK = Math.abs((cgPrice - krakenPrice) / cgPrice) * 100;
          const diffBinanceK = Math.abs((binancePrice - krakenPrice) / binancePrice) * 100;

          if (diffCGK < diffBinanceK && diffCGK < 1.0) {
            finalPrice = (cgPrice + krakenPrice) / 2;
            verificationStatus = "CoinGecko & Kraken (Binance outlier)";
          } else if (diffBinanceK < 1.0) {
            finalPrice = (binancePrice + krakenPrice) / 2;
            verificationStatus = "Binance & Kraken (CoinGecko outlier)";
          } else {
            finalPrice = (cgPrice + binancePrice + krakenPrice) / 3;
            verificationStatus = "Discrepancy detected; averaged across all 3 sources";
          }
        }
      } else {
        finalPrice = (cgPrice + binancePrice) / 2;
        verificationStatus = "CoinGecko & Binance";
      }
    }

    const avg7d = await fetchAveragePrice(id, 7);
    const avg30d = await fetchAveragePrice(id, 30);

    return {
      price: finalPrice,
      change24h: cgData.market_data.price_change_percentage_24h,
      ath: cgData.market_data.ath.usd,
      athDate: cgData.market_data.ath_date.usd,
      atl: cgData.market_data.atl.usd,
      atlDate: cgData.market_data.atl_date.usd,
      mcap: cgData.market_data.market_cap.usd,
      high24h: cgData.market_data.high_24h.usd,
      low24h: cgData.market_data.low_24h.usd,
      avg7d: avg7d || 0,
      avg30d: avg30d || 0,
      name: cgData.name,
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
    ...

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
    - 75-100: GREEN
    - 45-74: AMBER
    - 0-44: RED

    **HISTORICAL INSIGHT SECTION**:
    - Analyze the provided "HISTORICAL INTELLIGENCE" JSON data (if it exists).
    - Compare the current analysis with previous dates.
    - Identification of TRENDS: Is the score rising or falling? Are prices higher or lower than previous analyses?
    - If no history exists, state "First analysis for this asset - baseline established."
    - This should be a 2-3 sentence strategic observation.

    Return the result strictly in JSON format matching this structure:
    {
      "ticker": "${ticker}",
      "name": "Full Coin Name",
      "currentPrice": number (current price in USD),
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
      "verificationStatus": "${realTimeData?.verificationStatus || "Research-based (Unverified)"}",
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
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

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
  const results: Record<string, { price: number; source: string; timestamp: number }> = {};

  // limit concurrency to avoid rate limits if necessary, but 5-10 should be fine
  await Promise.all(tickers.map(async (ticker) => {
    const data = await getRealTimePrice(ticker);
    if (data) {
      results[ticker.toUpperCase()] = {
        price: data.price,
        source: data.verificationStatus,
        timestamp: Date.now()
      };
    }
  }));

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
export async function getAgentConsultation(
  portfolio: PortfolioItem[],
  providedPrices?: Record<string, { price: number; source: string; timestamp: number }>
): Promise<AgentConsultationResult> {

  // 1. Get Live Prices (Use provided or fetch new)
  let prices = providedPrices;
  if (!prices) {
    prices = await getVerifiedPrices(AGENT_WATCHLIST);
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
  // Refactor prices to simple Key-Value for the prompt to keep token count low, or pass full?
  // Let's pass full so we can return verifiedPrices with source.
  // But for the PROMPT text, we might want to simplify.
  // The agent.ts handles `marketPrices: any` and stringifies it.
  // The `verifiedPrices` return value in `agent.ts` is just `marketPrices`.
  // So if we pass the detailed object, `verifiedPrices` in the result will be detailed.
  // This is perfect for the UI.
  return await consultCryptoAgent(portfolioContext, prices);
}
