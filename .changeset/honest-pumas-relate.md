---
'@opensaas/stack-cli': patch
'@opensaas/stack-core': patch
---

Fix outdated SQLite adapter guidance to match the installed `@prisma/adapter-better-sqlite3` API (`PrismaBetterSqlite3` constructed with `{ url }`), so copied examples actually run. Updates the CLI "missing adapter" error message and the migration config it generates, plus the `prismaClientConstructor` JSDoc example.
