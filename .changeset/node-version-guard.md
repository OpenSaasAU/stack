---
'@opensaas/stack-cli': patch
'create-opensaas-app': patch
---

`opensaas` and `create-opensaas-app` now exit 1 naming Node.js 22.18 when run on an older Node (fixes #2318).
