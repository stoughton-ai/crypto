
import { adminDb } from './src/lib/firebase-admin';

async function check() {
    const userId = "SF87h3pQoxfkkFfD7zCSOXgtz5h1";
    const doc = await adminDb.collection('agent_configs').doc(userId).get();
    const data = doc.data();
    console.log("Min Market Cap:", data?.minMarketCap);
    console.log("Traffic Light:", data?.trafficLightTokens);
    console.log("Standard:", data?.standardTokens);
}

check().catch(console.error);
