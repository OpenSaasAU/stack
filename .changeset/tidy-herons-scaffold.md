---
'create-opensaas-app': minor
---

Templates are the Prisma 8 starters: Postgres under `opensaas dev`, PascalCase `context.db` keys, and no generated artifacts in the copy

The scaffolder copies `examples/starter` and `examples/starter-auth`, both now on `db: { provider: 'postgresql' }` with every `context.db` call on the query-value surface. The template copy strips `prisma.config.ts`, `prisma/contract.*` and `migrations/` (ADR-0067): the post-scaffold `generate` recreates the first three and the first `pnpm dev` writes `migrations/` for the new project's own database.

What a template leaves out is decided per whole path segment, against each entry's path relative to the example — so a checkout under a directory named after one of those patterns (`…/prisma-8/…`) no longer excludes the entire tree, and a source file such as `lib/prisma-helpers.ts` is kept. A copy that produces no files, or no `package.json`, now fails the build instead of publishing an empty template.

```bash
npm create opensaas-app@latest my-app
cd my-app
pnpm dev   # starts the Dev database, reconciles it, serves the app and /admin
```
