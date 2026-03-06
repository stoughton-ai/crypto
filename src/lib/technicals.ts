/**
 * TECHNICAL ANALYSIS ENGINE
 *
 * Fetches real 1h intraday candles from EODHD and computes proper
 * technical indicators. Replaces the AI's hallucinated RSI/MA/volume scores
 * with ground-truth computed values.
 *
 * Indicators computed:
 *   - RSI(14) from 1h candles
 *   - SMA(7), SMA(25) from 1h closes
 *   - EMA(12), EMA(26) for MACD crossover signal
 *   - Volume ratio (current vs 7-day average)
 *   - Price position within 24h range (0-100%)
 *   - Multi-day price changes (3d, 7d)
 *   - Trend direction (from SMA slope)
 *
 * Quota gating (via shared eodhd-quota module):
 *   - NORMAL   (0-90%)  → Fetches proceed with 15-min cache TTL.
 *   - THROTTLE (90-95%) → Cache TTL extended to 60 min; fresh fetches skipped.
 *   - CRITICAL (95%+)   → All candle fetches blocked; returns [] immediately.
 */

import { checkEODHDQuota } from './eodhd-quota';

const EODHD_API_KEY = process.env.EODHD_API_KEY || '';

// ── Cache ────────────────────────────────────────────────────────────────
const CANDLE_CACHE_TTL_NORMAL_MS = 15 * 60 * 1000;  // 15 min — standard
const CANDLE_CACHE_TTL_THROTTLE_MS = 60 * 60 * 1000; // 60 min — conserve quota
const candleCache: Map<string, { data: OHLCVCandle[]; ts: number }> = new Map();

export interface OHLCVCandle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface TechnicalIndicators {
    ticker: string;
    rsi14: number;           // 0-100
    sma7: number;            // 7-period SMA
    sma25: number;           // 25-period SMA
    ema12: number;           // 12-period EMA
    ema26: number;           // 26-period EMA
    macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    priceVsSma7: number;     // % above/below SMA7
    priceVsSma25: number;    // % above/below SMA25
    volumeRatio: number;     // current volume / 7d avg volume (>1 = above avg)
    pricePosition24h: number; // 0-100% where price sits in 24h range
    change3d: number;        // 3-day price change %
    change7d: number;        // 7-day price change %
    trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
    volatility24h: number;   // (high-low)/close as %
    supportLevel: number;    // recent low from candles
    resistanceLevel: number; // recent high from candles
    candleCount: number;     // how many candles we got (data quality)
}

// ── Fetch 1h candles from EODHD ──────────────────────────────────────────

/**
 * Fetches 7 days of 1h OHLCV candles for a given ticker.
 *
 * @param ticker      Plain arena ticker (e.g. "BTC", "SHEL", "GLD").
 * @param eodhdTicker Optional override for the full EODHD code (e.g. "SHEL.LSE").
 *                    Defaults to the crypto format: "<TICKER>-USD.CC".
 */
export async function fetch1hCandles(
    ticker: string,
    eodhdTicker?: string,
): Promise<OHLCVCandle[]> {
    const upper = ticker.toUpperCase();
    const now = Date.now();

    // ── Quota gate ──────────────────────────────────────────────────────
    const quota = await checkEODHDQuota();

    if (quota.blocked) {
        // CRITICAL — return whatever we have cached, even if stale
        const stale = candleCache.get(upper);
        if (stale) {
            console.warn(`[TechAnalysis] EODHD CRITICAL — returning stale candles for ${upper}`);
            return stale.data;
        }
        console.warn(`[TechAnalysis] EODHD CRITICAL — no candles for ${upper}, skipping`);
        return [];
    }

    // Choose cache TTL based on quota level
    const cacheTTL = quota.throttled
        ? CANDLE_CACHE_TTL_THROTTLE_MS   // 60 min — conserve remaining budget
        : CANDLE_CACHE_TTL_NORMAL_MS;    // 15 min — standard

    // ── Cache check ─────────────────────────────────────────────────────
    const cached = candleCache.get(upper);
    if (cached && (now - cached.ts) < cacheTTL) {
        return cached.data;
    }

    // At THROTTLE level, skip live fetch and return stale/empty rather than burning quota
    if (quota.throttled) {
        if (cached) {
            console.warn(`[TechAnalysis] EODHD THROTTLE — returning stale candles for ${upper} (${Math.round((now - cached.ts) / 60000)}m old)`);
            return cached.data;
        }
        console.warn(`[TechAnalysis] EODHD THROTTLE — skipping fresh candle fetch for ${upper}`);
        return [];
    }

    if (!EODHD_API_KEY) return [];

    // ── Live fetch ──────────────────────────────────────────────────────
    try {
        const eodhCode = eodhdTicker ?? `${upper}-USD.CC`;
        const fromTs = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
        const toTs = Math.floor(now / 1000);
        const url = `https://eodhd.com/api/intraday/${eodhCode}?api_token=${EODHD_API_KEY}&fmt=json&interval=1h&from=${fromTs}&to=${toTs}`;

        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return cached?.data ?? [];

        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return cached?.data ?? [];

        const candles: OHLCVCandle[] = data.map((c: any) => ({
            timestamp: c.timestamp || Math.floor(new Date(c.datetime || c.date).getTime() / 1000),
            open: parseFloat(c.open) || 0,
            high: parseFloat(c.high) || 0,
            low: parseFloat(c.low) || 0,
            close: parseFloat(c.close) || 0,
            volume: parseFloat(c.volume) || 0,
        })).filter((c: OHLCVCandle) => c.close > 0);

        candles.sort((a, b) => a.timestamp - b.timestamp);
        candleCache.set(upper, { data: candles, ts: now });
        return candles;
    } catch (e: any) {
        console.warn(`[TechAnalysis] Failed to fetch candles for ${upper}: ${e.message}`);
        return cached?.data ?? [];
    }
}

// ── Indicator Computation ────────────────────────────────────────────────

function computeRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50; // neutral default

    let gains = 0, losses = 0;

    // Initial average gain/loss
    for (let i = closes.length - period; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function computeSMA(values: number[], period: number): number {
    if (values.length < period) return values.length > 0 ? values[values.length - 1] : 0;
    const slice = values.slice(-period);
    return slice.reduce((sum, v) => sum + v, 0) / period;
}

function computeEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length < period) return computeSMA(values, values.length);

    const k = 2 / (period + 1);
    let ema = computeSMA(values.slice(0, period), period);

    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }

    return ema;
}

// ── Main Computation ─────────────────────────────────────────────────────

export function computeTechnicalIndicators(
    ticker: string,
    candles: OHLCVCandle[],
    currentPrice: number,
): TechnicalIndicators {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // RSI(14)
    const rsi14 = computeRSI(closes, 14);

    // SMAs
    const sma7 = computeSMA(closes, 7);
    const sma25 = computeSMA(closes, 25);

    // EMAs for MACD
    const ema12 = computeEMA(closes, 12);
    const ema26 = computeEMA(closes, 26);
    const macdLine = ema12 - ema26;
    const macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
        macdLine > 0 && currentPrice > sma7 ? 'BULLISH' :
            macdLine < 0 && currentPrice < sma7 ? 'BEARISH' : 'NEUTRAL';

    // Price vs MAs
    const priceVsSma7 = sma7 > 0 ? ((currentPrice - sma7) / sma7) * 100 : 0;
    const priceVsSma25 = sma25 > 0 ? ((currentPrice - sma25) / sma25) * 100 : 0;

    // Volume ratio
    const recentVolumes = volumes.slice(-24); // last 24 hours
    const avgVolume7d = volumes.length > 0
        ? volumes.reduce((s, v) => s + v, 0) / volumes.length
        : 1;
    const currentVolume = recentVolumes.length > 0
        ? recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length
        : avgVolume7d;
    const volumeRatio = avgVolume7d > 0 ? currentVolume / avgVolume7d : 1;

    // 24h price position
    const last24h = candles.slice(-24);
    const high24h = last24h.length > 0 ? Math.max(...last24h.map(c => c.high)) : currentPrice;
    const low24h = last24h.length > 0 ? Math.min(...last24h.map(c => c.low)) : currentPrice;
    const range24h = high24h - low24h;
    const pricePosition24h = range24h > 0 ? ((currentPrice - low24h) / range24h) * 100 : 50;

    // Multi-day changes
    const candles72hAgo = candles.length >= 72 ? candles[candles.length - 72] : candles[0];
    const candles168hAgo = candles.length >= 168 ? candles[candles.length - 168] : candles[0];
    const change3d = candles72hAgo?.close > 0
        ? ((currentPrice - candles72hAgo.close) / candles72hAgo.close) * 100 : 0;
    const change7d = candles168hAgo?.close > 0
        ? ((currentPrice - candles168hAgo.close) / candles168hAgo.close) * 100 : 0;

    // Trend from SMA slope (last 12 SMA7 values)
    const smaHistory: number[] = [];
    for (let i = Math.max(0, closes.length - 12); i <= closes.length; i++) {
        if (i >= 7) smaHistory.push(computeSMA(closes.slice(0, i), 7));
    }
    let trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';
    if (smaHistory.length >= 3) {
        const start = smaHistory[0];
        const end = smaHistory[smaHistory.length - 1];
        const slopePercent = start > 0 ? ((end - start) / start) * 100 : 0;
        if (slopePercent > 0.5) trendDirection = 'UP';
        else if (slopePercent < -0.5) trendDirection = 'DOWN';
    }

    // Volatility (24h range as % of price)
    const volatility24h = currentPrice > 0 ? (range24h / currentPrice) * 100 : 0;

    // Support/resistance from last 7 days
    const supportLevel = lows.length > 0 ? Math.min(...lows.slice(-168)) : currentPrice;
    const resistanceLevel = highs.length > 0 ? Math.max(...highs.slice(-168)) : currentPrice;

    return {
        ticker: ticker.toUpperCase(),
        rsi14: Math.round(rsi14 * 10) / 10,
        sma7: Math.round(sma7 * 100) / 100,
        sma25: Math.round(sma25 * 100) / 100,
        ema12: Math.round(ema12 * 100) / 100,
        ema26: Math.round(ema26 * 100) / 100,
        macdSignal,
        priceVsSma7: Math.round(priceVsSma7 * 100) / 100,
        priceVsSma25: Math.round(priceVsSma25 * 100) / 100,
        volumeRatio: Math.round(volumeRatio * 100) / 100,
        pricePosition24h: Math.round(pricePosition24h * 10) / 10,
        change3d: Math.round(change3d * 100) / 100,
        change7d: Math.round(change7d * 100) / 100,
        trendDirection,
        volatility24h: Math.round(volatility24h * 100) / 100,
        supportLevel,
        resistanceLevel,
        candleCount: candles.length,
    };
}

// ── Batch fetch for all arena tokens ─────────────────────────────────────

export async function fetchTechnicalDataForTokens(
    tickers: string[],
    prices: Record<string, { price: number }>,
): Promise<Record<string, TechnicalIndicators>> {
    const results: Record<string, TechnicalIndicators> = {};

    // Fetch candles in parallel (each is 1 EODHD call, cached for 15 min)
    const promises = tickers.map(async (ticker) => {
        const upper = ticker.toUpperCase();
        try {
            const candles = await fetch1hCandles(upper);
            const price = prices[upper]?.price || 0;
            if (candles.length > 0 && price > 0) {
                results[upper] = computeTechnicalIndicators(upper, candles, price);
            }
        } catch (e: any) {
            console.warn(`[TechAnalysis] Failed for ${upper}: ${e.message}`);
        }
    });

    await Promise.all(promises);
    return results;
}

// ── Format for AI prompt ─────────────────────────────────────────────────

export function formatTechnicalDataForPrompt(tech: TechnicalIndicators): string {
    const rsiLabel = tech.rsi14 > 70 ? 'OVERBOUGHT' : tech.rsi14 < 30 ? 'OVERSOLD' : 'NEUTRAL';
    const volLabel = tech.volumeRatio > 1.5 ? 'HIGH' : tech.volumeRatio < 0.5 ? 'LOW' : 'NORMAL';
    const posLabel = tech.pricePosition24h > 80 ? 'NEAR HIGH' : tech.pricePosition24h < 20 ? 'NEAR LOW' : 'MID-RANGE';

    return `
  COMPUTED TECHNICAL INDICATORS (from real 1h candle data — ${tech.candleCount} candles):
  - RSI(14): ${tech.rsi14.toFixed(1)} [${rsiLabel}]
  - SMA(7): $${tech.sma7} | Price vs SMA7: ${tech.priceVsSma7 > 0 ? '+' : ''}${tech.priceVsSma7.toFixed(2)}%
  - SMA(25): $${tech.sma25} | Price vs SMA25: ${tech.priceVsSma25 > 0 ? '+' : ''}${tech.priceVsSma25.toFixed(2)}%
  - MACD Signal: ${tech.macdSignal} (EMA12: $${tech.ema12}, EMA26: $${tech.ema26})
  - Volume Ratio: ${tech.volumeRatio.toFixed(2)}x average [${volLabel}]
  - 24h Price Position: ${tech.pricePosition24h.toFixed(1)}% [${posLabel}]
  - 24h Volatility: ${tech.volatility24h.toFixed(2)}%
  - 3-Day Change: ${tech.change3d > 0 ? '+' : ''}${tech.change3d.toFixed(2)}%
  - 7-Day Change: ${tech.change7d > 0 ? '+' : ''}${tech.change7d.toFixed(2)}%
  - Trend Direction: ${tech.trendDirection}
  - Support: $${tech.supportLevel} | Resistance: $${tech.resistanceLevel}`;
}
