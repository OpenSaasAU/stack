import { describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { resolveLinkEdge } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'

/**
 * The server half of the add-an-edge control (#1329): which sections get one.
 *
 * The gate is the JUNCTION list's own create access, never the parent's — so
 * every fixture below leaves the parent list wide open and moves only the
 * junction's rule.
 */

interface Gates {
  junctionCreate?: () => boolean
}

function config(gates: Gates = {}): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      Post: {
        fields: {
          title: { type: 'text' },
          tags: { type: 'relationship', ref: 'PostTag.post', many: true },
        },
        access: { operation: { create: () => true } },
      },
      Tag: {
        fields: {
          name: { type: 'text' },
          posts: { type: 'relationship', ref: 'PostTag.tag', many: true },
        },
      },
      PostTag: {
        fields: {
          post: { type: 'relationship', ref: 'Post.tags' },
          tag: { type: 'relationship', ref: 'Tag.posts' },
        },
        access: { operation: { create: gates.junctionCreate ?? (() => true) } },
      },
      Author: {
        fields: {
          name: { type: 'text' },
          books: { type: 'relationship', ref: 'Book.author', many: true },
        },
      },
      Book: {
        fields: {
          title: { type: 'text' },
          author: { type: 'relationship', ref: 'Author.books' },
        },
      },
    },
  } as unknown as OpenSaasConfig
}

/** A query surface over one fixed window, standing in for the secured read. */
function makeContext(rows: Array<Record<string, unknown>>): AccessContext {
  const query = {
    where: () => query,
    orderBy: () => query,
    select: () => query,
    limit: () => query,
    all: async () => rows,
  }
  return {
    db: new Proxy({}, { get: () => query }),
    session: { userId: 'u1' },
    storage: {},
    plugins: {},
    _isSudo: false,
    _resolveOutputChain: [],
  } as unknown as AccessContext
}

function section(fieldName: string, ref: string): RelationshipTableSection {
  const [relatedListKey, backReferenceField] = ref.split('.')
  return {
    fieldName,
    ref,
    relatedListKey,
    backReferenceField,
    columns: [],
    take: 10,
    sumColumns: [],
    removeAction: 'disconnect',
    disconnectable: true,
  }
}

describe('resolveLinkEdge', () => {
  it('offers the control with the far endpoint options for an edge across a junction', async () => {
    const edge = await resolveLinkEdge(
      section('tags', 'PostTag.post'),
      config(),
      'Post',
      makeContext([
        { id: 't1', name: 'alpha' },
        { id: 't2', name: 'beta' },
      ]),
    )

    expect(edge).toEqual({
      junctionListKey: 'PostTag',
      targetField: 'tag',
      targetListKey: 'Tag',
      options: [
        { id: 't1', label: 'alpha' },
        { id: 't2', label: 'beta' },
      ],
    })
  })

  it("hides the control when the junction list's own create access is statically denied", async () => {
    const edge = await resolveLinkEdge(
      section('tags', 'PostTag.post'),
      config({ junctionCreate: () => false }),
      'Post',
      makeContext([{ id: 't1', name: 'alpha' }]),
    )

    expect(edge).toBeNull()
  })

  it('hides the control for an ordinary to-many, whose far end is a child row', async () => {
    const edge = await resolveLinkEdge(
      section('books', 'Book.author'),
      config(),
      'Author',
      makeContext([{ id: 'b1', title: 'one' }]),
    )

    expect(edge).toBeNull()
  })
})
