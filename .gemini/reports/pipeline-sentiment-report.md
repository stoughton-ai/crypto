# Pipeline Sentiment Score — Adaptive Risk Research Report
**Date:** 23 Feb 2026 · **Status:** RESEARCH ONLY — No code changes

---

## 1. The Observation

> "Right now we have 23 RED tokens, 4 AMBER, 0 GREEN. That tells me this is a tricky market to be investing in."

This is an extremely good signal — arguably **better than the Fear & Greed Index** — because it represents the AI's own assessment of the tokens you're actually tracking, not a generic market-wide sentiment number. Your pipeline is essentially a custom-built, real-time market health indicator tailored to your specific trading universe.

---

## 2. The Data Already Exists

Every token in the pipeline has a `trafficLight` (RED/AMBER/GREEN) and an `overallScore` (0–100) stored in the `ticker_intel` Firestore collection. This data is:

1. **Already computed** — the AI assigns it during every scan cycle
2. **Already stored** — it's in `ticker_intel/{userId}_{TICKER}`
3. **Already fetched at trade time** — `executeVirtualTrades()` builds an `intelMap` from all intel data before making any buy/sell decisions (line 460–498 of `virtualPortfolioAdmin.ts`)

The only thing that's **not** currently done is aggregating these signals into a single "pipeline health" metric and using it to adjust trading behaviour.

---

## 3. What a "Pipeline Sentiment Score" Would Look Like

### Calculation (zero API cost — uses existing data)

```typescript
// Count traffic lights across all tracked tokens
const allIntel = Object.values(intelMap);
const redCount   = allIntel.filter(i => i.trafficLight === 'RED').length;
const amberCount = allIntel.filter(i => i.trafficLight === 'AMBER').length;
const greenCount = allIntel.filter(i => i.trafficLight === 'GREEN').length;
const total = allIntel.length;

// Pipeline Health Score (0–100)
// RED=0, AMBER=50, GREEN=100, averaged across all tokens
const pipelineHealth = total > 0
    ? ((greenCount * 100) + (amberCount * 50) + (redCount * 0)) / total
    : 50; // default neutral

// Also available: Mean AI Score
const meanScore = allIntel.reduce((s, i) => s + (i.overallScore || 0), 0) / total;
```

**Your current market reading:**

| Metric | Value | Interpretation |
|---|---|---|
| Traffic Lights | 23 RED / 4 AMBER / 0 GREEN | **Extreme caution zone** |
| Pipeline Health | (0×23 + 50×4 + 100×0) / 27 = **7.4 / 100** | Almost the floor |
| What it means | Less than 8% of your tracked universe has any positive signal | Capital preservation territory |

Compare this to a healthy bull market that might read: 5 RED / 8 AMBER / 14 GREEN → Health = **67/100**

---

## 4. Why This Is Better Than FNG

| Factor | Fear & Greed Index (FNG) | Pipeline Sentiment Score |
|---|---|---|
| **Source** | External (alternative.me) — based on Bitcoin volatility, dominance, social media | Internal — your AI's own assessment of YOUR watchlist |
| **Relevance** | Generic market sentiment; BTC-dominated | Directly measures the tokens you trade |
| **Granularity** | Single number updated daily | Per-token scores updated every cycle |
| **Latency** | Can lag by hours | Real-time (computed from the latest scan) |
| **Reliability** | Third-party API can go down | No external dependency — uses your own Firestore data |
| **Context** | "Market is fearful" (but which tokens?) | "23 of your 27 tracked tokens are RED" (precise) |
| **Cost** | Already fetched (free) | Already computed (free) |

**The pipeline score IS the AI's assessment of whether it's a good time to trade** — it's just not currently being used as an input to the trading parameters.

---

## 5. Implementation Options

### Option D: Pipeline-Driven Adaptive Risk (Recommended)

**The concept:** At the start of each trade execution, compute the pipeline health score from existing intel. Use it to dynamically adjust the buy threshold upward when the market is hostile, making it harder to open new positions.

**Where it plugs in:** Inside `executeVirtualTrades()`, after the `intelMap` is built (line ~498) and before Pass C: Buying (line ~831). This is the exact point where all the intelligence is available and trading decisions are about to be made.

**What it does:**

| Pipeline Health | Buy Threshold Adjustment | Effect |
|---|---|---|
| 0–15 (Extreme Red) | +10 points (e.g. 72 → 82) | Nearly impossible to buy — only exceptional setups |
| 16–30 (Heavy Red) | +6 points (e.g. 72 → 78) | Very selective — only strong conviction |
| 31–45 (Mostly Red) | +3 points (e.g. 72 → 75) | Cautious — slightly higher bar |
| 46–60 (Mixed) | +0 (no change) | Normal trading as per profile |
| 61–75 (Mostly Green) | +0 (no change) | Normal trading |
| 76–100 (Strong Green) | -2 points (e.g. 72 → 70) | Slightly easier entry in bull runs |

**Pseudocode (insert into `executeVirtualTrades`):**

```typescript
// After intelMap is built...
const allIntel = Object.values(intelMap).filter(i => i.trafficLight);
const greenCount = allIntel.filter(i => i.trafficLight === 'GREEN').length;
const amberCount = allIntel.filter(i => i.trafficLight === 'AMBER').length;
const redCount   = allIntel.filter(i => i.trafficLight === 'RED').length;
const total = allIntel.length;
const pipelineHealth = total > 0
    ? ((greenCount * 100) + (amberCount * 50)) / total
    : 50;

// Dynamic buy threshold adjustment
let buyThresholdBoost = 0;
if (pipelineHealth <= 15) buyThresholdBoost = 10;
else if (pipelineHealth <= 30) buyThresholdBoost = 6;
else if (pipelineHealth <= 45) buyThresholdBoost = 3;
else if (pipelineHealth >= 76) buyThresholdBoost = -2;

console.log(`[Brain] 📊 Pipeline Health: ${pipelineHealth.toFixed(0)}/100 `
    + `(${greenCount}G/${amberCount}A/${redCount}R) → `
    + `Buy threshold ${buyThresholdBoost > 0 ? '+' : ''}${buyThresholdBoost}`);

// Apply in Pass C
const BUY_THRESHOLD = (config?.buyScoreThreshold ?? defaults.buyScoreThreshold) + buyThresholdBoost;
```

**What this achieves with YOUR current market (Health = 7.4):**
- Buy threshold jumps from 72 → **82**
- Only a token scoring 82+ with positive 24h momentum would trigger a buy
- In a market where 0 tokens are GREEN, it's essentially impossible to buy — which is exactly what you want
- No profile switch needed, no regime change, no side effects on stop-losses or position caps
- The moment the market recovers and tokens start turning AMBER/GREEN, the threshold naturally relaxes

---

### Option D vs Option B (FNG-Based) — Comparison

| Dimension | Option B (FNG Regime Switch) | Option D (Pipeline Health) |
|---|---|---|
| **Mechanism** | Switches entire risk profile (STEADY ↔ TACTICAL) | Adjusts buy threshold only |
| **Side effects** | Changes stop-losses, position caps, allocation limits, cash reserves — everything | Changes ONE parameter (buy entry bar). Nothing else changes. |
| **Granularity** | Binary (STEADY or TACTICAL) | Continuous (0–100 scale with graduated thresholds) |
| **Source signal** | External FNG (BTC-centric) | Your own AI's assessment of your own tokens |
| **Reversal risk** | A regime switch can cause position cap violations or trigger stop-losses on existing holdings | No impact on existing positions — only affects future buys |
| **Complexity** | Needs hysteresis, cooldown, dashboard indicators, Firestore fields | ~15 lines of code, zero new state, zero new infrastructure |
| **Auditability** | Firestore log of regime switches | Single `console.log` per cycle + visible in Brain telemetry |

---

### Option E: Combined (Both Signals)

Use **both** inputs:

1. **Pipeline Health** → adjusts buy threshold (continuous, per-cycle)
2. **FNG** → emergency regime switch (only at extremes, with hysteresis)

This gives you a **layered defence:**
- Day-to-day: pipeline health naturally makes it harder to buy when the market is red
- Extreme events: FNG < 25 triggers STEADY mode for full capital preservation (tighter stops, smaller positions)

---

## 6. Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| **Stale intel data** | The `intelMap` is refreshed every cycle. If a token hasn't been scanned recently, its old RED/AMBER may persist — but this is conservative (safer to assume RED). |
| **Small pipeline = volatile score** | With only 27 tokens, one token flipping GREEN changes the health by ~3.7 points. Larger pipelines are more stable. Not a major issue — the bands are wide. |
| **False RED from pricing errors** | The AI already guards against this in its scoring rules (negative price = max score 60). An erroneous RED doesn't affect the pipeline score more than other REDs. |
| **Score applies to scaling too?** | Recommend applying the boost to **new entries only**, not to scaling existing positions. Scaling an existing winner in a red market is still rational. |
| **User wants to override** | A toggle `adaptivePipelineEnabled: boolean` in settings lets you disable it if desired. |

---

## 7. Recommendation

**Option D (Pipeline-Driven Adaptive Risk)** is the strongest option for this specific need:

1. **Zero new infrastructure** — uses data that already exists in `intelMap`
2. **~15 lines of code** — the smallest possible change with the biggest impact
3. **No side effects** — doesn't change stop-losses, position caps, or anything about existing positions
4. **Self-correcting** — when markets recover and tokens turn GREEN, the threshold naturally drops
5. **More accurate than FNG** — it measures YOUR tokens, not the generic crypto market
6. **Visible in telemetry** — the health score and threshold adjustment would appear in Brain Activity logs

In your current market (23R/4A/0G), the buy threshold would be 82 — the engine effectively refuses to buy anything unless it's an extraordinary outlier. When 8-10 tokens eventually turn AMBER/GREEN and the health climbs to ~45+, the bar drops back to normal.

**This can also be combined with Option B (FNG) from the previous report** for a layered defence system — pipeline health handles the day-to-day tightening, FNG handles the extreme regime switches.

---

## 8. Next Steps (When You're Ready)

1. **Choose** Option D alone, or Option D + B combined
2. **Confirm** the threshold boost bands (the ones proposed above, or adjusted)
3. **Confirm** whether scaling existing positions should also be affected (recommendation: no)
4. **Confirm** whether to add a toggle in Settings or always-on
5. Say "implement" and I'll build it
