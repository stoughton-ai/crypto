"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Zap, RefreshCw, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Newspaper, BarChart3, DollarSign, Globe } from "lucide-react";
import { getIntelligenceScanResults, triggerIntelligenceScan } from "@/app/actions";
import { getCurrencySymbol } from "@/lib/constants";
import type { AssetClass, PoolId, IntelligenceScanResult, ScanCandidate, PoolPromotionEvent } from "@/lib/constants";

interface IntelligenceScannerProps {
    userId: string;
    assetClass: AssetClass;
    onScanComplete?: () => void;
}

function ScorePill({ score, max, label, color }: { score: number; max: number; label: string; color: string }) {
    const pct = (score / max) * 100;
    return (
        <div className="flex flex-col items-center gap-0.5" title={`${label}: ${score}/${max}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border"
                style={{ borderColor: color, color, background: `${color}10` }}>
                {score}
            </div>
            <span className="text-[7px] font-mono uppercase text-[#8a8f98] tracking-wider">{label}</span>
        </div>
    );
}

function CandidateRow({ candidate, rank, isConfirmed, currencySymbol }: { candidate: ScanCandidate; rank: number; isConfirmed: boolean; currencySymbol: string }) {
    const [expanded, setExpanded] = useState(false);
    const scoreColor = candidate.compositeScore >= 70 ? '#4caf50' : candidate.compositeScore >= 55 ? '#ffb74d' : '#ff6659';

    return (
        <div className={`border-b border-[#272a35] last:border-b-0 ${isConfirmed ? 'bg-[#4caf50]/5 border-l-2 border-l-[#4caf50]' : ''}`}>
            <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#161b22] transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                {/* Rank badge */}
                <span className={`w-5 h-5 flex items-center justify-center font-mono text-[9px] font-bold rounded ${rank <= 3 ? 'bg-[#ffb74d]/20 text-[#ffb74d]' : 'bg-[#272a35] text-[#8a8f98]'}`}>
                    {rank}
                </span>

                {/* Ticker + name */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-white">{candidate.ticker}</span>
                        {isConfirmed && (
                            <span className="px-1.5 py-0.5 bg-[#4caf50]/20 text-[#4caf50] text-[7px] font-bold font-mono tracking-widest">
                                CONFIRMED
                            </span>
                        )}
                    </div>
                    {candidate.displayName !== candidate.ticker && (
                        <div className="text-[9px] text-[#8a8f98] truncate">{candidate.displayName}</div>
                    )}
                </div>

                {/* Price + change */}
                <div className="text-right mr-2">
                    <div className="font-mono text-[10px] text-white">{currencySymbol}{candidate.price.toFixed(2)}</div>
                    <div className={`font-mono text-[9px] font-bold flex items-center justify-end gap-0.5 ${candidate.change24h >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                        {candidate.change24h >= 0.5 ? <TrendingUp size={8} /> : candidate.change24h <= -0.5 ? <TrendingDown size={8} /> : <Minus size={8} />}
                        {candidate.change24h >= 0 ? '+' : ''}{candidate.change24h.toFixed(2)}%
                    </div>
                </div>

                {/* Composite score */}
                <div className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-xs font-bold border-2"
                    style={{ borderColor: scoreColor, color: scoreColor }}>
                    {candidate.compositeScore}
                </div>

                {/* Expand toggle */}
                {expanded ? <ChevronUp size={12} className="text-[#8a8f98]" /> : <ChevronDown size={12} className="text-[#8a8f98]" />}
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div className="px-3 pb-3 space-y-2 bg-[#0a0a0c]/50">
                    {/* Score breakdown */}
                    <div className="flex items-center gap-3 py-2">
                        <ScorePill score={candidate.newsCatalystScore} max={25} label="NEWS" color="#e91e63" />
                        <ScorePill score={candidate.technicalScore} max={25} label="TECH" color="#4ba3e3" />
                        <ScorePill score={candidate.valueScore} max={25} label="VALUE" color="#4caf50" />
                        <ScorePill score={candidate.macroScore} max={25} label="MACRO" color="#ffb74d" />
                        <div className="h-6 w-px bg-[#272a35]" />
                        <div className="text-center">
                            <div className="font-mono text-lg font-bold" style={{ color: scoreColor }}>
                                {candidate.compositeScore}
                            </div>
                            <div className="text-[7px] text-[#8a8f98] font-mono">TOTAL</div>
                        </div>
                    </div>

                    {/* Headlines */}
                    {candidate.newsHeadlines.length > 0 && (
                        <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[9px] text-[#e91e63] font-mono font-bold">
                                <Newspaper size={9} />NEWS
                            </div>
                            {candidate.newsHeadlines.map((h, i) => (
                                <div key={i} className="text-[10px] text-[#b0b4bc] pl-3 leading-normal truncate">
                                    • {h}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* AI Summary */}
                    {candidate.aiSummary && (
                        <div className="text-[10px] text-[#e2e4e9] leading-relaxed p-2 bg-[#121318] border border-[#272a35]">
                            {candidate.aiSummary}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function PromotionBadge({ promo }: { promo: PoolPromotionEvent }) {
    return (
        <div className="flex items-center gap-2 text-[10px] font-mono py-1.5 px-2 bg-[#4caf50]/5 border border-[#4caf50]/20">
            <Zap size={10} className="text-[#4caf50]" />
            <span className="text-[#8a8f98] line-through">{promo.outTicker || '—'}</span>
            <span className="text-[#8a8f98]">→</span>
            <span className="font-bold text-[#4caf50]">{promo.inTicker}</span>
            <span className="text-[#8a8f98] ml-auto">
                AM:{promo.morningScore} PM:{promo.eveningScore}
            </span>
            <span className="text-[#8a8f98]">
                {new Date(promo.promotedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })}
            </span>
        </div>
    );
}

export default function IntelligenceScanner({ userId, assetClass, onScanComplete }: IntelligenceScannerProps) {
    const [data, setData] = useState<{
        pools: Array<{
            poolId: PoolId;
            poolName: string;
            emoji: string;
            morningScan: IntelligenceScanResult | null;
            eveningScan: IntelligenceScanResult | null;
            promotions: PoolPromotionEvent[];
        }>;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [expandedPool, setExpandedPool] = useState<string | null>(null);
    const [scanMessage, setScanMessage] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        if (!userId) return; // Wait for auth
        try {
            const result = await getIntelligenceScanResults(userId, assetClass);
            setData(result);
        } catch (e: any) {
            console.error('[IntelScanner UI]', e.message);
        } finally {
            setLoading(false);
        }
    }, [userId, assetClass]);

    useEffect(() => { if (userId) loadData(); }, [loadData, userId]);

    // No scanner for crypto
    if (assetClass === 'CRYPTO') return null;

    const handleManualScan = async (scanType: 'MORNING' | 'EVENING') => {
        if (scanning) return;
        setScanning(true);
        setScanMessage(null);
        try {
            const result = await triggerIntelligenceScan(userId, assetClass, scanType);
            setScanMessage(result.message);
            await loadData();
            onScanComplete?.();
        } catch (e: any) {
            setScanMessage(`Error: ${e.message}`);
        } finally {
            setScanning(false);
        }
    };

    const hasAnyScan = data?.pools.some(p => p.morningScan || p.eveningScan);
    const hasAnyPromos = data?.pools.some(p => p.promotions.length > 0);

    return (
        <div className="mc-panel border-l-4 border-l-[#e91e63]">
            {/* Header */}
            <div className="mc-panel-header">
                <div className="flex items-center gap-2">
                    <Zap size={14} className="text-[#e91e63]" />
                    <span className="text-[#e91e63] tracking-widest">INTELLIGENCE SCANNER</span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Manual scan buttons */}
                    <button
                        onClick={() => handleManualScan('MORNING')}
                        disabled={scanning}
                        className="px-2 py-1 border border-[#e91e63]/40 text-[#e91e63] hover:bg-[#e91e63]/10 font-mono text-[9px] font-bold tracking-widest transition-colors disabled:opacity-50"
                    >
                        {scanning ? '⏳' : '☀️'} AM SCAN
                    </button>
                    <button
                        onClick={() => handleManualScan('EVENING')}
                        disabled={scanning}
                        className="px-2 py-1 border border-[#e91e63]/40 text-[#e91e63] hover:bg-[#e91e63]/10 font-mono text-[9px] font-bold tracking-widest transition-colors disabled:opacity-50"
                    >
                        {scanning ? '⏳' : '🌙'} PM SCAN
                    </button>
                </div>
            </div>

            <div className="p-4">
                {/* Status message */}
                {scanMessage && (
                    <div className="mb-3 px-3 py-2 bg-[#e91e63]/10 border border-[#e91e63]/30 font-mono text-[10px] text-[#e91e63]">
                        {scanMessage}
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center gap-2 justify-center py-6">
                        <RefreshCw size={12} className="animate-spin text-[#e91e63]" />
                        <span className="font-mono text-[10px] text-[#8a8f98]">Loading scanner data...</span>
                    </div>
                ) : !hasAnyScan ? (
                    <div className="text-center py-6">
                        <div className="font-mono text-xs text-[#8a8f98] mb-2">No scans have been run yet.</div>
                        <div className="font-mono text-[10px] text-[#555]">
                            Click <b>AM SCAN</b> or <b>PM SCAN</b> to manually trigger, or wait for the automated cron schedule.
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Summary strip */}
                        <div className="flex items-center gap-4 flex-wrap">
                            {data?.pools.map(pool => {
                                const latestScan = pool.eveningScan || pool.morningScan;
                                const topScore = latestScan?.topCandidates[0]?.compositeScore ?? 0;
                                const confirmed = latestScan?.confirmed;
                                return (
                                    <button
                                        key={pool.poolId}
                                        onClick={() => setExpandedPool(expandedPool === pool.poolId ? null : pool.poolId)}
                                        className={`flex items-center gap-2 px-3 py-1.5 border transition-colors ${expandedPool === pool.poolId
                                            ? 'border-[#e91e63] bg-[#e91e63]/10'
                                            : 'border-[#272a35] hover:border-[#e91e63]/40'
                                            }`}
                                    >
                                        <span className="text-sm">{pool.emoji}</span>
                                        <span className="font-mono text-[10px] text-white font-bold">{pool.poolName}</span>
                                        {confirmed && <span className="w-1.5 h-1.5 bg-[#4caf50] rounded-full animate-pulse" />}
                                        <span className="font-mono text-[9px] text-[#8a8f98]">
                                            Top: {topScore}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Expanded pool detail */}
                        {expandedPool && (() => {
                            const poolData = data?.pools.find(p => p.poolId === expandedPool);
                            if (!poolData) return null;

                            const latestScan = poolData.eveningScan || poolData.morningScan;
                            const scanAge = latestScan
                                ? Math.round((Date.now() - new Date(latestScan.scanTimestamp).getTime()) / (1000 * 60))
                                : null;

                            return (
                                <div className="border border-[#272a35] bg-[#0d0d10]">
                                    {/* Scan info bar */}
                                    <div className="flex items-center gap-3 px-3 py-2 bg-[#0a0a0c] border-b border-[#272a35]">
                                        <span className="text-sm">{poolData.emoji}</span>
                                        <span className="font-mono text-xs font-bold text-white">{poolData.poolName}</span>
                                        <div className="flex items-center gap-3 ml-auto text-[9px] font-mono text-[#8a8f98]">
                                            {poolData.morningScan && (
                                                <span className="flex items-center gap-1">
                                                    ☀️ AM
                                                    <span className="text-[#4ba3e3]">
                                                        {new Date(poolData.morningScan.scanTimestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            )}
                                            {poolData.eveningScan && (
                                                <span className="flex items-center gap-1">
                                                    🌙 PM
                                                    <span className="text-[#e91e63]">
                                                        {new Date(poolData.eveningScan.scanTimestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            )}
                                            {scanAge !== null && <span>{scanAge}m ago</span>}
                                            <span>Universe: {latestScan?.universeSize ?? 0}</span>
                                        </div>
                                    </div>

                                    {/* Top 10 candidates */}
                                    {latestScan && latestScan.topCandidates.length > 0 && (
                                        <div>
                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#121318] border-b border-[#272a35]">
                                                <BarChart3 size={10} className="text-[#e91e63]" />
                                                <span className="font-mono text-[9px] font-bold text-[#e91e63] tracking-widest">
                                                    TOP {latestScan.topCandidates.length} CANDIDATES ({latestScan.scanType})
                                                </span>
                                            </div>
                                            {latestScan.topCandidates.map((candidate, idx) => (
                                                <CandidateRow
                                                    key={candidate.ticker}
                                                    candidate={candidate}
                                                    rank={idx + 1}
                                                    isConfirmed={latestScan.promotionCandidates?.includes(candidate.ticker) || false}
                                                    currencySymbol={getCurrencySymbol(assetClass)}
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {/* Recent promotions */}
                                    {poolData.promotions.length > 0 && (
                                        <div className="border-t border-[#272a35]">
                                            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#121318] border-b border-[#272a35]">
                                                <Zap size={10} className="text-[#4caf50]" />
                                                <span className="font-mono text-[9px] font-bold text-[#4caf50] tracking-widest">
                                                    RECENT PROMOTIONS
                                                </span>
                                            </div>
                                            {poolData.promotions.map((promo, idx) => (
                                                <PromotionBadge key={idx} promo={promo} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
}
