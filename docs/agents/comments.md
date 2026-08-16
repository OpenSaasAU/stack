# Comments: worked examples

`CLAUDE.md`'s "## Comments" section states the rule. This doc shows what applying it looks like, with real before/after pairs pulled from cleaning up `packages/core/src/context/` (issue #936) — the densest concentration of comments in the repo, and the first pass against the rule. Read this before doing a comment cleanup pass elsewhere in the codebase; it settles the judgment calls that recur every time.

The rule, in two tests: **staleness** (does editing the line below make the comment false, with no test to catch it?) and **restatement** (does the comment just say what the code already says?). Fail either test and the comment goes. What survives is narrow: an outside constraint, a warning where the obvious edit is wrong, or a "Known limits" block — everything else is rationale, and rationale belongs in an ADR, the issue, the changeset, or the PR body, not beside the code.

## 1. Restatement — delete the comment, not the line

`packages/core/src/context/index.ts`, `parsePrismaError`:

```ts
// before
/**
 * Parse Prisma error and convert to user-friendly DatabaseError
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function parsePrismaError(error: unknown, listConfig: ListConfig<any>): Error {
  // Check if it's a Prisma error
  if (
    error &&
    typeof error === 'object' &&
    ...
```

```ts
// after
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function parsePrismaError(error: unknown, listConfig: ListConfig<any>): Error {
  if (
    error &&
    typeof error === 'object' &&
    ...
```

The function name already says "parse Prisma error"; the `if` condition already says "check if it's a Prisma error." Both comments were a second copy of a truth the code carries on its own. The `eslint-disable ... --` directive on the line between them is untouched — that's not commentary, it's a lint-tool contract with its own required reason, and it stays verbatim in every file in this cleanup.

## 2. A rationale block repeated across siblings — state it once, point to it elsewhere

`packages/core/src/context/index.ts`, the `ServerActionProps` union. Three sibling variants (`removeRelated`, `updateRelated`, `createRelated`) shared the same ADR-0018 boundary rationale, restated in full on each:

```ts
// before (updateRelated)
// Relationship-table inline cell edit (issue #737). `listKey`/`id` target the
// RELATED row and `field`/`value` a single scalar field on it, so the update
// runs through the related list's OWN operation- and field-level access +
// hooks/validation (never the parent's) — the same ADR-0018 boundary as
// `removeRelated`. It returns a distinct `{ updated }` shape (never a
// single-op `success`) so a UI wrapper that redirects on `success` — the
// item-form pattern — cannot hijack an in-place cell edit.
```

```ts
// after (updateRelated)
// Relationship-table inline cell edit (issue #737); same ADR-0018 boundary
// as `removeRelated` — `listKey`/`id` target the RELATED row. Returns a
// distinct `{ updated }` shape, never `success`, so a UI wrapper that
// redirects on `success` does not hijack an in-place cell edit.
```

The "runs through the related list's own access control, never the parent's" boundary is ADR-0018's whole point — it's stated once in full on `removeRelated` (the first variant) and referenced by name on its siblings, rather than re-derived three times. What did **not** get cut: each variant's own distinct footgun — the specific result shape (`{ updated }` vs `{ created }` vs `{ removed }`) and why it can't be `success`, which the ADR doesn't cover and which a reader would genuinely get wrong by "simplifying" to a shared shape.

## 3. A warning where the obvious edit is wrong — keep it

`packages/core/src/context/index.ts`, inside `serverAction`'s `bulkAction` error handling — kept verbatim, before and after:

```ts
// Anything else is an unexpected handler bug whose raw `.message` could
// leak internal detail to the client — log it server-side and return a
// generic client-facing message instead.
console.error(`Bulk action "${props.key}" on list "${props.listKey}" failed:`, error)
return { bulkAction: false, error: 'Action failed' }
```

This is the case CLAUDE.md's `isRequired`/`isNullable` example is pointing at: a reader skimming the catch block might reflexively return `error.message` to the client, the way the two branches above it do for known error types. That edit compiles, looks consistent with the surrounding code, and leaks internal detail. The comment is the only thing standing between the reader and that mistake — it survives because there's no name or type signature that carries the warning instead.

## 4. A file header that needs a page — trim to an orientation line and a link

`packages/core/src/context/apply-defaults.ts`, top of file:

```ts
// before (33 lines)
/**
 * Apply field `defaultValue`s to omitted inputs on CREATE — the runtime half of
 * the resolve-then-validate ordering (Keystone 6 parity, issue #615).
 *
 * A field's `defaultValue` is otherwise only realised as a Prisma `@default(...)`
 * applied by the database at write time, which is AFTER the write pipeline's
 * validation phase has already run. That ordering means a required-with-default
 * field (e.g. `select({ validation: { isRequired: true }, defaultValue: 'X' })`)
 * fails `isRequired` validation on an omitted input even though a default exists.
 *
 * This helper closes that gap: in the resolve phase (after `resolveInput` hooks,
 * before validation) it fills `resolvedData[field]` with the field's
 * `defaultValue` ONLY when the field was OMITTED (value is `undefined`). It is a
 * SINGLE shared mechanism used by both the top-level create path (Hook Pipeline)
 * and the nested-relation create path.
 *
 * Guard rails (each acceptance-criteria-driven):
 *   - CREATE only. Update never injects defaults for omitted fields ...
 *   - Explicitly-provided values are preserved. A key present in `resolvedData`
 *     — INCLUDING an explicit `null` — is left untouched; only `undefined`
 *     (omitted) keys are filled.
 *   - Virtual, system (`id`/`createdAt`/`updatedAt`) and relationship fields are
 *     skipped ...
 *   - The timestamp `{ kind: 'now' }` sentinel is NOT injected ...
 *
 * The function mutates and returns `resolvedData` ...
 */
```

```ts
// after (7 lines)
/**
 * Fills a field's `defaultValue` into `resolvedData` for CREATE when the field
 * was omitted, run after resolveInput hooks and before validation. Shared by
 * the top-level create path (Hook Pipeline) and the nested-relation create path.
 *
 * Prisma only realises `defaultValue` as `@default(...)` at the database write,
 * which is after this pipeline's validation phase — so without this, a
 * required field with a default (e.g. `select({ validation: { isRequired: true },
 * defaultValue: 'X' })`) fails `isRequired` on an omitted input. See issue #615.
 */
```

The "Guard rails" bullets were each a restatement of an `if` a few lines further down — the code already enforces CREATE-only, already skips virtual/system/relationship fields, already special-cases the `{ kind: 'now' }` sentinel. What's left is the one paragraph nothing else says: the Prisma default-timing gap this function exists to close, with the full history pointed at `#615` instead of reproduced.

## 5. A docblock that's pure restatement — delete it, even on an internal helper

`packages/core/src/context/write-pipeline.ts`, `isSingletonList`:

```ts
// before
/**
 * Check if a list is configured as a singleton.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}
```

```ts
// after
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig must accept any TypeInfo
function isSingletonList(listConfig: ListConfig<any>): boolean {
  return !!listConfig.isSingleton
}
```

Same shape as #1, at function-doc granularity rather than a file header: nothing in this repo needed its top-of-file header deleted to zero (every file header carried at least one line no doc/ADR states elsewhere), but plenty of function-level docblocks did — this is what that looks like. A one-line docblock whose only content is the function's name reworded is never worth the second copy.

## 6. Public-API TSDoc: the boundary between contract and narration

CLAUDE.md keeps TSDoc only on "exported config options, field builders, and plugin surfaces" — because that's what the consumer's editor shows. It's a narrow exception, not a blanket pass for anything exported. Two examples from the same file show the line:

**Kept in full** — `StackContext.transaction`, the method every `context.transaction(fn, options)` caller sees in autocomplete:

```ts
/**
 * Run `fn` inside ONE interactive transaction. The `txContext` handed to `fn`
 * is a full {@link StackContext} whose `db.*` operations are access-checked and
 * hook-firing (identical to this context) but persist against the transaction
 * client, so every write in the callback is atomic — a throw anywhere rolls the
 * whole transaction back.
 *
 * `options` (notably `isolationLevel`) is forwarded to the underlying Prisma
 * transaction. Serialization failures (e.g. Prisma `P2034`) propagate to the
 * caller rather than being swallowed, so the caller can own a retry loop. If
 * the client cannot open an interactive transaction (e.g. a plain mock, or we
 * are already inside a transaction), `fn` runs directly against the current
 * client with identical hook/access semantics.
 *
 * Caveat: plugin runtime services (`txContext.plugins`) stay bound to the
 * top-level (non-transaction) client — they are shared services initialised
 * once per request. Reads through a plugin service therefore won't see this
 * transaction's uncommitted writes, and a plugin service that WRITES would
 * escape the transaction and survive a rollback. Use `txContext.db` (not a
 * plugin service) for writes that must be atomic with the transaction.
 */
transaction: <T>(
  fn: (txContext: StackContext<TPrisma>) => Promise<T>,
  options?: TransactionOptions,
) => Promise<T>
```

Every paragraph earns its place under the general rule too — the plugin-services caveat in particular is exactly the "obvious edit is wrong" case (reaching for `txContext.plugins` inside a transaction looks correct and silently isn't atomic). It would survive even without the public-API exception; being on `StackContext` is why it's this thorough.

**Trimmed** — `getContext`, the exported context factory, is _not_ a config option, field builder, or plugin surface (it's the wiring function generated code calls), so its doc follows the ordinary rule rather than the exception:

```ts
// before
/**
 * Create an access-controlled context
 *
 * @param config - OpenSaas configuration
 * @param prisma - Your Prisma client instance (pass as generic for type safety)
 * @param session - Current session object (or null if not authenticated)
 * @param storage - Optional storage utilities (uploadFile, uploadImage, deleteFile, deleteImage)
 */
export function getContext<...
```

```ts
// after
export function getContext<...
```

Every `@param` line restated the parameter name and type sitting three lines below it. Being exported and widely used doesn't protect a docblock — only falling into one of the three named categories does, and `getContext` doesn't.

## 7. The same rationale threaded through several call sites — anchor it once

`packages/core/src/context/nested-operations.ts`, `NestedOpHandlerArgs` — several fields exist purely to carry the `#588` owning-field access gate through to `verifyConnectReachable`, and each one had re-explained the gate from scratch:

```ts
// before
/**
 * Field-level `access` of the OWNING relationship field on the list being
 * written (e.g. `Post.author`). Used by the connect/connectOrCreate handlers
 * to gate connects by the owning field's create/update access (#588).
 */
owningFieldAccess: FieldAccess | undefined
/**
 * The enclosing write's operation (`create`/`update`), used as the field-access
 * operation for the owning-field connect gate (#588).
 */
enclosingOperation: 'create' | 'update'
/**
 * The enclosing write's existing row (the parent `originalItem`): present for an
 * enclosing UPDATE, `undefined` for an enclosing CREATE. Threaded into the
 * connect-site owning-field gate so it evaluates `item` exactly like the
 * canonical Phase-5 `filterWritableFields` call and the two cannot diverge
 * (#588 finding).
 */
enclosingItem: Record<string, unknown> | undefined
/**
 * The enclosing write's input data. Threaded into the connect-site owning-field
 * gate so it evaluates `inputData` exactly like the canonical Phase-5
 * `filterWritableFields` call (#588 finding).
 */
enclosingInputData: Record<string, unknown> | undefined
```

```ts
// after
/**
 * Field-level `access` of the OWNING relationship field (e.g. `Post.author`).
 * Gates connect/connectOrCreate by the owning field's create/update access —
 * see the #588 gate in {@link verifyConnectReachable}.
 */
owningFieldAccess: FieldAccess | undefined
/** The enclosing write's operation, used as the owning-field gate's field-access operation. */
enclosingOperation: 'create' | 'update'
/**
 * The enclosing write's `originalItem` (`undefined` for an enclosing create).
 * Passed to the owning-field gate so it matches the canonical Phase-5
 * `filterWritableFields` call and the two can't diverge (#588).
 */
enclosingItem: Record<string, unknown> | undefined
/** The enclosing write's input data, passed to the owning-field gate for the same reason as `enclosingItem`. */
enclosingInputData: Record<string, unknown> | undefined
```

`enclosingOperation` and `enclosingInputData` no longer re-derive why the gate needs them — they point at `enclosingItem`'s fuller explanation and at `{@link verifyConnectReachable}`, the one place the `#588` finding is worth spelling out completely. Four independent tellings of the same fact become one, with three pointers — not one telling with three silences, which would leave a reader at any of the trimmed sites with no path to the "why" at all.

## What this doesn't cover

Every example above is from non-test TypeScript in `packages/core/src/context/`. It doesn't settle comment conventions in JSX/UI code, generator output, or config-file examples in READMEs — later cleanup passes in this issue set may need their own calibration for those.
