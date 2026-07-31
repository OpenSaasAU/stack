import { describe, it, expect, vi } from 'vitest'
import { prepareItemForm } from '../../src/lib/prepareItemForm.js'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'

interface DelegateStub {
  findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>
  findFirst: (args?: unknown) => Promise<Record<string, unknown> | null>
}

function makeContext(delegates: Record<string, DelegateStub>): AccessContext<unknown> {
  const context = {
    db: delegates,
    session: null,
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  }
  return context as unknown as AccessContext<unknown>
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
  it('fetches relationship options via a bounded, take-limited query — never an unbounded findMany({})', async () => {
    const authorFindMany = vi.fn(async () => [
      { id: 'a1', name: 'Ada Lovelace' },
      { id: 'a2', name: 'Alan Turing' },
    ])
    const tagFindMany = vi.fn(async () => [{ id: 't1', name: 'engineering' }])
    const context = makeContext({
      author: { findMany: authorFindMany, findFirst: vi.fn() },
      tag: { findMany: tagFindMany, findFirst: vi.fn() },
    })
    const config = makeConfig()

    const { relationshipData } = await prepareItemForm(context, config, config.lists.Post, {})

    expect(relationshipData.author).toEqual([
      { id: 'a1', label: 'Ada Lovelace' },
      { id: 'a2', label: 'Alan Turing' },
    ])
    expect(relationshipData.tags).toEqual([{ id: 't1', label: 'engineering' }])

    // Every findMany call must be take-bounded — no unbounded `{}` fetch.
    for (const call of [...authorFindMany.mock.calls, ...tagFindMany.mock.calls]) {
      const args = call[0] as Record<string, unknown> | undefined
      expect(args?.take).toBeGreaterThan(0)
    }
  })

  it('unions the currently-selected single-relationship id even when outside the bounded window', async () => {
    // The bounded window only returns a1; a9 (the item's current author) is
    // outside it and must be unioned in via a second, id-scoped query.
    const authorFindMany = vi
      .fn<(args?: unknown) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([{ id: 'a1', name: 'Ada Lovelace' }])
      .mockResolvedValueOnce([{ id: 'a9', name: 'Currently Selected' }])
    const context = makeContext({
      author: { findMany: authorFindMany, findFirst: vi.fn() },
      tag: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
    })
    const config = makeConfig()

    const itemData = { id: 'p1', title: 'Post', author: { id: 'a9', name: 'Currently Selected' } }
    const { relationshipData } = await prepareItemForm(context, config, config.lists.Post, itemData)

    expect(relationshipData.author).toEqual(
      expect.arrayContaining([{ id: 'a9', label: 'Currently Selected' }]),
    )
    const selectedIdCall = authorFindMany.mock.calls[1][0] as Record<string, unknown>
    expect(selectedIdCall.where).toEqual({ id: { in: ['a9'] } })
  })

  it('unions every currently-selected id for a many relationship', async () => {
    const tagFindMany = vi
      .fn<(args?: unknown) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([{ id: 't1', name: 'engineering' }])
      .mockResolvedValueOnce([{ id: 't9', name: 'design' }])
    const context = makeContext({
      author: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
      tag: { findMany: tagFindMany, findFirst: vi.fn() },
    })
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
    const selectedIdCall = tagFindMany.mock.calls[1][0] as Record<string, unknown>
    expect(selectedIdCall.where).toEqual({ id: { in: ['t9'] } })
  })

  it('fetches relationship options for multiple fields concurrently, not serially', async () => {
    // Neither findMany ever resolves in this test. If the fetches are kicked
    // off serially (an `await` inside a `for` loop), `tagFindMany` is never
    // even invoked until `authorFindMany`'s promise resolves — which it
    // never does here — so `tagCalled` would stay `false` forever. Fetching
    // concurrently invokes both before either resolves.
    let authorCalled = false
    let tagCalled = false
    let resolveAuthor!: (value: Array<Record<string, unknown>>) => void
    let resolveTag!: (value: Array<Record<string, unknown>>) => void

    const authorFindMany = vi.fn(() => {
      authorCalled = true
      return new Promise<Array<Record<string, unknown>>>((resolve) => {
        resolveAuthor = resolve
      })
    })
    const tagFindMany = vi.fn(() => {
      tagCalled = true
      return new Promise<Array<Record<string, unknown>>>((resolve) => {
        resolveTag = resolve
      })
    })
    const context = makeContext({
      author: { findMany: authorFindMany, findFirst: vi.fn() },
      tag: { findMany: tagFindMany, findFirst: vi.fn() },
    })
    const config = makeConfig()

    const promise = prepareItemForm(context, config, config.lists.Post, {})

    expect(authorCalled).toBe(true)
    expect(tagCalled).toBe(true)

    resolveAuthor([])
    resolveTag([])
    await promise
  })

  it('passes no selectedIds when the relationship is empty (create mode)', async () => {
    const authorFindMany = vi.fn(async () => [])
    const context = makeContext({
      author: { findMany: authorFindMany, findFirst: vi.fn() },
      tag: { findMany: vi.fn(async () => []), findFirst: vi.fn() },
    })
    const config = makeConfig()

    await prepareItemForm(context, config, config.lists.Post, {})

    // Only the primary bounded query runs — no second, id-scoped query.
    expect(authorFindMany).toHaveBeenCalledTimes(1)
  })
})
