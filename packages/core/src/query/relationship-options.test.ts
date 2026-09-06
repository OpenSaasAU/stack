import { describe, it, expect } from 'vitest'
import { getRelationshipOptions } from './relationship-options.js'
import type { QueryRunnerContext, RelationshipOptionsQuery } from './relationship-options.js'
import type { OrderBy, Where } from '../secured/vocabulary.js'
import type { OpenSaasConfig } from '../config/types.js'

/** One composed read, as the primitive built it, recorded when its terminal ran. */
interface RecordedRead {
  where: Where[]
  orderBy: OrderBy | undefined
  select: readonly string[]
  limit: number | undefined
}

/**
 * A composed-read double. The projection is the point of these assertions —
 * a read that names no `select` computes every field of every row it returns
 * (#1249 review) — so the double records what each chain composed rather than
 * only that it ran.
 */
function makeDelegate(rows: Array<Record<string, unknown>>) {
  const calls: RecordedRead[] = []
  const queue: Array<Array<Record<string, unknown>>> = []

  function build(read: RecordedRead): RelationshipOptionsQuery {
    return {
      where: (predicate: Where) => build({ ...read, where: [...read.where, predicate] }),
      orderBy: (order: OrderBy) => build({ ...read, orderBy: order }),
      select: (...fields: readonly string[]) => build({ ...read, select: fields }),
      limit: (count: number) => build({ ...read, limit: count }),
      all: async () => {
        calls.push(read)
        return queue.shift() ?? rows
      },
    }
  }

  return {
    calls,
    queue,
    query: build({ where: [], orderBy: undefined, select: [], limit: undefined }),
  }
}

function makeContext(
  delegates: Record<string, ReturnType<typeof makeDelegate>>,
): QueryRunnerContext {
  const db: Record<string, RelationshipOptionsQuery> = {}
  for (const [key, delegate] of Object.entries(delegates)) db[key] = delegate.query
  return { db }
}

const authors = [
  { id: 'a1', name: 'Ada Lovelace' },
  { id: 'a2', name: 'Alan Turing' },
  { id: 'a3', name: 'Grace Hopper' },
]

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Author: {
        fields: {
          name: { type: 'text' },
        },
        access: { operation: { query: () => true } },
      },
      NumericLabel: {
        fields: {
          rank: { type: 'integer' },
        },
        ui: { labelField: 'rank' },
        access: { operation: { query: () => true } },
      },
      VirtualLabel: {
        fields: {
          displayName: { type: 'virtual', virtual: true },
        },
        ui: { labelField: 'displayName' },
        access: { operation: { query: () => true } },
      },
    },
  } as unknown as OpenSaasConfig
}

describe('getRelationshipOptions', () => {
  it('returns { id, label }[] from a projection of id and the label field alone', async () => {
    const delegate = makeDelegate(authors)
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'Author', {})

    expect(result).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a2', label: 'Alan Turing' },
      { id: 'a3', label: 'Grace Hopper' },
    ])

    // The projection is what keeps every other field's `resolveOutput` from
    // running over the window, and what keeps a `needs` on this list from
    // widening the read into a relation.
    expect(delegate.calls[0].select).toEqual(['id', 'name'])
  })

  it('bounds the result by take', async () => {
    const delegate = makeDelegate(authors.slice(0, 2))
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { take: 2 })

    expect(delegate.calls[0].limit).toBe(2)
  })

  it('orders by the label field ascending and filters via contains on a text label field', async () => {
    const delegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { search: 'Ada' })

    expect(delegate.calls[0].where).toEqual([{ name: { contains: 'Ada' } }])
    expect(delegate.calls[0].orderBy).toEqual({ name: 'asc' })
  })

  it('does not filter (first-N) when the label field is not a text field', async () => {
    const rows = [{ id: 'n1', rank: 1 }]
    const delegate = makeDelegate(rows)
    const context = makeContext({ NumericLabel: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'NumericLabel', { search: '1' })

    expect(delegate.calls[0].where).toEqual([])
    expect(delegate.calls[0].orderBy).toEqual({ rank: 'asc' })
  })

  it('falls back to ordering by id when the label field is virtual (no backing column)', async () => {
    const rows = [{ id: 'v1', displayName: 'Computed One' }]
    const delegate = makeDelegate(rows)
    const context = makeContext({ VirtualLabel: delegate })
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'VirtualLabel', { search: 'One' })

    // Virtual label fields have no backing column, so ordering by them would
    // 500 in Prisma — order by id instead, and skip the text `contains` filter.
    expect(delegate.calls[0].orderBy).toEqual({ id: 'asc' })
    expect(delegate.calls[0].where).toEqual([])
    expect(result).toEqual([{ id: 'v1', label: 'Computed One' }])
  })

  it('treats a field flagged virtual via type alone as non-orderable (orders by id)', async () => {
    const config = makeConfig()
    // Only `type: 'virtual'` is set here (no `virtual: true`) to lock in the
    // discriminator against future refactors.
    ;(config.lists.VirtualLabel.fields.displayName as { virtual?: boolean }).virtual = undefined
    const delegate = makeDelegate([{ id: 'v1', displayName: 'Computed One' }])
    const context = makeContext({ VirtualLabel: delegate })

    await getRelationshipOptions(context, config, 'VirtualLabel', { search: 'One' })

    expect(delegate.calls[0].orderBy).toEqual({ id: 'asc' })
  })

  it('unions currently-selected ids even when beyond take / not matching search', async () => {
    // The bounded/search-scoped query only returns a1 (mimicking take:1 + search).
    const primaryDelegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: primaryDelegate })
    const config = makeConfig()

    // The selected-ids read (a second composed read) resolves a3, which fell
    // outside the primary window.
    primaryDelegate.queue.push([authors[0]], [authors[2]])

    const result = await getRelationshipOptions(context, config, 'Author', {
      take: 1,
      selectedIds: ['a3'],
    })

    expect(result).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a3', label: 'Grace Hopper' },
    ])

    const selectedCall = primaryDelegate.calls[1]
    expect(selectedCall.where).toEqual([{ id: { in: ['a3'] } }])
    // …and it is projected exactly as the primary window is.
    expect(selectedCall.select).toEqual(['id', 'name'])
  })

  it('does not re-query when the selected id is already within the primary window', async () => {
    const delegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { selectedIds: ['a1'] })

    expect(delegate.calls).toHaveLength(1)
  })

  it('returns [] when the related list query access is denied (the terminal returns [])', async () => {
    const delegate = makeDelegate([])
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'Author', {
      selectedIds: ['a1'],
    })

    expect(result).toEqual([])
  })

  it('returns [] when the related list does not exist in config', async () => {
    const context = makeContext({})
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'Missing', {})

    expect(result).toEqual([])
  })
})
