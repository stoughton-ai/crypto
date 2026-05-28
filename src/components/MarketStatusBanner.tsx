'use client';

import React, { useState, useEffect } from 'react';
import { type AssetClass } from '@/lib/constants';

interface Props {
    assetClass: AssetClass;
}

interface MarketInfo {
    isOpen: boolean;
    label: string;
    hours: string;
    timezone: string;
    nextEventLabel: string;   // e.g. "Opens in" or "Closes in"
    nextEventMs: number;      // ms until next open/close
    isWeekend: boolean;
}

// ─── Market hour helpers ────────────────────────────────────────────────────

/**
 * Returns whether a given UTC Date falls within FTSE (LSE) trading hours.
 * LSE: Mon–Fri, 08:00–16:30 UK time (Europe/London).
 * In 2026 BST starts 29 Mar, so March 8 = GMT (UTC+0).
 */
function getBSTOffset(date: Date): number {
    // UK BST: last Sunday in March → last Sunday in October
    const year = date.getUTCFullYear();
    // Last Sunday in March
    const marchEnd = new Date(Date.UTC(year, 2, 31));
    const bstStart = new Date(Date.UTC(year, 2, 31 - ((marchEnd.getUTCDay() + 6) % 7)));
    // Last Sunday in October
    const octEnd = new Date(Date.UTC(year, 9, 31));
    const bstEnd = new Date(Date.UTC(year, 9, 31 - ((octEnd.getUTCDay() + 6) % 7)));
    return date >= bstStart && date < bstEnd ? 60 : 0; // minutes
}

function getEDTOffsetHours(date: Date): number {
    // US DST: second Sunday in March → first Sunday in November
    const year = date.getUTCFullYear();
    // Second Sunday in March
    const march = new Date(Date.UTC(year, 2, 1));
    const dayOfWeek = march.getUTCDay();
    const firstSunMarch = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const dstStart = new Date(Date.UTC(year, 2, firstSunMarch + 7)); // +7 = second Sunday
    // First Sunday in November
    const nov = new Date(Date.UTC(year, 10, 1));
    const dayOfWeekNov = nov.getUTCDay();
    const firstSunNov = dayOfWeekNov === 0 ? 1 : 8 - dayOfWeekNov;
    const dstEnd = new Date(Date.UTC(year, 10, firstSunNov));
    // EST = UTC-5, EDT = UTC-4
    return date >= dstStart && date < dstEnd ? -4 : -5;
}

function getFTSEInfo(now: Date): MarketInfo {
    const bstOffset = getBSTOffset(now);
    const localMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + bstOffset;
    const dayOfWeek = now.getUTCDay(); // adjust for UK timezone day boundary edge case
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const openMin = 8 * 60;      // 08:00
    const closeMin = 16 * 60 + 30; // 16:30
    const isOpen = !isWeekend && localMinutes >= openMin && localMinutes < closeMin;

    let nextEventMs: number;
    let nextEventLabel: string;

    if (isOpen) {
        // ms until close
        const closeMs = closeMin * 60000 - (localMinutes * 60000 + now.getUTCSeconds() * 1000);
        nextEventMs = closeMs;
        nextEventLabel = 'Closes in';
    } else {
        // ms until next open (skip weekends)
        const secondsIntoDay = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) + bstOffset * 60;
        let daysToNext = 0;
        if (isWeekend) {
            daysToNext = dayOfWeek === 6 ? 2 : 1; // Sat → Mon, Sun → Mon
        } else if (localMinutes >= closeMin) {
            daysToNext = dayOfWeek === 5 ? 3 : 1; // Fri after close → Mon
        }
        const nextOpenSeconds = daysToNext * 86400 + openMin * 60 - secondsIntoDay;
        nextEventMs = Math.max(0, nextOpenSeconds * 1000);
        nextEventLabel = 'Opens in';
    }

    return {
        isOpen,
        label: 'London Stock Exchange',
        hours: '08:00 – 16:30',
        timezone: bstOffset ? 'BST' : 'GMT',
        nextEventLabel,
        nextEventMs,
        isWeekend,
    };
}

function getNYSEInfo(now: Date): MarketInfo {
    const etOffset = getEDTOffsetHours(now); // -4 or -5
    const localHours = now.getUTCHours() + etOffset;
    const localMinutes = localHours * 60 + now.getUTCMinutes();
    // Adjust day of week for ET (can cross midnight)
    const adjustedDate = new Date(now.getTime() + etOffset * 3600000);
    const dayOfWeek = adjustedDate.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const openMin = 9 * 60 + 30;  // 09:30
    const closeMin = 16 * 60;     // 16:00
    const isOpen = !isWeekend && localMinutes >= openMin && localMinutes < closeMin;

    let nextEventMs: number;
    let nextEventLabel: string;

    const secondsIntoDay = adjustedDate.getUTCHours() * 3600 + adjustedDate.getUTCMinutes() * 60 + adjustedDate.getUTCSeconds();

    if (isOpen) {
        const closeMs = closeMin * 60000 - (localMinutes * 60000 + now.getUTCSeconds() * 1000);
        nextEventMs = closeMs;
        nextEventLabel = 'Closes in';
    } else {
        let daysToNext = 0;
        if (isWeekend) {
            daysToNext = dayOfWeek === 6 ? 2 : 1;
        } else if (localMinutes >= closeMin) {
            daysToNext = dayOfWeek === 5 ? 3 : 1;
        }
        const nextOpenSeconds = daysToNext * 86400 + openMin * 60 - secondsIntoDay;
        nextEventMs = Math.max(0, nextOpenSeconds * 1000);
        nextEventLabel = 'Opens in';
    }

    const tzLabel = etOffset === -4 ? 'EDT' : 'EST';
    return {
        isOpen,
        label: 'New York Stock Exchange',
        hours: '09:30 – 16:00',
        timezone: tzLabel,
        nextEventLabel,
        nextEventMs,
        isWeekend,
    };
}

function getMarketInfo(assetClass: AssetClass, now: Date): MarketInfo | null {
    if (assetClass === 'CRYPTO') return null;
    if (assetClass === 'FTSE') return getFTSEInfo(now);
    if (assetClass === 'NYSE' || assetClass === 'COMMODITIES') return getNYSEInfo(now);
    return null;
}

function formatCountdown(ms: number): string {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (h > 0) return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    return `${pad(m)}m ${pad(s)}s`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MarketStatusBanner({ assetClass }: Props) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    // Crypto is 24/7 — no banner needed
    if (assetClass === 'CRYPTO') return null;

    const info = getMarketInfo(assetClass, now);
    if (!info) return null;

    const countdown = formatCountdown(info.nextEventMs);

    // ── Colours ──
    const openColor = '#10b981';
    const closedColor = '#ef4444';
    const weekendColor = '#6b7280';

    const activeColor = info.isOpen ? openColor : info.isWeekend ? weekendColor : closedColor;
    const bgColor = info.isOpen
        ? 'rgba(16,185,129,0.06)'
        : info.isWeekend
            ? 'rgba(107,114,128,0.06)'
            : 'rgba(239,68,68,0.06)';
    const borderColor = info.isOpen
        ? 'rgba(16,185,129,0.25)'
        : info.isWeekend
            ? 'rgba(107,114,128,0.25)'
            : 'rgba(239,68,68,0.25)';

    const statusText = info.isOpen
        ? 'MARKET OPEN'
        : info.isWeekend
            ? 'WEEKEND — CLOSED'
            : 'MARKET CLOSED';

    const statusEmoji = info.isOpen ? '🟢' : info.isWeekend ? '⚫' : '🔴';

    return (
        <div
            style={{
                background: bgColor,
                border: `1px solid ${borderColor}`,
                borderRadius: '10px',
                padding: '10px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
            }}
        >
            {/* Left: status pill + exchange info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {/* Animated status pill */}
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: `${activeColor}18`,
                        border: `1px solid ${activeColor}44`,
                        borderRadius: '6px',
                        padding: '3px 10px',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        color: activeColor,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {/* Pulsing dot — only when open */}
                    <span
                        style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: activeColor,
                            boxShadow: info.isOpen ? `0 0 6px ${activeColor}` : 'none',
                            display: 'inline-block',
                            animation: info.isOpen ? 'blink 1.5s ease-in-out infinite' : 'none',
                            flexShrink: 0,
                        }}
                    />
                    {statusText}
                </span>

                {/* Exchange info */}
                <span style={{ fontSize: '12px', color: '#8a8f98' }}>
                    {info.label} · {info.hours} {info.timezone}
                </span>
            </div>

            {/* Right: countdown */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexShrink: 0,
                }}
            >
                <span
                    style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#8a8f98',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                    }}
                >
                    {info.isWeekend
                        ? `Opens Mon in`
                        : info.nextEventLabel
                    }
                </span>
                <span
                    style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: activeColor,
                        background: `${activeColor}12`,
                        border: `1px solid ${activeColor}30`,
                        borderRadius: '5px',
                        padding: '2px 10px',
                        letterSpacing: '0.05em',
                    }}
                >
                    {info.isWeekend && info.nextEventMs > 2 * 86400 * 1000
                        ? '—'
                        : countdown
                    }
                </span>
            </div>
        </div>
    );
}
