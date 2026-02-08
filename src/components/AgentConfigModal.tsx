"use client";

import { useState, useEffect } from "react";
import { X, Plus, Trash2, ArrowUp, ArrowDown, AlertCircle, RefreshCw } from "lucide-react";
import { getAgentConfig, addTokenToAgent, removeTokenFromAgent, updateTrafficLightTokens, updateStandardTokens, resetAgentTimeline, type AgentConfig } from "@/services/agentConfigService";

interface AgentConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string;
    onModalAlert?: (title: string, message: string) => void;
    onModalConfirm?: (title: string, message: string, onConfirm: (val?: string) => void, isDanger?: boolean) => void;
}

export default function AgentConfigModal({ isOpen, onClose, userId, onModalAlert, onModalConfirm }: AgentConfigModalProps) {
    const [config, setConfig] = useState<AgentConfig | null>(null);
    const [newToken, setNewToken] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && userId) {
            loadConfig();
        }
    }, [isOpen, userId]);

    const loadConfig = async () => {
        setLoading(true);
        try {
            const data = await getAgentConfig(userId);
            setConfig(data);
            setError(null);
        } catch (e) {
            setError("Failed to load configuration.");
        } finally {
            setLoading(false);
        }
    };

    const handleAddToken = async (type: 'traffic' | 'standard') => {
        if (!newToken.trim()) return;
        setLoading(true);
        try {
            await addTokenToAgent(userId, newToken, type);
            setNewToken("");
            await loadConfig();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveToken = async (ticker: string) => {
        setLoading(true);
        try {
            await removeTokenFromAgent(userId, ticker);
            await loadConfig();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePromote = async (ticker: string) => {
        if (!config) return;
        if (config.trafficLightTokens.length >= 3) {
            setError("Traffic Light list is full (Max 3). Demote one first.");
            return;
        }
        setLoading(true);
        try {
            const newStandard = config.standardTokens.filter(t => t !== ticker);
            const newTraffic = [...config.trafficLightTokens, ticker];
            await updateStandardTokens(userId, newStandard);
            await updateTrafficLightTokens(userId, newTraffic);
            await loadConfig();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDemote = async (ticker: string) => {
        if (!config) return;
        if (config.standardTokens.length >= 8) {
            setError("Standard list is full (Max 8). Remove one first.");
            return;
        }
        setLoading(true);
        try {
            const newTraffic = config.trafficLightTokens.filter(t => t !== ticker);
            const newStandard = [...config.standardTokens, ticker];
            await updateTrafficLightTokens(userId, newTraffic);
            await updateStandardTokens(userId, newStandard);
            await loadConfig();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleMove = async (ticker: string, list: 'traffic' | 'standard', direction: number) => {
        if (!config) return;
        setLoading(true);
        try {
            const currentList = list === 'traffic' ? [...config.trafficLightTokens] : [...config.standardTokens];
            const index = currentList.indexOf(ticker);
            if (index === -1) return;

            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= currentList.length) return;

            [currentList[index], currentList[newIndex]] = [currentList[newIndex], currentList[index]];

            if (list === 'traffic') {
                await updateTrafficLightTokens(userId, currentList);
            } else {
                await updateStandardTokens(userId, currentList);
            }
            await loadConfig();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleResetTimeline = async () => {
        const resetAction = async () => {
            setLoading(true);
            try {
                await resetAgentTimeline(userId);
                await loadConfig();
                if (onModalAlert) {
                    onModalAlert("Timeline Reset", "Standard tokens will be analyzed on the next run.");
                }
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        if (onModalConfirm) {
            onModalConfirm(
                "Reset AI Timeline",
                "This will allow standard tokens to be analyzed again immediately. Continue?",
                resetAction
            );
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#0f172a] border border-blue-500/20 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl shadow-blue-900/20">

                {/* Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]"></span>
                        Configure AI Watchlist
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[70vh] overflow-y-auto">
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}

                    {/* Add Token Input */}
                    <div className="flex gap-2 mb-6">
                        <input
                            type="text"
                            value={newToken}
                            onChange={(e) => setNewToken(e.target.value.toUpperCase())}
                            placeholder="ENTER TICKER (e.g. BTC)"
                            className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddToken('standard')}
                        />
                        <button
                            onClick={() => handleAddToken('standard')}
                            disabled={loading || !newToken}
                            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 rounded-xl font-medium transition-colors"
                        >
                            <Plus size={20} />
                        </button>
                    </div>

                    <div className="space-y-6">
                        {/* Traffic Light Section */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Traffic Light Tokens</h3>
                                <div className="flex gap-2">
                                    <span className="text-xs text-slate-500">Order</span>
                                    <span className="text-xs text-slate-500">{config?.trafficLightTokens.length || 0} / 3</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                {config?.trafficLightTokens.map((t, index) => (
                                    <div key={t} className="flex justify-between items-center bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg group">
                                        <div className="flex items-center gap-2">
                                            <div className="flex flex-col gap-0.5 opacity-50 hover:opacity-100">
                                                <button
                                                    onClick={() => handleMove(t, 'traffic', -1)}
                                                    disabled={index === 0}
                                                    className="hover:text-white disabled:opacity-20 transition-colors"
                                                >
                                                    <ArrowUp size={10} />
                                                </button>
                                                <button
                                                    onClick={() => handleMove(t, 'traffic', 1)}
                                                    disabled={index === config.trafficLightTokens.length - 1}
                                                    className="hover:text-white disabled:opacity-20 transition-colors"
                                                >
                                                    <ArrowDown size={10} />
                                                </button>
                                            </div>
                                            <span className="font-mono font-bold text-blue-300">{t}</span>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleDemote(t)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-amber-400" title="Demote to Standard">
                                                <ArrowDown size={14} />
                                            </button>
                                            <button onClick={() => handleRemoveToken(t)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-red-400" title="Remove">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {config?.trafficLightTokens.length === 0 && <div className="text-slate-600 text-sm italic p-2">None selected</div>}
                            </div>
                        </div>

                        {/* Standard Section */}
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Standard Tokens (24h Check)</h3>
                                <div className="flex gap-2">
                                    <span className="text-xs text-slate-500">Order</span>
                                    <span className="text-xs text-slate-500">{config?.standardTokens.length || 0} / 8</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                {config?.standardTokens.map((t, index) => (
                                    <div key={t} className="flex justify-between items-center bg-slate-800/30 border border-white/5 p-3 rounded-lg group">
                                        <div className="flex items-center gap-2">
                                            <div className="flex flex-col gap-0.5 opacity-50 hover:opacity-100">
                                                <button
                                                    onClick={() => handleMove(t, 'standard', -1)}
                                                    disabled={index === 0}
                                                    className="hover:text-white disabled:opacity-20 transition-colors"
                                                >
                                                    <ArrowUp size={10} />
                                                </button>
                                                <button
                                                    onClick={() => handleMove(t, 'standard', 1)}
                                                    disabled={index === config.standardTokens.length - 1}
                                                    className="hover:text-white disabled:opacity-20 transition-colors"
                                                >
                                                    <ArrowDown size={10} />
                                                </button>
                                            </div>
                                            <span className="font-mono font-bold text-slate-300">{t}</span>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handlePromote(t)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-emerald-400" title="Promote to Traffic Light">
                                                <ArrowUp size={14} />
                                            </button>
                                            <button onClick={() => handleRemoveToken(t)} className="p-1.5 hover:bg-white/10 rounded-md text-slate-400 hover:text-red-400" title="Remove">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {config?.standardTokens.length === 0 && <div className="text-slate-600 text-sm italic p-2">None selected</div>}
                            </div>
                        </div>

                        {/* Reset Timeline Button */}
                        <div className="pt-4 border-t border-white/5">
                            <button
                                onClick={handleResetTimeline}
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-slate-800/50 hover:bg-slate-700/50 text-slate-300 rounded-xl border border-white/5 transition-colors text-sm font-medium"
                            >
                                <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                                Reset Analysis Timeline
                            </button>
                            <p className="mt-2 text-[10px] text-slate-500 text-center px-4">
                                Use this if you want the Agent to re-analyze standard tokens before the 24h cooldown expires.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-white/5 bg-black/20 text-xs text-slate-500 text-center">
                    Traffic Light tokens are analyzed on every run. Standard tokens are analyzed once every 24 hours.
                </div>
            </div>
        </div>
    );
}
