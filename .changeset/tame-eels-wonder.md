---
'@opensaas/stack-cli': patch
---

Preserve host-added `datasource` keys (e.g. `shadowDatabaseUrl`) in `prisma.config.ts` across `generate` runs instead of overwriting the block wholesale.
