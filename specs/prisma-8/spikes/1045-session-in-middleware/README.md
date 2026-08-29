# Spike: how a per-session access predicate reaches Prisma 8 middleware

Resolves [#1045](https://github.com/OpenSaasAU/stack/issues/1045) on the
[Prisma 8 migration map](https://github.com/OpenSaasAU/stack/issues/1029).
Verified against `8.0.0-rc.8` (August 2026) on Postgres 16.

This is a throwaway spike, not library code. It does not build with the workspace
and is excluded from `pnpm build` / `pnpm test`.

## Running it

```bash
# a real Postgres on 5433 (prisma dev is PGlite-backed and one-connection-at-a-time)
initdb -D /var/tmp/pgspike/data -U postgres --auth=trust
pg_ctl -D /var/tmp/pgspike/data -o '-p 5433 -h 127.0.0.1' start
psql -h 127.0.0.1 -p 5433 -U postgres \
  -c 'create table "Post" (id text primary key, title text not null, "authorId" text not null, published boolean not null);' \
  -c "insert into \"Post\" values ('p1','alice pub','alice',true),('p2','alice draft','alice',false),('p3','bob pub','bob',true),('p4','bob draft','bob',false);"

npm install
npx tsx a-construction.ts   # per-request client construction cost
npx tsx a2-breakdown.ts     # where that cost goes, and how it scales with contract size
npx tsx b1-lazy.ts          # which call shapes carry an ALS store into beforeCompile
npx tsx b2-suite.ts         # concurrency, transactions, streaming, sudo
npx tsx c-annotations.ts    # annotation-carried session, and the omitted-annotation failure
npx tsx d-failclosed.ts     # both options with a throwing middleware; rebinding cost
npx tsx e-extra.ts          # connection accounting for url: vs pg:
```

## Results

### Per-request client (`a-construction.ts`, `a2-breakdown.ts`, `e-extra.ts`)

|                                         | 1-model contract | 41-model contract |
| --------------------------------------- | ---------------- | ----------------- |
| construct only                          | 0.23 ms          | **2.36 ms**       |
| shared client, one query                | 0.52 ms          | 0.64 ms           |
| construct + query                       | 2.18 ms          | **3.81 ms**       |
| first query on a pre-built fresh client | 1.72 ms          | 1.69 ms           |

`postgres()` re-derives the contract on every construction — two clients built from
the same `contractJson` do not share a `contract` reference, and neither is the
object passed in. `storageHash` is stable across constructions, so the derivation
is deterministic, just repeated. Construction scales with model count; the ~1.7 ms
first-query cost does not, and is a per-client warm-up a shared client amortises.

Pooling survives per-request construction **only** through `pg:`. Fifty fresh
clients over one externally-owned `pg.Pool` held the backend count at 1. Twenty
clients constructed with `url:` opened 21 backends — each owns its own pool — which
a one-connection-at-a-time local Postgres would deadlock on immediately. `close()`
releases cleanly (21 → 1), so this is a live-cost problem, not a leak.

### AsyncLocalStorage (`b1-lazy.ts`, `b2-suite.ts`)

ALS reaches `beforeCompile` — but only when execution _starts_ inside the scope.
`.all()` returns an `AsyncIterableResult`, not a Promise; the query is a value and
compilation begins at `.then()` / iteration.

| call shape                                           | store at `beforeCompile` |
| ---------------------------------------------------- | ------------------------ |
| `als.run(s, async () => await q.all())`              | present                  |
| `als.run(s, () => q.all().then(x => x))`             | present                  |
| `als.run(s, () => q.all())` — tail-return            | **absent**               |
| `als.run(s, () => { p = q.all() })`, awaited outside | **absent**               |
| iterator taken in scope, drained outside             | **absent**               |

Where the store is present it is correct: 0 cross-session leaks across 100
overlapping interleaved sessions with two queries each; correct inside
`db.transaction()`, including a transaction running concurrently with another
session; correct for `for await` streaming consumed in scope. Nested `als.run` gives
clean `withSession` / `sudo` rebinding.

The escapes are the fail-open, and they are exactly the shapes where a query value
outlives the scope that made it — adding or removing one `await` flips them.

### Annotations (`c-annotations.ts`)

`defineAnnotation` (from `@prisma/orm-framework/components/runtime`) works, and
`handle.read({ meta })` retrieves the payload in `beforeCompile`. Confirmed opt-in
per call site: `Post.all()` without `.annotate(...)` returned every row, no error,
no warning. Annotations do carry into `db.transaction()`.

### Fail-closed (`d-failclosed.ts`)

Both options fail closed if the middleware throws on a missing session — the throw
propagates out of `beforeCompile` and the query returns nothing.

|             | scoped               | escape shape | no session |
| ----------- | -------------------- | ------------ | ---------- |
| ALS         | rows for the session | **throws**   | **throws** |
| annotations | rows for the session | **throws**   | **throws** |

So neither option is inherently fail-open; what differs is how often the mistake is
reachable. ALS is set once per request at the boundary; an annotation must be
repeated at every call site.

`sudo` stays explicit and cheap under both: a nested `als.run({ sudo: true })`, or a
`sudo` payload on the annotation.

### Rebinding cost (`d-failclosed.ts`)

|                                 | per rebind  |
| ------------------------------- | ----------- |
| `als.run`                       | **0.09 µs** |
| fresh client, 1-model contract  | 302 µs      |
| fresh client, 41-model contract | ~2360 µs    |

## Known limits

- One model, no relations, no joins. Nested reads and write-side scoping are untested.
- `INSERT` has no `withWhere`; only `SelectAst` rewriting was exercised.
- Single process. Nothing here says how ALS behaves under a Next.js server-action
  or edge runtime, which is where the OpenSaaS request boundary actually sits.
- Numbers are local-socket Postgres. They measure CPU and client overhead, not
  anything network-bound.
- `8.0.0-rc.8` is pre-release and none of this carries a stability commitment.

## Incidental findings

- The `prisma` CLI at `8.0.0-rc.8` fails on every invocation, `--version` included,
  with `Cannot read properties of undefined (reading 'needs')`. `prisma@8.0.0-rc.8`
  pins `@prisma/orm-toolchain@8.0.0-rc.4` while the ORM packages pull `rc.8`.
  The runtime is unaffected; the tables here were created with `psql`.
- The contract builder exports first-class Postgres RLS handles — `rlsEnabled`,
  `role`, `policySelect` / `policyInsert` / `policyUpdate` / `policyDelete` — a seat
  for access control below the ORM that #1045 did not enumerate. Not evaluated here.
