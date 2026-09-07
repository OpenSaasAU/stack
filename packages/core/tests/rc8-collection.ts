import { vi, type Mock } from 'vitest'
import type { OrmRow } from '../src/access/types.js'

/**
 * An rc.8-shaped collection double: the composition members return the
 * collection itself and the terminals answer from a queue of canned rows.
 *
 * A composed predicate is recorded and never evaluated. That is deliberate and
 * bounded — the lowering of a predicate onto real columns is proved against a
 * real database in `src/context/write-transaction.test.ts` and the secured-read
 * suites; the subject here is the pipeline around the statement, so what these
 * doubles need to answer is "how many predicates did this write compose", not
 * "which rows do they match".
 */
export interface CollectionDouble {
  where: Mock
  select: Mock
  orderBy: Mock
  include: Mock
  limit: Mock
  offset: Mock
  distinct: Mock
  distinctOn: Mock
  cursor: Mock
  first: Mock
  all: Mock
  aggregate: Mock
  create: Mock
  update: Mock
  delete: Mock
  findUnique: Mock
  findFirst: Mock
  findMany: Mock
  count: Mock
  /** Every predicate composed onto this collection, oldest first. */
  readonly predicates: unknown[]
}

export interface CollectionDoubleOptions {
  /**
   * What `first()` answers, call by call. A shorter list than the number of
   * calls repeats its last entry, so a target read and its filter re-read can
   * share one answer.
   */
  first?: (OrmRow | null)[]
  all?: OrmRow[]
  rows?: number
  create?: OrmRow
  update?: OrmRow | null
  delete?: OrmRow | null
  /** Called with the member's name before it answers — an order log. */
  onCall?: (member: string) => void
}

function answer<T>(queue: readonly T[] | undefined, call: number, fallback: T): T {
  if (queue === undefined || queue.length === 0) return fallback
  return queue[Math.min(call, queue.length - 1)]
}

export function rc8Collection(options: CollectionDoubleOptions = {}): CollectionDouble {
  const predicates: unknown[] = []
  const log = (member: string): void => options.onCall?.(member)
  let firstCalls = 0

  const collection: Partial<CollectionDouble> = {
    predicates,
    first: vi.fn(async () => {
      log('first')
      return answer(options.first, firstCalls++, null)
    }),
    all: vi.fn(async () => {
      log('all')
      return options.all ?? []
    }),
    aggregate: vi.fn(async () => {
      log('aggregate')
      return { rows: options.rows ?? 0 }
    }),
    create: vi.fn(async (data: OrmRow) => {
      log('create')
      return options.create ?? { id: '1', ...data }
    }),
    update: vi.fn(async (data: OrmRow) => {
      log('update')
      return options.update === undefined ? { id: '1', ...data } : options.update
    }),
    delete: vi.fn(async () => {
      log('delete')
      return options.delete === undefined ? { id: '1' } : options.delete
    }),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => options.rows ?? 0),
  }

  collection.where = vi.fn((predicate: unknown) => {
    predicates.push(predicate)
    return collection
  })
  for (const member of [
    'select',
    'orderBy',
    'include',
    'limit',
    'offset',
    'distinct',
    'distinctOn',
    'cursor',
  ] as const) {
    collection[member] = vi.fn(() => collection)
  }

  return collection as CollectionDouble
}
