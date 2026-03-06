"use client";

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, ArrowLeft, ChevronDown, ChevronRight, Shield, GitBranch, Eye, AlertTriangle, Zap, Clock, Filter } from "lucide-react";
import { getAuditTrail, type AuditTrailData, type AuditStrategyChange, type AuditEvent, type StrategyDiffField } from "@/app/actions";

// ─── Helpers ─────────────────────────────────────────────
function fmtDate(ts: string) {
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtRelative(ts: string) {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}
function fmtValue(val: any): string {
    if (val === undefined || val === null) return '—';
    if (typeof val === 'boolean') return val ? 'ON' : 'OFF';
    if (typeof val === 'number') return val.toString();
    return String(val);
}

const EVENT_ICONS: Record<string, { icon: string; colorClass: string; bgClass: string }> = {
    STRATEGY_CHANGE: { icon: '⚙️', colorClass: 'text-[#ffb74d]', bgClass: 'bg-[#3d2a00]' },
    WEEKLY_REVIEW: { icon: '🧠', colorClass: 'text-[#4ba3e3]', bgClass: 'bg-[#0a2540]' },
    TRADE: { icon: '💱', colorClass: 'text-[#e2e4e9]', bgClass: 'bg-[#1a1c23]' },
    POOL_PAUSE: { icon: '⛔', colorClass: 'text-[#ff6659]', bgClass: 'bg-[#3d0a0a]' },
    ARENA_INIT: { icon: '🏟️', colorClass: 'text-[#4caf50]', bgClass: 'bg-[#0a3d0a]' },
};

const POOL_COLORS: Record<string, string> = {
    POOL_1: '#0b5394',
    POOL_2: '#2e7d32',
    POOL_3: '#f57c00',
    POOL_4: '#5c2b80',
};

type FilterType = 'ALL' | 'STRATEGY_CHANGE' | 'WEEKLY_REVIEW' | 'TRADE' | 'POOL_PAUSE';

// ─── Sub-components ─────────────────────────────────────

function DiffBadge({ impact }: { impact: string }) {
    const styles: Record<string, string> = {
        positive: 'bg-[#0a3d0a] text-[#4caf50] border-[#2e7d32]',
        negative: 'bg-[#3d0a0a] text-[#ff6659] border-[#d32f2f]',
        neutral: 'bg-[#1a1c23] text-[#8a8f98] border-[#272a35]',
        info: 'bg-[#0a2540] text-[#4ba3e3] border-[#0b5394]',
    };
    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${styles[impact] || styles.info}`}>
            {impact}
        </span>
    );
}

function DiffRow({ diff }: { diff: StrategyDiffField }) {
    const isDesc = diff.field === 'description';
    return (
        <div className={`flex items-start gap-3 py-2 border-b border-[#1a1c23] last:border-0 ${isDesc ? 'flex-col' : ''}`}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] text-[#8a8f98] font-mono w-36 shrink-0 truncate">{diff.label}</span>
                {!isDesc && (
                    <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-[#ff6659] line-through opacity-60">{fmtValue(diff.oldValue)}</span>
                        <span className="text-[#8a8f98]">→</span>
                        <span className="text-[#4caf50] font-bold">{fmtValue(diff.newValue)}</span>
                    </div>
                )}
                <DiffBadge impact={diff.impact} />
            </div>
            {isDesc && (
                <div className="w-full space-y-1 pl-2 border-l-2 border-[#272a35]">
                    <p className="text-[10px] text-[#ff6659] opacity-60 line-through font-mono">{diff.oldValue}</p>
                    <p className="text-[10px] text-[#4caf50] font-mono">{diff.newValue}</p>
                </div>
            )}
        </div>
    );
}

function StrategyChangeCard({ change, defaultExpanded }: { change: AuditStrategyChange; defaultExpanded?: boolean }) {
    const [expanded, setExpanded] = useState(defaultExpanded ?? false);
    const poolColor = POOL_COLORS[change.poolId] || '#272a35';

    return (
        <div className="border border-[#272a35] bg-[#121318] overflow-hidden transition-all">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-3 p-4 hover:bg-[#161b22] transition-colors text-left"
            >
                <div className="w-1 h-10 rounded-sm shrink-0" style={{ backgroundColor: poolColor }} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{change.poolEmoji}</span>
                        <span className="font-mono text-xs text-white font-bold">{change.poolName}</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#3d2a00] text-[#ffb74d] border border-[#f57c00]/30 tracking-wider">
                            {change.diffs.length} CHANGE{change.diffs.length !== 1 ? 'S' : ''}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] text-[#8a8f98] font-mono">{fmtDate(change.changedAt)} {fmtTime(change.changedAt)}</span>
                        <span className="text-[10px] text-[#555]">·</span>
                        <span className="text-[10px] text-[#555] font-mono">{fmtRelative(change.changedAt)}</span>
                    </div>
                </div>
                {expanded ? <ChevronDown size={14} className="text-[#8a8f98] shrink-0" /> : <ChevronRight size={14} className="text-[#8a8f98] shrink-0" />}
            </button>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-[#272a35]">
                    {/* AI Reasoning */}
                    <div className="px-4 py-3 bg-[#0a0a0c] border-b border-[#1a1c23]">
                        <div className="flex items-center gap-2 mb-2">
                            <Eye size={12} className="text-[#4ba3e3]" />
                            <span className="text-[10px] font-bold text-[#4ba3e3] uppercase tracking-widest">AI Reasoning</span>
                        </div>
                        <p className="text-xs text-[#b0b4bc] leading-relaxed font-mono">{change.reasoning}</p>
                    </div>

                    {/* Diffs */}
                    <div className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-3">
                            <GitBranch size={12} className="text-[#ffb74d]" />
                            <span className="text-[10px] font-bold text-[#ffb74d] uppercase tracking-widest">Parameter Diffs</span>
                        </div>
                        <div className="space-y-0">
                            {change.diffs.map((diff, i) => (
                                <DiffRow key={i} diff={diff} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TimelineEvent({ event, onExpand }: { event: AuditEvent; onExpand?: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const style = EVENT_ICONS[event.type] || EVENT_ICONS.TRADE;
    const isStrategyOrReview = event.type === 'STRATEGY_CHANGE' || event.type === 'WEEKLY_REVIEW';

    return (
        <div className="flex gap-3 group">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center shrink-0">
                <div className={`w-8 h-8 ${style.bgClass} border border-[#272a35] flex items-center justify-center text-sm`}>
                    {style.icon}
                </div>
                <div className="w-px h-full bg-[#272a35] min-h-[16px] group-last:bg-transparent" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-mono text-xs font-bold ${style.colorClass}`}>{event.title}</span>
                            <span className="text-[10px] px-1.5 py-0.5 bg-[#1a1c23] text-[#8a8f98] border border-[#272a35] font-mono">
                                {event.poolName}
                            </span>
                        </div>
                        <div className="text-[10px] text-[#555] font-mono mt-0.5">
                            {fmtDate(event.timestamp)} {fmtTime(event.timestamp)} · {fmtRelative(event.timestamp)}
                        </div>
                    </div>
                </div>

                {/* Description - always show for non-trade events */}
                {(isStrategyOrReview || event.type === 'ARENA_INIT' || event.type === 'POOL_PAUSE') && (
                    <p className="text-[11px] text-[#b0b4bc] leading-relaxed mt-1.5 font-mono">{event.description}</p>
                )}

                {/* Trade detail — expandable */}
                {event.type === 'TRADE' && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-[11px] text-[#8a8f98] hover:text-[#e2e4e9] font-mono mt-1 flex items-center gap-1 transition-colors"
                    >
                        {event.description}
                        {event.details?.reason && (
                            expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                        )}
                    </button>
                )}
                {expanded && event.details?.reason && (
                    <div className="mt-2 p-2 bg-[#0a0a0c] border border-[#1a1c23] text-[10px] text-[#8a8f98] font-mono leading-relaxed">
                        {event.details.reason}
                    </div>
                )}

                {/* Weekly review stats */}
                {event.type === 'WEEKLY_REVIEW' && event.details && (
                    <div className="flex gap-3 mt-2">
                        <span className={`text-[10px] font-mono font-bold ${event.details.pnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                            P&L: {event.details.pnlPct >= 0 ? '+' : ''}{event.details.pnlPct?.toFixed(1)}%
                        </span>
                        <span className="text-[10px] font-mono text-[#8a8f98]">
                            {event.details.trades} trades ({event.details.wins}W/{event.details.losses}L)
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}


// ─── Main Component ─────────────────────────────────────

interface AuditTrailProps {
    userId: string;
    onBack: () => void;
    assetClass?: import('@/lib/constants').AssetClass;
}

export default function AuditTrail({ userId, onBack, assetClass = 'CRYPTO' }: AuditTrailProps) {
    const [data, setData] = useState<AuditTrailData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<'timeline' | 'changes' | 'reviews'>('timeline');
    const [filter, setFilter] = useState<FilterType>('ALL');
    const [expandAll, setExpandAll] = useState(false);
    const [timelinePage, setTimelinePage] = useState(0);
    const TIMELINE_PAGE_SIZE = 20;

    const loadData = useCallback(async () => {
        try {
            const result = await getAuditTrail(userId, assetClass);
            setData(result);
        } catch (e) {
            console.error('[AuditTrail] Load failed:', e);
        } finally {
            setLoading(false);
        }
    }, [userId, assetClass]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadData();
        setRefreshing(false);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <div className="mc-label text-[#8a8f98]">LOADING AUDIT RECORDS...</div>
                <div className="flex gap-2">
                    <div className="w-2 h-2 bg-[#ffb74d] animate-ping" />
                    <div className="w-2 h-2 bg-[#ffb74d] animate-ping delay-75" />
                    <div className="w-2 h-2 bg-[#ffb74d] animate-ping delay-150" />
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="mc-panel p-8 text-center">
                <div className="mc-label text-[#ff6659]">AUDIT DATA UNAVAILABLE</div>
            </div>
        );
    }

    const filteredTimeline = data.timeline.filter(e => {
        if (filter === 'ALL') return true;
        return e.type === filter;
    });

    const paginatedTimeline = filteredTimeline.slice(
        timelinePage * TIMELINE_PAGE_SIZE,
        (timelinePage + 1) * TIMELINE_PAGE_SIZE
    );
    const totalTimelinePages = Math.ceil(filteredTimeline.length / TIMELINE_PAGE_SIZE);

    return (
        <div className="space-y-4 max-w-[1400px] mx-auto">

            {/* ═ HEADER BAR ═ */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-[#272a35] transition-colors text-[#8a8f98] hover:text-white"
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <div>
                        <h1 className="text-white font-bold text-lg tracking-tight flex items-center gap-2">
                            <Shield size={18} className="text-[#ffb74d]" />
                            AI AUDIT TRAIL
                        </h1>
                        <p className="text-[10px] text-[#8a8f98] font-mono uppercase tracking-widest">
                            ALL AUTONOMOUS CHANGES // STRATEGY MUTATIONS // DECISION LOG
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={`p-2 border border-[#272a35] hover:border-[#4ba3e3] transition-colors ${refreshing ? 'animate-spin text-[#4ba3e3]' : 'text-[#8a8f98]'}`}
                >
                    <RefreshCw size={14} />
                </button>
            </div>

            {/* ═ SUMMARY CARDS ═ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="mc-panel p-4">
                    <div className="mc-label mb-2 flex items-center gap-1.5">
                        <Zap size={10} className="text-[#ffb74d]" />
                        STRATEGY CHANGES
                    </div>
                    <div className="mc-value text-3xl font-bold text-[#ffb74d]">{data.totalChanges}</div>
                    <div className="text-[10px] text-[#555] font-mono mt-1">AI-initiated mutations</div>
                </div>
                <div className="mc-panel p-4">
                    <div className="mc-label mb-2 flex items-center gap-1.5">
                        <Eye size={10} className="text-[#4ba3e3]" />
                        AI REVIEWS
                    </div>
                    <div className="mc-value text-3xl font-bold text-[#4ba3e3]">{data.totalReviews}</div>
                    <div className="text-[10px] text-[#555] font-mono mt-1">Strategy evaluations</div>
                </div>
                <div className="mc-panel p-4">
                    <div className="mc-label mb-2 flex items-center gap-1.5">
                        <Clock size={10} className="text-[#4caf50]" />
                        TOTAL EVENTS
                    </div>
                    <div className="mc-value text-3xl font-bold text-white">{data.timeline.length}</div>
                    <div className="text-[10px] text-[#555] font-mono mt-1">Including trades</div>
                </div>
                <div className="mc-panel p-4">
                    <div className="mc-label mb-2 flex items-center gap-1.5">
                        <AlertTriangle size={10} className="text-[#8a8f98]" />
                        ACTIVE POOLS
                    </div>
                    <div className="mc-value text-3xl font-bold text-white">{data.poolSummaries.length}</div>
                    <div className="text-[10px] text-[#555] font-mono mt-1">Being monitored</div>
                </div>
            </div>

            {/* ═ POOL AUDIT SUMMARY ═ */}
            <div className="mc-label flex items-center gap-3 pt-2">
                <span>PER-POOL AUDIT SUMMARY</span>
                <div className="h-px bg-[#272a35] flex-1" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.poolSummaries.map(pool => {
                    const poolColor = POOL_COLORS[pool.poolId] || '#272a35';
                    return (
                        <div key={pool.poolId} className="mc-panel overflow-hidden">
                            <div className="h-1" style={{ backgroundColor: poolColor }} />
                            <div className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-sm">{pool.poolEmoji}</span>
                                    <span className="font-mono text-xs text-white font-bold truncate">{pool.poolName}</span>
                                </div>
                                <table className="w-full text-left font-mono text-[10px]">
                                    <tbody>
                                        <tr className="border-b border-[#1a1c23]">
                                            <td className="py-1.5 text-[#8a8f98]">Strategy Changes</td>
                                            <td className="py-1.5 text-right text-[#ffb74d] font-bold">{pool.totalStrategyChanges}</td>
                                        </tr>
                                        <tr className="border-b border-[#1a1c23]">
                                            <td className="py-1.5 text-[#8a8f98]">AI Reviews</td>
                                            <td className="py-1.5 text-right text-[#4ba3e3] font-bold">{pool.totalReviews}</td>
                                        </tr>
                                        <tr className="border-b border-[#1a1c23]">
                                            <td className="py-1.5 text-[#8a8f98]">Total Trades</td>
                                            <td className="py-1.5 text-right text-white font-bold">{pool.totalTrades}</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1.5 text-[#8a8f98]">Personality</td>
                                            <td className="py-1.5 text-right">
                                                <span className={`px-1.5 py-0.5 text-[9px] font-bold tracking-wider border
                                                    ${pool.currentPersonality === 'AGGRESSIVE' ? 'bg-[#3d0a0a] text-[#ff6659] border-[#d32f2f]' :
                                                        pool.currentPersonality === 'PATIENT' ? 'bg-[#0a3d0a] text-[#4caf50] border-[#2e7d32]' :
                                                            'bg-[#0a2540] text-[#4ba3e3] border-[#0b5394]'}`}>
                                                    {pool.currentPersonality}
                                                </span>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ═ TAB NAVIGATION ═ */}
            <div className="flex items-center gap-0 border-b border-[#272a35] mt-4">
                {[
                    { key: 'timeline', label: 'EVENT TIMELINE', count: data.timeline.length },
                    { key: 'changes', label: 'STRATEGY CHANGES', count: data.totalChanges },
                    { key: 'reviews', label: 'AI REVIEWS', count: data.totalReviews },
                ].map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => { setActiveTab(tab.key as typeof activeTab); setTimelinePage(0); }}
                        className={`px-4 py-3 font-mono text-[10px] tracking-widest font-bold transition-colors border-b-2 ${activeTab === tab.key
                            ? 'text-white border-[#4ba3e3]'
                            : 'text-[#8a8f98] border-transparent hover:text-[#e2e4e9] hover:border-[#272a35]'
                            }`}
                    >
                        {tab.label}
                        <span className="ml-2 px-1.5 py-0.5 bg-[#1a1c23] text-[#8a8f98] text-[9px]">{tab.count}</span>
                    </button>
                ))}
            </div>

            {/* ═ TAB CONTENT ═ */}

            {/* Timeline Tab */}
            {activeTab === 'timeline' && (
                <div className="mc-panel">
                    {/* Filter bar */}
                    <div className="mc-panel-header">
                        <div className="flex items-center gap-2">
                            <Filter size={10} />
                            <span>EVENT FEED</span>
                        </div>
                        <div className="flex gap-1">
                            {[
                                { key: 'ALL', label: 'ALL' },
                                { key: 'STRATEGY_CHANGE', label: 'CHANGES' },
                                { key: 'WEEKLY_REVIEW', label: 'REVIEWS' },
                                { key: 'TRADE', label: 'TRADES' },
                            ].map(f => (
                                <button
                                    key={f.key}
                                    onClick={() => { setFilter(f.key as FilterType); setTimelinePage(0); }}
                                    className={`px-2 py-0.5 text-[9px] font-bold tracking-wider transition-colors border ${filter === f.key
                                        ? 'bg-[#0b5394] text-white border-[#4ba3e3]'
                                        : 'bg-transparent text-[#8a8f98] border-[#272a35] hover:border-[#3f4455]'
                                        }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="p-4">
                        {paginatedTimeline.length === 0 ? (
                            <div className="text-center py-8 text-[#8a8f98] font-mono text-sm">
                                NO EVENTS MATCH CURRENT FILTER
                            </div>
                        ) : (
                            <div className="space-y-0">
                                {paginatedTimeline.map(event => (
                                    <TimelineEvent key={event.id} event={event} />
                                ))}
                            </div>
                        )}

                        {/* Pagination */}
                        {totalTimelinePages > 1 && (
                            <div className="flex items-center justify-between pt-4 border-t border-[#272a35] mt-4">
                                <button
                                    onClick={() => setTimelinePage(p => Math.max(0, p - 1))}
                                    disabled={timelinePage === 0}
                                    className="px-3 py-1.5 font-mono text-xs tracking-wider border border-[#272a35] text-[#8a8f98] hover:text-white hover:border-[#4ba3e3] transition-colors disabled:opacity-30"
                                >
                                    ◄ PREV
                                </button>
                                <span className="font-mono text-xs text-[#8a8f98]">
                                    PAGE {timelinePage + 1} / {totalTimelinePages}
                                </span>
                                <button
                                    onClick={() => setTimelinePage(p => Math.min(totalTimelinePages - 1, p + 1))}
                                    disabled={timelinePage >= totalTimelinePages - 1}
                                    className="px-3 py-1.5 font-mono text-xs tracking-wider border border-[#272a35] text-[#8a8f98] hover:text-white hover:border-[#4ba3e3] transition-colors disabled:opacity-30"
                                >
                                    NEXT ►
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Strategy Changes Tab */}
            {activeTab === 'changes' && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] text-[#8a8f98] font-mono">
                            {data.strategyChanges.length} STRATEGY MUTATION{data.strategyChanges.length !== 1 ? 'S' : ''} RECORDED
                        </span>
                        <button
                            onClick={() => setExpandAll(!expandAll)}
                            className="px-3 py-1 text-[10px] font-mono text-[#8a8f98] hover:text-white border border-[#272a35] hover:border-[#4ba3e3] transition-colors tracking-wider"
                        >
                            {expandAll ? 'COLLAPSE ALL' : 'EXPAND ALL'}
                        </button>
                    </div>

                    {data.strategyChanges.length === 0 ? (
                        <div className="mc-panel p-8 text-center">
                            <div className="text-[#8a8f98] font-mono text-sm">NO AI STRATEGY CHANGES RECORDED YET</div>
                            <p className="text-[10px] text-[#555] mt-2 font-mono">
                                Strategy changes are triggered by: 5+ trades, 3%+ P&L drop, or weekly boundary
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {data.strategyChanges.map((change, i) => (
                                <StrategyChangeCard key={i} change={change} defaultExpanded={expandAll} />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Weekly Reviews Tab */}
            {activeTab === 'reviews' && (
                <div>
                    <span className="text-[10px] text-[#8a8f98] font-mono block mb-3">
                        {data.weeklyReviews.length} AI REVIEW{data.weeklyReviews.length !== 1 ? 'S' : ''} CONDUCTED
                    </span>

                    {data.weeklyReviews.length === 0 ? (
                        <div className="mc-panel p-8 text-center">
                            <div className="text-[#8a8f98] font-mono text-sm">NO AI REVIEWS CONDUCTED YET</div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {data.weeklyReviews.map((review, i) => {
                                const poolColor = POOL_COLORS[review.poolId] || '#272a35';
                                return (
                                    <div key={i} className="mc-panel overflow-hidden">
                                        <div className="h-1" style={{ backgroundColor: poolColor }} />
                                        <div className="p-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm">{review.poolEmoji}</span>
                                                    <span className="font-mono text-xs text-white font-bold">{review.poolName}</span>
                                                    <span className={`px-1.5 py-0.5 text-[9px] font-bold tracking-wider border ${review.strategyChanged
                                                        ? 'bg-[#3d2a00] text-[#ffb74d] border-[#f57c00]/30'
                                                        : 'bg-[#1a1c23] text-[#8a8f98] border-[#272a35]'
                                                        }`}>
                                                        {review.strategyChanged ? 'STRATEGY CHANGED' : 'NO CHANGE'}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] text-[#555] font-mono">{fmtRelative(review.timestamp)}</span>
                                            </div>

                                            {/* Stats row */}
                                            <div className="flex items-center gap-4 mb-3 flex-wrap">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-[#8a8f98] font-mono">P&L:</span>
                                                    <span className={`text-xs font-mono font-bold ${review.pnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                                        {review.pnlPct >= 0 ? '+' : ''}{review.pnlPct.toFixed(1)}%
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-[#8a8f98] font-mono">Trades:</span>
                                                    <span className="text-xs font-mono text-white">{review.trades}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-[#8a8f98] font-mono">W/L:</span>
                                                    <span className="text-xs font-mono">
                                                        <span className="text-[#4caf50]">{review.wins}</span>
                                                        <span className="text-[#8a8f98]">/</span>
                                                        <span className="text-[#ff6659]">{review.losses}</span>
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-[#8a8f98] font-mono">Date:</span>
                                                    <span className="text-[10px] font-mono text-[#555]">{fmtDate(review.timestamp)} {fmtTime(review.timestamp)}</span>
                                                </div>
                                            </div>

                                            {/* AI Reflection */}
                                            <div className="bg-[#0a0a0c] border border-[#1a1c23] p-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Eye size={10} className="text-[#4ba3e3]" />
                                                    <span className="text-[9px] font-bold text-[#4ba3e3] uppercase tracking-widest">AI Reflection</span>
                                                </div>
                                                <p className="text-xs text-[#b0b4bc] leading-relaxed font-mono">{review.aiReflection}</p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
