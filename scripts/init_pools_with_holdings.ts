/**
 * Initialize Discovery Pools with BTC and ETH as existing holdings.
 * Pool A: BTC (0.0007415) + AI-selected second token
 * Pool B: ETH (0.01268871) + AI-selected second token
 *
 * Fetches live prices, calculates remaining cash, deducts $200 from main portfolio.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa as admin.ServiceAccount) });
const db = admin.firestore();

const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

async function fetchPrice(ticker: string): Promise<number> {
    const alias = ticker === 'POL' ? 'MATIC' : ticker;
    const res = await fetch(`https://eodhd.com/api/real-time/${alias}-USD.CC?api_token=${EODHD_API_KEY}&fmt=json`);
    if (!res.ok) throw new Error(`Price fetch failed for ${ticker}: ${res.status}`);
    const data = await res.json();
    const price = parseFloat(data.close);
    if (isNaN(price) || price <= 0) throw new Error(`Invalid price for ${ticker}: ${data.close}`);
    return price;
}

(async () => {
    console.log('=== Initializing Discovery Pools with Existing Holdings ===\n');

    // 1. Check no pools exist already
    const existingSnap = await db.collection('discovery_pools').where('userId', '==', userId).get();
    if (!existingSnap.empty) {
        console.error('❌ Discovery pools already exist. Delete them first.');
        process.exit(1);
    }

    // 2. Fetch live prices
    console.log('Fetching live prices...');
    const btcPrice = await fetchPrice('BTC');
    const ethPrice = await fetchPrice('ETH');
    console.log(`  BTC: $${btcPrice.toLocaleString()}`);
    console.log(`  ETH: $${ethPrice.toLocaleString()}`);

    // 3. Calculate holding values
    const btcAmount = 0.00074150;
    const ethAmount = 0.01268871;
    const btcValue = btcAmount * btcPrice;
    const ethValue = ethAmount * ethPrice;

    console.log(`\n  BTC holding: ${btcAmount} = $${btcValue.toFixed(2)}`);
    console.log(`  ETH holding: ${ethAmount} = $${ethValue.toFixed(2)}`);

    const poolACash = Math.max(0, 100 - btcValue);
    const poolBCash = Math.max(0, 100 - ethValue);

    console.log(`  Pool A cash remaining: $${poolACash.toFixed(2)}`);
    console.log(`  Pool B cash remaining: $${poolBCash.toFixed(2)}`);

    // 4. Check main portfolio has sufficient cash
    const vpRef = db.collection('virtual_portfolio').doc(userId);
    const vpSnap = await vpRef.get();
    if (!vpSnap.exists) {
        console.error('❌ No virtual portfolio found.');
        process.exit(1);
    }
    const vpData = vpSnap.data()!;
    const currentCash = vpData.cashBalance || 0;
    const totalBudget = 200;

    if (currentCash < totalBudget) {
        console.error(`❌ Insufficient cash. Need $${totalBudget}, have $${currentCash.toFixed(2)}.`);
        process.exit(1);
    }

    // 5. Select second tokens from the watchlist (high-scored, not BTC/ETH)
    const configSnap = await db.collection('agent_configs').doc(userId).get();
    const config = configSnap.data() || {};
    const allTokens = [
        ...(config.trafficLightTokens || []),
        ...(config.standardTokens || []),
        ...(config.sandboxTokens || []),
    ].map((t: string) => t.toUpperCase());

    // Pick 2 different tokens for the second slots (not BTC or ETH)
    const excluded = new Set(['BTC', 'ETH', 'XDC']);
    const candidates = allTokens.filter((t: string) => !excluded.has(t));
    const poolASecond = candidates[0] || 'SOL';
    const poolBSecond = candidates[1] || 'LINK';

    console.log(`\n  Pool A tokens: BTC + ${poolASecond}`);
    console.log(`  Pool B tokens: ETH + ${poolBSecond}`);

    // 6. Create pool documents
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    const poolA = {
        userId,
        poolId: 'POOL_A',
        name: 'Bitcoin Alpha',
        emoji: '₿',
        tokens: ['BTC', poolASecond],
        strategy: {
            buyScoreThreshold: 72,
            exitThreshold: 55,
            momentumGateEnabled: true,
            momentumGateThreshold: -2,
            minOrderAmount: 10,
            antiWashHours: 4,
            reentryPenalty: 5,
            positionStopLoss: -20,
            maxAllocationPerToken: 75,
            description: 'Momentum-focused BTC-anchored strategy. Buys on confirmed uptrends (score 72+), tight momentum gate. Pairs BTC with a mid-cap for diversification.',
        },
        budget: 100,
        cashBalance: poolACash,
        holdings: {
            BTC: {
                amount: btcAmount,
                averagePrice: btcPrice,
                peakPrice: btcPrice,
            },
        },
        performance: {
            startDate: now,
            totalPnl: 0,
            totalPnlPct: 0,
            winCount: 0,
            lossCount: 0,
            bestTrade: null,
            worstTrade: null,
            dailySnapshots: [],
        },
        dailyPeakValue: 100,
        dailyPeakDate: today,
        rotatedAt: now,
        createdAt: now,
        status: 'ACTIVE',
        selectionReasoning: `BTC selected as anchor — existing Revolut position (${btcAmount} BTC ≈ $${btcValue.toFixed(2)}). ${poolASecond} selected as diversification pair from top of watchlist.`,
    };

    const poolB = {
        userId,
        poolId: 'POOL_B',
        name: 'Ethereum Edge',
        emoji: 'Ξ',
        tokens: ['ETH', poolBSecond],
        strategy: {
            buyScoreThreshold: 68,
            exitThreshold: 50,
            momentumGateEnabled: false,
            momentumGateThreshold: -5,
            minOrderAmount: 10,
            antiWashHours: 2,
            reentryPenalty: 3,
            positionStopLoss: -25,
            maxAllocationPerToken: 60,
            description: 'Dip-buying ETH-anchored strategy. Lower entry threshold (score 68+), no momentum gate — willing to buy dips. Pairs ETH with a speculative pick.',
        },
        budget: 100,
        cashBalance: poolBCash,
        holdings: {
            ETH: {
                amount: ethAmount,
                averagePrice: ethPrice,
                peakPrice: ethPrice,
            },
        },
        performance: {
            startDate: now,
            totalPnl: 0,
            totalPnlPct: 0,
            winCount: 0,
            lossCount: 0,
            bestTrade: null,
            worstTrade: null,
            dailySnapshots: [],
        },
        dailyPeakValue: 100,
        dailyPeakDate: today,
        rotatedAt: now,
        createdAt: now,
        status: 'ACTIVE',
        selectionReasoning: `ETH selected as anchor — existing Revolut position (${ethAmount} ETH ≈ $${ethValue.toFixed(2)}). ${poolBSecond} selected as speculative pair from watchlist.`,
    };

    // 7. Atomic write
    const batch = db.batch();

    // Deduct from main portfolio
    batch.update(vpRef, {
        cashBalance: admin.firestore.FieldValue.increment(-totalBudget),
        totalValue: admin.firestore.FieldValue.increment(-totalBudget),
    });

    // Create pools
    batch.set(db.collection('discovery_pools').doc(`${userId}_POOL_A`), poolA);
    batch.set(db.collection('discovery_pools').doc(`${userId}_POOL_B`), poolB);

    // Enable pools in config
    batch.update(db.collection('agent_configs').doc(userId), { discoveryPoolsEnabled: true });

    await batch.commit();

    console.log('\n✅ Discovery Pools initialized!');
    console.log(`  Pool A "₿ Bitcoin Alpha": BTC + ${poolASecond} ($${poolACash.toFixed(2)} cash)`);
    console.log(`  Pool B "Ξ Ethereum Edge": ETH + ${poolBSecond} ($${poolBCash.toFixed(2)} cash)`);
    console.log(`  $200 deducted from main portfolio`);
    console.log(`  Main portfolio cash: $${(currentCash - totalBudget).toFixed(2)}`);

    process.exit(0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
