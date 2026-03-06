import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

if (!admin.apps.length) {
    const saStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saStr!)) });
}

async function testIt() {
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    const db = admin.firestore();
    const doc = await db.collection("agent_configs").doc(userId).get();
    const config = doc.data();

    // MATCHING executeVirtualTrades logic EXACTLY

    // FETCH CONFIG IF MISSING
    let activeConfig = config;
    try {
        const freshConfigSnap = await adminDb.collection("agent_configs").doc(userId).get();
        if (freshConfigSnap.exists) {
            const freshData = freshConfigSnap.data();
            if (freshData) {
                activeConfig = { ...activeConfig, automationEnabled: freshData.automationEnabled, realTradingEnabled: freshData.realTradingEnabled };
            }
        }
    } catch (e) {
        // ...
    }

    const automationEnabled = config?.automationEnabled || false;
    const realTradingEnabled = activeConfig?.realTradingEnabled !== false;

    console.log('automationEnabled:', automationEnabled);
    console.log('realTradingEnabled:', realTradingEnabled);
    console.log('config.revolutApiKey:', !!config?.revolutApiKey);
    console.log('config.revolutPrivateKey:', !!config?.revolutPrivateKey);

    const revolutClient = (automationEnabled && realTradingEnabled && config?.revolutApiKey && config?.revolutPrivateKey)
        ? { mock: "client" }
        : null;

    console.log('revolutClient created?', !!revolutClient);

    let tradeExecutionBlocked = false;
    if (!automationEnabled) {
        tradeExecutionBlocked = true;
        console.log('Blocked: Automation OFF');
    }

    if (automationEnabled && revolutClient && realTradingEnabled) {
        console.log(`[VP] 🤖 Revolut X Client Initialized for ${userId}. Running pre-flight health check...`);
    } else if (automationEnabled && !realTradingEnabled) {
        console.log(`[VP] 🛡️ VIRTUAL ALPHA MODE`);
    } else if (automationEnabled) {
        console.warn(`[VP] ⚠️ Automation enabled but Revolut keys are missing!`);
        tradeExecutionBlocked = true;
    }

    console.log('tradeExecutionBlocked:', tradeExecutionBlocked);
    process.exit(0);
}
testIt();
