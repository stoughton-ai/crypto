"use client";

import { useEffect } from "react";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("[ErrorBoundary] Caught:", error);
    }, [error]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="w-16 h-16 mx-auto bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center">
                    <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                    </svg>
                </div>
                <div>
                    <h2 className="text-xl font-black text-white mb-2">
                        System Error
                    </h2>
                    <p className="text-sm text-slate-400 mb-1">
                        The dashboard encountered an unexpected error.
                    </p>
                    <p className="text-xs text-slate-600 font-mono break-all">
                        {error.message || "Unknown error"}
                    </p>
                </div>
                <div className="flex flex-col gap-3">
                    <button
                        onClick={() => reset()}
                        className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest transition-all"
                    >
                        Retry
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="w-full px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-bold text-sm uppercase tracking-widest transition-all"
                    >
                        Full Reload
                    </button>
                </div>
            </div>
        </div>
    );
}
