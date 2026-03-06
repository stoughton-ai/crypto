import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
    console.log('Environment variables loaded natively from .env.local');
}

async function main() {
    const { runAutomatedAgentCheck, syncRevolutHoldings } = await import('./src/app/actions');
    const { adminDb } = await import('./src/lib/firebase-admin');

    console.log("Starting check for SF87h3pQoxfkkFfD7zCSOXgtz5h1...");

    // Optional: First sync balances so we have $1000 cash 
    await syncRevolutHoldings('SF87h3pQoxfkkFfD7zCSOXgtz5h1');

    const configDoc = await adminDb!.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const config = configDoc.data();
    console.log("Config loaded, running check...");

    // Ensure we don't have simulated values
    const result = await runAutomatedAgentCheck('SF87h3pQoxfkkFfD7zCSOXgtz5h1', config);
    console.log("Check complete.");

    if (result.success && result.execution) {
        console.log("Trades executed:", result.execution.trades.length);
        console.log("Decisions:", result.execution.decisions.length);
        const skipped = result.execution.decisions.filter((d: any) => d.action === 'SKIP' || d.action === 'THROTTLED');
        if (skipped.length > 0) {
            console.log("First 15 skips:");
            console.log(skipped.slice(0, 15).map((d: any) => `${d.ticker}: ${d.reason}`).join('\n'));
        }
    } else {
        console.log(result);
    }
}
main().catch(console.error);
