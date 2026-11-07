---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-ui': minor
---

Upgrade to Prisma ORM 8.0.0-rc.22 and the `prisma` CLI to 8.0.0-rc.30

The stack's date and time columns are unchanged: `timestamp()` and `calendarDay()` keep reading and writing ISO strings, and `contract.json` is byte-identical. Prisma ORM now refuses to run from two installed copies, so every `@prisma/orm-*` package and the `prisma` CLI must move together:

```json
{
  "dependencies": { "@prisma/orm-postgres": "8.0.0-rc.22" },
  "devDependencies": { "prisma": "8.0.0-rc.30" }
}
```

Then run `pnpm generate` and commit what it writes. A project using `ragPlugin` or another pgvector declaration gets a new head for `migrations/pgvector/`: run `prisma db migrate` on each database to move the pack's marker.
