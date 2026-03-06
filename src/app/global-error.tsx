"use client";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html>
            <body className="bg-slate-950 text-white">
                <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
                    <div style={{ maxWidth: "28rem", width: "100%", textAlign: "center" }}>
                        <h2 style={{ fontSize: "1.25rem", fontWeight: 900, marginBottom: "0.5rem" }}>
                            Critical Error
                        </h2>
                        <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginBottom: "0.25rem" }}>
                            Something went wrong at the application level.
                        </p>
                        <p style={{ fontSize: "0.75rem", color: "#475569", fontFamily: "monospace", wordBreak: "break-all", marginBottom: "1.5rem" }}>
                            {error.message || "Unknown error"}
                        </p>
                        <button
                            onClick={() => reset()}
                            style={{
                                padding: "0.75rem 1.5rem",
                                backgroundColor: "#2563eb",
                                color: "white",
                                border: "none",
                                borderRadius: "0.75rem",
                                fontWeight: 700,
                                fontSize: "0.875rem",
                                cursor: "pointer",
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
