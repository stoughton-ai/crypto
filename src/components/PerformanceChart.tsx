"use client";

import React, { useState, useMemo } from "react";
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
    Scatter,
} from "recharts";
import type { PerformanceHistory, PerformanceDataPoint, TradeMarker } from "@/app/actions";

// ─── Colour palette matching the mission-control dashboard ────────────────
const NAV_COLOR = "#e2e4e9";

// ─── Custom tooltip ───────────────────────────────────────────────────────
function CustomTooltip({
    active,
    payload,
}: {
    active?: boolean;
    payload?: any[];
    label?: number;
}) {
    if (!active || !payload?.length) return null;

    // Find the main data payload (from a Line, not a Scatter)
    const linePayload = payload.find((p: any) => p.payload?.date);
    const point = linePayload?.payload as (PerformanceDataPoint & { _trades?: TradeMarker[]; dayIndex: number }) | undefined;
    const trades = point?._trades || [];

    return (
        <div
            className="min-w-[220px] border border-[#272a35] shadow-2xl"
            style={{ background: "rgba(10,10,12,0.97)", backdropFilter: "blur(12px)" }}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b border-[#272a35] flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#4ba3e3] font-bold tracking-widest uppercase">
                    {point?.label ?? "—"}
                </span>
                <span className="font-mono text-[9px] text-[#555]">
                    {point?.date ? new Date(point.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
                </span>
            </div>

            <div className="p-3 space-y-1.5">
                {payload.map((entry: any, i: number) => {
                    // Skip scatter points and area shadows in tooltip body
                    if (!entry.name || entry.name.startsWith("_area") || entry.name === "BUY" || entry.name === "SELL") return null;
                    const val = typeof entry.value === "number" ? entry.value : null;
                    if (val === null) return null;
                    const isNav = entry.name === "Total NAV";
                    const isAbsMode = Math.abs(val) > 10; // heuristic: $ values are large
                    const sign = val >= 0 ? "+" : "";
                    return (
                        <div key={i} className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-1.5 min-w-0">
                                <span className="shrink-0 w-2 h-2 rounded-full" style={{ background: entry.color }} />
                                <span className={`font-mono text-[11px] truncate ${isNav ? "text-white font-bold" : "text-[#adb5c4]"}`}>
                                    {entry.name}
                                </span>
                            </div>
                            <span className={`font-mono text-[11px] font-bold shrink-0 ${val >= 0 ? "text-[#4caf50]" : "text-[#ff6659]"}`}>
                                {isAbsMode ? `$${val.toFixed(2)}` : `${sign}${val.toFixed(2)}%`}
                            </span>
                        </div>
                    );
                })}

                {/* NAV dollar value in % mode */}
                {point?.navTotal !== undefined && (
                    <div className="flex items-center justify-between pt-1 mt-1 border-t border-[#272a35]">
                        <span className="font-mono text-[9px] text-[#555] uppercase tracking-widest">Portfolio Value</span>
                        <span className="font-mono text-[11px] text-white font-bold">${point.navTotal.toFixed(2)}</span>
                    </div>
                )}

                {/* Trades on this day */}
                {trades.length > 0 && (
                    <div className="pt-1 mt-1 border-t border-[#272a35] space-y-1">
                        <div className="font-mono text-[9px] text-[#555] uppercase tracking-widest mb-1">
                            {trades.length} Trade{trades.length > 1 ? "s" : ""}
                        </div>
                        {trades.slice(0, 5).map((t, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <span className={`font-mono text-[9px] px-1 py-0.5 font-bold ${t.type === "BUY" ? "bg-[#1b5e20] text-[#a5d6a7]" : "bg-[#b71c1c] text-[#ef9a9a]"}`}>
                                    {t.type}
                                </span>
                                <span className="font-mono text-[10px] text-[#e2e4e9]">{t.ticker}</span>
                                <span className="font-mono text-[9px] text-[#555]">${t.total.toFixed(2)}</span>
                                {t.pnlPct !== undefined && (
                                    <span className={`ml-auto font-mono text-[9px] font-bold ${t.pnlPct >= 0 ? "text-[#4caf50]" : "text-[#ff6659]"}`}>
                                        {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%
                                    </span>
                                )}
                            </div>
                        ))}
                        {trades.length > 5 && <div className="font-mono text-[9px] text-[#555]">+{trades.length - 5} more</div>}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Custom dot — only render on the final (live) data point ─────────────
function TailDot(props: any) {
    const { cx, cy, isLast, stroke: color } = props;
    if (!isLast || !cx || !cy) return null;
    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#0a0a0c" strokeWidth={2} />;
}

// ─── Trade marker shape ───────────────────────────────────────────────────
function TradeShape(props: any) {
    const { cx, cy, payload } = props;
    if (!cx || !cy || !payload) return null;
    const isBuy = payload.tradeType === "BUY";
    return (
        <g>
            <circle cx={cx} cy={cy} r={9} fill={isBuy ? "#4caf50" : "#ff6659"} opacity={0.12} />
            <circle cx={cx} cy={cy} r={6} fill={isBuy ? "#4caf50" : "#ff6659"} stroke="#0a0a0c" strokeWidth={1.5} />
            <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={7} fontFamily="monospace" fontWeight="bold" fill="#0a0a0c">
                {isBuy ? "B" : "S"}
            </text>
        </g>
    );
}

// ─── Series toggle button ─────────────────────────────────────────────────
function SeriesToggle({ color, label, active, onClick }: {
    color: string; label: string; active: boolean; onClick: () => void;
}) {
    return (
        <button onClick={onClick} className="flex items-center gap-1.5 px-2 py-1 transition-opacity" style={{ opacity: active ? 1 : 0.32 }}>
            <span className="w-7 h-0.5 rounded-full shrink-0" style={{ background: color, boxShadow: active ? `0 0 5px ${color}` : "none" }} />
            <span className="font-mono text-[10px] text-[#adb5c4] whitespace-nowrap">{label}</span>
        </button>
    );
}

// ─── Main component ───────────────────────────────────────────────────────
export default function PerformanceChart({ history }: { history: PerformanceHistory }) {
    const { dataPoints, tradeMarkers, pools, budget, currentNAV, currentPnlPct } = history;

    const [showNav, setShowNav] = useState(true);
    const [showPools, setShowPools] = useState<Record<string, boolean>>(
        Object.fromEntries(pools.map(p => [p.poolId, true]))
    );
    const [showTrades, setShowTrades] = useState(true);
    const [view, setView] = useState<"pct" | "abs">("pct");

    // ── Assign a stable numeric index to each data point ─────────────────
    // This is the key fix: using numeric X axis prevents Scatter from
    // polluting the tick labels with repeated "Start" entries.
    const enrichedData = useMemo(() => {
        const byDate: Record<string, TradeMarker[]> = {};
        tradeMarkers.forEach(t => {
            if (!byDate[t.date]) byDate[t.date] = [];
            byDate[t.date].push(t);
        });
        return dataPoints.map((dp, i) => ({
            ...dp,
            dayIndex: i,          // numeric X position
            _trades: byDate[dp.date] || [],
        }));
    }, [dataPoints, tradeMarkers]);

    // ── Scatter data mapped to same numeric dayIndex ──────────────────────
    const buyScatter = useMemo(() => {
        if (!showTrades) return [];
        return tradeMarkers
            .filter(t => t.type === "BUY")
            .map(t => {
                const idx = enrichedData.findIndex(d => d.date === t.date);
                if (idx === -1) return null;
                const dp = enrichedData[idx];
                return {
                    dayIndex: idx,
                    value: view === "pct" ? dp.navPct : dp.navTotal,
                    tradeType: "BUY",
                    ticker: t.ticker,
                };
            }).filter(Boolean);
    }, [tradeMarkers, enrichedData, showTrades, view]);

    const sellScatter = useMemo(() => {
        if (!showTrades) return [];
        return tradeMarkers
            .filter(t => t.type === "SELL")
            .map(t => {
                const idx = enrichedData.findIndex(d => d.date === t.date);
                if (idx === -1) return null;
                const dp = enrichedData[idx];
                return {
                    dayIndex: idx,
                    value: view === "pct" ? dp.navPct : dp.navTotal,
                    tradeType: "SELL",
                    ticker: t.ticker,
                    pnlPct: t.pnlPct,
                };
            }).filter(Boolean);
    }, [tradeMarkers, enrichedData, showTrades, view]);

    // ── Y domain ──────────────────────────────────────────────────────────
    const allValues = useMemo(() => {
        const vals: number[] = [];
        enrichedData.forEach(dp => {
            if (view === "pct") {
                if (showNav) vals.push(dp.navPct);
                pools.forEach(p => { if (showPools[p.poolId]) vals.push(dp.pools[p.poolId]?.pnlPct ?? 0); });
            } else {
                if (showNav) vals.push(dp.navTotal);
                pools.forEach(p => { if (showPools[p.poolId]) vals.push(dp.pools[p.poolId]?.value ?? 0); });
            }
        });
        return vals;
    }, [enrichedData, showNav, showPools, pools, view]);

    const yMin = Math.min(...allValues, view === "pct" ? -1 : budget * 0.95);
    const yMax = Math.max(...allValues, view === "pct" ? 1 : budget * 1.05);
    const yPad = (yMax - yMin) * 0.15;

    // ── X axis: format numeric dayIndex → clean date label ───────────────
    const xTickFormatter = (idx: number) => {
        const dp = enrichedData[idx];
        if (!dp) return "";
        // Show "Day N" for days > 0, "Start" only for index 0
        if (dp.label === "Start") return "Start";
        // Format as short date: "Mar 6"
        try {
            return new Date(dp.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        } catch { return dp.label; }
    };

    // Only show a tick for every Nth point to keep axis readable
    const totalPoints = enrichedData.length;
    // Max ~7 ticks including start and end
    const tickStep = Math.max(1, Math.ceil(totalPoints / 6));
    const xTicks = enrichedData
        .map((_, i) => i)
        .filter(i => i === 0 || i === totalPoints - 1 || i % tickStep === 0);

    const yTickFmt = (v: number) => view === "pct" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : `$${v.toFixed(0)}`;
    const lastIdx = enrichedData.length - 1;

    const GradientDef = () => (
        <defs>
            <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NAV_COLOR} stopOpacity={0.08} />
                <stop offset="100%" stopColor={NAV_COLOR} stopOpacity={0} />
            </linearGradient>
            {pools.map(p => (
                <linearGradient key={p.poolId} id={`grad_${p.poolId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={p.color} stopOpacity={0.06} />
                    <stop offset="100%" stopColor={p.color} stopOpacity={0} />
                </linearGradient>
            ))}
        </defs>
    );

    const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    const overallUp = currentPnlPct >= 0;

    return (
        <div className="mc-panel" id="performance-graph">
            {/* Header */}
            <div className="mc-panel-header">
                <div className="flex items-center gap-3">
                    <span className="text-[#4ba3e3]">📈</span>
                    <span>PERFORMANCE GRAPH // NAV &amp; POOL TRAJECTORIES</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`font-mono text-xs font-bold px-2 py-0.5 border ${overallUp ? "text-[#4caf50] border-[#4caf50]/30 bg-[#4caf50]/10" : "text-[#ff6659] border-[#ff6659]/30 bg-[#ff6659]/10"}`}>
                        {fmtPct(currentPnlPct)} TOTAL
                    </span>
                    <span className="text-[#8a8f98] font-mono text-[10px]">${currentNAV.toFixed(2)}</span>
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-[#272a35] bg-[#0a0a0c]">
                <div className="flex flex-wrap items-center gap-1">
                    <SeriesToggle color={NAV_COLOR} label="Total NAV" active={showNav} onClick={() => setShowNav(v => !v)} />
                    {pools.map(p => (
                        <SeriesToggle key={p.poolId} color={p.color} label={`${p.emoji} ${p.name}`}
                            active={!!showPools[p.poolId]}
                            onClick={() => setShowPools(prev => ({ ...prev, [p.poolId]: !prev[p.poolId] }))} />
                    ))}
                    <SeriesToggle color="#6b7280" label="Trades" active={showTrades} onClick={() => setShowTrades(v => !v)} />
                </div>
                <div className="flex items-center border border-[#272a35]">
                    <button onClick={() => setView("pct")} className={`px-3 py-1 font-mono text-[10px] font-bold tracking-widest transition-colors ${view === "pct" ? "bg-[#0b5394] text-white" : "text-[#8a8f98] hover:text-white"}`}>
                        % P&amp;L
                    </button>
                    <button onClick={() => setView("abs")} className={`px-3 py-1 font-mono text-[10px] font-bold tracking-widest transition-colors ${view === "abs" ? "bg-[#0b5394] text-white" : "text-[#8a8f98] hover:text-white"}`}>
                        $ VALUE
                    </button>
                </div>
            </div>

            {/* Chart */}
            <div className="p-4 bg-[#0a0a0c]" style={{ height: 380 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                        data={enrichedData}
                        margin={{ top: 10, right: 28, bottom: 4, left: 8 }}
                    >
                        <GradientDef />

                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1c23" vertical={false} />

                        {/* Numeric X axis — prevents Scatter from injecting duplicate ticks */}
                        <XAxis
                            dataKey="dayIndex"
                            type="number"
                            scale="linear"
                            domain={[0, lastIdx]}
                            ticks={xTicks}
                            tickFormatter={xTickFormatter}
                            tick={{ fill: "#555", fontSize: 9, fontFamily: "monospace" }}
                            axisLine={{ stroke: "#272a35" }}
                            tickLine={false}
                            allowDataOverflow={false}
                        />

                        <YAxis
                            tickFormatter={yTickFmt}
                            tick={{ fill: "#555", fontSize: 9, fontFamily: "monospace" }}
                            axisLine={false}
                            tickLine={false}
                            domain={[yMin - yPad, yMax + yPad]}
                            width={60}
                        />

                        <Tooltip
                            content={<CustomTooltip />}
                            cursor={{ stroke: "#4ba3e3", strokeWidth: 1, strokeDasharray: "4 4" }}
                        />

                        {/* Baseline reference */}
                        <ReferenceLine
                            y={view === "pct" ? 0 : budget}
                            stroke="#2a2d3a"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            label={{ value: view === "pct" ? "Baseline" : `$${budget}`, position: "insideTopRight", fill: "#444", fontSize: 9, fontFamily: "monospace" }}
                        />

                        {/* Pool area fills */}
                        {pools.map(p => showPools[p.poolId] ? (
                            <Area key={`area_${p.poolId}`} type="monotone"
                                dataKey={(dp: any) => view === "pct" ? (dp.pools?.[p.poolId]?.pnlPct ?? null) : (dp.pools?.[p.poolId]?.value ?? null)}
                                name={`_area_${p.poolId}`} stroke="none" fill={`url(#grad_${p.poolId})`}
                                connectNulls dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
                        ) : null)}

                        {/* NAV area fill */}
                        {showNav && (
                            <Area type="monotone"
                                dataKey={(dp: any) => view === "pct" ? dp.navPct : dp.navTotal}
                                name="NAV_AREA" stroke="none" fill="url(#navGrad)"
                                connectNulls dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
                        )}

                        {/* Pool lines */}
                        {pools.map(p => showPools[p.poolId] ? (
                            <Line key={p.poolId} type="monotone"
                                dataKey={(dp: any) => view === "pct" ? (dp.pools?.[p.poolId]?.pnlPct ?? null) : (dp.pools?.[p.poolId]?.value ?? null)}
                                name={`${p.emoji} ${p.name}`} stroke={p.color} strokeWidth={1.5}
                                dot={(dp: any) => <TailDot {...dp} stroke={p.color} isLast={dp.index === lastIdx} />}
                                activeDot={{ r: 5, fill: p.color, stroke: "#0a0a0c", strokeWidth: 2 }}
                                connectNulls legendType="none" isAnimationActive animationDuration={800} animationEasing="ease-out" />
                        ) : null)}

                        {/* Total NAV line (on top) */}
                        {showNav && (
                            <Line type="monotone"
                                dataKey={(dp: any) => view === "pct" ? dp.navPct : dp.navTotal}
                                name="Total NAV" stroke={NAV_COLOR} strokeWidth={2.5}
                                dot={(dp: any) => <TailDot {...dp} stroke={NAV_COLOR} isLast={dp.index === lastIdx} />}
                                activeDot={{ r: 6, fill: NAV_COLOR, stroke: "#0a0a0c", strokeWidth: 2 }}
                                connectNulls legendType="none" isAnimationActive animationDuration={1000} animationEasing="ease-out" />
                        )}

                        {/* Trade markers — use xAxisId numeric key */}
                        {showTrades && buyScatter.length > 0 && (
                            <Scatter name="BUY" data={buyScatter as any[]} dataKey="value" xAxisId={0}
                                shape={<TradeShape />} legendType="none" />
                        )}
                        {showTrades && sellScatter.length > 0 && (
                            <Scatter name="SELL" data={sellScatter as any[]} dataKey="value" xAxisId={0}
                                shape={<TradeShape />} legendType="none" />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Bottom stats bar */}
            <div className="border-t border-[#272a35] bg-[#0a0a0c] px-4 py-2">
                <div className="flex flex-wrap gap-4 items-center justify-between">
                    <div className="flex flex-wrap gap-3">
                        {pools.map(p => (
                            <div key={p.poolId} className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                                <span className="font-mono text-[9px] text-[#8a8f98]">{p.emoji} {p.name.split(" ")[0]}</span>
                                <span className={`font-mono text-[9px] font-bold ${p.currentPnlPct >= 0 ? "text-[#4caf50]" : "text-[#ff6659]"}`}>
                                    {fmtPct(p.currentPnlPct)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        {showTrades && (
                            <>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-[#4caf50] flex items-center justify-center">
                                        <span className="font-mono text-[6px] font-bold text-[#0a0a0c]">B</span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#555]">BUY</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-3 h-3 rounded-full bg-[#ff6659] flex items-center justify-center">
                                        <span className="font-mono text-[6px] font-bold text-[#0a0a0c]">S</span>
                                    </div>
                                    <span className="font-mono text-[9px] text-[#555]">SELL</span>
                                </div>
                            </>
                        )}
                        <span className="font-mono text-[9px] text-[#333]">· live ·</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
