"use client";

import { useState, useEffect } from "react";
import { type AgentConfig, getAgentConfig } from "@/services/agentConfigService";
import { fetchLibrary } from "@/services/libraryService";
// manualAgentCheck removed
import { Settings, Play, CheckCircle, Clock, AlertTriangle, Activity, Database, TrendingUp, Plus, X, Loader } from "lucide-react";
import AgentConfigModal from "./AgentConfigModal";

interface AgentDashboardProps {
    userId: string;
    onModalAlert?: (title: string, message: string) => void;
    onModalConfirm?: (title: string, message: string, onConfirm: (val?: string) => void, isDanger?: boolean) => void;
}

export default function AgentDashboard({ userId, onModalAlert, onModalConfirm }: AgentDashboardProps) {
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [latestReports, setLatestReports] = useState<Record<string, any>>({});
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState("");
    const [progressLog, setProgressLog] = useState<string[]>([]);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [showProgressModal, setShowProgressModal] = useState(false);
    const [lastRunTime, setLastRunTime] = useState<string | null>(null);

    useEffect(() => {
        if (userId) {
            loadData();
        }
    }, [userId]);

    const loadData = async () => {
        try {
            console.log("Dashboard Loading Data for:", userId);
            const [conf, reports] = await Promise.all([
                getAgentConfig(userId),
                fetchLibrary(userId)
            ]);
            console.log("Dashboard Config:", conf);
            console.log("Dashboard Library Size:", reports.length);
            setConfig(conf);

            // Map latest report per ticker
            const latestMap: Record<string, any> = {};
            reports.forEach((r: any) => {
                const t = r.ticker.toUpperCase();
                const rTime = new Date(r.createdAt?.toDate?.() || r.savedAt).getTime();
                const existingTime = latestMap[t] ? new Date(latestMap[t].createdAt?.toDate?.() || latestMap[t].savedAt).getTime() : 0;

                if (!latestMap[t] || (!isNaN(rTime) && rTime > existingTime)) {
                    latestMap[t] = r;
                }
            });
            console.log("Dashboard Latest Map:", Object.keys(latestMap));
            setLatestReports(latestMap);
        } catch (e) {
            console.error("Dashboard Load Error", e);
        }
    };

    const handleRunAnalysis = async () => {
        if (isRunning) return;
        setIsRunning(true);
        setShowProgressModal(true);
        setProgress("Initializing AI Agent...");
        setProgressLog(["Initializing connection..."]);

        try {
            const response = await fetch('/api/agent/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId }),
            });

            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let done = false;

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                const chunkValue = decoder.decode(value);

                const lines = chunkValue.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    setProgress(line);
                    setProgressLog(prev => [...prev, line]);
                }
            }

            setLastRunTime(new Date().toLocaleTimeString());

            // Give Firestore a moment to propagate server-side changes to client
            setProgress("Syncing results...");
            await new Promise(r => setTimeout(r, 2000));
            await loadData();

        } catch (e: any) {
            setProgress(`Error: ${e.message}`);
            setProgressLog(prev => [...prev, `Error: ${e.message}`]);
        } finally {
            setIsRunning(false);
        }
    };

    const closeProgress = () => {
        if (isRunning) return; // Prevent closing while running
        setShowProgressModal(false);
        setProgressLog([]);
    }

    const getStatusColor = (status: string) => {
        switch (status?.toUpperCase()) {
            case 'GREEN': return 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]';
            case 'AMBER': return 'text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]';
            case 'RED': return 'text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]';
            default: return 'text-slate-500';
        }
    };

    const formatValue = (val: any, decimals: number = 2, isPercent: boolean = false) => {
        const n = Number(val);
        if (isNaN(n) || !isFinite(n)) return 'N/A';
        if (isPercent) return n.toFixed(decimals) + '%';
        return n < 1 ? n.toFixed(4) : n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const getSourceBadge = (source: string) => {
        if (source?.includes("CoinGecko")) return <span className="text-[10px] bg-green-900/40 text-green-400 px-2 py-0.5 rounded border border-green-500/20">CG Live</span>;
        if (source?.includes("Binance")) return <span className="text-[10px] bg-yellow-900/40 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/20">Binance</span>;
        return <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">Cached</span>;
    };

    if (!config) return <div className="p-10 text-center text-slate-500">Loading Agent Config...</div>;

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">

            {/* Progress Modal */}
            {showProgressModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-blue-500/30 rounded-2xl w-full max-w-lg shadow-2xl shadow-blue-500/20 overflow-hidden relative">
                        {/* Header */}
                        <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                {isRunning && <Activity className="text-blue-400 animate-pulse" />}
                                AI Agent Analysis
                            </h3>
                            {!isRunning && (
                                <button onClick={closeProgress} className="text-slate-400 hover:text-white">
                                    <X size={20} />
                                </button>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-6">
                            <div className="flex flex-col items-center justify-center py-6 gap-4">
                                {isRunning ? (
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full border-4 border-blue-500/30 border-t-blue-500 animate-spin"></div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Activity className="text-blue-400" size={24} />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                                        <CheckCircle size={32} />
                                    </div>
                                )}

                                <div className="text-center">
                                    <h4 className="text-lg font-bold text-white mb-1">{isRunning ? "Analyzing Market Data..." : "Analysis Complete"}</h4>
                                    <p className="text-sm text-blue-300 animate-pulse font-mono">{progress}</p>
                                </div>
                            </div>

                            {/* Log */}
                            <div className="mt-4 bg-black/40 rounded-lg p-3 h-32 overflow-y-auto border border-white/5 font-mono text-xs text-slate-400 space-y-1">
                                {progressLog.map((log, i) => (
                                    <div key={i} className="border-b border-white/5 pb-1 last:border-0">{log}</div>
                                ))}
                                <div id="log-end"></div>
                            </div>

                            {!isRunning && (
                                <button onClick={closeProgress} className="w-full mt-6 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors">
                                    Close & View Report
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}


            {/* Header / Controls */}
            <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                <div>
                    <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-2">
                        <Activity className="text-blue-400" />
                        Active Agent Monitoring
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                        {isRunning ? (
                            <span className="text-emerald-400 animate-pulse">{progress}</span>
                        ) : (
                            lastRunTime ? `Last Run: ${lastRunTime}` : `Tracking ${config.trafficLightTokens.length + config.standardTokens.length} / 11 Assets`
                        )}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setIsConfigOpen(true)}
                        className="p-3 bg-slate-800/50 hover:bg-slate-700/50 border border-white/10 rounded-xl transition-colors text-slate-300"
                        title="Configure Watchlist"
                    >
                        <Settings size={20} />
                    </button>
                    <button
                        onClick={handleRunAnalysis}
                        disabled={isRunning}
                        className={`
              flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wider
              transition-all duration-300 shadow-[0_0_20px_rgba(59,130,246,0.2)]
              ${isRunning
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
                                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border border-blue-400/20 hover:shadow-[0_0_30px_rgba(59,130,246,0.4)]'
                            }
            `}
                    >
                        {isRunning ? <Clock className="animate-spin" size={18} /> : <Play size={18} fill="currentColor" />}
                        {isRunning ? "Agent Active..." : "Run Analysis"}
                    </button>
                </div>
            </div>

            {/* Traffic Light Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {config.trafficLightTokens.map(ticker => {
                    const report = latestReports[ticker.toUpperCase()];
                    return (
                        <div key={ticker} className="relative group bg-gradient-to-br from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-6 overflow-hidden hover:border-blue-500/30 transition-all">
                            <div className="absolute top-0 right-0 p-4 opacity-50 font-black text-6xl text-white/5 select-none pointer-events-none">{ticker}</div>

                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h3 className="text-3xl font-black tracking-tighter text-white mb-1">{ticker}</h3>
                                        <div className="flex items-center gap-2">
                                            {report ? getSourceBadge(report.verificationStatus) : <span className="text-[10px] text-slate-500">No Data</span>}
                                            {report && report.createdAt && (
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                                    <Clock size={10} />
                                                    {new Date(report.createdAt?.toDate?.() || report.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`text-4xl font-black ${getStatusColor(report?.trafficLight)}`}>
                                        {report?.trafficLight === 'GREEN' ? 'GO' : report?.trafficLight === 'AMBER' ? 'HOLD' : report?.trafficLight === 'RED' ? 'STOP' : '--'}
                                    </div>
                                </div>

                                <div className="mt-8 space-y-1">
                                    {report ? (
                                        <>
                                            <div className="text-3xl font-mono text-white tracking-tight">
                                                ${formatValue(report.currentPrice, 2)}
                                            </div>
                                            <div className={`text-sm font-bold ${Number(report.priceChange24h || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {Number(report.priceChange24h || 0) > 0 ? '+' : ''}{formatValue(report.priceChange24h, 2, true)} (24h)
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-slate-500 italic py-4">Waiting for analysis...</div>
                                    )}
                                </div>
                            </div>

                            {/* Glow Effect */}
                            <div className={`absolute -bottom-10 -right-10 w-32 h-32 blur-[80px] rounded-full opacity-20 pointer-events-none 
                ${report?.trafficLight === 'GREEN' ? 'bg-emerald-500' : report?.trafficLight === 'RED' ? 'bg-red-500' : 'bg-amber-500'}
              `}></div>
                        </div>
                    );
                })}
                {Array.from({ length: 3 - config.trafficLightTokens.length }).map((_, i) => (
                    <div key={`empty-${i}`} className="border border-dashed border-white/10 rounded-3xl p-6 flex flex-col items-center justify-center text-slate-600 gap-2 min-h-[200px]">
                        <Plus size={32} />
                        <span className="text-sm font-medium">Slot Empty</span>
                    </div>
                ))}
            </div>

            {/* Standard Tokens List */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-1">
                <div className="p-4 border-b border-white/5 flex justify-between items-center">
                    <h3 className="font-bold text-slate-300 flex items-center gap-2">
                        <Database size={16} className="text-slate-500" />
                        Standard Watchlist
                    </h3>
                    <span className="text-xs text-slate-500">24h Cycle</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1 p-1">
                    {config.standardTokens.map(ticker => {
                        const report = latestReports[ticker.toUpperCase()];
                        const lastUpdated = report ? new Date(report.createdAt?.toDate?.() || report.savedAt) : null;
                        const isStale = lastUpdated && (Date.now() - lastUpdated.getTime() > 24 * 60 * 60 * 1000);

                        return (
                            <div key={ticker} className="bg-black/20 hover:bg-white/5 transition-colors p-3 rounded-xl border border-white/5 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-8 rounded-full ${report?.trafficLight === 'GREEN' ? 'bg-emerald-500' : report?.trafficLight === 'RED' ? 'bg-red-500' : report?.trafficLight === 'AMBER' ? 'bg-amber-500' : 'bg-slate-700'}`}></div>
                                    <div>
                                        <div className="font-bold text-white font-mono">{ticker}</div>
                                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                                            {lastUpdated ? (isStale ? "Stale (>24h)" : "Fresh (<24h)") : "No Data"}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    {report ? (
                                        <>
                                            <div className="text-sm font-mono font-medium text-slate-200">${formatValue(report.currentPrice, 2)}</div>
                                            <div className={`text-[10px] font-bold ${Number(report.priceChange24h || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {formatValue(report.priceChange24h, 1, true)}
                                            </div>
                                        </>
                                    ) : (
                                        <span className="text-xs text-slate-600">--</span>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                    {config.standardTokens.length === 0 && (
                        <div className="col-span-full p-8 text-center text-slate-600 italic">
                            No standard tokens configured. Add tokens to monitor them daily.
                        </div>
                    )}
                </div>
            </div>

            <AgentConfigModal
                isOpen={isConfigOpen}
                onClose={() => { setIsConfigOpen(false); loadData(); }}
                userId={userId}
                onModalAlert={onModalAlert}
                onModalConfirm={onModalConfirm}
            />
        </div>
    );
}
