# The hook-bound context is the same secured context as a transaction's

Status: accepted

A list or field `resolveInput` / `validate` / `beforeOperation` / `afterOperation`
hook's `context` is a full `StackContext` — `sudo()`, `withSession()`,
`transaction()` and `serverAction` — bound to the write's OWN transaction
client, exactly like the `txContext` a `context.transaction()` callback
receives (ADR-0012). This amends ADR-0012: the Write Pipeline's transaction
rebind (`bindContextToTransaction`, `context/write-pipeline.ts`) now goes
through the same `getContext` factory `context.transaction()` already rebuilds
through, instead of hand-assembling a bare `AccessContext` object literal.
`beforeTransaction` / `afterTransaction` (list and field) and a field's
`resolveOutput` are unchanged by this record — they keep the plain
`AccessContext`, bound to the base client, per ADR-0028's boundary-hook
contract.

## Context

ADR-0010 rebinds a hook's `context.db`/`context.prisma` to the write's
transaction client so a hook-issued write is atomic with the write itself.
ADR-0012 later gave `context.transaction()` a full secured context — `sudo()`,
`withSession()`, `transaction()` — by rebuilding through `getContext` rather
than hand-assembling an object. The ADR-0010 hook rebind never received the
same treatment: `bindContextToTransaction` built a bare object literal
(`session`, `prisma`, `db`, `storage`, `plugins`, `_isSudo`,
`_resolveOutputChain`, `_transactionOwner`) with no `sudo`, `withSession` or
`transaction` method at all (issue #1176).

A hook that needed an elevated read/write — e.g. an ACCOUNT-initiated cancel
that must delete an admin-only DRAFT row a normal session cannot reach — had
two bad options: call the generated `getContext(session).sudo()`, which binds
to the BASE Prisma client (a different connection from the open transaction:
its writes commit independently and survive a rollback of the outer write,
its reads cannot see the transaction's uncommitted state, and on a
single-connection adapter — e.g. PGlite in tests — it deadlocks until the
transaction times out); or do the elevated work in `afterTransaction`, whose
context is a different object with no channel from `beforeOperation`, and for
`delete` the row (and any set-null relations) is already gone by then.

By contrast, `context.transaction()`'s own callback already had the full
capability — the asymmetry was never a deliberate design choice, just a
rebind path that hadn't been ported to the ADR-0012 mechanism yet.

## Considered options

- **Route the hook rebind through `getContext`, widen the hook context type
  from `AccessContext` to `StackContext` (chosen).** Reuses the exact
  mechanism `context.transaction()` already established — no new persistence
  or capability logic, only a rebind-site and a type change. `StackContext`
  gained two internal fields (`_resolveOutputChain`, `_transactionOwner`) so
  it structurally satisfies `AccessContext` too, letting it flow unchanged
  through the write-pipeline/hook-executor plumbing that expects an
  `AccessContext` (`hookPipeline`, `processNestedOperations`, the field-level
  hook executors).
- **Add `sudo()`/`withSession()`/`transaction()` directly onto `AccessContext`
  itself.** Rejected: `AccessContext` is the shared, widely-instantiated
  interface access control, field visibility and every hook type are typed
  against. A prior attempt at a self-referential `sudo(): AccessContext`
  field on it broke TypeScript's structural checking of unrelated generated
  Prisma types (nullable JSON `CreateInput` fields) in a downstream app —
  documented on `Plugin['runtime']` in `config/types.ts`. Widening the
  narrower `StackContext` instead, and repointing only the four in-scope hook
  argument types at it, keeps `AccessContext` itself untouched and avoids
  reopening that regression.
- **An `args.sudoContext` / `context.elevated` alias instead of widening
  `context` itself.** Rejected: a second field is a second thing for every
  hook author to learn, and does not fix the type mismatch a hook author
  hits today reaching for `context.sudo()` directly (it would still not
  exist). The observable contract the issue asked for is that the hook
  `context` itself is assignable to the same type `transaction()`'s
  `txContext` is.
- **Give `beforeTransaction`/`afterTransaction` the same treatment.**
  Rejected: those hooks run outside the transaction by design (ADR-0028) —
  by flush time a transaction client may already be closed, and boundary-hook
  compensation must not be written through the transaction that rolled back.
  Their context stays on the base client, unchanged.

## Consequences

- **`context.sudo()` / `context.withSession()` from inside `resolveInput` /
  `validate` / `beforeOperation` / `afterOperation` stay bound to the SAME
  transaction client the hook itself was given.** A
  `context.sudo().db.x.create()` (or `.update()`/`.delete()`) issued from one
  of these hooks is atomic with the write: it rolls back together if the
  write later throws, on every provider — not only ones with multiple
  concurrent connections available, unlike the old
  `getContext(session).sudo()` workaround.
- **The write's transaction owner (ADR-0028) and resolve chain (ADR-0023) are
  carried onto `sudo()`/`withSession()`, not just the base rebind.** A write
  issued through either derived context still defers its `afterTransaction`
  to the write's own owner and reports that owner's real outcome; a write
  issued from inside a `resolveOutput` hook still carries that hook's
  cycle-guard chain into the write's own Field Visibility pass. `getContext`
  gained a new internal parameter (`_resolveOutputChain`, threaded through
  `sudo()`/`withSession()`'s own recursive `getContext` calls) to make this
  possible — previously only `_transactionOwner` was threaded that way.
- **`context.transaction(fn)` called from inside one of these hooks joins the
  write's transaction** — the pre-existing "no interactive client on this
  object → run directly" fallback already does this, since a hook-bound
  context carries `_transactionOwner`; it never opens a nested one.
- **Plugin runtimes are not re-executed on this rebind** — `bindContextToTransaction`
  passes the request context's already-initialised `plugins` through to
  `getContext` as `_sharedPlugins`, the same rule ADR-0010/0012 established for
  the other rebind sites.
- **`StackContext` gained two internal fields** (`_resolveOutputChain`,
  `_transactionOwner?`) purely so it satisfies `AccessContext` structurally.
  They are not part of the public contract a hook author is expected to read
  (unlike `_isSudo`, which was already public) — they exist so the SAME
  object can be handed to hook authors (as `StackContext`) and to internal
  write-pipeline/access plumbing (which is typed against `AccessContext`)
  without a second object or a cast at every call site.
- **Four hook argument-type families were repointed at `StackContext`:**
  `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`,
  `AfterOperationHookArgs` (list level) and their field-level equivalents
  (`FieldResolveInputHookArgs`, `FieldValidateHookArgs`,
  `FieldBeforeOperationHookArgs`, `FieldAfterOperationHookArgs`). Every other
  hook argument type (`BeforeTransactionHookArgs`/`AfterTransactionHookArgs`,
  list and field level, and `FieldResolveOutputHookArgs`) is untouched.
- **No change to what `sudo()` bypasses.** Singleton-create and other
  sudo-immune constraints stay enforced exactly as before; this record only
  changes WHICH client/transaction a hook's derived context targets, not what
  access control it skips.
