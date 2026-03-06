/**
 * migrate_execution_params.js
 * 
 * One-time migration to add AI-controllable execution parameters and
 * appropriate strategyPersonality to existing arena pool strategies.
 * 
 * This assigns different defaults per pool based on their intended strategy:
 * - Pool 1 (Momentum Mavericks): MODERATE, 120min hold, 15min cooldown
 * - Pool 2 (Deep Divers):        PATIENT, 180min hold, 30min cooldown  
 * - Pool 3 (Steady Sailers):     PATIENT, 240min hold, 30min cooldown
 * - Pool 4 (Agile Arbitrageurs): AGGRESSIVE, 60min hold, 10min cooldown
 * 
 * Usage: node scripts/migrate_execution_params.js
 */

const fs = require('fs');
const path = require('path');

// Load .env.local manually
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

// Per-pool execution defaults based on strategy personality
const POOL_DEFAULTS = {
    POOL_1: {
        // Momentum Mavericks — ride trends, moderate hold
        strategyPersonality: 'MODERATE',
        minHoldMinutes: 120,
        evaluationCooldownMinutes: 15,
        buyConfidenceBuffer: 5,
        exitHysteresis: 10,
        positionSizeMultiplier: 0.8,
    },
    POOL_2: {
        // Deep Divers — dip hunting, patient
        strategyPersonality: 'PATIENT',
        minHoldMinutes: 180,
        evaluationCooldownMinutes: 30,
        buyConfidenceBuffer: 5,
        exitHysteresis: 12,
        positionSizeMultiplier: 0.85,
    },
    POOL_3: {
        // Steady Sailers — patient accumulation
        strategyPersonality: 'PATIENT',
        minHoldMinutes: 240,
        evaluationCooldownMinutes: 30,
        buyConfidenceBuffer: 7,
        exitHysteresis: 15,
        positionSizeMultiplier: 0.9,
    },
    POOL_4: {
        // Agile Arbitrageurs — aggressive, shorter holds
        strategyPersonality: 'AGGRESSIVE',
        minHoldMinutes: 60,
        evaluationCooldownMinutes: 10,
        buyConfidenceBuffer: 3,
        exitHysteresis: 8,
        positionSizeMultiplier: 0.75,
    },
};

async function migrate() {
    const snap = await db.collection('arena_config').get();
    if (snap.empty) {
        console.log('No arena configs found.');
        return;
    }

    for (const doc of snap.docs) {
        const data = doc.data();
        const pools = data.pools || [];
        let updated = false;

        for (const pool of pools) {
            const defaults = POOL_DEFAULTS[pool.poolId];
            if (!defaults) continue;

            const strat = pool.strategy;
            const before = {
                strategyPersonality: strat.strategyPersonality || 'NONE',
                minHoldMinutes: strat.minHoldMinutes || 'NONE',
                evaluationCooldownMinutes: strat.evaluationCooldownMinutes || 'NONE',
                buyConfidenceBuffer: strat.buyConfidenceBuffer || 'NONE',
                exitHysteresis: strat.exitHysteresis || 'NONE',
                positionSizeMultiplier: strat.positionSizeMultiplier || 'NONE',
            };

            // Only set if not already present
            if (!strat.strategyPersonality) {
                strat.strategyPersonality = defaults.strategyPersonality;
                updated = true;
            }
            if (strat.minHoldMinutes == null) {
                strat.minHoldMinutes = defaults.minHoldMinutes;
                updated = true;
            }
            if (strat.evaluationCooldownMinutes == null) {
                strat.evaluationCooldownMinutes = defaults.evaluationCooldownMinutes;
                updated = true;
            }
            if (strat.buyConfidenceBuffer == null) {
                strat.buyConfidenceBuffer = defaults.buyConfidenceBuffer;
                updated = true;
            }
            if (strat.exitHysteresis == null) {
                strat.exitHysteresis = defaults.exitHysteresis;
                updated = true;
            }
            if (strat.positionSizeMultiplier == null) {
                strat.positionSizeMultiplier = defaults.positionSizeMultiplier;
                updated = true;
            }

            // Initialize scoreHistory and lastEvaluatedAt if missing
            if (!pool.scoreHistory) {
                pool.scoreHistory = {};
                updated = true;
            }
            if (!pool.lastEvaluatedAt) {
                pool.lastEvaluatedAt = {};
                updated = true;
            }

            console.log(`\n${pool.emoji} ${pool.name} (${pool.poolId}):`);
            console.log(`  Before: ${JSON.stringify(before)}`);
            console.log(`  After:  personality=${strat.strategyPersonality}, hold=${strat.minHoldMinutes}min, cooldown=${strat.evaluationCooldownMinutes}min, buyBuf=${strat.buyConfidenceBuffer}, exitHyst=${strat.exitHysteresis}, sizeMult=${strat.positionSizeMultiplier}`);
        }

        if (updated) {
            await doc.ref.update({ pools });
            console.log(`\n✅ Updated arena config: ${doc.id}`);
        } else {
            console.log('\nNo changes needed — all params already set.');
        }
    }
}

migrate().then(() => {
    console.log('\n🎯 Migration complete.');
    process.exit(0);
}).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
