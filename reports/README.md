# 📋 Semaphore Report Archive

All reports generated during AI-assisted sessions, organised by category.
Reports are linked to their original location — click any link to open the full document.

> **Last updated:** 17 March 2026

---

## 🤖 Trading Algorithms & Strategy

Reports covering how the AI trading system works, strategy parameters, buy/sell logic, and algorithm improvements.

| Date | Report | Description |
|------|--------|-------------|
| 02 Apr | [Reconciliation & Fortress Hardening](file:///Users/chris/Antigravity/Semaphore10/reports/RECONCILIATION_AUDIT_REPORT.md) | Corrected $120 phantom reserve, realigned capital to $840, and implemented 'AI Kill Switch' to protect cash. |
| 17 Mar | [Bug Fix: DCA Budget Miscalculation](file:///Users/chris/.gemini/antigravity/brain/1096e5b8-e087-47dd-b0cb-37775563b473/bug_fix_summary.md) | FTSE/NYSE/Commodities using wrong budget ($720 vs $600) for P&L calculations |
| 12 Mar | [GPM v2 — Anti-Churn Overtrading Fix](file:///Users/chris/.gemini/antigravity/brain/9e4c761b-fff6-414b-be1c-db6becc05200/gpm_v2_overtrading_fix.md) | Root cause analysis and fix for GPM-driven overtrading |
| 08 Mar | [Graduated Position Management Analysis](file:///Users/chris/.gemini/antigravity/brain/e36111f0-24a2-47df-9bfa-52074a051d8f/graduated_position_management_analysis.md) | Research report on scaling positions proportionally instead of binary hold/sell |
| 08 Mar | [GPM Implementation Status](file:///Users/chris/.gemini/antigravity/brain/aa070db8-f964-4100-b5d9-c184e09aa1d3/gpm_implementation_status.md) | Tracking document for GPM deployment across all arenas |
| 08 Mar | [GPM Cross-Arena Research](file:///Users/chris/.gemini/antigravity/brain/7a73d353-5497-4566-bb32-8489095f804d/gpm_cross_arena_research.md) | Research on applying GPM to FTSE, NYSE & Commodities arenas |
| 05 Mar | [Optimal Strategy Recommendation](file:///Users/chris/.gemini/antigravity/brain/6e408631-156a-4a40-a3f7-ac7a1d216a41/optimal_strategy_recommendation.md) | AI's recommended strategy parameters per pool |
| 04 Mar | [Trading Regime Optimization](file:///Users/chris/.gemini/antigravity/brain/4e780579-d1fe-4b7f-b013-6b52414b0b39/trading_regime_optimization.md) | Analysis of what data the AI receives and how to improve scoring |
| 04 Mar | [Agent Profitability Overhaul](file:///Users/chris/.gemini/antigravity/brain/4e780579-d1fe-4b7f-b013-6b52414b0b39/strategy_audit.md) | 6 enhancements deployed: take-profit, trailing stop, position sizing, etc. |
| 02 Mar | [Strategic Trading Assessment: Path to Profitability](file:///Users/chris/.gemini/antigravity/brain/0d5c47c5-2e3a-4dfb-990a-8474666f79cb/implementation_plan.md) | Option A/B/C analysis for making the trading system profitable |
| 02 Mar | [Option B Trading Overhaul — Walkthrough](file:///Users/chris/.gemini/antigravity/brain/0d5c47c5-2e3a-4dfb-990a-8474666f79cb/walkthrough.md) | Deployed changes walkthrough for the profitability overhaul |
| 01 Mar | [Trading Algorithm Fix Plan](file:///Users/chris/.gemini/antigravity/brain/4f6cfb22-7718-4e13-8726-a26a0d601199/trading_algorithm_fix_plan.md) | Plan for fixing buy/sell algorithm issues |
| 01 Mar | [Custom Strategy Implementation Plan](file:///Users/chris/.gemini/antigravity/brain/4f6cfb22-7718-4e13-8726-a26a0d601199/custom_strategy_implementation_plan.md) | Plan for per-pool custom strategy parameters |

---

## 📊 Trading Audits & Performance Reviews

Forensic reviews of trading activity, win rates, P&L accuracy, and specific trade investigations.

| Date | Report | Description |
|------|--------|-------------|
| 17 Mar | [March 12 Change Audit — Did We Make the Right Decision?](file:///Users/chris/.gemini/antigravity/brain/9cc0caba-354a-455a-a567-dad16c55bfe3/march_12_change_audit.md) | Comprehensive before/after audit of GPM v2 + shared cash pool changes |
| 16 Mar | [7-Day Metrics Audit](file:///Users/chris/.gemini/antigravity/brain/f2fb572a-71d2-4624-8b90-dfae60278458/7_day_metrics_audit.md) | Comprehensive 7-day performance metrics (9–16 Mar) |
| 14 Mar | [Report Accuracy Audit](file:///Users/chris/.gemini/antigravity/brain/e56735c0-6dcd-40a6-b1e8-964c122466ef/report_audit.md) | Found reports were inflating P&L by counting DCA as profit |
| 14 Mar | [Key Metrics Audit](file:///Users/chris/.gemini/antigravity/brain/e56735c0-6dcd-40a6-b1e8-964c122466ef/metrics_audit.md) | Benchmark audit of key trading metrics since system deploy |
| 13 Mar | [Arena Performance Audit](file:///Users/chris/.gemini/antigravity/brain/36bdbd04-f436-4aca-a158-44b528709544/arena_performance_audit.md) | End-to-end arena performance audit |
| 13 Mar | [Key Metrics Audit](file:///Users/chris/.gemini/antigravity/brain/36bdbd04-f436-4aca-a158-44b528709544/key_metrics_audit.md) | Win rate, P&L breakdown, per-pool metrics |
| 13 Mar | [Weekly Report Accuracy Audit](file:///Users/chris/.gemini/antigravity/brain/36bdbd04-f436-4aca-a158-44b528709544/weekly_report_accuracy_audit.md) | Verifying weekly comparison report accuracy |
| 12 Mar | [Overtrading Audit Report](file:///Users/chris/.gemini/antigravity/brain/9e4c761b-fff6-414b-be1c-db6becc05200/overtrading_audit_report.md) | **Critical:** System was dramatically overtrading — 11.7% win rate, $41 losses in 114 trades |
| 09 Mar | [LINK Missed Gain Audit](file:///Users/chris/.gemini/antigravity/brain/9284d322-3c5e-4961-ba40-64143b7894cb/link_missed_gain_audit.md) | Investigation into why LINK gains were missed |
| 05 Mar | [Strategy Changes Forensic Audit](file:///Users/chris/.gemini/antigravity/brain/6e408631-156a-4a40-a3f7-ac7a1d216a41/strategy_changes_forensic_audit.md) | Deep forensic review of all AI strategy changes |
| 05 Mar | [AI Changes Audit](file:///Users/chris/.gemini/antigravity/brain/6e408631-156a-4a40-a3f7-ac7a1d216a41/ai_changes_audit.md) | Audit of what the AI autonomously changed |
| 05 Mar | [Strategy Audit Report](file:///Users/chris/.gemini/antigravity/brain/50c509ad-eb9b-4fad-b9a5-b7833c742bec/strategy_audit_report.md) | Full strategy audit across all pools |
| 04 Mar | [Arena Day 1 Diagnosis](file:///Users/chris/.gemini/antigravity/brain/359d82f2-77cb-46e3-b422-c1eb6fe0fdf4/arena_day1_diagnosis.md) | First-day performance diagnosis |
| 04 Mar | [Arena Trading Audit](file:///Users/chris/.gemini/antigravity/brain/21b14d12-4fe9-4ff0-86a7-779e9cb2316a/arena_trading_audit.md) | Early arena trading behaviour audit |
| 03 Mar | [Trading AI Deep Audit](file:///Users/chris/.gemini/antigravity/brain/33270b9e-3ef4-46d3-ad04-52fd6022db12/trading_ai_deep_audit.md) | Deep-dive into AI decision making logic |
| 03 Mar | [Stop-Loss Audit](file:///Users/chris/.gemini/antigravity/brain/d6186ec6-f557-4a58-95e8-1dd1da0cf1b9/stop_loss_audit.md) | Audit of stop-loss execution behaviour |
| 03 Mar | [Discovery Pools Audit](file:///Users/chris/.gemini/antigravity/brain/fa787a78-a4b8-445a-8fdb-8b65f89ecd8d/discovery_pools_audit.md) | Audit of discovery/sandbox pool performance |
| 02 Mar | [Tactical Compliance Audit](file:///Users/chris/.gemini/antigravity/brain/0d5c47c5-2e3a-4dfb-990a-8474666f79cb/tactical_compliance_audit.md) | TACTICAL profile compliance checking |
| 02 Mar | [AI Trading Performance Report](file:///Users/chris/.gemini/antigravity/brain/7ca074e8-9e00-46cb-9164-e36dd3679faa/ai_trading_performance_report.md) | Overall AI trading performance review |
| 01 Mar | [Momentum Trading Audit](file:///Users/chris/.gemini/antigravity/brain/4f6cfb22-7718-4e13-8726-a26a0d601199/momentum_trading_audit.md) | Audit of momentum-based trading decisions |
| 01 Mar | [SUI Buy → Immediate Trim Trade Audit](file:///Users/chris/.gemini/antigravity/brain/2584b7a7-d2ae-45ab-b2ad-b8759a6e1299/trade_audit.md) | Specific trade investigation: why SUI was bought then immediately trimmed |
| 01 Mar | [Strategic Limits Audit](file:///Users/chris/.gemini/antigravity/brain/e97c5dcf-8dd6-4962-b520-94c24a0049ce/strategic_limits_audit.md) | Audit of trading limits and guardrails |
| 28 Feb | [Sell Audit Report](file:///Users/chris/.gemini/antigravity/brain/06fb9737-d00d-49ee-a3b1-a2c754004006/sell_audit_report.md) | Audit of sell decision quality |
| 28 Feb | [Cash Deployment Sentinel Report](file:///Users/chris/.gemini/antigravity/brain/06fb9737-d00d-49ee-a3b1-a2c754004006/cash_deployment_sentinel_report.md) | Analysis of cash sitting idle vs deployed |
| 27 Feb | [CHZ Strategy Audit](file:///Users/chris/.gemini/antigravity/brain/8f784921-bb3f-4693-8345-43bcd5659ccd/chz_strategy_audit.md) | Specific audit of CHZ token trading strategy |
| 27 Feb | [Trade Audit Report](file:///Users/chris/.gemini/antigravity/brain/6aaa9a16-0273-4169-8770-7386d28a4c8d/trade_audit_report.md) | General trade audit |

---

## 📈 Portfolio & Performance Forecasts

Forward-looking projections, NAV forecasts, and benchmark comparisons.

| Date | Report | Description |
|------|--------|-------------|
| 12 Mar | [7-Day Projections & Benchmark System](file:///Users/chris/.gemini/antigravity/brain/9e4c761b-fff6-414b-be1c-db6becc05200/performance_projections_and_benchmark.md) | Portfolio trajectory projections with benchmark comparison |
| 04 Mar | [Target Value Projections](file:///Users/chris/.gemini/antigravity/brain/4e780579-d1fe-4b7f-b013-6b52414b0b39/target_projections.md) | 28-day target value projections stored to Firestore |
| 04 Mar | [Expected vs Realised Profit Report](file:///Users/chris/.gemini/antigravity/brain/4e780579-d1fe-4b7f-b013-6b52414b0b39/profit_expectations_report.md) | Day 1 profit expectations analysis |
| 02 Mar | [Portfolio Trajectory Forecast](file:///Users/chris/.gemini/antigravity/brain/0d5c47c5-2e3a-4dfb-990a-8474666f79cb/portfolio_trajectory_forecast.md) | $0 or $1,000? — trajectory analysis |

---

## 🏗️ System Architecture & Design Plans

Design specs, expansion plans, and architectural decisions.

| Date | Report | Description |
|------|--------|-------------|
| 10 Mar | [FTSE Dynamic Rotation Research](file:///Users/chris/.gemini/antigravity/brain/01fb0d0f-390f-43b9-90b3-7149ed2936d7/ftse_dynamic_rotation_research.md) | Research on dynamic pool rotation for FTSE arena |
| 09 Mar | [Strategy Deep Research Report](file:///Users/chris/.gemini/antigravity/brain/9284d322-3c5e-4961-ba40-64143b7894cb/strategy_deep_research_report.md) | Deep research on trading strategy improvements |
| 10 Mar | [DCA Balance Audit](file:///Users/chris/.gemini/antigravity/brain/8bd7008a-c819-4598-9940-69e55511c7d6/dca_balance_audit.md) | DCA system balance verification |
| 06 Mar | [Weekly DCA Design Spec](file:///Users/chris/.gemini/antigravity/brain/a599e461-74da-4f77-b8f2-fcc46554abee/weekly_dca_design_spec.md) | DCA system design specification (v1.1, decisions locked) |
| 06 Mar | [Multi-Asset Expansion Plan](file:///Users/chris/.gemini/antigravity/brain/405f3aa9-ab63-413c-935e-b1ef7adc37fc/multi_asset_expansion_plan.md) | FTSE · NYSE · Commodities sandbox-first expansion |
| 06 Mar | [Cross-Pool Loan Analysis](file:///Users/chris/.gemini/antigravity/brain/7554bb89-2053-41d6-a0a2-937a373d0956/cross_pool_loan_analysis.md) | Research: should pools lend cash to each other? |
| 06 Mar | [Micro-Cap Momentum Pool Analysis](file:///Users/chris/.gemini/antigravity/brain/7554bb89-2053-41d6-a0a2-937a373d0956/microcap_momentum_pool_analysis.md) | Research: adding a 5th/6th pool for daily gainers |
| 04 Mar | [Self-Improving Agent Analysis](file:///Users/chris/.gemini/antigravity/brain/359d82f2-77cb-46e3-b422-c1eb6fe0fdf4/self_improving_agent_analysis.md) | How to make the AI agent self-improving |
| 04 Mar | [System Changelog](file:///Users/chris/.gemini/antigravity/brain/359d82f2-77cb-46e3-b422-c1eb6fe0fdf4/system_changelog.md) | System changes tracking document |
| 03 Mar | [Arena Redesign Summary](file:///Users/chris/.gemini/antigravity/brain/9713110e-2f52-48f5-8bd1-906facdf443c/arena_redesign_summary.md) | 4-pool arena redesign overview |
| 03 Mar | [Discovery Pools Design](file:///Users/chris/.gemini/antigravity/brain/dd3341c4-abdd-4d9f-ae53-9f58a1105da9/discovery_pools_design.md) | Discovery/sandbox pool system design |
| 01 Mar | [Data Utilisation Analysis](file:///Users/chris/.gemini/antigravity/brain/e97c5dcf-8dd6-4962-b520-94c24a0049ce/data_utilisation_analysis.md) | How data is used across the system |
| 01 Mar | [Reconciliation Plan](file:///Users/chris/.gemini/antigravity/brain/e97c5dcf-8dd6-4962-b520-94c24a0049ce/reconciliation_plan.md) | Data reconciliation strategy |

---

## 📡 Reporting System & AI Self-Assessment

How the AI reports are generated, scoring rubrics, and neural reflection structure.

| Date | Report | Description |
|------|--------|-------------|
| 13 Mar | [Implementation Summary](file:///Users/chris/.gemini/antigravity/brain/36bdbd04-f436-4aca-a158-44b528709544/implementation_summary.md) | Summary of reporting system improvements |
| 05 Mar | [Report Improvement Guidance](file:///Users/chris/.gemini/antigravity/brain/50c509ad-eb9b-4fad-b9a5-b7833c742bec/report_improvement_guidance.md) | How to improve the AI's report quality |
| 02 Mar | [Daily Performance Report Changes](file:///Users/chris/.gemini/antigravity/brain/0d5c47c5-2e3a-4dfb-990a-8474666f79cb/daily_performance_report_changes.md) | Changes deployed to daily reporting system |
| 04 Mar | [Autonomous Operation Checklist](file:///Users/chris/.gemini/antigravity/brain/4e780579-d1fe-4b7f-b013-6b52414b0b39/autonomous_checklist.md) | Checklist for 28-day hands-off mode |
| 28 Feb | [Neural Reflection Analysis](file:///Users/chris/.gemini/antigravity/brain/06fb9737-d00d-49ee-a3b1-a2c754004006/neural_reflection_analysis.md) | How the AI's self-assessment (neural reflection) works |
| 28 Feb | [Extended Performance Review Proposal](file:///Users/chris/.gemini/antigravity/brain/06fb9737-d00d-49ee-a3b1-a2c754004006/extended_performance_review_proposal.md) | Proposed enhancements to performance reviews |
| 28 Feb | [Cortex Reflection Plan](file:///Users/chris/.gemini/antigravity/brain/06fb9737-d00d-49ee-a3b1-a2c754004006/cortex_reflection_plan.md) | AI reflection system design |
| 27 Feb | [AI Learning System](file:///Users/chris/.gemini/antigravity/brain/8f784921-bb3f-4693-8345-43bcd5659ccd/ai_learning_system.md) | How the AI learns from past trades |

---

## 🌐 Other Projects (Non-Trading)

Reports for other projects (fencing website, chatbot research, etc.)

| Date | Report | Description |
|------|--------|-------------|
| 12 Mar | [Interactive Estimate Telegram Plan](file:///Users/chris/.gemini/antigravity/brain/674ffdba-41db-4639-9b7b-3c9d5bf13fe1/interactive_estimate_telegram_plan.md) | Telegram bot for interactive estimates |
| 11 Mar | [SEO Audit](file:///Users/chris/.gemini/antigravity/brain/ca9242bf-0900-45c8-a717-b46f0b8ac0ef/seo_audit.md) | Website SEO audit |
| 07 Mar | [AI Life Controller Setup](file:///Users/chris/.gemini/antigravity/brain/bbf88d5e-d3f5-4110-bd93-1f64509970d4/ai_life_controller_setup.md) | AI life controller system setup |
| 07 Mar | [Setup Guide](file:///Users/chris/.gemini/antigravity/brain/7ffa307a-6471-4886-bcb3-f4a918699274/SETUP_GUIDE.md) | Project setup guide |
| 07 Mar | [Carer's Compass Setup Guide](file:///Users/chris/.gemini/antigravity/brain/6c162f28-af8a-465c-9360-2fc77f91a267/setup_guide.md) | Carer's Compass app setup |
| 02 Mar | [QuotaGuard Analysis](file:///Users/chris/.gemini/antigravity/brain/7ca074e8-9e00-46cb-9164-e36dd3679faa/quotaguard_analysis.md) | QuotaGuard proxy service analysis |
| 28 Feb | [News Intelligence Report](file:///Users/chris/.gemini/antigravity/brain/2a833786-f9ce-4329-a7a4-df778a5eadcc/news_intelligence_report.md) | News intelligence feature research |
| 28 Feb | [News Intelligence Implementation](file:///Users/chris/.gemini/antigravity/brain/2a833786-f9ce-4329-a7a4-df778a5eadcc/news_intelligence_implementation.md) | News feature implementation plan |
| 28 Feb | [AI Chatbot Research](file:///Users/chris/.gemini/antigravity/brain/17d6d72e-4b8e-45c5-af9e-ecb5b597330f/ai_chatbot_research.md) | AI chatbot assistant research & options |
| Feb | [Instagram Integration Plan](file:///Users/chris/.gemini/antigravity/brain/63951e38-2652-4cf4-a0c0-b9ba9da1599c/instagram_integration_plan.md) | Instagram integration for SD Fencing website |

---

## 📚 Knowledge Base (Distilled)

Curated, maintained knowledge items — these are kept up to date across conversations.

| Topic | Path |
|-------|------|
| [Trading Performance, Strategy & Reporting](file:///Users/chris/.gemini/antigravity/knowledge/trading_performance_strategy_reporting/artifacts/overview.md) | Scoring rubrics, EOD reports, weekly audits, profit mandates |
| [Scenario C: Selective Catalyst Rotation](file:///Users/chris/.gemini/antigravity/knowledge/scenario_c_selective_rotation/artifacts/overview.md) | FTSE/NYSE/Commodities ticker rotation system |
| [Virtual Portfolio & Dividends](file:///Users/chris/.gemini/antigravity/knowledge/virtual_portfolio_architecture_and_dividends/artifacts/overview.md) | FTSE Intel portfolio data model & dividend system |
