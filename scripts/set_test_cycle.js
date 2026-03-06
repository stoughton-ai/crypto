// Temporarily sets analysisCycle to 2 minutes for autopilot testing.
// Run: node scripts/set_test_cycle.js set    → 2 minute cycle
// Run: node scripts/set_test_cycle.js revert → restore original cycle
require('dotenv').config({ path: '.env.local' });

const admin = require('firebase-admin');

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccountJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON not found in .env.local');
    process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountJson)) });
const db = admin.firestore();

const TWO_MINUTES_HOURS = 2 / 60; // 0.0333...

async function run() {
    const mode = process.argv[2]; // 'set' or 'revert'

    // Find the user config doc
    const snap = await db.collection('agent_configs').limit(1).get();
    if (snap.empty) { console.error('No agent_config found'); process.exit(1); }

    const docRef = snap.docs[0].ref;
    const userId = snap.docs[0].id;
    const data = snap.docs[0].data();
    const originalCycle = data.analysisCycle;

    if (mode === 'set') {
        // Set cycle to 2 minutes and reset lastActive to right now so the 2min timer starts fresh
        await docRef.update({
            analysisCycle: TWO_MINUTES_HOURS,
            brainState: {
                ...(data.brainState || {}),
                lastActive: new Date().toISOString(),
                currentAction: 'Test cycle — 2 min autopilot verification',
            }
        });
        console.log(`✅ User: ${userId}`);
        console.log(`   analysisCycle set to ${TWO_MINUTES_HOURS.toFixed(4)}h (2 minutes)`);
        console.log(`   lastActive reset to NOW — timer starts fresh`);
        console.log(`   Original cycle was: ${originalCycle}h — run 'revert' after testing`);
    } else if (mode === 'revert') {
        // Restore the original cycle — use 2h as safe default if we can't recover it
        const restore = data._originalCycle || 2;
        await docRef.update({ analysisCycle: restore });
        console.log(`✅ analysisCycle restored to ${restore}h`);
    } else {
        console.error('Usage: node scripts/set_test_cycle.js [set|revert]');
        process.exit(1);
    }
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
