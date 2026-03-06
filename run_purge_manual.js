
const { executeTacticalPurge } = require('./src/app/actions');
const { adminDb } = require('./src/lib/firebase-admin');

async function main() {
    const userId = "SF87h3pQoxfkkFfD7zCSOXgtz5h1";
    console.log(`Starting Tactical Purge for User: ${userId}...`);

    try {
        const result = await executeTacticalPurge(userId);
        console.log("Result:", result);
        process.exit(0);
    } catch (e) {
        console.error("Purge Failed:", e);
        process.exit(1);
    }
}

main();
