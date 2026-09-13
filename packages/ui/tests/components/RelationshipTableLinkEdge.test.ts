import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import type { AccessContext, OpenSaasConfig } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
import {
  createTestContext,
  createPlanRecorder,
  type TestContext,
} from '@opensaas/stack-core/testing'
import { resolveLinkEdge } from '../../src/components/RelationshipTable.js'
import type { RelationshipTableSection } from '../../src/lib/deriveItemView.js'

/**
 * The server half of the add-an-edge control (#1329): which sections get one.
 *
 * The gate is always the list the write lands on — the junction's create
 * access for an edge across one, the related list's update access for an edge
 * held in its own foreign key — never the parent's. Every fixture below leaves
 * the parent list wide open and moves only that list's rule.
 */

const BOOT = 120_000

interface Gates {
  junctionCreate?: () => boolean
  bookUpdate?: () => boolean
}

function makeConfig(gates: Gates = {}): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: {
          title: text(),
          tags: relationship({ ref: 'PostTag.post', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      Tag: {
        fields: {
          name: text(),
          posts: relationship({ ref: 'PostTag.tag', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      PostTag: {
        fields: {
          post: relationship({ ref: 'Post.tags' }),
          tag: relationship({ ref: 'Tag.posts' }),
        },
        access: { operation: { create: gates.junctionCreate ?? (() => true) } },
      },
      Author: {
        fields: {
          name: text(),
          books: relationship({ ref: 'Book.author', many: true }),
        },
        access: { operation: { query: () => true, create: () => true } },
      },
      Book: {
        fields: {
          title: text(),
          author: relationship({ ref: 'Author.books' }),
        },
        access: { operation: { query: () => true, create: () => true, update: gates.bookUpdate } },
      },
    },
  }
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
  let harness: TestContext
  let context: AccessContext

  beforeAll(async () => {
    harness = await createTestContext(makeConfig(), { userId: 'u1' })
    context = harness.context as unknown as AccessContext

    const sudo = harness.context.sudo()
    await sudo.db.Tag.create({ data: { name: 'alpha' } })
    await sudo.db.Tag.create({ data: { name: 'beta' } })
    const author = await sudo.db.Author.create({ data: { name: 'anonymous' } })
    await sudo.db.Book.create({
      data: { title: 'one', author: { connect: { id: author?.id } } },
    })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  it(
    'offers the control for an edge across a junction',
    async () => {
      const edge = await resolveLinkEdge(
        section('tags', 'PostTag.post'),
        makeConfig(),
        'Post',
        context,
      )

      expect(edge?.mode).toBe('junction')
      if (edge?.mode !== 'junction') throw new Error('expected a junction edge')
      expect(edge.junctionListKey).toBe('PostTag')
      expect(edge.targetField).toBe('tag')
      expect(edge.targetListKey).toBe('Tag')
    },
    BOOT,
  )

  it(
    "hides the control when the junction list's own create access is statically denied",
    async () => {
      const edge = await resolveLinkEdge(
        section('tags', 'PostTag.post'),
        makeConfig({ junctionCreate: () => false }),
        'Post',
        context,
      )

      expect(edge).toBeNull()
    },
    BOOT,
  )

  it(
    "offers the control for an ordinary to-many, gated on the related list's update access",
    async () => {
      const edge = await resolveLinkEdge(
        section('books', 'Book.author'),
        makeConfig({ bookUpdate: () => true }),
        'Author',
        context,
      )

      expect(edge?.mode).toBe('foreignKey')
      if (edge?.mode !== 'foreignKey') throw new Error('expected a foreignKey edge')
      expect(edge.relatedListKey).toBe('Book')
      expect(edge.backReferenceField).toBe('author')
      expect(edge.targetListKey).toBe('Book')
    },
    BOOT,
  )

  it(
    "hides the control when the related list's own update access is statically denied",
    async () => {
      const edge = await resolveLinkEdge(
        section('books', 'Book.author'),
        makeConfig(),
        'Author',
        context,
      )

      expect(edge).toBeNull()
    },
    BOOT,
  )

  it(
    'reads nothing from the far endpoint — resolving the control defers that fetch to first open (#1365)',
    async () => {
      const recorder = createPlanRecorder()
      const recorded = await createTestContext(
        makeConfig(),
        { userId: 'u1' },
        {
          middleware: [recorder.middleware],
        },
      )
      try {
        const sudo = recorded.context.sudo()
        await sudo.db.Tag.create({ data: { name: 'gamma' } })
        recorder.clear()

        const edge = await resolveLinkEdge(
          section('tags', 'PostTag.post'),
          makeConfig(),
          'Post',
          recorded.context as unknown as AccessContext,
        )

        expect(edge?.mode).toBe('junction')
        expect(recorder.plans).toEqual([])
      } finally {
        await recorded.close()
      }
    },
    BOOT,
  )
})
