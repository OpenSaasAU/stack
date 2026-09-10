# Migrating from KeystoneJS

This is the **canonical, single source of truth** for migrating a KeystoneJS 6 project to Stack. It is written for both human developers and migration agents. KeystoneJS and Stack share a config-first philosophy, Keystone-compliant hooks, and the same access-control shape, so most concepts map across directly — and the generator is deliberately tuned for **Schema parity** so an existing database migrates without destructive changes.

{% callout type="info" %}
This page consolidates the full Keystone migration story. The general, multi-source ([Prisma / Next.js / Keystone](/docs/how-to/migrate)) AI-assisted walkthrough lives in the [Migration Guide](/docs/how-to/migrate); the detailed image/file and auth-adoption recipes are linked (not duplicated) from here so there is one place each fact is maintained.
{% /callout %}

## Overview of differences

| Concern                 | KeystoneJS 6                       | Stack                                                                    |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Schema definition       | `list()` in `schema.ts`            | `list()` in `opensaas.config.ts`                                         |
| Database                | Prisma (managed by Keystone)       | Postgres only; the connection comes from the environment, not the config |
| Access control          | Functions on the `access` key      | Operation functions that return a boolean **or** a filter                |
| Hooks                   | `resolveInput`, `validateInput`, … | Same names + `resolveOutput`                                             |
| GraphQL API             | Built-in, always on                | **Not provided** (ADR-0005) — migrate to composed `context.db.*` reads   |
| `context.graphql.run()` | Run raw GraphQL queries            | `context.db.<List>` composed reads, narrowed with `.select()`            |
| Type generation         | GraphQL codegen                    | Built-in TypeScript inference from the generated list types              |
| Many-to-many            | Implicit join table                | **Refused** — author the junction as its own list                        |
| Auth                    | `@keystone-6/auth`                 | `@opensaas/stack-auth` (Better Auth)                                     |
| Image / file fields     | Multi-column metadata              | Multi-column parity mode or single `Json?` column                        |
| Admin UI                | Auto-generated from schema         | Auto-generated from config                                               |

## The migration in five moves

1. **Config** — translate `schema.ts` + `keystone.ts` into one `opensaas.config.ts`.
2. **Generator parity** — set the generator to match your live schema so `prisma migrate diff` shows no destructive changes.
3. **Data access** — replace `context.graphql.run` / `context.query.*` with composed `context.db.*` reads.
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

### Stack (`opensaas.config.ts`)

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, relationship, timestamp } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
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
- The `db` block is required, but it carries only the shape of the database — `provider: 'postgresql'` and optional keys like `idField`, `timestamps`, `schemas` and `extensions`. There is no connection string and no client constructor: the connection is resolved from `DIRECT_DATABASE_URL`, then `DATABASE_URL`, then the local Dev database. Postgres is the only provider, so a Keystone project on SQLite or MySQL ports its data to Postgres as part of the migration. See [Config API](/docs/reference/config-api).
- Field builders import from `@opensaas/stack-core/fields` (not `@keystone-6/core/fields`).
- List names stay **PascalCase** (`Post`, `User`), and that same key is what you query: `context.db.Post`. There is no case conversion — a camelCase key is a compile error.

---

## 2. Field-type mapping

Most Keystone field builders have a same-named OpenSaaS equivalent. The validation and UI options carry across with the same names.

| Keystone field   | Stack field                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text()`         | `text()`                                          | `validation.isRequired` / `validation.length`, `isIndexed` carry across.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `integer()`      | `integer()`                                       | `validation.isRequired` / `min` / `max`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `float()`        | `decimal()`                                       | **No `float()` builder.** `decimal()` is a _type change_, not 1:1 parity: the column goes from `Float` (double) to `Decimal(p, s)` and the runtime value from `number` to a `decimal.js` `Decimal`. Choose `precision` / `scale` (defaults `18, 4`) wide enough for your existing values and review for rounding/precision differences.                                                                                                                                                                               |
| `decimal()`      | `decimal()`                                       | `defaultValue`, `min` / `max` are strings (precision-safe).                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bigInt()`       | `bigInt()`                                        | Prisma `BigInt`, TypeScript `bigint`. The migration introspector maps Prisma `BigInt` to `bigInt()` directly — no `text()` fallback. Accepts `bigint` / integer `number` / numeric `string` on write; a `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than silently losing precision. Don't reach for `integer({ db: { nativeType: … } })` instead: a native-type override changes the column, not the field's TypeScript type, which stays `number` and loses the precision `bigInt()` exists to keep. |
| `checkbox()`     | `checkbox()`                                      | `defaultValue: true / false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `timestamp()`    | `timestamp()`                                     | `defaultValue: { kind: 'now' }` or a `Date`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `calendarDay()`  | `calendarDay()`                                   | Date-only string field.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `password()`     | `password()`                                      | Excluded from reads; hash via field `resolveInput`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `select()`       | `select()`                                        | `options`, `db.type: 'enum'`, `db.enumName`, `db.isNullable` — see §3.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `relationship()` | `relationship()`                                  | `ref` format differs slightly — see §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `json()`         | `json()`                                          | Honours `defaultValue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `virtual()`      | `virtual()`                                       | Provide `type` (TS output type) + a `resolveOutput` hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `image()`        | `image()` from `@opensaas/stack-storage/fields`   | Multi-column parity mode — see §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `file()`         | `file()` from `@opensaas/stack-storage/fields`    | Multi-column parity mode — see §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `document()`     | `richText()` from `@opensaas/stack-tiptap/fields` | Rich-text editor; see [Tiptap](/docs/reference/tiptap).                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

{% callout type="info" %}
For the complete option reference on every built-in field, see [Field Types](/docs/concepts/field-types). To build a field type that has no built-in equivalent, see [Custom Fields](/docs/how-to/custom-fields).
{% /callout %}

---

## 3. Generator parity (matching your live schema)

The generator's defaults are deliberately tuned so a Keystone database migrates without destructive schema changes (**Schema parity**; see [ADR-0004](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0004-generator-emits-keystone-compatible-defaults.md)). Understanding these knobs is the difference between a clean `prisma migrate diff` and an accidental column drop.

### `defaultValue` is honoured

`text()`, `integer()`, and `json()` (and `checkbox()` / `decimal()`) carry their `defaultValue` through to the column's default, so a default Keystone had survives the migration without any escape hatch:

```typescript
views: integer({ defaultValue: 0 }),
role: text({ defaultValue: 'member' }),
```

### Auto-timestamps are OFF by default

The generator does **not** append `createdAt` / `updatedAt` to every model — matching Keystone 6, which never adds them automatically. `db.timestamps: true` opts every list in:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    timestamps: true,
  },
  lists: {/* ... */},
})
```

A per-list `db.timestamps` wins over the global setting, so a single list can opt out again:

```typescript
Production: list({
  fields: { name: text() },
  db: { timestamps: false },
})
```

When timestamps resolve to on **and** a list already declares its own `createdAt` / `updatedAt`, the auto column is skipped for the declared field(s) so the schema never carries a duplicate column. If your Keystone lists declared timestamps explicitly, keep declaring them as fields and leave `db.timestamps` off.

One behavioural difference to plan for: `createdAt` takes a database default, but `updatedAt` is maintained application-side with no database backstop. A write that goes around the secured surface — a raw SQL statement, an unsafe-surface write, a data-migration script — will not move it. That matters most during a migration, when data is loaded outside the ORM; the full statement of the cost, including what to do if you need a database-enforced modification time, is at [Cost: `updatedAt` is application-side](/docs/reference/config-api#cost-updatedat-is-application-side).

### Keystone-compat mode: empty-string text defaults

Keystone 6 gives every non-null text column an implicit empty-string default. Turn on `keystoneCompat` so the generator mirrors that, instead of hand-setting `defaultValue: ''` on dozens of columns:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    keystoneCompat: true,
  },
  lists: {/* ... */},
})
```

The flag is opt-in (a greenfield project would not want it) and only affects **non-null** text columns with **no explicit `defaultValue`**. An explicit `text({ defaultValue: 'x' })` always wins, and nullable text / non-text fields are untouched.

It also stops short of any column whose own create validator would refuse the default: a column default drops the field from the required half of the generated create input, and the value the database inserts is never seen by validation. So `validation: { isRequired: true }` and `validation: { length: { min: N } }` with `N` above zero get **no** default — the first refuses the omission, the second refuses the `''`. Those are Keystone's commonest text columns, so expect `DROP DEFAULT` for them in the first `migrate diff`. Closing that gap means relaxing the field's validation as well as setting `defaultValue: ''` on it, because the explicit spelling is refused for the same reason.

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
    type: 'enum',
    enumName: 'AccountNoteStatusType',
    isNullable: true,
  },
})
```

That declares a native enum type named `AccountNoteStatusType` over the two values, and a nullable column defaulting to `open`.

- `db.type: 'enum'` generates a native enum type; the default is a plain string column.
- `db.enumName` overrides the derived `<List><Field>` enum name — useful for Keystone's `…Type` suffix.
- `db.isNullable: true` forces a nullable column even when a `defaultValue` is present (so a live column containing NULLs migrates without a NOT NULL failure). Without it, a select with a default is `NOT NULL`.

### Verifying parity

Generate, then read the plan before anything touches the live database:

```bash
pnpm opensaas generate
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/contract.ts \
  --script
```

For the day-to-day loop, `opensaas dev` does the same job with a shorter feedback cycle: it generates, plans the reconcile, and **stops** on a destructive plan — printing it and leaving both the generated bundle and the database at the previous schema. That printout is the parity check. Apply a plan you have read and accepted with `pnpm db:update --confirm <database-name>`, which requires the loop to be running.

There is no `extendPrismaSchema` escape hatch, at either config or field level. What used to need one is now a first-class option: column-level shape on the field's own `db` block (`map`, `isNullable`, `nativeType`), referential actions on a relationship's `db` (`onDelete`, `onUpdate`, `foreignKey`), model-level shape on the list's `db` (`map`, `schema`, `indexes`, `idField`), and extension packs on `db.extensions`. If a live schema needs something outside that set, the migration is the place to reshape the database rather than the generator.

---

## 4. Access control

Access rules keep the same argument shape, but Keystone's three separate blocks collapse into one. There is **no `access: { filter }`** and no list-level `access: { fields }`: a rule scopes an operation by _returning_ a filter from its `operation.*` function rather than being declared in a second place.

| Keystone access                                                | Stack                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `access.operation.{query,create,update,delete}`                | Same — `access: { operation: { … } }`                              |
| `access.filter.{query,update,delete}` returning a `where`      | The same operation function, returning a filter instead of `true`  |
| `access.item.*`                                                | Operation function with `item` arg (`({ session, item }) => …`)    |
| Field access `access.read` / `access.create` / `access.update` | Field-level `access` with the same keys — **boolean results only** |

Keystone's example below splits an operation check from a filter; Stack folds both into `operation.query`. Note the shape change on the filter itself: Keystone nests a relation filter even for a foreign key, while a Stack filter names the scalar FK column directly.

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

// Stack
access: {
  operation: {
    query: ({ session }) =>
      session?.userId ? { authorId: { equals: session.userId } } : false,
    update: ({ session }) =>
      session?.userId ? { authorId: { equals: session.userId } } : false,
  },
}
```

Two rules to carry across from Keystone habits:

- **`create` takes a boolean and nothing else.** There is no row to scope, so a rule that returns a filter throws rather than being read as an allow. Scope a create in a `resolveInput` or `validate` hook, where the input data is in scope.
- **Never let a filter value be `undefined`.** `({ session }) => ({ authorId: { equals: session?.userId } })` is a fail-open bug in Keystone's shape and is refused outright here — a `ValidationError`, not a silently dropped clause. Guard on the value, as above, and return `false` when it is missing.

Access-controlled operations **fail silently**: a denied read returns `null` (single) or `[]` (list), a denied aggregate answers `0` under every key, and a denied write returns `null` — they never throw. Keep your null-guards. See [Access Control](/docs/concepts/access-control) for the full model.

---

## 5. Replacing `context.graphql.run` with `context.db.*`

This is the largest API change. Stack has **no GraphQL layer** ([ADR-0005](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0005-no-graphql-layer-migrate-via-fragments.md)). A read is composed on `context.db.<List>` — an immutable query value — and narrowed with `.select()`, which the engine honours exactly. Composability comes from the value itself, and the result type from the generated list types, so there is no fragment to declare and no codegen step. Everything runs through the secured terminals, so access control is enforced automatically.

### Concept mapping

| Keystone                                             | Stack                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| GraphQL fragment string                              | `.select('id', 'title')` on the read itself                       |
| `ResultOf<typeof query>` (codegen)                   | inferred from the generated list types                            |
| `VariablesOf<typeof query>`                          | Plain function params / `where` args                              |
| `context.graphql.run({ query, variables })` — list   | `context.db.Post.where(…).select(…).all()`                        |
| `context.graphql.run({ query, variables })` — single | `context.db.Post.where({ id: { equals: id } }).select(…).first()` |
| `context.query.Post.findMany(...)`                   | `context.db.Post.where(…).all()`                                  |
| `context.sudo().graphql.run(...)`                    | `context.sudo().db.Post.all()`                                    |
| Nested relationship filtering                        | `.include('comments', (comments) => comments.where(…).select(…))` |

### Quick before/after

```typescript
// Before (Keystone)
const { posts } = await context.graphql.run({
  query: `query { posts(where: { published: true }) { id title author { id name } } }`,
})

// After (Stack)
const posts = await context.db.Post.where({ published: { equals: true } })
  .select('title')
  .include('author', (author) => author.select('name'))
  .all()
```

Each row carries the selected columns plus the list's system fields, and `author` arrives as the included row **or `null`** — arity decides that, not the foreign key's nullability, so `post.author?.name` stays a null-check even against a `NOT NULL` column.

See [Queries & projections](/docs/concepts/queries) for the complete reference on `.select()`, `.include()` refinements, and what a computed field's hook is handed.

### The `where` vocabulary is a closed set

The operators a filter may use are `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte` and `contains`, plus the relation quantifiers `some`, `every` and `none` — the same three for a to-one relation as for a to-many. A bare value means equality, and `contains` is case-insensitive.

Three Keystone/Prisma habits do not survive the translation:

- **`startsWith`, `endsWith` and `mode: 'insensitive'` do not exist.** They are refused, including under `sudo()` — `sudo` skips access, not validation.
- **`undefined` is refused**, never dropped. This is the fail-closed rule that turns a would-be open read into an error.
- **`orderBy` sorts by scalar columns only.** Naming a relationship throws.

### Writes: an args object and an identity-only `where`

`create({ data })`, `update({ where, data })` and `delete({ where })` each take one args object. The composed read's `where` never feeds a write — there is no `.where({ id }).update(data)` form — and a write's `where` is **identity-only**: exactly the key `id`, with a `string` or `number`. Targeting a row by a secondary unique column is a compile error, and the check runs before the access gate.

Relation input changes shape too. On the side that owns the foreign key, the field takes `{ connect: { id } }` to point the edge somewhere, or `null` to clear it. **There is no `disconnect`** — and no `set`, no `connectOrCreate`, no nested `create` / `update` / `delete` / `updateMany` / `deleteMany`. All of those are compile errors on the generated input types and refusals at runtime. Spelling one edge both ways (`author` and `authorId` in the same write) is refused as a conflict, and a `connect` target this session cannot read makes the whole write return `null` — one indistinguishable answer.

```typescript
const post = await context.db.Post.update({
  where: { id: postId },
  data: { author: { connect: { id: newAuthorId } } },
})
if (!post) return { error: 'Not found or not permitted' }

const orphaned = await context.db.Post.update({
  where: { id: postId },
  data: { author: null },
})
if (!orphaned) return { error: 'Not found or not permitted' }
```

Every write result is `T | null` for the same reason every `first()` is: the row may not exist, or it may exist and not be yours, and the two answers are deliberately indistinguishable.

### The remaining hard parts — the `migrate-context-calls` skill

The cases migrators trip on are documented as worked, before/after recipes in the **`migrate-context-calls`** skill (in the `opensaas-migration` plugin). Rather than duplicate them here, this guide summarises and links to them:

- **Recipe 1 — `where`-shape translation.** Keystone nests relation filters even on a foreign key (`{ author: { id: { equals: $id } } }`); a Stack filter names the scalar FK directly (`{ authorId: { equals: $id } }`). To-many relations use `some` / `every` / `none`, and Keystone's bare enum identifiers (`status: published`) become string literals (`status: 'published'`).
- **Recipe 2 — Keystone's `connect` / `disconnect` / `set` nested writes.** Every one of them becomes either `{ connect: { id } }` on the owning side, `null` to clear, or an explicit write against the junction list where Keystone used a to-many `set`.
- **Recipe 3 — gql.tada typed documents → a composed read.** Replace the typed document with a read narrowed by `.select()`; `VariablesOf` has no equivalent (use function params).
- **Recipe 4 — fragment → `.select()` / `.include()` + null-on-access-denied.** A fragment's scalars map onto `.select()` and its relations onto `.include()`; denied nested single relations come back `null`, denied to-many records are dropped from the array. Keep your Keystone null-guards (`post.author?.name`).

Install the plugin and run the skill (see [Tooling](#tooling-cli-agent-plugin)); it searches the project for `context.graphql` / `context.query` and rewrites each call site.

---

## 6. Relationships and the junction list

`relationship()` supports two `ref` formats: `'ListName.fieldName'` (bidirectional, both sides declare the field) and `'ListName'` (list-only, only one side declares it — the stack synthesises the back-relation). This matches Keystone's behaviour.

A relationship's `db` block carries `isNullable`, `foreignKey`, and the referential actions `onDelete` and `onUpdate`, each one of `'cascade'`, `'restrict'`, `'noAction'`, `'setNull'` or `'setDefault'`:

```typescript
author: relationship({ ref: 'User.posts', db: { onDelete: 'setNull' } })
```

### Many-to-many: the implicit join table becomes a real model

This is the change most likely to bite a Keystone migration. **Implicit many-to-many is refused.** A config with `many: true` on both ends of a relationship — or `many: true` against a list-only ref — fails `opensaas generate` with an error naming both ends and the fix. Keystone's `_Post_tags` table, which Prisma managed invisibly and neither of your configs mentioned, becomes a model you declare, name and own.

The junction is an ordinary list: a to-one relationship to each side, its own surrogate id, and a unique `db.indexes` entry over the two relationship fields so the same pair cannot be inserted twice. Both outer lists then point at the junction with `many: true`.

```typescript
Post: list({
  fields: {
    title: text({ validation: { isRequired: true } }),
    tags: relationship({ ref: 'PostTag.post', many: true }),
  },
}),
Tag: list({
  fields: {
    name: text({ validation: { isRequired: true } }),
    posts: relationship({ ref: 'PostTag.tag', many: true }),
  },
}),
PostTag: list({
  fields: {
    post: relationship({ ref: 'Post.tags' }),
    tag: relationship({ ref: 'Tag.posts' }),
  },
  db: {
    map: '_Post_tags',
    indexes: [{ fields: ['post', 'tag'], unique: true }],
  },
}),
```

The list's `db.map` is how the new model lands on the rows you already have: point it at the physical table Keystone created and no data moves. What the columns are called inside it is the one thing to check — Keystone's implicit join table uses Prisma's own column names (`A` and `B`) rather than `postId` / `tagId`, so each relationship field will also need `db: { foreignKey: { map: 'A' } }` to name the live column. Read the table rather than guessing which end is which.

Three things you get in exchange for the extra list, and they are the reason the refusal exists rather than an escape hatch:

- The junction can carry its own columns — an `addedAt`, an ordering, a role on the edge — without a schema migration later.
- The pairing is enforced by a real unique constraint you can see, name and adopt, rather than one Prisma derives.
- Access control and hooks apply to the edge itself, which under an implicit join table they could not.

`db.indexes` entries name the list's own field names, and the generator resolves a relationship field to its foreign-key column. `name` on an entry adopts an existing live constraint name — useful when the Keystone table already has one you want Prisma to keep. See [Config API](/docs/reference/config-api) for the full `db.indexes` rules.

---

## 7. Hook migration

Most hooks map directly by name. The Keystone hooks API is honoured; the only addition is `resolveOutput` (transforming read values). The **timing semantics** are worth understanding: Stack runs list-level and field-level hooks in a single defined pipeline.

| Keystone hook     | Stack equivalent                                     |
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

// Stack — preferred name (validateInput still works as an alias)
hooks: {
  validate: ({ resolvedData, addValidationError }) => {
    if (!resolvedData.title) addValidationError('Title is required')
  },
}
```

Hook arguments are Keystone-compliant: `inputData`, `resolvedData`, `item` (the existing record on update/delete), `originalItem` (in `afterOperation`), `operation`, `listKey`, and `context`. Field-level hooks additionally receive `fieldKey`. See [Hooks System](/docs/concepts/hooks) for the complete argument reference and the `originalItem` comparison pattern.

---

## 8. Image and file fields

Keystone stores image metadata across **7 columns** per field and file metadata across **3 columns**. Stack's `image()` / `file()` fields (from `@opensaas/stack-storage/fields`) default to a single `Json?` column for greenfield projects, **but** they ship a **non-destructive multi-column parity mode** that maps directly onto the existing Keystone columns in place — no data migration, no dropped columns, no re-upload of existing assets ([ADR-0006](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0006-image-file-migration-prefers-multi-column-parity.md)).

The recommended path is multi-column mode via `db.columns: 'keystone'`:

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

Teacher: list({
  fields: {
    name: text({ validation: { isRequired: true } }),
    avatar: image({ storage: 'images', db: { columns: 'keystone' } }),
    resume: file({ storage: 'files', db: { columns: 'keystone' } }),
  },
})
```

`columns: 'keystone'` maps each field onto the per-part columns Keystone already created — `avatar_url`, `avatar_width` and the rest for the image; `resume_filename`, `resume_filesize` and `resume_url` for the file — so nothing is dropped and nothing is re-uploaded.

The full recipe — overriding individual column names, the destructive single-`Json?` consolidation alternative (with backup steps and the consolidating SQL), storage providers (local, S3, Vercel Blob), and the no-re-upload guarantee — is the dedicated [Keystone Image & File Field Migration guide](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-image-migration.md). For configuring storage providers generally, see [Storage Setup](/docs/how-to/storage) and the [Storage package](/docs/reference/storage).

---

## 9. Authentication

Replace `@keystone-6/auth` with the [auth plugin](/docs/how-to/authentication) (`@opensaas/stack-auth`, built on Better Auth). The config shape changes but the concepts are the same.

```typescript
// Keystone
import { createAuth } from '@keystone-6/auth'
const { withAuth } = createAuth({
  listKey: 'User',
  identityField: 'email',
  secretField: 'password',
})

// Stack
import { authPlugin } from '@opensaas/stack-auth'
export default config({
  plugins: [authPlugin({ emailAndPassword: { enabled: true } })],
  // ...
})
```

The auth plugin auto-injects the **Auth lists** (User, Session, Account, Verification) and wires Better Auth's OAuth and session management.

### Already running Better Auth?

If you are migrating a project that **already has live Better Auth tables** (typically in a separate `auth` schema, with an app `User` that is distinct from the auth identity), do **not** recreate them. Adopt the live tables in place with the `adoptBetterAuthTables()` recipe — it models them for runtime and types with **no destructive auth migration** and keeps your domain `User` separate from the Auth identity ([ADR-0007](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0007-auth-plugin-mirrors-better-auth-and-adopts-existing-tables.md)).

The full recipe (defaults, customising schema/model names/column renames, and how to link your app `User` to the Auth identity) is in [Adopting an Existing Better Auth Installation](/docs/how-to/authentication#adopting-an-existing-better-auth-installation).

---

## 10. Multi-schema preservation and admin-UI parity

### Multi-schema (Postgres)

If your Keystone database splits tables across Postgres schemas (e.g. a separate `auth` schema), preserve that layout with `db.schemas` plus per-list `db.schema`:

```typescript
export default config({
  db: {
    provider: 'postgresql',
    schemas: ['public', 'auth'],
  },
  lists: {
    AuthUser: list({
      fields: {/* ... */},
      db: { schema: 'auth', map: 'user' },
    }),
    Post: list({
      fields: {/* ... */},
    }),
  },
})
```

`db.schemas` declares the namespaces the project uses; a list's own `db.schema` places its model in one of them, and `db.map` names a physical table that differs from the list key. A list that declares neither lands in `public`. Both are essential when adopting an existing layout, and the `adoptBetterAuthTables()` recipe (§9) sets them for the auth tables automatically.

### Admin-UI parity

The admin UI is auto-generated from the same config — there is no separate admin schema to migrate. Field labels, display modes, and ordering come from each field's `ui` options (which mirror Keystone's `ui` config), and access control automatically hides lists/fields/operations the session can't use.

Mount it once, on the generated `getContext()` and `config` — there is no separate admin-context helper, and the server action is one you own so that writes run under your own session resolution:

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

Custom Keystone admin views map onto the [composable UI](/docs/how-to/composability) and [custom field components](/docs/how-to/custom-fields).

---

## 11. Side-by-side coexistence (configurable output paths)

During the cut-over you often want Stack to run **alongside** the existing Keystone app without clobbering its `prisma/` directory or generated files. Relocate the generator's output with the `output` block:

```typescript
export default config({
  output: {
    contractModule: 'prisma-opensaas/contract.ts',
    opensaasDir: '.opensaas',
  },
  db: { provider: 'postgresql' },
  lists: {/* ... */},
})
```

`contractModule` defaults to `prisma/contract.ts` and `opensaasDir` to `.opensaas`; both are resolved relative to the project root. `contract.json` and `contract.d.ts` are emitted beside the contract module, so relocating it moves all three. The generated files' cross-references follow these locations automatically — `context.ts` imports the generated types and lists from the resolved `.opensaas` dir, and the top-level `prisma.config.ts` points the Prisma CLI at the configured contract path — so the stack's own commands keep working while Keystone's `prisma/` is untouched. (`prisma.config.ts` itself is always written at the project root and is not relocatable.)

---

## 12. Migration checklist

Work through this in order. Each step links to the relevant section above.

1. **[ ] Port the database to Postgres** — Postgres is the only provider, so a Keystone project on SQLite or MySQL moves its data first. Everything below assumes a Postgres instance you can point `DATABASE_URL` at.
2. **[ ] Install packages** — replace `@keystone-6/core` (and `@keystone-6/auth`) with `@opensaas/stack-core`, `@opensaas/stack-cli`, and (if needed) `@opensaas/stack-auth` and `@opensaas/stack-storage`.
3. **[ ] Convert config** — fold `schema.ts` + `keystone.ts` into one `opensaas.config.ts` (§1). The `db` block carries no connection string.
4. **[ ] Map fields** — translate field builders (§2); set `select` `db` options and other parity knobs as needed.
5. **[ ] Author the junctions** — every many-to-many becomes its own list with a unique `db.indexes` entry, mapped onto the live join table (§6). Generation fails until this is done.
6. **[ ] Set generator parity** — `keystoneCompat`, `timestamps`, and `select` `db.isNullable` / `db.enumName` to match the live schema (§3).
7. **[ ] (Optional) Relocate output** — set `output.contractModule` / `output.opensaasDir` for coexistence (§11).
8. **[ ] Generate** — `pnpm opensaas generate`.
9. **[ ] Verify the diff** — `prisma migrate diff`, or the plan `opensaas dev` prints, shows **no destructive changes** (§3).
10. **[ ] Migrate images/files** — set `db.columns: 'keystone'` on `image()` / `file()` (§8).
11. **[ ] Adopt auth** — `authPlugin` + `adoptBetterAuthTables()` if Better Auth is already live (§9).
12. **[ ] Replace data access** — run the `migrate-context-calls` skill to convert `context.graphql.run` / `context.query.*` to composed `context.db.*` reads (§5).
13. **[ ] Migrate hooks** — rename `validateInput` → `validate` where desired (§7).
14. **[ ] Wire the admin UI** — mount `AdminUI` (§10).
15. **[ ] Lint, format, test** — `pnpm lint && pnpm format && pnpm test`.

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

- **[Migration Guide](/docs/how-to/migrate)** — the general AI-assisted walkthrough (Prisma / Next.js / Keystone sources).
- **[Queries & projections](/docs/concepts/queries)** — the `context.graphql.run` replacement in full.
- **[Field Types](/docs/concepts/field-types)** — every built-in field's options.
- **[Access Control](/docs/concepts/access-control)** and **[Hooks System](/docs/concepts/hooks)** — the patterns shared with Keystone.
- **[Authentication](/docs/how-to/authentication)** — the auth plugin and Better Auth adoption.
- **[Config API](/docs/reference/config-api)** — every `db`, list and relationship option in full.
- **[Generators](/docs/concepts/generators)** — what `opensaas generate` emits.

For the original design notes behind this guide, see the [Keystone migration design notes](https://github.com/OpenSaasAU/stack/blob/main/specs/keystone-migration.md).
