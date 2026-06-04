# Migrating from KeystoneJS

This is the **canonical, single source of truth** for migrating a KeystoneJS 6 project to OpenSaaS Stack. It is written for both human developers and migration agents. KeystoneJS and OpenSaaS Stack share a config-first philosophy, Keystone-compliant hooks, and the same access-control shape, so most concepts map across directly — and the generator is deliberately tuned for **Schema parity** so an existing database migrates without destructive changes.

{% callout type="info" %}
This page consolidates the full Keystone migration story. The general, multi-source ([Prisma / Next.js / Keystone](/docs/guides/migration)) AI-assisted walkthrough lives in the [Migration Guide](/docs/guides/migration); the detailed image/file and auth-adoption recipes are linked (not duplicated) from here so there is one place each fact is maintained.
{% /callout %}

## Overview of differences

| Concern                 | KeystoneJS 6                       | OpenSaaS Stack                                                       |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Schema definition       | `list()` in `schema.ts`            | `list()` in `opensaas.config.ts`                                     |
| Database                | Prisma (managed by Keystone)       | Prisma 7 with driver adapters                                        |
| Access control          | Functions on the `access` key      | Same shape — operation + filter functions                            |
| Hooks                   | `resolveInput`, `validateInput`, … | Same names + `resolveOutput`                                         |
| GraphQL API             | Built-in, always on                | **Not provided** (ADR-0005) — migrate via fragments + `context.db.*` |
| `context.graphql.run()` | Run raw GraphQL queries            | `context.db.*` with `defineFragment` / `runQuery` / `ResultOf`       |
| Type generation         | GraphQL codegen                    | Built-in TypeScript inference via `ResultOf` (no codegen step)       |
| Auth                    | `@keystone-6/auth`                 | `@opensaas/stack-auth` (Better Auth)                                 |
| Image / file fields     | Multi-column metadata              | Multi-column parity mode or single `Json?` column                    |
| Admin UI                | Auto-generated from schema         | Auto-generated from config                                           |

## The migration in five moves

1. **Config** — translate `schema.ts` + `keystone.ts` into one `opensaas.config.ts`.
2. **Generator parity** — set the generator to match your live schema so `prisma db push` / `migrate diff` shows no destructive changes.
3. **Data access** — replace `context.graphql.run` / `context.query.*` with `context.db.*` and fragments.
4. **Assets & auth** — adopt existing image/file columns and an existing Better Auth install in place.
5. **Coexistence** — optionally relocate generated output so the new stack can run side-by-side with Keystone during the cut-over.

You can drive this with the migration CLI and the `opensaas-migration` Claude Code plugin (see [Tooling](#tooling-cli-agent-plugin) at the end), or do it by hand following the sections below.

---

## 1. Config migration

### Keystone (`schema.ts` + `keystone.ts`)

```typescript
// schema.ts
import { list } from '@keystone-6/core'
import { text, relationship, timestamp } from '@keystone-6/core/fields'

export const lists = {
  Post: list({
    fields: {
      title: text({ validation: { isRequired: true } }),
      author: relationship({ ref: 'User.posts' }),
      publishedAt: timestamp(),
    },
    access: {
      operation: {
        query: () => true,
        create: ({ session }) => !!session,
        update: ({ session }) => !!session,
        delete: ({ session }) => !!session,
      },
    },
  }),
  User: list({
    fields: {
      name: text(),
      email: text({ isIndexed: 'unique' }),
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  }),
}
```

### OpenSaaS Stack (`opensaas.config.ts`)

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp } from '@opensaas/stack-core/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
    // Prisma 7 requires a driver adapter
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })
      return new PrismaClient({ adapter })
    },
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        author: relationship({ ref: 'User.posts' }),
        publishedAt: timestamp(),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session }) => !!session,
          delete: ({ session }) => !!session,
        },
      },
    }),
    User: list({
      fields: {
        name: text(),
        email: text({ isIndexed: 'unique' }),
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
  },
})
```

**Key differences:**

- `config()` wraps every list in a single default export.
- The `db` block is required and must include a `prismaClientConstructor` (Prisma 7 driver adapter).
- Field builders import from `@opensaas/stack-core/fields` (not `@keystone-6/core/fields`).
- List names stay **PascalCase** (`Post`, `User`); `context.db` access is **camelCase** (`context.db.post`).

---

## 2. Field-type mapping

Most Keystone field builders have a same-named OpenSaaS equivalent. The validation and UI options carry across with the same names.

| Keystone field   | OpenSaaS Stack field                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text()`         | `text()`                                          | `validation.isRequired` / `validation.length`, `isIndexed` carry across.                                                                                                                                                                                                                                                                                                                                                                                                |
| `integer()`      | `integer()`                                       | `validation.isRequired` / `min` / `max`.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `float()`        | `decimal()`                                       | **No `float()` builder.** `decimal()` is a _type change_, not 1:1 parity: the column goes from `Float` (double) to `Decimal(p, s)` and the runtime value from `number` to a `decimal.js` `Decimal`. Choose `precision` / `scale` (defaults `18, 4`) wide enough for your existing values and review for rounding/precision differences.                                                                                                                                 |
| `decimal()`      | `decimal()`                                       | `defaultValue`, `min` / `max` are strings (precision-safe).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `bigInt()`       | `text()`                                          | **No native BigInt field.** The migration introspector maps Prisma `BigInt` to `text()` ("No native support") and warns the field is mapped to `text()`; values are stored/returned as strings (exact preservation for IDs, but no numeric operators — parse before arithmetic). Don't use `integer({ db: { nativeType: 'BigInt' } })`: it emits `Int @db.BigInt`, which Prisma rejects (`@db.BigInt` is not valid on the `Int` scalar) and the TS type stays `number`. |
| `checkbox()`     | `checkbox()`                                      | `defaultValue: true / false`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `timestamp()`    | `timestamp()`                                     | `defaultValue: { kind: 'now' }` or a `Date`.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `calendarDay()`  | `calendarDay()`                                   | Date-only string field.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `password()`     | `password()`                                      | Excluded from reads; hash via field `resolveInput`.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `select()`       | `select()`                                        | `options`, `db.type: 'enum'`, `db.enumName`, `db.isNullable` — see §3.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `relationship()` | `relationship()`                                  | `ref` format differs slightly — see §6.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `json()`         | `json()`                                          | Honours `defaultValue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `virtual()`      | `virtual()`                                       | Provide `type` (TS output type) + a `resolveOutput` hook.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `image()`        | `image()` from `@opensaas/stack-storage/fields`   | Multi-column parity mode — see §8.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `file()`         | `file()` from `@opensaas/stack-storage/fields`    | Multi-column parity mode — see §8.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `document()`     | `richText()` from `@opensaas/stack-tiptap/fields` | Rich-text editor; see [Tiptap](/docs/packages/tiptap).                                                                                                                                                                                                                                                                                                                                                                                                                  |

{% callout type="info" %}
For the complete option reference on every built-in field, see [Field Types](/docs/core-concepts/field-types). To build a field type that has no built-in equivalent, see [Custom Fields](/docs/guides/custom-fields).
{% /callout %}

---

## 3. Generator parity (matching your live schema)

The generator's defaults are deliberately tuned so a Keystone database migrates without destructive schema changes (**Schema parity**; see [ADR-0004](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0004-generator-emits-keystone-compatible-defaults.md)). Understanding these knobs is the difference between a clean `prisma migrate diff` and an accidental column drop.

### `defaultValue` is honoured

`text()`, `integer()`, and `json()` (and `checkbox()` / `decimal()`) emit `@default(...)` from their `defaultValue`. You no longer need `extendPrismaSchema` to re-add a default that Keystone had.

```typescript
views: integer({ defaultValue: 0 }) // → views Int @default(0)
role: text({ defaultValue: 'member' }) // → role String @default("member")
```

### Auto-timestamps are OFF by default

The generator does **not** append `createdAt` / `updatedAt` to every model — matching Keystone 6, which never adds them automatically. Opt in explicitly:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    timestamps: true, // add createdAt/updatedAt to every model
    prismaClientConstructor: (PrismaClient) => {
      /* ... */
    },
  },
})
```

`db.timestamps` is global; a per-list override wins:

```typescript
Production: list({
  fields: { name: text() },
  db: { timestamps: false }, // opt this list out even when global is on
})
```

When timestamps resolve to on **and** a list already declares its own `createdAt` / `updatedAt`, the auto column is skipped for the declared field(s) so Prisma never sees a duplicate (`P1012`). If your Keystone lists declared timestamps explicitly, keep declaring them as fields and leave `db.timestamps` off.

### Keystone-compat mode: empty-string text defaults

Keystone 6 gives every non-null text column an implicit empty-string default. Turn on `keystoneCompat` so the generator mirrors that, instead of hand-setting `defaultValue: ''` on dozens of columns:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    keystoneCompat: true, // non-null text without a default → @default("")
    prismaClientConstructor: (PrismaClient) => {
      /* ... */
    },
  },
})
```

The flag is opt-in (a greenfield project would not want it) and only affects **non-null** text columns with **no explicit `defaultValue`**. An explicit `text({ defaultValue: 'x' })` always wins, and nullable text / non-text fields are untouched.

### Singleton `id` is bare

Singleton lists (`isSingleton: true`) emit `id Int @id` with no `@default(1)`, matching Keystone 6.

### `select()`: native enums, enum names, and nullability

A `select()` defaults to a plain string column. Match a Keystone schema precisely with the `db` options:

```typescript
status: select({
  options: [
    { label: 'Open', value: 'open' },
    { label: 'Closed', value: 'closed' },
  ],
  defaultValue: 'open',
  db: {
    type: 'enum', // store as a native Prisma enum (vs a string column)
    enumName: 'AccountNoteStatusType', // match a live DB enum name (default is <List><Field>)
    isNullable: true, // keep the column nullable even though a default is set
  },
})
// → status AccountNoteStatusType? @default(open) + enum AccountNoteStatusType { open closed }
```

- `db.type: 'enum'` generates a native enum type; the default is a plain string column.
- `db.enumName` overrides the derived `<List><Field>` enum name — useful for Keystone's `…Type` suffix.
- `db.isNullable: true` forces a nullable column even when a `defaultValue` is present (so a live column containing NULLs migrates without a NOT NULL failure). Without it, a select with a default is `NOT NULL`.

### Verifying parity

After generating, diff the schema against the live database before pushing:

```bash
pnpm opensaas generate
npx prisma generate
# Postgres/MySQL: confirm there are no destructive changes
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
# SQLite dev loop:
npx prisma db push
```

For any advanced Prisma feature the config API doesn't expose, use `db.extendPrismaSchema` (global) or a relationship field's `db.extendPrismaSchema` (per-field) — see [Generators](/docs/core-concepts/generators).

---

## 4. Access control

Access control functions share the same shape between Keystone and OpenSaaS Stack — operation-level booleans/filters and filter-based scoping all carry across.

| Keystone access                                                | OpenSaaS Stack                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `access.operation.{query,create,update,delete}`                | Same — `access: { operation: { … } }`                           |
| `access.filter.{query,update,delete}` returning a `where`      | Operation function returning a Prisma `where` filter            |
| `access.item.*`                                                | Operation function with `item` arg (`({ session, item }) => …`) |
| Field access `access.read` / `access.create` / `access.update` | Field-level `access` with the same keys                         |

```typescript
// Keystone
access: {
  operation: {
    query: ({ session }) => !!session,
  },
  filter: {
    query: ({ session }) => ({ author: { id: { equals: session?.itemId } } }),
  },
}

// OpenSaaS Stack — boolean and filter forms are both supported
access: {
  operation: {
    query: ({ session }) => !!session,
    // Return a Prisma where filter to scope which records are visible.
    // Note the scalar-FK shape (see §5 where-shape translation):
    update: ({ session }) => ({ authorId: { equals: session?.userId } }),
  },
}
```

Access-controlled operations **fail silently**: a denied read returns `null` (single) or `[]` (list), and a denied write returns `null` — they never throw. Keep your null-guards. See [Access Control](/docs/core-concepts/access-control) for the full model.

---

## 5. Replacing `context.graphql.run` with `context.db.*` + fragments

This is the largest API change. OpenSaaS Stack has **no GraphQL layer** ([ADR-0005](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0005-no-graphql-layer-migrate-via-fragments.md)). It provides first-class TypeScript utilities — `defineFragment`, `runQuery` / `runQueryOne`, and `ResultOf` — that give you fragment reuse, composability, and inferred result types **without** GraphQL or a codegen step. Everything still runs through `context.db`, so access control is enforced automatically.

### Concept mapping

| Keystone                                             | OpenSaaS Stack                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| GraphQL fragment string                              | `defineFragment<T>()(fields)`                                      |
| `ResultOf<typeof query>` (codegen)                   | `ResultOf<typeof fragment>` (built-in)                             |
| `VariablesOf<typeof query>`                          | Plain function params / `where` args (or a fragment factory)       |
| `context.graphql.run({ query, variables })` — list   | `context.db.post.findMany({ query: fragment, where?, … })`         |
| `context.graphql.run({ query, variables })` — single | `context.db.post.findUnique({ where: { id }, query: fragment })`   |
| `context.query.PostList.findMany(...)`               | `context.db.post.findMany(...)`                                    |
| `context.sudo().graphql.run(...)`                    | `context.sudo().db.post.findMany(...)`                             |
| Nested relationship filtering                        | `RelationSelector`: `{ query: fragment, where?, orderBy?, take? }` |

### Quick before/after

```typescript
// Before (Keystone)
const { posts } = await context.graphql.run({
  query: `query { posts(where: { published: true }) { id title author { id name } } }`,
})

// After (OpenSaaS Stack)
import type { Post, User } from '.prisma/client'
import { defineFragment, type ResultOf } from '@opensaas/stack-core'

const authorFragment = defineFragment<User>()({ id: true, name: true } as const)
const postFragment = defineFragment<Post>()({
  id: true,
  title: true,
  author: authorFragment, // nested — access-controlled include
} as const)

type PostData = ResultOf<typeof postFragment>
// → { id: string; title: string; author: { id: string; name: string } | null }

const posts = await context.db.post.findMany({
  query: postFragment,
  where: { published: true },
})
// posts: PostData[]
```

See [Queries & Fragments](/docs/core-concepts/queries) for the complete reference on `defineFragment`, `runQuery` / `runQueryOne`, `ResultOf`, nested `RelationSelector` filtering, and fragment factories for runtime variables.

### The four hard parts — the `migrate-context-calls` skill

Mechanical CRUD is easy; the cases migrators trip on are documented as worked, before/after recipes in the **`migrate-context-calls`** skill (in the `opensaas-migration` plugin). Rather than duplicate them here, this guide summarises and links to them:

- **Recipe 1 — `where`-shape translation.** Keystone nests relation filters even on a foreign key (`{ author: { id: { equals: $id } } }`); Prisma exposes the scalar FK directly (`{ authorId: { equals: $id } }`). To-many relations use `some` / `every` / `none`, and Keystone's bare enum identifiers (`status: published`) become **string literals** (`status: 'published'`).
- **Recipe 2 — `connect` / `disconnect` / `set` nested writes.** `data` is passed straight through to Prisma, so use Prisma's relation-operation shapes; `set: []` clears a to-many relation, and you never write the scalar `<field>Id` directly (it is silently stripped).
- **Recipe 3 — gql.tada typed documents → `defineFragment` + `ResultOf`.** Replace the typed document with a typed fragment; `VariablesOf` has no equivalent (use function params or a fragment factory).
- **Recipe 4 — fragment → Prisma `include` / `select` + null-on-access-denied.** A fragment maps onto a Prisma `include`; denied nested single relations come back `null`, denied to-many records are dropped from the array. Keep your Keystone null-guards (`post.author?.name`).

Install the plugin and run the skill (see [Tooling](#tooling-cli-agent-plugin)); it searches the project for `context.graphql` / `context.query` and rewrites each call site.

---

## 6. Relationships and many-to-many join tables

`relationship()` supports two `ref` formats: `'ListName.fieldName'` (bidirectional, both sides declare the field) and `'ListName'` (list-only, only one side declares it — the stack synthesises the back-relation). This matches Keystone's behaviour.

### Join-table naming (critical for data preservation)

Keystone and Prisma use **different** implicit join-table naming for many-to-many relations. Without adjustment, `prisma db push` on a migrated schema creates **new empty join tables** while your data stays in the old ones.

- **Keystone convention:** `_<FieldLocation>_<fieldName>` (e.g. `_Post_tags`)
- **Prisma default:** alphabetically sorted `_<AToB>` (e.g. `_PostToTag`)

Preserve the Keystone names globally:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    joinTableNaming: 'keystone', // preserve Keystone join-table names
    prismaClientConstructor: (PrismaClient) => {
      /* ... */
    },
  },
})
```

Or per-relationship (only one side needs it):

```typescript
tags: relationship({
  ref: 'Tag.posts',
  many: true,
  db: { relationName: 'Post_tags' }, // Prisma creates join table _Post_tags
})
```

Per-field `db.relationName` overrides the global `joinTableNaming`. If both sides set it, they must match. See [Generators](/docs/core-concepts/generators) for the full naming model.

---

## 7. Hook migration

Most hooks map directly by name. The Keystone hooks API is honoured; the only addition is `resolveOutput` (transforming read values). The **timing semantics** are worth understanding: OpenSaaS Stack runs list-level and field-level hooks in a single defined pipeline.

| Keystone hook     | OpenSaaS Stack equivalent                            |
| ----------------- | ---------------------------------------------------- |
| `resolveInput`    | `resolveInput` (list + field level)                  |
| `validateInput`   | `validate` (or `validateInput` for backwards compat) |
| `beforeOperation` | `beforeOperation` (list + field level)               |
| `afterOperation`  | `afterOperation` (list + field level)                |
| _(none)_          | `resolveOutput` — new; transforms read values        |

### Pipeline order (write — create/update)

The stack runs a precise, Keystone-compliant order so you can predict where a transform vs a side effect lands:

1. List `resolveInput`
2. Field `resolveInput` (e.g. hash a password)
3. List `validate`
4. Field validation (built-in `isRequired`, `length`, `min` / `max`)
5. Field-level access control (filter writable fields)
6. Field `beforeOperation`
7. List `beforeOperation`
8. **Database operation**
9. List `afterOperation`
10. Field `afterOperation`

### Pipeline order (read — query)

1. **Database operation**
2. Field-level access control (filter readable fields)
3. Field `resolveOutput`

### `validateInput` → `validate`

```typescript
// Keystone
hooks: {
  validateInput: ({ resolvedData, addValidationError }) => {
    if (!resolvedData.title) addValidationError('Title is required')
  },
}

// OpenSaaS Stack — preferred name (validateInput still works as an alias)
hooks: {
  validate: ({ resolvedData, addValidationError }) => {
    if (!resolvedData.title) addValidationError('Title is required')
  },
}
```

Hook arguments are Keystone-compliant: `inputData`, `resolvedData`, `item` (the existing record on update/delete), `originalItem` (in `afterOperation`), `operation`, `listKey`, and `context`. Field-level hooks additionally receive `fieldKey`. See [Hooks System](/docs/core-concepts/hooks) for the complete argument reference and the `originalItem` comparison pattern.

---

## 8. Image and file fields

Keystone stores image metadata across **7 columns** per field and file metadata across **3 columns**. OpenSaaS Stack's `image()` / `file()` fields (from `@opensaas/stack-storage/fields`) default to a single `Json?` column for greenfield projects, **but** they ship a **non-destructive multi-column parity mode** that maps directly onto the existing Keystone columns in place — no data migration, no dropped columns, no re-upload of existing assets ([ADR-0006](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0006-image-file-migration-prefers-multi-column-parity.md)).

The recommended path is multi-column mode via `db.columns: 'keystone'`:

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

Teacher: list({
  fields: {
    name: text({ validation: { isRequired: true } }),
    avatar: image({ storage: 'images', db: { columns: 'keystone' } }), // maps onto avatar_url, avatar_width, …
    resume: file({ storage: 'files', db: { columns: 'keystone' } }), // maps onto resume_filename, resume_filesize, resume_url
  },
})
```

The full recipe — overriding individual column names, the destructive single-`Json?` consolidation alternative (with backup steps and SQL for Postgres/MySQL/SQLite), storage providers (local, S3, Vercel Blob), and the no-re-upload guarantee — is the dedicated [Keystone Image & File Field Migration guide](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-image-migration.md). For configuring storage providers generally, see [Storage Setup](/docs/guides/storage-setup) and the [Storage package](/docs/packages/storage).

---

## 9. Authentication

Replace `@keystone-6/auth` with the [auth plugin](/docs/guides/authentication) (`@opensaas/stack-auth`, built on Better Auth). The config shape changes but the concepts are the same.

```typescript
// Keystone
import { createAuth } from '@keystone-6/auth'
const { withAuth } = createAuth({
  listKey: 'User',
  identityField: 'email',
  secretField: 'password',
})

// OpenSaaS Stack
import { authPlugin } from '@opensaas/stack-auth'
export default config({
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
  // ...
})
```

The auth plugin auto-injects the **Auth lists** (User, Session, Account, Verification) and wires Better Auth's OAuth and session management.

### Already running Better Auth?

If you are migrating a project that **already has live Better Auth tables** (typically in a separate `auth` schema, with an app `User` that is distinct from the auth identity), do **not** recreate them. Adopt the live tables in place with the `adoptBetterAuthTables()` recipe — it models them for runtime and types with **no destructive auth migration** and keeps your domain `User` separate from the Auth identity ([ADR-0007](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0007-auth-plugin-mirrors-better-auth-and-adopts-existing-tables.md)).

The full recipe (defaults, customising schema/model names/column renames, and how to link your app `User` to the Auth identity) is in [Adopting an Existing Better Auth Installation](/docs/guides/authentication#adopting-an-existing-better-auth-installation).

---

## 10. Multi-schema preservation and admin-UI parity

### Multi-schema (Postgres)

If your Keystone database splits tables across Postgres schemas (e.g. a separate `auth` schema), preserve that layout with `db.schemas` plus per-list `db.schema`:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    schemas: ['public', 'auth'], // enables Prisma multiSchema + the schemas array
    prismaClientConstructor: (PrismaClient) => {
      /* ... */
    },
  },
  lists: {
    AuthUser: list({
      fields: {
        /* ... */
      },
      db: { schema: 'auth', map: 'user' },
    }),
    Post: list({
      fields: {
        /* ... */
      },
    }), // defaults to public
  },
})
```

`db.schema` adds `@@schema(...)` to a model and `db.map` adds `@@map(...)` for a differing physical table name — both are essential when adopting an existing layout. The `adoptBetterAuthTables()` recipe (§9) sets these for the auth tables automatically.

### Admin-UI parity

The admin UI is auto-generated from the same config — there is no separate admin schema to migrate. Field labels, display modes, and ordering come from each field's `ui` options (which mirror Keystone's `ui` config), and access control automatically hides lists/fields/operations the session can't use. Mount it once:

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

Custom Keystone admin views map onto the [composable UI](/docs/guides/composability) and [custom field components](/docs/guides/custom-fields).

---

## 11. Side-by-side coexistence (configurable output paths)

During the cut-over you often want OpenSaaS Stack to run **alongside** the existing Keystone app without clobbering its `prisma/` directory or generated files. Relocate the generator's output with the `output` block:

```typescript
export default config({
  output: {
    prismaSchema: 'prisma-opensaas/schema.prisma', // default: prisma/schema.prisma
    opensaasDir: '.opensaas', // default: .opensaas
  },
  db: {
    /* ... */
  },
  // ...
})
```

Both paths are resolved relative to the project root. The generated files' cross-references follow these locations automatically — `context.ts` imports the generated types/lists from the resolved `.opensaas` dir, and the top-level `prisma.config.ts` points the Prisma CLI at the configured schema path — so `prisma generate` / `db push` keep working against the relocated schema while Keystone's own `prisma/` is untouched. (`prisma.config.ts` itself is always written at the project root and is not relocatable.)

---

## 12. Migration checklist

Work through this in order. Each step links to the relevant section above.

1. **[ ] Install packages** — replace `@keystone-6/core` (and `@keystone-6/auth`) with `@opensaas/stack-core`, `@opensaas/stack-core/fields`, and (if needed) `@opensaas/stack-auth`, `@opensaas/stack-storage`, and the right `@prisma/adapter-*`.
2. **[ ] Convert config** — fold `schema.ts` + `keystone.ts` into one `opensaas.config.ts` (§1), add `prismaClientConstructor` (Prisma 7).
3. **[ ] Map fields** — translate field builders (§2); set `select` `db` options and other parity knobs as needed.
4. **[ ] Set generator parity** — `keystoneCompat`, `timestamps`, `joinTableNaming`, and `select` `db.isNullable` / `db.enumName` to match the live schema (§3, §6).
5. **[ ] (Optional) Relocate output** — set `output.prismaSchema` / `output.opensaasDir` for coexistence (§11).
6. **[ ] Generate** — `pnpm opensaas generate && npx prisma generate`.
7. **[ ] Verify the diff** — `prisma migrate diff` (Postgres/MySQL) or `prisma db push` (SQLite dev) shows **no destructive changes** (§3).
8. **[ ] Migrate images/files** — set `db.columns: 'keystone'` on `image()` / `file()` (§8).
9. **[ ] Adopt auth** — `authPlugin` + `adoptBetterAuthTables()` if Better Auth is already live (§9).
10. **[ ] Replace data access** — run the `migrate-context-calls` skill to convert `context.graphql.run` / `context.query.*` to `context.db.*` + fragments (§5).
11. **[ ] Migrate hooks** — rename `validateInput` → `validate` where desired (§7).
12. **[ ] Wire the admin UI** — mount `AdminUI` (§10).
13. **[ ] Lint, format, test** — `pnpm lint && pnpm format && pnpm test`.

---

## Tooling: CLI + agent plugin

You don't have to do this by hand. The CLI analyses your project and points you at this guide and the agent plugin:

```bash
# From your Keystone project root
npx @opensaas/stack-cli migrate --type keystone
# or, with Claude Code integration wired up automatically:
npx @opensaas/stack-cli migrate --with-ai
```

The `opensaas-migration` Claude Code plugin ships the migration skills — including `migrate-context-calls` (§5), `migrate-image-fields` (§8), `migrate-imports`, and the virtual-/document-field skills. Install it manually inside Claude Code with:

```text
/plugin marketplace add OpenSaasAU/stack
/plugin install opensaas-migration@opensaas-stack-marketplace
```

`migrate --with-ai` wires the marketplace and plugin into `.claude/settings.json` for you.

## Where to go next

- **[Migration Guide](/docs/guides/migration)** — the general AI-assisted walkthrough (Prisma / Next.js / Keystone sources).
- **[Queries & Fragments](/docs/core-concepts/queries)** — the `context.graphql.run` replacement in full.
- **[Field Types](/docs/core-concepts/field-types)** — every built-in field's options.
- **[Access Control](/docs/core-concepts/access-control)** and **[Hooks System](/docs/core-concepts/hooks)** — the patterns shared with Keystone.
- **[Authentication](/docs/guides/authentication)** — the auth plugin and Better Auth adoption.
- **[Generators](/docs/core-concepts/generators)** — schema generation, parity knobs, and `extendPrismaSchema`.

For the original design notes behind this guide, see the [Keystone migration design notes](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-migration.md).
