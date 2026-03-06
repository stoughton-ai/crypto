
async function test() {
    const ticker = "APT";
    const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${ticker}`);
    if (!res.ok) {
        console.log("Not OK");
        return;
    }
    const data = await res.json();
    const best = data.pairs?.find((p: any) => p.baseToken.symbol.toUpperCase() === ticker.toUpperCase());
    if (best) {
        console.log("DEX_APT_PRICE:", best.priceUsd);
        console.log("DEX_APT_NAME:", best.baseToken.name);
    } else {
        console.log("No match");
    }
}

test().catch(console.error);
