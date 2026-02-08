"use server";

import { model, generateContentWithFallback, type CryptoAnalysisResult } from "@/lib/gemini";
import { consultCryptoAgent, type AgentConsultationResult } from "@/lib/agent";
import { type PortfolioItem } from "@/services/portfolioService";
import { AGENT_WATCHLIST } from "@/lib/constants";
import { initVirtualPortfolio, executeVirtualTrades, resetVirtualPortfolio, clearVirtualDecisions } from "@/services/virtualPortfolioAdmin";
import { adminDb, firebaseAdmin } from "@/lib/firebase-admin";

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

function safeNumber(val: any, fallback: number = 0): number {
  const num = Number(val);
  return isNaN(num) || !isFinite(num) ? fallback : num;
}

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

export async function getRealTimePrice(ticker: string) {
  try {
    const tickerUpper = ticker.toUpperCase();

    // 1. Try CoinGecko First (Best Data)
    let id = ticker.toLowerCase();

    // Basic mapping for common coins to ensure correct ID
    const tickerMap: Record<string, string> = {
      'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'ADA': 'cardano',
      'XRP': 'ripple', 'DOT': 'polkadot', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
      'GODS': 'gods-unchained', 'DOGE': 'dogecoin', 'SHIB': 'shiba-inu', 'PEPE': 'pepe',
      'MATIC': 'polygon', 'OP': 'optimism', 'ARB': 'arbitrum', 'TIA': 'celestia',
      'SUI': 'sui', 'SEI': 'sei-network', 'LTC': 'litecoin', 'NEAR': 'near',
      'ICP': 'internet-computer', 'STX': 'stacks', 'INJ': 'injective-protocol',
      'RENDER': 'render-token', 'KAS': 'kaspa', 'FET': 'fetch-ai', 'HBAR': 'hedera-hashgraph',
      'DASH': 'dash', 'MNT': 'mantle', 'LEO': 'leo-token', 'HYPE': 'hyperliquid', 'BGB': 'bitget-token'
    };

    const nameMap: Record<string, string> = {
      'GODS': 'Gods Unchained (Gaming/NFT)',
      'BTC': 'Bitcoin',
      'ETH': 'Ethereum',
      'SOL': 'Solana',
      'TIA': 'Celestia (Modular)',
      'HYPE': 'Hyperliquid'
    };

    if (tickerMap[tickerUpper]) id = tickerMap[tickerUpper];
    else {
      // Validation attempt via search if not mapped
      try {
        const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${tickerUpper}`, { headers: COMMON_HEADERS });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const match = searchData.coins.find((c: any) => c.symbol === tickerUpper);
          if (match) id = match.id;
        }
      } catch { }
    }

    const cgRes = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`, {
      headers: COMMON_HEADERS,
      next: { revalidate: 0 },
      cache: 'no-store'
    });

    let cgData = null;
    if (cgRes.ok) {
      cgData = await cgRes.json();
    }

    // 2. Fallback to Binance if CoinGecko fails (Price only)
    const binancePrice = await fetchBinancePrice(tickerUpper);

    let finalPrice = 0;
    let verificationStatus = "Unverified";
    let change24h = 0;
    let mcap = 0;
    let name = nameMap[tickerUpper] || tickerUpper;

    if (cgData && cgData.market_data) {
      finalPrice = cgData.market_data.current_price.usd;
      change24h = cgData.market_data.price_change_percentage_24h;
      mcap = cgData.market_data.market_cap.usd;
      name = cgData.name;
      verificationStatus = "CoinGecko";

      // Verification check
      if (binancePrice) {
        const diff = Math.abs((finalPrice - binancePrice) / finalPrice) * 100;
        if (diff < 2.0) {
          verificationStatus = "CoinGecko & Binance (Verified)";
        }
      }
    } else if (binancePrice) {
      finalPrice = binancePrice;
      verificationStatus = "Binance (Fallback)";
    }

    if (finalPrice === 0 || isNaN(finalPrice)) return null;

    return {
      price: safeNumber(finalPrice),
      change24h: safeNumber(change24h),
      mcap: safeNumber(mcap),
      name,
      verificationStatus
    };
  } catch (error) {
    console.warn("Pricing engine failed:", error);
    return null;
  }
}

export async function analyzeCrypto(ticker: string, historyContextString?: string): Promise<CryptoAnalysisResult> {
  try {
    const realTimeData = await getRealTimePrice(ticker);

    const historyContext = historyContextString
      ? `HISTORICAL CONTEXT: ${historyContextString}`
      : "First analysis for this asset.";

    const groundingContext = realTimeData
      ? `IMPORTANT DATA: Price: $${realTimeData.price.toFixed(realTimeData.price < 1 ? 4 : 2)}. Status: ${realTimeData.verificationStatus}. 24h: ${realTimeData.change24h?.toFixed(2)}%. Market Cap: $${realTimeData.mcap?.toLocaleString()}.`
      : "LIVE PRICING UNAVAILABLE. DO NOT TRADE.";

    const tickerName = realTimeData?.name || ticker;

    const prompt = `
      ROLE: You are an elite Crypto Quantitative Analyst. Your job is to provide a purely data-driven technical assessment of "${tickerName}" (${ticker}).
      
      MARKET DATA (ABSOLUTE TRUTH):
      ${groundingContext}
      
      HISTORICAL PERFORMANCE:
      ${historyContext}
      
      DATE: ${new Date().toLocaleDateString('en-GB')}
      
      TASK:
      1. Analyze the asset based *strictly* on standard technical indicators (RSI, MACD, MA Divergence) and On-Chain metrics (MVRV, Net Flow).
      2. SCORING RULES:
         - 0-35: STRONG SELL (Bearish momentum, broken support, overvalued).
         - 36-49: SELL / WEAK (Downtrend w/o reversal signs).
         - 50-60: NEUTRAL (Choppy, consolidation, no clear direction).
         - 61-75: BUY (Uptrend, holding support, positive volume).
         - 76-100: STRONG BUY (Breakout, high volume, key resistance cleared).
      
      3. CRITICAL INSTRUCTION:
         - Do NOT hallucinate bullish news. If price is down 5% in 24h, you cannot rate it a 70+ unless there is a massive hidden divergence. 
         - A massive Market Cap coin like BTC cannot move like a memecoin. Adjust expectations.
         - If verification status is "Unverified", automatic score penalty of -10.
      
      OUTPUT JSON:
      {
        "ticker": "${ticker}",
        "name": "Token Name", 
        "currentPrice": (Use Market Data),
        "priceChange24h": (Use Market Data),
        "trafficLight": "RED" | "AMBER" | "GREEN", 
        "overallScore": (0-100 integer),
        "summary": "2 concise sentences explaining the score based on data.",
        "signals": [
           // Generate exactly 10 Key Signals covering 4 categories: "Technical", "Fundamental", "On-Chain", "Sentiment"
           // Each weight must be a number! (e.g. 10). Total weights must sum to 100.
           { 
             "name": "RSI (14)", 
             "category": "Technical", 
             "score": (0-100), 
             "status": "RED" | "AMBER" | "GREEN", 
             "weight": (number), 
             "whyItMatters": "..." 
           }
        ]
      }
    `;

    const responseText = await generateContentWithFallback(prompt);

    // Safety check for empty response
    if (!responseText) {
      throw new Error("AI returned empty response");
    }

    const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();

    try {
      const aiResult = JSON.parse(cleanJson);

      const finalResult = {
        ...aiResult,
        ticker: ticker.toUpperCase(),
        currentPrice: safeNumber(realTimeData?.price || aiResult.currentPrice),
        priceChange24h: safeNumber(realTimeData?.change24h || aiResult.priceChange24h),
        marketCap: safeNumber(realTimeData?.mcap || aiResult.marketCap),
        overallScore: safeNumber(aiResult.overallScore),
        verificationStatus: realTimeData?.verificationStatus || "Research Only",
        historicalInsight: historyContextString || "New analysis"
      } as CryptoAnalysisResult;

      // Final validation - if price is still 0/NaN after AI fallback, reject
      if (finalResult.currentPrice <= 0) {
        throw new Error(`Invalid price detected for ${ticker}`);
      }

      return finalResult;
    } catch (e) {
      console.error("JSON Parse Error:", e, "Raw Text:", responseText);
      throw new Error("Failed to parse AI response");
    }

  } catch (error: any) {
    console.error("Analysis failed:", error);
    // Return a clean error string that can be serialized to the client
    throw new Error(error.message || "AI Analysis Failed");
  }
}

// Helper to get config server-side
async function getServerAgentConfig(userId: string) {
  if (!adminDb) return null;
  const doc = await adminDb.collection('agent_configs').doc(userId).get();

  if (doc.exists) {
    return doc.data() as {
      trafficLightTokens: string[],
      standardTokens: string[],
      lastCheck?: Record<string, string>
    };
  }

  // Default fallback if not set up yet
  return {
    trafficLightTokens: ["BTC", "ETH", "SOL"],
    standardTokens: ["XRP", "DOGE", "ADA", "DOT", "LINK", "MATIC", "AVAX"],
    lastCheck: {}
  };
}

export async function manualAgentCheckStream(userId: string, initialBalance: number = 600) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendUpdate = (msg: string) => controller.enqueue(encoder.encode(msg + "\n"));

      try {
        sendUpdate("Loading Configuration...");
        const config = await getServerAgentConfig(userId);
        if (!config) {
          sendUpdate("Error: Config missing");
          controller.close();
          return;
        }

        const { trafficLightTokens, standardTokens, lastCheck = {} } = config;
        const now = Date.now();
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        let analyzedCount = 0;
        let skippedCount = 0;

        // --- Define Retry Queue Logic ---
        interface AnalysisTask {
          ticker: string;
          type: 'Priority' | 'Standard';
          attempts: number;
        }

        const queue: AnalysisTask[] = [];

        // 1. Initial Queueing
        for (const t of trafficLightTokens) {
          queue.push({ ticker: t, type: 'Priority', attempts: 1 });
        }

        for (const t of standardTokens) {
          const lastTime = lastCheck[t.toUpperCase()] ? new Date(lastCheck[t.toUpperCase()]).getTime() : 0;
          if (now - lastTime > ONE_DAY_MS) {
            queue.push({ ticker: t, type: 'Standard', attempts: 1 });
          } else {
            skippedCount++;
            sendUpdate(`[Standard] Skipping ${t} (Recently checked)`);
          }
        }

        // 2. Process Queue with Retries at the End
        while (queue.length > 0) {
          const task = queue.shift()!;
          const retryText = task.attempts > 1 ? ` (Retry ${task.attempts - 1}/10)` : '';
          sendUpdate(`[${task.type}] Analyzing ${task.ticker}${retryText}...`);

          await new Promise(r => setTimeout(r, 1500)); // Rate limit
          const res = await manualAgentAnalyzeSingle(userId, task.ticker);

          if (res.success) {
            analyzedCount++;
            sendUpdate(`[${task.type}] ${task.ticker} Result: ${res.trafficLight} (${res.score})`);
            if (task.type === 'Standard') {
              lastCheck[task.ticker.toUpperCase()] = new Date().toISOString();
            }
          } else {
            if (task.attempts < 10) {
              sendUpdate(`[${task.type}] ${task.ticker} Failed: ${res.message}. Adding to retry queue...`);
              queue.push({ ...task, attempts: task.attempts + 1 });
            } else {
              sendUpdate(`[${task.type}] ${task.ticker} Final Failure: ${res.message} (Max retries reached)`);
            }
          }
        }

        // 3. Save updated timestamps
        if (adminDb && analyzedCount > 0) {
          sendUpdate("Saving Analysis Data...");
          await adminDb.collection('agent_configs').doc(userId).set({ lastCheck }, { merge: true });
        }

        // 4. Execute Trades (Check ALL tracked tokens for valid signals)
        sendUpdate("Evaluating Trading Strategies...");
        const allTracked = [...trafficLightTokens, ...standardTokens];
        if (analyzedCount > 0 || skippedCount > 0) {
          await manualAgentExecuteTrades(userId, initialBalance, allTracked);
          sendUpdate("DONE");
        } else {
          sendUpdate("DONE");
        }
      } catch (e: any) {
        sendUpdate(`Error: ${e.message}`);
      } finally {
        controller.close();
      }
    }
  });

  return stream;
}

// Keep old function for compatibility if needed, but it's largely superseded
export async function manualAgentCheck(userId: string, initialBalance: number = 600) {
  // Legacy support wrapper or unused
  return { success: false, message: "Use stream endpoint" };
}

export async function manualAgentAnalyzeSingle(userId: string, ticker: string) {
  if (!adminDb) return { success: false, message: "Admin SDK missing" };

  const MAX_RETRIES = 0;
  const upperTicker = ticker.toUpperCase();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const historyContext = await fetchHistoricalContext(userId, upperTicker);
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));

      const analysis = await analyzeCrypto(upperTicker, historyContext);

      if (!analysis.verificationStatus || analysis.verificationStatus.includes("Unavailable") || analysis.currentPrice === 0) {
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
      console.warn(`Analysis error for ${upperTicker}:`, e);
      if (attempt === MAX_RETRIES) return { success: false, message: e.message || "Error" };
    }
  }
  return { success: false, message: "Failed" };
}

export async function manualAgentExecuteTrades(userId: string, initialBalance: number = 600, targetTokens?: string[]) {
  if (!adminDb) return { success: false, message: "Admin SDK missing" };
  try {
    const reports: any[] = [];
    // Use passed targets or fetch default config if direct call
    let targets = targetTokens;
    if (!targets) {
      const conf = await getServerAgentConfig(userId);
      targets = [...(conf?.trafficLightTokens || []), ...(conf?.standardTokens || [])];
    }

    // Safety fallback
    if (!targets || targets.length === 0) targets = AGENT_WATCHLIST;

    const now = Date.now();

    for (const ticker of targets) {
      let snap;
      try {
        snap = await adminDb.collection('intel_reports')
          .where('userId', '==', userId)
          .where('ticker', '==', ticker.toUpperCase())
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
      } catch (e) {
        console.warn(`Fallback: Missing index for trading query (${ticker}). Sorting client-side.`);
        snap = await adminDb.collection('intel_reports')
          .where('userId', '==', userId)
          .where('ticker', '==', ticker.toUpperCase())
          .get();

        if (!snap.empty) {
          const docs = snap.docs.map(d => d.data());
          docs.sort((a, b) => (b.createdAt?.toDate?.().getTime() || 0) - (a.createdAt?.toDate?.().getTime() || 0));
          const latest = docs[0];
          if (latest && (now - (latest.createdAt?.toDate?.().getTime() || 0)) < 25 * 60 * 60 * 1000) {
            reports.push(latest);
          }
          continue;
        }
      }

      if (snap && !snap.empty) {
        const latest = snap.docs[0].data();
        if (latest && (now - (latest.createdAt?.toDate?.().getTime() || 0)) < 25 * 60 * 60 * 1000) {
          reports.push(latest);
        }
      }
    }

    if (reports.length === 0) return { success: false, message: "No active reports found." };

    // Initialize if needed (idempotent checks inside)
    await initVirtualPortfolio(userId, initialBalance);
    await executeVirtualTrades(userId, reports);
    return { success: true };
  } catch (e: any) {
    console.error("Trade execution failed:", e);
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
    return docs.map((d: any) => `Date: ${d.savedAt} | Score: ${d.overallScore}`).join(" ");
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

export async function getAgentConsultation(userId: string, portfolio: PortfolioItem[]) {
  const targets = AGENT_WATCHLIST; // Reverted to constant
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


export async function clearDecisions(userId: string) {
  try {
    const success = await clearVirtualDecisions(userId);
    return { success };
  } catch { return { success: false }; }
}
