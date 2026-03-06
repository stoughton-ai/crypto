require('dotenv').config({ path: '.env.local' });
const { resetVirtualPortfolio } = require('./src/services/virtualPortfolioAdmin');
async function test() {
    console.time("ResetTime");
    const res = await resetVirtualPortfolio("SF87h3pQoxfkkFfD7zCSOXgtz5h1", 1000);
    console.timeEnd("ResetTime");
    console.log(res);
}
test();
