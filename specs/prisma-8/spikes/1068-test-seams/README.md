# Spike 1068: a test database and test doubles for Prisma 8 (`8.0.0-rc.8`)

Fact-finding for how `@opensaas/stack-core` tests should drive Prisma 8 once the
per-model `vi.fn()` delegates are gone. Everything here was measured on
macOS (Darwin 25.5.0), Node v24.10.0, pnpm 10.29.1, with:

| package                          | version    |
| -------------------------------- | ---------- |
| `@prisma/orm-postgres`           | 8.0.0-rc.8 |
| `@prisma/orm-extension-pgvector` | 8.0.0-rc.8 |
| `@electric-sql/pglite`           | 0.5.8      |
| `@electric-sql/pglite-socket`    | 0.2.11     |
| `@electric-sql/pglite-pgvector`  | 0.0.9      |
| `pg`                             | 8.23.0     |

Throwaway spike, not library code. Not part of the workspace. The `prisma` CLI at
rc.8 is broken, so everything is programmatic.

## Running it

```bash
cd <this dir>
pnpm install --ignore-workspace
npx tsx smoke.ts                      # end-to-end sanity: PGlite + socket + ORM CRUD/tx/include
npx tsx a-pglite.ts                   # FACT A: startup, latency, two instances, unix vs tcp
npx tsx a2-unix-and-concurrency.ts    # FACT A: binding variants with root causes, 5-way concurrency
npx tsx a3-tx.ts                      # FACT A: concurrent transactions vs the first-use marker read
npx tsx a-control.ts                  # FACT A: schema via createPostgresControlClient().dbUpdate()
npx tsx a-vector.ts                   # FACT A: pgvector on PGlite + Vector(3) column through the ORM
npx tsx b-fake-driver.ts              # FACT B: duck-typed fake pg.Client
npx tsx c-ast.ts                      # FACT C: what beforeCompile sees (AST JSON, annotations)
npx tsx d-state.ts                    # FACT D: Collection.state without executing
```

`*.out` files are the captured runs the tables below are taken from.

Import gotcha: pnpm does not hoist `@prisma/orm-framework` / `@prisma/orm-family-sql`, so
in a consumer import their surfaces through the `@prisma/orm-postgres/*` re-exports
(`/components/runtime` for `defineAnnotation`, `/orm-client` for `Collection`,
`/family-runtime` for `SqlMiddleware`).

---

## FACT A — in-process PGlite as the test database

**Verdict: works.** `new PGlite({ extensions: { vector } })` → `PGLiteSocketServer` →
node-postgres → Prisma 8 runtime. Create, `.where().all()`, `.where().update()`,
`db.transaction()`, `include('posts')` (hasMany/belongsTo) all return correct rows
(`smoke.ts`). Schema can be created by Prisma's own control client, no hand-written DDL
needed.

### Startup (`a-pglite.ts`, 3 runs each)

| what                                           | run 1  | run 2  | run 3  |
| ---------------------------------------------- | ------ | ------ | ------ |
| `new PGlite({vector})` + `waitReady` (unix)    | 644 ms | 401 ms | 406 ms |
| `PGLiteSocketServer.start()` (unix path)       | 4.8 ms | 0.6 ms | 0.6 ms |
| `new PGlite({vector})` + `waitReady` (tcp)     | 361 ms | 364 ms | 359 ms |
| `PGLiteSocketServer.start()` (127.0.0.1:port)  | 1.9 ms | 1.7 ms | 0.6 ms |
| PGlite without the pgvector extension bundle   | 367 ms |        |        |
| `control.dbUpdate({mode:'apply'})` on 2 tables | 50 ms  |        |        |

The first-ever instantiation in a process pays ~250 ms extra (WASM compile); subsequent
instances in the same process are ~360–400 ms. A fresh, schema'd, signed database is
therefore **~420 ms** per instance. The socket server itself is free.

### Per-query latency (`a-pglite.ts`, 300 warm iterations, shared client, `pg.Pool max=1`)

| transport | `orm.Post.where({authorId}).all()` | raw `pool.query(...)` | ORM overhead |
| --------- | ---------------------------------- | --------------------- | ------------ |
| unix path | **0.119 ms**                       | 0.063 ms              | 0.056 ms     |
| tcp       | **0.143 ms**                       | 0.089 ms              | 0.054 ms     |

### Binding variants over a unix socket (`a2-unix-and-concurrency.ts`)

`PGLiteSocketServer({ path })` binds a unix socket. node-postgres reaches it with
`host: <directory containing .s.PGSQL.5432>`, or in a URL as
`postgres://postgres@localhost/postgres?host=<url-encoded dir>`.

| binding                                            | server `maxConnections: 1` (default) | `maxConnections: 10` |
| -------------------------------------------------- | ------------------------------------ | -------------------- |
| `postgres({ url: '...?host=<dir>' })`              | FAIL `write EPIPE` on first query    | OK                   |
| `postgres({ pg: new Pool({ host: dir, max: 1 })})` | FAIL `write EPIPE`                   | OK                   |
| `postgres({ pg: new Pool({ host: dir }) })`        | OK (timing-dependent, see limits)    | OK                   |
| `postgres({ pg: new Client({ host: dir }) })`      | FAIL `write EPIPE`                   | OK                   |

So: **`url:` with a unix socket works** (pg-connection-string honours `?host=`), and so
does `pg: Pool|Client`. The failures are entirely the server's default
`maxConnections: 1` (`pglite-socket/dist/index.d.ts:92`): a connection arriving while
the previous handler is still tearing down is refused and the driver surfaces it as
EPIPE/ECONNRESET wrapped in `CliStructuredError: Database error while reading contract
marker`. **Always construct the server with `maxConnections` ≥ the pool size** (10 covers
pg's default pool).

### Two PGlite instances in one process (`a-pglite.ts`)

Two `new PGlite()` + two socket servers + two `postgres()` clients, queried with
`Promise.all`: `A users: [u1,u2]  B users: [zz]  isolated: true`. Coexist fine; each
instance is its own WASM heap.

### Concurrency: 5 concurrent `.all()` (`a2-unix-and-concurrency.ts`)

| client                               | server `maxConnections` | result                           |
| ------------------------------------ | ----------------------- | -------------------------------- |
| `url:` (own pool, pg default max=10) | 1                       | **ERROR** `read ECONNRESET` 6 ms |
| `pg: Pool({max:1})`                  | 1                       | `[1,2,1,2,1]` 5 ms (serialised)  |
| `url:`                               | 5                       | `[1,2,1,2,1]` 6 ms               |
| `url:`                               | 10                      | `[1,2,1,2,1]` 6 ms               |

No deadlock on plain queries: PGLiteSocketServer queues at the query level across
connections and serialises them. With enough server slots, 5 pooled connections open
(`activeConnections: 5`) and the queries serialise inside PGlite in ~1 ms each.

### Concurrency: 5 concurrent `db.transaction()` (`a3-tx.ts`) — the real trap

| variant                                               | result                                  |
| ----------------------------------------------------- | --------------------------------------- |
| `url:`, fresh client, default `verifyMarker`          | **TIMEOUT** (server: 6 conns, 5 queued) |
| `url:`, one warm-up query first                       | `[1,2,3,4,5]` 7 ms                      |
| `url:`, `verifyMarker: false`                         | `[1,2,3,4,5]` 7 ms                      |
| `pg: Pool({max:1})`, default `verifyMarker`, **1** tx | **TIMEOUT**                             |
| `pg: Pool({max:1})`, warm-up first, 5 tx              | `[1,2,3,4,5]` 5 ms                      |
| `pg: Pool({max:2})`, default `verifyMarker`, 5 tx     | **TIMEOUT**                             |

Root cause (both observed and read from source): on the **first execute of a runtime's
lifetime** the runtime reads `prisma_contract.marker` (`VerifyMarkerOption =
'onFirstUse' | false`, `orm-family-sql/dist/prepared-statement-*.d.mts:251`; passed
through at `orm-postgres/dist/runtime.mjs:157`). That read goes through the driver's
_pool_, i.e. a **different connection** from the one the transaction holds. Inside
PGLiteSocketServer a handler with an open transaction holds the query queue
(`clearTransactionIfNeeded` / `isInTransaction` in `pglite-socket/dist/chunk-*.js`),
so the marker read on connection #2 waits for connection #1's `COMMIT`, which waits for
the marker read. With a `max:1` pool the second connection never exists at all — the
same deadlock without PGlite involved. The results `[1,2,3,4,5]` (monotonic counts) also
show PGlite executes concurrent transactions strictly one after another.

**Test-harness rule:** construct with `verifyMarker: false`, or run one throwaway query
before the first transaction. Once the marker has been read (or the table signed by
`dbUpdate`) transactions behave.

### Schema through Prisma's control client (`a-control.ts`) — works

```ts
import { createPostgresControlClient } from '@prisma/orm-postgres/control'
const control = createPostgresControlClient({ connection: url })
await control.dbUpdate({ contract: contractJson, mode: 'apply', migrationsDir }) // 50 ms
```

`orm-postgres/dist/control.mjs:17` wires family/target/adapter/driver for you.
`dbUpdate` planned and applied `CREATE TABLE "public"."Post"`/`"User"` (additive), wrote
the `prisma_contract.{contract,ledger,marker}` tables, signed the marker
(`storageHash 6f0dd8e7…`), and `schemaVerify({strict:true})` then reported zero issues.
`migrationsDir` is **required** (`orm-toolchain/dist/db-verify-*.d.mts:209`) but an
empty `mkdtemp` directory satisfies it for an app-only contract. `dbInit` after
`dbUpdate` is a no-op (`operationsPlanned: 0`). Timings: plan 38 ms, apply 50 ms,
verify 11 ms, whole sequence 133 ms.

Observed: `rel.belongsTo(...)` alone emitted **no FOREIGN KEY constraint** — only
`PRIMARY KEY` and `NOT NULL` — so relation integrity in a PGlite test DB is not enforced
unless the contract declares the FK explicitly (not explored).

### pgvector (`a-vector.ts`)

| step                                                                                     | result                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CREATE EXTENSION vector` on PGlite (bundle from `pglite-pgvector`)                      | OK, `extversion 0.8.1`                                                                  |
| raw `'[1,2,3]'::vector(3) <=> '[1,2,4]'::vector(3)`                                      | `0.00854`                                                                               |
| `field.column(vector(3))` + `defineContract({ extensions: { pgvector: pgvectorPack } })` | OK — column `{nativeType:'vector', codecId:'pg/vector@1', typeParams:{length:3}}`       |
| `dbUpdate` with `extensions: [pgvectorControl]`                                          | **FAIL** `MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION` `[declaredButUnmigrated] pgvector` |
| `dbUpdate` without the control descriptor                                                | **FAIL** `CONTRACT.PACK_CONTRIBUTION_INVALID` (no `expandNativeType` for `pg/vector@1`) |
| raw DDL `embedding vector(3) not null`                                                   | OK                                                                                      |
| `postgres({ contract, pg, extensions: [pgvectorRuntime] })` create                       | OK, `embedding: [1,2,3]` round-trips as `number[]`                                      |
| `.where(d => d.embedding.cosineDistance([1,2,3]).lt(0.5)).all()`                         | OK, 1 row                                                                               |
| `.orderBy(d => d.embedding.cosineDistance([1,2,3]).asc()).all()`                         | OK, nearest first                                                                       |

The vector field proxy exposes `eq, neq, in, notIn, isNull, isNotNull, cosineDistance,
cosineSimilarity`. The control-client path for an extension-declaring contract needs
the extension's own migration package on disk under `migrationsDir/pgvector/` — a
layout the (broken) CLI would normally write. UNKNOWN whether that layout can be
synthesised programmatically at rc.8; raw DDL for the vector column is the working
fallback.

---

## FACT B — a duck-typed fake driver (`b-fake-driver.ts`)

**Verdict: works.** `.all()`, `create()`, `where().update()`, `where().delete()`,
`transaction()`, and `include()` all complete end-to-end against a plain object with
canned rows.

### Exactly what the driver touches

Binding resolution: `orm-postgres/dist/runtime.mjs:15-16` (`isPgPool` checks
`totalCount/idleCount/waitingCount`; `isPgClient` checks `escapeIdentifier/escapeLiteral`),
`:39-65`. A `pgClient` binding becomes `PostgresDirectDriverImpl`
(`orm-target-postgres/dist/runtime-BJrfP1e8.mjs:461-533`). `orm-postgres` creates the
driver with `cursor: { disabled: true }` (`runtime.mjs:150`), so the pg-cursor / named
portal path (`:280-321`) is never taken.

| member                                                     | called from                                                                                                          | note                                                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `escapeIdentifier`, `escapeLiteral`                        | `"x" in pg` duck-test only (`runtime.mjs:16`)                                                                        | never invoked                                                                                                       |
| `on('error', fn)`                                          | `suppressIdleConnectionErrors` (framework `suppress-idle-connection-errors-*.mjs:15`) and `runtime-BJrfP1e8.mjs:471` | called **twice**                                                                                                    |
| `connect()`                                                | `:521` on first `acquireClient`; `isAlreadyConnectedError` tolerated                                                 |                                                                                                                     |
| `end()`                                                    | `:509` on `close()`                                                                                                  |                                                                                                                     |
| `query({ name, text, values, types })`                     | reads: `:332-336` → `result.rows`; executes: `:232-236` → `result.rowCount ?? 0`                                     | `name` is `undefined` unless a prepared handle is used; `types` is always present (temporal columns forced to text) |
| `query("BEGIN")` / `query("COMMIT")` / `query("ROLLBACK")` | `:363`, `:419`, `:428` — plain strings                                                                               | transactions are literal SQL strings                                                                                |
| `query(text, params)`                                      | `:272` — only for `explain()`                                                                                        | positional form                                                                                                     |
| `release`                                                  | `:374` `"release" in conn` — optional                                                                                | not needed for a Client                                                                                             |
| `then`                                                     | `Promise.resolve(client)` at `:352` inspects it                                                                      | must **not** be thenable                                                                                            |

Object identity matters: `acquireClientQueryLock` keys a `WeakMap` by the client
(`:145-153`), so hand the same object every time (a Proxy is fine).

### Minimal fake

```ts
const fake = {
  escapeIdentifier: (s) => s,
  escapeLiteral: (s) => s,
  on() {
    return this
  },
  async connect() {},
  async end() {},
  async query(cfg) {
    /* record cfg.text / cfg.values; return { rows, rowCount } */
  },
}
postgres({ contract, pg: fake, verifyMarker: false })
```

Recorded SQL for the reference queries (params are `$n`, values JS-typed):

- `where().all()` → `SELECT "Post"."id" AS "id", … FROM "public"."Post" WHERE ("Post"."authorId" = $1 AND "Post"."published" = $2)` `["u1", true]`
- `create()` → `INSERT INTO "public"."Post" (…) VALUES ($1,$2,$3,$4) RETURNING …`
- `where({id}).update({published:true})` → **4 calls**: `BEGIN`, `SELECT "Post"."id" … WHERE "Post"."id" = $1 LIMIT 1`, `UPDATE … SET "published" = $1 WHERE "Post"."id" = 'p1' RETURNING …` (the found id is inlined as a **literal**), `COMMIT`
- `where({id}).delete()` → `BEGIN`, id lookup, `COMMIT` (delete skipped when lookup returns no row → `null`)
- `include('posts')` → one SELECT with a correlated `json_agg(json_build_object(...))` subquery; the fake returns `posts` as a JS array and it passes through untouched

### First query = marker read, through the same fake

With the default `verifyMarker: 'onFirstUse'` the first execute issues three queries
**before** the user's query, all through the fake: `SELECT … FROM
"information_schema"."tables" WHERE table_schema=$1 AND table_name=$2`
`["prisma_contract","marker"]`, a `select column_name from information_schema.columns …`,
and `SELECT "marker"."core_hash", … FROM "prisma_contract"."marker" WHERE "marker"."space" = $1`
`["app"]`. A fake that returns its canned Post rows to these dies with
`CONTRACT.MARKER_ROW_CORRUPT`. Either answer them with `rows: []` (absent marker → a
warn log, then proceed) or pass `verifyMarker: false`, which removes them entirely
(verified: zero marker SQL).

### Decoding: rows must already be JS values

The runtime does **not** run pg type parsers itself; it relies on node-postgres having
done so (the `types` option it passes only overrides temporal OIDs to raw text). Fed
`published: 't'` the row came back `"t"` (string); `'true'` → `"true"`; `true` → `true`;
`1` → `1`. Extra columns are dropped; a missing projected column throws
`Row missing projection alias "title"`. So canned rows use normal JS types keyed by
projection alias. UNKNOWN: how `pg/timestamptz@1` etc. expect their text form (not
exercised — the contract had no temporal column).

---

## FACT C — observing the compiled plan (`c-ast.ts`)

`beforeCompile(draft, ctx)` (`orm-family-sql/dist/prepared-statement-*.d.mts:38-62`)
receives `draft.ast` (an `AnyQueryAst` class instance) and `draft.meta`. `ctx` keys:
`contract, mode, now, log, contentHash, scope, planExecutionId`.

**`draft.ast` is plain-data and snapshot-safe.** `JSON.stringify` works directly
(class instances with only data fields, `kind` discriminators everywhere), is identical
across two stringifies and across two identical queries (`same query twice → identical
AST JSON: true`). Sizes: simple select 1063 B, select+like 540 B, insert 1027 B, update
891 B, include 2136 B. The marker-read queries do **not** pass through `beforeCompile`.

Shape of `Post.where({authorId:'u1', published:true}).limit(5).all()`:

```json
{ "kind": "select",
  "from": { "kind": "table-source", "name": "Post", "namespaceId": "public" },
  "projection": [ { "kind": "projection-item", "alias": "id",
                    "expr": { "kind": "column-ref", "table": "Post", "column": "id" },
                    "codec": { "codecId": "pg/text@1" } }, … ],
  "where": { "kind": "and", "exprs": [
      { "kind": "binary", "op": "eq",
        "left":  { "kind": "column-ref", "table": "Post", "column": "authorId" },
        "right": { "kind": "param-ref", "value": "u1", "codec": { "codecId": "pg/text@1" } } },
      { "kind": "binary", "op": "eq", "left": {…"published"}, "right": { "kind": "param-ref", "value": true, … } } ] },
  "limit": 5,
  "selectAllIntent": { "table": "Post" } }
```

Other kinds seen: `insert` (`table`, `rows: [{col: param-ref…}]`, `returning`),
`update` (`table`, `set`, `where`, `returning`), `subquery` / `derived-table-source` for
`include`. Field-proxy operators available on a text column: `eq, neq, in, notIn, gt,
lt, gte, lte, like, ilike, isNull, isNotNull, asc, desc` (no `contains`).

**Annotations.** `draft.meta` own keys are `target, targetFamily, storageHash,
profileHash, lane` and, only when a terminal was called with a configure callback,
`annotations`: a plain object keyed by namespace —
`{"opensaas-session": {"__annotation": true, "namespace": "opensaas-session",
"value": {"userId": "alice"}, "applicableTo": ["read","write"]}}`. It is **not** a
`Map` at this point (the `CollectionState.annotations` Map is converted).
`handle.read({ meta: draft.meta })` returns the payload; `undefined` when absent.
Spelling that works: `.all((meta) => meta.annotate(handle({ userId })))` and
`.update(data, (meta) => meta.annotate(handle({...})))`.

**Security-relevant:** `where().update()` compiles **two** plans; only the second
(`UpdateAst`) carries the annotation. The preceding id-lookup `SelectAst` (`… WHERE
"Post"."id" = $1 LIMIT 1`) is un-annotated, and the `UpdateAst.where` is a
`{ kind: "literal", value: "p1" }` rather than the user's predicate. A middleware that
scopes by annotation therefore never sees a session on the lookup, and an `AND`-injected
filter on the update sees only the literal id.

---

## FACT D — inspecting a `Collection`'s state without executing (`d-state.ts`)

**Yes, at runtime; not as public API.** `CollectionState` is an exported _type_
(`orm-family-sql/dist/orm-client.d.mts:64-83`, exported at `:1453`) with
`filters, includes, orderBy, cursor, distinct, distinctOn, selectedFields, limit,
offset, variantName, annotations`. The collection object carries it as an own instance
field `state` (`CollectionImpl` at `:820`, `readonly state: CollectionState` at `:834`),
but it is marked `/** @internal */` in the typings — so `q.state` is a type error for a
consumer and needs a cast. There is no accessor function; the only related export is
`emptyState()` (`:84`). Also exported: `Collection` (a class/constructor surface, usable
for `instanceof`), `GroupedCollection`, `all, and, or, not, createModelAccessor, orm`.

Observed, with `postgres({ contract })` and **no binding at all** (nothing executes):

```
own keys: ctx, contract, modelName, tableName, namespaceId, state, registry, includeRefinementMode
state.filters: 2 × BinaryExpr, JSON == the same column-ref/param-ref shape as the AST above
state.orderBy: [{"kind":"order-by-item","expr":{column-ref Post.title},"dir":"asc"}]
state.limit: 5   offset: undefined   selectedFields: undefined   includes: 0   annotations.size: 0
immutability: base Post.state.filters = 0, derived q.state.filters = 2
Object.isFrozen(state) = false, isFrozen(q) = false
```

So `.where()` chains are visible as the un-merged `filters` array (AND-combined only at
compile), and the values are the same AST node classes `beforeCompile` sees — a test
can snapshot `JSON.stringify(q.state.filters)` without a driver. Relying on it means
relying on an `@internal` field; the `beforeCompile` route (FACT C) is the supported
way to assert the _composed_ plan.

---

## Known limits

- `PGLiteSocketServer` defaults to `maxConnections: 1`; with a pool it yields EPIPE /
  ECONNRESET, not queuing. The `maxConnections: 1` + immediately-reconnect case is
  timing-dependent (one of four variants passed once). Use ≥ pool size.
- First-use marker read + `db.transaction()` deadlocks on PGlite (and on any `max:1`
  pool). Mitigate with `verifyMarker: false` or a warm-up query. Not tested whether
  a signed marker (after `dbUpdate`) changes the _connection_ behaviour — it still
  reads through the pool on first use.
- PGlite executes one query at a time and serialises transactions; it will not surface
  real Postgres concurrency (`FOR UPDATE` contention, deadlocks, isolation anomalies).
- `createPostgresControlClient().dbUpdate()` refuses an extension-declaring contract
  (pgvector) without the extension's migration package on disk. Not established how to
  synthesise that layout programmatically at rc.8; used raw DDL for the vector column.
- `rel.belongsTo` emitted no FK constraint through `dbUpdate`; explicit FK declaration
  not explored.
- Fake-driver decoding was only checked for `pg/text@1` and `pg/bool@1`; temporal and
  JSON codecs (where the driver forces text) were not exercised.
- Startup numbers are from one machine; the 250 ms first-instance WASM-compile cost is
  per process (per vitest worker), not per suite.
- `db.sql` raw lane and `select()` with a projection callback were not exercised
  correctly (my API misuse), so they are not reported.
- PGlite `0.5.8` reports Postgres 17-family behaviour; not checked against the exact
  server version the stack targets.
