# FTSE Intel — Confirmed Build Plan

## Confirmed Decisions

| # | Decision                          | Confirmed Choice                                    |
|---|-----------------------------------|-----------------------------------------------------|
| 1 | Firebase project                  | **Separate project** — full isolation                |
| 2 | Stock data API                    | **Finnhub (free)** → FMP ($14/mo) upgrade path      |
| 3 | Stock universe                    | **FTSE 100 + FTSE 250** for AI discovery             |
| 4 | Market hours pricing              | **07:30–17:00 Mon–Fri UK time** only                 |
| 5 | Scan frequency                    | **3 per day** (pre-market, midday, close)            |
| 6 | Currency                          | **GBP (£)**                                          |
| 7 | App name                          | **FTSE Intel**                                       |
| 8 | Virtual portfolio                 | **YES — keep virtual trading + cash/trade ledger**   |
| 9 | News scanner                      | **24/7 AI news event scanner** (FTSE-affecting news) |

---

## Architecture Overview

```
/Users/chris/Antigravity/FTSEIntel/          ← New standalone directory
├── src/
│   ├── app/
│   │   ├── actions.ts                        ← Server actions (adapted for stocks)
│   │   ├── api/cron/agent/route.ts           ← Cron: market-hours gated
│   │   ├── api/cron/news/route.ts            ← NEW: 24/7 news scanner cron
│   │   ├── page.tsx                          ← Main dashboard page
│   │   └── settings/                         ← Settings page (simplified)
│   ├── components/
│   │   ├── AgentDashboard.tsx                ← Stock-adapted dashboard
│   │   └── ...modals                         ← Reports, library, watchlists
│   ├── lib/
│   │   ├── constants.ts                      ← FTSE 100/250 stock universe
│   │   ├── gemini.ts                         ← Same AI engine
│   │   ├── firebase.ts                       ← NEW Firebase project config
│   │   ├── firebase-admin.ts                 ← NEW admin SDK config
│   │   ├── finnhub.ts                        ← NEW: Stock pricing client
│   │   └── news.ts                           ← NEW: News aggregation client
│   ├── services/
│   │   ├── agentConfigService.ts             ← Adapted for stock config
│   │   ├── virtualPortfolioAdmin.ts          ← Kept & adapted for GBP + stocks
│   │   ├── virtualPortfolioService.ts        ← Kept (client-side ledger)
│   │   └── libraryService.ts                 ← Kept (intelligence reports)
│   └── context/                              ← Auth context
├── vercel.json                               ← Cron: market hours + 24/7 news
├── package.json                              ← "ftse-intel"
└── .env.local                                ← NEW Firebase + Finnhub keys
```

## What Gets Kept vs Modified vs Removed vs Added

### ✅ Kept (copied as-is or near-identical)
- `gemini.ts` — AI engine (same Gemini API)
- `firebase-admin.ts` — structure same, new credentials
- `firebase.ts` — structure same, new credentials
- `libraryService.ts` — intelligence report storage
- `virtualPortfolioService.ts` — client-side ledger display
- Dashboard UI structure, modals, settings sidebar
- Neural Pulse scan cycle, watchlist waterfall, discovery scan
- Neural Synopsis daily AI summary
- Cortex Library / Reports system
- Equity history tracking

### 🔧 Modified (significant adaptation needed)
- `constants.ts` — FTSE 100/250 ticker universe replaces crypto tokens
- `actions.ts` — Pricing engine swapped (Finnhub/FMP), prompts rewritten for equities
- `virtualPortfolioAdmin.ts` — GBP currency, stock-specific lot sizing, no crypto exchanges
- `agentConfigService.ts` — Stock-specific config fields, GBP defaults
- `AgentDashboard.tsx` — GBP formatting, stock-specific UI, news panel
- `vercel.json` — Market-hours-only cron + separate 24/7 news cron
- AI prompts — Equity fundamentals (P/E, dividends, earnings, sector analysis)

### ❌ Removed entirely
- `revolut.ts` — No exchange SDK
- `revolutService.ts` — No exchange sync
- QuotaGuard proxy config — Not needed
- Revolut price panels / buttons
- All Revolut-specific settings

### 🆕 Added (new features)
- `finnhub.ts` — Stock pricing client (Finnhub REST API)
- `news.ts` — News aggregation (Finnhub Market News + Google News RSS)
- `api/cron/news/route.ts` — 24/7 news cron (runs every 30 min)
- News events panel in dashboard — Breaking alerts that could move the market
- Market hours gating — "Market Closed" status, auto-pause overnight
- GBP (£) formatting throughout

## 24/7 News Scanner Design

The news scanner runs independently of price scanning:

- **Schedule:** Every 30 minutes, 24/7 (news breaks don't respect market hours)
- **Sources:** Finnhub Market News API (free, covers UK/global markets) + RSS feeds
- **AI Analysis:** Each news item is scored by Gemini for FTSE impact (0-100)
- **Alerts:** High-impact news (score > 70) appears in a dedicated dashboard panel
- **Pre-market Briefing:** At 07:30, the AI generates a overnight news digest

## Steps to Build

1. **Create `/Users/chris/Antigravity/FTSEIntel/` directory**
2. **Scaffold Next.js project** (same stack: Next.js 16, Tailwind, TypeScript)
3. **Create new Firebase project** (you'll do this in Firebase Console)
4. **Copy & adapt core files** from Semaphore10
5. **Build FTSE pricing engine** (Finnhub client)
6. **Build news scanner** (Finnhub news + AI scoring)
7. **Adapt AI prompts** for equity analysis
8. **Adapt virtual portfolio** for GBP + stock lots
9. **Rebrand UI** — "FTSE Intel" theme, new colour palette
10. **Create Vercel project** + deploy
11. **Test full scan cycle** on FTSE 100

## What You Need to Do (Manual Steps)

Before I can build, you'll need to:

1. **Create a Firebase project** at https://console.firebase.google.com
   - Project name: `ftse-intel` (or similar)
   - Enable Firestore Database
   - Enable Authentication (Email/Password)
   - Generate a Service Account key (JSON)
   - Copy the web app config (apiKey, authDomain, etc.)

2. **Get a Finnhub API key** at https://finnhub.io (free, takes 30 seconds)

3. **Your existing Gemini API key** can be shared between both apps

Once you have those credentials, I'll create the entire project end-to-end.

---

*Updated 24 Feb 2026 — Awaiting Firebase project + Finnhub API key before implementation.*
