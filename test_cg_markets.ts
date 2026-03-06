
async function test() {
    const idString = "bitcoin,ethereum,solana";
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${idString}`);
    if (!res.ok) {
        console.log("Not OK", res.status);
        return;
    }
    const data = await res.json();
    console.log("MARKETS_DATA:", JSON.stringify(data, null, 2));
}

test().catch(console.error);
