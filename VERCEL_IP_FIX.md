# Overcoming Revolut API Whitelist Issues on Vercel

Vercel uses dynamic IP addresses for its Serverless Functions, which means they change constantly. Revolut Business/X requires you to whitelist specific IPs or CIDR ranges, making it impossible to whitelist Vercel directly.

## Solution: Use a Static Egress Proxy

The best way to solve this is to route your Revolut API requests through a proxy server with a **Static IP**.

### 1. Choice of Proxy
- **Option A: QuotaGuard (Easiest)**: A Vercel/Heroku addon that provides static egress IPs via a proxy URL.
- **Option B: Self-Hosted Node.js Proxy**: Deploy a tiny script to a platform that offers static IPs (like a small AWS EC2 instance, DigitalOcean Droplet, or Railway with a Static IP).

### 2. Setting up your Proxy (Self-Hosted Example)
If you have a server with a static IP (e.g., `1.2.3.4`), you can run a simple proxy:

```javascript
// simple-proxy.js
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use('/', createProxyMiddleware({
  target: 'https://revx.revolut.com',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    // Log requests for debugging
    console.log(`Proxying: ${req.method} ${req.url}`);
  }
}));

app.listen(3000, () => console.log('Revolut Proxy running on port 3000'));
```

### 3. Application Configuration
I have already updated the codebase to support a `REVOLUT_PROXY_URL` environment variable.

1.  **Whitelist the Static IP**: Go to your Revolut Business/X dashboard and whitelist the IP of your proxy server.
2.  **Add Environment Variable**: In your Vercel Project Settings, add:
    - `REVOLUT_PROXY_URL`: `https://your-proxy-domain.com` (pointing to your proxy server).

### 4. How it Works Now
The `RevolutX` class in `src/lib/revolut.ts` now accepts an optional `proxyBaseUrl`. When `REVOLUT_PROXY_URL` is set, the app will send all signature-secured requests to your proxy, which then forwards them to Revolut from its whitelisted static IP.

---
**Note:** Ensure your proxy is secured (e.g., by checking a secret header or restricting access to Vercel's outbound ranges) to prevent unauthorized use.
