'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { type AssetClass, ARENA_THEME } from '@/lib/constants';

interface ArenaCard {
    assetClass: AssetClass;
    icon: string;
    label: string;
    subtitle: string;
    href: string;
    nav?: number;
    navPct?: number;
    currency: string;
    status: 'LIVE' | 'SANDBOX' | 'IDLE' | 'COMPLETE';
    day?: number;
}

interface Props {
    cards: ArenaCard[];
}

const STATUS_CONFIG = {
    LIVE: { dot: '#10b981', label: 'LIVE', shadow: '0 0 8px #10b981' },
    SANDBOX: { dot: '#f59e0b', label: 'SANDBOX', shadow: '0 0 8px #f59e0b' },
    IDLE: { dot: '#6b7280', label: 'IDLE', shadow: 'none' },
    COMPLETE: { dot: '#4ba3e3', label: 'COMPLETE', shadow: '0 0 8px #4ba3e3' },
};

export default function MissionSelector({ cards }: Props) {
    const router = useRouter();

    return (
        <div style={{ marginBottom: '28px' }}>
            <div style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: '#8a8f98',
                textTransform: 'uppercase',
                marginBottom: '12px',
            }}>
                ◈ Select Arena
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '12px',
            }}>
                {cards.map(card => {
                    const theme = ARENA_THEME[card.assetClass];
                    const status = STATUS_CONFIG[card.status];
                    const isPositive = (card.navPct ?? 0) >= 0;

                    return (
                        <div
                            key={card.assetClass}
                            onClick={() => router.push(card.href)}
                            style={{
                                background: 'rgba(18,19,24,0.5)',
                                backdropFilter: 'blur(16px)',
                                border: `1px solid ${theme.primary}33`,
                                borderRadius: '12px',
                                padding: '14px 16px',
                                cursor: 'pointer',
                                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                                boxShadow: `0 4px 16px rgba(0,0,0,0.25)`,
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                            onMouseEnter={e => {
                                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                                (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 28px rgba(0,0,0,0.35), 0 0 0 1px ${theme.primary}55, inset 0 0 40px ${theme.glow}`;
                                (e.currentTarget as HTMLDivElement).style.borderColor = `${theme.primary}66`;
                            }}
                            onMouseLeave={e => {
                                (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                                (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
                                (e.currentTarget as HTMLDivElement).style.borderColor = `${theme.primary}33`;
                            }}
                        >
                            {/* Glow backdrop */}
                            <div style={{
                                position: 'absolute', top: 0, right: 0, width: '60px', height: '60px',
                                background: `radial-gradient(circle at top right, ${theme.glow}, transparent 70%)`,
                                pointerEvents: 'none',
                            }} />

                            {/* Header row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '18px' }}>{card.icon}</span>
                                    <div>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: theme.primary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                            {card.label}
                                        </div>
                                        <div style={{ fontSize: '10px', color: '#8a8f98', marginTop: '1px' }}>{card.subtitle}</div>
                                    </div>
                                </div>

                                {/* Status badge */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <div style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: status.dot,
                                        boxShadow: status.shadow,
                                        animation: card.status === 'LIVE' ? 'blink 1.5s ease-in-out infinite' : 'none',
                                    }} />
                                    <span style={{ fontSize: '9px', fontWeight: 700, color: status.dot, letterSpacing: '0.08em' }}>
                                        {card.status === 'LIVE' && card.day ? `DAY ${card.day}` : status.label}
                                    </span>
                                </div>
                            </div>

                            {/* NAV row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: 700, color: '#e2e4e9' }}>
                                    {card.status === 'IDLE'
                                        ? <span style={{ color: '#8a8f98', fontSize: '11px' }}>Not initialised</span>
                                        : `${card.currency}${(card.nav ?? 0).toFixed(2)}`
                                    }
                                </div>
                                {card.status !== 'IDLE' && card.navPct !== undefined && (
                                    <div style={{
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        color: isPositive ? '#4caf50' : '#ff6659',
                                        background: isPositive ? 'rgba(76,175,80,0.1)' : 'rgba(255,102,89,0.1)',
                                        border: `1px solid ${isPositive ? 'rgba(76,175,80,0.3)' : 'rgba(255,102,89,0.3)'}`,
                                        borderRadius: '4px',
                                        padding: '1px 6px',
                                        fontFamily: 'JetBrains Mono, monospace',
                                    }}>
                                        {isPositive ? '+' : ''}{card.navPct.toFixed(2)}%
                                    </div>
                                )}
                            </div>

                            {/* Enter button */}
                            <div style={{
                                marginTop: '10px',
                                fontSize: '10px',
                                fontWeight: 600,
                                color: theme.primary,
                                letterSpacing: '0.06em',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}>
                                ENTER ARENA →
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
