"use client";

import { useState, useEffect, useMemo } from "react";
import { analyzeCrypto, getLegacyReports, deleteLegacyFile, getSimplePrices, getVerifiedPrices, getAgentConsultation, getRealTimePrice, getAgentTargets, updateAgentTargets } from "./actions"; // Added getAgentConsultation
import { AGENT_WATCHLIST } from "@/lib/constants";
import { type CryptoAnalysisResult } from "@/lib/gemini";
import { useAuth } from "@/context/AuthContext";
import { type AgentConsultationResult } from "@/lib/agent";
import { fetchLibrary, saveToLibrary, deleteReport, migrateLegacyLibrary, clearLibrary, type LibraryReport } from "@/services/libraryService";
import { fetchPortfolio, addToPortfolio, removeFromPortfolio, updatePortfolioItem, recordPortfolioSnapshot, fetchPortfolioHistory, clearPortfolio, recordTrade, fetchRealizedTrades, getCashBalance, modifyCash, recordCashTransaction, purgeLegacyCashData, type PortfolioItem, type PortfolioSnapshot, type RealizedTrade, type TransactionHistoryItem } from "@/services/portfolioService";
import { getVirtualPortfolio, getVirtualTrades, getVirtualHistory, getVirtualDecisions, type VirtualPortfolio, type VirtualTrade, type VirtualDecision } from "@/services/virtualPortfolioService";
import { manualAgentCheck, resetAIChallenge } from "./actions";
import { PieChart, Pie, Cell, AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Search, Info, TrendingUp, ShieldCheck, Activity, Users, Github, Wallet, BarChart3, AlertCircle, Loader2, Library, Trash2, X, ChevronLeft, ChevronRight, Briefcase, Plus, TrendingDown, ArrowUpRight, ArrowDownRight, Coins, RefreshCw, Edit, Minus, DollarSign, Sparkles, PackageSearch, Settings, Check, Target } from "lucide-react";
import MonitoringStatus from "@/components/MonitoringStatus";
import PortfolioConsultationModal from "@/components/PortfolioConsultationModal";

import { motion, AnimatePresence } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatPrice = (price: number) => {
  if (price === 0) return "N/A";
  // Use 4 decimals for small numbers (pennies), 2 for larger ones (dollars)
  const decimals = price < 1 ? 4 : 2;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

export default function Home() {
  const { user, loading: authLoading, signInWithGoogle, logout } = useAuth();
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CryptoAnalysisResult | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryReports, setLibraryReports] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const reportsPerPage = 5;

  // Modal State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'confirm' | 'alert' | 'danger' | 'prompt';
    onConfirm?: (value?: string) => void;
    placeholder?: string;
    defaultValue?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: 'alert'
  });

  const [isAIAgentPanelOpen, setIsAIAgentPanelOpen] = useState(false);

  const [modalInput, setModalInput] = useState("");

  // Portfolio State
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioCash, setPortfolioCash] = useState(0);
  const [portfolioPrices, setPortfolioPrices] = useState<Record<string, {
    price: number;
    source: string;
    timestamp: number;
    high24h?: number;
    low24h?: number;
    change24h?: number;
  }>>({});
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [realizedTrades, setRealizedTrades] = useState<TransactionHistoryItem[]>([]);
  const [isAddingAsset, setIsAddingAsset] = useState(false);
  const [editingAsset, setEditingAsset] = useState<PortfolioItem | null>(null);
  const [sellingAsset, setSellingAsset] = useState<PortfolioItem | null>(null);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [cashMode, setCashMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [cashAmountInput, setCashAmountInput] = useState("");
  const [useCash, setUseCash] = useState(true);
  const [newAsset, setNewAsset] = useState({ ticker: "", amount: "", price: "", date: "" });
  const [sellData, setSellData] = useState({ amount: "", price: "", date: "" });
  const [lastLoggedValue, setLastLoggedValue] = useState<number | null>(null);
  const [isRevaluing, setIsRevaluing] = useState(false);
  const [portfolioTab, setPortfolioTab] = useState<'holdings' | 'history' | 'ai_agent'>('holdings'); // Added ai_agent tab

  // Virtual Portfolio State
  const [vpData, setVpData] = useState<VirtualPortfolio | null | undefined>(undefined);
  const [vpPrices, setVpPrices] = useState<Record<string, { price: number; source: string; timestamp: number }>>({});
  const [vpTrades, setVpTrades] = useState<VirtualTrade[]>([]);
  const [vpHistory, setVpHistory] = useState<any[]>([]);
  const [vpDecisions, setVpDecisions] = useState<VirtualDecision[]>([]);
  const [isInitializingVP, setIsInitializingVP] = useState(false);
  const [isPerformanceChartOpen, setIsPerformanceChartOpen] = useState(false);
  const [isTradesModalOpen, setIsTradesModalOpen] = useState(false);
  const [tradeLogPage, setTradeLogPage] = useState(1);

  // Agent State
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [agentResult, setAgentResult] = useState<AgentConsultationResult | null>(null);

  // Auto-Retry State
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [showSuccess, setShowSuccess] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ currentTicker: string; index: number; total: number } | null>(null);
  const [agentTargets, setAgentTargets] = useState<string[]>([]);
  const [isTargetsModalOpen, setIsTargetsModalOpen] = useState(false);
  const [newTargetTicker, setNewTargetTicker] = useState("");

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const metrics = useMemo(() => {
    let totalInvested = 0;
    let totalVal = 0;
    let bestAsset: { ticker: string; pct: number } | null = null;
    let worstAsset: { ticker: string; pct: number } | null = null;

    portfolioItems.forEach(item => {
      const priceData = portfolioPrices[item.ticker];
      const currentPrice = priceData ? priceData.price : item.averagePrice;
      const value = item.amount * currentPrice;
      const cost = item.amount * item.averagePrice;

      totalVal += value;
      totalInvested += cost;

      const pnlPct = item.averagePrice > 0 ? ((currentPrice - item.averagePrice) / item.averagePrice) * 100 : 0;

      if (!bestAsset || pnlPct > bestAsset.pct) {
        bestAsset = { ticker: item.ticker, pct: pnlPct };
      }
      if (!worstAsset || pnlPct < worstAsset.pct) {
        worstAsset = { ticker: item.ticker, pct: pnlPct };
      }
    });

    const unrealizedPnl = totalVal - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (unrealizedPnl / totalInvested) * 100 : 0;

    // Total historical cost = cost of CURRENT holdings + cost of everything ALREADY SOLD
    const realizedCost = realizedTrades.reduce((acc, t) => acc + (t.type === 'TRADE' ? (t.sellAmount * t.costBasis) : 0), 0);
    const totalHistoricalCost = totalInvested + realizedCost;

    const totalRealized = realizedTrades.reduce((acc, t) => acc + (t.type === 'TRADE' ? t.realizedPnl : 0), 0);
    const allTimePnl = unrealizedPnl + totalRealized;
    const allTimePct = totalHistoricalCost > 0 ? (allTimePnl / totalHistoricalCost) * 100 : 0;

    return {
      totalVal,
      totalInvested,
      unrealizedPnl,
      unrealizedPct,
      totalRealized,
      allTimePnl,
      allTimePct,
      bestAsset,
      worstAsset,
      assetCount: portfolioItems.length
    } as {
      totalVal: number;
      totalInvested: number;
      unrealizedPnl: number;
      unrealizedPct: number;
      totalRealized: number;
      allTimePnl: number;
      allTimePct: number;
      bestAsset: { ticker: string; pct: number } | null;
      worstAsset: { ticker: string; pct: number } | null;
      assetCount: number;
    };
  }, [portfolioItems, portfolioPrices, realizedTrades]);

  useEffect(() => {
    if (user) {
      loadLibrary();
      loadPortfolio();
      loadPortfolioHistory();
      loadRealizedTrades();
      loadVirtualPortfolio();
      loadAgentTargets();
    }
  }, [user]);

  useEffect(() => {
    if (isPortfolioOpen && user && portfolioItems.length > 0) {
      const totalValue = portfolioItems.reduce((acc, item) => {
        const priceData = portfolioPrices[item.ticker];
        const price = priceData ? priceData.price : item.averagePrice;
        return acc + (item.amount * price);
      }, 0);
      // Log snapshot on access if value changed or it's been a while
      if (totalValue > 0 && totalValue !== lastLoggedValue) {
        recordPortfolioSnapshot(user.uid, totalValue).then(() => {
          setLastLoggedValue(totalValue);
          loadPortfolioHistory();
        });
      }
    }
  }, [isPortfolioOpen]);

  useEffect(() => {
    if (retryCountdown === null) return;

    if (retryCountdown > 0) {
      const timer = setTimeout(() => setRetryCountdown(retryCountdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      // Countdown reached 0, re-trigger the search
      const form = document.querySelector('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }
  }, [retryCountdown]);

  useEffect(() => {
    const hasPortfolio = portfolioItems.length > 0;
    const hasVP = !!vpData;

    if (hasPortfolio || hasVP) {
      const refresh = () => {
        if (hasPortfolio) updatePortfolioPrices();
        if (hasVP) loadVirtualPortfolio();
      };

      // Initial refresh or when dependencies change
      refresh();

      const interval = setInterval(refresh, 60000); // Global refresh every 60s

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          console.log("App became visible, refreshing all portfolios...");
          refresh();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [portfolioItems.length, !!vpData]);

  const loadLibrary = async () => {
    if (!user) return;

    try {
      // Migration Check
      const legacy = await getLegacyReports();
      if (legacy.length > 0) {
        await migrateLegacyLibrary(user.uid, legacy);
        await deleteLegacyFile(); // Wipe local file once migrated to cloud
      }

      const data = await fetchLibrary(user.uid);
      console.log(`Loaded ${data.length} reports for user ${user.uid}`);

      // Deduplicate in case of race condition during migration
      const uniqueReports = data.reduce((acc: any[], current: any) => {
        const x = acc.find(item => item.ticker === current.ticker && item.savedAt === current.savedAt);
        if (!x) return acc.concat([current]);
        return acc;
      }, []);

      setLibraryReports(uniqueReports);
    } catch (error) {
      console.error("Failed to load library:", error);
      setModalConfig({
        isOpen: true,
        title: "Library Load Error",
        message: "Failed to load your saved reports. Please try again later.",
        type: "alert"
      });
    }
  };

  const itemValue = (item: PortfolioItem) => {
    const priceData = portfolioPrices[item.ticker];
    const currentPrice = priceData ? priceData.price : item.averagePrice;
    return `$${(item.amount * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const loadPortfolio = async () => {
    if (!user) return;
    const data = await fetchPortfolio(user.uid);
    setPortfolioItems(data);
    const cash = await getCashBalance(user.uid);
    setPortfolioCash(cash);
  };

  const loadPortfolioHistory = async () => {
    if (!user) return;
    const data = await fetchPortfolioHistory(user.uid);
    setPortfolioHistory(data);
  };

  const loadRealizedTrades = async () => {
    if (!user) return;
    const data = await fetchRealizedTrades(user.uid);
    setRealizedTrades(data);
  };

  const loadVirtualPortfolio = async () => {
    if (!user) return;
    setAgentLoading(true);
    // If not first load, keep current data to avoid flicker.
    // If first load, it stays undefined.
    try {
      const data = await getVirtualPortfolio(user.uid);

      // Live Price Update Logic (Using Robust Verification Engine)
      if (data && data.holdings && Object.keys(data.holdings).length > 0) {
        try {
          const tickers = Object.keys(data.holdings);
          const verifiedPrices: Record<string, any> = {};

          for (let i = 0; i < tickers.length; i++) {
            const t = tickers[i];
            setSyncProgress({ currentTicker: t, index: i + 1, total: tickers.length });

            // Sequential Fetch with inherent retry logic inside getRealTimePrice
            // We can also add a small delay here if needed
            const priceData = await getRealTimePrice(t);
            if (priceData) {
              verifiedPrices[t.toUpperCase()] = {
                price: priceData.price,
                source: priceData.verificationStatus,
                timestamp: Date.now(),
                high24h: priceData.high24h,
                low24h: priceData.low24h,
                change24h: priceData.change24h
              };
            }
          }
          setSyncProgress(null);

          // Save detailed price info to state for UI display
          setVpPrices(verifiedPrices);

          let liveHoldingsValue = 0;
          tickers.forEach(t => {
            const qty = data.holdings[t].amount;
            const priceInfo = verifiedPrices[t.toUpperCase()];

            // Fallback to average price only if verification fails completely
            const currentPrice = priceInfo ? priceInfo.price : data.holdings[t].averagePrice;

            liveHoldingsValue += qty * currentPrice;
          });

          // Update local display value
          data.totalValue = data.cashBalance + liveHoldingsValue;
        } catch (e) {
          console.warn("Failed to update live VP prices", e);
          setSyncProgress(null);
        }
      }

      setVpData(data);
      const trades = await getVirtualTrades(user.uid);
      setVpTrades(trades);
      const history = await getVirtualHistory(user.uid);
      setVpHistory(history);
      const decisions = await getVirtualDecisions(user.uid);
      setVpDecisions(decisions);
    } catch (e) {
      console.error("Failed to load VP", e);
    } finally {
      setAgentLoading(false);
      setShowSuccess("AI Portfolio Synchronized");
      setTimeout(() => setShowSuccess(null), 2500);
    }
  };

  const loadAgentTargets = async () => {
    if (!user) return;
    const targets = await getAgentTargets(user.uid);
    setAgentTargets(targets);
  };

  const handleUpdateTargets = async (newTargets: string[]) => {
    if (!user) return;
    const res = await updateAgentTargets(user.uid, newTargets);
    if (res.success) {
      setAgentTargets(res.targets || newTargets);
      setShowSuccess("Targets Updated");
      setTimeout(() => setShowSuccess(null), 2000);
    } else {
      setModalConfig({
        isOpen: true,
        title: "Update Failed",
        message: res.message || "Failed to update targets.",
        type: 'danger'
      });
    }
  };

  const handleAddTarget = () => {
    if (!newTargetTicker) return;
    const ticker = newTargetTicker.toUpperCase().trim();
    if (agentTargets.includes(ticker)) {
      setModalConfig({ isOpen: true, title: "Duplicate", message: "Ticker already in targets.", type: 'alert' });
      return;
    }
    if (agentTargets.length >= 15) {
      setModalConfig({ isOpen: true, title: "Limit Reached", message: "Maximum 15 targets allowed.", type: 'alert' });
      return;
    }
    const updated = [...agentTargets, ticker];
    handleUpdateTargets(updated);
    setNewTargetTicker("");
  };

  const handleRemoveTarget = (ticker: string) => {
    const updated = agentTargets.filter(t => t !== ticker);
    handleUpdateTargets(updated);
  };

  const handleInitAIChallenge = async () => {
    if (!user) return;

    setModalInput("600");
    setModalConfig({
      isOpen: true,
      title: "Initial Capital",
      message: "Enter initial virtual cash balance (USD) for the AI Trading Challenge:",
      type: 'prompt',
      onConfirm: async (value) => {
        const amount = parseFloat(value || "600");
        if (isNaN(amount) || amount <= 0) return;

        setIsInitializingVP(true);
        setModalConfig({
          isOpen: true,
          title: "Starting AI Challenge",
          message: `The AI is analyzing the market to effectively deploy its initial $${amount} capital...`,
          type: 'alert'
        });

        try {
          const res = await manualAgentCheck(user.uid, amount);
          if (res.success) {
            await loadVirtualPortfolio();
            setModalConfig({
              isOpen: true,
              title: "AI Challenge Active",
              message: res.message,
              type: 'confirm'
            });
          } else {
            setModalConfig({
              isOpen: true,
              title: "Setup Failed",
              message: res.message,
              type: 'danger'
            });
          }
        } catch (e) {
          console.error(e);
        } finally {
          setIsInitializingVP(false);
        }
      }
    });
  };

  const handleResetAI = async () => {
    setModalConfig({
      isOpen: true,
      title: "Reset AI Challenge",
      message: "Are you sure? This will surrender all current profits/losses and reset to the initial balance. History will be wiped.",
      type: 'danger',
      onConfirm: async () => {
        if (!user) return;

        // Double Check for AI Reset
        setTimeout(() => {
          setModalInput("600");
          setModalConfig({
            isOpen: true,
            title: "Confirm AI Reset",
            message: "This will permanently delete the AI Agent's history and current positions. Enter new virtual cash balance (USD) for the reset:",
            type: 'prompt',
            onConfirm: async (value) => {
              const amount = parseFloat(value || "600");
              if (isNaN(amount) || amount <= 0) return;

              const res = await resetAIChallenge(user.uid, amount);
              if (res.success) {
                await loadVirtualPortfolio();
              }
            }
          });
        }, 200);
      }
    });
  };

  const updatePortfolioPrices = async () => {
    const tickers = portfolioItems.map(item => item.ticker);
    if (tickers.length === 0) return;

    try {
      const prices = await getVerifiedPrices(tickers);
      setPortfolioPrices(prev => ({ ...prev, ...prices })); // Merges detailed objects
    } catch (e) {
      console.error("Failed to update prices", e);
    }
  };

  const handleCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !cashAmountInput) return;

    const amt = parseFloat(cashAmountInput);
    if (isNaN(amt) || amt <= 0) return;

    const change = cashMode === 'deposit' ? amt : -amt;

    try {
      await modifyCash(user.uid, change);
      await recordCashTransaction(user.uid, cashMode.toUpperCase() as any, amt);

      const newBal = await getCashBalance(user.uid);
      setPortfolioCash(newBal);

      setIsCashModalOpen(false);
      setCashAmountInput("");
      loadRealizedTrades();
    } catch (e) {
      console.error("Cash update failed", e);
    }
  };

  const handleResetCash = async () => {
    if (!user) return;
    if (window.confirm("This will permanently delete all legacy 'US/USD' ticker entries and reset your cash wallet history to zero. This cannot be undone. Proceed?")) {
      const success = await purgeLegacyCashData(user.uid);
      if (success) {
        alert("Wallet reset successfully.");
        loadPortfolio();
        loadRealizedTrades();
      } else {
        alert("Failed to reset wallet.");
      }
    }
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newAsset.ticker || !newAsset.amount || !newAsset.price) return;

    try {
      const amountVal = parseFloat(newAsset.amount);
      const priceVal = parseFloat(newAsset.price);

      if (editingAsset) {
        // Update existing
        await updatePortfolioItem(editingAsset.id, {
          ticker: newAsset.ticker,
          amount: amountVal,
          averagePrice: priceVal,
          tradeDate: newAsset.date ? new Date(newAsset.date).toISOString() : editingAsset.tradeDate
        });
      } else {
        // Create new
        await addToPortfolio(
          user.uid,
          newAsset.ticker,
          amountVal,
          priceVal,
          newAsset.date ? new Date(newAsset.date).toISOString() : new Date().toISOString()
        );

        // Deduct from Cash if enabled
        if (useCash) {
          const cost = amountVal * priceVal;
          await modifyCash(user.uid, -cost);
        }
      }

      setNewAsset({ ticker: "", amount: "", price: "", date: "" });
      setEditingAsset(null);
      setIsAddingAsset(false);
      loadPortfolio();
    } catch (err) {
      console.error(err);
      setModalConfig({
        isOpen: true,
        title: "System Error",
        message: "Failed to save asset. Please check your inputs.",
        type: "alert"
      });
    }
  };

  const startAdding = () => {
    setEditingAsset(null);
    setNewAsset({
      ticker: "",
      amount: "",
      price: "",
      date: new Date().toISOString().split('T')[0]
    });
    setIsAddingAsset(true);
    setSellingAsset(null);
  };

  const startEditing = (item: PortfolioItem) => {
    setEditingAsset(item);
    setNewAsset({
      ticker: item.ticker,
      amount: item.amount.toString(),
      price: item.averagePrice.toString(),
      date: item.tradeDate ? new Date(item.tradeDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
    });
    setIsAddingAsset(true);
    setSellingAsset(null);
  };

  const startSelling = (item: PortfolioItem) => {
    setSellingAsset(item);
    setUseCash(true);
    const currentPriceData = portfolioPrices[item.ticker];
    setSellData({
      amount: item.amount.toString(),
      price: currentPriceData ? currentPriceData.price.toString() : "",
      date: new Date().toISOString().split('T')[0]
    });
    setIsAddingAsset(false);
    setEditingAsset(null);
  };

  const handleSellAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !sellingAsset || !sellData.amount || !sellData.price) return;

    const sellAmt = parseFloat(sellData.amount);
    const sellPx = parseFloat(sellData.price);

    if (sellAmt > sellingAsset.amount) {
      setModalConfig({
        isOpen: true, title: "Invalid Amount", message: "You cannot sell more than you own.", type: 'alert'
      });
      return;
    }

    try {
      // 1. Record Trade
      await recordTrade(user.uid, sellingAsset.ticker, sellAmt, sellPx, sellingAsset.averagePrice, sellData.date);

      // 2. Update Portfolio
      if (sellAmt >= sellingAsset.amount) {
        // Full Sell
        await removeFromPortfolio(sellingAsset.id);
      } else {
        // Partial Sell
        await updatePortfolioItem(sellingAsset.id, {
          amount: sellingAsset.amount - sellAmt
        });
      }

      // Add to Cash if enabled
      if (useCash) {
        const proceeds = sellAmt * sellPx;
        await modifyCash(user.uid, proceeds);
      }

      setSellingAsset(null);
      setSellData({ amount: "", price: "", date: "" });
      loadPortfolio();
      loadRealizedTrades();
    } catch (e) {
      console.error(e);
      setModalConfig({ isOpen: true, title: "Error", message: "Failed to process sale.", type: "alert" });
    }
  };

  const handleClearPortfolio = async () => {
    if (!user || portfolioItems.length === 0) return;
    setModalConfig({
      isOpen: true,
      title: "Clear Entire Portfolio",
      message: "WARNING: You are about to DELETE ALL ASSETS & HISTORY. This action is irreversible. Are you absolutely sure?",
      type: "danger",
      onConfirm: async () => {
        // Double Check Logic could go here if we had a multi-step modal, 
        // but for now we make the first one very scary or rely on a second confirmation call?
        // Let's chain a second modal for "Double Check".
        setTimeout(() => {
          setModalConfig({
            isOpen: true,
            title: "Confirm Deletion",
            message: "Final Check: Really delete everything?",
            type: "danger",
            onConfirm: async () => {
              await clearPortfolio(user.uid);
              await loadPortfolio();
            }
          });
        }, 200);
      }
    });
  };

  const handleRemoveAsset = async (id: string) => {
    setModalConfig({
      isOpen: true,
      title: "Remove Asset",
      message: "Are you sure you want to remove this asset from your portfolio ledger?",
      type: "danger",
      onConfirm: async () => {
        await removeFromPortfolio(id);
        loadPortfolio();
      }
    });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !user) return;

    setLoading(true);
    try {
      // 1. Get RICH history context (Last 10 reports)
      const tickerHistory = libraryReports
        .filter((r: any) => r && r.ticker && r.ticker.toUpperCase() === ticker.toUpperCase())
        .sort((a: any, b: any) => new Date(b.savedAt || 0).getTime() - new Date(a.savedAt || 0).getTime())
        .slice(0, 10);

      const historyContextString = tickerHistory.length > 0
        ? JSON.stringify(tickerHistory.map((h: any) => ({
          date: new Date(h.savedAt || Date.now()).toLocaleDateString('en-GB'),
          price: h.currentPrice,
          score: h.overallScore,
          summary: h.summary
        })))
        : "";

      // 2. Analyze via server action
      const data = await analyzeCrypto(ticker, historyContextString);
      setResult(data);

      // Check if data is research-based (fallback)
      if (data.verificationStatus.toLowerCase().includes("research")) {
        setRetryCountdown(5);
      } else {
        // Real data confirmed
        setRetryCountdown(null);
        // 3. Save to Firestore (Client-side)
        await saveToLibrary(user.uid, data);
        loadLibrary(); // Refresh library after new save
      }
    } catch (err) {
      console.error(err);
      setModalConfig({
        isOpen: true,
        title: "Analysis Failed",
        message: err instanceof Error ? err.message : "An unexpected network error occurred.",
        type: "alert"
      });
      setRetryCountdown(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteReport = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setModalConfig({
      isOpen: true,
      title: "Delete Report",
      message: "Are you sure you want to delete this report from your library?",
      type: "danger",
      onConfirm: async () => {
        const success = await deleteReport(id);
        if (success) {
          loadLibrary();
        }
      }
    });
  };

  const handleClearLibrary = async () => {
    if (!user) return;
    setModalConfig({
      isOpen: true,
      title: "Wipe Intelligence Library",
      message: "CRITICAL: This will permanently delete ALL saved research reports. This action cannot be reversed. Continue?",
      type: "danger",
      onConfirm: async () => {
        const success = await clearLibrary(user.uid);
        if (success) {
          loadLibrary();
        }
      }
    });
  };

  const handleRevaluePortfolio = async () => {
    if (!user || portfolioItems.length === 0) return;
    setIsRevaluing(true);
    try {
      const tickers = portfolioItems.map(p => p.ticker);
      const verifiedPrices: Record<string, any> = {};

      for (let i = 0; i < tickers.length; i++) {
        const t = tickers[i];
        setSyncProgress({ currentTicker: t, index: i + 1, total: tickers.length });

        const priceData = await getRealTimePrice(t);
        if (priceData) {
          verifiedPrices[t.toUpperCase()] = {
            price: priceData.price,
            source: priceData.verificationStatus,
            timestamp: Date.now(),
            high24h: priceData.high24h,
            low24h: priceData.low24h,
            change24h: priceData.change24h
          };
        }
      }
      setSyncProgress(null);
      setPortfolioPrices(prev => ({ ...prev, ...verifiedPrices }));

      // Update snapshot immediately with confirmed values
      const totalValue = portfolioItems.reduce((acc, item) => {
        const priceData = verifiedPrices[item.ticker];
        const price = priceData ? priceData.price : item.averagePrice;
        return acc + (item.amount * price);
      }, 0);
      await recordPortfolioSnapshot(user.uid, totalValue);
      await loadPortfolioHistory();
    } catch (e) {
      console.error("Revaluation failed", e);
      setModalConfig({
        isOpen: true,
        title: "Revaluation Failed",
        message: "Could not verify all asset prices. Please try again later.",
        type: "alert"
      });
    } finally {
      setIsRevaluing(false);
      setShowSuccess("Portfolio Synchronized");
      setTimeout(() => setShowSuccess(null), 2500);
    }
  };

  const handleConsultAgent = () => {
    if (!user || portfolioItems.length === 0) return;
    setAgentResult(null);
    setIsAgentOpen(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full glass p-10 rounded-[2.5rem] border-white/10 text-center shadow-2xl relative overflow-hidden"
        >
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-blue-500/20">
              <ShieldCheck className="text-blue-400" size={40} />
            </div>

            <h1 className="text-4xl font-black mb-4 bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              Secure Terminal
            </h1>
            <p className="text-slate-400 mb-10 text-lg">
              Access the Crypto Traffic <br className="sm:hidden" /> Light System via your authorized Google Account.
            </p>

            <button
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-4 bg-white text-slate-900 py-4 px-6 rounded-2xl font-bold hover:bg-slate-200 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </button>

            <div className="mt-8 flex items-center justify-center gap-2 text-slate-500">
              <Activity size={14} className="text-emerald-500" />
              <span className="text-[10px] uppercase font-bold tracking-[0.2em]">Authorized Access Only</span>
            </div>
          </div>
        </motion.div>
      </main>
    );
  }

  const pieData = result?.signals.map((s) => ({
    name: s.name,
    value: s.weight,
    score: s.score
  })) || [];

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#4f46e5', '#94a3b8'];

  return (
    <main className="max-w-6xl mx-auto px-4 py-12">
      {/* Custom Modal System */}
      <AnimatePresence>
        {modalConfig.isOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModalConfig({ ...modalConfig, isOpen: false })}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm glass rounded-[2.5rem] border-white/10 p-8 shadow-2xl overflow-hidden"
            >
              <div className={cn(
                "absolute top-0 right-0 w-32 h-32 blur-3xl opacity-20 rounded-full -translate-y-1/2 translate-x-1/2",
                modalConfig.type === 'danger' ? "bg-red-500" : "bg-blue-500"
              )} />

              <div className="relative z-10 text-center">
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 border",
                  modalConfig.type === 'danger' ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-blue-500/10 border-blue-500/20 text-blue-500"
                )}>
                  {modalConfig.type === 'danger' ? <AlertCircle size={32} /> : <Info size={32} />}
                </div>

                <h3 className="text-xl font-black text-white mb-2">{modalConfig.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed mb-6 text-justify">{modalConfig.message}</p>

                {modalConfig.type === 'prompt' && (
                  <div className="mb-6 relative">
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500">
                      <DollarSign size={16} />
                    </div>
                    <input
                      type="number"
                      autoFocus
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (modalConfig.onConfirm) modalConfig.onConfirm(modalInput);
                          setModalConfig({ ...modalConfig, isOpen: false });
                        }
                      }}
                      className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-12 pr-6 text-white text-lg font-mono focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder={modalConfig.placeholder || "0.00"}
                    />
                  </div>
                )}

                <div className="flex gap-3">
                  {modalConfig.type !== 'alert' && (
                    <button
                      onClick={() => setModalConfig({ ...modalConfig, isOpen: false })}
                      className="flex-1 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest bg-white/5 text-slate-400 hover:bg-white/10 transition-all font-sans"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (modalConfig.onConfirm) modalConfig.onConfirm(modalConfig.type === 'prompt' ? modalInput : undefined);
                      setModalConfig({ ...modalConfig, isOpen: false });
                    }}
                    className={cn(
                      "flex-1 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg font-sans",
                      modalConfig.type === 'danger' ? "bg-red-600 text-white hover:bg-red-500 shadow-red-600/20" : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-600/20"
                    )}
                  >
                    {modalConfig.type === 'alert' ? 'Understood' : modalConfig.type === 'prompt' ? 'Start' : 'Confirm'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Progress Notification */}
      <AnimatePresence>
        {(loading || retryCountdown !== null || isRevaluing || agentLoading || !!showSuccess) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn("fixed bottom-8 z-[150]", isMobile ? "left-1/2 -translate-x-1/2" : "right-8")}
          >
            <div className={cn(
              "glass rounded-2xl p-6 shadow-2xl flex items-center gap-4 min-w-[320px] transition-all duration-500",
              showSuccess ? "border-emerald-500/40 bg-emerald-500/5 shadow-emerald-500/20" :
                (retryCountdown !== null || agentLoading || isRevaluing) ? "border-amber-500/30 bg-amber-500/5" : "border-blue-500/30"
            )}>
              <div className="relative">
                {showSuccess ? (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="text-emerald-400" size={16} />
                  </div>
                ) : (
                  <>
                    <Loader2 className={cn("animate-spin", (retryCountdown !== null || agentLoading || isRevaluing) ? "text-amber-400" : "text-blue-400")} size={24} />
                    <div className={cn("absolute inset-0 animate-ping rounded-full", (retryCountdown !== null || agentLoading || isRevaluing) ? "bg-amber-400/20" : "bg-blue-400/20")} />
                  </>
                )}
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">
                  {showSuccess ? "Verification Complete" :
                    retryCountdown !== null ? "Intelligence Refinement" :
                      syncProgress ? `Verifying ${syncProgress.currentTicker.toUpperCase()}` :
                        agentLoading ? "Synchronizing AI Portfolio" :
                          isRevaluing ? "Synchronizing My Portfolio" : "AI Analyst at Work"}
                </h4>
                <p className="text-xs text-slate-400">
                  {showSuccess ? showSuccess :
                    retryCountdown !== null
                      ? `Low confidence data detected. Retrying in ${retryCountdown}s...`
                      : syncProgress
                        ? `Asset ${syncProgress.index} of ${syncProgress.total} in progress...`
                        : agentLoading
                          ? "Fetching live market data and verifying AI positions..."
                          : isRevaluing
                            ? "Cross-referencing Binance, CoinGecko & Kraken for confirmed pricing..."
                            : "Searching live data & calculating 60/40 signals..."}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Portfolio Sidebar */}
      <AnimatePresence>
        {isPortfolioOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPortfolioOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-white/10 z-[90] shadow-2xl p-6 overflow-y-auto flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                  <Briefcase className="text-emerald-400" size={24} />
                  My Portfolio
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConsultAgent}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[10px] font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-lg shadow-violet-500/20"
                  >
                    <Sparkles size={14} /> AI Agent
                  </button>
                  <button
                    onClick={() => setIsPortfolioOpen(false)}
                    className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Portfolio Actions: Clear All */}
              {portfolioItems.length > 0 && (
                <div className="flex justify-end mb-4 px-2">
                  <button
                    onClick={handleClearPortfolio}
                    className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1 uppercase tracking-widest font-bold opacity-60 hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} /> Clear Portfolio
                  </button>
                </div>
              )}

              <div className="flex bg-slate-800/50 p-1 rounded-xl mb-6">
                <button
                  onClick={() => setPortfolioTab('holdings')}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                    portfolioTab === 'holdings' ? "bg-white text-slate-900 shadow-lg" : "text-slate-500 hover:text-white"
                  )}
                >
                  Holdings
                </button>
                <button
                  onClick={() => setPortfolioTab('history')}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all",
                    portfolioTab === 'history' ? "bg-white text-slate-900 shadow-lg" : "text-slate-500 hover:text-white"
                  )}
                >
                  History
                </button>
              </div>

              {portfolioTab === 'ai_agent' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
                  {vpData === undefined || (agentLoading && !vpData) ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                      <div className="relative mb-6">
                        <div className="w-20 h-20 bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 rounded-3xl flex items-center justify-center animate-pulse border border-violet-500/20">
                          <Sparkles className="text-violet-400" size={40} />
                        </div>
                        <div className="absolute inset-0 animate-ping bg-violet-500/10 rounded-3xl" />
                      </div>
                      <h3 className="text-white text-xl font-bold mb-3 tracking-tight">AI Agent Synchronizing</h3>
                      <p className="text-slate-400 text-sm max-w-[280px] leading-relaxed">
                        We&apos;re currently retrieving your virtual portfolio state and verifying the latest market positions.
                      </p>
                      <div className="mt-8 flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/5">
                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" />
                        <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 ml-1">Live Connection</span>
                      </div>
                    </div>
                  ) : vpData === null ? (
                    <div className="text-center p-8 border border-dashed border-slate-700 rounded-3xl relative">
                      <button
                        onClick={() => setIsTargetsModalOpen(true)}
                        className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-all border border-white/5 active:scale-95"
                        title="Configure Target Assets"
                      >
                        <Settings size={16} />
                      </button>
                      <div className="w-16 h-16 bg-gradient-to-br from-violet-600 to-fuchsia-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
                        <Sparkles className="text-white" size={32} />
                      </div>
                      <h3 className="text-white font-bold mb-2">AI Trading Challenge</h3>
                      <p className="text-slate-400 text-sm mb-6">
                        Let the AI manage a virtual portfolio starting with your chosen amount. It will trade autonomously based on its own market analysis signals.
                      </p>
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={handleInitAIChallenge}
                          disabled={isInitializingVP}
                          className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:scale-105 transition-all shadow-xl"
                        >
                          {isInitializingVP ? "Initializing..." : "Start AI Challenge"}
                        </button>
                        <button
                          onClick={() => setIsTargetsModalOpen(true)}
                          className="text-[10px] text-violet-400 hover:text-violet-300 font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                          <Target size={12} /> Configure Target Assets
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* AI Stats */}
                      <div className={cn(
                        "bg-gradient-to-br from-violet-900/50 to-fuchsia-900/20 border border-violet-500/20 rounded-3xl mb-6 relative overflow-hidden group",
                        isMobile ? "p-4" : "p-6"
                      )}>
                        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

                        <div className="absolute top-4 right-4 flex items-center gap-5">
                          <button
                            onClick={() => setIsTargetsModalOpen(true)}
                            className="p-3 rounded-xl bg-slate-900/60 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-all shadow-lg border border-white/5 active:scale-90"
                            title="Manage Target Assets"
                          >
                            <Settings size={18} />
                          </button>
                          <button
                            onClick={loadVirtualPortfolio}
                            className="p-3 rounded-xl bg-slate-900/60 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all shadow-lg border border-white/5 active:scale-90"
                            title="Refresh Prices"
                          >
                            <RefreshCw size={18} className={agentLoading ? "animate-spin" : ""} />
                          </button>
                          <button
                            onClick={handleResetAI}
                            className="p-3 rounded-xl bg-slate-900/60 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all shadow-lg border border-white/5 active:scale-90"
                            title="Reset Challenge"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300/80">Total AI Value</p>
                          <p className="text-[9px] font-bold text-violet-300/40 uppercase tracking-tighter">
                            Started with ${(vpData.initialBalance || 600).toLocaleString()}
                          </p>
                        </div>

                        <div className="text-3xl font-black text-white font-mono mb-1">
                          ${vpData.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>

                        <div className={cn(
                          "flex items-center gap-1 text-sm font-bold",
                          vpData.totalValue >= (vpData.initialBalance || 600) ? "text-emerald-400" : "text-red-400"
                        )}>
                          {vpData.totalValue >= (vpData.initialBalance || 600) ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                          {((vpData.totalValue - (vpData.initialBalance || 600)) / (vpData.initialBalance || 600) * 100).toFixed(2)}% ROI
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-4 mt-4 border-t border-violet-500/20">
                          <div className="bg-white/5 rounded-2xl px-3 py-4 border border-white/5">
                            <p className="text-[10px] text-violet-300/80 uppercase font-bold mb-1">Cash</p>
                            <p className="text-white font-mono font-bold leading-none">${(vpData.cashBalance || 0).toFixed(2)}</p>
                          </div>
                          <div className="bg-white/5 rounded-2xl px-3 py-4 border border-white/5">
                            <p className="text-[10px] text-violet-300/80 uppercase font-bold mb-1">Invested</p>
                            <p className="text-white font-mono font-bold leading-none">${Math.max(0, vpData.totalValue - vpData.cashBalance).toFixed(2)}</p>
                          </div>
                        </div>
                        {/* Verification Badge */}
                        {Object.keys(vpPrices).length > 0 && (
                          <div className="mt-3 pt-3 border-t border-violet-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <ShieldCheck size={10} className="text-emerald-400" />
                              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80">
                                Verified by {Object.values(vpPrices)[0]?.source || "Direct Exchange"}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono text-violet-300/40">
                              {new Date(Object.values(vpPrices)[0]?.timestamp || Date.now()).toLocaleTimeString()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Monitoring & Research Status */}
                      <div className="mb-8">
                        <MonitoringStatus watchlist={agentTargets} />
                      </div>

                      {/* AI History Chart */}
                      {vpHistory.length > 1 && (
                        <div className="mb-6 overflow-hidden">
                          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Performance Trend</h3>
                          <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={vpHistory}>
                                <defs>
                                  <linearGradient id="colorAIValue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <Tooltip
                                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px', color: '#fff' }}
                                  itemStyle={{ color: '#fff' }}
                                  formatter={(value?: number) => [`$${value?.toFixed(2) ?? '0.00'}`, 'Value']}
                                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="totalValue"
                                  stroke="#8b5cf6"
                                  strokeWidth={2}
                                  fillOpacity={1}
                                  fill="url(#colorAIValue)"
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Holdings */}
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                        <Wallet size={12} /> AI Holdings
                      </h3>
                      <div className="space-y-3 mb-8">
                        {Object.keys(vpData.holdings || {}).length === 0 ? (
                          <p className="text-slate-500 text-sm italic">No active positions. Scanning market...</p>
                        ) : (
                          Object.entries(vpData.holdings).map(([ticker, data]) => (
                            <div key={ticker} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                              <div className="flex items-center gap-3">
                                <img
                                  src={`https://assets.coincap.io/assets/icons/${ticker.toLowerCase()}@2x.png`}
                                  alt={ticker}
                                  className="w-8 h-8 rounded-full"
                                  onError={(e) => (e.currentTarget.src = "https://cdn-icons-png.flaticon.com/512/1213/1213691.png")}
                                />
                                <div>
                                  <span className="text-white font-bold">{ticker}</span>
                                  <p className="text-[10px] text-slate-400">
                                    {data.amount.toFixed(4)} @ ${data.averagePrice.toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className="text-white font-mono text-sm block">
                                  ${(data.amount * (portfolioPrices[ticker]?.price || data.averagePrice)).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Recent AI Trades */}
                      <div className="border-t border-white/5 mt-12 mb-6" />
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                          <Activity size={12} /> AI Trades
                        </h3>
                        <span className="text-[10px] text-slate-600 font-mono uppercase tracking-widest">Live Execution Log</span>
                      </div>
                      <div className="space-y-4">
                        {vpTrades.length === 0 ? (
                          <div className="text-center py-8 bg-white/[0.02] rounded-3xl border border-dashed border-white/5">
                            <p className="text-slate-500 text-sm italic">No trades recorded yet.</p>
                          </div>
                        ) : (
                          vpTrades.slice(0, 10).map((trade) => (
                            <div key={trade.id} className="relative group p-4 bg-white/[0.03] rounded-2xl border border-white/5 hover:border-violet-500/20 transition-all">
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                  <div className={cn(
                                    "w-8 h-8 rounded-xl flex items-center justify-center font-bold text-[10px]",
                                    trade.type === 'BUY' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                                  )}>
                                    {trade.ticker.slice(0, 2)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-white font-bold">{trade.ticker}</span>
                                      <span className={cn(
                                        "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                                        trade.type === 'BUY' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                      )}>
                                        {trade.type}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500">{new Date(trade.date).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-black text-white font-mono">${trade.total.toFixed(2)}</p>
                                  <p className="text-[10px] text-slate-500">@{trade.price.toFixed(2)}</p>
                                </div>
                              </div>
                              <div className="mt-2 text-[10px] text-slate-400 bg-black/20 p-2 rounded-lg border border-white/5 italic">
                                "{trade.reason}"
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Explicit Reset Button */}
                      <button
                        onClick={handleResetAI}
                        className="w-full mt-8 py-3 rounded-xl border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-all flex items-center justify-center gap-2"
                      >
                        <Trash2 size={14} /> Reset & Clear All AI Data
                      </button>
                    </>
                  )}
                </div>
              )}

              {portfolioTab === 'holdings' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
                  {/* COMPREHENSIVE PORTFOLIO DASHBOARD */}
                  <div className="space-y-4 mb-8">
                    {/* Main Performance Card */}
                    <div className="relative overflow-hidden glass rounded-[2.5rem] border-white/5 p-6 shadow-2xl">
                      {/* Decorative Background */}
                      <div className={cn(
                        "absolute top-0 right-0 w-48 h-48 blur-[80px] opacity-20 -translate-y-1/2 translate-x-1/2 rounded-full",
                        metrics.allTimePnl >= 0 ? "bg-emerald-500" : "bg-red-500"
                      )} />

                      <div className="relative z-10">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">Total Portfolio Value</p>
                            <div className="text-4xl font-black text-white font-mono tracking-tighter">
                              ${metrics.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <button
                            onClick={handleRevaluePortfolio}
                            disabled={isRevaluing}
                            className="p-3 rounded-2xl bg-white/5 border border-white/10 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-50"
                          >
                            <RefreshCw size={18} className={cn(isRevaluing && "animate-spin")} />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <div className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-xs",
                            metrics.allTimePnl >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                          )}>
                            {metrics.allTimePnl >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                            ${Math.abs(metrics.allTimePnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-xs",
                            metrics.allTimePct >= 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                          )}>
                            <Activity size={12} />
                            {metrics.allTimePct.toFixed(2)}% ROI (All-Time)
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cash Wallet Card */}
                    <div className="glass rounded-[2rem] border-white/5 p-4 flex items-center justify-between mb-4 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />
                      <div className="relative z-10">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1 flex items-center gap-1.5">
                          <Wallet size={12} className="text-violet-400" /> Cash Balance
                        </p>
                        <div className="text-2xl font-black text-white font-mono tracking-tighter">
                          ${portfolioCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="flex gap-2 relative z-10">
                        <button
                          onClick={() => { setCashMode('withdraw'); setIsCashModalOpen(true); }}
                          className="p-3 bg-white/5 hover:bg-red-500/10 hover:text-red-400 rounded-xl transition-all border border-white/5 group"
                          title="Withdraw Cash"
                        >
                          <Minus size={16} className="group-hover:scale-110 transition-transform" />
                        </button>
                        <button
                          onClick={() => { setCashMode('deposit'); setIsCashModalOpen(true); }}
                          className="p-3 bg-white/5 hover:bg-emerald-500/10 hover:text-emerald-400 rounded-xl transition-all border border-white/5 group"
                          title="Deposit Cash"
                        >
                          <Plus size={16} className="group-hover:scale-110 transition-transform" />
                        </button>
                      </div>
                    </div>

                    {/* Performance Sub-Grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Unrealized PNL */}
                      <div className="glass rounded-[2rem] border-white/5 p-4 relative group">
                        <div className="absolute top-2 right-4 text-emerald-500/20 group-hover:text-emerald-500/40 transition-colors">
                          <TrendingUp size={24} />
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Unrealized (Open)</p>
                        <div className={cn(
                          "text-lg font-black font-mono",
                          metrics.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
                        )}>
                          {metrics.unrealizedPnl >= 0 ? "+" : "-"}${Math.abs(metrics.unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{metrics.unrealizedPct.toFixed(2)}% Open Gain</p>
                      </div>

                      {/* Realized PNL */}
                      <div className="glass rounded-[2rem] border-white/5 p-4 relative group">
                        <div className="absolute top-2 right-4 text-blue-500/20 group-hover:text-blue-500/40 transition-colors">
                          <DollarSign size={24} />
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Realized (Closed)</p>
                        <div className={cn(
                          "text-lg font-black font-mono",
                          metrics.totalRealized >= 0 ? "text-blue-400" : "text-red-400"
                        )}>
                          {metrics.totalRealized >= 0 ? "+" : "-"}${Math.abs(metrics.totalRealized).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{realizedTrades.length} Closed Trades</p>
                      </div>

                      {/* Cost Basis */}
                      <div className="glass rounded-[2rem] border-white/5 p-4 relative group col-span-1">
                        <div className="absolute top-2 right-4 text-slate-500/20 group-hover:text-slate-500/40 transition-colors">
                          <Wallet size={24} />
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Active Collateral</p>
                        <div className="text-lg font-black font-mono text-white">
                          ${metrics.totalInvested.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{metrics.assetCount} Active Assets</p>
                      </div>

                      {/* Portfolio Diversity Score placeholder or similar */}
                      <div className="glass rounded-[2rem] border-white/5 p-4 relative group col-span-1 bg-gradient-to-br from-blue-500/5 to-transparent">
                        <div className="absolute top-2 right-4 text-indigo-500/20 group-hover:text-indigo-500/40 transition-colors">
                          <ShieldCheck size={24} />
                        </div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">System Health</p>
                        <div className="text-lg font-black font-mono text-indigo-400">
                          98.4<span className="text-[10px] ml-1">SEC</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Cross-Verified</p>
                      </div>
                    </div>

                    {/* Best/Worst Performers */}
                    {metrics.assetCount > 0 && (
                      <div className="flex gap-2">
                        {metrics.bestAsset && (
                          <div className={cn(
                            "flex-1 glass rounded-2xl py-2 px-3 flex items-center justify-between border",
                            metrics.bestAsset.pct >= 0 ? "border-emerald-500/20" : "border-red-500/20"
                          )}>
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-6 h-6 rounded-lg flex items-center justify-center font-black text-[10px]",
                                metrics.bestAsset.pct >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                              )}>
                                {metrics.bestAsset.ticker.slice(0, 2)}
                              </div>
                              <span className="text-[10px] font-bold text-white tracking-widest uppercase">{metrics.bestAsset.ticker}</span>
                            </div>
                            <span className={cn(
                              "text-[10px] font-black font-mono",
                              metrics.bestAsset.pct >= 0 ? "text-emerald-400" : "text-red-400"
                            )}>
                              {metrics.bestAsset.pct >= 0 ? "+" : "-"}{Math.abs(metrics.bestAsset.pct).toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {metrics.worstAsset && metrics.worstAsset.ticker !== metrics.bestAsset?.ticker && (
                          <div className={cn(
                            "flex-1 glass rounded-2xl py-2 px-3 flex items-center justify-between border",
                            metrics.worstAsset.pct >= 0 ? "border-emerald-500/20" : "border-red-500/20"
                          )}>
                            <div className="flex items-center gap-2">
                              <div className={cn(
                                "w-6 h-6 rounded-lg flex items-center justify-center font-black text-[10px]",
                                metrics.worstAsset.pct >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                              )}>
                                {metrics.worstAsset.ticker.slice(0, 2)}
                              </div>
                              <span className="text-[10px] font-bold text-white tracking-widest uppercase">{metrics.worstAsset.ticker}</span>
                            </div>
                            <span className={cn(
                              "text-[10px] font-black font-mono",
                              metrics.worstAsset.pct >= 0 ? "text-emerald-400" : "text-red-400"
                            )}>
                              {metrics.worstAsset.pct >= 0 ? "+" : "-"}{Math.abs(metrics.worstAsset.pct).toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* History Chart */}
                  {portfolioHistory.length > 1 && (
                    <div className="mb-8 overflow-hidden">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Value Trend</h3>
                      <div className="h-32 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={portfolioHistory}>
                            <defs>
                              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px', color: '#fff' }}
                              itemStyle={{ color: '#fff' }}
                              formatter={(value?: number) => [`$${value?.toFixed(2) ?? '0.00'}`, 'Total Value']}
                              labelFormatter={(label) => new Date(label).toLocaleDateString()}
                            />
                            <Area
                              type="monotone"
                              dataKey="totalValue"
                              stroke="#10b981"
                              fillOpacity={1}
                              fill="url(#colorValue)"
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Holdings List */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Asset Breakdown</h3>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={startAdding}
                        className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                      >
                        <Plus size={12} /> Add Asset
                      </button>
                      <button
                        onClick={handleClearPortfolio}
                        className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1"
                      >
                        <Trash2 size={12} /> Clear Portfolio
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 pb-6">
                    {portfolioItems.length === 0 ? (
                      <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-3xl">
                        <PackageSearch size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="mb-4">No assets tracked yet.</p>
                        <button
                          onClick={startAdding}
                          className="mx-auto flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20"
                        >
                          <Plus size={14} /> Add First Asset
                        </button>
                      </div>
                    ) : (
                      portfolioItems.map((item) => {
                        const currentPrice = portfolioPrices[item.ticker];
                        const value = item.amount * (currentPrice?.price || item.averagePrice);
                        const pnl = currentPrice ? (currentPrice.price - item.averagePrice) * item.amount : 0;
                        const pnlPct = currentPrice ? ((currentPrice.price - item.averagePrice) / item.averagePrice) * 100 : 0;

                        return (
                          <div key={item.id} className="glass rounded-3xl border-white/5 overflow-hidden">
                            <div className="p-4 flex items-center justify-between bg-white/[0.02]">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center font-bold text-slate-400 border border-white/5">
                                  {item.ticker.slice(0, 2)}
                                </div>
                                <div>
                                  <h4 className="font-bold text-white text-sm flex items-center gap-2">
                                    {item.ticker}
                                  </h4>
                                  <div className="text-[10px] text-slate-400 flex items-center gap-2">
                                    <span>{item.amount.toLocaleString()} Units</span>
                                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                                    <span>Avg: ${item.averagePrice.toLocaleString()}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-black text-white font-mono">
                                  {itemValue(item)}
                                </div>
                                {currentPrice && (
                                  <div className="mt-1 flex flex-col items-end opacity-80 gap-0.5">
                                    <div className="text-[10px] text-slate-300 font-mono">
                                      Current: ${formatPrice(currentPrice.price)}
                                    </div>
                                    <div className="flex items-center gap-2 text-[9px] font-mono text-slate-500">
                                      {currentPrice.low24h && <span>L: ${formatPrice(currentPrice.low24h)}</span>}
                                      {currentPrice.high24h && <span>H: ${formatPrice(currentPrice.high24h)}</span>}
                                    </div>

                                    <div className="text-[9px] text-slate-500 font-mono mt-0.5 opacity-75">
                                      {new Date(currentPrice.timestamp).toLocaleTimeString()}
                                    </div>

                                    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-emerald-400 mt-0.5 opacity-70">
                                      <ShieldCheck size={10} />
                                      <span>Verified by {currentPrice.source}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Action Footer */}
                            <div className="grid grid-cols-3 border-t border-white/5 bg-white/[0.02]">
                              <button
                                onClick={() => startEditing(item)}
                                className="flex items-center justify-center gap-1.5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-blue-400 hover:bg-blue-500/5 transition-all border-r border-white/5"
                              >
                                <Edit size={12} /> Edit
                              </button>
                              <button
                                onClick={() => startSelling(item)}
                                className="flex items-center justify-center gap-1.5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/5 transition-all border-r border-white/5"
                              >
                                <Minus size={12} /> Sell
                              </button>
                              <button
                                onClick={() => handleRemoveAsset(item.id)}
                                className="flex items-center justify-center gap-1.5 py-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-red-400 hover:bg-red-500/5 transition-all"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {portfolioTab === 'history' && (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Transaction History</h3>
                  <div className="space-y-3 overflow-y-auto pr-2 pb-6 custom-scrollbar">
                    {realizedTrades.length === 0 ? (
                      <div className="text-center py-12 text-slate-500">
                        <p>No transaction history yet.</p>
                      </div>
                    ) : (
                      realizedTrades.map((trade) => {
                        const isTrade = trade.type === 'TRADE';
                        const isDeposit = trade.type === 'DEPOSIT';
                        const isWithdrawal = trade.type === 'WITHDRAWAL';

                        return (
                          <div key={trade.id} className="glass rounded-xl p-4 border-white/5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs",
                                isTrade ? "bg-slate-800 text-slate-400" : (isDeposit ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400")
                              )}>
                                {trade.ticker.slice(0, 2)}
                              </div>
                              <div>
                                <h4 className="font-bold text-white text-sm">{trade.ticker}</h4>
                                <p className="text-[10px] text-slate-400">
                                  {isTrade ? `Sold ${trade.sellAmount} @ ${trade.sellPrice}` : (isDeposit ? 'Cash Deposit' : 'Cash Withdrawal')}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={cn(
                                "text-sm font-bold font-mono",
                                isTrade
                                  ? (trade.realizedPnl >= 0 ? "text-emerald-400" : "text-red-400")
                                  : (isDeposit ? "text-emerald-400" : "text-red-400")
                              )}>
                                {isTrade
                                  ? `${trade.realizedPnl >= 0 ? "+" : "-"}$${Math.abs(trade.realizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : `${isDeposit ? "+" : "-"}$${trade.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                }
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {new Date(trade.date).toLocaleDateString('en-GB')}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Add Asset Modal/Form */}
              <AnimatePresence>
                {isAddingAsset && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="mt-6 p-6 glass rounded-[2rem] border-blue-500/30 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-white flex items-center gap-2 uppercase tracking-widest text-xs">
                        {editingAsset ? <Edit className="text-blue-400" size={14} /> : <Plus className="text-blue-400" size={14} />}
                        {editingAsset ? "Edit Asset" : "New Asset"}
                      </h4>
                      <button onClick={() => { setIsAddingAsset(false); setEditingAsset(null); setNewAsset({ ticker: "", amount: "", price: "", date: "" }); }} className="text-slate-500 hover:text-white transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                    <form onSubmit={handleSaveAsset} className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Ticker</label>
                          <input
                            type="text"
                            placeholder="BTC"
                            value={newAsset.ticker}
                            onChange={(e) => setNewAsset({ ...newAsset, ticker: e.target.value.toUpperCase() })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                            required
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Amount</label>
                          <input
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={newAsset.amount}
                            onChange={(e) => setNewAsset({ ...newAsset, amount: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Purchase Price (USD)</label>
                        <input
                          type="number"
                          step="any"
                          placeholder="Price each..."
                          value={newAsset.price}
                          onChange={(e) => setNewAsset({ ...newAsset, price: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                          required
                        />
                        <div className="col-span-2">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Trade Date</label>
                          <input
                            type="date"
                            value={newAsset.date}
                            onChange={(e) => setNewAsset({ ...newAsset, date: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </div>
                      </div>

                      {!editingAsset && (
                        <div className="flex items-center gap-3 py-1 px-1">
                          <input
                            type="checkbox"
                            id="useCashAdd"
                            checked={useCash}
                            onChange={(e) => setUseCash(e.target.checked)}
                            className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-500 focus:ring-offset-0 focus:ring-0 cursor-pointer"
                          />
                          <label htmlFor="useCashAdd" className="text-xs text-slate-400 select-none cursor-pointer flex items-center gap-1">
                            Deduct from Cash <span className="text-slate-500 text-[10px]">(${portfolioCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                          </label>
                        </div>
                      )}

                      <button
                        type="submit"
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20 transition-all"
                      >
                        {editingAsset ? "Update Record" : "Add to Secure Ledger"}
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sell Asset Modal/Form */}
              <AnimatePresence>
                {sellingAsset && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="mt-6 p-6 glass rounded-[2rem] border-red-500/30 shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-bold text-white flex items-center gap-2 uppercase tracking-widest text-xs">
                        <Minus className="text-red-400" size={14} />
                        Sell {sellingAsset.ticker}
                      </h4>
                      <button onClick={() => { setSellingAsset(null); setSellData({ amount: "", price: "", date: "" }); }} className="text-slate-500 hover:text-white transition-colors">
                        <X size={16} />
                      </button>
                    </div>
                    <form onSubmit={handleSellAsset} className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Units to Sell</label>
                          <div className="px-3 py-2 text-xs text-white bg-white/5 rounded-xl border border-white/10 font-mono">
                            Max: {sellingAsset.amount}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Amount</label>
                          <input
                            type="number"
                            step="any"
                            placeholder="0.00"
                            value={sellData.amount}
                            onChange={(e) => setSellData({ ...sellData, amount: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-red-500 outline-none"
                            required
                            max={sellingAsset.amount}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Sell Price (USD)</label>
                        <input
                          type="number"
                          step="any"
                          placeholder="Price each..."
                          value={sellData.price}
                          onChange={(e) => setSellData({ ...sellData, price: e.target.value })}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-red-500 outline-none"
                          required
                        />
                        <div className="col-span-2 mt-3">
                          <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Sale Date</label>
                          <input
                            type="date"
                            value={sellData.date}
                            onChange={(e) => setSellData({ ...sellData, date: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-red-500 outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3 py-1 px-1">
                        <input
                          type="checkbox"
                          id="useCashSell"
                          checked={useCash}
                          onChange={(e) => setUseCash(e.target.checked)}
                          className="w-4 h-4 rounded bg-black/40 border-white/20 text-emerald-500 focus:ring-offset-0 focus:ring-0 cursor-pointer"
                        />
                        <label htmlFor="useCashSell" className="text-xs text-slate-400 select-none cursor-pointer flex items-center gap-1">
                          Add to Cash <span className="text-slate-500 text-[10px]">(${portfolioCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                        </label>
                      </div>

                      <button
                        type="submit"
                        className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-lg shadow-red-500/20 transition-all"
                      >
                        Confirm Sale
                      </button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-auto pt-6 border-t border-white/5 opacity-50 flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 tracking-widest">
                <span>End-to-End Encryption</span>
                <span>v3.0.4</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cash Manager Modal */}
      <AnimatePresence>
        {isCashModalOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="mt-6 p-6 glass rounded-[2rem] border-violet-500/30 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-bold text-white flex items-center gap-2 uppercase tracking-widest text-xs">
                {cashMode === 'deposit' ? <Plus className="text-violet-400" size={14} /> : <Minus className="text-violet-400" size={14} />}
                {cashMode === 'deposit' ? "Deposit Cash" : "Withdraw Cash"}
              </h4>
              <button onClick={() => { setIsCashModalOpen(false); setCashAmountInput(""); }} className="text-slate-500 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCashSubmit} className="space-y-4">
              <div>
                <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={cashAmountInput}
                  onChange={(e) => setCashAmountInput(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:ring-1 focus:ring-violet-500 outline-none"
                  required
                  min="0.01"
                />
              </div>
              <button
                type="submit"
                className={cn(
                  "w-full font-bold py-2.5 rounded-xl text-xs uppercase tracking-widest shadow-lg transition-all text-white",
                  cashMode === 'deposit'
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                    : "bg-red-600 hover:bg-red-500 shadow-red-500/20"
                )}
              >
                {cashMode === 'deposit' ? "Confirm Deposit" : "Confirm Withdrawal"}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Agent Sidebar */}
      <AnimatePresence>
        {isAIAgentPanelOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAIAgentPanelOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-white/10 z-[90] shadow-2xl flex flex-col pt-6 pb-8 px-4 md:pt-[calc(env(safe-area-inset-top)+1.5rem)] md:pb-[env(safe-area-inset-bottom)] md:px-6"
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-violet-500/20 p-3 rounded-2xl">
                    <Sparkles className="text-violet-400" size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">
                      <span className="md:hidden">AI</span>
                      <span className="hidden md:inline">AI Agent</span>
                    </h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                      <span className="md:hidden">Auto Trading</span>
                      <span className="hidden md:inline">Autonomous Trading</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsTargetsModalOpen(true)}
                    className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-all border border-white/5"
                    title="Manage Target Assets"
                  >
                    <Target size={18} />
                  </button>
                  <button
                    onClick={() => setIsAIAgentPanelOpen(false)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex-1 flex flex-col min-h-0 overflow-y-auto pr-1">
                {!vpData ? (
                  <div className="text-center p-8 border border-dashed border-slate-700 rounded-3xl relative">
                    <button
                      onClick={() => setIsTargetsModalOpen(true)}
                      className="absolute top-4 right-4 p-2 rounded-lg bg-white/5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-all border border-white/5 active:scale-95"
                      title="Configure Target Assets"
                    >
                      <Settings size={16} />
                    </button>
                    <div className="w-16 h-16 bg-gradient-to-br from-violet-600 to-fuchsia-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
                      <Sparkles className="text-white" size={32} />
                    </div>
                    <h3 className="text-white font-bold mb-2">AI Trading Challenge</h3>
                    <p className="text-slate-400 text-sm mb-6">
                      Let the AI manage a virtual portfolio starting with your chosen amount. It will trade autonomously based on its own market analysis signals.
                    </p>
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={handleInitAIChallenge}
                        disabled={isInitializingVP}
                        className="bg-white text-slate-900 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest hover:scale-105 transition-all shadow-xl"
                      >
                        {isInitializingVP ? "Initializing..." : "Start AI Challenge"}
                      </button>
                      <button
                        onClick={() => setIsTargetsModalOpen(true)}
                        className="text-[10px] text-violet-400 hover:text-violet-300 font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                      >
                        <Target size={12} /> Configure Target Assets
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* AI Stats - Compact Redesign */}
                    <div className="bg-gradient-to-br from-violet-900/50 to-fuchsia-900/20 border border-violet-500/20 rounded-3xl mb-6 relative overflow-hidden group shrink-0 p-4 md:p-5">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

                      <div className="absolute top-4 right-4 flex items-center gap-5 z-10">
                        <button
                          onClick={loadVirtualPortfolio}
                          className="p-3 rounded-xl bg-slate-900/60 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all shadow-lg border border-white/5 active:scale-90"
                          title="Refresh Prices"
                        >
                          <RefreshCw size={18} className={agentLoading ? "animate-spin" : ""} />
                        </button>
                        <button
                          onClick={handleResetAI}
                          className="p-3 rounded-xl bg-slate-900/60 text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all shadow-lg border border-white/5 active:scale-90"
                          title="Reset Challenge"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      <div className="mb-6">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-violet-300/80 mb-1">Total Portfolio Value</p>
                        <div className="font-black text-white font-mono leading-none text-3xl md:text-4xl tracking-tighter">
                          ${vpData.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Initial Investment Box */}
                        <div className="bg-black/30 rounded-2xl px-4 py-3 border border-white/5 flex flex-col justify-center">
                          <p className="text-[9px] text-violet-300/60 uppercase font-black tracking-widest mb-1">Initial Capital</p>
                          <p className="text-white font-mono font-bold leading-none text-lg">
                            ${(vpData.initialBalance || 600).toLocaleString()}
                          </p>
                        </div>

                        {/* Profit/Loss Box */}
                        <div className={cn(
                          "rounded-2xl px-4 py-3 border flex flex-col justify-center",
                          vpData.totalValue >= (vpData.initialBalance || 600)
                            ? "bg-emerald-500/10 border-emerald-500/20"
                            : "bg-red-500/10 border-red-500/20"
                        )}>
                          <p className={cn(
                            "text-[9px] uppercase font-black tracking-widest mb-1",
                            vpData.totalValue >= (vpData.initialBalance || 600) ? "text-emerald-400/60" : "text-red-400/60"
                          )}>Profit / Loss</p>
                          <div className="flex items-center gap-1.5">
                            <p className={cn(
                              "font-mono font-black leading-none text-lg",
                              vpData.totalValue >= (vpData.initialBalance || 600) ? "text-emerald-400" : "text-red-400"
                            )}>
                              {vpData.totalValue >= (vpData.initialBalance || 600) ? "+" : "-"}${Math.abs(vpData.totalValue - (vpData.initialBalance || 600)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <span className={cn(
                              "text-[10px] font-bold",
                              vpData.totalValue >= (vpData.initialBalance || 600) ? "text-emerald-500/50" : "text-red-500/50"
                            )}>
                              ({((vpData.totalValue - (vpData.initialBalance || 600)) / (vpData.initialBalance || 600) * 100).toFixed(1)}%)
                            </span>
                          </div>
                        </div>

                        {/* Cash Available */}
                        <div className="bg-black/20 rounded-2xl px-4 py-3 border border-white/5 flex flex-col justify-center">
                          <p className="text-[9px] text-violet-300/40 uppercase font-bold mb-1 tracking-wider">Cash Available</p>
                          <p className="text-white font-mono font-bold leading-none text-lg opacity-80">
                            ${(vpData.cashBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>

                        {/* Invested Assets */}
                        <div className="bg-black/20 rounded-2xl px-4 py-3 border border-white/5 flex flex-col justify-center">
                          <p className="text-[9px] text-violet-300/40 uppercase font-bold mb-1 tracking-wider">Invested Assets</p>
                          <p className="text-white font-mono font-bold leading-none text-lg opacity-80">
                            ${Math.max(0, vpData.totalValue - vpData.cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>

                      {/* Verification Badge */}
                      {Object.keys(vpPrices).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-violet-500/10 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <ShieldCheck size={10} className="text-emerald-400" />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/80">
                              Verified by {Object.values(vpPrices)[0]?.source || "Direct Exchange"}
                            </span>
                          </div>
                          <span className="text-[9px] font-mono text-violet-300/40">
                            {new Date(Object.values(vpPrices)[0]?.timestamp || Date.now()).toLocaleTimeString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Monitoring & Research Status */}
                    <div className="mb-8">
                      <MonitoringStatus />
                    </div>

                    {/* AI History Chart */}
                    {/* AI History Chart Button */}
                    {vpHistory.length > 1 && (
                      <div className="mb-3">
                        <button
                          onClick={() => setIsPerformanceChartOpen(true)}
                          className="w-full py-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-violet-500/30 transition-all flex items-center justify-center gap-2 group"
                        >
                          <TrendingUp className="text-violet-400 group-hover:scale-110 transition-transform" size={16} />
                          <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">View Performance Trend</span>
                        </button>
                      </div>
                    )}

                    {/* Recent AI Trades Button */}
                    <button
                      onClick={() => { setIsTradesModalOpen(true); setTradeLogPage(1); }}
                      className="w-full py-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all flex items-center justify-center gap-2 group"
                    >
                      <Activity className="text-blue-400 group-hover:scale-110 transition-transform" size={16} />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">View Trade Log</span>
                    </button>


                    {/* AI Decision Log */}
                    <div className="border-t border-white/5 mt-8 mb-6" />
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <Sparkles size={12} /> AI Decision Logic
                      </h3>
                      <span className="text-[10px] text-slate-600 font-mono uppercase tracking-widest">Reasoning Engine</span>
                    </div>
                    <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                      {vpDecisions.length === 0 ? (
                        <div className="text-center py-6 bg-white/[0.02] rounded-2xl border border-dashed border-white/5">
                          <p className="text-slate-500 text-[10px] italic">No decision records found.</p>
                        </div>
                      ) : (
                        vpDecisions.map((decision) => (
                          <div key={decision.id || Math.random()} className="flex gap-3 p-3 bg-white/[0.03] rounded-xl border border-white/5 hover:bg-white/[0.05] transition-colors">
                            <div className={cn(
                              "w-1 h-auto rounded-full",
                              decision.action === 'BUY' ? "bg-emerald-500" :
                                decision.action === 'SELL' ? "bg-red-500" :
                                  decision.action === 'HOLD' ? "bg-blue-500" : "bg-slate-600"
                            )} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-xs font-bold text-white flex items-center gap-2">
                                  {decision.ticker}
                                  <span className={cn(
                                    "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter opacity-80",
                                    decision.action === 'BUY' ? "bg-emerald-500/20 text-emerald-400" :
                                      decision.action === 'SELL' ? "bg-red-500/20 text-red-400" :
                                        decision.action === 'HOLD' ? "bg-blue-500/20 text-blue-400" : "bg-slate-500/20 text-slate-400"
                                  )}>
                                    {decision.action}
                                  </span>
                                </span>
                                <span className="text-[9px] text-slate-500 font-mono">
                                  {new Date(decision.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 leading-relaxed truncate group-hover:whitespace-normal group-hover:overflow-visible group-hover:bg-slate-900 group-hover:relative group-hover:z-10 transition-all">
                                {decision.reason}
                              </p>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-[9px] text-slate-600 font-bold uppercase">Score: {decision.score}</span>
                                {decision.price > 0 && <span className="text-[9px] text-slate-600 font-bold uppercase">Price: ${decision.price.toFixed(2)}</span>}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Explicit Reset Button */}
                    <button
                      onClick={handleResetAI}
                      className="w-full mt-8 py-3 rounded-xl border border-red-500/20 text-red-400 text-xs font-bold uppercase tracking-widest hover:bg-red-500/10 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 size={14} /> Reset & Clear All AI Data
                    </button>
                  </>
                )}
              </div>

              <div className="mt-auto pt-6 border-t border-white/5 opacity-50 flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 tracking-widest">
                <span>Autonomous System</span>
                <span>Active</span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Performance Chart Modal */}
      <AnimatePresence>
        {isPerformanceChartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPerformanceChartOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl px-4 z-[101]"
            >
              <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

                <div className="flex items-center justify-between mb-8 relative z-10">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <TrendingUp className="text-violet-400" size={24} />
                      Performance Trend
                    </h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Portfolio Value Over Time</p>
                  </div>
                  <button onClick={() => setIsPerformanceChartOpen(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-400 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="h-64 w-full relative z-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={vpHistory}>
                      <defs>
                        <linearGradient id="colorAIValueModal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.3} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px', color: '#fff' }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value?: number) => [`$${value?.toFixed(2) ?? '0.00'}`, 'Total Value']}
                        labelFormatter={(label) => new Date(label).toLocaleDateString() + ' ' + new Date(label).toLocaleTimeString()}
                      />
                      <XAxis
                        dataKey="date"
                        hide
                      />
                      <YAxis
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => `$${val}`}
                        tick={{ fill: '#64748b', fontSize: 10 }}
                        stroke="#334155"
                        tickLine={false}
                        axisLine={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalValue"
                        stroke="#8b5cf6"
                        fillOpacity={1}
                        fill="url(#colorAIValueModal)"
                        strokeWidth={3}
                        animationDuration={1000}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Trade Log Modal */}
      <AnimatePresence>
        {isTradesModalOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTradesModalOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100]"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl px-4 z-[101]"
            >
              <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden flex flex-col max-h-[80vh]">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2" />

                <div className="flex items-center justify-between mb-8 relative z-10 shrink-0">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Activity className="text-blue-400" size={24} />
                      AI Trade Log
                    </h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Live Execution History</p>
                  </div>
                  <button onClick={() => setIsTradesModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full text-slate-400 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 relative z-10 space-y-4">
                  {vpTrades.length === 0 ? (
                    <div className="text-center py-12 bg-white/[0.02] rounded-3xl border border-dashed border-white/5">
                      <p className="text-slate-500 text-sm italic">No trades recorded yet.</p>
                    </div>
                  ) : (
                    vpTrades.slice((tradeLogPage - 1) * 4, tradeLogPage * 4).map((trade) => (
                      <div key={trade.id} className="relative group p-4 bg-white/[0.03] rounded-2xl border border-white/5 hover:border-blue-500/20 transition-all">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs",
                              trade.type === 'BUY' ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                            )}>
                              {trade.ticker.slice(0, 2)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-bold text-lg">{trade.ticker}</span>
                                <span className={cn(
                                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                                  trade.type === 'BUY' ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                                )}>
                                  {trade.type}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500">{new Date(trade.date).toLocaleString([], { dateStyle: 'long', timeStyle: 'short' })}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-black text-white font-mono">${trade.total.toFixed(2)}</p>
                            <p className="text-xs text-slate-500">@{trade.price.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-slate-400 bg-black/20 p-3 rounded-xl border border-white/5 italic">
                          "{trade.reason}"
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Pagination Controls */}
                {vpTrades.length > 4 && (
                  <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between shrink-0 relative z-10">
                    <button
                      disabled={tradeLogPage === 1}
                      onClick={() => setTradeLogPage(p => Math.max(1, p - 1))}
                      className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" /> Prev
                    </button>
                    <span className="text-[10px] font-mono text-slate-500">
                      {tradeLogPage} / {Math.ceil(vpTrades.length / 4)}
                    </span>
                    <button
                      disabled={tradeLogPage >= Math.ceil(vpTrades.length / 4)}
                      onClick={() => setTradeLogPage(p => p + 1)}
                      className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Sidebar */}
      <AnimatePresence>
        {isSettingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-white/10 z-[90] shadow-2xl p-6 overflow-y-auto flex flex-col"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                  <Settings className="text-blue-400" size={24} />
                  System Settings
                </h2>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-8">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Account Security</h3>
                  <div className="p-4 rounded-2xl bg-black/20 border border-white/5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-white">Google Authorization</p>
                      <p className="text-[10px] text-slate-500 font-mono uppercase mt-1">Status: Active & Secure</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <ShieldCheck size={16} className="text-emerald-400" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500 mb-4">Asset Management</h3>
                  <button
                    onClick={handleResetCash}
                    className="w-full p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-between group hover:bg-red-500/20 transition-all"
                  >
                    <div className="text-left">
                      <p className="text-sm font-bold text-red-400 group-hover:text-red-300 transition-colors">Reset Portfolio Cash</p>
                      <p className="text-[10px] text-slate-600 font-mono uppercase mt-1">Purge legacy US/USD data</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Trash2 size={16} className="text-red-400" />
                    </div>
                  </button>
                </div>
              </div>

              <div className="mt-auto text-center py-8">
                <p className="text-[10px] text-slate-600 uppercase font-black tracking-[0.3em]">Traffic Light Terminal</p>
                <p className="text-[10px] text-slate-700 mt-2 font-mono">Build ID: {Date.now().toString(16).toUpperCase()}</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Library Sidebar */}
      <AnimatePresence>
        {isLibraryOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLibraryOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900 border-l border-white/10 z-[90] shadow-2xl p-6 overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                  <Library className="text-blue-400" size={24} />
                  Intelligence Library
                </h2>
                <div className="flex items-center gap-2">
                  {libraryReports.length > 0 && (
                    <button
                      onClick={handleClearLibrary}
                      className="p-2 hover:bg-red-500/10 rounded-full text-red-500/60 hover:text-red-500 transition-colors"
                      title="Delete all reports"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsLibraryOpen(false)}
                    className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {libraryReports.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <p>Your research library is empty.</p>
                    <p className="text-xs mt-2 uppercase tracking-widest">Analyze a ticker to start saving data.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4">
                      {libraryReports
                        .slice((currentPage - 1) * reportsPerPage, currentPage * reportsPerPage)
                        .map((report) => (
                          <button
                            key={report.id}
                            onClick={() => {
                              setResult(report);
                              setIsLibraryOpen(false);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="w-full text-left glass p-4 rounded-2xl border-white/5 hover:border-blue-500/50 transition-all group relative"
                          >
                            <button
                              onClick={(e) => handleDeleteReport(e, report.id)}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
                              title="Delete report"
                            >
                              <Trash2 size={12} />
                            </button>
                            <div className="flex justify-between items-start mb-2 pr-6">
                              <span className="font-bold text-lg text-white">{report.name} ({report.ticker})</span>
                              <div className={cn(
                                "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                report.trafficLight === "GREEN" ? "bg-emerald-500/20 text-emerald-400" :
                                  report.trafficLight === "AMBER" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"
                              )}>
                                {report.overallScore}/100
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                              <span>{new Date(report.savedAt).toLocaleString('en-GB')}</span>
                              <span className="group-hover:text-blue-400 transition-colors uppercase tracking-tighter">View Report</span>
                            </div>
                          </button>
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {libraryReports.length > reportsPerPage && (
                      <div className="mt-8 flex items-center justify-between border-t border-white/5 pt-6">
                        <button
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" /> Prev
                        </button>
                        <span className="text-[10px] font-mono text-slate-500">
                          {currentPage} / {Math.ceil(libraryReports.length / reportsPerPage)}
                        </span>
                        <button
                          disabled={currentPage >= Math.ceil(libraryReports.length / reportsPerPage)}
                          onClick={() => setCurrentPage(p => p + 1)}
                          className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                        >
                          Next <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Navigation / Header */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
        <div className="flex items-center gap-3 md:gap-6 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3 glass px-3 py-1.5 rounded-full border-white/5">
            <div className="w-6 h-6 rounded-full overflow-hidden bg-blue-500/20 flex items-center justify-center border border-white/10 flex-shrink-0">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ""} className="w-full h-full object-cover" />
              ) : (
                <Users size={12} className="text-blue-400" />
              )}
            </div>
            <span className="text-xs font-bold text-slate-300 truncate max-w-[80px] md:max-w-none">
              {user.displayName ? user.displayName.split(' ')[0] : 'User'}
            </span>
            <button
              onClick={logout}
              className="text-[10px] uppercase font-black text-slate-500 hover:text-red-400 transition-colors ml-1 md:ml-2 flex-shrink-0"
            >
              Logout
            </button>
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block" />

          <div className="flex items-center gap-2 opacity-60">
            <ShieldCheck size={18} className="text-blue-400 md:w-5 md:h-5" />
            <span className="font-mono text-[10px] md:text-xs font-bold uppercase tracking-widest text-white truncate max-w-[120px] md:max-w-none">System v3.0</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto">
          <button
            onClick={() => setIsAIAgentPanelOpen(true)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 glass rounded-xl border-white/10 hover:border-violet-500/50 transition-all text-sm font-bold text-slate-300"
          >
            <Sparkles size={18} className="text-violet-400" />
            <span><span className="md:hidden">AI</span><span className="hidden md:inline">AI Agent</span></span>
          </button>

          <button
            onClick={() => setIsPortfolioOpen(true)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 glass rounded-xl border-white/10 hover:border-blue-500/50 transition-all text-sm font-bold text-slate-300"
          >
            <Briefcase size={18} className="text-emerald-400" />
            <span>Portfolio</span>
          </button>

          <button
            onClick={() => setIsLibraryOpen(true)}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 glass rounded-xl border-white/10 hover:border-blue-500/50 transition-all text-sm font-bold text-slate-300"
          >
            <Library size={18} className="text-blue-400" />
            <span>Library <span className="hidden sm:inline">({libraryReports.length})</span></span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center justify-center p-2.5 glass rounded-xl border-white/10 hover:border-blue-500/50 transition-all text-slate-300"
            title="System Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="text-center mb-16 md:mb-12 mt-32 md:mt-24">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 md:mb-8 pb-2 leading-tight bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent"
        >
          Crypto Traffic <br className="sm:hidden" /> Light System
        </motion.h1>
        <p className="text-slate-400 text-base md:text-lg max-w-2xl mx-auto flex flex-col gap-2 mt-4 px-4">
          <span>AI-powered technical analysis<span className="hidden sm:inline"> for small investors</span>.</span>
          <span className="text-blue-400 font-semibold tracking-wide uppercase text-xs md:text-sm">The 60/40 rule of safety and timing</span>
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="max-w-md mx-auto mb-24 md:mb-16 relative">
        <div className="relative group">
          <input
            type="text"
            placeholder={isMobile ? "Enter Ticker (e.g. BTC)" : "Enter Ticker (e.g. BTC, ETH, SOL)"}
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl py-4 px-6 pl-12 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-white placeholder-slate-500"
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={20} />
          <button
            disabled={loading}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-xl transition-all disabled:opacity-50 font-medium"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : "Analyze"}
          </button>
        </div>
      </form>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-8"
          >
            {/* Archived Status Banner */}
            {result.savedAt && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-500/20 p-2 rounded-lg">
                    <Library className="text-blue-400" size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-wider">Archived Intelligence Report</h4>
                    <p className="text-xs text-slate-400">This report was generated on {new Date(result.savedAt).toLocaleString('en-GB')}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setTicker(result.ticker);
                    handleSearch(new Event('submit') as any);
                  }}
                  className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Run Fresh Analysis
                </button>
              </div>
            )}
            {/* Price & Signal Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

              {/* Traffic Light Signal */}
              <div className="glass rounded-3xl p-8 flex flex-col items-center justify-center text-center">
                <h3 className="text-slate-400 font-medium mb-6 flex items-center gap-2">
                  <Activity size={18} /> Market Action Signal
                </h3>

                <div className="flex flex-col gap-4 bg-black/40 p-6 rounded-3xl border border-white/5 relative">
                  <div className={cn(
                    "w-16 h-16 rounded-full transition-all duration-500",
                    result.trafficLight === "RED" ? "bg-red-500 traffic-light-shadow-red" : "bg-slate-800"
                  )} />
                  <div className={cn(
                    "w-16 h-16 rounded-full transition-all duration-500",
                    result.trafficLight === "AMBER" ? "bg-amber-500 traffic-light-shadow-amber" : "bg-slate-800"
                  )} />
                  <div className={cn(
                    "w-16 h-16 rounded-full transition-all duration-500",
                    result.trafficLight === "GREEN" ? "bg-emerald-500 traffic-light-shadow-green" : "bg-slate-800"
                  )} />
                </div>

                <div className="mt-8">
                  <span className={cn(
                    "text-4xl font-black italic tracking-tighter",
                    result.trafficLight === "RED" && "text-red-500",
                    result.trafficLight === "AMBER" && "text-amber-500",
                    result.trafficLight === "GREEN" && "text-emerald-500",
                  )}>
                    {result.trafficLight === "RED" ? "ACT WITH CAUTION" : result.trafficLight === "AMBER" ? "WAIT / HOLD" : "ACT NOW"}
                  </span>
                  <div className="mt-2 text-slate-500 font-mono">Score: {result.overallScore}/100</div>
                </div>
              </div>

              {/* Market Stats Grid */}
              <div className="glass rounded-3xl p-6 md:p-8 lg:col-span-2 flex flex-col">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 md:10 gap-6">
                  <div className="w-full sm:w-auto">
                    <h2 className="text-2xl md:text-4xl font-bold flex items-center gap-2 md:gap-3">
                      {result.name}
                      <span className="text-slate-500 text-lg md:text-xl font-normal tracking-wider lowercase">{result.ticker}</span>
                    </h2>
                    <div className="flex items-center gap-3 md:gap-4 mt-2">
                      <span className="text-3xl md:text-5xl font-mono font-bold tracking-tight text-white">
                        ${formatPrice(result.currentPrice)}
                      </span>
                      <span className={cn(
                        "text-sm md:text-lg font-bold px-3 py-1 md:px-4 md:py-1.5 rounded-xl flex items-center gap-1",
                        result.priceChange24h >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                      )}>
                        {result.priceChange24h >= 0 ? <TrendingUp size={16} /> : <TrendingUp size={16} className="rotate-180" />}
                        {Math.abs(result.priceChange24h)}%
                      </span>
                    </div>
                    {/* Verification Badge & Portfolio Holding */}
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full flex items-center gap-2">
                        <ShieldCheck size={14} className="text-emerald-400" />
                        <span className="text-[9px] md:text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate max-w-[200px]">
                          {result.verificationStatus}
                        </span>
                      </div>

                      {portfolioItems.find(p => p.ticker.toUpperCase() === result.ticker.toUpperCase()) && (
                        <div className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center gap-2">
                          <Briefcase size={12} className="text-emerald-400" />
                          <span className="text-[9px] md:text-[10px] text-emerald-400 font-bold uppercase tracking-widest">
                            Holding: {portfolioItems.find(p => p.ticker.toUpperCase() === result.ticker.toUpperCase())?.amount.toLocaleString()} ({itemValue(portfolioItems.find(p => p.ticker.toUpperCase() === result.ticker.toUpperCase())!)})
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="w-full sm:w-auto bg-slate-900/50 border border-slate-800 p-4 md:p-6 rounded-2xl sm:min-w-[200px]">
                    <div className="text-slate-500 font-bold uppercase tracking-[0.2em] mb-1 md:mb-2 text-[9px] md:text-[10px]">Market Cap</div>
                    <div className="text-lg md:text-2xl font-mono font-bold text-blue-400">
                      ${result.marketCap >= 1e9
                        ? (result.marketCap / 1e9).toFixed(2) + "B"
                        : (result.marketCap / 1e6).toFixed(2) + "M"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4 mt-auto">
                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2">Daily Low</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-red-400/90">${formatPrice(result.dailyLow)}</div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2">Daily High</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-emerald-400/90">${formatPrice(result.dailyHigh)}</div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">7D Avg</div>
                    <div className="text-lg md:text-xl font-mono font-bold">{result.price7dAvg > 0 ? `$${formatPrice(result.price7dAvg)}` : "N/A"}</div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">30D Avg</div>
                    <div className="text-lg md:text-xl font-mono font-bold">{result.price30dAvg > 0 ? `$${formatPrice(result.price30dAvg)}` : "N/A"}</div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">ATH</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-amber-400">${formatPrice(result.allTimeHigh)}</div>
                    <div className="text-[9px] text-slate-500 font-medium font-mono">{result.athDate || "N/A"}</div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">ATL</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-violet-400">${formatPrice(result.allTimeLow)}</div>
                    <div className="text-[9px] text-slate-500 font-medium font-mono">{result.atlDate || "N/A"}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Research Summary Section */}
            <div className="glass rounded-3xl p-6 md:p-8 flex flex-col items-center gap-4 md:gap-8">
              <div className="w-full h-64 md:h-80 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                      itemStyle={{ color: '#f8fafc' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] md:text-sm text-slate-500 uppercase font-bold tracking-widest">Research</span>
                  <span className="text-xl md:text-3xl font-bold text-white">Full Mix</span>
                </div>
              </div>

              <div className="w-full max-w-2xl text-center px-2">
                <h3 className="text-xl md:text-2xl font-bold mb-3 md:mb-4 underline underline-offset-8 decoration-blue-500/30">Analysis Summary</h3>
                <p className="text-slate-400 text-sm md:text-lg leading-relaxed italic text-justify">
                  {result.summary}
                </p>
                <div className="mt-6 md:mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6 max-w-md mx-auto">
                  <div className="bg-blue-500/10 border border-blue-500/20 p-3 md:p-4 rounded-2xl">
                    <div className="text-[9px] md:text-xs text-blue-400 font-bold uppercase tracking-wider mb-1">Fundamentals</div>
                    <div className="text-lg md:text-2xl font-bold">60% Weight</div>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 md:p-4 rounded-2xl">
                    <div className="text-[9px] md:text-xs text-emerald-400 font-bold uppercase tracking-wider mb-1">Technicals</div>
                    <div className="text-lg md:text-2xl font-bold">40% Weight</div>
                  </div>
                </div>
              </div>

              {/* Historical Trend Insight */}
              {result.historicalInsight && (
                <div className="w-full max-w-3xl mt-6 pt-6 border-t border-white/5 text-center">
                  <h4 className="text-sm font-bold uppercase tracking-widest text-violet-400 mb-3 flex items-center justify-center gap-2">
                    <Activity size={16} /> Historical Trend Analysis
                  </h4>
                  <p className="text-slate-300 italic text-sm md:text-base leading-relaxed bg-violet-500/5 border border-violet-500/10 p-4 rounded-xl text-justify">
                    &quot;{result.historicalInsight}&quot;
                  </p>
                </div>
              )}
            </div>

            {/* Signals Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {result.signals.map((signal, idx: number) => (
                <motion.div
                  key={signal.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="glass rounded-2xl p-4 hover:border-blue-500/50 transition-all cursor-default group"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className={cn(
                      "w-3 h-3 rounded-full",
                      signal.status === "RED" ? "bg-red-500" : signal.status === "AMBER" ? "bg-amber-500" : "bg-emerald-500"
                    )} />
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{signal.category}</span>
                  </div>
                  <h4 className="text-sm font-bold mb-1 truncate">{signal.name}</h4>
                  <div className="text-xs text-slate-400 mb-2">{signal.weight}% Weight</div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mb-3">
                    <div
                      className={cn(
                        "h-full transition-all duration-1000",
                        signal.status === "RED" ? "bg-red-500" : signal.status === "AMBER" ? "bg-amber-500" : "bg-emerald-500"
                      )}
                      style={{ width: `${signal.score}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-400 line-clamp-3 group-hover:line-clamp-none transition-all">
                    {signal.whyItMatters}
                  </div>
                </motion.div>
              ))}
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      {
        !result && !loading && (
          <div className="mt-20 hidden md:grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
              <ShieldCheck className="mx-auto mb-4 text-blue-400" size={32} />
              <h4 className="font-bold mb-2">Safety First</h4>
              <p className="text-xs text-slate-500">60% focus on fundamentals to ensure long-term value preservation.</p>
            </div>
            <div className="text-center p-6 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
              <TrendingUp className="mx-auto mb-4 text-emerald-400" size={32} />
              <h4 className="font-bold mb-2">Perfect Timing</h4>
              <p className="text-xs text-slate-500">40% focus on technical indicators to optimize entry and exit points.</p>
            </div>
            <div className="text-center p-6 grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
              <Users className="mx-auto mb-4 text-purple-400" size={32} />
              <h4 className="font-bold mb-2">Social Pulse</h4>
              <p className="text-xs text-slate-500">Real-time analysis of Fear & Greed to capitalize on market sentiment.</p>
            </div>
          </div>
        )
      }
      {/* Portfolio Consultation Modal (Visual Process) */}
      <AnimatePresence>
        {isAgentOpen && !agentResult && (
          <PortfolioConsultationModal
            isOpen={isAgentOpen}
            onClose={() => setIsAgentOpen(false)}
            portfolioItems={portfolioItems}
            watchlist={agentTargets}
            userId={user?.uid || ''}
            onResult={(res) => setAgentResult(res)}
          />
        )}
      </AnimatePresence>

      {/* AI Agent Modal */}
      <AnimatePresence>
        {isAgentOpen && agentResult && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAgentOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-[2.5rem] p-8 md:p-12 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
            >
              <button
                onClick={() => setIsAgentOpen(false)}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/5 transition-colors text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>

              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-blue-500" />

              <div className="flex items-center gap-4 mb-8">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <Sparkles className="text-white" size={32} />
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white">Portfolio Agent</h2>
                  <p className="text-slate-400 text-sm">AI-Powered Strategic Consultant</p>
                </div>
              </div>

              <div className="space-y-8">
                {/* Verified Data Source Display */}
                {agentResult.verifiedPrices && Object.keys(agentResult.verifiedPrices).length > 0 && (
                  <div className="bg-emerald-500/5 rounded-2xl p-4 border border-emerald-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <ShieldCheck className="text-emerald-400" size={16} />
                      <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-500">Verified Live Data Source</h4>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {Object.entries(agentResult.verifiedPrices).map(([ticker, price]) => (
                        <div key={ticker} className="bg-slate-900/50 rounded-lg p-2 text-center border border-emerald-500/10">
                          <div className="text-[10px] font-bold text-slate-500">{ticker}</div>
                          <div className="text-xs font-mono font-bold text-emerald-400">${price.price?.toLocaleString() || price.toLocaleString()}</div>
                          {price.source && <div className="text-[8px] text-slate-600 mt-1">{price.source}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3">Market Overview</h4>
                  <p className="text-slate-300 leading-relaxed italic text-justify">&quot;{agentResult.summary}&quot;</p>
                </div>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Strategic Moves</h4>
                  {agentResult.suggestions.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl">
                      <ShieldCheck className="mx-auto text-emerald-500 mb-3" size={32} />
                      <p className="text-white font-bold">No Actions Recommended</p>
                      <p className="text-sm text-slate-500 mt-1">Your portfolio is currently positioned optimally.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {agentResult.suggestions.map((move, i) => (
                        <div key={i} className="glass p-6 rounded-2xl border-white/10 flex flex-col md:flex-row gap-6 items-start md:items-center">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className={cn(
                                "px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                                move.action === "SWITCH" ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"
                              )}>{move.action}</span>
                              <span className="text-xs font-bold text-slate-400">Confidence: {move.confidenceScore}%</span>
                            </div>
                            <h4 className="text-lg font-bold text-white mb-2">
                              {move.action === "SWITCH"
                                ? <span>Sell <span className="text-red-400">{move.percentage}% of {move.sellTicker}</span> to Buy <span className="text-emerald-400">{move.buyTicker}</span></span>
                                : <span>{move.action} {move.buyTicker || move.sellTicker}</span>
                              }
                            </h4>
                            <p className="text-sm text-slate-400 text-justify">{move.reason}</p>
                          </div>
                          <div className="shrink-0 w-full md:w-auto">
                            <button className="w-full md:w-auto px-6 py-3 bg-white text-slate-900 font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-slate-200 transition-colors">
                              Prepare Trade
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* AI Agent Targets Modal */}
      <AnimatePresence>
        {isTargetsModalOpen && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Target className="text-violet-400" /> AI Target Assets
                </h3>
                <button
                  onClick={() => setIsTargetsModalOpen(false)}
                  className="p-2 rounded-xl hover:bg-white/5 text-slate-400 transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTargetTicker}
                    onChange={(e) => setNewTargetTicker(e.target.value.toUpperCase())}
                    placeholder="ENTER TICKER (e.g. SOL)"
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-violet-500/50 transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTarget()}
                  />
                  <button
                    onClick={handleAddTarget}
                    className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-3 rounded-xl font-bold transition-all"
                  >
                    <Plus size={20} />
                  </button>
                </div>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {agentTargets.map((t) => (
                    <div key={t} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 group">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 font-bold text-xs">
                          {t.slice(0, 2)}
                        </div>
                        <span className="text-white font-bold">{t}</span>
                      </div>
                      <button
                        onClick={() => handleRemoveTarget(t)}
                        className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  {agentTargets.length === 0 && (
                    <p className="text-center text-slate-500 text-sm py-4 italic">No targets defined. AI will use defaults.</p>
                  )}
                </div>

                <div className="pt-4 border-t border-white/5">
                  <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-slate-500">
                    <span>Active Targets</span>
                    <span className={cn(agentTargets.length >= 15 ? "text-red-400" : "text-violet-400")}>
                      {agentTargets.length} / 15
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main >
  );
}
