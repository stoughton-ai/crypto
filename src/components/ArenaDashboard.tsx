"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, ChevronRight, Activity, Zap, Server, ShieldAlert, Shield, X, HelpCircle, AlertCircle, TrendingDown, TrendingUp } from "lucide-react";
import { getArenaStatus, refreshArenaPrices, manualInitArena, manualPurchase, getLatestStrategyReport, getWeeklyComparisonReport, getPerformanceHistory, runSandboxArenaCycle, resetMissionClock, syncFromRevolutAndReset, updateManualPositionSettings, executeManualSell, addToManualPosition, enableMasterPortfolioMode, manualRevolutSync, resetUserArena, activateSandboxCompetition, type StrategyReport, type WeeklyComparisonReport, type PerformanceHistory } from "@/app/actions";
import type { ArenaConfig, ArenaTradeRecord, PoolId, AssetClass, TokenAnalysis } from "@/lib/constants";
import { ARENA_START_DATE, ARENA_DURATION_DAYS, POOL_COUNT, POOL_BUDGET, ARENA_THEME, getCurrencySymbol, SANDBOX_ASSET_CLASSES, MOTHBALLED_ASSET_CLASSES } from "@/lib/constants";
import AuditTrail from "@/components/AuditTrail";
import PerformanceChart from "@/components/PerformanceChart";
import SandboxBanner from "@/components/SandboxBanner";
import IntegrityAlerts from "@/components/IntegrityAlerts";
import IntelligenceScanner from "@/components/IntelligenceScanner";
import ManualMadnessControls from "@/components/ManualMadnessControls";
import { useAuth } from "@/context/AuthContext";
import { getLatestDeepDiveReport, generateDeepDiveReport, type DeepDiveReport } from "@/app/deepDiveActions";

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

function LivePrice({ value, currency }: { value: number, currency: string }) {
    const [trend, setTrend] = useState<'up' | 'down' | null>(null);
    const prevValueRef = React.useRef(value);

    useEffect(() => {
        if (value > prevValueRef.current) {
            setTrend('up');
            const timer = setTimeout(() => setTrend(null), 1000);
            prevValueRef.current = value;
            return () => clearTimeout(timer);
        } else if (value < prevValueRef.current) {
            setTrend('down');
            const timer = setTimeout(() => setTrend(null), 1000);
            prevValueRef.current = value;
            return () => clearTimeout(timer);
        }
        prevValueRef.current = value;
    }, [value]);

    return (
        <span className={`transition-all duration-500 rounded px-1 -mx-1 ${trend === 'up' ? 'bg-[#4caf50]/20 text-[#4caf50]' : trend === 'down' ? 'bg-[#ff6659]/20 text-[#ff6659]' : ''}`}>
            {currency}{fmtPrice(value)}
        </span>
    );
}

interface ArenaDashboardProps {
    userId?: string;
    assetClass?: AssetClass;
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
    const [weeklyReport, setWeeklyReport] = useState<WeeklyComparisonReport | null>(null);
    const [performanceHistory, setPerformanceHistory] = useState<PerformanceHistory | null>(null);
    const [tokenAnalyses, setTokenAnalyses] = useState<TokenAnalysis[]>([]);

    const [deepDiveReport, setDeepDiveReport] = useState<any>(null);
    const [generatingDeepDive, setGeneratingDeepDive] = useState(false);
    const [ledgerPage, setLedgerPage] = useState(0);
    const [showAuditTrail, setShowAuditTrail] = useState(false);
    const [showManualTrade, setShowManualTrade] = useState(false);
    const [isActivating, setIsActivating] = useState(false);
    const [smartAlert, setSmartAlert] = useState<{ 
        title: string; 
        message: string; 
        type: 'info' | 'success' | 'error' | 'confirm';
        onConfirm?: () => void;
        onCancel?: () => void;
    } | null>(null);
    const TRADES_PER_PAGE = 8;

    const showAlert = (title: string, message: string, type: 'info' | 'success' | 'error' = 'info') => {
        setSmartAlert({ title, message, type });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void) => {
        setSmartAlert({ 
            title, 
            message, 
            type: 'confirm', 
            onConfirm: () => { setSmartAlert(null); onConfirm(); },
            onCancel: () => setSmartAlert(null)
        });
    };

    useEffect(() => {
        const i = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(i);
    }, []);

    const loadData = useCallback(async () => {
        if (!userId) return;
        try {
            const [status, freshPrices, report, deepDive] = await Promise.all([
                getArenaStatus(userId, assetClass),
                refreshArenaPrices(userId, assetClass),
                getLatestStrategyReport(userId, assetClass),
                getLatestDeepDiveReport(userId),
            ]);
            
            if (status.arena) {
               setArena(status.arena);
            }
            setDeepDiveReport(deepDive);
            setTokenAnalyses(status.tokenAnalyses || []);
            setTrades(status.trades);
            setMarket(status.marketStats);
            setEodhd(status.eodhd);
            if (report) setStrategyReport(report);
            setPrices(freshPrices);
            if (assetClass === 'CRYPTO') {
                const weekly = await getWeeklyComparisonReport(userId);
                if (weekly) setWeeklyReport(weekly);
            }
            const history = await getPerformanceHistory(userId, freshPrices, assetClass);
            if (history) setPerformanceHistory(history);
        } catch (e: any) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [userId, assetClass]);

    const handleGenerateDeepDive = async () => {
        setGeneratingDeepDive(true);
        try {
            const rep = await generateDeepDiveReport(userId);
            setDeepDiveReport(rep || null);
        } finally {
            setGeneratingDeepDive(false);
        }
    };

    useEffect(() => { if (userId) loadData(); }, [loadData, userId]);
    useEffect(() => {
        if (!userId) return;
        const t = setInterval(loadData, 30000);
        return () => clearInterval(t);
    }, [loadData, userId]);

    const poolValues = useMemo(() => {
        if (!arena) return [];
        return arena.pools.map((pool, idx) => {
            let holdVal = 0;
            let holdCost = 0;
            for (const [t, h] of Object.entries(pool.holdings)) {
                const currentPrice = prices[t.toUpperCase()]?.price || h.averagePrice;
                holdVal  += h.amount * currentPrice;
                holdCost += h.amount * h.averagePrice;
            }
            const total = holdVal;
            const costBasis = holdCost;
            const pnl = total - costBasis;
            const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            return { ...pool, total, pnl, pnlPct, costBasis, idx };
        });
    }, [arena, prices]);

    const sharedCash = arena?.sharedCash ?? 0;
    const totalHoldingValue = poolValues.reduce((s, p) => s + p.total, 0);
    const totalValue = totalHoldingValue + sharedCash;
    const totalCash = sharedCash;
    const arenaBudget = arena?.totalBudget ?? (POOL_COUNT * POOL_BUDGET);
    const totalDcaContributions = arena?.sharedDcaContributions ?? 0;
    const totalDcaReserve = arena?.sharedDcaReserve ?? 0;
    const totalDcaDeployed = arena?.sharedDcaDeployed ?? 0;
    const effectiveBasis = arenaBudget + totalDcaContributions;
    const totalPnl = totalValue - effectiveBasis;
    const totalPnlPct = effectiveBasis > 0 ? (totalPnl / effectiveBasis) * 100 : 0;
    const hasDca = totalDcaContributions > 0 || totalDcaReserve > 0;
    const leaderIdx = poolValues.reduce((b, p, i) => p.pnlPct > (poolValues[b]?.pnlPct ?? -Infinity) ? i : b, 0);
    const origTokenPct = totalValue > 0 ? (totalHoldingValue / totalValue) * 100 : 0;
    const freeCashPct = totalValue > 0 ? (totalCash / totalValue) * 100 : 0;
    const isSandbox = isNonCryptoClass && !(arena?.competitionMode);

    const isMarketFear = (market?.fearGreedIndex ?? 50) < 40;
    const isApiCritical = eodhd.pct > 0.9;

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

    let mainContent;

    if (!userId && !authLoading) {
        mainContent = (
            <div className="mc-panel p-10 text-center border-l-4 border-l-[#ff6659] max-w-2xl mx-auto mt-20">
                <div className="mc-label text-[#ff6659] mb-4 text-lg">ACCESS DENIED // UPLINK LOST</div>
                <p className="font-mono text-sm text-[#8a8f98] mb-8 leading-relaxed">Please sign in to establish a telemetry link.</p>
                <div className="flex justify-center"><Server className="text-[#ff6659] opacity-30" size={48} /></div>
            </div>
        );
    } else if (MOTHBALLED_ASSET_CLASSES.includes(assetClass)) {
        mainContent = (
            <div className="mc-panel p-10 text-center border-l-4 border-l-[#ff6659] max-w-2xl mx-auto mt-20">
                <div className="mc-label text-[#ff6659] mb-4 text-lg">ARENA STATUS: MOTHBALLED</div>
                <p className="font-mono text-sm text-[#8a8f98] mb-8 leading-relaxed">This asset class has been retired from automated monitoring.</p>
                <div className="flex justify-center"><ShieldAlert className="text-[#ff6659] opacity-50" size={48} /></div>
            </div>
        );
    } else if (showAuditTrail) {
        mainContent = <AuditTrail userId={userId} onBack={() => setShowAuditTrail(false)} assetClass={assetClass} />;
    } else if (!arena?.initialized) {
        mainContent = (
            <div className="mc-panel p-10 text-center border-l-4 border-l-[#ffb74d] max-w-2xl mx-auto mt-20">
                <div className="mc-label text-[#ffb74d] mb-4 text-lg">SYSTEM HALT: ARENA PENDING DEPLOYMENT</div>
                <p className="font-mono text-sm text-[#e2e4e9] mb-8 leading-relaxed">
                    The Semaphore platform is currently awaiting initialization.
                </p>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <button
                            onClick={() => showConfirm("INIT ARENA", "Trigger AI strategies?", async () => {
                                setIsInitializing(true);
                                try {
                                    const res = await manualInitArena(userId, assetClass);
                                    if (res.success) await loadData();
                                } finally { setIsInitializing(false); }
                            })}
                            className="bg-[#2e7d32] hover:bg-[#1b5e20] text-white px-8 py-3 font-mono text-sm font-bold uppercase transition-colors"
                        >INITIALIZE ARENA</button>

                        {assetClass === 'CRYPTO' && (
                            <button
                                onClick={() => showConfirm("MASTER MODE", "Mirror Revolut X?", async () => {
                                    setIsInitializing(true);
                                    try {
                                        await resetUserArena(userId, 'CRYPTO');
                                        await manualInitArena(userId, 'CRYPTO');
                                        const res = await enableMasterPortfolioMode(userId);
                                        if (res.success) await loadData();
                                    } finally { setIsInitializing(false); }
                                })}
                                className="bg-[#0b5394] hover:bg-[#0d61ad] text-white px-8 py-3 font-mono text-sm font-bold uppercase"
                            >INITIALIZE AS MASTER PORTFOLIO</button>
                        )}
                    </div>
                </div>
            </div>
        );
    } else {
        const poolTickers = arena.pools.flatMap(p => Object.keys(p.holdings).map(t => t.toUpperCase()));
        const tickerTokens = Array.from(new Set(['BTC', ...poolTickers]));

        mainContent = (
            <div className="space-y-4">
                {/* Global Scrolling Ticker */}
                <div className="mc-panel p-0 overflow-hidden bg-black/40 border-y border-white/5 mb-4">
                    <div className="flex animate-ticker whitespace-nowrap py-2 hover:pause">
                        {[...tickerTokens, ...tickerTokens].map((t, i) => (
                            <div key={`${t}-${i}`} className="inline-flex items-center px-6 border-r border-white/5 space-x-3">
                                <span className="mc-label text-[9px] text-[#4ba3e3]">{t}</span>
                                <span className="mc-value text-xs font-bold text-white">
                                    {currency}{fmtPrice(prices[t.toUpperCase()]?.price || 0)}
                                </span>
                                <span className={`text-[8px] font-mono ${(prices[t.toUpperCase()]?.change24h || 0) >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                    {fmtPct(prices[t.toUpperCase()]?.change24h || 0)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {isSandbox && <SandboxBanner assetClass={assetClass} onCycleComplete={loadData} onActivateCompetition={async () => {}} isActivating={isActivating} showAlert={showAlert} showConfirm={showConfirm} />}
                
                {arena?.masterPortfolioMode && (
                    <div className="mc-panel p-4 border-l-4 border-l-[#4ba3e3] bg-[#1a1c24] flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <Shield className="w-5 h-5 text-[#4ba3e3]" />
                            <div>
                                <div className="mc-label text-[#4ba3e3] text-sm font-bold tracking-widest leading-none">MASTER PORTFOLIO MODE ACTIVE</div>
                                <div className="text-[10px] text-[#8a8f98] font-mono mt-1 uppercase">Mirroring Revolut X // Sell-Only Mode Enabled</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={async () => {
                                    setRefreshing(true);
                                    try {
                                        const res = await manualRevolutSync(userId);
                                        if (res.success) {
                                            showAlert("SYNCHRONIZED", res.message);
                                            await loadData();
                                        } else {
                                            showAlert("SYNC ERROR", res.message);
                                        }
                                    } finally { setRefreshing(false); }
                                }}
                                disabled={refreshing}
                                className="px-4 py-2 bg-[#4ba3e3] hover:bg-[#4ba3e3]/90 text-white font-mono text-[10px] font-bold uppercase tracking-wider rounded flex items-center gap-2 transition-all disabled:opacity-50 shadow-[0_0_15px_rgba(75,163,227,0.3)]"
                            >
                                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                                SYNC NOW
                            </button>
                        </div>
                    </div>
                )}

                {/* Status Bar */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4">
                    <div className="mc-panel lg:col-span-6 p-5 flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-4">
                            <span className="mc-label">NET ASSET VALUE (NAV)</span>
                            <StatusIndicator status={totalPnl >= 0 ? 'nominal' : 'critical'} />
                        </div>
                        <div className="flex items-baseline gap-4">
                            <span className="mc-value text-4xl font-bold text-white">{currency}{fmtPrice(totalValue)}</span>
                            <span className={`mc-value text-lg ${totalPnl >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>{fmtPct(totalPnlPct)}</span>
                        </div>
                        <div className="mc-divider my-4" />
                        <div className="flex justify-between items-center text-xs">
                            <span className="mc-label">TOTAL CAPITAL</span>
                            <span className="mc-value text-[#8a8f98] font-mono">{currency}{effectiveBasis.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="lg:col-span-6 grid grid-cols-2 gap-4">
                        <div className="mc-panel p-4 flex flex-col justify-between">
                            <div className="mc-label text-[10px] mb-2">{assetClass === 'CRYPTO' ? 'BTC ORACLE' : 'TOP PERFORMER'}</div>
                            <div className="mc-value text-xl text-white flex items-center gap-2">
                                <LivePrice value={prices['BTC']?.price || 0} currency="$" />
                                <div className="live-indicator">
                                    <div className="live-indicator-dot" />
                                    <span>LIVE</span>
                                </div>
                            </div>
                            <TelemetryBar pct={75} />
                        </div>
                        <div className="mc-panel p-4 flex flex-col justify-between">
                            <div className="mc-label text-[10px] mb-2">TELEMETRY LINK</div>
                            <div className="mc-value text-xl text-white">{(eodhd.pct * 100).toFixed(1)}%</div>
                            <TelemetryBar pct={eodhd.pct * 100} colorClass={isApiCritical ? 'bg-red-500' : 'bg-[#0b5394]'} />
                        </div>
                    </div>
                </div>

                {/* Performance Chart */}
                {performanceHistory && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                        <PerformanceChart history={performanceHistory} />
                    </div>
                )}

                {/* Portfolio Section */}
                <div className="mc-panel p-5 border-l-4 border-l-[#4caf50]">
                    <div className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-3">
                            <span className="mc-label text-[#4caf50]">PORTFOLIO ALLOCATION</span>
                            <button onClick={() => setShowManualTrade(true)} className="px-2 py-1 border border-[#4ba3e3]/40 text-[#4ba3e3] text-[9px] font-black uppercase hover:bg-[#4ba3e3]/10 transition-all">+ MANUAL ACQUISITION</button>
                        </div>
                        <div className="flex gap-4">
                            <div className="text-right">
                                <div className="mc-label text-[9px] text-[#8a8f98]">ASSETS</div>
                                <div className="mc-value text-white font-mono">{currency}{totalHoldingValue.toFixed(2)}</div>
                            </div>
                            <div className="text-right">
                                <div className="mc-label text-[9px] text-[#8a8f98]">CASH</div>
                                <div className="mc-value text-[#ffb74d] font-mono">{currency}{totalCash.toFixed(2)}</div>
                            </div>
                        </div>
                    </div>
                    <div className="h-2 bg-[#1a1c24] flex rounded-full overflow-hidden">
                        <div className="h-full bg-[#4caf50] transition-all duration-1000" style={{ width: `${origTokenPct}%` }} />
                        <div className="h-full bg-[#ffb74d] transition-all duration-1000" style={{ width: `${freeCashPct}%` }} />
                    </div>
                </div>

                {/* Integrity Alerts */}
                <IntegrityAlerts userId={userId} assetClass={assetClass} showAlert={showAlert} showConfirm={showConfirm} />

                {/* Strategy Deployment Grid */}
                <div className="mc-label text-[10px] tracking-[0.2em] opacity-40 py-4 flex items-center gap-4">
                    <span>STRATEGY DEPLOYMENT TELEMETRY</span>
                    <div className="h-px bg-white/5 flex-1"></div>
                </div>

                <div className={`grid grid-cols-1 ${arena.masterPortfolioMode ? '' : 'md:grid-cols-2'} gap-6`}>
                    {arena.pools.filter(p => p.status === 'ACTIVE').map(pool => {
                        const pv = poolValues.find(v => v.poolId === pool.poolId);
                        const isLeader = poolValues.indexOf(pv!) === leaderIdx;
                        const pnl = pv?.pnl ?? 0;
                        const pnlPct = pv?.pnlPct ?? 0;
                        const isProfitable = pnl >= 0;

                        return (
                            <div key={pool.poolId} className={`mc-panel overflow-hidden border-t-2 relative group ${isLeader ? 'border-t-[#4ba3e3]' : 'border-t-[#272a35]'}`}>
                                {/* Gradient background hint */}
                                <div className="absolute inset-0 bg-gradient-to-br from-[#4ba3e3]/5 to-transparent pointer-events-none" />
                                
                                <div className="mc-panel-header px-6 py-4 bg-white/[0.02] flex justify-between items-center border-b border-white/5">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded bg-white/5 ${isLeader ? 'text-[#4ba3e3]' : 'text-[#8a8f98]'}`}>
                                            <Shield size={16} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="mc-label text-xs tracking-widest">{pool.name}</span>
                                            <span className="text-[9px] text-[#555] font-mono uppercase tracking-[0.2em]">Synchronized // Revolut X uplink</span>
                                        </div>
                                    </div>
                                    <div className="text-right flex flex-col">
                                        <span className={`font-mono text-lg font-bold ${isProfitable ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>{fmtPct(pnlPct)}</span>
                                        <span className="text-[8px] text-[#8a8f98] uppercase tracking-widest">Master Net Performance</span>
                                    </div>
                                </div>

                                <div className="p-8 grid grid-cols-1 lg:grid-cols-12 gap-12">
                                    {/* Left: Financial Overview */}
                                    <div className="lg:col-span-4 flex flex-col justify-start space-y-6">
                                        <div className="space-y-1">
                                            <span className="mc-label text-[10px] text-[#8a8f98] tracking-[0.3em]">TOTAL EQUITY</span>
                                            <div className="text-5xl font-black text-white tracking-tight">{currency}{fmtPrice(pv?.total || 0)}</div>
                                            <div className={`font-mono text-sm flex items-center gap-2 ${isProfitable ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                {isProfitable ? <Activity size={14} /> : <TrendingDown size={14} />} 
                                                {isProfitable?'+':'-'}{currency}{Math.abs(pnl).toFixed(2)} TOTAL PNL
                                            </div>
                                        </div>
                                        
                                        <div className="pt-6 grid grid-cols-2 gap-4 border-t border-white/5">
                                            <div>
                                                <div className="text-[9px] text-[#555] font-bold uppercase tracking-widest mb-1">Cost Basis</div>
                                                <div className="text-sm font-mono text-white/60">{currency}{fmtPrice(pv?.costBasis || 0)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] text-[#555] font-bold uppercase tracking-widest mb-1">Exposure</div>
                                                <div className="text-sm font-mono text-white/60">{((pv?.total || 0) / (totalValue || 1) * 100).toFixed(1)}%</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Holding Breakdown */}
                                    <div className="lg:col-span-8 bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                                        <div className="bg-white/5 px-4 py-2 flex justify-between text-[9px] font-black tracking-widest text-[#555] uppercase border-b border-white/5">
                                            <span>Active Positions</span>
                                            <span>Valuation @ Live Price</span>
                                        </div>
                                        <div className="w-full">
                                            {Object.entries(pool.holdings).length === 0 ? (
                                                <div className="p-8 text-center text-[#555] font-mono text-xs uppercase italic">No active positions mirrored from Revolut X</div>
                                            ) : (
                                                Object.entries(pool.holdings).sort((a,b) => {
                                                    const liveA = prices[a[0].toUpperCase()]?.price || a[1].averagePrice;
                                                    const liveB = prices[b[0].toUpperCase()]?.price || b[1].averagePrice;
                                                    return (b[1].amount * liveB) - (a[1].amount * liveA);
                                                }).map(([ticker, h]) => {
                                                    const liveP = prices[ticker.toUpperCase()]?.price || h.averagePrice;
                                                    const curV = h.amount * liveP;
                                                    const posPnlPct = h.averagePrice > 0 ? ((liveP - h.averagePrice) / h.averagePrice) * 100 : 0;
                                                    
                                                    return (
                                                        <div key={ticker} className="flex justify-between items-center p-4 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors last:border-0 group/row">
                                                            <div className="flex items-center gap-3">
                                                                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center font-mono text-xs font-bold text-[#4ba3e3] border border-white/5 group-hover/row:border-[#4ba3e3]/30 transition-all">
                                                                    {ticker[0]}
                                                                </div>
                                                                <div className="flex flex-col">
                                                                    <div className="text-sm font-bold text-white flex items-center gap-2">
                                                                        {ticker}
                                                                        <span className={`text-[9px] font-mono ${posPnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                                            {posPnlPct >= 0 ? '▲' : '▼'} {Math.abs(posPnlPct).toFixed(1)}%
                                                                        </span>
                                                                    </div>
                                                                    <div className="text-[10px] text-[#8a8f98] font-mono">
                                                                        {h.amount.toFixed(4)} <span className="text-[#555]">@</span> {currency}{fmtPrice(h.averagePrice)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <div className="text-sm font-bold text-white font-mono">
                                                                    <LivePrice value={curV} currency={currency} />
                                                                </div>
                                                                <div className="text-[10px] flex items-center justify-end gap-1.5">
                                                                    <span className="text-[#555] font-mono">{currency}{fmtPrice(liveP)}</span>
                                                                    <div className="live-indicator">
                                                                        <div className="live-indicator-dot" />
                                                                        <span>LIVE</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Manual Madness Controls Injection */}
                                <div className="border-t border-white/[0.05] bg-[#0d0e12] p-8">
                                    <ManualMadnessControls 
                                        userId={userId} 
                                        pool={pool} 
                                        prices={prices} 
                                        onUpdate={loadData} 
                                        showAlert={showAlert} 
                                        showConfirm={showConfirm} 
                                    />
                                </div>
                            </div>

                        );
                    })}
                </div>

                {/* Execution Ledger */}
                <div className="mc-panel overflow-hidden mt-8">
                    <div className="mc-panel-header">EXECUTION LEDGER FEED</div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left font-mono text-[10px]">
                            <thead className="bg-white/5">
                                <tr>
                                    <th className="p-3 text-[#8a8f98]">DATE</th>
                                    <th className="p-3 text-[#8a8f98]">OP</th>
                                    <th className="p-3 text-[#8a8f98]">TICKER</th>
                                    <th className="p-3 text-[#8a8f98]">UNITS</th>
                                    <th className="p-3 text-[#8a8f98] text-right">VALUE</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.slice(ledgerPage * 10, (ledgerPage + 1) * 10).map((t, idx) => (
                                    <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                        <td className="p-3 text-[#555]">{new Date(t.date).toLocaleDateString()}</td>
                                        <td className={`p-3 font-bold ${t.type==='BUY'?'text-[#4caf50]':'text-[#ff6659]'}`}>{t.type}</td>
                                        <td className="p-3 text-white">{t.ticker}</td>
                                        <td className="p-3 text-[#8a8f98]">{t.amount.toFixed(4)}</td>
                                        <td className="p-3 text-right text-white font-bold">{currency}{t.total.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {/* Context Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] font-black tracking-[0.2em] uppercase text-[#555]">
                    <span className="flex items-center gap-1.5"><StatusIndicator status="nominal" /> <span className="text-[#8a8f98]">SYSTEM NOMINAL</span></span>
                    <span className="flex items-center gap-1.5 text-[#4ba3e3]"><Activity size={10} /> UPLINK 010.59</span>
                    <span className="bg-white/5 px-2 py-0.5 rounded text-[#8a8f98]">{assetClass} ARENA // {arena?.masterPortfolioMode ? 'MASTER MODE' : 'AI-DCA STRATEGIC'}</span>
                </div>
                
                {/* Secondary Actions */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowAuditTrail(true)}
                        className="bg-white/5 hover:bg-white/10 text-[#8a8f98] px-3 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition-all flex items-center gap-2 border border-white/5"
                    >
                        <Shield size={10} /> AUDIT TRAIL
                    </button>
                    <button 
                        onClick={async () => { setRefreshing(true); await loadData(); setRefreshing(false); }}
                        className="bg-white/5 hover:bg-white/10 text-[#8a8f98] px-3 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition-all flex items-center gap-2 border border-white/5 shadow-[0_0_10px_rgba(255,255,255,0.02)]"
                    >
                        <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} /> REFRESH
                    </button>
                    <button 
                        onClick={() => showConfirm("RESET START", "Reset mission baseline to now? (Clears graph history)", async () => {
                            setRefreshing(true);
                            try {
                                const res = await resetMissionClock(userId, assetClass);
                                if (res.success) {
                                    showAlert("MISSION RESET", res.message);
                                    await loadData();
                                }
                            } finally { setRefreshing(false); }
                        })}
                        className="bg-white/5 hover:bg-white/10 text-orange-400/60 px-3 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition-all flex items-center gap-2 border border-orange-500/10"
                    >
                        <RefreshCw size={10} /> RESET START
                    </button>
                    {assetClass === 'CRYPTO' && (
                        <button
                            onClick={() => setShowManualTrade(true)}
                            className="bg-white/5 hover:bg-[#4ba3e3]/10 text-[#8a8f98] hover:text-[#4ba3e3] px-3 py-1.5 rounded font-mono text-[9px] font-bold uppercase transition-all flex items-center gap-2 border border-white/5"
                        >
                            <Zap size={10} /> MANUAL ACQUISITION
                        </button>
                    )}
                </div>
            </div>

                {mainContent}

            {/* Deep Dive Intelligence Report */}
            {assetClass === 'CRYPTO' && (
                <div className="mc-panel overflow-hidden mt-8 mb-8">
                    <div className="mc-panel-header flex justify-between items-center">
                        <div className="flex items-center gap-2 text-[#4ba3e3]">
                            <Activity size={14} /> DEEP DIVE INTELLIGENCE
                        </div>
                        <button
                            onClick={handleGenerateDeepDive}
                            disabled={generatingDeepDive}
                            className="bg-[#0b5394] hover:bg-[#0d61ad] text-white px-3 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {generatingDeepDive ? <RefreshCw size={12} className="animate-spin" /> : "GENERATE REPORT"}
                        </button>
                    </div>
                    <div className="p-8 space-y-8 bg-[#0d0e12]">
                        {deepDiveReport ? (
                            <>
                                <div className="text-[10px] text-[#8a8f98] font-mono tracking-widest flex justify-between">
                                    <span>LAST GENERATED: {new Date(deepDiveReport.generatedAt).toLocaleString()}</span>
                                    <span>Monitoring positions valued &gt; $50</span>
                                </div>
                                
                                {/* News Section */}
                                <div>
                                    <h3 className="text-[#ffb74d] text-xs font-bold font-mono tracking-widest mb-3 uppercase flex items-center gap-2">
                                        <AlertCircle size={14} /> Market Intelligence (News)
                                    </h3>
                                    <div className="text-[11px] font-mono text-[#e2e4e9] leading-relaxed whitespace-pre-wrap bg-black/40 p-5 border border-[#ffb74d]/20 rounded-lg">
                                        {deepDiveReport.marketplaceNews}
                                    </div>
                                </div>

                                {/* BTC Reference */}
                                {deepDiveReport.btcReference && (
                                    <div className="border border-[#f7931a]/50 bg-[#f7931a]/5 rounded-lg p-5">
                                        <h3 className="text-[#f7931a] text-sm font-bold font-mono mb-3 flex items-center justify-between">
                                            <span>BTC REFERENCE POINT</span>
                                            <span className="bg-[#f7931a] text-black px-2 py-0.5 rounded text-xs">GRADE {deepDiveReport.btcReference.rating}</span>
                                        </h3>
                                        <p className="text-sm text-white/90 leading-relaxed mb-4 font-mono">{deepDiveReport.btcReference.analysis}</p>
                                        <div className="grid grid-cols-3 gap-4 border-t border-[#f7931a]/20 pt-4">
                                            <div><div className="text-[10px] text-[#f7931a]/70 font-mono mb-1">24H TARGET</div><div className="text-md font-bold font-mono text-white">${deepDiveReport.btcReference.target24h?.toLocaleString() || '-'}</div></div>
                                            <div><div className="text-[10px] text-[#f7931a]/70 font-mono mb-1">7D TARGET</div><div className="text-md font-bold font-mono text-white">${deepDiveReport.btcReference.target7d?.toLocaleString() || '-'}</div></div>
                                            <div><div className="text-[10px] text-[#f7931a]/70 font-mono mb-1">30D TARGET</div><div className="text-md font-bold font-mono text-white">${deepDiveReport.btcReference.target30d?.toLocaleString() || '-'}</div></div>
                                        </div>
                                    </div>
                                )}

                                {/* Token Deep Dives */}
                                <div className="space-y-4">
                                    <h3 className="text-[#4ba3e3] text-xs font-bold font-mono tracking-widest uppercase pb-2 border-b border-white/10 mt-6">
                                        Active Position Analysis
                                    </h3>
                                    {deepDiveReport.tokenDeepDives?.map((t: any, i: number) => (
                                        <div key={i} className="bg-black/30 border border-white/10 rounded-lg p-5 hover:border-white/20 transition-all">
                                            <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
                                                <h4 className="text-white font-bold text-lg tracking-wider flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded bg-white/10 flex items-center justify-center text-[10px] text-[#4ba3e3]">{t.ticker[0]}</span>
                                                    {t.ticker}
                                                </h4>
                                                <span className={`px-2 py-0.5 rounded text-xs font-black font-mono ${['A','B'].includes(t.rating) ? 'bg-[#4caf50]' : ['C','D'].includes(t.rating) ? 'bg-[#ffb74d]' : 'bg-[#ff6659]'} text-black`}>GRADE {t.rating}</span>
                                            </div>
                                            <p className="text-sm text-[#8a8f98] leading-relaxed mb-4 font-mono">{t.analysis}</p>
                                            <div className="grid grid-cols-3 gap-4 bg-white/5 rounded-lg p-3">
                                                <div><div className="text-[9px] text-[#555] font-mono mb-1 uppercase tracking-widest">24H Target</div><div className="text-sm font-bold font-mono text-white">${t.target24h?.toLocaleString() || '-'}</div></div>
                                                <div><div className="text-[9px] text-[#555] font-mono mb-1 uppercase tracking-widest">7D Target</div><div className="text-sm font-bold font-mono text-white">${t.target7d?.toLocaleString() || '-'}</div></div>
                                                <div><div className="text-[9px] text-[#555] font-mono mb-1 uppercase tracking-widest">30D Target</div><div className="text-sm font-bold font-mono text-white">${t.target30d?.toLocaleString() || '-'}</div></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="text-center py-12 text-[#555] font-mono text-[10px] uppercase tracking-widest flex flex-col items-center justify-center gap-4">
                                <Activity size={32} className="opacity-20" />
                                No deep dive intelligence generated yet.<br/>Click "Generate Report" to run the LLM analysis cluster on holdings &gt; $50.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Global Modals & Overlays */}
            {showManualTrade && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="mc-panel w-full max-w-md bg-[#1a1c24] border-l-4 border-l-[#4ba3e3]">
                        <div className="p-6 border-b border-white/5 flex justify-between items-center">
                            <span className="mc-label text-[#4ba3e3]">MANUAL ACQUISITION</span>
                            <button onClick={() => setShowManualTrade(false)}><X size={20} className="text-[#555] hover:text-white" /></button>
                        </div>
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            const f = e.currentTarget;
                            const d = new FormData(f);
                            const ticker = d.get('ticker') as string;
                            const amount = parseFloat(d.get('amount') as string);
                            const price = parseFloat(d.get('price') as string);
                            const reason = d.get('reason') as string;
                            setRefreshing(true);
                            try {
                                const res = await manualPurchase(userId, assetClass, ticker, amount, price, reason);
                                if (res.success) { await loadData(); setShowManualTrade(false); }
                                else { showAlert("Purchase Failed", res.message, "error"); }
                            } finally { setRefreshing(false); }
                        }} className="p-6 space-y-4">
                            <input name="ticker" required placeholder="TICKER (e.g. BTC)" className="w-full bg-black/40 border border-white/5 p-3 font-mono text-sm uppercase outline-none focus:border-[#4ba3e3]" />
                            <div className="grid grid-cols-2 gap-4">
                                <input name="amount" type="number" step="any" required placeholder="AMOUNT" className="bg-black/40 border border-white/5 p-3 font-mono text-sm outline-none" />
                                <input name="price" type="number" step="any" required placeholder="UNIT PRICE" className="bg-black/40 border border-white/5 p-3 font-mono text-sm outline-none" />
                            </div>
                            <textarea name="reason" required placeholder="RATIONALE" className="w-full bg-black/40 border border-white/5 p-3 font-mono text-xs h-24 outline-none" />
                            <button type="submit" disabled={refreshing} className="w-full bg-[#0b5394] hover:bg-[#0d61ad] text-white py-4 font-mono text-sm font-black uppercase transition-all disabled:opacity-50">
                                {refreshing ? 'AUTHORIZING...' : 'CONFIRM ACQUISITION'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {smartAlert && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="mc-panel w-full max-w-sm overflow-hidden bg-[#1a1c24] border-t-2 scale-in" style={{ borderColor: smartAlert?.type === 'error' ? '#ff6659' : smartAlert?.type === 'success' ? '#4caf50' : '#4ba3e3' }}>
                        <div className="p-8 text-center">
                            <div className="flex justify-center mb-6">
                                {smartAlert?.type === 'error' ? <ShieldAlert size={48} className="text-[#ff6659]" /> : smartAlert?.type === 'success' ? <Shield size={48} className="text-[#4caf50]" /> : <Activity size={48} className="text-[#4ba3e3]" />}
                            </div>
                            <h3 className="mc-label text-lg mb-2 tracking-[0.2em]">{smartAlert?.title}</h3>
                            <p className="text-sm text-[#8a8f98] font-mono leading-relaxed mb-8">{smartAlert?.message}</p>
                            
                            <div className="flex flex-col gap-3">
                                {smartAlert?.type === 'confirm' ? (
                                    <>
                                        <button onClick={smartAlert?.onConfirm} className="mc-button w-full justify-center bg-[#0b5394] hover:bg-[#0d61ad] text-white py-4 font-mono text-sm font-black uppercase transition-all shadow-[0_0_20px_rgba(11,83,148,0.3)]">CONFIRM // AUTHORIZE</button>
                                        <button onClick={smartAlert?.onCancel} className="mc-button w-full justify-center bg-white/5 hover:bg-white/10 text-[#555] py-2 font-mono text-[9px] font-black uppercase transition-all">ABORT // CANCEL</button>
                                    </>
                                ) : (
                                    <button onClick={() => setSmartAlert(null)} className="mc-button w-full justify-center bg-white/5 hover:bg-white/10 text-white py-4 font-mono text-sm font-black uppercase transition-all">CONTINUE // DISMISS</button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
