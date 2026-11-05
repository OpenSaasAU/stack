---
'create-opensaas-app': minor
---

Scaffolding needs no database

The post-scaffold step is now `install` → `generate`. There is no schema-apply
step, and the `.env` the scaffolder writes sets no `DATABASE_URL` — the first
`pnpm dev` starts the Dev database for the project and reconciles it.

```bash
npm create opensaas-app@latest my-app
cd my-app
pnpm dev   # starts the Dev database, generates, reconciles, runs the app
```

Set `DATABASE_URL` (the commented line in the generated `.env`) to develop
against a Postgres of your own; no Dev database starts when it is set.
