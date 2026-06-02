---
'create-opensaas-app': minor
---

Add an optional `--db postgres` flag (and matching database prompt) to scaffold a PostgreSQL-ready project instead of the SQLite default.

```bash
# PostgreSQL-ready: pg driver adapter, Postgres .env, migrate scripts
npm create opensaas-app my-app --db postgres

# Force SQLite and skip the database prompt (unchanged default behaviour)
npm create opensaas-app my-app --db sqlite
```

With `--db postgres` the generated `opensaas.config.ts` uses the `PrismaPg` driver adapter (`new pg.Pool({ connectionString: process.env.DATABASE_URL })`), the `.env` / `.env.example` carry `DATABASE_URL` (pooled) and `DIRECT_DATABASE_URL` (direct) placeholders, and the `@prisma/adapter-pg` + `pg` dependencies replace the SQLite ones. The `migrate` / `migrate:deploy` scripts are kept so you can apply migrations to your database. Without the flag, SQLite remains the zero-setup default and the interactive prompt offers SQLite (default) or PostgreSQL.
