import type { UnsafeCapableClient, UnsafeTransactionScope } from '../src/unsafe.js'

/** The in-memory stand-in for the database: one map of rows per table. */
export type MockTables = Record<string, Map<string, Record<string, unknown>>>

/**
 * A Prisma-8-shaped client over an in-memory ORM double — what the engine's
 * transactions are opened through (`client.transaction`), beside the collection
 * map it is handed as its ORM handle.
 *
 * `transaction` models a database's atomicity by snapshotting every table on
 * entry and restoring them on a throw. The collections it hands the callback
 * are the same objects, so a write inside lands in `tables` and is undone by
 * the restore rather than staged — indistinguishable from the outside, and it
 * keeps the double's `findUnique`/`findMany` reading its own uncommitted rows
 * the way a real transaction does.
 *
 * It also models the single connection a Prisma 8 transaction holds for its
 * whole callback: a second `transaction` opened while one is in flight throws
 * rather than nesting. Against a real single-connection pool that shape does
 * not fail, it waits for a connection that is never freed — so the ADR-0028
 * invariant that a nested write JOINS rather than opening its own is
 * falsifiable here as an immediate error instead of a multi-minute deadlock.
 */
export interface Prisma8DoubleOptions {
  /** The namespace the collections hang off `orm`, matching `db.schema`. */
  namespace?: string
  /**
   * Extra state a double keeps beside its tables — relation links, counters —
   * captured on entry and returned as the closure that puts it back.
   */
  snapshot?: () => () => void
}

export function prisma8Double(
  models: Record<string, unknown>,
  tables: MockTables,
  options: Prisma8DoubleOptions = {},
): UnsafeCapableClient {
  const unreachable = (): never => {
    throw new Error('the double runs no plans')
  }
  const orm = { [options.namespace ?? 'public']: models }
  let open = false
  return {
    sql: {},
    raw: {},
    contract: {},
    orm,
    runtime: () => ({ query: unreachable, execute: unreachable }),
    transaction: async <R>(fn: (tx: UnsafeTransactionScope) => PromiseLike<R>): Promise<R> => {
      if (open) {
        throw new Error(
          'the double holds one connection: a write inside a transaction must join it, not open a second',
        )
      }
      open = true
      const rows: MockTables = {}
      for (const [name, table] of Object.entries(tables)) rows[name] = new Map(table)
      const restoreExtra = options.snapshot?.()
      try {
        return await fn({ sql: {}, orm, query: unreachable, execute: unreachable })
      } catch (error) {
        for (const [name, table] of Object.entries(rows)) tables[name] = table
        restoreExtra?.()
        throw error
      } finally {
        open = false
      }
    },
  }
}
