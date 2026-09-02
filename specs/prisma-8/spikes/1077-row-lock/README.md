# Spike 1077: spelling the row lock over the raw lane (`8.0.0-rc.8`)

Fact-finding for [How is the row lock spelled when Prisma 8 has no FOR UPDATE?](https://github.com/OpenSaasAU/stack/issues/1077), recorded as ADR-0062. ADR-0047 made the row lock a two-statement terminal whose second statement is raw; [#1073](https://github.com/OpenSaasAU/stack/issues/1073) confirmed no ORM lock clause exists. This spike measures what the raw lane hands the engine for composing that statement — parameter codecs, identifier quoting, the transaction executor, Prisma's guardrails — and whether the statement behaves as ADR-0047 says under real contention.

Measured on macOS (Darwin 25.5), Node v22, against **PostgreSQL 14.20** (Homebrew, for contention and a second connection) and **PGlite** over `@electric-sql/pglite-socket` (the default dev loop, parse and single-connection behaviour), reusing the `1076-ambient-origin` harness (`contract.ts`, `pglite-server.ts`):

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
DATABASE_URL='postgres://<user>@localhost/<db>?host=/tmp' npx tsx lock-probe.ts   # both suites
npx tsx lock-probe.ts                                                              # PGlite suite only
```

`lock-probe.out` is the captured run the tables below are taken from. A `recorder` middleware captures each plan's rendered `sql` and `params` in `beforeQuery`/`beforeExecute`; every case runs inside `db.transaction()` and executes through `tx.query(plan)` or `tx.execute(plan)`.

## A. What the contract and the target package hand the engine

| fact                                                        | value                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `storage.namespaces.public.entries.table.Post.primaryKey`   | `{ columns: ['id'] }`                                  |
| `codecRefForStorageColumn(storage, 'public', 'Post', 'id')` | `{ codecId: 'pg/text@1' }`                             |
| `quoteIdentifier('Post')` / `qualifyName('public','Post')`  | `"Post"` / `"public"."Post"`                           |
| `quoteIdentifier('we"ird')`                                 | `"we""ird"` — doubled, i.e. real quoting, not wrapping |

`quoteIdentifier`, `qualifyName`, `quoteQualifiedName` are exported from `@prisma/orm-postgres/target/sql-utils`; `param` from `@prisma/orm-postgres/relational-core/expression`; `codecRefForStorageColumn` from `@prisma/orm-postgres/relational-core/codec-descriptor-registry`; `lints`/`budgets` from `@prisma/orm-postgres/family-runtime`.

## B. Spellings (identical on Postgres 14 and PGlite)

| case | spelling                                                                    | rendered                                                                                    | result                                                 |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| B1   | `IN (${param(k, {codecId})}, …)` with the identity column's codec           | `… WHERE "id" IN ($1, $2) ORDER BY "id" FOR UPDATE`                                         | rows back, `[p1, p2]`                                  |
| B2   | `= ANY(${param(keys, {codecId: PG_TEXT_ARRAY_CODEC_ID})})`                  | `… WHERE "id" = ANY($1::text[]) …`                                                          | works — but only a `text[]` array codec ships at rc.8  |
| B3   | bare `${'p1'}` interpolation (inferred codec)                               | `… IN ($1, $2) …`, params typed `pg/text@1`                                                 | works                                                  |
| B4   | splice a typed `db.sql.public.Post.select('id').where(…)` then `FOR UPDATE` | —                                                                                           | **throws** `value.buildAst(...).parts is not iterable` |
| B5   | hand-written `(SELECT …) FOR UPDATE`                                        | parenthesised form                                                                          | works, `LockRows` (C2)                                 |
| B6   | **engine spelling**: tag invoked programmatically over assembled strings    | `SELECT "id" FROM "public"."Post" WHERE "id" IN ($1, $2) ORDER BY "id" LIMIT $3 FOR UPDATE` | rows back                                              |
| B7   | uuid pk, bare string param                                                  | `… IN ($1) …` (no cast; Postgres coerces)                                                   | works                                                  |
| B8   | uuid pk, `param(v, {codecId: PG_UUID_CODEC_ID})`                            | `… IN ($1::uuid) …`                                                                         | works — the codec is what puts the cast on             |
| B9   | same statement through `tx.execute(plan)` (`affectedCount()`)               |                                                                                             | `{ affectedRows: 1 }` — locks, returns no keys         |
| B10  | `SELECT pg_advisory_xact_lock(hashtext(${key}))` via `execute()`            |                                                                                             | 1 advisory lock visible in `pg_locks` for the backend  |

B4 is the finding that fixes ownership: `templateParts` treats any interpolation with both `buildAst` and `build` as a raw row query and spreads `.buildAst().parts`; a DSL `SelectQuery` has both methods and a `SelectAst` has no `parts`. So at rc.8 a typed query cannot be spliced into the raw tag, and "Prisma renders everything but the two words" is not an available shape. The where-lambda's functions are `eq`, `in`, `and` (on `fns`, not on the field).

## C. It is a lock

| case | evidence                                                                               |
| ---- | -------------------------------------------------------------------------------------- |
| C1   | `EXPLAIN` of B1: `LockRows → Sort (id) → Bitmap Heap Scan on "Post"` — on both targets |
| C2   | `EXPLAIN` of the parenthesised B5 form: `LockRows → Index Scan using "Post_pkey"`      |
| C3   | `pg_locks` for the backend inside the transaction: `RowShareLock` on `"public"."Post"` |

## D. Prisma's guardrails are opt-in, and the statement passes them

`PostgresOptionsBase.middleware` is the only way a guardrail is installed; the client adds none. `classifyStatement` is prefix-anchored (`^(insert|update|delete|create|alter|drop|truncate)\b`), so `FOR UPDATE` never reads as a mutation.

| case | middleware                                    | statement     | result                                            |
| ---- | --------------------------------------------- | ------------- | ------------------------------------------------- |
| D1   | `lints()`                                     | no `LIMIT`    | passes (`LINT.NO_LIMIT` is a **warn** by default) |
| D2   | `lints()`                                     | `LIMIT $n`    | passes                                            |
| D2b  | `lints({ severities: { noLimit: 'error' } })` | no `LIMIT`    | **throws** `Raw SQL plan omits LIMIT clause`      |
| D2c  | `budgets()`                                   | no `LIMIT`    | passes                                            |
| D2d  | `budgets()`                                   | `LIMIT $n`    | passes                                            |
| D3   | `lints()`                                     | ORM `first()` | passes (control)                                  |

## E. Contention and the vanished row (Postgres 14 only — PGlite serialises transactions)

| case | scenario                                                                  | result                                                                 |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| E1   | tx A locks `p1`; connection B `FOR UPDATE NOWAIT` on `p1`, then on `p3`   | B on `p1`: **`55P03`** (lock_not_available); B acquires `p3`           |
| E2   | after A commits                                                           | B acquires `p1`                                                        |
| E3   | A reads `[p1, p2]` through the ORM; B deletes `p2`; A locks `IN (p1, p2)` | locked = **`[p1]`** — the subset, exactly ADR-0047's vanished-row rule |
| E4   | B holds `p1`; A locks `IN (p1, p3) … FOR UPDATE SKIP LOCKED`              | `[p3]` — `SKIP LOCKED` is free at the SQL level, as ADR-0047 assumed   |

## Also checked, statically

- `@prisma/orm-family-sql@8.0.0-rc.8-dev.12` (the `dev` dist-tag, published 2026-09-02): `AnyQueryAst = SelectAst | InsertAst | UpdateAst | DeleteAst | RawQueryAst` unchanged; the only `FOR UPDATE` strings are still the RLS-policy docblock and the `selectedForUpdate` local. Nothing newer than rc.8 is published under `latest`.
- `adapter/column-types` ships no `uuidColumn` at rc.8 (`textColumn`, `int4Column`, `int8Column`, … only); `PG_UUID_CODEC_ID` exists in `target/codec-ids` and `pgUuidColumn` in `target`. The `Slot` table in B7/B8 was created by DDL, outside the contract.

## Known limits

- The contract here has text ids. B7/B8 exercise a uuid column through raw DDL rather than a contract model, so the codec-binding claim for uuid rests on `param()` plus the rendered `$1::uuid`, not on `codecRefForStorageColumn` over a uuid-typed storage column.
- Contention was measured with `pg` as the second connection, not a second Prisma client; nothing in the lock's behaviour depends on which client holds the other side.
- `budgets()` on PGlite hit `ECONNRESET` once with `maxConnections: 4` (three extra clients open at once); it passed at 16. A harness artefact, not a finding.
- Deadlock avoidance via `ORDER BY <pk>` is not exercised — it is a property of Postgres's lock acquisition order, not of anything the raw lane does.
