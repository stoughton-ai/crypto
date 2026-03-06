import { adminDb } from './src/lib/firebase-admin';

async function test() {
    const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
    const data = d.data();
    console.log('stopLossTriggered:', data.stopLossTriggered);
    console.log('stopLossDrawdownPct:', data.stopLossDrawdownPct);
    console.log('portfolioStopLoss:', data.portfolioStopLoss);
    console.log('stopLossResumedAt:', data.stopLossResumedAt);
    console.log('stopLossPeakValue:', data.stopLossPeakValue);
    console.log('stopLossCurrentValue:', data.stopLossCurrentValue);
    process.exit(0);
}
test();
