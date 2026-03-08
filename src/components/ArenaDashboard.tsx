"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, ChevronRight, Activity, Zap, Server, ShieldAlert, Shield } from "lucide-react";
import { getArenaStatus, refreshArenaPrices, manualInitArena, getLatestStrategyReport, getPerformanceHistory, runSandboxArenaCycle, type StrategyReport, type PerformanceHistory } from "@/app/actions";
import type { ArenaConfig, ArenaTradeRecord, PoolId, AssetClass } from "@/lib/constants";
import { ARENA_START_DATE, ARENA_DURATION_DAYS, POOL_COUNT, POOL_BUDGET, ARENA_THEME, getCurrencySymbol, SANDBOX_ASSET_CLASSES } from "@/lib/constants";
import AuditTrail from "@/components/AuditTrail";
import PerformanceChart from "@/components/PerformanceChart";
import SandboxBanner from "@/components/SandboxBanner";
import { useAuth } from "@/context/AuthContext";

// ─── Helpers ─────────────────────────────────────────────
// Note: getDayNumber / getTimeRemaining removed — now computed inside the component
// from arena.startDate / arena.endDate so each dashboard is fully isolated.
function fmtPrice(n: number) {
    if (!n || n <= 0) return '0.00';
    if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(2);
    const dec = Math.max(2, Math.ceil(-Math.log10(n)) + 2);
    return n.toFixed(Math.min(dec, 6));
}
function fmtPct(n: number) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

// ─── Mission Control UI Components ─────────────────────────
function TelemetryBar({ pct, colorClass = 'bg-[#0b5394]' }: { pct: number, colorClass?: string }) {
    return (
        <div className="w-full h-1.5 bg-[#272a35] overflow-hidden">
            <div
                className={`h-full ${colorClass}`}
                style={{ width: `${Math.min(pct, 100)}%`, transition: 'width 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
        </div>
    );
}

function StatusIndicator({ status }: { status: 'nominal' | 'warning' | 'critical' }) {
    const labels = { nominal: 'NOMINAL', warning: 'WARNING', critical: 'CRITICAL' };
    return (
        <div className={`flex items-center gap-1.5 status-${status} font-mono text-[10px] uppercase font-bold`}>
            <span className={`dot dot-${status} scale-75`}></span>
            {labels[status]}
        </div>
    );
}

// ─── Main export ─────────────────────────────────────────
interface ArenaDashboardProps {
    userId?: string;       // Optional: resolved from AuthContext if not passed
    assetClass?: AssetClass; // Defaults to CRYPTO
}

export default function ArenaDashboard({ userId: userIdProp, assetClass = 'CRYPTO' }: ArenaDashboardProps) {
    const { user, loading: authLoading } = useAuth();
    const userId = userIdProp || user?.uid || '';
    const isNonCryptoClass = SANDBOX_ASSET_CLASSES.includes(assetClass);
    const theme = ARENA_THEME[assetClass];
    const currency = getCurrencySymbol(assetClass);

    const [arena, setArena] = useState<ArenaConfig | null>(null);
    const [trades, setTrades] = useState<ArenaTradeRecord[]>([]);
    const [prices, setPrices] = useState<Record<string, { price: number; change24h: number }>>({});
    const [eodhd, setEodhd] = useState<{ used: number; limit: number; pct: number }>({ used: 0, limit: 80000, pct: 0 });
    const [market, setMarket] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activePool, setActivePool] = useState<PoolId | null>(null);
    const [tick, setTick] = useState(0);
    const [isInitializing, setIsInitializing] = useState(false);
    const [strategyReport, setStrategyReport] = useState<StrategyReport | null>(null);
    const [performanceHistory, setPerformanceHistory] = useState<PerformanceHistory | null>(null);
    const [ledgerPage, setLedgerPage] = useState(0);
    const [showAuditTrail, setShowAuditTrail] = useState(false);
    const TRADES_PER_PAGE = 8;

    // Live timer tick
    useEffect(() => {
        const i = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(i);
    }, []);

    const loadData = useCallback(async () => {
        try {
            const [status, freshPrices, report] = await Promise.all([
                getArenaStatus(userId, assetClass),
                refreshArenaPrices(userId, assetClass),
                getLatestStrategyReport(userId, assetClass),
            ]);
            setArena(status.arena);
            setTrades(status.trades);
            setMarket(status.marketStats);
            setEodhd(status.eodhd);
            if (report) setStrategyReport(report);
            setPrices(freshPrices);
            // Fetch performance history (passes live prices to avoid a second fetch)
            const history = await getPerformanceHistory(userId, freshPrices, assetClass);
            if (history) setPerformanceHistory(history);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [userId, assetClass]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => {
        const t = setInterval(loadData, 30000);
        return () => clearInterval(t);
    }, [loadData]);

    const poolValues = useMemo(() => {
        if (!arena) return [];
        return arena.pools.map((pool, idx) => {
            let holdVal = 0;
            for (const [t, h] of Object.entries(pool.holdings)) {
                holdVal += h.amount * (prices[t.toUpperCase()]?.price || h.averagePrice);
            }
            // Total liquid = cash (including dcaReserve) + holdings
            // dcaReserve is ring-fenced inside cashBalance already, so total is correct.
            const total = pool.cashBalance + holdVal;
            // Cost basis = original budget + all DCA capital ever credited to this pool
            const costBasis = pool.budget + (pool.dcaContributions ?? 0);
            const pnl = total - costBasis;
            const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            return { ...pool, total, pnl, pnlPct, costBasis, idx };
        });
    }, [arena, prices]);

    const totalValue = poolValues.reduce((s, p) => s + p.total, 0);
    const totalCostBasis = poolValues.reduce((s, p) => s + ((p as any).costBasis ?? p.budget), 0);
    const totalDcaContributions = arena?.pools.reduce((s, p) => s + (p.dcaContributions ?? 0), 0) ?? 0;
    const totalDcaReserve = arena?.pools.reduce((s, p) => s + (p.dcaReserve ?? 0), 0) ?? 0;
    const totalDcaDeployed = arena?.pools.reduce((s, p) => s + (p.dcaDeployedTotal ?? 0), 0) ?? 0;
    const hasDca = totalDcaContributions > 0;
    // Use corrected cost basis for overall P&L calculation
    const effectiveBasis = hasDca ? totalCostBasis : POOL_COUNT * POOL_BUDGET;
    const totalPnl = totalValue - effectiveBasis;
    const totalPnlPct = effectiveBasis > 0 ? (totalPnl / effectiveBasis) * 100 : 0;
    const leaderIdx = poolValues.reduce((b, p, i) => p.pnlPct > (poolValues[b]?.pnlPct ?? -Infinity) ? i : b, 0);

    // ── Arena-scoped clock (fully isolated per arena) ──
    // isSandbox = true when still in sandbox mode (non-crypto + not yet in competition)
    // Once competition is activated arena.competitionMode = true → switches to T-minus countdown
    const isSandbox = isNonCryptoClass && !(arena?.competitionMode);

    const arenaStartMs = arena?.startDate ? new Date(arena.startDate).getTime() : 0;
    const arenaEndMs = arena?.endDate ? new Date(arena.endDate).getTime() : arenaStartMs + ARENA_DURATION_DAYS * 86400000;
    const arenaDay = arenaStartMs
        ? Math.max(1, Math.min(Math.floor((Date.now() - arenaStartMs) / 86400000) + 1, ARENA_DURATION_DAYS))
        : 1;
    // For sandbox arenas show elapsed days; for live arenas show T-minus to endDate
    const clockDiff = isSandbox ? (Date.now() - arenaStartMs) : (arenaEndMs - Date.now());
    const absMs = Math.abs(clockDiff);
    const cd = Math.floor(absMs / 86400000);
    const ch = Math.floor((absMs % 86400000) / 3600000);
    const cm = Math.floor((absMs % 3600000) / 60000);
    const cs = Math.floor((absMs % 60000) / 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const clockLabel = !arenaStartMs
        ? '--:--:--:--'
        : isSandbox
            ? `${pad(cd)}:${pad(ch)}:${pad(cm)}:${pad(cs)}` // elapsed
            : clockDiff <= 0 ? '00:00:00:00' : `${pad(cd)}:${pad(ch)}:${pad(cm)}:${pad(cs)}`; // t-minus

    const isMarketFear = (market?.fearGreedIndex ?? 50) < 40;

    const isApiCritical = eodhd.pct > 0.9;

    /* ── Loading ── */
    if (loading) return (
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="mc-label text-[#8a8f98]">ESTABLISHING TELEMETRY LINK...</div>
            <div className="flex gap-2">
                <div className="w-2 h-2 bg-[#4ba3e3] animate-ping" />
                <div className="w-2 h-2 bg-[#4ba3e3] animate-ping delay-75" />
                <div className="w-2 h-2 bg-[#4ba3e3] animate-ping delay-150" />
            </div>
        </div>
    );

    // ─── AUDIT TRAIL VIEW ─────────────────────────────────────────────────
    if (showAuditTrail) {
        return <AuditTrail userId={userId} onBack={() => setShowAuditTrail(false)} assetClass={assetClass} />;
    }

    if (!arena?.initialized) return (
        <div className="mc-panel p-10 text-center border-l-4 border-l-[#ffb74d] max-w-2xl mx-auto mt-20">
            <div className="mc-label text-[#ffb74d] mb-4 text-lg">SYSTEM HALT: ARENA PENDING DEPLOYMENT</div>
            <p className="font-mono text-sm text-[#e2e4e9] mb-8 leading-relaxed">
                The Semaphore Arena is currently awaiting initialization. Proceeding will trigger AI to generate 4 distinct trading strategies, allocate the $600 baseline capital, and immediately deploy the funds into real-market execution.
            </p>
            <button
                onClick={async () => {
                    setIsInitializing(true);
                    try {
                        const res = await manualInitArena(userId, assetClass);
                        if (res.success) {
                            await loadData();
                        } else {
                            alert(res.message);
                        }
                    } catch (e: any) {
                        alert(e.message);
                    } finally {
                        setIsInitializing(false);
                    }
                }}
                disabled={isInitializing}
                className="bg-[#2e7d32] hover:bg-[#1b5e20] text-white px-8 py-3 font-mono text-sm font-bold tracking-widest uppercase transition-colors disabled:opacity-50"
            >
                {isInitializing ? "DEPLOYING AI STRATEGIES..." : "INITIALIZE ARENA // AUTO-DEPLOY"}
            </button>
            {isInitializing && (
                <div className="mt-6 flex justify-center gap-2">
                    <span className="dot dot-nominal"></span>
                    <span className="mc-label text-[10px] text-[#4caf50]">UPLINKING TO GEMINI ARCHITECT...</span>
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">

            {/* Sandbox banner — shown for FTSE, NYSE, Commodities */}
            {isSandbox && (
                <SandboxBanner
                    assetClass={assetClass}
                    onCycleComplete={loadData}
                    onActivateCompetition={async () => {
                        try {
                            const { activateSandboxCompetition } = await import('@/app/actions');
                            await activateSandboxCompetition(userId, assetClass);
                            await loadData();
                        } catch (e: any) { alert(e.message); }
                    }}
                />
            )}

            {/* ═ GLOBAL MISSION STATUS ═ */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">

                {/* Main PNL Block */}
                <div className="mc-panel md:col-span-1 lg:col-span-4 p-5 flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4">
                        <span className="mc-label">Net Asset Value (NAV)</span>
                        <StatusIndicator status={totalPnl >= 0 ? 'nominal' : 'critical'} />
                    </div>
                    <div className="flex items-baseline gap-4">
                        <span className="mc-value text-4xl font-bold tracking-tight text-white">{currency}{fmtPrice(totalValue)}</span>
                        <span className={`mc-value text-lg ${totalPnl >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                            {fmtPct(totalPnlPct)}
                        </span>
                    </div>
                    <div className="mc-divider my-4" />
                    <div className="flex justify-between items-center">
                        <span className="mc-label">TOTAL INVESTED</span>
                        <span className="mc-value text-sm text-[#8a8f98]">
                            {currency}{effectiveBasis.toFixed(2)}
                            {hasDca && (
                                <span className="ml-1.5 text-[9px] font-bold text-[#4ba3e3] uppercase tracking-widest">
                                    +{currency}{totalDcaContributions.toFixed(0)} DCA
                                </span>
                            )}
                        </span>
                    </div>
                </div>

                {/* Telemetry Grid — Panel 1 & 2 are asset-class aware */}
                <div className="grid grid-cols-2 gap-4 md:col-span-1 lg:col-span-5">

                    {/* Panel 1: BTC Oracle (crypto) | Top Holding (others) */}
                    {assetClass === 'CRYPTO' ? (
                        <div className="mc-panel p-4 flex flex-col justify-between">
                            <div className="mc-label mb-2 flex justify-between">
                                BTC ORACLE <StatusIndicator status={prices['BTC']?.change24h >= 0 ? 'nominal' : 'warning'} />
                            </div>
                            <div className="mc-value text-2xl text-white mb-1">${fmtPrice(prices['BTC']?.price ?? 0)}</div>
                            <div className={`mc-value text-xs ${prices['BTC']?.change24h >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                {fmtPct(prices['BTC']?.change24h ?? 0)} 24H
                            </div>
                        </div>
                    ) : (() => {
                        // Find best-performing holding across all pools
                        let bestTicker = '', bestPct = -Infinity;
                        arena?.pools.forEach(p => {
                            Object.entries(p.holdings || {}).forEach(([t, h]) => {
                                const liveP = prices[t.toUpperCase()]?.price;
                                if (!liveP || !h.averagePrice) return;
                                const pct = ((liveP - h.averagePrice) / h.averagePrice) * 100;
                                if (pct > bestPct) { bestPct = pct; bestTicker = t; }
                            });
                        });
                        const bpData = bestTicker ? prices[bestTicker.toUpperCase()] : null;
                        return (
                            <div className="mc-panel p-4 flex flex-col justify-between">
                                <div className="mc-label mb-2 flex justify-between">
                                    TOP HOLDING <StatusIndicator status={bestPct >= 0 ? 'nominal' : 'warning'} />
                                </div>
                                <div className="mc-value text-2xl text-white mb-1 truncate">
                                    {bestTicker || '—'}
                                </div>
                                <div className={`mc-value text-xs ${bestPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                    {bestTicker ? `${fmtPct(bestPct)} vs cost` : 'No positions'}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Panel 2: Sentiment/Fear-Greed (crypto) | Win Rate (others) */}
                    {assetClass === 'CRYPTO' ? (
                        <div className="mc-panel p-4 flex flex-col justify-between">
                            <div className="mc-label mb-2 flex justify-between">
                                SENTIMENT <StatusIndicator status={isMarketFear ? 'warning' : 'nominal'} />
                            </div>
                            <div className="mc-value text-2xl text-white mb-1">{market?.fearGreedIndex ?? '—'}</div>
                            <div className="mc-value text-xs text-[#d32f2f] uppercase">
                                {market?.fearGreedStatus ?? 'UNKNOWN'}
                            </div>
                        </div>
                    ) : (() => {
                        const sells = trades.filter(t => t.type === 'SELL');
                        const wins = sells.filter(t => (t.pnlPct ?? 0) > 0).length;
                        const winRate = sells.length > 0 ? (wins / sells.length) * 100 : null;
                        const status = winRate === null ? 'nominal' : winRate >= 50 ? 'nominal' : 'warning';
                        return (
                            <div className="mc-panel p-4 flex flex-col justify-between">
                                <div className="mc-label mb-2 flex justify-between">
                                    WIN RATE <StatusIndicator status={status} />
                                </div>
                                <div className="mc-value text-2xl text-white mb-1">
                                    {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
                                </div>
                                <div className="mc-value text-xs text-[#8a8f98]">
                                    {wins}W / {sells.length - wins}L of {sells.length} closed
                                </div>
                            </div>
                        );
                    })()}

                    <div className="mc-panel p-4 flex flex-col justify-between">
                        <div className="mc-label mb-2 flex justify-between">
                            API QUOTA <StatusIndicator status={isApiCritical ? 'critical' : 'nominal'} />
                        </div>
                        <div className="mc-value text-2xl text-white mb-1">{((eodhd.pct || 0) * 100).toFixed(1)}%</div>
                        <TelemetryBar pct={(eodhd.pct || 0) * 100} colorClass={isApiCritical ? 'bg-red-500' : 'bg-[#0b5394]'} />
                        <div className="mc-value text-[10px] text-[#8a8f98] mt-2 text-right">
                            {eodhd.used.toLocaleString()} / {eodhd.limit.toLocaleString()} REQ
                        </div>
                    </div>

                    <div className="mc-panel p-4 flex flex-col justify-between">
                        <div className="mc-label mb-2 flex justify-between">
                            EXECUTIONS <StatusIndicator status="nominal" />
                        </div>
                        <div className="mc-value text-2xl text-white mb-1">{trades.length}</div>
                        <div className="flex items-center gap-2 mt-auto">
                            <span className="px-1.5 py-0.5 bg-[#1b5e20] text-[#a5d6a7] font-mono text-[9px] font-bold">B: {trades.filter(t => t.type === 'BUY').length}</span>
                            <span className="px-1.5 py-0.5 bg-[#b71c1c] text-[#ef9a9a] font-mono text-[9px] font-bold">S: {trades.filter(t => t.type === 'SELL').length}</span>
                        </div>
                    </div>
                </div>

                {/* Mission Clock */}
                <div className="mc-panel md:col-span-2 lg:col-span-3 p-4 flex flex-col justify-between border-l-4 border-l-[#0b5394]">
                    <div className="flex justify-between items-start mb-4">
                        <div className="mc-label flex flex-col gap-0.5 leading-none">
                            <span>MISSION CLOCK</span>
                            <span className="text-[9px] opacity-60 font-mono">{isSandbox ? '(ELAPSED)' : '(T-MINUS)'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setShowAuditTrail(true)}
                                className="flex items-center gap-1.5 px-2.5 py-1 border border-[#272a35] hover:border-[#ffb74d] text-[#8a8f98] hover:text-[#ffb74d] transition-colors"
                                title="View AI Audit Trail"
                            >
                                <Shield size={12} />
                                <span className="font-mono text-[9px] font-bold tracking-widest hidden sm:inline">AUDIT</span>
                            </button>
                            {/* Manual cycle trigger — visible for all non-crypto arenas */}
                            {isNonCryptoClass && (
                                <button
                                    onClick={async () => {
                                        if (!userId || refreshing) return;
                                        setRefreshing(true);
                                        try {
                                            await runSandboxArenaCycle(userId, assetClass);
                                            await loadData();
                                        } catch (e: any) {
                                            console.error('[RunCycle]', e.message);
                                        } finally {
                                            setRefreshing(false);
                                        }
                                    }}
                                    disabled={refreshing}
                                    title="Manually run one AI trading cycle now (bypasses cron schedule)"
                                    className={`px-2 py-1 border font-mono text-[9px] font-bold tracking-widest transition-colors ${refreshing
                                        ? 'border-[#272a35] text-[#4ba3e3] opacity-60'
                                        : 'border-[#0b5394] text-[#4ba3e3] hover:border-[#4ba3e3] hover:bg-[#0b5394]/20'
                                        }`}
                                >
                                    {refreshing ? '⏳' : '▶ RUN'}
                                </button>
                            )}
                            <button
                                onClick={() => { setRefreshing(true); loadData().then(() => setRefreshing(false)); }}
                                disabled={refreshing}
                                className={`p-1.5 hover:bg-[#272a35] rounded ${refreshing ? 'animate-spin text-[#4ba3e3]' : 'text-[#8a8f98]'}`}
                            >
                                <RefreshCw size={14} />
                            </button>
                        </div>
                    </div>
                    <div className="mc-value text-3xl font-bold tracking-wider text-white bg-[#0a0a0c] px-3 py-2 border border-[#272a35] text-center shadow-inner">
                        {clockLabel}
                    </div>
                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-[#272a35]">
                        <span className="mc-label">{isSandbox ? 'ELAPSED' : 'CYCLE PHASE'}</span>
                        {isSandbox
                            ? <span className="mc-value text-sm text-[#f59e0b] font-bold tracking-widest">SANDBOX</span>
                            : <span className="mc-value text-sm text-[#4ba3e3]">DAY {arenaDay} / {ARENA_DURATION_DAYS}</span>
                        }
                    </div>
                </div>

            </div>

            {/* ═ DCA STATUS STRIP ═ — only shown after first deposit */}
            {hasDca && (
                <div className="mc-panel border-l-4 border-l-[#4ba3e3] p-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        <div className="flex items-center gap-2">
                            <span className="text-[#4ba3e3] text-lg">💰</span>
                            <span className="mc-label text-[#4ba3e3] tracking-widest">DCA PROGRAMME</span>
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-2 ml-auto">
                            <div className="text-center">
                                <div className="mc-label text-[9px] text-[#8a8f98]">DEPOSITED</div>
                                <div className="mc-value text-base text-white font-bold">{currency}{totalDcaContributions.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="mc-label text-[9px] text-[#8a8f98]">DEPLOYED</div>
                                <div className="mc-value text-base text-[#4caf50] font-bold">{currency}{totalDcaDeployed.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="mc-label text-[9px] text-[#8a8f98]">IN RESERVE</div>
                                <div className="mc-value text-base text-[#ffb74d] font-bold">{currency}{totalDcaReserve.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                                <div className="mc-label text-[9px] text-[#8a8f98]">DEPLOY TRIGGER</div>
                                <div className="mc-value text-[11px] text-[#8a8f98]">Score ≥ 85</div>
                            </div>
                        </div>
                    </div>
                    {/* Per-pool reserve bars */}
                    {totalDcaReserve > 0 && (
                        <div className="mt-4 pt-4 border-t border-[#272a35] grid grid-cols-2 lg:grid-cols-4 gap-4">
                            {arena?.pools.map(p => {
                                const reserve = p.dcaReserve ?? 0;
                                const contrib = p.dcaContributions ?? 0;
                                if (contrib === 0) return null;
                                const pct = contrib > 0 ? (reserve / contrib) * 100 : 0;
                                return (
                                    <div key={p.poolId}>
                                        <div className="flex justify-between mb-1">
                                            <span className="mc-label text-[9px]">{p.emoji} {p.name.toUpperCase()}</span>
                                            <span className="mc-value text-[9px] text-[#ffb74d]">{currency}{reserve.toFixed(2)}</span>
                                        </div>
                                        <TelemetryBar pct={pct} colorClass="bg-[#4ba3e3]" />
                                        <div className="text-[8px] text-[#555] mt-0.5 text-right">{pct.toFixed(0)}% undeployed</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ═ STRATEGY MODULES ═ */}
            <div className="mc-label flex items-center gap-3 pt-4">
                <span>STRATEGY DEPLOYMENT TELEMETRY</span>
                <div className="h-px bg-[#272a35] flex-1"></div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {poolValues.map((pool, i) => {
                    const isLeader = i === leaderIdx;
                    const isActive = activePool === pool.poolId;
                    const badgeColor = `pool-badge-${pool.idx}`;
                    const isProfitable = pool.pnlPct >= 0;

                    return (
                        <div key={pool.poolId} className={`mc-panel ${isLeader ? 'border-[#4ba3e3] shadow-[0_0_15px_rgba(75,163,227,0.1)]' : ''}`}>
                            {/* Header */}
                            <div className="mc-panel-header">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 font-bold ${badgeColor}`}>SQ-{pool.idx + 1}</span>
                                    <span className="text-white">{pool.name.toUpperCase()}</span>
                                    <span className="text-[#8a8f98]">{pool.emoji}</span>
                                </div>
                                {isLeader && <span className="text-black bg-[#ffb74d] px-2 font-bold uppercase tracking-widest">LEADER</span>}
                                {pool.status === 'PAUSED' && <span className="text-white bg-[#d32f2f] px-2 font-bold uppercase tracking-widest animate-pulse">HALTED</span>}
                            </div>

                            {/* Core Stats Row */}
                            <div
                                className="p-5 cursor-pointer hover:bg-[#161b22] transition-colors"
                                onClick={() => setActivePool(isActive ? null : pool.poolId)}
                            >
                                <div className="flex justify-between items-end mb-4">
                                    <div>
                                        <div className="mc-label mb-1">ASSET VALUE</div>
                                        <div className="mc-value text-2xl font-bold text-white">${fmtPrice(pool.total)}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="mc-label mb-1">DELTA</div>
                                        <div className={`mc-value text-lg font-bold ${isProfitable ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                            {fmtPct(pool.pnlPct)}
                                        </div>
                                    </div>
                                </div>

                                {/* Progress bar representing budget vs value */}
                                <div className="mb-5">
                                    <div className="flex justify-between mb-1">
                                        <span className="mc-value text-[10px] text-[#8a8f98]">COST: ${(pool as any).costBasis?.toFixed(2) ?? pool.budget}</span>
                                        <span className="mc-value text-[10px] text-[#8a8f98]">LIQUID: ${pool.cashBalance.toFixed(2)}</span>
                                    </div>
                                    <TelemetryBar pct={(pool.total / ((pool as any).costBasis || pool.budget)) * 100} colorClass={isProfitable ? 'bg-[#2e7d32]' : 'bg-[#d32f2f]'} />
                                    {(pool.dcaReserve ?? 0) > 0 && (
                                        <div className="flex justify-between mt-1.5">
                                            <span className="mc-label text-[9px] text-[#4ba3e3]">DCA RESERVE AWAITING DEPLOYMENT</span>
                                            <span className="mc-value text-[9px] text-[#ffb74d] font-bold">${(pool.dcaReserve ?? 0).toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Asset Table */}
                                <div className="border border-[#272a35] bg-[#0a0a0c]">
                                    {/* Table Header */}
                                    <div className="grid grid-cols-4 px-3 py-2 border-b border-[#272a35] mc-label text-[9px]">
                                        <div className="col-span-1">ASSET</div>
                                        <div className="col-span-1 text-right">QTY</div>
                                        <div className="col-span-1 text-right">PRICE</div>
                                        <div className="col-span-1 text-right">24H </div>
                                    </div>

                                    {/* Table Rows */}
                                    {pool.tokens.map((ticker, rowIdx) => {
                                        const pr = prices[ticker.toUpperCase()];
                                        const holding = pool.holdings[ticker];
                                        const chg = pr?.change24h ?? 0;
                                        return (
                                            <div key={ticker} className={`grid grid-cols-4 px-3 py-2 items-center mc-value text-xs ${rowIdx !== pool.tokens.length - 1 ? 'border-b border-[#272a35]' : ''}`}>
                                                <div className="col-span-1 font-bold text-[#e2e4e9]">{ticker}</div>
                                                <div className="col-span-1 text-right text-[#8a8f98]">
                                                    {holding ? holding.amount.toFixed(4) : '--'}
                                                </div>
                                                <div className="col-span-1 text-right text-white">
                                                    ${fmtPrice(pr?.price ?? 0)}
                                                </div>
                                                <div className={`col-span-1 text-right font-bold ${chg >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                    {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="flex justify-center mt-3">
                                    <ChevronRight size={16} className={`text-[#8a8f98] transition-transform ${isActive ? 'rotate-90' : ''}`} />
                                </div>
                            </div>

                            {/* Expansion Panel */}
                            {isActive && (
                                <div className="border-t border-[#272a35] bg-[#0a0a0c] p-5">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <div className="mc-label mb-2 border-b border-[#272a35] pb-1">OPERATIONAL DIRECTIVE</div>
                                            <p className="font-sans text-xs text-[#b0b4bc] leading-relaxed">
                                                {pool.strategy.description}
                                            </p>

                                            {pool.selectionReasoning && (
                                                <div className="mt-4">
                                                    <div className="mc-label mb-2 border-b border-[#272a35] pb-1">AI RATIONALE</div>
                                                    <div className="font-mono text-[10px] text-[#8a8f98] leading-normal p-3 bg-[#121318] border border-[#272a35] h-32 overflow-y-auto">
                                                        {pool.selectionReasoning}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <div className="mc-label mb-2 border-b border-[#272a35] pb-1">EXECUTION PARAMETERS</div>
                                            <table className="w-full text-left font-mono text-[11px] text-[#e2e4e9]">
                                                <tbody>
                                                    <tr className="border-b border-[#272a35]">
                                                        <td className="py-2 text-[#8a8f98]">Target Entry</td>
                                                        <td className="py-2 text-right text-[#4caf50] font-bold">&gt; {pool.strategy.buyScoreThreshold}</td>
                                                    </tr>
                                                    <tr className="border-b border-[#272a35]">
                                                        <td className="py-2 text-[#8a8f98]">Target Exit</td>
                                                        <td className="py-2 text-right text-[#ffb74d] font-bold">&lt; {pool.strategy.exitThreshold}</td>
                                                    </tr>
                                                    <tr className="border-b border-[#272a35]">
                                                        <td className="py-2 text-[#8a8f98]">Critical Stop</td>
                                                        <td className="py-2 text-right text-[#ff6659] font-bold">{pool.strategy.positionStopLoss}%</td>
                                                    </tr>
                                                    <tr className="border-b border-[#272a35]">
                                                        <td className="py-2 text-[#8a8f98]">Win/Loss Ratio</td>
                                                        <td className="py-2 text-right text-white">
                                                            <span className="text-[#4caf50]">{pool.performance.winCount}</span> / <span className="text-[#ff6659]">{pool.performance.lossCount}</span>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ═ PERFORMANCE GRAPH ═ */}
            {performanceHistory && (
                <>
                    <div className="mc-label flex items-center gap-3 pt-4">
                        <span>PERFORMANCE GRAPH // NAV &amp; POOL TRAJECTORIES</span>
                        <div className="h-px bg-[#272a35] flex-1" />
                    </div>
                    <PerformanceChart history={performanceHistory} />
                </>
            )}

            {/* ═ AI STRATEGY INTELLIGENCE REPORT ═ */}
            {strategyReport && (
                <>
                    <div className="mc-label flex items-center gap-3 pt-4">
                        <span>AI STRATEGY INTELLIGENCE // {strategyReport.reportType} BRIEFING</span>
                        <div className="h-px bg-[#272a35] flex-1"></div>
                    </div>

                    <div className="mc-panel">
                        <div className="mc-panel-header">
                            <span>{strategyReport.reportType === 'MORNING' ? '☀️ MORNING' : '🌙 EVENING'} BRIEFING</span>
                            <div className="flex items-center gap-4">
                                {/* vs BTC benchmark badge */}
                                {strategyReport.overallVsBtc !== undefined && (
                                    <span className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border ${strategyReport.overallVsBtc >= 0 ? 'text-[#4caf50] border-[#4caf50]/30 bg-[#4caf50]/10' : 'text-[#ff6659] border-[#ff6659]/30 bg-[#ff6659]/10'}`}>
                                        {strategyReport.overallVsBtc >= 0 ? '▲' : '▼'} {strategyReport.overallVsBtc >= 0 ? '+' : ''}{strategyReport.overallVsBtc.toFixed(2)}% vs BTC
                                    </span>
                                )}
                                <span className="text-[#8a8f98]">{new Date(strategyReport.generatedAt).toLocaleString()}</span>
                            </div>
                        </div>

                        {/* Pool Grades Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-[#0a0a0c]/50 border-b border-[#272a35]">
                            {strategyReport.poolAnalyses.map((pa) => {
                                const gradeColor = pa.grade === 'A' ? '#4caf50' : pa.grade === 'B' ? '#8bc34a' : pa.grade === 'C' ? '#ffb74d' : pa.grade === 'D' ? '#ff9800' : '#ff6659';
                                const vsBtc = pa.vsBtc ?? 0;
                                const poolStatusColor = pa.pnlPct >= 0 ? '#4caf50' : vsBtc >= -2 ? '#ffb74d' : '#ff6659';
                                return (
                                    <div key={pa.poolId} className="bg-white/5 p-3 rounded-xl border border-white/8">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs text-[#8a8f98]">{pa.emoji} {pa.poolName}</span>
                                            <span className="text-xl font-bold font-mono" style={{ color: gradeColor }}>{pa.grade}</span>
                                        </div>
                                        <div className="text-xs text-[#e2e4e9] mb-1">{pa.tokens?.join(', ')}</div>
                                        <div className={`text-sm font-mono font-bold`} style={{ color: poolStatusColor }}>
                                            ${pa.nav?.toFixed(2)} ({pa.pnlPct >= 0 ? '+' : ''}{pa.pnlPct?.toFixed(2)}%)
                                        </div>
                                        {pa.vsBtc !== undefined && (
                                            <div className={`text-[10px] font-mono mt-0.5 ${vsBtc >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                {vsBtc >= 0 ? '▲' : '▼'} {vsBtc >= 0 ? '+' : ''}{vsBtc.toFixed(2)}% vs BTC
                                            </div>
                                        )}
                                        <div className="text-[10px] text-[#8a8f98] mt-1">{pa.trades} trades ({pa.wins}W/{pa.losses}L)</div>
                                        <div className="text-[10px] text-[#adb5c4] mt-2 italic leading-relaxed">{pa.keyInsight}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* 24h Predictions Table */}
                        {strategyReport.predictions && strategyReport.predictions.length > 0 && (
                            <div className="p-4 border-b border-[#272a35]">
                                <div className="mc-label text-[10px] mb-3">24H TOKEN FORECAST</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {strategyReport.predictions.map((pred, i) => {
                                        const biasIcon = pred.bias === 'BULLISH' ? '🟢' : pred.bias === 'NEUTRAL_TO_BULLISH' ? '🔼' : pred.bias === 'NEUTRAL' ? '⬜' : pred.bias === 'NEUTRAL_TO_BEARISH' ? '🔽' : '🔴';
                                        const biasColor = (pred.bias === 'BULLISH' || pred.bias === 'NEUTRAL_TO_BULLISH') ? '#4caf50' : pred.bias === 'NEUTRAL' ? '#8a8f98' : '#ff6659';
                                        return (
                                            <div key={i} className="bg-white/5 rounded-lg p-3 border border-white/8">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-mono font-bold text-white text-sm">{biasIcon} {pred.token}</span>
                                                    <span className="font-mono text-[10px]" style={{ color: biasColor }}>{pred.bias.replace(/_/g, ' ')}</span>
                                                </div>
                                                <div className="font-mono text-[11px] text-[#e2e4e9] mb-1">
                                                    ${pred.priceRangeLow?.toFixed(3)} – ${pred.priceRangeHigh?.toFixed(3)}
                                                    <span className="text-[#8a8f98] ml-2">| Watch: ${pred.keyLevelToWatch?.toFixed(3)}</span>
                                                </div>
                                                <div className="text-[10px] text-[#adb5c4] italic leading-relaxed">{pred.rationale}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Analysis & Insights */}
                        <div className="p-4 space-y-4 text-sm font-mono">
                            <div>
                                <div className="mc-label text-[10px] mb-2">COMPARATIVE ANALYSIS</div>
                                <p className="text-[#e2e4e9] leading-relaxed">{strategyReport.comparativeAnalysis}</p>
                            </div>

                            <div>
                                <div className="mc-label text-[10px] mb-2">MARKET OUTLOOK</div>
                                <p className="text-[#adb5c4] leading-relaxed">{strategyReport.marketOutlook}</p>
                            </div>

                            {strategyReport.campaignProgress && (
                                <div className="bg-[#0b5394]/10 border border-[#0b5394]/30 rounded-xl p-3">
                                    <div className="mc-label text-[10px] text-[#4ba3e3] mb-2">📈 CAMPAIGN TRAJECTORY</div>
                                    <p className="text-[#adb5c4] text-xs leading-relaxed">{strategyReport.campaignProgress}</p>
                                </div>
                            )}

                            {strategyReport.recommendations.length > 0 && (
                                <div>
                                    <div className="mc-label text-[10px] mb-2">RECOMMENDATIONS</div>
                                    <ul className="space-y-1">
                                        {strategyReport.recommendations.map((r, i) => (
                                            <li key={i} className="text-[#4ba3e3] flex items-start gap-2">
                                                <span className="text-[#4caf50] mt-0.5">▸</span>
                                                <span className="text-[#e2e4e9]">{r}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {strategyReport.riskAlerts.length > 0 && (
                                <div className="bg-[#f57c00]/10 border border-[#f57c00]/30 rounded-xl p-3">
                                    <div className="mc-label text-[10px] text-[#ffb74d] mb-2">⚡ WATCH POINTS</div>
                                    {strategyReport.riskAlerts.map((r, i) => (
                                        <p key={i} className="text-[#ffb74d] text-xs">🟡 {r}</p>
                                    ))}
                                </div>
                            )}

                            <div className="text-[10px] text-[#555] text-right border-t border-[#272a35] pt-3">
                                Leader: {strategyReport.leaderPool} · Laggard: {strategyReport.laggardPool} · NAV: ${strategyReport.overallNAV?.toFixed(2)}
                            </div>
                        </div>
                    </div>
                </>
            )}


            {/* ═ EXECUTION LEDGER ═ */}
            <div className="mc-label flex items-center gap-3 pt-4">
                <span>EXECUTION LEDGER // RAW FEED</span>
                <div className="h-px bg-[#272a35] flex-1"></div>
            </div>

            <div className="mc-panel">
                <div className="mc-panel-header">
                    <span>OPERATIONAL LOGS</span>
                    <span>{trades.length} EVENT(S)</span>
                </div>

                <div className="bg-[#0a0a0c]">
                    {trades.length === 0 ? (
                        <div className="p-8 text-center border-y border-[#272a35]">
                            <span className="mc-value text-[#8a8f98] text-sm">NO EXECUTIONS RECORDED. MONITORING...</span>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto w-full">
                                <table className="w-full text-left font-mono text-xs border-collapse">
                                    <thead className="bg-[#121318] border-b border-[#272a35]">
                                        <tr>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal">TIMESTAMP</th>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal">TYPE</th>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal">ASSET</th>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal">UNIT</th>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal text-right">TOTAL (USD)</th>
                                            <th className="py-3 px-4 text-[#8a8f98] font-normal text-right">PNL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {trades.slice(ledgerPage * TRADES_PER_PAGE, (ledgerPage + 1) * TRADES_PER_PAGE).map((t, i) => {
                                            const isBuy = t.type === 'BUY';
                                            const dateStr = new Date(t.date || Date.now()).toISOString().replace('T', ' ').substring(0, 19);
                                            return (
                                                <tr key={i} className="border-b border-[#272a35] hover:bg-[#121318] transition-colors">
                                                    <td className="py-3 px-4 text-[#8a8f98]">{dateStr}</td>
                                                    <td className={`py-3 px-4 font-bold ${isBuy ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>{t.type}</td>
                                                    <td className="py-3 px-4 text-white">
                                                        {t.ticker}
                                                        <span className="text-[#8a8f98] text-[9px] ml-2 block sm:inline">({t.poolName})</span>
                                                    </td>
                                                    <td className="py-3 px-4 text-[#e2e4e9]">{t.amount.toFixed(4)} @ ${fmtPrice(t.price)}</td>
                                                    <td className="py-3 px-4 text-white text-right font-bold">${t.total.toFixed(2)}</td>
                                                    <td className="py-3 px-4 text-right">
                                                        {t.pnlPct !== undefined ? (
                                                            <span className={`font-bold ${t.pnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                                {fmtPct(t.pnlPct)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[#8a8f98]">--</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Controls */}
                            {trades.length > TRADES_PER_PAGE && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-[#272a35] bg-[#121318]">
                                    <button
                                        onClick={() => setLedgerPage(p => Math.max(0, p - 1))}
                                        disabled={ledgerPage === 0}
                                        className="px-3 py-1.5 font-mono text-xs tracking-wider border border-[#272a35] text-[#8a8f98] hover:text-white hover:border-[#4ba3e3] transition-colors disabled:opacity-30 disabled:hover:text-[#8a8f98] disabled:hover:border-[#272a35]"
                                    >
                                        ◄ PREV
                                    </button>
                                    <span className="font-mono text-xs text-[#8a8f98]">
                                        PAGE {ledgerPage + 1} / {Math.ceil(trades.length / TRADES_PER_PAGE)}
                                    </span>
                                    <button
                                        onClick={() => setLedgerPage(p => Math.min(Math.ceil(trades.length / TRADES_PER_PAGE) - 1, p + 1))}
                                        disabled={ledgerPage >= Math.ceil(trades.length / TRADES_PER_PAGE) - 1}
                                        className="px-3 py-1.5 font-mono text-xs tracking-wider border border-[#272a35] text-[#8a8f98] hover:text-white hover:border-[#4ba3e3] transition-colors disabled:opacity-30 disabled:hover:text-[#8a8f98] disabled:hover:border-[#272a35]"
                                    >
                                        NEXT ►
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

        </div >
    );
}
