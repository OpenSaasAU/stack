import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { BaseFieldConfig, OpenSaasConfig, TypeInfo } from '../config/types.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, type TestDatabase } from '../testing/context.js'
import type { AccessContext } from '../access/types.js'
import { rebindDb } from '../context/index.js'
import { collectionFor, engineRead, type ReadBinding } from './binding.js'
import { visibleRows } from './field-visibility.js'
import { buildIncludeRequest, planLevel, resolveIncludes } from './include.js'

/**
 * Field Visibility reads each relation's list, its Synthetic flag and the
 * un-included foreign keys off the plan (#2406). Every list here carries the
 * same field names under different rules, so a level resolved to the wrong
 * list shows up in what the caller receives.
 */

const BOOT = 120_000

function photo(): BaseFieldConfig<TypeInfo> {
  return {
    type: 'photo',
    getContractField: () => ({
      kind: 'columns',
      columns: [
        { name: 'photo_url', type: { pack: 'pg', type: 'text' }, nullable: true },
        { name: 'photo_size', type: { pack: 'pg', type: 'int' }, nullable: true },
      ],
    }),
    outputType: '{ url: string; size: number } | null',
    getColumnNames: () => ['photo_url', 'photo_size'],
    assembleColumns: (_field, row) =>
      typeof row.photo_url === 'string' ? { url: row.photo_url, size: row.photo_size } : null,
    splitColumns: (_field, value) => ({
      photo_url: typeof value === 'object' && value !== null ? Reflect.get(value, 'url') : null,
      photo_size: typeof value === 'object' && value !== null ? Reflect.get(value, 'size') : null,
    }),
  }
}

const tagRuns: string[] = []

function tagged(list: string) {
  return virtual({
    type: 'string',
    hooks: {
      resolveOutput: () => {
        tagRuns.push(list)
        return list
      },
    },
  })
}

const OPEN = { query: () => true, create: () => true, update: () => true, delete: () => true }

let engineContext: AccessContext | undefined

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Author: {
      fields: {
        name: text(),
        note: text(),
        tag: tagged('Author'),
        posts: relationship({ ref: 'Post.author', many: true }),
        profile: relationship({ ref: 'Profile.author' }),
        postCount: virtual({
          type: 'number',
          needs: ['posts'],
          hooks: {
            resolveOutput: ({ item }) => (Array.isArray(item.posts) ? item.posts.length : -1),
          },
        }),
      },
      access: {
        operation: {
          ...OPEN,
          query: ({ session }) => (session === null ? true : { name: { notIn: ['secret'] } }),
        },
      },
    },
    Post: {
      fields: {
        name: text(),
        note: text({ access: { read: () => false } }),
        tag: tagged('Post'),
        author: relationship({ ref: 'Author.posts' }),
        topic: relationship({
          ref: 'Topic',
          access: { read: ({ item }) => Reflect.get(Object(item), 'name') !== 'gated' },
        }),
      },
      access: { operation: OPEN },
    },
    Topic: {
      fields: { name: text(), note: text(), tag: tagged('Topic') },
      access: {
        operation: {
          ...OPEN,
          query: ({ context }) => {
            engineContext = context
            return true
          },
        },
      },
    },
    Profile: {
      fields: {
        name: text(),
        note: text({ access: { read: () => false } }),
        tag: tagged('Profile'),
        photo: photo(),
        author: relationship({ ref: 'Author.profile', db: { foreignKey: true } }),
      },
      access: { operation: OPEN },
    },
  },
}

describe('Field Visibility reads every relation shape off its plan node (#2406)', () => {
  let database: TestDatabase
  let ids: { ada: unknown; secret: unknown; topic: unknown }

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  beforeEach(async () => {
    await database.truncate()
    const { db } = database.context(null)
    const ada = await db.Author.create({ data: { name: 'ada', note: 'author note' } })
    const secret = await db.Author.create({ data: { name: 'secret', note: 'author note' } })
    const topic = await db.Topic.create({ data: { name: 't', note: 'topic note' } })
    if (ada === null || secret === null || topic === null) throw new Error('setup')
    ids = { ada: ada.id, secret: secret.id, topic: topic.id }
    for (const [name, author] of [
      ['open', ada.id],
      ['gated', ada.id],
      ['by-secret', secret.id],
    ] as const) {
      await db.Post.create({
        data: {
          name,
          note: 'post note',
          author: { connect: { id: author } },
          topic: { connect: { id: topic.id } },
        },
      })
    }
    await db.Profile.create({
      data: {
        name: 'p',
        note: 'profile note',
        photo: { url: 'u', size: 3 },
        author: { connect: { id: ada.id } },
      },
    })
    tagRuns.length = 0
  })

  test(
    'a branch only a declaration fetched runs nothing of the related list and is stripped',
    async () => {
      const [author] = await database
        .context(null)
        .db.Author.where({ name: { equals: 'ada' } })
        .all()
      expect(author).toMatchObject({ postCount: 2, tag: 'Author' })
      expect(author).not.toHaveProperty('posts')
      expect(tagRuns).toEqual(['Author'])
    },
    BOOT,
  )

  test(
    'an included to-many is stripped and computed by the related list',
    async () => {
      const [author] = await database
        .context(null)
        .db.Author.where({ name: { equals: 'ada' } })
        .include('posts', (posts) => posts.orderBy({ name: 'asc' }))
        .all()
      expect(author.posts).toEqual([
        expect.objectContaining({ name: 'gated', tag: 'Post' }),
        expect.objectContaining({ name: 'open', tag: 'Post' }),
      ])
      expect(author.posts).not.toContainEqual(expect.objectContaining({ note: expect.anything() }))
    },
    BOOT,
  )

  test(
    'an included to-one is stripped and computed by the related list',
    async () => {
      const post = await database
        .context(null)
        .db.Post.where({ name: { equals: 'open' } })
        .include('author')
        .first()
      expect(post).not.toHaveProperty('note')
      expect(post?.author).toMatchObject({ name: 'ada', note: 'author note', tag: 'Author' })
    },
    BOOT,
  )

  test(
    "a Synthetic back-relation is gated row by row by its source field's rule and shaped by the source list",
    async () => {
      const [topic] = await database.context(null).db.Topic.include('from_Post_topic').all()
      expect(topic).toMatchObject({ note: 'topic note', tag: 'Topic' })
      expect(topic.from_Post_topic).toHaveLength(2)
      expect(topic.from_Post_topic).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'by-secret', tag: 'Post' }),
          expect.objectContaining({ name: 'open', tag: 'Post' }),
        ]),
      )
      expect(topic.from_Post_topic).not.toContainEqual(
        expect.objectContaining({ note: expect.anything() }),
      )
    },
    BOOT,
  )

  test(
    'both sides of a one-to-one resolve to the list across the relation',
    async () => {
      const { db } = database.context(null)
      const [author] = await db.Author.where({ name: { equals: 'ada' } })
        .include('profile')
        .all()
      expect(author.profile).toMatchObject({
        name: 'p',
        tag: 'Profile',
        photo: { url: 'u', size: 3 },
      })
      expect(author.profile).not.toHaveProperty('note')
      expect(author.profile).not.toHaveProperty('photo_url')

      const [profile] = await db.Profile.include('author').all()
      expect(profile.author).toMatchObject({ name: 'ada', note: 'author note', tag: 'Author' })
      expect(profile).not.toHaveProperty('note')
    },
    BOOT,
  )

  test(
    "a multi-column field on a related level is assembled from that level's own parts",
    async () => {
      const [author] = await database
        .context(null)
        .db.Author.where({ name: { equals: 'ada' } })
        .include('profile', (profile) => profile.select('photo'))
        .all()
      expect(author.profile).toEqual({ id: expect.anything(), photo: { url: 'u', size: 3 } })
    },
    BOOT,
  )

  test(
    "an un-included foreign key is narrowed by its target's filter rule, and an included one is not re-checked",
    async () => {
      const signedIn = database.context({ userId: 'u' })
      const posts = await signedIn.db.Post.orderBy({ name: 'asc' }).all()
      expect(posts.map((post) => [post.name, post.authorId])).toEqual([
        ['by-secret', null],
        ['gated', ids.ada],
        ['open', ids.ada],
      ])
      expect(posts.map((post) => post.topicId)).toEqual([ids.topic, null, ids.topic])

      const included = await signedIn.db.Post.orderBy({ name: 'asc' }).include('author').all()
      expect(included.map((post) => [post.authorId, post.author])).toEqual([
        [null, null],
        [ids.ada, expect.objectContaining({ name: 'ada' })],
        [ids.ada, expect.objectContaining({ name: 'ada' })],
      ])
    },
    BOOT,
  )
})

describe('a relation value the plan has no node for is dropped (#2406)', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase(config)
  }, BOOT)

  afterAll(async () => {
    await database?.close()
  })

  async function readWithoutNode(listName: string, relation: string) {
    const { db } = database.context(null)
    const topic = await db.Topic.create({ data: { name: 't', note: 'topic note' } })
    const author = await db.Author.create({ data: { name: 'ada', note: 'author note' } })
    if (topic === null || author === null) throw new Error('setup')
    for (const name of ['open', 'gated']) {
      await db.Post.create({
        data: {
          name,
          note: 'post note',
          author: { connect: { id: author.id } },
          topic: { connect: { id: topic.id } },
        },
      })
    }
    await db.Topic.all()
    const context = engineContext
    if (context === undefined) throw new Error('no engine context captured')
    const listConfig = config.lists[listName]
    const binding: ReadBinding = {
      listName,
      listConfig,
      ormHandle: context.ormHandle,
      context,
      config,
      rebindDb: rebindDb(config),
    }
    const ctx = {
      listName,
      listConfig,
      config,
      session: null,
      context,
      checkFieldRead: true,
      applyRelationAccess: true,
      accessFilterPath: [],
    }
    const includes = await resolveIncludes([buildIncludeRequest(relation)], ctx, 0)
    const root = planLevel(ctx, undefined, includes)
    const rows = await engineRead(binding, () =>
      collectionFor(context.ormHandle, listName)
        .include(relation, (child) => child)
        .all(),
    )
    expect(rows[0][relation]).toEqual(
      expect.arrayContaining([expect.objectContaining({ note: 'post note' })]),
    )
    const withNode = await visibleRows(binding, rows, root)
    const withoutNode = await visibleRows(binding, rows, {
      ...root,
      includes: root.includes.filter((node) => node.relation !== relation),
    })
    return { withNode, withoutNode }
  }

  test(
    'a Synthetic back-relation with no node is dropped rather than returned raw',
    async () => {
      await database.truncate()
      const { withNode, withoutNode } = await readWithoutNode('Topic', 'from_Post_topic')
      expect(withNode[0].from_Post_topic).toEqual([expect.objectContaining({ name: 'open' })])
      expect(withoutNode[0]).not.toHaveProperty('from_Post_topic')
      expect(withoutNode[0]).toMatchObject({ name: 't', note: 'topic note' })
    },
    BOOT,
  )

  test(
    'a declared relationship with no node is dropped rather than returned raw',
    async () => {
      await database.truncate()
      const { withNode, withoutNode } = await readWithoutNode('Author', 'posts')
      expect(withNode[0].posts).toHaveLength(2)
      expect(withNode[0].posts).not.toContainEqual(
        expect.objectContaining({ note: expect.anything() }),
      )
      expect(withoutNode[0]).not.toHaveProperty('posts')
      expect(withoutNode[0]).toMatchObject({ name: 'ada', note: 'author note' })
    },
    BOOT,
  )
})

describe('the read binding', () => {
  test('rebindDb is a required member (ADR-0023)', () => {
    type Required = object extends Pick<ReadBinding, 'rebindDb'> ? false : true
    const required: Required = true
    expect(required).toBe(true)
  })
})
