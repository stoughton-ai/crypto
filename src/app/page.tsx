"use client";

import { useState, useEffect } from "react";
import { analyzeCrypto, getLegacyReports, deleteLegacyFile, getSimplePrices, getVerifiedPrices } from "./actions";
import { type CryptoAnalysisResult } from "@/lib/gemini";
import { useAuth } from "@/context/AuthContext";
import { fetchLibrary, saveToLibrary, deleteReport, migrateLegacyLibrary, clearLibrary, type LibraryReport } from "@/services/libraryService";
import { fetchPortfolio, addToPortfolio, removeFromPortfolio, updatePortfolioItem, recordPortfolioSnapshot, fetchPortfolioHistory, clearPortfolio, recordTrade, fetchRealizedTrades, type PortfolioItem, type PortfolioSnapshot, type RealizedTrade } from "@/services/portfolioService";
import { PieChart, Pie, Cell, AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { Search, Info, TrendingUp, ShieldCheck, Activity, Users, Github, Wallet, BarChart3, AlertCircle, Loader2, Library, Trash2, X, ChevronLeft, ChevronRight, Briefcase, Plus, TrendingDown, ArrowUpRight, ArrowDownRight, Coins, RefreshCw, Edit, Minus, DollarSign } from "lucide-react";
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
  const [error, setError] = useState("");
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [libraryReports, setLibraryReports] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const reportsPerPage = 5;

  // Modal State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'confirm' | 'alert' | 'danger';
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: 'alert'
  });

  // Portfolio State
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [portfolioPrices, setPortfolioPrices] = useState<Record<string, number>>({});
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [realizedTrades, setRealizedTrades] = useState<RealizedTrade[]>([]);
  const [isAddingAsset, setIsAddingAsset] = useState(false);
  const [editingAsset, setEditingAsset] = useState<PortfolioItem | null>(null);
  const [sellingAsset, setSellingAsset] = useState<PortfolioItem | null>(null);
  const [newAsset, setNewAsset] = useState({ ticker: "", amount: "", price: "", date: "" });
  const [sellData, setSellData] = useState({ amount: "", price: "", date: "" });
  const [lastLoggedValue, setLastLoggedValue] = useState<number | null>(null);
  const [isRevaluing, setIsRevaluing] = useState(false);

  // Auto-Retry State
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (user) {
      loadLibrary();
      loadPortfolio();
      loadPortfolioHistory();
      loadRealizedTrades();
    }
  }, [user]);

  useEffect(() => {
    if (isPortfolioOpen && user && portfolioItems.length > 0) {
      const totalValue = portfolioItems.reduce((acc, item) => acc + (item.amount * (portfolioPrices[item.ticker] || item.averagePrice)), 0);
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
    if (portfolioItems.length > 0) {
      updatePortfolioPrices();
      const interval = setInterval(updatePortfolioPrices, 30000); // Update prices every 30s
      return () => clearInterval(interval);
    }
  }, [portfolioItems.length]);

  const loadLibrary = async () => {
    if (!user) return;

    // 1. Check for legacy reports to migrate
    const legacy = await getLegacyReports();
    if (legacy.length > 0) {
      await migrateLegacyLibrary(user.uid, legacy);
      await deleteLegacyFile(); // Wipe local file once migrated to cloud
    }

    const data = await fetchLibrary(user.uid);

    // Deduplicate in case of race condition during migration
    const uniqueReports = data.reduce((acc: any[], current: any) => {
      const x = acc.find(item => item.ticker === current.ticker && item.savedAt === current.savedAt);
      if (!x) return acc.concat([current]);
      return acc;
    }, []);

    setLibraryReports(uniqueReports);
  };

  const itemValue = (item: PortfolioItem) => {
    const currentPrice = portfolioPrices[item.ticker] || item.averagePrice;
    return `$${(item.amount * currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const loadPortfolio = async () => {
    if (!user) return;
    const data = await fetchPortfolio(user.uid);
    setPortfolioItems(data);
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

  const updatePortfolioPrices = async () => {
    const tickers = portfolioItems.map(item => item.ticker);
    if (tickers.length === 0) return;
    const prices = await getSimplePrices(tickers);
    setPortfolioPrices(prices);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newAsset.ticker || !newAsset.amount || !newAsset.price) return;

    try {
      if (editingAsset) {
        // Update existing
        await updatePortfolioItem(editingAsset.id, {
          ticker: newAsset.ticker,
          amount: parseFloat(newAsset.amount),
          averagePrice: parseFloat(newAsset.price),
          tradeDate: newAsset.date ? new Date(newAsset.date).toISOString() : editingAsset.tradeDate
        });
      } else {
        // Create new
        await addToPortfolio(
          user.uid,
          newAsset.ticker,
          parseFloat(newAsset.amount),
          parseFloat(newAsset.price),
          newAsset.date ? new Date(newAsset.date).toISOString() : new Date().toISOString()
        );
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
    const currentPrice = portfolioPrices[item.ticker];
    setSellData({
      amount: item.amount.toString(),
      price: currentPrice ? currentPrice.toString() : "",
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
      message: "Are you sure you want to delete ALL assets from your portfolio tracking? This cannot be undone.",
      type: "danger",
      onConfirm: async () => {
        await clearPortfolio(user.uid);
        loadPortfolio();
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
    setError("");
    try {
      // 1. Get history context from existing reports for this ticker
      const tickerHistory = libraryReports
        .filter((r: any) => r.ticker.toUpperCase() === ticker.toUpperCase())
        .slice(0, 3);

      const historyContextString = tickerHistory.length > 0
        ? `You have analyzed this asset before. Previous Scores: ${tickerHistory.map((h: any) => `${h.overallScore}/100 on ${new Date(h.savedAt).toLocaleDateString('en-GB')}`).join(", ")}. USE THIS to identify if the sentiment or fundamentals are IMPROVING or DECLINING compared to previous reports.`
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
      setError("Failed to fetch analysis. Ensure your API key is configured.");
      console.error(err);
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
      const verifiedPrices = await getVerifiedPrices(tickers);
      setPortfolioPrices(prev => ({ ...prev, ...verifiedPrices }));

      // Update snapshot immediately with confirmed values
      const totalValue = portfolioItems.reduce((acc, item) => acc + (item.amount * (verifiedPrices[item.ticker] || item.averagePrice)), 0);
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
    }
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
                <p className="text-slate-400 text-sm leading-relaxed mb-8">{modalConfig.message}</p>

                <div className="flex gap-3">
                  {modalConfig.type !== 'alert' && (
                    <button
                      onClick={() => setModalConfig({ ...modalConfig, isOpen: false })}
                      className="flex-1 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest bg-white/5 text-slate-400 hover:bg-white/10 transition-all"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (modalConfig.onConfirm) modalConfig.onConfirm();
                      setModalConfig({ ...modalConfig, isOpen: false });
                    }}
                    className={cn(
                      "flex-1 px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-widest transition-all shadow-lg",
                      modalConfig.type === 'danger' ? "bg-red-600 text-white hover:bg-red-500 shadow-red-600/20" : "bg-blue-600 text-white hover:bg-blue-500 shadow-blue-600/20"
                    )}
                  >
                    {modalConfig.type === 'alert' ? 'Understood' : 'Confirm'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Progress Notification */}
      <AnimatePresence>
        {(loading || retryCountdown !== null || isRevaluing) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={cn("fixed bottom-8 z-[150]", isMobile ? "left-1/2 -translate-x-1/2" : "right-8")}
          >
            <div className={cn(
              "glass rounded-2xl p-6 shadow-2xl border-blue-500/30 flex items-center gap-4 min-w-[320px]",
              retryCountdown !== null && "border-amber-500/30"
            )}>
              <div className="relative">
                <Loader2 className={cn("animate-spin", retryCountdown !== null ? "text-amber-400" : "text-blue-400")} size={24} />
                <div className={cn("absolute inset-0 animate-ping rounded-full", retryCountdown !== null ? "bg-amber-400/20" : "bg-blue-400/20")} />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">
                  {retryCountdown !== null ? "Intelligence Refinement" : isRevaluing ? "Verifying Asset Valuations" : "AI Analyst at Work"}
                </h4>
                <p className="text-xs text-slate-400 animate-pulse">
                  {retryCountdown !== null
                    ? `Low confidence data detected. Retrying in ${retryCountdown}s...`
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
                <button
                  onClick={() => setIsPortfolioOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors"
                >
                  <X size={20} />
                </button>
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

              {/* Portfolio Stats */}
              <div className="relative bg-emerald-500/5 border border-emerald-500/20 rounded-3xl p-6 mb-8 group">
                <button
                  onClick={handleRevaluePortfolio}
                  disabled={isRevaluing}
                  className="absolute top-4 right-4 p-2 rounded-xl bg-slate-900/50 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-50 disabled:animate-pulse"
                  title="Force Revaluation (Confirmed Data)"
                >
                  <RefreshCw size={16} className={cn(isRevaluing && "animate-spin")} />
                </button>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-500/60 mb-1">Total Balance</p>
                <div className="text-3xl font-black text-white font-mono">
                  ${portfolioItems.reduce((acc, item) => acc + (item.amount * (portfolioPrices[item.ticker] || item.averagePrice)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className={cn(
                    "flex items-center gap-1 text-sm font-bold",
                    portfolioItems.reduce((acc, item) => acc + (item.amount * ((portfolioPrices[item.ticker] || item.averagePrice) - item.averagePrice)), 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {portfolioItems.reduce((acc, item) => acc + (item.amount * ((portfolioPrices[item.ticker] || item.averagePrice) - item.averagePrice)), 0) >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                    ${Math.abs(portfolioItems.reduce((acc, item) => acc + (item.amount * ((portfolioPrices[item.ticker] || item.averagePrice) - item.averagePrice)), 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">All Time PNL</span>
                </div>
                {/* Realized PNL Display */}
                {realizedTrades.length > 0 && (
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-emerald-500/20">
                    <div className={cn(
                      "flex items-center gap-1 text-sm font-bold",
                      realizedTrades.reduce((acc, t) => acc + t.realizedPnl, 0) >= 0 ? "text-blue-400" : "text-red-400"
                    )}>
                      <DollarSign size={16} />
                      ${realizedTrades.reduce((acc, t) => acc + t.realizedPnl, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Realized Profits</span>
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
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="glass p-2 border-white/10 rounded-lg text-[10px] font-mono">
                                  <p className="text-slate-400">{new Date(payload[0].payload.timestamp).toLocaleDateString()}</p>
                                  <p className="text-emerald-400 font-bold">${payload[0].value?.toLocaleString()}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
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

              {/* Asset List */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">My Assets</h3>
                  <button
                    onClick={() => setIsAddingAsset(true)}
                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <Plus size={14} /> Add Asset
                  </button>
                </div>

                <div className="space-y-3 overflow-y-auto pr-2 pb-6 custom-scrollbar">
                  {portfolioItems.length === 0 ? (
                    <div className="text-center py-12 border border-dashed border-white/5 rounded-3xl">
                      <p className="text-slate-500 text-sm">No assets tracked yet.</p>
                      <button
                        onClick={() => setIsAddingAsset(true)}
                        className="mt-4 text-xs font-bold text-blue-400 hover:underline"
                      >
                        Start tracking your holdings
                      </button>
                    </div>
                  ) : (
                    portfolioItems.map((item) => {
                      const currentPrice = portfolioPrices[item.ticker];
                      const value = item.amount * (currentPrice || item.averagePrice);
                      const pnl = currentPrice ? (currentPrice - item.averagePrice) * item.amount : 0;
                      const pnlPct = currentPrice ? ((currentPrice - item.averagePrice) / item.averagePrice) * 100 : 0;

                      return (
                        <div key={item.id} className="glass rounded-2xl border-white/5 hover:border-emerald-500/30 transition-all group overflow-hidden">
                          <div className="p-5">
                            <div className="flex justify-between items-start mb-6">
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center font-black text-sm text-slate-300 shadow-inner">
                                  {item.ticker.slice(0, 2)}
                                </div>
                                <div>
                                  <h4 className="font-black text-white text-xl leading-tight tracking-tight">{item.ticker}</h4>
                                  <p className="text-[11px] text-slate-400 font-mono uppercase tracking-wider mt-0.5">{item.amount.toLocaleString()} Units</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-mono font-black text-white tracking-tight">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                <div className={cn(
                                  "text-[10px] font-bold flex items-center justify-end gap-1 mb-1 bg-white/5 px-2 py-0.5 rounded-lg inline-flex ml-auto mt-1",
                                  pnl >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"
                                )}>
                                  {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({Math.abs(pnlPct).toFixed(1)}%)
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 bg-black/20 rounded-xl p-3 border border-white/5">
                              <div className="text-center">
                                <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Buy Price</div>
                                <div className="text-xs font-mono font-bold text-slate-300">${item.averagePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                              </div>
                              <div className="text-center border-l border-white/5">
                                <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Live Price</div>
                                <div className="text-xs font-mono font-bold text-emerald-400">
                                  ${currentPrice ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "..."}
                                </div>
                              </div>
                              <div className="text-center border-l border-white/5">
                                <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500 mb-1">Date</div>
                                <div className="text-xs font-mono font-bold text-slate-400">
                                  {item.tradeDate ? new Date(item.tradeDate).toLocaleDateString('en-GB') : "N/A"}
                                </div>
                              </div>
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
            <span className="font-mono text-[10px] md:text-xs font-bold uppercase tracking-widest text-white truncate max-w-[120px] md:max-w-none">System v2.4</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 w-full md:w-auto">
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
        {error && <p className="text-red-400 mt-2 text-sm text-center">{error}</p>}
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


              {/* Mobile Only: Report Ready Info */}
              {isMobile && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-2xl p-4 flex items-center gap-3 border border-blue-500/30 bg-blue-500/5 mb-8"
                >
                  <Info className="text-blue-400 shrink-0" size={24} />
                  <div className="text-left">
                    <h4 className="font-bold text-white text-sm">Analysis Complete</h4>
                    <p className="text-xs text-slate-400">Your full intelligence report is ready below.</p>
                  </div>
                </motion.div>
              )}

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

                <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-auto">
                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors group relative">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">
                      7D Avg <Info size={10} className="hidden xs:block opacity-50" />
                    </div>
                    <div className="text-lg md:text-xl font-mono font-bold">
                      {result.price7dAvg > 0 ? `$${formatPrice(result.price7dAvg)}` : "N/A"}
                    </div>
                    <div className={cn(
                      "text-xs font-bold",
                      (result.price7dAvg > 0 && result.currentPrice >= result.price7dAvg) ? "text-emerald-500" : "text-red-500"
                    )}>
                      {result.price7dAvg > 0
                        ? `${(((result.currentPrice - result.price7dAvg) / result.price7dAvg) * 100).toFixed(1)}%`
                        : "N/A"}
                    </div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors group relative">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2 flex items-center gap-1">
                      30D Avg <Info size={10} className="hidden xs:block opacity-50" />
                    </div>
                    <div className="text-lg md:text-xl font-mono font-bold">
                      {result.price30dAvg > 0 ? `$${formatPrice(result.price30dAvg)}` : "N/A"}
                    </div>
                    <div className={cn(
                      "text-xs font-bold",
                      (result.price30dAvg > 0 && result.currentPrice >= result.price30dAvg) ? "text-emerald-500" : "text-red-500"
                    )}>
                      {result.price30dAvg > 0
                        ? `${(((result.currentPrice - result.price30dAvg) / result.price30dAvg) * 100).toFixed(1)}%`
                        : "N/A"}
                    </div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2">ATH</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-emerald-400/90">${formatPrice(result.allTimeHigh)}</div>
                    <div className="text-[9px] text-slate-500 font-medium font-mono">
                      -{Math.abs(((result.currentPrice - result.allTimeHigh) / result.allTimeHigh) * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div className="bg-white/5 p-4 md:p-5 rounded-2xl border border-white/5 hover:border-white/10 transition-colors">
                    <div className="text-slate-500 text-[9px] md:text-[10px] font-bold uppercase tracking-widest mb-1 md:mb-2">ATL</div>
                    <div className="text-lg md:text-xl font-mono font-bold text-red-400/90">${formatPrice(result.allTimeLow)}</div>
                    <div className="text-[9px] text-slate-500 font-medium font-mono">
                      +{Math.abs(((result.currentPrice - result.allTimeLow) / result.allTimeLow) * 100).toFixed(1)}%
                    </div>
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
                <p className="text-slate-400 text-sm md:text-lg leading-relaxed italic">
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
      {!result && !loading && (
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
      )}
    </main>
  );
}
