"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Activity, X } from "lucide-react";
import { clsx } from "clsx";
import { manualAgentAnalyzeSingle, getAgentConsultation } from "@/app/actions";
import { type AgentConsultationResult } from "@/lib/agent";

interface PortfolioConsultationModalProps {
    isOpen: boolean;
    onClose: () => void;
    portfolioItems: any[];
    watchlist: string[];
    userId: string;
    onResult: (result: AgentConsultationResult) => void;
}

export default function PortfolioConsultationModal({
    isOpen,
    onClose,
    portfolioItems,
    watchlist,
    userId,
    onResult
}: PortfolioConsultationModalProps) {
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<Record<string, 'pending' | 'analyzing' | 'completed' | 'failed'>>({});
    const [logs, setLogs] = useState<string[]>([]);

    // Derived unique tickers
    const allTickers = useMemo(() => Array.from(new Set([...watchlist, ...portfolioItems.map(p => p.ticker)])), [watchlist, portfolioItems]);

    const startConsultation = useCallback(async () => {
        try {
            setLogs(prev => [...prev, "Initializing Market Scanner..."]);

            // 1. Deep Analysis Phase (Sequential)
            // We use the same rigorous process as the "Analysis Progress" modal
            // This ensures each asset gets a fresh report and full verification.

            const verifiedPrices: Record<string, { price: number; source: string; timestamp: number }> = {};

            interface WorkItem {
                ticker: string;
                attempts: number;
            }

            const queue: WorkItem[] = allTickers.map(t => ({ ticker: t, attempts: 0 }));
            const MAX_RETRIES = 3; // Lower for full analysis as it takes longer
            const BURST = 1; // Strict sequential for clarity

            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;

                const { ticker } = item;

                if (item.attempts >= MAX_RETRIES) {
                    setProgress(prev => ({ ...prev, [ticker]: 'failed' }));
                    setLogs(prev => [...prev, `✗ ${ticker}: Analysis Failed`]);
                    continue;
                }

                setProgress(prev => ({ ...prev, [ticker]: 'analyzing' }));
                setLogs(prev => [...prev, `Analyzing ${ticker} (Attempt ${item.attempts + 1})...`]);

                try {
                    // Use the heavy-duty analysis function that generates reports
                    const res = await manualAgentAnalyzeSingle(userId, ticker);

                    if (res.success && res.price) {
                        // Success!
                        verifiedPrices[ticker] = {
                            price: res.price,
                            source: `Verified (Score: ${res.score})`,
                            timestamp: Date.now()
                        };
                        setProgress(prev => ({ ...prev, [ticker]: 'completed' }));
                        setLogs(prev => [...prev, `✓ ${ticker}: Verified (Score ${res.score})`]);
                    } else {
                        throw new Error(res.message || "Analysis failed");
                    }
                } catch (e) {
                    item.attempts++;
                    // Retry logic
                    if (item.attempts < MAX_RETRIES) {
                        setLogs(prev => [...prev, `⚠ ${ticker}: Retrying...`]);
                        queue.push(item); // Push to back to cycle
                        await new Promise(r => setTimeout(r, 2000)); // Cool down
                    } else {
                        // Fail
                        setProgress(prev => ({ ...prev, [ticker]: 'failed' }));
                        setLogs(prev => [...prev, `✗ ${ticker}: Failed after retries.`]);
                    }
                }
            }

            // 2. AI Strategy Phase
            setLogs(prev => [...prev, "All Assets Analyzed."]);
            setLogs(prev => [...prev, "Consulting AI Agent Strategy..."]);

            // Fallback for failed items? Use current portfolio price or skip?
            // If verification failed, we might skip them in the strategy or use a stale price if available.
            // For now, we pass what we have.

            const result = await getAgentConsultation(userId, portfolioItems, verifiedPrices);

            if (result) {
                setLogs(prev => [...prev, "✓ Strategy Formulated"]);
                await new Promise(r => setTimeout(r, 1000));
                onResult(result);
                onClose();
            } else {
                setLogs(prev => [...prev, "✗ AI Consultation Failed"]);
            }

        } catch (e) {
            console.error(e);
            setLogs(prev => [...prev, "CRITICAL ERROR: System Failure"]);
        } finally {
            setLoading(false);
        }
    }, [allTickers, portfolioItems, onResult, onClose, userId]);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            setLogs([]);
            const initProgress: any = {};
            allTickers.forEach(t => initProgress[t] = 'pending');
            setProgress(initProgress);
            startConsultation();
        }
    }, [isOpen, allTickers, startConsultation]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Activity className="text-indigo-400" /> Portfolio Consultant
                    </h3>
                </div>

                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
                    <div className="grid grid-cols-1 gap-2">
                        {allTickers.map(ticker => (
                            <div key={ticker} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                                <span className="font-bold text-slate-200">{ticker}</span>
                                <div className="flex items-center gap-2">
                                    {progress[ticker] === 'pending' && <span className="text-xs text-slate-500">Queued</span>}
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
            </div>
        </div>
    );
}
