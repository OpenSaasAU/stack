---
'create-opensaas-app': minor
---

Scaffolded projects now start with a runnable environment file, so `pnpm generate` and `pnpm db:push` work immediately with no manual `.env` setup.

Previously the basic template shipped an empty `.env` and a PostgreSQL-defaulted `.env.example` even though its config uses SQLite, so the very first documented command failed with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Now the basic (SQLite) template writes a canonical `.env` (`DATABASE_URL="file:./dev.db"`) plus a matching `.env.example`, and the `--with-auth` template seeds `.env` from its own `.env.example` so the Better-auth variables are preserved.

The scaffolder's project-name validation, `package.json` version rewriting, and env generation are now pure, unit-tested helpers in `src/lib/`. The unimplemented `--template` flag has been removed so advertised flags match real behaviour.
