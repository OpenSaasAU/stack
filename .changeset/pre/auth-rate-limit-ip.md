---
'create-opensaas-app': patch
---

The auth template ignores `DISABLE_RATE_LIMITING` under `NODE_ENV=production`, ships a commented `advanced.ipAddress` block, and no longer ships the variable active in `.env.example`.
