# @opensaas/stack-cli

## 0.41.0

### Patch Changes

- Updated dependencies [[`2260539`](https://github.com/OpenSaasAU/stack/commit/2260539c5488dae0ee6e7f86ccd913e5c898ccdb), [`aa34cca`](https://github.com/OpenSaasAU/stack/commit/aa34cca65877759b9625da1538c65c53ed54385a), [`182153c`](https://github.com/OpenSaasAU/stack/commit/182153cb976b14ef67673d0eeef7925d950bfa10), [`67dce2e`](https://github.com/OpenSaasAU/stack/commit/67dce2e9d96afdc5c69f0a2f1c8b395346d4e942), [`682795f`](https://github.com/OpenSaasAU/stack/commit/682795f7c7f0d0194ffd08e993d452c368bcd847), [`73d1b6a`](https://github.com/OpenSaasAU/stack/commit/73d1b6aba9a9b789a8111105d56257a1de66a883), [`f1e8792`](https://github.com/OpenSaasAU/stack/commit/f1e8792ce580d92a5874599dfb8a8ccde4d6c8b3), [`9eb7c77`](https://github.com/OpenSaasAU/stack/commit/9eb7c7766d212e92b02d53a1ba3aaead4faf1496), [`5b478de`](https://github.com/OpenSaasAU/stack/commit/5b478de64f3564d837d2f9f912972e49008be884), [`d335122`](https://github.com/OpenSaasAU/stack/commit/d335122323b3402c0838aa50873fab0c085fbb01)]:
  - @opensaas/stack-core@0.41.0

## 0.40.0

### Minor Changes

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

- [#967](https://github.com/OpenSaasAU/stack/pull/967) [`ca20d45`](https://github.com/OpenSaasAU/stack/commit/ca20d458e969f964bb792331c9ec181314093431) Thanks [@borisno2](https://github.com/borisno2)! - Clean up stale/restating comments in migration, MCP, and commands source per CLAUDE.md's Comments rule. No behavior changes.

- [#968](https://github.com/OpenSaasAU/stack/pull/968) [`026489c`](https://github.com/OpenSaasAU/stack/commit/026489c8fe34aaf1a29a93a882d4a57cca42bce0) Thanks [@borisno2](https://github.com/borisno2)! - Clean up restating/duplicated comments in `packages/cli/src/generator/` per the CLAUDE.md Comments rule. No behavior change.
- Updated dependencies [[`8e6707a`](https://github.com/OpenSaasAU/stack/commit/8e6707adcca9d7e062bc1747ec79a29082c09ef9), [`afd1a60`](https://github.com/OpenSaasAU/stack/commit/afd1a60a6ddaa558bf14887e45fa1c007e6669b0), [`b30fa61`](https://github.com/OpenSaasAU/stack/commit/b30fa6135a6acca8c9be99fbdf5ffa7faab1959f), [`16da817`](https://github.com/OpenSaasAU/stack/commit/16da8176114826d18d6747d27abedf75de6c3262), [`51ae299`](https://github.com/OpenSaasAU/stack/commit/51ae299b7624f97e890f85b3075c62d8e114cec2), [`f85c7d1`](https://github.com/OpenSaasAU/stack/commit/f85c7d1b92e76d5e8ae090f93c0ff94e0d6c36c1), [`0f2e12a`](https://github.com/OpenSaasAU/stack/commit/0f2e12a69710e759d8749b8536fd5b31836226e9), [`05c747a`](https://github.com/OpenSaasAU/stack/commit/05c747a18284ac769860f751a660b72591570571), [`0b5b51e`](https://github.com/OpenSaasAU/stack/commit/0b5b51e52787ea9e945206a109a7a56dc38e78e5), [`4ce64b4`](https://github.com/OpenSaasAU/stack/commit/4ce64b4f9868eca0f34cc0676e46440b3d8f16ce), [`48d2762`](https://github.com/OpenSaasAU/stack/commit/48d27626dfb636c481301116e46c826ef3156124), [`9de43c8`](https://github.com/OpenSaasAU/stack/commit/9de43c80c8ef996dc6f08f68f7c1d8451aa0f10e), [`52dfdd2`](https://github.com/OpenSaasAU/stack/commit/52dfdd2c051aa2f4b4cbd96a459213c34c3bf85c)]:
  - @opensaas/stack-core@0.40.0

## 0.39.2

### Patch Changes

- [#960](https://github.com/OpenSaasAU/stack/pull/960) [`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6) Thanks [@borisno2](https://github.com/borisno2)! - Remove the generated `prisma-extensions.ts` module and its unreachable `$extends` branch in the generated context factory — the guard deciding whether to apply it was always true, so the extension never actually ran (`context.db` already applies `resolveOutput` correctly). This also fixes `TS2589: Type instantiation is excessively deep` on larger schemas, since the removed branch's inferred type was the cause. No runtime behavior changes; regenerating cleans up a stale `prisma-extensions.ts` left by prior versions.
- Updated dependencies [[`77ca919`](https://github.com/OpenSaasAU/stack/commit/77ca91931bc3de4051c1a40cc00b77158b8192e6)]:
  - @opensaas/stack-core@0.39.2

## 0.39.1

### Patch Changes

- [#955](https://github.com/OpenSaasAU/stack/pull/955) [`ab2bc34`](https://github.com/OpenSaasAU/stack/commit/ab2bc34539bc06d9946933061284480185753edc) Thanks [@borisno2](https://github.com/borisno2)! - Fix `TS2589: Type instantiation is excessively deep` in the generated `Context`/`CustomDB` types once a schema grows past ~7-8 lists. `CustomDB`/`BaseContext`/`Context` are now generated as `interface`s (with each list's CRUD methods extracted to a named `{List}Crud` interface) instead of `type` aliases, so `Context.sudo()`'s self-reference no longer forces eager re-expansion of the whole database type ([#952](https://github.com/OpenSaasAU/stack/issues/952)).

- [#950](https://github.com/OpenSaasAU/stack/pull/950) [`fcc5380`](https://github.com/OpenSaasAU/stack/commit/fcc538020789e46555638b81fa7b7c11ceff08a8) Thanks [@borisno2](https://github.com/borisno2)! - Fix `resolveTsconfigAlias` corrupting resolution of `opensaas.config.ts` and its whole import closure when `tsconfig.json` has a bare `"*"` path pattern (e.g. `{ "*": ["./src/*"] }`, a common catch-all for unprefixed imports like `lib/utils`). The bare pattern now produces an empty alias key, which jiti's prefix-based resolution would otherwise match against every specifier; it is now skipped and reported as a warning like other unrepresentable path entries.
- Updated dependencies []:
  - @opensaas/stack-core@0.39.1

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

- [#932](https://github.com/OpenSaasAU/stack/pull/932) [`5400956`](https://github.com/OpenSaasAU/stack/commit/5400956c79c0e2f2bc1a70e976ad27f28be54688) Thanks [@borisno2](https://github.com/borisno2)! - Resolve `tsconfig.json` path aliases (`compilerOptions.paths`) when loading `opensaas.config.ts`, so a value import using an alias (e.g. `@/*`) works in the config and anywhere in its import closure, not just in type-only positions.

  ```typescript
  // tsconfig.json
  {
    "compilerOptions": {
      "paths": { "@/*": ["./src/*"] }
    }
  }

  // opensaas.config.ts
  import { lists } from '@/opensaas/lists' // now resolves
  ```

  Only the single-trailing-`*`, single-target form of `paths` is translated; an entry with multiple candidate targets or an unsupported pattern shape logs a warning naming the pattern and is skipped rather than failing generation. Projects without a `tsconfig.json`, or without `paths`, are unaffected. The `opensaas migrate` command's Keystone config loader resolves aliases the same way.

### Patch Changes

- [#927](https://github.com/OpenSaasAU/stack/pull/927) [`bbf8843`](https://github.com/OpenSaasAU/stack/commit/bbf8843567f0b95689589c53d3ceb9e3eb00adca) Thanks [@borisno2](https://github.com/borisno2)! - Fix migration introspector mapping Prisma/Keystone `Decimal` columns to `text()` instead of `decimal()`. Declared `@db.Decimal(precision, scale)` attributes now carry through to the generated field.

- [#931](https://github.com/OpenSaasAU/stack/pull/931) [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102) Thanks [@borisno2](https://github.com/borisno2)! - `db.indexes` generation now fails with a descriptive error for an empty `fields` array, and for a single-field entry that duplicates a column already indexed by that field's own `isIndexed` — previously these silently produced invalid or duplicate Prisma.

- Updated dependencies [[`5e546b0`](https://github.com/OpenSaasAU/stack/commit/5e546b0fe3542ba41fc77e0a4628acc96eec13ea), [`cbb03fc`](https://github.com/OpenSaasAU/stack/commit/cbb03fc26047869d23513fbb156c6194d9be389b), [`5f00c3a`](https://github.com/OpenSaasAU/stack/commit/5f00c3a456295a1125281a4227309a8f8c6d853d), [`6f9a64d`](https://github.com/OpenSaasAU/stack/commit/6f9a64d2f25212e91181adc2b67add326a540f6a), [`9a399d6`](https://github.com/OpenSaasAU/stack/commit/9a399d68e4d3f384d4cef5ccd5fc8ec6802a40a5), [`05c9ad4`](https://github.com/OpenSaasAU/stack/commit/05c9ad40f8c4e76718d870e0c1c02511a3475943), [`4d8b654`](https://github.com/OpenSaasAU/stack/commit/4d8b654d099ce13d00893ebc4ce904fa69f2c47a), [`e0baadd`](https://github.com/OpenSaasAU/stack/commit/e0baaddade059cfea639d232f6953fc8c339f6f4), [`ab4a5dd`](https://github.com/OpenSaasAU/stack/commit/ab4a5ddd83eebcf85d4a98f210cd378b974725f5), [`94802ee`](https://github.com/OpenSaasAU/stack/commit/94802eee3b2fdc64fab4b576945820a6df9311c5), [`114302b`](https://github.com/OpenSaasAU/stack/commit/114302b95129484fadb6a1a640435ab1a5d2d102)]:
  - @opensaas/stack-core@0.39.0

## 0.38.0

### Minor Changes

- [#889](https://github.com/OpenSaasAU/stack/pull/889) [`b9b9357`](https://github.com/OpenSaasAU/stack/commit/b9b935719774b01a81cfd2082387b76806c1a484) Thanks [@borisno2](https://github.com/borisno2)! - Fix `getSessionFromAuth` to project `sessionFields` from the _resolved_ better-auth session instead of only its `user` sub-object. A `customSession` plugin's replaced shape with no `user` key is now correctly treated as a signed-in session (never misreported as anonymous), and a session-only field (e.g. the admin plugin's `impersonatedBy`) is now resolvable. Errors from the underlying session lookup now propagate instead of silently becoming `null`, and a `sessionFields` entry that can't be resolved is omitted and logs a warning (once per field, per process) instead of vanishing silently.

  The scaffolded `getSession()` — the CLI feature generator's `lib/auth.ts` template, and `examples/starter-auth`/`examples/auth-demo` — now call this single shared helper, reading `sessionFields` from the resolved config at runtime instead of baking a field list in at generation time. `examples/auth-demo`'s `getSession()` also now correctly returns `null` for an anonymous visitor (previously returned a truthy object of `undefined` values).

  ```typescript
  authPlugin({ sessionFields: ['userId', 'email', 'name', 'role'] })
  ```

  ```typescript
  // lib/auth.ts
  export async function getSession() {
    const resolvedConfig = await config
    const authConfig = resolvedConfig._pluginData?.auth as NormalizedAuthConfig | undefined
    const sessionFields = authConfig?.sessionFields ?? ['userId', 'email', 'name']
    return getSessionFromAuth(auth, sessionFields, await headers())
  }
  ```

### Patch Changes

- Updated dependencies [[`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68), [`b21d8b2`](https://github.com/OpenSaasAU/stack/commit/b21d8b2af43f7a2a7ea10a89cfb39140a856bd68), [`17eb72f`](https://github.com/OpenSaasAU/stack/commit/17eb72f0a9a4b7508e3f318da66bb8d4c6cbd705)]:
  - @opensaas/stack-core@0.38.0

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

### Patch Changes

- Updated dependencies [[`6bf9dcb`](https://github.com/OpenSaasAU/stack/commit/6bf9dcb1b8d030d57371b6b4a4f55462eb8ab2eb), [`7b6189f`](https://github.com/OpenSaasAU/stack/commit/7b6189fa60119a45082ba62dd71d915d93de529c)]:
  - @opensaas/stack-core@0.37.0

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
- Updated dependencies [[`cdca174`](https://github.com/OpenSaasAU/stack/commit/cdca17444a5259cd0d3d8604a90a2cea4566cda2), [`ebb4cd3`](https://github.com/OpenSaasAU/stack/commit/ebb4cd3515ff40f960f888e7b4147d1d089a0966)]:
  - @opensaas/stack-core@0.36.0

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

### Patch Changes

- Updated dependencies [[`d0c94a9`](https://github.com/OpenSaasAU/stack/commit/d0c94a994e8be67742c97b6757ca4dd4e454f682)]:
  - @opensaas/stack-core@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [[`fedc858`](https://github.com/OpenSaasAU/stack/commit/fedc858f41bf5cacf001f64e7b710112f2fce20b)]:
  - @opensaas/stack-core@0.34.0

## 0.33.0

### Patch Changes

- Updated dependencies [[`0caf680`](https://github.com/OpenSaasAU/stack/commit/0caf68007e41b69f1a5d5f74fb15df2548a559dc), [`1a3f51d`](https://github.com/OpenSaasAU/stack/commit/1a3f51d5837d6e5244ccf04c3d14c41c264701c3)]:
  - @opensaas/stack-core@0.33.0

## 0.32.0

### Minor Changes

- [#813](https://github.com/OpenSaasAU/stack/pull/813) [`5a6198c`](https://github.com/OpenSaasAU/stack/commit/5a6198c9489641e4b1ad542a3181c15e750f7d85) Thanks [@borisno2](https://github.com/borisno2)! - Auth forms now submit through app-owned server actions instead of the browser `authClient`

  The pre-built auth forms (`SignInForm`, `SignUpForm`, `ForgotPasswordForm`, and the new
  `ResetPasswordForm`) no longer take an `authClient` prop that calls `/api/auth/*` from the
  browser. Instead each form takes **server action** props — `'use server'` functions the app
  defines against its own `auth` instance. This keeps the auth network surface server-side and
  matches the app's existing `lib/actions/*` convention. `createAuth` now auto-adds
  better-auth's `nextCookies` plugin, so the session cookie set inside a server action persists.
  See ADR-0020.

  The package exports the action contract types (`AuthActionResult`, `SignInInput`,
  `SignUpInput`, `RequestPasswordResetInput`, `ResetPasswordInput`, and the action aliases).
  `createClient` is unchanged for client-side session reading (`useSession`).

  Migration — define the actions in your app and pass them to the forms:

  ```typescript
  // lib/actions/auth.ts
  'use server'
  import { headers } from 'next/headers'
  import { auth } from '@/lib/auth'
  import type { AuthActionResult, SignInInput } from '@opensaas/stack-auth/ui'

  export async function signInAction(input: SignInInput): Promise<AuthActionResult> {
    try {
      await auth.api.signInEmail({
        body: { email: input.email, password: input.password },
        headers: await headers(),
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Sign in failed' }
    }
  }
  ```

  ```tsx
  // Before
  <SignInForm authClient={authClient} redirectTo="/admin" />

  // After
  <SignInForm signInAction={signInAction} redirectTo="/admin" />
  ```

  Social sign-in becomes a redirecting server action passed as `signInSocialAction`. The CLI
  feature-generator now scaffolds `lib/actions/auth.ts` and a `reset-password` page, and no
  longer emits `lib/auth-client.ts`.

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.32.0

## 0.31.1

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.31.1

## 0.31.0

### Patch Changes

- Updated dependencies [[`047487a`](https://github.com/OpenSaasAU/stack/commit/047487adf502f10f7f6774ff52c38c70d465f533), [`9cd06dd`](https://github.com/OpenSaasAU/stack/commit/9cd06dddb45512966affc3a6b3455e97595c0de2), [`b190813`](https://github.com/OpenSaasAU/stack/commit/b190813a4531bd01b3206845b2c531099e0a204a), [`f67cd79`](https://github.com/OpenSaasAU/stack/commit/f67cd798724712a90d7ada8f28202d3d6371693f), [`dcb10e2`](https://github.com/OpenSaasAU/stack/commit/dcb10e27c28a8a8f9a5e625f550ac5c750436eb6), [`f8b6f02`](https://github.com/OpenSaasAU/stack/commit/f8b6f02c18322d0d04a7c3cc82e579d0ba9a2da9), [`c05701e`](https://github.com/OpenSaasAU/stack/commit/c05701e523815b8f411a6d39e57bbb9317dc2a9d), [`5a60291`](https://github.com/OpenSaasAU/stack/commit/5a602916f30535604b590b875c363f21930a109f), [`2fcb582`](https://github.com/OpenSaasAU/stack/commit/2fcb5820bc00d9d432265d1ba01404097e296e8e), [`85c7fc3`](https://github.com/OpenSaasAU/stack/commit/85c7fc3b3a0090a986cafa0e46b1798f237264da), [`8199238`](https://github.com/OpenSaasAU/stack/commit/81992382290f356071955f16efd14f7771045a16), [`4d99e91`](https://github.com/OpenSaasAU/stack/commit/4d99e910b61c6196564a7248abf3d32b1d6be883), [`20459b5`](https://github.com/OpenSaasAU/stack/commit/20459b5a7f8b2578342509442d36017cfa2f08f6), [`62a1612`](https://github.com/OpenSaasAU/stack/commit/62a16127c7b6610a35fb239911eff3486de585be), [`c210319`](https://github.com/OpenSaasAU/stack/commit/c210319c3b25ff74d832d3c2ec5d3253d5d8b832), [`55d55e0`](https://github.com/OpenSaasAU/stack/commit/55d55e0a1ed9521b6e31283524d9194a9420059a), [`96e1067`](https://github.com/OpenSaasAU/stack/commit/96e1067661c7ebc8e23896086fec7428e475dd03)]:
  - @opensaas/stack-core@0.31.0

## 0.30.0

### Minor Changes

- [#744](https://github.com/OpenSaasAU/stack/pull/744) [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e) Thanks [@borisno2](https://github.com/borisno2)! - MCP feature wizards now generate current-API code for all five features

  - `comments`, `file-upload`, and `semantic-search` wizards previously returned "coming soon" stubs — they now generate real config (Comment list with moderation/threading, storage config with local/S3/R2/Vercel Blob providers, ragPlugin with OpenAI or Ollama embeddings and `searchable()` fields).
  - The `authentication` wizard output was rewritten to the current API: `authPlugin` with `socialProviders`/`extendUserList`/`access` (ADR-0013), the required `prismaClientConstructor`, `SignInForm`/`SignUpForm` with the `authClient` prop, and `lib/auth.ts` wiring via `createAuth(config, rawOpensaasContext)`.
  - The `blog` wizard now emits valid `select()` options, wires Category/Tag relationships on both sides, and uses filter-based query access.
  - `opensaas mcp start` no longer prints its startup banner to stdout, which corrupted the MCP stdio JSON-RPC stream.
  - Removed unsupported options from wizard catalogs (Cohere/Anthropic embeddings, magic links) and fixed the docs provider's field-type guidance (`json()` mapping, `getPrismaType` modifiers).

### Patch Changes

- [#741](https://github.com/OpenSaasAU/stack/pull/741) [`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39) Thanks [@borisno2](https://github.com/borisno2)! - Update documentation links to the restructured docs site URLs (Diátaxis layout)

- Updated dependencies [[`afa865f`](https://github.com/OpenSaasAU/stack/commit/afa865f62ed7968b494a87e0621cf71bacd36f39), [`5e135ef`](https://github.com/OpenSaasAU/stack/commit/5e135ef635dd7cd97ab106f46fbf808250aa079e)]:
  - @opensaas/stack-core@0.30.0

## 0.29.0

### Patch Changes

- Updated dependencies [[`f51cef8`](https://github.com/OpenSaasAU/stack/commit/f51cef876d6376e4e2bc8ac990229ff60e232bb1), [`56e9f9b`](https://github.com/OpenSaasAU/stack/commit/56e9f9b0a4d1920662cf0564682e767993917b56)]:
  - @opensaas/stack-core@0.29.0

## 0.28.0

### Patch Changes

- [#696](https://github.com/OpenSaasAU/stack/pull/696) [`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e) Thanks [@borisno2](https://github.com/borisno2)! - Note in the generated Keystone auth migration guide that Auth-injected lists now ship closed by default (ADR-0013) and how to grant them access via `authPlugin({ access: { ... } })`.

- [#691](https://github.com/OpenSaasAU/stack/pull/691) [`7f113a9`](https://github.com/OpenSaasAU/stack/commit/7f113a9c454a9c92ca4769687832da661acf250a) Thanks [@borisno2](https://github.com/borisno2)! - Fix misleading doc comment on the generated `rawOpensaasContext` export: it's a `Promise<Context>` meant to be passed to a lazy-Proxy consumer (e.g. `createAuth`), not a synchronous value.

- [#694](https://github.com/OpenSaasAU/stack/pull/694) [`529fa98`](https://github.com/OpenSaasAU/stack/commit/529fa984cccab50ba88cf22c69431e9f5f927f8a) Thanks [@borisno2](https://github.com/borisno2)! - Preserve host-added `datasource` keys (e.g. `shadowDatabaseUrl`) in `prisma.config.ts` across `generate` runs instead of overwriting the block wholesale.

- Updated dependencies [[`0bcfb4a`](https://github.com/OpenSaasAU/stack/commit/0bcfb4a6f1183ee75017bee73566f5aaa3b5408e), [`aec907f`](https://github.com/OpenSaasAU/stack/commit/aec907f29b31ca507831d729182938975ec4b4fa), [`fd64913`](https://github.com/OpenSaasAU/stack/commit/fd64913ac65ed60440eaee210a34a6f8e3824c21)]:
  - @opensaas/stack-core@0.28.0

## 0.27.1

### Patch Changes

- Updated dependencies [[`1bd4f12`](https://github.com/OpenSaasAU/stack/commit/1bd4f1258f9b3ac77ca048ac657ee31b0299821f)]:
  - @opensaas/stack-core@0.27.1

## 0.27.0

### Patch Changes

- [#664](https://github.com/OpenSaasAU/stack/pull/664) [`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f) Thanks [@borisno2](https://github.com/borisno2)! - Upgrade TypeScript to v7. `typescript` now resolves to the `@typescript/typescript6` compatibility shim (keeping the classic compiler API available for `typescript-eslint` and Next.js's build-time type-checking, neither of which support TS 7's restructured package yet), while `@typescript-eslint/eslint-plugin` is bumped to 8.63.0 to match. The CLI's Node-build compiler step (ADR-0011) now shells out to `tsc` instead of the removed synchronous `Program` API, using its own pinned native TS 7 binary via a new `@typescript/native` dependency.

- Updated dependencies [[`37838ef`](https://github.com/OpenSaasAU/stack/commit/37838efbf726b27baa5e1da448d44223c6953e3f), [`18c39c8`](https://github.com/OpenSaasAU/stack/commit/18c39c8b8ffc0b0c5c4551385bb67054448e5781), [`9d9c7f8`](https://github.com/OpenSaasAU/stack/commit/9d9c7f8e5afd0b4afb01dc40cb16217f8d675354), [`002e755`](https://github.com/OpenSaasAU/stack/commit/002e755ca405c23127b3c88378955127cc8b3f67), [`a15e566`](https://github.com/OpenSaasAU/stack/commit/a15e5660d736c8ea2d4b804c5ef6891510b2ea3d)]:
  - @opensaas/stack-core@0.27.0

## 0.26.0

### Patch Changes

- Updated dependencies [[`322d5b6`](https://github.com/OpenSaasAU/stack/commit/322d5b64d11c3e3401493511e0c0e3a1fa20e210), [`0be254e`](https://github.com/OpenSaasAU/stack/commit/0be254e2b2e6bbc0c2f168438aea49d2e1cc7f0b)]:
  - @opensaas/stack-core@0.26.0

## 0.25.0

### Minor Changes

- [#606](https://github.com/OpenSaasAU/stack/pull/606) [`801230e`](https://github.com/OpenSaasAU/stack/commit/801230e1a95efc17c8bec46c7094f0b72956f54b) Thanks [@borisno2](https://github.com/borisno2)! - Enforce field-level scalar narrowing at the write call site, and fix `checkbox({ defaultValue: false })` optionality

  The generated `context.db.<list>.create()/update()/createMany()/updateMany()` `data`
  type now narrows scalar fields to their OpenSaaS `getTypeScriptType()` types instead of
  inheriting Prisma's wider input types. Field-level narrowing (e.g. `calendarDay` → `string`)
  is now a genuine compile-time error to violate, not just a runtime validation failure.

  ```ts
  // calendarDay is a `string` end-to-end:
  await context.db.event.create({ data: { startDate: new Date() } })
  //                                                  ^^^^^^^^^^ Type 'Date' is not assignable to type 'string'.
  await context.db.event.create({ data: { startDate: '2026-01-01' } }) // ✅ compiles
  ```

  Relationship nested writes (`connect`/`create`/`connectOrCreate`), unchecked foreign keys
  (e.g. `authorId`), and `decimal`/`json` writes are unaffected: `decimal` still accepts
  `Decimal | number | string` and `json` still accepts Prisma's `JsonNull`/`DbNull` sentinels.

  Also fixes a latent bug where `checkbox({ defaultValue: false })` (and any field with a
  falsy-but-present default) was generated as a required field on create — it is now correctly
  optional.

  Note: this may surface pre-existing type errors in consumer code that passed a `Date` to a
  `calendarDay` field. Such code already failed at runtime; it now fails at compile time. Pass a
  `YYYY-MM-DD` string instead.

- [#609](https://github.com/OpenSaasAU/stack/pull/609) [`1d79fe6`](https://github.com/OpenSaasAU/stack/commit/1d79fe6aad79a3598ebb2ca973d9936757b25c1f) Thanks [@borisno2](https://github.com/borisno2)! - Consolidate nullability between the standalone `{List}CreateInput`/`{List}UpdateInput` exports and the call-site write-`data` override into a single source of truth ([#608](https://github.com/OpenSaasAU/stack/issues/608)).

  The generated types previously described a list's create/update input shape in two places that disagreed on how a nullable scalar was represented: the write-`data` override emitted `name?: string | null` (matching Prisma's nullable-column input) while the standalone `{List}CreateInput`/`{List}UpdateInput` emitted `name?: string`. Both paths now render each scalar member through one shared helper, so a nullable scalar is consistently `name?: T | null` in every input representation. Required scalars stay required, and `decimal`/`json`/relationship/multi-column handling is unchanged.

  This is a non-breaking type refinement, but if you assigned the standalone `{List}CreateInput`/`{List}UpdateInput` types into a stricter local type, a nullable scalar may now be inferred as `T | null`:

  ```typescript
  // A nullable text() field on Post now generates:
  export type PostCreateInput = {
    title: string // required scalar — unchanged
    content?: string | null // nullable scalar — now includes `| null`
  }
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

### Patch Changes

- [#606](https://github.com/OpenSaasAU/stack/pull/606) [`801230e`](https://github.com/OpenSaasAU/stack/commit/801230e1a95efc17c8bec46c7094f0b72956f54b) Thanks [@borisno2](https://github.com/borisno2)! - Remove unused getRelatedListName helper from the types generator (dead code, no behavior change)

- [#591](https://github.com/OpenSaasAU/stack/pull/591) [`c741055`](https://github.com/OpenSaasAU/stack/commit/c74105548aadb9991a4cded3b12d9c1a5b0dcd0c) Thanks [@borisno2](https://github.com/borisno2)! - Fix `tsc` failure in generated `prisma-extensions.ts` for multi-column storage fields in `db: { columns: 'keystone' }` mode. The result extension's `needs` now references the physical part columns (e.g. `image_url`, `image_pathname`, …) derived from the field's `getColumnNames`, instead of the logical field name which has no scalar on the model (previously typed `true` against `never`). This removes the last error forcing `@ts-nocheck` on the generated bundle ([#559](https://github.com/OpenSaasAU/stack/issues/559)).

- Updated dependencies [[`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9), [`be9a896`](https://github.com/OpenSaasAU/stack/commit/be9a8965ad6338c279e99cfe3bf24162e63ffb92), [`e39d6e9`](https://github.com/OpenSaasAU/stack/commit/e39d6e9e37be2337c8cf1979053e76877f14296c), [`fadd9db`](https://github.com/OpenSaasAU/stack/commit/fadd9dbd17085f4dd15899371a054ec46f943ce4), [`4f0d407`](https://github.com/OpenSaasAU/stack/commit/4f0d40721feff1a3109647a81fcbe47db5970026), [`e355c05`](https://github.com/OpenSaasAU/stack/commit/e355c05a0787980b997609c4571271ab5c250f36), [`ca4973b`](https://github.com/OpenSaasAU/stack/commit/ca4973b504eadb123d179e8f4d16d6ec8c9f8fc1), [`44ec937`](https://github.com/OpenSaasAU/stack/commit/44ec9375baa4dacab4e34b03cbefb27c8aec07c9), [`ecbf834`](https://github.com/OpenSaasAU/stack/commit/ecbf834059a072c428b0739d6ebcf4c74be8c893), [`a93cebb`](https://github.com/OpenSaasAU/stack/commit/a93cebb5a6ba6550d8cdbb94f010c902ad7e29f1), [`481d6e0`](https://github.com/OpenSaasAU/stack/commit/481d6e00be90b1159b0b30eff015e5079c840158), [`4622b5f`](https://github.com/OpenSaasAU/stack/commit/4622b5fa8fc731e2c8995011f1be0cfe341578da), [`b17ec45`](https://github.com/OpenSaasAU/stack/commit/b17ec45127fe55f02437892e9fd389c67373635a), [`8f98e25`](https://github.com/OpenSaasAU/stack/commit/8f98e25fbef4ec0fc3ff0cba456ff7f2f7ba2ea8)]:
  - @opensaas/stack-core@0.25.0

## 0.24.0

### Minor Changes

- [#553](https://github.com/OpenSaasAU/stack/pull/553) [`7f9b577`](https://github.com/OpenSaasAU/stack/commit/7f9b577678636d3f4d81e614ed022a03c61fe5c6) Thanks [@borisno2](https://github.com/borisno2)! - Emit explicit `.ts` import extensions in the generated `.opensaas` bundle so it's loadable by the host bundler

  The generator now appends an explicit `.ts` extension to every relative import it emits across the Generated bundle — `context.ts`, `types.ts`, `prisma-extensions.ts`, `lists.ts`, the `opensaas.config` import, and the `prisma-client/**` tree references. Previously these specifiers were extensionless (e.g. `import { PrismaClient } from './prisma-client/client'`), which only a TS-aware loader could resolve. A plain Node process or an un-aliased bundler (webpack/Next) failed to resolve the sub-imports, and pushing the bundle out of the compile graph with a `webpackIgnore`d dynamic `import()` meant `next build` never file-traced the `prisma-client/**` subtree into the serverless output.

  With explicit extensions the bundle resolves identically under `tsx`, `vitest`, plain Node type-stripping, esbuild, and webpack/Next without any consumer-side `extensionAlias`, and statically importing it compiles + file-traces under `next build`. This is the default output (no flag). See ADR-0008.

  **Consumer requirement:** the project that type-checks the bundle must set `allowImportingTsExtensions: true` in its tsconfig `compilerOptions`, otherwise the `.ts` specifiers fail the TypeScript step with TS5097. The flag is compatible with Next's `noEmit`, so it slots into the existing `next build` type-check. Projects scaffolded with `create-opensaas-app` get this flag by default.

  Generated output (before → after):

  ```typescript
  // before
  import { PrismaClient } from './prisma-client/client'
  import type { Context } from './types'
  import { prismaExtensions } from './prisma-extensions'
  import configOrPromise from '../opensaas.config'

  // after
  import { PrismaClient } from './prisma-client/client.ts'
  import type { Context } from './types.ts'
  import { prismaExtensions } from './prisma-extensions.ts'
  import configOrPromise from '../opensaas.config.ts'
  ```

  Regenerate with `pnpm generate` to pick up the new extensions. The supported production path is to statically import the bundle (e.g. `import { getContext } from '@/.opensaas/context'`) so the host build traces it — see the deployment guide for the `outputFileTracingIncludes` recipe.

### Patch Changes

- Updated dependencies [[`66496b4`](https://github.com/OpenSaasAU/stack/commit/66496b487bae61f3cdea26fcfcaf605caaaa5520)]:
  - @opensaas/stack-core@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [[`da4ba52`](https://github.com/OpenSaasAU/stack/commit/da4ba529161e2c8702e4c62ae1594e300f32cbb1)]:
  - @opensaas/stack-core@0.23.0

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

- [#505](https://github.com/OpenSaasAU/stack/pull/505) [`238966b`](https://github.com/OpenSaasAU/stack/commit/238966b791871247efd9ed2531de73586fb72c35) Thanks [@borisno2](https://github.com/borisno2)! - Surface the canonical Keystone migration guide and the `opensaas-migration` plugin install steps from `opensaas migrate`

  `opensaas migrate` now prints the published Keystone → stack guide URL and how to install the `opensaas-migration` Claude Code plugin (its skills and commands). The same pointers are available via `opensaas migrate --help` without running a migration. The CLI links to the canonical guide rather than embedding its text.

  ```bash
  # Both surface the guide URL + plugin install steps
  opensaas migrate
  opensaas migrate --help
  ```

  Output points at:
  - Guide: https://stack.opensaas.au/docs/guides/migrating-from-keystone
  - Plugin (automatic): `npx @opensaas/stack-cli migrate --with-ai`
  - Plugin (manual, inside Claude Code):
    - `/plugin marketplace add OpenSaasAU/stack`
    - `/plugin install opensaas-migration@opensaas-stack-marketplace`

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

- [#510](https://github.com/OpenSaasAU/stack/pull/510) [`4ce9284`](https://github.com/OpenSaasAU/stack/commit/4ce92845d272474dc15360edd12f31929a40521a) Thanks [@borisno2](https://github.com/borisno2)! - Singleton lists now emit a bare `id Int @id` (no `@default(1)`) to match Keystone 6, so singletons reach Schema parity from config alone instead of needing `extendPrismaSchema` to strip the column default (see ADR-0004).

  ```ts
  lists: {
    Settings: list({
      isSingleton: true,
      fields: { siteName: text() },
    }),
  }
  ```

  Generated Prisma schema:

  ```prisma
  model Settings {
    id        Int      @id
    siteName  String
  }
  ```

  Non-singleton lists are unaffected and continue to emit `id String @id @default(cuid())`.

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

- [#526](https://github.com/OpenSaasAU/stack/pull/526) [`a09103a`](https://github.com/OpenSaasAU/stack/commit/a09103afcb471575ebbfe09a439168375d474bac) Thanks [@borisno2](https://github.com/borisno2)! - Fix migration introspectors mapping Prisma/Keystone Float columns to the non-existent `float()` builder; they now map to `decimal()` and warn about the Float→Decimal type change.

- [#519](https://github.com/OpenSaasAU/stack/pull/519) [`abf350d`](https://github.com/OpenSaasAU/stack/commit/abf350d93150c0db6ad72e2bef4610ea68e9ec22) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-schema P1012: models without `db.schema` now default to `@@schema("public")` instead of emitting no `@@schema` (mirrors the enum default). Greenfield output is unchanged.

- [#512](https://github.com/OpenSaasAU/stack/pull/512) [`31a3129`](https://github.com/OpenSaasAU/stack/commit/31a31293c36e7633d9d576c8679d3a5a6788b089) Thanks [@borisno2](https://github.com/borisno2)! - Fix multi-schema mode (db.schemas): emit @@schema on generated native enum blocks so an enum-backed select() no longer produces an invalid schema (P1012). Enums inherit their owning model's schema, defaulting to public; greenfield output is unchanged.

- [#507](https://github.com/OpenSaasAU/stack/pull/507) [`fa8d6b4`](https://github.com/OpenSaasAU/stack/commit/fa8d6b43f0261176cb36d4f52b912655b21bdd07) Thanks [@borisno2](https://github.com/borisno2)! - Fix stale migration guide link in the MCP migration wizard's config-generation failure message; it now reuses the canonical `MIGRATION_GUIDE_URL` (`https://stack.opensaas.au/docs/guides/migrating-from-keystone`) instead of the old 404 path.

- Updated dependencies [[`be4181a`](https://github.com/OpenSaasAU/stack/commit/be4181ada3f2d6386052df4d4869ad150d360f89), [`dc51f23`](https://github.com/OpenSaasAU/stack/commit/dc51f237323ee53a705c4b9831dd8db85efd9bc1), [`309c666`](https://github.com/OpenSaasAU/stack/commit/309c666388b71e2bfbe16b7da3ee0f923b3bf716), [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c), [`696f5c0`](https://github.com/OpenSaasAU/stack/commit/696f5c08c37d4a18107e48cb6b360c9492c7425c), [`f9e0505`](https://github.com/OpenSaasAU/stack/commit/f9e05053c75c76781751d5d9e5d1ed5cd9be635f), [`d152203`](https://github.com/OpenSaasAU/stack/commit/d1522035e21b6ad7ad1b89b05264c54c13dadcf1), [`e30f6a1`](https://github.com/OpenSaasAU/stack/commit/e30f6a1ef69dc65ae68b37539fa74c3f97823cfd), [`f471e3c`](https://github.com/OpenSaasAU/stack/commit/f471e3c95eee2254ac9fde04adc8c5693240e293), [`acb6100`](https://github.com/OpenSaasAU/stack/commit/acb6100a078aca29e94a82ebe607d2d4f8683af2), [`593390c`](https://github.com/OpenSaasAU/stack/commit/593390c57d9844ca7ada8f45b340c849f1d8d647)]:
  - @opensaas/stack-core@0.22.0

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

- [#456](https://github.com/OpenSaasAU/stack/pull/456) [`8470d3e`](https://github.com/OpenSaasAU/stack/commit/8470d3e00d7c8cc62a2f773c82dc00fbd1672cd8) Thanks [@borisno2](https://github.com/borisno2)! - Generate a `prisma.config.ts` datasource that supports the production `prisma migrate` workflow.

  The generated datasource URL now prefers `DIRECT_DATABASE_URL` and falls back to `DATABASE_URL`, so migrations can use a direct (non-pooled) connection on serverless Postgres (e.g. Neon) while the running app connects through the pooled `DATABASE_URL`. Local SQLite is unaffected: with `DIRECT_DATABASE_URL` unset, the expression resolves to `DATABASE_URL`.

  ```typescript
  // generated prisma.config.ts
  import 'dotenv/config'
  import { defineConfig } from 'prisma/config'

  // Returns undefined for missing vars so the `??` fallback can take effect.
  const env = (name: string): string | undefined => process.env[name]

  export default defineConfig({
    schema: 'prisma',
    datasource: {
      url: env('DIRECT_DATABASE_URL') ?? env('DATABASE_URL'),
    },
  })
  ```

  To use a direct connection for migrations on serverless Postgres, set `DIRECT_DATABASE_URL` in your environment; `prisma migrate dev` / `prisma migrate deploy` will use it. See ADR-0003.

### Patch Changes

- [#441](https://github.com/OpenSaasAU/stack/pull/441) [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2) Thanks [@borisno2](https://github.com/borisno2)! - Validate field self-containment at config load instead of failing deep in generation

  Core now exports `validateFieldConfig(field, fieldKey, listKey?)` and `validateConfigFields(config)` (plus the `FieldConfigValidationError` type). They check each field implements its generation contract — `getPrismaType`, `getTypeScriptType`, and `getZodSchema` (or `getPrismaRelation` for relationships; virtual fields skip `getPrismaType`) — and return structured per-field errors. `opensaas generate` runs this first and fails fast with a clear message naming the list, field, and missing method, rather than throwing an opaque stack trace mid-generation.

- [#428](https://github.com/OpenSaasAU/stack/pull/428) [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce) Thanks [@borisno2](https://github.com/borisno2)! - Fix outdated SQLite adapter guidance to match the installed `@prisma/adapter-better-sqlite3` API (`PrismaBetterSqlite3` constructed with `{ url }`), so copied examples actually run. Updates the CLI "missing adapter" error message and the migration config it generates, plus the `prismaClientConstructor` JSDoc example.

- [#415](https://github.com/OpenSaasAU/stack/pull/415) [`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d) Thanks [@borisno2](https://github.com/borisno2)! - Emit `BaseFieldConfig` from `@opensaas/stack-core/extend` in generated `.opensaas/lists.ts`

  The lists generator falls back to `BaseFieldConfig` for field types it doesn't
  map explicitly (e.g. plugin-contributed fields like `embedding`, and the
  `calendarDay`/`decimal` built-ins). That symbol now lives on the `/extend`
  authoring entry point, so generated code imports it from there instead of the
  root, fixing a `has no exported member 'BaseFieldConfig'` type error.

- [#414](https://github.com/OpenSaasAU/stack/pull/414) [`f03e5ac`](https://github.com/OpenSaasAU/stack/commit/f03e5ac32d5a38ef31c895b200b1a4f7a5e50c9c) Thanks [@borisno2](https://github.com/borisno2)! - Fix docs to use the canonical `authPlugin()`/`ragPlugin()` config pattern instead of the non-existent `withAuth()`/`authConfig()`/`withRAG()`/`ragConfig()` wrappers

- [#397](https://github.com/OpenSaasAU/stack/pull/397) [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5) Thanks [@borisno2](https://github.com/borisno2)! - Move relationship Prisma schema generation into the relationship field builder

  The relationship field now exposes a `getPrismaRelation()` method that returns its complete Prisma schema contribution (FK line, relation line, synthetic back-relation). The Prisma generator delegates to this method instead of special-casing relationships, keeping it a neutral coordinator. Generated schemas are unchanged.

- Updated dependencies [[`8980ff3`](https://github.com/OpenSaasAU/stack/commit/8980ff36ffb0879d8f4409740493dd940572cc9d), [`841a836`](https://github.com/OpenSaasAU/stack/commit/841a836494e2647f390ae19a8c4121d38ebd2fa4), [`bc20bf4`](https://github.com/OpenSaasAU/stack/commit/bc20bf447cf724bd0ee153ea9a69d54cc26a6bb2), [`50371ea`](https://github.com/OpenSaasAU/stack/commit/50371ea3dd134f6b3718f347fed2c0d3b7dc63ce), [`70b4f53`](https://github.com/OpenSaasAU/stack/commit/70b4f538d380bbf546af50a985d29b48a71d3b4d), [`8e394ab`](https://github.com/OpenSaasAU/stack/commit/8e394abe9df2da53ba23b93836853516bb4e25d5), [`d3fdf2a`](https://github.com/OpenSaasAU/stack/commit/d3fdf2a2e5374302bc7fe1fe814cb0f567a349df), [`0f9c644`](https://github.com/OpenSaasAU/stack/commit/0f9c644a115ad747e338e6138b4762b4a48a9144), [`96258b0`](https://github.com/OpenSaasAU/stack/commit/96258b00bb762d9e38cfb83eacae65ce670b161f), [`898e477`](https://github.com/OpenSaasAU/stack/commit/898e47747abc02e457a54e2a78939450d16da5fb), [`29966b2`](https://github.com/OpenSaasAU/stack/commit/29966b23597199bcf4233298b1d0de6401b91acd)]:
  - @opensaas/stack-core@0.21.0

## 0.20.1

### Patch Changes

- [#386](https://github.com/OpenSaasAU/stack/pull/386) [`fcb04d6`](https://github.com/OpenSaasAU/stack/commit/fcb04d6916ab5451080cface330431866b52826c) Thanks [@borisno2](https://github.com/borisno2)! - Fix missing `query` parameter in generated `FindManyArgs` and `FindUniqueArgs` types

  Passing a fragment to `context.db.post.findMany({ query: fragment })` or `context.db.post.findUnique({ where: { id }, query: fragment })` no longer produces a TypeScript error. The generator now emits `query?: Fragment<PostOutput, FieldSelection<PostOutput>>` in the relevant args types.

- [#384](https://github.com/OpenSaasAU/stack/pull/384) [`6b7284a`](https://github.com/OpenSaasAU/stack/commit/6b7284adc828d115aeb25416db45d2be1e68f828) Thanks [@borisno2](https://github.com/borisno2)! - Fix virtual fields typed as `never` when mixed with relation fields in `select` or when using `include`

- Updated dependencies []:
  - @opensaas/stack-core@0.20.1

## 0.20.0

### Patch Changes

- Updated dependencies [[`28be231`](https://github.com/OpenSaasAU/stack/commit/28be23183bc7a9a072f86b3b7286c9c2109fdb11)]:
  - @opensaas/stack-core@0.20.0

## 0.19.1

### Patch Changes

- [#356](https://github.com/OpenSaasAU/stack/pull/356) [`6d771d1`](https://github.com/OpenSaasAU/stack/commit/6d771d11750eb4454b263b3db5bb1b44615be454) Thanks [@borisno2](https://github.com/borisno2)! - Fix regression where list-only many-to-many relationships no longer generated synthetic back-reference fields on the target model, causing Prisma schema validation errors

- Updated dependencies []:
  - @opensaas/stack-core@0.19.1

## 0.19.0

### Minor Changes

- [#346](https://github.com/OpenSaasAU/stack/pull/346) [`aa5edec`](https://github.com/OpenSaasAU/stack/commit/aa5edecfbd2fc2dcab67479088d4c6ff2dd24600) Thanks [@borisno2](https://github.com/borisno2)! - Improve KeystoneJS migration guidance for virtual fields and context.graphql patterns

  The Keystone migration guide now covers two areas that require changes beyond a simple import swap:

  **Virtual fields** — detected automatically; the generated guide shows how to replace `graphql.field({ resolve })` with `hooks: { resolveOutput }` and a `type` declaration:

  ```diff
  - fullName: virtual({
  -   field: graphql.field({
  -     type: graphql.String,
  -     resolve: (item) => `${item.firstName} ${item.lastName}`,
  -   }),
  - })
  + fullName: virtual({
  +   type: 'string',
  +   hooks: {
  +     resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
  +   },
  + })
  ```

  **context.graphql calls** — the guide now includes a step showing how to replace `context.graphql.run()` and `context.query.*` with `context.db.{listName}.{method}()`:

  ```diff
  - const { posts } = await context.graphql.run({
  -   query: `query { posts(where: { status: { equals: published } }) { id title } }`,
  - })
  + const posts = await context.db.post.findMany({
  +   where: { status: { equals: 'published' } },
  + })
  ```

  The introspector warning for virtual fields is also updated to give clearer guidance.

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

- [#342](https://github.com/OpenSaasAU/stack/pull/342) [`94b0df6`](https://github.com/OpenSaasAU/stack/commit/94b0df65c860348441200d914dbf37bda3bd25cf) Thanks [@borisno2](https://github.com/borisno2)! - Improve KeystoneJS migration agent with side-by-side examples and targeted update guidance

  The Keystone migration wizard and agent now produce a targeted migration guide instead of
  regenerating the entire config. Since Keystone and OpenSaaS Stack share the same
  `list()`/field/hook/access API, only imports, the database adapter config, and auth setup
  need to change.

  Key improvements:
  - The migration agent prompt now includes side-by-side Keystone vs OpenSaaS examples for
    config structure, imports, access control, hooks, auth, and many-to-many join tables
  - The wizard uses a minimal fast-path for Keystone projects (just 3 questions: db provider,
    auth, auth methods) instead of the full question flow
  - The generator produces a diff-style migration guide for Keystone showing exactly what to
    change, rather than regenerating list definitions the user already has
  - Many-to-many join table naming is now surfaced automatically when M2M relations are
    detected, with `joinTableNaming: 'keystone'` guidance to preserve existing data

### Patch Changes

- [#345](https://github.com/OpenSaasAU/stack/pull/345) [`c815d2f`](https://github.com/OpenSaasAU/stack/commit/c815d2f02a81b16189e8eea0e635ea1aa0a1d6ec) Thanks [@borisno2](https://github.com/borisno2)! - Fix `migrate --with-ai` generating `path` instead of `repo` in Claude marketplace settings

- [#345](https://github.com/OpenSaasAU/stack/pull/345) [`c815d2f`](https://github.com/OpenSaasAU/stack/commit/c815d2f02a81b16189e8eea0e635ea1aa0a1d6ec) Thanks [@borisno2](https://github.com/borisno2)! - Fix broken migration guide URL in `migrate` console output (missing `/docs` prefix)

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

- [#344](https://github.com/OpenSaasAU/stack/pull/344) [`c259030`](https://github.com/OpenSaasAU/stack/commit/c259030dab3cdc641a9f40dd21746a1bd46fb76d) Thanks [@borisno2](https://github.com/borisno2)! - Fix updatedAt field to include @default(now()) in generated Prisma schema to prevent migration failures on databases with existing data

- Updated dependencies [[`bd41b1e`](https://github.com/OpenSaasAU/stack/commit/bd41b1e75b78c2e9748422352e6a500ed26df4e9), [`28f2834`](https://github.com/OpenSaasAU/stack/commit/28f2834b199b93200c74cefb1594ba3704f0a839), [`5410cb6`](https://github.com/OpenSaasAU/stack/commit/5410cb604198e087762e39c8aec87fe3736d8c01)]:
  - @opensaas/stack-core@0.19.0

## 0.18.2

### Patch Changes

- Updated dependencies [[`0b0f322`](https://github.com/OpenSaasAU/stack/commit/0b0f3223e3703014164d49c8f3b455752a6468c1)]:
  - @opensaas/stack-core@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [[`3f59454`](https://github.com/OpenSaasAU/stack/commit/3f59454e03976f7ff4f401c661624d1934910a17)]:
  - @opensaas/stack-core@0.18.1

## 0.18.0

### Minor Changes

- [#324](https://github.com/OpenSaasAU/stack/pull/324) [`a05db98`](https://github.com/OpenSaasAU/stack/commit/a05db983f1579038c0542b13e4438496022c1ac1) Thanks [@borisno2](https://github.com/borisno2)! - Add `createMany` and `updateMany` types to generated type definitions

  The type generator now includes properly typed `createMany` and `updateMany` methods in the `CustomDB` type, matching the implementation added in PR #315.

  ```typescript
  // createMany - bulk create with full type safety
  const posts = await context.db.post.createMany({
    data: [
      { title: 'Post 1', content: 'Content 1' },
      { title: 'Post 2', content: 'Content 2' },
    ],
    select: { id: true, title: true },
  })

  // updateMany - bulk update with where filter
  const updated = await context.db.post.updateMany({
    where: { status: 'draft' },
    data: { status: 'published' },
  })
  ```

  Also fixes hook types to use locally defined `BaseContext` instead of importing `AccessContext` from core, giving hooks access to the properly typed `CustomDB` with virtual fields and all operations.

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.18.0

## 0.17.0

### Minor Changes

- [#322](https://github.com/OpenSaasAU/stack/pull/322) [`9032dca`](https://github.com/OpenSaasAU/stack/commit/9032dca163bcaa51d3b2386a8e76b28e6c712cbb) Thanks [@borisno2](https://github.com/borisno2)! - Add BaseContext type for shared services between hooks and server actions

  The type generator now exports a `BaseContext` type that contains only the core context properties (`db`, `session`, `storage`, `plugins`, `_isSudo`). This allows services to accept a base context type that works with both:
  - **Field hooks** (which receive `AccessContext`)
  - **Server actions** (which receive full `Context`)

  Previously, services had to choose between accepting `Context` (incompatible with hooks) or using type assertions. Now you can write services that work in both contexts:

  ```typescript
  // In your generated .opensaas/types.ts, you'll now have both:
  export type BaseContext<TSession extends OpensaasSession = OpensaasSession> = {
    db: CustomDB
    session: TSession
    // ... other base properties
  }

  export type Context<TSession extends OpensaasSession = OpensaasSession> =
    BaseContext<TSession> & {
      serverAction: (props: ServerActionProps) => Promise<unknown>
      sudo: () => Context<TSession>
    }
  ```

  **Usage example:**

  ```typescript
  // Service that works with both hooks and server actions
  export class ScheduleService {
    private context: BaseContext // ✅ Accepts BaseContext instead of Context

    constructor(context: BaseContext) {
      this.context = context
    }

    async checkConflicts(userId: string) {
      // Only uses db and session - works everywhere
      return this.context.db.schedule.findMany({
        where: { userId },
      })
    }
  }

  // Factory function
  export function createScheduleService(context: BaseContext): ScheduleService {
    return new ScheduleService(context)
  }

  // ✅ Works in field hooks
  fields: {
    schedule: relationship({
      ref: 'Schedule',
      hooks: {
        validateInput: async ({ context, addValidationError }) => {
          const service = createScheduleService(context) // No type error!
          const hasConflict = await service.checkConflicts(userId)
          if (hasConflict) {
            addValidationError('Schedule conflict detected')
          }
        },
      },
    })
  }

  // ✅ Also works in server actions
  export async function checkSchedule(context: Context, userId: string) {
    const service = createScheduleService(context) // Also works!
    return service.checkConflicts(userId)
  }
  ```

  This resolves the type incompatibility issue where services needed to use type assertions or duplicate code to work in both hooks and server actions.

- [#323](https://github.com/OpenSaasAU/stack/pull/323) [`247a259`](https://github.com/OpenSaasAU/stack/commit/247a2590f699b0e27b3661942295064d640e225f) Thanks [@borisno2](https://github.com/borisno2)! - Add full Prisma filter operator support to WhereInput types

  The generated `WhereInput` types now expose all of Prisma's filter operators instead of just `equals` and `not`. This resolves GitHub issue #318.

  **String fields** now support:

  ```typescript
  const where: PostWhereInput = {
    title: {
      contains: 'search',
      startsWith: 'Hello',
      endsWith: '!',
      in: ['Post 1', 'Post 2'],
      notIn: ['Spam'],
      mode: 'insensitive', // case-insensitive search
    },
  }
  ```

  **Number fields** now support:

  ```typescript
  const where: PostWhereInput = {
    viewCount: {
      gte: 100, // greater than or equal
      lte: 1000, // less than or equal
      gt: 50, // greater than
      lt: 500, // less than
      in: [10, 20, 30],
      notIn: [0],
    },
  }
  ```

  **DateTime fields** now support:

  ```typescript
  const where: PostWhereInput = {
    publishDate: {
      gte: new Date('2024-01-01'),
      lte: new Date('2024-12-31'),
    },
  }
  ```

  **Boolean operators** now match Prisma's structure:

  ```typescript
  const where: PostWhereInput = {
    // AND can be single object OR array
    AND: { status: { equals: 'published' } },
    // OR is array-only
    OR: [{ status: { in: ['published', 'draft'] } }, { title: { contains: 'important' } }],
    // NOT can be single object OR array
    NOT: { status: { equals: 'archived' } },
  }
  ```

  No migration required - this change is fully backward compatible. Existing code using `equals` and `not` will continue to work.

### Patch Changes

- [#317](https://github.com/OpenSaasAU/stack/pull/317) [`69b7af6`](https://github.com/OpenSaasAU/stack/commit/69b7af631c784e7ca0fbe4d1c3979b12fc8c9afe) Thanks [@borisno2](https://github.com/borisno2)! - Fix synthetic field generation for one-sided relationships when using joinTableNaming: 'keystone'

- [#321](https://github.com/OpenSaasAU/stack/pull/321) [`834d437`](https://github.com/OpenSaasAU/stack/commit/834d437ab47f6246d58f1aa005847321796bfdc3) Thanks [@borisno2](https://github.com/borisno2)! - Fix select type narrowing to properly include virtual fields and nested relations in query results

- Updated dependencies [[`538bc20`](https://github.com/OpenSaasAU/stack/commit/538bc20698b7d0f3c6600741f4553306008dec64)]:
  - @opensaas/stack-core@0.17.0

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

### Patch Changes

- [#314](https://github.com/OpenSaasAU/stack/pull/314) [`c6b66e2`](https://github.com/OpenSaasAU/stack/commit/c6b66e229a6e16838cf5833e973e5060379aa874) Thanks [@borisno2](https://github.com/borisno2)! - Fix TypeScript errors when selecting virtual fields on nested relationships

- Updated dependencies [[`85b067b`](https://github.com/OpenSaasAU/stack/commit/85b067b2d10bddaffccf519025aeae2dbc00fa85)]:
  - @opensaas/stack-core@0.16.0

## 0.15.0

### Minor Changes

- [#306](https://github.com/OpenSaasAU/stack/pull/306) [`e7b3542`](https://github.com/OpenSaasAU/stack/commit/e7b354246e40c6d91c459a50791f6eef12f9521d) Thanks [@borisno2](https://github.com/borisno2)! - Add GetPayload helper types for virtual fields

  Virtual fields are now fully type-safe in Prisma select queries. The type generator now creates `{ListName}GetPayload<T>` helper types that conditionally include virtual fields based on selection.

  Before this change, virtual fields were not recognized in Prisma select types:

  ```typescript
  import { Prisma } from '@/.opensaas/prisma-client/client'

  const select = {
    id: true,
    age: true, // ❌ TS Error: 'age' does not exist in type 'StudentSelect'
  } satisfies Prisma.StudentSelect
  ```

  After this change, you can use the generated types from `.opensaas/types`:

  ```typescript
  import { StudentSelect, StudentGetPayload } from '@/.opensaas/types'

  const studentSelect = {
    id: true,
    firstName: true,
    age: true, // ✅ Virtual field - fully typed!
  } satisfies StudentSelect

  type StudentDetail = StudentGetPayload<{ select: typeof studentSelect }>
  // ✅ StudentDetail includes: { id: string, firstName: string, age: number }
  ```

  The helper type only includes virtual fields that are explicitly selected:

  ```typescript
  const basicSelect = {
    id: true,
    firstName: true,
    // age NOT selected
  } satisfies StudentSelect

  type BasicStudent = StudentGetPayload<{ select: typeof basicSelect }>
  // ✅ BasicStudent includes: { id: string, firstName: string }
  // age is NOT included
  ```

  No migration needed - this is purely additive. Existing code continues to work, and you can adopt the new types incrementally by:
  1. Running `pnpm generate` to regenerate types
  2. Importing from `.opensaas/types` instead of `@/.opensaas/prisma-client/client`
  3. Using `{ListName}Select` and `{ListName}GetPayload<T>` for type-safe virtual field queries

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

### Patch Changes

- Updated dependencies [[`19f04b1`](https://github.com/OpenSaasAU/stack/commit/19f04b1c5e0b172257936c366bd28d56aa825a24)]:
  - @opensaas/stack-core@0.15.0

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

- [#294](https://github.com/OpenSaasAU/stack/pull/294) [`fdda49d`](https://github.com/OpenSaasAU/stack/commit/fdda49dfb63feaa37d01c0c0bf2f79df8be8ae9e) Thanks [@{](https://github.com/{), [@{](https://github.com/{), [@{](https://github.com/{)! - Add relationship field support to WhereInput types

  Generated WhereInput types now include relationship fields, enabling access control filters that traverse relationships:

  ```typescript
  // One-to-many relationships use some/every/none
  const userFilter: UserWhereInput = {
    posts: {
      some: {
        status: { equals: 'published' },
      },
    },
  }

  // Many-to-one relationships use direct nesting
  const postFilter: PostWhereInput = {

      email: { equals: 'user@example.com' },
    },
  }

  // Complex nested filters are now possible
  const complexFilter: PostWhereInput = {
    AND: [
      { status: { equals: 'published' } },
      {

          posts: {
            some: { status: { equals: 'published' } },
          },
        },
      },
    ],
  }
  ```

  This enables common access control patterns like filtering students by their account's user:

  ```typescript
  export function studentFilter({ session }: { session: Session | null }): StudentWhereInput {
    return {
      account: {
   id: { equals: session?.userId } },
      },
    }
  }
  ```

- [#296](https://github.com/OpenSaasAU/stack/pull/296) [`71584da`](https://github.com/OpenSaasAU/stack/commit/71584da61b89e66685d7e1b7c3e22adaa57b7490) Thanks [@borisno2](https://github.com/borisno2)! - Add Select and Include types with virtual field support

  Virtual fields are now included in generated Select and Include types, enabling proper TypeScript type checking when selecting virtual fields:

  ```typescript
  import type { UserSelect } from '@/.opensaas/types'

  // Before: This would cause a type error
  const select = {
    id: true,
    name: true,
    displayName: true, // Error: 'displayName' does not exist in Prisma.UserSelect
  } satisfies Prisma.UserSelect

  // After: Virtual fields work correctly
  const select = {
    id: true,
    name: true,
    displayName: true, // ✓ Works! Virtual field is included in UserSelect
  } satisfies UserSelect
  ```

  For lists without virtual fields, the generated types simply re-export Prisma's types:

  ```typescript
  export type PostSelect = Prisma.PostSelect
  export type PostInclude = Prisma.PostInclude
  ```

  For lists with virtual fields, the types extend Prisma's types:

  ```typescript
  export type UserSelect = Prisma.UserSelect & {
    displayName?: boolean
  }
  ```

  This resolves the issue where virtual fields couldn't be used in select/include objects with the `satisfies` operator.

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

### Patch Changes

- Updated dependencies [[`5f1bfb5`](https://github.com/OpenSaasAU/stack/commit/5f1bfb5d286b3b43c61fceeae6d78588c126d488), [`6f8d37a`](https://github.com/OpenSaasAU/stack/commit/6f8d37a0761d50b9b9b707f26b39176304428770), [`ed25cc5`](https://github.com/OpenSaasAU/stack/commit/ed25cc5aba43709d40ad256c982364ca8a8b0f2e), [`c2263d2`](https://github.com/OpenSaasAU/stack/commit/c2263d21cc7a4eaffc0b06af04eb7b3a1a3ce437), [`0c66ebc`](https://github.com/OpenSaasAU/stack/commit/0c66ebc4492fac47f2028569b080d496328c18bf)]:
  - @opensaas/stack-core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`b979df4`](https://github.com/OpenSaasAU/stack/commit/b979df458ea39ce763dd92aa212fc70be207c416)]:
  - @opensaas/stack-core@0.13.0

## 0.12.1

### Patch Changes

- [#279](https://github.com/OpenSaasAU/stack/pull/279) [`da903a2`](https://github.com/OpenSaasAU/stack/commit/da903a2024993348944017b30155a693c276a53a) Thanks [@borisno2](https://github.com/borisno2)! - make prisma config point to prisma folder

- Updated dependencies []:
  - @opensaas/stack-core@0.12.1

## 0.12.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`152e3bc`](https://github.com/OpenSaasAU/stack/commit/152e3bc7e7c703ad981ad54d32f5f7251233e66d), [`02e9ab1`](https://github.com/OpenSaasAU/stack/commit/02e9ab1578741e9fd32cbc3a7938c66002c4d5f6)]:
  - @opensaas/stack-core@0.12.0

## 0.11.0

### Minor Changes

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

- [#265](https://github.com/OpenSaasAU/stack/pull/265) [`27a211d`](https://github.com/OpenSaasAU/stack/commit/27a211dbb8c9c3d462cdc8cf2c717386b76548b6) Thanks [@borisno2](https://github.com/borisno2)! - Add automatic Prisma schema formatting after generation

  The `opensaas generate` command now automatically runs `prisma format` after generating the schema file. This ensures consistent formatting of the generated `prisma/schema.prisma` file.

  The formatting step is non-critical - if it fails (e.g., due to missing environment variables or network issues), generation will continue with a warning instead of failing.

  No action required - formatting happens automatically during `pnpm generate`.

### Patch Changes

- Updated dependencies [[`ec53708`](https://github.com/OpenSaasAU/stack/commit/ec53708898579dcc7de80eb9fc9a3a99c45367c9), [`8a476a5`](https://github.com/OpenSaasAU/stack/commit/8a476a563761f3b268ad43269058267871e43b73), [`bbe7f05`](https://github.com/OpenSaasAU/stack/commit/bbe7f051428013b327cbadc5fda7920d5885a6bc), [`ba9bfa8`](https://github.com/OpenSaasAU/stack/commit/ba9bfa80e88f125d00d621e3b7fe8e39ffaeb145), [`38337cc`](https://github.com/OpenSaasAU/stack/commit/38337ccc17a9c3e78b3767bf2422d0ca9ea16230)]:
  - @opensaas/stack-core@0.11.0

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

### Patch Changes

- Updated dependencies [[`9aa5d8f`](https://github.com/OpenSaasAU/stack/commit/9aa5d8f60578abfdf7c36f3460b61b2fcfea6066)]:
  - @opensaas/stack-core@0.10.0

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

### Patch Changes

- Updated dependencies [[`8489a01`](https://github.com/OpenSaasAU/stack/commit/8489a01623fa61c1590509b88fee40071a18b0ca)]:
  - @opensaas/stack-core@0.9.0

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

### Patch Changes

- Updated dependencies [[`595aa82`](https://github.com/OpenSaasAU/stack/commit/595aa82ccd93e11454b2a70cbd90e5ace2bb5ae3)]:
  - @opensaas/stack-core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [[`6717469`](https://github.com/OpenSaasAU/stack/commit/6717469344f08e1250fed8342a05dd4b08208e92)]:
  - @opensaas/stack-core@0.7.0

## 0.6.2

### Patch Changes

- [#227](https://github.com/OpenSaasAU/stack/pull/227) [`6d7c1a2`](https://github.com/OpenSaasAU/stack/commit/6d7c1a2aee112c3b60588f89bcabd8aeb28886f0) Thanks [@borisno2](https://github.com/borisno2)! - Fix Claude settings format in migrate command to use object for enabledPlugins and path for GitHub marketplace source

- Updated dependencies []:
  - @opensaas/stack-core@0.6.2

## 0.6.1

### Patch Changes

- [#224](https://github.com/OpenSaasAU/stack/pull/224) [`d90b8c0`](https://github.com/OpenSaasAU/stack/commit/d90b8c00ec3b94683e2be8fa80e7ae497c71ae7a) Thanks [@borisno2](https://github.com/borisno2)! - Migrate plugin installation to marketplace architecture, removing need for separate .mcp.json file

- Updated dependencies []:
  - @opensaas/stack-core@0.6.1

## 0.6.0

### Minor Changes

- [#223](https://github.com/OpenSaasAU/stack/pull/223) [`7f7270e`](https://github.com/OpenSaasAU/stack/commit/7f7270e5fa8e7ba6df4d4dedb9dfa1351756312a) Thanks [@borisno2](https://github.com/borisno2)! - Migrate AI migration assistant to Claude Code plugin system

  The `opensaas migrate --with-ai` command now uses a Claude Code plugin instead of writing templated files to the user's `.claude/` directory. This provides several benefits:

  **What changed:**
  - Migration assistant is now distributed as a plugin within `@opensaas/stack-cli`
  - CLI writes project metadata to `.claude/opensaas-project.json` instead of templated files
  - Plugin is automatically configured in `.claude/settings.json`

  **Benefits:**
  - Migration assistant content can be updated by upgrading `@opensaas/stack-cli`
  - Cleaner separation between generic content and project-specific data
  - Easier to maintain and update migration logic

  **Usage remains the same:**

  ```bash
  npx @opensaas/stack-cli migrate --with-ai
  ```

  Then open the project in Claude Code and ask: "Help me migrate to OpenSaaS Stack"

  The migration assistant agent will read your project metadata and guide you through the migration wizard as before.

### Patch Changes

- [#219](https://github.com/OpenSaasAU/stack/pull/219) [`f2d78e5`](https://github.com/OpenSaasAU/stack/commit/f2d78e5946c28be0b9ae61dae76ee2534b9a4efc) Thanks [@borisno2](https://github.com/borisno2)! - Fix MCP configuration and add agent/skill support to migration wizard

  **MCP Configuration:**
  - Fixed MCP server configuration to use correct `.mcp.json` format at project root
  - Added `type: 'stdio'` field and proper structure
  - Added `-y` flag to npx command for auto-accepting prompts

  **Migration Assistant Agent:**
  - Added required YAML frontmatter with `name`, `description`, `model`, and `skills` fields
  - Agent is now properly discoverable by Claude Code
  - Auto-loads the `opensaas-migration` skill for expert knowledge

  **Migration Skill:**
  - Created comprehensive `opensaas-migration` skill with migration guidance
  - Includes access control patterns, field type mappings, database configs
  - Provides migration checklist and best practices
  - Stored in `.claude/skills/opensaas-migration/SKILL.md`

  When users run `opensaas migrate --with-ai`, they now get a fully configured Claude Code environment with agents, skills, and MCP tools working together.

- Updated dependencies []:
  - @opensaas/stack-core@0.6.0

## 0.5.0

### Minor Changes

- [#198](https://github.com/OpenSaasAU/stack/pull/198) [`c84405e`](https://github.com/OpenSaasAU/stack/commit/c84405e669e03dbc38fb094e813a105abbb448b8) Thanks [@borisno2](https://github.com/borisno2)! - Add Phase 2 MCP migration tools and enhanced documentation provider

  This update adds 6 new MCP server tools to assist with project migration:

  **New MCP Tools:**
  - `opensaas_start_migration`: Start migration wizard for Prisma/Keystone/Next.js projects
  - `opensaas_answer_migration`: Answer migration wizard questions
  - `opensaas_introspect_prisma`: Analyze Prisma schema files
  - `opensaas_introspect_keystone`: Analyze KeystoneJS config files
  - `opensaas_search_migration_docs`: Search local and online documentation
  - `opensaas_get_example`: Retrieve curated code examples

  **Enhanced Documentation Provider:**
  - Local CLAUDE.md file search with relevance scoring
  - Curated code examples for common patterns (blog-with-auth, access-control, relationships, hooks, custom-fields)
  - Project-specific migration guides for Prisma, KeystoneJS, and Next.js

  **Dependencies:**
  - Added `fs-extra` and `glob` for local file search capabilities
  - Added `@types/fs-extra` for TypeScript support

  Note: Migration wizard and introspectors are currently stubs and will be fully implemented in future phases.

- [#196](https://github.com/OpenSaasAU/stack/pull/196) [`2f364b6`](https://github.com/OpenSaasAU/stack/commit/2f364b6b8295dfd205dfb3d0a11eb0bdb5ea2621) Thanks [@borisno2](https://github.com/borisno2)! - Add `opensaas migrate` CLI command for project migration

  Implements a new CLI command that helps users migrate existing Prisma, KeystoneJS, and Next.js projects to OpenSaaS Stack. The command provides both automatic project analysis and AI-guided migration through Claude Code integration.

  Features:
  - Auto-detects project type (Prisma, KeystoneJS, Next.js)
  - Analyzes existing schema (models, fields, database provider)
  - Optional AI-guided migration with `--with-ai` flag
  - Creates `.claude/` directory with migration assistant agent
  - Generates command files for schema analysis and config generation
  - Provides clear next steps and documentation links

  Usage:

  ```bash
  opensaas migrate           # Analyze current project
  opensaas migrate --with-ai # Enable AI-guided migration
  opensaas migrate --type prisma # Force project type
  ```

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.5.0

## 0.4.0

### Minor Changes

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

### Patch Changes

- [#154](https://github.com/OpenSaasAU/stack/pull/154) [`edf1e5f`](https://github.com/OpenSaasAU/stack/commit/edf1e5fa4cfefcb7bc09bf45d4702260e6d0d3aa) Thanks [@renovate](https://github.com/apps/renovate)! - Update dependency chokidar to v5

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

- Updated dependencies [[`527b677`](https://github.com/OpenSaasAU/stack/commit/527b677ab598070185e23d163a9e99bc20f03c49), [`929a2a9`](https://github.com/OpenSaasAU/stack/commit/929a2a9a2dfa80b1d973d259dd87828d644ea58d), [`3c4db9d`](https://github.com/OpenSaasAU/stack/commit/3c4db9d8318fc73d291991d8bdfa4f607c3a50ea)]:
  - @opensaas/stack-core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @opensaas/stack-core@0.3.0

## 0.2.0

### Minor Changes

- [#107](https://github.com/OpenSaasAU/stack/pull/107) [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c) Thanks [@borisno2](https://github.com/borisno2)! - # Add MCP Server for AI-Assisted Development

  ## New Features

  ### CLI Package (@opensaas/stack-cli)
  - **New `opensaas mcp` command group** for AI-assisted development:
    - `opensaas mcp install` - Install MCP server in Claude Code
    - `opensaas mcp uninstall` - Remove MCP server from Claude Code
    - `opensaas mcp start` - Start MCP server directly (for debugging)
  - **Feature-driven development tools**:
    - Interactive feature implementation wizards (authentication, blog, comments, file-upload, semantic-search)
    - Live documentation search from stack.opensaas.au
    - Code generation following OpenSaaS best practices
    - Smart feature suggestions based on your current app
    - Config validation
  - **MCP tools available in Claude Code**:
    - `opensaas_implement_feature` - Start feature wizard
    - `opensaas_feature_docs` - Search documentation
    - `opensaas_list_features` - Browse available features
    - `opensaas_suggest_features` - Get personalized recommendations
    - `opensaas_validate_feature` - Validate implementations

  ### create-opensaas-app
  - **Interactive MCP setup prompt** during project creation
  - Option to enable AI development tools automatically
  - Automatic installation of MCP server if user opts in
  - Helpful instructions if MCP installation is declined or fails

  ## Installation

  Enable AI development tools for an existing project:

  ```bash
  npx @opensaas/stack-cli mcp install
  ```

  Or during project creation:

  ```bash
  npm create opensaas-app@latest my-app
  # When prompted: Enable AI development tools? → yes
  ```

  ## Benefits
  - **Build apps faster**: Describe what you want to build, get complete implementations
  - **Feature-driven development**: Work with high-level features instead of low-level config
  - **Best practices baked in**: Generated code follows OpenSaaS Stack patterns
  - **Live documentation**: Always up-to-date docs from the official site
  - **Single toolkit**: All developer commands in one CLI

  ## Example Usage

  With Claude Code installed and the MCP server enabled, you can:

  ```
  You: "I want to build a food tracking app"

  Claude Code uses MCP tools to:
  1. Ask clarifying questions about requirements
  2. Implement authentication feature (wizard)
  3. Create custom Food and FoodLog lists
  4. Generate complete code with UI and access control
  5. Provide testing and deployment guidance
  ```

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

- Updated dependencies [[`fcf5cb8`](https://github.com/OpenSaasAU/stack/commit/fcf5cb8bbd55d802350b8d97e342dd7f6368163b), [`3851a3c`](https://github.com/OpenSaasAU/stack/commit/3851a3cf72e78dc6f01a73c6fff97deca6fad043), [`f4f3966`](https://github.com/OpenSaasAU/stack/commit/f4f3966faedba07d2cf412fab826d81e30c63a6c)]:
  - @opensaas/stack-core@0.2.0

## 0.1.7

### Patch Changes

- 372d467: Add sudo to context to bypass access control
- Updated dependencies [372d467]
  - @opensaas/stack-core@0.1.7

## 0.1.6

### Patch Changes

- 39996ca: Fix missing StoredEmbedding type import in generated types. Fields can now declare TypeScript imports needed for their types via the new `getTypeScriptImports()` method. This resolves the type error where `StoredEmbedding` was referenced but not imported in the generated `.opensaas/types.ts` file.
- 39996ca: Add plugin mechanism
- Updated dependencies [39996ca]
- Updated dependencies [39996ca]
  - @opensaas/stack-core@0.1.6

## 0.1.5

### Patch Changes

- 17eaafb: Update package urls
- Updated dependencies [17eaafb]
  - @opensaas/stack-core@0.1.5

## 0.1.4

### Patch Changes

- d2d1720: clean up dependency
- Updated dependencies [d013859]
  - @opensaas/stack-core@0.1.4

## 0.1.3

### Patch Changes

- @opensaas/stack-core@0.1.3
- @opensaas/stack-mcp@0.1.3

## 0.1.2

### Patch Changes

- 7bb96e6: Fix up init command to work
  - @opensaas/stack-core@0.1.2
  - @opensaas/stack-mcp@0.1.2

## 0.1.1

### Patch Changes

- f8ebc0e: Add base mcp server
- 045c071: Add field and image upload
- Updated dependencies [9a3fda5]
- Updated dependencies [f8ebc0e]
- Updated dependencies [045c071]
  - @opensaas/stack-core@0.1.1
  - @opensaas/stack-mcp@0.1.1
