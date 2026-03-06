/**
 * debug_commodities.ts
 * Diagnoses why the Commodities cycle returns no prices / no trades.
 */
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') {
    (process as any).loadEnvFile(envPath);
}

async function main() {
    const { adminDb } = await import('../src/lib/firebase-admin');
    if (!adminDb) { console.error('No DB'); process.exit(1); }

    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';

    // 1. Read the arena config
    const snap = await adminDb.collection('arena_config_commodities').doc(userId).get();
    if (!snap.exists) { console.error('No commodities arena config found'); process.exit(1); }
    const arena = snap.data() as any;

    console.log('=== COMMODITIES ARENA CONFIG ===');
    console.log('initialized:', arena.initialized);
    console.log('competitionMode:', arena.competitionMode);
    console.log('startDate:', arena.startDate);
    console.log('endDate:', arena.endDate);

    const tokens = new Set<string>();
    for (const pool of arena.pools) {
        console.log(`\n  Pool: ${pool.poolId} | ${pool.name} | status=${pool.status}`);
        console.log(`    tokens: ${pool.tokens?.join(', ')}`);
        console.log(`    cashBalance: ${pool.cashBalance}`);
        console.log(`    holdings: ${JSON.stringify(pool.holdings || {})}`);
        pool.tokens?.forEach((t: string) => tokens.add(t.toUpperCase()));
    }

    console.log('\n=== TOKEN LIST ===', [...tokens]);

    // 2. Try EODHD price fetch
    const { formatEODHDTicker, parseEODHDTicker } = await import('../src/lib/constants');
    const EODHD_API_KEY = process.env.EODHD_API_KEY || '';
    if (!EODHD_API_KEY) { console.error('No EODHD_API_KEY'); process.exit(1); }

    const eodhdTickers = [...tokens].map(t => {
        const mapped = formatEODHDTicker(t, 'COMMODITIES');
        console.log(`  ${t} → ${mapped}`);
        return mapped;
    });

    console.log('\n=== EODHD PRICE TEST ===');
    const primary = eodhdTickers[0];
    const extras = eodhdTickers.slice(1).join(',');
    const url = `https://eodhd.com/api/real-time/${primary}?${extras ? `s=${extras}&` : ''}api_token=${EODHD_API_KEY}&fmt=json`;
    console.log('Fetching:', url.replace(EODHD_API_KEY, 'KEY_REDACTED'));

    try {
        const res = await fetch(url);
        console.log('HTTP status:', res.status);
        const raw = await res.text();
        console.log('Raw response (first 800 chars):\n', raw.substring(0, 800));

        let data: any[] = [];
        try {
            const parsed = JSON.parse(raw);
            data = Array.isArray(parsed) ? parsed : [parsed];
        } catch { }

        console.log('\n=== PARSED PRICES ===');
        for (const item of data) {
            const code = item.code || '?';
            const close = item.close;
            const prevClose = item.previousClose;
            const ticker = parseEODHDTicker(code, 'COMMODITIES');
            console.log(`  ${code} → ${ticker}: close=${close} prev=${prevClose}`);
        }
    } catch (e: any) {
        console.error('Fetch error:', e.message);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
