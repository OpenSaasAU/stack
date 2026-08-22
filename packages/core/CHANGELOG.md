# @opensaas/stack-core

## 0.40.0

### Minor Changes

- [#1020](https://github.com/OpenSaasAU/stack/pull/1020) [`8e6707a`](https://github.com/OpenSaasAU/stack/commit/8e6707adcca9d7e062bc1747ec79a29082c09ef9) Thanks [@borisno2](https://github.com/borisno2)! - Add `ui.listView.defaultColumn` to field config — a declared, presentation-only flag (default `true`) controlling whether a field belongs in a list/related-list table's default column set. Naming a field explicitly in `ui.listView.initialColumns` or a relationship's `ui.itemView.columns` always shows it regardless of this flag.

  ```typescript
  fields: {
    internalScore: integer({ ui: { listView: { defaultColumn: false } } }),
  }
  ```

  `password()` now sets this flag to `false` by default instead of the admin UI matching on field type — a password field can opt back into default columns with `ui: { listView: { defaultColumn: true } } }`.

- [#1011](https://github.com/OpenSaasAU/stack/pull/1011) [`afd1a60`](https://github.com/OpenSaasAU/stack/commit/afd1a60a6ddaa558bf14887e45fa1c007e6669b0) Thanks [@borisno2](https://github.com/borisno2)! - `OperationAccess.create` now throws `InvalidCreateAccessResultError` when the rule returns anything other than `true`/`false` — most notably a Prisma filter, which previously fell through the `create` access check unrecognised and was silently treated as a full allow (both the top-level write pipeline and nested-create paths were affected).

  Create has no existing row to scope a filter against, so a filter can no longer be honoured here:

  ```typescript
  // Before: type-checked, read as row-scoped, actually allowed everyone
  create: ({ session }) => ({ ownerId: { equals: session.userId } })

  // Now throws InvalidCreateAccessResultError. Scope ownership in a hook instead:
  hooks: {
    resolveInput: async ({ resolvedData, context, operation }) => {
      if (operation === 'create') {
        return { ...resolvedData, ownerId: context.session?.userId }
      }
      return resolvedData
    },
  },
  access: {
    operation: {
      create: ({ session }) => !!session, // boolean only
    },
  },
  ```

  `create: () => false` still denies via Silent failure as before; only a non-boolean result now throws.

- [#984](https://github.com/OpenSaasAU/stack/pull/984) [`51ae299`](https://github.com/OpenSaasAU/stack/commit/51ae299b7624f97e890f85b3075c62d8e114cec2) Thanks [@borisno2](https://github.com/borisno2)! - Extend `isIndexed` to `integer`, `timestamp`, and `select`, matching `text`, `decimal`, `bigInt`, `calendarDay`, and `relationship`.

  ```typescript
  fields: {
    rank: integer({ isIndexed: true }),
    publishedAt: timestamp({ isIndexed: true }),
    status: select({
      options: [{ label: 'Draft', value: 'draft' }],
      isIndexed: 'unique',
    }),
  }
  ```

  `isIndexed: true` generates a block-level `@@index([field])`; `isIndexed: 'unique'` generates an inline `@unique`. `select` supports both under the default string column and a native-enum column (`db: { type: 'enum' }`). No field type's default indexing behavior changes — an existing config generates the same schema as before.

- [#1007](https://github.com/OpenSaasAU/stack/pull/1007) [`4ce64b4`](https://github.com/OpenSaasAU/stack/commit/4ce64b4f9868eca0f34cc0676e46440b3d8f16ce) Thanks [@borisno2](https://github.com/borisno2)! - The derived MCP `query` tool now accepts an optional `fields` projection — the wire form of the runtime's existing fragment field selection — so an assistant can select scalars and nested relation fields (with `where`/`orderBy`/`take`/`skip`, and a to-many's row count) in a single call instead of following a foreign key with a second one. Omitting `fields` is unchanged, a bare read exactly as before.

  ```json
  {
    "name": "list_post_query",
    "arguments": {
      "fields": {
        "title": true,
        "author": { "fields": { "name": true } },
        "comments": {
          "fields": { "text": true },
          "where": { "approved": { "equals": true } },
          "take": 5,
          "count": true
        }
      }
    }
  }
  ```

  The generated tool schema enumerates two levels of each list's own fields and relations, per session, and refuses (as an `isError` tool result, never a protocol error) anything it doesn't advertise — an unknown field, or a relation named a third level deep. See the ADR (`docs/adr/0033-mcp-tools-advertise-a-bounded-projection.md`) for the full design.

  **Behaviour change:** `tools/list` is now evaluated per session. A list whose operation-level `query` access denies the session outright no longer appears in the tool listing at all — none of its four CRUD tools, and no relation entry elsewhere pointing at it. Previously every list's tools were listed regardless of session.

- [#1002](https://github.com/OpenSaasAU/stack/pull/1002) [`48d2762`](https://github.com/OpenSaasAU/stack/commit/48d27626dfb636c481301116e46c826ef3156124) Thanks [@borisno2](https://github.com/borisno2)! - Fix admin UI URL round-trip for a list keyed with anything other than strict PascalCase (issue [#991](https://github.com/OpenSaasAU/stack/issues/991)). `getListKeyFromUrl` reconstructs a list key by string transformation, which is lossy for a non-PascalCase key — a real example is a better-auth plugin's derived list (e.g. `oauthApplication`, from the `mcp` plugin's OAuth tables). Such a list appeared in navigation but its own link resolved to a key that did not exist in `config.lists`, rendering "List not found".

  `@opensaas/stack-core` adds `resolveListKeyFromUrl(urlSegment, listKeys)` alongside the existing `getListKeyFromUrl`, which is unchanged and still exported. The new resolver matches a URL segment against the config's actual list keys via `getUrlKey` — the same helper that builds the URL — instead of reconstructing one, so route lookup and URL generation cannot drift apart. It returns `undefined` for a segment matching no list (so callers keep rendering their existing "not found" state), and throws if two distinct list keys would produce the same URL segment.

  ```typescript
  import { resolveListKeyFromUrl } from '@opensaas/stack-core'

  resolveListKeyFromUrl('oauth-application', Object.keys(config.lists)) // 'oauthApplication'
  resolveListKeyFromUrl('does-not-exist', Object.keys(config.lists)) // undefined
  ```

  `@opensaas/stack-ui`'s `AdminUI` now uses `resolveListKeyFromUrl` for its route resolution, fixing the broken link for any such list.

  `@opensaas/stack-auth`'s `convertBetterAuthSchema` now PascalCases a better-auth plugin's camelCase `modelName` when deriving a list key (`oauthApplication` → `OauthApplication`, `rateLimit` → `RateLimit`), matching the repo's PascalCase list-key convention and fixing the same round-trip bug at the source for these lists.

  **Schema-affecting for `@opensaas/stack-auth` users with a better-auth plugin that declares extra tables** (e.g. `mcp`'s OAuth tables, or `rateLimit.storage: 'database'` with no `modelName` remap configured): the generated Prisma **model name** changes to match the new PascalCase list key. The physical **table name** does not change — the previous camelCase name is preserved via `db.map` (`@@map`) — so `prisma db push` / `prisma migrate dev` sees a model rename, not a table rename, and `context.db.oauthApplication` (the camelCase db accessor) keeps working unchanged. Regenerate (`pnpm generate`) and re-run your migration/push step after upgrading.

- [#1003](https://github.com/OpenSaasAU/stack/pull/1003) [`9de43c8`](https://github.com/OpenSaasAU/stack/commit/9de43c80c8ef996dc6f08f68f7c1d8451aa0f10e) Thanks [@borisno2](https://github.com/borisno2)! - Add `context.withSession(session)` — a sibling to `sudo()` for the other axis. It derives a `StackContext` that reuses the receiver's already-resolved config, client (including a transaction client — a call inside `context.transaction()` stays in that transaction), and storage, but carries a substituted session, so access control and hooks run against the new session as normal.

  This closes a gap for callers that are legitimately authorised but arrive without the session a list `validate` hook expects — an unattended dispatcher, a service principal, or a job runner:

  ```typescript
  // Runs with the job owner's session so hooks see the right identity, while
  // still going through the normal access control checks for that session.
  const asOwner = context.withSession(job.ownerSession)
  await asOwner.db.task.update({ where: { id: job.taskId }, data: { status: 'done' } })

  // Drop to anonymous
  const anonymous = context.withSession(null)
  ```

  `withSession` grants no authority of its own — the derived context can do exactly what any context built with that session directly could do. It's orthogonal to `sudo()`: `context.withSession(s).sudo()` and `context.sudo().withSession(s)` are equivalent, since `withSession` preserves the receiver's sudo state instead of resetting it.

  The generated `Context<TSession>` type (`.opensaas/types.ts`) now includes `withSession: (session: TSession | null) => Context<TSession>` alongside `sudo`, so the method is typed in application code — run `opensaas generate` (or `pnpm generate`) to pick it up.

### Patch Changes

- [#1017](https://github.com/OpenSaasAU/stack/pull/1017) [`b30fa61`](https://github.com/OpenSaasAU/stack/commit/b30fa6135a6acca8c9be99fbdf5ffa7faab1959f) Thanks [@{](https://github.com/{)! - Let an application declare model-level indexes (`db.indexes`) on the derived auth lists (`User`/`Session`/`Account`/`Verification`/`RateLimit`).

  Each per-model block in `authPlugin()` now accepts `indexes`, in the same shape as a list's own `db.indexes`:

  ```typescript
  authPlugin({
    // Adopt a live constraint's real name instead of Prisma's derived one.
   indexes: [{ fields: ['email'], unique: true, name: 'user_email_key' }] },
    session: { indexes: [{ fields: ['token'], unique: true, name: 'session_token_key' }] },
    // Extend a derived column into a composite index.
    verification: {
      indexes: [{ fields: ['identifier', { field: 'createdAt', sort: 'desc' }] }],
    },
  })
  ```

  An entry covering a column the stack already derives an index for (e.g. `User.email`) suppresses that derived index for that column and emits only the app's entry, rather than erroring — the application's declaration wins (ADR-0035). Suppression is per-column: every other derived index on the model is unaffected.

  This also fixes a related generator gap: a list's `db.indexes` can now reference `createdAt`/`updatedAt` even when the list has no explicit field for them and relies on `db.timestamps` for the auto-injected columns (previously only a list with an explicitly declared `createdAt`/`updatedAt` field could be indexed on it).

- [#983](https://github.com/OpenSaasAU/stack/pull/983) [`16da817`](https://github.com/OpenSaasAU/stack/commit/16da8176114826d18d6747d27abedf75de6c3262) Thanks [@borisno2](https://github.com/borisno2)! - Fix `HashedPassword.toJSON()` returning the raw bcrypt hash, so `JSON.stringify` of a row (e.g. a server→client prop, `Response.json()`, an MCP tool response) no longer leaks the stored hash for a `password()` field.

  `toJSON()` now returns `{ isSet: boolean }`, matching the redaction the admin UI already applies via `valueForClientSerialization`. `toString()`, `valueOf()`, `[Symbol.toPrimitive]`, and `==` comparison against the hash are unchanged. If you parse `JSON.stringify`'d rows and read the password field as a string, update that code to read `.isSet` instead — this is a visible output/type change on `HashedPassword.toJSON()`, though the field's read access remains the application's to configure (unchanged).

- [#999](https://github.com/OpenSaasAU/stack/pull/999) [`f85c7d1`](https://github.com/OpenSaasAU/stack/commit/f85c7d1b92e76d5e8ae090f93c0ff94e0d6c36c1) Thanks [@borisno2](https://github.com/borisno2)! - MCP derived CRUD tool and custom tool failures (access denial, thrown engine/database errors, input schema validation) now return a successful JSON-RPC response with `result.isError: true` instead of a JSON-RPC `error` object, so the calling model can see and recover from them. Genuine protocol failures (unknown method, malformed request, unknown tool name) are unchanged. Note: the wire shape of tool failures changes — a consumer asserting on the old `error` shape will need to update.

- [#1006](https://github.com/OpenSaasAU/stack/pull/1006) [`0f2e12a`](https://github.com/OpenSaasAU/stack/commit/0f2e12a69710e759d8749b8536fd5b31836226e9) Thanks [@borisno2](https://github.com/borisno2)! - `relationship({ ref: 'ListName' })` list-only refs now accept `db.foreignKey: { map: '...' }` to rename the foreign key column. The boolean form (`true`/`false`) is still rejected there since ownership is implicit on a list-only ref.

- [#1004](https://github.com/OpenSaasAU/stack/pull/1004) [`05c747a`](https://github.com/OpenSaasAU/stack/commit/05c747a18284ac769860f751a660b72591570571) Thanks [@borisno2](https://github.com/borisno2)! - Fix a nested create/update/delete through a list-only ref's synthetic reverse relation (`from_<List>_<field>`) silently bypassing the target list's hooks and validation. It now runs the same pipeline a declared relationship field's nested write gets. Under `sudo()`, an undeclared key that isn't a synthetic reverse relation is now refused rather than passed through unchecked.

- [#1000](https://github.com/OpenSaasAU/stack/pull/1000) [`0b5b51e`](https://github.com/OpenSaasAU/stack/commit/0b5b51e52787ea9e945206a109a7a56dc38e78e5) Thanks [@borisno2](https://github.com/borisno2)! - Fix `P2002` unique-constraint errors losing per-field detail under Prisma 7 driver adapters (`@prisma/adapter-pg`, PGlite), where `meta.target` is left empty. The error handler now recovers the violated columns and constraint name from the adapter's error shape, and a new `uniqueConstraintOf(error)` helper exposes this to callers of `context.db.*` directly. Unique-violation messages under driver adapters change from the generic fallback back to field-specific text.

- [#1001](https://github.com/OpenSaasAU/stack/pull/1001) [`52dfdd2`](https://github.com/OpenSaasAU/stack/commit/52dfdd2c051aa2f4b4cbd96a459213c34c3bf85c) Thanks [@borisno2](https://github.com/borisno2)! - Fix `include` on a to-one relationship throwing `PrismaClientValidationError` when the related list's `query` access resolves to a filter (Prisma only accepts a nested `where` on a to-many include). The relation is now fetched and access-scoped via a batched existence check instead, returning `null` for an excluded related row rather than throwing — a caller relying on the previous exception, or whose types assumed a non-null relation, should re-check nullability.

## 0.39.2

### Patch Changes

- [#960](https://github.com/OpenSaasAU/stack/pull/960) [`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6) Thanks [@borisno2](https://github.com/borisno2)! - Fix `OutputConfig.opensaasDir`'s doc comment, which still listed the now-removed generated `prisma-extensions.ts` module among the bundle files.

## 0.39.1

## 0.39.0

### Minor Changes

- [#926](https://github.com/OpenSaasAU/stack/pull/926) [`5e546b0`](https://github.com/OpenSaasAU/stack/commit/5e546b0fe3542ba41fc77e0a4628acc96eec13ea) Thanks [@borisno2](https://github.com/borisno2)! - Add a first-class `bigInt()` field type for 64-bit integers (e.g. a millisecond epoch) that overflow `integer()`'s 32-bit `Int` — Prisma `BigInt`, TypeScript `bigint`, with an admin UI component, filtering, and MCP support.

  ```typescript
  import { bigInt } from '@opensaas/stack-core/fields'

  fields: {
    occurredAtMs: bigInt({ validation: { isRequired: true } }),
  }

  await context.db.event.create({
    data: { occurredAtMs: 9007199254740993n }, // bigint, number, or numeric string
  })
  ```

  Create/update accept `bigint`, an integer `number`, or a numeric `string`, and always coerce to `bigint`. A `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than silently losing precision. `bigint` isn't JSON-serialisable, so an MCP CRUD tool renders the value as a decimal string instead of throwing, and the admin UI's server→client boundary (list table, item form, relationship table) now round-trips a `bigint` value correctly rather than throwing during render. The migration introspector maps Prisma `BigInt` columns to `bigInt()` instead of the previous lossy `text()` fallback.

- [#919](https://github.com/OpenSaasAU/stack/pull/919) [`cbb03fc`](https://github.com/OpenSaasAU/stack/commit/cbb03fc26047869d23513fbb156c6194d9be389b) Thanks [@borisno2](https://github.com/borisno2)! - Fix a fail-open bug where a field-level access rule returning a Prisma filter (instead of a boolean) silently granted the field full access. `checkFieldAccess` now throws `InvalidFieldAccessResultError` for any non-boolean result instead of defaulting to allow.

  This narrows `FieldAccessControl`'s return type from `boolean | PrismaFilter | Promise<...>` to `boolean | Promise<boolean>` — field-level access was already documented (ADR-0001) to be boolean-only; the type had drifted from that. If a field rule returned a filter, it will now fail to compile (or throw at runtime for untyped/JS configs) instead of silently granting access. Evaluate the condition yourself and return a boolean instead, e.g.:

  ```ts
  // Before (silently granted full access on read/write)
  someField: text({
    access: {
      update: ({ session }) => ({ ownerId: { equals: session?.userId } }),
    },
  })

  // After
  someField: text({
    access: {
      update: ({ session, item }) => !!session && session.userId === item?.ownerId,
    },
  })
  ```

  See `docs/adr/0030-field-level-access-fails-closed-on-a-non-boolean-result.md` for the full reasoning.

- [#925](https://github.com/OpenSaasAU/stack/pull/925) [`6f9a64d`](https://github.com/OpenSaasAU/stack/commit/6f9a64d2f25212e91181adc2b67add326a540f6a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a field-level `read` gate withholding a field's VALUE but leaving its PREDICATE unconstrained: a read-denied field could still be named in a `where`/`orderBy`, letting its value (or relative order) be recovered by probing — `count()` is the cleanest instrument, since it answers a predicate while returning no rows at all. `findMany`/`count` now reject a `where`/`orderBy` key naming a field the session cannot read (including nested inside `AND`/`OR`/`NOT`), throwing instead of returning a silently narrowed or empty result. A `read` rule that depends on the fetched row (`item`) cannot be evaluated before the query runs and now resolves to a denial rather than being skipped — see `docs/adr/0031-a-predicate-cannot-name-a-field-the-session-cannot-read.md`. `sudo` is unaffected.

  This was independently reachable through the admin UI's own list view: `collectFilterSpecs`, `buildListFilterWhere`, and `collectFilterSuggestions` (`@opensaas/stack-core`) now take a required `{ session, context }` argument and return a `Promise`, excluding a read-denied field from the collected Filter specs so the UI never suggests, autocompletes, or submits a filter the engine is going to reject — a `field:value` token for such a field now degrades to free text instead. The list view's sort validation (`@opensaas/stack-ui`) excludes the same fields from what a `?sort=` URL param may activate.

  ```ts
  // Before
  const specs = collectFilterSpecs(listConfig, listKey, config)
  const where = buildListFilterWhere(query, listConfig, listKey, config)
  const suggestions = collectFilterSuggestions(listConfig, listKey, config)

  // After — pass the session/context the field's `read` access is checked against
  const specs = await collectFilterSpecs(listConfig, listKey, config, { session, context })
  const where = await buildListFilterWhere(query, listConfig, listKey, config, { session, context })
  const suggestions = await collectFilterSuggestions(listConfig, listKey, config, {
    session,
    context,
  })
  ```

- [#934](https://github.com/OpenSaasAU/stack/pull/934) [`9a399d6`](https://github.com/OpenSaasAU/stack/commit/9a399d68e4d3f384d4cef5ccd5fc8ec6802a40a5) Thanks [@list({](https://github.com/list({)! - `afterTransaction` now fires when the OUTERMOST transaction a write participates in settles, and can report `status: 'rolled-back'` where it always reported `'committed'` before (ADR-0028, fixes [#899](https://github.com/OpenSaasAU/stack/issues/899)).

  A write that joins a transaction it did not open — inside `context.transaction()`, or a hook's own `context.db` write — used to fire its `afterTransaction` bracket optimistically as soon as its own write returned, even though the enclosing transaction was still open and could still roll back. It now defers that bracket until the transaction owner (`context.transaction()`, or the Write Pipeline when it opened the transaction) observes the real commit/rollback, then reports the outcome as a conjunction: `committed` if and only if the write itself succeeded **and** the enclosing transaction committed (the write's own error always wins over the transaction's outcome). `beforeTransaction` is unaffected — it still runs eagerly, before its write.

  ```typescript

    hooks: {
      afterTransaction: async ({ status, item, error }) => {
        if (status === 'rolled-back') {
          // Now correctly fires even when this write itself succeeded but the
          // OUTER context.transaction() callback later threw.
          await billing.releaseSeat(error)
        } else {
          await billing.confirmSeat(item.seatId)
        }
      },
    },
  })
  ```

  Three behavior changes to be aware of when upgrading:

  - A `context.transaction()` call can now **reject** with `AfterTransactionError` even after its underlying transaction already committed, if a deferred `afterTransaction` hook throws. A transaction/serialization error (e.g. `P2034`) still takes precedence and propagates unwrapped, so an existing `P2034` retry loop is unaffected.
  - The deferred `item` a joined write's `afterTransaction` receives on commit is the row **as that write persisted it**, captured at write time — not re-read at flush — so it can be stale if a later write in the same transaction touches the same record.
  - Transaction-boundary hooks (`beforeTransaction`/`afterTransaction`) on a joined write now always receive a context bound to the base client, never the transaction client — matching what top-level writes already did.

  A write with no transaction owner at all (an app-managed `prisma.$transaction`, or a client that cannot open one, e.g. a bare test mock) is unaffected and still fires `afterTransaction` optimistically at write time.

  See `docs/adr/0028-a-transaction-boundary-hook-reports-the-outermost-transaction.md` and the "In-transaction vs transaction-boundary hooks" section of the hooks concept doc.

- [#924](https://github.com/OpenSaasAU/stack/pull/924) [`05c9ad4`](https://github.com/OpenSaasAU/stack/commit/05c9ad40f8c4e76718d870e0c1c02511a3475943) Thanks [@borisno2](https://github.com/borisno2)! - Fix `FieldAccess['read']` typing `item` as absent when Field Visibility always passes the fetched row. A field `read` rule that reads a property off `item` now compiles without a cast, `any`, or non-null assertion:

  ```ts
  // Before (required a cast/assertion — `item` was typed `undefined`)
  internalNotes: text({
    access: {
      read: ({ item, session }) => item!.ownerId === session?.userId,
    } as FieldAccessControl,
  })

  // After (compiles as written — `item` is typed as the row)
  internalNotes: text({
    access: { read: ({ item, session }) => item.ownerId === session?.userId },
  })
  ```

  `FieldAccess['read']` now accepts only the single `operation: 'read'` call shape (rather than the full `read | create | update` union `FieldAccess['create']`/`FieldAccess['update']` still accept), so a rule written for the `read` slot never needs to narrow on `operation` to use `item`. The `create` branch — where there genuinely is no row yet — is unchanged.

### Patch Changes

- [#947](https://github.com/OpenSaasAU/stack/pull/947) [`5f00c3a`](https://github.com/OpenSaasAU/stack/commit/5f00c3a456295a1125281a4227309a8f8c6d853d) Thanks [@borisno2](https://github.com/borisno2)! - Clean up comments across `access/`, `config/`, `fields/`, `filter/`, `hooks/`, `lib/`, `mcp/`, `query/`, `utils/` and `validation/` per the CLAUDE.md Comments rule. No behavior changes.

- [#946](https://github.com/OpenSaasAU/stack/pull/946) [`4d8b654`](https://github.com/OpenSaasAU/stack/commit/4d8b654d099ce13d00893ebc4ce904fa69f2c47a) Thanks [@borisno2](https://github.com/borisno2)! - Restore two comments in `src/context/` that were trimmed too far in a prior comment cleanup ([#945](https://github.com/OpenSaasAU/stack/issues/945)). No behavior changes.

- [#920](https://github.com/OpenSaasAU/stack/pull/920) [`e0baadd`](https://github.com/OpenSaasAU/stack/commit/e0baaddade059cfea639d232f6953fc8c339f6f4) Thanks [@borisno2](https://github.com/borisno2)! - `findMany`/`count` now reject an undeclared `where`/`orderBy` key (including nested inside `AND`/`OR`/`NOT` or a relation filter), closing the same back-relation surface [#564](https://github.com/OpenSaasAU/stack/issues/564) closed on writes. `sudo` still bypasses.

- [#945](https://github.com/OpenSaasAU/stack/pull/945) [`ab4a5dd`](https://github.com/OpenSaasAU/stack/commit/ab4a5ddd83eebcf85d4a98f210cd378b974725f5) Thanks [@borisno2](https://github.com/borisno2)! - Clean up comments in `src/context/` per the CLAUDE.md Comments rule. No behavior changes.

- [#929](https://github.com/OpenSaasAU/stack/pull/929) [`94802ee`](https://github.com/OpenSaasAU/stack/commit/94802eee3b2fdc64fab4b576945820a6df9311c5) Thanks [@borisno2](https://github.com/borisno2)! - Fix: a relation filter in `where` (`some`/`every`/`none`/`is`/`isNot`) no longer bypasses the related list's `query` access — it is now scoped exactly like `include` already is, recursing through every hop of a chain, on both `findMany` and `count`. A filter through a related list that denies query access now throws `RelationFilterAccessDeniedError` instead of silently running unscoped; field-level `read` access on the related list also now applies to keys named inside the filter. `@opensaas/stack-ui`'s admin list view no longer needs its own relationship label-filter access fold, since the engine now covers it.

- [#931](https://github.com/OpenSaasAU/stack/pull/931) [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102) Thanks [@borisno2](https://github.com/borisno2)! - Correct `ListIndex`/`db.indexes` doc comments, which wrongly claimed an entry must span two or more fields — a single-field entry is fully supported and now documented as such.

## 0.38.0

### Minor Changes

- [#873](https://github.com/OpenSaasAU/stack/pull/873) [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68) Thanks [@borisno2](https://github.com/borisno2)! - Naming a relation in an `include` now fetches only that relation's own columns and stops, at every level — not just the root. This completes ADR-0024 (a bare read fetches scalars, never relations): reaching a relation's own relations means naming them too, e.g. `include: { author: { include: { organization: true } } }` rather than relying on `include: { author: true }` to pull `organization` in automatically. A relation nobody named (caller `include`, fragment `query`, or a field's `needs`) never has its list's operation-level `query` access evaluated at all.

  **This is a silent break — detect it before you upgrade.** An `include` that named a relation bare and read past it (`item.<named>[0].<unnamed>`) now gets `undefined` for the unnamed part, with no error. Grep your codebase for `include: {` calls whose consumers read a second hop off a bare-named relation, and add the deeper relation explicitly:

  ```typescript
  // Before: relied on `author` auto-expanding its own `organization` relation
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: true },
  })
  post.author.organization // silently undefined now

  // After: name the relation you actually need
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: { include: { organization: true } } },
  })
  post.author.organization // present
  ```

  `AccessScopeDepthExceededError` (thrown when an `include` names a relation past `READ_INCLUDE_MAX_DEPTH`) keeps its type, fields, and throw sites — only its message wording changed, from describing an inability to scope to describing a cost refusal, since the depth cap is now a cost limit rather than a security boundary (nothing walks the relationship graph unprompted anymore).

- [#890](https://github.com/OpenSaasAU/stack/pull/890) [`17eb72f`](https://github.com/OpenSaasAU/stack/commit/17eb72f0a9a4b7508e3f318da66bb8d4c6cbd705) Thanks [@list({](https://github.com/list({)! - A computed field — any field carrying a `resolveOutput` hook, virtual or not — is now computed if and only if a read is actually going to return it. A fragment `query` that selects three fields no longer runs every `resolveOutput` on the list and discards the rest: an unselected field's field-level read access is never evaluated and its hook never runs. Its declared relations (`needs`, ADR-0025) are fetched under exactly the same condition, folded recursively at every nesting level — a nested fragment selecting a subset computes only that subset, while a nested `include` still computes every computed field at that level, matching bare and `include`-based reads, which are unaffected: they still compute every computed field on the list, exactly as before. See ADR-0027.

  **This is a silent break — detect it before you upgrade, the same way ADR-0024's and ADR-0026's were.** Two independent behaviors changed with no thrown error:

  1. **A hook's `item` never carries another computed field's resolved output, on any read path.** Previously a virtual field received the already-assembled, already-resolved object, so a virtual field could read an _earlier-declared_ virtual (or any field carrying its own `resolveOutput`, e.g. a `password()`'s wrapper or a formatted display field) and see its resolved value — working only by declaration order, with reordering two fields silently changing the result. Now every computed field's hook sees only the row's stored columns and its own declared dependencies; reaching for a sibling that is itself computed finds nothing there (or its raw stored form, never the wrapped/resolved value), the same as reaching for a field that was never declared. **Grep your config for a `resolveOutput` whose `item` reads a field that is itself computed** — virtual fields reading other virtual fields, or a hook reading a stored field that carries its own `resolveOutput` (a password wrapper, a formatted date) — and recompute from the shared stored columns instead of relying on another field's hook having already run.
  2. **A field's hook no longer runs just because it's on the list — only because a read selects it.** If you relied on a `resolveOutput` hook running for a side effect (logging, cache warming) on every read regardless of a fragment's own field selection, that side effect now only fires when the fragment actually names the field. **Grep for a fragment `query` that intentionally omits a field whose hook you were relying on for a side effect**, and select that field explicitly (or move the side effect to a hook that isn't projection-gated, e.g. `afterOperation`).

  A hookless virtual field (one with `access.read` but no `resolveOutput`) no longer has its read access evaluated at all on any read — such a field can never produce output, so under this rule it does no work at all.

  ```typescript
  // Before: `displayName` (declared after `fullNameCached`) could read the
  // latter's resolved value purely because of declaration order.

    fields: {
      firstName: text(),
      lastName: text(),
      fullNameCached: virtual({
        type: 'string',
        hooks: { resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}` },
      }),
      displayName: virtual({
        type: 'string',
        // item.fullNameCached is now always undefined here — recompute from
        // the shared stored columns instead.
        hooks: { resolveOutput: ({ item }) => `${item.fullNameCached} (${item.firstName[0]}.)` },
      }),
    },
  })

  // After: compute from the stored columns both fields actually share.
  displayName: virtual({
    type: 'string',
    hooks: {
      resolveOutput: ({ item }) => `${item.firstName} ${item.lastName} (${item.firstName[0]}.)`,
    },
  }),
  ```

### Patch Changes

- [#873](https://github.com/OpenSaasAU/stack/pull/873) [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68) Thanks [@borisno2](https://github.com/borisno2)! - Fix `needs` declarations being dropped beneath a caller-named relation that revisits a list (e.g. `include: { author: { include: { posts: true } } }`, or a self-referential `parent`), which left the revisited list's computed fields resolving over `undefined`.

## 0.37.0

### Minor Changes

- [#868](https://github.com/OpenSaasAU/stack/pull/868) [`6bf9dcb`](https://github.com/OpenSaasAU/stack/commit/6bf9dcb1b8d030d57371b6b4a4f55462eb8ab2eb) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.indexes` to `ListConfig` for model-level composite `@@unique`/`@@index` constraints spanning two or more of a list's own fields — the multi-column case single-field `isIndexed` can't reach.

  Entries name OpenSaaS field names, not raw database columns; the generator resolves a scalar field to its own name and a relationship field to its foreign key column:

  ```typescript
  Audition: list({
    fields: {
      student: relationship({ ref: 'Student.auditions' }),
      production: relationship({ ref: 'Production.auditions' }),
    },
    db: {
      // One audition per student per production — a DB-level backstop a
      // hook's existence check alone can't provide against concurrent writes.
      indexes: [{ fields: ['student', 'production'], unique: true }],
    },
  })
  // Generates: @@unique([studentId, productionId])

  AuthVerification: list({
    fields: { identifier: text(), createdAt: timestamp() },
    db: {
      indexes: [
        {
          fields: ['identifier', { field: 'createdAt', sort: 'desc' }],
          name: 'AuthVerification_identifier_createdAt_idx', // adopts an existing constraint name via Prisma's `map:`
        },
      ],
    },
  })
  // Generates: @@index([identifier, createdAt(sort: Desc)], map: "AuthVerification_identifier_createdAt_idx")
  ```

  An entry naming an unknown field, a virtual field, a to-many relationship, or the non-FK side of a one-to-one relationship fails `pnpm generate` with an error naming the list, the entry, and the bad field, rather than being silently dropped or emitted as invalid Prisma. A config with no `db.indexes` generates byte-for-byte identical output to before this change.

- [#870](https://github.com/OpenSaasAU/stack/pull/870) [`7b6189f`](https://github.com/OpenSaasAU/stack/commit/7b6189fa60119a45082ba62dd71d915d93de529c) Thanks [@relationship({](https://github.com/relationship({)! - A relationship field's foreign key can now be declared non-nullable via `db.isNullable: false` — the generated FK column and its relation field lose their `?` together. Omitting the option leaves every existing relationship unchanged (still nullable by default).

  ```typescript

    ref: 'User.sessions',
    db: { isNullable: false },
  })
  // Generates: userId String  (was String?)
  //            user   User    @relation(...)  (was User?)
  ```

  `@opensaas/stack-auth`'s derived Auth lists now use this to match better-auth's own Prisma schema: `Session.expiresAt`, `Verification.expiresAt`, and the `Session.user`/`Account.user` foreign keys generate as required instead of nullable.

  **Migration note:** this changes the generated schema for existing greenfield apps. Running `opensaas generate` followed by `prisma db push`/`prisma migrate dev` will produce a migration that adds `NOT NULL` to `Session.expiresAt`, `Verification.expiresAt`, `Session.userId`, and `Account.userId`. Since better-auth's own adapter always writes these columns, no existing row should violate the new constraint — but back up production data before applying, as with any schema migration.

## 0.36.0

### Minor Changes

- [#857](https://github.com/OpenSaasAU/stack/pull/857) [`cdca174`](https://github.com/OpenSaasAU/stack/commit/cdca17444a5259cd0d3d8604a90a2cea4566cda2) Thanks [@borisno2](https://github.com/borisno2)! - Add `needs` to the base field config: a computed field can declare the immediate relations its `resolveOutput` hook depends on, so the read fetches exactly those — without widening what the caller receives (ADR-0025).

  Since ADR-0024, a bare read (no caller `include`) returns a row's own columns only, so a virtual field reading `item.someRelation` silently computed over `undefined` unless a caller happened to include it. `needs` fixes that:

  ```typescript
  Order: list({
    fields: {
      lineItems: relationship({ ref: 'LineItem.order', many: true }),
      total: virtual({
        type: 'number',
        needs: ['lineItems'],
        hooks: {
          resolveOutput: ({ item }) =>
            item.lineItems.reduce((sum, li) => sum + li.price * li.quantity, 0),
        },
      }),
    },
  })
  ```

  The declared relation is fetched wherever the field is computed — at the root of a read and at every nested level — and is scoped through the Access Filter exactly like a caller-named relation: a dependency the session can't query is not fetched, and the hook sees nothing in its place. A field always computes on whatever it can see, so a partially-denied dependency still produces a value rather than being withheld. The relation itself is stripped from the result unless the caller named it too, for both `include` reads and fragment `query` reads.

  `needs` is available on every field type, not only `virtual()`. `opensaas generate` now also validates every `needs` declaration: an entry naming a non-relationship or non-existent field, or a declaration closure that can't fit within the read-include depth cap from any starting point, fails generation with a message naming the offending field/chain rather than silently truncating at runtime.

  See `docs/adr/0025-a-computed-field-declares-the-relations-it-needs.md`.

### Patch Changes

- [#859](https://github.com/OpenSaasAU/stack/pull/859) [`ebb4cd3`](https://github.com/OpenSaasAU/stack/commit/ebb4cd3515ff40f960f888e7b4147d1d089a0966) Thanks [@borisno2](https://github.com/borisno2)! - Fix `isIndexed: true` on `text`, `decimal` and `calendarDay` emitting an invalid inline `@index` attribute, producing a schema Prisma rejects with "Attribute not known: @index".
  Non-unique indexes are now emitted as block-level `@@index([field])`; `isIndexed: 'unique'` is unchanged.

## 0.35.0

### Minor Changes

- [#853](https://github.com/OpenSaasAU/stack/pull/853) [`d0c94a9`](https://github.com/OpenSaasAU/stack/commit/d0c94a994e8be67742c97b6757ca4dd4e454f682) Thanks [@borisno2](https://github.com/borisno2)! - **This break is silent.** A `context.db` read with no `include` (and no fragment `query`) used to auto-include every readable relationship of the list, recursing up to 5 levels deep. It now returns the row's own columns plus its virtual fields only — matching Prisma's own semantics for a bare read — and relations arrive only when you name them. A read that used to return `post.author` now returns no `author` key at all: no error, no warning, just less data (ADR-0024). This applies uniformly to `findUnique`, `findMany`, and a singleton's `get()`, under sudo and under a session alike. Foreign-key columns (e.g. `authorId`) are unaffected and always returned, so a relation stays reachable by id without an `include`.

  **Detect call sites that need updating:**

  - Grep for bare reads: `context.db.*.find*` calls (or a singleton's `.get()`) with no `include` and no `query` argument, whose result is later used to access a relationship field.
  - Grep for `resolveOutput` hooks on `virtual` fields that read a relation off `item` (e.g. `item.author`, `item.posts`) — these silently degrade the same way, since a hook's own `context.db` read is subject to the same rule.

  **Migrate** by naming the relation explicitly, either via `include`:

  ```typescript
  // Before — relied on the auto-include
  const post = await context.db.post.findUnique({ where: { id } })
  post.author // used to be populated

  // After — name it
  const post = await context.db.post.findUnique({
    where: { id },
    include: { author: true },
  })
  post.author // populated
  ```

  or via a fragment `query`:

  ```typescript
  const post = await context.db.post.findUnique({
    where: { id },
    query: postWithAuthorFragment,
  })
  ```

  A `resolveOutput` hook that read `item.<relation>` should instead read through `context.db` with an explicit `include`, or its caller should pass one.

  **Singleton `get()` gains caller-`include` support** it never had — it can now be narrowed and widened like any other read:

  ```typescript
  const settings = await context.db.settings.get({ include: { homepage: true } })
  ```

  Bare reads also stop evaluating operation-level `query` access on related lists (that walk previously ran for every relation at every level before fetching anything), so an access function relied on for a side effect will no longer fire on a bare read.

  See `docs/adr/0024-a-read-with-no-include-fetches-scalars-not-relations.md` for the full rationale.

## 0.34.0

### Minor Changes

- [#846](https://github.com/OpenSaasAU/stack/pull/846) [`fedc858`](https://github.com/OpenSaasAU/stack/commit/fedc858f41bf5cacf001f64e7b710112f2fce20b) Thanks [@borisno2](https://github.com/borisno2)! - Fix unbounded recursion when a `resolveOutput` hook issues its own read ([#844](https://github.com/OpenSaasAU/stack/issues/844)): a hook's read could return rows whose own `resolveOutput` hooks issued further reads with no bound, driving the process to the V8 heap limit on a cyclic readable-relationship graph.

  Reads are now tracked with a resolve chain — the ordered `(list, field)` pairs a read has entered via `resolveOutput` hooks. A hook that would re-enter a pair already on its own chain throws the new `ResolveOutputCycleError` naming the full chain, instead of recursing forever:

  ```ts
  import { ResolveOutputCycleError } from '@opensaas/stack-core'

  try {
    await context.db.user.findMany({})
  } catch (err) {
    if (err instanceof ResolveOutputCycleError) {
      // err.chain: readonly { listKey: string; fieldKey: string }[]
    }
  }
  ```

  An acyclic chain that runs deeper than `RESOLVE_CHAIN_MAX_LENGTH` (a cost limit, not a correctness guard) omits the field and logs a single `console.warn` instead of throwing — a legitimately terminating hook chain (e.g. a virtual field reading another virtual field several hops deep) is never denied.

  This also fixes a related bug where a plain top-level read running concurrently with an unrelated in-flight `resolveOutput` hook could have its own nested auto-include silently collapsed, because the previous implementation tracked "am I inside a hook?" on one mutable counter shared by the whole request.

  **Breaking (internal plumbing only):** `AccessContext`'s underscore-prefixed `_resolveOutputCounter: { depth: number }` is replaced by `_resolveOutputChain: readonly { listKey: string; fieldKey: string }[]`. Application code never reads this field. Hand-built `AccessContext` mocks in tests need a one-line update:

  ```ts
  // Before
  _resolveOutputCounter: {
    depth: 0
  }
  // After
  _resolveOutputChain: []
  ```

## 0.33.0

### Minor Changes

- [#838](https://github.com/OpenSaasAU/stack/pull/838) [`0caf680`](https://github.com/OpenSaasAU/stack/commit/0caf68007e41b69f1a5d5f74fb15df2548a559dc) Thanks [@borisno2](https://github.com/borisno2)! - **Behavior change:** reads that previously returned deeply-nested relation data unscoped now throw instead. A caller-supplied `include` nested past the Access Filter's read-include depth cap (`READ_INCLUDE_MAX_DEPTH`, 5) used to fail OPEN — the relation was fetched with no row filter and its fields were never access-checked or `resolveOutput`-processed. It now fails CLOSED: the read throws a new `AccessScopeDepthExceededError` (exported from `@opensaas/stack-core`) naming the list, relation field, and depth reached, instead of returning unscoped data.

  ```typescript
  import { AccessScopeDepthExceededError } from '@opensaas/stack-core'

  try {
    await context.db.post.findMany({
      include: { author: { include: {/* … nested past the depth cap */} } },
    })
  } catch (err) {
    if (err instanceof AccessScopeDepthExceededError) {
      // err.listKey / err.fieldKey / err.depth — restructure into shallower reads.
    }
  }
  ```

  An ordinary read with no caller `include`, or one within the depth limit, is unaffected — the auto-include still stops silently at the cap, matching prior behavior. A read issued from inside a `resolveOutput`/virtual-field hook now also row-scopes its immediate relations (previously it skipped scoping entirely at that point). Field-level read access and `resolveOutput` hooks are now applied at every nesting depth on the returned rows, with no independent cap of their own. See ADR-0022 and issue [#830](https://github.com/OpenSaasAU/stack/issues/830).

### Patch Changes

- [#839](https://github.com/OpenSaasAU/stack/pull/839) [`1a3f51d`](https://github.com/OpenSaasAU/stack/commit/1a3f51d5837d6e5244ccf04c3d14c41c264701c3) Thanks [@borisno2](https://github.com/borisno2)! - Fix `beforeTransaction`/`afterTransaction` hooks not firing for lists reachable only past the involved-list enumeration's old fixed depth cap. These hooks now fire for every list a write touches regardless of nesting depth, so compensation logic that previously never ran will start running — that was a bug, not a contract.

## 0.32.0

## 0.31.1

## 0.31.0

### Minor Changes

- [#750](https://github.com/OpenSaasAU/stack/pull/750) [`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533) Thanks [@borisno2](https://github.com/borisno2)! - Add a `bulkDelete` server action for list-level bulk deletion

  `context.serverAction` now accepts `{ listKey, action: 'bulkDelete', ids }`. It
  deletes each id row-by-row through the secured context, honouring Silent failure
  (a denied or missing row returns `null` and is not counted; one row's error does
  not abort the rest), and returns `{ deleted, total }`.

  The result is deliberately a count shape rather than the single-op `{ success }`
  shape, so a UI `serverAction` wrapper that redirects on a single-item success
  (the item-form pattern) does not hijack a list-level bulk operation.

  ```ts
  const result = await context.serverAction({
    listKey: 'Post',
    action: 'bulkDelete',
    ids: ['a', 'b', 'c'],
  })
  // result: { deleted: 2, total: 3 }  // one row was denied/missing
  ```

- [#755](https://github.com/OpenSaasAU/stack/pull/755) [`9cd06dd`](https://github.com/OpenSaasAU/stack/commit/9cd06dddb45512966affc3a6b3455e97595c0de2) Thanks [@list({](https://github.com/list({)! - Admin chrome polish: opt-in nav counts and avatar label cells ([#735](https://github.com/OpenSaasAU/stack/issues/735))

  Two per-list opt-ins for the admin UI, both off by default.

  **Nav counts** — set `ui.navCount: true` on a list to show an access-scoped
  record count next to its nav item. The count is fetched through the secured
  context, so it only ever reflects what the current session may see; no count
  query runs for lists that don't opt in, and a list whose query access is
  statically denied renders no count rather than a misleading zero.

  ```typescript
  lists: {
    Post: list({
      fields: {
        /* ... */
      },
      ui: { navCount: true },
    }),
  }
  ```

  **Avatar label cells** — set `ui.avatar: true` to render a list's label column
  with a deterministic initials bubble ahead of the emphasized Item label. The
  initials and colour derive from the row; the palette is Theme-token-derived (no
  raw hex). A per-field cell override (`ui.cell`) on the label field still wins.

  ```typescript
  lists: {

      fields: {
        /* ... */
      },
      ui: { avatar: true },
    }),
  }
  ```

  New exports:

  - `@opensaas/stack-core`: `resolveNavCounts`, `isListQueryStaticallyDenied`
  - `@opensaas/stack-ui`: `Avatar` primitive, `AvatarLabelCell`, and the
    `getInitials`, `getAvatarTone`, `AVATAR_TONES` helpers. New Slots:
    `avatar`, `cell-avatar-label`, `nav-count`.

- [#759](https://github.com/OpenSaasAU/stack/pull/759) [`b190813`](https://github.com/OpenSaasAU/stack/commit/b190813a4531bd01b3206845b2c531099e0a204a) Thanks [@borisno2](https://github.com/borisno2)! - Add custom Bulk actions from list config (admin list view)

  A list can now declare list-specific Bulk actions under `ui.listView.bulkActions`. Each action's button renders in the list view's selection bar (in declaration order) alongside the built-in Delete. The action's server-side `handler` receives the selected ids and the secured context, so all its work runs through access control and hooks — a denied row is a Silent failure absorbed into the outcome, never leaked.

  ```typescript
  Post: list({
    fields: { title: text(), status: select({ options: [/* ... */] }) },
    ui: {
      listView: {
        bulkActions: [
          {
            key: 'publish',
            label: 'Publish',
            // Optional: `variant`, `destructive` (confirm first),
            // `hasAccess` (server-side visibility gate).
            handler: async ({ ids, context }) => {
              let n = 0
              for (const id of ids) {
                const updated = await context.db.post.update({
                  where: { id },
                  data: { status: 'published' },
                })
                if (updated) n++
              }
              return { message: `Published ${n} of ${ids.length}` }
            },
          },
        ],
      },
    },
  })
  ```

  Only serialisable metadata (`key`/`label`/`variant`/`destructive`) crosses to the client; the `handler`/`hasAccess` functions stay on the server. Clicking the button sends the `key` and selected ids back through the generic server action, which looks the handler up and runs it with a freshly-rebuilt secured context. Selection is enabled for a list that has custom actions even when Delete is denied. CSV export is documented as a recipe using this surface rather than shipping as a built-in.

- [#754](https://github.com/OpenSaasAU/stack/pull/754) [`f67cd79`](https://github.com/OpenSaasAU/stack/commit/f67cd798724712a90d7ada8f28202d3d6371693f) Thanks [@borisno2](https://github.com/borisno2)! - Add the Filter builder input UI for the admin list view ([#731](https://github.com/OpenSaasAU/stack/issues/731))

  The admin list view now ships a `FilterBuilder` that constructs the `?search=`
  filter query the filter engine already consumes (ADR-0017) — a free-text search
  box plus structured field / operator / value rows. Available fields, operators,
  and value suggestions are derived entirely from each field's self-contained
  `getFilterSpec` (via the serializable `collectFilterSuggestions` metadata), so
  there is no field-type `switch` and no functions cross the server/client
  boundary. Applied filters flow through the same secured `context.db`, so
  filtering can only ever narrow what a session may see.

  `@opensaas/stack-core` gains `serializeFilterQuery(tokens)` — the exact inverse
  of `parseFilterQuery` — so the builder produces the grammar the engine parses
  with the quoting and operator-prefix rules kept next to the parser.

  The `FilterBuilder` is composable (exported from `@opensaas/stack-ui` and
  `@opensaas/stack-ui/standalone`) with theme-token styling and `data-slot` parts
  for extension:

  ```tsx
  import { FilterBuilder } from '@opensaas/stack-ui/standalone'
  import { collectFilterSuggestions } from '@opensaas/stack-core'

  // Server component: collect serializable suggestion metadata for the list.
  const suggestions = collectFilterSuggestions(listConfig, 'Post', config)

  // Client: build and apply a `?search=` query.
  <FilterBuilder
    suggestions={suggestions}
    defaultValue={search}
    onApply={(query) => router.push(`/admin/post?search=${encodeURIComponent(query)}`)}
  />
  ```

  The list view wires this in automatically; existing `?search=` URLs keep
  working unchanged.

- [#746](https://github.com/OpenSaasAU/stack/pull/746) [`dcb10e2`](https://github.com/OpenSaasAU/stack/commit/dcb10e27c28a8a8f9a5e625f550ac5c750436eb6) Thanks [@borisno2](https://github.com/borisno2)! - Add the admin UI filter engine: a Filter spec field-builder contract and URL-driven server-side list filtering (ADR-0017).

  Fields now declare their filtering capability through a new optional `getFilterSpec` method — a peer of `getPrismaType`/`getTypeScriptType` on the field-builder contract. It reports the operators a field supports, a pure token→condition mapper, and serializable suggestion metadata. Core field types implement it (text contains + free text, integer/decimal/timestamp/calendarDay comparisons, select/checkbox equality against enumerated values, relationship by label lookup). A field without a spec — `password`, `json`, `virtual`, or any third-party field that hasn't adopted one — is simply not filterable, so the addition degrades gracefully everywhere.

  The admin list view now parses the URL filter query (the list's `search` param) through the engine and merges the result into the access-controlled query via the secured context, so filtering runs server-side and can only ever narrow — never widen — what a session may see. This replaces the previous hard-coded `type === 'text'` search; free-text behavior is now driven by each text field's Filter spec.

  Grammar (ADR-0017): implicit-AND tokens, quoted multi-word values, `>`/`>=`/`<`/`<=` comparisons on numeric/date fields, and bare words as free text. Unknown syntax degrades to free text, never errors.

  Multi-word free-text UX shift (intentional, per ADR-0017): bare words now combine with AND, so `hello world` requires each word to match separately (not the literal substring `hello world`). To match a contiguous phrase, quote it: `"hello world"`. A pasted URL such as `http://x` is treated as a single free-text token and searched verbatim — the `http:` prefix is not parsed as a field.

  New exports from `@opensaas/stack-core`:

  ```typescript
  import {
    parseFilterQuery, // (query) => FilterToken[]  — pure
    buildFilterWhere, // (tokens, specs) => where   — pure
    collectFilterSpecs, // (listConfig, listKey, config) => specs
    buildListFilterWhere, // (query, listConfig, listKey, config) => where
    collectFilterSuggestions, // serializable autocomplete metadata
  } from '@opensaas/stack-core'

  // e.g. "status:Published views:>10 author:\"Ada Lovelace\" beta"
  const where = buildListFilterWhere(query, listConfig, listKey, config)
  const rows = await context.db.post.findMany({ where }) // ANDed with the access filter
  ```

  Third-party field authors can implement `FilterSpec` (exported from `@opensaas/stack-core/extend`) to make their field filterable.

- [#760](https://github.com/OpenSaasAU/stack/pull/760) [`f8b6f02`](https://github.com/OpenSaasAU/stack/commit/f8b6f02c18322d0d04a7c3cc82e579d0ba9a2da9) Thanks [@borisno2](https://github.com/borisno2)! - Add inline cell editing to admin Relationship tables

  Cells in a to-many Relationship table on the item view are now editable in place.
  Click a cell to edit it, commit with Enter or blur, cancel with Escape. Each
  commit is a single-field update on the **related** row through the secured
  context, so the related list's own operation- and field-level update access plus
  its hooks/validation apply — never the parent's. The update is optimistic and
  reverts, with a visible reason, on a Silent failure (access denied / row gone) or
  a validation error (inline field errors surface too). Committed values re-render
  through the Cell registry, so select cells stay coloured badges.

  A field the session cannot write — or a table whose related-list update access is
  statically denied — renders read-only with no edit affordance; row-level
  (filter-scoped) denials surface at commit as a revert. Non-editable cells keep
  click-to-navigate; main list tables are unchanged (this is Relationship-table
  only).

  - `@opensaas/stack-core`: the generic server action gains a distinct
    `updateRelated` result shape (`{ updated, error?, fieldErrors? }`), and
    `checkFieldAccess` is exposed on `@opensaas/stack-core/internal` so the UI can
    decide the edit affordance without a parallel field-access evaluator.
  - `@opensaas/stack-ui`: `RelationshipTableClient` accepts `editableColumns`; the
    editable cell reuses the field-component registry for its editor and the Cell
    registry for its display (new Slots: `relationship-table-cell-display`,
    `relationship-table-cell-editor`, `relationship-table-cell-edit-trigger`,
    `relationship-table-cell-error`).

- [#757](https://github.com/OpenSaasAU/stack/pull/757) [`c05701e`](https://github.com/OpenSaasAU/stack/commit/c05701e523815b8f411a6d39e57bbb9317dc2a9d) Thanks [@borisno2](https://github.com/borisno2)! - Add a pre-linked create drawer to read-only Relationship tables (issue [#738](https://github.com/OpenSaasAU/stack/issues/738))

  The item view's read-only Relationship tables now offer a "+ Add" control that
  opens a drawer hosting the related list's create form, with the back-reference to
  the current record preset and hidden. On submit the new row is created through
  the secured context already linked to the parent, then the drawer closes and the
  table refreshes.

  Create-and-link semantics (ADR-0018): the create runs on the RELATED list, so
  the related list's own `create` access control, hooks, and field-level access
  apply — never the parent's. The back-reference is set on the server from the
  field/parent id (never trusted from the client payload). The "+ Add" is shown
  only when a back-reference exists to preset the link and the related list's
  `create` access is not statically denied; a filter/function-scoped denial
  surfaces at commit time as a generic error (no denied-vs-absent leak).

  New generic server action (`@opensaas/stack-core`):

  ```ts
  await context.serverAction({
    listKey: 'Post', // the RELATED list
    action: 'createRelated',
    data: { title: 'Hello', slug: 'hello' },
    field: 'author', // the back-reference field on Post
    parentId: user.id, // the record being edited
  })
  // → { created: true, id } | { created: false, error?, fieldErrors? }
  ```

  The drawer (`RelationshipCreateDrawer` from `@opensaas/stack-ui`) mounts on the
  existing `relationship-table-toolbar` seam and reuses the shared item-form engine
  and field-component registry, so the related list's full validation and required
  fields are enforced even when a required field is not one of the table's columns.

- [#756](https://github.com/OpenSaasAU/stack/pull/756) [`8199238`](https://github.com/OpenSaasAU/stack/commit/81992382290f356071955f16efd14f7771045a16) Thanks [@list({](https://github.com/list({)! - Add relationship-table row removal to the admin item view (ADR-0018)

  Each read-only Relationship table row now has a ✕ removal control. By default it
  **disconnects** the related row from the current record (non-destructive — the
  row survives and still appears on its own list), gated on the related list's
  update access. A per-relationship opt-in truly deletes the related row (behind a
  confirmation, gated on the related list's delete access), or hides the control
  entirely. Where the schema makes disconnect impossible (a required foreign key on
  the related side) the control is hidden unless delete is opted in. Removals run
  through the secured context, so an access-denied removal is a Silent failure: the
  row stays with a visible reason.

  Configure per relationship via `ui.itemView.removeAction`:

  ```typescript

    fields: {
      // Default: ✕ disconnects the post (it still exists).
      posts: relationship({ ref: 'Post.author', many: true }),
      // Opt in to destructive delete (confirmed).
      notes: relationship({
        ref: 'Note.owner',
        many: true,
        ui: { itemView: { removeAction: 'delete' } }, // 'disconnect' (default) | 'delete' | 'none'
      }),
    },
  })
  ```

  `@opensaas/stack-core` adds a `removeRelated` server action (distinct
  `{ removed }` result shape, like `bulkDelete`, so a redirect-on-success wrapper
  never hijacks an in-place removal) and the `RelationshipItemViewConfig.removeAction`
  option.

- [#745](https://github.com/OpenSaasAU/stack/pull/745) [`4d99e91`](https://github.com/OpenSaasAU/stack/commit/4d99e910b61c6196564a7248abf3d32b1d6be883) Thanks [@borisno2](https://github.com/borisno2)! - Add a Cell registry with default cells for core field types

  List tables now render every value through a **Cell** resolved by a
  cell-component registry that mirrors the form-field registry's priority chain:
  per-field override → custom type registry → field-type registry → plain-text
  fallback. Each core field type ships a default Cell — text (plain), integer
  (tabular figures), select (coloured Badge), timestamp (formatted date), checkbox
  (mark), and to-one relationship (Item label link). Unknown/third-party types
  without a registered Cell fall back to plain text.

  Select options gain optional, additive per-option UI metadata mapping a value to
  a badge variant. Existing options keep working unchanged; unmapped options render
  the neutral badge.

  ```typescript
  // opensaas.config.ts — colour a status value in list-table cells
  status: select({
    options: [
      { label: 'Draft', value: 'draft', ui: { variant: 'secondary' } },
      { label: 'Published', value: 'published', ui: { variant: 'success' } },
    ],
  })
  ```

  Register a Cell for a custom/third-party field exactly as you register its form
  component, or override a single field's Cell:

  ```typescript
  'use client'
  import { registerCellComponent } from '@opensaas/stack-ui'
  registerCellComponent('myField', MyCell)

  // or per-field override (highest priority)
  price: integer({ ui: { cell: CurrencyCell } })
  ```

- [#751](https://github.com/OpenSaasAU/stack/pull/751) [`20459b5`](https://github.com/OpenSaasAU/stack/commit/20459b5a7f8b2578342509442d36017cfa2f08f6) Thanks [@list({](https://github.com/list({)! - Derive the admin item view from the list shape, with read-only Relationship tables and a totals footer ([#734](https://github.com/OpenSaasAU/stack/issues/734))

  A record's edit page now derives its layout from the list's shape. Scalar and
  to-one fields stay in a details card (whole-form Save/Cancel, unchanged), and
  each to-many relationship renders as a read-only **Relationship table**: one
  to-many relationship gives a two-column split, none gives a single centered
  card, several stack. Table columns default to the related list's own column
  curation minus the back-reference to the parent, cells come from the cell
  registry, and a totals footer always shows the row count plus sums for any
  explicitly-configured numeric columns (each formatted by that column's Cell).
  Rows are fetched through the secured context, so only access-visible data shows.
  Rows are read-only here — a row click navigates to the related record.

  `@opensaas/stack-core` gains additive item-view config (no breaking changes):

  ```typescript
  lists: {

      fields: {
        posts: relationship({
          ref: 'Post.author',
          many: true,
          ui: {
            itemView: {
              // Override the Relationship table's columns…
              columns: ['title', 'status', 'viewCount'],
              // …and sum numeric columns in the totals footer.
              sum: ['viewCount'],
              // Or demote it back to the compact picker in the details card:
              // displayMode: 'picker',
            },
          },
        }),
      },
      // Reorder the Relationship-table sections:
      ui: { itemView: { order: ['posts'] } },
    }),
  }
  ```

  New `@opensaas/stack-ui` exports: `RelationshipTable`, `RelationshipTableClient`,
  and the pure `deriveItemViewLayout` helper (with `ItemViewLayout`,
  `ItemViewArrangement`, `RelationshipTableSection`). The Relationship table ships
  named Slots (`relationship-table`, `relationship-table-toolbar`,
  `relationship-table-row`, `relationship-table-cell`, `relationship-table-footer`)
  as extension seams for the follow-up inline-edit, create-drawer, and row-removal
  work.

- [#774](https://github.com/OpenSaasAU/stack/pull/774) [`62a1612`](https://github.com/OpenSaasAU/stack/commit/62a16127c7b6610a35fb239911eff3486de585be) Thanks [@borisno2](https://github.com/borisno2)! - Bound the admin item-view Relationship tables with a `take` and a "showing N of M" footer

  The read-only Relationship tables on a record's edit page (issue [#734](https://github.com/OpenSaasAU/stack/issues/734)) previously
  fetched every related row unbounded. They now fetch a bounded page of related rows
  and surface the full access-scoped total in the footer.

  - **Bounded fetch:** each to-many Relationship table fetches at most a default cap
    of related rows (`DEFAULT_ITEM_VIEW_TAKE`, 10), overridable per relationship via
    `ui.itemView.take`. Rows are still fetched through the secured context, so only
    access-visible rows come back.
  - **"Showing N of M" footer:** the totals footer now reads `Showing N of M rows`,
    where N is the rendered (bounded) count and M is the full access-scoped total,
    fetched via a filtered `_count` that folds the related list's own `query` access
    in (mirroring the list view's count columns). A fully-denied related list reads
    `Showing 0 of 0` and never leaks a true total. The row count is always shown,
    including the zero-column footer path.

  ```typescript
  sessions: relationship({
    ref: 'Session.user',
    many: true,
    // Cap this table at 5 rows; the footer still shows the full access-scoped total.
    ui: { itemView: { take: 5 } },
  })
  ```

  Core: `mergeIncludeWithAccessControl` now preserves a caller-supplied `take` on a
  to-many relation include (it only narrows the fetch, never widening past the access
  `where`), so the secured `findUnique`/`findMany` include can bound related-row reads.

- [#764](https://github.com/OpenSaasAU/stack/pull/764) [`c210319`](https://github.com/OpenSaasAU/stack/commit/c210319c3b25ff74d832d3c2ec5d3253d5d8b832) Thanks [@list({](https://github.com/list({)! - Admin list view: to-many relationship columns render an access-visible count, sort by relation count, and filter by numeric count comparisons (issue [#732](https://github.com/OpenSaasAU/stack/issues/732)). Virtual fields render via their Cell but are excluded from sorting and filtering.

  A to-many relationship used as a list column now shows the count of the related rows the session may see — fetched in the SAME query via a filtered Prisma `_count`, with the related list's `query` access folded into the count's `where`, so it never counts rows the session cannot read and issues no per-row query. Clicking the column header sorts by relation `_count`, and its Filter spec offers numeric comparisons on the count (`posts:>5`) in the filter builder and in shared URLs.

  Because Prisma cannot compare a relation count in a `where`, a to-many relationship's Filter spec emits a structured count marker that is resolved to an access-scoped `{ id: { in } }` before the query runs, through the secured context.

  New `@opensaas/stack-core` exports: `buildRelationshipCountSelect`, `resolveRelationshipCountFilters`, `isToManyRelationshipField`, and `RELATIONSHIP_COUNT_FILTER_KEY` (with the `RelationshipCountFilterMarker` type).

  ```ts
  // A to-many relationship column now shows an access-scoped count and is
  // sortable / filterable by that count — zero config:

    fields: {
      name: text(),
      posts: relationship({ ref: 'Post.author', many: true }),
    },
  })
  // List view: the `posts` column renders the count; its header sorts by count;
  // `posts:>5` filters by count in the builder and in a shared URL.
  ```

### Patch Changes

- [#773](https://github.com/OpenSaasAU/stack/pull/773) [`5a60291`](https://github.com/OpenSaasAU/stack/commit/5a602916f30535604b590b875c363f21930a109f) Thanks [@borisno2](https://github.com/borisno2)! - Harden `createRelated` server action: reject malformed calls that supply only one of `field`/`parentId`, and validate that the back-reference names a relationship field before injecting the parent connect.

- [#775](https://github.com/OpenSaasAU/stack/pull/775) [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e) Thanks [@borisno2](https://github.com/borisno2)! - Return a generic "Action failed" message (and log the real error server-side) when a custom bulk-action handler throws an unexpected non-Prisma error, instead of surfacing its internal message to the client

- [#771](https://github.com/OpenSaasAU/stack/pull/771) [`85c7fc3`](https://github.com/OpenSaasAU/stack/commit/85c7fc3b3a0090a986cafa0e46b1798f237264da) Thanks [@borisno2](https://github.com/borisno2)! - Harden relationship count-filter resolution: preserve any sibling conditions co-present in a `_countFilter` marker's AND-member instead of replacing it wholesale, and document why the secured count read intentionally keeps its full projection (`context.db` does not honour `select`).

- [#780](https://github.com/OpenSaasAU/stack/pull/780) [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a) Thanks [@borisno2](https://github.com/borisno2)! - Fix a to-one relationship filter token (e.g. `author:Ada`) leaking related-list data by ANDing the related list's `query` access filter into the nested condition instead of running it unscoped.

- [#794](https://github.com/OpenSaasAU/stack/pull/794) [`96e1067`](https://github.com/OpenSaasAU/stack/commit/96e1067661c7ebc8e23896086fec7428e475dd03) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-column fields (e.g. storage `image()`/`file()` in Keystone-parity mode) writing an unrecognised value silently instead of failing validation. The column split now runs after `validateFieldRules`, not before, at the top-level and nested write paths.

## 0.30.0

### Minor Changes

- [#744](https://github.com/OpenSaasAU/stack/pull/744) [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e) Thanks [@borisno2](https://github.com/borisno2)! - MCP runtime: serve plugin-registered tools, support Zod input schemas, and pass custom session fields through to access control

  - Tools registered by plugins via `registerMcpTool` (e.g. the RAG plugin's `semantic_search_*` tools) are now listed by `tools/list` and callable via `tools/call` — previously they were stored but never served.
  - Custom tool `inputSchema` may now be a Zod schema or a plain JSON Schema object. Zod schemas are converted to JSON Schema for `tools/list` and validated on `tools/call` (invalid input returns a JSON-RPC `-32602` error):

  ```typescript
  mcp: {
    customTools: [
      {
        name: 'publish_post',
        description: 'Publish a draft post',
        inputSchema: z.object({ id: z.string() }),
        handler: async ({ input, context }) => {
          return context.db.post.update({
            where: { id: input.id },
            data: { status: 'published' },
          })
        },
      },
    ]
  }
  ```

  - MCP sessions now pass custom fields through to access control. Transport fields (`accessToken`, `expiresAt`, `scopes`) are stripped; everything else — `userId` plus any fields your session provider attaches (email, role, ...) — reaches `context.session`, so session-based access rules behave consistently over MCP.

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

## 0.29.0

### Minor Changes

- [#725](https://github.com/OpenSaasAU/stack/pull/725) [`f51cef8`](https://github.com/OpenSaasAU/stack/commit/f51cef876d6376e4e2bc8ac990229ff60e232bb1) Thanks [@borisno2](https://github.com/borisno2)! - Wire field help text through the admin renderer via `ui.description`

  Field authors can now set help/description text on a field's `ui.description`
  and have it render beneath the control in the prebuilt admin UI. `FieldRenderer`
  surfaces `ui.description` to the rendered field component as its `helpText` prop,
  which displays through the shared field-shell `FieldHelp` (data-slot="field-help").
  Previously `helpText` only worked when a field component was composed by hand.

  ```typescript
  fields: {
    slug: text({
      ui: { description: 'URL-friendly identifier, lowercase only.' },
    }),
  }
  ```

  The option is optional and non-breaking; fields without a description render no
  help text, exactly as before.

- [#713](https://github.com/OpenSaasAU/stack/pull/713) [`56e9f9b`](https://github.com/OpenSaasAU/stack/commit/56e9f9b0a4d1920662cf0564682e767993917b56) Thanks [@borisno2](https://github.com/borisno2)! - Add the theming token contract and a pure `ui.theme` compiler, proven end-to-end through Button.

  The UI package stylesheet now defines the full Theme token vocabulary as a single, un-driftable contract: the shadcn color set plus `success`/`warning` (with foregrounds) and a `gradientFrom`/`gradientTo` pair, `--font-sans`/`--font-mono`/`--font-heading` (heading defaults to sans), a single `--radius` knob with derived sm/md/lg sizes, and `--shadow-sm`/`--shadow-md`/`--shadow-lg` — all with light and dark values side by side via `light-dark()`.

  `ThemeConfig` is a clean break (ADR-0015). Colors accept any valid CSS color string and are emitted verbatim — the compiler never parses colors. Bare HSL triplets (`'220 20% 97%'`) are no longer accepted and fire a dev-mode warning suggesting an `hsl()` wrap.

  ```typescript
  ui: {
    theme: {
      preset: 'modern', // 'modern' | 'classic' | 'neon'
      colors: { primary: '#16a34a' }, // hex, oklch(...), rgb(...), hsl(...)
      darkColors: { primary: '#4ade80' },
      fonts: { sans: 'var(--font-inter), system-ui, sans-serif' }, // compose with next/font
      radius: 0.5, // rem
      shadows: { sm: 'none', md: 'none', lg: 'none' }, // flat theme
    },
  }
  ```

  The config layer compiles onto the same CSS custom properties the stylesheet declares, so the two can never drift. `Button` is restyled to consume only these tokens (color, radius, shadow, font) and carries a stable `data-slot="button"`.

  Migration: wrap any old bare-triplet color value in `hsl()` (`'220 20% 97%'` → `'hsl(220 20% 97%)'`). Preset-only configs need no changes.

## 0.28.0

### Minor Changes

- [#696](https://github.com/OpenSaasAU/stack/pull/696) [`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e) Thanks [@borisno2](https://github.com/borisno2)! - `Plugin['runtime']` now receives a `sudo` helper as a second argument — `runtime(context, sudo)` — mirroring `StackContext.sudo()` one layer lower. Call `sudo().db` for reads/writes that must bypass access control but still run hooks, for example a plugin's identity lookup that shouldn't depend on the caller's own list access policy. `sudo` is a plain function argument, not a method on `context` (`AccessContext`) itself.

### Patch Changes

- [#690](https://github.com/OpenSaasAU/stack/pull/690) [`aec907f`](https://github.com/OpenSaasAU/stack/commit/aec907f29b31ca507831d729182938975ec4b4fa) Thanks [@borisno2](https://github.com/borisno2)! - Fix relationship live-search 500 when the target list's label field is a virtual field by ordering by `id` instead of the non-orderable virtual column

- [#695](https://github.com/OpenSaasAU/stack/pull/695) [`fd64913`](https://github.com/OpenSaasAU/stack/commit/fd64913ac65ed60440eaee210a34a6f8e3824c21) Thanks [@borisno2](https://github.com/borisno2)! - Fix a plugin's `extendList()` silently overwriting a pre-existing list's operation-level access. Per ADR-0013, an extension that carries `access.operation` for an existing list now throws a config-time error naming the plugin and the list; the auth plugin no longer forwards its own access when extending a list an app already declared.

## 0.27.1

### Patch Changes

- [#674](https://github.com/OpenSaasAU/stack/pull/674) [`1bd4f12`](https://github.com/OpenSaasAU/stack/commit/1bd4f1258f9b3ac77ca048ac657ee31b0299821f) Thanks [@borisno2](https://github.com/borisno2)! - Fix stack overflow when auto-including relationships on a cyclic readable-relationship graph. The auto-include now stops at cycle back-edges (a relation that closes a cycle is fetched flat) instead of re-descending to MAX_DEPTH.

## 0.27.0

### Minor Changes

- [#635](https://github.com/OpenSaasAU/stack/pull/635) [`18c39c8`](https://github.com/OpenSaasAU/stack/commit/18c39c8b8ffc0b0c5c4551385bb67054448e5781) Thanks [@borisno2](https://github.com/borisno2)! - Add a label seam for the admin UI: `getLabelFieldName(listConfig)` resolves the field that represents a list's rows as a single label (`ui.labelField` → `name` → `title` → `id`), and `getItemLabel(listConfig, item)` reads that field off a row, falling back to `id` when it's missing. Both are exported from the root entry point.

  ```typescript
  import { getLabelFieldName, getItemLabel } from '@opensaas/stack-core'

  Post: list({
    fields: { title: text() },
    ui: { labelField: 'title' },
  })

  getLabelFieldName(listConfig) // 'title'
  getItemLabel(listConfig, item) // item.title, or item.id if title is missing
  ```

- [#636](https://github.com/OpenSaasAU/stack/pull/636) [`a15e566`](https://github.com/OpenSaasAU/stack/commit/a15e5660d736c8ea2d4b804c5ef6891510b2ea3d) Thanks [@borisno2](https://github.com/borisno2)! - Add a relationship-options read primitive: `getRelationshipOptions(context, config, relatedListKey, { search?, take?, selectedIds? })` returns a bounded, projected `{ id, label }[]` for relationship editors. It selects only `id` and the resolved label field (via `getLabelFieldName`), so no depth-5 auto-include ever runs; `search` filters via `contains` when the label field is text; results are ordered by the label field; and currently-selected `selectedIds` are always unioned into the result even when outside the `search`/`take` window. Operation-level `query` access on the related list still applies (denied → `[]`).

  Also adds a `relationshipOptions` op on `context.serverAction` so hosts can resolve options from a client without a bespoke endpoint:

  ```typescript
  await context.serverAction({
    listKey: 'Post',
    action: 'relationshipOptions',
    field: 'author',
    search: 'ada',
    take: 20,
    selectedIds: ['user-123'],
  })
  // => { success: true, data: [{ id: 'user-123', label: 'Ada Lovelace' }, ...] }
  ```

  `getRelationshipOptions` is exported from `@opensaas/stack-core` and re-exported from `@opensaas/stack-ui` for server components that already hold a context.

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

- [#633](https://github.com/OpenSaasAU/stack/pull/633) [`9d9c7f8`](https://github.com/OpenSaasAU/stack/commit/9d9c7f8e5afd0b4afb01dc40cb16217f8d675354) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields named in `include`/`select` throwing a Prisma "Unknown field" error. Virtual field keys are now stripped from the query payload while their value is still computed via `resolveOutput`.

- [#637](https://github.com/OpenSaasAU/stack/pull/637) [`002e755`](https://github.com/OpenSaasAU/stack/commit/002e755ca405c23127b3c88378955127cc8b3f67) Thanks [@borisno2](https://github.com/borisno2)! - Fix `calendarDay` writes 500ing on Prisma 7 `@db.Date` columns — a `resolveInput` hook now coerces a `YYYY-MM-DD` string to a UTC-midnight `Date` before validation, and the field's zod schema accepts either shape.

## 0.26.0

### Minor Changes

- [#616](https://github.com/OpenSaasAU/stack/pull/616) [`322d5b6`](https://github.com/OpenSaasAU/stack/commit/322d5b64d11c3e3401493511e0c0e3a1fa20e210) Thanks [@borisno2](https://github.com/borisno2)! - Add `context.transaction()` — an interactive, hook-firing transaction

  You can now run multiple access-checked `context.db.*` operations atomically in one transaction while preserving the access/hook boundary (unlike raw `prisma.$transaction`, which bypasses both). The callback receives a full context whose `db.*` operations enforce access control and run list/field hooks, but persist against a single interactive transaction — so a throw anywhere rolls the whole transaction back.

  Options (notably `isolationLevel`, plus `maxWait`/`timeout`) pass through to Prisma, and serialization failures (Prisma `P2034`) propagate to the caller so you own the retry loop. This makes concurrency-sensitive invariants such as a capacity gate enforceable:

  ```typescript
  async function bookSlot(context, slotId) {
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
        // Serialization failures propagate — retry is caller-owned.
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2034') continue
        throw err
      }
    }
    throw new Error('exceeded retry budget')
  }
  ```

  Nested `context.db` writes inside the callback join the outer transaction. New `StackContext`, `TransactionOptions`, and `TransactionIsolationLevel` types are exported from `@opensaas/stack-core`. See ADR-0012.

### Patch Changes

- [#620](https://github.com/OpenSaasAU/stack/pull/620) [`0be254e`](https://github.com/OpenSaasAU/stack/commit/0be254e2b2e6bbc0c2f168438aea49d2e1cc7f0b) Thanks [@borisno2](https://github.com/borisno2)! - Apply a field's defaultValue to omitted inputs before create validation (resolve-then-validate, matching Keystone), so isRequired + defaultValue no longer fails on create.

  Note: because an omitted-but-defaulted field is now filled into `resolvedData` before validation, that field's create-side field-level `beforeOperation`/`afterOperation` hooks (gated on the field key being present in `resolvedData`) now fire for defaulted fields where they previously would not.

## 0.25.0

### Minor Changes

- [#602](https://github.com/OpenSaasAU/stack/pull/602) [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9) Thanks [@borisno2](https://github.com/borisno2)! - Make `calendarDay` a `YYYY-MM-DD` string end-to-end (Keystone's CalendarDay scalar)

  `calendarDay` is now a `YYYY-MM-DD` **string** at the `context.db` boundary in
  both directions, so its type, validation, and runtime value finally agree.
  Previously the field validated a `YYYY-MM-DD` string but its TypeScript type was
  `Date`, so a typed caller passing `new Date(...)` hit a runtime `ValidationError`.
  - The field/read type and the generated `CreateInput`/`UpdateInput` input types
    are now `string`.
  - Writes accept only a `YYYY-MM-DD` string; a malformed string or a `Date` is
    rejected at runtime by validation (a `ValidationError`).
  - Storage is unchanged: `DateTime @db.Date` on Postgres/MySQL, the SQLite TEXT
    fallback as before.

  **Behavioral change (reads):** reading a `calendarDay` now returns a
  `YYYY-MM-DD` string instead of a `Date`. A field `resolveOutput` transform
  normalises the value Prisma returns from the `@db.Date` column, using UTC
  components to avoid timezone off-by-one. Consumers that previously relied on a
  `Date` on read should update to the string form:

  ```typescript
  const event = await context.db.event.findUnique({ where: { id } })
  event?.startDate // => '2025-01-15' (string, not Date)

  // Writes: pass YYYY-MM-DD strings, not Date objects
  await context.db.event.create({ data: { startDate: '2025-01-15' } })
  ```

- [#593](https://github.com/OpenSaasAU/stack/pull/593) [`fadd9db`](https://github.com/OpenSaasAU/stack/commit/fadd9dbd17085f4dd15899371a054ec46f943ce4) Thanks [@{](https://github.com/{)! - Nested relation writes now run the full hook pipeline inside one transaction ([#569](https://github.com/OpenSaasAU/stack/issues/569))

  A record written via a nested `create`, `update`, or `delete` now fires the SAME
  list- and field-level `beforeOperation`/`afterOperation` hooks as the equivalent
  top-level write — so side effects (workflows, notifications, billing) are
  identical whether a record is written nested or top-level. Previously nested
  writes ran only `resolveInput`/`validate`/field-rules and silently skipped the
  before/after side-effect hooks.
  - Nested **create** runs `beforeOperation` (create) → persist → `afterOperation`
    receiving the created `item`.
  - Nested **update** runs `afterOperation` receiving both `originalItem` (the row
    before) and the updated `item`.
  - Nested **delete** runs `beforeOperation`/`afterOperation` receiving the
    `originalItem`.

  Existing access control, validation, silent-failure, sudo-bypass, and the [#578](https://github.com/OpenSaasAU/stack/issues/578)
  nested-`connect`/`connectOrCreate` read-access + DB-reachability behavior are
  unchanged. Pass-through nested kinds (`disconnect`/`set`/`updateMany`/
  `deleteMany`) are out of scope and behave as before. See ADR-0010.

  For to-many nested creates (`create: [{A},{B}]`), each created record's
  `afterOperation` now fires exactly once against its OWN distinct row, recovered
  by id-diff against the rows that existed before the write — so a pre-existing
  sibling is never passed as the "created" item, and multiple creates no longer
  collapse to a single row.

  BEHAVIOR CHANGE — every write is now transactional, and a throwing
  `beforeOperation`/`afterOperation` (or validation) rolls the whole write back.
  The entire operation (parent + all nested writes) now runs inside one
  `prisma.$transaction`, so it is atomic. Previously an `afterOperation` that threw
  left the row committed; now it rolls back with the transaction (more
  Keystone-correct). If you relied on a thrown `afterOperation` leaving the row
  persisted, move that work to run after the write returns.

  Inside a `beforeOperation`/`afterOperation` hook, `context.db` (and
  `context.prisma`) are now bound to the write's transaction, so any `context.db`
  write a hook performs participates in — and rolls back with — the same
  transaction. Externally-visible side effects that must survive a rollback should
  not use `context.db` from within these hooks (transaction-boundary hooks for
  that are deferred — see [#590](https://github.com/OpenSaasAU/stack/issues/590)).

  ```ts
  // Nested create now fires the related list's beforeOperation/afterOperation,
  // atomically with the parent — a throw anywhere rolls the whole write back.
  await context.db.post.update({
    where: { id },
    data: {
      title: 'Updated',
   create: { name: 'New Author' } }, // User hooks fire; atomic
    },
  })
  ```

- [#594](https://github.com/OpenSaasAU/stack/pull/594) [`4f0d407`](https://github.com/OpenSaasAU/stack/commit/4f0d40721feff1a3109647a81fcbe47db5970026) Thanks [@borisno2](https://github.com/borisno2)! - Add an opt-in **Node build** of the generated `.opensaas/` bundle (ADR-0011, [#579](https://github.com/OpenSaasAU/stack/issues/579)).

  Setting `output: { buildTarget: 'node' }` in `opensaas.config.ts` makes `opensaas generate` additionally compile the bundle to a plain-Node-loadable ESM form under `.opensaas/dist/` — `.js` + `.d.ts` with a `{"type":"module"}` marker — alongside the default `.ts` bundler form. The compiled entry is `.opensaas/dist/context.js`, with the Prisma client subtree at `.opensaas/dist/prisma-client/**` and the project config compiled in as a sibling, so a live module (e.g. better-auth's Prisma adapter) can be imported in a bundler-less runtime — plain Node, a Playwright e2e helper, or a build-time script — that the default `.ts` form cannot execute.

  The Node build is purely additive: with `output.buildTarget` absent (the default), generation behaves exactly as before and no `.opensaas/dist/` is emitted.

  ```typescript
  // opensaas.config.ts
  export default config({
    output: { buildTarget: 'node' },
    // ...
  })

  // then, from a plain-Node consumer (no bundler, no tsx):
  import { createAuth } from '@opensaas/stack-auth/server'
  import { config, rawOpensaasContext } from './.opensaas/dist/context.js'

  const auth = createAuth(config, rawOpensaasContext)
  await auth.api.signUpEmail({ body: { email, password, name } })
  ```

  The compile runs via the TypeScript compiler API with `rewriteRelativeImportExtensions` (turning the bundle's `.ts`-extension imports into runnable `.js` specifiers), `declaration`, `skipLibCheck`, and `noEmitOnError: false`, so it reuses the bundle's type-clean guarantee without adding a build dependency. `'node'` is the only `buildTarget` today; the field is a string-literal union so future compiled targets can be added without a breaking change.

- [#592](https://github.com/OpenSaasAU/stack/pull/592) [`e355c05`](https://github.com/OpenSaasAU/stack/commit/e355c05a0787980b997609c4571271ab5c250f36) Thanks [@borisno2](https://github.com/borisno2)! - Make the generated `.opensaas/prisma-client` subtree statically resolvable by default and add a `db.prismaGeneratorOptions` passthrough.

  The generated `generator client { ... }` block now emits `importFileExtension = "ts"` and `moduleFormat = "esm"` by default, so the prisma-client subtree uses explicit `.ts` import extensions and matches the extension style the rest of the `.opensaas` bundle already uses — the whole import graph is statically resolvable by a bundler out of the box, no post-generation surgery required.

  A new optional `db.prismaGeneratorOptions` lets you override these values when you need a different module/extension story (e.g. emitting `.js` extensions for a plain-Node consumer). Any value you supply wins; omitted keys fall back to the `ts`/`esm` defaults. The existing `previewFeatures = ["multiSchema"]` emission (when `db.schemas` is set) is preserved and coexists with the new options.

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      prismaGeneratorOptions: {
        importFileExtension: 'js',
        moduleFormat: 'commonjs',
      },
      // ... rest of config
    },
    // ...
  })
  ```

- [#600](https://github.com/OpenSaasAU/stack/pull/600) [`a93cebb`](https://github.com/OpenSaasAU/stack/commit/a93cebb5a6ba6550d8cdbb94f010c902ad7e29f1) Thanks [@relationship({](https://github.com/relationship({)! - Gate nested `connect` by the owning relationship field's field-level access

  Nested `connect` (and the connect branch of `connectOrCreate`) is now gated by
  the owning relationship field's create/update field-level access, in addition to
  the target list's read/query access and DB-reachability check. This completes
  the Keystone-parity rule that a connect requires both read access on the target
  AND write access on the owning relationship field. `sudo` bypasses the check.

  ```typescript
  Post: list({
    fields: {
      // A non-sudo caller can only connect an author when this field's
      // update access permits it (and the target User is readable/reachable).

        ref: 'User.posts',
        access: { update: ({ session }) => session?.role === 'editor' },
      }),
    },
  })
  ```

- [#584](https://github.com/OpenSaasAU/stack/pull/584) [`b17ec45`](https://github.com/OpenSaasAU/stack/commit/b17ec45127fe55f02437892e9fd389c67373635a) Thanks [@borisno2](https://github.com/borisno2)! - Add `findFirst` to access-controlled `context.db.<list>` delegates

  `findFirst` is sugar over the existing access-filtered `findMany` (`take: 1`), so
  it introduces no new access surface: it applies the exact same query-access checks
  and access-controlled include building as `findMany`, then returns the first
  matching row or `null`. It honours the read-side silent-failure contract — an
  access-denied query yields `null` rather than throwing.

  ```ts
  // Non-unique single-row lookup
  const account = await context.db.account.findFirst({
    where: { userId: '123' },
    orderBy: { createdAt: 'desc' },
  })

  // Narrow the single result with a query fragment
  const post = await context.db.post.findFirst({
    where: { published: true },
    query: postFragment,
  })
  // post: ResultOf<typeof postFragment> | null
  ```

  The CLI type generator now emits a `findFirst` method (and `<List>FindFirstArgs`
  type) for each list in the generated `.opensaas/types.ts`, so migrated apps that
  reach for the familiar Prisma `findFirst` pattern get full type support.

- [#601](https://github.com/OpenSaasAU/stack/pull/601) [`8f98e25`](https://github.com/OpenSaasAU/stack/commit/8f98e25fbef4ec0fc3ff0cba456ff7f2f7ba2ea8) Thanks [@borisno2](https://github.com/borisno2)! - Add `beforeTransaction` / `afterTransaction` transaction-boundary hooks (list- and field-level)

  These run OUTSIDE the write's database transaction (in addition to the in-transaction `beforeOperation`/`afterOperation`), for non-transactional side effects like external API calls that must not hold a transaction open and cannot be rolled back. They fire per `(list, operation)` involved in the write (the top-level list plus each nested create/update/delete list) and form a symmetric compensation bracket: `afterTransaction` always runs when its paired `beforeTransaction` ran, receiving the outcome (`status: 'committed' | 'rolled-back'` plus `error` on rollback). On commit it gets the persisted `item` (and `originalItem` for update/delete) **only for the top-level record** — for nested lists these are `undefined`, since the per-record persisted row is not recoverable outside the transaction; use the in-transaction `afterOperation` for per-record nested compensation. On rollback it gets no `item` so it can undo what `beforeTransaction` did. `connectOrCreate` is enumerated as a best-effort create involvement (a resolve-to-connect still fires the bracket with no write), so compensators should be idempotent.

  ```typescript
  list({
    fields: { name: text() },
    hooks: {
      // Runs before the transaction opens.
      beforeTransaction: async ({ operation, inputData }) => {
        await billing.reserveSeat(inputData.seatId)
      },
      // Always runs after the transaction settles.
      afterTransaction: async (args) => {
        if (args.status === 'rolled-back') {
          // The write did not persist (args.error explains why) — compensate.
          await billing.releaseSeat(args.inputData.seatId)
        } else {
          await billing.confirmSeat(args.item.seatId)
        }
      },
    },
  })
  ```

  A throwing `beforeTransaction` aborts the write (the transaction never opens) and fires `afterTransaction` (`rolled-back`) only for lists whose `beforeTransaction` already ran. A throwing `afterTransaction` does not stop the other compensators; errors are surfaced afterward. Sudo does not affect these hooks. This is an additive, non-Keystone extension and does not change the existing `beforeOperation`/`afterOperation` semantics.

### Patch Changes

- [#603](https://github.com/OpenSaasAU/stack/pull/603) [`be9a896`](https://github.com/OpenSaasAU/stack/commit/be9a8965ad6338c279e99cfe3bf24162e63ffb92) Thanks [@borisno2](https://github.com/borisno2)! - Enforce required json fields on create: an omitted key is now rejected while any
  present value (object, array, primitive, or null) is still accepted.

- [#583](https://github.com/OpenSaasAU/stack/pull/583) [`e39d6e9`](https://github.com/OpenSaasAU/stack/commit/e39d6e9e37be2337c8cf1979053e76877f14296c) Thanks [@borisno2](https://github.com/borisno2)! - Make non-sudo writes fail loud in `filterWritableFields` (Keystone parity).

  Undeclared `data` keys on create/update now throw instead of passing through unchecked ([#564](https://github.com/OpenSaasAU/stack/issues/564)), and fields denied by field-level access now throw instead of being silently stripped ([#568](https://github.com/OpenSaasAU/stack/issues/568)). `sudo` remains the single trusted bypass; system fields and relationship foreign keys still pass through. Raw multi-column split columns (e.g. `media_url`/`media_size` from an `image()`/`file()` field) are now gated by their owning field's write access — supplying them directly under non-sudo when that field denies the write throws, instead of bypassing the field's `access.create`/`access.update`.

  Behavioural narrowing: a list-level `resolveInput` hook that adds keys to `resolvedData` which are not declared fields will now be rejected by the undeclared-key throw. No production hook does this today.

- [#605](https://github.com/OpenSaasAU/stack/pull/605) [`ca4973b`](https://github.com/OpenSaasAU/stack/commit/ca4973b504eadb123d179e8f4d16d6ec8c9f8fc1) Thanks [@borisno2](https://github.com/borisno2)! - Required json fields now reject a present `null` during validation rather than failing later as a DB NOT NULL violation. Omitted keys on update are still allowed; the Prisma column nullability is unchanged.

- [#602](https://github.com/OpenSaasAU/stack/pull/602) [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9) Thanks [@borisno2](https://github.com/borisno2)! - Fix update validation rejecting omitted required fields under zod 4.4 by using key-optionality (`.optional()`) instead of `z.union([schema, z.undefined()])`. Partial updates that omit a required-on-create field now validate; present values still enforce their rules.

- [#587](https://github.com/OpenSaasAU/stack/pull/587) [`ecbf834`](https://github.com/OpenSaasAU/stack/commit/ecbf834059a072c428b0739d6ebcf4c74be8c893) Thanks [@borisno2](https://github.com/borisno2)! - Fix false denial of nested `connect` (and `connectOrCreate`'s connect branch): connect now requires read/query access on the target and evaluates filter results via DB reachability (`findFirst({ where: { AND: [connection, accessFilter] } })`), so nested-relation and `AND`/`OR`/`some`/`none`/`not` filters no longer always fail.

- [#589](https://github.com/OpenSaasAU/stack/pull/589) [`481d6e0`](https://github.com/OpenSaasAU/stack/commit/481d6e00be90b1159b0b30eff015e5079c840158) Thanks [@borisno2](https://github.com/borisno2)! - Fix row-level access bypass when an explicit `include` is passed to non-sudo `findUnique`/`findMany`. The caller's `include` is now merged with (not replaced by) the access-controlled include: denied relations are dropped, each relation's access `where` is AND-combined with any caller nested `where`, and nested includes are filtered at every level. Sudo and query-fragment paths are unchanged. When no access-controlled include is computed (inside a `resolveOutput`/virtual-field context, at max include depth, or for a list with no relationships), the caller's `include` is passed through unchanged rather than dropped — avoiding fail-closed data loss.

- [#586](https://github.com/OpenSaasAU/stack/pull/586) [`4622b5f`](https://github.com/OpenSaasAU/stack/commit/4622b5fa8fc731e2c8995011f1be0cfe341578da) Thanks [@borisno2](https://github.com/borisno2)! - Enforce unique-`where` for `context.db.<list>.findUnique` — a non-unique `where` now throws a clear error instead of silently returning a nondeterministic row. Use `findFirst` for non-unique single-row lookups.

## 0.24.0

### Minor Changes

- [#552](https://github.com/OpenSaasAU/stack/pull/552) [`66496b4`](https://github.com/OpenSaasAU/stack/commit/66496b487bae61f3cdea26fcfcaf605caaaa5520) Thanks [@borisno2](https://github.com/borisno2)! - Add list-level `ui.listView` config (mirroring Keystone) for default columns and sort

  Lists now support a `ui.listView` block in `opensaas.config.ts` that sets the
  admin list table's default column selection/order and default sort. Naming
  mirrors Keystone's `ui.listView` so migrators can map defaults directly.

  ```typescript
  lists: {
    Post: list({
      fields: {
        title: text(),
        status: text(),
        createdAt: timestamp(),
      },
      ui: {
        listView: {
          // Column selection AND order
          initialColumns: ['title', 'status'],
          // Default sort
          initialSort: { field: 'createdAt', direction: 'desc' },
        },
      },
    }),
  }
  ```

  When `ui.listView` is absent, behaviour is unchanged: the table shows all
  non-system fields and applies no default sort.

## 0.23.0

### Patch Changes

- [#535](https://github.com/OpenSaasAU/stack/pull/535) [`da4ba52`](https://github.com/OpenSaasAU/stack/commit/da4ba529161e2c8702e4c62ae1594e300f32cbb1) Thanks [@borisno2](https://github.com/borisno2)! - context.db findUnique/findMany now warn (once per list+op) when passed an ignored `select` — narrow reads via `include` or a fragment `query`.

## 0.22.0

### Minor Changes

- [#497](https://github.com/OpenSaasAU/stack/pull/497) [`be4181a`](https://github.com/OpenSaasAU/stack/commit/be4181ada3f2d6386052df4d4869ad150d360f89) Thanks [@{](https://github.com/{)! - Derive the auth plugin's Auth lists from the better-auth config

  `authPlugin` now mirrors the better-auth config a developer writes instead of hardcoding the keys `User`/`Session`/`Account`/`Verification`. Per-model `modelName` becomes the OpenSaaS list key (and a table `@@map`), and the `fields` column map becomes per-field `@map`s. The plugin only ever adds/extends its own derived keys, so an app's separate domain `User` is never overwritten. The runtime `getUser`/`getCurrentUser` helpers now resolve the user list key from the configured user model instead of a hardcoded `'user'`.

  Default behaviour (no overrides) is unchanged: the lists are still keyed `User`/`Session`/`Account`/`Verification` with the original field shapes and no `@@map`.

  ```typescript
  // Adopt existing better-auth tables without a destructive migration
  authPlugin({
   modelName: 'AuthUser', fields: { name: 'full_name' } },
    session: { modelName: 'AuthSession', fields: { userId: 'user_id' } },
    account: { modelName: 'AuthAccount' },
    verification: { modelName: 'AuthVerification' },
  })
  // -> lists keyed AuthUser/AuthSession/AuthAccount/AuthVerification
  //    with @@map + column @map matching the live tables
  ```

  Lists also gain a model-level `db.map` option, which emits a `@@map("...")` on the generated Prisma model so a list key can differ from its physical table name.

- [#498](https://github.com/OpenSaasAU/stack/pull/498) [`dc51f23`](https://github.com/OpenSaasAU/stack/commit/dc51f237323ee53a705c4b9831dd8db85efd9bc1) Thanks [@borisno2](https://github.com/borisno2)! - Add an `output` config block so `opensaas generate` can relocate the generated Prisma schema and `.opensaas` bundle (e.g. to coexist with an existing Keystone `prisma/` during migration)

  Set `output.prismaSchema` and/or `output.opensaasDir` in `opensaas.config.ts` to move where the generator writes. Defaults are unchanged (`prisma/schema.prisma`, `.opensaas/`) when the block is omitted. The generated files' cross-references follow the configured locations: `context.ts`/`prisma-extensions.ts` import `opensaas.config` from the resolved bundle, the Prisma client `generator { output }` points back at the relocated bundle, and the top-level `prisma.config.ts` references the configured schema directory so `prisma` CLI commands keep working.

  The pre-existing top-level `opensaasPath` option is preserved: the effective `.opensaas` bundle directory resolves as `output.opensaasDir` > `opensaasPath` > the default `.opensaas`. Setting `opensaasPath` alone still relocates the bundle through the CLI exactly as before; `output.opensaasDir` overrides it when both are set.

  ```typescript
  export default config({
    output: {
      prismaSchema: 'prisma-opensaas/schema.prisma',
      opensaasDir: 'generated/opensaas',
    },
    db: {/* ... */},
    lists: {/* ... */},
  })
  ```

- [#511](https://github.com/OpenSaasAU/stack/pull/511) [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c) Thanks [@borisno2](https://github.com/borisno2)! - Add non-destructive multi-column mode to `image()` / `file()` for adopting an existing Keystone database without dropping columns (ADR-0006).

  Keystone stores an image across seven per-part columns (`_url`, `_width`, `_height`, `_filesize`, `_contentType`, `_contentDisposition`, `_pathname`) and a file across three (`_filename`, `_filesize`, `_url`). By default `image()`/`file()` still back a single `Json?` column (greenfield unchanged). Set `db.columns: 'keystone'` to map the field onto the existing per-part columns in place — assembled into an `ImageMetadata`/`FileMetadata` on read and split back on write — so a migrating project reaches a clean schema diff with no data migration and no re-upload of existing assets.

  ```typescript
  import { image, file } from '@opensaas/stack-storage/fields'

  fields: {
    // Maps onto image_url, image_width, … image_pathname in place.
    avatar: image({ storage: 'images', db: { columns: 'keystone' } }),

    // Per-part @map names are configurable for non-default column names.
    cover: image({
      storage: 'images',
      db: { columns: { mode: 'keystone', map: { url: 'cover_link' } } },
    }),

    resume: file({ storage: 'documents', db: { columns: 'keystone' } }),
  }
  ```

  No-re-upload guarantee (both modes): an already-shaped metadata value — or, in multi-column mode, populated columns — is authoritative and never triggers a storage upload; only a `File`-like input uploads.

  Adds a multi-column field-emission contract (`getPrismaColumns`) plus `getColumnNames`/`assembleColumns`/`splitColumns` to the field-authoring surface so any field can map onto several physical columns. The generator emits one `@map`-ped Prisma line per column; reads assemble the logical value from the raw columns and strip them from the result; writes split the logical value back across the columns.

- [#499](https://github.com/OpenSaasAU/stack/pull/499) [`f9e0505`](https://github.com/OpenSaasAU/stack/commit/f9e05053c75c76781751d5d9e5d1ed5cd9be635f) Thanks [@borisno2](https://github.com/borisno2)! - Add opt-in `db.keystoneCompat` mode for Keystone-compatible empty-string text defaults

  When migrating from Keystone 6, every non-null text column carries an implicit empty-string default. Set `db: { keystoneCompat: true }` to mirror that: any non-null `text()` column without an explicit `defaultValue` now generates `String @default("")`, so a migrating schema reaches parity without hand-setting `defaultValue: ''` on dozens of columns.

  The mode is off by default (greenfield schemas stay clean) and never affects nullable text, fields with an explicit `defaultValue`, or any non-text field — an explicit `text({ defaultValue: 'x' })` always wins.

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      keystoneCompat: true, // non-null text without a default → @default("")
      prismaClientConstructor: (PrismaClient) => {
        // ... adapter setup
      },
    },
    lists: {
      Account: list({
        fields: {
          // required text → String @default("")
          name: text({ validation: { isRequired: true } }),
          // explicit default still wins → String @default("PLEASE_UPDATE")
          status: text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' }),
          // nullable text is untouched → String?
          bio: text(),
        },
      }),
    },
  })
  ```

  See ADR-0004 for the full Keystone-compatible generator defaults.

- [#501](https://github.com/OpenSaasAU/stack/pull/501) [`e30f6a1`](https://github.com/OpenSaasAU/stack/commit/e30f6a1ef69dc65ae68b37539fa74c3f97823cfd) Thanks [@borisno2](https://github.com/borisno2)! - Auto-timestamps are now OFF by default; opt in with `db.timestamps`

  The generator no longer appends `createdAt`/`updatedAt` to every model. This matches
  Keystone 6 (which never adds them automatically) and keeps Keystone → stack migrations
  non-destructive. A list opts in either by declaring the fields itself or by enabling the
  new `db.timestamps` flag. See ADR-0004.

  Note: this changes a long-standing default. Existing apps that relied on auto-injected
  timestamps should set `db: { timestamps: true }` to keep them.

  Enable globally:

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      timestamps: true, // re-enable auto createdAt/updatedAt for all lists
      // ...
    },
    lists: {/* ... */},
  })
  ```

  Override per list (takes precedence over the global setting):

  ```typescript
  lists: {
    // Opt this one list out even though timestamps are on globally
    Production: list({
      fields: { name: text() },
      db: { timestamps: false },
    }),
    // Opt this one list in even though the global default is off
    Audited: list({
      fields: { name: text() },
      db: { timestamps: true },
    }),
  }
  ```

  When timestamps are enabled and a list already declares its own `createdAt`/`updatedAt`
  field, the auto column is skipped for the declared field(s) so Prisma never sees a
  duplicate (`P1012`):

  ```typescript
  lists: {
    Post: list({
      fields: {
        title: text(),
        createdAt: timestamp(), // kept as declared; no duplicate auto column
      },
    }),
  }
  ```

  The decision is exposed as a pure, testable predicate `resolveListTimestamps(listConfig, dbConfig)`
  from `@opensaas/stack-cli`, and `DatabaseConfig` is now re-exported from `@opensaas/stack-core`.

- [#503](https://github.com/OpenSaasAU/stack/pull/503) [`f471e3c`](https://github.com/OpenSaasAU/stack/commit/f471e3c95eee2254ac9fde04adc8c5693240e293) Thanks [@borisno2](https://github.com/borisno2)! - Add `select()` db options for Keystone schema parity: `db.isNullable` and `db.enumName`.

  `db.isNullable: true` forces the nullable `?` on the generated column even when a
  `defaultValue` is present. The default behaviour is unchanged — a select with a
  `defaultValue` still generates NOT NULL unless you opt in explicitly:

  ```typescript
  // Optional select with a default, kept nullable for data containing NULLs
  status: select({
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
    ],
    defaultValue: 'draft',
    db: { isNullable: true },
  })
  // Generates: status String? @default("draft")

  // Enum-backed equivalent
  status: select({
    options: [{ label: 'Open', value: 'open' }],
    defaultValue: 'open',
    db: { type: 'enum', isNullable: true },
  })
  // Generates: status <Enum>? @default(open)
  ```

  `db.enumName` overrides the derived `<List><Field>` name of the generated Prisma
  enum for native-enum selects, renaming both the `enum` block and every reference
  to it in the owning model — useful for matching a live DB enum (e.g. Keystone's
  `…Type` suffix):

  ```typescript
  status: select({
    options: [
      { label: 'Open', value: 'open' },
      { label: 'Closed', value: 'closed' },
    ],
    db: { type: 'enum', enumName: 'AccountNoteStatusType' },
  })
  // Generates: enum AccountNoteStatusType { ... } and the column references it
  ```

- [#493](https://github.com/OpenSaasAU/stack/pull/493) [`acb6100`](https://github.com/OpenSaasAU/stack/commit/acb6100a078aca29e94a82ebe607d2d4f8683af2) Thanks [@borisno2](https://github.com/borisno2)! - Honour `defaultValue` for `text()`, `integer()`, and `json()` fields in the generated Prisma schema

  These three field builders previously dropped `defaultValue` and emitted no `@default(...)`. They now serialise the configured default into a Prisma `@default(...)` literal via a new shared, pure `formatPrismaDefault` module, matching Keystone 6 conventions. The nullable `?` modifier is preserved independently of the default, and fields without a `defaultValue` still emit no `@default(...)`.

  ```typescript
  fields: {
    // Int @default(3550)
    quota: integer({ defaultValue: 3550 }),
    // String @default("PLEASE_UPDATE")
    status: text({ defaultValue: 'PLEASE_UPDATE' }),
    // Json? @default("[1,2,3,4,5]") — Keystone's space-free JSON literal
    limits: json({ defaultValue: [1, 2, 3, 4, 5] }),
    // Json? @default("[]")
    tags: json({ defaultValue: [] }),
  }
  ```

  See ADR-0004 for the Keystone-compatibility rationale.

- [#502](https://github.com/OpenSaasAU/stack/pull/502) [`593390c`](https://github.com/OpenSaasAU/stack/commit/593390c57d9844ca7ada8f45b340c849f1d8d647) Thanks [@{](https://github.com/{)! - Add `authPlugin` schema placement so Auth lists can adopt an existing non-`public` better-auth layout (clean-diff adoption)

  The auth lists can now be placed in a non-`public` Postgres schema (e.g. `auth`) so they diff CLEAN against a separate-schema better-auth installation. A plugin-level `schema` option applies `@@schema(...)` to all generated Auth lists, with a per-list override.

  ```typescript
  authPlugin({
    schema: 'auth', // all Auth lists get @@schema("auth")
   modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    account: { modelName: 'AuthAccount' },
    // per-model override: relocate one list to a different schema
    verification: { modelName: 'AuthVerification', schema: 'auth_internal' },
  })
  ```

  The plugin's `beforeGenerate` hook wires the datasource `schemas` array (always including `public`) and defaults any list without an explicit `db.schema` to `public`, producing a valid multi-schema Prisma schema. With no `schema` option the output is unchanged (greenfield default stays in `public`, no `@@schema`).

  Core support added for this (mirroring the `db.map` → `@@map` work):
  - List-level `db.schema` → the Prisma generator emits `@@schema("...")` on the model.
  - Database-level `db.schemas` → the generator emits the datasource `schemas = [...]` array and enables the `multiSchema` preview feature.

  ```typescript
  // Core/generator building blocks
  db: { provider: 'postgresql', schemas: ['public', 'auth'] }
  AuthUser: list({ fields: { ... }, db: { map: 'AuthUser', schema: 'auth' } })
  // Generates: model AuthUser { ... @@map("AuthUser") @@schema("auth") }
  ```

### Patch Changes

- [#500](https://github.com/OpenSaasAU/stack/pull/500) [`309c666`](https://github.com/OpenSaasAU/stack/commit/309c666388b71e2bfbe16b7da3ee0f923b3bf716) Thanks [@borisno2](https://github.com/borisno2)! - Re-export the fragment query API (`defineFragment`, `runQuery`, `runQueryOne`, and the `ResultOf`, `RelationSelector`, `QueryArgs` types) from the package root so the documented `import { defineFragment, runQuery, runQueryOne, type ResultOf } from '@opensaas/stack-core'` resolves.

- [#511](https://github.com/OpenSaasAU/stack/pull/511) [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c) Thanks [@borisno2](https://github.com/borisno2)! - Fix field-level write-access bypass for multi-column `image()`/`file()` fields. The per-part column split now respects the field's own `create`/`update` access (denied fields write none of their columns), matching single-column behaviour.

  Note the known lossy multi-column round-trip when assembling legacy Keystone columns: `originalFilename` collapses to `filename`, `uploadedAt` is `''`, and a NULL `contentType` reads back as `application/octet-stream`.

- [#518](https://github.com/OpenSaasAU/stack/pull/518) [`d152203`](https://github.com/OpenSaasAU/stack/commit/d1522035e21b6ad7ad1b89b05264c54c13dadcf1) Thanks [@borisno2](https://github.com/borisno2)! - Remove leftover debug console.log statements from runtime code (password field resolveInput and MCP tool call handler)

## 0.21.0

### Minor Changes

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Curate the `@opensaas/stack-core` public surface into clearly-scoped entry points

  The root entry point now exposes only the everyday consumer surface — `config`,
  `list`, `getContext`, the naming helpers (`getDbKey`, `getUrlKey`,
  `getListKeyFromUrl`), `ValidationError`, and the config/access types you annotate
  with. Plugin and field authoring contracts move to a new `/extend` path, and the
  plumbing shared with sibling packages and generated code moves to `/internal`.

  ```typescript
  // Everyday usage (unchanged)
  import { config, list, getContext } from '@opensaas/stack-core'

  // Authoring a plugin or a third-party field package
  import type { Plugin, BaseFieldConfig, TypeInfo } from '@opensaas/stack-core/extend'
  ```

  `@opensaas/stack-core/internal` carries no semver guarantees; application code
  should never import from it. `Session` stays on the root entry point because it is
  the module-augmentation target.

  Removed from the public surface (zero callers): the nine `*HookArgs` types and the
  callerless typed-query runtime types. The other `@opensaas/*` packages and the CLI
  generator are updated to import from the new paths.

- [#416](https://github.com/OpenSaasAU/stack/pull/416) [`841a836`](https://github.com/OpenSaasAU/stack/commit/841a836494e2647f390ae19a8c4121d38ebd2fa4) Thanks [@borisno2](https://github.com/borisno2)! - Move field-config types to `@opensaas/stack-core/fields`, beside their builders

  The concrete field-config types (`TextField`, `IntegerField`, `CheckboxField`,
  `TimestampField`, `PasswordField`, `SelectField`, `RelationshipField`,
  `JsonField`, `VirtualField`, plus `DecimalField`, `CalendarDayField`, and
  `PrismaRelationResult`) now live on the `/fields` entry point alongside the
  builders that produce them, instead of the root barrel. One concept, one import
  path:

  ```typescript
  import { text, decimal } from '@opensaas/stack-core/fields'
  import type { TextField, DecimalField } from '@opensaas/stack-core/fields'
  ```

  `DecimalField` and `CalendarDayField` were previously defined but exported from
  nowhere — they are now public, and the CLI's lists generator maps `decimal`/
  `calendarDay` fields to their precise types instead of the generic
  `BaseFieldConfig` fallback. The umbrella `FieldConfig` stays on the root entry
  point and `BaseFieldConfig` stays on `/extend`.

### Patch Changes

- [#441](https://github.com/OpenSaasAU/stack/pull/441) [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2) Thanks [@borisno2](https://github.com/borisno2)! - Validate field self-containment at config load instead of failing deep in generation

  Core now exports `validateFieldConfig(field, fieldKey, listKey?)` and `validateConfigFields(config)` (plus the `FieldConfigValidationError` type). They check each field implements its generation contract — `getPrismaType`, `getTypeScriptType`, and `getZodSchema` (or `getPrismaRelation` for relationships; virtual fields skip `getPrismaType`) — and return structured per-field errors. `opensaas generate` runs this first and fails fast with a clear message naming the list, field, and missing method, rather than throwing an opaque stack trace mid-generation.

- [#428](https://github.com/OpenSaasAU/stack/pull/428) [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce) Thanks [@borisno2](https://github.com/borisno2)! - Fix outdated SQLite adapter guidance to match the installed `@prisma/adapter-better-sqlite3` API (`PrismaBetterSqlite3` constructed with `{ url }`), so copied examples actually run. Updates the CLI "missing adapter" error message and the migration config it generates, plus the `prismaClientConstructor` JSDoc example.

- [#440](https://github.com/OpenSaasAU/stack/pull/440) [`70b4f53`](https://github.com/OpenSaasAU/stack/commit/70b4f538d380bbf546af50a985d29b48a71d3b4d) Thanks [@borisno2](https://github.com/borisno2)! - Refactor nested-operation dispatch into a handler registry (internal, no behaviour change)

- [#397](https://github.com/OpenSaasAU/stack/pull/397) [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5) Thanks [@borisno2](https://github.com/borisno2)! - Move relationship Prisma schema generation into the relationship field builder

  The relationship field now exposes a `getPrismaRelation()` method that returns its complete Prisma schema contribution (FK line, relation line, synthetic back-relation). The Prisma generator delegates to this method instead of special-casing relationships, keeping it a neutral coordinator. Generated schemas are unchanged.

- [#455](https://github.com/OpenSaasAU/stack/pull/455) [`d3fdf2a`](https://github.com/OpenSaasAU/stack/commit/d3fdf2a2e5374302bc7fe1fe814cb0f567a349df) Thanks [@borisno2](https://github.com/borisno2)! - Exclude `**/dist/**` from Vitest test discovery and gate coverage on `src/access`, `src/context`, and `src/validation` via per-file thresholds.

- [#403](https://github.com/OpenSaasAU/stack/pull/403) [`0f9c644`](https://github.com/OpenSaasAU/stack/commit/0f9c644a115ad747e338e6138b4762b4a48a9144) Thanks [@borisno2](https://github.com/borisno2)! - Split the access engine into named two-phase-read modules: Access Filter (pre-query), Field Visibility (post-query), and a shared field-access evaluator. No behaviour or public API change.

- [#411](https://github.com/OpenSaasAU/stack/pull/411) [`96258b0`](https://github.com/OpenSaasAU/stack/commit/96258b00bb762d9e38cfb83eacae65ce670b161f) Thanks [@borisno2](https://github.com/borisno2)! - Deduplicate field-level hook execution helpers by promoting them to `hooks/index.ts`, and remove a stray `console.log` that ran on every create/update.

- [#439](https://github.com/OpenSaasAU/stack/pull/439) [`898e477`](https://github.com/OpenSaasAU/stack/commit/898e47747abc02e457a54e2a78939450d16da5fb) Thanks [@borisno2](https://github.com/borisno2)! - Internal refactor: extract the write transform+validate span into a single Hook Pipeline that the Write Pipeline delegates to. No behaviour change.

- [#438](https://github.com/OpenSaasAU/stack/pull/438) [`29966b2`](https://github.com/OpenSaasAU/stack/commit/29966b23597199bcf4233298b1d0de6401b91acd) Thanks [@borisno2](https://github.com/borisno2)! - Refactor the write path into a single Write Pipeline. The canonical secured write sequence (hooks, validation, access, writable-field filtering, nested operations, persistence, after-hooks, Field Visibility) now lives in one module; create/update/delete are thin adapters over it parameterised by a per-operation strategy. Internal refactor only — no public API or behaviour change.

## 0.20.1

## 0.20.0

### Minor Changes

- [#359](https://github.com/OpenSaasAU/stack/pull/359) [`28be231`](https://github.com/OpenSaasAU/stack/commit/28be23183bc7a9a072f86b3b7286c9c2109fdb11) Thanks [@authorFragment,](https://github.com/authorFragment,)! - Add fragment-based, type-safe query utilities and integrate them into `context.db` operations

  OpenSaaS Stack now ships `defineFragment`, `ResultOf`, and `RelationSelector` — composable query helpers that give you the same benefits as Keystone's GraphQL fragments (reuse, type inference, nesting) without a GraphQL runtime.

  **Define reusable fragments:**

  ```ts
  import type { User, Post } from '.prisma/client'
  import { defineFragment, type ResultOf } from '@opensaas/stack-core'

  const authorFragment = defineFragment<User>()({ id: true, name: true } as const)

  const postFragment = defineFragment<Post>()({
    id: true,
    title: true,
    // nested relationship
  } as const)

  // Types are inferred — no codegen step required
  type PostData = ResultOf<typeof postFragment>
  // → { id: string; title: string; author: { id: string; name: string } | null }
  ```

  **Pass fragments directly to `context.db` operations (primary API):**

  ```ts
  // List — typed to ResultOf<typeof postFragment>[]
  const posts = await context.db.post.findMany({
    query: postFragment,
    where: { published: true },
    orderBy: { publishedAt: 'desc' },
    take: 10,
  })

  // Single record — typed to ResultOf<typeof postFragment> | null
  const post = await context.db.post.findUnique({
    where: { id: postId },
    query: postFragment,
  })
  if (!post) return notFound()
  ```

  **Nested relationship filtering with `RelationSelector`:**

  ```ts
  const commentFragment = defineFragment<Comment>()({ id: true, body: true } as const)

  const postWithComments = defineFragment<Post>()({
    id: true,
    title: true,
    comments: {
      query: commentFragment,
      where: { approved: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    },
  } as const)

  const posts = await context.db.post.findMany({ query: postWithComments })
  ```

  **Standalone helpers also available** for use in hooks and utilities:

  ```ts
  import { runQuery, runQueryOne } from '@opensaas/stack-core'

  const posts = await runQuery(context, 'Post', postFragment, { where: { published: true } })
  const post = await runQueryOne(context, 'Post', postFragment, { id: postId })
  ```

  Fragments compose freely and can be nested to any depth. Access control is always enforced — the `query` parameter only controls the include structure and field shape, not security. `orderBy` is now also supported in `context.db.<list>.findMany()`.

  See `specs/keystone-migration.md` for a full migration guide from Keystone's `context.graphql.run`.

## 0.19.1

## 0.19.0

### Minor Changes

- [#353](https://github.com/OpenSaasAU/stack/pull/353) [`28f2834`](https://github.com/OpenSaasAU/stack/commit/28f2834b199b93200c74cefb1594ba3704f0a839) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.isNullable` and `db.nativeType` support to all field types

  All field types now support two new `db` configuration options that were previously only available in Keystone 6:

  ### `db.isNullable`

  Controls DB-level nullability independently of `validation.isRequired`. This allows you to:
  - Make a field non-nullable at the DB level without making it API-required
  - Explicitly mark a field as nullable regardless of other settings

  ```typescript
  fields: {
    // DB non-nullable, but API optional (relies on a default value or hook)
    phoneNumber: text({
      db: { isNullable: false }
      // Generates: phoneNumber String (non-nullable)
    }),

    // DB nullable, explicitly set
    lastMessagePreview: text({
      db: { isNullable: true }
      // Generates: lastMessagePreview String? (nullable)
    }),

    // DB non-nullable without API validation (field must always be set via hooks or defaults)
    internalCode: integer({
      db: { isNullable: false }
      // Generates: internalCode Int (non-nullable)
    })
  }
  ```

  ### `db.nativeType`

  Overrides the native database column type. Generates a `@db.<nativeType>` attribute in the Prisma schema. Available types depend on your database provider.

  ```typescript
  fields: {
    // PostgreSQL: use TEXT instead of VARCHAR for long content
    medical: text({
      db: { isNullable: true, nativeType: 'Text' }
      // Generates: medical String? @db.Text
    }),

    // PostgreSQL: use SMALLINT for small numbers
    score: integer({
      db: { nativeType: 'SmallInt' }
      // Generates: score Int? @db.SmallInt
    }),

    // PostgreSQL: use TIMESTAMPTZ for timezone-aware timestamps
    scheduledAt: timestamp({
      db: { nativeType: 'Timestamptz' }
      // Generates: scheduledAt DateTime? @db.Timestamptz
    })
  }
  ```

  Both options are supported on `text`, `integer`, `password`, `json`, `timestamp`, `checkbox` (isNullable only), `decimal`, and `calendarDay` fields.

- [#348](https://github.com/OpenSaasAU/stack/pull/348) [`5410cb6`](https://github.com/OpenSaasAU/stack/commit/5410cb604198e087762e39c8aec87fe3736d8c01) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.type: 'enum'` support to the `select` field for native database enum storage

  The `select` field now supports `db.type: 'enum'` to store values as a native Prisma enum type rather than a plain string. This generates an `enum` block in the Prisma schema and uses the enum type in the model, matching Keystone 6's enum select behaviour.

  ```typescript
  import { select } from '@opensaas/stack-core/fields'

  lists: {
    Post: list({
      fields: {
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
            { label: 'Archived', value: 'archived' },
          ],
          db: { type: 'enum' },   // generates a Prisma enum
          defaultValue: 'draft',
        }),
      },
    }),
  }
  ```

  This generates the following Prisma schema:

  ```prisma
  enum PostStatus {
    draft
    published
    archived
  }

  model Post {
    id        String     @id @default(cuid())
    status    PostStatus @default(draft)
    createdAt DateTime   @default(now())
    updatedAt DateTime   @default(now()) @updatedAt
  }
  ```

  **Notes:**
  - The enum name is derived from `<ListName><FieldName>` in PascalCase (e.g. `PostStatus`, `UserRole`)
  - Default values use unquoted Prisma enum syntax (`@default(draft)` not `@default("draft")`)
  - Enum option values must be valid Prisma identifiers: start with a letter, contain only letters, digits, and underscores (e.g. `in_progress` is valid, `in-progress` is not)
  - The TypeScript union type (`'draft' | 'published'`) is generated identically to a string select field
  - Omitting `db.type` or setting `db.type: 'string'` (the default) preserves the existing `String` column behaviour

### Patch Changes

- [#352](https://github.com/OpenSaasAU/stack/pull/352) [`bd41b1e`](https://github.com/OpenSaasAU/stack/commit/bd41b1e75b78c2e9748422352e6a500ed26df4e9) Thanks [@borisno2](https://github.com/borisno2)! - Fix singleton lists to use `Int @id @default(1)` matching Keystone 6 behaviour

  Singleton lists now generate `Int @id @default(1)` in the Prisma schema instead of
  `String @id @default(cuid())`. This matches Keystone 6's behaviour where singleton
  records always use integer primary key `1`, making migration from Keystone 6 straightforward
  without data loss.

  **Migration guide for existing singleton lists:**

  If you have an existing database with singleton models that use `String @id`, you will need
  to run an SQL migration to convert the id column from text to integer:

  ```sql
  -- Example for PostgreSQL (adjust table name as needed)
  ALTER TABLE "EmailSettings" ALTER COLUMN id TYPE INTEGER USING id::integer;
  UPDATE "EmailSettings" SET id = 1;
  ```

  For SQLite (which does not support ALTER COLUMN):

  ```sql
  -- Recreate the table with Int id
  CREATE TABLE "EmailSettings_new" (id INTEGER PRIMARY KEY DEFAULT 1, ...);
  INSERT INTO "EmailSettings_new" SELECT 1, ... FROM "EmailSettings";
  DROP TABLE "EmailSettings";
  ALTER TABLE "EmailSettings_new" RENAME TO "EmailSettings";
  ```

  New projects and fresh databases will work automatically without any migration steps.
  Fixes #350.

## 0.18.2

### Patch Changes

- [#329](https://github.com/OpenSaasAU/stack/pull/329) [`0b0f322`](https://github.com/OpenSaasAU/stack/commit/0b0f3223e3703014164d49c8f3b455752a6468c1) Thanks [@borisno2](https://github.com/borisno2)! - Fix infinite loop when virtual field resolveOutput hooks make database queries

  When a virtual field's resolveOutput hook called context.db methods, it could cause an infinite loop if the query included relationships back to the original entity. This is now prevented by tracking resolveOutput hook execution depth and skipping auto-inclusion of relationships when inside a hook.

## 0.18.1

### Patch Changes

- [#327](https://github.com/OpenSaasAU/stack/pull/327) [`3f59454`](https://github.com/OpenSaasAU/stack/commit/3f59454e03976f7ff4f401c661624d1934910a17) Thanks [@borisno2](https://github.com/borisno2)! - Fix async resolveOutput hooks not being awaited in filterReadableFields

  The `resolveOutput` hooks for fields (especially virtual fields) were being called but not awaited, causing Promise objects to appear in output instead of resolved values. This fix properly awaits async `resolveOutput` hooks using `Promise.resolve()` wrapper for backwards compatibility with sync hooks.

## 0.18.0

## 0.17.0

### Minor Changes

- [#315](https://github.com/OpenSaasAU/stack/pull/315) [`538bc20`](https://github.com/OpenSaasAU/stack/commit/538bc20698b7d0f3c6600741f4553306008dec64) Thanks [@borisno2](https://github.com/borisno2)! - Add `createMany` and `updateMany` batch operations to `context.db`

  You can now use `createMany` to create multiple items at once:

  ```typescript
  await context.db.billItem.createMany({
    data: [
      { billId: '1', name: 'Item 1', quantity: 2, amount: 100 },
      { billId: '1', name: 'Item 2', quantity: 1, amount: 50 },
      { billId: '1', name: 'Item 3', quantity: 3, amount: 75 },
    ],
  })
  ```

  And `updateMany` to update multiple items based on a filter:

  ```typescript
  await context.db.bill.updateMany({
    where: { id: { in: ['1', '2', '3'] } },
    data: { status: 'PAID' },
  })
  ```

  Both methods run individual operations in a loop to ensure all hooks and access control rules are properly executed for each item, maintaining data integrity and security.

## 0.16.0

### Minor Changes

- [#311](https://github.com/OpenSaasAU/stack/pull/311) [`85b067b`](https://github.com/OpenSaasAU/stack/commit/85b067b2d10bddaffccf519025aeae2dbc00fa85) Thanks [@borisno2](https://github.com/borisno2)! - Add customizable join table naming for many-to-many relationships

  **New Features:**
  1. **Global Keystone Naming:** Set `joinTableNaming: 'keystone'` for automatic KeystoneJS-compatible naming across all M2M relationships
  2. **Per-Field Relation Names:** Use `db.relationName` on individual relationship fields for fine-grained control
  3. **Hybrid Support:** Combine both options - per-field names override global setting

  **Use Cases:**
  - **KeystoneJS Migration:** Preserve existing join table names to prevent data loss
  - **Custom Naming:** Specify exact relation names for specific relationships
  - **Mixed Projects:** Use Keystone naming for migrations while customizing specific tables

  **Configuration Options:**

  **Option 1: Global Keystone Naming**

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      joinTableNaming: 'keystone', // Auto-apply to all M2M relationships
    },
    lists: {
      Lesson: {
        fields: {
          teachers: relationship({ ref: 'Teacher.lessons', many: true }),
          // → Creates implicit join table _Lesson_teachers
        },
      },
    },
  })
  ```

  **Option 2: Per-Field Relation Name**

  ```typescript
  lists: {
    Lesson: {
      fields: {
        teachers: relationship({
          ref: 'Teacher.lessons',
          many: true,
          db: { relationName: 'Lesson_teachers' }, // Only set on ONE side
        }),
      },
    },
    Teacher: {
      fields: {
        lessons: relationship({ ref: 'Lesson.teachers', many: true }),
        // Automatically uses same relationName from other side
      },
    },
  }
  ```

  **Option 3: Hybrid (per-field overrides global)**

  ```typescript
  export default config({
    db: {
      joinTableNaming: 'keystone', // Default for most relationships
    },
    lists: {
      Lesson: {
        fields: {
          students: relationship({ ref: 'Student.lessons', many: true }),
          // → Uses global Keystone naming: _Lesson_students
          teachers: relationship({
            ref: 'Teacher.lessons',
            many: true,
            db: { relationName: 'CustomTeachers' }, // Override for this one
          }),
          // → Uses custom name: _CustomTeachers
        },
      },
    },
  })
  ```

  **How It Works:**

  Prisma automatically creates implicit join tables when you use `@relation("name")` on both sides of a many-to-many relationship. The join table is named `_name`. No explicit join table models are generated - Prisma handles this automatically.

  **Migration Guide:**
  1. Identify all M2M relationships in your Keystone schema
  2. Choose strategy:
     - Full migration: Use `joinTableNaming: 'keystone'`
     - Selective: Use per-field `db.relationName`
  3. Run `pnpm generate`
  4. Verify relation names match (check for `@relation("name")`)
  5. Use `prisma db push` to sync

  **Validation:**
  - Both sides of bidirectional M2M must use matching `relationName` if both specify it
  - Only need to set on one side - automatically propagates to other side
  - Per-field takes precedence over global setting

## 0.15.0

### Minor Changes

- [#310](https://github.com/OpenSaasAU/stack/pull/310) [`19f04b1`](https://github.com/OpenSaasAU/stack/commit/19f04b1c5e0b172257936c366bd28d56aa825a24) Thanks [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({), [@relationship({](https://github.com/relationship({)! - Add automatic foreign key indexing for relationship fields (matching Keystone behavior)

  Relationship fields now automatically generate `@@index` directives on their foreign key fields by default. This matches Keystone's behavior and prevents performance regression when migrating from Keystone.

  **Default behavior (indexed):**

  ```typescript
   ref: 'User.posts' })
  // Generates: @@index([authorId])
  ```

  **Explicit control:**

  ```typescript
  // Force indexing
   ref: 'User.posts', isIndexed: true })

  // Unique constraint (for one-to-one)
   ref: 'User.posts', isIndexed: 'unique' })

  // Disable indexing (not recommended)
   ref: 'User.posts', isIndexed: false })
  ```

  This resolves the issue where migrations from Keystone would drop all foreign key indexes, causing performance degradation on queries filtering or joining on foreign keys.

## 0.14.0

### Minor Changes

- [#298](https://github.com/OpenSaasAU/stack/pull/298) [`5f1bfb5`](https://github.com/OpenSaasAU/stack/commit/5f1bfb5d286b3b43c61fceeae6d78588c126d488) Thanks [@borisno2](https://github.com/borisno2)! - Add field-level `extendPrismaSchema` support for relationship fields

  Relationship fields now support `extendPrismaSchema` in their `db` config, allowing granular modification of generated Prisma schema lines. This is useful for self-referential relationships that need custom `onDelete` or `onUpdate` actions.

  ```typescript
  parent: relationship({
    ref: 'Category.children',
    db: {
      foreignKey: true,
      extendPrismaSchema: ({ fkLine, relationLine }) => ({
        fkLine,
        relationLine: relationLine.replace(
          '@relation(',
          '@relation(onDelete: SetNull, onUpdate: Cascade, ',
        ),
      }),
    },
  })
  ```

  The function receives `fkLine` (the foreign key field line, only present for single relationships that own the FK) and `relationLine` (the relation field line), and returns the modified lines.

  Fixes #284

- [#295](https://github.com/OpenSaasAU/stack/pull/295) [`6f8d37a`](https://github.com/OpenSaasAU/stack/commit/6f8d37a0761d50b9b9b707f26b39176304428770) Thanks [@borisno2](https://github.com/borisno2)! - Add singleton lists support for single-record tables

  You can now create singleton lists (lists that should only ever have one record) by setting `isSingleton: true`. This is useful for Settings, Configuration, or other global single-record tables.

  Features:
  - Prevents creating multiple records (throws error on second create)
  - Auto-creates record with field defaults on first access (configurable)
  - Provides a `get()` method for easy access to the singleton record
  - Blocks `delete` and `findMany` operations on singleton lists
  - Works with all existing access control and hooks

  Usage:

  ```typescript
  import { config, list } from '@opensaas/stack-core'
  import { text, checkbox, integer } from '@opensaas/stack-core/fields'

  export default config({
    lists: {
      Settings: list({
        fields: {
          siteName: text({ defaultValue: 'My Site' }),
          maintenanceMode: checkbox({ defaultValue: false }),
          maxUploadSize: integer({ defaultValue: 10 }),
        },
        access: {
          operation: {
            query: () => true,
            update: isAdmin,
          },
        },
        isSingleton: true, // Enable singleton mode
      }),
    },
  })
  ```

  Access the singleton record:

  ```typescript
  // Auto-creates with defaults if no record exists
  const settings = await context.db.settings.get()

  // Update the singleton
  await context.db.settings.update({
    where: { id: settings.id },
    data: { siteName: 'Updated Site' },
  })
  ```

  Disable auto-create:

  ```typescript
  Settings: list({
    fields: {/* ... */},
    isSingleton: {
      autoCreate: false, // Must manually create the record
    },
  })
  ```

- [#291](https://github.com/OpenSaasAU/stack/pull/291) [`ed25cc5`](https://github.com/OpenSaasAU/stack/commit/ed25cc5aba43709d40ad256c982364ca8a8b0f2e) Thanks [@borisno2](https://github.com/borisno2)! - Add access control function shorthand to ListConfig

  List configurations now support a function shorthand for access control that applies to all operations:

  ```typescript
  // Instead of this:
  Post: list({
    fields: { title: text() },
    access: {
      operation: {
        query: isAuthenticated,
        create: isAuthenticated,
        update: isAuthenticated,
        delete: isAuthenticated,
      },
    },
  })

  // You can now write:
  Post: list({
    fields: { title: text() },
    access: isAuthenticated,
  })
  ```

  The `list()` function normalizes the shorthand to the object form at runtime, so existing code continues to work unchanged.

  New exports:
  - `ListAccessControl<T>` - Union type accepting either a function or operation object
  - `ListConfigInput<TTypeInfo>` - Input type for `list()` function with flexible access control

  Fixes #285.

- [#297](https://github.com/OpenSaasAU/stack/pull/297) [`c2263d2`](https://github.com/OpenSaasAU/stack/commit/c2263d21cc7a4eaffc0b06af04eb7b3a1a3ce437) Thanks [@borisno2](https://github.com/borisno2)! - Add inputData parameter to field-level access control functions

  Field-level access control functions now receive an `inputData` parameter for create and update operations, allowing you to validate incoming data before it's written to the database.

  This is particularly useful for validating relationship connections:

  ```typescript
  lists: {
    Student: list({
      fields: {
        account: relationship({
          ref: 'Account.students',
          access: {
            create: ({ inputData, session }) => {
              // Ensure students can only connect to their own account
              if (session?.data?.role !== 'ADMIN') {
                return inputData?.account?.connect?.id === session?.data?.accountId
              }
              return true
            },
          },
        }),
      },
    }),
  }
  ```

  The `inputData` parameter contains the original input data passed to create/update operations:
  - For **create** operations: contains all input data including relationship connection syntax
  - For **update** operations: contains only the fields being updated
  - For **read** operations: `inputData` is undefined

  **Backward compatibility:**
  - Existing field access control functions continue to work without modification since `inputData` is optional
  - `AccessControl` functions (operation-level) can be reused in field-level contexts for convenience
  - If a filter is returned from field-level access, it's ignored and defaults to allowing access (only boolean results are used)

- [#293](https://github.com/OpenSaasAU/stack/pull/293) [`0c66ebc`](https://github.com/OpenSaasAU/stack/commit/0c66ebc4492fac47f2028569b080d496328c18bf) Thanks [@borisno2](https://github.com/borisno2)! - Export hook argument types for better TypeScript support

  You can now import and use hook argument types to annotate your hook parameters, eliminating implicit `any` errors with strict TypeScript settings:

  **List-level hooks:**

  ```typescript
  import type { AfterOperationHookArgs } from '@opensaas/stack-core'

  Post: list({
    hooks: {
      afterOperation: async (args: AfterOperationHookArgs) => {
        if (args.operation === 'update') {
          console.log('Updated:', args.item)
        }
      },
    },
  })
  ```

  **Field-level hooks:**

  ```typescript
  import type { FieldValidateHookArgs } from '@opensaas/stack-core'

  fields: {
    email: text({
      hooks: {
        validate: async (args: FieldValidateHookArgs) => {
          if (!args.resolvedData.email?.includes('@')) {
            args.addValidationError('Invalid email')
          }
        },
      },
    })
  }
  ```

  **Available types:**
  - List-level: `ResolveInputHookArgs`, `ValidateHookArgs`, `BeforeOperationHookArgs`, `AfterOperationHookArgs`
  - Field-level: `FieldResolveInputHookArgs`, `FieldValidateHookArgs`, `FieldBeforeOperationHookArgs`, `FieldAfterOperationHookArgs`, `FieldResolveOutputHookArgs`

  Additionally, field-level hooks now support `validateInput` as a deprecated alias for `validate` for backwards compatibility with Keystone patterns.

## 0.13.0

### Minor Changes

- [#281](https://github.com/OpenSaasAU/stack/pull/281) [`b979df4`](https://github.com/OpenSaasAU/stack/commit/b979df458ea39ce763dd92aa212fc70be207c416) Thanks [@borisno2](https://github.com/borisno2)! - Update hooks API to comply with Keystone hooks specification

  The hooks system now fully complies with Keystone's hooks API specification. Hook arguments have been updated to include additional context and follow consistent naming conventions.

  **List-level hooks now receive:**
  - `listKey` - The name of the list being operated on
  - `inputData` - The original data passed to the operation (before transformations)
  - `resolvedData` - The data after transformations
  - `validate` hook replaces `validateInput` (backward compatible via alias)

  **Field-level hooks now receive:**
  - `listKey` - The name of the list
  - `fieldKey` - The name of the field (replaces `fieldName` in most hooks)
  - `inputData` - The original input data
  - `resolvedData` - The transformed data
  - All hooks now support `validate` hook for field-level validation

  **Migration for existing hooks:**

  ```typescript
  // Before - List-level resolveInput
  resolveInput: async ({ resolvedData, item }) => {
    return { ...resolvedData, updatedAt: new Date() }
  }

  // After - List-level resolveInput
  resolveInput: async ({ listKey, operation, inputData, resolvedData, item, context }) => {
    return { ...resolvedData, updatedAt: new Date() }
  }

  // Before - Field-level resolveInput
  resolveInput: async ({ inputValue, operation, item }) => {
    return hashPassword(inputValue)
  }

  // After - Field-level resolveInput
  resolveInput: async ({
    listKey,
    fieldKey,
    operation,
    inputData,
    item,
    resolvedData,
    context,
  }) => {
    const fieldValue = resolvedData[fieldKey]
    return hashPassword(fieldValue)
  }

  // Before - validateInput
  validateInput: async ({ resolvedData, addValidationError }) => {
    if (resolvedData.title?.includes('spam')) {
      addValidationError('Title cannot contain spam')
    }
  }

  // After - validate (validateInput still works as alias)
  validate: async ({
    listKey,
    operation,
    inputData,
    resolvedData,
    item,
    context,
    addValidationError,
  }) => {
    if (operation === 'delete') return
    if (resolvedData.title?.includes('spam')) {
      addValidationError('Title cannot contain spam')
    }
  }
  ```

  **Key changes:**
  1. All hooks now receive `listKey` and `context` parameters
  2. Write operation hooks receive both `inputData` (original) and `resolvedData` (transformed)
  3. `afterOperation` hooks receive `originalItem` for comparing before/after state
  4. Field hooks use `fieldKey` parameter and access values via `resolvedData[fieldKey]`
  5. The `validate` hook is now the standard name (replaces `validateInput`, which remains as deprecated alias)

  See the updated CLAUDE.md documentation for complete hook argument specifications.

## 0.12.1

## 0.12.0

### Minor Changes

- [#277](https://github.com/OpenSaasAU/stack/pull/277) [`152e3bc`](https://github.com/OpenSaasAU/stack/commit/152e3bc7e7c703ad981ad54d32f5f7251233e66d) Thanks [@borisno2](https://github.com/borisno2)! - Add `db.nativeType` and `db.isNullable` options to text field

  You can now specify Prisma native database type attributes and control nullability independently:

  ```typescript
  // Use PostgreSQL Text type instead of default String
  fields: {
    description: text({
      validation: { isRequired: true },
      db: {
        nativeType: 'Text',
        isNullable: false,
      },
    }),
  }
  ```

  This generates:

  ```prisma
  description String @db.Text
  ```

  The `db.nativeType` option allows you to override the default Prisma type for your database provider (e.g., `Text`, `VarChar(255)`, `MediumText`), while `db.isNullable` lets you control nullability independently from the `isRequired` validation.

- [#275](https://github.com/OpenSaasAU/stack/pull/275) [`02e9ab1`](https://github.com/OpenSaasAU/stack/commit/02e9ab1578741e9fd32cbc3a7938c66002c4d5f6) Thanks [@borisno2](https://github.com/borisno2)! - Add calendarDay field type for date-only values in ISO8601 format

  You can now use the `calendarDay` field for storing date values without time components:

  ```typescript
  import { calendarDay } from '@opensaas/stack-core/fields'

  fields: {
    birthDate: calendarDay({
      validation: { isRequired: true }
    }),
    startDate: calendarDay({
      defaultValue: '2025-01-01',
      db: { map: 'start_date' }
    }),
    eventDate: calendarDay({
      isIndexed: true
    })
  }
  ```

  The field:
  - Stores dates in ISO8601 format (YYYY-MM-DD)
  - Uses native DATE type on PostgreSQL/MySQL via `@db.Date`
  - Uses string representation on SQLite
  - Supports all standard field options (validation, database mapping, indexing)

## 0.11.0

### Minor Changes

- [#271](https://github.com/OpenSaasAU/stack/pull/271) [`ec53708`](https://github.com/OpenSaasAU/stack/commit/ec53708898579dcc7de80eb9fc9a3a99c45367c9) Thanks [@borisno2](https://github.com/borisno2)! - Add decimal field type for precise numeric values

  You can now use the `decimal()` field type for storing precise decimal numbers, ideal for currency, measurements, and financial calculations:

  ```typescript
  import { decimal } from '@opensaas/stack-core/fields'

  fields: {
    price: decimal({
      precision: 10,
      scale: 2,
      validation: {
        isRequired: true,
        min: '0',
        max: '999999.99'
      }
    }),
    latitude: decimal({
      precision: 18,
      scale: 8,
      db: { map: 'lat' }
    })
  }
  ```

  Features:
  - Configurable precision (default: 18) and scale (default: 4)
  - Min/max validation with string values for precision
  - Database column mapping via `db.map`
  - Nullability control via `db.isNullable`
  - Index support (`isIndexed: true` or `isIndexed: 'unique'`)
  - Uses Prisma's Decimal type backed by decimal.js for precision
  - Generates proper TypeScript types with `import('decimal.js').Decimal`

- [#270](https://github.com/OpenSaasAU/stack/pull/270) [`8a476a5`](https://github.com/OpenSaasAU/stack/commit/8a476a563761f3b268ad43269058267871e43b73) Thanks [@relationship({](https://github.com/relationship({)! - Add support for custom database column names via `db.map`

  You can now customize database column names using Prisma's @map attribute, following Keystone's pattern:

  **Regular fields:**

  ```typescript
  fields: {
    firstName: text({
      db: { map: 'first_name' }
    }),
    email: text({
      isIndexed: 'unique',
      db: { map: 'email_address' }
    })
  }
  ```

  **Relationship foreign keys:**

  ```typescript
  fields: {

      ref: 'User.posts',
      db: { foreignKey: { map: 'author_user_id' } },
    })
  }
  ```

  Foreign key columns now default to the field name (not `fieldNameId`) for better consistency with Keystone's behavior.

- [#273](https://github.com/OpenSaasAU/stack/pull/273) [`bbe7f05`](https://github.com/OpenSaasAU/stack/commit/bbe7f051428013b327cbadc5fda7920d5885a6bc) Thanks [@borisno2](https://github.com/borisno2)! - Add `originalItem` parameter to `afterOperation` hooks for comparing previous and new values

  Both field-level and list-level `afterOperation` hooks now receive an `originalItem` parameter containing the item's state before the operation. This enables use cases like detecting field changes, cleaning up old files, tracking state transitions, and sending conditional notifications.

  Usage in list-level hooks:

  ```typescript
  Post: list({
    hooks: {
      afterOperation: async ({ operation, item, originalItem, context }) => {
        if (operation === 'update' && originalItem) {
          // Compare previous and new values
          if (originalItem.status !== item.status) {
            await notifyStatusChange(originalItem.status, item.status)
          }
        }
      },
    },
  })
  ```

  Usage in field-level hooks:

  ```typescript
  fields: {
    thumbnail: text({
      hooks: {
        afterOperation: async ({ operation, value, item, originalItem }) => {
          if (operation === 'update' && originalItem) {
            const oldValue = originalItem.thumbnail
            if (oldValue !== value && oldValue) {
              // Clean up old file when thumbnail changes
              await deleteFromCDN(oldValue)
            }
          }
        },
      },
    })
  }
  ```

  The `originalItem` parameter is:
  - `undefined` for `create` and `query` operations (no previous state)
  - The item before the update for `update` operations
  - The item before deletion for `delete` operations

### Patch Changes

- [#269](https://github.com/OpenSaasAU/stack/pull/269) [`ba9bfa8`](https://github.com/OpenSaasAU/stack/commit/ba9bfa80e88f125d00d621e3b7fe8e39ffaeb145) Thanks [@borisno2](https://github.com/borisno2)! - Fix select field ignoring validation.isRequired in Prisma schema generation

- [#274](https://github.com/OpenSaasAU/stack/pull/274) [`38337cc`](https://github.com/OpenSaasAU/stack/commit/38337ccc17a9c3e78b3767bf2422d0ca9ea16230) Thanks [@borisno2](https://github.com/borisno2)! - Fix hook argument types for operations

## 0.10.0

### Minor Changes

- [#259](https://github.com/OpenSaasAU/stack/pull/259) [`9aa5d8f`](https://github.com/OpenSaasAU/stack/commit/9aa5d8f60578abfdf7c36f3460b61b2fcfea6066) Thanks [@list({](https://github.com/list({), [@relationship({](https://github.com/relationship({)! - Add db.foreignKey configuration for one-to-one relationships

  Fixes issue #258 where one-to-one relationships generated invalid Prisma schemas with foreign keys on both sides. You can now explicitly control which side of a one-to-one relationship stores the foreign key.

  **Usage:**

  ```typescript
  // Specify which side has the foreign key
  lists: {

      fields: {
        account: relationship({
          ref: 'Account.user',
          db: { foreignKey: true }
        })
      }
    }),
    Account: list({
      fields: {
   ref: 'User.account' })
      }
    })
  }
  ```

  **Default behavior (without explicit db.foreignKey):**

  For one-to-one relationships without explicit configuration, the foreign key is placed on the alphabetically first list name. For example, in a `User ↔ Profile` relationship, the `Profile` model will have the `userId` foreign key.

  **Generated Prisma schema:**

  ```prisma
  model User {
    id        String   @id @default(cuid())
    accountId String?  @unique
    account   Account? @relation(fields: [accountId], references: [id])
  }

  model Account {
    id   String @id @default(cuid())
    user User?
  }
  ```

  **Validation:**
  - `db.foreignKey` can only be used on single relationships (not many-side)
  - Cannot be set to `true` on both sides of a one-to-one relationship
  - Only applies to bidirectional relationships (with target field specified)

## 0.9.0

### Minor Changes

- [#255](https://github.com/OpenSaasAU/stack/pull/255) [`8489a01`](https://github.com/OpenSaasAU/stack/commit/8489a01623fa61c1590509b88fee40071a18b0ca) Thanks [@borisno2](https://github.com/borisno2)! - Add `extendPrismaSchema` function to database configuration

  You can now modify the generated Prisma schema before it's written to disk using the `extendPrismaSchema` function in your database config. This is useful for advanced Prisma features not directly supported by the config API.

  Example usage - Add multi-schema support for PostgreSQL:

  ```typescript
  export default config({
    db: {
      provider: 'postgresql',
      prismaClientConstructor: (PrismaClient) => {
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
        const adapter = new PrismaPg(pool)
        return new PrismaClient({ adapter })
      },
      extendPrismaSchema: (schema) => {
        let modifiedSchema = schema

        // Add schemas array to datasource
        modifiedSchema = modifiedSchema.replace(
          /(datasource db \{[^}]+provider\s*=\s*"postgresql")/,
          '$1\n  schemas = ["public", "auth"]',
        )

        // Add @@schema("public") to all models
        modifiedSchema = modifiedSchema.replace(
          /^(model \w+\s*\{[\s\S]*?)(^}$)/gm,
          (match, modelContent) => {
            if (!modelContent.includes('@@schema')) {
              return `${modelContent}\n  @@schema("public")\n}`
            }
            return match
          },
        )

        return modifiedSchema
      },
    },
    // ... rest of config
  })
  ```

  Common use cases:
  - Multi-schema support for PostgreSQL
  - Custom model or field attributes
  - Prisma preview features
  - Output path modifications

## 0.8.0

### Minor Changes

- [#253](https://github.com/OpenSaasAU/stack/pull/253) [`595aa82`](https://github.com/OpenSaasAU/stack/commit/595aa82ccd93e11454b2a70cbd90e5ace2bb5ae3) Thanks [@list({](https://github.com/list({), [@relationship({](https://github.com/relationship({)! - Add support for flexible relationship refs (list-only refs)

  You can now specify relationship refs using just the list name, without requiring a corresponding field on the target list. This matches Keystone's behavior and simplifies one-way relationships.

  **Bidirectional refs** (existing behavior, still works):

  ```typescript
  lists: {

      fields: {
        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),
    Post: list({
      fields: {
   ref: 'User.posts' }),
      },
    }),
  }
  ```

  **List-only refs** (new feature):

  ```typescript
  lists: {
    Category: list({
      fields: {
        name: text(),
        // No relationship field needed!
      },
    }),
    Post: list({
      fields: {
        title: text(),
        // Just reference the list name
        category: relationship({ ref: 'Category' }),
      },
    }),
  }
  ```

  The generator automatically creates a synthetic field `from_Post_category` on the Category model with a named Prisma relation to avoid ambiguity. This is useful when you only need one-way access to the relationship.

## 0.7.0

### Minor Changes

- [#251](https://github.com/OpenSaasAU/stack/pull/251) [`6717469`](https://github.com/OpenSaasAU/stack/commit/6717469344f08e1250fed8342a05dd4b08208e92) Thanks [@borisno2](https://github.com/borisno2)! - Add support for custom scalar types in virtual fields

  Virtual fields now support custom scalar types (like Decimal for financial precision) through three approaches:

  **1. Primitive type strings (existing, unchanged):**

  ```typescript
  fields: {
    fullName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    })
  }
  ```

  **2. Import strings:**

  ```typescript
  fields: {
    totalPrice: virtual({
      type: "import('decimal.js').Decimal",
      hooks: {
        resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
      },
    })
  }
  ```

  **3. Type descriptor objects (recommended):**

  ```typescript
  import Decimal from 'decimal.js'

  fields: {
    totalPrice: virtual({
      type: { value: Decimal, from: 'decimal.js' },
      hooks: {
        resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
      },
    })
  }
  ```

  The TypeScript type generator automatically collects and generates the necessary import statements. This enables precise financial calculations and integration with third-party types while maintaining full type safety.

## 0.6.2

## 0.6.1

## 0.6.0

## 0.5.0

## 0.4.0

### Minor Changes

- [#190](https://github.com/OpenSaasAU/stack/pull/190) [`527b677`](https://github.com/OpenSaasAU/stack/commit/527b677ab598070185e23d163a9e99bc20f03c49) Thanks [@borisno2](https://github.com/borisno2)! - Fix nested operations to respect sudo mode, preventing access control checks when using context.sudo()

  When using `context.sudo()`, nested relationship operations (create, connect, update, connectOrCreate) were still enforcing access control checks, causing "Access denied" errors even when sudo mode should bypass all access control.

  This fix adds `context._isSudo` checks to all four nested operation functions in `packages/core/src/context/nested-operations.ts`:
  - `processNestedCreate()` - Now skips create access control in sudo mode
  - `processNestedConnect()` - Now skips update access control in sudo mode
  - `processNestedUpdate()` - Now skips update access control in sudo mode
  - `processNestedConnectOrCreate()` - Now skips update access control in sudo mode

  The fix ensures that when `context.sudo()` is used, all nested operations bypass access control checks while still executing hooks and validation.

  Comprehensive tests have been added to `packages/core/tests/sudo.test.ts` to verify nested operations work correctly in sudo mode.

  Fixes #134

- [#172](https://github.com/OpenSaasAU/stack/pull/172) [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d) Thanks [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({), [@list<Lists.User.TypeInfo>({](https://github.com/list<Lists.User.TypeInfo>({)! - Improve TypeScript type inference for field configs and list-level hooks by automatically passing TypeInfo from list level down

  This change eliminates the need to manually specify type parameters on field builders when using features like virtual fields, and fixes a critical bug where list-level hooks weren't receiving properly typed parameters.

  ## Field Type Inference Improvements

  Previously, users had to write `virtual<Lists.User.TypeInfo>({...})` to get proper type inference. Now TypeScript automatically infers the correct types from the list-level type parameter.

  **Example:**

  ```typescript
  // Before

    fields: {
      displayName: virtual<Lists.User.TypeInfo>({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })

  // After

    fields: {
      displayName: virtual({
        type: 'string',
        hooks: {
          resolveOutput: ({ item }) => `${item.name} (${item.email})`,
        },
      }),
    },
  })
  ```

  ## List-Level Hooks Type Inference Fix

  Fixed a critical type parameter mismatch where `Hooks<TTypeInfo>` was passing the entire TypeInfo object as the first parameter instead of properly destructuring it into three required parameters:
  1. `TOutput` - The item type (what's stored in DB)
  2. `TCreateInput` - Prisma create input type
  3. `TUpdateInput` - Prisma update input type

  **Impact:**
  - `resolveInput` now receives proper Prisma input types (e.g., `PostCreateInput`, `PostUpdateInput`)
  - `validateInput` has access to properly typed input data
  - `beforeOperation` and `afterOperation` have correct item types
  - All list-level hook callbacks now get full IntelliSense and type checking

  **Example:**

  ```typescript
  Post: list<Lists.Post.TypeInfo>({
    fields: { title: text(), content: text() },
    hooks: {
      resolveInput: async ({ operation, resolvedData }) => {
        // ✅ resolvedData is now properly typed as PostCreateInput or PostUpdateInput
        // ✅ Full autocomplete for title, content, etc.
        if (operation === 'create') {
          console.log(resolvedData.title) // TypeScript knows this is string | undefined
        }
        return resolvedData
      },
      beforeOperation: async ({ operation, item }) => {
        // ✅ item is now properly typed as Post with all fields
        if (operation === 'update' && item) {
          console.log(item.title) // TypeScript knows this is string
          console.log(item.createdAt) // TypeScript knows this is Date
        }
      },
    },
  })
  ```

  ## Breaking Changes
  - Field types now accept full `TTypeInfo extends TypeInfo` instead of just `TItem`
  - `FieldsWithItemType` utility replaced with `FieldsWithTypeInfo`
  - All field builders updated to use new type signature
  - List-level hooks now receive properly typed parameters (may reveal existing type errors)

  ## Benefits
  - ✨ Cleaner code without manual type parameter repetition
  - 🎯 Better type inference in both field-level and list-level hooks
  - 🔄 Consistent type flow from list configuration down to individual fields
  - 🛡️ Maintained full type safety with improved DX
  - 💡 Full IntelliSense support in all hook callbacks

- [#170](https://github.com/OpenSaasAU/stack/pull/170) [`3c4db9d`](https://github.com/OpenSaasAU/stack/commit/3c4db9d8318fc73d291991d8bdfa4f607c3a50ea) Thanks [@list({](https://github.com/list({)! - Add support for virtual fields with proper TypeScript type generation

  Virtual fields are computed fields that don't exist in the database but are added to query results at runtime. This feature enables derived or computed values to be included in your API responses with full type safety.

  **New Features:**
  - Added `virtual()` field type for defining computed fields in your schema
  - Virtual fields are automatically excluded from database schema and input types
  - Virtual fields appear in output types with full TypeScript autocomplete
  - Virtual fields support `resolveOutput` hooks for custom computation logic

  **Type System Improvements:**
  - Generated Context type now properly extends AccessContext from core
  - Separate Input and Output types (e.g., `UserOutput` includes virtual fields, `UserCreateInput` does not)
  - UI components now accept `AccessContext<any>` for better compatibility with custom context types
  - Type aliases provide convenience (e.g., `User = UserOutput`)

  **Example Usage:**

  ```typescript
  import { list, text, virtual } from '@opensaas/stack-core'

  export default config({
    lists: {

        fields: {
          name: text(),
          email: text(),
          displayName: virtual({
            type: 'string',
            hooks: {
              resolveOutput: async ({ item }) => {
                return `${item.name} (${item.email})`
              },
            },
          }),
        },
      }),
    },
  })
  ```

  The `displayName` field will automatically appear in query results with full TypeScript support, but won't be part of create/update operations or the database schema.

## 0.3.0

## 0.2.0

### Minor Changes

- [#132](https://github.com/OpenSaasAU/stack/pull/132) [`fcf5cb8`](https://github.com/OpenSaasAU/stack/commit/fcf5cb8bbd55d802350b8d97e342dd7f6368163b) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade to Prisma 7 with database adapter support

  ## Breaking Changes

  ### Required `prismaClientConstructor`

  Prisma 7 requires database adapters. All configs must now include `prismaClientConstructor`:

  ```typescript
  import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'
  import Database from 'better-sqlite3'

  export default config({
    db: {
      provider: 'sqlite',
      prismaClientConstructor: (PrismaClient) => {
        const db = new Database(process.env.DATABASE_URL || './dev.db')
        const adapter = new PrismaBetterSQLite3(db)
        return new PrismaClient({ adapter })
      },
    },
  })
  ```

  ### Removed `url` from `DatabaseConfig`

  The `url` field has been removed from the `DatabaseConfig` type. Database connection URLs are now passed directly to adapters in `prismaClientConstructor`:

  ```typescript
  // ❌ Before (Prisma 6)
  db: {
    provider: 'sqlite',
    url: 'file:./dev.db',  // url in config
  }

  // ✅ After (Prisma 7)
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSQLite3({ url: './dev.db' })  // url in adapter
      return new PrismaClient({ adapter })
    },
  }
  ```

  ### Generated Schema Changes
  - Generator provider changed from `prisma-client-js` to `prisma-client`
  - Removed `url` field from datasource block
  - Database URL now passed via adapter in `prismaClientConstructor`

  ### Required Dependencies

  Install the appropriate adapter for your database:
  - **SQLite**: `@prisma/adapter-better-sqlite3` + `better-sqlite3`
  - **PostgreSQL**: `@prisma/adapter-pg` + `pg`
  - **MySQL**: `@prisma/adapter-mysql` + `mysql2`

  ## Migration Steps
  1. Install Prisma 7 and adapter:

     ```bash
     pnpm add @prisma/client@7 @prisma/adapter-better-sqlite3 better-sqlite3
     pnpm add -D prisma@7
     ```

  2. Update your `opensaas.config.ts` to include `prismaClientConstructor` (see example above)
  3. Regenerate schema and client:

     ```bash
     pnpm generate
     npx prisma generate
     ```

  4. Push schema to database:
     ```bash
     pnpm db:push
     ```

  See the updated documentation in CLAUDE.md for more examples including PostgreSQL and custom adapters.

- [#121](https://github.com/OpenSaasAU/stack/pull/121) [`3851a3c`](https://github.com/OpenSaasAU/stack/commit/3851a3cf72e78dc6f01a73c6fff97deca6fad043) Thanks [@borisno2](https://github.com/borisno2)! - Add strongly-typed session support via module augmentation

  This change enables developers to define custom session types with full TypeScript autocomplete and type safety throughout their OpenSaas applications using the module augmentation pattern.

  **Core Changes:**
  - Converted `Session` from `type` to `interface` to enable module augmentation
  - Updated all session references to properly handle `Session | null`
  - Added comprehensive JSDoc documentation with module augmentation examples
  - Updated `AccessControl`, `AccessContext`, and access control engine to support nullable sessions
  - Added "Session Typing" section to core package documentation

  **Auth Package:**
  - Added "Session Type Safety" section to documentation
  - Documented how Better Auth users can create session type declarations
  - Provided step-by-step guide for matching sessionFields to TypeScript types
  - Created `getSession()` helper pattern for transforming Better Auth sessions

  **Developer Experience:**

  Developers can now augment the `Session` interface to get autocomplete everywhere:

  ```typescript
  // types/session.d.ts
  import '@opensaas/stack-core'

  declare module '@opensaas/stack-core' {
    interface Session {
      userId?: string
      email?: string
      role?: 'admin' | 'user'
    }
  }
  ```

  This provides autocomplete in:
  - Access control functions
  - Hooks (resolveInput, validateInput, etc.)
  - Context object
  - Server actions

  **Benefits:**
  - Zero boilerplate - module augmentation provides types everywhere automatically
  - Full type safety for session properties
  - Autocomplete in all contexts that use session
  - Developer controls session shape (no assumptions about structure)
  - Works with any auth provider (Better Auth, custom, etc.)
  - Fully backward compatible - existing code continues to work
  - Follows TypeScript best practices (similar to NextAuth.js pattern)

  **Example:**

  ```typescript
  // Before: No autocomplete
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ❌ 'role' is 'unknown'
  }

  // After: Full autocomplete and type checking
  const isAdmin: AccessControl = ({ session }) => {
    return session?.role === 'admin' // ✅ Autocomplete + type checking
    //             ↑ Shows: userId, email, role
  }
  ```

  **Migration:**

  No migration required - this is a fully backward compatible change. Existing projects continue to work with untyped sessions. Projects can opt-in to typed sessions by creating a `types/session.d.ts` file with module augmentation.

### Patch Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - Add strict typing for plugin runtime services

  This change implements fully typed plugin runtime services, providing autocomplete and type safety for `context.plugins` throughout the codebase.

  **Core Changes:**
  - Extended `Plugin` type with optional `runtimeServiceTypes` metadata for type-safe code generation
  - Converted `OpenSaasConfig` and `AccessContext` from `type` to `interface` to enable module augmentation
  - Plugins can now declare their runtime service type information

  **Auth Plugin:**
  - Added `AuthRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.auth.getUser()` and `context.plugins.auth.getCurrentUser()`

  **RAG Plugin:**
  - Added `RAGRuntimeServices` interface defining runtime service types
  - Exported runtime types from package
  - Users now get full autocomplete for `context.plugins.rag.generateEmbedding()` and `context.plugins.rag.generateEmbeddings()`

  **CLI Generator:**
  - Enhanced plugin types generator to import and use plugin runtime service types
  - Generated `.opensaas/plugin-types.ts` now includes proper type imports
  - `PluginServices` interface extends `Record<string, Record<string, any> | undefined>` for type compatibility
  - Maintains backwards compatibility with plugins that don't provide type metadata

  **UI Package:**
  - Updated `AdminUI` props to accept contexts with typed plugin services
  - Ensures compatibility between generated context types and UI components

  **Benefits:**
  - Full TypeScript autocomplete for all plugin runtime methods
  - Compile-time type checking catches errors early
  - Better IDE experience with hover documentation and jump-to-definition
  - Backwards compatible - third-party plugins without type metadata continue to work
  - Zero type errors in examples

  **Example:**

  ```typescript
  const context = await getContext()

  // Fully typed with autocomplete
  context.plugins.auth.getUser('123') // (userId: string) => Promise<unknown>
  context.plugins.rag.generateEmbedding('text') // (text: string, providerName?: string) => Promise<number[]>
  ```

## 0.1.7

### Patch Changes

- 372d467: Add sudo to context to bypass access control

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- 39996ca: Add plugin mechanism

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls

## 0.1.4

### Patch Changes

- d013859: **BREAKING CHANGE**: Migrate MCP functionality into core and auth packages

  The `@opensaas/stack-mcp` package has been deprecated and its functionality has been split into:
  - `@opensaas/stack-core/mcp` - Auth-agnostic MCP runtime and handlers
  - `@opensaas/stack-auth/mcp` - Better Auth OAuth adapter

  **Migration required:**

  ```typescript
  // Before
  import { createMcpHandlers } from '@opensaas/stack-mcp'
  const { GET, POST, DELETE } = createMcpHandlers({ config, auth, getContext })

  // After
  import { createMcpHandlers } from '@opensaas/stack-core/mcp'
  import { createBetterAuthMcpAdapter } from '@opensaas/stack-auth/mcp'
  const { GET, POST, DELETE } = createMcpHandlers({
    config,
    getSession: createBetterAuthMcpAdapter(auth),
    getContext,
  })
  ```

  **Why this change?**
  - Reduces package count in the monorepo
  - Core package handles auth-agnostic MCP protocol
  - Auth package provides Better Auth specific adapter
  - Better-auth is no longer a dependency of core
  - Enables support for custom auth providers beyond Better Auth

  **New features:**
  - `McpSessionProvider` type for custom auth integration
  - More generic `McpAuthConfig` type supporting custom auth providers
  - Core MCP functionality available without auth dependencies

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- 9a3fda5: Add JSON field
- f8ebc0e: Add base mcp server
- 045c071: Add field and image upload
