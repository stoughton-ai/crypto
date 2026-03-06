
import * as fs from 'fs';
import * as path from 'path';

// Load Env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') {
        process.loadEnvFile(envPath);
    }
}

async function check() {
    const { adminDb } = await import('./src/lib/firebase-admin');
    if (!adminDb) {
        console.error("Admin DB not initialized");
        return;
    }

    // Find a user ID first
    const configSnap = await adminDb.collection('agent_configs').limit(1).get();
    if (configSnap.empty) {
        console.log("No configs found");
        return;
    }

    const userId = configSnap.docs[0].id;
    const config = configSnap.docs[0].data();
    console.log("Checking User:", userId);
    console.log("Standard Watchlist:", config.standardTokens);

    const snapshot = await adminDb.collection('ticker_intel').where('userId', '==', userId).get();
    const data = snapshot.docs.map(d => d.data());

    // Filter only those in standardTokens
    const standard = data.filter(d => config.standardTokens.includes(d.ticker));

    // Sort them exactly how the dashboard should
    standard.sort((a, b) => (b.rankScore || 0) - (a.rankScore || 0));

    console.log("Sorted Summary (Rank Score):");
    standard.forEach((d, i) => {
        console.log(`#${i + 1} ${d.ticker.padEnd(8)} RankScore: ${String(d.rankScore).padEnd(6)} OverallScore: ${d.overallScore}`);
    });
}

check().catch(console.error);
