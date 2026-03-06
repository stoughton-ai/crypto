# Crypto Trading Algorithm Overhaul — Implementation Plan

## Status: ✅ ALL 7 PHASES IMPLEMENTED & BUILD VERIFIED

All changes compile cleanly (`npx next build` passes with zero errors).

---

## Changes Made (Summary)

### Phase 6: Momentum Gate Softening ✅
**File:** `src/services/virtualPortfolioAdmin.ts`
- Replaced binary momentum gate with graduated filter
- STEADY: Hard block on negative momentum (unchanged behaviour)
- TACTICAL: Allows override with elevated conviction (buyThreshold + 5)
- ALPHA SWING: No momentum gate (dip buying fully allowed)

### Phase 1: Profile-Aware AI Scoring ✅
**Files:** `src/app/actions.ts`, `src/lib/gemini.ts`
- Added `riskProfile` parameter to `analyzeCrypto()` and threaded through from `manualAgentAnalyzeSingle()`
- Replaced hard-coded momentum-only scoring rules with profile-conditional rules:
  - STEADY: Strict caps (negative 24h → max 60, 0-1% → max 70)
  - TACTICAL: Relaxed caps (shallow dip in uptrend → max 72, steep oversold dip → max 68, 0-1% → max 75)
  - ALPHA SWING: Full contrarian (oversold reversal pattern with negative 24h → max 78, 0-1% → full range)
- Added new "Dip Quality" signal (weight 10) to evaluate dip reversal quality
- Added `entryType` field: MOMENTUM | DIP_RECOVERY | BREAKOUT | ACCUMULATION
- Added `entryType` to `CryptoAnalysisResult` interface

### Phase 3: Pipeline Health Inversion ✅
**File:** `src/services/virtualPortfolioAdmin.ts`
- STEADY: Defensive (harder to buy in red markets, protects capital)
- TACTICAL: Balanced contrarian (fear makes entry slightly easier, euphoria adds caution)
- ALPHA SWING: Full contrarian (extreme fear → -5 threshold reduction, euphoria → +5 increase)

### Phase 7: P&L Scoring Refinement ✅
**File:** `src/app/actions.ts`
- Added recovery bonuses: negative P&L + positive 24h > 1% → +5 to score cap
- Adjusted caps: -3% to -5% now caps at 68 (was 65)
- Added winning position sell discipline: P&L > +30% with negative 24h → max score 70

### Phase 4: Smarter Re-Entry Logic ✅
**Files:** `src/services/virtualPortfolioAdmin.ts`, `src/lib/constants.ts`
- Profile-dependent anti-wash timers: STEADY 12h, TACTICAL 6h, ALPHA SWING 2h
- Context-aware re-entry hysteresis:
  - Profit-taking exits → penalty halved
  - Stop-loss exits → penalty 50% harsher
  - Regime shift (score jumped ≥20pts) → hysteresis bypassed entirely
- Added sell reason/score tracking to Pass B for re-entry context

### Phase 5: Entry-Type Position Sizing ✅
**Files:** `src/services/virtualPortfolioAdmin.ts`, `src/lib/constants.ts`
- Entry-type sizing multipliers per profile:
  - STEADY: DIP_RECOVERY 0.5x, ACCUMULATION 0.4x
  - TACTICAL: DIP_RECOVERY 0.65x, ACCUMULATION 0.5x
  - ALPHA SWING: DIP_RECOVERY 0.8x, BREAKOUT 1.2x, ACCUMULATION 0.6x
- Applied after conviction-based sizing in Pass C

### Phase 2: Multi-Timeframe Analysis ✅ (EODHD-only adaptation)
**File:** `src/app/actions.ts`
- Enhanced `fetchHistoricalContext()` to compute multi-scan context from existing Firestore historyBucket:
  - Price trajectory over last 5 scans with percentage change
  - Consecutive declining/rising scan count
  - Recent price range and spread
  - Score trend direction
- No additional API calls — uses existing stored data
- Note: Original plan called for CoinGecko 7d/1h data; adapted to use EODHD-only pipeline

---

## Files Modified

| File | Phases | Changes |
|------|--------|---------|
| `src/app/actions.ts` | 1, 2, 7 | AI prompt overhaul, analyzeCrypto signature, historical context, P&L scoring |
| `src/services/virtualPortfolioAdmin.ts` | 3, 4, 5, 6 | Momentum gate, pipeline health, re-entry logic, entry-type sizing |
| `src/lib/constants.ts` | 4, 5 | antiWashHours, reentryPenalty, entrySizeMultiplier per profile |
| `src/lib/gemini.ts` | 1 | entryType added to CryptoAnalysisResult interface |

---

## Success Metrics

| Metric | Before | Expected After |
|--------|--------|---------------|
| Average entry vs. 7-day low | Top 30% of range | Middle 40-60% of range |
| Win rate on trades | ~45% (est.) | ~55% |
| Average P&L per trade | Low single digits | Mid single digits |
| Dip recovery captures | 0% (blocked) | 40-60% of viable dips |
| Portfolio alpha vs. BTC | Flat/negative | Positive |
