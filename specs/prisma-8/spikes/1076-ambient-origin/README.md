# Spike 1076: an ambient origin for the tripwire (`8.0.0-rc.8`)

Fact-finding for [What does the tripwire become when no statement-level discriminator exists?](https://github.com/OpenSaasAU/stack/issues/1076), recorded as ADR-0059. [#1073](https://github.com/OpenSaasAU/stack/issues/1073) measured that a per-plan annotation reaches one plan per ORM terminal, so ADR-0049's tripwire would refuse the engine's own `update()`. This spike measures the alternative: an `AsyncLocalStorage` origin entered by the executing surface, read in `beforeCompile`.

Measured on Linux 6.18, Node v22.22.2, against an in-process PGlite over `@electric-sql/pglite-socket`, reusing the `1068-test-seams` harness (`contract.ts`, `pglite-server.ts`):

| package                       | version    |
| ----------------------------- | ---------- |
| `@prisma/orm-postgres`        | 8.0.0-rc.8 |
| `@electric-sql/pglite`        | 0.5.8      |
| `@electric-sql/pglite-socket` | 0.2.11     |
| `pg`                          | 8.23.0     |

Throwaway spike, not library code. Not part of the workspace.

## Running it

```bash
cd <this dir>
pnpm install --ignore-workspace
npx tsx als-probe.ts    # coverage per shape, non-leakage, interleaving, the Unsafe ORM Proxy, cost
npx tsx als-probe2.ts   # hook-shaped exits, per-terminal laziness, mid-transaction refusal, error surfacing
npx tsx f-probe.ts      # prepare(): beforeCompile once at prepare, zero per execution
```

`*.out` files are the captured runs the tables below are taken from.

## Coverage (`als-probe.ts`, section A)

A tripwire `beforeCompile` reads `originStore.getStore()`; each call below runs inside `originStore.run({ origin }, async () => await <call>)`.

| logical call                                 | statements | origin visible                       |
| -------------------------------------------- | ---------- | ------------------------------------ |
| `.where().all()`                             | 1          | **1/1**                              |
| `.include('posts').all()`                    | 1          | **1/1**                              |
| `.first()`                                   | 1          | **1/1**                              |
| `.aggregate()`                               | 1          | **1/1**                              |
| `create()` plain                             | 1          | **1/1**                              |
| `updateAll()`                                | 1          | **1/1**                              |
| `upsert()`                                   | 1          | **1/1**                              |
| `update()` one row                           | 2          | **2/2**                              |
| `delete()` one row                           | 2          | **2/2**                              |
| `deleteAll()` + include                      | 2          | **2/2**                              |
| nested `create` (User + posts)               | 3          | **3/3**                              |
| nested `connect` (Post → author)             | 3          | **3/3**                              |
| two terminal calls in one `db.transaction()` | 3          | **3/3**, each tagged by its own call |
| `dsl` plan via `runtime().query()`           | 1          | **1/1**                              |
| `raw` plan via `runtime().execute()`         | 1          | **1/1**                              |
| streaming `all()`, first `next()` in scope   | 1          | **1/1**                              |

Every shape #1073 found unstamped under the annotation (`1/2`, `0/3`) is fully covered. `BEGIN`/`COMMIT` do not pass `beforeCompile`.

## Non-leakage and fail direction (`als-probe.ts`, sections B and C)

| case                                                                                         | result                                                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| foreign query outside any scope                                                              | no origin → **refused**                                                                          |
| value built inside a scope, executed outside                                                 | no origin → **refused** (not run unscoped)                                                       |
| value built outside, executed inside                                                         | covered — execution is what is marked                                                            |
| foreign query inside a `db.transaction()` callback                                           | no origin → **refused**                                                                          |
| 60 concurrent `update()` (120 statements), alternating engine / unsafe / foreign, pool of 10 | every scoped call saw exactly its own tag on both statements; all 40 foreign statements saw none |

## Hooks and laziness (`als-probe2.ts`, sections H and I)

- A query issued from `originStore.exit(async () => await …)` inside a scoped terminal is **refused** — hooks can run outside the mark at no cost.
- Terminals returning Prisma's `AsyncIterableResult` — `all()`, `updateAll()`, `deleteAll()`, `runtime().query()` — execute at the first `then`/`next`, not at the call. Every other terminal (`first`, `aggregate`, `create`, `update`, `delete`, `upsert`, `runtime().execute()`) compiles after an internal `await` but in the context captured at the call, so it is covered wherever it is awaited. **Rule:** the scope must contain the `await`.
- The corollary: a lazy value created outside a scope and first-awaited inside one is covered (H2). Only the engine awaiting an application-supplied lazy result could meet this, and it does not.

## The Unsafe ORM lane (`als-probe.ts`, section D)

A generic `Proxy` over a `Collection` that runs every method call inside the unsafe scope, re-proxies a returned `Collection`, and wraps a lazy result so `then`/`toArray`/`first`/`[Symbol.asyncIterator]().next` re-enter the scope: `update()` 2/2, nested create 3/3, a chain whose terminal is called 5 ms later outside any scope, an `include` refinement callback, `for await` streaming, `first()`, `aggregate()` — all `unsafe`.

## Refusal semantics (`als-probe2.ts`, sections J and K)

Throwing on the **second** statement of `update()` rolled back the implicit transaction (row unchanged) and left the client usable, plain and inside `db.transaction()`. The thrown error reaches the caller unwrapped: `instanceof` the middleware's own class is `true` for both `all()` and `update()`.

## Cost (`als-probe.ts`, section E)

`originStore.run` around a sync function: **0.145 µs**. Around a warm `first()` on PGlite, 2000 interleaved iterations: 0.983 ms bare vs 0.918 ms scoped — no measurable difference.

## `prepare()` (`f-probe.ts`)

`db.prepare(declaration, cb)` ran `beforeCompile` **once**, at `prepare()`, where it saw the origin of the preparing scope. `prepared.query(runtime, params)` then executed with **zero** `beforeCompile` calls, and was **not refused** with the tripwire in throw mode. `prepare()` outside any scope is refused. A prepared statement is therefore a fail-open route unless `prepare` stays unexposed.

## Known limits

- PGlite serialises transactions, so the interleaving result establishes async-context isolation, not database concurrency.
- `ctx.scope` values (`runtime` / `connection` / `transaction`) were recorded but not relied on; #1073 already found them non-discriminating.
- The `upsert` DO-NOTHING fallback and the MTI create path were not exercised (as in #1073); nothing in their source suggests a different async context.
- Prisma's `PN_CONTRACT_TYPED_FALLBACK_AVAILABLE` warnings are the harness contract's string-token relations, not a finding.
- All results are `8.0.0-rc.8`, pre-release. The property relied on — `beforeCompile` running in the caller's async context — is re-verified implicitly by ADR-0057's suite running under the tripwire.
