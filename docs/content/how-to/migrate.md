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
   - Database provider (PostgreSQL, MySQL, SQLite)
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

Convert it to OpenSaaS config:

```typescript
// opensaas.config.ts
import { config, list } from '@opensaas/stack-core'
import { text, checkbox, relationship } from '@opensaas/stack-core/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
      return new PrismaClient({ adapter })
    },
  },
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
          update: ({ session, item }) => session?.userId === item.id,
          delete: ({ session, item }) => session?.userId === item.id,
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
          // Filter-based: anonymous users see published posts, authors see their own
          query: ({ session }) =>
            session
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

### 4. Generate Schema

```bash
# Generate Prisma schema and types
pnpm opensaas generate

# Generate Prisma Client
npx prisma generate

# Push to database (preserves existing data)
npx prisma db push
```

### 5. Update Application Code

Replace direct Prisma calls with context:

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
const posts = await context.db.post.findMany()
```

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

- **Yes** → Uses existing DATABASE_URL, preserves data
- **No** → Creates new database

**Question:** "What database provider are you using?"

Options:

- PostgreSQL (production recommended)
- MySQL
- SQLite (development/simple apps)

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

- **Private (owner-only)** - For user-specific data

  ```typescript
  access: {
    operation: {
      // Filter-based: users only ever see their own records
      query: ({ session }) => (session ? { userId: { equals: session.userId } } : false),
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

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, checkbox, relationship } from '@opensaas/stack-core/fields'
import { authPlugin } from '@opensaas/stack-auth'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  plugins: [
    authPlugin({
      emailAndPassword: { enabled: true },
      sessionFields: ['userId', 'email', 'name'],
    }),
  ],
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' })
      return new PrismaClient({ adapter })
    },
  },
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
          // Anonymous visitors only see published posts (filter-based access)
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

**Access Control Pattern:**

```typescript
Product: list({
  access: {
    operation: {
      query: () => true, // Public
      create: ({ session }) => session?.role === 'admin',
      update: ({ session }) => session?.role === 'admin',
      delete: ({ session }) => session?.role === 'admin',
    },
  },
}),
Order: list({
  access: {
    operation: {
      // Filter-based: admins see everything, users see their own orders
      query: ({ session }) =>
        session?.role === 'admin'
          ? true
          : session
            ? { userId: { equals: session.userId } }
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

**Access Control Pattern:**

```typescript
Project: list({
  fields: {
    name: text(),
    team: relationship({ ref: 'Team.projects' }),
  },
  access: {
    operation: {
      query: async ({ session, context }) => {
        const membership = await context.db.teamMember.findFirst({
          where: { userId: session.userId }
        })
        return { teamId: membership?.teamId }
      },
      create: ({ session }) => !!session,
      update: async ({ session, item, context }) => {
        const membership = await context.db.teamMember.findFirst({
          where: {
            userId: session.userId,
            teamId: item.teamId,
            role: { in: ['owner', 'admin'] }
          }
        })
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

2. **Use `db push` instead of migrations:**

   ```bash
   npx prisma db push
   ```

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

# Or for SQLite
cp dev.db dev.db.backup

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
.opensaas/context.ts        # Generated context
.opensaas/types.ts          # Generated types
prisma/schema.prisma        # Generated schema
prisma.config.ts            # Prisma CLI config
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Generate and Push

```bash
# Generate Prisma client
npx prisma generate

# Push to database (preserves data)
npx prisma db push

# Check with Prisma Studio
npx prisma studio
```

### 4. Update Application Code

Replace Prisma calls with context:

```typescript
// Before
const posts = await prisma.post.findMany()

// After
import { getContext } from '@/.opensaas/context'
const context = await getContext({ userId: session.userId })
const posts = await context.db.post.findMany()
```

### 5. Add Admin UI

```typescript
// app/admin/[[...admin]]/page.tsx
import { AdminUI } from '@opensaas/stack-ui'
import { getAdminContext } from '@opensaas/stack-ui/server'
import config from '@/opensaas.config'

export default async function AdminPage() {
  const context = await getAdminContext(config)
  return <AdminUI context={context} config={config} />
}
```

### 6. Test Access Control

Verify access control works:

```typescript
// Test as anonymous user
const anonContext = await getContext()
const posts = await anonContext.db.post.findMany()
// Should only return published posts

// Test as authenticated user
const authContext = await getContext({ userId: 'user-123' })
const myPosts = await authContext.db.post.findMany()
// Should return user's posts (published + drafts)
```

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
import { auth } from '@/lib/auth'

export async function getPosts() {
  const session = await auth.api.getSession({ headers: await headers() })
  const context = await getContext(session?.user)
  return await context.db.post.findMany()
}
```

## Migrating context.graphql.run

If you're migrating from KeystoneJS, your project likely uses `context.graphql.run()` or `context.graphql.raw()` for type-safe database access. Stack has no GraphQL layer — a read is composed on `context.db.<List>` and narrowed with `.select()`, which the engine honours exactly. There is no fragment to declare and no codegen step: the generated types give each list's surface its own shape.

{% callout type="info" %}
The full set of `context.graphql.run` → `context.db.*` recipes — including the harder cases (relation-filter `where`-shape translation, `connect` / `disconnect` / `set` nested writes, and gql.tada typed documents) — lives in the canonical [Migrating from KeystoneJS](/docs/how-to/migrate-from-keystone#5-replacing-context-graphql-run-with-context-db-fragments) guide and the [Queries & projections](/docs/concepts/queries) reference. This section is a short summary that points there rather than duplicating them.
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

### Document Decisions

Add comments to your config:

```typescript
lists: {
  Post: list({
    // Public read for published posts, author-only for drafts (filter-based)
    access: {
      operation: {
        query: ({ session }) =>
          session
            ? { OR: [{ published: { equals: true } }, { authorId: { equals: session.userId } }] }
            : { published: { equals: true } },
      },
    },
  }),
}
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
import type { BaseFieldConfig } from '@opensaas/stack-core/extend'

export type SlugField = BaseFieldConfig & {
  type: 'slug'
  from?: string
}

export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,
    getPrismaType: () => ({ type: 'String', modifiers: '' }),
    getTypeScriptType: () => ({ type: 'string', optional: false }),
    getZodSchema: () => z.string(),
  }
}
```

### Complex Relationships

For many-to-many relationships:

```typescript
// Prisma implicit many-to-many
model Post {
  tags Tag[]
}
model Tag {
  posts Post[]
}

// OpenSaaS explicit junction table
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
}),
```

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

### Database-Specific Configuration

#### PostgreSQL

```typescript
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
      })
      const adapter = new PrismaPg(pool)
      return new PrismaClient({ adapter })
    },
  },
})
```

#### MySQL

```typescript
import { PrismaPlanetScale } from '@prisma/adapter-planetscale'
import { Client } from '@planetscale/database'

export default config({
  db: {
    provider: 'mysql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const client = new Client({
        url: process.env.DATABASE_URL,
      })
      const adapter = new PrismaPlanetScale(client)
      return new PrismaClient({ adapter })
    },
  },
})
```

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
