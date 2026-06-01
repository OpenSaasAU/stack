# Local development uses SQLite + `db push`; production uses PostgreSQL + `prisma migrate`

Scaffolded apps default to SQLite with `prisma db push` for a zero-setup local loop, but production runs on PostgreSQL with versioned `prisma migrate` migrations. These are deliberately two different workflows, and the split is baked into the templates, the generated `prisma.config.ts`, and the deployment guide.

## Decisions

- **Two database loops.** Local dev: SQLite + `db push` (fast, no migration history, disposable `dev.db`). Production: PostgreSQL + `prisma migrate dev` (authoring versioned migrations) and `prisma migrate deploy` (applying them). `db push` is **not** a supported path to production — it is diff-and-force with no history and risks data loss on schema change.
- **Switching to Postgres is a documented one-time manual change** to the `db` block of `opensaas.config.ts` (provider `sqlite → postgresql`, driver adapter `PrismaBetterSqlite3 → PrismaPg`/`PrismaNeon`, install the adapter) plus `DATABASE_URL`. A scaffolder `--db postgres` flag was considered and deferred — the common journey is "develop on SQLite, switch once at deploy," so a one-time documented swap beats maintaining a second template/provider matrix.
- **Pooled-adapter / direct-CLI connection split** (for serverless Postgres such as Neon). The running app's driver adapter connects with the **pooled** `DATABASE_URL`; the Prisma CLI (migrations) reads `prisma.config.ts`'s `datasource`, which is CLI-only, and uses a **direct** connection: `env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL')`. The fallback keeps SQLite/local untouched (no second URL needed). This replaces the older top-level `directUrl` in the `db` config, which does not apply in the driver-adapter model.
- **Deployment is verified by a one-time manual maintainer runbook** (deploy `starter` and `starter-auth` to Vercel + Neon), not an automated CI deploy job — a CI deploy gate would need hosting/DB credentials as secrets and add recurring cost/flakiness for low marginal signal.

## Why this is worth recording

A future reader will otherwise wonder why there are two database workflows, why `prisma.config.ts` points at a _direct_ URL while the application connects via a _pooled_ one, and why production deployment isn't gated in CI. Each is a deliberate trade-off (zero-setup local dev vs safe versioned production schema changes; serverless connection-pooling constraints; CI cost vs signal), and reversing any of them touches templates, generated config, and docs together.
