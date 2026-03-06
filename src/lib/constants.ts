// ═══════════════════════════════════════════════════════════════════════════
// SEMAPHORE ARENA — Constants & Types
// ═══════════════════════════════════════════════════════════════════════════

// ─── ASSET CLASS IDENTIFIER ───────────────────────────────────────────────────
// Used to namespace Firestore collections and route pricing/AI logic per arena.
export type AssetClass = 'CRYPTO' | 'FTSE' | 'NYSE' | 'COMMODITIES';

// Arenas that start in sandbox mode (no 28-day competition timer).
// These are promoted to competition mode manually via the UI.
export const SANDBOX_ASSET_CLASSES: AssetClass[] = ['FTSE', 'NYSE', 'COMMODITIES'];

// Per-class Firestore collection names.
// CRYPTO uses the original collection names (backward-compatible, no suffix).
export function getArenaCollections(assetClass: AssetClass = 'CRYPTO') {
    if (assetClass === 'CRYPTO') {
        return {
            config: 'arena_config',
            trades: 'arena_trades',
            reflections: 'arena_reflections',
            snapshots: 'arena_snapshots',
            reviews: 'strategy_reports',
        };
    }
    const ns = assetClass.toLowerCase();
    return {
        config: `arena_config_${ns}`,
        trades: `arena_trades_${ns}`,
        reflections: `arena_reflections_${ns}`,
        snapshots: `arena_snapshots_${ns}`,
        reviews: `strategy_reports_${ns}`,
    };
}

// EODHD real-time ticker format per asset class.
// The existing engine already uses this pattern for crypto (e.g. BTC-USD.CC).
// New arenas use exchange-appropriate suffixes on the same API key.
export function formatEODHDTicker(ticker: string, assetClass: AssetClass): string {
    const t = ticker.toUpperCase();
    switch (assetClass) {
        case 'CRYPTO':
            return `${t}-USD.CC`;
        case 'FTSE':
            return `${t}.LSE`;
        case 'NYSE':
            return `${t}.US`;
        case 'COMMODITIES': {
            // Precious metals are priced via .FOREX as spot FX pairs
            const forexMetals: Record<string, string> = {
                XAU: 'XAUUSD.FOREX', XAG: 'XAGUSD.FOREX',
                XPT: 'XPTUSD.FOREX', XPD: 'XPDUSD.FOREX',
            };
            if (forexMetals[t]) return forexMetals[t];
            // Energy & agricultural use .COMM
            const commMap: Record<string, string> = {
                OIL: 'CLUSD.COMM', CL: 'CLUSD.COMM',
                BRENT: 'BZUSD.COMM', BZ: 'BZUSD.COMM',
                NG: 'NGUSD.COMM', NGAS: 'NGUSD.COMM',
                WHEAT: 'ZWUSD.COMM', ZW: 'ZWUSD.COMM',
                CORN: 'ZCUSD.COMM', ZC: 'ZCUSD.COMM',
                SOY: 'ZSUSD.COMM', ZS: 'ZSUSD.COMM',
                COFFEE: 'KCUSD.COMM', KC: 'KCUSD.COMM',
                SUGAR: 'SBUSD.COMM', SB: 'SBUSD.COMM',
                COPPER: 'HGUSD.COMM', HG: 'HGUSD.COMM',
            };
            if (commMap[t]) return commMap[t];
            return `${t}USD.COMM`;
        }
        default:
            return `${t}-USD.CC`;
    }
}

// Reverse: strip EODHD suffix back to the plain ticker the arena uses
export function parseEODHDTicker(eodhdCode: string, assetClass: AssetClass): string {
    if (assetClass === 'CRYPTO') return eodhdCode.replace('-USD.CC', '');
    if (assetClass === 'FTSE') return eodhdCode.replace('.LSE', '');
    if (assetClass === 'NYSE') return eodhdCode.replace('.US', '');
    if (assetClass === 'COMMODITIES') {
        // e.g. XAUUSD.FOREX → XAU, CLUSD.COMM → OIL
        const reverseMap: Record<string, string> = {
            'XAUUSD.FOREX': 'XAU', 'XAGUSD.FOREX': 'XAG',
            'XPTUSD.FOREX': 'XPT', 'XPDUSD.FOREX': 'XPD',
            'CLUSD.COMM': 'OIL', 'BZUSD.COMM': 'BRENT',
            'NGUSD.COMM': 'NGAS', 'ZWUSD.COMM': 'WHEAT',
            'ZCUSD.COMM': 'CORN', 'ZSUSD.COMM': 'SOY',
            'KCUSD.COMM': 'COFFEE', 'SBUSD.COMM': 'SUGAR',
            'HGUSD.COMM': 'COPPER',
        };
        if (reverseMap[eodhdCode]) return reverseMap[eodhdCode];
        return eodhdCode.replace('USD.FOREX', '').replace('USD.COMM', '');
    }
    return eodhdCode;
}

// ─── ARENA CONFIGURATION ─────────────────────────────────────────────────────
export const ARENA_START_DATE = '2026-03-04T00:00:00Z';  // Wednesday 4th March
export const ARENA_DURATION_DAYS = 28;
export const ARENA_WEEK_LENGTH = 7;
export const POOL_COUNT = 4;
export const TOKENS_PER_POOL = 2;
export const TOTAL_TOKENS = POOL_COUNT * TOKENS_PER_POOL; // 8
export const POOL_BUDGET = 150; // $150 per pool — same for all asset classes
export const TOTAL_BUDGET = POOL_COUNT * POOL_BUDGET; // $600

// ─── API BUDGETS ─────────────────────────────────────────────────────────────
export const EODHD_DAILY_LIMIT = 80_000;
export const EODHD_CRITICAL_THRESHOLD = 0.95;
export const EODHD_THROTTLE_THRESHOLD = 0.90;
export const QUOTAGUARD_MONTHLY_LIMIT = 14_000;

// ─── CRON SCHEDULE ───────────────────────────────────────────────────────────
export const CRON_INTERVAL_MINUTES = 3; // Every 3 minutes
export const PRICE_REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3 min
export const HISTORICAL_DATA_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const FNG_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const REVOLUT_HEALTH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const REVOLUT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ─── TRADING DEFAULTS ────────────────────────────────────────────────────────
export const STOP_LOSS_THRESHOLD = 0.25; // 25% drawdown triggers halt
export const MIN_ORDER_AMOUNT = 10; // $10 minimum per trade

// Master pool of VERIFIED tradable tokens.
// Every token in this list is confirmed available on BOTH Revolut AND EODHD
// with accurate pricing (cross-referenced against CoinGecko, <30% divergence).
// Last audited: 2026-02-25
export const AGENT_WATCHLIST_TIERS: Record<string, string[]> = {
    TIER1: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'TRX', 'DOGE', 'ADA', 'BCH', 'LINK',
        'XLM', 'LTC', 'HBAR', 'AVAX', 'SHIB', 'CRO', 'DOT'],
    TIER2: ['AAVE', 'NEAR', 'ETC', 'ONDO', 'ICP', 'WLD', 'ATOM', 'QNT', 'ENA',
        'FLR', 'ALGO', 'FIL', 'RENDER', 'XDC', 'VET'],
    TIER3: ['BONK', 'SEI', 'VIRTUAL', 'DASH', 'XTZ', 'FET', 'CRV', 'IP', 'CHZ',
        'INJ', 'PYTH', 'TIA', 'JASMY', 'FLOKI', 'LDO', 'SYRUP', 'HNT', 'OP',
        'ENS', 'AXS', 'SAND', 'WIF', 'MANA', 'BAT'],
    TIER4: ['CVX', 'GALA', 'RAY', 'GLM', 'TRAC', 'EGLD', 'BERA', '1INCH', 'SNX',
        'JTO', 'KTA', 'AMP', 'LPT', 'EIGEN', 'APE', 'W', 'YFI', 'ROSE',
        'RSR', 'ZRX', 'KSM', 'AKT'],
};

export const AGENT_WATCHLIST = [
    ...AGENT_WATCHLIST_TIERS.TIER1,
    ...AGENT_WATCHLIST_TIERS.TIER2,
    ...AGENT_WATCHLIST_TIERS.TIER3,
    ...AGENT_WATCHLIST_TIERS.TIER4,
];

export const STABLECOIN_REJECT_LIST = [
    'USDT', 'USDC', 'DAI', 'FDUSD', 'PYUSD', 'TUSD', 'USDP', 'EUR', 'GBP',
    'WBTC', 'WETH', 'WSTETH', 'SAVAX', 'METH', 'STETH', 'USDD', 'USDE',
    'USDG', 'USDS', 'LUSD', 'FRAX', 'GHO', 'USD0', 'A7A5', 'RLUSD',
    'USDAI', 'USDTB', 'BFUSD', 'JTRSY', 'USDF', 'USTB', 'OUSG', 'JAAA',
    'STABLE', 'BUSD', 'EUT', 'EUTBL', 'XAUT', 'PAXG'
];

// ─── FTSE ARENA INSTRUMENT UNIVERSE ──────────────────────────────────────────
// EODHD ticker format: {TICKER}.LSE   (e.g. SHEL.LSE)
// Currency: GBP (£). Market hours: 08:00–16:30 London.
// AI selects 4 pairs (8 stocks) from this universe during initialisation.
export const FTSE_WATCHLIST: Record<string, string[]> = {
    BLUE_CHIP: ['SHEL', 'AZN', 'HSBA', 'BP', 'GSK', 'ULVR', 'RIO', 'DGE', 'LSEG', 'BA'],
    CORE_250: ['REL', 'EXPN', 'NXT', 'TSCO', 'BEZ', 'DPLM', 'MNDI', 'WPP', 'IMB', 'NG'],
    GROWTH: ['AUTO', 'CRH', 'III', 'GAW', 'HLMA', 'BRBY', 'JD', 'SSE', 'NWG', 'REX'],
    SPECULATIVE: ['IAG', 'FRES', 'TUI', 'ITV', 'STAN', 'SAGA', 'BBA', 'WEIR', 'SN', 'CHR'],
};
export const FTSE_INSTRUMENT_LIST = [
    ...FTSE_WATCHLIST.BLUE_CHIP,
    ...FTSE_WATCHLIST.CORE_250,
    ...FTSE_WATCHLIST.GROWTH,
    ...FTSE_WATCHLIST.SPECULATIVE,
];

// ─── NYSE ARENA INSTRUMENT UNIVERSE ──────────────────────────────────────────
// EODHD ticker format: {TICKER}.US   (e.g. AAPL.US)
// Currency: USD ($). Market hours: 09:30–16:00 Eastern (14:30–21:00 UTC).
// AI selects 4 pairs (8 stocks) from this universe during initialisation.
export const NYSE_WATCHLIST: Record<string, string[]> = {
    MEGA_CAP: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'V', 'JNJ', 'BRK-B'],
    LARGE_GROW: ['TSLA', 'AMD', 'CRM', 'NOW', 'NFLX', 'UBER', 'PLTR', 'SHOP', 'PYPL', 'SQ'],
    VALUE_DIV: ['KO', 'PG', 'WMT', 'DIS', 'CAT', 'LMT', 'RTX', 'GE', 'UNH', 'MMM'],
    MOMENTUM: ['SMCI', 'ARM', 'MSTR', 'COIN', 'ANET', 'APP', 'HOOD', 'SLB', 'OXY', 'RBLX'],
};
export const NYSE_INSTRUMENT_LIST = [
    ...NYSE_WATCHLIST.MEGA_CAP,
    ...NYSE_WATCHLIST.LARGE_GROW,
    ...NYSE_WATCHLIST.VALUE_DIV,
    ...NYSE_WATCHLIST.MOMENTUM,
];

// ─── COMMODITIES ARENA INSTRUMENT UNIVERSE ────────────────────────────────────
// EODHD formats: metals via .FOREX (e.g. XAUUSD.FOREX), energy/agri via .COMM
// Currency: USD ($). Extended hours Mon–Fri.
// AI selects 4 pairs (8 instruments) from this universe during initialisation.
// Ticker keys used internally in the arena (human-readable, mapped to EODHD in formatEODHDTicker).
export const COMMODITIES_WATCHLIST: Record<string, string[]> = {
    PRECIOUS: ['XAU', 'XAG', 'XPT', 'XPD'],
    ENERGY: ['OIL', 'BRENT', 'NGAS'],
    AGRICULTURAL: ['WHEAT', 'CORN', 'SOY', 'COFFEE', 'SUGAR'],
    BASE_METALS: ['COPPER'],
};
export const COMMODITIES_INSTRUMENT_LIST = [
    ...COMMODITIES_WATCHLIST.PRECIOUS,
    ...COMMODITIES_WATCHLIST.ENERGY,
    ...COMMODITIES_WATCHLIST.AGRICULTURAL,
    ...COMMODITIES_WATCHLIST.BASE_METALS,
];

// Human-readable display names for commodity instruments (used in UI + AI prompts)
export const COMMODITIES_DISPLAY_NAMES: Record<string, string> = {
    XAU: 'Gold', XAG: 'Silver', XPT: 'Platinum', XPD: 'Palladium',
    OIL: 'WTI Crude Oil', BRENT: 'Brent Crude', NGAS: 'Natural Gas',
    WHEAT: 'Wheat', CORN: 'Corn', SOY: 'Soybeans', COFFEE: 'Coffee', SUGAR: 'Sugar',
    COPPER: 'Copper',
};

// Helper: get the watchlist for any asset class
export function getWatchlist(assetClass: AssetClass): string[] {
    switch (assetClass) {
        case 'FTSE': return FTSE_INSTRUMENT_LIST;
        case 'NYSE': return NYSE_INSTRUMENT_LIST;
        case 'COMMODITIES': return COMMODITIES_INSTRUMENT_LIST;
        default: return AGENT_WATCHLIST;
    }
}

// Helper: currency symbol per asset class
export function getCurrencySymbol(assetClass: AssetClass): string {
    return assetClass === 'FTSE' ? '£' : '$';
}

// Helper: benchmark label per asset class (shown in dashboard vs benchmark row)
export function getBenchmarkLabel(assetClass: AssetClass): string {
    switch (assetClass) {
        case 'FTSE': return 'FTSE 100';
        case 'NYSE': return 'S&P 500';
        case 'COMMODITIES': return 'Gold (XAU)';
        default: return 'BTC';
    }
}

// Arena theme colours per asset class (used for CSS custom property injection)
export const ARENA_THEME: Record<AssetClass, { primary: string; secondary: string; glow: string }> = {
    CRYPTO: { primary: '#4ba3e3', secondary: '#0b5394', glow: 'rgba(75,163,227,0.15)' },
    FTSE: { primary: '#10b981', secondary: '#065f46', glow: 'rgba(16,185,129,0.15)' },
    NYSE: { primary: '#f59e0b', secondary: '#92400e', glow: 'rgba(245,158,11,0.15)' },
    COMMODITIES: { primary: '#ef4444', secondary: '#7f1d1d', glow: 'rgba(239,68,68,0.15)' },
};



// ─── TYPES ───────────────────────────────────────────────────────────────────

export type PoolId = 'POOL_1' | 'POOL_2' | 'POOL_3' | 'POOL_4';

export interface PoolStrategy {
    buyScoreThreshold: number;
    exitThreshold: number;
    momentumGateEnabled: boolean;
    momentumGateThreshold: number;
    minOrderAmount: number;
    antiWashHours: number;
    reentryPenalty: number;
    positionStopLoss: number;
    maxAllocationPerToken: number;
    takeProfitTarget: number;      // % gain to trigger take-profit sell (e.g. 3 = 3%)
    trailingStopPct: number;       // % drawdown from peak to trigger trailing stop (e.g. 2 = sell if drops 2% from peak)
    minWinPct: number;             // minimum % profit to count as a "win" (e.g. 0.5 = 0.5%)
    description: string;

    // ─── AI-CONTROLLABLE EXECUTION PARAMETERS ───────────────────────────
    // Previously hardcoded constants. Now each pool's AI can tune these
    // independently during strategy reviews for genuine per-pool autonomy.
    minHoldMinutes?: number;            // Min hold before AI exit/trailing stop fires (default 120)
    evaluationCooldownMinutes?: number; // Min time between score evaluations for same token (default 15)
    buyConfidenceBuffer?: number;       // Points above buyThreshold needed to actually buy (default 5)
    exitHysteresis?: number;            // Points below exitThreshold needed to actually sell (default 10)
    positionSizeMultiplier?: number;    // 0.5-1.0, base multiplier for position sizing (default 0.8)
    strategyPersonality?: 'PATIENT' | 'MODERATE' | 'AGGRESSIVE'; // Shapes the scoring prompt tone
}

export interface PoolHolding {
    amount: number;
    averagePrice: number;
    peakPrice: number;             // Highest price since entry
    peakPnlPct: number;            // Highest P&L % since entry (for trailing stop)
    boughtAt?: string;
}

export interface PoolPerformance {
    startDate: string;
    totalPnl: number;
    totalPnlPct: number;
    winCount: number;
    lossCount: number;
    totalTrades: number;
    bestTrade: { ticker: string; pnlPct: number } | null;
    worstTrade: { ticker: string; pnlPct: number } | null;
    dailySnapshots: { date: string; value: number; pnlPct: number }[];
}

export interface StrategyChange {
    week: number;
    previousStrategy: PoolStrategy;
    newStrategy: PoolStrategy;
    reasoning: string;
    changedAt: string;
}

export interface WeeklyReview {
    week: number;
    pnl: number;
    pnlPct: number;
    trades: number;
    wins: number;
    losses: number;
    strategyChanged: boolean;
    aiReflection: string;
    timestamp: string;
}

export interface ArenaPool {
    poolId: PoolId;
    name: string;
    emoji: string;
    tokens: [string, string];
    strategy: PoolStrategy;
    strategyHistory: StrategyChange[];
    budget: number;
    cashBalance: number;
    holdings: Record<string, PoolHolding>;
    performance: PoolPerformance;
    createdAt: string;
    status: 'ACTIVE' | 'PAUSED';
    pauseReason?: string;
    selectionReasoning: string;
    weeklyReviews: WeeklyReview[];
    lastSoldAt?: Record<string, string>;  // ISO timestamp per token — anti-wash tracking

    // ─── SCORE MEMORY ─────────────────────────────────────────────────
    // Last N scores per token, persisted across cron cycles.
    // Used for score smoothing and to show the scoring AI its own history.
    scoreHistory?: Record<string, { score: number; ts: string }[]>;
    // Last evaluation timestamp per token for cooldown enforcement
    lastEvaluatedAt?: Record<string, string>;
}

export interface ArenaConfig {
    userId: string;
    startDate: string;
    endDate: string;
    currentWeek: number;
    pools: ArenaPool[];
    tokensLocked: boolean;
    totalBudget: number;
    initialized: boolean;
    completedAt?: string;
    /** True once a sandbox arena has been promoted to 28-day competition mode */
    competitionMode?: boolean;
    /** True while a non-crypto arena is still in sandbox/testing mode */
    sandboxMode?: boolean;
}

export interface ArenaTradeRecord {
    id?: string;
    userId: string;
    poolId: PoolId;
    poolName: string;
    ticker: string;
    type: 'BUY' | 'SELL';
    amount: number;
    price: number;
    total: number;
    reason: string;
    pnl?: number;
    pnlPct?: number;
    date: string;
    createdAt: any;
    marketContext: {
        btcPrice: number;
        btcChange24h: number;
        tokenChange24h: number;
        fearGreedIndex: number;
    };
    preTradeReflection: string;
}

export interface TradeReflection {
    tradeId: string;
    poolId: PoolId;
    ticker: string;
    type: 'BUY' | 'SELL';
    price: number;
    total: number;
    reasoning: string;
    marketConditionsAtTrade: {
        btcPrice: number;
        btcChange24h: number;
        tokenChange24h: number;
        fearGreedIndex: number;
        timestamp: string;
    };
    outcome?: {
        pnl: number;
        pnlPct: number;
        holdDurationHours: number;
        marketChangeAfterTrade: number;
        assessedAt: string;
        lessonLearned: string;
    };
}

export interface AIReasoningEntry {
    timestamp: string;
    type: 'TRADE' | 'STRATEGY_REVIEW' | 'WEEKLY_REFLECTION' | 'BUDGET_DECISION';
    poolId?: PoolId;
    reasoning: string;
    decision: string;
    confidence: number;
}

// ─── BACKWARD-COMPATIBLE LEGACY EXPORTS ──────────────────────────────────
// Required by agentConfigService.ts for user settings management.

export type RiskProfile = 'STEADY' | 'TACTICAL' | 'ALPHA SWING' | 'CUSTOM';

export const WATCHLIST_CAPACITIES = {
    traffic: 6,
    standard: 10,
    sandbox: 10,
    ai: 10,
};

export const DISCOVERY_POOL_DEFAULTS = {
    budget: 100,
    rotationCycleHours: 24,
};

export const PROFILE_DEFAULTS: Record<string, any> = {
    'STEADY': {
        portfolioStopLoss: 20, positionStopLoss: -10, maxAllocationPerAsset: 150,
        minCashReservePct: 10, aiScoreExitThreshold: 55, buyScoreThreshold: 70,
        scalingScoreThreshold: 80, minMarketCap: 250, minOrderAmount: 30,
        antiWashHours: 6, reentryPenalty: 5, maxOpenPositions: 12,
        requireMomentumForBuy: true, rotationMinScoreGap: 15,
        minProfitableHoldHours: 4, aiWatchlistCap: 10, aiDisplacementMargin: 5,
        sandboxBudgetPct: 10, buyAmountScore90: 80, buyAmountScore80: 60,
        buyAmountDefault: 40, scalingChunkSize: 30,
        strategyLabel: 'Steady Growth', strategyDescription: 'Capital preservation with steady returns',
    },
    'TACTICAL': {
        portfolioStopLoss: 25, positionStopLoss: -15, maxAllocationPerAsset: 200,
        minCashReservePct: 5, aiScoreExitThreshold: 50, buyScoreThreshold: 55,
        scalingScoreThreshold: 75, minMarketCap: 50, minOrderAmount: 150,
        antiWashHours: 4, reentryPenalty: 3, maxOpenPositions: 16,
        requireMomentumForBuy: false, rotationMinScoreGap: 10,
        minProfitableHoldHours: 2, aiWatchlistCap: 10, aiDisplacementMargin: 3,
        sandboxBudgetPct: 15, buyAmountScore90: 120, buyAmountScore80: 80,
        buyAmountDefault: 50, scalingChunkSize: 40,
        strategyLabel: 'Tactical Momentum', strategyDescription: 'Balanced momentum with tactical dip entries',
    },
    'ALPHA SWING': {
        portfolioStopLoss: 30, positionStopLoss: -20, maxAllocationPerAsset: 300,
        minCashReservePct: 3, aiScoreExitThreshold: 45, buyScoreThreshold: 60,
        scalingScoreThreshold: 70, minMarketCap: 25, minOrderAmount: 20,
        antiWashHours: 2, reentryPenalty: 2, maxOpenPositions: 16,
        requireMomentumForBuy: false, rotationMinScoreGap: 8,
        minProfitableHoldHours: 1, aiWatchlistCap: 10, aiDisplacementMargin: 2,
        sandboxBudgetPct: 20, buyAmountScore90: 150, buyAmountScore80: 100,
        buyAmountDefault: 60, scalingChunkSize: 50,
        strategyLabel: 'Alpha Swing', strategyDescription: 'Aggressive swing trading with contrarian entries',
    },
    'CUSTOM': {
        portfolioStopLoss: 25, positionStopLoss: -15, maxAllocationPerAsset: 200,
        minCashReservePct: 5, aiScoreExitThreshold: 50, buyScoreThreshold: 55,
        scalingScoreThreshold: 75, minMarketCap: 50, minOrderAmount: 30,
        antiWashHours: 4, reentryPenalty: 3, maxOpenPositions: 16,
        requireMomentumForBuy: false, rotationMinScoreGap: 10,
        minProfitableHoldHours: 2, aiWatchlistCap: 10, aiDisplacementMargin: 3,
        sandboxBudgetPct: 15, buyAmountScore90: 120, buyAmountScore80: 80,
        buyAmountDefault: 50, scalingChunkSize: 40,
        strategyLabel: 'Custom', strategyDescription: 'User-defined parameters',
    },
};
