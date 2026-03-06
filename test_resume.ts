import { adminDb } from './src/lib/firebase-admin';
import { resumeAfterStopLoss } from './src/app/actions';

async function test() {
    const result = await resumeAfterStopLoss('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
    console.log('Result:', result);
    process.exit();
}
test();
