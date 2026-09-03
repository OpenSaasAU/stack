---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'@opensaas/stack-auth': minor
'@opensaas/stack-ui': minor
'@opensaas/stack-storage': minor
'@opensaas/stack-storage-s3': minor
'@opensaas/stack-storage-vercel': minor
'@opensaas/stack-rag': minor
'@opensaas/stack-tiptap': minor
'create-opensaas-app': minor
---

Move the toolchain to the Prisma 8 line and drop Prisma 7 and SQLite

The Prisma 8 ORM family (`@prisma/orm-postgres` at `8.0.0-rc.8`) and the `prisma` CLI (`8.0.0-rc.12`) are now the single pinned toolchain. `@prisma/client`, `@prisma/adapter-better-sqlite3` and every other Prisma 7 package are gone from every manifest, and every package states a Node `>=22.18.0` floor.

- `@opensaas/stack-core` peers on `@prisma/orm-postgres` instead of `@prisma/client`, and takes `@electric-sql/pglite`, `@electric-sql/pglite-socket` and `@electric-sql/pglite-pgvector` as optional peers for the in-process dev database.
- `@opensaas/stack-cli` depends on `prisma`, `@prisma/orm-postgres` and the three PGlite packages directly, so an app gets the CLI's toolchain without listing it.

An app on this line installs the family alongside the stack:

```bash
pnpm add @prisma/orm-postgres@8.0.0-rc.8
pnpm add -D prisma@8.0.0-rc.12
```

This is the first step of the Prisma 8 build (#1121); the generator, runtime and examples follow in later releases.
