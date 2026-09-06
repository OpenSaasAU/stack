import { describe, it, expect, vi } from 'vitest'
import { getRelationshipOptions } from './relationship-options.js'
import type { QueryRunnerContext } from './relationship-options.js'
import type { OpenSaasConfig } from '../config/types.js'

function makeDelegate(rows: Array<Record<string, unknown>>) {
  return {
    findMany: vi.fn(async (_args?: unknown) => rows),
    findFirst: vi.fn(async (_args?: unknown) => rows[0] ?? null),
  }
}

function makeContext(
  delegates: Record<string, ReturnType<typeof makeDelegate>>,
): QueryRunnerContext {
  return { db: delegates }
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
  it('returns { id, label }[] via a scalar-only fragment with no nested include', async () => {
    const delegate = makeDelegate(authors)
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'Author', {})

    expect(result).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a2', label: 'Alan Turing' },
      { id: 'a3', label: 'Grace Hopper' },
    ])

    const call = delegate.findMany.mock.calls[0][0] as Record<string, unknown>
    expect(call.include).toBeUndefined()
  })

  it('bounds the result by take', async () => {
    const delegate = makeDelegate(authors.slice(0, 2))
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { take: 2 })

    expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }))
  })

  it('orders by the label field ascending and filters via contains on a text label field', async () => {
    const delegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { search: 'Ada' })

    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: { contains: 'Ada' } },
        orderBy: { name: 'asc' },
      }),
    )
  })

  it('does not filter (first-N) when the label field is not a text field', async () => {
    const rows = [{ id: 'n1', rank: 1 }]
    const delegate = makeDelegate(rows)
    const context = makeContext({ NumericLabel: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'NumericLabel', { search: '1' })

    const call = delegate.findMany.mock.calls[0][0] as Record<string, unknown>
    expect(call.where).toBeUndefined()
    expect(call.orderBy).toEqual({ rank: 'asc' })
  })

  it('falls back to ordering by id when the label field is virtual (no backing column)', async () => {
    const rows = [{ id: 'v1', displayName: 'Computed One' }]
    const delegate = makeDelegate(rows)
    const context = makeContext({ VirtualLabel: delegate })
    const config = makeConfig()

    const result = await getRelationshipOptions(context, config, 'VirtualLabel', { search: 'One' })

    const call = delegate.findMany.mock.calls[0][0] as Record<string, unknown>
    // Virtual label fields have no backing column, so ordering by them would
    // 500 in Prisma — order by id instead, and skip the text `contains` filter.
    expect(call.orderBy).toEqual({ id: 'asc' })
    expect(call.where).toBeUndefined()
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

    const call = delegate.findMany.mock.calls[0][0] as Record<string, unknown>
    expect(call.orderBy).toEqual({ id: 'asc' })
  })

  it('unions currently-selected ids even when beyond take / not matching search', async () => {
    // The bounded/search-scoped query only returns a1 (mimicking take:1 + search).
    const primaryDelegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: primaryDelegate })
    const config = makeConfig()

    // The selected-ids query (a separate findMany call) resolves a3, which fell
    // outside the primary window.
    primaryDelegate.findMany.mockImplementationOnce(async () => [authors[0]])
    primaryDelegate.findMany.mockImplementationOnce(async () => [authors[2]])

    const result = await getRelationshipOptions(context, config, 'Author', {
      take: 1,
      selectedIds: ['a3'],
    })

    expect(result).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a3', label: 'Grace Hopper' },
    ])

    const selectedCall = primaryDelegate.findMany.mock.calls[1][0] as Record<string, unknown>
    expect(selectedCall.where).toEqual({ id: { in: ['a3'] } })
  })

  it('does not re-query when the selected id is already within the primary window', async () => {
    const delegate = makeDelegate([authors[0]])
    const context = makeContext({ Author: delegate })
    const config = makeConfig()

    await getRelationshipOptions(context, config, 'Author', { selectedIds: ['a1'] })

    expect(delegate.findMany).toHaveBeenCalledTimes(1)
  })

  it('returns [] when the related list query access is denied (findMany returns [])', async () => {
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
