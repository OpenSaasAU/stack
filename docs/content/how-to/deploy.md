# Deployment Guide

This guide walks you through deploying your Stack application to production using Vercel and Neon PostgreSQL.

Locally, `pnpm dev` runs the **Dev database** — a Postgres the stack starts for your project — and reconciles it with your config as you edit. Production runs on a PostgreSQL server you provision, migrated from a committed `migrations/` directory with **`prisma db migrate`**. These are deliberately two different workflows (see [ADR-0003](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0003-deployment-uses-postgres-and-prisma-migrate.md) and [ADR-0063](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0063-the-dev-database-is-a-stack-run-in-process-postgres-shared-with-the-test-harness.md)). This guide covers the production loop.

## Prerequisites

Before deploying, make sure you have:

- A [Vercel account](https://vercel.com/signup) (free tier works)
- A [Neon account](https://neon.tech) (free tier includes 10GB storage)
- Your Stack application working locally
- Git repository (GitHub, GitLab, or Bitbucket)

## Overview

The deployment process involves:

1. Setting up a production database (Neon PostgreSQL)
2. Pointing your config at it (provider + driver adapter)
3. Configuring environment variables (pooled app URL + direct migration URL)
4. Deploying to Vercel
5. Applying database migrations
6. Verifying your deployment

**Total time:** ~10-15 minutes for first deployment

## How database connections flow

Stack uses Prisma 7, which requires a **driver adapter** at runtime. There are two distinct places a database URL is consumed, and on serverless Postgres they intentionally point at different connection strings:

- **The running app** connects through a driver adapter built in your `prismaClientConstructor` (in `opensaas.config.ts`). On serverless platforms like Vercel this must use the **pooled** `DATABASE_URL` to avoid exhausting connection limits.
- **The Prisma CLI** (migrations, Studio) reads the datasource from the generated `prisma.config.ts`. That file prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so migrations run over a **direct** (non-pooled) connection.

This is the **pooled-app / direct-CLI split**: set `DATABASE_URL` to Neon's pooled URL (used by the app) and `DIRECT_DATABASE_URL` to Neon's direct URL (used by migrations). The lookup prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so setting only the latter is fine where there is no pooler.

### The Database escape

Setting either variable **is** the escape: the lookup takes the environment branch, and no Dev database starts. In production that is the only branch there is — a deployment with neither variable set gets an error naming both remedies, never a silent in-process database. Locally you set neither, and `pnpm dev` runs the Dev database instead; set one to develop against a Postgres of your own for parity or contention.

**Provisioning an extension your config declares.** A declared extension pack (pgvector, for instance) is a committed **Extension contract space** in `migrations/`, and Prisma runs `CREATE EXTENSION IF NOT EXISTS` from it on every path — the Dev database, CI, and `prisma db migrate` in production. Your job is provisioning, not DDL: make the extension available on the server, and either let the migrating role create it or pre-create it. An extension that is already installed is detected and skipped, so a DBA who runs `CREATE EXTENSION vector` once is not in conflict with the migration. This matters because pgvector is **not** a trusted extension: creating it needs superuser or a provider grant (Neon, Supabase and RDS grant it to the app role; a locked-down Postgres does not). Where the server does not have it available at all, the migration fails with Prisma's own error naming the failing space, the missing control file and SQL state `58P01`, and the app's own migration is untouched — every apply runs in one transaction. See [ADR-0065](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0065-the-extension-contract-space-is-a-generator-emission-and-prisma-runs-create-extension.md).

## Step 1: Create Production Database

### Using Neon PostgreSQL

Neon provides serverless PostgreSQL with automatic scaling and a generous free tier.

1. **Sign in to Neon Console**
   - Go to [console.neon.tech](https://console.neon.tech)
   - Create an account or sign in

2. **Create a New Project**
   - Click "New Project"
   - Choose a name (e.g., `my-app-production`)
   - Select a region close to your users
   - Choose Postgres version (16 recommended)
   - Click "Create Project"

3. **Get Connection Strings**
   - After creation, Neon shows your connection string
   - It looks like: `postgresql://username:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`
   - Neon provides two flavours — copy **both**:
     - **Pooled connection** (recommended for serverless): use this for `DATABASE_URL` (the app)
     - **Direct connection**: use this for `DIRECT_DATABASE_URL` (migrations and Prisma Studio)

4. **Enable Connection Pooling (Recommended)**
   - In your Neon project dashboard, go to "Settings" → "Connection Pooling"
   - Pooling is on by default; the pooled string typically contains `-pooler` in the host
   - Use the **pooled** connection string for `DATABASE_URL`
   - Use the **direct** connection string for `DIRECT_DATABASE_URL`

## Step 2: Switch Your Config to PostgreSQL

Locally your app is configured for SQLite with the `PrismaBetterSqlite3` adapter. For production, switch the `db` block of `opensaas.config.ts` to PostgreSQL — change the `provider` and swap the driver adapter. This is a one-time, well-signposted change.

### Install the PostgreSQL adapter

For a standard Postgres connection (works with Neon and any Postgres host):

```bash
pnpm add @prisma/adapter-pg pg
```

For Neon's serverless driver (uses WebSockets, optimised for serverless/edge):

```bash
pnpm add @prisma/adapter-neon @neondatabase/serverless ws
```

### Update `opensaas.config.ts`

Replace the SQLite `db` block with a PostgreSQL one. The driver adapter connects using the **pooled** `DATABASE_URL`.

**Option A — `@prisma/adapter-pg` (standard Postgres driver):**

```typescript
import { config } from '@opensaas/stack-core'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default config({
  db: {
    provider: 'postgresql',
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    // ... your lists
  },
})
```

**Option B — `@prisma/adapter-neon` (Neon serverless driver):**

```typescript
import { config } from '@opensaas/stack-core'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

export default config({
  db: {
    provider: 'postgresql',
    prismaClientConstructor: (PrismaClient) => {
      neonConfig.webSocketConstructor = ws
      const adapter = new PrismaNeon({
        connectionString: process.env.DATABASE_URL,
      })
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    // ... your lists
  },
})
```

There is **no** top-level `url` or `directUrl` in the `db` block — Prisma 7 takes the URL through the adapter, and the direct/migration URL lives in `prisma.config.ts` (see below). Don't add fields that no longer exist.

### Regenerate

```bash
pnpm generate
```

This rewrites `prisma/schema.prisma` for the `postgresql` provider and regenerates `prisma.config.ts`. The generated `prisma.config.ts` looks like this — it's CLI-only and prefers the direct URL:

```typescript
import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Read an environment variable, returning undefined when unset so the
// `??` fallback below can take effect. (The `env` helper from
// 'prisma/config' throws on missing variables, which would break the
// fallback.)
const env = (name: string): string | undefined => process.env[name]

export default defineConfig({
  schema: 'prisma',
  datasource: {
    url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
  },
})
```

You don't edit this file — it's generated. It only affects Prisma CLI commands, never the running app.

## Step 3: Configure Environment Variables

### Local Production Testing (Optional)

Create a `.env.production.local` file in your project root to test against the production database before deploying:

```bash
# .env.production.local

# Pooled connection — used by the app (driver adapter)
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"

# Direct connection — used by Prisma CLI (migrations / Studio)
DIRECT_DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"
```

**Why two URLs?**

- `DATABASE_URL` (pooled): the connection your **app** uses at runtime, via the driver adapter. Pooling lets serverless functions share connections instead of exhausting the database's limit.
- `DIRECT_DATABASE_URL` (direct): the connection the **Prisma CLI** uses for `migration plan` / `db migrate`. Migrations need a direct, non-pooled connection. The generated `prisma.config.ts` reads it as `DIRECT_DATABASE_URL ?? DATABASE_URL`.

### Environment Variables for Better Auth (If Using)

If you're using `@opensaas/stack-auth`, add the auth variables. `BETTER_AUTH_URL` (and `NEXT_PUBLIC_APP_URL`) must be your **deployed** URL in production:

```bash
# .env.production.local

# Database
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"
DIRECT_DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"

# Better Auth
BETTER_AUTH_SECRET="your-random-secret-here"
BETTER_AUTH_URL="https://your-app.vercel.app"
NEXT_PUBLIC_APP_URL="https://your-app.vercel.app"

# OAuth providers (optional)
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

**Generate a secure secret:**

```bash
openssl rand -base64 32
```

### Environment variable checklist

| Variable               | Used by             | Value                                                  | Required          |
| ---------------------- | ------------------- | ------------------------------------------------------ | ----------------- |
| `DATABASE_URL`         | App (adapter)       | Neon **pooled** connection string                      | Always            |
| `DIRECT_DATABASE_URL`  | Prisma CLI          | Neon **direct** connection string                      | Always (Postgres) |
| `BETTER_AUTH_SECRET`   | Better Auth         | `openssl rand -base64 32`                              | If using auth     |
| `BETTER_AUTH_URL`      | Better Auth         | Your deployed URL (e.g. `https://your-app.vercel.app`) | If using auth     |
| `NEXT_PUBLIC_APP_URL`  | Client              | Your deployed URL                                      | If using auth     |
| `GITHUB_CLIENT_ID`     | Better Auth (OAuth) | From your GitHub OAuth app                             | If using GitHub   |
| `GITHUB_CLIENT_SECRET` | Better Auth (OAuth) | From your GitHub OAuth app                             | If using GitHub   |
| `GOOGLE_CLIENT_ID`     | Better Auth (OAuth) | From your Google OAuth client                          | If using Google   |
| `GOOGLE_CLIENT_SECRET` | Better Auth (OAuth) | From your Google OAuth client                          | If using Google   |

## Step 4: Author the First Migration

Before your first deploy, plan the initial migration from your config and commit it.

Planning needs a database to plan against, and this step runs outside the dev loop, so take the Database escape for it: set `DIRECT_DATABASE_URL` (or `DATABASE_URL`) at a Postgres you are willing to have a planning connection opened against — the Neon project from Step 1, a local Docker Postgres, or a throwaway Neon branch. Do not point it at production data you cannot replace.

```bash
export DIRECT_DATABASE_URL="postgresql://..."
pnpm generate
pnpm migrate
```

`pnpm migrate` runs `prisma migration plan`, which writes a migration package into the `migrations/` directory at your project root. Commit that whole directory to Git. It is your schema history, and it holds more than your app's own space: `pnpm generate` seeds an **Extension contract space** into it for every extension pack your config declares, and the production release step replays all of them together.

> **Local dev vs production.** `pnpm dev` reconciles the Dev database with your config directly. That has **no migration history** and can drop data on a schema change, so it is **not** a supported path to production. Production always migrates from the committed directory.

## Step 5: Deploy to Vercel

You have two options: Vercel CLI (faster) or Vercel Dashboard (more visual).

### Option A: Deploy with Vercel CLI (Recommended)

1. **Install Vercel CLI**

```bash
npm install -g vercel
```

2. **Login to Vercel**

```bash
vercel login
```

3. **Deploy from Project Root**

```bash
vercel
```

Follow the prompts:

- "Set up and deploy?" → Yes
- "Which scope?" → Choose your account/team
- "Link to existing project?" → No (first time) or Yes (subsequent deploys)
- "What's your project's name?" → Enter name or press Enter
- "In which directory is your code located?" → Press Enter (current directory)
- "Want to override settings?" → No

4. **Add Environment Variables**

```bash
vercel env add DATABASE_URL production
# Paste your pooled connection string

vercel env add DIRECT_DATABASE_URL production
# Paste your direct connection string

# If using Better Auth:
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production
vercel env add NEXT_PUBLIC_APP_URL production
```

5. **Deploy to Production**

```bash
vercel --prod
```

### Option B: Deploy with Vercel Dashboard

1. **Push to Git**

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

2. **Import Project in Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Click "Import Project"
   - Select your Git repository
   - Click "Import"

3. **Configure Project**
   - **Framework Preset:** Next.js (should auto-detect)
   - **Root Directory:** `./` (leave default)
   - **Build Command:** `pnpm build` (or leave default)
   - **Output Directory:** `.next` (leave default)
   - **Install Command:** `pnpm install` (or leave default)

4. **Add Environment Variables**
   - Click "Environment Variables"
   - Add each variable:
     - `DATABASE_URL` → Your pooled connection string
     - `DIRECT_DATABASE_URL` → Your direct connection string
     - `BETTER_AUTH_SECRET` → Your random secret (if using auth)
     - `BETTER_AUTH_URL` → `https://your-app.vercel.app` (update after first deploy)
     - `NEXT_PUBLIC_APP_URL` → `https://your-app.vercel.app` (if using auth)
     - Add any OAuth credentials if using social login

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete (~2-3 minutes)
   - Your app will be live at `https://your-app.vercel.app`

## Step 6: Apply Migrations to Production

Run your committed migrations against the production database. Because `prisma.config.ts` resolves `DIRECT_DATABASE_URL ?? DATABASE_URL`, `prisma db migrate` automatically uses the **direct** connection.

```bash
pnpm migrate:deploy
```

`pnpm migrate:deploy` runs `prisma db migrate`, applying every committed package in order — your app's space and each extension space — without prompting. It never plans new migrations, so it's safe to run repeatedly and in CI.

### Running migrations as part of the build (recommended)

To apply migrations automatically on every Vercel deploy, add `prisma db migrate` to the build command. The starter templates' `build` script is `pnpm generate && next build`; extend it to:

```json
{
  "scripts": {
    "build": "pnpm generate && prisma db migrate && next build"
  }
}
```

Ensure **`DIRECT_DATABASE_URL`** is set in your Vercel environment variables so the build-time migration uses the direct connection.

**Alternative — apply migrations manually before deploying:**

```bash
# Locally, against the production DB (DIRECT_DATABASE_URL set)
pnpm migrate:deploy

# Then deploy
vercel --prod
```

### Verify Database Setup

Inspect your database with Prisma Studio (uses the direct connection via `prisma.config.ts`):

```bash
# DIRECT_DATABASE_URL set in your environment
pnpm db:studio
```

Open [http://localhost:5555](http://localhost:5555) to view your production database.

## Step 7: Verify Deployment

1. **Visit Your App**
   - Go to your Vercel deployment URL
   - You should see your app running

2. **Test Database Connectivity**
   - If you have an admin UI (`/admin`), try creating a record
   - Verify it appears in Prisma Studio
   - Check for any console errors

3. **Smoke-check access control**
   - Confirm anonymous vs. authenticated behaviour matches local: e.g. anonymous visitors only see published records, and owner-only rows/fields stay protected. Access control runs identically in production.

4. **Check Vercel Logs**
   - Go to your project in Vercel Dashboard
   - Click "Deployments" → Select latest deployment → "Functions"
   - View logs for any errors

5. **Confirm Better Auth URLs (If Using)**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Ensure `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` are your production URL (e.g., `https://your-app.vercel.app`)
   - Redeploy: `vercel --prod` or push to Git

## Continuous Deployment

### Automatic Deployments

Once connected to Git, Vercel automatically deploys:

- **Production:** Pushes to `main` branch → `your-app.vercel.app`
- **Preview:** Pull requests → `your-app-git-branch.vercel.app`

### Deploy Workflow

```bash
# Make changes locally; `pnpm dev` regenerates and reconciles the Dev database
pnpm dev

# When you change the schema, plan a migration to ship
pnpm migrate

# Commit and push (including the new migrations/ packages)
git add .
git commit -m "Add new feature"
git push

# Vercel deploys; the build step runs `prisma db migrate`
# (if you added it to the build command) using DIRECT_DATABASE_URL
```

### Database Migrations in CI/CD

For schema changes, migrations are applied via `prisma db migrate` — either in the Vercel build command (see [Step 6](#running-migrations-as-part-of-the-build-recommended)) or as an explicit step before deploy:

```bash
# In CI, against the production DB (DIRECT_DATABASE_URL set)
pnpm migrate:deploy
```

`db migrate` only applies existing committed packages; it never plans new ones, which makes it safe to run in an automated pipeline.

### Authoring Migrations in CI / Agent Environments

Applying migrations is what `prisma db migrate` already does non-interactively. _Planning_ a new one needs a database to plan against — `prisma migration plan` resolves its origin through the `db` ref in the committed `migrations/` directory and the connection `prisma.config.ts` gives it — so point `DIRECT_DATABASE_URL` at a disposable Postgres (a CI service container, Docker, or a throwaway Neon branch) and run:

```bash
pnpm generate
pnpm migrate
```

Commit everything the command writes under `migrations/`, the refs included. It is the same output an interactive local run produces.

## Production Considerations

### Bundling the Generated `.opensaas` bundle

`opensaas generate` emits a **Generated bundle** under `.opensaas/` — `context.ts`, `types.ts`, `lists.ts` and the rest — that your app imports through `getContext`, alongside the Contract module and its emitted `contract.json`. The host build (`next build`) is responsible for compiling this bundle and **file-tracing** it into the serverless output. Two things make that work, and the first is automatic.

**1. The bundle is loadable by your bundler out of the box.** The generator emits relative imports with explicit `.ts` extensions, so the bundle resolves identically under `tsx`, `vitest`, a plain Node process, and a bundler — without you adding a `resolve.extensionAlias`. This is the default output; there is no generator flag (see [ADR-0008](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0008-generated-bundle-is-bundler-loadable.md)).

The one consumer requirement is a single tsconfig line: because the bundle's relative imports carry `.ts` extensions, the project that type-checks it must set **`allowImportingTsExtensions: true`** in its `compilerOptions`. This is compatible with Next's `noEmit` (TypeScript only allows the flag when it isn't emitting, which Next apps already satisfy), so `next build`'s type-check step accepts the `.ts` specifiers instead of failing with [TS5097](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0008-generated-bundle-is-bundler-loadable.md) (`An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled`):

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "noEmit": true, // already set in Next apps
    "moduleResolution": "bundler", // (or node16 / nodenext)
    "allowImportingTsExtensions": true, // <-- required to type-check the .opensaas bundle
  },
}
```

Projects scaffolded with `create-opensaas-app` already have this flag set, so newly-created apps build without any extra step.

**2. Import the bundle statically.** Reach the bundle through a normal static import so `next build` compiles and traces it:

```typescript
// Supported: a static import the host build can compile + file-trace
import { getContext } from '@/.opensaas/context'
```

Do **not** push the bundle out of the compile graph with a `webpackIgnore`d dynamic `import()`. A bundler does not follow an ignored dynamic import, so the bundle's files never get traced and go missing from the serverless output (you'll see a runtime "Cannot find module" on Vercel even though local dev works):

```typescript
// Avoid: the tracer can't follow this, so the bundle is dropped from the build
const { getContext } = await import(/* webpackIgnore: true */ './.opensaas/context')
```

> **Scope.** The stack only owns "emit a bundler-loadable context entry." What your own `opensaas.config.ts` pulls in is your app's architecture — if it lazily `import()`s workflow modules that reach heavy deps (e.g. `xero-node`, `twilio`), trace or externalize those yourself the same way.

### Database Connection Pooling

Serverless functions (like Vercel) create many database connections. Use connection pooling to avoid exhausting your database limits.

**Neon provides built-in pooling:**

- Use the pooled connection string for `DATABASE_URL` (the app's driver adapter)
- Use the direct connection string for `DIRECT_DATABASE_URL` (migrations)
- No additional configuration needed

**Alternative: Prisma Accelerate**

- [Prisma Accelerate](https://www.prisma.io/accelerate) provides connection pooling
- Good for multi-region deployments

### Environment Variables Management

**Never commit secrets to Git:**

- Add `.env*.local` to `.gitignore` (already done)
- Use Vercel's environment variable UI
- For team projects, use 1Password, AWS Secrets Manager, or similar

**Environment-specific variables:**

- Development: `.env` / `.env.local` (SQLite `DATABASE_URL`)
- Production: Vercel Dashboard or `vercel env` (`DATABASE_URL` + `DIRECT_DATABASE_URL`)
- Preview: Can inherit from Production or set separately

### Database Backups

**Neon provides automatic backups:**

- Point-in-time recovery (PITR) available on paid plans
- Free tier: Daily snapshots retained for 7 days

**Manual backups:**

```bash
# Export database to SQL file (use the direct connection)
pg_dump "postgresql://...@ep-xxx.region.aws.neon.tech/dbname?sslmode=require" > backup.sql

# Restore from backup
psql "postgresql://...@ep-xxx.region.aws.neon.tech/dbname?sslmode=require" < backup.sql
```

### Monitoring & Logging

**Vercel provides:**

- Real-time function logs
- Web Analytics (free)
- Speed Insights

**Database monitoring:**

- Neon Console shows connection count, storage, CPU usage
- Set up alerts for connection limits

**Application monitoring:**

- Consider [Sentry](https://sentry.io) for error tracking
- [LogRocket](https://logrocket.com) for session replay
- [Axiom](https://axiom.co) for structured logging

### Security Checklist

Before going live:

- [ ] All secrets are in environment variables (not hardcoded)
- [ ] `BETTER_AUTH_SECRET` is cryptographically random
- [ ] Database connection uses SSL (`sslmode=require`)
- [ ] `DATABASE_URL` is the pooled URL; `DIRECT_DATABASE_URL` is the direct URL
- [ ] Access control rules are tested and working
- [ ] CORS is configured if using external APIs
- [ ] Rate limiting is configured (consider Vercel's built-in protection)
- [ ] Better Auth session duration is appropriate for your app
- [ ] OAuth redirect URLs are whitelisted in provider settings

## Troubleshooting

### "Can't reach database server"

**Symptoms:** Prisma can't connect to Neon database

**Solutions:**

- Verify `DATABASE_URL` is correct (copy from Neon Console)
- Check `sslmode=require` is in the connection string
- Ensure the Neon project is not paused (happens on free tier after inactivity)
- Test the migration connection: `npx prisma db pull` (uses `DIRECT_DATABASE_URL` via `prisma.config.ts`)

### "Too many connections"

**Symptoms:** Database refuses new connections

**Solutions:**

- Use the **pooled** connection string for `DATABASE_URL` (the host usually contains `-pooler`)
- Add `connection_limit=10` to the connection string:
  ```
  postgresql://...?sslmode=require&connection_limit=10
  ```
- Upgrade your Neon plan for more connections
- Use Prisma Accelerate for connection pooling

### "Migration failed"

**Symptoms:** `prisma db migrate` errors

**Solutions:**

- Ensure `DIRECT_DATABASE_URL` is set to the **direct** (non-pooled) connection — migrations must not run over the pooler
- Check that the migration packages under `migrations/` at your project root are committed and correct — the refs and every extension contract space, not only the app space
- There is no failed-migration state to clear by hand, and no `migrate resolve` to run: an apply runs in one transaction, so a failed `prisma db migrate` leaves the database where it started. Fix the cause, re-plan with `pnpm migrate` if the packages themselves need to change, commit, and run `pnpm migrate:deploy` again
- If the error names an extension contract space and SQL state `58P01`, the extension is not available on the server — see [The Database escape](#the-database-escape) for provisioning and the privilege the migrating role needs
- For destructive changes, back up data first

### "Authentication not working"

**Symptoms:** Better Auth login fails in production

**Solutions:**

- Verify `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` match your production domain
- Check `BETTER_AUTH_SECRET` is set in Vercel
- Ensure OAuth redirect URLs are updated in provider settings:
  - GitHub: `https://your-app.vercel.app/api/auth/callback/github`
  - Google: `https://your-app.vercel.app/api/auth/callback/google`
- Check the browser console for CORS errors

### "Build failed"

**Symptoms:** Vercel deployment fails during build

**Solutions:**

- Check the Vercel build logs for the specific error
- Ensure `pnpm generate` runs successfully locally
- If the build runs `prisma db migrate`, confirm `DIRECT_DATABASE_URL` is set in Vercel
- Verify all dependencies are in `package.json` (not just devDependencies)
- Check the Node.js version matches Vercel (use `.nvmrc` or `package.json` engines field)

### "Function execution timeout"

**Symptoms:** 504 errors on some requests

**Solutions:**

- Optimize slow database queries (add indexes)
- Use `Promise.all()` for parallel operations
- Consider background jobs for long-running tasks
- Upgrade your Vercel plan for a longer timeout (Pro: 60s, Hobby: 10s)

### Getting Help

If you're stuck:

1. Check [Stack GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
2. Search [Vercel Docs](https://vercel.com/docs)
3. Check [Neon Docs](https://neon.tech/docs)

## Advanced Topics

### Custom Domains

1. **Add Domain in Vercel**
   - Go to Project Settings → Domains
   - Add your custom domain (e.g., `app.example.com`)
   - Follow the DNS configuration instructions

2. **Update Better Auth URL**
   - Update the `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` environment variables
   - Update OAuth redirect URLs in provider settings

### Multi-Environment Setup

For staging + production:

```bash
# Create a staging database in Neon
# Add its pooled + direct URLs to Vercel as staging environment variables

# Deploy to staging branch
git push origin staging
# Vercel auto-deploys to staging-your-app.vercel.app

# Promote to production
git checkout main
git merge staging
git push origin main
```

### Using Different Database Providers

While this guide focuses on Neon, Stack works with any PostgreSQL provider. The pattern is the same: set `provider: 'postgresql'`, build a `PrismaPg` (or provider-specific) adapter in `prismaClientConstructor` with the pooled `DATABASE_URL`, and point `DIRECT_DATABASE_URL` at the direct connection.

**Supabase:**

- Get connection strings from Project Settings → Database
- Use the pooler connection string for `DATABASE_URL` and the direct one for `DIRECT_DATABASE_URL`

**Railway:**

- Provision a PostgreSQL plugin
- Copy the connection string from the Variables tab
- Use the same pooled/direct split as Neon

**Render:**

- Create a PostgreSQL database
- Use the external connection string for `DIRECT_DATABASE_URL` (migrations) and a pooled connection for `DATABASE_URL` (app)

### Docker Deployment (Self-Hosting)

For deploying to your own infrastructure, use the `@prisma/adapter-pg` adapter (Option A above) pointed at your Postgres instance, and run `pnpm migrate:deploy` as part of your release process.

## Next Steps

Now that your app is deployed:

- [Configure a custom domain](https://vercel.com/docs/custom-domains)
- [Add team members](https://vercel.com/docs/teams-and-accounts)
- Review the [Authentication guide](/docs/how-to/authentication) for production auth details
- Revisit [Access Control](/docs/concepts/access-control) to harden your rules

## Summary

You've successfully deployed your Stack application! Here's what you accomplished:

- Created a production PostgreSQL database on Neon
- Switched your config to the PostgreSQL driver adapter (pooled `DATABASE_URL`)
- Configured the pooled-app / direct-CLI environment variable split
- Deployed to Vercel with automatic deployments
- Applied versioned migrations with `prisma db migrate`
- Verified your deployment and access control are working

Your app is now live and ready for users. Any pushes to your main branch will automatically deploy to production.
