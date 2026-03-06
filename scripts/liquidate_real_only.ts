// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
import { adminDb } from '../src/lib/firebase-admin';
import { RevolutX } from '../src/lib/revolut';
import { getVerifiedPrices } from '../src/app/actions';

async function liquidateRealOnly(userId: string) {
    if (!adminDb) {
        console.error("Admin DB not initialized");
        return;
    }

    console.log(`--- [Real-Only Liquidation] Starting for User ${userId} ---`);
    console.log(`⚠️ This script will SELL ALL assets on Revolut X but will NOT update the Ledger.`);

    const configSnap = await adminDb.collection('agent_configs').doc(userId).get();
    if (!configSnap.exists) {
        console.error("Config not found");
        return;
    }
    const config = configSnap.data()!;

    if (!config.revolutApiKey || !config.revolutPrivateKey) {
        console.error("Revolut API keys missing in config.");
        return;
    }

    const revolut = new RevolutX(
        config.revolutApiKey,
        config.revolutPrivateKey,
        config.revolutIsSandbox,
        config.revolutProxyUrl
    );

    try {
        console.log("Fetching real-time positions from Revolut X...");
        const holdings = await revolut.getHoldings();

        if (holdings.length === 0) {
            console.log("No crypto holdings found on Revolut X. Nothing to liquidate.");
            return;
        }

        console.log(`Found ${holdings.length} positions:`);
        holdings.forEach(h => console.log(` - ${h.symbol}: ${h.amount} units`));

        console.log("\nProceeding to liquidate all positions...");

        for (const holding of holdings) {
            const ticker = holding.symbol.split('-')[0]; // Handle Ticker-USD or just Ticker
            const amount = holding.available;

            if (amount <= 0) continue;

            try {
                const sellAmt = Math.floor(amount * 1e8) / 1e8; // Standardize to 8 decimals
                console.log(`💸 Selling ${sellAmt} ${ticker}...`);

                const result = await revolut.createOrder({
                    symbol: `${ticker}-USD`,
                    side: 'SELL',
                    size: sellAmt.toFixed(8),
                    type: 'market'
                });

                console.log(`✅ Success: Sold ${ticker}. Order ID: ${result.id || 'N/A'}`);
            } catch (e: any) {
                console.error(`❌ Failed to sell ${ticker}:`, e.message);
            }
        }

        console.log("\n--- [Liquidation Complete] ---");
        console.log("Revolut account should now be in 100% Cash.");
        console.log("NOTE: Your AI Dashboard ledger remains unchanged. The AI will continue 'virtual' trading until realTradingEnabled is toggled back ON.");

    } catch (e: any) {
        console.error("Fatal error during liquidation:", e.message);
    }
}

// Get USER_ID from CLI or default to a known one
const USER_ID = process.argv[2] || "677d245c472d4cc98d4d7cf5";

liquidateRealOnly(USER_ID).then(() => {
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
