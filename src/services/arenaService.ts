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
    type DcaConfig, type DcaContributionRecord,
    ARENA_START_DATE, ARENA_DURATION_DAYS, ARENA_WEEK_LENGTH,
    POOL_COUNT, POOL_BUDGET, TOTAL_BUDGET, TOKENS_PER_POOL,
    type AssetClass, getArenaCollections,
} from '@/lib/constants';


// Collection names are now dynamic per asset class.
// Use col(assetClass).config / .trades etc. rather than these hardcoded strings.
// These legacy constants are kept ONLY for backward-compat references inside this file.
const _CRYPTO_COLS = getArenaCollections('CRYPTO');
const ARENA_COLLECTION = _CRYPTO_COLS.config;
const ARENA_TRADES_COLLECTION = _CRYPTO_COLS.trades;
const ARENA_REFLECTIONS_COLLECTION = _CRYPTO_COLS.reflections;
const ARENA_SNAPSHOTS_COLLECTION = _CRYPTO_COLS.snapshots;

// Shorthand for getting namespaced collections from an assetClass argument
function col(assetClass: AssetClass = 'CRYPTO') {
    return getArenaCollections(assetClass);
}


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

/**
 * Dynamic strategy review gate.
 * AI agents can review and change their own strategies based on multiple triggers:
 *   1. Weekly boundary (as before)
 *   2. 5+ trades since last review (active trading warrants re-evaluation)
 *   3. P&L dropped 3%+ since last review (performance deterioration)
 *   4. Minimum 6 hours since last review (prevent over-reviewing)
 */
export function isDynamicReviewDue(pool: ArenaPool): boolean {
    const currentWeek = getCurrentWeek();
    const lastReview = pool.weeklyReviews.length > 0
        ? pool.weeklyReviews[pool.weeklyReviews.length - 1]
        : null;

    // Don't review in the first 3 hours (let the pool establish positions)
    if (getDayNumber() <= 1 && !lastReview) {
        const arenaStart = new Date(ARENA_START_DATE).getTime();
        const hoursSinceStart = (Date.now() - arenaStart) / (1000 * 60 * 60);
        if (hoursSinceStart < 3) return false;
    }

    // COST SAVING: Minimum cooldown increased to 12 hours between reviews (was 6)
    if (lastReview) {
        const hoursSinceLastReview = (Date.now() - new Date(lastReview.timestamp).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastReview < 12) return false;
    }

    // Trigger 1: Weekly boundary (existing behavior)
    if (currentWeek > 1) {
        const lastReviewWeek = lastReview?.week || 0;
        if (currentWeek > lastReviewWeek) return true;
    }

    // Trigger 2: Enough trades since last review to warrant re-evaluation
    const tradesSinceLastReview = lastReview
        ? pool.performance.totalTrades - (lastReview.trades || 0)
        : pool.performance.totalTrades;
    // COST SAVING: Doubled trade trigger to 10 trades (was 5)
    if (tradesSinceLastReview >= 10) return true;

    // Trigger 3: P&L deterioration — pool is down 3%+ since last review
    if (lastReview) {
        const pnlDelta = pool.performance.totalPnlPct - lastReview.pnlPct;
        if (pnlDelta <= -3) return true;
    }

    // Trigger 4: First review — run after first day if no review yet
    if (!lastReview && pool.performance.totalTrades >= 2) return true;

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/** Get the arena config for a user. assetClass defaults to 'CRYPTO' for backward compat. */
export async function getArenaConfig(userId: string, assetClass: AssetClass = 'CRYPTO'): Promise<ArenaConfig | null> {
    if (!adminDb) return null;
    const doc = await adminDb.collection(col(assetClass).config).doc(userId).get();
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
    },
    assetClass: AssetClass = 'CRYPTO',
): Promise<{ success: boolean; message: string }> {
    if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };

    // Check if arena already exists
    const existing = await getArenaConfig(userId, assetClass);
    if (existing?.initialized) {
        const isSandbox = assetClass !== 'CRYPTO';
        if (!isSandbox) {
            return { success: false, message: 'Arena already initialized. Cannot re-initialize during a competition.' };
        }
        // Sandbox arenas can be reset — reset handled by resetSandboxArena()
        return { success: false, message: 'Sandbox arena already initialized. Use resetSandboxArena() to reset.' };
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
    const isSandbox = assetClass !== 'CRYPTO';
    // Sandbox: open-ended (no 28-day timer). Competition: standard 28 days.
    const startDate = isSandbox ? now : ARENA_START_DATE;
    const endDate = new Date(new Date(startDate).getTime() + ARENA_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    function createPool(poolId: PoolId, config: typeof poolConfigs.pool1): ArenaPool {
        const emptyPerformance: PoolPerformance = {
            startDate,
            totalPnl: 0,
            totalPnlPct: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
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

    const arena: ArenaConfig & { sandboxMode?: boolean; assetClass?: AssetClass; competitionMode?: boolean } = {
        userId,
        startDate,
        endDate,
        currentWeek: isSandbox ? 1 : getCurrentWeek(),
        pools: [
            createPool('POOL_1', poolConfigs.pool1),
            createPool('POOL_2', poolConfigs.pool2),
            createPool('POOL_3', poolConfigs.pool3),
            createPool('POOL_4', poolConfigs.pool4),
        ],
        tokensLocked: true,
        totalBudget: isSandbox ? POOL_COUNT * POOL_BUDGET : TOTAL_BUDGET,
        initialized: true,
        sandboxMode: isSandbox,
        assetClass,
        competitionMode: !isSandbox,
    };

    await adminDb.collection(col(assetClass).config).doc(userId).set(arena);

    console.log(`[Arena:${assetClass}] ✅ Initialized 4 pools for user ${userId.substring(0, 8)} [${isSandbox ? 'SANDBOX' : 'COMPETITION'}]`);

    const displayBudget = isSandbox ? POOL_COUNT * POOL_BUDGET : TOTAL_BUDGET;
    return { success: true, message: `${assetClass} arena initialized with £/$${displayBudget} across ${POOL_COUNT} pools. Mode: ${isSandbox ? 'SANDBOX' : 'COMPETITION'}.` };
}


/** Get all trades for a specific pool or all pools. */
export async function getArenaTrades(userId: string, poolId?: PoolId, assetClass: AssetClass = 'CRYPTO'): Promise<ArenaTradeRecord[]> {
    if (!adminDb) return [];
    let q = adminDb.collection(col(assetClass).trades)
        .where('userId', '==', userId)
        .limit(200);

    if (poolId) {
        q = adminDb.collection(col(assetClass).trades)
            .where('userId', '==', userId)
            .where('poolId', '==', poolId)
            .limit(100);
    }

    const snap = await q.get();
    const trades = snap.docs.map(d => ({ id: d.id, ...d.data() } as ArenaTradeRecord));
    return trades.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}


/** Record a trade in the arena. */
export async function recordArenaTrade(trade: Omit<ArenaTradeRecord, 'id'>, assetClass: AssetClass = 'CRYPTO'): Promise<string> {
    if (!adminDb) throw new Error('Admin SDK not initialized');
    const ref = await adminDb.collection(col(assetClass).trades).add({
        ...trade,
        createdAt: new Date().toISOString(),
    });
    return ref.id;
}


/** Record a trade reflection. */
export async function recordTradeReflection(reflection: TradeReflection, assetClass: AssetClass = 'CRYPTO'): Promise<void> {
    if (!adminDb) return;
    await adminDb.collection(col(assetClass).reflections).add({
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
    assetClass: AssetClass = 'CRYPTO',
): Promise<TradeReflection[]> {
    if (!adminDb) return [];

    let q = adminDb.collection(col(assetClass).reflections)
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

/** Calculate total value of a pool (holdings only — cash is now arena-level sharedCash). */
export function getPoolTotalValue(
    pool: ArenaPool,
    prices: Record<string, { price: number }>,
): number {
    let holdingsValue = 0;
    for (const [ticker, holding] of Object.entries(pool.holdings)) {
        const price = prices[ticker.toUpperCase()]?.price || holding.averagePrice;
        holdingsValue += safeNum(holding.amount) * safeNum(price);
    }
    // pool.cashBalance is now a transit field (0 in normal operation).
    // Include it so in-flight buys are counted correctly.
    return safeNum(pool.cashBalance) + holdingsValue;
}

/** Update pool performance metrics (all arenas use shared-cash model).
 *  value  = token holdings at live prices (pool.cashBalance always 0)
 *  pnlPct = token delta vs actual holding cost (averagePrice × amount)
 */
export function updatePoolPerformance(
    pool: ArenaPool,
    prices: Record<string, { price: number }>,
): void {
    const totalValue = getPoolTotalValue(pool, prices); // tokens + cashBalance (cashBalance is 0)

    // Cost basis of current holdings — what was actually paid for the current tokens
    let holdCost = 0;
    for (const h of Object.values(pool.holdings)) {
        holdCost += safeNum(h.amount) * safeNum(h.averagePrice);
    }

    const unrealizedPnl = totalValue - holdCost;
    const realizedPnl = pool.performance.realizedPnl || 0;

    pool.performance.unrealizedPnl = unrealizedPnl;
    pool.performance.totalPnl = realizedPnl + unrealizedPnl;

    // P&L % is relative to the pool's own budget + DCA contributions
    const capitalBase = (pool.budget || 150) + (pool.dcaContributions || 0);

    pool.performance.totalPnlPct = capitalBase > 0
        ? (pool.performance.totalPnl / capitalBase) * 100
        : 0;
}


/**
 * Record a daily snapshot for a pool.
 *
 * Writes to TWO places:
 *   1. arena_snapshots/{userId}/{poolId}/{date}   — sub-collection for audit/query
 *   2. arena_config.pools[poolId].performance.dailySnapshots — embedded array the
 *      performance chart reads. Without this second write the chart only ever has
 *      2 points (Start + Today) because getPerformanceHistory reads from this array.
 *
 * The array is keyed by date (YYYY-MM-DD). We upsert: if an entry for today
 * already exists we overwrite it with the latest value; otherwise we append.
 * Called every 3-minute cron cycle, so multiple calls per day are safe.
 */
export async function recordDailySnapshot(
    userId: string,
    poolId: PoolId,
    value: number,
    pnlPct: number,
    assetClass: AssetClass = 'CRYPTO',
    metadata?: { btcPrice?: number; holdings?: Record<string, { amount: number; price: number; value: number }> },
): Promise<void> {
    if (!adminDb) return;
    const nowISO = new Date().toISOString();
    const today = nowISO.split('T')[0];
    const cycleToken = nowISO.replace(/[:.]/g, '-'); // Unique key for every 3-min cycle

    // ── 1. Sub-collection write (granular history for the 24h graph) ──
    const docRef = adminDb.collection(col(assetClass).snapshots)
        .doc(userId)
        .collection(poolId)
        .doc(cycleToken);

    await docRef.set({
        date: today,
        timestamp: nowISO,
        value,
        pnlPct,
        btcPrice: metadata?.btcPrice || 0,
        holdings: metadata?.holdings || {},
        recordedAt: nowISO,
    });

    // Also keep the "Latest for Today" doc active for legacy lookups
    await adminDb.collection(col(assetClass).snapshots)
        .doc(userId)
        .collection(poolId)
        .doc(today)
        .set({
            date: today,
            value,
            pnlPct,
            btcPrice: metadata?.btcPrice || 0,
            recordedAt: nowISO,
        }, { merge: true });

    // ── 2. Upsert into arena_config embedded array (what the chart reads) ──
    try {
        const arena = await getArenaConfig(userId, assetClass);
        if (!arena) return;

        const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
        if (poolIdx < 0) return;

        const pool = arena.pools[poolIdx];
        const snaps = pool.performance.dailySnapshots || [];

        // Upsert by date
        const existingIdx = snaps.findIndex(s => s.date === today);
        const entry = { date: today, value, pnlPct };
        if (existingIdx >= 0) {
            snaps[existingIdx] = entry;
        } else {
            snaps.push(entry);
        }

        // Keep last 30 entries max (28-day arena + buffer) — oldest first
        snaps.sort((a, b) => a.date.localeCompare(b.date));
        pool.performance.dailySnapshots = snaps.slice(-30);

        arena.pools[poolIdx] = pool;
        await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
    } catch (e: any) {
        // Non-fatal — sub-collection write already succeeded
        console.warn(`[Arena] recordDailySnapshot embedded write failed for ${poolId}: ${e.message}`);
    }
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
    assetClass: AssetClass = 'CRYPTO',
    skipSave: boolean = false, // If true, caller is responsible for persisting arena config
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
    // Enforce the DCA ring-fence — regular buys must not consume dcaReserve capital.
    // freeCash = cashBalance minus the ring-fenced portion; only this is available for trading.
    // Note: if cashBalance has already slipped below dcaReserve (legacy data) we allow the
    // buy down to $0 free cash (Math.max guard), but never into negative territory.
    const dcaRingFence = pool.dcaReserve ?? 0;
    const freeCash = Math.max(0, pool.cashBalance - dcaRingFence);
    if (dcaRingFence > 0 && total > freeCash) {
        return {
            success: false,
            error: `DCA ring-fence enforced: need $${total.toFixed(2)} but free cash is only $${freeCash.toFixed(2)} ` +
                `(cashBalance $${pool.cashBalance.toFixed(2)} − dcaReserve $${dcaRingFence.toFixed(2)}). ` +
                `DCA reserve is protected for high-conviction deployments.`,
        };
    }

    // Update pool state
    const holding = pool.holdings[upperTicker] || { amount: 0, averagePrice: 0, peakPrice: 0 };
    const oldTotal = holding.amount * holding.averagePrice;
    const newAmount = holding.amount + amount;
    const newAvgPrice = (oldTotal + total) / newAmount;

    pool.holdings[upperTicker] = {
        amount: newAmount,
        averagePrice: newAvgPrice,
        peakPrice: price,
        peakPnlPct: 0,
        boughtAt: new Date().toISOString(),
        userDirected: pool.poolId === 'POOL_MANUAL'
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

    const tradeId = await recordArenaTrade(trade, assetClass);
    
    // Save updated arena config (unless skipSave requested)
    if (!skipSave) {
        const arena = await getArenaConfig(userId, assetClass);
        if (arena) {
            if ((arena as any).sharedCash !== undefined) {
                // Deduct from DB-level sharedCash
                (arena as any).sharedCash = Math.max(0, ((arena as any).sharedCash || 0) - total);
                // Ensure pool cash doesn't retain fractional dust 
                pool.cashBalance = 0;
            }

            const poolIdx = arena.pools.findIndex(p => p.poolId === pool.poolId);
            if (poolIdx >= 0) {
                arena.pools[poolIdx] = pool;
                await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
            }
        }
    } else {
        // Even if skipSave, the local pool object already has its cashBalance / holdings updated by reference
        // but we ensure pool cash doesn't retain fractional dust if in shared mode
        const isSharedMode = assetClass !== 'CRYPTO'; // Simplification for sandbox arenas
        if (isSharedMode) pool.cashBalance = 0;
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
    assetClass: AssetClass = 'CRYPTO',
    skipAntiWash: boolean = false, // GPM partial sells: true (token still held, no wash risk)
    skipSave: boolean = false,     // If true, caller is responsible for persisting arena config
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

    // Record sell timestamp for anti-wash enforcement (applies to ALL full/regular sells).
    // GPM partial sells skip this — the token is still held, so there is no wash-trade risk,
    // and blocking re-buys would prevent the scale-up recovery path from working.
    if (!skipAntiWash) {
        if (!pool.lastSoldAt) pool.lastSoldAt = {};
        pool.lastSoldAt[upperTicker] = new Date().toISOString();
    }

    // Record stop-loss exits separately — these use a shorter re-entry cooldown
    // (stopLossReentryHours, default 6h) rather than the full antiWashHours (24h).
    // Reason string always starts with "⛔ STOP-LOSS:" for hard stop-loss exits.
    // Also record the exit price so Phase C (Rebound Watch) can compare without
    // needing an extra Firestore trade-record lookup per cycle.
    if (reason.includes('STOP-LOSS')) {
        if (!pool.lastStopLossedAt) pool.lastStopLossedAt = {};
        pool.lastStopLossedAt[upperTicker] = new Date().toISOString();
        if (!pool.stopLossExitPrices) pool.stopLossExitPrices = {};
        pool.stopLossExitPrices[upperTicker] = price; // fill price at the time of stop-loss
    }

    // ── Always record the last sell price — used by the buy-back-lower gate ──
    // Prevents the system from buying back the same token at a higher price,
    // which compounds losses (sell low → buy high → sell low again).
    if (!pool.lastSellPrices) pool.lastSellPrices = {};
    pool.lastSellPrices[upperTicker] = price;

    pool.cashBalance += total;
    pool.performance.totalTrades++;
    pool.performance.realizedPnl = safeNum(pool.performance.realizedPnl) + pnl;

    // ── Route sell proceeds to arena.sharedCash (unless skipSave requested) ────
    if (!skipSave) {
        try {
            const sellingArena = await getArenaConfig(userId, assetClass);
            if (sellingArena) {
                sellingArena.sharedCash = safeNum(sellingArena.sharedCash) + total;
                const sellingPoolIdx = sellingArena.pools.findIndex(p => p.poolId === pool.poolId);
                if (sellingPoolIdx >= 0) {
                    pool.cashBalance = 0; // proceeds moved to sharedCash
                    sellingArena.pools[sellingPoolIdx] = pool;
                }
                await adminDb!.collection(col(assetClass).config).doc(userId).set(sellingArena);
            }
        } catch (e: any) {
            console.warn(`[ArenaService] sharedCash credit failed for ${ticker}, leaving $${total.toFixed(2)} in pool.cashBalance: ${e.message}`);
        }
    } else {
        // Even if skipSave, ensure pool cash doesn't retain fractional dust if in shared mode
        const isSharedMode = assetClass !== 'CRYPTO';
        if (isSharedMode) pool.cashBalance = 0;
    }

    // Track wins/losses — require minimum profit to count as a "win"
    const minWin = pool.strategy.minWinPct || 0.5; // Default 0.5% minimum profit
    if (pnlPct >= minWin) {
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

    const tradeId = await recordArenaTrade(trade, assetClass);

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
    }, assetClass);

    // NOTE: arena config save is handled inside the sharedCash block above.
    // pool.cashBalance is set to 0 there after routing proceeds to arena.sharedCash.

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
    assetClass: AssetClass = 'CRYPTO',
): Promise<void> {
    if (!adminDb) return;

    const arena = await getArenaConfig(userId, assetClass);
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
    await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
}


/** Pause a pool (e.g., after hitting stop-loss). */
export async function pauseArenaPool(
    userId: string,
    poolId: PoolId,
    reason: string,
    assetClass: AssetClass = 'CRYPTO',
): Promise<void> {
    if (!adminDb) return;
    const arena = await getArenaConfig(userId, assetClass);
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    arena.pools[poolIdx].status = 'PAUSED';
    arena.pools[poolIdx].pauseReason = reason;
    await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
}

/** Resume a paused pool. */
export async function resumeArenaPool(
    userId: string,
    poolId: PoolId,
    assetClass: AssetClass = 'CRYPTO',
): Promise<void> {
    if (!adminDb) return;
    const arena = await getArenaConfig(userId, assetClass);
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    arena.pools[poolIdx].status = 'ACTIVE';
    arena.pools[poolIdx].pauseReason = undefined;
    await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
}


// ═══════════════════════════════════════════════════════════════════════════
// SANDBOX MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reset a sandbox arena: delete all collections for that assetClass and wipe the config.
 * NEVER touches CRYPTO collections. Sandbox-only operation.
 */
export async function resetSandboxArena(userId: string, assetClass: AssetClass): Promise<{ success: boolean; message: string }> {
    if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
    if (assetClass === 'CRYPTO') return { success: false, message: 'Cannot reset the live CRYPTO arena. This is a sandbox-only operation.' };

    const collections = col(assetClass);

    // Delete arena config
    await adminDb.collection(collections.config).doc(userId).delete().catch(() => { });

    // Delete all trades
    const tradesSnap = await adminDb.collection(collections.trades).where('userId', '==', userId).limit(500).get();
    const batch = adminDb.batch();
    tradesSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    // Delete reflections
    const refSnap = await adminDb.collection(collections.reflections).where('poolId', '!=', '').limit(500).get();
    const batch2 = adminDb.batch();
    refSnap.docs.forEach(d => batch2.delete(d.ref));
    await batch2.commit();

    console.log(`[Arena:${assetClass}] 🔄 Sandbox reset complete for user ${userId.substring(0, 8)}`);
    return { success: true, message: `${assetClass} sandbox arena reset. Ready to re-initialize.` };
}

/**
 * Activate competition mode for a sandbox arena.
 * One-way gate: sets competitionMode=true, locks the start date, resets cash balances.
 * Cannot be undone.
 */
export async function activateCompetitionMode(userId: string, assetClass: AssetClass): Promise<{ success: boolean; message: string }> {
    if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };
    if (assetClass === 'CRYPTO') return { success: false, message: 'CRYPTO arena is already in competition mode.' };

    const arena = await getArenaConfig(userId, assetClass) as any;
    if (!arena?.initialized) return { success: false, message: `${assetClass} arena not initialized yet.` };
    if (arena.competitionMode) return { success: false, message: `${assetClass} arena is already in competition mode.` };

    const now = new Date().toISOString();
    const endDate = new Date(Date.now() + ARENA_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Reset pools to fresh cash, keep selected tokens
    arena.pools = arena.pools.map((p: any) => ({
        ...p,
        cashBalance: POOL_BUDGET,
        holdings: {},
        performance: {
            startDate: now,
            totalPnl: 0, totalPnlPct: 0,
            winCount: 0, lossCount: 0, totalTrades: 0,
            bestTrade: null, worstTrade: null, dailySnapshots: [],
        },
        weeklyReviews: [],
        strategyHistory: [],
        lastSoldAt: {},
        scoreHistory: {},
    }));

    arena.startDate = now;
    arena.endDate = endDate;
    arena.sandboxMode = false;
    arena.competitionMode = true;
    arena.currentWeek = 1;

    await adminDb.collection(col(assetClass).config).doc(userId).set(arena);
    console.log(`[Arena:${assetClass}] 🏆 Competition mode ACTIVATED for user ${userId.substring(0, 8)}`);
    return { success: true, message: `${assetClass} arena is now in 28-day competition mode. Start date: ${now}.` };
}

// ═══════════════════════════════════════════════════════════════════════════
// DCA (DOLLAR COST AVERAGING) HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Read the dca_config document for a user, or return a default if it doesn't exist yet. */
export async function getDcaConfig(userId: string): Promise<DcaConfig | null> {
    if (!adminDb) return null;
    const snap = await adminDb.collection('dca_config').doc(userId).get();
    if (!snap.exists) return null;
    return snap.data() as DcaConfig;
}

/**
 * Credit a DCA deposit to a pool's ring-fenced reserve.
 * Called by the Saturday cron for each pool after the AI decides the split.
 *
 * - Increments pool.dcaReserve (ring-fenced, separate from cashBalance)
 * - Increments pool.dcaContributions (lifetime total)
 * - Appends an audit record to dca_config.history
 * - Updates dca_config.totalDeposited
 */
export async function creditDcaReserve(
    userId: string,
    poolId: PoolId,
    amount: number,
    marketCondition: DcaContributionRecord['marketCondition'],
): Promise<void> {
    if (!adminDb || amount <= 0) return;

    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return;

    const poolIdx = arena.pools.findIndex(p => p.poolId === poolId);
    if (poolIdx < 0) return;

    const pool = arena.pools[poolIdx];
    // dcaReserve is ring-fenced WITHIN cashBalance — it is a sub-ledger of it, not separate.
    // Both must be incremented together so the NAV calculation (cashBalance + holdings) is correct.
    pool.cashBalance = (pool.cashBalance ?? 0) + amount;   // ← makes real money visible in NAV
    pool.dcaReserve = (pool.dcaReserve ?? 0) + amount;     // ← ring-fences that same cash
    pool.dcaContributions = (pool.dcaContributions ?? 0) + amount;
    arena.pools[poolIdx] = pool;

    await adminDb.collection('arena_config').doc(userId).set(arena);

    // Append audit record
    const record: DcaContributionRecord = {
        date: new Date().toISOString(),
        poolId,
        credited: amount,
        deployed: 0,
        marketCondition,
    };

    const dcaRef = adminDb.collection('dca_config').doc(userId);
    const { FieldValue } = await import('firebase-admin/firestore');
    await dcaRef.set({
        totalDeposited: FieldValue.increment(amount),
        history: FieldValue.arrayUnion(record),
        lastDepositDate: new Date().toISOString().split('T')[0],
    }, { merge: true });

    console.log(`[DCA] ✅ Credited $${amount.toFixed(2)} to ${poolId} dcaReserve. New reserve: $${pool.dcaReserve.toFixed(2)}`);
}

/**
 * Update DCA accounting after the AI deploys reserve capital into a trade.
 * Call this AFTER a successful Revolut buy that consumed DCA reserve funds.
 *
 * - Decrements pool.dcaReserve
 * - Increments pool.dcaDeployedTotal
 * - Increments dca_config.totalDeployed
 */
export async function deployFromDcaReserve(
    userId: string,
    pool: ArenaPool,
    amount: number,
): Promise<void> {
    if (!adminDb || amount <= 0) return;

    const deployed = Math.min(amount, pool.dcaReserve ?? 0);
    if (deployed <= 0) return;

    pool.dcaReserve = Math.max(0, (pool.dcaReserve ?? 0) - deployed);
    pool.dcaDeployedTotal = (pool.dcaDeployedTotal ?? 0) + deployed;

    const dcaRef = adminDb.collection('dca_config').doc(userId);
    const { FieldValue } = await import('firebase-admin/firestore');
    await dcaRef.set({
        totalDeployed: FieldValue.increment(deployed),
    }, { merge: true });

    console.log(`[DCA] 🚀 Deployed $${deployed.toFixed(2)} from ${pool.poolId} reserve. Remaining: $${pool.dcaReserve.toFixed(2)}`);
}


// ═══════════════════════════════════════════════════════════════════════════
// REVOLUT BALANCE SYNC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sync arena pool cash balances with actual Revolut X USD balance.
 * 
 * Runs at most once per hour (REVOLUT_SYNC_INTERVAL_MS) to conserve
 * QuotaGuard proxy budget. Called at the end of each arena cron cycle.
 * 
 * Logic:
 *   1. Query Revolut getBalances() for actual USD
 *   2. Calculate drift = Revolut USD − sum(pool.cashBalance)
 *   3. Apply proportional correction across all pools so they sum to Revolut's actual USD
 *   4. Persist the corrected values and update lastRevolutSyncAt
 */
export async function syncRevolutBalances(
    userId: string,
    arena: ArenaConfig,
): Promise<{ synced: boolean; drift?: number; revolutUsd?: number }> {
    if (!adminDb) return { synced: false };

    // Rate limit: only sync once per hour
    const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    const lastSync = arena.lastRevolutSyncAt
        ? new Date(arena.lastRevolutSyncAt).getTime()
        : 0;
    if (Date.now() - lastSync < SYNC_INTERVAL_MS) {
        return { synced: false };
    }

    try {
        // Load Revolut credentials
        const configDoc = await adminDb.collection('agent_configs').doc(userId).get();
        const config = configDoc.data();
        if (!config?.revolutApiKey || !config?.revolutPrivateKey) {
            return { synced: false };
        }

        const { RevolutX } = await import('@/lib/revolut');
        const client = new RevolutX(
            config.revolutApiKey, config.revolutPrivateKey,
            config.revolutIsSandbox || false, config.revolutProxyUrl,
        );

        const balances = await client.getBalances();
        const usdEntry = (balances as any[]).find(
            (b: any) => (b.currency || b.symbol || '').toUpperCase() === 'USD',
        );
        const revolutUsd = parseFloat(
            (usdEntry?.available ?? usdEntry?.balance ?? 0).toString(),
        );

        // ── SHARED-CASH MODEL: compare against arena.sharedCash, NOT pool balances ──
        // In the shared-cash model, pool.cashBalance is always 0.
        // Cash lives exclusively in arena.sharedCash.
        // BUG FIX: Previously compared against sum(pool.cashBalance) which was always 0,
        // causing the full Revolut USD to be distributed into pool balances.
        // The calling code then consolidated those pool balances INTO sharedCash → DOUBLING.
        const arenaSharedCash = safeNum(arena.sharedCash);
        const drift = revolutUsd - arenaSharedCash;

        // Skip if drift is negligible (< $0.50)
        if (Math.abs(drift) < 0.50) {
            arena.lastRevolutSyncAt = new Date().toISOString();
            console.log(`[RevolutSync] ✅ In sync. sharedCash: $${arenaSharedCash.toFixed(2)}, Revolut: $${revolutUsd.toFixed(2)} (drift: $${drift.toFixed(2)})`);
            return { synced: true, drift, revolutUsd };
        }

        // ── CONTRIBUTION ADJUSTMENT ──────────────────────────────────────────
        // DISABLED: Auto-incrementing contributions from drift can cause budget 
        // inflation if manual trades are profitable. Real deposits should be 
        // handled via the DCA cron or manual scripts.
        /*
        if (drift > 5) {
            arena.sharedDcaContributions = (arena.sharedDcaContributions ?? 0) + drift;
            console.log(`[RevolutSync] 💰 Deposit detected: +$${drift.toFixed(2)}. Correcting totalInvested/sharedDcaContributions.`);
        }
        */
        // ─────────────────────────────────────────────────────────────────────

        // Direct correction — write Revolut USD to arena.sharedCash
        // Pool cashBalances stay at 0 (shared-cash model invariant).
        arena.sharedCash = Math.max(0, revolutUsd);
        // Ensure no per-pool cash leakage
        for (const pool of arena.pools) {
            pool.cashBalance = 0;
        }

        arena.lastRevolutSyncAt = new Date().toISOString();
        console.log(`[RevolutSync] 🔄 Corrected. Drift: $${drift.toFixed(2)} (sharedCash: $${arenaSharedCash.toFixed(2)} → $${revolutUsd.toFixed(2)})`);
        return { synced: true, drift, revolutUsd };

    } catch (e: any) {
        console.warn(`[RevolutSync] ⚠️ Sync failed: ${e.message}`);
        return { synced: false };
    }
}


// ═══════════════════════════════════════════════════════════════════════════
// SHARED DCA RESERVE (arena-level, not per-pool)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Credit the weekly DCA deposit to the arena's shared reserve.
 * Called by the Saturday cron after the user's Revolut auto-transfer lands.
 * The shared reserve is a single pot accessible to whichever pool has the
 * strongest candidate — no per-pool splitting.
 */
export async function creditSharedDcaReserve(
    userId: string,
    amount: number,
    marketCondition: DcaContributionRecord['marketCondition'],
): Promise<void> {
    if (!adminDb || amount <= 0) return;

    const arena = await getArenaConfig(userId, 'CRYPTO');
    if (!arena) return;

    arena.sharedDcaReserve = (arena.sharedDcaReserve ?? 0) + amount;
    arena.sharedDcaContributions = (arena.sharedDcaContributions ?? 0) + amount;

    await adminDb.collection('arena_config').doc(userId).set(arena);

    // Append audit record to dca_config
    const record: DcaContributionRecord = {
        date: new Date().toISOString(),
        poolId: 'SHARED',
        credited: amount,
        deployed: 0,
        marketCondition,
    };

    const dcaRef = adminDb.collection('dca_config').doc(userId);
    const { FieldValue } = await import('firebase-admin/firestore');
    await dcaRef.set({
        totalDeposited: FieldValue.increment(amount),
        history: FieldValue.arrayUnion(record),
        lastDepositDate: new Date().toISOString().split('T')[0],
    }, { merge: true });

    console.log(`[DCA] ✅ Credited $${amount.toFixed(2)} to shared DCA reserve. Total: $${arena.sharedDcaReserve.toFixed(2)}`);
}

/**
 * Deploy capital from the shared DCA reserve into a specific pool.
 * Called after a high-conviction trade executes using DCA funds.
 * The winning pool's cashBalance is NOT modified here — the buy already
 * reduced it. We only update the DCA accounting.
 */
export async function deployFromSharedDcaReserve(
    userId: string,
    arena: ArenaConfig,
    amount: number,
): Promise<void> {
    if (!adminDb || amount <= 0) return;

    const deployed = Math.min(amount, arena.sharedDcaReserve ?? 0);
    if (deployed <= 0) return;

    arena.sharedDcaReserve = Math.max(0, (arena.sharedDcaReserve ?? 0) - deployed);
    arena.sharedDcaDeployed = (arena.sharedDcaDeployed ?? 0) + deployed;

    const dcaRef = adminDb.collection('dca_config').doc(userId);
    const { FieldValue } = await import('firebase-admin/firestore');
    await dcaRef.set({
        totalDeployed: FieldValue.increment(deployed),
    }, { merge: true });

    console.log(`[DCA] 🚀 Deployed $${deployed.toFixed(2)} from shared reserve. Remaining: $${arena.sharedDcaReserve.toFixed(2)}`);
}


/**
 * Execute a MANUAL purchase and add to the 'Manual Madness' pool.
 * If the pool doesn't exist, it is created with a default strategy.
 */
export async function addManualPurchaseToArena(
    userId: string,
    assetClass: AssetClass,
    ticker: string,
    amount: number,
    price: number,
    reason: string,
    marketContext: ArenaTradeRecord['marketContext'],
): Promise<{ success: boolean; message: string; trade?: ArenaTradeRecord }> {
    if (!adminDb) return { success: false, message: 'Admin SDK not initialized' };

    const arena = await getArenaConfig(userId, assetClass);
    if (!arena) return { success: false, message: 'Arena config not found' };

    const upperTicker = ticker.toUpperCase();
    const totalCost = amount * price;

    // Check if sharedCash can cover it (strictly for recording/accounting)
    if ((arena.sharedCash ?? 0) < totalCost) {
        // We still allow it but warn or adjust? 
        // User might be recording an external trade.
        // But for "manual madness" in the arena, we should probably follow the rules.
        // Let's assume it MUST come from sharedCash for now to maintain integrity.
        // return { success: false, message: `Insufficient shared cash ($${arena.sharedCash?.toFixed(2)}) for buy total $${totalCost.toFixed(2)}` };
    }

    // Find or create Manual Madness pool
    let manualPool = arena.pools.find(p => p.poolId === 'POOL_MANUAL');
    
    if (!manualPool) {
        // Create the Manual Madness pool
        const defaultStrategy: PoolStrategy = {
            buyScoreThreshold: 70,
            exitThreshold: 50,
            momentumGateEnabled: true,
            momentumGateThreshold: 1.5,
            minOrderAmount: 10,
            antiWashHours: 24,
            reentryPenalty: 5,
            positionStopLoss: -15,
            maxAllocationPerToken: 300,
            takeProfitTarget: 5,
            trailingStopPct: 2,
            minWinPct: 0.5,
            description: "MANUAL MADNESS: User-directed tactical entries following standard SQ execution & tracking rules.",
            strategyPersonality: 'AGGRESSIVE',
            gpmEnabled: true,
        };

        const now = new Date().toISOString();
        manualPool = {
            poolId: 'POOL_MANUAL',
            name: 'MANUAL MADNESS',
            emoji: '🔥',
            tokens: [], // Starts empty, populated below
            strategy: defaultStrategy,
            strategyHistory: [],
            budget: 0, // Manual pool starts with 0 budget, funded by shared cash on demand
            cashBalance: 0,
            holdings: {},
            performance: {
                startDate: arena.startDate,
                totalPnl: 0,
                totalPnlPct: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                winCount: 0,
                lossCount: 0,
                totalTrades: 0,
                bestTrade: null,
                worstTrade: null,
                dailySnapshots: [],
            },
            createdAt: now,
            status: 'ACTIVE',
            selectionReasoning: "Manually added by user.",
            weeklyReviews: [],
        };
        arena.pools.push(manualPool);
    }
    
    if (!manualPool) return { success: false, message: 'Failed to initialize manual pool' };

    // Add ticker to tokens list if not already there
    if (!manualPool.tokens.includes(upperTicker)) {
        manualPool.tokens.push(upperTicker);
    }

    // We use a temporary cash balance on the pool to satisfy executePoolBuy's internal checks
    // then it will be deducted from arena.sharedCash by executePoolBuy.
    manualPool.cashBalance = totalCost;

    const res = await executePoolBuy(
        userId,
        manualPool,
        upperTicker,
        amount,
        price,
        `[MANUAL] ${reason}`,
        marketContext,
        "User manual entry - bypassing AI scoring gate.",
        assetClass,
        true // skipSave: we will handle persistence below
    );

    if (!res.success) {
        return { success: false, message: res.error || 'Manual buy failed' };
    }

    // Persist the updated arena (including the new pool if created)
    const finalArena = await getArenaConfig(userId, assetClass);
    if (finalArena) {
        // Deduct shared cash
        finalArena.sharedCash = Math.max(0, (finalArena.sharedCash || 0) - totalCost);
        
        // Find pool index (it may or may not exist in DB yet)
        const poolIdx = finalArena.pools.findIndex(p => p.poolId === 'POOL_MANUAL');
        if (poolIdx >= 0) {
            finalArena.pools[poolIdx] = manualPool;
        } else {
            finalArena.pools.push(manualPool);
        }
        
        await adminDb!.collection(col(assetClass).config).doc(userId).set(finalArena);
    }

    return { 
        success: true, 
        message: `Successfully added ${amount} ${upperTicker} to Manual Madness at $${price.toFixed(4)}`,
        trade: res.trade
    };
}


// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
    getCurrentWeek,
    getDayNumber,
    isArenaActive,
    safeNum,
};
