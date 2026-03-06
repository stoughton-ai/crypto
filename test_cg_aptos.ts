
async function getAptos() {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/aptos?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`);
    if (!res.ok) return null;
    return await res.json();
}

async function test() {
    const data = await getAptos();
    console.log("APTOS_PRICE:", data.market_data.current_price.usd);
}

test().catch(console.error);
