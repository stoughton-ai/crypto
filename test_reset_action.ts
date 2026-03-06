require('dotenv').config({ path: '.env.local' });
const { resetVirtualPortfolio } = require('./src/services/virtualPortfolioAdmin');
async function test() {
    console.log("Starting...");
    try {
        const res = await resetVirtualPortfolio("SF87h3pQoxfkkFfD7zCSOXgtz5h1", 1000);
        console.log("Result:", res);
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
