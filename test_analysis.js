
const { analyzeCrypto } = require('./src/app/actions');

async function test() {
    try {
        const result = await analyzeCrypto("BTC");
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
