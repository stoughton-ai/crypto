'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  Legend,
} from 'recharts';
import {
  getArenaStatus,
  refreshArenaPrices,
  getGranularPriceMovements,
  getUnifiedAuditTrail,
  getRealizedLedger,
  runVirtualBacktest,
  toggleLiveTrading,
} from '@/app/actions';

import { useAuth } from '@/context/AuthContext';

export default function VirtualArenaDashboard({ userId: userIdProp }: { userId?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const userId = userIdProp || user?.uid || '';

  const [data, setData] = useState<any>(null);
  const [prices, setPrices] = useState<any>({});
  const [movements, setMovements] = useState<any>(null);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'terminal' | 'log'>('terminal');
  const [tickerFilter, setTickerFilter] = useState<'ALL' | 'XRP' | 'AAVE'>('ALL');
  const [backtestTicker, setBacktestTicker] = useState<'XRP' | 'AAVE'>('XRP');
  const [backtestBuyThreshold, setBacktestBuyThreshold] = useState<number>(70);
  const [backtestExitThreshold, setBacktestExitThreshold] = useState<number>(40);
  const [backtestStopLoss, setBacktestStopLoss] = useState<number>(-5);
  const [backtestTakeProfit, setBacktestTakeProfit] = useState<number>(4);
  const [backtestDays, setBacktestDays] = useState<number>(7);
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestError, setBacktestError] = useState<string>('');
  const [showLiveWarningModal, setShowLiveWarningModal] = useState<boolean>(false);
  const [liveConfirmText, setLiveConfirmText] = useState<string>('');
  const [switchingLiveMode, setSwitchingLiveMode] = useState<boolean>(false);
  const [switcherError, setSwitcherError] = useState<string>('');

  const loadData = useCallback(async () => {
    try {
      const [statusRes, pricesRes, moveRes, auditRes, ledgerRes] = await Promise.all([
        getArenaStatus(userId, 'CRYPTO'),
        refreshArenaPrices(userId, 'CRYPTO'),
        getGranularPriceMovements(['XRP', 'AAVE']),
        getUnifiedAuditTrail(userId),
        getRealizedLedger(userId)
      ]);
      setData(statusRes);
      setPrices(pricesRes);
      setMovements(moveRes);
      setAuditEvents(auditRes || []);
      setLedger(ledgerRes || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    loadData();
    const interval = setInterval(loadData, 15 * 1000); // refresh every 15s for real-time audit updates
    return () => clearInterval(interval);
  }, [loadData, userId]);

  if (loading) {
    return <div className="p-8 text-center text-white/50 animate-pulse">Loading Virtual Arena...</div>;
  }

  const arena = data?.arena;
  const sharedCash = arena?.sharedCash ?? 0;
  
  // NAV calculation
  let holdingsValue = 0;
  arena?.pools?.forEach((p: any) => {
    Object.entries(p.holdings || {}).forEach(([ticker, h]: [string, any]) => {
      const livePrice = prices[ticker.toUpperCase()]?.price || h.averagePrice || 0;
      holdingsValue += (h.amount || 0) * livePrice;
    });
  });
  const totalNav = sharedCash + holdingsValue;
  const budget = arena?.totalBudget || 1050;
  const navPct = ((totalNav - budget) / budget) * 100;

  const intervals = [5, 15, 30, 60, 180, 360, 720, 1440];
  const formatMins = (m: number) => {
    if (m < 60) return `${m}m`;
    if (m === 1440) return `24h`;
    return `${m/60}h`;
  };

  const parseDebate = (event: any) => {
    const rawDesc = event.description || '';
    let traderThesis = rawDesc;
    let supervisorVerdict: 'AGREE' | 'DISAGREE' | 'MODIFY' = 'AGREE';
    let supervisorReasoning = 'Approved and validated.';

    if (event.type === 'ALERT' && event.title?.includes('SUPERVISOR VETO')) {
      const token = event.title.split(': ')[1]?.split(' ')[0] || 'Asset';
      traderThesis = `Proposed purchase of ${token} scaled dynamically according to high-conviction momentum indicators.`;
      supervisorVerdict = 'DISAGREE';
      const match = rawDesc.match(/Reasoning: "(.*?)"/);
      supervisorReasoning = match ? match[1] : rawDesc;
    } else if (rawDesc.includes(' | Supervisor [')) {
      const parts = rawDesc.split(' | Supervisor [');
      traderThesis = parts[0];
      const supPart = parts[1];
      if (supPart.startsWith('AGREE]')) {
        supervisorVerdict = 'AGREE';
        supervisorReasoning = supPart.replace('AGREE]: ', '');
      } else if (supPart.startsWith('MODIFY]')) {
        supervisorVerdict = 'MODIFY';
        supervisorReasoning = supPart.replace('MODIFY]: ', '');
      } else if (supPart.startsWith('DISAGREE]')) {
        supervisorVerdict = 'DISAGREE';
        supervisorReasoning = supPart.replace('DISAGREE]: ', '');
      }
    } else if (event.type === 'TRADE' && event.severity === 'WARNING') {
      traderThesis = `Exit target or defensive Stop-Loss triggered for liquidity consolidation.`;
      supervisorVerdict = 'AGREE';
      supervisorReasoning = event.description || 'Liquidating position to lock in virtual returns.';
    }

    return { traderThesis, supervisorVerdict, supervisorReasoning };
  };

  const filteredEvents = auditEvents.filter(event => {
    if (tickerFilter === 'ALL') return true;
    const titleUpper = (event.title || '').toUpperCase();
    const descUpper = (event.description || '').toUpperCase();
    return titleUpper.includes(tickerFilter) || descUpper.includes(tickerFilter);
  });
  const handleRunBacktest = async () => {
    setBacktestLoading(true);
    setBacktestError('');
    setBacktestResult(null);
    try {
      const res = await runVirtualBacktest(
        backtestTicker,
        backtestBuyThreshold,
        backtestExitThreshold,
        backtestStopLoss,
        backtestTakeProfit,
        backtestDays
      );
      if (res.success) {
        setBacktestResult(res);
      } else {
        setBacktestError(res.error || 'Backtest execution failed.');
      }
    } catch (e: any) {
      setBacktestError(e.message || 'An unexpected error occurred during backtesting.');
    } finally {
      setBacktestLoading(false);
    }
  };

  const handleToggleLive = async (targetEnabled: boolean) => {
    setSwitchingLiveMode(true);
    setSwitcherError('');
    try {
      const res = await toggleLiveTrading(userId, targetEnabled);
      if (res.success) {
        setShowLiveWarningModal(false);
        setLiveConfirmText('');
        await loadData();
      } else {
        setSwitcherError(res.message || 'Failed to update live trading mode.');
      }
    } catch (e: any) {
      setSwitcherError(e.message || 'An unexpected error occurred.');
    } finally {
      setSwitchingLiveMode(false);
    }
  };


  return (
    <div className="min-h-screen bg-[#09090b] text-white p-4 md:p-8 font-mono">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/50">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold tracking-widest text-white flex items-center gap-2">
                {arena?.realTradingEnabled ? 'Real Trading Profit Arena' : 'Virtual Profit Arena'}
              </h1>
              <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-wider ${
                arena?.realTradingEnabled
                  ? 'bg-red-500/10 text-red-400 border border-red-500/30 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.15)]'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
              }`}>
                {arena?.realTradingEnabled ? '🔴 LIVE CAPITAL' : '🟢 VIRTUAL SANDBOX'}
              </span>
            </div>
            <p className="text-zinc-400 mt-2 text-sm max-w-xl font-mono leading-relaxed">
              Fully autonomous, high-frequency AI execution.
              {arena?.realTradingEnabled && (
                <span className="block text-red-400 font-bold mt-1 animate-pulse">🚨 WARNING: AI is executing live trades using Revolut X funds.</span>
              )}
              <br />
              Circuit breakers active at 10% (24h) and 25% (72h).
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center bg-black/40 p-4 rounded-xl border border-white/5 w-full lg:w-auto justify-between lg:justify-end">
            <div className="flex gap-6 items-end justify-between sm:justify-start">
              <div>
                <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider font-semibold">Net Asset Value</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">${totalNav.toFixed(2)}</span>
                  <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${navPct >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {navPct > 0 ? '+' : ''}{navPct.toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="w-px h-10 bg-zinc-800"></div>
              <div>
                <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider font-semibold">Available Cash</p>
                <span className="text-xl text-zinc-300">${sharedCash.toFixed(2)}</span>
              </div>
            </div>

            <div className="w-px h-10 bg-zinc-800 hidden sm:block"></div>

            <button
              onClick={() => {
                if (arena?.realTradingEnabled) {
                  // Switch off live mode doesn't need confirmation
                  handleToggleLive(false);
                } else {
                  // Switch ON live mode requires the high-friction double confirmation
                  setShowLiveWarningModal(true);
                }
              }}
              disabled={switchingLiveMode}
              className={`px-4 py-3 rounded-lg font-black text-xs uppercase tracking-widest transition-all duration-300 shadow-md ${
                arena?.realTradingEnabled
                  ? 'bg-zinc-900 hover:bg-zinc-850 text-zinc-400 border border-zinc-800 hover:text-zinc-200'
                  : 'bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.2)]'
              }`}
            >
              {switchingLiveMode ? 'SYNCING...' : arena?.realTradingEnabled ? '🛑 GO SANDBOX' : '⚡ GO LIVE'}
            </button>
          </div>
        </header>

        {/* 📡 AI Sentiment & Narrative Terminal */}
        {data?.sentiment && (
          <section className="bg-zinc-900/40 rounded-2xl border border-zinc-800/50 overflow-hidden backdrop-blur-sm shadow-2xl relative">
            <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center bg-black/20">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">📡</span> AI Sentiment & Narrative Terminal
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-mono">UPDATED: {new Date(data.sentiment.updatedAt).toLocaleTimeString()}</span>
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
              </div>
            </div>
            
            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left Column: Sentiment Score Gauge */}
              <div className="lg:col-span-4 bg-black/30 border border-zinc-800/60 rounded-xl p-5 flex flex-col justify-between items-center text-center relative overflow-hidden group shadow-inner">
                {/* Glow behind score */}
                <div className={`absolute -inset-10 opacity-10 blur-2xl rounded-full transition-all duration-1000 ${
                  data.sentiment.narrativeMode === 'BULLISH_FOMO' ? 'bg-emerald-500 group-hover:opacity-20' :
                  data.sentiment.narrativeMode === 'FUD_ALERT' ? 'bg-amber-500 group-hover:opacity-20' :
                  data.sentiment.narrativeMode === 'MACRO_DANGEROUS' ? 'bg-red-500 group-hover:opacity-20' :
                  'bg-zinc-500 group-hover:opacity-20'
                }`}></div>

                <div className="relative z-10 w-full">
                  <span className="text-xs text-zinc-500 uppercase tracking-widest font-bold block mb-1">Global Sentiment Index</span>
                  <span className={`text-6xl font-black tracking-tighter filter drop-shadow-[0_0_15px_rgba(255,255,255,0.15)] ${
                    data.sentiment.score >= 60 ? 'text-emerald-400' :
                    data.sentiment.score >= 35 ? 'text-zinc-300' :
                    data.sentiment.score >= 20 ? 'text-amber-400' : 'text-red-400'
                  }`}>{data.sentiment.score}<span className="text-2xl text-zinc-600">/100</span></span>
                </div>

                <div className="relative z-10 w-full mt-4">
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden flex p-0.5 border border-zinc-700">
                    <div 
                      className={`h-full rounded-full transition-all duration-1000 ${
                        data.sentiment.score >= 60 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                        data.sentiment.score >= 35 ? 'bg-gradient-to-r from-zinc-600 to-zinc-400 shadow-[0_0_8px_rgba(161,161,170,0.5)]' :
                        'bg-gradient-to-r from-red-600 to-amber-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                      }`}
                      style={{ width: `${data.sentiment.score}%` }}
                    ></div>
                  </div>
                </div>

                <div className="relative z-10 w-full mt-4">
                  <span className="text-xs text-zinc-500 uppercase tracking-widest block mb-2 font-bold">Narrative Mode</span>
                  <span className={`px-3 py-1.5 rounded-lg border font-black tracking-widest text-xs uppercase inline-block shadow-md ${
                    data.sentiment.narrativeMode === 'BULLISH_FOMO' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' :
                    data.sentiment.narrativeMode === 'NEUTRAL' ? 'border-zinc-700 bg-zinc-800/30 text-zinc-400' :
                    data.sentiment.narrativeMode === 'FUD_ALERT' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.15)]' :
                    'border-red-500/30 bg-red-500/10 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.15)] animate-pulse'
                  }`}>{data.sentiment.narrativeMode.replace('_', ' ')}</span>
                </div>
              </div>

              {/* Middle Column: Reflection */}
              <div className="lg:col-span-4 bg-zinc-950/60 border border-zinc-800/60 rounded-xl p-5 flex flex-col justify-between relative overflow-hidden font-mono">
                <div className="relative z-10">
                  <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 mb-3">
                    <span className="text-teal-400 font-bold text-xs uppercase tracking-wider">[🎙️ Chief Sentiment Architect]</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed font-mono italic">
                    "{data.sentiment.reflection}"
                  </p>
                </div>
                <div className="text-[10px] text-zinc-500 mt-4 border-t border-zinc-900 pt-2 font-bold">
                  SYS: CONSENSUS GROUNDS TRADER & SUPERVISOR IN REAL-TIME
                </div>
              </div>

              {/* Right Column: News Ticker / Headlines */}
              <div className="lg:col-span-4 bg-black/30 border border-zinc-800/60 rounded-xl p-5 flex flex-col justify-between overflow-hidden relative">
                <div>
                  <span className="text-xs text-zinc-500 uppercase tracking-widest font-bold block mb-3 border-b border-zinc-800 pb-2">📰 Live News Feed Scrape</span>
                  <div className="space-y-3 max-h-[160px] overflow-y-auto custom-scrollbar font-mono text-xs pr-1">
                    {data.sentiment.headlines?.map((h: any, idx: number) => (
                      <div key={idx} className="flex gap-2.5 items-start p-2 rounded bg-black/50 border border-white/5 hover:border-zinc-800 transition-colors">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shrink-0 mt-0.5 ${
                          h.sentiment === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]' :
                          h.sentiment === 'FUD' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                          'bg-zinc-850 text-zinc-400 border border-zinc-700/30'
                        }`}>{h.sentiment}</span>
                        <p className="text-[11px] text-zinc-300 leading-tight">{h.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* High-Frequency Momentum Matrix */}
        <section className="bg-zinc-900/40 rounded-2xl border border-zinc-800/50 overflow-hidden backdrop-blur-sm">
          <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center bg-black/20">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">📊</span> High-Frequency Momentum Matrix
            </h2>
            <span className="text-xs text-zinc-500">Updates every 3m (5m candles)</span>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800/50">
                  <th className="pb-3 pl-2 font-medium">Asset</th>
                  <th className="pb-3 pr-4 font-medium text-right">Price</th>
                  {intervals.map(m => (
                    <th key={m} className="pb-3 text-right font-medium">{formatMins(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/30">
                {['XRP', 'AAVE'].map(ticker => {
                  const moves = movements?.[ticker] || {};
                  return (
                    <tr key={ticker} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-4 pl-2 font-bold text-base flex items-center gap-2">
                        {ticker === 'XRP' ? '🦅' : '👻'} {ticker}
                      </td>
                      <td className="py-4 pr-4 text-right text-zinc-200 font-medium whitespace-nowrap">
                        ${prices[ticker]?.price ? (prices[ticker].price < 10 ? prices[ticker].price.toFixed(4) : prices[ticker].price.toFixed(2)) : '0.00'}
                      </td>
                      {intervals.map(m => {
                        const val = moves[m] || 0;
                        const isPos = val > 0;
                        const isNeg = val < 0;
                        // Opacity scaling based on magnitude
                        const mag = Math.min(Math.abs(val) * 10, 100);
                        return (
                          <td key={m} className="py-4 text-right font-medium">
                            <span className={`
                              ${isPos ? 'text-emerald-400' : isNeg ? 'text-red-400' : 'text-zinc-500'}
                            `} style={{ opacity: Math.max(mag / 100, 0.4) }}>
                              {val > 0 ? '+' : ''}{val.toFixed(2)}%
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Current Positions */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {arena?.pools?.map((pool: any) => {
            const hKeys = Object.keys(pool.holdings || {});
            const hasHoldings = hKeys.length > 0;
            return (
              <div key={pool.poolId} className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-5 hover:border-zinc-700/50 transition-colors relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <span className="text-6xl">{pool.emoji}</span>
                </div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-white/90">{pool.name}</h3>
                    <p className="text-xs text-zinc-500 uppercase tracking-widest mt-1">{pool.strategy.strategyPersonality} TRADER</p>
                  </div>
                </div>
                
                {!hasHoldings ? (
                  <div className="h-24 flex items-center justify-center border border-dashed border-zinc-800 rounded-xl bg-black/20">
                    <span className="text-zinc-600 text-sm italic">Scanning for entry...</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hKeys.map(k => {
                      const h = pool.holdings[k];
                      const liveP = prices[k.toUpperCase()]?.price || h.averagePrice;
                      const curVal = h.amount * liveP;
                      return (
                        <div key={k} className="flex justify-between items-center p-3 rounded-xl bg-black/40 border border-white/5">
                          <div className="flex flex-col">
                            <span className="font-bold">{k}</span>
                            <span className="text-xs text-zinc-500">{h.amount.toFixed(4)} tokens</span>
                          </div>
                          <div className="text-right flex flex-col">
                            <span className="text-zinc-300">${curVal.toFixed(2)}</span>
                            <span className="text-xs text-emerald-400">Avg: ${h.averagePrice.toFixed(4)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Unified Audit Trail & Debate Terminal */}
        <section className="bg-zinc-900/40 rounded-2xl border border-zinc-800/50 overflow-hidden flex flex-col h-[600px] backdrop-blur-sm shadow-2xl">
          <div className="p-4 border-b border-zinc-800/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-black/20 sticky top-0 z-10">
            <div className="flex flex-wrap items-center gap-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">📜</span> AI Decision Audit Trail
              </h2>
              <div className="flex rounded-lg border border-zinc-800 overflow-hidden text-xs bg-zinc-950 p-0.5">
                <button
                  onClick={() => setActiveTab('terminal')}
                  className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                    activeTab === 'terminal'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  🛡️ AI Debate Terminal
                </button>
                <button
                  onClick={() => setActiveTab('log')}
                  className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                    activeTab === 'log'
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  📋 Unified Log
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Asset Filter:</span>
                <select
                  value={tickerFilter}
                  onChange={(e: any) => setTickerFilter(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500"
                >
                  <option value="ALL">ALL ASSETS</option>
                  <option value="XRP">XRP ONLY</option>
                  <option value="AAVE">AAVE ONLY</option>
                </select>
              </div>

              <button onClick={loadData} className="text-xs bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Refresh
              </button>
            </div>
          </div>
          
          {activeTab === 'terminal' ? (
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6 bg-black/90 relative border border-zinc-900 shadow-[inset_0_0_30px_rgba(245,158,11,0.02)]">
              {/* Terminal retro monitor overlay */}
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%] opacity-15"></div>

              {filteredEvents.length === 0 ? (
                <div className="text-center text-zinc-600 py-10 italic font-mono text-xs">[SYSTEM STATUS] No telemetry logs recorded for this asset configuration.</div>
              ) : (
                <div className="space-y-6 max-w-4xl mx-auto font-mono">
                  {filteredEvents.map((event, i) => {
                    if (event.type === 'HEARTBEAT') {
                      return (
                        <div key={event.id || i} className="font-mono text-xs border border-zinc-800/40 rounded-lg p-3 bg-zinc-900/30 text-emerald-500/80 shadow-[0_0_10px_rgba(16,185,129,0.02)]">
                          <span className="text-zinc-500">[{new Date(event.timestamp).toLocaleTimeString()}]</span> telemetry-check: OK -- {event.description}
                        </div>
                      )
                    }

                    const { traderThesis, supervisorVerdict, supervisorReasoning } = parseDebate(event);
                    const isBuy = event.title?.includes('BUY') || event.title?.includes('Buy');

                    return (
                      <div key={event.id || i} className="border border-zinc-800/80 rounded-xl overflow-hidden shadow-2xl bg-zinc-950/60 backdrop-blur-md">
                        {/* Header bar */}
                        <div className="bg-zinc-900/40 p-3 border-b border-zinc-800/80 flex items-center justify-between text-xs font-semibold text-zinc-400">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full animate-pulse ${
                              supervisorVerdict === 'DISAGREE' ? 'bg-red-500' :
                              supervisorVerdict === 'MODIFY' ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}></span>
                            <span>CONSENSUS AUDIT: {event.title}</span>
                          </div>
                          <time className="text-zinc-500">{new Date(event.timestamp).toLocaleTimeString()}</time>
                        </div>

                        {/* Content panel */}
                        <div className="p-4 space-y-4 font-mono text-xs leading-relaxed">
                          
                          {/* Trader Section */}
                          <div className="border-l-2 border-teal-500/50 pl-3 py-1 space-y-1 bg-teal-500/[0.01]">
                            <span className="text-teal-400 font-bold uppercase tracking-wider block text-[10px]">[🧠 AI TRADER THESIS]</span>
                            <p className="text-zinc-300">{traderThesis}</p>
                          </div>

                          {/* Supervisor Section */}
                          <div className={`border-l-2 pl-3 py-1 space-y-1 bg-amber-500/[0.01] ${
                            supervisorVerdict === 'DISAGREE' ? 'border-red-500/50 bg-red-500/[0.01]' : 'border-amber-500/50'
                          }`}>
                            <span className={`font-bold uppercase tracking-wider block text-[10px] ${
                              supervisorVerdict === 'DISAGREE' ? 'text-red-400' : 'text-amber-400'
                            }`}>
                              [🛡️ AI RISK SUPERVISOR REPORT]
                            </span>
                            <p className="text-zinc-300">{supervisorReasoning}</p>
                          </div>

                          {/* Visual Neon Verdict Seal */}
                          <div className="pt-2 flex justify-end">
                            <div className={`px-4 py-1.5 rounded border text-[10px] font-bold tracking-widest uppercase shadow-md ${
                              supervisorVerdict === 'AGREE' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' :
                              supervisorVerdict === 'MODIFY' ? 'border-amber-500/40 bg-amber-500/10 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.1)]' :
                              'border-red-500/40 bg-red-500/10 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                            }`}>
                              STATUS: {
                                supervisorVerdict === 'AGREE' ? (isBuy ? 'APPROVED & EXECUTED' : 'EXIT COMPLETED') :
                                supervisorVerdict === 'MODIFY' ? 'RESIZED & EXECUTED' : 'VETOED & BLOCKED'
                              }
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-6">
              {filteredEvents.length === 0 ? (
                <div className="text-center text-zinc-500 py-10 italic">No events recorded yet.</div>
              ) : (
                <div className="relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-800 before:to-transparent">
                  {filteredEvents.map((event, i) => (
                    <div key={event.id || i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active mb-8">
                      <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-[#09090b] shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2
                        ${
                          event.type === 'TRADE' ? (event.severity === 'INFO' ? 'bg-emerald-500' : 'bg-amber-500') : 
                          event.type === 'HEARTBEAT' ? 'bg-blue-500' :
                          'bg-red-500'
                        }
                      `}>
                        <span className="text-white text-xs">
                          {event.type === 'TRADE' ? (event.severity === 'INFO' ? 'B' : 'S') : 
                           event.type === 'HEARTBEAT' ? '🧠' : '!'}
                        </span>
                      </div>
                      
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-zinc-800/50 bg-black/40 shadow-xl group-hover:border-zinc-700/50 transition-colors">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className={`font-bold text-sm ${
                            event.type === 'ALERT' ? 'text-red-400' : 
                            event.type === 'HEARTBEAT' ? 'text-blue-400' :
                            (event.severity === 'INFO' ? 'text-emerald-400' : 'text-amber-400')
                          }`}>
                            {event.title}
                          </h4>
                          <time className="text-xs text-zinc-500">{new Date(event.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</time>
                        </div>
                        <p className="text-sm text-zinc-400 leading-relaxed">
                          {event.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 🧪 What-If Strategy Lab */}
        <section className="bg-zinc-900/40 rounded-2xl border border-zinc-800/50 overflow-hidden flex flex-col backdrop-blur-sm shadow-2xl">
          <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center bg-black/20">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">🧪</span> AI "What-If" Strategy Lab
            </h2>
            <span className="text-xs text-zinc-500 font-mono">[MODE: BACKTEST SANDBOX]</span>
          </div>

          <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Controllers */}
            <div className="space-y-6 bg-black/30 p-6 rounded-xl border border-zinc-800/80 flex flex-col justify-between">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-amber-400 tracking-wider uppercase border-b border-zinc-800 pb-2">Configure Strategy</h3>
                
                {/* Ticker & Duration */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-zinc-500">Asset:</span>
                    <select
                      value={backtestTicker}
                      onChange={(e: any) => setBacktestTicker(e.target.value)}
                      className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 font-bold"
                    >
                      <option value="XRP">🦅 XRP</option>
                      <option value="AAVE">👻 AAVE</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-zinc-500">Duration:</span>
                    <select
                      value={backtestDays}
                      onChange={(e: any) => setBacktestDays(Number(e.target.value))}
                      className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-500 font-bold"
                    >
                      <option value={3}>3 Days</option>
                      <option value={7}>7 Days</option>
                    </select>
                  </div>
                </div>

                {/* Buy Threshold */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-400">Buy Threshold Score:</span>
                    <span className="text-amber-400 font-bold">{backtestBuyThreshold}+</span>
                  </div>
                  <input
                    type="range"
                    min="55"
                    max="85"
                    value={backtestBuyThreshold}
                    onChange={(e: any) => setBacktestBuyThreshold(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-850 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                {/* Exit Threshold */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-400">Exit Threshold Score:</span>
                    <span className="text-amber-400 font-bold">&lt; {backtestExitThreshold}</span>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="50"
                    value={backtestExitThreshold}
                    onChange={(e: any) => setBacktestExitThreshold(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-850 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                {/* Stop Loss */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-400">Defensive Stop-Loss:</span>
                    <span className="text-red-400 font-bold">{backtestStopLoss}%</span>
                  </div>
                  <input
                    type="range"
                    min="-15"
                    max="-2"
                    value={backtestStopLoss}
                    onChange={(e: any) => setBacktestStopLoss(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-850 rounded-lg appearance-none cursor-pointer accent-red-500"
                  />
                </div>

                {/* Take Profit */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-zinc-400">Take-Profit Target:</span>
                    <span className="text-emerald-400 font-bold">+{backtestTakeProfit}%</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="15"
                    value={backtestTakeProfit}
                    onChange={(e: any) => setBacktestTakeProfit(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-850 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              </div>

              {backtestError && (
                <div className="text-red-400 text-xs font-mono p-3 bg-red-500/10 border border-red-500/20 rounded-lg my-2">
                  [ERROR]: {backtestError}
                </div>
              )}

              <button
                onClick={handleRunBacktest}
                disabled={backtestLoading}
                className="w-full font-bold text-xs uppercase tracking-widest text-zinc-950 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(245,158,11,0.2)] hover:shadow-[0_0_20px_rgba(245,158,11,0.45)] cursor-pointer mt-4"
              >
                {backtestLoading ? '⌛ Running Simulation...' : '🚀 Run Backtest'}
              </button>
            </div>

            {/* Visual Chart & Stats Display */}
            <div className="lg:col-span-2 flex flex-col justify-between space-y-6">
              {backtestResult ? (
                <>
                  {/* Mini Stats Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-zinc-950 p-4 border border-zinc-800/80 rounded-xl">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Strategy Return</span>
                      <span className={`text-lg font-bold ${backtestResult.stats.strategyReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {backtestResult.stats.strategyReturnPct >= 0 ? '+' : ''}{backtestResult.stats.strategyReturnPct}%
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Buy-and-Hold Return</span>
                      <span className={`text-lg font-bold ${backtestResult.stats.baselineReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {backtestResult.stats.baselineReturnPct >= 0 ? '+' : ''}{backtestResult.stats.baselineReturnPct}%
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Win Rate (Trades)</span>
                      <span className="text-lg font-bold text-zinc-200">
                        {backtestResult.stats.winRatePct}% <span className="text-xs text-zinc-500">({backtestResult.stats.totalTrades} T)</span>
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Outperformance</span>
                      <span className={`text-lg font-bold ${backtestResult.stats.outperformancePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {backtestResult.stats.outperformancePct >= 0 ? '+' : ''}{backtestResult.stats.outperformancePct}%
                      </span>
                    </div>
                  </div>

                  {/* Recharts Comparison Graph */}
                  <div className="h-[250px] w-full relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={backtestResult.series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1c1917" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: '#555', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={{ stroke: '#272a35' }} />
                        <YAxis tick={{ fill: '#555', fontSize: 9, fontFamily: 'monospace' }} tickLine={false} axisLine={false} domain={['dataMin - 10', 'dataMax + 10']} />
                        <ChartTooltip contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontSize: 10, fontFamily: 'monospace' }} />
                        <Legend wrapperStyle={{ fontSize: 9, fontFamily: 'monospace', paddingTop: 10 }} />
                        
                        <Line type="monotone" name="AI Strategy NAV" dataKey="strategyNav" stroke="#f59e0b" strokeWidth={2.5} dot={false} activeDot={{ r: 6 }} />
                        <Line type="monotone" name="Baseline Buy-and-Hold" dataKey="baselineNav" stroke="#6b7280" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-xl p-10 text-center text-zinc-500 font-mono text-xs space-y-2 min-h-[300px]">
                  <span>[SYSTEM READY]</span>
                  <span>Configure your risk limits and click "Run Backtest" to generate comparative simulation metrics.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Realized Profit / Loss Ledger */}
        <section className="bg-zinc-900/40 rounded-2xl border border-zinc-800/50 overflow-hidden">
          <div className="p-4 border-b border-zinc-800/50 bg-black/20">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">💰</span> Realized Profit / Loss Ledger
            </h2>
          </div>
          <div className="p-0 overflow-x-auto">
            {ledger.length === 0 ? (
              <div className="text-center text-zinc-500 py-10 italic">No closed trades yet. Ledger is clean.</div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800/50">
                    <th className="py-4 pl-6 font-medium">Date & Time</th>
                    <th className="py-4 font-medium">Asset</th>
                    <th className="py-4 text-right font-medium">Size</th>
                    <th className="py-4 text-right font-medium">Sell Price</th>
                    <th className="py-4 pr-6 text-right font-medium">Realized P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {ledger.map(trade => {
                    const isWin = (trade.pnlPct || 0) > 0;
                    const isLoss = (trade.pnlPct || 0) < 0;
                    return (
                      <tr key={trade.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-4 pl-6 text-zinc-400 whitespace-nowrap">
                          {new Date(trade.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="py-4 font-bold flex items-center gap-2">
                          {trade.ticker === 'XRP' ? '🦅' : trade.ticker === 'AAVE' ? '👻' : ''} {trade.ticker}
                        </td>
                        <td className="py-4 text-right text-zinc-300">
                          {trade.amount.toFixed(2)}
                        </td>
                        <td className="py-4 text-right text-zinc-300">
                          ${trade.price.toFixed(4)}
                        </td>
                        <td className={`py-4 pr-6 text-right font-bold ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-zinc-500'}`}>
                          {trade.pnlPct !== undefined ? `${isWin ? '+' : ''}${trade.pnlPct.toFixed(2)}%` : 'N/A'}
                          <span className="block text-xs opacity-70 font-normal">
                            {trade.pnl !== undefined ? `$${trade.pnl.toFixed(2)}` : ''}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {/* 🚨 Double Confirmation Live Mode Modal */}
        {showLiveWarningModal && (
          <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in font-mono">
            <div className="bg-[#0c0c0e] border-2 border-red-500/50 rounded-2xl max-w-lg w-full overflow-hidden shadow-[0_0_50px_rgba(239,68,68,0.25)] relative">
              <div className="absolute top-0 inset-x-0 h-1.5 bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse"></div>
              
              {/* Content Box */}
              <div className="p-6 space-y-6">
                <div className="flex items-center gap-3 text-red-500 border-b border-zinc-800 pb-3">
                  <span className="text-3xl">🚨</span>
                  <div>
                    <h3 className="text-base font-black tracking-widest uppercase">CRITICAL SYSTEM DISCLOSURE</h3>
                    <p className="text-[10px] text-zinc-500 font-bold mt-0.5">HIGH FRICTION SECURITY INTERACTION</p>
                  </div>
                </div>

                <div className="space-y-3.5 text-xs text-zinc-300 leading-relaxed font-mono">
                  <p className="bg-red-500/5 p-3 rounded-lg border border-red-500/20 text-red-400 font-bold">
                    [WARNING] You are about to switch the Virtual Profit Arena from Sandbox Mode to LIVE CAPITAL Mode.
                  </p>
                  <p>
                    By activating Live Capital, the autonomous AI trading loops will trade using **actual, real-world funds** on your **Revolut X** exchange account.
                  </p>
                  <ul className="list-disc pl-4 space-y-1.5 text-zinc-400 text-[11px]">
                    <li><strong>Autonomous AI Execution:</strong> The AI Trader and Risk Supervisor will make sizing, buy, and sell decisions entirely autonomously.</li>
                    <li><strong>Real Balances Loaded:</strong> System will dynamically load your actual cash and cryptocurrency tokens currently held on your Revolut X account.</li>
                    <li><strong>Financial Risks:</strong> Cryptocurrencies are highly volatile assets. You hold complete liability for all gains and losses generated by this autonomous software.</li>
                  </ul>
                </div>

                {switcherError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-xs font-bold">
                    SYSTEM ERROR: {switcherError}
                  </div>
                )}

                <div className="space-y-2 border-t border-zinc-900 pt-4">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-black block">
                    Type validation phrase to proceed:
                  </label>
                  <input
                    type="text"
                    placeholder="CONFIRM LIVE CAPITAL"
                    value={liveConfirmText}
                    onChange={(e: any) => setLiveConfirmText(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-red-500 text-zinc-300 text-xs font-bold font-mono rounded-lg px-3 py-2.5 focus:outline-none placeholder:text-zinc-750"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    onClick={() => {
                      setShowLiveWarningModal(false);
                      setLiveConfirmText('');
                      setSwitcherError('');
                    }}
                    disabled={switchingLiveMode}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    ABORT
                  </button>
                  <button
                    onClick={() => handleToggleLive(true)}
                    disabled={switchingLiveMode || liveConfirmText !== 'CONFIRM LIVE CAPITAL'}
                    className={`px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-all duration-300 shadow-md ${
                      liveConfirmText === 'CONFIRM LIVE CAPITAL' && !switchingLiveMode
                        ? 'bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-500 hover:to-amber-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.35)]'
                        : 'bg-zinc-950 border border-zinc-900 text-zinc-650 cursor-not-allowed'
                    }`}
                  >
                    {switchingLiveMode ? 'SYNCING...' : 'CONFIRM LIVE'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
