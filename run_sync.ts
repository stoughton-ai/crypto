import { syncRevolutHoldings } from './src/app/actions';

async function run() {
    console.log("Starting sync...");
    await syncRevolutHoldings('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
    console.log("Sync complete");
    process.exit(0);
}
run();
