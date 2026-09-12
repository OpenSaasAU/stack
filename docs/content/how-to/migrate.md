# Migration Guide

This guide covers how to migrate your existing Prisma, Next.js, or KeystoneJS projects to Stack using AI-powered tools.

{% callout type="info" %}
Migrating specifically from KeystoneJS? Start with the canonical [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) guide, then return here for the full step-by-step walkthrough. For the `context.graphql.run` replacement, see [Queries & projections](/docs/concepts/queries).
{% /callout %}

## Introduction

Stack provides an intelligent migration system that helps you transition existing projects with minimal manual work. The migration assistant:

- **Analyzes** your current schema and project structure
- **Guides** you through an interactive wizard
- **Generates** a working `opensaas.config.ts`
- **Integrates** with Claude Code for AI assistance
- **Validates** the generated configuration

The entire migration process typically takes 10-15 minutes with AI assistance, or 30-60 minutes manually.

## Quick Start (AI-Assisted Migration)

The fastest way to migrate is with AI assistance through Claude Code:

```bash
# Navigate to your project
cd my-existing-project

# Run the migration command with AI support
npx @opensaas/stack-cli migrate --with-ai
```

This command will:

1. Detect your project type (Prisma, KeystoneJS, or Next.js)
2. Analyze your schema and count models
3. Set up Claude Code integration with migration tools
4. Provide instructions for next steps

### What You'll See

```
🚀 Stack Migration

✔ Detected: prisma, nextjs
✔ Found 8 models
   ├─ User (6 fields)
   ├─ Post (10 fields)
   ├─ Comment (5 fields)
   ├─ Tag (3 fields)
   ├─ Category (4 fields)
   ├─ Media (7 fields)
   ├─ Setting (4 fields)
   └─ Session (5 fields)
✔ Claude Code ready
   ├─ Created .claude directory
   ├─ Added opensaas-stack-marketplace
   ├─ Enabled opensaas-migration plugin (with MCP server)
   └─ Wrote .claude/settings.json and .claude/opensaas-project.json

✅ Analysis complete!

🤖 Next Steps:

   1. Open this project in Claude Code
   2. Ask: "Help me migrate to Stack"
   3. Follow the interactive wizard

📚 Documentation: https://stack.opensaas.au/docs/how-to/migrate-from-keystone
```

### Using Claude Code

After running the migration command, open your project in Claude Code:

1. **Start the conversation:**

   ```
   Help me migrate to Stack
   ```

2. **Answer the wizard questions:**
   - Whether to preserve your existing database
   - Authentication requirements
   - Access control patterns
   - Admin UI preferences

3. **Review and apply:**
   - Claude will generate `opensaas.config.ts`
   - Install suggested dependencies
   - Run the generator
   - Validate the migration

## Manual Migration

If you prefer manual migration or don't use Claude Code:

### 1. Analyze Your Project

```bash
npx @opensaas/stack-cli migrate
```

This gives you a summary of your project without setting up AI tools.

### 2. Install Dependencies

```bash
pnpm add @opensaas/stack-core @opensaas/stack-cli
pnpm add -D prisma typescript tsx
```

Add authentication if needed:

```bash
pnpm add @opensaas/stack-auth better-auth
```

{% callout type="info" %}
**Already running better-auth?** If your project has live better-auth tables
(typically `AuthUser`/`AuthSession`/`AuthAccount`/`AuthVerification` in a separate
`auth` schema, with an app `User` that is a distinct model), don't recreate them.
Adopt the existing tables with the `adoptBetterAuthTables()` recipe so the
generated Auth lists diff clean against your live database — no destructive auth
migration — and keep your domain `User` separate from the auth identity. See
[Adopting an Existing better-auth Installation](/docs/how-to/authentication#adopting-an-existing-better-auth-installation).
{% /callout %}

### 3. Create Configuration

Create `opensaas.config.ts` in your project root. Use your existing Prisma schema as reference.

#### Example: Basic Migration

If you have this Prisma schema:

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model User {
  id    String @id @default(cuid())
  email String @unique
  name  String?
  posts Post[]
}
```

Convert it to OpenSaaS config. Post's `query` rule returns a **filter** rather than a boolean, which scopes the read: an anonymous visitor sees published posts, a signed-in author additionally sees their own drafts. Note the guard is on `session?.userId`, not on `session` — a filter value of `undefined` is refused as a validation error rather than quietly dropped, so a rule must never build one.

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text, checkbox, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    User: list({
      fields: {
        email: text({ validation: { isRequired: true } }),
        name: text(),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item?.id,
          delete: ({ session, item }) => session?.userId === item?.id,
        },
      },
    }),
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) =>
            session?.userId
              ? { OR: [{ published: { equals: true } }, { authorId: { equals: session.userId } }] }
              : { published: { equals: true } },
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item?.authorId,
          delete: ({ session, item }) => session?.userId === item?.authorId,
        },
      },
    }),
  },
})
```

The `db` block carries no connection string and no client constructor. The connection is resolved from the environment at runtime — `DIRECT_DATABASE_URL`, then `DATABASE_URL`, then the local Dev database — so pointing the new config at your existing database is a matter of setting `DATABASE_URL`, not of editing the config. Postgres is the only provider. See [Config API](/docs/reference/config-api) for the rest of the `db` keys.

### 4. Generate and reconcile

`opensaas dev` is the whole local loop: it starts a Dev database, runs `generate`, reconciles the schema, and spawns your app. Point `DATABASE_URL` at your existing database first if you are migrating live data — with the variable set, no Dev database is started and the loop reconciles against yours.

```bash
pnpm opensaas dev
```

Editing `opensaas.config.ts` while the loop is running regenerates and reconciles again. A **non-destructive** change applies on its own. A **destructive** one — a dropped column, a narrowed type — stops: the loop leaves both the generated bundle and the database at the previous schema, prints the plan, and keeps serving. Apply it deliberately from a second terminal:

```bash
pnpm db:update --confirm postgres
```

The consent token is the database name; the Dev database's is `postgres`.

#### `pnpm db:update` needs the loop

`pnpm db:update` opens no connection of its own — it hands the request to the running `opensaas dev` loop, which owns the Dev database's data directory and the staged generation. With no loop listening it exits non-zero with a message saying so, rather than reaching the database a second way. And because a client cached inside the running app would go on querying a column that no longer exists, **a destructive mid-session change restarts the app** once the update is applied. Expect the app process to come back, and expect in-flight local state to be lost with it.

Production is a different command: deploys run `prisma db migrate` from the committed `migrations/` directory. There is no `opensaas db migrate` — `opensaas db` carries only `update`, and `opensaas migrate` is the project-analysis assistant this page is about, not a schema command.

### 5. Update Application Code

Replace direct Prisma calls with context. A read is composed on `context.db.<List>` — the list's own PascalCase key, not a camelCase one — and ends in a terminal that resolves access:

**Before:**

```typescript
import { prisma } from './lib/prisma'

const posts = await prisma.post.findMany({
  where: { published: true },
})
```

**After:**

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext({ userId: session.userId })
const posts = await context.db.Post.where({ published: { equals: true } }).all()
```

There is no `findMany`, `findUnique`, `findFirst` or `count()`. The terminals are `all()`, `first()`, `aggregate()` and `nearest()`; `where` and `orderBy` accumulate across calls, while `select`, `limit`, `offset` and `cursor` replace. A denied read is silent — `all()` gives `[]`, `first()` gives `null`, `aggregate()` zeroes every key — so every `first()` result is a null check.

## Supported Project Types

### Prisma Projects

**Detection:** Looks for `prisma/schema.prisma`

**What's Migrated:**

- All models → Lists
- Fields → Field types
- Relations → Relationship fields
- Enums → Select fields
- Database provider → DB config

**Example:**

```bash
npx @opensaas/stack-cli migrate --type prisma
```

### KeystoneJS Projects

**Detection:** Looks for `keystone.config.ts` or `keystone.ts`

**What's Migrated:**

- Lists → Lists
- Field types → OpenSaaS field types
- Access control → Access control patterns
- Hooks → Hooks
- Authentication → Auth plugin
- `context.graphql.run` queries → composed `context.db` reads (see [Migrating context.graphql.run](#migrating-contextgraphqlrun) below)

**Example:**

```bash
npx @opensaas/stack-cli migrate --type keystone
```

### Next.js Projects

**Detection:** Looks for `next` in `package.json`

**What's Migrated:**

- Existing Prisma models (if present)
- API routes → Server actions (manual)
- Authentication patterns → Auth plugin

**Example:**

```bash
npx @opensaas/stack-cli migrate --type nextjs
```

## Migration Wizard Questions

When using AI assistance, the wizard asks these questions:

### 1. Database Configuration

**Question:** "Do you want to preserve your existing database?"

- **Yes** → Uses your existing `DATABASE_URL`, preserves data
- **No** → Leaves the variable unset, so `opensaas dev` starts a local Dev database

There is no provider question. Postgres is the only provider, so a migration from a MySQL or SQLite source is also a database port: move the data across first, then point `DATABASE_URL` at the Postgres instance.

### 2. Authentication

**Question:** "Do you need authentication?"

- **Yes** → Adds auth plugin, User/Session lists
- **No** → No auth, anonymous access patterns

**Question:** "Which auth providers?" (if yes above)

Options:

- Email/Password
- GitHub OAuth
- Google OAuth
- Discord OAuth
- Twitter OAuth

### 3. Access Control

**Question:** "What default access control pattern?"

Options:

- **Public read, authenticated write** - Most common for blogs, content sites

  ```typescript
  access: {
    operation: {
      query: () => true,
      create: ({ session }) => !!session,
      update: ({ session }) => !!session,
      delete: ({ session }) => !!session,
    }
  }
  ```

- **Private (owner-only)** - For user-specific data. `query` returns a filter, so users only ever see their own records; the guard is on `session?.userId` because a filter value of `undefined` is refused, not ignored.

  ```typescript
  access: {
    operation: {
      query: ({ session }) =>
        session?.userId ? { userId: { equals: session.userId } } : false,
      create: ({ session }) => !!session,
      update: ({ session, item }) => session?.userId === item?.userId,
      delete: ({ session, item }) => session?.userId === item?.userId,
    }
  }
  ```

- **Admin only** - For protected resources

  ```typescript
  access: {
    operation: {
      query: ({ session }) => session?.role === 'admin',
      create: ({ session }) => session?.role === 'admin',
      update: ({ session }) => session?.role === 'admin',
      delete: ({ session }) => session?.role === 'admin',
    }
  }
  ```

- **Public** - For truly public data
  ```typescript
  access: {
    operation: {
      query: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    }
  }
  ```

### 4. Admin UI

**Question:** "Where should the admin UI be mounted?"

Common options:

- `/admin` (default)
- `/dashboard`
- `/manage`
- Custom path

## Field Type Mapping

The migration system automatically maps field types:

### Prisma → OpenSaaS

| Prisma Type | OpenSaaS Field   | Import                        |
| ----------- | ---------------- | ----------------------------- |
| `String`    | `text()`         | `@opensaas/stack-core/fields` |
| `Int`       | `integer()`      | `@opensaas/stack-core/fields` |
| `Boolean`   | `checkbox()`     | `@opensaas/stack-core/fields` |
| `DateTime`  | `timestamp()`    | `@opensaas/stack-core/fields` |
| `Enum`      | `select()`       | `@opensaas/stack-core/fields` |
| Relations   | `relationship()` | `@opensaas/stack-core/fields` |

### KeystoneJS → OpenSaaS

Keystone field builders map onto same-named OpenSaaS builders (`text()` → `text()`, `select()` → `select()`, and so on). For the **complete** mapping — including `float()` / `decimal()`, `image()` / `file()`, `document()`, and the `relationship()` `ref`-format differences — see the field-type table in the canonical [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone#2-field-type-mapping) guide.

## Claude Code Integration

### MCP Tools Available

The migration system provides these MCP tools to Claude:

#### Schema Analysis

- **`opensaas_introspect_prisma`** - Detailed Prisma schema analysis
- **`opensaas_introspect_keystone`** - KeystoneJS config analysis

#### Migration Wizard

- **`opensaas_start_migration`** - Begin interactive migration
- **`opensaas_answer_migration`** - Answer wizard questions

#### Documentation

- **`opensaas_search_migration_docs`** - Search migration docs
- **`opensaas_get_example`** - Get code examples for common patterns

### Available Slash Commands

After running `migrate --with-ai`, you get these commands:

- **`/analyze-schema`** - Detailed schema breakdown
- **`/generate-config`** - Generate the config file
- **`/validate-migration`** - Validate configuration

### Migration Assistant Agent

The opensaas-migration plugin ships a specialized agent (`migration-assistant`) that:

- Understands your project context
- Guides you through the wizard
- Explains technical concepts simply
- Validates your choices
- Generates working code
- Provides next steps

## Common Migration Scenarios

### Blog with Authentication

**Original Prisma:**

```prisma
model User {
  id       String   @id @default(cuid())
  email    String   @unique
  password String
  name     String
  posts    Post[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String
  published Boolean  @default(false)
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
}
```

**Generated Config:**

Post's `query` rule returns `true` for a signed-in visitor and a filter for an anonymous one, so anonymous visitors see published posts and nothing else:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, checkbox, relationship } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: ({ session }) => (session ? true : { published: { equals: true } }),
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item?.authorId,
          delete: ({ session, item }) => session?.userId === item?.authorId,
        },
      },
    }),
  },
})
```

**Note:** User list is auto-generated by `authPlugin`.

### E-commerce Platform

**Key Considerations:**

- Product catalog (public read)
- Orders (owner-only access)
- Admin management (role-based)
- Inventory tracking

**Migration Steps:**

1. Identify public vs. private models
2. Set up role-based access (admin, customer)
3. Configure relationships (Order → Product)
4. Add hooks for inventory updates

**Access Control Pattern:** the product catalogue is publicly readable and admin-writable; `Order.query` returns `true` for an admin and an owner filter for everybody else. The filter names the relationship's foreign-key column, `customerId`, not the relationship field.

```typescript
Product: list({
  fields: {
    name: text({ validation: { isRequired: true } }),
    price: decimal(),
  },
  access: {
    operation: {
      query: () => true,
      create: ({ session }) => session?.role === 'admin',
      update: ({ session }) => session?.role === 'admin',
      delete: ({ session }) => session?.role === 'admin',
    },
  },
}),
Order: list({
  fields: {
    customer: relationship({ ref: 'User.orders' }),
  },
  access: {
    operation: {
      query: ({ session }) =>
        session?.role === 'admin'
          ? true
          : session?.userId
            ? { customerId: { equals: session.userId } }
            : false,
      create: ({ session }) => !!session,
      update: ({ session }) => session?.role === 'admin',
      delete: ({ session }) => session?.role === 'admin',
    },
  },
}),
```

### SaaS Application with Teams

**Key Considerations:**

- Multi-tenant data isolation
- Team-based access
- Role hierarchies (owner, admin, member)
- Shared resources

**Migration Steps:**

1. Add Team model if not present
2. Link resources to teams
3. Implement team-scoped access
4. Add role checks

**Access Control Pattern:** an access rule may run its own read on `context.db` to resolve membership. Both rules below return `false` rather than a filter when there is no membership — building `{ teamId: undefined }` would be refused as a validation error, and returning it would be a security bug in any case.

```typescript
Project: list({
  fields: {
    name: text(),
    team: relationship({ ref: 'Team.projects' }),
  },
  access: {
    operation: {
      query: async ({ session, context }) => {
        if (!session?.userId) return false
        const membership = await context.db.TeamMember.where({
          userId: { equals: session.userId },
        }).first()
        if (!membership) return false
        return { teamId: { equals: membership.teamId } }
      },
      create: ({ session }) => !!session,
      update: async ({ session, item, context }) => {
        if (!session?.userId) return false
        const membership = await context.db.TeamMember.where({
          userId: { equals: session.userId },
          teamId: { equals: item.teamId },
          role: { in: ['owner', 'admin'] },
        }).first()
        return !!membership
      },
    },
  },
}),
```

## Data Preservation

### Existing Database

To preserve your existing database:

1. **Keep the same DATABASE_URL:**

   ```env
   DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
   ```

2. **Reconcile through the dev loop, and read the plan before consenting:**

   ```bash
   pnpm opensaas dev
   ```

   With `DATABASE_URL` set, no Dev database starts and the loop reconciles against yours. A destructive plan stops and prints itself rather than applying — that printout is your review step, and nothing is dropped until you run `pnpm db:update --confirm <database-name>`.

3. **OpenSaaS generates schema compatible with existing data:**
   - Same table names (PascalCase models)
   - Same field names
   - Same relationships
   - Additional access control metadata (runtime only)

### Migration Safety

The migration system is **non-destructive**:

- ✅ Existing data is preserved
- ✅ Table structure remains the same
- ✅ Foreign keys maintained
- ✅ Indexes preserved
- ⚠️ No automatic backups (back up manually first!)

**Best Practice:**

```bash
# Backup before migration
pg_dump mydb > backup.sql

# Then migrate
npx @opensaas/stack-cli migrate --with-ai
```

## Troubleshooting

### Project Not Detected

**Error:**

```
No recognizable project found
```

**Solutions:**

- Ensure you're in the project root
- Check for `prisma/schema.prisma` (Prisma)
- Check for `keystone.config.ts` (Keystone)
- Check for `next` in package.json (Next.js)
- Use `--type` flag to force detection:
  ```bash
  npx @opensaas/stack-cli migrate --type prisma
  ```

### Schema Analysis Failed

**Error:**

```
Failed to analyze schema
```

**Solutions:**

- Verify Prisma schema syntax
- Ensure schema file is readable
- Check for TypeScript errors in Keystone config
- Run `npx prisma format` to fix formatting

### Claude Code Not Working

**Error:**

```
MCP server not responding
```

**Solutions:**

1. Check `.claude/settings.json` was created and enables the plugin:
   ```json
   {
     "extraKnownMarketplaces": {
       "opensaas-stack-marketplace": {
         "source": { "source": "github", "repo": "OpenSaasAU/stack" }
       }
     },
     "enabledPlugins": {
       "opensaas-migration@opensaas-stack-marketplace": true
     }
   }
   ```
2. Restart Claude Code
3. The MCP server (named `opensaas-stack`) is declared by the plugin's own manifest — no `mcpServers` entry is written to settings.json
4. Check for errors in Claude Code console

### Generated Config Errors

**Error:**

```
TypeScript errors in opensaas.config.ts
```

**Solutions:**

- Check imports are correct
- Verify field types are valid
- Ensure database config is complete
- Run `npx tsx opensaas.config.ts` to test
- Ask Claude to fix specific errors

### Database Connection Issues

**Error:**

```
Can't reach database server
```

**Solutions:**

- Check DATABASE_URL in `.env`
- Verify database is running
- Test connection with Prisma:
  ```bash
  npx prisma db pull
  ```
- Check firewall/network settings

## Next Steps After Migration

### 1. Verify Generated Files

```bash
# Should exist:
opensaas.config.ts          # Your config
.opensaas/context.ts        # Generated context factory
.opensaas/types.ts          # Generated types
.opensaas/lists.ts          # Generated list metadata
prisma/contract.ts          # Generated contract module (+ contract.json, contract.d.ts)
prisma.config.ts            # Prisma CLI config
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Run the dev loop

```bash
pnpm opensaas dev
```

One command generates, reconciles the schema and starts the app. Mid-session config edits regenerate and reconcile again; a destructive one waits for `pnpm db:update --confirm <database-name>`.

### 4. Update Application Code

Replace Prisma calls with context. `context.db` is keyed by the list's PascalCase name, and a read is composed rather than passed a single args object:

```typescript
// Before
const posts = await prisma.post.findMany()

// After
import { getContext } from '@/.opensaas/context'
const context = await getContext({ userId: session.userId })
const posts = await context.db.Post.all()
```

### 5. Add Admin UI

The admin surface takes the generated `getContext()` result and the generated `config`, plus a server action you own — there is no separate admin-context helper.

```tsx
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import type { ServerActionInput } from '@opensaas/stack-ui/server'
import { getContext, config } from '@/.opensaas/context'

async function serverAction(props: ServerActionInput) {
  'use server'
  const context = await getContext()
  return await context.serverAction(props)
}

interface AdminPageProps {
  params: Promise<{ admin?: string[] }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AdminPage({ params, searchParams }: AdminPageProps) {
  const resolvedParams = await params
  return (
    <AdminUI
      context={await getContext()}
      config={await config}
      params={resolvedParams.admin}
      searchParams={await searchParams}
      basePath="/admin"
      serverAction={serverAction}
    />
  )
}
```

### 6. Test Access Control

A denied read is silent, so verify by comparing what two sessions see rather than by expecting a throw:

```typescript
const anonContext = await getContext()
const publicPosts = await anonContext.db.Post.all()

const authContext = await getContext({ userId: 'user-123' })
const myPosts = await authContext.db.Post.all()
```

The anonymous read should come back with published posts only; the authenticated one should additionally carry that user's drafts. A single record is checked the same way — `first()` answers `null` for both "no such row" and "not yours", which is deliberate: the two are indistinguishable to a caller.

### 7. Update API Routes

Convert to server actions:

```typescript
// Before (API route)
// app/api/posts/route.ts
export async function GET() {
  const posts = await prisma.post.findMany()
  return Response.json(posts)
}

// After (Server action)
// app/actions/posts.ts
;('use server')
import { getContext } from '@/.opensaas/context'
import { getSession } from '@/lib/auth'

export async function getPosts() {
  const session = await getSession()
  const context = session ? await getContext(session) : await getContext()
  return await context.db.Post.where({ published: { equals: true } }).all()
}
```

## Migrating context.graphql.run

If you're migrating from KeystoneJS, your project likely uses `context.graphql.run()` or `context.graphql.raw()` for type-safe database access. Stack has no GraphQL layer — a read is composed on `context.db.<List>` and narrowed with `.select()`, which the engine honours exactly. There is no fragment to declare and no codegen step: the generated types give each list's surface its own shape.

{% callout type="info" %}
The full set of `context.graphql.run` → `context.db.*` recipes — including the harder cases (relation-filter `where`-shape translation, Keystone's `connect` / `disconnect` / `set` nested writes, and gql.tada typed documents) — lives in the canonical [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) guide and the [Queries & projections](/docs/concepts/queries) reference. This section is a short summary that points there rather than duplicating them.
{% /callout %}

### Quick reference

| Keystone                                             | Stack                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| GraphQL fragment string                              | `.select('id', 'title')` on the read itself                           |
| `ResultOf<typeof query>` (codegen)                   | inferred from the generated list types — no codegen step              |
| `context.graphql.run({ query, variables })` — list   | `context.db.Post.where(...).select(...).all()`                        |
| `context.graphql.run({ query, variables })` — single | `context.db.Post.where({ id: { equals: id } }).select(...).first()`   |
| Nested relationship filtering                        | `.include('comments', (comments) => comments.where(...).select(...))` |

### Simple list query

```typescript
// Before (Keystone)
const { posts } = await context.graphql.run({
  query: `query { posts(where: { published: true }) { id title } }`,
})

// After (Stack)
const posts = await context.db.Post.where({ published: { equals: true } })
  .select('title')
  .all()

// Single record
const post = await context.db.Post.where({ id: { equals: postId } })
  .select('title')
  .first()
if (!post) return notFound()
```

`.select()` replaces any previous call rather than accumulating, and the result matches it exactly — the engine widens the query for what a computed field declared and strips the difference back out.

### Nested / related data

A relation is reached with `.include()`, whose refinement is a read of the related list — it takes its own `where`, `orderBy`, `limit`, `offset` and `.select()`:

```typescript
const posts = await context.db.Post.where({ published: { equals: true } })
  .orderBy({ publishedAt: 'desc' })
  .select('title', 'publishedAt')
  .include('author', (author) => author.select('name', 'email'))
  .include('comments', (comments) =>
    comments
      .where({ approved: { equals: true } })
      .orderBy({ createdAt: 'desc' })
      .limit(5)
      .select('body'),
  )
  .all()
```

Arity decides nullability, not the foreign key's: a to-one include lands as `Row | null` and a to-many as `Row[]`, so `post.author?.name` stays a null-check even where the column is `NOT NULL`. The full statement, including why, is at [Cost: every to-one read off an included row is a null-check](/docs/reference/context-api#cost-every-to-one-read-off-an-included-row-is-a-null-check).

Composability comes from the query value itself: it is immutable, so a partially composed read can be shared and narrowed at each call site.

```typescript
const publishedPosts = context.db.Post.where({ published: { equals: true } })

const recent = await publishedPosts.orderBy({ publishedAt: 'desc' }).limit(10).all()
const titles = await publishedPosts.select('title').all()
```

Every operation runs through the secured terminals, so access control is enforced automatically and a denied read comes back as `[]` or `null` rather than throwing. For the dedicated reference see [Queries & projections](/docs/concepts/queries); for the complete Keystone-specific recipes, see the canonical [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone) guide.

## Best Practices

### Start Small

- Migrate one model at a time
- Test access control for each list
- Add complexity gradually

### Use Version Control

```bash
# Create migration branch
git checkout -b migrate-to-opensaas

# Commit frequently
git add opensaas.config.ts
git commit -m "Add initial OpenSaaS config"
```

### Test Thoroughly

- Test anonymous access
- Test authenticated access
- Test different roles
- Test edge cases (null values, empty lists)

### Name your access rules

A filter-returning rule inlined into `access.operation` is the hardest part of a migrated config to read six months later. Lift it into a named function instead — the name carries the policy, and the same rule can then be reused and unit-tested on its own:

```typescript
import { config, list } from '@opensaas/stack-core'
import type { Session } from '@opensaas/stack-core'
import { checkbox, relationship, text } from '@opensaas/stack-core/fields'

const publishedOrOwnDrafts = ({ session }: { session: Session | null }) =>
  session?.userId
    ? { OR: [{ published: { equals: true } }, { authorId: { equals: session.userId } }] }
    : { published: { equals: true } }

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        published: checkbox({ defaultValue: false }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: { operation: { query: publishedOrOwnDrafts } },
    }),
    User: list({
      fields: { posts: relationship({ ref: 'Post.author', many: true }) },
    }),
  },
})
```

### Plan for Rollback

Keep your old code:

```bash
# Tag before migration
git tag pre-opensaas-migration

# Easy rollback if needed
git reset --hard pre-opensaas-migration
```

## Getting Help

### Documentation

- [Stack Docs](https://stack.opensaas.au/)
- [Access Control Guide](https://stack.opensaas.au/docs/concepts/access-control)
- [Field Types Reference](https://stack.opensaas.au/docs/concepts/field-types)
- [Authentication Guide](https://stack.opensaas.au/docs/how-to/authentication)

### Community

- [GitHub Issues](https://github.com/OpenSaasAU/stack/issues)
- [GitHub Discussions](https://github.com/OpenSaasAU/stack/discussions)

### AI Assistance

Use Claude Code for help:

- "Explain this access control pattern"
- "How do I migrate this Prisma relation?"
- "What's the OpenSaaS equivalent of this Keystone field?"
- "Debug this configuration error"

## Advanced Topics

### Custom Field Types

If you have custom Prisma types, create custom fields:

```typescript
// lib/fields/slug.ts
import { z } from 'zod'
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
} from '@opensaas/stack-core/extend'

export type SlugField = BaseFieldConfig<TypeInfo> & {
  type: 'slug'
  from?: string
}

export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,
    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: false,
    }),
    getZodSchema: () => z.string(),
  }
}
```

### Complex Relationships

Implicit many-to-many is **refused**: a config with `many: true` on both sides of a relationship fails `opensaas generate` with an error naming both ends. A Prisma schema like this:

```prisma
model Post {
  tags Tag[]
}
model Tag {
  posts Post[]
}
```

becomes a junction you author yourself — a list with a to-one relationship to each side, its own surrogate id, and a unique `db.indexes` entry over the two fields so the pair cannot be inserted twice. Both outer lists then point at the junction with `many: true`:

```typescript
Post: list({
  fields: {
    tags: relationship({ ref: 'PostTag.post', many: true }),
  },
}),
Tag: list({
  fields: {
    posts: relationship({ ref: 'PostTag.tag', many: true }),
  },
}),
PostTag: list({
  fields: {
    post: relationship({ ref: 'Post.tags' }),
    tag: relationship({ ref: 'Tag.posts' }),
  },
  db: {
    indexes: [{ fields: ['post', 'tag'], unique: true }],
  },
}),
```

The join table Prisma used to manage invisibly becomes a model you name, own and can add columns to — an `addedAt`, an ordering, a `role`. For an existing database this is also the point at which you choose the junction's physical table name with `db.map`, so the new model lands on the rows you already have.

### Migrating Hooks

KeystoneJS hooks map to OpenSaaS hooks:

```typescript
// KeystoneJS
hooks: {
  resolveInput: async ({ resolvedData }) => {
    if (resolvedData.status === 'published') {
      return { ...resolvedData, publishedAt: new Date() }
    }
    return resolvedData
  },
}

// OpenSaaS (same!)
hooks: {
  resolveInput: async ({ resolvedData }) => {
    if (resolvedData.status === 'published') {
      return { ...resolvedData, publishedAt: new Date() }
    }
    return resolvedData
  },
}
```

### Deployment Configuration

The config does not change between environments — the connection does. Set `DATABASE_URL` (and `DIRECT_DATABASE_URL` where a pooler sits in front, so schema commands reach a connection that can run DDL), and deploy by running `prisma db migrate` from the committed `migrations/` directory.

Two `db` keys matter beyond the provider on a real deployment: `extensions`, which declares the extension packs the generator emits contract spaces for, and `client`, which carries pool options and a `pg` factory for serverless Postgres.

```typescript
export default config({
  db: {
    provider: 'postgresql',
    extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
  },
  lists: {/* ... */},
})
```

See [Config API](/docs/reference/config-api) for `db.client` and the rest.

## Summary

The Stack migration system provides:

✅ **Automated detection** of Prisma, KeystoneJS, Next.js projects
✅ **AI-guided wizard** through Claude Code integration
✅ **Schema introspection** and analysis
✅ **Config generation** with sensible defaults
✅ **Data preservation** - non-destructive migration
✅ **Access control patterns** for common scenarios
✅ **Validation tools** to verify migration
✅ **Documentation** and examples throughout

**Time to migrate:** 10-15 minutes with AI, 30-60 minutes manually

**Next:** [Authentication Guide](/docs/how-to/authentication) or [Access Control](/docs/concepts/access-control)
