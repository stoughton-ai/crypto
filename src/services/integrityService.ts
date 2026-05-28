/**
 * INTEGRITY SERVICE — AI Integrity Agent
 *
 * Runs automatic integrity checks at the end of every arena cycle.
 * Detects anomalies, auto-corrects where safe, and logs every finding
 * to Firestore (integrity_alerts collection) for the dashboard.
 *
 * Alerts can be dismissed from the dashboard but are NEVER deleted —
 * the full audit history is permanently retained.
 */

import { adminDb } from '@/lib/firebase-admin';
import type { ArenaConfig, AssetClass } from '@/lib/constants';
import { POOL_COUNT, POOL_BUDGET } from '@/lib/constants';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IntegrityAlert {
  id?: string;
  userId: string;
  assetClass: AssetClass;
  checkName: string;          // Machine-readable: CASH_DOUBLING, NEGATIVE_CASH, etc.
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;              // Human-readable headline
  description: string;        // Detailed explanation of what was found
  autoFixed: boolean;         // Was this auto-corrected?
  fixDescription?: string;    // What the fix did
  previousValue?: string;     // Before fix
  correctedValue?: string;    // After fix
  detectedAt: string;         // ISO timestamp
  dismissed: boolean;         // UI dismiss flag — alerts with dismissed=true are hidden in the dashboard
  dismissedAt?: string;       // When it was dismissed
}

// ─── Check Results ──────────────────────────────────────────────────────────

interface CheckResult {
  found: boolean;
  alert?: Omit<IntegrityAlert, 'id' | 'userId' | 'assetClass' | 'detectedAt' | 'dismissed'>;
}

// ─── Individual Integrity Checks ─────────────────────────────────────────────

/**
 * CHECK 1: Cash Doubling Detection
 * If sharedCash exceeds totalBudget by a suspicious margin (> 50%),
 * something has inflated it. Clamp to Revolut-verified value if available,
 * otherwise flag for manual review.
 */
function checkCashDoubling(arena: ArenaConfig): CheckResult {
  const sharedCash = (arena as any).sharedCash ?? 0;
  const totalBudget = arena.totalBudget ?? (POOL_COUNT * POOL_BUDGET);
  const dcaContributions = (arena as any).sharedDcaContributions ?? 0;
  const maxExpected = totalBudget + dcaContributions;

  // Cash should never exceed total budget + DCA top-ups (the most you can possibly have
  // is if nothing was invested). Allow 10% tolerance for floating-point / rounding.
  if (sharedCash > maxExpected * 1.1) {
    // Calculate what holdings are worth (to estimate expected cash)
    let holdingsValue = 0;
    for (const pool of arena.pools) {
      for (const h of Object.values(pool.holdings || {})) {
        holdingsValue += (h as any).amount * (h as any).averagePrice;
      }
    }
    const expectedCash = Math.max(0, maxExpected - holdingsValue);
    const previousValue = sharedCash;

    // Auto-fix: clamp to expected cash
    (arena as any).sharedCash = expectedCash;

    return {
      found: true,
      alert: {
        checkName: 'CASH_DOUBLING',
        severity: 'CRITICAL',
        title: '💰 Cash Doubling Detected & Fixed',
        description: `sharedCash was $${previousValue.toFixed(2)} — exceeds maximum expected $${maxExpected.toFixed(2)} (budget $${totalBudget} + DCA $${dcaContributions.toFixed(2)}). This is typically caused by the Revolut sync writing to pool.cashBalance, which then gets re-consolidated into sharedCash. Cash has been corrected.`,
        autoFixed: true,
        fixDescription: `Clamped sharedCash from $${previousValue.toFixed(2)} to $${expectedCash.toFixed(2)} (totalBudget $${totalBudget} + DCA $${dcaContributions.toFixed(2)} − holdings cost $${holdingsValue.toFixed(2)})`,
        previousValue: `$${previousValue.toFixed(2)}`,
        correctedValue: `$${expectedCash.toFixed(2)}`,
      },
    };
  }

  return { found: false };
}

/**
 * CHECK 2: Negative Cash
 * sharedCash should never be negative.
 */
function checkNegativeCash(arena: ArenaConfig): CheckResult {
  const sharedCash = (arena as any).sharedCash ?? 0;

  if (sharedCash < 0) {
    const previousValue = sharedCash;
    (arena as any).sharedCash = 0;

    return {
      found: true,
      alert: {
        checkName: 'NEGATIVE_CASH',
        severity: 'CRITICAL',
        title: '⚠️ Negative Cash Corrected',
        description: `sharedCash was $${previousValue.toFixed(2)} (negative). This can occur from race conditions during concurrent sell/buy executions. Reset to $0.`,
        autoFixed: true,
        fixDescription: `Reset sharedCash from $${previousValue.toFixed(2)} to $0.00`,
        previousValue: `$${previousValue.toFixed(2)}`,
        correctedValue: `$0.00`,
      },
    };
  }

  return { found: false };
}

/**
 * CHECK 3: Pool Cash Leak
 * In the shared-cash model, pool.cashBalance must always be 0.
 * Any non-zero value means cash is being double-counted.
 */
function checkPoolCashLeak(arena: ArenaConfig): CheckResult {
  let totalLeak = 0;
  const leakingPools: string[] = [];

  for (const pool of arena.pools) {
    const poolCash = pool.cashBalance ?? 0;
    if (poolCash > 0.01) {
      totalLeak += poolCash;
      leakingPools.push(`${pool.name}: $${poolCash.toFixed(2)}`);
      pool.cashBalance = 0;
    }
  }

  if (totalLeak > 0.01) {
    // DON'T add to sharedCash — the leak is likely already counted there.
    // Just zero out the pools to prevent double-counting.
    return {
      found: true,
      alert: {
        checkName: 'POOL_CASH_LEAK',
        severity: 'WARNING',
        title: '🔧 Pool Cash Leak Cleared',
        description: `${leakingPools.length} pool(s) had non-zero cashBalance in the shared-cash model: ${leakingPools.join(', ')}. Total: $${totalLeak.toFixed(2)}. Pool balances zeroed to prevent double-counting.`,
        autoFixed: true,
        fixDescription: `Zeroed cashBalance on ${leakingPools.length} pools ($${totalLeak.toFixed(2)} total). Cash NOT added to sharedCash (likely already counted).`,
        previousValue: leakingPools.join('; '),
        correctedValue: `All pools: $0.00`,
      },
    };
  }

  return { found: false };
}

/**
 * CHECK 4: Ghost Holdings
 * A pool should only hold tokens that are in its pool.tokens array.
 */
function checkGhostHoldings(arena: ArenaConfig): CheckResult {
  const ghosts: string[] = [];

  for (const pool of arena.pools) {
    const validTickers = new Set(pool.tokens.map(t => t.toUpperCase()));
    for (const ticker of Object.keys(pool.holdings || {})) {
      if (!validTickers.has(ticker.toUpperCase())) {
        ghosts.push(`${pool.name}: ${ticker}`);
        delete pool.holdings[ticker];
      }
    }
  }

  if (ghosts.length > 0) {
    return {
      found: true,
      alert: {
        checkName: 'GHOST_HOLDINGS',
        severity: 'WARNING',
        title: '👻 Ghost Holdings Removed',
        description: `Found ${ghosts.length} holding(s) in pools for tokens not in their assignment: ${ghosts.join(', ')}. Cleared to prevent phantom NAV inflation.`,
        autoFixed: true,
        fixDescription: `Removed ${ghosts.length} ghost holding(s): ${ghosts.join(', ')}`,
        previousValue: ghosts.join('; '),
        correctedValue: 'Removed',
      },
    };
  }

  return { found: false };
}

/**
 * CHECK 5: NAV Sanity Check
 * Flags (but does not fix) if total NAV suddenly exceeds 2× totalBudget
 * without DCA contributions to explain it. This is an INFO-level flag
 * that could indicate a price feed error or other anomaly.
 */
function checkNAVExplosion(arena: ArenaConfig, prices: Record<string, { price: number }>): CheckResult {
  const totalBudget = arena.totalBudget ?? (POOL_COUNT * POOL_BUDGET);
  const dcaContributions = (arena as any).sharedDcaContributions ?? 0;
  const maxNormalNAV = (totalBudget + dcaContributions) * 2; // 100% gain is unusual but possible

  const sharedCash = (arena as any).sharedCash ?? 0;
  let holdingsValue = 0;

  for (const pool of arena.pools) {
    for (const [ticker, h] of Object.entries(pool.holdings || {})) {
      const price = prices[ticker.toUpperCase()]?.price || (h as any).averagePrice || 0;
      holdingsValue += (h as any).amount * price;
    }
  }

  const totalNAV = holdingsValue + sharedCash;

  if (totalNAV > maxNormalNAV) {
    return {
      found: true,
      alert: {
        checkName: 'NAV_EXPLOSION',
        severity: 'WARNING',
        title: '📈 Unusual NAV Spike Detected',
        description: `Total NAV is $${totalNAV.toFixed(2)} — more than 2× the total invested capital ($${(totalBudget + dcaContributions).toFixed(2)}). This could indicate a price feed error, cash inflation, or genuinely exceptional gains. Manual verification recommended.`,
        autoFixed: false,
        previousValue: `NAV: $${totalNAV.toFixed(2)}`,
        correctedValue: `Expected max: ~$${maxNormalNAV.toFixed(2)}`,
      },
    };
  }

  return { found: false };
}


// ─── Main Integrity Check Runner ─────────────────────────────────────────────

/**
 * Run all integrity checks against an arena config.
 * Called at the end of each arena cron cycle.
 *
 * @param arena  - The arena config (MUTATED in-place if auto-fixes are applied)
 * @param prices - Current token prices (for NAV checks)
 * @returns Array of alerts that were generated (also persisted to Firestore)
 */
export async function runIntegrityChecks(
  userId: string,
  arena: ArenaConfig,
  prices: Record<string, { price: number }>,
  assetClass: AssetClass = 'CRYPTO',
): Promise<IntegrityAlert[]> {
  if (!adminDb) return [];

  const now = new Date().toISOString();
  const alerts: IntegrityAlert[] = [];

  // Run all checks (order matters — cash doubling before negative cash)
  const checks = [
    checkCashDoubling(arena),
    checkNegativeCash(arena),
    checkPoolCashLeak(arena),
    checkGhostHoldings(arena),
    checkNAVExplosion(arena, prices),
  ];

  for (const result of checks) {
    if (result.found && result.alert) {
      const alert: IntegrityAlert = {
        userId,
        assetClass,
        ...result.alert,
        detectedAt: now,
        dismissed: false,
      };
      alerts.push(alert);
    }
  }

  // Persist all alerts to Firestore
  if (alerts.length > 0) {
    const batch = adminDb.batch();
    for (const alert of alerts) {
      const ref = adminDb.collection('integrity_alerts').doc();
      alert.id = ref.id;
      batch.set(ref, alert);
    }
    await batch.commit();

    // Send Telegram notification for CRITICAL alerts
    const criticals = alerts.filter(a => a.severity === 'CRITICAL');
    if (criticals.length > 0) {
      try {
        const { sendSystemAlert } = await import('@/services/telegramService');
        const summary = criticals.map(a => `• ${a.title}`).join('\n');
        await sendSystemAlert(
          '🛡️ INTEGRITY AGENT',
          `${criticals.length} critical issue(s) detected and auto-fixed:\n${summary}`,
          '🛡️',
        );
      } catch {
        // Non-fatal — alert is already persisted
      }
    }

    console.log(`[Integrity] 🛡️ ${alerts.length} issue(s) detected. ${alerts.filter(a => a.autoFixed).length} auto-fixed.`);
  }

  return alerts;
}


// ─── Alert Management ────────────────────────────────────────────────────────

/**
 * Get all alerts for display on the dashboard.
 * Returns undismissed alerts by default, or all if includesDismissed is true.
 */
export async function getIntegrityAlerts(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
  includeDismissed: boolean = false,
): Promise<IntegrityAlert[]> {
  if (!adminDb) return [];

  try {
    let q = adminDb.collection('integrity_alerts')
      .where('userId', '==', userId)
      .where('assetClass', '==', assetClass)
      .orderBy('detectedAt', 'desc')
      .limit(100);

    if (!includeDismissed) {
      q = adminDb.collection('integrity_alerts')
        .where('userId', '==', userId)
        .where('assetClass', '==', assetClass)
        .where('dismissed', '==', false)
        .orderBy('detectedAt', 'desc')
        .limit(50);
    }

    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as IntegrityAlert));
  } catch (e: any) {
    console.warn(`[Integrity] Failed to fetch alerts: ${e.message}`);
    return [];
  }
}

/**
 * Dismiss all active alerts for this user/assetClass from the dashboard.
 * The underlying records are NEVER deleted — only the `dismissed` flag is set.
 */
export async function dismissIntegrityAlerts(
  userId: string,
  assetClass: AssetClass = 'CRYPTO',
): Promise<{ dismissed: number }> {
  if (!adminDb) return { dismissed: 0 };

  try {
    const snap = await adminDb.collection('integrity_alerts')
      .where('userId', '==', userId)
      .where('assetClass', '==', assetClass)
      .where('dismissed', '==', false)
      .limit(200)
      .get();

    if (snap.empty) return { dismissed: 0 };

    const batch = adminDb.batch();
    const now = new Date().toISOString();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { dismissed: true, dismissedAt: now });
    }
    await batch.commit();

    console.log(`[Integrity] ✅ Dismissed ${snap.size} alert(s) for ${userId.substring(0, 8)}`);
    return { dismissed: snap.size };
  } catch (e: any) {
    console.warn(`[Integrity] Dismiss failed: ${e.message}`);
    return { dismissed: 0 };
  }
}
