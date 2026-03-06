/**
 * Quick script to set the Telegram report time to 19:00 UTC (7pm UK/GMT).
 * Usage: node scripts/set_report_time.js
 */
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountJson);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    // Find all users with Telegram enabled
    const snap = await db.collection('agent_configs').where('telegramEnabled', '==', true).get();

    if (snap.empty) {
        console.log('No users with Telegram enabled found. Checking all configs...');
        const allSnap = await db.collection('agent_configs').get();
        console.log(`Total agent configs: ${allSnap.size}`);
        for (const doc of allSnap.docs) {
            const data = doc.data();
            console.log(`  User ${doc.id.substring(0, 8)}... | Telegram: ${data.telegramEnabled ? 'ON' : 'OFF'} | Report Time: ${data.telegramReportTime || '17:00'}`);

            // Update regardless
            await db.collection('agent_configs').doc(doc.id).update({
                telegramReportTime: '19:00',
            });
            console.log(`    ✅ Updated to 19:00 UTC`);
        }
    } else {
        for (const doc of snap.docs) {
            const userId = doc.id;
            const currentTime = doc.data().telegramReportTime || '17:00';
            console.log(`User ${userId.substring(0, 8)}... | Current: ${currentTime} UTC → Setting to 19:00 UTC (7pm GMT)`);

            await db.collection('agent_configs').doc(userId).update({
                telegramReportTime: '19:00',
            });
            console.log(`  ✅ Updated to 19:00 UTC`);
        }
    }

    console.log('\nDone. Report will now be sent at 7pm UK time (19:00 UTC).');
}

main().catch(console.error).then(() => process.exit(0));
