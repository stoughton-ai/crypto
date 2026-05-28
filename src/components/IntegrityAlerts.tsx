"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ShieldAlert, ShieldCheck, X, ChevronDown, ChevronRight, RefreshCw, History, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { getActiveIntegrityAlerts, getAllIntegrityAlerts, dismissAllIntegrityAlerts, type IntegrityAlert } from "@/app/actions";
import type { AssetClass } from "@/lib/constants";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function fmtDateTime(ts: string) {
    const d = new Date(ts);
    return d.toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

const SEVERITY_CONFIG = {
    CRITICAL: {
        icon: AlertCircle,
        borderColor: 'border-l-[#ff6659]',
        bgColor: 'bg-[#3d0a0a]/40',
        textColor: 'text-[#ff6659]',
        badgeBg: 'bg-[#3d0a0a]',
        badgeBorder: 'border-[#d32f2f]',
        label: 'CRITICAL',
        pulseClass: 'animate-pulse',
    },
    WARNING: {
        icon: AlertTriangle,
        borderColor: 'border-l-[#ffb74d]',
        bgColor: 'bg-[#3d2a00]/40',
        textColor: 'text-[#ffb74d]',
        badgeBg: 'bg-[#3d2a00]',
        badgeBorder: 'border-[#f57c00]',
        label: 'WARNING',
        pulseClass: '',
    },
    INFO: {
        icon: Info,
        borderColor: 'border-l-[#4ba3e3]',
        bgColor: 'bg-[#0a2540]/40',
        textColor: 'text-[#4ba3e3]',
        badgeBg: 'bg-[#0a2540]',
        badgeBorder: 'border-[#0b5394]',
        label: 'INFO',
        pulseClass: '',
    },
};

// ─── Alert Card ──────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: IntegrityAlert }) {
    const [expanded, setExpanded] = useState(false);
    const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.INFO;
    const Icon = config.icon;

    return (
        <div className={`border border-[#272a35] ${config.borderColor} border-l-4 ${config.bgColor} overflow-hidden transition-all`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-start gap-3 p-4 hover:bg-white/5 transition-colors text-left"
            >
                <Icon size={16} className={`${config.textColor} mt-0.5 shrink-0 ${config.pulseClass}`} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`font-mono text-xs font-bold ${config.textColor}`}>{alert.title}</span>
                        <span className={`px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border ${config.badgeBg} ${config.textColor} ${config.badgeBorder}`}>
                            {config.label}
                        </span>
                        {alert.autoFixed && (
                            <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border bg-[#0a3d0a] text-[#4caf50] border-[#2e7d32]">
                                AUTO-FIXED
                            </span>
                        )}
                        {alert.dismissed && (
                            <span className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border bg-[#1a1c23] text-[#555] border-[#272a35]">
                                DISMISSED
                            </span>
                        )}
                    </div>
                    <div className="text-[10px] text-[#555] font-mono">
                        {fmtDateTime(alert.detectedAt)} · {fmtRelative(alert.detectedAt)}
                    </div>
                </div>
                {expanded ? <ChevronDown size={14} className="text-[#8a8f98] shrink-0 mt-0.5" /> : <ChevronRight size={14} className="text-[#8a8f98] shrink-0 mt-0.5" />}
            </button>

            {expanded && (
                <div className="border-t border-[#272a35]">
                    {/* Description */}
                    <div className="px-4 py-3 bg-[#0a0a0c]/50 border-b border-[#1a1c23]">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldAlert size={10} className={config.textColor} />
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${config.textColor}`}>Detection Details</span>
                        </div>
                        <p className="text-xs text-[#b0b4bc] leading-relaxed font-mono">{alert.description}</p>
                    </div>

                    {/* Fix details */}
                    {alert.autoFixed && alert.fixDescription && (
                        <div className="px-4 py-3 bg-[#0a3d0a]/10 border-b border-[#1a1c23]">
                            <div className="flex items-center gap-2 mb-2">
                                <ShieldCheck size={10} className="text-[#4caf50]" />
                                <span className="text-[9px] font-bold uppercase tracking-widest text-[#4caf50]">Auto-Fix Applied</span>
                            </div>
                            <p className="text-xs text-[#a5d6a7] leading-relaxed font-mono">{alert.fixDescription}</p>
                        </div>
                    )}

                    {/* Before/After */}
                    {(alert.previousValue || alert.correctedValue) && (
                        <div className="px-4 py-3 flex gap-6">
                            {alert.previousValue && (
                                <div>
                                    <div className="text-[9px] text-[#8a8f98] font-mono mb-1 uppercase">Before</div>
                                    <div className="text-xs text-[#ff6659] font-mono font-bold line-through opacity-70">{alert.previousValue}</div>
                                </div>
                            )}
                            {alert.correctedValue && (
                                <div>
                                    <div className="text-[9px] text-[#8a8f98] font-mono mb-1 uppercase">After</div>
                                    <div className="text-xs text-[#4caf50] font-mono font-bold">{alert.correctedValue}</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}


// ─── Main Component ──────────────────────────────────────────────────────────

interface IntegrityAlertsProps {
    userId: string;
    assetClass?: AssetClass;
    showAlert: (title: string, message: string, type: 'info' | 'success' | 'error') => void;
    showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function IntegrityAlerts({ userId, assetClass = 'CRYPTO', showAlert, showConfirm }: IntegrityAlertsProps) {
    const [alerts, setAlerts] = useState<IntegrityAlert[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [allAlerts, setAllAlerts] = useState<IntegrityAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [dismissing, setDismissing] = useState(false);

    const loadAlerts = useCallback(async () => {
        try {
            const active = await getActiveIntegrityAlerts(userId, assetClass);
            setAlerts(active);
        } catch (e) {
            console.error('[IntegrityAlerts] Load failed:', e);
        } finally {
            setLoading(false);
        }
    }, [userId, assetClass]);

    const loadHistory = useCallback(async () => {
        try {
            const all = await getAllIntegrityAlerts(userId, assetClass);
            setAllAlerts(all);
        } catch (e) {
            console.error('[IntegrityAlerts] History load failed:', e);
        }
    }, [userId, assetClass]);

    useEffect(() => { loadAlerts(); }, [loadAlerts]);

    const handleDismissAll = async () => {
        showConfirm(
            "DISMISS SYSTEM ALERTS",
            "Are you sure you want to dismiss all active integrity alerts? Records will be preserved in the audit history.",
            async () => {
                setDismissing(true);
                try {
                    const result = await dismissAllIntegrityAlerts(userId, assetClass);
                    if (result.dismissed > 0) {
                        await loadAlerts();
                        showAlert("System Update", `${result.dismissed} alerts successfully archived.`, "success");
                    }
                } catch (e: any) {
                    showAlert("System Error", e.message, "error");
                } finally {
                    setDismissing(false);
                }
            }
        );
    };

    const handleShowHistory = async () => {
        if (!showHistory) {
            await loadHistory();
        }
        setShowHistory(!showHistory);
    };

    const displayAlerts = showHistory ? allAlerts : alerts;

    // No active alerts — show clean status
    if (!loading && alerts.length === 0 && !showHistory) {
        return (
            <div className="mc-panel border-l-4 border-l-[#2e7d32] p-4">
                <div className="flex items-center gap-3">
                    <ShieldCheck size={18} className="text-[#4caf50]" />
                    <div className="flex-1">
                        <span className="mc-label text-[#4caf50] tracking-widest">INTEGRITY AGENT // ALL CLEAR</span>
                        <div className="text-[10px] text-[#555] font-mono mt-0.5">No active issues — all automated checks passing</div>
                    </div>
                    <button
                        onClick={handleShowHistory}
                        className="flex items-center gap-1.5 px-2 py-1 border border-[#272a35] hover:border-[#4ba3e3] text-[#8a8f98] hover:text-[#4ba3e3] transition-colors"
                        title="View full alert history"
                    >
                        <History size={10} />
                        <span className="font-mono text-[9px] font-bold tracking-widest">HISTORY</span>
                    </button>
                </div>
            </div>
        );
    }

    const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
    const warningCount = alerts.filter(a => a.severity === 'WARNING').length;
    const headerColor = criticalCount > 0 ? '#ff6659' : warningCount > 0 ? '#ffb74d' : '#4caf50';

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="mc-panel border-l-4 p-4" style={{ borderLeftColor: headerColor }}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <ShieldAlert size={18} style={{ color: headerColor }} className={criticalCount > 0 ? 'animate-pulse' : ''} />
                        <div>
                            <span className="mc-label tracking-widest" style={{ color: headerColor }}>
                                INTEGRITY AGENT // {showHistory ? 'FULL HISTORY' : `${alerts.length} ACTIVE ALERT${alerts.length !== 1 ? 'S' : ''}`}
                            </span>
                            <div className="text-[10px] text-[#555] font-mono mt-0.5">
                                {showHistory
                                    ? `${allAlerts.length} total alerts (${allAlerts.filter(a => !a.dismissed).length} active, ${allAlerts.filter(a => a.dismissed).length} dismissed)`
                                    : 'AI-detected anomalies with automated corrections'
                                }
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Severity breakdown badges */}
                        {!showHistory && (
                            <>
                                {criticalCount > 0 && (
                                    <span className="px-2 py-0.5 text-[9px] font-bold bg-[#3d0a0a] text-[#ff6659] border border-[#d32f2f] animate-pulse">
                                        {criticalCount} CRITICAL
                                    </span>
                                )}
                                {warningCount > 0 && (
                                    <span className="px-2 py-0.5 text-[9px] font-bold bg-[#3d2a00] text-[#ffb74d] border border-[#f57c00]">
                                        {warningCount} WARNING
                                    </span>
                                )}
                            </>
                        )}
                        <button
                            onClick={handleShowHistory}
                            className={`flex items-center gap-1.5 px-2 py-1 border transition-colors ${showHistory
                                ? 'border-[#4ba3e3] text-[#4ba3e3] bg-[#0a2540]/30'
                                : 'border-[#272a35] hover:border-[#4ba3e3] text-[#8a8f98] hover:text-[#4ba3e3]'
                                }`}
                            title={showHistory ? 'Show active only' : 'View full history'}
                        >
                            <History size={10} />
                            <span className="font-mono text-[9px] font-bold tracking-widest">
                                {showHistory ? 'ACTIVE' : 'HISTORY'}
                            </span>
                        </button>
                        {alerts.length > 0 && !showHistory && (
                            <button
                                onClick={handleDismissAll}
                                disabled={dismissing}
                                className="flex items-center gap-1.5 px-2 py-1 border border-[#272a35] hover:border-[#4caf50] text-[#8a8f98] hover:text-[#4caf50] transition-colors disabled:opacity-50"
                                title="Dismiss all active alerts (records preserved)"
                            >
                                <X size={10} />
                                <span className="font-mono text-[9px] font-bold tracking-widest">
                                    {dismissing ? 'DISMISSING...' : 'DISMISS ALL'}
                                </span>
                            </button>
                        )}
                        <button
                            onClick={async () => { setLoading(true); await loadAlerts(); setLoading(false); }}
                            className={`p-1.5 hover:bg-[#272a35] ${loading ? 'animate-spin text-[#4ba3e3]' : 'text-[#8a8f98]'}`}
                        >
                            <RefreshCw size={12} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Alert Cards */}
            {loading ? (
                <div className="flex items-center justify-center py-6 gap-2">
                    <div className="w-2 h-2 bg-[#ffb74d] animate-ping" />
                    <div className="w-2 h-2 bg-[#ffb74d] animate-ping delay-75" />
                    <span className="mc-label text-[#8a8f98]">SCANNING...</span>
                </div>
            ) : displayAlerts.length === 0 ? (
                <div className="mc-panel p-6 text-center">
                    <div className="text-[#8a8f98] font-mono text-sm">NO ALERTS IN HISTORY</div>
                </div>
            ) : (
                <div className="space-y-2">
                    {displayAlerts.map(alert => (
                        <AlertCard key={alert.id} alert={alert} />
                    ))}
                </div>
            )}
        </div>
    );
}
