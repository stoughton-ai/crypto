"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import ArenaDashboard from "@/components/ArenaDashboard";
import MissionSelector from "@/components/MissionSelector";
import { motion } from "framer-motion";
import { Loader2, Zap, LogOut, Shield } from "lucide-react";
import { getAllArenaStatuses } from "@/app/actions";

export default function Home() {
  const { user, loading: authLoading, signInWithGoogle, logout } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const [missionCards, setMissionCards] = useState<any[]>([]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!user) return;
    const load = () => getAllArenaStatuses(user.uid).then(setMissionCards).catch(() => { });
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user]);


  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="relative">
          <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-30 rounded-full animate-pulse-intense" />
          <Loader2 className="animate-spin text-indigo-400 relative z-10" size={56} />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4 relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-md w-full premium-glass p-12 text-center rounded-[2rem] relative overflow-hidden group"
        >
          {/* Inner glowing core */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08)_0%,transparent_50%)] pointer-events-none group-hover:scale-110 transition-transform duration-700" />

          <div className="w-24 h-24 bg-indigo-500/10 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-indigo-500/20 shadow-[0_0_40px_rgba(99,102,241,0.2)] animate-float">
            <Zap className="text-indigo-400 drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]" size={48} />
          </div>

          <h1 className="text-5xl font-black font-outfit text-white mb-2 tracking-tight">
            Semaphore <span className="text-gradient gradient-primary">Arena</span>
          </h1>
          <p className="font-outfit text-slate-400 mb-10 text-sm leading-relaxed tracking-wide opacity-80">
            Autonomous trading competition platform.
            <br />4 Pools. 8 Tokens. 28 Days.
          </p>

          <button
            onClick={signInWithGoogle}
            className="btn-cyber w-full flex items-center justify-center gap-3 text-sm py-4 rounded-xl"
          >
            Sign in to Enter
          </button>

          <div className="mt-8 flex items-center justify-center gap-2 text-xs font-mono text-slate-600">
            <Shield size={14} className="text-slate-500" /> Secure Terminal
          </div>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 relative z-10 animate-fade-in">
      {/* Top Navigation — restored */}
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex justify-between items-center mb-8"
      >
        <div className="flex items-center gap-3 font-outfit text-xl font-bold tracking-tight text-white">
          <span className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
            <Zap size={18} className="text-white" />
          </span>
          Semaphore
        </div>

        <div className="flex items-center gap-3 premium-glass px-4 py-2.5 rounded-2xl">
          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-indigo-500/20 border border-indigo-500/40">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-bold text-indigo-300 font-outfit">{user.displayName?.[0] || '?'}</span>
            )}
          </div>
          <span className="text-xs font-semibold text-slate-300 font-outfit tracking-wide">{user.displayName?.split(' ')[0]}</span>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button onClick={logout} className="text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-widest transition-colors flex items-center gap-1.5 font-outfit">
            <LogOut size={12} /> Exit
          </button>
        </div>
      </motion.div>

      {/* Arena Mission Selector */}
      {missionCards.length > 0 && (
        <MissionSelector cards={missionCards} />
      )}

      {/* Main Crypto Arena Dashboard */}
      <ArenaDashboard />
    </main>
  );
}
