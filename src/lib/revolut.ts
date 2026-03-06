
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════════════════════
// QUOTAGUARD USAGE TRACKING & CIRCUIT BREAKER
// Budget: 18,000 calls/month (hard cap 20,000 on $19 Starter plan).
// Every Revolut API call goes through the QuotaGuard static proxy.
// Tracks usage in-memory (per-process) and persists to Firestore daily.
//
// Levels:
//   NORMAL  (0-80%) — All calls proceed normally
//   THROTTLE (80-90%) — Non-essential calls deferred (health checks, IP lookups)
//   CRITICAL (90%+)  — Only trade orders go through; all reads from cache
// ═══════════════════════════════════════════════════════════════════════════════
const QUOTAGUARD_MONTHLY_BUDGET = 18_000;  // Soft budget — leaves 2K buffer to hard 20K cap
const QUOTAGUARD_THROTTLE_PCT = 0.80;      // 80% — start deferring non-essential calls
const QUOTAGUARD_CRITICAL_PCT = 0.90;      // 90% — only trade orders allowed

// In-memory usage counter — resets per process, but we persist to Firestore
let qgCallsThisProcess = 0;
let qgPersistedMonthlyUsage = 0;
let qgLastPersistedAt = 0;
let qgMonthKey = '';  // e.g. '2026-03'

// ── HEALTH CHECK CACHE ─────────────────────────────────────────────────────
// checkHealth() is expensive (1 balances call via proxy = 1 QuotaGuard token).
// Cache the result for 30 minutes — connectivity rarely changes within that window.
// Trade orders will still go through regardless; this only gates the pre-flight check.
const HEALTH_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
let healthCacheResult: { healthy: boolean; checkedAt: number } | null = null;

/**
 * Returns cached health status if still valid, or null if a fresh check is needed.
 * Exported so the audit cron can reuse the cache instead of making its own check.
 */
export function getCachedHealthStatus(): { healthy: boolean; checkedAt: number; ageMs: number } | null {
    if (!healthCacheResult) return null;
    const age = Date.now() - healthCacheResult.checkedAt;
    if (age > HEALTH_CACHE_TTL_MS) return null;
    return { ...healthCacheResult, ageMs: age };
}

function getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// How many days have passed in the current month (including today)
function daysIntoMonth(): number {
    return new Date().getDate();
}

// How many days in the current month total
function daysInMonth(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

/**
 * Returns the current QuotaGuard usage state.
 * Combines persisted Firestore count with in-process calls.
 */
export function getQuotaGuardUsage(): {
    used: number;
    budget: number;
    remaining: number;
    pct: number;
    level: 'NORMAL' | 'THROTTLE' | 'CRITICAL';
    dailyBudget: number;
    dailyUsed: number;
    daysRemaining: number;
} {
    const monthKey = getCurrentMonthKey();
    // If month rolled over, reset
    if (monthKey !== qgMonthKey) {
        qgPersistedMonthlyUsage = 0;
        qgCallsThisProcess = 0;
        qgMonthKey = monthKey;
    }

    const used = qgPersistedMonthlyUsage + qgCallsThisProcess;
    const remaining = Math.max(0, QUOTAGUARD_MONTHLY_BUDGET - used);
    const pct = used / QUOTAGUARD_MONTHLY_BUDGET;
    const level: 'NORMAL' | 'THROTTLE' | 'CRITICAL' =
        pct >= QUOTAGUARD_CRITICAL_PCT ? 'CRITICAL' :
            pct >= QUOTAGUARD_THROTTLE_PCT ? 'THROTTLE' : 'NORMAL';

    const daysRem = daysInMonth() - daysIntoMonth() + 1; // days remaining including today
    const dailyBudget = daysRem > 0 ? Math.floor(remaining / daysRem) : 0;

    return { used, budget: QUOTAGUARD_MONTHLY_BUDGET, remaining, pct, level, dailyBudget, dailyUsed: qgCallsThisProcess, daysRemaining: daysRem };
}

/**
 * Records a proxy call. Called internally by RevolutX.request().
 */
export function recordProxyCall(): void {
    qgCallsThisProcess++;
}

/**
 * Loads persisted usage from Firestore. Call once at cycle start.
 */
export async function loadQuotaGuardUsage(adminDb: any): Promise<void> {
    if (!adminDb) return;
    const monthKey = getCurrentMonthKey();
    try {
        const snap = await adminDb.collection('quotaguard_usage').doc(monthKey).get();
        if (snap.exists) {
            const data = snap.data();
            qgPersistedMonthlyUsage = data.totalCalls || 0;
            qgMonthKey = monthKey;
        } else {
            qgPersistedMonthlyUsage = 0;
            qgMonthKey = monthKey;
        }
    } catch (e: any) {
        console.warn('[QuotaGuard] Failed to load usage from Firestore:', e.message);
    }
}

/**
 * Persists the current usage to Firestore. Call after each scan cycle.
 */
export async function persistQuotaGuardUsage(adminDb: any): Promise<void> {
    if (!adminDb || qgCallsThisProcess === 0) return;
    const monthKey = getCurrentMonthKey();
    const now = Date.now();
    // Don't persist more often than every 30 seconds
    if (now - qgLastPersistedAt < 30_000) return;
    qgLastPersistedAt = now;

    try {
        const docRef = adminDb.collection('quotaguard_usage').doc(monthKey);
        const { FieldValue } = await import('firebase-admin/firestore');
        await docRef.set({
            month: monthKey,
            totalCalls: FieldValue.increment(qgCallsThisProcess),
            lastUpdated: new Date().toISOString(),
        }, { merge: true });
        // Move in-process calls into the persisted count
        qgPersistedMonthlyUsage += qgCallsThisProcess;
        qgCallsThisProcess = 0;
    } catch (e: any) {
        console.warn('[QuotaGuard] Failed to persist usage:', e.message);
    }
}

/**
 * Check if a non-essential proxy call should be skipped.
 * Trade orders (BUY/SELL) are NEVER skipped — only reads.
 */
export function shouldSkipProxyCall(purpose: 'health_check' | 'balances' | 'tickers' | 'ip_lookup' | 'trade_order'): boolean {
    if (purpose === 'trade_order') return false; // Never block trade execution
    const { level } = getQuotaGuardUsage();
    if (level === 'CRITICAL') {
        console.warn(`[QuotaGuard] 🚨 CRITICAL (≥90%) — blocking ${purpose} to preserve budget for trades`);
        return true;
    }
    if (level === 'THROTTLE' && (purpose === 'ip_lookup' || purpose === 'health_check')) {
        console.warn(`[QuotaGuard] ⚠️ THROTTLE (≥80%) — skipping ${purpose}`);
        return true;
    }
    return false;
}

export interface RevolutBalance {
    currency?: string;
    symbol?: string;
    balance?: string | number;
    amount?: string | number;
    available?: string | number;
    reserved?: string | number;
    total?: string | number; // Some endpoints might still return total
}

export interface RevolutHolding {
    symbol: string;
    amount: number;
    available: number;
}

import { ProxyAgent } from 'undici';

// ... existing imports

export class RevolutX {
    private apiKey: string;
    private privateKey: string;
    private baseUrl: string = 'https://revx.revolut.com';
    private proxyDispatcher: any = null;

    constructor(apiKey: string, privateKey: string, isSandbox: boolean = false, proxyUrl?: string) {
        this.apiKey = apiKey;
        this.privateKey = privateKey;

        if (isSandbox) {
            this.baseUrl = 'https://sandbox-revx.revolut.com';
        }

        const effectiveProxyUrl = proxyUrl || process.env.REVOLUT_PROXY_URL;

        if (effectiveProxyUrl) {
            // For modern Node (18+) fetch, we use undici ProxyAgent as a dispatcher
            // We increase timeouts because proxy connections can be slow
            this.proxyDispatcher = new ProxyAgent({
                uri: effectiveProxyUrl,
                headersTimeout: 60000, // 60s
                bodyTimeout: 60000,    // 60s
                connectTimeout: 60000  // 60s
            });
            console.log(`[RevolutX] Using Proxy: ${effectiveProxyUrl.replace(/:[^:@]+@/, ':***@')} (Hidden Creds)`);
        }
    }

    private sign(timestamp: number, method: string, path: string, body?: string): string {
        const message = `${timestamp}${method}${path}${body || ''}`;

        // Ensure private key is in proper PEM format for crypto.sign
        let formattedKey = this.privateKey.trim();
        if (!formattedKey.includes('-----BEGIN PRIVATE KEY-----')) {
            formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
        }

        const signature = crypto.sign(
            undefined,
            Buffer.from(message),
            crypto.createPrivateKey(formattedKey)
        );

        return signature.toString('base64');
    }

    private async request(method: string, path: string, bodyJson?: any, signal?: AbortSignal, purpose?: 'health_check' | 'balances' | 'tickers' | 'ip_lookup' | 'trade_order') {
        // Track every proxy call for QuotaGuard budget management
        if (this.proxyDispatcher) {
            recordProxyCall();
            const usage = getQuotaGuardUsage();
            if (usage.pct >= 0.8) {
                console.log(`[QuotaGuard] 📊 Proxy call #${usage.used + 1} | ${(usage.pct * 100).toFixed(1)}% of ${usage.budget} budget | ${usage.remaining} remaining | Level: ${usage.level}`);
            }
        }
        const MAX_RETRIES = 3;
        let lastError: any;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const timestamp = Date.now();
            const bodyStr = bodyJson ? JSON.stringify(bodyJson) : '';
            const signature = this.sign(timestamp, method, path, bodyStr);

            const headers: any = {
                'X-Revx-API-Key': this.apiKey,
                'X-Revx-Timestamp': timestamp.toString(),
                'X-Revx-Signature': signature,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Site': 'same-site',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Dest': 'empty',
                'Origin': 'https://revx.revolut.com'
            };

            const url = `${this.baseUrl}${path}`;
            const options: any = {
                method,
                headers,
                body: bodyJson ? bodyStr : undefined,
                cache: 'no-store',
                signal
            };

            if (this.proxyDispatcher) {
                options.dispatcher = this.proxyDispatcher;
            }

            try {
                const res = await fetch(url, options);

                // Handle HTTP errors
                if (!res.ok) {
                    const errorText = await res.text();

                    // If it's a rate limit or server error, we might want to retry
                    if (res.status === 429 || res.status >= 500) {
                        console.warn(`[RevolutX] Attempt ${attempt} failed with ${res.status}. Retrying...`);
                        lastError = new Error(`Revolut API Error: ${res.status} ${errorText}`);
                        if (attempt < MAX_RETRIES) {
                            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                            continue;
                        }
                    }

                    const contentType = res.headers.get('content-type');
                    if (contentType && contentType.includes('text/html')) {
                        throw new Error(`Revolut Endpoint Error: Received HTML. Check Env/Keys.`);
                    }

                    throw new Error(`Revolut API Error: ${res.status} ${errorText}`);
                }

                try {
                    return await res.json();
                } catch (e: any) {
                    throw new Error(`Invalid JSON response: ${e.message}`);
                }

            } catch (e: any) {
                lastError = e;

                // Retry on network/timeout errors
                const isRetryable = e.message?.includes('fetch failed') ||
                    e.code === 'UND_ERR_HEADERS_TIMEOUT' ||
                    e.code === 'ECONNRESET' ||
                    e.code === 'ETIMEDOUT';

                if (isRetryable && attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000;
                    console.warn(`[RevolutX] Network error on attempt ${attempt}: ${e.message}. Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // Enhanced error detection for Proxy issues (403)
                // if (e.message?.includes('403') || e.cause?.message?.includes('403')) {
                //    const myIp = await this.getOutboundIp().catch(() => 'unknown');
                //    throw new Error(`Revolut Access Denied (403)...`);
                // }
                throw e;
            }
        }

        throw lastError;
    }

    /**
     * Retrieves account balances.
     * Revolut Exchange API uses /api/1.0/accounts
     */
    async getBalances(): Promise<RevolutBalance[]> {
        return this.request('GET', '/api/1.0/balances', undefined, undefined, 'balances');
    }

    /**
     * Retrieves all tradable instruments (pairs) on Revolut X.
     */
    async getInstruments(): Promise<any> {
        return this.request('GET', '/api/1.0/tickers', undefined, undefined, 'tickers');
    }

    async getHoldings(): Promise<RevolutHolding[]> {
        const accounts = await this.getBalances();
        console.log(`[RevolutX] Raw Accounts:`, JSON.stringify(accounts));

        // Map accounts to holdings
        // API returns { currency: "USD", balance: "100.00", available: "100.00" }
        return accounts
            .filter((a: any) => {
                const bal = a.balance ?? a.amount ?? a.total ?? 0;
                const curr = (a.currency ?? a.symbol ?? '').toUpperCase();
                const isFiat = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(curr);
                return parseFloat(bal.toString()) > 0 && !isFiat;
            })
            .map((a: any) => ({
                symbol: a.currency ?? a.symbol ?? '',
                amount: parseFloat((a.balance ?? a.amount ?? a.total ?? 0).toString()),
                available: parseFloat((a.available ?? a.balance ?? a.amount ?? 0).toString())
            }));
    }

    async createOrder(params: {
        symbol: string,
        side: 'BUY' | 'SELL',
        size: string,
        price?: string,
        type: 'market' | 'limit'
    }) {
        const formattedSymbol = params.symbol.replace('/', '-');
        const body: any = {
            client_order_id: crypto.randomUUID(),
            symbol: formattedSymbol,
            side: params.side,
            order_configuration: {}
        };

        if (params.type === 'market') {
            body.order_configuration.market = {
                base_size: params.size
            };
        } else {
            body.order_configuration.limit = {
                base_size: params.size,
                price: params.price
            };
        }

        return this.request('POST', '/api/1.0/orders', body, undefined, 'trade_order');
    }

    async getOutboundIp(): Promise<string> {
        // QuotaGuard budget check — IP lookup is non-essential
        if (this.proxyDispatcher && shouldSkipProxyCall('ip_lookup')) {
            return 'Skipped (QuotaGuard budget)';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        try {
            const options: any = {
                cache: 'no-store',
                signal: controller.signal
            };
            if (this.proxyDispatcher) {
                options.dispatcher = this.proxyDispatcher;
                recordProxyCall(); // IP lookup also goes through the proxy
            }
            const res = await fetch('https://api.ipify.org', options);
            const ip = await res.text();
            return ip.trim();
        } catch (e: any) {
            return `Error: ${e.name === 'AbortError' ? 'Timeout' : e.message}`;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Verifies that the proxy and API are reachable.
     * Returns true if healthy, throws error if systemic issue detected.
     * 
     * OPTIMISED: Results are cached for 30 minutes to avoid burning
     * QuotaGuard tokens on every 5-minute cron cycle. A health check
     * costs 1 proxy call (balances endpoint). At 12×/hour that was
     * ~8,640 calls/month — now reduced to ~1,440.
     */
    async checkHealth(): Promise<boolean> {
        // 1. Return cached result if still valid
        const cached = getCachedHealthStatus();
        if (cached) {
            console.log(`[RevolutX] Health Check: CACHED ✅ (${Math.round(cached.ageMs / 60000)}m old, TTL 30m). Skipping proxy call.`);
            return cached.healthy;
        }

        // 2. QuotaGuard budget check — health checks are non-essential reads
        if (this.proxyDispatcher && shouldSkipProxyCall('health_check')) {
            console.log('[RevolutX] Health Check: SKIPPED (QuotaGuard budget conservation). Assuming healthy.');
            return true;
        }

        try {
            console.log("[RevolutX] Health Check: Verifying Revolut API connectivity...");

            // Primary check: Can we reach Revolut?
            // We use a 30s timeout for the health check specifically to allow slow proxy handshakes.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            try {
                await this.request('GET', '/api/1.0/balances', null, controller.signal, 'health_check').catch(e => {
                    // 401/403 means we REACHED the server but auth failed, which is "Healthy" from a connectivity standpoint
                    const msg = e.message || String(e);
                    if (msg.includes('401') || msg.includes('403')) return 'auth_check';
                    throw e;
                });
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    throw new Error("Revolut Connectivity Timeout: The proxy/API failed to respond within 30 seconds. System might be severely throttled.");
                }
                throw e;
            } finally {
                clearTimeout(timeoutId);
            }

            // NOTE: getOutboundIp() has been REMOVED from health checks.
            // It was purely diagnostic (logs the proxy IP) but cost 1-2 extra
            // QuotaGuard tokens per check. IP can still be checked manually.

            // Cache successful result
            healthCacheResult = { healthy: true, checkedAt: Date.now() };
            console.log(`[RevolutX] Health Check: ✅ PASSED — cached for 30 minutes.`);
            return true;
        } catch (e: any) {
            // Cache failure too (but with shorter TTL — 5 min)
            healthCacheResult = { healthy: false, checkedAt: Date.now() - (HEALTH_CACHE_TTL_MS - 5 * 60 * 1000) };
            console.error(`[RevolutX] Health Check Failed: ${e.message}`);
            throw new Error(`Systemic Connectivity Failure: ${e.message}`);
        }
    }
}
