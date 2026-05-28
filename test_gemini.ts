
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { generateContentWithFallback } from './src/lib/gemini';

async function testGemini() {
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    console.log('--- 🧪 Testing Gemini API Connectivity ---');
    console.log('API Key present:', !!key);
    if (key) {
        console.log('API Key start:', key.substring(0, 5) + '...');
    }
    
    try {
        const response = await generateContentWithFallback('What is 1+1?');
        console.log('✅ Response:', response);
    } catch (e: any) {
        console.error('❌ Error Message:', e.message);
        
        // Detailed check for Spend Cap / Quota errors
        if (e.message.includes('404') || e.message.includes('not found')) {
            console.log('\n--- ⚠️ Service Paused! ---');
            console.log('Google Cloud returns 404 when the Spend Cap is active.');
        } else if (e.message.includes('429') || e.message.includes('Resource exhausted')) {
            console.log('\n--- ⚠️ Rate Limited / Quota Exhausted! ---');
        } else if (e.message.includes('403')) {
            console.log('\n--- ⚠️ Forbidden! ---');
            console.log('Check if the API Key is valid and the Generative Language API is enabled.');
        }
    }
}

testGemini();
