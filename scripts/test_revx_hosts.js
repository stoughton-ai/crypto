
const urls = [
    'https://revx.revolut.com',
    'https://sandbox-revx.revolut.com',
    'https://ax.revolut.com',
    'https://sandbox-ax.revolut.com',
    'https://revx-sandbox.revolut.com',
    'https://sandbox.revx.revolut.com'
];

async function test() {
    for (const url of urls) {
        try {
            console.log(`Testing ${url}...`);
            const res = await fetch(url + '/api/1.0/configuration/currencies', { method: 'GET' });
            console.log(`  Result: ${res.status}`);
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
    }
}

test();
