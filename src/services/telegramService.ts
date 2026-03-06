/**
 * Telegram Notification Service
 * 
 * Sends real-time trade alerts to your phone via Telegram Bot API.
 * 
 * Setup:
 *   1. Message @BotFather on Telegram → /newbot → follow prompts
 *   2. Copy the bot token into TELEGRAM_BOT_TOKEN in .env.local
 *   3. Start a chat with your new bot, then visit:
 *      https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
 *      to find your chat_id. Copy it into TELEGRAM_CHAT_ID in .env.local
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

function isConfigured(): boolean {
    return !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

/** Escape HTML special characters for Telegram HTML mode. */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Send a raw message to Telegram (HTML parse mode).
 * Fire-and-forget — errors are logged but never thrown.
 */
async function sendMessage(text: string): Promise<void> {
    if (!isConfigured()) return;

    try {
        const res = await fetch(TELEGRAM_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            console.error(`[Telegram] Failed to send message (${res.status}):`, body);
        }
    } catch (e) {
        console.error('[Telegram] Network error:', e);
    }
}

/**
 * Format a dollar value with sign and 2dp.
 */
function fmtUSD(val: number): string {
    const sign = val >= 0 ? '+' : '';
    return `${sign}$${val.toFixed(2)}`;
}

/**
 * Format a percentage with sign and 1dp.
 */
function fmtPct(val: number): string {
    const sign = val >= 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}%`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface TradeAlert {
    ticker: string;
    type: 'BUY' | 'SELL' | string;
    amount: number;
    price: number;
    total: number;
    reason: string;
    pnl?: number;
    pnlPct?: number;
}

/**
 * Send trade notifications for all trades executed in this cycle.
 * Call this AFTER the atomic DB commit so we only notify on confirmed trades.
 */
export async function sendTradeAlerts(
    trades: TradeAlert[],
    portfolioValue: number,
    cashBalance: number,
): Promise<void> {
    if (!isConfigured() || trades.length === 0) return;

    for (const trade of trades) {
        const isBuy = trade.type === 'BUY';
        const icon = isBuy ? '🟢' : '🔴';
        const verb = isBuy ? 'BUY' : 'SELL';
        const pnlIcon = (trade.pnl ?? 0) >= 0 ? '✅' : '❌';

        let msg = `${icon} <b>${verb} EXECUTED</b>\n\n`;
        msg += `<b>Token:</b> ${trade.ticker}\n`;
        msg += `<b>Price:</b> $${trade.price.toFixed(trade.price < 1 ? 6 : 2)}\n`;
        msg += `<b>Amount:</b> ${trade.amount.toFixed(trade.amount < 0.01 ? 8 : 4)} ${trade.ticker}\n`;
        msg += `<b>Value:</b> $${trade.total.toFixed(2)}\n`;

        // P&L for sells
        if (!isBuy && trade.pnl !== undefined && trade.pnlPct !== undefined) {
            msg += `\n<b>P&amp;L:</b> ${fmtUSD(trade.pnl)} (${fmtPct(trade.pnlPct)}) ${pnlIcon}\n`;
        }

        msg += `\n📋 <b>Reason:</b> ${escapeHtml(trade.reason)}\n`;
        msg += `\n💼 <b>Portfolio:</b> $${portfolioValue.toFixed(2)} | Cash: $${cashBalance.toFixed(2)}`;

        await sendMessage(msg);
    }
}

/**
 * Send a critical emergency alert (stop-loss, circuit breaker, etc.)
 */
export async function sendEmergencyAlert(
    reason: string,
    peakValue?: number,
    currentValue?: number,
    drawdownPct?: number,
): Promise<void> {
    if (!isConfigured()) return;

    let msg = `🚨 <b>EMERGENCY ALERT</b> 🚨\n\n`;
    msg += `${reason}\n`;

    if (peakValue !== undefined && currentValue !== undefined) {
        msg += `\n<b>Peak Value:</b> $${peakValue.toFixed(2)}`;
        msg += `\n<b>Current Value:</b> $${currentValue.toFixed(2)}`;
    }
    if (drawdownPct !== undefined) {
        msg += `\n<b>Drawdown:</b> ${(drawdownPct * 100).toFixed(1)}%`;
    }

    msg += `\n\n⚠️ <i>Automation has been disabled. Manual review required.</i>`;

    await sendMessage(msg);
}

/**
 * Send a system-level autonomy notification.
 * Used for auto-profile switches, heartbeat warnings, compliance fixes, etc.
 */
export async function sendSystemAlert(
    title: string,
    body: string,
    icon: string = '🤖',
): Promise<void> {
    if (!isConfigured()) return;
    const msg = `${icon} <b>${escapeHtml(title)}</b>\n\n${body}`;
    await sendMessage(msg);
}

/**
 * Send trade notifications for Discovery Pool trades.
 * Similar to sendTradeAlerts but prefixed with pool identity.
 */
export async function sendPoolTradeAlerts(
    poolName: string,
    poolEmoji: string,
    trades: TradeAlert[],
    poolValue: number,
    poolCash: number,
): Promise<void> {
    if (!isConfigured() || trades.length === 0) return;

    for (const trade of trades) {
        const isBuy = trade.type === 'BUY';
        const icon = isBuy ? '🟢' : '🔴';
        const verb = isBuy ? 'BUY' : 'SELL';
        const pnlIcon = (trade.pnl ?? 0) >= 0 ? '✅' : '❌';

        let msg = `${poolEmoji} <b>[${poolName}]</b> ${icon} <b>${verb}</b>\n\n`;
        msg += `<b>Token:</b> ${trade.ticker}\n`;
        msg += `<b>Price:</b> $${trade.price.toFixed(trade.price < 1 ? 6 : 2)}\n`;
        msg += `<b>Value:</b> $${trade.total.toFixed(2)}\n`;

        if (!isBuy && trade.pnl !== undefined && trade.pnlPct !== undefined) {
            msg += `\n<b>P&amp;L:</b> ${fmtUSD(trade.pnl)} (${fmtPct(trade.pnlPct)}) ${pnlIcon}\n`;
        }

        msg += `\n📋 <b>Reason:</b> ${escapeHtml(trade.reason)}\n`;
        msg += `\n🧪 <b>Pool:</b> $${poolValue.toFixed(2)} | Cash: $${poolCash.toFixed(2)}`;

        await sendMessage(msg);
    }
}

