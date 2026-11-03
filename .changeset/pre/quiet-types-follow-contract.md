---
'@opensaas/stack-cli': patch
---

Fix generated `.opensaas/types.ts` importing `../prisma/contract.d.js` regardless of `output.contractModule`/`output.opensaasDir`.
