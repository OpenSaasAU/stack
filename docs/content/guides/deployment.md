# Deployment Guide

This guide walks you through deploying your OpenSaas Stack application to production using Vercel and Neon PostgreSQL.

Locally you develop on SQLite with `prisma db push` for a zero-setup loop. Production runs on **PostgreSQL** with versioned **`prisma migrate`** migrations — these are deliberately two different workflows (see [ADR-0003](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0003-deployment-uses-postgres-and-prisma-migrate.md)). This guide covers the one-time switch and the production loop.

## Prerequisites

Before deploying, make sure you have:

- A [Vercel account](https://vercel.com/signup) (free tier works)
- A [Neon account](https://neon.tech) (free tier includes 10GB storage)
- Your OpenSaas Stack application working locally
- Git repository (GitHub, GitLab, or Bitbucket)

## Overview

The deployment process involves:

1. Setting up a production database (Neon PostgreSQL)
2. Switching your config from SQLite to PostgreSQL (provider + driver adapter)
3. Configuring environment variables (pooled app URL + direct migration URL)
4. Deploying to Vercel
5. Applying database migrations
6. Verifying your deployment

**Total time:** ~10-15 minutes for first deployment

## How database connections flow

OpenSaas Stack uses Prisma 7, which requires a **driver adapter** at runtime. There are two distinct places a database URL is consumed, and on serverless Postgres they intentionally point at different connection strings:

- **The running app** connects through a driver adapter built in your `prismaClientConstructor` (in `opensaas.config.ts`). On serverless platforms like Vercel this must use the **pooled** `DATABASE_URL` to avoid exhausting connection limits.
- **The Prisma CLI** (migrations, `db push`, Studio) reads the datasource from the generated `prisma.config.ts`. That file prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so migrations run over a **direct** (non-pooled) connection.

This is the **pooled-app / direct-CLI split**: set `DATABASE_URL` to Neon's pooled URL (used by the app) and `DIRECT_DATABASE_URL` to Neon's direct URL (used by migrations). Locally on SQLite you set neither extra var — the CLI's `DIRECT_DATABASE_URL ?? DATABASE_URL` fallback resolves to `DATABASE_URL` and nothing changes.

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
- `DIRECT_DATABASE_URL` (direct): the connection the **Prisma CLI** uses for `migrate dev` / `migrate deploy`. Migrations need a direct, non-pooled connection. The generated `prisma.config.ts` reads it as `DIRECT_DATABASE_URL ?? DATABASE_URL`.

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

Before your first deploy, create the initial migration locally against the production database (or a disposable Postgres) using the **direct** connection.

```bash
# Ensure DATABASE_URL + DIRECT_DATABASE_URL are set (e.g. via .env.production.local)
pnpm generate
pnpm migrate -- --name init
```

`pnpm migrate` runs `prisma migrate dev`, which creates a versioned migration in `prisma/migrations/` and applies it. Commit the generated migration files to Git — they are your schema history, and the production release step replays them with `prisma migrate deploy`.

> **Local dev vs production.** `prisma db push` (`pnpm db:push`) stays the fast, disposable loop for local SQLite. It has **no migration history** and can drop data on schema changes, so it is **not** a supported path to production. Production always uses `prisma migrate`.

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

Run your committed migrations against the production database. Because `prisma.config.ts` resolves `DIRECT_DATABASE_URL ?? DATABASE_URL`, `prisma migrate deploy` automatically uses the **direct** connection.

```bash
pnpm migrate:deploy
```

`pnpm migrate:deploy` runs `prisma migrate deploy`, applying every committed migration in order without prompting. It never generates new migrations, so it's safe to run repeatedly and in CI.

### Running migrations as part of the build (recommended)

To apply migrations automatically on every Vercel deploy, add `prisma migrate deploy` to the build command. The starter templates' `build` script is `pnpm generate && next build`; extend it to:

```json
{
  "scripts": {
    "build": "pnpm generate && prisma migrate deploy && next build"
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
# Make changes locally (SQLite + db push for the fast loop)
pnpm dev

# Generate updated schema if config changed
pnpm generate

# When you change the schema, author a migration to ship
pnpm migrate -- --name describe_your_change

# Commit and push (including the new migration files)
git add .
git commit -m "Add new feature"
git push

# Vercel deploys; the build step runs `prisma migrate deploy`
# (if you added it to the build command) using DIRECT_DATABASE_URL
```

### Database Migrations in CI/CD

For schema changes, migrations are applied via `prisma migrate deploy` — either in the Vercel build command (see [Step 6](#running-migrations-as-part-of-the-build-recommended)) or as an explicit step before deploy:

```bash
# In CI, against the production DB (DIRECT_DATABASE_URL set)
pnpm migrate:deploy
```

`migrate deploy` only applies existing committed migrations; it never edits your schema, which makes it safe to run in an automated pipeline.

## Production Considerations

### Bundling the Generated `.opensaas` bundle

`opensaas generate` emits a **Generated bundle** under `.opensaas/` — `context.ts`, `types.ts`, `prisma-extensions.ts`, `lists.ts`, and the `prisma-client/**` tree — that your app imports through `getContext`. The host build (`next build`) is responsible for compiling this bundle and **file-tracing** it into the serverless output. Two things make that work, and the first is automatic.

**1. The bundle is loadable by your bundler out of the box.** The generator emits relative imports with explicit `.ts` extensions (e.g. `import { PrismaClient } from './prisma-client/client.ts'`), so the bundle resolves identically under `tsx`, `vitest`, a plain Node process, and a bundler — without you adding a `resolve.extensionAlias`. This is the default output; there is no generator flag (see [ADR-0008](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0008-generated-bundle-is-bundler-loadable.md)).

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

**2. Import the bundle statically.** Reach the bundle through a normal static import so `next build` compiles it and traces its `prisma-client/**` subtree into the function bundle:

```typescript
// Supported: a static import the host build can compile + file-trace
import { getContext } from '@/.opensaas/context'
```

Do **not** push the bundle out of the compile graph with a `webpackIgnore`d dynamic `import()`. A bundler does not follow an ignored dynamic import, so the `prisma-client/**` files never get traced and go missing from the serverless output (you'll see a runtime "Cannot find module './prisma-client/...'" on Vercel even though local dev works):

```typescript
// Avoid: the tracer can't follow this, so prisma-client/** is dropped from the build
const { getContext } = await import(/* webpackIgnore: true */ './.opensaas/context')
```

**Tracing note (Next.js / Vercel).** Static imports are traced automatically. If your serverless functions reach the bundle indirectly (for example through a generated route or a helper the tracer can't statically see), pin the subtree explicitly in `next.config.js` so the `prisma-client/**` files ship with every function:

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingIncludes: {
    // Apply to every route ('/**'), or scope to the routes that use the context
    '/**': ['./.opensaas/prisma-client/**/*'],
  },
}
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

**Symptoms:** `prisma migrate deploy` errors

**Solutions:**

- Ensure `DIRECT_DATABASE_URL` is set to the **direct** (non-pooled) connection — migrations must not run over the pooler
- Check migration files in `prisma/migrations/` are committed and correct
- Run `npx prisma migrate resolve` to mark a failed migration
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
- If the build runs `prisma migrate deploy`, confirm `DIRECT_DATABASE_URL` is set in Vercel
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

1. Check [OpenSaas Stack GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
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

While this guide focuses on Neon, OpenSaas Stack works with any PostgreSQL provider. The pattern is the same: set `provider: 'postgresql'`, build a `PrismaPg` (or provider-specific) adapter in `prismaClientConstructor` with the pooled `DATABASE_URL`, and point `DIRECT_DATABASE_URL` at the direct connection.

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
- Review the [Authentication guide](/docs/guides/authentication) for production auth details
- Revisit [Access Control](/docs/core-concepts/access-control) to harden your rules

## Summary

You've successfully deployed your OpenSaas Stack application! Here's what you accomplished:

- Created a production PostgreSQL database on Neon
- Switched your config to the PostgreSQL driver adapter (pooled `DATABASE_URL`)
- Configured the pooled-app / direct-CLI environment variable split
- Deployed to Vercel with automatic deployments
- Applied versioned migrations with `prisma migrate deploy`
- Verified your deployment and access control are working

Your app is now live and ready for users. Any pushes to your main branch will automatically deploy to production.
