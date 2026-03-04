"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Trophy, Clock, Zap, Activity, RefreshCw, ChevronDown, ChevronUp, Calendar, Loader2, Wallet, TrendingUp, TrendingDown
} from "lucide-react";
import {
    getArenaStatus, refreshArenaPrices, manualInitArena
} from "@/app/actions";
import type {
    ArenaConfig, ArenaTradeRecord, PoolId,
} from "@/lib/constants";
import {
    ARENA_START_DATE, ARENA_DURATION_DAYS, POOL_COUNT, POOL_BUDGET,
} from "@/lib/constants";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const POOL_COLORS = ['99, 102, 241', '16, 185, 129', '245, 158, 11', '244, 63, 94'];

function getDayNumber(): number {
    const start = new Date(ARENA_START_DATE).getTime();
    const now = Date.now();
    const daysPassed = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return Math.max(0, Math.min(daysPassed + 1, ARENA_DURATION_DAYS));
}

function getCurrentWeek(): number {
    const day = getDayNumber();
    return Math.min(Math.ceil(day / 7), 4);
}

function getTimeRemaining(): string {
    const end = new Date(ARENA_START_DATE).getTime() + ARENA_DURATION_DAYS * 24 * 60 * 60 * 1000;
    const diff = end - Date.now();
    if (diff <= 0) return 'ended';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return `${days}d ${hours}h`;
}

function smartPrice(price: number): string {
    if (!price || price <= 0) return "0";
    if (price >= 1) return price.toFixed(2);
    const decimals = Math.max(2, Math.ceil(-Math.log10(price)) + 3);
    return price.toFixed(Math.min(decimals, 8));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

interface ArenaDashboardProps {
    userId: string;
}

export default function ArenaDashboard({ userId }: ArenaDashboardProps) {
    const [arena, setArena] = useState<ArenaConfig | null>(null);
    const [trades, setTrades] = useState<ArenaTradeRecord[]>([]);
    const [prices, setPrices] = useState<Record<string, { price: number; change24h: number }>>({});
    const [eodhd, setEodhd] = useState<{ used: number; limit: number; pct: number }>({ used: 0, limit: 80000, pct: 0 });
    const [marketStats, setMarketStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [initializing, setInitializing] = useState(false);
    const [expandedPool, setExpandedPool] = useState<PoolId | null>(null);
    const [showTrades, setShowTrades] = useState(false);

    // Load data
    const loadData = useCallback(async () => {
        try {
            const [status, freshPrices] = await Promise.all([
                getArenaStatus(userId),
                refreshArenaPrices(userId),
            ]);
            setArena(status.arena);
            setTrades(status.trades);
            setMarketStats(status.marketStats);
            setEodhd(status.eodhd);
            setPrices(freshPrices);
        } catch (e) {
            console.error('Failed to load arena data:', e);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => { loadData(); }, [loadData]);

    // Auto-refresh every 30s
    useEffect(() => {
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadData();
        setRefreshing(false);
    };

    const handleInitialize = async () => {
        setInitializing(true);
        const result = await manualInitArena(userId);
        if (result.success) {
            await loadData();
        }
        setInitializing(false);
    };

    // Calculate totals
    const poolValues = useMemo(() => {
        if (!arena) return [];
        return arena.pools.map((pool, idx) => {
            let holdingsValue = 0;
            for (const [ticker, holding] of Object.entries(pool.holdings)) {
                const price = prices[ticker.toUpperCase()]?.price || holding.averagePrice;
                holdingsValue += holding.amount * price;
            }
            const totalValue = pool.cashBalance + holdingsValue;
            const pnl = totalValue - pool.budget;
            const pnlPct = pool.budget > 0 ? (pnl / pool.budget) * 100 : 0;
            return { ...pool, totalValue, pnl, pnlPct, colorRgb: POOL_COLORS[idx] };
        });
    }, [arena, prices]);

    const totalValue = poolValues.reduce((sum, p) => sum + p.totalValue, 0);
    const totalBudget = POOL_COUNT * POOL_BUDGET;
    const totalPnl = totalValue - totalBudget;
    const totalPnlPct = totalBudget > 0 ? (totalPnl / totalBudget) * 100 : 0;

    const leaderIdx = poolValues.reduce((best, p, i) => p.pnlPct > (poolValues[best]?.pnlPct || -Infinity) ? i : best, 0);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="animate-spin text-indigo-400" size={48} />
                <p className="font-outfit text-indigo-300 text-sm tracking-widest uppercase">Syncing Arena...</p>
            </div>
        );
    }

    if (!arena?.initialized) {
        return (
            <div className="max-w-lg mx-auto mt-20">
                {/* Fallback gracefully covered by layout/page, but kept for direct mount */}
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            {/* ── HEADER & GLOBAL STATS ────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Value Card */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="premium-glass p-8 rounded-[2rem] lg:col-span-2 relative overflow-hidden flex flex-col justify-between"
                >
                    <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none translate-x-1/2 -translate-y-1/2" />

                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <div className="text-xs font-black font-outfit text-slate-500 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                                <Activity size={12} className="text-indigo-400" />
                                Arena Net Value
                            </div>
                            <div className="text-5xl font-black font-mono text-white tracking-tight">
                                ${totalValue.toFixed(2)}
                            </div>
                        </div>
                        <button onClick={handleRefresh} className="p-3 bg-white/5 rounded-2xl text-slate-400 hover:text-white hover:bg-white/10 transition-all" disabled={refreshing}>
                            <RefreshCw size={20} className={refreshing ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    <div className="flex items-end gap-8">
                        <div>
                            <div className="text-xs font-bold font-outfit text-slate-500 uppercase tracking-widest mb-1">Total P&L</div>
                            <div className={`text-2xl font-black font-mono ${totalPnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                                {totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(1)}%
                            </div>
                            <div className={`text-sm font-mono font-medium ${totalPnl >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                            </div>
                        </div>

                        <div className="w-px h-12 bg-white/10" />

                        <div>
                            <div className="text-xs font-bold font-outfit text-slate-500 uppercase tracking-widest mb-1">Leader</div>
                            <div className="text-xl font-bold font-outfit text-white flex items-center gap-2">
                                <span>{poolValues[leaderIdx]?.emoji}</span>
                                {poolValues[leaderIdx]?.name}
                            </div>
                            <div className="text-emerald-400 text-sm font-mono font-medium">
                                +{poolValues[leaderIdx]?.pnlPct.toFixed(1)}%
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Status Column */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col gap-6"
                >
                    {/* Time block */}
                    <div className="premium-glass p-6 rounded-[2rem] flex flex-col justify-center items-center text-center h-full relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-emerald-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />
                        <Calendar size={24} className="text-indigo-400 mb-3" />
                        <div className="text-sm font-outfit text-slate-400 uppercase tracking-widest mb-1">Day {getDayNumber()} of {ARENA_DURATION_DAYS}</div>
                        <div className="text-2xl font-black font-mono text-white">{getTimeRemaining()} left</div>
                    </div>

                    {/* Market Stats */}
                    {marketStats && (
                        <div className="premium-glass p-6 rounded-[2rem] flex flex-col justify-center h-full">
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-xs font-outfit text-slate-500 uppercase tracking-widest">BTC Price</span>
                                <span className="text-lg font-mono font-bold text-white">${(prices['BTC']?.price || 0).toLocaleString()}</span>
                            </div>
                            <div className="w-full h-px bg-white/5 mb-4" />
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-outfit text-slate-500 uppercase tracking-widest">F&amp;G Index</span>
                                <span className={`text-lg font-mono font-bold ${marketStats.fearGreedIndex > 50 ? 'text-positive' : 'text-negative'}`}>
                                    {marketStats.fearGreedIndex} <span className="text-xs ml-1 opacity-70">({marketStats.fearGreedStatus})</span>
                                </span>
                            </div>
                        </div>
                    )}
                </motion.div>
            </div>

            {/* ── API BUDGET BAR ─────────────────────────────────────────── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="premium-glass p-4 rounded-2xl flex items-center gap-6"
            >
                <div className="text-xs font-black font-outfit text-slate-500 uppercase tracking-[0.2em] whitespace-nowrap">
                    Oracle Bandwidth
                </div>
                <div className="flex-grow h-2 bg-black/40 rounded-full overflow-hidden inset-shadow-sm">
                    <div
                        className="h-full rounded-full transition-all duration-1000 ease-out relative"
                        style={{
                            width: `${Math.min(eodhd.pct * 100, 100)}%`,
                            background: eodhd.pct > 0.9 ? 'linear-gradient(90deg, #f43f5e, #be123c)' : eodhd.pct > 0.75 ? 'linear-gradient(90deg, #f59e0b, #b45309)' : 'linear-gradient(90deg, #10b981, #047857)',
                        }}
                    >
                        <div className="absolute inset-0 bg-white/20 w-full animate-[pulse_2s_ease-in-out_infinite]" />
                    </div>
                </div>
                <div className="text-xs font-mono font-medium text-slate-400 whitespace-nowrap">
                    {eodhd.used.toLocaleString()} / {eodhd.limit.toLocaleString()} <span className="text-slate-600">({(eodhd.pct * 100).toFixed(1)}%)</span>
                </div>
            </motion.div>

            {/* ── POOL CARDS ──────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {poolValues.map((pool, idx) => {
                    const isLeader = idx === leaderIdx;
                    const isExpanded = expandedPool === pool.poolId;

                    return (
                        <motion.div
                            key={pool.poolId}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.1 * idx }}
                            style={{ '--pool-color': pool.colorRgb } as any}
                            className={`premium-glass rounded-[2rem] pool-card-container cursor-pointer ${isLeader ? 'leader-card-bg' : ''}`}
                            onClick={() => setExpandedPool(isExpanded ? null : pool.poolId)}
                        >
                            {isLeader && <div className="leader-glow-ring" />}

                            <div className="p-8">
                                {/* Pool header */}
                                <div className="flex justify-between items-start mb-8">
                                    <div>
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-lg border border-white/10" style={{ background: `rgba(var(--pool-color), 0.15)` }}>
                                                {pool.emoji}
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-black font-outfit text-white flex items-center gap-2">
                                                    {pool.name}
                                                    {isLeader && (
                                                        <span className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 text-[9px] font-black font-outfit uppercase tracking-[0.2em] shadow-[0_0_10px_rgba(245,158,11,0.3)]">
                                                            Leader
                                                        </span>
                                                    )}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs font-mono text-slate-400 px-2 py-0.5 rounded bg-black/30 border border-white/5">
                                                        {pool.tokens.join(' • ')}
                                                    </span>
                                                    {pool.status === 'PAUSED' && (
                                                        <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                                                            HALTED
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-3xl font-black font-mono text-white mb-1">
                                            ${pool.totalValue.toFixed(2)}
                                        </div>
                                        <div className={`text-base font-bold font-mono ${pool.pnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                                            {pool.pnl >= 0 ? '+' : ''}{pool.pnlPct.toFixed(1)}%
                                        </div>
                                    </div>
                                </div>

                                {/* Holdings */}
                                <div className="space-y-3 mb-6">
                                    {pool.tokens.map(ticker => {
                                        const holding = pool.holdings[ticker];
                                        const price = prices[ticker.toUpperCase()]?.price || 0;
                                        const change = prices[ticker.toUpperCase()]?.change24h || 0;

                                        return (
                                            <div key={ticker} className="flex items-center justify-between py-3 px-4 rounded-xl bg-black/20 border border-white/5 backdrop-blur-sm">
                                                <div className="flex items-center gap-3">
                                                    <span className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs font-black font-outfit text-white border border-white/10 shadow-inner">
                                                        {ticker.substring(0, 2)}
                                                    </span>
                                                    <div>
                                                        <div className="text-sm font-bold font-outfit text-white">{ticker}</div>
                                                        <div className={`text-[11px] font-mono font-bold mt-0.5 ${change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-sm font-mono font-medium text-slate-200">${smartPrice(price)}</div>
                                                    {holding ? (
                                                        <div className="text-xs font-mono text-slate-500 mt-0.5">
                                                            {holding.amount.toFixed(4)} <span className="opacity-50">held</span>
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs font-mono text-slate-600 mt-0.5 italic">Awaiting entry</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Stats row */}
                                <div className="flex items-center justify-between text-[11px] font-mono font-medium text-slate-400 pt-4 border-t border-white/5">
                                    <span className="flex items-center gap-1.5"><Wallet size={12} /> ${pool.cashBalance.toFixed(2)} Cash</span>
                                    <span className="px-2 py-1 rounded bg-black/20">{pool.performance.winCount}W / {pool.performance.lossCount}L</span>
                                    <span>{pool.performance.totalTrades} Executions</span>
                                </div>
                            </div>

                            {/* Expanded details */}
                            <AnimatePresence>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden bg-black/20"
                                    >
                                        <div className="p-8 space-y-6 border-t border-white/5">
                                            {/* Strategy Parameters */}
                                            <div>
                                                <div className="text-[10px] font-outfit text-slate-500 uppercase tracking-[0.15em] mb-2 flex items-center gap-2">
                                                    <Zap size={12} className="text-indigo-400" /> Operational Directives
                                                </div>
                                                <p className="text-sm font-outfit text-slate-300 leading-relaxed bg-white/5 p-4 rounded-xl border border-white/5">
                                                    {pool.strategy.description}
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center flex flex-col justify-center">
                                                    <div className="text-xl font-black font-mono text-emerald-400">{pool.strategy.buyScoreThreshold}</div>
                                                    <div className="text-[10px] font-outfit text-slate-500 tracking-wider uppercase mt-1">Buy Score</div>
                                                </div>
                                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center flex flex-col justify-center">
                                                    <div className="text-xl font-black font-mono text-amber-400">{pool.strategy.exitThreshold}</div>
                                                    <div className="text-[10px] font-outfit text-slate-500 tracking-wider uppercase mt-1">Exit Score</div>
                                                </div>
                                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center flex flex-col justify-center">
                                                    <div className="text-xl font-black font-mono text-rose-400">{pool.strategy.positionStopLoss}%</div>
                                                    <div className="text-[10px] font-outfit text-slate-500 tracking-wider uppercase mt-1">Stop Loss</div>
                                                </div>
                                            </div>

                                            {/* Selection reasoning */}
                                            {pool.selectionReasoning && (
                                                <div>
                                                    <div className="text-[10px] font-outfit text-slate-500 uppercase tracking-[0.15em] mb-2">Alpha Logic</div>
                                                    <p className="text-xs font-mono text-slate-400 leading-relaxed max-h-32 overflow-y-auto custom-scrollbar bg-black/20 p-4 rounded-xl border-l-[3px]" style={{ borderColor: `rgba(var(--pool-color), 0.8)` }}>
                                                        {pool.selectionReasoning}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </div>

            {/* ── RECENT TRADES ────────────────────────────────────────── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="premium-glass rounded-[2rem] overflow-hidden"
            >
                <button
                    onClick={() => setShowTrades(!showTrades)}
                    className="w-full p-6 flex justify-between items-center hover:bg-white/5 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <Activity size={20} className="text-indigo-400" />
                        <h3 className="text-sm font-black font-outfit text-white uppercase tracking-[0.2em]">
                            Global Ledger <span className="opacity-50 font-mono ml-2">({trades.length})</span>
                        </h3>
                    </div>
                    {showTrades ? <ChevronUp size={20} className="text-slate-500" /> : <ChevronDown size={20} className="text-slate-500" />}
                </button>

                <AnimatePresence>
                    {showTrades && (
                        <motion.div
                            initial={{ height: 0 }}
                            animate={{ height: 'auto' }}
                            exit={{ height: 0 }}
                            className="bg-black/20 border-t border-white/5"
                        >
                            <div className="p-6 space-y-3 max-h-[32rem] overflow-y-auto custom-scrollbar">
                                {trades.length === 0 ? (
                                    <div className="text-center py-10 opacity-50">
                                        <Activity size={32} className="mx-auto mb-3 opacity-50" />
                                        <p className="text-sm font-outfit uppercase tracking-widest">Awaiting Initial Executions</p>
                                    </div>
                                ) : (
                                    trades.slice(0, 50).map((trade, i) => (
                                        <div key={trade.id || i} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.05] transition-colors border border-white/5">
                                            <div className="flex items-center gap-4">
                                                <span className={`w-10 h-10 rounded-full flex items-center justify-center text-sm shadow-lg ${trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                                    {trade.type === 'BUY' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                                </span>
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-sm font-black font-outfit text-white uppercase">{trade.type}</span>
                                                        <span className="text-sm font-bold font-mono text-slate-300">{trade.ticker}</span>
                                                    </div>
                                                    <div className="text-[11px] font-outfit text-slate-500 uppercase tracking-widest">{trade.poolName}</div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-black font-mono text-white mb-1">
                                                    ${trade.total.toFixed(2)}
                                                </div>
                                                {trade.pnlPct !== undefined ? (
                                                    <div className={`text-xs font-bold font-mono ${trade.pnlPct >= 0 ? 'text-positive' : 'text-negative'}`}>
                                                        {trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(1)}%
                                                    </div>
                                                ) : (
                                                    <div className="text-[10px] font-mono text-slate-600">
                                                        Vol: {trade.amount.toFixed(4)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
}
