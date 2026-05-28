/**
 * RESET SCRIPT: Initialize the new XRP & AAVE Virtual Strategy
 * 
 * Re-initializes the active user's arena config with 2 pools (XRP and AAVE)
 * and a shared virtual cash balance of $1050.
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!saStr) throw new Error('No FIREBASE_SERVICE_ACCOUNT_JSON');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr)) });
}
const db = admin.firestore();

async function main() {
    console.log('Fetching active users...');
    const usersSnap = await db.collection('agent_configs').get();
    
    if (usersSnap.empty) {
        console.log('No users found.');
        process.exit(0);
    }

    const { getVerifiedPrices } = await import('../src/app/actions');
    const prices = await getVerifiedPrices(['XRP', 'AAVE', 'BTC']);

    const btcPrice = (prices['BTC'] as any)?.price || 0;
    const xrpPrice = (prices['XRP'] as any)?.price || 0;
    
    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString();

    for (const doc of usersSnap.docs) {
        const USER_ID = doc.id;
        const config = doc.data();
        
        if (!config.arenaEnabled) continue;
        console.log(`Resetting arena for user: ${USER_ID}`);

        const newPools = [
            {
                poolId: 'POOL_1',
                name: 'XRP Maximizer',
                emoji: '🦅',
                tokens: ['XRP'],
                strategy: {
                    buyScoreThreshold: 75,
                    exitThreshold: 40,
                    momentumGateEnabled: true,
                    momentumGateThreshold: -3,
                    minOrderAmount: 10,
                    antiWashHours: 24,
                    reentryPenalty: 5,
                    positionStopLoss: -8,
                    maxAllocationPerToken: 525,
                    takeProfitTarget: 3,
                    trailingStopPct: 2,
                    minWinPct: 0.5,
                    description: 'Aggressive profit maximization focusing solely on XRP volatility',
                    strategyPersonality: 'AGGRESSIVE',
                },
                budget: 525,
                cashBalance: 0, // all cash moves to sharedCash
                holdings: {},
                performance: {
                    startDate,
                    totalPnl: 0,
                    totalPnlPct: 0,
                    winCount: 0,
                    lossCount: 0,
                    totalTrades: 0,
                    bestTrade: null,
                    worstTrade: null,
                    dailySnapshots: [],
                },
                createdAt: startDate,
                status: 'ACTIVE',
                selectionReasoning: 'Strategic pivot to maximize XRP returns.',
                weeklyReviews: [],
                strategyHistory: [],
                lastSoldAt: {},
                lastStopLossedAt: {},
                stopLossExitPrices: {},
                scoreHistory: {},
                lastEvaluatedAt: {},
            },
            {
                poolId: 'POOL_2',
                name: 'AAVE Accumulator',
                emoji: '👻',
                tokens: ['AAVE'],
                strategy: {
                    buyScoreThreshold: 75,
                    exitThreshold: 40,
                    momentumGateEnabled: true,
                    momentumGateThreshold: -3,
                    minOrderAmount: 10,
                    antiWashHours: 24,
                    reentryPenalty: 5,
                    positionStopLoss: -8,
                    maxAllocationPerToken: 525,
                    takeProfitTarget: 3,
                    trailingStopPct: 2,
                    minWinPct: 0.5,
                    description: 'Aggressive profit maximization focusing solely on AAVE volatility',
                    strategyPersonality: 'AGGRESSIVE',
                },
                budget: 525,
                cashBalance: 0,
                holdings: {},
                performance: {
                    startDate,
                    totalPnl: 0,
                    totalPnlPct: 0,
                    winCount: 0,
                    lossCount: 0,
                    totalTrades: 0,
                    bestTrade: null,
                    worstTrade: null,
                    dailySnapshots: [],
                },
                createdAt: startDate,
                status: 'ACTIVE',
                selectionReasoning: 'Strategic pivot to maximize AAVE returns.',
                weeklyReviews: [],
                strategyHistory: [],
                lastSoldAt: {},
                lastStopLossedAt: {},
                stopLossExitPrices: {},
                scoreHistory: {},
                lastEvaluatedAt: {},
            }
        ];

        const newArena = {
            userId: USER_ID,
            startDate,
            endDate,
            currentWeek: 1,
            pools: newPools,
            tokensLocked: true,
            totalBudget: 1050,
            initialized: true,
            benchmarkStartPrices: {
                BTC: btcPrice,
                XRP: xrpPrice,
                recordedAt: startDate,
            },
            btcDailyPrices: btcPrice > 0 ? {
                [now.toISOString().slice(0, 10)]: { open: btcPrice, close: btcPrice, high: btcPrice, low: btcPrice },
            } : {},
            sharedCash: 1050, // All capital starts as cash
            systemHalted: false,
            trailing24hPeak: { value: 1050, timestamp: startDate },
            trailing72hPeak: { value: 1050, timestamp: startDate },
            masterPortfolioMode: false,
            sellOnlyMode: false
        };

        await db.collection('arena_config').doc(USER_ID).set(newArena);
        console.log('✅ Updated arena config');
    }
    
    console.log('All done.');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
