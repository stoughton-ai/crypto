"use server";

import { model, generateContentWithFallback, type CryptoAnalysisResult } from "@/lib/gemini";
import { consultCryptoAgent, type AgentConsultationResult } from "@/lib/agent";
import { type PortfolioItem } from "@/services/portfolioService";
import { AGENT_WATCHLIST } from "@/lib/constants";
import { initVirtualPortfolio, executeVirtualTrades, resetVirtualPortfolio, getAgentTargetsAdmin, updateAgentTargetsAdmin } from "@/services/virtualPortfolioAdmin";
import { adminDb, firebaseAdmin } from "@/lib/firebase-admin";

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

/**
 * Optimized: Fetch chart data once for both 7d and 30d averages
 */
async function fetchAverages(id: string) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`, {
      headers: COMMON_HEADERS,
      next: { revalidate: 0 },
      cache: 'no-store'
    });
    if (!res.ok) return { avg7d: 0, avg30d: 0 };
    const data = await res.json();
    const prices = data.prices; // [ [timestamp, price], ... ]
    if (!prices || prices.length === 0) return { avg7d: 0, avg30d: 0 };

    const now = Date.now();
    const ms7d = 7 * 24 * 60 * 60 * 1000;

    const p30d = prices.map((p: any) => p[1]);
    const p7d = prices.filter((p: any) => (now - p[0]) <= ms7d).map((p: any) => p[1]);

    const avg30d = p30d.reduce((a: number, b: number) => a + b, 0) / p30d.length;
    const avg7d = p7d.length > 0 ? (p7d.reduce((a: number, b: number) => a + b, 0) / p7d.length) : avg30d;

    return { avg7d, avg30d };
  } catch {
    return { avg7d: 0, avg30d: 0 };
  }
}

async function fetchBinancePrice(ticker: string) {
  try {
    const symbol = `${ticker.toUpperCase()}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, {
      headers: COMMON_HEADERS,
      next: { revalidate: 0 },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return null;
  }
}

async function fetchKrakenPrice(ticker: string) {
  try {
    const pair = `${ticker.toUpperCase()}USD`;
    const res = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${pair}`, {
      headers: COMMON_HEADERS,
      next: { revalidate: 0 },
      cache: 'no-store'
    });
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

export async function getRealTimePrice(ticker: string) {
  try {
    const tickerUpper = ticker.toUpperCase();
    const tickerMap: Record<string, string> = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
      'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
      'GODS': 'gods-unchained', 'DOGE': 'dogecoin', 'MATIC': 'polygon', 'OP': 'optimism',
      'ARB': 'arbitrum', 'TIA': 'celestia', 'SUI': 'sui', 'SEI': 'sei-network',
      'PEPE': 'pepe', 'SHIB': 'shiba-inu', 'LTC': 'litecoin', 'NEAR': 'near',
      'ICP': 'internet-computer', 'STX': 'stacks', 'INJ': 'injective-protocol',
      'RENDER': 'render-token', 'KAS': 'kaspa', 'FET': 'fetch-ai', 'HBAR': 'hedera-hashgraph',
      'DASH': 'dash', 'MNT': 'mantle', 'LEO': 'leo-token', 'HYPE': 'hyperliquid', 'BGB': 'bitget-token'
    };

    let id = tickerMap[tickerUpper];
    if (!id) {
      try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${tickerUpper}`, { headers: COMMON_HEADERS });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const match = searchData.coins.find((c: any) => c.symbol === tickerUpper);
          if (match) id = match.id;
        }
      } catch (e) { }
    }
    if (!id) id = ticker.toLowerCase();

    // Fetch primary data
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, {
      headers: COMMON_HEADERS,
      next: { revalidate: 0 },
      cache: 'no-store'
    }).catch(() => null);

    const cgData = cgRes && cgRes.ok ? await cgRes.json() : null;
    const binancePrice = await fetchBinancePrice(tickerUpper);

    let finalPrice = 0;
    let verificationStatus = "Unverified";
    let change24h = 0;
    let high24h = 0;
    let low24h = 0;
    let mcap = 0;
    let ath = 0;
    let atl = 0;
    let name = tickerUpper;
    let cgIdUsed = id;

    if (cgData && cgData.market_data) {
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
        if (diff < 1.0) {
          finalPrice = (cgPrice + binancePrice) / 2;
          verificationStatus = "CoinGecko & Binance";
        } else {
          const krakenPrice = await fetchKrakenPrice(tickerUpper);
          if (krakenPrice && Math.abs((cgPrice - krakenPrice) / cgPrice) < 1.0) {
            finalPrice = (cgPrice + krakenPrice) / 2;
            verificationStatus = "CoinGecko & Kraken";
          } else {
            finalPrice = binancePrice;
            verificationStatus = "Binance (Exch)";
          }
        }
      } else {
        finalPrice = cgPrice;
        verificationStatus = "CoinGecko";
      }
    } else if (binancePrice) {
      finalPrice = binancePrice;
      verificationStatus = "Binance";
    } else {
      const krakenPrice = await fetchKrakenPrice(tickerUpper);
      if (krakenPrice) {
        finalPrice = krakenPrice;
        verificationStatus = "Kraken";
      } else {
        // Source 4: CoinCap
        try {
          console.log(`[Pricing] Trying CoinCap fallback for ${tickerUpper} (ID: ${cgIdUsed})`);
          const capRes = await fetch(`https://api.coincap.io/v2/assets/${cgIdUsed}`, {
            headers: COMMON_HEADERS,
            next: { revalidate: 0 },
            cache: 'no-store'
          });
          if (capRes.ok) {
            const capData = await capRes.json();
            if (capData.data?.priceUsd) {
              finalPrice = parseFloat(capData.data.priceUsd);
              verificationStatus = "CoinCap (Fallback)";
              change24h = parseFloat(capData.data.changePercent24Hr) || 0;
              console.log(`[Pricing] CoinCap Success for ${tickerUpper}: $${finalPrice}`);
            }
          } else {
            console.warn(`[Pricing] CoinCap returned ${capRes.status} for ${tickerUpper}`);
          }
        } catch (e) {
          console.warn(`[Pricing] CoinCap Error for ${tickerUpper}:`, e);
        }
      }
    }

    if (finalPrice === 0) {
      console.warn(`[Pricing] All sources failed for ${tickerUpper}. Verification Status: ${verificationStatus}`);
      return null;
    }

    // Optimization: Only fetch averages if we have a valid ID and aren't hitting rate limits hard
    const averages = (verificationStatus.includes("CoinGecko")) ? await fetchAverages(cgIdUsed) : { avg7d: 0, avg30d: 0 };

    return {
      price: finalPrice,
      change24h,
      ath,
      athDate: cgData?.market_data?.ath_date?.usd || "N/A",
      atl,
      atlDate: cgData?.market_data?.atl_date?.usd || "N/A",
      mcap,
      high24h,
      low24h,
      avg7d: averages.avg7d || 0,
      avg30d: averages.avg30d || 0,
      name,
      verificationStatus
    };
  } catch (error) {
    console.warn("Pricing engine failed:", error);
    return null;
  }
}

export async function analyzeCrypto(ticker: string, historyContextString?: string): Promise<CryptoAnalysisResult> {
  const realTimeData = await getRealTimePrice(ticker);

  const historyContext = historyContextString
    ? `HISTORICAL CONTEXT: ${historyContextString}`
    : "First analysis for this asset.";

  const groundingContext = realTimeData
    ? `IMPORTANT DATA: Price: $${realTimeData.price.toFixed(realTimeData.price < 1 ? 4 : 2)}. Status: ${realTimeData.verificationStatus}. 24h: ${realTimeData.change24h?.toFixed(2)}%. High: ${realTimeData.high24h}. Low: ${realTimeData.low24h}. 7dAvg: ${realTimeData.avg7d}. 30dAvg: ${realTimeData.avg30d}. ATH: ${realTimeData.ath}. ATL: ${realTimeData.atl}.`
    : "LIVE PRICING UNAVAILABLE. DO NOT TRADE.";

  const prompt = `
    Analyze ticker "${ticker}". 
    \${groundingContext}
    \${historyContext}
    
    Current Date: \${new Date().toLocaleDateString('en-GB')}
    
    Provide 10 signals (Tokenomics, MVRV, RSI, Sentiment, MA 50/200, Active Addresses, Dev Activity, Net Flow, Volume, FDV).
    Return JSON: { ticker, name, currentPrice, priceChange24h, price7dAvg, price30dAvg, dailyHigh, dailyLow, allTimeHigh, athDate, allTimeLow, atlDate, marketCap, verificationStatus, trafficLight, overallScore, signals: [{ name, category, weight, score, status, whyItMatters }], summary, historicalInsight }
    CRITICAL: If IMPORTANT DATA says 0 or UNAVAILABLE, set currentPrice to 0.
  `;

  try {
    const responseText = await generateContentWithFallback(prompt);
    const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleanJson) as CryptoAnalysisResult;
  } catch (error) {
    console.error("Analysis failed:", error);
    throw new Error("AI Analysis Failed");
  }
}

export async function manualAgentAnalyzeSingle(userId: string, ticker: string) {
  if (!adminDb) return { success: false, message: "Admin SDK missing" };

  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const historyContext = await fetchHistoricalContext(userId, ticker);
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));

      const analysis = await analyzeCrypto(ticker, historyContext);

      if (analysis.verificationStatus.includes("Unavailable") || analysis.currentPrice === 0) {
        if (attempt === MAX_RETRIES) return { success: false, message: "Price Verification Failed" };
        continue;
      }

      await adminDb.collection('intel_reports').add({
        ...analysis,
        userId: userId,
        savedAt: new Date().toISOString(),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        generatedBy: "ManualTrigger"
      });

      await enforceLibraryLimit(userId);
      return { success: true, score: analysis.overallScore, trafficLight: analysis.trafficLight };
    } catch (e: any) {
      if (attempt === MAX_RETRIES) return { success: false, message: e.message || "Error" };
    }
  }
  return { success: false, message: "Failed" };
}

export async function manualAgentExecuteTrades(userId: string, initialBalance: number = 600) {
  if (!adminDb) return { success: false, message: "Admin SDK missing" };
  try {
    const reports: any[] = [];
    const targets = await getAgentTargetsAdmin(userId);
    const now = Date.now();

    for (const ticker of targets) {
      const snap = await adminDb.collection('intel_reports')
        .where('userId', '==', userId)
        .where('ticker', '==', ticker.toUpperCase())
        .get();

      if (!snap.empty) {
        const docs = snap.docs.map(d => d.data());
        docs.sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
        const latest = docs[0];
        if (latest && (now - (latest.createdAt?.toDate?.().getTime() || 0)) < 40 * 60 * 1000) {
          reports.push(latest);
        }
      }
    }

    if (reports.length === 0) return { success: false, message: "No fresh reports found." };
    await initVirtualPortfolio(userId, initialBalance);
    await executeVirtualTrades(userId, reports);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

async function fetchHistoricalContext(userId: string, ticker: string): Promise<string> {
  if (!adminDb) return "";
  try {
    const snap = await adminDb.collection('intel_reports')
      .where('userId', '==', userId)
      .where('ticker', '==', ticker.toUpperCase())
      .limit(20)
      .get();
    if (snap.empty) return "";
    const docs = snap.docs.map(d => d.data()).sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0)).slice(0, 3);
    return docs.map((d: any) => `Date: \${d.savedAt} | Score: \${d.overallScore}`).join(" ");
  } catch { return ""; }
}

export async function resetAIChallenge(userId: string, initialAmount: number = 600) {
  try {
    const success = await resetVirtualPortfolio(userId, initialAmount);
    return { success, message: success ? "Reset OK" : "Reset Failed" };
  } catch { return { success: false, message: "Error" }; }
}

async function enforceLibraryLimit(userId: string) {
  if (!adminDb) return;
  try {
    const snap = await adminDb.collection('intel_reports').where('userId', '==', userId).select('createdAt').get();
    if (snap.size <= 500) return;
    const docs = snap.docs.map(d => ({ id: d.id, t: d.data().createdAt?.toDate?.().getTime() || 0 }));
    docs.sort((a, b) => a.t - b.t);
    const batch = adminDb.batch();
    docs.slice(0, docs.length - 500).forEach(d => batch.delete(adminDb!.collection('intel_reports').doc(d.id)));
    await batch.commit();
  } catch { }
}

export async function getAgentTargets(userId: string) { return await getAgentTargetsAdmin(userId); }
export async function updateAgentTargets(userId: string, targets: string[]) { return await updateAgentTargetsAdmin(userId, targets); }
export async function getAgentConsultation(userId: string, portfolio: PortfolioItem[]) {
  const targets = await getAgentTargetsAdmin(userId);
  const prices = await getVerifiedPrices(targets);
  const context = portfolio.map(p => ({ ticker: p.ticker, amount: p.amount, currentPrice: prices[p.ticker]?.price || 0 }));
  return await consultCryptoAgent(context, prices, targets);
}
export async function getVerifiedPrices(tickers: string[]) {
  const res: Record<string, any> = {};
  for (const t of tickers) {
    const d = await getRealTimePrice(t);
    if (d) res[t.toUpperCase()] = { price: d.price, source: d.verificationStatus, timestamp: Date.now() };
  }
  return res;
}
export async function deleteLegacyFile() { return true; }
export async function getSimplePrices(tickers: string[]) {
  const prices: Record<string, number> = {};
  // Reuse the robust engine but return simple format
  const verified = await getVerifiedPrices(tickers);
  for (const t in verified) {
    prices[t] = verified[t].price;
  }
  return prices;
}

export async function getLegacyReports() {
  // Simple empty return as we are moving away from local JSON
  return [];
}

export async function manualAgentCheck(userId: string, initialBalance: number = 600) {
  // Wrapper for compatibility
  const targets = await getAgentTargetsAdmin(userId);
  let successCount = 0;
  for (const t of targets) {
    const res = await manualAgentAnalyzeSingle(userId, t);
    if (res.success) successCount++;
  }
  if (successCount > 0) {
    await manualAgentExecuteTrades(userId, initialBalance);
    return { success: true };
  }
  return { success: false };
}
