import * as fs from 'fs'; import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') (process as any).loadEnvFile(envPath);
async function main() {
    const { getArenaStatus } = await import('../src/app/actions');
    const r = await getArenaStatus('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'COMMODITIES');
    console.log('Trades recorded:', r.trades.length);
    r.trades.slice(0, 8).forEach(t => console.log(` ${t.type} ${t.ticker} @ $${t.price} | ${t.poolName} | ${t.date}`));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
