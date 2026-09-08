import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import pg from 'pg'
import type { AccessControlledDB, Session } from '../access/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { createTestContext, ormClientFor, type TestContext } from '../testing/context.js'
import type { StackContext } from '../types/context.js'
import { getContext } from './index.js'
import { resolveJunctionEdge } from './junction.js'

/**
 * Adding an edge across an explicit junction (#1329) over a real database.
 *
 * The junction below is the only shape a many-to-many can take: ADR-0048
 * deleted the implicit one, so `PostTag` is an ordinary list whose two
 * relationship fields own their own columns, and an edge is one of its rows.
 */

const BOOT = 120_000

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

interface Gates {
  junctionCreate?: () => boolean
  tagQuery?: () => boolean | Record<string, unknown>
}

function junctionConfig(gates: Gates = {}): OpenSaasConfig {
  return {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text(), tags: relationship({ ref: 'PostTag.post', many: true }) },
        access: { operation: OPEN },
      },
      Tag: {
        fields: { name: text(), posts: relationship({ ref: 'PostTag.tag', many: true }) },
        access: { operation: { ...OPEN, query: gates.tagQuery ?? (() => true) } },
      },
      PostTag: {
        fields: {
          post: relationship({ ref: 'Post.tags' }),
          tag: relationship({ ref: 'Tag.posts' }),
        },
        access: { operation: { ...OPEN, create: gates.junctionCreate ?? (() => true) } },
      },
      // A to-many that is NOT an edge: the far end of `Author.books` is an
      // ordinary child row, so adding one is an update of that row, not a
      // create of an edge.
      Author: {
        fields: { name: text(), books: relationship({ ref: 'Book.author', many: true }) },
        access: { operation: OPEN },
      },
      Book: {
        fields: { title: text(), author: relationship({ ref: 'Author.books' }) },
        access: { operation: OPEN },
      },
    },
  }
}

async function storedEdges(
  url: string,
): Promise<Array<{ post: string | null; tag: string | null }>> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query('select "post", "tag" from "public"."PostTag"')
    return result.rows.map((row: { post: string | null; tag: string | null }) => ({
      post: row.post,
      tag: row.tag,
    }))
  } finally {
    await client.end()
  }
}

describe('adding an edge across a junction', () => {
  let harness: TestContext

  beforeAll(async () => {
    harness = await createTestContext(junctionConfig(), { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  beforeEach(async () => {
    await harness.truncate()
  })

  function contextAt(
    config: OpenSaasConfig,
    session: Session | null,
  ): StackContext<AccessControlledDB> {
    const orm = ormClientFor(harness.data, harness.client.orm)
    return getContext(config, orm, session, undefined, false, undefined, undefined, harness.client)
  }

  async function seed(): Promise<{ post: string; tagA: string; tagB: string }> {
    const post = await harness.context.db.Post.create({ data: { title: 'p' } })
    const tagA = await harness.context.db.Tag.create({ data: { name: 'alpha' } })
    const tagB = await harness.context.db.Tag.create({ data: { name: 'beta' } })
    return { post: String(post?.id), tagA: String(tagA?.id), tagB: String(tagB?.id) }
  }

  test('resolves the junction list, its back-reference and its far endpoint', () => {
    expect(resolveJunctionEdge(junctionConfig(), 'Post', 'tags')).toEqual({
      junctionListKey: 'PostTag',
      backReferenceField: 'post',
      targetField: 'tag',
      targetListKey: 'Tag',
    })
  })

  test('an ordinary to-many back-reference is not an edge', () => {
    expect(resolveJunctionEdge(junctionConfig(), 'Author', 'books')).toBeNull()
  })

  test('a junction carrying a third foreign key has no single far endpoint', () => {
    const config = junctionConfig()
    config.lists.PostTag.fields.author = relationship({ ref: 'Author' })

    expect(resolveJunctionEdge(config, 'Post', 'tags')).toBeNull()
  })

  test('a junction with a required scalar of its own cannot be made from two ids', () => {
    const config = junctionConfig()
    config.lists.PostTag.fields.role = text({ validation: { isRequired: true } })

    expect(resolveJunctionEdge(config, 'Post', 'tags')).toBeNull()
    // The same field without the requirement leaves the edge resolvable, so
    // the refusal above is the requirement and not the extra field.
    config.lists.PostTag.fields.role = text()
    expect(resolveJunctionEdge(config, 'Post', 'tags')).toMatchObject({ targetField: 'tag' })
  })

  test('a list-only ref names no back-reference to link the parent through', () => {
    const config = junctionConfig()
    config.lists.Post.fields.tags = relationship({ ref: 'PostTag', many: true })

    expect(resolveJunctionEdge(config, 'Post', 'tags')).toBeNull()
  })

  test(
    'addRelated stores the junction row the server composed from both endpoints',
    async () => {
      const { post, tagA, tagB } = await seed()

      const result = await harness.context.serverAction({
        listKey: 'Post',
        action: 'addRelated',
        field: 'tags',
        parentId: post,
        targetId: tagB,
      })

      expect(result).toMatchObject({ added: true })
      expect(await storedEdges(harness.url)).toEqual([{ post, tag: tagB }])
      expect(tagA).not.toEqual(tagB)
    },
    BOOT,
  )

  test(
    "the junction list's own create access gates the edge, silently",
    async () => {
      const { post, tagA } = await seed()
      const denied = contextAt(junctionConfig({ junctionCreate: () => false }), { userId: 'u1' })

      const result = await denied.serverAction({
        listKey: 'Post',
        action: 'addRelated',
        field: 'tags',
        parentId: post,
        targetId: tagA,
      })

      expect(result).toEqual({ added: false, error: 'Access denied or operation failed' })
      expect(await storedEdges(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'an unreadable endpoint and an absent one are the same answer',
    async () => {
      const { post, tagA } = await seed()
      // `alpha` exists and is real; the filter hides it from THIS session, so
      // the scoped and unscoped answers cannot coincide.
      const scoped = contextAt(junctionConfig({ tagQuery: () => ({ name: { equals: 'beta' } }) }), {
        userId: 'u1',
      })

      const unreadable = await scoped.serverAction({
        listKey: 'Post',
        action: 'addRelated',
        field: 'tags',
        parentId: post,
        targetId: tagA,
      })
      const absent = await scoped.serverAction({
        listKey: 'Post',
        action: 'addRelated',
        field: 'tags',
        parentId: post,
        targetId: '01a07e00-0000-7000-8000-000000000000',
      })

      expect(unreadable).toEqual(absent)
      expect(unreadable).toEqual({ added: false, error: 'Access denied or operation failed' })
      expect(await storedEdges(harness.url)).toEqual([])
    },
    BOOT,
  )

  test(
    'a readable endpoint on the same scoped context still links',
    async () => {
      const { post, tagB } = await seed()
      const scoped = contextAt(junctionConfig({ tagQuery: () => ({ name: { equals: 'beta' } }) }), {
        userId: 'u1',
      })

      const result = await scoped.serverAction({
        listKey: 'Post',
        action: 'addRelated',
        field: 'tags',
        parentId: post,
        targetId: tagB,
      })

      expect(result).toMatchObject({ added: true })
      expect(await storedEdges(harness.url)).toEqual([{ post, tag: tagB }])
    },
    BOOT,
  )

  test(
    'a to-many that is not an edge is refused by name and writes nothing',
    async () => {
      const author = await harness.context.db.Author.create({ data: { name: 'a' } })
      const book = await harness.context.db.Book.create({ data: { title: 'b' } })

      const result = await harness.context.serverAction({
        listKey: 'Author',
        action: 'addRelated',
        field: 'books',
        parentId: String(author?.id),
        targetId: String(book?.id),
      })

      expect(result).toMatchObject({ added: false })
      expect(String((result as { error?: string }).error)).toContain(
        'not an edge across an explicit junction list',
      )
    },
    BOOT,
  )
})

/**
 * The junction a real application declares: a unique pair index, so the
 * database refuses a second copy of the same edge whatever two concurrent
 * callers each saw. The generator resolves each named field to its own foreign
 * key column, and #1154's constraint map turns the violation into per-field
 * messages rather than a driver error.
 */
describe('a junction that forbids duplicate edges', () => {
  let harness: TestContext

  const pairedConfig: OpenSaasConfig = {
    db: { provider: 'postgresql', timestamps: true },
    lists: {
      Post: {
        fields: { title: text(), tags: relationship({ ref: 'PostTag.post', many: true }) },
        access: { operation: OPEN },
      },
      Tag: {
        fields: { name: text(), posts: relationship({ ref: 'PostTag.tag', many: true }) },
        access: { operation: OPEN },
      },
      PostTag: {
        fields: {
          post: relationship({ ref: 'Post.tags' }),
          tag: relationship({ ref: 'Tag.posts' }),
        },
        db: { indexes: [{ fields: ['post', 'tag'], unique: true }] },
        access: { operation: OPEN },
      },
    },
  }

  beforeAll(async () => {
    harness = await createTestContext(pairedConfig, { userId: 'u1' })
  }, BOOT)

  afterAll(async () => {
    await harness?.close()
  })

  test(
    'the second copy of an edge is refused, and only one row exists',
    async () => {
      const post = await harness.context.db.Post.create({ data: { title: 'p' } })
      const tag = await harness.context.db.Tag.create({ data: { name: 't' } })
      const add = () =>
        harness.context.serverAction({
          listKey: 'Post',
          action: 'addRelated',
          field: 'tags',
          parentId: String(post?.id),
          targetId: String(tag?.id),
        })

      expect(await add()).toMatchObject({ added: true })
      expect(await add()).toMatchObject({
        added: false,
        fieldErrors: { post: expect.any(String), tag: expect.any(String) },
      })
      expect(await storedEdges(harness.url)).toEqual([
        { post: String(post?.id), tag: String(tag?.id) },
      ])
    },
    BOOT,
  )
})
