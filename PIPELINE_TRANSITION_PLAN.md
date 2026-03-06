# Implementation Plan: Discovery-to-Management Pipeline

This plan outlines the transition of the trading engine from a redundant monitoring model (where tokens sit in both watchlists and portfolios) to a streamlined "Pipeline" architecture.

## 1. Objective
*   **Discovery Phase**: AI scans the market and populates watchlists (Priority, Standard, etc.) with the best *unowned* candidates.
*   **Handoff Phase**: Once a token is purchased, it is immediately evicted from all discovery watchlists to free up research slots.
*   **Management Phase**: The Watchdog takes exclusive ownership of purchased assets, managing scaling (buying more of winners) and exits (trailing stops/risk protection).

---

## 2. Technical Modifications

### Phase A: The Handoff (Eviction Logic)
We must ensure that owning a token and searching for a token are mutually exclusive states.

*   **File**: `src/services/virtualPortfolioAdmin.ts`
*   **Action**: In `executeVirtualTrades`, update the `configUpdates` logic. When a `BUY` trade is successfully recorded:
    *   Add logic to remove the bought `ticker` from `trafficLightTokens`, `standardTokens`, `sandboxTokens`, and `aiWatchlist`.
    *   This triggers the "Slot Empty" state on the dashboard, which is then handled by the next replenishment cycle.

*   **File**: `src/app/actions.ts`
*   **Action**: Update `replenishWatchlists` to fetch current holdings and add them to the `excluded` set during the replenishment scan. This prevents the system from immediately re-adding the token it just bought back into the "Standard" list.

### Phase B: The Management Engine (Watchdog Scaling)
The Watchdog will be empowered to not just protect, but to **press the advantage** on hot tokens.

*   **File**: `src/app/actions.ts`
*   **Action**: Modify `runHoldingsWatchdog` to call `executeVirtualTrades` with `{ sellOnly: false }`. 
*   **Action**: Ensure `ignoreCooldowns: true` is maintained for the Watchdog, as price protection must be instant, but add a specific `scalingCooldown` check for buys.

*   **File**: `src/services/virtualPortfolioAdmin.ts`
*   **Action**: Update `Pass C: BUYING` in `executeVirtualTrades`:
    *   **Old Logic**: Skip if `holdings[ticker]` exists.
    *   **New Logic**: If `holdings[ticker]` exists AND `overallScore > 80` (High Conviction) AND `currentValue < MAX_ALLOCATION_PER_ASSET`, allow a "Scale-In" buy.
    *   **Safety**: Limit Scale-In buys to a smaller size (e.g., $25–$50) compared to initial entries.

### Phase C: Strategic Waterfall Updates
*   **File**: `src/app/actions.ts`
*   **Action**: Update `runBrainWaterfall`. Currently, this function moves tokens *between* tiers based on rank. It should be updated to skip any token currently in the `holdings` map, as those are now "Managed Assets" and no longer "Discovery Candidates."

---

## 3. UI/UX Refinement
*   **Dashboard**: The "Priority" section will now feel more like a "Top Recommendations" list. When a token moves to the Portfolio, a new one will take its place.
*   **Visual Clarity**: Ensure the "Under Management" status is clear in the portfolio view, indicating the Watchdog is actively managing the lifecycle.

---

## 4. Safety Controls (Guardrails)
1.  **Allocation Cap**: The Watchdog cannot scale a position beyond the user's Risk Profile limit (e.g., $400 for Balanced).
2.  **Cash Buffer**: Watchdog buys must always leave the `MIN_CASH_RESERVE` untouched.
3.  **Frequency Limit**: Implement a 12-hour "Scaling Cooldown" to prevent the Watchdog from entering multiple trades on the same token in a single market pump.

---

## 5. Next Steps
1.  [ ] **Eviction Test**: Run a manual trade and verify the token is removed from the Watchlist.
2.  [ ] **Scaling Test**: Manually lower the amount of a high-scoring holding and verify the Watchdog attempts to scale back in to the target allocation.
3.  [ ] **Replenishment verification**: Ensure new candidates fill the freed-up slots immediately after a purchase.
