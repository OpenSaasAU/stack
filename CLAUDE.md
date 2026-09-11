# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation & Specifications

- **Specifications and design docs:** All specs, design documents, and technical documentation should be saved to and read from the `specs/` directory
- **CLAUDE.md:** This file contains general guidance and architectural patterns
- **README files:** Each package and example has its own README for specific usage instructions
- **Claude Skills:** Specialized skills for common tasks are in `.claude/skills/`
  - `pr-changeset`: **REQUIRED** - Use when modifying any package code to create proper changeset files
  - `plugin-version`: **REQUIRED** - Use when modifying any Claude plugin code to bump plugin and marketplace versions

## Project Overview

OpenSaas Stack is a Next.js-based stack for building admin-heavy applications with built-in access control. It uses a config-first approach similar to KeystoneJS but modernized for Next.js App Router and designed to be AI-agent-friendly with automatic security guardrails.

PostgreSQL is the only supported database provider, reached through Prisma 8's contract-driven ORM. `docs/adr/` holds the reasoning behind every architectural decision named here, and `specs/prisma-8/architecture-spec.md` is the one-page map of the current architecture with a decision index.

This is a pnpm monorepo with:

- `packages/core`: Core stack (config system, access control engine, contract derivation, dev database, test harness)
- `packages/cli`: CLI tools (`opensaas generate`, `opensaas dev`, `opensaas db update`, migration, MCP server via bin scripts)
- `packages/ui`: Admin UI components (composable React components)
- `packages/auth`: Better-auth integration (authentication & sessions)
- `packages/create-opensaas-app`: Project scaffolding (`npm create opensaas-app`)
- `packages/rag`: RAG plugin (embeddings + vector search)
- `packages/storage`: File/image fields + local storage provider
- `packages/storage-s3`: S3-compatible storage provider
- `packages/storage-vercel`: Vercel Blob storage provider
- `packages/tiptap`: Rich text editor integration (third-party field example)
- `examples/blog`: Basic blog example
- `examples/custom-field`: Custom field types demonstration
- `examples/composable-dashboard`: Composable UI components
- `examples/auth-demo`: Authentication integration
- `examples/mcp-demo`: MCP server integration
- `examples/tiptap-demo`: Tiptap rich text editor integration
- `examples/file-upload-demo`: File/image fields with storage providers
- `examples/json-demo`: JSON field usage
- `examples/plain-css-theming`: Admin UI theming without Tailwind
- `examples/rag-ollama-demo`: Semantic search with local Ollama embeddings
- `examples/rag-openai-chatbot`: RAG chatbot with OpenAI embeddings
- `examples/starter`: Minimal starter (template for create-opensaas-app)
- `examples/starter-auth`: Starter with auth (template for create-opensaas-app)
- `specs/`: Design documents and specifications

## Common Commands

### Development

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Build in development mode (watch)
pnpm dev

# Clean build artifacts
pnpm clean
```

### Working with Core Package

```bash
cd packages/core

# Build the core package
pnpm build

# Run tests
pnpm test

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

### Working with Examples

```bash
cd examples/blog

# Start the dev database, generate, reconcile the schema and run the app.
# This is the whole loop — there is no separate database step to run first.
pnpm dev

# Regenerate the contract and the .opensaas bundle without running the app
pnpm generate

# Apply a schema change the running loop staged but did not promote
pnpm db:update

# Run a one-off script against the loop's database instead of `next dev`
pnpm dev -- tsx some-script.ts

# Build for production
pnpm build
```

`opensaas dev` runs the project's own **Dev database** — an in-process PGlite behind a socket on a free loopback port — and injects no `DATABASE_URL`. Setting `DATABASE_URL` yourself is the **Database escape**: no Dev database starts and every command talks to the Postgres you named. Reset the Dev database by deleting `.opensaas/dev-db/`. See ADR-0063.

## Architecture

### Access Control System (Core Feature)

The stack's primary innovation is its access control engine that automatically secures every database operation. Understanding this is critical for working with the codebase.

**Key files:**

- `packages/core/src/context/index.ts` - The context factory and the secured `db` surface
- `packages/core/src/secured/` - The composed read, its terminals, the Where vocabulary's lowering, the row lock
- `packages/core/src/access/engine.ts` - Access control execution logic
- `packages/core/src/access/types.ts` - Type definitions for access control

**How it works:**

1. An application declares access control in `opensaas.config.ts` using `AccessControl` functions
2. A read is **composed** on `context.db.<List>` — `context.db.Post.where({ published: true })` — and enforces nothing until a terminal runs it
3. The terminal resolves operation-level access (may this session perform this action?)
4. The access filter rides into the query as a second, engine-owned predicate the ORM ANDs natively — nobody hand-merges a `where`
5. Field-level access strips what the session may not read, after the query
6. A denied operation returns the empty value of the terminal's type (`null`, `[]`, `0`) rather than throwing — silent failure prevents information leakage

**Access Control Types:**

- **Operation-level**: Controls query/create/update/delete access at the list level
- **Field-level**: Controls read/create/update access for individual fields
- **Filter-based**: Returns a Where vocabulary condition that scopes access (e.g. `{ authorId: { equals: userId } }`)
- **Boolean**: Returns `true` (allow) or `false` (deny)

### The Two Surfaces

Every query the ORM executes comes through exactly one of two surfaces, and a query that came through neither is refused before it compiles (ADR-0038, ADR-0059).

- **`context.db`** — the secured surface. Access control, Field Visibility, hooks, stack-owned errors. This is where application code belongs.
- **`context.unsafe`** — the **Unsafe surface**, under a name that states the bypass. It carries Prisma's typed SQL builder (`unsafe.sql`), its raw tag (`unsafe.raw`) and its collections (`unsafe.orm`) untouched, and executes plans through `unsafe.query(plan)` and `unsafe.execute(plan)`. No access filter, no Field Visibility, no `resolveOutput`, no hooks, and raw driver errors. It is the address for application-authored SQL and for a read that must be consumed incrementally; every use should say why. See ADR-0056.

The secured surface has **no SQL escape of any kind** — no raw fragment inside `where()`, no `sql()` terminal. Reaching for SQL means reaching for `context.unsafe`.

### Hooks System

The hooks system provides data transformation and side effects during database operations. Hooks are available at both the list level and field level. **The hooks API is compliant with Keystone's hooks specification.**

**Key files:**

- `packages/core/src/hooks/index.ts` - List-level hooks
- `packages/core/src/config/types.ts` - Field-level hook types

**Hook Types:**

- **Data Transformation Hooks**: `resolveInput` and `resolveOutput` - Transform data going in or out
- **Side Effect Hooks**: `beforeOperation` and `afterOperation` - Perform actions without modifying data
- **Validation Hooks**: `validate` (or `validateInput` for backwards compatibility) - Custom validation logic

**Hook execution order (write operations - create/update):**

1. List-level `resolveInput` - Transform input data at list level
2. Field-level `resolveInput` - Transform individual field values (e.g., hash passwords)
3. List-level `validate` - Custom validation logic
4. Field-level `validate` - Custom validation logic for individual fields
5. Field validation - Built-in rules (isRequired, length, min/max)
6. Field-level access control - Filter writable fields
7. Relationship resolution - a `connect`'s reachability query and the foreign-key write
8. Field-level `beforeOperation` - Side effects for individual fields
9. List-level `beforeOperation` - Side effects at list level
10. **Database operation**
11. List-level `afterOperation` - Side effects at list level
12. Field-level `afterOperation` - Side effects for individual fields

**Hook execution order (read operations - query):**

1. **Database operation**
2. Field-level access control - Filter readable fields
3. Field-level `resolveOutput` - Transform individual field values (e.g., wrap passwords)

**Hook Arguments (Keystone-compliant):**

All hooks receive these common arguments:

- `listKey` - The name of the list being operated on
- `operation` - The operation type ('create', 'update', or 'delete'). For `resolveOutput` hooks, this is 'query'
- `context` - The AccessContext object

**List-level hooks** additionally receive:

- `resolveInput`: `{ listKey, operation, inputData, resolvedData, item, context }`
  - Returns the modified `resolvedData`
- `validate`: `{ listKey, operation, inputData, resolvedData, item, context, addValidationError }`
  - Use `addValidationError(msg)` to report validation failures
- `beforeOperation`:
  - create/update: `{ listKey, operation, inputData, resolvedData, context }`
  - delete: `{ listKey, operation, item, context }`
- `afterOperation`:
  - create: `{ listKey, operation, inputData, item, resolvedData, context }`
  - update: `{ listKey, operation, inputData, originalItem, item, resolvedData, context }`
  - delete: `{ listKey, operation, originalItem, context }`

**Field-level hooks** additionally receive:

- `fieldKey` - The name of the field (use `fieldKey`, not `fieldName`)
- `resolveInput`: `{ listKey, fieldKey, operation, inputData, item, resolvedData, context }`
  - Access field value via `resolvedData[fieldKey]`
  - Returns the modified field value
- `validate`:
  - create/update: `{ listKey, fieldKey, operation, inputData, item, resolvedData, context, addValidationError }`
  - delete: `{ listKey, fieldKey, operation, item, context, addValidationError }`
- `beforeOperation`:
  - create: `{ listKey, fieldKey, operation, inputData, resolvedData, context }`
  - update: `{ listKey, fieldKey, operation, inputData, item, resolvedData, context }`
  - delete: `{ listKey, fieldKey, operation, item, context }`
- `afterOperation`:
  - create: `{ listKey, fieldKey, operation, inputData, item, resolvedData, context }`
  - update: `{ listKey, fieldKey, operation, inputData, originalItem, item, resolvedData, context }`
  - delete: `{ listKey, fieldKey, operation, originalItem, context }`
- `resolveOutput`: `{ operation, value, item, listKey, fieldName, context }` (query operations only)

**Key Concepts:**

- `inputData` - The original data passed to the operation (before any transformations)
- `resolvedData` - The data after transformations (updated by `resolveInput` hooks)
- `item` - The existing item from the database (undefined for create, present for update/delete)
- `originalItem` - The item before the operation (undefined for create, present for update/delete in `afterOperation`)

A `resolveOutput` hook sees **exactly its own declared dependency set plus the list's system fields** — never another computed field's output, and never what the caller happened to select. Reaching for anything it did not declare finds nothing there. See `needs` in `packages/core/CLAUDE.md` and ADR-0051.

**List-level hook use cases:**

- `resolveInput`: Auto-set publishedAt when status changes to "published"
- `validate`: Business logic validation (e.g., "title cannot contain spam")
- `beforeOperation`: Logging, sending notifications
- `afterOperation`: Cache invalidation, webhooks, comparing previous and new values using `originalItem`

**Field-level hook use cases:**

- `resolveInput`: Hash passwords, normalize phone numbers, resize images
- `resolveOutput`: Wrap passwords with HashedPassword class, format dates
- `beforeOperation`: Log field changes, validate external constraints
- `afterOperation`: Update search indexes, invalidate CDN caches, cleanup old files by comparing `originalItem` field values

### Config System

**Key files:**

- `packages/core/src/config/types.ts` - Type definitions
- `packages/core/src/config/index.ts` - Config builder functions
- `packages/core/src/config/plugin-engine.ts` - Plugin execution engine

Applications declare their schema in `opensaas.config.ts`:

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'

const isAuthor: AccessControl = ({ session }) =>
  session === null ? false : { authorId: { equals: session.userId } }

export default config({
  db: { provider: 'postgresql' },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        publishedAt: timestamp(),
      },
      access: { operation: { query: () => true, update: isAuthor } },
      hooks: { resolveInput: async ({ resolvedData }) => resolvedData },
    }),
  },
})
```

`db.provider` is `'postgresql'` and nothing else. The connection URL is not a config key: the runtime resolves it from `DATABASE_URL` or, when that is unset, from the running Dev database's state file (`resolveDatabaseUrl` in core). See ADR-0063.

**Database config keys:**

- `db.idField` — `'uuid7' | 'cuid2' | 'int autoincrement'`, the id strategy every list gets unless it sets its own `db.idField`. Default `uuid7` (ADR-0048)
- `db.extensions` — the **Extension packs** the contract declares, as import descriptors naming a package: `[{ name: 'pgvector', from: '@prisma/orm-extension-pgvector' }]`. One declaration drives the contract module, `prisma.config.ts`, the runtime client and the pack's migration space. A plugin contributes its own through `PluginContext.addExtension`, so `ragPlugin` names pgvector and the application never does (ADR-0049, ADR-0065)
- `db.client` — pool binding for the generated runtime client: `poolOptions`, and a **lazy** `pg` factory. A factory, not an instance, because the config is loaded by tooling that must never open a connection
- `db.timestamps` — auto-inject `createdAt`/`updatedAt`. Off by default
- `db.indexes` is per list, not on `db` — see below

```typescript
import { config } from '@opensaas/stack-core'
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
  lists: {},
})
```

### Plugin System

**Overview:** The stack uses a plugin system for extending functionality. Plugins can inject lists, add hooks, declare extension packs, register MCP tools, and participate in code generation.

**Key files:**

- `packages/core/src/config/plugin-engine.ts` - Dependency resolution and execution
- `packages/auth/src/config/plugin.ts` - Auth plugin implementation
- `packages/rag/src/config/plugin.ts` - RAG plugin implementation

**Plugin Capabilities:**

- **Inject Lists**: Add auto-generated lists (e.g. the Auth lists from `authPlugin`)
- **Extend Lists**: Add fields or hooks to existing lists
- **Declare Extension packs**: `context.addExtension({ name, from })`, so a field type needing a pack does not push that declaration onto the application
- **Hook Chaining**: Multiple plugins can add hooks that execute in sequence
- **Deep Merging**: Plugins safely merge fields, hooks, and access control
- **Lifecycle Hooks**: `beforeGenerate`, `afterGenerate` for code generation control
- **Dependency Resolution**: Automatic execution ordering via topological sort

**Plugin Pattern:**

```typescript
import type { Plugin } from '@opensaas/stack-core/extend'
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

interface MyConfig {
  label: string
}

export function myPlugin(pluginConfig: MyConfig): Plugin {
  return {
    name: 'my-plugin',
    version: '0.1.0',
    dependencies: ['auth'],

    init: async (context) => {
      context.addList('MyList', list({ fields: { name: text() } }))
      context.extendList('AuthUser', { fields: { myField: text() } })
      context.addExtension({ name: 'pgvector', from: '@prisma/orm-extension-pgvector' })
      context.setPluginData('my-plugin', pluginConfig)
    },

    beforeGenerate: async (generatedConfig) => generatedConfig,
    afterGenerate: async (files) => files,
  }
}
```

A plugin writing a column it owns and the application cannot write — an embedding, say — uses `writePluginOwnedField` from `@opensaas/stack-core/extend` rather than driving the list's own pipeline under `sudo()`. Re-running the pipeline over a payload naming one field recomputes derived fields from input that is not there. See ADR-0066.

**Runtime Access:**

Plugin data is stored in `config._pluginData[pluginName]`.

### The Generator

`pnpm generate` (`opensaas generate`) turns `opensaas.config.ts` into the contract and the generated bundle. There is **no Prisma schema language anywhere in the pipeline** — the generator emits a TypeScript **Contract module** and shells to Prisma's own `contract emit` (ADR-0040).

**Key files:**

- `packages/cli/src/generator/contract-module.ts` - Renders the Contract module
- `packages/cli/src/generator/prisma-config.ts` - Renders `prisma.config.ts`
- `packages/cli/src/generator/extension-spaces.ts` - Seeds each declared pack's migration space
- `packages/cli/src/generator/contract-emit.ts` - Shells to `prisma contract emit`
- `packages/cli/src/generator/types.ts` - Renders `.opensaas/types.ts`
- `packages/cli/src/generator/context.ts` - Renders `.opensaas/context.ts`
- `packages/core/src/contract/` - `deriveContract(config)`, which core owns and the CLI renders

**What it emits:**

1. **`prisma/contract.ts`** — the Contract module: standalone and fully literal, importing nothing from the config, so the builder's purity rules hold by construction
2. **`prisma/contract.json`** + **`prisma/contract.d.ts`** — the **Contract artifacts**, written by `prisma contract emit`, committed and byte-deterministic. The `.d.ts` carries per-field nullability, codecs, the column map and the relation graph, so nothing downstream re-derives them
3. **`prisma.config.ts`** — Prisma's CLI config, importing each declared pack's control descriptor and resolving the database URL through `findDatabaseUrl()` — the non-throwing accessor, because this file is evaluated for every Prisma command including the offline ones
4. **`migrations/<space>/**`** — one **Extension contract space** per declared pack, regenerated on every `generate`; Prisma runs `CREATE EXTENSION` from it on every path
5. **`.opensaas/`** — the **Generated bundle**: `context.ts`, `types.ts`, `lists.ts`, `plugin-types.ts` and `tables.ts` (the emitted dependency-set table and constraint map)

The bundle carries no Prisma code of its own: `context.ts` imports `contract.json` and constructs one client per process from it. It is erasable TypeScript by contract, so the host's bundler compiles it and plain Node loads it natively — there is no compiled twin (ADR-0054).

**Architecture:** Generators delegate to the field builder rather than using switch statements. Each field type describes what it contributes to the contract through `getContractField()`, and the column's codec types it from there.

CI re-runs generation and fails on a dirty tree, so a contract artifact that drifts from the config is a failing check rather than a runtime surprise.

**Model-Level Indexes (`db.indexes`):**

Field-level `isIndexed` is the sugar for the unnamed single-column case. `db.indexes` is the full form — reach for it when a constraint needs a `name` (for adopting an existing live constraint) or spans more than one column. Arity is incidental: each entry names one or more of the list's own OpenSaaS field names (not raw database column names) and the generator resolves each to its column — a scalar field's own name, or a relationship field's foreign key column (`<field>Id`) when this side owns it. See the [reference docs](https://stack.opensaas.au/docs/reference/config-api#dbindexes) for the full rules.

```typescript
import { list } from '@opensaas/stack-core'
import { relationship, text, timestamp } from '@opensaas/stack-core/fields'

const lists = {
  Audition: list({
    fields: {
      student: relationship({ ref: 'Student.auditions' }),
      production: relationship({ ref: 'Production.auditions' }),
    },
    db: {
      // One audition per student per production — a database-level backstop
      // for a business rule a hook's existence check can't close on its own
      // (two concurrent submissions both pass the check and both insert).
      indexes: [{ fields: ['student', 'production'], unique: true }],
    },
  }),

  AuthVerification: list({
    fields: { identifier: text(), createdAt: timestamp() },
    db: {
      indexes: [
        {
          fields: ['identifier', 'createdAt'],
          // Adopts an existing live constraint name.
          name: 'AuthVerification_identifier_createdAt_idx',
        },
      ],
    },
  }),

  RateLimit: list({
    fields: { key: text() }, // no isIndexed here — db.indexes owns this column instead
    db: {
      // A single-field entry is as legitimate as a composite one — this is the
      // form for adopting a live table's unique constraint under a name the
      // generator wouldn't derive on its own.
      indexes: [{ fields: ['key'], unique: true, name: 'RateLimit_key_key' }],
    },
  }),
}
```

**An index column carries no sort direction.** A `sort` key on a `db.indexes` field reference fails `pnpm generate` by name, and the index keeps its column order (ADR-0040).

An entry naming a field the list doesn't have, a virtual field, a to-many relationship, or the non-foreign-key side of a one-to-one relationship fails `pnpm generate` with an error naming the list, the entry and the bad field — never silently dropped. The same is true for an empty `fields` array, and for a single-field entry that indexes the exact column a field-level `isIndexed` on the same list already indexes (the error names both — remove one of them).

**Other generate-time refusals**, each naming the list, the entry and the fix: `many: true` on both sides of a relationship (implicit many-to-many is not generated — declare a junction list); `db.idField` on a singleton; a field type needing an undeclared extension pack; a pack missing a required subpath; a duplicate pack `name` with a differing `from`; `needs` on a field with no `resolveOutput`; `db.foreignKey: true` on both sides of a one-to-one; a relationship pointing at a composite-keyed list.

### Migrations and the dev loop

The workflow splits on history, not on provider: **dev reconciles, production migrates** (ADR-0003 as amended, ADR-0063).

- `opensaas dev` starts the Dev database, generates, runs Prisma's reconcile, and spawns the app. On a config change it **stages** generation behind reconciliation — emitting to a staging directory, planning the update, and promoting the contract and bundle only once the plan applies. A destructive plan mid-session leaves bundle and database at the previous schema, prints the plan and the `pnpm db:update` instruction, and keeps serving.
- `pnpm db:update` (`opensaas db update`) is the promoting wrapper. It runs **during** `dev` — the loop holds the database and the staged generation, so this command opens no connection of its own — and errors when nothing is listening.
- Production runs Prisma's migrate from the committed `migrations/` directory, which carries the app's migration packages and every declared pack's extension space.
- Prisma runs `CREATE EXTENSION IF NOT EXISTS` on every path. The deployment's job is provisioning: make the extension available and give the migrating role the privilege, or have a DBA pre-create it. pgvector is untrusted, so it needs superuser or a provider grant.

### Field Types

**Key file:** `packages/core/src/fields/index.ts`

**Core field types:**

- `text()` - String field with validation (isRequired, length)
- `integer()` / `bigInt()` / `decimal()` - Numeric fields with validation (isRequired, min, max)
- `checkbox()` - Boolean field
- `timestamp()` / `calendarDay()` - Date and date-time fields
- `password()` - Hashed password (excluded from reads)
- `select()` - Enum field with predefined options
- `relationship()` - Foreign key relationship
- `json()` - JSON field for storing arbitrary JSON data
- `virtual()` - Computed field not stored in database, computed via hooks

**Third-party field types:**

- `richText()` from `@opensaas/stack-tiptap/fields` - Rich text editor with JSON storage
- `image()` / `file()` from `@opensaas/stack-storage/fields` - Assets over a storage provider
- `embedding()` from `@opensaas/stack-rag/fields` - A native vector column, searchable with `nearest()`

**Field Builder Contract:**

Each field builder function returns an object declaring:

1. **`getZodSchema(fieldName, operation)`** - Validation schema generation
2. **`getContractField(fieldName, listKey, config)`** - what the field contributes to the contract: `{ kind: 'column' }` (inline column descriptor), `{ kind: 'columns' }`, `{ kind: 'relation' }`, or `{ kind: 'computed' }` for a virtual field
3. **`outputType`** / **`inputType`** - the TypeScript read and write faces, when they differ from the column's codec type. `outputType` is **required** on a virtual field and on a `kind: 'columns'` field, neither of which has a single column to be typed from. `inputType` is never required by the generator — on a single-column field its absence means the column's own input type, and a `kind: 'columns'` field, which has no single column for that to name, should declare it alongside `outputType`

`opensaas generate` refuses a config where a field leaves out a member it owes, naming the list, the field and the member.

This allows field types to be fully self-contained and extensible without modifying core stack code.

#### Virtual Fields with Custom Scalar Types

A virtual field's read type is the `type` it declares — a `TypeDescriptor`, which the builder turns into the field's `outputType`. It takes three forms.

**1. A primitive type string** (for built-in JavaScript types):

```typescript
import { virtual } from '@opensaas/stack-core/fields'

const fullName = virtual({
  type: 'string',
  needs: ['firstName', 'lastName'],
  hooks: {
    resolveOutput: ({ item }) => `${String(item.firstName)} ${String(item.lastName)}`,
  },
})
```

**2. An import string** (for a custom type, written out explicitly):

```typescript
import { virtual } from '@opensaas/stack-core/fields'
import { Decimal } from 'decimal.js'

const totalPrice = virtual({
  type: "import('decimal.js').Decimal",
  needs: ['price', 'quantity'],
  hooks: {
    resolveOutput: ({ item }) => new Decimal(String(item.price)).times(String(item.quantity)),
  },
})
```

**3. A type descriptor object** (recommended for a custom type):

```typescript
import { virtual } from '@opensaas/stack-core/fields'
import { Decimal } from 'decimal.js'

const totalPrice = virtual({
  type: { value: Decimal, from: 'decimal.js' },
  needs: ['price', 'quantity'],
  hooks: {
    resolveOutput: ({ item }) => new Decimal(String(item.price)).times(String(item.quantity)),
  },
})
```

A descriptor also takes an optional `name`, for when the constructor's own name is not the exported one.

**Type generation:** a primitive string is used as written; an import string and a descriptor both produce a real import statement in the generated types, collected and deduplicated across every field.

**Use cases:** financial calculations where `number` loses precision, domain-specific return types, and types from any npm package.

### Authentication System

The stack provides optional Better-auth integration through `@opensaas/stack-auth`.

**Key files:**

- `packages/auth/src/config/plugin.ts` - `authPlugin()`, the auth configuration entry point
- `packages/auth/src/config/derive-auth-lists.ts` - The Auth lists, derived from better-auth's own table definitions
- `packages/auth/src/server/index.ts` - Better-auth server setup
- `packages/auth/src/adapter/` - The stack-authored **Auth adapter** over the Unsafe surface (ADR-0060)
- `packages/auth/src/client/index.ts` - Client-side auth hooks
- `packages/auth/src/ui/index.ts` - Pre-built UI components (SignInForm, SignUpForm, etc.)

**How it works:**

1. `authPlugin()` is added to the config's `plugins` array. It derives the Auth lists from better-auth's own resolved table definitions and configures better-auth's plugins and the session projection
2. The generator emits those lists into the contract like any other
3. Better-auth reaches the database through the stack-authored **Auth adapter** over the running context's Unsafe surface — its ORM lane for what a collection can express, typed SQL for the rest. There is no better-auth Prisma adapter in the path and no second client
4. The adapter's transaction option is implemented, so sign-up's user, account and session writes commit or roll back as one. Per ADR-0042 no isolation level is selectable and auth transactions run at Read Committed
5. Better-auth handles the OAuth flow and session management
6. The context carries the session into every access control function
7. Session fields are configurable (e.g. `['userId', 'email', 'name', 'role']`)

**See:** `packages/auth/CLAUDE.md` for detailed patterns and `examples/auth-demo` for usage.

### MCP Server Integration

The stack provides Model Context Protocol server integration through `@opensaas/stack-core/mcp` and `@opensaas/stack-auth/mcp`.

**Key files:**

- `packages/core/src/mcp/handler.ts` - Auth-agnostic MCP HTTP handlers
- `packages/core/src/mcp/types.ts` - MCP session types
- `packages/auth/src/mcp/better-auth.ts` - Better-auth OAuth adapter

**How it works:**

1. Enable MCP in config with `mcp: { enabled: true }` (the runtime reads `enabled`/`basePath`/`defaultTools`)
2. Core runtime derives CRUD tools for each list (query, create, update, delete) at request time
3. OAuth with AI assistants is wired through Better-auth's `mcp` plugin (`authPlugin({ betterAuthPlugins: [jwt(), mcp({ loginPage: '/sign-in', consentPage: '/consent', resource: '<canonical MCP URL>' })] })`, imported from `@opensaas/stack-auth/plugins` — the plugin itself comes from the optional `@better-auth/mcp` peer since better-auth 1.7 split it out of `better-auth/plugins`, and requires `jwt()` from `better-auth/plugins` registered alongside it) and the `createBetterAuthMcpAdapter` session provider
4. All tools respect existing access control rules, and the advertised vocabulary **omits** what a row-independent field rule denies this session — on reads and on writes alike, so a field a session can never see is not offered and asking for it anyway is refused exactly as an unknown name is (ADR-0053)
5. A `where` argument is the Where vocabulary, the same grammar `context.db` takes
6. Custom tools can be added per-list via `mcp.customTools` (Zod or JSON Schema inputSchema); plugins can register global tools via `registerMcpTool`

**See:** `packages/core/CLAUDE.md` and `packages/auth/CLAUDE.md` for detailed patterns, and `examples/mcp-demo` for usage.

## Critical Patterns

### 1. Naming Conventions

The stack uses consistent case conventions across different contexts:

**List Names in Config:** Always use **PascalCase**

```typescript
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

const lists = {
  User: list({ fields: { name: text() } }), // Good
  BlogPost: list({ fields: { title: text() } }), // Good
  AuthUser: list({ fields: { email: text() } }), // Good
}
```

Do not use lowercase (`user`) or snake_case (`blog_post`) list keys.

**Case Conversions:**

- **Contract models:** PascalCase, the config spelling (e.g. `AuthUser`, `BlogPost`)
- **Context DB properties:** PascalCase, the config spelling (e.g. `context.db.AuthUser`, `context.db.BlogPost`)
- **Admin UI URLs:** kebab-case (e.g. `/admin/auth-user`, `/admin/blog-post`)

There is no camelCase spelling of a list anywhere on the secured surface, and no helper that produces one.

**Utility Functions:**

```typescript
import { getUrlKey, getListKeyFromUrl } from '@opensaas/stack-core'

getUrlKey('AuthUser') // 'auth-user' - for constructing URLs
getListKeyFromUrl('auth-user') // 'AuthUser' - for parsing URLs
```

### 2. Creating Context in Applications

`pnpm generate` writes a context factory at `.opensaas/context.ts`. It takes the **session object itself**, or nothing at all:

```typescript
import { getContext } from '@/.opensaas/context'

// Anonymous access
const anonymous = await getContext()
const posts = await anonymous.db.Post.where({ published: { equals: true } }).all()

// Authenticated access
const context = await getContext({ userId: 'user-123' })
const mine = await context.db.Post.where({ authorId: { equals: 'user-123' } }).all()
```

**Pass the session's own fields, never a wrapper.** `getContext({ session })` is a bug that reads as signed in: the factory only distinguishes a session from `null`, and an object holding `undefined` is truthy. When the session may be absent, branch on it:

```typescript
import { getContext } from '@/.opensaas/context'

declare const userId: string | undefined

const context = userId ? await getContext({ userId }) : await getContext()
```

**Reads are composed, then run by a terminal.** `where`, `orderBy`, `select`, `include`, `limit`, `offset`, `cursor`, `distinct`/`distinctOn` build an immutable value; `all()`, `first()`, `aggregate()` and `nearest()` run it. A method appears on the surface only where the engine knows how to scope it — omission is the signal, not an oversight. A read materialises: no terminal is an async iterable, and a caller that needs a cursor uses `context.unsafe`.

**Writes take scalars plus `connect`.** `create({ data })`, `update({ where, data })` and `delete({ where })` are members of the list itself, never terminals chained off a composed read — and `where` there is the row's identity, `{ id }`, alone. `data` accepts the row's own columns plus `connect` on a field that owns the foreign key, where it lowers to a reachability query against the target's `query` access and a scalar foreign-key write. Assigning `null` clears the edge. There is no nested `create`/`update`/`delete`/`connectOrCreate`/`set`. A caller writing several rows atomically does so inside `context.transaction` (ADR-0050).

**Interactive transactions:** `context.transaction(async (txContext) => { … })` runs several access-checked, hook-firing `context.db` operations atomically. Unlike a transaction on `context.unsafe` (which bypasses access control and hooks), `txContext.db` keeps the security and validation boundary. The transaction takes no options — there is no isolation level to select, so a concurrency-sensitive invariant is expressed as a **row lock** on the contended parent: `.forUpdate()`, available only on a transaction-bound builder. See ADR-0012, ADR-0042 and ADR-0047, and `packages/core/CLAUDE.md`.

The lock is a **mutex on the row, not a fresh read of it**: the terminal reads first and locks second, so the columns it hands back are the row as of _before_ the lock. Everything the gate compares — the threshold as much as the count — is therefore read in its own statement _after_ the lock.

```typescript
import { getContext } from '@/.opensaas/context'

declare const slotId: string
declare const holder: string

const context = await getContext()

const result = await context.transaction(async (tx) => {
  // Take the lock BEFORE reading either side of the gate. Every racer takes the
  // same lock on the same parent row, so the reads below cannot go stale under
  // a concurrent booking.
  // `null` here means denied or gone — either way there is no gate to run.
  const held = await tx.db.Slot.where({ id: { equals: slotId } })
    .forUpdate()
    .first()
  if (held === null) return { booked: false }

  // `held.capacity` is the value as of before the lock; this re-read is not,
  // because no one else can commit an update to a row we hold.
  const slot = await tx.db.Slot.where({ id: { equals: slotId } }).first()
  const { taken } = await tx.db.Booking.where({ slotId: { equals: slotId } }).aggregate(
    (aggregate) => ({ taken: aggregate.count() }),
  )
  if (slot === null || taken >= slot.capacity) return { booked: false }

  return { booked: true, item: await tx.db.Booking.create({ data: { slotId, holder } }) }
})
```

**Getting the ORM client outside a request (module-init-time consumers):** there is no synchronous, framework-provided accessor. Config resolution is async — plugins can contribute config asynchronously — so the generated context's singleton client cannot be built without an `await`. Pick the shape that fits the consumer:

- **Can `await`:** use `getContext()`, and reach the ORM through `context.unsafe` when the secured surface cannot express what you need. This is the framework's singleton — no second connection.
- **Must construct synchronously at module scope, but only needs to defer method calls** (a library whose calls you can lazily forward): hand the generated `rawOpensaasContext` promise to a lazy `Proxy` that awaits it on first access. That is exactly what `@opensaas/stack-auth`'s `createAuth()` does to build better-auth's Auth adapter over the resolved context's Unsafe surface (`packages/auth/src/server/index.ts`):

  ```typescript
  // lib/auth.ts
  import { createAuth } from '@opensaas/stack-auth/server'
  import config from '../opensaas.config'
  import { rawOpensaasContext } from '@/.opensaas/context'

  export const auth = createAuth(config, rawOpensaasContext)
  ```

- **Must construct synchronously with a resolved client value** (a third-party contract that builds an adapter at import time, where deferring behind a Proxy is not an option): construct a Prisma 8 client of your own from the same committed `contract.json` the generated bundle imports, binding whatever pool you need. Do not import from `opensaas.config.ts` to do it — its default export can be a `Promise` when plugins are present, which defeats the point of a synchronous accessor.

  ```typescript
  // lib/sync-client.ts
  import postgres from '@prisma/orm-postgres/runtime'
  import { Pool } from 'pg'
  import { originTripwire } from '@opensaas/stack-core/origin'
  import type { Contract } from '../prisma/contract.d.js'
  import contractJson from '../prisma/contract.json' with { type: 'json' }

  export const syncClient = postgres<Contract>({
    contractJson,
    middleware: [originTripwire],
    pg: new Pool({ connectionString: process.env.DATABASE_URL }),
  })
  ```

  The type-only import of the emitted declarations is spelled `contract.d.js`,
  not `contract.d.ts`: the Contract module (`prisma/contract.ts`) sits in the
  same directory and TypeScript resolves `./contract.d.ts` to **it**.

  This client is a **second connection**, separate from the framework's singleton, and it carries none of `context.db`'s access control or hooks. Both are intentional for this use case; state them explicitly wherever the pattern is reused. Install the tripwire as shown — a client without it executes statements neither surface declared, which is exactly what the tripwire exists to refuse. See ADR-0014 and ADR-0059.

### 3. Silent Failures

Access-controlled operations return the empty value of the terminal's type when access is denied, rather than throwing: `null` from `first()`, `create`, `update` and `delete`; `[]` from `all()` and `nearest()`; `0` from a count. This prevents information leakage about whether records exist.

**Always check for null:**

```typescript
import { getContext } from '@/.opensaas/context'

declare const id: string
declare const data: { title: string }

const context = await getContext()
const post = await context.db.Post.update({ where: { id }, data })
if (post === null) {
  // Either doesn't exist OR the session doesn't have access
  throw new Error('Access denied')
}
```

An included to-one the related list's `query` access scopes away is `null`, and a to-many `[]`, **by arity alone** — so **every to-one read off an included row is a null check**, whatever the underlying column's nullability says. A required to-one is required to write and nullable to read (ADR-0058).

### 4. System Fields

`id` is the only column the generator adds on its own. `createdAt`/`updatedAt` are **off by default** (ADR-0004, `resolveListTimestamps` in `packages/core/src/contract/derive.ts`): a list opts in by declaring the two fields itself or by setting `db: { timestamps: true }`, per list or on `db` for every list at once.

All three names, where the list has them, are:

- Excluded from access control (always readable)
- Excluded from field-level write operations

`updatedAt` is maintained **application-side**, with no database backstop: a write that bypasses the ORM — `psql`, a reconcile, `context.unsafe` — leaves it stale, and an `update` with an empty payload no longer moves it (ADR-0048).

The id's type is per list, from `db.idField`. Read it from the contract rather than assuming a string; the admin's routing, MCP's arguments and the generated Zod schemas all go through one contract-driven boundary coercion for exactly that reason.

### 5. Relationship Patterns

Relationships support two `ref` formats: `'ListName.fieldName'` (bidirectional) or `'ListName'` (list-only).

**Bidirectional relationships** (both sides define the relationship):

- One-to-many: `posts: relationship({ ref: 'Post.author', many: true })`
- Many-to-one: `author: relationship({ ref: 'User.posts' })`

**List-only relationships** (only one side defines the relationship):

- Many-to-one: `category: relationship({ ref: 'Category' })`
- One-to-many: `tags: relationship({ ref: 'Tag', many: true })`

**How list-only refs work:**

- With `ref: 'Category'` (no field named), the stack adds a **synthetic back-relation** on the target, because the ORM requires an opposite field there even though no list config declares one
- It is named `from_<SourceList>_<field>` (e.g. `from_Post_category`), and is always to-many
- Wherever a caller can name it, it is treated as the declared relationship field it stands for: the Access Filter and Field Visibility scope, gate and compute through it exactly as they would a declared relationship

**Example:**

```typescript
import { list } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'

const lists = {
  User: list({
    fields: {
      name: text(),
      // Bidirectional: User has many Posts
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  }),
  Category: list({
    fields: {
      name: text(),
      // No relationship field needed here
    },
  }),
  Post: list({
    fields: {
      title: text(),
      // Bidirectional: Post belongs to User
      author: relationship({ ref: 'User.posts' }),
      // List-only: Post belongs to Category
      category: relationship({ ref: 'Category' }),
    },
  }),
}
```

**One-to-one** is two `many: false` declarations. The owning side — by `db.foreignKey`, else alphabetical, else field name — carries the foreign-key column and its unique constraint; the other side is the inverse. One hop holds on **both** sides, with no exception (ADR-0064).

**Many-to-many** is not generated implicitly: `many: true` on both sides is a generate-time error. Declare a junction list with its own surrogate id and a unique pair index, and write its rows like any other list (ADR-0048).

**Writing an edge:**

```typescript
import { getContext } from '@/.opensaas/context'

declare const authorId: string

const context = await getContext()
const post = await context.db.Post.create({
  data: { title: 'Hello', author: { connect: { id: authorId } } },
})
if (post === null) throw new Error('Access denied')
```

`connect` is legal **only on the field that owns the foreign key**. On an inverse to-many, the non-owning side of a one-to-one, or a junction list, it is a generation error — there it would be N secured writes against another list wearing one field's name.

## Comments

**Default to none.** The code says what it does; a good name says why it exists. A comment that restates either is a second copy of the truth that nothing keeps in sync — and prose is the only part of a file no test can falsify.

A comment earns its place when it carries something the code **cannot**:

- A constraint from outside the file — Prisma's behaviour, a Better-auth contract, a Next.js server/client boundary, a browser quirk, an upstream bug being worked around. Link it.
- A warning where the obvious edit is the wrong one. `validation: { isRequired: true }` is an application-layer check and does **not** make the column non-null — that needs `db: { isNullable: false }`. The reader is about to make the mistake; the comment is the only thing in their way.
- A **Known limits** block on a generator, migration script, or introspector, naming what it cannot handle. That is not derivable from the code — the code is precisely the part that does not handle those cases.

Everything else that feels worth writing is **rationale, and rationale does not belong beside code.** Put it in an ADR (`docs/adr/`), the issue, the changeset, or the PR body. Those are dated, reviewed, and explicitly superseded when they stop being true. A docblock is none of those: it decays silently, and it decays fastest next to the values most likely to change.

Two tests before keeping one:

1. **Staleness.** If someone edits the line below, does the comment become false? If yes and no test would catch it, it is a liability, not documentation. `const MAX_BATCH = 3` annotated "Three, not 'a few'" becomes a lie the moment anyone writes `5`.
2. **Restatement.** Does it say what the line already says? Delete the comment, not the line.

**Never comment the absence of something.** No note explaining why there is no type annotation, no `// no-op`, no record of what the code used to be. Git holds that, and a reader who needs it can ask git.

A file header should orient a reader in a line or two. If it needs a page, the explanation belongs in a doc or an ADR and the file should link to it — a nine-line docblock above `export const lists = {}` is the shape to avoid.

**Public API docblocks are the deliberate exception.** Exported config options, field builders, and plugin surfaces carry TSDoc because it is what the consumer's editor shows — that is a contract, not a narration of the implementation beneath it.

See `docs/agents/comments.md` for worked before/after examples of applying this rule, including where the judgment calls above land in practice.

## Development Workflow

### Making Changes to Core

1. Edit TypeScript files in `packages/core/src/`
2. Build with `pnpm build` (or `pnpm dev` for watch mode)
3. Test changes in an example:
   ```bash
   cd examples/blog
   pnpm generate  # Regenerate if config types changed
   pnpm dev -- tsx test-access-control.ts  # Run a script against the dev loop's database
   ```

### Adding New Field Types

**IMPORTANT:** Field types are fully self-contained. Do NOT add switch statements to core or UI packages.

1. **Define the field type** in `packages/core/src/config/types.ts`:

   ```typescript
   export type MyCustomField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
     type: 'myCustom'
     customOption?: string
   }
   ```

2. **Create the field builder** in `packages/core/src/fields/index.ts`:

   ```typescript
   export function myCustom(options?: Omit<MyCustomField, 'type'>): MyCustomField {
     return {
       type: 'myCustom',
       ...options,
       getZodSchema: () => z.string().optional(),
       getContractField: (fieldName) => ({
         kind: 'column',
         name: fieldName,
         type: { pack: 'pg', type: 'text' },
         nullable: true,
       }),
     }
   }
   ```

3. **Register UI component** (optional, for admin UI):

   ```typescript
   import { registerFieldComponent } from '@opensaas/stack-ui'
   import { MyCustomFieldComponent } from './components/MyCustomField'

   registerFieldComponent('myCustom', MyCustomFieldComponent)
   ```

**Key Principle:** The field config object drives ALL behavior. Generators, validators, and UI components delegate to field methods. Never add switch statements based on field type in core or UI packages.

### UI Package Architecture & Composability

The UI package (`@opensaas/stack-ui`) offers multiple levels of abstraction through specialized exports:

#### Package Exports

```typescript
// Full admin UI (all-in-one solution)
import { AdminUI } from '@opensaas/stack-ui'

// Primitives (shadcn/ui components for custom UIs)
import { Button, Input, Dialog, Card, Table } from '@opensaas/stack-ui/primitives'

// Composable field components
import { TextField, SelectField, RelationshipField } from '@opensaas/stack-ui/fields'

// Standalone composable components
import { ItemCreateForm, ItemEditForm, ListTable } from '@opensaas/stack-ui/standalone'

// Server utilities: the field-config serialisation the server→client boundary uses
import { serializeFieldConfigs } from '@opensaas/stack-ui/server'
```

#### Composability Patterns

**1. Full AdminUI** - Complete admin interface with routing:

```tsx
<AdminUI context={context} config={config} />
```

**2. Standalone Components** - Drop-in CRUD components:

```tsx
import { ItemCreateForm, ListTable } from '@opensaas/stack-ui/standalone'

// Create form in a custom page
<ItemCreateForm
  listKey="Post"
  context={context}
  onSuccess={(item) => router.push(`/posts/${item.id}`)}
/>

// Table in a custom layout
<ListTable
  listKey="Post"
  context={context}
  columns={['title', 'author', 'createdAt']}
/>
```

**3. Primitives** - Build custom UIs with shadcn components:

```tsx
import { Card, Button } from '@opensaas/stack-ui/primitives'
;<Card>
  <Button onClick={handleAction}>Custom Action</Button>
</Card>
```

**See:** `examples/composable-dashboard` for complete working examples of all composability patterns.

### Customizing Field Components

The UI layer uses a component registry pattern to avoid switch statements and enable extensibility.

**Two approaches for custom field components:**

1. **Global Registration** - Register a component for reuse across multiple fields:

   ```typescript
   import { registerFieldComponent } from '@opensaas/stack-ui'
   import { ColorPickerField } from './components/ColorPickerField'

   // Register once at app startup
   registerFieldComponent('color', ColorPickerField)

   // Use in multiple fields by referencing the fieldType
   const fields = {
     favoriteColor: text({ ui: { fieldType: 'color' } }),
     themeColor: text({ ui: { fieldType: 'color' } }),
   }
   ```

2. **Per-Field Override** - Pass a component directly for one-off customization:

   ```typescript
   import { SlugField } from './components/SlugField'

   const fields = {
     slug: text({ ui: { component: SlugField } }), // Used only for this field
   }
   ```

**Component Resolution Priority:**

1. `ui.component` (per-field override) - highest priority
2. `ui.fieldType` (global registry lookup by custom type name)
3. `fieldConfig.type` (default registry lookup by field type)

**See:** `examples/custom-field` for a complete working example demonstrating both patterns.

### Creating Third-Party Field Packages

The stack supports third-party field packages as separate npm packages. This allows developers to add rich functionality without bloating the core stack.

**Example:** `@opensaas/stack-tiptap` - Rich text editor integration

**Package Structure:**

```
packages/my-field/
├── src/
│   ├── fields/
│   │   └── myField.ts          # Field builder: Zod schema + contract descriptor
│   ├── components/
│   │   └── MyFieldComponent.tsx # React component (client-side)
│   ├── styles/
│   │   └── my-field.css        # Optional styles
│   └── index.ts                # Public exports
├── package.json
└── README.md
```

**Key Requirements:**

1. **Field Builder** - Must implement `BaseFieldConfig`:

   ```typescript
   import type {
     BaseFieldConfig,
     ContractFieldDescriptor,
     TypeInfo,
   } from '@opensaas/stack-core/extend'
   import { z } from 'zod'

   export type MyField = BaseFieldConfig<TypeInfo> & {
     type: 'myField'
   }

   export function myField(options?: Omit<MyField, 'type'>): MyField {
     return {
       type: 'myField',
       ...options,
       getZodSchema: () => z.string().optional(),
       getContractField: (fieldName): ContractFieldDescriptor => ({
         kind: 'column',
         name: fieldName,
         type: { pack: 'pg', type: 'text' },
         nullable: true,
       }),
     }
   }
   ```

   A field whose column type comes from an **Extension pack** names that pack in its descriptor (`type: { pack: 'pgvector', type: 'Vector', args: [1536] }`), and the package contributes the declaration through its own plugin's `addExtension` rather than asking the application to write `db.extensions` itself. A field naming a pack the config does not declare fails `pnpm generate`.

2. **React Component** - Must accept standard field props:

   ```typescript
   export interface MyFieldProps {
     name: string
     value: string | null
     onChange: (value: string | null) => void
     label: string
     error?: string
     disabled?: boolean
     required?: boolean
     mode?: 'read' | 'edit'
     // Plus your own UI options, passed through from fieldConfig.ui
   }
   ```

3. **Client-Side Registration** - Due to Next.js server/client boundaries:

   ```typescript
   // lib/register-fields.ts
   'use client'

   import { registerFieldComponent } from '@opensaas/stack-ui'
   import { MyFieldComponent } from '@my-org/my-field'

   registerFieldComponent('myField', MyFieldComponent)
   ```

   A bare side-effect import of that module from `page.tsx` does **not** register anything: a
   `'use client'` module only reaches the browser when the tree renders it, and `page.tsx` is a
   server component. Carry the import in a client component and render it:

   ```tsx
   // app/admin/[[...admin]]/FieldRegistration.tsx
   'use client'

   import '../../../lib/register-fields'

   export function FieldRegistration() {
     return null
   }
   ```

   ```tsx
   // app/admin/[[...admin]]/page.tsx
   import { FieldRegistration } from './FieldRegistration'
   ;<>
     <FieldRegistration />
     <AdminUI {...props} />
   </>
   ```

   `pnpm check:client-side-effect-imports` fails on the broken shape.

4. **FieldConfig Extensibility** - Core types support third-party fields:
   ```typescript
   // FieldConfig is BaseFieldConfig itself, so any field a third-party
   // package builds is already a FieldConfig — no union to extend.
   export type FieldConfig = BaseFieldConfig<TypeInfo>
   ```

**See:**

- `packages/tiptap/` - Complete reference implementation
- `examples/tiptap-demo/` - Usage example with client-side registration

### Testing Access Control Changes

Tests stand up a real, fully secured **Test context** rather than faking the secured surface: `createTestContext(config, session)` from `@opensaas/stack-core/testing` builds the same engine, tripwire and terminals as production over an in-process database. There is no in-memory imitation of the surface's guarantees, and no test-only seam on the wrapper (ADR-0057).

A guarantee the in-process database cannot exercise — row-lock contention, real pool concurrency — is an **Escape-only test**: it skips visibly when `DATABASE_URL` names no Postgres, and CI sets the escape on every job so the gate still covers it. `packages/core/src/secured/capacity-gate.test.ts` is the worked example.

`examples/blog`'s access-control script exercises the paths a reviewer usually wants: anonymous vs. authenticated sessions, published vs. draft posts, author vs. non-author, and a field-level denial.

## Important Considerations

### TypeScript Module System

This project uses ESM (`"type": "module"` in package.json):

- Package sources import each other with `.js` extensions (not `.ts`)
- The **generated bundle** is the exception: its relative imports carry explicit `.ts` extensions, because plain Node loads it by type-stripping and never sees a compiled twin (ADR-0054)
- Use `import type` for type-only imports
- Config: `moduleResolution: "bundler"`, `module: "ESNext"`

### Access Control Session Object

The `session` object passed to access control functions is user-defined. The stack only requires that it exists and does not enforce a structure. The common pattern is an object carrying a user id, or `null` for anonymous. Augment the `Session` interface to type it — see `packages/core/CLAUDE.md`.

### Contract-Driven Type Safety

The generated types instantiate core's contract-keyed generics: `.opensaas/types.ts` declares only the **contract remainder** — a computed field's output type, a stored field's TypeScript override, each field's declared dependency set, whether the list is a singleton — and everything else is read from `contract.d.ts` (ADR-0052).

```typescript
import { getContext } from '@/.opensaas/context'

const context = await getContext()
const posts = await context.db.Post.select('id', 'title').all()
// posts[0] is exactly { id, title } plus the list's system fields
```

A `where` naming a column the list does not have, a `select` naming a relation, a `forUpdate()` outside a transaction, and a `nearest()` on a list with no vector column are all **compile errors**, not runtime refusals.

### UI Options Pass-Through

The UI layer automatically passes custom UI options from field configs to components:

```typescript
import { richText } from '@opensaas/stack-tiptap/fields'

const fields = {
  content: richText({
    ui: { placeholder: 'Write your content...', minHeight: 300, maxHeight: 800 },
  }),
}
```

The component receives `placeholder`, `minHeight` and `maxHeight` as props. `FieldRenderer` extracts `component` and `fieldType` from `ui`, then passes everything else through — so a field type can define custom UI behaviour without modifying core stack code.

### Costs taken knowingly

These are decisions, not defects. `specs/prisma-8/architecture-spec.md` section 14 carries the full list with its records.

- `updatedAt` is application-side; a write outside the ORM leaves it stale
- `needs` outranks a read denial, so `needs: ['passwordHash']` is a real leak channel owned by whoever writes it
- A `resolveOutput` hook reading an undeclared column breaks silently unless it is typed through `Lists.<List>.TypeInfo`, where it is a compile error
- Every to-one read off an included row is a null check, `NOT NULL` column or not
- A secured read holds its whole result; bounding a large read is the caller's job
- A row lock is two round trips, and `.forUpdate().all()` binds a bounded key set
- A required-foreign-key cycle is unwritable through the secured surface
- `contains` and text equality in filter URLs are case-insensitive; a to-many count filter other than presence degrades to free text
- An approximate vector scan under a selective access filter can return fewer rows than asked for
- The Auth adapter implements no joins and no schema creation, so better-auth's own CLI is unsupported
- `pnpm db:update` requires the dev loop to be running, and a destructive mid-session change restarts the app

## Testing

Tests use Vitest. Run from a package:

```bash
cd packages/core
pnpm test
```

## Publishing Packages

This monorepo uses changesets for versioning and publishing. Every change to a package must be accompanied by a new changeset file.

**IMPORTANT:** When working with Claude Code, you MUST use the `pr-changeset` skill to create changeset files. The changeset CLI doesn't work in the Claude Code environment, so use the skill instead.

The `pr-changeset` skill:

- Automatically creates changeset files in `.changeset/` directory
- Enforces versioning rules (patch for bug fixes, minor for features, major only when explicitly requested)
- Provides templates and examples for proper changeset format
- Ensures consistent changeset descriptions across the project

**Versioning Rules:**

- **patch**: Bug fixes only (max 2 lines)
- **minor**: New features or enhancements (include usage examples)
- **major**: Breaking changes (only when user explicitly requests, include migration guide)

**Manual changeset creation (if not using Claude Code):**

1. Create a changeset:

```bash
pnpm changeset
```

Then follow the prompts to select packages and version bumps.

2. Commit changes including the changeset file.
   Version bumping and publishing is handled automatically by changesets during release in a GitHub Action.

## Publishing Plugins

Claude plugins in `claude-plugins/*` use direct semver versioning in JSON files. Whenever you modify plugin code, skills, commands, agents, or marketplace root files, you must bump the version using the `plugin-version` skill.

**IMPORTANT:** When working with Claude Code, you MUST use the `plugin-version` skill to bump plugin versions. It handles both the plugin's own `plugin.json` and the matching entry in `.claude-plugin/marketplace.json`.

The `plugin-version` skill:

- Detects which plugin directories changed (`claude-plugins/opensaas-stack/`, `claude-plugins/opensaas-migration/`, `.claude-plugin/`)
- Determines patch vs minor bump (patch for fixes, minor for new capabilities, major only when explicitly requested)
- Directly edits version fields in JSON — no changeset files
- Keeps `plugin.json` and `marketplace.json` plugin entries in sync
- Only bumps `marketplace.metadata.version` when the marketplace structure itself changed (not just plugin version numbers)

- Data passed in as props to a component that is marked with `"use client"` must be serialised and must only contain the minimum data required to make that component work
- Avoid the use of the `any` type, and do not use type casting. All types must be strongly typed to ensure type safety — the `unknown` and `any` types must never be exposed as an external type and are only to be used internally (within a package) where absolutely necessary

- All new examples must have a package name of `opensaas-<example-name>-example` to ensure consistency across the monorepo

- when installing packages first check if the package is in use in another package or example and then make sure the versions match across all packages and examples to avoid multiple versions of the same package being installed

- when adding a new example always use the `create-opensaas-app` script from @packages/create-opensaas-app - this will ensure the example is setup correctly and that the init script is kept up to date with any changes

- Always run `pnpm lint` `pnpm manypkg fix` and `pnpm format` to ensure code quality and consistency before committing any changes

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`OpenSaasAU/stack`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

- The repo URL is `https://github.com/OpenSaasAU/stack` and the docs site is `https://stack.opensaas.au/`
