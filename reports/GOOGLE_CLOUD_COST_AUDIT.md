# 📊 Google Cloud Cost Audit — Semaphore Trading System
**Date:** March 26, 2026
**Subject:** Investigation into Increased Cloud Costs (Last 14 Days)

## 🕒 Executive Summary

The observed increase in your Google Cloud bill over the last two weeks is directly correlated with the **expansion from a single arena (Crypto) to a multi-arena ecosystem (FTSE, NYSE, Commodities)** which launched between March 10–12. 

The primary cost drivers are the **increased volume of Gemini LLM calls** (now exceeding 1,500 per day) and **high-frequency Firestore operations** required to manage 16 independent trading pools across 4 arenas.

---

## 🔍 Identified Cost Drivers

### 1. Multi-Arena Expansion (The Multiplier Effect)
Until ~March 10, the system only managed **1 Arena (8 tokens)**. In the last two weeks, 3 additional arenas were activated:
*   **FTSE Arena**: 4 pools, 8 active stocks.
*   **NYSE Arena**: 4 pools, 8 active stocks.
*   **Commodities Arena**: 4 pools, 8 active instruments.
*   **Total**: 32 active instruments now being monitored and evaluated simultaneously.

### 2. High-Frequency AI Evaluations
The `runArenaCycle` (Crypto) runs every **3 minutes**, and the non-crypto arenas run **hourly**. 
*   **Active Evaluations**: Every 15-30 minutes, the AI evaluates 32 tokens. 
*   **Volume**: This results in approximately **1,300–1,500 AI calls per day**.
*   **Paid Tier Transition**: This high volume likely pushed your Google AI Studio quota into the **Paid Tier** (billed via GCP). While individual Flash/Lite model calls are cheap ($0.10/1M tokens), a sustained volume of 1,500+ calls/day adds up to significant monthly usage.

### 3. Intelligence Scanner Deep Analysis
The new **Intelligence Scanner** (added ~March 10) runs twice daily per arena:
*   It performs technical and news scoring on **210+ instruments** in the universe.
*   It invokes **AI Deep Analysis** on the Top 3 candidates per pool (4 pools * 3 candidates * 3 arenas * 2 scans = **72 additional AI calls per day**).
*   These calls often include larger prompts with news headlines and technical indicator summaries, increasing token consumption.

### 4. Firestore Write Volume & Document Size
The system uses Firestore as its primary database. Recent changes have significantly increased write frequency:
*   **3-Minute Heartbeat**: Updates to `agent_configs` (brainState) every 3 minutes.
*   **Snapshotting**: `recordDailySnapshot` writes to `arena_config` every 3 minutes.
*   **Embedded Score History**: The system now stores the last 10 scores per token *inside* the main arena config document. As you track 32 tokens, this document is growing larger, increasing the "cost per write" and hitting document limits (>1MB).

### 5. Strategy Reviews & Reflections
The introduction of **Dynamic Reviews** (every 6h per pool) and **Post-Trade Reflections** adds another layer of high-context (long prompt) AI calls which were not present in Era 1 of the system.

---

## 📉 Actionable Optimizations

To reduce costs without sacrificing performance, I recommend the following:

### 1. Increase Evaluation Cooldowns
Non-crypto assets (FTSE, NYSE) are less volatile than crypto.
*   **Recommendation**: Change `evaluationCooldownMinutes` for FTSE/NYSE/Commodities pools from **15m** to **60m** or **120m**. This alone would reduce evaluation AI calls by 75%.

### 2. Limit Intelligence Scanner AI Summaries
The AI deep analysis for Top 3 candidates is mostly for "rich display" in Telegram.
*   **Recommendation**: Limit AI analysis to the **Top 1** candidate per pool (saves 48 calls/day) or disable the deep analysis if you find the hardcoded score sufficient for promotion.

### 3. Offload Score History from Root Document
The `arena_config` document is nearing "bloat" territory.
*   **Recommendation**: Move `scoreHistory` to its own sub-collection (`/arena_config/{userId}/token_scores/{ticker}`) rather than embedding it in the main arena config. This reduces document size and write overhead.

### 4. Reduce Console Logging in Production
If running on Cloud Run or similar, every `console.log` costs money in **Cloud Logging**.
*   **Recommendation**: Implement a `LOG_LEVEL` environment variable. Ensure that standard 3-minute cycles only log errors or trades, not "everything is normal" status messages.

---

## 📋 Audit Conclusion
The cost increase is **expected system overhead** for a multi-arena autonomous system. However, the current "3-minute loop" for all aspects of evaluation is likely excessive for stocks and commodities. Moving to a tiered evaluation frequency (Hot = 5m, Cool = 60m) will stabilize your bill.

**Would you like me to implement any of the optimization steps above?**
