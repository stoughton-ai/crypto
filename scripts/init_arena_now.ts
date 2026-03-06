import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);

async function go() {
    const { aiInitializeArena } = await import('../src/app/actions');
    const userId = 'SF87h3pQoxfkkFfD7zCSOXgtz5h1';
    console.log('🏟️ Initializing arena for user:', userId);
    console.log('This will call Gemini AI to select tokens and create 4 strategy pools...');
    const result = await aiInitializeArena(userId);
    console.log('\nResult:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
}
go().catch(e => { console.error(e); process.exit(1); });
