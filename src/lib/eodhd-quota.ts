/**
 * EODHD QUOTA MANAGER
 *
 * Single source of truth for all EODHD API quota tracking and throttle gating.
 * Imported by both actions.ts (price fetches) and technicals.ts (candle fetches)
 * to ensure consistent enforcement across every EODHD call path.
 *
 * ── Levels ───────────────────────────────────────────────────────────────────
 *   NORMAL   (0–90%)   All calls proceed normally.
 *   THROTTLE (90–95%)  Non-critical calls skip; candle cache TTL extended to 1h.
 *   CRITICAL (95%+)    ALL EODHD calls blocked. Return empty / stale data only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
    EODHD_DAILY_LIMIT,
    EODHD_CRITICAL_THRESHOLD,
    EODHD_THROTTLE_THRESHOLD,
} from './constants';

const EODHD_API_KEY = process.env.EODHD_API_KEY || '';

// ── In-process cache (best-effort on serverless — helps within a single long run) ──
const USAGE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let usageCache: { used: number; limit: number; remaining: number; checkedAt: number } | null = null;

export type EODHDQuotaLevel = 'NORMAL' | 'THROTTLE' | 'CRITICAL';

export interface EODHDQuotaStatus {
    used: number;
    limit: number;
    remaining: number;
    pct: number;
    level: EODHDQuotaLevel;
    /** True when pct >= CRITICAL_THRESHOLD — all EODHD calls should be blocked */
    blocked: boolean;
    /** True when pct >= THROTTLE_THRESHOLD — only essential calls should proceed */
    throttled: boolean;
}

/**
 * Fetches the current EODHD quota status from the /api/user endpoint.
 * Results are cached in-process for 5 minutes to avoid burning quota on checks.
 *
 * Safe to call from any lib file — does NOT require "use server".
 */
export async function checkEODHDQuota(): Promise<EODHDQuotaStatus> {
    if (!EODHD_API_KEY) {
        return makeStatus(0, EODHD_DAILY_LIMIT);
    }

    const now = Date.now();

    // Return cached value if still fresh
    if (usageCache && (now - usageCache.checkedAt) < USAGE_CHECK_INTERVAL_MS) {
        return makeStatus(usageCache.used, usageCache.limit);
    }

    try {
        const res = await fetch(
            `https://eodhd.com/api/user?api_token=${EODHD_API_KEY}&fmt=json`,
            { cache: 'no-store' }
        );

        if (res.ok) {
            const data = await res.json();
            const used = data.apiRequests || 0;
            const rawLimit = (data.dailyRateLimit || 100_000) + (data.extraLimit || 0);
            const limit = Math.min(rawLimit, EODHD_DAILY_LIMIT);

            usageCache = { used, limit, remaining: limit - used, checkedAt: now };

            const status = makeStatus(used, limit);
            logQuotaStatus(status);
            return status;
        }
    } catch {
        console.warn('[EODHD Quota] Usage check failed — using cached/default values');
    }

    // Fallback: use stale cache or safe default
    if (usageCache) {
        return makeStatus(usageCache.used, usageCache.limit);
    }
    return makeStatus(0, EODHD_DAILY_LIMIT);
}

/**
 * Returns the last cached quota status WITHOUT making a network call.
 * Useful when you've already checked quota earlier in the same cycle.
 */
export function getCachedEODHDQuota(): EODHDQuotaStatus | null {
    if (!usageCache) return null;
    return makeStatus(usageCache.used, usageCache.limit);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStatus(used: number, limit: number): EODHDQuotaStatus {
    const remaining = Math.max(0, limit - used);
    const pct = limit > 0 ? used / limit : 0;
    const level: EODHDQuotaLevel =
        pct >= EODHD_CRITICAL_THRESHOLD ? 'CRITICAL' :
            pct >= EODHD_THROTTLE_THRESHOLD ? 'THROTTLE' : 'NORMAL';

    return {
        used,
        limit,
        remaining,
        pct,
        level,
        blocked: level === 'CRITICAL',
        throttled: level === 'THROTTLE' || level === 'CRITICAL',
    };
}

function logQuotaStatus(status: EODHDQuotaStatus) {
    const { used, limit, pct, level } = status;
    const pctStr = (pct * 100).toFixed(1);
    if (level === 'CRITICAL') {
        console.error(`[EODHD Quota] 🚨 CRITICAL: ${used}/${limit} (${pctStr}%). ALL calls BLOCKED.`);
    } else if (level === 'THROTTLE') {
        console.warn(`[EODHD Quota] ⚠️ THROTTLE: ${used}/${limit} (${pctStr}%). Non-essential calls skipped.`);
    } else {
        // Only log at NORMAL if we've recovered from a higher level (optional noise reduction)
        console.log(`[EODHD Quota] ✅ NORMAL: ${used}/${limit} (${pctStr}%).`);
    }
}
