---
'@opensaas/stack-cli': patch
---

A failed reconcile prints the CLI's own text instead of raw JSON event lines, and the boot reconcile notes that an `Advanced ref` line is Prisma's own. Scaffolds are ES modules (`"type": "module"`, `next.config.mjs`), so `pnpm dev -- tsx seed.ts` accepts top-level await.
