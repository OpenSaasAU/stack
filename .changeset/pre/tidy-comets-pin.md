---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-auth': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-ui': patch
---

Upgrade to Prisma ORM 8.0.0-rc.21 (CLI rc.29), and keep accepting a `Date` for a `timestamp()`/`calendarDay()` value in writes and `where` filters.
Run `pnpm generate` to re-emit committed contracts, and pin your app's `@prisma/orm-*` to `8.0.0-rc.21` and `prisma` to `8.0.0-rc.29`.
