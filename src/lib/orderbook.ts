/**
 * BINANCE ORDER BOOK — Free Market Depth Data
 * 
 * Fetches top bid/ask levels from Binance public API (no key needed).
 * Gives the AI real supply/demand pressure data at current price levels.
 */

const ORDERBOOK_CACHE_TTL_MS = 60_000; // 1-minute cache
const orderbookCache: Map<string, { data: OrderBookData; ts: number }> = new Map();

export interface OrderBookData {
    ticker: string;
    bidAskSpreadPct: number;    // spread as % of price
    topBidPrice: number;
    topAskPrice: number;
    bidDepthUSD: number;        // total USD value in top 5 bids
    askDepthUSD: number;        // total USD value in top 5 asks
    buyPressureRatio: number;   // bidDepth / askDepth (>1 = more buying)
    pressureLabel: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
}

export async function fetchOrderBook(ticker: string): Promise<OrderBookData | null> {
    const upper = ticker.toUpperCase();
    const now = Date.now();

    // Check cache
    const cached = orderbookCache.get(upper);
    if (cached && (now - cached.ts) < ORDERBOOK_CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const symbol = `${upper}USDT`;
        const res = await fetch(
            `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5`,
            { cache: 'no-store' }
        );
        if (!res.ok) return null;

        const data = await res.json();
        if (!data.bids?.length || !data.asks?.length) return null;

        // Calculate depth in USD
        let bidDepthUSD = 0;
        let askDepthUSD = 0;

        for (const [price, qty] of data.bids) {
            bidDepthUSD += parseFloat(price) * parseFloat(qty);
        }
        for (const [price, qty] of data.asks) {
            askDepthUSD += parseFloat(price) * parseFloat(qty);
        }

        const topBidPrice = parseFloat(data.bids[0][0]);
        const topAskPrice = parseFloat(data.asks[0][0]);
        const midPrice = (topBidPrice + topAskPrice) / 2;
        const bidAskSpreadPct = midPrice > 0 ? ((topAskPrice - topBidPrice) / midPrice) * 100 : 0;

        const buyPressureRatio = askDepthUSD > 0 ? bidDepthUSD / askDepthUSD : 1;

        let pressureLabel: OrderBookData['pressureLabel'] = 'NEUTRAL';
        if (buyPressureRatio > 2.0) pressureLabel = 'STRONG_BUY';
        else if (buyPressureRatio > 1.3) pressureLabel = 'BUY';
        else if (buyPressureRatio < 0.5) pressureLabel = 'STRONG_SELL';
        else if (buyPressureRatio < 0.77) pressureLabel = 'SELL';

        const result: OrderBookData = {
            ticker: upper,
            bidAskSpreadPct: Math.round(bidAskSpreadPct * 10000) / 10000,
            topBidPrice,
            topAskPrice,
            bidDepthUSD: Math.round(bidDepthUSD),
            askDepthUSD: Math.round(askDepthUSD),
            buyPressureRatio: Math.round(buyPressureRatio * 100) / 100,
            pressureLabel,
        };

        orderbookCache.set(upper, { data: result, ts: now });
        return result;
    } catch {
        return null;
    }
}

export async function fetchOrderBooksForTokens(tickers: string[]): Promise<Record<string, OrderBookData>> {
    const results: Record<string, OrderBookData> = {};
    const promises = tickers.map(async (ticker) => {
        const data = await fetchOrderBook(ticker);
        if (data) results[ticker.toUpperCase()] = data;
    });
    await Promise.all(promises);
    return results;
}

export function formatOrderBookForPrompt(ob: OrderBookData): string {
    return `
  ORDER BOOK DEPTH (Binance, top 5 levels):
  - Spread: ${ob.bidAskSpreadPct.toFixed(4)}% | Bid: $${ob.topBidPrice} | Ask: $${ob.topAskPrice}
  - Buy-side depth: $${ob.bidDepthUSD.toLocaleString()} | Sell-side depth: $${ob.askDepthUSD.toLocaleString()}
  - Buy/Sell Pressure Ratio: ${ob.buyPressureRatio.toFixed(2)}x [${ob.pressureLabel}]`;
}
