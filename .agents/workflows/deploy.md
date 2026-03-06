---
description: Deploy the application to Vercel
---

// turbo-all

1. Run a production build to verify there are no errors:
```
cd /Users/chris/Antigravity/Semaphore10 && npx next build
```

2. Deploy to Vercel production:
```
cd /Users/chris/Antigravity/Semaphore10 && npx vercel --prod
```

3. Verify the deployment is live:
```
curl -s -o /dev/null -w "%{http_code}" https://crypto-ten-drab.vercel.app/
```
