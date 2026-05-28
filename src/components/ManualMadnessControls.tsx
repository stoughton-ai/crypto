import React, { useState } from "react";
import { Settings, Save, ShoppingCart, Ban, ArrowUpCircle, Trash2, RefreshCcw, Plus, X as CloseIcon, Activity, Shield, Zap } from "lucide-react";
import { updateManualPositionSettings, executeManualSell, addToManualPosition, updateBuybackConfig } from "@/app/actions";
import type { PoolHolding, BuybackConfig, BuybackStage } from "@/lib/constants";

interface ManualMadnessControlsProps {
    userId: string;
    pool: any;
    prices: Record<string, { price: number; change24h: number }>;
    onUpdate: () => void;
    showAlert: (title: string, message: string, type?: 'info' | 'success' | 'error') => void;
    showConfirm: (title: string, message: string, onConfirm: () => void) => void;
}

export default function ManualMadnessControls({ userId, pool, prices, onUpdate, showAlert, showConfirm }: ManualMadnessControlsProps) {
    const [loading, setLoading] = useState<string | null>(null);
    const [editSettings, setEditSettings] = useState<Record<string, { stopLoss: number; takeProfit: number; trailingStop: number; gpmEnabled: boolean; gpmCautionScore?: number; gpmDefensiveScore?: number; gpmCautionPct?: number; gpmDefensivePct?: number; }>>({});
    const [editBuybacks, setEditBuybacks] = useState<Record<string, BuybackConfig>>({});
    const [sellAmounts, setSellAmounts] = useState<Record<string, string>>({});
    const [addAmounts, setAddAmounts] = useState<Record<string, { amount: string; price: string }>>({});

    const handleUpdateSettings = async (ticker: string) => {
        const s = editSettings[ticker];
        if (!s) return;
        setLoading(`settings-${ticker}`);
        try {
            const res = await updateManualPositionSettings(userId, ticker, s);
            if (res.success) {
                onUpdate();
                showAlert("Settings Uplink", `Successfully updated risk parameters for ${ticker}.`, "success");
            } else {
                showAlert("Update Error", res.error || "Failed to update settings.", "error");
            }
        } finally {
            setLoading(null);
        }
    };

    const handleUpdateBuyback = async (ticker: string) => {
        const config = editBuybacks[ticker] || pool.buybackConfigs?.[ticker];
        if (!config) return;
        setLoading(`buyback-${ticker}`);
        try {
            const res = await updateBuybackConfig(userId, ticker, config);
            if (res.success) {
                onUpdate();
                showAlert("Buyback Plan", `Automatic buyback parameters for ${ticker} have been synchronized.`, "success");
            } else {
                showAlert("Uplink Error", res.error || "Failed to update buyback config.", "error");
            }
        } finally {
            setLoading(null);
        }
    };

    const handleManualSell = async (ticker: string, full: boolean = false) => {
        const holding = pool.holdings[ticker.toUpperCase()];
        if (!holding) return;
        
        const amountStr = sellAmounts[ticker] || "0";
        const amount = full ? holding.amount : parseFloat(amountStr);
        if (amount <= 0 || amount > holding.amount) return;

        const currentPrice = prices[ticker.toUpperCase()]?.price || holding.averagePrice;
        const executeSell = async () => {
            setLoading(`sell-${ticker}`);
            try {
                const res = await executeManualSell(userId, ticker, amount, currentPrice, "Manual action via dashboard");
                if (res.success) {
                    setSellAmounts(prev => ({ ...prev, [ticker]: "" }));
                    onUpdate();
                    showAlert("Position Liquidated", `Successfully sold ${amount} ${ticker}.`, "success");
                } else {
                    showAlert("Execution Error", res.error || "Failed to execute sell.", "error");
                }
            } finally {
                setLoading(null);
            }
        };

        showConfirm(
            "MANUAL SELL AUTHORIZATION",
            `Are you sure you want to sell ${amount} ${ticker} at current price of $${currentPrice.toFixed(4)}? Total value: $${(amount * currentPrice).toFixed(2)}.`,
            executeSell
        );
    };

    const handleManualAdd = async (ticker: string) => {
        const val = addAmounts[ticker];
        if (!val || !val.amount || !val.price) return;
        
        const amount = parseFloat(val.amount);
        const price = parseFloat(val.price);
        if (amount <= 0 || price <= 0) return;

        const executeAdd = async () => {
            setLoading(`add-${ticker}`);
            try {
                const res = await addToManualPosition(userId, ticker, amount, price, "Manual addition via dashboard");
                if (res.success) {
                    setAddAmounts(prev => ({ ...prev, [ticker]: { amount: "", price: "" } }));
                    onUpdate();
                    showAlert("Position Expanded", `Successfully added ${amount} ${ticker} to manual pool.`, "success");
                } else {
                    showAlert("Uplink Error", res.error || "Failed to record manual purchase.", "error");
                }
            } finally {
                setLoading(null);
            }
        };

        showConfirm(
            "MANUAL ADD AUTHORIZATION",
            `Confirm addition of ${amount} ${ticker} at cost basis $${price.toFixed(4)}? Total committed: $${(amount * price).toFixed(2)}.`,
            executeAdd
        );
    };

    const allTickers = Array.from(new Set([
        ...(pool.tokens || []).map((t: string) => t.toUpperCase()),
        ...Object.keys(pool.holdings || {}).map(t => t.toUpperCase())
    ])).sort((a, b) => {
        const heldA = !!pool.holdings[a];
        const heldB = !!pool.holdings[b];
        if (heldA && !heldB) return -1;
        if (!heldA && heldB) return 1;
        return a.localeCompare(b);
    });

    return (
        <div className="space-y-6">
            <div className="mc-label text-[10px] text-[#ffb74d] pb-2 border-b border-[#272a35] flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Settings size={12} /> MISSION CONTROL // {pool.name}
                </div>
                <div className="text-[8px] opacity-40">UPLINK ACTIVE</div>
            </div>

            {allTickers.map((ticker) => {
                const h = pool.holdings[ticker] as PoolHolding | undefined;
                const isHeld = !!h;
                const currentPrice = prices[ticker]?.price || (isHeld ? h!.averagePrice : 0);
                const pnlPct = isHeld ? ((currentPrice - h!.averagePrice) / h!.averagePrice) * 100 : 0;
                
                const settings = editSettings[ticker] || (isHeld ? h!.settings : null) || { stopLoss: -8, takeProfit: 15, trailingStop: 2, gpmEnabled: false };
                
                const buyback = editBuybacks[ticker] || pool.buybackConfigs?.[ticker] || { enabled: false, stages: [] };
                const lastSellPrice = buyback.lastSellPrice || pool.lastSellPrices?.[ticker] || 0;
                const currentDip = lastSellPrice > 0 ? ((lastSellPrice - currentPrice) / lastSellPrice) * 100 : 0;

                // Calculated trigger prices for UI clarity
                const stopLossPrice = isHeld ? h!.averagePrice * (1 + (settings.stopLoss || 0) / 100) : 0;
                const takeProfitPrice = isHeld ? h!.averagePrice * (1 + (settings.takeProfit || 0) / 100) : 0;
                const peakPrice = isHeld ? (h!.peakPrice || h!.averagePrice) : 0;
                const trailingStopPrice = isHeld ? peakPrice * (1 - (settings.trailingStop || 0) / 100) : 0;

                return (
                    <div key={ticker} className={`bg-[#121318] border ${isHeld ? 'border-[#272a35]' : 'border-white/5 opacity-80'} rounded-lg overflow-hidden transition-all hover:bg-[#15161d]`}>
                        <div className={`p-3 border-b flex justify-between items-center ${isHeld ? 'bg-[#1c1e26] border-[#272a35]' : 'bg-black/20 border-white/5'}`}>
                            <div className="flex items-center gap-3">
                                <span className={`font-bold tracking-tight ${isHeld ? 'text-white' : 'text-[#8a8f98]'}`}>{ticker}</span>
                                {isHeld ? (
                                    <span className="mc-label text-[10px] bg-[#272a35] px-1.5 py-0.5 rounded text-[#e2e4e9]">
                                        {h!.amount.toFixed(4)} @ ${h!.averagePrice.toFixed(4)}
                                    </span>
                                ) : (
                                    <span className="text-[9px] text-[#555] font-mono uppercase">Not currently held</span>
                                )}
                            </div>
                            {isHeld && (
                                <div className="text-right">
                                    <div className={`font-mono text-xs font-bold ${pnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                        {pnlPct >= 0 ? '▲' : '▼'}{Math.abs(pnlPct).toFixed(2)}%
                                    </div>
                                    <div className={`text-[9px] font-mono opacity-60 ${pnlPct >= 0 ? 'text-[#4caf50]' : 'text-[#ff6659]'}`}>
                                        {pnlPct >= 0 ? '+' : '-'}${Math.abs((currentPrice - h!.averagePrice) * h!.amount).toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-5 grid grid-cols-1 xl:grid-cols-12 gap-8">
                            {/* RISK & GPM (Only for Active Positions) */}
                            {isHeld && (
                                <div className="xl:col-span-4 space-y-4">
                                    <div className="mc-label text-[9px] text-[#8a8f98] flex items-center gap-2">
                                        <Shield size={10} className="text-[#ff6659]" /> 
                                        RISK PARAMETERS & GPM
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[8px] text-[#6c727f] mb-1 uppercase font-bold">Stop Loss %</label>
                                            <input
                                                type="number"
                                                value={settings.stopLoss}
                                                onChange={e => setEditSettings(prev => ({ ...prev, [ticker]: { ...settings, stopLoss: parseFloat(e.target.value) } }))}
                                                className="w-full bg-[#0a0a0c] border border-[#272a35] rounded px-2 py-1.5 text-xs text-white focus:border-[#ff6659] outline-none font-mono"
                                            />
                                            <div className="text-[9px] font-mono text-[#ff6659]/80 mt-1 flex justify-between px-0.5" title="The price at which this position will be auto-liquidated.">
                                                <span className="opacity-50">EXIT:</span>
                                                <span className="font-bold">${stopLossPrice.toFixed(4)}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-[8px] text-[#6c727f] mb-1 uppercase font-bold">Take Profit %</label>
                                            <input
                                                type="number"
                                                value={settings.takeProfit}
                                                onChange={e => setEditSettings(prev => ({ ...prev, [ticker]: { ...settings, takeProfit: parseFloat(e.target.value) } }))}
                                                className="w-full bg-[#0a0a0c] border border-[#272a35] rounded px-2 py-1.5 text-xs text-white focus:border-[#4caf50] outline-none font-mono"
                                            />
                                            <div className="text-[9px] font-mono text-[#4caf50]/80 mt-1 flex justify-between px-0.5" title="The price target for profit distribution.">
                                                <span className="opacity-50">TARGET:</span>
                                                <span className="font-bold">${takeProfitPrice.toFixed(4)}</span>
                                            </div>
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-[8px] text-[#6c727f] mb-1 uppercase font-bold">Trailing Stop %</label>
                                            <input
                                                type="number"
                                                value={settings.trailingStop}
                                                onChange={e => setEditSettings(prev => ({ ...prev, [ticker]: { ...settings, trailingStop: parseFloat(e.target.value) } }))}
                                                className="w-full bg-[#0a0a0c] border border-[#272a35] rounded px-2 py-1.5 text-xs text-white focus:border-[#4ba3e3] outline-none font-mono"
                                            />
                                            <div className="text-[9px] font-mono text-[#4ba3e3]/80 mt-1 flex justify-between px-0.5" title={`Trailing from peak price of $${peakPrice.toFixed(4)}`}>
                                                <span className="opacity-50">TRIGGER:</span>
                                                <span className="font-bold">${trailingStopPrice.toFixed(4)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleUpdateSettings(ticker)}
                                        disabled={loading === `settings-${ticker}`}
                                        className="w-full bg-[#272a35]/50 hover:bg-[#323644] text-[#e2e4e9] py-2 rounded text-[9px] font-black tracking-widest uppercase flex items-center justify-center gap-2 border border-white/5 transition-all"
                                    >
                                        <Save size={10} /> {loading === `settings-${ticker}` ? 'UPLINKING...' : 'SYNC RISK SETTINGS'}
                                    </button>
                                </div>
                            )}

                            {/* AUTOMATED BUYBACK PLAN (For All Tokens) */}
                            <div className={`${isHeld ? 'xl:col-span-8' : 'xl:col-span-8'} space-y-4`}>
                                <div className="mc-label text-[9px] text-[#8a8f98] flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <RefreshCcw size={10} className="text-[#4caf50]" />
                                        AUTOMATED BUYBACK PLAN
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            id={`bb-enable-${ticker}`}
                                            checked={buyback.enabled}
                                            onChange={e => setEditBuybacks(prev => ({ ...prev, [ticker]: { ...buyback, enabled: e.target.checked } }))}
                                            className="accent-[#4caf50]"
                                        />
                                        <label htmlFor={`bb-enable-${ticker}`} className="text-[8px] font-black uppercase cursor-pointer">Active</label>
                                    </div>
                                </div>

                                <div className="bg-black/40 p-4 rounded border border-white/5 space-y-4 min-h-[160px] flex flex-col justify-between">
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-end border-b border-white/5 pb-2">
                                            <div>
                                                <div className="text-[7px] text-[#555] uppercase font-bold mb-0.5">Reference Exit Price</div>
                                                <div className="text-xs font-mono text-white/60">${lastSellPrice.toFixed(4) || '---'}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[7px] text-[#555] uppercase font-bold mb-0.5">Current Deviation</div>
                                                <div className={`text-xs font-mono ${currentDip >= 0 ? 'text-[#ff6659]' : 'text-[#4caf50]'}`}>
                                                    {currentDip >= 0 ? '-' : '+'}{Math.abs(currentDip).toFixed(2)}%
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            {buyback.stages.map((stage, idx) => (
                                                <div key={idx} className={`grid grid-cols-12 gap-2 items-center ${stage.completed ? 'opacity-40' : ''}`}>
                                                    <div className="col-span-5 relative">
                                                        <input 
                                                            type="number" 
                                                            placeholder="Dip %" 
                                                            value={stage.thresholdPct} 
                                                            disabled={stage.completed}
                                                            onChange={e => {
                                                                const newStages = [...buyback.stages];
                                                                newStages[idx].thresholdPct = parseFloat(e.target.value);
                                                                setEditBuybacks(prev => ({ ...prev, [ticker]: { ...buyback, stages: newStages } }));
                                                            }}
                                                            className="w-full bg-[#0a0a0c] border border-white/5 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-[#4caf50]" 
                                                        />
                                                        <span className="absolute right-2 top-1.5 text-[8px] text-[#555] font-black">% DIP</span>
                                                        <div className="text-[8px] font-mono text-[#4caf50]/60 mt-1 px-0.5 flex justify-between">
                                                            <span>BUY:</span>
                                                            <span>${(lastSellPrice > 0 ? lastSellPrice * (1 - stage.thresholdPct / 100) : 0).toFixed(4)}</span>
                                                        </div>
                                                    </div>
                                                    <div className="col-span-5 relative">
                                                        <input 
                                                            type="number" 
                                                            placeholder="Amt $" 
                                                            value={stage.amount}
                                                            disabled={stage.completed}
                                                            onChange={e => {
                                                                const newStages = [...buyback.stages];
                                                                newStages[idx].amount = parseFloat(e.target.value);
                                                                setEditBuybacks(prev => ({ ...prev, [ticker]: { ...buyback, stages: newStages } }));
                                                            }}
                                                            className="w-full bg-[#0a0a0c] border border-white/5 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:border-[#4caf50]" 
                                                        />
                                                        <span className="absolute right-2 top-1.5 text-[8px] text-[#555] font-black">USD</span>
                                                    </div>
                                                    <div className="col-span-2 flex justify-end gap-1">
                                                        {stage.completed ? (
                                                            <div className="w-6 h-6 rounded bg-[#4caf50]/20 flex items-center justify-center text-[#4caf50]" title={`Completed at ${stage.ts}`}>
                                                                <RefreshCcw size={10} />
                                                            </div>
                                                        ) : (
                                                            <button 
                                                                onClick={() => {
                                                                    const newStages = buyback.stages.filter((_, i) => i !== idx);
                                                                    setEditBuybacks(prev => ({ ...prev, [ticker]: { ...buyback, stages: newStages } }));
                                                                }}
                                                                className="w-6 h-6 rounded bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-[#555] hover:text-[#ff6659] transition-all"
                                                            >
                                                                <CloseIcon size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => {
                                                const newStages = [...buyback.stages, { thresholdPct: 5, amount: 50 }];
                                                setEditBuybacks(prev => ({ ...prev, [ticker]: { ...buyback, stages: newStages } }));
                                            }}
                                            className="flex-1 border border-dashed border-white/10 hover:border-[#4caf50]/40 text-[#555] hover:text-[#4caf50] py-2 rounded text-[8px] font-black uppercase flex items-center justify-center gap-2 transition-all"
                                        >
                                            <Plus size={10} /> ADD STAGE
                                        </button>
                                        <button 
                                            onClick={() => handleUpdateBuyback(ticker)}
                                            disabled={loading === `buyback-${ticker}` || !buyback.enabled && buyback.stages.length === 0}
                                            className="flex-1 bg-[#2e7d32]/20 hover:bg-[#2e7d32] text-[#4caf50] hover:text-white py-2 rounded text-[8px] font-black uppercase flex items-center justify-center gap-2 transition-all border border-[#2e7d32]/20"
                                        >
                                            <Save size={10} /> {loading === `buyback-${ticker}` ? 'SYNCING...' : 'SYNC PLAN'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {!isHeld && (
                                <div className="xl:col-span-4 space-y-4">
                                    <div className="mc-label text-[9px] text-[#8a8f98] flex items-center gap-2">
                                        <ShoppingCart size={10} className="text-[#4ba3e3]" />
                                        RE-ACQUISITION
                                    </div>
                                    <div className="bg-white/5 p-4 rounded border border-white/5 space-y-3">
                                        <p className="text-[10px] text-[#555] font-mono leading-relaxed">
                                            Establish a fresh position for {ticker} by defining unit amount and cost basis. This will bypass any automated buyback plans.
                                        </p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                placeholder="Units"
                                                type="number"
                                                value={addAmounts[ticker]?.amount || ""}
                                                onChange={e => setAddAmounts(prev => ({ ...prev, [ticker]: { ...(prev[ticker] || { price: "" }), amount: e.target.value } }))}
                                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none"
                                            />
                                            <input
                                                placeholder="Price $"
                                                type="number"
                                                value={addAmounts[ticker]?.price || ""}
                                                onChange={e => setAddAmounts(prev => ({ ...prev, [ticker]: { ...(prev[ticker] || { amount: "" }), price: e.target.value } }))}
                                                className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[10px] text-white outline-none"
                                            />
                                        </div>
                                        <button
                                            onClick={() => handleManualAdd(ticker)}
                                            disabled={loading === `add-${ticker}`}
                                            className="w-full bg-[#0b5394] hover:bg-[#0d61ad] text-white py-2 rounded text-[8px] font-black uppercase transition-all"
                                        >
                                            OPEN POSITION
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}

            {allTickers.length === 0 && (
                <div className="p-8 text-center border border-dashed border-[#272a35] rounded-xl">
                    <ShoppingCart size={24} className="mx-auto text-[#272a35] mb-2" />
                    <p className="text-xs text-[#6c727f] font-mono uppercase">No assets identified for this mission.</p>
                </div>
            )}
        </div>
    );
}


