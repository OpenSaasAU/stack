# @opensaas/stack-core

Core stack: the config system, the access control engine, hooks, field builders, contract derivation, the dev database and the test harness.

## Purpose

The foundation of OpenSaas Stack. Defines the config DSL, executes access control, runs hooks, derives the database contract from a config, and owns both database surfaces — the secured `context.db` and the Unsafe surface.

## Entry Points

The package exposes a curated surface across several import paths. Use the narrowest one that fits:

- **`@opensaas/stack-core`** (root) — the everyday consumer surface: `config`, `list`, `getContext`, the naming helpers (`getUrlKey`, `getListKeyFromUrl`), `ValidationError`, the stack-owned database errors (`DatabaseError`, `SerializationFailure`, `UniqueConstraintViolation`, `isSerializationFailure`, `isUniqueConstraintViolation`), and the config/access types you annotate with (`OpenSaasConfig`, `ListConfig`, `FieldConfig`, `AccessControl`, `FieldAccess`, `Session`, `AccessContext`, `OperationAccess`, `Where`, `OrderBy`).
- **`@opensaas/stack-core/fields`** — field builder functions (`text()`, `integer()`, …) and their config types (`TextField`, `IntegerField`, `DecimalField`, `CalendarDayField`, …). The builders and the types they produce live together here.
- **`@opensaas/stack-core/extend`** — authoring contracts: implement these to build a plugin (`Plugin`, `PluginContext`, `GeneratedFiles`, `writePluginOwnedField`) or a third-party field package (`BaseFieldConfig`, `TypeInfo`, `TypeDescriptor`, `ContractFieldDescriptor`).
- **`@opensaas/stack-core/contract`** — `deriveContract(config)` and the contract data types. Core derives the contract; the CLI renders it.
- **`@opensaas/stack-core/unsafe`** — the `UnsafeSurface` type and its constructors, for a consumer building a context by hand.
- **`@opensaas/stack-core/origin`** — the ambient origin module: `originTripwire` (which every client must install), `withOrigin`, `currentOrigin`, `UnmarkedQueryError`.
- **`@opensaas/stack-core/dev-database`** — `startDevDatabase` and its options, the in-process Postgres `opensaas dev` runs.
- **`@opensaas/stack-core/testing`** — `createTestContext`, `createTestDatabase`, the plan recorder and the `DATABASE_URL` escape helpers.
- **`@opensaas/stack-core/client`** — `resolveRuntimeConnection`, which the generated bundle calls to turn `db.client` into the ORM client's connection options.
- **`@opensaas/stack-core/mcp`** — MCP runtime handlers.
- **`@opensaas/stack-core/internal`** — `@internal` plumbing shared between the `@opensaas/*` packages and generated `.opensaas/` code. **No semver guarantees**; application code should never import from here.

`Session` deliberately stays on the root entry point because it is the module-augmentation target (`declare module '@opensaas/stack-core'`).

## Key Files & Exports

### Config (`src/config/`)

- `types.ts` - Core type definitions (`OpenSaasConfig`, `ListConfig`, `FieldConfig`, etc.)
- `index.ts` - Builder functions (`config()`, `list()`)
- `schema.ts` - Zod schemas for validation
- `plugin-engine.ts` - Plugin dependency resolution and execution

### Fields (`src/fields/index.ts`)

Field builder functions, each returning an object with:

- `getZodSchema(fieldName, operation)` - Validation schema
- `getContractField(fieldName, listKey, config)` - the column(s), relation, or `{ kind: 'computed' }` the field contributes to the contract
- `outputType` - the TypeScript read face, when it differs from the column's codec type. Required on a virtual field and on one whose descriptor is `kind: 'columns'`, neither of which has a single column to be typed from
- `inputType` - the write face, when it differs from the read face. Never required by `opensaas generate`: on a single-column field, absence means the column's own input type. A `kind: 'columns'` field has no single column for that to name, so declare it there alongside `outputType`
- `getVectorColumn(fieldName)` - a stored vector column and its distance function, on a field that has one. A field that does not answer this is not searchable, which is what makes `nearest('title', …)` a refusal rather than a query the database rejects

Built-in fields:

- `text({ validation, ui, hooks })` - String field
- `integer({ validation, ui, hooks })` / `bigInt(...)` / `decimal(...)` - Numeric fields
- `checkbox({ defaultValue, ui, hooks })` - Boolean field
- `timestamp({ defaultValue, ui, hooks })` / `calendarDay(...)` - Date and date-time fields
- `password({ validation, ui, hooks })` - Hashed password (excluded from reads)
- `select({ options, validation, ui, hooks })` - Enum field
- `relationship({ ref, many, ui })` - Foreign key relationship
- `json({ validation, ui, hooks })` - JSON field for arbitrary JSON data
- `virtual({ type, hooks })` - Computed field not stored in the database

### Access Control (`src/access/`)

- `engine.ts` - `checkAccess`, `checkCreateAccess` and the access-rule evaluation the terminals call
- `access-filter.ts` - The pre-query phase: the access-scoped predicate and the include scoping
- `field-access.ts` - Field-level rules, and the row-independent-rule classifier
- `field-visibility.ts` - The post-query phase: strip, compute, resolve
- `query-validation.ts` - `validateQueryKeys` and `validateQueryFieldReadAccess`, the predicate-time checks
- `types.ts` - Type definitions (`AccessControl`, `OperationAccess`, `FieldAccess`, `Session`, `AccessContext`)

Access control functions receive `{ session, context, item, operation }` and return:

- `boolean` - allow or deny
- A **Where vocabulary** condition - scope access to matching rows (e.g. `{ authorId: { equals: session.userId } }`)

The access filter is not hand-merged into a caller's `where`: it rides into the query as a second, engine-owned predicate the ORM ANDs natively, and into every include refinement the same way (ADR-0039, ADR-0044). `checkAccess` and `mergeFilters` are exported from the root entry point so no other package carries a copy.

A plugin's `runtime(context, sudo)` factory receives a `sudo` helper as a plain **second argument** — `sudo(): AccessContext` returns an access-bypassing (but still hook-firing) context, for reads and writes that must not depend on the caller's own list access policy (an auth plugin resolving "who is this session" independent of the User list's rules, say). It's the same escape hatch as `StackContext.sudo()`, exposed one layer lower. It is deliberately **not** a method on `AccessContext` itself — a self-referential `sudo(): AccessContext` field on that shared, widely-instantiated interface broke TypeScript's structural checking of unrelated generated types in a downstream app.

### The two surfaces

`AccessContext` — what a hook, an access rule and a plugin service see — carries `ormHandle`: the engine's own ORM client, which the terminals, the Write Pipeline and the access filter issue their queries through. The engine applies the Access Filter, Field Visibility and hooks **around** it, so the handle itself enforces none of them.

`StackBaseContext` — what a server action and a page component hold — carries `unsafe` instead: the **Unsafe surface**, the application's documented bypass. `ormHandle` is not a member of it.

The two are different things under different names, and neither is a spelling of the other. See the "ORM handle" and "Unsafe surface" glossary entries in `CONTEXT.md`.

Every query the ORM executes carries an ambient **origin** — `'engine'` or `'unsafe'` — that the executing surface enters around exactly the execution it performs, with the `await` inside, so hooks run outside it by construction. A stack-owned tripwire installed in the client's `middleware` refuses a statement carrying no origin at all, in every environment (`UnmarkedQueryError`). A client built by hand — in a test, or for a module-init-time consumer — installs `originTripwire` from `@opensaas/stack-core/origin` or it is executing statements neither surface declared. See ADR-0059.

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
const context = await getContext({ userId, email, role })
context.session?.email // ✅ Typed as string
```

**For Better Auth users:** See `@opensaas/stack-auth` documentation for examples of extracting Better Auth session types.

### Hooks (`src/hooks/`)

- `index.ts` - Hook execution logic
- Types in `config/types.ts`

Hook types:

- `resolveInput` - Transform input data
- `resolveOutput` - Transform output data
- `validate` (or `validateInput`, kept for backwards compatibility) - Custom validation
- `beforeOperation` - Side effects inside the write's transaction, before the database operation
- `afterOperation` - Side effects inside the write's transaction, after the database operation
- `beforeTransaction` / `afterTransaction` - Side effects **outside** the transaction, for work that must not hold it open

### Context (`src/context/index.ts`)

- `getContext(config, ormHandle, session, storage?, …)` - the low-level factory. An application calls the **generated** `getContext(session?)` in `.opensaas/context.ts` instead, which resolves the config, constructs the client and passes the handle in for you
- Returns a `StackContext`: `{ db, session, unsafe, storage, plugins, serverAction, sudo, withSession, transaction, _isSudo }`
- `context.transaction(fn)` - Interactive, hook-firing transaction (see below)

#### The composed read

`context.db.<List>` is an opaque wrapper over the ORM's collection, keyed by the **config's own PascalCase list key** (`context.db.AuthUser`). There is no camelCase spelling anywhere on the surface and no helper that produces one.

A read is an immutable value; nothing is enforced until a terminal runs it:

- Composition: `where`, `orderBy`, `select`, `include`, `limit`, `offset`, `cursor`, `distinct`, `distinctOn`, and — on a transaction-bound builder only — `forUpdate`
- Terminals: `all()`, `first()`, `aggregate(build)`, `nearest(field, vector, options?)`
- Writes: `create({ data })`, `update({ where, data })`, `delete({ where })`
- A singleton list has `get()` instead of the composed read

**A method appears only where the engine knows how to scope it.** Omission is the signal, not an oversight: there is no `groupBy`, no `*AndCount`, no `upsert`, no bulk create/update, and no streaming terminal. A caller that must consume a large result incrementally uses `context.unsafe`.

`where` and `orderBy` take the **Where vocabulary**: `equals`, `not`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`; `AND`/`OR`/`NOT`; and `some`/`every`/`none` on a relation of any cardinality. The engine lowers it in one place, **total or throwing** — a key or operator outside the vocabulary is refused, never dropped, so a predicate can only ever narrow. `contains` is engine-owned, escapes its wildcards, and is case-insensitive. A relation predicate carries the related list's `query` access inside the `EXISTS`, so a denied related list counts as the empty set. `orderBy` is scalar-only. See ADR-0055 and `src/secured/lower.ts`.

#### Interactive transactions (`context.transaction`)

`context.transaction(async (txContext) => { … })` runs the callback inside
**one** interactive transaction. `txContext` is a full context whose `db`
operations are access-checked and hook-firing exactly like the request context,
but persist against the transaction client — so every write in the callback is
**atomic** and a throw anywhere rolls the whole transaction back. This is the
secured alternative to the Unsafe surface's transaction, which bypasses access
control and hooks.

```typescript
await context.transaction(async (tx) => {
  const order = await tx.db.Order.create({ data: { customerId } })
  if (order === null) throw new Error('Access denied')
  await tx.db.AuditEntry.create({ data: { orderId: order.id, action: 'placed' } })
})
```

Key points:

- **It takes no options** and runs at the connection's default isolation level —
  Read Committed on PostgreSQL (ADR-0042). There is no isolation level to
  select, so asking for one is a compile error rather than a silent downgrade.
  An invariant a stricter level would have closed is expressed as a lock on the
  contended row inside the callback instead (ADR-0047).
- **The transaction holds one pooled connection for the whole callback.** Work
  reached through the transaction context runs on it; work reached through the
  OUTER context inside the callback asks the pool for a second one, and on a
  single-connection pool — the Dev database's — waits for one that will not come.
- **Driver errors are stack-owned.** A serialization failure reaches the caller
  as `SerializationFailure` and a unique violation as
  `UniqueConstraintViolation` carrying per-field messages, each with an `is*`
  predicate (`isSerializationFailure`, `isUniqueConstraintViolation`). They are
  NOT converted to a silent `null`, so the caller can write a retry loop; built-in
  retry is not provided — the caller owns it (matching Keystone 6's
  `context.transaction`). Keep the loop narrow: a broadly-catching one re-applies
  a transaction that already committed.
- **Errors raised at `COMMIT` are normalised the same way**, at the transaction
  owner's settle and before the deferred-hook flush, so a deferred constraint
  never escapes as a raw driver error and an `afterTransaction` hook's
  `outcome.error` is the normalised one.
- **A `DatabaseError`'s message is stack-authored, never the driver's.** The
  driver's text names columns, tables and constraint names, and that message is
  what a server action hands a client; the driver's own error stays on `cause`
  for a server-side log. Per-field messages come from the **generated constraint
  map** in `.opensaas/tables.ts`, so a hand-managed constraint the generator did
  not emit gets the generic message rather than per-field ones.
- **Your error wins over the stack's.** Catching a stack error in a hook and
  rethrowing your own with `{ cause }` reaches the caller as your error — the
  normalisation stops at the first `DatabaseError` in the chain rather than
  reaching past it to re-raise the driver failure underneath.
- **The Unsafe surface is excluded**: a query issued through `context.unsafe`
  rejects with the driver's own error, consistent with its bypassing everything
  else.
- **Nested `context.db` writes join** the outer transaction: a context bound to
  an open transaction carries no transaction opener, so the Write Pipeline runs
  them against the active handle rather than opening a second one.
- If you are already inside a transaction, `fn` runs directly against it with
  identical hook/access semantics. A context that can neither open a transaction
  nor join one — assembled from a hand-built ORM double, without `getContext`'s
  `client` argument — throws `TransactionUnavailableError` rather than running
  the callback with no atomicity. See ADR-0012.
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
  over already-final data, though a transaction error — `SerializationFailure`
  among them — still takes precedence. A write with no transaction owner at all
  (an application managing its own transaction, or a client that cannot open
  one) still fires `afterTransaction` optimistically at write time, unchanged.
  See ADR-0028 and the hooks concept doc.

#### The row lock (`.forUpdate()`, ADR-0047, ADR-0062)

A capacity gate is the case a stricter isolation level used to cover. Express it
as a row lock on the contended parent, taken **before** the count — every racer
takes the same token on the same row, so the count cannot go stale under a
booking a racer that got there first has already committed.

```typescript
const result = await context.transaction(async (tx) => {
  // The lock comes BEFORE both reads below. `null` here is denied-or-gone —
  // either way there is no gate to run.
  const held = await tx.db.Slot.where({ id: { equals: slotId } })
    .forUpdate()
    .first()
  if (held === null) return { booked: false }

  // BOTH sides of the gate are read after the lock, each in its own statement.
  // `held`'s own columns are the row as of BEFORE the lock was granted, so
  // `held.capacity` can be stale; this re-read cannot be, because no one else
  // can commit an update to a row this transaction holds.
  const slot = await tx.db.Slot.where({ id: { equals: slotId } }).first()
  const { taken } = await tx.db.Booking.where({ slotId: { equals: slotId } }).aggregate(
    (aggregate) => ({ taken: aggregate.count() }),
  )
  if (slot === null || taken >= slot.capacity) return { booked: false }

  return { booked: true, item: await tx.db.Booking.create({ data: { slotId, holder } }) }
})
```

- **`forUpdate()` is on the transaction-bound builder and nowhere else.** A lock
  taken outside a transaction is released at the end of the statement that took
  it, so it would compile, run, return rows and guard nothing. The generated
  bundle names two faces per list (`SlotList`, `SlotTxList`) and
  `context.db.Slot.forUpdate()` is a compile error.
- **Two statements.** The scoped read runs first — operation access, the Access
  Filter and Field Visibility exactly as any read — and the engine then locks
  the identity rows it returned. The locked set is provably a subset of the
  readable set.
- **The lock is a mutex on the row; the columns come back as of before it.**
  Each statement takes its own snapshot under Read Committed, so a column
  another transaction committed between the read and the lock reaches the
  caller **stale** — only the row's identity is post-lock. This diverges from a
  single-statement `SELECT … FOR UPDATE`, which Postgres re-evaluates after
  acquiring. So a threshold the gate compares against is read in its **own
  statement after the lock**, exactly as the count is; reading it off the
  locked row is the stale read the gate exists to close. ADR-0047 states the
  same thing from the other side: the parent row lock is a **mutex token**, not
  protection for the parent's own data.
- **A terminal never returns a row it did not lock.** A row deleted between the
  two statements locks nothing: `first()` yields `null` and `all()` the
  surviving subset. `null` therefore means denied-or-vanished.
- **`first()` and `all()` carry it; `aggregate()` and `nearest()` refuse it** —
  an aggregate returns no primary keys to lock, and a ranking is not a gate.
- **`forUpdate()` only.** There is no shared-lock, no-wait or skip-locked
  variant: a skipped locked row is indistinguishable from an access-denied one,
  which would make Silent failure mean two things at once. The engine always
  orders the lock statement by primary key, so acquisition order is the same in
  every session.
- **A list whose table has no single-column primary key cannot be locked**
  (`RowLockIdentityError`), and one terminal binds at most `ROW_LOCK_MAX_KEYS`
  keys — a cost limit, `RowLockKeyLimitExceededError`, not an inability to
  scope.
- **`tx.advisoryLock(key)`** takes PostgreSQL's transaction-scoped advisory lock
  for an invariant that is not a row. It sits on the transaction context rather
  than on `db`, because it locks a number and belongs to no list. The key is
  hashed with a 32-bit hash, so distinct keys can collide — a collision costs
  spurious serialisation, never a missed lock.

Contention is not observable on the default test harness: PGlite serialises
every transaction, so a suite that proves a gate admits exactly N runs behind
the `DATABASE_URL` escape (`packages/core/src/secured/capacity-gate.test.ts`).

#### A hook's context is `BaseContext`, bound to the write's own transaction

A list/field `resolveInput` / `validate` / `beforeOperation` / `afterOperation`
hook's `context` argument is `StackBaseContext<DB, S, PluginServices>` — the
app's `BaseContext`: the secured `db`, the session, `unsafe`, `storage` and
`plugins`, and nothing that can start a transaction or change who is asking.
`sudo()`, `withSession()`, `transaction()` and `serverAction` live on
`StackContext` (`Context`), which a server action or page component holds. See
ADR-0050 and ADR-0052.

That `db` IS bound to the write's own transaction client, not the base one
(ADR-0010): `bindContextToTransaction` in `write-pipeline.ts` rebuilds the
delegates against `tx`, so a `context.db` write a hook performs is atomic with
the write and rolls back with it. It carries the write's transaction owner
(ADR-0028) and the hook's own resolve chain (ADR-0023), and does NOT re-execute
plugin runtimes.

Because a hook cannot reach `sudo()`, an elevated write that must be atomic with
this one is a plugin's own column write (`writePluginOwnedField`, ADR-0068) or a
`context.transaction` the _caller_ opened around the write.

- **Unaffected:** `beforeTransaction` / `afterTransaction` (list and field) keep
  the plain `AccessContext`, bound to the BASE client, always — see ADR-0028
  for why boundary hooks must not run through a client that may already be
  closed by flush time.
- **A field's `resolveOutput`** takes the same `BaseContext`, but which client
  it is bound to depends on how the read that triggered it arose: a plain
  top-level read resolves against the base client; a `resolveOutput` that runs
  as part of a create/update's OWN result (the write's Field Visibility pass)
  resolves against THAT write's transaction client (ADR-0010).

See the hooks concept doc's "In-transaction vs transaction-boundary hooks"
section.

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
async function dispatchJob(context: StackContext, job: { ownerSession: Session; taskId: string }) {
  const asOwner = context.withSession(job.ownerSession)
  const task = await asOwner.db.Task.update({
    where: { id: job.taskId },
    data: { status: 'done' },
  })
  if (task === null) throw new Error('Access denied')
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

### Contract derivation (`src/contract/`)

`deriveContract(config)` turns a config into the contract data the CLI renders
as a TypeScript **Contract module**. Core derives it; the CLI renders it; Prisma
emits `contract.json` and `contract.d.ts` from the module. No schema language is
produced at any point (ADR-0040).

The same pass produces two emitted tables the runtime reads back through the
generated context: the **declared dependency set** table (per `(list, field)`,
with each list's own system fields) and the **constraint map** (constraint name
→ field names). `deriveGeneratedTables` builds both, so the type a read is
widened by and the runtime widening itself cannot disagree.

`assertRelationGraphAgrees` closes the loop: an emitted contract whose relations
disagree with the config-derived graph fails `generate` rather than producing a
bundle that describes a different database.

### Dev database and the test harness

- `startDevDatabase({ dataDir, extensions, maxConnections })` (`@opensaas/stack-core/dev-database`) runs an in-process PGlite behind a socket on a free loopback port, with its state file under the generated bundle's directory. `opensaas dev` starts it; nothing else opens its data directory.
- `resolveDatabaseUrl()` is the one discovery rule: `DATABASE_URL` if set, else the running Dev database's state file, else a throw naming both remedies. It reports the provenance, which is what decides the single-connection pool on the dev path.
- `createTestContext(config, session)` (`@opensaas/stack-core/testing`) stands up a **real, fully secured context** over an in-process database — the same engine, tripwire and terminals as production. It is the only double the stack offers for `context.db`; there is no in-memory imitation of the surface's guarantees, and no test-only seam on the wrapper (ADR-0057).
- `createPlanRecorder()` gives plan-level assertions where the built query is the subject — the merged access filter, the widened selection, the origin. It observes and passes through; it never rewrites and never skips the tripwire. SQL text is never asserted.

### Utilities (`src/lib/case-utils.ts`)

Public naming helpers (exported from the root entry point):

- `getUrlKey(listKey)` - PascalCase → kebab-case (e.g., `BlogPost` → `blog-post`)
- `getListKeyFromUrl(urlKey)` - kebab-case → PascalCase (e.g., `blog-post` → `BlogPost`)

The lower-level converters (`pascalToCamel`, `pascalToKebab`, `kebabToPascal`, `kebabToCamel`) are internal plumbing on `@opensaas/stack-core/internal`. There is no PascalCase-to-camelCase list-key helper on the public surface: the secured surface's keys are the config's own spelling.

## Architecture Patterns

### Field Self-Containment

Fields are fully self-contained. No switch statements in core:

```typescript
// Field defines its own behavior
export function text(options) {
  return {
    type: 'text',
    ...options,
    getContractField: (fieldName) => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: true,
    }),
    getZodSchema: (fieldName, operation) => z.string().optional(),
  }
}

// Generator delegates to field
const descriptor = field.getContractField(fieldName, listKey, config)
```

### Access Control Execution Flow

1. A caller composes a read or calls a write on `context.db.Post`
2. The terminal resolves operation-level access → boolean or a Where vocabulary condition
3. That condition becomes a second, engine-owned predicate the ORM ANDs with the caller's own
4. An include refinement carries the related list's `query` access the same way; a relation whose own field-level `read` rule is **row-independent and denies** is left out before the query runs
5. The query executes, materialising its whole result
6. Field Visibility strips unreadable fields, computes computed fields and resolves `resolveOutput`
7. The terminal returns the result, or the empty value of its type on denial

Field Visibility is the unconditional boundary. A missed pre-query omission is a performance regression, never a leak (ADR-0044).

### Hook Execution Order (Write)

1. List `resolveInput`
2. Field `resolveInput` (e.g., hash password)
3. List `validate`
4. Field `validate`
5. Field validation (isRequired, length, min/max)
6. Field-level access control (filter writable fields)
7. Relationship resolution — a `connect`'s reachability query and the foreign-key write
8. Field `beforeOperation`
9. List `beforeOperation`
10. **Database operation**
11. List `afterOperation`
12. Field `afterOperation`

Operation-level access is resolved first, **outside** the transaction: a denied write short-circuits to `null` before any hook fires. Every write opens a transaction, so a hook's database work rolls back with the write.

### Hook Execution Order (Read)

Reads run no `afterOperation` (list or field):

1. **Database operation**
2. Field-level access control (filter readable fields)
3. Field `resolveOutput`

### Narrowing Reads (`.select()`, ADR-0041)

A read on the secured surface is narrowed with `.select(...fields)`, which the engine honours **exactly**: it widens the query by the declared dependency sets of the computed fields the read will return and by anything a row-dependent field `read` rule has to see, then strips `widened ∖ caller` as a recursive set difference at every nesting level. `.select()` replaces on call rather than accumulating, names this list's own fields only (a relation is reached with `.include()`, whose refinement carries its own `.select()`), and a computed field is selectable whether or not the columns it reads were named. Its resolution lives in `src/secured/select.ts`, and it is on the generated typed surface (`ListQuery`/`ListRefinement` in `src/types/secured-list.ts`), so a projected read's row type is the keys it named plus the list's system fields and nothing else. A key the list does not have — including the raw per-part column of a multi-column field, which never reaches a caller — is refused rather than silently dropped. `.limit(count)` bounds `.all()` on the same composed value.

A singleton's `get()` takes no projection: passing `select` there is a visible no-op that logs a one-time `console.warn` and still returns the full, access-filtered record.

### Bare read and One hop are the ORM's (ADR-0043)

A read that names no relations returns the row's own columns plus its computed fields, and a named relation fetches that relation's own columns and stops. Both are the ORM's own behaviour for the same call rather than something this codebase adds: ADR-0024 and ADR-0026, which used to state them as stack rules, are **withdrawn**.

Reaching further means naming further — `.include('author', (author) => author.include('organization'))` — and the rule holds on **both** sides of a one-to-one with no exception (ADR-0064). Foreign-key columns are unaffected and always returned, so a relation stays reachable by id without an include.

`READ_INCLUDE_MAX_DEPTH` keeps its number as a **cost limit** on how far a caller's own tree may reach, not a security boundary: a read naming a relation at or beyond the cap throws `AccessScopeDepthExceededError`. The widening a declared dependency set performs is exempt from it (ADR-0051).

A `resolveOutput` hook that issues its own bare `context.db` read is subject to the same rule — reading `item.<relation>` inside such a hook finds nothing there unless the field declared it, or the hook's own read named it.

### A Computed Field Runs Only When It Is Going To Be Returned (ADR-0027)

A computed field — any field carrying a `resolveOutput` hook, virtual or not — is computed **if and only if the read is actually going to return it**, and its declared dependencies are fetched under exactly the same condition. A `.select()` naming three fields runs only those three fields' hooks (and widens for only their `needs`); a field it doesn't select does no work at all — neither its field-level `read` access nor its hook runs. This is **projection-aware, never access-aware**: a `.select()` is the only thing that restricts a level this way. A read that projects nothing is unaffected — every computed field on the list still computes. The rule applies at every nesting level: a refinement's own `.select()` computes only that subset there; a refinement without one still computes every computed field at that level.

**A hook's `item` is exactly its own declared dependency set plus the list's system fields** (ADR-0051) — never another computed field's resolved output, and never what the caller happened to select. It is caller-independent by construction: the same field cannot compute differently because someone else's projection widened the row. A sibling the field did not declare is absent from what the hook sees, so reaching for it finds nothing there. Recompute from the stored columns both fields declare instead.

A hookless virtual field (one with `access.read` but no `resolveOutput`) has its read access evaluated on no read at all — such a field can never produce output, so there's nothing to preserve access side effects for. See `docs/adr/0027-a-computed-field-runs-only-when-it-is-going-to-be-returned.md` and the "Computed field" glossary entry in `CONTEXT.md`.

### Contract-Driven Type Safety

The secured surface is parameterised by the emitted contract and the generated remainder, so a list's row, create input, update input and predicate types are read from the contract rather than re-derived:

```typescript
const context = await getContext()
const posts = await context.db.Post.select('id', 'title').all()
// posts[0] is exactly { id, title } plus the list's system fields
```

A `where` naming a column the list does not have, a `select` naming a relation, a `forUpdate()` outside a transaction and a `nearest()` on a list with no vector column are all compile errors.

## Integration Points

### With @opensaas/stack-ui

- UI reads config to generate the admin interface
- Field `ui` options pass through to components
- Component registry pattern for field rendering
- The admin's filter builder compiles to the Where vocabulary as pure data, so filtering always runs through the secured context

### With @opensaas/stack-auth

- Auth derives its lists from better-auth's own table definitions and adds them to the config
- Session flows through the context to access control
- The generator emits the auth lists into the contract like any other
- better-auth's own flows run on the Unsafe surface through the stack-authored Auth adapter

### With MCP (Model Context Protocol)

- Core provides an auth-agnostic MCP runtime via `@opensaas/stack-core/mcp` (`createMcpHandlers`)
- The handler reads config to derive tools at request time (CRUD per list, list `mcp.customTools`, plugin-registered tools)
- Every tool goes through `context.db`, so access control, validation and hooks apply with no parallel path
- Custom tools may declare a Zod `inputSchema` — validated on `tools/call`, converted to JSON Schema for `tools/list` — or a plain JSON Schema object
- Auth adapters (like `@opensaas/stack-auth/mcp`) provide session integration; custom session fields pass through to access control
- A `where` argument is the Where vocabulary, the same grammar `context.db` takes

### The MCP vocabulary omits what a row-independent rule denies (ADR-0053, ADR-0037)

What MCP advertises is a **published vocabulary**, resolved per session: a field whose field-level rule is **row-independent and denies** this session is left out of it entirely, on the `fields` projection at both levels and on `create`/`update` `data`. A `create` tool whose required field is denied that way is not advertised at all, and asking for a dropped field is refused exactly as an unknown name is. `tools/list` is therefore per-session.

`src/mcp/projection.ts` does the work in two passes over that same vocabulary:

- `generateFieldsProjectionSchema` builds the JSON Schema advertised on `tools/list`. A relation whose target list denies this session's operation-level `query` access, or carries `mcp.enabled: false`, is omitted from the vocabulary rather than merely left unusable.
- `resolveFieldsProjection` validates a caller's `fields` against that vocabulary and **translates it onto the secured surface** — this list's scalars and computed fields become one `.select()` with `id` forced in, each relation becomes one `.include()` refinement carrying its own scope and per-parent paging, and a `count` becomes a `combine`. It throws `McpProjectionRefusedError` (caught in the handler and turned into an `isError` tool result, never a JSON-RPC protocol error) naming what was asked for and what is available.

A record projected down to none of its own identifying columns could not be the target of a follow-up `update`/`delete`, which is why `id` is forced into every selection this module composes rather than left to the caller.

### With Third-Party Field Packages

- Packages export field builders implementing `BaseFieldConfig` (imported from `@opensaas/stack-core/extend`)
- No changes needed to core - fields are self-contained
- A field whose column type comes from an **Extension pack** names that pack in its contract descriptor, and the package's plugin declares it through `PluginContext.addExtension`. A field naming an undeclared pack fails `generate`
- Example: `@opensaas/stack-tiptap` provides `richText()`

## Common Patterns

### Basic Config

```typescript
import { config, list } from '@opensaas/stack-core'
import { text, integer, relationship } from '@opensaas/stack-core/fields'

export default config({
  db: { provider: 'postgresql' },
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

Access-controlled operations return the empty value of the terminal's type instead of throwing:

```typescript
const post = await context.db.Post.update({ where: { id }, data })
if (post === null) {
  // Either doesn't exist OR access denied
  return { error: 'Access denied or not found' }
}
```

An included to-one the related list's `query` access scopes away is `null`, and a to-many `[]`, **by arity alone** — so every to-one read off an included row is a null check, whatever its column's nullability says (ADR-0058).

### Field-Level Hooks

```typescript
password: password({
  hooks: {
    // A field `resolveInput` gets the whole payload, not a `value` argument —
    // `value` is `resolveOutput`'s. Read the field out under `fieldKey`.
    resolveInput: async ({ resolvedData, fieldKey }) => {
      const incoming = resolvedData[fieldKey]
      if (typeof incoming === 'string') return await bcrypt.hash(incoming, 10)
      return incoming
    },
    resolveOutput: ({ value }) => {
      return new HashedPassword(value) // Wrap for security
    },
  },
})
```

### Binding a pool

The connection URL is not a config key — the runtime resolves it. `db.client` is
how a deployment binds a pool of its own, as a **lazy factory**: the config is
loaded by tooling that must never open a connection.

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

A write names an edge with `connect` on the side that owns the foreign key:
`context.db.Post.create({ data: { title, author: { connect: { id: authorId } } } })`.
Assigning `null` to that field clears the edge. There is no nested
`create`/`update`/`delete`/`connectOrCreate`/`set`, and `connect` on a non-owning
side is a generation error (ADR-0050).

### Virtual Fields

Virtual fields are computed fields that are not stored in the database:

```typescript
// Read-only computed field
User: list({
  fields: {
    firstName: text(),
    lastName: text(),
    fullName: virtual({
      type: 'string', // the TypeScript read face
      needs: ['firstName', 'lastName'],
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    }),
  },
})

// Usage
const user = await context.db.User.where({ id: { equals: id } }).first()
if (user === null) throw new Error('Access denied')
console.log(user.fullName) // "John Doe" — computed via resolveOutput whenever the read returns it
```

**Key characteristics:**

- Not stored in the database — its contract descriptor is `{ kind: 'computed' }`, so it has no column
- Computed via `resolveOutput` on every read that returns it; under a `.select()`, only when the projection names it (ADR-0027)
- Must provide `type` (a `TypeDescriptor` — a primitive string, an import string, or `{ value, from, name? }`) and a `resolveOutput` hook
- Reads only what it declares in `needs`, plus the list's system fields
- Useful for derived values, computed properties, and external API sync

### Declaring Dependencies (`needs`, ADR-0025, ADR-0051)

A bare read returns a row's own columns, never its relations, and a hook sees
only what its field declared. A computed field whose `resolveOutput` reads a
sibling column or a relation off `item` would otherwise compute over nothing.
`needs` is the fix: declare the stored columns and immediate relations the hook
cannot compute without, and the read fetches exactly those — wherever that field
is computed, at the root of a read and at every nested level alike.

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
const orders = await context.db.Order.all()
orders[0].total // computed correctly
orders[0].lineItems // not there — `needs` is private plumbing, not an implicit include
```

**Key characteristics:**

- Available on every field type (via `BaseFieldConfig`), not only `virtual()` — any field whose `resolveOutput` reads a column or a relation can declare it.
- Names **stored columns and immediate relations on the same list** — no dotted paths, and never a computed field. A dependency of a dependency is pulled in by the next list's own `needs` declaration, not by a path grammar. A declared column is on the hook's `item` whether or not the caller's projection asked for it, and a declaration **outranks a caller-facing `read` denial** on the same key — the value reaches the hook and is still stripped before the caller sees it. `needs: ['passwordHash']` is therefore a real, greppable leak channel owned by whoever writes it.
- **Never widens what the caller receives.** A declared relation or column is stripped from the result unless the caller named it too, on every read path.
- **Resolved at generation, not per read.** The set is emitted into `.opensaas/tables.ts` and the engine reads it from there; the same computation renders the per-field `needs` type in the remainder, so the type and the runtime widening cannot disagree.
- **Scoped by the Access Filter like any other relation a read asks for — never a bypass.** A dependency the session cannot query is not fetched; a dependency a relationship field denies field-level `read` on does not reach the hook; a dependency the Access Filter scopes with a condition yields only the visible rows.
- **Session-relative, with no escape.** The field always computes, on whatever its session can see — a field declaring two dependencies and granted access to one still produces a value from that one. A total over a scoped relation is a projection of the visible rows, not a fact about the underlying row. Computing the "true" figure is not something a declared dependency can do, because that would leak the values of rows the session was denied. **A field that genuinely needs the unscoped view must issue a privileged read inside its own hook (`context.sudo()`) and explicitly own that decision.**
- **One hop, and no closure to refuse.** A declared branch delivers its rows' stored columns and runs no computed field, so nothing on it declares anything further. There is no chain to overflow the read-include depth cap — the widening is exempt from it, and a caller-triggered overflow hits the ordinary runtime depth denial. A hook that genuinely needs two hops takes a privileged read inside itself, and pays for it.
- **Typed as a plain `string[]`, not compile-checked against the list's own keys.** `BaseFieldConfig` is the contextual type every field builder's return value is checked against — including non-generic third-party fields (`richText(): RichTextField`, with no `TTypeInfo` parameter of its own, the documented third-party field pattern). Narrowing `needs`'s type per-list would make it disagree with the type a fixed, unparameterized field config presents, breaking assignability for every such field regardless of whether it uses `needs` at all. Instead, `pnpm generate` (`validateNeedsDeclarations`) rejects a `needs` entry that isn't a stored column or an immediate relationship field on the same list — and a `needs` on a field with no `resolveOutput` hook — naming the field and the bad entry.
- **A hook reading an undeclared column breaks silently** unless it is typed through `Lists.<List>.TypeInfo`, where it is a compile error.

See `docs/adr/0025-a-computed-field-declares-the-relations-it-needs.md`, `docs/adr/0051-declared-dependencies-are-an-emitted-one-hop-set.md`, and the "Declared dependency" / "Declared dependency set" / "Session-relative value" glossary entries in `CONTEXT.md`.

### A plugin writing its own column (ADR-0068)

A plugin writing a field it computes and application code is denied — an
embedding, say — uses `writePluginOwnedField` from
`@opensaas/stack-core/extend`, not `sudo().db`. It resolves the field against
the config the context carries, splits the value through that field's own
`splitColumns`, and issues one id-scoped update carrying that field's columns
alone. It runs **no** hook, deliberately: it completes a write the application
already made, whose hooks have already run against the caller's real input.

Driving the same write through `sudo().db` instead re-runs the list's pipeline
over a payload naming one field, which recomputes a derived field from input
that is not there and destroys it.

## Type Safety

All types are strongly typed with TypeScript:

- Config is validated via Zod schemas
- The secured surface's types are instantiated from the emitted contract
- Access control functions are typed with proper generics
- Avoid `any` and `unknown` in external APIs (internal use only where necessary)
