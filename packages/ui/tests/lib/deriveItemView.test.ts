import { describe, it, expect } from 'vitest'
import { deriveItemViewLayout } from '../../src/lib/deriveItemView.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'

/**
 * Build a minimal config whose lists/fields carry just enough shape for the
 * pure item-view derivation (types, `many`, `ref`, `ui`). The derivation is
 * config-only, so no field-builder methods are needed.
 */
function makeConfig(lists: OpenSaasConfig['lists']): OpenSaasConfig {
  return { db: { provider: 'sqlite', url: 'file:./test.db' }, lists }
}

describe('deriveItemViewLayout', () => {
  it('derives a single centered card when there are no to-many relationships', () => {
    const config = makeConfig({
      Post: {
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', ref: 'User.posts' }, // to-one → details
        },
      },
    })

    const layout = deriveItemViewLayout(config, 'Post')

    expect(layout.arrangement).toBe('single')
    expect(layout.sections).toHaveLength(0)
    expect(layout.detailsFields).toEqual(['title', 'author'])
  })

  it('derives a two-column split for exactly one to-many relationship', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: { type: 'text' },
          posts: { type: 'relationship', ref: 'Post.author', many: true },
        },
      },
      Post: {
        fields: {
          title: { type: 'text' },
          status: { type: 'select', options: [] },
          author: { type: 'relationship', ref: 'User.posts' },
        },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')

    expect(layout.arrangement).toBe('split')
    expect(layout.detailsFields).toEqual(['name'])
    expect(layout.sections).toHaveLength(1)
    const [section] = layout.sections
    expect(section.fieldName).toBe('posts')
    expect(section.relatedListKey).toBe('Post')
    expect(section.backReferenceField).toBe('author')
    // Columns = related list curation minus the back-reference (`author`).
    expect(section.columns).toEqual(['title', 'status'])
    expect(section.sumColumns).toEqual([])
  })

  it('stacks several to-many relationships', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: { type: 'text' },
          posts: { type: 'relationship', ref: 'Post.author', many: true },
          comments: { type: 'relationship', ref: 'Comment.author', many: true },
        },
      },
      Post: {
        fields: { title: { type: 'text' }, author: { type: 'relationship', ref: 'User.posts' } },
      },
      Comment: {
        fields: { body: { type: 'text' }, author: { type: 'relationship', ref: 'User.comments' } },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')

    expect(layout.arrangement).toBe('stacked')
    expect(layout.sections.map((s) => s.fieldName)).toEqual(['posts', 'comments'])
  })

  it('honours a per-relationship column override', () => {
    const config = makeConfig({
      User: {
        fields: {
          posts: {
            type: 'relationship',
            ref: 'Post.author',
            many: true,
            ui: { itemView: { columns: ['title'] } },
          },
        },
      },
      Post: {
        fields: {
          title: { type: 'text' },
          status: { type: 'select', options: [] },
          author: { type: 'relationship', ref: 'User.posts' },
        },
      },
    })

    const [section] = deriveItemViewLayout(config, 'User').sections
    expect(section.columns).toEqual(['title'])
  })

  it('reads summed columns from config (footer opt-in)', () => {
    const config = makeConfig({
      Order: {
        fields: {
          lineItems: {
            type: 'relationship',
            ref: 'LineItem.order',
            many: true,
            ui: { itemView: { sum: ['amount'] } },
          },
        },
      },
      LineItem: {
        fields: {
          amount: { type: 'integer' },
          order: { type: 'relationship', ref: 'Order.lineItems' },
        },
      },
    })

    const [section] = deriveItemViewLayout(config, 'Order').sections
    expect(section.sumColumns).toEqual(['amount'])
    // Default columns still exclude the back-reference.
    expect(section.columns).toEqual(['amount'])
  })

  it('demotes a relationship to the picker (details card) when configured', () => {
    const config = makeConfig({
      User: {
        fields: {
          name: { type: 'text' },
          posts: {
            type: 'relationship',
            ref: 'Post.author',
            many: true,
            ui: { itemView: { displayMode: 'picker' } },
          },
        },
      },
      Post: {
        fields: { title: { type: 'text' }, author: { type: 'relationship', ref: 'User.posts' } },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')
    expect(layout.arrangement).toBe('single')
    expect(layout.sections).toHaveLength(0)
    // The demoted relationship stays a details-card field.
    expect(layout.detailsFields).toEqual(['name', 'posts'])
  })

  it('reorders sections by list-level ui.itemView.order', () => {
    const config = makeConfig({
      User: {
        fields: {
          posts: { type: 'relationship', ref: 'Post.author', many: true },
          comments: { type: 'relationship', ref: 'Comment.author', many: true },
        },
        ui: { itemView: { order: ['comments', 'posts'] } },
      },
      Post: {
        fields: { title: { type: 'text' }, author: { type: 'relationship', ref: 'User.posts' } },
      },
      Comment: {
        fields: { body: { type: 'text' }, author: { type: 'relationship', ref: 'User.comments' } },
      },
    })

    const layout = deriveItemViewLayout(config, 'User')
    expect(layout.sections.map((s) => s.fieldName)).toEqual(['comments', 'posts'])
  })

  it('falls back to id when a related list has no curated columns', () => {
    const config = makeConfig({
      Team: {
        fields: { members: { type: 'relationship', ref: 'Member', many: true } },
      },
      // List-only ref: no back-reference field, columns come from the list itself.
      Member: { fields: { name: { type: 'text' } } },
    })

    const [section] = deriveItemViewLayout(config, 'Team').sections
    expect(section.backReferenceField).toBeUndefined()
    expect(section.columns).toEqual(['name'])
  })
})
