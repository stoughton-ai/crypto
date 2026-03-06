
import { RevolutX } from '../src/lib/revolut';
import * as fs from 'fs';
import * as path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    // @ts-ignore
    if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath);
}

async function diagnose() {
    console.log("--- PROXY DIAGNOSTIC TOOL ---");

    const proxyUrl = process.env.REVOLUT_PROXY_URL;
    if (!proxyUrl) {
        console.error("❌ REVOLUT_PROXY_URL not found in .env.local");
        return;
    }

    const cleanProxy = proxyUrl.replace(/:[^:@]+@/, ':***@');
    console.log(`Checking Proxy: ${cleanProxy}`);

    // Get both IPv4 and IPv6 using reliable dedicated endpoints
    const ipV4 = await fetch('https://v4.ident.me').then(r => r.text()).catch(() => 'unknown');
    const ipV6 = await fetch('https://v6.ident.me').then(r => r.text()).catch(() => 'unknown');
    console.log(`Your Current IPv4: ${ipV4}`);
    console.log(`Your Current IPv6: ${ipV6}`);

    const client = new RevolutX('test', 'test', false, proxyUrl);

    console.log("\nTesting connection through proxy...");
    try {
        const outbound = await client.getOutboundIp();
        if (outbound.startsWith('Error:')) throw new Error(outbound);
        console.log(`✅ Proxy is WORKING! Outbound IP via Proxy: ${outbound}`);
    } catch (e: any) {
        console.error(`\n❌ Proxy Failed: ${e.message}`);
        console.log("\n--- ACTION REQUIRED ---");
        console.log(`1. SSH into your proxy server: ssh root@159.203.144.177`);
        console.log(`2. Run these commands:`);
        if (ipV4 !== 'unknown') console.log(`   echo 'Allow ${ipV4}' >> /etc/tinyproxy/tinyproxy.conf`);
        if (ipV6 !== 'unknown') console.log(`   echo 'Allow ${ipV6}' >> /etc/tinyproxy/tinyproxy.conf`);
        console.log(`   systemctl restart tinyproxy`);
        console.log(`\nAfter running that, try this diagnostic again.`);
    }
}

diagnose();
