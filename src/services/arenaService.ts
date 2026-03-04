/**
 * ARENA SERVICE — Four-Pool Competition Engine
 *
 * Manages the lifecycle of four competing trading pools:
 *   - Initialization (AI selects 8 tokens into 4 pairs)
 *   - Trade execution (AI makes buy/sell decisions per pool)
 *   - Weekly strategy reviews (AI can change parameters, not tokens)
 *   - Performance tracking and comparison
 *   - Trade memory and reflection for AI learning
 */

import { adminDb } from '@/lib/firebase-admin';
import {
    type ArenaConfig, type ArenaPool, type ArenaTradeRecord,
    type PoolStrategy, type PoolId, type PoolPerformance,
    type TradeReflection, type WeeklyReview, type StrategyChange,
    ARENA_START_DATE, ARENA_DURATION_DAYS, ARENA_WEEK_LENGTH,
    POOL_COUNT, POOL_BUDGET, TOTAL_BUDGET, TOKENS_PER_POOL,
} from '@/lib/constants';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const ARENA_COLLECTION = 'arena_config';
const ARENA_TRADES_COLLECTION = 'arena_trades';
const ARENA_REFLECTIONS_COLLECTION = 'arena_reflections';
const ARENA_SNAPSHOTS_COLLECTION = 'arena_snapshots';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function safeNum(val: any): number {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
}

function getCurrentWeek(): number {
    const start = new Date(ARENA_START_DATE).getTime();
    const now = Date.now();
    const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    if (daysPassed < 0) return 0; // Not started yet
    return Math.min(Math.floor(daysPassed / ARENA_WEEK_LENGTH) + 1, 4);
}

function getDayNumber(): number {
    const start = new Date(ARENA_START_DATE).getTime();
    const now = Date.now();
    const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return Math.max(0, Math.min(daysPassed + 1, ARENA_DURATION_DAYS));
}

function isArenaActive(): boolean {
    const day = getDayNumber();
    return day >= 1 && day <= ARENA_DURATION_DAYS;
}

function isWeeklyReviewDue(pool: ArenaPool): boolean {
    const currentWeek = getCurrentWeek();
    if (currentWeek <= 1) return false;
    // Review is due if we haven't reviewed for this week boundary
    const lastReviewWeek = pool.weeklyReviews.length > 0
        ? Math.max(...pool.weeklyReviews.map(r => r.week))
        : 0;
    return currentWeek > lastReviewWeek && currentWeek > 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Get the arena config for a user. */
export async function getArenaConfig(userId: string): Promise<ArenaConfig | null> {
    if (!adminDb) return null;
    const doc = await adminDb.collection(ARENA_COLLECTION).doc(userId).get();
    return doc.exists ? doc.data() as ArenaConfig : null;
}

/** Initialize the arena with 4 pools, tokens selected by AI. */
export async function initializeArena(
    userId: string,
    poolConfigs: {
        pool1: { name: string; emoji: string; tokens: [string, string]; strategy: PoolStrategy; reasoning: string };
        pool2: { name: string; emoji: string; tokens: [string, string]; strategy: PoolStrategy; reasoning: string };
        pool3: { name: string; emoji: string; tokens: [string, string]; strategy: PoolStrategy; reasoning: string };
        pool4: { name: string; emoji: string; tokens: [string, string]; strategy: PoolStrategy; reasoning: string };
    }
): Promise<{ success: boolean; message: string }> {
    if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };

    // Check if arena already exists
    const existing = await getArenaConfig(userId);
    if (existing?.initialized) {
        return { success: false, message: 'Arena already initialized. Cannot re-initialize during a competition.' };
    }

    // Verify all tokens are unique
    const allTokens = [
        ...poolConfigs.pool1.tokens,
        ...poolConfigs.pool2.tokens,
        ...poolConfigs.pool3.tokens,
        ...poolConfigs.pool4.tokens,
    ].map(t => t.toUpperCase());

    if (new Set(allTokens).size !== allTokens.length) {
        return { success: false, message: 'All 8 tokens must be unique across all pools.' };
    }

    const now = new Date().toISOString();
    const endDate = new Date(new Date(ARENA_START_DATE).getTime() + ARENA_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    function createPool(poolId: PoolId, config: typeof poolConfigs.pool1): ArenaPool {
        const emptyPerformance: PoolPerformance = {
            startDate: ARENA_START_DATE,
            totalPnl: 0,
            totalPnlPct: 0,
            winCount: 0,
            lossCount: 0,
            totalTrades: 0,
            bestTrade: null,
            worstTrade: null,
            dailySnapshots: [],
        };

        return {
            poolId,
            name: config.name,
            emoji: config.emoji,
            tokens: [config.tokens[0].toUpperCase(), config.tokens[1].toUpperCase()],
            strategy: config.strategy,
            strategyHistory: [],
            budget: POOL_BUDGET,
            cashBalance: POOL_BUDGET,
            holdings: {},
            performance: emptyPerformance,
            createdAt: now,
            status: 'ACTIVE',
            selectionReasoning: config.reasoning,
            weeklyReviews: [],
        };
    }

    const arena: ArenaConfig = {
        userId,
        startDate: ARENA_START_DATE,
        endDate,
        currentWeek: getCurrentWeek(),
        pools: [
            createPool('POOL_1', poolConfigs.pool1),
            createPool('POOL_2', poolConfigs.pool2),
            createPool('POOL_3', poolConfigs.pool3),
            createPool('POOL_4', poolConfigs.pool4),
        ],
        tokensLocked: true,
        totalBudget: TOTAL_BUDGET,
        initialized: true,
    };

    await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);

    console.log(`[Arena] ✅ Initialized 4 pools for user ${userId.substring(0, 8)}`);
    console.log(`[Arena] Pool 1: ${poolConfigs.pool1.emoji} ${poolConfigs.pool1.name} [${poolConfigs.pool1.tokens.join(', ')}]`);
    console.log(`[Arena] Pool 2: ${poolConfigs.pool2.emoji} ${poolConfigs.pool2.name} [${poolConfigs.pool2.tokens.join(', ')}]`);
    console.log(`[Arena] Pool 3: ${poolConfigs.pool3.emoji} ${poolConfigs.pool3.name} [${poolConfigs.pool3.tokens.join(', ')}]`);
    console.log(`[Arena] Pool 4: ${poolConfigs.pool4.emoji} ${poolConfigs.pool4.name} [${poolConfigs.pool4.tokens.join(', ')}]`);

    return { success: true, message: `Arena initialized with $${TOTAL_BUDGET} across ${POOL_COUNT} pools.` };
}

/** Get all trades for a specific pool or all pools. */
export async function getArenaTrades(userId: string, poolId?: PoolId): Promise<ArenaTradeRecord[]> {
    if (!adminDb) return [];
    let q = adminDb.collection(ARENA_TRADES_COLLECTION)
        .where('userId', '==', userId)
        .limit(200);

    if (poolId) {
        q = adminDb.collection(ARENA_TRADES_COLLECTION)
            .where('userId', '==', userId)
            .where('poolId', '==', poolId)
            .limit(100);
    }

    const snap = await q.get();
    const trades = snap.docs.map(d => ({ id: d.id, ...d.data() } as ArenaTradeRecord));
    return trades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** Record a trade in the arena. */
export async function recordArenaTrade(trade: Omit<ArenaTradeRecord, 'id'>): Promise<string> {
    if (!adminDb) throw new Error('Admin SDK not initialized');
    const ref = await adminDb.collection(ARENA_TRADES_COLLECTION).add({
        ...trade,
        createdAt: new Date().toISOString(),
    });
    return ref.id;
}

/** Record a trade reflection. */
export async function recordTradeReflection(reflection: TradeReflection): Promise<void> {
    if (!adminDb) return;
    await adminDb.collection(ARENA_REFLECTIONS_COLLECTION).add({
        ...reflection,
        createdAt: new Date().toISOString(),
    });
}

/** Get trade reflections for learning context. */
export async function getTradeReflections(
    userId: string,
    poolId: PoolId,
    ticker?: string,
    limit: number = 20,
): Promise<TradeReflection[]> {
    if (!adminDb) return [];

    let q = adminDb.collection(ARENA_REFLECTIONS_COLLECTION)
        .where('poolId', '==', poolId)
        .orderBy('createdAt', 'desc')
        .limit(limit);

    const snap = await q.get();
    const reflections = snap.docs.map(d => d.data() as TradeReflection);

    if (ticker) {
        return reflections.filter(r => r.ticker === ticker.toUpperCase());
    }
    return reflections;
}

// ═══════════════════════════════════════════════════════════════════════════
// POOL VALUE & PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

/** Calculate total value of a pool (cash + holdings). */
export function getPoolTotalValue(
    pool: ArenaPool,
    prices: Record<string, { price: number }>,
): number {
    let holdingsValue = 0;
    for (const [ticker, holding] of Object.entries(pool.holdings)) {
        const price = prices[ticker.toUpperCase()]?.price || holding.averagePrice;
        holdingsValue += safeNum(holding.amount) * safeNum(price);
    }
    return safeNum(pool.cashBalance) + holdingsValue;
}

/** Update pool performance metrics. */
export function updatePoolPerformance(
    pool: ArenaPool,
    prices: Record<string, { price: number }>,
): void {
    const totalValue = getPoolTotalValue(pool, prices);
    pool.performance.totalPnl = totalValue - pool.budget;
    pool.performance.totalPnlPct = pool.budget > 0
        ? ((totalValue - pool.budget) / pool.budget) * 100
        : 0;
}

/** Record a daily snapshot for a pool. */
export async function recordDailySnapshot(
    userId: string,
    poolId: PoolId,
    value: number,
    pnlPct: number,
): Promise<void> {
    if (!adminDb) return;
    const today = new Date().toISOString().split('T')[0];
    const docRef = adminDb.collection(ARENA_SNAPSHOTS_COLLECTION)
        .doc(userId)
        .collection(poolId)
        .doc(today);

    await docRef.set({
        date: today,
        value,
        pnlPct,
        recordedAt: new Date().toISOString(),
    }, { merge: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADE EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

/** Execute a buy trade within a pool. */
export async function executePoolBuy(
    userId: string,
    pool: ArenaPool,
    ticker: string,
    amount: number,
    price: number,
    reason: string,
    marketContext: ArenaTradeRecord['marketContext'],
    preTradeReflection: string,
): Promise<{ success: boolean; trade?: ArenaTradeRecord; error?: string }> {
    if (!adminDb) return { success: false, error: 'Admin SDK not initialized' };

    const upperTicker = ticker.toUpperCase();
    const total = amount * price;

    // Validate
    if (!pool.tokens.includes(upperTicker)) {
        return { success: false, error: `Token ${upperTicker} not in pool ${pool.poolId}` };
    }
    if (total > pool.cashBalance) {
        return { success: false, error: `Insufficient cash: need $${total.toFixed(2)}, have $${pool.cashBalance.toFixed(2)}` };
    }

    // Update pool state
    const holding = pool.holdings[upperTicker] || { amount: 0, averagePrice: 0, peakPrice: 0 };
    const oldTotal = holding.amount * holding.averagePrice;
    const newAmount = holding.amount + amount;
    const newAvgPrice = (oldTotal + total) / newAmount;

    pool.holdings[upperTicker] = {
        amount: newAmount,
        averagePrice: newAvgPrice,
        peakPrice: Math.max(holding.peakPrice || 0, price),
        boughtAt: new Date().toISOString(),
    };
    pool.cashBalance -= total;
    pool.performance.totalTrades++;

    const trade: Omit<ArenaTradeRecord, 'id'> = {
        userId,
        poolId: pool.poolId,
        poolName: pool.name,
        ticker: upperTicker,
        type: 'BUY',
        amount,
        price,
        total,
        reason,
        date: new Date().toISOString(),
        createdAt: null,
        marketContext,
        preTradeReflection,
    };

    const tradeId = await recordArenaTrade(trade);

    // Save updated arena config
    const arena = await getArenaConfig(userId);
    if (arena) {
        const poolIdx = arena.pools.findIndex(p => p.poolId === pool.poolId);
        if (poolIdx >= 0) {
            arena.pools[poolIdx] = pool;
            await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);
        }
    }

    return { success: true, trade: { ...trade, id: tradeId } as ArenaTradeRecord };
}

/** Execute a sell trade within a pool. */
export async function executePoolSell(
    userId: string,
    pool: ArenaPool,
    ticker: string,
    amount: number,
    price: number,
    reason: string,
    marketContext: ArenaTradeRecord['marketContext'],
    preTradeReflection: string,
): Promise<{ success: boolean; trade?: ArenaTradeRecord; pnl?: number; pnlPct?: number; error?: string }> {
    if (!adminDb) return { success: false, error: 'Admin SDK not initialized' };

    const upperTicker = ticker.toUpperCase();
    const holding = pool.holdings[upperTicker];

    if (!holding || holding.amount <= 0) {
        return { success: false, error: `No holdings of ${upperTicker} in pool ${pool.poolId}` };
    }

    const sellAmount = Math.min(amount, holding.amount);
    const total = sellAmount * price;
    const costBasis = sellAmount * holding.averagePrice;
    const pnl = total - costBasis;
    const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

    // Update holdings
    const remainingAmount = holding.amount - sellAmount;
    if (remainingAmount < 0.000001) {
        delete pool.holdings[upperTicker];
    } else {
        pool.holdings[upperTicker] = {
            ...holding,
            amount: remainingAmount,
        };
    }

    pool.cashBalance += total;
    pool.performance.totalTrades++;

    // Track wins/losses
    if (pnl >= 0) {
        pool.performance.winCount++;
        if (!pool.performance.bestTrade || pnlPct > pool.performance.bestTrade.pnlPct) {
            pool.performance.bestTrade = { ticker: upperTicker, pnlPct };
        }
    } else {
        pool.performance.lossCount++;
        if (!pool.performance.worstTrade || pnlPct < pool.performance.worstTrade.pnlPct) {
            pool.performance.worstTrade = { ticker: upperTicker, pnlPct };
        }
    }

    const trade: Omit<ArenaTradeRecord, 'id'> = {
        userId,
        poolId: pool.poolId,
        poolName: pool.name,
        ticker: upperTicker,
        type: 'SELL',
        amount: sellAmount,
        price,
        total,
        reason,
        pnl,
        pnlPct,
        date: new Date().toISOString(),
        createdAt: null,
        marketContext,
        preTradeReflection,
    };

    const tradeId = await recordArenaTrade(trade);

    // Record post-trade reflection for learning
    await recordTradeReflection({
        tradeId,
        poolId: pool.poolId,
        ticker: upperTicker,
        type: 'SELL',
        price,
        total,
        reasoning: reason,
        marketConditionsAtTrade: {
            ...marketContext,
            timestamp: new Date().toISOString(),
        },
        outcome: {
            pnl,
            pnlPct,
            holdDurationHours: holding.boughtAt
                ? (Date.now() - new Date(holding.boughtAt).getTime()) / (1000 * 60 * 60)
                : 0,
            marketChangeAfterTrade: 0, // Updated later
            assessedAt: new Date().toISOString(),
            lessonLearned: preTradeReflection,
        },
    });

    // Save updated arena config
    const arena = await getArenaConfig(userId);
    if (arena) {
        const poolIdx = arena.pools.findIndex(p => p.poolId === pool.poolId);
        if (poolIdx >= 0) {
            arena.pools[poolIdx] = pool;
            await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);
        }
    }

    return { success: true, trade: { ...trade, id: tradeId } as ArenaTradeRecord, pnl, pnlPct };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY REVIEW
// ═══════════════════════════════════════════════════════════════════════════

/** Record a weekly review for a pool. */
export async function recordWeeklyReview(
    userId: string,
    poolId: PoolId,
    review: WeeklyReview,
    newStrategy?: PoolStrategy,
): Promise<void> {
    if (!adminDb) return;

    const arena = await getArenaConfig(userId);
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    const pool = arena.pools[poolIdx];

    // Record the review
    pool.weeklyReviews.push(review);

    // Apply strategy changes if any
    if (newStrategy && review.strategyChanged) {
        const change: StrategyChange = {
            week: review.week,
            previousStrategy: { ...pool.strategy },
            newStrategy,
            reasoning: review.aiReflection,
            changedAt: new Date().toISOString(),
        };
        pool.strategyHistory.push(change);
        pool.strategy = newStrategy;
    }

    arena.pools[poolIdx] = pool;
    await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);
}

/** Pause a pool (e.g., after hitting stop-loss). */
export async function pauseArenaPool(
    userId: string,
    poolId: PoolId,
    reason: string,
): Promise<void> {
    if (!adminDb) return;
    const arena = await getArenaConfig(userId);
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    arena.pools[poolIdx].status = 'PAUSED';
    arena.pools[poolIdx].pauseReason = reason;
    await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);
}

/** Resume a paused pool. */
export async function resumeArenaPool(
    userId: string,
    poolId: PoolId,
): Promise<void> {
    if (!adminDb) return;
    const arena = await getArenaConfig(userId);
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    arena.pools[poolIdx].status = 'ACTIVE';
    arena.pools[poolIdx].pauseReason = undefined;
    await adminDb.collection(ARENA_COLLECTION).doc(userId).set(arena);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
    getCurrentWeek,
    getDayNumber,
    isArenaActive,
    isWeeklyReviewDue,
    safeNum,
};
