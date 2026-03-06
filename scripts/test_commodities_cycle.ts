import * as fs from 'fs'; import * as path from 'path';
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof (process as any).loadEnvFile === 'function') (process as any).loadEnvFile(envPath);
async function main() {
    const { runSandboxArenaCycle } = await import('../src/app/actions');
    console.log('Running COMMODITIES cycle...');
    const r = await runSandboxArenaCycle('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'COMMODITIES');
    console.log('Result:', JSON.stringify(r, null, 2));
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
