# @opensaas/stack-core

Core stack providing config system, access control engine, hooks, field types, and generators.

## Purpose

The foundation of OpenSaas Stack. Defines the config DSL, executes access control, runs hooks, and generates Prisma schema and TypeScript types from config.

## Entry Points

The package exposes a curated surface across several import paths. Use the narrowest one that fits:

- **`@opensaas/stack-core`** (root) — the everyday consumer surface: `config`, `list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`, `getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate with (`OpenSaasConfig`, `ListConfig`, `FieldConfig`, `AccessControl`, `FieldAccess`, `Session`, `AccessContext`, `PrismaFilter`, `OperationAccess`).
- **`@opensaas/stack-core/fields`** — field builder functions (`text()`, `integer()`, …) and their config types (`TextField`, `IntegerField`, `DecimalField`, `CalendarDayField`, …, plus `PrismaRelationResult`). The builders and the types they produce live together here.
- **`@opensaas/stack-core/extend`** — authoring contracts: implement these to build a plugin (`Plugin`, `PluginContext`, `GeneratedFiles`) or a third-party field package (`BaseFieldConfig`, `TypeInfo`, `TypeDescriptor`).
- **`@opensaas/stack-core/mcp`** — MCP runtime handlers.
- **`@opensaas/stack-core/internal`** — `@internal` plumbing shared between the `@opensaas/*` packages and generated `.opensaas/` code. **No semver guarantees**; application code should never import from here.

`Session` deliberately stays on the root entry point because it is the module-augmentation target (`declare module '@opensaas/stack-core'`).

## Key Files & Exports

### Config (`src/config/`)

- `types.ts` - Core type definitions (`OpenSaasConfig`, `ListConfig`, `FieldConfig`, etc.)
- `index.ts` - Builder functions (`config()`, `list()`)
- `schema.ts` - Zod schemas for validation

### Fields (`src/fields/index.ts`)

Field builder functions, each returning object with:

- `getZodSchema(fieldName, operation)` - Validation schema
- `getPrismaType(fieldName)` - Prisma type and modifiers
- `getTypeScriptType()` - TypeScript type and optionality

Built-in fields:

- `text({ validation, ui, hooks })` - String field
- `integer({ validation, ui, hooks })` - Number field
- `checkbox({ defaultValue, ui, hooks })` - Boolean field
- `timestamp({ defaultValue, ui, hooks })` - DateTime field
- `password({ validation, ui, hooks })` - Hashed password (excluded from reads)
- `select({ options, validation, ui, hooks })` - Enum field
- `relationship({ ref, many, ui })` - Foreign key relationship
- `json({ validation, ui, hooks })` - JSON field for arbitrary JSON data
- `virtual({ type, hooks })` - Computed field not stored in database

### Access Control (`src/access/`)

- `engine.ts` - Core execution logic (`applyAccessControl()`)
- `types.ts` - Type definitions (`AccessControl`, `OperationAccessControl`, `Session`, etc.)

Access control functions receive `{ session, context, item, operation }` and return:

- `boolean` - Allow/deny
- `Prisma filter object` - Scope access to matching records

A plugin's `runtime(context, sudo)` factory receives a `sudo` helper as a plain **second argument** — `sudo(): AccessContext` returns an access-bypassing (but still hook-firing) context, for reads/writes that must not depend on the caller's own list access policy (e.g. an auth plugin resolving "who is this session" independent of the User list's access rules). It's the same escape hatch as `StackContext.sudo()`, exposed one layer lower. It is deliberately **not** a method on `AccessContext` itself — a self-referential `sudo(): AccessContext` field on that shared, widely-instantiated interface was found to break TypeScript's structural checking of unrelated generated Prisma types (nullable JSON `CreateInput` fields) in a downstream app.

### Session Typing (`src/access/types.ts`)

The `Session` interface can be augmented to provide type safety and autocomplete for session fields.

**Default:** Session is a permissive object: `interface Session { [key: string]: unknown }`

**Module Augmentation Pattern:**

```typescript
// types/session.d.ts (create this file in your project)
import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    userId: string
    email: string
    role: 'admin' | 'user'
    organizationId?: string
  }
}
```

**Benefits:**

- Autocomplete in access control functions
- Type safety when accessing session properties
- Single source of truth for session shape
- Works with any auth provider (Better Auth, custom, etc.)

**Usage after augmentation:**

```typescript
// Access control - fully typed
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin' // ✅ 'role' is typed as 'admin' | 'user'
  //             ↑ Autocomplete shows: userId, email, role, organizationId
}

// In server actions
const context = await getContext(session)
context.session?.email // ✅ Typed as string
```

**For Better Auth users:** See `@opensaas/stack-auth` documentation for examples of extracting Better Auth session types.

### Hooks (`src/hooks/`)

- `index.ts` - Hook execution logic
- Types in `config/types.ts`

Hook types:

- `resolveInput` - Transform input data
- `resolveOutput` - Transform output data
- `validateInput` - Custom validation
- `beforeOperation` - Side effects before DB operation
- `afterOperation` - Side effects after DB operation

### Context (`src/context/index.ts`)

- `createContext(config, prisma, session?)` - Creates context wrapper
- Returns `{ db, session }` where `db` is Prisma client with access control
- `context.transaction(fn, options?)` - Interactive, hook-firing transaction (see below)

#### Interactive transactions (`context.transaction`)

`context.transaction(async (txContext) => { … }, { isolationLevel })` runs the
callback inside **one** Prisma interactive transaction. `txContext` is a full
context whose `db.*` operations are access-checked and hook-firing exactly like
the request context, but persist against the transaction client — so every write
in the callback is **atomic** and a throw anywhere rolls the whole transaction
back. This is the secured alternative to raw `prisma.$transaction`, which
bypasses access control and hooks.

Use it to atomically enforce concurrency-sensitive invariants (e.g. a
capacity/quota gate) while preserving the access/hook boundary:

```typescript
async function bookSlot(context: StackContext, slotId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await context.transaction(
        async (tx) => {
          const count = await tx.db.booking.count({ where: { slotId } })
          if (count >= CAPACITY) return { booked: false }
          return { booked: true, item: await tx.db.booking.create({ data: { slotId } }) }
        },
        { isolationLevel: 'Serializable' },
      )
    } catch (err) {
      // Serialization failures (Prisma P2034) PROPAGATE — the caller owns retry.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2034') continue
      throw err
    }
  }
  throw new Error('exceeded retry budget')
}
```

Key points:

- **Options pass through** to Prisma — `isolationLevel` (incl. `'Serializable'`),
  `maxWait`, `timeout`.
- **Serialization failures propagate** (they are NOT converted to a silent
  `null`), so the caller can implement a retry loop. Built-in retry is not
  provided — the caller owns it (matching Keystone 6's `context.transaction`).
- **Nested `context.db` writes join** the outer transaction (a Prisma tx client
  exposes no `$transaction`, so the Write Pipeline's existing fallback runs them
  against the active client).
- If the client cannot open an interactive transaction (e.g. a test mock, or you
  are already inside one), `fn` runs directly with identical hook/access
  semantics. See ADR-0012.
- **A transaction-boundary `afterTransaction` reports the OUTERMOST transaction,
  not its own write's return (ADR-0028).** A write nested in `context.transaction()`
  (or a hook's own `context.db` write) cannot itself observe when the enclosing
  transaction settles, so its `afterTransaction` is deferred until the owner —
  `context.transaction()`, or the Write Pipeline when it opened the transaction —
  observes the real commit/rollback. `beforeTransaction` stays eager in every
  case, so under `context.transaction()` it runs with that transaction already
  open (keep it fast; a `context.db` write from it can block on rows the
  transaction itself is writing). Status is a conjunction — `committed` iff the
  write itself succeeded AND the enclosing transaction committed, the write's
  own error always winning otherwise — and the deferred `item` is the row as
  that write persisted it, not re-read at flush (so a later same-record write in
  the same transaction leaves it stale). Because of this, a **rejected
  `context.transaction()` no longer implies rollback**: a deferred hook that
  throws after a successful commit rejects the call with `AfterTransactionError`
  over already-final data, though a transaction/serialization error (e.g.
  `P2034`) still takes precedence and propagates unwrapped. A write with no
  transaction owner at all (an app-managed `prisma.$transaction`, or a client —
  e.g. a bare test mock — that cannot open one) still fires `afterTransaction`
  optimistically at write time, unchanged. See ADR-0028 and the hooks concept
  doc.

#### Substituting a session (`context.withSession`, #980)

`context.withSession(session)` sits beside `sudo()` on the other axis:
`sudo()` keeps the session and drops access control; `withSession()` keeps
access control (and hooks) and swaps the session. It reuses the receiver's
already-resolved config, client (including a transaction client — a call
inside `context.transaction()` stays in that transaction), and storage.

Like `sudo()` (and unlike `transaction()`), plugin runtime services are
**rebuilt, not reused** — `plugin.runtime(context, sudo)` factories are
re-run so any plugin service that closes over the session (e.g. an auth
plugin's "who is this session" lookup) binds to the _new_ one rather than
staying stale. A hot loop calling `withSession()` per iteration re-runs
every plugin's `runtime()` each time; batch via a shared derived context
where the loop body doesn't need a different session per iteration.

```typescript
// An unattended dispatcher running a committed intent, or any job runner
// that is legitimately authorised but arrives without the session a list's
// validate hook wants to see in `args.context.session`.
async function dispatchJob(context: StackContext, job: { ownerSession: Session }) {
  const asOwner = context.withSession(job.ownerSession)
  await asOwner.db.task.update({ where: { id: job.taskId }, data: { status: 'done' } })
}
```

**`withSession` grants no authority of its own.** It is not an
authorisation — the derived context can do exactly what any context built
with that session directly could do; access rules still evaluate against
the new session. The application decides who may call it.

**Orthogonal to `sudo()`.** `context.withSession(s).sudo()` and
`context.sudo().withSession(s)` are equivalent — both elevated and both
carrying `s`. `withSession` preserves the receiver's sudo state rather than
resetting it: called on an already-sudo context it stays sudo, called on a
plain context it does not grant sudo.

`withSession(null)` is a legitimate way to drop to an anonymous context.

### Generators (`src/generator/`)

- `prisma.ts` - Generates `prisma/schema.prisma` from config
- `types.ts` - Generates `.opensaas/types.ts` TypeScript definitions
- `context.ts` - Generates `.opensaas/context.ts` context factory

Run via CLI: `pnpm generate`

### Utilities (`src/lib/case-utils.ts`)

Public naming helpers (exported from the root entry point):

- `getDbKey(listKey)` - PascalCase → camelCase (e.g., `BlogPost` → `blogPost`)
- `getUrlKey(listKey)` - PascalCase → kebab-case (e.g., `BlogPost` → `blog-post`)
- `getListKeyFromUrl(urlKey)` - kebab-case → PascalCase (e.g., `blog-post` → `BlogPost`)

The lower-level converters (`pascalToCamel`, `pascalToKebab`, `kebabToPascal`, `kebabToCamel`) are internal plumbing on `@opensaas/stack-core/internal`.

## Architecture Patterns

### Field Self-Containment

Fields are fully self-contained. No switch statements in core:

```typescript
// Field defines its own behavior
export function text(options) {
  return {
    type: 'text',
    ...options,
    getPrismaType: () => ({ type: 'String', modifiers: '?' }),
    getTypeScriptType: () => ({ type: 'string', optional: true }),
    getZodSchema: (fieldName, operation) => z.string().optional(),
  }
}

// Generator delegates to field
const prismaType = field.getPrismaType(fieldName)
```

### Access Control Execution Flow

1. User calls `context.db.post.update({ where, data })`
2. Context wrapper intercepts call
3. Check operation-level access → returns boolean or filter
4. Merge filter with user's `where` clause
5. Execute Prisma operation
6. Apply field-level read access (filter readable fields)
7. Return result or `null`/`[]` on access denial

### Hook Execution Order (Write)

1. List `resolveInput`
2. Field `resolveInput` (e.g., hash password)
3. List `validate`
4. Field `validate`
5. Field validation (isRequired, length, min/max)
6. Field-level access control (filter writable fields)
7. Field `beforeOperation`
8. List `beforeOperation`
9. **Database operation**
10. List `afterOperation`
11. Field `afterOperation`

### Hook Execution Order (Read)

Reads run no `afterOperation` (list or field):

1. **Database operation**
2. Field-level access control (filter readable fields)
3. Field `resolveOutput`

### Narrowing Reads (`select` is not honoured)

`context.db` reads (`findUnique`, `findMany`) do **not** apply Prisma's `select` semantics. Narrow a read with `include` (for relationships) or a fragment `query` instead. Passing `select` is a visible no-op: the op logs a one-time `console.warn` and still returns the full, access-filtered record. Field-level visibility is always enforced by access control regardless of `select`, so there is no leak — only a correctness/perf footgun the warning surfaces.

### A Bare Read Fetches Scalars, Not Relations (ADR-0024)

A read with no `include` and no fragment `query` returns the row's own columns plus its virtual fields — **never relations** — matching Prisma's own default. `findUnique`, `findMany`, and a singleton's `get()` all follow this rule uniformly, under sudo and under a session alike. Relations are fetched only when a caller names them via `include` or a fragment `query`, at which point the caller-directed access-scoping walk (`buildAccessScopedInclude`, ADR-0026) applies (#566/#830 unaffected). Foreign-key columns (e.g. `authorId`) are unaffected and always returned, so a relation stays reachable by id without an `include`. A `resolveOutput` hook that issues its own bare `context.db` read is subject to the same rule — reading `item.<relation>` inside such a hook silently returns `undefined` unless the hook's own read names that relation. See `docs/adr/0024-a-read-with-no-include-fetches-scalars-not-relations.md`.

### Naming a Relation Fetches Its Columns, Not Its Subtree (ADR-0026)

The bare-read rule above applies at **every level**, not only the root: naming a relation in an `include` fetches that relation's own columns and stops — its own further relations are returned only if the request nests an `include` for them too. `include: { author: true }` returns `author`'s scalar columns; reaching `author.organization` means writing `include: { author: { include: { organization: true } } }`. This is the "One hop" rule (see the glossary entry in `CONTEXT.md`).

The read pipeline is **caller-directed**: `buildAccessScopedInclude` walks only the branches a request (a caller `include`, a fragment `query`'s projection, or a field's folded `needs`) itself names, and never evaluates a related list's operation-level `query` access for a relation nobody asked for. There is no separate "build the full access-scoped tree for the whole list, then reconcile against what was requested" pass — the old `buildIncludeWithAccessControl` + `mergeIncludeWithAccessControl` two-step this replaced. `READ_INCLUDE_MAX_DEPTH` is a cost limit on how deep a request may reach, not a security boundary: nothing walks the relationship graph unprompted anymore, so there is no unscoped subtree left to fail open on past the cap — a request naming a relation at or beyond the cap still throws `AccessScopeDepthExceededError` (ADR-0022), now worded as a cost refusal rather than a scoping failure.

**Migration note (silent break):** an `include` that named a relation bare and read past it one hop (`item.<named>[0].<unnamed>`) now gets `undefined` for the unnamed part — no error. Grep for caller includes whose consumers read past the relation actually named, and add the deeper relation explicitly to the `include`.

A computed field's declared dependency (`needs`, ADR-0025, below) folds in at **every** relation it's reached through, including one added purely to satisfy another field's own `needs` — the fold recurses through `foldDeclaredDependencies` rather than riding a caller-named relation's auto-expanded subtree, since nothing auto-expands anymore. See `docs/adr/0026-naming-a-relation-fetches-its-columns-not-its-subtree.md`.

### A Computed Field Runs Only When It Is Going To Be Returned (ADR-0027)

A computed field — any field carrying a `resolveOutput` hook, virtual or not — is computed **if and only if the read is actually going to return it**, and its declared relations (`needs`) are fetched under exactly the same condition. A fragment `query` selecting three fields runs only those three fields' hooks (and folds only their `needs`); a field it doesn't select does no work at all — neither its field-level `read` access nor its hook runs. This is **projection-aware, never access-aware**: a fragment's own field selection is the only thing that restricts a level this way. A bare read or an `include`-based read is unaffected — every computed field on the list still computes, exactly as before, since neither ever had a narrower field selection to restrict by. The rule applies at every nesting level: a nested fragment selecting a subset computes only that subset there; a nested `include` still computes every computed field at that level.

**A computed field's hook never sees another computed field's resolved output**, on any read path — only the row's stored columns and its own declared dependencies. A sibling field that was skipped (unselected by a fragment) or denied by field-level access is absent from what the hook sees, never present holding its raw pre-hook value — reaching for it finds nothing there, the same as reaching for a relation never declared via `needs`. Before this, a virtual field received the already-assembled, already-resolved object, so a virtual field could accidentally read an earlier-declared virtual's resolved value purely by declaration order; reordering two such fields silently changed the result. That accidental coupling is gone: recompute from the stored columns both fields share instead.

A hookless virtual field (one with `access.read` but no `resolveOutput`) has its read access evaluated on no read at all — such a field can never produce output, so there's nothing to preserve access side effects for. See `docs/adr/0027-a-computed-field-runs-only-when-it-is-going-to-be-returned.md` and the "Computed field" glossary entry in `CONTEXT.md`.

### Context Type Safety

Context uses generic typing to preserve Prisma types:

```typescript
const context = createContext<typeof prisma>(config, prisma, session)
// context.db.post.findMany() is fully typed
```

## Integration Points

### With @opensaas/stack-ui

- UI reads config to generate admin interface
- Field `ui` options pass through to components
- Component registry pattern for field rendering

### With @opensaas/stack-auth

- Auth merges lists into config
- Session flows through context to access control
- Generator creates auth tables in Prisma schema

### With MCP (Model Context Protocol)

- Core provides auth-agnostic MCP runtime via `@opensaas/stack-core/mcp`
- MCP handler reads config to derive tools at request time (CRUD per list, list `mcp.customTools`, plugin-registered tools)
- Uses context for all operations (access control enforced); writes are validated by the normal `context.db` pipeline (field Zod schemas, hooks, access control)
- Custom tools may declare a Zod `inputSchema` — validated on `tools/call`, converted to JSON Schema for `tools/list` — or a plain JSON Schema object
- Auth adapters (like `@opensaas/stack-auth/mcp`) provide session integration; custom session fields pass through to access control
- The derived `query` tool accepts an optional `fields` projection (`packages/core/src/mcp/projection.ts`) — the wire form of a fragment field selection, translated into a `context.db` `include` so the ordinary read pipeline (access scoping, `needs` folding, the depth cap) applies with no parallel read path. The generated schema enumerates two fixed levels of each list's vocabulary, per session; `tools/list` itself is per-session as a result (ADR-0033)

### The MCP `query` Tool's `fields` Projection (ADR-0033)

An optional `fields` argument on the derived `query` tool narrows (or widens, up to two levels) what a read returns, in the wire form of a fragment field selection: `{ scalarField: true, relation: { fields: {...} } }`. A to-many relation additionally accepts `where`/`orderBy`/`take`/`skip` and a `count`. Omitting `fields` is unchanged — a bare read, per ADR-0024.

`projection.ts` does the work in two passes, both walking the same per-session vocabulary (`relatedListIfVisible`):

- `generateFieldsProjectionSchema` builds the JSON Schema advertised on `tools/list` — a relation whose target list denies this session's operation-level `query` access, or has `mcp.enabled: false`, is omitted from the vocabulary entirely, not merely left unusable.
- `resolveFieldsProjection` validates a caller's `fields` against that same vocabulary and translates it into a plain `context.db` `include` (deliberately NOT the fragment `query:` argument — going through the ordinary caller-`include` path is what gets `buildAccessScopedInclude`'s nested-`where` AND-fold, the to-one existence check, and the depth cap for free; the trade-off is that every computed field at a traversed level still computes server-side, same as any other `include`-based read, even one the projection didn't select — only the wire response is narrowed). Throws `McpProjectionRefusedError` (caught in the handler and turned into an `isError` tool result, never a JSON-RPC error) naming what was asked for and what's available on any mismatch.

A to-many's `count` is resolved separately via Prisma's `_count.select`, access-scoped by ANDing the related list's `query` access with any caller `where` on that same relation (mirroring, but not reusing, `relationship-count.ts`'s `_count` scoping — that module's own helper isn't exported and was built for a different feature, issue #732's admin list view).

### With Third-Party Field Packages

- Packages export field builders implementing `BaseFieldConfig` (imported from `@opensaas/stack-core/extend`)
- No changes needed to core - fields are self-contained
- Example: `@opensaas/stack-tiptap` provides `richText()` field

## Common Patterns

### Basic Config

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, integer, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: {
    provider: 'sqlite',
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  lists: {
    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        views: integer({ defaultValue: 0 }),
        author: relationship({ ref: 'User.posts' }),
      },
      access: {
        operation: {
          query: () => true,
          create: ({ session }) => !!session,
          update: ({ session, item }) => session?.userId === item.authorId,
        },
      },
    }),
  },
})
```

### Silent Failures

Access-controlled operations return `null` or `[]` instead of throwing:

```typescript
const post = await context.db.post.update({ where: { id }, data })
if (!post) {
  // Either doesn't exist OR access denied
  return { error: 'Access denied or not found' }
}
```

### Field-Level Hooks

```typescript
password: password({
  hooks: {
    resolveInput: async ({ value }) => {
      if (value) return await bcrypt.hash(value, 10)
      return value
    },
    resolveOutput: ({ value }) => {
      return new HashedPassword(value) // Wrap for security
    },
  },
})
```

### Custom Prisma Client Constructor

```typescript
config({
  db: {
    provider: 'postgresql',
    url: process.env.DATABASE_URL,
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })
      return new PrismaClient({ adapter })
    },
  },
})
```

### Relationship Patterns

```typescript
// One-to-many
User: list({
  fields: {
    posts: relationship({ ref: 'Post.author', many: true }),
  },
})

// Many-to-one (other side)
Post: list({
  fields: {
    author: relationship({ ref: 'User.posts' }),
  },
})
```

### Virtual Fields

Virtual fields are computed fields that are not stored in the database:

```typescript
// Read-only computed field
User: list({
  fields: {
    firstName: text(),
    lastName: text(),
    fullName: virtual({
      type: 'string', // TypeScript output type
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    }),
  },
})

// Usage
const user = await context.db.user.findUnique({ where: { id } })
console.log(user.fullName) // "John Doe" — computed via resolveOutput whenever the read returns it
```

**Key characteristics:**

- Not stored in database (no Prisma column created)
- Computed via `resolveOutput` on every bare/`include`-based read; on a fragment `query` read, only when the fragment selects it (ADR-0027) — `select` is still not honoured, narrow with `include`/fragment `query`
- Must provide `type` (TypeScript type string) and `resolveOutput` hook
- Can optionally provide `resolveInput` for write side effects
- Useful for derived values, computed properties, and external API sync

### Declaring Relation Dependencies (`needs`, ADR-0025)

Since ADR-0024, a bare read (no caller `include`) returns a row's own columns
only — never its relations. A virtual field whose `resolveOutput` reads a
relation off `item` (`item.lineItems`, `item.posts.length`, …) would
otherwise silently compute over `undefined` whenever the caller didn't happen
to include that relation. `needs` is the fix: declare the immediate
relations a field's hook cannot compute without, and the read fetches
exactly those — wherever that field is computed, at the root of a read and
at every nested level alike.

```typescript
Order: list({
  fields: {
    lineItems: relationship({ ref: 'LineItem.order', many: true }),
    total: virtual({
      type: 'number',
      needs: ['lineItems'], // fetched for this hook, even on a bare read
      hooks: {
        resolveOutput: ({ item }) =>
          item.lineItems.reduce((sum, li) => sum + li.price * li.quantity, 0),
      },
    }),
  },
})

// The caller never asked for lineItems, and never receives it:
const order = await context.db.order.findMany()
order[0].total // computed correctly
order[0].lineItems // undefined — `needs` is private plumbing, not an implicit `include`
```

**Key characteristics:**

- Available on every field type (via `BaseFieldConfig`), not only `virtual()` — any field whose `resolveOutput` reads a relation can declare it.
- Names **stored columns and immediate relations on the same list** — no dotted paths, and never a computed field (ADR-0051). A dependency of a dependency is pulled in by the next list's own `needs` declaration, not by a path grammar. A declared column is kept on the hook's `item` even when a fragment's projection left it out of the result.
- **Never widens what the caller receives.** A declared relation is stripped from the result unless the caller named it too, for both `include` reads and fragment `query` reads alike.
- **Scoped by the Access Filter like any other relation a read asks for — never a bypass.** A dependency the session cannot query (operation-level `query` access) is not fetched; a dependency a relationship field denies field-level `read` on does not reach the hook; a dependency the Access Filter scopes with a filter yields only the visible rows.
- **Session-relative, with no escape.** The field always computes, on whatever its session can see — a field declaring two dependencies and granted access to one still produces a value from that one. A total over a scoped relation is a projection of the visible rows, not a fact about the underlying row. Computing the "true" figure is not something a declared dependency can do, because that would leak the values of rows the session was denied. **A field that genuinely needs the unscoped view must issue a privileged read inside its own hook (`context.sudo()`) and explicitly own that decision** — `needs` does not provide an escape hatch from access control.
- **A declaration closure that can't fit is refused, not silently truncated.** Declarations fold in recursively (a related list's own `needs` are satisfied too, wherever it's reached), so a long chain can exceed the read-include depth cap. A chain that cannot fit from any starting point fails `pnpm generate`; a caller-triggered overflow hits the ordinary runtime depth denial.
- **Typed as a plain `string[]`, not compile-checked against the list's relation names.** `BaseFieldConfig` is the contextual type every field builder's return value is checked against — including non-generic third-party fields (`richText(): RichTextField`, with no `TTypeInfo` parameter of its own, the documented third-party field pattern). Narrowing `needs`'s type per-list would make it disagree with the type a fixed, unparameterized field config presents, breaking assignability for every such field regardless of whether it uses `needs` at all. Instead, `pnpm generate` (`validateNeedsDeclarations`) rejects a `needs` entry that isn't a stored column or an immediate relationship field on the same list — and a `needs` on a field with no `resolveOutput` hook — naming the field and the bad entry.

See `docs/adr/0025-a-computed-field-declares-the-relations-it-needs.md` and the "Declared dependency" / "Session-relative value" glossary entries in `CONTEXT.md`.

## Type Safety

All types are strongly typed with TypeScript:

- Config is validated via Zod schemas
- Context provides full Prisma type inference
- Access control functions are typed with proper generics
- Avoid `any` and `unknown` in external APIs (internal use only where necessary)
