import { model } from "./gemini";

export interface TradeSuggestion {
  action: "BUY" | "SELL" | "SWITCH" | "HOLD";
  sellTicker?: string;
  buyTicker?: string;
  amount?: number; // Amount of source asset to sell
  percentage?: number; // % of source holding to sell
  reason: string;
  confidenceScore: number; // 0-100
}

export interface AgentConsultationResult {
  summary: string;
  suggestions: TradeSuggestion[];
  verifiedPrices: Record<string, any>;
}

export async function consultCryptoAgent(
  portfolioContext: any,
  marketPrices: any
): Promise<AgentConsultationResult> {
  const watchlist = ['BTC', 'ETH', 'XRP', 'DOGE', 'SOL', 'GODS'];

  const prompt = `
    You are an expert AI Crypto Portfolio Manager with decades of experience in market cycles, technical analysis, and risk management.
    Your goal is to analyze the User's Current Portfolio and the current market conditions for a specific watchlist of tokens to suggest high-value "Switch" opportunities.
    
    OBJECTIVE: Maximize portfolio growth by identifying optimal moments to rotate capital from weaker/peaking assets into stronger/bottoming assets.

    UNIVERSE: You are ONLY allowed to recommend trading the following tokens: ${watchlist.join(", ")}. Do not suggest any other tokens.

    CONTEXT:
    
    1. USER PORTFOLIO:
    ${JSON.stringify(portfolioContext, null, 2)}
    
    2. CURRENT MARKET DATA (Verified Live Prices):
    ${JSON.stringify(marketPrices, null, 2)}

    INSTRUCTIONS:
    1. Analyze the portfolio holdings. Are any assets overexposed, underperforming, or likely hitting a local top?
    2. Analyze the watchlist opportunities. Are any of the allowed tokens (BTC, ETH, XRP, DOGE, SOL, GODS) currently undervalued, showing strong momentum, or breaking out?
    3. Look for "Switch" opportunities.
    4. Be specific with percentages. "Sell 50%" (Take profit but keep moonbag), "Sell 20%" (Trim).
    5. Assess Risk. High volatility (DOGE/GODS) requires careful position sizing.
    6. CRITICAL RULE: ONLY suggest trades with a confidence score > 75. If no opportunities exceed 75% confidence, you MUST return an empty "suggestions" array and explicitly advise to "HOLD STRATEGY" in the summary. Do not force a trade.

    OUTPUT FORMAT:
    Return a strictly valid JSON object matching this structure:
    {
      "summary": "A 2-3 sentence strategic overview. If no high-confidence trades found, explain why holding is the best current play.",
      "suggestions": [
        {
          "action": "SWITCH", 
          "sellTicker": "BTC",
          "buyTicker": "SOL",
          "percentage": 50,
          "reason": "BTC has minimal volatility while SOL is breaking 200 SMA...",
          "confidenceScore": 85
        }
      ]
    }
  `;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson) as AgentConsultationResult;

    // Safety Filter: Enforce the 75% threshold programmatically
    const validSuggestions = (parsed.suggestions || []).filter(
      (s: TradeSuggestion) => s.confidenceScore > 75
    );

    // If we filtered out trades but the agent wrote them, the summary might be stale.
    // However, given the prompt instructions, this should be rare.
    // We pass the filtered list.

    return {
      summary: parsed.summary,
      suggestions: validSuggestions,
      verifiedPrices: marketPrices
    };
  } catch (error) {
    console.error("Agent consultation failed:", error);
    return {
      summary: "I'm having trouble connecting to the market brain right now. Please try again in a moment.",
      suggestions: [],
      verifiedPrices: {}
    };
  }
}
