/**
 * Quick diagnostic: check arena state, verify new params are live,
 * and investigate FLOKI/SHIB holdings status.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.+)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
});

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.replace(/^['"]|['"]$/g, ''));
initializeApp({ credential: cert(creds) });
const db = getFirestore();

async function check() {
    // 1. Get arena config
    const snap = await db.collection('arena_config').get();
    if (snap.empty) { console.log('❌ No arena config found!'); return; }

    for (const doc of snap.docs) {
        const data = doc.data();
        console.log(`\n═══════════════════════════════════════════════`);
        console.log(`Arena Config: ${doc.id}`);
        console.log(`Start: ${data.startDate} | End: ${data.endDate}`);
        console.log(`Week: ${data.currentWeek} | Initialized: ${data.initialized}`);
        console.log(`═══════════════════════════════════════════════\n`);

        for (const pool of (data.pools || [])) {
            const strat = pool.strategy || {};
            const holdingsKeys = Object.keys(pool.holdings || {});
            const totalHoldings = holdingsKeys.reduce((sum, k) => {
                const h = pool.holdings[k];
                return sum + (h.amount || 0);
            }, 0);

            console.log(`${pool.emoji} ${pool.name} (${pool.poolId})`);
            console.log(`  Status: ${pool.status}`);
            console.log(`  Tokens: ${pool.tokens?.join(', ')}`);
            console.log(`  Cash: $${pool.cashBalance?.toFixed(2)} | Budget: $${pool.budget}`);

            // Holdings detail
            console.log(`  Holdings:`);
            if (holdingsKeys.length === 0) {
                console.log(`    ⚠️  NO HOLDINGS — all cash`);
            } else {
                for (const ticker of holdingsKeys) {
                    const h = pool.holdings[ticker];
                    console.log(`    ${ticker}: ${h.amount?.toFixed(6)} @ avg $${h.averagePrice?.toFixed(4)} | boughtAt: ${h.boughtAt || 'N/A'} | peakPnl: ${(h.peakPnlPct || 0).toFixed(1)}%`);
                }
            }

            // Performance
            const perf = pool.performance || {};
            console.log(`  Performance: ${perf.totalPnlPct?.toFixed(2)}% | W:${perf.winCount} L:${perf.lossCount} | Trades: ${perf.totalTrades}`);

            // NEW execution parameters check
            console.log(`  ── NEW EXECUTION PARAMS ──`);
            console.log(`    strategyPersonality: ${strat.strategyPersonality || '❌ MISSING'}`);
            console.log(`    minHoldMinutes: ${strat.minHoldMinutes ?? '❌ MISSING'}`);
            console.log(`    evaluationCooldownMinutes: ${strat.evaluationCooldownMinutes ?? '❌ MISSING'}`);
            console.log(`    buyConfidenceBuffer: ${strat.buyConfidenceBuffer ?? '❌ MISSING'}`);
            console.log(`    exitHysteresis: ${strat.exitHysteresis ?? '❌ MISSING'}`);
            console.log(`    positionSizeMultiplier: ${strat.positionSizeMultiplier ?? '❌ MISSING'}`);

            // Score history check
            const scoreHist = pool.scoreHistory || {};
            const scoreHistKeys = Object.keys(scoreHist);
            if (scoreHistKeys.length > 0) {
                console.log(`  ── SCORE HISTORY ──`);
                for (const ticker of scoreHistKeys) {
                    const scores = scoreHist[ticker] || [];
                    console.log(`    ${ticker}: ${scores.length} scores | Last 5: ${scores.slice(-5).map(s => `${s.score}@${new Date(s.ts).toLocaleTimeString()}`).join(' → ')}`);
                }
            } else {
                console.log(`  ── SCORE HISTORY: None yet (will populate on next cron) ──`);
            }

            // Last evaluated check  
            const lastEval = pool.lastEvaluatedAt || {};
            const evalKeys = Object.keys(lastEval);
            if (evalKeys.length > 0) {
                console.log(`  ── LAST EVALUATED ──`);
                for (const ticker of evalKeys) {
                    const ago = Math.round((Date.now() - new Date(lastEval[ticker]).getTime()) / (1000 * 60));
                    console.log(`    ${ticker}: ${ago}min ago (${lastEval[ticker]})`);
                }
            }

            // Strategy thresholds
            console.log(`  ── SIGNAL PARAMS ──`);
            console.log(`    Buy: ${strat.buyScoreThreshold} | Exit: ${strat.exitThreshold} | Gap: ${(strat.buyScoreThreshold || 0) - (strat.exitThreshold || 0)}`);
            console.log(`    TP: ${strat.takeProfitTarget}% | Trail: ${strat.trailingStopPct}% | SL: ${strat.positionStopLoss}%`);
            console.log(`    AntiWash: ${strat.antiWashHours}h | Momentum: ${strat.momentumGateEnabled}`);

            // Last sold timestamps (relevant for FLOKI/SHIB)
            const lastSold = pool.lastSoldAt || {};
            const soldKeys = Object.keys(lastSold);
            if (soldKeys.length > 0) {
                console.log(`  ── LAST SOLD TIMESTAMPS (anti-wash) ──`);
                for (const ticker of soldKeys) {
                    const hoursAgo = ((Date.now() - new Date(lastSold[ticker]).getTime()) / (1000 * 60 * 60)).toFixed(1);
                    console.log(`    ${ticker}: ${hoursAgo}h ago (${lastSold[ticker]})`);
                }
            }

            console.log('');
        }

        // 2. Check recent trades for FLOKI and SHIB
        console.log(`\n═══════════════════════════════════════════════`);
        console.log(`RECENT FLOKI/SHIB TRADES (last 20)`);
        console.log(`═══════════════════════════════════════════════`);

        const tradeSnap = await db.collection('arena_trades')
            .where('userId', '==', doc.id)
            .orderBy('date', 'desc')
            .limit(50)
            .get()
            .catch(async () => {
                // Fallback without orderBy if index missing
                return db.collection('arena_trades')
                    .where('userId', '==', doc.id)
                    .limit(50)
                    .get();
            });

        const flokiShib = [];
        const allRecent = [];
        tradeSnap.forEach(t => {
            const d = t.data();
            allRecent.push(d);
            if (d.ticker === 'FLOKI' || d.ticker === 'SHIB') flokiShib.push(d);
        });

        if (flokiShib.length === 0) {
            console.log('No FLOKI or SHIB trades found.');
        } else {
            flokiShib.sort((a, b) => new Date(b.date) - new Date(a.date));
            for (const t of flokiShib.slice(0, 20)) {
                const pnlStr = t.pnl !== undefined ? ` | P&L: ${t.pnl >= 0 ? '+' : ''}$${t.pnl?.toFixed(2)} (${t.pnlPct?.toFixed(1)}%)` : '';
                console.log(`  ${t.date} | ${t.type} ${t.ticker} | $${t.total?.toFixed(2)}${pnlStr} | ${t.reason?.substring(0, 80)}`);
            }
        }

        // Also show Pool 4 trades specifically
        console.log(`\n── ALL POOL_4 TRADES ──`);
        const pool4trades = allRecent.filter(t => t.poolId === 'POOL_4');
        pool4trades.sort((a, b) => new Date(b.date) - new Date(a.date));
        for (const t of pool4trades.slice(0, 15)) {
            const pnlStr = t.pnl !== undefined ? ` | P&L: ${t.pnl >= 0 ? '+' : ''}$${t.pnl?.toFixed(2)} (${t.pnlPct?.toFixed(1)}%)` : '';
            console.log(`  ${t.date} | ${t.type} ${t.ticker} | $${t.total?.toFixed(2)}${pnlStr} | ${t.reason?.substring(0, 80)}`);
        }
    }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
