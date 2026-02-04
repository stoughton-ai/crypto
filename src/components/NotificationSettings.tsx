"use client";

import { useState, useEffect } from "react";
import { messaging, db } from "@/lib/firebase";
import { getToken } from "firebase/messaging";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { Bell, BellOff, Clock, Save, Loader2, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";

export default function NotificationSettings() {
    const { user } = useAuth();
    const [enabled, setEnabled] = useState(false);
    const [morningTime, setMorningTime] = useState("07:30");
    const [eveningTime, setEveningTime] = useState("19:30");
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState("");
    const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>("default");

    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window) {
            setPermissionStatus(Notification.permission);
        }
    }, []);

    useEffect(() => {
        if (user) {
            const loadSettings = async () => {
                try {
                    const docRef = doc(db, "users", user.uid, "settings", "notifications");
                    const snap = await getDoc(docRef);
                    if (snap.exists()) {
                        const data = snap.data();
                        setEnabled(data.enabled || false);
                        if (data.morningTime) setMorningTime(data.morningTime);
                        if (data.eveningTime) setEveningTime(data.eveningTime);
                    }
                } catch (e) {
                    console.error("Failed to load settings", e);
                }
            };
            loadSettings();
        }
    }, [user]);

    const requestPermission = async () => {
        if (!messaging) {
            setStatusMsg("Notifications not supported");
            return;
        }

        try {
            setLoading(true);
            const permission = await Notification.requestPermission();
            setPermissionStatus(permission);

            if (permission === "granted") {
                // Get Timezone
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

                // Get Token
                // Note: In production you often need a VAPID key. If this fails, we will log it.
                const token = await getToken(messaging, {
                    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
                }).catch(async (err) => {
                    console.log("Standard token fetch failed, trying without key if that helps or just logging error", err);
                    // Note: Without a specific VAPID key committed in env, we often rely on the project's default configuration linking.
                    return await getToken(messaging!).catch(e => null);
                });

                if (token && user) {
                    await setDoc(doc(db, "users", user.uid, "settings", "notifications"), {
                        fcmToken: token,
                        enabled: true,
                        morningTime,
                        eveningTime,
                        timeZone,
                        updatedAt: new Date().toISOString()
                    }, { merge: true });
                    setEnabled(true);
                    setStatusMsg("Active");
                    setTimeout(() => setStatusMsg(""), 3000);
                } else {
                    setStatusMsg("Setup Failed: No Token");
                }
            } else {
                setStatusMsg("Permission Denied");
            }
        } catch (error) {
            console.error("Error asking permission", error);
            setStatusMsg("Error");
        } finally {
            setLoading(false);
        }
    };

    const toggleNotifications = async () => {
        if (!enabled) {
            await requestPermission();
        } else {
            // Disable
            setLoading(true);
            if (user) {
                await updateDoc(doc(db, "users", user.uid, "settings", "notifications"), {
                    enabled: false
                });
                setEnabled(false);
            }
            setLoading(false);
        }
    };

    const savePreferences = async () => {
        if (user && enabled) {
            setLoading(true);
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            try {
                await updateDoc(doc(db, "users", user.uid, "settings", "notifications"), {
                    morningTime,
                    eveningTime,
                    timeZone,
                    updatedAt: new Date().toISOString()
                });
                setStatusMsg("Saved!");
                setTimeout(() => setStatusMsg(""), 3000);
            } catch (e) {
                setStatusMsg("Save Failed");
            } finally {
                setLoading(false);
            }
        }
    };

    if (!user) return <div className="mt-8 p-4 border-t border-white/10 text-xs text-red-500 font-bold">⚠️ Debug: Auth User Missing</div>;

    return (
        <div className="mt-8 pt-8 border-t border-white/10">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                <Bell size={12} />
                Auto-Monitor
            </h3>

            <div className="glass bg-slate-900/40 rounded-xl p-4 border border-white/5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className={clsx(
                            "p-2 rounded-lg transition-colors",
                            enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-800 text-slate-500"
                        )}>
                            {enabled ? <Bell size={18} /> : <BellOff size={18} />}
                        </div>
                        <div>
                            <p className={clsx("text-sm font-bold", enabled ? "text-white" : "text-slate-400")}>
                                {enabled ? "Monitoring Active" : "Monitoring Off"}
                            </p>
                            <p className="text-[10px] text-slate-500">Twice-daily reports</p>
                        </div>
                    </div>
                    <button
                        onClick={toggleNotifications}
                        disabled={loading}
                        className={clsx(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                            enabled ? "bg-emerald-500" : "bg-slate-700"
                        )}
                    >
                        <span
                            className={clsx(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out",
                                enabled ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>
                </div>

                <AnimatePresence>
                    {enabled && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="space-y-3 pt-2">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 mb-1 block">Morning Check</label>
                                        <div className="relative">
                                            <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                            <input
                                                type="time"
                                                value={morningTime}
                                                onChange={(e) => setMorningTime(e.target.value)}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-8 pr-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 mb-1 block">Evening Check</label>
                                        <div className="relative">
                                            <Clock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                            <input
                                                type="time"
                                                value={eveningTime}
                                                onChange={(e) => setEveningTime(e.target.value)}
                                                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-8 pr-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-2">
                                    <p className="text-[10px] text-slate-600">
                                        Browser notifications must be allowed.
                                        <br />
                                        {statusMsg && <span className="text-emerald-400 font-bold">{statusMsg}</span>}
                                    </p>
                                    <button
                                        onClick={savePreferences}
                                        disabled={loading}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg text-[10px] font-bold uppercase transition-all"
                                    >
                                        {loading ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                        Save
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
