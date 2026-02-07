"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Activity, RefreshCw, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { clsx } from "clsx";
import { manualAgentAnalyzeSingle, manualAgentExecuteTrades } from "@/app/actions";
import { getLatestScores } from "@/services/libraryService";

interface ManualCheckButtonProps {
    userId: string;
    watchlist: string[];
    setScores: (scores: Record<string, { score: number, trafficLight: string }>) => void;
}

function ManualCheckButton({ userId, watchlist, setScores }: ManualCheckButtonProps) {
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [progress, setProgress] = useState<Record<string, 'pending' | 'analyzing' | 'completed' | 'failed'>>({});
    const [logs, setLogs] = useState<string[]>([]);

    const handleCheck = async () => {
        if (loading) return;
        setLoading(true);
        setIsOpen(true);
        setLogs([]);

        // Initialize progress
        const initProgress: any = {};
        watchlist.forEach(t => initProgress[t] = 'pending');
        setProgress(initProgress);

        try {
            interface WorkItem {
                ticker: string;
                attempts: number;
            }

            const queue: WorkItem[] = watchlist.map(t => ({ ticker: t, attempts: 0 }));
            let successCount = 0;
            const MAX_TOTAL_RETRIES = 15;
            const BURST_ATTEMPTS = 3; // Lower burst to cycle more often

            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;

                const { ticker } = item;

                if (item.attempts >= MAX_TOTAL_RETRIES) {
                    setProgress(prev => ({ ...prev, [ticker]: 'failed' }));
                    setLogs(prev => [...prev, `✗ ${ticker}: Failed after ${item.attempts} attempts.`]);
                    continue;
                }

                setProgress(prev => ({ ...prev, [ticker]: 'analyzing' }));
                setLogs(prev => [...prev, `Analyzing ${ticker} (Retry ${item.attempts + 1}/${MAX_TOTAL_RETRIES})...`]);

                try {
                    const res = await manualAgentAnalyzeSingle(userId, ticker);

                    if (res && res.success) {
                        setProgress(prev => ({ ...prev, [ticker]: 'completed' }));
                        setLogs(prev => [...prev, `✓ ${ticker}: Verified (Score ${res.score})`]);
                        successCount++;
                        // Increased delay to 3s to stay well within Gemini 15 RPM limit
                        await new Promise(r => setTimeout(r, 4000));
                    } else {
                        const errMsg = res?.message || 'Verification Failed';
                        setLogs(prev => [...prev, `⚠ ${ticker}: ${errMsg}`]);
                        item.attempts++;

                        if (item.attempts % BURST_ATTEMPTS !== 0) {
                            queue.unshift(item);
                            await new Promise(r => setTimeout(r, 5000));
                        } else {
                            setLogs(prev => [...prev, `⚠ ${ticker}: Cycling to next asset...`]);
                            queue.push(item);
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                } catch (err: any) {
                    console.error(err);
                    setLogs(prev => [...prev, `⚠ ${ticker}: Network/System Error`]);
                    item.attempts++;
                    queue.push(item);
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            if (successCount > 0) {
                setLogs(prev => [...prev, "Executing Strategy & Rebalancing Portfolio..."]);
                const tradeRes = await manualAgentExecuteTrades(userId);

                if (tradeRes && tradeRes.success) {
                    setLogs(prev => [...prev, "✓ Strategy Execution Complete"]);
                } else {
                    setLogs(prev => [...prev, `⚠ Trade Execution: ${tradeRes?.message || 'Failed'}`]);
                }

                setLogs(prev => [...prev, "Refreshing Dashboard..."]);
                await getLatestScores(userId).then(setScores);
            } else {
                setLogs(prev => [...prev, "⚠ No valid data to trade on. Check API limits."]);
            }

        } catch (e) {
            console.error(e);
            setLogs(prev => [...prev, "CRITICAL ERROR: Operation Failed"]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={handleCheck}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-500/50 text-xs font-bold uppercase tracking-widest text-white transition-all shadow-lg shadow-indigo-500/20"
            >
                <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
                {loading ? "Running AI Analysis..." : "Run Full Analysis"}
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Activity className="text-indigo-400" /> Analysis Progress
                            </h3>
                            {!loading && (
                                <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white">
                                    Close
                                </button>
                            )}
                        </div>

                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2 text-slate-300">
                            <div className="grid grid-cols-1 gap-2">
                                {watchlist.map(ticker => (
                                    <div key={ticker} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                                        <span className="font-bold text-slate-200">{ticker}</span>
                                        <div className="flex items-center gap-2">
                                            {progress[ticker] === 'pending' && <span className="text-xs text-slate-500">Waiting...</span>}
                                            {progress[ticker] === 'analyzing' && <span className="text-xs text-indigo-400 animate-pulse">Analyzing...</span>}
                                            {progress[ticker] === 'completed' && <span className="text-xs text-emerald-400 font-bold">✓ Verified</span>}
                                            {progress[ticker] === 'failed' && <span className="text-xs text-red-400 font-bold">Failed</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-4 p-3 bg-black/30 rounded-lg font-mono text-[10px] text-slate-400 space-y-1 h-32 overflow-y-auto border border-white/5">
                                {logs.map((log, i) => (
                                    <div key={i}>{log}</div>
                                ))}
                                {loading && <div className="animate-pulse">_</div>}
                            </div>
                        </div>

                        {!loading && (
                            <button
                                onClick={() => setIsOpen(false)}
                                className="w-full py-3 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-200 transition-all"
                            >
                                Done
                            </button>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

export default function MonitoringStatus({ watchlist = [] }: { watchlist?: string[] }) {
    const { user } = useAuth();
    const [lastResearch, setLastResearch] = useState<string | null>(null);
    const [scores, setScores] = useState<Record<string, { score: number, trafficLight: string }>>({});

    useEffect(() => {
        if (!user) return;

        const unsubVP = onSnapshot(doc(db, "virtual_portfolio", user.uid), (snap) => {
            if (snap.exists()) {
                const val = snap.data().lastUpdated;
                setLastResearch(val);
                getLatestScores(user.uid).then(setScores);
            }
        });

        getLatestScores(user.uid).then(setScores);

        return () => {
            unsubVP();
        };
    }, [user]);

    if (!user) return null;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                    <Zap size={12} className="text-amber-400" /> AI Market Intelligence
                </h3>
                {lastResearch && (
                    <span className="text-[9px] font-mono text-slate-600">
                        Last Run: {new Date(lastResearch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
            </div>

            <div className="bg-slate-900/40 rounded-2xl p-4 border border-white/5 space-y-4">
                <ManualCheckButton userId={user.uid} watchlist={watchlist} setScores={setScores} />
            </div>
        </div>
    );
}
