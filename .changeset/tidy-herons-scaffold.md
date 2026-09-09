---
'create-opensaas-app': minor
---

Templates are the Prisma 8 starters: Postgres under `opensaas dev`, PascalCase `context.db` keys, and no generated artifacts in the copy

The scaffolder copies `examples/starter` and `examples/starter-auth`, both now on `db: { provider: 'postgresql' }` with every `context.db` call on the query-value surface. The template copy strips `prisma.config.ts`, `prisma/contract.*` and `migrations/` (ADR-0067): the post-scaffold `generate` recreates the first three and the first `pnpm dev` writes `migrations/` for the new project's own database.

```bash
npm create opensaas-app@latest my-app
cd my-app
pnpm dev   # starts the Dev database, reconciles it, serves the app and /admin
```
