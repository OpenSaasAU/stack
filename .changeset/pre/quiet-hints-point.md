---
'@opensaas/stack-cli': patch
---

`opensaas generate` now points to `pnpm dev` (or `pnpm db:update` while dev is running) instead of `npx prisma db update`, which fails without `DATABASE_URL`.
