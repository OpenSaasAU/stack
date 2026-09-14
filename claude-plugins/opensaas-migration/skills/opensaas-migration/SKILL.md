---
name: opensaas-migration
description: Expert knowledge for migrating projects to OpenSaaS Stack. Invoke whenever the user mentions migrating from KeystoneJS, Prisma, or an existing Next.js project; asks about access control patterns or opensaas.config.ts; or is troubleshooting any aspect of an OpenSaaS Stack migration. Don't wait for the user to say "migration" — trigger whenever the conversation touches these areas.
---

# OpenSaaS Stack Migration

Expert guidance for migrating existing projects to OpenSaaS Stack.

## Migration Process

### 1. Install Required Packages

**IMPORTANT: Always install packages before starting migration**

Detect the user's package manager (check for `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, or `bun.lockb`) and use their preferred package manager.

**Required packages:**

```bash
# Using npm
npm install --save-dev @opensaas/stack-cli
npm install @opensaas/stack-core

# Using pnpm
pnpm add -D @opensaas/stack-cli
pnpm add @opensaas/stack-core

# Using yarn
yarn add -D @opensaas/stack-cli
yarn add @opensaas/stack-core

# Using bun
bun add -D @opensaas/stack-cli
bun add @opensaas/stack-core
```

**Optional packages (based on user needs):**

- `@opensaas/stack-auth` - If the project needs authentication
- `@opensaas/stack-ui` - If the project needs the admin UI
- `@opensaas/stack-tiptap` - If the project needs rich text editing
- `@opensaas/stack-storage` - If the project needs file storage
- `@opensaas/stack-rag` - If the project needs semantic search/RAG

**Database adapters (required for Prisma 7):**

SQLite:

```bash
npm install better-sqlite3 @prisma/adapter-better-sqlite3
```

PostgreSQL:

```bash
npm install pg @prisma/adapter-pg
```

Neon (serverless PostgreSQL):

```bash
npm install @neondatabase/serverless @prisma/adapter-neon ws
```

### 2. Uninstall Old Packages (KeystoneJS Only)

**IMPORTANT: For KeystoneJS projects, uninstall KeystoneJS packages before installing OpenSaaS**

KeystoneJS migrations should preserve the existing file structure and just swap packages. Do NOT create a new project structure.

```bash
# Detect package manager and uninstall KeystoneJS packages
npm uninstall @keystone-6/core @keystone-6/auth @keystone-6/fields-document
# Or with pnpm
pnpm remove @keystone-6/core @keystone-6/auth @keystone-6/fields-document
```

Remove all `@keystone-6/*` packages from `package.json`.

### 3. Schema Analysis

**Prisma Projects:**

- Analyze existing `schema.prisma`
- Identify models, fields, and relationships
- Note any Prisma-specific features used

**KeystoneJS Projects:**

- Review list definitions in `keystone.config.ts` or `keystone.ts`
- Map KeystoneJS fields to OpenSaaS fields
- Identify access control patterns
- **Note the existing file structure** - preserve it during migration

### 4. Access Control Design

**Common Patterns:**

```typescript
// Public read, authenticated write
operation: {
  query: () => true,
  create: ({ session }) => !!session?.userId,
  update: ({ session }) => !!session?.userId,
  delete: ({ session }) => !!session?.userId,
}

// Author-only access
operation: {
  query: () => true,
  update: ({ session, item }) => item.authorId === session?.userId,
  delete: ({ session, item }) => item.authorId === session?.userId,
}

// Admin-only
operation: {
  query: ({ session }) => session?.role === 'admin',
  create: ({ session }) => session?.role === 'admin',
  update: ({ session }) => session?.role === 'admin',
  delete: ({ session }) => session?.role === 'admin',
}

// Filter-based access — return the Prisma filter DIRECTLY (no `where` wrapper);
// the engine merges it into the query's where clause
operation: {
  query: ({ session }) =>
    session ? { authorId: { equals: session.userId } } : false,
}
```

### 5. Field Mapping

**Prisma to OpenSaaS:**

| Prisma Type | OpenSaaS Field                 |
| ----------- | ------------------------------ |
| `String`    | `text()`                       |
| `Int`       | `integer()`                    |
| `Boolean`   | `checkbox()`                   |
| `DateTime`  | `timestamp()`                  |
| `Decimal`   | `decimal()`                    |
| `Json`      | `json()`                       |
| `Enum`      | `select({ options: [...] })`   |
| `Relation`  | `relationship({ ref: '...' })` |

**KeystoneJS to OpenSaaS:**

| KeystoneJS Field | OpenSaaS Field                                                             |
| ---------------- | -------------------------------------------------------------------------- |
| `text`           | `text()`                                                                   |
| `integer`        | `integer()`                                                                |
| `checkbox`       | `checkbox()`                                                               |
| `timestamp`      | `timestamp()`                                                              |
| `select`         | `select()`                                                                 |
| `relationship`   | `relationship()`                                                           |
| `password`       | `password()`                                                               |
| `decimal`        | `decimal()`                                                                |
| `calendarDay`    | `calendarDay()`                                                            |
| `json`           | `json()`                                                                   |
| `virtual`        | `virtual()` — **requires changes** (no GraphQL, use `hooks.resolveOutput`) |

### 6. Database Configuration

OpenSaaS Stack supports **PostgreSQL only** — `db.provider` is `'postgresql'` and nothing else. There is no SQLite provider, no `url` key, and no `prismaClientConstructor`: the connection URL is not part of the config. The runtime resolves it from `DATABASE_URL`, or — when that's unset — from the running Dev database's own state file during `opensaas dev` (ADR-0063). A KeystoneJS project on SQLite has no direct equivalent here; point `DATABASE_URL` at a Postgres instance, or rely on `opensaas dev`'s own in-process Postgres, which needs no `DATABASE_URL` at all.

**Default:**

```typescript
export default config({
  db: { provider: 'postgresql' },
  lists: {
    /* ... */
  },
})
```

**Custom pool binding** (e.g. a serverless driver) uses `db.client.pg`, a **lazy** factory rather than an instance — the config is loaded by tooling that must never open a connection itself:

```typescript
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

export default config({
  db: {
    provider: 'postgresql',
    client: {
      pg: () => {
        neonConfig.webSocketConstructor = ws
        return new Pool({ connectionString: process.env.DATABASE_URL })
      },
    },
  },
  lists: {
    /* ... */
  },
})
```

## KeystoneJS Migration Strategy

**CRITICAL: KeystoneJS projects should be migrated IN PLACE**

Do NOT create a new project structure. Instead:

### File Structure Preservation

**Keep existing files and update them:**

1. **Rename config file:**
   - `keystone.config.ts` → `opensaas.config.ts`
   - OR `keystone.ts` → `opensaas.config.ts`

2. **Update imports in ALL files:**

   ```typescript
   // Before (KeystoneJS)
   import { config, list } from '@keystone-6/core'
   import { text, relationship, timestamp } from '@keystone-6/core/fields'

   // After (OpenSaaS)
   import { config, list } from '@opensaas/stack-core'
   import { text, relationship, timestamp } from '@opensaas/stack-core/fields'
   ```

3. **Rename KeystoneJS concepts to OpenSaaS:**
   - `keystone.config.ts` → `opensaas.config.ts`
   - `Keystone` references → `OpenSaaS` or remove entirely
   - Keep all other file names and structure as-is

4. **Update schema/list definitions:**
   - Keep existing list definitions
   - Update field imports from `@keystone-6/core/fields` to `@opensaas/stack-core/fields`
   - Adapt access control syntax (KeystoneJS and OpenSaaS are similar)
   - Keep existing GraphQL API file structure

5. **Preserve API routes and pages:**
   - Keep existing Next.js pages
   - Update any KeystoneJS context calls to use OpenSaaS context
   - Maintain existing route structure

### Import Mapping

| KeystoneJS Import             | OpenSaaS Import               |
| ----------------------------- | ----------------------------- |
| `@keystone-6/core`            | `@opensaas/stack-core`        |
| `@keystone-6/core/fields`     | `@opensaas/stack-core/fields` |
| `@keystone-6/auth`            | `@opensaas/stack-auth`        |
| `@keystone-6/fields-document` | `@opensaas/stack-tiptap`      |

### Example: KeystoneJS to OpenSaaS Config

**Before (keystone.config.ts):**

```typescript
import { config, list } from '@keystone-6/core'
import { text, relationship, timestamp } from '@keystone-6/core/fields'

export default config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ ui: { displayMode: 'textarea' } }),
        author: relationship({ ref: 'User.posts' }),
        publishedAt: timestamp(),
      },
    }),
  },
})
```

**After (opensaas.config.ts):**

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ ui: { displayMode: 'textarea' } }), // ui.displayMode carries over from Keystone
        author: relationship({ ref: 'User.posts' }),
        publishedAt: timestamp(),
      },
    }),
  },
})
```

### Steps for KeystoneJS Migration

1. **Uninstall KeystoneJS packages** (see step 2 above)
2. **Install OpenSaaS packages** (see step 1 above)
3. **Rename** `keystone.config.ts` to `opensaas.config.ts`
4. **Find and replace** in ALL project files:
   - `@keystone-6/core` → `@opensaas/stack-core`
   - `@keystone-6/core/fields` → `@opensaas/stack-core/fields`
   - `@keystone-6/auth` → `@opensaas/stack-auth`
5. **Set `db: { provider: 'postgresql' }`** — no adapter, no `url`, no `prismaClientConstructor`; the connection resolves from `DATABASE_URL`
6. **Migrate virtual fields** — if any `virtual()` fields exist, invoke the `keystone-virtual-fields-context` skill
7. **Migrate context.graphql calls** — search for `context.graphql.run(`, `context.graphql.raw(`, `context.query.`; for simple reads replace with `context.db.*`; for nested/joined data compose a read narrowed by `.select()` / `.include()`; invoke the `migrate-context-calls` skill for detailed patterns
8. **Test** - the app structure should remain identical

**DO NOT:**

- Create new folders or reorganize the project
- Move files to different locations
- Create a new "OpenSaaS structure"
- Change API endpoints or routes

**DO:**

- Keep existing file structure
- Update imports only
- Adapt config to OpenSaaS syntax
- Preserve existing API routes and pages

## Common Migration Challenges

### Challenge: Preserving Existing Data

**Solution:**

- Use `opensaas generate` to create Prisma schema
- Use `prisma db push` instead of migrations for existing databases
- Never use `prisma migrate dev` with existing data

### Challenge: Complex Access Control

**Solution:**

- Start with simple boolean access control
- Iterate to filter-based access as needed
- Use field-level access for sensitive data

### Challenge: Custom Field Types

**Solution:**

A field builder is a plain object satisfying `BaseFieldConfig<TTypeInfo, TKey>` (from `@opensaas/stack-core/extend`), generic over both type parameters so a field-level `hooks.resolveOutput` sees the mounted field's real value type instead of `unknown`. There is no Prisma schema language anywhere in the pipeline — the generator emits a TypeScript **Contract module**, and a field describes what it contributes to that contract through `getContractField()` rather than through `getPrismaType`/`getPrismaColumns`/`getPrismaRelation` (deleted — those named a `schema.prisma` line that no longer exists).

Every field owes `getZodSchema(fieldName, operation)` and `getContractField(fieldName, listKey, config)`. The latter returns one of:

- `{ kind: 'column', name, type: { pack, type, args? }, nullable, ... }` — a single physical column (`pack: 'pg'` for a built-in Postgres type; a third-party pack like `pgvector` names itself and must be declared via `context.addExtension` in the field's own plugin)
- `{ kind: 'columns', columns: [...] }` — several physical columns backing one logical value (see below)
- `{ kind: 'computed' }` — a virtual field with no column at all

`outputType` (a `TypeDescriptor`: a primitive type string, an import string, or `{ value, from, name? }`) is **required** whenever the field has no single column to be typed from — every virtual field, and every `kind: 'columns'` field — because there `opensaas generate` has nothing to infer the TypeScript face from. `inputType` is never required: on a single-column field its absence means the column's own input type, but a `kind: 'columns'` field has no single column for that to name either, so declare it alongside `outputType` there too. A field leaving out a member it owes fails `pnpm generate`, naming the list and the field.

**Single-column example** (`getPrismaType`/`getTypeScriptType`'s replacement):

```typescript
import { z } from 'zod'
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  FieldKeys,
  TypeInfo,
} from '@opensaas/stack-core/extend'

export type MyCustomField<
  TTypeInfo extends TypeInfo = TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> = BaseFieldConfig<TTypeInfo, TKey> & {
  type: 'myCustom'
}

export function myCustom<
  TTypeInfo extends TypeInfo = TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
>(options?: Omit<MyCustomField<TTypeInfo, TKey>, 'type'>): MyCustomField<TTypeInfo, TKey> {
  return {
    type: 'myCustom',
    ...options,
    getZodSchema: () => z.string().nullable().optional(),
    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: true,
    }),
  }
}
```

**Multi-column example** (several physical columns behind one logical value — a shape KeystoneJS migrations run into often, e.g. reconstructing a Keystone `file`/`image` field's split columns, or `@opensaas/stack-rag`'s `embedding()` pairing a vector column with a `jsonb` metadata column). A `kind: 'columns'` descriptor owes three more members the engine cannot derive on its own:

```typescript
import { z } from 'zod'
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  FieldKeys,
  TypeInfo,
} from '@opensaas/stack-core/extend'

interface Money {
  amountCents: number
  currency: string
}

export type MoneyField<
  TTypeInfo extends TypeInfo = TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
> = BaseFieldConfig<TTypeInfo, TKey> & { type: 'money' }

export function money<
  TTypeInfo extends TypeInfo = TypeInfo,
  TKey extends FieldKeys<TTypeInfo['fields']> = FieldKeys<TTypeInfo['fields']>,
>(options?: Omit<MoneyField<TTypeInfo, TKey>, 'type'>): MoneyField<TTypeInfo, TKey> {
  const amountColumn = (fieldName: string) => `${fieldName}AmountCents`
  const currencyColumn = (fieldName: string) => `${fieldName}Currency`

  return {
    type: 'money',
    ...options,
    // No single column to infer a TypeScript face from — both required. These
    // strings are emitted verbatim into the generated types, so they must
    // name a package specifier the consuming project can resolve — never a
    // path relative to this field package's own source. The `{ value, from }`
    // object form (see the `Decimal` example in the root CLAUDE.md) is the
    // alternative for a type with a real runtime constructor; `Money` here is
    // a plain interface, so the import-string form names it directly.
    outputType: "import('@myorg/money-field').Money",
    inputType: "import('@myorg/money-field').Money",

    getZodSchema: () =>
      z.object({ amountCents: z.number().int(), currency: z.string() }).nullable().optional(),

    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'columns',
      columns: [
        { name: amountColumn(fieldName), type: { pack: 'pg', type: 'int' }, nullable: true },
        { name: currencyColumn(fieldName), type: { pack: 'pg', type: 'text' }, nullable: true },
      ],
    }),

    // The physical columns this field owns, so a read can strip the raw parts.
    getColumnNames: (fieldName): string[] => [amountColumn(fieldName), currencyColumn(fieldName)],

    // Build the logical value from the row's per-part columns (runs before field visibility).
    assembleColumns: (fieldName, row): Money | null => {
      const amountCents = row[amountColumn(fieldName)]
      const currency = row[currencyColumn(fieldName)]
      if (typeof amountCents !== 'number' || typeof currency !== 'string') return null
      return { amountCents, currency }
    },

    // Split the logical value back into per-part columns for the write (runs after resolveInput).
    splitColumns: (fieldName, value): Record<string, unknown> => {
      const money = value as Money | null
      return {
        [amountColumn(fieldName)]: money?.amountCents ?? null,
        [currencyColumn(fieldName)]: money?.currency ?? null,
      }
    },
  }
}
```

A non-nullable part column is a generate-time error: the secured surface always types a `kind: 'columns'` field's logical key as optional on create, so there is no all-parts-required case for it to satisfy a `NOT NULL` part with — keep every part column `nullable: true` and enforce "required" through `getZodSchema`/`validation` instead.

For a computed field with no column at all, `getContractField: () => ({ kind: 'computed' })` plus `outputType` and a `resolveOutput` hook is the replacement for KeystoneJS's `virtual({ field: graphql.field(...) })` — see the "Challenge: Virtual Fields" section below.

- Register UI components for the admin interface (`registerFieldComponent`, or `ui.component` per-field) — this part of the contract is unchanged
- Worked reference implementations: `@opensaas/stack-rag`'s `embedding()` (multi-column: a vector column plus a `jsonb` metadata column) and `@opensaas/stack-storage`'s `image()`/`file()` (single-column by default, multi-column in `db.columns: 'keystone'` mode — exactly the shape a KeystoneJS migration with existing per-part columns needs)

### Challenge: KeystoneJS Document Field

**Solution:**

- Replace with `@opensaas/stack-tiptap` rich text field
- Or create custom field type for document structure
- May require data migration for existing documents

### Challenge: Virtual Fields

Keystone virtual fields use `graphql.field({ type: graphql.String, resolve })`. OpenSaaS Stack has no GraphQL — virtual fields use `hooks.resolveOutput` with a `type` property instead.

**Quick example:**

```typescript
// Keystone
fullName: virtual({
  field: graphql.field({
    type: graphql.String,
    resolve: (item) => `${item.firstName} ${item.lastName}`,
  }),
})

// OpenSaaS Stack
fullName: virtual({
  type: 'string',
  hooks: {
    resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
  },
})
```

Field arguments are not supported in OpenSaaS Stack. For detailed patterns including context queries and custom types, **invoke the `keystone-virtual-fields-context` skill**.

### Challenge: context.graphql Calls

Keystone apps often use `context.graphql.run()` for type-safe data access from routes, server actions, and hooks. OpenSaaS Stack has no GraphQL — use `context.db.{listName}.{method}()` directly, or a composed read narrowed by `.select()` / `.include()` for nested/joined data.

**Simple queries (no nesting):**

```typescript
// Keystone
const { posts } = await context.graphql.run({
  query: `query { posts(where: { status: { equals: published } }) { id title } }`,
})

// OpenSaaS Stack
const posts = await context.db.Post.where({ status: { equals: 'published' } }).all()
```

**Queries with nested/related data (composed reads — recommended for Keystone migrations):**

`.select()` and `.include()` compose directly on the read itself — the closest equivalent to Keystone GraphQL fragments and codegen types, with the row type inferred from the chain rather than declared separately.

```typescript
// Keystone — GraphQL fragment + codegen types
import type { PostFragment } from './__generated__/graphql'

const { posts } = await context.graphql.run({
  query: `
    fragment AuthorFields on User { id name }
    query { posts { id title author { ...AuthorFields } } }
  `,
})

// OpenSaaS Stack — .select() / .include() (no codegen, no GraphQL)
const postsWithAuthor = await context.db.Post.select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .all()
// postsWithAuthor[0]: { id: string; title: string; author: { id: string; name: string } | null }

// With filter, orderBy, pagination
const filtered = await context.db.Post.where({ published: { equals: true } })
  .select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .orderBy({ createdAt: 'desc' })
  .limit(10)
  .all()

// Single record
const post = await context.db.Post.where({ id: { equals: id } })
  .select('id', 'title')
  .include('author', (author) => author.select('id', 'name'))
  .first()

// Nested relationship filtering
const postsWithComments = await context.db.Post.select('id')
  .include('comments', (comments) =>
    comments
      .where({ approved: { equals: true } })
      .limit(5)
      .select('id', 'body'),
  )
  .all()
```

List names are PascalCase, exactly as declared in config: `Post` → `context.db.Post`, `BlogPost` → `context.db.BlogPost`. There is no camelCase or lowercase spelling of a list on `context.db`. Access control is enforced automatically. For detailed patterns including sudo access, **invoke the `migrate-context-calls` skill**.

## Migration Checklist

### For Prisma Projects:

- [ ] **Detect package manager** (npm, pnpm, yarn, or bun)
- [ ] **Install required packages** (@opensaas/stack-cli, @opensaas/stack-core)
- [ ] **Install optional packages** (auth, ui, etc. based on needs)
- [ ] Analyze existing schema
- [ ] Design access control patterns
- [ ] Create `opensaas.config.ts` with `db: { provider: 'postgresql' }`
- [ ] Set `DATABASE_URL`, or let `opensaas dev` run its own Dev database (ADR-0063)
- [ ] Run `opensaas generate` (or `npx opensaas generate`)
- [ ] Run `prisma generate` (or `npx prisma generate`)
- [ ] Run `prisma db push` (or `npx prisma db push`)
- [ ] Test access control
- [ ] Verify admin UI (if using @opensaas/stack-ui)
- [ ] Update application code to use context
- [ ] Test all CRUD operations
- [ ] Deploy to production

### For KeystoneJS Projects:

- [ ] **Detect package manager** (npm, pnpm, yarn, or bun)
- [ ] **Uninstall ALL KeystoneJS packages** (@keystone-6/\*)
- [ ] **Install required packages** (@opensaas/stack-cli, @opensaas/stack-core)
- [ ] **Install optional packages** (auth, ui, tiptap for document fields)
- [ ] **Rename** `keystone.config.ts` to `opensaas.config.ts`
- [ ] **Update imports** in config file (KeystoneJS → OpenSaaS)
- [ ] **Find and replace imports** in ALL project files
- [ ] **Set `db: { provider: 'postgresql' }`** — no `url`, no adapter, no `prismaClientConstructor`
- [ ] **Update context creation** in API routes
- [ ] **Migrate virtual fields** (if any) — replace `graphql.field()` + `resolve()` with `hooks.resolveOutput`; invoke `keystone-virtual-fields-context` skill
- [ ] **Migrate context.graphql calls** (if any) — for simple reads use `context.db.*`; for nested/related data compose a read narrowed by `.select()` / `.include()`; invoke `migrate-context-calls` skill for detailed patterns
- [ ] Analyze and adapt access control patterns
- [ ] Run `opensaas generate`
- [ ] Run `prisma generate`
- [ ] Run `prisma db push`
- [ ] Test existing API routes
- [ ] Test existing pages/UI
- [ ] Test all CRUD operations
- [ ] Verify no broken imports
- [ ] Deploy to production

## Best Practices

1. **Start Simple**: Begin with basic access control, refine later
2. **Test Access Control**: Verify permissions work as expected
3. **Use Context Everywhere**: Replace direct Prisma calls with `context.db`
4. **Leverage Plugins**: Use `@opensaas/stack-auth` for authentication
5. **Version Control**: Commit `opensaas.config.ts` to git
6. **Document Decisions**: Comment complex access control logic

## Reporting Issues

**When you encounter bugs or missing features in OpenSaaS Stack:**

If during migration you discover:

- Bugs in OpenSaaS Stack packages
- Missing features that would improve the migration experience
- Documentation gaps or errors
- API inconsistencies or unexpected behavior

**Use the `github-issue-creator` agent** to create a GitHub issue on the `OpenSaasAU/stack` repository:

```
Invoke the github-issue-creator agent with:
- Clear description of the bug or missing feature
- Steps to reproduce (if applicable)
- Expected vs actual behavior
- Affected files and line numbers
- Your suggested solution (if you have one)
```

This ensures bugs and feature requests are properly tracked and addressed by the OpenSaaS Stack team, improving the experience for future users.

**Example:**

If you notice that the migration command doesn't properly handle Prisma enums, invoke the github-issue-creator agent:

> "Found a bug: The migration generator doesn't convert Prisma enums to OpenSaaS select fields. Enums are being ignored during schema analysis in packages/cli/src/migration/introspectors/prisma-introspector.ts"

The agent will create a detailed GitHub issue with reproduction steps and proposed solution.

## Resources

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/docs/how-to/migrate-from-keystone)
- [Access Control Guide](https://stack.opensaas.au/docs/concepts/access-control)
- [Field Types](https://stack.opensaas.au/docs/concepts/field-types)
