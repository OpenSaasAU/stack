import { describe, it, expect } from 'vitest'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'

type Rows = Array<Record<string, unknown>>

/** One composed read, as `getRelationshipOptions` built it. */
interface RecordedRead {
  where: unknown[]
  orderBy: unknown
  select: readonly string[]
  limit: number | undefined
}

interface DelegateStub {
  where: (predicate: unknown) => DelegateStub
  orderBy: (order: unknown) => DelegateStub
  select: (...fields: readonly string[]) => DelegateStub
  limit: (count: number) => DelegateStub
  all: () => Promise<Rows>
}

/**
 * A composed-read double for the secured surface `getRelationshipOptions`
 * drives (ADR-0041), recording what each chain composed before its terminal.
 */
function makeDelegate(all: (read: RecordedRead) => Promise<Rows>) {
  const calls: RecordedRead[] = []
  function build(read: RecordedRead): DelegateStub {
    return {
      where: (predicate: unknown) => build({ ...read, where: [...read.where, predicate] }),
      orderBy: (order: unknown) => build({ ...read, orderBy: order }),
      select: (...fields: readonly string[]) => build({ ...read, select: fields }),
      limit: (count: number) => build({ ...read, limit: count }),
      all: () => {
        calls.push(read)
        return all(read)
      },
    }
  }
  return {
    calls,
    query: build({ where: [], orderBy: undefined, select: [], limit: undefined }),
  }
}

function makeContext(delegates: Record<string, ReturnType<typeof makeDelegate>>): AccessContext {
  const db: Record<string, DelegateStub> = {}
  for (const [key, delegate] of Object.entries(delegates)) db[key] = delegate.query
  const context = {
    db,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext
}

function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Author: {
        fields: { name: { type: 'text' } },
        access: { operation: { query: () => true } },
      },
      Tag: {
        fields: { name: { type: 'text' } },
        access: { operation: { query: () => true } },
      },
      Post: {
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', ref: 'Author.posts' },
          tags: { type: 'relationship', ref: 'Tag.posts', many: true },
        },
        access: { operation: { query: () => true } },
      },
    },
  } as unknown as OpenSaasConfig
}

describe('prepareItemForm', () => {
  it('carries a bigInt field value through the JSON round-trip as a bigint, not a throw', async () => {
    const context = makeContext({})
    const config = {
      db: { provider: 'sqlite', url: 'file:./test.db' },
      lists: {
        Event: {
          fields: { occurredAtMs: { type: 'bigInt' } },
          access: { operation: { query: () => true } },
        },
      },
    } as unknown as OpenSaasConfig

    const { initialData } = await prepareItemForm(context, config, config.lists.Event, {
      id: '1',
      occurredAtMs: 9007199254740993n,
    })

    expect(initialData.occurredAtMs).toBe(9007199254740993n)
  })

  it('fetches relationship options via a bounded, projected read — never an unbounded one', async () => {
    const author = makeDelegate(async () => [
      { id: 'a1', name: 'Ada Lovelace' },
      { id: 'a2', name: 'Alan Turing' },
    ])
    const tag = makeDelegate(async () => [{ id: 't1', name: 'engineering' }])
    const context = makeContext({ Author: author, Tag: tag })
    const config = makeConfig()

    const { relationshipData } = await prepareItemForm(context, config, config.lists.Post, {})

    expect(relationshipData.author).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a2', label: 'Alan Turing' },
    ])
    expect(relationshipData.tags).toEqual([{ id: 't1', label: 'engineering' }])

    // The primary window must be bounded, and projected to id + label so no
    // other field's `resolveOutput` runs over it.
    for (const delegate of [author, tag]) {
      expect(delegate.calls[0].limit).toBeGreaterThan(0)
      expect(delegate.calls[0].select).toEqual(['id', 'name'])
    }
  })

  it('unions the currently-selected single-relationship id even when outside the bounded window', async () => {
    // The bounded window only returns a1; a9 (the item's current author) is
    // outside it and must be unioned in via a second, id-scoped query.
    const queued: Rows[] = [
      [{ id: 'a1', name: 'Ada Lovelace' }],
      [{ id: 'a9', name: 'Currently Selected' }],
    ]
    const author = makeDelegate(async () => queued.shift() ?? [])
    const context = makeContext({ Author: author, Tag: makeDelegate(async () => []) })
    const config = makeConfig()

    const itemData = { id: 'p1', title: 'Post', author: { id: 'a9', name: 'Currently Selected' } }
    const { relationshipData } = await prepareItemForm(context, config, config.lists.Post, itemData)

    expect(relationshipData.author).toEqual(
      expect.arrayContaining([{ id: 'a9', label: 'Currently Selected' }]),
    )
    expect(author.calls[1].where).toEqual([{ id: { in: ['a9'] } }])
  })

  it('unions every currently-selected id for a many relationship', async () => {
    const queued: Rows[] = [[{ id: 't1', name: 'engineering' }], [{ id: 't9', name: 'design' }]]
    const tag = makeDelegate(async () => queued.shift() ?? [])
    const context = makeContext({ Author: makeDelegate(async () => []), Tag: tag })
    const config = makeConfig()

    const itemData = {
      id: 'p1',
      title: 'Post',
      tags: [
        { id: 't1', name: 'engineering' },
        { id: 't9', name: 'design' },
      ],
    }
    const { relationshipData } = await prepareItemForm(context, config, config.lists.Post, itemData)

    expect(relationshipData.tags).toEqual(
      expect.arrayContaining([
        { id: 't1', label: 'engineering' },
        { id: 't9', label: 'design' },
      ]),
    )
    expect(tag.calls[1].where).toEqual([{ id: { in: ['t9'] } }])
  })

  it('fetches relationship options for multiple fields concurrently, not serially', async () => {
    // Neither terminal ever resolves in this test. If the fetches are kicked
    // off serially (an `await` inside a `for` loop), the Tag read is never
    // even started until the Author one resolves — which it never does here —
    // so `tagCalled` would stay `false` forever. Fetching concurrently starts
    // both before either resolves.
    let authorCalled = false
    let tagCalled = false
    let resolveAuthor!: (value: Rows) => void
    let resolveTag!: (value: Rows) => void

    const author = makeDelegate(() => {
      authorCalled = true
      return new Promise<Rows>((resolve) => {
        resolveAuthor = resolve
      })
    })
    const tag = makeDelegate(() => {
      tagCalled = true
      return new Promise<Rows>((resolve) => {
        resolveTag = resolve
      })
    })
    const context = makeContext({ Author: author, Tag: tag })
    const config = makeConfig()

    const promise = prepareItemForm(context, config, config.lists.Post, {})

    expect(authorCalled).toBe(true)
    expect(tagCalled).toBe(true)

    resolveAuthor([])
    resolveTag([])
    await promise
  })

  it('passes no selectedIds when the relationship is empty (create mode)', async () => {
    const author = makeDelegate(async () => [])
    const context = makeContext({ Author: author, Tag: makeDelegate(async () => []) })
    const config = makeConfig()

    await prepareItemForm(context, config, config.lists.Post, {})

    // Only the primary bounded read runs — no second, id-scoped one.
    expect(author.calls).toHaveLength(1)
  })
})
