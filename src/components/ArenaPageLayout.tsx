"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, LogOut, ChevronLeft } from "lucide-react";
import { type AssetClass, ARENA_THEME } from "@/lib/constants";

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
                className="flex justify-between items-center mb-8 flex-wrap gap-4"
            >
                {/* Left: back + branding */}
                <div className="flex items-center gap-4 flex-wrap">
                    <button
                        onClick={() => router.push("/")}
                        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest font-outfit transition-colors"
                        style={{ color: '#8a8f98' }}
                        onMouseEnter={e => (e.currentTarget.style.color = theme.primary)}
                        onMouseLeave={e => (e.currentTarget.style.color = '#8a8f98')}
                    >
                        <ChevronLeft size={14} />
                        Arenas
                    </button>

                    <div
                        className="w-px h-5"
                        style={{ background: 'rgba(255,255,255,0.08)' }}
                    />

                    <div className="flex items-center gap-2.5 font-outfit text-xl font-bold tracking-tight text-white">
                        <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{
                                background: `${theme.primary}22`,
                                border: `1px solid ${theme.primary}44`,
                                boxShadow: `0 0 15px ${theme.glow}`,
                            }}
                        >
                            <Zap size={16} style={{ color: theme.primary }} />
                        </span>
                        <span>Semaphore</span>
                        <span
                            className="text-sm font-semibold px-2 py-0.5 rounded-md"
                            style={{
                                color: theme.primary,
                                background: `${theme.primary}15`,
                                border: `1px solid ${theme.primary}33`,
                            }}
                        >
                            {meta.icon} {meta.label}
                        </span>
                    </div>
                </div>

                {/* Right: user info */}
                {user && (
                    <div className="flex items-center gap-3 premium-glass px-4 py-2.5 rounded-2xl">
                        <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-indigo-500/20 border border-indigo-500/40">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-xs font-bold text-indigo-300 font-outfit">
                                    {user.displayName?.[0] || "?"}
                                </span>
                            )}
                        </div>
                        <span className="text-xs font-semibold text-slate-300 font-outfit tracking-wide">
                            {user.displayName?.split(" ")[0]}
                        </span>
                        <div className="w-px h-4 bg-white/10 mx-1" />
                        <button
                            onClick={logout}
                            className="text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-widest transition-colors flex items-center gap-1.5 font-outfit"
                        >
                            <LogOut size={12} /> Exit
                        </button>
                    </div>
                )}
            </motion.div>

            {/* Page content */}
            {children}
        </main>
    );
}
