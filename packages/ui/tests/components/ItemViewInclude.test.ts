import { describe, it, expect } from 'vitest'
import { buildItemViewInclude, readAccessScopedTotal } from '../../src/components/ItemForm.js'
import { deriveItemViewLayout, DEFAULT_ITEM_VIEW_TAKE } from '../../src/lib/deriveItemView.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'

/**
 * Unit coverage for the item-view bounded fetch + access-scoped total (issue
 * #752): the include applies a per-relationship `take`, and the footer's M is
 * read from the parent's filtered `_count` — denied/absent → no leaked total.
 */

function makeConfig(lists: OpenSaasConfig['lists']): OpenSaasConfig {
  return { db: { provider: 'sqlite', url: 'file:./test.db' }, lists }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- read a nested include entry in tests
function entryOf(include: Record<string, unknown>, field: string): any {
  return include[field]
}

describe('buildItemViewInclude (issue #752 bounded fetch)', () => {
  it('applies the default take to a to-many relationship include', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: { type: 'text' },
          posts: { type: 'relationship', ref: 'Post.author', many: true },
        },
      },
      Post: {
        fields: { title: { type: 'text' }, author: { type: 'relationship', ref: 'User.posts' } },
      },
    })
    const layout = deriveItemViewLayout(config, 'User')
    const include = buildItemViewInclude(config.lists.User, config, layout)

    expect(entryOf(include, 'posts').take).toBe(DEFAULT_ITEM_VIEW_TAKE)
  })

  it('applies a per-relationship take override', () => {
    const config = makeConfig({
      User: {
        fields: {
          posts: {
            type: 'relationship',
            ref: 'Post.author',
            many: true,
            ui: { itemView: { take: 3 } },
          },
        },
      },
      Post: {
        fields: { title: { type: 'text' }, author: { type: 'relationship', ref: 'User.posts' } },
      },
    })
    const layout = deriveItemViewLayout(config, 'User')
    const include = buildItemViewInclude(config.lists.User, config, layout)

    expect(entryOf(include, 'posts').take).toBe(3)
  })

  it('nests relationship-column includes alongside the take', () => {
    const config = makeConfig({
      User: {
        fields: {
          posts: { type: 'relationship', ref: 'Post.author', many: true },
        },
      },
      Post: {
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', ref: 'User.posts' },
          // A relationship column on the related list → nested include so its
          // Cell can resolve a label, carried WITH the row bound.
          category: { type: 'relationship', ref: 'Category' },
        },
      },
      Category: { fields: { name: { type: 'text' } } },
    })
    const layout = deriveItemViewLayout(config, 'User')
    const include = buildItemViewInclude(config.lists.User, config, layout)

    const entry = entryOf(include, 'posts')
    expect(entry.take).toBe(DEFAULT_ITEM_VIEW_TAKE)
    expect(entry.include).toEqual({ category: true })
  })
})

describe('readAccessScopedTotal (issue #752 "showing N of M")', () => {
  it('reads the access-scoped total from the _count payload when present', () => {
    expect(readAccessScopedTotal({ posts: 42 }, 'posts', 2)).toBe(42)
  })

  it('reads a zero total from the _count payload', () => {
    expect(readAccessScopedTotal({ posts: 0 }, 'posts', 0)).toBe(0)
  })

  it('falls back (no leaked total) when the related list is denied — absent from _count', () => {
    // A fully-denied related list is OMITTED from the filtered _count select, so
    // its key is absent here; M falls back to the bounded row count (0), never a
    // leaked true total.
    expect(readAccessScopedTotal({ posts: 5 }, 'sessions', 0)).toBe(0)
  })

  it('falls back when there is no _count payload at all', () => {
    expect(readAccessScopedTotal(undefined, 'posts', 7)).toBe(7)
    expect(readAccessScopedTotal(null, 'posts', 7)).toBe(7)
  })

  it('ignores a non-numeric count value and falls back', () => {
    expect(readAccessScopedTotal({ posts: 'nope' }, 'posts', 4)).toBe(4)
  })
})
