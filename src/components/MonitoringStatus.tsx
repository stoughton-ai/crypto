"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { Activity, RefreshCw, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { clsx } from "clsx";
import { manualAgentCheck } from "@/app/actions";
import { getLatestScores } from "@/services/libraryService";
import { AGENT_WATCHLIST } from "@/lib/constants";

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
            // Queue-based Retry System
            // We create a queue of items to process.
            // If an item fails, we check its retry count. If < 15, verify if we should try immediately or cycle.
            // User request: "try 5 times, if no success move onto next, cycle until all verify or hit 15 tries"

            // To achieve "try 5 times then move next", we can just use a local retry counter.
            // But the user probably means "don't block the whole queue on one stubborn asset".
            // So: Attempt 1..5 sequentially. If fail, push to back of queue.

            interface WorkItem {
                ticker: string;
                attempts: number;
            }

            const queue: WorkItem[] = watchlist.map(t => ({ ticker: t, attempts: 0 }));
            let successCount = 0;
            const MAX_TOTAL_RETRIES = 15;
            const BURST_ATTEMPTS = 5; // How many tries before rotating to next asset

            while (queue.length > 0) {
                const item = queue.shift(); // Get first item
                if (!item) break;

                const { ticker } = item;

                // If we've hit absolute max, mark failed and continue
                if (item.attempts >= MAX_TOTAL_RETRIES) {
                    setProgress(prev => ({ ...prev, [ticker]: 'failed' }));
                    setLogs(prev => [...prev, `✗ ${ticker}: Failed after ${item.attempts} attempts.`]);
                    continue;
                }

                setProgress(prev => ({ ...prev, [ticker]: 'analyzing' }));
                setLogs(prev => [...prev, `Analyzing ${ticker} (Attempt ${item.attempts + 1}/${MAX_TOTAL_RETRIES})...`]);

                try {
                    // Try to analyze single
                    const res = await manualAgentAnalyzeSingle(userId, ticker);

                    if (res.success) {
                        setProgress(prev => ({ ...prev, [ticker]: 'completed' }));
                        setLogs(prev => [...prev, `✓ ${ticker}: Verified (Score ${res.score})`]);
                        successCount++;
                    } else {
                        // Analysis Failed or Unverified
                        // Update attempts
                        item.attempts++;

                        // Logic: "Trays 5 times, if no success moves on"
                        // This implies we should keep it at the front of the queue if attempts % 5 != 0?
                        // Or simply: If attempts < 5, unshift (try again immediately).
                        // If attempts == 5 (or 10), push (move to back of queue).

                        if (item.attempts % BURST_ATTEMPTS !== 0) {
                            // Keep trying immediately (stay at front)
                            queue.unshift(item);
                            // Brief pause to not hammer API too hard in immediate loop
                            await new Promise(r => setTimeout(r, 2000));
                        } else {
                            // Rotate to back of queue
                            setLogs(prev => [...prev, `⚠ ${ticker}: Cycling to next asset...`]);
                            queue.push(item);
                        }
                    }
                } catch (err) {
                    console.error(err);
                    item.attempts++;
                    queue.push(item); // Rotate on error
                }
            }

            if (successCount > 0) {
                setLogs(prev => [...prev, "Executing Strategy & Rebalancing Portfolio..."]);
                await manualAgentExecuteTrades(userId);

                // FORCE REFRESH OF SCORES
                setLogs(prev => [...prev, "Refreshing Dashboard..."]);
                await getLatestScores(userId).then(setScores);

                setLogs(prev => [...prev, "✓ Strategy Execution Complete"]);
            } else {
                setLogs(prev => [...prev, "⚠ No valid data to trade on."]);
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

                        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
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

// Stub for import, actual import needs to happen or these actions need to be available.
// Since we are editing MonitoringStatus.tsx, we need these new actions in actions.ts first or imported.
// I will assume I will add them to actions.ts shortly.
import { manualAgentAnalyzeSingle, manualAgentExecuteTrades } from "@/app/actions";

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
                // Trigger score refresh when timestamp updates
                getLatestScores(user.uid).then(setScores);
            }
        });

        // Initial fetch
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
