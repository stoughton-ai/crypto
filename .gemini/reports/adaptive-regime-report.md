# Adaptive Regime Switching — Research Report
**Date:** 23 Feb 2026 · **Status:** RESEARCH ONLY — No code changes

---

## 1. The Idea

Automatically switch the trading profile between **STEADY** and **TACTICAL** based on the Fear & Greed Index (FNG), so that:

| Market Condition | FNG Range | Action |
|---|---|---|
| Extreme Fear / Deep Uncertainty | 0 – 25 | Switch to **STEADY** (capital preservation) |
| Fear / Cautious | 26 – 39 | Switch to **STEADY** |
| Neutral | 40 – 59 | Stay on current profile (no change) |
| Greed / Bullish | 60 – 74 | Switch to **TACTICAL** (momentum trading) |
| Extreme Greed / Euphoria | 75 – 100 | Switch to **TACTICAL** |

The AI would assess market conditions at the start of every brain cycle and, if the FNG reading has moved into a different band, change the `riskProfile` in Firestore. All downstream execution parameters (stop-losses, position sizes, buy thresholds, max positions, etc.) would then automatically adjust on the next cycle.

---

## 2. What Currently Exists

### 2.1 Fear & Greed Index — Already Fetched
The system already fetches FNG in **two places**:

1. **`getGlobalMarketStats()`** (line 397–450 in `actions.ts`) — called for the dashboard UI. Returns `fearGreedIndex` + `fearGreedStatus`.
2. **`getMarketVibe()`** (line 2686–2716 in `actions.ts`) — called at the **start of every brain cycle**. Uses FNG + global market cap change to compute a `multiplier` that speeds up or slows down analysis cycles.

The `getMarketVibe()` function is the natural insertion point — it already reads FNG and runs at the start of every automated cycle.

### 2.2 Risk Profiles — Already Well-Defined
Three profiles exist in `constants.ts` with **fully defined** parameter sets:

| Parameter | STEADY | TACTICAL | ALPHA SWING |
|---|---|---|---|
| Position Stop Loss | -8% | -15% | -25% |
| Max Allocation | $100 | $400 | $500 |
| Cash Reserve | 15% | 10% | 0% |
| Buy Score Threshold | 70 | 72 | 60 |
| Max Open Positions | 3 | 4 | 8 |
| Require Momentum | Yes | Yes | No |
| Min Market Cap | $1B | $100M | $0 |
| Strategy Label | Capital Preservation | Concentrated Momentum | Aggressive Swing |

### 2.3 Profile Switching — Already Works
`updateRiskProfile()` in `agentConfigService.ts` already updates `riskProfile` in Firestore. The `getAgentConfig()` function then resolves all defaults from `PROFILE_DEFAULTS[riskProfile]` — so switching the profile string automatically cascades to every execution parameter.

### 2.4 Market Vibe — Already Adjusts Speed
The current `getMarketVibe()` already adjusts cycle *speed* based on FNG:
- FNG > 75: 0.5x multiplier (scans 2x faster)
- FNG < 25: 2.0x multiplier (scans 2x slower)

This is a **speed** adjustment. The proposal is a **regime** adjustment — changing *what* the engine does, not just *how fast*.

---

## 3. Implementation Options

### Option A: Simple FNG Band Switch (Recommended)

**How it works:** At the start of every cron cycle, after `getMarketVibe()` returns, check the FNG value. If it has crossed into a different band, update `riskProfile` in Firestore.

**Location:** Inside `route.ts` cron handler, between STEP 1 (stop-loss check) and STEP 6 (main brain cycle). Alternatively, at the top of `runAutomatedAgentCheck()`.

**Pseudocode:**
```typescript
// After getMarketVibe() returns...
const fng = vibe.fng;
const currentProfile = config.riskProfile;

let targetProfile: RiskProfile = currentProfile;
if (fng <= 39) targetProfile = 'STEADY';
else if (fng >= 60) targetProfile = 'TACTICAL';
// 40–59 = no change (keep whatever is set)

if (targetProfile !== currentProfile) {
    await adminDb.collection('agent_configs').doc(userId).update({
        riskProfile: targetProfile,
        regimeSwitchReason: `FNG ${fng} → ${targetProfile}`,
        regimeSwitchAt: new Date().toISOString(),
    });
    // Re-fetch config so this cycle uses the new profile
    config = await getServerAgentConfig(userId);
    console.log(`[Regime] 🔄 Switched ${currentProfile} → ${targetProfile} (FNG: ${fng})`);
}
```

**Pros:**
- Minimal code (~20 lines)
- Uses existing infrastructure entirely
- No new API calls (FNG is already fetched)
- Immediately takes effect on the next cycle
- Easy to audit — `regimeSwitchReason` and `regimeSwitchAt` logged in Firestore

**Cons:**
- FNG can oscillate around band boundaries (e.g. 38→41→39) causing frequent switches
- No AI judgement — purely mechanical

**Estimated effort:** 30 minutes

---

### Option B: FNG Band Switch with Hysteresis / Cooldown

Same as Option A but with **anti-flapping** protection:

1. **Hysteresis bands:** Don't *exit* a regime unless FNG moves 5+ points past the threshold (e.g. switched to STEADY at FNG 38 → don't switch back to TACTICAL until FNG exceeds 45, not just 40).
2. **Minimum hold time:** Once a regime is set, it must be held for at least 4 hours (or 2 brain cycles) before another switch is allowed.
3. **Dashboard indicator:** Show "ADAPTIVE: STEADY (FNG 28)" in the strategy display so you can see what triggered the current regime.

**Pseudocode additions:**
```typescript
const STEADY_ENTER = 39;     // Enter STEADY when FNG ≤ 39
const STEADY_EXIT  = 45;     // Exit STEADY only when FNG ≥ 45
const TACTICAL_ENTER = 60;   // Enter TACTICAL when FNG ≥ 60
const TACTICAL_EXIT  = 54;   // Exit TACTICAL only when FNG ≤ 54
const MIN_HOLD_MS = 4 * 60 * 60 * 1000; // 4 hours minimum

const lastSwitch = config.regimeSwitchAt ? new Date(config.regimeSwitchAt).getTime() : 0;
const canSwitch = Date.now() - lastSwitch > MIN_HOLD_MS;

if (!canSwitch) {
    // Too soon to switch — hold current regime
} else if (currentProfile === 'TACTICAL' && fng <= STEADY_ENTER) {
    targetProfile = 'STEADY';
} else if (currentProfile === 'STEADY' && fng >= STEADY_EXIT) {
    targetProfile = 'TACTICAL';
} else if (fng >= TACTICAL_ENTER) {
    targetProfile = 'TACTICAL';
}
```

**Pros:**
- Prevents rapid oscillation ("whipsawing") near boundaries
- More stable for the trading engine (positions aren't subject to sudden parameter changes)
- Still simple and deterministic

**Cons:**
- Slightly more complex (40–50 lines)
- The hysteresis bands and cooldown values are judgement calls — may need tuning

**Estimated effort:** 45 minutes

---

### Option C: AI-Assessed Regime (Full Neural Decision)

Instead of mechanical FNG bands, let the AI itself recommend the regime as part of the Neural Synopsis.

**How it works:** Add a new field to the reflection prompt asking the AI to recommend `STEADY` or `TACTICAL` based on:
- Current FNG value
- Global market cap trend
- Recent portfolio alpha
- Current holdings health

The AI returns a `recommendedRegime: "STEADY" | "TACTICAL"` field. The engine then applies it.

**Pros:**
- More nuanced — the AI considers multiple factors, not just one number
- Can factor in portfolio-specific context (e.g. "we have 3 positions all near stop-loss, switch to STEADY")
- Aligns with the existing "self-correction" pattern

**Cons:**
- AI recommendations can be inconsistent between runs
- Slower to execute (requires an extra LLM call or added prompt complexity)
- Harder to audit — "why did it switch?" becomes an AI reasoning chain, not a simple number
- Could hallucinate regime recommendations

**Estimated effort:** 1.5–2 hours

---

## 4. What Happens When Regime Switches

This is the key consideration. When the profile changes from TACTICAL → STEADY, the following parameters change mid-cycle:

| What Changes | TACTICAL → STEADY Impact |
|---|---|
| **Max positions** | 4 → 3 (engine will try to exit the weakest position) |
| **Position stop-loss** | -15% → -8% (tighter stops = more likely to trigger exits) |
| **Max allocation** | $400 → $100 (existing positions over $100 are *not* forcibly sold, but no further scaling) |
| **Buy threshold** | 72 → 70 (actually slightly more permissive, but constrained by large-cap-only filter) |
| **Min market cap** | $100M → $1B (small/mid cap holdings become "off-spec" but aren't forcibly sold — they just can't be added to) |
| **Cash reserve** | 10% → 15% (engine will prefer selling to build cash) |
| **Sandbox budget** | 25% → 0% (no new speculative entries) |

**Important:** The engine does **not** panic-sell on regime change. It applies the new parameters on the *next* trading decision. Existing positions are held unless they breach the new (tighter) stop-loss or score thresholds. This is gradual tightening, not emergency liquidation.

Going back the other way (STEADY → TACTICAL) simply loosens the constraints — the engine can take larger positions and tolerate more drawdown.

---

## 5. Risks and Edge Cases

| Risk | Mitigation |
|---|---|
| **FNG data source goes down** | `getMarketVibe()` already defaults to FNG=50 on error. If FNG=50, no regime change occurs (neutral band). Safe. |
| **Regime switch during open trades** | Existing positions are not forcibly closed. New parameters apply to future decisions only. The tighter STEADY stop-loss will naturally exit underperformers. |
| **User manually sets a profile** | Need a flag: `adaptiveRegimeEnabled: boolean`. If false, manual profile is respected. If true, the AI overrides it each cycle. |
| **ALPHA SWING never used** | This proposal only switches between STEADY and TACTICAL. ALPHA SWING is left as a manual-only option for explicit user choice. |
| **Rapid FNG swings (e.g. flash crash)** | Option B's hysteresis and cooldown prevent whipsawing. Option A has no protection. |
| **Cost: extra API calls** | Zero — FNG is already fetched every cycle via `getMarketVibe()`. |

---

## 6. Dashboard Visibility

Regardless of which option is chosen, the dashboard should show:
1. **Current regime source** — "Manual" or "Adaptive (FNG-driven)"
2. **Last switch event** — "Switched TACTICAL → STEADY at 14:30 (FNG: 28)"
3. **Current FNG reading** — already shown in the Market Vibe section

This requires minor UI additions to the Cortex Ledger section header.

---

## 7. Recommendation

**Option B (FNG Band Switch with Hysteresis)** is the best balance of simplicity, reliability, and safety.

- It uses infrastructure that already exists (FNG is fetched, profile switching works)
- It adds anti-flapping protection to prevent erratic behaviour
- It's fully auditable (Firestore logs every switch with reason and timestamp)
- It's ~45 minutes of implementation
- Zero additional API cost

The neutral band (40–59) is critical — it means the system doesn't flip-flop during normal market conditions. It only acts when the market is in a clearly fearful or clearly greedy state.

### Suggested FNG Bands for Option B:

```
 0 ──────── 39 ──── 45 ──────── 54 ──── 60 ──────── 100
 │  STEADY ZONE  │  HYSTERESIS  │  NEUTRAL  │  TACTICAL ZONE  │
 │  (Enter ≤39)  │  (Buffer)    │  (No chg) │  (Enter ≥60)    │
```

### New Config Fields Required:
```typescript
adaptiveRegimeEnabled?: boolean;   // Master toggle (default: false)
regimeSwitchAt?: string;           // ISO timestamp of last switch
regimeSwitchReason?: string;       // Human-readable reason
```

---

## 8. Next Steps (When You're Ready)

1. **Choose** Option A, B, or C
2. **Decide** the FNG thresholds (defaults proposed above: ≤39 = STEADY, ≥60 = TACTICAL)
3. **Confirm** whether ALPHA SWING should ever be auto-selected, or remain manual-only
4. **Confirm** whether the feature should be on by default or require manual opt-in via Settings
5. Say "implement" and I'll build it
