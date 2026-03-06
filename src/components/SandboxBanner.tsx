'use client';

import React, { useState } from 'react';
import { type AssetClass } from '@/lib/constants';
import { runSandboxArenaCycle, sandboxResetArena, activateSandboxCompetition } from '@/app/actions';
import { useAuth } from '@/context/AuthContext';

interface Props {
    assetClass: AssetClass;
    onCycleComplete?: () => void;
    onActivateCompetition?: () => void;
    isActivating?: boolean;
}

export default function SandboxBanner({ assetClass, onCycleComplete, onActivateCompetition, isActivating }: Props) {
    const { user } = useAuth();
    const [running, setRunning] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [lastResult, setLastResult] = useState<string | null>(null);

    const handleRunCycle = async () => {
        if (!user?.uid || running) return;
        setRunning(true);
        setLastResult(null);
        try {
            const result = await runSandboxArenaCycle(user.uid, assetClass);
            if (result.success) {
                setLastResult(`✓ Cycle complete — ${result.totalTrades} trade(s) executed`);
                onCycleComplete?.();
            } else {
                setLastResult(`⚠ Cycle finished with 0 trades (AI held positions)`);
            }

        } catch (e: any) {
            setLastResult(`✗ ${e.message}`);
        } finally {
            setRunning(false);
        }
    };

    const handleReset = async () => {
        if (!user?.uid || resetting) return;
        if (!confirm(`Reset ${assetClass} sandbox? This wipes all trades and holdings for this arena only.`)) return;
        setResetting(true);
        try {
            await sandboxResetArena(user.uid, assetClass);
            setLastResult('Sandbox reset complete.');
            onCycleComplete?.();
        } catch (e: any) {
            setLastResult(`Reset failed: ${e.message}`);
        } finally {
            setResetting(false);
        }
    };

    return (
        <div style={{
            background: 'rgba(245, 158, 11, 0.06)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
        }}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        background: 'rgba(245, 158, 11, 0.18)', border: '1px solid rgba(245, 158, 11, 0.4)',
                        borderRadius: '5px', padding: '2px 8px',
                        fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: '#f59e0b', textTransform: 'uppercase',
                    }}>
                        <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: '#f59e0b', boxShadow: '0 0 6px #f59e0b',
                            animation: 'blink 1.5s ease-in-out infinite', display: 'inline-block',
                        }} />
                        Sandbox
                    </span>
                    <span style={{ fontSize: '12px', color: '#8a8f98' }}>
                        {assetClass} Arena — virtual testing mode · No 28-day timer · Telegram silent
                    </span>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {/* Run Cycle Now — test button */}
                    <button
                        onClick={handleRunCycle}
                        disabled={running}
                        title="Manually trigger one full AI analysis + trading cycle (bypasses cron schedule)"
                        style={{
                            background: running ? 'rgba(75,163,227,0.08)' : 'rgba(75,163,227,0.12)',
                            border: '1px solid rgba(75,163,227,0.35)',
                            borderRadius: '6px', color: '#4ba3e3',
                            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
                            textTransform: 'uppercase', padding: '5px 12px',
                            cursor: running ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap', opacity: running ? 0.6 : 1, transition: 'all 0.2s',
                        }}
                    >
                        {running ? '⏳ Running…' : '▶ Run Cycle Now'}
                    </button>

                    {/* Reset */}
                    <button
                        onClick={handleReset}
                        disabled={resetting}
                        title="Reset sandbox data for this arena only — crypto arena is unaffected"
                        style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,102,89,0.3)',
                            borderRadius: '6px', color: '#ff6659',
                            fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
                            textTransform: 'uppercase', padding: '5px 12px',
                            cursor: resetting ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap', opacity: resetting ? 0.6 : 1, transition: 'all 0.2s',
                        }}
                    >
                        {resetting ? 'Resetting…' : '↺ Reset'}
                    </button>

                    {/* Activate Competition */}
                    {onActivateCompetition && (
                        <button
                            onClick={onActivateCompetition}
                            disabled={isActivating}
                            style={{
                                background: isActivating ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.15)',
                                border: '1px solid rgba(16,185,129,0.4)',
                                borderRadius: '6px', color: '#10b981',
                                fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em',
                                textTransform: 'uppercase', padding: '5px 12px',
                                cursor: isActivating ? 'not-allowed' : 'pointer',
                                whiteSpace: 'nowrap', opacity: isActivating ? 0.6 : 1, transition: 'all 0.2s',
                            }}
                        >
                            {isActivating ? 'Activating…' : '🏆 Activate Competition'}
                        </button>
                    )}
                </div>
            </div>

            {/* Result feedback */}
            {lastResult && (
                <div style={{
                    marginTop: '8px',
                    fontSize: '11px',
                    color: lastResult.startsWith('✓') ? '#4caf50' : lastResult.startsWith('✗') ? '#ff6659' : '#f59e0b',
                    fontFamily: 'monospace',
                }}>
                    {lastResult}
                </div>
            )}
        </div>
    );
}
