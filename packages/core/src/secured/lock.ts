// The row lock's second statement: the engine-composed `SELECT … FOR UPDATE`
// over the primary keys a scoped read returned, and the advisory lock beside
// it. Prisma owns quoting, placeholders, codecs and the executor; the stack
// owns the clause text. See ADR-0047 and ADR-0062.

import type { ParamRef, RuntimeScope, SqlOrmPlan } from '@prisma/orm-postgres/relational-core'
import { param } from '@prisma/orm-postgres/relational-core'
import { codecRefForStorageColumn } from '@prisma/orm-postgres/relational-core/codec-descriptor-registry'
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types'
import { quoteIdentifier } from '@prisma/orm-postgres/target/sql-utils'
import type { OrmRow } from '../access/types.js'
import { DatabaseError } from '../lib/database-errors.js'
import { withOrigin } from '../origin.js'

/**
 * The most keys one `forUpdate()` terminal will lock.
 *
 * A cost limit, fail-closed, in the shape of the include-depth cap
 * (`READ_INCLUDE_MAX_DEPTH`, ADR-0043) rather than an inability to scope. One
 * placeholder is bound per key, and Postgres sends the parameter count as a
 * 16-bit integer: over its 65,535 ceiling the statement arrives as a corrupted
 * bind (`bind message has 65 parameter formats but 0 parameters` at 65,600
 * keys) rather than a clean refusal, so the engine refuses well under it. A
 * row lock is a mutex token for a gate, not a bulk operation; a lock over
 * thousands of rows belongs on the Unsafe surface with its cost stated
 * (ADR-0062).
 */
export const ROW_LOCK_MAX_KEYS = 1000

/** A primary-key value the lock statement binds. */
export type RowLockKey = string | number

/**
 * Where one list's rows are locked: the qualified table, its single
 * primary-key column, and the codec that column's values bind with — all read
 * off the contract's storage, the same place the ORM's own `update()` reads
 * them (ADR-0062).
 */
export interface RowLockIdentity {
  readonly namespace: string
  readonly table: string
  readonly column: string
  readonly codecId: string
}

/**
 * Thrown when a list's rows cannot be locked because the contract gives them
 * no single-column primary key to lock them by.
 *
 * Matches the ORM's own `ROW_IDENTITY_MISSING` on `update()`: composite keys
 * are outside this map's scope, and a table with no identity column has no
 * `WHERE` the engine could write (ADR-0062).
 */
export class RowLockIdentityError extends Error {
  constructor(
    readonly listName: string,
    detail: string,
  ) {
    super(
      `Cannot lock rows of "${listName}": ${detail}. \`forUpdate()\` locks the identity row, so ` +
        `the list's table needs a single-column primary key.`,
    )
    this.name = 'RowLockIdentityError'
  }
}

/**
 * Thrown when `forUpdate()` or `advisoryLock()` is reached on a context that
 * is not bound to a transaction.
 *
 * The type makes this unreachable from a generated project — both are on the
 * transaction-bound surface alone — so this is the backstop for a read
 * composed through the engine's own untyped view. `FOR UPDATE` outside an
 * explicit transaction takes the lock and drops it at statement end: it would
 * run, return rows, and do nothing (ADR-0047).
 *
 * A context that *is* inside a transaction but whose client cannot compose the
 * statement raises {@link RowLockLaneUnavailableError} instead, so neither
 * message has to cover the other's cause.
 */
export class RowLockUnavailableError extends Error {
  constructor(readonly member: string) {
    super(
      `${member} needs a transaction: a row lock taken outside one is released at the end of the ` +
        `statement that took it, so it would guard nothing. Compose the read inside ` +
        `\`context.transaction(async (tx) => …)\` and reach it through \`tx.db\`.`,
    )
    this.name = 'RowLockUnavailableError'
  }
}

/**
 * Thrown inside a transaction whose client carries no lane to compose the lock
 * statement through — its `raw` tag or its emitted `contract` is not the shape
 * {@link createRowLockLane} needs.
 *
 * The reachable case is a context assembled over a hand-built ORM double,
 * whose `raw`/`contract` are carried as `object` so such a context still
 * type-checks. It fails closed, and it is a different fact from
 * {@link RowLockUnavailableError}: the caller *is* in a transaction, and being
 * told to open one would send them looking in the wrong place.
 */
export class RowLockLaneUnavailableError extends Error {
  constructor(readonly member: string) {
    super(
      `${member} cannot compose its lock statement: this context is inside a transaction, but ` +
        `its client carries no usable raw lane and emitted contract to write the statement ` +
        `through. A context assembled over a hand-built ORM double cannot take database locks — ` +
        `reach the database through a generated Prisma 8 client.`,
    )
    this.name = 'RowLockLaneUnavailableError'
  }
}

/**
 * Thrown when a `forUpdate()` terminal would bind more than
 * {@link ROW_LOCK_MAX_KEYS} keys — a cost limit, fail-closed, raised before
 * the lock statement is issued.
 */
export class RowLockKeyLimitExceededError extends DatabaseError {
  constructor(
    readonly listName: string,
    readonly keys: number,
  ) {
    super(
      `Cannot lock ${keys} rows of "${listName}": \`forUpdate()\` locks at most ` +
        `${ROW_LOCK_MAX_KEYS} rows in one terminal. This is a cost limit — the row lock is a ` +
        `mutex token for a gate, not a bulk operation. Narrow the read, or take the lock on the ` +
        `contended parent row instead.`,
    )
    this.name = 'RowLockKeyLimitExceededError'
  }
}

/**
 * What the raw builder gives the lock statement. Narrower than Prisma's own
 * `ContractRawBuilder` on purpose: these are the two terminators the engine
 * uses, and nothing here re-implements the tag.
 */
interface RowLockRawBuilder {
  returnsRow(spec: Record<string, string>): { build(): SqlOrmPlan<OrmRow> }
  affectedCount(): { build(): SqlOrmPlan }
}

/** The contract-bound raw tag (`client.raw.sql`), as the lock statement invokes it. */
type RowLockRawTag = (
  strings: TemplateStringsArray,
  ...values: readonly (ParamRef | string | number)[]
) => RowLockRawBuilder

/**
 * The lane one transaction-bound context locks through: the contract's storage
 * for the identity coordinates, the client's raw tag for the statement, and
 * the transaction's own executor so the lock is held by the transaction that
 * asked for it.
 */
export interface RowLockLane {
  /** Where `listName`'s rows live, or a throw naming why they cannot be locked. */
  identity(listName: string): RowLockIdentity
  /** Lock exactly `keys`, and answer with the ones that were still there. */
  lock(
    listName: string,
    identity: RowLockIdentity,
    keys: readonly RowLockKey[],
  ): Promise<RowLockKey[]>
  /** Take the transaction-scoped advisory lock on `key`. */
  advisory(key: string): Promise<void>
}

/**
 * The slice of a built Prisma 8 contract the lock lane reads: a model's
 * physical table and namespace, and the storage the identity column's primary
 * key and codec come off. Declared structurally, the way
 * {@link EmittedContract} is, so the lane reads the contract without importing
 * its full generic shape.
 */
interface RowLockContract {
  readonly domain: {
    readonly namespaces: Readonly<
      Record<
        string,
        {
          readonly models: Readonly<
            Record<string, { readonly storage: { readonly table: string } }>
          >
        }
      >
    >
  }
  readonly storage: SqlStorage
}

interface RowLockRawLane {
  readonly sql: RowLockRawTag
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Presence, not completeness — the rule `isReadableCollection` states in
 * `read.ts`, for the same reason. The client's raw lane and contract are
 * carried as `object` on {@link UnsafeCapableClient} so a context assembled
 * from a hand-built double still type-checks; what is asserted here is that
 * the members the lock statement reaches are actually there, and a member that
 * is genuinely absent surfaces at its own call site.
 */
function isRawLane(value: unknown): value is RowLockRawLane {
  return isRecord(value) && typeof value.sql === 'function'
}

function isContract(value: unknown): value is RowLockContract {
  return isRecord(value) && isRecord(value.domain) && isRecord(value.storage)
}

/**
 * The table a model is stored in, and the namespace it lives in. The contract
 * keys storage by physical table name and the engine reaches a model by list
 * key, so the domain side is what joins the two — the same reconciliation
 * `ormHandleFor` performs for collections.
 */
function locate(
  contract: RowLockContract,
  listName: string,
): { namespace: string; table: string } | undefined {
  for (const [namespace, entry] of Object.entries(contract.domain.namespaces)) {
    const model = entry.models[listName]
    if (model !== undefined) return { namespace, table: model.storage.table }
  }
  return undefined
}

/** The single primary-key column of a storage table, or `undefined`. */
function soleKeyColumn(storage: SqlStorage, namespace: string, table: string): string | undefined {
  const entry: unknown = storage.namespaces[namespace]?.entries.table?.[table]
  if (!isRecord(entry)) return undefined
  const primaryKey = entry.primaryKey
  if (!isRecord(primaryKey)) return undefined
  const columns = primaryKey.columns
  if (!Array.isArray(columns) || columns.length !== 1) return undefined
  const column: unknown = columns[0]
  return typeof column === 'string' ? column : undefined
}

/**
 * The statement, assembled: `SELECT <pk> FROM <table> WHERE <pk> IN ($1…$n)
 * ORDER BY <pk> LIMIT $n+1 FOR UPDATE`.
 *
 * The engine writes the clause text and nothing else. Identifiers are quoted
 * by the target package's own helper, each key is bound with the identity
 * column's codec — so a `uuid` key renders `$1::uuid` and a text key `$1` —
 * and the `LIMIT` is the key count, true by construction and the one bound an
 * armed `lints()` would otherwise refuse (ADR-0062).
 *
 * `ORDER BY <pk>` is always emitted, so lock acquisition order is the same in
 * every session and the overlapping-set deadlock class is closed by
 * construction rather than by advice (ADR-0047). The key order in the `IN`
 * list is the read's own and carries no meaning: Postgres acquires in the
 * `ORDER BY`, not in the list.
 */
function lockStatement(
  identity: RowLockIdentity,
  keys: readonly RowLockKey[],
): { strings: TemplateStringsArray; values: (ParamRef | number)[] } {
  const column = quoteIdentifier(identity.column)
  const table = `${quoteIdentifier(identity.namespace)}.${quoteIdentifier(identity.table)}`
  const parts = [
    `SELECT ${column} FROM ${table} WHERE ${column} IN (`,
    ...keys.slice(1).map(() => ', '),
    `) ORDER BY ${column} LIMIT `,
    ' FOR UPDATE',
  ]
  return {
    strings: Object.assign(parts, { raw: parts }),
    values: [...keys.map((key) => param(key, { codecId: identity.codecId })), keys.length],
  }
}

function keyOf(row: OrmRow, column: string): RowLockKey | undefined {
  const value = row[column]
  return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

/**
 * The lane a transaction whose client cannot compose the statement carries
 * instead of none at all: every member refuses with
 * {@link RowLockLaneUnavailableError}.
 *
 * A lane rather than `undefined` so the seat's absence keeps meaning exactly
 * one thing — no transaction — and this case answers with its own cause. The
 * refusal lands where a working lane's first statement would: `identity()` is
 * resolved before the scoped read runs, so nothing is issued either way.
 */
export function unusableRowLockLane(): RowLockLane {
  return {
    identity: (): never => {
      throw new RowLockLaneUnavailableError('forUpdate()')
    },
    lock: (): never => {
      throw new RowLockLaneUnavailableError('forUpdate()')
    },
    advisory: (): never => {
      throw new RowLockLaneUnavailableError('advisoryLock()')
    },
  }
}

/**
 * Build the lane a transaction-bound context locks through.
 *
 * `raw` comes from the client because Prisma's transaction context carries
 * none — the tag is contract-scoped, built once per client, and the plans it
 * mints run wherever they are handed. `scope` is the transaction's own
 * executor, which is what makes the lock the transaction's (ADR-0056,
 * ADR-0062).
 */
export function createRowLockLane(
  rawLane: unknown,
  contract: unknown,
  scope: RuntimeScope,
): RowLockLane | undefined {
  if (!isRawLane(rawLane) || !isContract(contract)) return undefined
  const tag = rawLane.sql

  return {
    identity(listName: string): RowLockIdentity {
      const located = locate(contract, listName)
      if (located === undefined) {
        throw new RowLockIdentityError(listName, 'the contract declares no model of that name')
      }
      const column = soleKeyColumn(contract.storage, located.namespace, located.table)
      if (column === undefined) {
        throw new RowLockIdentityError(
          listName,
          `"${located.namespace}"."${located.table}" has no single-column primary key`,
        )
      }
      const codec = codecRefForStorageColumn(
        contract.storage,
        located.namespace,
        located.table,
        column,
      )
      if (codec === undefined) {
        throw new RowLockIdentityError(
          listName,
          `the contract carries no codec for "${located.table}"."${column}"`,
        )
      }
      return { ...located, column, codecId: codec.codecId }
    },

    async lock(
      listName: string,
      identity: RowLockIdentity,
      keys: readonly RowLockKey[],
    ): Promise<RowLockKey[]> {
      // No keys, no statement. `lockStatement` has one fragment per key, so at
      // arity 0 the tag never consumes its trailing fragment and the statement
      // arrives without `FOR UPDATE` and with a dangling `LIMIT` — a Postgres
      // syntax error rather than an empty result (ADR-0062).
      if (keys.length === 0) return []
      if (keys.length > ROW_LOCK_MAX_KEYS) {
        throw new RowLockKeyLimitExceededError(listName, keys.length)
      }
      const { strings, values } = lockStatement(identity, keys)
      const plan = tag(strings, ...values)
        .returnsRow({ [identity.column]: identity.codecId })
        .build()
      const rows = await withOrigin('engine', () => scope.query(plan).toArray())
      return rows.flatMap((row) => {
        const key = keyOf(row, identity.column)
        return key === undefined ? [] : [key]
      })
    },

    async advisory(key: string): Promise<void> {
      const plan = tag`SELECT pg_advisory_xact_lock(hashtext(${key}))`.affectedCount().build()
      await withOrigin('engine', () => scope.execute(plan))
    },
  }
}
