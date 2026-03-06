import crypto from 'crypto';

export interface RevolutBalance {
    currency: string;
    balance: number;
    available: number;
}

export interface RevolutHolding {
    currency: string;
    amount: number;
    value_usd?: number;
}

export class RevolutService {
    private apiKey: string;
    private privateKey: string;
    private baseUrl: string;

    constructor(apiKey: string, privateKey: string, isSandbox: boolean = false) {
        this.apiKey = apiKey;
        this.privateKey = privateKey;
        this.baseUrl = isSandbox
            ? 'https://sandbox-b2b.revolut.com/api/1.0'
            : 'https://b2b.revolut.com/api/1.0';

        // Revolut X might have a different base URL for the exchange specifically.
        // Based on common Revolut X API info, it's often https://api.revolut.com/exchange
        // Let's use a flexible approach.
        if (!isSandbox) {
            this.baseUrl = 'https://api.revolut.com/exchange';
        } else {
            this.baseUrl = 'https://sandbox-api.revolut.com/exchange';
        }
    }

    private sign(payload: string): string {
        const sign = crypto.sign(null, Buffer.from(payload), this.privateKey);
        return sign.toString('base64');
    }

    private async request(method: string, path: string, body?: any) {
        const timestamp = Date.now();
        const nonce = Math.floor(Math.random() * 1000000);
        const payload = `${method}${path}${timestamp}${nonce}${body ? JSON.stringify(body) : ''}`;
        const signature = this.sign(payload);

        const response = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'revolut-api-key': this.apiKey,
                'revolut-nonce': nonce.toString(),
                'revolut-signature': signature,
                'revolut-timestamp': timestamp.toString(),
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Revolut API error: ${response.status} ${error}`);
        }

        return response.json();
    }

    async getBalances(): Promise<RevolutBalance[]> {
        // This is a placeholder for the actual Revolut X endpoint
        return this.request('GET', '/accounts');
    }

    async getHoldings(): Promise<RevolutHolding[]> {
        return this.request('GET', '/positions');
    }

    async placeOrder(symbol: string, side: 'BUY' | 'SELL', amount: number, price?: number) {
        // Revolut X requires symbols in the format BASE-QUOTE (e.g. BTC-USD), not BASE/QUOTE
        const formattedSymbol = symbol.replace('/', '-');

        // Prevent JavaScript from sending scientific notation (e.g. "1e-8") to Revolut
        // By using toFixed(8) and stripping trailing zeros, we ensure a clean decimal string.
        let amountStr = amount.toFixed(8).replace(/\.?0+$/, '');
        if (amountStr === '') amountStr = '0'; // Fallback if it was exactly 0

        const body: any = {
            client_order_id: crypto.randomUUID(),
            symbol: formattedSymbol,
            side: side,
            order_configuration: {
                type: price ? 'limit' : 'market',
                quantity: amountStr,
                price: price ? price.toString() : undefined,
            }
        };
        return this.request('POST', '/orders', body);
    }
}
