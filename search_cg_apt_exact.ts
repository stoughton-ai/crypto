
async function searchCoinGecko(query: string) {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${query}`);
    if (!res.ok) return null;
    return await res.json();
}

async function test() {
    const data = await searchCoinGecko("APT");
    const exactMatches = data.coins.filter((c: any) => c.symbol === "APT");
    console.log("EXACT_MATCHES_APT:", JSON.stringify(exactMatches, null, 2));
}

test().catch(console.error);
