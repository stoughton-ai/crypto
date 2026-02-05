"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { Activity } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { clsx } from "clsx";

export default function MonitoringStatus() {
    const { user } = useAuth();
    const [jobStatus, setJobStatus] = useState({
        night: false,
        morning: false,
        lunch: false,
        evening: false
    });
    const [morningTime, setMorningTime] = useState("06:00");
    const [eveningTime, setEveningTime] = useState("18:00");
    const [lastResearch, setLastResearch] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;

        // Use onSnapshot for real-time visual check
        const unsubSettings = onSnapshot(doc(db, "users", user.uid, "settings", "notifications"), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.morningTime) setMorningTime(data.morningTime);
                if (data.eveningTime) setEveningTime(data.eveningTime);

                const today = new Intl.DateTimeFormat('en-CA', {
                    timeZone: data.timeZone || 'UTC',
                    year: 'numeric', month: '2-digit', day: '2-digit'
                }).format(new Date());

                setJobStatus({
                    night: data.lastNightCheck === today,
                    morning: data.lastMorningCheck === today,
                    lunch: data.lastLunchCheck === today,
                    evening: data.lastEveningCheck === today
                });
            }
        });

        const unsubVP = onSnapshot(doc(db, "virtual_portfolio", user.uid), (snap) => {
            if (snap.exists()) {
                setLastResearch(snap.data().lastUpdated);
            }
        });

        return () => {
            unsubSettings();
            unsubVP();
        };
    }, [user]);

    if (!user) return null;

    return (
        <div className="space-y-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 flex items-center gap-2">
                <Activity size={12} /> Auto-Monitor Status
            </h3>

            <div className="grid grid-cols-4 gap-2">
                {[
                    { id: 'night', label: '00:00', icon: '🌙' },
                    { id: 'morning', label: morningTime, icon: '☀️' },
                    { id: 'lunch', label: '12:00', icon: '🍱' },
                    { id: 'evening', label: eveningTime, icon: '🌆' }
                ].map((job) => {
                    // Logic to check if a job is LATE (retrying)
                    let isLate = false;
                    try {
                        const [h, m] = job.label.split(':').map(Number);
                        const now = new Date();
                        const schedDate = new Date();
                        schedDate.setHours(h, m, 0, 0);

                        // If current time is 30 mins past scheduled time AND not complete
                        if (now.getTime() > (schedDate.getTime() + 30 * 60000) && !jobStatus[job.id as keyof typeof jobStatus]) {
                            isLate = true;
                        }
                    } catch (e) { }

                    return (
                        <div
                            key={job.id}
                            className={clsx(
                                "flex flex-col items-center justify-center p-2 rounded-xl border transition-all relative overflow-hidden",
                                jobStatus[job.id as keyof typeof jobStatus]
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                    : isLate
                                        ? "bg-amber-500/10 border-amber-500/30 text-amber-500 animate-pulse"
                                        : "bg-black/20 border-white/5 text-slate-600 outline-dashed outline-1 outline-white/5 -outline-offset-1"
                            )}
                        >
                            {isLate && (
                                <div className="absolute top-0 right-0 p-0.5 px-1 bg-amber-500 text-black text-[6px] font-black uppercase">Retry</div>
                            )}
                            <span className="text-sm mb-1">{job.icon}</span>
                            <span className="text-[8px] font-bold uppercase tracking-tighter">{job.label}</span>
                            <div className={clsx(
                                "mt-1 w-1.5 h-1.5 rounded-full",
                                jobStatus[job.id as keyof typeof jobStatus]
                                    ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                                    : isLate
                                        ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                                        : "bg-slate-700"
                            )} />
                        </div>
                    );
                })}
            </div>

            {lastResearch && (
                <div className="p-2.5 bg-indigo-500/5 border border-indigo-500/20 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                            <Activity size={12} className="text-indigo-400" />
                        </div>
                        <div>
                            <p className="text-[9px] font-bold text-indigo-300 uppercase tracking-widest leading-none">Research Agent</p>
                            <p className="text-[10px] text-slate-500 mt-1">Status: Cycle Success</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter text-right">Last Analysis</p>
                        <p className="text-[10px] font-mono text-indigo-300">
                            {new Date(lastResearch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
