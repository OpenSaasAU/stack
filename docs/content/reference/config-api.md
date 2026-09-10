# Config API Reference

Complete API reference for the Stack configuration system. For basic usage and examples, see the [Config System guide](/docs/concepts/config).

## Core Functions

### `config()`

Creates and validates a Stack configuration. Executes plugins if provided.

```typescript
import { config, list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({ fields: { title: text() } }),
  },
})
```

**Parameters:**

- `userConfig: OpenSaasConfig` - The configuration object

**Returns:**

- `OpenSaasConfig | Promise<OpenSaasConfig>` - Synchronous if no plugins, async if plugins are present

### `list()`

Defines a list (data model) with type-safe field definitions, access control, and hooks.

```typescript
import { list } from '@opensaas/stack-core'

User: list({
  fields: {/* ... */},
  access: {/* ... */},
  hooks: {/* ... */},
})
```

**Type Parameter:**

- `T` - The TypeScript type of items in this list (optional, auto-inferred from generated types)

**Parameters:**

- `config: object` - List configuration object

**Returns:**

- `ListConfig<T>` - Typed list configuration

---

## Configuration Types

### `OpenSaasConfig`

The root configuration object for your Stack application.

```typescript
export default config({
  db: DatabaseConfig,
  lists: Record<string, ListConfig>,
  session?: SessionConfig,
  ui?: UIConfig,
  mcp?: McpConfig,
  storage?: StorageConfig,
  opensaasPath?: string,
  output?: OutputConfig,
  plugins?: Plugin[],
})
```

#### Properties

##### `db` (required)

Database connection configuration.

**Type:** [`DatabaseConfig`](#databaseconfig)

##### `lists` (required)

Dictionary of list definitions. Keys must be in PascalCase (e.g., `Post`, `BlogPost`, `AuthUser`).

**Type:** `Record<string, ListConfig>`

**Example:**

```typescript
lists: {
  Post: list({ /* ... */ }),
  User: list({ /* ... */ }),
  BlogPost: list({ /* ... */ }),
}
```

##### `session`

Session configuration for authentication integration.

**Type:** [`SessionConfig`](#sessionconfig)

##### `ui`

Admin UI customization options.

**Type:** [`UIConfig`](#uiconfig)

##### `mcp`

Model Context Protocol server configuration for AI assistant integration.

**Type:** [`McpConfig`](#mcpconfig)

##### `storage`

File/image upload storage provider configuration.

**Type:** [`StorageConfig`](#storageconfig)

##### `opensaasPath`

Directory where the generated `.opensaas` bundle is placed (context, types, lists, plugin types, prisma extensions, and the patched Prisma client).

**Type:** `string`
**Default:** `".opensaas"`

> **Precedence:** This option still works exactly as before. When [`output.opensaasDir`](#outputconfig) is set, it takes precedence over `opensaasPath`. The effective bundle directory is `output.opensaasDir` (if set), else `opensaasPath` (if set), else the default `.opensaas`.

##### `output`

Relocate the generator's output so `opensaas generate` can coexist with an existing `prisma/` directory (for example during a KeystoneJS → stack migration) without clobbering it.

**Type:** [`OutputConfig`](#outputconfig)

##### `plugins`

Array of plugins to extend stack functionality.

**Type:** [`Plugin[]`](#plugin)

---

### `OutputConfig`

Configures where `opensaas generate` writes its output. All paths are resolved relative to the project root (the directory the CLI runs in). When omitted, the Contract module goes to `prisma/contract.ts` and the bundle to `.opensaas/`.

The generated files' cross-references follow these locations automatically — `context.ts` imports the project's `opensaas.config` and the emitted contract artifacts from the resolved directories, and the top-level `prisma.config.ts` points the Prisma CLI at the configured Contract module.

```typescript
output: {
  contractModule?: string,
  opensaasDir?: string,
}
```

#### Properties

##### `contractModule`

Path to the generated Contract module. `contract.json` and `contract.d.ts` are emitted into its directory.

**Type:** `string`
**Default:** `"prisma/contract.ts"`

##### `opensaasDir`

Directory for the generated `.opensaas` bundle: `types.ts`, `lists.ts`, `context.ts`, `plugin-types.ts` and `tables.ts`. Those file names are not configurable — only the directory holding them moves.

**Type:** `string`
**Default:** `".opensaas"`

> **Precedence with `opensaasPath`:** The effective bundle directory is resolved as `output.opensaasDir` > [`opensaasPath`](#opensaaspath) > the default `.opensaas`. `output.opensaasDir` overrides the pre-existing top-level `opensaasPath` when both are set; setting `opensaasPath` alone continues to relocate the bundle exactly as before.

**Example:**

```typescript
import { config } from '@opensaas/stack-core'

export default config({
  db: { provider: 'postgresql' },
  lists: {},
  output: {
    contractModule: 'prisma-opensaas/contract.ts',
    opensaasDir: 'generated/opensaas',
  },
})
```

---

### `DatabaseConfig`

Everything the stack needs to know about the database. There is **no connection URL here**: the runtime resolves it from the environment (see [Resolving the connection](#resolving-the-connection)), and nothing that merely loads the config opens a connection.

```typescript
type DatabaseConfig = {
  provider: 'postgresql'
  idField?: IdFieldStrategy
  extensions?: ExtensionDescriptor[]
  client?: DatabaseClientConfig
  schemas?: string[]
  timestamps?: boolean
  keystoneCompat?: boolean
  prismaGeneratorOptions?: {
    importFileExtension?: 'ts' | 'js'
    moduleFormat?: 'esm' | 'commonjs'
  }
}
```

That is the complete key list. A minimal config is one line:

```typescript
import { config } from '@opensaas/stack-core'

export default config({
  db: { provider: 'postgresql' },
  lists: {},
})
```

{% callout type="warning" %}
There is no `prismaClientConstructor`, no `db.url`, no `extendPrismaSchema`, no `joinTableNaming`, no `shadowDatabaseUrl` and no `useMigrations`. The client is built by the generated `.opensaas/context.ts` from the committed contract artifact; the schema is the contract, not a string to post-process.
{% /callout %}

#### Properties

##### `provider` (required)

**Type:** `'postgresql'`

A single literal, not a union. PostgreSQL is the only target: the secured surface's row lock, advisory locks, `ilike`-lowered `contains` and native vector columns all depend on it, and a portable subset of those is not the same feature.

##### `idField`

The id strategy every list gets unless it declares its own list-level `db.idField`.

**Type:** `'uuid7' | 'cuid2' | 'int autoincrement'`
**Default:** `'uuid7'`

```typescript
db: {
  provider: 'postgresql',
  idField: 'int autoincrement',
}
```

A [singleton list](#issingleton) derives its id from `isSingleton` and refuses this option.

##### `extensions`

Extension packs the contract declares. Each descriptor names a package; one declaration drives the contract module, `prisma.config.ts`, the runtime client, and the pack's own extension contract space under `migrations/`.

**Type:** `{ name: string; from: string }[]`

```typescript
db: {
  provider: 'postgresql',
  extensions: [{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }],
}
```

`name` is the binding that spells the pack's types on a field (`type.pgvector.Vector(n)`) and the identity two declarations merge on: the same `name` declared twice with a different `from` is a config error. A plugin adds its own through `PluginContext.addExtension`.

A declared pack must publish `/pack`, `/control` and `/runtime` subpaths, or `ExtensionSubpathError` names the one that is missing. Installing the extension in the database is part of [deployment](/docs/how-to/deploy).

##### `client`

Per-deployment pool binding for the generated runtime client. Nothing here reaches the contract — it is read only by `.opensaas/context.ts` when it constructs the client.

**Type:**

```typescript
type DatabaseClientConfig = {
  poolOptions?: PostgresOptionsBase['poolOptions']
  pg?: () => Pool
}
```

`pg` is a **factory, not an instance**. The config is loaded by the CLI and by tooling that never issues a query, and none of it should open a connection; the factory is called at most once, after the config promise resolves, under the runtime's client singleton.

```typescript
import { Pool, neonConfig } from '@neondatabase/serverless'
import ws from 'ws'

db: {
  provider: 'postgresql',
  client: {
    pg: () => {
      neonConfig.webSocketConstructor = ws
      return new Pool({ connectionString: process.env.DATABASE_URL })
    },
  },
}
```

Omit `client` entirely to let the runtime open its own pool from the resolved database URL. `resolveRuntimeConnection` from `@opensaas/stack-core/client` is what reads this key — see [building a second client synchronously](/docs/reference/context-api).

##### `schemas`

PostgreSQL multi-schema support: the schemas the datasource spans.

**Type:** `string[]`

```typescript
db: {
  provider: 'postgresql',
  schemas: ['public', 'auth'],
}
```

Combine with a per-list `db.schema` to place a model in a specific schema. When unset, everything lives in `public`.

##### `timestamps`

Auto-inject `createdAt` and `updatedAt` into every list.

**Type:** `boolean`
**Default:** `false`

```typescript
db: {
  provider: 'postgresql',
  timestamps: true,
}
```

Off by default, and deliberately: Keystone 6 never adds timestamps automatically either, which is what keeps a Keystone → stack migration non-destructive. A list opts in either by enabling this flag or by declaring the fields itself.

A per-list `db.timestamps` overrides the global setting. When timestamps are enabled but a list already declares its own `createdAt` or `updatedAt` field, the auto column is skipped for that field, so the contract never carries a duplicate column.

Both columns are then **system fields**: always readable, never writable through the secured surface, and always present in a projection.

###### Cost: `updatedAt` is application-side

`createdAt` takes a database `now()` default. `updatedAt` does not have a database backstop — it is maintained by the write pipeline, in the application ([ADR-0048](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0048-the-deleted-psl-constructs-become-config-defaults-not-ddl.md)).

Two consequences, both taken knowingly:

- **A write that bypasses the ORM leaves it stale.** `psql`, `opensaas db update`, and [the Unsafe surface](/docs/reference/context-api#the-unsafe-surface) all write the row without touching `updatedAt`.
- **`update({})` no longer moves it.** An update carrying no changed columns is not a write, so the timestamp does not advance. Code that used an empty update as a "touch" needs to set a column.

If you need a database-enforced modification time, add it yourself as a trigger in a migration and treat the column as read-only from the config's side.

##### `keystoneCompat`

Mirror Keystone 6's implicit empty-string default on non-null text columns, so a migrating project reaches schema parity without hand-setting `defaultValue: ''` across dozens of columns.

**Type:** `boolean`
**Default:** `false`

```typescript
db: {
  provider: 'postgresql',
  keystoneCompat: true,
}
```

It never affects nullable text, a field with an explicit `defaultValue`, or any non-text field.

**Known limit:** the flag is inert for `validation: { isRequired: true }` and for `validation: { length: { min: N } }` with `N > 0` — and `isRequired` is Keystone's commonest text column. Keystone renders both as `NOT NULL DEFAULT ''`, but here `''` is a value the field's own validator refuses, so carrying the default would write a row the config forbids. A migrating project sees `DROP DEFAULT` in `migrate diff` for those columns and has to relax the validation alongside setting the default. A column made non-null through `db: { isNullable: false }` alone still gets the default, as does one declaring `length: { min: 0 }` or a `length.max`.

##### `prismaGeneratorOptions`

Override the generator options the CLI emits for the `.opensaas` client subtree.

**Type:** `{ importFileExtension?: 'ts' | 'js'; moduleFormat?: 'esm' | 'commonjs' }`
**Default:** `{ importFileExtension: 'ts', moduleFormat: 'esm' }`

The defaults make the whole generated bundle statically resolvable and match the explicit `.ts` import-extension style the rest of `.opensaas` uses. Supply this only when a consumer needs a different module story. Any value you provide wins; omitted keys keep their default.

#### Resolving the connection

The connection URL is resolved at runtime, in this order:

1. `DIRECT_DATABASE_URL`
2. `DATABASE_URL`
3. the Dev database's state file, written by a running `opensaas dev`
4. otherwise `DatabaseUrlUnresolvedError`

`DIRECT_DATABASE_URL` wins so that a schema command reaches a direct connection rather than a pooler that cannot run DDL.

Two root exports read that order: `resolveDatabaseUrl()`, which throws when nothing resolves, and `findDatabaseUrl()`, which does not — the generated `prisma.config.ts` calls the second.

Provenance is load-bearing, not just a value: only when the URL came from the Dev database's state file does the generated context bind a single connection and skip the contract-marker read.

---

#### Referential actions

A relationship's `db` block carries the foreign key's shape. The actions are a typed union, in the ORM's own spelling, so the generated contract re-emits the value verbatim:

```typescript
type ReferentialAction = 'cascade' | 'restrict' | 'noAction' | 'setNull' | 'setDefault'
```

```typescript
import { list } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'

export const lists = {
  Post: list({
    fields: {
      title: text(),
      author: relationship({
        ref: 'User.posts',
        db: { foreignKey: true, isNullable: false, onDelete: 'cascade' },
      }),
    },
  }),
}
```

| Key          | Type                         | Meaning                                                     |
| ------------ | ---------------------------- | ----------------------------------------------------------- |
| `foreignKey` | `boolean \| { map: string }` | Which side owns the foreign-key column, or what to call it  |
| `isNullable` | `boolean`                    | Whether the column may be `NULL`                            |
| `onDelete`   | `ReferentialAction`          | What happens to this row when the referenced row is deleted |
| `onUpdate`   | `ReferentialAction`          | What happens when the referenced key changes                |

`foreignKey` carries two senses in one key. The **boolean** form answers "which side owns it", and is meaningful only on a bidirectional `ref: 'List.field'` — a list-only `ref: 'List'` always owns the foreign key, so a boolean there is rejected. The **`{ map }`** form renames the column without changing ownership, and works on both. That is the form an adopted table needs:

```typescript
import { list } from '@opensaas/stack-core'
import { relationship } from '@opensaas/stack-core/fields'

export const Post = list({
  fields: {
    author: relationship({ ref: 'User.posts', db: { foreignKey: { map: 'author_id' } } }),
  },
})
```

The action is a value in the config, not a string spliced into a schema file. There is no `extendPrismaSchema` on a field.

##### Cost: a required-foreign-key cycle is unwritable

Two lists that each hold a **non-nullable** foreign key to the other cannot be created through the secured surface at all. The first `create` has no id to `connect` to, and there is no nested-write form that would let both rows come into existence in one statement — nested `create` left the secured write surface deliberately ([ADR-0050](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0050-nested-relation-input-leaves-the-secured-write-surface.md)), because a nested write cannot be gated per row.

The fix is a modelling one: make one side nullable, create both rows, then connect. If the cycle is genuinely required at the database level, the pair has to be written on [the Unsafe surface](/docs/reference/context-api#the-unsafe-surface) inside a transaction with the constraint deferred — and every access rule you would have relied on is yours to apply by hand there.

#### Many-to-many is a junction list

There is no implicit join table. A many-to-many relationship is **authored as its own list**: a to-one relationship to each side, its own id, and a unique `db.indexes` entry over the pair.

```typescript
import { list } from '@opensaas/stack-core'
import { relationship, timestamp } from '@opensaas/stack-core/fields'

export const lists = {
  Lesson: list({
    fields: { enrolments: relationship({ ref: 'Enrolment.lesson', many: true }) },
  }),
  Teacher: list({
    fields: { enrolments: relationship({ ref: 'Enrolment.teacher', many: true }) },
  }),
  Enrolment: list({
    fields: {
      lesson: relationship({ ref: 'Lesson.enrolments', db: { foreignKey: true } }),
      teacher: relationship({ ref: 'Teacher.enrolments', db: { foreignKey: true } }),
      assignedAt: timestamp(),
    },
    db: {
      indexes: [{ fields: ['lesson', 'teacher'], unique: true }],
    },
  }),
}
```

An implicit join table is a row the application cannot see, gate or hook — which is exactly the thing this stack exists to prevent. Naming it costs one extra list and buys access control on the edge, hooks on the edge, and somewhere to put the column (`assignedAt` above) that every real join table eventually grows.

Reading across it is one hop further:

```typescript
import type { Context } from '@/.opensaas/context'

async function teacherNames(context: Context, lessonId: string) {
  const lesson = await context.db.Lesson.where({ id: lessonId })
    .include('enrolments', (enrolment) => enrolment.include('teacher', (t) => t.select('name')))
    .first()

  if (!lesson) return []

  return lesson.enrolments.flatMap((enrolment) =>
    enrolment.teacher ? [enrolment.teacher.name] : [],
  )
}
```

Each to-one hop off an included row is a null check — see [arity decides nullability](/docs/reference/context-api#cost-every-to-one-read-off-an-included-row-is-a-null-check).
---

### `ListConfig`

Configuration for a single list (data model).

```typescript
list({
  fields: Record<string, FieldConfig>,
  access?: {
    operation?: OperationAccess
  },
  hooks?: Hooks,
  mcp?: ListMcpConfig,
  isSingleton?: boolean,
  db?: {
    map?: string
    schema?: string
    timestamps?: boolean
    idField?: IdFieldStrategy
    indexes?: ListIndex[]
  },
})
```

{% callout type="warning" %}
`access` carries `operation` and nothing else. There is no `access: { filter }` and no `access: { fields }` — a rule scopes a read by **returning** a filter from an `operation` function, and field-level rules live on the field. See [Access Control](/docs/concepts/access-control).
{% /callout %}

#### Properties

##### `fields` (required)

Field definitions for this list. Keys are field names (camelCase recommended).

**Type:** `Record<string, FieldConfig>`

**See:** [Field Types guide](/docs/concepts/field-types) for available field types

##### `access`

Access control rules for this list.

**Type:** `{ operation?: OperationAccess }`

**See:** [Access Control guide](/docs/concepts/access-control)

##### `hooks`

List-level hooks for data transformation and side effects.

**Type:** [`Hooks`](#hooks)

**See:** [Hooks guide](/docs/concepts/hooks)

##### `mcp`

Model Context Protocol configuration for this list.

**Type:** [`ListMcpConfig`](#listmcpconfig)

##### `isSingleton`

Marks a list that holds exactly one row — application settings, a feature-flag record.

**Type:** `boolean`

A singleton derives its id from `isSingleton` and refuses `db.idField`. On the secured surface it carries **`get()`** in place of the composed read: there is nothing to filter, order or page.

##### `db.map`

The database table name, when it differs from the list key.

**Type:** `string`

##### `db.schema`

Which of the datasource's [`schemas`](#schemas) this list's table lives in.

**Type:** `string`

##### `db.timestamps`

Per-list override of the global [`db.timestamps`](#timestamps).

**Type:** `boolean`

##### `db.idField`

Per-list override of the global [`db.idField`](#idfield). Refused on a singleton.

**Type:** `IdFieldStrategy`

##### `db.indexes`

Model-level `@@unique`/`@@index` constraints, spanning one or more of this list's own fields.

**Type:** `ListIndex[]`

```typescript
type ListIndexFieldRef = string | { field: string }

type ListIndex = {
  fields: ListIndexFieldRef[]
  unique?: boolean // default: false
  name?: string // the constraint's own name
}
```

Field-level [`isIndexed`](/docs/reference/fields-api#isindexed) is the sugar for the unnamed single-column case. `db.indexes` is the full form — reach for it when a constraint needs a `name` (for adopting an existing live constraint under a name the generator would not derive) or spans more than one column. Arity is incidental: an entry names **one or more** of the list's own OpenSaaS field names (not raw database column names). The generator resolves each to its column — a scalar field's own name (unaffected by `db.map`), or a relationship field's foreign key column (`<field>Id`) when this side owns it.

{% callout type="warning" %}
An index column carries **no sort direction**. `{ field, sort }` is refused at `pnpm generate` with an error naming the list and the entry; the index keeps its column order.
{% /callout %}

**Example — composite unique (a database-level backstop a hook's existence check can't close on its own):**

```typescript
import { list } from '@opensaas/stack-core'
import { relationship } from '@opensaas/stack-core/fields'

export const Audition = list({
  fields: {
    student: relationship({ ref: 'Student.auditions' }),
    production: relationship({ ref: 'Production.auditions' }),
  },
  db: {
    indexes: [{ fields: ['student', 'production'], unique: true }],
  },
})
```

The two relationship fields resolve to their foreign-key columns, so the constraint spans `studentId` and `productionId`.

**Example — single-field entry, naming an adopted constraint:**

```typescript
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export const RateLimit = list({
  fields: { key: text() },
  db: {
    indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }],
  },
})
```

`key` carries no field-level `isIndexed` here: `db.indexes` owns that column instead, which is what lets the constraint keep the name a live database already gave it.

**Example — a composite index under an adopted name:**

```typescript
import { list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'

export const AuthVerification = list({
  fields: {
    identifier: text(),
    createdAt: timestamp(),
  },
  db: {
    indexes: [
      {
        fields: ['identifier', { field: 'createdAt' }],
        name: 'AuthVerification_identifier_createdAt_idx',
      },
    ],
  },
})
```

The bare string and the wrapped `{ field }` form are interchangeable.

**`createdAt`/`updatedAt` are valid even with no declared field.** An entry may name either as long as the list's auto-timestamps (`db.timestamps`, global or per-list) are enabled for that column — the auto-injected column has no table-name mapping of its own, so the field name and column name coincide:

```typescript
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

export const Verification = list({
  fields: { identifier: text() },
  db: {
    timestamps: true,
    indexes: [{ fields: ['identifier', 'createdAt'] }],
  },
})
```

The second list declares no `createdAt` field; `db.timestamps` is what makes the name resolvable.

**Errors at `pnpm generate` time** (each names the list and the entry):

- An entry naming a field the list doesn't have (unless it's `createdAt`/`updatedAt` and auto-timestamps are enabled for that column — see above), a virtual field, a to-many relationship, or the non-FK side of a one-to-one relationship.
- An entry whose `fields` array is empty.
- An entry giving a field a `sort` direction.
- A single-field entry that indexes the exact column a field-level `isIndexed` on the same list already indexes — the error names both the field/`isIndexed` and the entry, since either one should be removed rather than both left producing the same constraint.

No entry is ever silently dropped or emitted as an invalid constraint.

**Deliberately not validated:** duplicate names across entries, and two entries covering the same column set — the database catches both with messages naming the columns, and all `db.indexes` entries live in one place.

##### Cost: a hand-managed index gets no per-field violation messages

A unique violation raised by a constraint **the generator emitted** is resolved through the generated constraint map: `UniqueConstraintViolation` arrives carrying `list`, `fields` and a per-field `fieldErrors` a form can render directly.

A constraint you added by hand — in a migration, or adopted from a live database and never declared here — is not in that map. The violation still surfaces as a `UniqueConstraintViolation`, but with a generic message and an **empty `fields`** ([ADR-0042](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0042-transactions-lose-isolation-levels-and-errors-become-stack-owned.md)).

Declaring the constraint here is what buys the message. That is the reason `db.indexes` accepts a `name`: an existing live constraint can be adopted under the name it already has, and from then on it resolves like any other.

---

### `OperationAccess`

Operation-level access control rules.

```typescript
access: {
  operation: {
    query?: AccessControl,
    create?: AccessControl,
    update?: AccessControl,
    delete?: AccessControl,
  }
}
```

#### Properties

`query`, `update`, and `delete` accept an `AccessControl` function that returns:

- `true` - Allow access
- `false` - Deny access
- a **filter** — a predicate in the [Where vocabulary](/docs/reference/context-api#the-where-vocabulary), ANDed into the read

**`create` accepts a `boolean` result only** — `true` or `false`. It shares
`AccessControl`'s type (so a filter still type-checks), but there is no
existing row for `create` to scope with a filter, and — unlike `update`/
`delete`, which re-check a returned filter against the target row — no
equivalent re-check is possible for a row that doesn't exist yet. A `create`
rule that returns a filter (or any other non-boolean) throws
`InvalidCreateAccessResultError` rather than being silently treated as an
allow. To scope who may create a row by ownership, evaluate the condition in
a `resolveInput` or `validate` hook, where the input data is in scope:

```typescript
hooks: {
  resolveInput: async ({ resolvedData, context, operation }) => {
    if (operation === 'create') {
      return { ...resolvedData, ownerId: context.session?.userId }
    }
    return resolvedData
  },
},
```

**Type:** `AccessControl<T>`

**Function signature:**

```typescript
;(args: {
  session: Session
  item?: T // Present for update/delete
  context: AccessContext
}) => boolean | PrismaFilter<T> | Promise<boolean | PrismaFilter<T>>
```

**Examples:**

A rule that returns a boolean allows or denies the whole operation. A rule that
returns a filter scopes it, so a caller who owns nothing matches nothing rather
than receiving an error — that is how "only the author may update" is written,
without reaching for `item`.

Each filter-returning rule denies outright when there is no session to scope to.
That branch is not defensive style: the engine refuses a predicate that resolved
to `undefined` rather than dropping it, so `{ authorId: session?.userId }` is an
error for an anonymous caller, not a match-everything read.

`create` is the exception — it accepts a boolean result only, because there are
no existing rows to scope. Returning a filter from it throws.

```typescript
query: ({ session }) => !!session

update: ({ session }) => (session ? { authorId: { equals: session.userId } } : false)

query: ({ session }) => (session ? { authorId: { equals: session.userId } } : false)

create: ({ session }) => !!session
```

---

### `Hooks`

List-level hooks for data transformation and side effects.

```typescript
hooks: {
  resolveInput?: (args: HookArgs) => Promise<Partial<T>>,
  validateInput?: (args: HookArgs & { addValidationError: (msg: string) => void }) => Promise<void>,
  beforeOperation?: (args: HookArgs) => Promise<void>,
  afterOperation?: (args: HookArgs) => Promise<void>,
}
```

#### Hook Types

##### `resolveInput`

Transform input data before validation and database write.

**When called:** During `create` and `update` operations

**Use cases:** Auto-populate fields, set defaults, normalize data

**Example:**

```typescript
resolveInput: async ({ resolvedData, operation }) => {
  // Auto-set publishedAt when status changes to published
  if (resolvedData.status === 'published' && !resolvedData.publishedAt) {
    resolvedData.publishedAt = new Date()
  }
  return resolvedData
}
```

##### `validateInput`

Custom validation logic beyond field-level validation rules.

**When called:** During `create` and `update` operations, after `resolveInput`

**Use cases:** Cross-field validation, business logic validation

**Example:**

```typescript
validateInput: async ({ operation, resolvedData, addValidationError }) => {
  if (operation === 'delete') return
  if (resolvedData.endDate < resolvedData.startDate) {
    addValidationError('End date must be after start date')
  }
}
```

##### `beforeOperation`

Side effects before database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete` operations

**Use cases:** Logging, notifications, pre-operation checks

**Example:**

```typescript
beforeOperation: async ({ operation, item, context }) => {
  await auditLog.record({
    operation,
    userId: context.session?.userId,
    itemId: item?.id,
  })
}
```

##### `afterOperation`

Side effects after database operation. Does NOT modify data.

**When called:** After `create`, `update`, or `delete` operations

**Use cases:** Cache invalidation, webhooks, post-operation cleanup

**Parameters:**

- `operation` - The operation that was performed
- `item` - The item after the operation
- `originalItem` - The item before the operation (for `update` and `delete` only, `undefined` for `create`)
- `context` - Access context with session and database access

**Example:**

```typescript
afterOperation: async ({ operation, item, originalItem, context }) => {
  await invalidateCache(`post:${item.id}`)
  await sendWebhook({ event: `post.${operation}`, data: item })

  // Compare previous and new values for update operations
  if (operation === 'update' && originalItem) {
    if (originalItem.status !== item.status) {
      await notifyStatusChange(originalItem.status, item.status)
    }
  }
}
```

#### `HookArgs`

Arguments passed to hook functions.

```typescript
type HookArgs<T> = {
  operation: 'create' | 'update' | 'delete'
  resolvedData?: Partial<T> // Input data (not present for delete)
  item?: T // Existing item (for update/delete)
  context: AccessContext
}
```

---

### `FieldConfig`

Base configuration for all field types. Each field type extends this with type-specific options.

```typescript
type BaseFieldConfig = {
  type: string
  access?: FieldAccess
  defaultValue?: unknown
  hooks?: FieldHooks
  typePatch?: TypePatchConfig
  ui?: object
}
```

#### Common Properties

##### `type` (required)

Field type identifier (e.g., `'text'`, `'integer'`, `'relationship'`).

**Type:** `string`

##### `access`

Field-level access control.

**Type:** [`FieldAccess`](#fieldaccess)

**Example:**

```typescript
internalNotes: text({
  access: {
    read: ({ session }) => session?.role === 'admin',
    create: ({ session }) => session?.role === 'admin',
    update: ({ session }) => session?.role === 'admin',
  },
})
```

##### `defaultValue`

Default value when creating new items.

**Type:** Varies by field type

##### `hooks`

Field-level hooks for data transformation.

**Type:** [`FieldHooks`](#fieldhooks)

##### `typePatch`

Configuration for patching Prisma-generated TypeScript types (advanced).

**Type:** [`TypePatchConfig`](#typepatchconfig)

##### `ui`

UI-specific configuration passed to field components.

**Type:** `object`

**Common UI options:**

- `component?: React.Component` - Custom field component
- `fieldType?: string` - Reference to globally registered field type
- `valueForClientSerialization?: (args) => unknown` - Transform value before sending to browser
- `listView?: { defaultColumn?: boolean }` - Whether this field belongs in a list/related-list table's default column set (default `true`). Naming the field explicitly in `ui.listView.initialColumns` or a relationship's `ui.itemView.columns` always shows it regardless of this flag. **Presentation only** — it does not affect who can read the field; use `access.read` for that.

---

### `FieldAccess`

Field-level access control rules.

```typescript
access: {
  read?: AccessControl,
  create?: AccessControl,
  update?: AccessControl,
}
```

#### Properties

Each property accepts an `AccessControl` function that returns `true` (allow) or `false` (deny).

**Example:**

```typescript
password: password({
  access: {
    // Never allow reading password field
    read: () => false,
    // Only admins can set passwords
    create: ({ session }) => session?.role === 'admin',
    update: ({ session }) => session?.role === 'admin',
  },
})
```

---

### `FieldHooks`

Field-level hooks for data transformation and side effects.

```typescript
hooks: {
  resolveInput?: (args) => Promise<TInput | undefined> | TInput | undefined,
  resolveOutput?: (args) => TOutput | undefined,
  beforeOperation?: (args) => Promise<void> | void,
  afterOperation?: (args) => Promise<void> | void,
}
```

#### Hook Types

##### `resolveInput`

Transform field value before database write.

**When called:** During `create` and `update` operations

**Use cases:** Hash passwords, normalize data, transform input format

**Example:**

```typescript
password: password({
  hooks: {
    resolveInput: async ({ inputValue }) => {
      if (typeof inputValue === 'string' && inputValue.length > 0) {
        return await bcrypt.hash(inputValue, 10)
      }
      return inputValue
    },
  },
})
```

##### `resolveOutput`

Transform field value after database read.

**When called:** During `query` operations

**Use cases:** Wrap sensitive data, format values, compute derived values

**Example:**

```typescript
password: password({
  hooks: {
    resolveOutput: ({ value }) => {
      return new HashedPassword(value) // Wrap to prevent accidental exposure
    },
  },
})
```

##### `beforeOperation`

Side effects before database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete` operations

**Example:**

```typescript
profileImage: text({
  hooks: {
    beforeOperation: async ({ operation, resolvedValue }) => {
      console.log(`About to ${operation} profile image:`, resolvedValue)
    },
  },
})
```

##### `afterOperation`

Side effects after database operation. Does NOT modify data.

**When called:** After `create`, `update`, `delete`, or `query` operations

**Parameters:**

- `operation` - The operation that was performed
- `value` - The field value after the operation
- `item` - The item after the operation
- `originalItem` - The item before the operation (for `update` and `delete` only, `undefined` for `create` and `query`)
- `fieldName` - The name of the field
- `listKey` - The name of the list
- `context` - Access context with session and database access

**Example:**

```typescript
thumbnail: text({
  hooks: {
    afterOperation: async ({ operation, value, item, originalItem }) => {
      if (operation === 'delete') {
        await deleteFromCDN(value) // Cleanup on delete
      }

      // For updates, check if the value changed
      if (operation === 'update' && originalItem) {
        const oldValue = originalItem.thumbnail
        if (oldValue !== value) {
          console.log(`Thumbnail changed from ${oldValue} to ${value}`)
          // Clean up old thumbnail
          if (oldValue) await deleteFromCDN(oldValue)
        }
      }
    },
  },
})
```

---

### `SessionConfig`

Session management configuration.

```typescript
session: {
  getSession: () => Promise<Session>
}
```

#### Properties

##### `getSession` (required)

Function that retrieves the current session.

**Type:** `() => Promise<Session>`

**Example:**

```typescript
import { auth } from '@/lib/auth'

session: {
  getSession: async () => {
    const session = await auth()
    return session?.user ? { userId: session.user.id } : null
  }
}
```

---

### `UIConfig`

Admin UI customization options.

```typescript
ui: {
  basePath?: string,
  theme?: ThemeConfig,
}
```

#### Properties

##### `basePath`

Base URL path for admin UI routes.

**Type:** `string`
**Default:** `"/admin"`

##### `theme`

Theme customization options.

**Type:** [`ThemeConfig`](#themeconfig)

---

### `ThemeConfig`

Theme customization for the admin UI. Compiles to CSS custom property overrides
written onto the same tokens the UI package stylesheet declares, so the config
layer and the stylesheet can never drift (ADR-0015).

```typescript
theme: {
  preset?: 'modern' | 'classic' | 'neon',
  colors?: ThemeColors,       // light-mode overrides
  darkColors?: ThemeColors,   // dark-mode overrides
  fonts?: { sans?: string, mono?: string, heading?: string },
  radius?: number,            // rem; derived sm/md/lg sizes computed from it
  shadows?: { sm?: string, md?: string, lg?: string },
}
```

#### Properties

##### `preset`

Predefined theme preset, used as a starting point for token overrides.

**Type:** `'modern' | 'classic' | 'neon'`
**Default:** `'modern'`

##### `colors` / `darkColors`

Custom color overrides for light and dark mode respectively.

**Type:** [`ThemeColors`](#themecolors)

##### `fonts`

Font family tokens (`--font-sans`, `--font-mono`, `--font-heading`). Designed to
compose with `next/font`: set a value to the font's CSS variable. `heading`
defaults to `sans`.

**Type:** `{ sans?: string; mono?: string; heading?: string }`

##### `radius`

Base border radius in rem units. Derived `sm`/`md`/`lg` radii are computed from it.

**Type:** `number`
**Default:** `0.625`

##### `shadows`

Elevation shadow tokens (`--shadow-sm`, `--shadow-md`, `--shadow-lg`). Set them
to `'none'` for a fully flat theme.

**Type:** `{ sm?: string; md?: string; lg?: string }`

---

### `ThemeColors`

Custom theme color values. Each value is passed through **verbatim** to a CSS
custom property, so any valid CSS color string works — `oklch(…)`, `#hex`,
`rgb(…)`, or a wrapped `hsl(…)`.

> **Clean break (ADR-0015):** bare HSL triplets (`"220 20% 97%"`, the old
> shadcn format) are no longer accepted. Passing one triggers a dev-mode warning
> that suggests wrapping it in `hsl()`. Wrap old values — `"220 20% 97%"` →
> `"hsl(220 20% 97%)"` — or move to any other CSS color format.

```typescript
theme: {
  colors: {
    primary: '#16a34a', // hex
    primaryForeground: 'oklch(1 0 0)', // oklch
    background: 'hsl(220 20% 97%)', // wrapped hsl
  }
}
```

#### Available Colors

- `background` / `foreground` - Main surface and text
- `card` / `cardForeground` - Card surface and text
- `popover` / `popoverForeground` - Popover surface and text
- `primary` / `primaryForeground` - Primary action color and text
- `secondary` / `secondaryForeground` - Secondary action color and text
- `muted` / `mutedForeground` - Muted background and text
- `accent` / `accentForeground` - Accent color and text
- `destructive` / `destructiveForeground` - Destructive action color and text
- `success` / `successForeground` - Success status color and text
- `warning` / `warningForeground` - Warning status color and text
- `border` - Border color
- `input` - Input border color
- `ring` - Focus ring color
- `gradientFrom` / `gradientTo` - Signature gradient pair

---

### `McpConfig`

Model Context Protocol server configuration for AI assistant integration.

```typescript
mcp: {
  enabled?: boolean,
  basePath?: string,
  auth?: McpAuthConfig,
  defaultTools?: McpToolsConfig,
  resource?: string,
}
```

#### Properties

##### `enabled`

Enable MCP server globally.

**Type:** `boolean`
**Default:** `false`

##### `basePath`

Base path for MCP API routes.

**Type:** `string`
**Default:** `"/api/mcp"`

##### `auth`

Authentication metadata (optional, currently informational). The MCP runtime authenticates via the session provider passed to `createMcpHandlers` — for Better Auth, the OAuth flow is wired through the `mcp` plugin in `authPlugin`'s `betterAuthPlugins` plus `createBetterAuthMcpAdapter`. See the [MCP Setup Guide](/docs/how-to/mcp).

**Type:** [`McpAuthConfig`](#mcpauthconfig)

##### `defaultTools`

Default CRUD tool configuration for all lists.

**Type:** [`McpToolsConfig`](#mcptoolsconfig)

##### `resource`

OAuth resource identifier for protected resource metadata (optional, currently informational — the `.well-known/oauth-protected-resource` route you create serves this metadata).

**Type:** `string`

---

### `McpAuthConfig`

OAuth configuration for MCP authentication.

#### Better Auth Integration

```typescript
mcp: {
  auth: {
    type: 'better-auth',
    loginPage: string,
    scopes?: string[],
    oidcConfig?: {
      codeExpiresIn?: number,
      accessTokenExpiresIn?: number,
      refreshTokenExpiresIn?: number,
      defaultScope?: string,
      scopes?: string[],
    }
  }
}
```

**Example:**

```typescript
mcp: {
  enabled: true,
  auth: {
    type: 'better-auth',
    loginPage: '/sign-in',
    scopes: ['openid', 'profile', 'email'],
  }
}
```

#### Custom Auth Provider

```typescript
mcp: {
  auth: {
    type: string,
    // Additional provider-specific configuration
  }
}
```

---

### `ListMcpConfig`

List-level MCP configuration to control tool generation.

```typescript
mcp: {
  enabled?: boolean,
  tools?: McpToolsConfig,
  customTools?: McpCustomTool[],
}
```

#### Properties

##### `enabled`

Enable MCP tools for this list.

**Type:** `boolean`
**Default:** `true`

##### `tools`

Configure which CRUD tools to enable.

**Type:** [`McpToolsConfig`](#mcptoolsconfig)

##### `customTools`

Custom MCP tools specific to this list.

**Type:** [`McpCustomTool[]`](#mcpcustomtool)

---

### `McpToolsConfig`

Configuration for which CRUD tools to enable.

```typescript
tools: {
  read?: boolean,    // Default: true
  create?: boolean,  // Default: true
  update?: boolean,  // Default: true
  delete?: boolean,  // Default: true
}
```

**Example:**

```typescript
Post: list({
  mcp: {
    tools: {
      read: true,
      create: true,
      update: true,
      delete: false, // Disable delete tool for safety
    },
  },
})
```

---

### `McpCustomTool`

Custom MCP tool definition for specialized operations.

```typescript
type McpCustomTool = {
  name: string
  description: string
  // Zod schema (validated on tools/call, converted to JSON Schema for
  // tools/list) or a plain JSON Schema object
  inputSchema: ZodSchema | Record<string, unknown>
  handler: (args) => Promise<unknown>
}
```

**Example:**

```typescript
import { z } from 'zod'

customTools: [
  {
    name: 'publish-post',
    description: 'Publish a draft post and notify subscribers',
    inputSchema: z.object({
      postId: z.string(),
      notifySubscribers: z.boolean().optional(),
    }),
    handler: async ({ input, context }) => {
      const post = await context.db.Post.update({
        where: { id: input.postId },
        data: { status: 'published', publishedAt: new Date() },
      })

      if (!post) {
        return { error: 'Post not found, or not publishable by this session' }
      }

      if (input.notifySubscribers) {
        await notifySubscribers(post)
      }

      return post
    },
  },
]
```

---

### `StorageConfig`

File/image upload storage provider configuration.

```typescript
storage: Record<string, StorageProviderConfig>
```

Maps provider names to their configurations.

**Example:**

```typescript
import { localStorage } from '@opensaas/stack-storage'
import { s3Storage } from '@opensaas/stack-storage-s3'

storage: {
  avatars: s3Storage({
    bucket: 'my-avatars',
    region: 'us-east-1',
  }),
  documents: localStorage({
    uploadDir: './uploads',
    serveUrl: '/api/files',
  }),
}
```

---

### `TypePatchConfig`

Configuration for patching Prisma-generated TypeScript types (advanced use).

```typescript
typePatch: {
  resultType: string,
  patchScope?: 'scalars-only' | 'all',
}
```

#### Properties

##### `resultType` (required)

TypeScript import statement for the type to use in Prisma result types.

**Type:** `string`

**Format:** `"import('@package/name').TypeName"`

##### `patchScope`

Where to apply the type patch.

**Type:** `'scalars-only' | 'all'`
**Default:** `'scalars-only'`

**Example:**

```typescript
password: password({
  typePatch: {
    resultType: "import('@opensaas/stack-core').HashedPassword",
    patchScope: 'scalars-only',
  },
})
```

---

## Plugin System

### `Plugin`

Plugin definition for extending stack functionality.

```typescript
type Plugin = {
  name: string
  version?: string
  dependencies?: string[]
  init: (context: PluginContext) => void | Promise<void>
  beforeGenerate?: (config: OpenSaasConfig) => OpenSaasConfig | Promise<OpenSaasConfig>
  afterGenerate?: (files: GeneratedFiles) => GeneratedFiles | Promise<GeneratedFiles>
  runtime?: (context: AccessContext) => unknown
}
```

#### Properties

##### `name` (required)

Unique plugin identifier.

**Type:** `string`

##### `version`

Semantic version string.

**Type:** `string`

##### `dependencies`

Array of plugin names this plugin depends on.

**Type:** `string[]`

**Example:**

```typescript
dependencies: ['auth'] // This plugin requires auth plugin to run first
```

##### `init` (required)

Main initialization hook. Called during config processing.

**Type:** `(context: PluginContext) => void | Promise<void>`

**Example:**

```typescript
init: async (context) => {
  // Add new list
  context.addList(
    'MyList',
    list({
      fields: { name: text() },
    }),
  )

  // Extend existing list
  context.extendList('User', {
    fields: { myField: text() },
  })

  // Store plugin data
  context.setPluginData('my-plugin', { apiKey: '...' })
}
```

##### `beforeGenerate`

Hook called before the Contract module is generated. Allows config transformation.

**Type:** `(config: OpenSaasConfig) => OpenSaasConfig | Promise<OpenSaasConfig>`

##### `afterGenerate`

Hook called after file generation. Allows post-processing generated files.

**Type:** `(files: GeneratedFiles) => GeneratedFiles | Promise<GeneratedFiles>`

##### `runtime`

Provides runtime services attached to context.

**Type:** `(context: AccessContext) => unknown`

**Example:**

```typescript
runtime: (context) => ({
  sendEmail: async (to, subject, body) => {
    // Email service implementation
  },
})

// Access in your app:
// context.plugins.myPlugin.sendEmail(...)
```

---

### `PluginContext`

Context provided to plugins during initialization.

```typescript
type PluginContext = {
  readonly config: OpenSaasConfig
  addList: (name: string, listConfig: ListConfig) => void
  extendList: (name: string, extension: object) => void
  registerFieldType?: (type: string, builder: Function) => void
  registerMcpTool?: (tool: McpCustomTool) => void
  setPluginData: <T>(pluginName: string, data: T) => void
}
```

#### Methods

##### `addList()`

Add a new list to the config. Throws if list already exists.

**Signature:**

```typescript
addList(name: string, listConfig: ListConfig): void
```

##### `extendList()`

Extend an existing list with additional fields, hooks, or access control. Deep merges configuration.

**Signature:**

```typescript
extendList(name: string, extension: {
  fields?: Record<string, FieldConfig>,
  hooks?: Hooks,
  access?: { operation?: OperationAccess },
  mcp?: ListMcpConfig,
}): void
```

##### `registerFieldType()`

Register a custom field type globally.

**Signature:**

```typescript
registerFieldType(type: string, builder: (options?: unknown) => BaseFieldConfig): void
```

##### `registerMcpTool()`

Register a custom MCP tool globally.

**Signature:**

```typescript
registerMcpTool(tool: McpCustomTool): void
```

##### `setPluginData()`

Store plugin-specific data for runtime access.

**Signature:**

```typescript
setPluginData<T>(pluginName: string, data: T): void
```

**Access at runtime:**

```typescript
const pluginData = config._pluginData[pluginName]
```

---

## Runtime Context

### `AccessContext`

Context object passed to access control functions, hooks, and custom tools.

```typescript
type AccessContext = {
  session: Session | null
  ormHandle: OrmClient
  db: AccessControlledDB
  storage: StorageUtils
  plugins: Record<string, unknown>
  _isSudo: boolean
}
```

{% callout type="warning" %}
`AccessContext` has **no `unsafe` member**. The application's deliberate bypass — [the Unsafe surface](/docs/reference/context-api#the-unsafe-surface) — lives on the request context, not here, so a hook or a plugin cannot reach it by accident.
{% /callout %}

#### Properties

##### `session`

Current user session (user-defined structure).

**Type:** `Session | null`

##### `ormHandle`

The engine's own ORM handle: the client `db`'s terminals, the Write Pipeline and the access filter run their queries through.

**Type:** `OrmClient`

It is engine plumbing, not an application seam. The engine applies the Access Filter, Field Visibility and hooks _around_ it — the handle itself enforces none of them. It is rebound wherever `db` is rebound, so the two are always in the same transaction state.

##### `db`

Access-controlled database interface (enforces access rules). Keyed by list key: `context.db.Post`.

**Type:** `AccessControlledDB`

##### `storage`

File/image upload utilities.

**Type:** [`StorageUtils`](#storageutils)

##### `plugins`

Plugin-provided runtime services.

**Type:** `Record<string, unknown>`

##### `_isSudo`

Internal flag for sudo mode (bypasses all access control).

**Type:** `boolean`

---

### `StorageUtils`

Storage utilities for file/image uploads.

```typescript
type StorageUtils = {
  uploadFile: (providerName, file, buffer, options?) => Promise<FileMetadata>
  uploadImage: (providerName, file, buffer, options?) => Promise<ImageMetadata>
  deleteFile: (providerName, filename) => Promise<void>
  deleteImage: (metadata) => Promise<void>
}
```

---

## Next Steps

- **[Field Types](/docs/concepts/field-types)** - Detailed field type reference
- **[Access Control](/docs/concepts/access-control)** - Access control patterns
- **[Hooks](/docs/concepts/hooks)** - Hook execution and examples
- **[Plugins](/docs/how-to/write-a-plugin)** - Creating custom plugins
