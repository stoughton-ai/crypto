
async function test() {
    const ticker = "APT";
    const symbol = `${ticker.toUpperCase()}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) {
        console.log("Not OK");
        return;
    }
    const data = await res.json();
    console.log("BINANCE_APT_PRICE:", data.lastPrice);
}

test().catch(console.error);
