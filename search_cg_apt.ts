
async function searchCoinGecko(query: string) {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${query}`);
    if (!res.ok) return null;
    return await res.json();
}

async function test() {
    const data = await searchCoinGecko("APT");
    console.log("SEARCH_RESULTS_APT:", JSON.stringify(data.coins.slice(0, 5), null, 2));
}

test().catch(console.error);
