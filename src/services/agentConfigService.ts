import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, updateDoc, Timestamp, arrayUnion, arrayRemove } from "firebase/firestore";
import { PROFILE_DEFAULTS, WATCHLIST_CAPACITIES, type RiskProfile } from "@/lib/constants";
export type { RiskProfile };


export function getReportedProfile(config: AgentConfig | any): string {
    const rawProfile = config?.riskProfile || 'TACTICAL';
    let baseProfile: RiskProfile = 'TACTICAL';

    // Migration logic
    if (rawProfile === 'SAFE') baseProfile = 'STEADY';
    else if (rawProfile === 'BALANCED') baseProfile = 'TACTICAL';
    else if (rawProfile === 'RISK') baseProfile = 'ALPHA SWING';
    else baseProfile = rawProfile as RiskProfile;

    const defaults = PROFILE_DEFAULTS[baseProfile];
    if (!defaults) return baseProfile;

    const hasDeviation =
        (config.portfolioStopLoss !== undefined && Number(config.portfolioStopLoss) !== Number(defaults.portfolioStopLoss)) ||
        (config.positionStopLoss !== undefined && Number(config.positionStopLoss) !== Number(defaults.positionStopLoss)) ||
        (config.maxAllocationPerAsset !== undefined && Number(config.maxAllocationPerAsset) !== Number(defaults.maxAllocationPerAsset)) ||
        (config.minCashReservePct !== undefined && Number(config.minCashReservePct) !== Number(defaults.minCashReservePct)) ||
        (config.aiScoreExitThreshold !== undefined && Number(config.aiScoreExitThreshold) !== Number(defaults.aiScoreExitThreshold)) ||
        (config.buyScoreThreshold !== undefined && Number(config.buyScoreThreshold) !== Number(defaults.buyScoreThreshold)) ||
        (config.scalingScoreThreshold !== undefined && Number(config.scalingScoreThreshold) !== Number(defaults.scalingScoreThreshold)) ||
        (config.minMarketCap !== undefined && Number(config.minMarketCap) !== Number(defaults.minMarketCap)) ||
        (config.minOrderAmount !== undefined && Number(config.minOrderAmount) !== Number(defaults.minOrderAmount)) ||
        (config.antiWashHours !== undefined && Number(config.antiWashHours) !== Number(defaults.antiWashHours)) ||
        (config.reentryPenalty !== undefined && Number(config.reentryPenalty) !== Number(defaults.reentryPenalty)) ||
        (config.maxOpenPositions !== undefined && Number(config.maxOpenPositions) !== Number(defaults.maxOpenPositions)) ||
        (config.minProfitableHoldHours !== undefined && Number(config.minProfitableHoldHours) !== Number(defaults.minProfitableHoldHours));

    return hasDeviation ? 'CUSTOM' : baseProfile;
}

const COLLECTION_NAME = "agent_configs";


export interface AgentConfig {
    userId: string;
    trafficLightTokens: string[]; // Max 6 (Anchor Positions)
    standardTokens: string[];     // Max 10 (Conviction Targets)
    sandboxTokens: string[];      // Max 10 (Speculative Reserve)
    analysisCycle: number;        // Standard Cycle (Hours): 0.5, 1, 2, 6, 12
    trafficCycle?: number;        // Traffic Light Cycle (Hours): 0.083, 0.166, 0.33, 0.5, 1
    sandboxCycle?: number;        // In hours: 6, 12, 24, 48
    aiCycle?: number;             // AI Watchlist Cycle (Hours): 2, 3, 6, 12 (Neural Intelligence Hub)
    aiWatchlist?: string[];       // AI-Selected Tokens (Max 10)
    retentionLimit?: number;       // Max library files: 500, 1000, 1500, 2000
    riskProfile?: RiskProfile;     // STEADY, TACTICAL, ALPHA SWING
    lastCheck?: { [ticker: string]: string }; // ISO timestamps
    lastTrade?: { [ticker: string]: string }; // ISO timestamps
    lastRebalance?: { [key: string]: string }; // ISO timestamps for scoped rebalancing: PRIORITY_STANDARD, STANDARD_SANDBOX, SANDBOX_AI
    automationEnabled: boolean;
    volatilityTriggerEnabled: boolean;
    rebalanceEnabled: boolean;
    targetWeights?: { [ticker: string]: number }; // ticker -> % (0-100)
    lastMarketSnapshot?: { [ticker: string]: { price: number, timestamp: string } };
    legacyPnlOffset?: number;
    revolutApiKey?: string;
    revolutPrivateKey?: string; // Private key for signing
    revolutIsSandbox?: boolean;
    revolutProxyUrl?: string; // Static egress IP proxy
    excludedTokens?: string[];    // User-managed blacklist
    watchdogEnabled?: boolean;     // 24/7 Protection
    watchdogNotificationsEnabled?: boolean; // Toggle popups
    positionStopLoss?: number;      // Hard stop loss % for individual assets (e.g. -15)
    portfolioStopLoss?: number;     // Portfolio 24h drawdown % (e.g. 25)
    maxAllocationPerAsset?: number; // Max USD per asset (e.g. 400)
    minCashReservePct?: number;     // Min cash reserve % (e.g. 5)
    aiScoreExitThreshold?: number;  // AI Score threshold to exit (e.g. 55)
    buyScoreThreshold?: number;     // score to open position (e.g. 60)
    scalingScoreThreshold?: number; // score to scale position (e.g. 80)
    minMarketCap?: number;          // Min market cap in millions (e.g. 250)
    minOrderAmount?: number;        // Min order size for buys (e.g. 10)
    antiWashHours?: number;         // Hours to block re-entry after selling
    reentryPenalty?: number;        // Score penalty for re-entry within 24h

    // ── Execution behaviour (profile-controlled, not manually user-editable) ──
    maxOpenPositions?: number;          // Hard cap on simultaneous positions
    requireMomentumForBuy?: boolean;    // Require positive 24h price to open
    rotationMinScoreGap?: number;       // Score gap required to rotate positions
    minProfitableHoldHours?: number;    // Hours profitable position is protected
    aiWatchlistCap?: number;            // Max slots in AI discovery tier
    aiDisplacementMargin?: number;      // Score margin to displace AI slot incumbent
    sandboxBudgetPct?: number;          // Max % of portfolio in sandbox tier
    buyAmountScore90?: number;          // Buy size when score >= 90
    buyAmountScore80?: number;          // Buy size when score >= 80
    buyAmountDefault?: number;          // Buy size for standard conviction
    scalingChunkSize?: number;          // USD amount when scaling into existing position
    strategyLabel?: string;             // Human-readable strategy name
    strategyDescription?: string;       // Full strategy description for AI prompts
    realTradingEnabled?: boolean;   // If false, trades are only recorded in ledger, not executed on exchange

    // ── Custom Strategy Mode ────────────────────────────────────────────────
    customStrategyEnabled?: boolean;    // Master switch — only trade user-provided tokens
    customTokens?: string[];            // User-provided token list (only these are analysed/traded)
    customCycle?: number;               // Analysis cycle for custom tokens (hours)

    // ── Telegram Notification Settings ──────────────────────────────────────
    telegramEnabled?: boolean;               // Master switch for all Telegram notifications
    telegramDailyReportEnabled?: boolean;    // Send end-of-day digest at reportTime
    telegramTradingUpdatesEnabled?: boolean; // Send trade alerts for buys/sells
    telegramReportTime?: string;             // "HH:MM" in UTC, default "17:00"
    telegramLastReportDate?: string;         // ISO date string of last sent EOD report

    // Stop-loss emergency halt
    stopLossTriggered?: boolean;
    stopLossTriggeredAt?: string;
    stopLossPeakValue?: number;
    stopLossCurrentValue?: number;
    stopLossDrawdownPct?: number;
    stopLossResumedAt?: string;
    brainState?: {
        lastActive: string;
        currentAction: string;
        vibe?: {
            multiplier: number;
            globalChange: string;
            fng: number;
            label: string;
        };
        stage?: string;
        cycleComplete?: boolean;
    };
    tradingSectionsOrder?: string[]; // IDs of sections: 'risk', 'automation', 'limits'
    strategicLimitsOrder?: string[]; // IDs of limit fields
    cycle_logs?: any[]; // Telemetry from the last 10 automated Brain cycles
    dailyReflection?: {
        synopsis: string;
        portfolioChange: number;
        marketChange: number;
        generatedAt: string;
        gainers: { ticker: string; change24h: number; score: number | string }[];
    };
    reflectionHistory?: {
        synopsis: string;
        portfolioChange: number;
        marketChange: number;
        generatedAt: string;
        gainers: { ticker: string; change24h: number; score: number | string }[];
    }[];
    selfCorrectionEnabled?: boolean;
    selfCorrectionPrompt?: string; // The dynamically updated partial prompt or feedback loop data

    // ── Discovery Pools (A/B Testing) ───────────────────────────────────────
    discoveryPoolsEnabled?: boolean;  // Master switch for Discovery Pools
}

// Default configuration for new users
const DEFAULT_CONFIG: Omit<AgentConfig, "userId"> = {
    trafficLightTokens: ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"],
    standardTokens: ["ADA", "DOT", "LINK", "AVAX", "HBAR", "LTC", "XLM", "BCH", "TRX", "SHIB"],
    sandboxTokens: [],
    aiWatchlist: ["PEPE", "WIF", "RNDR", "FET", "INJ", "TIA", "ARB", "OP", "NEAR", "AAVE"], // Default AI picks
    excludedTokens: [],
    analysisCycle: 6,
    trafficCycle: 1,
    sandboxCycle: 24,
    aiCycle: 12,
    retentionLimit: 1000,
    riskProfile: 'TACTICAL',
    automationEnabled: false,
    volatilityTriggerEnabled: true,
    rebalanceEnabled: false,
    watchdogEnabled: true,
    watchdogNotificationsEnabled: true,
    positionStopLoss: -15, // Default 15% hard stop
    portfolioStopLoss: 25,
    maxAllocationPerAsset: 200,
    minCashReservePct: 5,
    aiScoreExitThreshold: 50,
    buyScoreThreshold: 55,
    scalingScoreThreshold: 75,
    minMarketCap: 50,
    minOrderAmount: 30,
    realTradingEnabled: true,
    telegramEnabled: false,
    telegramDailyReportEnabled: true,
    telegramTradingUpdatesEnabled: true,
    telegramReportTime: '17:00',
    legacyPnlOffset: 0,
    targetWeights: {
        "BTC": 40,
        "ETH": 30,
        "SOL": 30
    },
    tradingSectionsOrder: ['risk', 'automation', 'intelligence', 'limits'],
    strategicLimitsOrder: [
        'portfolioStopLoss',
        'positionStopLoss',
        'maxAllocationPerAsset',
        'minCashReservePct',
        'aiScoreExitThreshold',
        'buyScoreThreshold',
        'scalingScoreThreshold',
        'minMarketCap',
        'minOrderAmount',
        'antiWashHours',
        'reentryPenalty',
        'maxOpenPositions',
        'minProfitableHoldHours'
    ]
};

export const getAgentConfig = async (userId: string): Promise<AgentConfig> => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        const riskProfile = ((data.riskProfile === 'SAFE' ? 'STEADY' : data.riskProfile === 'BALANCED' ? 'TACTICAL' : data.riskProfile === 'RISK' ? 'ALPHA SWING' : data.riskProfile) || 'TACTICAL') as RiskProfile;
        const defaults = PROFILE_DEFAULTS[riskProfile];

        return {
            userId,
            ...data,
            sandboxTokens: data.sandboxTokens || [],
            aiWatchlist: data.aiWatchlist || [],
            sandboxCycle: data.sandboxCycle || 24,
            aiCycle: data.aiCycle || 12,
            trafficCycle: data.trafficCycle || 1,
            retentionLimit: data.retentionLimit || 1000,
            riskProfile,
            excludedTokens: data.excludedTokens || [],
            watchdogEnabled: data.watchdogEnabled ?? true,
            watchdogNotificationsEnabled: data.watchdogNotificationsEnabled ?? true,
            positionStopLoss: data.positionStopLoss ?? defaults.positionStopLoss,
            portfolioStopLoss: data.portfolioStopLoss ?? defaults.portfolioStopLoss,
            maxAllocationPerAsset: data.maxAllocationPerAsset ?? defaults.maxAllocationPerAsset,
            minCashReservePct: data.minCashReservePct ?? defaults.minCashReservePct,
            aiScoreExitThreshold: data.aiScoreExitThreshold ?? defaults.aiScoreExitThreshold,
            buyScoreThreshold: data.buyScoreThreshold ?? defaults.buyScoreThreshold,
            scalingScoreThreshold: data.scalingScoreThreshold ?? defaults.scalingScoreThreshold,
            minMarketCap: data.minMarketCap ?? defaults.minMarketCap,
            minOrderAmount: data.minOrderAmount ?? defaults.minOrderAmount,
            antiWashHours: data.antiWashHours ?? defaults.antiWashHours,
            reentryPenalty: data.reentryPenalty ?? defaults.reentryPenalty,
            realTradingEnabled: data.realTradingEnabled ?? true,
            telegramEnabled: data.telegramEnabled ?? false,
            telegramDailyReportEnabled: data.telegramDailyReportEnabled ?? true,
            telegramTradingUpdatesEnabled: data.telegramTradingUpdatesEnabled ?? true,
            telegramReportTime: data.telegramReportTime ?? '17:00',
            telegramLastReportDate: data.telegramLastReportDate,
            // Execution behaviour — read from Firestore if set, otherwise from profile defaults
            maxOpenPositions: data.maxOpenPositions ?? defaults.maxOpenPositions,
            requireMomentumForBuy: data.requireMomentumForBuy ?? defaults.requireMomentumForBuy,
            rotationMinScoreGap: data.rotationMinScoreGap ?? defaults.rotationMinScoreGap,
            minProfitableHoldHours: data.minProfitableHoldHours ?? defaults.minProfitableHoldHours,
            aiWatchlistCap: data.aiWatchlistCap ?? defaults.aiWatchlistCap,
            aiDisplacementMargin: data.aiDisplacementMargin ?? defaults.aiDisplacementMargin,
            sandboxBudgetPct: data.sandboxBudgetPct ?? defaults.sandboxBudgetPct,
            buyAmountScore90: data.buyAmountScore90 ?? defaults.buyAmountScore90,
            buyAmountScore80: data.buyAmountScore80 ?? defaults.buyAmountScore80,
            buyAmountDefault: data.buyAmountDefault ?? defaults.buyAmountDefault,
            scalingChunkSize: data.scalingChunkSize ?? defaults.scalingChunkSize,
            strategyLabel: data.strategyLabel ?? defaults.strategyLabel,
            strategyDescription: data.strategyDescription ?? defaults.strategyDescription,
            customStrategyEnabled: data.customStrategyEnabled ?? false,
            customTokens: data.customTokens || [],
            customCycle: data.customCycle ?? data.analysisCycle ?? 6,
            revolutProxyUrl: data.revolutProxyUrl || "",
            tradingSectionsOrder: data.tradingSectionsOrder
                ? (data.tradingSectionsOrder.includes('intelligence')
                    ? data.tradingSectionsOrder
                    : [...data.tradingSectionsOrder, 'intelligence'])
                : ['risk', 'automation', 'intelligence', 'limits'],
            strategicLimitsOrder: (() => {
                let order = data.strategicLimitsOrder || [
                    'portfolioStopLoss',
                    'positionStopLoss',
                    'maxAllocationPerAsset',
                    'minCashReservePct',
                    'aiScoreExitThreshold',
                    'buyScoreThreshold',
                    'scalingScoreThreshold',
                    'minMarketCap',
                    'minOrderAmount',
                    'antiWashHours',
                    'reentryPenalty',
                    'maxOpenPositions',
                    'minProfitableHoldHours'
                ];
                // Migration: append new fields if missing
                if (!order.includes('minOrderAmount')) order = [...order, 'minOrderAmount'];
                if (!order.includes('antiWashHours')) order = [...order, 'antiWashHours'];
                if (!order.includes('reentryPenalty')) order = [...order, 'reentryPenalty'];
                if (!order.includes('maxOpenPositions')) order = [...order, 'maxOpenPositions'];
                if (!order.includes('minProfitableHoldHours')) order = [...order, 'minProfitableHoldHours'];
                return order;
            })()
        } as AgentConfig;
    } else {
        // Create default if not exists
        const newConfig: AgentConfig = { userId, ...DEFAULT_CONFIG };
        await setDoc(docRef, newConfig);
        return newConfig;
    }
};

export const updateTrafficLightTokens = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { trafficLightTokens: tokens });
};

export const updateStandardTokens = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { standardTokens: tokens });
};

export const updateSandboxTokens = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { sandboxTokens: tokens });
};

export const updateAiWatchlist = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { aiWatchlist: tokens });
};

export const addTokenToAgent = async (userId: string, ticker: string, listType: 'traffic' | 'standard' | 'sandbox' | 'ai') => {
    const config = await getAgentConfig(userId);
    const upperTicker = ticker.toUpperCase();

    if (listType === 'traffic') {
        const list = [...config.trafficLightTokens, upperTicker].slice(0, WATCHLIST_CAPACITIES.traffic);
        await updateTrafficLightTokens(userId, list);
    } else if (listType === 'standard') {
        const list = [...config.standardTokens, upperTicker].slice(0, WATCHLIST_CAPACITIES.standard);
        await updateStandardTokens(userId, list);
    } else if (listType === 'sandbox') {
        const list = [...(config.sandboxTokens || []), upperTicker].slice(0, WATCHLIST_CAPACITIES.sandbox);
        await updateSandboxTokens(userId, list);
    } else if (listType === 'ai') {
        const list = [...(config.aiWatchlist || []), upperTicker].slice(0, WATCHLIST_CAPACITIES.ai);
        await updateAiWatchlist(userId, list);
    }
};

export const removeTokenFromAgent = async (userId: string, ticker: string) => {
    const config = await getAgentConfig(userId);
    const upperTicker = ticker.toUpperCase();

    const traffic = config.trafficLightTokens.filter(t => t !== upperTicker);
    const standard = config.standardTokens.filter(t => t !== upperTicker);
    const sandbox = (config.sandboxTokens || []).filter(t => t !== upperTicker);
    const ai = (config.aiWatchlist || []).filter(t => t !== upperTicker);

    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, {
        trafficLightTokens: traffic,
        standardTokens: standard,
        sandboxTokens: sandbox,
        aiWatchlist: ai
    });
};

export const updateAnalysisCycle = async (userId: string, hours: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { analysisCycle: hours });
};

export const updateTrafficCycle = async (userId: string, hours: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { trafficCycle: hours });
};

export const updateSandboxCycle = async (userId: string, hours: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { sandboxCycle: hours });
};

export const updateAiCycle = async (userId: string, hours: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { aiCycle: hours });
};

export const updateAutomationSetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { automationEnabled: enabled });
};

export const updateVolatilitySetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { volatilityTriggerEnabled: enabled });
};

export const updateRebalanceSetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { rebalanceEnabled: enabled });
};

export const updateRetentionLimit = async (userId: string, limit: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { retentionLimit: limit });
};

export const updateRealTradingSetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { realTradingEnabled: enabled });
};

export const updateRiskProfile = async (userId: string, profile: RiskProfile) => {
    const docRef = doc(db, COLLECTION_NAME, userId);

    // CRITICAL: When switching profiles, we must DELETE all custom overrides
    // so that getServerAgentConfig falls through to the new profile's defaults.
    // Without this, stale values (e.g. maxAllocationPerAsset: 90 from a previous
    // profile/custom edit) persist and override the new profile's defaults.
    const { deleteField } = await import('firebase/firestore');

    const fieldsToReset = [
        'positionStopLoss', 'portfolioStopLoss', 'maxAllocationPerAsset',
        'minCashReservePct', 'aiScoreExitThreshold', 'buyScoreThreshold',
        'scalingScoreThreshold', 'minMarketCap', 'minOrderAmount',
        'maxOpenPositions', 'requireMomentumForBuy', 'rotationMinScoreGap',
        'minProfitableHoldHours', 'aiWatchlistCap', 'aiDisplacementMargin',
        'sandboxBudgetPct', 'buyAmountScore90', 'buyAmountScore80',
        'buyAmountDefault', 'scalingChunkSize', 'antiWashHours',
        'reentryPenalty', 'entrySizeMultiplier', 'strategyLabel',
        'strategyDescription',
    ];

    const resetUpdate: Record<string, any> = { riskProfile: profile };
    for (const field of fieldsToReset) {
        resetUpdate[field] = deleteField();
    }

    await updateDoc(docRef, resetUpdate);
};

export const updateCustomLimits = async (userId: string, limits: {
    positionStopLoss?: number,
    portfolioStopLoss?: number,
    maxAllocationPerAsset?: number,
    minCashReservePct?: number,
    aiScoreExitThreshold?: number,
    buyScoreThreshold?: number,
    scalingScoreThreshold?: number,
    minMarketCap?: number,
    minOrderAmount?: number,
    antiWashHours?: number,
    reentryPenalty?: number,
    maxOpenPositions?: number,
    minProfitableHoldHours?: number
}) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, limits);
};

export const updateLegacyPnlOffset = async (userId: string, offset: number) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { legacyPnlOffset: offset });
};

export const updateExcludedTokens = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { excludedTokens: tokens });
};

export const updateWatchdogSetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { watchdogEnabled: enabled });
};

export const updateWatchdogNotificationsSetting = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { watchdogNotificationsEnabled: enabled });
};

export const updateRevolutConfig = async (userId: string, data: { apiKey?: string, privateKey?: string, isSandbox?: boolean, proxyUrl?: string }) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    const updateData: any = {};
    if (data.apiKey !== undefined) updateData.revolutApiKey = data.apiKey;
    if (data.privateKey !== undefined) updateData.revolutPrivateKey = data.privateKey;
    if (data.isSandbox !== undefined) updateData.revolutIsSandbox = data.isSandbox;
    if (data.proxyUrl !== undefined) updateData.revolutProxyUrl = data.proxyUrl;
    await updateDoc(docRef, updateData);
};

export const resetAgentTimeline = async (userId: string) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { lastCheck: {} });
};

export const updateTradingSectionsOrder = async (userId: string, order: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { tradingSectionsOrder: order });
};

export const updateStrategicLimitsOrder = async (userId: string, order: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { strategicLimitsOrder: order });
};

export const updateCustomStrategy = async (userId: string, enabled: boolean) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, { customStrategyEnabled: enabled });
};

export const updateCustomTokens = async (userId: string, tokens: string[]) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    await updateDoc(docRef, {
        customTokens: tokens.map(t => t.toUpperCase().trim()).filter(Boolean)
    });
};

export const updateTelegramConfig = async (userId: string, data: {
    telegramEnabled?: boolean;
    telegramDailyReportEnabled?: boolean;
    telegramTradingUpdatesEnabled?: boolean;
    telegramReportTime?: string;
}) => {
    const docRef = doc(db, COLLECTION_NAME, userId);
    const update: any = {};
    if (data.telegramEnabled !== undefined) update.telegramEnabled = data.telegramEnabled;
    if (data.telegramDailyReportEnabled !== undefined) update.telegramDailyReportEnabled = data.telegramDailyReportEnabled;
    if (data.telegramTradingUpdatesEnabled !== undefined) update.telegramTradingUpdatesEnabled = data.telegramTradingUpdatesEnabled;
    if (data.telegramReportTime !== undefined) update.telegramReportTime = data.telegramReportTime;
    await updateDoc(docRef, update);
};
