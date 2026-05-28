"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, LogOut, ChevronLeft } from "lucide-react";
import { type AssetClass, ARENA_THEME } from "@/lib/constants";
import MarketStatusBanner from "@/components/MarketStatusBanner";

interface Props {
    assetClass: AssetClass;
    children: React.ReactNode;
}

const ARENA_LABELS: Record<AssetClass, { icon: string; label: string }> = {
    CRYPTO: { icon: "₿", label: "Crypto Arena" },
    FTSE: { icon: "🏦", label: "FTSE Arena" },
    NYSE: { icon: "🗽", label: "NYSE Arena" },
    COMMODITIES: { icon: "⚙️", label: "Commodities Arena" },
};

export default function ArenaPageLayout({ assetClass, children }: Props) {
    const { user, logout } = useAuth();
    const router = useRouter();
    const theme = ARENA_THEME[assetClass];
    const meta = ARENA_LABELS[assetClass];

    return (
        <main className="max-w-6xl mx-auto px-4 py-8 relative z-10 animate-fade-in">
            {/* Top Navigation */}
            <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="flex justify-between items-center mb-6 md:mb-8 gap-2 md:gap-4 bg-zinc-950/45 border border-zinc-800/40 px-5 py-3 rounded-2xl backdrop-blur-md shadow-2xl"
            >
                {/* Left: branding */}
                <div className="flex items-center gap-4 shrink-0 overflow-hidden group cursor-pointer">
                    <div className="flex items-center gap-2 md:gap-3 font-mono text-base md:text-lg font-bold tracking-tight text-white min-w-0">
                        {/* Interactive breathing logo core */}
                        <span
                            className="w-7 h-7 md:w-8 md:h-8 rounded-md md:rounded-lg flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110"
                            style={{
                                background: `${theme.primary}12`,
                                border: `1px solid ${theme.primary}30`,
                                boxShadow: `0 0 15px ${theme.glow}`,
                            }}
                        >
                            <Zap size={14} className="md:w-4 md:h-4 w-3 h-3 animate-pulse" style={{ color: theme.primary }} />
                        </span>
                        
                        {/* Letter-spacing drift hover typography */}
                        <span className="font-mono font-black uppercase text-white/95 tracking-[0.05em] group-hover:tracking-[0.18em] transition-all duration-700 select-none font-bold">
                            SEMAPHORE
                            <span 
                              className="ml-0.5 font-extrabold"
                              style={{ 
                                color: theme.primary, 
                                textShadow: `0 0 10px ${theme.primary}80` 
                              }}
                            >
                              10
                            </span>
                        </span>
                    </div>

                    {/* Mode integration dot */}
                    <div className="hidden sm:flex items-center gap-2 border-l border-zinc-800/80 pl-4 py-1 font-mono text-[9px] tracking-widest text-zinc-500 font-bold shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: theme.primary }}></span>
                        <span style={{ color: theme.primary }}>NEXUS LINK</span>
                    </div>
                </div>

                {/* Right: user info */}
                {user && (
                    <div className="flex items-center gap-2 md:gap-3 premium-glass px-2 md:px-4 py-1.5 md:py-2.5 rounded-xl md:rounded-2xl shrink-0 min-w-0">
                        <div className="w-6 h-6 md:w-8 md:h-8 rounded-full overflow-hidden flex items-center justify-center bg-indigo-500/20 border border-indigo-500/40 shrink-0">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[9px] md:text-xs font-bold text-indigo-300 font-outfit">
                                    {user.displayName?.[0] || "?"}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] md:text-xs font-semibold text-slate-300 font-outfit tracking-wide truncate max-w-[60px] md:max-w-none">
                            {user.displayName?.split(" ")[0]}
                        </span>
                        <div className="w-px h-4 bg-white/10 mx-0.5 md:mx-1 shrink-0" />
                        <button
                            onClick={logout}
                            className="text-[9px] md:text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-widest transition-colors flex items-center gap-1 md:gap-1.5 font-outfit shrink-0"
                        >
                            <LogOut size={12} className="w-3 h-3 md:w-3.5 md:h-3.5" /> <span className="hidden sm:inline">Exit</span>
                        </button>
                    </div>
                )}
            </motion.div>

            {/* Market status banner — hidden for CRYPTO (24/7) */}
            <MarketStatusBanner assetClass={assetClass} />

            {/* Page content */}
            {children}
        </main>
    );
}
