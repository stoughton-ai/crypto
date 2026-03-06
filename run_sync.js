const { syncRevolutHoldings } = require('./src/app/actions');
async function run() {
    await syncRevolutHoldings('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
    console.log("Sync complete");
    process.exit(0);
}
run();
