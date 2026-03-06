import { manualBurnToken } from './src/app/actions';
async function run() {
    await manualBurnToken('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'HNT');
    console.log("HNT burned");
    process.exit(0);
}
run();
